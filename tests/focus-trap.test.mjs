// Keyboard in the dialogs added with the launch deck, the activation order, the Storage Manager
// tabs, the scheduler's first-task question and the AI suggestions (QA pass, 2026-09-29).
//
// Measured in the running app before the fixes: Tab walked out of every one of them onto the
// title bar and the sidebar behind (they all say aria-modal="true"); the Storage Manager did not
// close on Escape; ticking a row of the AI suggestions dropped the focus to the page; and a
// "Learn more" pressed inside the activation order or the scheduler's question left a hidden
// dialog holding the keyboard (↑/↓ swallowed app-wide, the next Escape threw the task editor
// open over the docs).
//
// The wrap rule is the compiled module, loaded in plain node (import-free on purpose). The
// wiring is read from the sources, the way sched-game-hold.test.mjs reads the scheduler.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const F = await import(pathToFileURL(join(ROOT, 'frontend/js/ui/focus-trap.js')).href);

describe('focus trap: where Tab goes', () => {
  test('forward from the last stop wraps to the first, backward from the first to the last', () => {
    assert.equal(F.wrapIndex(4, 3, false), 0);
    assert.equal(F.wrapIndex(4, 0, true), 3);
  });
  test('in the middle the browser moves the focus itself', () => {
    assert.equal(F.wrapIndex(4, 1, false), -1);
    assert.equal(F.wrapIndex(4, 2, true), -1);
  });
  test('focus outside the dialog is brought in: first stop forward, last backward', () => {
    assert.equal(F.wrapIndex(4, -1, false), 0);
    assert.equal(F.wrapIndex(4, -1, true), 3);
  });
  test('a single stop keeps the focus; no stop is left alone', () => {
    assert.equal(F.wrapIndex(1, 0, false), 0);
    assert.equal(F.wrapIndex(1, 0, true), 0);
    assert.equal(F.wrapIndex(0, -1, false), -1);
  });
});

describe('the dialogs use it', () => {
  const ORDER = read('frontend/src/features/profiles/load-order.ts');
  const STORAGE = read('frontend/src/features/settings/storage-modal.ts');
  const SCHED = read('frontend/src/features/settings/scheduler.ts');
  const AI = read('frontend/src/features/ai/ai-suggest.ts');

  test('activation order: trapped, and gated on being ON SCREEN (a Learn more hides it)', () => {
    assert.match(ORDER, /installFocusTrap\(ov, shown\)/);
    assert.match(ORDER, /const shown = \(\): boolean => _open === ov && ov\.isConnected && ov\.classList\.contains\('open'\)/);
    assert.match(ORDER, /if \(e\.key === 'Escape' && shown\(\)\)/, 'Escape only while it is on screen');
    assert.match(ORDER, /\}, shown\);/, 'its Alt+arrow commands only while it is on screen');
    // Opened again after the docs: the hidden view comes back with its draft.
    assert.match(ORDER, /if \(_open\) \{\s*[^}]*_open\.classList\.add\('open'\)/);
  });

  test('Storage Manager: trapped, and Escape closes it unless a menu or a dialog over it took the key', () => {
    assert.match(STORAGE, /installFocusTrap\(ov, \(\) => isOpen\(\) && ownsFocus\(ov\)\)/);
    assert.match(STORAGE, /e\.key !== 'Escape' \|\| e\.defaultPrevented \|\| !isOpen\(\) \|\| !ownsFocus\(ov\)/);
    // The custom <select> marks the Escape that closed its menu as handled.
    const CSEL = read('frontend/src/ui/custom-select.ts');
    const esc = CSEL.slice(CSEL.indexOf("if (e.key !== 'Escape' || !_openCsel) return;"));
    assert.ok(esc.indexOf('e.preventDefault();') > 0 && esc.indexOf('e.preventDefault();') < esc.indexOf('closeOpen();'));
  });

  test('scheduler first-task question: Learn more ends it instead of leaving it listening', () => {
    const ask = SCHED.slice(SCHED.indexOf('function askEditorMode('), SCHED.indexOf('function modeIcon('));
    assert.match(ask, /ov\.addEventListener\(LEARN_MORE_EVENT, \(\) => done\('away'\)\)/);
    assert.match(ask, /if \(!ov\.isConnected \|\| !ov\.classList\.contains\('open'\)\) return;/);
    assert.match(ask, /ov\.contains\(document\.activeElement\)/, '↑/↓ only when the focus is in the question');
    assert.match(ask, /installFocusTrap\(ov,/);
    assert.match(SCHED, /if \(m === 'away'\) return;/, 'the editor does not open behind the docs');
  });

  test('AI suggestions: modal, trapped, and the focus survives a redraw', () => {
    assert.match(AI, /role="dialog" aria-modal="true"/);
    assert.match(AI, /installFocusTrap\(o,/);
    assert.match(AI, /had\.dataset\.row \? `input\[data-row="\$\{CSS\.escape\(had\.dataset\.row\)\}"\]`/);
  });
});

describe('the AI card keeps its fold after a redraw', () => {
  test('render() folds again', () => {
    const S = read('frontend/src/features/ai/ai-settings.ts');
    const render = S.slice(S.indexOf('function render('), S.indexOf('function read('));
    assert.ok((render.match(/refold\(\);/g) || []).length >= 2, 'both exits of render() fold the card again');
    assert.match(S, /initCollapsibleSettingsCards\(\)/);
  });
});

describe('boot: the bridge before anything that invokes', () => {
  test('main() loads the Tauri bridge before the link registry', () => {
    // loadLinks() invokes get_bc_config and fetch_remote_json; invoke() waits up to 5 s for a
    // bridge only loadTauri() provides. In the other order every launch sat through ~15 s.
    const APP = read('frontend/src/ui/app.ts');
    const main = APP.slice(APP.indexOf('async function main()'));
    const bridge = main.indexOf('await loadTauri();');
    const links = main.indexOf('await loadLinks();');
    assert.ok(bridge > 0 && links > 0, 'both calls are in main()');
    assert.ok(bridge < links, 'loadTauri() comes first');
    assert.equal((main.match(/await loadTauri\(\);/g) || []).length, 1, 'and only once');
  });
});
