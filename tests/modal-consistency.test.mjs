// The one dialog shell (css/modal-shell.css + ui/modal-shell.ts) and the gate that keeps every
// dialog on it (scripts/check-modal-consistency.mjs).
//
// The gate is tested by planting each defect it exists for and watching it fail — a guard that
// has never been seen to fail is an opinion. The shell's pure helpers load from the compiled
// module (import-light on purpose: focus-trap and layer only).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const G = await import(pathToFileURL(join(ROOT, 'scripts/check-modal-consistency.mjs')).href);
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/ui/modal-shell.js')).href);

const X = '<button type="button" class="modal-close"></button>';
const dialog = ({ overlay = '', card = 'modal modal--md', cardStyle = '', head = `<h2 class="modal-title">T</h2>${X}`, body = '', foot = '' } = {}) =>
    `<div class="modal-overlay" id="d"${overlay}><div class="${card}"${cardStyle}><div class="modal-header">${head}</div>` +
    `<div class="modal-body"${body}></div><div class="modal-footer"${foot}><button class="btn btn-primary">OK</button></div></div></div>`;

describe('gate: static dialogs', () => {
    test('the canonical anatomy passes', () => {
        assert.deepEqual(G.auditHtml(dialog()).problems, []);
    });
    test('no close button fails; a question answered by a Cancel carrying .modal-close passes', () => {
        assert.match(G.auditHtml(dialog({ head: '<h2 class="modal-title">T</h2>' })).problems.join('\n'), /no \.modal-close/);
        const q = `<div class="modal-overlay" id="q" data-modal-kind="question"><div class="modal"><div class="modal-header"><h2 class="modal-title">T</h2></div>` +
            '<div class="modal-footer"><button class="btn btn-ghost modal-close">Cancel</button><button class="btn btn-danger">Yes</button></div></div></div>';
        assert.deepEqual(G.auditHtml(q).problems, []);
        assert.match(G.auditHtml(q.replace('btn btn-ghost modal-close', 'btn btn-ghost')).problems.join('\n'), /Cancel carrying \.modal-close/);
    });
    test('no title fails', () => {
        assert.match(G.auditHtml(dialog({ head: `<h2>T</h2>${X}` })).problems.join('\n'), /no \.modal-title/);
    });
    test('inline shell styles fail on the card and on each band; layout inside a band does not', () => {
        assert.match(G.auditHtml(dialog({ cardStyle: ' style="max-width:650px; width:90%"' })).problems.join('\n'), /max-width, width on \.modal/);
        assert.match(G.auditHtml(dialog({ foot: ' style="padding:16px 24px; background:rgba(0,0,0,.2)"' })).problems.join('\n'), /padding, background on \.modal-footer/);
        assert.deepEqual(G.auditHtml(dialog({ body: ' style="text-align:center"', cardStyle: ' style="height: 80vh"' })).problems, []);
    });
    test('an overlay with no .modal card fails, and `modal-overlay-security` is not a house overlay', () => {
        assert.match(G.auditHtml('<div class="modal-overlay" id="z"><div class="modal-content"></div></div>').problems.join('\n'), /no \.modal card/);
        assert.deepEqual(G.auditHtml('<div class="modal-overlay-security" id="s"><div></div></div>').dialogs, []);
    });
});

describe('gate: built dialogs', () => {
    test('a module that builds a house overlay without header/title/close fails, unless it uses the helper', () => {
        const bare = "const o = document.createElement('div'); o.className = 'modal-overlay open'; o.innerHTML = `<div class=\"modal\"><div class=\"modal-body\"></div></div>`; document.body.appendChild(o);";
        assert.equal(G.auditTs('features/x.ts', bare).problems.length, 3);
        assert.deepEqual(G.auditTs('features/x.ts', bare + ' buildModalHeader({ title: "t" });').problems, []);
    });
    test('inline shell styles in a template fail', () => {
        const src = 'x.innerHTML = `<div class="modal-footer" style="padding:16px; justify-content:flex-end">`;';
        assert.match(G.auditTs('features/x.ts', src).problems.join('\n'), /inline padding on \.modal-footer/);
    });
    test('card.style.maxWidth on a card the module made fails', () => {
        const src = "const card = document.createElement('div'); card.className = 'modal glass'; card.style.maxWidth = '850px';";
        assert.match(G.auditTs('features/x.ts', src).problems.join('\n'), /card\.style\.maxWidth/);
    });
    test('a new overlay family fails; a listed one passes', () => {
        assert.match(G.auditTs('features/x.ts', "el.className = 'shiny-overlay';").problems.join('\n'), /new overlay family \.shiny-overlay/);
        assert.deepEqual(G.auditTs('features/x.ts', "el.className = 'kofi-overlay';").problems, []);
    });
});

describe('gate: feature stylesheets', () => {
    test('a rule that repaints a band is found; a rule on the CONTENT of a band is not', () => {
        const hits = G.shellOverrides('.foo .modal-footer { background: #000; padding: 4px; }\n.foo .modal-body p { padding: 4px; }');
        assert.deepEqual(hits.map((h) => h.selector), ['.foo .modal-footer']);
        assert.deepEqual(hits[0].props, ['background', 'padding']);
    });
    test('overlays: positioning is per family, the dim is the shell\'s', () => {
        assert.deepEqual(G.shellOverrides('#app-window-outer .modal-overlay { position: absolute; width: 100%; border-radius: 16px; }'), []);
        assert.equal(G.shellOverrides('.x.modal-overlay { background: rgba(0,0,0,.4); }').length, 1);
    });
    test('comments are not rules', () => {
        assert.deepEqual(G.shellOverrides('/* .modal-footer { padding: 0 } */'), []);
    });
});

describe('the repository is on the shell', () => {
    test('the whole gate passes on the tree', () => {
        assert.deepEqual(G.run().problems, []);
    });
    test('modal-shell.css is linked statically, after every feature sheet, with the id the helper checks', () => {
        const html = read('frontend/index.html');
        const links = [...html.matchAll(/<link rel="stylesheet" href="css\/([\w-]+)\.css"[^>]*>/g)].map((m) => m[1]);
        assert.equal(links[links.length - 1], 'modal-shell');
        assert.match(html, /href="css\/modal-shell\.css" id="modal-shell-css"/);
    });
    test('main.css no longer defines the shell', () => {
        const main = read('frontend/css/main.css').replace(/\/\*[\s\S]*?\*\//g, '');
        for (const sel of ['.modal {', '.modal-header {', '.modal-body {', '.modal-footer {', '.modal-overlay {']) {
            assert.equal(main.includes(`\n${sel}`), false, `${sel} is still in main.css`);
        }
    });
    test('.btn-accent and .btn-warning exist (the confirm and twenty modules use them)', () => {
        const main = read('frontend/css/main.css');
        assert.match(main, /\.btn-accent \{/);
        assert.match(main, /\.btn-warning \{/);
    });
    test('no duplicate dialog ids in index.html', () => {
        const ids = [...read('frontend/index.html').matchAll(/<div\b[^>]*\bid="(modal-[\w-]+)"/g)].map((m) => m[1]);
        assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
    });
});

describe('modal-shell.ts', () => {
    test('modalClassName: size and tall modifiers, the feature hook kept', () => {
        assert.equal(M.modalClassName('lg', 'cm-modal', true), 'modal bms modal--lg modal--tall cm-modal');
        assert.equal(M.modalClassName(), 'modal bms modal--md');
    });
    test('topmostOf: highest z, then latest in the document', () => {
        assert.equal(M.topmostOf([[5000, 0], [11000, 1], [11000, 2], [5000, 3]]), 2);
        assert.equal(M.topmostOf([]), -1);
    });
    test('Escape for static dialogs presses the TOP dialog\'s own close, read before and acted on after every handler', () => {
        const src = read('frontend/src/ui/modal-shell.ts');
        assert.match(src, /escTop = e\.key === 'Escape' && !e\.defaultPrevented \? topOverlay\(\) : null;\s*\}, true\);/);
        assert.match(src, /if \(!isPainted\(top\) \|\| topOverlay\(\) !== top\) return;/);
        assert.match(src, /if \(top\.getAttribute\('data-prevent-close'\) === 'true'\) return;/);
        assert.match(src, /close\.click\(\);/);
    });
    test('openModal mounts inside the app frame, above what is open, and binds the behaviour', () => {
        const src = read('frontend/src/ui/modal-shell.ts');
        const body = src.slice(src.indexOf('export function openModal'));
        assert.match(body, /\(document\.getElementById\('app-window-outer'\) \|\| document\.body\)\.appendChild\(overlay\)/);
        assert.match(body, /raiseAboveAll\(overlay\)/);
        assert.match(body, /bindModal\(overlay,/);
    });
});
