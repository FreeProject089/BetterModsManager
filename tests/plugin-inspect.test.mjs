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
const { humanSize, treeRows, treeSummary, visibleRows, allFolders, countUnder } = await import(
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

describe('folding a listing that is 2693 rows long', () => {
  // A slice of what a real mods folder looks like: nested folders, files at several depths.
  const TREE = [
    f('mods', 0, true),
    f('mods/alpha', 0, true),
    f('mods/alpha/main.lua', 100),
    f('mods/alpha/data', 0, true),
    f('mods/alpha/data/x.json', 200),
    f('mods/beta', 0, true),
    f('mods/beta/readme.txt', 50),
    f('top.txt', 10),
  ];

  test('nothing collapsed changes nothing', () => {
    assert.equal(visibleRows(TREE, new Set()).length, TREE.length);
  });

  test('a collapsed folder hides everything under it, at every depth', () => {
    const rows = visibleRows(TREE, new Set(['mods/alpha'])).map((e) => e.path);
    assert.ok(rows.includes('mods/alpha'), 'the folder itself stays — it is what you click to reopen');
    // Both the file directly inside AND the one two levels down. A filter that only hid
    // direct children would leave grandchildren floating with no parent above them.
    assert.ok(!rows.includes('mods/alpha/main.lua'));
    assert.ok(!rows.includes('mods/alpha/data'));
    assert.ok(!rows.includes('mods/alpha/data/x.json'));
    assert.ok(rows.includes('mods/beta/readme.txt'), 'a sibling is untouched');
  });

  test('a prefix that is not a path segment does not count as being inside', () => {
    // 'mods/alpha' must not swallow 'mods/alphabet/…'. The slash in the comparison is the
    // whole of that, and leaving it out is the bug that hides a folder nobody collapsed.
    const t = [f('mods/alpha', 0, true), f('mods/alphabet', 0, true), f('mods/alphabet/z.txt', 1)];
    const rows = visibleRows(t, new Set(['mods/alpha'])).map((e) => e.path);
    assert.deepEqual(rows, ['mods/alpha', 'mods/alphabet', 'mods/alphabet/z.txt']);
  });

  test('a filter beats a collapse, and drops folders', () => {
    // Somebody who typed a name wants the match, not a lecture about which folder is
    // hiding it — so a collapsed parent does not suppress a hit.
    const rows = visibleRows(TREE, new Set(['mods/alpha']), 'x.json').map((e) => e.path);
    assert.deepEqual(rows, ['mods/alpha/data/x.json']);
    // And a folder that merely CONTAINS a match is not itself a match.
    assert.deepEqual(visibleRows(TREE, new Set(), 'alpha').map((e) => e.path),
      ['mods/alpha/main.lua', 'mods/alpha/data/x.json']);
  });

  test('the filter is case-insensitive and matches anywhere in the path', () => {
    assert.deepEqual(visibleRows(TREE, new Set(), 'README').map((e) => e.path), ['mods/beta/readme.txt']);
    assert.deepEqual(visibleRows(TREE, new Set(), 'BETA/').map((e) => e.path), ['mods/beta/readme.txt']);
  });

  test('allFolders names every folder and no file', () => {
    assert.deepEqual(allFolders(TREE), ['mods', 'mods/alpha', 'mods/alpha/data', 'mods/beta']);
  });

  test('a collapsed folder can say what it is hiding', () => {
    // Counted at every depth, so folding the top of a tree does not report "2 files".
    assert.deepEqual(countUnder(TREE, 'mods/alpha'), { files: 2, bytes: 300 });
    assert.deepEqual(countUnder(TREE, 'mods'), { files: 3, bytes: 350 });
    assert.deepEqual(countUnder(TREE, 'mods/beta'), { files: 1, bytes: 50 });
    // A folder with nothing in it reports nothing rather than throwing.
    assert.deepEqual(countUnder(TREE, 'nope'), { files: 0, bytes: 0 });
  });
});
