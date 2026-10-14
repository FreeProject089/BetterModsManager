// The conflicts view: its draft model (frontend/src/features/mods/conflicts-model.ts) and its
// wiring. Who WINS a file is decided in Rust and tested there
// (src-tauri/src/commands/conflict_plan_tests.rs); this checks that the view only edits a
// draft, asks the backend, and is reachable from the library's conflict badge.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/features/mods/conflicts-model.js')).href);

const perm = (a, b) => [...a].sort().join('|') === [...b].sort().join('|');

describe('the draft', () => {
  const order = ['a', 'b', 'c', 'd'];

  test('« make X win over Y » is the smallest move: X right after Y', () => {
    assert.deepEqual(M.makeWinOver(order, 'a', 'c'), ['b', 'c', 'a', 'd']);
    assert.deepEqual(M.makeWinOver(order, 'd', 'b'), order, 'already later: nothing moves');
    assert.deepEqual(M.makeWinOver(order, 'ghost', 'b'), order);
    for (const [w, l] of [['a', 'd'], ['b', 'c'], ['c', 'a']]) assert.ok(perm(order, M.makeWinOver(order, w, l)));
  });

  test('pins: set for many files at once, cleared back to the order', () => {
    let p = M.setPins({}, ['x', 'y'], 'a');
    assert.deepEqual(p, { x: 'a', y: 'a' });
    p = M.setPins(p, ['y'], null);
    assert.deepEqual(p, { x: 'a' });
    assert.deepEqual(M.setPins(p, [], 'b'), p);
  });

  test('disabling toggles, and a draft equal to the saved one is clean', () => {
    const saved = { order, pins: { x: 'a' }, disable: [] };
    let d = M.toggleDisable(saved, 'b');
    assert.deepEqual(d.disable, ['b']);
    assert.equal(M.sameDraft(saved, d), false);
    d = M.toggleDisable(d, 'b');
    assert.equal(M.sameDraft(saved, d), true);
    assert.equal(M.sameDraft(saved, { ...saved, pins: { x: 'b' } }), false);
    assert.equal(M.sameDraft(saved, { ...saved, order: M.moveId(order, 'a', 1) }), false);
    assert.deepEqual(saved.disable, [], 'the saved draft is never mutated');
  });

  test('pairs and their files', () => {
    const files = [
      { path: 'x', mods: ['a', 'b', 'c'], winner: 'c' },
      { path: 'y', mods: ['a', 'b'], winner: 'b' },
      { path: 'z', mods: ['b', 'c'], winner: 'c' },
    ];
    assert.deepEqual(M.filesOfPair(files, 'a', 'b').map((f) => f.path), ['x', 'y']);
    const pairs = [{ a: 'a', b: 'b', files: 2, a_wins: 0, b_wins: 1, pinned: 0 }, { a: 'b', b: 'c', files: 2, a_wins: 0, b_wins: 2, pinned: 0 }];
    assert.deepEqual(M.pairsOfMod(pairs, 'a').length, 1);
    assert.equal(M.pairVerdict(pairs[1]), 'b');
    assert.equal(M.pairVerdict(pairs[0]), 'split');
    assert.equal(M.pairVerdict({ a: 'a', b: 'b', files: 1, a_wins: 0, b_wins: 0, pinned: 0 }), 'other');
    assert.equal(M.pairMatches(pairs[0], { a: 'Texture Pack', b: 'UI Mod' }, 'texture'), true);
    assert.equal(M.pairMatches(pairs[0], { a: 'Texture Pack', b: 'UI Mod' }, 'sound'), false);
  });
});

describe('wiring', () => {
  const VIEW = read('frontend/src/features/mods/conflicts-view.ts');
  const MC = read('frontend/src/features/mods/mods-conflicts.ts');
  const COMP = read('frontend/src/ui/components.ts');
  const RS = read('src-tauri/src/commands/mod_order.rs');
  const MAIN = read('src-tauri/src/main.rs');

  test('the view asks the backend for every draft and never decides a winner itself', () => {
    assert.match(VIEW, /invoke\('conflict_plan'/);
    assert.match(VIEW, /invoke\('conflict_apply'/);
    assert.doesNotMatch(VIEW, /winnerUnder|\.mods\[[^\]]*length\s*-\s*1\]/, 'no client-side "last wins"');
    assert.match(VIEW, /startActivity\(/, 'applying is a job in the activity centre');
  });

  test('the commands exist and are registered', () => {
    for (const c of ['conflict_plan', 'conflict_apply']) {
      assert.match(RS, new RegExp(`pub (async )?fn ${c}\\(`));
      assert.match(MAIN, new RegExp(`commands::mod_order::${c},`));
    }
    assert.match(RS, /pub fn winner_of</, 'one rule for who wins');
  });

  test('a live conflict badge in the library opens the view on that mod', () => {
    assert.match(MC, /actAttrs\('openConflictsFor', modId\)/);
    assert.match(COMP, /actAttrs\('openConflictsFor', mod\.id\)/);
    assert.match(MC, /window\.openConflictsFor = openConflictsFor/);
  });

  test('its words exist in both languages', () => {
    const en = JSON.parse(read('frontend/Lang/en.json'));
    const fr = JSON.parse(read('frontend/Lang/fr.json'));
    const used = [...new Set([...VIEW.matchAll(/t\('(cv\.[A-Za-z]+)'/g)].map((m) => m[1]))];
    assert.ok(used.length > 20);
    for (const k of used) { assert.ok(en[k], `en ${k}`); assert.ok(fr[k], `fr ${k}`); }
  });
});
