// The universal catalogue format's TypeScript fallback, against the COMPILED module and the
// SAME fixtures and expected documents the Rust reader is tested with
// (src-tauri/tests/catalog_format, src-tauri/src/commands/catalog_format.rs). Two readers,
// one truth: if either drifts, its own suite fails.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FX = join(ROOT, 'src-tauri/tests/catalog_format');
const fx = (n) => JSON.parse(readFileSync(join(FX, n), 'utf8'));
const {
    detectCatalog, normalizeCatalog, validateCatalog, toLegacy, legacyViewLocal, needsNormalizing,
    urlOk, cleanSha, FORMAT, FORMAT_VERSION, CATALOG_KIND_ARRAYS,
} = await import(pathToFileURL(join(ROOT, 'frontend/js/core/catalog-format.js')).href);

// The pairs the Rust test `catalog_conversions_match_the_expected_documents` uses.
const EXPECTED = [
    ['v1-plugins.json', 'expected/v1-plugins.universal.json'],
    ['v1-apps.json', 'expected/v1-apps.universal.json'],
    ['v1-themes-object.json', 'expected/v1-themes-object.universal.json'],
    ['v1-modpacks.json', 'expected/v1-modpacks.universal.json'],
    ['v1-repos-array.json', 'expected/v1-repos-array.universal.json'],
    ['bcweb-items.json', 'expected/bcweb-items.universal.json'],
    ['v1-tutorials.json', 'expected/v1-tutorials.universal.json'],
    ['v1-lists.json', 'expected/v1-lists.universal.json'],
    ['v2-feed-payload.json', 'expected/v2-feed.universal.json'],
    ['v1-index.json', 'expected/v1-index.universal.json'],
    ['universal.json', 'expected/universal.universal.json'],
];

describe('catalog-format: same output as the Rust reader', () => {
    for (const [input, expected] of EXPECTED) {
        test(input, () => {
            assert.deepEqual(normalizeCatalog(fx(input)).catalog, fx(expected));
        });
    }
    test('the Rust test reads the same pairs', () => {
        const rs = readFileSync(join(ROOT, 'src-tauri/src/commands/catalog_format.rs'), 'utf8');
        for (const [input, expected] of EXPECTED) {
            assert.ok(rs.includes(`("${input}", "${expected}")`), `${input} is not in the Rust EXPECTED list`);
        }
    });
    test('kinds are the Rust kinds', () => {
        const rs = readFileSync(join(ROOT, 'src-tauri/src/commands/catalog_format.rs'), 'utf8');
        for (const [k, a] of CATALOG_KIND_ARRAYS) assert.ok(rs.includes(`("${k}", "${a}")`), k);
    });
});

describe('catalog-format: detection', () => {
    test('every shape', () => {
        assert.equal(detectCatalog(fx('universal.json')), 'universal');
        assert.equal(detectCatalog(fx('v2-feed-signed.json')), 'dsse');
        assert.equal(detectCatalog(fx('v2-feed-payload.json')), 'v2-feed');
        assert.equal(detectCatalog(fx('v1-index.json')), 'bmm-index');
        assert.equal(detectCatalog(fx('v1-plugins.json')), 'bmm-v1');
        assert.equal(detectCatalog(fx('bcweb-items.json')), 'bcweb-items');
        assert.equal(detectCatalog(fx('v1-themes-array.json')), 'bare-array');
        assert.equal(detectCatalog({ hello: 1 }), 'unknown');
        assert.equal(detectCatalog({ kind: 'index', catalogs: [] }), 'v2-index');
    });
    test('only what v1 readers cannot read needs normalising', () => {
        assert.equal(needsNormalizing(fx('v1-plugins.json')), false);
        assert.equal(needsNormalizing(fx('universal.json')), true);
        assert.equal(needsNormalizing(fx('v2-feed-signed.json')), true);
    });
});

describe('catalog-format: validation', () => {
    test('names every problem with a path', () => {
        const n = normalizeCatalog(fx('invalid-universal.json'));
        const codes = n.issues.map((i) => i.code);
        for (const want of ['item.no_id', 'item.kind', 'download.bad_sha256', 'url.scheme', 'item.duplicate', 'download.missing', 'i18n.value', 'link.url']) {
            assert.ok(codes.includes(want), `missing ${want}: ${codes}`);
        }
        assert.ok(n.issues.some((i) => i.path === '$.items[2].download.url' && i.code === 'url.scheme'));
        assert.ok(n.catalog.items.every((i) => typeof i.id === 'string'), 'unusable items are dropped');
    });
    test('a newer format is refused', () => {
        const n = normalizeCatalog({ format: FORMAT, format_version: FORMAT_VERSION + 1, name: 'x', items: [] });
        assert.equal(n.refused, true);
    });
    test('a clean universal document has no error', () => {
        assert.deepEqual(validateCatalog(fx('universal.json')).filter((i) => i.severity === 'error'), []);
    });
    test('addresses that must never be fetched', () => {
        for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:x', '//evil.example/x', '']) assert.equal(urlOk(bad), false, bad);
        for (const good of ['https://a.example/x', 'http://localhost/x', 'themes/a.bmmtheme']) assert.equal(urlOk(good), true, good);
        assert.equal(cleanSha('sha256:' + 'AB'.repeat(32)), 'ab'.repeat(32));
    });
});

describe('catalog-format: envelopes in the fallback', () => {
    test('a signed feed is read UNVERIFIED and says so', () => {
        const n = normalizeCatalog(fx('v2-feed-signed.json'));
        assert.equal(n.signature.status, 'unknown_key');
        assert.equal(n.innerVariant, 'v2-feed');
        assert.equal(n.catalog.items[0].id, 'fast-loader');
        assert.ok(n.issues.some((i) => i.code === 'signature.unknown_key'));
    });
    test('a malformed envelope is refused', () => {
        const env = fx('v2-feed-signed.json');
        assert.equal(normalizeCatalog({ ...env, payloadType: 'application/json' }).refused, true);
        assert.equal(normalizeCatalog({ ...env, payload: '%%%' }).refused, true);
        assert.equal(normalizeCatalog({ ...env, signatures: [] }).refused, true);
    });
});

describe('catalog-format: the view each v1 reader gets', () => {
    test('plugins, themes, apps, index', () => {
        const u = normalizeCatalog(fx('universal.json')).catalog;
        const p = toLegacy(u, 'plugin');
        assert.equal(p.plugins.length, 1);
        assert.equal(p.plugins[0].download_url, 'https://example.org/p/hello.bmmplug');
        assert.equal(p.plugins[0].game, 'DCS World');
        const th = toLegacy(u, 'theme');
        assert.equal(th.themes[0].vars['--bg'], '#101010');
        const a = toLegacy(u, 'app');
        assert.equal(a.apps[0].title, 'Hello App');
        assert.equal(a.apps[0].download.file_type, 'zip');
        const r = toLegacy(u, 'repo');
        assert.equal(r.repos[0].url, 'https://example.org/repo');
        const ix = legacyViewLocal({ kind: 'index', issuer: 'https://bc.example', generated_at: '2026-10-08T00:00:00Z', catalogs: [
            { id: 'c', slug: 'bmm-themes', name: 'Themes', summary: '', template: 'themes', url: 'https://bc.example/x', project: { slug: 'bmm', name: 'BMM', type: 'official' }, items_count: 3, updated_at: '2026-10-08T00:00:00Z', feed_url: 'https://bc.example/v2/feeds/catalogs/bmm-themes' },
        ] }, 'theme');
        assert.equal(ix.kind, 'catalog-index');
        assert.deepEqual(ix.catalogs[0], { type: 'theme', url: 'https://bc.example/v2/feeds/catalogs/bmm-themes', name: 'Themes', items: 3, updated_at: '2026-10-08T00:00:00Z' });
    });
    test('a v1 document is returned untouched', () => {
        const d = fx('v1-plugins.json');
        assert.equal(legacyViewLocal(d, 'plugin'), d);
    });
    test('a v2 feed reads as plugins for the plugin reader', () => {
        const v = legacyViewLocal(fx('v2-feed-payload.json'), 'plugin');
        assert.equal(v.plugins[0].id, 'fast-loader');
        assert.equal(v.plugins[0].sha256, '4'.repeat(64));
        assert.equal(v.plugins[0].version, '1.2.0');
    });
});
