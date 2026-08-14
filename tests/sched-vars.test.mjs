// Run-time variable substitution, against the COMPILED module.
//
// The bug this replaces: the run context was Record<string, number>, so a script's output
// was captured as a NUMBER — and a non-numeric line fell back to the string's LENGTH.
// A script returning "C:\mods\out" gave you 11, every comparison against it was true or
// false by accident, and there was no way to get the string itself back. `{var}` now
// substitutes the text a step actually produced.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { substituteVars } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/features/settings/sched-vars.js')).href
);

const ctx = {
  nums: { count: 3, ratio: 1.5 },
  text: { outPath: 'C:\\mods\\out', count: '3', listing: 'a.zip\nb.zip' },
};

describe('substituteVars', () => {
  test('substitutes the captured text, which is the point', () => {
    assert.equal(substituteVars({ path: '{outPath}' }, ctx).path, 'C:\\mods\\out');
  });

  test('text wins over the number when a name has both', () => {
    // The number is a derived convenience for conditions; the text is what the step said.
    assert.equal(substituteVars({ m: 'got {count}' }, ctx).m, 'got 3');
  });

  test('a number-only variable still substitutes', () => {
    assert.equal(substituteVars({ m: '{ratio}x' }, ctx).m, '1.5x');
  });

  test('multi-line output survives whole', () => {
    // First-line-only was a limit inherited from needing one number. Listing three files
    // is a normal thing to want.
    assert.equal(substituteVars({ m: '{listing}' }, ctx).m, 'a.zip\nb.zip');
  });

  test('an unknown name is left exactly as written, never blanked', () => {
    // Silently emptying a parameter is how a task deletes the wrong folder.
    assert.equal(substituteVars({ p: 'C:\\{nope}\\x' }, ctx).p, 'C:\\{nope}\\x');
  });

  test('{item.x} is left for the for-each that owns it', () => {
    // Eating it here would resurrect the nested-loop bug substituteItem exists to fix.
    assert.equal(substituteVars({ m: '{item.name}' }, ctx).m, '{item.name}');
  });

  test('walks nested objects and arrays, and leaves non-strings alone', () => {
    const out = substituteVars({ a: ['{count}', 7], o: { deep: '{outPath}' }, n: 42, b: true }, ctx);
    assert.deepEqual(out.a, ['3', 7]);
    assert.equal(out.o.deep, 'C:\\mods\\out');
    assert.equal(out.n, 42);
    assert.equal(out.b, true);
  });

  test('does not mutate the saved task definition', () => {
    // action.params is the stored task; rewriting it would bake one run's values into it.
    const params = { path: '{outPath}' };
    substituteVars(params, ctx);
    assert.equal(params.path, '{outPath}');
  });

  test('an empty context substitutes nothing rather than blanking everything', () => {
    const empty = { nums: {}, text: {} };
    assert.equal(substituteVars({ p: '{outPath}' }, empty).p, '{outPath}');
  });
});

describe('shared variables', () => {
  // Variables that outlive a run. The precedence is the whole risk: a stored value that
  // shadowed a fresh capture would make a task read another task's leftovers, and the
  // symptom is a script that looks like it is misbehaving.
  const withShared = {
    nums: { count: 3 },
    text: { path: 'C:\fresh' },
    shared: { path: 'C:\stale', token: 'abc123', count: '999' },
  };

  test('a shared value is substituted when nothing this run captured that name', () => {
    assert.equal(substituteVars({ h: 'Bearer {token}' }, withShared).h, 'Bearer abc123');
  });

  test("this run's capture beats a stored value with the same name", () => {
    assert.equal(substituteVars({ p: '{path}' }, withShared).p, 'C:\fresh');
  });

  test("this run's NUMBER also beats a stored value", () => {
    // text → nums → shared. A number captured this run is still this run's.
    assert.equal(substituteVars({ c: '{count}' }, withShared).c, '3');
  });

  test('a context with no shared bag behaves exactly as before', () => {
    // The field is optional: every existing caller passes two bags and must keep working.
    assert.equal(substituteVars({ p: '{token}' }, { nums: {}, text: {} }).p, '{token}');
  });

  test('an unknown name is still left alone, not blanked', () => {
    assert.equal(substituteVars({ p: '{nope}' }, withShared).p, '{nope}');
  });
});
