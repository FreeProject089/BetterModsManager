// Turning mods on and off as background jobs (frontend/src/core/activation-jobs.ts).
//
// The owner's report: "you should be able to move around BMM while mods activate, without it
// cancelling". The job manager owns the work instead of the screen that started it, so these
// check the contract against the COMPILED module with a fake backend: a job outlives whoever
// started it, nothing but an explicit cancel stops it, jobs queue one after another, and the
// progress events drive what a card shows. The Rust half (event throttle, worker progress
// line, saves) is in src-tauri/src/commands/mod_op_progress_tests.rs.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const J = await import(pathToFileURL(join(ROOT, 'frontend/js/core/activation-jobs.js')).href);
const src = (p) => readFileSync(join(ROOT, p), 'utf8').split(String.fromCharCode(13)).join('');

/** A fake backend whose enable/disable calls stay pending until the test releases them. */
function backend({ active = 'p1' } = {}) {
  const calls = [];
  const pending = [];
  const later = [];
  const toasts = [];
  let refreshes = 0;
  const invoke = (cmd, args = {}) => {
    calls.push([cmd, args]);
    if (cmd === 'get_active_profile_id') return Promise.resolve(active);
    if (cmd === 'enable_mod' || cmd === 'disable_mod') {
      return new Promise((resolve, reject) => pending.push({ cmd, args, resolve, reject }));
    }
    return Promise.resolve(null);
  };
  J.configureActivationJobs({
    invoke,
    listen: () => () => {},
    toast: (m, k) => toasts.push([m, k]),
    t: (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k),
    refresh: () => { refreshes += 1; },
    schedule: (fn) => fn(),
    later: (fn, ms) => later.push([fn, ms]),
  });
  const tick = () => new Promise((r) => setImmediate(r));
  return {
    calls, pending, later, toasts,
    refreshes: () => refreshes,
    tick,
    /** Wait until `n` enable/disable calls are pending. */
    async waitPending(n = 1) { for (let i = 0; i < 50 && pending.length < n; i++) await tick(); assert.ok(pending.length >= n, `expected ${n} pending, got ${pending.length}`); },
    async ok(value = null) { await this.waitPending(); pending.shift().resolve(value); await tick(); },
    async fail(err) { await this.waitPending(); pending.shift().reject(err); await tick(); },
    named: (cmd) => calls.filter(([c]) => c === cmd),
  };
}

beforeEach(() => J._resetActivationJobsForTests());

describe('a job belongs to the app, not to the screen that started it', () => {
  test('it runs to the end with nobody holding its handle', async () => {
    const be = backend();
    // The "view": starts the job, keeps nothing, and goes away.
    (function libraryView() {
      J.runActivationJob({ mods: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], mode: 'enable', silent: true });
    })();
    await be.ok();
    await be.ok();
    for (let i = 0; i < 5; i++) await be.tick();
    assert.deepEqual(be.named('enable_mod').map(([, a]) => a.modId), ['a', 'b']);
    assert.equal(be.named('cancel_mod_ops').length, 0, 'nothing but an explicit cancel stops it');
    assert.equal(J.isActivationBusy(), false);
  });

  test('the source never wires a cancel to navigation, a dialog close or a teardown', () => {
    const jobs = src('frontend/src/core/activation-jobs.ts');
    for (const hook of ['visibilitychange', 'nav-item', 'pagehide', 'beforeunload', 'onClose', 'MutationObserver', 'disconnectedCallback']) {
      assert.ok(!jobs.includes(hook), `activation-jobs.ts must not react to ${hook}`);
    }
    // Every invoke of cancel_mod_ops sits inside one of the two explicit stops.
    const sites = [...jobs.matchAll(/invoke\('cancel_mod_ops'/g)].map((m) => m.index);
    assert.ok(sites.length >= 1);
    for (const at of sites) {
      const fns = [...jobs.slice(0, at).matchAll(/export (?:async )?function (\w+)/g)];
      const owner = fns[fns.length - 1]?.[1];
      assert.ok(['cancelActivationJob', 'cancelExternal'].includes(owner), `cancel_mod_ops called from ${owner}`);
    }
    // Leaving the Library no longer flushes the backend cache under a running activation.
    const app = src('frontend/src/ui/app.ts');
    assert.match(app, /viewId !== 'library' && !isActivationBusy\(\)\)\s*\{\s*appState\.flushMemory\(\)/);
  });
});

describe('queueing', () => {
  test('jobs run one after another, in the order they were asked for', async () => {
    const be = backend();
    const j1 = J.runActivationJob({ mods: [{ id: 'a' }], mode: 'enable', silent: true });
    const j2 = J.runActivationJob({ mods: [{ id: 'b' }], mode: 'disable', silent: true });
    await be.waitPending();
    assert.equal(be.pending.length, 1, 'the second waits for the first');
    assert.deepEqual(J.modActivity('b'), { op: 'disable', phase: 'queued', pct: null, bytesDone: 0, bytesTotal: 0 });
    await be.ok();
    assert.equal((await j1.done).done, 1);
    await be.ok();
    assert.equal((await j2.done).done, 1);
    assert.deepEqual(be.calls.filter(([c]) => c.endsWith('_mod')).map(([c, a]) => `${c}:${a.modId}`), ['enable_mod:a', 'disable_mod:b']);
  });

  test('a mod listed twice is done once', async () => {
    const be = backend();
    const j = J.runActivationJob({ mods: [{ id: 'a' }, { id: 'a' }, { id: '' }], mode: 'enable', silent: true });
    await be.ok();
    const s = await j.done;
    assert.equal(s.total, 1);
  });

  test('errors and warnings come back per mod; the job goes on after a failure', async () => {
    const be = backend();
    const j = J.runActivationJob({ mods: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c' }], mode: 'enable' });
    await be.fail('MISSING_SHA|a|A');
    await be.ok('WARNING_SPACE|Game|9|10');
    await be.ok();
    const s = await j.done;
    assert.equal(s.failed.length, 1);
    assert.equal(s.failed[0].error, 'MISSING_SHA|a|A');
    assert.equal(s.items[1].warning, 'WARNING_SPACE|Game|9|10');
    assert.equal(s.done, 2);
    assert.equal(be.toasts.length, 1, 'one summary toast at the end, not one per mod');
    assert.equal(be.toasts[0][1], 'warning');
    assert.match(be.toasts[0][0], /A$/);
    assert.equal(be.refreshes(), 1, 'the library is re-read once, when the queue drains');
  });

  test('a profile that is not the active one is refused, nothing is touched', async () => {
    const be = backend({ active: 'p1' });
    const j = J.runActivationJob({ mods: [{ id: 'a' }], mode: 'enable', profileId: 'p2', silent: true });
    const s = await j.done;
    assert.equal(s.failed[0].error, 'actjob.errNotActive');
    assert.equal(be.named('enable_mod').length, 0);
  });
});

describe('cancelling is explicit', () => {
  test('cancel stops the running job: the mod in flight is undone by the backend, the rest is untouched, the next job still runs', async () => {
    const be = backend();
    const j1 = J.runActivationJob({ mods: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], mode: 'enable', silent: true });
    const j2 = J.runActivationJob({ mods: [{ id: 'z' }], mode: 'enable', silent: true });
    await be.ok();             // a done
    await be.waitPending();    // b in flight
    const stopping = j1.cancel();
    await be.tick();
    assert.equal(be.named('cancel_mod_ops').length, 1);
    await be.ok();             // the backend answers Ok after undoing b
    await stopping;
    const s = await j1.done;
    assert.deepEqual(s.items.map((i) => i.phase), ['done', 'cancelled', 'cancelled']);
    assert.equal(s.wasCancelled, true);
    // Its own scope: the Stop and the clear name this job, never the global flag.
    const scope = be.named('enable_mod')[0][1].cancelScope;
    assert.match(scope, /^[A-Za-z0-9_.:-]{1,64}$/);
    assert.deepEqual(be.named('cancel_mod_ops').map(([, a]) => a), [{ scope }]);
    assert.ok(be.named('clear_mod_op_cancel').some(([, a]) => a.scope === scope), 'the job forgets its scope when it ends');
    assert.ok(be.named('clear_mod_op_cancel').every(([, a]) => a && a.scope), 'no job lowers the global flag');
    await be.ok();
    assert.equal((await j2.done).done, 1, 'only the cancelled job stopped');
    assert.deepEqual(be.named('enable_mod').map(([, a]) => a.modId), ['a', 'b', 'z'], 'c was never started');
  });

  test('a queued job cancelled before its turn never reaches the backend', async () => {
    const be = backend();
    const j1 = J.runActivationJob({ mods: [{ id: 'a' }], mode: 'enable', silent: true });
    const j2 = J.runActivationJob({ mods: [{ id: 'b' }], mode: 'enable', silent: true });
    await be.waitPending();
    await j2.cancel();
    assert.equal((await j2.done).cancelled, 1);
    assert.equal(be.named('cancel_mod_ops').length, 0, 'nothing was running for it: no backend stop');
    await be.ok();
    await j1.done;
    assert.deepEqual(be.named('enable_mod').map(([, a]) => a.modId), ['a']);
  });

  test('"skip the current one" counts it as cancelled and goes on', async () => {
    const be = backend();
    const j = J.runActivationJob({ mods: [{ id: 'a' }, { id: 'b' }], mode: 'disable', silent: true });
    await be.waitPending();
    J.markCurrentSkipped();
    await be.ok();
    await be.ok();
    const s = await j.done;
    assert.deepEqual(s.items.map((i) => i.phase), ['cancelled', 'done']);
    assert.equal(s.wasCancelled, false);
  });

  test('cancel all empties the queue', async () => {
    const be = backend();
    const jobs = [1, 2, 3].map((n) => J.runActivationJob({ mods: [{ id: `m${n}` }], mode: 'enable', silent: true }));
    await be.waitPending();
    const all = J.cancelAllActivationJobs();
    await be.tick();
    await be.ok();
    await all;
    const sums = await Promise.all(jobs.map((j) => j.done));
    assert.ok(sums.every((s) => s.wasCancelled));
    assert.deepEqual(be.named('enable_mod').map(([, a]) => a.modId), ['m1']);
  });
});

describe('cancel scopes', () => {
  test("two jobs never share a scope, and one job's stop does not name the other", async () => {
    const be = backend();
    const j1 = J.runActivationJob({ mods: [{ id: 'a' }], mode: 'enable', silent: true });
    const j2 = J.runActivationJob({ mods: [{ id: 'b' }], mode: 'enable', silent: true });
    await be.waitPending();
    const s1 = be.pending[0].args.cancelScope;
    const stop = j1.cancel();
    await be.tick();
    await be.ok();
    await stop;
    await be.ok();
    await j2.done;
    const s2 = be.named('enable_mod')[1][1].cancelScope;
    assert.notEqual(s1, s2);
    assert.deepEqual(be.named('cancel_mod_ops').map(([, a]) => a.scope), [s1], 'only the first job was stopped');
  });
});

describe('a backend batch (an order list) is a job too', () => {
  /** A fake `order_list_activate` that stays pending until the test answers it. */
  function batch(mods = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]) {
    let answer;
    let scopeSeen = null;
    const handle = J.runActivationBatch({
      mods, mode: 'enable', label: 'List', source: 'order-list',
      run: (scope) => { scopeSeen = scope; return new Promise((res, rej) => { answer = { res, rej }; }); },
      failToast: (e) => ({ message: `failed ${e}`, kind: 'error' }),
    });
    return { handle, answer: () => answer, scope: () => scopeSeen };
  }
  const started = async (be, b) => { for (let i = 0; i < 20 && !b.scope(); i++) await be.tick(); assert.ok(b.scope(), 'the batch started'); };

  test('it queues behind a running job, then runs with its own scope', async () => {
    const be = backend();
    const j = J.runActivationJob({ mods: [{ id: 'x' }], mode: 'enable', silent: true });
    const b = batch();
    await be.waitPending();
    assert.equal(b.scope(), null, 'the batch waits for the job before it');
    assert.equal(J.modActivity('a').phase, 'queued');
    await be.ok();
    await j.done;
    await started(be, b);
    assert.match(b.scope(), /^actjob-/);
    assert.notEqual(b.scope(), be.named('enable_mod')[0][1].cancelScope);
    b.answer().res({ failed: [], cancelled: false, toast: { message: 'List: 2 on', kind: 'success' } });
    const s = await b.handle.done;
    assert.deepEqual(s.items.map((i) => i.phase), ['done', 'done']);
    assert.deepEqual(be.toasts.at(-1), ['List: 2 on', 'success'], "the end toast comes from the job manager, in the batch's words");
    assert.ok(be.named('clear_mod_op_cancel').some(([, a]) => a.scope === b.scope()));
  });

  test('the progress events move its items; the pill follows the mod in flight', async () => {
    const be = backend();
    const b = batch();
    await started(be, b);
    J.handleProgressEvent({ mod_id: 'b', mod_name: 'B', op: 'enable', phase: 'start', bytes_done: 0, bytes_total: 10 });
    assert.equal(J.currentActivation().item.id, 'b');
    J.handleProgressEvent({ mod_id: 'b', mod_name: 'B', op: 'enable', phase: 'done', bytes_done: 10, bytes_total: 10 });
    // A dependency the list does not name shows on its card, not as an item.
    J.handleProgressEvent({ mod_id: 'dep', op: 'enable', phase: 'start', bytes_done: 0, bytes_total: 0 });
    assert.equal(J.modActivity('dep').phase, 'running');
    b.answer().res({ failed: [{ id: 'a', name: 'A', error: 'MISSING_SHA|x' }], cancelled: false });
    const s = await b.handle.done;
    assert.deepEqual(s.items.map((i) => [i.id, i.phase]), [['a', 'failed'], ['b', 'done']]);
    assert.equal(s.failed[0].error, 'MISSING_SHA|x');
  });

  test('its Stop cancels its scope only, and what was not reached is cancelled', async () => {
    const be = backend();
    const b = batch();
    await started(be, b);
    J.handleProgressEvent({ mod_id: 'a', op: 'enable', phase: 'done', bytes_done: 1, bytes_total: 1 });
    const stop = b.handle.cancel();
    await be.tick();
    assert.deepEqual(be.named('cancel_mod_ops').map(([, a]) => a), [{ scope: b.scope() }]);
    b.answer().res({ failed: [], cancelled: true });
    await stop;
    const s = await b.handle.done;
    assert.equal(s.wasCancelled, true);
    assert.deepEqual(s.items.map((i) => i.phase), ['done', 'cancelled']);
  });

  test('a global Cancel-all seen by the batch counts as a stop; a failed command is reported once', async () => {
    const be = backend();
    const b1 = batch();
    await started(be, b1);
    b1.answer().res({ cancelled: true });
    assert.equal((await b1.handle.done).wasCancelled, true);
    const b2 = batch();
    await started(be, b2);
    b2.answer().rej('orderList.errNotFound');
    const s = await b2.handle.done;
    assert.equal(s.error, 'orderList.errNotFound');
    assert.deepEqual(s.items.map((i) => i.phase), ['failed', 'failed']);
    assert.deepEqual(be.toasts.at(-1), ['failed orderList.errNotFound', 'error']);
  });

  test('a batch with nothing to turn on still shows as one line and ends done', async () => {
    const be = backend();
    const b = batch([]);
    await started(be, b);
    assert.equal(J.currentActivation().item.name, 'List');
    b.answer().res({ cancelled: false });
    const s = await b.handle.done;
    assert.equal(s.total, 1);
    assert.equal(s.items[0].phase, 'done');
  });
});

describe('progress drives the cards', () => {
  test('bytes from the backend events, a settle after done, any source', async () => {
    const be = backend();
    J.handleProgressEvent({ mod_id: 'x', mod_name: 'X', op: 'enable', phase: 'start', bytes_done: 0, bytes_total: 200 });
    assert.equal(J.modActivity('x').phase, 'running');
    assert.equal(J.isActivationBusy(), true, 'an Enable all on the backend counts as busy too');
    J.handleProgressEvent({ mod_id: 'x', mod_name: 'X', op: 'enable', phase: 'copy', bytes_done: 50, bytes_total: 200 });
    assert.equal(J.modActivity('x').pct, 0.25);
    assert.equal(J.externalActivity()[0].name, 'X');
    J.handleProgressEvent({ mod_id: 'x', mod_name: 'X', op: 'enable', phase: 'done', bytes_done: 200, bytes_total: 200 });
    assert.equal(J.modActivity('x').phase, 'done');
    assert.equal(J.isActivationBusy(), false);
    assert.equal(be.later.length, 1);
    assert.equal(be.later[0][1], J.SETTLE_MS);
    be.later[0][0]();
    assert.equal(J.modActivity('x'), null, 'the card settles back to its plain state');
  });

  test('a job item takes the bytes of its own mod', async () => {
    const be = backend();
    J.runActivationJob({ mods: [{ id: 'a', name: 'A' }], mode: 'enable', silent: true });
    await be.waitPending();
    J.handleProgressEvent({ mod_id: 'a', op: 'enable', phase: 'copy', bytes_done: 30, bytes_total: 60 });
    const cur = J.currentActivation();
    assert.equal(cur.item.bytesDone, 30);
    assert.equal(cur.item.bytesTotal, 60);
    await be.ok();
  });

  test('a batch announced by another screen shows queued until the backend reaches each mod', () => {
    backend();
    J.announceExternal(['p', 'q'], 'disable');
    assert.equal(J.modActivity('q').phase, 'queued');
    J.handleProgressEvent({ mod_id: 'p', op: 'disable', phase: 'start', bytes_done: 0, bytes_total: 0 });
    assert.equal(J.modActivity('p').phase, 'running');
    assert.equal(J.modActivity('p').pct, null, 'no size yet: indeterminate, not 0 %');
    J.clearAnnounced(['p', 'q']);
    assert.equal(J.modActivity('q'), null);
  });

  test('listeners hear about changes, coalesced by the scheduler', async () => {
    const be = backend();
    let n = 0;
    const off = J.onActivationChange(() => { n += 1; });
    J.runActivationJob({ mods: [{ id: 'a' }], mode: 'enable', silent: true });
    await be.ok();
    assert.ok(n > 0);
    off();
    const before = n;
    J.handleProgressEvent({ mod_id: 'a', op: 'enable', phase: 'done', bytes_done: 1, bytes_total: 1 });
    assert.equal(n, before);
  });
});

describe('the wiring', () => {
  test('the Library toggle goes through the queue and keeps its prompts', () => {
    const list = src('frontend/src/features/mods/mods-list.ts');
    assert.match(list, /runCardJob\(\[\{ id: mod\.id, name: mod\.name \}\], 'enable'\)/);
    assert.ok(!/await invoke\('enable_mod'/.test(list), 'no bare enable_mod left in the card handler');
    assert.ok(!/await invoke\('disable_mod'/.test(list), 'no bare disable_mod left in the card handler');
    assert.match(list, /applyCardActivity\(card, mod\.id\)/, 'a card drawn mid-activation is dressed at once');
  });
  test('the toolbar cancel reaches the queue', () => {
    const acts = src('frontend/src/features/mods/mods-actions.ts');
    assert.match(acts, /cancelAllActivationJobs\(\)/);
    assert.match(acts, /markCurrentSkipped\(\)/);
    assert.match(acts, /isActivationBusy\(\)/);
  });
  test('the backend emits the progress event the module listens to, and keeps saving per mod', () => {
    const rs = src('src-tauri/src/commands/mods.rs');
    assert.ok(rs.includes('pub const MOD_OP_PROGRESS_EVENT: &str = "bmm://mod-op-progress";'));
    assert.equal(J.MOD_OP_PROGRESS_EVENT, 'bmm://mod-op-progress');
    const enable = rs.slice(rs.indexOf('pub async fn enable_mod('), rs.indexOf('pub async fn disable_mod('));
    assert.ok(!enable.includes('invalidate_cache(&state)'), 'enabling no longer forces a full cache rebuild on the next one');
    assert.ok(enable.includes('for f in &applied { active_files_set.insert'), 'the chain reads what was written, not the flushable cache');
    assert.ok(/let _ = state\.save\(\);\s*\/\/ No `invalidate_cache`/.test(enable), 'the save still happens after every enable, error or not');
  });
});
