// Publishing a catalogue: one decision per entry, against the COMPILED module.
//
// The feature this pins is the MIX — pack the three small ones, link the 90 MB one, in the
// same catalogue. Every builder in BMM used to answer that question once for the whole
// document, in two different ways, and neither could express it.
//
// The two things that go wrong here are only visible once somebody ELSE follows the
// catalogue: the filename a name collapses to, and the address written for it. By then it is
// far too late, which is why they are tested and not eyeballed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { planPublish, canBundle, safeFileStem } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/core/catalog-publish.js')).href
);

const embed = () => ({ mode: 'embed' });
const link = (url) => () => ({ mode: 'link', url });

describe('safeFileStem', () => {
  test('a name that is a path becomes a filename', () => {
    // `a/b` would write into a directory instead of beside its catalogue.
    assert.equal(safeFileStem('a/b'), 'a-b');
    assert.equal(safeFileStem('a\\b'), 'a-b');
    // Character-for-character, NOT collapsed: tests/task-catalog.test.mjs pins this, and
    // the filenames it produces are already named inside published catalogues.
    assert.equal(safeFileStem('why? *this*'), 'why---this');   // ? and space and * — three
  });

  test('leading dots go — a hidden file is one the exporter will not find again', () => {
    assert.equal(safeFileStem('.hidden'), 'hidden');
    assert.equal(safeFileStem('  spaced  out '), 'spaced-out');
  });

  test('a name that collapses to nothing falls back rather than producing ".ext"', () => {
    assert.equal(safeFileStem('///'), 'entry');
    assert.equal(safeFileStem(''), 'entry');
    assert.equal(safeFileStem(null, 'automation'), 'automation');
  });
});

describe('planPublish', () => {
  const items = [{ id: 'a', name: 'Nightly' }, { id: 'b', name: 'Big' }];

  test('embed writes a relative name — the folder survives being moved', () => {
    const p = planPublish(items, embed, { ext: 'bmmpa' });
    assert.deepEqual(p.rows.map((r) => r.address), ['Nightly.bmmpa', 'Big.bmmpa']);
    assert.deepEqual(p.rows.map((r) => r.file), ['Nightly.bmmpa', 'Big.bmmpa']);
    assert.equal(p.embedded, 2);
    assert.equal(p.linked, 0);
  });

  test('link carries the URL and writes nothing', () => {
    const p = planPublish(items, link('https://cdn.test/x.bmmpa'), { ext: 'bmmpa' });
    assert.deepEqual(p.rows.map((r) => r.address), ['https://cdn.test/x.bmmpa', 'https://cdn.test/x.bmmpa']);
    assert.deepEqual(p.rows.map((r) => r.file), ['', '']);
    assert.equal(p.embedded, 0);
    assert.equal(p.linked, 2);
  });

  test('THE MIX: embedded and linked entries in one catalogue', () => {
    // The whole point of the module.
    const p = planPublish(items, (i) => (i.id === 'a' ? { mode: 'embed' } : { mode: 'link', url: 'https://cdn.test/big.bmmpa' }), { ext: 'bmmpa' });
    assert.equal(p.embedded, 1);
    assert.equal(p.linked, 1);
    assert.deepEqual(p.rows.map((r) => r.address), ['Nightly.bmmpa', 'https://cdn.test/big.bmmpa']);
    // Only the embedded one is a file to write.
    assert.deepEqual(p.rows.filter((r) => r.embed).map((r) => r.file), ['Nightly.bmmpa']);
  });

  test('a base prefixes only the EMBEDDED entries', () => {
    // A linked entry already said where it lives; prefixing it would rewrite somebody
    // else's address into one on your own host.
    const p = planPublish(items, (i) => (i.id === 'a' ? { mode: 'embed' } : { mode: 'link', url: 'https://cdn.test/big.bmmpa' }),
      { ext: 'bmmpa', base: 'https://me.test/cat/' });
    assert.deepEqual(p.rows.map((r) => r.address), ['https://me.test/cat/Nightly.bmmpa', 'https://cdn.test/big.bmmpa']);
  });

  test('a linked entry with no address is refused BY NAME, not dropped', () => {
    // Dropping it publishes a shorter list than the one on screen, and nobody is told.
    const p = planPublish(items, (i) => (i.id === 'a' ? { mode: 'embed' } : { mode: 'link', url: '  ' }), { ext: 'bmmpa' });
    assert.equal(p.rows.length, 1);
    assert.equal(p.errors.length, 1);
    assert.ok(p.errors[0].includes('Big'), p.errors[0]);
  });

  test('a linked entry with a non-http address is refused, and the address is quoted', () => {
    const p = planPublish([{ id: 'x', name: 'Sneaky' }], link('file:///etc/passwd'), { ext: 'bmmpa' });
    assert.equal(p.rows.length, 0);
    assert.ok(p.errors[0].includes('Sneaky'));
    assert.ok(p.errors[0].includes('file:///etc/passwd'));
  });

  test('two entries that collapse to one filename get two files', () => {
    // `a/b` and `a b` are two names and one stem. The second silently overwriting the first
    // is a catalogue serving the wrong content under the right name.
    const p = planPublish([{ id: '1', name: 'a/b' }, { id: '2', name: 'a b' }, { id: '3', name: 'a?b' }], embed, { ext: 'bmmpa' });
    const files = p.rows.map((r) => r.file);
    assert.equal(new Set(files).size, 3, files.join(', '));
    assert.deepEqual(files, ['a-b.bmmpa', 'a-b-2.bmmpa', 'a-b-3.bmmpa']);
  });

  test('the extension is taken as given, with or without its dot', () => {
    assert.equal(planPublish([{ id: 'a', name: 'A' }], embed, { ext: '.bmmplug' }).rows[0].file, 'A.bmmplug');
    assert.equal(planPublish([{ id: 'a', name: 'A' }], embed, { ext: 'bmmtut' }).rows[0].file, 'A.bmmtut');
  });

  test('an entry with no name falls back to its id', () => {
    assert.equal(planPublish([{ id: 'only-an-id' }], embed, { ext: 'bmmpa' }).rows[0].file, 'only-an-id.bmmpa');
  });
});

describe('canBundle', () => {
  test('a catalogue of nothing but links cannot be packed', () => {
    // A zip holding one catalog.json is not a bundle, it is a catalog.json somebody has to
    // unzip first.
    const p = planPublish([{ id: 'a', name: 'A' }], link('https://x.test/a.bmmpa'), { ext: 'bmmpa' });
    assert.equal(canBundle(p), false);
  });

  test('one embedded entry is enough', () => {
    const p = planPublish([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      (i) => (i.id === 'a' ? { mode: 'embed' } : { mode: 'link', url: 'https://x.test/b.bmmpa' }), { ext: 'bmmpa' });
    assert.equal(canBundle(p), true);
  });
});
