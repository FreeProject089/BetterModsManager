// Game mode can hold scheduled tasks (GameOptions.hold_scheduler, off by default): a task that
// falls due while a game runs is owed and runs once when game mode ends; a run by hand is never held.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = await import(pathToFileURL(join(ROOT, 'frontend/js/features/settings/sched-why.js')).href);
const SCHED_TS = readFileSync(join(ROOT, 'frontend/src/features/settings/scheduler.ts'), 'utf8');
const CONFIG_RS = readFileSync(join(ROOT, 'src-tauri/src/governor/config.rs'), 'utf8');

describe('when game mode holds tasks', () => {
  test('only while game mode is on AND the option is ticked', () => {
    assert.equal(W.gameHoldsTasks({ game_active: true, game_options: { hold_scheduler: true } }), true);
    assert.equal(W.gameHoldsTasks({ game_active: false, game_options: { hold_scheduler: true } }), false);
    assert.equal(W.gameHoldsTasks({ game_active: true, game_options: { hold_scheduler: false } }), false);
    assert.equal(W.gameHoldsTasks({ game_active: true, game_options: {} }), false, 'an older governor: not held');
    assert.equal(W.gameHoldsTasks(null), false, 'no status: never held');
  });

  test('the option exists on the Rust side, off by default', () => {
    assert.match(CONFIG_RS, /#\[serde\(default\)\]\s*pub hold_scheduler: bool,/);
    assert.match(CONFIG_RS, /hold_scheduler: false \}/);
  });

  test('a held run is owed, not lost, and runs when game mode ends', () => {
    const tick = SCHED_TS.slice(SCHED_TS.indexOf('async function tick('), SCHED_TS.indexOf('export async function getTasks('));
    assert.match(tick, /gameHoldsTasks\(await \(invoke\('resources_status'\)/);
    assert.match(tick, /if \(held\) \{ _owed\.add\(task\.id\);/);
    assert.ok(tick.indexOf('if (!held && _owed.size)') > 0, 'owed runs are not replayed');
    // Hand runs do not go through tick.
    const byId = SCHED_TS.slice(SCHED_TS.indexOf('export async function runTaskById('), SCHED_TS.indexOf('async function syncOsSchedule('));
    assert.doesNotMatch(byId, /gameHoldsTasks|_owed/);
  });
});

describe('what the list shows for a held task', () => {
  const soon = () => Date.now() + 60000;
  test('a held (owed) task shows the reason, whatever its trigger', () => {
    // An interval task that never ran used to show "in 1 min", rolling forward for as long as
    // the game ran, while it was overdue and waiting (QA pass, 2026-09-29).
    assert.equal(W.listNextRun({ enabled: true, manual: false, owed: true }, soon), null);
  });
  test('otherwise the next time, as before', () => {
    const at = W.listNextRun({ enabled: true, manual: false, owed: false }, () => 42);
    assert.equal(at, 42);
    assert.equal(W.listNextRun({ enabled: false, manual: false, owed: false }, soon), null, 'disabled');
    assert.equal(W.listNextRun({ enabled: true, manual: true, owed: false }, soon), null, 'manual');
  });
  test('the list asks it, with the owed set', () => {
    const chip = SCHED_TS.slice(SCHED_TS.indexOf('function nextRunChip('), SCHED_TS.indexOf('function nextRunChip(') + 600);
    assert.match(chip, /listNextRun\(\{ enabled: !!task\.enabled, manual: task\.trigger\.type === 'manual', owed: _owed\.has\(task\.id\) \}/);
  });
});
