// @ts-nocheck
// ── BMM Theme Catalogue ───────────────────────────────────────────────────────
// Fetches official / partner / community theme lists (same pattern as app-catalog)
// and displays a gallery with preview, install & apply buttons.


import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
// NOTE: this file is @ts-nocheck, so a wrong name here is a runtime ReferenceError and not
// a build error — scripts/check-undefined-names.mjs is what catches one.
import { enabledOnly } from '../catalogs/catalog-index.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { installTheme, activateTheme, getInstalledThemes, BmmTheme } from './theme-engine.js';
import { fetchSourceText } from '../../core/source-fetch.js';
import { resolveEntryUrl } from '../../core/catalog-url.js';


const OFFICIAL_CATALOG = 'https://raw.githubusercontent.com/BetterDCS/BMM_Themes/main/catalog.json';
const COMMUNITY_SRC_KEY = 'bmm_theme_community_sources';

let _modal: HTMLElement | null = null;
let _catalog: BmmTheme[] = [];
let _builtins: any[] = [];   // all built-in presets incl. hidden (_hidden flag)
let _filter = '';
let _communitySources: string[] = [];

// ── Init & open ───────────────────────────────────────────────────────────────
export function initThemeCatalog(): void {
    // Register global opener
    (window as any).openThemeCatalog = openCatalog;
    // Load community sources from localStorage
    try { _communitySources = JSON.parse(localStorage.getItem(COMMUNITY_SRC_KEY) || '[]'); } catch {}
}

export async function openCatalog(): Promise<void> {
    if (!_modal) buildModal();
    _modal!.classList.add('open');
    document.body.style.overflow = 'hidden';
    await fetchCatalog();
    renderCatalog();
}

function closeModal(): void {
    _modal?.classList.remove('open');
    document.body.style.overflow = '';
}

// ── Modal HTML ────────────────────────────────────────────────────────────────
function buildModal(): void {
    _modal = document.createElement('div');
    _modal.className = 'modal-overlay';
    _modal.id = 'modal-theme-catalog';
    _modal.innerHTML = `
        <div class="modal glass" style="max-width:860px;width:95%;max-height:88vh;display:flex;flex-direction:column;">
            <div class="modal-header">
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:36px;height:36px;border-radius:9px;background:rgba(59,130,246,0.15);display:flex;align-items:center;justify-content:center;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--bmm-accent)" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/><path d="M3.6 15a10 10 0 1 0 .6-5"/></svg>
                    </div>
                    <div>
                        <!-- t(), not data-i18n. applyTranslations() runs once at boot and this
                             modal is built long after — so the two attributes here were never
                             read, and the header sat in English inside a French app while every
                             other string in this file, which uses t(), was translated. -->
                        <h2 style="margin:0;font-size:16px;">${escHtml(t('themes.catalogue'))}</h2>
                        <p style="margin:0;font-size:11px;color:var(--bmm-text-muted);">${escHtml(t('themes.catalogueSub'))}</p>
                    </div>
                </div>
                <button class="modal-close" id="theme-catalog-close">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div style="padding:12px 18px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;gap:10px;align-items:center;flex-shrink:0;">
                <div style="flex:1;display:flex;align-items:center;gap:8px;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:0 10px;">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                    <input id="theme-cat-search" placeholder="${t('common.search') || 'Search...'}" style="flex:1;border:none;background:transparent;padding:8px 0;font-size:12.5px;color:var(--bmm-text-primary);">
                </div>
                <button class="btn btn-ghost btn-sm" id="theme-cat-refresh">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="margin-right:5px;"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                    ${t('common.refresh') || 'Refresh'}
                </button>
            </div>
            <div id="theme-cat-list" style="flex:1;overflow-y:auto;padding:16px 18px;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;"></div>
            <div class="modal-footer" style="padding:12px 18px;border-top:1px solid rgba(255,255,255,0.06);font-size:11px;color:var(--bmm-text-muted);display:flex;align-items:center;gap:8px;">
                <span id="theme-cat-count"></span>
                <div style="flex:1"></div>
                <!-- The way in, so it looks like one. Following and making a catalogue were a
                     ghost button in the corner, beside a second ghost button that does a
                     different job — two footnotes where one is the whole feature. -->
                <button class="btn btn-accent btn-sm" id="theme-cat-build">${escHtml(t('themes.catalogues'))}</button>
                <button class="btn btn-ghost btn-sm" id="theme-cat-import-file">${t('themes.importFile') || 'Import .bmmtheme / .json file'}</button>
            </div>
        </div>`;

    const host = document.getElementById('app-window-outer') || document.body;
    host.appendChild(_modal);

    _modal.querySelector('#theme-catalog-close')!.addEventListener('click', closeModal);
    _modal.addEventListener('click', e => { if (e.target === _modal) closeModal(); });
    _modal.querySelector('#theme-cat-search')!.addEventListener('input', (e) => {
        _filter = (e.target as HTMLInputElement).value.toLowerCase();
        renderCatalog();
    });
    _modal.querySelector('#theme-cat-refresh')!.addEventListener('click', async () => {
        await fetchCatalog(true);
        renderCatalog();
    });
    _modal.querySelector('#theme-cat-import-file')!.addEventListener('click', importFromFile);
    _modal.querySelector('#theme-cat-build')!.addEventListener('click', openThemeCatalogues);
}

// ── Theme-catalog BUILDER ─────────────────────────────────────────────────────
// Pick installed/custom themes → export a catalog.json ({version,name,themes:[full
// theme objects, vars inline]}) that this app AND the BCWEB theme feed both consume.

/**
 * Following theme catalogues, and making one — on the screen every other kind uses.
 *
 * This was three controls in two places: *+ Community source* in the header, *Create theme
 * catalog* in the footer, and its own builder modal, none of which knew about the others.
 * Following by FILE was not possible at all, and a protected source had a block here that
 * four other kinds did not have. All of it is now ui/catalog-modal.ts, and what is left is
 * the part that is about themes.
 *
 * Themes keep a third choice the other kinds do not have — the body written into
 * catalog.json itself — because that is what every theme catalogue published so far
 * contains, and it stays the default. `inlineMode` is what asks for it.
 *
 * The gallery is NOT replaced. It previews and installs, which a list of names cannot do.
 */
async function openThemeCatalogues(): Promise<void> {
    const { openCatalogModal } = await import('../../ui/catalog-modal.js');
    const all = () => [...getInstalledThemes(), ...(_builtins || []).filter((b: any) => !b._hidden)];
    await openCatalogModal({
        id: 'theme',
        title: t('themes.catalogues'),
        subtitle: t('themes.cataloguesSub'),
        storeKey: COMMUNITY_SRC_KEY,
        feedField: 'themes',
        ext: 'bmmtheme',
        fallbackNoun: 'theme',
        inlineMode: true,
        indexType: 'theme',
        candidates: async () => all(),
        label: (th: any) => ({ name: th.name || th.id, sub: th.author || '' }),
        entryId: (th: any) => th.id,
        writeEntry: async (th: any, dir: string, file: string) => {
            const sep = dir.includes('\\') ? '\\' : '/';
            await invoke('write_text_file', { path: `${dir}${sep}${file}`, content: JSON.stringify(th, null, 2) });
            return true;
        },
        // An address means the body is fetched, so the body must NOT also be here:
        // resolveThemeBody short-circuits on `vars`, so a theme carrying both would have its
        // file written, referenced, and silently ignored.
        row: (th: any, address: string) => {
            // Inline: the WHOLE object, base64 preview, assets and fonts included. A theme
            // is self-contained JSON, so this works for a custom theme with images — at the
            // cost of everybody who follows the catalogue downloading every theme’s images
            // just to read the list.
            if (!address) return th;
            // Linked or packed: an ALLOWLIST, not a rest-spread. Dropping vars alone is
            // what makes resolveThemeBody fetch the body — but it left assets, fonts,
            // global_css and the page overrides in the index, so a “linked” theme still
            // shipped its megabytes inside catalog.json and the link bought nothing.
            // preview stays: the gallery draws it before anything is fetched.
            const { id, name, author, version, description, preview, mode, bmm_min_version } = th;
            return {
                id, name, author, version, description, preview, mode, bmm_min_version,
                download_url: address,
            };
        },
        looksLike: (doc: any) => !!doc && typeof doc === 'object' && Array.isArray(doc.themes),
        onChange: () => {
            // Re-read from storage rather than tracking it: the shared screen writes the
            // key, and this module holds its own copy read once at init.
            try { _communitySources = JSON.parse(localStorage.getItem(COMMUNITY_SRC_KEY) || '[]'); } catch { /* keep what we had */ }
            fetchCatalog(true).then(renderCatalog);
        },
        manageKeys: () => {
            (document.getElementById('nav-settings') as HTMLElement | null)?.click();
            setTimeout(() => document.getElementById('settings-identity-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
        },
    });
}

/**
 * The theme itself, whether the catalogue carried it or only pointed at it.
 *
 * A theme catalogue used to be the ONE kind in BMM whose entries had to contain the whole
 * thing inline — apps, plugins, modpacks, tutorials and automations all list an address and
 * fetch the file. So the obvious way to publish themes, a folder of `.bmmtheme` files with a
 * catalog.json beside them, was the one way that did not work; you had to paste every
 * theme's full body into the feed by hand, and re-paste it to publish a fix.
 *
 * Inline still works and is still the default the builder writes — nothing published so far
 * changes. This is the other half.
 *
 * A relative address resolves against the catalogue it came from, so the folder survives
 * being moved or forked. `resolveEntryUrl` decides what may be fetched, and it checks the
 * RESULT rather than the input, because an absolute `javascript:` URL passes through
 * resolution untouched.
 */
async function resolveThemeBody(entry: BmmTheme): Promise<BmmTheme> {
    // Carrying its own body: nothing to fetch, and no reason to touch the network.
    if (entry.vars && Object.keys(entry.vars).length) return entry;
    if (!entry.download_url) return entry;

    const url = resolveEntryUrl(entry.download_url, entry._src || '');
    if (!url) throw new Error(t('themes.badThemeUrl') || 'that address cannot be fetched');

    const raw = await fetchSourceText(url);
    let doc: any;
    try { doc = JSON.parse(raw); } catch { throw new Error(t('themes.notATheme') || 'that file is not a theme'); }
    // A document with no vars is not a theme, and installing one would register an entry that
    // changes nothing and cannot be told from a theme that failed to apply.
    if (!doc || typeof doc !== 'object' || !doc.vars || typeof doc.vars !== 'object') {
        throw new Error(t('themes.notATheme') || 'that file is not a theme');
    }
    // The catalogue's id and name win. A fetched file that calls itself something else would
    // otherwise install under a different id from the one the gallery just showed — so the
    // row stays on screen as un-installed while the theme sits in the list under another name.
    return { ...doc, id: entry.id, name: entry.name || doc.name };
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchCatalog(force = false): Promise<void> {
    const listEl = document.getElementById('theme-cat-list');
    if (listEl) listEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--bmm-text-muted);font-size:13px;">${t('common.loading') || 'Loading…'}</div>`;

    try {
        const isUrl = (s: string) => /^https?:\/\//i.test(s);
        // Filtered BEFORE the url/file split, not after. Local catalogs are read through a
        // separate loop below, so filtering only the URL half would leave a switched-off
        // local catalog loading — off for one kind of source and on for the other.
        //
        // enabledOnly re-reads localStorage on every call, which matters here:
        // `_communitySources` is read once at init, so a source switched off from Settings
        // would otherwise stay on until restart.
        const live = enabledOnly(_communitySources);
        const urlSources = live.filter(isUrl);
        const fileSources = live.filter(s => !isUrl(s));
        const all: BmmTheme[] = [];
        // URL sources + the official catalog go through the backend — it sends the site
        // identity header (so PRIVATE community catalogs resolve) and, unlike a browser
        // fetch, isn't bound by the CSP connect-src allowlist.
        // An `ssh://` source is one only the FRONTEND can reach: the target and its secret
        // live here and are never stored, so the backend has nothing to connect with. Read
        // them here and hand the raw documents to the same merger, rather than parsing and
        // deduplicating a second time in TypeScript — that rule exists once, in Rust.
        // The shared parser decides what an ssh:// source is — writing the test again here
        // would be the third copy of a rule that already has one home.
        const { parseSshSource } = await import('../repo/repo-ssh.js');
        const sshSources = urlSources.filter((u) => parseSshSource(u) !== null);
        const httpSources = urlSources.filter((u) => parseSshSource(u) === null);
        const extraDocs: string[] = [];
        for (const u of sshSources) {
            // One unreachable source must not empty the list, exactly as a failing HTTP one
            // does not — the backend skips those silently too.
            try { extraDocs.push(await fetchSourceText(u)); } catch { /* skipped */ }
        }
        try {
            const fromBackend: string = await invoke('fetch_theme_catalogs', {
                officialUrl: OFFICIAL_CATALOG,
                communityUrls: httpSources,
                extraDocs,
            });
            all.push(...(JSON.parse(fromBackend || '[]')));
        } catch {}
        // LOCAL FILE sources (e.g. a catalog you exported + "added as source") can't be
        // fetch()ed — the CSP blocks file:// — so read them through the Rust file reader.
        for (const path of fileSources) {
            try {
                const text: string = await invoke('read_file_text', { path });
                const json = JSON.parse(text);
                const list = Array.isArray(json) ? json : (json?.themes || []);
                all.push(...list);
            } catch {}
        }
        // Deduplicate by id
        const seen = new Set<string>();
        _catalog = all.filter(th => { if (seen.has(th.id)) return false; seen.add(th.id); return true; });
    } catch {
        _catalog = [];
    }
    // Built-in presets (incl. hidden ones, for reinstall).
    try { _builtins = JSON.parse(await invoke('list_builtin_themes_all') as string || '[]'); }
    catch { _builtins = []; }
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderCatalog(): void {
    const listEl = document.getElementById('theme-cat-list');
    const countEl = document.getElementById('theme-cat-count');
    if (!listEl) return;

    const installed = new Set(getInstalledThemes().map(t => t.id));
    const filtered = _catalog.filter(th =>
        !_filter || th.name.toLowerCase().includes(_filter) || (th.author || '').toLowerCase().includes(_filter) || (th.description || '').toLowerCase().includes(_filter)
    );

    // ── Built-in / default themes section (apply · uninstall · reinstall) ──────
    const builtinsFiltered = _builtins.filter(th =>
        !_filter || (th.name || '').toLowerCase().includes(_filter));
    const builtinsHtml = builtinsFiltered.map(th => {
        const accentColor = th.vars?.['--bmm-accent'] || '#3b82f6';
        const hidden = !!th._hidden;
        return `
            <div class="btc-card${hidden ? ' btc-card-hidden' : ''}" data-theme-id="${escAttr(th.id)}">
                <div class="btc-preview">
                    <div class="btc-preview-placeholder" style="background:linear-gradient(135deg,${accentColor}22 0%,${accentColor}08 100%);">
                        <div class="btc-preview-swatches">
                            ${Object.values(th.vars || {}).slice(0, 5).filter((v: any) => typeof v === 'string' && (v.startsWith('#') || v.startsWith('rgb'))).map((c: any) => `<span class="btc-swatch" style="background:${c}"></span>`).join('')}
                        </div>
                        <span class="btc-preview-name">${escHtml(th.name)}</span>
                    </div>
                </div>
                <div class="btc-info">
                    <div class="btc-name">${escHtml(th.name)} <span class="btc-builtin-tag">${t('themes.builtin') || 'Default'}</span></div>
                    <div class="btc-author">${escHtml(th.author || 'BMM')}</div>
                </div>
                <div class="btc-actions">
                    ${hidden
                        ? `<button class="btn btn-xs btn-secondary btc-reinstall" data-id="${escAttr(th.id)}">${t('themes.reinstall') || 'Reinstall'}</button>`
                        : `<button class="btn btn-xs btn-accent btc-activate" data-id="${escAttr(th.id)}">${t('themes.activate') || 'Apply'}</button>
                           <button class="btn btn-xs btn-ghost btc-uninstall" data-id="${escAttr(th.id)}" style="color:var(--danger)">${t('themes.uninstall') || 'Uninstall'}</button>`}
                </div>
            </div>`;
    }).join('');

    if (!filtered.length && !builtinsFiltered.length) {
        listEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--bmm-text-muted);">${t('themes.noCatalog') || 'No themes found.'}</div>`;
        if (countEl) countEl.textContent = '';
        return;
    }

    if (countEl) countEl.textContent = `${filtered.length + builtinsFiltered.length} ${t('themes.themes') || 'theme(s)'}`;
    const sectionHead = (label: string) => `<div class="btc-section-head" style="grid-column:1/-1;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--bmm-text-muted);margin:6px 0 2px;">${escHtml(label)}</div>`;
    const catalogHtml = filtered.map(th => {
        const isInstalled = installed.has(th.id);
        const accentColor = th.vars?.['--bmm-accent'] || '#3b82f6';
        return `
            <div class="btc-card" data-theme-id="${escAttr(th.id)}">
                <div class="btc-preview">
                    ${th.preview
                        ? `<img src="${escAttr(th.preview)}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:8px 8px 0 0;">`
                        : `<div class="btc-preview-placeholder" style="background:linear-gradient(135deg,${accentColor}22 0%,${accentColor}08 100%);">
                               <div class="btc-preview-swatches">
                                   ${Object.values(th.vars || {}).slice(0, 5).filter(v => v.startsWith('#') || v.startsWith('rgb')).map(c => `<span class="btc-swatch" style="background:${c}"></span>`).join('')}
                               </div>
                               <span class="btc-preview-name">${escHtml(th.name)}</span>
                           </div>`}
                </div>
                <div class="btc-info">
                    <div class="btc-name">${escHtml(th.name)}</div>
                    <div class="btc-author">${escHtml(th.author || '')}</div>
                    ${th.description ? `<div class="btc-desc">${escHtml(th.description)}</div>` : ''}
                </div>
                <div class="btc-actions">
                    ${isInstalled
                        ? `<button class="btn btn-xs btn-accent btc-activate" data-id="${escAttr(th.id)}">${t('themes.activate') || 'Apply'}</button>`
                        : `<button class="btn btn-xs btn-secondary btc-install" data-id="${escAttr(th.id)}">${t('themes.install') || 'Install'}</button>`}
                    ${isInstalled ? `<span class="btc-installed-badge">${t('themes.installed') || 'Installed'}</span>` : ''}
                </div>
            </div>`;
    }).join('');

    const anyHidden = _builtins.some(b => b._hidden);
    const defaultHead = `<div class="btc-section-head" style="grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;margin:6px 0 2px;">
        <span style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--bmm-text-muted)">${escHtml(t('themes.defaultThemes') || 'Default themes')}</span>
        ${anyHidden ? `<button class="btn btn-xs btn-ghost" id="btc-restore-all">${escHtml(t('themes.restoreAll') || 'Restore all defaults')}</button>` : ''}
    </div>`;
    listEl.innerHTML =
        (builtinsFiltered.length || anyHidden ? defaultHead + builtinsHtml : '') +
        (filtered.length ? sectionHead(t('themes.catalogThemes') || 'Catalogue') + catalogHtml : '');

    listEl.querySelector('#btc-restore-all')?.addEventListener('click', async () => {
        try {
            const hidden: string[] = JSON.parse(await invoke('list_builtin_themes_all') as string || '[]')
                .filter((b: any) => b._hidden).map((b: any) => b.id);
            for (const id of hidden) await invoke('set_builtin_hidden', { themeId: id, hidden: false });
            const { loadBuiltinThemes } = await import('./theme-engine.js');
            await loadBuiltinThemes();
            _builtins = JSON.parse(await invoke('list_builtin_themes_all') as string || '[]');
            toast(t('themes.restoredAll') || 'All default themes restored', 'success');
            renderCatalog();
        } catch (e) { toast(String(e), 'error'); }
    });

    // ── Built-in uninstall / reinstall ────────────────────────────────────────
    const refreshBuiltins = async () => {
        try { _builtins = JSON.parse(await invoke('list_builtin_themes_all') as string || '[]'); } catch {}
        const { loadBuiltinThemes } = await import('./theme-engine.js');
        await loadBuiltinThemes(); // refresh the BUILTIN_THEMES used by every selector
        renderCatalog();
    };
    // ── Drop-in presets: say where the folder is, and rescan without a restart ──
    //
    // The scan only ran at boot, and the folder's path is different on every OS (it moved
    // once already, when the bundle id changed). "Put your themes in the presets folder"
    // is not actionable advice without the path and a way to pick them up now.
    (async () => {
        let dir = '';
        try { dir = await invoke('theme_presets_dir') as string; } catch { return; }
        const bar = document.createElement('div');
        bar.className = 'btc-dropin';
        bar.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 14px;padding:10px 12px;border:1px solid var(--bmm-border);border-radius:10px;background:var(--bmm-bg-elevated)';

        const label = document.createElement('div');
        label.style.cssText = 'flex:1;min-width:200px;font-size:12px;color:var(--bmm-text-secondary)';
        const strong = document.createElement('strong');
        strong.style.cssText = 'display:block;color:var(--bmm-text-primary);font-size:13px;margin-bottom:2px';
        strong.textContent = t('themes.dropinTitle') || 'Drop-in presets';
        const path = document.createElement('code');
        // One line, ellipsised, full text on hover. word-break:break-all wrapped a long
        // Windows path onto three lines and made a side note the tallest thing above the
        // catalogue it is a side note TO.
        path.style.cssText = 'display:block;font-size:11px;opacity:.85;overflow:hidden;'
            + 'text-overflow:ellipsis;white-space:nowrap';
        path.title = dir;
        // textContent: a path is user data and this is not a place to interpolate markup.
        path.textContent = dir;
        label.append(strong, path);

        const open = document.createElement('button');
        open.className = 'btn btn-sm';
        open.textContent = t('themes.dropinOpen') || 'Open folder';
        open.addEventListener('click', () => { void invoke('open_folder', { path: dir }); });

        const rescan = document.createElement('button');
        rescan.className = 'btn btn-sm btn-secondary';
        rescan.textContent = t('themes.dropinRescan') || 'Rescan';
        rescan.addEventListener('click', async () => {
            const before = _builtins.length;
            await refreshBuiltins();
            const added = _builtins.length - before;
            toast(added > 0
                ? (t('themes.dropinFound') || 'Presets found').replace('{n}', String(added))
                : (t('themes.dropinNone') || 'No new presets in that folder'),
                added > 0 ? 'success' : 'info');
        });

        bar.append(label, open, rescan);
        // Rescan calls renderCatalog(), which re-runs this block — so the previous bar
        // has to go, or every rescan would leave another copy stacked above the list.
        listEl.parentElement?.querySelectorAll('.btc-dropin').forEach((el) => el.remove());
        listEl.parentElement?.insertBefore(bar, listEl);
    })();

    listEl.querySelectorAll('.btc-uninstall').forEach(btn => {
        btn.addEventListener('click', async () => {
            await invoke('set_builtin_hidden', { themeId: (btn as HTMLElement).dataset.id!, hidden: true });
            toast(t('themes.uninstalled') || 'Theme uninstalled', 'success');
            await refreshBuiltins();
        });
    });
    listEl.querySelectorAll('.btc-reinstall').forEach(btn => {
        btn.addEventListener('click', async () => {
            await invoke('set_builtin_hidden', { themeId: (btn as HTMLElement).dataset.id!, hidden: false });
            toast(t('themes.reinstalled') || 'Theme reinstalled', 'success');
            await refreshBuiltins();
        });
    });

    // Wire actions
    listEl.querySelectorAll('.btc-install').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = (btn as HTMLElement).dataset.id!;
            const entry = _catalog.find(th => th.id === id);
            if (!entry) return;
            (btn as HTMLButtonElement).textContent = t('common.loading') || 'Installing…';
            (btn as HTMLButtonElement).disabled = true;
            try {
                const theme = await resolveThemeBody(entry);
                await installTheme(theme);
                toast(`${t('themes.installed') || 'Installed'}: ${theme.name}`, 'success');
            } catch (e) {
                toast(`${t('themes.fetchFailed') || 'Could not fetch that theme'}: ${e}`, 'error');
            }
            renderCatalog();
        });
    });
    listEl.querySelectorAll('.btc-activate').forEach(btn => {
        btn.addEventListener('click', async () => {
            await activateTheme((btn as HTMLElement).dataset.id!);
            closeModal();
        });
    });
}

// ── Community sources ─────────────────────────────────────────────────────────

async function importFromFile(): Promise<void> {
    const { pickFile } = await import('../../core/api.js');
    const path = await pickFile([
        { name: 'BMM Theme (.bmmtheme / .json)', extensions: ['bmmtheme', 'zip', 'json'] },
        { name: 'All files', extensions: ['*'] },
    ]);
    if (!path) return;
    try {
        const raw: string = await invoke('import_theme', { path });
        const theme: BmmTheme = JSON.parse(raw);
        await installTheme(theme);
        toast(`${t('themes.imported') || 'Imported'}: ${theme.name}`, 'success');
        closeModal();
        (window as any).openThemeEditor?.();
    } catch (e) { toast(String(e), 'error'); }
}
