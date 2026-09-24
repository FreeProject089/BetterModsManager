// One vocabulary of task permissions, read the same way by every screen that decides on one.
//
// Pentest R13 (Sept 24 2026). The `.bmmscript` review screen kept its OWN list of the
// permissions worth a warning, written before `resources` existed, and nobody added it there:
//
//     task "Nightly" { manual / allow resources /
//         do resources.preset(name: "max", scope: "persistent") / do resources.queue(action: "pause_all") }
//
// compiled to a task granted `resources`, and the screen called it "asks for nothing beyond
// BMM's own actions" with "Run it now" enabled and no "I have read what it does" box.
// `runTaskOnce` runs the file's own grants, so one click set BMM to Max for good, switched
// game mode off or froze every deploy and install behind a queue paused with nothing saying
// why. The import path (`sanitiseImportedTask`) had the right list; the run path did not.
//
// The plan (PLAN-BMM-RESOURCES-2026.md §6) promised a gate requiring the lists to be
// identical; it was never written. This is it, plus the behaviour the review decision needs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const inspect = await import(pathToFileURL(join(ROOT, 'frontend/js/features/settings/bmmpa-inspect.js')).href);
const { RISK_KEYS } = inspect;
const VOCAB = [...RISK_KEYS].sort();

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('the permission vocabulary', () => {
  test('RISK_KEYS carries every permission the BMMScript compiler can grant', () => {
    const rs = readFileSync(join(ROOT, 'src-tauri/src/commands/bmms.rs'), 'utf8');
    // The compiler's `allow …` arm and the decompiler's list: the two Rust readers.
    const arm = rs.match(/"command"\s*\|\s*"script"[^=]*=>/);
    assert.ok(arm, 'the `allow` match arm in bmms.rs was not found (renamed?)');
    const fromArm = [...arm[0].matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(fromArm, VOCAB, 'bmms.rs `allow` accepts a different set than RISK_KEYS');
    const dec = rs.match(/for k in \[("command"[^\]]*)\]/);
    assert.ok(dec, 'the decompiler permission list in bmms.rs was not found (renamed?)');
    const fromDec = [...dec[1].matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(fromDec, VOCAB, 'bmms.rs prints a different set than RISK_KEYS');
  });

  test('no frontend screen keeps a private, shorter copy of the list', () => {
    // A literal list that starts like the vocabulary IS a copy of it; it must be all of it.
    const offenders = [];
    for (const f of walk(join(ROOT, 'frontend/src'))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\[\s*'command'\s*,\s*'script'\s*,[^\]]*\]/g)) {
        const keys = [...m[0].matchAll(/'([A-Za-z]+)'/g)].map((x) => x[1]).sort();
        if (JSON.stringify(keys) !== JSON.stringify(VOCAB)) {
          offenders.push(`${relative(ROOT, f)}: [${keys.join(', ')}]`);
        }
      }
    }
    assert.deepEqual(offenders, [], `lists missing a permission:\n${offenders.join('\n')}`);
  });
});

describe('what a task grants itself (the review decision)', () => {
  const { grantedPermissions } = inspect;

  test('is one shared function', () => {
    assert.equal(typeof grantedPermissions, 'function', 'bmmpa-inspect must export grantedPermissions');
    const screen = readFileSync(join(ROOT, 'frontend/src/features/settings/bmmscript-open.ts'), 'utf8');
    assert.match(screen, /import\s*\{[^}]*\bgrantedPermissions\b[^}]*\}\s*from\s*'\.\/bmmpa-inspect\.js'/,
      'the .bmmscript review screen must use the shared decision, not its own');
  });

  test('a task granted `resources` is not "safe"', () => {
    assert.deepEqual(grantedPermissions({ perms: { resources: true } }), ['resources']);
  });

  test('every permission is reported, in the vocabulary', () => {
    const all = Object.fromEntries(RISK_KEYS.map((k) => [k, true]));
    assert.deepEqual([...grantedPermissions({ perms: all })].sort(), VOCAB);
  });

  test('the legacy single flag still reads as command + deeplink', () => {
    assert.deepEqual([...grantedPermissions({ allowCustomCommands: true })].sort(), ['command', 'deeplink']);
    assert.deepEqual([...grantedPermissions({ perms: { script: true }, allowCustomCommands: true })].sort(),
      ['command', 'deeplink', 'script']);
  });

  test('it reads a grant the way the runtime does (truthy), never more narrowly', () => {
    assert.deepEqual(grantedPermissions({ perms: { resources: 1 } }), ['resources']);
  });

  test('a task with no `perms` object is a legacy task: the runtime lets it fire deep links', () => {
    assert.deepEqual(grantedPermissions({ name: 'x', steps: [] }), ['deeplink']);
  });

  test('an honest task, and junk, grant nothing', () => {
    assert.deepEqual(grantedPermissions({ perms: {} }), []);
    assert.deepEqual(grantedPermissions(null), []);
    assert.deepEqual(grantedPermissions({ perms: 'command' }), []);
  });
});
