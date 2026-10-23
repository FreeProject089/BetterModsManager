// The first task asks which editor (sched-modes.ts), and the answer is a setting.
//
// Owner's request, Sept 2026: the very first time somebody creates a task, ask their preferred
// editing mode — Flux marked Recommended, then BMMScript, then Blocs, one line each — remember
// it, and let Settings and the mode switch change it later.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/features/settings/sched-modes.js')).href);
const SCHED_TS = readFileSync(join(ROOT, 'frontend/src/features/settings/scheduler.ts'), 'utf8');
const EN = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/en.json'), 'utf8'));
const FR = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/fr.json'), 'utf8'));

const store = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
};

describe('the question', () => {
  test('Flow first and recommended, then BMMScript, then Blocks', () => {
    assert.deepEqual(M.MODE_CHOICES.map((c) => c.mode), ['flow', 'code', 'bricks']);
    assert.deepEqual(M.MODE_CHOICES.map((c) => c.recommended), [true, false, false]);
  });

  test('each choice has a title and a one-line description, in both languages', () => {
    for (const c of M.MODE_CHOICES) {
      for (const [name, dict] of [['en', EN], ['fr', FR]]) {
        assert.ok(dict[c.titleKey], `${name}: ${c.titleKey}`);
        assert.ok(dict[c.descKey], `${name}: ${c.descKey}`);
        assert.ok(!dict[c.descKey].includes('\n'), 'one line');
      }
    }
    assert.equal(FR['sched.modes.flow'], 'Flux');
    assert.equal(FR['sched.modes.recommended'], 'Recommandé');
  });

  test('asked for the very first task only', () => {
    assert.equal(M.needsModePrompt(store(), { isNew: true, taskCount: 0 }), true);
    assert.equal(M.needsModePrompt(store(), { isNew: false, taskCount: 0 }), false, 'opening a saved task never asks');
    assert.equal(M.needsModePrompt(store(), { isNew: true, taskCount: 3 }), false, 'somebody with tasks is not onboarded');
    assert.equal(M.needsModePrompt(store({ [M.MODE_ASKED_KEY]: '1' }), { isNew: true, taskCount: 0 }), false, 'asked once');
  });

  test('the answer is remembered, marks the question answered, and junk reads as Blocks', () => {
    const s = store();
    M.writeMode(s, 'flow');
    assert.equal(M.readMode(s), 'flow');
    assert.equal(s.getItem(M.MODE_ASKED_KEY), '1');
    assert.equal(M.needsModePrompt(s, { isNew: true, taskCount: 0 }), false);
    assert.equal(M.readMode(store({ [M.MODE_KEY]: 'sideways' })), 'bricks');
    assert.equal(M.MODE_KEY, 'bmm.sched.editorMode', 'the old key: nobody loses the mode they used');
  });
});

describe('wired into the editor', () => {
  const open = SCHED_TS.slice(SCHED_TS.indexOf('async function openTaskModal('), SCHED_TS.indexOf('\nfunction refreshDirty('));
  test('a NEW task asks before the editor is drawn, and saves the answer', () => {
    assert.ok(open.length > 200, 'openTaskModal not found');
    const ask = open.indexOf('if (needsModePrompt(store, { isNew: true, taskCount: _tasks.length }))');
    assert.ok(ask > 0, 'openTaskModal does not ask (or asks under a condition that is not the first task)');
    assert.ok(open.indexOf('askEditorMode()') > ask);
    assert.ok(open.indexOf('writeEditorMode(m)') > ask);
    assert.ok(open.indexOf('renderModal(modal)') > ask, 'asked before the editor opens in a mode');
  });
  test('the editor reads and writes the preference through sched-modes', () => {
    assert.match(SCHED_TS, /function readEditorMode\(\)[^{]*\{\s*try \{ return readMode\(localStorage\)/);
    assert.match(SCHED_TS, /function writeEditorMode\(m: EditorMode\)[^{]*\{\s*try \{ writeMode\(localStorage, m\)/);
  });
  test('a setting in the scheduler card changes it', () => {
    assert.match(SCHED_TS, /id="sched-mode-pref"/);
    assert.match(SCHED_TS, /function renderModePref\(\)/);
  });
});
