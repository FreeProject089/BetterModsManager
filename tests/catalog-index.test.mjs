// Reading a catalog index, against the COMPILED module.
//
// The document comes from whatever server the user pasted a URL for, so every assertion
// here is about refusing something rather than accepting it. The one thing this must
// never do is hand a URL it did not check to something that will fetch it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parseCatalogIndex, planImport, INDEX_TYPES } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/features/catalogs/catalog-index.js')).href
);

const doc = (catalogs) => ({ version: '1.0', name: 'idx', catalogs });

describe('parseCatalogIndex', () => {
  test('keeps a well-formed entry of each routable type', () => {
    const { index, dropped } = parseCatalogIndex(doc([
      { type: 'app', url: 'https://e.com/a.json', name: 'A' },
      { type: 'plugin', url: 'https://e.com/p.json' },
      { type: 'theme', url: 'http://localhost:5176/t.json' },
    ]));
    assert.equal(index.catalogs.length, 3);
    assert.deepEqual(index.catalogs.map((c) => c.type), ['app', 'plugin', 'theme']);
    assert.deepEqual(dropped, []);
  });

  test('drops a url that is not http(s)', () => {
    // The attack this exists for: an index is a list of addresses handed to a fetcher.
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/json,{}', 'ftp://e.com/a.json', '']) {
      const { index } = parseCatalogIndex(doc([{ type: 'app', url }]));
      assert.equal(index.catalogs.length, 0, `${url} was kept`);
    }
  });

  test('drops an unknown type instead of guessing it', () => {
    // "plugins" looks like "plugin"; guessing is how a preset catalog lands in themes.
    // `preset` is in the feed's vocabulary but has no store to route it to, so it is
    // dropped here rather than accepted and then lost by the caller.
    for (const type of ['plugins', 'preset', 'PRESET', '', null, 5, {}]) {
      const { index } = parseCatalogIndex(doc([{ type, url: 'https://e.com/a.json' }]));
      assert.equal(index.catalogs.length, 0, `type ${JSON.stringify(type)} was kept`);
    }
  });

  test('normalises case and stray whitespace, which are formatting not meaning', () => {
    // This test started life asserting that 'app ' was DROPPED, and it failed — correctly.
    // A trailing space in a JSON field is an artefact of whoever wrote the file, not a
    // different type, and dropping it would be the same guessing the test above forbids,
    // pointed the other way.
    for (const type of ['APP', 'app ', ' App']) {
      const { index } = parseCatalogIndex(doc([{ type, url: 'https://e.com/a.json' }]));
      assert.equal(index.catalogs[0]?.type, 'app', `type ${JSON.stringify(type)} was dropped`);
    }
  });

  test('never carries `official` through, whatever the document claims', () => {
    // Trust in BMM comes from the source URL — apply_trust overrides what a catalog says.
    // An index that could grant it would be a way around that, not an extension of it.
    const { index } = parseCatalogIndex(doc([{ type: 'app', url: 'https://e.com/a.json', official: true }]));
    assert.equal('official' in index.catalogs[0], false);
  });

  test('collapses a duplicate url, keeping the first', () => {
    const { index, dropped } = parseCatalogIndex(doc([
      { type: 'app', url: 'https://e.com/a.json', name: 'first' },
      { type: 'app', url: 'HTTPS://E.COM/A.JSON', name: 'second' },
    ]));
    assert.equal(index.catalogs.length, 1);
    assert.equal(index.catalogs[0].name, 'first');
    assert.equal(dropped.length, 1);
  });

  test('survives a document that is not an index at all', () => {
    for (const junk of [null, undefined, 42, 'nope', [], {}, { catalogs: 'no' }, { catalogs: [null, 3] }]) {
      const { index } = parseCatalogIndex(junk);
      assert.deepEqual(index.catalogs, [], `${JSON.stringify(junk)} produced entries`);
    }
  });

  test('says what it dropped, rather than dropping silently', () => {
    const { dropped } = parseCatalogIndex(doc([{ type: 'nope', url: 'https://e.com/x.json' }]));
    assert.equal(dropped.length, 1);
    assert.match(dropped[0], /unknown type/);
  });
});

describe('planImport', () => {
  test('separates what is new from what is already there', () => {
    const { index } = parseCatalogIndex(doc([
      { type: 'plugin', url: 'https://e.com/p1.json' },
      { type: 'plugin', url: 'https://e.com/p2.json' },
    ]));
    const { add, already } = planImport(index, { plugin: ['https://E.COM/p1.json'] });
    assert.deepEqual(add.map((c) => c.url), ['https://e.com/p2.json']);
    assert.deepEqual(already.map((c) => c.url), ['https://e.com/p1.json']);
  });

  test('a type with no store yet is all-new, not an error', () => {
    const { index } = parseCatalogIndex(doc([{ type: 'theme', url: 'https://e.com/t.json' }]));
    assert.equal(planImport(index, {}).add.length, 1);
  });
});

test('INDEX_TYPES is the routable set, and nothing else', () => {
  // A type added here without a store to route it to would be accepted and then dropped
  // on the floor by the caller.
  assert.deepEqual([...INDEX_TYPES], ['app', 'plugin', 'theme']);
});
