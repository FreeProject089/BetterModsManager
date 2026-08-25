// Reading a preset catalog, against the COMPILED module.
//
// A preset entry ends in a download. Every assertion here is about not handing an address
// to a fetcher without having looked at it, and about not showing a row somebody cannot
// act on.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parsePresetFeed, looksLikePresetFeed, resolveEntryUrl } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/features/settings/preset-catalog.js')).href
);

const feed = (presets) => ({ version: '1.0', name: 'idx', presets });
const ok = (over = {}) => ({ id: 'p1', name: 'Nightly sync', description: 'd', author: 'a', version: '1.0', download_url: 'https://e.com/p.bmmpa', tags: ['x'], ...over });

describe('parsePresetFeed', () => {
  test('keeps a well-formed entry with everything it was given', () => {
    const { presets, dropped } = parsePresetFeed(feed([ok({ tasks: 3 })]), 'https://e.com/c.json');
    assert.equal(dropped.length, 0);
    assert.deepEqual(presets[0], {
      id: 'p1', name: 'Nightly sync', description: 'd', author: 'a', version: '1.0',
      downloadUrl: 'https://e.com/p.bmmpa', tags: ['x'], tasks: 3, source: 'https://e.com/c.json',
    });
  });

  test('drops a download address that is not http(s)', () => {
    // The entry ends in a fetch. A file:// or javascript: address in a list that gets
    // downloaded is the obvious attack.
    for (const download_url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/json,{}', 'ftp://e.com/p.bmmpa', '']) {
      const { presets } = parsePresetFeed(feed([ok({ download_url })]));
      assert.equal(presets.length, 0, `${download_url} was kept`);
    }
  });

  test('drops an entry nobody could install, and says why', () => {
    // A row you cannot act on makes the list look broken rather than the entry.
    const { presets, dropped } = parsePresetFeed(feed([ok({ download_url: '' }), ok({ id: '' })]));
    assert.equal(presets.length, 0);
    assert.equal(dropped.length, 2);
    assert.match(dropped[0], /no usable download address/);
  });

  test('a missing task count is undefined, not zero', () => {
    // "The publisher did not say" and "it contains nothing" are different claims, and
    // showing the first as the second would misrepresent somebody else's work.
    const { presets } = parsePresetFeed(feed([ok()]));
    assert.equal(presets[0].tasks, undefined);
    const { presets: p2 } = parsePresetFeed(feed([ok({ tasks: 0 })]));
    assert.equal(p2[0].tasks, 0);
  });

  test('collapses a duplicate id, first wins', () => {
    const { presets, dropped } = parsePresetFeed(feed([ok({ name: 'first' }), ok({ name: 'second' })]));
    assert.equal(presets.length, 1);
    assert.equal(presets[0].name, 'first');
    assert.equal(dropped.length, 1);
  });

  test('accepts both spellings of the download field', () => {
    // BCWEB emits download_url; a hand-written feed may well use downloadUrl. Refusing one
    // would be a rule with no purpose behind it.
    const { presets } = parsePresetFeed(feed([{ id: 'a', name: 'A', downloadUrl: 'https://e.com/a.bmmpa' }]));
    assert.equal(presets.length, 1);
  });

  test('falls back to the id when there is no name', () => {
    const { presets } = parsePresetFeed(feed([{ id: 'only-an-id', download_url: 'https://e.com/a.bmmpa' }]));
    assert.equal(presets[0].name, 'only-an-id');
  });

  test('survives anything that is not a feed', () => {
    for (const junk of [null, undefined, 0, 'nope', [], {}, { presets: 'no' }, { presets: [null, 5] }]) {
      const { presets } = parsePresetFeed(junk);
      assert.deepEqual(presets, [], `${JSON.stringify(junk)} produced entries`);
    }
  });
});

describe('looksLikePresetFeed', () => {
  test('separates "wrong kind" from "empty"', () => {
    // Two different things to be told. Reporting a plugin catalog as an empty preset
    // catalog sends somebody looking for a problem that is not there.
    assert.equal(looksLikePresetFeed({ presets: [] }), true);
    assert.equal(looksLikePresetFeed({ plugins: [] }), false);
    assert.equal(looksLikePresetFeed({ apps: [] }), false);
    assert.equal(looksLikePresetFeed(null), false);
  });
});


describe('resolveEntryUrl — a catalog that ships its files beside it', () => {
  const CAT = 'https://raw.githubusercontent.com/me/tasks/main/catalog.json';

  test('a bare filename resolves against the catalog', () => {
    assert.equal(resolveEntryUrl('nightly.bmmpa', CAT),
      'https://raw.githubusercontent.com/me/tasks/main/nightly.bmmpa');
  });

  test('a subfolder resolves too', () => {
    assert.equal(resolveEntryUrl('packs/nightly.bmmpa', CAT),
      'https://raw.githubusercontent.com/me/tasks/main/packs/nightly.bmmpa');
  });

  test('an absolute address is left exactly as it is', () => {
    assert.equal(resolveEntryUrl('https://elsewhere.example/x.bmmpa', CAT),
      'https://elsewhere.example/x.bmmpa');
  });

  test('javascript: is refused even though resolving it "succeeds"', () => {
    // The trap: `new URL` gives an absolute URL its own scheme regardless of the base, so
    // this comes OUT of resolution unchanged. Checking the input and trusting the output
    // would pass it straight to the fetcher.
    assert.equal(resolveEntryUrl('javascript:alert(1)', CAT), '');
    assert.equal(resolveEntryUrl('file:///C:/windows/system32/x', CAT), '');
    assert.equal(resolveEntryUrl('data:text/plain,hi', CAT), '');
  });

  test('a relative name in a catalog read off disk resolves to nothing', () => {
    // There is no base. Inventing one would turn a name in a downloaded document into a
    // path on this machine.
    assert.equal(resolveEntryUrl('nightly.bmmpa', 'C:/Users/me/catalog.json'), '');
    assert.equal(resolveEntryUrl('nightly.bmmpa', ''), '');
  });

  test('the feed parser uses it, so a relative entry survives', () => {
    const { presets, dropped } = parsePresetFeed(
      { presets: [{ id: 'p1', name: 'Nightly', download_url: 'nightly.bmmpa' }] }, CAT);
    assert.equal(dropped.length, 0);
    assert.equal(presets[0].downloadUrl,
      'https://raw.githubusercontent.com/me/tasks/main/nightly.bmmpa');
  });

  test('…and a relative entry with no base is still dropped, not shown', () => {
    const { presets, dropped } = parsePresetFeed(
      { presets: [{ id: 'p1', name: 'Nightly', download_url: 'nightly.bmmpa' }] }, '');
    assert.equal(presets.length, 0);
    assert.equal(dropped.length, 1);
  });
});
