// The Storage Manager's "Learn more" links (agent-bmm-storage). The owner believed there were
// no docs for the resource governor: there were two long pages, and nothing in the modal led
// to them. Every tab now links to its section. A link that names a missing topic, page or
// anchor would be the same dead end again, in both languages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const DOCS = join(ROOT, 'BMM Docs', 'docs');

const surfaces = ['frontend/src/features/settings/storage-modal.ts', 'frontend/src/features/settings/resources-dash.ts', 'frontend/src/features/settings/resources-matrix.ts', 'frontend/src/features/settings/graphics-settings.ts'];
const used = new Set();
for (const f of surfaces) {
  if (!existsSync(join(ROOT, f))) continue;
  for (const m of read(f).matchAll(/learnMore(?:El)?\(\s*'([\w-]+)'/g)) used.add(m[1]);
}

/** The registry, read from its source: topic → { article, page, hash }. */
function registry() {
  const src = read('frontend/src/core/learn-more.ts');
  const out = new Map();
  for (const m of src.matchAll(/'([\w-]+)':\s*\{([^}]*)\}/g)) {
    const field = (k) => (new RegExp(`${k}:\\s*'([^']*)'`).exec(m[2]) || [])[1];
    out.set(m[1], { article: field('article'), page: field('page'), hash: field('hash') });
  }
  return out;
}

/** The ids a page offers: explicit `{#id}` on a heading (what the site and the app both honour). */
const ids = (md) => new Set([...md.matchAll(/\{#([\w-]+)\}/g)].map((m) => m[1]));

test('every tab of the Storage Manager links to its documentation', () => {
  for (const topic of ['storage-space', 'resources-presets', 'resources-game', 'resources-rules', 'resources-live', 'graphics']) {
    assert.ok(used.has(topic), `the Storage Manager has no "Learn more" for ${topic}`);
  }
});

test('each link names a known topic, a bundled page, and an anchor present in EN and FR', () => {
  const reg = registry();
  for (const topic of used) {
    const target = reg.get(topic);
    assert.ok(target, `learnMore('${topic}') is not in LEARN_MORE (core/learn-more.ts)`);
    assert.ok(target.page, `${topic}: no page — the Storage Manager's links go to the full write-up`);
    for (const suffix of ['.md', '.fr.md']) {
      const file = join(DOCS, target.page + suffix);
      assert.ok(existsSync(file), `${topic}: ${target.page}${suffix} does not exist`);
      if (target.hash) assert.ok(ids(readFileSync(file, 'utf8')).has(target.hash), `${topic}: #${target.hash} is not an explicit {#${target.hash}} id in ${target.page}${suffix}`);
    }
  }
});

test('the storage page explains its tabs and the settings page the graphics card, in both languages', () => {
  const en = readFileSync(join(DOCS, 'features/storage.md'), 'utf8');
  const fr = readFileSync(join(DOCS, 'features/storage.fr.md'), 'utf8');
  for (const w of ['Work intensity', 'App mode', 'Rules per disk', 'Live activity']) assert.match(en, new RegExp(w), `storage.md does not name the "${w}" tab`);
  for (const w of ['Intensité de travail', 'Mode application', 'Règles par disque', 'Activité en direct']) assert.match(fr, new RegExp(w), `storage.fr.md does not name the "${w}" tab`);
  // Graphics moved to Settings → Graphics & display: its section is in settings.md now.
  const sen = readFileSync(join(DOCS, 'features/settings.md'), 'utf8');
  const sfr = readFileSync(join(DOCS, 'features/settings.fr.md'), 'utf8');
  for (const md of [sen, sfr]) {
    assert.ok(ids(md).has('graphics'), 'settings page: no {#graphics} section');
    assert.match(md, /--force_high_performance_gpu/, 'the high-performance switch must be named');
    assert.match(md, /--force_low_power_gpu/, 'the power-saving switch must be named');
  }
});
