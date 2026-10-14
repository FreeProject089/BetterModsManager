// BMM frontend micro-benchmarks. Run: `node bench.mjs` (writes results JSON).
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Suite } from './lib/runner.mjs';
import { makeMods, makeTags, makeDict, rng } from './lib/data.mjs';
import { getFilteredMods_shipped, getFilteredMods_optimized } from './targets/mods.mjs';
import { t_shipped, t_optimized } from './targets/i18n.mjs';
import { escHtml_shipped, escHtml_optimized } from './targets/esc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, 'results');

// ── Inputs ───────────────────────────────────────────────────────────────────
const tags = makeTags(40);
const dict = makeDict(600);
const dictKeys = Object.keys(dict);

// Build state objects mirroring the app's `S` for several library sizes.
function makeState(modCount, sort, search) {
  return {
    allMods: makeMods(modCount, tags),
    userTags: tags,
    currentFilter: 'all',
    currentTagFilter: 'all',
    currentSort: sort,
    searchQuery: search,
  };
}

const out = { generatedAt: new Date().toISOString(), node: process.version, platform: process.platform, suites: [] };
function record(s) { out.suites.push(s); }

// ── Suite 1: mod-list filter + sort, swept by library size ────────────────────
for (const size of [200, 1000, 5000]) {
  const suite = new Suite(`mod-list filter+sort (${size} mods, search miss, name_asc)`);
  // Fresh state per case so neither variant benefits from the other's caches.
  const sA = makeState(size, 'name_asc', 'zzqq'); // search that mostly misses → hits tag fallback
  const sB = makeState(size, 'name_asc', 'zzqq');
  suite.add('shipped (.find + localeCompare)', () => getFilteredMods_shipped(sA), { kind: 'shipped', size });
  suite.add('optimized (Map + Collator)', () => getFilteredMods_optimized(sB), { kind: 'optimized', size });
  record(suite.run());
}

// ── Suite 2: sorting strategy isolated (5000 mods, search-all) ────────────────
{
  const suite = new Suite('mod-list sort only (5000 mods, no search)');
  for (const sort of ['name_asc', 'status', 'activation_order']) {
    const s1 = makeState(5000, sort, '');
    const s2 = makeState(5000, sort, '');
    suite.add(`shipped/${sort}`, () => getFilteredMods_shipped(s1), { kind: 'shipped', sort });
    suite.add(`optimized/${sort}`, () => getFilteredMods_optimized(s2), { kind: 'optimized', sort });
  }
  record(suite.run());
}

// ── Suite 3: i18n t() interpolation ───────────────────────────────────────────
{
  const r = rng(5);
  // Pick keys that actually contain placeholders, with params to substitute.
  const withParams = dictKeys.filter(k => dict[k].includes('{'));
  const params = { p0: 'Alpha', p1: 'Bravo', p2: 'Charlie' };
  const pick = () => withParams[Math.floor(r() * withParams.length)];

  const suite = new Suite('i18n t() interpolation (keys with params)');
  suite.add('shipped (RegExp per param)', () => t_shipped(dict, pick(), params), { kind: 'shipped' });
  suite.add('optimized (single-pass)', () => t_optimized(dict, pick(), params), { kind: 'optimized' });
  record(suite.run());

  // Throughput-style: interpolate a whole screen's worth of strings (200 calls).
  const screen = Array.from({ length: 200 }, () => withParams[Math.floor(r() * withParams.length)]);
  const suite2 = new Suite('i18n t() — full screen render (200 strings)');
  suite2.add('shipped', () => screen.map(k => t_shipped(dict, k, params)), { kind: 'shipped' });
  suite2.add('optimized', () => screen.map(k => t_optimized(dict, k, params)), { kind: 'optimized' });
  record(suite2.run());
}

// ── Suite 4: escHtml() — shipped 5×replace vs optimized single-pass ───────────
{
  const r = rng(7);
  // Representative frontend text: mod names, descriptions, paths — mostly WITHOUT
  // characters that need escaping (the common case that hits the fast path).
  const plain = Array.from({ length: 300 }, (_, i) =>
    `Community Mod Pack ${i} — high-detail cockpit & liveries for the campaign build ${(r() * 1000) | 0}`);
  // Text that DOES contain escapable characters (user descriptions, quotes, tags).
  const special = Array.from({ length: 300 }, (_, i) =>
    `<b>Mod ${i}</b> "quoted" & <em>tagged</em> — path C:\\Mods\\a<${i}>b's & more`);
  const mixed = plain.map((p, i) => (i % 4 === 0 ? special[i] : p)); // ~25% need escaping

  const s1 = new Suite('escHtml — plain text (fast path, no escaping)');
  s1.add('shipped (5× .replace)', () => plain.map(escHtml_shipped), { kind: 'shipped' });
  s1.add('optimized (test + 1 pass)', () => plain.map(escHtml_optimized), { kind: 'optimized' });
  record(s1.run());

  const s2 = new Suite('escHtml — text with special chars');
  s2.add('shipped (5× .replace)', () => special.map(escHtml_shipped), { kind: 'shipped' });
  s2.add('optimized (test + 1 pass)', () => special.map(escHtml_optimized), { kind: 'optimized' });
  record(s2.run());

  const s3 = new Suite('escHtml — full screen render (300 strings, ~25% escaped)');
  s3.add('shipped', () => mixed.map(escHtml_shipped), { kind: 'shipped' });
  s3.add('optimized', () => mixed.map(escHtml_optimized), { kind: 'optimized' });
  record(s3.run());
}

// ── Suites 5–6 (1.0.2): the REAL compiled modules, no mirror ─────────────────
// frontend/js/core/*.js is what the app loads (tsc output of frontend/src/core). Both modules
// have no imports, so they load in Node as they are. Run `npm run compile` at the repo root
// first if frontend/src changed since the last build.
const FRONT = new URL('../../frontend/js/core/', import.meta.url);
{
  // Activity centre (1.0.2): every long task registers, updates and ends through this registry,
  // which notifies the title-bar button and persists the last 30 finished entries.
  const act = await import(new URL('activity.js', FRONT).href);
  const store = new Map();
  act.configureActivity({ storage: () => ({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }) });
  let notified = 0;
  act.subscribeActivity(() => { notified++; });
  const s = new Suite('activity registry (1.0.2): one task, start → 10 updates → done');
  s.add('start + 10 updates + done (1 listener)', () => {
    const h = act.startActivity({ kind: 'hash', title: 'Integrity check', cancel: () => {} });
    for (let i = 1; i <= 10; i++) h.update({ progress: i / 10, detail: `file ${i}` });
    h.done('ok');
    return notified;
  }, { kind: 'real' });
  const running = Array.from({ length: 20 }, (_, i) => act.startActivity({ kind: 'sync', title: `job ${i}`, progress: i / 20 }));
  s.add('overallProgress over 20 running tasks', () => act.overallProgress(), { kind: 'real' });
  record(s.run());
  for (const h of running) h.done();
}
{
  // Universal catalogue format (1.0.2), the frontend twin of catalog_format.rs: what a
  // catalogue fetched by the page goes through before the list renders.
  const cf = await import(new URL('catalog-format.js', FRONT).href);
  const r = rng(11);
  const hex = () => Array.from({ length: 64 }, () => '0123456789ABCDEF'[Math.floor(r() * 16)]).join('');
  const v1 = (n) => ({ name: 'Benchmark apps', version: '1.0', apps: Array.from({ length: n }, (_, i) => ({
    id: `app-${i}`, title: `Demo App ${i}`, description: 'Batch-converts and compresses texture folders.', category: 'utility', price: 'free',
    tags: ['textures', 'performance'], version: '2.3.0', images: { thumb: `https://example.org/img/${i}.png` },
    download: { url: `https://example.org/downloads/app-${i}.zip`, file_type: 'zip', size: 12400000 + i, sha256: `sha256:${hex()}` } })) });
  const s = new Suite('catalogue normaliser JS (1.0.2): v1 apps catalogue → universal');
  for (const n of [100, 1000]) {
    const doc = v1(n);
    const res = cf.normalizeCatalog(doc, { kind: 'app' });
    if ((res.catalog.items || []).length !== n) throw new Error(`catalog-format: expected ${n} items, got ${(res.catalog.items || []).length}`);
    s.add(`normalizeCatalog v1 apps (${n} items)`, () => cf.normalizeCatalog(doc, { kind: 'app' }), { kind: 'real', size: n });
  }
  record(s.run());
}

// ── Correctness guard: optimized must equal shipped on representative inputs ──
(function verify() {
  const s1 = makeState(500, 'name_asc', 'air');
  const s2 = makeState(500, 'name_asc', 'air');
  const a = getFilteredMods_shipped(s1).map(m => m.id).join(',');
  const b = getFilteredMods_optimized(s2).map(m => m.id).join(',');
  if (a !== b) throw new Error('mods optimized variant diverged from shipped!');
  const wp = Object.keys(dict).find(k => dict[k].includes('{p0}'));
  if (t_shipped(dict, wp, { p0: 'X', p1: 'Y', p2: 'Z' }) !== t_optimized(dict, wp, { p0: 'X', p1: 'Y', p2: 'Z' })) {
    throw new Error('i18n optimized variant diverged from shipped!');
  }
  // escHtml: every optimized output must byte-match shipped, incl. edge cases.
  for (const s of ['plain text', '<b>a</b> & "x" \'y\'', '&amp; already', '', 'C:\\Mods\\a<1>b', null, undefined]) {
    if (escHtml_shipped(s) !== escHtml_optimized(s)) {
      throw new Error(`escHtml optimized variant diverged from shipped on: ${JSON.stringify(s)}`);
    }
  }
  process.stdout.write('\n✓ correctness guards passed (optimized == shipped)\n');
})();

mkdirSync(RESULTS_DIR, { recursive: true });
const file = join(RESULTS_DIR, 'js-results.json');
writeFileSync(file, JSON.stringify(out, null, 2));
process.stdout.write(`\nWrote ${file}\n`);
