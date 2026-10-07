// "J'ai fermé un élément du debug menu et tout mon BMM s'est désaffiché."
//
// The Replay Studio and the Animation Studio marked their ✕ button `data-act="close"` and
// handled it in their own click listener. But `data-act` is not private vocabulary: the
// app-wide delegate in core/inline-actions.ts listens on `document` in the CAPTURE phase and
// calls `window[data-act](...)` for any clicked element carrying it. It ran first, found
// `window.close`, and called it — the whole BMM window closed. The studio's own handler and
// its stopPropagation() came too late to matter (capture runs before the target's
// listeners). "Stop" did the same with `window.stop()`, aborting every in-flight load.
//
// Pinned here, each independently:
//   1. The delegate never calls a NATIVE window method, whatever the markup says.
//   2. The debug feature does not use `data-act` for its own buttons.
//   3. Every close path of the debug menu and its studios is idempotent and tears down
//      what it installed (listeners, timers, hidden elements, pickers).
//   4. registerDebugSection (the extension API) queues, notifies and validates.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'frontend/src');
const js = (p) => import(pathToFileURL(join(ROOT, 'frontend/js', p)).href);
const src = (p) => readFileSync(join(SRC, p), 'utf8');
// Comments out, so an explanation that quotes the old markup does not count as using it.
const code = (p) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '');

describe('the data-act delegate never calls a native window method', () => {
    test('resolveAction refuses natives, accepts app functions (bound ones too)', async () => {
        const IA = await js('core/inline-actions.js');
        assert.equal(typeof IA.resolveAction, 'function', 'inline-actions exports no resolveAction');
        const app = function openThing() {};
        const prev = globalThis.window;
        globalThis.window = {
            // A Proxy over a function prints as `[native code]`, exactly like window.close.
            close: new Proxy(function close() {}, {}),
            stop: Math.max,
            open: Array.prototype.push,
            openThing: app,
            boundThing: app.bind(null),
            arrow: () => {},
            notAFunction: 42,
        };
        try {
            assert.equal(IA.resolveAction('close'), null, 'window.close is reachable from data-act');
            assert.equal(IA.resolveAction('stop'), null, 'window.stop is reachable from data-act');
            assert.equal(IA.resolveAction('open'), null, 'window.open is reachable from data-act');
            assert.equal(IA.resolveAction('openThing'), app, 'control: an app function must still resolve');
            assert.equal(typeof IA.resolveAction('boundThing'), 'function', 'a bound app function must still resolve');
            assert.equal(typeof IA.resolveAction('arrow'), 'function');
            assert.equal(IA.resolveAction('notAFunction'), null);
            assert.equal(IA.resolveAction('missing'), null);
            assert.equal(IA.resolveAction(''), null);
        } finally {
            globalThis.window = prev;
        }
    });

    test('end to end: a click on data-act="close" does not close the window', async () => {
        const IA = await js('core/inline-actions.js');
        const listeners = {};
        const prev = { window: globalThis.window, document: globalThis.document, Element: globalThis.Element };
        class Element {}
        class Btn extends Element {
            constructor(act) { super(); this.dataset = { act }; }
            closest(sel) { return sel === '[data-act]' ? this : null; }
        }
        let closed = 0;
        let app = 0;
        globalThis.Element = Element;
        globalThis.document = {
            addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
            querySelector() { return null; },
            querySelectorAll() { return []; },
        };
        globalThis.window = {
            close: new Proxy(function close() {}, { apply() { closed++; } }),
            studioThing: () => { app++; },
        };
        try {
            IA.initInlineActions();
            const click = (act) => {
                const target = new Btn(act);
                const ev = { target, stopPropagation() {}, preventDefault() {}, defaultPrevented: false };
                for (const fn of listeners.click || []) { try { fn(ev); } catch { /* other delegates need a real DOM */ } }
            };
            click('close');
            assert.equal(closed, 0, 'clicking a data-act="close" button called window.close()');
            click('studioThing');
            assert.equal(app, 1, 'control: the delegate must still call app actions');
        } finally {
            Object.assign(globalThis, prev);
        }
    });
});

describe('the debug feature keeps its button vocabulary private', () => {
    const files = readdirSync(join(SRC, 'features/debug')).filter((f) => f.endsWith('.ts'));
    test('no data-act in features/debug', () => {
        const hits = files.filter((f) => /\bdata-act(?![-\w])/.test(code('features/debug/' + f)));
        assert.deepEqual(hits, [], `debug UI still uses the app-wide data-act attribute: ${hits.join(', ')}`);
    });
    test('the studios read their own attributes', () => {
        assert.match(code('features/debug/replay-studio.ts'), /closest\('\[data-rs-act\]'\)/);
        assert.match(code('features/debug/anim-studio.ts'), /closest\('\[data-anim-act\]'\)/);
    });
});

describe('every close path tears down what it installed', () => {
    test('DevTools: listeners on a signal, aborted on destroy; global tools undone; idempotent steps', () => {
        const ui = code('features/debug/debug-ui.ts');
        // No bare document/window listener left in the UI: each carries the teardown signal.
        // Each call is cut out by balancing its parentheses, so a multi-line handler is read whole.
        const calls = [];
        for (const m of ui.matchAll(/(?:document|window)\.addEventListener\(/g)) {
            let depth = 0, i = m.index + m[0].length - 1;
            for (; i < ui.length; i++) {
                if (ui[i] === '(') depth++;
                else if (ui[i] === ')' && --depth === 0) break;
            }
            calls.push(ui.slice(m.index, i + 1));
        }
        assert.ok(calls.length >= 8, 'the listener scan found too few calls to be reading the file');
        // The a11y reader pair is added and removed by its own toggle (and the toggle runs on close).
        const bare = calls.filter((c) => !/this\._on\(/.test(c) && !/_a11yMouse/.test(c)).map((c) => c.slice(0, 80));
        assert.deepEqual(bare, [], 'a document/window listener without the teardown signal');
        const destroy = ui.slice(ui.indexOf('    destroy() {'));
        assert.match(destroy, /this\._ac\?\.abort\(\)/, 'destroy() does not abort the listeners');
        assert.match(destroy, /this\._undoGlobalTools\(\)/, 'destroy() leaves the CSS/a11y tools applied to the app');
        assert.match(destroy, /for \(const step of steps\)\s*\{\s*try/, 'destroy() steps are not isolated');
        assert.match(destroy, /unsubscribe\(this\._hubSub\)/);
        assert.match(destroy, /disposeSessionPane/);
        assert.match(destroy, /close_devtools'\)\)\.catch/, 'the close_devtools promise rejection is unhandled');
        const undo = ui.slice(ui.indexOf('    _undoGlobalTools() {'));
        for (const cls of ['bmm-debug-pink', 'bmm-debug-interactive', 'bmm-layout-grid', 'bmm-show-zindex']) {
            assert.ok(undo.slice(0, 2500).includes(cls), `closing DevTools leaves ${cls} on the app`);
        }
    });

    test('Replay Studio: close stops the meter, the picker, the recorder and its listeners', () => {
        const rs = code('features/debug/replay-studio.ts');
        const close = rs.slice(rs.indexOf('export function closeReplayStudio'));
        for (const must of ['cancelPick', 'stopMeter()', 'unsubscribeReplay', 'hideNoRecord(false)', 'studioAC?.abort()', 'bar?.remove()']) {
            assert.ok(close.includes(must), `closeReplayStudio does not run ${must}`);
        }
        assert.match(close, /for \(const step of steps\)\s*\{\s*try/, 'close steps are not isolated');
        // The pre-snapshot hide is undone even when the recorder fails to start.
        const start = rs.slice(rs.indexOf('export async function studioStart'), rs.indexOf('export function studioPause'));
        assert.match(start, /finally\s*\{\s*hideNoRecord\(false\)/, 'a failed start leaves the studios hidden');
        // The frame's window listeners carry the studio signal.
        assert.match(rs, /addEventListener\('pointermove', move, \{ signal \}\)/);
    });

    test('Animation Studio: close cancels a pick in progress and resets preview motion', () => {
        const an = code('features/debug/anim-studio.ts');
        const close = an.slice(an.indexOf('export function closeAnimStudio'));
        assert.ok(close.includes('cancelPick?.()'), 'closing mid-pick leaves a capture click listener eating the next click');
        assert.ok(close.includes('killTweensOf'), 'closing leaves preview tweens running');
        // An empty selector no longer means "every element on the page".
        assert.doesNotMatch(an, /\*:not\(html\):not\(body\)/);
    });
});

describe('registerDebugSection', () => {
    test('queues before the menu exists, notifies after, validates, unregisters', async () => {
        const M = await js('features/debug/debug-sections.js');
        const before = M.getDebugSections().length;
        const off1 = M.registerDebugSection({ id: 'queued', titleKey: 'x.y', mount() {} });
        assert.equal(M.getDebugSections().length, before + 1, 'a section registered early is not kept');
        const seen = [];
        const unwatch = M.watchDebugSections((c) => seen.push(`${c.kind}:${c.section.id}`));
        const off2 = M.registerDebugSection({ id: 'late', titleKey: 'x.z', mount() {}, unmount() {} });
        assert.deepEqual(seen, ['add:late']);
        // Re-registering an id replaces it (remove, then add).
        M.registerDebugSection({ id: 'late', titleKey: 'x.z2', mount() {} });
        assert.deepEqual(seen, ['add:late', 'remove:late', 'add:late']);
        off2(); // stale unregister of the replaced entry is a no-op
        assert.ok(M.getDebugSections().some((s) => s.id === 'late' && s.titleKey === 'x.z2'));
        unwatch();
        off1();
        assert.ok(!M.getDebugSections().some((s) => s.id === 'queued'));
        assert.throws(() => M.registerDebugSection({ id: 'bad id!', titleKey: 'k', mount() {} }));
        assert.throws(() => M.registerDebugSection({ id: 'ok', titleKey: '', mount() {} }));
        assert.throws(() => M.registerDebugSection({ id: 'ok', titleKey: 'k' }));
    });

    test('exported from debug-menu.ts with the agreed signature', () => {
        const menu = src('features/debug/debug-menu.ts');
        assert.match(menu, /export \{ registerDebugSection[^}]*\} from '\.\/debug-sections\.js'/);
        const reg = src('features/debug/debug-sections.ts');
        assert.match(reg, /id: string;/);
        assert.match(reg, /titleKey: string;/);
        assert.match(reg, /icon\?: string;/);
        assert.match(reg, /mount: \(host: HTMLElement\) => void \| Promise<void>;/);
        assert.match(reg, /unmount\?: \(\) => void;/);
        // debug-menu must not pull the large UI module into the boot path.
        assert.doesNotMatch(code('features/debug/debug-menu.ts'), /^import[^;]*debug-ui\.js/m);
    });
});
