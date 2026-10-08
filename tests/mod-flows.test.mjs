// The rules behind the three dialogs a mod goes through first, tested on the COMPILED modules:
//
//  · New profile  (features/profiles/profile-folders-model.ts): what is said under each folder
//    field — missing, shared game folder (allowed, explained), shared mods / backup folder,
//    nested folders — and what still blocks Create.
//  · Add a mod    (features/mods/add-mod-model.ts): name and version read from a file name,
//    the listing summarised, the files shared with active mods.
//  · Activate a modpack (features/mods/modpack-plan-model.ts): the plan shown before anything
//    runs — to enable, already on, missing, only-this-pack, integrity, conflicts, order.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = await import(pathToFileURL(join(ROOT, 'frontend/js/features/profiles/profile-folders-model.js')).href);
const A = await import(pathToFileURL(join(ROOT, 'frontend/js/features/mods/add-mod-model.js')).href);
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/features/mods/modpack-plan-model.js')).href);

const keys = (notes) => notes.map((n) => n.key);

describe('new profile: folder rules', () => {
    const profiles = [
        { id: 'a', name: 'Vanilla', game_path: 'C:\\Games\\DCS', mods_path: 'D:\\Mods\\DCS', backup_path: 'D:\\Bak\\a' },
    ];
    const ctx = (over = {}) => ({ exists: true, gamePath: '', modsPath: '', backupPath: '', profiles, ...over });

    test('paths compare without case, separators or a trailing slash', () => {
        assert.ok(P.sameFolder('C:\\Games\\DCS\\', 'c:/games/dcs'));
        assert.ok(P.sameFolder('\\\\?\\C:\\Games\\DCS', 'C:\\Games\\DCS'));
        assert.ok(P.isInside('C:\\Games\\DCS\\Mods', 'C:\\Games\\DCS'));
        assert.ok(!P.isInside('C:\\Games\\DCS2', 'C:\\Games\\DCS'));
        assert.ok(!P.isInside('C:\\Games\\DCS', 'C:\\Games\\DCS'));
    });

    test('an empty field says nothing; a missing folder is an error and nothing else', () => {
        assert.deepEqual(P.folderNotes('game', '', ctx()), []);
        assert.deepEqual(keys(P.folderNotes('game', 'C:\\Nope', ctx({ exists: false }))), ['prof.chk.missing']);
    });

    test('a shared game folder is allowed and explained (info, not an error)', () => {
        const n = P.folderNotes('game', 'c:/games/dcs/', ctx());
        assert.deepEqual(keys(n), ['prof.chk.sharedGame', 'prof.chk.ok']);
        assert.equal(n[0].level, 'info');
        assert.equal(n[0].vars.profiles, 'Vanilla');
        assert.ok(!P.hasError(n));
    });

    test('mods folder: the game folder itself is an error, inside it a warning, shared a warning', () => {
        assert.equal(P.folderNotes('mods', 'C:\\G', ctx({ gamePath: 'C:\\G' }))[0].key, 'prof.chk.modsIsGame');
        assert.equal(P.folderNotes('mods', 'C:\\G\\Mods', ctx({ gamePath: 'C:\\G' }))[0].key, 'prof.chk.modsInGame');
        const shared = P.folderNotes('mods', 'D:\\Mods\\DCS', ctx());
        assert.equal(shared[0].key, 'prof.chk.sharedMods');
        assert.equal(shared[0].level, 'warn');
        assert.ok(!keys(shared).includes('prof.chk.ok'));
    });

    test("backup folder: another profile's is an error, the game / mods folder too", () => {
        assert.ok(P.hasError(P.folderNotes('backup', 'D:\\Bak\\a', ctx())));
        assert.ok(P.hasError(P.folderNotes('backup', 'C:\\G', ctx({ gamePath: 'C:\\G' }))));
        assert.equal(P.folderNotes('backup', 'C:\\G\\bak', ctx({ gamePath: 'C:\\G' }))[0].key, 'prof.chk.backupInGame');
    });

    test('the profile being edited is not "another profile"', () => {
        const n = P.folderNotes('backup', 'D:\\Bak\\a', { ...ctx(), selfId: 'a' });
        assert.ok(!P.hasError(n));
    });

    test('Create waits for a name, both folders and no folder error', () => {
        assert.deepEqual(P.missingForCreate('', '', '', []), ['prof.need.name', 'prof.need.game', 'prof.need.mods']);
        assert.deepEqual(P.missingForCreate('X', 'C:\\G', 'D:\\M', [[{ level: 'error', key: 'k' }]]), ['prof.need.fix']);
        assert.deepEqual(P.missingForCreate('X', 'C:\\G', 'D:\\M', [[{ level: 'info', key: 'k' }]]), []);
    });

    test('mods folder suggestions: beside the game, named after it, never the game folder', () => {
        const c = P.modsFolderCandidates('C:\\Games\\DCS World', '');
        assert.deepEqual(c, ['C:\\Games\\DCS World Mods', 'C:\\Games\\Mods', 'C:\\Games\\DCS World\\Mods']);
        assert.deepEqual(P.modsFolderCandidates('', 'x'), []);
    });
});

describe('add a mod: what is read from the source', () => {
    test('archive: type, name and version from the file name', () => {
        const s = A.describeSource('C:\\Downloads\\Better_Cockpit_v1.2.3.zip');
        assert.equal(s.kind, 'archive');
        assert.equal(s.archiveType, 'zip');
        assert.equal(s.name, 'Better Cockpit');
        assert.equal(s.version, '1.2.3');
        assert.equal(A.describeSource('/x/pack.tar.gz').archiveType, 'tar.gz');
    });

    test('folder: kept as named, no version invented', () => {
        const s = A.describeSource('D:\\Mods\\Hangar Textures\\');
        assert.equal(s.kind, 'folder');
        assert.equal(s.name, 'Hangar Textures');
        assert.equal(s.version, '');
    });

    test('the listing summarised: files, folders, bytes, top-level names folders first', () => {
        const sum = A.summarize([
            { path: 'Textures', is_dir: true, size: 0 },
            { path: 'Textures/a.dds', size: 100 },
            { path: 'readme.txt', size: 5 },
        ]);
        assert.equal(sum.files, 2);
        assert.equal(sum.folders, 1);
        assert.equal(sum.bytes, 105);
        assert.deepEqual(sum.top, ['Textures/', 'readme.txt']);
        assert.equal(A.summarize([{ path: 'a' }], 1).capped, true);
    });

    test('conflicts: same relative path, any case or separator, biggest overlap first', () => {
        const hits = A.findConflicts(['Textures\\A.dds', 'b.lua'], [
            { id: '1', name: 'One', files: ['textures/a.dds'] },
            { id: '2', name: 'Two', files: ['B.LUA', 'TEXTURES/A.DDS', 'c.txt'] },
            { id: '3', name: 'Three', files: ['other.txt'] },
        ]);
        assert.deepEqual(hits.map((h) => [h.id, h.count]), [['2', 2], ['1', 1]]);
        assert.deepEqual(A.findConflicts([], [{ id: '1', name: 'x', files: ['a'] }]), []);
    });

    test('sizes read as a person would', () => {
        assert.equal(A.formatSize(512), '512 B');
        assert.equal(A.formatSize(1536), '1.5 KB');
        assert.equal(A.formatSize(5 * 1024 ** 3), '5.0 GB');
    });
});

describe('activate a modpack: the plan', () => {
    const mods = [
        { id: 'a', name: 'A', enabled: false, file_hashes: { f: '1' }, dependencies: ['d'] },
        { id: 'b', name: 'B', enabled: true, file_hashes: { f: '1' } },
        { id: 'c', name: 'C', enabled: false, file_hashes: null },
        { id: 'd', name: 'D', enabled: false, file_hashes: { f: '1' } },
        { id: 'x', name: 'X', enabled: true, file_hashes: { f: '1' } },
    ];
    const pack = { mods: [
        { mod_id: 'a', include_dependencies: true },
        { mod_id: 'gone', sha256: 'sha-c' },
        { mod_id: 'b' },
        { mod_id: 'zzz', mod_name: 'Lost one' },
    ] };

    test('found by id or by hash, dependencies after their parent, missing listed by name', () => {
        const plan = M.planModpack(pack, mods, { 'sha-c': 'c' });
        assert.deepEqual(plan.packOrder, ['a', 'd', 'c', 'b']);
        assert.deepEqual(plan.toEnable.map((m) => m.id), ['a', 'd', 'c']);
        assert.deepEqual(plan.alreadyOn.map((m) => m.id), ['b']);
        assert.deepEqual(plan.missing.map((m) => m.label), ['Lost one']);
        assert.equal(plan.state, 'partial');
    });

    test('mods without hashes are named before enable_mod refuses them', () => {
        const plan = M.planModpack(pack, mods, { 'sha-c': 'c' });
        assert.deepEqual(plan.noHash.map((m) => m.id), ['c']);
    });

    test('only this pack: every other mod that is on goes off, nothing else', () => {
        const plan = M.planModpack(pack, mods, { 'sha-c': 'c' }, { exclusive: true });
        assert.deepEqual(plan.toDisable.map((m) => m.id), ['x']);
        assert.deepEqual(M.planModpack(pack, mods, {}).toDisable, []);
    });

    test('state: off when nothing of the pack is on, on when all found are', () => {
        assert.equal(M.planModpack({ mods: [{ mod_id: 'a' }] }, mods).state, 'off');
        assert.equal(M.planModpack({ mods: [{ mod_id: 'b' }, { mod_id: 'x' }] }, mods).state, 'on');
    });

    test('conflicts that will be live: inside the pack, or with a mod that stays on; each pair once', () => {
        const plan = M.planModpack(pack, mods, { 'sha-c': 'c' });
        const cache = {
            a: [{ category: 'Intra', other_mod_id: 'x', other_mod_name: 'X', file_count: 3 }, { category: 'Intra', other_mod_id: 'b', file_count: 1 }],
            b: [{ category: 'Intra', other_mod_id: 'a', file_count: 1 }],
            d: [{ category: 'Inter', other_mod_id: 'x', file_count: 9 }],
        };
        const c = M.planConflicts(plan, mods, cache);
        assert.deepEqual(c.map((x) => [x.modId, x.otherId, x.inPack]), [['a', 'x', false], ['a', 'b', true]]);
        const only = M.planModpack(pack, mods, { 'sha-c': 'c' }, { exclusive: true });
        assert.deepEqual(M.planConflicts(only, mods, cache).map((x) => x.otherId), ['b']);
    });
});
