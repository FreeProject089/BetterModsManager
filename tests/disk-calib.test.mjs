// Automatic disk calibration: once per disk, then only when the last measurement is more than
// 30 days old (it used to run at every start and write 50 MB per disk).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { calibrationDue, withCalibrated, RECALIBRATE_AFTER_MS } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/features/settings/disk-calib.js')).href
);

const DAY = 24 * 60 * 60 * 1000;

test('a disk never measured is due', () => {
  assert.equal(calibrationDue({}, 'D:\\', 1000), true);
});

test('calibration is skipped when fresh under 30 days', () => {
  const now = 100 * DAY;
  const m = withCalibrated({}, 'D:\\', now - 5 * DAY);
  assert.equal(calibrationDue(m, 'd:\\', now), false, 'the mount point is compared case-insensitively');
  assert.equal(calibrationDue(m, 'D:\\', now - 5 * DAY + RECALIBRATE_AFTER_MS - 1), false);
  assert.equal(calibrationDue(m, 'D:\\', now - 5 * DAY + RECALIBRATE_AFTER_MS), true, 'due again after 30 days');
  assert.equal(calibrationDue(m, 'E:\\', now), true, 'another disk has its own date');
});

test('a timestamp from the future or garbage does not stop calibration for ever', () => {
  const now = 100 * DAY;
  assert.equal(calibrationDue({ 'd:\\': now + 10 * DAY }, 'D:\\', now), true, 'a clock that went backwards');
  assert.equal(calibrationDue({ 'd:\\': 'yesterday' }, 'D:\\', now), true);
  assert.equal(calibrationDue({ 'd:\\': 0 }, 'D:\\', now), true);
});
