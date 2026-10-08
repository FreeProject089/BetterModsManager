// The scheduler's flow mode (sched-flow-model.ts, sched-flow-keys.ts, sched-flow.ts).
//
// The flow is a third VIEW of one task, and every promise that makes that true is here:
//
//   · drawing a task, selecting, dragging, auto-laying-out and saving leave its steps exactly as
//     they were — for a corpus holding every step kind the Step type has (the kinds are read from
//     scheduler.ts, so a new kind that this corpus forgets fails here);
//   · a task BUILT in the flow is the tree the other modes build, and compiles through BMMScript
//     (this file pins it to tests/fixtures/sched-flow-built.json; the Rust test
//     `a_task_built_in_the_flow_compiles_through_code` in commands/bmms.rs prints and compiles
//     that same file);
//   · a node the task has no permission for is flagged with the executor's own rule: the table is
//     read back out of runAction / evalConditionRaw, and decided by the scheduler's real hasPerm;
//   · every shortcut of the mode is a command in the one registry, listed in the shortcuts page.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(join(ROOT, p)).href);
const M = await load('frontend/js/features/settings/sched-flow-model.js');
const K = await load('frontend/js/features/settings/sched-flow-keys.js');
const SCHED_JS = readFileSync(join(ROOT, 'frontend/js/features/settings/scheduler.js'), 'utf8');
const SCHED_TS = readFileSync(join(ROOT, 'frontend/src/features/settings/scheduler.ts'), 'utf8');

// scheduler.js needs a browser to load; its pure parts are read out and evaluated on their own,
// the way tests/task-perms-parity.test.mjs does it. At the top level: a describe() body that
// throws counts nothing and exits 0.
function fnSource(js, head, bodyEnd = '\n}') {
  const start = js.indexOf(head);
  assert.ok(start >= 0, `\`${head}\` not found in scheduler.js (renamed?)`);
  const end = js.indexOf(bodyEnd, start) + bodyEnd.length;
  return js.slice(start, end).replace(/^export function/, 'function');
}
async function evalModule(src, names) {
  return import('data:text/javascript;base64,' + Buffer.from(`${src}\nexport { ${names.join(', ')} };`, 'utf8').toString('base64'));
}
const { taskPerms, hasPerm } = await evalModule(
  fnSource(SCHED_JS, 'function taskPerms(') + '\n' + fnSource(SCHED_JS, 'function hasPerm('), ['taskPerms', 'hasPerm']);
void taskPerms;
const { _makeStep } = await evalModule(fnSource(SCHED_JS, 'function _makeStep('), ['_makeStep']);
const make = (k) => _makeStep(k);
const clone = (v) => JSON.parse(JSON.stringify(v));

// ── The corpus: every step kind, nested every way a body can be ──────────────────────────────
const act = (type, params = {}) => ({ kind: 'action', action: { type, params } });
const cond = (type, params = {}) => ({ type, params });
const CORPUS = [
  { name: 'flat', trigger: { type: 'manual' }, steps: [act('mods.scan'), { kind: 'delay', seconds: 5 }, act('notify', { message: 'hi' })] },
  { name: 'empty', trigger: { type: 'appStart' }, steps: [] },
  {
    name: 'every kind', trigger: { type: 'dailyAt', time: '03:00' },
    steps: [
      { kind: 'waitFor', condition: cond('allModsActive'), timeoutSec: 60, pollSec: 2, onTimeout: 'continue' },
      { kind: 'if', condition: cond('online'), then: [act('mods.scan')], else: [{ kind: 'stop' }] },
      { kind: 'repeat', mode: 'times', times: 3, maxIters: 3, everySec: 1, steps: [act('notify', { message: 'x' }), { kind: 'break' }] },
      { kind: 'forEach', source: 'enabledMods', maxIters: 100, everySec: 0, steps: [
        { kind: 'try', steps: [act('mod.disable', { id: '{item.id}' })], onError: [{ kind: 'continue' }] },
      ] },
      { kind: 'switch', cases: [
        { condition: cond('appRunning', { name: 'dcs.exe' }), steps: [act('profile.activate', { id: 'p1' })] },
        { condition: cond('always'), steps: [] },
      ], default: [{ kind: 'delay', seconds: 1 }] },
      { kind: 'ensure', condition: cond('modEnabled', { id: 'm' }), steps: [act('mod.enable', { id: 'm' })], onFail: 'continue' },
      { kind: 'retry', times: 2, everySec: 30, steps: [act('repo.sync', { url: 'https://x' })], onFail: 'abort' },
      { kind: 'parallel', mode: 'settle', branches: [[act('mods.scan')], [], [{ kind: 'delay', seconds: 2 }]] },
      { kind: 'call', block: 'tidy' },
      { kind: 'if', condition: cond('always'), then: [], else: [], collapsed: true },
      { ...act('custom.command', { program: 'x' }), disabled: true },
    ],
  },
  {
    name: 'deep', trigger: { type: 'interval', everyMinutes: 5 },
    steps: [{ kind: 'if', condition: cond('always'), then: [
      { kind: 'parallel', branches: [[{ kind: 'switch', cases: [{ condition: cond('online'), steps: [
        { kind: 'retry', times: 1, everySec: 0, steps: [{ kind: 'ensure', condition: cond('always'), steps: [act('mods.scan')] }] },
      ] }], default: [] }]] },
    ], else: [] }],
  },
];

describe('the corpus is complete', () => {
  test('it holds every kind the Step type declares', () => {
    const decl = SCHED_TS.match(/type Step = \(([\s\S]*?)\n\) &/);
    assert.ok(decl, 'the Step union was not found in scheduler.ts');
    const kinds = [...new Set([...decl[1].matchAll(/kind: '(\w+)'/g)].map((m) => m[1]))].sort();
    assert.ok(kinds.length >= 15, `only ${kinds.length} kinds read — the parse is broken`);
    const seen = new Set();
    for (const t of CORPUS) M.walkSteps(t.steps, (st) => { seen.add(st.kind); });
    assert.deepEqual(kinds.filter((k) => !seen.has(k)), [], 'kinds the flow corpus never draws');
  });
});

describe('model → flow → model is identical', () => {
  for (const task of CORPUS) {
    test(`${task.name}: drawing, navigating and laying out change nothing`, () => {
      const before = clone(task);
      const g = M.buildGraph(task.steps, task.layout);
      // Every step has exactly one node, at its own path.
      const paths = [];
      M.walkSteps(task.steps, (st, p) => { paths.push(p); if (st.collapsed) return false; return true; });
      const stepNodes = g.nodes.filter((n) => n.type === 'step').map((n) => n.id).sort();
      assert.deepEqual(stepNodes, [...paths].sort());
      // The reading order visits every node once.
      assert.equal(new Set(g.order).size, g.order.length);
      assert.equal(g.order.length, paths.length + 1);
      // Every edge joins two nodes that exist.
      const ids = new Set(g.nodes.map((n) => n.id));
      for (const e of g.edges) assert.ok(ids.has(e.from) && ids.has(e.to), `dangling edge ${e.from} → ${e.to}`);
      // Walk the whole order with the arrows.
      let at = 'trigger';
      for (let i = 0; i < g.order.length + 2; i++) at = M.neighbour(g, at, 'right') || at;
      for (const d of ['up', 'down', 'left']) M.neighbour(g, g.order[g.order.length - 1], d);
      // A drag, then auto-layout (dropping the layout), then save (prune).
      let lay = M.setNudge(task.layout, 'trigger', 16, -8, 'trigger');
      if (paths[0]) lay = M.setNudge(lay, paths[0], 24, 40, M.stampOf(M.resolve(task.steps, paths[0])));
      M.buildGraph(task.steps, lay);
      assert.deepEqual(task.steps, before.steps, 'the flow changed the steps');
      assert.equal(M.pruneLayout(task.steps, undefined), undefined, 'no layout, no field');
      const kept = M.pruneLayout(task.steps, lay);
      assert.ok(kept && kept.nudge.trigger, 'a real nudge is kept');
      assert.deepEqual(clone(task), before, 'the task object changed');
    });

    test(`${task.name}: insert then delete gives the same tree back`, () => {
      const before = clone(task.steps);
      const steps = clone(task.steps);
      const slots = [''];
      M.walkSteps(steps, (st, p) => { for (const l of M.lanesOf(st, p)) slots.push(l.slot); });
      for (const slot of slots) {
        const r = M.insertStep(steps, undefined, slot, 0, make('delay'));
        assert.ok(M.resolve(steps, r.path)?.kind === 'delay');
        M.removeStep(steps, undefined, r.path);
        assert.deepEqual(steps, before, `insert/delete at ${slot || 'root'} did not round-trip`);
      }
      if (steps.length) {
        const d = M.duplicateStep(steps, undefined, '0');
        M.removeStep(steps, undefined, d.path);
        assert.deepEqual(steps, before, 'duplicate/delete did not round-trip');
      }
      if (steps.length > 1) {
        const m = M.moveStep(steps, undefined, '0', 1);
        M.moveStep(steps, undefined, m.path, -1);
        assert.deepEqual(steps, before, 'move later/earlier did not round-trip');
      }
    });
  }
});

describe('layout metadata', () => {
  test('a nudge follows its step when steps are inserted before it', () => {
    const steps = [act('mods.scan'), act('notify')];
    let lay = M.setNudge(undefined, '1', 40, 16, M.stampOf(steps[1]));
    const r = M.insertStep(steps, lay, '', 0, make('delay'));
    lay = r.layout;
    assert.deepEqual(Object.keys(lay.nudge), ['2']);
    const g = M.buildGraph(steps, lay);
    const n = g.nodes.find((x) => x.id === '2');
    assert.equal(n.x - n.ax, 40);
    assert.equal(n.y - n.ay, 16);
  });

  test('a nudge whose step changed kind elsewhere is not applied, and is pruned', () => {
    const steps = [act('mods.scan')];
    const lay = M.setNudge(undefined, '0', 40, 16, M.stampOf(steps[0]));
    steps[0] = act('notify');        // what an edit in Blocks or Code does to this path
    const n = M.buildGraph(steps, lay).nodes.find((x) => x.id === '0');
    assert.equal(n.x, n.ax);
    assert.equal(M.pruneLayout(steps, lay), undefined);
  });

  test('deleting a step drops its nudges and those of what was inside it', () => {
    const steps = [{ kind: 'if', condition: cond('always'), then: [act('mods.scan')], else: [] }, act('notify')];
    let lay = M.setNudge(undefined, '0.then.0', 8, 8, M.stampOf(steps[0].then[0]));
    lay = M.setNudge(lay, '1', 8, 8, M.stampOf(steps[1]));
    lay = M.removeStep(steps, lay, '0');
    assert.deepEqual(Object.keys(lay.nudge), ['0']);
    assert.equal(lay.nudge['0'][2], 'action:notify');
  });

  test('the executor never reads the layout', () => {
    // Its only reader in scheduler.ts is the editor: flowHost/pruneLayout, never runSteps.
    const run = SCHED_TS.slice(SCHED_TS.indexOf('async function runSteps('), SCHED_TS.indexOf('async function forEachItems('));
    assert.ok(run.length > 1000, 'runSteps not found');
    assert.doesNotMatch(run, /\.layout\b/);
  });
});

// ── A task built in the flow ─────────────────────────────────────────────────────────────────
function buildInFlow() {
  const task = { name: 'Built in the flow', trigger: { type: 'manual' }, steps: [] };
  let lay;
  const add = (slot, index, v) => {
    const r = M.insertStep(task.steps, lay, slot, index, M.paletteStep(v, make));
    lay = r.layout;
    return r.path;
  };
  add('', 0, 'action:mods.scan');
  const pIf = add('', 1, 'if');
  add(`${pIf}.then`, 0, 'action:notify');
  add(`${pIf}.else`, 0, 'stop');
  const pSw = add('', 2, 'switch');
  add(`${pSw}.cases.0.steps`, 0, 'delay');
  add(`${pSw}.default`, 0, 'waitFor');
  const pPar = add('', 3, 'parallel');
  add(`${pPar}.branches.0`, 0, 'action:mods.scan');
  add(`${pPar}.branches.1`, 0, 'delay');
  const pFe = add('', 4, 'forEach');
  add(`${pFe}.steps`, 0, 'try');
  add(`${pFe}.steps.0.steps`, 0, 'action:mod.enable');
  add(`${pFe}.steps.0.onError`, 0, 'continue');
  const pRep = add('', 5, 'repeat');
  add(`${pRep}.steps`, 0, 'break');
  const pRt = add('', 6, 'retry');
  add(`${pRt}.steps`, 0, 'action:mods.scan');
  const pEn = add('', 7, 'ensure');
  add(`${pEn}.steps`, 0, 'action:mods.scan');
  const pCall = add('', 8, 'call');
  M.resolve(task.steps, pCall).block = 'tidy';     // what the inspector's block picker sets
  // Inserted FIRST, last: every path above moves one along, and nothing may be lost doing it.
  add('', 0, 'delay');
  // A duplicate removed again, and a move made and unmade, as a person would.
  const dup = M.duplicateStep(task.steps, lay, '1');
  lay = M.removeSteps(task.steps, dup.layout, [M.resolve(task.steps, dup.path)]);
  const mv = M.moveStep(task.steps, lay, '1', 1);
  lay = M.moveStep(task.steps, mv.layout, mv.path, -1).layout;
  return { task, layout: lay };
}

describe('a task created in flow mode', () => {
  test('is the tree the Rust test compiles (tests/fixtures/sched-flow-built.json)', () => {
    const { task } = buildInFlow();
    const fixture = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/sched-flow-built.json'), 'utf8'));
    assert.deepEqual(task, fixture,
      'the flow now builds a different tree: regenerate the fixture AND run `cargo test bmms` — the Rust side proves it compiles');
  });

  test('uses the scheduler’s own default steps, the ones the brick editor adds', () => {
    for (const k of ['if', 'repeat', 'forEach', 'switch', 'try', 'ensure', 'retry', 'parallel', 'call', 'break', 'waitFor', 'delay']) {
      assert.deepEqual(M.paletteStep(k, make), make(k), k);
    }
    assert.deepEqual(M.paletteStep('action:mods.scan', make), { kind: 'action', action: { type: 'mods.scan', params: {} } });
  });

  test('carries no layout field once nothing was placed by hand', () => {
    const { task, layout } = buildInFlow();
    assert.equal(M.pruneLayout(task.steps, layout), undefined);
  });
});

// ── Permissions ──────────────────────────────────────────────────────────────────────────────
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, a) => a + m.slice(a.length).replace(/[^\n]/g, ' '));
function casesOf(body) {
  const parts = [...body.matchAll(/case '([a-zA-Z0-9_.]+)':/g)];
  const out = new Map();
  let pending = [];
  for (let i = 0; i < parts.length; i++) {
    const seg = body.slice(parts[i].index + parts[i][0].length, i + 1 < parts.length ? parts[i + 1].index : body.length);
    pending.push(parts[i][1]);
    if (!seg.trim()) continue;          // falls through to the next case
    for (const name of pending) out.set(name, seg);
    pending = [];
  }
  return out;
}

describe('permissions: the flow flags exactly what the executor refuses', () => {
  const S = strip(SCHED_TS);
  const runAction = S.slice(S.indexOf('async function runAction('), S.indexOf('\nasync function setSettingFlag'));
  const evalCond = S.slice(S.indexOf('async function evalConditionRaw('), S.indexOf('\nfunction cmpNum'));
  assert.ok(runAction.length > 10000 && evalCond.length > 2000, 'runAction / evalConditionRaw not found');
  const actCases = casesOf(runAction.slice(runAction.indexOf('switch (action.type)')));
  const condCases = casesOf(evalCond);

  test('the action table is the runner’s requirePerm calls, and its dl() helper', () => {
    const fromRunner = {};
    for (const [type, seg] of actCases) {
      const req = [...seg.matchAll(/requirePerm\(task, '([a-zA-Z]+)', t\('([a-zA-Z.]+)'\)/g)].map((m) => `${m[1]}|${m[2]}`);
      if (/\bdl\(/.test(seg)) req.push('deeplink|sched.permDeeplink');
      if (req.length) fromRunner[type] = [...new Set(req)].sort().join(',');
    }
    assert.ok(Object.keys(fromRunner).length >= 30, 'too few gated actions read — the parse is broken');
    // A step with a second, conditional need (EXTRA_PERMS: « explain » with a remote writer
    // also needs `network`) lists both, as the runner asks for both.
    const fromTable = Object.fromEntries(Object.entries(M.ACTION_PERMS).map(([k, r]) => {
      const x = (M.EXTRA_PERMS || {})[k];
      return [k, [`${r.perm}|${r.label}`, ...(x ? [`${x.perm}|${x.label}`] : [])].sort().join(',')];
    }));
    assert.deepEqual(fromTable, fromRunner);
  });

  test('the condition table is the evaluator’s needPerm calls', () => {
    const fromEval = {};
    for (const [type, seg] of condCases) {
      const m = seg.match(/needPerm\('([a-zA-Z]+)', t\('([a-zA-Z.]+)'\)/);
      if (m) fromEval[type] = `${m[1]}|${m[2]}`;
    }
    const fromTable = Object.fromEntries(Object.entries(M.CONDITION_PERMS).map(([k, r]) => [k, `${r.perm}|${r.label}`]));
    assert.deepEqual(fromTable, fromEval);
  });

  test('a script trigger asks for `script`, as scriptFired checks', () => {
    const fired = S.slice(S.indexOf('async function scriptFired('), S.indexOf('async function conditionFired('));
    assert.ok(fired.length > 200, 'scriptFired not found');
    assert.match(fired, /hasPerm\(task, 'script'\)/);
    assert.deepEqual(M.permNeeds([], { type: 'script' }).map((n) => n.perm), ['script']);
  });

  const gated = Object.entries(M.ACTION_PERMS);
  const paramsFor = (type) => (type === 'plugin.asset' ? { mode: 'run' } : type === 'import.file' ? { path: 'C:/x/pack.bmmbundle' } : type === 'task.run' ? { id: 't1' } : {});

  test('adding a risky node to a task granted nothing is flagged — with the key the run would refuse', () => {
    for (const [type, rule] of gated) {
      const task = { perms: {}, steps: [], trigger: { type: 'manual' } };
      M.insertStep(task.steps, undefined, '', 0, { kind: 'action', action: { type, params: paramsFor(type) } });
      const miss = M.missingPerms(task, (k) => hasPerm(task, k));
      assert.equal(miss.length, 1, `${type} not flagged`);
      assert.equal(miss[0].perm, rule.perm);
      assert.equal(miss[0].label, rule.label);
      assert.equal(hasPerm(task, rule.perm), false, 'the runtime would refuse it too');
      assert.deepEqual(task.perms, {}, 'the flow granted something');
    }
  });

  test('granting the permission clears the flag, as it lets the run through', () => {
    for (const [type, rule] of gated) {
      const task = { perms: { [rule.perm]: true }, steps: [{ kind: 'action', action: { type, params: paramsFor(type) } }] };
      assert.deepEqual(M.missingPerms(task, (k) => hasPerm(task, k)), [], type);
    }
  });

  test('a truthy grant that is not `true` is still flagged (owner card 6)', () => {
    const task = { perms: { command: 'yes' }, steps: [act('custom.command', { program: 'x' })] };
    assert.equal(M.missingPerms(task, (k) => hasPerm(task, k)).length, 1);
  });

  test('a legacy task keeps deeplink and tasks, exactly as taskPerms derives them', () => {
    const task = { steps: [act('view.open'), act('task.run', { id: 'x' }), act('custom.script')] };
    assert.deepEqual(M.missingPerms(task, (k) => hasPerm(task, k)).map((m) => m.perm), ['script']);
  });

  test('a condition that reaches out is flagged wherever it sits, nested groups included', () => {
    const task = { perms: {}, steps: [{ kind: 'if', condition: cond('all', { conditions: [cond('online'), cond('repoOk', { url: 'https://x' })] }), then: [], else: [] },
      { kind: 'switch', cases: [{ condition: cond('commandSucceeds', { program: 'x' }), steps: [] }], default: [] }] };
    assert.deepEqual(M.missingPerms(task, (k) => hasPerm(task, k)).map((m) => `${m.path}:${m.perm}`), ['0:command', '1:command']);
  });

  test('a switched-off step asks for nothing, as the runner skips it', () => {
    assert.match(S, /if \(step\.disabled\) continue;/);
    const task = { perms: {}, steps: [{ ...act('custom.command'), disabled: true }] };
    assert.deepEqual(M.missingPerms(task, (k) => hasPerm(task, k)), []);
  });

  test('a mode that only reads or imports locally asks for nothing', () => {
    const task = { perms: {}, steps: [act('plugin.asset', { mode: 'read' }), act('import.file', { path: 'C:/x/list.mm' }), act('task.run', {})] };
    assert.deepEqual(M.missingPerms(task, (k) => hasPerm(task, k)), []);
  });
});

// ── Last run ─────────────────────────────────────────────────────────────────────────────────
describe('run marks', () => {
  const steps = [act('a'), { kind: 'if', condition: cond('always'), then: [act('b')], else: [act('c')] }];
  test('each action takes its recorded status; one not reached is skipped; a container takes the worst inside', () => {
    const m = M.runMarks(steps, { steps: [{ path: '0', status: 'ok' }, { path: '1.then.0', status: 'error', error: 'boom' }] });
    assert.equal(m.get('0').mark, 'ok');
    assert.equal(m.get('1.then.0').mark, 'error');
    assert.equal(m.get('1.then.0').error, 'boom');
    assert.equal(m.get('1.else.0').mark, 'skipped');
    assert.equal(m.get('1').mark, 'error');
  });
  test('in the editor, a mark follows its step when steps are inserted, and leaves it when it is edited', () => {
    const saved = clone(steps);
    const rec = { steps: [{ path: '0', status: 'ok' }, { path: '1.then.0', status: 'error', error: 'boom' }] };
    const draft = clone(saved);
    M.insertStep(draft, undefined, '', 0, act('notify', { message: 'new' }));
    let m = M.marksForDraft(saved, rec, draft);
    assert.equal(m.get('0'), undefined, 'the new step inherited the mark of the step it pushed along');
    assert.equal(m.get('1').mark, 'ok');
    assert.equal(m.get('2.then.0').mark, 'error');
    assert.equal(m.get('2').mark, 'error');
    draft[2].then[0].action.params = { changed: true };
    m = M.marksForDraft(saved, rec, draft);
    assert.equal(m.get('2.then.0'), undefined, 'an edited step keeps a mark it never earned');
    assert.equal(M.marksForDraft(null, rec, draft).size, 0, 'an unsaved task has no run');
  });
  test('a record written before paths existed marks nothing', () => {
    assert.equal(M.runMarks(steps, { steps: [{ label: 'x', status: 'ok' }] }).size, 0);
  });
  test('the executor records the path of each action it runs', () => {
    assert.match(SCHED_TS, /const where = _actionPath\.get\(action\);\s*\n\s*if \(step && where\) step\.path = where;/);
    assert.match(SCHED_TS, /notePaths\(task\.steps \|\| \[\]\)/);
    assert.match(SCHED_TS, /inheritPaths\(step\.steps, substituteItem\(step\.steps, item\)\)/);
    const paths = M.actionPaths(steps).map(([, p]) => p);
    assert.deepEqual(paths, ['0', '1.then.0', '1.else.0']);
  });
});

// ── Shortcuts ────────────────────────────────────────────────────────────────────────────────
describe('every flow shortcut is a command in the registry, listed on the shortcuts page', () => {
  test('ids are unique, and no two defaults of the flow collide', () => {
    const ids = K.FLOW_KEYS.map((k) => k.id);
    assert.equal(new Set(ids).size, ids.length);
    const chords = K.FLOW_KEYS.filter((k) => k.chord).map((k) => JSON.stringify({ c: !!k.chord.ctrl, s: !!k.chord.shift, a: !!k.chord.alt, k: k.chord.key }));
    assert.equal(new Set(chords).size, chords.length);
    for (const want of ['sched.flow.addNode', 'sched.flow.delete', 'sched.flow.duplicate', 'sched.flow.undo', 'sched.flow.redo',
      'sched.flow.zoomIn', 'sched.flow.zoomOut', 'sched.flow.fit', 'sched.flow.autoLayout', 'sched.mode.blocks', 'sched.mode.code', 'sched.mode.flow']) {
      assert.ok(ids.includes(want), `${want} is missing`);
    }
  });

  // commands.js loads in node given a document it can ask for nothing.
  const listeners = [];
  globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
  globalThis.document = {
    querySelectorAll: () => [], querySelector: () => null, getElementById: () => null,
    createElement: () => ({ style: {} }), head: { appendChild() {} },
    addEventListener: (type, fn) => listeners.push([type, fn]), removeEventListener() {},
  };
  test('registered at boot, in the Scheduler group, with their defaults', async () => {
    const C = await load('frontend/js/core/commands.js');
    C.initCommands();
    const all = new Map(C.allCommands().map((c) => [c.id, c]));
    for (const k of K.FLOW_KEYS) {
      const c = all.get(k.id);
      assert.ok(c, `${k.id} is not in the registry`);
      assert.equal(c.category, 'scheduler');
      assert.equal(typeof c.when, 'function', `${k.id} has no scope`);
      assert.deepEqual(C.bindingOf(k.id), k.chord);
    }
    const host = { innerHTML: '', onclick: null };
    C.renderShortcutsManager(host);
    for (const k of K.FLOW_KEYS) assert.ok(host.innerHTML.includes(`data-id="${k.id}"`), `${k.id} is not on the shortcuts page`);
  });

  test('scoped: inert until the editor binds them and its scope is active, then they win', async () => {
    const C = await load('frontend/js/core/commands.js');
    const down = listeners.filter(([t]) => t === 'keydown').map(([, f]) => f);
    assert.ok(down.length, 'the dispatcher was not installed');
    const fire = (key, mods = {}) => {
      const e = { key, ctrlKey: !!mods.ctrl, metaKey: false, shiftKey: !!mods.shift, altKey: !!mods.alt, target: null, preventDefault() { this.prevented = true; } };
      for (const f of down) f(e);
      return e;
    };
    let ran = '';
    let active = false;
    K.bindFlowKeys({ 'sched.flow.addNode': () => { ran = 'add'; }, 'sched.flow.undo': () => { ran = 'undo'; } }, (scope) => active && scope === 'flow');
    assert.equal(fire('/').prevented, undefined, 'fired outside its scope');
    assert.equal(ran, '');
    active = true;
    fire('/');
    assert.equal(ran, 'add');
    fire('z', { ctrl: true });
    assert.equal(ran, 'undo');
    // Rebound, the old key does nothing and the new one works.
    C.setBinding('sched.flow.addNode', C.parseChord('Alt+N'));
    ran = '';
    fire('/');
    assert.equal(ran, '');
    fire('n', { alt: true });
    assert.equal(ran, 'add');
    C.setBinding('sched.flow.addNode', undefined);
  });

  test('the docs list every shortcut, in both languages', () => {
    for (const [file, lang] of [['BMM Docs/docs/features/scheduler.md', 'en'], ['BMM Docs/docs/features/scheduler.fr.md', 'fr']]) {
      const md = readFileSync(join(ROOT, file), 'utf8').toLowerCase();
      for (const k of K.FLOW_KEYS) {
        const title = k.title[lang].replace(/^[^:]+:\s*/, '');
        assert.ok(md.includes(title.toLowerCase()), `${file} does not list “${title}”`);
      }
    }
  });
});
