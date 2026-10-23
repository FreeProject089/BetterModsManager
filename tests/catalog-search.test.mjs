// The catalogue index: folding, ranked prefix search, de-duplication across catalogues, and
// the refresh rules (only stale sources, isolation, last good data). Against the COMPILED
// modules, with a fake fetcher: no network.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { fold, tokenize, CatalogSearchIndex, rankRows } = await import(pathToFileURL(join(ROOT, 'frontend/js/features/catalogs/catalog-search.js')).href);
const { CatalogRefresher } = await import(pathToFileURL(join(ROOT, 'frontend/js/features/catalogs/catalog-refresh.js')).href);
const { normalizeCatalog } = await import(pathToFileURL(join(ROOT, 'frontend/js/core/catalog-format.js')).href);

const SHA = 'a'.repeat(64);
const item = (kind, id, name, more = {}) => ({ kind, id, name, ...more });

describe('folding', () => {
    test('case, accents, ligatures', () => {
        assert.equal(fold('ÉCLAIR Œuvre Straße'), 'eclair oeuvre strasse');
    });
    test('punctuation inside a word yields the parts and the joined form', () => {
        assert.deepEqual(tokenize('F/A-18 Hornet').sort(), ['18', 'a', 'f', 'fa18', 'hornet'].sort());
    });
});

describe('search', () => {
    const ix = new CatalogSearchIndex();
    ix.setSource('https://one.example/c.json', { items: [
        item('theme', 'eclair', 'Éclair', { tags: ['dark'] }),
        item('theme', 'clear', 'Clear sky', { description: 'an eclair-like palette' }),
        item('plugin', 'hornet', 'F/A-18 helper', { author: 'Zoé' }),
        item('plugin', 'notes', 'Notes', { tags: ['writing'] }),
    ] });

    test('accent-insensitive, and the name beats the description', () => {
        const hits = ix.search('eclair');
        assert.deepEqual(hits.map((h) => h.entry.id), ['eclair', 'clear']);
    });
    test('prefix match', () => {
        assert.deepEqual(ix.search('hor').map((h) => h.entry.id), ['hornet']);
        assert.deepEqual(ix.search('fa18').map((h) => h.entry.id), ['hornet']);
        assert.deepEqual(ix.search('zoe').map((h) => h.entry.id), ['hornet']);
    });
    test('every word must match', () => {
        assert.deepEqual(ix.search('notes writing').map((h) => h.entry.id), ['notes']);
        assert.deepEqual(ix.search('notes dark'), []);
    });
    test('kind filter and empty query', () => {
        assert.deepEqual(ix.search('', { kind: 'plugin' }).map((h) => h.entry.id), ['hornet', 'notes']);
        assert.equal(ix.search('e', { kind: 'theme' }).every((h) => h.entry.kind === 'theme'), true);
    });
    test('an exact name ranks first', () => {
        const j = new CatalogSearchIndex();
        j.setSource('s', { items: [item('theme', 'a', 'Night owl'), item('theme', 'b', 'Night')] });
        assert.equal(j.search('night')[0].entry.id, 'b');
    });
});

describe('de-duplication across catalogues', () => {
    test('same kind+id, or same file under another id, is one entry with every source', () => {
        const ix = new CatalogSearchIndex();
        ix.setSource('A', { items: [item('plugin', 'fast', 'Fast', { download: { url: 'x', sha256: SHA } })] });
        ix.setSource('B', { items: [item('plugin', 'FAST', 'Fast (mirror)')] });
        ix.setSource('C', { items: [item('plugin', 'fast-loader', 'Fast loader', { download: { url: 'y', sha256: SHA } })] });
        ix.setSource('D', { items: [item('theme', 'fast', 'A theme called fast')] });
        const e = ix.entries();
        assert.equal(e.length, 2);
        const p = e.find((x) => x.kind === 'plugin');
        assert.deepEqual(p.sources, ['A', 'B', 'C']);
        assert.equal(p.name, 'Fast', 'the first source to list it is the one shown');
        ix.removeSource('A');
        assert.equal(ix.entries('plugin')[0].name, 'Fast (mirror)');
    });
});

describe('rankRows (the catalogue modal browse search)', () => {
    test('ranks plain rows and returns everything for an empty query', () => {
        const rows = [{ name: 'Campaign set', sub: 'by Ed' }, { name: 'Éclair pack' }, { name: 'Other', note: 'eclair' }];
        assert.deepEqual(rankRows(rows, 'éclair'), [1, 2]);
        assert.deepEqual(rankRows(rows, '  '), [0, 1, 2]);
    });
});

describe('refresh', () => {
    const doc = (ids) => JSON.stringify({ version: '1.0', plugins: ids.map((id) => ({ id, name: id, download_url: `https://x/${id}`, sha256: createHash('sha256').update(id).digest('hex') })) });
    const normalize = async (d, kind) => normalizeCatalog(d, { kind });

    test('only stale sources are fetched; one failure never blocks the others', async () => {
        let t = 0;
        const calls = [];
        const bodies = { A: doc(['a1']), B: doc(['b1', 'b2']) };
        const fetcher = async (url) => {
            calls.push(url);
            if (url === 'DOWN') throw new Error('HTTP 503');
            return { text: bodies[url], state: 'fresh' };
        };
        const r = new CatalogRefresher(fetcher, normalize, { now: () => t });
        const specs = [{ url: 'A', kind: 'plugin', ttlMs: 1000 }, { url: 'B', kind: 'plugin', ttlMs: 50 }, { url: 'DOWN', kind: 'plugin' }];
        const st = await r.refresh(specs);
        assert.deepEqual(st.map((s) => s.state), ['ok', 'ok', 'error']);
        assert.equal(st[2].error, 'HTTP 503');
        assert.equal(r.index.entries().length, 3);

        calls.length = 0;
        t = 100; // B's TTL passed, A's did not; DOWN is in error and always due
        await r.refresh(specs);
        assert.deepEqual(calls.sort(), ['B', 'DOWN']);
        calls.length = 0;
        await r.refresh(specs, { force: true });
        assert.deepEqual(calls.sort(), ['A', 'B', 'DOWN']);
    });

    test('a source that fails keeps its last good data, marked stale', async () => {
        let up = true;
        const r = new CatalogRefresher(async () => { if (!up) throw new Error('offline'); return { text: doc(['p']) }; }, normalize);
        await r.refresh([{ url: 'S', kind: 'plugin' }]);
        up = false;
        const [st] = await r.refresh([{ url: 'S', kind: 'plugin' }], { force: true });
        assert.equal(st.state, 'stale');
        assert.equal(st.failures, 1);
        assert.equal(r.index.entries().length, 1, 'still served');
    });

    test('the cache serving its last copy is stale, not ok', async () => {
        const r = new CatalogRefresher(async () => ({ text: doc(['p']), state: 'stale', error: 'HTTP 502' }), normalize);
        const [st] = await r.refresh([{ url: 'S' }]);
        assert.equal(st.state, 'stale');
        assert.equal(st.error, 'HTTP 502');
        assert.equal(st.fetch, 'stale');
    });

    test('a refused document never replaces accepted data', async () => {
        let body = doc(['good']);
        const r = new CatalogRefresher(async () => ({ text: body }), normalize);
        await r.refresh([{ url: 'S' }]);
        body = JSON.stringify({ format: 'bmm-catalog', format_version: 99, name: 'x', items: [] });
        const [st] = await r.refresh([{ url: 'S' }], { force: true });
        assert.equal(st.state, 'stale');
        assert.equal(r.index.entries()[0].id, 'good');
    });

    test('an unfollowed source leaves the index; statuses survive a restart as due', async () => {
        const r = new CatalogRefresher(async () => ({ text: doc(['p']) }), normalize);
        await r.refresh([{ url: 'S' }, { url: 'T' }]);
        await r.refresh([{ url: 'T' }]);
        assert.deepEqual(r.list().map((s) => s.url), ['T']);
        const saved = JSON.parse(JSON.stringify(r.toJSON()));
        const r2 = new CatalogRefresher(async () => ({ text: doc(['p']) }), normalize);
        r2.restore(saved);
        assert.equal(r2.isStale({ url: 'T' }), true);
        assert.equal(r2.list()[0].lastOk, saved[0].lastOk);
    });
});
