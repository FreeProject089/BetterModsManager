// The resources dashboard's pure parts (G6): the rolling history and the sparkline points.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { pushHistory, sparkPoints } = await import(pathToFileURL(join(ROOT, 'frontend/js/features/settings/resources-spark.js')).href);

test('the history keeps the last N values, oldest first, and a NaN counts as 0', () => {
  let h = [];
  for (let i = 0; i < 65; i++) h = pushHistory(h, i);
  assert.equal(h.length, 60);
  assert.equal(h[0], 5);
  assert.equal(h[59], 64);
  assert.deepEqual(pushHistory([1], NaN, 3), [1, 0]);
});

test('sparkline points span the width and put the ceiling at the top', () => {
  assert.equal(sparkPoints([], 120, 28, 100), '');
  const pts = sparkPoints([0, 50, 100], 120, 28, 100).split(' ').map((p) => p.split(',').map(Number));
  assert.deepEqual(pts[0], [0, 28]);
  assert.deepEqual(pts[1], [60, 14]);
  assert.deepEqual(pts[2], [120, 0]);
});

test('a value above the ceiling rescales instead of leaving the box', () => {
  const pts = sparkPoints([0, 4], 100, 20, 1).split(' ').map((p) => p.split(',').map(Number));
  assert.equal(Math.min(...pts.map(([, y]) => y)), 0);
});

test('a matrix row becomes the rule to store: empty = inherit, garbage dropped, nothing = remove', async () => {
  const { ruleFromInputs } = await import(pathToFileURL(join(ROOT, 'frontend/js/features/settings/resources-spark.js')).href);
  assert.equal(ruleFromInputs({ rate: '', parallel: '', buffer: '', io: '' }), null);
  assert.deepEqual(ruleFromInputs({ rate: '40', parallel: ' 3 ', buffer: 'abc', io: '' }), { rate_mb_s: 40, parallel: 3 });
  assert.deepEqual(ruleFromInputs({ rate: '0', io: 'low' }), { io_priority: 'low' }, 'a 0 rate is not stored (it would block for ever)');
  assert.deepEqual(ruleFromInputs({ buffer: '512.9', io: 'high' }), { buffer_kib: 512 }, 'only low / normal priorities exist');
});
