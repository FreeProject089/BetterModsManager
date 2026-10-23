// The scheduler's calendar arithmetic, against the COMPILED module.
//
// Every assertion here is either the bug that shipped or a case the rewrite could
// plausibly get wrong. The bug that shipped: `dailyAt` fired only if the current hour
// AND minute matched, so a daily 03:00 task on a machine that is asleep at 03:00 never
// ran once — and the UI happily showed it as scheduled.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { prevCalendarDue, nextCalendarDue, calendarDue, parseHm, atTime } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/features/settings/sched-time.js')).href
);

// Local time throughout — a scheduler's "03:00" means the user's 03:00, and building
// these with UTC would test a different program.
const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);
const DAILY_3AM = { type: 'dailyAt', time: '03:00' };

describe('parseHm', () => {
  test('reads a plain HH:MM', () => assert.deepEqual(parseHm('21:45'), { h: 21, m: 45 }));
  test('garbage is midnight, not NaN', () => assert.deepEqual(parseHm('nonsense'), { h: 0, m: 0 }));
  test('clamps rather than wrapping — 99:99 must not become tomorrow', () =>
    assert.deepEqual(parseHm('99:99'), { h: 23, m: 59 }));
});

describe('prevCalendarDue — daily', () => {
  test('after the time, the window is today', () => {
    assert.equal(prevCalendarDue(DAILY_3AM, local(2026, 8, 13, 9, 0)), atTime(local(2026, 8, 13), 3, 0).getTime());
  });
  test('before the time, the window is yesterday', () => {
    assert.equal(prevCalendarDue(DAILY_3AM, local(2026, 8, 13, 1, 0)), atTime(local(2026, 8, 12), 3, 0).getTime());
  });
  test('exactly at the time counts as due, not as one second early', () => {
    assert.equal(prevCalendarDue(DAILY_3AM, local(2026, 8, 13, 3, 0)), atTime(local(2026, 8, 13), 3, 0).getTime());
  });
});

describe('prevCalendarDue — weekly', () => {
  const MON_WED = { type: 'weeklyAt', time: '20:00', days: [1, 3] }; // Mon + Wed
  test('picks the most recent selected day', () => {
    // 2026-08-13 is a Thursday; the last window was Wednesday the 12th.
    assert.equal(prevCalendarDue(MON_WED, local(2026, 8, 13, 9, 0)), atTime(local(2026, 8, 12), 20, 0).getTime());
  });
  test('on a selected day but before the hour, it is the PREVIOUS selected day', () => {
    // Wednesday 09:00 → Monday 20:00, not this morning.
    assert.equal(prevCalendarDue(MON_WED, local(2026, 8, 12, 9, 0)), atTime(local(2026, 8, 10), 20, 0).getTime());
  });
  test('no days selected has no window at all — and must not throw', () => {
    assert.equal(prevCalendarDue({ type: 'weeklyAt', time: '20:00', days: [] }, local(2026, 8, 13, 9, 0)), null);
  });
});

describe('prevCalendarDue — monthly', () => {
  test('day 31 SKIPS a 30-day month instead of firing on the 30th', () => {
    // In June (30 days) there is no 31st: the last window is 31 May.
    const at = prevCalendarDue({ type: 'monthlyAt', day: 31, time: '08:00' }, local(2026, 6, 20, 12, 0));
    assert.equal(at, atTime(local(2026, 5, 31), 8, 0).getTime());
  });
  test('before this month’s day, it is last month’s', () => {
    const at = prevCalendarDue({ type: 'monthlyAt', day: 15, time: '08:00' }, local(2026, 8, 3, 12, 0));
    assert.equal(at, atTime(local(2026, 7, 15), 8, 0).getTime());
  });
});

describe('nextCalendarDue', () => {
  test('daily: before the hour it is today, after it is tomorrow', () => {
    assert.equal(nextCalendarDue(DAILY_3AM, local(2026, 8, 13, 1, 0)), atTime(local(2026, 8, 13), 3, 0).getTime());
    assert.equal(nextCalendarDue(DAILY_3AM, local(2026, 8, 13, 9, 0)), atTime(local(2026, 8, 14), 3, 0).getTime());
  });
  test('is strictly in the future — standing exactly on the window gives the NEXT one', () => {
    // Otherwise a task that just ran would advertise "next run: now" forever.
    assert.equal(nextCalendarDue(DAILY_3AM, local(2026, 8, 13, 3, 0)), atTime(local(2026, 8, 14), 3, 0).getTime());
  });
  test('monthly day 31 skips forward over the short months', () => {
    const at = nextCalendarDue({ type: 'monthlyAt', day: 31, time: '08:00' }, local(2026, 6, 1, 12, 0));
    assert.equal(at, atTime(local(2026, 7, 31), 8, 0).getTime()); // June has no 31st
  });
  test('crosses a year boundary', () => {
    const at = nextCalendarDue({ type: 'monthlyAt', day: 5, time: '08:00' }, local(2026, 12, 20, 12, 0));
    assert.equal(at, atTime(local(2027, 1, 5), 8, 0).getTime());
  });
});

describe('calendarDue — the bug this rewrite exists for', () => {
  const created = local(2026, 8, 1).getTime();

  test('a run missed while BMM was closed is owed at the next launch', () => {
    // THE SHIPPED BUG: last run yesterday morning, it is now 09:00, the 03:00 window
    // came and went while the machine was off. The old rule needed the clock to read
    // exactly 03:00 and so never fired again.
    const lastRun = local(2026, 8, 12, 3, 0).getTime();
    assert.equal(calendarDue(DAILY_3AM, local(2026, 8, 13, 9, 0), Math.max(lastRun, created), true), true);
  });

  test('but only ONCE, however long BMM was away', () => {
    // Away for a week. After the owed run, the baseline is today's window and nothing
    // more is due — a week offline must not produce seven runs in a row.
    const now = local(2026, 8, 13, 9, 0);
    const afterTheOwedRun = prevCalendarDue(DAILY_3AM, now);
    assert.equal(calendarDue(DAILY_3AM, now, afterTheOwedRun, true), false);
  });

  test('already ran in this window → not due again', () => {
    const ranAt = local(2026, 8, 13, 3, 0).getTime();
    assert.equal(calendarDue(DAILY_3AM, local(2026, 8, 13, 3, 20), ranAt, true), false);
  });

  test('a task created AFTER today’s window does not fire the moment it is saved', () => {
    // Save a daily 03:00 task at 22:00. Today's 03:00 is in the past, but it is not a
    // window this task ever missed — firing here reads as a bug even though every other
    // part of the rule is right.
    const madeAt = local(2026, 8, 13, 22, 0).getTime();
    assert.equal(calendarDue(DAILY_3AM, local(2026, 8, 13, 22, 0, 5), madeAt, true), false);
  });

  test('catch-up off: the missed window stays missed', () => {
    const lastRun = local(2026, 8, 12, 3, 0).getTime();
    assert.equal(calendarDue(DAILY_3AM, local(2026, 8, 13, 9, 0), lastRun, false), false);
  });

  test('catch-up off still fires inside the live window', () => {
    // Otherwise turning catch-up off would disable the task entirely.
    const lastRun = local(2026, 8, 12, 3, 0).getTime();
    assert.equal(calendarDue(DAILY_3AM, local(2026, 8, 13, 3, 0, 30), lastRun, false), true);
  });
});
