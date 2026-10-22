// « Failed to copy … HUD_init.lua » (owner's export, BMM 1.0.2): a game under C:\Program Files
// refused every copy and the Library showed the raw message. The backend now answers
// PROTECTED_FOLDER|<game>|<root>|<os error> (src-tauri/src/fs_utils.rs); these pin how the UI
// reads it (frontend/src/features/mods/protected-folder-model.ts, compiled) and that every
// place that used to print the raw error now goes through it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/features/mods/protected-folder-model.js')).href);
const src = (p) => readFileSync(join(ROOT, p), 'utf8').split(String.fromCharCode(13)).join('');
const en = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/en.json'), 'utf8'));
const fr = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/fr.json'), 'utf8'));

const GAME = 'C:\\Program Files\\Eagle Dynamics\\DCS World';
const CODE = `PROTECTED_FOLDER|${GAME}|C:\\Program Files|Access is denied. (os error 5)`;
const fakeT = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);

describe('parsing the typed error', () => {
  test('the four fields come back, the OS text last', () => {
    assert.deepEqual(M.parseProtectedFolderError(CODE), {
      game: GAME, root: 'C:\\Program Files', osError: 'Access is denied. (os error 5)',
    });
  });

  test('an Error object, a wrapper prefix and a rollback note after it still parse', () => {
    assert.equal(M.parseProtectedFolderError(new Error(CODE))?.game, GAME);
    assert.equal(M.parseProtectedFolderError(`Error: ${CODE}`)?.root, 'C:\\Program Files');
    const noted = `${CODE} (rollback incomplete: 1 file(s) could not be put back; copies kept in "x")`;
    assert.match(M.parseProtectedFolderError(noted).osError, /^Access is denied/);
  });

  test('anything else is not this error', () => {
    for (const other of [
      'Failed to copy "a" -> "b": The process cannot access the file (os error 32) [Other]',
      'CANCELLED', 'MISSING_SHA|id|name', 'CRITICAL_SPACE|Game|3|5', 'PROTECTED_FOLDER|', 'PROTECTED_FOLDER||C:\\x|y',
      '', null, undefined, 42,
    ]) {
      assert.equal(M.parseProtectedFolderError(other), null, String(other));
      assert.equal(M.isProtectedFolderError(other), false);
    }
  });

  test('a finished job with one refused mod among others is found', () => {
    const s = { failed: [{ error: 'something else' }, { error: CODE }] };
    assert.equal(M.protectedFolderInSummary(s)?.game, GAME);
    assert.equal(M.protectedFolderInSummary({ failed: [] }), null);
    assert.equal(M.protectedFolderInSummary(null), null);
  });
});

describe('the words', () => {
  test('what, why, what to do and the Windows text, with the paths filled in', () => {
    const L = M.protectedFolderLines(M.parseProtectedFolderError(CODE), fakeT);
    assert.equal(L.title, 'mod.protectedFolder.title');
    assert.match(L.what, /mod\.protectedFolder\.what.*DCS World/);
    assert.match(L.why, /mod\.protectedFolder\.why.*Program Files/);
    assert.match(L.todo, /mod\.protectedFolder\.todo/);
    assert.match(L.os, /os error 5/);
  });

  test('a list of failures never shows the raw code', () => {
    assert.equal(M.failureLine(CODE, fakeT), 'mod.protectedFolder.short');
    assert.equal(M.failureLine('orderList.someKey', fakeT), 'orderList.someKey');
  });

  test('every key exists in English and French, with the same variables', () => {
    const keys = ['title', 'what', 'why', 'todo', 'osError', 'restart', 'restarting', 'learnMore', 'short', 'warning']
      .map((k) => `mod.protectedFolder.${k}`)
      .concat(['mod.elevation.errAlreadyElevated', 'mod.elevation.errDeclined', 'mod.elevation.errUnsupported']);
    const vars = (s) => (s.match(/\{[a-z]+\}/gi) || []).sort().join(',');
    for (const k of keys) {
      assert.ok(en[k] && fr[k], `${k} in en and fr`);
      assert.equal(vars(en[k]), vars(fr[k]), `${k}: same variables`);
    }
  });
});

describe('the wiring', () => {
  test('the Rust side writes exactly the prefix the UI looks for', () => {
    const rs = src('src-tauri/src/fs_utils.rs');
    assert.ok(rs.includes('pub const PROTECTED_FOLDER: &str = "PROTECTED_FOLDER";'));
    assert.ok(rs.includes('format!("{PROTECTED_FOLDER}|{}|{}|{}", game_root.display(), protected.display(), os)'));
    assert.equal(M.PROTECTED_FOLDER_PREFIX, 'PROTECTED_FOLDER|');
    // The probe runs before the parallel copy.
    const body = rs.slice(rs.indexOf('pub fn apply_mod_stacked_ticketed('));
    assert.ok(body.indexOf('probe_write_access_with(') < body.indexOf('run_deploy_parallel('), 'probe before any copy');
  });

  test('the card toggle, Enable all, order lists and every job end go through it', () => {
    assert.match(src('frontend/src/features/mods/mods-list.ts'), /isProtectedFolderError\(err\)[\s\S]{0,400}handleProtectedFolderError\(err\)/);
    assert.match(src('frontend/src/features/mods/mods-actions.ts'), /isProtectedFolderError\(err\)[\s\S]{0,300}handleProtectedFolderError\(err\)/);
    assert.match(src('frontend/src/features/profiles/order-lists.ts'), /failureLine\(f\.error/);
    assert.match(src('frontend/src/ui/app.ts'), /onActivationJobEnd\([\s\S]{0,200}isProtectedFolderError/);
  });

  test('the dialog is BMM\'s own, restarts through the backend and links the docs section', () => {
    const d = src('frontend/src/features/mods/protected-folder.ts');
    assert.ok(d.includes("openModal("), 'modal-shell, never a native dialog');
    assert.ok(!/window\.(confirm|alert)\(/.test(d));
    assert.ok(d.includes("invoke('restart_elevated')"));
    assert.ok(d.includes("openLearnMore('protected-folder')"));
    assert.match(src('frontend/src/core/learn-more.ts'), /'protected-folder':\s*\{[^}]*page: 'reference\/troubleshooting', hash: 'protected-folder'/);
    assert.match(src('BMM Docs/docs/reference/troubleshooting.md'), /\{#protected-folder\}/);
    assert.match(src('BMM Docs/docs/reference/troubleshooting.fr.md'), /\{#protected-folder\}/);
  });

  test('the elevation commands are registered', () => {
    const main = src('src-tauri/src/main.rs');
    for (const c of ['get_elevation_state', 'check_folder_protection', 'restart_elevated']) {
      assert.ok(main.includes(`commands::elevation::${c},`), c);
    }
    // The relaunch goes through the proc helpers (ShellExecuteExW runas), never Command::new.
    const el = src('src-tauri/src/commands/elevation.rs');
    assert.ok(el.includes('crate::commands::proc::shell_runas('));
    assert.ok(!el.includes('Command::new'));
  });
});
