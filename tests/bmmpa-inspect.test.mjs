// Reading a .bmmpa without running it, against the COMPILED module.
//
// The property every assertion here defends: LOOKING at a shared automation must not be
// the automation happening, and the report must not be clean for a file that is not.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { inspectBmmpa, RISK_LABEL } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/features/settings/bmmpa-inspect.js')).href
);

const file = (tasks) => ({ magic: 'BMMPA', version: 1, exported: '2026-01-01T00:00:00Z', tasks });
const act = (type, params = {}) => ({ kind: 'action', action: { type, params } });

describe('what the file says it may do', () => {
  test('reports each granted permission in words', () => {
    const r = inspectBmmpa(file([{ name: 'T', perms: { script: true, stopProcess: true }, steps: [] }]));
    assert.deepEqual(r.tasks[0].perms.sort(), [RISK_LABEL.script, RISK_LABEL.stopProcess].sort());
    assert.equal(r.needsReview, true);
  });

  test('a task exported before permissions were split still reports what it grants', () => {
    // allowCustomCommands is the legacy single flag. Reporting "no permissions" for it
    // would be a lie of omission on exactly the oldest files in circulation.
    const r = inspectBmmpa(file([{ name: 'Old', allowCustomCommands: true, steps: [] }]));
    assert.ok(r.tasks[0].perms.includes(RISK_LABEL.command));
    assert.ok(r.tasks[0].perms.includes(RISK_LABEL.deeplink));
  });

  test('a task that asks for nothing and touches nothing needs no review', () => {
    const r = inspectBmmpa(file([{ name: 'Quiet', steps: [act('mods.scan')] }]));
    assert.equal(r.needsReview, false);
    assert.deepEqual(r.tasks[0].perms, []);
  });
});

describe('what it reaches outside BMM', () => {
  test('flags a dangerous action buried inside a loop', () => {
    // An inspector that only reads the top level produces a CLEAN report for a file that
    // is not clean — worse than no inspector, because it is trusted.
    const r = inspectBmmpa(file([{
      name: 'Nested',
      steps: [{
        kind: 'repeat', mode: 'times', times: 3,
        steps: [{ kind: 'if', condition: {}, then: [act('custom.script', { engine: 'python', code: 'print(1)' })], else: [] }],
      }],
    }]));
    assert.ok(r.tasks[0].reaching.length > 0, 'the nested script was not flagged');
    assert.equal(r.tasks[0].scripts.length, 1);
    assert.equal(r.tasks[0].scripts[0].engine, 'python');
  });

  test('walks every branch a step can hold', () => {
    for (const key of ['then', 'else', 'onError', 'steps', 'default']) {
      const r = inspectBmmpa(file([{ name: 'B', steps: [{ kind: 'try', [key]: [act('app.stop', { name: 'x.exe' })] }] }]));
      assert.ok(r.tasks[0].reaching.length > 0, `a step hidden in "${key}" was missed`);
    }
    const sw = inspectBmmpa(file([{ name: 'S', steps: [{ kind: 'switch', cases: [{ condition: {}, steps: [act('custom.command', { program: 'evil.exe' })] }] }] }]));
    assert.ok(sw.tasks[0].reaching.length > 0, 'a step inside a switch case was missed');
  });

  test('collects the script body so a reviewer can read the actual code', () => {
    const r = inspectBmmpa(file([{ name: 'S', steps: [act('custom.script', { engine: 'powershell', code: 'rm -r C:\\' })] }]));
    assert.equal(r.tasks[0].scripts[0].code, 'rm -r C:\\');
  });

  test('collects targets verbatim and does not resolve them', () => {
    // Fetching a URL to describe it would be the inspector doing the thing it exists to
    // avoid. The value is recorded exactly as written.
    const r = inspectBmmpa(file([{ name: 'U', steps: [act('open.url', { url: 'https://example.com/x?a=1' })] }]));
    assert.deepEqual(r.tasks[0].targets, ['https://example.com/x?a=1']);
  });
});

describe('malformed input', () => {
  test('refuses a document that is not one, with a reason', () => {
    for (const junk of [null, undefined, 42, 'nope', {}, { tasks: 'no' }, { tasks: [] }]) {
      const r = inspectBmmpa(junk);
      assert.equal(r.ok, false, `${JSON.stringify(junk)} was accepted`);
      assert.ok(r.error, 'no reason given');
    }
  });

  test('accepts a bare array, because the importer does', () => {
    // An inspector that refused a file the importer would take is not strict, it is
    // misleading — you would conclude the file was safe to import because it "failed".
    const r = inspectBmmpa([{ name: 'Bare', steps: [] }]);
    assert.equal(r.ok, true);
    assert.equal(r.tasks[0].name, 'Bare');
  });

  test('survives a task with nothing in it', () => {
    const r = inspectBmmpa(file([{}, { name: 'X' }]));
    assert.equal(r.ok, true);
    assert.equal(r.tasks[0].name, '(unnamed)');
    assert.equal(r.tasks[0].stepCount, 0);
  });

  test('names an unknown trigger rather than leaving a blank', () => {
    const r = inspectBmmpa(file([{ name: 'T', trigger: { type: 'wat' }, steps: [] }]));
    assert.match(r.tasks[0].trigger, /unknown trigger: wat/);
  });
});

test('counts every step, including nested ones', () => {
  const r = inspectBmmpa(file([{
    name: 'C',
    steps: [act('notify'), { kind: 'if', then: [act('mods.scan'), act('notify')], else: [act('notify')] }],
  }]));
  // 2 top-level + 3 inside = 5
  assert.equal(r.tasks[0].stepCount, 5);
});
