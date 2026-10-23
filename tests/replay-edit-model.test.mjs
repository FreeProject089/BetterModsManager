// Replay Studio editing (start trim, end trim, arbitrary cuts) against the COMPILED module.
//
// The property every test leans on: an edited take must still be a valid rrweb stream —
// a full snapshot before the first delta, timestamps that never go back — and every DOM
// delta a later event depends on must survive, squashed onto the cut, rather than vanish.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/features/debug/replay-edit-model.js')).href);
const { editEvents, editRegions, editMarkers, mapTime, unmapTime, editedDuration, normalizeCuts,
  removedRanges, playabilityProblem, anchorsOf, embedSnippets, emptyEdit, isEditEmpty, fmtClock } = M;

const BASE = 1_000_000;
const meta = (t) => ({ type: 4, timestamp: BASE + t, data: { width: 800, height: 600 } });
const snap = (t) => ({ type: 2, timestamp: BASE + t, data: {} });
const mut = (t, id) => ({ type: 3, timestamp: BASE + t, data: { source: 0, id } });
const move = (t) => ({ type: 3, timestamp: BASE + t, data: { source: 1 } });
const click = (t) => ({ type: 3, timestamp: BASE + t, data: { source: 2 } });

// One take, no pause: a single snapshot at 0, so the old snap-to-anchor cut had nothing to land on.
const take = () => [meta(0), snap(0), move(200), mut(500, 'a'), click(800), mut(1500, 'b'), move(2000), mut(3000, 'c'), mut(4000, 'd')];
const rel = (evs) => evs.map((e) => e.timestamp - BASE);
const ids = (evs) => evs.filter((e) => e.type === 3 && e.data.source === 0).map((e) => e.data.id);
const edit = (o) => ({ ...emptyEdit(), ...o });

describe('editEvents', () => {
  test('no edit = same stream', () => {
    const out = editEvents(take(), emptyEdit());
    assert.deepEqual(rel(out), rel(take()));
    assert.ok(isEditEmpty(emptyEdit()));
  });

  test('a cut with no snapshot after it still works: deltas squash onto the cut start', () => {
    const out = editEvents(take(), edit({ cuts: [{ start: 400, end: 2500 }] }));
    assert.equal(playabilityProblem(out), null);
    assert.deepEqual(ids(out), ['a', 'b', 'c', 'd'], 'a DOM delta inside the cut was lost');
    // a and b land on 400, c (3000) shifts back by 2100.
    const byId = Object.fromEntries(out.filter((e) => e.data?.id).map((e) => [e.data.id, e.timestamp - BASE]));
    assert.deepEqual(byId, { a: 400, b: 400, c: 900, d: 1900 });
    // the click and the move inside the cut are gone, the move before it stays
    assert.deepEqual(out.filter((e) => e.type === 3 && e.data.source !== 0).map((e) => e.timestamp - BASE), [200]);
  });

  test('start trim keeps the opening snapshot (squashed to 0) and starts the clock at the trim', () => {
    const out = editEvents(take(), edit({ trimStart: 1000 }));
    assert.equal(playabilityProblem(out), null);
    assert.equal(out[0].type, 4, 'Meta must still lead');
    assert.equal(out[1].type, 2);
    assert.equal(out[0].timestamp, BASE, 'the origin moved');
    assert.deepEqual(ids(out), ['a', 'b', 'c', 'd']);
    assert.equal(out[out.length - 1].timestamp - BASE, 3000);
  });

  test('end trim drops the tail outright', () => {
    const out = editEvents(take(), edit({ trimEnd: 2000 }));
    assert.deepEqual(ids(out), ['a', 'b']);
    assert.equal(out[out.length - 1].timestamp - BASE, 2000);
  });

  test('a snapshot inside a cut re-anchors it: what came before it in the cut is dropped', () => {
    const evs = [meta(0), snap(0), mut(500, 'a'), mut(1000, 'b'), meta(1990), snap(2000), mut(2500, 'c'), mut(4000, 'd')];
    const out = editEvents(evs, edit({ cuts: [{ start: 800, end: 3000 }] }));
    assert.equal(playabilityProblem(out), null);
    assert.deepEqual(ids(out), ['a', 'c', 'd'], 'b is superseded by the snapshot and must go');
    assert.deepEqual(out.filter((e) => e.type === 4 || e.type === 2).map((e) => [e.type, e.timestamp - BASE]), [[4, 0], [2, 0], [4, 800], [2, 800]]);
  });

  test('dropPointerMoves strips cursor moves but nothing that changes the page', () => {
    const out = editEvents(take(), emptyEdit(), { dropPointerMoves: true });
    assert.ok(!out.some((e) => e.type === 3 && e.data.source === 1));
    assert.deepEqual(ids(out), ['a', 'b', 'c', 'd']);
  });

  test('never mutates the raw take', () => {
    const t = take();
    const before = JSON.stringify(t);
    editEvents(t, edit({ trimStart: 300, cuts: [{ start: 1000, end: 3500 }], trimEnd: 3800 }));
    assert.equal(JSON.stringify(t), before);
  });

  test('every combination stays playable and monotonic', () => {
    const t = take();
    for (const ts of [0, 100, 1000, 3999]) for (const te of [null, 4000, 3500, 1200]) for (const c of [[], [{ start: 100, end: 300 }], [{ start: 1200, end: 3900 }, { start: 400, end: 900 }]]) {
      const e = edit({ trimStart: ts, trimEnd: te, cuts: c });
      if (te != null && te <= ts) continue;
      const out = editEvents(t, e);
      assert.equal(playabilityProblem(out), null, JSON.stringify(e));
      assert.ok(out[out.length - 1].timestamp - out[0].timestamp <= editedDuration(e, 4000), 'events run past the edited timeline: ' + JSON.stringify(e));
      if (te == null) assert.equal(out[out.length - 1].timestamp - out[0].timestamp, editedDuration(e, 4000), 'duration disagrees with the timeline: ' + JSON.stringify(e));
    }
  });
});

describe('time mapping', () => {
  const e = edit({ trimStart: 1000, cuts: [{ start: 2000, end: 3000 }], trimEnd: 5000 });
  test('mapTime / unmapTime agree outside removed ranges', () => {
    for (const t of [1000, 1500, 1999, 3000, 4200, 5000]) assert.equal(unmapTime(mapTime(t, e, 6000), e, 6000), t, String(t));
  });
  test('inside a removed range maps onto its start; past the end is null', () => {
    assert.equal(mapTime(500, e, 6000), 0);
    assert.equal(mapTime(2500, e, 6000), 1000);
    assert.equal(mapTime(5500, e, 6000), null);
    assert.equal(editedDuration(e, 6000), 3000);
  });
  test('normalizeCuts clamps, drops slivers, merges overlaps', () => {
    assert.deepEqual(normalizeCuts([{ start: 900, end: 400 }, { start: 800, end: 1200 }, { start: 3000, end: 3010 }, { start: -5, end: 50 }, { start: 5900, end: 9000 }], 6000),
      [{ start: 0, end: 50 }, { start: 400, end: 1200 }, { start: 5900, end: 6000 }]);
  });
  test('removedRanges folds the start trim in and clips to the end trim', () => {
    assert.deepEqual(removedRanges(edit({ trimStart: 500, trimEnd: 2500, cuts: [{ start: 400, end: 900 }, { start: 2000, end: 4000 }] }), 6000),
      [{ start: 0, end: 900 }, { start: 2000, end: 2500 }]);
  });
});

describe('regions and markers', () => {
  test('a frame move inside a cut is the frame after the cut (not dropped)', () => {
    const regs = [{ t: 0, rect: { x: 0, y: 0, w: 100, h: 100 } }, { t: 2500, rect: { x: 50, y: 0, w: 100, h: 100 } }, { t: 3500, rect: { x: 9, y: 9, w: 9, h: 9 } }];
    const out = editRegions(regs, edit({ cuts: [{ start: 2000, end: 3000 }] }), 4000);
    assert.deepEqual(out.map((r) => [r.t, r.rect.x]), [[0, 0], [2000, 50], [2500, 9]]);
  });
  test('start trim collapses earlier keyframes to 0, last one wins', () => {
    const regs = [{ t: 0, rect: { x: 1, y: 0, w: 1, h: 1 } }, { t: 400, rect: { x: 2, y: 0, w: 1, h: 1 } }, { t: 900, rect: { x: 3, y: 0, w: 1, h: 1 } }];
    assert.deepEqual(editRegions(regs, edit({ trimStart: 500 }), 1000).map((r) => [r.t, r.rect.x]), [[0, 2], [400, 3]]);
  });
  test('markers inside removed time are dropped, others shift', () => {
    const out = editMarkers([{ t: 100, label: 'x' }, { t: 2500, label: 'gone' }, { t: 3500, label: 'y' }], edit({ cuts: [{ start: 2000, end: 3000 }] }), 4000);
    assert.deepEqual(out, [{ t: 100, label: 'x' }, { t: 2500, label: 'y' }]);
  });
  test('a marker ON a cut start marks the join and survives', () => {
    assert.deepEqual(editMarkers([{ t: 2000, label: 'join' }], edit({ cuts: [{ start: 2000, end: 3000 }] }), 4000), [{ t: 2000, label: 'join' }]);
  });
});

describe('helpers', () => {
  test('playabilityProblem catches what the players choke on', () => {
    assert.equal(playabilityProblem([meta(0)]), 'too_short');
    assert.equal(playabilityProblem([meta(0), mut(1, 'a'), snap(2)]), 'delta_before_snapshot');
    assert.equal(playabilityProblem([meta(0), snap(5), mut(3, 'a')]), 'non_monotonic');
    assert.equal(playabilityProblem([meta(0), meta(1)]), 'no_snapshot');
  });
  test('anchorsOf lists full snapshots relative to the start', () => {
    assert.deepEqual(anchorsOf([meta(0), snap(0), mut(5, 'a'), snap(900)]), [0, 900]);
  });
  test('embed snippets in both dialects, title escaped', () => {
    const s = embedSnippets('bmm-session-1.bmmreplay', 'Install "a" <mod>');
    assert.equal(s.md, ':::replay{src="assets/replays/bmm-session-1.bmmreplay" title="Install  a  <mod>"}\n:::');
    assert.equal(s.html, '<div class="bmm-replay" data-src="../assets/replays/bmm-session-1.bmmreplay" data-title="Install  a  &lt;mod&gt;"></div>');
    assert.ok(!embedSnippets('../../x".bmmreplay', '').md.includes('"../'), 'path characters leak into src');
  });
  test('fmtClock', () => { assert.equal(fmtClock(61500), '1:01.5'); assert.equal(fmtClock(0), '0:00.0'); });
});
