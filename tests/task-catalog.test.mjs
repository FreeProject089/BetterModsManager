// Publishing a catalog of automations, against the COMPILED module.
//
// Everything here is about what somebody ELSE sees. A wrong filename or a wrong address is
// invisible on the machine that published it — the folder looks fine, the catalog opens,
// nothing complains. It fails for the first person who follows it, and by then the file is
// on GitHub.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { safeFileStem, planTaskCatalog } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/features/settings/task-catalog.js')).href
);
// The reader, so the round trip can be asserted end to end rather than assumed.
const { parsePresetFeed } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/features/settings/preset-catalog.js')).href
);

const task = (name, id = name) => ({ id, name, description: '' });

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
    assert.equal(safeFileStem(''), 'automation');
    assert.equal(safeFileStem(null), 'automation');
    assert.equal(safeFileStem('///'), 'automation');
  });

  test('a very long name is cut, not passed through', () => {
    assert.equal(safeFileStem('x'.repeat(200)).length, 60);
  });
});

describe('planTaskCatalog', () => {
  test('two automations with the SAME name get different files', () => {
    // The one that matters. Without it the second overwrites the first while the catalog
    // still lists both, so one entry silently serves the other's contents — which reads as
    // the wrong automation being published, not as a name clash.
    const p = planTaskCatalog([task('Nightly', 'a'), task('Nightly', 'b'), task('Nightly', 'c')]);
    assert.deepEqual(p.map((x) => x.stem), ['Nightly', 'Nightly-2', 'Nightly-3']);
    assert.equal(new Set(p.map((x) => x.entry.download_url)).size, 3);
  });

  test('names that COLLAPSE to the same stem also get different files', () => {
    // 'a/b' and 'a b' are different names and one filename. Deduping on the name rather than
    // on the stem would miss this entirely.
    const p = planTaskCatalog([task('a/b', '1'), task('a b', '2')]);
    assert.deepEqual(p.map((x) => x.stem), ['a-b', 'a-b-2']);
  });

  test('with no base, addresses are relative', () => {
    const p = planTaskCatalog([task('Nightly')]);
    assert.equal(p[0].entry.download_url, 'Nightly.bmmpa');
  });

  test('with a base, they are absolute and the trailing slash does not double up', () => {
    for (const base of ['https://cdn.example.com/t', 'https://cdn.example.com/t/', 'https://cdn.example.com/t///']) {
      const p = planTaskCatalog([task('Nightly')], base);
      assert.equal(p[0].entry.download_url, 'https://cdn.example.com/t/Nightly.bmmpa');
    }
  });

  test('the entry keeps the real name, even when the filename had to change', () => {
    const p = planTaskCatalog([task('a/b: the good one')]);
    assert.equal(p[0].entry.name, 'a/b: the good one');
    assert.notEqual(p[0].entry.id, p[0].entry.name);
  });

  test('an unnamed automation is still listed under something', () => {
    const p = planTaskCatalog([{ id: 'x', name: '', description: 'no name' }]);
    assert.equal(p[0].entry.name, 'automation');
  });
});

describe('the round trip — publish relative, host on GitHub, follow it back', () => {
  test('every entry resolves, and none is dropped', () => {
    const CAT = 'https://raw.githubusercontent.com/me/my-tasks/main/catalog.json';
    const plan = planTaskCatalog([task('Nightly tidy', '1'), task('Nightly tidy', '2'), task('a/b', '3')]);
    const doc = { version: '1.0', name: 'Mine', presets: plan.map((x) => x.entry) };

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
    const plan = planTaskCatalog([task('Nightly')]);
    const doc = { version: '1.0', name: 'Mine', presets: plan.map((x) => x.entry) };
    const { presets } = parsePresetFeed(doc, 'https://me.github.io/tasks/catalog.json');
    assert.equal(presets[0].downloadUrl, 'https://me.github.io/tasks/Nightly.bmmpa');
  });
});
