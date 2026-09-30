// The activation-order view: its model (what a drag, a sort or a key does to the draft, and what
// the rows say about it) and its wiring (the commands it invokes exist, its shortcuts are in the
// registry, its words are translated).
//
// The model is the compiled frontend/js module, loaded in plain node — it is import-free on
// purpose. The rule it must agree with is the backend's (src-tauri/src/commands/mod_order.rs):
// the LAST provider of a file in the order wins it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/features/profiles/load-order-model.js')).href);

const perm = (a, b) => [...a].sort().join('|') === [...b].sort().join('|');

describe('load-order model', () => {
  const order = ['a', 'b', 'c', 'd'];

  test('moving never adds or drops a mod', () => {
    for (const [from, to] of [[0, 3], [3, 0], [1, 2], [2, 2], [-1, 1], [9, 0], [0, 99]]) {
      const out = M.moveItem(order, from, to);
      assert.ok(perm(order, out), `${from}->${to} gave ${out}`);
    }
    assert.deepEqual(M.moveItem(order, 0, 3), ['b', 'c', 'd', 'a']);
  });

  test('up, down, top and bottom', () => {
    assert.deepEqual(M.moveId(order, 'c', -1), ['a', 'c', 'b', 'd']);
    assert.deepEqual(M.moveId(order, 'c', 1), ['a', 'b', 'd', 'c']);
    assert.deepEqual(M.moveId(order, 'c', 'top'), ['c', 'a', 'b', 'd']);
    assert.deepEqual(M.moveId(order, 'b', 'bottom'), ['a', 'c', 'd', 'b']);
    assert.deepEqual(M.moveId(order, 'a', -1), order, 'the first cannot go higher');
    assert.deepEqual(M.moveId(order, 'ghost', 1), order, 'an unknown id changes nothing');
  });

  test('a drop lands before or after the row under the pointer', () => {
    assert.deepEqual(M.dropAt(order, 'a', 'c', false), ['b', 'a', 'c', 'd']);
    assert.deepEqual(M.dropAt(order, 'a', 'c', true), ['b', 'c', 'a', 'd']);
    assert.deepEqual(M.dropAt(order, 'd', 'a', false), ['d', 'a', 'b', 'c']);
    assert.deepEqual(M.dropAt(order, 'b', 'b', true), order, 'onto itself: nothing');
  });

  test('sorting is stable and "current" gives the deployed order back', () => {
    const mods = new Map([
      ['a', { id: 'a', name: 'Zeta', added_at: '2026-03-01T00:00:00Z' }],
      ['b', { id: 'b', name: 'alpha', added_at: '2026-01-01T00:00:00Z' }],
      ['c', { id: 'c', name: 'Mid', added_at: '2026-02-01T00:00:00Z' }],
      ['d', { id: 'd', name: 'alpha', added_at: '' }],
    ]);
    assert.deepEqual(M.sortOrder(order, mods, 'name-asc', order), ['b', 'd', 'c', 'a'], 'ties keep their order');
    assert.deepEqual(M.sortOrder(order, mods, 'oldest', order), ['d', 'b', 'c', 'a'], 'no date sorts first');
    assert.deepEqual(M.sortOrder(order, mods, 'newest', order), ['a', 'c', 'b', 'd']);
    assert.deepEqual(M.sortOrder(['d', 'c', 'b', 'a'], mods, 'current', order), order);
  });

  // The same scenario as the Rust test `a_reorder_recopies_only_the_files_that_change_hands`.
  const contested = [
    { path: 'Data/tex.dds', mods: ['a', 'b'], winner: 'b' },
    { path: 'Data/shared2.txt', mods: ['b', 'c'], winner: 'c' },
  ];

  test('the last provider wins, and a reorder counts only the files that change hands', () => {
    assert.equal(M.handoverCount(contested, ['a', 'b', 'c'], ['a', 'b', 'c']), 0);
    assert.equal(M.handoverCount(contested, ['a', 'b', 'c'], ['b', 'a', 'c']), 1, 'only tex.dds');
    assert.equal(M.handoverCount(contested, ['a', 'b', 'c'], ['c', 'b', 'a']), 2);
  });

  test('each row says whom it overrides and who overrides it, under the DRAFT', () => {
    const names = { a: 'A', b: 'B', c: 'C' };
    const r = M.rivalsUnder(contested, ['b', 'a', 'c'], (id) => names[id]);
    assert.deepEqual(r.get('a').overrides, [{ id: 'b', name: 'B', files: 1 }]);
    assert.deepEqual(r.get('b').overriddenBy.map((x) => x.id).sort(), ['a', 'c']);
    assert.equal(r.get('b').winning, 0);
    assert.equal(r.get('c').winning, 1);
    assert.equal(r.get('c').contested, 1);
  });
});

describe('load-order wiring', () => {
  const view = read('frontend/src/features/profiles/load-order.ts');
  const keys = read('frontend/src/features/profiles/load-order-keys.ts');
  const commands = read('frontend/src/core/commands.ts');
  const main = read('src-tauri/src/main.rs');
  const en = JSON.parse(read('frontend/Lang/en.json'));
  const fr = JSON.parse(read('frontend/Lang/fr.json'));

  test('every command the view invokes is registered in the Tauri app', () => {
    const invoked = [...view.matchAll(/invoke\('([a-z_]+)'/g)].map((m) => m[1]);
    assert.ok(invoked.length >= 4, 'read too few invokes to be right');
    for (const name of invoked) {
      assert.match(main, new RegExp(`commands::mod_order::${name}\\b`), `${name} is not in the invoke handler`);
    }
  });

  test('its shortcuts are registry commands, scoped, with distinct chords', () => {
    assert.match(commands, /for \(const k of ORDER_KEYS\)/);
    assert.match(commands, /when: \(\) => orderKeysActive\(\)/);
    assert.match(commands, /id: 'profiles\.loadOrder'/);
    // The view's own five: the part of the file before the library's list.
    const viewKeys = keys.slice(0, keys.indexOf('export const LIB_ORDER_KEYS'));
    const chords = [...viewKeys.matchAll(/chord: (\{[^}]*\})/g)].map((m) => m[1].replace(/\s+/g, ''));
    assert.equal(chords.length, 5);
    assert.equal(new Set(chords).size, chords.length, 'two order shortcuts share a chord');
    for (const id of ['order.moveUp', 'order.moveDown', 'order.moveTop', 'order.moveBottom', 'order.apply']) {
      assert.ok(view.includes(`'${id}':`), `the view binds no handler for ${id}`);
    }
  });

  test('every order.* key it names is translated in both languages', () => {
    const used = new Set([
      ...[...view.matchAll(/'(order\.[A-Za-z]+)'/g)].map((m) => m[1]),
      ...[...view.matchAll(/t\('(order\.[A-Za-z]+)'\)/g)].map((m) => m[1]),
    ].filter((k) => !keys.includes(`'${k}'`)));
    assert.ok(used.size > 20, `read only ${used.size} keys`);
    for (const k of used) {
      assert.ok(en[k], `${k} missing from en.json`);
      assert.ok(fr[k], `${k} missing from fr.json`);
      for (const ph of (en[k].match(/\{[a-z]\}/g) || [])) assert.ok(fr[k].includes(ph), `${k}: fr lost ${ph}`);
    }
  });

  test('the profile card opens it, and the modpack apply places the pack on top', () => {
    assert.match(read('frontend/src/features/profiles/profiles.ts'), /btn-load-order/);
    assert.match(read('frontend/src/features/mods/modpack-creator.ts'), /placeOnTop\(packOrder, null, toast/);
  });
});

// The same order, reachable from the Mod Library (features/mods/lib-order.ts): a toolbar button,
// a box in the detail panel, a right-click menu and four scoped shortcuts. It must REUSE the
// model and the backend commands, not grow a second copy of either.
describe('load-order from the Mod Library', () => {
  const lib = read('frontend/src/features/mods/lib-order.ts');
  const keys = read('frontend/src/features/profiles/load-order-keys.ts');
  const commands = read('frontend/src/core/commands.ts');
  const main = read('src-tauri/src/main.rs');
  const en = JSON.parse(read('frontend/Lang/en.json'));
  const fr = JSON.parse(read('frontend/Lang/fr.json'));

  test('it moves with the model and applies with the backend', () => {
    assert.match(lib, /from '\.\.\/profiles\/load-order-model\.js'/);
    assert.match(lib, /moveId\(order, modId, where\)/);
    assert.doesNotMatch(lib, /function (moveId|moveItem|dropAt|winnerUnder)\b/, 'a second copy of the model');
    const invoked = [...lib.matchAll(/invoke\('([a-z_]+)'/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(invoked)].sort(), ['mod_order_get', 'mod_order_set']);
    for (const name of invoked) assert.match(main, new RegExp(`commands::mod_order::${name}\\b`));
  });

  test('the library mounts it: toolbar, detail panel, init', () => {
    assert.match(read('frontend/src/features/mods/mods.ts'), /initLibOrder\(toast\);/);
    assert.match(read('frontend/src/features/mods/mods-details.ts'), /mountOrderSection\(panel, mod\);/);
    assert.match(lib, /btn-lib-order/);
    assert.match(lib, /openLoadOrder\(null, name \|\| undefined, toast\)/, 'the full view opens for the library profile');
  });

  test('its shortcuts are registry commands, never live together with the view\'s', () => {
    assert.match(commands, /for \(const k of LIB_ORDER_KEYS\)/);
    assert.match(commands, /when: \(\) => libOrderKeysActive\(\)/);
    assert.match(keys, /export function libOrderKeysActive\(\): boolean \{\s*if \(orderKeysActive\(\)\) return false;/);
    const libPart = keys.slice(keys.indexOf('export const LIB_ORDER_KEYS'));
    const ids = [...libPart.matchAll(/id: '(library\.order\.[A-Za-z]+)'/g)].map((m) => m[1]);
    assert.deepEqual(ids, ['library.order.moveUp', 'library.order.moveDown', 'library.order.moveTop', 'library.order.moveBottom']);
    const chords = [...libPart.matchAll(/chord: (\{[^}]*\})/g)].map((m) => m[1].replace(/\s+/g, ''));
    assert.equal(new Set(chords).size, 4, 'two library shortcuts share a chord');
    for (const id of ids) assert.ok(lib.includes(`'${id}':`), `lib-order.ts binds no handler for ${id}`);
  });

  test('every order.* key it names is translated, placeholders kept', () => {
    const used = new Set([...lib.matchAll(/'(order\.[A-Za-z.]+)'/g)].map((m) => m[1]));
    assert.ok(used.size >= 10, `read only ${used.size} keys`);
    for (const k of used) {
      assert.ok(en[k], `${k} missing from en.json`);
      assert.ok(fr[k], `${k} missing from fr.json`);
      for (const ph of (en[k].match(/\{[a-z]\}/g) || [])) assert.ok(fr[k].includes(ph), `${k}: fr lost ${ph}`);
    }
  });
});
