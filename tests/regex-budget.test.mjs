// A regex from a task runs with a time budget (regex-budget.ts), so a catastrophic pattern from
// an imported task cannot freeze BMM (security pass, Sept 2026: scheduler.ts ran `new RegExp(p)`
// on the UI thread in text.extract, the fileContains condition and `textIs … matches`).
//
// The budget is exercised for real: the worker here is a Node worker_threads Worker running the
// compiled regex-worker logic, and the pattern is (a+)+$ against 30 `a`s and a `!` — which
// backtracks for far longer than any test would wait.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_JS = pathToFileURL(join(ROOT, 'frontend/js/features/settings/regex-budget.js')).href;
const R = await import(BUDGET_JS);
const SCHED_TS = readFileSync(join(ROOT, 'frontend/src/features/settings/scheduler.ts'), 'utf8');

/** The browser Worker API over a Node worker running runRegexOp, as regex-worker.ts does. */
function nodeWorker() {
  const w = new Worker(`
    const { parentPort } = require('node:worker_threads');
    import(${JSON.stringify(BUDGET_JS)}).then((m) => {
      parentPort.on('message', (req) => parentPort.postMessage(m.runRegexOp(req)));
      parentPort.postMessage('ready');
    });`, { eval: true });
  const like = { onmessage: null, postMessage: (m) => pending.push(m), terminate: () => { void w.terminate(); } };
  const pending = [];
  let ready = false;
  w.on('message', (m) => {
    if (m === 'ready') { ready = true; for (const p of pending.splice(0)) w.postMessage(p); return; }
    like.onmessage?.({ data: m });
  });
  like.postMessage = (m) => { if (ready) w.postMessage(m); else pending.push(m); };
  // A worker keeps Node alive; the test process must end when the tests do. After the
  // listener: adding a 'message' listener refs the worker again.
  w.unref();
  return like;
}

const EVIL = { op: 'test', pattern: '(a+)+$', flags: '', hay: 'a'.repeat(30) + '!' };

describe('the budget', () => {
  test('a catastrophic pattern comes back as a timeout, and quickly', async () => {
    const run = R.makeBudgetRunner(nodeWorker, 1500);
    const t0 = Date.now();
    const r = await run(EVIL);
    assert.deepEqual(r, { ok: false, error: 'timeout' });
    assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms`);
    // …and the next pattern gets a fresh worker and a real answer.
    assert.deepEqual(await run({ op: 'last', pattern: 'server (\\w+)', flags: 'g', hay: 'server one\nserver two', group: 1 }),
      { ok: true, hit: true, value: 'two' });
  });

  test('an ordinary pattern is answered, an invalid one says so', async () => {
    const run = R.makeBudgetRunner(nodeWorker, 3000);
    assert.deepEqual(await run({ op: 'test', pattern: 'joined', flags: 'i', hay: 'Player JOINED' }), { ok: true, hit: true, value: '' });
    assert.deepEqual(await run({ op: 'test', pattern: '(', flags: '', hay: 'x' }), { ok: false, error: 'invalid' });
  });

  test('without workers, the dangerous shape is refused rather than run on the UI thread', async () => {
    const saved = globalThis.Worker;
    globalThis.Worker = undefined;
    try {
      const fresh = await import(`${BUDGET_JS}?noworker=${Date.now()}`);
      assert.deepEqual(await fresh.regexWithBudget(EVIL), { ok: false, error: 'timeout' });
      assert.deepEqual(await fresh.regexWithBudget({ op: 'test', pattern: 'a+', flags: '', hay: 'aa' }), { ok: true, hit: true, value: '' });
    } finally { globalThis.Worker = saved; }
  });
});

describe('the static warning the editors show', () => {
  test('nested repetition is flagged, ordinary patterns are not', () => {
    for (const p of ['(a+)+$', '(\\w*)*x', '(x+|y)+', '(a{1,})+', '((ab)*)+']) assert.equal(R.regexProblem(p), 'nested', p);
    for (const p of ['server (\\w+)', '^\\d{3}$', '(abc)+', '[a+]+', 'joined']) assert.equal(R.regexProblem(p), null, p);
    assert.equal(R.regexProblem('('), 'invalid');
  });
});

describe('the three places a task pattern runs', () => {
  test('none of them builds a RegExp on the UI thread any more', () => {
    const extract = SCHED_TS.slice(SCHED_TS.indexOf("case 'text.extract':"), SCHED_TS.indexOf("case 'modlist.apply':"));
    const contains = SCHED_TS.slice(SCHED_TS.indexOf("case 'fileContains':"), SCHED_TS.indexOf("case 'textIs':"));
    const textIs = SCHED_TS.slice(SCHED_TS.indexOf("case 'textIs':"), SCHED_TS.indexOf("case 'online':"));
    for (const [name, body] of [['text.extract', extract], ['fileContains', contains], ['textIs', textIs]]) {
      assert.ok(body.length > 50, `${name} not found`);
      assert.doesNotMatch(body, /new RegExp\(/, `${name} still runs the pattern itself`);
      assert.match(body, /regexWithBudget\(/, `${name} does not use the budget`);
    }
  });
  test('a condition whose pattern ran out of time fails the step instead of reading as "no"', () => {
    const contains = SCHED_TS.slice(SCHED_TS.indexOf("case 'fileContains':"), SCHED_TS.indexOf("case 'textIs':"));
    assert.match(contains, /error === 'timeout'\) throw new Error/);
  });
});
