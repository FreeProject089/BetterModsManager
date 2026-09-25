// Security summary §9 #15: the generic scheduler `deeplink` step is removed.
//
// It dispatched a window event and a Tauri event that nothing listened to, so it never did
// anything; the catalogue steps that shared its helper did nothing either. The in-docs deep
// links called a function the module does not export. And `view.open` took any `dl:<path>`,
// query string included, and fired it as the trusted `scheduler` origin — the same generic
// step under another name.
//
// What must hold now:
//   · the step is gone from the registry, the presets and every generated vocabulary;
//   · a saved task that has it still loads and runs: the case stays (declared retired),
//     skips with a warning, and throws nothing — the steps after it still run;
//   · the editor shows it as REMOVED, not as the first action of the list;
//   · the link helper reaches the real handler, or fails loudly — never a dead event;
//   · `view.open` opens only the windows its picker lists;
//   · a link in the docs goes through `window.__bmmDeeplink` with no trusted origin.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const src = read('frontend/src/features/settings/scheduler.ts');
// Whole-line comments blanked, so a word in a comment is never read as code.
const bare = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/[^\n]*$/gm, (m) => m.replace(/[^\n]/g, ' '));

function block(text, start, open = '{', close = '}') {
    const s = text.indexOf(start);
    assert.ok(s >= 0, `${start} not found`);
    const o = text.indexOf(open, s + start.length - 1);
    let d = 0;
    for (let i = o; i < text.length; i++) {
        if (text[i] === open) d++;
        else if (text[i] === close && --d === 0) return text.slice(s, i + 1);
    }
    throw new Error(`${start} is not closed`);
}

describe('the step is gone from what can be chosen', () => {
    test('ACTION_TYPES has no deeplink entry', () => {
        // From the initialiser, not the first '[': the type annotation `…}[]` comes first, and a
        // probe that stops there reads an empty registry and passes (it did, once).
        const at = bare.indexOf('= [', bare.indexOf('const ACTION_TYPES'));
        const reg = block(bare.slice(at), '= [', '[', ']');
        assert.ok(reg.length > 2000 && /v:\s*'profile\.activate'/.test(reg), 'the registry probe reads nothing');
        assert.ok(!/v:\s*'deeplink'/.test(reg), 'deeplink is still offered in the action registry');
    });
    test('no preset builds a deeplink step', () => {
        assert.ok(!/type:\s*'deeplink'/.test(bare), 'a preset or default still creates a deeplink step');
    });
    test('no generated vocabulary lists it', () => {
        const mcp = JSON.parse(read('src-tauri/src/mcp/actions.gen.json'));
        const list = Array.isArray(mcp) ? mcp : (mcp.actions || []);
        assert.ok(list.length > 50, 'actions.gen.json shape changed; this probe reads nothing');
        assert.ok(!list.some((a) => a.type === 'deeplink'), 'MCP bmm_list_actions still offers deeplink');
        const vocab = JSON.parse(read('dist-assets/bmms-vocabulary.json'));
        assert.ok(!(vocab.actions || []).some((a) => a.type === 'deeplink'), 'bmms-vocabulary.json still lists deeplink');
        assert.ok(!/"n":"deeplink"/.test(read('frontend/src/docs/bmms-reference.gen.ts')), 'the in-app BMMS index still lists deeplink');
        for (const doc of ['BMM Docs/docs/features/bmmscript-reference.md', 'BMM Docs/docs/features/bmmscript-reference.fr.md',
            'frontend/assets/docs/en/features/bmmscript-reference.md', 'frontend/assets/docs/fr/features/bmmscript-reference.md']) {
            let text = '';
            try { text = read(doc); } catch { continue; } // BMM Docs is a separate checkout
            assert.ok(!/^\|\s*`deeplink`\s*\|/m.test(text), `${doc} still documents the deeplink step`);
        }
    });
});

describe('a saved task with the step still loads and runs', () => {
    const run = block(bare, 'async function runAction');
    // From the retirement marker (a comment, so read from the raw source) to the next case.
    const raw = block(src, 'async function runAction');
    test('the case is kept and declared retired', () => {
        assert.match(raw, /@retired-action deeplink\s*\n\s*case 'deeplink':/, 'the deeplink case is gone or not declared retired');
    });
    test('it skips with a warning: no link fired, nothing thrown', () => {
        const i = run.indexOf("case 'deeplink':");
        const body = run.slice(i, run.indexOf('case ', i + 16));
        assert.ok(/toast\(/.test(body), 'a skipped removed step says nothing');
        assert.ok(!/\bthrow\b/.test(body), 'the removed step fails the task — the steps after it would not run');
        assert.ok(!/runDeepLink\(|\bdl\(|__bmmDeeplink/.test(body), 'the removed step still fires a link');
        assert.match(body, /\bbreak;/);
    });
    test('the editor and the run panel show it as removed', () => {
        const ed = block(bare, 'function actionEditor');
        const g = ed.indexOf('removedAction(');
        assert.ok(g > 0 && g < ed.indexOf('ACTION_TYPES[0]'), 'actionEditor falls back to the first action before checking for a removed one');
        assert.ok(block(bare, 'function stepLabel').includes('removedAction('), 'the running panel labels it as something else');
        const ra = bare.slice(bare.indexOf('const REMOVED_ACTIONS'));
        assert.match(ra.slice(0, ra.indexOf('};')), /\bdeeplink:/);
    });
});

describe('the link helper reaches the handler or fails', () => {
    test('runDeepLink uses the trusted dispatcher and no dead event', () => {
        const fn = block(bare, 'async function runDeepLink');
        assert.ok(!fn.includes('bmm:deeplink') && !fn.includes('scheme-request-received'),
            'runDeepLink still dispatches an event nothing listens to');
        assert.match(fn, /trustedLinkDispatcher\(\)/);
        assert.match(fn, /\bthrow\b/, 'a missing handler must fail the step, not pass it');
        assert.match(fn, /'scheduler'/);
    });
});

describe('view.open is typed', () => {
    test('a dl: place outside VIEW_WINDOWS is refused', () => {
        const run = block(bare, 'async function runAction');
        const i = run.indexOf("case 'view.open':");
        const body = run.slice(i, run.indexOf('\n        case ', i + 20));
        const d = body.indexOf("startsWith('dl:')");
        assert.ok(d > 0);
        const refuse = body.indexOf('VIEW_WINDOWS', d);
        const fire = body.indexOf('dl(name', d);
        assert.ok(refuse > 0 && refuse < fire, 'view.open fires a dl: path before checking it against VIEW_WINDOWS');
        assert.match(body.slice(refuse, fire), /\bthrow\b/);
    });
});

describe('links in the docs ask', () => {
    test('docs-hub goes through window.__bmmDeeplink with no trusted origin', () => {
        const hub = read('frontend/src/docs/docs-hub.ts');
        const i = hub.indexOf("hit('[data-deeplink]')");
        assert.ok(i > 0);
        const seg = hub.slice(i, hub.indexOf('return;\n  }', i));
        assert.ok(!/handleDeepLink/.test(seg.replace(/^\s*\/\/.*$/gm, '')), 'docs-hub still calls handleDeepLink, which the module does not export');
        assert.match(seg, /__bmmDeeplink/);
        assert.ok(!/'(scheduler|api|self)'/.test(seg), 'a docs link claims a trusted origin');
    });
});
