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
                ...(st.action?.event ? {
                    action: { event: st.action.event, desc_key: put(`p${pi}.s${si}.action`, st.action.desc) },
                } : {}),
            })),
        })),
    };
    registerRuntimeTexts('en', texts.en);
    registerRuntimeTexts('fr', texts.fr);
    return def;
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
