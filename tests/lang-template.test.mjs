// The translator template is generated from en.json and cannot drift (scripts/gen-lang-template.mjs).
//
// In 1.0.4 the hand-kept template lacked 3 077 keys of en.json and carried 10 dead ones. This
// pins the generator: same keys, same order, same text as en.json except the `_info` block,
// and a `--check` that fails on the drift it is meant to catch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const G = await import(pathToFileURL(join(ROOT, 'scripts/gen-lang-template.mjs')).href);

const EN = `{
  "__SECTION_A__": "--- A ---",
  "_info": {
    "name": "English",
    "flag": "us",
    "suffix": "_EN"
  },
  "_synonyms": {
    "mod": [
      "mods"
    ]
  },
  "a.one": "One \\u00e9 “quoted”",
  "a.two": "Two"
}
`;

test('the template is en.json with its own _info block, byte for byte otherwise', () => {
    const out = G.buildTemplate(EN, { version: '9.9.9', date: '2026-01-02' });
    const tpl = JSON.parse(out);
    assert.deepEqual(tpl._info, { name: 'Template', flag: '⚪', suffix: '_TEMPLATE', version: '9.9.9', date: '2026-01-02', keys: 2 });
    assert.deepEqual(Object.keys(tpl), Object.keys(JSON.parse(EN)));
    // Not re-serialised: the escape and the layout of every other line are kept.
    assert.ok(out.includes('"a.one": "One \\u00e9 “quoted”"'));
    assert.equal(out.split('"_synonyms"')[1], EN.split('"_synonyms"')[1]);
});

test('CRLF files stay CRLF', () => {
    const out = G.buildTemplate(EN.replace(/\n/g, '\r\n'), { version: '1', date: '2026-01-02' });
    assert.ok(!/[^\r]\n/.test(out));
});

test('the drift report names missing, extra and changed keys', () => {
    const d = G.diffAgainstEn({ _info: {}, a: '1', b: '2', c: '3' }, { _info: { x: 1 }, a: '1', c: 'old', z: '9' });
    assert.deepEqual(d, { missing: ['b'], extra: ['z'], changed: ['c'] });
});

test('the committed template is fresh', () => {
    const st = G.templateState();
    assert.ok(st.fresh, 'frontend/Lang/template.json is stale: run node scripts/gen-lang-template.mjs');
    const en = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/en.json'), 'utf8'));
    const tpl = JSON.parse(st.current);
    assert.equal(tpl._info.keys, G.countKeys(en));
    assert.equal(tpl._info.version, JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);
});
