// Two things a text box does not give you: where you are, and what that word means.
//
// The scheduler's code pane is a <textarea> with a highlighted mirror behind it. That is a
// deliberate arrangement (see ui/code-editor.ts) and it is not going to become a
// contenteditable editor — but it does mean neither of the two things people expect from an
// editor comes for free.
//
// **Where you are** is an outline: the statements, nested, clickable. Built by scanning lines
// rather than by compiling, because an outline has to work while the script is broken. The
// moment you most want to see the shape of something is halfway through changing it, and a
// compiler answers "no" to that.
//
// **What that word means** is a hover. The mirror already holds one <span> per token with a
// real bounding box, so the word under the pointer is found by hit-testing those rather than
// by measuring the textarea's font — which is the version that breaks on the first theme with
// a different one.

import { t } from '../../core/i18n.js';
import { escHtml } from '../../core/utils.js';
import { BMMS_INDEX, BMMS_KEYWORDS } from '../../docs/bmms-reference.gen.js';

/** One line worth showing in the outline. */
export interface OutlineRow {
    /** 0-based line in the textarea. */
    line: number;
    /** How deeply nested, from the leading whitespace. */
    depth: number;
    /** `task` · `do` · `if` · `loop` · `ensure` · `try` · `switch` · `wait` · `set` · `call` · `print` */
    kind: string;
    /** What to show: the action name, the condition, the variable. */
    text: string;
}

/** The words that open a structure, and what to call each in the outline. */
const HEADS: [RegExp, string][] = [
    [/^task\b/, 'task'],
    [/^do\s+([a-zA-Z0-9._]+)/, 'do'],
    [/^if\b/, 'if'],
    [/^else\b/, 'if'],
    [/^ensure\b/, 'ensure'],
    [/^(repeat|for)\b/, 'loop'],
    [/^try\b/, 'try'],
    [/^catch\b/, 'try'],
    [/^switch\b/, 'switch'],
    [/^case\b/, 'switch'],
    [/^(wait|waitfor)\b/, 'wait'],
    [/^(shared\s+)?set\b/, 'set'],
    [/^call\b/, 'call'],
    [/^print\b/, 'print'],
    [/^(run|spawn)\b/, 'call'],
];

/**
 * The shape of a script, line by line.
 *
 * Scanned, not compiled. An outline that disappears the moment the script does not parse is an
 * outline you cannot use while writing — and writing is the only time you need it.
 *
 * Depth comes from the leading whitespace, which is what the eye uses too. A script indented
 * inconsistently gets an outline that matches what it LOOKS like, which is the honest answer:
 * the compiler reads braces, and if those disagree with the indentation, seeing that is the
 * point.
 */
export function outlineOf(source: string): OutlineRow[] {
    const rows: OutlineRow[] = [];
    const lines = String(source).split('\n');
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
        // A bare closing brace is structure, not a statement: showing it would double every
        // block in the list.
        if (/^[}\])]+$/.test(trimmed)) continue;
        // `} else {` and `} catch {` close one branch and open the next on one line, which is
        // how the printer writes them and how everybody types them. Matching the head against
        // the raw line would miss both — and an outline with no `else` in it is an outline
        // that quietly lies about the shape of every branching script.
        const head = trimmed.replace(/^[}\])]+\s*/, '');
        for (const [re, kind] of HEADS) {
            const m = head.match(re);
            if (!m) continue;
            const indent = raw.length - raw.trimStart().length;
            rows.push({
                line: i,
                depth: Math.floor(indent / 4),
                kind,
                // The whole statement, minus the trailing brace, capped. A row is a signpost;
                // the code is two centimetres to the left.
                text: head.replace(/\s*\{\s*$/, '').slice(0, 90),
            });
            break;
        }
    }
    return rows;
}

/** Where a line starts in the text, for putting the caret there. */
export function offsetOfLine(source: string, line: number): number {
    const lines = String(source).split('\n');
    let at = 0;
    for (let i = 0; i < line && i < lines.length; i++) at += lines[i].length + 1;
    return at;
}

/**
 * What one word means, or null when there is nothing worth saying.
 *
 * Actions and conditions come from the generated index, so the explanation is the same
 * sentence the block editor and the docs use. Keywords get a line each, from i18n. A word that
 * is neither gets nothing — a tooltip that says "this is a word" trains people to ignore
 * tooltips.
 */
export function explain(word: string): { title: string; body: string } | null {
    const w = word.trim();
    if (!w) return null;

    const entry = BMMS_INDEX.find((e) => e.n === w);
    if (entry) {
        const label = entry.k === 'a' ? t('sched.act.' + entry.n) : entry.k === 'c' ? t('sched.cond.' + entry.n) : '';
        const desc = entry.k === 'a' ? t('sched.actd.' + entry.n) : '';
        const params = (entry.p || []).join(', ');
        return {
            title: label && label !== 'sched.act.' + entry.n ? label : w,
            body: [desc, params ? `${t('sched.hover.params')} ${params}` : ''].filter(Boolean).join('\n'),
        };
    }
    const lower = w.toLowerCase();
    if (BMMS_KEYWORDS.includes(lower)) {
        const key = 'sched.kw.' + lower;
        const said = t(key);
        // t() returns the key when there is no entry, which would put "sched.kw.orcontinue" on
        // screen. Better to say only the word than to say the name of a missing string.
        return { title: lower, body: said === key ? '' : said };
    }
    return null;
}

/**
 * The word under the pointer, from the highlighted mirror's own boxes.
 *
 * The mirror sits behind the textarea and holds one element per token. Hit-testing their real
 * rectangles is exact and needs nothing about the font; measuring the textarea by character
 * width is the version that is wrong for the first person who changes the theme.
 *
 * Only elements with no element children are considered — Prism nests tokens, and a parent
 * span covers its children's boxes, so taking the outermost hit would return a whole line.
 */
export function wordAtPoint(mirror: HTMLElement, x: number, y: number): string | null {
    return wordBoxAtPoint(mirror, x, y)?.word ?? null;
}

/**
 * The same hit test, keeping the box it found.
 *
 * The rectangle was already computed and thrown away, and it is the piece that matters for
 * placing anything: an explanation anchored to the POINTER sits wherever the mouse happened
 * to stop, which on a wide editor is a long way from the word it is about. Anchored to the
 * token, it points at the thing it explains.
 */
export function wordBoxAtPoint(
    mirror: HTMLElement, x: number, y: number,
): { word: string; rect: DOMRect } | null {
    const leaves = mirror.querySelectorAll<HTMLElement>('code *');
    for (const el of leaves) {
        if (el.childElementCount > 0) continue;
        const r = el.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            const txt = (el.textContent || '').trim();
            return txt.length && txt.length < 60 ? { word: txt, rect: r } : null;
        }
    }
    return null;
}

/** Render an outline into a host, and call back with the line to jump to. */
export function renderOutline(host: HTMLElement, rows: OutlineRow[], onPick: (line: number) => void): void {
    if (!rows.length) {
        host.innerHTML = `<p class="bo-none">${escHtml(t('sched.outline.none'))}</p>`;
        return;
    }
    host.innerHTML = rows.map((r, i) => `<button type="button" class="bo-row" data-i="${i}"
            style="padding-left:${6 + Math.min(r.depth, 6) * 12}px" title="${escHtml(r.text)}">
        <span class="bo-kind bo-${escHtml(r.kind)}">${escHtml(r.kind)}</span>
        <span class="bo-text">${escHtml(r.text)}</span>
        <span class="bo-line">${r.line + 1}</span>
    </button>`).join('');
    host.querySelectorAll<HTMLElement>('.bo-row').forEach((el) => {
        el.addEventListener('click', () => onPick(rows[parseInt(el.dataset.i || '0', 10)].line));
    });
}
