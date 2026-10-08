// The "Share / Import makes BMM restart" report (Settings -> Customize navigation).
//
// Root cause: the hint `navedit.subpagesHint` carried a literal, UNCLOSED `<a href="about.html">`
// as an example, and the editor interpolated it into innerHTML. The HTML parser keeps an
// unclosed anchor in its list of active formatting elements and re-opens a copy of it around
// every following phrasing element (inputs, spans, buttons) - the whole footer ended up inside
// `<a href="about.html">`. A click on Share / Import followed that link and the main window
// navigated away and reloaded. The session log showed it: "Click: Button [Share / Import]",
// then "IPC custom protocol failed" (the page unloading) and a full boot 1 s later.
//
// Two guards: the hint is escaped where it is rendered, and no locale value may contain an
// unclosed formatting tag, since every locale value can end up in an innerHTML somewhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// The tags the HTML parser re-opens after they are left open ("formatting elements").
const FORMATTING = ['a', 'b', 'big', 'code', 'em', 'font', 'i', 'nobr', 's', 'small', 'strike', 'strong', 'tt', 'u'];

// Values that legitimately LIST tag names and are never parsed as markup. Each entry says
// where it is used; the test checks that use, so the exemption cannot silently outlive it.
const LISTS_TAG_NAMES = {
    'tutc.stepText': { file: 'frontend/src/ui/tutorial-creator.ts', use: "field(t('tutc.stepTextLbl'), text, t('tutc.stepText'))" },
};

function unclosedTags(value) {
    const out = [];
    for (const tag of FORMATTING) {
        const open = (value.match(new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi')) || []).length;
        const close = (value.match(new RegExp(`</${tag}\\s*>`, 'gi')) || []).length;
        if (open > close) out.push(tag);
    }
    return out;
}

test('no locale value leaves a formatting tag (like <a>) open', () => {
    const bad = [];
    for (const lang of ['en', 'fr', 'template']) {
        const dict = JSON.parse(read(`frontend/Lang/${lang}.json`));
        for (const [key, value] of Object.entries(dict)) {
            if (typeof value !== 'string' || LISTS_TAG_NAMES[key]) continue;
            const tags = unclosedTags(value);
            if (tags.length) bad.push(`${lang}:${key} leaves <${tags.join('>, <')}> open`);
        }
    }
    assert.deepEqual(bad, [], 'an unclosed tag in a string rendered through innerHTML wraps everything after it');
});

test('the exempted tag-listing values are still used as plain text', () => {
    for (const [key, { file, use }] of Object.entries(LISTS_TAG_NAMES)) {
        assert.ok(read(file).includes(use), `${key} is exempt because ${file} sets it with ${use}; that use is gone`);
    }
});

test('the unclosed-tag detector catches the exact string that broke the editor', () => {
    assert.deepEqual(unclosedTags('Link them, e.g. <a href="about.html">. Each one shares...'), ['a']);
    assert.deepEqual(unclosedTags('A <a href="x">link</a> and <code>code</code>'), []);
});

test('the navbar editor renders the sub-pages hint escaped', () => {
    const src = read('frontend/src/ui/navbar-customize.ts');
    const line = src.split('\n').find((l) => l.includes("t('navedit.subpagesHint')"));
    assert.ok(line, 'navedit.subpagesHint is no longer rendered by navbar-customize.ts');
    assert.match(line, /\$\{escAttr\(t\('navedit\.subpagesHint'\)/, 'the hint must go through escAttr()');
    // The English fallback must not reintroduce a tag either.
    assert.equal(unclosedTags(line.replace(/<\/?p[^>]*>/g, '')).length, 0);
});

test('the Share / Import menu entries are buttons that never navigate the main window', () => {
    const src = read('frontend/src/ui/navbar-customize.ts');
    const start = src.indexOf('<div class="modal-footer nbe-actions">');
    const end = src.indexOf('</div>', start);
    assert.ok(start > 0 && end > start, 'editor footer markup not found');
    const footer = src.slice(start, end);
    assert.doesNotMatch(footer, /<a[\s>]|<form[\s>]|href=/i, 'no anchor or form in the actions bar');
    // The menu handlers: no reload, no location change, no anchor-click download.
    const handlers = src.slice(src.indexOf("overlay.querySelector('#nbe-share')"), src.indexOf('function readEditor('));
    assert.ok(handlers.length > 100, 'share/import handlers not found');
    assert.doesNotMatch(handlers, /location\.(reload|assign|replace|href)|window\.location\s*=|\.download\s*=/);
    // Export goes through the native save dialog + a Rust writer, not a blob/data URL link.
    const exp = src.slice(src.indexOf('async function exportNavBundle'), src.indexOf('async function importNavBundle'));
    assert.match(exp, /saveFile\(/);
    assert.match(exp, /invoke\('write_signed_document'/);
    assert.doesNotMatch(exp, /createObjectURL|data:application|\.click\(\)/);
});
