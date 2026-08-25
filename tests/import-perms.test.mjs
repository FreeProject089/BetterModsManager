// A shared automation cannot grant itself the right to run programs.
//
// The bug this pins was live, and it sat directly under the automation CATALOGUE: these
// files are meant to travel between strangers now. Importing one kept its `enabled`, its
// `perms` and its trigger — only `osSchedule` was cleared — so a `.bmmpa` could arrive
// enabled, granted `command` and `script`, on a one-minute interval, and start running
// programs a minute later with nothing asked and nothing shown.
//
// The duplicate button already reasoned correctly about a copy of your OWN task ("created
// DISABLED so saving the copy can't double-fire anything"). A file from a stranger did not
// get that treatment.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// scheduler.js needs a browser to load, so the sanitiser is read out of the compiled file
// as source and evaluated on its own. It has no dependencies — that is why it can be.
const { readFileSync } = await import('node:fs');
const js = readFileSync(join(ROOT, 'frontend/js/features/settings/scheduler.js'), 'utf8');
const start = js.indexOf('export function sanitiseImportedTask');
assert.ok(start > 0, 'sanitiseImportedTask must exist and be exported');
const end = js.indexOf('\n}', js.indexOf('return {', start)) + 2;
const src = js.slice(start, end).replace('export function', 'function') + '\nexport { sanitiseImportedTask };';
const { sanitiseImportedTask } = await import(
  'data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64')
);

/** The file an attacker would publish to a catalogue. */
const HOSTILE = {
  name: 'Nightly tidy',
  enabled: true,
  osSchedule: true,
  allowCustomCommands: true,
  perms: { command: true, script: true, deeplink: true, stopProcess: true },
  trigger: { type: 'interval', everyMinutes: 1 },
  steps: [{ kind: 'action', action: { type: 'custom.command', params: { program: 'calc.exe', args: '' } } }],
};

describe('sanitiseImportedTask', () => {
  test('an imported task never arrives enabled', () => {
    assert.equal(sanitiseImportedTask(HOSTILE).task.enabled, false);
  });

  test('every outside-BMM capability is taken away', () => {
    const { task } = sanitiseImportedTask(HOSTILE);
    assert.deepEqual(task.perms, { command: false, script: false, deeplink: false, stopProcess: false });
    assert.equal(task.allowCustomCommands, false, 'the legacy flag is a grant too');
  });

  test('the OS scheduled task is never registered on a file\'s say-so', () => {
    assert.equal(sanitiseImportedTask(HOSTILE).task.osSchedule, false);
  });

  test('it REPORTS what was asked for, so the person is not left wondering', () => {
    const { strippedPerms, wasEnabled } = sanitiseImportedTask(HOSTILE);
    assert.deepEqual([...strippedPerms].sort(), ['command', 'deeplink', 'script', 'stopProcess']);
    assert.equal(wasEnabled, true);
  });

  test('the legacy single flag alone is read as command + deeplink', () => {
    // A file written by an older BMM carries only `allowCustomCommands`. Reading `perms`
    // alone would report it as asking for nothing — the one case where being wrong is worst.
    const { strippedPerms } = sanitiseImportedTask({ name: 'old', allowCustomCommands: true });
    assert.deepEqual([...strippedPerms].sort(), ['command', 'deeplink']);
  });

  test('the automation itself is kept intact — this is not a rejection', () => {
    const { task } = sanitiseImportedTask(HOSTILE);
    assert.equal(task.name, 'Nightly tidy');
    assert.deepEqual(task.trigger, HOSTILE.trigger);
    assert.deepEqual(task.steps, HOSTILE.steps);
  });

  test('an honest task loses nothing it did not have', () => {
    const { strippedPerms, wasEnabled } = sanitiseImportedTask({ name: 'plain', steps: [] });
    assert.deepEqual(strippedPerms, []);
    assert.equal(wasEnabled, false);
  });
});
