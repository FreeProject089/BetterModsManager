#!/usr/bin/env node
// One focus ring per text field. A text field (an <input> that takes typed text, a <textarea>,
// a <select>) shows its focus through its own style: a border + glow (.form-input:focus,
// .input:focus) or the ring of the wrapper it sits in (.search-box:focus-within,
// .ipk-searchwrap:focus-within, …), which then sets `outline: none` on the field.
//
// What broke it (Oct 2026): the modal shell added
//     .modal :is(button, …, input, select, textarea):focus-visible { outline: 2px solid … }
// A text field matches :focus-visible on a MOUSE click too (the browser always shows where the
// caret is), and at (0,3,0) that rule beat every field's own `outline: none` at (0,1,1): every
// search box in a dialog drew a square outline inside its wrapper's rounded ring.
//
// What fails: a :focus / :focus-visible rule that draws an outline on a GENERIC selector that
// can reach a text field — a bare `input` / `textarea` / `select` (an input restricted to a box,
// a radio, a slider… by [type=…] is fine), a universal `:focus-visible` / `*:focus`, or an
// attribute-only compound such as `[tabindex]` — unless it excludes the fields with
// :not(input, textarea, select). A rule on a CLASS (`.dbg-input:focus-visible`) is the field's
// own style and is not judged here.
//
// Usage: node scripts/check-focus-rings.mjs            (exit 1 on a finding)
// The pure parts are exported for tests/focus-rings.test.mjs.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS_DIR = join(ROOT, 'frontend', 'css');

const NON_TEXT_TYPES = /\[\s*type\s*=\s*["']?(checkbox|radio|range|color|file|button|submit|reset|image|hidden)["']?\s*\]/i;
const TEXT_ROLES = /\[\s*role\s*=\s*["']?(textbox|searchbox|combobox)["']?\s*\]/i;

/** Remove comments, leaving strings alone (a "/*" inside content: "…" is not a comment). */
export function stripComments(css) {
    let out = '';
    for (let i = 0; i < css.length; i++) {
        const c = css[i];
        if (c === '"' || c === "'") {
            let j = i + 1;
            while (j < css.length && css[j] !== c) { if (css[j] === '\\') j++; j++; }
            out += css.slice(i, j + 1);
            i = j;
            continue;
        }
        if (c === '/' && css[i + 1] === '*') {
            const end = css.indexOf('*/', i + 2);
            const stop = end < 0 ? css.length : end + 2;
            out += css.slice(i, stop).replace(/[^\n]/g, ''); // keep the line count
            i = stop - 1;
            continue;
        }
        out += c;
    }
    return out;
}

/** Style rules as { selector, body, line }, at any @media / @supports depth. */
export function rules(css) {
    const src = stripComments(css);
    const out = [];
    const stack = [];
    let start = 0;
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (c === '"' || c === "'") {
            let j = i + 1;
            while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
            i = j;
            continue;
        }
        if (c === '{') {
            stack.push({ prelude: src.slice(start, i).trim(), open: i, nested: false, line: src.slice(0, i).split('\n').length });
            if (stack.length > 1) stack[stack.length - 2].nested = true;
            start = i + 1;
        } else if (c === '}') {
            const top = stack.pop();
            if (top && !top.nested && top.prelude && !top.prelude.startsWith('@')) {
                out.push({ selector: top.prelude, body: src.slice(top.open + 1, i), line: top.line });
            }
            start = i + 1;
        } else if (c === ';' && stack.length === 0) {
            start = i + 1; // @import / @charset
        }
    }
    return out;
}

/** Split on top-level occurrences of `sep` (outside parentheses and brackets). */
function splitTop(s, isSep) {
    const parts = [];
    let depth = 0;
    let cur = '';
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth--;
        if (depth === 0 && isSep(c, s, i)) { parts.push(cur); cur = ''; continue; }
        cur += c;
    }
    parts.push(cur);
    return parts;
}

/** The compound the selector applies to (after the last combinator). */
export function subjectOf(selector) {
    const parts = splitTop(selector.trim(), (c) => c === ' ' || c === '>' || c === '+' || c === '~');
    const real = parts.map((p) => p.trim()).filter(Boolean);
    return real[real.length - 1] || '';
}

/** The argument lists of the :is( / :where( / :not( groups at the top of a compound. */
function groups(compound, name) {
    const out = [];
    const re = new RegExp(`:${name}\\(`, 'g');
    let m;
    while ((m = re.exec(compound))) {
        if (outer(compound)[m.index + 1] === ' ') continue;    // nested inside another group
        let depth = 1;
        let j = m.index + m[0].length;
        const from = j;
        while (j < compound.length && depth > 0) {
            if (compound[j] === '(') depth++;
            else if (compound[j] === ')') depth--;
            j++;
        }
        out.push(compound.slice(from, j - 1));
    }
    return out;
}

/** The compound with its parenthesised groups blanked (to read its own type / class / id). */
function outer(compound) {
    let depth = 0;
    let s = '';
    for (const c of compound) {
        if (c === '(') { depth++; s += '('; continue; }
        if (c === ')') { depth--; s += ')'; continue; }
        s += depth > 0 ? ' ' : c;
    }
    return s;
}

/** Whether a compound selector can match a text field. Classes and ids are specific (false). */
export function reachesTextField(compound) {
    const c = compound.trim();
    if (!c) return false;
    const own = outer(c);
    const nots = groups(c, 'not').join(',');
    const excludes = /\binput\b/.test(nots) && /\btextarea\b/.test(nots) && /\bselect\b/.test(nots);
    const type = (own.match(/^[a-zA-Z][\w-]*|^\*/) || [''])[0].toLowerCase();
    if (type === 'textarea' || type === 'select') return !excludes;
    if (type === 'input') return !NON_TEXT_TYPES.test(c) && !excludes;
    if (type && type !== '*') return false;                       // button, a, summary, div…
    if (/[.#]/.test(own)) return false;                           // a class or an id: the field's own rule
    const lists = [...groups(c, 'is'), ...groups(c, 'where')];
    if (lists.length) {
        return lists.some((l) => splitTop(l, (ch) => ch === ',').some((item) => {
            const sub = subjectOf(item);
            return reachesTextField(excludes ? `${sub}:not(input, textarea, select)` : sub);
        }));
    }
    if (/\[\s*role\s*=/.test(own) && !TEXT_ROLES.test(own)) return false; // role=button / tab / menuitem
    return !excludes;                                             // universal or attribute-only
}

/** Whether a declaration block draws an outline. */
export function drawsOutline(body) {
    return body.split(';').some((d) => {
        const m = d.match(/^\s*outline(-style|-width|-color)?\s*:\s*(.+)$/i);
        if (!m) return false;
        const v = m[2].replace(/!important/i, '').trim().toLowerCase();
        if (m[1] === '-color') return true;
        return !/^(none|0|0px)$/.test(v);
    });
}

/** Findings for one stylesheet's text. */
export function findDoubleRings(css) {
    const found = [];
    for (const r of rules(css)) {
        if (!/:focus(?!-within)/.test(r.selector) || !drawsOutline(r.body)) continue;
        for (const sel of splitTop(r.selector, (c) => c === ',')) {
            const subject = subjectOf(sel);
            if (!/:focus(?!-within)/.test(subject)) continue;
            if (reachesTextField(subject)) found.push({ line: r.line, selector: sel.trim() });
        }
    }
    return found;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    let bad = 0;
    for (const f of readdirSync(CSS_DIR).filter((n) => n.endsWith('.css')).sort()) {
        for (const hit of findDoubleRings(readFileSync(join(CSS_DIR, f), 'utf8'))) {
            bad++;
            console.error(`  css/${f}:${hit.line}  ${hit.selector}`);
        }
    }
    if (bad) {
        console.error(`\ncheck-focus-rings: ${bad} focus rule(s) draw an outline on a generic selector that reaches text fields.`);
        console.error('A text field shows focus through its own style (border + glow) or its wrapper\'s :focus-within ring;');
        console.error('a generic outline on top of it is a second ring. Restrict the rule to non-text controls, or add');
        console.error(':not(input, textarea, select).');
        process.exit(1);
    }
    console.log('check-focus-rings: no generic focus outline reaches a text field.');
}
