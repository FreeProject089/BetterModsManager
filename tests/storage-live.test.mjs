// The Storage Manager's live feed (agent-bmm-storage): it must stop when the modal closes,
// when the window hides, when two renders race, and it must not paint a burst of ticks one by
// one. Before this, a double render left the sampler running for the rest of the session and
// every tick rebuilt the queue's DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const mod = await import(pathToFileURL(join(ROOT, 'frontend/js/features/settings/storage-live.js')).href);
const { LiveFeed, createCoalescer, bindLifecycle, liveWanted, reconcileKeyed, TICK_EVENT } = mod;

/** A bridge that counts, like the sampler's subscriber count in telemetry.rs. */
function fakeBridge() {
  const b = { subs: 0, subscribeCalls: 0, unsubscribeCalls: 0, listeners: new Set(), unlistened: 0 };
  b.invoke = async (cmd) => {
    await new Promise((r) => setTimeout(r, 2));             // a real round trip is async
    if (cmd === 'resources_subscribe') { b.subscribeCalls++; b.subs++; }
    if (cmd === 'resources_unsubscribe') { b.unsubscribeCalls++; b.subs = Math.max(0, b.subs - 1); }
    return b.subs;
  };
  b.listen = async (ev, cb) => {
    assert.equal(ev, TICK_EVENT);
    await new Promise((r) => setTimeout(r, 2));
    b.listeners.add(cb);
    return () => { b.unlistened++; b.listeners.delete(cb); };
  };
  b.emit = (payload) => { for (const cb of b.listeners) cb({ payload }); };
  return b;
}

/** A manual clock: frames and timers run only when the test says so. */
function fakeScheduler() {
  const s = { t: 0, frames: [], timers: [] };
  s.frame = (cb) => { s.frames.push(cb); };
  s.later = (cb, ms) => { s.timers.push({ at: s.t + ms, cb }); };
  s.now = () => s.t;
  s.runFrames = () => { const f = s.frames.splice(0); f.forEach((cb) => cb()); };
  s.advance = (ms) => {
    s.t += ms;
    const due = s.timers.filter((x) => x.at <= s.t);
    s.timers = s.timers.filter((x) => x.at > s.t);
    due.forEach((x) => x.cb());
    s.runFrames();
  };
  return s;
}

test('two renders racing subscribe once, and closing unsubscribes once: the sampler stops', async () => {
  const b = fakeBridge();
  const feed = new LiveFeed(b, () => {}, fakeScheduler());
  await Promise.all([feed.set(true), feed.set(true)]);
  assert.equal(b.subscribeCalls, 1, 'a second render must not add a second subscription');
  assert.equal(b.listeners.size, 1);
  await feed.set(false);
  assert.equal(b.subs, 0, 'the sampler must have no subscriber left');
  assert.equal(b.listeners.size, 0, 'the tick listener must be gone');
  await feed.set(false);
  assert.equal(b.unsubscribeCalls, 1, 'a second close must not unsubscribe someone else');
});

test('on, off, on in a row ends subscribed exactly once', async () => {
  const b = fakeBridge();
  const feed = new LiveFeed(b, () => {}, fakeScheduler());
  feed.set(true); feed.set(false); await feed.set(true);
  assert.equal(b.subs, 1);
  assert.equal(feed.live, true);
  await feed.set(false);
  assert.equal(b.subs, 0);
});

test('closing the modal unsubscribes at once, without waiting for a tick', async () => {
  const b = fakeBridge();
  const feed = new LiveFeed(b, () => {}, fakeScheduler());
  const classes = new Set(['open']);
  const overlay = { classList: { contains: (c) => classes.has(c) } };
  let moCb = null;
  class MO { constructor(cb) { moCb = cb; } observe() {} disconnect() { moCb = null; } }
  const docListeners = new Map();
  const doc = { visibilityState: 'visible', addEventListener: (t, f) => docListeners.set(t, f), removeEventListener: (t) => docListeners.delete(t) };
  let tab = 'live';
  const life = bindLifecycle({ overlay, doc, MutationObserver: MO }, feed, () => tab);
  await life.refresh();
  assert.equal(b.subs, 1, 'open + live tab + visible window: subscribed');

  // A tab with nothing live on it: off.
  tab = 'space'; await life.refresh();
  assert.equal(b.subs, 0, 'the disks tab needs no feed');
  tab = 'live'; await life.refresh();
  assert.equal(b.subs, 1);

  // The window hides in the tray: off; it comes back: on.
  doc.visibilityState = 'hidden'; docListeners.get('visibilitychange')();
  await feed.set(liveWanted({ open: true, visible: false, tab }));   // wait for the queued change
  assert.equal(b.subs, 0, 'a hidden window must not keep the sampler running');
  doc.visibilityState = 'visible'; docListeners.get('visibilitychange')();
  await life.refresh();
  assert.equal(b.subs, 1);

  // The close button removes `open`: the observer fires, nobody emits a tick.
  classes.delete('open');
  moCb();
  await feed.set(false);
  assert.equal(b.subs, 0, 'closing must unsubscribe immediately');
  assert.equal(b.listeners.size, 0);
  assert.equal(docListeners.size, 0, 'the visibility listener is removed with it');
  assert.equal(moCb, null, 'the observer is disconnected');
});

test('a burst of ticks is painted once, with the latest sample, then at most once per interval', () => {
  const s = fakeScheduler();
  const painted = [];
  const co = createCoalescer((v) => painted.push(v), 900, s);
  for (let i = 1; i <= 20; i++) co.push(i);                  // 20 ticks in one frame
  s.runFrames();
  assert.deepEqual(painted, [20], 'one paint, the latest value');
  co.push(21); co.push(22);
  s.runFrames();
  assert.deepEqual(painted, [20], 'no second paint inside the interval');
  s.advance(900);
  assert.deepEqual(painted, [20, 22], 'the latest value once the interval has passed');
  s.advance(5000);
  assert.deepEqual(painted, [20, 22], 'nothing new, nothing painted');
  co.push(23); co.cancel(); s.advance(1000);
  assert.deepEqual(painted, [20, 22], 'a cancelled coalescer paints nothing (the modal closed)');
});

test('the feed paints through the coalescer: 50 ticks, a handful of paints', async () => {
  const b = fakeBridge();
  const s = fakeScheduler();
  let paints = 0;
  const feed = new LiveFeed(b, () => { paints++; }, s, 900);
  await feed.set(true);
  for (let i = 0; i < 50; i++) { b.emit({ i }); if (i % 10 === 9) s.advance(100); }
  s.advance(1000);
  assert.ok(paints >= 1 && paints <= 3, `50 ticks in ~0.5 s must paint 1 to 3 times, painted ${paints}`);
  await feed.set(false);
});

test('liveWanted: every condition is required', () => {
  assert.equal(liveWanted({ open: true, visible: true, tab: 'live' }), true);
  assert.equal(liveWanted({ open: true, visible: true, tab: 'intensity' }), true);
  assert.equal(liveWanted({ open: false, visible: true, tab: 'live' }), false);
  assert.equal(liveWanted({ open: true, visible: false, tab: 'live' }), false);
  assert.equal(liveWanted({ open: true, visible: true, tab: 'graphics' }), false);
});

test('the queue is updated by key: a tick where only numbers move creates and removes nothing', () => {
  // A minimal parent: children in an array, like the DOM.
  const mk = () => ({ dataset: {}, text: '' });
  const parent = {
    kids: [],
    get children() { return this.kids; },
    insertBefore(n, ref) { const i = this.kids.indexOf(n); if (i >= 0) this.kids.splice(i, 1); const j = ref ? this.kids.indexOf(ref) : -1; if (j < 0) this.kids.push(n); else this.kids.splice(j, 0, n); },
    removeChild(n) { this.kids.splice(this.kids.indexOf(n), 1); },
  };
  const upd = (el, it) => { el.text = it.state; };
  const t1 = [{ id: 1, state: 'running' }, { id: 2, state: 'paused' }];
  assert.equal(reconcileKeyed(parent, t1, (x) => String(x.id), mk, upd), 2);
  const first = parent.kids[0];
  assert.equal(reconcileKeyed(parent, [{ id: 1, state: 'paused' }, { id: 2, state: 'paused' }], (x) => String(x.id), mk, upd), 0);
  assert.equal(parent.kids[0], first, 'the same row element is reused');
  assert.equal(first.text, 'paused');
  assert.equal(reconcileKeyed(parent, [{ id: 2, state: 'paused' }], (x) => String(x.id), mk, upd), 1);
  assert.deepEqual(parent.kids.map((k) => k.dataset.key), ['2']);
});

test('the Storage Manager wires the lifecycle and draws the queue by key', () => {
  const shell = readFileSync(join(ROOT, 'frontend/src/features/settings/storage-modal.ts'), 'utf8');
  assert.match(shell, /bindLifecycle\(/, 'the modal must bind the feed to its open/visible/tab state');
  assert.match(shell, /\.refresh\(\)/, 'switching tabs must re-evaluate the feed');
  const dash = readFileSync(join(ROOT, 'frontend/src/features/settings/resources-dash.ts'), 'utf8');
  assert.match(dash, /reconcileKeyed\(/, 'the queue must be updated by key, not rebuilt every tick');
  assert.doesNotMatch(dash, /q\.innerHTML = tickets\.map/, 'the old per-tick rebuild must be gone');
});

// bmm://resources/open and the low-space warning's shortcut called bmmOpenStorageManager, which
// clicked #btn-storage-manager: an id that exists nowhere (the button is #btn-open-storage), so
// both switched to Settings and opened nothing.
test('"Open the storage manager" opens it, through the modal\'s own opener', () => {
  const html = readFileSync(join(ROOT, 'frontend/index.html'), 'utf8');
  const prof = readFileSync(join(ROOT, 'frontend/src/features/profiles/profiles.ts'), 'utf8');
  for (const m of prof.matchAll(/getElementById\('(btn-[\w-]*storage[\w-]*)'\)/g)) {
    assert.ok(html.includes(`id="${m[1]}"`), `profiles.ts clicks #${m[1]}, which index.html does not have`);
  }
  assert.match(prof, /openStorageManager\?\.\(/, 'bmmOpenStorageManager must call the modal\'s opener');
  const shell = readFileSync(join(ROOT, 'frontend/src/features/settings/storage-modal.ts'), 'utf8');
  assert.match(shell, /\(window as any\)\.openStorageManager = /, 'the Storage Manager must publish its opener');
});
