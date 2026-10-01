// .mm lists: Cancel stops the run it belongs to, at once, without a second question.
//
// Before: one shared flag per kind (reset by every run, and shared with the repo installs),
// a Cancel that only showed "Cancelling..." until the whole copy finished, the progress panel
// left up two more seconds, and a cancelled install that removed mods which were already in
// the library ("already present") from it. The Rust side is covered by the unit tests of
// commands/modlist.rs `runs`; this checks the screen keeps its half of the contract.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const norm = (p) => readFileSync(join(ROOT, p), 'utf8').split(String.fromCharCode(13)).join('');
const ts = norm('frontend/src/features/mods/modlist.ts');
const mods = norm('src-tauri/src/commands/mods.rs');
const modlist = norm('src-tauri/src/commands/modlist.rs');

function fnBody(src, marker, len = 3000) {
  const i = src.indexOf(marker);
  assert.ok(i >= 0, `missing: ${marker}`);
  return src.slice(i, i + len);
}

describe('the screen', () => {
  test('both runs carry a cancel token, and Cancel sends it back', () => {
    assert.match(ts, /invoke\('export_modlist', \{[^}]*runId[^}]*\}\)/);
    assert.match(ts, /invoke\('install_from_modlist', \{[\s\S]{0,200}runId: run\.id/);
    assert.match(ts, /invoke\('cancel_export_modlist', \{ runId \}\)/);
    assert.match(ts, /invoke\('cancel_install_from_modlist', \{ runId: run\.id \}\)/);
  });

  test('Cancel closes the progress at once and asks nothing', () => {
    const install = fnBody(ts, "const btn = e.target.closest('#btn-cancel-import-dl');", 1200);
    assert.match(install, /overlay\.style\.display = 'none'/);
    assert.doesNotMatch(install, /confirmCustom|confirm\(/);
    // Not awaited: the panel does not wait for Rust to answer.
    assert.doesNotMatch(install, /await invoke\('cancel_install_from_modlist'/);
    const exp = fnBody(ts, 'const onAbort = () => {', 800);
    assert.match(exp, /progressOverlay\.style\.display = 'none'/);
    assert.doesNotMatch(exp, /confirmCustom|await invoke/);
  });

  test('the abort listener does not pile up across exports', () => {
    assert.match(ts, /abortExportBtn\?\.removeEventListener\('click', onAbort\)/);
    assert.doesNotMatch(ts, /addEventListener\('click', onAbort, \{ once: true \}\)/);
  });
});

describe('the Rust side', () => {
  test('a list install no longer uses the flag the repo installs share', () => {
    const body = fnBody(mods, 'pub async fn install_from_modlist(', 40000);
    const end = body.indexOf('\n}\n') > 0 ? body.indexOf('\n}\n') : body.indexOf('\r\n}\r\n');
    assert.doesNotMatch(body.slice(0, end), /install_cancelled/);
    assert.match(body, /runs::begin\("install", run_id\)/);
  });

  test('its copy and download tickets are tied to the run', () => {
    const body = fnBody(mods, 'pub async fn install_from_modlist(', 40000);
    assert.equal((body.match(/runs::attach\(&rk, ticket\.id\(\)\)/g) || []).length, 2);
  });

  test('a cancel removes only what the run created', () => {
    const body = fnBody(mods, 'pub async fn install_from_modlist(', 40000);
    assert.match(body, /data\.mods\.retain\(\|m\| !created_mod_ids\.contains\(&m\.id\)\)/);
    assert.match(body, /data\.custom_tags\.retain\(\|t\| !added_tag_ids\.contains\(&t\.id\)\)/);
  });

  test('the export checks for Cancel inside a hash, not only between files', () => {
    assert.match(modlist, /fn hash_file_streaming\(path: &PathBuf, stop: &dyn Fn\(\) -> bool\)/);
    assert.match(modlist, /if stop\(\) \{ return None; \}/);
  });
});
