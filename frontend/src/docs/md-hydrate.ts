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
        wrap.querySelectorAll('.doc-tabs-btn').forEach((b, n) => {
            b.classList.toggle('is-on', n === i);
            b.setAttribute('aria-selected', n === i ? 'true' : 'false');
        });
        wrap.querySelectorAll('.doc-tab').forEach((pnl, n) => pnl.classList.toggle('is-on', n === i));
    });
}

/**
 * Fill in what md-lite left blank, inside `host`.
 *
 * Safe to call on a subtree with none of it: every query simply matches nothing.
 */
export function hydrateMdLite(host: HTMLElement): void {
    if (!host) return;
    // Fire and forget: KaTeX is 272 KB and nothing on the page waits for a formula. It
    // loads only when the subtree actually holds one.
    void typesetMath(host);
    host.querySelectorAll('[data-sched-title]').forEach((el) => { el.textContent = t('md.sched.hours'); });
    // The two other places md-lite leaves a word for somebody who has a dictionary.
    host.querySelectorAll('[data-md-toc-title]').forEach((el) => { el.textContent = t('md.toc.title'); });
    host.querySelectorAll('[data-md-open]').forEach((el) => { el.textContent = t('md.file.open'); });
    // `:icon[rocket]` → a real CSS mask, so the glyph takes the colour of the text around it.
    // The name was filtered to [a-z0-9-] before it reached the attribute, so building a URL
    // from it introduces nothing; an <img> here would be flat black on a dark page.
    host.querySelectorAll<HTMLElement>('.doc-icon-mask[data-lucide]').forEach((el) => {
        const name = String(el.dataset.lucide || '').replace(/[^a-z0-9-]/g, '');
        if (!name || el.dataset.masked) return;
        el.dataset.masked = '1';
        const url = `url('https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/${name}.svg') center/contain no-repeat`;
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
