// @ts-nocheck
import { sourceAccessHtml, wireSourceAccess } from '../../core/source-access.js';
import { copyIdButtons, wireCopyIds } from '../../core/copy-id.js';
import { invoke, pickFile, saveFile, pickFolder, convertFileSrc, apiBase, apiRunning } from '../../core/api.js';
import { toast, fetchProfileIconPaths, updateSelectProfileIcon, decorateProfileOptions, toastSaved } from '../../ui/app.js';
import { t, getLang } from '../../core/i18n.js';
import { permDomains } from './plugin-perms.js';
import { openFolderContent, folderFacts, humanSize } from './plugin-inspect.js';
export { permDomains } from './plugin-perms.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { bundleEntryKind, resolveBundleEntry } from '../../core/catalog-bundle.js';
// NOTE: this file is @ts-nocheck, so a wrong name here is a runtime ReferenceError and not a
// build error. Checked against the exports in catalog-index.ts by hand.
import { enabledOnly, isDisabled, setDisabled, originOf, originLabel, forgetOrigin, recordHistory, looksLikeIndex, importIndexForType, describeKinds, catalogLooksLike, readSources, STORE_KEY } from '../catalogs/catalog-index.js';
import { writeSources } from '../catalogs/catalog-sources.js';
/**
 * The modpack list from the LOCAL plugin API, or an empty list.
 *
 * The API is optional and its bind can fail — a zombie instance from a previous run still
 * holding the port. Every call site already caught the exception and fell back to `[]`, but
 * catching does not stop the BROWSER logging `ERR_CONNECTION_REFUSED`, so a session with no
 * API produced one console error per feature that asked, and the real cause sat in the crash
 * log. Asking only when something is listening is the fix; the fallback stays identical.
 */
// matching API endpoints for a plugin (when it sends X-BMM-Plugin-Id).
//
// TWENTY-FOUR scopes, mirroring `api::mod::PLUGIN_SCOPES`, and a Rust test asserts the
// router and that list agree in both directions.
//
// This screen used to offer eleven. The comment above it said read scopes did not exist
// because "the GET routes carry no require_permission filter" — which was true of most
// of them and had become the reason fifty routes were reachable by any plugin holding a
// token at all: `GET /api/data`, `POST /api/data/import`, `POST /api/restart`,
// `DELETE /api/plugins/<id>`. They are gated now, so the checkboxes are the boundary
// they always looked like.
//
// Read and write are separate in every domain that has something to disclose. Knowing
// is not the same permission as changing, and for keys that IS the distinction: listing
// which identities exist is not minting one that signs on the user's behalf.
/**
 * Is this a plugin id that will still work everywhere it is about to be used?
 *
 * The id is not a label. It becomes a folder name on disk, a segment of a `bmm://` deeplink,
 * a key in a catalogue, and the thing another plugin names to depend on this one — and it
 * fails at each of those differently, so a space in it produces four unrelated symptoms and
 * no message. The form checked that it was non-empty and stopped there.
 *
 * Deliberately narrower than "what happens to survive": lowercase-ish ASCII, digits, `-`,
 * `_` and `.`, starting with a letter or digit. Every id anybody has already published fits
 * it, and nothing that fits it needs escaping anywhere.
 */
export function isUsablePluginId(id) {
    return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && id.length <= 64;
}
async function fetchModpacks(init) {
    if (!apiRunning())
        return [];
    try {
        const r = await fetch(apiBase() + '/api/modpacks', init);
        return (await r.json().catch(() => ({}))).data || [];
    }
    catch {
        return [];
    }
}
import { dispatchBmmAction, BMM_ACTIONS } from '../../ui/tutorial-events.js';
import { showConfirm } from '../../ui/confirm.js';
import { getLinks } from '../../core/links-config.js';
import { fetchSourceText } from '../../core/source-fetch.js';
// ── SVG Icons (no unicode emoji) ───────────────────────────────────────────
const IC = {
    paperclip: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`,
    puzzle: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
    editIcon: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    duplicate: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
    inspect: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`,
    download: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    trash: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
    alert: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
    checkCircle: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    play: `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    eye: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    save: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
    copy: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
    refresh: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
    upload: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
    lock: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
    x: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    plus: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    search: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    zap: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    shield: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    list: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
    terminal: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
    arrowUp: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`,
    arrowDown: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`,
    globe: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    star: `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    info: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    exportIcon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    settings: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    folder: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    hash: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>`,
};
// ── State ──────────────────────────────────────────────────────────────────
let _tab = 'installed';
let _installedPlugins = [];
let _allLaunchpacks = [];
let _allTasks = [];
let _catalog = null;
let _allMods = [];
let _allModsAll = []; // flattened, deduped mods across ALL profiles (for the creator)
let _editScripts = []; // existing bundled scripts carried over when editing a plugin
let _editFolders = []; // existing bundled folders carried over when editing a plugin
let _removedScripts = []; // bundled scripts (manifest-rel paths) staged for removal — undo until save
let _removedFolders = []; // bundled folders staged for removal — undo until save
let _renderPcScripts = null; // re-render hooks set by renderCreate() so prefill can refresh the lists
let _renderPcFolders = null;
let _editAutomations = []; // .bmmpa files already shipped, carried over when editing
let _removedAutomations = []; // staged for removal — undo until save
let _editBundles = []; // .bmmbundle files already shipped
let _removedBundles = []; // staged for removal — undo until save
let _renderPcAutomations = null;
let _renderPcBundles = null;
let _allProfiles = [];
let _apiToken = '';
let _exePath = '';
let _allModpacks = [];
// Prevents event-listener accumulation when switching back to the Scripts tab
let _scriptClickHandler = null;
// Endpoint def cache for on-demand code generation in all language tabs
const _epCodeCache = new Map();
// Cached, language-keyed HTML for the (static, expensive) endpoint + deep-link lists in
// the API & Scripts tab. Building ~50 syntax-highlighted rows on every tab open was the
// lag; now it's built once per language and reused. See epListHtml()/dlListHtml().
let _epListHtmlCache = null;
let _dlListHtmlCache = null;
// Build (or reuse) the documented endpoint list. Always refreshes the cheap _epCodeCache
// so on-demand code generation still works, but only rebuilds the heavy highlighted HTML
// when the language changed.
function epListHtml() {
    const defs = getEndpointDefs();
    const methodOrder = { GET: 0, POST: 1, PUT: 2, DELETE: 3, PATCH: 4 };
    defs.sort((a, b) => (methodOrder[a.method] ?? 9) - (methodOrder[b.method] ?? 9));
    defs.forEach(ep => {
        const sid = (ep.method.toLowerCase() + '_' + ep.path).replace(/\//g, '_').replace(/^_/, '').replace(/:/g, '');
        _epCodeCache.set(sid, ep);
    });
    if (_epListHtmlCache && _epListHtmlCache.lang === getLang())
        return _epListHtmlCache.html;
    const methodCls = { GET: 'plug-method-get', POST: 'plug-method-post', PUT: 'plug-method-put', DELETE: 'plug-method-delete', PATCH: 'plug-method-patch' };
    const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
    const html = methods.map(mth => {
        const group = defs.filter(d => d.method === mth);
        if (group.length === 0)
            return '';
        const cls = methodCls[mth] || '';
        const rows = group.map(ep => buildEndpointRow(ep)).join('');
        return `<div class="plug-ep-group" data-method="${mth}">
            <div class="plug-ep-group-header" role="button" tabindex="0">
                <svg class="plug-ep-group-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                <span class="plug-method ${cls}" style="font-size:11px;">${mth}</span>
                <span class="plug-ep-group-count">${group.length} endpoint${group.length > 1 ? 's' : ''}</span>
            </div>
            <div class="plug-ep-group-body">${rows}</div>
        </div>`;
    }).join('');
    _epListHtmlCache = { lang: getLang(), html };
    return html;
}
/**
 * Which group a deeplink belongs to, by subject rather than by prefix.
 *
 * The prefix would be the cheap answer and the wrong one: `install`, `download` and `import`
 * have no prefix at all and are three ways to do the same thing to a mod, while `theme/`,
 * `language/` and `settings/` are three prefixes for one subject. Somebody looking for "the
 * link that installs a mod" is not looking under I.
 *
 * Anything unlisted lands in `other`, which is the honest place for it — better than a
 * silently-dropped row or a group of one.
 */
const DL_GROUPS = [
    { g: 'mods', label: 'Mods & profiles', is: (s) => /^(mod|profile|modpack)\//.test(s) || ['install', 'download', 'import'].includes(s) },
    { g: 'plugins', label: 'Plugins', is: (s) => s.startsWith('plugin/') },
    { g: 'repo', label: 'Repos & sharing', is: (s) => s.startsWith('repo/') || s.startsWith('catalog/') },
    { g: 'apps', label: 'Apps', is: (s) => s.startsWith('app/') || s.startsWith('launchpack/') },
    { g: 'look', label: 'Appearance & language', is: (s) => /^(theme|language|settings)\//.test(s) },
    { g: 'auto', label: 'Automation', is: (s) => /^(schedule|view)\//.test(s) || s === 'hook' || s === 'api' },
    { g: 'diag', label: 'Measuring & recording', is: (s) => /^(benchmark|telemetry|recorder|replay|data)\//.test(s) },
    { g: 'other', label: 'The rest', is: () => true },
];
/** The group a scheme falls in. First match wins, and the last one matches everything. */
function dlGroupOf(scheme) {
    const hit = DL_GROUPS.find((x) => x.is(scheme));
    return { g: hit.g, label: hit.label };
}
function dlListHtml() {
    if (_dlListHtmlCache && _dlListHtmlCache.lang === getLang())
        return _dlListHtmlCache.html;
    // Grouped, and alphabetical inside a group. Forty-eight rows in the order they were
    // written is a list you read top to bottom every single time, because there is no
    // structure to skip with — the same reasoning the scheduler's presets got.
    const defs = getDeepLinkDefs();
    let html = '';
    for (const grp of DL_GROUPS) {
        const mine = defs.filter((d) => dlGroupOf(d.scheme).g === grp.g)
            .sort((a, b) => a.scheme.localeCompare(b.scheme));
        if (!mine.length)
            continue;
        html += `<div class="plug-dl-group" data-dlgrp="${escAttr(grp.g)}">
            <span>${escHtml(t('plugins.dlGrp.' + grp.g) || grp.label)}</span>
            <span class="plug-dl-group-n">${mine.length}</span>
        </div>` + mine.map((dl) => buildDeepLinkRow(dl)).join('');
    }
    _dlListHtmlCache = { lang: getLang(), html };
    return html;
}
// ── Init ───────────────────────────────────────────────────────────────────
export async function initPlugins() {
    const view = document.getElementById('view-plugins');
    if (!view)
        return;
    renderPluginsView();
    setupPluginTabs();
    await loadInitialData();
    checkPluginUpdates(); // auto-update catalog plugins (per-plugin opt-out)
    // Re-render when user switches language — but preserve the script-generator
    // actions the user already added (they must NOT reset on a language change).
    document.addEventListener('langChanged', () => {
        const snap = _tab === 'scripts' ? _snapshotActions() : null;
        renderPluginsView();
        setupPluginTabs();
        renderTab(_tab);
        if (snap && snap.length)
            _restoreActions(snap);
    });
    // Keep _allModpacks in sync when any modpack is created/updated/deleted
    window.addEventListener('bmm://modpacks-updated', async () => {
        try {
            _allModpacks = await fetchModpacks();
        }
        catch {
            _allModpacks = [];
        }
    });
}
/**
 * Auto-update plugins installed from the catalog. For each installed plugin that
 * has a stored catalog source and whose auto-update is not turned off, compare
 * the catalog version (matched by id) with the installed version; if it differs,
 * reinstall from the catalog download URL. Verifies both id and version.
 */
async function checkPluginUpdates() {
    const candidates = (_installedPlugins || []).filter(p => {
        const id = p?.manifest?.id;
        return id
            && localStorage.getItem('bmm_plugin_src_' + id) // came from the catalog
            && localStorage.getItem('bmm_plugin_au_' + id) !== 'off'; // auto-update not disabled
    });
    if (!candidates.length)
        return;
    let catalog;
    try {
        catalog = _catalog || await invoke('fetch_plugin_catalog', { catalogUrl: getLinks().plugin_catalog });
        _catalog = catalog;
    }
    catch {
        return;
    }
    const entries = catalog?.plugins || [];
    let updated = 0;
    for (const p of candidates) {
        const id = p.manifest.id;
        const entry = entries.find(e => e.id === id); // verify id
        if (!entry || !entry.version)
            continue;
        if (entry.version === p.manifest.version)
            continue; // verify version differs
        const url = entry.download_url || localStorage.getItem('bmm_plugin_src_' + id);
        if (!url)
            continue;
        try {
            const fresh = await invoke('install_plugin', { downloadUrl: url });
            _installedPlugins = _installedPlugins.filter(x => x.manifest.id !== fresh.manifest.id);
            _installedPlugins.push(fresh);
            localStorage.setItem('bmm_plugin_src_' + fresh.manifest.id, url);
            updated++;
            toast((t('plugins.autoUpdated') || 'Plugin "{name}" updated to v{v}')
                .replace('{name}', fresh.manifest.name).replace('{v}', fresh.manifest.version), 'success');
        }
        catch (e) {
            console.warn('[plugins] auto-update failed for', id, e);
        }
    }
    if (updated && (_tab === 'installed' || _tab === 'manage'))
        renderTab(_tab);
}
async function loadInitialData() {
    try {
        [_installedPlugins, _allMods, _allProfiles, _apiToken] = await Promise.all([
            invoke('get_installed_plugins'),
            invoke('get_mods'),
            invoke('get_profiles'),
            invoke('get_api_token'),
        ]);
        _exePath = await invoke('get_app_exe_path').catch(() => '');
        // Flattened list of EVERY mod across ALL profiles (deduped by id), each
        // tagged with the profiles that contain it — used by the plugin creator so
        // it shows every mod regardless of the active profile (and the profile
        // filter actually works). One backend call, built once → opti.
        try {
            const allProf = await invoke('get_mods_all_profiles');
            const map = new Map();
            for (const [pid, info] of Object.entries(allProf || {})) {
                for (const m of (info?.mods || [])) {
                    let e = map.get(m.id);
                    if (!e) {
                        e = { id: m.id, name: m.name, version: m.version, profileIds: [] };
                        map.set(m.id, e);
                    }
                    if (!e.profileIds.includes(pid))
                        e.profileIds.push(pid);
                }
            }
            _allModsAll = Array.from(map.values()).sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
        }
        catch {
            _allModsAll = _allMods.slice();
        }
        try {
            _allModpacks = await fetchModpacks();
        }
        catch {
            _allModpacks = [];
        }
    }
    catch (e) {
        console.error('[PLUGINS] loadInitialData error:', e);
    }
    renderTab(_tab);
}
// ── Layout ─────────────────────────────────────────────────────────────────
function renderPluginsView() {
    const view = document.getElementById('view-plugins');
    if (!view)
        return;
    view.innerHTML = `
        <div class="view-header" style="margin-bottom:20px;">
            <div class="view-header-top">
                <h1 class="view-title" data-i18n="plugins.title">${t('plugins.title')}</h1>
                <p class="view-subtitle" data-i18n="plugins.subtitle">${t('plugins.subtitle')}</p>
            </div>
        </div>
        <div class="plug-tabs">
            <button class="plug-tab active" data-tab="installed">${IC.puzzle} ${t('plugins.tabInstalled')}</button>
            <button class="plug-tab" data-tab="catalog">${IC.globe} ${t('plugins.tabCatalog')}</button>
            <button class="plug-tab" data-tab="create">${IC.list} ${t('plugins.tabCreate')}</button>
            <button class="plug-tab" data-tab="scripts">${IC.terminal} ${t('plugins.tabScripts')}</button>
            <button class="plug-tab" data-tab="perms">${IC.shield} ${t('plugins.tabPerms')}</button>
        </div>
        <div id="plug-tab-content" class="plug-tab-content"></div>
    `;
}
function setupPluginTabs() {
    const view = document.getElementById('view-plugins');
    if (!view)
        return;
    // Tasky hover tooltips on tabs
    const TAB_TIPS = {
        installed: ['plugins.tooltipTabInstalled', 'puzzle'],
        catalog: ['plugins.tooltipTabCatalog', 'globe'],
        create: ['plugins.tooltipTabCreate', 'list'],
        scripts: ['plugins.tooltipTabScripts', 'terminal'],
        perms: ['plugins.tooltipTabPerms', 'shield'],
    };
    view.querySelectorAll('.plug-tab').forEach(tab => {
        const id = tab.dataset.tab || '';
        const tip = TAB_TIPS[id];
        if (tip) {
            tab.addEventListener('mouseenter', () => window.showTaskyHelp?.(tip[0], tip[1]));
            tab.addEventListener('mouseleave', () => window.hideTaskyHelp?.());
        }
    });
    // Intercept ALL [data-tooltip] elements inside view-plugins → use Tasky instead of CSS tooltip
    view.addEventListener('mouseover', (e) => {
        const el = e.target.closest('[data-tooltip]');
        if (!el)
            return;
        const tip = el.getAttribute('data-tooltip') || '';
        if (tip)
            window.showTaskyHelp?.(tip, 'info', true);
    });
    view.addEventListener('mouseout', (e) => {
        const el = e.target.closest('[data-tooltip]');
        if (el)
            window.hideTaskyHelp?.();
    });
    view.addEventListener('click', (e) => {
        const tab = e.target.closest('[data-tab]');
        if (!tab || !tab.classList.contains('plug-tab'))
            return;
        const tabId = tab.dataset.tab;
        if (!tabId)
            return;
        view.querySelectorAll('.plug-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        _tab = tabId;
        renderTab(tabId);
    });
}
function renderTab(tabId) {
    const container = document.getElementById('plug-tab-content');
    if (!container)
        return;
    switch (tabId) {
        case 'installed':
            renderInstalled(container);
            break;
        case 'catalog':
            renderCatalog(container);
            break;
        case 'create':
            renderCreate(container);
            break;
        case 'scripts':
            // Pre-load installed apps state so quicktest forms can list them
            invoke('get_apps_state').then(s => { window.__latestAppsState = s; }).catch(() => { });
            renderScripts(container);
            break;
        case 'perms':
            renderPerms(container);
            break;
    }
}
// ── Tab: Installed ─────────────────────────────────────────────────────────
function renderInstalled(container) {
    if (_installedPlugins.length === 0) {
        container.innerHTML = `
            <div class="plug-empty">
                <div class="plug-empty-icon">${IC.puzzle}</div>
                <p>${t('plugins.noInstalled')}</p>
                <div style="display:flex;gap:8px;">
                    <button class="btn btn-accent" id="plug-goto-catalog">${IC.globe} ${t('plugins.browseCatalog')}</button>
                    <button class="btn btn-secondary" id="plug-import-btn">${IC.upload} ${t('plugins.importFile')}</button>
                </div>
            </div>`;
        container.querySelector('#plug-goto-catalog')?.addEventListener('click', () => {
            document.querySelector('.plug-tab[data-tab="catalog"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        container.querySelector('#plug-import-btn')?.addEventListener('click', handleImportFile);
        return;
    }
    container.innerHTML = `
        <div class="plug-toolbar">
            <button class="btn btn-sm btn-secondary" id="plug-import-file">${IC.upload} ${t('plugins.importFile')}</button>
            <button class="btn btn-sm btn-ghost" id="plug-goto-catalog-btn">${IC.globe} ${t('plugins.browseCatalog')}</button>
        </div>
        <div class="plug-grid" id="plug-installed-grid"></div>`;
    const grid = container.querySelector('#plug-installed-grid');
    for (const plugin of _installedPlugins) {
        grid.appendChild(buildPluginCard(plugin, 'installed'));
    }
    container.querySelector('#plug-import-file')?.addEventListener('click', handleImportFile);
    container.querySelector('#plug-goto-catalog-btn')?.addEventListener('click', () => {
        document.querySelector('.plug-tab[data-tab="catalog"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
}
function buildPluginCard(plugin, source) {
    const card = document.createElement('div');
    card.className = `plug-card ${source === 'installed' && plugin.enabled === false ? 'plug-card--disabled' : ''}`;
    const manifest = source === 'installed' ? plugin.manifest : plugin;
    const hasModlist = !!(manifest.modlist?.required_mods?.length);
    const hasScripts = !!manifest.has_scripts || ((manifest.scripts?.length || 0) > 0);
    const fromCatalog = source === 'installed' && !!localStorage.getItem('bmm_plugin_src_' + manifest.id);
    const auOn = localStorage.getItem('bmm_plugin_au_' + manifest.id) !== 'off';
    card.innerHTML = `
        <div class="plug-card-header">
            <div class="plug-card-icon-wrap">
                ${plugin.icon_path
        ? `<img src="${convertFileSrc(plugin.icon_path)}" class="plug-card-icon" data-onerror="swap-next">`
        : ''}
                <div class="plug-card-icon-default" ${plugin.icon_path ? 'style="display:none"' : ''}>${IC.puzzle}</div>
            </div>
            <div class="plug-card-meta">
                <div class="plug-card-name">
                    <span class="plug-card-name-text">${escHtml(manifest.name)}</span>
                    ${manifest.official
        ? `<span class="plug-badge-official">${IC.star} ${t('plugins.official')}</span>`
        : `<span class="plug-badge-community">${t('plugins.community')}</span>`}
                </div>
                <div class="plug-card-sub">v${escHtml(manifest.version || '1.0.0')}${manifest.author ? ` · ${escHtml(manifest.author)}` : ''}</div>
                ${manifest.game ? `<div class="plug-card-game">${escHtml(manifest.game)}</div>` : ''}
                <!-- The two ids belong WITH the name, not in the row of verbs. They were
                     sitting between "Compare" and "Apply" as two labelled buttons, which
                     made the widest thing on the card the one nobody presses most. -->
                <div class="plug-card-ids">${copyIdButtons('plugin', manifest.id, { compact: true })}</div>
            </div>
        </div>
        ${manifest.description ? `<p class="plug-card-desc">${escHtml(manifest.description)}</p>` : ''}
        ${source === 'installed' && hasModlist ? `
            <div class="plug-card-modlist-info">
                ${IC.list}
                <span class="plug-modlist-count">${manifest.modlist.required_mods.length} ${t('plugins.modsRequired')}</span>
                ${manifest.modlist.strict ? `<span class="plug-badge-strict">${t('plugins.strict')}</span>` : ''}
            </div>` : ''}
        ${manifest.tags?.length ? `
            <div class="plug-card-tags">
                ${manifest.tags.map(tag => `<span class="plug-tag">${escHtml(tag)}</span>`).join('')}
            </div>` : ''}
        <div class="plug-card-actions">
            ${source === 'installed' ? `
                ${hasModlist ? `
                    <button class="btn btn-sm btn-accent plug-btn-compare" data-id="${escHtml(manifest.id)}" data-tooltip="${t('plugins.compareTip')}">
                        ${IC.search} ${t('plugins.compare')}
                    </button>` : ''}
                ${(hasModlist || hasScripts) ? `
                    <button class="btn btn-sm btn-secondary plug-btn-apply" data-id="${escHtml(manifest.id)}" data-tooltip="${t('plugins.applyTip')}">
                        ${IC.play} ${t('plugins.apply')}
                    </button>` : ''}
                <div class="plug-card-actions-right">
                    <!-- The two questions somebody asks before trusting a plugin, as their
                         own buttons rather than as the eighth and ninth icon in a row.
                         Everything that CHANGES something is behind the menu; these two only
                         look. -->
                    <button class="btn btn-xs btn-ghost plug-btn-perms" data-id="${escHtml(manifest.id)}"
                        data-name="${escAttr(manifest.name)}" data-tooltip="${escAttr(t('plugins.perm.tip'))}">
                        ${IC.lock} <span class="plug-btn-word">${escHtml(t('plugins.perm.word'))}</span>
                    </button>
                    <button class="btn btn-xs btn-ghost plug-btn-content" data-id="${escHtml(manifest.id)}"
                        data-name="${escAttr(manifest.name)}" data-tooltip="${escAttr(t('plugins.tree.tip'))}">
                        ${IC.folder} <span class="plug-btn-word">${escHtml(t('plugins.tree.word'))}</span>
                    </button>
                    <button class="btn btn-xs btn-ghost plug-btn-inspect" data-id="${escHtml(manifest.id)}" data-tooltip="${escAttr(t('plugins.inspect'))}">
                        ${IC.eye} <span class="plug-btn-word">${escHtml(t('plugins.inspectWord'))}</span>
                    </button>
                    ${plugin.install_dir ? `
                    <span class="plug-sha-badge plug-sha-badge--pending plug-btn-sha" data-id="${escHtml(manifest.id)}" data-tooltip="${t('plugins.checksumTitle')}">
                        ${IC.hash} SHA
                    </span>` : ''}
                    <!-- The rest. Seven icons that each did something different and looked
                         the same; a menu names them. -->
                    <div class="plug-more" data-id="${escHtml(manifest.id)}">
                        <button class="btn btn-xs btn-ghost plug-more-btn" data-tooltip="${escAttr(t('plugins.more'))}" aria-haspopup="true" aria-expanded="false">⋮</button>
                        <div class="plug-more-menu" hidden>
                            ${fromCatalog ? `
                            <button class="plug-more-item plug-btn-au ${auOn ? 'plug-au-on' : ''}" data-id="${escHtml(manifest.id)}">
                                ${IC.refresh} ${escHtml(auOn ? (t('plugins.autoUpdateOn') || 'Auto-update: ON') : (t('plugins.autoUpdateOff') || 'Auto-update: OFF'))}
                            </button>` : ''}
                            <button class="plug-more-item plug-btn-assets" data-id="${escHtml(manifest.id)}" hidden>
                                ${IC.paperclip} ${escHtml(t('plugins.assets.tip'))}
                            </button>
                            ${manifest.bundles?.length ? `
                            <button class="plug-more-item plug-btn-bundles" data-id="${escHtml(manifest.id)}">
                                ${IC.download} ${escHtml(t('plugins.bundle.follow'))}
                            </button>` : ''}
                            <button class="plug-more-item plug-btn-folder" data-id="${escHtml(manifest.id)}" data-dir="${escHtml(plugin.install_dir || '')}">
                                ${IC.folder} ${escHtml(t('plugins.openFolder'))}
                            </button>
                            <button class="plug-more-item plug-btn-edit" data-id="${escHtml(manifest.id)}">
                                ${IC.editIcon} ${escHtml(t('plugins.editPlugin'))}
                            </button>
                            <button class="plug-more-item plug-btn-duplicate" data-id="${escHtml(manifest.id)}">
                                ${IC.duplicate} ${escHtml(t('plugins.duplicate'))}
                            </button>
                            <button class="plug-more-item plug-btn-export" data-id="${escHtml(manifest.id)}">
                                ${IC.exportIcon} ${escHtml(t('common.export'))}
                            </button>
                            <!-- Last, behind a separator, and the only one that is red.
                                 Removing a plugin is not a peer of duplicating one. -->
                            <button class="plug-more-item plug-more-danger plug-btn-uninstall" data-id="${escHtml(manifest.id)}">
                                ${IC.trash} ${escHtml(t('plugins.uninstall'))}
                            </button>
                        </div>
                    </div>
                </div>
            ` : `
                <button class="btn btn-sm btn-accent plug-btn-install"
                    data-url="${escHtml(manifest.download_url || '')}"
                    data-local="${manifest._local ? '1' : ''}"
                    data-name="${escHtml(manifest.name)}">
                    ${IC.download} ${t('plugins.install')}
                </button>
            `}
        </div>
        ${source === 'catalog' && !manifest.official ? `
            <div class="plug-community-warning">
                ${IC.alert} ${t('plugins.communityWarning')}
            </div>` : ''}
    `;
    // The assets button reveals itself only if there is something behind it.
    //
    // Hidden by default and unhidden after the count comes back, rather than the card
    // waiting on a disk walk before it draws: most plugins ship no assets, and a grid that
    // renders a frame late for all of them to spare one button is the wrong trade.
    const assetsBtn = card.querySelector('.plug-btn-assets');
    if (assetsBtn && source === 'installed') {
        void (async () => {
            const { listAssets, openPluginAssets } = await import('./plugin-assets.js');
            const found = await listAssets(manifest.id);
            if (!found.length)
                return;
            assetsBtn.hidden = false;
            assetsBtn.dataset.count = String(found.length);
            assetsBtn.addEventListener('click', () => void openPluginAssets(manifest.id, manifest.name));
        })();
    }
    wireCopyIds(card, toast);
    card.querySelector('.plug-btn-compare')?.addEventListener('click', () => handleCompare(manifest.id));
    card.querySelector('.plug-btn-apply')?.addEventListener('click', () => handleApply(manifest.id));
    card.querySelector('.plug-btn-export')?.addEventListener('click', () => handleExport(manifest.id, manifest.name));
    card.querySelector('.plug-btn-uninstall')?.addEventListener('click', () => handleUninstall(manifest.id, manifest.name));
    card.querySelector('.plug-btn-inspect')?.addEventListener('click', () => handleInspect(plugin));
    card.querySelector('.plug-btn-bundles')?.addEventListener('click', () => void installPluginBundles(manifest.id));
    card.querySelector('.plug-btn-perms')?.addEventListener('click', async (e) => {
        const b = e.currentTarget;
        const { openPluginPermissions } = await import('./plugin-inspect.js');
        await openPluginPermissions(b.dataset.id || '', b.dataset.name || '', (m, k) => toast(m, k), { requested: manifest.permissions || [] });
    });
    card.querySelector('.plug-btn-content')?.addEventListener('click', async (e) => {
        const b = e.currentTarget;
        const { openPluginContent } = await import('./plugin-inspect.js');
        await openPluginContent(b.dataset.id || '', b.dataset.name || '');
    });
    // The overflow menu. Closes on a second click, on Escape, and on any click outside —
    // a menu that only closes by re-pressing its own button is one people leave open.
    {
        const wrap = card.querySelector('.plug-more');
        const btn = wrap?.querySelector('.plug-more-btn');
        const menu = wrap?.querySelector('.plug-more-menu');
        if (wrap && btn && menu) {
            const shut = () => {
                menu.hidden = true;
                btn.setAttribute('aria-expanded', 'false');
                document.removeEventListener('click', away, true);
                document.removeEventListener('keydown', onEsc, true);
            };
            const away = (ev) => { if (!wrap.contains(ev.target))
                shut(); };
            const onEsc = (ev) => { if (ev.key === 'Escape') {
                ev.stopPropagation();
                shut();
            } };
            /**
             * Put it where the button is.
             *
             * The menu is `position: fixed`, because `.plug-card` is `overflow: hidden` and
             * an absolutely positioned child was simply CLIPPED BY THE CARD — it opened
             * every time and was never visible, which reads exactly like a dead button.
             * Fixed means it is placed against the viewport, so the coordinates have to come
             * from here.
             */
            const place = () => {
                const r = btn.getBoundingClientRect();
                menu.style.visibility = 'hidden';
                menu.hidden = false;
                const h = menu.offsetHeight || 240;
                const w = menu.offsetWidth || 190;
                // Right-aligned to the button, and flipped above it when there is no room
                // below — a card near the bottom of the list is the ordinary case.
                const below = window.innerHeight - r.bottom;
                menu.style.top = `${below < h + 8 && r.top > h + 8 ? r.top - h - 4 : r.bottom + 4}px`;
                menu.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
                menu.style.visibility = '';
            };
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (!menu.hidden) {
                    shut();
                    return;
                }
                place();
                btn.setAttribute('aria-expanded', 'true');
                document.addEventListener('click', away, true);
                document.addEventListener('keydown', onEsc, true);
                // A fixed menu does not travel with the card it belongs to, so scrolling
                // would leave it hanging over unrelated rows. Closed rather than followed:
                // it is a menu, not a tooltip.
                window.addEventListener('scroll', shut, { once: true, capture: true });
                window.addEventListener('resize', shut, { once: true });
            });
            // Anything chosen closes it: the action opens a dialog or navigates, and a menu
            // left hanging over the result is the thing people click by accident next.
            menu.addEventListener('click', () => shut());
        }
    }
    card.querySelector('.plug-btn-edit')?.addEventListener('click', () => handleEditPlugin(manifest));
    card.querySelector('.plug-btn-duplicate')?.addEventListener('click', () => handleDuplicatePlugin(manifest));
    card.querySelector('.plug-btn-au')?.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        const nowOn = localStorage.getItem('bmm_plugin_au_' + manifest.id) === 'off'; // toggling to ON
        if (nowOn)
            localStorage.removeItem('bmm_plugin_au_' + manifest.id);
        else
            localStorage.setItem('bmm_plugin_au_' + manifest.id, 'off');
        btn.classList.toggle('plug-au-on', nowOn);
        btn.setAttribute('data-tooltip', nowOn
            ? (t('plugins.autoUpdateOn') || 'Auto-update: ON (re-installs when the catalog version changes)')
            : (t('plugins.autoUpdateOff') || 'Auto-update: OFF'));
        toast(nowOn
            ? (t('plugins.autoUpdateEnabledP') || 'Auto-update enabled for this plugin')
            : (t('plugins.autoUpdateDisabledP') || 'Auto-update disabled for this plugin'), 'info');
    });
    card.querySelector('.plug-btn-folder')?.addEventListener('click', () => {
        const dir = card.querySelector('.plug-btn-folder')?.dataset.dir || plugin.install_dir || '';
        if (dir)
            invoke('open_folder', { path: dir }).catch(() => { });
    });
    const shaBadge = card.querySelector('.plug-btn-sha');
    if (shaBadge) {
        // Load existing checksum or compute on demand
        invoke('compute_plugin_checksum', { pluginId: manifest.id }).then((hash) => {
            shaBadge.innerHTML = `${IC.hash} ${hash.substring(0, 8)}…`;
            shaBadge.classList.remove('plug-sha-badge--pending');
            shaBadge.dataset.full = hash;
        }).catch(() => { });
        shaBadge.addEventListener('click', () => {
            const hash = shaBadge.dataset.full || '';
            if (hash)
                handlePluginChecksumModal(manifest, plugin.install_dir, hash);
        });
    }
    card.querySelector('.plug-btn-install')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.plug-btn-install');
        handleInstall(btn?.dataset.url, btn?.dataset.name, btn?.dataset.local === '1');
    });
    return card;
}
// ── Tab: Catalog ───────────────────────────────────────────────────────────
// Community plugin catalogs the user added (http/https URLs or local .json paths).
// Persisted in localStorage so they survive restarts.
const PLUG_CAT_SOURCES_KEY = 'bmm_plugin_catalogs';
function getPluginCatalogSources() {
    try {
        return JSON.parse(localStorage.getItem(PLUG_CAT_SOURCES_KEY) || '[]');
    }
    catch {
        return [];
    }
}
function setPluginCatalogSources(list) {
    localStorage.setItem(PLUG_CAT_SOURCES_KEY, JSON.stringify(list));
}
function isUrlSource(src) {
    return /^https?:\/\//i.test(src.trim());
}
// Fetch one community source.
//
//   https://…        → fetch_plugin_catalog
//   bundle:<path>    → a single file holding the catalogue AND the .bmmplug files
//   any other path   → a local catalog.json, read and parsed
//
// The `bundle:` prefix is explicit rather than sniffed: guessing that a source is a bundle
// because it ends in .zip would make a mistyped URL into a file read.
async function fetchCommunityCatalog(src) {
    let cat;
    let dir = '';
    if (src.startsWith('bundle:')) {
        const res = await invoke('catalog_bundle_open', { path: src.slice('bundle:'.length) });
        dir = String(res?.dir || '');
        cat = JSON.parse(String(res?.catalog || ''));
    }
    else if (isUrlSource(src)) {
        cat = await invoke('fetch_plugin_catalog', { catalogUrl: src });
    }
    else {
        const text = await invoke('read_file_text', { path: src });
        cat = JSON.parse(text);
    }
    const plugins = (cat?.plugins || []);
    // Community sources are never "official" — force the community badge/warning.
    return plugins.map((p) => {
        // Inside a bundle an entry may name a file that travelled with it, or still point
        // at a URL — both are legal in the same catalogue, and the kind is decided per
        // entry. `_local` says which, so the installer reaches for the disk or the network
        // deliberately instead of sniffing the string later.
        const inside = dir && bundleEntryKind(p?.download_url) === 'inside';
        const resolved = inside ? resolveBundleEntry(p.download_url, dir) : '';
        return {
            ...p,
            official: false,
            _source: src,
            ...(resolved ? { download_url: resolved, _local: true } : {}),
        };
    });
}
// Merge official catalog + all community sources, de-duped by id (official wins).
async function fetchMergedPluginCatalog() {
    const errors = [];
    let official = [];
    try {
        const cat = await invoke('fetch_plugin_catalog', { catalogUrl: getLinks().plugin_catalog });
        official = cat?.plugins || [];
    }
    catch (e) {
        errors.push(`${t('plugins.catalogOfficial') || 'Official catalog'}: ${e}`);
    }
    const byId = new Map();
    for (const p of official)
        byId.set(p.id, p);
    // enabledOnly: a source switched off stays in the list and is not fetched. Wrapped at the
    // loop rather than inside fetchCommunityCatalog, so the skip is visible where the sources
    // are chosen instead of hidden one level down.
    for (const src of enabledOnly(getPluginCatalogSources())) {
        try {
            const plugins = await fetchCommunityCatalog(src);
            for (const p of plugins)
                if (!byId.has(p.id))
                    byId.set(p.id, p);
        }
        catch (e) {
            errors.push(`${src}: ${e}`);
        }
    }
    return { plugins: [...byId.values()], errors };
}
async function renderCatalog(container) {
    container.innerHTML = `
        <div class="plug-community-banner">
            ${IC.alert}
            <div>
                <strong>${t('plugins.communityBannerTitle')}</strong>
                <span>${t('plugins.communityBannerDesc')}</span>
            </div>
        </div>
        <div class="plug-toolbar">
            <div class="plug-search-wrap">
                ${IC.search}
                <input type="text" id="plug-catalog-search" class="input plug-search-input" placeholder="${t('plugins.searchPlaceholder')}">
            </div>
            <button class="btn btn-sm btn-ghost" id="plug-refresh-catalog">${IC.refresh} ${t('plugins.refresh')}</button>
            <button class="btn btn-sm btn-ghost" id="plug-toggle-sources">${IC.globe} ${t('plugins.communityCatalogs') || 'Community catalogs'}</button>
            <button class="btn btn-sm btn-ghost" id="plug-my-catalogs">${IC.list} ${t('plugins.myCatalogs') || 'My catalogs'}</button>
            <button class="btn btn-sm btn-secondary" id="plug-import-file-cat">${IC.upload} ${t('plugins.importFile')}</button>
        </div>
        <div id="plug-sources-panel" class="plug-sources-panel" style="display:none">
            <p class="plug-sources-desc">${t('plugins.communityCatalogsDesc') || 'Import custom plugin catalogs by HTTPS/HTTP link or local .json file. Community plugins are unverified — install at your own risk.'}</p>
            <div class="plug-sources-add">
                <input type="text" id="plug-source-input" class="input" placeholder="https://.../catalog.json">
                <button class="btn btn-sm btn-accent" id="plug-source-add">${IC.plus} ${t('common.add') || 'Add'}</button>
                <button class="btn btn-sm btn-ghost" id="plug-source-file">${IC.upload} ${t('plugins.importJsonFile') || 'Import .json'}</button>
                <button class="btn btn-sm btn-ghost" id="plug-source-bundle"
                        title="${escAttr(t('plugins.openBundleTip'))}">${IC.upload} ${t('plugins.openBundle')}</button>
            </div>
            ${sourceAccessHtml('plug')}
            <div id="plug-sources-list" class="plug-sources-list"></div>
        </div>
        <div id="plug-catalog-grid" class="plug-grid">
            <div class="plug-loading">${t('common.loading')}</div>
        </div>`;
    container.querySelector('#plug-refresh-catalog')?.addEventListener('click', async () => {
        _catalog = null;
        await renderCatalog(container);
    });
    container.querySelector('#plug-import-file-cat')?.addEventListener('click', handleImportFile);
    container.querySelector('#plug-my-catalogs')?.addEventListener('click', () => openPluginCatalogBuilder(() => renderCatalog(container)));
    container.querySelector('#plug-catalog-search')?.addEventListener('input', (e) => {
        filterCatalogGrid(e.target.value);
    });
    // ── Community-catalog sources management ──────────────────────────────────
    const panel = container.querySelector('#plug-sources-panel');
    container.querySelector('#plug-toggle-sources')?.addEventListener('click', () => {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
    const reloadCatalog = async () => { _catalog = null; await renderCatalog(container); };
    const addSource = async (src) => {
        src = src.trim();
        if (!src)
            return;
        const list = getPluginCatalogSources();
        if (list.includes(src)) {
            toast(t('plugins.sourceExists') || 'Source already added', 'info');
            return;
        }
        // An INDEX pasted here is the common mistake, and it is a real intention rather than a
        // typo: the boxes all take a URL and none says which document it wants. Import its
        // PLUGIN entries and leave its other four types alone.
        if (isUrlSource(src)) {
            try {
                const probe = await fetchSourceText(src, true);
                const doc = JSON.parse(probe);
                if (looksLikeIndex(doc)) {
                    const r = await importIndexForType(doc, 'plugin', src, undefined, writeSources);
                    toast(r.added
                        ? (t('plugins.fromIndex') || 'Added {n} plugin catalog(s) from that index.').replace('{n}', String(r.added))
                        : r.ofType
                            ? (t('plugins.indexAll') || 'That index lists {n} plugin catalog(s) and you already follow them all.').replace('{n}', String(r.ofType))
                            : (t('plugins.indexNone2') || 'No plugin catalogues in that index — it holds {what}. Add those from their own screens.')
                                .replace('{what}', describeKinds(r.kinds) || String(r.total)), r.added ? 'success' : 'info');
                    await reloadCatalog();
                    return;
                }
            }
            catch { /* unreachable or not JSON — the normal add path reports it properly */ }
        }
        // Validate it actually loads before persisting.
        try {
            await fetchCommunityCatalog(src);
        }
        catch (e) {
            // A private community catalog the caller isn't allowed to see (the identity
            // header didn't match its access list). Point them at the share-link path.
            if (/forbidden|private/i.test(String(e))) {
                toast(t('plugins.sourcePrivate') || 'This catalog is private — ask its owner for access, or use a share link (…?k=…).', 'error');
                return;
            }
            toast(`${t('plugins.sourceLoadFail') || 'Could not load catalog'}: ${e}`, 'error');
            return;
        }
        list.push(src);
        setPluginCatalogSources(list);
        toast(t('plugins.sourceAdded') || 'Catalog added', 'success');
        await reloadCatalog();
    };
    // After the markup, not inside the Add handler — see the note in apps-catalog.ts.
    wireSourceAccess('plug', (m, k) => toast(m, k === 'warning' ? 'warning' : 'success'), () => { document.getElementById('nav-settings')?.click(); setTimeout(() => document.getElementById('settings-identity-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250); }, () => container.querySelector('#plug-source-input')?.value?.trim() || '');
    container.querySelector('#plug-source-add')?.addEventListener('click', () => {
        const inp = container.querySelector('#plug-source-input');
        addSource(inp.value);
    });
    container.querySelector('#plug-source-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addSource(e.target.value);
        }
    });
    container.querySelector('#plug-source-file')?.addEventListener('click', async () => {
        const path = await pickFile({ filters: [{ name: 'JSON catalog', extensions: ['json'] }] });
        if (path)
            await addSource(path);
    });
    // A catalogue that came as one file, plugins included. Opened before it is added, so a
    // file that is not one fails HERE with the reason rather than becoming a source that
    // errors every time this tab is drawn.
    container.querySelector('#plug-source-bundle')?.addEventListener('click', async () => {
        const path = await pickFile({ filters: [{ name: t('catpub.bundleKind'), extensions: ['bmmbundle', 'zip'] }] });
        if (!path)
            return;
        try {
            const res = await invoke('catalog_bundle_open', { path });
            const doc = JSON.parse(String(res?.catalog || ''));
            if (!Array.isArray(doc?.plugins)) {
                toast(t('plugins.bundleNotPluginCat'), 'error');
                return;
            }
            await addSource(`bundle:${path}`);
        }
        catch (e) {
            toast(`${t('plugins.bundleBad')}: ${e}`, 'error');
        }
    });
    renderSourcesList(container);
    try {
        if (!_catalog) {
            const merged = await fetchMergedPluginCatalog();
            _catalog = { version: '', plugins: merged.plugins };
            if (merged.errors.length && merged.plugins.length === 0)
                throw new Error(merged.errors.join('; '));
        }
        renderCatalogGrid(_catalog.plugins);
    }
    catch (e) {
        const grid = document.getElementById('plug-catalog-grid');
        if (grid)
            grid.innerHTML = `
            <div class="plug-catalog-unavail">
                <div class="plug-catalog-unavail-icon">${IC.globe}</div>
                <strong>${t('plugins.catalogUnavailTitle')}</strong>
                <p>${t('plugins.catalogUnavailDesc')}</p>
                <a class="btn btn-sm btn-ghost" href="${getLinks().plugin_github}" target="_blank">${IC.globe} GitHub</a>
            </div>`;
    }
}
const MY_PLUG_CAT_KEY = 'bmm_my_plugin_catalogs';
function getMyPluginCatalogs() {
    try {
        return JSON.parse(localStorage.getItem(MY_PLUG_CAT_KEY) || '[]');
    }
    catch {
        return [];
    }
}
function setMyPluginCatalogs(list) {
    localStorage.setItem(MY_PLUG_CAT_KEY, JSON.stringify(list));
}
// The BMM-native catalog.json shape a draft exports to (matches fetch_plugin_catalog).
function draftToCatalogJson(d) {
    return JSON.stringify({
        version: d.version || '1.0',
        name: d.name || 'My catalog',
        plugins: d.plugins.map(p => ({
            id: p.id, name: p.name, version: p.version || '1.0.0', author: p.author || '',
            description: p.description || '', game: p.game || '', official: false,
            download_url: p.download_url || '', tags: p.tags || [], icon_url: p.icon_url || null,
        })),
    }, null, 2);
}
function openPluginCatalogBuilder(onSourcesChanged) {
    const ov = createOverlay('');
    const panel = ov.querySelector('.plug-overlay-panel');
    let editing = null; // null = list view
    const close = () => ov.remove();
    const saveDraft = (d) => {
        const all = getMyPluginCatalogs();
        const i = all.findIndex(x => x.id === d.id);
        if (i >= 0)
            all[i] = d;
        else
            all.push(d);
        setMyPluginCatalogs(all);
    };
    // ── List view ──
    const renderList = () => {
        const drafts = getMyPluginCatalogs();
        panel.innerHTML = `
            <div class="plug-ov-head">
                <h3>${IC.list} ${t('plugins.myCatalogs') || 'My plugin catalogs'}</h3>
                <button class="plug-ov-close-btn btn btn-sm btn-ghost">${IC.x}</button>
            </div>
            <p class="plug-cat-desc">${t('plugins.myCatalogsDesc') || 'Build your own plugin catalog from your installed plugins, then export it or add it as a source. To share it publicly, host it on BetterCommunity.'}</p>
            <div class="plug-cat-list">
                ${drafts.length ? drafts.map(d => `
                    <div class="plug-cat-row" data-id="${escAttr(d.id)}">
                        <div class="plug-cat-row-info">
                            <span class="plug-cat-row-name">${escHtml(d.name || t('plugins.untitledCatalog') || 'Untitled catalog')}</span>
                            <span class="plug-cat-row-meta">v${escHtml(d.version || '1.0')} · ${d.plugins.length} ${t('plugins.pluginsCount') || 'plugin(s)'}</span>
                        </div>
                        <button class="btn btn-xs btn-secondary plug-cat-edit" data-id="${escAttr(d.id)}">${t('plugins.edit') || 'Edit'}</button>
                        <button class="btn btn-xs btn-ghost plug-cat-export" data-id="${escAttr(d.id)}">${IC.exportIcon} ${t('plugins.export') || 'Export'}</button>
                        <button class="btn btn-xs btn-ghost plug-cat-publish" data-id="${escAttr(d.id)}"
                                title="${escAttr(t('plugins.catPublishTip') || 'Write a folder holding the catalogue AND the plugins — optionally as one file, so it can be sent with no host at all')}">${IC.upload || IC.exportIcon} ${t('plugins.catPublish') || 'Publish…'}</button>
                        <button class="btn btn-xs btn-ghost plug-cat-del" data-id="${escAttr(d.id)}" style="color:var(--danger)">${IC.trash || IC.x}</button>
                    </div>`).join('') : `<p class="plug-sources-empty">${t('plugins.noMyCatalogs') || 'No catalog yet — create your first one.'}</p>`}
            </div>
            <div class="plug-ov-actions">
                <button class="btn btn-accent" id="plug-cat-new">${IC.plus} ${t('plugins.newCatalog') || 'New catalog'}</button>
            </div>`;
        panel.querySelector('.plug-ov-close-btn')?.addEventListener('click', close);
        panel.querySelector('#plug-cat-new')?.addEventListener('click', () => {
            editing = { id: `cat-${Date.now().toString(36)}`, name: '', version: '1.0', plugins: [] };
            renderEditor();
        });
        panel.querySelectorAll('.plug-cat-edit').forEach(b => b.addEventListener('click', () => {
            editing = JSON.parse(JSON.stringify(drafts.find(d => d.id === b.dataset.id)));
            renderEditor();
        }));
        panel.querySelectorAll('.plug-cat-export').forEach(b => b.addEventListener('click', () => {
            const d = drafts.find(x => x.id === b.dataset.id);
            if (d)
                exportDraft(d);
        }));
        panel.querySelectorAll('.plug-cat-publish').forEach(b => b.addEventListener('click', async () => {
            const d = drafts.find(x => x.id === b.dataset.id);
            if (!d)
                return;
            // Asked, not assumed: the folder is the host-it-on-GitHub shape and the single
            // file is the send-it-to-one-person shape, and neither is the obvious default.
            // The shared confirm only has yes and no, so the question is phrased to fit that
            // rather than pretending there are two equal buttons.
            const one = await showConfirm(t('plugins.catPublishTitle'), t('plugins.catPublishAsk'), false);
            await publishDraft(d, one === true);
        }));
        panel.querySelectorAll('.plug-cat-del').forEach(b => b.addEventListener('click', async () => {
            const ok = await window.confirmCustom(t('plugins.deleteCatalog') || 'Delete catalog?', t('plugins.deleteCatalogDesc') || 'This removes the draft from this device. Exported files are not affected.', 'danger', { yesLabel: t('common.delete') || 'Delete', noLabel: t('common.cancel') || 'Cancel' });
            if (!ok)
                return;
            setMyPluginCatalogs(getMyPluginCatalogs().filter(x => x.id !== b.dataset.id));
            renderList();
        }));
    };
    // ── Export helpers ──
    const exportDraft = async (d) => {
        const slug = (d.name || 'catalog').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'catalog';
        const path = await saveFile({ defaultPath: `${slug}.json`, filters: [{ name: 'JSON catalog', extensions: ['json'] }] });
        if (!path)
            return null;
        try {
            await invoke('write_text_file', { path, content: draftToCatalogJson(d) });
            toastSaved(t('plugins.catalogExported') || 'Catalog exported');
            return path;
        }
        catch (e) {
            toast(`${t('common.error')}: ${e}`, 'error');
            return null;
        }
    };
    /**
     * Write the catalogue as a FOLDER, with the plugins in it.
     *
     * `exportDraft` above writes the catalog.json on its own, which is the right thing when
     * the plugins are already hosted somewhere — the entry carries a URL and BMM downloads
     * it. This is the other case: the plugins travel WITH the catalogue.
     *
     * **The per-entry choice is the address field you already fill in.** An entry with a
     * download_url is LINKED and left completely alone; an entry with an empty one is
     * PACKED, if its plugin is installed. No new control, and the rule reads off the screen:
     * fill the address in and it stays where you put it, leave it blank and it travels with
     * the catalogue.
     *
     * A packed entry is exported beside the catalogue as `<id>.bmmplug`, through the same
     * `export_plugin` a hand-export uses — signed, whole folder, nothing thinner than what
     * you would have sent by hand — and its address becomes the bare filename, which is
     * relative, so the folder keeps working when it is moved or forked.
     *
     * So one catalogue can carry the three small plugins and still point at the 90 MB one
     * on a CDN, which is the whole point.
     */
    const publishDraft = async (d, bundle) => {
        const slug = (d.name || 'catalog').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'catalog';
        // ONE destination. A bundle is built in a staging folder nobody sees and saved
        // where you say — it used to fill a folder you picked with .bmmplug files and drop
        // a zip in among them, so publishing to Desktop published onto your Desktop.
        let dir = null;
        let bundleOut = '';
        if (bundle) {
            bundleOut = (await saveFile({
                defaultPath: `${slug}.bmmbundle`,
                filters: [{ name: t('catpub.bundleKind'), extensions: ['bmmbundle'] }],
            }).catch(() => null));
            if (!bundleOut)
                return;
            dir = (await invoke('catalog_bundle_stage').catch(() => null));
            if (!dir) {
                toast(t('catpub.stageFailed'), 'error');
                return;
            }
        }
        else {
            dir = await pickFolder().catch(() => null);
            if (!dir)
                return;
        }
        const sep = dir.includes('\\') ? '\\' : '/';
        try {
            const out = JSON.parse(JSON.stringify(d));
            let packed = 0;
            let kept = 0;
            for (const entry of out.plugins) {
                // An address already given is a decision already made.
                if ((entry.download_url || '').trim()) {
                    kept++;
                    continue;
                }
                // A file that was handed over is COPIED. export_plugin can only export what is
                // installed here, so calling it for one of these would fail on a catalogue that
                // is otherwise correct.
                if (entry.src_file) {
                    const file = `${entry.id}.bmmplug`;
                    try {
                        await invoke('copy_file', { src: entry.src_file, dest: `${dir}${sep}${file}` });
                        entry.download_url = file;
                        packed++;
                    }
                    catch {
                        toast((t('plugins.catNoSource')).replace('{id}', entry.id), 'warning');
                        kept++;
                    }
                    continue;
                }
                const installed = _installedPlugins.find((p) => p.manifest.id === entry.id);
                if (!installed) {
                    // Blank address AND not installed: there is nothing to pack and nothing to
                    // point at, so the entry would publish as unfollowable. Named, not dropped.
                    toast((t('plugins.catNoSource')).replace('{id}', entry.id), 'warning');
                    kept++;
                    continue;
                }
                const file = `${entry.id}.bmmplug`;
                try {
                    await invoke('export_plugin', { pluginId: entry.id, destPath: `${dir}${sep}${file}` });
                    entry.download_url = file;
                    packed++;
                }
                catch (e) {
                    // Named, and the entry keeps its old address: a catalogue that silently lost
                    // one plugin is worse than one that says which.
                    toast(`${t('plugins.catPackFailed') || 'Could not pack'} ${entry.id}: ${e}`, 'warning');
                    kept++;
                }
            }
            try {
                await invoke('write_text_file', { path: `${dir}${sep}catalog.json`, content: draftToCatalogJson(out) });
            }
            catch (e) {
                toast(`${t('common.error')}: ${e}`, 'error');
                return;
            }
            let bundleNote = '';
            if (bundleOut) {
                const res = await invoke('catalog_bundle_pack', { dir, out: bundleOut })
                    .catch((e) => { toast(`${t('common.error')}: ${e}`, 'error'); return null; });
                if (res) {
                    bundleNote = ` — ${t('plugins.catPacked').replace('{f}', String(bundleOut).replace(/^.*[/\\]/, ''))}`;
                    if (res.missing?.length) {
                        toast(t('plugins.catPackMissing')
                            .replace('{n}', String(res.missing.length))
                            .replace('{list}', res.missing.slice(0, 5).join(', ')), 'warning', 7000);
                    }
                }
            }
            toast(t('plugins.catPublished')
                .replace('{n}', String(packed)).replace('{k}', String(kept)) + bundleNote, 'success');
        }
        finally {
            // Whatever happened. A half-written staging folder is a copy of somebody's
            // plugins sitting in temp.
            if (bundleOut && dir)
                await invoke('catalog_bundle_unstage', { dir }).catch(() => { });
        }
    };
    // ── Editor view ──
    const renderEditor = () => {
        const d = editing;
        panel.innerHTML = `
            <div class="plug-ov-head">
                <h3>${IC.list} ${t('plugins.editCatalog') || 'Edit catalog'}</h3>
                <button class="plug-ov-close-btn btn btn-sm btn-ghost">${IC.x}</button>
            </div>
            <div class="plug-cat-meta">
                <div class="plug-form-row"><label class="plug-form-label">${t('plugins.catalogName') || 'Catalog name'} *</label><input type="text" id="pcb-name" class="input" value="${escAttr(d.name)}" placeholder="${escAttr(t('plugins.phServerPlugins'))}"></div>
                <div class="plug-form-row" style="max-width:120px;"><label class="plug-form-label">${t('plugins.createVersion')}</label><input type="text" id="pcb-version" class="input" value="${escAttr(d.version)}"></div>
            </div>
            <div class="plug-cat-addbar">
                <select id="pcb-pick" class="select select-sm">
                    <option value="">${t('plugins.addFromInstalled') || '+ Add from installed plugin…'}</option>
                    ${_installedPlugins.map(p => `<option value="${escAttr(p.manifest.id)}">${escHtml(p.manifest.name || p.manifest.id)}</option>`).join('')}
                </select>
                <button class="btn btn-sm btn-ghost" id="pcb-add-file">${IC.upload} ${escHtml(t('plugins.addFromFile'))}</button>
                <button class="btn btn-sm btn-ghost" id="pcb-add-empty">${IC.plus} ${t('plugins.addManual') || 'Add empty entry'}</button>
            </div>
            <div id="pcb-entries" class="plug-cat-entries"></div>
            <div class="plug-ov-actions">
                <button class="btn btn-ghost" id="pcb-back">${t('common.back') || 'Back'}</button>
                <div style="flex:1"></div>
                <button class="btn btn-secondary" id="pcb-export">${IC.exportIcon} ${t('plugins.export') || 'Export'}</button>
                <button class="btn btn-secondary" id="pcb-export-source">${IC.globe} ${t('plugins.exportAndSource') || 'Export & add as source'}</button>
                <button class="btn btn-accent" id="pcb-save">${IC.save} ${t('plugins.saveLocal') || 'Save'}</button>
            </div>`;
        renderEntries();
        panel.querySelector('.plug-ov-close-btn')?.addEventListener('click', close);
        panel.querySelector('#pcb-back')?.addEventListener('click', () => { editing = null; renderList(); });
        const readMeta = () => {
            d.name = panel.querySelector('#pcb-name').value.trim();
            d.version = panel.querySelector('#pcb-version').value.trim() || '1.0';
        };
        panel.querySelector('#pcb-pick')?.addEventListener('change', (e) => {
            const id = e.target.value;
            if (!id)
                return;
            const pl = _installedPlugins.find(p => p.manifest.id === id);
            if (pl && !d.plugins.some(x => x.id === pl.manifest.id)) {
                const m = pl.manifest;
                // Everything the manifest actually says, including the icon — which was
                // dropped, so a catalogue built from installed plugins published them all
                // iconless while the same plugins had icons two screens away.
                //
                // `download_url` stays EMPTY on purpose: empty means "pack this one" at
                // publish time, and an installed plugin is exactly the case where packing is
                // possible. Filling it with a guess would silently turn that off.
                d.plugins.push({
                    id: m.id,
                    name: m.name || m.id,
                    version: m.version || '1.0.0',
                    author: m.author || '',
                    description: m.description || '',
                    game: m.game || '',
                    official: false,
                    download_url: '',
                    tags: Array.isArray(m.tags) ? m.tags : [],
                    icon_url: m.icon_url || m.icon || null,
                });
                renderEntries();
            }
            e.target.value = '';
        });
        // A .bmmplug somebody sent you. Building a catalogue used to mean installing every
        // plugin going into it first — the picker above only lists what is installed here —
        // so publishing on behalf of somebody else meant install, publish, uninstall.
        //
        // `src_file` is what makes it packable: the publish step copies that file instead of
        // calling export_plugin, which only works for an installed plugin. It never reaches
        // catalog.json; exportDraft strips it.
        panel.querySelector('#pcb-add-file')?.addEventListener('click', async () => {
            const { pickFiles } = await import('../../core/api.js');
            const paths = await pickFiles([{ name: 'BMM plugin', extensions: ['bmmplug', 'zip'] }]).catch(() => null);
            for (const p of paths || []) {
                const base = String(p).replace(/^.*[/\\]/, '');
                try {
                    // Read, not installed. The manifest is what the entry is made of, and a
                    // file that is not a plugin has to fail HERE rather than at publish time.
                    const m = await invoke('read_plugin_manifest', { filePath: p });
                    if (d.plugins.some((x) => x.id === m.id)) {
                        toast(t('plugins.pcbAlready').replace('{id}', m.id), 'info');
                        continue;
                    }
                    d.plugins.push({
                        id: m.id,
                        name: m.name || m.id,
                        version: m.version || '1.0.0',
                        author: m.author || '',
                        description: m.description || '',
                        game: m.game || '',
                        official: false,
                        download_url: '',
                        tags: Array.isArray(m.tags) ? m.tags : [],
                        icon_url: m.icon_url || m.icon || null,
                        src_file: String(p),
                    });
                }
                catch (e) {
                    toast(t('plugins.pcbNotPlugin').replace('{f}', base) + ' — ' + String(e).slice(0, 90), 'warning', 8000);
                }
            }
            renderEntries();
        });
        panel.querySelector('#pcb-add-empty')?.addEventListener('click', () => {
            d.plugins.push({ id: '', name: '', version: '1.0.0', author: '', description: '', game: '', official: false, download_url: '', tags: [], icon_url: null });
            renderEntries();
        });
        panel.querySelector('#pcb-save')?.addEventListener('click', () => {
            readMeta();
            if (!d.name) {
                toast(t('plugins.catalogNameRequired') || 'A catalog name is required', 'warning');
                return;
            }
            saveDraft(d);
            toast(t('plugins.catalogSaved') || 'Catalog saved', 'success');
            editing = null;
            renderList();
        });
        panel.querySelector('#pcb-export')?.addEventListener('click', async () => { readMeta(); saveDraft(d); await exportDraft(d); });
        panel.querySelector('#pcb-export-source')?.addEventListener('click', async () => {
            readMeta();
            saveDraft(d);
            const path = await exportDraft(d);
            if (!path)
                return;
            const list = getPluginCatalogSources();
            if (!list.includes(path)) {
                list.push(path);
                setPluginCatalogSources(list);
            }
            toast(t('plugins.addedAsSource') || 'Added as a local source', 'success');
            onSourcesChanged();
            close();
        });
    };
    const renderEntries = () => {
        const wrap = panel.querySelector('#pcb-entries');
        const d = editing;
        if (!d.plugins.length) {
            wrap.innerHTML = `<p class="plug-sources-empty">${t('plugins.noEntries') || 'No entry yet. Add one from an installed plugin above.'}</p>`;
            return;
        }
        wrap.innerHTML = d.plugins.map((p, i) => {
            // An entry whose plugin is installed here can be PACKED at publish time; one
            // that is not can only be linked. Saying which is the difference between "leave
            // the address blank" being a shortcut and being a mistake.
            // Three ways an entry can have a file behind it, and the badge has to tell them
            // apart: installed here, handed over as a file, or neither.
            const installed = _installedPlugins.some((x) => x.manifest.id === p.id) || !!p.src_file;
            const linked = !!(p.download_url || '').trim();
            return `
            <div class="plug-cat-entry" data-i="${i}">
                <div class="pcb-body">
                <div class="plug-cat-entry-grid">
                    <input class="input pcb-f" data-f="id" data-i="${i}" value="${escAttr(p.id)}" placeholder="${t('plugins.createId') || 'id'} *">
                    <input class="input pcb-f" data-f="name" data-i="${i}" value="${escAttr(p.name)}" placeholder="${t('plugins.createName') || 'name'} *">
                    <input class="input pcb-f" data-f="version" data-i="${i}" value="${escAttr(p.version)}" placeholder="1.0.0">
                    <input class="input pcb-f" data-f="download_url" data-i="${i}" value="${escAttr(p.download_url)}" placeholder="${escAttr(installed ? t('plugins.pcbUrlPacked') : t('plugins.pcbUrlNeeded'))}">
                </div>
                <div class="pcb-meta">
                    <span class="pcb-badge ${linked ? 'is-link' : installed ? 'is-pack' : 'is-bad'}">${escHtml(linked ? t('catpub.link') : installed ? t('catpub.embed') : t('plugins.pcbNoSource'))}</span>
                    ${p.src_file ? `<span class="pcb-badge is-file" title="${escAttr(p.src_file)}">${escHtml(t('plugins.pcbFromFile').replace('{f}', String(p.src_file).replace(/^.*[/\\]/, '')))}</span>` : ''}
                    ${p.icon_url ? `<img class="pcb-icon" src="${escAttr(p.icon_url)}" alt="">` : ''}
                    <input class="input pcb-f pcb-small" data-f="author" data-i="${i}" value="${escAttr(p.author)}" placeholder="${escAttr(t('plugins.createAuthor') || 'author')}">
                    <input class="input pcb-f pcb-small" data-f="game" data-i="${i}" value="${escAttr(p.game)}" placeholder="${escAttr(t('plugins.createGame') || 'game')}">
                    <input class="input pcb-f pcb-grow" data-f="description" data-i="${i}" value="${escAttr(p.description)}" placeholder="${escAttr(t('plugins.createDesc') || 'description')}">
                </div>
                </div>
                <button class="btn btn-xs btn-ghost pcb-rm" data-i="${i}" style="color:var(--danger)">${IC.x}</button>
            </div>`;
        }).join('');
        wrap.querySelectorAll('.pcb-f').forEach(inp => inp.addEventListener('input', (e) => {
            const el = e.target;
            const i = parseInt(el.dataset.i, 10);
            d.plugins[i][el.dataset.f] = el.value;
            // The badge answers "packed or linked", and the address field is what decides
            // it — so that one field repaints the badge. Not the whole list: re-rendering
            // would take the caret out of the box being typed into.
            if (el.dataset.f === 'download_url') {
                const badge = el.closest('.plug-cat-entry')?.querySelector('.pcb-badge');
                const p = d.plugins[i];
                const installed = _installedPlugins.some((x) => x.manifest.id === p.id) || !!p.src_file;
                const linked = !!(p.download_url || '').trim();
                if (badge) {
                    badge.className = `pcb-badge ${linked ? 'is-link' : installed ? 'is-pack' : 'is-bad'}`;
                    badge.textContent = linked ? t('catpub.link') : installed ? t('catpub.embed') : t('plugins.pcbNoSource');
                }
            }
        }));
        wrap.querySelectorAll('.pcb-rm').forEach(b => b.addEventListener('click', () => {
            d.plugins.splice(parseInt(b.dataset.i, 10), 1);
            renderEntries();
        }));
    };
    renderList();
}
function renderSourcesList(container) {
    const list = container.querySelector('#plug-sources-list');
    if (!list)
        return;
    const sources = getPluginCatalogSources();
    if (!sources.length) {
        list.innerHTML = `<p class="plug-sources-empty">${t('plugins.noCommunityCatalogs') || 'No community catalogs added yet.'}</p>`;
        return;
    }
    list.innerHTML = sources.map(src => {
        // Where it came from, when an index brought it in. This panel showed a bare list of
        // URLs, so a source you added by hand and one an index imported looked identical —
        // which is the question you are asking when you come here to remove one.
        const from = originOf(src);
        const off = isDisabled(src);
        return `
        <div class="plug-source-row${off ? ' is-off' : ''}">
            <span class="plug-source-icon">${isUrlSource(src) ? IC.globe : IC.folder}</span>
            <span class="plug-source-url" data-tooltip="${escAttr(src)}">${escHtml(src)}</span>
            ${from ? `<span class="plug-source-from" data-tooltip="${escAttr(from)}">${escHtml(t('plugins.sources.via') || 'via')} ${escHtml(originLabel(from))}</span>` : ''}
            <button class="btn btn-xs btn-ghost plug-source-toggle" data-src="${escAttr(src)}"
                    data-tooltip="${escAttr(off ? (t('plugins.sources.on') || 'Fetch this one again') : (t('plugins.sources.off') || 'Keep it listed but stop fetching it'))}">${escHtml(off ? (t('plugins.sources.isOff') || 'off') : (t('plugins.sources.isOn') || 'on'))}</button>
            <button class="btn btn-xs btn-ghost plug-source-del" data-src="${escAttr(src)}">${IC.trash}</button>
        </div>`;
    }).join('');
    list.querySelectorAll('.plug-source-toggle').forEach(btn => {
        btn.addEventListener('click', async () => {
            const src = btn.dataset.src;
            setDisabled(src, !isDisabled(src));
            _catalog = null;
            await renderCatalog(container);
        });
    });
    list.querySelectorAll('.plug-source-del').forEach(btn => {
        btn.addEventListener('click', async () => {
            const src = btn.dataset.src;
            setPluginCatalogSources(getPluginCatalogSources().filter(s => s !== src));
            // Provenance, on/off flag and a history line — the same three Settings drops when
            // it unfollows. Without the history line a source removed here cannot be brought
            // back from the one screen that exists to bring things back.
            forgetOrigin(src);
            setDisabled(src, false);
            recordHistory({ action: 'remove', type: 'plugin', url: src });
            _catalog = null;
            await renderCatalog(container);
        });
    });
}
function renderCatalogGrid(plugins) {
    const grid = document.getElementById('plug-catalog-grid');
    if (!grid)
        return;
    if (!plugins.length) {
        grid.innerHTML = `<div class="plug-empty"><p>${t('plugins.catalogEmpty')}</p></div>`;
        return;
    }
    grid.innerHTML = '';
    for (const entry of plugins) {
        const alreadyInstalled = _installedPlugins.some(p => p.manifest.id === entry.id);
        const card = buildPluginCard(entry, 'catalog');
        if (alreadyInstalled) {
            const btn = card.querySelector('.plug-btn-install');
            if (btn) {
                btn.innerHTML = `${IC.check} ${t('plugins.installed')}`;
                btn.disabled = true;
                btn.className = 'btn btn-sm btn-ghost';
                btn.style.cursor = 'default';
            }
        }
        grid.appendChild(card);
    }
}
function filterCatalogGrid(query) {
    if (!_catalog)
        return;
    const q = query.toLowerCase();
    const filtered = _catalog.plugins.filter(p => p.name.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        (p.game || '').toLowerCase().includes(q) ||
        (p.author || '').toLowerCase().includes(q));
    renderCatalogGrid(filtered);
}
// ── Overlay utility ────────────────────────────────────────────────────────
function createOverlay(html) {
    const ov = document.createElement('div');
    ov.className = 'plug-overlay';
    ov.innerHTML = `<div class="plug-overlay-panel">${html}</div>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(ov);
    // Backdrop click closes
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov)
        ov.remove(); });
    // Esc key closes
    const onEsc = (e) => {
        if (e.key === 'Escape') {
            ov.remove();
            document.removeEventListener('keydown', onEsc);
        }
    };
    document.addEventListener('keydown', onEsc);
    // Clean up Esc listener when overlay is removed via other means
    const obs = new MutationObserver(() => {
        if (!document.contains(ov)) {
            document.removeEventListener('keydown', onEsc);
            obs.disconnect();
        }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return ov;
}
// ── Unified Quick Test ────────────────────────────────────────────────────────
// One panel: pick an endpoint → its fields are generated from getEndpointDefs() →
// fill them → Run or copy the ready cURL. Replaces the old 60-button grid.
let _uqtSelected = null;
async function _refreshUqtData() {
    try {
        [_allMods, _allProfiles, _installedPlugins] = await Promise.all([
            invoke('get_mods').catch(() => []),
            invoke('get_profiles').catch(() => []),
            invoke('get_installed_plugins').catch(() => []),
        ]);
        // Launch packs + scheduler tasks for the "Run launch pack / task" dropdowns.
        _allLaunchpacks = await invoke('get_launch_packs').catch(() => []);
        try {
            _allTasks = await (await import('../settings/scheduler.js')).getTasks();
        }
        catch {
            _allTasks = [];
        }
        try {
            const liveTok = document.getElementById('plug-token-display')?.value?.trim() || _apiToken;
            _allModpacks = await fetchModpacks({
                headers: { 'Authorization': `Bearer ${liveTok}` },
                signal: AbortSignal.timeout(3000), // unreachable API must not hang the UI
            });
        }
        catch {
            _allModpacks = [];
        }
    }
    catch { /* best effort */ }
}
function setupUnifiedQuickTest(container) {
    const selectBtn = container.querySelector('#plug-uqt-select');
    const dropdown = container.querySelector('#plug-uqt-dropdown');
    const search = container.querySelector('#plug-uqt-search');
    const listEl = container.querySelector('#plug-uqt-list');
    const formEl = container.querySelector('#plug-uqt-form');
    if (!selectBtn || !dropdown || !listEl || !formEl)
        return;
    const defs = getEndpointDefs();
    const methodOrder = { GET: 0, POST: 1, PUT: 2, DELETE: 3, PATCH: 4 };
    defs.sort((a, b) => (methodOrder[a.method] ?? 9) - (methodOrder[b.method] ?? 9));
    const methodCls = { GET: 'plug-qt-get', POST: 'plug-qt-post', PUT: 'plug-qt-put', DELETE: 'plug-qt-delete', PATCH: 'plug-qt-patch' };
    const renderDropdownList = (q = '') => {
        const ql = q.trim().toLowerCase();
        const rows = defs.filter(ep => !ql || `${ep.method} ${ep.path} ${ep.desc}`.toLowerCase().includes(ql));
        let lastM = '';
        listEl.innerHTML = rows.map(ep => {
            let sep = '';
            if (!ql && ep.method !== lastM) {
                lastM = ep.method;
                sep = `<div class="plug-uqt-sep ${methodCls[ep.method]}">${ep.method}</div>`;
            }
            return sep + `<div class="plug-uqt-item" data-method="${ep.method}" data-path="${escAttr(ep.path)}">
                <span class="plug-uqt-badge ${methodCls[ep.method]}">${ep.method}</span>
                <code class="plug-uqt-path">${escHtml(ep.path)}</code>
                <span class="plug-uqt-desc">${escHtml(ep.desc)}</span>
            </div>`;
        }).join('') || `<div style="padding:14px;color:var(--text-muted);font-size:12px;text-align:center;">${t('plugins.qtNoMatch') || 'No endpoint matches'}</div>`;
        listEl.querySelectorAll('.plug-uqt-item').forEach(it => {
            it.addEventListener('click', () => {
                const ep = defs.find(d => d.method === it.dataset.method && d.path === it.dataset.path);
                if (ep)
                    selectEndpoint(ep);
            });
        });
    };
    const openDropdown = () => {
        // Open instantly with whatever data we have; refresh in the background and
        // re-render when it lands (awaiting here made the dropdown feel frozen,
        // especially when the API fetch inside is slow/unreachable).
        dropdown.style.display = 'block';
        renderDropdownList(search?.value || '');
        search?.focus();
        _refreshUqtData().then(() => {
            if (dropdown.style.display !== 'none')
                renderDropdownList(search?.value || '');
        }).catch(() => { });
    };
    const closeDropdown = () => { dropdown.style.display = 'none'; };
    selectBtn.addEventListener('click', () => {
        if (dropdown.style.display === 'none')
            openDropdown();
        else
            closeDropdown();
    });
    search?.addEventListener('input', () => renderDropdownList(search.value));
    document.addEventListener('mousedown', (e) => {
        if (dropdown.style.display !== 'none' && !dropdown.contains(e.target) && !selectBtn.contains(e.target))
            closeDropdown();
    });
    const selectEndpoint = (ep) => {
        _uqtSelected = ep;
        closeDropdown();
        const lbl = container.querySelector('#plug-uqt-select-label');
        if (lbl)
            lbl.innerHTML = `<span class="plug-uqt-badge ${methodCls[ep.method]}">${ep.method}</span> <code style="color:var(--accent);">${escHtml(ep.path)}</code>`;
        renderUqtForm(ep, formEl);
    };
}
/** Builds the dynamic form for one endpoint from its field definitions. */
function renderUqtForm(ep, formEl) {
    const hasPathParam = ep.path.includes(':');
    const fields = ep.fields || [];
    // Smart dropdown options for *_id fields
    const optsFor = (fieldName) => {
        const opt = (arr, v, l) => `<option value="">— ${t('common.select') || 'select'} —</option>` + arr.map(x => `<option value="${escAttr(v(x))}">${escHtml(l(x))}</option>`).join('');
        if (/mod_?id/i.test(fieldName) && _allMods.length)
            return opt(_allMods, m => m.id, m => `${m.name || m.id}`);
        if (/profile_?id/i.test(fieldName) && _allProfiles.length)
            return opt(_allProfiles, p => p.id, p => p.name);
        if (/plugin_?id/i.test(fieldName) && _installedPlugins.length)
            return opt(_installedPlugins, p => p.manifest.id, p => `${p.manifest.name} (${p.manifest.id})`);
        if (/modpack_?id/i.test(fieldName) && _allModpacks.length)
            return opt(_allModpacks, m => m.id, m => `${m.name} (${m.mod_count ?? m.mods?.length ?? 0})`);
        return null;
    };
    const fieldRow = (f) => {
        const req = f.required ? ` <span style="color:var(--danger)">*</span>` : ` <span style="color:var(--text-muted);font-size:10px;">(${t('common.optional') || 'optional'})</span>`;
        const lbl = `<label class="plug-uqt-flabel">${escHtml(f.name)}${req}</label>`;
        const desc = f.desc ? `<div class="plug-uqt-fdesc">${escHtml(f.desc)}</div>` : '';
        let input = '';
        const id = `uqt-f-${f.name}`;
        const smartOpts = optsFor(f.name);
        if (smartOpts) {
            input = `<select id="${id}" class="select select-sm" data-fname="${escAttr(f.name)}" data-ftype="string">${smartOpts}</select>`;
        }
        else if (f.type === 'boolean') {
            input = `<label class="plug-uqt-check"><input type="checkbox" id="${id}" data-fname="${escAttr(f.name)}" data-ftype="boolean"> <span>${escHtml(f.name)}</span></label>`;
            return `<div class="plug-uqt-field">${input}${desc}</div>`;
        }
        else if (f.type === 'object' || f.type === 'array') {
            const ph = f.type === 'array' ? '["a","b"]' : '{ "key": "value" }';
            input = `<textarea id="${id}" class="input" rows="2" data-fname="${escAttr(f.name)}" data-ftype="${f.type}" placeholder="${ph}" style="font-family:var(--font-mono);font-size:12px;"></textarea>`;
        }
        else if (f.type === 'number') {
            input = `<input type="number" id="${id}" class="input" data-fname="${escAttr(f.name)}" data-ftype="number">`;
        }
        else {
            const isPath = /path|dir|folder/i.test(f.name);
            input = `<div style="display:flex;gap:6px;"><input type="text" id="${id}" class="input" data-fname="${escAttr(f.name)}" data-ftype="string" placeholder="${escAttr(f.placeholder || '')}" style="flex:1;font-family:var(--font-mono);font-size:12px;">${isPath ? `<button type="button" class="btn btn-sm btn-secondary plug-uqt-browse" data-target="${id}" data-kind="${/dir|folder/i.test(f.name) ? 'dir' : 'file'}">${t('plugins.qtBrowse') || 'Browse'}</button>` : ''}</div>`;
        }
        return `<div class="plug-uqt-field">${lbl}${input}${desc}</div>`;
    };
    const pathParamRow = hasPathParam
        ? `<div class="plug-uqt-field"><label class="plug-uqt-flabel">:id <span style="color:var(--danger)">*</span></label>
           <input type="text" id="uqt-pathparam" class="input" placeholder="${escAttr(ep.path)}" style="font-family:var(--font-mono);font-size:12px;">
           <div class="plug-uqt-fdesc">${t('plugins.qtPathParam') || 'Replaces :id in the URL.'}</div></div>`
        : '';
    const authChip = ep.auth
        ? `<span class="plug-uqt-auth"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> ${t('plugins.requiresToken') || 'token required'}</span>`
        : `<span class="plug-uqt-noauth">${t('plugins.epNoAuthNote') || 'no auth'}</span>`;
    formEl.innerHTML = `
        <div class="plug-uqt-about">${ep.about}</div>
        <div class="plug-uqt-meta">${authChip}</div>
        ${pathParamRow}
        ${fields.length ? fields.map(fieldRow).join('') : (hasPathParam ? '' : `<div class="plug-uqt-fdesc" style="padding:4px 0;">${t('plugins.qtNoBody') || 'No parameters required.'}</div>`)}
        <div class="plug-uqt-actions">
            <button class="btn btn-sm btn-ghost" id="uqt-curl">${IC.copy} cURL</button>
            <button class="btn btn-sm btn-ghost" id="uqt-copybody" style="display:${fields.length ? '' : 'none'};">${IC.copy} JSON</button>
            <span style="flex:1;"></span>
            <button class="btn btn-sm btn-accent" id="uqt-run">${IC.play} ${t('plugins.run') || 'Run'}</button>
        </div>`;
    formEl.style.display = 'block';
    // Browse buttons
    formEl.querySelectorAll('.plug-uqt-browse').forEach(b => {
        b.addEventListener('click', async () => {
            const tgt = b.dataset.target;
            const kind = b.dataset.kind;
            const picked = kind === 'dir' ? await pickFolder().catch(() => null) : await pickFile().catch(() => null);
            if (picked) {
                const el = document.getElementById(tgt);
                if (el)
                    el.value = picked;
            }
        });
    });
    const collect = () => {
        let path = ep.path;
        if (hasPathParam) {
            const pv = document.getElementById('uqt-pathparam')?.value?.trim() || '';
            path = path.replace(/:[a-zA-Z_]+/, encodeURIComponent(pv));
        }
        const obj = {};
        formEl.querySelectorAll('[data-fname]').forEach(el => {
            const name = el.dataset.fname;
            const type = el.dataset.ftype;
            if (type === 'boolean') {
                if (el.checked)
                    obj[name] = true;
                return;
            }
            const raw = el.value?.trim() || '';
            if (!raw)
                return;
            if (type === 'number')
                obj[name] = Number(raw);
            else if (type === 'array') {
                try {
                    obj[name] = JSON.parse(raw);
                }
                catch {
                    obj[name] = raw.split(',').map(s => s.trim()).filter(Boolean);
                }
            }
            else if (type === 'object') {
                try {
                    obj[name] = JSON.parse(raw);
                }
                catch { /* skip invalid */ }
            }
            else
                obj[name] = raw;
        });
        // GET / DELETE without body: send the fields as a query string instead of
        // a JSON body (e.g. /api/repo/info?url=…), since those verbs ignore a body.
        if (ep.method === 'GET') {
            const qs = Object.entries(obj)
                .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(typeof v === 'string' ? v : JSON.stringify(v))}`)
                .join('&');
            if (qs)
                path += (path.includes('?') ? '&' : '?') + qs;
            return { path, body: '' };
        }
        const body = Object.keys(obj).length ? JSON.stringify(obj, null, 2) : '';
        return { path, body };
    };
    formEl.querySelector('#uqt-run')?.addEventListener('click', () => {
        const { path, body } = collect();
        handleQuickTest(ep.method, path, body || undefined);
    });
    formEl.querySelector('#uqt-copybody')?.addEventListener('click', () => {
        const { body } = collect();
        navigator.clipboard.writeText(body || '{}').catch(() => { });
        toast(t('common.copy') || 'Copied', 'success');
    });
    formEl.querySelector('#uqt-curl')?.addEventListener('click', () => {
        const { path, body } = collect();
        const tok = document.getElementById('plug-token-display')?.value?.trim() || _apiToken;
        // Single-line command — paste straight into a terminal, no line continuations.
        const parts = [`curl -X ${ep.method}`];
        if (ep.auth)
            parts.push(`-H "Authorization: Bearer ${tok}"`);
        if (body) {
            const compact = JSON.stringify(JSON.parse(body)); // minified, single line
            parts.push(`-H "Content-Type: application/json"`, `-d "${compact.replace(/"/g, '\\"')}"`);
        }
        parts.push(`"${apiBase()}${path}"`);
        navigator.clipboard.writeText(parts.join(' ')).catch(() => { });
        toast(t('plugins.epCopyDone') || 'cURL copied', 'success');
    });
}
// ── DEPRECATED: per-endpoint smart quick-test overlay ─────────────────────────
// Superseded by the unified Quick Test panel (setupUnifiedQuickTest), which reads
// getEndpointDefs() and builds the form generically. Kept temporarily for reference;
// it is no longer called from anywhere. Safe to delete in a future cleanup pass.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function openSmartQuickTest(m, p, rawBody) {
    // ── Live refresh: reload all data before showing the overlay ──────────
    try {
        [_allMods, _allProfiles, _installedPlugins] = await Promise.all([
            invoke('get_mods'),
            invoke('get_profiles'),
            invoke('get_installed_plugins'),
        ]);
        try {
            _allModpacks = await fetchModpacks();
        }
        catch {
            _allModpacks = [];
        }
    }
    catch (e) {
        console.warn('[PLUGINS] qt data refresh failed', e);
    }
    const noMod = t('plugins.qtNoMods') || '— no mods —';
    const noProf = t('plugins.qtNoProfiles') || '— no profiles —';
    const noPlug = t('plugins.qtNoPlugins') || '— no plugins —';
    const noMp = t('plugins.qtNoModpacks') || '— no modpacks —';
    const modOpts = _allMods.length ? _allMods.map(mod => `<option value="${escHtml(mod.id)}">${escHtml(mod.name || mod.id)}</option>`).join('') : `<option value="">${noMod}</option>`;
    const profOpts = _allProfiles.length ? _allProfiles.map(pr => `<option value="${escHtml(pr.id)}">${escHtml(pr.name)}</option>`).join('') : `<option value="">${noProf}</option>`;
    const plugOpts = _installedPlugins.length ? _installedPlugins.map(pl => `<option value="${escHtml(pl.manifest.id)}">${escHtml(pl.manifest.name)} v${escHtml(pl.manifest.version || '1.0')}</option>`).join('') : `<option value="">${noPlug}</option>`;
    const modpackOpts = _allModpacks.length ? _allModpacks.map(mp => `<option value="${escHtml(mp.id)}">${escHtml(mp.name)} (${mp.mods?.length ?? 0} mods)</option>`).join('') : `<option value="">${noMp}</option>`;
    const sel = (elId, label, opts, hint = '') => `<div class="plug-qt-smart-field"><label class="plug-form-label" style="margin-bottom:4px;">${label} <span style="color:var(--danger)">*</span></label>
         <select id="${elId}" class="select">${opts}</select>${hint ? `<p style="font-size:10px;color:var(--text-muted);margin:3px 0 0;">${hint}</p>` : ''}</div>`;
    const modSel = sel('plug-qt-s-mod', t('plugins.qtFieldMod') || 'Mod', modOpts);
    const profSel = sel('plug-qt-s-profile', t('plugins.qtFieldProfile') || 'Profile', profOpts);
    const plugSel = sel('plug-qt-s-plugin', t('plugins.qtFieldPlugin') || 'Plugin', plugOpts, !_installedPlugins.length ? (t('plugins.qtNoPluginsHint') || 'Install a plugin first to use this endpoint.') : '');
    const modpackSel = sel('plug-qt-s-modpack', t('plugins.qtFieldModpack') || 'Modpack', modpackOpts);
    const idInput = (label, ph) => `<div class="plug-qt-smart-field"><label class="plug-form-label" style="margin-bottom:4px;">${label} <span style="color:var(--danger)">*</span></label>
         <input type="text" id="plug-qt-s-id" class="input" placeholder="${ph}" style="font-family:var(--font-mono);font-size:12px;"></div>`;
    const txtInput = (id, label, ph, opt = false) => `<div class="plug-qt-smart-field" style="margin-top:8px;"><label class="plug-form-label" style="margin-bottom:4px;">${label}${opt
        ? ` <span style="color:var(--text-muted);font-size:10px;">(${t('common.optional') || 'optional'})</span>`
        : ' <span style="color:var(--danger)">*</span>'}</label>
         <input type="text" id="${id}" class="input" placeholder="${ph}" style="font-family:var(--font-mono);font-size:12px;"></div>`;
    let formHtml = '';
    let actualPath = p; // may be rewritten when :id is in path
    if (p === '/api/mods/enable' || p === '/api/mods/disable') {
        formHtml = modSel;
    }
    else if (p === '/api/mods/:id') {
        formHtml = m === 'DELETE'
            ? modSel + `<p style="font-size:11px;color:var(--danger);margin:8px 0 0;opacity:0.8;">⚠ ${escHtml(t('plugins.qt.irreversible'))}</p>`
            : modSel
                + txtInput('plug-qt-s-name', 'name', 'Nouveau nom du mod', true)
                + txtInput('plug-qt-s-version', 'version', '1.0.0', true)
                + txtInput('plug-qt-s-author', 'author', 'Auteur', true)
                + txtInput('plug-qt-s-description', 'description', 'Description du mod', true);
    }
    else if (p === '/api/profiles/activate') {
        formHtml = profSel;
    }
    else if (p === '/api/modpacks/enable' || p === '/api/modpacks/disable') {
        formHtml = modpackSel;
    }
    else if (p === '/api/profiles/:id') {
        formHtml = m === 'DELETE'
            ? profSel + `<p style="font-size:11px;color:var(--danger);margin:8px 0 0;opacity:0.8;">⚠ ${escHtml(t('plugins.qt.irreversible'))}</p>`
            : profSel
                + txtInput('plug-qt-s-name', 'name', 'Nouveau nom du profil', true)
                + txtInput('plug-qt-s-color', 'color', '#3b82f6', true)
                + txtInput('plug-qt-s-icon', 'icon', 'star / folder / shield…', true)
                + txtInput('plug-qt-s-game-path', 'game_path', 'C:/Games/MonJeu', true)
                + txtInput('plug-qt-s-mods-path', 'mods_path', 'C:/Games/MonJeu/Mods', true)
                + txtInput('plug-qt-s-backup-path', 'backup_path', 'C:/BMM/Backups/MonJeu', true);
    }
    else if (p === '/api/modpacks/:id' && m === 'PUT') {
        const updModChecks = _allMods.length
            ? _allMods.map(mod => `<label style="display:flex;align-items:center;gap:8px;padding:3px 8px;border-radius:6px;cursor:pointer;" data-hover="background:rgba(255,255,255,0.05)" data-hover-out="background:transparent">
                <input type="checkbox" class="plug-qt-upd-mod-check" value="${escHtml(mod.id)}" style="accent-color:var(--accent);width:13px;height:13px;">
                <span style="font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" data-tooltip="${escHtml(mod.name || mod.id)}">${escHtml(mod.name || mod.id)}</span>
                ${mod.active ? `<span style="font-size:9px;padding:1px 4px;border-radius:3px;background:rgba(34,197,94,0.15);color:color-mix(in srgb, var(--bmm-success) 60%, var(--bmm-text-primary));font-weight:700;">ON</span>` : ''}
              </label>`).join('')
            : `<p style="font-size:12px;color:var(--text-muted);padding:8px;">Aucun mod.</p>`;
        formHtml = `
            <!-- Sélection modpack -->
            <div class="plug-qt-smart-field" style="flex-direction:column;">
                <label class="plug-form-label" style="margin-bottom:3px;">Modpack <span style="color:var(--danger)">*</span></label>
                <select id="plug-qt-s-modpack" class="select" style="font-size:13px;">
                    ${_allModpacks.length ? _allModpacks.map(mp => `<option value="${escHtml(mp.id)}">${escHtml(mp.name)}</option>`).join('') : '<option value="">— aucun modpack —</option>'}
                </select>
            </div>
            <!-- Nom + Game name -->
            <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;">
                <div style="flex:2;min-width:130px;display:flex;flex-direction:column;gap:2px;">
                    <label class="plug-form-label" style="font-size:10px;">name</label>
                    <input type="text" id="plug-qt-s-name" class="input input-sm" placeholder="${escAttr(t('plugins.phNewName'))}" style="font-size:12px;">
                </div>
                <div style="flex:1;min-width:110px;display:flex;flex-direction:column;gap:2px;">
                    <label class="plug-form-label" style="font-size:10px;">game_name</label>
                    <input type="text" id="plug-qt-s-game-name" class="input input-sm" placeholder="DCS World…" style="font-size:12px;">
                </div>
            </div>
            <!-- Description + SR link -->
            <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;">
                <div style="flex:2;min-width:130px;display:flex;flex-direction:column;gap:2px;">
                    <label class="plug-form-label" style="font-size:10px;">description</label>
                    <input type="text" id="plug-qt-s-description" class="input input-sm" placeholder="Description…" style="font-size:12px;">
                </div>
                <div style="flex:1;min-width:130px;display:flex;flex-direction:column;gap:2px;">
                    <label class="plug-form-label" style="font-size:10px;">sr_link</label>
                    <input type="text" id="plug-qt-s-sr-link" class="input input-sm" placeholder="https://…" style="font-family:var(--font-mono);font-size:11px;">
                </div>
            </div>
            <!-- Options + dep mode -->
            <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:8px;">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text-secondary);">
                    <input type="checkbox" id="plug-qt-s-multi-profile" style="accent-color:var(--accent);"> multi_profile
                </label>
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text-secondary);">
                    <input type="checkbox" id="plug-qt-s-skip-integrity" style="accent-color:var(--accent);"> skip_integrity
                </label>
                <div style="display:flex;align-items:center;gap:6px;">
                    <label class="plug-form-label" style="margin:0;font-size:10px;">dep_mode</label>
                    <select id="plug-qt-s-dep-mode" class="select select-sm">
                        <option value="none">none</option>
                        <option value="all">all</option>
                        <option value="manual">manual</option>
                    </select>
                </div>
            </div>
            <!-- Mod IDs -->
            <div class="plug-qt-smart-field" style="flex-direction:column;margin-top:8px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                    <label class="plug-form-label" style="margin:0;">mod_ids <span style="color:var(--text-muted);font-size:9px;">(optionnel — remplace la liste)</span></label>
                    <div style="display:flex;gap:4px;">
                        <button type="button" class="btn btn-xs btn-ghost" id="plug-qt-upd-sel-all"    style="font-size:10px;">${t('common.all') || 'All'}</button>
                        <button type="button" class="btn btn-xs btn-ghost" id="plug-qt-upd-sel-active" style="font-size:10px;">Actifs</button>
                        <button type="button" class="btn btn-xs btn-ghost" id="plug-qt-upd-sel-none"   style="font-size:10px;">${t('common.none') || 'None'}</button>
                    </div>
                </div>
                <div style="max-height:150px;overflow-y:auto;background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:4px;scrollbar-width:thin;">${updModChecks}</div>
            </div>`;
    }
    else if (p === '/api/modpacks/:id' && m === 'DELETE') {
        formHtml = `
            <div class="plug-qt-smart-field" style="flex-direction:column;">
                <label class="plug-form-label" style="margin-bottom:3px;">Modpack à supprimer <span style="color:var(--danger)">*</span></label>
                <select id="plug-qt-s-modpack" class="select" style="font-size:13px;">
                    ${_allModpacks.length ? _allModpacks.map(mp => `<option value="${escHtml(mp.id)}">${escHtml(mp.name)} <span style="color:var(--text-muted);font-size:10px;">(${mp.mods?.length ?? 0} mods)</span></option>`).join('') : '<option value="">— aucun modpack —</option>'}
                </select>
            </div>
            <p style="font-size:12px;color:var(--danger);margin:10px 0 0;padding:8px 10px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:6px;">
                ⚠ ${t('plugins.qt.modpackDelete')}
            </p>`;
    }
    else if (p === '/api/profiles') {
        formHtml = txtInput('plug-qt-s-name', 'name', 'Mon profil')
            + txtInput('plug-qt-s-game-path', 'game_path', 'C:/Games/MyGame')
            + txtInput('plug-qt-s-mods-path', 'mods_path', 'C:/Games/MyGame/Mods')
            + txtInput('plug-qt-s-backup-path', 'backup_path', 'C:/BMM/Backups/MyGame');
    }
    else if (p === '/api/plugins/compare' || p === '/api/plugins/apply') {
        const isApply = p === '/api/plugins/apply';
        const aboutHint = isApply
            ? (t('plugins.qtApplyHint') || 'Applies the plugin — activates mods from the plugin modlist and optionally disables all others (force_strict).')
            : (t('plugins.qtCompareHint') || 'Compares the plugin modlist against currently enabled mods. Returns a list of matches, missing, and extra mods.');
        const strictRow = isApply ? `
            <div class="plug-qt-smart-field" style="flex-direction:row;align-items:center;gap:10px;margin-top:8px;">
                <label class="plug-toggle" style="margin:0;"><input type="checkbox" id="plug-qt-s-strict"><span class="plug-toggle-slider"></span></label>
                <div>
                    <span class="plug-form-label" style="margin:0;">force_strict</span>
                    <p style="font-size:10px;color:var(--text-muted);margin:2px 0 0;">${t('plugins.qtForceStrictDesc') || 'Disables mods not in the plugin modlist'}</p>
                </div>
            </div>` : '';
        formHtml = plugSel + strictRow + `<p style="font-size:11px;color:var(--text-muted);margin:8px 0 0;">${aboutHint}</p>`;
    }
    else if (p === '/api/restart') {
        formHtml = `<p style="font-size:13px;color:var(--text-secondary);margin:0;">${escHtml(t('plugins.qt.restartNotice'))}</p>`;
    }
    else if (p === '/api/modpacks/create') {
        const profileChecks = _allProfiles.length
            ? _allProfiles.map(pr => `<label style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;cursor:pointer;" data-hover="background:rgba(255,255,255,0.05)" data-hover-out="background:transparent">
                <input type="checkbox" class="plug-qt-prof-check" value="${escHtml(pr.id)}" style="accent-color:var(--accent);width:13px;height:13px;">
                <span style="font-size:12px;color:var(--text-primary);flex:1;">${escHtml(pr.name)}</span>
                <span style="font-size:10px;color:var(--text-muted);">${pr.active_mods?.length || 0} mods actifs</span>
              </label>`).join('')
            : `<p style="font-size:12px;color:var(--text-muted);padding:8px;">Aucun profil.</p>`;
        const modCheckboxes = _allMods.length
            ? _allMods.map(mod => `<label style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;cursor:pointer;" data-hover="background:rgba(255,255,255,0.05)" data-hover-out="background:transparent">
                <input type="checkbox" class="plug-qt-mod-check" value="${escHtml(mod.id)}" style="accent-color:var(--accent);width:13px;height:13px;">
                <span style="font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" data-tooltip="${escHtml(mod.name || mod.id)}">${escHtml(mod.name || mod.id)}</span>
                ${mod.active ? `<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(34,197,94,0.15);color:color-mix(in srgb, var(--bmm-success) 60%, var(--bmm-text-primary));font-weight:700;">ON</span>` : ''}
              </label>`).join('')
            : `<p style="font-size:12px;color:var(--text-muted);padding:8px;">Aucun mod.</p>`;
        formHtml = `
            <!-- Nom requis -->
            <div class="plug-qt-smart-field" style="flex-direction:column;">
                <label class="plug-form-label" style="margin-bottom:3px;">name <span style="color:var(--danger)">*</span></label>
                <input type="text" id="plug-qt-s-name" class="input" placeholder="${escAttr(t('plugins.phModpackName'))}" style="font-size:13px;">
            </div>
            <!-- Description + Game name -->
            <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;">
                <div style="flex:2;min-width:130px;display:flex;flex-direction:column;gap:2px;">
                    <label class="plug-form-label" style="font-size:10px;">description <span style="color:var(--text-muted);font-size:9px;">(optionnel)</span></label>
                    <input type="text" id="plug-qt-s-desc" class="input input-sm" placeholder="Description…" style="font-size:12px;">
                </div>
                <div style="flex:1;min-width:110px;display:flex;flex-direction:column;gap:2px;">
                    <label class="plug-form-label" style="font-size:10px;">game_name <span style="color:var(--text-muted);font-size:9px;">(optionnel)</span></label>
                    <input type="text" id="plug-qt-s-game" class="input input-sm" placeholder="DCS World…" style="font-size:12px;">
                </div>
            </div>
            <!-- SR link -->
            <div class="plug-qt-smart-field" style="flex-direction:column;margin-top:6px;">
                <label class="plug-form-label" style="font-size:10px;margin-bottom:2px;">sr_link <span style="color:var(--text-muted);font-size:9px;">(URL Server Repo — optionnel)</span></label>
                <input type="text" id="plug-qt-s-sr-link" class="input input-sm" placeholder="https://monserveur.com/repo.json" style="font-family:var(--font-mono);font-size:12px;">
            </div>
            <!-- Options (checkboxes + dep mode) -->
            <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:8px;">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text-secondary);">
                    <input type="checkbox" id="plug-qt-s-multi-profile" style="accent-color:var(--accent);"> multi_profile
                </label>
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text-secondary);">
                    <input type="checkbox" id="plug-qt-s-skip-integrity" style="accent-color:var(--accent);"> skip_integrity
                </label>
                <div style="display:flex;align-items:center;gap:6px;">
                    <label class="plug-form-label" style="margin:0;white-space:nowrap;font-size:10px;">dep_mode</label>
                    <select id="plug-qt-s-dep-mode" class="select select-sm" style="flex:1;">
                        <option value="none">none</option>
                        <option value="all">all</option>
                        <option value="manual">manual</option>
                    </select>
                </div>
            </div>
            <!-- Import depuis profil(s) -->
            <div class="plug-qt-smart-field" style="flex-direction:column;margin-top:8px;">
                <label class="plug-form-label" style="margin-bottom:3px;">Importer depuis profil(s) <span style="color:var(--text-muted);font-size:9px;">${escHtml(t('plugins.qt.includeActive'))}</span></label>
                <div style="background:rgba(0,0,0,0.15);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:4px;max-height:100px;overflow-y:auto;scrollbar-width:thin;">${profileChecks}</div>
            </div>
            <!-- Mods à inclure -->
            <div class="plug-qt-smart-field" style="flex-direction:column;margin-top:6px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                    <label class="plug-form-label" style="margin:0;">Mods à inclure</label>
                    <div style="display:flex;gap:4px;">
                        <button type="button" id="plug-qt-sel-all"    class="btn btn-xs btn-ghost" style="font-size:10px;">${t('common.all') || 'All'}</button>
                        <button type="button" id="plug-qt-sel-active" class="btn btn-xs btn-ghost" style="font-size:10px;">Actifs</button>
                        <button type="button" id="plug-qt-sel-none"   class="btn btn-xs btn-ghost" style="font-size:10px;">${t('common.none') || 'None'}</button>
                    </div>
                </div>
                <div style="max-height:180px;overflow-y:auto;background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:4px;scrollbar-width:thin;">${modCheckboxes}</div>
            </div>`;
    }
    else if (p === '/api/modpacks') {
        formHtml = `<p style="font-size:13px;color:var(--text-secondary);margin:0;">Requête GET — aucun corps requis.</p>`;
        // ── Repo API ──────────────────────────────────────────────────────────────
    }
    else if (p === '/api/repo/info') {
        formHtml = txtInput('plug-qt-s-repo-url', 'url (repo.json URL)', 'https://monserveur.com/repo.json');
    }
    else if (p === '/api/repo/manifest') {
        formHtml = txtInput('plug-qt-s-manifest-dir', 'modsDir (dossier déjà hébergé)', 'C:/host/mods');
    }
    else if (p === '/api/repo/list') {
        formHtml = `<p style="font-size:13px;color:var(--text-secondary);margin:0;">${escHtml(t('plugins.qt.repoListDesc'))}</p>`;
    }
    else if (p === '/api/repo/connect') {
        formHtml = txtInput('plug-qt-s-repo-url', 'url', 'https://monserveur.com/repo.json')
            + `<p style="font-size:11px;color:var(--text-muted);margin:6px 0 0;opacity:0.85;">${escHtml(t('plugins.qt.repoNameAuto'))}</p>`;
    }
    else if (p === '/api/repo' && m === 'DELETE') {
        formHtml = txtInput('plug-qt-s-repo-url', t('plugins.qt.repoUrlToDisconnect'), 'https://monserveur.com/repo.json')
            + `<p style="font-size:11px;color:var(--danger);margin:8px 0 0;opacity:0.8;">⚠ ${escHtml(t('plugins.qt.repoRemoved'))}</p>`;
    }
    else if (p === '/api/repo/sync') {
        const profOpts2 = _allProfiles.length
            ? _allProfiles.map(pr => `<option value="${escHtml(pr.id)}">${escHtml(pr.name)}</option>`).join('')
            : `<option value="">${t('plugins.qt.createNewProfile') || '— Create a new profile —'}</option>`;
        formHtml = `
            <!-- URL (auto-fetch on input) -->
            <div class="plug-qt-smart-field" style="flex-direction:column;">
                <label class="plug-form-label" style="margin-bottom:4px;">url (repo.json) <span style="color:var(--danger)">*</span></label>
                <input type="text" id="plug-qt-s-repo-url" class="input" placeholder="https://monserveur.com/repo.json" style="font-family:var(--font-mono);font-size:12px;">
            </div>
            <!-- Repo profiles panel (auto-populated when URL is entered) -->
            <div id="plug-qt-s-repo-profiles-panel" style="display:none;flex-direction:column;gap:4px;margin-top:6px;background:rgba(0,0,0,0.12);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:8px 10px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                    <span class="plug-form-label">${t('plugins.qt.repoProfiles') || 'Repo profiles'} <span style="color:var(--text-muted);font-size:10px;">${t('plugins.qt.repoProfilesHint') || '(tick = auto-select + sync)'}</span></span>
                    <div style="display:flex;gap:4px;">
                        <button id="plug-qt-sync-sel-all" class="btn btn-xs btn-ghost" style="font-size:10px;padding:2px 6px;">${t('common.all') || 'All'}</button>
                        <button id="plug-qt-sync-sel-none" class="btn btn-xs btn-ghost" style="font-size:10px;padding:2px 6px;">${t('common.none') || 'None'}</button>
                    </div>
                </div>
                <div id="plug-qt-s-repo-profiles-list" style="max-height:130px;overflow-y:auto;scrollbar-width:thin;display:flex;flex-direction:column;gap:2px;">
                    <p style="font-size:12px;color:var(--text-muted);padding:4px 0;">${t('plugins.qt.enterUrlForProfiles') || 'Enter a URL to load profiles…'}</p>
                </div>
            </div>
            <!-- Dirs requis -->
            <div style="margin-top:6px;display:flex;flex-direction:column;gap:4px;">
                <div class="plug-qt-smart-field" style="flex-direction:column;">
                    <label class="plug-form-label" style="margin-bottom:4px;">game_dir <span style="color:var(--danger)">*</span></label>
                    <input type="text" id="plug-qt-s-game-dir" class="input" placeholder="C:/Games/MonJeu" style="font-family:var(--font-mono);font-size:12px;">
                </div>
                <div class="plug-qt-smart-field" style="flex-direction:column;">
                    <label class="plug-form-label" style="margin-bottom:4px;">mods_dir <span style="color:var(--danger)">*</span></label>
                    <input type="text" id="plug-qt-s-mods-dir" class="input" placeholder="C:/Games/MonJeu/Mods" style="font-family:var(--font-mono);font-size:12px;">
                </div>
                <div class="plug-qt-smart-field" style="flex-direction:column;">
                    <label class="plug-form-label" style="margin-bottom:4px;">backup_dir <span style="color:var(--danger)">*</span></label>
                    <input type="text" id="plug-qt-s-backup-dir" class="input" placeholder="C:/BMM/Backups" style="font-family:var(--font-mono);font-size:12px;">
                </div>
            </div>
            <!-- Target local profile (optional) -->
            <div class="plug-qt-smart-field" style="margin-top:6px;">
                <label class="plug-form-label" style="margin-bottom:4px;">${t('plugins.qt.targetLocalProfile') || 'Target local profile'} <span style="color:var(--text-muted);font-size:10px;">${t('plugins.qt.optionalCreatesNew') || '(optional — creates a new one if empty)'}</span></label>
                <select id="plug-qt-s-local-prof" class="select">
                    <option value="">${t('plugins.qt.createNewProfile') || '— Create a new profile —'}</option>
                    ${profOpts2}
                </select>
            </div>
            <!-- Sync options row -->
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:flex-end;">
                <div style="flex:2;min-width:160px;">
                    <label class="plug-form-label" style="margin-bottom:4px;">${t('plugins.qt.syncMode') || 'Sync mode'}</label>
                    <select id="plug-qt-s-sync-mode" class="select" style="font-size:12px;">
                        <option value="smart">${t('plugins.qt.syncSmart') || 'Missing / incorrect only (fast)'}</option>
                        <option value="all">${t('plugins.qt.syncAll') || 'Full reinstall (overwrite_all)'}</option>
                    </select>
                </div>
                <div style="flex:1;min-width:90px;">
                    <label class="plug-form-label" style="margin-bottom:4px;">Download limit (KB/s)</label>
                    <input type="number" id="plug-qt-s-dl-limit" class="input" value="0" min="0" style="font-size:12px;">
                </div>
            </div>
            <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--text-secondary);">
                    <input type="checkbox" id="plug-qt-s-delete-extra" style="accent-color:var(--accent);">
                    ${t('plugins.qt.deleteExtra') || 'Remove mods missing from the repo (delete_extra)'}
                </label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--text-secondary);">
                    <input type="checkbox" id="plug-qt-s-keep-zipped" style="accent-color:var(--accent);">
                    ${t('plugins.qt.keepZipped') || 'Keep zipped mods as .zip (unzipArchives=false)'}
                </label>
            </div>`;
    }
    else if (p === '/api/repo/gen') {
        const profChecksGen = _allProfiles.length
            ? _allProfiles.map(pr => `
              <label style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;cursor:pointer;" data-hover="background:rgba(255,255,255,0.05)" data-hover-out="background:transparent">
                <input type="checkbox" class="plug-qt-host-prof-check" value="${escHtml(pr.id)}" style="accent-color:var(--accent);width:13px;height:13px;">
                <span style="font-size:12px;flex:1;">${escHtml(pr.name)}</span>
                <span style="font-size:10px;color:var(--text-muted);">${pr.active_mods?.length || 0} mods</span>
              </label>`).join('')
            : `<p style="font-size:12px;color:var(--text-muted);padding:8px;">Aucun profil disponible.</p>`;
        // Server distribution panel (shown when zip_output is checked OR standalone server is enabled)
        const serverPanel = `
            <div id="plug-qt-gen-server-panel" style="display:none;flex-direction:column;gap:6px;margin-top:8px;padding:10px 12px;background:rgba(0,0,0,0.15);border:1px solid rgba(255,255,255,0.07);border-radius:8px;">
                <div class="plug-form-label" style="margin-bottom:2px;">${IC.globe} Configuration serveur de distribution</div>
                <!-- Server Type -->
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:4px;">
                    <div style="display:flex;flex-direction:column;gap:2px;">
                        <label class="plug-form-label" style="font-size:10px;margin-bottom:2px;">server_type</label>
                        <select id="plug-qt-s-server-type" class="select select-sm" style="min-width:160px;">
                            <option value="user">user — Simple (Cloudflare/UPnP OK)</option>
                            <option value="server">server — Dédié Node.js (CF/UPnP désactivés)</option>
                        </select>
                    </div>
                </div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;">
                    <label id="plug-qt-gen-cf-lbl" style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text-secondary);">
                        <input type="checkbox" id="plug-qt-s-use-cf" style="accent-color:var(--accent);">
                        ${IC.globe} Cloudflare Tunnel
                    </label>
                    <label id="plug-qt-gen-upnp-lbl" style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text-secondary);">
                        <input type="checkbox" id="plug-qt-s-use-upnp" style="accent-color:var(--accent);">
                        UPnP (ouverture port)
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text-secondary);">
                        <input type="checkbox" id="plug-qt-s-use-docker" style="accent-color:var(--accent);">
                        Docker
                    </label>
                    <label id="plug-qt-gen-autostart-lbl" style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text-secondary);">
                        <input type="checkbox" id="plug-qt-s-auto-start" style="accent-color:var(--accent);">
                        auto_start
                    </label>
                </div>
                <!-- Docker sub-options -->
                <div id="plug-qt-gen-docker-opts" style="display:none;gap:8px;margin-top:4px;padding-left:8px;border-left:2px solid rgba(139,92,246,0.3);">
                    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                        <div style="flex:1;min-width:120px;">
                            <label class="plug-form-label" style="font-size:10px;margin-bottom:2px;">OS hôte</label>
                            <select id="plug-qt-s-docker-os" class="select select-sm">
                                <option value="linux">Linux</option>
                                <option value="windows">Windows</option>
                            </select>
                        </div>
                        <div style="flex:1;min-width:120px;">
                            <label class="plug-form-label" style="font-size:10px;margin-bottom:2px;">Version serveur</label>
                            <select id="plug-qt-s-server-version" class="select select-sm">
                                <option value="std">Standard</option>
                                <option value="lux">Lux (premium)</option>
                            </select>
                        </div>
                    </div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
                    <div style="flex:1;min-width:100px;">
                        <label class="plug-form-label" style="font-size:10px;margin-bottom:2px;">Port</label>
                        <input type="number" id="plug-qt-s-port" class="input input-sm" placeholder="8080" value="8080" style="font-size:12px;">
                    </div>
                    <div style="flex:1;min-width:100px;">
                        <label class="plug-form-label" style="font-size:10px;margin-bottom:2px;">Upload limit (KB/s, 0=∞)</label>
                        <input type="number" id="plug-qt-s-upload-limit" class="input input-sm" placeholder="0" value="0" style="font-size:12px;">
                    </div>
                    <div style="flex:1;min-width:120px;">
                        <label class="plug-form-label" style="font-size:10px;margin-bottom:2px;">Mot de passe admin</label>
                        <form style="display:contents" autocomplete="off" data-no-submit="1"><input type="password" id="plug-qt-s-admin-pw" class="input input-sm" placeholder="(optionnel)" style="font-size:12px;"></form>
                    </div>
                </div>
            </div>`;
        formHtml = `
            <!-- Profile selection -->
            <div class="plug-qt-smart-field" style="flex-direction:column;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                    <label class="plug-form-label" style="margin:0;">profile_ids <span style="color:var(--danger)">*</span></label>
                    <div style="display:flex;gap:4px;">
                        <button type="button" id="plug-qt-gen-sel-all"  class="btn btn-xs btn-ghost" style="font-size:10px;">${t('common.all') || 'All'}</button>
                        <button type="button" id="plug-qt-gen-sel-none" class="btn btn-xs btn-ghost" style="font-size:10px;">${t('common.none') || 'None'}</button>
                    </div>
                </div>
                <div style="background:rgba(0,0,0,0.15);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:4px;max-height:120px;overflow-y:auto;scrollbar-width:thin;">${profChecksGen}</div>
            </div>
            <!-- Output dir + author -->
            <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;">
                <div style="flex:2;min-width:160px;display:flex;flex-direction:column;gap:2px;">
                    <label class="plug-form-label" style="font-size:10px;">output_dir <span style="color:var(--danger)">*</span></label>
                    <input type="text" id="plug-qt-s-output-dir" class="input" placeholder="C:/BMM/Export/Repo" style="font-family:var(--font-mono);font-size:12px;">
                </div>
                <div style="flex:1;min-width:120px;display:flex;flex-direction:column;gap:2px;">
                    <label class="plug-form-label" style="font-size:10px;">author_name <span style="color:var(--danger)">*</span></label>
                    <input type="text" id="plug-qt-s-author-name" class="input" placeholder="${escAttr(t('plugins.phAuthorName'))}" style="font-size:12px;">
                </div>
            </div>
            <!-- Seed -->
            <div style="margin-top:6px;display:flex;flex-direction:column;gap:2px;">
                <label class="plug-form-label" style="font-size:10px;">seed <span style="color:var(--text-muted);font-size:10px;">${escHtml(t('plugins.qt.seedOptional'))}</span></label>
                <input type="text" id="plug-qt-s-seed" class="input input-sm" placeholder="${t('plugins.qt.seedPh') || 'leave empty for random'}" style="font-family:var(--font-mono);font-size:12px;">
            </div>
            <!-- zip_output / zip_mods -->
            <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;align-items:center;">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text-secondary);">
                    <input type="checkbox" id="plug-qt-s-zip-output" style="accent-color:var(--accent);">
                    ${IC.upload} zip_output (${t('plugins.qt.zipOutput') || 'compress into a .zip'})
                </label>
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text-secondary);">
                    <input type="checkbox" id="plug-qt-s-zip-mods" style="accent-color:var(--accent);">
                    ${IC.upload} zip_mods (${t('plugins.qt.zipMods') || 'one .zip per mod'})
                </label>
            </div>
            ${serverPanel}`;
    }
    else if (p === '/api/repo/update') {
        formHtml = `
            <div style="display:flex;flex-direction:column;gap:12px;">
              ${txtInput('plug-qt-s-repo-dir', t('plugins.qt.repoDir') || 'repo_dir — existing repo folder (contains repo.json)', 'C:/BMM/MyRepo')}
              <div style="padding:10px 12px;background:rgba(6,182,212,0.08);border:1px solid rgba(6,182,212,0.2);border-radius:8px;font-size:11px;color:var(--cyan);line-height:1.5;">
                <b>${t('plugins.qt.uiDriven') || 'UI-driven'} :</b> ${t('plugins.qt.repoUpdateNote') || 'Clicking "Send" opens the Server Repo page with the Update repo modal pre-filled. You see the repo contents, choose which mods to add/remove, then confirm — as if doing it by hand.'}
              </div>
            </div>`;
    }
    else if (p === '/api/catalog/new') {
        const previewFn = `(() => {
          const n=document.getElementById('plug-qt-cat-name')?.value||'My Catalog';
          const d=document.getElementById('plug-qt-cat-desc')?.value||'';
          document.getElementById('plug-qt-cat-preview').textContent=JSON.stringify({version:'1.0',name:n,description:d,partner_catalogs:[],community_imports:[],apps:[]},null,2);
        })()`;
        formHtml = `<div style="display:flex;flex-direction:column;gap:10px;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start;">
              <div style="display:flex;flex-direction:column;gap:8px;">
                ${txtInput('plug-qt-cat-name', t('plugins.qtCatName') || 'Catalog name', 'My Catalog')}
                ${txtInput('plug-qt-cat-desc', t('plugins.qtCatDesc') || 'Description (optional)', '', true)}
                <p style="font-size:10px;color:var(--text-muted);margin:0;">${t('plugins.qtCatNewInfo') || 'Creates/resets <code>apps-catalog.json</code> in BMM AppData.'}</p>
              </div>
              <div>
                <label class="plug-form-label" style="margin-bottom:4px;">${t('plugins.qtJsonPreview') || 'JSON preview'}</label>
                <pre id="plug-qt-cat-preview" style="background:rgba(0,0,0,0.25);border:1px solid var(--border);border-radius:8px;padding:9px;font-size:10px;color:var(--accent);max-height:160px;overflow:auto;white-space:pre-wrap;word-break:break-all;">{}</pre>
              </div>
            </div>
        </div>`;
    }
    else if (p === '/api/catalog/apps' && m === 'POST') {
        const req = `<span style="color:var(--danger)">*</span>`;
        formHtml = `<div style="display:flex;flex-direction:column;gap:10px;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;">
              <div><label class="plug-form-label" style="margin-bottom:4px;">id ${req}</label>
                <input id="plug-qt-catapp-id" class="input" placeholder="my-app" style="font-family:var(--font-mono);font-size:12px;"></div>
              <div><label class="plug-form-label" style="margin-bottom:4px;">title ${req}</label>
                <input id="plug-qt-catapp-title" class="input" placeholder="${escAttr(t('plugins.phAppTitle'))}" style="font-size:12px;"></div>
            </div>
            <div><label class="plug-form-label" style="margin-bottom:4px;">description</label>
              <textarea id="plug-qt-catapp-desc" class="input" rows="2" style="resize:vertical;font-size:12px;width:100%;" placeholder="${escAttr(t('plugins.phAppDesc'))}"></textarea></div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
              <div><label class="plug-form-label" style="margin-bottom:4px;">category</label>
                <select id="plug-qt-catapp-cat" class="select select-sm" style="width:100%"><option value="utility">Utility</option><option value="game">Game</option><option value="other">Other</option></select></div>
              <div><label class="plug-form-label" style="margin-bottom:4px;">price</label>
                <select id="plug-qt-catapp-price" class="select select-sm" style="width:100%"><option value="free">Free</option><option value="freemium">Freemium</option><option value="paid">Paid</option></select></div>
              <div><label class="plug-form-label" style="margin-bottom:4px;">file_type ${req}</label>
                <select id="plug-qt-catapp-ftype" class="select select-sm" style="width:100%"><option>exe</option><option>zip</option><option>msi</option><option>script</option></select></div>
            </div>
            <div><label class="plug-form-label" style="margin-bottom:4px;">download.url ${req}</label>
              <input id="plug-qt-catapp-url" class="input" placeholder="https://github.com/.../app.exe" style="font-family:var(--font-mono);font-size:12px;"></div>
            <details style="border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:0;">
              <summary style="padding:8px 12px;cursor:pointer;font-size:12px;color:var(--text-secondary);font-weight:600;">${t('plugins.qtOptionalFields') || 'Optional fields'} (version, tags, images, requirements…)</summary>
              <div style="padding:0 12px 12px;display:flex;flex-direction:column;gap:8px;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                  ${txtInput('plug-qt-catapp-version', 'version', '1.0.0', true)}
                  ${txtInput('plug-qt-catapp-size', 'download.size (bytes)', '', true)}
                </div>
                ${txtInput('plug-qt-catapp-tags', t('plugins.qtCatAppTags') || 'tags (comma, max 3)', 'dcs, tool', true)}
                ${txtInput('plug-qt-catapp-thumb', 'images.thumb URL', 'https://…/thumb.png', true)}
                ${txtInput('plug-qt-catapp-extra', 'images.extra (comma URLs)', '', true)}
                ${txtInput('plug-qt-catapp-reqs', t('plugins.qtCatAppReqs') || 'requirements', 'Windows 10+', true)}
                ${txtInput('plug-qt-catapp-md', 'md_link (README URL)', 'https://github.com/.../README.md', true)}
                <div style="display:flex;gap:18px;margin-top:4px;">
                  <label style="display:flex;align-items:center;gap:7px;font-size:12px;cursor:pointer;"><input type="checkbox" id="plug-qt-catapp-official" style="accent-color:var(--amber)"> official</label>
                  <label style="display:flex;align-items:center;gap:7px;font-size:12px;cursor:pointer;"><input type="checkbox" id="plug-qt-catapp-partner"  style="accent-color:var(--accent)"> partner</label>
                </div>
              </div>
            </details>
            <div>
              <label class="plug-form-label" style="margin-bottom:4px;">${t('plugins.qtJsonPreview') || 'JSON preview'}</label>
              <pre id="plug-qt-catapp-preview" style="background:rgba(0,0,0,0.25);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:10px;color:var(--accent);max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-all;margin:0;">{}</pre>
            </div>
        </div>`;
    }
    else if (p === '/api/apps/install') {
        const installedApps = _catalog.length ? '' : '';
        formHtml = `<div style="display:flex;flex-direction:column;gap:10px;">
            ${txtInput('plug-qt-app-id', 'app_id (identifiant unique)', 'my-app-id')}
            ${txtInput('plug-qt-app-title', 'app_title (nom affiché)', 'My App')}
            ${txtInput('plug-qt-app-url', 'download_url', 'https://github.com/.../app.exe')}
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <div style="flex:1;min-width:120px;">
                    <label class="plug-form-label">file_type</label>
                    <select id="plug-qt-app-ftype" class="select select-sm" style="width:100%;">
                        <option>exe</option><option>zip</option><option>msi</option><option>script</option>
                    </select>
                </div>
                <div style="flex:2;min-width:180px;">${txtInput('plug-qt-app-path', 'install_path', '')}</div>
            </div>
            <p style="font-size:11px;color:var(--text-muted);margin:0;">${escHtml(t('plugins.qt.installPathHint'))}</p>
        </div>`;
    }
    else if (p === '/api/apps/launch') {
        const installed = window.__latestAppsState?.installed
            ? Object.values(window.__latestAppsState.installed) : [];
        const selOpts = installed.map((a) => `<option value="${escHtml(a.id)}" data-exe="${escAttr(a.exe_path || '')}">${escHtml(a.title)}</option>`).join('');
        formHtml = `<div style="display:flex;flex-direction:column;gap:10px;">
            ${selOpts
            ? `<div><label class="plug-form-label">App installée</label>
                   <select id="plug-qt-launch-sel" class="select select-sm" style="width:100%;">${selOpts}</select>
                   <p style="font-size:10px;color:var(--text-muted);margin-top:4px;">Sélectionner remplira automatiquement les champs.</p></div>`
            : '<p style="font-size:12px;color:var(--text-muted);">' + escHtml(t('plugins.qt.noAppInstalled')) + '</p>'}
            ${txtInput('plug-qt-launch-id', 'app_id', installed[0]?.id || '')}
            ${txtInput('plug-qt-launch-exe', 'exe_path', installed[0]?.exe_path || 'C:/path/to/app.exe')}
        </div>`;
    }
    else if (p === '/api/apps/permissions/:id' && m === 'PUT') {
        // Plugin selector (installed plugins) + grouped permission checkboxes
        const permGroups = [
            { group: 'Apps', color: '#f97316', perms: ['app.read', 'app.write'] },
            { group: 'Catalog', color: '#06b6d4', perms: ['catalog.read', 'catalog.write'] },
            { group: 'Mods', color: '#3b82f6', perms: ['mods.write'] },
            { group: 'Profiles', color: '#a855f7', perms: ['profiles.write'] },
            { group: 'Modpacks', color: '#8b5cf6', perms: ['modpacks.write'] },
            { group: 'Plugins', color: '#ec4899', perms: ['plugins.read', 'plugins.write'] },
            { group: 'Repo', color: '#10b981', perms: ['repo.write'] },
            { group: 'Keys', color: '#eab308', perms: ['keys.write'] },
        ];
        const permRows = permGroups.map(g => `
            <div style="margin-bottom:8px;">
                <div style="font-size:9px;font-weight:800;color:${g.color};text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px;">${g.group}</div>
                <div style="display:flex;gap:14px;flex-wrap:wrap;">
                    ${g.perms.map(perm => `
                    <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;white-space:nowrap;">
                        <input type="checkbox" class="plug-qt-perm-check" value="${perm}" style="accent-color:${g.color};">
                        <code style="font-size:11px;color:${g.color};">${perm}</code>
                    </label>`).join('')}
                </div>
            </div>`).join('');
        const pluginPickOpts = _installedPlugins.length
            ? `<option value="">— ${t('plugins.qtPermTypeId') || 'type id or pick a plugin'} —</option>` +
                _installedPlugins.map(pl => `<option value="${escHtml(pl.manifest.id)}">${escHtml(pl.manifest.name)} (${escHtml(pl.manifest.id)})</option>`).join('')
            : '';
        formHtml = `<div style="display:flex;flex-direction:column;gap:11px;">
            ${pluginPickOpts ? `<div><label class="plug-form-label" style="margin-bottom:4px;">${t('plugins.qtPermPickPlugin') || 'Plugin'}</label>
              <select id="plug-qt-perm-sel" class="select select-sm" style="width:100%;">${pluginPickOpts}</select></div>` : ''}
            <div><label class="plug-form-label" style="margin-bottom:4px;">plugin_id <span style="color:var(--danger)">*</span></label>
              <input type="text" id="plug-qt-perm-id" class="input" placeholder="my-plugin-id" style="font-family:var(--font-mono);font-size:12px;"></div>
            <div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <label class="plug-form-label" style="margin:0;">${t('plugins.qtPermGrant') || 'Grant permissions'}</label>
                    <div style="display:flex;gap:5px;">
                        <button type="button" id="plug-qt-perm-all" class="btn btn-xs btn-ghost" style="font-size:10px;">${t('common.all') || 'All'}</button>
                        <button type="button" id="plug-qt-perm-none" class="btn btn-xs btn-ghost" style="font-size:10px;">${t('common.none') || 'None'}</button>
                    </div>
                </div>
                <div style="background:rgba(0,0,0,0.18);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:12px;">
                    ${permRows}
                </div>
            </div>
            <div style="padding:9px 12px;background:rgba(6,182,212,0.07);border:1px solid rgba(6,182,212,0.2);border-radius:8px;font-size:10px;color:var(--cyan);line-height:1.5;">
              ${t('plugins.qtPermHint') || 'Each plugin should authenticate with its OWN token (below) — its API access is then limited to the granted permissions. The admin token always has full access. The old <code>X-BMM-Plugin-Id</code> header is no longer trusted for identity.'}
            </div>
            <div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:11px;display:flex;flex-direction:column;gap:7px;">
                <label class="plug-form-label" style="margin:0;">${t('plugins.qtTokenTitle') || 'Plugin API token'}</label>
                <div style="font-size:10px;color:var(--text-muted);line-height:1.5;">${t('plugins.qtTokenHint') || 'Give this plugin its OWN token so its access is limited to the permissions above. The plugin then sends <code>Authorization: Bearer &lt;token&gt;</code> (never the admin token).'}</div>
                <div style="display:flex;gap:6px;align-items:center;">
                    <input type="text" id="plug-qt-token-out" class="input" readonly placeholder="${t('plugins.qtTokenNone') || 'no token yet'}" style="font-family:var(--font-mono);font-size:11px;flex:1;">
                    <button type="button" id="plug-qt-token-gen" class="btn btn-xs btn-secondary" style="font-size:10px;white-space:nowrap;">${t('plugins.qtTokenGen') || 'Generate'}</button>
                    <button type="button" id="plug-qt-token-copy" class="btn btn-xs btn-ghost" style="font-size:10px;">${t('common.copy') || 'Copy'}</button>
                    <button type="button" id="plug-qt-token-revoke" class="btn btn-xs btn-ghost" style="font-size:10px;color:var(--danger);">${t('plugins.qtTokenRevoke') || 'Revoke'}</button>
                </div>
            </div>
        </div>`;
    }
    else if (p === '/api/apps/:id' && m === 'DELETE') {
        const installed = window.__latestAppsState?.installed
            ? Object.values(window.__latestAppsState.installed) : [];
        const selOpts2 = installed.map((a) => `<option value="${escHtml(a.id)}">${escHtml(a.title)} (${escHtml(a.id)})</option>`).join('');
        formHtml = `<div style="display:flex;flex-direction:column;gap:10px;">
            ${selOpts2
            ? `<div><label class="plug-form-label">App à désinstaller</label>
                   <select id="plug-qt-del-app-sel" class="select select-sm" style="width:100%;">${selOpts2}</select></div>`
            : ''}
            ${txtInput('plug-qt-del-app-id', 'app_id (ou taper manuellement)', installed[0]?.id || '')}
            <p style="font-size:11px;color:var(--text-muted);">${t('plugins.qtAppDelNote') || 'Files are kept on disk — removes from BMM registry only.'}</p>
        </div>`;
    }
    else if (p === '/api/plugins/export') {
        formHtml = `<div style="display:flex;flex-direction:column;gap:10px;">
            ${plugSel}
            <div style="padding:9px 12px;background:rgba(6,182,212,0.08);border:1px solid rgba(6,182,212,0.2);border-radius:8px;font-size:11px;color:var(--cyan);line-height:1.5;">
              ${t('plugins.qtPluginExportInfo') || 'UI-driven — BMM opens a save-file dialog. The plugin is exported as a <code>.bmmplug</code> archive.'}
            </div>
        </div>`;
    }
    else if (p === '/api/modpacks/export') {
        formHtml = `<div style="display:flex;flex-direction:column;gap:10px;">
            ${modpackSel}
            <div>
              <label class="plug-form-label" style="margin-bottom:4px;">${t('plugins.qtDestFolder') || 'Destination folder'} <span style="color:var(--text-muted);font-size:10px;">(${t('plugins.qtImportPathHint') || 'leave empty to open save dialog'})</span></label>
              <div style="display:flex;gap:7px;">
                <input id="plug-qt-mp-dest" class="input" placeholder="C:/Exports" style="flex:1;font-family:var(--font-mono);font-size:12px;">
                <button type="button" id="plug-qt-mp-browse" class="btn btn-sm btn-secondary">${t('plugins.qtBrowse') || 'Browse'}</button>
              </div>
            </div>
            <div style="padding:9px 12px;background:rgba(6,182,212,0.08);border:1px solid rgba(6,182,212,0.2);border-radius:8px;font-size:11px;color:var(--cyan);line-height:1.5;">
              ${t('plugins.qtModpackExportInfo') || 'Pick a folder to export the .bmp straight there (no dialog), or leave empty to choose the file manually.'}
            </div>
        </div>`;
    }
    else if (p === '/api/repo/host') {
        formHtml = txtInput('plug-qt-s-serve-dir', 'serve_dir (dossier à servir)', 'C:/BMM/Export/Repo')
            + txtInput('plug-qt-s-http-port', 'port', '8080', true)
            + txtInput('plug-qt-s-http-upload-limit', 'upload_limit (KB/s, 0 = illimité)', '0', true);
    }
    else if (p === '/api/language/template') {
        formHtml = `<div style="display:flex;flex-direction:column;gap:10px;">
            <div style="padding:10px 12px;background:rgba(6,182,212,0.08);border:1px solid rgba(6,182,212,0.2);border-radius:8px;font-size:12px;color:var(--cyan);line-height:1.6;">
                ${t('plugins.qtLangTemplateDesc') || 'Downloads <b>lang-template.json</b> — all BMM translation keys with English defaults. Translate the values → import via POST /api/language/import.'}
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <a href="${apiBase()}/api/language/template" download="lang-template.json" class="btn btn-sm btn-accent" style="text-decoration:none;">
                    ⬇ ${t('plugins.qtLangTemplateBtn') || 'Download lang-template.json'}
                </a>
            </div>
            <p style="font-size:11px;color:var(--text-muted);margin:0;">${t('plugins.qtLangTemplateWorkflow') || 'Clicking "Send" below previews the JSON response in the result panel.'}</p>
        </div>`;
    }
    else if ([
        '/api/language/import', '/api/plugins/import', '/api/modpacks/import',
        '/api/modlists/import', '/api/data/import', '/api/profiles/import/ovgme',
        '/api/profiles/import/omm', '/api/data/export', '/api/modlists/export',
    ].includes(p)) {
        const uiDrivenNote = (() => {
            if (p === '/api/plugins/import')
                return t('plugins.qtImportPluginNote') || 'Opens a file-picker dialog. Select a <code>.bmmplug</code> file to install.';
            if (p === '/api/modpacks/import')
                return t('plugins.qtImportModpackNote') || 'Opens a file-picker dialog. Select a <code>.bmp</code> file to import.';
            if (p === '/api/modlists/import')
                return t('plugins.qtImportMlNote') || 'Opens a file-picker dialog. Select a mod list file to import.';
            if (p === '/api/data/import')
                return t('plugins.qtImportDataNote') || 'Opens a file-picker dialog. Select a BMM data export to restore.';
            if (p === '/api/data/export')
                return t('plugins.qtExportDataNote') || 'Opens a save-file dialog. Exports all BMM data (profiles, mods, settings) to a JSON file.';
            if (p === '/api/modlists/export')
                return t('plugins.qtExportMlNote') || 'Opens a save-file dialog. Exports the active profile mod list.';
            if (p === '/api/language/import')
                return t('plugins.qtImportLangNote') || 'Opens a file-picker dialog. Select a <code>.json</code> lang file to install.';
            return t('plugins.qtUIDriven') || 'UI-driven — triggers a native BMM dialog. No JSON body required.';
        })();
        // These imports support a direct file path (skip the dialog if provided)
        const pathCapable = ['/api/language/import', '/api/modpacks/import'].includes(p);
        const pathField = pathCapable ? `
            <div>
              <label class="plug-form-label" style="margin-bottom:4px;">${t('plugins.qtImportPath') || 'File path'} <span style="color:var(--text-muted);font-size:10px;">(${t('plugins.qtImportPathHint') || 'leave empty to open file picker'})</span></label>
              <div style="display:flex;gap:7px;">
                <input id="plug-qt-import-path" class="input" placeholder="${p === '/api/language/import' ? 'C:/.../fr.json' : 'C:/.../pack.bmp'}" style="flex:1;font-family:var(--font-mono);font-size:12px;">
                <button type="button" id="plug-qt-import-browse" class="btn btn-sm btn-secondary">${t('plugins.qtBrowse') || 'Browse'}</button>
              </div>
            </div>` : '';
        formHtml = `<div style="display:flex;flex-direction:column;gap:10px;">
            <div style="padding:10px 12px;background:rgba(6,182,212,0.08);border:1px solid rgba(6,182,212,0.2);border-radius:8px;font-size:12px;color:var(--cyan);line-height:1.6;">
                <b>${t('plugins.qtUIDrivenLabel') || 'UI-driven'}</b> — ${uiDrivenNote}
            </div>
            ${pathField}
        </div>`;
    }
    else if (p === '/api/catalog/apps/:id' && m === 'PUT') {
        // Try to load existing catalog to pre-populate a dropdown (auth required → send token)
        let catAppOpts = '';
        try {
            const liveTok = document.getElementById('plug-token-display')?.value?.trim() || _apiToken;
            const cat = await (async () => {
                const r = await fetch(apiBase() + '/api/catalog', { headers: { 'Authorization': `Bearer ${liveTok}` } });
                return r.ok ? r.json() : null;
            })();
            if (cat?.apps?.length) {
                catAppOpts = cat.apps.map((a) => `<option value="${escHtml(a.id)}">${escHtml(a.title || a.id)} (${escHtml(a.id)})</option>`).join('');
            }
        }
        catch { }
        const req = `<span style="color:var(--danger)">*</span>`;
        const hintTxt = t('plugins.qtCatUpdHint') || 'Only filled fields are updated — leave blank to keep existing value.';
        formHtml = `<div style="display:flex;flex-direction:column;gap:10px;">
            ${catAppOpts
            ? `<div><label class="plug-form-label" style="margin-bottom:4px;">${t('plugins.qtCatPickApp') || 'Pick app from catalog'}</label>
                   <select id="plug-qt-catupd-sel" class="select select-sm" style="width:100%;"><option value="">— ${t('plugins.qtCatPickHint') || 'pick to pre-fill'} —</option>${catAppOpts}</select></div>`
            : ''}
            <div><label class="plug-form-label" style="margin-bottom:4px;">App id ${req}</label>
              <input id="plug-qt-catupd-id" class="input" placeholder="my-app" style="font-family:var(--font-mono);font-size:12px;"></div>
            <div style="padding:8px 11px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:8px;font-size:10px;color:var(--amber);">${hintTxt}</div>
            <details style="border:1px solid rgba(255,255,255,0.07);border-radius:8px;" open>
              <summary style="padding:8px 12px;cursor:pointer;font-size:12px;color:var(--text-secondary);font-weight:600;">${t('plugins.qtFieldsToUpdate') || 'Fields to update'}</summary>
              <div style="padding:0 12px 12px;display:flex;flex-direction:column;gap:8px;">
                ${txtInput('plug-qt-catupd-title', 'title', '', true)}
                <div><label class="plug-form-label" style="margin-bottom:4px;">description</label>
                  <textarea id="plug-qt-catupd-desc" class="input" rows="2" style="resize:vertical;font-size:12px;width:100%;"></textarea></div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
                  <div><label class="plug-form-label" style="margin-bottom:4px;">category</label>
                    <select id="plug-qt-catupd-cat" class="select select-sm" style="width:100%;"><option value="">— keep —</option><option value="utility">utility</option><option value="game">game</option><option value="other">other</option></select></div>
                  <div><label class="plug-form-label" style="margin-bottom:4px;">price</label>
                    <select id="plug-qt-catupd-price" class="select select-sm" style="width:100%;"><option value="">— keep —</option><option value="free">free</option><option value="freemium">freemium</option><option value="paid">paid</option></select></div>
                  <div><label class="plug-form-label" style="margin-bottom:4px;">file_type</label>
                    <select id="plug-qt-catupd-ftype" class="select select-sm" style="width:100%;"><option value="">— keep —</option><option>exe</option><option>zip</option><option>msi</option><option>script</option></select></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                  ${txtInput('plug-qt-catupd-ver', 'version', '', true)}
                  ${txtInput('plug-qt-catupd-tags', 'tags (comma, max 3)', '', true)}
                </div>
                ${txtInput('plug-qt-catupd-url', 'download.url', '', true)}
                ${txtInput('plug-qt-catupd-thumb', 'images.thumb URL', '', true)}
                ${txtInput('plug-qt-catupd-reqs', 'requirements', '', true)}
                ${txtInput('plug-qt-catupd-md', 'md_link', '', true)}
              </div>
            </details>
            <div>
              <label class="plug-form-label" style="margin-bottom:4px;">${t('plugins.qtJsonPreview') || 'JSON preview'}</label>
              <pre id="plug-qt-catupd-preview" style="background:rgba(0,0,0,0.25);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:10px;color:var(--accent);max-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-all;margin:0;">{}</pre>
            </div>
        </div>`;
    }
    else if (p === '/api/catalog/apps/:id' && m === 'DELETE') {
        formHtml = `<div style="display:flex;flex-direction:column;gap:10px;">
            ${txtInput('plug-qt-catdel-id', t('plugins.qtCatAppId') || 'App id to remove from catalog', '', false)}
            <div style="padding:9px 12px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:8px;font-size:11px;color:color-mix(in srgb, var(--bmm-danger) 75%, var(--bmm-text-primary));line-height:1.5;">
              ${t('plugins.qtCatDelWarn') || 'This removes the app from the local catalog only. Installed files are not touched.'}
            </div>
        </div>`;
    }
    else if (m === 'GET' || (m === 'DELETE' && !rawBody)) {
        // Parameterless GET / DELETE: no body form — just Send + Copy cURL in the footer.
        formHtml = `<p style="font-size:13px;color:var(--text-secondary);margin:0;">${t('plugins.qtNoBody') || `${escHtml(m)} request — no parameters required. Use “Send” to run it, or “cURL” to copy the command.`}</p>`;
    }
    else {
        const pretty = (() => { try {
            return JSON.stringify(JSON.parse(rawBody), null, 2);
        }
        catch {
            return rawBody;
        } })();
        formHtml = `<div style="display:flex;flex-direction:column;gap:7px;">
            <div style="display:flex;align-items:center;gap:7px;">
                <span style="font-size:11px;font-weight:700;color:var(--text-secondary);">${t('plugins.qtRequestBody') || 'Request body'}</span>
                <span style="font-size:9px;font-weight:800;color:var(--accent);background:rgba(6,182,212,0.12);padding:1px 7px;border-radius:5px;">JSON</span>
            </div>
            <p style="font-size:11px;color:var(--text-muted);margin:0;">${t('plugins.qtBodyHint') || 'Edit the request body before sending.'}</p>
            <textarea id="plug-qt-s-json" class="input" spellcheck="false"
                style="font-family:var(--font-mono);font-size:12px;min-height:130px;resize:vertical;width:100%;box-sizing:border-box;line-height:1.5;tab-size:2;">${escHtml(pretty)}</textarea>
        </div>`;
    }
    const methodCls = { GET: 'plug-method-get', POST: 'plug-method-post', PUT: 'plug-method-put', DELETE: 'plug-method-delete', PATCH: 'plug-method-patch' };
    const overlay = createOverlay(`
        <div class="plug-ov-header">
            <span class="plug-ov-title">${IC.play} <span class="plug-method ${methodCls[m] || 'plug-method-get'}" style="font-size:10px;">${escHtml(m)}</span> <code style="font-size:11px;color:var(--accent);margin-left:4px;">${escHtml(p)}</code></span>
            <button class="btn btn-xs btn-ghost plug-ov-close-btn">${IC.x}</button>
        </div>
        <div class="plug-ov-body" style="padding:16px 18px;display:flex;flex-direction:column;gap:4px;">
            ${formHtml}
        </div>
        <div class="plug-ov-footer">
            <button class="btn btn-ghost plug-ov-close-btn">${t('common.cancel')}</button>
            <button class="btn btn-ghost" id="plug-qt-s-copy"  style="gap:5px;">${IC.copy} cURL</button>
            <button class="btn btn-accent" id="plug-qt-s-run">${IC.play} ${t('plugins.run')}</button>
        </div>`);
    overlay.querySelectorAll('.plug-ov-close-btn').forEach(b => b.addEventListener('click', () => overlay.remove()));
    // ── Copy cURL button ─────────────────────────────────────────────────────
    overlay.querySelector('#plug-qt-s-copy')?.addEventListener('click', async () => {
        // Build the actual body from form fields (mirrors the Run handler, read-only)
        let bodyObj = null;
        let resolvedCopyPath = p;
        if (p === '/api/repo/gen') {
            const profIds = Array.from(overlay.querySelectorAll('.plug-qt-host-prof-check:checked')).map(c => c.value);
            const outputDir = overlay.querySelector('#plug-qt-s-output-dir')?.value?.trim() || '';
            const author = overlay.querySelector('#plug-qt-s-author-name')?.value?.trim() || '';
            const seed = overlay.querySelector('#plug-qt-s-seed')?.value?.trim();
            const zipOutput = overlay.querySelector('#plug-qt-s-zip-output')?.checked || false;
            const zipMods = overlay.querySelector('#plug-qt-s-zip-mods')?.checked || false;
            const srvType = overlay.querySelector('#plug-qt-s-server-type')?.value || 'user';
            const isServerType = srvType === 'server';
            const useCf = isServerType ? false : (overlay.querySelector('#plug-qt-s-use-cf')?.checked || false);
            const useUpnp = isServerType ? false : (overlay.querySelector('#plug-qt-s-use-upnp')?.checked || false);
            const autoStart = isServerType ? false : (overlay.querySelector('#plug-qt-s-auto-start')?.checked || false);
            const useDocker = overlay.querySelector('#plug-qt-s-use-docker')?.checked || false;
            const dockerOs = overlay.querySelector('#plug-qt-s-docker-os')?.value || 'linux';
            const srvVer = overlay.querySelector('#plug-qt-s-server-version')?.value || 'std';
            const portStr = overlay.querySelector('#plug-qt-s-port')?.value?.trim();
            const ulStr = overlay.querySelector('#plug-qt-s-upload-limit')?.value?.trim();
            const adminPw = overlay.querySelector('#plug-qt-s-admin-pw')?.value?.trim();
            bodyObj = { profileIds: profIds, outputDir, authorName: author, generateServer: zipOutput, zipOutput, zipMods, serverType: srvType, useCloudflare: useCf, useUpnp, autoStart };
            if (seed)
                bodyObj.seed = seed;
            if (portStr)
                bodyObj.port = parseInt(portStr, 10) || 8080;
            if (ulStr)
                bodyObj.uploadLimit = parseInt(ulStr, 10) || 0;
            if (adminPw)
                bodyObj.adminPassword = adminPw;
            if (useDocker) {
                bodyObj.useDocker = true;
                bodyObj.dockerOs = dockerOs;
                bodyObj.serverVersion = srvVer;
            }
        }
        else if (p === '/api/repo/sync') {
            const profIds = Array.from(overlay.querySelectorAll('.plug-qt-sync-prof-check:checked')).map(c => c.value);
            bodyObj = {
                url: overlay.querySelector('#plug-qt-s-repo-url')?.value?.trim() || '',
                gameDir: overlay.querySelector('#plug-qt-s-game-dir')?.value?.trim() || '',
                modsDir: overlay.querySelector('#plug-qt-s-mods-dir')?.value?.trim() || '',
                backupDir: overlay.querySelector('#plug-qt-s-backup-dir')?.value?.trim() || '',
                overwriteAll: overlay.querySelector('#plug-qt-s-sync-mode')?.value === 'all',
                deleteExtra: overlay.querySelector('#plug-qt-s-delete-extra')?.checked || false,
                downloadLimit: parseInt(overlay.querySelector('#plug-qt-s-dl-limit')?.value || '0', 10) || 0,
                unzipArchives: !(overlay.querySelector('#plug-qt-s-keep-zipped')?.checked || false),
            };
            if (profIds.length)
                bodyObj.choices = profIds.map(pid => ({ repoProfileId: pid }));
        }
        else if (p === '/api/repo/host') {
            bodyObj = {
                serveDir: overlay.querySelector('#plug-qt-s-serve-dir')?.value?.trim() || '',
                port: parseInt(overlay.querySelector('#plug-qt-s-http-port')?.value || '8080', 10),
                uploadLimit: parseInt(overlay.querySelector('#plug-qt-s-http-upload-limit')?.value || '0', 10),
            };
        }
        else if (p === '/api/modpacks/create') {
            const name = overlay.querySelector('#plug-qt-s-name')?.value?.trim() || '';
            const desc = overlay.querySelector('#plug-qt-s-desc')?.value?.trim();
            const game = overlay.querySelector('#plug-qt-s-game')?.value?.trim();
            const sr = overlay.querySelector('#plug-qt-s-sr-link')?.value?.trim();
            const dep = overlay.querySelector('#plug-qt-s-dep-mode')?.value || 'none';
            const multi = overlay.querySelector('#plug-qt-s-multi-profile')?.checked || false;
            const skip = overlay.querySelector('#plug-qt-s-skip-integrity')?.checked || false;
            const mods = Array.from(overlay.querySelectorAll('.plug-qt-mod-check:checked')).map(c => c.value);
            bodyObj = { name, multi_profile: multi, skip_integrity_check: skip, dependency_mode: dep };
            if (desc)
                bodyObj.description = desc;
            if (game)
                bodyObj.game_name = game;
            if (sr)
                bodyObj.sr_link = sr;
            if (mods.length)
                bodyObj.mod_ids = mods;
        }
        else if (p === '/api/modpacks/:id' && m === 'PUT') {
            const mpId = overlay.querySelector('#plug-qt-s-modpack')?.value || '';
            resolvedCopyPath = `/api/modpacks/${mpId}`;
            bodyObj = {
                name: overlay.querySelector('#plug-qt-s-name')?.value?.trim() || '',
                multi_profile: overlay.querySelector('#plug-qt-s-multi-profile')?.checked || false,
                skip_integrity_check: overlay.querySelector('#plug-qt-s-skip-integrity')?.checked || false,
                dependency_mode: overlay.querySelector('#plug-qt-s-dep-mode')?.value || 'none',
            };
            const desc2 = overlay.querySelector('#plug-qt-s-description')?.value?.trim();
            const gn2 = overlay.querySelector('#plug-qt-s-game-name')?.value?.trim();
            const sr2 = overlay.querySelector('#plug-qt-s-sr-link')?.value?.trim();
            const mods2 = Array.from(overlay.querySelectorAll('.plug-qt-upd-mod-check:checked')).map(c => c.value);
            if (desc2)
                bodyObj.description = desc2;
            if (gn2)
                bodyObj.game_name = gn2;
            if (sr2)
                bodyObj.sr_link = sr2;
            if (mods2.length)
                bodyObj.mod_ids = mods2;
        }
        else {
            // Fallback: read JSON textarea or raw hint
            const bodyTa = overlay.querySelector('#plug-qt-s-json');
            const raw = bodyTa ? bodyTa.value.trim() : (rawBody || '');
            if (raw && raw !== '{}') {
                try {
                    bodyObj = JSON.parse(raw);
                }
                catch {
                    bodyObj = raw;
                }
            }
            // Resolve :param placeholders for simple cases
            const modId = overlay.querySelector('#plug-qt-s-mod')?.value;
            const profId = overlay.querySelector('#plug-qt-s-profile')?.value;
            const mpId2 = overlay.querySelector('#plug-qt-s-modpack')?.value;
            if (modId)
                resolvedCopyPath = p.replace(':id', modId);
            if (profId)
                resolvedCopyPath = p.replace(':id', profId);
            if (mpId2)
                resolvedCopyPath = p.replace(':id', mpId2);
        }
        const bodyStr = bodyObj != null
            ? (typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj, null, 2))
            : '';
        const authHeader = _apiToken ? ` \\\n  -H "Authorization: Bearer ${_apiToken}"` : '';
        const bodyFlag = (m !== 'GET' && bodyStr && bodyStr !== '{}')
            ? ` \\\n  -H "Content-Type: application/json" \\\n  -d '${bodyStr.replace(/\n/g, '').replace(/'/g, "'\\''")}'`
            : '';
        const curl = `curl -X ${m} "${apiBase()}${resolvedCopyPath}"${authHeader}${bodyFlag}`;
        try {
            await navigator.clipboard.writeText(curl);
            toast(t('plugins.curlCopied'), 'success');
        }
        catch {
            window.prompt(t('plugins.curlCopyManual'), curl);
        }
    });
    // ── Create Modpack helpers ────────────────────────────────────────────────
    if (p === '/api/modpacks/create') {
        const checkAll = (v) => overlay.querySelectorAll('.plug-qt-mod-check').forEach(c => c.checked = v);
        overlay.querySelector('#plug-qt-sel-all')?.addEventListener('click', () => checkAll(true));
        overlay.querySelector('#plug-qt-sel-none')?.addEventListener('click', () => checkAll(false));
        overlay.querySelector('#plug-qt-sel-active')?.addEventListener('click', () => {
            overlay.querySelectorAll('.plug-qt-mod-check').forEach(c => {
                const mod = _allMods.find(m => m.id === c.value);
                c.checked = !!(mod && mod.active);
            });
        });
        // Profile multi-select: checking a profile auto-adds its active mods (additive)
        overlay.querySelectorAll('.plug-qt-prof-check').forEach(cb => {
            cb.addEventListener('change', () => {
                // Collect all checked profiles
                const checkedProfIds = Array.from(overlay.querySelectorAll('.plug-qt-prof-check:checked')).map(c => c.value);
                // Build union of all active mod IDs from checked profiles
                const unionIds = new Set();
                checkedProfIds.forEach(pid => {
                    const prof = _allProfiles.find(pr => pr.id === pid);
                    (Array.isArray(prof?.active_mods) ? prof.active_mods : []).forEach(id => unionIds.add(id));
                });
                overlay.querySelectorAll('.plug-qt-mod-check').forEach(c => {
                    if (unionIds.has(c.value))
                        c.checked = true;
                    // don't uncheck — user may have manual selections too
                });
            });
        });
        // Plugin source: when selected, auto-check matching mods
        overlay.querySelector('#plug-qt-s-plugin-src')?.addEventListener('change', (ev) => {
            const val = ev.target.value;
            if (!val)
                return;
            const plId = val;
            const pl = _installedPlugins.find(p => p.manifest.id === plId);
            const reqNames = (pl?.manifest?.modlist?.required_mods || []).map((rm) => (rm.name || '').toLowerCase());
            overlay.querySelectorAll('.plug-qt-mod-check').forEach(c => {
                const mod = _allMods.find(m => m.id === c.value);
                if (mod && reqNames.includes((mod.name || '').toLowerCase()))
                    c.checked = true;
            });
        });
    }
    // ── Update Modpack helpers ─────────────────────────────────────────────────
    if (p === '/api/modpacks/:id' && m === 'PUT') {
        const checkAllUpd = (v) => overlay.querySelectorAll('.plug-qt-upd-mod-check').forEach(c => c.checked = v);
        overlay.querySelector('#plug-qt-upd-sel-all')?.addEventListener('click', () => checkAllUpd(true));
        overlay.querySelector('#plug-qt-upd-sel-none')?.addEventListener('click', () => checkAllUpd(false));
        overlay.querySelector('#plug-qt-upd-sel-active')?.addEventListener('click', () => {
            overlay.querySelectorAll('.plug-qt-upd-mod-check').forEach(c => {
                const mod = _allMods.find(m => m.id === c.value);
                c.checked = !!(mod && mod.active);
            });
        });
        // Auto-fill fields when modpack is selected from the dropdown
        const fillFromModpack = (mpId) => {
            const mp = _allModpacks.find((x) => x.id === mpId);
            if (!mp)
                return;
            const nameEl = overlay.querySelector('#plug-qt-s-name');
            const descEl = overlay.querySelector('#plug-qt-s-description');
            const gnameEl = overlay.querySelector('#plug-qt-s-game-name');
            const srEl = overlay.querySelector('#plug-qt-s-sr-link');
            const mpEl = overlay.querySelector('#plug-qt-s-multi-profile');
            const siEl = overlay.querySelector('#plug-qt-s-skip-integrity');
            const dmEl = overlay.querySelector('#plug-qt-s-dep-mode');
            if (nameEl)
                nameEl.value = mp.name || '';
            if (descEl)
                descEl.value = mp.description || '';
            if (gnameEl)
                gnameEl.value = mp.game_name || '';
            if (srEl)
                srEl.value = mp.sr_link || '';
            if (mpEl)
                mpEl.checked = !!mp.multi_profile;
            if (siEl)
                siEl.checked = !!mp.skip_integrity_check;
            if (dmEl)
                dmEl.value = mp.dependency_mode || 'none';
            // Check mods that belong to this modpack
            const modIds = (mp.mods || []).map((x) => typeof x === 'string' ? x : x.id);
            overlay.querySelectorAll('.plug-qt-upd-mod-check').forEach(c => {
                c.checked = modIds.includes(c.value);
            });
        };
        const mpSel = overlay.querySelector('#plug-qt-s-modpack');
        if (mpSel) {
            mpSel.addEventListener('change', () => fillFromModpack(mpSel.value));
            if (mpSel.value)
                fillFromModpack(mpSel.value); // pre-fill on open
        }
    }
    // ── Gen form: profile select all/none + zip/server panel toggles ─────────
    if (p === '/api/repo/gen') {
        // Profile select all / none
        overlay.querySelector('#plug-qt-gen-sel-all')?.addEventListener('click', () => overlay.querySelectorAll('.plug-qt-host-prof-check').forEach(c => c.checked = true));
        overlay.querySelector('#plug-qt-gen-sel-none')?.addEventListener('click', () => overlay.querySelectorAll('.plug-qt-host-prof-check').forEach(c => c.checked = false));
        // Show/hide server panel when zip_output is toggled
        const zipCb = overlay.querySelector('#plug-qt-s-zip-output');
        const dockerCb = overlay.querySelector('#plug-qt-s-use-docker');
        const serverPanel = overlay.querySelector('#plug-qt-gen-server-panel');
        const dockerOpts = overlay.querySelector('#plug-qt-gen-docker-opts');
        const srvTypeSel = overlay.querySelector('#plug-qt-s-server-type');
        const cfCb = overlay.querySelector('#plug-qt-s-use-cf');
        const upnpCb = overlay.querySelector('#plug-qt-s-use-upnp');
        const autoStartCb = overlay.querySelector('#plug-qt-s-auto-start');
        // Server type change: lock CF/UPnP/AutoStart for "server"
        const applyServerTypeLock = () => {
            const isServer = srvTypeSel?.value === 'server';
            if (cfCb) {
                cfCb.disabled = isServer;
                if (isServer)
                    cfCb.checked = false;
            }
            if (upnpCb) {
                upnpCb.disabled = isServer;
                if (isServer)
                    upnpCb.checked = false;
            }
            if (autoStartCb) {
                autoStartCb.disabled = isServer;
                if (isServer)
                    autoStartCb.checked = false;
            }
        };
        srvTypeSel?.addEventListener('change', applyServerTypeLock);
        applyServerTypeLock(); // apply on open
        const updateServerPanel = () => {
            if (serverPanel)
                serverPanel.style.display = zipCb?.checked ? 'flex' : 'none';
        };
        zipCb?.addEventListener('change', updateServerPanel);
        dockerCb?.addEventListener('change', () => {
            if (dockerOpts)
                dockerOpts.style.display = dockerCb.checked ? 'flex' : 'none';
        });
    }
    // ── App launch form: auto-fill exe_path from selected app ───────────────
    if (p === '/api/apps/launch') {
        const sel = overlay.querySelector('#plug-qt-launch-sel');
        const idInp = overlay.querySelector('#plug-qt-launch-id');
        const exeInp = overlay.querySelector('#plug-qt-launch-exe');
        sel?.addEventListener('change', () => {
            const opt = sel.selectedOptions[0];
            if (idInp)
                idInp.value = opt?.value || '';
            if (exeInp)
                exeInp.value = opt?.dataset.exe || '';
        });
    }
    // ── Sync form: Tout/Aucun profile selectors ─────────────────────────────
    if (p === '/api/repo/sync') {
        overlay.querySelector('#plug-qt-sync-sel-all')?.addEventListener('click', () => overlay.querySelectorAll('.plug-qt-sync-prof-check').forEach(c => c.checked = true));
        overlay.querySelector('#plug-qt-sync-sel-none')?.addEventListener('click', () => overlay.querySelectorAll('.plug-qt-sync-prof-check').forEach(c => c.checked = false));
    }
    // ── Modpack export destination browse ───────────────────────────────────
    {
        const mpBrowse = overlay.querySelector('#plug-qt-mp-browse');
        if (mpBrowse) {
            mpBrowse.addEventListener('click', async () => {
                const dir = await pickFolder().catch(() => null);
                if (dir) {
                    const inp = overlay.querySelector('#plug-qt-mp-dest');
                    if (inp)
                        inp.value = dir;
                }
            });
        }
    }
    // ── Import path browse button ───────────────────────────────────────────
    {
        const browseBtn = overlay.querySelector('#plug-qt-import-browse');
        if (browseBtn) {
            browseBtn.addEventListener('click', async () => {
                const ext = p === '/api/language/import' ? ['json'] : ['bmp', 'json'];
                const name = p === '/api/language/import' ? 'Language JSON' : 'Better ModPack';
                const picked = await pickFile([{ name, extensions: ext }]).catch(() => null);
                if (picked) {
                    const inp = overlay.querySelector('#plug-qt-import-path');
                    if (inp)
                        inp.value = picked;
                }
            });
        }
    }
    // ── Permissions form: all/none buttons + plugin dropdown auto-fill ──────
    if (p === '/api/apps/permissions/:id' && m === 'PUT') {
        overlay.querySelector('#plug-qt-perm-all')?.addEventListener('click', () => overlay.querySelectorAll('.plug-qt-perm-check').forEach(c => c.checked = true));
        overlay.querySelector('#plug-qt-perm-none')?.addEventListener('click', () => overlay.querySelectorAll('.plug-qt-perm-check').forEach(c => c.checked = false));
        overlay.querySelector('#plug-qt-perm-sel')?.addEventListener('change', async (ev) => {
            const pid = ev.target.value;
            const idEl = overlay.querySelector('#plug-qt-perm-id');
            if (pid && idEl) {
                idEl.value = pid;
                // Pre-check existing permissions for this plugin
                try {
                    const existing = await invoke('get_plugin_permissions', { pluginId: pid }).catch(() => []);
                    overlay.querySelectorAll('.plug-qt-perm-check').forEach(c => {
                        c.checked = existing.includes(c.value);
                    });
                }
                catch { }
            }
        });
        // ── Per-plugin API token (CWE-862/863): issue / copy / revoke ──────────
        const tokGetPid = () => overlay.querySelector('#plug-qt-perm-id')?.value?.trim()
            || overlay.querySelector('#plug-qt-perm-sel')?.value || '';
        const tokOut = () => overlay.querySelector('#plug-qt-token-out');
        overlay.querySelector('#plug-qt-token-gen')?.addEventListener('click', async () => {
            const pid = tokGetPid();
            if (!pid) {
                toast(t('plugins.qtPermNoId') || 'Enter a plugin_id first', 'warning');
                return;
            }
            try {
                const tok = await invoke('create_plugin_token', { pluginId: pid });
                const o = tokOut();
                if (o)
                    o.value = tok;
                toast(t('plugins.qtTokenIssued') || 'Plugin token issued', 'success');
            }
            catch (e) {
                toast(String(e), 'error');
            }
        });
        overlay.querySelector('#plug-qt-token-copy')?.addEventListener('click', async () => {
            const v = tokOut()?.value;
            if (v) {
                try {
                    await navigator.clipboard.writeText(v);
                    toast(t('plugins.qtTokenCopied') || 'Copied', 'success');
                }
                catch { }
            }
        });
        overlay.querySelector('#plug-qt-token-revoke')?.addEventListener('click', async () => {
            const pid = tokGetPid();
            if (!pid)
                return;
            try {
                const removed = await invoke('revoke_plugin_token', { pluginId: pid });
                const o = tokOut();
                if (o)
                    o.value = '';
                toast(removed ? (t('plugins.qtTokenRevoked') || 'Token revoked') : (t('plugins.qtTokenNoneToRevoke') || 'No token for this plugin'), removed ? 'success' : 'info');
            }
            catch (e) {
                toast(String(e), 'error');
            }
        });
    }
    // ── Catalog update app: live JSON preview + dropdown auto-fill ──────────
    if (p === '/api/catalog/apps/:id' && m === 'PUT') {
        const updPreview = () => {
            const get = (id) => overlay.querySelector(`#plug-qt-catupd-${id}`)?.value?.trim() || '';
            const sel = (id) => overlay.querySelector(`#plug-qt-catupd-${id}`)?.value || '';
            const fields = {};
            if (get('title'))
                fields.title = get('title');
            if (get('desc'))
                fields.description = overlay.querySelector('#plug-qt-catupd-desc')?.value?.trim() || '';
            if (sel('cat'))
                fields.category = sel('cat');
            if (sel('price'))
                fields.price = sel('price');
            if (sel('ftype'))
                fields.download = { file_type: sel('ftype'), ...(get('url') ? { url: get('url') } : {}) };
            else if (get('url'))
                fields.download = { url: get('url') };
            if (get('ver'))
                fields.version = get('ver');
            if (get('tags'))
                fields.tags = get('tags').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3);
            if (get('thumb'))
                fields.images = { thumb: get('thumb') };
            if (get('reqs'))
                fields.requirements = get('reqs');
            if (get('md'))
                fields.md_link = get('md');
            const preview = overlay.querySelector('#plug-qt-catupd-preview');
            if (preview)
                preview.textContent = Object.keys(fields).length
                    ? JSON.stringify(fields, null, 2)
                    : '// All fields blank — nothing will be changed.';
        };
        ['catupd-id', 'catupd-title', 'catupd-ver', 'catupd-tags', 'catupd-url', 'catupd-thumb', 'catupd-reqs', 'catupd-md'].forEach(id => {
            overlay.querySelector(`#plug-qt-${id}`)?.addEventListener('input', updPreview);
        });
        overlay.querySelectorAll('#plug-qt-catupd-cat,#plug-qt-catupd-price,#plug-qt-catupd-ftype').forEach(s => s.addEventListener('change', updPreview));
        overlay.querySelector('#plug-qt-catupd-desc')?.addEventListener('input', updPreview);
        // Auto-fill id from dropdown
        overlay.querySelector('#plug-qt-catupd-sel')?.addEventListener('change', (ev) => {
            const val = ev.target.value;
            const idEl = overlay.querySelector('#plug-qt-catupd-id');
            if (val && idEl) {
                idEl.value = val;
                updPreview();
            }
        });
        updPreview();
    }
    // ── Catalog new: live JSON preview ──────────────────────────────────────
    if (p === '/api/catalog/new') {
        const updatePreview = () => {
            const n = overlay.querySelector('#plug-qt-cat-name')?.value || 'My Catalog';
            const d = overlay.querySelector('#plug-qt-cat-desc')?.value || '';
            const preview = overlay.querySelector('#plug-qt-cat-preview');
            if (preview)
                preview.textContent = JSON.stringify({
                    version: '1.0', name: n, description: d,
                    partner_catalogs: [], community_imports: [], apps: []
                }, null, 2);
        };
        overlay.querySelector('#plug-qt-cat-name')?.addEventListener('input', updatePreview);
        overlay.querySelector('#plug-qt-cat-desc')?.addEventListener('input', updatePreview);
        updatePreview();
    }
    // ── Catalog add app: live JSON preview ──────────────────────────────────
    if (p === '/api/catalog/apps' && m === 'POST') {
        const updateCatAppPreview = () => {
            const get = (id) => overlay.querySelector(`#plug-qt-catapp-${id}`)?.value?.trim() || '';
            const preview = overlay.querySelector('#plug-qt-catapp-preview');
            if (!preview)
                return;
            const entry = {
                id: get('id') || 'my-app',
                title: get('title') || 'My App',
                description: overlay.querySelector('#plug-qt-catapp-desc')?.value?.trim() || '',
                category: overlay.querySelector('#plug-qt-catapp-cat')?.value || 'utility',
                price: overlay.querySelector('#plug-qt-catapp-price')?.value || 'free',
                tags: get('tags').split(',').map(s => s.trim()).filter(Boolean).slice(0, 3),
                download: { url: get('url') || '…', file_type: overlay.querySelector('#plug-qt-catapp-ftype')?.value || 'exe' },
            };
            if (get('version'))
                entry.version = get('version');
            if (get('reqs'))
                entry.requirements = get('reqs');
            if (get('md'))
                entry.md_link = get('md');
            if (get('thumb'))
                entry.images = { thumb: get('thumb') };
            preview.textContent = JSON.stringify(entry, null, 2);
        };
        ['catapp-id', 'catapp-title', 'catapp-tags', 'catapp-url', 'catapp-version', 'catapp-reqs', 'catapp-md', 'catapp-thumb'].forEach(id => {
            overlay.querySelector(`#plug-qt-${id}`)?.addEventListener('input', updateCatAppPreview);
        });
        overlay.querySelectorAll('#plug-qt-catapp-cat,#plug-qt-catapp-price,#plug-qt-catapp-ftype').forEach(s => s.addEventListener('change', updateCatAppPreview));
        overlay.querySelector('#plug-qt-catapp-desc')?.addEventListener('input', updateCatAppPreview);
        updateCatAppPreview();
    }
    // ── Sync form: auto-fetch repo profiles when URL is entered ─────────────
    if (p === '/api/repo/sync') {
        const urlInput = overlay.querySelector('#plug-qt-s-repo-url');
        const profilesPanel = overlay.querySelector('#plug-qt-s-repo-profiles-panel');
        const profilesList = overlay.querySelector('#plug-qt-s-repo-profiles-list');
        let _syncFetchTimer = null;
        const doFetchRepoProfiles = async (repoUrl) => {
            if (!profilesPanel || !profilesList)
                return;
            profilesList.innerHTML = `<p style="font-size:12px;color:var(--text-muted);padding:4px 0;">${IC.refresh} Chargement…</p>`;
            profilesPanel.style.display = 'flex';
            try {
                const res = await fetch(`${apiBase()}/api/repo/info?url=${encodeURIComponent(repoUrl)}`);
                const json = await res.json().catch(() => ({}));
                const profiles = json.profiles || json.data?.profiles || [];
                if (profiles.length === 0) {
                    profilesList.innerHTML = `<p style="font-size:12px;color:var(--text-muted);padding:4px 0;">${escHtml(t('plugins.qt.noProfileInRepo'))}</p>`;
                }
                else {
                    profilesList.innerHTML = profiles.map((pr) => `
                        <label style="display:flex;align-items:center;gap:8px;padding:3px 6px;border-radius:5px;cursor:pointer;font-size:12px;" data-hover="background:rgba(255,255,255,0.05)" data-hover-out="background:transparent">
                            <input type="checkbox" class="plug-qt-sync-prof-check" value="${escHtml(pr.id || pr.name)}" style="accent-color:var(--accent);width:13px;height:13px;">
                            <span style="flex:1;">${escHtml(pr.name || pr.id)}</span>
                            <span style="font-size:10px;color:var(--text-muted);">${pr.mods?.length ?? pr.mod_count ?? ''} mods</span>
                        </label>`).join('');
                }
            }
            catch {
                profilesList.innerHTML = `<p style="font-size:12px;color:var(--danger);padding:4px 0;">Erreur fetch repo — vérifiez l'URL.</p>`;
            }
        };
        if (urlInput) {
            urlInput.addEventListener('input', () => {
                if (_syncFetchTimer)
                    clearTimeout(_syncFetchTimer);
                const url = urlInput.value.trim();
                if (!url) {
                    if (profilesPanel)
                        profilesPanel.style.display = 'none';
                    return;
                }
                _syncFetchTimer = setTimeout(() => doFetchRepoProfiles(url), 600);
            });
            // If URL is pre-filled (e.g. from prefillTester), fetch immediately
            if (urlInput.value.trim())
                doFetchRepoProfiles(urlInput.value.trim());
        }
    }
    overlay.querySelector('#plug-qt-s-run')?.addEventListener('click', () => {
        let body = '{}';
        let resolvedPath = p;
        if (p === '/api/mods/enable' || p === '/api/mods/disable') {
            body = JSON.stringify({ mod_id: overlay.querySelector('#plug-qt-s-mod')?.value || '' });
        }
        else if (p === '/api/mods/:id') {
            const modId = overlay.querySelector('#plug-qt-s-mod')?.value || '';
            resolvedPath = `/api/mods/${modId}`;
            if (m === 'PUT') {
                const obj = {};
                const name = overlay.querySelector('#plug-qt-s-name')?.value?.trim();
                const ver = overlay.querySelector('#plug-qt-s-version')?.value?.trim();
                const auth = overlay.querySelector('#plug-qt-s-author')?.value?.trim();
                const desc = overlay.querySelector('#plug-qt-s-description')?.value?.trim();
                if (name)
                    obj.name = name;
                if (ver)
                    obj.version = ver;
                if (auth)
                    obj.author = auth;
                if (desc)
                    obj.description = desc;
                body = Object.keys(obj).length ? JSON.stringify(obj) : '{}';
            }
        }
        else if (p === '/api/profiles/activate') {
            body = JSON.stringify({ profile_id: overlay.querySelector('#plug-qt-s-profile')?.value || '' });
        }
        else if (p === '/api/modpacks/enable' || p === '/api/modpacks/disable') {
            body = JSON.stringify({ modpack_id: overlay.querySelector('#plug-qt-s-modpack')?.value || '' });
        }
        else if (p === '/api/profiles/:id') {
            const profId = overlay.querySelector('#plug-qt-s-profile')?.value || '';
            resolvedPath = `/api/profiles/${profId}`;
            if (m === 'PUT') {
                const obj = {};
                const name = overlay.querySelector('#plug-qt-s-name')?.value?.trim();
                const color = overlay.querySelector('#plug-qt-s-color')?.value?.trim();
                const icon = overlay.querySelector('#plug-qt-s-icon')?.value?.trim();
                const gamePath = overlay.querySelector('#plug-qt-s-game-path')?.value?.trim();
                const modsPath = overlay.querySelector('#plug-qt-s-mods-path')?.value?.trim();
                const backupPath = overlay.querySelector('#plug-qt-s-backup-path')?.value?.trim();
                if (name)
                    obj.name = name;
                if (color)
                    obj.color = color;
                if (icon)
                    obj.icon = icon;
                if (gamePath)
                    obj.game_path = gamePath;
                if (modsPath)
                    obj.mods_path = modsPath;
                if (backupPath)
                    obj.backup_path = backupPath;
                body = JSON.stringify(obj);
            }
        }
        else if (p === '/api/modpacks/:id' && m === 'PUT') {
            const mpId = overlay.querySelector('#plug-qt-s-modpack')?.value || '';
            if (!mpId) {
                toast(t('plugins.selectModpack') || 'Select a modpack', 'warning');
                return;
            }
            const updName = overlay.querySelector('#plug-qt-s-name')?.value?.trim();
            const updDesc = overlay.querySelector('#plug-qt-s-description')?.value?.trim();
            const updGname = overlay.querySelector('#plug-qt-s-game-name')?.value?.trim();
            const updSrLink = overlay.querySelector('#plug-qt-s-sr-link')?.value?.trim();
            const updDepMode = overlay.querySelector('#plug-qt-s-dep-mode')?.value;
            const updMultiPr = overlay.querySelector('#plug-qt-s-multi-profile')?.checked;
            const updSkipInt = overlay.querySelector('#plug-qt-s-skip-integrity')?.checked;
            const updMods = Array.from(overlay.querySelectorAll('.plug-qt-upd-mod-check:checked')).map(c => c.value).filter(Boolean);
            const updPrefill = { multi_profile: !!updMultiPr, skip_integrity_check: !!updSkipInt };
            if (updName)
                updPrefill.name = updName;
            if (updDesc)
                updPrefill.description = updDesc;
            if (updGname)
                updPrefill.game_name = updGname;
            if (updSrLink)
                updPrefill.sr_link = updSrLink;
            if (updDepMode)
                updPrefill.dependency_mode = updDepMode;
            if (updMods.length)
                updPrefill.mod_ids = updMods;
            overlay.remove();
            // Navigate to Modpacks page and open native Update editor
            const modpackNavBtn2 = document.querySelector('.nav-item[data-view="modpacks"]');
            if (modpackNavBtn2)
                modpackNavBtn2.click();
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent('bmm:modpack-focus', {
                    detail: { action: 'update', modpackId: mpId, prefill: updPrefill },
                }));
            }, 350);
            return;
        }
        else if (p === '/api/modpacks/:id' && m === 'DELETE') {
            const mpId = overlay.querySelector('#plug-qt-s-modpack')?.value || '';
            if (!mpId) {
                toast(t('plugins.selectModpack') || 'Select a modpack', 'warning');
                return;
            }
            resolvedPath = `/api/modpacks/${mpId}`;
            body = '';
        }
        else if (p === '/api/profiles') {
            body = JSON.stringify({
                name: overlay.querySelector('#plug-qt-s-name')?.value || '',
                game_path: overlay.querySelector('#plug-qt-s-game-path')?.value || '',
                mods_path: overlay.querySelector('#plug-qt-s-mods-path')?.value || '',
                backup_path: overlay.querySelector('#plug-qt-s-backup-path')?.value || '',
                game_name: '',
            });
        }
        else if (p === '/api/plugins/compare') {
            const plugId = overlay.querySelector('#plug-qt-s-plugin')?.value || '';
            if (!plugId) {
                toast(t('plugins.qtPluginRequired') || 'Select a plugin', 'warning');
                return;
            }
            body = JSON.stringify({ plugin_id: plugId });
        }
        else if (p === '/api/plugins/apply') {
            const plugId = overlay.querySelector('#plug-qt-s-plugin')?.value || '';
            if (!plugId) {
                toast(t('plugins.qtPluginRequired') || 'Select a plugin', 'warning');
                return;
            }
            body = JSON.stringify({ plugin_id: plugId, force_strict: overlay.querySelector('#plug-qt-s-strict')?.checked || false });
        }
        else if (p === '/api/plugins/export') {
            const plugId = overlay.querySelector('#plug-qt-s-plugin')?.value || '';
            if (!plugId) {
                toast(t('plugins.qtPluginRequired') || 'Select a plugin', 'warning');
                return;
            }
            overlay.remove();
            handleQuickTest('POST', '/api/plugins/export', JSON.stringify({ id: plugId }));
            return;
        }
        else if (p === '/api/modpacks/export') {
            const mpId = overlay.querySelector('#plug-qt-s-modpack')?.value || '';
            if (!mpId) {
                toast(t('plugins.qtModpackRequired') || 'Select a modpack', 'warning');
                return;
            }
            const destDir = overlay.querySelector('#plug-qt-mp-dest')?.value?.trim();
            overlay.remove();
            handleQuickTest('POST', '/api/modpacks/export', JSON.stringify(destDir ? { id: mpId, destDir } : { id: mpId }));
            return;
        }
        else if (p === '/api/restart') {
            body = '{}';
        }
        else if (p === '/api/modpacks/create') {
            const name = overlay.querySelector('#plug-qt-s-name')?.value?.trim() || '';
            if (!name) {
                toast(t('plugins.modpackNameRequired') || 'The modpack name is required', 'warning');
                return;
            }
            const desc = overlay.querySelector('#plug-qt-s-desc')?.value?.trim();
            const game = overlay.querySelector('#plug-qt-s-game')?.value?.trim();
            const srLink = overlay.querySelector('#plug-qt-s-sr-link')?.value?.trim();
            const multiPr = overlay.querySelector('#plug-qt-s-multi-profile')?.checked || false;
            const skipInt = overlay.querySelector('#plug-qt-s-skip-integrity')?.checked || false;
            const depMode = overlay.querySelector('#plug-qt-s-dep-mode')?.value || 'none';
            const modIds = Array.from(overlay.querySelectorAll('.plug-qt-mod-check:checked')).map(c => c.value).filter(Boolean);
            const createPrefill = { name, multi_profile: multiPr, skip_integrity_check: skipInt, dependency_mode: depMode };
            if (desc)
                createPrefill.description = desc;
            if (game)
                createPrefill.game_name = game;
            if (srLink)
                createPrefill.sr_link = srLink;
            if (modIds.length)
                createPrefill.mod_ids = modIds;
            overlay.remove();
            // Navigate to Modpacks page and open native Create editor
            const modpackNavBtn = document.querySelector('.nav-item[data-view="modpacks"]');
            if (modpackNavBtn)
                modpackNavBtn.click();
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent('bmm:modpack-focus', {
                    detail: { action: 'create', prefill: createPrefill },
                }));
            }, 350);
            return;
        }
        else if (p === '/api/modpacks') {
            body = '';
            // ── Repo API ──────────────────────────────────────────────────────────
        }
        else if (p === '/api/repo/manifest') {
            const md = overlay.querySelector('#plug-qt-s-manifest-dir')?.value?.trim() || '';
            if (!md)
                return;
            overlay.remove();
            handleQuickTest('POST', '/api/repo/manifest', JSON.stringify({ modsDir: md }, null, 2));
        }
        else if (p === '/api/repo/info') {
            const repoUrl = overlay.querySelector('#plug-qt-s-repo-url')?.value?.trim() || '';
            if (!repoUrl)
                return;
            overlay.remove();
            handleQuickTest('GET', `/api/repo/info?url=${encodeURIComponent(repoUrl)}`, '');
            return;
        }
        else if (p === '/api/repo/list') {
            body = '';
        }
        else if (p === '/api/repo/connect') {
            const repoUrl = overlay.querySelector('#plug-qt-s-repo-url')?.value?.trim() || '';
            if (!repoUrl) {
                toast(t('plugins.enterRepoUrl') || 'Enter a repo.json URL', 'warning');
                return;
            }
            overlay.remove();
            // Navigate to repo page and auto-fetch the repo (connect = fetch in the page)
            const repoNavBtnC = document.querySelector('.nav-item[data-view="repo"], .nav-btn[data-view="repo"]');
            if (repoNavBtnC)
                repoNavBtnC.click();
            setTimeout(() => {
                document.dispatchEvent(new CustomEvent('bmm:repo-focus', {
                    detail: { section: 'connect', prefill: { url: repoUrl } },
                }));
            }, 350);
            return;
        }
        else if (p === '/api/repo' && m === 'DELETE') {
            overlay.remove();
            // Navigate to repo page and clear the fetched repo (disconnect in the UI)
            const repoNavBtnD = document.querySelector('.nav-item[data-view="repo"], .nav-btn[data-view="repo"]');
            if (repoNavBtnD)
                repoNavBtnD.click();
            setTimeout(() => {
                document.dispatchEvent(new CustomEvent('bmm:repo-focus', {
                    detail: { section: 'disconnect' },
                }));
            }, 350);
            return;
        }
        else if (p === '/api/repo/sync') {
            const repoUrl = overlay.querySelector('#plug-qt-s-repo-url')?.value?.trim() || '';
            const localProf = overlay.querySelector('#plug-qt-s-local-prof')?.value?.trim() || '';
            const gameDir = overlay.querySelector('#plug-qt-s-game-dir')?.value?.trim() || '';
            const modsDir = overlay.querySelector('#plug-qt-s-mods-dir')?.value?.trim() || '';
            const backupDir = overlay.querySelector('#plug-qt-s-backup-dir')?.value?.trim() || '';
            const syncMode = overlay.querySelector('#plug-qt-s-sync-mode')?.value || 'smart';
            const dlLimitStr = overlay.querySelector('#plug-qt-s-dl-limit')?.value?.trim() || '0';
            const deleteEx = overlay.querySelector('#plug-qt-s-delete-extra')?.checked || false;
            // Collect selected repo profiles (from auto-fetch panel checkboxes)
            const checkedRepoProfIds = Array.from(overlay.querySelectorAll('.plug-qt-sync-prof-check:checked')).map(c => c.value).filter(Boolean);
            if (!repoUrl || !gameDir || !modsDir || !backupDir) {
                toast(t('plugins.qtFieldsRequired', { fields: 'url, game_dir, mods_dir, backup_dir' }), 'warning');
                return;
            }
            // Build choices — only include if profiles were explicitly selected
            // Empty choices = let the user pick in the repo page UI (no auto-sync)
            const choices = checkedRepoProfIds.map(pid => {
                const c = { repoProfileId: pid };
                if (localProf)
                    c.targetLocalProfileId = localProf;
                return c;
            });
            const syncPayload = {
                url: repoUrl,
                gameDir,
                modsDir,
                backupDir,
                overwriteAll: syncMode === 'all',
                deleteExtra: deleteEx,
                downloadLimit: parseInt(dlLimitStr, 10) || 0,
            };
            // Only include choices if profiles were selected (otherwise repo page handles it)
            if (choices.length > 0)
                syncPayload.choices = choices;
            else if (localProf)
                syncPayload.choices = [{ targetLocalProfileId: localProf }];
            overlay.remove();
            // Navigate to Server Repo page and pre-fill sync fields
            const repoNavBtn = document.querySelector('.nav-item[data-view="repo"], .nav-btn[data-view="repo"]');
            if (repoNavBtn)
                repoNavBtn.click();
            setTimeout(() => {
                document.dispatchEvent(new CustomEvent('bmm:repo-focus', {
                    detail: { section: 'sync', prefill: syncPayload },
                }));
            }, 350);
            return;
        }
        else if (p === '/api/repo/gen') {
            const profIds = Array.from(overlay.querySelectorAll('.plug-qt-host-prof-check:checked')).map(c => c.value).filter(Boolean);
            const outputDir = overlay.querySelector('#plug-qt-s-output-dir')?.value?.trim() || '';
            const author = overlay.querySelector('#plug-qt-s-author-name')?.value?.trim() || '';
            const seed = overlay.querySelector('#plug-qt-s-seed')?.value?.trim();
            const zipOutput = overlay.querySelector('#plug-qt-s-zip-output')?.checked || false;
            const srvType = overlay.querySelector('#plug-qt-s-server-type')?.value || 'user';
            const isServerT = srvType === 'server';
            const useCf = isServerT ? false : (overlay.querySelector('#plug-qt-s-use-cf')?.checked || false);
            const useUpnp = isServerT ? false : (overlay.querySelector('#plug-qt-s-use-upnp')?.checked || false);
            const autoStart = isServerT ? false : (overlay.querySelector('#plug-qt-s-auto-start')?.checked || false);
            const useDocker = overlay.querySelector('#plug-qt-s-use-docker')?.checked || false;
            const dockerOs = overlay.querySelector('#plug-qt-s-docker-os')?.value || 'linux';
            const srvVersion = overlay.querySelector('#plug-qt-s-server-version')?.value || 'std';
            const portStr = overlay.querySelector('#plug-qt-s-port')?.value?.trim();
            const ulStr = overlay.querySelector('#plug-qt-s-upload-limit')?.value?.trim();
            const adminPw = overlay.querySelector('#plug-qt-s-admin-pw')?.value?.trim();
            if (!profIds.length || !outputDir || !author) {
                toast(t('plugins.genFieldsRequired') || 'Profile(s), output_dir and author_name are required', 'warning');
                return;
            }
            const genPl = {
                profileIds: profIds,
                outputDir,
                authorName: author,
                generateServer: zipOutput,
                zipOutput,
                serverType: srvType,
                useCloudflare: useCf,
                useUpnp,
                autoStart,
            };
            if (seed)
                genPl.seed = seed;
            if (portStr)
                genPl.port = parseInt(portStr, 10) || 8080;
            if (ulStr)
                genPl.uploadLimit = parseInt(ulStr, 10) || 0;
            if (adminPw)
                genPl.adminPassword = adminPw;
            if (useDocker) {
                genPl.useDocker = true;
                genPl.dockerOs = dockerOs;
                genPl.serverVersion = srvVersion;
            }
            overlay.remove();
            // Navigate to Server Repo page and pre-fill gen/export fields
            const repoNavBtn2 = document.querySelector('.nav-item[data-view="repo"], .nav-btn[data-view="repo"]');
            if (repoNavBtn2)
                repoNavBtn2.click();
            setTimeout(() => {
                document.dispatchEvent(new CustomEvent('bmm:repo-focus', {
                    detail: { section: 'gen', prefill: genPl },
                }));
            }, 350);
            return;
        }
        else if (p === '/api/repo/update') {
            const repoDir = overlay.querySelector('#plug-qt-s-repo-dir')?.value?.trim() || '';
            if (!repoDir) {
                toast(t('plugins.qtFieldsRequired', { fields: 'repo_dir' }), 'warning');
                return;
            }
            overlay.remove();
            // Drive the BMM UI — navigate to repo page and open the update modal
            // pre-filled with the chosen repo directory. The user sees the full UI.
            const repoNavBtn = document.querySelector('.nav-item[data-view="repo"], .nav-btn[data-view="repo"]');
            if (repoNavBtn)
                repoNavBtn.click();
            setTimeout(() => {
                document.dispatchEvent(new CustomEvent('bmm:repo-focus', {
                    detail: { section: 'update', prefill: { repoDir } },
                }));
            }, 400);
            return;
        }
        else if (p === '/api/catalog/new') {
            const name = overlay.querySelector('#plug-qt-cat-name')?.value?.trim() || 'My Catalog';
            const desc = overlay.querySelector('#plug-qt-cat-desc')?.value?.trim() || '';
            overlay.remove();
            handleQuickTest('POST', '/api/catalog/new', JSON.stringify({ name, description: desc, partner_catalogs: [], community_imports: [], apps: [] }, null, 2));
            return;
        }
        else if (p === '/api/catalog/apps' && m === 'POST') {
            const get = (id) => overlay.querySelector(`#plug-qt-catapp-${id}`)?.value?.trim() || '';
            const getChk = (id) => overlay.querySelector(`#plug-qt-catapp-${id}`)?.checked || false;
            const id = get('id');
            const url = get('url');
            if (!id || !url) {
                toast(t('plugins.qtCatAppIdRequired') || 'id and download.url are required', 'warning');
                return;
            }
            const tags = get('tags').split(',').map(s => s.trim()).filter(Boolean).slice(0, 3);
            const extra = get('extra').split(',').map(s => s.trim()).filter(Boolean);
            const appEntry = {
                id, title: get('title') || id,
                description: overlay.querySelector('#plug-qt-catapp-desc')?.value?.trim() || '',
                category: overlay.querySelector('#plug-qt-catapp-cat')?.value || 'utility',
                price: overlay.querySelector('#plug-qt-catapp-price')?.value || 'free',
                tags,
                download: {
                    url, file_type: overlay.querySelector('#plug-qt-catapp-ftype')?.value || 'exe',
                    ...(parseInt(get('size')) ? { size: parseInt(get('size')) } : {}),
                },
            };
            if (get('version'))
                appEntry.version = get('version');
            if (get('reqs'))
                appEntry.requirements = get('reqs');
            if (get('md'))
                appEntry.md_link = get('md');
            if (get('thumb') || extra.length)
                appEntry.images = { thumb: get('thumb') || undefined, extra: extra.length ? extra : undefined };
            if (getChk('official'))
                appEntry.official = true;
            if (getChk('partner'))
                appEntry.partner = true;
            overlay.remove();
            handleQuickTest('POST', '/api/catalog/apps', JSON.stringify(appEntry, null, 2));
            return;
        }
        else if (p === '/api/apps/install') {
            const appId = overlay.querySelector('#plug-qt-app-id')?.value?.trim() || '';
            const appTitle = overlay.querySelector('#plug-qt-app-title')?.value?.trim() || appId;
            const dlUrl = overlay.querySelector('#plug-qt-app-url')?.value?.trim() || '';
            const ftype = overlay.querySelector('#plug-qt-app-ftype')?.value || 'exe';
            const iPath = overlay.querySelector('#plug-qt-app-path')?.value?.trim() || '';
            if (!appId || !dlUrl) {
                toast(t('plugins.qtFieldsRequired', { fields: 'app_id, download_url' }), 'warning');
                return;
            }
            const installBody = JSON.stringify({ appId, appTitle, downloadUrl: dlUrl, fileType: ftype, installPath: iPath }, null, 2);
            overlay.remove();
            handleQuickTest('POST', '/api/apps/install', installBody);
            return;
        }
        else if (p === '/api/apps/launch') {
            const sel = overlay.querySelector('#plug-qt-launch-sel');
            const appId = overlay.querySelector('#plug-qt-launch-id')?.value?.trim() || sel?.value || '';
            const exePath = overlay.querySelector('#plug-qt-launch-exe')?.value?.trim() || '';
            if (!appId) {
                toast(t('plugins.qtFieldsRequired', { fields: 'app_id' }), 'warning');
                return;
            }
            overlay.remove();
            handleQuickTest('POST', '/api/apps/launch', JSON.stringify({ appId, exePath }, null, 2));
            return;
        }
        else if (p === '/api/apps/permissions/:id' && m === 'PUT') {
            const pluginId = overlay.querySelector('#plug-qt-perm-id')?.value?.trim()
                || overlay.querySelector('#plug-qt-perm-sel')?.value || '';
            const perms = Array.from(overlay.querySelectorAll('.plug-qt-perm-check'))
                .filter(cb => cb.checked)
                .map(cb => cb.value);
            if (!pluginId) {
                toast(t('plugins.qtPermIdRequired') || 'plugin_id is required', 'warning');
                return;
            }
            overlay.remove();
            handleQuickTest('PUT', `/api/apps/permissions/${encodeURIComponent(pluginId)}`, JSON.stringify({ permissions: perms }, null, 2));
            return;
        }
        else if (p === '/api/apps/:id' && m === 'DELETE') {
            const sel2 = overlay.querySelector('#plug-qt-del-app-sel');
            const appId = overlay.querySelector('#plug-qt-del-app-id')?.value?.trim() || sel2?.value || '';
            if (!appId) {
                toast(t('plugins.qtAppIdRequired') || 'app_id is required', 'warning');
                return;
            }
            overlay.remove();
            handleQuickTest('DELETE', `/api/apps/${encodeURIComponent(appId)}`, '');
            return;
        }
        else if (p === '/api/catalog/apps/:id' && m === 'PUT') {
            const appId = overlay.querySelector('#plug-qt-catupd-id')?.value?.trim() || '';
            // Pick appId from text field or dropdown
            const selId = overlay.querySelector('#plug-qt-catupd-sel')?.value;
            const finalAppId = appId || selId || '';
            if (!finalAppId) {
                toast(t('plugins.qtCatAppIdRequired') || 'App id is required', 'warning');
                return;
            }
            const get = (id) => overlay.querySelector(`#plug-qt-catupd-${id}`)?.value?.trim() || '';
            const sel = (id) => overlay.querySelector(`#plug-qt-catupd-${id}`)?.value || '';
            const fields = {};
            if (get('title'))
                fields.title = get('title');
            const descVal = overlay.querySelector('#plug-qt-catupd-desc')?.value?.trim();
            if (descVal)
                fields.description = descVal;
            if (sel('cat'))
                fields.category = sel('cat');
            if (sel('price'))
                fields.price = sel('price');
            if (sel('ftype') || get('url'))
                fields.download = { ...(get('url') ? { url: get('url') } : {}), ...(sel('ftype') ? { file_type: sel('ftype') } : {}) };
            if (get('ver'))
                fields.version = get('ver');
            if (get('tags'))
                fields.tags = get('tags').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3);
            if (get('thumb'))
                fields.images = { thumb: get('thumb') };
            if (get('reqs'))
                fields.requirements = get('reqs');
            if (get('md'))
                fields.md_link = get('md');
            overlay.remove();
            handleQuickTest('PUT', `/api/catalog/apps/${encodeURIComponent(finalAppId)}`, JSON.stringify(fields, null, 2));
            return;
        }
        else if (p === '/api/catalog/apps/:id' && m === 'DELETE') {
            const appId = overlay.querySelector('#plug-qt-catdel-id')?.value?.trim() || '';
            if (!appId) {
                toast(t('plugins.qtCatAppIdRequired') || 'App id is required', 'warning');
                return;
            }
            overlay.remove();
            handleQuickTest('DELETE', `/api/catalog/apps/${encodeURIComponent(appId)}`, '');
            return;
        }
        else if (p === '/api/repo/host') {
            const serveDir = overlay.querySelector('#plug-qt-s-serve-dir')?.value?.trim() || '';
            const portStr = overlay.querySelector('#plug-qt-s-http-port')?.value?.trim();
            const ulStr = overlay.querySelector('#plug-qt-s-http-upload-limit')?.value?.trim();
            if (!serveDir) {
                toast(t('plugins.qtFieldsRequired', { fields: 'serve_dir' }), 'warning');
                return;
            }
            const hostPl = { serveDir };
            if (portStr)
                hostPl.port = parseInt(portStr, 10) || 8080;
            if (ulStr)
                hostPl.uploadLimit = parseInt(ulStr, 10) || 0;
            overlay.remove();
            // Navigate to repo page and start the server via native UI
            const repoNavBtnH = document.querySelector('.nav-item[data-view="repo"], .nav-btn[data-view="repo"]');
            if (repoNavBtnH)
                repoNavBtnH.click();
            setTimeout(() => {
                document.dispatchEvent(new CustomEvent('bmm:repo-focus', {
                    detail: { section: 'host', prefill: hostPl },
                }));
            }, 350);
            return;
        }
        else if ([
            '/api/language/import',
            '/api/plugins/import',
            '/api/modpacks/import',
            '/api/modlists/import',
            '/api/data/import',
            '/api/profiles/import/ovgme',
            '/api/profiles/import/omm',
            '/api/data/export',
            '/api/modlists/export',
        ].includes(p)) {
            // UI-driven. For path-capable imports, pass the typed/browsed path so
            // the backend skips the dialog and imports the file directly.
            const importPath = overlay.querySelector('#plug-qt-import-path')?.value?.trim();
            overlay.remove();
            handleQuickTest(m, resolvedPath, importPath ? JSON.stringify({ path: importPath }) : '');
            return;
        }
        else {
            body = overlay.querySelector('#plug-qt-s-json')?.value || rawBody;
        }
        overlay.remove();
        handleQuickTest(m, resolvedPath, body);
    });
}
function buildCompareContent(result, pluginName, mode = 'apply') {
    const name = pluginName ?? result.plugin_name ?? '';
    const required = result.required || [];
    const nActive = required.filter(e => e.found && e.active).length;
    const nInactive = required.filter(e => e.found && !e.active && !e.optional).length;
    const nMissing = required.filter(e => !e.found && !e.optional).length;
    const nExtra = (result.strict_extra || []).length;
    const rows = required.map((entry) => {
        let icon = IC.check, cls = 'plug-cmp-ok', st = t('plugins.cmpActive');
        if (!entry.found && !entry.optional) {
            icon = IC.x;
            cls = 'plug-cmp-missing';
            st = t('plugins.cmpMissing');
        }
        else if (!entry.found && entry.optional) {
            icon = IC.check;
            cls = 'plug-cmp-optional';
            st = t('plugins.optional');
        }
        else if (entry.found && !entry.active) {
            icon = IC.zap;
            cls = 'plug-cmp-inactive';
            st = t('plugins.cmpInactive');
        }
        return `
            <div class="plug-cmp-row ${cls}">
                <span class="plug-cmp-icon">${icon}</span>
                <span class="plug-cmp-name">${escHtml(entry.name)}</span>
                <span class="plug-cmp-st-badge ${cls}">${st}</span>
                ${entry.optional ? `<span class="plug-cmp-opt">${t('plugins.optional')}</span>` : ''}
            </div>`;
    }).join('');
    const extraRows = (result.strict_extra || []).map((n) => `<div class="plug-cmp-row plug-cmp-extra">
            <span class="plug-cmp-icon">${IC.x}</span>
            <span class="plug-cmp-name">${escHtml(n)}</span>
            <span class="plug-cmp-st-badge plug-cmp-extra">${t('plugins.extraMod')}</span>
        </div>`).join('');
    const statsChips = [
        nActive ? `<span class="plug-cmp-stat plug-cmp-stat-ok">${IC.check} ${nActive} ${t('plugins.cmpStatActive')}</span>` : '',
        nInactive ? `<span class="plug-cmp-stat plug-cmp-stat-warn">${IC.zap} ${nInactive} ${t('plugins.cmpStatInactive')}</span>` : '',
        nMissing ? `<span class="plug-cmp-stat plug-cmp-stat-err">${IC.x} ${nMissing} ${t('plugins.cmpStatMissing')}</span>` : '',
        nExtra ? `<span class="plug-cmp-stat plug-cmp-stat-extra">${IC.alert} ${nExtra} ${t('plugins.cmpStatExtra')}</span>` : '',
    ].filter(Boolean).join('');
    const headerCls = mode === 'apply' ? 'plug-ov-header-apply' : '';
    const headerIcon = mode === 'apply' ? IC.play : IC.search;
    return `
        <div class="plug-ov-header ${headerCls}">
            <span class="plug-ov-title">${headerIcon} <strong>${escHtml(name)}</strong></span>
            <button class="btn btn-xs btn-ghost plug-ov-close-btn" data-tooltip="${t('common.close')}">${IC.x}</button>
        </div>
        <div class="plug-ov-body">
            <div class="plug-cmp-stats-bar">
                ${statsChips || `<span class="plug-cmp-stat plug-cmp-stat-ok">${IC.checkCircle} ${t('plugins.cmpAllOk')}</span>`}
                ${result.strict ? `<span class="plug-cmp-stat plug-cmp-stat-strict">${IC.lock} ${t('plugins.strict')}</span>` : ''}
            </div>
            <div class="plug-cmp-list">${rows}</div>
            ${extraRows ? `<div class="plug-cmp-extra-section">
                <div class="plug-cmp-extra-title">${t('plugins.strictExtraTitle')}</div>
                ${extraRows}
            </div>` : ''}
        </div>
        <div class="plug-ov-footer">
            ${mode === 'apply' ? `<button class="btn btn-accent" id="plug-ov-apply">${IC.play} ${t('plugins.applyNow')}</button>` : ''}
            <button class="btn btn-ghost plug-ov-close-btn">${t('common.close')}</button>
        </div>`;
}
// ── Syntax highlighting ────────────────────────────────────────────────────
function highlightScript(code, format) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (format === 'bat') {
        return code.split('\n').map(line => {
            const trimmed = line.trim().toLowerCase();
            if (trimmed.startsWith('::') || trimmed.startsWith('rem ') || trimmed === 'rem') {
                return `<span class="sh-comment">${esc(line)}</span>`;
            }
            let out = esc(line);
            out = out.replace(/\b(start|call|set|if|else|goto|for|do|in|echo|@echo|exit|pause|timeout|taskkill|cmd|powershell|where|pushd|popd|mkdir|del|copy|move)\b/gi, '<span class="sh-keyword">$1</span>');
            out = out.replace(/%[^%\s]+%/g, m => `<span class="sh-var">${m}</span>`);
            out = out.replace(/"([^"]*)"/g, '<span class="sh-string">"$1"</span>');
            out = out.replace(/(bmm:\/\/[^\s&<>"]+)/g, '<span class="sh-url">$1</span>');
            out = out.replace(/\b(\d+)\b/g, '<span class="sh-num">$1</span>');
            return out;
        }).join('\n');
    }
    if (format === 'ps1') {
        return code.split('\n').map(line => {
            if (line.trim().startsWith('#')) {
                return `<span class="sh-comment">${esc(line)}</span>`;
            }
            let out = esc(line);
            out = out.replace(/\b(Invoke-RestMethod|Invoke-WebRequest|Start-Process|Start-Sleep|Write-Output|Write-Host|Write-Error|param|function|if|else|elseif|foreach|for|while|return|exit|try|catch|finally|throw|New-Item|Remove-Item|Get-Content|Set-Content)\b/g, '<span class="sh-keyword">$1</span>');
            out = out.replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, m => `<span class="sh-var">${m}</span>`);
            out = out.replace(/"([^"]*)"/g, '<span class="sh-string">"$1"</span>');
            out = out.replace(/'([^']*)'/g, `<span class="sh-string">'$1'</span>`);
            out = out.replace(/(bmm:\/\/[^\s&<>"']+)/g, '<span class="sh-url">$1</span>');
            return out;
        }).join('\n');
    }
    if (format === 'vbs') {
        return code.split('\n').map(line => {
            if (line.trim().startsWith("'")) {
                return `<span class="sh-comment">${esc(line)}</span>`;
            }
            let out = esc(line);
            out = out.replace(/\b(Dim|Set|WScript|Shell|Run|CreateObject|MsgBox|If|Then|Else|End|For|Next|Do|Loop|While|Wend|Sub|Function|Exit|True|False|Nothing|Option Explicit)\b/gi, '<span class="sh-keyword">$1</span>');
            out = out.replace(/"([^"]*)"/g, '<span class="sh-string">"$1"</span>');
            out = out.replace(/(bmm:\/\/[^\s&<>"]+)/g, '<span class="sh-url">$1</span>');
            out = out.replace(/\b(\d+)\b/g, '<span class="sh-num">$1</span>');
            return out;
        }).join('\n');
    }
    if (format === 'py') {
        return code.split('\n').map(line => {
            if (line.trim().startsWith('#'))
                return `<span class="sh-comment">${esc(line)}</span>`;
            let out = esc(line);
            out = out.replace(/\b(import|from|def|class|if|elif|else|for|while|in|return|try|except|finally|raise|with|as|pass|break|continue|and|or|not|is|None|True|False|lambda|yield|async|await|print|open|os|subprocess|time|webbrowser|requests)\b/g, '<span class="sh-keyword">$1</span>');
            out = out.replace(/f?"([^"]*)"/g, '<span class="sh-string">"$1"</span>');
            out = out.replace(/f?'([^']*)'/g, `<span class="sh-string">'$1'</span>`);
            out = out.replace(/\b(\d+\.?\d*)\b/g, '<span class="sh-num">$1</span>');
            out = out.replace(/(bmm:\/\/[^\s&<>"']+)/g, '<span class="sh-url">$1</span>');
            return out;
        }).join('\n');
    }
    if (format === 'lua') {
        return code.split('\n').map(line => {
            if (line.trim().startsWith('--'))
                return `<span class="sh-comment">${esc(line)}</span>`;
            let out = esc(line);
            out = out.replace(/\b(local|function|end|if|then|else|elseif|for|while|do|repeat|until|return|break|in|not|and|or|nil|true|false|print|require|io|os|string|table|math)\b/g, '<span class="sh-keyword">$1</span>');
            out = out.replace(/"([^"]*)"/g, '<span class="sh-string">"$1"</span>');
            out = out.replace(/'([^']*)'/g, `<span class="sh-string">'$1'</span>`);
            out = out.replace(/\b(\d+\.?\d*)\b/g, '<span class="sh-num">$1</span>');
            out = out.replace(/(bmm:\/\/[^\s&<>"']+)/g, '<span class="sh-url">$1</span>');
            return out;
        }).join('\n');
    }
    if (format === 'js') {
        return code.split('\n').map(line => {
            if (line.trim().startsWith('//'))
                return `<span class="sh-comment">${esc(line)}</span>`;
            let out = esc(line);
            out = out.replace(/\b(const|let|var|function|async|await|return|if|else|for|while|do|break|continue|new|typeof|instanceof|class|extends|import|require|module|exports|try|catch|finally|throw|true|false|null|undefined)\b/g, '<span class="sh-keyword">$1</span>');
            out = out.replace(/"([^"]*)"/g, '<span class="sh-string">"$1"</span>');
            out = out.replace(/'([^']*)'/g, `<span class="sh-string">'$1'</span>`);
            out = out.replace(/`([^`]*)`/g, `<span class="sh-string">\`$1\`</span>`);
            out = out.replace(/\b(\d+\.?\d*)\b/g, '<span class="sh-num">$1</span>');
            out = out.replace(/(bmm:\/\/[^\s&<>"']+)/g, '<span class="sh-url">$1</span>');
            return out;
        }).join('\n');
    }
    if (format === 'rb') {
        return code.split('\n').map(line => {
            if (line.trim().startsWith('#'))
                return `<span class="sh-comment">${esc(line)}</span>`;
            let out = esc(line);
            out = out.replace(/\b(require|def|end|do|if|elsif|else|unless|while|for|in|return|puts|print|sleep|system|nil|true|false|class|module|begin|rescue|ensure)\b/g, '<span class="sh-keyword">$1</span>');
            out = out.replace(/"([^"]*)"/g, '<span class="sh-string">"$1"</span>');
            out = out.replace(/'([^']*)'/g, `<span class="sh-string">'$1'</span>`);
            out = out.replace(/\b(\d+\.?\d*)\b/g, '<span class="sh-num">$1</span>');
            out = out.replace(/(bmm:\/\/[^\s&<>"']+)/g, '<span class="sh-url">$1</span>');
            return out;
        }).join('\n');
    }
    if (format === 'php') {
        return code.split('\n').map(line => {
            if (line.trim().startsWith('//') || line.trim().startsWith('#'))
                return `<span class="sh-comment">${esc(line)}</span>`;
            let out = esc(line);
            out = out.replace(/\b(function|if|else|while|for|foreach|return|echo|print|sleep|new|class|use|namespace|true|false|null|isset|empty)\b/g, '<span class="sh-keyword">$1</span>');
            out = out.replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, m => `<span class="sh-var">${m}</span>`);
            out = out.replace(/"([^"]*)"/g, '<span class="sh-string">"$1"</span>');
            out = out.replace(/'([^']*)'/g, `<span class="sh-string">'$1'</span>`);
            out = out.replace(/\b(\d+\.?\d*)\b/g, '<span class="sh-num">$1</span>');
            out = out.replace(/(bmm:\/\/[^\s&<>"']+)/g, '<span class="sh-url">$1</span>');
            return out;
        }).join('\n');
    }
    if (format === 'go') {
        return code.split('\n').map(line => {
            if (line.trim().startsWith('//'))
                return `<span class="sh-comment">${esc(line)}</span>`;
            let out = esc(line);
            out = out.replace(/\b(package|import|func|var|const|type|struct|interface|if|else|for|range|return|go|defer|chan|map|make|new|nil|true|false|error|string|int|bool|byte|fmt)\b/g, '<span class="sh-keyword">$1</span>');
            out = out.replace(/"([^"]*)"/g, '<span class="sh-string">"$1"</span>');
            out = out.replace(/`([^`]*)`/g, `<span class="sh-string">\`$1\`</span>`);
            out = out.replace(/\b(\d+\.?\d*)\b/g, '<span class="sh-num">$1</span>');
            out = out.replace(/(bmm:\/\/[^\s&<>"']+)/g, '<span class="sh-url">$1</span>');
            return out;
        }).join('\n');
    }
    if (format === 'java' || format === 'cs') {
        return code.split('\n').map(line => {
            if (line.trim().startsWith('//'))
                return `<span class="sh-comment">${esc(line)}</span>`;
            let out = esc(line);
            out = out.replace(/\b(public|private|static|class|void|new|if|else|for|while|return|import|using|async|await|var|string|int|bool|true|false|null|System|Task|Thread|Process|Console|Runtime|File|String|HttpClient|HttpRequest)\b/g, '<span class="sh-keyword">$1</span>');
            out = out.replace(/"([^"]*)"/g, '<span class="sh-string">"$1"</span>');
            out = out.replace(/\b(\d+\.?\d*)\b/g, '<span class="sh-num">$1</span>');
            out = out.replace(/(bmm:\/\/[^\s&<>"']+)/g, '<span class="sh-url">$1</span>');
            return out;
        }).join('\n');
    }
    if (format === 'rs') {
        return code.split('\n').map(line => {
            if (line.trim().startsWith('//'))
                return `<span class="sh-comment">${esc(line)}</span>`;
            let out = esc(line);
            out = out.replace(/\b(use|fn|let|const|mut|struct|impl|trait|if|else|for|while|return|match|Some|None|Ok|Err|pub|mod|async|await|move|Box|Vec|String|str|i32|u64|bool|true|false|println|format)\b/g, '<span class="sh-keyword">$1</span>');
            out = out.replace(/"([^"]*)"/g, '<span class="sh-string">"$1"</span>');
            out = out.replace(/r#"([^"]*)"#/g, '<span class="sh-string">r#"$1"#</span>');
            out = out.replace(/\b(\d+\.?\d*)\b/g, '<span class="sh-num">$1</span>');
            out = out.replace(/(bmm:\/\/[^\s&<>"']+)/g, '<span class="sh-url">$1</span>');
            return out;
        }).join('\n');
    }
    return esc(code);
}
function hlJson(raw) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc(raw)
        .replace(/("(?:[^"\\]|\\.)*")(\s*:)/g, '<span class="hlj-key">$1</span>$2')
        .replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span class="hlj-str">$1</span>')
        .replace(/:\s*(true|false)\b/g, ': <span class="hlj-bool">$1</span>')
        .replace(/:\s*(null)\b/g, ': <span class="hlj-null">$1</span>')
        .replace(/:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, ': <span class="hlj-num">$1</span>');
}
async function handleQuickTest(method, path, body, btnEl) {
    const resultDiv = document.getElementById('plug-qt-result');
    const statusEl = document.getElementById('plug-qt-status');
    const pathEl = document.getElementById('plug-qt-path');
    const bodyEl = document.getElementById('plug-qt-body');
    if (!resultDiv)
        return;
    const btnOrigHtml = btnEl?.innerHTML;
    if (btnEl) {
        btnEl.setAttribute('disabled', 'true');
        btnEl.style.opacity = '0.6';
    }
    resultDiv.style.display = 'block';
    statusEl.textContent = '...';
    statusEl.className = 'plug-tester-status';
    if (pathEl)
        pathEl.textContent = `${method} ${path}`;
    bodyEl.innerHTML = `<span style="color:var(--text-muted)">${t('common.loading')}</span>`;
    try {
        // Read the LIVE token (input field first, then cache) so a regenerated
        // token doesn't cause spurious 401s from a stale cached value.
        const liveToken = document.getElementById('plug-token-display')?.value?.trim() || _apiToken;
        const opts = {
            method,
            headers: { 'Authorization': `Bearer ${liveToken}`, 'Content-Type': 'application/json' },
        };
        if ((method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') && body)
            opts.body = body;
        const res = await fetch(`${apiBase()}${path}`, opts);
        const text = await res.text().catch(() => '');
        let json = null;
        try {
            json = JSON.parse(text);
        }
        catch { /* not JSON */ }
        statusEl.textContent = `${res.status} ${res.statusText}`;
        statusEl.className = `plug-tester-status ${res.ok ? 'plug-status-ok' : 'plug-status-err'}`;
        let pretty = json !== null ? JSON.stringify(json, null, 2) : text;
        const MAX_DISPLAY = 8000;
        if (pretty.length > MAX_DISPLAY) {
            pretty = pretty.slice(0, MAX_DISPLAY) + `\n\n… [tronqué — ${pretty.length.toLocaleString()} caractères au total]`;
        }
        bodyEl.innerHTML = hlJson(pretty);
        // ── Live UI refresh after successful mutations ─────────────────────
        if (res.ok && method !== 'GET') {
            if (path.includes('/profiles')) {
                window._refreshProfilesFn?.();
                window._refreshModsFn?.();
            }
            if (path.includes('/mods') && !path.includes('/modpacks')) {
                window._refreshModsFn?.();
            }
            if (path.includes('/modpacks') || path.includes('/plugins/apply')) {
                window._refreshModsFn?.();
            }
        }
    }
    catch (e) {
        statusEl.textContent = t('common.error');
        statusEl.className = 'plug-tester-status plug-status-err';
        bodyEl.textContent = String(e);
    }
    finally {
        if (btnEl && btnOrigHtml !== undefined) {
            btnEl.removeAttribute('disabled');
            btnEl.style.opacity = '';
            btnEl.innerHTML = btnOrigHtml;
        }
    }
}
// ── Tab: Create ────────────────────────────────────────────────────────────
/** Write "3 shipped" (or nothing at all) beside one kind. */
function setShipCount(id, n) {
    const el = document.getElementById(id);
    if (!el)
        return;
    // Empty rather than "0": a zero is a number somebody reads and then works out means
    // none, and the list underneath already says so in words.
    el.textContent = n ? (t('plugins.shipCount') || '{n} shipped').replace('{n}', String(n)) : '';
}
function renderCreate(container) {
    // Reset edit-carry state — a fresh Create tab starts with no bundled files.
    _editScripts = [];
    _editFolders = [];
    _removedScripts = [];
    _removedFolders = [];
    _editAutomations = [];
    _removedAutomations = [];
    _editBundles = [];
    _removedBundles = [];
    container.innerHTML = `
        <div class="plug-create-layout">
            <div class="plug-create-form-col">
                <h3 class="plug-section-title">${IC.list} ${t('plugins.createTitle')}</h3>
                <div class="plug-form-grid">
                    <div class="plug-sec-h">${escHtml(t('plugins.secIdentity') || 'What it is')}</div>
                    <div class="plug-form-row">
                        <label class="plug-form-label">${t('plugins.createId')} *</label>
                        <input type="text" id="pc-id" class="input" placeholder="my-server-modlist">
                        <span class="plug-field-note" id="pc-id-note">${escHtml(t('plugins.createIdHint') || 'Letters, digits, - and . — this is how every other plugin, catalogue and deeplink refers to it, so it cannot be changed later without breaking them.')}</span>
                    </div>
                    <div class="plug-form-row">
                        <label class="plug-form-label">${t('plugins.createName')} *</label>
                        <input type="text" id="pc-name" class="input" placeholder="${escAttr(t('plugins.phServerMods'))}">
                    </div>
                    <div class="plug-form-row">
                        <label class="plug-form-label">${t('plugins.createGame')}</label>
                        <input type="text" id="pc-game" class="input" placeholder="DCS World, ArmA 3...">
                    </div>
                    <div class="plug-form-row">
                        <label class="plug-form-label">${t('plugins.createVersion')}</label>
                        <input type="text" id="pc-version" class="input" value="1.0.0">
                    </div>
                    <div class="plug-form-row">
                        <label class="plug-form-label">${t('plugins.createDesc')}</label>
                        <textarea id="pc-desc" class="input" rows="2" style="resize:vertical"></textarea>
                    </div>
                    <!-- Three fields the form could never fill: author, website and tags
                         were hard-coded empty in buildManifest, and the plugin CARD renders
                         tags — so it drew a row nothing could ever populate. -->
                    <div class="plug-form-row">
                        <label class="plug-form-label">${escHtml(t('plugins.createAuthor') || 'Author')}</label>
                        <input type="text" id="pc-author" class="input" placeholder="${escAttr(t('plugins.createAuthorPh') || 'your name or your team')}">
                    </div>
                    <div class="plug-form-row">
                        <label class="plug-form-label">${escHtml(t('plugins.createWebsite') || 'Website')}</label>
                        <input type="text" id="pc-website" class="input" placeholder="https://">
                    </div>
                    <div class="plug-form-row">
                        <label class="plug-form-label">${escHtml(t('plugins.createTags') || 'Tags')}</label>
                        <input type="text" id="pc-tags" class="input" placeholder="${escAttr(t('plugins.createTagsPh') || 'dcs, multiplayer, weekly — separated by commas')}">
                    </div>
                    <div class="plug-form-row">
                        <label class="plug-form-label">${t('plugins.customIconLabel')}</label>
                        <div class="plug-icon-picker">
                            <div class="plug-icon-preview" id="pc-icon-preview">
                                <div class="plug-card-icon-default">${IC.puzzle}</div>
                            </div>
                            <div class="plug-icon-actions">
                                <div class="plug-icon-tabs">
                                    <button class="plug-icon-tab-btn active" data-itab="file">${t('plugins.iconTabFile')}</button>
                                    <button class="plug-icon-tab-btn" data-itab="builtin">${t('plugins.iconTabBuiltin')}</button>
                                </div>
                                <div id="pc-icon-tab-file">
                                    <button class="btn btn-xs btn-ghost" id="pc-pick-icon">${IC.upload} ${t('plugins.pickIcon')}</button>
                                    <button class="btn btn-xs btn-ghost" id="pc-clear-icon" style="display:none;">${IC.x} ${t('plugins.removeIcon')}</button>
                                </div>
                                <div id="pc-icon-tab-builtin" style="display:none;">
                                    <div class="plug-icon-builtin-grid">
                                        ${Object.entries(IC).map(([k, svg]) => `<button class="plug-icon-builtin-btn" data-ickey="${k}" data-tooltip="${k}">${svg}</button>`).join('')}
                                    </div>
                                    <button class="btn btn-xs btn-ghost" id="pc-icon-library" style="margin-top:6px;">${t('plugins.iconLibrary') || 'Bibliothèque (5000+ icônes)…'}</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="plug-sec-h">${escHtml(t('plugins.secShips') || 'What it ships')}</div>
                    <!-- Three kinds, ONE shape.
                         They had three different ones: scripts behind a toggle that revealed
                         a row, folders as a bare button, automations as another. The toggle
                         was the worst of it — it hid the import button, and has_scripts is
                         derived from what is actually in the list anyway, so the switch
                         decided nothing except whether you could see the thing that does. -->
                    <div class="plug-ships">
                        <div class="plug-ship" data-ship="scripts">
                            <div class="plug-ship-head">
                                <span class="plug-ship-name">${escHtml(t('plugins.pluginScripts') || 'Scripts')}</span>
                                <span class="plug-ship-kinds">.bat .ps1 .vbs .py .js</span>
                                <span class="plug-ship-count" id="pc-count-scripts"></span>
                                <button class="btn btn-xs btn-ghost" id="pc-import-scripts">${IC.download} ${escHtml(t('common.add') || 'Add')}</button>
                            </div>
                            <div id="pc-scripts-list" class="plug-scripts-list"></div>
                            <p class="plug-ship-warn">${IC.lock}<span>${escHtml(t('plugins.unsafeScriptWarn') || 'Scripts run real programs on your PC. They only execute after you grant the unsafe-plugins permission and confirm.')}</span></p>
                        </div>

                        <div class="plug-ship" data-ship="folders">
                            <div class="plug-ship-head">
                                <span class="plug-ship-name">${escHtml(t('plugins.pluginFolders') || 'Bundled folders')}</span>
                                <span class="plug-ship-kinds">${escHtml(t('plugins.optional') || '(optional)')}</span>
                                <span class="plug-ship-count" id="pc-count-folders"></span>
                                <button class="btn btn-xs btn-ghost" id="pc-import-folders">${IC.folder} ${escHtml(t('common.add') || 'Add')}</button>
                            </div>
                            <div id="pc-folders-list" class="plug-scripts-list"></div>
                        </div>

                        <div class="plug-ship" data-ship="automations">
                            <div class="plug-ship-head">
                                <span class="plug-ship-name">${escHtml(t('plugins.pluginAutomations'))}</span>
                                <span class="plug-ship-kinds">.bmmpa</span>
                                <span class="plug-ship-count" id="pc-count-automations"></span>
                                <button class="btn btn-xs btn-ghost" id="pc-import-automations">${IC.download} ${escHtml(t('common.add') || 'Add')}</button>
                            </div>
                            <div id="pc-automations-list" class="plug-scripts-list"></div>
                            <p class="plug-auto-note">${escHtml(t('plugins.automationsNote'))}</p>
                        </div>

                        <!-- A catalogue in one file. The plugin could already ship the
                             automation and not the catalogue the automation came from, which
                             is the half that keeps working next month. -->
                        <div class="plug-ship" data-ship="bundles">
                            <div class="plug-ship-head">
                                <span class="plug-ship-name">${escHtml(t('plugins.pluginBundles'))}</span>
                                <span class="plug-ship-kinds">.bmmbundle</span>
                                <span class="plug-ship-count" id="pc-count-bundles"></span>
                                <button class="btn btn-xs btn-ghost" id="pc-import-bundles">${IC.download} ${escHtml(t('common.add') || 'Add')}</button>
                            </div>
                            <div id="pc-bundles-list" class="plug-scripts-list"></div>
                            <p class="plug-auto-note">${escHtml(t('plugins.bundlesNote'))}</p>
                        </div>
                    </div>

                    <!-- What happens on apply -->
                    <div class="plug-sec-h">${escHtml(t('plugins.secDoes') || 'What it does')}</div>
                    <!-- Strict mode was under "what it ships", which is where it is least
                         useful: it does not change what is in the plugin at all, it changes
                         what APPLYING one does — remove everything that is not in the list,
                         or only add what is. Next to the apply mode, which is the other half
                         of the same sentence. -->
                    <div class="plug-form-row" style="flex-direction:row;align-items:center;gap:12px;">
                        <label class="plug-form-label" style="margin:0;">${t('plugins.strictMode')}</label>
                        <label class="plug-toggle">
                            <input type="checkbox" id="pc-strict">
                            <span class="plug-toggle-slider"></span>
                        </label>
                        <span class="plug-toggle-hint" id="pc-strict-hint">${t('plugins.strictOff')}</span>
                    </div>
                    <div class="plug-form-row">
                        <label class="plug-form-label">${t('plugins.applyMode') || 'On apply'}</label>
                        <select id="pc-apply-mode" class="select select-sm">
                            <option value="modlist">${t('plugins.applyModeModlist') || 'Apply mod list (default)'}</option>
                            <option value="script">${t('plugins.applyModeScript') || 'Run scripts only'}</option>
                            <option value="both">${t('plugins.applyModeBoth') || 'Apply mod list + run scripts'}</option>
                            <option value="automation">${escHtml(t('plugins.applyModeAutomation'))}</option>
                        </select>
                        <span class="plug-toggle-hint">${t('plugins.applyModeHint') || 'Choose what activating this plugin does.'}</span>
                    </div>

                    <!-- What it ASKS for. The permissions array was hard-coded empty here,
                         so no plugin built in this app could declare what it needs — even
                         though the permission screen reads it to pre-tick the boxes at
                         install. Ticking one REQUESTS it; the installer still decides. -->
                    <div class="plug-sec-h">${escHtml(t('plugins.secAsks') || 'What it needs')}</div>
                    <div class="plug-form-row">
                        <label class="plug-form-label">${escHtml(t('plugins.createPerms') || 'Permissions it requests')}</label>
                        <span class="plug-field-note">${escHtml(t('plugins.createPermsHint') || 'Ticking one here only ASKS. Whoever installs the plugin sees the request pre-ticked and decides. Ask for the least that works — a plugin requesting everything is one nobody reads the list of.')}</span>
                        <!-- One block per domain, and inside it a grid rather than a wrap.
                             Every scope used to be an inline chip flowing after a 96px label,
                             so twenty-six of them across seven domains came out as a ragged
                             wall where nothing lined up with anything and the eye had no
                             column to run down.

                             The description is on the ROW now, not in a tooltip. This is the
                             one screen where "what does mods.write actually let it do" is the
                             question being answered, and a hover is invisible to somebody
                             scanning — which is everybody, the first time. -->
                        <div class="plug-req-perms" id="pc-perms">
                            <div class="plug-req-bar">
                                <span class="plug-req-count" id="pc-perm-count"></span>
                                <button type="button" class="btn btn-xs btn-ghost" id="pc-perm-none">${escHtml(t('plugins.createPermsNone'))}</button>
                            </div>
                            ${permDomains().map(d => `
                                <div class="plug-req-dom">
                                    <div class="plug-req-dom-h" style="color:${d.color};">
                                        <span>${escHtml(d.domain)}</span>
                                        <span class="plug-req-dom-n" data-dom-n="${escAttr(d.domain)}"></span>
                                    </div>
                                    <div class="plug-req-scopes">
                                        ${d.scopes.map(sc => `
                                            <label class="plug-req-item">
                                                <input type="checkbox" class="pc-perm-cb" data-perm="${escAttr(sc)}"
                                                    data-dom="${escAttr(d.domain)}" style="accent-color:${d.color};">
                                                <span class="plug-req-text">
                                                    <code style="color:${d.color};">${escHtml(sc)}</code>
                                                    <em>${escHtml(t('plugins.scope.' + sc) || '')}</em>
                                                </span>
                                            </label>`).join('')}
                                    </div>
                                </div>`).join('')}
                        </div>
                    </div>
                </div>
            </div>

            <div class="plug-create-mods-col">
                <h3 class="plug-section-title">${IC.list} ${t('plugins.createModList')}</h3>
                <div class="plug-mod-selector">
                    <div class="plug-mod-selector-header">
                        <div class="docs-search-field" style="flex:1;min-width:0;min-height:36px;">
                            <span class="docs-search-icon">${IC.search}</span>
                            <input type="text" id="pc-mod-search" class="docs-search-input" placeholder="${t('plugins.searchMods')}">
                        </div>
                        <div class="plug-mod-selector-filters">
                            <select id="pc-profile-filter" class="select" style="font-size:11px;padding:4px 8px;height:28px;border-radius:6px;" data-tooltip="${t('plugins.filterByProfile')}">
                                <option value="">${t('plugins.allMods')}</option>
                                ${_allProfiles.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join('')}
                            </select>
                            <span class="plug-mod-count-hint" id="pc-mod-count">0 ${t('plugins.modsSelected')}</span>
                        </div>
                    </div>
                    <div class="plug-mod-available" id="pc-available-mods">
                        ${_allModsAll.length ? _allModsAll.map(m => `
                            <div class="plug-mod-item" data-id="${escHtml(m.id)}" data-name="${escHtml(m.name || m.id)}" data-profiles="${escHtml((m.profileIds || []).join(','))}">
                                <span class="plug-mod-item-col">
                                    <span class="plug-mod-item-name">${escHtml(m.name || m.id)}</span>
                                    <button class="plug-mod-id" data-copy-id="${escAttr(m.id)}" data-tooltip="${t('plugins.copyId') || 'Copy mod id'}">${escHtml(m.id)}</button>
                                </span>
                                <span class="plug-mod-profile-badge" style="display:none;" data-tooltip="${t('plugins.activeInProfile')}">${IC.checkCircle}</span>
                                <label class="plug-mod-optional-lbl" data-tooltip="${t('plugins.optional')}">
                                    <input type="checkbox" class="plug-mod-optional-cb" tabindex="-1"> opt
                                </label>
                                <button class="btn btn-xs plug-mod-add-btn">${IC.plus}</button>
                            </div>`).join('') : `<div class="plug-mod-empty">${t('plugins.noMods')}</div>`}
                    </div>
                </div>

                <div class="plug-selected-mods" id="pc-selected-list">
                    <div class="plug-selected-header">${t('plugins.selectedMods')}</div>
                    <div id="pc-selected-items" class="plug-selected-items">
                        <div class="plug-mod-empty" id="pc-empty-hint">${t('plugins.noModsSelected')}</div>
                    </div>
                </div>

                <div class="plug-create-buttons">
                    <button class="btn btn-sm btn-accent" id="pc-save-local">${IC.save} ${t('plugins.saveLocal')}</button>
                    <button class="btn btn-sm btn-secondary" id="pc-export-bmmplug">${IC.exportIcon} ${t('plugins.exportBmmplug')}</button>
                </div>
            </div>
        </div>
    `;
    const selectedMods = new Map();
    let iconSrcPath = '';
    let iconBuiltinSvg = ''; // SVG string when user picks a builtin icon
    const scriptPaths = []; // absolute paths of scripts to bundle
    // A chip for a file/folder ALREADY bundled with the plugin (edit mode). Removal is
    // STAGED (struck-through + Undo) so nothing is lost until the user saves.
    const bundledChip = (rel, removed, kind) => {
        const fname = (rel.split('/').pop() || rel) + (kind === 'folder' ? '/' : '');
        const label = removed
            ? `<span style="text-decoration:line-through;opacity:.55;">${escHtml(fname)}</span>`
            : `<span>${escHtml(fname)}</span>`;
        const action = removed
            ? `<button class="plug-bundled-undo" data-rel="${escAttr(rel)}" data-kind="${kind}" data-tooltip="${t('plugins.undoRemove') || 'Undo removal'}">${t('plugins.undo') || 'Undo'}</button>`
            : `<button class="plug-bundled-rm" data-rel="${escAttr(rel)}" data-kind="${kind}" data-tooltip="${t('common.remove') || 'Remove'}">${IC.x}</button>`;
        return `<div class="plug-script-chip plug-bundled-chip${removed ? ' plug-bundled-removed' : ''}"><span class="plug-bundled-tag">${t('plugins.bundledTag') || 'bundled'}</span>${label}${action}</div>`;
    };
    // ── Scripts: toggle row + import ──────────────────────────────────────────
    const renderScriptsList = () => {
        const list = document.getElementById('pc-scripts-list');
        if (!list)
            return;
        const bundled = _editScripts.map(rel => bundledChip(rel, _removedScripts.includes(rel), 'script')).join('');
        const picked = scriptPaths.map((p, i) => {
            const fname = p.split(/[\\/]/).pop() || p;
            return `<div class="plug-script-chip"><span>${escHtml(fname)}</span><button class="plug-script-rm" data-i="${i}" data-tooltip="${t('common.remove') || 'Remove'}">${IC.x}</button></div>`;
        }).join('');
        list.innerHTML = (bundled + picked)
            || `<span style="font-size:11px;color:var(--text-muted);">${t('plugins.noScripts') || 'No script imported yet.'}</span>`;
        setShipCount('pc-count-scripts', _editScripts.filter(x => !_removedScripts.includes(x)).length + scriptPaths.length);
        list.querySelectorAll('.plug-script-rm').forEach(b => b.addEventListener('click', () => {
            scriptPaths.splice(parseInt(b.dataset.i, 10), 1);
            renderScriptsList();
        }));
        list.querySelectorAll('.plug-bundled-rm').forEach(b => b.addEventListener('click', () => {
            const rel = b.dataset.rel;
            if (!_removedScripts.includes(rel))
                _removedScripts.push(rel);
            renderScriptsList();
        }));
        list.querySelectorAll('.plug-bundled-undo').forEach(b => b.addEventListener('click', () => {
            const rel = b.dataset.rel;
            _removedScripts = _removedScripts.filter(r => r !== rel);
            renderScriptsList();
        }));
    };
    _renderPcScripts = renderScriptsList;
    // The requested-permissions block, once the form exists in the DOM.
    wireReqPerms();
    container.querySelector('#pc-import-scripts')?.addEventListener('click', async () => {
        const picked = await pickFile([{ name: 'Scripts', extensions: ['bat', 'cmd', 'ps1', 'vbs', 'py', 'js', 'sh'] }]);
        if (picked) {
            scriptPaths.push(picked);
            renderScriptsList();
        }
    });
    // ── Folders: import directories to bundle with the plugin ────────────────
    const folderPaths = [];
    const renderFoldersList = () => {
        const list = document.getElementById('pc-folders-list');
        if (!list)
            return;
        const bundled = _editFolders.map(rel => bundledChip(rel, _removedFolders.includes(rel), 'folder')).join('');
        const picked = folderPaths.map((p, i) => {
            const fname = p.split(/[\\/]/).filter(Boolean).pop() || p;
            // The facts arrive after the chip does — see below. A folder with ten thousand
            // files in it should say so before it ships, not after.
            return `<div class="plug-script-chip"><span>${escHtml(fname)}/</span>
                <span class="plug-folder-facts" data-path="${escAttr(p)}"></span>
                <button class="plug-folder-see" data-path="${escAttr(p)}" data-tooltip="${escAttr(t('plugins.tree.folderTip'))}">${IC.eye}</button>
                <button class="plug-folder-rm" data-i="${i}" data-tooltip="${escAttr(t('common.remove') || 'Remove')}">${IC.x}</button></div>`;
        }).join('');
        list.innerHTML = (bundled + picked)
            || `<span style="font-size:11px;color:var(--text-muted);">${t('plugins.noFolders') || 'No folder imported yet.'}</span>`;
        setShipCount('pc-count-folders', _editFolders.filter(x => !_removedFolders.includes(x)).length + folderPaths.length);
        list.querySelectorAll('.plug-folder-rm').forEach(b => b.addEventListener('click', () => {
            folderPaths.splice(parseInt(b.dataset.i, 10), 1);
            renderFoldersList();
        }));
        list.querySelectorAll('.plug-folder-see').forEach(b => b.addEventListener('click', () => {
            void openFolderContent(b.dataset.path);
        }));
        // Counted once per chip, after it is on screen. A folder on a slow drive must not
        // hold up the list that names it.
        list.querySelectorAll('.plug-folder-facts').forEach(async (el) => {
            const facts = await folderFacts(el.dataset.path);
            if (!facts)
                return;
            el.textContent = (t('plugins.tree.chip') || '{f} file(s) · {b}')
                .replace('{f}', String(facts.files))
                .replace('{b}', humanSize(facts.bytes) || '0 B');
        });
        list.querySelectorAll('.plug-bundled-rm').forEach(b => b.addEventListener('click', () => {
            const rel = b.dataset.rel;
            if (!_removedFolders.includes(rel))
                _removedFolders.push(rel);
            renderFoldersList();
        }));
        list.querySelectorAll('.plug-bundled-undo').forEach(b => b.addEventListener('click', () => {
            const rel = b.dataset.rel;
            _removedFolders = _removedFolders.filter(r => r !== rel);
            renderFoldersList();
        }));
    };
    _renderPcFolders = renderFoldersList;
    renderFoldersList();
    container.querySelector('#pc-import-folders')?.addEventListener('click', async () => {
        const dir = await pickFolder();
        if (dir) {
            folderPaths.push(dir);
            renderFoldersList();
        }
    });
    // ── Automations: .bmmpa files shipped with the plugin ──────────────────────
    const automationPaths = [];
    const renderAutomationsList = () => {
        const list = document.getElementById('pc-automations-list');
        if (!list)
            return;
        const bundled = _editAutomations.map(rel => bundledChip(rel, _removedAutomations.includes(rel), 'automation')).join('');
        const picked = automationPaths.map((p, i) => {
            const fname = p.split(/[\\/]/).filter(Boolean).pop() || p;
            return `<div class="plug-script-chip"><span>${escHtml(fname)}</span><button class="plug-auto-rm" data-i="${i}" data-tooltip="${escAttr(t('common.remove') || 'Remove')}">${IC.x}</button></div>`;
        }).join('');
        list.innerHTML = (bundled + picked)
            || `<span style="font-size:11px;color:var(--text-muted);">${escHtml(t('plugins.noAutomations'))}</span>`;
        setShipCount('pc-count-automations', _editAutomations.filter(x => !_removedAutomations.includes(x)).length + automationPaths.length);
        list.querySelectorAll('.plug-auto-rm').forEach(b => b.addEventListener('click', () => {
            automationPaths.splice(parseInt(b.dataset.i, 10), 1);
            renderAutomationsList();
        }));
        list.querySelectorAll('.plug-bundled-rm').forEach(b => b.addEventListener('click', () => {
            const rel = b.dataset.rel;
            if (!_removedAutomations.includes(rel))
                _removedAutomations.push(rel);
            renderAutomationsList();
        }));
        list.querySelectorAll('.plug-bundled-undo').forEach(b => b.addEventListener('click', () => {
            const rel = b.dataset.rel;
            _removedAutomations = _removedAutomations.filter(r => r !== rel);
            renderAutomationsList();
        }));
    };
    _renderPcAutomations = renderAutomationsList;
    renderAutomationsList();
    container.querySelector('#pc-import-automations')?.addEventListener('click', async () => {
        const f = await pickFile({ filters: [{ name: 'BMM automation', extensions: ['bmmpa', 'json'] }] }).catch(() => null);
        if (f) {
            automationPaths.push(f);
            renderAutomationsList();
        }
    });
    // ── Bundles: .bmmbundle catalogues shipped with the plugin ────────────────
    const bundlePaths = [];
    const renderBundlesList = () => {
        const list = document.getElementById('pc-bundles-list');
        if (!list)
            return;
        const bundled = _editBundles.map(rel => bundledChip(rel, _removedBundles.includes(rel), 'bundle')).join('');
        const picked = bundlePaths.map((p, i) => {
            const fname = p.split(/[\\/]/).filter(Boolean).pop() || p;
            return `<div class="plug-script-chip"><span>${escHtml(fname)}</span><button class="plug-bundle-rm" data-i="${i}" data-tooltip="${escAttr(t('common.remove') || 'Remove')}">${IC.x}</button></div>`;
        }).join('');
        list.innerHTML = (bundled + picked)
            || `<span style="font-size:11px;color:var(--text-muted);">${escHtml(t('plugins.noBundles'))}</span>`;
        setShipCount('pc-count-bundles', _editBundles.filter(x => !_removedBundles.includes(x)).length + bundlePaths.length);
        list.querySelectorAll('.plug-bundle-rm').forEach(b => b.addEventListener('click', () => {
            bundlePaths.splice(parseInt(b.dataset.i, 10), 1);
            renderBundlesList();
        }));
        list.querySelectorAll('.plug-bundled-rm').forEach(b => b.addEventListener('click', () => {
            const rel = b.dataset.rel;
            if (!_removedBundles.includes(rel))
                _removedBundles.push(rel);
            renderBundlesList();
        }));
        list.querySelectorAll('.plug-bundled-undo').forEach(b => b.addEventListener('click', () => {
            const rel = b.dataset.rel;
            _removedBundles = _removedBundles.filter(r => r !== rel);
            renderBundlesList();
        }));
    };
    _renderPcBundles = renderBundlesList;
    renderBundlesList();
    container.querySelector('#pc-import-bundles')?.addEventListener('click', async () => {
        const f = await pickFile({ filters: [{ name: t('catpub.bundleKind'), extensions: ['bmmbundle', 'zip'] }] }).catch(() => null);
        if (f) {
            bundlePaths.push(f);
            renderBundlesList();
        }
    });
    // Icon tab switching
    container.querySelectorAll('.plug-icon-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            container.querySelectorAll('.plug-icon-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tab = btn.dataset.itab;
            document.getElementById('pc-icon-tab-file').style.display = tab === 'file' ? '' : 'none';
            document.getElementById('pc-icon-tab-builtin').style.display = tab === 'builtin' ? '' : 'none';
        });
    });
    // File icon picker
    container.querySelector('#pc-pick-icon')?.addEventListener('click', async () => {
        const p = await pickFile({ filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
        if (!p)
            return;
        iconSrcPath = p;
        const preview = document.getElementById('pc-icon-preview');
        if (preview)
            preview.innerHTML = `<img src="${convertFileSrc(p)}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
        document.getElementById('pc-clear-icon').style.display = '';
    });
    container.querySelector('#pc-clear-icon')?.addEventListener('click', () => {
        iconSrcPath = '';
        iconBuiltinSvg = '';
        const preview = document.getElementById('pc-icon-preview');
        if (preview)
            preview.innerHTML = `<div class="plug-card-icon-default">${IC.puzzle}</div>`;
        document.getElementById('pc-clear-icon').style.display = 'none';
    });
    // The full icon library (Lucide + brands + upload). A picked ref renders to
    // plain SVG markup and rides the EXISTING iconBuiltinSvg path — the plugin
    // format already persists SVG, so nothing downstream changes.
    container.querySelector('#pc-icon-library')?.addEventListener('click', async () => {
        const { openIconPicker, renderPackIcon, ensurePackFor } = await import('../../ui/icon-pack.js');
        const ref = await openIconPicker();
        if (ref === null)
            return;
        await ensurePackFor(ref);
        const svg = renderPackIcon(ref, 24);
        if (!svg)
            return;
        iconSrcPath = '';
        iconBuiltinSvg = svg;
        const preview = document.getElementById('pc-icon-preview');
        if (preview)
            preview.innerHTML = `<div class="plug-card-icon-default" style="color:var(--accent);">${svg}</div>`;
        container.querySelectorAll('.plug-icon-builtin-btn').forEach(b => b.classList.remove('active'));
    });
    // Builtin icon picker
    container.querySelectorAll('.plug-icon-builtin-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.ickey;
            const svg = IC[key];
            if (!svg)
                return;
            iconSrcPath = ''; // Clear file path when using builtin
            iconBuiltinSvg = svg; // Store SVG to send to Rust
            const preview = document.getElementById('pc-icon-preview');
            if (preview)
                preview.innerHTML = `<div class="plug-card-icon-default" style="color:var(--accent);">${svg}</div>`;
            container.querySelectorAll('.plug-icon-builtin-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
    function updateCount() {
        const el = document.getElementById('pc-mod-count');
        if (el)
            el.textContent = `${selectedMods.size} ${t('plugins.modsSelected')}`;
        const hint = document.getElementById('pc-empty-hint');
        if (hint)
            hint.style.display = selectedMods.size ? 'none' : '';
    }
    function addMod(id, name, optional) {
        if (selectedMods.has(id))
            return;
        selectedMods.set(id, { name, optional });
        const item = document.createElement('div');
        item.className = 'plug-selected-item';
        item.dataset.id = id;
        item.innerHTML = `
            <span class="plug-mod-item-col">
                <span class="plug-selected-name">${escHtml(name)}</span>
                <button class="plug-mod-id" data-copy-id="${escAttr(id)}" data-tooltip="${t('plugins.copyId') || 'Copy mod id'}">${escHtml(id)}</button>
            </span>
            <label class="plug-sel-opt">
                <input type="checkbox" ${optional ? 'checked' : ''}> ${t('plugins.optional')}
            </label>
            <button class="btn btn-xs btn-danger plug-sel-remove">${IC.x}</button>`;
        item.querySelector('input[type=checkbox]')?.addEventListener('change', (e) => {
            const entry = selectedMods.get(id);
            if (entry)
                entry.optional = e.target.checked;
        });
        item.querySelector('.plug-sel-remove')?.addEventListener('click', () => {
            selectedMods.delete(id);
            item.remove();
            updateCount();
            container.querySelector(`.plug-mod-item[data-id="${id}"]`)?.classList.remove('plug-mod-selected');
        });
        document.getElementById('pc-selected-items')?.appendChild(item);
        container.querySelector(`.plug-mod-item[data-id="${id}"]`)?.classList.add('plug-mod-selected');
        updateCount();
    }
    function applyModFilters() {
        const profileId = container.querySelector('#pc-profile-filter')?.value || '';
        const q = (container.querySelector('#pc-mod-search')?.value || '').toLowerCase();
        const profile = _allProfiles.find(p => p.id === profileId);
        const activeMods = new Set(profile?.active_mods || []);
        container.querySelectorAll('.plug-mod-item').forEach(item => {
            const el = item;
            const id = el.dataset.id || '';
            const name = el.dataset.name?.toLowerCase() || '';
            // Profiles that physically contain this mod (from the all-profiles list)
            const modProfiles = (el.dataset.profiles || '').split(',').filter(Boolean);
            const badge = el.querySelector('.plug-mod-profile-badge');
            // Badge = mod is enabled in the selected profile
            if (badge)
                badge.style.display = profileId && activeMods.has(id) ? '' : 'none';
            // Visibility: no profile → show all; profile selected → only mods in that profile
            const passesProfile = !profileId || modProfiles.includes(profileId);
            const passesSearch = !q || name.includes(q);
            el.style.display = passesProfile && passesSearch ? '' : 'none';
        });
    }
    // Profile filter
    container.querySelector('#pc-profile-filter')?.addEventListener('change', applyModFilters);
    container.querySelector('#pc-mod-search')?.addEventListener('input', applyModFilters);
    container.querySelectorAll('.plug-mod-add-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = btn.closest('.plug-mod-item');
            const id = item.dataset.id;
            const name = item.dataset.name || id;
            const opt = item.querySelector('.plug-mod-optional-cb')?.checked || false;
            if (id)
                addMod(id, name, opt);
        });
    });
    container.querySelector('#pc-strict')?.addEventListener('change', (e) => {
        const hint = document.getElementById('pc-strict-hint');
        if (hint)
            hint.textContent = e.target.checked
                ? t('plugins.strictOn') : t('plugins.strictOff');
    });
    // Click a mod id (available or selected list) to copy it — handy when hand-editing
    // a catalog or debugging a mod-list match.
    //
    // ONCE PER CONTAINER. renderCreate() replaces the container's innerHTML but the container
    // itself survives, so attaching a delegated listener to it on every visit stacked them:
    // the fourth time you opened the Create tab, one click fired four handlers and put four
    // identical "id copied" toasts on screen. The children are rebuilt and their listeners go
    // with them; a listener on the element that OUTLIVES the render has to be guarded.
    if (!container.dataset.pcIdCopyBound) {
        container.dataset.pcIdCopyBound = '1';
        container.addEventListener('click', (e) => {
            const idBtn = e.target.closest?.('.plug-mod-id[data-copy-id]');
            if (!idBtn)
                return;
            e.preventDefault();
            e.stopPropagation();
            navigator.clipboard?.writeText(idBtn.dataset.copyId).then(() => toast(t('plugins.idCopied') || 'Mod id copied', 'success'), () => toast(`${t('common.error')}`, 'error'));
        });
    }
    // Say it while it is being typed, not after Save. The note under the field turns into
    // the complaint, so there is one place to look rather than a toast that has gone by the
    // time you look up.
    {
        const idEl = container.querySelector('#pc-id');
        const note = container.querySelector('#pc-id-note');
        const good = t('plugins.createIdHint') || '';
        idEl?.addEventListener('input', () => {
            const v = idEl.value.trim();
            const bad = !!v && !isUsablePluginId(v);
            idEl.classList.toggle('is-bad', bad);
            if (note) {
                note.textContent = bad
                    ? (t('plugins.createIdBad') || 'That id will not work — letters, digits, - and . only.')
                    : good;
                note.classList.toggle('is-bad', bad);
            }
        });
    }
    function buildManifest() {
        const id = document.getElementById('pc-id')?.value.trim();
        const name = document.getElementById('pc-name')?.value.trim();
        if (!id || !name) {
            toast(t('plugins.createIdNameRequired'), 'warning');
            return null;
        }
        // Checked HERE as well as while typing: the note under the field is advice, and
        // advice is not a gate. An id with a slash or a space in it becomes a folder name,
        // a deeplink and a catalogue key, and it fails at each of those differently.
        if (!isUsablePluginId(id)) {
            toast(t('plugins.createIdBad') || 'That id will not work — letters, digits, - and . only.', 'warning', 7000);
            return null;
        }
        // Bundled files the user KEPT (existing minus staged removals). The backend
        // appends newly-picked files to these and deletes the removed ones.
        const keptScripts = _editScripts.filter(s => !_removedScripts.includes(s));
        const keptFolders = _editFolders.filter(f => !_removedFolders.includes(f));
        return {
            id, name,
            version: document.getElementById('pc-version')?.value.trim() || '1.0.0',
            author: document.getElementById('pc-author')?.value.trim() || '',
            description: document.getElementById('pc-desc')?.value.trim() || '',
            game: document.getElementById('pc-game')?.value.trim() || '',
            official: false,
            // Requested, not granted. The install screen pre-ticks these and the person
            // installing decides — which is the only reason it is safe to let an author
            // name them at all.
            permissions: Array.from(document.querySelectorAll('.pc-perm-cb:checked'))
                .map(cb => cb.dataset.perm || '').filter(Boolean),
            tags: (document.getElementById('pc-tags')?.value || '')
                .split(',').map(x => x.trim()).filter(Boolean),
            website: document.getElementById('pc-website')?.value.trim() || '',
            // Derived from what is actually in the box. It was ALSO derived from a toggle,
            // which could say yes when there was nothing — a plugin that warned about
            // scripts it did not have.
            has_scripts: keptScripts.length > 0 || scriptPaths.length > 0 || keptFolders.length > 0 || folderPaths.length > 0,
            scripts: keptScripts,
            folders: keptFolders,
            automations: _editAutomations.filter(a => !_removedAutomations.includes(a)),
            bundles: _editBundles.filter(b => !_removedBundles.includes(b)),
            apply_mode: document.getElementById('pc-apply-mode')?.value || 'modlist',
            modlist: {
                strict: document.getElementById('pc-strict')?.checked || false,
                // The map KEY is the mod id — carry it so matching survives a rename
                // (the backend prefers id, falls back to name).
                required_mods: Array.from(selectedMods.entries()).map(([mid, { name, optional }]) => ({ id: mid, name, optional, sha256: null })),
            },
        };
    }
    // Bundled files staged for removal — the backend physically deletes these on save.
    const removedBundledPayload = () => ({ scripts: _removedScripts.slice(), folders: _removedFolders.slice() });
    container.querySelector('#pc-save-local')?.addEventListener('click', async () => {
        const manifest = buildManifest();
        if (!manifest)
            return;
        try {
            const plugin = await invoke('create_local_plugin', {
                manifest,
                iconSrcPath: iconSrcPath || null,
                iconSvg: iconBuiltinSvg || null,
                scriptSrcPaths: scriptPaths.length ? scriptPaths : null,
                folderSrcPaths: folderPaths.length ? folderPaths : null,
                automationSrcPaths: automationPaths.length ? automationPaths : null,
                bundleSrcPaths: bundlePaths.length ? bundlePaths : null,
                removedBundled: removedBundledPayload(),
            });
            _installedPlugins = _installedPlugins.filter(p => p.manifest.id !== manifest.id);
            _installedPlugins.push(plugin);
            toast(t('plugins.createSaved', { name: manifest.name }), 'success');
        }
        catch (e) {
            toast(`${t('common.error')}: ${e}`, 'error');
        }
    });
    container.querySelector('#pc-export-bmmplug')?.addEventListener('click', async () => {
        const manifest = buildManifest();
        if (!manifest)
            return;
        const path = await saveFile({ defaultPath: `${manifest.id}.bmmplug`, filters: [{ name: 'BMM Plugin', extensions: ['bmmplug'] }] });
        if (!path)
            return;
        try {
            await invoke('create_local_plugin', {
                manifest,
                iconSrcPath: iconSrcPath || null,
                iconSvg: iconBuiltinSvg || null,
                scriptSrcPaths: scriptPaths.length ? scriptPaths : null,
                folderSrcPaths: folderPaths.length ? folderPaths : null,
                automationSrcPaths: automationPaths.length ? automationPaths : null,
                bundleSrcPaths: bundlePaths.length ? bundlePaths : null,
                removedBundled: removedBundledPayload(),
            });
            await invoke('export_plugin', { pluginId: manifest.id, destPath: path });
            toast(t('plugins.exportSuccess', { name: manifest.name }), 'success');
        }
        catch (e) {
            toast(`${t('common.error')}: ${e}`, 'error');
        }
    });
}
// ── Tab: API & Scripts ─────────────────────────────────────────────────────
function renderScripts(container) {
    // NOTE: the old QT_ENDPOINTS button grid was removed — the unified Quick Test
    // panel (setupUnifiedQuickTest) reads getEndpointDefs() directly, so there is a
    // single source of truth for endpoints. The documented endpoint list below also
    // comes from getEndpointDefs().
    container.innerHTML = `
        <div class="plug-scripts-root">

            <!-- Token -->
            <div class="plug-section-card plug-token-card">
                <div class="plug-token-card-top">
                    <h3 class="plug-section-title" style="margin:0;">${IC.lock} ${t('plugins.apiToken')}</h3>
                    <span class="plug-api-hint">${IC.info} ${t('plugins.apiHint')} <code id="plug-api-base-url" class="plug-api-url-copy" data-tooltip="${t('plugins.copyApiUrl')}">${apiBase()}/api/</code></span>
                </div>
                <div class="plug-token-row">
                    <form style="display:contents" autocomplete="off" data-no-submit="1"><input type="password" id="plug-token-display" class="input plug-token-input" readonly value="${escHtml(_apiToken)}"></form>
                    <button class="btn btn-xs btn-ghost" id="plug-token-eye" data-tooltip="${t('plugins.showToken')}">${IC.eye}</button>
                    <button class="btn btn-sm btn-ghost" id="plug-copy-token">${IC.copy} ${t('common.copy')}</button>
                    <button class="btn btn-sm btn-danger" id="plug-reset-token">${IC.refresh} ${t('plugins.resetToken')}</button>
                </div>
            </div>

            <!-- Quick test + endpoints (full width) -->
            <div class="plug-section-card">
                <h3 class="plug-section-title">${IC.zap} ${t('plugins.quickTest')}</h3>
                <p style="font-size:11px;color:var(--text-muted);margin:0 0 10px;">${t('plugins.quickTestIntro') || 'Pick an endpoint, fill the fields, then Run or copy the cURL. Every BMM action is here.'}</p>
                <!-- Unified single-panel quick test -->
                <div class="plug-uqt">
                    <div class="plug-uqt-anchor">
                        <button class="plug-uqt-select" id="plug-uqt-select" type="button">
                            <span id="plug-uqt-select-label">${t('plugins.qtSelectEndpoint') || 'Select an endpoint…'}</span>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                        </button>
                        <div class="plug-uqt-dropdown" id="plug-uqt-dropdown" style="display:none;">
                            <div class="plug-uqt-search-row">
                                <input type="text" id="plug-uqt-search"  placeholder="${t('plugins.quickTestSearch') || 'Search… (GET, /api/mods, modpack…)'}" spellcheck="false">
                            </div>
                            <div class="plug-uqt-list" id="plug-uqt-list"></div>
                        </div>
                    </div>
                    <div class="plug-uqt-form" id="plug-uqt-form"></div>
                </div>
                <div id="plug-qt-result" class="plug-qt-result" style="display:none;">
                    <div class="plug-qt-result-header">
                        <span id="plug-qt-status" class="plug-tester-status"></span>
                        <code id="plug-qt-path" class="plug-qt-path-label"></code>
                        <span style="flex:1;"></span>
                        <button class="btn btn-xs btn-ghost" id="plug-qt-copy" data-tooltip="${t('plugins.epCopy')}">${IC.copy}</button>
                    </div>
                    <pre id="plug-qt-body" class="plug-code-pre plug-qt-pre"></pre>
                </div>

                <details class="plug-details-section" id="plug-api-log" style="margin-top:12px;">
                    <summary class="plug-details-summary">${IC.list} ${t('plugins.apiActivityLog') || 'API activity log'}
                        <span class="plug-api-log-count" id="plug-api-log-count"></span>
                    </summary>
                    <div class="plug-api-log-toolbar">
                        <span class="plug-api-log-hint">${t('plugins.apiActivityLogHint') || 'Every call to the local API is recorded here (newest first).'}</span>
                        <button class="btn btn-xs btn-ghost" id="plug-api-log-clear">${IC.trash} ${t('common.clear') || 'Clear'}</button>
                    </div>
                    <div class="plug-api-log-list" id="plug-api-log-list"></div>
                </details>

                <details class="plug-details-section" id="plug-custom-tester" style="margin-top:12px;">
                    <summary class="plug-details-summary">${IC.terminal} ${t('plugins.customRequest')}</summary>
                    <div class="plug-tester">
                        <div class="plug-tester-row">
                            <select id="pt-method" class="select select-sm" style="width:80px;">
                                <option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option><option>PATCH</option>
                            </select>
                            <input type="text" id="pt-path" class="input input-sm" value="/api/health" style="flex:1;">
                            <button class="btn btn-sm btn-accent" id="pt-run">${IC.play} ${t('plugins.run')}</button>
                        </div>
                        <textarea id="pt-body" class="input plug-tester-body" placeholder="${(t('plugins.customBodyPlaceholder') || '{\"key\": \"value\"}  — POST only').replace(/"/g, '&quot;')}"></textarea>
                        <div class="plug-tester-resp" id="pt-response" style="display:none;">
                            <div class="plug-tester-resp-header">
                                <span id="pt-status-badge" class="plug-tester-status"></span>
                                <span style="flex:1;"></span>
                                <button class="btn btn-xs btn-ghost" id="pt-copy-resp" data-tooltip="${t('plugins.epCopy')}">${IC.copy}</button>
                            </div>
                            <pre id="pt-resp-body" class="plug-code-pre plug-qt-pre"></pre>
                        </div>
                    </div>
                </details>

                <h3 class="plug-section-title" style="margin-top:18px;">${IC.list} ${t('plugins.apiEndpoints')}</h3>
                <p style="font-size:11px;color:var(--text-muted);margin:0 0 8px;">${t('plugins.epHint')}</p>
                <div class="plug-qt-search-row">
                    <span class="plug-qt-search-ic">${IC.search || ''}</span>
                    <input type="text" id="plug-ep-search" class="input input-sm plug-qt-search-input"
                        placeholder="${t('plugins.endpointSearch') || 'Search endpoints… (GET, /api/mods, modpack…)'}" spellcheck="false">
                    <button class="btn btn-xs btn-ghost" id="plug-ep-search-clear" data-tooltip="${t('common.clear') || 'Clear'}" style="display:none;">${IC.x}</button>
                    <span class="plug-qt-search-count" id="plug-ep-search-count"></span>
                </div>
                <div class="plug-ep-collapse-bar">
                    <button class="btn btn-xs btn-ghost" id="plug-ep-expand-all">${t('plugins.epExpandAll') || 'Expand all'}</button>
                    <button class="btn btn-xs btn-ghost" id="plug-ep-collapse-all">${t('plugins.epCollapseAll') || 'Collapse all'}</button>
                </div>
                <div class="plug-endpoint-list" id="plug-ep-list">
                    ${epListHtml()}
                </div>

                <h3 class="plug-section-title plug-dl-foldhead" id="plug-dl-foldhead" role="button" tabindex="0" style="margin-top:18px;cursor:pointer;">
                    <svg class="plug-dl-fold-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                    ${IC.zap} ${t('plugins.deepLinks') || 'bmm:// Deep Links'}
                    <span class="plug-dl-fold-count">${getDeepLinkDefs().length}</span>
                </h3>
                <div id="plug-dl-fold-body">
                    <p style="font-size:11px;color:var(--text-muted);margin:0 0 8px;">${t('plugins.deepLinksHint') || 'Trigger BMM actions from any script, .bat or app by opening a bmm:// URL — no token needed. Click a row to expand.'}</p>
                    <div class="plug-qt-search-row">
                        <span class="plug-qt-search-ic">${IC.search || ''}</span>
                        <input type="text" id="plug-dl-search" class="input input-sm plug-qt-search-input"
                            placeholder="${t('plugins.deepLinkSearch') || 'Search deep links… (mod, theme, telemetry…)'}" spellcheck="false">
                        <button class="btn btn-xs btn-ghost" id="plug-dl-search-clear" data-tooltip="${t('common.clear') || 'Clear'}" style="display:none;">${IC.x}</button>
                        <span class="plug-qt-search-count" id="plug-dl-search-count"></span>
                    </div>
                    <div class="plug-ep-collapse-bar">
                        <button class="btn btn-xs btn-ghost" id="plug-dl-expand-all">${t('plugins.epExpandAll') || 'Expand all'}</button>
                        <button class="btn btn-xs btn-ghost" id="plug-dl-collapse-all">${t('plugins.epCollapseAll') || 'Collapse all'}</button>
                    </div>
                    <div class="plug-endpoint-list" id="plug-dl-list">
                        ${dlListHtml()}
                    </div>
                </div>
            </div>

            <!-- Script generator (full width) -->
            <div class="plug-section-card">
                <h3 class="plug-section-title">${IC.terminal} ${t('plugins.scriptGenerator')}</h3>
                <div class="plug-gen-two-col">
                    <div class="plug-gen-form">
                        <div class="plug-gen-row2">
                            <div class="plug-form-row">
                                <label class="plug-form-label">${t('plugins.genFormat')}</label>
                                <select id="plug-gen-format" class="select">
                                    <optgroup label="Windows">
                                        <option value="bat">.bat — Windows CMD</option>
                                        <option value="ps1">.ps1 — PowerShell</option>
                                        <option value="vbs">.vbs — VBScript</option>
                                    </optgroup>
                                    <optgroup label="BMM">
                                        <option value="bmms">.bmmscript — BMMScript (runs inside BMM)</option>
                                    </optgroup>
                                    <optgroup label="Scripting">
                                        <option value="py">.py — Python</option>
                                        <option value="lua">.lua — Lua</option>
                                        <option value="js">.js — Node.js</option>
                                        <option value="rb">.rb — Ruby</option>
                                        <option value="php">.php — PHP</option>
                                    </optgroup>
                                    <optgroup label="Compiled">
                                        <option value="go">.go — Go</option>
                                        <option value="java">.java — Java</option>
                                        <option value="cs">.cs — C#</option>
                                        <option value="rs">.rs — Rust</option>
                                    </optgroup>
                                </select>
                            </div>
                            <div class="plug-form-row">
                                <label class="plug-form-label">${t('plugins.genMode')}</label>
                                <select id="plug-gen-mode" class="select">
                                    <option value="deeplink">${t('plugins.genModeDeeplink')}</option>
                                    <option value="api">${t('plugins.genModeApi')}</option>
                                </select>
                                <p id="plug-mode-hint" class="plug-mode-hint-txt">${t('plugins.modeDeeplinkHint')}</p>
                            </div>
                        </div>
                        <div class="plug-form-row" style="flex-direction:row;align-items:center;gap:12px;">
                            <label class="plug-form-label" style="margin:0;">${t('plugins.genLaunchBmm')}</label>
                            <label class="plug-toggle">
                                <input type="checkbox" id="plug-gen-launch" checked>
                                <span class="plug-toggle-slider"></span>
                            </label>
                        </div>
                        <!-- Multi-profile context for the generator -->
                        <div class="plug-form-row" style="flex-direction:row;align-items:center;gap:12px;flex-wrap:wrap;">
                            <label class="plug-form-label" style="margin:0;white-space:nowrap;">${t('plugins.genMultiProfile') || 'Active profile'}</label>
                            <div class="profile-select-icon-wrap" style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;">
                                <span class="profile-icon-display" id="plug-gen-profile-icon" style="flex-shrink:0;"></span>
                                <select id="plug-gen-profile" class="select select-sm" style="flex:1;min-width:0;">
                                    <option value="">${t('plugins.genProfileAll') || '— Use each action’s own profile —'}</option>
                                </select>
                            </div>
                            <label class="plug-toggle" data-tooltip="${t('plugins.genMultiProfileTip') || 'Enable mods from a specific profile context for each API call'}">
                                <input type="checkbox" id="plug-gen-multi-profile">
                                <span class="plug-toggle-slider"></span>
                            </label>
                        </div>
                        <div class="plug-gen-actions-section">
                            <div class="plug-gen-actions-header">
                                <span class="plug-form-label" style="margin:0;">${t('plugins.genActions')}</span>
                                <button class="btn btn-xs btn-accent" id="plug-add-action">${IC.plus} ${t('plugins.addAction')}</button>
                            </div>
                            <div id="plug-actions-container" class="plug-actions-list"></div>
                        </div>
                        <div class="plug-gen-token-env-row">
                            <label class="plug-form-label" style="margin:0;white-space:nowrap;">${IC.lock} ${t('plugins.genTokenEnv')}</label>
                            <label class="plug-toggle" data-tooltip="${t('plugins.genTokenEnvTip')}">
                                <input type="checkbox" id="plug-gen-use-env">
                                <span class="plug-toggle-slider"></span>
                            </label>
                            <span id="plug-gen-token-hint" class="plug-mode-hint-txt" style="flex:1;">${t('plugins.genTokenEnvOff')}</span>
                        </div>
                        <div class="plug-gen-buttons">
                            <button class="btn btn-secondary" id="plug-gen-preview">${IC.eye} ${t('plugins.preview')}</button>
                            <button class="btn btn-ghost" id="plug-gen-save">${IC.save} ${t('plugins.saveScript')}</button>
                            <button class="btn btn-accent" id="plug-gen-zip">${IC.download} ${t('plugins.saveScriptZip')}</button>
                        </div>
                    </div>
                    <div class="plug-gen-output-col">
                        <div class="plug-gen-output-placeholder" id="plug-gen-placeholder">
                            <span>${IC.terminal}</span>
                            <p>${t('plugins.preview')}</p>
                        </div>
                        <div id="plug-gen-output" class="plug-gen-output" style="display:none;">
                            <div class="plug-gen-output-header">
                                <span class="plug-form-label" style="margin:0;">${t('plugins.preview')}</span>
                                <button class="btn btn-xs btn-ghost" id="plug-copy-script">${IC.copy} ${t('common.copy')}</button>
                            </div>
                            <pre id="plug-gen-code" class="plug-code-pre" style="overflow:auto;"></pre>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    // Token
    container.querySelector('#plug-token-eye')?.addEventListener('click', () => {
        const inp = document.getElementById('plug-token-display');
        inp.type = inp.type === 'password' ? 'text' : 'password';
    });
    container.querySelector('#plug-copy-token')?.addEventListener('click', async () => {
        await navigator.clipboard.writeText(_apiToken).catch(() => { });
        toast(t('plugins.tokenCopied'), 'success');
        dispatchBmmAction(BMM_ACTIONS.API_TOKEN_COPIED);
    });
    container.querySelector('#plug-reset-token')?.addEventListener('click', handleResetToken);
    // API base URL copy on click
    container.querySelector('#plug-api-base-url')?.addEventListener('click', async () => {
        await navigator.clipboard.writeText(apiBase() + '/api/').catch(() => { });
        toast(t('plugins.epCopyDone'), 'success');
    });
    // ── Unified Quick Test (single panel: pick endpoint → form → Run/cURL) ──────
    setupUnifiedQuickTest(container);
    container.querySelector('#plug-qt-copy')?.addEventListener('click', () => {
        const txt = document.getElementById('plug-qt-body')?.textContent || '';
        navigator.clipboard.writeText(txt).catch(() => { });
        toast(t('common.copy'), 'success');
    });
    // ── Available-endpoints search bar — filters the documented endpoint rows ──
    const epSearch = container.querySelector('#plug-ep-search');
    const epSearchClr = container.querySelector('#plug-ep-search-clear');
    const epCount = container.querySelector('#plug-ep-search-count');
    const epList = container.querySelector('#plug-ep-list');
    const applyEndpointFilter = () => {
        if (!epList)
            return;
        const q = (epSearch?.value || '').trim().toLowerCase();
        const rows = Array.from(epList.querySelectorAll('.plug-ep-wrap'));
        let shown = 0;
        rows.forEach(w => {
            const row = w.querySelector('.plug-endpoint-row');
            const method = row?.dataset.method || '';
            const path = row?.dataset.path || '';
            const desc = (w.querySelector('.plug-endpoint-desc')?.textContent || '');
            const hay = `${method} ${path} ${desc}`.toLowerCase();
            const match = !q || hay.includes(q);
            w.style.display = match ? '' : 'none';
            if (match)
                shown++;
        });
        // While searching, force every group open so matches across groups show.
        epList.querySelectorAll('.plug-ep-group').forEach(g => {
            if (q)
                g.classList.add('open', 'search-forced-open');
            else if (g.classList.contains('search-forced-open')) {
                g.classList.remove('open', 'search-forced-open');
            }
        });
        if (epSearchClr)
            epSearchClr.style.display = q ? '' : 'none';
        if (epCount)
            epCount.textContent = q ? `${shown}/${rows.length}` : '';
    };
    epSearch?.addEventListener('input', applyEndpointFilter);
    epSearchClr?.addEventListener('click', () => { if (epSearch) {
        epSearch.value = '';
        applyEndpointFilter();
        epSearch.focus();
    } });
    // ── Deep-link search bar — filters the documented bmm:// rows ──────────────
    const dlSearch = container.querySelector('#plug-dl-search');
    const dlSearchClr = container.querySelector('#plug-dl-search-clear');
    const dlCount = container.querySelector('#plug-dl-search-count');
    const dlList = container.querySelector('#plug-dl-list');
    const applyDeepLinkFilter = () => {
        if (!dlList)
            return;
        const q = (dlSearch?.value || '').trim().toLowerCase();
        const rows = Array.from(dlList.querySelectorAll('.plug-ep-wrap'));
        let shown = 0;
        rows.forEach(w => {
            const path = (w.querySelector('.plug-path')?.textContent || '');
            const desc = (w.querySelector('.plug-endpoint-desc')?.textContent || '');
            const match = !q || `${path} ${desc}`.toLowerCase().includes(q);
            w.style.display = match ? '' : 'none';
            if (match)
                shown++;
        });
        // A heading with nothing under it is worse than no heading: it reads as a group
        // whose rows failed to render. Hidden when its own rows are all filtered out.
        dlList.querySelectorAll('.plug-dl-group').forEach((h) => {
            const g = h.dataset.dlgrp || '';
            const any = rows.some((w) => w.dataset.dlgrp === g && w.style.display !== 'none');
            h.style.display = any ? '' : 'none';
        });
        if (dlSearchClr)
            dlSearchClr.style.display = q ? '' : 'none';
        if (dlCount)
            dlCount.textContent = q ? `${shown}/${rows.length}` : '';
    };
    dlSearch?.addEventListener('input', applyDeepLinkFilter);
    dlSearchClr?.addEventListener('click', () => { if (dlSearch) {
        dlSearch.value = '';
        applyDeepLinkFilter();
        dlSearch.focus();
    } });
    // ── Deep-link section fold (show all / none) + expand/collapse every row ───
    const dlFoldHead = container.querySelector('#plug-dl-foldhead');
    const dlFoldBody = container.querySelector('#plug-dl-fold-body');
    const toggleDlFold = () => {
        if (!dlFoldHead || !dlFoldBody)
            return;
        const folded = dlFoldHead.classList.toggle('folded');
        dlFoldBody.style.display = folded ? 'none' : '';
    };
    dlFoldHead?.addEventListener('click', toggleDlFold);
    dlFoldHead?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleDlFold();
    } });
    const setAllDlRows = (open) => {
        dlList?.querySelectorAll('.plug-ep-wrap').forEach(w => {
            const id = w.id.replace(/^epw-/, '');
            const detail = document.getElementById(`epd-${id}`);
            const chev = document.getElementById(`epchev-${id}`);
            w.classList.toggle('expanded', open);
            if (detail)
                detail.style.display = open ? 'grid' : 'none';
            if (chev)
                chev.classList.toggle('rotated', open);
        });
    };
    container.querySelector('#plug-dl-expand-all')?.addEventListener('click', () => setAllDlRows(true));
    container.querySelector('#plug-dl-collapse-all')?.addEventListener('click', () => setAllDlRows(false));
    // ── Collapsible endpoint method groups ──────────────────────────────────
    container.querySelectorAll('#plug-ep-list .plug-ep-group-header').forEach(h => {
        h.addEventListener('click', () => h.parentElement?.classList.toggle('open'));
        h.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                h.parentElement?.classList.toggle('open');
            }
        });
    });
    container.querySelector('#plug-ep-expand-all')?.addEventListener('click', () => container.querySelectorAll('#plug-ep-list .plug-ep-group').forEach(g => g.classList.add('open')));
    container.querySelector('#plug-ep-collapse-all')?.addEventListener('click', () => container.querySelectorAll('#plug-ep-list .plug-ep-group').forEach(g => g.classList.remove('open')));
    // ── API activity log panel — disk-backed, rendered incrementally ───────────
    // The full history is kept on disk (read_api_log / append_api_log). The panel
    // loads the last N on open and then PREPENDS one row per event (no full
    // re-render), capping the DOM so it never lags regardless of total volume.
    const apiLogList = container.querySelector('#plug-api-log-list');
    const apiLogCount = container.querySelector('#plug-api-log-count');
    const API_LOG_DOM_CAP = 200; // max rows kept in the DOM
    const API_LOG_LOAD = 100; // how many to load from disk on open
    const _rowHtml = (e) => {
        const time = e.time ? new Date(e.time).toLocaleTimeString() : '';
        const cls = e.ok ? 'ok' : 'err';
        const mc = String(e.method || '').toLowerCase();
        return `<div class="plug-api-log-row plug-api-log-${cls}">
            <span class="plug-api-log-time">${time}</span>
            <span class="plug-qt-method-badge plug-qt-${mc}">${escHtml(e.method || '')}</span>
            <span class="plug-api-log-ic">${e.icon || ''}</span>
            <span class="plug-api-log-label">${escHtml(e.label || e.path || '')}</span>
            <span class="plug-api-log-status">${escHtml(String(e.status ?? ''))}</span>
        </div>`;
    };
    const _setLogCount = () => {
        if (!apiLogList || !apiLogCount)
            return;
        const n = apiLogList.querySelectorAll('.plug-api-log-row').length;
        apiLogCount.textContent = n ? String(n) : '';
    };
    const _emptyLog = () => {
        if (apiLogList)
            apiLogList.innerHTML = `<div class="plug-api-log-empty">${t('plugins.apiActivityLogEmpty') || 'No API activity yet.'}</div>`;
        if (apiLogCount)
            apiLogCount.textContent = '';
    };
    // Load recent history from disk (newest first in the DOM).
    const loadApiLogFromDisk = async () => {
        if (!apiLogList)
            return;
        try {
            const lines = (await invoke('read_api_log', { limit: API_LOG_LOAD }));
            if (!lines || !lines.length) {
                _emptyLog();
                return;
            }
            const rows = lines.map(l => { try {
                return _rowHtml(JSON.parse(l));
            }
            catch {
                return '';
            } });
            apiLogList.innerHTML = rows.reverse().join('') || '';
            if (!apiLogList.querySelector('.plug-api-log-row'))
                _emptyLog();
            _setLogCount();
        }
        catch {
            _emptyLog();
        }
    };
    loadApiLogFromDisk();
    // Incremental: prepend the single new entry, then trim the DOM.
    const onApiActivity = (ev) => {
        if (!apiLogList)
            return;
        const e = ev.detail;
        if (!e)
            return;
        apiLogList.querySelector('.plug-api-log-empty')?.remove();
        apiLogList.insertAdjacentHTML('afterbegin', _rowHtml(e));
        const rows = apiLogList.querySelectorAll('.plug-api-log-row');
        for (let i = rows.length - 1; i >= API_LOG_DOM_CAP; i--)
            rows[i].remove();
        _setLogCount();
    };
    // Avoid handler accumulation across page re-renders.
    if (window.__bmmApiLogHandler)
        document.removeEventListener('bmm:api-activity', window.__bmmApiLogHandler);
    window.__bmmApiLogHandler = onApiActivity;
    document.addEventListener('bmm:api-activity', onApiActivity);
    container.querySelector('#plug-api-log-clear')?.addEventListener('click', async () => {
        window.__bmmApiLog = [];
        try {
            await invoke('clear_api_log');
        }
        catch { /* ignore */ }
        _emptyLog();
    });
    // Custom tester
    container.querySelector('#pt-run')?.addEventListener('click', handleApiTest);
    container.querySelector('#pt-copy-resp')?.addEventListener('click', () => {
        const txt = document.getElementById('pt-resp-body')?.textContent || '';
        navigator.clipboard.writeText(txt).catch(() => { });
        toast(t('common.copy'), 'success');
    });
    // Helper: prefill custom tester from endpoint
    function prefillTester(method, path) {
        const details = document.getElementById('plug-custom-tester');
        const methodSel = document.getElementById('pt-method');
        const pathInp = document.getElementById('pt-path');
        const bodyTa = document.getElementById('pt-body');
        if (details)
            details.open = true;
        methodSel.value = method;
        pathInp.value = path;
        const bodyHints = {
            // POST / PUT
            '/api/benchmark': '{\n  "dataset": "sandbox",\n  "size": "M",\n  "mode": "manual",\n  "sources": [],\n  "profiles": []\n}',
            '/api/telemetry/consent': '{\n  "enabled": true\n}',
            '/api/telemetry/settings': '{\n  "replay": true,\n  "full": false,\n  "bench": true\n}',
            '/api/recorder': '{\n  "on": true,\n  "full": false,\n  "rust": true,\n  "js": true\n}',
            '/api/replay/import': '{\n  "path": "",\n  "url": ""\n}',
            '/api/launchpack/run': '{\n  "id": ""\n}',
            '/api/schedule/run': '{\n  "id": ""\n}',
            '/api/discord/rpc': '{\n  "enabled": true\n}',
            '/api/data/export-auto': '{\n  "dir": "C:/BMM/Backups",\n  "name": "bmm-backup-{date}",\n  "increment": "paren"\n}',
            '/api/mods/enable': '{\n  "mod_id": ""\n}',
            '/api/mods/disable': '{\n  "mod_id": ""\n}',
            '/api/mods/:id': '{\n  "name": ""\n}',
            '/api/profiles/activate': '{\n  "profile_id": ""\n}',
            '/api/profiles': '{\n  "name": "",\n  "game_path": "",\n  "mods_path": "",\n  "backup_path": ""\n}',
            '/api/profiles/:id': '{\n  "name": ""\n}',
            '/api/plugins/compare': '{\n  "plugin_id": ""\n}',
            '/api/plugins/apply': '{\n  "plugin_id": "",\n  "force_strict": false\n}',
            '/api/modpacks/enable': '{\n  "modpack_id": ""\n}',
            '/api/modpacks/disable': '{\n  "modpack_id": ""\n}',
            '/api/modpacks/create': '{\n  "name": "",\n  "description": "",\n  "game_name": "",\n  "sr_link": "",\n  "multi_profile": false,\n  "skip_integrity_check": false,\n  "dependency_mode": "none",\n  "mod_ids": []\n}',
            '/api/modpacks/:id': '{\n  "name": "",\n  "description": "",\n  "game_name": "",\n  "sr_link": "",\n  "multi_profile": false,\n  "skip_integrity_check": false,\n  "dependency_mode": "none",\n  "mod_ids": []\n}',
            '/api/restart': '',
            '/api/repo/connect': '{\n  "url": "https://monserveur.com/repo.json",\n  "name": "Mon Serveur"\n}',
            // camelCase — Rust backend uses #[serde(rename_all = "camelCase")]
            '/api/repo/sync': '{\n  "url": "https://monserveur.com/repo.json",\n  "gameDir": "C:/Games/MonJeu",\n  "modsDir": "C:/Games/MonJeu/Mods",\n  "backupDir": "C:/BMM/Backups",\n  "choices": [{ "repoProfileId": "prof-uuid" }],\n  "overwriteAll": false,\n  "deleteExtra": false,\n  "downloadLimit": 0,\n  "password": "",\n  "unzipArchives": true\n}',
            '/api/repo/manifest': '{\n  "modsDir": "C:/host/mods",\n  "name": "Mon depot",\n  "author": "MonPseudo",\n  "filesBaseUrl": "https://monserveur.com/mods"\n}',
            '/api/repo/gen': '{\n  "profileIds": ["prof-uuid"],\n  "outputDir": "C:/BMM/Export",\n  "authorName": "MonPseudo",\n  "generateServer": false,\n  "zipOutput": false,\n  "zipMods": false,\n  "useCloudflare": false,\n  "useUpnp": false,\n  "useDocker": false,\n  "dockerOs": "linux",\n  "serverVersion": "std",\n  "autoStart": false,\n  "port": 8080,\n  "uploadLimit": 0,\n  "adminPassword": ""\n}',
            '/api/repo/host': '{\n  "serveDir": "C:/BMM/Export",\n  "port": 8080,\n  "uploadLimit": 0\n}',
            // DELETE routes that carry a body
            '/api/repo': '{\n  "url": "https://monserveur.com/repo.json"\n}',
        };
        // Show body hint if one exists (even for DELETE — some routes need a body)
        const hint = bodyHints[path];
        if (hint) {
            bodyTa.value = hint;
        }
        else if (method === 'GET' || method === 'DELETE') {
            bodyTa.value = '';
        }
        else {
            bodyTa.value = bodyHints[path] ?? '';
        }
        details.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        details.classList.add('plug-tester-highlight');
        setTimeout(() => details.classList.remove('plug-tester-highlight'), 900);
    }
    // ── Endpoint area click handler — stored to prevent accumulation on re-render ──
    if (_scriptClickHandler)
        container.removeEventListener('click', _scriptClickHandler);
    _scriptClickHandler = (e) => {
        const tgt = e.target;
        // Scroll arrow buttons for lang tabs
        const scrollBtn = tgt.closest('.plug-ep-scroll-btn');
        if (scrollBtn) {
            e.stopPropagation();
            const epid = scrollBtn.dataset.epid || '';
            const scrollEl = document.getElementById(`epls-${epid}`);
            if (scrollEl) {
                const dir = scrollBtn.dataset.scroll === 'left' ? -120 : 120;
                scrollEl.scrollBy({ left: dir, behavior: 'smooth' });
            }
            return;
        }
        // Prefill button → fill the custom tester form and scroll to it
        const prefillBtn = tgt.closest('.plug-ep-prefill-btn');
        if (prefillBtn) {
            e.stopPropagation();
            prefillTester(prefillBtn.dataset.method || 'GET', prefillBtn.dataset.path || '');
            return;
        }
        // Open a bmm:// deeplink (run it now, to test)
        const dlOpenBtn = tgt.closest('.plug-dl-open-btn');
        if (dlOpenBtn) {
            e.stopPropagation();
            const url = dlOpenBtn.dataset.url || '';
            if (url) {
                window.__bmmDeeplink?.(url);
                toast(t('plugins.deepLinkOpened') || 'Deep link triggered', 'info');
            }
            return;
        }
        // Copy URL button (handled by its own listener below)
        if (tgt.closest('.plug-ep-copy-btn'))
            return;
        // Copy response body button
        const copyRespBtn = tgt.closest('.plug-ep-copy-resp-btn');
        if (copyRespBtn) {
            e.stopPropagation();
            const body = copyRespBtn.dataset.body || '';
            navigator.clipboard.writeText(body).catch(() => { });
            toast(t('plugins.epCopyDone'), 'success');
            return;
        }
        // Copy code button
        const copyCodeBtn = tgt.closest('.plug-ep-copy-code-btn');
        if (copyCodeBtn) {
            e.stopPropagation();
            const epid = copyCodeBtn.dataset.epid || '';
            const pre = document.getElementById(`epc-${epid}`);
            const activeTab = copyCodeBtn.closest('.plug-ep-code-tabs')?.querySelector('.plug-ep-code-tab.active');
            const lang = activeTab?.dataset.lang || 'curl';
            const ep = _epCodeCache.get(epid);
            const rawText = ep ? (() => {
                const div = document.createElement('div');
                div.innerHTML = _genCode(ep, lang);
                return div.textContent || '';
            })() : (pre?.textContent || '');
            // For curl and ps1 → collapse multi-line to a single terminal-ready command
            const text = _toClipboardLine(rawText, lang);
            navigator.clipboard.writeText(text).catch(() => { });
            toast(t('plugins.epCopyDone'), 'success');
            return;
        }
        // Language tab switch
        const codeTab = tgt.closest('.plug-ep-code-tab');
        if (codeTab && codeTab.dataset.lang) {
            e.stopPropagation();
            const epid = codeTab.closest('.plug-ep-code-tabs')?.getAttribute('data-epid') || '';
            codeTab.closest('.plug-ep-lang-tabs-scroll')?.querySelectorAll('.plug-ep-code-tab').forEach(t2 => t2.classList.remove('active'));
            codeTab.classList.add('active');
            const lang = codeTab.dataset.lang;
            const pre = document.getElementById(`epc-${epid}`);
            if (pre) {
                const ep = _epCodeCache.get(epid);
                if (ep)
                    pre.innerHTML = _genCode(ep, lang);
            }
            return;
        }
        // Chevron or row → toggle expand
        const row = tgt.closest('.plug-endpoint-row');
        if (!row)
            return;
        const epId = row.dataset.epId || '';
        const wrap = document.getElementById(`epw-${epId}`);
        const detail = document.getElementById(`epd-${epId}`);
        const chev = document.getElementById(`epchev-${epId}`);
        if (!wrap || !detail)
            return;
        const isOpen = wrap.classList.contains('expanded');
        wrap.classList.toggle('expanded', !isOpen);
        detail.style.display = isOpen ? 'none' : 'grid';
        if (chev)
            chev.classList.toggle('rotated', !isOpen);
        // Show/hide scroll buttons based on actual overflow
        if (!isOpen) {
            requestAnimationFrame(() => {
                const scrollEl = document.getElementById(`epls-${epId}`);
                if (scrollEl) {
                    const overflows = scrollEl.scrollWidth > scrollEl.clientWidth + 2;
                    scrollEl.closest('.plug-ep-code-tabs')?.classList.toggle('tabs-overflow', overflows);
                }
            });
        }
    };
    container.addEventListener('click', _scriptClickHandler);
    // Wheel → horizontal scroll on lang tab strips
    container.addEventListener('wheel', (e) => {
        const scrollEl = e.target.closest('.plug-ep-lang-tabs-scroll');
        if (!scrollEl)
            return;
        e.preventDefault();
        scrollEl.scrollLeft += e.deltaY !== 0 ? e.deltaY : e.deltaX;
    }, { passive: false });
    // Endpoint URL copy buttons (url path copy OR bmm:// deeplink copy)
    container.querySelectorAll('.plug-ep-copy-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const val = btn.dataset.copy || '';
            // bmm:// deeplinks are copied as-is; API paths get the base URL prepended
            const full = val.startsWith('bmm://') ? val : `${apiBase()}${val}`;
            await navigator.clipboard.writeText(full).catch(() => { });
            toast(t('plugins.epCopyDone'), 'success');
        });
    });
    // Permission chips → click to copy the scope string
    container.querySelectorAll('.plug-perm-copy').forEach(chip => {
        chip.addEventListener('click', async (e) => {
            e.stopPropagation();
            const perm = chip.dataset.perm || (chip.textContent || '').trim();
            await navigator.clipboard.writeText(perm).catch(() => { });
            chip.classList.add('plug-perm-copied');
            setTimeout(() => chip.classList.remove('plug-perm-copied'), 700);
            toast(t('plugins.permCopied') || 'Permission copied', 'success', 1400);
        });
    });
    // Multi-profile selector: populate + wire icon
    const genProfileSel = container.querySelector('#plug-gen-profile');
    const genProfileIcon = document.getElementById('plug-gen-profile-icon');
    if (genProfileSel && _allProfiles.length) {
        fetchProfileIconPaths(_allProfiles).then(iconPaths => {
            _allProfiles.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                genProfileSel.appendChild(opt);
            });
            // When "— Use each action's own profile —" (empty value) is selected,
            // there is no profile to show → keep the icon slot empty (avoids a broken icon).
            const syncGenIcon = () => {
                if (!genProfileIcon)
                    return;
                if (!genProfileSel.value) {
                    genProfileIcon.innerHTML = '';
                    genProfileIcon.style.display = 'none';
                    return;
                }
                genProfileIcon.style.display = '';
                decorateProfileOptions(genProfileSel, _allProfiles, iconPaths);
                updateSelectProfileIcon(genProfileSel, _allProfiles, iconPaths, genProfileIcon);
            };
            syncGenIcon();
            genProfileSel.addEventListener('change', syncGenIcon);
        });
    }
    else if (genProfileIcon) {
        genProfileIcon.style.display = 'none';
    }
    // Mode hint update
    container.querySelector('#plug-gen-mode')?.addEventListener('change', (e) => {
        const mode = e.target.value;
        const hint = document.getElementById('plug-mode-hint');
        if (hint)
            hint.textContent = t(mode === 'api' ? 'plugins.modeApiHint' : 'plugins.modeDeeplinkHint');
    });
    // Token env toggle
    container.querySelector('#plug-gen-use-env')?.addEventListener('change', (e) => {
        const useEnv = e.target.checked;
        const hint = document.getElementById('plug-gen-token-hint');
        if (hint)
            hint.textContent = t(useEnv ? 'plugins.genTokenEnvOn' : 'plugins.genTokenEnvOff');
    });
    // Script gen
    container.querySelector('#plug-add-action')?.addEventListener('click', (e) => {
        _openActionPicker(e.currentTarget);
    });
    container.querySelector('#plug-gen-preview')?.addEventListener('click', handlePreviewScript);
    container.querySelector('#plug-gen-save')?.addEventListener('click', handleSaveScript);
    container.querySelector('#plug-gen-zip')?.addEventListener('click', handleSaveScriptZip);
    container.querySelector('#plug-copy-script')?.addEventListener('click', async () => {
        const codeEl = document.getElementById('plug-gen-code');
        const raw = codeEl?.dataset.raw || codeEl?.textContent || '';
        await navigator.clipboard.writeText(raw).catch(() => { });
        toast(t('common.copy'), 'success');
    });
    _actionDndInstalled = false; // container was re-rendered → re-arm DnD
    _ensureActionDnd();
    addActionRow();
}
// ── Code syntax highlighter (multi-language, placeholder-safe) ───────────
// Uses a placeholder approach: strings/comments are extracted first as \x00N\x00
// tokens so that keyword/URL regexes never accidentally match inside HTML attribute
// values added by earlier passes. Tokens are restored last as styled spans.
function hlCode(raw, lang) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let h = esc(raw);
    const slots = [];
    const slot = (html) => { const i = slots.length; slots.push(html); return `\x00${i}\x00`; };
    const unslot = (s) => s.replace(/\x00(\d+)\x00/g, (_, i) => slots[+i]);
    switch (lang) {
        case 'curl':
            // Strings first (protects quotes from being matched later)
            h = h.replace(/("(?:[^"\\]|\\.)*")/g, m => slot(`<span class="hlc-str">${m}</span>`));
            // Bare URLs not inside strings
            h = h.replace(/(https?:\/\/[^\s\x00"'\\)]+)/g, m => slot(`<span class="hlc-url">${m}</span>`));
            h = h.replace(/\b(curl)\b/g, '<span class="hlc-kw">$1</span>');
            h = h.replace(/(^|\s)(-X|-H|-d|-G|-L|-s|-S|-o|-v|-u|--data|--header)\b/g, '$1<span class="hlc-flag">$2</span>');
            h = h.replace(/(\$[A-Z_][A-Z0-9_]*)/g, '<span class="hlc-var">$1</span>');
            h = unslot(h);
            break;
        case 'ps1':
            h = h.replace(/(#[^\n]*)/g, m => slot(`<span class="hlc-comment">${m}</span>`));
            h = h.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, m => slot(`<span class="hlc-str">${m}</span>`));
            h = h.replace(/(https?:\/\/[^\s\x00"'\\)]+)/g, m => slot(`<span class="hlc-url">${m}</span>`));
            h = h.replace(/\b(Invoke-RestMethod|Invoke-WebRequest|ConvertTo-Json|Start-Process|Write-Host|param|function|if|else|foreach|while|return|try|catch|finally)\b/g, '<span class="hlc-kw">$1</span>');
            h = h.replace(/(^|\s)(-Uri|-Method|-Headers|-Body|-ContentType|-Bearer)\b/g, '$1<span class="hlc-flag">$2</span>');
            h = h.replace(/(\$[A-Za-z_][A-Za-z0-9_]*)/g, '<span class="hlc-var">$1</span>');
            h = unslot(h);
            break;
        case 'js':
            h = h.replace(/(\/\/[^\n]*)/g, m => slot(`<span class="hlc-comment">${m}</span>`));
            h = h.replace(/(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, m => slot(`<span class="hlc-str">${m}</span>`));
            h = h.replace(/\b(const|let|var|async|await|function|return|if|else|try|catch|for|while|new|class|import|from|export|default|true|false|null|undefined|typeof|instanceof)\b/g, '<span class="hlc-kw">$1</span>');
            h = h.replace(/\b(\d+)\b/g, '<span class="hlc-num">$1</span>');
            h = unslot(h);
            break;
        case 'python':
            h = h.replace(/(#[^\n]*)/g, m => slot(`<span class="hlc-comment">${m}</span>`));
            h = h.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, m => slot(`<span class="hlc-str">${m}</span>`));
            h = h.replace(/\b(import|from|def|class|return|if|elif|else|for|while|try|except|finally|with|as|True|False|None|print|async|await|and|or|not|in|is)\b/g, '<span class="hlc-kw">$1</span>');
            h = h.replace(/\b(\d+)\b/g, '<span class="hlc-num">$1</span>');
            h = unslot(h);
            break;
        case 'lua':
            h = h.replace(/(--[^\n]*)/g, m => slot(`<span class="hlc-comment">${m}</span>`));
            h = h.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, m => slot(`<span class="hlc-str">${m}</span>`));
            h = h.replace(/\b(local|require|function|return|if|then|else|elseif|end|for|while|do|repeat|until|true|false|nil|and|or|not|print)\b/g, '<span class="hlc-kw">$1</span>');
            h = h.replace(/\b(\d+)\b/g, '<span class="hlc-num">$1</span>');
            h = unslot(h);
            break;
        case 'go':
            h = h.replace(/(\/\/[^\n]*)/g, m => slot(`<span class="hlc-comment">${m}</span>`));
            h = h.replace(/(`(?:[^`])*`|"(?:[^"\\]|\\.)*")/g, m => slot(`<span class="hlc-str">${m}</span>`));
            h = h.replace(/\b(package|import|func|var|const|type|struct|interface|return|if|else|for|range|defer|go|chan|select|switch|case|default|break|continue|map|new|make|nil|true|false|fmt|http|io|bytes|errors)\b/g, '<span class="hlc-kw">$1</span>');
            h = h.replace(/\b(\d+)\b/g, '<span class="hlc-num">$1</span>');
            h = unslot(h);
            break;
        case 'rust':
            h = h.replace(/(\/\/[^\n]*)/g, m => slot(`<span class="hlc-comment">${m}</span>`));
            h = h.replace(/("(?:[^"\\]|\\.)*")/g, m => slot(`<span class="hlc-str">${m}</span>`));
            h = h.replace(/\b(use|let|mut|fn|async|await|pub|struct|impl|trait|enum|match|if|else|for|while|loop|return|Ok|Err|Some|None|true|false|println|reqwest|serde_json)\b/g, '<span class="hlc-kw">$1</span>');
            h = h.replace(/\b(\d+)\b/g, '<span class="hlc-num">$1</span>');
            h = unslot(h);
            break;
        case 'java':
            h = h.replace(/(\/\/[^\n]*)/g, m => slot(`<span class="hlc-comment">${m}</span>`));
            h = h.replace(/("(?:[^"\\]|\\.)*")/g, m => slot(`<span class="hlc-str">${m}</span>`));
            h = h.replace(/\b(import|public|private|class|void|static|new|return|if|else|try|catch|finally|for|while|String|var|HttpClient|HttpRequest|HttpResponse|URI|System|BodyHandlers|BodyPublishers)\b/g, '<span class="hlc-kw">$1</span>');
            h = h.replace(/\b(\d+)\b/g, '<span class="hlc-num">$1</span>');
            h = unslot(h);
            break;
        case 'cs':
            h = h.replace(/(\/\/[^\n]*)/g, m => slot(`<span class="hlc-comment">${m}</span>`));
            h = h.replace(/("(?:[^"\\]|\\.)*")/g, m => slot(`<span class="hlc-str">${m}</span>`));
            h = h.replace(/\b(using|var|new|await|async|string|bool|int|void|class|public|private|static|return|if|else|try|catch|Console|HttpClient|JsonContent|HttpResponseMessage)\b/g, '<span class="hlc-kw">$1</span>');
            h = h.replace(/\b(\d+)\b/g, '<span class="hlc-num">$1</span>');
            h = unslot(h);
            break;
        case 'php':
            h = h.replace(/(\/\/[^\n]*|#[^\n]*)/g, m => slot(`<span class="hlc-comment">${m}</span>`));
            h = h.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, m => slot(`<span class="hlc-str">${m}</span>`));
            h = h.replace(/\b(require|include|echo|print|return|if|else|foreach|while|function|class|new|true|false|null|curl_init|curl_setopt|curl_exec|json_encode|json_decode)\b/g, '<span class="hlc-kw">$1</span>');
            // $variables are not inside string slots, so this is safe
            h = h.replace(/(\$[A-Za-z_][A-Za-z0-9_]*)/g, '<span class="hlc-var">$1</span>');
            h = h.replace(/\b(\d+)\b/g, '<span class="hlc-num">$1</span>');
            h = unslot(h);
            break;
        case 'ruby':
            h = h.replace(/(#[^\n]*)/g, m => slot(`<span class="hlc-comment">${m}</span>`));
            h = h.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, m => slot(`<span class="hlc-str">${m}</span>`));
            h = h.replace(/\b(require|def|end|class|module|return|if|elsif|else|unless|while|until|do|for|in|begin|rescue|puts|print|true|false|nil|Net|URI|JSON)\b/g, '<span class="hlc-kw">$1</span>');
            h = h.replace(/\b(\d+)\b/g, '<span class="hlc-num">$1</span>');
            h = unslot(h);
            break;
    }
    return h;
}
// Generate code example for any language/endpoint combination
function _genCode(ep, lang) {
    const url = `${apiBase()}${ep.path}`;
    const isGet = ep.method === 'GET';
    const bodyObj = ep.fields
        ? Object.fromEntries(ep.fields.map(f => [f.name, f.type === 'boolean' ? false : f.type === 'number' ? 0 : '']))
        : {};
    const bodyJson = JSON.stringify(bodyObj, null, 2);
    const authToken = 'YOUR_TOKEN';
    let code = '';
    switch (lang) {
        case 'curl':
            code = _curlEx(ep);
            break;
        case 'ps1':
            code = _ps1Ex(ep);
            break;
        case 'js':
            if (isGet) {
                code = `const resp = await fetch("${url}"${ep.auth ? `,\n  { headers: { Authorization: "Bearer ${authToken}" } }` : ''});\nconst data = await resp.json();\nconsole.log(data);`;
            }
            else {
                code = `const resp = await fetch("${url}", {\n  method: "POST",\n  headers: {\n    "Content-Type": "application/json"${ep.auth ? `,\n    Authorization: "Bearer ${authToken}"` : ''}\n  },\n  body: JSON.stringify(${bodyJson})\n});\nconst data = await resp.json();\nconsole.log(data);`;
            }
            break;
        case 'python':
            if (isGet) {
                code = `import requests\n\n${ep.auth ? `headers = {"Authorization": "Bearer ${authToken}"}\n` : ''}resp = requests.get("${url}"${ep.auth ? ', headers=headers' : ''})\nprint(resp.json())`;
            }
            else {
                const pyBody = bodyJson.replace(/true/g, 'True').replace(/false/g, 'False').replace(/null/g, 'None');
                code = `import requests\n\nbody = ${pyBody}\nheaders = {"Content-Type": "application/json"${ep.auth ? `, "Authorization": "Bearer ${authToken}"` : ''}}\nresp = requests.post("${url}", json=body, headers=headers)\nprint(resp.json())`;
            }
            break;
        case 'lua':
            if (isGet) {
                code = `local http = require("socket.http")\nlocal body, code = http.request("${url}")\nprint(code, body)`;
            }
            else {
                code = `local http  = require("socket.http")\nlocal ltn12 = require("ltn12")\nlocal payload = '${bodyJson.replace(/\n/g, '').replace(/'/g, "\\'")}'
local t = {}\nhttp.request({\n  url    = "${url}",\n  method = "POST",\n  headers = {\n    ["Content-Type"] = "application/json"${ep.auth ? `,\n    Authorization = "Bearer ${authToken}"` : ''},\n    ["Content-Length"] = #payload\n  },\n  source = ltn12.source.string(payload),\n  sink   = ltn12.sink.table(t)\n})\nprint(table.concat(t))`;
            }
            break;
        case 'go':
            if (isGet) {
                code = `resp, _ := http.Get("${url}")\ndefer resp.Body.Close()\nbody, _ := io.ReadAll(resp.Body)\nfmt.Println(string(body))`;
            }
            else {
                code = `payload := []byte(\`${bodyJson}\`)\nreq, _ := http.NewRequest("POST", "${url}", bytes.NewBuffer(payload))\nreq.Header.Set("Content-Type", "application/json")${ep.auth ? `\nreq.Header.Set("Authorization", "Bearer ${authToken}")` : ''}\nclient := &http.Client{}\nresp, _ := client.Do(req)\nbody, _ := io.ReadAll(resp.Body)\nfmt.Println(string(body))`;
            }
            break;
        case 'rust':
            if (isGet) {
                code = `let resp = reqwest::get("${url}").await?;\nlet json: serde_json::Value = resp.json().await?;\nprintln!("{:#?}", json);`;
            }
            else {
                code = `let client = reqwest::Client::new();\nlet resp = client.post("${url}")\n    .header("Content-Type", "application/json")${ep.auth ? `\n    .bearer_auth("${authToken}")` : ''}\n    .json(&serde_json::json!(${bodyJson}))\n    .send().await?;\nprintln!("{}", resp.text().await?);`;
            }
            break;
        case 'java':
            if (isGet) {
                code = `HttpClient client = HttpClient.newHttpClient();\nHttpRequest req = HttpRequest.newBuilder()\n    .uri(URI.create("${url}"))${ep.auth ? `\n    .header("Authorization", "Bearer ${authToken}")` : ''}\n    .GET().build();\nHttpResponse<String> resp =\n    client.send(req, BodyHandlers.ofString());\nSystem.out.println(resp.body());`;
            }
            else {
                const jBody = bodyJson.replace(/"/g, '\\"').replace(/\n/g, '\\n');
                code = `HttpClient client = HttpClient.newHttpClient();\nString body = "${jBody}";\nHttpRequest req = HttpRequest.newBuilder()\n    .uri(URI.create("${url}"))\n    .header("Content-Type", "application/json")${ep.auth ? `\n    .header("Authorization", "Bearer ${authToken}")` : ''}\n    .POST(BodyPublishers.ofString(body))\n    .build();\nHttpResponse<String> resp =\n    client.send(req, BodyHandlers.ofString());\nSystem.out.println(resp.body());`;
            }
            break;
        case 'cs':
            if (isGet) {
                code = `using var client = new HttpClient();\n${ep.auth ? `client.DefaultRequestHeaders.Add(\n    "Authorization", "Bearer ${authToken}");\n` : ''}var resp = await client.GetStringAsync(\n    "${url}");\nConsole.WriteLine(resp);`;
            }
            else {
                const fields = ep.fields?.map(f => `${f.name} = ${f.type === 'boolean' ? 'false' : f.type === 'number' ? '0' : '""'}`).join(', ') || '';
                code = `using var client = new HttpClient();\n${ep.auth ? `client.DefaultRequestHeaders.Add(\n    "Authorization", "Bearer ${authToken}");\n` : ''}var body = JsonContent.Create(new { ${fields} });\nvar resp = await client.PostAsync(\n    "${url}", body);\nConsole.WriteLine(\n    await resp.Content.ReadAsStringAsync());`;
            }
            break;
        case 'php':
            if (isGet) {
                code = `<?php\n$ch = curl_init("${url}");\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);${ep.auth ? `\ncurl_setopt($ch, CURLOPT_HTTPHEADER,\n    ["Authorization: Bearer ${authToken}"]);` : ''}\n$resp = curl_exec($ch);\necho $resp;`;
            }
            else {
                code = `<?php\n$body = json_encode(${JSON.stringify(bodyObj)});\n$ch = curl_init("${url}");\ncurl_setopt($ch, CURLOPT_POST, true);\ncurl_setopt($ch, CURLOPT_POSTFIELDS, $body);\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\ncurl_setopt($ch, CURLOPT_HTTPHEADER, [\n    "Content-Type: application/json"${ep.auth ? `,\n    "Authorization: Bearer ${authToken}"` : ''}\n]);\n$resp = curl_exec($ch);\necho $resp;`;
            }
            break;
        case 'ruby':
            if (isGet) {
                code = `require "net/http"\n\nuri = URI("${url}")\nreq = Net::HTTP::Get.new(uri)${ep.auth ? `\nreq["Authorization"] = "Bearer ${authToken}"` : ''}\nputs Net::HTTP.start(uri.host, uri.port) { |h|\n  h.request(req).body\n}`;
            }
            else {
                code = `require "net/http"\nrequire "json"\n\nuri = URI("${url}")\nreq = Net::HTTP::Post.new(uri)\nreq["Content-Type"] = "application/json"${ep.auth ? `\nreq["Authorization"] = "Bearer ${authToken}"` : ''}\nreq.body = ${JSON.stringify(bodyObj)}.to_json\nputs Net::HTTP.start(uri.host, uri.port) { |h|\n  h.request(req).body\n}`;
            }
            break;
        default: code = _curlEx(ep);
    }
    return hlCode(code, lang);
}
function _curlEx(ep) {
    const url = `${apiBase()}${ep.path}`;
    const authH = ep.auth ? `\n  -H "Authorization: Bearer $TOKEN" \\` : '';
    if (ep.method === 'GET') {
        return `curl${ep.auth ? ` \\\n  -H "Authorization: Bearer $TOKEN"` : ''} \\\n  "${url}"`;
    }
    const body = ep.fields
        ? JSON.stringify(Object.fromEntries(ep.fields.map(f => [f.name, f.type === 'boolean' ? false : f.type === 'number' ? 0 : ''])), null, 2)
        : '{}';
    return `curl -X POST \\\n  -H "Content-Type: application/json" \\${authH}\n  -d '${body}' \\\n  "${url}"`;
}
function _ps1Ex(ep) {
    const url = `${apiBase()}${ep.path}`;
    // Compact body (single line) so it pastes cleanly
    const bodyObj = ep.fields
        ? Object.fromEntries(ep.fields.map(f => [f.name, f.type === 'boolean' ? false : f.type === 'number' ? 0 : '']))
        : {};
    const bodyJson = JSON.stringify(bodyObj);
    // PS1 line-continuation is backtick ` (not backslash)
    if (ep.method === 'GET') {
        const authPart = ep.auth ? ` \`\n  -Headers @{ Authorization = "Bearer $TOKEN" }` : '';
        return `Invoke-RestMethod \`\n  -Uri "${url}"${authPart} \`\n  -Method GET`;
    }
    const authPart = ep.auth
        ? ` \`\n  -Headers @{ Authorization = "Bearer $TOKEN"; "Content-Type" = "application/json" }`
        : ` \`\n  -Headers @{ "Content-Type" = "application/json" }`;
    return `Invoke-RestMethod \`\n  -Uri "${url}" \`\n  -Method POST${authPart} \`\n  -Body '${bodyJson}'`;
}
/** Strip line-continuation chars so the copied command works on one line in a terminal. */
function _toClipboardLine(text, lang) {
    // Goal: produce a single-line command that pastes straight into a
    // terminal and runs.  Handles both the line-continuation char (`\`,
    // backtick, or `^`) AND any leftover bare newlines inside arguments
    // (e.g. a pretty-printed JSON body).
    const collapse = (s, contChar) => {
        let out = s;
        if (contChar) {
            // " \\<nl><indent>" → single space (eats the continuation token)
            out = out.replace(contChar, ' ');
        }
        // Any remaining newline + indent (newline-only continuations,
        // or newlines inside a quoted multi-line argument) → single space
        out = out.replace(/\r?\n\s*/g, ' ');
        // Collapse runs of spaces
        out = out.replace(/ {2,}/g, ' ').trim();
        return out;
    };
    if (lang === 'curl' || lang === 'bash' || lang === 'sh') {
        return collapse(text, / \\\r?\n\s*/g);
    }
    if (lang === 'ps1' || lang === 'powershell') {
        return collapse(text, / `\r?\n\s*/g);
    }
    if (lang === 'cmd' || lang === 'bat') {
        return collapse(text, / \^\r?\n\s*/g);
    }
    // Generic fallback — still single-line
    return collapse(text, null);
}
function buildEndpointRow(ep) {
    const methodCls = {
        GET: 'plug-method-get', POST: 'plug-method-post',
        PUT: 'plug-method-put', DELETE: 'plug-method-delete', PATCH: 'plug-method-patch',
    };
    const cls = methodCls[ep.method] || 'plug-method-get';
    const safeId = (ep.method.toLowerCase() + '_' + ep.path).replace(/\//g, '_').replace(/^_/, '').replace(/:/g, '');
    // For permission/app/catalog endpoints, show the available permission chips
    // The SAME list the permission screen draws. Two copies had already drifted: this one
    // named app.read and catalog.read, the screen did not offer them, and neither mentioned
    // the thirteen scopes the router had gained.
    const PERM_GROUPS = permDomains().map(d => ({ g: d.domain, c: d.color, perms: d.scopes }));
    const showsPerms = ep.path === '/api/apps/permissions/:id' && ep.method === 'PUT';
    const permChipsHtml = showsPerms ? `
        <div class="plug-ep-perms" style="margin:10px 0;padding:11px 13px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.07);border-radius:9px;">
            <div class="plug-ep-section-lbl" style="margin-bottom:8px;">${t('plugins.epAvailablePerms') || 'Available permissions'}</div>
            ${PERM_GROUPS.map(grp => `
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;flex-wrap:wrap;">
                <span style="font-size:9px;font-weight:800;color:${grp.c};text-transform:uppercase;letter-spacing:.6px;min-width:62px;">${grp.g}</span>
                ${grp.perms.map(pm => `<code class="plug-perm-copy" data-perm="${pm}" data-tooltip="${t('plugins.clickToCopy') || 'Click to copy'}" style="font-size:10px;color:${grp.c};background:${grp.c}1a;border:1px solid ${grp.c}33;padding:2px 7px;border-radius:5px;cursor:pointer;">${pm}</code>`).join('')}
              </div>`).join('')}
        </div>` : '';
    const fieldsHtml = ep.fields ? `
        <div class="plug-ep-fields">
            <div class="plug-ep-section-lbl">${t('plugins.epRequestBody')}</div>
            <table class="plug-ep-fields-table">
                <colgroup><col class="col-field"><col class="col-type"><col class="col-req"><col class="col-desc"></colgroup>
                <thead><tr><th>Field</th><th>Type</th><th></th><th>Description</th></tr></thead>
                <tbody>
                    ${ep.fields.map(f => `<tr>
                        <td style="white-space:nowrap;min-width:80px;"><code class="plug-ep-fname" data-tooltip="${escHtml(f.name)}">${escHtml(f.name)}</code></td>
                        <td style="white-space:nowrap;"><span class="plug-type-tag plug-type-${f.type}">${f.type}</span></td>
                        <td style="text-align:center;">${f.required ? '<span class="plug-req-star">*</span>' : '<span style="color:var(--text-muted)">—</span>'}</td>
                        <td class="plug-ep-fdesc">${escHtml(f.desc)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>` : '';
    const statusesHtml = ep.responseStatuses.map(s => {
        const scls = s.code < 300 ? 'plug-resp-ok' : s.code < 400 ? 'plug-resp-warn' : 'plug-resp-err';
        const codeNote = s.code === 200 ? t('plugins.epRespNoteOk')
            : s.code === 401 ? t('plugins.epRespNote401')
                : s.code === 404 ? t('plugins.epRespNote404')
                    : s.code === 400 ? t('plugins.epRespNote400')
                        : '';
        return `<details class="plug-ep-resp-item">
            <summary>
                <span class="plug-resp-code ${scls}">${s.code}</span>
                <span class="plug-resp-label">${escHtml(s.label)}</span>
                ${codeNote ? `<span class="plug-resp-note">${codeNote}</span>` : ''}
                <button class="btn btn-xs btn-ghost plug-ep-copy-resp-btn" data-body="${escHtml(s.body)}" data-tooltip="${t('plugins.epCopy')}" style="margin-left:auto;">${IC.copy}</button>
            </summary>
            <pre class="plug-ep-resp-body plug-code-pre">${hlJson(s.body)}</pre>
        </details>`;
    }).join('');
    const curlRaw = _curlEx(ep);
    const ps1Raw = _ps1Ex(ep);
    const authNote = ep.auth
        ? `<span class="plug-ep-auth-note">${IC.lock} ${t('plugins.epAuthNote')}</span>`
        : `<span class="plug-ep-noauth-note">${IC.checkCircle} ${t('plugins.epNoAuthNote')}</span>`;
    // ── bmm:// deeplink equivalent (if one exists) ─────────────────────────
    const ENDPOINT_TO_DL = {
        'POST /api/mods/enable': 'bmm://mod/enable?id=<mod_id>',
        'POST /api/mods/disable': 'bmm://mod/disable?id=<mod_id>',
        'POST /api/profiles/activate': 'bmm://profile/activate?id=<profile_id>',
        'POST /api/plugins/apply': 'bmm://plugin/activate?id=<plugin_id>',
        'POST /api/plugins/compare': 'bmm://plugin/compare?id=<plugin_id>',
        'POST /api/modpacks/enable': 'bmm://modpack/enable?id=<modpack_id>',
        'POST /api/modpacks/disable': 'bmm://modpack/disable?id=<modpack_id>',
        'POST /api/repo/connect': 'bmm://repo/connect?url=<repo_url>',
        'POST /api/repo/sync': 'bmm://repo/sync?url=<repo_url>&profile=<repo_profile_id>',
        'POST /api/repo/gen': 'bmm://repo/gen',
        'POST /api/repo/update': 'bmm://repo/update?dir=<repoDir>',
        'POST /api/mod/check-updates': 'bmm://mod/check-updates',
        'POST /api/mod/update': 'bmm://mod/update?url=<repo_url>',
        'POST /api/benchmark': 'bmm://benchmark/run?dataset=<sandbox|real>&size=<S|M|L|XL|CUSTOM>&mb=<mb>&mode=<manual|auto>&profiles=<id1;id2>&sources=<path1;path2>',
        'POST /api/repo/host': 'bmm://repo/host?dir=<serveDir>&port=<port>',
        'POST /api/apps/install': 'bmm://app/install?id=<id>&url=<url>&type=<fileType>&title=<title>',
        'POST /api/apps/launch': 'bmm://app/launch?id=<id>&exe=<exePath>',
        'POST /api/modpacks/create': 'bmm://modpack/create?name=<name>&profile=<profile_id>',
        'POST /api/language/import': 'bmm://language/import?path=<file>',
        'POST /api/restart': 'bmm://restart',
        'POST /api/telemetry/consent': 'bmm://telemetry/consent?enabled=<1|0>',
        'POST /api/telemetry/settings': 'bmm://telemetry/set?replay=<1|0>&full=<1|0>&bench=<1|0>',
        'POST /api/recorder': 'bmm://recorder/set?on=<1|0>&full=<1|0>&rust=<1|0>&js=<1|0>',
        'POST /api/replay/export': 'bmm://replay/export',
        'POST /api/replay/import': 'bmm://replay/import?path=<file>&url=<downloadUrl>',
        'POST /api/launchpack/run': 'bmm://launchpack/run?id=<launchpack_id>',
        'POST /api/schedule/run': 'bmm://schedule/run?id=<task_id>',
        'POST /api/discord/rpc': 'bmm://discord/rpc?enabled=<1|0>',
        'POST /api/data/export-auto': 'bmm://data/export-auto?dir=<folder>&name=<template>&increment=<paren|underscore|timestamp|overwrite>',
        // Every other endpoint is reachable via the generic passthrough:
        //   bmm://api?method=<M>&path=<path>&<field>=<value>…
    };
    const dlEquiv = ENDPOINT_TO_DL[`${ep.method} ${ep.path}`];
    const dlBadge = dlEquiv
        ? `<span class="plug-ep-dl-badge" data-tooltip="Équivalent bmm:// : ${dlEquiv}"
               style="font-size:9px;padding:1px 6px;border-radius:4px;background:rgba(139,92,246,0.12);color:color-mix(in srgb, var(--bmm-purple) 70%, var(--bmm-text-primary));border:1px solid rgba(139,92,246,0.2);white-space:nowrap;font-weight:700;cursor:default;user-select:none;">bmm://</span>`
        : '';
    const dlInfoHtml = dlEquiv
        ? `<div class="plug-ep-dl-info" style="display:flex;align-items:center;gap:8px;padding:8px 12px;margin-top:6px;background:rgba(139,92,246,0.06);border:1px solid rgba(139,92,246,0.18);border-radius:8px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" style="flex-shrink:0"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                <span style="font-size:11px;color:var(--text-secondary);white-space:nowrap;flex-shrink:0;">Équivalent deeplink :</span>
                <code class="plug-ep-copy-btn" data-copy="${escHtml(dlEquiv)}" data-tooltip="${t('plugins.copyDeeplink') || 'Click to copy'}" style="flex:1;font-size:11px;color:color-mix(in srgb, var(--bmm-purple) 70%, var(--bmm-text-primary));background:rgba(139,92,246,0.12);padding:2px 8px;border-radius:4px;cursor:pointer;user-select:all;white-space:normal;word-break:break-all;min-width:0;" tabindex="0">${escHtml(dlEquiv)}</code>
                <button class="btn btn-xs plug-ep-copy-btn" data-copy="${escHtml(dlEquiv)}" data-tooltip="${t('common.copy') || 'Copy'}" style="flex-shrink:0;padding:3px 7px;background:rgba(139,92,246,0.15);color:color-mix(in srgb, var(--bmm-purple) 70%, var(--bmm-text-primary));border:1px solid rgba(139,92,246,0.25);border-radius:5px;">${IC.copy}</button>
           </div>`
        : '';
    return `
        <div class="plug-ep-wrap" id="epw-${safeId}">
            <div class="plug-endpoint-row" data-method="${ep.method}" data-path="${ep.path}" data-ep-id="${safeId}">
                <button class="plug-ep-chevron" id="epchev-${safeId}" aria-label="expand" data-tooltip="${t('plugins.epExpandTip')}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <span class="plug-method ${cls}">${ep.method}</span>
                <code class="plug-path">${ep.path}</code>
                ${dlBadge}
                <span class="plug-endpoint-desc">${ep.desc}</span>
                <div class="plug-ep-row-actions">
                    <button class="btn btn-xs btn-ghost plug-ep-prefill-btn" data-method="${ep.method}" data-path="${ep.path}" data-tooltip="${t('plugins.epPrefillTip') || 'Pre-fill the custom request'}">${IC.terminal}</button>
                    <button class="btn btn-xs btn-ghost plug-ep-copy-btn" data-copy="${ep.path}" data-tooltip="${t('plugins.epCopy')}">${IC.copy}</button>
                    <span class="plug-auth-slot">${ep.auth ? `<span class="plug-auth-badge" data-tooltip="${t('plugins.requiresToken')}">${IC.lock}</span>` : ''}</span>
                </div>
            </div>
            <div class="plug-ep-detail plug-ep-swagger" id="epd-${safeId}" style="display:none;">
                <div class="plug-ep-swagger-left">
                    <p class="plug-ep-about">${ep.about}</p>
                    ${permChipsHtml}
                    ${authNote}
                    ${dlInfoHtml}
                    ${fieldsHtml}
                </div>
                <div class="plug-ep-swagger-right">
                    <div class="plug-ep-code-notice">${t('plugins.epCodeNotice')}</div>
                    <div class="plug-ep-code-tabs" data-epid="${safeId}">
                        <div class="plug-ep-lang-tabs-scroll" id="epls-${safeId}">
                            <button class="plug-ep-code-tab active" data-lang="curl">cURL</button>
                            <button class="plug-ep-code-tab" data-lang="ps1">PS1</button>
                        </div>
                        <button class="btn btn-xs btn-ghost plug-ep-copy-code-btn" data-epid="${safeId}" data-tooltip="${t('plugins.epCopy')}">${IC.copy}</button>
                    </div>
                    <pre class="plug-ep-code-block" id="epc-${safeId}">${hlCode(curlRaw, 'curl')}</pre>
                    <div class="plug-ep-responses">
                        <div class="plug-ep-section-lbl">${t('plugins.epResponses')}</div>
                        ${statusesHtml}
                    </div>
                </div>
            </div>
        </div>`;
}
function getDeepLinkDefs() {
    return [
        {
            scheme: 'mod/enable',
            params: [{ name: 'id', required: true, desc: t('plugins.dl.mod_enable.p.id') }],
            desc: t('plugins.dl.mod_enable.d'),
            about: t('plugins.dl.mod_enable.a'),
            example: 'bmm://mod/enable?id=my-mod-folder',
        },
        {
            scheme: 'mod/disable',
            params: [{ name: 'id', required: true, desc: t('plugins.dl.mod_disable.p.id') }],
            desc: t('plugins.dl.mod_disable.d'),
            about: t('plugins.dl.mod_disable.a'),
            example: 'bmm://mod/disable?id=my-mod-folder',
        },
        {
            scheme: 'profile/activate',
            params: [{ name: 'id', required: true, desc: t('plugins.dl.profile_activate.p.id') }],
            desc: t('plugins.dl.profile_activate.d'),
            about: t('plugins.dl.profile_activate.a'),
            example: 'bmm://profile/activate?id=prof-uuid',
        },
        {
            scheme: 'plugin/activate',
            params: [{ name: 'id', required: true, desc: t('plugins.dl.plugin_activate.p.id') }],
            desc: t('plugins.dl.plugin_activate.d'),
            about: t('plugins.dl.plugin_activate.a'),
            example: 'bmm://plugin/activate?id=my-server-pack',
        },
        {
            scheme: 'plugin/compare',
            params: [{ name: 'id', required: true, desc: t('plugins.dl.plugin_compare.p.id') }],
            desc: t('plugins.dl.plugin_compare.d'),
            about: t('plugins.dl.plugin_compare.a'),
            example: 'bmm://plugin/compare?id=my-server-pack',
        },
        {
            scheme: 'plugin/delete',
            params: [{ name: 'id', required: true, desc: t('plugins.dl.plugin_delete.p.id') }],
            desc: t('plugins.dl.plugin_delete.d'),
            about: t('plugins.dl.plugin_delete.a'),
            example: 'bmm://plugin/delete?id=my-server-pack',
        },
        {
            scheme: 'modpack/enable',
            params: [{ name: 'id', required: true, desc: t('plugins.dl.modpack_enable.p.id') }],
            desc: t('plugins.dl.modpack_enable.d'),
            about: t('plugins.dl.modpack_enable.a'),
            example: 'bmm://modpack/enable?id=modpack-uuid',
        },
        {
            scheme: 'modpack/disable',
            params: [{ name: 'id', required: true, desc: t('plugins.dl.modpack_disable.p.id') }],
            desc: t('plugins.dl.modpack_disable.d'),
            about: t('plugins.dl.modpack_disable.a'),
            example: 'bmm://modpack/disable?id=modpack-uuid',
        },
        {
            scheme: 'install',
            params: [
                { name: 'url', required: true, desc: t('plugins.dl.install.p.url') },
                { name: 'name', required: false, desc: t('plugins.dl.install.p.name') },
            ],
            desc: t('plugins.dl.install.d'),
            about: t('plugins.dl.install.a'),
            example: 'bmm://install?url=https://example.com/mod.zip&name=MyMod',
        },
        // ── Server Repo ──────────────────────────────────────────────────────
        {
            scheme: 'repo/connect',
            params: [
                { name: 'url', required: true, desc: t('plugins.dl.repo_connect.p.url') },
                { name: 'name', required: false, desc: t('plugins.dl.repo_connect.p.name') },
            ],
            desc: t('plugins.dl.repo_connect.d'),
            about: t('plugins.dl.repo_connect.a'),
            example: 'bmm://repo/connect?url=https://monserveur.com/repo.json&name=Mon+Serveur',
        },
        {
            scheme: 'repo/sync',
            params: [
                { name: 'url', required: true, desc: t('plugins.dl.repo_sync.p.url') },
                { name: 'profile', required: true, desc: t('plugins.dl.repo_sync.p.profile') },
                // The PARAMETER keeps its name. `game_dir` is the wire contract every
                // existing script, deeplink and scheduled task already sends; renaming it
                // to match a UI label would break all of them, silently. Only the prose
                // follows the app.
                { name: 'game_dir', required: false, desc: t('plugins.apiGameDirDesc') },
                { name: 'mods_dir', required: false, desc: t('plugins.dl.repo_sync.p.mods_dir') },
                { name: 'backup_dir', required: false, desc: t('plugins.dl.repo_sync.p.backup_dir') },
                { name: 'local_profile', required: false, desc: t('plugins.dl.repo_sync.p.local_profile') },
                { name: 'password', required: false, desc: t('plugins.dl.repo_sync.p.password') },
            ],
            desc: t('plugins.dl.repo_sync.d'),
            about: t('plugins.dl.repo_sync.a'),
            example: 'bmm://repo/sync?url=https://monserveur.com/repo.json&profile=prof-uuid&mods_dir=C:/Mods&password=secret',
        },
        {
            scheme: 'view/open',
            params: [
                { name: 'id', required: true, desc: t('plugins.dl.viewId') },
            ],
            desc: t('plugins.dl.viewDesc'),
            about: t('plugins.dl.viewAbout'),
            example: 'bmm://view/open?id=repo',
        },
        {
            scheme: 'schedule/enable',
            params: [
                { name: 'id', required: true, desc: t('plugins.dl.schedId') },
                { name: 'on', required: false, desc: t('plugins.dl.schedOn') },
            ],
            desc: t('plugins.dl.schedDesc'),
            about: t('plugins.dl.schedAbout'),
            example: 'bmm://schedule/enable?id=sched-1712345678901&on=0',
        },
        {
            scheme: 'catalog/follow',
            params: [
                { name: 'type', required: true, desc: t('plugins.dl.catType') },
                { name: 'url', required: true, desc: t('plugins.dl.catUrl') },
                { name: 'password', required: false, desc: t('plugins.dl.catPw') },
            ],
            desc: t('plugins.dl.catDesc'),
            about: t('plugins.dl.catAbout'),
            example: 'bmm://catalog/follow?type=plugin&url=https://exemple.org/catalog.json',
        },
        {
            scheme: 'repo/publish-ssh',
            params: [
                { name: 'dir', required: true, desc: t('plugins.dl.sshDir') },
            ],
            desc: t('plugins.dl.sshDesc'),
            about: t('plugins.dl.sshAbout'),
            example: 'bmm://repo/publish-ssh?dir=D:/repos/dcs',
        },
        {
            scheme: 'hook',
            params: [
                { name: 'name', required: true, desc: t('plugins.dl.hookName') },
            ],
            desc: t('plugins.dl.hookDesc'),
            about: t('plugins.dl.hookAbout'),
            example: 'bmm://hook?name=avant-lancement',
        },
        {
            scheme: 'download',
            params: [
                { name: 'url', required: true, desc: t('plugins.dl.download.p.url') },
                { name: 'name', required: false, desc: t('plugins.dl.download.p.name') },
            ],
            desc: t('plugins.dl.download.d'),
            about: t('plugins.dl.download.a'),
            example: 'bmm://download?url=https://exemple.com/mon-mod.zip&name=Mon%20Mod',
        },
        {
            scheme: 'import',
            params: [
                { name: 'url', required: true, desc: t('plugins.dl.import.p.url') },
                { name: 'name', required: false, desc: t('plugins.dl.import.p.name') },
            ],
            desc: t('plugins.dl.import.d'),
            about: t('plugins.dl.import.a'),
            example: 'bmm://import?url=https://exemple.com/mon-mod.zip',
        },
        {
            scheme: 'benchmark/open',
            params: [
                { name: 'dataset', required: false, desc: t('plugins.dl.benchmark_open.p.dataset') },
                { name: 'size', required: false, desc: t('plugins.dl.benchmark_open.p.size') },
                { name: 'mb', required: false, desc: t('plugins.dl.benchmark_open.p.mb') },
            ],
            desc: t('plugins.dl.benchmark_open.d'),
            about: t('plugins.dl.benchmark_open.a'),
            example: 'bmm://benchmark/open?dataset=sandbox&size=L',
        },
        {
            scheme: 'theme/import-inline',
            params: [
                { name: 'data', required: true, desc: t('plugins.dl.theme_import_inline.p.data') },
            ],
            desc: t('plugins.dl.theme_import_inline.d'),
            about: t('plugins.dl.theme_import_inline.a'),
            example: 'bmm://theme/import-inline?data=<base64>',
        },
        {
            scheme: 'language/import-inline',
            params: [
                { name: 'data', required: true, desc: t('plugins.dl.language_import_inline.p.data') },
                { name: 'code', required: false, desc: t('plugins.dl.language_import_inline.p.code') },
                { name: 'gz', required: false, desc: t('plugins.dl.language_import_inline.p.gz') },
            ],
            desc: t('plugins.dl.language_import_inline.d'),
            about: t('plugins.dl.language_import_inline.a'),
            example: 'bmm://language/import-inline?code=fr-QC&gz=1&data=<base64>',
        },
        {
            scheme: 'settings/navbar',
            params: [
                { name: 'code', required: true, desc: t('plugins.dl.settings_navbar.p.code') },
            ],
            desc: t('plugins.dl.settings_navbar.d'),
            about: t('plugins.dl.settings_navbar.a'),
            example: 'bmm://settings/navbar?code=<code>',
        },
        {
            scheme: 'repo/gen',
            params: [],
            desc: t('plugins.dl.repo_gen.d'),
            about: t('plugins.dl.repo_gen.a'),
            example: 'bmm://repo/gen',
        },
        {
            scheme: 'repo/update',
            params: [{ name: 'dir', required: false, desc: t('plugins.dl.repo_update.p.dir') }],
            desc: t('plugins.dl.repo_update.d'),
            about: t('plugins.dl.repo_update.a'),
            example: 'bmm://repo/update?dir=C:/BMM/MyRepo',
        },
        {
            scheme: 'repo/host',
            params: [
                { name: 'dir', required: false, desc: t('plugins.dl.repo_host.p.dir') },
                { name: 'port', required: false, desc: t('plugins.dl.repo_host.p.port') },
            ],
            desc: t('plugins.dl.repo_host.d'),
            about: t('plugins.dl.repo_host.a'),
            example: 'bmm://repo/host?dir=C:/BMM/Export&port=8080',
        },
        // ── Mods : mises à jour ──────────────────────────────────────────────
        {
            scheme: 'mod/check-updates',
            params: [],
            desc: t('plugins.dl.mod_check_updates.d'),
            about: t('plugins.dl.mod_check_updates.a'),
            example: 'bmm://mod/check-updates',
        },
        {
            scheme: 'mod/update',
            params: [{ name: 'url', required: false, desc: t('plugins.dl.mod_update.p.url') }],
            desc: t('plugins.dl.mod_update.d'),
            about: t('plugins.dl.mod_update.a'),
            example: 'bmm://mod/update?url=https://monserveur.com/repo.json',
        },
        // ── Modpacks ─────────────────────────────────────────────────────────
        {
            scheme: 'modpack/create',
            params: [
                { name: 'name', required: true, desc: t('plugins.dl.modpack_create.p.name') },
                { name: 'profile', required: false, desc: t('plugins.dl.modpack_create.p.profile') },
            ],
            desc: t('plugins.dl.modpack_create.d'),
            about: t('plugins.dl.modpack_create.a'),
            example: 'bmm://modpack/create?name=MyPack&profile=prof-uuid',
        },
        // ── App Catalog ──────────────────────────────────────────────────────
        {
            scheme: 'app/install',
            params: [
                { name: 'id', required: true, desc: t('plugins.dl.app_install.p.id') },
                { name: 'url', required: true, desc: t('plugins.dl.app_install.p.url') },
                { name: 'title', required: false, desc: t('plugins.dl.app_install.p.title') },
                { name: 'type', required: false, desc: t('plugins.dl.app_install.p.type') },
                { name: 'path', required: false, desc: t('plugins.dl.app_install.p.path') },
            ],
            desc: t('plugins.dl.app_install.d'),
            about: t('plugins.dl.app_install.a'),
            example: 'bmm://app/install?id=my-app&url=https://example.com/app.exe&title=My+App',
        },
        {
            scheme: 'app/launch',
            params: [
                { name: 'id', required: true, desc: t('plugins.dl.app_launch.p.id') },
                { name: 'exe', required: true, desc: t('plugins.dl.app_launch.p.exe') },
            ],
            desc: t('plugins.dl.app_launch.d'),
            about: t('plugins.dl.app_launch.a'),
            example: 'bmm://app/launch?id=my-app&exe=C:/Apps/MyApp/app.exe',
        },
        // ── Langue / interface ───────────────────────────────────────────────
        {
            scheme: 'language/import',
            params: [{ name: 'path', required: false, desc: t('plugins.dl.language_import.p.path') }],
            desc: t('plugins.dl.language_import.d'),
            about: t('plugins.dl.language_import.a'),
            example: 'bmm://language/import?path=C:/BMM/de.json',
        },
        {
            scheme: 'settings/layout',
            params: [{ name: 'code', required: true, desc: t('plugins.dl.settings_layout.p.code') }],
            desc: t('plugins.dl.settings_layout.d'),
            about: t('plugins.dl.settings_layout.a'),
            example: 'bmm://settings/layout?code=AbC123',
        },
        {
            scheme: 'restart',
            params: [],
            desc: t('plugins.dl.restart.d'),
            about: t('plugins.dl.restart.a'),
            example: 'bmm://restart',
        },
        // ── Thèmes ───────────────────────────────────────────────────────────
        {
            scheme: 'theme/apply',
            params: [{ name: 'id', required: true, desc: t('plugins.dl.theme_apply.p.id') }],
            desc: t('plugins.dl.theme_apply.d'),
            about: t('plugins.dl.theme_apply.a'),
            example: 'bmm://theme/apply?id=bmm-void',
        },
        {
            scheme: 'theme/import',
            params: [{ name: 'url', required: true, desc: t('plugins.dl.theme_import.p.url') }],
            desc: t('plugins.dl.theme_import.d'),
            about: t('plugins.dl.theme_import.a'),
            example: 'bmm://theme/import?url=https://example.com/cool.bmmtheme.json',
        },
        {
            scheme: 'theme/editor',
            params: [],
            desc: t('plugins.dl.theme_editor.d'),
            about: t('plugins.dl.theme_editor.a'),
            example: 'bmm://theme/editor',
        },
        {
            scheme: 'docs/open',
            params: [{ name: 'article', required: false, desc: t('plugins.dl.docs_open.p.article') }],
            desc: t('plugins.dl.docs_open.d'),
            about: t('plugins.dl.docs_open.a'),
            example: 'bmm://docs/open?article=conflicts',
        },
        // ── Automatisation / exécution ───────────────────────────────────────
        {
            scheme: 'schedule/run',
            params: [{ name: 'id', required: true, desc: t('plugins.dl.schedule_run.p.id') }],
            desc: t('plugins.dl.schedule_run.d'),
            about: t('plugins.dl.schedule_run.a'),
            example: 'bmm://schedule/run?id=task-uuid',
        },
        {
            scheme: 'launchpack/run',
            params: [{ name: 'id', required: true, desc: t('plugins.dl.launchpack_run.p.id') }],
            desc: t('plugins.dl.launchpack_run.d'),
            about: t('plugins.dl.launchpack_run.a'),
            example: 'bmm://launchpack/run?id=lp-uuid',
        },
        {
            scheme: 'benchmark/run',
            params: [
                { name: 'dataset', required: false, desc: t('plugins.dl.benchmark_run.p.dataset') },
                { name: 'size', required: false, desc: t('plugins.dl.benchmark_run.p.size') },
                { name: 'mb', required: false, desc: t('plugins.dl.benchmark_run.p.mb') },
                { name: 'mode', required: false, desc: t('plugins.dl.benchmark_run.p.mode') },
                { name: 'sources', required: false, desc: t('plugins.dl.benchmark_run.p.sources') },
                { name: 'profiles', required: false, desc: t('plugins.dl.benchmark_run.p.profiles') },
            ],
            desc: t('plugins.dl.benchmark_run.d'),
            about: t('plugins.dl.benchmark_run.a'),
            example: 'bmm://benchmark/run?dataset=sandbox&size=M&mode=auto',
        },
        // ── Confidentialité / enregistreur ───────────────────────────────────
        {
            scheme: 'telemetry/consent',
            params: [{ name: 'enabled', required: true, desc: t('plugins.dl.telemetry_consent.p.enabled') }],
            desc: t('plugins.dl.telemetry_consent.d'),
            about: t('plugins.dl.telemetry_consent.a'),
            example: 'bmm://telemetry/consent?enabled=1',
        },
        {
            scheme: 'telemetry/set',
            params: [
                { name: 'replay', required: false, desc: t('plugins.dl.telemetry_set.p.replay') },
                { name: 'full', required: false, desc: t('plugins.dl.telemetry_set.p.full') },
                { name: 'bench', required: false, desc: t('plugins.dl.telemetry_set.p.bench') },
            ],
            desc: t('plugins.dl.telemetry_set.d'),
            about: t('plugins.dl.telemetry_set.a'),
            example: 'bmm://telemetry/set?replay=1&full=0&bench=1',
        },
        {
            scheme: 'recorder/set',
            params: [
                { name: 'on', required: false, desc: t('plugins.dl.recorder_set.p.on') },
                { name: 'full', required: false, desc: t('plugins.dl.recorder_set.p.full') },
                { name: 'rust', required: false, desc: t('plugins.dl.recorder_set.p.rust') },
                { name: 'js', required: false, desc: t('plugins.dl.recorder_set.p.js') },
            ],
            desc: t('plugins.dl.recorder_set.d'),
            about: t('plugins.dl.recorder_set.a'),
            example: 'bmm://recorder/set?on=1&full=0&rust=1&js=1',
        },
        {
            scheme: 'replay/export',
            params: [],
            desc: t('plugins.dl.replay_export.d'),
            about: t('plugins.dl.replay_export.a'),
            example: 'bmm://replay/export',
        },
        {
            scheme: 'replay/import',
            params: [
                { name: 'path', required: false, desc: t('plugins.dl.replay_import.p.path') },
                { name: 'url', required: false, desc: t('plugins.dl.replay_import.p.url') },
            ],
            desc: t('plugins.dl.replay_import.d'),
            about: t('plugins.dl.replay_import.a'),
            example: 'bmm://replay/import?path=C:/BMM/session.bmmreplay',
        },
        {
            scheme: 'discord/rpc',
            params: [{ name: 'enabled', required: true, desc: t('plugins.dl.discord_rpc.p.enabled') }],
            desc: t('plugins.dl.discord_rpc.d'),
            about: t('plugins.dl.discord_rpc.a'),
            example: 'bmm://discord/rpc?enabled=1',
        },
        {
            scheme: 'data/export-auto',
            params: [
                { name: 'dir', required: true, desc: t('plugins.dl.data_export_auto.p.dir') },
                { name: 'name', required: false, desc: t('plugins.dl.data_export_auto.p.name') },
                { name: 'increment', required: false, desc: t('plugins.dl.data_export_auto.p.increment') },
            ],
            desc: t('plugins.dl.data_export_auto.d'),
            about: t('plugins.dl.data_export_auto.a'),
            example: 'bmm://data/export-auto?dir=C:/BMM/Backups&name=bmm-backup-{date}&increment=paren',
        },
        // ── Passe-plat API générique ─────────────────────────────────────────
        {
            scheme: 'api',
            params: [
                { name: 'method', required: false, desc: t('plugins.dl.api.p.method') },
                { name: 'path', required: true, desc: t('plugins.dl.api.p.path') },
                { name: '…', required: false, desc: t('plugins.dl.api.p.rest') },
            ],
            desc: t('plugins.dl.api.d'),
            about: t('plugins.dl.api.a'),
            example: 'bmm://api?method=POST&path=/api/mods/enable&mod_id=my-mod',
        },
    ];
}
function buildDeepLinkRow(dl) {
    // Mirror buildEndpointRow's wrapper structure (epw-/epd-/epchev- + data-ep-id)
    // so the shared expand/collapse + search handlers work for deeplink rows too.
    const safeId = 'dl_' + dl.scheme.replace(/\//g, '_');
    const fullUrl = `bmm://${dl.scheme}`;
    // i18n: prefer plugins.dl.<scheme>.{desc,about}; t() returns the key on miss, so
    // detect that and fall back to the inline (French) text shipped in the def.
    const trDl = (suffix, fb) => { const k = 'plugins.dl.' + dl.scheme + suffix; const v = t(k); return v === k ? fb : v; };
    const desc = trDl('.desc', dl.desc);
    const about = trDl('.about', dl.about);
    const paramsHtml = dl.params.length ? `
        <div class="plug-ep-fields" style="margin-top:10px;">
            <div class="plug-ep-section-lbl">${t('plugins.dlParams') || 'URL parameters (query string)'}</div>
            <table class="plug-ep-fields-table">
                <colgroup><col class="col-field"><col class="col-type"><col class="col-req"><col class="col-desc"></colgroup>
                <thead><tr><th>${t('plugins.epParam') || 'Parameter'}</th><th>Type</th><th></th><th>Description</th></tr></thead>
                <tbody>
                    ${dl.params.map(p => `<tr>
                        <td style="white-space:nowrap;min-width:80px;"><code class="plug-ep-fname">${escHtml(p.name)}</code></td>
                        <td><span class="plug-type-tag plug-type-string">string</span></td>
                        <td style="text-align:center;">${p.required ? '<span class="plug-req-star">*</span>' : '<span style="color:var(--text-muted)">—</span>'}</td>
                        <td class="plug-ep-fdesc">${escHtml(p.desc)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>` : '';
    // Structure/template of the deeplink: shows exactly which query params can be
    // passed (placeholders), so users see "what to put" — not just one example.
    const requiredParams = dl.params.filter(p => p.required).map(p => `${p.name}=<${p.name}>`);
    const optionalParams = dl.params.filter(p => !p.required).map(p => `${p.name}=<${p.name}>`);
    const template = dl.params.length
        ? `${fullUrl}?${[...requiredParams, ...optionalParams].join('&')}`
        : fullUrl;
    const batExample = `REM ${desc}\nstart "" "${dl.example}"`;
    const ps1Example = `# ${desc}\nStart-Process "${dl.example}"`;
    // Pull the "Équivalent à <METHOD> /api/..." mention out of the about text so we
    // can show it as a clean, dedicated line in the docs.
    const apiEq = (about.match(/\b(GET|POST|PUT|DELETE)\s+\/api\/[^\s.,;]+/) || [])[0] || '';
    return `
        <div class="plug-ep-wrap plug-dl-wrap" id="epw-${safeId}" data-dlgrp="${escAttr(dlGroupOf(dl.scheme).g)}">
            <div class="plug-endpoint-row plug-dl-row" data-method="DL" data-path="${escHtml(fullUrl)}" data-ep-id="${safeId}">
                <button class="plug-ep-chevron" id="epchev-${safeId}" aria-label="expand">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <span class="plug-method plug-dl-badge">bmm://</span>
                <code class="plug-path plug-dl-path">${escHtml(dl.scheme)}</code>
                <span class="plug-endpoint-desc">${escHtml(desc)}</span>
                <div class="plug-ep-row-actions">
                    <button class="btn btn-xs btn-ghost plug-ep-copy-btn" data-copy="${escHtml(dl.example)}" data-tooltip="${t('plugins.copyUrl') || 'Copy URL'}">${IC.copy}</button>
                </div>
            </div>
            <div class="plug-ep-detail plug-ep-swagger" id="epd-${safeId}" style="display:none;">
                <div class="plug-ep-swagger-left">
                    <p class="plug-ep-about">${escHtml(about)}</p>
                    <div class="plug-ep-section-lbl">${t('plugins.dlTemplate') || 'URL template (click to copy)'}</div>
                    <code class="plug-ep-copy-btn plug-dl-fullurl" data-copy="${escHtml(template)}" tabindex="0">${escHtml(template)}</code>
                    <div class="plug-ep-section-lbl" style="margin-top:6px;">${t('plugins.dlFullUrl') || 'Example (click to copy)'}</div>
                    <code class="plug-ep-copy-btn plug-dl-fullurl" data-copy="${escHtml(dl.example)}" tabindex="0">${escHtml(dl.example)}</code>
                    ${apiEq ? `<div class="plug-dl-apieq">${t('plugins.dlApiEquiv') || 'API equivalent'}: <code>${escHtml(apiEq)}</code></div>` : ''}
                    ${paramsHtml}
                    <p class="plug-dl-note">${t('plugins.dlNoAuthNote') || 'No token required — deep links are triggered through the running BMM window.'}</p>
                </div>
                <div class="plug-ep-swagger-right">
                    <div class="plug-ep-section-lbl">${t('plugins.exampleBat') || 'Example .bat'}</div>
                    <pre class="plug-ep-code-block" style="margin-bottom:8px;">${escHtml(batExample)}</pre>
                    <div class="plug-ep-section-lbl">${t('plugins.examplePs1') || 'Example PowerShell'}</div>
                    <pre class="plug-ep-code-block">${escHtml(ps1Example)}</pre>
                </div>
            </div>
        </div>`;
}
function getEndpointDefs() {
    const e401 = { code: 401, label: 'Unauthorized', body: '{ "error": "Unauthorized" }' };
    const e404 = { code: 404, label: 'Not Found', body: '{ "error": "Not found" }' };
    const e400 = { code: 400, label: 'Bad Request', body: '{ "error": "Invalid or missing fields" }' };
    const e500 = { code: 500, label: 'Server Error', body: '{ "error": "Internal server error" }' };
    return [
        // ── System ──────────────────────────────────────────────────────────
        {
            method: 'GET', path: '/api/health', auth: false,
            desc: t('plugins.endpointHealth'), about: 'Sonde légère de disponibilité — aucune authentification requise. Utilise cet endpoint pour vérifier que le serveur API BMM est démarré et accessible.',
            fields: null,
            responseStatuses: [{ code: 200, label: 'OK', body: `{ "ok": true, "service": "BMM Plugin API", "port": ${new URL(apiBase()).port} }` }],
        },
        {
            method: 'GET', path: '/api/status', auth: false,
            desc: t('plugins.endpointStatus'), about: 'Retourne la version de l\'application, le profil actif, et les compteurs agrégés de mods, profils et plugins.',
            fields: null,
            responseStatuses: [{ code: 200, label: 'OK', body: '{ "ok": true, "version": "1.2.0", "active_profile": { "id": "abc", "name": "DCS World" }, "mod_count": 42, "profile_count": 3, "plugin_count": 1 }' }],
        },
        {
            method: 'GET', path: '/api/check-update', auth: false,
            desc: t('plugins.endpointCheckUpdate'),
            about: t('plugins.epAbout.checkUpdate'),
            fields: null,
            responseStatuses: [{ code: 200, label: 'OK', body: '{ "ok": true, "has_update": true, "current_version": "1.2.0", "latest_version": "1.3.0", "release_url": "https://github.com/FreeProject089/BetterModsManager/releases/latest" }' }],
        },
        {
            method: 'POST', path: '/api/restart', auth: true,
            desc: t('plugins.endpointRestart'),
            about: t('plugins.epAbout.restart'),
            fields: null,
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "message": "Restarting..." }' },
                e401,
            ],
        },
        // ── Mods ────────────────────────────────────────────────────────────
        {
            method: 'GET', path: '/api/mods', auth: false,
            desc: t('plugins.endpointMods'), about: 'Retourne tous les mods visibles dans le profil actif, incluant leur état activé/actif et le chemin du dossier.',
            fields: null,
            responseStatuses: [{ code: 200, label: 'OK', body: '{ "ok": true, "data": [{ "id": "mod-uuid", "name": "MyMod", "active": true, "enabled": true, "path": "C:/mods/MyMod" }] }' }],
        },
        {
            method: 'GET', path: '/api/mods/active', auth: false,
            desc: t('plugins.endpointModsActive'), about: 'Raccourci pour lister uniquement les mods activés dans le profil actif.',
            fields: null,
            responseStatuses: [{ code: 200, label: 'OK', body: '{ "ok": true, "data": [{ "id": "mod-uuid", "name": "MyMod", "active": true }] }' }],
        },
        {
            method: 'GET', path: '/api/mods/all', auth: false,
            desc: t('plugins.endpointModsAll') || 'List every mod (all profiles)',
            about: 'Returns every mod across <strong>all profiles</strong>, grouped by profile, with a global total. Unlike <code>GET /api/mods</code> (active profile only), this covers your entire library. No authentication required.',
            fields: null,
            responseStatuses: [
                { code: 200, label: 'OK', body: '{\n  "ok": true,\n  "total_mods": 42,\n  "profiles": [\n    { "profile_id": "abc", "profile_name": "DCS World", "mod_count": 12, "mods": [ { "id": "...", "name": "...", "version": "1.0", "enabled": true } ] }\n  ]\n}' },
            ],
        },
        {
            method: 'GET', path: '/api/data', auth: true,
            desc: t('plugins.endpointDataDump') || 'Export all BMM data (data.json)',
            about: 'Returns the <strong>complete BMM data file</strong> (<code>data.json</code>) — every profile, mod, modpack, plugin, setting, tag, etc. Served with <code>Content-Disposition: attachment</code> as <code>bmm-data.json</code>. This is the full machine-readable backup; use it to inspect or replicate a BMM state programmatically. Requires a token.',
            fields: null,
            responseStatuses: [
                { code: 200, label: 'OK (JSON file)', body: '{ "profiles": [...], "mods": [...], "modpacks": [...], "settings": {...}, "plugin_permissions": {...}, ... }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/mods/enable', auth: true,
            desc: t('plugins.endpointEnableMod'), about: 'Active un mod unique par son ID. S\'applique au profil actuellement actif.',
            fields: [{ name: 'mod_id', type: 'string', required: true, desc: 'UUID du mod à activer (utilise GET /api/mods pour trouver les IDs).' }],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "mod_id": "mod-uuid" }' },
                e401, e404,
            ],
        },
        {
            method: 'POST', path: '/api/mods/disable', auth: true,
            desc: t('plugins.endpointDisableMod'), about: 'Désactive un mod unique par son ID. S\'applique au profil actuellement actif.',
            fields: [{ name: 'mod_id', type: 'string', required: true, desc: 'UUID du mod à désactiver.' }],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "mod_id": "mod-uuid" }' },
                e401, e404,
            ],
        },
        {
            method: 'PUT', path: '/api/mods/:id', auth: true,
            desc: t('plugins.endpointUpdateMod'),
            about: t('plugins.epAbout.modPatch'),
            fields: [
                { name: 'name', type: 'string', required: false, desc: 'Nouveau nom affiché dans l\'interface.' },
                { name: 'version', type: 'string', required: false, desc: 'Chaîne de version, ex : "1.2.3".' },
                { name: 'author', type: 'string', required: false, desc: 'Nom de l\'auteur ou du créateur.' },
                { name: 'description', type: 'string', required: false, desc: 'Description courte affichée dans les détails du mod.' },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "mod": { "id": "mod-uuid", "name": "Updated Name" } }' },
                e400, e401, e404,
            ],
        },
        {
            method: 'DELETE', path: '/api/mods/:id', auth: true,
            desc: t('plugins.endpointDeleteMod'),
            about: t('plugins.epAbout.modDelete'),
            fields: null,
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "mod_id": "mod-uuid" }' },
                e401, e404,
            ],
        },
        // ── Profiles ────────────────────────────────────────────────────────
        {
            method: 'GET', path: '/api/profiles', auth: false,
            desc: t('plugins.endpointProfiles'), about: 'Retourne tous les profils, incluant leurs listes de mods. Utile pour trouver les IDs de profils avant d\'en activer ou modifier un.',
            fields: null,
            responseStatuses: [{ code: 200, label: 'OK', body: '[{ "id": "prof-uuid", "name": "DCS World", "active_mods": ["mod-id-1", "mod-id-2"] }]' }],
        },
        {
            method: 'POST', path: '/api/profiles', auth: true,
            desc: t('plugins.endpointCreateProfile'),
            about: t('plugins.epAbout.profileNew'),
            fields: [
                { name: 'name', type: 'string', required: true, desc: 'Nom du profil affiché dans la barre latérale.' },
                { name: 'game_path', type: 'string', required: true, desc: 'Chemin absolu vers le dossier d\'installation du jeu.' },
                { name: 'mods_path', type: 'string', required: true, desc: 'Chemin absolu vers le dossier où sont stockés les mods.' },
                { name: 'backup_path', type: 'string', required: true, desc: 'Chemin absolu où les copies de backup sont sauvegardées.' },
                { name: 'game_name', type: 'string', required: false, desc: 'Label du jeu optionnel, ex : "DCS World".' },
                { name: 'color', type: 'string', required: false, desc: 'Couleur d\'accentuation hex, ex : "#3b82f6". Bleu par défaut.' },
                { name: 'icon', type: 'string', required: false, desc: 'Identifiant d\'icône affiché à côté du profil, ex : "star".' },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "profile": { "id": "prof-uuid", "name": "My Profile" } }' },
                e400, e401,
            ],
        },
        {
            method: 'POST', path: '/api/profiles/activate', auth: true,
            desc: t('plugins.endpointActivateProfile'), about: 'Change le profil actif. Toutes les opérations sur les mods suivantes s\'appliqueront au profil nouvellement actif.',
            fields: [{ name: 'profile_id', type: 'string', required: true, desc: 'UUID du profil à activer (utilise GET /api/profiles pour trouver les IDs).' }],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "profile_id": "prof-uuid" }' },
                e401, e404,
            ],
        },
        {
            method: 'PUT', path: '/api/profiles/:id', auth: true,
            desc: t('plugins.endpointUpdateProfile'),
            about: t('plugins.epAbout.profilePatch'),
            fields: [
                { name: 'name', type: 'string', required: false, desc: 'Nouveau nom d\'affichage.' },
                { name: 'color', type: 'string', required: false, desc: 'Nouvelle couleur d\'accentuation hex, ex : "#ef4444".' },
                { name: 'icon', type: 'string', required: false, desc: 'Nouvel identifiant d\'icône.' },
                { name: 'game_path', type: 'string', required: false, desc: 'Nouveau chemin absolu vers le dossier de destination.' },
                { name: 'mods_path', type: 'string', required: false, desc: 'Nouveau chemin absolu vers le dossier des mods.' },
                { name: 'backup_path', type: 'string', required: false, desc: 'Nouveau chemin absolu vers le dossier de backup.' },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "profile": { "id": "prof-uuid", "name": "Updated Name" } }' },
                e400, e401, e404,
            ],
        },
        {
            method: 'DELETE', path: '/api/profiles/:id', auth: true,
            desc: t('plugins.endpointDeleteProfile'),
            about: t('plugins.epAbout.profileDelete'),
            fields: null,
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "profile_id": "prof-uuid" }' },
                e400, e401, e404,
            ],
        },
        // ── Plugins ─────────────────────────────────────────────────────────
        {
            method: 'GET', path: '/api/plugins', auth: false,
            desc: t('plugins.endpointPlugins'), about: 'Retourne tous les plugins BMM installés avec leurs manifestes et leur état activé.',
            fields: null,
            responseStatuses: [{ code: 200, label: 'OK', body: '[{ "manifest": { "id": "my-plugin", "name": "My Plugin", "version": "1.0.0" }, "enabled": true }]' }],
        },
        {
            method: 'POST', path: '/api/plugins/compare', auth: true,
            desc: t('plugins.endpointCompare'), about: 'Compare les mods requis par un plugin avec les mods actuellement actifs. Retourne quels mods requis sont manquants et quels mods supplémentaires sont actifs.',
            fields: [{ name: 'plugin_id', type: 'string', required: true, desc: 'ID du plugin installé à comparer.' }],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "plugin_id": "my-plugin", "all_required_active": false, "missing_required": 2, "required": ["mod-a", "mod-b"], "strict_extra": ["mod-c"] }' },
                e401, e404,
            ],
        },
        {
            method: 'POST', path: '/api/plugins/apply', auth: true,
            desc: t('plugins.endpointApply'), about: 'Active tous les mods requis par un plugin. Optionnellement, désactive les mods absents de la liste du plugin (mode strict). Retourne le nombre de mods activés et les IDs introuvables.',
            fields: [
                { name: 'plugin_id', type: 'string', required: true, desc: 'ID du plugin installé à appliquer.' },
                { name: 'force_strict', type: 'boolean', required: false, desc: 'Si true, désactive les mods absents de la liste du plugin. Défaut : false.' },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "enabled": 3, "not_found": [], "strict": false }' },
                e400, e401, e404,
            ],
        },
        {
            method: 'GET', path: '/api/creator-id', auth: false,
            desc: t('plugins.endpointCreatorId'), about: 'Retourne l\'identifiant créateur unique généré pour cette installation BMM. Utilisé comme identifiant éditeur lors de l\'export de plugins.',
            fields: null,
            responseStatuses: [{ code: 200, label: 'OK', body: '{ "ok": true, "creator_id": "a1b2c3d4e5f6..." }' }],
        },
        // ── Modpacks ────────────────────────────────────────────────────────
        {
            method: 'POST', path: '/api/modpacks/enable', auth: true,
            desc: t('plugins.endpointEnableModpack'), about: 'Active tous les mods associés au modpack donné. Pratique pour activer en un clic l\'ensemble d\'un preset.',
            fields: [{ name: 'modpack_id', type: 'string', required: true, desc: 'UUID du LocalModpack dont tous les mods seront activés.' }],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "modpack_id": "mp-uuid", "enabled_count": 5 }' },
                e401, e404,
            ],
        },
        {
            method: 'POST', path: '/api/modpacks/disable', auth: true,
            desc: t('plugins.endpointDisableModpack'), about: 'Désactive tous les mods associés au modpack donné.',
            fields: [{ name: 'modpack_id', type: 'string', required: true, desc: 'UUID du LocalModpack dont tous les mods seront désactivés.' }],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "modpack_id": "mp-uuid", "disabled_count": 5 }' },
                e401, e404,
            ],
        },
        // ── Server Repo ─────────────────────────────────────────────────────────
        {
            method: 'GET', path: '/api/repo/info', auth: false,
            desc: 'Informations repo distant',
            about: t('plugins.epAbout.repoInfo'),
            fields: [
                { name: 'url', type: 'string', required: true, desc: 'URL vers le repo.json distant (query param). Ex : ?url=https://monserveur.com/repo.json' },
                { name: 'password', type: 'string', required: false, desc: 'Mot de passe de téléchargement, si le repo auto-hébergé est protégé. Envoyé en header X-Repo-Password. Ex : &password=secret' },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "data": { "name": "Mon Repo", "version": "1.0.0", "game_name": "My Game", "profiles": [...], "author": "FreeProject" } }' },
                { code: 400, label: 'Bad Request', body: '{ "error": "url query param required" }' },
                { code: 401, label: 'Unauthorized', body: '{ "error": "Repo password required (401)" }' },
                { code: 502, label: 'Bad Gateway', body: '{ "error": "Remote returned 404" }' },
            ],
        },
        {
            method: 'GET', path: '/api/repo/list', auth: false,
            desc: 'Liste des repos connectés',
            about: t('plugins.epAbout.repoList'),
            fields: null,
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "data": [{ "url": "https://monserveur.com/repo.json", "name": "Mon Serveur" }] }' },
            ],
        },
        {
            method: 'POST', path: '/api/repo/connect', auth: true,
            desc: 'Connecter un repo distant',
            about: t('plugins.epAbout.repoConnect'),
            fields: [
                { name: 'url', type: 'string', required: true, desc: 'URL complète vers le repo.json distant (ou le dossier parent — /repo.json sera ajouté automatiquement).' },
                { name: 'name', type: 'string', required: false, desc: 'Nom affiché dans BMM. Si omis, récupéré depuis le champ "name" du repo.json distant.' },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "url": "https://...", "name": "Mon Serveur" }' },
                { code: 400, label: 'Bad Request', body: '{ "error": "url required" }' },
                { code: 401, label: 'Unauthorized', body: '{ "error": "Unauthorized" }' },
            ],
        },
        {
            method: 'DELETE', path: '/api/repo', auth: true,
            desc: 'Déconnecter un repo',
            about: t('plugins.epAbout.repoForget'),
            fields: [
                { name: 'url', type: 'string', required: true, desc: 'URL exacte du repo à retirer (identique à celle utilisée lors de la connexion).' },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "url": "https://..." }' },
                { code: 401, label: 'Unauthorized', body: '{ "error": "Unauthorized" }' },
                { code: 404, label: 'Not Found', body: '{ "error": "Repo \'https://...\' not found in connected list" }' },
            ],
        },
        {
            method: 'POST', path: '/api/repo/sync', auth: true,
            desc: 'Synchroniser depuis un repo distant',
            about: t('plugins.epAbout.repoSync'),
            fields: [
                { name: 'url', type: 'string', required: true, desc: 'URL du repo.json distant.' },
                { name: 'choices', type: 'array', required: true, desc: 'Tableau de profils à synchroniser. Chaque entrée : { repoProfileId, targetLocalProfileId?, selectedModIds? }.' },
                { name: 'choices[].repoProfileId', type: 'string', required: true, desc: 'ID du profil dans le repo distant (visible via GET /api/repo/info).' },
                { name: 'choices[].targetLocalProfileId', type: 'string', required: false, desc: 'UUID d\'un profil local existant à mettre à jour. Omis = crée un nouveau profil.' },
                { name: 'choices[].selectedModIds', type: 'array', required: false, desc: 'IDs de mods à télécharger (null = tous les mods du profil).' },
                { name: 'gameDir', type: 'string', required: false, desc: t('plugins.apiGameDirDesc') },
                { name: 'modsDir', type: 'string', required: false, desc: 'Dossier racine des mods (requis si création d\'un nouveau profil).' },
                { name: 'backupDir', type: 'string', required: false, desc: 'Dossier de backup (requis si création d\'un nouveau profil).' },
                { name: 'creatorId', type: 'string', required: false, desc: 'Creator ID à envoyer en header X-Creator-ID (pour repos privés).' },
                { name: 'password', type: 'string', required: false, desc: 'Mot de passe de téléchargement, si le repo auto-hébergé est protégé. Envoyé en header X-Repo-Password.' },
                { name: 'overwriteAll', type: 'boolean', required: false, desc: 'Si true, re-télécharge tous les fichiers même si le hash correspond. Défaut : false.' },
                { name: 'deleteExtra', type: 'boolean', required: false, desc: 'Si true, supprime les fichiers locaux absents du repo distant. Défaut : false.' },
                { name: 'downloadLimit', type: 'number', required: false, desc: 'Limite de téléchargement en KB/s (0 = illimité). Défaut : 0.' },
            ],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "message": "Sync started in background", "job_id": "uuid", "cancel_endpoint": "DELETE /api/repo/sync/cancel" }' },
                { code: 400, label: 'Bad Request', body: '{ "error": "gameDir is required when creating a new profile" }' },
                { code: 401, label: 'Unauthorized', body: '{ "error": "Unauthorized" }' },
                { code: 409, label: 'Conflict', body: '{ "error": "A sync is already running. Cancel it first with DELETE /api/repo/sync/cancel." }' },
            ],
        },
        {
            method: 'POST', path: '/api/repo/manifest', auth: true,
            desc: 'Générer repo.json pour un dossier déjà hébergé',
            about: t('plugins.epAbout.repoManifest'),
            fields: [
                { name: 'modsDir', type: 'string', required: false, desc: 'Dossier dont les sous-dossiers sont les mods. Obligatoire si <code>sources</code> est absent.' },
                { name: 'sources', type: 'array', required: false, desc: 'Plusieurs dossiers d\'un coup : <code>[{ "dir": "…", "onlyDirs": ["…"], "label": "…" }]</code>. Prioritaire sur <code>modsDir</code>. Deux dossiers qui publieraient un mod du même nom sont refusés (l\'id d\'un mod est son nom de dossier) et rien n\'est écrit.' },
                { name: 'outputPath', type: 'string', required: false, desc: 'Où écrire le manifeste. Par défaut <code>repo.json</code> À CÔTÉ de modsDir, pas dedans — sinon un scan ultérieur le prendrait pour un fichier de mod.' },
                { name: 'name', type: 'string', required: false, desc: 'Nom du dépôt inscrit dans le manifeste.' },
                { name: 'author', type: 'string', required: false, desc: 'Auteur inscrit dans le manifeste.' },
                { name: 'gameName', type: 'string', required: false, desc: 'Jeu ciblé.' },
                { name: 'filesBaseUrl', type: 'string', required: false, desc: 'URL absolue du dossier auquel filesLayout est relatif.' },
                { name: 'filesLayout', type: 'string', required: false, desc: 'Gabarit <code>{id}</code> / <code>{path}</code> ; défaut <code>mods/{id}/{path}</code>.' },
                { name: 'reuseExisting', type: 'boolean', required: false, desc: 'Conserver l\'identité du manifeste précédent. Activé par défaut.' },
                { name: 'onlyDirs', type: 'array', required: false, desc: 'Restreindre aux sous-dossiers nommés. C\'est ainsi que « ne publier que ces profils / ce modpack » fonctionne sans second chemin de code.' },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "path": "C:/host/repo.json", "added": 3, "changed": 1, "removed": 0 }' },
                { code: 403, label: 'Forbidden', body: '{ "error": "Missing permission: repo.write" }' },
            ],
        },
        {
            method: 'POST', path: '/api/repo/gen', auth: true,
            desc: 'Générer la structure repo (Gen)',
            about: t('plugins.epAbout.repoGen'),
            fields: [
                { name: 'profileIds', type: 'array', required: true, desc: 'Tableau des UUIDs de profils locaux à exporter.' },
                { name: 'outputDir', type: 'string', required: true, desc: 'Dossier de destination où créer repo.json et le dossier mods/.' },
                { name: 'authorName', type: 'string', required: true, desc: 'Nom de l\'auteur inscrit dans repo.json.' },
                { name: 'seed', type: 'string', required: false, desc: 'Graine de stabilité du repo (réutilisation entre exports). Généré automatiquement si omis.' },
                { name: 'generateServer', type: 'boolean', required: false, desc: 'Si true, génère également les scripts de démarrage du mini-serveur. Défaut : false.' },
                { name: 'port', type: 'number', required: false, desc: 'Port d\'écoute du mini-serveur. Défaut : 8080.' },
                { name: 'uploadLimit', type: 'number', required: false, desc: 'Limite de bande passante montante KB/s (0 = illimité). Défaut : 0.' },
                { name: 'adminPassword', type: 'string', required: false, desc: 'Mot de passe administrateur du mini-serveur.' },
                { name: 'useCloudflare', type: 'boolean', required: false, desc: 'Active le tunnel Cloudflare (cloudflared doit être installé).' },
                { name: 'useUpnp', type: 'boolean', required: false, desc: 'Active l\'ouverture de port automatique via UPnP.' },
                { name: 'autoStart', type: 'boolean', required: false, desc: 'Démarre le serveur automatiquement au lancement de BMM.' },
                { name: 'lang', type: 'string', required: false, desc: 'Langue de l\'interface du mini-serveur (ex: "fr", "en"). Défaut : "en".' },
                { name: 'serverVersion', type: 'number', required: false, desc: 'Version cible du serveur BMM à générer (1 ou 2).' },
                { name: 'enableDocker', type: 'boolean', required: false, desc: 'Génère un Dockerfile pour le mini-serveur.' },
                { name: 'dockerHostType', type: 'string', required: false, desc: 'Type d\'hôte Docker : "linux" ou "windows".' },
                { name: 'zipOutput', type: 'boolean', required: false, desc: 'Compresse la sortie en .zip — active également la config serveur de distribution.' },
                { name: 'useDocker', type: 'boolean', required: false, desc: 'Génère un Dockerfile pour le mini-serveur de distribution.' },
                { name: 'dockerOs', type: 'string', required: false, desc: 'OS hôte Docker : "linux" (défaut) ou "windows".' },
                { name: 'serverVersion', type: 'string', required: false, desc: 'Version serveur : "std" (standard) ou "lux" (premium).' },
            ],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "message": "Gen started in background", "job_id": "uuid", "cancel_endpoint": "DELETE /api/repo/gen/cancel" }' },
                { code: 400, label: 'Bad Request', body: '{ "error": "author_name is required" }' },
                { code: 401, label: 'Unauthorized', body: '{ "error": "Unauthorized" }' },
                { code: 409, label: 'Conflict', body: '{ "error": "A gen is already running. Cancel it first with DELETE /api/repo/gen/cancel." }' },
            ],
        },
        {
            method: 'POST', path: '/api/repo/update', auth: true,
            desc: t('plugins.ep.repoUpdate') || 'Update an existing repo',
            about: 'Incrementally updates an existing server repo: add/remove mods & whole profiles without regenerating everything. Opens the BMM "Update repo" modal pre-filled with the chosen folder so you confirm the changes. Pass <code>repoDir</code> to point at the repo folder (must contain repo.json).',
            fields: [
                { name: 'repoDir', type: 'string', required: true, desc: 'Folder of the existing repo (contains repo.json).' },
                { name: 'authorName', type: 'string', required: false, desc: 'Override the author name written to repo.json.' },
                { name: 'removeModIds', type: 'array', required: false, desc: 'Mod IDs to remove from the repo.' },
                { name: 'removeProfileIds', type: 'array', required: false, desc: 'Whole profile IDs to remove from the repo.' },
                { name: 'addProfiles', type: 'array', required: false, desc: 'Profiles (with optional per-mod selection) to add: [{ "profileId": "…", "modIds": null }].' },
                { name: 'modChangelogs', type: 'object', required: false, desc: 'Per-mod author changelog, keyed by local mod id: { "<modId>": "Fixed X, added Y" }. Shown to users when the update is detected.' },
            ],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "repo/update" }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/mod/config', auth: true,
            desc: t('plugins.ep.modConfig') || 'Configure a mod\'s update sources',
            about: 'Links an installed mod to the repo(s) that can update it. Set its stable <code>repoModId</code>, a primary <code>updateUrl</code> (for site mods), and/or a list of additional <code>updateSources</code>. These are what <code>POST /api/mod/check-updates</code> and the "Check for mod updates" button compare against.',
            fields: [
                { name: 'modId', type: 'string', required: true, desc: 'Local mod id to configure.' },
                { name: 'repoModId', type: 'string', required: false, desc: 'This mod\'s stable id inside its repo manifest. Empty string clears it.' },
                { name: 'updateUrl', type: 'string', required: false, desc: 'Primary update repo URL (for mods added from a site). Empty clears it.' },
                { name: 'updateSources', type: 'array', required: false, desc: 'Additional repos: [{ "repoUrl": "https://…/repo.json", "repoModId": "…" }]. repoModId is optional (falls back to repoModId above).' },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "mod_id": "…" }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/mod/check-updates', auth: true,
            desc: t('plugins.ep.modCheckUpdates') || 'Check installed mods for updates',
            about: 'Runs a real update check: every installed mod linked to a repo (via sync origin, configured update sources, or the global update repos in Settings) is compared against that repo\'s current version. Driven through the BMM UI, which opens the results modal. Unreachable repos are reported as errors.',
            fields: [],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "mod/check-updates" }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/mod/update', auth: true,
            desc: t('plugins.ep.modUpdate'),
            about: t('plugins.epAbout.modUpdate'),
            fields: [
                { name: 'repoUrl', type: 'string', required: false, desc: t('plugins.epF.muRepoUrl') },
            ],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "mod/update" }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/repo/host', auth: true,
            desc: 'Démarrer le serveur HTTP statique',
            about: 'Lance un serveur HTTP de fichiers statiques (warp::fs) sur le dossier spécifié. Utile pour servir un repo généré via <code>POST /api/repo/gen</code> directement sur le réseau local. Stoppez-le avec <code>DELETE /api/repo/host</code>.',
            fields: [
                { name: 'serveDir', type: 'string', required: true, desc: 'Chemin absolu du dossier à servir (ex: "C:/BMM/Export").' },
                { name: 'port', type: 'number', required: false, desc: 'Port d\'écoute HTTP. Défaut : 8080.' },
                { name: 'uploadLimit', type: 'number', required: false, desc: 'Limite de bande passante KB/s (0 = illimité). Défaut : 0.' },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "message": "HTTP host started", "url": "http://192.168.1.x:8080" }' },
                { code: 400, label: 'Bad Request', body: '{ "error": "serve_dir is required" }' },
                { code: 401, label: 'Unauthorized', body: '{ "error": "Unauthorized" }' },
                { code: 409, label: 'Conflict', body: '{ "error": "An HTTP host is already running. Stop it first with DELETE /api/repo/host." }' },
            ],
        },
        {
            method: 'DELETE', path: '/api/repo/host', auth: true,
            desc: 'Arrêter le serveur HTTP statique',
            about: 'Envoie un signal d\'arrêt gracieux au serveur HTTP lancé par <code>POST /api/repo/host</code>.',
            fields: [],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "message": "HTTP host stopped" }' },
                { code: 200, label: 'OK (rien en cours)', body: '{ "ok": false, "message": "No HTTP host is currently running" }' },
                e401,
            ],
        },
        // ── Import / Export (UI-driven — performed through the BMM interface) ──
        {
            method: 'POST', path: '/api/data/export', auth: true,
            desc: 'Export app data (backup)',
            about: '<strong>What:</strong> a single <code>.json</code> backup of BMM\'s data — you choose which sections to include (profiles, settings, modpacks, plugins…). <strong>Where:</strong> you pick the destination file in the native save dialog that opens.<br><br>This is UI-driven: the API only opens the in-app "Export data" flow (Settings) — exactly as if you clicked it yourself — so you confirm the options and location.',
            fields: [],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "data/export" }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/data/import', auth: true,
            desc: 'Import app data (restore)',
            about: '<strong>What:</strong> a previously exported BMM <code>.json</code> backup. <strong>Where it goes:</strong> it replaces BMM\'s current data store (the app-data file BMM reads at startup), restoring the saved profiles/settings/modpacks/plugins. <strong>Source:</strong> you pick the backup file in the open dialog.<br><br>UI-driven via the Settings "Import data" flow, including its confirmation prompt (this overwrites your current data).',
            fields: [],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "data/import" }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/modlists/export', auth: true,
            desc: 'Export a mod list (.mmlist)',
            about: '<strong>What:</strong> a shareable <code>.mmlist</code> describing your current profile\'s mods (names, versions, optional download links/hashes) — it does NOT bundle the mod files themselves. <strong>Where:</strong> you choose the output file in the export form. <strong>Fill in:</strong> list name, description, author.<br><br>UI-driven: opens the in-app mod-list export form so you complete the fields and destination.',
            fields: [],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "modlist/export" }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/modlists/import', auth: true,
            desc: 'Import a mod list (.mmlist)',
            about: '<strong>What:</strong> a <code>.mmlist</code> file. BMM reads it, resolves the listed mods and downloads the ones with links. <strong>Where it goes:</strong> resolved mods are added to the active profile and stored in that profile\'s Mods folder. <strong>Source:</strong> you pick the <code>.mmlist</code> in the open dialog.<br><br>UI-driven via the in-app mod-list import flow.',
            fields: [],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "modlist/import" }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/modpacks/import', auth: true,
            desc: 'Import a modpack (.bmp)',
            about: '<strong>What:</strong> a Better ModPack <code>.bmp</code> file. <strong>Where it goes:</strong> the imported modpack is added to BMM\'s modpack list and appears on the Modpacks page. <strong>Source:</strong> send an optional <code>path</code> in the JSON body to import that file directly, or omit it to open the native file picker.',
            fields: [
                { name: 'path', type: 'string', required: false, desc: 'Absolute path to a .bmp/.json modpack file. If omitted, BMM opens a file-picker dialog.' },
            ],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "modpack/import" }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/modpacks/export', auth: true,
            desc: 'Export a modpack (.bmp)',
            about: '<strong>What:</strong> the modpack identified by <code>id</code>, written as a Better ModPack <code>.bmp</code> file. <strong>Where:</strong> pass <code>destDir</code> to write it straight into that folder (no dialog, fully automatic), or omit it to choose the destination in the native save dialog.<br><br>Get the id from <code>GET /api/modpacks</code>.',
            fields: [
                { name: 'id', type: 'string', required: true, desc: 'UUID of the modpack to export (from GET /api/modpacks).' },
                { name: 'destDir', type: 'string', required: false, desc: 'Folder to export into (e.g. "C:/Exports"). If omitted, a save dialog opens. The filename is auto-generated from the modpack name.' },
            ],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "modpack/export" }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/plugins/import', auth: true,
            desc: 'Import a plugin (.bmmplug)',
            about: '<strong>What:</strong> a <code>.bmmplug</code> (or <code>.zip</code>) plugin package. <strong>Where it goes:</strong> it is installed into BMM\'s plugins folder and registered as an installed plugin (Plugins page). <strong>Source:</strong> you pick the file in the open dialog.<br><br>UI-driven via the native plugin importer.',
            fields: [],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "plugin/import" }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/plugins/export', auth: true,
            desc: 'Export a plugin (.bmmplug)',
            about: '<strong>What:</strong> the installed plugin identified by <code>id</code>, packaged as a <code>.bmmplug</code> file. <strong>Where:</strong> you choose the destination in the native save dialog.<br><br>Get the id from <code>GET /api/plugins</code>.',
            fields: [
                { name: 'id', type: 'string', required: true, desc: 'ID of the installed plugin to export (from GET /api/plugins).' },
            ],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "plugin/export" }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/language/import', auth: true,
            desc: 'Import a language file',
            about: '<strong>What:</strong> a translation <code>.json</code> (same shape as <code>GET /api/language/template</code>). <strong>Where it goes:</strong> it is copied into BMM\'s <code>Lang/</code> folder and becomes selectable as a language in Settings. <strong>Source:</strong> send an optional <code>path</code> in the JSON body to import that file directly, or omit it to open the file picker. The filename (minus <code>.json</code>) becomes the language code — <code>template.json</code> is rejected.',
            fields: [
                { name: 'path', type: 'string', required: false, desc: 'Absolute path to a .json language file. If omitted, BMM opens a file-picker dialog.' },
            ],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "language/import" }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/profiles/import/ovgme', auth: true,
            desc: 'Import OvGME profiles',
            about: '<strong>What:</strong> existing OvGME configurations. BMM scans the OvGME data folder (<code>%PROGRAMDATA%/OvGME</code>) automatically — no file to pick. <strong>Where it goes:</strong> each detected OvGME config becomes a new BMM profile (stored in the app-data file, shown on the Profiles page). Returns the number of profiles imported.',
            fields: [],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "profile/import-ovgme" }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/profiles/import/omm', auth: true,
            desc: 'Import OMM / OMX profile',
            about: '<strong>What:</strong> an OpenModManager profile/backup file (<code>.omm</code> / <code>.omx</code>). <strong>Where it goes:</strong> a new BMM profile is created from it (stored in the app-data file, shown on the Profiles page). <strong>Source:</strong> you pick the file in the open dialog.',
            fields: [],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "profile/import-omm" }' },
                e401,
            ],
        },
        // ── Modpacks (list + create + update) ────────────────────────────────
        {
            method: 'GET', path: '/api/modpacks', auth: false,
            desc: t('plugins.endpointGetModpacks'),
            about: 'Returns every saved modpack (a named snapshot of a mod selection). Each entry is a full modpack object; its mod count is <code>mods.length</code>.',
            fields: [],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "data": [{ "id": "...", "name": "My Pack", "description": null, "mods": [{ "mod_id": "...", "mod_name": "...", "mod_version": "1.0" }], "multi_profile": false, "dependency_mode": "manual" }] }' },
            ],
        },
        {
            method: 'POST', path: '/api/modpacks/create', auth: true,
            desc: t('plugins.endpointCreateModpack') || 'Créer un modpack',
            about: 'Crée un nouveau modpack avec un nom donné. Spécifie mod_ids pour inclure des mods directement, ou fournis source_profile_id pour capturer les mods actifs d\'un profil. Prend en charge multi_profile, skip_integrity_check, dependency_mode et des surcharges par mod (lien de téléchargement, include_dependencies, etc.).',
            fields: [
                { name: 'name', type: 'string', required: true, desc: 'Nom affiché pour le nouveau modpack.' },
                { name: 'mod_ids', type: 'array', required: false, desc: 'Tableau d\'UUIDs de mods à inclure directement. Prioritaire sur source_profile_id.' },
                { name: 'source_profile_id', type: 'string', required: false, desc: 'UUID d\'un profil dont capturer les mods actifs (utilisé si mod_ids n\'est pas fourni).' },
                { name: 'description', type: 'string', required: false, desc: 'Description courte du modpack.' },
                { name: 'game_name', type: 'string', required: false, desc: 'Label du jeu (hérité du profil source si omis).' },
                { name: 'sr_link', type: 'string', required: false, desc: 'URL du Server Repo lié à ce modpack.' },
                { name: 'multi_profile', type: 'boolean', required: false, desc: 'Autoriser des mods de plusieurs profils dans un seul modpack.' },
                { name: 'skip_integrity_check', type: 'boolean', required: false, desc: 'Ignorer la vérification d\'intégrité des fichiers lors de l\'application du modpack.' },
                { name: 'dependency_mode', type: 'string', required: false, desc: 'Mode de résolution des dépendances : "none" (défaut, aucune), "all" (toutes auto-incluses), "manual" (par mod via include_dependencies).' },
                { name: 'mod_overrides', type: 'array', required: false, desc: 'Surcharges par mod : [{ "mod_id": "uuid", "include_dependencies": false, "download_link": "https://…", "fallback_link": "https://…", "fallback_type": "direct|gdrive|…" }]' },
            ],
            responseStatuses: [
                { code: 201, label: 'Created', body: '{ "ok": true, "modpack_id": "new-uuid", "mod_count": 12 }' },
                e400, e401,
            ],
        },
        // ── Update modpack ───────────────────────────────────────────────────
        {
            method: 'PUT', path: '/api/modpacks/:id', auth: true,
            desc: t('plugins.endpointUpdateModpack') || 'Mettre à jour un modpack',
            about: 'Met à jour les métadonnées d\'un modpack existant (nom, description, liste de mods, options). Remplace uniquement les champs fournis (PATCH-like). Retourne le modpack mis à jour.',
            fields: [
                { name: 'name', type: 'string', required: false, desc: 'Nouveau nom affiché du modpack.' },
                { name: 'description', type: 'string', required: false, desc: 'Nouvelle description.' },
                { name: 'game_name', type: 'string', required: false, desc: 'Label du jeu.' },
                { name: 'sr_link', type: 'string', required: false, desc: 'URL du Server Repo lié.' },
                { name: 'mod_ids', type: 'array', required: false, desc: 'Tableau de mod UUIDs pour remplacer la liste de mods.' },
                { name: 'multi_profile', type: 'boolean', required: false, desc: 'Autoriser des mods de plusieurs profils.' },
                { name: 'skip_integrity_check', type: 'boolean', required: false, desc: 'Ignorer la vérification d\'intégrité des fichiers.' },
                { name: 'dependency_mode', type: 'string', required: false, desc: 'Mode de résolution : "none", "all", "manual".' },
                { name: 'mod_overrides', type: 'array', required: false, desc: 'Surcharges par mod (download_link, include_dependencies, etc.).' },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "modpack_id": "uuid", "mod_count": 12 }' },
                e400, e401, e404,
            ],
        },
        // ── Delete modpack ───────────────────────────────────────────────────
        {
            method: 'DELETE', path: '/api/modpacks/:id', auth: true,
            desc: 'Supprimer un modpack',
            about: 'Supprime définitivement un modpack par son UUID. Cette action est irréversible. Les mods locaux ne sont pas supprimés.',
            fields: [],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "deleted_id": "uuid" }' },
                e401, e404,
            ],
        },
        {
            method: 'DELETE', path: '/api/plugins/:id', auth: true,
            desc: t('plugins.ep.deletePlugin') || 'Delete plugin',
            about: 'Désinstalle définitivement un plugin : retire son entrée du registre BMM, ses permissions stockées, et supprime ses fichiers sur le disque. Remplace <code>:id</code> par l\'id du plugin (champ "id" de plugin.json). Équivalent deeplink : <code>bmm://plugin/delete?id=&lt;ID&gt;</code>.',
            fields: [],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "deleted_id": "my-plugin" }' },
                e401, e404,
            ],
        },
        // ── Apps (installed catalog) ─────────────────────────────────────────
        {
            method: 'GET', path: '/api/apps', auth: true,
            desc: t('plugins.ep.installedApps') || 'Installed Apps',
            about: t('plugins.epAbout.appsGet') || 'Returns all apps installed through the BMM App Catalog, including their install path, launch executable, install type, and usage stats. Requires <code>app.read</code> permission when called with <code>X-BMM-Plugin-Id</code> header.',
            fields: [],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "installed": { "my-app": { "id": "my-app", "title": "My App", "exe_path": "C:/Apps/my-app.exe", "install_type": "exe" } } }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/apps/install', auth: true,
            desc: t('plugins.ep.installApp') || 'Install App',
            about: t('plugins.epAbout.appsInstall') || 'UI-driven: triggers the BMM App Catalog install flow in the interface. Requires <code>app.write</code> permission when called with a plugin ID. Fields <code>version</code>, <code>category</code>, <code>thumb</code> are optional.',
            fields: [
                { name: 'appId', type: 'string', required: true, desc: 'Unique identifier for the app.' },
                { name: 'appTitle', type: 'string', required: true, desc: 'Display name shown in the UI.' },
                { name: 'downloadUrl', type: 'string', required: true, desc: 'Direct download URL for the installer/archive.' },
                { name: 'fileType', type: 'string', required: true, desc: 'One of: exe, zip, msi, script.' },
                { name: 'installPath', type: 'string', required: false, desc: 'Target install directory (uses default Apps folder if blank).' },
                { name: 'version', type: 'string', required: false, desc: 'Version string, e.g. "1.2.0".' },
                { name: 'category', type: 'string', required: false, desc: 'Category hint, e.g. "utility".' },
                { name: 'thumb', type: 'string', required: false, desc: 'Thumbnail URL for display.' },
            ],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "message": "App install requested" }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/apps/launch', auth: true,
            desc: t('plugins.ep.launchApp') || 'Launch App',
            about: t('plugins.epAbout.appsLaunch') || 'Launches an installed app by its ID and executable path. Requires <code>app.write</code> permission when called with a plugin ID.',
            fields: [
                { name: 'appId', type: 'string', required: true, desc: 'ID of the installed app (from GET /api/apps).' },
                { name: 'exePath', type: 'string', required: true, desc: 'Absolute path to the executable to launch.' },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true }' },
                e401, e404,
            ],
        },
        {
            method: 'DELETE', path: '/api/apps/:id', auth: true,
            desc: t('plugins.ep.uninstallApp') || 'Uninstall App',
            about: t('plugins.epAbout.appsDel') || 'Removes an app from BMM\'s installed registry. Files are kept on disk by default. Requires <code>app.write</code> permission when called with a plugin ID. Replace <code>:id</code> with the app ID.',
            fields: [],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true }' },
                e401, e404,
            ],
        },
        // ── Permissions ──────────────────────────────────────────────────────
        {
            method: 'GET', path: '/api/apps/permissions', auth: true,
            desc: t('plugins.ep.listPerms') || 'List Permissions',
            about: t('plugins.epAbout.permsGet') || 'Returns a map of <code>plugin_id → [permissions]</code> showing every plugin\'s current API permissions. Permissions are checked when a request includes <code>X-BMM-Plugin-Id</code> header.',
            fields: [],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "my-plugin": ["app.read", "catalog.write"] }' },
                e401,
            ],
        },
        {
            method: 'GET', path: '/api/apps/permissions/:id', auth: true,
            desc: t('plugins.ep.getPerms') || 'Get Plugin Perms',
            about: t('plugins.epAbout.permsGetOne') || 'Returns the permission list for a specific plugin. Replace <code>:id</code> with the plugin ID.',
            fields: [],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "plugin_id": "my-plugin", "permissions": ["app.read", "catalog.read"] }' },
                e401,
            ],
        },
        {
            method: 'PUT', path: '/api/apps/permissions/:id', auth: true,
            desc: t('plugins.ep.setPerms') || 'Set Plugin Perms',
            // The list is BUILT, not written down. This paragraph named eleven scopes and
            // then explained that read scopes did not exist — which stopped being true, and
            // a hand-kept third copy of a list is a third chance to say so after the fact.
            about: `${t('plugins.epAbout.permsSet') || 'Replaces the full permission list for a plugin. Granting is all-or-nothing per scope, and an empty array revokes everything. Replace <code>:id</code> with the plugin ID.'} ${(t('plugins.epAbout.permsAvail') || 'Available:')} ${permDomains().flatMap(d => d.scopes).map(x => `<code>${x}</code>`).join(', ')}.`,
            fields: [
                { name: 'permissions', type: 'array', required: true, desc: `${t('plugins.epField.perms') || 'Array of permission strings to grant. Unknown strings are stored but gate nothing. An empty array revokes everything.'} ${permDomains().flatMap(d => d.scopes).join(', ')}.` },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "plugin_id": "my-plugin", "permissions": ["app.read", "catalog.write"] }' },
                e401,
            ],
        },
        // ── Local Catalog ────────────────────────────────────────────────────
        {
            method: 'GET', path: '/api/catalog', auth: true,
            desc: t('plugins.ep.catalog') || 'Local Catalog',
            about: t('plugins.epAbout.catGet') || 'Returns the local <code>apps-catalog.json</code> stored in BMM\'s AppData directory. This file follows the standard BMM catalog format and can be hosted and shared. Requires <code>catalog.read</code> permission for plugin callers.',
            fields: [],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "version": "1.0", "name": "My Catalog", "apps": [] }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/catalog/new', auth: true,
            desc: t('plugins.ep.catNew') || 'Create Catalog',
            about: t('plugins.epAbout.catNew') || 'Creates or resets the local catalog file. All fields are optional — omitting <code>apps</code> starts with an empty catalog. Requires <code>catalog.write</code> permission for plugin callers.',
            fields: [
                { name: 'name', type: 'string', required: false, desc: 'Catalog display name. Default: "My Catalog".' },
                { name: 'description', type: 'string', required: false, desc: 'Short description of the catalog.' },
                { name: 'partner_catalogs', type: 'array', required: false, desc: 'Array of partner catalog URLs to include.' },
                { name: 'community_imports', type: 'array', required: false, desc: 'Array of community catalog URLs.' },
                { name: 'apps', type: 'array', required: false, desc: 'Initial app entries (same structure as Add App).' },
            ],
            responseStatuses: [
                { code: 201, label: 'Created', body: '{ "ok": true, "catalog": { "version": "1.0", "name": "My Catalog", "apps": [] } }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/catalog/apps', auth: true,
            desc: t('plugins.ep.catAddApp') || 'Add App to Catalog',
            about: t('plugins.epAbout.catAddApp') || 'Adds a single app entry to the local catalog. The app object should follow the standard BMM catalog app format. Requires <code>catalog.write</code>.',
            fields: [
                { name: 'id', type: 'string', required: true, desc: 'Unique slug, lowercase with dashes only, e.g. "my-app".' },
                { name: 'title', type: 'string', required: true, desc: 'Display name of the app.' },
                { name: 'description', type: 'string', required: false, desc: 'Short description.' },
                { name: 'category', type: 'string', required: false, desc: 'Category: utility, game, other.' },
                { name: 'price', type: 'string', required: false, desc: 'Pricing: free, freemium, paid.' },
                { name: 'tags', type: 'array', required: false, desc: 'Up to 3 tag strings.' },
                { name: 'download', type: 'object', required: true, desc: '{ "url": "https://…", "file_type": "exe|zip|msi|script" }' },
                { name: 'requirements', type: 'string', required: false, desc: 'System requirements string, e.g. "Windows 10+".' },
                { name: 'md_link', type: 'string', required: false, desc: 'URL to a README or docs page.' },
            ],
            responseStatuses: [
                { code: 201, label: 'Created', body: '{ "ok": true, "total": 1 }' },
                e401,
            ],
        },
        {
            method: 'PUT', path: '/api/catalog/apps/:id', auth: true,
            desc: t('plugins.ep.catUpdateApp') || 'Update Catalog App',
            about: t('plugins.epAbout.catUpdateApp') || 'Updates one or more fields of an existing catalog app entry. Only sent fields are modified (PATCH-like). Replace <code>:id</code> with the app ID. Requires <code>catalog.write</code>.',
            fields: [
                { name: 'title', type: 'string', required: false, desc: 'New display name.' },
                { name: 'description', type: 'string', required: false, desc: 'New description.' },
                { name: 'version', type: 'string', required: false, desc: 'New version string.' },
                { name: 'category', type: 'string', required: false, desc: 'New category.' },
                { name: 'download', type: 'object', required: false, desc: 'New download object { url, file_type }.' },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true }' },
                e401, e404,
            ],
        },
        {
            method: 'DELETE', path: '/api/catalog/apps/:id', auth: true,
            desc: t('plugins.ep.catRemApp') || 'Remove from Catalog',
            about: t('plugins.epAbout.catRemApp') || 'Removes an app from the local catalog by its ID. Replace <code>:id</code> with the app ID. Requires <code>catalog.write</code>.',
            fields: [],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "removed": "my-app" }' },
                e401, e404,
            ],
        },
        // ── Language template ─────────────────────────────────────────────────
        {
            method: 'GET', path: '/api/language/template', auth: false,
            desc: t('plugins.ep.langTemplate') || 'Lang Template',
            about: t('plugins.epAbout.langTemplate') || 'Downloads <code>lang-template.json</code> — a flat JSON object of all BMM translation keys mapped to their English default strings. <strong>Output format:</strong> <code>{ "namespace.key": "English text", … }</code> — keys use dot-namespacing (e.g. <code>common.ok</code>, <code>mod.activated</code>). <strong>Workflow:</strong> download → translate each <em>value</em> (keep keys unchanged) → rename to your language code (e.g. <code>de.json</code>) → import via <code>POST /api/language/import</code>. Served with <code>Content-Disposition: attachment</code>. No auth required.',
            fields: [],
            responseStatuses: [
                { code: 200, label: 'OK (JSON file download)', body: '{\n  "common.ok": "OK",\n  "common.cancel": "Cancel",\n  "mod.activated": "{name} activated",\n  ...\n}' },
                { code: 404, label: 'Not Found', body: '{ "error": "Language template not found. Is BMM installed correctly?" }' },
            ],
        },
        // ── Repo cancel endpoints ────────────────────────────────────────────
        {
            method: 'DELETE', path: '/api/repo/sync/cancel', auth: true,
            desc: t('plugins.endpointCancelSync') || 'Annuler la sync en cours',
            about: 'Envoie un signal d\'annulation à la tâche de sync de repo actuellement en cours. La sync s\'arrête au prochain point de contrôle (entre deux mods). Retourne ok:false si aucune sync n\'est en cours.',
            fields: [],
            responseStatuses: [
                { code: 200, label: 'OK (signal envoyé)', body: '{ "ok": true, "message": "Cancel signal sent — sync will stop at next checkpoint" }' },
                { code: 200, label: 'OK (rien à annuler)', body: '{ "ok": false, "message": "No sync is currently running" }' },
                e401,
            ],
        },
        {
            method: 'DELETE', path: '/api/repo/gen/cancel', auth: true,
            desc: t('plugins.endpointCancelGen') || 'Annuler la génération en cours',
            about: 'Envoie un signal d\'annulation à la tâche de génération de repo actuellement en cours. La gen s\'arrête au prochain point de contrôle. Retourne ok:false si aucune gen n\'est en cours.',
            fields: [],
            responseStatuses: [
                { code: 200, label: 'OK (signal envoyé)', body: '{ "ok": true, "message": "Cancel signal sent — gen will stop at next checkpoint" }' },
                { code: 200, label: 'OK (rien à annuler)', body: '{ "ok": false, "message": "No gen is currently running" }' },
                e401,
            ],
        },
        // ── Privacy / telemetry ───────────────────────────────────────────────
        {
            method: 'POST', path: '/api/telemetry/consent', auth: true,
            desc: t('plugins.ep.telConsent') || 'Telemetry consent',
            about: 'Active ou désactive le consentement global à la télémétrie (opt-in). Refuser efface immédiatement la file locale (droit à l\'effacement). Équivalent deeplink : <code>bmm://telemetry/consent?enabled=true</code>.',
            fields: [{ name: 'enabled', type: 'boolean', required: true, desc: 'true pour activer la collecte, false pour la couper et purger.' }],
            responseStatuses: [{ code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "telemetry/consent" }' }, e401],
        },
        {
            method: 'POST', path: '/api/telemetry/settings', auth: true,
            desc: t('plugins.ep.telSettings') || 'Telemetry settings',
            about: 'Règle les sous-options de la télémétrie. Tout champ omis reste inchangé. Équivalent deeplink : <code>bmm://telemetry/settings?replay=true&full=false&bench=true</code>.',
            fields: [
                { name: 'replay', type: 'boolean', required: false, desc: 'Capture rrweb des sessions.' },
                { name: 'full', type: 'boolean', required: false, desc: 'Replay non masqué (capture le texte saisi).' },
                { name: 'bench', type: 'boolean', required: false, desc: 'Envoi des résultats de benchmark hebdomadaires.' },
            ],
            responseStatuses: [{ code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "telemetry/set" }' }, e401],
        },
        {
            method: 'POST', path: '/api/recorder', auth: true,
            desc: t('plugins.ep.recorder') || 'Session recorder',
            about: 'Configure l\'enregistreur de session local (rrweb + logs). Équivalent deeplink : <code>bmm://recorder/set?on=true&full=false&rust=true&js=true</code>.',
            fields: [
                { name: 'on', type: 'boolean', required: false, desc: 'Active/désactive l\'enregistrement.' },
                { name: 'full', type: 'boolean', required: false, desc: 'Capture non masquée.' },
                { name: 'rust', type: 'boolean', required: false, desc: 'Inclure les logs Rust backend.' },
                { name: 'js', type: 'boolean', required: false, desc: 'Inclure les logs console JS.' },
            ],
            responseStatuses: [{ code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "recorder/set" }' }, e401],
        },
        {
            method: 'POST', path: '/api/replay/export', auth: true,
            desc: t('plugins.ep.replayExport') || 'Export replay',
            about: 'Exporte la session rrweb en cours dans un fichier <code>.bmmreplay</code> (ouvre le sélecteur de destination dans l\'UI). Équivalent deeplink : <code>bmm://replay/export</code>.',
            fields: [],
            responseStatuses: [{ code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "replay/export" }' }, e401],
        },
        {
            method: 'POST', path: '/api/replay/import', auth: true,
            desc: t('plugins.ep.replayImport') || 'Import replay',
            about: 'Importe puis lit un fichier <code>.bmmreplay</code> depuis un chemin local ou une URL. Équivalent deeplink : <code>bmm://replay/import?path=&lt;...&gt;</code> ou <code>?url=&lt;...&gt;</code>.',
            fields: [
                { name: 'path', type: 'string', required: false, desc: 'Chemin local du .bmmreplay.' },
                { name: 'url', type: 'string', required: false, desc: 'URL distante du .bmmreplay (alternative à path).' },
            ],
            responseStatuses: [{ code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "replay/import" }' }, e401],
        },
        // ── Automation / run ──────────────────────────────────────────────────
        {
            method: 'POST', path: '/api/benchmark', auth: true,
            desc: t('plugins.ep.benchmark') || 'Run benchmark',
            about: 'Lance une exécution de benchmark. <code>mode:"manual"</code> ouvre le benchmark dans l\'UI ; <code>"auto"</code> le démarre directement. <code>dataset</code> : "sandbox" ou "real" (avec <code>sources</code>). Équivalent deeplink : <code>bmm://benchmark/run?dataset=sandbox&size=M</code>.',
            fields: [
                { name: 'dataset', type: 'string', required: false, desc: '"sandbox" (généré) ou "real" (utilise sources).' },
                { name: 'size', type: 'string', required: false, desc: 'Taille du jeu sandbox : S, M, L.' },
                { name: 'mode', type: 'string', required: false, desc: '"manual" (ouvre l\'UI) ou "auto".' },
                { name: 'sources', type: 'array', required: false, desc: 'Chemins de dossiers de mods (dataset="real").' },
                { name: 'profiles', type: 'array', required: false, desc: 'IDs de profils à benchmarker.' },
            ],
            responseStatuses: [{ code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "benchmark/run" }' }, e401],
        },
        {
            method: 'POST', path: '/api/launchpack/run', auth: true,
            desc: t('plugins.ep.runLaunchpack') || 'Run launch pack',
            about: 'Exécute un Launch Pack enregistré par son ID. Équivalent deeplink : <code>bmm://launchpack/run?id=&lt;ID&gt;</code>.',
            fields: [{ name: 'id', type: 'string', required: true, desc: 'ID du launch pack.' }],
            responseStatuses: [{ code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "launchpack/run" }' }, e401],
        },
        {
            method: 'POST', path: '/api/schedule/run', auth: true,
            desc: t('plugins.ep.runTask') || 'Run scheduled task',
            about: 'Déclenche immédiatement une tâche planifiée enregistrée par son ID. Équivalent deeplink : <code>bmm://schedule/run?id=&lt;ID&gt;</code>.',
            fields: [{ name: 'id', type: 'string', required: true, desc: 'ID de la tâche planifiée.' }],
            responseStatuses: [{ code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "schedule/run" }' }, e401],
        },
        {
            method: 'POST', path: '/api/discord/rpc', auth: true,
            desc: t('plugins.ep.discordRpc') || 'Discord Rich Presence',
            about: 'Active ou désactive la Rich Presence Discord. Équivalent deeplink : <code>bmm://discord/rpc?enabled=true</code>.',
            fields: [{ name: 'enabled', type: 'boolean', required: true, desc: 'true pour activer la présence Discord.' }],
            responseStatuses: [{ code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "discord/rpc" }' }, e401],
        },
        {
            method: 'POST', path: '/api/data/export-auto', auth: true,
            desc: t('plugins.ep.exportAuto') || 'Auto backup',
            about: 'Sauvegarde sans surveillance de <code>data.json</code> vers un dossier, avec un modèle de nom et une règle d\'incrément. Équivalent deeplink : <code>bmm://data/export-auto?dir=&lt;...&gt;&amp;name=bmm-backup-{date}&amp;increment=paren</code>.',
            fields: [
                { name: 'dir', type: 'string', required: true, desc: 'Dossier de destination.' },
                { name: 'name', type: 'string', required: false, desc: 'Modèle de nom de fichier : tokens {date}, {time}, {datetime}.' },
                { name: 'increment', type: 'string', required: false, desc: '"paren" (1)(2) · "underscore" _1 _2 · "timestamp" · "overwrite".' },
            ],
            responseStatuses: [{ code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "data/export-auto" }' }, e401],
        },
        {
            method: 'POST', path: '/api/view', auth: true,
            desc: t('plugins.ep.view'),
            about: t('plugins.epAbout.view'),
            fields: [
                { name: 'id', type: 'string', required: true, desc: 'Which screen: mods, profiles, repo, plugins, settings, apps, docs…' },
            ],
            responseStatuses: [{ code: 200, label: 'OK', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "view/open" }' }, e401],
        },
        // ── Added after an audit against the router ──────────────────────────
        //
        // Six routes existed and were reachable, and none of them was in this list — which is
        // the list people actually click. A route the documentation describes and the app does
        // not offer is a feature nobody finds from inside the app.
        {
            method: 'GET', path: '/api/schedules', auth: true,
            desc: t('plugins.ep.schedules'),
            about: t('plugins.epAbout.schedules'),
            fields: null,
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "schedules": [ { "id": "sched-1", "name": "Nightly", "enabled": true, "trigger": "dailyAt" } ] }' },
                e401,
            ],
        },
        {
            method: 'GET', path: '/api/mods/order', auth: true,
            desc: t('plugins.ep.orderGet'),
            about: t('plugins.epAbout.orderGet'),
            fields: null,
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "mods": [ { "id": "a", "name": "A", "position": 0, "contested": 2, "winning": 0 } ], "contested": [ { "path": "x/y.lua", "mods": ["a","b"], "winner": "b" } ] }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/mods/order', auth: true,
            desc: t('plugins.ep.orderSet'),
            about: t('plugins.epAbout.orderSet'),
            fields: [
                { name: 'order', type: 'array', required: true, desc: 'Every active mod id, in deployment order. Last wins a shared file.' },
                { name: 'profileId', type: 'string', required: false, desc: 'Which profile. Default: the active one.' },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "moved": 3 }' },
                { code: 400, label: 'Bad Request', body: '{ "error": "order.errNotPermutation" }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/repo/update-now', auth: true,
            desc: t('plugins.ep.updateNow'),
            about: t('plugins.epAbout.updateNow'),
            fields: [
                { name: 'repoDir', type: 'string', required: true, desc: t('plugins.epF.unDir') },
                { name: 'authorName', type: 'string', required: false, desc: t('plugins.epF.unAuthor') },
                { name: 'ops', type: 'string', required: false, desc: t('plugins.epF.unOps') },
            ],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "repo/update-now" }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/repo/host-now', auth: true,
            desc: t('plugins.ep.hostNow'),
            about: t('plugins.epAbout.hostNow'),
            fields: [
                { name: 'path', type: 'string', required: true, desc: t('plugins.epF.hnPath') },
                { name: 'port', type: 'number', required: true, desc: t('plugins.epF.hnPort') },
                { name: 'uploadLimit', type: 'number', required: false, desc: t('plugins.epF.hnLimit') },
                { name: 'downloadPassword', type: 'string', required: false, desc: t('plugins.epF.hnPw') },
                { name: 'authorizedKeys', type: 'string', required: false, desc: t('plugins.epF.hnKeys') },
            ],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "repo/host-now" }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/repo/gen-now', auth: true,
            desc: t('plugins.ep.genNow'),
            about: t('plugins.epAbout.genNow'),
            fields: [
                { name: 'outputDir', type: 'string', required: true, desc: t('plugins.epF.gnOut') },
                { name: 'authorName', type: 'string', required: true, desc: t('plugins.epF.gnAuthor') },
                { name: 'profileIds', type: 'string', required: true, desc: t('plugins.epF.gnProfiles') },
                { name: 'seed', type: 'string', required: false, desc: t('plugins.epF.gnSeed') },
                { name: 'zipOutput', type: 'boolean', required: false, desc: t('plugins.epF.gnZip') },
                { name: 'zipMods', type: 'boolean', required: false, desc: t('plugins.epF.gnZipMods') },
            ],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "repo/gen-now" }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/repo/sync-now', auth: true,
            desc: t('plugins.ep.syncNow'),
            about: t('plugins.epAbout.syncNow'),
            fields: [
                { name: 'url', type: 'string', required: true, desc: t('plugins.epF.snUrl') },
                { name: 'repoProfile', type: 'string', required: true, desc: t('plugins.epF.snRepoProfile') },
                { name: 'targetProfile', type: 'string', required: true, desc: t('plugins.epF.snTarget') },
                { name: 'gameDir', type: 'string', required: true, desc: t('plugins.epF.snGame') },
                { name: 'modsDir', type: 'string', required: true, desc: t('plugins.epF.snMods') },
                { name: 'backupDir', type: 'string', required: false, desc: t('plugins.epF.snBackup') },
                { name: 'password', type: 'string', required: false, desc: t('plugins.epF.snPassword') },
                { name: 'overwriteAll', type: 'boolean', required: false, desc: t('plugins.epF.snOverwrite') },
                { name: 'deleteExtra', type: 'boolean', required: false, desc: t('plugins.epF.snDelete') },
            ],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "repo/sync-now" }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/content-id', auth: true,
            desc: t('plugins.ep.contentId'),
            about: t('plugins.epAbout.contentId'),
            fields: [
                { name: 'kind', type: 'string', required: true, desc: t('plugins.epF.cidKind') },
                { name: 'id', type: 'string', required: false, desc: t('plugins.epF.cidId') },
                { name: 'path', type: 'string', required: false, desc: t('plugins.epF.cidPath') },
                { name: 'doc', type: 'string', required: false, desc: t('plugins.epF.cidDoc') },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "content_id": "plugin-3f221aad\u2026" }' },
                e401,
            ],
        },
        {
            method: 'GET', path: '/api/repo/modpacks', auth: true,
            desc: t('plugins.ep.repoModpacksGet'),
            about: t('plugins.epAbout.repoModpacks'),
            fields: [
                { name: 'dir', type: 'string', required: true, desc: t('plugins.epF.rmDirGet') },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "shares": [ { "modpack": { "id": "\u2026" }, "share_mode": "public" } ] }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/repo/modpacks', auth: true,
            desc: t('plugins.ep.repoModpacksSet'),
            about: t('plugins.epAbout.repoModpacksSet'),
            fields: [
                { name: 'dir', type: 'string', required: true, desc: t('plugins.epF.rmDirSet') },
                { name: 'shares', type: 'string', required: false, desc: t('plugins.epF.rmShares') },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "written": 2 }' },
                e401,
            ],
        },
        {
            method: 'GET', path: '/api/plugins/assets', auth: true,
            desc: t('plugins.ep.pluginAssets'),
            about: t('plugins.epAbout.pluginAssets'),
            fields: [
                { name: 'id', type: 'string', required: true, desc: 'The plugin id. Query string, not a body.' },
                { name: 'path', type: 'string', required: false, desc: 'One file, relative to assets/. Returns its text.' },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "assets": [ { "path": "README.md", "kind": "doc", "size": 812, "readable": true } ] }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/repo/publish-ssh', auth: true,
            desc: t('plugins.ep.publishSsh'),
            about: t('plugins.epAbout.publishSsh'),
            fields: [
                { name: 'dir', type: 'string', required: false, desc: 'The repo folder. Default: the one on screen.' },
            ],
            responseStatuses: [{ code: 200, label: 'OK', body: '{ "ok": true }' }, e401],
        },
        {
            method: 'POST', path: '/api/repo/fetch-ssh', auth: true,
            desc: t('plugins.ep.fetchSsh'),
            about: t('plugins.epAbout.fetchSsh'),
            fields: [
                { name: 'dir', type: 'string', required: false, desc: 'Where to fetch into. Default: the one on screen.' },
            ],
            responseStatuses: [{ code: 200, label: 'OK', body: '{ "ok": true }' }, e401],
        },
    ];
}
async function handleApiTest() {
    const methodSel = document.getElementById('pt-method');
    const pathInp = document.getElementById('pt-path');
    const bodyTa = document.getElementById('pt-body');
    const respDiv = document.getElementById('pt-response');
    const respPre = document.getElementById('pt-resp-body');
    const statusBadge = document.getElementById('pt-status-badge');
    if (!methodSel || !pathInp || !respDiv)
        return;
    const method = methodSel.value;
    let path = pathInp.value.trim();
    const bodyText = bodyTa?.value?.trim() || '';
    // Normalize path — must start with /
    if (path && !path.startsWith('/'))
        path = '/' + path;
    // Warn if :id placeholder not replaced
    if (path.includes(':id') || path.includes(':uuid')) {
        statusBadge.textContent = t('plugins.ptReplaceId') || 'Replace :id in the path';
        statusBadge.className = 'plug-tester-status plug-status-err';
        respDiv.style.display = 'block';
        respPre.textContent = t('plugins.ptReplaceIdDesc') || 'The path still contains a ":id" placeholder. Replace it with the real UUID.';
        return;
    }
    respDiv.style.display = 'block';
    respPre.textContent = t('common.loading') || 'Chargement…';
    statusBadge.textContent = '…';
    statusBadge.className = 'plug-tester-status';
    try {
        const headers = {
            'Authorization': `Bearer ${_apiToken}`,
        };
        const opts = { method, headers };
        // Send body for POST, PUT, PATCH, and DELETE (some DELETE routes need a body)
        const canHaveBody = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
        if (canHaveBody && bodyText) {
            // Be lenient like the quick test: tolerate // and /* */ comments and
            // trailing commas, then re-serialize to clean JSON. If it still won't
            // parse, send the raw text as-is and let the server respond — never
            // block the request on client-side validation.
            const cleaned = bodyText
                .replace(/\/\*[\s\S]*?\*\//g, '') // /* block */ comments
                .replace(/(^|[^:])\/\/.*$/gm, '$1') // // line comments (keep http://)
                .replace(/,(\s*[}\]])/g, '$1'); // trailing commas
            let sendBody = bodyText;
            try {
                sendBody = JSON.stringify(JSON.parse(cleaned));
            }
            catch {
                sendBody = bodyText;
            }
            headers['Content-Type'] = 'application/json';
            opts.body = sendBody;
        }
        const res = await fetch(`${apiBase()}${path}`, opts);
        const text = await res.text().catch(() => '');
        statusBadge.textContent = `${res.status} ${res.statusText}`;
        statusBadge.className = `plug-tester-status ${res.ok ? 'plug-status-ok' : 'plug-status-err'}`;
        let display;
        if (!text || text.trim() === '') {
            display = `// ${(t('plugins.ptEmptyResponse') || '(empty response — {s})').replace('{s}', `${res.status} ${res.statusText}`)}`;
        }
        else {
            try {
                const json = JSON.parse(text);
                display = JSON.stringify(json, null, 2);
            }
            catch {
                display = text; // plain text response
            }
        }
        const MAX_DISPLAY = 8000;
        if (display.length > MAX_DISPLAY)
            display = display.slice(0, MAX_DISPLAY) + `\n\n… ${(t('plugins.ptTruncated') || '[truncated — {n} chars]').replace('{n}', display.length.toLocaleString())}`;
        respPre.innerHTML = hlJson(display);
        // Live UI refresh after successful mutations
        if (res.ok && method !== 'GET') {
            if (path.includes('/profiles')) {
                window.dispatchEvent(new CustomEvent('bmm:profiles-updated'));
                window.dispatchEvent(new CustomEvent('bmm:mods-updated'));
            }
            if (path.includes('/mods') && !path.includes('/modpacks')) {
                window.dispatchEvent(new CustomEvent('bmm:mods-updated'));
            }
            if (path.includes('/modpacks')) {
                window.dispatchEvent(new CustomEvent('bmm://modpacks-updated'));
            }
        }
    }
    catch (e) {
        statusBadge.textContent = t('common.error') || 'Error';
        statusBadge.className = 'plug-tester-status plug-status-err';
        respPre.textContent = (t('plugins.ptNetworkError') || 'Network error: {e}\n\nMake sure BMM is running and the API is on port 51274.')
            .replace('{e}', String(e))
            .replace(/51274/g, new URL(apiBase()).port);
    }
}
function _showServerRepoAuthModal() {
    const ov = createOverlay(`
        <div class="plug-ov-header">
            <span class="plug-ov-title">${IC.lock} ${t('plugins.serverRepoAuthTitle')}</span>
            <button class="btn btn-xs btn-ghost plug-ov-close-btn">${IC.x}</button>
        </div>
        <div class="plug-ov-body" style="padding:16px;">
            <p style="font-size:13px;margin:0 0 12px;">${t('plugins.serverRepoAuthDesc')}</p>
            <ol style="font-size:12px;color:var(--text-muted);margin:0;padding-left:18px;line-height:1.8;">
                <li>${t('plugins.serverRepoAuthStep1')}</li>
                <li>${t('plugins.serverRepoAuthStep2')}</li>
                <li>${t('plugins.serverRepoAuthStep3')}</li>
            </ol>
        </div>
        <div class="plug-ov-footer">
            <button class="btn btn-accent" id="plug-sr-goto-settings">${IC.settings} ${t('plugins.serverRepoGotoSettings')}</button>
            <button class="btn btn-ghost plug-ov-close-btn">${t('common.close')}</button>
        </div>`);
    ov.querySelector('#plug-sr-goto-settings')?.addEventListener('click', () => {
        ov.remove();
        document.querySelector('.nav-item[data-view="settings"]')?.click();
    });
    ov.querySelectorAll('.plug-ov-close-btn').forEach(b => b.addEventListener('click', () => ov.remove()));
}
const _CAT_META = {
    mods: { color: '#3b82f6', label: 'BMM' },
    repo: { color: '#a855f7', label: 'Repo' },
    apps: { color: '#f97316', label: 'Apps' },
    read: { color: '#06b6d4', label: 'Read' },
    system: { color: '#10b981', label: 'System' },
    control: { color: '#f59e0b', label: 'Control' },
};
function _actionCatalog() {
    const sv = (p) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
    // i18n helper: t('plugins.<key>') with an English fallback when the key is missing.
    const d = (k, fb) => t('plugins.' + k) || fb;
    // Options for "Linked API": every action that performs an API call, so an
    // if_api_ok / if_api_err can be linked to (and run) any of them directly.
    const apiActionOpts = [
        { value: '', label: d('optApiLast', '— check the previous API call —') },
        { value: 'enable_mod', label: d('actionEnableMod', 'Enable mod') },
        { value: 'disable_mod', label: d('actionDisableMod', 'Disable mod') },
        { value: 'activate_profile', label: d('actionActivateProfile', 'Switch profile') },
        { value: 'enable_modpack', label: d('actionEnableModpack', 'Enable modpack') },
        { value: 'disable_modpack', label: d('actionDisableModpack', 'Disable modpack') },
        { value: 'apply_plugin', label: d('actionApplyPlugin', 'Apply plugin') },
        { value: 'compare_plugin', label: d('actionComparePlugin', 'Compare plugin') },
        { value: 'delete_mod', label: d('actionDeleteMod', 'Delete mod') },
        { value: 'update_mod', label: d('actionUpdateMod', 'Update mod') },
        { value: 'create_profile', label: d('actionCreateProfile', 'Create profile') },
        { value: 'update_profile', label: d('actionUpdateProfile', 'Update profile') },
        { value: 'delete_profile', label: d('actionDeleteProfile', 'Delete profile') },
        { value: 'create_modpack', label: d('actionCreateModpack', 'Create modpack') },
        { value: 'delete_modpack', label: d('actionDeleteModpack', 'Delete modpack') },
        { value: 'sync_repo', label: d('actionSyncRepo', 'Sync repo') },
        { value: 'cancel_sync', label: d('actionCancelSync', 'Cancel sync') },
        { value: 'gen_repo', label: d('actionGenRepo', 'Generate repo') },
        { value: 'cancel_gen', label: d('actionCancelGen', 'Cancel gen') },
        { value: 'http_host', label: d('actionHttpHost', 'Start HTTP host') },
        { value: 'stop_http_host', label: d('actionStopHttpHost', 'Stop HTTP host') },
        { value: 'repo_connect', label: d('actionRepoConnect', 'Connect repo') },
        { value: 'repo_remove', label: d('actionRepoRemove', 'Remove repo') },
        { value: 'restart', label: d('actionRestart', 'Restart BMM') },
        { value: 'get_status', label: d('actionGetStatus', 'Get status') },
        { value: 'api_health', label: d('actionApiHealth', 'API health') },
        { value: 'check_update', label: d('actionCheckUpdate', 'Check for update') },
        { value: 'list_mods', label: d('actionListMods', 'List mods') },
        { value: 'list_active_mods', label: d('actionListActiveMods', 'List active mods') },
        { value: 'list_all_mods', label: d('actionListAllMods', 'List all mods (all profiles)') },
        { value: 'list_profiles', label: d('actionListProfiles', 'List profiles') },
        { value: 'list_plugins', label: d('actionListPlugins', 'List plugins') },
        { value: 'list_modpacks', label: d('actionListModpacks', 'List modpacks') },
        { value: 'get_creator_id', label: d('actionGetCreatorId', 'Get creator ID') },
        { value: 'repo_list', label: d('actionRepoList', 'List repos') },
        { value: 'repo_info', label: d('actionRepoInfo', 'Repo info') },
        { value: 'update_repo', label: d('actionUpdateRepo', 'Update repo') },
        { value: 'install_app', label: d('actionInstallApp', 'Install app') },
        { value: 'launch_app', label: d('actionLaunchApp', 'Launch app') },
        { value: 'list_installed_apps', label: d('actionListInstalledApps', 'List installed apps') },
        { value: 'telemetry_consent', label: d('actionTelemetryConsent', 'Telemetry consent') },
        { value: 'telemetry_settings', label: d('actionTelemetrySettings', 'Telemetry options') },
        { value: 'recorder_set', label: d('actionRecorderSet', 'Session recorder') },
        { value: 'replay_export', label: d('actionReplayExport', 'Export replay') },
        { value: 'replay_import', label: d('actionReplayImport', 'Import replay') },
        { value: 'check_mod_updates', label: d('actionCheckModUpdates', 'Check mod updates') },
        { value: 'run_launchpack', label: d('actionRunLaunchpack', 'Run launch pack') },
        { value: 'run_task', label: d('actionRunTask', 'Run scheduled task') },
        { value: 'run_benchmark', label: d('actionRunBenchmark', 'Run benchmark') },
        { value: 'discord_rpc', label: d('actionDiscordRpc', 'Discord Rich Presence') },
        { value: 'export_data', label: d('actionExportData', 'Export data (backup)') },
    ];
    return [
        // ── BMM ─────────────────────────────────────────────────────────
        { id: 'enable_mod', cat: 'mods', label: d('actionEnableMod', 'Enable mod'),
            desc: d('actionEnableModDesc', 'Activates the selected mod for the current profile.'),
            iconSvg: sv('<polyline points="20 6 9 17 4 12"/>'), target: 'mod' },
        { id: 'disable_mod', cat: 'mods', label: d('actionDisableMod', 'Disable mod'),
            desc: d('actionDisableModDesc', 'Deactivates the selected mod for the current profile.'),
            iconSvg: sv('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'), target: 'mod' },
        { id: 'activate_profile', cat: 'mods', label: d('actionActivateProfile', 'Switch profile'),
            desc: d('actionActivateProfileDesc', 'Makes the selected profile the active one.'),
            iconSvg: sv('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'), target: 'profile' },
        { id: 'enable_modpack', cat: 'mods', label: d('actionEnableModpack', 'Enable modpack'),
            desc: d('actionEnableModpackDesc', 'Enables the modpack tied to a profile.'),
            iconSvg: sv('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>'), target: 'profile' },
        { id: 'disable_modpack', cat: 'mods', label: d('actionDisableModpack', 'Disable modpack'),
            desc: d('actionDisableModpackDesc', 'Disables the modpack tied to a profile.'),
            iconSvg: sv('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><line x1="3" y1="3" x2="21" y2="21"/>'), target: 'profile' },
        { id: 'apply_plugin', cat: 'mods', label: d('actionApplyPlugin', 'Apply plugin'),
            desc: d('actionApplyPluginDesc', 'Runs an installed plugin.'),
            iconSvg: sv('<path d="M5 3v18l14-9z"/>'), target: 'plugin' },
        { id: 'compare_plugin', cat: 'mods', label: d('actionComparePlugin', 'Compare plugin'),
            desc: d('actionComparePluginDesc', 'Compares the plugin\'s modlist against currently-enabled mods.'),
            iconSvg: sv('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>'), target: 'plugin' },
        { id: 'update_modpack', cat: 'mods', label: d('actionUpdateModpack', 'Update modpack'),
            desc: d('actionUpdateModpackDesc', 'Renames a modpack and/or changes its dependency mode.'),
            iconSvg: sv('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'),
            fields: [
                { key: 'modpack_id', label: d('fldModpackId', 'Modpack ID'), type: 'text', placeholder: d('phModpackIdUpdate', 'UUID of the modpack to update') },
                { key: 'name', label: d('fldNewName', 'New name'), type: 'text', placeholder: 'My pack', half: true },
                { key: 'dependency_mode', label: d('fldDependencies', 'Dependencies'), type: 'select', half: true,
                    options: [
                        { value: 'none', label: d('optDepNoneLeave', 'None — leave deps alone') },
                        { value: 'include', label: d('optDepInclude', 'Include all deps') },
                        { value: 'exclude', label: d('optDepExclude', 'Exclude all deps') },
                    ], default: 'none' },
            ] },
        { id: 'delete_mod', cat: 'mods', label: d('actionDeleteMod', 'Delete mod'),
            desc: d('actionDeleteModDesc', 'Permanently removes the selected mod.'),
            iconSvg: sv('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'), target: 'mod' },
        { id: 'update_mod', cat: 'mods', label: d('actionUpdateMod', 'Update mod'),
            desc: d('actionUpdateModDesc', 'Edits metadata (name/version/author/description) of the selected mod.'),
            iconSvg: sv('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'), target: 'mod',
            fields: [
                { key: 'name', label: d('fldName', 'Name'), type: 'text', placeholder: d('phKeepEmpty', '(leave empty = keep)'), half: true },
                { key: 'version', label: d('fldVersion', 'Version'), type: 'text', placeholder: d('phKeepEmpty', '(leave empty = keep)'), half: true },
                { key: 'author', label: d('fldAuthor', 'Author'), type: 'text', placeholder: d('phKeepEmpty', '(leave empty = keep)'), half: true },
                { key: 'description', label: d('fldDescription', 'Description'), type: 'text', placeholder: d('phKeepEmpty', '(leave empty = keep)'), half: true },
            ] },
        { id: 'create_profile', cat: 'mods', label: d('actionCreateProfile', 'Create profile'),
            desc: d('actionCreateProfileDesc', 'Creates a new profile.'),
            iconSvg: sv('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>'),
            fields: [
                { key: 'name', label: d('fldName', 'Name'), type: 'text', placeholder: 'My profile' },
                { key: 'game_name', label: d('fldGameName', 'Game name'), type: 'text', placeholder: 'Skyrim', half: true },
                { key: 'game_path', label: d('fldGamePath', 'Game path'), type: 'folder', placeholder: 'C:/Games/Skyrim', half: true },
                { key: 'mods_path', label: d('fldModsPath', 'Mods path'), type: 'folder', placeholder: 'C:/Mods', half: true },
                { key: 'backup_path', label: d('fldBackupPath', 'Backup path'), type: 'folder', placeholder: 'C:/Backups', half: true },
            ] },
        { id: 'update_profile', cat: 'mods', label: d('actionUpdateProfile', 'Update profile'),
            desc: d('actionUpdateProfileDesc', 'Edits the selected profile. Empty fields are left unchanged.'),
            iconSvg: sv('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'), target: 'profile',
            fields: [
                { key: 'name', label: d('fldName', 'Name'), type: 'text', placeholder: d('phKeep', '(keep)'), half: true },
                { key: 'game_name', label: d('fldGameName', 'Game name'), type: 'text', placeholder: d('phKeep', '(keep)'), half: true },
                { key: 'color', label: d('fldColor', 'Color'), type: 'text', placeholder: '#3b82f6', half: true },
                { key: 'icon', label: d('fldIcon', 'Icon'), type: 'text', placeholder: d('phKeep', '(keep)'), half: true },
                { key: 'game_path', label: d('fldGamePath', 'Game path'), type: 'folder', placeholder: d('phKeep', '(keep)'), half: true },
                { key: 'mods_path', label: d('fldModsPath', 'Mods path'), type: 'folder', placeholder: d('phKeep', '(keep)'), half: true },
                { key: 'backup_path', label: d('fldBackupPath', 'Backup path'), type: 'folder', placeholder: d('phKeep', '(keep)'), half: true },
            ] },
        { id: 'delete_profile', cat: 'mods', label: d('actionDeleteProfile', 'Delete profile'),
            desc: d('actionDeleteProfileDesc', 'Permanently removes the selected profile.'),
            iconSvg: sv('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'), target: 'profile' },
        { id: 'create_modpack', cat: 'mods', label: d('actionCreateModpack', 'Create modpack'),
            desc: d('actionCreateModpackDesc', 'Creates a new modpack.'),
            iconSvg: sv('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><line x1="12" y1="22" x2="12" y2="12"/>'),
            fields: [
                { key: 'name', label: d('fldName', 'Name'), type: 'text', placeholder: 'My pack' },
                { key: 'description', label: d('fldDescription', 'Description'), type: 'text', placeholder: d('phOptional', '(optional)'), half: true },
                { key: 'game_name', label: d('fldGameName', 'Game name'), type: 'text', placeholder: d('phOptional', '(optional)'), half: true },
                { key: 'sr_link', label: d('fldSrLink', 'Server Repo link'), type: 'text', placeholder: d('phOptional', '(optional)'), half: true },
                { key: 'dependency_mode', label: d('fldDependencies', 'Dependencies'), type: 'select', half: true,
                    options: [
                        { value: 'none', label: d('optDepNone', 'None') },
                        { value: 'include', label: d('optDepInclude', 'Include all deps') },
                        { value: 'exclude', label: d('optDepExclude', 'Exclude all deps') },
                    ], default: 'none' },
            ] },
        { id: 'delete_modpack', cat: 'mods', label: d('actionDeleteModpack', 'Delete modpack'),
            desc: d('actionDeleteModpackDesc', 'Permanently removes a modpack by ID.'),
            iconSvg: sv('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
            fields: [{ key: 'modpack_id', label: d('fldModpackId', 'Modpack ID'), type: 'text', placeholder: d('phModpackId', 'UUID of the modpack') }] },
        // ── Repo ────────────────────────────────────────────────────────
        { id: 'sync_repo', cat: 'repo', label: d('actionSyncRepo', 'Sync repo'),
            desc: d('actionSyncRepoDesc', 'Pulls a remote BMM repo into a local mods folder.'),
            iconSvg: sv('<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>'),
            fields: [
                { key: 'url', label: d('fldRepoUrl', 'Repo URL'), type: 'text', placeholder: 'https://repo.example.com' },
                { key: 'mods_dir', label: d('fldModsFolder', 'Mods folder'), type: 'text', placeholder: 'C:/Mods/MyGame' },
                { key: 'backup_dir', label: d('fldBackupFolder', 'Backup folder'), type: 'text', placeholder: 'C:/BMM/Backups' },
                { key: 'game_dir', label: d('fldGameRootOpt', 'Game root (opt)'), type: 'text', placeholder: 'C:/Games/MyGame', half: true },
                { key: 'download_limit', label: d('fldDlLimit', 'DL limit (KB/s)'), type: 'number', placeholder: d('phUnlimited', '0 = unlimited'), default: '0', half: true },
                { key: 'password', label: d('fldRepoPassword', 'Download password'), type: 'text', placeholder: d('phOptional', '(optional)'), half: true },
                { key: 'overwrite_all', label: d('fldOverwriteAll', 'Overwrite all'), type: 'switch', default: false, half: true },
                { key: 'delete_extra', label: d('fldDeleteExtra', 'Delete extra'), type: 'switch', default: false, half: true },
            ] },
        { id: 'cancel_sync', cat: 'repo', label: d('actionCancelSync', 'Cancel sync'),
            desc: d('actionCancelSyncDesc', 'Stops a running repo sync. No parameters.'),
            iconSvg: sv('<rect x="6" y="6" width="12" height="12" rx="1"/>') },
        { id: 'gen_repo', cat: 'repo', label: d('actionGenRepo', 'Generate repo'),
            desc: d('actionGenRepoDesc', 'Exports your active profile as a redistributable repo folder/zip.'),
            iconSvg: sv('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 12 15 15"/>'),
            fields: [
                { key: 'profile_id', label: d('fldProfileUuid', 'Profile UUID'), type: 'text', placeholder: d('phActiveProfile', 'Leave empty = active profile') },
                { key: 'output_dir', label: d('fldOutputFolder', 'Output folder'), type: 'folder', placeholder: 'C:/Export' },
                { key: 'author', label: d('fldAuthorName', 'Author name'), type: 'text', placeholder: d('phYourName', 'Your name'), half: true },
                { key: 'port', label: d('fldPortServer', 'Port (server)'), type: 'number', placeholder: '8080', default: '8080', half: true },
                { key: 'admin_pass', label: d('fldAdminPass', 'Admin password'), type: 'text', placeholder: d('phOptional', '(optional)'), half: true },
                { key: 'upload_limit', label: d('fldUlLimit', 'UL limit (KB/s)'), type: 'number', placeholder: d('phUnlimited', '0 = unlimited'), default: '0', half: true },
                { key: 'lightweight', label: d('fldLightweight', 'Lightweight'), type: 'switch', default: false, half: true },
                { key: 'zip', label: d('fldZipOutput', 'Zip output'), type: 'switch', default: true, half: true },
                { key: 'generate_server', label: d('fldGenerateServer', 'Generate server'), type: 'switch', default: false, half: true },
                { key: 'auto_start', label: d('fldAutoStart', 'Auto start'), type: 'switch', default: false, half: true },
            ] },
        { id: 'cancel_gen', cat: 'repo', label: d('actionCancelGen', 'Cancel gen'),
            desc: d('actionCancelGenDesc', 'Stops a running repo generation. No parameters.'),
            iconSvg: sv('<rect x="6" y="6" width="12" height="12" rx="1"/>') },
        { id: 'http_host', cat: 'repo', label: d('actionHttpHost', 'Start HTTP host'),
            desc: d('actionHttpHostDesc', 'Starts the local repo HTTP server so others can sync from you.'),
            iconSvg: sv('<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>'),
            fields: [
                { key: 'serve_dir', label: d('fldFolderToHost', 'Folder to host'), type: 'folder', placeholder: 'C:/Export' },
                { key: 'port', label: d('fldPort', 'Port'), type: 'number', placeholder: '8080', default: '8080', half: true },
                { key: 'upload_limit', label: d('fldUlLimit', 'UL limit (KB/s)'), type: 'number', placeholder: d('phUnlimited', '0 = unlimited'), default: '0', half: true },
            ] },
        { id: 'stop_http_host', cat: 'repo', label: d('actionStopHttpHost', 'Stop HTTP host'),
            desc: d('actionStopHttpHostDesc', 'Stops the local HTTP server. No parameters.'),
            iconSvg: sv('<rect x="6" y="6" width="12" height="12" rx="1"/>') },
        { id: 'update_repo', cat: 'repo', label: d('actionUpdateRepo', 'Update repo'),
            desc: d('actionUpdateRepoDesc', 'Incrementally updates an existing server repo (add/remove mods & profiles). Opens the BMM update modal.'),
            iconSvg: sv('<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.76"/>'),
            fields: [{ key: 'repoDir', label: d('fldRepoDir', 'Repo folder'), type: 'text', placeholder: 'C:/MyRepo' }] },
        { id: 'repo_connect', cat: 'repo', label: d('actionRepoConnect', 'Connect repo'),
            desc: d('actionRepoConnectDesc', 'Registers a remote BMM repo by URL.'),
            iconSvg: sv('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
            fields: [{ key: 'url', label: d('fldRepoUrl', 'Repo URL'), type: 'text', placeholder: 'https://repo.example.com' }] },
        { id: 'repo_remove', cat: 'repo', label: d('actionRepoRemove', 'Remove repo'),
            desc: d('actionRepoRemoveDesc', 'Unregisters a connected repo by URL.'),
            iconSvg: sv('<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>'),
            fields: [{ key: 'url', label: d('fldRepoUrl', 'Repo URL'), type: 'text', placeholder: 'https://repo.example.com' }] },
        // ── App Catalog ──────────────────────────────────────────────────
        { id: 'install_app', cat: 'apps', label: d('actionInstallApp', 'Install app'),
            desc: d('actionInstallAppDesc', 'Triggers the BMM App Catalog install flow for the specified app.'),
            iconSvg: sv('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
            fields: [
                { key: 'appId', label: d('fldAppId', 'App ID'), type: 'text', placeholder: 'my-app' },
                { key: 'appTitle', label: d('fldAppTitle', 'Title'), type: 'text', placeholder: 'My App' },
                { key: 'downloadUrl', label: d('fldDlUrl', 'Download URL'), type: 'text', placeholder: 'https://github.com/.../app.exe' },
                { key: 'fileType', label: d('fldFileType', 'File type'), type: 'select', options: ['exe', 'zip', 'msi', 'script'] },
            ] },
        { id: 'launch_app', cat: 'apps', label: d('actionLaunchApp', 'Launch app'),
            desc: d('actionLaunchAppDesc', 'Launches an app already installed through the BMM App Catalog.'),
            iconSvg: sv('<polygon points="5 3 19 12 5 21 5 3"/>'),
            fields: [
                { key: 'appId', label: d('fldAppId', 'App ID'), type: 'text', placeholder: 'my-app' },
                { key: 'exePath', label: d('fldExePath', 'Exe path'), type: 'file', placeholder: 'C:/Apps/my-app.exe' },
            ] },
        { id: 'list_installed_apps', cat: 'apps', label: d('actionListInstalledApps', 'List installed apps'),
            desc: d('actionListInstalledAppsDesc', 'Fetches all apps installed through the BMM App Catalog.'),
            iconSvg: sv('<rect x="2" y="3" width="7" height="7"/><rect x="15" y="3" width="7" height="7"/><rect x="15" y="14" width="7" height="7"/><rect x="2" y="14" width="7" height="7"/>') },
        { id: 'uninstall_app', cat: 'apps', label: d('actionUninstallApp', 'Uninstall app'),
            desc: d('actionUninstallAppDesc', 'Removes an app from the BMM registry (files kept on disk).'),
            iconSvg: sv('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>'),
            fields: [{ key: 'appId', label: d('fldAppId', 'App ID'), type: 'text', placeholder: 'my-app' }] },
        // ── Read (GET — no token required) ────────────────────────────────
        { id: 'get_status', cat: 'read', label: d('actionGetStatus', 'Get status'),
            desc: d('actionGetStatusDesc', 'Fetches the current BMM status. Prints the JSON response.'),
            iconSvg: sv('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>') },
        { id: 'list_mods', cat: 'read', label: d('actionListMods', 'List mods'),
            desc: d('actionListModsDesc', 'Lists all mods. Prints the JSON response.'),
            iconSvg: sv('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>') },
        { id: 'list_active_mods', cat: 'read', label: d('actionListActiveMods', 'List active mods'),
            desc: d('actionListActiveModsDesc', 'Lists currently-enabled mods. Prints the JSON response.'),
            iconSvg: sv('<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>') },
        { id: 'list_all_mods', cat: 'read', label: d('actionListAllMods', 'List all mods (all profiles)'),
            desc: d('actionListAllModsDesc', 'Lists every mod across ALL profiles, grouped by profile. Prints the JSON response.'),
            iconSvg: sv('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>') },
        { id: 'list_profiles', cat: 'read', label: d('actionListProfiles', 'List profiles'),
            desc: d('actionListProfilesDesc', 'Lists all profiles. Prints the JSON response.'),
            iconSvg: sv('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>') },
        { id: 'list_plugins', cat: 'read', label: d('actionListPlugins', 'List plugins'),
            desc: d('actionListPluginsDesc', 'Lists installed plugins. Prints the JSON response.'),
            iconSvg: sv('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>') },
        { id: 'list_modpacks', cat: 'read', label: d('actionListModpacks', 'List modpacks'),
            desc: d('actionListModpacksDesc', 'Lists all modpacks. Prints the JSON response.'),
            iconSvg: sv('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>') },
        { id: 'check_update', cat: 'read', label: d('actionCheckUpdate', 'Check for update'),
            desc: d('actionCheckUpdateDesc', 'Checks whether a BMM update is available. Prints the JSON response.'),
            iconSvg: sv('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>') },
        { id: 'get_creator_id', cat: 'read', label: d('actionGetCreatorId', 'Get creator ID'),
            desc: d('actionGetCreatorIdDesc', 'Fetches the creator ID. Prints the JSON response.'),
            iconSvg: sv('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>') },
        { id: 'api_health', cat: 'read', label: d('actionApiHealth', 'API health'),
            desc: d('actionApiHealthDesc', 'Pings the API health endpoint. Prints the JSON response.'),
            iconSvg: sv('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>') },
        { id: 'repo_list', cat: 'read', label: d('actionRepoList', 'List repos'),
            desc: d('actionRepoListDesc', 'Lists connected repos. Prints the JSON response.'),
            iconSvg: sv('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>') },
        { id: 'repo_info', cat: 'read', label: d('actionRepoInfo', 'Repo info'),
            desc: d('actionRepoInfoDesc', 'Fetches metadata for a repo by URL. Prints the JSON response.'),
            iconSvg: sv('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'),
            fields: [
                { key: 'url', label: d('fldRepoUrl', 'Repo URL'), type: 'text', placeholder: 'https://repo.example.com' },
                { key: 'password', label: d('fldRepoPassword', 'Download password'), type: 'text', placeholder: d('phOptional', '(optional)') },
            ] },
        // ── System ──────────────────────────────────────────────────────
        { id: 'wait', cat: 'system', label: d('actionWait', 'Wait'),
            desc: d('actionWaitDesc', 'Pauses the script for N seconds.'),
            iconSvg: sv('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
            fields: [{ key: 'duration_s', label: d('fldSeconds', 'Seconds'), type: 'number', placeholder: '3', default: '3' }] },
        { id: 'close_process', cat: 'system', label: d('actionCloseProcess', 'Kill process'),
            desc: d('actionCloseProcessDesc', 'Force-terminates a running process by executable name.'),
            iconSvg: sv('<path d="M18 6L6 18M6 6l12 12"/>'),
            fields: [{ key: 'process_name', label: d('fldProcessName', 'Process name'), type: 'text', placeholder: 'notepad.exe' }] },
        { id: 'open_url', cat: 'system', label: d('actionOpenUrl', 'Open URL'),
            desc: d('actionOpenUrlDesc', 'Opens a URL in the default browser.'),
            iconSvg: sv('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
            fields: [{ key: 'url', label: d('fldUrl', 'URL'), type: 'text', placeholder: 'https://example.com' }] },
        { id: 'show_message', cat: 'system', label: d('actionShowMessage', 'Show message'),
            desc: d('actionShowMessageDesc', 'Displays a message popup or console line, then waits for the user.'),
            iconSvg: sv('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'),
            fields: [{ key: 'message', label: d('fldMessage', 'Message'), type: 'textarea', placeholder: 'Hello world' }] },
        { id: 'launch_game', cat: 'system', label: d('actionLaunchGame', 'Launch game'),
            desc: d('actionLaunchGameDesc', 'Starts a game executable then waits 1 second.'),
            iconSvg: sv('<polygon points="5 3 19 12 5 21 5 3"/>'),
            fields: [{ key: 'exe_path', label: d('fldGameExe', 'Game executable'), type: 'text', placeholder: 'C:/Games/MyGame/game.exe' }] },
        { id: 'log', cat: 'system', label: d('actionLog', 'Log line'),
            desc: d('actionLogDesc', 'Writes a message to the script\'s standard output / log.'),
            iconSvg: sv('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>'),
            fields: [{ key: 'message', label: d('fldMessage', 'Message'), type: 'text', placeholder: 'Step 1 done' }] },
        { id: 'restart', cat: 'system', label: d('actionRestart', 'Restart BMM'),
            desc: d('actionRestartDesc', 'Restarts the BetterModsManager app. No parameters.'),
            iconSvg: sv('<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>') },
        { id: 'run_benchmark', cat: 'mods', label: d('actionRunBenchmark', 'Run benchmark'),
            desc: d('actionRunBenchmarkDesc', 'Run a performance benchmark. "My mods" = pick profiles and/or add folders to benchmark.'),
            iconSvg: sv('<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/>'),
            fields: [
                { key: 'dataset', label: d('fldDataset', 'Dataset'), type: 'select', default: 'sandbox', half: true, options: [
                        { value: 'sandbox', label: d('optSandbox', 'Sandbox (synthetic)') },
                        { value: 'real', label: d('optMyMods', 'My mods (real)') },
                    ] },
                { key: 'size', label: d('fldSize', 'Size'), type: 'select', default: 'M', half: true, options: [
                        { value: 'S', label: 'S' }, { value: 'M', label: 'M' }, { value: 'L', label: 'L' }, { value: 'XL', label: 'XL' },
                    ] },
                { key: 'sources', label: d('fldBenchSources', 'Mods to benchmark (profiles / folders)'), type: 'folderlist' },
            ] },
        { id: 'run_launchpack', cat: 'system', label: d('actionRunLaunchpack', 'Run launch pack'),
            desc: d('actionRunLaunchpackDesc', 'Runs a saved launch pack (apply its profile/modpack + launch).'),
            iconSvg: sv('<path d="M5 3v18l14-9z"/>'), target: 'launchpack' },
        { id: 'run_task', cat: 'control', label: d('actionRunTask', 'Run scheduled task'),
            desc: d('actionRunTaskDesc', 'Triggers one of your saved Scheduling & automation tasks now.'),
            iconSvg: sv('<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>'), target: 'task' },
        { id: 'check_mod_updates', cat: 'mods', label: d('actionCheckModUpdates', 'Check mod updates'),
            desc: d('actionCheckModUpdatesDesc', 'Checks every linked mod against its server repo for updates.'),
            iconSvg: sv('<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>') },
        // ── Added with the endpoints they call ─────────────────────────────────
        //
        // A generated script speaks the same HTTP API the app does, so an endpoint that is
        // not here is one no script can reach — and the catalogue had drifted a whole
        // session behind. These are the ones added with the doorbell, the identity keys, the
        // catalogue sources and what a repo carries besides mods.
        { id: 'signal', cat: 'system', label: d('actionSignal', 'Send a signal (webhook)'),
            desc: d('actionSignalDesc', 'Rings a named doorbell a scheduled task may be waiting on. This is how a script tells BMM it has finished.'),
            iconSvg: sv('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
            fields: [
                { key: 'name', label: d('fldSignalName', 'Signal name'), type: 'text', placeholder: 'build-done' },
                { key: 'data', label: d('fldSignalData', 'Payload (optional)'), type: 'text', placeholder: '{"version":"1.4"}' },
            ] },
        { id: 'new_key', cat: 'system', label: d('actionNewKey', 'Make an identity key'),
            desc: d('actionNewKeyDesc', 'Generates a keypair on the ring. A name already taken is left alone, never replaced. The private half is never returned.'),
            iconSvg: sv('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>'),
            fields: [
                { key: 'name', label: d('fldKeyName', 'Name it'), type: 'text', placeholder: 'work' },
                { key: 'kind', label: d('fldKeyKind', 'Type'), type: 'select', default: 'ed25519', half: true, options: [
                        { value: 'ed25519', label: 'ed25519' },
                        { value: 'ecdsa', label: 'ECDSA (nistp256)' },
                        { value: 'rsa', label: 'RSA 4096' },
                    ] },
            ] },
        { id: 'follow_catalog', cat: 'system', label: d('actionFollowCatalog', 'Follow a catalogue'),
            desc: d('actionFollowCatalogDesc', 'Adds a catalogue source through the app, so it appears in the following list with an origin.'),
            iconSvg: sv('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
            fields: [
                { key: 'type', label: d('fldCatType', 'Kind'), type: 'select', default: 'plugin', half: true, options: [
                        { value: 'app', label: 'app' }, { value: 'plugin', label: 'plugin' },
                        { value: 'theme', label: 'theme' }, { value: 'preset', label: 'preset' },
                        { value: 'modpack', label: 'modpack' }, { value: 'repo', label: 'repo' },
                        { value: 'tutorial', label: 'tutorial' }, { value: 'list', label: 'list' },
                    ] },
                { key: 'url', label: d('fldCatUrl', 'Address'), type: 'text', placeholder: 'https://…/catalog.json' },
                { key: 'follow', label: d('fldFollow', 'Follow it'), type: 'switch', default: true },
            ] },
        { id: 'repo_take', cat: 'repo', label: d('actionRepoTake', 'Take something a repo carries'),
            desc: d('actionRepoTakeDesc', 'One plugin, automation, theme, mod list or catalogue from a repo. A plugin or automation arrives DISABLED.'),
            iconSvg: sv('<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>'),
            fields: [
                { key: 'url', label: d('fldRepoUrl', 'Repo URL'), type: 'text', placeholder: 'https://…/repo.json' },
                { key: 'kind', label: d('fldExtraKind', 'Kind'), type: 'select', default: 'theme', half: true, options: [
                        { value: 'plugin', label: 'plugin' }, { value: 'task', label: 'task' },
                        { value: 'theme', label: 'theme' }, { value: 'modlist', label: 'modlist' },
                        { value: 'bundle', label: 'bundle' }, { value: 'catalog', label: 'catalog' },
                        { value: 'app', label: 'app' },
                    ] },
                { key: 'id', label: d('fldExtraId', 'Its id'), type: 'text', half: true },
                { key: 'password', label: d('fldRepoPassword', 'Download password'), type: 'text', half: true },
            ] },
        // The four that RUN. Their screen-opening twins were already here; these are what a
        // generated script needs, because a script has nobody to press a button.
        { id: 'repo_sync_now', cat: 'repo', label: d('actionRepoSyncNow', 'Sync a repo (runs now)'),
            desc: d('actionRepoSyncNowDesc', 'Downloads and installs, rather than opening the sync form. Every field is required: each one missing is a way to sync into somewhere nobody chose.'),
            iconSvg: sv('<path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/>'),
            fields: [
                { key: 'url', label: d('fldRepoUrl', 'Repo URL'), type: 'text', placeholder: 'https://\u2026/repo.json' },
                { key: 'repoProfile', label: d('fldRepoProfile', 'Profile in the repo'), type: 'text', half: true },
                { key: 'targetProfile', label: d('fldTargetProfile', 'Into this local profile'), type: 'text', half: true },
                { key: 'gameDir', label: d('fldGameDir', 'Game folder'), type: 'text' },
                { key: 'modsDir', label: d('fldModsDir', 'Mods folder'), type: 'text' },
                { key: 'backupDir', label: d('fldBackupDir', 'Backup folder'), type: 'text', half: true },
                { key: 'password', label: d('fldRepoPassword', 'Download password'), type: 'text', half: true },
                { key: 'overwriteAll', label: d('fldOverwriteAll', 'Overwrite every file'), type: 'switch', default: false },
                { key: 'deleteExtra', label: d('fldDeleteExtra', 'Delete mods the repo does not have'), type: 'switch', default: false },
            ] },
        { id: 'repo_gen_now', cat: 'repo', label: d('actionRepoGenNow', 'Generate a repo (runs now)'),
            desc: d('actionRepoGenNowDesc', 'Writes the repo. An empty profile list is refused, never read as every profile on the machine.'),
            iconSvg: sv('<path d="M12 2v20"/><path d="M2 12h20"/>'),
            fields: [
                { key: 'outputDir', label: d('fldOutputDir', 'Write it here'), type: 'text' },
                { key: 'authorName', label: d('fldAuthorName', 'Author name'), type: 'text', half: true },
                { key: 'profileIds', label: d('fldProfileIds', 'Profile ids, comma separated'), type: 'text', half: true },
                { key: 'seed', label: d('fldSeed', 'Seed'), type: 'text', half: true },
                { key: 'zipOutput', label: d('fldZipOutput', 'Zip the whole repo'), type: 'switch', default: false },
                { key: 'zipMods', label: d('fldZipMods', 'Zip each mod'), type: 'switch', default: false },
            ] },
        { id: 'repo_host_now', cat: 'repo', label: d('actionRepoHostNow', 'Host a repo (starts now)'),
            desc: d('actionRepoHostNowDesc', 'Starts serving. The only way to host a PROTECTED repo without a person: it carries the download password and the allowed keys.'),
            iconSvg: sv('<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/>'),
            fields: [
                { key: 'path', label: d('fldServeDir', 'Folder to serve'), type: 'text' },
                { key: 'port', label: d('fldPort', 'Port'), type: 'text', half: true },
                { key: 'downloadPassword', label: d('fldRepoPassword', 'Download password'), type: 'text', half: true },
            ] },
        { id: 'repo_update_now', cat: 'repo', label: d('actionRepoUpdateNow', 'Update a repo (runs now)'),
            desc: d('actionRepoUpdateNowDesc', 'Rewrites the repo and re-signs its manifest. Naming no ops re-signs and changes nothing else, which is what you want after touching files by hand.'),
            iconSvg: sv('<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/>'),
            fields: [
                { key: 'repoDir', label: d('fldRepoDir', 'Repo folder'), type: 'text' },
                { key: 'authorName', label: d('fldAuthorName', 'Author name'), type: 'text', half: true },
            ] },
        { id: 'content_id', cat: 'system', label: d('actionContentId', 'Work out what something IS'),
            desc: d('actionContentIdDesc', 'The id that is the same wherever the content is the same, which is what do-you-have-what-I-have is asked with.'),
            iconSvg: sv('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
            fields: [
                { key: 'kind', label: d('fldCidKind', 'Kind'), type: 'select', default: 'modpack', half: true, options: [
                        { value: 'modpack', label: 'modpack' }, { value: 'plugin', label: 'plugin' },
                        { value: 'task', label: 'task' }, { value: 'profile', label: 'profile' },
                        { value: 'theme', label: 'theme' }, { value: 'launchpack', label: 'launchpack' },
                        { value: 'repo', label: 'repo' }, { value: 'app', label: 'app' },
                        { value: 'modlist', label: 'modlist' }, { value: 'bundle', label: 'bundle' },
                    ] },
                { key: 'id', label: d('fldCidId', 'Its id in BMM'), type: 'text', half: true },
                { key: 'path', label: d('fldCidPath', 'Or a file to read'), type: 'text' },
            ] },
        { id: 'open_view', cat: 'system', label: d('actionOpenView', 'Open a screen'),
            desc: d('actionOpenViewDesc', 'Switches BMM to a screen. Useful at the end of a script somebody is watching.'),
            iconSvg: sv('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>'),
            fields: [
                { key: 'id', label: d('fldViewId', 'Screen'), type: 'select', default: 'library', options: [
                        { value: 'library', label: 'library' }, { value: 'profiles', label: 'profiles' },
                        { value: 'modpacks', label: 'modpacks' }, { value: 'modlist', label: 'modlist' },
                        { value: 'mapper', label: 'mapper' }, { value: 'repo', label: 'repo' },
                        { value: 'apps', label: 'apps' }, { value: 'plugins', label: 'plugins' },
                        { value: 'community', label: 'community' }, { value: 'docs', label: 'docs' },
                        { value: 'settings', label: 'settings' }, { value: 'credits', label: 'credits' },
                    ] },
            ] },
        { id: 'repo_manifest', cat: 'repo', label: d('actionRepoManifest', 'Rebuild a repo manifest'),
            desc: d('actionRepoManifestDesc', 'Re-reads the folder and rewrites repo.json for a repo that is already hosted.'),
            iconSvg: sv('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'),
            fields: [
                { key: 'dir', label: d('fldRepoDir', 'Repo folder'), type: 'text' },
            ] },
        { id: 'set_schedule', cat: 'system', label: d('actionSetSchedule', 'Arm or disarm a task'),
            desc: d('actionSetScheduleDesc', 'Switches one saved scheduled task on or off by id.'),
            iconSvg: sv('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
            fields: [
                { key: 'id', label: d('fldTaskId', 'Task id'), type: 'text' },
                { key: 'enabled', label: d('fldEnabled', 'Enabled'), type: 'switch', default: true },
            ] },
        { id: 'discord_rpc', cat: 'system', label: d('actionDiscordRpc', 'Discord Rich Presence'),
            desc: d('actionDiscordRpcDesc', 'Enable or disable Discord Rich Presence.'),
            iconSvg: sv('<circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M7.5 7.2A14 14 0 0 1 12 6.5a14 14 0 0 1 4.5.7l1.8 4.2A9 9 0 0 1 12 13a9 9 0 0 1-6.3-1.6z"/>'),
            fields: [{ key: 'enabled', label: d('fldEnabled', 'Enabled'), type: 'switch', default: true }] },
        { id: 'export_data', cat: 'system', label: d('actionExportData', 'Export data (backup)'),
            desc: d('actionExportDataDesc', 'Unattended backup to a folder. Filename template: {date} {time} {datetime}.'),
            iconSvg: sv('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>'),
            fields: [
                { key: 'dir', label: d('fldExportFolder', 'Backup folder'), type: 'folder', placeholder: 'C:/BMM/Backups' },
                { key: 'name', label: d('fldFilenameTemplate', 'Filename template'), type: 'text', placeholder: 'bmm-backup-{date}', default: 'bmm-backup-{date}', half: true },
                { key: 'increment', label: d('fldIfExists', 'If file exists'), type: 'select', default: 'paren', half: true, options: [
                        { value: 'paren', label: d('optParen', 'Add (1), (2)…') },
                        { value: 'underscore', label: d('optUnderscore', 'Add _1, _2…') },
                        { value: 'timestamp', label: d('optTimestamp', 'Append timestamp') },
                        { value: 'overwrite', label: d('optOverwrite', 'Overwrite') },
                    ] },
            ] },
        // ── Privacy & telemetry / local recorder / replay ──────────────────
        { id: 'telemetry_consent', cat: 'system', label: d('actionTelemetryConsent', 'Telemetry consent'),
            desc: d('actionTelemetryConsentDesc', 'Enable or disable "Share anonymous usage data".'),
            iconSvg: sv('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
            fields: [{ key: 'enabled', label: d('fldEnabled', 'Enabled'), type: 'switch', default: true }] },
        { id: 'telemetry_settings', cat: 'system', label: d('actionTelemetrySettings', 'Telemetry options'),
            desc: d('actionTelemetrySettingsDesc', 'Manage telemetry sub-options (visual replay, full mode, weekly benchmark).'),
            iconSvg: sv('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9"/>'),
            fields: [
                { key: 'replay', label: d('fldReplay', 'Visual replay'), type: 'switch', default: true, half: true },
                { key: 'full', label: d('fldFullReplay', 'Full (unmasked)'), type: 'switch', default: false, half: true },
                { key: 'bench', label: d('fldWeeklyBench', 'Weekly benchmark'), type: 'switch', default: true, half: true },
            ] },
        { id: 'recorder_set', cat: 'system', label: d('actionRecorderSet', 'Session recorder'),
            desc: d('actionRecorderSetDesc', 'Configure the local session recorder (on/off, full mode, Rust & JS logs).'),
            iconSvg: sv('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>'),
            fields: [
                { key: 'on', label: d('fldRecOn', 'Record'), type: 'switch', default: true, half: true },
                { key: 'full', label: d('fldFullReplay', 'Full (unmasked)'), type: 'switch', default: false, half: true },
                { key: 'rust', label: d('fldRustLog', 'Rust log'), type: 'switch', default: true, half: true },
                { key: 'js', label: d('fldJsLog', 'JS log'), type: 'switch', default: true, half: true },
            ] },
        { id: 'replay_export', cat: 'system', label: d('actionReplayExport', 'Export replay'),
            desc: d('actionReplayExportDesc', 'Export the current local session recording to a .bmmreplay file.'),
            iconSvg: sv('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>') },
        { id: 'replay_import', cat: 'system', label: d('actionReplayImport', 'Import replay'),
            desc: d('actionReplayImportDesc', 'Import + replay a .bmmreplay from a file path or a download URL.'),
            iconSvg: sv('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
            fields: [
                { key: 'path', label: d('fldPath', 'File path'), type: 'file', placeholder: 'C:/…/session.bmmreplay' },
                { key: 'url', label: d('fldUrl', 'Download URL'), type: 'text', placeholder: 'https://…/session.bmmreplay' },
            ] },
        // ── Control flow ────────────────────────────────────────────────
        { id: 'comment', cat: 'control', label: d('actionComment', 'Comment'),
            desc: d('actionCommentDesc', 'Inserts a comment line — does not execute.'),
            iconSvg: sv('<polyline points="3 6 5 6 21 6"/><path d="M9 14h6"/><path d="M9 10h6"/>'),
            fields: [{ key: 'text', label: d('fldComment', 'Comment'), type: 'text', placeholder: 'This part enables the mods' }] },
        { id: 'set_variable', cat: 'control', label: d('actionSetVariable', 'Set variable'),
            desc: d('actionSetVariableDesc', 'Defines a named variable usable later via if_var_eq.'),
            iconSvg: sv('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>'),
            fields: [
                { key: 'var_name', label: d('fldVarName', 'Variable name'), type: 'text', placeholder: 'MY_VAR', half: true },
                { key: 'var_value', label: d('fldValue', 'Value'), type: 'text', placeholder: 'hello', half: true },
            ] },
        { id: 'if_file_exists', cat: 'control', label: d('actionIfFileExists', 'If file exists'),
            desc: d('actionIfFileExistsDesc', 'Subsequent actions run only if the given path exists. Pair with end_block.'),
            iconSvg: sv('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'),
            fields: [{ key: 'path', label: d('fldFilePath', 'File path'), type: 'text', placeholder: 'C:/path/to/file.txt' }] },
        { id: 'if_file_not_exists', cat: 'control', label: d('actionIfFileNotExists', 'If file is missing'),
            desc: d('actionIfFileNotExistsDesc', 'Subsequent actions run only if the given path does NOT exist. Pair with end_block.'),
            iconSvg: sv('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/>'),
            fields: [{ key: 'path', label: d('fldFilePath', 'File path'), type: 'text', placeholder: 'C:/path/to/file.txt' }] },
        { id: 'if_var_eq', cat: 'control', label: d('actionIfVarEq', 'If variable =='),
            desc: d('actionIfVarEqDesc', 'Subsequent actions run only if the variable equals the given value.'),
            iconSvg: sv('<path d="M18 13a3 3 0 1 0-3-3"/><path d="M6 13a3 3 0 1 1 3-3"/><line x1="3" y1="20" x2="21" y2="20"/>'),
            fields: [
                { key: 'var_name', label: d('fldVariable', 'Variable'), type: 'text', placeholder: 'MY_VAR', half: true },
                { key: 'var_value', label: d('fldEquals', 'Equals'), type: 'text', placeholder: 'hello', half: true },
            ] },
        { id: 'if_var_neq', cat: 'control', label: d('actionIfVarNeq', 'If variable !='),
            desc: d('actionIfVarNeqDesc', 'Subsequent actions run only if the variable does NOT equal the given value.'),
            iconSvg: sv('<path d="M18 13a3 3 0 1 0-3-3"/><path d="M6 13a3 3 0 1 1 3-3"/><line x1="3" y1="20" x2="21" y2="20"/><line x1="4" y1="4" x2="20" y2="20"/>'),
            fields: [
                { key: 'var_name', label: d('fldVariable', 'Variable'), type: 'text', placeholder: 'MY_VAR', half: true },
                { key: 'var_value', label: d('fldNotEquals', 'Not equals'), type: 'text', placeholder: 'hello', half: true },
            ] },
        { id: 'if_api_ok', cat: 'control', label: d('actionIfApiOk', 'If API call OK'),
            desc: d('actionIfApiOkDesc', 'Runs the linked API call (or checks the previous one) and the inner actions only if it SUCCEEDED. Pair with end_block.'),
            iconSvg: sv('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'),
            fields: [{ key: 'api_action', label: d('fldLinkedApi', 'Linked API'), type: 'select', options: apiActionOpts, default: '' }] },
        { id: 'if_api_err', cat: 'control', label: d('actionIfApiErr', 'If API call failed'),
            desc: d('actionIfApiErrDesc', 'Runs the linked API call (or checks the previous one) and the inner actions only if it FAILED (e.g. stop the HTTP host on error). Pair with end_block.'),
            iconSvg: sv('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'),
            fields: [{ key: 'api_action', label: d('fldLinkedApi', 'Linked API'), type: 'select', options: apiActionOpts, default: '' }] },
        { id: 'else_block', cat: 'control', label: d('actionElse', 'Else'),
            desc: d('actionElseDesc', 'Marks the else branch of the previous if_*. No parameters.'),
            iconSvg: sv('<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>') },
        { id: 'end_block', cat: 'control', label: d('actionEnd', 'End block'),
            desc: d('actionEndDesc', 'Closes the previous if_* / else block. No parameters.'),
            iconSvg: sv('<polyline points="20 6 9 17 4 12"/>') },
        { id: 'pause_key', cat: 'control', label: d('actionPauseKey', 'Pause (wait for key)'),
            desc: d('actionPauseKeyDesc', 'Pauses the script until the user presses a key / Enter. No parameters.'),
            iconSvg: sv('<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>') },
        { id: 'stop_script', cat: 'control', label: d('actionStopScript', 'Stop script'),
            desc: d('actionStopScriptDesc', 'Exits the script immediately. No parameters.'),
            iconSvg: sv('<rect x="5" y="5" width="14" height="14" rx="2"/>') },
        { id: 'raw_code', cat: 'control', label: d('actionRawCode', 'Raw code'),
            desc: d('actionRawCodeDesc', 'Inserts native code in the target language verbatim.'),
            iconSvg: sv('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'),
            fields: [{ key: 'code', label: d('fldCode', 'Code'), type: 'textarea', placeholder: 'echo Custom code here' }] },
        { id: 'loop_start', cat: 'control', label: d('actionLoopStart', 'Loop (repeat N times)'),
            desc: d('actionLoopStartDesc', 'Repeats every action up to the matching “End loop” N times. Great for retrying until something works.'),
            iconSvg: sv('<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'),
            fields: [{ key: 'count', label: d('fldTimes', 'Times'), type: 'text', placeholder: '5' }] },
        { id: 'loop_end', cat: 'control', label: d('actionLoopEnd', 'End loop'),
            desc: d('actionLoopEndDesc', 'Closes the previous “Loop”. No parameters.'),
            iconSvg: sv('<polyline points="20 6 9 17 4 12"/>') },
        { id: 'verify_file', cat: 'control', label: d('actionVerifyFile', 'Verify file (hash → variable)'),
            desc: d('actionVerifyFileDesc', 'Computes a file SHA-256 hash into a variable, so you can compare it with “If variable ==” (e.g. loop until a download matches a known hash).'),
            iconSvg: sv('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>'),
            fields: [
                { key: 'path', label: d('fldFile', 'File'), type: 'text', placeholder: 'C:\\path\\to\\file' },
                { key: 'var_name', label: d('fldIntoVar', 'Into variable'), type: 'text', placeholder: 'FILE_HASH', half: true },
            ] },
        { id: 'wait_until', cat: 'control', label: d('actionWaitUntil', 'Wait until file exists'),
            desc: d('actionWaitUntilDesc', 'Pauses the script until a file appears (e.g. a download or extraction finished), or the timeout elapses.'),
            iconSvg: sv('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
            fields: [
                { key: 'path', label: d('fldFile', 'File'), type: 'text', placeholder: 'C:\\path\\to\\file' },
                { key: 'timeout', label: d('fldTimeoutSec', 'Timeout (s)'), type: 'text', placeholder: '120', half: true },
                { key: 'poll', label: d('fldPollSec', 'Check every (s)'), type: 'text', placeholder: '2', half: true },
            ] },
        { id: 'math_set', cat: 'control', label: d('actionMathSet', 'Math (compute → variable)'),
            desc: d('actionMathSetDesc', 'Computes an arithmetic expression and stores it in a variable. Use standard operators: + - * / % and parentheses.'),
            iconSvg: sv('<path d="M4 7h16M4 12h16M4 17h10"/><circle cx="18" cy="17" r="2"/>'),
            fields: [
                { key: 'var_name', label: d('fldVariable', 'Variable'), type: 'text', placeholder: 'TOTAL', half: true },
                { key: 'expr', label: d('fldExpr', 'Expression'), type: 'text', placeholder: '(A + B) / 2' },
            ] },
        { id: 'ternary', cat: 'control', label: d('actionTernary', 'Ternary (var = cond ? a : b)'),
            desc: d('actionTernaryDesc', 'Sets a variable to one value or another depending on a condition. Write the condition in the target language (e.g. A > 5).'),
            iconSvg: sv('<path d="M6 3v6a3 3 0 0 0 3 3h6"/><path d="M9 21l3-3-3-3"/><circle cx="18" cy="12" r="2"/>'),
            fields: [
                { key: 'var_name', label: d('fldVariable', 'Variable'), type: 'text', placeholder: 'RESULT', half: true },
                { key: 'cond', label: d('fldCondExpr', 'Condition'), type: 'text', placeholder: 'A > 5' },
                { key: 'val_true', label: d('fldThenVal', 'Then ='), type: 'text', placeholder: '1', half: true },
                { key: 'val_false', label: d('fldElseVal', 'Else ='), type: 'text', placeholder: '0', half: true },
            ] },
        { id: 'guard_stop', cat: 'control', label: d('actionGuardStop', 'Guard clause (stop if…)'),
            desc: d('actionGuardStopDesc', 'Exits the script immediately if a condition is true — a guard clause to bail out early. Write the condition in the target language.'),
            iconSvg: sv('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/>'),
            fields: [{ key: 'cond', label: d('fldCondExpr', 'Condition'), type: 'text', placeholder: 'A < 0' }] },
    ];
}
function _renderField(cardId, f) {
    const id = `${cardId}-f-${f.key}`;
    const wcls = f.half ? 'half' : 'full';
    if (f.type === 'select') {
        const opts = (f.options || []).map(o => `<option value="${escHtml(o.value)}"${o.value === (f.default ?? '') ? ' selected' : ''}>${escHtml(o.label)}</option>`).join('');
        return `<div class="plug-act-field ${wcls}">
            <label for="${id}">${escHtml(f.label)}</label>
            <select id="${id}" class="select select-sm" data-field="${f.key}">${opts}</select>
        </div>`;
    }
    if (f.type === 'switch') {
        const checked = (f.default === true || f.default === 'true') ? 'checked' : '';
        return `<div class="plug-act-field ${wcls} plug-act-field-switch">
            <label for="${id}">${escHtml(f.label)}</label>
            <label class="plug-toggle">
                <input type="checkbox" id="${id}" data-field="${f.key}" ${checked}>
                <span class="plug-toggle-slider"></span>
            </label>
        </div>`;
    }
    if (f.type === 'textarea') {
        return `<div class="plug-act-field full">
            <label for="${id}">${escHtml(f.label)}</label>
            <textarea id="${id}" class="input input-sm" data-field="${f.key}" rows="2"
                placeholder="${escHtml(f.placeholder || '')}">${escHtml(String(f.default ?? ''))}</textarea>
        </div>`;
    }
    // folderlist — a chip list of folders, fed by a folder browser AND a "+ Profile"
    // dropdown (adds the profile's mods folder). Stored as a ';'-joined hidden value.
    if (f.type === 'folderlist') {
        const profOpts = _allProfiles
            .filter(p => p.mods_path)
            .map(p => `<option value="${escHtml(p.mods_path)}">${escHtml(p.name || p.id)}</option>`).join('');
        return `<div class="plug-act-field full">
            <label for="${id}">${escHtml(f.label)}</label>
            <input type="hidden" id="${id}" data-field="${f.key}" value="${escHtml(String(f.default ?? ''))}">
            <div class="plug-fl-chips" id="${id}-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px"></div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                <button type="button" class="btn btn-sm plug-fl-add-folder" data-for="${id}" style="display:flex;align-items:center;gap:5px">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
                    <span>${escHtml(t('plugins.addFolder') || 'Add folder')}</span>
                </button>
                ${profOpts ? `<select class="select select-sm plug-fl-add-profile" data-for="${id}">
                    <option value="">${escHtml(t('plugins.addProfile') || '+ Profile…')}</option>${profOpts}
                </select>` : ''}
            </div>
        </div>`;
    }
    // folder / file — a path input with a native Browse button (no manual typing).
    if (f.type === 'folder' || f.type === 'file') {
        const val = f.default !== undefined ? escHtml(String(f.default)) : '';
        const ic = f.type === 'folder'
            ? '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'
            : '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>';
        return `<div class="plug-act-field ${wcls}">
            <label for="${id}">${escHtml(f.label)}</label>
            <div style="display:flex;gap:6px;align-items:stretch">
                <input id="${id}" type="text" class="input input-sm" data-field="${f.key}" style="flex:1;min-width:0"
                    placeholder="${escHtml(f.placeholder || '')}" value="${val}">
                <button type="button" class="btn btn-sm plug-act-browse" data-browse="${f.type}" data-for="${id}"
                    data-tooltip="${escHtml(t('plugins.browse') || 'Browse…')}" style="flex-shrink:0;display:flex;align-items:center;gap:5px">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ic}</svg>
                    <span>${escHtml(t('plugins.browse') || 'Browse')}</span>
                </button>
            </div>
        </div>`;
    }
    // text or number
    const val = f.default !== undefined ? escHtml(String(f.default)) : '';
    return `<div class="plug-act-field ${wcls}">
        <label for="${id}">${escHtml(f.label)}</label>
        <input id="${id}" type="${f.type === 'number' ? 'number' : 'text'}" class="input input-sm"
            data-field="${f.key}" placeholder="${escHtml(f.placeholder || '')}" value="${val}">
    </div>`;
}
function _renderTargetSelect(cardId, kind) {
    let opts = '';
    let emptyLabel = '';
    if (kind === 'mod') {
        opts = _allMods.map(m => `<option value="${escHtml(m.id)}">${escHtml(m.name || m.id)}</option>`).join('');
        emptyLabel = t('plugins.noMods') || 'No mods available';
    }
    else if (kind === 'profile') {
        opts = _allProfiles.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join('');
        emptyLabel = t('plugins.noProfiles') || 'No profiles available';
    }
    else if (kind === 'launchpack') {
        opts = _allLaunchpacks.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name || p.id)}</option>`).join('');
        emptyLabel = t('plugins.noLaunchpacks') || 'No launch packs';
    }
    else if (kind === 'task') {
        opts = _allTasks.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name || p.id)}</option>`).join('');
        emptyLabel = t('plugins.noTasks') || 'No scheduled tasks';
    }
    else {
        opts = _installedPlugins.map(p => `<option value="${escHtml(p.manifest.id)}">${escHtml(p.manifest.name)}</option>`).join('');
        emptyLabel = t('plugins.noPlugins') || 'No plugins installed';
    }
    if (!opts)
        opts = `<option value="">${escHtml(emptyLabel)}</option>`;
    const labelTxt = kind === 'mod' ? 'Mod' : kind === 'profile' ? t('plugins.fldProfile') || 'Profile'
        : kind === 'launchpack' ? (t('plugins.fldLaunchpack') || 'Launch pack')
            : kind === 'task' ? (t('plugins.fldTask') || 'Task') : 'Plugin';
    // Profile selects include an icon display element; icon is wired after insertion.
    const inner = kind === 'profile'
        ? `<div class="profile-select-icon-wrap" style="display:flex;align-items:center;gap:5px;">
               <span class="profile-icon-display" style="flex-shrink:0;"></span>
               <select id="${cardId}-target" class="select select-sm plug-act-target">${opts}</select>
           </div>`
        : `<select id="${cardId}-target" class="select select-sm plug-act-target">${opts}</select>`;
    return `<div class="plug-act-field full">
        <label for="${cardId}-target">${escHtml(labelTxt)}</label>
        ${inner}
    </div>`;
}
let _actionCardCounter = 0;
function _renderActionCard(def) {
    const card = document.createElement('div');
    card.className = 'plug-act-card';
    card.dataset.actionId = def.id;
    const meta = _CAT_META[def.cat] || _CAT_META.system;
    const cardId = `act-${++_actionCardCounter}`;
    card.dataset.cardId = cardId;
    const fieldsHtml = (def.fields || []).map(f => _renderField(cardId, f)).join('');
    const targetHtml = def.target ? _renderTargetSelect(cardId, def.target) : '';
    const bodyHtml = (targetHtml + fieldsHtml) || `<div class="plug-act-noparam">${t('plugins.noParams') || 'No parameters needed.'}</div>`;
    card.innerHTML = `
        <div class="plug-act-stripe" style="background:${meta.color};"></div>
        <div class="plug-act-grip" data-tooltip="${t('common.move') || 'Move'}">
            <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="2" cy="3" r="1.2"/><circle cx="8" cy="3" r="1.2"/><circle cx="2" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="2" cy="13" r="1.2"/><circle cx="8" cy="13" r="1.2"/></svg>
        </div>
        <div class="plug-act-main">
            <div class="plug-act-head">
                <span class="plug-act-cat-badge" style="background:${meta.color}22;color:${meta.color};border-color:${meta.color}55;">${meta.label}</span>
                <span class="plug-act-icon" style="color:${meta.color};">${def.iconSvg}</span>
                <span class="plug-act-title">${escHtml(def.label)}</span>
                <div class="plug-act-toolbar">
                    <button class="plug-act-btn plug-act-up" data-tooltip="${t('common.moveUp') || 'Move up'}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>
                    </button>
                    <button class="plug-act-btn plug-act-down" data-tooltip="${t('common.moveDown') || 'Move down'}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                    <button class="plug-act-btn plug-act-del" data-tooltip="${t('common.delete') || 'Delete'}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            </div>
            <div class="plug-act-desc">${escHtml(def.desc)}</div>
            <div class="plug-act-body">${bodyHtml}</div>
        </div>
    `;
    const container = document.getElementById('plug-actions-container');
    card.querySelector('.plug-act-del')?.addEventListener('click', () => card.remove());
    card.querySelector('.plug-act-up')?.addEventListener('click', () => {
        const prev = card.previousElementSibling;
        if (prev && container)
            container.insertBefore(card, prev);
    });
    card.querySelector('.plug-act-down')?.addEventListener('click', () => {
        const next = card.nextElementSibling;
        if (next && container)
            container.insertBefore(next, card);
    });
    // Drag-to-reorder via pointer events (native HTML5 DnD is unreliable inside
    // the Tauri webview and was swallowed by the inner form inputs). Dragging is
    // armed only from the grip so the form fields stay fully usable.
    const grip = card.querySelector('.plug-act-grip');
    grip?.addEventListener('pointerdown', (e) => _startCardDrag(card, e));
    // Folder-list widgets (benchmark sources): chips + Add folder + Add profile.
    card.querySelectorAll('.plug-fl-chips').forEach((chipsEl) => {
        const id = (chipsEl.id || '').replace(/-chips$/, '');
        const hidden = card.querySelector(`#${id}`);
        if (!hidden)
            return;
        const get = () => hidden.value.split(';').map(s => s.trim()).filter(Boolean);
        const set = (arr) => { hidden.value = Array.from(new Set(arr)).join(';'); hidden.dispatchEvent(new Event('input', { bubbles: true })); render(); };
        const render = () => {
            chipsEl.innerHTML = get().map((p, i) => `<span class="pill" style="display:inline-flex;align-items:center;gap:6px;background:var(--bg-tertiary,#1b2230);max-width:100%">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px" data-tooltip="${escHtml(p)}">${escHtml((p.split(/[\\/]/).pop() || p))}</span>
                <button type="button" class="plug-fl-rm" data-i="${i}" data-tooltip="${escHtml(t('common.remove') || 'Remove')}" style="background:none;border:0;color:var(--text-muted,#8a8f98);cursor:pointer;padding:0;display:inline-flex"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </span>`).join('') || `<span style="font-size:11px;color:var(--text-muted,#8a8f98)">${escHtml(t('plugins.noSources') || 'No source — sandbox dataset will be used.')}</span>`;
            chipsEl.querySelectorAll('.plug-fl-rm').forEach((rm) => rm.addEventListener('click', () => {
                const arr = get();
                arr.splice(Number(rm.dataset.i), 1);
                set(arr);
            }));
        };
        card.querySelector(`.plug-fl-add-folder[data-for="${id}"]`)?.addEventListener('click', async () => {
            try {
                const f = await pickFolder();
                if (f)
                    set([...get(), String(f)]);
            }
            catch { /* cancelled */ }
        });
        const profSel = card.querySelector(`.plug-fl-add-profile[data-for="${id}"]`);
        profSel?.addEventListener('change', () => { if (profSel.value) {
            set([...get(), profSel.value]);
            profSel.value = '';
        } });
        render();
    });
    // "Browse…" buttons → native folder / file picker, so paths are never typed.
    card.querySelectorAll('.plug-act-browse').forEach((b) => b.addEventListener('click', async () => {
        const btn = b;
        const inp = card.querySelector(`#${btn.dataset.for}`);
        if (!inp)
            return;
        try {
            const picked = btn.dataset.browse === 'folder'
                ? await pickFolder()
                : await pickFile({});
            if (picked) {
                inp.value = String(picked);
                inp.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
        catch { /* user cancelled */ }
    }));
    // Wire custom icon display for profile target selects (async, non-blocking).
    if (def.target === 'profile') {
        const profileSel = card.querySelector('.plug-act-target');
        const iconEl = card.querySelector('.profile-icon-display');
        if (profileSel && iconEl && _allProfiles.length) {
            fetchProfileIconPaths(_allProfiles).then(iconPaths => {
                decorateProfileOptions(profileSel, _allProfiles, iconPaths);
                updateSelectProfileIcon(profileSel, _allProfiles, iconPaths, iconEl);
                profileSel.addEventListener('change', () => updateSelectProfileIcon(profileSel, _allProfiles, iconPaths, iconEl));
            });
        }
    }
    return card;
}
/** Find the card that the pointer (at vertical position `y`) should be inserted
 *  before. Returns null when the pointer is past the last card. */
function _cardAfter(container, y) {
    const cards = Array.from(container.querySelectorAll('.plug-act-card:not(.plug-act-dragging)'));
    let closest = { offset: -Infinity, el: null };
    for (const child of cards) {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset)
            closest = { offset, el: child };
    }
    return closest.el;
}
/** Pointer-based drag: live-reorders the card as the pointer moves, finalising
 *  on pointerup. Works reliably where native drag events do not. */
function _startCardDrag(card, downEvt) {
    const container = document.getElementById('plug-actions-container');
    if (!container)
        return;
    downEvt.preventDefault();
    let active = false;
    const startY = downEvt.clientY;
    const THRESH = 4; // px before a real drag starts (so plain clicks do nothing)
    const onMove = (e) => {
        if (!active) {
            if (Math.abs(e.clientY - startY) < THRESH)
                return;
            active = true;
            card.classList.add('plug-act-dragging');
        }
        const after = _cardAfter(container, e.clientY);
        if (after == null) {
            if (card.nextElementSibling !== null)
                container.appendChild(card);
        }
        else if (after !== card) {
            container.insertBefore(card, after);
        }
    };
    const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        card.classList.remove('plug-act-dragging');
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
}
let _actionDndInstalled = false;
/** Reordering is handled per-card via pointer events (see _startCardDrag), so
 *  no container-level handler is needed. Kept as a no-op for call-site compat. */
function _ensureActionDnd() {
    _actionDndInstalled = true;
}
/** Open the action picker — a popover anchored to the "+Action" button.
 *  Lets the user pick from a grouped catalog, then appends the card. */
function _openActionPicker(anchorBtn) {
    const existing = document.getElementById('plug-act-picker');
    if (existing) {
        existing.remove();
        return;
    }
    const container = document.getElementById('plug-actions-container');
    if (!container)
        return;
    const catalog = _actionCatalog();
    const grouped = {};
    catalog.forEach(a => { (grouped[a.cat] ||= []).push(a); });
    const pop = document.createElement('div');
    pop.id = 'plug-act-picker';
    pop.className = 'plug-act-picker';
    pop.innerHTML = `
        <div class="plug-act-picker-head">
            <input type="text" class="input input-sm plug-act-picker-search" placeholder="${t('common.search') || 'Search action…'}" autofocus>
        </div>
        <div class="plug-act-picker-body">
            ${['mods', 'repo', 'apps', 'read', 'system', 'control'].map(cat => {
        const meta = _CAT_META[cat];
        const items = (grouped[cat] || []).map(a => `
                    <button class="plug-act-pick-item" data-id="${a.id}">
                        <span class="plug-act-pick-icon" style="color:${meta.color};">${a.iconSvg}</span>
                        <span class="plug-act-pick-text">
                            <span class="plug-act-pick-label">${escHtml(a.label)}</span>
                            <span class="plug-act-pick-desc">${escHtml(a.desc)}</span>
                        </span>
                    </button>
                `).join('');
        return `<div class="plug-act-pick-section">
                    <div class="plug-act-pick-section-h" style="color:${meta.color};">${meta.label}</div>
                    <div class="plug-act-pick-list">${items}</div>
                </div>`;
    }).join('')}
        </div>
    `;
    // Position popover — smart: flip above if not enough space below
    document.body.appendChild(pop);
    const rect = anchorBtn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const popW = 420;
    const popMaxH = 480;
    const gap = 6;
    const spaceBelow = vh - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    let top, maxH;
    if (spaceBelow >= 220 || spaceBelow >= spaceAbove) {
        top = rect.bottom + gap;
        maxH = Math.max(160, Math.min(popMaxH, spaceBelow - 4));
    }
    else {
        maxH = Math.max(160, Math.min(popMaxH, spaceAbove - 4));
        top = rect.top - maxH - gap;
    }
    let left = Math.max(8, rect.right - popW);
    if (left + popW > vw - 8)
        left = vw - popW - 8;
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
    pop.style.maxHeight = `${maxH}px`;
    const search = pop.querySelector('.plug-act-picker-search');
    search.addEventListener('input', () => {
        const q = search.value.toLowerCase().trim();
        pop.querySelectorAll('.plug-act-pick-item').forEach(el => {
            const item = el;
            const text = (item.textContent || '').toLowerCase();
            item.style.display = !q || text.includes(q) ? '' : 'none';
        });
    });
    setTimeout(() => search.focus(), 0);
    const dismiss = () => {
        pop.remove();
        document.removeEventListener('mousedown', onOutsideClick, true);
    };
    // Event delegation so dynamic items + bubbling SVG/span children
    // all reach the handler.  stopPropagation prevents the outside-click
    // detector from also seeing the same event.
    pop.addEventListener('click', (e) => {
        const target = e.target;
        const item = target.closest('.plug-act-pick-item');
        if (!item)
            return;
        e.stopPropagation();
        e.preventDefault();
        const id = item.dataset.id;
        const def = catalog.find(a => a.id === id);
        if (def) {
            const card = _renderActionCard(def);
            container.appendChild(card);
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        dismiss();
    });
    const onOutsideClick = (ev) => {
        const target = ev.target;
        if (pop.contains(target))
            return;
        if (anchorBtn.contains(target) || target === anchorBtn)
            return;
        dismiss();
    };
    setTimeout(() => document.addEventListener('mousedown', onOutsideClick, true), 0);
}
function addActionRow() {
    // Backwards-compatible default add: appends an "enable_mod" card so the
    // existing init flow that calls addActionRow() at startup still works.
    const def = _actionCatalog().find(a => a.id === 'enable_mod');
    const container = document.getElementById('plug-actions-container');
    if (def && container)
        container.appendChild(_renderActionCard(def));
}
async function handlePreviewScript() {
    const script = await buildScript();
    if (script == null)
        return;
    const format = document.getElementById('plug-gen-format')?.value || 'bat';
    const output = document.getElementById('plug-gen-output');
    const placeholder = document.getElementById('plug-gen-placeholder');
    const code = document.getElementById('plug-gen-code');
    if (placeholder)
        placeholder.style.display = 'none';
    output.style.display = 'flex';
    code.innerHTML = highlightScript(script, format);
    code.dataset.raw = script;
    dispatchBmmAction(BMM_ACTIONS.SCRIPT_GENERATED, { format });
}
/** Format id → file extension, where they differ. */
const SCRIPT_EXT = { bmms: 'bmmscript' };
async function handleSaveScript() {
    const script = await buildScript();
    if (script == null)
        return;
    const format = document.getElementById('plug-gen-format')?.value || 'bat';
    const ext = SCRIPT_EXT[format] || format;
    const path = await saveFile({ defaultPath: `bmm-script.${ext}`, filters: [{ name: 'Script', extensions: [ext] }] });
    if (!path)
        return;
    try {
        await invoke('write_text_file', { path, content: script });
        toast(t('plugins.scriptSaved'), 'success');
    }
    catch (e) {
        toast(`${t('common.error')}: ${e}`, 'error');
    }
}
async function handleSaveScriptZip() {
    const script = await buildScript();
    if (script == null)
        return;
    const format = document.getElementById('plug-gen-format')?.value || 'bat';
    const mode = document.getElementById('plug-gen-mode')?.value || 'deeplink';
    const useEnv = document.getElementById('plug-gen-use-env')?.checked ?? false;
    const actions = _collectActions() || [];
    const needApi = mode === 'api' || _actionsNeedApi(actions, mode === 'deeplink');
    const needsEnv = needApi && useEnv;
    const zipPath = await saveFile({ defaultPath: `bmm-plugin.zip`, filters: [{ name: 'ZIP Archive', extensions: ['zip'] }] });
    if (!zipPath)
        return;
    // Build .env content
    const envContent = needsEnv
        ? `# BMM Script — environment variables\n# Do NOT commit this file to version control!\nBMM_TOKEN=${_apiToken}\nBMM_API_BASE=${apiBase()}\n`
        : `# BMM Script — no API token required (deeplink mode)\nBMM_API_BASE=${apiBase()}\n`;
    // Build .gitignore
    const gitignore = `.env\n*.log\n__pycache__/\nnode_modules/\ntarget/\n`;
    // Build README.md
    const extMap = { bat: 'cmd', ps1: 'powershell', vbs: 'cscript', py: 'python', lua: 'lua', js: 'node', rb: 'ruby', php: 'php', go: 'go run', java: 'javac + java', cs: 'dotnet run', rs: 'cargo run', bmms: 'BMM itself' };
    const runner = extMap[format] || format;
    const readme = [
        `# BMM Script — generated by BMM Script Generator`,
        ``,
        `## Files`,
        `| File | Description |`,
        `|------|-------------|`,
        `| \`bmm-script.${format}\` | Main script (${runner}) |`,
        needsEnv ? `| \`.env\` | API credentials — **do not commit!** |` : '',
        `| \`.gitignore\` | Ignores \`.env\` and temp files |`,
        ``,
        `## Usage`,
        ``,
        needsEnv ? `1. Open \`.env\` and verify your \`BMM_TOKEN\` is correct.\n2. Make sure BMM is running (API on port ${new URL(apiBase()).port}).\n3. Run the script with \`${runner} bmm-script.${format}\`.` : `1. Make sure BMM is running.\n2. Run: \`${runner} bmm-script.${format}\``,
        ``,
        `## Requirements`,
        _genFormatReqs(format),
        ``,
        `> Generated by [Better Mod Manager](https://github.com/YourRepo/BMM) — ${new Date().toISOString().slice(0, 10)}`,
    ].filter(l => l !== '').join('\n');
    try {
        await invoke('write_zip_files', {
            destPath: zipPath,
            files: [
                { name: `bmm-script.${format}`, content: script },
                { name: '.env', content: envContent },
                { name: '.gitignore', content: gitignore },
                { name: 'README.md', content: readme },
            ],
        });
        toast(t('plugins.scriptZipSaved'), 'success');
    }
    catch (e) {
        toast(`${t('common.error')}: ${e}`, 'error');
    }
}
function _genFormatReqs(fmt) {
    const map = {
        bat: '- Windows CMD (built-in)',
        ps1: '- PowerShell 5+ (built-in on Windows)',
        vbs: '- VBScript / cscript.exe (built-in on Windows)',
        py: '- Python 3.x + `pip install requests`',
        lua: '- Lua 5.x + `luarocks install http`',
        js: '- Node.js 18+',
        rb: '- Ruby 3.x (stdlib only)',
        php: '- PHP 7.4+ with cURL extension',
        go: '- Go 1.18+',
        java: '- Java 11+ (stdlib only)',
        cs: '- .NET 6+ (stdlib only)',
        rs: '- Rust + `reqwest = { features = ["blocking"] }` in Cargo.toml',
    };
    return map[fmt] || `- ${fmt} runtime`;
}
// Snapshot the current script-generator action cards (id + target + field
// values) so they can survive a re-render (e.g. when the UI language changes).
function _snapshotActions() {
    return Array.from(document.querySelectorAll('.plug-act-card')).map(card => {
        const id = card.dataset.actionId || '';
        const target = card.querySelector('.plug-act-target')?.value || '';
        const fields = {};
        card.querySelectorAll('[data-field]').forEach(el => {
            const key = el.dataset.field || '';
            if (!key)
                return;
            if (el instanceof HTMLInputElement && el.type === 'checkbox')
                fields[key] = el.checked;
            else
                fields[key] = el.value || '';
        });
        return { id, target, fields };
    });
}
// Rebuild action cards from a snapshot (used after a language re-render).
function _restoreActions(snap) {
    const container = document.getElementById('plug-actions-container');
    if (!container || !snap || !snap.length)
        return;
    container.innerHTML = ''; // drop the default card renderScripts() adds
    const catalog = _actionCatalog();
    for (const s of snap) {
        const def = catalog.find(d => d.id === s.id);
        if (!def)
            continue;
        const card = _renderActionCard(def);
        container.appendChild(card);
        const tgt = card.querySelector('.plug-act-target');
        if (tgt && s.target)
            tgt.value = s.target;
        for (const [key, val] of Object.entries(s.fields || {})) {
            const el = card.querySelector(`[data-field="${key}"]`);
            if (!el)
                continue;
            if (el instanceof HTMLInputElement && el.type === 'checkbox')
                el.checked = val === true || val === 'true';
            else
                el.value = String(val);
        }
    }
}
function _collectActions() {
    const cards = document.querySelectorAll('.plug-act-card');
    if (!cards.length) {
        toast(t('plugins.addActionFirst'), 'warning');
        return null;
    }
    return Array.from(cards).map(card => {
        const type = card.dataset.actionId || '';
        const targetEl = card.querySelector('.plug-act-target');
        const target_id = targetEl?.value || '';
        // Read all labelled inputs in the card → raw key/value map
        const raw = {};
        card.querySelectorAll('[data-field]').forEach(el => {
            const key = el.dataset.field || '';
            if (!key)
                return;
            if (el instanceof HTMLInputElement && el.type === 'checkbox') {
                raw[key] = el.checked ? 'true' : 'false';
            }
            else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
                raw[key] = el.value || '';
            }
        });
        // Map per-action raw fields → backend `extra` shape
        const extra = {};
        switch (type) {
            case 'wait':
                extra.duration_ms = (parseFloat(raw.duration_s) || 1) * 1000;
                break;
            case 'close_process':
                extra.process_name = raw.process_name || '';
                break;
            case 'open_url':
                extra.url = raw.url || '';
                break;
            case 'show_message':
            case 'log':
                extra.message = raw.message || '';
                break;
            case 'launch_game':
                extra.exe_path = raw.exe_path || '';
                break;
            case 'comment':
                extra.text = raw.text || '';
                break;
            case 'set_variable':
                // Backend wants legacy "NAME=value" in extra.expr
                extra.expr = `${raw.var_name || ''}=${raw.var_value || ''}`;
                break;
            case 'if_file_exists':
            case 'if_file_not_exists':
                extra.path = raw.path || '';
                break;
            case 'if_var_eq':
            case 'if_var_neq':
                extra.cond = `${raw.var_name || ''}=${raw.var_value || ''}`;
                break;
            case 'if_api_ok':
            case 'if_api_err':
                extra.api_action = raw.api_action || '';
                break;
            case 'raw_code':
                extra.code = raw.code || '';
                break;
            case 'loop_start':
                extra.count = Math.max(1, parseInt(raw.count || '1', 10) || 1);
                break;
            case 'verify_file':
                extra.path = raw.path || '';
                extra.var_name = raw.var_name || 'FILE_HASH';
                break;
            case 'wait_until':
                extra.path = raw.path || '';
                extra.timeout = Math.max(1, parseInt(raw.timeout || '120', 10) || 120);
                extra.poll = Math.max(1, parseInt(raw.poll || '2', 10) || 2);
                break;
            case 'math_set':
                extra.var_name = raw.var_name || 'RESULT';
                extra.expr = raw.expr || '0';
                break;
            case 'ternary':
                extra.var_name = raw.var_name || 'RESULT';
                extra.cond = raw.cond || 'true';
                extra.val_true = raw.val_true || '1';
                extra.val_false = raw.val_false || '0';
                break;
            case 'guard_stop':
                extra.cond = raw.cond || 'false';
                break;
            // Repo / modpack actions — store individual typed keys so values
            // with spaces (paths, names) survive intact. Booleans as real
            // booleans, numbers as real numbers.
            case 'sync_repo':
                extra.url = raw.url || '';
                extra.mods_dir = raw.mods_dir || '';
                extra.backup_dir = raw.backup_dir || '';
                extra.game_dir = raw.game_dir || '';
                extra.overwrite_all = raw.overwrite_all === 'true';
                extra.delete_extra = raw.delete_extra === 'true';
                extra.download_limit = parseInt(raw.download_limit || '0', 10) || 0;
                break;
            case 'gen_repo':
                extra.profile_id = raw.profile_id || '';
                extra.output_dir = raw.output_dir || '';
                extra.author = raw.author || '';
                extra.port = parseInt(raw.port || '8080', 10) || 8080;
                extra.admin_pass = raw.admin_pass || '';
                extra.upload_limit = parseInt(raw.upload_limit || '0', 10) || 0;
                extra.lightweight = raw.lightweight === 'true';
                extra.zip = raw.zip === 'true';
                extra.generate_server = raw.generate_server === 'true';
                extra.auto_start = raw.auto_start === 'true';
                break;
            case 'http_host':
                extra.serve_dir = raw.serve_dir || '';
                extra.port = parseInt(raw.port || '8080', 10) || 8080;
                extra.upload_limit = parseInt(raw.upload_limit || '0', 10) || 0;
                break;
            case 'update_modpack':
                extra.modpack_id = raw.modpack_id || '';
                extra.name = raw.name || '';
                extra.dependency_mode = raw.dependency_mode || 'none';
                break;
            // ── New write/read endpoints ──────────────────────────────────
            case 'update_mod':
                extra.name = raw.name || '';
                extra.version = raw.version || '';
                extra.author = raw.author || '';
                extra.description = raw.description || '';
                break;
            case 'create_profile':
                extra.name = raw.name || '';
                extra.game_name = raw.game_name || '';
                extra.game_path = raw.game_path || '';
                extra.mods_path = raw.mods_path || '';
                extra.backup_path = raw.backup_path || '';
                break;
            case 'update_profile':
                extra.name = raw.name || '';
                extra.game_name = raw.game_name || '';
                extra.color = raw.color || '';
                extra.icon = raw.icon || '';
                extra.game_path = raw.game_path || '';
                extra.mods_path = raw.mods_path || '';
                extra.backup_path = raw.backup_path || '';
                break;
            case 'create_modpack':
                extra.name = raw.name || '';
                extra.description = raw.description || '';
                extra.game_name = raw.game_name || '';
                extra.sr_link = raw.sr_link || '';
                extra.dependency_mode = raw.dependency_mode || 'none';
                break;
            case 'delete_modpack':
                extra.modpack_id = raw.modpack_id || '';
                break;
            case 'repo_connect':
            case 'repo_remove':
            case 'repo_info':
                extra.url = raw.url || '';
                break;
        }
        return { action_type: type, target_id, extra };
    });
}
async function buildScript() {
    const format = document.getElementById('plug-gen-format')?.value || 'bat';
    const mode = document.getElementById('plug-gen-mode')?.value || 'deeplink';
    const launchBmm = document.getElementById('plug-gen-launch')?.checked ?? true;
    const useEnv = document.getElementById('plug-gen-use-env')?.checked ?? false;
    const multiProfile = document.getElementById('plug-gen-multi-profile')?.checked ?? false;
    const contextProfileId = document.getElementById('plug-gen-profile')?.value || '';
    let actions = _collectActions();
    if (!actions)
        return null;
    // If "multi-profile" is enabled and a profile is selected, prepend an
    // "activate profile" action so every subsequent enable_mod/disable_mod
    // operates in the correct profile context.
    if (multiProfile && contextProfileId) {
        actions = [
            { action_type: 'activate_profile', target_id: contextProfileId, extra: {} },
            ...actions,
        ];
    }
    // A token is needed when in API mode OR when deeplink-mode actions have to
    // fall back to HTTP (repo/host/etc. with no bmm:// equivalent).
    const needApi = mode === 'api' || _actionsNeedApi(actions, mode === 'deeplink');
    // Token: if useEnv → pass null so generators use env-var placeholder; else inline token
    const tokenArg = needApi ? (useEnv ? null : _apiToken) : null;
    // TS-side generation for non-native formats
    const TS_FORMATS = new Set(['py', 'lua', 'js', 'rb', 'php', 'go', 'java', 'cs', 'rs']);
    if (TS_FORMATS.has(format)) {
        return genScriptLocal(format, actions, tokenArg, mode === 'deeplink', launchBmm, _exePath, useEnv && needApi);
    }
    try {
        return await invoke('generate_script', {
            req: { format, actions, use_deeplink: mode === 'deeplink', token: tokenArg, launch_bmm: launchBmm, exe_path: _exePath }
        });
    }
    catch (e) {
        toast(`${t('common.error')}: ${e}`, 'error');
        return null;
    }
}
// ── Local script generators (Python / Lua / Node.js) ─────────────────────────
function genScriptLocal(format, actions, token, useDeeplink, launchBmm, exePath, useEnvFile = false) {
    const BASE = apiBase();
    // When useEnvFile: generated code reads token from env var, not hardcoded
    const ENV_TOKEN_PY = 'os.environ.get("BMM_TOKEN", "")';
    const ENV_TOKEN_LUA = 'os.getenv("BMM_TOKEN") or ""';
    const ENV_TOKEN_JS = 'process.env.BMM_TOKEN || ""';
    const ENV_TOKEN_RB = 'ENV["BMM_TOKEN"] || ""';
    const ENV_TOKEN_PHP = 'getenv("BMM_TOKEN") ?: ""';
    const ENV_TOKEN_GO = 'os.Getenv("BMM_TOKEN")';
    const ENV_TOKEN_JAVA = 'System.getenv("BMM_TOKEN")';
    const ENV_TOKEN_CS = 'Environment.GetEnvironmentVariable("BMM_TOKEN") ?? ""';
    const ENV_TOKEN_RS = 'std::env::var("BMM_TOKEN").unwrap_or_default()';
    if (format === 'py') {
        const tok = useEnvFile ? ENV_TOKEN_PY : (token ? JSON.stringify(token) : '"YOUR_TOKEN_HERE"');
        const lines = [
            '# Generated by BMM Script Generator',
            'import subprocess, time, os, webbrowser',
            'try: import requests',
            'except ImportError: raise SystemExit("pip install requests")',
            '',
            ...(useEnvFile ? ['# Load .env if present (pip install python-dotenv)', 'try:', '    from dotenv import load_dotenv; load_dotenv()', 'except ImportError: pass', ''] : []),
            `TOKEN = ${tok}`,
            `BASE  = os.environ.get("BMM_API_BASE", ${JSON.stringify(BASE)})`,
            '_bmm = None',
            '_bmm_ok = False  # last API call result — used by if_api_ok / if_api_err',
            '',
        ];
        if (launchBmm && exePath) {
            lines.push(`subprocess.Popen(${JSON.stringify(exePath)})`);
            lines.push('time.sleep(2)');
            lines.push('');
        }
        for (const a of actions) {
            lines.push(..._pyAction(a, useEnvFile ? '__ENV__' : token, useDeeplink, BASE));
        }
        return lines.join('\n');
    }
    if (format === 'lua') {
        const tok = useEnvFile ? ENV_TOKEN_LUA : (token || '"YOUR_TOKEN_HERE"');
        const lines = [
            '-- Generated by BMM Script Generator',
            '-- Requires: lua-http or similar HTTP library (luarocks install http)',
            '',
            `local TOKEN = ${tok}`,
            `local BASE  = os.getenv("BMM_API_BASE") or ${JSON.stringify(BASE)}`,
            '',
        ];
        if (launchBmm && exePath) {
            lines.push(`os.execute(${JSON.stringify(exePath)})`);
            lines.push('os.execute("ping -n 3 127.0.0.1 > nul")');
            lines.push('');
        }
        for (const a of actions) {
            lines.push(..._luaAction(a, useEnvFile ? '__ENV__' : token, useDeeplink, BASE));
        }
        return lines.join('\n');
    }
    if (format === 'js') {
        // ES-module style (Node 18+ has built-in fetch — no http import needed)
        const tok = useEnvFile ? `process.env.BMM_TOKEN ?? ''` : (token ? `'${token}'` : `'YOUR_TOKEN_HERE'`);
        const lines = [
            '// Generated by BMM Script Generator',
            '// Node.js 18+  |  save as .mjs  OR  add {"type":"module"} to package.json',
            '',
            ...(useEnvFile ? ["import * as dotenv from 'dotenv'; dotenv.config(); // npm install dotenv", ''] : []),
            "import { execSync, spawn } from 'child_process';",
            "import { existsSync } from 'fs';",
            '',
            `const TOKEN = ${tok};`,
            `const BASE  = process.env.BMM_API_BASE ?? '${BASE}';`,
            '',
            '/** POST helper — uses built-in fetch */',
            'async function bmmPost(path, body) {',
            "  const r = await fetch(BASE + path, {",
            "    method: 'POST',",
            "    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },",
            '    body: JSON.stringify(body),',
            '  });',
            '  return r.json().catch(() => null);',
            '}',
            '',
        ];
        if (launchBmm && exePath) {
            lines.push(`spawn(${JSON.stringify(exePath)}, [], { detached: true, stdio: 'ignore' }).unref();`);
            lines.push('// Wait for BMM to start');
            lines.push('await new Promise(r => setTimeout(r, 2000));');
            lines.push('');
        }
        // Top-level await works in ES modules — no IIFE needed
        for (const a of actions) {
            lines.push(..._jsAction(a, useEnvFile ? '__ENV__' : token, useDeeplink, BASE));
        }
        return lines.join('\n');
    }
    if (format === 'rb') {
        const tok = useEnvFile ? ENV_TOKEN_RB : `'${token || 'YOUR_TOKEN_HERE'}'`;
        const lines = [
            '# Generated by BMM Script Generator',
            "require 'net/http'", "require 'json'", "require 'uri'", '',
            `BASE  = (ENV["BMM_API_BASE"] || '${BASE}').freeze`,
            `TOKEN = ${tok}`,
            '',
            'def bmm_post(path, body)',
            '  uri = URI(BASE + path)',
            '  req = Net::HTTP::Post.new(uri)',
            "  req['Authorization'] = \"Bearer #{TOKEN}\"",
            "  req['Content-Type'] = 'application/json'",
            '  req.body = body.to_json',
            '  Net::HTTP.start(uri.host, uri.port) { |h| h.request(req) }',
            'end', '',
            'def bmm_put(path, body)',
            '  uri = URI(BASE + path)',
            '  req = Net::HTTP::Put.new(uri)',
            "  req['Authorization'] = \"Bearer #{TOKEN}\"",
            "  req['Content-Type'] = 'application/json'",
            '  req.body = body.to_json',
            '  Net::HTTP.start(uri.host, uri.port) { |h| h.request(req) }',
            'end', '',
            'def bmm_delete(path, body = nil)',
            '  uri = URI(BASE + path)',
            '  req = Net::HTTP::Delete.new(uri)',
            "  req['Authorization'] = \"Bearer #{TOKEN}\"",
            '  if body',
            "    req['Content-Type'] = 'application/json'",
            '    req.body = body.to_json',
            '  end',
            '  Net::HTTP.start(uri.host, uri.port) { |h| h.request(req) }',
            'end', '',
        ];
        if (launchBmm && exePath) {
            lines.push(`system('start "" "${exePath.replace(/\\/g, '\\\\')}"')`);
            lines.push('sleep(2)');
            lines.push('');
        }
        for (const a of actions)
            lines.push(..._genericAction(a, 'rb', useEnvFile ? '__ENV__' : token, useDeeplink, BASE));
        return lines.join('\n');
    }
    if (format === 'php') {
        const tok = useEnvFile ? `getenv('BMM_TOKEN') ?: 'YOUR_TOKEN_HERE'` : `'${token || 'YOUR_TOKEN_HERE'}'`;
        const lines = [
            '<?php', '// Generated by BMM Script Generator',
            `$base  = getenv('BMM_API_BASE') ?: '${BASE}';`,
            `$token = ${tok};`,
            '',
            'function bmm_req($base, $token, $method, $path, $body = null) {',
            '    $ch = curl_init($base . $path);',
            `    $h = ['Authorization: Bearer ' . $token];`,
            `    if ($body !== null) { $h[] = 'Content-Type: application/json'; curl_setopt($ch, CURLOPT_POSTFIELDS, $body); }`,
            '    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);',
            '    curl_setopt($ch, CURLOPT_HTTPHEADER, $h);',
            '    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);',
            '    $r = curl_exec($ch); curl_close($ch); return $r;',
            '}',
            'function bmm_post($base, $token, $path, $body)   { return bmm_req($base, $token, "POST",   $path, $body); }',
            'function bmm_put($base, $token, $path, $body)    { return bmm_req($base, $token, "PUT",    $path, $body); }',
            'function bmm_delete($base, $token, $path, $body = null) { return bmm_req($base, $token, "DELETE", $path, $body); }',
            '',
        ];
        if (launchBmm && exePath) {
            lines.push(`pclose(popen('start "" "${exePath.replace(/\\/g, '\\\\')}"', 'r'));`);
            lines.push('sleep(2);');
            lines.push('');
        }
        for (const a of actions)
            lines.push(..._genericAction(a, 'php', useEnvFile ? '__ENV__' : token, useDeeplink, BASE));
        lines.push('?>');
        return lines.join('\n');
    }
    if (format === 'go') {
        const al = [];
        const goTok = useEnvFile ? `os.Getenv("BMM_TOKEN")` : `"${token || 'YOUR_TOKEN_HERE'}"`;
        for (const a of actions)
            al.push(..._genericAction(a, 'go', useEnvFile ? '__ENV__' : token, useDeeplink, BASE).map(l => '\t' + l));
        return [
            '// Generated by BMM Script Generator',
            'package main',
            'import ("bytes";"fmt";"net/http";"os";"os/exec";"time")',
            `var bmmBase  = func() string { if v := os.Getenv("BMM_API_BASE"); v != "" { return v }; return "${BASE}" }()`,
            `var bmmToken = ${goTok}`,
            'func bmmReq(method, path, body string) {',
            '\treq,_:=http.NewRequest(method,bmmBase+path,bytes.NewBufferString(body))',
            '\treq.Header.Set("Content-Type","application/json")',
            '\treq.Header.Set("Authorization","Bearer "+bmmToken)',
            '\thttp.DefaultClient.Do(req)',
            '}',
            'func bmmPost(path, body string)   { bmmReq("POST", path, body) }',
            'func bmmPut(path, body string)    { bmmReq("PUT", path, body) }',
            'func bmmDelete(path, body string) { bmmReq("DELETE", path, body) }',
            'func main() {',
            ...(launchBmm && exePath ? [
                `\texec.Command("cmd","/c","start","","${exePath.replace(/\\/g, '\\\\')}").Start()`,
                '\ttime.Sleep(2*time.Second)',
            ] : []),
            ...al,
            '\tfmt.Println("Done.")',
            '}',
        ].join('\n');
    }
    if (format === 'java') {
        const al = [];
        const javaTok = useEnvFile ? `System.getenv("BMM_TOKEN") != null ? System.getenv("BMM_TOKEN") : "YOUR_TOKEN_HERE"` : `"${token || 'YOUR_TOKEN_HERE'}"`;
        for (const a of actions)
            al.push(..._genericAction(a, 'java', useEnvFile ? '__ENV__' : token, useDeeplink, BASE).map(l => '        ' + l));
        return [
            '// Generated by BMM Script Generator (Java 11+)',
            'import java.net.http.*;import java.net.URI;',
            'public class BmmScript {',
            `    static final String BASE=System.getenv("BMM_API_BASE")!=null?System.getenv("BMM_API_BASE"):"${BASE}";`,
            `    static final String TOKEN=${javaTok};`,
            '    static void bmmReq(String m,String p,String b) throws Exception{',
            '        var r=HttpRequest.newBuilder(URI.create(BASE+p)).method(m,HttpRequest.BodyPublishers.ofString(b))',
            '            .header("Content-Type","application/json").header("Authorization","Bearer "+TOKEN).build();',
            '        HttpClient.newHttpClient().send(r,HttpResponse.BodyHandlers.discarding());',
            '    }',
            '    static void bmmPost(String p,String b) throws Exception{ bmmReq("POST",p,b); }',
            '    static void bmmPut(String p,String b) throws Exception{ bmmReq("PUT",p,b); }',
            '    static void bmmDelete(String p,String b) throws Exception{ bmmReq("DELETE",p,b); }',
            '    public static void main(String[] a) throws Exception{',
            ...(launchBmm && exePath ? [
                `        Runtime.getRuntime().exec(new String[]{"cmd","/c","start","","${exePath.replace(/\\/g, '\\\\')}"}); Thread.sleep(2000);`,
            ] : []),
            ...al,
            '        System.out.println("Done.");',
            '    }',
            '}',
        ].join('\n');
    }
    if (format === 'cs') {
        const al = [];
        const csTok = useEnvFile ? `Environment.GetEnvironmentVariable("BMM_TOKEN") ?? "YOUR_TOKEN_HERE"` : `"${token || 'YOUR_TOKEN_HERE'}"`;
        for (const a of actions)
            al.push(..._genericAction(a, 'cs', useEnvFile ? '__ENV__' : token, useDeeplink, BASE).map(l => '        ' + l));
        return [
            '// Generated by BMM Script Generator',
            'using System;using System.Net.Http;using System.Text;using System.Threading.Tasks;using System.Diagnostics;',
            'class BmmScript {',
            '    static readonly HttpClient Http=new();',
            `    static string Base=Environment.GetEnvironmentVariable("BMM_API_BASE")??"${BASE}";`,
            `    static string Token=${csTok};`,
            '    static async Task Req(HttpMethod m,string p,string b){',
            '        var r=new HttpRequestMessage(m,Base+p);',
            '        r.Headers.Add("Authorization","Bearer "+Token);',
            '        r.Content=new StringContent(b,Encoding.UTF8,"application/json");',
            '        await Http.SendAsync(r);',
            '    }',
            '    static Task Post(string p,string b)=>Req(HttpMethod.Post,p,b);',
            '    static Task Put(string p,string b)=>Req(HttpMethod.Put,p,b);',
            '    static Task Delete(string p,string b)=>Req(HttpMethod.Delete,p,b);',
            '    static async Task Main(){',
            ...(launchBmm && exePath ? [
                `        Process.Start("${exePath.replace(/\\/g, '\\\\')}"); await Task.Delay(2000);`,
            ] : []),
            ...al,
            '        Console.WriteLine("Done.");',
            '    }',
            '}',
        ].join('\n');
    }
    if (format === 'rs') {
        const al = [];
        for (const a of actions)
            al.push(..._genericAction(a, 'rs', useEnvFile ? '__ENV__' : token, useDeeplink, BASE).map(l => '    ' + l));
        const rsTokLine = useEnvFile
            ? `    let token = std::env::var("BMM_TOKEN").unwrap_or_default();`
            : `    let token = "${token || 'YOUR_TOKEN_HERE'}";`;
        const rsStaticTok = useEnvFile ? '' : `const TOKEN:&str="${token || 'YOUR_TOKEN_HERE'}";`;
        const rsStaticBase = useEnvFile ? '' : `const BASE:&str="${BASE}";`;
        return [
            '// Generated by BMM Script Generator',
            '// Cargo.toml: reqwest = { version = "0.11", features = ["blocking"] }',
            'use std::process::Command;',
            ...(useEnvFile ? [] : [rsStaticBase, rsStaticTok]),
            'fn bmm_req(method:reqwest::Method,path:&str,body:&str,base:&str,token:&str){',
            '    let _=reqwest::blocking::Client::new()',
            '        .request(method,format!("{}{}",base,path))',
            '        .bearer_auth(token)',
            '        .header("Content-Type","application/json")',
            '        .body(body.to_string()).send();',
            '}',
            'fn bmm_post(path:&str,body:&str,base:&str,token:&str){ bmm_req(reqwest::Method::POST,path,body,base,token); }',
            'fn bmm_put(path:&str,body:&str,base:&str,token:&str){ bmm_req(reqwest::Method::PUT,path,body,base,token); }',
            'fn bmm_delete(path:&str,body:&str,base:&str,token:&str){ bmm_req(reqwest::Method::DELETE,path,body,base,token); }',
            'fn main(){',
            ...(useEnvFile ? [
                `    let base  = std::env::var("BMM_API_BASE").unwrap_or_else(|_| "${BASE}".to_string());`,
                `    let token = std::env::var("BMM_TOKEN").unwrap_or_default();`,
            ] : []),
            ...(launchBmm && exePath ? [
                `    Command::new("cmd").args(["/c","start","","${exePath.replace(/\\/g, '\\\\')}",]).spawn().ok();`,
                '    std::thread::sleep(std::time::Duration::from_secs(2));',
            ] : []),
            ...al,
            '    println!("Done.");',
            '}',
        ].filter(l => l !== '').join('\n');
    }
    return '# Unsupported format';
}
// Maps a repo/modpack/mod action to its HTTP call. Bodies use the exact
// camelCase field names the warp API expects (see src-tauri/src/api/mod.rs).
// Reads individual typed keys from `extra` (set in _collectActions) so values
// with spaces survive intact. Returns null for non-API actions.
function _apiBodyFor(a) {
    const ex = a.extra || {};
    const s = (k) => (typeof ex[k] === 'string' ? ex[k] : (ex[k] != null ? String(ex[k]) : ''));
    const bool = (k) => ex[k] === true || ex[k] === 'true';
    const num = (k, d = 0) => { const v = parseInt(ex[k], 10); return isNaN(v) ? d : v; };
    switch (a.action_type) {
        case 'enable_mod': return { method: 'POST', path: '/api/mods/enable', body: { mod_id: a.target_id } };
        case 'disable_mod': return { method: 'POST', path: '/api/mods/disable', body: { mod_id: a.target_id } };
        case 'activate_profile': return { method: 'POST', path: '/api/profiles/activate', body: { profile_id: a.target_id } };
        case 'apply_plugin': return { method: 'POST', path: '/api/plugins/apply', body: { plugin_id: a.target_id, force_strict: false } };
        case 'compare_plugin': return { method: 'POST', path: '/api/plugins/compare', body: { plugin_id: a.target_id } };
        case 'enable_modpack': return { method: 'POST', path: '/api/modpacks/enable', body: { profile_id: a.target_id } };
        case 'disable_modpack': return { method: 'POST', path: '/api/modpacks/disable', body: { profile_id: a.target_id } };
        case 'update_modpack': return { method: 'PUT', path: `/api/modpacks/${s('modpack_id') || 'MODPACK_ID'}`,
            body: { name: s('name'), dependency_mode: s('dependency_mode') || 'none' } };
        case 'sync_repo': return { method: 'POST', path: '/api/repo/sync', body: {
                url: s('url') || 'REPO_URL', modsDir: s('mods_dir'), backupDir: s('backup_dir'), gameDir: s('game_dir'),
                choices: [], overwriteAll: bool('overwrite_all'), deleteExtra: bool('delete_extra'), downloadLimit: num('download_limit'),
                ...(s('password') ? { password: s('password') } : {})
            } };
        case 'gen_repo': return { method: 'POST', path: '/api/repo/gen', body: {
                profileIds: s('profile_id') ? [s('profile_id')] : [], outputDir: s('output_dir'), authorName: s('author') || 'Author',
                lightweight: bool('lightweight'), zipOutput: bool('zip'), generateServer: bool('generate_server'),
                autoStart: bool('auto_start'), port: num('port', 8080) || 8080, adminPassword: s('admin_pass'), uploadLimit: num('upload_limit')
            } };
        case 'http_host': return { method: 'POST', path: '/api/repo/host', body: {
                serveDir: s('serve_dir'), port: num('port', 8080) || 8080, uploadLimit: num('upload_limit')
            } };
        case 'cancel_sync': return { method: 'DELETE', path: '/api/repo/sync/cancel', body: {} };
        case 'cancel_gen': return { method: 'DELETE', path: '/api/repo/gen/cancel', body: {} };
        case 'stop_http_host': return { method: 'DELETE', path: '/api/repo/host', body: {} };
        // ── Read-only (GET, unauthenticated) ──────────────────────────────
        case 'get_status': return { method: 'GET', path: '/api/status', body: {} };
        case 'list_mods': return { method: 'GET', path: '/api/mods', body: {} };
        case 'list_active_mods': return { method: 'GET', path: '/api/mods/active', body: {} };
        case 'list_all_mods': return { method: 'GET', path: '/api/mods/all', body: {} };
        case 'list_profiles': return { method: 'GET', path: '/api/profiles', body: {} };
        case 'list_plugins': return { method: 'GET', path: '/api/plugins', body: {} };
        case 'list_modpacks': return { method: 'GET', path: '/api/modpacks', body: {} };
        case 'check_update': return { method: 'GET', path: '/api/check-update', body: {} };
        case 'get_creator_id': return { method: 'GET', path: '/api/creator-id', body: {} };
        case 'api_health': return { method: 'GET', path: '/api/health', body: {} };
        case 'repo_list': return { method: 'GET', path: '/api/repo/list', body: {} };
        case 'repo_info': return { method: 'GET',
            path: `/api/repo/info?url=${encodeURIComponent(s('url') || 'REPO_URL')}${s('password') ? `&password=${encodeURIComponent(s('password'))}` : ''}`, body: {} };
        // ── Mods / profiles / modpacks (writes — snake_case bodies) ───────
        case 'delete_mod': return { method: 'DELETE', path: `/api/mods/${a.target_id || 'MOD_ID'}`, body: {} };
        case 'update_mod': return { method: 'PUT', path: `/api/mods/${a.target_id || 'MOD_ID'}`,
            body: _prune({ name: s('name'), version: s('version'), author: s('author'), description: s('description') }) };
        case 'create_profile': return { method: 'POST', path: '/api/profiles', body: {
                name: s('name'), game_name: s('game_name'), game_path: s('game_path'),
                mods_path: s('mods_path'), backup_path: s('backup_path')
            } };
        case 'update_profile': return { method: 'PUT', path: `/api/profiles/${a.target_id || 'PROFILE_ID'}`,
            body: _prune({ name: s('name'), game_name: s('game_name'), color: s('color'), icon: s('icon'),
                game_path: s('game_path'), mods_path: s('mods_path'), backup_path: s('backup_path') }) };
        case 'delete_profile': return { method: 'DELETE', path: `/api/profiles/${a.target_id || 'PROFILE_ID'}`, body: {} };
        case 'restart': return { method: 'POST', path: '/api/restart', body: {} };
        case 'create_modpack': return { method: 'POST', path: '/api/modpacks/create',
            body: _prune({ name: s('name'), description: s('description'), game_name: s('game_name'),
                sr_link: s('sr_link'), dependency_mode: s('dependency_mode') || 'none' }) };
        case 'delete_modpack': return { method: 'DELETE', path: `/api/modpacks/${s('modpack_id') || 'MODPACK_ID'}`, body: {} };
        case 'repo_connect': return { method: 'POST', path: '/api/repo/connect', body: { url: s('url') || 'REPO_URL' } };
        case 'repo_remove': return { method: 'DELETE', path: '/api/repo', body: { url: s('url') || 'REPO_URL' } };
        case 'update_repo': return { method: 'POST', path: '/api/repo/update', body: { repoDir: s('repoDir') || 'C:/MyRepo' } };
        // ── App Catalog ───────────────────────────────────────────────────
        case 'install_app': return { method: 'POST', path: '/api/apps/install', body: _prune({
                appId: s('appId') || 'my-app', appTitle: s('appTitle') || s('appId') || 'My App',
                downloadUrl: s('downloadUrl') || 'https://…', fileType: s('fileType') || 'exe', installPath: s('installPath')
            }) };
        case 'launch_app': return { method: 'POST', path: '/api/apps/launch', body: {
                appId: s('appId') || 'my-app', exePath: s('exePath') || 'C:/Apps/app.exe'
            } };
        case 'uninstall_app': return { method: 'DELETE', path: `/api/apps/${s('appId') || 'APP_ID'}`, body: {} };
        case 'list_installed_apps': return { method: 'GET', path: '/api/apps', body: {} };
        case 'check_mod_updates': return { method: 'POST', path: '/api/mod/check-updates', body: {} };
        case 'run_launchpack': return { method: 'POST', path: '/api/launchpack/run', body: { id: a.target_id } };
        case 'run_task': return { method: 'POST', path: '/api/schedule/run', body: { id: a.target_id } };
        case 'run_benchmark': {
            const sources = s('sources').split(';').map(x => x.trim()).filter(Boolean);
            const dataset = (s('dataset') === 'real' || sources.length) ? 'real' : 'sandbox';
            return { method: 'POST', path: '/api/benchmark', body: { dataset, size: s('size') || 'M', mode: 'auto', sources } };
        }
        // The endpoints added with the doorbell, the keys, the catalogue sources and what a
        // repo carries. A generated script speaks this API, so an action in the catalogue
        // with no case here is one that renders a step and emits nothing.
        case 'signal': {
            // The payload is sent as JSON when it parses as JSON and as a string when it
            // does not — somebody typing a plain word should not have to quote it into one.
            const raw = s('data');
            let data = null;
            if (raw) {
                try {
                    data = JSON.parse(raw);
                }
                catch {
                    data = raw;
                }
            }
            return { method: 'POST', path: '/api/hook', body: { name: s('name'), data } };
        }
        case 'new_key': return { method: 'POST', path: '/api/keys', body: _prune({ name: s('name'), kind: s('kind') || 'ed25519' }) };
        case 'follow_catalog': return { method: 'POST', path: '/api/catalogs', body: { type: s('type') || 'plugin', url: s('url'), follow: bool('follow') } };
        case 'repo_take': return { method: 'POST', path: '/api/repo/extras', body: _prune({ url: s('url'), kind: s('kind'), id: s('id'), password: s('password') }) };
        case 'repo_sync_now': return { method: 'POST', path: '/api/repo/sync-now', body: _prune({ url: s('url'), repoProfile: s('repoProfile'), targetProfile: s('targetProfile'), gameDir: s('gameDir'), modsDir: s('modsDir'), backupDir: s('backupDir'), password: s('password'), overwriteAll: bool('overwriteAll'), deleteExtra: bool('deleteExtra') }) };
        // Typed as a comma-separated list, because a generated script has no place for a
        // multi-select. Split here so the body carries the array the route expects.
        case 'repo_gen_now': return { method: 'POST', path: '/api/repo/gen-now', body: _prune({ outputDir: s('outputDir'), authorName: s('authorName'), profileIds: s('profileIds').split(',').map((x) => x.trim()).filter(Boolean), seed: s('seed'), zipOutput: bool('zipOutput'), zipMods: bool('zipMods') }) };
        case 'repo_host_now': return { method: 'POST', path: '/api/repo/host-now', body: _prune({ path: s('path'), port: parseInt(s('port'), 10) || 0, downloadPassword: s('downloadPassword') }) };
        case 'repo_update_now': return { method: 'POST', path: '/api/repo/update-now', body: _prune({ repoDir: s('repoDir'), authorName: s('authorName') }) };
        case 'content_id': return { method: 'POST', path: '/api/content-id', body: _prune({ kind: s('kind'), id: s('id'), path: s('path') }) };
        case 'open_view': return { method: 'POST', path: '/api/view', body: { id: s('id') } };
        case 'repo_manifest': return { method: 'POST', path: '/api/repo/manifest', body: _prune({ dir: s('dir') }) };
        case 'set_schedule': return { method: 'POST', path: '/api/schedules/enabled', body: { id: s('id'), enabled: bool('enabled') } };
        case 'discord_rpc': return { method: 'POST', path: '/api/discord/rpc', body: { enabled: bool('enabled') } };
        case 'export_data': return { method: 'POST', path: '/api/data/export-auto', body: _prune({ dir: s('dir'), name: s('name'), increment: s('increment') || 'paren' }) };
        // ── Privacy & telemetry / Session recorder / replay ───────────────
        case 'telemetry_consent': return { method: 'POST', path: '/api/telemetry/consent', body: { enabled: bool('enabled') } };
        case 'telemetry_settings': return { method: 'POST', path: '/api/telemetry/settings', body: { replay: bool('replay'), full: bool('full'), bench: bool('bench') } };
        case 'recorder_set': return { method: 'POST', path: '/api/recorder', body: { on: bool('on'), full: bool('full'), rust: bool('rust'), js: bool('js') } };
        case 'replay_export': return { method: 'POST', path: '/api/replay/export', body: {} };
        case 'replay_import': return { method: 'POST', path: '/api/replay/import', body: _prune({ path: s('path'), url: s('url') }) };
        default: return null;
    }
}
// Drops empty-string keys so PUT/update calls don't overwrite fields with "".
function _prune(o) {
    const out = {};
    for (const [k, v] of Object.entries(o))
        if (v !== '' && v != null)
            out[k] = v;
    return out;
}
// Actions that have a native bmm:// deeplink. Anything else that has an API
// call must fall back to HTTP (and therefore needs a token) even in deeplink
// mode. Mirrors action_to_deeplink in src-tauri/src/commands/plugins.rs.
const _DEEPLINKABLE = new Set([
    'enable_mod', 'disable_mod', 'activate_profile',
    'apply_plugin', 'compare_plugin', 'enable_modpack', 'disable_modpack',
    'telemetry_consent', 'telemetry_settings', 'recorder_set', 'replay_export', 'replay_import',
    'check_mod_updates', 'discord_rpc', 'export_data', 'run_benchmark',
    'run_launchpack', 'run_task',
]);
// Returns true if any action will issue an authenticated HTTP call given the
// chosen mode. Mirrors actions_need_api in the Rust backend so the generated
// token block (deeplink fallback) always gets a real token.
function _actionsNeedApi(actions, useDeeplink) {
    return actions.some(a => {
        const hasApi = _apiBodyFor(a) !== null;
        if (!hasApi)
            return false;
        return useDeeplink ? !_DEEPLINKABLE.has(a.action_type) : true;
    });
}
// Generic action renderer for simpler languages (Ruby, PHP, Go, Java, C#, Rust)
function _genericAction(a, lang, token, useDeeplink, base) {
    const _ex = a.extra || {};
    const _xb = (k) => (_ex[k] === true || _ex[k] === 'true') ? '1' : '0';
    const dlMap = {
        enable_mod: `bmm://mod/enable?id=${a.target_id}`,
        disable_mod: `bmm://mod/disable?id=${a.target_id}`,
        activate_profile: `bmm://profile/activate?id=${a.target_id}`,
        apply_plugin: `bmm://plugin/activate?id=${a.target_id}`,
        compare_plugin: `bmm://plugin/compare?id=${a.target_id}`,
        enable_modpack: `bmm://modpack/enable?id=${a.target_id}`,
        disable_modpack: `bmm://modpack/disable?id=${a.target_id}`,
        telemetry_consent: `bmm://telemetry/consent?enabled=${_xb('enabled')}`,
        telemetry_settings: `bmm://telemetry/set?replay=${_xb('replay')}&full=${_xb('full')}&bench=${_xb('bench')}`,
        recorder_set: `bmm://recorder/set?on=${_xb('on')}&full=${_xb('full')}&rust=${_xb('rust')}&js=${_xb('js')}`,
        replay_export: `bmm://replay/export`,
        replay_import: `bmm://replay/import?path=${encodeURIComponent(_ex.path || '')}&url=${encodeURIComponent(_ex.url || '')}`,
        check_mod_updates: `bmm://mod/check-updates`,
        run_launchpack: `bmm://launchpack/run?id=${a.target_id}`,
        run_task: `bmm://schedule/run?id=${a.target_id}`,
        run_benchmark: `bmm://benchmark/run?dataset=${(_ex.dataset === 'real' || (_ex.sources || '')) ? 'real' : 'sandbox'}&size=${encodeURIComponent(_ex.size || 'M')}&mode=auto&sources=${encodeURIComponent(_ex.sources || '')}`,
        discord_rpc: `bmm://discord/rpc?enabled=${_xb('enabled')}`,
        export_data: `bmm://data/export-auto?dir=${encodeURIComponent(_ex.dir || '')}&name=${encodeURIComponent(_ex.name || '')}&increment=${encodeURIComponent(_ex.increment || 'paren')}`,
    };
    const comment = (t) => lang === 'php' ? `// ${t}` : lang === 'rs' ? `// ${t}` : `// ${t}`;
    const printFn = (msg) => ({
        rb: `puts ${JSON.stringify(msg)}`,
        php: `echo ${JSON.stringify(msg)};`,
        go: `fmt.Println(${JSON.stringify(msg)})`,
        java: `System.out.println(${JSON.stringify(msg)});`,
        cs: `Console.WriteLine(${JSON.stringify(msg)});`,
        rs: `println!("{}", ${JSON.stringify(msg)});`,
    })[lang] || `// print: ${msg}`;
    const sleepFn = (ms) => {
        const s = ms / 1000;
        return ({
            rb: `sleep(${s})`,
            php: `sleep(${Math.ceil(s)});`,
            go: `time.Sleep(${ms}*time.Millisecond)`,
            java: `Thread.sleep(${ms});`,
            cs: `await Task.Delay(${ms});`,
            rs: `std::thread::sleep(std::time::Duration::from_millis(${ms}));`,
        })[lang] || `// sleep ${ms}ms`;
    };
    const isEnv = token === '__ENV__';
    // PHP single-quoted string literal: only \ and ' need escaping.
    const phpStr = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    const postFn = (path, body) => ({
        rb: `bmm_post('${path}', ${body})`,
        php: `bmm_post($base, $token, '${path}', ${phpStr(body)});`,
        go: `bmmPost("${path}", \`${body}\`)`,
        java: `bmmPost("${path}", "${body.replace(/"/g, '\\"')}");`,
        cs: `await Post("${path}", "${body.replace(/"/g, '\\"')}");`,
        rs: isEnv ? `bmm_post("${path}", r#"${body}"#, &base, &token);` : `bmm_post("${path}", r#"${body}"#, BASE, TOKEN);`,
    })[lang] || `// post ${path}`;
    const dlFn = (url) => ({
        rb: `system('start "" "${url}"')`,
        php: `shell_exec('start "" "${url}"');`,
        go: `exec.Command("cmd","/c","start","","${url}").Run()`,
        java: `Runtime.getRuntime().exec(new String[]{"cmd","/c","start","","${url}"});`,
        cs: `Process.Start("${url}");`,
        rs: `Command::new("cmd").args(["/c","start","","${url}"]).spawn().ok();`,
    })[lang] || `// open ${url}`;
    // DELETE helper (cancel / stop / delete). Optional JSON body for the few
    // DELETE routes that require one (e.g. DELETE /api/repo needs { url }).
    const delFn = (path, body) => {
        const b = body && body !== '{}' ? body : '';
        return ({
            rb: b ? `bmm_delete('${path}', ${b})` : `bmm_delete('${path}')`,
            php: b ? `bmm_delete($base, $token, '${path}', ${phpStr(b)});` : `bmm_delete($base, $token, '${path}');`,
            go: b ? `bmmDelete("${path}", \`${b}\`)` : `bmmDelete("${path}", "")`,
            java: b ? `bmmDelete("${path}", "${b.replace(/"/g, '\\"')}");` : `bmmDelete("${path}", "");`,
            cs: b ? `await Delete("${path}", "${b.replace(/"/g, '\\"')}");` : `await Delete("${path}", "");`,
            rs: isEnv
                ? `bmm_delete("${path}", r#"${b}"#, &base, &token);`
                : `bmm_delete("${path}", r#"${b}"#, BASE, TOKEN);`,
        })[lang] || `// DELETE ${path}`;
    };
    // PUT helper
    const putFn = (path, body) => ({
        rb: `bmm_put('${path}', ${body})`,
        php: `bmm_put($base, $token, '${path}', ${phpStr(body)});`,
        go: `bmmPut("${path}", \`${body}\`)`,
        java: `bmmPut("${path}", "${body.replace(/"/g, '\\"')}");`,
        cs: `await Put("${path}", "${body.replace(/"/g, '\\"')}");`,
        rs: isEnv ? `bmm_put("${path}", r#"${body}"#, &base, &token);` : `bmm_put("${path}", r#"${body}"#, BASE, TOKEN);`,
    })[lang] || `// PUT ${path}`;
    // GET helper — GET endpoints are unauthenticated, so emit a simple inline
    // request (no shared helper / token needed).
    const getFn = (path) => ({
        rb: `puts Net::HTTP.get(URI("#{BASE}${path}"))`,
        php: `echo file_get_contents($base . '${path}');`,
        go: `if r, e := http.Get(BASE+"${path}"); e==nil { b,_:=io.ReadAll(r.Body); fmt.Println(string(b)) }`,
        java: `System.out.println(new String(new java.net.URL(BASE + "${path}").openStream().readAllBytes()));`,
        cs: `Console.WriteLine(await new HttpClient().GetStringAsync(BASE + "${path}"));`,
        rs: isEnv ? `if let Ok(r)=reqwest::blocking::get(format!("{}{}",base,"${path}")){ println!("{}", r.text().unwrap_or_default()); }`
            : `if let Ok(r)=reqwest::blocking::get(format!("{}{}",BASE,"${path}")){ println!("{}", r.text().unwrap_or_default()); }`,
    })[lang] || `// GET ${path}`;
    // Generic dispatch for any API-mapped action without a dedicated case above.
    const genericApi = () => {
        const ep = _apiBodyFor(a);
        if (!ep)
            return null;
        if (ep.method === 'GET')
            return [getFn(ep.path)];
        if (ep.method === 'DELETE')
            return [delFn(ep.path, JSON.stringify(ep.body))];
        if (ep.method === 'PUT')
            return [putFn(ep.path, JSON.stringify(ep.body))];
        return [postFn(ep.path, JSON.stringify(ep.body))];
    };
    switch (a.action_type) {
        case 'enable_mod':
        case 'disable_mod':
        case 'activate_profile':
        case 'apply_plugin':
        case 'compare_plugin':
        case 'enable_modpack':
        case 'disable_modpack':
        case 'sync_repo':
        case 'gen_repo':
        case 'http_host': {
            const dl = dlMap[a.action_type];
            const ep = _apiBodyFor(a);
            return [dl && useDeeplink ? dlFn(dl) : postFn(ep.path, JSON.stringify(ep.body))];
        }
        case 'update_modpack': {
            const ep = _apiBodyFor(a);
            return [putFn(ep.path, JSON.stringify(ep.body))];
        }
        case 'cancel_sync':
            return [delFn('/api/repo/sync/cancel')];
        case 'cancel_gen':
            return [delFn('/api/repo/gen/cancel')];
        case 'stop_http_host':
            return [delFn('/api/repo/host')];
        case 'wait':
            return [sleepFn(a.extra.duration_ms || 1000)];
        case 'log':
            return [printFn(a.extra.message || '')];
        case 'comment':
            return [comment(a.extra.text || '')];
        case 'set_variable': {
            const expr = a.extra.expr || 'name=value';
            const [n, ...rest] = expr.split('=');
            const v = JSON.stringify(rest.join('=').trim());
            return ({
                rb: [`${n.trim()} = ${v}`],
                php: [`$${n.trim()} = ${v};`],
                go: [`${n.trim()} := ${v}`],
                java: [`String ${n.trim()} = ${v};`],
                cs: [`var ${n.trim()} = ${v};`],
                rs: [`let ${n.trim()} = ${v};`],
            })[lang] || [`// set ${expr}`];
        }
        case 'if_file_exists': {
            const p = a.extra.path || '';
            return ({
                rb: [`if File.exist?(${JSON.stringify(p)})`],
                php: [`if (file_exists(${JSON.stringify(p)})) {`],
                go: [`if _, err := os.Stat(${JSON.stringify(p)}); err == nil {`],
                java: [`if (new java.io.File(${JSON.stringify(p)}).exists()) {`],
                cs: [`if (File.Exists(${JSON.stringify(p)})) {`],
                rs: [`if std::path::Path::new(${JSON.stringify(p)}).exists() {`],
            })[lang] || [`// if file exists: ${p}`];
        }
        case 'if_file_not_exists': {
            const p = a.extra.path || '';
            return ({
                rb: [`if !File.exist?(${JSON.stringify(p)})`],
                php: [`if (!file_exists(${JSON.stringify(p)})) {`],
                go: [`if _, err := os.Stat(${JSON.stringify(p)}); os.IsNotExist(err) {`],
                java: [`if (!new java.io.File(${JSON.stringify(p)}).exists()) {`],
                cs: [`if (!File.Exists(${JSON.stringify(p)})) {`],
                rs: [`if !std::path::Path::new(${JSON.stringify(p)}).exists() {`],
            })[lang] || [`// if file missing: ${p}`];
        }
        case 'if_var_eq': {
            const [vn, ...vr] = (a.extra.cond || 'name=value').split('=');
            const n = vn.trim(), v = JSON.stringify(vr.join('=').trim());
            return ({
                rb: [`if ${n} == ${v}`],
                php: [`if ($${n} == ${v}) {`],
                go: [`if ${n} == ${v} {`],
                java: [`if (${n}.equals(${v})) {`],
                cs: [`if (${n} == ${v}) {`],
                rs: [`if ${n} == ${v} {`],
            })[lang] || [`// if ${n} == ${v}`];
        }
        case 'if_var_neq': {
            const [vn, ...vr] = (a.extra.cond || 'name=value').split('=');
            const n = vn.trim(), v = JSON.stringify(vr.join('=').trim());
            return ({
                rb: [`if ${n} != ${v}`],
                php: [`if ($${n} != ${v}) {`],
                go: [`if ${n} != ${v} {`],
                java: [`if (!${n}.equals(${v})) {`],
                cs: [`if (${n} != ${v}) {`],
                rs: [`if ${n} != ${v} {`],
            })[lang] || [`// if ${n} != ${v}`];
        }
        case 'if_api_ok':
            return ({
                rb: ['if true # (last-API-result branching is only tracked in .bat/.ps1/.vbs/.py/.js/.lua exports)'],
                php: ['if (true) { // (last-API-result branching only tracked in bat/ps1/vbs/py/js/lua exports)'],
                go: ['if true { // (last-API-result branching only tracked in bat/ps1/vbs/py/js/lua exports)'],
                java: ['if (true) { // (last-API-result branching only tracked in bat/ps1/vbs/py/js/lua exports)'],
                cs: ['if (true) { // (last-API-result branching only tracked in bat/ps1/vbs/py/js/lua exports)'],
                rs: ['if true { // (last-API-result branching only tracked in bat/ps1/vbs/py/js/lua exports)'],
            })[lang] || ['// if api ok'];
        case 'if_api_err':
            return ({
                rb: ['if false # (last-API-result branching not tracked in this export)'],
                php: ['if (false) { // (last-API-result branching not tracked in this export)'],
                go: ['if false { // (last-API-result branching not tracked in this export)'],
                java: ['if (false) { // (last-API-result branching not tracked in this export)'],
                cs: ['if (false) { // (last-API-result branching not tracked in this export)'],
                rs: ['if false { // (last-API-result branching not tracked in this export)'],
            })[lang] || ['// if api err'];
        case 'pause_key':
            return ({
                rb: ['puts "Press Enter to continue..."; STDIN.gets'],
                php: ['echo "Press Enter to continue..."; fgets(STDIN);'],
                go: ['fmt.Println("Press Enter to continue..."); fmt.Scanln()'],
                java: ['System.out.println("Press Enter to continue..."); new java.util.Scanner(System.in).nextLine();'],
                cs: ['Console.WriteLine("Press Enter to continue..."); Console.ReadLine();'],
                rs: ['{ println!("Press Enter to continue..."); let mut _s = String::new(); std::io::stdin().read_line(&mut _s).ok(); }'],
            })[lang] || ['// pause'];
        case 'stop_script':
            return ({
                rb: ['exit 0'],
                php: ['exit(0);'],
                go: ['os.Exit(0)'],
                java: ['System.exit(0);'],
                cs: ['Environment.Exit(0);'],
                rs: ['std::process::exit(0);'],
            })[lang] || ['// stop'];
        case 'else_block':
            return ({
                rb: ['else'],
                php: ['} else {'],
                go: ['} else {'],
                java: ['} else {'],
                cs: ['} else {'],
                rs: ['} else {'],
            })[lang] || ['else'];
        case 'end_block':
            return ({
                rb: ['end'],
                php: ['}'],
                go: ['}'],
                java: ['}'],
                cs: ['}'],
                rs: ['}'],
            })[lang] || ['}'];
        case 'raw_code':
            return [a.extra.code || ''];
        case 'loop_start': {
            const n = Math.max(1, parseInt(a.extra.count, 10) || 1);
            return ({
                rb: [`${n}.times do`],
                php: [`for ($i = 0; $i < ${n}; $i++) {`],
                go: [`for i := 0; i < ${n}; i++ {`],
                java: [`for (int i = 0; i < ${n}; i++) {`],
                cs: [`for (int i = 0; i < ${n}; i++) {`],
                rs: [`for _ in 0..${n} {`],
            })[lang] || [`// loop ${n}x`];
        }
        case 'loop_end':
            return ({ rb: ['end'], php: ['}'], go: ['}'], java: ['}'], cs: ['}'], rs: ['}'] })[lang] || ['}'];
        case 'verify_file': {
            const p = a.extra.path || '';
            const vn = a.extra.var_name || 'FILE_HASH';
            return ({
                rb: [`require 'digest'`, `${vn} = Digest::SHA256.file(${JSON.stringify(p)}).hexdigest`],
                php: [`$${vn} = hash_file('sha256', ${JSON.stringify(p)});`],
                go: [`// verify_file needs crypto/sha256 + os; compute SHA-256 of ${p} into ${vn}`],
                java: [`String ${vn} = javax.xml.bind.DatatypeConverter.printHexBinary(java.security.MessageDigest.getInstance("SHA-256").digest(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(${JSON.stringify(p)})))).toLowerCase();`],
                cs: [`string ${vn} = BitConverter.ToString(System.Security.Cryptography.SHA256.Create().ComputeHash(File.ReadAllBytes(${JSON.stringify(p)}))).Replace("-","").ToLower();`],
                rs: [`// verify_file: compute SHA-256 of ${p} into ${vn} (add the sha2 crate)`],
            })[lang] || [`// verify ${p} → ${vn}`];
        }
        case 'wait_until': {
            const p = a.extra.path || '';
            const to = parseInt(a.extra.timeout, 10) || 120;
            const pl = parseInt(a.extra.poll, 10) || 2;
            return ({
                rb: [`require 'fileutils'`, `_dl = Time.now + ${to}`, `sleep ${pl} while !File.exist?(${JSON.stringify(p)}) && Time.now < _dl`],
                php: [`$_dl = time() + ${to};`, `while (!file_exists(${JSON.stringify(p)}) && time() < $_dl) { sleep(${pl}); }`],
                go: [`{ _dl := time.Now().Add(${to} * time.Second); for { if _, e := os.Stat(${JSON.stringify(p)}); e == nil || time.Now().After(_dl) { break }; time.Sleep(${pl} * time.Second) } }`],
                java: [`{ long _dl = System.currentTimeMillis() + ${to}*1000L; while (!new java.io.File(${JSON.stringify(p)}).exists() && System.currentTimeMillis() < _dl) Thread.sleep(${pl}*1000L); }`],
                cs: [`{ var _dl = DateTime.Now.AddSeconds(${to}); while (!File.Exists(${JSON.stringify(p)}) && DateTime.Now < _dl) System.Threading.Thread.Sleep(${pl}*1000); }`],
                rs: [`{ let _dl = std::time::Instant::now() + std::time::Duration::from_secs(${to}); while !std::path::Path::new(${JSON.stringify(p)}).exists() && std::time::Instant::now() < _dl { std::thread::sleep(std::time::Duration::from_secs(${pl})); } }`],
            })[lang] || [`// wait until file exists: ${p} (timeout ${to}s)`];
        }
        case 'math_set': {
            const v = a.extra.var_name || 'RESULT';
            const ex = a.extra.expr || '0';
            return ({
                rb: [`${v} = (${ex})`], php: [`$${v} = (${ex});`], go: [`${v} := (${ex})`],
                java: [`double ${v} = (${ex});`], cs: [`var ${v} = (${ex});`], rs: [`let ${v} = (${ex});`],
            })[lang] || [`${v} = (${ex})`];
        }
        case 'ternary': {
            const v = a.extra.var_name || 'RESULT';
            const c = a.extra.cond || 'true';
            const tt = a.extra.val_true || '1';
            const ff = a.extra.val_false || '0';
            return ({
                rb: [`${v} = (${c}) ? ${tt} : ${ff}`], php: [`$${v} = (${c}) ? ${tt} : ${ff};`],
                go: [`var ${v} interface{}; if ${c} { ${v} = ${tt} } else { ${v} = ${ff} }`],
                java: [`var ${v} = (${c}) ? ${tt} : ${ff};`], cs: [`var ${v} = (${c}) ? ${tt} : ${ff};`],
                rs: [`let ${v} = if ${c} { ${tt} } else { ${ff} };`],
            })[lang] || [`${v} = (${c}) ? ${tt} : ${ff}`];
        }
        case 'guard_stop': {
            const c = a.extra.cond || 'false';
            return ({
                rb: [`exit 0 if (${c})`], php: [`if (${c}) { exit(0); }`], go: [`if ${c} { os.Exit(0) }`],
                java: [`if (${c}) System.exit(0);`], cs: [`if (${c}) Environment.Exit(0);`], rs: [`if ${c} { std::process::exit(0); }`],
            })[lang] || [`if (${c}) /* stop */ ;`];
        }
        case 'show_message':
            return [printFn(`[MSG] ${a.extra.message || ''}`)];
        case 'open_url': {
            const url = a.extra.url || '';
            return [dlFn(url)];
        }
        case 'launch_game': {
            const exe = a.extra.exe_path || '';
            return [dlFn(exe)];
        }
        default:
            return genericApi() || [comment(`Unknown action: ${a.action_type}`)];
    }
}
function _pyAction(a, token, useDeeplink, base) {
    const isEnvVar = token === '__ENV__';
    const auth = isEnvVar
        ? `headers={"Authorization": f"Bearer {TOKEN}"}`
        : (token ? `headers={"Authorization": "Bearer ${token}"}` : '');
    const deeplink = (path, id) => `webbrowser.open(f"bmm://${path}/${id}")`;
    // Each call captures `_bmm_ok` so if_api_ok / if_api_err can branch on it.
    const apiPost = (ep, body) => `_bmm = requests.post(f"{BASE}${ep}", json=${JSON.stringify(body)}${auth ? ', ' + auth : ''}); _bmm_ok = _bmm.ok`;
    const apiDelete = (ep, body) => (body && Object.keys(body).length
        ? `_bmm = requests.delete(f"{BASE}${ep}", json=${JSON.stringify(body)}${auth ? ', ' + auth : ''})`
        : `_bmm = requests.delete(f"{BASE}${ep}"${auth ? ', ' + auth : ''})`) + `; _bmm_ok = _bmm.ok`;
    const apiPut = (ep, body) => `_bmm = requests.put(f"{BASE}${ep}", json=${JSON.stringify(body)}${auth ? ', ' + auth : ''}); _bmm_ok = _bmm.ok`;
    switch (a.action_type) {
        case 'enable_mod':
            return [useDeeplink
                    ? deeplink('enable', a.target_id)
                    : `${apiPost('/api/mods/enable', { mod_id: a.target_id })}`];
        case 'disable_mod':
            return [useDeeplink
                    ? deeplink('disable', a.target_id)
                    : `${apiPost('/api/mods/disable', { mod_id: a.target_id })}`];
        case 'activate_profile':
            return [useDeeplink
                    ? deeplink('profile', a.target_id)
                    : `${apiPost('/api/profiles/activate', { profile_id: a.target_id })}`];
        case 'apply_plugin':
            return [`${apiPost('/api/plugins/apply', { plugin_id: a.target_id, force_strict: false })}`];
        case 'compare_plugin':
            return [`${apiPost('/api/plugins/compare', { plugin_id: a.target_id })}`];
        case 'enable_modpack':
            return [useDeeplink ? deeplink('modpack/enable', a.target_id) : `${apiPost('/api/modpacks/enable', { profile_id: a.target_id })}`];
        case 'disable_modpack':
            return [useDeeplink ? deeplink('modpack/disable', a.target_id) : `${apiPost('/api/modpacks/disable', { profile_id: a.target_id })}`];
        case 'update_modpack': {
            const ep = _apiBodyFor(a);
            return [`${apiPut(ep.path, ep.body)}`];
        }
        case 'sync_repo':
        case 'gen_repo':
        case 'http_host': {
            const ep = _apiBodyFor(a);
            return [`${apiPost(ep.path, ep.body)}`];
        }
        case 'cancel_sync':
            return [`${apiDelete('/api/repo/sync/cancel')}`];
        case 'cancel_gen':
            return [`${apiDelete('/api/repo/gen/cancel')}`];
        case 'stop_http_host':
            return [`${apiDelete('/api/repo/host')}`];
        case 'wait':
            return [`time.sleep(${((a.extra.duration_ms || 1000) / 1000).toFixed(1)})`];
        case 'show_message':
            return [`import tkinter as tk; root=tk.Tk(); root.withdraw(); tk.messagebox.showinfo("BMM", ${JSON.stringify(a.extra.message || '')}); root.destroy()`];
        case 'open_url':
            return [`webbrowser.open(${JSON.stringify(a.extra.url || '')})`];
        case 'launch_game':
            return [`subprocess.Popen(${JSON.stringify(a.extra.exe_path || '')})`];
        case 'log':
            return [`print(${JSON.stringify(a.extra.message || '')})`];
        case 'comment':
            return [`# ${a.extra.text || ''}`];
        case 'set_variable': {
            const expr = a.extra.expr || 'name=value';
            const [n, ...rest] = expr.split('=');
            return [`${n.trim()} = ${JSON.stringify(rest.join('=').trim())}`];
        }
        case 'if_file_exists':
            return [`if os.path.exists(${JSON.stringify(a.extra.path || '')}):`];
        case 'if_file_not_exists':
            return [`if not os.path.exists(${JSON.stringify(a.extra.path || '')}):`];
        case 'if_var_eq': {
            const [vn, ...vr] = (a.extra.cond || 'name=value').split('=');
            return [`if ${vn.trim()} == ${JSON.stringify(vr.join('=').trim())}:`];
        }
        case 'if_var_neq': {
            const [vn, ...vr] = (a.extra.cond || 'name=value').split('=');
            return [`if ${vn.trim()} != ${JSON.stringify(vr.join('=').trim())}:`];
        }
        case 'if_api_ok': {
            const pre = a.extra.api_action ? _pyAction({ action_type: a.extra.api_action, target_id: '', extra: {} }, token, false, base) : [];
            return [...pre, `if _bmm_ok:`];
        }
        case 'if_api_err': {
            const pre = a.extra.api_action ? _pyAction({ action_type: a.extra.api_action, target_id: '', extra: {} }, token, false, base) : [];
            return [...pre, `if not _bmm_ok:`];
        }
        case 'pause_key':
            return [`input("Press Enter to continue...")`];
        case 'stop_script':
            return [`raise SystemExit(0)`];
        case 'else_block':
            return ['else:'];
        case 'end_block':
            return ['# end'];
        case 'raw_code':
            return [a.extra.code || ''];
        case 'loop_start':
            return [`for _i in range(${Math.max(1, parseInt(a.extra.count, 10) || 1)}):`];
        case 'loop_end':
            return ['# end loop'];
        case 'verify_file': {
            const p = a.extra.path || '';
            const vn = a.extra.var_name || 'FILE_HASH';
            return [`import hashlib as _hl`, `${vn} = _hl.sha256(open(${JSON.stringify(p)}, "rb").read()).hexdigest()`];
        }
        case 'wait_until': {
            const p = a.extra.path || '';
            const to = parseInt(a.extra.timeout, 10) || 120;
            const pl = parseInt(a.extra.poll, 10) || 2;
            return [`import os as _os, time as _tm`, `_deadline = _tm.time() + ${to}`,
                `while not _os.path.exists(${JSON.stringify(p)}) and _tm.time() < _deadline:`, `    _tm.sleep(${pl})`];
        }
        case 'math_set':
            return [`${a.extra.var_name || 'RESULT'} = (${a.extra.expr || '0'})`];
        case 'ternary':
            return [`${a.extra.var_name || 'RESULT'} = (${a.extra.val_true || '1'}) if (${a.extra.cond || 'True'}) else (${a.extra.val_false || '0'})`];
        case 'guard_stop':
            return [`if (${a.extra.cond || 'False'}):`, `    raise SystemExit(0)`];
        default: {
            const ep = _apiBodyFor(a);
            if (ep) {
                if (ep.method === 'GET')
                    return [`_bmm = requests.get(f"{BASE}${ep.path}"); _bmm_ok = _bmm.ok; print(_bmm.text)`];
                if (ep.method === 'DELETE')
                    return [apiDelete(ep.path, ep.body)];
                if (ep.method === 'PUT')
                    return [apiPut(ep.path, ep.body)];
                return [apiPost(ep.path, ep.body)];
            }
            return [`# Unknown action: ${a.action_type}`];
        }
    }
}
function _luaAction(a, token, useDeeplink, base) {
    // TOKEN and BASE are always declared as locals at the top of the Lua script
    const curlPost = (ep, body) => `os.execute(('curl -s -X POST %s%s -H "Content-Type: application/json" -H "Authorization: Bearer %s" -d %q'):format(BASE, ${JSON.stringify(ep)}, TOKEN, ${JSON.stringify(body)}))`;
    const curlDelete = (ep, body) => body
        ? `os.execute(('curl -s -X DELETE %s%s -H "Content-Type: application/json" -H "Authorization: Bearer %s" -d %q'):format(BASE, ${JSON.stringify(ep)}, TOKEN, ${JSON.stringify(body)}))`
        : `os.execute(('curl -s -X DELETE %s%s -H "Authorization: Bearer %s"'):format(BASE, ${JSON.stringify(ep)}, TOKEN))`;
    const curlPut = (ep, body) => `os.execute(('curl -s -X PUT %s%s -H "Content-Type: application/json" -H "Authorization: Bearer %s" -d %q'):format(BASE, ${JSON.stringify(ep)}, TOKEN, ${JSON.stringify(body)}))`;
    const curlGet = (ep) => `os.execute(('curl -s %s%s'):format(BASE, ${JSON.stringify(ep)}))`;
    switch (a.action_type) {
        case 'enable_mod':
            return [useDeeplink
                    ? `os.execute('start bmm://mod/enable?id=${a.target_id}')`
                    : curlPost('/api/mods/enable', `{"mod_id":"${a.target_id}"}`)];
        case 'disable_mod':
            return [useDeeplink
                    ? `os.execute('start bmm://mod/disable?id=${a.target_id}')`
                    : curlPost('/api/mods/disable', `{"mod_id":"${a.target_id}"}`)];
        case 'activate_profile':
            return [useDeeplink
                    ? `os.execute('start bmm://profile/activate?id=${a.target_id}')`
                    : curlPost('/api/profiles/activate', `{"profile_id":"${a.target_id}"}`)];
        case 'apply_plugin':
            return [curlPost('/api/plugins/apply', `{"plugin_id":"${a.target_id}","force_strict":false}`)];
        case 'compare_plugin':
            return [curlPost('/api/plugins/compare', `{"plugin_id":"${a.target_id}"}`)];
        case 'enable_modpack':
            return [useDeeplink
                    ? `os.execute('start bmm://modpack/enable?id=${a.target_id}')`
                    : curlPost('/api/modpacks/enable', `{"profile_id":"${a.target_id}"}`)];
        case 'disable_modpack':
            return [useDeeplink
                    ? `os.execute('start bmm://modpack/disable?id=${a.target_id}')`
                    : curlPost('/api/modpacks/disable', `{"profile_id":"${a.target_id}"}`)];
        case 'update_modpack': {
            const ep = _apiBodyFor(a);
            return [curlPut(ep.path, JSON.stringify(ep.body))];
        }
        case 'sync_repo':
        case 'gen_repo':
        case 'http_host': {
            const ep = _apiBodyFor(a);
            return [curlPost(ep.path, JSON.stringify(ep.body))];
        }
        case 'cancel_sync':
            return [curlDelete('/api/repo/sync/cancel')];
        case 'cancel_gen':
            return [curlDelete('/api/repo/gen/cancel')];
        case 'stop_http_host':
            return [curlDelete('/api/repo/host')];
        case 'wait': {
            const secs = Math.round((a.extra.duration_ms || 1000) / 1000);
            return [`os.execute("ping -n ${secs + 1} 127.0.0.1 > nul")  -- wait ~${secs}s`];
        }
        case 'show_message':
            return [`os.execute('msg * ${(a.extra.message || '').replace(/'/g, '')}')  -- Windows only`];
        case 'open_url':
            return [`os.execute('start ${(a.extra.url || '').replace(/'/g, '')}')  -- Windows only`];
        case 'launch_game':
            return [`os.execute('start "" "${(a.extra.exe_path || '').replace(/"/g, '')}"')`];
        case 'log':
            return [`print(${JSON.stringify(a.extra.message || '')})`];
        case 'comment':
            return [`-- ${a.extra.text || ''}`];
        case 'set_variable': {
            const expr = a.extra.expr || 'name=value';
            const [n, ...rest] = expr.split('=');
            return [`local ${n.trim()} = ${JSON.stringify(rest.join('=').trim())}`];
        }
        case 'if_file_exists':
            return [`local f = io.open(${JSON.stringify(a.extra.path || '')}, "r")`, `if f then f:close()`];
        case 'if_file_not_exists':
            return [`local f = io.open(${JSON.stringify(a.extra.path || '')}, "r")`, `if f == nil then`];
        case 'if_var_eq': {
            const [vn, ...vr] = (a.extra.cond || 'name=value').split('=');
            return [`if ${vn.trim()} == ${JSON.stringify(vr.join('=').trim())} then`];
        }
        case 'if_var_neq': {
            const [vn, ...vr] = (a.extra.cond || 'name=value').split('=');
            return [`if ${vn.trim()} ~= ${JSON.stringify(vr.join('=').trim())} then`];
        }
        case 'if_api_ok':
            return ['if true then -- (last-API-result branching is tracked in bat/ps1/vbs/py exports)'];
        case 'if_api_err':
            return ['if false then -- (last-API-result branching is tracked in bat/ps1/vbs/py exports)'];
        case 'pause_key':
            return [`io.write("Press Enter to continue...")`, `io.read()`];
        case 'stop_script':
            return [`os.exit(0)`];
        case 'else_block':
            return ['else'];
        case 'end_block':
            return ['end'];
        case 'raw_code':
            return [a.extra.code || ''];
        case 'loop_start':
            return [`for _i = 1, ${Math.max(1, parseInt(a.extra.count, 10) || 1)} do`];
        case 'loop_end':
            return ['end'];
        case 'verify_file': {
            const p = a.extra.path || '';
            const vn = a.extra.var_name || 'FILE_HASH';
            return [`-- verify_file: SHA-256 of ${p} → ${vn} (needs a Lua crypto lib, e.g. luaossl)`,
                `local _f = io.open(${JSON.stringify(p)}, "rb"); local ${vn} = _f and require("openssl.digest").new("sha256"):final(_f:read("*a")) or ""`];
        }
        case 'wait_until': {
            const p = a.extra.path || '';
            const to = parseInt(a.extra.timeout, 10) || 120;
            const pl = parseInt(a.extra.poll, 10) || 2;
            return [`local _dl = os.time() + ${to}`,
                `while os.time() < _dl do local _h = io.open(${JSON.stringify(p)}); if _h then _h:close(); break end; os.execute("ping -n ${pl + 1} 127.0.0.1 > nul") end`];
        }
        case 'math_set':
            return [`local ${a.extra.var_name || 'RESULT'} = (${a.extra.expr || '0'})`];
        case 'ternary':
            return [`local ${a.extra.var_name || 'RESULT'} = (${a.extra.cond || 'true'}) and (${a.extra.val_true || '1'}) or (${a.extra.val_false || '0'})`];
        case 'guard_stop':
            return [`if (${a.extra.cond || 'false'}) then os.exit(0) end`];
        default: {
            const ep = _apiBodyFor(a);
            if (ep) {
                if (ep.method === 'GET')
                    return [curlGet(ep.path)];
                if (ep.method === 'DELETE')
                    return [curlDelete(ep.path, Object.keys(ep.body).length ? JSON.stringify(ep.body) : undefined)];
                if (ep.method === 'PUT')
                    return [curlPut(ep.path, JSON.stringify(ep.body))];
                return [curlPost(ep.path, JSON.stringify(ep.body))];
            }
            return [`-- Unknown action: ${a.action_type}`];
        }
    }
}
function _jsAction(a, token, useDeeplink, base) {
    // bmmPost is the helper declared in the JS generator header
    const apiCall = (ep, body) => `await bmmPost('${ep}', ${JSON.stringify(body)});`;
    const apiDelete = (ep, body) => body && Object.keys(body).length
        ? `await fetch(BASE + '${ep}', { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(${JSON.stringify(body)}) });`
        : `await fetch(BASE + '${ep}', { method: 'DELETE', headers: { Authorization: 'Bearer ' + TOKEN } });`;
    const apiPut = (ep, body) => `await fetch(BASE + '${ep}', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(${JSON.stringify(body)}) });`;
    const apiGet = (ep) => `console.log(await (await fetch(BASE + '${ep}')).text());`;
    const deeplink = (scheme, id) => `execSync('start bmm://${scheme}/${id}');`;
    switch (a.action_type) {
        case 'enable_mod':
            return [useDeeplink ? deeplink('enable', a.target_id) : apiCall('/api/mods/enable', { mod_id: a.target_id })];
        case 'disable_mod':
            return [useDeeplink ? deeplink('disable', a.target_id) : apiCall('/api/mods/disable', { mod_id: a.target_id })];
        case 'activate_profile':
            return [useDeeplink ? deeplink('profile', a.target_id) : apiCall('/api/profiles/activate', { profile_id: a.target_id })];
        case 'apply_plugin':
            return [apiCall('/api/plugins/apply', { plugin_id: a.target_id, force_strict: false })];
        case 'compare_plugin':
            return [apiCall('/api/plugins/compare', { plugin_id: a.target_id })];
        case 'enable_modpack':
            return [useDeeplink ? deeplink('modpack/enable', a.target_id) : apiCall('/api/modpacks/enable', { profile_id: a.target_id })];
        case 'disable_modpack':
            return [useDeeplink ? deeplink('modpack/disable', a.target_id) : apiCall('/api/modpacks/disable', { profile_id: a.target_id })];
        case 'update_modpack': {
            const ep = _apiBodyFor(a);
            return [apiPut(ep.path, ep.body)];
        }
        case 'sync_repo':
        case 'gen_repo':
        case 'http_host': {
            const ep = _apiBodyFor(a);
            return [apiCall(ep.path, ep.body)];
        }
        case 'cancel_sync':
            return [apiDelete('/api/repo/sync/cancel')];
        case 'cancel_gen':
            return [apiDelete('/api/repo/gen/cancel')];
        case 'stop_http_host':
            return [apiDelete('/api/repo/host')];
        case 'wait':
            return [`await new Promise(r => setTimeout(r, ${a.extra.duration_ms || 1000}));`];
        case 'show_message':
            return [`// Node.js: no native GUI dialog`, `console.log('[MSG]', ${JSON.stringify(a.extra.message || '')});`];
        case 'open_url':
            return [`execSync('start ${(a.extra.url || '').replace(/'/g, '')}');`];
        case 'launch_game':
            return [`spawn(${JSON.stringify(a.extra.exe_path || '')}, [], { detached: true, stdio: 'ignore' }).unref();`];
        case 'log':
            return [`console.log(${JSON.stringify(a.extra.message || '')});`];
        case 'comment':
            return [`// ${a.extra.text || ''}`];
        case 'set_variable': {
            const expr = a.extra.expr || 'name=value';
            const [n, ...rest] = expr.split('=');
            return [`let ${n.trim()} = ${JSON.stringify(rest.join('=').trim())};`];
        }
        case 'if_file_exists':
            // existsSync imported at top by the JS generator header
            return [`if (existsSync(${JSON.stringify(a.extra.path || '')})) {`];
        case 'if_file_not_exists':
            return [`if (!existsSync(${JSON.stringify(a.extra.path || '')})) {`];
        case 'if_var_eq': {
            const [vn, ...vr] = (a.extra.cond || 'name=value').split('=');
            return [`if (${vn.trim()} === ${JSON.stringify(vr.join('=').trim())}) {`];
        }
        case 'if_var_neq': {
            const [vn, ...vr] = (a.extra.cond || 'name=value').split('=');
            return [`if (${vn.trim()} !== ${JSON.stringify(vr.join('=').trim())}) {`];
        }
        case 'if_api_ok':
            return ['if (true) { // (last-API-result branching is tracked in bat/ps1/vbs/py exports)'];
        case 'if_api_err':
            return ['if (false) { // (last-API-result branching is tracked in bat/ps1/vbs/py exports)'];
        case 'pause_key':
            return [`try { execSync('pause', { shell: 'cmd.exe', stdio: 'inherit' }); } catch (e) {}`];
        case 'stop_script':
            return [`process.exit(0);`];
        case 'else_block':
            return ['} else {'];
        case 'end_block':
            return ['}'];
        case 'raw_code':
            return [a.extra.code || ''];
        case 'loop_start':
            return [`for (let _i = 0; _i < ${Math.max(1, parseInt(a.extra.count, 10) || 1)}; _i++) {`];
        case 'loop_end':
            return ['}'];
        case 'verify_file': {
            const p = a.extra.path || '';
            const vn = a.extra.var_name || 'FILE_HASH';
            return [`const ${vn} = require("crypto").createHash("sha256").update(require("fs").readFileSync(${JSON.stringify(p)})).digest("hex");`];
        }
        case 'wait_until': {
            const p = a.extra.path || '';
            const to = parseInt(a.extra.timeout, 10) || 120;
            const pl = parseInt(a.extra.poll, 10) || 2;
            return [`{ const _fs = require("fs"), _cp = require("child_process"); const _dl = Date.now() + ${to} * 1000; while (!_fs.existsSync(${JSON.stringify(p)}) && Date.now() < _dl) { _cp.execSync(process.platform === "win32" ? "timeout /t ${pl} /nobreak >nul" : "sleep ${pl}"); } }`];
        }
        case 'math_set':
            return [`let ${a.extra.var_name || 'RESULT'} = (${a.extra.expr || '0'});`];
        case 'ternary':
            return [`let ${a.extra.var_name || 'RESULT'} = (${a.extra.cond || 'true'}) ? (${a.extra.val_true || '1'}) : (${a.extra.val_false || '0'});`];
        case 'guard_stop':
            return [`if (${a.extra.cond || 'false'}) process.exit(0);`];
        default: {
            const ep = _apiBodyFor(a);
            if (ep) {
                if (ep.method === 'GET')
                    return [apiGet(ep.path)];
                if (ep.method === 'DELETE')
                    return [apiDelete(ep.path, ep.body)];
                if (ep.method === 'PUT')
                    return [apiPut(ep.path, ep.body)];
                return [apiCall(ep.path, ep.body)];
            }
            return [`// Unknown action: ${a.action_type}`];
        }
    }
}
// ── Tab: Permissions ───────────────────────────────────────────────────────
async function renderPerms(container) {
    // Canonical scopes — these EXACTLY match the backend `require_permission(...)`
    // checks in src-tauri/src/api/mod.rs. Granting one here actually unlocks the
    const PERM_GROUPS = permDomains();
    const ALL_PERMS = PERM_GROUPS.flatMap(g => g.scopes);
    const deepLinkAllowed = localStorage.getItem('bmm_deeplink_allow_global') !== 'blocked';
    const apiNoAuthAllow = localStorage.getItem('bmm_api_public_allow') !== 'blocked';
    const unsafeAllowed = localStorage.getItem('bmm_unsafe_plugins_allow') === 'allowed';
    // CORS origins (persisted backend-side; require an API restart to take effect).
    const _settings = await invoke('get_settings').catch(() => ({}));
    let corsOrigins = Array.isArray(_settings.api_cors_origins) ? _settings.api_cors_origins.slice() : [];
    const corsAllowAny = corsOrigins.includes('*');
    container.innerHTML = `
        <p class="plug-perms-desc">${IC.shield} ${t('plugins.permsDesc')}</p>

        <!-- ── Global API permissions ─────────────────────────── -->
        <div class="plug-section-card" style="margin-bottom:14px;">
            <h3 class="plug-section-title" style="margin-bottom:10px;">${IC.globe} ${t('plugins.globalApiPermTitle') || 'Permissions globales (API & Deep Links)'}</h3>
            <p style="font-size:11px;color:var(--text-muted);margin:0 0 12px;line-height:1.5;">${t('plugins.globalApiPermDesc') || 'Ces paramètres s\'appliquent à tous les appelants externes : plugins, scripts .bat, PowerShell, applications tierces, etc.'}</p>

            <!-- "Global plugin trust — skip all permission dialogs for every plugin" used to
                 live here, with a red warning under it. It did nothing: the dialog it claimed
                 to skip had no callers, so the switch wrote a key nothing read. A security
                 control that describes a posture the app does not have is worse than no
                 control — somebody who left it OFF to be careful gained exactly nothing, and
                 believed otherwise. Replaced by a line that is true. -->
            <div class="plug-perm-global-card" style="margin-bottom:8px;">
                <div class="plug-perm-global-inner">
                    <div class="plug-perm-global-icon">${IC.shield}</div>
                    <div class="plug-perm-global-text">
                        <strong>${t('plugins.globalPermTitle')}</strong>
                        <span class="plug-perm-global-sub">${t('plugins.globalPermDesc')}</span>
                    </div>
                </div>
                <p class="plug-perm-global-warn">${IC.alert} ${t('plugins.globalPermWarn')}</p>
            </div>

            <div class="plug-perm-global-card" style="margin-bottom:8px;">
                <div class="plug-perm-global-inner">
                    <div class="plug-perm-global-icon" style="color:color-mix(in srgb, var(--bmm-purple) 70%, var(--bmm-text-primary));">${IC.zap}</div>
                    <div class="plug-perm-global-text">
                        <strong>${t('plugins.deepLinkPermTitle') || 'Autoriser les Deep Links bmm://'}</strong>
                        <span class="plug-perm-global-sub">${t('plugins.deepLinkPermDesc') || 'Permet aux scripts et applications externes de déclencher des actions via bmm:// sans confirmation.'}</span>
                    </div>
                    <label class="plug-toggle" style="margin-left:auto;">
                        <input type="checkbox" id="plug-deeplink-allow" ${deepLinkAllowed ? 'checked' : ''}>
                        <span class="plug-toggle-slider"></span>
                    </label>
                </div>
            </div>

            <div class="plug-perm-global-card" style="border-color:rgba(239,68,68,0.25);">
                <div class="plug-perm-global-inner">
                    <div class="plug-perm-global-icon" style="color:var(--danger);">${IC.alert}</div>
                    <div class="plug-perm-global-text">
                        <strong>${t('plugins.unsafePluginsTitle') || 'Allow unsafe plugins (scripts)'}</strong>
                        <span class="plug-perm-global-sub">${t('plugins.unsafePluginsDesc') || 'Required to run external scripts (.bat, .ps1, …) bundled in a plugin. Each run still asks for confirmation.'}</span>
                    </div>
                    <label class="plug-toggle" style="margin-left:auto;">
                        <input type="checkbox" id="plug-unsafe-allow" ${unsafeAllowed ? 'checked' : ''}>
                        <span class="plug-toggle-slider"></span>
                    </label>
                </div>
                <p class="plug-perm-global-warn">${IC.alert} ${t('plugins.unsafePluginsWarn') || 'Scripts execute real programs on your PC. Only enable this for plugins you fully trust.'}</p>
            </div>
        </div>

        <!-- ── CORS (cross-origin API access) ──────────────────── -->
        <div class="plug-section-card" style="margin-bottom:14px;">
            <h3 class="plug-section-title" style="margin-bottom:10px;">${IC.globe} ${t('plugins.corsTitle') || 'CORS — cross-origin API access'}</h3>
            <p style="font-size:11px;color:var(--text-muted);margin:0 0 12px;line-height:1.5;">${t('plugins.corsDesc') || 'Allow web pages hosted on other origins to call your local BMM API from the browser. Leave empty to keep the secure default (only BMM itself). Changes require an API restart.'}</p>

            <div class="plug-perm-global-card" style="margin-bottom:10px;${corsAllowAny ? 'border-color:rgba(239,68,68,0.35);' : ''}">
                <div class="plug-perm-global-inner">
                    <div class="plug-perm-global-icon" style="color:${corsAllowAny ? 'var(--danger)' : 'var(--text-muted)'};">${IC.alert}</div>
                    <div class="plug-perm-global-text">
                        <strong>${t('plugins.corsAnyTitle') || 'Allow any origin (*)'}</strong>
                        <span class="plug-perm-global-sub">${t('plugins.corsAnyDesc') || 'Any website can read your API responses. Convenient for development, risky in general — prefer listing specific origins below.'}</span>
                    </div>
                    <label class="plug-toggle" style="margin-left:auto;">
                        <input type="checkbox" id="plug-cors-any" ${corsAllowAny ? 'checked' : ''}>
                        <span class="plug-toggle-slider"></span>
                    </label>
                </div>
                <!-- Shown only while it is ON, and it says what is ACTUALLY exposed.
                     The description above used to claim any website could read your API
                     responses — which is false for the seventy routes behind the token, and
                     a warning that overstates is a warning people learn to ignore. Two
                     routes answer without one, and what they return is worth naming. -->
                ${corsAllowAny ? `<p class="plug-perm-global-warn">${IC.alert} ${escHtml(t('plugins.corsAnyWarn'))}</p>` : ''}
            </div>

            <div id="plug-cors-specific" class="plug-cors-allowlist" data-superseded="${corsAllowAny ? '1' : '0'}">
                <p class="plug-cors-allowlist-title">${IC.globe} ${escHtml(t('plugins.corsAllowlistTitle'))}</p>
                ${corsAllowAny ? `<p class="plug-cors-superseded">${IC.alert} ${escHtml(t('plugins.corsSuperseded'))}</p>` : ''}
                <div class="plug-sources-add">
                    <input type="text" id="plug-cors-input" class="input" placeholder="https://my-dashboard.example.com">
                    <button class="btn btn-sm btn-accent" id="plug-cors-add">${IC.plus} ${t('common.add') || 'Add'}</button>
                </div>
                <div id="plug-cors-list" class="plug-sources-list"></div>
            </div>
            <p class="plug-perm-global-warn" style="margin-top:10px;">${IC.alert} ${t('plugins.corsRestartWarn') || 'Restart BMM (or the API) for CORS changes to take effect.'}</p>
        </div>

        <!-- ── Per-plugin permissions ──────────────────────────── -->
        <h3 class="plug-section-title" style="margin-bottom:8px;">${IC.puzzle} ${t('plugins.perPluginPermTitle') || 'Permissions par plugin'}</h3>
        <div id="plug-perms-list"></div>`;
    // ── CORS handlers ─────────────────────────────────────────────────────────
    const saveCors = async () => {
        try {
            const s = await invoke('get_settings');
            s.api_cors_origins = corsOrigins;
            await invoke('update_settings', { settings: s });
        }
        catch (e) {
            toast(`${t('common.error') || 'Error'}: ${e}`, 'error');
        }
    };
    const renderCorsList = () => {
        const list = container.querySelector('#plug-cors-list');
        if (!list)
            return;
        const specific = corsOrigins.filter(o => o !== '*');
        list.innerHTML = specific.length
            ? specific.map(o => `
                <div class="plug-source-row">
                    <span class="plug-source-icon">${IC.globe}</span>
                    <span class="plug-source-url" data-tooltip="${escAttr(o)}">${escHtml(o)}</span>
                    <button class="btn btn-xs btn-ghost plug-cors-del" data-o="${escAttr(o)}">${IC.trash}</button>
                </div>`).join('')
            : `<p class="plug-sources-empty">${t('plugins.corsNone') || 'No extra origins — API is reachable only from BMM itself.'}</p>`;
        list.querySelectorAll('.plug-cors-del').forEach(btn => {
            btn.addEventListener('click', async () => {
                const o = btn.dataset.o;
                corsOrigins = corsOrigins.filter(x => x !== o);
                await saveCors();
                renderCorsList();
            });
        });
    };
    renderCorsList();
    const addCorsOrigin = async (raw) => {
        const o = raw.trim().replace(/\/+$/, '');
        if (!o)
            return;
        if (o !== '*' && !/^https?:\/\/[^\s/]+$/i.test(o)) {
            toast(t('plugins.corsInvalid') || 'Enter a valid origin, e.g. https://example.com', 'warning');
            return;
        }
        if (corsOrigins.includes(o)) {
            toast(t('plugins.sourceExists') || 'Already added', 'info');
            return;
        }
        corsOrigins.push(o);
        await saveCors();
        renderCorsList();
        const inp = container.querySelector('#plug-cors-input');
        if (inp)
            inp.value = '';
    };
    container.querySelector('#plug-cors-add')?.addEventListener('click', () => {
        addCorsOrigin(container.querySelector('#plug-cors-input').value);
    });
    container.querySelector('#plug-cors-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addCorsOrigin(e.target.value);
        }
    });
    container.querySelector('#plug-cors-any')?.addEventListener('change', async (e) => {
        const on = e.target.checked;
        corsOrigins = on
            ? Array.from(new Set([...corsOrigins, '*']))
            : corsOrigins.filter(o => o !== '*');
        await saveCors();
        // A data attribute, not an inline style: the CSS owns what "superseded" looks
        // like, and writing cssText here would also wipe anything else the element carries.
        const spec = container.querySelector('#plug-cors-specific');
        if (spec) {
            spec.dataset.superseded = on ? '1' : '0';
            // Say WHY it is inert. A control that fades with no explanation reads as broken.
            const existing = spec.querySelector('.plug-cors-superseded');
            if (on && !existing) {
                const p = document.createElement('p');
                p.className = 'plug-cors-superseded';
                p.textContent = t('plugins.corsSuperseded');
                spec.querySelector('.plug-cors-allowlist-title')?.after(p);
            }
            else if (!on && existing) {
                existing.remove();
            }
        }
    });
    container.querySelector('#plug-deeplink-allow')?.addEventListener('change', (e) => {
        if (e.target.checked) {
            localStorage.removeItem('bmm_deeplink_allow_global');
        }
        else {
            localStorage.setItem('bmm_deeplink_allow_global', 'blocked');
        }
    });
    container.querySelector('#plug-unsafe-allow')?.addEventListener('change', (e) => {
        const on = e.target.checked;
        if (on)
            localStorage.setItem('bmm_unsafe_plugins_allow', 'allowed');
        else
            localStorage.removeItem('bmm_unsafe_plugins_allow');
        toast(on
            ? (t('plugins.unsafePluginsEnabled') || 'Unsafe plugins enabled — scripts can run after confirmation.')
            : (t('plugins.unsafePluginsDisabled') || 'Unsafe plugins disabled.'), on ? 'warning' : 'info');
    });
    const list = document.getElementById('plug-perms-list');
    if (!_installedPlugins.length) {
        list.innerHTML = `<p style="color:var(--text-muted);font-size:13px;margin:16px 0;text-align:center;">${t('plugins.noPluginsForPerms')}</p>`;
        return;
    }
    // Fetch every plugin's permissions IN PARALLEL (was N sequential awaits,
    // which made the page janky), then render the whole list in one pass.
    const permsArr = await Promise.all(_installedPlugins.map(p => invoke('get_plugin_permissions', { pluginId: p.manifest.id }).catch(() => [])));
    list.innerHTML = _installedPlugins.map((plugin, i) => {
        const currentPerms = permsArr[i] || [];
        const id = plugin.manifest.id;
        return `
            <div class="plug-perm-block" data-pid="${escHtml(id)}">
                <div class="plug-perm-header">
                    <div class="plug-card-icon-default" style="width:28px;height:28px;font-size:14px;">${IC.puzzle}</div>
                    <strong>${escHtml(plugin.manifest.name)}</strong>
                    <span class="plug-perm-id">${escHtml(id)}</span>
                </div>
                <div class="plug-perm-domains">
                    ${PERM_GROUPS.map(g => `
                        <div class="plug-perm-domain">
                            <div class="plug-perm-domain-h" style="color:${g.color};">${escHtml(g.domain)}</div>
                            <div class="plug-perm-domain-row">
                                ${g.scopes.map(perm => `
                                    <label class="plug-perm-item" data-tooltip="${escHtml(t('plugins.scope.' + perm) || '')}">
                                        <input type="checkbox" class="plug-perm-check" data-perm="${perm}" style="accent-color:${g.color};"
                                            ${(currentPerms.includes(perm) || plugin.manifest.permissions?.includes(perm)) ? 'checked' : ''}>
                                        <code style="color:${g.color};font-size:11px;">${perm}</code>
                                        <span class="plug-perm-what">${escHtml(t('plugins.scope.' + perm) || '')}</span>
                                    </label>`).join('')}
                            </div>
                        </div>`).join('')}
                </div>
                <div style="display:flex;gap:6px;margin-top:8px;">
                    <button class="btn btn-xs btn-ghost plug-perm-all" data-id="${escHtml(id)}">${t('common.all') || 'All'}</button>
                    <button class="btn btn-xs btn-ghost plug-perm-none" data-id="${escHtml(id)}">${t('common.none') || 'None'}</button>
                    <span style="flex:1;"></span>
                    <button class="btn btn-sm btn-accent plug-save-perms" data-id="${escHtml(id)}">${IC.save} ${t('plugins.savePerms')}</button>
                </div>
            </div>`;
    }).join('');
    // Wire listeners once (single pass over the rendered blocks).
    list.querySelectorAll('.plug-perm-block').forEach(block => {
        const id = block.dataset.pid || '';
        block.querySelector('.plug-perm-all')?.addEventListener('click', () => block.querySelectorAll('.plug-perm-check').forEach(c => c.checked = true));
        block.querySelector('.plug-perm-none')?.addEventListener('click', () => block.querySelectorAll('.plug-perm-check').forEach(c => c.checked = false));
        block.querySelector('.plug-save-perms')?.addEventListener('click', async () => {
            const perms = Array.from(block.querySelectorAll('.plug-perm-check:checked')).map(c => c.dataset.perm);
            try {
                await invoke('set_plugin_permissions', { pluginId: id, permissions: perms });
                toast(t('plugins.permsSaved'), 'success');
            }
            catch (err) {
                toast(`${t('common.error')}: ${err}`, 'error');
            }
        });
    });
}
// ── Asking for what a plugin requested ─────────────────────────────────
/**
 * Show the permission request a freshly installed plugin makes.
 *
 * What was here before: `requestPermission`, a three-button "Allow once / Always / Deny"
 * dialog with markup, CSS and five translated strings — and **no callers**. Two settings fed
 * it, a per-plugin "always allow" tick and a global "skip all permission dialogs" switch with
 * a red warning under it, and both wrote keys that only that function read. A security
 * control describing a posture the app does not have is worse than none: somebody who left
 * the global switch OFF to be careful gained nothing and believed otherwise.
 *
 * The real gap it was standing in front of: a plugin declares `permissions` in its manifest,
 * installing grants exactly none of them (the Rust side logs "disabled, no permissions" and
 * means it), and the request was then shown to NOBODY. The only way to learn what a plugin
 * wanted was to grant something and see whether it stopped erroring.
 *
 * So this asks, once, at the moment it is the question. It grants nothing by itself — the
 * dialog opens with today's grants ticked, not the request — and a plugin that asks for
 * nothing is never interrupted.
 */
async function askForRequestedPerms(plugin) {
    const asked = Array.isArray(plugin?.manifest?.permissions) ? plugin.manifest.permissions : [];
    if (!asked.length)
        return;
    const { openPluginPermissions } = await import('./plugin-inspect.js');
    await openPluginPermissions(plugin.manifest.id, plugin.manifest.name, (m, k) => toast(m, k), { requested: asked, firstRun: true });
}
// ── Plugin Checksum Modal ─────────────────────────────────────────────────
function handlePluginChecksumModal(manifest, installDir, hash) {
    const date = new Date().toLocaleDateString();
    const ov = createOverlay(`
        <div class="plug-ov-header">
            <span class="plug-ov-title">${IC.hash} <strong>${escHtml(manifest.name)}</strong></span>
            <button class="btn btn-xs btn-ghost plug-ov-close-btn">${IC.x}</button>
        </div>
        <div class="plug-ov-body" style="padding:16px;">
            <p style="font-size:12px;color:var(--text-muted);margin:0 0 8px;">${t('plugins.checksumTitle')}</p>
            <div class="plug-code-pre" style="font-size:11px;word-break:break-all;user-select:all;cursor:text;padding:10px;border-radius:6px;background:rgba(0,0,0,0.3);">${escHtml(hash)}</div>
            <p style="font-size:11px;color:var(--text-muted);margin:8px 0 0;">${IC.info} ${escHtml(installDir)}</p>
            <p style="font-size:11px;color:var(--text-muted);margin:4px 0 0;">${date}</p>
        </div>
        <div class="plug-ov-footer">
            <button class="btn btn-sm btn-ghost" id="plug-sha-copy">${IC.copy} ${t('common.copy')}</button>
            <button class="btn btn-sm btn-ghost" id="plug-sha-recalc">${IC.refresh} ${t('plugins.checksumRecalc')}</button>
            <button class="btn btn-sm btn-danger" id="plug-sha-delete">${IC.trash} ${t('common.delete')}</button>
            <button class="btn btn-ghost plug-ov-close-btn">${t('common.close')}</button>
        </div>`);
    ov.querySelectorAll('.plug-ov-close-btn').forEach(b => b.addEventListener('click', () => ov.remove()));
    ov.querySelector('#plug-sha-copy')?.addEventListener('click', async () => {
        await navigator.clipboard.writeText(hash).catch(() => { });
        toast(t('common.copy'), 'success');
    });
    ov.querySelector('#plug-sha-recalc')?.addEventListener('click', async () => {
        try {
            const newHash = await invoke('compute_plugin_checksum', { pluginId: manifest.id });
            ov.remove();
            handlePluginChecksumModal(manifest, installDir, newHash);
            // Update badge
            const badge = document.querySelector(`.plug-btn-sha[data-id="${manifest.id}"]`);
            if (badge) {
                badge.innerHTML = `${IC.hash} ${newHash.substring(0, 8)}…`;
                badge.classList.remove('plug-sha-badge--pending');
                badge.dataset.full = newHash;
            }
            toast(t('toast.shaRecalculated') || 'SHA256 recalculated', 'success');
        }
        catch (e) {
            toast(`${t('common.error')}: ${e}`, 'error');
        }
    });
    ov.querySelector('#plug-sha-delete')?.addEventListener('click', async () => {
        ov.remove();
        // Uninstall the plugin (reuse handler)
        handleUninstall(manifest.id, manifest.name);
    });
}
// ── Action Handlers ────────────────────────────────────────────────────────
async function handleInstall(downloadUrl, name, local = false) {
    if (!downloadUrl) {
        toast(t('plugins.noDownloadUrl'), 'error');
        return;
    }
    try {
        toast(`${IC.download} ${t('plugins.installing')} ${name}...`, 'info');
        // From a bundle it is a file BMM extracted itself, so it is read rather than
        // fetched — handing a path to the downloader produces an error that names neither
        // the file nor the reason.
        const plugin = local
            ? await invoke('install_plugin_from_file', { filePath: downloadUrl })
            : await invoke('install_plugin', { downloadUrl });
        _installedPlugins = _installedPlugins.filter(p => p.manifest.id !== plugin.manifest.id);
        _installedPlugins.push(plugin);
        // Remember the catalog source so this plugin can be auto-updated later — but only
        // when it IS a source. A bundle entry resolves to a path in an extraction cache
        // that BMM is free to delete, so storing it would leave auto-update pointing at a
        // file that stops existing, and pointing at a stale copy until it does.
        if (!local) {
            try {
                localStorage.setItem('bmm_plugin_src_' + plugin.manifest.id, downloadUrl);
            }
            catch { /* ignore */ }
        }
        toast(t('plugins.installSuccess', { name }), 'success');
        dispatchBmmAction(BMM_ACTIONS.PLUGIN_INSTALLED, { name });
        renderTab(_tab);
        await askForRequestedPerms(plugin);
    }
    catch (e) {
        toast(`${t('plugins.installError')}: ${e}`, 'error');
    }
}
async function handleImportFile() {
    const path = await pickFile({ filters: [{ name: 'BMM Plugin', extensions: ['bmmplug', 'zip'] }] });
    if (!path)
        return;
    try {
        toast(t('plugins.importing'), 'info');
        const plugin = await invoke('install_plugin_from_file', { filePath: path });
        _installedPlugins = _installedPlugins.filter(p => p.manifest.id !== plugin.manifest.id);
        _installedPlugins.push(plugin);
        toast(t('plugins.importSuccess'), 'success');
        renderTab(_tab);
        await askForRequestedPerms(plugin);
    }
    catch (e) {
        toast(`${t('plugins.importError')}: ${e}`, 'error');
    }
}
async function handleUninstall(pluginId, name) {
    const ok = await window.confirmCustom(t('plugins.uninstallTitle'), t('plugins.uninstallDesc', { name }), 'danger', { yesLabel: t('common.delete'), noLabel: t('common.cancel') });
    if (!ok)
        return;
    try {
        await invoke('uninstall_plugin', { pluginId });
        _installedPlugins = _installedPlugins.filter(p => p.manifest.id !== pluginId);
        toast(t('plugins.uninstallSuccess', { name }), 'success');
        renderTab(_tab);
    }
    catch (e) {
        toast(`${t('common.error')}: ${e}`, 'error');
    }
}
async function handleCompare(pluginId) {
    try {
        const result = await invoke('compare_plugin_mods', { pluginId });
        const plugin = _installedPlugins.find(p => p.manifest.id === pluginId);
        // Compare mode: informational only — no Apply button
        const ov = createOverlay(buildCompareContent(result, plugin?.manifest?.name, 'compare'));
        ov.querySelectorAll('.plug-ov-close-btn').forEach(b => b.addEventListener('click', () => ov.remove()));
    }
    catch (e) {
        toast(`${t('common.error')}: ${e}`, 'error');
    }
}
async function handleApply(pluginId) {
    const plugin = _installedPlugins.find(p => p.manifest.id === pluginId);
    const pluginHasScripts = !!plugin?.manifest?.has_scripts || ((plugin?.manifest?.scripts?.length || 0) > 0);
    const applyMode = plugin?.manifest?.apply_mode || 'modlist';
    // "Run scripts only" mode: activating the plugin just runs its scripts.
    if (applyMode === 'script') {
        await maybeRunPluginScripts(pluginId);
        return;
    }
    // "Set up its automations": import what the plugin ships, and offer to run it now.
    if (applyMode === 'automation') {
        await installPluginAutomations(pluginId, true);
        return;
    }
    if (!plugin?.manifest?.modlist?.required_mods?.length) {
        // No mod list: fall back to scripts if the plugin has any.
        if (pluginHasScripts) {
            await maybeRunPluginScripts(pluginId);
            return;
        }
        toast(t('plugins.noModlist'), 'warning');
        return;
    }
    try {
        const result = await invoke('compare_plugin_mods', { pluginId });
        // Apply mode: shows same compare info but WITH the Apply Now button
        const ov = createOverlay(buildCompareContent(result, plugin?.manifest?.name, 'apply'));
        ov.querySelectorAll('.plug-ov-close-btn').forEach(b => b.addEventListener('click', () => ov.remove()));
        ov.querySelector('#plug-ov-apply')?.addEventListener('click', async () => {
            ov.remove();
            await doApply(pluginId, result);
        });
    }
    catch (e) {
        toast(`${t('common.error')}: ${e}`, 'error');
    }
}
async function doApply(pluginId, cmp) {
    try {
        // Use provided compare result or fetch fresh one
        const compareResult = cmp ?? await invoke('compare_plugin_mods', { pluginId });
        let enabledCount = 0;
        const notFound = [];
        // Enable mods that are found but not currently active
        for (const entry of (compareResult.required || [])) {
            if (entry.found && !entry.active && entry.mod_id) {
                try {
                    await invoke('enable_mod', { modId: entry.mod_id, bypassSha: true });
                    enabledCount++;
                }
                catch (_) {
                    notFound.push(entry.name);
                }
            }
            else if (!entry.found && !entry.optional) {
                notFound.push(entry.name);
            }
        }
        // Strict mode: disable mods not in the plugin list
        if (compareResult.strict) {
            for (const modName of (compareResult.strict_extra || [])) {
                const m = _allMods.find(m => m.name === modName);
                if (m) {
                    try {
                        await invoke('disable_mod', { modId: m.id });
                    }
                    catch (_) { }
                }
            }
        }
        toast(t('plugins.applySuccess', { enabled: enabledCount }), 'success');
        if (notFound.length)
            toast(t('plugins.modsNotFound', { mods: notFound.join(', ') }), 'warning');
        // Refresh mods list
        try {
            const { refreshMods } = await import('../../features/mods/mods.js');
            await refreshMods(true);
        }
        catch (_) { }
        // Run bundled scripts only when the plugin's apply mode is "both".
        const applyMode = _installedPlugins.find(p => p.manifest.id === pluginId)?.manifest?.apply_mode || 'modlist';
        if (applyMode === 'both')
            await maybeRunPluginScripts(pluginId);
        // Automations come along with the mod list too, but never start on their own here:
        // somebody applying a mod list asked for a mod list.
        if ((_installedPlugins.find(p => p.manifest.id === pluginId)?.manifest?.automations?.length || 0) > 0
            && applyMode !== 'automation') {
            await installPluginAutomations(pluginId, false);
        }
    }
    catch (e) {
        toast(`${t('common.error')}: ${e}`, 'error');
    }
}
// ── Unsafe plugin scripts ───────────────────────────────────────────────────
const UNSAFE_PLUGINS_KEY = 'bmm_unsafe_plugins_allow';
/**
 * How many permissions this plugin asks for, per domain and in total.
 *
 * Derived from the checkboxes rather than tracked alongside them: a second copy of "what is
 * ticked" is a second thing that can be wrong, and this one would be wrong in the direction
 * that matters — a form that says "asks for 2" while asking for nine.
 *
 * A domain with none ticked shows nothing at all. A zero beside every heading is seven
 * zeroes of noise on a form somebody has only just opened.
 */
export function refreshReqPermCounts() {
    const boxes = Array.from(document.querySelectorAll('.pc-perm-cb'));
    if (!boxes.length)
        return;
    const per = new Map();
    for (const cb of boxes) {
        if (!cb.checked)
            continue;
        const dom = cb.dataset.dom || '';
        per.set(dom, (per.get(dom) || 0) + 1);
    }
    document.querySelectorAll('[data-dom-n]').forEach((el) => {
        const n = per.get(el.dataset.domN || '') || 0;
        el.textContent = n ? String(n) : '';
    });
    const total = boxes.filter((b) => b.checked).length;
    const out = document.getElementById('pc-perm-count');
    if (out) {
        out.textContent = total
            ? (t('plugins.createPermsN') || '{n} of {all} requested')
                .replace('{n}', String(total)).replace('{all}', String(boxes.length))
            : (t('plugins.createPermsNone0') || 'Asks for nothing \u2014 the safest plugin there is');
        out.classList.toggle('is-none', total === 0);
    }
    const clear = document.getElementById('pc-perm-none');
    if (clear)
        clear.hidden = total === 0;
}
/** Wired once for the whole block, so a scope added later needs no second edit here. */
function wireReqPerms() {
    const host = document.getElementById('pc-perms');
    if (!host || host.dataset.wired)
        return;
    host.dataset.wired = '1';
    host.addEventListener('change', (e) => {
        if (e.target?.classList?.contains('pc-perm-cb'))
            refreshReqPermCounts();
    });
    document.getElementById('pc-perm-none')?.addEventListener('click', () => {
        host.querySelectorAll('.pc-perm-cb').forEach((cb) => { cb.checked = false; });
        refreshReqPermCounts();
    });
    refreshReqPermCounts();
}
export function unsafePluginsAllowed() {
    return localStorage.getItem(UNSAFE_PLUGINS_KEY) === 'allowed';
}
/** If the plugin ships external scripts, confirm + run them — but only when the
 *  "unsafe plugins" permission is granted. */
async function maybeRunPluginScripts(pluginId) {
    const plugin = _installedPlugins.find(p => p.manifest.id === pluginId);
    const allScripts = plugin?.manifest?.scripts || [];
    const hasScripts = !!plugin?.manifest?.has_scripts || allScripts.length > 0;
    if (!hasScripts)
        return;
    // Only .bat / .ps1 / .vbs are launchable (imported files can be anything,
    // but only these execute).
    const RUNNABLE = /\.(bat|cmd|ps1|vbs)$/i;
    const runnable = allScripts.filter(s => RUNNABLE.test(s));
    if (!runnable.length) {
        toast(t('plugins.noRunnableScripts') || 'This plugin has no runnable script (.bat / .ps1 / .vbs).', 'warning');
        return;
    }
    if (!unsafePluginsAllowed()) {
        toast(t('plugins.unsafeBlocked') || 'This plugin contains scripts. Enable "Allow unsafe plugins" in Plugins → Permissions to run them.', 'warning');
        return;
    }
    const runOne = async (script) => {
        try {
            const launched = await invoke('run_plugin_scripts', { pluginId, script });
            toast((t('plugins.scriptsRan') || 'Ran {n} script(s).').replace('{n}', String(launched?.length ?? 0)), 'success');
        }
        catch (e) {
            toast(`${t('common.error')}: ${e}`, 'error');
        }
    };
    // Let the user pick which script to launch.
    const rows = runnable.map(s => `<button class="plug-script-run-row" data-script="${escHtml(s)}">${IC.play}<code>${escHtml(s)}</code></button>`).join('');
    const ov = createOverlay(`
        <div class="plug-ov-header">
            <span class="plug-ov-title">${IC.terminal} ${t('plugins.chooseScriptTitle') || 'Choose a script to run'}</span>
            <button class="btn btn-xs btn-ghost plug-ov-close-btn">${IC.x}</button>
        </div>
        <div class="plug-ov-body" style="padding:16px 18px;display:flex;flex-direction:column;gap:10px;">
            <p style="font-size:12.5px;color:var(--text-secondary);margin:0;line-height:1.5;">${(t('plugins.chooseScriptDesc') || '"{name}" — pick a script to launch. It runs a real program on your PC.').replace('{name}', escHtml(plugin.manifest.name))}</p>
            <div class="plug-script-run-list">${rows}</div>
            <p style="font-size:10.5px;color:var(--warning);display:flex;gap:6px;align-items:flex-start;margin:2px 0 0;line-height:1.4;">${IC.lock}<span>${t('plugins.unsafeScriptWarn') || 'Scripts run real programs on your PC.'}</span></p>
        </div>`);
    ov.querySelectorAll('.plug-ov-close-btn').forEach(b => b.addEventListener('click', () => ov.remove()));
    ov.querySelectorAll('.plug-script-run-row').forEach(b => b.addEventListener('click', async () => {
        const s = b.dataset.script;
        ov.remove();
        await runOne(s);
    }));
}
async function handleExport(pluginId, name) {
    const path = await saveFile({ defaultPath: `${pluginId}.bmmplug`, filters: [{ name: 'BMM Plugin', extensions: ['bmmplug'] }] });
    if (!path)
        return;
    try {
        await invoke('export_plugin', { pluginId, destPath: path });
        toast(t('plugins.exportSuccess', { name }), 'success');
    }
    catch (e) {
        toast(`${t('common.error')}: ${e}`, 'error');
    }
}
function handleInspect(plugin) {
    const manifest = plugin.manifest ?? plugin;
    const json = JSON.stringify(manifest, null, 2);
    const ov = createOverlay(`
        <div class="plug-ov-header">
            <span class="plug-ov-title">${IC.eye} <strong>${escHtml(manifest.name)}</strong></span>
            <button class="btn btn-xs btn-ghost plug-ov-close-btn">${IC.x}</button>
        </div>
        <div class="plug-ov-body" style="padding:14px 16px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <span style="font-size:11px;color:var(--text-muted);">plugin.json</span>
                <button class="btn btn-xs btn-ghost" id="plug-inspect-copy">${IC.copy} ${t('common.copy')}</button>
            </div>
            <pre class="plug-code-pre" style="max-height:55vh;overflow:auto;font-size:11px;">${hlJson(json)}</pre>
        </div>
        <div class="plug-ov-footer">
            <button class="btn btn-ghost plug-ov-close-btn">${t('common.close')}</button>
        </div>`);
    ov.querySelector('#plug-inspect-copy')?.addEventListener('click', async () => {
        await navigator.clipboard.writeText(json).catch(() => { });
        toast(t('common.copy'), 'success');
    });
    ov.querySelectorAll('.plug-ov-close-btn').forEach(b => b.addEventListener('click', () => ov.remove()));
}
function handleEditPlugin(manifest) {
    // Navigate to Create tab with pre-filled data
    const tab = document.querySelector('.plug-tab[data-tab="create"]');
    if (tab)
        tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // Pre-fill after render
    setTimeout(() => prefillCreateTab(manifest), 60);
}
function handleDuplicatePlugin(manifest) {
    const copy = JSON.parse(JSON.stringify(manifest));
    copy.id = `${copy.id}-copy`;
    copy.name = `${copy.name} (Copy)`;
    const tab = document.querySelector('.plug-tab[data-tab="create"]');
    if (tab)
        tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    setTimeout(() => prefillCreateTab(copy), 60);
}
function prefillCreateTab(manifest) {
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el)
            el.value = val ?? '';
    };
    setVal('pc-id', manifest.id || '');
    setVal('pc-name', manifest.name || '');
    setVal('pc-version', manifest.version || '1.0.0');
    setVal('pc-game', manifest.game || '');
    setVal('pc-desc', manifest.description || '');
    const strictCb = document.getElementById('pc-strict');
    if (strictCb) {
        strictCb.checked = !!(manifest.modlist?.strict);
        strictCb.dispatchEvent(new Event('change'));
    }
    // Restore apply mode (modlist / scripts / both)
    const applyModeSel = document.getElementById('pc-apply-mode');
    if (applyModeSel)
        applyModeSel.value = manifest.apply_mode || 'modlist';
    // The four fields the form gained. Without this, opening a plugin to change one line
    // would silently blank its author, site, tags and requested permissions on save — which
    // is the same class of loss as an annotation dropped by a round trip.
    setVal('pc-author', manifest.author || '');
    setVal('pc-website', manifest.website || '');
    setVal('pc-tags', Array.isArray(manifest.tags) ? manifest.tags.join(', ') : '');
    const asked = Array.isArray(manifest.permissions) ? manifest.permissions : [];
    document.querySelectorAll('.pc-perm-cb').forEach((cb) => {
        cb.checked = asked.includes(cb.dataset.perm || '');
    });
    // The tallies are derived from the boxes, so they have to be recomputed after anything
    // sets the boxes from outside — which loading a plugin for editing is.
    refreshReqPermCounts();
    // Show the scripts/folders already linked to this plugin as chips, so editing keeps
    // full context. There is no toggle to restore any more — the lists ARE the answer.
    const existingScripts = manifest.scripts || [];
    const existingFolders = manifest.folders || [];
    // Carry them through to save so editing doesn't wipe bundled files.
    _editScripts = existingScripts.slice();
    _editFolders = existingFolders.slice();
    _editAutomations = (manifest.automations || []).slice();
    _editBundles = (manifest.bundles || []).slice();
    // Render the bundled scripts/folders as removable chips (staged removal + undo)
    // via the create tab's own list renderers, now that _editScripts/_editFolders are set.
    _renderPcScripts?.();
    _renderPcFolders?.();
    _renderPcAutomations?.();
    _renderPcBundles?.();
    // Pre-select mods (resolved against the full all-profiles mod list). Prefer the
    // stored id (survives a rename), fall back to a case-insensitive name match.
    const mods = manifest.modlist?.required_mods || [];
    for (const mod of mods) {
        const items = Array.from(document.querySelectorAll('.plug-mod-item'));
        const item = (mod.id && items.find(it => it.dataset.id === mod.id))
            || items.find(it => (it.dataset.name || '').toLowerCase() === (mod.name || '').toLowerCase());
        if (item) {
            const optCb = item.querySelector('.plug-mod-optional-cb');
            if (optCb)
                optCb.checked = mod.optional;
            item.querySelector('.plug-mod-add-btn')?.click();
        }
    }
}
async function handleResetToken() {
    const ok = await window.confirmCustom(t('plugins.resetTokenTitle'), t('plugins.resetTokenDesc'), 'danger', { yesLabel: t('plugins.reset'), noLabel: t('common.cancel') });
    if (!ok)
        return;
    try {
        _apiToken = await invoke('reset_api_token');
        const display = document.getElementById('plug-token-display');
        if (display)
            display.value = _apiToken;
        toast(t('plugins.tokenReset'), 'success');
    }
    catch (e) {
        toast(`${t('common.error')}: ${e}`, 'error');
    }
}
// ── Tab: Docs (redirect to Help & Other > Plugins & API) ──────────────────
function renderDocs(container) {
    container.innerHTML = `
        <div class="plug-docs-redirect">
            <div class="plug-docs-redirect-icon">${IC.info}</div>
            <h3 class="plug-docs-redirect-title">${t('plugins.docsMovedTitle')}</h3>
            <p class="plug-docs-redirect-desc">${t('plugins.docsMovedDesc')}</p>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
                <button class="btn btn-accent" id="plug-goto-helpdocs">
                    ${IC.info} ${t('plugins.docsMovedBtn')}
                </button>
                <button class="btn btn-sm btn-ghost" id="doc-guide-en">${IC.info} ${t('plugins.guideENBtn')}</button>
                <button class="btn btn-sm btn-ghost" id="doc-guide-fr">${IC.info} ${t('plugins.guideFRBtn')}</button>
                <button class="btn btn-sm btn-ghost" id="doc-catalog-guide">${IC.list} ${t('plugins.catalogGuideBtn')}</button>
                <button class="btn btn-sm btn-ghost" id="doc-modupdate-api">${IC.info} ${t('plugins.modUpdateApiGuideBtn') || 'Mod Update API'}</button>
                <button class="btn btn-sm btn-ghost" id="doc-modupdate-modding">${IC.info} ${t('plugins.modUpdateModdingGuideBtn') || 'Making your mod updatable'}</button>
            </div>
        </div>`;
    container.querySelector('#plug-goto-helpdocs')?.addEventListener('click', () => {
        // Navigate to Help & Other, then activate the plugins-api tab
        const navBtn = document.querySelector('.nav-item[data-view="docs"], .nav-btn[data-view="docs"]');
        if (navBtn) {
            navBtn.click();
            setTimeout(() => {
                const tabBtn = document.querySelector('.docs-tab-btn[data-tab="plugins-api"]');
                if (tabBtn)
                    tabBtn.click();
            }, 80);
        }
    });
    container.querySelector('#doc-guide-en')?.addEventListener('click', () => {
        invoke('open_file', { path: 'Update\\Guides\\Modding\\Mod_Identity_Guide_EN.md' }).catch(() => { });
    });
    container.querySelector('#doc-guide-fr')?.addEventListener('click', () => {
        invoke('open_file', { path: 'Update\\Guides\\Modding\\Mod_Identity_Guide_FR.md' }).catch(() => { });
    });
    container.querySelector('#doc-catalog-guide')?.addEventListener('click', () => {
        invoke('open_file', { path: 'Update\\Guides\\Catalogs-and-Repos\\Plugin_Catalog_Guide_EN.md' }).catch(() => { });
    });
    const _lng = (getLang && getLang() === 'fr') ? 'FR' : 'EN';
    container.querySelector('#doc-modupdate-api')?.addEventListener('click', () => {
        invoke('open_file', { path: `Update\\Guides\\Developer\\Mod_Update_API_Guide_${_lng}.md` }).catch(() => { });
    });
    container.querySelector('#doc-modupdate-modding')?.addEventListener('click', () => {
        invoke('open_file', { path: `Update\\Guides\\Modding\\Mod_Update_Guide_${_lng}.md` }).catch(() => { });
    });
}
// ── Public API ─────────────────────────────────────────────────────────────
export async function refreshPlugins() {
    _installedPlugins = await invoke('get_installed_plugins').catch(() => []);
    renderTab(_tab);
}
export async function handleApplyViaDeepLink(pluginId) {
    const plugins = await invoke('get_installed_plugins').catch(() => []);
    const plugin = plugins.find(p => p.manifest.id === pluginId);
    if (!plugin) {
        toast(t('plugins.deepLinkNotFound', { id: pluginId }), 'error');
        return;
    }
    _installedPlugins = plugins;
    await handleApply(pluginId);
}
/**
 * Follow the catalogues a plugin ships.
 *
 * The counterpart of `installPluginAutomations`, and it stops in the same place: a bundle is
 * ADDED as a source, never read into anything. A source is something BMM fetches from later,
 * so adding one without asking would be signing somebody up to a stranger's feed on their
 * behalf — which is a bigger act than applying a plugin, and a longer-lived one.
 *
 * The kind is read from the catalogue itself rather than from anything the plugin claims.
 * A manifest is a file somebody else wrote; `catalog.json` inside the bundle is the document
 * that will actually be parsed, and its shape is what every catalogue browser already
 * decides by. A plugin cannot get its own bundle filed under Themes by mislabelling it.
 */
async function installPluginBundles(pluginId) {
    let files;
    try {
        files = await invoke('plugin_bundles', { pluginId });
    }
    catch (e) {
        toast(`${t('common.error')}: ${e}`, 'error', 8000);
        return;
    }
    if (!files.length) {
        toast(t('plugins.bundle.none'), 'info', 6000);
        return;
    }
    // Read them ALL before asking anything. Half a dialog, then a second dialog because the
    // third file turned out to be unreadable, is worse than one question with the real list
    // in it — and the person answering deserves to see what they are agreeing to.
    const found = [];
    const failed = [];
    for (const f of files) {
        try {
            const res = await invoke('catalog_bundle_open', { path: f.path });
            const doc = JSON.parse(String(res?.catalog || ''));
            const kind = ['plugin', 'theme', 'preset', 'modpack', 'repo', 'app']
                .find((k) => catalogLooksLike(doc, k)) || '';
            // A bundle whose catalogue is of a kind with nowhere to put it is named, not
            // dropped. "Nothing happened" is the report that costs an evening.
            if (!kind || (kind !== 'app' && !STORE_KEY[kind])) {
                failed.push(f.name);
                continue;
            }
            found.push({ name: f.name, path: f.path, kind });
        }
        catch {
            failed.push(f.name);
        }
    }
    if (failed.length)
        toast(`${t('plugins.bundle.someBad')} ${failed.join(', ')}`, 'warning', 9000);
    if (!found.length)
        return;
    const lines = found.map((f) => `${f.name} — ${t('plugins.catKind.' + f.kind) || f.kind}`).join('\n');
    const ok = await showConfirm(t('plugins.bundle.followTitle'), `${t('plugins.bundle.followBody')}\n\n${lines}\n\n${t('plugins.bundle.followSafety')}`, false);
    if (!ok)
        return;
    let added = 0;
    let already = 0;
    for (const f of found) {
        // `bundle:<path>` is the address form every catalogue reader here already
        // understands — the same one the "add a catalogue from a file" button writes.
        const src = `bundle:${f.path}`;
        try {
            if (f.kind === 'app') {
                await invoke('add_community_source', { url: src });
                added += 1;
                continue;
            }
            const key = STORE_KEY[f.kind];
            const list = readSources(key);
            if (list.includes(src)) {
                already += 1;
                continue;
            }
            list.push(src);
            writeSources(key, list);
            recordHistory({ action: 'add', type: f.kind, url: src, via: `plugin:${pluginId}` });
            added += 1;
        }
        catch (e) {
            toast(`${f.name}: ${e}`, 'error', 8000);
        }
    }
    if (added)
        toast(`${t('plugins.bundle.followed').replace('{n}', String(added))}`, 'success', 9000);
    else if (already)
        toast(t('plugins.bundle.allAlready'), 'info', 7000);
}
/**
 * Import the automations a plugin ships, and — when asked — run them once.
 *
 * The alternative people were using is what makes this worth having: ship a `.bat`, tell the
 * person where the folder is, and hope. An automation is the one thing BMM can READ: it has
 * steps, permissions and a trigger, and all three can be shown before anything happens.
 *
 * Every task goes through `sanitiseImportedTask`, the same gate as any other `.bmmpa`. It
 * arrives DISABLED with every capability that reaches outside BMM stripped — command, script,
 * deeplink, stopProcess — because those are granted by the person who lives with them, never
 * by the file's author. A plugin is a file from a stranger like any other.
 *
 * Which is exactly what makes `runNow` defensible. A task that cannot run a program, cannot
 * fire a deeplink and cannot kill a process is a task whose worst case is a change inside BMM
 * that the person just asked for by applying the plugin. Auto-run without that stripping would
 * be arbitrary code execution on install, dressed as a convenience.
 */
async function installPluginAutomations(pluginId, runNow) {
    let files;
    try {
        files = await invoke('plugin_automations', { pluginId });
    }
    catch (e) {
        toast(`${t('common.error')}: ${e}`, 'error', 8000);
        return;
    }
    if (!files.length) {
        toast(t('plugins.auto.none'), 'info', 6000);
        return;
    }
    const sched = await import('../settings/scheduler.js');
    const imported = [];
    const failed = [];
    for (const f of files) {
        let doc;
        try {
            doc = JSON.parse(f.text);
        }
        catch {
            failed.push(f.name);
            continue;
        }
        // A .bmmpa may carry reusable BLOCKS its tasks call. They are restored FIRST, or a
        // task that calls one imports intact and dies on the step that calls it.
        const tasks = Array.isArray(doc) ? doc : (doc.tasks || []);
        if (doc && doc.includes) {
            try {
                sched.writeBlocks({ ...sched.readBlocks(), ...doc.includes });
            }
            catch { /* keep going */ }
        }
        if (!tasks.length) {
            failed.push(f.name);
            continue;
        }
        for (const raw of tasks) {
            try {
                const id = await sched.importTaskObject({ ...raw, name: raw?.name || f.name });
                imported.push({ id: id || '', name: raw?.name || f.name });
            }
            catch {
                failed.push(f.name);
            }
        }
    }
    if (failed.length) {
        toast(`${t('plugins.auto.someFailed')} ${failed.join(', ')}`, 'warning', 9000);
    }
    if (!imported.length)
        return;
    const names = imported.map((i) => i.name).join(', ');
    if (!runNow) {
        // Said out loud rather than left to be discovered. A task that appeared in the list
        // disabled, that nobody was told about, is a task nobody turns on.
        toast(`${t('plugins.auto.imported').replace('{n}', String(imported.length))} ${names}`, 'success', 9000);
        return;
    }
    const ok = await showConfirm(t('plugins.auto.runTitle'), `${t('plugins.auto.runBody')}\n\n${names}\n\n${t('plugins.auto.runSafety')}`, false);
    if (!ok) {
        toast(`${t('plugins.auto.importedOnly').replace('{n}', String(imported.length))}`, 'info', 8000);
        return;
    }
    for (const { id, name } of imported) {
        if (!id)
            continue;
        try {
            await sched.runTaskById(id);
        }
        catch (e) {
            toast(`${name}: ${e}`, 'error', 8000);
        }
    }
}
//# sourceMappingURL=plugins.js.map