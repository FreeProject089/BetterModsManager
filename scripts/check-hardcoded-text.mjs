#!/usr/bin/env node
// Prose that reaches the screen without going through t().
//
// check-i18n-parity compares the two dictionaries. check-i18n-keys checks that every key a
// t() call names exists. Neither can see the failure that users actually reported — a string
// that never calls t() at all. There is nothing to compare and no key to look up, so both
// gates stay green while an English user reads "Réparation de …" and a French one reads
// "Hashing file content…".
//
// check-hardcoded-placeholders already covers `placeholder="…"`, which was the first place
// this was found. This covers the rest of the surface:
//
//   · TypeScript — the sinks that put prose on screen: toast(), textContent, innerText,
//     alert(), window.prompt(), .title, and the title/aria-label attributes written through
//     setAttribute.
//   · index.html — any text node whose element (or an ancestor) carries no data-i18n. The
//     ancestor matters: a <li> inside a translated <p> is replaced with the parent.
//
// "Prose" is a space, letters, and a function word from either language — the same test the
// placeholder checker uses. It is what separates "Save your profile" from "catalog.json",
// ".mod-item" or "app_id". Field names, file extensions and product names are not prose and
// are not flagged.
//
// ALLOW below is for the strings that are genuinely not translatable, each with the reason.
// It only ever shrinks.

import fs from 'node:fs';
import path from 'node:path';

const TS_ROOT = 'frontend/src';
const HTML = 'frontend/index.html';

// A function word in English or French: the marker that a literal is a sentence and not an
// identifier.
const PROSE = /(^|\s)(the|a|an|is|are|to|not|no|your|this|that|and|or|for|of|in|with|be|has|was|will|can|it|does|what|my|le|la|les|un|une|des|du|de|mon|ma|mes|votre|vos|ce|cette|et|ou|pour|dans|avec|est|sont|que|qui|sans|sur)(\s|$)/i;

// Literals that are not translatable, and why.
const ALLOW = new Map([
    ['Better Mod Manager', 'the product name'],
    ['A11y Warning: Button has no visible text and no aria-label', 'the developer a11y overlay, dev-only'],
    ['A11y Warning: Form field has no associated label or aria-label', 'the developer a11y overlay, dev-only'],
    ["Saved at ", 'source code inside a page TEMPLATE the user edits — translating it would translate their code'],
    // The theme editor's custom-element starter snippets. Same reason: the user is handed
    // this markup to edit, so the words are a placeholder in THEIR document, not our chrome.
    ['My button', 'starter snippet the user edits, in the theme editor'],
    ['My custom banner', 'starter snippet the user edits, in the theme editor'],
    ['My note text', 'starter snippet the user edits, in the theme editor'],
    ['My link', 'starter snippet the user edits, in the theme editor'],
]);

const sinks = [
    [/\btoast\(\s*(['"`])([^'"`\n]{6,160})\1/g, 'toast()'],
    [/\.(?:textContent|innerText)\s*=\s*(['"`])([^'"`\n]{6,160})\1/g, 'textContent'],
    [/\.title\s*=\s*(['"`])([^'"`\n]{6,160})\1/g, '.title'],
    [/\b(?:alert|window\.prompt)\(\s*(['"`])([^'"`\n]{6,200})\1/g, 'alert/prompt'],
    [/\bsetAttribute\(\s*['"](?:title|aria-label)['"]\s*,\s*(['"`])([^'"`\n]{6,160})\1/g, 'setAttribute'],
    [/\baria-label="([^"{<$]{6,160})"/g, 'aria-label'],
];

const bad = [];

/** A literal is fine if it is not prose, is allow-listed, or is entirely an interpolation. */
function offends(text) {
    if (!text) return false;
    if (ALLOW.has(text.trim())) return false;
    for (const ok of ALLOW.keys()) if (text.includes(ok)) return false;
    if (/^\$\{[^}]*\}$/.test(text)) return false;      // `${x}` — the value is the message
    if (/^(https?:|\/|#)/.test(text)) return false;    // a URL or a selector
    return PROSE.test(text);
}

// ── TypeScript ────────────────────────────────────────────────────────────────
const files = [];
(function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts')) files.push(p);
    }
})(TS_ROOT);

// ── generated HTML ────────────────────────────────────────────────────────────
//
// The sinks above cover prose assigned to a PROPERTY. They cannot see prose written into a
// template literal and handed to innerHTML — which is how this app builds most of its UI.
// A whole settings panel (the Content-Security-Policy editor) was written that way, entirely
// in English, and this gate passed it without a word.
//
// So: text nodes inside template literals, minus the four things that are legitimately not
// t() calls, each verified rather than assumed:
//   · an element carrying data-i18n — applyTranslations() repaints it.
//   · anything inside an HTML comment.
//   · docs-hub article bodies — bilingual already, as `en:` / `fr:` pairs.
//   · files that emit a standalone DOCUMENT rather than app UI (the benchmark report), and
//     the starter page templates whose body IS the user's own code to edit.
const GENERATED_SKIP = /docs-hub\.ts$|bench[\\/]benchmark\.ts$|navbar-customize\.ts$/;

function generatedProse(src, file) {
    if (GENERATED_SKIP.test(file)) return [];
    const out = [];
    for (const m of src.matchAll(/`(?:\\.|[^`\\])*`/g)) {
        const lit = m[0].replace(/<!--[\s\S]*?-->/g, '');
        if (!lit.includes('<')) continue;
        for (const tn of lit.matchAll(/(<[^<>]*>)([^<>${}]{6,200})</g)) {
            const openTag = tn[1];
            const text = tn[2].replace(/\s+/g, ' ').trim();
            if (!offends(text)) continue;
            if (/data-i18n(?:-\w+)?\s*=/.test(openTag)) continue;
            const before = lit.slice(Math.max(0, tn.index - 40), tn.index);
            if (/\bt\(\s*['"][\w.]+['"]/.test(before)) continue;
            const at = m.index + tn.index;
            const lineStart = src.lastIndexOf('\n', at) + 1;
            const lineEnd = src.indexOf('\n', lineStart);
            if (/^\s*(\/\/|\*)/.test(src.slice(lineStart, lineEnd < 0 ? undefined : lineEnd))) continue;
            out.push([src.slice(0, at).split('\n').length, text]);
        }
    }
    return out;
}

for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const [line, text] of generatedProse(src, f)) {
        bad.push(`${f}:${line}  [generated HTML]  ${text.slice(0, 90)}`);
    }
    src.split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;   // a comment is not on screen
        for (const [re, kind] of sinks) {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(line))) {
                const text = m[2] ?? m[1];
                if (offends(text)) bad.push(`${f}:${i + 1}  [${kind}]  ${text.slice(0, 90)}`);
            }
        }
    });
}

// ── index.html ────────────────────────────────────────────────────────────────
//
// Blank out script/style/comments while KEEPING their newlines, so reported line numbers are
// the real ones.
const blank = (s, re) => s.replace(re, (m) => m.replace(/[^\n]/g, ' '));
let html = fs.readFileSync(HTML, 'utf8');
html = blank(html, /<script[\s\S]*?<\/script>/gi);
html = blank(html, /<style[\s\S]*?<\/style>/gi);
html = blank(html, /<!--[\s\S]*?-->/g);

const VOID = /^(br|hr|img|input|meta|link|source|track|area|base|col|embed|param|wbr|path|circle|rect|line|polyline|polygon|use|stop|ellipse)$/i;
const tagRe = /<\/?([a-zA-Z][\w-]*)([^>]*)>/g;
const stack = [];
let last = 0;
let m;
while ((m = tagRe.exec(html))) {
    const text = html.slice(last, m.index).replace(/\s+/g, ' ').trim();
    if (text && !/[{}]/.test(text) && offends(text)) {
        // An ancestor carrying data-i18n owns this element's text: applyTranslations replaces
        // the whole subtree, so the literal here never renders.
        if (!stack.some((e) => e.i18n)) {
            const line = html.slice(0, last).split('\n').length;
            bad.push(`${HTML}:${line}  [text node]  ${text.slice(0, 90)}`);
        }
    }
    last = m.index + m[0].length;
    if (m[0][1] === '/') stack.pop();
    else if (!/\/>$/.test(m[0]) && !VOID.test(m[1])) {
        stack.push({ tag: m[1], i18n: /data-i18n(\b|=)/.test(m[2]) });
    }
}

if (bad.length) {
    console.error(`✗ ${bad.length} user-facing string(s) never reach t():\n`);
    for (const b of bad) console.error('  ' + b);
    console.error('\nGive each one a key in frontend/Lang/{en,fr}.json, or — if it genuinely');
    console.error('cannot be translated (a product name, a field name) — add it to ALLOW in');
    console.error('scripts/check-hardcoded-text.mjs with the reason.');
    process.exit(1);
}
console.log(`✓ no hardcoded user-facing text (${files.length} modules + index.html)`);
