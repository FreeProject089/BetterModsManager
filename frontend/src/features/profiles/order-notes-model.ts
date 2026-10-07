// A saved order list's notes, as data: the size rule, the toolbar's edits, and the pass that
// takes every network fetch out of an IMPORTED list's rendered notes. No DOM, no imports, so
// tests/order-notes.test.mjs runs it in plain node.
//
// The rules themselves are the backend's (src-tauri/src/commands/order_lists.rs): notes are
// B.MD source, line breaks kept, at most MAX_NOTES characters, refused beyond. This module
// counts the same way so the counter under the editor and the backend agree.

/** The most a list's notes may hold, in characters (`order_share::MAX_NOTES`). */
export const NOTES_MAX = 20_000;

/** Notes as the backend counts them: `\r\n` and `\r` are one line break, characters are code points. */
export function notesLength(src: string): number {
    return [...String(src || '').replace(/\r\n?/g, '\n')].length;
}

export type NotesFill = 'ok' | 'near' | 'over';

/** Where a length stands against the cap: `near` from 90 %, `over` past it. */
export function notesFill(len: number, max = NOTES_MAX): NotesFill {
    if (len > max) return 'over';
    return len >= max * 0.9 ? 'near' : 'ok';
}

// ── Imported notes: nothing fetched from the network ──────────────────────────────────────

/** Elements whose whole point is a fetch, dropped with what is inside them. */
const DROP_BLOCK = ['iframe', 'video', 'audio', 'object', 'embed', 'picture', 'frame', 'frameset'];
/** The same, as a lone or void tag (`<source>`, `<embed>`, a `<video … />`). */
const DROP_VOID = ['source', 'track', 'embed', 'iframe', 'video', 'audio', 'object', 'picture', 'image', 'link', 'meta', 'base'];
/** Attributes that make the renderer, the hydrator or the browser fetch something. */
const DROP_ATTR = new Set(['src', 'srcset', 'poster', 'background', 'data-src', 'data-lucide', 'data-ph', 'lowsrc', 'dynsrc', 'xlink:href']);
/** A style value that loads something. */
const FETCHING_STYLE = /url\s*\(|image-set\s*\(|@import|expression\s*\(/i;

/**
 * md-lite's markup (`renderDocMarkup`) with every network fetch taken out, for notes that came
 * from somebody else: an image becomes its alt text, a video, an audio clip, an embed or a
 * frame disappears, an icon that would be fetched from a CDN stays an empty box, a style that
 * loads a URL goes. What is left is local: text, tables, callouts, code, maths, diagrams.
 *
 * String-level on purpose, and only correct on md-lite's OWN output, where every attribute
 * value is double-quoted and every `<` and `>` in text or in a value is escaped: there, every
 * `<` starts a tag. The sanitiser (md-safe.ts) runs after this, and the DOM pass in
 * order-notes.ts after that; this is the first of three nets, not the only one.
 */
export function offlineMarkup(html: string): string {
    let out = String(html || '');
    for (const tag of DROP_BLOCK) {
        out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '');
    }
    out = out.replace(new RegExp(`<\\/?(?:${DROP_VOID.join('|')})\\b[^>]*>`, 'gi'), '');
    // An image keeps what it says, as text: its alt (already escaped by the renderer).
    out = out.replace(/<img\b([^>]*)>/gi, (_m, attrs: string) => {
        const alt = /\salt="([^"]*)"/i.exec(attrs)?.[1] || '';
        return alt ? `<span class="olm-img-alt">${alt}</span>` : '';
    });
    // The frames those leave behind (a 16:9 box for a video that is not there) go too.
    out = out.replace(/<(div|figure|span)\s+class="[^"]*\b(?:doc-embed|doc-card-media|doc-hero-media|doc-audio)\b[^"]*"[^>]*>\s*<\/\1>/g, '');
    return out.replace(/<([a-zA-Z][\w-]*)(\s[^>]*?)?(\/?)>/g, (_m, tag: string, attrs: string | undefined, slash: string) => {
        if (!attrs) return `<${tag}${slash}>`;
        const kept = attrs.replace(/\s([^\s="'>/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g, (whole, name: string, value: string | undefined) => {
            const n = name.toLowerCase();
            if (DROP_ATTR.has(n) || n.startsWith('on')) return '';
            if (n === 'style' && value && FETCHING_STYLE.test(value)) return '';
            return whole;
        });
        return `<${tag}${kept}${slash}>`;
    });
}

// ── The editor's toolbar ───────────────────────────────────────────────────────────────────

export type FormatKind =
    | 'h2' | 'h3' | 'bold' | 'italic' | 'strike' | 'code' | 'link'
    | 'ul' | 'ol' | 'task' | 'quote' | 'codeblock' | 'table' | 'hr'
    | 'note' | 'tip' | 'warning' | 'danger' | 'details' | 'steps' | 'mermaid' | 'math';

export const FORMAT_KINDS: readonly FormatKind[] = [
    'h2', 'h3', 'bold', 'italic', 'strike', 'code', 'link',
    'ul', 'ol', 'task', 'quote', 'codeblock', 'table', 'hr',
    'note', 'tip', 'warning', 'danger', 'details', 'steps', 'mermaid', 'math',
];

export interface Edit { value: string; start: number; end: number }

/** Wrap the selection in `left`/`right`; with nothing selected, insert `placeholder` selected. */
function wrap(v: string, s: number, e: number, left: string, right: string, placeholder: string): Edit {
    const sel = v.slice(s, e) || placeholder;
    // Already wrapped: unwrap (a second click on Bold takes the bold off).
    if (v.slice(s - left.length, s) === left && v.slice(e, e + right.length) === right && e > s) {
        const value = v.slice(0, s - left.length) + v.slice(s, e) + v.slice(e + right.length);
        return { value, start: s - left.length, end: e - left.length };
    }
    const value = v.slice(0, s) + left + sel + right + v.slice(e);
    return { value, start: s + left.length, end: s + left.length + sel.length };
}

/** The whole lines the selection touches. */
function lineSpan(v: string, s: number, e: number): [number, number] {
    const a = v.lastIndexOf('\n', Math.max(0, s - 1)) + 1;
    const nl = v.indexOf('\n', Math.max(s, e - (e > s && v[e - 1] === '\n' ? 1 : 0)));
    return [s === 0 ? 0 : a, nl < 0 ? v.length : nl];
}

/** Prefix every line the selection touches (`- `, `1. `, `> `, `## `…); prefixed already: remove it. */
function prefixLines(v: string, s: number, e: number, prefix: (i: number) => string, strip: RegExp, on: RegExp = strip): Edit {
    const [a, b] = lineSpan(v, s, e);
    const lines = v.slice(a, b).split('\n');
    // Every line already says it (`on`): take it off. Otherwise put it on, replacing a sibling
    // form (`strip`): a level-2 heading made level 3 is replaced, not stacked.
    const all = lines.every((l) => on.test(l));
    const next = lines.map((l, i) => (all ? l.replace(strip, '') : prefix(i) + l.replace(strip, ''))).join('\n');
    const value = v.slice(0, a) + next + v.slice(b);
    return { value, start: a, end: a + next.length };
}

/** A block on lines of its own, a blank line around it; the `focus` part comes back selected. */
function block(v: string, s: number, e: number, before: string, focus: string, after: string): Edit {
    const sel = v.slice(s, e);
    const mid = sel || focus;
    const lead = s === 0 || v.slice(0, s).endsWith('\n\n') ? '' : v.slice(0, s).endsWith('\n') ? '\n' : '\n\n';
    const tail = v.slice(e).startsWith('\n\n') || e === v.length ? '' : v.slice(e).startsWith('\n') ? '\n' : '\n\n';
    const text = `${lead}${before}${mid}${after}${tail}`;
    const value = v.slice(0, s) + text + v.slice(e);
    const start = s + lead.length + before.length;
    return { value, start, end: start + mid.length };
}

/**
 * One toolbar action on `value` with the selection `start…end`: the new text and what to
 * select after it. Pure, so the toolbar and its tests read the same function. `words` are the
 * placeholder texts in the reader's language (`text`, `url`, `title`, `item`, `code`).
 */
export function applyFormat(value: string, start: number, end: number, kind: FormatKind, words: Partial<Record<'text' | 'url' | 'title' | 'item' | 'code', string>> = {}): Edit {
    const v = String(value ?? '');
    const s = Math.max(0, Math.min(start, end, v.length));
    const e = Math.max(s, Math.min(Math.max(start, end), v.length));
    const w = { text: 'text', url: 'https://', title: 'Title', item: 'item', code: 'code', ...words };
    switch (kind) {
        case 'bold': return wrap(v, s, e, '**', '**', w.text);
        case 'italic': return wrap(v, s, e, '*', '*', w.text);
        case 'strike': return wrap(v, s, e, '~~', '~~', w.text);
        case 'code': return wrap(v, s, e, '`', '`', w.code);
        case 'link': {
            const sel = v.slice(s, e) || w.text;
            const text = `[${sel}](${w.url})`;
            const at = s + sel.length + 3;
            return { value: v.slice(0, s) + text + v.slice(e), start: at, end: at + w.url.length };
        }
        case 'h2': return prefixLines(v, s, e, () => '## ', /^#{1,6}\s+/, /^##\s+/);
        case 'h3': return prefixLines(v, s, e, () => '### ', /^#{1,6}\s+/, /^###\s+/);
        case 'ul': return prefixLines(v, s, e, () => '- ', /^\s*[-*+]\s+(?!\[[ xX]\])/);
        case 'ol': return prefixLines(v, s, e, (i) => `${i + 1}. `, /^\s*\d+[.)]\s+/);
        case 'task': return prefixLines(v, s, e, () => '- [ ] ', /^\s*[-*+]\s+\[[ xX]\]\s+/);
        case 'quote': return prefixLines(v, s, e, () => '> ', /^>\s?/);
        case 'codeblock': return block(v, s, e, '```\n', w.code, '\n```');
        case 'hr': return block(v, s, s, '', '', '---');
        case 'table': return block(v, s, e, '', `| ${w.title} | ${w.title} |`, '\n| --- | --- |\n|  |  |');
        case 'note': case 'tip': case 'warning': case 'danger':
            return block(v, s, e, `:::${kind}\n`, w.text, '\n:::');
        case 'details': return block(v, s, e, `:::details[${w.title}]\n`, w.text, '\n:::');
        case 'steps': return block(v, s, e, `:::steps\n:::step[${w.title}]\n`, w.text, '\n:::\n:::');
        case 'math': return block(v, s, e, '$$\n', 'E = mc^2', '\n$$');
        case 'mermaid': return block(v, s, e, '```mermaid\n', 'flowchart LR\n  A[Mod A] --> B[Mod B]', '\n```');
        default: return { value: v, start: s, end: e };
    }
}

/** The keyboard shortcuts of the editor's field (Ctrl/⌘ + key). */
export const FORMAT_KEYS: Readonly<Record<string, FormatKind>> = { b: 'bold', i: 'italic', k: 'link', e: 'code' };
