// The notification rules (frontend/src/core/notif-model.ts): which group a message belongs to,
// how each group is delivered, do-not-disturb and quiet hours, folding repeats, snoozing and
// the bounded history. Plus the wiring: toast() asks these rules, the centre groups by them,
// the keys it shows exist in both languages.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const N = await import(pathToFileURL(join(ROOT, 'frontend/js/core/notif-model.js')).href);

const at = (h, m = 0) => { const d = new Date(2026, 9, 14, h, m, 0, 0); return d; };
const prefs = (o = {}) => ({ ...N.parsePrefs(null), ...o });

describe('groups', () => {
  test('every source label the app uses lands in a group', () => {
    assert.equal(N.groupOf('BMM'), 'app');
    assert.equal(N.groupOf(undefined), 'app');
    assert.equal(N.groupOf('Updates'), 'updates');
    assert.equal(N.groupOf('Repo'), 'repos');
    assert.equal(N.groupOf('Tasks'), 'scheduler');
    assert.equal(N.groupOf('Activity'), 'activity');
    assert.equal(N.groupOf('BCWEB'), 'community');
    assert.equal(N.groupOf('Conflicts'), 'app');
    assert.equal(N.groupOf('something new'), 'app', 'an unknown source is the app, and heard');
  });
});

describe('preferences', () => {
  test('defaults: every group in the app, no do-not-disturb', () => {
    const p = N.parsePrefs(null);
    for (const g of N.NOTIF_GROUPS) assert.equal(N.modeFor(p, g), 'app');
    assert.equal(p.dnd, false);
    assert.equal(p.quiet.enabled, false);
  });
  test('malformed storage falls back field by field', () => {
    const p = N.parsePrefs(JSON.stringify({ modes: { repos: 'system', scheduler: 'loud' }, dnd: 'yes', quiet: { enabled: true, from: '25:00', to: '07:30' } }));
    assert.equal(N.modeFor(p, 'repos'), 'system');
    assert.equal(N.modeFor(p, 'scheduler'), 'app', 'an unknown mode is ignored');
    assert.equal(p.dnd, false);
    assert.equal(p.quiet.from, '22:00');
    assert.equal(p.quiet.to, '07:30');
    assert.equal(N.parsePrefs('{not json').dnd, false);
  });
  test('the old per-source mute carries over once, as « off »', () => {
    const p = N.parsePrefs(null, JSON.stringify(['Repo', 'BCWEB']));
    assert.equal(N.modeFor(p, 'repos'), 'off');
    assert.equal(N.modeFor(p, 'community'), 'off');
    assert.equal(N.modeFor(p, 'updates'), 'app');
    // Once the new settings exist, the old list no longer decides anything.
    const q = N.parsePrefs(JSON.stringify({ modes: {} }), JSON.stringify(['Repo']));
    assert.equal(N.modeFor(q, 'repos'), 'app');
  });
});

describe('quiet hours', () => {
  const q = { enabled: true, from: '22:00', to: '08:00' };
  test('a window across midnight', () => {
    assert.equal(N.inQuietHours(q, at(23)), true);
    assert.equal(N.inQuietHours(q, at(3)), true);
    assert.equal(N.inQuietHours(q, at(8)), false, 'the end is exclusive');
    assert.equal(N.inQuietHours(q, at(12)), false);
  });
  test('a window inside one day, off, and equal ends', () => {
    assert.equal(N.inQuietHours({ enabled: true, from: '12:00', to: '14:00' }, at(13)), true);
    assert.equal(N.inQuietHours({ enabled: true, from: '12:00', to: '14:00' }, at(15)), false);
    assert.equal(N.inQuietHours({ ...q, enabled: false }, at(23)), false);
    assert.equal(N.inQuietHours({ enabled: true, from: '10:00', to: '10:00' }, at(10)), false);
  });
});

describe('delivery', () => {
  const now = at(12);
  test('in the app by default; a system notification only when chosen and BMM is behind', () => {
    assert.deepEqual(N.deliveryFor('info', 'repos', prefs(), { now, focused: true }), { toast: true, os: false });
    const sys = prefs({ modes: { repos: 'system' } });
    assert.deepEqual(N.deliveryFor('info', 'repos', sys, { now, focused: true }), { toast: true, os: false });
    assert.deepEqual(N.deliveryFor('info', 'repos', sys, { now, focused: false }), { toast: true, os: true });
  });
  test('off keeps it in the list only, but an error still shows', () => {
    const off = prefs({ modes: { scheduler: 'off' } });
    assert.deepEqual(N.deliveryFor('success', 'scheduler', off, { now, focused: true }), { toast: false, os: false });
    assert.deepEqual(N.deliveryFor('error', 'scheduler', off, { now, focused: true }), { toast: true, os: false });
  });
  test('do not disturb and quiet hours silence everything but in-app errors', () => {
    const dnd = prefs({ dnd: true, modes: { updates: 'system' } });
    assert.deepEqual(N.deliveryFor('info', 'updates', dnd, { now, focused: false }), { toast: false, os: false });
    assert.deepEqual(N.deliveryFor('error', 'updates', dnd, { now, focused: false }), { toast: true, os: false });
    const night = prefs({ quiet: { enabled: true, from: '22:00', to: '08:00' } });
    assert.equal(N.deliveryFor('info', 'app', night, { now: at(23), focused: true }).toast, false);
    assert.equal(N.deliveryFor('info', 'app', night, { now: at(9), focused: true }).toast, true);
  });
  test('the old global popup switch still works', () => {
    assert.equal(N.deliveryFor('info', 'app', prefs(), { now, focused: true, globalMuted: true }).toast, false);
    assert.equal(N.deliveryFor('error', 'app', prefs(), { now, focused: true, globalMuted: true }).toast, true);
  });
});

describe('history', () => {
  const T0 = 1_800_000_000_000;
  test('a repeat within a moment folds into one entry with a count', () => {
    let r = N.addEntry([], { source: 'BMM', type: 'info', message: 'Mod X enabled' }, T0);
    assert.equal(r.folded, false);
    r = N.addEntry(r.list, { source: 'BMM', type: 'info', message: 'Mod X enabled' }, T0 + 500);
    assert.equal(r.folded, true);
    assert.equal(r.list.length, 1);
    assert.equal(r.list[0].count, 2);
    // Later, it is a new event.
    r = N.addEntry(r.list, { source: 'BMM', type: 'info', message: 'Mod X enabled' }, T0 + 60_000);
    assert.equal(r.list.length, 2);
  });
  test('the same key is the same event, however late, and comes back unread on top', () => {
    let r = N.addEntry([], { source: 'Updates', type: 'info', message: 'v1.0.4 is available', key: 'update:1.0.4' }, T0);
    r = N.addEntry(r.list, { source: 'BMM', type: 'info', message: 'something else' }, T0 + 10);
    r.list[1].read = true;
    r = N.addEntry(r.list, { source: 'Updates', type: 'info', message: 'v1.0.4 is available', key: 'update:1.0.4' }, T0 + 86_400_000);
    assert.equal(r.folded, true);
    assert.equal(r.list.length, 2);
    assert.equal(r.list[0].key, 'update:1.0.4');
    assert.equal(r.list[0].read, false);
  });
  test('bounded by count and by age', () => {
    let list = [];
    for (let i = 0; i < N.HISTORY_MAX + 30; i++) list = N.addEntry(list, { source: 'BMM', type: 'info', message: `m${i}` }, T0 + i * 10_000).list;
    assert.equal(list.length, N.HISTORY_MAX);
    assert.equal(list[0].message, `m${N.HISTORY_MAX + 29}`, 'newest kept');
    const old = [{ id: 'a', source: 'BMM', type: 'info', message: 'old', ts: T0 - N.HISTORY_MAX_AGE_MS - 1 }];
    assert.equal(N.pruneHistory(old, T0).length, 0);
  });
  test('snoozed entries leave the count and come back unread when their time comes', () => {
    const list = [
      { id: 'a', source: 'BMM', type: 'info', message: 'a', ts: T0 },
      { id: 'b', source: 'Repo', type: 'info', message: 'b', ts: T0, read: true, snoozedUntil: T0 + 3_600_000 },
    ];
    assert.equal(N.unreadOf(list, T0), 1);
    assert.equal(N.isSnoozed(list[1], T0), true);
    const w = N.wakeSnoozed(list, T0 + 3_600_000);
    assert.equal(w.woke, 1);
    assert.equal(w.list[1].snoozedUntil, undefined);
    assert.equal(N.unreadOf(w.list, T0 + 3_600_000), 2);
  });
  test('snooze presets', () => {
    const now = at(15, 30);
    assert.equal(N.snoozeUntil('1h', now) - now.getTime(), 3_600_000);
    const tm = new Date(N.snoozeUntil('tomorrow', now));
    assert.equal(tm.getDate(), now.getDate() + 1);
    assert.equal(tm.getHours(), 9);
  });
  test('grouped by source group, the group with the newest entry first', () => {
    const list = [
      { id: '3', source: 'Repo', type: 'info', message: 'r2', ts: 3 },
      { id: '2', source: 'BMM', type: 'info', message: 'a', ts: 2, read: true },
      { id: '1', source: 'Repo', type: 'info', message: 'r1', ts: 1 },
    ];
    const g = N.groupEntries(list, 10);
    assert.deepEqual(g.map((x) => x.group), ['repos', 'app']);
    assert.equal(g[0].entries.length, 2);
    assert.equal(g[0].unread, 2);
    assert.equal(g[1].unread, 0);
  });
  test('a popup on screen is identified by its text, or by its key', () => {
    assert.equal(N.toastKey('a', 'info', 'BMM'), N.toastKey('a', 'info', 'BMM'));
    assert.notEqual(N.toastKey('a', 'info', 'BMM'), N.toastKey('a', 'error', 'BMM'));
    assert.equal(N.toastKey('a', 'info', 'BMM', 'k'), N.toastKey('b', 'warning', 'Repo', 'k'));
  });
});

describe('wiring', () => {
  const APP = read('frontend/src/ui/app.ts');
  const NC = read('frontend/src/ui/notification-center.ts');
  test('toast() asks the rules, folds repeats on screen, and can send a system notification', () => {
    assert.match(APP, /NotifRules\.deliveryFor\(/);
    assert.match(APP, /_liveToasts/);
    assert.match(APP, /sendSystemNotification\(/);
  });
  test('the centre groups, snoozes, and opens', () => {
    for (const fn of ['groupEntries', 'snoozeUntil', 'wakeSnoozed', 'addEntry']) assert.match(NC, new RegExp(`N\\.${fn}\\(`));
    assert.match(NC, /registerNotifAction\(/);
    assert.match(NC, /ArrowDown/);
  });
  test('every group, mode and type label exists in both languages', () => {
    const en = JSON.parse(read('frontend/Lang/en.json'));
    const fr = JSON.parse(read('frontend/Lang/fr.json'));
    const keys = [
      ...N.NOTIF_GROUPS.map((g) => `notif.group.${g}`),
      ...N.NOTIF_GROUPS.map((g) => `settings.notifGroupHint.${g}`),
      ...N.DELIVERY_MODES.map((m) => `settings.notifMode.${m}`),
      ...['info', 'success', 'warning', 'error'].map((x) => `notif.t_${x}`),
    ];
    for (const k of keys) { assert.ok(en[k], `en ${k}`); assert.ok(fr[k], `fr ${k}`); }
  });
});
