// Every button that sends you to Settings lands somewhere that exists.
//
// The report: « Manage keys » on the protected-source block did nothing. Seventeen screens
// carried their own copy of "click #nav-settings, then 250 ms later scrollIntoView on a card";
// two catalogue kinds passed no destination at all; and a copy that names an id the Settings
// page no longer has fails silently: the click still lands on Settings, so it looks as if it
// worked. Now every such button goes through core/settings-link.ts with its target written as
// a literal, and this test reads those literals and checks each one against the markup.
//
// What is checked:
//   1. goToSettings('id', { open, focus }) and openKeyManager's targets exist;
//   2. API actions that click a Settings button (navClick('settings', 'id')) name a real button;
//   3. the Settings index groups (card-order.ts SETTINGS_GROUPS) name real cards;
//   4. ids the command palette looks up exist;
//   5. no screen carries its own "click nav-settings, scroll later" copy again;
//   6. the protected-source and SSH blocks have a working default destination.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'frontend', 'src');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (name.endsWith('.ts')) out.push(p);
    }
    return out;
}

const html = read('frontend/index.html');
const sources = walk(SRC).map((p) => ({ file: relative(ROOT, p).split('\\').join('/'), text: readFileSync(p, 'utf8') }));
const allSrc = sources.map((s) => s.text).join('\n');

/** An id exists when the markup has it, or a script creates it under that exact name. */
function idExists(id) {
    const q = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\bid="${q}"`).test(html)) return true;
    return new RegExp(`\\bid=["']${q}["']|\\.id\\s*=\\s*['"\`]${q}['"\`]|_ID\\s*=\\s*['"]${q}['"]`).test(allSrc);
}

/** Every match of `re` (global, one capture group = the id) across the sources, with its file. */
function collect(re, files = sources) {
    const out = [];
    for (const { file, text } of files) {
        for (const m of text.matchAll(re)) out.push({ file, id: m[1] });
    }
    return out;
}

function missing(list) {
    return list.filter(({ id }) => !idExists(id)).map(({ file, id }) => `${file}: #${id}`);
}

test('every goToSettings target exists in the markup', () => {
    const calls = collect(/\bgoToSettings\(\s*'([\w-]+)'/g);
    const opts = collect(/\bgoToSettings\(\s*'[\w-]+'\s*,\s*\{[^}]*?\b(?:open|focus):\s*'([\w-]+)'/g);
    assert.ok(calls.length >= 3, `expected the Settings jumps to use goToSettings('id'), found ${calls.length}`);
    assert.deepEqual(missing([...calls, ...opts]), [], 'a « go to Settings » button points at an id the page no longer has');
});

test('the keyring destination (« Manage keys ») exists, with its « Create one » fold', () => {
    const link = read('frontend/src/core/settings-link.ts');
    const targets = [...link.matchAll(/getElementById\('([\w-]+)'\)/g)].map((m) => m[1]);
    for (const id of ['sic-keyring-list', 'sic-make']) {
        assert.ok(link.includes(`'${id}'`), `settings-link.ts no longer names #${id}`);
        assert.ok(idExists(id), `#${id} is gone from Settings → Identity & API`);
    }
    assert.deepEqual(missing(targets.map((id) => ({ file: 'frontend/src/core/settings-link.ts', id }))), []);
    assert.ok(idExists('nav-settings') || /data-view="settings"/.test(html), 'no Settings nav item to click');
});

test('API actions that press a Settings button name a real button', () => {
    const list = collect(/navClick\('settings',\s*'([\w-]+)'\)/g);
    assert.ok(list.length > 0, 'expected navClick(\'settings\', …) actions in api_activity.ts');
    assert.deepEqual(missing(list), []);
});

test('the Settings index groups name real cards', () => {
    const src = read('frontend/src/features/settings/card-order.ts');
    const block = src.slice(src.indexOf('SETTINGS_GROUPS'), src.indexOf('];', src.indexOf('SETTINGS_GROUPS')));
    const ids = [...block.matchAll(/'([\w-]+)'/g)].map((m) => m[1])
        .filter((id) => /^settings-/.test(id));
    assert.ok(ids.length > 5, 'could not read the card ids of SETTINGS_GROUPS');
    assert.deepEqual(missing(ids.map((id) => ({ file: 'frontend/src/features/settings/card-order.ts', id }))), []);
});

test('ids the command palette looks up exist', () => {
    const file = sources.filter((s) => s.file.endsWith('core/commands.ts'));
    // #app is a fallback root (`… || getElementById('app') || document.body`), never a target.
    const FALLBACKS = new Set(['app']);
    const list = collect(/getElementById\('([\w-]+)'\)/g, file).filter(({ id }) => !FALLBACKS.has(id));
    assert.deepEqual(missing(list), [], 'a palette command looks for an element that is gone');
    const cmd = file[0]?.text || '';
    assert.match(cmd, /getElementById\('app'\) as HTMLElement\) \|\| document\.body/, 'the #app exemption no longer matches its use');
});

test('no screen carries its own « click nav-settings, scroll later » copy', () => {
    // The copy this replaced: correct on the day it was written, then silently wrong when the
    // view switch reset the scroll after it ran, or the card was folded, hidden or renamed.
    const re = /getElementById\('nav-settings'\)[^;]*\)\?\.click\(\);\s*setTimeout\(\s*\(\)\s*=>\s*document\.getElementById\('([\w-]+)'\)/g;
    const copies = collect(re).map(({ file, id }) => `${file}: scrolls to #${id} by hand (use goToSettings from core/settings-link.ts)`);
    assert.deepEqual(copies, []);
});

test('« Manage keys » has a destination even when a screen passes none', () => {
    const sa = read('frontend/src/core/source-access.ts');
    assert.match(sa, /manageKeys \|\| openKeyManager/, 'source-access.ts must fall back to openKeyManager');
    const cm = read('frontend/src/ui/catalog-modal.ts');
    assert.match(cm, /if \(spec\.manageKeys\) spec\.manageKeys\(\); else openKeyManager\(\);/,
        'catalog-modal.ts must fall back to openKeyManager (mod lists and scheduler presets pass none)');
});

test('the protected-source block says when there is no key, in both languages', () => {
    const sa = read('frontend/src/core/source-access.ts');
    assert.match(sa, /t\('srcacc\.noKey'\)/);
    for (const lang of ['en', 'fr', 'template']) {
        const dict = JSON.parse(read(`frontend/Lang/${lang}.json`));
        assert.ok(typeof dict['srcacc.noKey'] === 'string' && dict['srcacc.noKey'].length > 10, `${lang}.json lacks srcacc.noKey`);
    }
});
