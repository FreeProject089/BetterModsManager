// Translation variables: the gate (scripts/check-i18n-vars.mjs) and the scan toast that made it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const G = await import(pathToFileURL(join(ROOT, 'scripts/check-i18n-vars.mjs')).href);

const one = (src) => G.findCalls(src);
const dicts = (en, fr = en) => ({ en, fr });

describe('check-i18n-vars: reading calls', () => {
    test('placeholders are {identifier}; dotted scheduler syntax is not one', () => {
        assert.deepEqual(G.placeholders('{n} of {total} · {event.name}'), ['n', 'total']);
        assert.deepEqual(G.placeholders('{0} KB'), ['0']);
    });
    test('object-literal vars, shorthand and quoted names', () => {
        const [c] = one("t('a.b', { n, total: 3, 'x': y })");
        assert.equal(c.key, 'a.b');
        assert.deepEqual(c.vars, ['n', 'total', 'x']);
    });
    test('a spread or a variable makes the vars unknown, not empty', () => {
        assert.equal(one("t('a.b', { ...rest })")[0].vars, null);
        assert.equal(one("t('a.b', vars)")[0].vars, null);
    });
    test('replace chains count: direct, ?. , regex, split/join, around a fallback group', () => {
        assert.deepEqual(one("t('k').replace('{n}', 1).replace('{t}', 2)")[0].vars, ['n', 't']);
        assert.deepEqual(one("t('k')?.replace('{count}', 1)")[0].vars, ['count']);
        assert.deepEqual(one("t('k').replace(/\\{n\\}/g, 1)")[0].vars, ['n']);
        assert.deepEqual(one("t('k').split('{n}').join(x)")[0].vars, ['n']);
        assert.deepEqual(one("toast((t('k') || 'fb {n}').replace('{n}', 1))")[0].vars, ['n']);
        assert.deepEqual(one("x = `<b>${esc((t('k') || 'a').replace('{n}', 1))}</b>`")[0].vars, ['n']);
    });
    test('a template held in a variable and filled later counts', () => {
        assert.deepEqual(one("const tpl = t('k');\nconst out = tpl.replace('{name}', n);")[0].vars, ['name']);
    });
    test('a ternary key is two calls sharing one vars object', () => {
        const c = one("t(ok ? 'a.yes' : 'a.no', { n })");
        assert.deepEqual(c.map((x) => x.key), ['a.yes', 'a.no']);
        assert.ok(c.every((x) => x.shared));
    });
    test('data-i18n renders with no vars; a selector naming one renders nothing', () => {
        assert.equal(G.findAttrKeys('<p data-i18n="a.b">x</p>').length, 1);
        assert.equal(G.findAttrKeys(`q('[data-i18n="a.b"]')`).length, 0);
    });
    test('duplicate Lang keys are found (JSON.parse would keep the last silently)', () => {
        assert.deepEqual(G.duplicateKeys('{\n  "a": "1",\n  "b": "2",\n  "a": "3"\n}'), ['a']);
    });
});

describe('check-i18n-vars: the audit', () => {
    const use = (key, vars) => ({ key, vars, file: 'f.ts', line: 1 });
    test('the regression class: a call that never fills a placeholder', () => {
        const { errors } = G.audit(dicts({ k: 'Delete error: {err}' }), [use('k', [])], { literal: new Map() });
        assert.match(errors.join('\n'), /never fills \{err\}/);
    });
    test('a renamed placeholder in one language is caught both ways', () => {
        const d = { en: { k: '{count} mods' }, fr: { k: '{nombre} mods' } };
        const { errors } = G.audit(d, [use('k', ['count'])], { literal: new Map() });
        assert.match(errors.join('\n'), /fr has \{nombre\}/);
        assert.match(errors.join('\n'), /fr value has no \{count\}/);
    });
    test('a var no language uses is reported', () => {
        const { errors } = G.audit(dicts({ k: '{n} x' }), [use('k', ['n', 'f'])], { literal: new Map() });
        assert.match(errors.join('\n'), /passes \{f\}/);
    });
    test('unknown vars are not judged; a matching call passes', () => {
        const { errors } = G.audit(dicts({ k: '{n} x' }), [use('k', null), use('k', ['n'])], { literal: new Map() });
        assert.deepEqual(errors, []);
    });
    test('LITERAL keys may differ between languages but must never be given vars', () => {
        const lit = new Map([['k', 'syntax example']]);
        const d = { en: { k: 'use {name}' }, fr: { k: 'utilisez {nom}' } };
        assert.deepEqual(G.audit(d, [use('k', [])], { literal: lit }).errors, []);
        assert.match(G.audit(d, [use('k', ['name'])], { literal: lit }).errors.join('\n'), /listed in LITERAL/);
    });
    test('a count glued in front of a translation is found', () => {
        const g = G.findGlued('msg += `${result.added} ${t(\'mod.scanAdded\')}`;');
        assert.equal(g.length, 1);
        assert.equal(g[0].key, 'mod.scanAdded');
    });
});

describe('the scan toast', () => {
    const en = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/en.json'), 'utf8'));
    const fr = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/fr.json'), 'utf8'));
    const src = readFileSync(join(ROOT, 'frontend/src/features/mods/mods-actions.ts'), 'utf8');
    test('singular and plural are whole sentences in both languages, no (s)/(x)', () => {
        for (const d of [en, fr]) {
            for (const k of ['mod.scanAdded.one', 'mod.scanAdded.many', 'mod.scanRemoved.one', 'mod.scanRemoved.many',
                'mapper.newModsDetected.one', 'mapper.newModsDetected.many']) {
                assert.ok(d[k], k);
                assert.doesNotMatch(d[k], /\((s|x|e|es)\)/, `${k}: ${d[k]}`);
            }
            assert.match(d['mod.scanAdded.many'], /\{n\}/);
        }
    });
    test('the scan no longer glues a number in front of a translation', () => {
        assert.deepEqual(G.findGlued(src).filter((g) => g.key.startsWith('mod.scan')), []);
    });
});

