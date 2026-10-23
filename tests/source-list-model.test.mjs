// Catalogue sources (features/catalogs/source-list-model.ts): row health, failed-source counting,
// grouping, reorder, import / export; and the wiring of the « a source did not answer » fix.
//
// The fetcher's own rules (blank / non-http entries skipped, `&t=` cache buster) are tested in
// Rust: src-tauri/src/commands/apps.rs, `cargo test apps_`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/features/catalogs/source-list-model.js')).href);

describe('rows', () => {
    test('a switched-off source is off, never failing', () => {
        const r = M.makeRow({ kind: 'app', url: 'https://a/x.json', tier: 'custom', enabled: false, status: { state: 'error', error: 'HTTP 404' } });
        assert.equal(r.health, 'off');
        assert.equal(r.error, undefined);
        assert.deepEqual(M.failedRows([r]), []);
    });
    test('health comes from the fetcher, unknown when never fetched', () => {
        assert.equal(M.healthOf(true, null), 'unknown');
        assert.equal(M.healthOf(true, { state: 'stale' }), 'stale');
        assert.equal(M.healthOf(true, { state: 'weird' }), 'unknown');
    });
    test('failedRows counts only enabled, fetched, failed, non-blank sources', () => {
        const rows = [
            M.makeRow({ kind: 'app', url: 'https://a/ok.json', tier: 'official', enabled: true, status: { state: 'ok', items: 3 } }),
            M.makeRow({ kind: 'app', url: 'https://a/bad.json', tier: 'custom', enabled: true, status: { state: 'error', error: 'timeout' } }),
            M.makeRow({ kind: 'app', url: 'https://a/new.json', tier: 'custom', enabled: true }),
            M.makeRow({ kind: 'app', url: '  ', tier: 'partner', enabled: true, status: { state: 'error' } }),
        ];
        assert.deepEqual(M.failedRows(rows).map((r) => r.url), ['https://a/bad.json']);
        assert.equal(rows[0].items, 3);
        assert.equal(rows[1].error, 'timeout');
    });
    test('name: own label, then the catalogue name, then the address', () => {
        assert.equal(M.makeRow({ kind: 'app', url: 'https://raw.githubusercontent.com/o/r/main/c.json', tier: 'custom', enabled: true }).name, 'o/r');
        assert.equal(M.makeRow({ kind: 'app', url: 'https://x/c.json', tier: 'custom', enabled: true, status: { state: 'ok', name: 'Cat' } }).name, 'Cat');
        assert.equal(M.makeRow({ kind: 'app', url: 'https://x/c.json', tier: 'custom', enabled: true, label: 'Mine', status: { state: 'ok', name: 'Cat' } }).name, 'Mine');
        assert.equal(M.labelFromSourceUrl('bundle:C:\\a\\b.bmmbundle'), 'b.bmmbundle');
        assert.equal(M.labelFromSourceUrl('https://bettercommunity.ch/api/catalog.json?project=bmm&kind=THEME'), 'bettercommunity.ch · catalog.json · bmm/THEME');
    });
    test('groups by kind, official then partner then yours in the given order', () => {
        const mk = (kind, url, tier) => M.makeRow({ kind, url, tier, enabled: true });
        const g = M.groupRows([mk('theme', 't1', 'custom'), mk('app', 'a2', 'custom'), mk('app', 'a1', 'custom'), mk('app', 'o', 'official'), mk('app', 'p', 'partner')]);
        assert.deepEqual(g.map((x) => x.kind), ['app', 'theme']);
        assert.deepEqual(g[0].rows.map((r) => r.url), ['o', 'p', 'a2', 'a1']);
    });
});

test('moveInList moves case-insensitively and stays inside the list', () => {
    const l = ['a', 'B', 'c'];
    assert.deepEqual(M.moveInList(l, 'b', -1), ['B', 'a', 'c']);
    assert.deepEqual(M.moveInList(l, 'c', 1), ['a', 'B', 'c']);
    assert.deepEqual(M.moveInList(l, 'zz', 1), l);
    assert.deepEqual(l, ['a', 'B', 'c'], 'the input is not changed');
});

describe('import / export', () => {
    test('export keeps only your sources, with names and on/off', () => {
        const rows = [
            M.makeRow({ kind: 'app', url: 'https://o/c.json', tier: 'official', enabled: true }),
            M.makeRow({ kind: 'theme', url: 'https://t/c.json', tier: 'custom', enabled: false }),
        ];
        const d = M.exportDoc(rows, { 'https://t/c.json': ' Themes ' }, 0);
        assert.equal(d.format, M.EXPORT_FORMAT);
        assert.deepEqual(d.sources, [{ kind: 'theme', url: 'https://t/c.json', enabled: false, name: 'Themes' }]);
    });
    test('import reads our export, a bare list and the mirror map; drops junk', () => {
        const ours = M.parseImport({ format: M.EXPORT_FORMAT, sources: [{ kind: 'app', url: 'https://a/x.json', enabled: false, name: 'X' }, { kind: 'nope', url: 'https://a/y.json' }] });
        assert.deepEqual(ours.sources, [{ kind: 'app', url: 'https://a/x.json', enabled: false, name: 'X' }]);
        assert.equal(ours.dropped, 1);
        const bare = M.parseImport(['https://a/x.json', 'HTTPS://A/X.JSON', '', 'javascript:alert(1)', 'bundle:C:/b.bmmbundle'], 'app');
        assert.deepEqual(bare.sources.map((s) => s.url), ['https://a/x.json', 'bundle:C:/b.bmmbundle']);
        assert.equal(bare.dropped, 2);
        const map = M.parseImport({ plugin: ['https://p/c.json'], theme: ['https://'] });
        assert.deepEqual(map.sources.map((s) => `${s.kind} ${s.url}`), ['plugin https://p/c.json']);
        assert.equal(map.dropped, 1);
        assert.deepEqual(M.parseImport(null).sources, []);
    });
});

test('ageParts picks the unit', () => {
    const now = 10_000_000;
    assert.deepEqual(M.ageParts(now - 5_000, now), { n: 5, unit: 's' });
    assert.deepEqual(M.ageParts(now - 120_000, now), { n: 2, unit: 'm' });
    assert.deepEqual(M.ageParts(now - 3 * 3600_000, now), { n: 3, unit: 'h' });
    assert.equal(M.ageParts(undefined, now), null);
});

describe('wiring of the « a source did not answer » fix', () => {
    const apps = read('frontend/src/features/apps/apps-catalog.ts');
    const rust = read('src-tauri/src/commands/apps.rs');
    const main = read('src-tauri/src/main.rs');
    test('bundle: sources are not handed to the HTTP fetcher', () => {
        assert.match(apps, /enabled\.filter\(\(u\) => !u\.startsWith\('bundle:'\)\)/);
    });
    test('the fetcher skips entries that are not http(s) before fetching them', () => {
        assert.match(rust, /let Some\(url\) = fetchable_source\(raw\) else/);
        assert.match(rust, /match fetchable_source\(&catalog_url\)/);
    });
    test('the reorder command is registered', () => {
        assert.ok(main.includes('commands::apps::set_community_sources,'));
    });
    test('both screens mount the one shared list', () => {
        assert.ok(apps.includes('mountSourceList('));
        assert.ok(read('frontend/src/features/settings/settings.ts').includes('mountSourceList('));
    });
});
