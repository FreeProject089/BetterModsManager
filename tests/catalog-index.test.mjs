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
const { parseCatalogIndex, planImport, INDEX_TYPES, STORE_KEY, ROUTABLE, looksLikeIndex, hasSource, addSource } = await import(
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
    //
    // `preset` used to be in this list, with a comment explaining that it had no store to
    // route it to. It has one now, so it belongs in the accepted set — the rule was never
    // "preset is not a real type", it was "do not accept what you cannot deliver", and the
    // second half of that changed.
    for (const type of ['plugins', 'repos', 'themes', '', null, 5, {}]) {
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

  test('a type MISSING from `existing` reports everything as new', () => {
    // Not a bug in planImport — a trap for its callers, and one that was live. The importer
    // built `existing` for plugin and theme only, so preset and repo catalogs you already
    // followed were previewed as "will add" and then counted as added. Pinned so the shape of
    // the mistake is written down somewhere.
    const { index } = parseCatalogIndex(doc([{ type: 'preset', url: 'https://e.com/p.json' }]));
    assert.equal(planImport(index, { plugin: [], theme: [] }).add.length, 1);
    assert.equal(planImport(index, { preset: ['https://e.com/p.json'] }).already.length, 1);
  });
});

describe('hasSource / addSource — the preview and the writer must agree', () => {
  test('differing only in case is the SAME source', () => {
    // THE ONE. The preview lowercased and the writer used Array.includes, so a URL differing
    // only in case was announced as already-followed and then appended anyway — a duplicate
    // fetched on every start and visible on no screen.
    assert.equal(hasSource(['https://E.com/A.json'], 'https://e.com/a.json'), true);
    const list = ['https://E.com/A.json'];
    assert.equal(addSource(list, 'https://e.com/a.json'), false);
    assert.equal(list.length, 1);
  });

  test('a genuinely new source is appended, and says so', () => {
    const list = ['https://e.com/a.json'];
    assert.equal(addSource(list, 'https://e.com/b.json'), true);
    assert.deepEqual(list, ['https://e.com/a.json', 'https://e.com/b.json']);
  });

  test('planImport asks the same question, so the two cannot drift', () => {
    const { index } = parseCatalogIndex(doc([{ type: 'plugin', url: 'https://e.com/p.json' }]));
    const existing = { plugin: ['HTTPS://E.COM/P.JSON'] };
    assert.equal(planImport(index, existing).already.length, 1);
    assert.equal(addSource(existing.plugin, 'https://e.com/p.json'), false);
  });
});

describe('which app an entry is for', () => {
  const mixed = () => doc([
    { type: 'plugin', url: 'https://e.com/bmm.json', app: 'bmm' },
    { type: 'theme', url: 'https://e.com/bsm.json', app: 'bsm' },
    { type: 'app', url: 'https://e.com/anyone.json' },
  ]);

  test('drops what another product published', () => {
    // An index lists catalogs for every Better* product. Pulling a BSM theme catalog into
    // BMM puts things in front of people that their app cannot install.
    const { index } = parseCatalogIndex(mixed(), 'bmm');
    assert.deepEqual(index.catalogs.map((c) => c.url), ['https://e.com/bmm.json', 'https://e.com/anyone.json']);
  });

  test('keeps an entry that names no app at all', () => {
    // Absent means "nobody said" — the state of every catalog published before the field
    // existed. Dropping those would empty the index for the people using it longest.
    const { index } = parseCatalogIndex(doc([{ type: 'app', url: 'https://e.com/x.json' }]), 'bmm');
    assert.equal(index.catalogs.length, 1);
    assert.equal('app' in index.catalogs[0], false);
  });

  test('says which app it dropped it for, not just that it did', () => {
    const { dropped } = parseCatalogIndex(mixed(), 'bmm');
    assert.equal(dropped.length, 1);
    assert.match(dropped[0], /for bsm, not bmm/);
  });

  test('matches the app case-insensitively', () => {
    const { index } = parseCatalogIndex(doc([{ type: 'app', url: 'https://e.com/x.json', app: 'BMM' }]), 'bmm');
    assert.equal(index.catalogs.length, 1);
    assert.equal(index.catalogs[0].app, 'bmm');
  });
});

describe('the two types the feed gained', () => {
  test('repo and preset are accepted, not thrown away', () => {
    // Both were already being published while the reader refused them — a failure that
    // looks like the server not sending them.
    const { index } = parseCatalogIndex(doc([
      { type: 'repo', url: 'https://e.com/repos.json', app: 'bmm' },
      { type: 'preset', url: 'https://e.com/presets.json', app: 'bmm' },
    ]), 'bmm');
    assert.deepEqual(index.catalogs.map((c) => c.type), ['repo', 'preset']);
  });

  test('every accepted type has somewhere to go', () => {
    // The guard against INDEX_TYPES and STORE_KEY drifting apart: a type the parser keeps
    // with no store is dropped by the CALLER instead, which looks identical to the server
    // never sending it. 'app' is the one exception — a backend command, not a local store.
    assert.deepEqual([...ROUTABLE], [...INDEX_TYPES], 'a type is accepted with nowhere to route it');
    for (const t of INDEX_TYPES) {
      assert.ok(t === 'app' || STORE_KEY[t], `${t} has no store`);
    }
  });
});

describe('telling an index from a catalog', () => {
  test('recognises one BCWEB sends', () => {
    assert.equal(looksLikeIndex({ kind: 'catalog-index', catalogs: [{ type: 'app', url: 'https://e.com/a.json' }] }), true);
  });

  test('recognises a hand-written one with no kind field', () => {
    // Self-declaration is enough on its own but must not be required, or only our own
    // server could publish an index.
    assert.equal(looksLikeIndex({ version: '1.0', catalogs: [{ type: 'plugin', url: 'https://e.com/p.json' }] }), true);
  });

  test('does NOT mistake a real catalog for one', () => {
    // The expensive direction. Misidentifying a working app catalog would take a source
    // away from somebody and tell them it was the wrong kind of file.
    for (const doc of [
      { version: '1.0', name: 'x', apps: [{ id: 'a', download: { url: 'u' } }] },
      { version: '1.0', plugins: [{ id: 'p' }] },
      { version: '1.0', themes: [] },
      { version: '1.0', presets: [{ id: 'q' }] },
    ]) {
      assert.equal(looksLikeIndex(doc), false, `${JSON.stringify(doc).slice(0, 40)} was called an index`);
    }
  });

  test('a bare mention of "catalogs" is not an index', () => {
    // A document that lists catalog NAMES is not one that lists their addresses. Requiring
    // both url and type on every entry is what separates them.
    assert.equal(looksLikeIndex({ catalogs: ['one', 'two'] }), false);
    assert.equal(looksLikeIndex({ catalogs: [{ name: 'one' }] }), false);
    assert.equal(looksLikeIndex({ catalogs: [{ url: 'https://e.com/a.json' }] }), false);
    assert.equal(looksLikeIndex({ catalogs: [] }), false);
  });

  test('one bad entry disqualifies the document', () => {
    // every(), not some(): a catalog feed that happened to carry one index-shaped object
    // would otherwise be adopted whole.
    assert.equal(looksLikeIndex({ catalogs: [{ type: 'app', url: 'https://e.com/a.json' }, { name: 'not an entry' }] }), false);
  });

  test('survives anything that is not an object', () => {
    for (const junk of [null, undefined, 0, '', 'catalogs', [], [{ type: 'app', url: 'u' }]]) {
      assert.equal(looksLikeIndex(junk), false, `${JSON.stringify(junk)} was called an index`);
    }
  });
});
