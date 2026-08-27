// The tree a task's scripts make, against the COMPILED module.
//
// The structure is READ from the names, never stored, so these tests are really about one
// property: what you see is what is there. A tree with its own bookkeeping can disagree with
// the blocks it claims to describe; this one cannot, and the tests below are what stop somebody
// adding that bookkeeping later for speed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.localStorage = globalThis.localStorage || {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
};

const here = dirname(fileURLToPath(import.meta.url));
const { treeOf, foldersOf } = await import(
    pathToFileURL(join(here, '../frontend/js/features/settings/block-tree.js')).href
);

const label = (n) => n.label;

describe('treeOf', () => {
    test('a flat list stays flat', () => {
        const t = treeOf(['scan', 'verify']);
        assert.deepEqual(t.map(label), ['scan', 'verify']);
        assert.ok(t.every((n) => n.path && !n.children.length));
    });

    test('a slash makes a folder, and the leaf keeps its whole name', () => {
        const t = treeOf(['repair/fetch', 'repair/verify']);
        assert.equal(t.length, 1);
        assert.equal(t[0].label, 'repair');
        assert.equal(t[0].path, '', 'a folder is not runnable');
        assert.deepEqual(t[0].children.map((c) => c.path), ['repair/fetch', 'repair/verify']);
    });

    test('folders come before loose blocks, at every level', () => {
        // What every file tree does, for the same reason: a folder is a place you go into, and
        // mixing them reads as one flat list with odd icons.
        const t = treeOf(['zzz', 'aaa/one', 'mmm']);
        assert.deepEqual(t.map(label), ['aaa', 'mmm', 'zzz']);
        assert.equal(t[0].path, '');
    });

    test('a folder counts what is inside it, however deep', () => {
        const t = treeOf(['a/b/one', 'a/b/two', 'a/three']);
        assert.equal(t[0].count, 3);
        const b = t[0].children.find((c) => c.label === 'b');
        assert.equal(b.count, 2);
    });

    test('a name can be both a folder and a block', () => {
        // `repair` and `repair/fetch` are two different blocks and both have to appear. Merging
        // them would hide one, and which one it hid would depend on sort order.
        const t = treeOf(['repair', 'repair/fetch']);
        assert.equal(t.length, 2);
        assert.equal(t.filter((n) => n.path === 'repair').length, 1);
        assert.equal(t.filter((n) => !n.path && n.label === 'repair').length, 1);
    });

    test('empty and malformed names do not become empty rows', () => {
        assert.deepEqual(treeOf(['', '/', '//']).map(label), []);
    });

    test('foldersOf lists every folder path, nested included', () => {
        assert.deepEqual(foldersOf(treeOf(['a/b/one', 'c/two'])).sort(), ['a', 'a/b', 'c']);
    });
});
