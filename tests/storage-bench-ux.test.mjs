// The Storage Manager and Benchmark UX pass (Sept 30): fewer words on screen, readable queue rows,
// browsers never a game, a mini monitor that is a real always-on-top window, and a live monitor
// you can zoom, inspect and filter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const spark = await import(pathToFileURL(join(ROOT, 'frontend/js/features/settings/resources-spark.js')).href);
const { viewBounds } = await import(pathToFileURL(join(ROOT, 'frontend/js/features/bench/bench-view.js')).href);
const none = () => '';

test('the "never a game" list is the same in the detector (Rust) and the Game mode tab', () => {
  const rs = read('src-tauri/src/governor/game_mode.rs');
  const block = rs.match(/pub const NOT_GAMES: &\[&str\] = &\[([\s\S]*?)\];/);
  assert.ok(block, 'NOT_GAMES not found in game_mode.rs');
  const rust = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual([...spark.NOT_GAMES].sort(), rust);
  assert.ok(rust.includes('firefox.exe'), 'the browser the owner saw detected as a game');
  assert.equal(spark.isKnownNonGame('C:\\Program Files\\Mozilla Firefox\\FIREFOX.EXE'), true);
  assert.equal(spark.isKnownNonGame('D:/Games/Skyrim/SkyrimSE.exe'), false);
  // The detector uses it for profile folders and full-screen windows, the picker leaves them out.
  assert.match(rs, /\.filter\(\|_\| !is_known_non_game\(name\)\)/);
  assert.match(rs, /self\.fullscreen_window && !is_known_non_game\(e\)/);
  assert.match(read('frontend/src/features/settings/resources-dash.ts'), /seen\.has\(low\) \|\| isKnownNonGame\(exe\)/);
});

test('a queued operation reads as words and a name, never an internal id', () => {
  const id = 'content id 44105b94-6c1e-4f3a-9d2b-0a1b2c3d4e5f';
  assert.equal(spark.humanSubject(id, none), 'Identifying');
  assert.equal(spark.humanSubject('content id SkyUI', none), 'Identifying: SkyUI');
  assert.equal(spark.humanSubject('hash SkyUI', none), 'Checking files: SkyUI');
  assert.equal(spark.humanSubject('rehash SkyUI', none), 'Re-checking files: SkyUI');
  assert.equal(spark.humanSubject('scan D:\\Mods\\Skyrim\\', none), 'Scanning: Skyrim');
  assert.equal(spark.humanSubject('something else', none), 'something else');
  assert.equal(spark.humanSubject('hash X', (k) => (k === 'stm.subj.hash' ? 'Vérification des fichiers' : '')), 'Vérification des fichiers: X');
  // The backend names the mod, not its id, in the two background loops.
  const mods = read('src-tauri/src/commands/mods.rs');
  assert.match(mods, /format!\("content id \{\}", name\)/);
  assert.match(mods, /format!\("hash \{\}", mod_name\)/);
});

test('sizes are said in the user\'s language: "1,5 To sur 1,8 To"', () => {
  const fr = (k) => ({ 'stm.unit.tb': 'To', 'stm.unit.gb': 'Go', 'stm.space.usedOf': '{u} sur {t}' }[k] || '');
  const TB = 1024 ** 4;
  assert.equal(spark.sizeText(1.5 * TB, fr, 'fr').replace(/\s/g, ' '), '1,5 To');
  assert.equal(spark.usedOfText(1.5 * TB, 1.8 * TB, fr, 'fr').replace(/\s/g, ' '), '1,5 To sur 1,8 To');
  assert.equal(spark.sizeText(820 * 1024 ** 3, none, 'en'), '820 GB');
});

test('the live monitor shows a time window, a drag zoom, or the stretch around a replayed moment', () => {
  const data = Array.from({ length: 1000 }, (_, i) => ({ timestamp: 1000 + i }));
  assert.deepEqual(viewBounds(data, null, null, null), [0, 999], 'All');
  assert.deepEqual(viewBounds(data, 60, null, null), [939, 999], 'the last minute');
  assert.deepEqual(viewBounds(data, 60, { from: 1100, to: 1200 }, null), [100, 200], 'the zoom wins');
  const [a, b] = viewBounds(data, 60, null, 100);
  assert.ok(a <= 100 && b >= 100 && b - a <= 60, 'a replayed moment before the window stays on screen');
  assert.deepEqual(viewBounds([], 60, null, null), [0, -1]);
});

test('the mini monitor is its own always-on-top window, allowed to run', () => {
  const rs = read('src-tauri/src/commands/benchmark.rs');
  assert.match(rs, /pub async fn open_mini_monitor/, 'building a window in a sync command deadlocks on Windows');
  assert.match(rs, /\.always_on_top\(true\)/);
  assert.match(rs, /WebviewUrl::App\("mini-monitor\.html"/);
  const cap = JSON.parse(read('src-tauri/capabilities/mini-monitor.json'));
  assert.deepEqual(cap.windows, ['mini-monitor']);
  assert.ok(cap.permissions.includes('core:event:default'), 'it listens to the samples');
  const html = read('frontend/mini-monitor.html');
  const src = html.match(/<script type="module" src="([^"]+)"/)[1];
  assert.ok(existsSync(join(ROOT, 'frontend', src)), `${src} is not built`);
  const main = read('src-tauri/src/main.rs');
  assert.match(main, /commands::benchmark::open_mini_monitor/);
  assert.match(main, /if window\.label\(\) != "main" \{ return; \}/, 'closing the mini monitor must not quit BMM');
  const bench = read('frontend/src/features/bench/benchmark.ts');
  assert.match(bench, /invoke\('open_mini_monitor'/);
  assert.match(bench, /if \(!own\) toggleMiniMonitor\(true\)/, 'the in-app panel stays as the fallback');
});

test('every benchmark step the backend announces has a translated label', () => {
  const rs = read('src-tauri/src/commands/benchmark.rs');
  const steps = [...rs.matchAll(/emit\(\d+, "([^"]+)"\)\?/g)].map((m) => m[1]);
  assert.ok(steps.length >= 10);
  const bench = read('frontend/src/features/bench/benchmark.ts');
  const fr = JSON.parse(read('frontend/Lang/fr.json'));
  for (const s of steps) {
    const m = bench.match(new RegExp(`'${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}': '(bench\\.step\\.\\w+)'`));
    assert.ok(m, `no translation key for the step "${s}"`);
    assert.ok(fr[m[1]] && fr[m[1]] !== s, `${m[1]} has no French text`);
  }
});

test('the Storage Manager says its welcome once and keeps the details folded', () => {
  const modal = read('frontend/src/features/settings/storage-modal.ts');
  assert.match(modal, /if \(storeGet\(INTRO_KEY\) !== '1'\) \{ storeSet\(INTRO_KEY, '1'\); _introOpen = true; \}/, 'marked seen as soon as it is shown');
  assert.match(modal, /if \(_introOpen && id !== _tab\) dropIntro\(\)/, 'another tab drops it');
  for (const f of ['storage-modal.ts', 'resources-dash.ts', 'resources-matrix.ts']) {
    const src = read(`frontend/src/features/settings/${f}`);
    assert.doesNotMatch(src, /learnMore\('[\w-]+', \{ compact: true \}\)/, `${f}: a book icon on the tab's first line again`);
  }
});
