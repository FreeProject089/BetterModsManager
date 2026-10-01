// Feedback and crash reports go to the BetterCommunity feedback centre, and ONLY there.
//
// BetaHub was the first report service, then a fallback taken when links.json emptied
// `feedback_endpoint`. It was removed on 2026-09-25 (the owner had abandoned it, and its
// personal access token sat in a committed example file). Two things must now hold:
//
//   1. nothing in the app can reach BetaHub any more — no module, no import, no host;
//   2. the report path still works on its own: it POSTs to the feedback endpoint, queues a
//      report it could not send and delivers it later, and with no endpoint it sends nothing
//      at all instead of looking for a second transport.
//
// Part 2 loads the COMPILED bc-feedback.js for real. Its imports (the Tauri bridge, the toast,
// i18n, the links registry) need a webview, so a resolve hook swaps exactly those six modules
// for small stand-ins; bc-feedback.js itself and feedback-budget.js run unmodified.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const rel = (p) => p.slice(ROOT.length + 1).split('\\').join('/');

describe('BetaHub is gone from the app', () => {
  test('no BetaHub module is left, in the sources or the compiled output', () => {
    assert.ok(!existsSync(join(ROOT, 'frontend/src/features/betahub')), 'frontend/src/features/betahub still exists');
    assert.ok(!existsSync(join(ROOT, 'frontend/src/docs/diagrams/betahub-reporting.ts')), 'the BetaHub diagram is still there');
    const js = join(ROOT, 'frontend/js/features/betahub');
    assert.ok(!existsSync(js) || readdirSync(js).length === 0, 'compiled BetaHub modules are still in frontend/js');
  });

  test('no TypeScript source imports a BetaHub module, names its host or reads its config', () => {
    const bad = [];
    for (const f of walk(join(ROOT, 'frontend/src')).filter((p) => p.endsWith('.ts'))) {
      const s = readFileSync(f, 'utf8');
      // Comments may say what was removed; code may not reach it.
      const code = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      if (/from\s+['"][^'"]*betahub[^'"]*['"]|import\(\s*['"][^'"]*betahub/i.test(code)) bad.push(`${rel(f)}: imports a betahub module`);
      if (/app\.betahub\.io/i.test(code)) bad.push(`${rel(f)}: names app.betahub.io`);
      if (/BETAHUB_(TOKEN|PROJECT_ID|ORIGIN)|betahub-config/i.test(code)) bad.push(`${rel(f)}: reads BetaHub config`);
    }
    assert.deepEqual(bad, []);
  });

  test('the report entry points open the feedback centre dialog and nothing else', () => {
    for (const f of ['features/feedback/feedback-modal', 'features/settings/settings', 'ui/crash-report']) {
      const src = readFileSync(join(ROOT, `frontend/src/${f}.ts`), 'utf8');
      assert.doesNotMatch(src, /openBugReportModal|openFeedbackModal|initBetaHub/, `${f}.ts still calls the BetaHub forms`);
    }
    const settings = readFileSync(join(ROOT, 'frontend/src/features/settings/settings.ts'), 'utf8');
    assert.match(settings, /openFeedback\('bug'\)/);
    assert.match(settings, /openFeedback\('feedback'\)/);
    assert.match(readFileSync(join(ROOT, 'frontend/src/ui/crash-report.ts'), 'utf8'), /openFeedback\('crash'/);
  });

  test('the build no longer needs a BetaHub secret or config file', () => {
    for (const w of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
      assert.doesNotMatch(readFileSync(join(ROOT, w), 'utf8'), /betahub/i, `${w} still handles BetaHub config`);
    }
    assert.doesNotMatch(readFileSync(join(ROOT, 'frontend/assets/links.json'), 'utf8'), /betahub/i);
  });
});

// ── part 2: the one remaining transport, run for real ───────────────────────────────────────
const STUBS = {
  'core/api.js': `export async function invoke(cmd) {
      if (cmd === 'get_creator_id') return 'BC-TEST';
      if (cmd === 'get_app_version') return '9.9.9';
      if (cmd === 'get_build_date') return '2026-09-25';
      throw new Error('no ' + cmd);
    }`,
  'core/canvas-fingerprint.js': 'export async function creatorProofFor() { return null; }',
  'core/links-config.js': `export const getLinks = () => globalThis.__fbLinks;
    export const bcApi = () => (globalThis.__fbTestMode ? 'http://localhost:5176/api' : 'https://bc.test/api');
    export const bcTestMode = () => !!globalThis.__fbTestMode;`,
  'core/i18n.js': 'export const t = (k) => k;',
  'ui/app.js': 'export const toast = (...a) => { globalThis.__fbToasts.push(a); };',
  'ui/notification-center.js': 'export const recordNotification = () => {};',
};
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL && context.parentURL.includes('/features/feedback/')) {
      for (const [suffix, code] of Object.entries(STUBS)) {
        if (specifier.endsWith('/' + suffix)) {
          return { url: 'data:text/javascript,' + encodeURIComponent(code), shortCircuit: true };
        }
      }
    }
    return next(specifier, context);
  },
});

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
globalThis.__fbToasts = [];
let calls = [];
let answer = () => new Response(JSON.stringify({ id: 'r1', threadId: 't1', linked: true }), { status: 201 });
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, headers: init.headers || {} });
  return answer(String(url), init);
};

let fb;
before(async () => {
  fb = await import(pathToFileURL(join(ROOT, 'frontend/js/features/feedback/bc-feedback.js')).href);
});
const reset = (links) => { calls = []; store.clear(); globalThis.__fbToasts = []; globalThis.__fbLinks = links; };

describe('reports go to the feedback centre alone', () => {
  test('a bug report is POSTed to the default endpoint, bcApi()/feedback/bmm', async () => {
    reset({});
    answer = () => new Response(JSON.stringify({ id: 'r1', threadId: 't1', linked: true }), { status: 201 });
    const r = await fb.submitFeedback({ kind: 'bug', title: 'It broke', body: 'Steps: click the button.' });
    assert.equal(r.id, 'r1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://bc.test/api/feedback/bmm');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].body.kind, 'bug');
    assert.equal(calls[0].body.appVersion, '9.9.9');
    assert.equal(calls[0].headers['X-Creator-ID'], 'BC-TEST');
    assert.ok(calls.every((c) => !/betahub/i.test(c.url)), 'a request went to BetaHub');
  });

  test('test mode sends reports to the test server, not the production URL in links.json', async () => {
    // The link status is asked of the test server in test mode. Posting the report to the
    // production URL meant "linked" in the dialog and an unknown sender at the other end,
    // which answered "an e-mail is required" to a dialog with no e-mail field.
    reset({ feedback_endpoint: 'https://bettercommunity.ch/api/feedback/bmm' });
    globalThis.__fbTestMode = true;
    try {
      answer = () => new Response(JSON.stringify({ id: 'r3' }), { status: 201 });
      await fb.submitFeedback({ kind: 'feedback', body: 'an idea for the library' });
      assert.equal(calls[0].url, 'http://localhost:5176/api/feedback/bmm');
    } finally { globalThis.__fbTestMode = false; }
  });

  test('contact_required comes back as its own code, with the server detail', async () => {
    reset({});
    answer = () => new Response(JSON.stringify({ error: 'contact_required', unverified: true }), { status: 422 });
    await assert.rejects(fb.submitFeedback({ kind: 'feedback', body: 'an idea for the library' }),
      (e) => e.code === 'contact_required' && e.detail?.unverified === true);
  });

  test('a moved feedback_endpoint is followed', async () => {
    reset({ feedback_endpoint: 'https://reports.example.org/api/feedback/bmm/' });
    answer = () => new Response(JSON.stringify({ id: 'r2' }), { status: 201 });
    await fb.submitFeedback({ kind: 'crash', body: 'crash zip attached' });
    assert.equal(calls[0].url, 'https://reports.example.org/api/feedback/bmm');
  });

  test('offline: the report is queued, then delivered to the same centre on the next start', async () => {
    reset({});
    answer = () => { throw new TypeError('fetch failed'); };
    await assert.rejects(fb.submitFeedback({ kind: 'feedback', body: 'an idea worth keeping' }), (e) => e.code === 'offline');
    assert.equal(fb.queuedCount(), 1, 'the report was not queued');
    calls = [];
    answer = (url) => (url.endsWith('/config')
      ? new Response(JSON.stringify({ enabled: true }), { status: 200 })
      : new Response(JSON.stringify({ id: 'r3' }), { status: 201 }));
    assert.equal(await fb.flushFeedbackQueue(), 1);
    assert.equal(fb.queuedCount(), 0);
    const post = calls.find((c) => c.method === 'POST');
    assert.equal(post.url, 'https://bc.test/api/feedback/bmm');
    assert.equal(post.body.body, 'an idea worth keeping');
  });

  test('no endpoint: reports are OFF — nothing is sent anywhere, there is no second transport', async () => {
    reset({ feedback_endpoint: '' });
    assert.equal(fb.usesBetterCommunity(), false);
    await assert.rejects(fb.submitFeedback({ kind: 'bug', body: 'nobody will get this' }), (e) => e.code === 'disabled');
    assert.equal(calls.length, 0, 'a request left although reports are switched off');
  });
});

describe('"My recent reports" (moved out of the BetaHub modals)', () => {
  let m;
  before(async () => { m = await import(pathToFileURL(join(ROOT, 'frontend/js/features/feedback/report-history-model.js')).href); });

  test('a BetterCommunity entry links to the dashboard; a legacy BetaHub entry keeps its row, not a dead link', () => {
    const items = m.parseHistory(JSON.stringify([
      { id: 'a', type: 'bug', title: 'new', source: 'bc', date: '2026-09-25T10:00:00Z' },
      { id: '42', type: 'bug', title: 'old', source: 'betahub', date: '2026-01-01T10:00:00Z' },
    ]));
    assert.equal(m.historyLink(items[0], 'https://bettercommunity.ch/dashboard?s=reports'), 'https://bettercommunity.ch/dashboard?s=reports');
    assert.equal(m.historyLink(items[1], 'https://bettercommunity.ch/dashboard?s=reports'), '');
  });
  test('tabs, paging and delete', () => {
    const list = Array.from({ length: 7 }, (_, i) => ({ id: String(i), type: i % 2 ? 'feedback' : 'bug', title: 't', source: 'bc', date: '' }));
    const items = m.parseHistory(JSON.stringify(list));
    const bugs = m.historyPage(items, 'bug', false);
    assert.equal(bugs.shown.length, 4);
    assert.equal(bugs.hasOlder, false);
    const many = m.parseHistory(JSON.stringify(Array.from({ length: 8 }, (_, i) => ({ id: String(i), type: 'bug' }))));
    assert.deepEqual([m.historyPage(many, 'bug', false).shown.length, m.historyPage(many, 'bug', false).hasOlder], [5, true]);
    assert.equal(m.historyPage(many, 'bug', true).shown.length, 8);
    assert.equal(m.withoutItem(many, '3', 'bug').length, 7);
  });
  test('garbage in localStorage is an empty list, and titles are escaped before innerHTML', () => {
    assert.deepEqual(m.parseHistory('{nope'), []);
    assert.deepEqual(m.parseHistory('{"a":1}'), []);
    assert.equal(m.escHtml('<img src=x onerror=alert(1)>"'), '&lt;img src=x onerror=alert(1)&gt;&quot;');
  });
});
