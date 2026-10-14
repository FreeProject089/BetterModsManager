// BMM Tools hub: the model (hash comparison, CSV export, conflict pairs, rows per tool) and the
// wiring (every backend command the hub invokes is registered, every tool is in the palette,
// every tool's words exist in en and fr).
//
// The finders themselves (duplicates, disk usage, profile diff, orphans) are the backend's,
// tested in Rust (src-tauri/src/commands/tools.rs, `cargo test tools_`).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/features/tools/tools-model.js')).href);

const H = 'a'.repeat(64);

describe('hash checker', () => {
    test('normalizeHash strips prefixes, spaces and case', () => {
        assert.equal(M.normalizeHash(`b3:${H.toUpperCase()}`), H);
        assert.equal(M.normalizeHash(`sha256: ${H.slice(0, 32)}\n${H.slice(32)}`), H);
        assert.equal(M.normalizeHash(null), '');
    });
    test('hashAlgoHint reads the prefix', () => {
        assert.equal(M.hashAlgoHint(`sha-256:${H}`), 'sha256');
        assert.equal(M.hashAlgoHint(`blake3=${H}`), 'blake3');
        assert.equal(M.hashAlgoHint(H), null);
    });
    test('compareHash tells empty, invalid, match and mismatch apart', () => {
        assert.equal(M.compareHash(H, ''), 'empty');
        assert.equal(M.compareHash(H, 'abc'), 'invalid');
        assert.equal(M.compareHash(H, `B3:${H.toUpperCase()}`), 'match');
        assert.equal(M.compareHash(H, 'b'.repeat(64)), 'mismatch');
    });
});

describe('export', () => {
    test('csv quotes what must be quoted and neutralises formulas', () => {
        const csv = M.toCsv([{ a: 'x,y', b: '=HYPERLINK("e")' }, { a: 'line\nbreak', b: 3 }], ['a', 'b']);
        const lines = csv.split('\r\n');
        assert.equal(lines[0], 'a,b');
        assert.equal(lines[1], `"x,y","'=HYPERLINK(""e"")"`);
        assert.ok(csv.includes('"line\nbreak",3'));
    });
    test('csv without columns takes the union of keys', () => {
        assert.equal(M.toCsv([{ a: 1 }, { b: 2 }]).split('\r\n')[0], 'a,b');
    });
    test('rowsFor flattens every tool, never throws on empty', () => {
        for (const t of M.TOOLS) {
            assert.deepEqual(M.rowsFor(t.id, null), []);
            assert.ok(Array.isArray(M.rowsFor(t.id, {})));
        }
        const dup = { mod_groups: [{ key: 'name:a', mods: [{ name: 'A', version: '1', path: 'p1' }, { name: 'a', version: '2', path: 'p2' }] }], file_groups: [{ hash: 'h', size: 9, files: [{ mod_name: 'A', path: 'f1' }, { mod_name: 'B', path: 'f2' }] }] };
        assert.equal(M.rowsFor('duplicates', dup).length, 4);
        assert.equal(M.findingCount('duplicates', dup), 2);
        const diff = { only_a: [{ name: 'X', version: '1' }], only_b: [], version: [{ a: { name: 'V', version: '1' }, b: { name: 'V', version: '2' } }], enabled: [], order: [] };
        assert.deepEqual(M.rowsFor('diff', diff).map((r) => r.kind), ['only_a', 'version']);
        assert.equal(M.findingCount('diff', diff), 2);
    });
});

describe('conflict pairs', () => {
    const map = {
        a: [{ other_mod_id: 'b', other_mod_name: 'Bee', file_count: 3, status: 'Potential', category: 'Intra' }],
        b: [{ other_mod_id: 'a', other_mod_name: 'Ay', file_count: 4, status: 'Active', category: 'Intra' },
            { other_mod_id: 'c', other_mod_name: 'Cee', file_count: 9, status: 'Potential', category: 'Inter', other_profile_name: 'P2' }],
    };
    const names = { a: 'Ay', b: 'Bee', c: 'Cee' };
    test('each pair once, the worse side wins, active first', () => {
        const p = M.conflictPairs(map, names);
        assert.equal(p.length, 2);
        assert.equal(p[0].active, true);
        assert.equal(p[0].files, 4);
        assert.equal(p[1].inter, true);
        assert.equal(p[1].otherProfile, 'P2');
    });
    test('scope keeps pairs touching the profile', () => {
        assert.equal(M.conflictPairs(map, names, new Set(['c'])).length, 1);
        assert.equal(M.conflictPairs(map, names, new Set(['z'])).length, 0);
        assert.deepEqual(M.conflictPairs(null, {}), []);
    });
});

test('progressPct clamps and knows when it does not know', () => {
    assert.equal(M.progressPct(5, 10), 50);
    assert.equal(M.progressPct(20, 10), 100);
    assert.equal(M.progressPct(1, 0), null);
});

describe('wiring', () => {
    const main = read('src-tauri/src/main.rs');
    const hub = read('frontend/src/features/tools/tools-hub.ts');
    const cmds = read('frontend/src/core/commands.ts');
    const en = JSON.parse(read('frontend/Lang/en.json'));
    const fr = JSON.parse(read('frontend/Lang/fr.json'));

    test('every tools_* command the hub invokes is registered', () => {
        const used = [...new Set([...hub.matchAll(/invoke\('(tools_[a-z_]+)'/g)].map((m) => m[1]))];
        assert.ok(used.length >= 5, used.join(','));
        for (const c of used) assert.ok(main.includes(`commands::tools::${c},`), `${c} missing from generate_handler!`);
    });
    test('every tool has a palette entry', () => {
        for (const t of M.TOOLS) assert.ok(cmds.includes(`id: 'tools.${t.id}'`), `palette entry tools.${t.id}`);
        assert.ok(cmds.includes("id: 'tools.hub'"));
    });
    test('every tool is named and described in en and fr', () => {
        for (const t of M.TOOLS) {
            for (const k of [`tools.${t.id}.name`, `tools.${t.id}.desc`]) {
                assert.ok(en[k], `en ${k}`);
                assert.ok(fr[k], `fr ${k}`);
            }
        }
        for (const k of ['dangling_active', 'missing_folder', 'missing_profile_dir', 'unowned', 'unregistered']) {
            assert.ok(en[`tools.orphans.k.${k}`] && fr[`tools.orphans.h.${k}`], k);
        }
    });
    test('every static tools.* key the hub names exists', () => {
        const keys = [...new Set([...hub.matchAll(/t\('(tools\.[a-zA-Z0-9_.]+)'/g)].map((m) => m[1]))];
        for (const k of keys) {
            assert.ok(k in en, `en ${k}`);
            assert.ok(k in fr, `fr ${k}`);
        }
    });
});

describe('1.0.3 tools: search, logs, cache, exports', () => {
    test('filterTools matches every word, accent- and case-insensitively', () => {
        const tools = [{ id: 'logs', txt: 'Lecteur de journaux' }, { id: 'cache', txt: 'Nettoyage des caches' }];
        assert.deepEqual(M.filterTools(tools, '', (x) => x.txt).map((x) => x.id), ['logs', 'cache']);
        assert.deepEqual(M.filterTools(tools, 'JOURNAUX lect', (x) => x.txt).map((x) => x.id), ['logs']);
        assert.deepEqual(M.filterTools(tools, 'nettoyage', (x) => x.txt).map((x) => x.id), ['cache']);
        assert.equal(M.fold('Électron Évité'), 'electron evite');
    });
    test('the long tools are the ones that report progress', () => {
        for (const id of ['duplicates', 'disk', 'largefiles', 'deployed', 'cache']) assert.ok(M.isLongTool(id), id);
        for (const id of ['names', 'logs', 'jsondiff', 'hash']) assert.ok(!M.isLongTool(id), id);
        assert.deepEqual(M.TOOLS.filter((x) => x.writes).map((x) => x.id), ['cache'], 'only the cache cleaner writes');
        for (const x of M.TOOLS) assert.ok(M.TOOL_GROUPS.includes(x.group), x.id);
    });
    test('logLevel and filterLog', () => {
        assert.equal(M.logLevel('[12:00] [APPS] Failed to fetch x'), 'error');
        assert.equal(M.logLevel('[WARN] slow disk'), 'warn');
        assert.equal(M.logLevel('[12:00] started'), 'info');
        const text = 'a start\n[WARN] b\nERROR c café\nd\n';
        const all = M.filterLog(text);
        assert.equal(all.total, 4);
        assert.equal(all.errors, 1);
        assert.equal(all.warnings, 1);
        assert.deepEqual(M.filterLog(text, { level: 'warn' }).lines.map((l) => l.n), [2, 3]);
        assert.deepEqual(M.filterLog(text, { level: 'error' }).lines.map((l) => l.text), ['ERROR c café']);
        assert.deepEqual(M.filterLog(text, { q: 'CAFE' }).lines.map((l) => l.n), [3]);
        const clipped = M.filterLog(text, { limit: 2 });
        assert.equal(clipped.clipped, true);
        assert.deepEqual(clipped.lines.map((l) => l.n), [3, 4], 'the newest lines are kept');
    });
    test('cacheSelection skips busy and empty caches', () => {
        const r = { items: [
            { id: 'catalog_cache', bytes: 100, entries: 2 },
            { id: 'mod_cache', bytes: 900, entries: 1, busy: true },
            { id: 'update_leftovers', bytes: 0, entries: 0 },
            { id: 'crash_archive', bytes: 50, entries: 3 },
        ] };
        assert.deepEqual(M.cacheSelection(r, ['catalog_cache', 'mod_cache', 'update_leftovers']), { ids: ['catalog_cache'], bytes: 100 });
        assert.deepEqual(M.cacheSelection(null, ['x']), { ids: [], bytes: 0 });
    });
    test('rows and counts of the new tools', () => {
        assert.equal(M.findingCount('deployed', { items: [{ kind: 'missing_target' }, { kind: 'no_file_list' }] }), 1);
        assert.equal(M.rowsFor('names', { mods: [{ name: 'A', version: '', issues: [{ code: 'version_empty', suggestion: '' }, { code: 'trim', suggestion: 'A' }] }] }).length, 2);
        const jd = { added: [{ key: 'a', name: 'A' }], removed: [], changed: [{ key: 'b', name: 'B', fields: ['version', 'url'] }] };
        assert.equal(M.findingCount('jsondiff', jd), 2);
        assert.deepEqual(M.rowsFor('jsondiff', jd).map((r) => `${r.change}:${r.fields}`), ['added:', 'changed:version url']);
        assert.equal(M.rowsFor('logs', { lines: [{ n: 1, level: 'info', text: 'x' }] })[0].line, 1);
    });
    test('every tool has its one-line rail text in en and fr, and the backend words exist', () => {
        const en = JSON.parse(read('frontend/Lang/en.json'));
        const fr = JSON.parse(read('frontend/Lang/fr.json'));
        for (const x of M.TOOLS) assert.ok(en[`tools.${x.id}.short`] && fr[`tools.${x.id}.short`], `tools.${x.id}.short`);
        const rust = read('src-tauri/src/commands/tools.rs');
        const keys = [...new Set([...rust.matchAll(/"(tools\.[a-zA-Z]+\.[a-zA-Z]+)"/g)].map((m) => m[1]))];
        assert.ok(keys.length >= 5, keys.join(','));
        for (const k of keys) assert.ok(en[k] && fr[k], k);
    });
    test('the long scans are rows of the activity centre, stopped by tools_cancel', () => {
        const act = read('frontend/src/core/activity-sources.ts');
        for (const c of ['tools_find_duplicates', 'tools_disk_usage', 'tools_large_files', 'tools_check_deployed']) {
            const line = act.split('\n').find((l) => l.trim().startsWith(`${c}: {`)) || '';
            assert.ok(line.includes("channel: 'tools'") && line.includes("inv('tools_cancel')"), c);
        }
        assert.match(act, /'tools': 'tools-progress'/);
    });
});
