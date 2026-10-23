// Reopening an app catalogue, and what the screen says is wrong with one.
//
// Both against the COMPILED module, like every other test here.
//
// `draftFromCatalog` exists because the Create screen could only build from nothing:
// publishing a catalogue was a one-way trip, and a typo in one entry meant reassembling all
// of them by hand — each with a URL, a size and a checksum.
//
// `draftProblems` exists because the three ways a catalogue is broken all parse: a duplicate
// id, an entry with no download URL, an entry with no title. The second one is the quiet one
// — every feed builder that reads a catalogue filters on `download.url` and says nothing,
// BCWEB's included.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The pure module, not the screen: apps-catalog.js reaches `window` through its import
// chain, so importing it here dies before a single assertion runs.
const { draftFromCatalog, draftProblems, entryProblems } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/features/apps/catalog-draft.js')).href
);

/** The lookup the screen wires to `t`. Here it is the fallback, verbatim. */
const say = (_k, f) => f;

const app = (over = {}) => ({
  id: 'a', title: 'A', category: 'utility', price: 'free', tags: [],
  download: { url: 'https://e/a.zip', file_type: 'zip' }, ...over,
});

describe('reopening a catalogue', () => {
  test('a BMM-native document comes back in, entries and all', () => {
    const d = draftFromCatalog({ name: 'N', description: 'D', apps: [app(), app({ id: 'b' })] });
    assert.equal(d.apps.length, 2);
    assert.equal(d.name, 'N');
  });

  test('a plugin or theme catalogue is refused BY NAME, not treated as empty', () => {
    // It is a real document and simply not this screen's. Reading it as an app catalogue
    // with no apps would look like "your file is empty", which is a different problem with
    // a different fix.
    assert.throws(() => draftFromCatalog({ name: 'N', plugins: [{ id: 'p' }] }),
      /errNoApps/);
  });

  test('something that is not a document at all is refused', () => {
    assert.throws(() => draftFromCatalog(null), /errNotJson/);
    assert.throws(() => draftFromCatalog('a string'), /errNotJson/);
  });
});

describe('what is wrong with a draft', () => {
  const P = (apps) => draftProblems({ name: '', description: '', partner_catalogs: [], community_imports: [], apps }, say);

  test('a clean catalogue has nothing to say', () => {
    assert.deepEqual(P([app(), app({ id: 'b' })]), []);
  });

  test('an entry with no download URL is reported — every reader drops it silently', () => {
    const out = P([app({ download: { url: '', file_type: 'zip' } })]);
    assert.equal(out.length, 1);
    assert.match(out[0], /a/);
  });

  test('a duplicated id is reported once, with its count', () => {
    const out = P([app(), app(), app()]);
    assert.equal(out.length, 1, 'one line about the id, not one per copy');
    assert.match(out[0], /3/);
  });

  test('an entry with no id is reported and not counted as a duplicate of the other one', () => {
    const out = P([app({ id: '' }), app({ id: '' })]);
    assert.equal(out.length, 2, 'two entries with no id are two problems, not one duplicate');
  });

  test('a missing title is its own line', () => {
    const out = P([app({ title: '' })]);
    assert.equal(out.length, 1);
  });
});

// `isPlainHttp` lives in the screen module, which cannot be imported here — so this is the
// same rule, asserted against the same regex, to pin what "plain http" means. It decides
// which rows carry the amber marker, and getting it wrong in either direction is bad: a
// false positive shouts at an https source, a false negative hides the one case that
// matters.
describe('what counts as plain http', () => {
  const isPlainHttp = (url) => /^http:\/\//i.test((url || '').trim());

  test('http is http, in any casing, with stray spaces', () => {
    assert.equal(isPlainHttp('http://box.local/catalog.json'), true);
    assert.equal(isPlainHttp('HTTP://BOX/catalog.json'), true);
    assert.equal(isPlainHttp('  http://box/c.json  '), true);
  });

  test('https is not — and neither is a name that merely starts with the letters', () => {
    assert.equal(isPlainHttp('https://example.com/c.json'), false);
    // The trap in a `startsWith('http')` check, which is what the add-source box uses to
    // decide a URL is valid at all.
    assert.equal(isPlainHttp('httpsomething://x'), false);
  });

  test('nothing at all is not http', () => {
    assert.equal(isPlainHttp(''), false);
    assert.equal(isPlainHttp(undefined), false);
  });
});


describe('one entry, checked before it is saved', () => {
  test('a chosen FILE is a source — it used to be reported as a missing URL', () => {
    // The whole point of "use a file instead": the file is packed in when the catalogue is
    // published as one file, and the address is written at that moment. Calling that "no
    // download URL — every reader drops this entry silently" is alarming, wrong, and
    // unfixable without undoing what the author meant to do.
    const p = entryProblems(app({ download: { url: '' }, src_file: 'C:/dl/setup.exe' }), say);
    assert.equal(p.filter((x) => x.key === 'apps.create.pbNoUrl').length, 0);
    // It is still worth saying that a plain catalog.json names no address for it.
    assert.equal(p.filter((x) => x.key === 'apps.create.pbFileOnly').length, 1);
  });

  test('neither an address nor a file IS the problem it always was', () => {
    const p = entryProblems(app({ download: { url: '' } }), say);
    assert.equal(p.filter((x) => x.key === 'apps.create.pbNoUrl').length, 1);
    assert.equal(p.filter((x) => x.key === 'apps.create.pbFileOnly').length, 0);
  });

  test('an entry with an address says nothing at all', () => {
    assert.deepEqual(entryProblems(app(), say), []);
  });

  test('each problem names the input that fixes it', () => {
    const p = entryProblems({ id: '', title: '', download: { url: '' } }, say);
    const fields = p.map((x) => x.field).sort();
    assert.deepEqual(fields, ['dl-url', 'id', 'title']);
  });

  test('the page list and the editor cannot disagree, because one calls the other', () => {
    // A file-only entry must not be a problem on the page either — that was the bug.
    const draft = { name: 'c', description: '', partner_catalogs: [], community_imports: [],
      apps: [app({ download: { url: '' }, src_file: 'C:/dl/a.exe' })] };
    const said = draftProblems(draft, say);
    assert.equal(said.filter((x) => x.includes('every reader drops')).length, 0);
  });
});
