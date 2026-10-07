// Saved activation-order lists: the draft model the dialog edits, and the wiring (commands
// registered, every match quality and state worded in every language).
//
// The resolver itself (strongest identity first, match quality, ambiguity, untrusted foreign
// ids) and the plan are the backend's, tested in Rust (src-tauri/src/commands/
// order_lists_tests.rs). This checks the frontend edits the draft right and reads them right.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/features/profiles/order-lists-model.js')).href);

const LIB = [
  { id: 'a', name: 'Alpha', version: '1.0', content_id: 'cid-a', enabled: true },
  { id: 'b', name: 'Beta Mod', version: '2.0', repo_mod_id: 'beta', source_repo: 'https://r.example/repo.json', enabled: false },
  { id: 'c', name: 'gamma', version: '', enabled: false },
];

describe('the draft', () => {
  test('an entry names its mod by everything it has', () => {
    assert.deepEqual(M.entryOf(LIB[1]), { name: 'Beta Mod', version: '2.0', id: 'b', repo_mod_id: 'beta', source_repo: 'https://r.example/repo.json' });
    assert.deepEqual(M.entryOf({ id: 'x', name: '' }), { name: 'x', version: '', id: 'x' }, 'a nameless mod shows its id');
  });

  test('adding keeps the order given and never lists a mod twice', () => {
    const one = M.addMods([], [LIB[2], LIB[0]]);
    assert.deepEqual(one.map((e) => e.id), ['c', 'a']);
    const two = M.addMods(one, [LIB[0], LIB[1], LIB[1]]);
    assert.deepEqual(two.map((e) => e.id), ['c', 'a', 'b']);
    // An entry with no local id (imported, not installed) is never deduplicated away.
    const ghost = [{ name: 'Not here' }, { name: 'Not here' }];
    assert.equal(M.addMods(ghost, [LIB[0]]).length, 3);
  });

  test('move and remove never add or drop anything else', () => {
    const e = ['x', 'y', 'z'];
    assert.deepEqual(M.moveEntry(e, 0, 2), ['y', 'z', 'x']);
    assert.deepEqual(M.moveEntry(e, 2, -5), ['z', 'x', 'y'], 'clamped');
    assert.deepEqual(M.moveEntry(e, 9, 0), e, 'out of range: unchanged');
    assert.deepEqual(M.removeEntry(e, 1), ['x', 'z']);
    assert.deepEqual(e, ['x', 'y', 'z'], 'the input is not mutated');
  });

  test('the picker offers inactive mods too, not the listed ones, by spacing-insensitive name', () => {
    const entries = M.addMods([], [LIB[0]]);
    assert.deepEqual(M.pickable(LIB, entries, '').map((m) => m.id), ['b', 'c'], 'sorted by name, Alpha already listed');
    assert.deepEqual(M.pickable(LIB, entries, 'beta_mod').map((m) => m.id), ['b']);
    assert.deepEqual(M.pickable(LIB, entries, 'GAM').map((m) => m.id), ['c']);
    assert.equal(M.pickable(LIB, [], '', 1).length, 1, 'capped');
  });

  test('the add panel search keeps listed mods, marked, and caps the results', () => {
    const entries = M.addMods([], [LIB[0]]);
    const rows = M.searchLibrary(LIB, entries, '');
    assert.deepEqual(rows.map((r) => [r.mod.id, r.listed]), [['a', true], ['b', false], ['c', false]]);
    assert.deepEqual(M.searchLibrary(LIB, entries, 'beta_mod').map((r) => r.mod.id), ['b']);
    assert.equal(M.searchLibrary(LIB, [], '', 2).length, 2, 'capped');
    assert.deepEqual(M.searchLibrary(LIB, [], 'nothing'), []);
  });

  test('a drop lands where the line was drawn', () => {
    const e = ['a', 'b', 'c', 'd'];
    const drop = (from, onto, after) => M.moveEntry(e, from, M.dropIndex(from, onto, after));
    assert.deepEqual(drop(0, 2, false), ['b', 'a', 'c', 'd'], 'before c');
    assert.deepEqual(drop(0, 2, true), ['b', 'c', 'a', 'd'], 'after c');
    assert.deepEqual(drop(3, 0, false), ['d', 'a', 'b', 'c'], 'to the top');
    assert.deepEqual(drop(1, 3, true), ['a', 'c', 'd', 'b'], 'to the bottom');
    assert.deepEqual(drop(2, 2, true), e, 'onto itself: unchanged');
  });

  test('source host, safe colour and state counts', () => {
    assert.equal(M.sourceHost(LIB[1]), 'r.example');
    assert.equal(M.sourceHost(LIB[0]), null);
    assert.equal(M.safeColor('#3b82f6'), '#3b82f6');
    for (const bad of ['red', '#12', 'url(x)', '#fff;background:red', null, 5]) assert.equal(M.safeColor(bad), null, String(bad));
    assert.deepEqual(M.stateCounts([{ state: 'active' }, { state: 'missing' }, { state: 'inactive' }, { state: 'active' }]), { active: 2, inactive: 1, missing: 1 });
    assert.deepEqual(M.stateCounts(undefined), { active: 0, inactive: 0, missing: 0 });
  });

  test('names compare as the Rust resolver compares them', () => {
    assert.equal(M.normName(' Gamma_Mod '), M.normName('gamma-mod'));
    assert.equal(M.normName('Gamma  Mod'), 'gammamod');
  });

  test('a draft is dirty when anything that is saved differs', () => {
    const base = { id: '1', name: 'L', description: '', profile_ids: ['p1', 'p2'], entries: M.addMods([], LIB) };
    assert.ok(M.sameList(base, { ...base, profile_ids: ['p2', 'p1'] }), 'profile order is not a change');
    assert.ok(M.sameList(base, { ...base, name: ' L ' }), 'surrounding spaces are not a change');
    assert.ok(!M.sameList(base, { ...base, entries: M.moveEntry(base.entries, 0, 2) }), 'the order is');
    assert.ok(!M.sameList(null, base));
    assert.ok(M.sameList(null, null));
  });
});

describe('reading a plan', () => {
  const PLAN = {
    profile_id: 'p', placed: 1, order_after: [], order_changed: false, handovers: 0,
    rows: [
      { index: 1, name: 'Alpha', quality: 'id', state: 'active', position: 2, version_differs: false },
      { index: 2, name: 'Beta', quality: 'name', state: 'inactive', position: 0, version_differs: false },
      { index: 3, name: 'Delta', quality: 'ambiguous', state: 'missing', position: 0, version_differs: false },
      { index: 4, name: 'Ghost', quality: 'missing', state: 'missing', position: 0, version_differs: false },
    ],
    to_activate: [{ id: 'b', name: 'Beta' }], already_active: 1, missing: 1, ambiguous: 1,
    to_deactivate: [{ id: 'x', name: 'Extra' }, { id: 'y', name: 'Other' }],
  };

  test('activation counts: missing includes ambiguous; turning off only when exclusive', () => {
    assert.deepEqual(M.activationCounts(PLAN, false), { enable: 1, already: 1, missing: 2, disable: 0, total: 4 });
    assert.equal(M.activationCounts(PLAN, true).disable, 2);
    assert.deepEqual(M.activationCounts(null, true), { enable: 0, already: 0, missing: 0, disable: 0, total: 0 });
  });

  test('quality counts cover every kind', () => {
    const q = M.qualityCounts(PLAN.rows);
    assert.deepEqual(Object.keys(q), [...M.MATCH_KINDS]);
    assert.equal(q.id + q.name + q.ambiguous + q.missing, 4);
    assert.deepEqual(M.qualityCounts(undefined), Object.fromEntries(M.MATCH_KINDS.map((k) => [k, 0])));
  });

  test('a match by name, or with another version, is the one to glance at', () => {
    assert.ok(M.isWeakMatch('name'));
    assert.ok(M.isWeakMatch('name_version', true));
    assert.ok(!M.isWeakMatch('content'));
    assert.ok(!M.isWeakMatch('name_version', false));
  });
});

describe('wiring', () => {
  const main = read('src-tauri/src/main.rs');
  const rs = read('src-tauri/src/commands/order_lists.rs');
  const share = read('src-tauri/src/commands/order_share.rs');
  const ts = read('frontend/src/features/profiles/order-lists.ts');

  test('every order_lists command is registered', () => {
    const cmds = [...rs.matchAll(/#\[tauri::command\]\s*pub (?:async )?fn (\w+)/g)].map((m) => m[1]);
    assert.ok(cmds.length >= 8, `found ${cmds}`);
    for (const c of cmds) assert.ok(main.includes(`commands::order_lists::${c},`), `${c} not in main.rs`);
  });

  test('the dialog invokes only commands that exist', () => {
    const invoked = [...ts.matchAll(/invoke\('(\w+)'/g)].map((m) => m[1]);
    assert.ok(invoked.length > 5);
    for (const c of invoked) assert.ok(main.includes(`::${c},`), `${c} is not a registered command`);
  });

  test('the frontend knows the same match kinds as the backend', () => {
    const body = share.slice(share.indexOf('pub enum MatchKind'), share.indexOf('}', share.indexOf('pub enum MatchKind')));
    const rust = [...body.matchAll(/^\s+([A-Z]\w+),/gm)].map((m) => m[1].replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase());
    assert.deepEqual(rust, [...M.MATCH_KINDS]);
  });

  test('every key the dialog and the backend use is translated in every language', () => {
    const keys = new Set([
      ...[...rs.matchAll(/"(orderList\.\w+)"/g)].map((m) => m[1]),
      ...[...ts.matchAll(/t\('(orderList\.[\w.]+)'/g)].map((m) => m[1]),
      ...M.MATCH_KINDS.flatMap((k) => [`orderList.q.${k}`, `orderList.q.${k}Tip`]),
    ]);
    assert.ok(keys.size > 40, `only ${keys.size} keys found`);
    for (const lang of ['en', 'fr', 'template']) {
      const d = JSON.parse(read(`frontend/Lang/${lang}.json`));
      for (const k of keys) assert.ok(typeof d[k] === 'string' && d[k].length > 0, `${lang}.json is missing ${k}`);
    }
  });

  test('activation goes through enable_mod and the shared commit, never its own copy', () => {
    const body = rs.slice(rs.indexOf('pub async fn order_list_activate'));
    assert.match(body, /mods::enable_mod\(/);
    assert.match(body, /mods::disable_mods_for_profiles\(/);
    assert.match(body, /mod_order::commit\(/);
    assert.match(body, /is_mod_op_cancelled\(\)/, 'Cancel stops between mods');
    assert.doesNotMatch(rs, /std::fs::|fs::copy|fs::write/, 'no file IO of its own');
  });

  test('the order view opens the lists', () => {
    const lo = read('frontend/src/features/profiles/load-order.ts');
    assert.match(lo, /id="lo-lists"/);
    assert.match(lo, /import\('\.\/order-lists\.js'\)/);
  });
});
