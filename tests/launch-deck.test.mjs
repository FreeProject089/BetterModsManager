// The launch deck's decisions, against the COMPILED module (frontend/js/ui/launch-logic.js).
//
// What these defend: one dialog at start-up that opens only when something needs saying, in a
// stable order; a required question the reader cannot slip past; and BetterCommunity's
// announcements shown to the right people the right number of times — with nothing the server
// sends trusted as markup, as a link that is not https, or as a picture from anywhere.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const L = await import(pathToFileURL(join(ROOT, 'frontend/js/ui/launch-logic.js')).href);

const ctx = { firstRun: false, manual: false };
const step = (id, priority, when = true, extra = {}) => ({ id, priority, when: typeof when === 'function' ? when : () => when, ...extra });

describe('which steps open, in what order', () => {
  test('lower priority first; ties keep registration order', async () => {
    const got = await L.collectEligible([step('c', 30), step('a', 10), step('b1', 20), step('b2', 20)], ctx);
    assert.deepEqual(got.map((s) => s.id), ['a', 'b1', 'b2', 'c']);
  });

  test('nothing eligible → nothing to open', async () => {
    const got = await L.collectEligible([step('a', 10, false), step('b', 20, () => Promise.resolve(false))], ctx);
    assert.equal(got.length, 0);
  });

  test('a provider that throws, rejects or hangs is left out, and does not hold the others', async () => {
    const t0 = Date.now();
    const got = await L.collectEligible([
      step('throws', 1, () => { throw new Error('x'); }),
      step('rejects', 2, () => Promise.reject(new Error('y'))),
      step('hangs', 3, () => new Promise(() => {})),
      step('ok', 4, () => Promise.resolve(true)),
    ], ctx, { deckEnabled: true, timeoutMs: 60 });
    assert.deepEqual(got.map((s) => s.id), ['ok']);
    assert.ok(Date.now() - t0 < 1000, 'the slow provider is capped, not awaited');
  });

  test('only a literal true counts as yes', async () => {
    const got = await L.collectEligible([step('truthy', 1, () => 'yes'), step('one', 2, () => 1), step('yes', 3, true)], ctx);
    assert.deepEqual(got.map((s) => s.id), ['yes']);
  });

  test('deck switched off → only the required steps', async () => {
    const got = await L.collectEligible([step('notes', 70), step('terms', 20, true, { required: true })], ctx, { deckEnabled: false });
    assert.deepEqual(got.map((s) => s.id), ['terms']);
  });

  test('duplicate ids keep the first registration', async () => {
    const got = await L.collectEligible([step('x', 5, true, { tag: 1 }), step('x', 1, true, { tag: 2 })], ctx);
    assert.equal(got.length, 1);
    assert.equal(got[0].tag, 1);
  });

  test('the context reaches every provider', async () => {
    const seen = [];
    await L.collectEligible([step('a', 1, (c) => { seen.push(c.manual); return true; })], { firstRun: false, manual: true });
    assert.deepEqual(seen, [true]);
  });
});

describe('a required step cannot be skipped', () => {
  const steps = [{ id: 'lang', required: true }, { id: 'notes' }, { id: 'terms', required: true }, { id: 'kofi' }];

  test('the first unanswered required step is a wall', () => {
    assert.equal(L.firstPendingRequired(steps, new Set()), 0);
    assert.equal(L.maxReachable(steps, new Set()), 0, 'nothing past an unanswered question');
    assert.equal(L.maxReachable(steps, new Set(['lang'])), 2, 'up to the next one');
    assert.equal(L.maxReachable(steps, new Set(['lang', 'terms'])), 3, 'everything once answered');
  });

  test('closing lands on the unanswered question instead of closing', () => {
    assert.equal(L.closeTarget(steps, new Set(['lang'])), 2);
    assert.equal(L.closeTarget(steps, new Set(['lang', 'terms'])), -1, '-1 = the deck may close');
  });

  test('informational steps never hold the close', () => {
    assert.equal(L.closeTarget([{ id: 'notes' }, { id: 'kofi' }], new Set()), -1);
  });
});

describe('semver', () => {
  test('parses strict SemVer, with or without a leading v', () => {
    assert.deepEqual(L.parseSemver('1.2.3'), { major: 1, minor: 2, patch: 3, pre: [] });
    assert.deepEqual(L.parseSemver('v2.0.0-beta.1+build.5'), { major: 2, minor: 0, patch: 0, pre: ['beta', '1'] });
  });

  test('refuses what is not a version', () => {
    for (const v of ['1.2', '01.2.3', '1.2.3.4', '', 'latest', '1.2.x', null, 3, '1.2.3-', `${'9'.repeat(70)}.0.0`]) {
      assert.equal(L.parseSemver(v), null, String(v));
    }
  });

  test('precedence, pre-releases included', () => {
    const c = (a, b) => L.compareSemver(L.parseSemver(a), L.parseSemver(b));
    assert.equal(c('1.0.0', '1.0.0'), 0);
    assert.equal(c('1.0.0', '1.0.1'), -1);
    assert.equal(c('1.10.0', '1.9.9'), 1);
    assert.equal(c('1.0.0-alpha', '1.0.0'), -1);
    assert.equal(c('1.0.0-alpha', '1.0.0-alpha.1'), -1);
    assert.equal(c('1.0.0-alpha.1', '1.0.0-alpha.beta'), -1);
    assert.equal(c('1.0.0-beta.2', '1.0.0-beta.11'), -1);
    assert.equal(c('1.0.0-rc.1', '1.0.0'), -1);
  });
});

const HOSTS = ['bettercommunity.ch'];
const feed = (items) => ({ v: 1, generatedAt: '2026-09-29T00:00:00Z', items });
const item = (over = {}) => ({
  id: 'post-1', rev: 1, kind: 'blog', title: 'BMM 1.3 is out', summary: 'Read all about it.',
  url: 'https://bettercommunity.ch/blog/bmm-1-3', imageUrl: 'https://bettercommunity.ch/uploads/a.webp',
  publishedAt: '2026-09-20T10:00:00Z', display: { mode: 'once', times: 1, from: null, until: null, minVersion: null, maxVersion: null },
  priority: 0, ...over,
});
const one = (over) => L.sanitizeFeed(feed([item(over)]), { imageHosts: HOSTS });

describe('sanitization: nothing from the server is trusted', () => {
  test('a well-formed item survives intact', () => {
    const [a] = one();
    assert.equal(a.id, 'post-1');
    assert.equal(a.url, 'https://bettercommunity.ch/blog/bmm-1-3');
    assert.equal(a.imageUrl, 'https://bettercommunity.ch/uploads/a.webp');
    assert.equal(a.display.mode, 'once');
  });

  test('markup becomes text, control and bidi characters go, length is capped', () => {
    const [a] = one({ title: '<img src=x onerror=alert(1)>Hello\u202e dlrow', summary: `${'x'.repeat(1000)}` });
    assert.ok(!a.title.includes('<'), a.title);
    assert.ok(!/[\u202a-\u202e]/.test(a.title), 'no bidi override');
    assert.ok(a.summary.length <= L.MAX_SUMMARY, 'summary capped');
    const [b] = one({ title: 'y'.repeat(500) });
    assert.ok(b.title.length <= L.MAX_TITLE);
  });

  test('links are https only, without credentials', () => {
    for (const bad of ['javascript:alert(1)', 'http://bettercommunity.ch/x', 'data:text/html,hi', 'file:///C:/x', 'https://user:pw@bettercommunity.ch/', '//evil.example/x', 'not a url']) {
      assert.equal(one({ url: bad })[0].url, null, bad);
    }
  });

  test('a picture only from BetterCommunity (or a subdomain), https only', () => {
    assert.equal(one({ imageUrl: 'https://cdn.bettercommunity.ch/a.png' })[0].imageUrl, 'https://cdn.bettercommunity.ch/a.png');
    for (const bad of ['https://tracker.example/pixel.gif', 'https://bettercommunity.ch.evil.example/a.png', 'https://evilbettercommunity.ch/a.png', 'http://bettercommunity.ch/a.png', 'data:image/png;base64,AAAA']) {
      assert.equal(one({ imageUrl: bad })[0].imageUrl, null, bad);
    }
  });

  test('an unreadable targeting field drops the item rather than guessing', () => {
    assert.equal(one({ display: { mode: 'once', minVersion: '1.x' } }).length, 0, 'bad minVersion');
    assert.equal(one({ display: { mode: 'once', until: 'next tuesday' } }).length, 0, 'bad date');
    assert.equal(one({ id: '../../etc' }).length, 0, 'bad id');
    assert.equal(one({ title: '   ' }).length, 0, 'no title');
  });

  test('unknown modes fall back to once; times is clamped', () => {
    assert.equal(one({ display: { mode: 'forever' } })[0].display.mode, 'once');
    assert.equal(one({ display: { mode: 'times', times: 9999 } })[0].display.times, 100);
    assert.equal(one({ display: { mode: 'times', times: -3 } })[0].display.times, 1);
  });

  test('a feed that is not v1, not an object, or not a list yields nothing', () => {
    for (const bad of [null, 'x', 42, [], { v: 2, items: [item()] }, { v: 1, items: 'no' }, { v: 1 }]) {
      assert.deepEqual(L.sanitizeFeed(bad, { imageHosts: HOSTS }), []);
    }
  });

  test('duplicates and overflow are cut', () => {
    const many = Array.from({ length: 30 }, (_, i) => item({ id: `p${i % 12}` }));
    const got = L.sanitizeFeed(feed(many), { imageHosts: HOSTS });
    assert.ok(got.length <= L.MAX_ITEMS);
    assert.equal(new Set(got.map((a) => a.id)).size, got.length);
  });

  test('highest priority first', () => {
    const got = L.sanitizeFeed(feed([item({ id: 'low', priority: 0 }), item({ id: 'high', priority: 5 })]), { imageHosts: HOSTS });
    assert.deepEqual(got.map((a) => a.id), ['high', 'low']);
  });
});

describe('when an announcement shows, and how many times', () => {
  const NOW = Date.parse('2026-09-29T12:00:00Z');
  const V = '1.3.0';

  test('once: shown, then not again', () => {
    const [a] = one();
    let counts = {};
    assert.equal(L.isDue(a, NOW, V, counts), true);
    counts = L.recordShown(counts, a, NOW);
    assert.equal(L.isDue(a, NOW, V, counts), false);
  });

  test('times: exactly N displays', () => {
    const [a] = one({ display: { mode: 'times', times: 3 } });
    let counts = {};
    for (let i = 0; i < 3; i++) { assert.equal(L.isDue(a, NOW, V, counts), true, `display ${i + 1}`); counts = L.recordShown(counts, a, NOW); }
    assert.equal(L.isDue(a, NOW, V, counts), false);
  });

  test('always: every launch, until muted', () => {
    const [a] = one({ display: { mode: 'always' } });
    let counts = {};
    for (let i = 0; i < 5; i++) counts = L.recordShown(counts, a, NOW);
    assert.equal(L.isDue(a, NOW, V, counts), true);
    counts = L.recordMuted(counts, a, NOW);
    assert.equal(L.isDue(a, NOW, V, counts), false, '"don\'t show again" wins over always');
    counts = L.recordMuted(counts, a, NOW, false);
    assert.equal(L.isDue(a, NOW, V, counts), true, 'unticking brings it back');
  });

  test('a new rev resets the count and the mute', () => {
    const [r1] = one({ rev: 1 });
    let counts = L.recordMuted(L.recordShown({}, r1, NOW), r1, NOW);
    assert.equal(L.isDue(r1, NOW, V, counts), false);
    const [r2] = one({ rev: 2 });
    assert.equal(L.isDue(r2, NOW, V, counts), true, 'rev 2 is a new announcement');
    counts = L.recordShown(counts, r2, NOW);
    assert.deepEqual(L.shownCount(r2, counts), { n: 1, muted: false });
  });

  test('from / until window', () => {
    const [a] = one({ display: { mode: 'always', from: '2026-10-01T00:00:00Z', until: null } });
    assert.equal(L.isDue(a, NOW, V, {}), false, 'not yet');
    const [b] = one({ display: { mode: 'always', from: null, until: '2026-09-01T00:00:00Z' } });
    assert.equal(L.isDue(b, NOW, V, {}), false, 'expired');
    const [c] = one({ display: { mode: 'always', from: '2026-09-01T00:00:00Z', until: '2026-10-01T00:00:00Z' } });
    assert.equal(L.isDue(c, NOW, V, {}), true, 'inside');
  });

  test('min / max version', () => {
    const [a] = one({ display: { mode: 'always', minVersion: '1.3.0', maxVersion: '1.4.99' } });
    assert.equal(L.isDue(a, NOW, '1.2.9', {}), false, 'too old');
    assert.equal(L.isDue(a, NOW, '1.3.0', {}), true, 'lower bound inclusive');
    assert.equal(L.isDue(a, NOW, '1.4.99', {}), true, 'upper bound inclusive');
    assert.equal(L.isDue(a, NOW, '1.5.0', {}), false, 'too new');
    assert.equal(L.isDue(a, NOW, '1.3.0-beta.1', {}), false, 'a pre-release precedes its release');
    assert.equal(L.isDue(a, NOW, 'garbage', {}), false, 'an unknown app version never matches a targeted card');
    const [open] = one({ display: { mode: 'always' } });
    assert.equal(L.isDue(open, NOW, 'garbage', {}), true, 'an untargeted card does not care');
  });

  test('at most N per launch', () => {
    const items = L.sanitizeFeed(feed(Array.from({ length: 6 }, (_, i) => item({ id: `p${i}` }))), { imageHosts: HOSTS });
    assert.equal(L.dueAnnouncements(items, NOW, V, {}, 3).length, 3);
  });

  test('stored counters are read defensively', () => {
    assert.deepEqual(L.parseCounts('not json'), {});
    assert.deepEqual(L.parseCounts('[1,2]'), {});
    assert.deepEqual(L.parseCounts(JSON.stringify({ 'ok-1': { rev: 1, n: 2 }, '../bad': { rev: 1, n: 1 }, x: { rev: 'a', n: 1 } })), { 'ok-1': { rev: 1, n: 2 } });
  });
});

describe('the feed request: ETag cache and offline', () => {
  const URL_ = 'https://bettercommunity.ch/api/bmm/launch?version=1.3.0&lang=fr';
  const body = JSON.stringify(feed([item()]));
  const deps = (over = {}) => {
    const state = { cache: over.cache ?? null, writes: 0, requests: [] };
    return {
      state,
      d: {
        online: () => over.online ?? true,
        request: async (u, h) => { state.requests.push({ u, h }); if (over.fail) throw new Error('offline'); return over.reply; },
        readCache: () => state.cache,
        writeCache: (c) => { state.cache = c; state.writes++; },
        now: () => 1000,
      },
    };
  };

  test('offline: no request, no error, nothing', async () => {
    const { state, d } = deps({ online: false });
    assert.deepEqual(await L.loadFeed(URL_, d), { body: null, source: 'none' });
    assert.equal(state.requests.length, 0);
  });

  test('a transport failure is silent and keeps the cache', async () => {
    const cache = { url: URL_, etag: '"a"', body, at: 1 };
    const { state, d } = deps({ fail: true, cache });
    assert.deepEqual(await L.loadFeed(URL_, d), { body: null, source: 'none' });
    assert.equal(state.cache, cache);
  });

  test('200 stores the body and its ETag', async () => {
    const { state, d } = deps({ reply: { status: 200, body, etag: '"v1"' } });
    const r = await L.loadFeed(URL_, d);
    assert.equal(r.source, 'network');
    assert.equal(state.cache.etag, '"v1"');
    assert.equal(state.requests[0].h['If-None-Match'], undefined, 'no validator without a cache');
  });

  test('the cached ETag is sent back, and a 304 serves the cached body', async () => {
    const { state, d } = deps({ cache: { url: URL_, etag: '"v1"', body, at: 1 }, reply: { status: 304 } });
    const r = await L.loadFeed(URL_, d);
    assert.equal(state.requests[0].h['If-None-Match'], '"v1"');
    assert.deepEqual(r, { body, source: 'not-modified' });
  });

  test('a cache for another URL (other language or version) is not used as a validator', async () => {
    const { state, d } = deps({ cache: { url: URL_.replace('fr', 'en'), etag: '"v1"', body, at: 1 }, reply: { status: 304 } });
    const r = await L.loadFeed(URL_, d);
    assert.equal(state.requests[0].h['If-None-Match'], undefined);
    assert.equal(r.source, 'none', 'a 304 we did not ask for is not trusted');
  });

  test('a 200 that is not a feed (captive portal) does not replace the last good copy', async () => {
    const cache = { url: URL_, etag: '"v1"', body, at: 1 };
    const { state, d } = deps({ cache, reply: { status: 200, body: '<html>Login to Wi-Fi</html>' } });
    assert.equal((await L.loadFeed(URL_, d)).source, 'none');
    assert.equal(state.cache, cache);
  });

  test('a server error is silent', async () => {
    const { d } = deps({ reply: { status: 503, body: 'down' } });
    assert.equal((await L.loadFeed(URL_, d)).source, 'none');
  });
});
