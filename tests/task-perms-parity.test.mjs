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

  test('the legacy single flag still reads as command + deeplink (and a legacy task runs other tasks)', () => {
    assert.deepEqual([...grantedPermissions({ allowCustomCommands: true })].sort(), ['command', 'deeplink', 'tasks']);
    assert.deepEqual([...grantedPermissions({ perms: { script: true }, allowCustomCommands: true })].sort(),
      ['command', 'deeplink', 'script']);
  });

  test('it reads a grant the way the runtime does: the boolean `true`, nothing else (card 6)', () => {
    assert.deepEqual(grantedPermissions({ perms: { resources: true } }), ['resources']);
    assert.deepEqual(grantedPermissions({ perms: { resources: 1, script: 'yes', command: {} } }), []);
  });

  test('a task with no `perms` object is a legacy task: the runtime lets it fire deep links and run other tasks', () => {
    assert.deepEqual(grantedPermissions({ name: 'x', steps: [] }), ['deeplink', 'tasks']);
  });

  test('an honest task, and junk, grant nothing', () => {
    assert.deepEqual(grantedPermissions({ perms: {} }), []);
    assert.deepEqual(grantedPermissions(null), []);
    assert.deepEqual(grantedPermissions({ perms: 'command' }), []);
  });
});

// ── Owner cards 6, 7 and 9 of the R12/R13 pentest (AUDIT-SEPT24-BMM-RUST.md) ─────────────
//
// scheduler.js needs a browser to load, so its pure parts are read out of the compiled file
// and evaluated on their own, the way tests/import-perms.test.mjs does it. Loaded at the top
// level, not inside a describe(): a describe body that throws counts nothing and exits 0.
const SCHED_JS = readFileSync(join(ROOT, 'frontend/js/features/settings/scheduler.js'), 'utf8');
const SCHED_TS = readFileSync(join(ROOT, 'frontend/src/features/settings/scheduler.ts'), 'utf8');
function fnSource(js, head, bodyEnd = '\n}') {
  const start = js.indexOf(head);
  assert.ok(start >= 0, `\`${head}\` not found in scheduler.js (renamed?)`);
  const end = js.indexOf(bodyEnd, start) + bodyEnd.length;
  return js.slice(start, end).replace(/^export function/, 'function');
}
async function evalModule(src, names) {
  return import('data:text/javascript;base64,' + Buffer.from(`${src}\nexport { ${names.join(', ')} };`, 'utf8').toString('base64'));
}
const { taskPerms, hasPerm } = await evalModule(
  fnSource(SCHED_JS, 'function taskPerms(') + '\n' + fnSource(SCHED_JS, 'function hasPerm('), ['taskPerms', 'hasPerm']);
const { sanitiseImportedTask } = await evalModule(
  fnSource(SCHED_JS, 'export function sanitiseImportedTask', '\n}\n'), ['sanitiseImportedTask']);

describe('card 6: the runtime grants on `true` only', () => {
  test('a truthy value that is not `true` grants nothing', () => {
    for (const v of [1, 'yes', 'true', {}, [], 'command']) {
      assert.equal(hasPerm({ perms: { command: v } }, 'command'), false, `${JSON.stringify(v)} was taken as a grant`);
    }
    assert.equal(hasPerm({ perms: { command: true } }, 'command'), true);
    assert.equal(hasPerm({ perms: 'all' }, 'command'), false, 'a perms that is not an object grants nothing');
  });

  test('a legacy task keeps what it always had, and a non-boolean legacy flag is no grant', () => {
    assert.equal(hasPerm({ allowCustomCommands: true }, 'command'), true);
    assert.equal(hasPerm({ allowCustomCommands: 'yes' }, 'command'), false);
    assert.equal(hasPerm({}, 'deeplink'), true);
    assert.equal(hasPerm({}, 'tasks'), true);
    assert.equal(hasPerm({}, 'script'), false);
    assert.deepEqual(taskPerms({ perms: { x: 1 } }), { x: 1 }, 'an explicit perms object is read as is');
  });

  test('every permission check goes through hasPerm', () => {
    const req = SCHED_TS.match(/function requirePerm\([^)]*\)[^{]*\{([\s\S]*?)\n\}/);
    assert.ok(req, 'requirePerm not found');
    assert.match(req[1], /!hasPerm\(task, key\)/, 'requirePerm must decide with hasPerm');
    // A truthiness read of a grant anywhere else is the laxness coming back by another door.
    const lax = [...SCHED_TS.matchAll(/!!?taskPerms\([^)]*\)(?:\.\w+|\[[^\]]+\])/g)].map((m) => m[0]);
    assert.deepEqual(lax, [], 'a grant read by truthiness');
  });
});

describe('card 7: the inspector shows what the import strips', () => {
  const { inspectBmmpa, askedPermissions } = inspect;
  const FIXTURES = [
    { name: 'flag beside perms', perms: { script: true }, allowCustomCommands: true, steps: [] },
    { name: 'flag alone', allowCustomCommands: true, steps: [] },
    { name: 'everything', allowCustomCommands: true, perms: Object.fromEntries(RISK_KEYS.map((k) => [k, true])), steps: [] },
    { name: 'truthy junk', perms: { resources: 1, command: 'yes' }, allowCustomCommands: 'yes', steps: [] },
    { name: 'perms not an object', perms: 'command', steps: [] },
    { name: 'honest', perms: {}, steps: [] },
    { name: 'legacy, nothing', steps: [] },
  ];

  for (const fx of FIXTURES) {
    test(`${fx.name}: inspector == import`, () => {
      const shown = inspectBmmpa({ tasks: [fx] }).tasks[0].perms;
      const stripped = sanitiseImportedTask(fx).strippedPerms;
      assert.deepEqual([...shown].sort(), [...stripped].sort());
      assert.deepEqual([...askedPermissions(fx)].sort(), [...stripped].sort());
    });
  }

  test('the legacy flag beside a perms object is shown (it was dropped)', () => {
    assert.deepEqual([...inspectBmmpa({ tasks: [FIXTURES[0]] }).tasks[0].perms].sort(), ['command', 'deeplink', 'script']);
  });
});

describe('card 9: running or arming another task needs `tasks`', () => {
  const caseBody = (type) => {
    const at = SCHED_TS.indexOf(`case '${type}':`);
    assert.ok(at >= 0, `case '${type}' not found (renamed?)`);
    const next = SCHED_TS.indexOf('\n        case ', at + 10);
    return SCHED_TS.slice(at, next);
  };
  for (const [type, act] of [['task.run', 'runTaskById('], ['task.spawn', 'runTaskById('], ['task.setEnabled', 'setTaskEnabled(']]) {
    test(`${type} checks the grant before it acts`, () => {
      const body = caseBody(type);
      const gate = body.indexOf("requirePerm(task, 'tasks'");
      assert.ok(gate > 0, `${type} does not require 'tasks'`);
      const acts = body.indexOf(act);
      assert.ok(acts > gate, `${type} acts before (or without) the check`);
    });
  }

  test('every other list of the permissions is the whole vocabulary', () => {
    const bridge = readFileSync(join(ROOT, 'src-tauri/src/mcp/state_bridge.rs'), 'utf8').match(/TASK_PERM_KEYS: \[&str; \d+\] = \[([^\]]*)\]/);
    assert.ok(bridge, 'TASK_PERM_KEYS not found in state_bridge.rs');
    assert.deepEqual([...bridge[1].matchAll(/"(\w+)"/g)].map((m) => m[1]).sort(), VOCAB, 'MCP creation defaults');
    const gen = readFileSync(join(ROOT, 'scripts/gen-bmms-reference.mjs'), 'utf8').match(/permissions: \[([^\]]*)\]/);
    assert.ok(gen, 'the vocabulary permissions list not found in gen-bmms-reference.mjs');
    assert.deepEqual([...gen[1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort(), VOCAB, 'bmms-vocabulary.json');
    const reset = SCHED_TS.match(/perms: \{ (command: false[^}]*)\}/);
    assert.ok(reset, "sanitiseImportedTask's reset not found");
    assert.deepEqual([...reset[1].matchAll(/(\w+): false/g)].map((m) => m[1]).sort(), VOCAB, 'the import must reset every grant');
    const rows = [...SCHED_TS.matchAll(/\$\{row\('(\w+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(rows, VOCAB, 'the permission editor must offer every grant');
  });
});
