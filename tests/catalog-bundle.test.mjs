// A catalog that carries its own files, against the COMPILED module.
//
// Everything here is about the one rule that matters: an entry inside a bundle is either a
// name INSIDE the archive or an http(s) URL, and nothing else. The archive came from
// somebody else, so every path in it is hostile input until proved otherwise — and the
// failure mode of getting this wrong is not a broken catalog, it is BMM opening a file it
// was never pointed at.
//
// The shapes below are the ones that get through a check written the obvious way: a scheme
// with no leading slash, a Windows drive letter, a UNC path, `..` buried mid-path, and a
// NUL truncating the name on its way to a syscall.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { bundleEntryKind, resolveBundleEntry, looksLikeCatalog, catalogEntryUrls } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/core/catalog-bundle.js')).href
);

describe('bundleEntryKind', () => {
  test('a bare name is inside the archive — the normal case', () => {
    assert.equal(bundleEntryKind('nightly.bmmpa'), 'inside');
    assert.equal(bundleEntryKind('files/nightly.bmmpa'), 'inside');
    assert.equal(bundleEntryKind('./nightly.bmmpa'), 'inside');
    // A filename may contain dots without being an escape attempt.
    assert.equal(bundleEntryKind('a..b.bmmpa'), 'inside');
  });

  test('http(s) is the other legal shape — a bundle may still point outward', () => {
    // The whole point: the small things travel with the catalog, the 400 MB one stays on
    // a CDN, and both are legal in the same document.
    assert.equal(bundleEntryKind('https://example.com/big.zip'), 'remote');
    assert.equal(bundleEntryKind('http://example.com/big.zip'), 'remote');
  });

  test('every other scheme is refused, not treated as a name', () => {
    for (const v of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/plain,x',
                     'bmm://profile/activate', 'FILE:///c:/windows', 'ftp://h/x']) {
      assert.equal(bundleEntryKind(v), 'rejected', v);
    }
  });

  test('absolute, UNC and drive-letter paths are refused', () => {
    for (const v of ['/etc/passwd', '\\\\server\\share\\x', 'C:\\Windows\\system32\\x',
                     'c:/windows/x', '/', '\\']) {
      assert.equal(bundleEntryKind(v), 'rejected', v);
    }
  });

  test('`..` is refused as a segment, on either separator', () => {
    for (const v of ['../secret', 'a/../../secret', 'a\\..\\..\\secret', '..', 'a/..']) {
      assert.equal(bundleEntryKind(v), 'rejected', v);
    }
  });

  test('control characters are refused', () => {
    // A NUL is the classic way to make a checked name and an opened name differ.
    assert.equal(bundleEntryKind('ok.bmmpa\u0000.png'), 'rejected');
    assert.equal(bundleEntryKind('ok\n.bmmpa'), 'rejected');
  });

  test('empty and non-strings are refused rather than coerced', () => {
    for (const v of ['', '   ', null, undefined, 0, {}, []]) {
      assert.equal(bundleEntryKind(v), 'rejected', JSON.stringify(v));
    }
  });
});

describe('resolveBundleEntry', () => {
  test('joins onto the directory BMM chose', () => {
    assert.equal(resolveBundleEntry('nightly.bmmpa', '/tmp/bundle'), '/tmp/bundle/nightly.bmmpa');
    assert.equal(resolveBundleEntry('sub/x.bmmpa', '/tmp/bundle/'), '/tmp/bundle/sub/x.bmmpa');
  });

  test('keeps the separator the directory is written in', () => {
    // A Windows path joined with a forward slash still works, but it reads as a bug in
    // every log line and every error message that quotes it.
    assert.equal(resolveBundleEntry('x.bmmpa', 'C:\\Temp\\bundle'), 'C:\\Temp\\bundle\\x.bmmpa');
  });

  test('anything not `inside` resolves to nothing', () => {
    // Including the remote case: a URL is not a path, and a caller that fetches it must
    // reach for the URL, not for whatever this returned.
    for (const v of ['https://example.com/x.zip', '../x', '/etc/passwd', 'file:///x', '']) {
      assert.equal(resolveBundleEntry(v, '/tmp/bundle'), '', v);
    }
  });

  test('no directory means no path', () => {
    assert.equal(resolveBundleEntry('x.bmmpa', ''), '');
    assert.equal(resolveBundleEntry('x.bmmpa', null), '');
  });

  test('leading ./ and stray separators are stripped, not walked', () => {
    assert.equal(resolveBundleEntry('./x.bmmpa', '/tmp/b'), '/tmp/b/x.bmmpa');
    // `.//x` would join to `/tmp/b//x` — harmless, but the result should still be one path.
    assert.equal(resolveBundleEntry('.//x.bmmpa', '/tmp/b'), '/tmp/b/x.bmmpa');
  });
});

describe('looksLikeCatalog', () => {
  test('accepts the shape every BMM catalog shares', () => {
    assert.equal(looksLikeCatalog({ version: '1.0', presets: [] }), true);
    assert.equal(looksLikeCatalog({ plugins: [{}] }), true);
    assert.equal(looksLikeCatalog({ catalogs: [] }), true);
  });

  test('refuses a zip that merely contains a file called catalog.json', () => {
    // The point of the check: a mod archive with an unrelated catalog.json must be refused
    // as a bundle, not half-read as one.
    assert.equal(looksLikeCatalog({ name: 'my mod', files: ['a'] }), false);
    assert.equal(looksLikeCatalog('presets'), false);
    assert.equal(looksLikeCatalog([{ presets: [] }]), false);
    assert.equal(looksLikeCatalog(null), false);
  });
});

describe('catalogEntryUrls', () => {
  test('finds addresses whatever the catalog kind spells them', () => {
    const doc = {
      presets: [{ download_url: 'a.bmmpa' }, { download_url: 'b.bmmpa' }],
      plugins: [{ url: 'https://x/c.zip' }],
      themes: [{ file: 'd.json' }],
    };
    assert.deepEqual(catalogEntryUrls(doc).sort(), ['a.bmmpa', 'b.bmmpa', 'd.json', 'https://x/c.zip']);
  });

  test('skips rows with no address at all rather than emitting empties', () => {
    assert.deepEqual(catalogEntryUrls({ presets: [{ name: 'x' }, { download_url: '  ' }, { download_url: 'y' }] }), ['y']);
  });

  test('a non-catalog has no addresses', () => {
    assert.deepEqual(catalogEntryUrls({ name: 'nope' }), []);
    assert.deepEqual(catalogEntryUrls(null), []);
  });
});
