// The Integrity dialog's pure part (frontend/src/features/settings/integrity-model.ts): the
// four states, the filter, the readable hash, and the exported report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const m = await import(pathToFileURL(join(ROOT, 'frontend/js/features/settings/integrity-model.js')).href);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const none = (k) => k;

const row = (o) => ({ id: 'x', name: 'Mod', version: '1', enabled: false, files: 3, hashed_at: null, invalid: null, content_id: null, ...o });

test('a mod is in exactly one of four states', () => {
  assert.equal(m.stateOf(row({ files: 0 })), 'missing');
  assert.equal(m.stateOf(row({ files: 0, invalid: true })), 'missing', 'no baseline wins over a stale flag');
  assert.equal(m.stateOf(row({ invalid: true })), 'mismatch');
  assert.equal(m.stateOf(row({ invalid: false })), 'verified');
  assert.equal(m.stateOf(row({ invalid: null })), 'unchecked');
  const c = m.countStates([row({ files: 0 }), row({ invalid: true }), row({ invalid: false }), row({ invalid: false })]);
  assert.deepEqual(c, { verified: 2, mismatch: 1, missing: 1, unchecked: 0 });
});

test('the filter keeps a state and a search, mismatches first', () => {
  const rows = [row({ id: 'a', name: 'Zeta', invalid: false }), row({ id: 'b', name: 'Alpha', invalid: true }), row({ id: 'c', name: 'Beta', files: 0, content_id: 'b3:cafe' })];
  assert.deepEqual(m.filterRows(rows, 'all', '').map((r) => r.id), ['b', 'c', 'a']);
  assert.deepEqual(m.filterRows(rows, 'verified', '').map((r) => r.id), ['a']);
  assert.deepEqual(m.filterRows(rows, 'all', 'CAFE').map((r) => r.id), ['c'], 'a content id is searchable');
});

test('a hash reads short, without its tag, and names its algorithm', () => {
  const b3 = 'b3:' + 'a'.repeat(64);
  assert.equal(m.hashAlgo(b3), 'BLAKE3');
  assert.equal(m.hashAlgo('f'.repeat(64)), 'SHA-256');
  assert.equal(m.shortHash(b3), 'aaaaaaaa…aaaaaa');
  assert.equal(m.shortHash('abc'), 'abc');
});

test('the CSV report cannot run a formula in a spreadsheet', () => {
  const csv = m.reportCsv([row({ name: '=HYPERLINK("x")', invalid: true })], new Map());
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  assert.match(csv.split('\r\n')[0], /^id,name,version,enabled,state,files/);
});

test('the JSON report carries the counts and what a check found', () => {
  const reports = new Map([['x', { modId: 'x', missing: ['a.txt'], modified: [], added: [], total: 3, isValid: false }]]);
  const j = JSON.parse(m.reportJson([row({ invalid: true })], reports, 'all', '2026-10-07T00:00:00Z'));
  assert.equal(j.kind, 'bmm-integrity-report');
  assert.equal(j.counts.mismatch, 1);
  assert.deepEqual(j.mods[0].checked.missing, ['a.txt']);
  assert.equal(m.reportLine(reports.get('x'), none), '1 missing');
});

test('every key the dialog reads exists in English and in French', () => {
  const en = JSON.parse(read('frontend/Lang/en.json'));
  const fr = JSON.parse(read('frontend/Lang/fr.json'));
  const src = read('frontend/src/features/settings/integrity-center.ts') + read('frontend/src/features/settings/integrity-model.ts');
  const keys = new Set([...src.matchAll(/'(sha\.[\w.]+)'/g)].map((x) => x[1]));
  assert.ok(keys.size > 60, `only ${keys.size} keys found`);
  for (const k of keys) {
    assert.ok(typeof en[k] === 'string' && en[k], `en.json lacks ${k}`);
    assert.ok(typeof fr[k] === 'string' && fr[k], `fr.json lacks ${k}`);
  }
});

test('the dialog asks Rust for the overview, which is registered', () => {
  assert.match(read('frontend/src/features/settings/integrity-center.ts'), /invoke\('get_hash_overview'/);
  assert.match(read('src-tauri/src/main.rs'), /commands::mods::get_hash_overview,/);
});
