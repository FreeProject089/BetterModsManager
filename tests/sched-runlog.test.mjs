// The scheduler's run record (sched-runlog.ts): what a run writes to its log, and above all what
// it never writes. A run log is the thing people paste into a bug report, so an error message
// that quoted a URL with a token, an Authorization header or a password must arrive redacted.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { redact, newRun, startStep, endStep, finishRun, MAX_STEPS } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/features/settings/sched-runlog.js')).href
);

describe('redact', () => {
  test('secrets in http headers and credentials never reach the log', () => {
    const cases = [
      ['Authorization: Bearer abc.def.ghi', /abc\.def/],
      ['request failed (bearer sk_live_0123456789abcdef)', /sk_live/],
      ['GET https://api.example.com/v1/items?token=s3cr3t&page=2 -> 401', /s3cr3t/],
      ['https://user:hunter2@repo.example.com/x failed', /hunter2/],
      ['password=hunter2 rejected', /hunter2/],
      ['api_key: "AKIA0000FAKE"', /AKIA0000FAKE/],
      ['token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl expired', /eyJhbGci/],
      ['key 0123456789abcdef0123456789abcdef0123456789abcdef in use', /0123456789abcdef0123/],
    ];
    for (const [input, leak] of cases) {
      const out = redact(input);
      assert.doesNotMatch(out, leak, `leaked from: ${input} -> ${out}`);
    }
  });

  test('ordinary text is left readable', () => {
    assert.equal(redact('Mod "Better Cities" enabled in 3.2s'), 'Mod "Better Cities" enabled in 3.2s');
    assert.equal(redact('https://example.com/path'), 'https://example.com/path', 'a URL without a query keeps its path');
    assert.ok(redact('x'.repeat(2000)).length <= 501, 'capped');
  });
});

describe('a run record', () => {
  test('records each action step with status, duration and a redacted error', () => {
    const run = newRun('task-1', 'dailyAt', 1000);
    const a = startStep(run, 'Back up mods', 0, 1000);
    endStep(a, 'ok', undefined, 1120);
    const b = startStep(run, 'HTTP GET https://x.test/a?token=abc', 1, 1120);
    endStep(b, 'error', new Error('401 for https://x.test/a?token=abc'), 1160);
    finishRun(run, 'error: 401', 1200);
    assert.equal(run.steps.length, 2);
    assert.deepEqual([run.steps[0].status, run.steps[0].ms], ['ok', 120]);
    assert.deepEqual([run.steps[1].status, run.steps[1].ms, run.steps[1].depth], ['error', 40, 1]);
    assert.doesNotMatch(JSON.stringify(run), /token=abc/, 'neither the label nor the error keeps the token');
    assert.equal(run.ok, false);
    assert.equal(run.ms, 200);
  });

  test('a loop cannot turn one record into a flood', () => {
    const run = newRun('t', 'manual', 0);
    for (let i = 0; i < MAX_STEPS + 50; i++) endStep(startStep(run, `step ${i}`, 0, i), 'ok', undefined, i + 1);
    assert.equal(run.steps.length, MAX_STEPS);
    assert.equal(startStep(run, 'one more', 0), null);
    endStep(null, 'error', 'ignored'); // closing a step past the cap is harmless
  });

  test('an ok run is ok, anything else is not', () => {
    assert.equal(finishRun(newRun('t', 'x'), 'ok').ok, true);
    assert.equal(finishRun(newRun('t', 'x'), 'cancelled at step 2').ok, false);
  });
});
