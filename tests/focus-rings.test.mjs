// One focus ring per text field: the gate (scripts/check-focus-rings.mjs) and the dialog
// open-focus rule (ui/modal-shell.ts isTextEntry).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const G = await import(pathToFileURL(join(ROOT, 'scripts/check-focus-rings.mjs')).href);
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/ui/modal-shell.js')).href);

describe('check-focus-rings', () => {
    test('the regression: a generic modal rule that outlines text fields is caught', () => {
        const css = '.modal :is(button, a, input, select, textarea):focus-visible { outline: 2px solid var(--bmm-accent); }';
        assert.equal(G.findDoubleRings(css).length, 1);
    });
    test('bare fields, universal and attribute-only focus outlines are caught', () => {
        assert.equal(G.findDoubleRings('input:focus { outline: 1px solid red; }').length, 1);
        assert.equal(G.findDoubleRings('select:focus { outline-color: red; }').length, 1);
        assert.equal(G.findDoubleRings('.deck :focus-visible { outline: 2px solid red; }').length, 1);
        assert.equal(G.findDoubleRings(':where([tabindex]):focus-visible { outline: 2px solid red; }').length, 1);
    });
    test('non-text controls, exclusions, class rules and outline:none pass', () => {
        const ok = [
            '.modal :is(button, [role="tab"], a, input:is([type="checkbox"], [type="radio"])):focus-visible { outline: 2px solid x; }',
            '.deck :focus-visible:not(input, textarea, select) { outline: 2px solid x; }',
            ':where(a, [tabindex]:not([tabindex="-1"], input, textarea, select)):focus-visible { outline: 2px solid x !important; }',
            '.dbg-input:focus-visible { outline: 2px solid x; }',
            '.wrap input:focus { outline: none; }',
            '.wrap:focus-within { outline: 2px solid x; }',
            '/* input:focus { outline: 1px solid x } */ .a { color: x; }',
        ];
        for (const css of ok) assert.deepEqual(G.findDoubleRings(css), [], css);
    });
    test('findings carry the source line, comments counted', () => {
        const [hit] = G.findDoubleRings('/* one\n two */\n.a{}\ninput:focus { outline: 1px solid x; }');
        assert.equal(hit.line, 4);
    });
    test('rules inside @media are read', () => {
        assert.equal(G.findDoubleRings('@media (min-width: 1px) { textarea:focus-visible { outline: 1px solid x; } }').length, 1);
    });
});

describe('modal-shell isTextEntry', () => {
    test('text inputs, textareas and editable regions take typed text', () => {
        assert.equal(M.isTextEntry('INPUT', null, false), true);
        assert.equal(M.isTextEntry('INPUT', 'search', false), true);
        assert.equal(M.isTextEntry('TEXTAREA', null, false), true);
        assert.equal(M.isTextEntry('DIV', null, true), true);
    });
    test('boxes, radios, sliders and buttons do not', () => {
        for (const t of ['checkbox', 'radio', 'range', 'button', 'submit']) assert.equal(M.isTextEntry('INPUT', t, false), false, t);
        assert.equal(M.isTextEntry('BUTTON', null, false), false);
        assert.equal(M.isTextEntry('SELECT', null, false), false);
    });
});
