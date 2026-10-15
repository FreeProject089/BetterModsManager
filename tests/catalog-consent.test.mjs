// Catalogues PROPOSE; a person decides.
//
// The owner's rule: a catalogue of apps, plugins, themes, modpacks or .mm lists offers things to
// download or use, and never downloads, installs, enables or applies one by itself. Only a click,
// a scheduled task the user created, or a plugin the user set up may — and the last two only
// within limits nobody has to say yes to (https, a published checksum).
//
// Two halves:
//   1. the pure rule (catalog-consent.js), against the COMPILED module like every test here;
//   2. the code that refreshes, syncs and lists catalogues, read as text: none of it may reach
//      an install, enable or apply call. A refactor that wires "install on refresh" fails here.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

const {
    catalogActRefusal, unattendedRefusal, autoUpdateAllowed, isUnattended, CATALOG_ACTORS,
} = await import(pathToFileURL(join(ROOT, 'frontend/js/features/catalogs/catalog-consent.js')).href);

const SHA = 'a'.repeat(64);

describe('who may install out of a catalogue', () => {
    test('only a click, a user-made task or a user-installed plugin', () => {
        assert.deepEqual([...CATALOG_ACTORS], ['user', 'task', 'plugin']);
        assert.equal(catalogActRefusal('app', 'x', { source: 'user' }), null);
        assert.equal(catalogActRefusal('app', 'x', { source: 'task', taskId: 't1' }), null);
        assert.equal(catalogActRefusal('plugin', 'x', { source: 'plugin', pluginId: 'p1' }), null);
    });

    test('a refresh, a sync, or no actor at all is refused', () => {
        for (const source of [undefined, '', 'refresh', 'sync', 'catalog', 'deeplink', 'auto']) {
            assert.equal(catalogActRefusal('app', 'x', { source }), 'catalog.act.noActor', String(source));
        }
        assert.equal(catalogActRefusal('app', 'x', undefined), 'catalog.act.noActor');
    });

    test('a task or a plugin must say which one it is', () => {
        assert.equal(catalogActRefusal('app', 'x', { source: 'task' }), 'catalog.act.noTask');
        assert.equal(catalogActRefusal('app', 'x', { source: 'plugin', pluginId: '  ' }), 'catalog.act.noPlugin');
    });

    test('unknown kinds and empty ids are refused; a .mm list is only ever previewed', () => {
        assert.equal(catalogActRefusal('script', 'x', { source: 'user' }), 'catalog.act.badKind');
        assert.equal(catalogActRefusal('app', ' ', { source: 'user' }), 'catalog.act.noId');
        assert.equal(catalogActRefusal('modlist', 'x', { source: 'user' }), 'catalog.act.modlistIsPreview');
    });
});

describe('an unattended install cannot ask, so it refuses instead', () => {
    test('only a click is attended', () => {
        assert.equal(isUnattended('user'), false);
        assert.equal(isUnattended('task'), true);
        assert.equal(isUnattended('plugin'), true);
    });
    test('https and a published sha256 for anything that runs', () => {
        const app = (url, sha256) => ({ download: { url, sha256 } });
        assert.equal(unattendedRefusal('app', app('https://e.org/a.zip', SHA)), null);
        assert.equal(unattendedRefusal('app', app('http://e.org/a.zip', SHA)), 'catalog.act.needsHttps');
        assert.equal(unattendedRefusal('app', app('https://e.org/a.zip', '')), 'catalog.act.needsChecksum');
        assert.equal(unattendedRefusal('plugin', { download_url: 'https://e.org/p.zip' }), 'catalog.act.needsChecksum');
        assert.equal(unattendedRefusal('plugin', { download_url: 'https://e.org/p.zip', sha256: SHA }), null);
        assert.equal(unattendedRefusal('modpack', { url: 'http://e.org/m.zip' }), 'catalog.act.needsHttps');
        // A theme carrying its colours inline downloads nothing.
        assert.equal(unattendedRefusal('theme', { vars: { a: 1 } }), null);
    });
});

describe('background updates of catalogue items are opt-in', () => {
    test('only an explicit "on" lets an item update itself', () => {
        assert.equal(autoUpdateAllowed('on'), true);
        for (const v of [null, undefined, '', 'off', 'true', '1', 'ON']) assert.equal(autoUpdateAllowed(v), false, String(v));
    });

    test('the plugin screen asks the rule, and never the old opt-out test', () => {
        const p = src('frontend/src/features/plugins/plugins.ts');
        assert.match(p, /autoUpdateAllowed\(localStorage\.getItem\('bmm_plugin_au_'/);
        assert.doesNotMatch(p, /bmm_plugin_au_'\s*\+\s*[\w.]+\)\s*!==\s*'off'/, 'auto-update must not default to on');
        assert.doesNotMatch(p, /bmm_plugin_au_'\s*\+\s*[\w.]+\)\s*===\s*'off'\)\s*continue/, 'auto-update must not default to on');
    });
});

// ── The refresh / sync / list paths never install ────────────────────────────

/** Calls that download, install, enable or apply something. */
const ACTS = /invoke\(\s*['"](?:install_|link_install_|install_from_|uninstall_|set_active_theme|toggle_plugin|enable_plugin|set_plugin_enabled|apply_|activate_)|\b(?:installTheme|activateTheme|applyTheme|openInstallModal|startInstall|handleInstall|catalogInstall|installCatalogAppFor|installCatalogTheme)\s*\(/;

/** The body of `function name(` / `async function name(` in `text`, by brace matching. */
function bodyOf(text, name) {
    const at = text.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
    assert.ok(at >= 0, `${name} not found — renamed? update this test with it`);
    const open = text.indexOf('{', text.indexOf(')', at));
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}' && --depth === 0) return text.slice(open, i + 1);
    }
    return text.slice(open);
}

describe('refreshing, syncing and listing catalogues installs nothing', () => {
    const WHOLE_FILES = [
        'frontend/src/features/catalogs/catalog-refresh.ts',
        'frontend/src/features/catalogs/catalog-index.ts',
        'frontend/src/features/catalogs/catalog-search.ts',
        'frontend/src/features/catalogs/catalog-sources.ts',
        'frontend/src/features/catalogs/source-list.ts',
        'frontend/src/features/catalogs/source-list-model.ts',
        'frontend/src/features/catalogs/source-store.ts',
        'frontend/src/core/catalog-read.ts',
        'frontend/src/core/source-fetch.ts',
    ];
    for (const f of WHOLE_FILES) {
        test(f.replace(/^.*\//, ''), () => {
            const m = src(f).match(ACTS);
            assert.equal(m, null, `${f} reaches an install/enable/apply call (${m?.[0]}) — a catalogue refresh must only read`);
        });
    }

    const FUNCTIONS = [
        ['frontend/src/features/apps/apps-catalog.ts', 'loadCatalog'],
        ['frontend/src/features/apps/apps-catalog.ts', 'appsFromBundle'],
        ['frontend/src/features/apps/apps-catalog.ts', 'renderBrowse'],
        ['frontend/src/features/apps/apps-catalog.ts', 'initAppsCatalog'],
        ['frontend/src/features/themes/theme-catalog.ts', 'fetchCatalog'],
        ['frontend/src/features/plugins/plugins.ts', 'loadInitialData'],
        ['frontend/src/features/mods/modlist-catalog.ts', 'loadFollowedLists'],
    ];
    for (const [f, fn] of FUNCTIONS) {
        test(`${fn} (${f.replace(/^.*\//, '')})`, () => {
            const m = bodyOf(src(f), fn).match(ACTS);
            assert.equal(m, null, `${fn} reaches ${m?.[0]} — loading or opening a catalogue must not install`);
        });
    }

    test('the background plugin update installs only behind the opt-in', () => {
        const body = bodyOf(src('frontend/src/features/plugins/plugins.ts'), 'checkPluginUpdates');
        const gate = body.indexOf('autoUpdateAllowed(');
        const install = body.indexOf("invoke('install_plugin'");
        assert.ok(gate > 0 && install > gate, 'the opt-in check must come before the install');
    });
});
