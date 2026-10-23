// The Test button of a step (sched-test.ts + the two places that draw it).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const T = await import(pathToFileURL(join(ROOT, 'frontend/js/features/settings/sched-test.js')).href);
const SCHED_TS = readFileSync(join(ROOT, 'frontend/src/features/settings/scheduler.ts'), 'utf8');
const FLOW_TS = readFileSync(join(ROOT, 'frontend/src/features/settings/sched-flow.ts'), 'utf8');
const EDITOR_CSS = readFileSync(join(ROOT, 'frontend/css/sched-editor.css'), 'utf8');
const FLOW_CSS = readFileSync(join(ROOT, 'frontend/css/sched-flow.css'), 'utf8');

const W = { ok: 'It worked', fail: 'It failed', stopped: 'Stopped' };
const act = (type, params = {}) => ({ kind: 'action', action: { type, params } });

describe('what a test says', () => {
  test('a webhook: the status and the first words of the answer', () => {
    const r = T.testOutcome({ nums: { 'http.status': 201 }, text: { 'http.body': '{"ok":true,\n "id": 7}' } }, undefined, W);
    assert.deepEqual(r, { ok: true, status: 201, excerpt: '{"ok":true, "id": 7}', message: 'It worked' });
  });
  test('a failure carries its reason, and the status when there was one', () => {
    const r = T.testOutcome({ nums: { 'http.status': 500 }, text: {} }, new Error('HTTP 500 from x.example'), W);
    assert.equal(r.ok, false);
    assert.equal(r.status, 500);
    assert.match(r.message, /^It failed — HTTP 500/);
  });
  test('a guard clause that stops the task is not a failure', () => {
    class Stop {}
    assert.equal(T.testOutcome({ nums: {}, text: {} }, new Stop(), W, (e) => e instanceof Stop).ok, true);
  });
  test('a long answer is cut to one line', () => {
    const r = T.testOutcome({ nums: {}, text: { 'last.out': 'x'.repeat(500) } }, undefined, W);
    assert.ok(r.excerpt.length <= 160);
  });
});

describe('which tests ask first', () => {
  test('messages and computations run straight away', () => {
    for (const type of ['webhook.send', 'discord.send', 'slack.send', 'notify', 'log.print', 'math.set', 'text.extract']) {
      assert.equal(T.testNeedsConfirm(act(type)), false, type);
    }
    assert.equal(T.testNeedsConfirm(act('http.request', { method: 'GET' })), false);
  });
  test('anything that changes something asks', () => {
    for (const type of ['profile.delete', 'mod.enable', 'custom.command', 'app.launch', 'restart']) {
      assert.equal(T.testNeedsConfirm(act(type)), true, type);
    }
    assert.equal(T.testNeedsConfirm(act('http.request', { method: 'POST' })), true);
    assert.equal(T.testNeedsConfirm({ kind: 'if', condition: {}, then: [], else: [] }), true, 'a block runs its body');
  });
});

describe('the path from the button to the run', () => {
  test('the brick’s Test button and the flow’s go through testOneStep', () => {
    const run1 = SCHED_TS.slice(SCHED_TS.indexOf("tools.querySelector('.sched-run1')"), SCHED_TS.indexOf("tools.querySelector('.sched-bp')"));
    assert.match(run1, /paintBrickTest\(block, null\)/, 'the pulse starts before the run');
    assert.match(run1, /paintBrickTest\(block, await testOneStep\(step\)\)/);
    assert.match(SCHED_TS, /testStep: async \(path: string\) => \{[\s\S]{0,200}testOneStep\(st\)/);
    const one = SCHED_TS.slice(SCHED_TS.indexOf('async function testOneStep('), SCHED_TS.indexOf('function paintBrickTest('));
    assert.ok(one.indexOf('testNeedsConfirm(') < one.indexOf('runSteps('), 'asks before it runs');
    assert.match(one, /disabled: false/, 'a switched-off step can still be tested');
    assert.match(one, /id: `\$\{_draft\.id \|\| 'draft'\}#test`/, 'isolated from a real run of the task');
  });
  test('the flow pulses the node, then shows the verdict', () => {
    const run = FLOW_TS.slice(FLOW_TS.indexOf('async function runNodeTest('), FLOW_TS.indexOf('function paintTestOut('));
    assert.ok(run.indexOf("_tests.set(path, 'testing')") < run.indexOf('h.testStep(path)'));
    assert.match(run, /_tests\.set\(path, res\.ok \? 'ok' : 'fail'\)/);
    assert.match(FLOW_TS, /is-test-\$\{test\}/);
  });
  test('the pulse has a still equivalent under reduced motion', () => {
    for (const [css, sel] of [[EDITOR_CSS, '.sched-step.sched-testing'], [FLOW_CSS, '.sflow-node.is-test-testing']]) {
      const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
      assert.ok(reduced.includes(sel) && /animation: none/.test(reduced), sel);
    }
  });
});
