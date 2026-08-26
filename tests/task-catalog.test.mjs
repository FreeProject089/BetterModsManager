// Publishing a catalog of automations, against the COMPILED module.
//
// Everything here is about what somebody ELSE sees. A wrong filename or a wrong address is
// invisible on the machine that published it — the folder looks fine, the catalog opens,
// nothing complains. It fails for the first person who follows it, and by then the file is
// on GitHub.
//
// Deciding WHERE an entry lives moved to core/catalog-publish.ts when every kind of
// catalogue started sharing one screen, and tests/catalog-publish.test.mjs holds the
// deduplication and address rules now. What is asserted here is the part that stayed:
// the word an unnamed automation falls back to, the field names a preset feed uses, and the
// round trip — publish relative, host it anywhere, follow it back.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { safeFileStem, presetRow } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/features/settings/task-catalog.js')).href
);
const { planPublish } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/core/catalog-publish.js')).href
);
// The reader, so the round trip can be asserted end to end rather than assumed.
const { parsePresetFeed } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/features/settings/preset-catalog.js')).href
);

const task = (name, id = name) => ({ id, name, description: '' });

/** What the shared screen does for this kind, in one call. */
const plan = (tasks, base = '') =>
  planPublish(tasks, () => ({ mode: 'embed' }), {
    ext: 'bmmpa', base, fallback: 'automation', nameOf: (x) => String(x.name || ''),
  }).rows.map((r) => presetRow(r.item, r.address));

describe('safeFileStem', () => {
  test('a path separator cannot survive — it would write into a directory', () => {
    assert.equal(safeFileStem('a/b'), 'a-b');
    assert.equal(safeFileStem('a\\b'), 'a-b');
  });

  test('the characters Windows refuses outright', () => {
    // The trailing `*` becomes a dash and is then stripped with the rest of the trailing
    // junk — a filename ending in a separator is not something anybody meant to make.
    assert.equal(safeFileStem('why? <this> "one" *now*'), 'why---this---one---now');
  });

  test('leading dots go, or the file is hidden from the person who made it', () => {
    assert.equal(safeFileStem('...secret...'), 'secret');
  });

  test('an empty name falls back rather than producing ".bmmpa"', () => {
    // The WORD is this catalogue's, not the shared default: an automation listed as
    // "entry" is a downgrade in the one place a reader meets the fallback at all.
    assert.equal(safeFileStem(''), 'automation');
    assert.equal(safeFileStem(null), 'automation');
    assert.equal(safeFileStem('///'), 'automation');
  });

  test('a very long name is cut, not passed through', () => {
    assert.equal(safeFileStem('x'.repeat(200)).length, 60);
  });
});

describe('presetRow', () => {
  test('the entry keeps the real name, even when the filename had to change', () => {
    const r = presetRow(task('a/b: the good one'), 'a-b--the-good-one.bmmpa');
    assert.equal(r.name, 'a/b: the good one');
    assert.notEqual(r.id, r.name);
  });

  test('an unnamed automation is still listed under something', () => {
    // Never its id. A row called `t-lq3k2j` in a published catalogue helps nobody, and
    // that is exactly what falling through to the shared default would produce.
    assert.equal(plan([{ id: 'x', name: '', description: 'no name' }])[0].name, 'automation');
  });

  test('a packed entry takes its id from the deduplicated filename', () => {
    // Two automations with one name is the case that matters: without this the second
    // overwrites the first while the catalogue still lists both, so one entry silently
    // serves the other's contents.
    const rows = plan([task('Nightly', 'a'), task('Nightly', 'b'), task('Nightly', 'c')]);
    assert.deepEqual(rows.map((r) => r.id), ['Nightly', 'Nightly-2', 'Nightly-3']);
    assert.equal(new Set(rows.map((r) => r.download_url)).size, 3);
  });

  test('a LINKED entry has no filename to take an id from, so it uses its name', () => {
    const r = presetRow(task('Nightly tidy'), 'https://cdn.example.com/t/whatever.bmmpa');
    assert.equal(r.id, 'Nightly-tidy');
    assert.equal(r.download_url, 'https://cdn.example.com/t/whatever.bmmpa');
  });

  test('the field names a preset feed actually uses', () => {
    // Pinned rather than assumed: a renamed field publishes a catalogue that opens, lists
    // the right number of rows, and installs nothing.
    assert.deepEqual(Object.keys(presetRow(task('N'), 'N.bmmpa')).sort(),
      ['description', 'download_url', 'id', 'name', 'tasks', 'version']);
  });
});

describe('the round trip — publish relative, host on GitHub, follow it back', () => {
  test('every entry resolves, and none is dropped', () => {
    const CAT = 'https://raw.githubusercontent.com/me/my-tasks/main/catalog.json';
    const doc = { version: '1.0', name: 'Mine', presets: plan([task('Nightly tidy', '1'), task('Nightly tidy', '2'), task('a/b', '3')]) };

    const { presets, dropped } = parsePresetFeed(doc, CAT);
    assert.deepEqual(dropped, [], 'a catalog BMM wrote must be one BMM can read');
    assert.deepEqual(presets.map((p) => p.downloadUrl), [
      'https://raw.githubusercontent.com/me/my-tasks/main/Nightly-tidy.bmmpa',
      'https://raw.githubusercontent.com/me/my-tasks/main/Nightly-tidy-2.bmmpa',
      'https://raw.githubusercontent.com/me/my-tasks/main/a-b.bmmpa',
    ]);
  });

  test('the same folder moved to a different host still resolves', () => {
    // This is what relative addresses buy. Written once, followed from anywhere.
    const doc = { version: '1.0', name: 'Mine', presets: plan([task('Nightly')]) };
    const { presets } = parsePresetFeed(doc, 'https://me.github.io/tasks/catalog.json');
    assert.equal(presets[0].downloadUrl, 'https://me.github.io/tasks/Nightly.bmmpa');
  });
});
