// Reading a folder listing, against the COMPILED module.
//
// plugin-tree.js, not plugin-inspect.js: the second imports permDomains from plugins.ts,
// which reaches localStorage at import time and dies here before a single assertion runs.
//
// The listing arrives flat, because that is what a walk produces and what a cap can be
// applied to. Turning it into something a person reads is a rendering decision, and these
// are the two pieces of it worth pinning: the depth a row is drawn at, and the summary line
// that says whether it is worth scrolling.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { humanSize, treeRows, treeSummary } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/features/plugins/plugin-tree.js')).href
);

const f = (path, size = 0, is_dir = false) => ({ path, size, is_dir });

describe('how big is that', () => {
  test('nothing at all shows nothing, rather than "0 B"', () => {
    // A folder row has no size, and printing one invents a fact about it.
    assert.equal(humanSize(0), '');
  });

  test('it climbs units and keeps one decimal where that helps', () => {
    assert.equal(humanSize(512), '512 B');
    assert.equal(humanSize(1536), '1.5 KB');
    assert.equal(humanSize(1024 * 1024 * 3), '3.0 MB');
    // Past ten, the decimal is noise.
    assert.equal(humanSize(1024 * 1024 * 25), '25 MB');
  });
});

describe('the shape of a flat listing', () => {
  test('depth comes from the path, and the name is its last segment', () => {
    const rows = treeRows([f('readme.md'), f('scripts', 0, true), f('scripts/run.ps1', 12)]);
    assert.deepEqual(rows.map((r) => r.depth), [0, 0, 1]);
    assert.deepEqual(rows.map((r) => r.name), ['readme.md', 'scripts', 'run.ps1']);
  });

  test('a deeply nested file keeps its indent', () => {
    const [row] = treeRows([f('a/b/c/d.txt')]);
    assert.equal(row.depth, 3);
    assert.equal(row.name, 'd.txt');
  });

  test('the order it was given is the order it is drawn', () => {
    // The walk sorts; re-sorting here would mean two different orders to reason about, and
    // the one on screen would stop matching the one that was hashed.
    const given = ['b.txt', 'a.txt'];
    assert.deepEqual(treeRows(given.map((p) => f(p))).map((r) => r.name), given);
  });
});

describe('the summary line', () => {
  test('folders are counted apart from files, and do not add to the size', () => {
    const s = treeSummary([f('scripts', 0, true), f('scripts/a.ps1', 100), f('b.txt', 23)]);
    assert.deepEqual(s, { files: 2, folders: 1, bytes: 123 });
  });

  test('an empty folder summarises to zeroes rather than throwing', () => {
    assert.deepEqual(treeSummary([]), { files: 0, folders: 0, bytes: 0 });
  });
});
