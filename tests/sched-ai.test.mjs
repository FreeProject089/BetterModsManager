// Laya in scheduled tasks (Oct 2026): the budget, the untrusted-answer rule, the labels and the
// `aiLabel` condition — and the permission, carried by every list that has to know it.
//
// The attack the taint rule exists for: a task runs `ai.ask` (or suggests metadata for a mod)
// and puts the answer into `custom.command`. The answer is built from text BMM does not
// control — a mod's readme, a file's words — so a crafted readme is one step away from a
// command line. The rule: a free-text AI result may be shown (a message, a log line, a file),
// never run, opened or used as an address.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const A = await import(pathToFileURL(join(ROOT, 'frontend/js/features/settings/sched-ai.js')).href);

describe('the run budget', () => {
  test('at most AI_MAX_STEPS steps, then refused', () => {
    const ctx = {};
    for (let i = 0; i < A.AI_MAX_STEPS; i++) assert.equal(A.takeAiStep(ctx), null);
    assert.equal(A.takeAiStep(ctx), 'steps');
  });
  test('at most AI_MAX_MS of waiting, then refused', () => {
    const ctx = {};
    A.chargeAiTime(ctx, A.AI_MAX_MS);
    assert.equal(A.takeAiStep(ctx), 'time');
    assert.equal(A.aiTimeLeft(ctx), 0);
  });
  test('each run has its own budget', () => {
    const a = {}, b = {};
    for (let i = 0; i < A.AI_MAX_STEPS; i++) A.takeAiStep(a);
    assert.equal(A.takeAiStep(b), null);
  });
});

describe('an AI answer is data, never a command', () => {
  test('a tainted variable is refused in a command, a script, a link', () => {
    const ctx = {};
    A.taint(ctx, 'answer');
    assert.equal(A.taintProblem('custom.command', { program: 'cmd', args: '/c {answer}' }, ctx), 'args');
    assert.equal(A.taintProblem('custom.script', { code: 'echo {answer}' }, ctx), 'code');
    assert.equal(A.taintProblem('open.url', { url: '{answer}' }, ctx), 'url');
    assert.equal(A.taintProblem('code.run', { code: 'do x({answer})' }, ctx), 'code');
    assert.equal(A.taintProblem('mod.add', { url: 'https://{answer}' }, ctx), 'url');
  });
  test('in a web request, the address and headers are refused, the body is not', () => {
    const ctx = {};
    A.taint(ctx, 'answer');
    assert.equal(A.taintProblem('http.request', { url: 'https://x/{answer}' }, ctx), 'url');
    assert.equal(A.taintProblem('webhook.send', { url: 'https://hooks.example/x', headers: 'X: {answer}' }, ctx), 'headers');
    assert.equal(A.taintProblem('discord.send', { url: 'https://discord.com/api/webhooks/1/x', message: 'Laya says: {answer}' }, ctx), null);
    assert.equal(A.taintProblem('log.print', { message: '{answer}' }, ctx), null);
    assert.equal(A.taintProblem('file.write', { path: 'C:/out.txt', text: '{answer}' }, ctx), null);
  });
  // Born red (review, Oct 1): the first version listed dangerous steps and missed these.
  test('a step that opens a file, backs up to a folder or reads a path refuses it too', () => {
    const ctx = {};
    A.taint(ctx, 'answer');
    assert.equal(A.taintProblem('file.open', { path: '{answer}' }, ctx), 'path');
    assert.equal(A.taintProblem('folder.open', { path: '{answer}' }, ctx), 'path');
    assert.equal(A.taintProblem('data.backup', { dir: '{answer}' }, ctx), 'dir');
    assert.equal(A.taintProblem('ai.classify', { path: '{answer}' }, ctx), 'path');
    assert.equal(A.taintProblem('file.write', { path: '{answer}', text: 'x' }, ctx), 'path');
    assert.equal(A.taintProblem('some.action.added.later', { anything: '{answer}' }, ctx), 'anything', 'unknown = refused');
  });
  test('a condition compares it, never reaches a path with it', () => {
    const ctx = {};
    A.taint(ctx, 'answer');
    assert.equal(A.condTaintProblem('textIs', { source: 'answer', value: '{answer}' }, ctx), null);
    assert.equal(A.condTaintProblem('fileExists', { path: '{answer}' }, ctx), 'path');
    assert.equal(A.condTaintProblem('pathIsDir', { path: '{answer}' }, ctx), 'path');
    assert.equal(A.condTaintProblem('all', { conditions: [] }, ctx), null);
  });
  test('a copy of AI text is AI text; a clean rewrite is clean again', () => {
    const ctx = {};
    A.taint(ctx, 'answer');
    A.propagateTaint({ name: 'cmd', value: 'run {answer}' }, ctx);
    assert.equal(A.taintProblem('custom.command', { program: '{cmd}' }, ctx), 'program', 'var.set laundering');
    assert.equal(A.taintProblem('custom.command', { program: '{last.out}' }, ctx), 'program');
    A.propagateTaint({ name: 'cmd', value: 'notepad' }, ctx);
    assert.equal(A.taintProblem('custom.command', { program: '{cmd}' }, ctx), null);
  });
  test('a shared variable keeps its taint across runs', () => {
    const ctx = {};
    assert.equal(A.taintProblem('custom.command', { program: '{saved}' }, ctx, ['saved']), 'program');
  });
  test('a label is not tainted: it is one of the task\'s own words', () => {
    const ctx = {};
    assert.equal(A.taintProblem('custom.command', { program: 'tool', args: '--mode {kind}' }, ctx), null);
  });
  test('refs are read at any depth', () => {
    assert.deepEqual([...A.refsIn({ a: ['x {b} {c.p}'], d: { e: '{f}' } })].sort(), ['b', 'c.p', 'f']);
  });
});

describe('labels and the aiLabel condition', () => {
  test('one per line with a meaning, or a comma list; none and duplicates dropped', () => {
    assert.deepEqual(A.parseLabels('crash: the game stops\nui: a screen is wrong\nnone\nCRASH'), [
      { id: 'crash', what: 'the game stops' }, { id: 'ui', what: 'a screen is wrong' },
    ]);
    assert.deepEqual(A.parseLabels('a, b ,, c').map((l) => l.id), ['a', 'b', 'c']);
  });
  test('holds on the label with p at least min', () => {
    const ctx = { text: { 'ai.label': 'crash', kind: 'ui' }, nums: { 'ai.p': 0.82, 'kind.p': 0.4 } };
    assert.equal(A.aiLabelHolds(ctx, { label: 'CRASH', min: 0.8 }), true);
    assert.equal(A.aiLabelHolds(ctx, { label: 'crash', min: 0.9 }), false);
    assert.equal(A.aiLabelHolds(ctx, { var: 'kind', label: 'ui', min: 0.3 }), true);
    assert.equal(A.aiLabelHolds(ctx, { var: 'kind', label: 'ui', min: 'abc' }), false, 'a bad min is 0.5');
    assert.equal(A.aiLabelHolds({ text: {}, nums: {} }, { label: 'crash' }), false, 'no classification yet');
  });
  test('an error code splits into key and reason', () => {
    assert.deepEqual(A.aiErrorParts(new Error('ai.task.blocked|game_mode')), ['ai.task.blocked', 'game_mode']);
  });
});

describe('the `ai` permission is everywhere a permission is', () => {
  const sched = readFileSync(join(ROOT, 'frontend/src/features/settings/scheduler.ts'), 'utf8');
  test('each AI step asks for it before calling Laya', () => {
    for (const type of ['ai.classify', 'ai.ask', 'ai.suggest_mod_metadata']) {
      const at = sched.indexOf(`case '${type}':`);
      assert.ok(at > 0, `${type} has no case in runAction`);
      const body = sched.slice(at, sched.indexOf('break;', at));
      const perm = body.indexOf("requirePerm(task, 'ai'");
      const call = body.indexOf('aiCall(');
      assert.ok(perm >= 0 && call > perm, `${type}: requirePerm('ai') must come before the call`);
    }
  });
  test('an imported task loses it', () => {
    const m = /export function sanitiseImportedTask[\s\S]*?\r?\n}\r?\n/.exec(sched);
    assert.ok(m, 'sanitiseImportedTask not found');
    assert.match(m[0], /'network', 'ai'\]/, 'RISKY must list ai');
    assert.match(m[0], /ai: false/, 'the reset perms must turn ai off');
  });
  test('the flow knows the three steps need it', async () => {
    const F = await import(pathToFileURL(join(ROOT, 'frontend/js/features/settings/sched-flow-model.js')).href);
    for (const type of ['ai.classify', 'ai.ask', 'ai.suggest_mod_metadata']) assert.equal(F.ACTION_PERMS[type]?.perm, 'ai', type);
  });
  test('the MCP creation default grants it off', () => {
    const rs = readFileSync(join(ROOT, 'src-tauri/src/mcp/state_bridge.rs'), 'utf8');
    assert.match(rs, /TASK_PERM_KEYS: \[&str; \d+\] = \[[^\]]*"ai"\]/);
  });
});
