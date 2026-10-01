// The shared activation order: the model the import dialog reads (where each mod lands, the
// counts), the block every bulk enable passes to the engine, and the wiring (the commands the
// frontend invokes are registered, the words are translated in every language).
//
// The rules themselves (parse, match, merge) are the backend's, tested in Rust
// (src-tauri/src/commands/order_share_tests.rs). This checks the frontend reads them right.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/features/profiles/order-share-model.js')).href);

// What mod_order_import_preview answers for: current [a, c, b], a pasted "Beta, Delta, Alpha,
// Unknown" (the same case as order_share_tests.rs preview_sorts_every_entry_into_one_bucket).
const PLAN = {
  name: null, game: null, total: 4,
  matched: [{ id: 'b', name: 'Beta', from: 3, to: 1 }, { id: 'a', name: 'Alpha', from: 1, to: 3 }],
  inactive: [{ id: 'd', name: 'Delta', from: 0, to: 0 }],
  missing: ['Unknown Mod'],
  extra: [{ id: 'c', name: 'Gamma', from: 2, to: 2 }],
  result: ['b', 'c', 'a'], changed: true, handovers: 1,
};

describe('import preview model', () => {
  test('every active mod lands once, in the new order', () => {
    const l = M.landings(PLAN);
    assert.deepEqual(l.map((x) => x.id), PLAN.result);
    assert.deepEqual(l.map((x) => x.move), ['down', 'same', 'up']);
    assert.deepEqual(l.map((x) => x.known), [true, false, true], 'an extra mod is marked as not in the list');
  });

  test('counts', () => {
    assert.deepEqual(M.planCounts(PLAN), { placed: 2, moved: 2, missing: 1, inactive: 1, extra: 1 });
  });

  test('an unchanged plan has nothing moving', () => {
    const same = { ...PLAN, matched: [{ id: 'a', name: 'A', from: 1, to: 1 }], extra: [], changed: false };
    assert.equal(M.planCounts(same).moved, 0);
  });

  test('missing fields do not throw', () => {
    assert.deepEqual(M.landings({}), []);
    assert.equal(M.planCounts({}).placed, 0);
  });

  test('what a paste looks like', () => {
    assert.equal(M.pastedKind('  '), 'empty');
    assert.equal(M.pastedKind('bmm://order?d=BMMORDER1.abc'), 'link');
    assert.equal(M.pastedKind('BMMORDER1.abc'), 'code');
    assert.equal(M.pastedKind('{"format":"bmm-order"}'), 'json');
    assert.equal(M.pastedKind('1. Alpha\n2. Beta'), 'list');
  });
});

describe('bulk enable block', () => {
  test('a pack places all of its mods, in its order, once', () => {
    assert.deepEqual(M.bulkBlock(['p', 'x', 'p', ''], ['x', 'y'], true), ['p', 'x']);
  });
  test('enable all places only what it newly enabled', () => {
    assert.deepEqual(M.bulkBlock(['a', 'b', 'c'], ['b', 'a'], false), ['c']);
  });
  test('mode words', () => {
    assert.equal(M.normalizeMode(' Bottom '), 'bottom');
    assert.equal(M.normalizeMode('sideways'), null);
    assert.equal(M.normalizeMode(undefined, 'top'), 'top');
    assert.deepEqual([...M.PLACE_MODES], ['top', 'bottom', 'keep']);
  });
});

describe('wiring', () => {
  const main = read('src-tauri/src/main.rs');
  const rs = read('src-tauri/src/commands/order_share.rs');
  test('every order_share command is registered', () => {
    const cmds = [...rs.matchAll(/#\[tauri::command\]\s*pub (?:async )?fn (\w+)/g)].map((m) => m[1]);
    assert.ok(cmds.length >= 6, `found ${cmds}`);
    for (const c of cmds) assert.ok(main.includes(`commands::order_share::${c},`), `${c} not in main.rs`);
  });
  test('the frontend invokes only commands that exist', () => {
    const ts = read('frontend/src/features/profiles/order-share.ts');
    const invoked = [...ts.matchAll(/invoke\('(\w+)'/g)].map((m) => m[1]);
    assert.ok(invoked.length > 0);
    for (const c of invoked) assert.ok(main.includes(`::${c},`), `${c} is not a registered command`);
  });
  test('the backend error keys and the view keys are translated in every language', () => {
    const keys = new Set([
      ...[...rs.matchAll(/"(order\.err\w+)"/g)].map((m) => m[1]),
      ...[...read('frontend/src/features/profiles/order-share.ts').matchAll(/t\('(order\.[\w.]+)'/g)].map((m) => m[1]),
    ]);
    assert.ok(keys.size > 10);
    for (const lang of ['en', 'fr', 'template']) {
      const d = JSON.parse(read(`frontend/Lang/${lang}.json`));
      const get = (k) => k.split('.').reduce((o, p) => (o && typeof o === 'object' ? o[p] : undefined), d) ?? d[k];
      for (const k of keys) assert.ok(get(k) !== undefined, `${lang}.json is missing ${k}`);
    }
  });
});

// Every bulk enable ends in the same engine (mod_order_arrange / order_share::arrange). One of
// them quietly enabling mods and leaving the order to chance is the regression this guards.
describe('every bulk enable goes through the engine', () => {
  const sched = read('frontend/src/features/settings/scheduler.ts');
  const caseBody = (name) => {
    const at = sched.indexOf(`case '${name}':`);
    assert.ok(at > 0, `runAction has no case for ${name}`);
    return sched.slice(at, sched.indexOf('\n        case ', at + 10));
  };
  test('tasks: modpack.enable, mods.enableAll and modlist.apply read `placement`', () => {
    assert.match(caseBody('modpack.enable'), /applyModpack\(p\.id, true, p\.placement\)/);
    assert.match(caseBody('mods.enableAll'), /orderMode: placementOf\(p\.placement\)/);
    assert.match(caseBody('modlist.apply'), /orderMode: placementOf\(p\.placement\)/);
    const apply = sched.slice(sched.indexOf('async function applyModpack'), sched.indexOf('async function applyModpack') + 1400);
    assert.match(apply, /invoke\('mod_order_arrange'/);
    assert.match(apply, /pack\.order_mode/, 'the pack\'s own mode is the fallback');
  });
  test('the step form offers the placement on those three', () => {
    assert.match(sched, /v: 'modpack\.enable',[^}]*needs: 'modpackOn'/);
    assert.match(sched, /v: 'mods\.enableAll',[^}]*needs: 'enableAll'/);
    assert.match(sched, /needs === 'listApply'[\s\S]{0,4000}placementField\(params, false\)/);
    assert.match(sched, /\.sched-p-place'\)\?\.addEventListener/);
  });
  test('the modpack screen, Enable all, a list and a deep link', () => {
    assert.match(read('frontend/src/features/mods/modpack-creator.ts'), /arrangeBlock\(packOrder, pack\.order_mode/);
    assert.match(read('src-tauri/src/commands/mods.rs'), /order_share::arrange_for\(&state, None, &newly, order_mode/);
    const list = read('frontend/src/features/mods/modlist.ts');
    assert.match(list, /invoke\('mod_order_arrange', \{ profileId: null, ids: newly, mode \}\)/);
    assert.match(list, /list\?\.load_order && effective !== 'keep'/);
    const dl = read('frontend/src/core/deep_link_manager.ts');
    assert.match(dl, /if \(action === 'modpack\/enable' && modIds\.length\)[\s\S]{0,600}mod_order_arrange/);
  });
  test('a bmm://order link only opens the preview, so it needs no dialog of its own', () => {
    const guard = read('frontend/src/core/deeplink-guard.ts');
    assert.match(guard, /'order',\s*\]\);/);
    const dl = read('frontend/src/core/deep_link_manager.ts');
    const at = dl.indexOf("if (action === 'order')");
    assert.ok(at > 0);
    const body = dl.slice(at, dl.indexOf('\n        }\n', at));
    assert.match(body, /openLoadOrder\(null, undefined, toast, \{ importText: d \}\)/);
    assert.doesNotMatch(body, /mod_order_import'|mod_order_set'/, 'the link must never apply an order by itself');
  });
  test('a .mm list carries the order, and the modpack its mode', () => {
    assert.match(read('src-tauri/src/models/modlist.rs'), /pub load_order: Option<crate::commands::order_share::OrderDoc>/);
    assert.match(read('src-tauri/src/models/modpack.rs'), /pub order_mode: Option<String>/);
    assert.match(read('src-tauri/src/commands/modlist.rs'), /modlist\.load_order = load_order/);
  });
});
