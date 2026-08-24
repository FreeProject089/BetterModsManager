// Custom tutorials: .bmmtut documents turned into the same TutorialDef the engine runs.
//
// THE TRICK, AND WHY IT IS SAFE TO CALL IT ONE
//
// The engine resolves every string through t(), because official tutorials ship as i18n
// keys. A custom tutorial carries LITERAL text — so this module materialises runtime keys
// (`ctut.<id>.<path>`) into an additive i18n overlay, per language, and hands the engine a
// definition made of those keys. The engine runs a shared tutorial without one line of it
// changing, which means the two kinds cannot drift in behaviour: there is only one engine.
//
// THE PART THAT IS NOT OPTIONAL
//
// Step text is interpolated as HTML by the engine — official steps use <b> and <ul> on
// purpose. A shared file is therefore an XSS vector unless its text is sanitised, HERE, at
// definition-build time: every fragment goes through a DOM pass that keeps a small whitelist
// of formatting tags and drops everything else, attributes included. The icon is not raw SVG
// from the file either — a fixed glyph is used, because "sanitise arbitrary SVG" is a
// project, not a line.

import { invoke, pickFile, saveFile } from '../core/api.js';
import { compileCondition } from './tutorial-expr.js';
import { registerRuntimeTexts, getLang, t } from '../core/i18n.js';
import type { TutorialDef } from './tutorial-types.js';

/** One language's text, with English as the always-present base. */
interface LText { en: string; fr?: string }

export interface CustomTutorialDoc {
    format: 'bmmtut';
    version?: number;
    id: string;
    title: LText;
    desc?: LText;
    color?: string;
    parts: Array<{
        id: string;
        title?: LText;
        steps: Array<{
            id: string;
            title?: LText;
            text?: LText;
            nav?: string;
            selector?: string;
            selectors?: string[];
            optional?: boolean;
            action?: { event: string; desc?: LText };
            /** A condition to satisfy before Next unlocks. `kind:'action'` names one of the
             *  app's own moments; the others are watched here. */
            wait?: {
                kind: 'action' | 'click' | 'appear' | 'disappear' | 'view'
                    | 'text' | 'value' | 'enabled' | 'custom';
                event?: string;      // kind 'action'
                selector?: string;   // click | appear | disappear | text | value | enabled
                view?: string;       // kind 'view'
                /** kind 'text' | 'value': what to wait for. Empty means "anything at all",
                 *  which is what "until the box is filled in" means. */
                text?: string;
                /** kind 'custom': a JS expression, true when the step is done. */
                expr?: string;
                desc?: LText;
            };
        }>;
    }>;
    bmm_signature?: unknown;
}

// ── sanitising ───────────────────────────────────────────────────────────────

/** Formatting only. Anything that can carry a handler, a URL or a style is not on it. */
const ALLOWED_TAGS = new Set(['B', 'I', 'STRONG', 'EM', 'U', 'BR', 'UL', 'OL', 'LI', 'CODE', 'KBD', 'P', 'SPAN']);

/**
 * Strip a fragment to the whitelist. Rebuilt node by node rather than regex-scrubbed:
 * a regex over HTML is the classic half-measure, and the DOM already knows the structure.
 * Attributes are dropped wholesale — none of the allowed tags needs any.
 */
export function sanitizeStepHtml(html: string): string {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstElementChild as HTMLElement;
    const walk = (node: Element): string => {
        let out = '';
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) {
                out += (child.textContent || '')
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const el = child as Element;
                if (ALLOWED_TAGS.has(el.tagName)) {
                    const tag = el.tagName.toLowerCase();
                    out += el.tagName === 'BR' ? '<br>' : `<${tag}>${walk(el)}</${tag}>`;
                } else if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'TEMPLATE') {
                    // Dropped WITH their content. Their text is code, not prose — keeping it
                    // renders "alert(1)" in the middle of a step, inert but baffling.
                } else {
                    // Any other tag goes, its TEXT stays: a paragraph wrapped in a <div>
                    // should not vanish, and silently eating content is how "my tutorial is
                    // blank" bug reports are made.
                    out += walk(el);
                }
            }
        }
        return out;
    };
    return root ? walk(root) : '';
}

// ── keys ─────────────────────────────────────────────────────────────────────

const keyOf = (id: string, path: string) => `ctut.${id}.${path}`;

/**
 * Build the runtime definition + overlay texts from a stored document.
 *
 * The overlay is registered per language: French uses `fr` when the document has one and
 * falls back to English — a tutorial written in one language stays whole rather than half
 * its steps turning into raw keys.
 */
export function toDef(doc: CustomTutorialDoc): TutorialDef {
    const texts: { en: Record<string, string>; fr: Record<string, string> } = { en: {}, fr: {} };
    const put = (path: string, v: LText | undefined, fallback = '') => {
        const key = keyOf(doc.id, path);
        const en = sanitizeStepHtml(v?.en ?? fallback);
        texts.en[key] = en;
        texts.fr[key] = v?.fr ? sanitizeStepHtml(v.fr) : en;
        return key;
    };

    const def: TutorialDef = {
        id: `custom:${doc.id}`,
        title_key: put('title', doc.title, doc.id),
        desc_key: put('desc', doc.desc),
        // A fixed glyph. The document's own SVG would need real sanitising to be safe in
        // innerHTML, and a wrong icon is a smaller cost than a right exploit.
        icon: '<path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
        color: /^#[0-9a-fA-F]{3,8}$/.test(doc.color || '') ? (doc.color as string) : 'var(--accent)',
        parts: doc.parts.map((p, pi) => ({
            id: p.id || `p${pi}`,
            title_key: put(`p${pi}.title`, p.title, p.id || `Part ${pi + 1}`),
            steps: p.steps.map((st, si) => ({
                id: st.id || `s${si}`,
                title_key: put(`p${pi}.s${si}.title`, st.title, st.id || `Step ${si + 1}`),
                text_key: put(`p${pi}.s${si}.text`, st.text),
                ...(st.nav ? { nav: st.nav } : {}),
                ...(st.selector ? { selector: st.selector } : {}),
                ...(st.selectors?.length ? { selectors: st.selectors } : {}),
                ...(st.optional ? { optional: true } : {}),
                // `wait` first, `action` as the older spelling. A watched condition is handed
                // to the engine as an ordinary event name — it cannot tell the difference, and
                // that is what keeps one engine running both kinds of tutorial.
                ...(st.wait && (st.wait.kind !== 'action' || st.wait.event)
                    ? {
                        action: {
                            event: st.wait.kind === 'action'
                                ? (st.wait.event as string)
                                : `ctut:${doc.id}:${pi}:${si}`,
                            desc_key: put(`p${pi}.s${si}.action`, st.wait.desc),
                        },
                    }
                    : st.action?.event
                        ? { action: { event: st.action.event, desc_key: put(`p${pi}.s${si}.action`, st.action.desc) } }
                        : {}),
            })),
        })),
    };
    registerRuntimeTexts('en', texts.en);
    registerRuntimeTexts('fr', texts.fr);
    return def;
}

// ── watched conditions ───────────────────────────────────────────────────────

/** One armed watcher, and how to take it back down. */
type Disarm = () => void;
let _armed: Disarm[] = [];

/** Take every watcher down. Called before arming a tutorial and when one ends. */
export function disarmWatchers(): void {
    for (const off of _armed) { try { off(); } catch { /* already gone */ } }
    _armed = [];
}

/** The synthetic event a watched condition fires. Unique per step, so two steps watching the
 *  same selector never satisfy each other. */
const watchEvent = (docId: string, pi: number, si: number) => `ctut:${docId}:${pi}:${si}`;

/**
 * Arm the watchers a stored tutorial needs.
 *
 * Armed when a tutorial STARTS rather than when its definition is built: a MutationObserver
 * per step, running for every custom tutorial the hub has ever listed, would be a standing
 * cost for a feature nobody is using at that moment. Firing early is harmless — the engine
 * only listens while the step is on screen.
 */
export function armWatchers(doc: CustomTutorialDoc): void {
    disarmWatchers();
    doc.parts.forEach((p, pi) => p.steps.forEach((st, si) => {
        const w = st.wait;
        if (!w || w.kind === 'action') return;
        const name = watchEvent(doc.id, pi, si);
        const fire = () => document.dispatchEvent(new CustomEvent(name));

        if (w.kind === 'click' && w.selector) {
            const sel = w.selector;
            const onClick = (e: Event) => {
                const target = e.target as Element | null;
                // `closest`, not `matches`: a reader clicks the label or the icon inside a
                // button far more often than the button's own box.
                if (target?.closest?.(sel)) fire();
            };
            document.addEventListener('click', onClick, true);
            _armed.push(() => document.removeEventListener('click', onClick, true));
            return;
        }

        if ((w.kind === 'appear' || w.kind === 'disappear') && w.selector) {
            const sel = w.selector;
            const want = w.kind === 'appear';
            // Visibility, not mere presence: this app keeps its modals in the DOM and hides
            // them, so "does it exist" answers yes for every dialog in the application.
            const there = () => {
                const n = document.querySelector(sel) as HTMLElement | null;
                if (!n) return false;
                const cs = getComputedStyle(n);
                return cs.display !== 'none' && cs.visibility !== 'hidden';
            };
            let last = there();
            const obs = new MutationObserver(() => {
                const now = there();
                if (now === last) return;
                last = now;
                if (now === want) fire();
            });
            obs.observe(document.body, { childList: true, subtree: true, attributes: true,
                attributeFilter: ['class', 'style', 'hidden'] });
            _armed.push(() => obs.disconnect());
            return;
        }

        // ── content conditions ──
        //
        // All three watch the same way: a MutationObserver over the document, and a
        // predicate re-evaluated whenever anything changes. `characterData` is in the filter
        // because a counter that goes 11 -> 12 changes no element and no attribute — only
        // the text node — and without it the most obvious of these would never fire.
        if ((w.kind === 'text' || w.kind === 'value' || w.kind === 'enabled') && w.selector) {
            const sel = w.selector;
            const want = (w.text || '').trim().toLowerCase();
            const test = (): boolean => {
                const n = document.querySelector(sel) as HTMLElement | null;
                if (!n) return false;
                if (w.kind === 'enabled') {
                    return !(n as HTMLButtonElement).disabled
                        && n.getAttribute('aria-disabled') !== 'true'
                        && !n.classList.contains('disabled');
                }
                const got = (w.kind === 'value'
                    ? String((n as HTMLInputElement).value ?? '')
                    : (n.textContent || '')).trim().toLowerCase();
                // No target text means "anything non-empty" — the form-filling case.
                return want ? got.includes(want) : got.length > 0;
            };
            let last = test();
            const obs = new MutationObserver(() => {
                const now = test();
                if (now && !last) fire();
                last = now;
            });
            obs.observe(document.body, {
                childList: true, subtree: true, attributes: true, characterData: true,
            });
            // An <input> fires no mutation when a person types into it — its `value` is a
            // property, not an attribute — so the same predicate is also polled from input
            // events. Both paths, because a value can also be set by code.
            const onInput = () => { const now = test(); if (now && !last) fire(); last = now; };
            if (w.kind === 'value') document.addEventListener('input', onInput, true);
            _armed.push(() => { obs.disconnect(); document.removeEventListener('input', onInput, true); });
            return;
        }

        if (w.kind === 'custom' && w.expr) {
            // Parsed, not eval'd. `new Function` is blocked by BMM's own CSP — the first
            // version of this failed silently in the app while working in a devtools probe,
            // because devtools is exempt from the page policy and the page is not. Adding
            // 'unsafe-eval' to ship a tutorial convenience would have been a bad trade.
            let fn: (() => boolean) | null = null;
            try { fn = compileCondition(w.expr); }
            catch (e) {
                console.warn('[tutorial] condition did not parse:', (e as Error).message);
                return;
            }
            const test = fn;
            let last = test();
            const obs = new MutationObserver(() => {
                const now = test();
                if (now && !last) fire();
                last = now;
            });
            obs.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
            // A typed value changes no attribute and no text node, so input events are
            // watched too; clicks because a condition can turn on as a side effect of one.
            const onAny = () => { const now = test(); if (now && !last) fire(); last = now; };
            document.addEventListener('input', onAny, true);
            document.addEventListener('click', onAny, true);
            _armed.push(() => {
                obs.disconnect();
                document.removeEventListener('input', onAny, true);
                document.removeEventListener('click', onAny, true);
            });
            return;
        }

        if (w.kind === 'view' && w.view) {
            const id = `view-${w.view}`;
            const shown = () => {
                const n = document.getElementById(id);
                return !!n && getComputedStyle(n).display !== 'none';
            };
            let last = shown();
            const obs = new MutationObserver(() => {
                const now = shown();
                if (now && !last) fire();
                last = now;
            });
            obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
            _armed.push(() => obs.disconnect());
        }
    }));
}

// ── store front ──────────────────────────────────────────────────────────────

let _docs: CustomTutorialDoc[] = [];

export async function loadCustomTutorials(): Promise<TutorialDef[]> {
    try {
        _docs = ((await invoke('tutorial_custom_list')) as CustomTutorialDoc[]) || [];
    } catch {
        _docs = [];
    }
    return _docs.map(toDef);
}

export function getCustomDoc(id: string): CustomTutorialDoc | null {
    return _docs.find((d) => d.id === id) || null;
}

export async function deleteCustomTutorial(id: string): Promise<void> {
    await invoke('tutorial_custom_delete', { id });
    _docs = _docs.filter((d) => d.id !== id);
}

/** File-picker import. Returns the signature verdict, for the hub to show. */
export async function importCustomTutorialFromFile(): Promise<{ id: string; signature: string } | null> {
    const path = await pickFile([{ name: 'BMM tutorial', extensions: ['bmmtut', 'json'] }]);
    if (!path) return null;
    const text = (await invoke('read_file_text', { path })) as string;
    const res = (await invoke('tutorial_custom_import', { text })) as { doc: CustomTutorialDoc; signature: string };
    return { id: res.doc.id, signature: res.signature };
}

/** Import from already-fetched text (a catalogue install). */
export async function importCustomTutorialText(text: string): Promise<{ id: string; signature: string }> {
    const res = (await invoke('tutorial_custom_import', { text })) as { doc: CustomTutorialDoc; signature: string };
    return { id: res.doc.id, signature: res.signature };
}

/** Export one to a .bmmtut the user can share. The stored bytes ARE the export — signed at
 *  save time, so what travels is what verify_doc vouched for. */
export async function exportCustomTutorial(id: string): Promise<string | null> {
    const doc = getCustomDoc(id);
    if (!doc) return null;
    const path = await saveFile({ defaultPath: `${doc.id}.bmmtut`, filters: [{ name: 'BMM tutorial', extensions: ['bmmtut'] }] });
    if (!path) return null;
    await invoke('write_text_file', { path, content: JSON.stringify(doc, null, 2) });
    return path;
}

/** The label the hub prints for a signature verdict. */
export function signatureLabel(sig: string): { text: string; tone: 'ok' | 'warn' | 'err' } {
    if (sig === 'valid') return { text: t('tuthub.sigValid'), tone: 'ok' };
    if (sig === 'unsigned') return { text: t('tuthub.sigUnsigned'), tone: 'warn' };
    return { text: t('tuthub.sigInvalid'), tone: 'err' };
}
