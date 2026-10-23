// The mapper's final preview: what lands where, what replaces a game file, what sits at the
// game root, and the virtual list's window. Runs the compiled, import-free model.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/features/mapper/mapper-preview-model.js')).href);

describe('finalPathOf', () => {
  test('no move: the file keeps its path', () => {
    assert.deepEqual(M.finalPathOf('Data/tex/a.dds', []), { dst: 'Data\\tex\\a.dds', moved: false });
  });
  test('a moved folder keeps its name under the target', () => {
    assert.deepEqual(M.finalPathOf('pack\\tex\\a.dds', [['pack', 'Data']]), { dst: 'Data\\pack\\tex\\a.dds', moved: true });
  });
  test('"." moves to the game root', () => {
    assert.deepEqual(M.finalPathOf('wrap\\bin\\x.dll', [['wrap\\bin', '.']]), { dst: 'bin\\x.dll', moved: true });
  });
  test('a sibling with the same prefix is not moved', () => {
    assert.equal(M.finalPathOf('packed\\a.txt', [['pack', 'Data']]).moved, false);
  });
});

describe('buildPreview', () => {
  const files = [
    { path: 'Data\\a.dds', size: 100 },
    { path: 'Data\\sub\\b.dds', size: 50 },
    { path: 'readme.txt', size: 5 },
    { path: 'old\\c.esp', size: 20 },
  ];
  const game = M.gameFileSet([{ path: 'Data', is_dir: true, children: [{ path: 'Data\\a.dds', is_dir: false, children: null }] }]);
  const m = M.buildPreview(files, [], game, ['old']);
  test('counts: files, folders, new, overwrites, root, deleted, bytes', () => {
    assert.deepEqual(m.totals, { files: 3, folders: 2, bytes: 155, news: 2, overwrites: 1, moved: 0, atRoot: 1, deleted: 1 });
  });
  test('groups by top folder, root files last', () => {
    assert.deepEqual(m.groups.map((g) => [g.name, g.count, g.bytes, g.overwrites]), [['Data', 2, 150, 1], ['', 1, 5, 0]]);
  });
  test('an existing game file is an overwrite, case-insensitively', () => {
    const g = M.gameFileSet([{ path: 'DATA/A.DDS', is_dir: false }]);
    assert.equal(M.buildPreview([{ path: 'data\\a.dds', size: 1 }], [], g).items[0].status, 'overwrite');
  });
});

describe('helpers', () => {
  test('middleEllipsis keeps the file name', () => {
    const s = M.middleEllipsis('Data\\textures\\architecture\\whiterun\\wrwalls01.dds', 30);
    assert.equal(s.length, 30);
    assert.ok(s.endsWith('wrwalls01.dds'));
    assert.ok(s.includes('…'));
    assert.equal(M.middleEllipsis('short', 30), 'short');
  });
  test('filters and search', () => {
    const it = { src: 'x\\A.dds', dst: 'Data\\A.dds', size: 1, moved: true, status: 'overwrite', top: 'Data' };
    assert.equal(M.matchesQuery(it, 'a.DDS'), true);
    assert.equal(M.matchesQuery(it, 'zzz'), false);
    assert.equal(M.matchesFilter(it, 'moved'), true);
    assert.equal(M.matchesFilter(it, 'root'), false);
    assert.equal(M.matchesFilter(it, 'overwrite'), true);
  });
  test('the virtual window draws a screenful plus overscan, never past the end', () => {
    assert.deepEqual(M.visibleRange(0, 320, 32, 10000, 8), [0, 18]);
    assert.deepEqual(M.visibleRange(3200, 320, 32, 10000, 8), [92, 118]);
    assert.deepEqual(M.visibleRange(0, 320, 32, 5, 8), [0, 5]);
  });
});

test('the dialog has Back and Apply, and the list is virtualised', () => {
  const src = readFileSync(join(ROOT, 'frontend/src/features/mapper/mapper-preview.ts'), 'utf8');
  assert.match(src, /id="mpv2-back"/);
  assert.match(src, /id="mpv2-apply"/);
  assert.match(src, /visibleRange\(/);
});
