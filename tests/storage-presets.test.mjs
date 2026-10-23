// The Storage Manager's rule presets: the picker must offer exactly the presets Rust builds,
// every change of a plan must read as one line people understand, and every word must exist
// in English and in French. The plans themselves are tested in Rust
// (commands/storage_presets.rs: real drive names, kept speed caps, thresholds per drive size).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const core = await import(pathToFileURL(join(ROOT, 'frontend/js/features/settings/storage-presets-core.js')).href);
const { PRESETS, changeLines, ruleText, diskName, reasonText, driveKindName, presetName } = core;

const en = JSON.parse(read('frontend/Lang/en.json'));
const fr = JSON.parse(read('frontend/Lang/fr.json'));
const tEn = (k) => en[k] ?? k;
const tFr = (k) => fr[k] ?? k;
const none = (k) => k;

test('the picker offers exactly the presets Rust builds, in the same order', () => {
  const rs = read('src-tauri/src/commands/storage_presets.rs');
  const ids = /PRESET_IDS: \[&str; \d+\] = \[([^\]]+)\]/.exec(rs)[1].match(/"([a-z_]+)"/g).map((s) => s.slice(1, -1));
  assert.deepEqual(PRESETS.map((p) => p.id), ids);
});

test('every preset string and every key the presets read exists in English and in French', () => {
  const src = read('frontend/src/features/settings/storage-presets-core.ts') + read('frontend/src/features/settings/storage-presets.ts');
  const keys = new Set([...src.matchAll(/'(stm\.presets\.[\w.]+)'/g)].map((m) => m[1]));
  assert.ok(keys.size > 50, `only ${keys.size} keys found`);
  for (const k of keys) {
    assert.ok(typeof en[k] === 'string' && en[k], `en.json lacks ${k}`);
    assert.ok(typeof fr[k] === 'string' && fr[k], `fr.json lacks ${k}`);
  }
});

test('a plan reads as one line per change: intensity, alerts, then each rule', () => {
  const changes = {
    preset: ['balanced', 'max'],
    alert: [{ enabled: false, warning_pct: 40, critical_pct: 30 }, { enabled: true, warning_pct: 12, critical_pct: 5 }],
    rules: [
      { disk: 'd:\\', op: 'backup', before: null, after: { parallel: 1, io_priority: 'low' } },
      { disk: 'd:\\', op: 'hash', before: { parallel: 3 }, after: null },
      { disk: '*', op: '*', before: { buffer_kib: 2048 }, after: { buffer_kib: 512, rate_mb_s: 80 } },
    ],
  };
  const lines = changeLines(changes, tEn);
  assert.deepEqual(lines.map((l) => l.kind), ['change', 'change', 'add', 'remove', 'change']);
  assert.match(lines[0].text, /Balanced → Max/);
  assert.match(lines[1].text, /off → on, warning at 12 % free, critical at 5 %/);
  assert.match(lines[2].text, /^D:, Backup: 1 at once · low priority$/);
  assert.match(lines[3].text, /rule removed \(3 at once\)/);
  assert.match(lines[4].text, /^All disks, all work: 2048 KiB steps → 512 KiB steps · cap 80 MB\/s$/);
  // French, and no key left showing when a translation is missing: the English fallback.
  assert.match(changeLines(changes, tFr)[0].text, /^Intensité de travail : Équilibré → Max$/);
  for (const l of changeLines(changes, none)) assert.doesNotMatch(l.text, /stm\.presets\./);
});

test('small helpers name things the way people do', () => {
  assert.equal(diskName('c:\\', none), 'C:');
  assert.equal(diskName('\\\\nas\\mods\\', none), '\\\\nas\\mods\\');
  assert.equal(ruleText(null, tEn), 'nothing');
  assert.equal(ruleText({}, tEn), 'nothing');
  assert.equal(driveKindName('nvme', true, tEn), 'NVMe SSD · external');
  assert.equal(presetName('ssd_hdd', tFr), 'Petit SSD + grand HDD');
  assert.match(reasonText(['ssd_and_hdd'], tEn), /hard disk/);
  // An unknown code from a newer Rust shows as itself rather than disappearing.
  assert.equal(reasonText(['brand_new'], tEn), 'brand_new');
});
