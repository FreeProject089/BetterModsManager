// The « DCS server join gate » template (sched-dcs-gate.ts).
//
// The template is a promise about ORDER and about what is asked:
//   · the hook is installed (asked, with a receipt) and checked BEFORE the list is checked, and
//     only when the server checks players;
//   · DCS is started only on the passing branch; the failing branch asks first, and « not now »
//     stops without joining;
//   · it grants nothing the person did not tick, and every action and value it uses exists in
//     the scheduler's registry (a template naming an action the runner does not have would be a
//     task that fails on its first run).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(join(ROOT, p)).href);
const G = await load('frontend/js/features/settings/sched-dcs-gate.js');
const M = await load('frontend/js/features/settings/sched-flow-model.js');
const SCHED = readFileSync(join(ROOT, 'frontend/src/features/settings/scheduler.ts'), 'utf8');
const EN = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/en.json'), 'utf8'));

const words = G.gateWords((k) => EN[k] || k);
const base = { server: '203.0.113.10:10308', serverName: 'Blue Flag', whitelist: true, listFile: 'files/server.mm', exact: true, dcsExe: 'C:/DCS/bin/DCS.exe', grantFiles: false, grantCommand: false };
const types = (steps) => { const out = []; M.walkSteps(steps, (st, path) => { if (st.kind === 'action') out.push([path, st.action.type]); }); return out; };

describe('the DCS join gate', () => {
  test('hook first, then the list, then the report, then join or fix', () => {
    const task = G.buildJoinGate(base, words);
    const top = task.steps.map((s) => (s.kind === 'action' ? s.action.type : s.kind));
    assert.deepEqual(top, ['pkg.install', 'pkg.verify', 'if', 'modlist.verify', 'gate.report', 'if']);
    assert.equal(task.steps[0].action.params.dest, 'Scripts/Hooks');
    assert.equal(task.steps[0].action.params.root, 'dcs');
  });

  test('without a server whitelist there is no hook and no report', () => {
    const task = G.buildJoinGate({ ...base, whitelist: false }, words);
    const all = types(task.steps).map(([, t]) => t);
    assert.ok(!all.includes('pkg.install') && !all.includes('gate.report'));
    assert.ok(all.includes('modlist.verify') && all.includes('game.launch'));
  });

  test('DCS starts only when the list passes, or after a fix the person accepted', () => {
    const task = G.buildJoinGate(base, words);
    const launches = types(task.steps).filter(([, t]) => t === 'game.launch').map(([p]) => p);
    const join = task.steps.length - 1;
    assert.ok(launches.includes(`${join}.then.0`), 'the passing branch starts DCS');
    // Every other start is behind « Fix it » and a second « Start DCS » question.
    for (const p of launches.filter((x) => x !== `${join}.then.0`)) assert.match(p, new RegExp(`^${join}\\.else\\.1\\.then\\..*\\.then\\.`));
    const stop = types(task.steps).find(([p, t]) => t === 'task.stop' && p.startsWith(`${join}.else`));
    assert.ok(stop, '« not now » ends the run without joining');
  });

  test('the server address goes on the clipboard; no join argument is invented', () => {
    const task = G.buildJoinGate({ ...base, dcsArgs: '--force_enable_VR' }, words);
    const launch = task.steps[task.steps.length - 1].then[0].action.params;
    assert.equal(launch.clipboard, base.server);
    assert.equal(launch.args, '--force_enable_VR');
  });

  test('it grants only what was ticked', () => {
    assert.deepEqual(G.buildJoinGate(base, words).perms, {});
    assert.deepEqual(G.buildJoinGate({ ...base, grantFiles: true, grantCommand: true }, words).perms, { files: true, command: true });
  });

  test('every action and value it uses exists in the scheduler', () => {
    const task = G.buildJoinGate(base, words);
    const registry = new Set([...SCHED.matchAll(/\{ v: '([a-z][\w.]*)', label:/g)].map((m) => m[1]));
    for (const [, type] of types(task.steps)) assert.ok(registry.has(type), `${type} is not an action`);
    const sources = new Set();
    M.walkSteps(task.steps, (st) => { if (st.condition?.type === 'value') sources.add(st.condition.params.source); });
    for (const s of sources) assert.ok(SCHED.includes(`'${s}'`), `${s} is not a value source`);
  });

  test('the frames hold what they say, and the list is filed', async () => {
    const task = G.buildJoinGate(base, words);
    assert.deepEqual(task.ui.frames.map((f) => f.id), ['gate-hook', 'gate-check', 'gate-join']);
    assert.equal(task.ui.folder, 'DCS');
    // Each frame holds its own steps (and only those): hook = 0..2, check = 3..4, join = 5 and inside.
    const U = await load('frontend/js/features/settings/sched-flow-ui.js');
    const g = M.buildGraph(task.steps, null);
    const boxes = g.nodes.filter((n) => n.type === 'step').map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }));
    const [hook, check, join] = task.ui.frames.map((f) => U.insideFrame(f, boxes));
    assert.deepEqual(hook.filter((id) => !id.includes('.')), ['0', '1', '2']);
    assert.deepEqual(check, ['3', '4']);
    assert.ok(join.includes('5') && join.every((id) => id.split('.')[0] === '5'));
    const nowl = G.buildJoinGate({ ...base, whitelist: false }, words);
    assert.deepEqual(nowl.ui.frames.map((f) => f.id), ['gate-check', 'gate-join']);
  });

  test('the sentences are the reader’s, with the server filled in', () => {
    const task = G.buildJoinGate(base, words);
    assert.match(task.name, /Blue Flag/);
    assert.ok(!JSON.stringify(task).includes('sched.dg.'), 'an untranslated key reached the task');
  });
});
