// Mid-timeline cuts, against the COMPILED module.
//
// The one thing that makes a cut different from an end-trim: an rrweb recording is a full
// snapshot followed by mutations that reference nodes by id, so a cut can only end where the
// player can re-enter the recording — at another full snapshot. Every assertion here is
// either that rule or an edge somebody would plausibly get wrong.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { planCuts, applyCuts, shiftPastCuts, isCut, FULL_SNAPSHOT } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/features/debug/replay-cut.js')).href
);

// A take: snapshot at 0, mutations, snapshots at 3000 and 7000 (what a resume produces).
const take = () => [
  { type: FULL_SNAPSHOT, timestamp: 0 },
  { type: 3, timestamp: 500 },
  { type: 3, timestamp: 1500 },
  { type: FULL_SNAPSHOT, timestamp: 3000 },
  { type: 3, timestamp: 3500 },
  { type: 3, timestamp: 5000 },
  { type: FULL_SNAPSHOT, timestamp: 7000 },
  { type: 3, timestamp: 7500 },
  { type: 3, timestamp: 9000 },
];

describe('planCuts', () => {
  test('snaps a cut end forward to the next full snapshot', () => {
    const p = planCuts(take(), [{ start: 1000, end: 2000 }]);
    assert.deepEqual(p.cuts, [{ start: 1000, end: 3000 }]);
    assert.deepEqual(p.snapped, [{ asked: 2000, applied: 3000 }]);
    assert.equal(p.refused.length, 0);
  });

  test('a cut already ending on a snapshot is not reported as snapped', () => {
    const p = planCuts(take(), [{ start: 1000, end: 3000 }]);
    assert.deepEqual(p.cuts, [{ start: 1000, end: 3000 }]);
    assert.equal(p.snapped.length, 0);
  });

  test('refuses a cut with no snapshot after it rather than eating the tail', () => {
    // Nothing anchors a resume after 7500, so this would delete the rest of the recording.
    const p = planCuts(take(), [{ start: 7200, end: 8000 }]);
    assert.deepEqual(p.cuts, []);
    assert.deepEqual(p.refused.map((r) => r.reason), ['no_anchor']);
  });

  test('the opening snapshot is not an anchor — that would be a start trim', () => {
    const events = [
      { type: FULL_SNAPSHOT, timestamp: 0 },
      { type: 3, timestamp: 100 },
      { type: 3, timestamp: 200 },
    ];
    assert.deepEqual(planCuts(events, [{ start: 50, end: 80 }]).cuts, []);
  });

  test('reversed and empty ranges are refused, not silently swapped into something', () => {
    const p = planCuts(take(), [{ start: 2000, end: 2000 }]);
    assert.deepEqual(p.cuts, []);
    assert.deepEqual(p.refused.map((r) => r.reason), ['empty']);
    // A reversed range IS normalised — the intent is unambiguous, unlike an empty one.
    assert.deepEqual(planCuts(take(), [{ start: 2000, end: 1000 }]).cuts, [{ start: 1000, end: 3000 }]);
  });

  test('overlapping cuts merge so no millisecond is subtracted twice', () => {
    const p = planCuts(take(), [{ start: 1000, end: 2000 }, { start: 2500, end: 4000 }]);
    assert.deepEqual(p.cuts, [{ start: 1000, end: 7000 }]);
  });

  test('no ranges, or no events, is a no-op rather than a throw', () => {
    assert.deepEqual(planCuts(take(), []).cuts, []);
    assert.deepEqual(planCuts([], [{ start: 1, end: 2 }]).cuts, []);
  });
});

describe('applyCuts', () => {
  test('drops what is inside and pulls the rest back by exactly the cut length', () => {
    const events = take();
    const { cuts } = planCuts(events, [{ start: 1000, end: 2000 }]); // → 1000..3000, 2000ms
    const out = applyCuts(events, cuts);
    assert.deepEqual(out.map((e) => e.timestamp), [0, 500, 1000, 1500, 3000, 5000, 5500, 7000]);
    // The anchor snapshot survives — it is what playback resumes on.
    assert.equal(out[2].type, FULL_SNAPSHOT);
  });

  test('leaves the caller array untouched', () => {
    const events = take();
    const before = JSON.stringify(events);
    applyCuts(events, planCuts(events, [{ start: 1000, end: 2000 }]).cuts);
    assert.equal(JSON.stringify(events), before);
  });

  test('timestamps stay monotonic after two cuts', () => {
    const events = take();
    const { cuts } = planCuts(events, [{ start: 500, end: 1200 }, { start: 3500, end: 5500 }]);
    const ts = applyCuts(events, cuts).map((e) => e.timestamp);
    for (let i = 1; i < ts.length; i++) assert.ok(ts[i] >= ts[i - 1], `${ts[i - 1]} → ${ts[i]}`);
  });

  test('an empty cut list returns the take unchanged', () => {
    const events = take();
    assert.deepEqual(applyCuts(events, []).map((e) => e.timestamp), events.map((e) => e.timestamp));
  });
});

describe('boundaries', () => {
  test('a cut includes its start and excludes nothing before it', () => {
    const cuts = [{ start: 1000, end: 3000 }];
    assert.equal(isCut(999, cuts), false);
    assert.equal(isCut(1000, cuts), true);
    // The anchor itself is kept: it is the frame the recording resumes on.
    assert.equal(isCut(3000, cuts), false);
  });

  test('shiftPastCuts subtracts only fully-elapsed cuts', () => {
    const cuts = [{ start: 1000, end: 3000 }];
    assert.equal(shiftPastCuts(500, cuts), 500);
    assert.equal(shiftPastCuts(3000, cuts), 1000);
    assert.equal(shiftPastCuts(9000, cuts), 7000);
  });
});
