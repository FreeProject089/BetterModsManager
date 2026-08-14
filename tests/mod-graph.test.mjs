// The dependency/conflict tree, against the COMPILED module.
//
// Three failure modes are what these are for, because each one produces a tree that LOOKS
// right: a cycle followed until the stack ends, a missing dependency silently dropped so the
// tree agrees with a broken library, and a diamond reported as a cycle because one
// visited-set was used for two different questions.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { buildTree, findRoots, renderTreeText, treeIds, missingDependencies } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/features/mods/mod-graph.js')).href
);

const mods = [
  { id: 'a', name: 'Mod A', dependencies: ['b', 'c'] },
  { id: 'b', name: 'Mod B', dependencies: ['d'] },
  { id: 'c', name: 'Mod C', dependencies: [] },
  { id: 'd', name: 'Mod D', dependencies: [] },
];

describe('buildTree', () => {
  test('builds the shape that was asked for', () => {
    const t = buildTree('a', mods);
    assert.equal(t.name, 'Mod A');
    assert.deepEqual(t.children.map((c) => c.name), ['Mod B', 'Mod C']);
    assert.deepEqual(t.children[0].children.map((c) => c.name), ['Mod D']);
  });

  test('an unknown root is null, not an empty tree', () => {
    // An empty tree renders as a mod with no dependencies, which is a different and
    // plausible-looking answer to "what does this need".
    assert.equal(buildTree('nope', mods), null);
  });

  test('a missing dependency is a NODE, marked — never dropped', () => {
    // Dropping it makes the tree agree with a library that cannot work.
    const t = buildTree('a', [{ id: 'a', name: 'Mod A', dependencies: ['ghost'] }]);
    assert.equal(t.children.length, 1);
    assert.equal(t.children[0].id, 'ghost');
    assert.equal(t.children[0].missing, true);
  });

  test('a cycle is drawn once and not followed', () => {
    const cyc = [
      { id: 'a', name: 'A', dependencies: ['b'] },
      { id: 'b', name: 'B', dependencies: ['a'] },
    ];
    const t = buildTree('a', cyc);
    const b = t.children[0];
    assert.equal(b.name, 'B');
    assert.equal(b.children[0].id, 'a');
    assert.equal(b.children[0].cycle, true, 'marked as a cycle');
    assert.equal(b.children[0].children.length, 0, 'and not descended into');
  });

  test('a diamond is a REPEAT, not a cycle', () => {
    // A needs B and C; both need D. One visited-set for both questions would call D a
    // cycle — wrong, and alarming for a completely normal shape.
    const diamond = [
      { id: 'a', name: 'A', dependencies: ['b', 'c'] },
      { id: 'b', name: 'B', dependencies: ['d'] },
      { id: 'c', name: 'C', dependencies: ['d'] },
      { id: 'd', name: 'D', dependencies: [] },
    ];
    const t = buildTree('a', diamond);
    const viaB = t.children[0].children[0];
    const viaC = t.children[1].children[0];
    assert.equal(viaB.id, 'd');
    assert.equal(viaC.id, 'd');
    assert.equal(viaB.cycle, false, 'not a cycle');
    assert.equal(viaC.cycle, false, 'not a cycle');
    assert.equal(viaC.repeat, true, 'the second sighting is marked as a repeat');
    // It still APPEARS under both, because "two things depend on this" is the thing you
    // need to know before removing it.
    assert.equal(t.children[1].children.length, 1);
  });

  test('conflicts are attached both ways round', () => {
    const t = buildTree('a', mods, [{ a: 'b', b: 'c', files: 3 }]);
    assert.deepEqual(t.children[0].conflicts, ['c']);
    assert.deepEqual(t.children[1].conflicts, ['b']);
  });
});

describe('renderTreeText', () => {
  test('draws exactly the box-drawing shape', () => {
    const out = renderTreeText(buildTree('a', mods));
    assert.equal(out, [
      'Mod A',
      ' ├── Mod B',
      ' │    └── Mod D',
      ' └── Mod C',
    ].join('\n'));
  });

  test('the continuation column is a bar while siblings remain, spaces after', () => {
    // Getting this wrong prints a tree that reads as a different tree.
    const deep = [
      { id: 'a', name: 'A', dependencies: ['b', 'c'] },
      { id: 'b', name: 'B', dependencies: ['x'] },
      { id: 'c', name: 'C', dependencies: ['y'] },
      { id: 'x', name: 'X', dependencies: [] },
      { id: 'y', name: 'Y', dependencies: [] },
    ];
    const lines = renderTreeText(buildTree('a', deep)).split('\n');
    assert.equal(lines[2], ' │    └── X', 'a sibling remains below, so the column is a bar');
    assert.equal(lines[4], '      └── Y', 'nothing remains below, so it is spaces');
  });

  test('marks say what is wrong, in the text somebody pastes into an issue', () => {
    const out = renderTreeText(buildTree('a', [{ id: 'a', name: 'A', dependencies: ['ghost'] }]));
    assert.match(out, /MISSING/);
  });
});

describe('the rest', () => {
  test('roots are the mods nothing depends on', () => {
    assert.deepEqual(findRoots(mods), ['a']);
  });

  test('treeIds lists each id once', () => {
    assert.deepEqual(treeIds(buildTree('a', mods)).sort(), ['a', 'b', 'c', 'd']);
  });

  test('missingDependencies finds what nothing provides', () => {
    const out = missingDependencies([{ id: 'a', name: 'A', dependencies: ['b', 'ghost'] }, { id: 'b', name: 'B' }]);
    assert.deepEqual(out, [{ needer: 'a', missing: 'ghost' }]);
  });

  test('a mod with no dependencies key does not crash anything', () => {
    // Real entries omit it rather than carrying an empty array.
    const t = buildTree('a', [{ id: 'a', name: 'A' }]);
    assert.deepEqual(t.children, []);
    assert.deepEqual(findRoots([{ id: 'a', name: 'A' }]), ['a']);
  });
});
