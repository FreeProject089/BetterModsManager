// The activity centre's registry (frontend/src/core/activity.ts) and its adapters
// (frontend/src/core/activity-sources.ts), against the COMPILED modules with a fake clock,
// a fake storage and a fake backend: a row starts, moves, ends in the history (bounded,
// persisted, sanitised), Cancel reaches the subsystem, a command listed in COMMANDS becomes a
// row through the invoke hook, its progress event moves it, and an activation job is a row
// that ends with the job's summary.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const A = await import(pathToFileURL(join(ROOT, 'frontend/js/core/activity.js')).href);
const S = await import(pathToFileURL(join(ROOT, 'frontend/js/core/activity-sources.js')).href);
const J = await import(pathToFileURL(join(ROOT, 'frontend/js/core/activation-jobs.js')).href);

function memStore() {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

let now = 1000;
let store;
const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);

beforeEach(() => {
  A._resetActivityForTests();
  S._resetActivitySourcesForTests();
  J._resetActivationJobsForTests();
  now = 1000;
  store = memStore();
  A.configureActivity({ now: () => now, storage: () => store });
});

describe('registry', () => {
  test('start, update, done: the row moves to the history', () => {
    let calls = 0;
    A.subscribeActivity(() => { calls += 1; });
    const h = A.startActivity({ kind: 'export', title: 'Export' });
    assert.equal(A.runningActivities().length, 1);
    assert.equal(A.runningActivities()[0].progress, null);
    h.update({ progress: 0.5, detail: 'half' });
    assert.equal(A.runningActivities()[0].progress, 0.5);
    assert.equal(A.runningActivities()[0].detail, 'half');
    h.update({ progress: 7 });
    assert.equal(A.runningActivities()[0].progress, 1, 'progress is clamped to 0..1');
    now = 4000;
    h.done();
    assert.equal(A.runningActivities().length, 0);
    const [e] = A.activityHistory();
    assert.equal(e.state, 'done');
    assert.equal(e.endedAt - e.startedAt, 3000);
    assert.ok(calls >= 4);
    assert.equal(h.isRunning(), false);
    h.update({ progress: 0.1 }); // after the end: ignored
    assert.equal(A.runningActivities().length, 0);
  });

  test('fail keeps the error text; a failure after Cancel is a cancel', async () => {
    A.startActivity({ kind: 'sync', title: 'a' }).fail(new Error('disk full'));
    assert.equal(A.activityHistory()[0].state, 'error');
    assert.equal(A.activityHistory()[0].error, 'disk full');

    let asked = 0;
    const h = A.startActivity({ kind: 'sync', title: 'b', cancel: () => { asked += 1; } });
    assert.equal(A.runningActivities()[0].cancellable, true);
    assert.equal(await A.cancelActivity(h.id), true);
    assert.equal(asked, 1);
    assert.equal(A.runningActivities()[0].cancelling, true);
    assert.equal(await A.cancelActivity(h.id), false, 'a second Cancel while stopping does nothing');
    h.fail('Sync cancelled');
    assert.equal(A.activityHistory()[0].state, 'cancelled');
  });

  test('a cancel that throws puts the row back as not cancelling', async () => {
    const h = A.startActivity({ kind: 'sync', title: 'x', cancel: () => { throw new Error('nope'); } });
    const orig = console.warn; console.warn = () => {};
    try { assert.equal(await A.cancelActivity(h.id), false); } finally { console.warn = orig; }
    assert.equal(A.runningActivities()[0].cancelling, false);
  });

  test('no cancel function: not cancellable', async () => {
    const h = A.startActivity({ kind: 'scan', title: 'x' });
    assert.equal(A.runningActivities()[0].cancellable, false);
    assert.equal(await A.cancelActivity(h.id), false);
  });

  test('a key makes start idempotent while the row runs', () => {
    const a = A.startActivity({ kind: 'activation', title: 'x', key: 'k' });
    const b = A.startActivity({ kind: 'activation', title: 'x', key: 'k', detail: 'later' });
    assert.equal(a.id, b.id);
    assert.equal(A.runningActivities().length, 1);
    assert.equal(A.runningActivities()[0].detail, 'later');
    assert.equal(A.findActivity('k').id, a.id);
    a.done();
    assert.equal(A.findActivity('k'), null);
    const c = A.startActivity({ kind: 'activation', title: 'x', key: 'k' });
    assert.notEqual(c.id, a.id, 'a new run after the end is a new row');
  });

  test('the history is bounded, newest first, and clearable', () => {
    for (let i = 0; i < A.HISTORY_MAX + 5; i++) { now += 10; A.startActivity({ kind: 'other', title: `n${i}` }).done(); }
    const h = A.activityHistory();
    assert.equal(h.length, A.HISTORY_MAX);
    assert.equal(h[0].title, `n${A.HISTORY_MAX + 4}`);
    A.clearActivityHistory();
    assert.equal(A.activityHistory().length, 0);
    assert.equal(store.m.has(A.STORAGE_KEY), false);
  });

  test('ephemeral: a quick success is not kept, a quick failure is', () => {
    A.startActivity({ kind: 'scan', title: 'quick', ephemeralMs: 1500 }).done();
    assert.equal(A.activityHistory().length, 0);
    A.startActivity({ kind: 'scan', title: 'quick-fail', ephemeralMs: 1500 }).fail('x');
    assert.equal(A.activityHistory().length, 1);
    const h = A.startActivity({ kind: 'scan', title: 'slow', ephemeralMs: 1500 });
    now += 2000;
    h.done();
    assert.equal(A.activityHistory()[0].title, 'slow');
  });

  test('the history survives a reload through storage, sanitised', () => {
    A.startActivity({ kind: 'download', title: 'kept' }).fail('boom');
    const raw = store.getItem(A.STORAGE_KEY);
    assert.ok(raw);
    A._resetActivityForTests();
    A.configureActivity({ now: () => now, storage: () => store });
    assert.equal(A.activityHistory()[0].title, 'kept');
    assert.equal(A.activityHistory()[0].error, 'boom');
    // Garbage another build (or a hand) left there is dropped row by row, not trusted.
    const clean = A.sanitizeHistory([{ id: 1 }, null, { id: 'a', title: 't', kind: 'evil', state: 'done', startedAt: 1 },
      { id: 'b', title: 't', kind: 'scan', state: 'running', startedAt: 1 }, { id: 'c', title: 't', kind: 'scan', state: 'error', startedAt: 5, error: 'e' }]);
    assert.deepEqual(clean.map((e) => e.id), ['c']);
    assert.deepEqual(A.sanitizeHistory('nope'), []);
  });

  test('storage that throws never breaks the registry', () => {
    A._resetActivityForTests();
    A.configureActivity({ now: () => now, storage: () => ({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() {} }) });
    A.startActivity({ kind: 'other', title: 'x' }).done();
    assert.equal(A.activityHistory().length, 1);
  });

  test('trackPromise ends the row with the promise', async () => {
    const ok = A.trackPromise(Promise.resolve(3), { kind: 'install', title: 'ok' });
    assert.equal(await ok, 3);
    await assert.rejects(A.trackPromise(Promise.reject(new Error('bad')), { kind: 'install', title: 'ko' }));
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(A.activityHistory().map((e) => e.state), ['error', 'done']);
  });

  test('overallProgress is the mean of the known ones', () => {
    A.startActivity({ kind: 'other', title: 'a', progress: 0.2 });
    A.startActivity({ kind: 'other', title: 'b', progress: 0.6 });
    A.startActivity({ kind: 'other', title: 'c' });
    assert.ok(Math.abs(A.overallProgress() - 0.4) < 1e-9);
    assert.equal(A.overallProgress([]), null);
  });

  test('errorText reads every shape', () => {
    assert.equal(A.errorText('x'), 'x');
    assert.equal(A.errorText(new Error('m')), 'm');
    assert.equal(A.errorText({ message: 'o' }), 'o');
    assert.equal(A.errorText({ code: 1 }), '{"code":1}');
    assert.equal(A.errorText(null), '');
    assert.equal(A.errorText('a'.repeat(2000)).length, 600);
  });
});

describe('sources', () => {
  test('a listed command becomes a row; its event moves it; its answer ends it', () => {
    const invoked = [];
    const hook = S.commandHook({ t, invoke: async (c, a) => { invoked.push([c, a]); } });
    assert.equal(hook('get_settings', {}), null, 'unlisted commands are ignored');
    const end = hook('sync_server_repo', { args: {} });
    const [row] = A.runningActivities();
    assert.equal(row.kind, 'sync');
    assert.equal(row.title, 'activity.cmd.syncRepo');
    assert.equal(row.cancellable, true);
    assert.equal(S.routeEvent('repo-sync', { step: '{"key":"repo.stepDownloading","mod":"M","current":2,"total":4}', progress: 25, current_file: 'f' }, t), true);
    assert.equal(A.runningActivities()[0].progress, 0.25);
    assert.match(A.runningActivities()[0].detail, /^repo\.stepDownloading:/);
    end(true, {});
    assert.equal(A.runningActivities().length, 0);
    assert.equal(A.activityHistory()[0].state, 'done');
    assert.equal(S.routeEvent('repo-sync', { progress: 50 }, t), false, 'no row: the event is dropped');
  });

  test('cancel reaches the backend with the run id; a cancelled answer is a cancel', async () => {
    const invoked = [];
    const hook = S.commandHook({ t, invoke: async (c, a) => { invoked.push([c, a]); } });
    const end = hook('install_from_modlist', { runId: 'r1' });
    await A.cancelActivity(A.runningActivities()[0].id);
    assert.deepEqual(invoked, [['cancel_install_from_modlist', { runId: 'r1' }]]);
    end(false, 'Installation cancelled');
    assert.equal(A.activityHistory()[0].state, 'cancelled');
    // Without a run id there is nothing to address: no Cancel.
    hook('install_from_modlist', {});
    assert.equal(A.runningActivities()[0].cancellable, false);
  });

  test('a failure keeps the backend message', () => {
    const end = S.commandHook({ t, invoke: async () => {} })('export_modpack', {});
    end(false, 'no space left');
    assert.equal(A.activityHistory()[0].error, 'no space left');
  });

  test('readProgress per channel', () => {
    assert.deepEqual(S.readProgress('mm-export', { current: 1, total: 4, mod_name: 'A' }, t), { progress: 0.25, detail: 'A' });
    const dl = S.readProgress('mod-download', { mod_index: 1, total_mods: 4, mod_name: 'B', progress: 50 }, t);
    assert.equal(dl.progress, 0.375);
    assert.equal(dl.detail, 'B (2/4)');
    assert.equal(S.readProgress('ai-analyze', { done: 3, total: 0 }, t).progress, null);
    assert.equal(S.readProgress('ai-embedded', { received: 512, total: 1024 }, t).detail, '512 B / 1.0 KB');
    assert.equal(S.readProgress('ssh', { done: 1, total: 2, current: 'x' }, t).progress, 0.5);
    assert.equal(S.repoStepText('repo.stepConnecting', t), 'repo.stepConnecting');
    assert.equal(S.repoStepText('{broken', t), '');
  });

  test('every channel of a command has an event, every cancel names a real command', () => {
    for (const [cmd, spec] of Object.entries(S.COMMANDS)) {
      if (spec.channel) assert.ok(S.CHANNEL_EVENTS[spec.channel], `${cmd}: no event for ${spec.channel}`);
      if (spec.cancel) {
        const seen = [];
        const fn = spec.cancel(async (c) => { seen.push(c); }, { runId: 'x' });
        if (fn) { fn(); assert.match(seen[0], /cancel/, `${cmd}: cancel calls ${seen[0]}`); }
      }
    }
  });

  test('an activation job is a row and ends with its summary', async () => {
    const pending = [];
    J.configureActivationJobs({
      invoke: (cmd, args = {}) => {
        if (cmd === 'get_active_profile_id') return Promise.resolve('p1');
        if (cmd === 'enable_mod') return new Promise((resolve, reject) => pending.push({ args, resolve, reject }));
        return Promise.resolve(null);
      },
      listen: () => () => {}, toast: () => {}, t, refresh: () => {},
      schedule: (fn) => fn(), later: () => {},
    });
    S.attachActivitySources({ t, invoke: async () => {}, listen: () => {}, setInvokeHook: () => {} });
    const job = J.runActivationJob({ mods: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], mode: 'enable', label: 'Two mods' });
    for (let i = 0; i < 20 && !pending.length; i++) await new Promise((r) => setTimeout(r, 0));
    const [row] = A.runningActivities();
    assert.equal(row.kind, 'activation');
    assert.equal(row.title, 'Two mods');
    assert.equal(row.cancellable, true);
    pending.shift().resolve(null);
    for (let i = 0; i < 20 && !pending.length; i++) await new Promise((r) => setTimeout(r, 0));
    assert.equal(A.runningActivities()[0].progress, 0.5);
    pending.shift().reject('broken archive');
    await job.done;
    assert.equal(A.runningActivities().length, 0);
    const [e] = A.activityHistory();
    assert.equal(e.state, 'error');
    assert.match(e.error, /B: broken archive/);
  });
});
