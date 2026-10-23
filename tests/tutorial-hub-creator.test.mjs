// The tutorial hub and creator (Oct 2026): the creator opened BEHIND the hub, and the gate that
// was supposed to keep tutorial targets honest accepted any quoted word.
//
// Stacking: the creator was a `.modal-overlay` relying on `.tutc-overlay { z-index: 2000100 }`
// in main.css, which modal-shell.css (linked later, same specificity) overrode with 5000, under
// a hub at 2000000. And the shell's "opened from another dialog → raise it" pass compared only
// against other .modal-overlay elements, so the hub (another family) did not count. The fix is
// in the stacking model (layer.ts paintedLayerZ counts every family; modal-shell raises against
// it) and both screens are openModal() dialogs now. layer.js is import-free, so it runs here
// against a tiny fake document.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const L = await import(pathToFileURL(join(ROOT, 'frontend/js/ui/layer.js')).href);
const V = await import(pathToFileURL(join(ROOT, 'frontend/js/ui/tutorial-validate.js')).href);
const T = await import(pathToFileURL(join(ROOT, 'frontend/js/ui/tutorial-target.js')).href);
const G = await import(pathToFileURL(join(ROOT, 'scripts/check-tutorial.mjs')).href);

/** A painted (or not) layer for the fake document. */
function layer(z, { painted = true, inside = null } = {}) {
    const n = {
        z, painted, isConnected: true, style: {},
        getClientRects: () => (painted ? [{}] : []),
        contains: (o) => o === n || (o && o.parent === n),
    };
    if (inside) n.parent = inside;
    return n;
}
function withDom(nodes, fn) {
    const prevDoc = globalThis.document;
    const prevGcs = globalThis.getComputedStyle;
    globalThis.document = { querySelectorAll: () => nodes };
    globalThis.getComputedStyle = (n) => ({ zIndex: String(n.style.zIndex ?? n.z), display: 'flex', visibility: 'visible' });
    try { return fn(); } finally { globalThis.document = prevDoc; globalThis.getComputedStyle = prevGcs; }
}

describe('stacking: a dialog opened from another lands on top', () => {
    test('a layer of ANOTHER family (the old hub at 2000000) counts', () => {
        const hub = layer(2000000);
        const creator = layer(5000);
        withDom([hub, creator], () => {
            assert.equal(L.paintedLayerZ(creator), 2000000);
            const z = L.raiseAboveAll(creator);
            assert.ok(z > 2000000, `creator raised to ${z}`);
        });
    });
    test('a closed overlay (display:none, no client rects) does not lift anything', () => {
        const closed = layer(9000000, { painted: false });
        withDom([closed], () => assert.equal(L.paintedLayerZ(), 0));
    });
    test('a dialog is never raised against itself or its own children', () => {
        const dlg = layer(11100);
        const dropdown = layer(11150, { inside: dlg });
        withDom([dlg, dropdown], () => assert.equal(L.paintedLayerZ(dlg), 0));
    });
    test('zToTop: on top already → null; under or level → above with a gap', () => {
        assert.equal(L.zToTop(5000, 0), null);
        assert.equal(L.zToTop(5000, 4000), null);
        assert.equal(L.zToTop(5000, 5000), 5100);
        assert.equal(L.zToTop(5000, 2000000), 2000100);
    });
    test('the shell raises a static dialog against every painted layer, not only house overlays', () => {
        const src = read('frontend/src/ui/modal-shell.ts');
        const opened = src.slice(src.indexOf('const opened = (o: HTMLElement)'), src.indexOf('const closed = (o: HTMLElement)'));
        assert.match(opened, /paintedLayerZ\(o\)/);
        assert.doesNotMatch(opened, /openOverlays\(\)\.filter/);
    });
    test('hub and creator are openModal dialogs; no stylesheet z-index hack is left', () => {
        assert.match(read('frontend/src/ui/tutorial-hub.ts'), /openModal\(\{/);
        assert.match(read('frontend/src/ui/tutorial-creator.ts'), /openModal\(\{/);
        assert.doesNotMatch(read('frontend/css/main.css'), /\.tutc-overlay\s*\{\s*z-index/);
        assert.doesNotMatch(read('frontend/src/ui/tutorial-creator.ts'), /className = 'modal-overlay|'modal-overlay tutc-overlay/);
    });
});

describe('creator rules', () => {
    const doc = () => ({
        format: 'bmmtut', id: 'my-tut', title: { en: 'Mine' },
        parts: [{ id: 'p', steps: [{ id: 'step-1', title: { en: 'Hi' }, text: { en: 'x' } }] }],
    });
    test('a clean document has no issue', () => assert.deepEqual(V.validateDoc(doc()), []));
    test('no title and a bad id block Save; step problems do not', () => {
        const d = doc();
        d.title.en = '';
        d.id = 'bad id!';
        d.parts[0].steps.push({ id: 'step-2' });
        d.parts[0].steps[0].wait = { kind: 'click' };
        const codes = V.validateDoc(d).map((i) => `${i.code}:${i.blocking}`);
        assert.ok(codes.includes('noTitle:true'));
        assert.ok(codes.includes('badId:true'));
        assert.ok(codes.includes('emptyStep:false'));
        assert.ok(codes.includes('waitNoTarget:false'));
    });
    test('a custom condition that does not parse is reported with the parser message', () => {
        const d = doc();
        d.parts[0].steps[0].wait = { kind: 'custom', expr: 'count(' };
        const bad = V.validateDoc(d).find((i) => i.code === 'badExpr');
        assert.ok(bad && bad.detail);
    });
    test('moveItem: clamps, keeps the moved item, returns where it landed', () => {
        const a = ['a', 'b', 'c', 'd'];
        assert.equal(V.moveItem(a, 0, 2), 2);
        assert.deepEqual(a, ['b', 'c', 'a', 'd']);
        assert.equal(V.moveItem(a, 3, -5), 0);
        assert.deepEqual(a, ['d', 'b', 'c', 'a']);
        assert.equal(V.moveItem(a, 1, 1), 1);
    });
    test('freeStepId never reuses a progress key', () => {
        assert.equal(V.freeStepId(['step-1', 'step-2']), 'step-3');
        assert.equal(V.freeStepId(['step-2', 'step-1', 'step-3']), 'step-4');
        assert.equal(V.freeStepId(['step-3', 'x']), 'step-4');
    });
    test('parseBmmtut refuses what is not a tutorial', () => {
        assert.equal(V.parseBmmtut('nope'), null);
        assert.equal(V.parseBmmtut('{"format":"other","parts":[]}'), null);
        assert.equal(V.parseBmmtut('{"format":"bmmtut","parts":[{"steps":[]}]}'), null);
        assert.ok(V.parseBmmtut(JSON.stringify(doc())));
    });
});

describe('hub answers', () => {
    test('status: new / in progress / done', () => {
        assert.equal(V.lessonStatus(0, 5, false), 'new');
        assert.equal(V.lessonStatus(0, 5, true), 'progress');
        assert.equal(V.lessonStatus(2, 5, false), 'progress');
        assert.equal(V.lessonStatus(5, 5, true), 'done');
        assert.equal(V.lessonStatus(0, 0, false), 'new');
    });
    test('search: every word, any order, accents ignored', () => {
        assert.ok(V.matchesQuery('Ordre et intégrité', 'integrite ordre'));
        assert.ok(!V.matchesQuery('Ordre et intégrité', 'laya'));
        assert.ok(V.matchesQuery('anything', '   '));
    });
});

describe('step targets', () => {
    test('a bare word is an id-or-class; picked CSS is CSS (the engine used to throw on "#x")', () => {
        assert.ok(T.isBareName('btn-add-mod'));
        assert.ok(!T.isBareName('#btn-add-mod'));
        const prev = globalThis.document;
        const calls = [];
        globalThis.document = {
            getElementById: (id) => (id === 'real' ? { id } : null),
            querySelectorAll: (sel) => { calls.push(sel); if (sel === '.#x') throw new Error('SyntaxError'); return sel === '#picked' ? [{ id: 'picked' }] : []; },
        };
        try {
            assert.equal(T.resolveTargets('real').length, 1);
            assert.equal(T.resolveTargets('#picked').length, 1);
            assert.deepEqual(T.resolveTargets('#x'), []);
            assert.ok(!calls.includes('.#x'));
        } finally { globalThis.document = prev; }
    });
});

describe('gate: check-tutorial', () => {
    test('compound selectors are split; attribute and pseudo parts are skipped', () => {
        assert.deepEqual(G.selectorParts('#a .b[data-x="y.z"]:not(.c)'), [{ kind: 'id', name: 'a' }, { kind: 'class', name: 'b' }]);
        assert.deepEqual(G.selectorParts('mod-card'), [{ kind: 'any', name: 'mod-card' }]);
        assert.deepEqual(G.selectorParts('${x}'), []);
    });
    test('a LOOKUP is not a rendering: only markup-producing code vouches for a name', () => {
        assert.ok(!G.renderedBy("document.querySelector('#gone')?.click();", 'gone'));
        assert.ok(G.renderedBy("b.id = 'here';", 'here'));
        assert.ok(G.renderedBy('x.innerHTML = `<div class="a here b">`;', 'here'));
        assert.ok(G.renderedBy("const CARD_ID = 'here';", 'here', 'id'));
        assert.ok(G.renderedBy("el('div', 'thub-row is-new')", 'thub-row'));
        assert.ok(!G.renderedBy("el('div', 'thub-row-x')", 'thub-row'));
    });
    test('field guides are checked too, and a planted dead target fails', () => {
        const data = "steps: [{ selector: 'live', fields: [{ sel: 'dead-field', key: 'tut.x' }] }]";
        const bad = G.missingTargets(data, { ids: new Set(['live']), classes: new Set(), sources: '' });
        assert.deepEqual(bad, ['dead-field  (field)']);
    });
});
