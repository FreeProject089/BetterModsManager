// What md-lite's output still needs after it reaches the DOM.
//
// md-lite deliberately cannot speak the reader's language and cannot attach behaviour: it is
// a string renderer. So two of its blocks arrive incomplete on purpose — the schedule card
// carries an empty title and an empty note for somebody else to fill, and the tab strip is
// inert markup until a click handler exists.
//
// That "somebody else" was `hydrateDocPage` in docs-hub.ts, which only ever runs for BUNDLED
// pages. A PLUGIN's documentation goes through the same renderer from
// `features/plugins/plugin-assets.ts` and was never hydrated at all — so a plugin doc using
// `:::schedule` drew a card with a blank heading, and its tabs did nothing when clicked.
//
// One module both call, rather than a second copy in the plugins feature. It depends on `t`
// and on core/tz, both leaves — nothing here reaches back into either screen.
import { t } from '../core/i18n.js';
import { zoneDelta } from '../core/tz.js';
import { typesetMath } from '../ui/md-math.js';
import { lucideIconUrl, phosphorIconUrl } from '../core/icon-cdn.js';

/**
 * Tabs, delegated once for the whole document.
 *
 * Registered at module scope rather than per host: the panels are `display:none` until a
 * class says otherwise, so the handler has to survive the page being re-rendered under it,
 * and one document-level listener does that for every surface at once — bundled pages, plugin
 * docs, and the Community tab.
 *
 * Hidden panels stay in the tree. A diagram inside one is drawn once, and switching back is
 * instant.
 */
if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement)?.closest?.('.doc-tabs-btn') as HTMLElement | null;
        const wrap = btn?.closest('.doc-tabs') as HTMLElement | null;
        if (!btn || !wrap) return;
        // `data-tab` is md-lite's attribute, `data-i` is rich-markdown's. Both renderers draw
        // this strip and neither should have to know about the other's spelling.
        const i = Number(btn.getAttribute('data-tab') ?? btn.getAttribute('data-i') ?? 0);
        selectTab(wrap, i);
    });

    // The arrow keys, because a strip that only answers to Tab is a row of buttons.
    //
    // `role="tablist"` is a promise about how the widget behaves, and it was made without the
    // behaviour: a screen reader announced a tablist and then Left/Right did nothing. Roving
    // tabindex goes with it — exactly one tab in the tab order, the arrows moving between
    // them — which is the other half of what the role announces.
    document.addEventListener('keydown', (e) => {
        const btn = (e.target as HTMLElement)?.closest?.('.doc-tabs-btn') as HTMLElement | null;
        const wrap = btn?.closest('.doc-tabs') as HTMLElement | null;
        if (!btn || !wrap) return;
        const all = [...wrap.querySelectorAll<HTMLElement>('.doc-tabs-btn')];
        const at = all.indexOf(btn);
        const last = all.length - 1;
        const to = e.key === 'ArrowRight' ? (at === last ? 0 : at + 1)
            : e.key === 'ArrowLeft' ? (at === 0 ? last : at - 1)
                : e.key === 'Home' ? 0
                    : e.key === 'End' ? last
                        : -1;
        if (to < 0) return;
        e.preventDefault();
        selectTab(wrap, to);
        all[to]?.focus();
    });
}

/**
 * Code-block "Copy" buttons in rendered markdown (`renderMarkdown` — Release Notes, the Community
 * tab, app descriptions), and the stylesheet that makes them look like a button at all.
 *
 * The renderer gave the button its look through an inline `style` with `position:absolute`, and
 * its own sanitiser strips any style carrying `position:absolute` (the anti-overlay rule). So the
 * button arrived with NO style — a bare native button under the block — and its click handler
 * wrote to `navigator.clipboard` with no fallback and no visible result. The look lives in a
 * class-based stylesheet now (css/md-body.css), which no attribute filter can take away, and the
 * click is handled here, before the renderer's older listener, with a fallback that works where
 * the Clipboard API is refused.
 *
 * Window, CAPTURE phase: it runs before any document listener, and stops the event so the old
 * listener in ui/update-notes.ts does not run a second copy over the top of this one.
 */
function ensureMdCss(): void {
    if (typeof document === 'undefined' || document.getElementById('md-body-css')) return;
    const link = document.createElement('link');
    link.id = 'md-body-css';
    link.rel = 'stylesheet';
    link.href = 'css/md-body.css';
    (document.head || document.documentElement).appendChild(link);
}

/** Put text on the clipboard. The Clipboard API first; the textarea + execCommand route when it
 *  is missing or refuses (no focus, a denied permission, an older webview). */
export async function copyText(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
    } catch { /* fall through to the legacy route */ }
    const back = document.activeElement as HTMLElement | null;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.setAttribute('aria-hidden', 'true');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    let ok = false;
    try {
        ta.focus();
        ta.select();
        ok = document.execCommand('copy');
    } catch { ok = false; }
    ta.remove();
    try { back?.focus?.({ preventScroll: true }); } catch { /* the button may be gone */ }
    return ok;
}

const copyTimers = new WeakMap<HTMLElement, number>();
function flashCopy(btn: HTMLElement, ok: boolean): void {
    if (btn.dataset.label === undefined) btn.dataset.label = (btn.textContent || '').trim();
    const prev = copyTimers.get(btn);
    if (prev) window.clearTimeout(prev);
    btn.classList.toggle('is-copied', ok);
    btn.classList.toggle('is-failed', !ok);
    btn.setAttribute('aria-live', 'polite');
    btn.textContent = ok ? (t('update.copied') || 'Copied!') : (t('md.copy.failed') || 'Copy failed');
    copyTimers.set(btn, window.setTimeout(() => {
        btn.classList.remove('is-copied', 'is-failed');
        btn.textContent = btn.dataset.label || t('update.copy');
        copyTimers.delete(btn);
    }, 1800));
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    ensureMdCss();
    window.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement)?.closest?.('.md-copy-btn') as HTMLElement | null;
        const block = btn?.closest('.md-code-block');
        if (!btn || !block) return;
        const code = block.querySelector('pre code') || block.querySelector('pre');
        if (!code) return;
        e.preventDefault();
        e.stopPropagation();
        // A tooltip for the pointer; the visible word stays the accessible name, so the live
        // region announces "Copied!" instead of an aria-label masking it.
        if (!btn.title) btn.title = t('md.copy.aria') || 'Copy this code to the clipboard';
        void copyText(code.textContent || '').then((ok) => flashCopy(btn, ok));
    }, true);
}

/**
 * Show one panel of a strip, and tell assistive technology which.
 *
 * Both renderers draw this markup, so the ids are assigned HERE rather than by either of
 * them: a page can hold two strips, and two `#doc-tab-0` would make every `aria-controls`
 * point at whichever came first.
 */
function selectTab(wrap: HTMLElement, i: number): void {
    const btns = [...wrap.querySelectorAll<HTMLElement>('.doc-tabs-btn')];
    const panels = [...wrap.querySelectorAll<HTMLElement>('.doc-tab')];
    if (!wrap.dataset.tabsId) {
        wrap.dataset.tabsId = `t${Math.random().toString(36).slice(2, 9)}`;
        btns.forEach((b, n) => {
            b.id = `${wrap.dataset.tabsId}-tab-${n}`;
            b.setAttribute('aria-controls', `${wrap.dataset.tabsId}-panel-${n}`);
        });
        panels.forEach((p, n) => {
            p.id = `${wrap.dataset.tabsId}-panel-${n}`;
            p.setAttribute('role', 'tabpanel');
            p.setAttribute('aria-labelledby', `${wrap.dataset.tabsId}-tab-${n}`);
        });
    }
    btns.forEach((b, n) => {
        b.classList.toggle('is-on', n === i);
        b.setAttribute('aria-selected', n === i ? 'true' : 'false');
        b.tabIndex = n === i ? 0 : -1;
    });
    // `tabIndex` on the panel too: it holds arbitrary content, and a long one has to be
    // scrollable by keyboard.
    panels.forEach((p, n) => { p.classList.toggle('is-on', n === i); p.tabIndex = n === i ? 0 : -1; });
}

/**
 * Fill in what md-lite left blank, inside `host`.
 *
 * Safe to call on a subtree with none of it: every query simply matches nothing.
 */
export function hydrateMdLite(host: HTMLElement): void {
  // B.MD 3.0 chips for the blocks that live on the website (`:counter`, `:action`, `::openapi`,
  // `::include`): the renderer leaves the words to this file, which has the dictionary.
  for (const el of Array.from(host.querySelectorAll<HTMLElement>('[data-md-webonly]'))) {
    const words = t('md.webonly') || 'Interactive on the website';
    el.setAttribute('title', words);
    if (!el.textContent?.trim()) el.textContent = words;
  }
    if (!host) return;
    // Fire and forget: KaTeX is 272 KB and nothing on the page waits for a formula. It
    // loads only when the subtree actually holds one.
    void typesetMath(host);
    // Give every strip its ids and its roving tabindex now, rather than on first click:
    // a keyboard user reaches the strip before they activate it.
    host.querySelectorAll<HTMLElement>('.doc-tabs').forEach((w) => {
        const on = [...w.querySelectorAll('.doc-tab')].findIndex((p) => p.classList.contains('is-on'));
        selectTab(w, on < 0 ? 0 : on);
    });
    host.querySelectorAll('[data-sched-title]').forEach((el) => { el.textContent = t('md.sched.hours'); });
    // The two other places md-lite leaves a word for somebody who has a dictionary.
    host.querySelectorAll('[data-md-toc-title]').forEach((el) => { el.textContent = t('md.toc.title'); });
    host.querySelectorAll('[data-md-open]').forEach((el) => { el.textContent = t('md.file.open'); });
    // B.MD 2.0: the side labels of a compare, a spoiler's summary, a default question, a
    // checklist's default title — English in no language until somebody with a dictionary
    // passes. The compare sides carry a placeholder span so the block's own attribute can
    // still win (md-lite fills it before this runs and drops the data attribute).
    host.querySelectorAll('[data-md-before]').forEach((el) => { el.textContent = t('md.before'); });
    host.querySelectorAll('[data-md-after]').forEach((el) => { el.textContent = t('md.after'); });
    host.querySelectorAll('[data-md-spoiler]').forEach((el) => { el.textContent = t('md.spoiler'); });
    host.querySelectorAll('[data-md-question]').forEach((el) => { el.textContent = t('md.question'); });
    host.querySelectorAll('[data-md-checklist]').forEach((el) => { el.textContent = t('md.checklist'); });
    // `:icon[ph:rocket]` → a mask from the Phosphor family, the same way as lucide below.
    host.querySelectorAll<HTMLElement>('.doc-icon-mask[data-ph]').forEach((el) => {
        if (el.dataset.masked) return;
        el.dataset.masked = '1';
        const src = phosphorIconUrl(String(el.dataset.ph || ''));
        if (!src) return;
        const url = `url('${src}') center/contain no-repeat`;
        el.style.webkitMask = url;
        el.style.mask = url;
    });
    // `:icon[rocket]` → a real CSS mask, so the glyph takes the colour of the text around it.
    // The name was filtered to [a-z0-9-] before it reached the attribute, so building a URL
    // from it introduces nothing; an <img> here would be flat black on a dark page.
    host.querySelectorAll<HTMLElement>('.doc-icon-mask[data-lucide]').forEach((el) => {
        const name = String(el.dataset.lucide || '').replace(/[^a-z0-9-]/g, '');
        if (!name || el.dataset.masked) return;
        el.dataset.masked = '1';
        const src = lucideIconUrl(name);
        if (!src) return;   // remote icons are off
        const url = `url('${src}') center/contain no-repeat`;
        el.style.webkitMask = url;
        el.style.mask = url;
    });
    host.querySelectorAll('[data-sched-note]').forEach((el) => {
        const tz = el.getAttribute('data-sched-note') || '';
        const { dir, here, span } = zoneDelta(tz);
        // Same zone as the reader: there is nothing to say, and an empty line says it worse
        // than no line at all.
        if (dir === 'none') { el.remove(); return; }
        el.textContent = dir === 'same'
            ? t('md.sched.same', { here, tz })
            : t(dir === 'ahead' ? 'md.sched.ahead' : 'md.sched.behind', { here, tz, span });
    });
}
