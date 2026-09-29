// The debugger in each editor (sched-debug-map.ts): the runner reports a step PATH; the flow
// shows it as a node, the blocks as a brick, the code as a line — and a breakpoint set in any of
// them is the same breakpoint.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const load = (p) => import(pathToFileURL(join(ROOT, p)).href);
const D = await load('frontend/js/features/settings/sched-debug-map.js');
const G = await load('frontend/js/features/settings/sched-debug.js');
const M = await load('frontend/js/features/settings/sched-flow-model.js');
const SCHED_TS = readFileSync(join(ROOT, 'frontend/src/features/settings/scheduler.ts'), 'utf8');
const BMMS_RS = readFileSync(join(ROOT, 'src-tauri/src/commands/bmms.rs'), 'utf8');

// What `bmms_line_map` answers for this body (its Rust test pins the same shape):
//   1 do mods.scan()   2 if online {   3 do notify(…)   4 } else {   5 wait 5s   6 }   7 print "done"
const LINES = [{ path: '0', line: 1 }, { path: '1', line: 2 }, { path: '1.then.0', line: 3 }, { path: '1.else.0', line: 5 }, { path: '2', line: 7 }];

describe('one position, three editors', () => {
  test('the flow marks the node whose id is the path', () => {
    assert.deepEqual(D.debugTargetFor('flow', '1.then.0'), { mode: 'flow', nodeId: '1.then.0' });
  });
  test('the blocks light the brick of that step', () => {
    assert.deepEqual(D.debugTargetFor('bricks', '1.else.0'), { mode: 'bricks', path: '1.else.0' });
  });
  test('the code highlights the line the statement starts on', () => {
    assert.deepEqual(D.debugTargetFor('code', '1.then.0', LINES), { mode: 'code', line: 3 });
    assert.deepEqual(D.debugTargetFor('code', '2', LINES), { mode: 'code', line: 7 });
  });
  test('a step the map does not know shows at its nearest known parent', () => {
    assert.equal(D.lineForPath(LINES, '1.then.4'), 2, 'unknown child of step 1');
    assert.equal(D.lineForPath(LINES, '9'), null);
    assert.equal(D.debugTargetFor('code', null, LINES), null);
  });
  test('a click in the gutter means the statement on (or above) that line', () => {
    assert.equal(D.pathForLine(LINES, 3), '1.then.0');
    assert.equal(D.pathForLine(LINES, 4), '1.then.0', '"} else {" belongs to the statement above it');
    assert.equal(D.pathForLine(LINES, 6), '1.else.0');
    assert.equal(D.pathForLine([], 1), null);
  });
  test('each mode is more or less visual, and says so', () => {
    assert.ok(D.MODE_VISUALS.flow.includes('node') && D.MODE_VISUALS.flow.includes('hover'));
    assert.ok(D.MODE_VISUALS.bricks.includes('brick'));
    assert.ok(D.MODE_VISUALS.code.includes('line') && D.MODE_VISUALS.code.includes('gutter'));
  });
});

describe('breakpoints are steps', () => {
  test('a path breakpoint or a label match stops the run; nothing else does', () => {
    const bps = new Set(['1.else.0']);
    assert.equal(D.stopsAt(bps, '1.else.0', false), true);
    assert.equal(D.stopsAt(bps, '1.then.0', false), false);
    assert.equal(D.stopsAt(bps, undefined, true), true);
    assert.equal(D.stopsAt(new Set(), '0', false), false);
  });
  test('set in one editor, there in all: the debugger keeps them by path', () => {
    G.clearBreakpoints();
    assert.equal(G.toggleBreakpoint('1.then.0'), true);
    assert.ok(G.breakpointPaths().has('1.then.0'));
    assert.equal(G.toggleBreakpoint('1.then.0'), false);
    assert.equal(G.breakpointPaths().size, 0);
  });
  test('the paths the debugger reports are the flow’s and the run log’s paths', () => {
    const steps = [{ kind: 'action', action: { type: 'mods.scan', params: {} } },
      { kind: 'if', condition: { type: 'online', params: {} }, then: [{ kind: 'action', action: { type: 'notify', params: {} } }], else: [{ kind: 'delay', seconds: 5 }] },
      { kind: 'action', action: { type: 'log.print', params: { text: 'done' } } }];
    const paths = [];
    M.walkSteps(steps, (_st, p) => { paths.push(p); });
    assert.deepEqual(paths, LINES.map((l) => l.path), 'bmms_line_map and walkSteps name the same steps');
  });
});

describe('what the flow shows on hover', () => {
  test('the variables a step reads or writes, not all of them', () => {
    const st = { kind: 'action', action: { type: 'webhook.send', params: { url: 'https://x/{host}', body: '{"t":"{event.title}"}', into: 'reply' } } };
    assert.deepEqual(D.varsOfStep(st), ['event.title', 'host', 'reply']);
    assert.deepEqual(D.varsOfStep({ kind: 'if', condition: { type: 'textIs', params: { source: 'name', value: '{want}' } } }), ['name', 'want']);
  });
  test('the variable picker lists what the task can name', () => {
    const vars = D.variablesOf([{ kind: 'action', action: { type: 'var.set', params: { name: 'count' } } },
      { kind: 'forEach', source: 'mods', steps: [{ kind: 'action', action: { type: 'http.request', params: { into: 'reply' } } }] }],
      { type: 'rss' }, ['team']);
    const names = vars.map((v) => v.name);
    for (const n of ['count', 'reply', 'item.name', 'event.title', 'team', 'http.status', 'task.name', 'date']) assert.ok(names.includes(n), n);
    assert.equal(vars.find((v) => v.name === 'event.title').from, 'event');
    assert.deepEqual(D.insertVar('ab', 1, 1, 'x'), { value: 'a{x}b', caret: 4 });
  });
});

describe('wired', () => {
  test('the runner tells the gate WHERE it is', () => {
    assert.match(SCHED_TS, /await gate\(task\.id, stepLabel\(step\), ctx, _stepPath\.get\(step\)\)/);
  });
  test('a test run notes the paths of the draft it debugs', () => {
    const t = SCHED_TS.slice(SCHED_TS.indexOf("modal.querySelector('#sched-test')?.addEventListener"));
    assert.ok(t.indexOf('notePaths(_draft.steps)') > 0 && t.indexOf('notePaths(_draft.steps)') < t.indexOf('await runSteps(_draft.steps'));
  });
  test('the code mode asks the compiler which line each step starts on', () => {
    assert.match(BMMS_RS, /pub fn bmms_line_map\(source: String\) -> Vec<LineRow>/);
    assert.match(SCHED_TS, /invoke\('bmms_line_map'/);
  });
  test('the three buttons are commands, not a private key handler', () => {
    const src = readFileSync(join(ROOT, 'frontend/src/features/settings/sched-debug.ts'), 'utf8');
    assert.doesNotMatch(src, /document\.addEventListener\('keydown'/);
    const K = readFileSync(join(ROOT, 'frontend/src/features/settings/sched-flow-keys.ts'), 'utf8');
    for (const id of ['sched.debug.step', 'sched.debug.continue', 'sched.debug.stop', 'sched.debug.breakpoint']) assert.ok(K.includes(`'${id}'`), id);
  });
});
