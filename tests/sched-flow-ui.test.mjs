// The flow editor's Blueprint tools, the pure half (sched-flow-ui.ts, relocateStep in
// sched-flow-model.ts) and the package helpers (sched-pkg-model.ts).
//
//   · the `ui` block is checked on the way in: junk dropped, an empty block is no block, so an
//     automation that never used it saves exactly as before;
//   · align / distribute move only what has to move; a wire dragged from one node onto another
//     ORDERS them, and can never put a step inside itself;
//   · a paste only accepts our own clipboard shape, and a pasted step is a plain step;
//   · the inline check names the empty required field, and a disabled step asks for nothing;
//   · the list groups by folder (unfiled first) and the search reads folders and tags.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(join(ROOT, p)).href);
const U = await load('frontend/js/features/settings/sched-flow-ui.js');
const M = await load('frontend/js/features/settings/sched-flow-model.js');
const P = await load('frontend/js/features/settings/sched-pkg-model.js');

const act = (type, params = {}) => ({ kind: 'action', action: { type, params } });

describe('the ui block', () => {
  test('nothing in it is no block at all', () => {
    assert.equal(U.normalizeUi(undefined), undefined);
    assert.equal(U.normalizeUi({ v: 1 }), undefined);
    assert.equal(U.normalizeUi({ v: 1, frames: [], reroutes: {}, tags: [] }), undefined);
  });

  test('frames, reroutes, folder and tags are kept, checked', () => {
    const ui = U.normalizeUi({
      v: 7,
      frames: [{ id: 'a', title: 'Hook\u0007', tone: 'neon', x: 1.6, y: 'x', w: 10, h: 5000000 }, { id: 'a', title: 'dup' }],
      reroutes: { '0>1': [[1, 2], ['a'], [3, 4, 5]], 'bad key': [[1, 2]] },
      folder: '  DCS  ',
      tags: ['DCS', 'dcs', '', 'server'],
    });
    assert.equal(ui.v, 1);
    assert.equal(ui.frames.length, 1, 'a duplicate id is dropped');
    assert.deepEqual(ui.frames[0], { id: 'a', title: 'Hook', tone: 'neutral', x: 2, y: 0, w: 80, h: 20000 });
    assert.deepEqual(ui.reroutes, { '0>1': [[1, 2]] });
    assert.equal(ui.folder, 'DCS');
    assert.deepEqual(ui.tags, ['dcs', 'server']);
  });

  test('reroutes of wires that are gone are dropped', () => {
    const ui = U.pruneReroutes({ v: 1, reroutes: { '0>1': [[1, 1]], '1>2': [[2, 2]] }, folder: 'x' }, new Set(['0>1']));
    assert.deepEqual(Object.keys(ui.reroutes), ['0>1']);
    assert.equal(U.pruneReroutes({ v: 1, reroutes: { 'a>b': [[0, 0]] } }, new Set()), undefined);
  });

  test('a folded frame hides what is inside it, the smallest frame first', () => {
    const boxes = [{ id: 'n1', x: 10, y: 10, w: 20, h: 20 }, { id: 'n2', x: 300, y: 10, w: 20, h: 20 }];
    const big = { id: 'big', title: '', tone: 'accent', x: 0, y: 0, w: 400, h: 100, collapsed: true };
    const small = { id: 'small', title: '', tone: 'accent', x: 0, y: 0, w: 100, h: 100, collapsed: true };
    const h = U.hiddenBy([big, small], boxes);
    assert.equal(h.get('n1').id, 'small');
    assert.equal(h.get('n2').id, 'big');
    assert.equal(U.hiddenBy([{ ...big, collapsed: false }], boxes).size, 0);
  });

  test('a frame around nodes leaves room for its title', () => {
    const f = U.frameAround([{ id: 'a', x: 100, y: 100, w: 50, h: 20 }], 'f', 'T');
    assert.ok(f.x < 100 && f.y < 100 - U.FRAME_HEAD && f.x + f.w > 150 && f.y + f.h > 120);
    assert.deepEqual(U.insideFrame(f, [{ id: 'a', x: 100, y: 100, w: 50, h: 20 }, { id: 'b', x: 900, y: 0, w: 1, h: 1 }]), ['a']);
  });
});

describe('arranging', () => {
  const boxes = [{ id: 'a', x: 0, y: 0, w: 100, h: 50 }, { id: 'b', x: 40, y: 80, w: 60, h: 50 }, { id: 'c', x: 300, y: 30, w: 100, h: 50 }];
  test('align moves only what has to move', () => {
    assert.deepEqual(U.align(boxes, 'left'), { b: { x: 0, y: 80 }, c: { x: 0, y: 30 } });
    assert.deepEqual(U.align(boxes, 'top'), { b: { x: 40, y: 0 }, c: { x: 300, y: 0 } });
    assert.deepEqual(U.align(boxes.slice(0, 1), 'left'), {}, 'one node has nothing to line up with');
  });
  test('distribute keeps the outer two and evens the gaps', () => {
    const moved = U.distribute(boxes, 'h');
    assert.equal(moved.a, undefined);
    assert.equal(moved.c, undefined);
    // a ends at 100, c starts at 300: b (60 wide) sits with 70 on each side.
    assert.deepEqual(moved.b, { x: 170, y: 80 });
  });
});

describe('wiring is ordering', () => {
  test('dragging a wire from one step onto another moves it right after', () => {
    const steps = [act('notify', { message: 'a' }), act('notify', { message: 'b' }), act('notify', { message: 'c' })];
    const r = M.relocateStep(steps, undefined, '2', '0');
    assert.equal(r.path, '1');
    assert.deepEqual(steps.map((s) => s.action.params.message), ['a', 'c', 'b']);
  });
  test('into a branch, and never inside itself', () => {
    const steps = [{ kind: 'if', condition: { type: 'always', params: {} }, then: [act('notify', { message: 'in' })], else: [] }, act('notify', { message: 'out' })];
    const r = M.relocateStep(steps, undefined, '1', '0.then.0');
    assert.equal(r.path, '0.then.1');
    assert.equal(steps.length, 1);
    assert.equal(M.relocateStep(steps, undefined, '0', '0.then.0'), null, 'a block cannot go inside itself');
    assert.equal(M.relocateStep(steps, undefined, '0.then.1', '0.then.0'), null, 'already right after: nothing to do');
  });
});

describe('the clipboard', () => {
  test('our own shape round-trips; anything else is refused', () => {
    const steps = [act('notify', { message: 'x' })];
    assert.deepEqual(U.readClip(U.clipText(steps)), steps);
    assert.equal(U.readClip('{"steps":[{"kind":"action"}]}'), null);
    assert.equal(U.readClip('not json'), null);
    assert.equal(U.readClip(JSON.stringify({ bmmFlowClip: 1, steps: [1, null, { kind: 42 }] })), null);
  });
});

describe('inline checks', () => {
  test('an empty required field is named; one of two is enough', () => {
    assert.deepEqual(U.stepProblems(act('pkg.install', {})), ['file']);
    assert.deepEqual(U.stepProblems(act('modlist.verify', {})), ['path / file']);
    assert.deepEqual(U.stepProblems(act('modlist.verify', { file: 'files/a.mm' })), []);
    assert.deepEqual(U.stepProblems(act('plugin.asset', { pluginId: 'p' })), ['path']);
    assert.deepEqual(U.stepProblems({ ...act('game.launch', {}), disabled: true }), [], 'a disabled step asks for nothing');
    assert.deepEqual(U.stepProblems(act('notify', {})), [], 'a field with a default is not required');
  });
});

describe('the list', () => {
  const tasks = [
    { name: 'b', ui: { v: 1, folder: 'DCS', tags: ['server'] } },
    { name: 'a' },
    { name: 'c', description: 'nightly backup', ui: { v: 1, folder: 'Backups' } },
  ];
  test('grouped by folder, unfiled first', () => {
    assert.deepEqual(U.byFolder(tasks).map((g) => [g.folder, g.tasks.map((x) => x.name)]), [['', ['a']], ['Backups', ['c']], ['DCS', ['b']]]);
  });
  test('the search reads folders and tags; a tag filters', () => {
    assert.deepEqual(tasks.filter((x) => U.matches(x, 'dcs', '')).map((x) => x.name), ['b']);
    assert.deepEqual(tasks.filter((x) => U.matches(x, 'backup', '')).map((x) => x.name), ['c']);
    assert.deepEqual(tasks.filter((x) => U.matches(x, '', 'server')).map((x) => x.name), ['b']);
    assert.deepEqual(U.allTags(tasks), ['server']);
  });
});

describe('package helpers', () => {
  test('arguments are a list: spaces separate, quotes group, nothing else is special', () => {
    assert.deepEqual(P.splitArgs('--a "b c" d'), ['--a', 'b c', 'd']);
    assert.deepEqual(P.splitArgs('x & calc.exe'), ['x', '&', 'calc.exe']);
    assert.deepEqual(P.splitArgs('""'), ['']);
    assert.deepEqual(P.splitArgs(''), []);
  });
  test('a picked path becomes a safe name under files/', () => {
    assert.equal(P.entryNameFor('C:\\x\\Server List.mm'), 'files/Server List.mm');
    assert.equal(P.entryNameFor('C:/mods/MyMod/'), 'files/MyMod');
    assert.equal(P.entryNameFor('C:/x/a:b?.lua'), 'files/a_b_.lua');
  });
  test('items are the top level of the package', () => {
    const items = P.itemsOf([{ name: 'files/Mod/a.lua', sha256: '', size: 2 }, { name: 'files/Mod/b/c.lua', sha256: '', size: 3 }, { name: 'files/x.mm', sha256: '', size: 9 }]);
    assert.deepEqual(items, [{ name: 'files/Mod', files: 2, size: 5 }, { name: 'files/x.mm', files: 1, size: 9 }]);
  });
});
