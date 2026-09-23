// Task-level retry and the {last.*} variables (A2).
//
// scheduler.ts cannot be imported in Node (it reaches Tauri, the DOM and localStorage at import),
// so, like sched-export-privacy, this reads the COMPILED runner and checks the rules where they
// are applied: what is retried, what never is, the bounds, and that every action leaves
// {last.ok} / {last.ms} behind for the next step, success or failure.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../frontend/js/features/settings/scheduler.js'), 'utf8');
const slice = (from, len = 4000) => { const i = src.indexOf(from); assert.notEqual(i, -1, `${from} is gone`); return src.slice(i, i + len); };

describe('task-level retry', () => {
  const run = slice('async function runTask(');

  test('a stop or a cancel is a decision and is never retried', () => {
    assert.match(run, /if \(e instanceof _StopTask \|\| e instanceof _CancelledTask \|\| attempt >= times\)\s*throw e;/);
  });

  test('attempts and backoff are clamped whatever the stored task says', () => {
    assert.match(run, /Math\.max\(0, Math\.min\(5, Math\.floor\(Number\(task\.retry\?\.times\) \|\| 0\)\)\)/);
    assert.match(run, /Math\.max\(5, Math\.min\(3600, Math\.floor\(Number\(task\.retry\?\.backoffSec\) \|\| 30\)\)\)/);
  });

  test('a retry starts from fresh variables but keeps what the event carried', () => {
    assert.match(run, /startsWith\('event\.'\)/);
    assert.match(run, /ctx\.nums\['retry\.task_attempt'\] = attempt \+ 1/);
  });

  test('the wait between attempts can be cancelled like any other wait', () => {
    assert.match(run, /await interruptibleSleep\(backoffMs, _running\.get\(task\.id\)\)/);
  });
});

describe('{last.*} after every action', () => {
  const rec = slice('async function recordedAction(', 1600);

  test('last.ok and last.ms are written on success AND on failure', () => {
    assert.equal((rec.match(/ctx\.nums\['last\.ok'\] = 1/g) || []).length, 1);
    assert.equal((rec.match(/ctx\.nums\['last\.ok'\] = 0/g) || []).length, 1);
    assert.equal((rec.match(/ctx\.nums\['last\.ms'\] =/g) || []).length, 2);
  });

  test('last.out is capped', () => {
    assert.match(slice('function _captureOutput(', 600), /ctx\.text\['last\.out'\] = String\(out \?\? ''\)\.trim\(\)\.slice\(0, 64 \* 1024\)/);
  });

  test('a condition can read them: they are value sources', () => {
    const vs = slice('const VALUE_SOURCES = [', 1500);
    for (const k of ['last.ok', 'last.ms', 'retry.task_attempt']) assert.ok(vs.includes(`'${k}'`), `${k} is not offered`);
  });
});
