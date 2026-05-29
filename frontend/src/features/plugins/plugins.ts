// @ts-nocheck
import { invoke, pickFile, saveFile, pickFolder, convertFileSrc } from '../../core/api.js';
import { toast } from '../../ui/app.js';
import { t } from '../../core/i18n.js';
import { escHtml } from '../../core/utils.js';
import { dispatchBmmAction, BMM_ACTIONS } from '../../ui/tutorial-events.js';

// ── SVG Icons (no unicode emoji) ───────────────────────────────────────────

const IC = {
  puzzle:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
  editIcon:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  duplicate:   `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  inspect:     `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`,
  download:    `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  trash:       `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  alert:       `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  check:       `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
  checkCircle: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  play:        `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
  eye:         `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  save:        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
  copy:        `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  refresh:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
  upload:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  lock:        `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  x:           `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  plus:        `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  search:      `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  zap:         `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  shield:      `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  list:        `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
  terminal:    `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
  arrowUp:     `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`,
  arrowDown:   `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`,
  globe:       `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  star:        `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  info:        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  exportIcon:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  settings:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  folder:      `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  hash:        `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>`,
};

// ── State ──────────────────────────────────────────────────────────────────

let _tab = 'installed';
let _installedPlugins = [];
let _catalog = null;
let _allMods = [];
let _allProfiles = [];
let _apiToken = '';
let _exePath = '';
let _allModpacks: any[] = [];

// Prevents event-listener accumulation when switching back to the Scripts tab
let _scriptClickHandler: EventListener | null = null;
// Endpoint def cache for on-demand code generation in all language tabs
const _epCodeCache = new Map<string, EndpointDef>();

// ── Init ───────────────────────────────────────────────────────────────────

export async function initPlugins() {
    const view = document.getElementById('view-plugins');
    if (!view) return;
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
        if (snap && snap.length) _restoreActions(snap);
    });
    // Keep _allModpacks in sync when any modpack is created/updated/deleted
    window.addEventListener('bmm://modpacks-updated', async () => {
        try {
            const mpRes  = await fetch('http://127.0.0.1:51274/api/modpacks');
            const mpJson = await mpRes.json().catch(() => ({}));
            _allModpacks = mpJson.data || [];
        } catch { _allModpacks = []; }
    });
}

/**
 * Auto-update plugins installed from the catalog. For each installed plugin that
 * has a stored catalog source and whose auto-update is not turned off, compare
 * the catalog version (matched by id) with the installed version; if it differs,
 * reinstall from the catalog download URL. Verifies both id and version.
 */
async function checkPluginUpdates(): Promise<void> {
    const candidates = (_installedPlugins || []).filter(p => {
        const id = p?.manifest?.id;
        return id
            && localStorage.getItem('bmm_plugin_src_' + id)            // came from the catalog
            && localStorage.getItem('bmm_plugin_au_' + id) !== 'off';  // auto-update not disabled
    });
    if (!candidates.length) return;

    let catalog: any;
    try { catalog = _catalog || await invoke('fetch_plugin_catalog'); _catalog = catalog; }
    catch { return; }
    const entries: any[] = catalog?.plugins || [];

    let updated = 0;
    for (const p of candidates) {
        const id = p.manifest.id;
        const entry = entries.find(e => e.id === id);                 // verify id
        if (!entry || !entry.version) continue;
        if (entry.version === p.manifest.version) continue;           // verify version differs
        const url = entry.download_url || localStorage.getItem('bmm_plugin_src_' + id);
        if (!url) continue;
        try {
            const fresh = await invoke('install_plugin', { downloadUrl: url }) as any;
            _installedPlugins = _installedPlugins.filter(x => x.manifest.id !== fresh.manifest.id);
            _installedPlugins.push(fresh);
            localStorage.setItem('bmm_plugin_src_' + fresh.manifest.id, url);
            updated++;
            toast((t('plugins.autoUpdated') || 'Plugin "{name}" updated to v{v}')
                .replace('{name}', fresh.manifest.name).replace('{v}', fresh.manifest.version), 'success');
        } catch (e) { console.warn('[plugins] auto-update failed for', id, e); }
    }
    if (updated && (_tab === 'installed' || _tab === 'manage')) renderTab(_tab);
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
        try {
            const mpRes = await fetch('http://127.0.0.1:51274/api/modpacks');
            const mpJson = await mpRes.json().catch(() => ({}));
            _allModpacks = mpJson.data || [];
        } catch { _allModpacks = []; }
    } catch (e) {
        console.error('[PLUGINS] loadInitialData error:', e);
    }
    renderTab(_tab);
}

// ── Layout ─────────────────────────────────────────────────────────────────

function renderPluginsView() {
    const view = document.getElementById('view-plugins');
    if (!view) return;
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
    if (!view) return;

    // Tasky hover tooltips on tabs
    const TAB_TIPS: Record<string, [string, string]> = {
        installed: ['plugins.tooltipTabInstalled', 'puzzle'],
        catalog:   ['plugins.tooltipTabCatalog',   'globe'],
        create:    ['plugins.tooltipTabCreate',     'list'],
        scripts:   ['plugins.tooltipTabScripts',    'terminal'],
        perms:     ['plugins.tooltipTabPerms',      'shield'],
    };
    view.querySelectorAll('.plug-tab').forEach(tab => {
        const id = (tab as HTMLElement).dataset.tab || '';
        const tip = TAB_TIPS[id];
        if (tip) {
            tab.addEventListener('mouseenter', () => (window as any).showTaskyHelp?.(tip[0], tip[1]));
            tab.addEventListener('mouseleave', () => (window as any).hideTaskyHelp?.());
        }
    });

    // Intercept ALL [data-tooltip] elements inside view-plugins → use Tasky instead of CSS tooltip
    view.addEventListener('mouseover', (e) => {
        const el = (e.target as HTMLElement).closest('[data-tooltip]') as HTMLElement | null;
        if (!el) return;
        const tip = el.getAttribute('data-tooltip') || '';
        if (tip) (window as any).showTaskyHelp?.(tip, 'info', true);
    });
    view.addEventListener('mouseout', (e) => {
        const el = (e.target as HTMLElement).closest('[data-tooltip]') as HTMLElement | null;
        if (el) (window as any).hideTaskyHelp?.();
    });

    view.addEventListener('click', (e) => {
        const tab = (e.target as HTMLElement).closest('[data-tab]') as HTMLElement;
        if (!tab || !tab.classList.contains('plug-tab')) return;
        const tabId = tab.dataset.tab;
        if (!tabId) return;
        view.querySelectorAll('.plug-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        _tab = tabId;
        renderTab(tabId);
    });
}

function renderTab(tabId: string) {
    const container = document.getElementById('plug-tab-content');
    if (!container) return;
    switch (tabId) {
        case 'installed': renderInstalled(container); break;
        case 'catalog':   renderCatalog(container); break;
        case 'create':    renderCreate(container); break;
        case 'scripts':   renderScripts(container); break;
        case 'perms':     renderPerms(container); break;
    }
}

// ── Tab: Installed ─────────────────────────────────────────────────────────

function renderInstalled(container: HTMLElement) {
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

    const grid = container.querySelector('#plug-installed-grid') as HTMLElement;
    for (const plugin of _installedPlugins) {
        grid.appendChild(buildPluginCard(plugin, 'installed'));
    }
    container.querySelector('#plug-import-file')?.addEventListener('click', handleImportFile);
    container.querySelector('#plug-goto-catalog-btn')?.addEventListener('click', () => {
        document.querySelector('.plug-tab[data-tab="catalog"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
}

function buildPluginCard(plugin: any, source: 'installed' | 'catalog') {
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
                    ? `<img src="${convertFileSrc(plugin.icon_path)}" class="plug-card-icon" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
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
                <div class="plug-card-sub">v${escHtml(manifest.version || '1.0.0')} · ${escHtml(manifest.author || '')}</div>
                ${manifest.game ? `<div class="plug-card-game">${escHtml(manifest.game)}</div>` : ''}
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
                    ${plugin.install_dir ? `
                    <span class="plug-sha-badge plug-sha-badge--pending plug-btn-sha" data-id="${escHtml(manifest.id)}" data-tooltip="${t('plugins.checksumTitle')}">
                        ${IC.hash} SHA
                    </span>` : ''}
                    ${fromCatalog ? `
                    <button class="btn btn-xs btn-ghost plug-btn-au ${auOn ? 'plug-au-on' : ''}" data-id="${escHtml(manifest.id)}"
                        data-tooltip="${auOn ? (t('plugins.autoUpdateOn') || 'Auto-update: ON (re-installs when the catalog version changes)') : (t('plugins.autoUpdateOff') || 'Auto-update: OFF')}">
                        ${IC.refresh}
                    </button>` : ''}
                    <button class="btn btn-xs btn-ghost plug-btn-folder" data-id="${escHtml(manifest.id)}" data-dir="${escHtml(plugin.install_dir || '')}" data-tooltip="${t('plugins.openFolder')}">
                        ${IC.folder}
                    </button>
                    <button class="btn btn-xs btn-ghost plug-btn-inspect" data-id="${escHtml(manifest.id)}" data-tooltip="${t('plugins.inspect')}">
                        ${IC.eye}
                    </button>
                    <button class="btn btn-xs btn-ghost plug-btn-edit" data-id="${escHtml(manifest.id)}" data-tooltip="${t('plugins.editPlugin')}">
                        ${IC.editIcon}
                    </button>
                    <button class="btn btn-xs btn-ghost plug-btn-duplicate" data-id="${escHtml(manifest.id)}" data-tooltip="${t('plugins.duplicate')}">
                        ${IC.duplicate}
                    </button>
                    <button class="btn btn-xs btn-ghost plug-btn-export" data-id="${escHtml(manifest.id)}" data-tooltip="${t('common.export')}">
                        ${IC.exportIcon}
                    </button>
                    <button class="btn btn-xs btn-danger plug-btn-uninstall" data-id="${escHtml(manifest.id)}" data-tooltip="${t('plugins.uninstall')}">
                        ${IC.trash}
                    </button>
                </div>
            ` : `
                <button class="btn btn-sm btn-accent plug-btn-install"
                    data-url="${escHtml(manifest.download_url || '')}"
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

    card.querySelector('.plug-btn-compare')?.addEventListener('click', () => handleCompare(manifest.id));
    card.querySelector('.plug-btn-apply')?.addEventListener('click', () => handleApply(manifest.id));
    card.querySelector('.plug-btn-export')?.addEventListener('click', () => handleExport(manifest.id, manifest.name));
    card.querySelector('.plug-btn-uninstall')?.addEventListener('click', () => handleUninstall(manifest.id, manifest.name));
    card.querySelector('.plug-btn-inspect')?.addEventListener('click', () => handleInspect(plugin));
    card.querySelector('.plug-btn-edit')?.addEventListener('click', () => handleEditPlugin(manifest));
    card.querySelector('.plug-btn-duplicate')?.addEventListener('click', () => handleDuplicatePlugin(manifest));
    card.querySelector('.plug-btn-au')?.addEventListener('click', (e) => {
        const btn = e.currentTarget as HTMLElement;
        const nowOn = localStorage.getItem('bmm_plugin_au_' + manifest.id) === 'off'; // toggling to ON
        if (nowOn) localStorage.removeItem('bmm_plugin_au_' + manifest.id);
        else localStorage.setItem('bmm_plugin_au_' + manifest.id, 'off');
        btn.classList.toggle('plug-au-on', nowOn);
        btn.setAttribute('data-tooltip', nowOn
            ? (t('plugins.autoUpdateOn') || 'Auto-update: ON (re-installs when the catalog version changes)')
            : (t('plugins.autoUpdateOff') || 'Auto-update: OFF'));
        toast(nowOn
            ? (t('plugins.autoUpdateEnabledP') || 'Auto-update enabled for this plugin')
            : (t('plugins.autoUpdateDisabledP') || 'Auto-update disabled for this plugin'), 'info');
    });
    card.querySelector('.plug-btn-folder')?.addEventListener('click', () => {
        const dir = (card.querySelector('.plug-btn-folder') as HTMLElement)?.dataset.dir || plugin.install_dir || '';
        if (dir) invoke('open_folder', { path: dir }).catch(() => {});
    });
    const shaBadge = card.querySelector('.plug-btn-sha') as HTMLElement | null;
    if (shaBadge) {
        // Load existing checksum or compute on demand
        invoke('compute_plugin_checksum', { pluginId: manifest.id }).then((hash: string) => {
            shaBadge.innerHTML = `${IC.hash} ${hash.substring(0, 8)}…`;
            shaBadge.classList.remove('plug-sha-badge--pending');
            shaBadge.dataset.full = hash;
        }).catch(() => {});
        shaBadge.addEventListener('click', () => {
            const hash = shaBadge.dataset.full || '';
            if (hash) handlePluginChecksumModal(manifest, plugin.install_dir, hash);
        });
    }
    card.querySelector('.plug-btn-install')?.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('.plug-btn-install') as HTMLButtonElement;
        handleInstall(btn?.dataset.url, btn?.dataset.name);
    });

    return card;
}

// ── Tab: Catalog ───────────────────────────────────────────────────────────

async function renderCatalog(container: HTMLElement) {
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
            <button class="btn btn-sm btn-secondary" id="plug-import-file-cat">${IC.upload} ${t('plugins.importFile')}</button>
        </div>
        <div id="plug-catalog-grid" class="plug-grid">
            <div class="plug-loading">${t('common.loading')}</div>
        </div>`;

    container.querySelector('#plug-refresh-catalog')?.addEventListener('click', async () => {
        _catalog = null;
        await renderCatalog(container);
    });
    container.querySelector('#plug-import-file-cat')?.addEventListener('click', handleImportFile);
    container.querySelector('#plug-catalog-search')?.addEventListener('input', (e) => {
        filterCatalogGrid((e.target as HTMLInputElement).value);
    });

    try {
        if (!_catalog) _catalog = await invoke('fetch_plugin_catalog');
        renderCatalogGrid(_catalog.plugins);
    } catch (e) {
        const grid = document.getElementById('plug-catalog-grid');
        if (grid) grid.innerHTML = `
            <div class="plug-catalog-unavail">
                <div class="plug-catalog-unavail-icon">${IC.globe}</div>
                <strong>${t('plugins.catalogUnavailTitle')}</strong>
                <p>${t('plugins.catalogUnavailDesc')}</p>
                <a class="btn btn-sm btn-ghost" href="https://github.com/BetterDCS/BetterModsManager_Plugins" target="_blank">${IC.globe} GitHub</a>
            </div>`;
    }
}

function renderCatalogGrid(plugins: any[]) {
    const grid = document.getElementById('plug-catalog-grid');
    if (!grid) return;
    if (!plugins.length) {
        grid.innerHTML = `<div class="plug-empty"><p>${t('plugins.catalogEmpty')}</p></div>`;
        return;
    }
    grid.innerHTML = '';
    for (const entry of plugins) {
        const alreadyInstalled = _installedPlugins.some(p => p.manifest.id === entry.id);
        const card = buildPluginCard(entry, 'catalog');
        if (alreadyInstalled) {
            const btn = card.querySelector('.plug-btn-install') as HTMLButtonElement;
            if (btn) { btn.innerHTML = `${IC.check} ${t('plugins.installed')}`; btn.disabled = true; btn.className = 'btn btn-sm btn-ghost'; btn.style.cursor = 'default'; }
        }
        grid.appendChild(card);
    }
}

function filterCatalogGrid(query: string) {
    if (!_catalog) return;
    const q = query.toLowerCase();
    const filtered = _catalog.plugins.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        (p.game || '').toLowerCase().includes(q) ||
        (p.author || '').toLowerCase().includes(q)
    );
    renderCatalogGrid(filtered);
}

// ── Overlay utility ────────────────────────────────────────────────────────

function createOverlay(html: string): HTMLElement {
    const ov = document.createElement('div');
    ov.className = 'plug-overlay';
    ov.innerHTML = `<div class="plug-overlay-panel">${html}</div>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(ov);
    // Backdrop click closes
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) ov.remove(); });
    // Esc key closes
    const onEsc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { ov.remove(); document.removeEventListener('keydown', onEsc); }
    };
    document.addEventListener('keydown', onEsc);
    // Clean up Esc listener when overlay is removed via other means
    const obs = new MutationObserver(() => {
        if (!document.contains(ov)) { document.removeEventListener('keydown', onEsc); obs.disconnect(); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return ov;
}

// ── Smart quick-test overlay (shows selectors for mods / profiles / plugins) ──

async function openSmartQuickTest(m: string, p: string, rawBody: string) {
    // ── Live refresh: reload all data before showing the overlay ──────────
    try {
        [_allMods, _allProfiles, _installedPlugins] = await Promise.all([
            invoke('get_mods'),
            invoke('get_profiles'),
            invoke('get_installed_plugins'),
        ]);
        try {
            const mpRes  = await fetch('http://127.0.0.1:51274/api/modpacks');
            const mpJson = await mpRes.json().catch(() => ({}));
            _allModpacks = mpJson.data || [];
        } catch { _allModpacks = []; }
    } catch (e) { console.warn('[PLUGINS] qt data refresh failed', e); }

    const modOpts  = _allMods.length     ? _allMods.map(mod => `<option value="${escHtml(mod.id)}">${escHtml(mod.name || mod.id)}</option>`).join('') : `<option value="">— aucun mod —</option>`;
    const profOpts = _allProfiles.length ? _allProfiles.map(pr  => `<option value="${escHtml(pr.id)}">${escHtml(pr.name)}</option>`).join('') : `<option value="">— aucun profil —</option>`;
    const plugOpts = _installedPlugins.length ? _installedPlugins.map(pl => `<option value="${escHtml(pl.manifest.id)}">${escHtml(pl.manifest.name)}</option>`).join('') : `<option value="">— aucun plugin —</option>`;

    const modSel     = `<div class="plug-qt-smart-field"><label class="plug-form-label" style="margin-bottom:4px;">Mod <span style="color:var(--danger)">*</span></label><select id="plug-qt-s-mod" class="select">${modOpts}</select></div>`;
    const profSel    = `<div class="plug-qt-smart-field"><label class="plug-form-label" style="margin-bottom:4px;">Profil <span style="color:var(--danger)">*</span></label><select id="plug-qt-s-profile" class="select">${profOpts}</select></div>`;
    const plugSel    = `<div class="plug-qt-smart-field"><label class="plug-form-label" style="margin-bottom:4px;">Plugin <span style="color:var(--danger)">*</span></label><select id="plug-qt-s-plugin" class="select">${plugOpts}</select></div>`;
    const modpackOpts = _allModpacks.length ? _allModpacks.map(mp => `<option value="${escHtml(mp.id)}">${escHtml(mp.name)} (${mp.mods?.length ?? 0} mods)</option>`).join('') : `<option value="">— aucun modpack —</option>`;
    const modpackSel = `<div class="plug-qt-smart-field"><label class="plug-form-label" style="margin-bottom:4px;">Modpack <span style="color:var(--danger)">*</span></label><select id="plug-qt-s-modpack" class="select">${modpackOpts}</select></div>`;
    const idInput    = (label: string, ph: string) => `<div class="plug-qt-smart-field"><label class="plug-form-label" style="margin-bottom:4px;">${label} <span style="color:var(--danger)">*</span></label><input type="text" id="plug-qt-s-id" class="input" placeholder="${ph}" style="font-family:var(--font-mono);font-size:12px;"></div>`;
    const txtInput   = (id: string, label: string, ph: string, opt = false) => `<div class="plug-qt-smart-field" style="margin-top:8px;"><label class="plug-form-label" style="margin-bottom:4px;">${label}${opt ? ' <span style="color:var(--text-muted);font-size:10px;">(optionnel)</span>' : ' <span style="color:var(--danger)">*</span>'}</label><input type="text" id="${id}" class="input" placeholder="${ph}" style="font-family:var(--font-mono);font-size:12px;"></div>`;

    let formHtml = '';
    let actualPath = p; // may be rewritten when :id is in path

    if (p === '/api/mods/enable' || p === '/api/mods/disable') {
        formHtml = modSel;
    } else if (p === '/api/mods/:id') {
        formHtml = m === 'DELETE'
            ? modSel + `<p style="font-size:11px;color:var(--danger);margin:8px 0 0;opacity:0.8;">⚠ Cette action est irréversible.</p>`
            : modSel
                + txtInput('plug-qt-s-name',        'name',        'Nouveau nom du mod',  true)
                + txtInput('plug-qt-s-version',     'version',     '1.0.0',               true)
                + txtInput('plug-qt-s-author',      'author',      'Auteur',              true)
                + txtInput('plug-qt-s-description', 'description', 'Description du mod',  true);
    } else if (p === '/api/profiles/activate') {
        formHtml = profSel;
    } else if (p === '/api/modpacks/enable' || p === '/api/modpacks/disable') {
        formHtml = modpackSel;
    } else if (p === '/api/profiles/:id') {
        formHtml = m === 'DELETE'
            ? profSel + `<p style="font-size:11px;color:var(--danger);margin:8px 0 0;opacity:0.8;">⚠ Cette action est irréversible.</p>`
            : profSel
                + txtInput('plug-qt-s-name',        'name',        'Nouveau nom du profil',      true)
                + txtInput('plug-qt-s-color',       'color',       '#3b82f6',                    true)
                + txtInput('plug-qt-s-icon',        'icon',        'star / folder / shield…',    true)
                + txtInput('plug-qt-s-game-path',   'game_path',   'C:/Games/MonJeu',            true)
                + txtInput('plug-qt-s-mods-path',   'mods_path',   'C:/Games/MonJeu/Mods',       true)
                + txtInput('plug-qt-s-backup-path', 'backup_path', 'C:/BMM/Backups/MonJeu',      true);
    } else if (p === '/api/modpacks/:id' && m === 'PUT') {
        const updModChecks = _allMods.length
            ? _allMods.map(mod => `<label style="display:flex;align-items:center;gap:8px;padding:3px 8px;border-radius:6px;cursor:pointer;" onmouseenter="this.style.background='rgba(255,255,255,0.05)'" onmouseleave="this.style.background='transparent'">
                <input type="checkbox" class="plug-qt-upd-mod-check" value="${escHtml(mod.id)}" style="accent-color:var(--accent);width:13px;height:13px;">
                <span style="font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" data-tooltip="${escHtml(mod.name||mod.id)}">${escHtml(mod.name||mod.id)}</span>
                ${mod.active ? `<span style="font-size:9px;padding:1px 4px;border-radius:3px;background:rgba(34,197,94,0.15);color:#4ade80;font-weight:700;">ON</span>` : ''}
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
                    <input type="text" id="plug-qt-s-name" class="input input-sm" placeholder="Nouveau nom" style="font-size:12px;">
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
                        <button type="button" class="btn btn-xs btn-ghost" id="plug-qt-upd-sel-all"    style="font-size:10px;">Tout</button>
                        <button type="button" class="btn btn-xs btn-ghost" id="plug-qt-upd-sel-active" style="font-size:10px;">Actifs</button>
                        <button type="button" class="btn btn-xs btn-ghost" id="plug-qt-upd-sel-none"   style="font-size:10px;">Aucun</button>
                    </div>
                </div>
                <div style="max-height:150px;overflow-y:auto;background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:4px;scrollbar-width:thin;">${updModChecks}</div>
            </div>`;
    } else if (p === '/api/modpacks/:id' && m === 'DELETE') {
        formHtml = `
            <div class="plug-qt-smart-field" style="flex-direction:column;">
                <label class="plug-form-label" style="margin-bottom:3px;">Modpack à supprimer <span style="color:var(--danger)">*</span></label>
                <select id="plug-qt-s-modpack" class="select" style="font-size:13px;">
                    ${_allModpacks.length ? _allModpacks.map(mp => `<option value="${escHtml(mp.id)}">${escHtml(mp.name)} <span style="color:var(--text-muted);font-size:10px;">(${mp.mods?.length ?? 0} mods)</span></option>`).join('') : '<option value="">— aucun modpack —</option>'}
                </select>
            </div>
            <p style="font-size:12px;color:var(--danger);margin:10px 0 0;padding:8px 10px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:6px;">
                ⚠ Cette action est <strong>irréversible</strong>. Le modpack sera définitivement supprimé.
            </p>`;

    } else if (p === '/api/profiles') {
        formHtml = txtInput('plug-qt-s-name', 'name', 'Mon profil')
            + txtInput('plug-qt-s-game-path', 'game_path', 'C:/Games/MyGame')
            + txtInput('plug-qt-s-mods-path', 'mods_path', 'C:/Games/MyGame/Mods')
            + txtInput('plug-qt-s-backup-path', 'backup_path', 'C:/BMM/Backups/MyGame');
    } else if (p === '/api/plugins/compare' || p === '/api/plugins/apply') {
        const strictRow = p === '/api/plugins/apply' ? `
            <div class="plug-qt-smart-field" style="flex-direction:row;align-items:center;gap:10px;margin-top:8px;">
                <label class="plug-form-label" style="margin:0;">force_strict</label>
                <label class="plug-toggle" style="margin:0;"><input type="checkbox" id="plug-qt-s-strict"><span class="plug-toggle-slider"></span></label>
                <span style="font-size:11px;color:var(--text-muted);">Désactive les mods absents de la liste</span>
            </div>` : '';
        formHtml = plugSel + strictRow;
    } else if (p === '/api/restart') {
        formHtml = `<p style="font-size:13px;color:var(--text-secondary);margin:0;">BMM va redémarrer dans 300 ms. L'API sera brièvement indisponible.</p>`;
    } else if (p === '/api/modpacks/create') {
        const profileChecks = _allProfiles.length
            ? _allProfiles.map(pr => `<label style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;cursor:pointer;" onmouseenter="this.style.background='rgba(255,255,255,0.05)'" onmouseleave="this.style.background='transparent'">
                <input type="checkbox" class="plug-qt-prof-check" value="${escHtml(pr.id)}" style="accent-color:var(--accent);width:13px;height:13px;">
                <span style="font-size:12px;color:var(--text-primary);flex:1;">${escHtml(pr.name)}</span>
                <span style="font-size:10px;color:var(--text-muted);">${pr.active_mods?.length || 0} mods actifs</span>
              </label>`).join('')
            : `<p style="font-size:12px;color:var(--text-muted);padding:8px;">Aucun profil.</p>`;
        const modCheckboxes = _allMods.length
            ? _allMods.map(mod => `<label style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;cursor:pointer;" onmouseenter="this.style.background='rgba(255,255,255,0.05)'" onmouseleave="this.style.background='transparent'">
                <input type="checkbox" class="plug-qt-mod-check" value="${escHtml(mod.id)}" style="accent-color:var(--accent);width:13px;height:13px;">
                <span style="font-size:12px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" data-tooltip="${escHtml(mod.name||mod.id)}">${escHtml(mod.name||mod.id)}</span>
                ${mod.active ? `<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(34,197,94,0.15);color:#4ade80;font-weight:700;">ON</span>` : ''}
              </label>`).join('')
            : `<p style="font-size:12px;color:var(--text-muted);padding:8px;">Aucun mod.</p>`;
        formHtml = `
            <!-- Nom requis -->
            <div class="plug-qt-smart-field" style="flex-direction:column;">
                <label class="plug-form-label" style="margin-bottom:3px;">name <span style="color:var(--danger)">*</span></label>
                <input type="text" id="plug-qt-s-name" class="input" placeholder="Mon Modpack" style="font-size:13px;">
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
                <label class="plug-form-label" style="margin-bottom:3px;">Importer depuis profil(s) <span style="color:var(--text-muted);font-size:9px;">(coche = inclut les mods actifs)</span></label>
                <div style="background:rgba(0,0,0,0.15);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:4px;max-height:100px;overflow-y:auto;scrollbar-width:thin;">${profileChecks}</div>
            </div>
            <!-- Mods à inclure -->
            <div class="plug-qt-smart-field" style="flex-direction:column;margin-top:6px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                    <label class="plug-form-label" style="margin:0;">Mods à inclure</label>
                    <div style="display:flex;gap:4px;">
                        <button type="button" id="plug-qt-sel-all"    class="btn btn-xs btn-ghost" style="font-size:10px;">Tout</button>
                        <button type="button" id="plug-qt-sel-active" class="btn btn-xs btn-ghost" style="font-size:10px;">Actifs</button>
                        <button type="button" id="plug-qt-sel-none"   class="btn btn-xs btn-ghost" style="font-size:10px;">Aucun</button>
                    </div>
                </div>
                <div style="max-height:180px;overflow-y:auto;background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:4px;scrollbar-width:thin;">${modCheckboxes}</div>
            </div>`;
    } else if (p === '/api/modpacks') {
        formHtml = `<p style="font-size:13px;color:var(--text-secondary);margin:0;">Requête GET — aucun corps requis.</p>`;

    // ── Repo API ──────────────────────────────────────────────────────────────
    } else if (p === '/api/repo/info') {
        formHtml = txtInput('plug-qt-s-repo-url', 'url (repo.json URL)', 'https://monserveur.com/repo.json');

    } else if (p === '/api/repo/list') {
        formHtml = `<p style="font-size:13px;color:var(--text-secondary);margin:0;">Requête GET — retourne la liste des repos connectés, aucun paramètre requis.</p>`;

    } else if (p === '/api/repo/connect') {
        formHtml = txtInput('plug-qt-s-repo-url', 'url', 'https://monserveur.com/repo.json')
            + `<p style="font-size:11px;color:var(--text-muted);margin:6px 0 0;opacity:0.85;">Le nom est récupéré automatiquement depuis le repo.json distant.</p>`;

    } else if (p === '/api/repo' && m === 'DELETE') {
        formHtml = txtInput('plug-qt-s-repo-url', 'url (URL du repo à déconnecter)', 'https://monserveur.com/repo.json')
            + `<p style="font-size:11px;color:var(--danger);margin:8px 0 0;opacity:0.8;">⚠ Le repo sera retiré de la liste des repos connectés.</p>`;

    } else if (p === '/api/repo/sync') {
        const profOpts2 = _allProfiles.length
            ? _allProfiles.map(pr => `<option value="${escHtml(pr.id)}">${escHtml(pr.name)}</option>`).join('')
            : `<option value="">— Créer un nouveau profil —</option>`;
        formHtml = `
            <!-- URL (auto-fetch on input) -->
            <div class="plug-qt-smart-field" style="flex-direction:column;">
                <label class="plug-form-label" style="margin-bottom:4px;">url (repo.json) <span style="color:var(--danger)">*</span></label>
                <input type="text" id="plug-qt-s-repo-url" class="input" placeholder="https://monserveur.com/repo.json" style="font-family:var(--font-mono);font-size:12px;">
            </div>
            <!-- Repo profiles panel (auto-populated when URL is entered) -->
            <div id="plug-qt-s-repo-profiles-panel" style="display:none;flex-direction:column;gap:4px;margin-top:6px;background:rgba(0,0,0,0.12);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:8px 10px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                    <span class="plug-form-label">Profils du repo <span style="color:var(--text-muted);font-size:10px;">(cocher = auto-sélectionner + syncer)</span></span>
                    <div style="display:flex;gap:4px;">
                        <button id="plug-qt-sync-sel-all" class="btn btn-xs btn-ghost" style="font-size:10px;padding:2px 6px;">Tout</button>
                        <button id="plug-qt-sync-sel-none" class="btn btn-xs btn-ghost" style="font-size:10px;padding:2px 6px;">Aucun</button>
                    </div>
                </div>
                <div id="plug-qt-s-repo-profiles-list" style="max-height:130px;overflow-y:auto;scrollbar-width:thin;display:flex;flex-direction:column;gap:2px;">
                    <p style="font-size:12px;color:var(--text-muted);padding:4px 0;">Entrez une URL pour charger les profils…</p>
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
                <label class="plug-form-label" style="margin-bottom:4px;">Profil local cible <span style="color:var(--text-muted);font-size:10px;">(optionnel — crée un nouveau si vide)</span></label>
                <select id="plug-qt-s-local-prof" class="select">
                    <option value="">— Créer un nouveau profil —</option>
                    ${profOpts2}
                </select>
            </div>
            <!-- Sync options row -->
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:flex-end;">
                <div style="flex:2;min-width:160px;">
                    <label class="plug-form-label" style="margin-bottom:4px;">Mode de sync</label>
                    <select id="plug-qt-s-sync-mode" class="select" style="font-size:12px;">
                        <option value="smart">Manquants / incorrects seulement (rapide)</option>
                        <option value="all">Réinstallation complète (overwrite_all)</option>
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
                    Supprimer les mods absents du repo (delete_extra)
                </label>
            </div>`;

    } else if (p === '/api/repo/gen') {
        const profChecksGen = _allProfiles.length
            ? _allProfiles.map(pr => `
              <label style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;cursor:pointer;" onmouseenter="this.style.background='rgba(255,255,255,0.05)'" onmouseleave="this.style.background='transparent'">
                <input type="checkbox" class="plug-qt-host-prof-check" value="${escHtml(pr.id)}" style="accent-color:var(--accent);width:13px;height:13px;">
                <span style="font-size:12px;flex:1;">${escHtml(pr.name)}</span>
                <span style="font-size:10px;color:var(--text-muted);">${pr.active_mods?.length || 0} mods</span>
              </label>`).join('')
            : `<p style="font-size:12px;color:var(--text-muted);padding:8px;">Aucun profil disponible.</p>`;
        // Server distribution panel (shown when zip_output is checked OR standalone server is enabled)
        const serverPanel = `
            <div id="plug-qt-gen-server-panel" style="display:none;flex-direction:column;gap:6px;margin-top:8px;padding:10px 12px;background:rgba(0,0,0,0.15);border:1px solid rgba(255,255,255,0.07);border-radius:8px;">
                <div class="plug-form-label" style="margin-bottom:2px;">${IC.globe} Configuration serveur de distribution</div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text-secondary);">
                        <input type="checkbox" id="plug-qt-s-use-cf" style="accent-color:var(--accent);">
                        ${IC.globe} Cloudflare Tunnel
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text-secondary);">
                        <input type="checkbox" id="plug-qt-s-use-upnp" style="accent-color:var(--accent);">
                        UPnP (ouverture port)
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text-secondary);">
                        <input type="checkbox" id="plug-qt-s-use-docker" style="accent-color:var(--accent);">
                        Docker
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text-secondary);">
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
                        <input type="password" id="plug-qt-s-admin-pw" class="input input-sm" placeholder="(optionnel)" style="font-size:12px;">
                    </div>
                </div>
            </div>`;
        formHtml = `
            <!-- Profile selection -->
            <div class="plug-qt-smart-field" style="flex-direction:column;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                    <label class="plug-form-label" style="margin:0;">profile_ids <span style="color:var(--danger)">*</span></label>
                    <div style="display:flex;gap:4px;">
                        <button type="button" id="plug-qt-gen-sel-all"  class="btn btn-xs btn-ghost" style="font-size:10px;">Tout</button>
                        <button type="button" id="plug-qt-gen-sel-none" class="btn btn-xs btn-ghost" style="font-size:10px;">Aucun</button>
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
                    <input type="text" id="plug-qt-s-author-name" class="input" placeholder="Mon Pseudo" style="font-size:12px;">
                </div>
            </div>
            <!-- Seed -->
            <div style="margin-top:6px;display:flex;flex-direction:column;gap:2px;">
                <label class="plug-form-label" style="font-size:10px;">seed <span style="color:var(--text-muted);font-size:10px;">(optionnel — stabilité des hachages)</span></label>
                <input type="text" id="plug-qt-s-seed" class="input input-sm" placeholder="laisser vide pour aléatoire" style="font-family:var(--font-mono);font-size:12px;">
            </div>
            <!-- zip_output -->
            <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;align-items:center;">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text-secondary);">
                    <input type="checkbox" id="plug-qt-s-zip-output" style="accent-color:var(--accent);">
                    ${IC.upload} zip_output (compresser en .zip)
                </label>
            </div>
            ${serverPanel}`;

    } else if (p === '/api/repo/host') {
        formHtml = txtInput('plug-qt-s-serve-dir', 'serve_dir (dossier à servir)', 'C:/BMM/Export/Repo')
            + txtInput('plug-qt-s-http-port', 'port', '8080', true)
            + txtInput('plug-qt-s-http-upload-limit', 'upload_limit (KB/s, 0 = illimité)', '0', true);

    } else if (m === 'GET' || (m === 'DELETE' && !rawBody)) {
        // Parameterless GET / DELETE: no body form — just Send + Copy cURL in the footer.
        formHtml = `<p style="font-size:13px;color:var(--text-secondary);margin:0;">${t('plugins.qtNoBody') || `${escHtml(m)} request — no parameters required. Use “Send” to run it, or “cURL” to copy the command.`}</p>`;
    } else {
        const pretty = (() => { try { return JSON.stringify(JSON.parse(rawBody), null, 2); } catch { return rawBody; } })();
        formHtml = `<p style="font-size:11px;color:var(--text-muted);margin:0 0 6px;">${t('plugins.qtBodyHint')}</p>
            <textarea id="plug-qt-s-json" class="input" style="font-family:var(--font-mono);font-size:12px;min-height:110px;resize:vertical;" spellcheck="false">${escHtml(pretty)}</textarea>`;
    }

    const methodCls: Record<string, string> = { GET:'plug-method-get', POST:'plug-method-post', PUT:'plug-method-put', DELETE:'plug-method-delete', PATCH:'plug-method-patch' };
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
        let bodyObj: any = null;
        let resolvedCopyPath = p;

        if (p === '/api/repo/gen') {
            const profIds   = Array.from(overlay.querySelectorAll<HTMLInputElement>('.plug-qt-host-prof-check:checked')).map(c => c.value);
            const outputDir = (overlay.querySelector('#plug-qt-s-output-dir')     as HTMLInputElement)?.value?.trim() || '';
            const author    = (overlay.querySelector('#plug-qt-s-author-name')    as HTMLInputElement)?.value?.trim() || '';
            const seed      = (overlay.querySelector('#plug-qt-s-seed')           as HTMLInputElement)?.value?.trim();
            const zipOutput = (overlay.querySelector('#plug-qt-s-zip-output')     as HTMLInputElement)?.checked || false;
            const useCf     = (overlay.querySelector('#plug-qt-s-use-cf')         as HTMLInputElement)?.checked || false;
            const useUpnp   = (overlay.querySelector('#plug-qt-s-use-upnp')       as HTMLInputElement)?.checked || false;
            const useDocker = (overlay.querySelector('#plug-qt-s-use-docker')     as HTMLInputElement)?.checked || false;
            const dockerOs  = (overlay.querySelector('#plug-qt-s-docker-os')      as HTMLSelectElement)?.value || 'linux';
            const srvVer    = (overlay.querySelector('#plug-qt-s-server-version') as HTMLSelectElement)?.value || 'std';
            const autoStart = (overlay.querySelector('#plug-qt-s-auto-start')     as HTMLInputElement)?.checked || false;
            const portStr   = (overlay.querySelector('#plug-qt-s-port')           as HTMLInputElement)?.value?.trim();
            const ulStr     = (overlay.querySelector('#plug-qt-s-upload-limit')   as HTMLInputElement)?.value?.trim();
            const adminPw   = (overlay.querySelector('#plug-qt-s-admin-pw')       as HTMLInputElement)?.value?.trim();
            bodyObj = { profileIds: profIds, outputDir, authorName: author, generateServer: zipOutput, zipOutput, useCloudflare: useCf, useUpnp, autoStart };
            if (seed)    bodyObj.seed          = seed;
            if (portStr) bodyObj.port          = parseInt(portStr, 10) || 8080;
            if (ulStr)   bodyObj.uploadLimit   = parseInt(ulStr, 10) || 0;
            if (adminPw) bodyObj.adminPassword = adminPw;
            if (useDocker) { bodyObj.useDocker = true; bodyObj.dockerOs = dockerOs; bodyObj.serverVersion = srvVer; }

        } else if (p === '/api/repo/sync') {
            const profIds = Array.from(overlay.querySelectorAll<HTMLInputElement>('.plug-qt-sync-prof-check:checked')).map(c => c.value);
            bodyObj = {
                url:          (overlay.querySelector('#plug-qt-s-repo-url')    as HTMLInputElement)?.value?.trim() || '',
                gameDir:      (overlay.querySelector('#plug-qt-s-game-dir')    as HTMLInputElement)?.value?.trim() || '',
                modsDir:      (overlay.querySelector('#plug-qt-s-mods-dir')    as HTMLInputElement)?.value?.trim() || '',
                backupDir:    (overlay.querySelector('#plug-qt-s-backup-dir')  as HTMLInputElement)?.value?.trim() || '',
                overwriteAll: (overlay.querySelector('#plug-qt-s-sync-mode')   as HTMLSelectElement)?.value === 'all',
                deleteExtra:  (overlay.querySelector('#plug-qt-s-delete-extra') as HTMLInputElement)?.checked || false,
                downloadLimit: parseInt((overlay.querySelector('#plug-qt-s-dl-limit') as HTMLInputElement)?.value || '0', 10) || 0,
            };
            if (profIds.length) bodyObj.choices = profIds.map(pid => ({ repoProfileId: pid }));

        } else if (p === '/api/repo/host') {
            bodyObj = {
                serveDir:    (overlay.querySelector('#plug-qt-s-serve-dir')          as HTMLInputElement)?.value?.trim() || '',
                port:        parseInt((overlay.querySelector('#plug-qt-s-http-port') as HTMLInputElement)?.value || '8080', 10),
                uploadLimit: parseInt((overlay.querySelector('#plug-qt-s-http-upload-limit') as HTMLInputElement)?.value || '0', 10),
            };

        } else if (p === '/api/modpacks/create') {
            const name  = (overlay.querySelector('#plug-qt-s-name')            as HTMLInputElement)?.value?.trim() || '';
            const desc  = (overlay.querySelector('#plug-qt-s-desc')            as HTMLInputElement)?.value?.trim();
            const game  = (overlay.querySelector('#plug-qt-s-game')            as HTMLInputElement)?.value?.trim();
            const sr    = (overlay.querySelector('#plug-qt-s-sr-link')         as HTMLInputElement)?.value?.trim();
            const dep   = (overlay.querySelector('#plug-qt-s-dep-mode')        as HTMLSelectElement)?.value || 'none';
            const multi = (overlay.querySelector('#plug-qt-s-multi-profile')   as HTMLInputElement)?.checked || false;
            const skip  = (overlay.querySelector('#plug-qt-s-skip-integrity')  as HTMLInputElement)?.checked || false;
            const mods  = Array.from(overlay.querySelectorAll<HTMLInputElement>('.plug-qt-mod-check:checked')).map(c => c.value);
            bodyObj = { name, multi_profile: multi, skip_integrity_check: skip, dependency_mode: dep };
            if (desc) bodyObj.description = desc;
            if (game) bodyObj.game_name   = game;
            if (sr)   bodyObj.sr_link     = sr;
            if (mods.length) bodyObj.mod_ids = mods;

        } else if (p === '/api/modpacks/:id' && m === 'PUT') {
            const mpId = (overlay.querySelector('#plug-qt-s-modpack') as HTMLSelectElement)?.value || '';
            resolvedCopyPath = `/api/modpacks/${mpId}`;
            bodyObj = {
                name:                (overlay.querySelector('#plug-qt-s-name')           as HTMLInputElement)?.value?.trim() || '',
                multi_profile:       (overlay.querySelector('#plug-qt-s-multi-profile')  as HTMLInputElement)?.checked || false,
                skip_integrity_check:(overlay.querySelector('#plug-qt-s-skip-integrity') as HTMLInputElement)?.checked || false,
                dependency_mode:     (overlay.querySelector('#plug-qt-s-dep-mode')       as HTMLSelectElement)?.value || 'none',
            };
            const desc2 = (overlay.querySelector('#plug-qt-s-description') as HTMLInputElement)?.value?.trim();
            const gn2   = (overlay.querySelector('#plug-qt-s-game-name')   as HTMLInputElement)?.value?.trim();
            const sr2   = (overlay.querySelector('#plug-qt-s-sr-link')     as HTMLInputElement)?.value?.trim();
            const mods2 = Array.from(overlay.querySelectorAll<HTMLInputElement>('.plug-qt-upd-mod-check:checked')).map(c => c.value);
            if (desc2) bodyObj.description   = desc2;
            if (gn2)   bodyObj.game_name     = gn2;
            if (sr2)   bodyObj.sr_link       = sr2;
            if (mods2.length) bodyObj.mod_ids = mods2;

        } else {
            // Fallback: read JSON textarea or raw hint
            const bodyTa = overlay.querySelector('#plug-qt-s-json') as HTMLTextAreaElement | null;
            const raw = bodyTa ? bodyTa.value.trim() : (rawBody || '');
            if (raw && raw !== '{}') {
                try { bodyObj = JSON.parse(raw); } catch { bodyObj = raw; }
            }
            // Resolve :param placeholders for simple cases
            const modId  = (overlay.querySelector('#plug-qt-s-mod')     as HTMLSelectElement)?.value;
            const profId = (overlay.querySelector('#plug-qt-s-profile')  as HTMLSelectElement)?.value;
            const mpId2  = (overlay.querySelector('#plug-qt-s-modpack')  as HTMLSelectElement)?.value;
            if (modId)  resolvedCopyPath = p.replace(':id', modId);
            if (profId) resolvedCopyPath = p.replace(':id', profId);
            if (mpId2)  resolvedCopyPath = p.replace(':id', mpId2);
        }

        const bodyStr = bodyObj != null
            ? (typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj, null, 2))
            : '';
        const authHeader = _apiToken ? ` \\\n  -H "Authorization: Bearer ${_apiToken}"` : '';
        const bodyFlag = (m !== 'GET' && bodyStr && bodyStr !== '{}')
            ? ` \\\n  -H "Content-Type: application/json" \\\n  -d '${bodyStr.replace(/\n/g, '').replace(/'/g, "'\\''")}'`
            : '';
        const curl = `curl -X ${m} "http://127.0.0.1:51274${resolvedCopyPath}"${authHeader}${bodyFlag}`;
        try {
            await navigator.clipboard.writeText(curl);
            toast('cURL copié ! 📋', 'success');
        } catch {
            window.prompt('Copiez la commande cURL :', curl);
        }
    });

    // ── Create Modpack helpers ────────────────────────────────────────────────
    if (p === '/api/modpacks/create') {
        const checkAll  = (v: boolean) => overlay.querySelectorAll<HTMLInputElement>('.plug-qt-mod-check').forEach(c => c.checked = v);
        overlay.querySelector('#plug-qt-sel-all')?.addEventListener('click',    () => checkAll(true));
        overlay.querySelector('#plug-qt-sel-none')?.addEventListener('click',   () => checkAll(false));
        overlay.querySelector('#plug-qt-sel-active')?.addEventListener('click', () => {
            overlay.querySelectorAll<HTMLInputElement>('.plug-qt-mod-check').forEach(c => {
                const mod = _allMods.find(m => m.id === c.value);
                c.checked = !!(mod && mod.active);
            });
        });

        // Profile multi-select: checking a profile auto-adds its active mods (additive)
        overlay.querySelectorAll<HTMLInputElement>('.plug-qt-prof-check').forEach(cb => {
            cb.addEventListener('change', () => {
                // Collect all checked profiles
                const checkedProfIds = Array.from(overlay.querySelectorAll<HTMLInputElement>('.plug-qt-prof-check:checked')).map(c => c.value);
                // Build union of all active mod IDs from checked profiles
                const unionIds = new Set<string>();
                checkedProfIds.forEach(pid => {
                    const prof = _allProfiles.find(pr => pr.id === pid);
                    (Array.isArray(prof?.active_mods) ? prof.active_mods : []).forEach(id => unionIds.add(id));
                });
                overlay.querySelectorAll<HTMLInputElement>('.plug-qt-mod-check').forEach(c => {
                    if (unionIds.has(c.value)) c.checked = true;
                    // don't uncheck — user may have manual selections too
                });
            });
        });

        // Plugin source: when selected, auto-check matching mods
        overlay.querySelector('#plug-qt-s-plugin-src')?.addEventListener('change', (ev) => {
            const val = (ev.target as HTMLSelectElement).value;
            if (!val) return;
            const plId = val;
            const pl = _installedPlugins.find(p => p.manifest.id === plId);
            const reqNames: string[] = (pl?.manifest?.modlist?.required_mods || []).map((rm: any) => (rm.name || '').toLowerCase());
            overlay.querySelectorAll<HTMLInputElement>('.plug-qt-mod-check').forEach(c => {
                const mod = _allMods.find(m => m.id === c.value);
                if (mod && reqNames.includes((mod.name || '').toLowerCase())) c.checked = true;
            });
        });
    }

    // ── Update Modpack helpers ─────────────────────────────────────────────────
    if (p === '/api/modpacks/:id' && m === 'PUT') {
        const checkAllUpd  = (v: boolean) => overlay.querySelectorAll<HTMLInputElement>('.plug-qt-upd-mod-check').forEach(c => c.checked = v);
        overlay.querySelector('#plug-qt-upd-sel-all')?.addEventListener('click',    () => checkAllUpd(true));
        overlay.querySelector('#plug-qt-upd-sel-none')?.addEventListener('click',   () => checkAllUpd(false));
        overlay.querySelector('#plug-qt-upd-sel-active')?.addEventListener('click', () => {
            overlay.querySelectorAll<HTMLInputElement>('.plug-qt-upd-mod-check').forEach(c => {
                const mod = _allMods.find(m => m.id === c.value);
                c.checked = !!(mod && mod.active);
            });
        });

        // Auto-fill fields when modpack is selected from the dropdown
        const fillFromModpack = (mpId: string) => {
            const mp = _allModpacks.find((x: any) => x.id === mpId);
            if (!mp) return;
            const nameEl  = overlay.querySelector('#plug-qt-s-name')        as HTMLInputElement;
            const descEl  = overlay.querySelector('#plug-qt-s-description') as HTMLInputElement;
            const gnameEl = overlay.querySelector('#plug-qt-s-game-name')   as HTMLInputElement;
            const srEl    = overlay.querySelector('#plug-qt-s-sr-link')     as HTMLInputElement;
            const mpEl    = overlay.querySelector('#plug-qt-s-multi-profile')  as HTMLInputElement;
            const siEl    = overlay.querySelector('#plug-qt-s-skip-integrity') as HTMLInputElement;
            const dmEl    = overlay.querySelector('#plug-qt-s-dep-mode')    as HTMLSelectElement;
            if (nameEl)  nameEl.value  = mp.name || '';
            if (descEl)  descEl.value  = mp.description || '';
            if (gnameEl) gnameEl.value = mp.game_name || '';
            if (srEl)    srEl.value    = mp.sr_link || '';
            if (mpEl)    mpEl.checked  = !!mp.multi_profile;
            if (siEl)    siEl.checked  = !!mp.skip_integrity_check;
            if (dmEl)    dmEl.value    = mp.dependency_mode || 'none';
            // Check mods that belong to this modpack
            const modIds: string[] = (mp.mods || []).map((x: any) => typeof x === 'string' ? x : x.id);
            overlay.querySelectorAll<HTMLInputElement>('.plug-qt-upd-mod-check').forEach(c => {
                c.checked = modIds.includes(c.value);
            });
        };
        const mpSel = overlay.querySelector('#plug-qt-s-modpack') as HTMLSelectElement | null;
        if (mpSel) {
            mpSel.addEventListener('change', () => fillFromModpack(mpSel.value));
            if (mpSel.value) fillFromModpack(mpSel.value); // pre-fill on open
        }
    }

    // ── Gen form: profile select all/none + zip/server panel toggles ─────────
    if (p === '/api/repo/gen') {
        // Profile select all / none
        overlay.querySelector('#plug-qt-gen-sel-all')?.addEventListener('click',  () => overlay.querySelectorAll<HTMLInputElement>('.plug-qt-host-prof-check').forEach(c => c.checked = true));
        overlay.querySelector('#plug-qt-gen-sel-none')?.addEventListener('click', () => overlay.querySelectorAll<HTMLInputElement>('.plug-qt-host-prof-check').forEach(c => c.checked = false));
        // Show/hide server panel when zip_output is toggled
        const zipCb       = overlay.querySelector('#plug-qt-s-zip-output')    as HTMLInputElement | null;
        const dockerCb    = overlay.querySelector('#plug-qt-s-use-docker')    as HTMLInputElement | null;
        const serverPanel = overlay.querySelector('#plug-qt-gen-server-panel') as HTMLElement | null;
        const dockerOpts  = overlay.querySelector('#plug-qt-gen-docker-opts') as HTMLElement | null;
        const updateServerPanel = () => {
            if (serverPanel) serverPanel.style.display = zipCb?.checked ? 'flex' : 'none';
        };
        zipCb?.addEventListener('change', updateServerPanel);
        dockerCb?.addEventListener('change', () => {
            if (dockerOpts) dockerOpts.style.display = dockerCb.checked ? 'flex' : 'none';
        });
    }

    // ── Sync form: Tout/Aucun profile selectors ─────────────────────────────
    if (p === '/api/repo/sync') {
        overlay.querySelector('#plug-qt-sync-sel-all')?.addEventListener('click', () =>
            overlay.querySelectorAll<HTMLInputElement>('.plug-qt-sync-prof-check').forEach(c => c.checked = true));
        overlay.querySelector('#plug-qt-sync-sel-none')?.addEventListener('click', () =>
            overlay.querySelectorAll<HTMLInputElement>('.plug-qt-sync-prof-check').forEach(c => c.checked = false));
    }

    // ── Sync form: auto-fetch repo profiles when URL is entered ─────────────
    if (p === '/api/repo/sync') {
        const urlInput      = overlay.querySelector('#plug-qt-s-repo-url')           as HTMLInputElement | null;
        const profilesPanel = overlay.querySelector('#plug-qt-s-repo-profiles-panel') as HTMLElement | null;
        const profilesList  = overlay.querySelector('#plug-qt-s-repo-profiles-list')  as HTMLElement | null;

        let _syncFetchTimer: ReturnType<typeof setTimeout> | null = null;

        const doFetchRepoProfiles = async (repoUrl: string) => {
            if (!profilesPanel || !profilesList) return;
            profilesList.innerHTML = `<p style="font-size:12px;color:var(--text-muted);padding:4px 0;">${IC.refresh} Chargement…</p>`;
            profilesPanel.style.display = 'flex';
            try {
                const res  = await fetch(`http://127.0.0.1:51274/api/repo/info?url=${encodeURIComponent(repoUrl)}`);
                const json = await res.json().catch(() => ({}));
                const profiles: any[] = json.profiles || json.data?.profiles || [];
                if (profiles.length === 0) {
                    profilesList.innerHTML = `<p style="font-size:12px;color:var(--text-muted);padding:4px 0;">Aucun profil trouvé dans ce repo.</p>`;
                } else {
                    profilesList.innerHTML = profiles.map((pr: any) => `
                        <label style="display:flex;align-items:center;gap:8px;padding:3px 6px;border-radius:5px;cursor:pointer;font-size:12px;" onmouseenter="this.style.background='rgba(255,255,255,0.05)'" onmouseleave="this.style.background='transparent'">
                            <input type="checkbox" class="plug-qt-sync-prof-check" value="${escHtml(pr.id || pr.name)}" style="accent-color:var(--accent);width:13px;height:13px;">
                            <span style="flex:1;">${escHtml(pr.name || pr.id)}</span>
                            <span style="font-size:10px;color:var(--text-muted);">${pr.mods?.length ?? pr.mod_count ?? ''} mods</span>
                        </label>`).join('');
                }
            } catch {
                profilesList.innerHTML = `<p style="font-size:12px;color:var(--danger);padding:4px 0;">Erreur fetch repo — vérifiez l'URL.</p>`;
            }
        };

        if (urlInput) {
            urlInput.addEventListener('input', () => {
                if (_syncFetchTimer) clearTimeout(_syncFetchTimer);
                const url = urlInput.value.trim();
                if (!url) {
                    if (profilesPanel) profilesPanel.style.display = 'none';
                    return;
                }
                _syncFetchTimer = setTimeout(() => doFetchRepoProfiles(url), 600);
            });
            // If URL is pre-filled (e.g. from prefillTester), fetch immediately
            if (urlInput.value.trim()) doFetchRepoProfiles(urlInput.value.trim());
        }
    }

    overlay.querySelector('#plug-qt-s-run')?.addEventListener('click', () => {
        let body = '{}';
        let resolvedPath = p;

        if (p === '/api/mods/enable' || p === '/api/mods/disable') {
            body = JSON.stringify({ mod_id: (overlay.querySelector('#plug-qt-s-mod') as HTMLSelectElement)?.value || '' });
        } else if (p === '/api/mods/:id') {
            const modId = (overlay.querySelector('#plug-qt-s-mod') as HTMLSelectElement)?.value || '';
            resolvedPath = `/api/mods/${modId}`;
            if (m === 'PUT') {
                const obj: any = {};
                const name  = (overlay.querySelector('#plug-qt-s-name')        as HTMLInputElement)?.value?.trim();
                const ver   = (overlay.querySelector('#plug-qt-s-version')     as HTMLInputElement)?.value?.trim();
                const auth  = (overlay.querySelector('#plug-qt-s-author')      as HTMLInputElement)?.value?.trim();
                const desc  = (overlay.querySelector('#plug-qt-s-description') as HTMLInputElement)?.value?.trim();
                if (name)  obj.name        = name;
                if (ver)   obj.version     = ver;
                if (auth)  obj.author      = auth;
                if (desc)  obj.description = desc;
                body = Object.keys(obj).length ? JSON.stringify(obj) : '{}';
            }
        } else if (p === '/api/profiles/activate') {
            body = JSON.stringify({ profile_id: (overlay.querySelector('#plug-qt-s-profile') as HTMLSelectElement)?.value || '' });
        } else if (p === '/api/modpacks/enable' || p === '/api/modpacks/disable') {
            body = JSON.stringify({ modpack_id: (overlay.querySelector('#plug-qt-s-modpack') as HTMLSelectElement)?.value || '' });
        } else if (p === '/api/profiles/:id') {
            const profId = (overlay.querySelector('#plug-qt-s-profile') as HTMLSelectElement)?.value || '';
            resolvedPath = `/api/profiles/${profId}`;
            if (m === 'PUT') {
                const obj: any = {};
                const name       = (overlay.querySelector('#plug-qt-s-name')        as HTMLInputElement)?.value?.trim();
                const color      = (overlay.querySelector('#plug-qt-s-color')       as HTMLInputElement)?.value?.trim();
                const icon       = (overlay.querySelector('#plug-qt-s-icon')        as HTMLInputElement)?.value?.trim();
                const gamePath   = (overlay.querySelector('#plug-qt-s-game-path')   as HTMLInputElement)?.value?.trim();
                const modsPath   = (overlay.querySelector('#plug-qt-s-mods-path')   as HTMLInputElement)?.value?.trim();
                const backupPath = (overlay.querySelector('#plug-qt-s-backup-path') as HTMLInputElement)?.value?.trim();
                if (name)       obj.name        = name;
                if (color)      obj.color       = color;
                if (icon)       obj.icon        = icon;
                if (gamePath)   obj.game_path   = gamePath;
                if (modsPath)   obj.mods_path   = modsPath;
                if (backupPath) obj.backup_path = backupPath;
                body = JSON.stringify(obj);
            }
        } else if (p === '/api/modpacks/:id' && m === 'PUT') {
            const mpId = (overlay.querySelector('#plug-qt-s-modpack') as HTMLSelectElement)?.value || '';
            if (!mpId) { toast('Sélectionnez un modpack', 'warning'); return; }
            const updName    = (overlay.querySelector('#plug-qt-s-name')           as HTMLInputElement)?.value?.trim();
            const updDesc    = (overlay.querySelector('#plug-qt-s-description')    as HTMLInputElement)?.value?.trim();
            const updGname   = (overlay.querySelector('#plug-qt-s-game-name')      as HTMLInputElement)?.value?.trim();
            const updSrLink  = (overlay.querySelector('#plug-qt-s-sr-link')        as HTMLInputElement)?.value?.trim();
            const updDepMode = (overlay.querySelector('#plug-qt-s-dep-mode')       as HTMLSelectElement)?.value;
            const updMultiPr = (overlay.querySelector('#plug-qt-s-multi-profile')  as HTMLInputElement)?.checked;
            const updSkipInt = (overlay.querySelector('#plug-qt-s-skip-integrity') as HTMLInputElement)?.checked;
            const updMods    = Array.from(overlay.querySelectorAll<HTMLInputElement>('.plug-qt-upd-mod-check:checked')).map(c => c.value).filter(Boolean);
            const updPrefill: any = { multi_profile: !!updMultiPr, skip_integrity_check: !!updSkipInt };
            if (updName)          updPrefill.name             = updName;
            if (updDesc)          updPrefill.description      = updDesc;
            if (updGname)         updPrefill.game_name        = updGname;
            if (updSrLink)        updPrefill.sr_link          = updSrLink;
            if (updDepMode)       updPrefill.dependency_mode  = updDepMode;
            if (updMods.length)   updPrefill.mod_ids          = updMods;
            overlay.remove();
            // Navigate to Modpacks page and open native Update editor
            const modpackNavBtn2 = document.querySelector('.nav-item[data-view="modpacks"]') as HTMLElement | null;
            if (modpackNavBtn2) modpackNavBtn2.click();
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent('bmm:modpack-focus', {
                    detail: { action: 'update', modpackId: mpId, prefill: updPrefill },
                }));
            }, 350);
            return;

        } else if (p === '/api/modpacks/:id' && m === 'DELETE') {
            const mpId = (overlay.querySelector('#plug-qt-s-modpack') as HTMLSelectElement)?.value || '';
            if (!mpId) { toast('Sélectionnez un modpack', 'warning'); return; }
            resolvedPath = `/api/modpacks/${mpId}`;
            body = '';

        } else if (p === '/api/profiles') {
            body = JSON.stringify({
                name:        (overlay.querySelector('#plug-qt-s-name')        as HTMLInputElement)?.value || '',
                game_path:   (overlay.querySelector('#plug-qt-s-game-path')   as HTMLInputElement)?.value || '',
                mods_path:   (overlay.querySelector('#plug-qt-s-mods-path')   as HTMLInputElement)?.value || '',
                backup_path: (overlay.querySelector('#plug-qt-s-backup-path') as HTMLInputElement)?.value || '',
                game_name:   '',
            });
        } else if (p === '/api/plugins/compare') {
            body = JSON.stringify({ plugin_id: (overlay.querySelector('#plug-qt-s-plugin') as HTMLSelectElement)?.value || '' });
        } else if (p === '/api/plugins/apply') {
            body = JSON.stringify({ plugin_id: (overlay.querySelector('#plug-qt-s-plugin') as HTMLSelectElement)?.value || '', force_strict: (overlay.querySelector('#plug-qt-s-strict') as HTMLInputElement)?.checked || false });
        } else if (p === '/api/restart') {
            body = '{}';
        } else if (p === '/api/modpacks/create') {
            const name = (overlay.querySelector('#plug-qt-s-name') as HTMLInputElement)?.value?.trim() || '';
            if (!name) { toast('Le nom du modpack est requis', 'warning'); return; }
            const desc     = (overlay.querySelector('#plug-qt-s-desc')          as HTMLInputElement)?.value?.trim();
            const game     = (overlay.querySelector('#plug-qt-s-game')          as HTMLInputElement)?.value?.trim();
            const srLink   = (overlay.querySelector('#plug-qt-s-sr-link')       as HTMLInputElement)?.value?.trim();
            const multiPr  = (overlay.querySelector('#plug-qt-s-multi-profile') as HTMLInputElement)?.checked || false;
            const skipInt  = (overlay.querySelector('#plug-qt-s-skip-integrity') as HTMLInputElement)?.checked || false;
            const depMode  = (overlay.querySelector('#plug-qt-s-dep-mode')      as HTMLSelectElement)?.value || 'none';
            const modIds   = Array.from(overlay.querySelectorAll<HTMLInputElement>('.plug-qt-mod-check:checked')).map(c => c.value).filter(Boolean);
            const createPrefill: any = { name, multi_profile: multiPr, skip_integrity_check: skipInt, dependency_mode: depMode };
            if (desc)          createPrefill.description = desc;
            if (game)          createPrefill.game_name   = game;
            if (srLink)        createPrefill.sr_link      = srLink;
            if (modIds.length) createPrefill.mod_ids      = modIds;
            overlay.remove();
            // Navigate to Modpacks page and open native Create editor
            const modpackNavBtn = document.querySelector('.nav-item[data-view="modpacks"]') as HTMLElement | null;
            if (modpackNavBtn) modpackNavBtn.click();
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent('bmm:modpack-focus', {
                    detail: { action: 'create', prefill: createPrefill },
                }));
            }, 350);
            return;
        } else if (p === '/api/modpacks') {
            body = '';

        // ── Repo API ──────────────────────────────────────────────────────────
        } else if (p === '/api/repo/info') {
            const repoUrl = (overlay.querySelector('#plug-qt-s-repo-url') as HTMLInputElement)?.value?.trim() || '';
            if (!repoUrl) return;
            overlay.remove();
            handleQuickTest('GET', `/api/repo/info?url=${encodeURIComponent(repoUrl)}`, '');
            return;

        } else if (p === '/api/repo/list') {
            body = '';

        } else if (p === '/api/repo/connect') {
            const repoUrl  = (overlay.querySelector('#plug-qt-s-repo-url')  as HTMLInputElement)?.value?.trim() || '';
            if (!repoUrl) { toast('Entrez une URL repo.json', 'warning'); return; }
            overlay.remove();
            // Navigate to repo page and auto-fetch the repo (connect = fetch in the page)
            const repoNavBtnC = document.querySelector('.nav-item[data-view="repo"], .nav-btn[data-view="repo"]') as HTMLElement | null;
            if (repoNavBtnC) repoNavBtnC.click();
            setTimeout(() => {
                document.dispatchEvent(new CustomEvent('bmm:repo-focus', {
                    detail: { section: 'connect', prefill: { url: repoUrl } },
                }));
            }, 350);
            return;

        } else if (p === '/api/repo' && m === 'DELETE') {
            overlay.remove();
            // Navigate to repo page and clear the fetched repo (disconnect in the UI)
            const repoNavBtnD = document.querySelector('.nav-item[data-view="repo"], .nav-btn[data-view="repo"]') as HTMLElement | null;
            if (repoNavBtnD) repoNavBtnD.click();
            setTimeout(() => {
                document.dispatchEvent(new CustomEvent('bmm:repo-focus', {
                    detail: { section: 'disconnect' },
                }));
            }, 350);
            return;

        } else if (p === '/api/repo/sync') {
            const repoUrl   = (overlay.querySelector('#plug-qt-s-repo-url')    as HTMLInputElement)?.value?.trim() || '';
            const localProf = (overlay.querySelector('#plug-qt-s-local-prof')  as HTMLSelectElement)?.value?.trim() || '';
            const gameDir   = (overlay.querySelector('#plug-qt-s-game-dir')    as HTMLInputElement)?.value?.trim() || '';
            const modsDir   = (overlay.querySelector('#plug-qt-s-mods-dir')    as HTMLInputElement)?.value?.trim() || '';
            const backupDir = (overlay.querySelector('#plug-qt-s-backup-dir')  as HTMLInputElement)?.value?.trim() || '';
            const syncMode  = (overlay.querySelector('#plug-qt-s-sync-mode')   as HTMLSelectElement)?.value || 'smart';
            const dlLimitStr = (overlay.querySelector('#plug-qt-s-dl-limit')   as HTMLInputElement)?.value?.trim() || '0';
            const deleteEx  = (overlay.querySelector('#plug-qt-s-delete-extra') as HTMLInputElement)?.checked || false;
            // Collect selected repo profiles (from auto-fetch panel checkboxes)
            const checkedRepoProfIds = Array.from(overlay.querySelectorAll<HTMLInputElement>('.plug-qt-sync-prof-check:checked')).map(c => c.value).filter(Boolean);
            if (!repoUrl || !gameDir || !modsDir || !backupDir) {
                toast('url, game_dir, mods_dir et backup_dir sont obligatoires', 'warning');
                return;
            }
            // Build choices — only include if profiles were explicitly selected
            // Empty choices = let the user pick in the repo page UI (no auto-sync)
            const choices: any[] = checkedRepoProfIds.map(pid => {
                const c: any = { repoProfileId: pid };
                if (localProf) c.targetLocalProfileId = localProf;
                return c;
            });
            const syncPayload: any = {
                url: repoUrl,
                gameDir,
                modsDir,
                backupDir,
                overwriteAll: syncMode === 'all',
                deleteExtra: deleteEx,
                downloadLimit: parseInt(dlLimitStr, 10) || 0,
            };
            // Only include choices if profiles were selected (otherwise repo page handles it)
            if (choices.length > 0) syncPayload.choices = choices;
            else if (localProf) syncPayload.choices = [{ targetLocalProfileId: localProf }];
            overlay.remove();
            // Navigate to Server Repo page and pre-fill sync fields
            const repoNavBtn = document.querySelector('.nav-item[data-view="repo"], .nav-btn[data-view="repo"]') as HTMLElement | null;
            if (repoNavBtn) repoNavBtn.click();
            setTimeout(() => {
                document.dispatchEvent(new CustomEvent('bmm:repo-focus', {
                    detail: { section: 'sync', prefill: syncPayload },
                }));
            }, 350);
            return;

        } else if (p === '/api/repo/gen') {
            const profIds     = Array.from(overlay.querySelectorAll<HTMLInputElement>('.plug-qt-host-prof-check:checked')).map(c => c.value).filter(Boolean);
            const outputDir   = (overlay.querySelector('#plug-qt-s-output-dir')     as HTMLInputElement)?.value?.trim() || '';
            const author      = (overlay.querySelector('#plug-qt-s-author-name')    as HTMLInputElement)?.value?.trim() || '';
            const seed        = (overlay.querySelector('#plug-qt-s-seed')           as HTMLInputElement)?.value?.trim();
            const zipOutput   = (overlay.querySelector('#plug-qt-s-zip-output')     as HTMLInputElement)?.checked || false;
            const useCf       = (overlay.querySelector('#plug-qt-s-use-cf')         as HTMLInputElement)?.checked || false;
            const useUpnp     = (overlay.querySelector('#plug-qt-s-use-upnp')       as HTMLInputElement)?.checked || false;
            const useDocker   = (overlay.querySelector('#plug-qt-s-use-docker')     as HTMLInputElement)?.checked || false;
            const dockerOs    = (overlay.querySelector('#plug-qt-s-docker-os')      as HTMLSelectElement)?.value || 'linux';
            const srvVersion  = (overlay.querySelector('#plug-qt-s-server-version') as HTMLSelectElement)?.value || 'std';
            const autoStart   = (overlay.querySelector('#plug-qt-s-auto-start')     as HTMLInputElement)?.checked || false;
            const portStr     = (overlay.querySelector('#plug-qt-s-port')           as HTMLInputElement)?.value?.trim();
            const ulStr       = (overlay.querySelector('#plug-qt-s-upload-limit')   as HTMLInputElement)?.value?.trim();
            const adminPw     = (overlay.querySelector('#plug-qt-s-admin-pw')       as HTMLInputElement)?.value?.trim();
            if (!profIds.length || !outputDir || !author) {
                toast('Profil(s), output_dir et author_name sont obligatoires', 'warning');
                return;
            }
            const genPl: any = {
                profileIds: profIds,
                outputDir,
                authorName: author,
                generateServer: zipOutput,
                zipOutput,
                useCloudflare: useCf,
                useUpnp,
                autoStart,
            };
            if (seed)    genPl.seed          = seed;
            if (portStr) genPl.port          = parseInt(portStr, 10) || 8080;
            if (ulStr)   genPl.uploadLimit   = parseInt(ulStr, 10) || 0;
            if (adminPw) genPl.adminPassword = adminPw;
            if (useDocker) { genPl.useDocker = true; genPl.dockerOs = dockerOs; genPl.serverVersion = srvVersion; }
            overlay.remove();
            // Navigate to Server Repo page and pre-fill gen/export fields
            const repoNavBtn2 = document.querySelector('.nav-item[data-view="repo"], .nav-btn[data-view="repo"]') as HTMLElement | null;
            if (repoNavBtn2) repoNavBtn2.click();
            setTimeout(() => {
                document.dispatchEvent(new CustomEvent('bmm:repo-focus', {
                    detail: { section: 'gen', prefill: genPl },
                }));
            }, 350);
            return;

        } else if (p === '/api/repo/host') {
            const serveDir = (overlay.querySelector('#plug-qt-s-serve-dir')          as HTMLInputElement)?.value?.trim() || '';
            const portStr  = (overlay.querySelector('#plug-qt-s-http-port')          as HTMLInputElement)?.value?.trim();
            const ulStr    = (overlay.querySelector('#plug-qt-s-http-upload-limit')  as HTMLInputElement)?.value?.trim();
            if (!serveDir) { toast('serve_dir est obligatoire', 'warning'); return; }
            const hostPl: any = { serveDir };
            if (portStr) hostPl.port        = parseInt(portStr, 10) || 8080;
            if (ulStr)   hostPl.uploadLimit = parseInt(ulStr, 10) || 0;
            overlay.remove();
            // Navigate to repo page and start the server via native UI
            const repoNavBtnH = document.querySelector('.nav-item[data-view="repo"], .nav-btn[data-view="repo"]') as HTMLElement | null;
            if (repoNavBtnH) repoNavBtnH.click();
            setTimeout(() => {
                document.dispatchEvent(new CustomEvent('bmm:repo-focus', {
                    detail: { section: 'host', prefill: hostPl },
                }));
            }, 350);
            return;

        } else {
            body = (overlay.querySelector('#plug-qt-s-json') as HTMLTextAreaElement)?.value || rawBody;
        }
        overlay.remove();
        handleQuickTest(m, resolvedPath, body);
    });
}

function buildCompareContent(result: any, pluginName?: string, mode: 'compare' | 'apply' = 'apply'): string {
    const name = pluginName ?? result.plugin_name ?? '';
    const required = result.required || [];

    const nActive   = required.filter(e => e.found && e.active).length;
    const nInactive = required.filter(e => e.found && !e.active && !e.optional).length;
    const nMissing  = required.filter(e => !e.found && !e.optional).length;
    const nExtra    = (result.strict_extra || []).length;

    const rows = required.map((entry: any) => {
        let icon = IC.check, cls = 'plug-cmp-ok', st = t('plugins.cmpActive');
        if (!entry.found && !entry.optional) { icon = IC.x;   cls = 'plug-cmp-missing';  st = t('plugins.cmpMissing'); }
        else if (!entry.found && entry.optional) { icon = IC.check; cls = 'plug-cmp-optional'; st = t('plugins.optional'); }
        else if (entry.found && !entry.active)   { icon = IC.zap;   cls = 'plug-cmp-inactive'; st = t('plugins.cmpInactive'); }
        return `
            <div class="plug-cmp-row ${cls}">
                <span class="plug-cmp-icon">${icon}</span>
                <span class="plug-cmp-name">${escHtml(entry.name)}</span>
                <span class="plug-cmp-st-badge ${cls}">${st}</span>
                ${entry.optional ? `<span class="plug-cmp-opt">${t('plugins.optional')}</span>` : ''}
            </div>`;
    }).join('');

    const extraRows = (result.strict_extra || []).map((n: string) =>
        `<div class="plug-cmp-row plug-cmp-extra">
            <span class="plug-cmp-icon">${IC.x}</span>
            <span class="plug-cmp-name">${escHtml(n)}</span>
            <span class="plug-cmp-st-badge plug-cmp-extra">${t('plugins.extraMod')}</span>
        </div>`
    ).join('');

    const statsChips = [
        nActive   ? `<span class="plug-cmp-stat plug-cmp-stat-ok">${IC.check} ${nActive} ${t('plugins.cmpStatActive')}</span>` : '',
        nInactive ? `<span class="plug-cmp-stat plug-cmp-stat-warn">${IC.zap} ${nInactive} ${t('plugins.cmpStatInactive')}</span>` : '',
        nMissing  ? `<span class="plug-cmp-stat plug-cmp-stat-err">${IC.x} ${nMissing} ${t('plugins.cmpStatMissing')}</span>` : '',
        nExtra    ? `<span class="plug-cmp-stat plug-cmp-stat-extra">${IC.alert} ${nExtra} ${t('plugins.cmpStatExtra')}</span>` : '',
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

function highlightScript(code: string, format: string): string {
    const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    if (format === 'bat') {
        return code.split('\n').map(line => {
            const trimmed = line.trim().toLowerCase();
            if (trimmed.startsWith('::') || trimmed.startsWith('rem ') || trimmed === 'rem') {
                return `<span class="sh-comment">${esc(line)}</span>`;
            }
            let out = esc(line);
            out = out.replace(/\b(start|call|set|if|else|goto|for|do|in|echo|@echo|exit|pause|timeout|taskkill|cmd|powershell|where|pushd|popd|mkdir|del|copy|move)\b/gi,
                '<span class="sh-keyword">$1</span>');
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
            out = out.replace(/\b(Invoke-RestMethod|Invoke-WebRequest|Start-Process|Start-Sleep|Write-Output|Write-Host|Write-Error|param|function|if|else|elseif|foreach|for|while|return|exit|try|catch|finally|throw|New-Item|Remove-Item|Get-Content|Set-Content)\b/g,
                '<span class="sh-keyword">$1</span>');
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
            out = out.replace(/\b(Dim|Set|WScript|Shell|Run|CreateObject|MsgBox|If|Then|Else|End|For|Next|Do|Loop|While|Wend|Sub|Function|Exit|True|False|Nothing|Option Explicit)\b/gi,
                '<span class="sh-keyword">$1</span>');
            out = out.replace(/"([^"]*)"/g, '<span class="sh-string">"$1"</span>');
            out = out.replace(/(bmm:\/\/[^\s&<>"]+)/g, '<span class="sh-url">$1</span>');
            out = out.replace(/\b(\d+)\b/g, '<span class="sh-num">$1</span>');
            return out;
        }).join('\n');
    }

    if (format === 'py') {
        return code.split('\n').map(line => {
            if (line.trim().startsWith('#')) return `<span class="sh-comment">${esc(line)}</span>`;
            let out = esc(line);
            out = out.replace(/\b(import|from|def|class|if|elif|else|for|while|in|return|try|except|finally|raise|with|as|pass|break|continue|and|or|not|is|None|True|False|lambda|yield|async|await|print|open|os|subprocess|time|webbrowser|requests)\b/g,
                '<span class="sh-keyword">$1</span>');
            out = out.replace(/f?"([^"]*)"/g, '<span class="sh-string">"$1"</span>');
            out = out.replace(/f?'([^']*)'/g, `<span class="sh-string">'$1'</span>`);
            out = out.replace(/\b(\d+\.?\d*)\b/g, '<span class="sh-num">$1</span>');
            out = out.replace(/(bmm:\/\/[^\s&<>"']+)/g, '<span class="sh-url">$1</span>');
            return out;
        }).join('\n');
    }

    if (format === 'lua') {
        return code.split('\n').map(line => {
            if (line.trim().startsWith('--')) return `<span class="sh-comment">${esc(line)}</span>`;
            let out = esc(line);
            out = out.replace(/\b(local|function|end|if|then|else|elseif|for|while|do|repeat|until|return|break|in|not|and|or|nil|true|false|print|require|io|os|string|table|math)\b/g,
                '<span class="sh-keyword">$1</span>');
            out = out.replace(/"([^"]*)"/g, '<span class="sh-string">"$1"</span>');
            out = out.replace(/'([^']*)'/g, `<span class="sh-string">'$1'</span>`);
            out = out.replace(/\b(\d+\.?\d*)\b/g, '<span class="sh-num">$1</span>');
            out = out.replace(/(bmm:\/\/[^\s&<>"']+)/g, '<span class="sh-url">$1</span>');
            return out;
        }).join('\n');
    }

    if (format === 'js') {
        return code.split('\n').map(line => {
            if (line.trim().startsWith('//')) return `<span class="sh-comment">${esc(line)}</span>`;
            let out = esc(line);
            out = out.replace(/\b(const|let|var|function|async|await|return|if|else|for|while|do|break|continue|new|typeof|instanceof|class|extends|import|require|module|exports|try|catch|finally|throw|true|false|null|undefined)\b/g,
                '<span class="sh-keyword">$1</span>');
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
            if (line.trim().startsWith('#')) return `<span class="sh-comment">${esc(line)}</span>`;
            let out = esc(line);
            out = out.replace(/\b(require|def|end|do|if|elsif|else|unless|while|for|in|return|puts|print|sleep|system|nil|true|false|class|module|begin|rescue|ensure)\b/g,
                '<span class="sh-keyword">$1</span>');
            out = out.replace(/"([^"]*)"/g, '<span class="sh-string">"$1"</span>');
            out = out.replace(/'([^']*)'/g, `<span class="sh-string">'$1'</span>`);
            out = out.replace(/\b(\d+\.?\d*)\b/g, '<span class="sh-num">$1</span>');
            out = out.replace(/(bmm:\/\/[^\s&<>"']+)/g, '<span class="sh-url">$1</span>');
            return out;
        }).join('\n');
    }

    if (format === 'php') {
        return code.split('\n').map(line => {
            if (line.trim().startsWith('//') || line.trim().startsWith('#')) return `<span class="sh-comment">${esc(line)}</span>`;
            let out = esc(line);
            out = out.replace(/\b(function|if|else|while|for|foreach|return|echo|print|sleep|new|class|use|namespace|true|false|null|isset|empty)\b/g,
                '<span class="sh-keyword">$1</span>');
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
            if (line.trim().startsWith('//')) return `<span class="sh-comment">${esc(line)}</span>`;
            let out = esc(line);
            out = out.replace(/\b(package|import|func|var|const|type|struct|interface|if|else|for|range|return|go|defer|chan|map|make|new|nil|true|false|error|string|int|bool|byte|fmt)\b/g,
                '<span class="sh-keyword">$1</span>');
            out = out.replace(/"([^"]*)"/g, '<span class="sh-string">"$1"</span>');
            out = out.replace(/`([^`]*)`/g, `<span class="sh-string">\`$1\`</span>`);
            out = out.replace(/\b(\d+\.?\d*)\b/g, '<span class="sh-num">$1</span>');
            out = out.replace(/(bmm:\/\/[^\s&<>"']+)/g, '<span class="sh-url">$1</span>');
            return out;
        }).join('\n');
    }

    if (format === 'java' || format === 'cs') {
        return code.split('\n').map(line => {
            if (line.trim().startsWith('//')) return `<span class="sh-comment">${esc(line)}</span>`;
            let out = esc(line);
            out = out.replace(/\b(public|private|static|class|void|new|if|else|for|while|return|import|using|async|await|var|string|int|bool|true|false|null|System|Task|Thread|Process|Console|Runtime|File|String|HttpClient|HttpRequest)\b/g,
                '<span class="sh-keyword">$1</span>');
            out = out.replace(/"([^"]*)"/g, '<span class="sh-string">"$1"</span>');
            out = out.replace(/\b(\d+\.?\d*)\b/g, '<span class="sh-num">$1</span>');
            out = out.replace(/(bmm:\/\/[^\s&<>"']+)/g, '<span class="sh-url">$1</span>');
            return out;
        }).join('\n');
    }

    if (format === 'rs') {
        return code.split('\n').map(line => {
            if (line.trim().startsWith('//')) return `<span class="sh-comment">${esc(line)}</span>`;
            let out = esc(line);
            out = out.replace(/\b(use|fn|let|const|mut|struct|impl|trait|if|else|for|while|return|match|Some|None|Ok|Err|pub|mod|async|await|move|Box|Vec|String|str|i32|u64|bool|true|false|println|format)\b/g,
                '<span class="sh-keyword">$1</span>');
            out = out.replace(/"([^"]*)"/g, '<span class="sh-string">"$1"</span>');
            out = out.replace(/r#"([^"]*)"#/g, '<span class="sh-string">r#"$1"#</span>');
            out = out.replace(/\b(\d+\.?\d*)\b/g, '<span class="sh-num">$1</span>');
            out = out.replace(/(bmm:\/\/[^\s&<>"']+)/g, '<span class="sh-url">$1</span>');
            return out;
        }).join('\n');
    }

    return esc(code);
}

function hlJson(raw: string): string {
    const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return esc(raw)
        .replace(/("(?:[^"\\]|\\.)*")(\s*:)/g, '<span class="hlj-key">$1</span>$2')
        .replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span class="hlj-str">$1</span>')
        .replace(/:\s*(true|false)\b/g, ': <span class="hlj-bool">$1</span>')
        .replace(/:\s*(null)\b/g, ': <span class="hlj-null">$1</span>')
        .replace(/:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, ': <span class="hlj-num">$1</span>');
}

async function handleQuickTest(method: string, path: string, body?: string, btnEl?: HTMLElement) {
    const resultDiv = document.getElementById('plug-qt-result') as HTMLElement;
    const statusEl  = document.getElementById('plug-qt-status') as HTMLElement;
    const pathEl    = document.getElementById('plug-qt-path') as HTMLElement;
    const bodyEl    = document.getElementById('plug-qt-body') as HTMLElement;
    if (!resultDiv) return;

    const btnOrigHtml = btnEl?.innerHTML;
    if (btnEl) { btnEl.setAttribute('disabled', 'true'); btnEl.style.opacity = '0.6'; }

    resultDiv.style.display = 'block';
    statusEl.textContent = '...';
    statusEl.className = 'plug-tester-status';
    if (pathEl) pathEl.textContent = `${method} ${path}`;
    bodyEl.innerHTML = `<span style="color:var(--text-muted)">${t('common.loading')}</span>`;

    try {
        const opts: RequestInit = {
            method,
            headers: { 'Authorization': `Bearer ${_apiToken}`, 'Content-Type': 'application/json' },
        };
        if ((method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') && body) opts.body = body;
        const res = await fetch(`http://127.0.0.1:51274${path}`, opts);
        const text = await res.text().catch(() => '');
        let json: unknown = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
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
                (window as any)._refreshProfilesFn?.();
                (window as any)._refreshModsFn?.();
            }
            if (path.includes('/mods') && !path.includes('/modpacks')) {
                (window as any)._refreshModsFn?.();
            }
            if (path.includes('/modpacks') || path.includes('/plugins/apply')) {
                (window as any)._refreshModsFn?.();
            }
        }
    } catch (e) {
        statusEl.textContent = t('common.error');
        statusEl.className = 'plug-tester-status plug-status-err';
        bodyEl.textContent = String(e);
    } finally {
        if (btnEl && btnOrigHtml !== undefined) { btnEl.removeAttribute('disabled'); btnEl.style.opacity = ''; btnEl.innerHTML = btnOrigHtml; }
    }
}

// ── Tab: Create ────────────────────────────────────────────────────────────

function renderCreate(container: HTMLElement) {
    container.innerHTML = `
        <div class="plug-create-layout">
            <div class="plug-create-form-col">
                <h3 class="plug-section-title">${IC.list} ${t('plugins.createTitle')}</h3>
                <div class="plug-form-grid">
                    <div class="plug-form-row">
                        <label class="plug-form-label">${t('plugins.createId')} *</label>
                        <input type="text" id="pc-id" class="input" placeholder="my-server-modlist">
                    </div>
                    <div class="plug-form-row">
                        <label class="plug-form-label">${t('plugins.createName')} *</label>
                        <input type="text" id="pc-name" class="input" placeholder="My Server Mods">
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
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="plug-form-row" style="flex-direction:row;align-items:center;gap:12px;">
                        <label class="plug-form-label" style="margin:0;">${t('plugins.strictMode')}</label>
                        <label class="plug-toggle">
                            <input type="checkbox" id="pc-strict">
                            <span class="plug-toggle-slider"></span>
                        </label>
                        <span class="plug-toggle-hint" id="pc-strict-hint">${t('plugins.strictOff')}</span>
                    </div>

                    <!-- Contains external scripts -->
                    <div class="plug-form-row" style="flex-direction:row;align-items:center;gap:12px;">
                        <label class="plug-form-label" style="margin:0;">${t('plugins.pluginHasScripts') || 'Contains scripts'}</label>
                        <label class="plug-toggle">
                            <input type="checkbox" id="pc-has-scripts">
                            <span class="plug-toggle-slider"></span>
                        </label>
                        <span class="plug-toggle-hint" id="pc-has-scripts-hint">${t('plugins.pluginHasScriptsHint') || 'This plugin bundles external scripts'}</span>
                    </div>
                    <div class="plug-form-row" id="pc-scripts-row" style="display:none;">
                        <label class="plug-form-label">${t('plugins.pluginScripts') || 'Scripts'} <span style="color:var(--text-muted);font-size:10px;">(.bat .ps1 .vbs .py .js)</span></label>
                        <button class="btn btn-xs btn-ghost" id="pc-import-scripts" style="align-self:flex-start;">${IC.download} ${t('plugins.importScripts') || 'Import scripts…'}</button>
                        <div id="pc-scripts-list" class="plug-scripts-list"></div>
                        <p style="font-size:10.5px;color:var(--warning);margin:6px 0 0;display:flex;gap:6px;align-items:flex-start;line-height:1.4;">
                            ${IC.lock}<span>${t('plugins.unsafeScriptWarn') || 'Scripts run real programs on your PC. They only execute after you grant the unsafe-plugins permission and confirm.'}</span>
                        </p>
                    </div>

                    <!-- Import folders (bundled with the plugin) -->
                    <div class="plug-form-row">
                        <label class="plug-form-label">${t('plugins.pluginFolders') || 'Bundled folders'} <span style="color:var(--text-muted);font-size:10px;">${t('plugins.optional') || '(optional)'}</span></label>
                        <button class="btn btn-xs btn-ghost" id="pc-import-folders" style="align-self:flex-start;">${IC.folder} ${t('plugins.importFolders') || 'Import folder…'}</button>
                        <div id="pc-folders-list" class="plug-scripts-list"></div>
                    </div>

                    <!-- What happens on apply -->
                    <div class="plug-form-row">
                        <label class="plug-form-label">${t('plugins.applyMode') || 'On apply'}</label>
                        <select id="pc-apply-mode" class="select select-sm">
                            <option value="modlist">${t('plugins.applyModeModlist') || 'Apply mod list (default)'}</option>
                            <option value="script">${t('plugins.applyModeScript') || 'Run scripts only'}</option>
                            <option value="both">${t('plugins.applyModeBoth') || 'Apply mod list + run scripts'}</option>
                        </select>
                        <span class="plug-toggle-hint">${t('plugins.applyModeHint') || 'Choose what activating this plugin does.'}</span>
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
                        ${_allMods.length ? _allMods.map(m => `
                            <div class="plug-mod-item" data-id="${escHtml(m.id)}" data-name="${escHtml(m.name || m.id)}">
                                <span class="plug-mod-item-name">${escHtml(m.name || m.id)}</span>
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

    const selectedMods: Map<string, { name: string; optional: boolean }> = new Map();
    let iconSrcPath = '';
    let iconBuiltinSvg = ''; // SVG string when user picks a builtin icon
    const scriptPaths: string[] = []; // absolute paths of scripts to bundle

    // ── Scripts: toggle row + import ──────────────────────────────────────────
    const renderScriptsList = () => {
        const list = document.getElementById('pc-scripts-list');
        if (!list) return;
        list.innerHTML = scriptPaths.length
            ? scriptPaths.map((p, i) => {
                const fname = p.split(/[\\/]/).pop() || p;
                return `<div class="plug-script-chip"><span>${escHtml(fname)}</span><button class="plug-script-rm" data-i="${i}" data-tooltip="${t('common.remove') || 'Remove'}">${IC.x}</button></div>`;
            }).join('')
            : `<span style="font-size:11px;color:var(--text-muted);">${t('plugins.noScripts') || 'No script imported yet.'}</span>`;
        list.querySelectorAll('.plug-script-rm').forEach(b => b.addEventListener('click', () => {
            scriptPaths.splice(parseInt((b as HTMLElement).dataset.i!, 10), 1);
            renderScriptsList();
        }));
    };
    container.querySelector('#pc-has-scripts')?.addEventListener('change', (e) => {
        const on = (e.target as HTMLInputElement).checked;
        const row = document.getElementById('pc-scripts-row');
        if (row) row.style.display = on ? '' : 'none';
        const hint = document.getElementById('pc-has-scripts-hint');
        if (hint) hint.textContent = on
            ? (t('plugins.pluginHasScriptsOn') || 'Scripts will be bundled and offered on activation')
            : (t('plugins.pluginHasScriptsHint') || 'This plugin bundles external scripts');
        if (on) renderScriptsList();
    });
    container.querySelector('#pc-import-scripts')?.addEventListener('click', async () => {
        const picked = await pickFile([{ name: 'Scripts', extensions: ['bat', 'cmd', 'ps1', 'vbs', 'py', 'js', 'sh'] }]);
        if (picked) { scriptPaths.push(picked); renderScriptsList(); }
    });

    // ── Folders: import directories to bundle with the plugin ────────────────
    const folderPaths: string[] = [];
    const renderFoldersList = () => {
        const list = document.getElementById('pc-folders-list');
        if (!list) return;
        list.innerHTML = folderPaths.length
            ? folderPaths.map((p, i) => {
                const fname = p.split(/[\\/]/).filter(Boolean).pop() || p;
                return `<div class="plug-script-chip"><span>${escHtml(fname)}/</span><button class="plug-folder-rm" data-i="${i}" data-tooltip="${t('common.remove') || 'Remove'}">${IC.x}</button></div>`;
            }).join('')
            : `<span style="font-size:11px;color:var(--text-muted);">${t('plugins.noFolders') || 'No folder imported yet.'}</span>`;
        list.querySelectorAll('.plug-folder-rm').forEach(b => b.addEventListener('click', () => {
            folderPaths.splice(parseInt((b as HTMLElement).dataset.i!, 10), 1);
            renderFoldersList();
        }));
    };
    renderFoldersList();
    container.querySelector('#pc-import-folders')?.addEventListener('click', async () => {
        const dir = await pickFolder();
        if (dir) { folderPaths.push(dir); renderFoldersList(); }
    });

    // Icon tab switching
    container.querySelectorAll('.plug-icon-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            container.querySelectorAll('.plug-icon-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tab = (btn as HTMLElement).dataset.itab;
            (document.getElementById('pc-icon-tab-file') as HTMLElement).style.display = tab === 'file' ? '' : 'none';
            (document.getElementById('pc-icon-tab-builtin') as HTMLElement).style.display = tab === 'builtin' ? '' : 'none';
        });
    });

    // File icon picker
    container.querySelector('#pc-pick-icon')?.addEventListener('click', async () => {
        const p = await pickFile({ filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
        if (!p) return;
        iconSrcPath = p;
        const preview = document.getElementById('pc-icon-preview') as HTMLElement;
        if (preview) preview.innerHTML = `<img src="${convertFileSrc(p)}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
        (document.getElementById('pc-clear-icon') as HTMLElement).style.display = '';
    });
    container.querySelector('#pc-clear-icon')?.addEventListener('click', () => {
        iconSrcPath = '';
        iconBuiltinSvg = '';
        const preview = document.getElementById('pc-icon-preview') as HTMLElement;
        if (preview) preview.innerHTML = `<div class="plug-card-icon-default">${IC.puzzle}</div>`;
        (document.getElementById('pc-clear-icon') as HTMLElement).style.display = 'none';
    });

    // Builtin icon picker
    container.querySelectorAll('.plug-icon-builtin-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = (btn as HTMLElement).dataset.ickey as string;
            const svg = (IC as Record<string, string>)[key];
            if (!svg) return;
            iconSrcPath = '';       // Clear file path when using builtin
            iconBuiltinSvg = svg;   // Store SVG to send to Rust
            const preview = document.getElementById('pc-icon-preview') as HTMLElement;
            if (preview) preview.innerHTML = `<div class="plug-card-icon-default" style="color:var(--accent);">${svg}</div>`;
            container.querySelectorAll('.plug-icon-builtin-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    function updateCount() {
        const el = document.getElementById('pc-mod-count');
        if (el) el.textContent = `${selectedMods.size} ${t('plugins.modsSelected')}`;
        const hint = document.getElementById('pc-empty-hint');
        if (hint) hint.style.display = selectedMods.size ? 'none' : '';
    }

    function addMod(id: string, name: string, optional: boolean) {
        if (selectedMods.has(id)) return;
        selectedMods.set(id, { name, optional });
        const item = document.createElement('div');
        item.className = 'plug-selected-item';
        item.dataset.id = id;
        item.innerHTML = `
            <span class="plug-selected-name">${escHtml(name)}</span>
            <label class="plug-sel-opt">
                <input type="checkbox" ${optional ? 'checked' : ''}> ${t('plugins.optional')}
            </label>
            <button class="btn btn-xs btn-danger plug-sel-remove">${IC.x}</button>`;
        item.querySelector('input[type=checkbox]')?.addEventListener('change', (e) => {
            const entry = selectedMods.get(id);
            if (entry) entry.optional = (e.target as HTMLInputElement).checked;
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
        const profileId = (container.querySelector('#pc-profile-filter') as HTMLSelectElement)?.value || '';
        const q = ((container.querySelector('#pc-mod-search') as HTMLInputElement)?.value || '').toLowerCase();
        const profile = _allProfiles.find(p => p.id === profileId);
        const activeMods = new Set<string>(profile?.active_mods || []);
        container.querySelectorAll('.plug-mod-item').forEach(item => {
            const el = item as HTMLElement;
            const id = el.dataset.id || '';
            const name = el.dataset.name?.toLowerCase() || '';
            const badge = el.querySelector('.plug-mod-profile-badge') as HTMLElement | null;
            // Show badge if this mod is in the selected profile
            if (badge) badge.style.display = profileId && activeMods.has(id) ? '' : 'none';
            // Filter visibility: if a profile is selected, only show mods in that profile (OR all if no profile)
            const passesProfile = !profileId || activeMods.has(id);
            const passesSearch = !q || name.includes(q);
            el.style.display = passesProfile && passesSearch ? '' : 'none';
        });
    }

    // Profile filter
    container.querySelector('#pc-profile-filter')?.addEventListener('change', applyModFilters);

    container.querySelector('#pc-mod-search')?.addEventListener('input', applyModFilters);

    container.querySelectorAll('.plug-mod-add-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = btn.closest('.plug-mod-item') as HTMLElement;
            const id = item.dataset.id;
            const name = item.dataset.name || id;
            const opt = (item.querySelector('.plug-mod-optional-cb') as HTMLInputElement)?.checked || false;
            if (id) addMod(id, name, opt);
        });
    });

    container.querySelector('#pc-strict')?.addEventListener('change', (e) => {
        const hint = document.getElementById('pc-strict-hint');
        if (hint) hint.textContent = (e.target as HTMLInputElement).checked
            ? t('plugins.strictOn') : t('plugins.strictOff');
    });

    function buildManifest() {
        const id = (document.getElementById('pc-id') as HTMLInputElement)?.value.trim();
        const name = (document.getElementById('pc-name') as HTMLInputElement)?.value.trim();
        if (!id || !name) { toast(t('plugins.createIdNameRequired'), 'warning'); return null; }
        return {
            id, name,
            version: (document.getElementById('pc-version') as HTMLInputElement)?.value.trim() || '1.0.0',
            author: '',
            description: (document.getElementById('pc-desc') as HTMLTextAreaElement)?.value.trim() || '',
            game: (document.getElementById('pc-game') as HTMLInputElement)?.value.trim() || '',
            official: false, permissions: [], tags: [], website: '',
            has_scripts: (document.getElementById('pc-has-scripts') as HTMLInputElement)?.checked || false,
            scripts: [],
            folders: [],
            apply_mode: (document.getElementById('pc-apply-mode') as HTMLSelectElement)?.value || 'modlist',
            modlist: {
                strict: (document.getElementById('pc-strict') as HTMLInputElement)?.checked || false,
                required_mods: Array.from(selectedMods.entries()).map(([_id, { name, optional }]) => ({ name, optional, sha256: null })),
            },
        };
    }

    container.querySelector('#pc-save-local')?.addEventListener('click', async () => {
        const manifest = buildManifest();
        if (!manifest) return;
        try {
            const plugin = await invoke('create_local_plugin', {
                manifest,
                iconSrcPath: iconSrcPath || null,
                iconSvg: iconBuiltinSvg || null,
                scriptSrcPaths: scriptPaths.length ? scriptPaths : null,
                folderSrcPaths: folderPaths.length ? folderPaths : null,
            });
            _installedPlugins = _installedPlugins.filter(p => p.manifest.id !== manifest.id);
            _installedPlugins.push(plugin);
            toast(t('plugins.createSaved', { name: manifest.name }), 'success');
        } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
    });

    container.querySelector('#pc-export-bmmplug')?.addEventListener('click', async () => {
        const manifest = buildManifest();
        if (!manifest) return;
        const path = await saveFile({ defaultPath: `${manifest.id}.bmmplug`, filters: [{ name: 'BMM Plugin', extensions: ['bmmplug'] }] });
        if (!path) return;
        try {
            await invoke('create_local_plugin', {
                manifest,
                iconSrcPath: iconSrcPath || null,
                iconSvg: iconBuiltinSvg || null,
                scriptSrcPaths: scriptPaths.length ? scriptPaths : null,
                folderSrcPaths: folderPaths.length ? folderPaths : null,
            });
            await invoke('export_plugin', { pluginId: manifest.id, destPath: path });
            toast(t('plugins.exportSuccess', { name: manifest.name }), 'success');
        } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
    });
}

// ── Tab: API & Scripts ─────────────────────────────────────────────────────

function renderScripts(container: HTMLElement) {
    // Endpoints sorted strictly: GET → POST → PUT → DELETE (no method interleaving)
    const QT_ENDPOINTS = [
        // ── GET ────────────────────────────────────────────────────
        { m: 'GET',    p: '/api/health',              l: 'Health',           icon: IC.checkCircle },
        { m: 'GET',    p: '/api/status',              l: 'Status',           icon: IC.info },
        { m: 'GET',    p: '/api/check-update',        l: 'Check Update',     icon: IC.refresh },
        { m: 'GET',    p: '/api/mods',                l: 'All Mods',         icon: IC.list },
        { m: 'GET',    p: '/api/mods/active',         l: 'Active Mods',      icon: IC.check },
        { m: 'GET',    p: '/api/modpacks',            l: 'List Modpacks',    icon: IC.list },
        { m: 'GET',    p: '/api/profiles',            l: 'Profiles',         icon: IC.puzzle },
        { m: 'GET',    p: '/api/plugins',             l: 'Plugins',          icon: IC.zap },
        { m: 'GET',    p: '/api/creator-id',          l: 'Creator ID',       icon: IC.shield },
        { m: 'GET',    p: '/api/repo/info',            l: 'Repo Info',        icon: IC.info,       body: '?url=' },
        { m: 'GET',    p: '/api/repo/list',            l: 'Connected Repos',  icon: IC.list },
        // ── POST ───────────────────────────────────────────────────
        { m: 'POST',   p: '/api/mods/enable',         l: 'Enable Mod',       icon: IC.check,      body: '{"mod_id":""}' },
        { m: 'POST',   p: '/api/mods/disable',        l: 'Disable Mod',      icon: IC.x,          body: '{"mod_id":""}' },
        { m: 'POST',   p: '/api/profiles',            l: 'Create Profile',   icon: IC.plus,       body: '{"name":"","game_path":"","mods_path":"","backup_path":""}' },
        { m: 'POST',   p: '/api/profiles/activate',   l: 'Activate Profile', icon: IC.puzzle,     body: '{"profile_id":""}' },
        { m: 'POST',   p: '/api/plugins/apply',       l: 'Apply Plugin',     icon: IC.zap,        body: '{"plugin_id":"","force_strict":false}' },
        { m: 'POST',   p: '/api/plugins/compare',     l: 'Compare Plugin',   icon: IC.shield,     body: '{"plugin_id":""}' },
        { m: 'POST',   p: '/api/modpacks/enable',     l: 'Enable Modpack',   icon: IC.folder,     body: '{"modpack_id":""}' },
        { m: 'POST',   p: '/api/modpacks/disable',    l: 'Disable Modpack',  icon: IC.folder,     body: '{"modpack_id":""}' },
        { m: 'POST',   p: '/api/modpacks/create',     l: 'Create Modpack',   icon: IC.plus,       body: '{"name":"","profile_id":""}' },
        { m: 'POST',   p: '/api/restart',             l: 'Restart BMM',      icon: IC.refresh,    body: '' },
        { m: 'POST',   p: '/api/repo/connect',         l: 'Connect Repo',     icon: IC.globe,      body: '{"url":"","name":""}' },
        { m: 'POST',   p: '/api/repo/sync',            l: 'Sync Repo',        icon: IC.refresh,    body: '{}' },
        { m: 'POST',   p: '/api/repo/gen',             l: 'Gen Repo',         icon: IC.upload,     body: '{}' },
        { m: 'POST',   p: '/api/repo/host',            l: 'Host HTTP',        icon: IC.globe,      body: '{"serveDir":"C:/BMM/Export","port":8080}' },
        // ── Import / Export (UI-driven) ────────────────────────────
        { m: 'POST',   p: '/api/data/export',          l: 'Export Data',      icon: IC.upload },
        { m: 'POST',   p: '/api/data/import',          l: 'Import Data',      icon: IC.download },
        { m: 'POST',   p: '/api/modlists/export',      l: 'Export Mod List',  icon: IC.upload },
        { m: 'POST',   p: '/api/modlists/import',      l: 'Import Mod List',  icon: IC.download },
        { m: 'POST',   p: '/api/modpacks/import',      l: 'Import Modpack',   icon: IC.download },
        { m: 'POST',   p: '/api/modpacks/export',      l: 'Export Modpack',   icon: IC.upload,     body: '{"id":""}' },
        { m: 'POST',   p: '/api/plugins/import',       l: 'Import Plugin',    icon: IC.download },
        { m: 'POST',   p: '/api/plugins/export',       l: 'Export Plugin',    icon: IC.upload,     body: '{"id":""}' },
        { m: 'POST',   p: '/api/language/import',       l: 'Import Language',  icon: IC.download },
        { m: 'POST',   p: '/api/profiles/import/ovgme', l: 'Import OvGME',     icon: IC.download },
        { m: 'POST',   p: '/api/profiles/import/omm',   l: 'Import OMM/OMX',   icon: IC.download },
        // ── PUT ────────────────────────────────────────────────────
        { m: 'PUT',    p: '/api/mods/:id',            l: 'Update Mod',       icon: IC.editIcon,   body: '{"name":""}' },
        { m: 'PUT',    p: '/api/profiles/:id',        l: 'Update Profile',   icon: IC.editIcon,   body: '{"name":""}' },
        { m: 'PUT',    p: '/api/modpacks/:id',        l: 'Update Modpack',   icon: IC.editIcon,   body: '{"name":""}' },
        // ── DELETE ─────────────────────────────────────────────────
        { m: 'DELETE', p: '/api/repo/sync/cancel',     l: 'Cancel Sync',      icon: IC.x },
        { m: 'DELETE', p: '/api/repo/gen/cancel',      l: 'Cancel Gen',       icon: IC.x },
        { m: 'DELETE', p: '/api/repo/host',            l: 'Stop Host',        icon: IC.x },
        { m: 'DELETE', p: '/api/repo',                 l: 'Disconnect Repo',  icon: IC.trash,      body: '{"url":""}' },
        { m: 'DELETE', p: '/api/mods/:id',            l: 'Delete Mod',       icon: IC.trash },
        { m: 'DELETE', p: '/api/profiles/:id',        l: 'Delete Profile',   icon: IC.trash },
        { m: 'DELETE', p: '/api/modpacks/:id',        l: 'Delete Modpack',   icon: IC.trash },
    ];

    container.innerHTML = `
        <div class="plug-scripts-root">

            <!-- Token -->
            <div class="plug-section-card plug-token-card">
                <div class="plug-token-card-top">
                    <h3 class="plug-section-title" style="margin:0;">${IC.lock} ${t('plugins.apiToken')}</h3>
                    <span class="plug-api-hint">${IC.info} ${t('plugins.apiHint')} <code id="plug-api-base-url" class="plug-api-url-copy" data-tooltip="${t('plugins.copyApiUrl')}">http://127.0.0.1:51274/api/</code></span>
                </div>
                <div class="plug-token-row">
                    <input type="password" id="plug-token-display" class="input plug-token-input" readonly value="${escHtml(_apiToken)}">
                    <button class="btn btn-xs btn-ghost" id="plug-token-eye" data-tooltip="${t('plugins.showToken')}">${IC.eye}</button>
                    <button class="btn btn-sm btn-ghost" id="plug-copy-token">${IC.copy} ${t('common.copy')}</button>
                    <button class="btn btn-sm btn-danger" id="plug-reset-token">${IC.refresh} ${t('plugins.resetToken')}</button>
                </div>
            </div>

            <!-- Quick test + endpoints (full width) -->
            <div class="plug-section-card">
                <h3 class="plug-section-title">${IC.zap} ${t('plugins.quickTest')}</h3>
                <div class="plug-qt-search-row">
                    <span class="plug-qt-search-ic">${IC.search || ''}</span>
                    <input type="text" id="plug-qt-search" class="input input-sm plug-qt-search-input"
                        placeholder="${t('plugins.quickTestSearch') || 'Search quick tests… (GET, /api/mods, modpack…)'}" spellcheck="false">
                    <button class="btn btn-xs btn-ghost" id="plug-qt-search-clear" data-tooltip="${t('common.clear') || 'Clear'}" style="display:none;">${IC.x}</button>
                    <span class="plug-qt-search-count" id="plug-qt-search-count"></span>
                </div>
                <div class="plug-qt-grid">
                    ${(() => {
                        let lastMethod = '';
                        return QT_ENDPOINTS.map(e => {
                            const mc = e.m.toLowerCase();
                            const badge = `<span class="plug-qt-method-badge plug-qt-${mc}">${e.m}</span>`;
                            const body       = (e as any).body !== undefined ? ` data-body="${escHtml((e as any).body || '')}"` : '';
                            const nav        = (e as any).navigate ? ` data-navigate="${(e as any).navigate}"` : '';
                            const autoLaunch = (e as any).autoLaunch ? ` data-auto-launch="${(e as any).autoLaunch}"` : '';
                            let sep = '';
                            if (e.m !== lastMethod) {
                                lastMethod = e.m;
                                sep = `<div class="plug-qt-method-sep"><span class="plug-qt-sep-label plug-qt-${mc}">${e.m}</span></div>`;
                            }
                            // navigate-type buttons get a distinct visual hint
                            const navHint = (e as any).navigate ? ` <span style="font-size:9px;opacity:.6;vertical-align:middle;">↗ UI</span>` : '';
                            return sep + `<button class="plug-qt-btn" data-method="${e.m}" data-path="${e.p}"${body}${nav}${autoLaunch} data-tooltip="${e.m} ${e.p}">
                                ${e.icon} <span>${e.l}</span>${navHint}${badge}
                            </button>`;
                        }).join('');
                    })()}
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
                <div class="plug-endpoint-list" id="plug-ep-list">
                    ${(() => {
                        const defs = getEndpointDefs();
                        // Sort by method: GET → POST → PUT → DELETE → PATCH
                        const methodOrder: Record<string, number> = { GET: 0, POST: 1, PUT: 2, DELETE: 3, PATCH: 4 };
                        defs.sort((a, b) => (methodOrder[a.method] ?? 9) - (methodOrder[b.method] ?? 9));
                        defs.forEach(ep => {
                            const sid = (ep.method.toLowerCase() + '_' + ep.path).replace(/\//g, '_').replace(/^_/, '').replace(/:/g, '');
                            _epCodeCache.set(sid, ep);
                        });
                        let lastMethod = '';
                        const methodCls: Record<string, string> = { GET: 'plug-method-get', POST: 'plug-method-post', PUT: 'plug-method-put', DELETE: 'plug-method-delete', PATCH: 'plug-method-patch' };
                        return defs.map(ep => {
                            let header = '';
                            if (ep.method !== lastMethod) {
                                lastMethod = ep.method;
                                const cls = methodCls[ep.method] || '';
                                header = `<div class="plug-ep-group-header"><span class="plug-method ${cls}" style="font-size:11px;">${ep.method}</span><span class="plug-ep-group-count">${defs.filter(d => d.method === ep.method).length} endpoint${defs.filter(d => d.method === ep.method).length > 1 ? 's' : ''}</span></div>`;
                            }
                            return header + buildEndpointRow(ep);
                        }).join('');
                    })()}
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
        const inp = document.getElementById('plug-token-display') as HTMLInputElement;
        inp.type = inp.type === 'password' ? 'text' : 'password';
    });
    container.querySelector('#plug-copy-token')?.addEventListener('click', async () => {
        await navigator.clipboard.writeText(_apiToken).catch(() => {});
        toast(t('plugins.tokenCopied'), 'success');
        dispatchBmmAction(BMM_ACTIONS.API_TOKEN_COPIED);
    });
    container.querySelector('#plug-reset-token')?.addEventListener('click', handleResetToken);

    // API base URL copy on click
    container.querySelector('#plug-api-base-url')?.addEventListener('click', async () => {
        await navigator.clipboard.writeText('http://127.0.0.1:51274/api/').catch(() => {});
        toast(t('plugins.epCopyDone'), 'success');
    });

    // Quick test
    container.querySelectorAll('.plug-qt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const el = btn as HTMLElement;
            const m = el.dataset.method || 'GET';
            const p = el.dataset.path || '/api/health';
            const rawBody = el.dataset.body;
            const navTarget = el.dataset.navigate;

            // Navigate buttons: open the corresponding BMM page instead of calling API
            if (navTarget) {
                const navBtn = document.querySelector(`.nav-item[data-view="${navTarget}"], .nav-btn[data-view="${navTarget}"]`) as HTMLElement;
                if (navBtn) navBtn.click();
                // Dispatch auto-launch event so the target page can focus the right section
                const autoLaunch = el.dataset.autoLaunch;
                if (autoLaunch) {
                    setTimeout(() => {
                        document.dispatchEvent(new CustomEvent('bmm:repo-focus', { detail: { section: autoLaunch } }));
                    }, 350);
                }
                return;
            }

            // Every endpoint opens the quick-config overlay: it lets the user
            // fill parameters, Send, AND copy the ready-to-use cURL — even for
            // parameterless GETs (which show just the Send / Copy cURL footer).
            openSmartQuickTest(m, p, rawBody ?? '');
        });
    });
    container.querySelector('#plug-qt-copy')?.addEventListener('click', () => {
        const txt = document.getElementById('plug-qt-body')?.textContent || '';
        navigator.clipboard.writeText(txt).catch(() => {});
        toast(t('common.copy'), 'success');
    });

    // ── Endpoint search bar — filters the quick-test buttons live ──────────────
    const qtSearch    = container.querySelector('#plug-qt-search')       as HTMLInputElement | null;
    const qtSearchClr = container.querySelector('#plug-qt-search-clear') as HTMLElement | null;
    const qtCount     = container.querySelector('#plug-qt-search-count') as HTMLElement | null;
    const applyEpFilter = () => {
        const q = (qtSearch?.value || '').trim().toLowerCase();
        const btns = Array.from(container.querySelectorAll<HTMLElement>('.plug-qt-btn'));
        let shown = 0;
        btns.forEach(b => {
            const hay = `${b.dataset.method || ''} ${b.dataset.path || ''} ${b.textContent || ''}`.toLowerCase();
            const match = !q || hay.includes(q);
            b.style.display = match ? '' : 'none';
            if (match) shown++;
        });
        // Hide method separators while searching (they break up a filtered list)
        container.querySelectorAll<HTMLElement>('.plug-qt-method-sep').forEach(s => {
            s.style.display = q ? 'none' : '';
        });
        if (qtSearchClr) qtSearchClr.style.display = q ? '' : 'none';
        if (qtCount) qtCount.textContent = q ? `${shown}/${btns.length}` : '';
    };
    qtSearch?.addEventListener('input', applyEpFilter);
    qtSearchClr?.addEventListener('click', () => { if (qtSearch) { qtSearch.value = ''; applyEpFilter(); qtSearch.focus(); } });

    // ── Available-endpoints search bar — filters the documented endpoint rows ──
    const epSearch    = container.querySelector('#plug-ep-search')       as HTMLInputElement | null;
    const epSearchClr = container.querySelector('#plug-ep-search-clear') as HTMLElement | null;
    const epCount     = container.querySelector('#plug-ep-search-count') as HTMLElement | null;
    const epList      = container.querySelector('#plug-ep-list')         as HTMLElement | null;
    const applyEndpointFilter = () => {
        if (!epList) return;
        const q = (epSearch?.value || '').trim().toLowerCase();
        const rows = Array.from(epList.querySelectorAll<HTMLElement>('.plug-ep-wrap'));
        let shown = 0;
        rows.forEach(w => {
            const row = w.querySelector('.plug-endpoint-row') as HTMLElement | null;
            const method = row?.dataset.method || '';
            const path   = row?.dataset.path || '';
            const desc   = (w.querySelector('.plug-endpoint-desc')?.textContent || '');
            const hay = `${method} ${path} ${desc}`.toLowerCase();
            const match = !q || hay.includes(q);
            w.style.display = match ? '' : 'none';
            if (match) shown++;
        });
        // Hide method group headers while searching (a filtered list spans groups)
        epList.querySelectorAll<HTMLElement>('.plug-ep-group-header').forEach(h => {
            h.style.display = q ? 'none' : '';
        });
        if (epSearchClr) epSearchClr.style.display = q ? '' : 'none';
        if (epCount) epCount.textContent = q ? `${shown}/${rows.length}` : '';
    };
    epSearch?.addEventListener('input', applyEndpointFilter);
    epSearchClr?.addEventListener('click', () => { if (epSearch) { epSearch.value = ''; applyEndpointFilter(); epSearch.focus(); } });

    // ── API activity log panel — disk-backed, rendered incrementally ───────────
    // The full history is kept on disk (read_api_log / append_api_log). The panel
    // loads the last N on open and then PREPENDS one row per event (no full
    // re-render), capping the DOM so it never lags regardless of total volume.
    const apiLogList  = container.querySelector('#plug-api-log-list')  as HTMLElement | null;
    const apiLogCount = container.querySelector('#plug-api-log-count') as HTMLElement | null;
    const API_LOG_DOM_CAP = 200;   // max rows kept in the DOM
    const API_LOG_LOAD    = 100;   // how many to load from disk on open
    const _rowHtml = (e: any): string => {
        const time = e.time ? new Date(e.time).toLocaleTimeString() : '';
        const cls  = e.ok ? 'ok' : 'err';
        const mc   = String(e.method || '').toLowerCase();
        return `<div class="plug-api-log-row plug-api-log-${cls}">
            <span class="plug-api-log-time">${time}</span>
            <span class="plug-qt-method-badge plug-qt-${mc}">${escHtml(e.method || '')}</span>
            <span class="plug-api-log-ic">${e.icon || ''}</span>
            <span class="plug-api-log-label">${escHtml(e.label || e.path || '')}</span>
            <span class="plug-api-log-status">${escHtml(String(e.status ?? ''))}</span>
        </div>`;
    };
    const _setLogCount = () => {
        if (!apiLogList || !apiLogCount) return;
        const n = apiLogList.querySelectorAll('.plug-api-log-row').length;
        apiLogCount.textContent = n ? String(n) : '';
    };
    const _emptyLog = () => {
        if (apiLogList) apiLogList.innerHTML = `<div class="plug-api-log-empty">${t('plugins.apiActivityLogEmpty') || 'No API activity yet.'}</div>`;
        if (apiLogCount) apiLogCount.textContent = '';
    };
    // Load recent history from disk (newest first in the DOM).
    const loadApiLogFromDisk = async () => {
        if (!apiLogList) return;
        try {
            const lines = (await invoke('read_api_log', { limit: API_LOG_LOAD })) as string[];
            if (!lines || !lines.length) { _emptyLog(); return; }
            const rows = lines.map(l => { try { return _rowHtml(JSON.parse(l)); } catch { return ''; } });
            apiLogList.innerHTML = rows.reverse().join('') || '';
            if (!apiLogList.querySelector('.plug-api-log-row')) _emptyLog();
            _setLogCount();
        } catch { _emptyLog(); }
    };
    loadApiLogFromDisk();
    // Incremental: prepend the single new entry, then trim the DOM.
    const onApiActivity = (ev: Event) => {
        if (!apiLogList) return;
        const e = (ev as CustomEvent).detail;
        if (!e) return;
        apiLogList.querySelector('.plug-api-log-empty')?.remove();
        apiLogList.insertAdjacentHTML('afterbegin', _rowHtml(e));
        const rows = apiLogList.querySelectorAll('.plug-api-log-row');
        for (let i = rows.length - 1; i >= API_LOG_DOM_CAP; i--) rows[i].remove();
        _setLogCount();
    };
    // Avoid handler accumulation across page re-renders.
    if ((window as any).__bmmApiLogHandler) document.removeEventListener('bmm:api-activity', (window as any).__bmmApiLogHandler);
    (window as any).__bmmApiLogHandler = onApiActivity;
    document.addEventListener('bmm:api-activity', onApiActivity);
    container.querySelector('#plug-api-log-clear')?.addEventListener('click', async () => {
        (window as any).__bmmApiLog = [];
        try { await invoke('clear_api_log'); } catch { /* ignore */ }
        _emptyLog();
    });

    // Custom tester
    container.querySelector('#pt-run')?.addEventListener('click', handleApiTest);
    container.querySelector('#pt-copy-resp')?.addEventListener('click', () => {
        const txt = document.getElementById('pt-resp-body')?.textContent || '';
        navigator.clipboard.writeText(txt).catch(() => {});
        toast(t('common.copy'), 'success');
    });

    // Helper: prefill custom tester from endpoint
    function prefillTester(method: string, path: string) {
        const details   = document.getElementById('plug-custom-tester') as HTMLDetailsElement;
        const methodSel = document.getElementById('pt-method') as HTMLSelectElement;
        const pathInp   = document.getElementById('pt-path')   as HTMLInputElement;
        const bodyTa    = document.getElementById('pt-body')    as HTMLTextAreaElement;
        if (details) details.open = true;
        methodSel.value = method;
        pathInp.value   = path;
        const bodyHints: Record<string, string> = {
            // POST / PUT
            '/api/mods/enable':      '{\n  "mod_id": ""\n}',
            '/api/mods/disable':     '{\n  "mod_id": ""\n}',
            '/api/mods/:id':         '{\n  "name": ""\n}',
            '/api/profiles/activate':'{\n  "profile_id": ""\n}',
            '/api/profiles':         '{\n  "name": "",\n  "game_path": "",\n  "mods_path": "",\n  "backup_path": ""\n}',
            '/api/profiles/:id':     '{\n  "name": ""\n}',
            '/api/plugins/compare':  '{\n  "plugin_id": ""\n}',
            '/api/plugins/apply':    '{\n  "plugin_id": "",\n  "force_strict": false\n}',
            '/api/modpacks/enable':  '{\n  "modpack_id": ""\n}',
            '/api/modpacks/disable': '{\n  "modpack_id": ""\n}',
            '/api/modpacks/create':  '{\n  "name": "",\n  "description": "",\n  "game_name": "",\n  "sr_link": "",\n  "multi_profile": false,\n  "skip_integrity_check": false,\n  "dependency_mode": "none",\n  "mod_ids": []\n}',
            '/api/modpacks/:id':     '{\n  "name": "",\n  "description": "",\n  "game_name": "",\n  "sr_link": "",\n  "multi_profile": false,\n  "skip_integrity_check": false,\n  "dependency_mode": "none",\n  "mod_ids": []\n}',
            '/api/restart':          '',
            '/api/repo/connect':     '{\n  "url": "https://monserveur.com/repo.json",\n  "name": "Mon Serveur"\n}',
            // camelCase — Rust backend uses #[serde(rename_all = "camelCase")]
            '/api/repo/sync':        '{\n  "url": "https://monserveur.com/repo.json",\n  "gameDir": "C:/Games/MonJeu",\n  "modsDir": "C:/Games/MonJeu/Mods",\n  "backupDir": "C:/BMM/Backups",\n  "choices": [{ "repoProfileId": "prof-uuid" }],\n  "overwriteAll": false,\n  "deleteExtra": false,\n  "downloadLimit": 0\n}',
            '/api/repo/gen':         '{\n  "profileIds": ["prof-uuid"],\n  "outputDir": "C:/BMM/Export",\n  "authorName": "MonPseudo",\n  "generateServer": false,\n  "zipOutput": false,\n  "useCloudflare": false,\n  "useUpnp": false,\n  "useDocker": false,\n  "dockerOs": "linux",\n  "serverVersion": "std",\n  "autoStart": false,\n  "port": 8080,\n  "uploadLimit": 0,\n  "adminPassword": ""\n}',
            '/api/repo/host':        '{\n  "serveDir": "C:/BMM/Export",\n  "port": 8080,\n  "uploadLimit": 0\n}',
            // DELETE routes that carry a body
            '/api/repo':             '{\n  "url": "https://monserveur.com/repo.json"\n}',
        };
        // Show body hint if one exists (even for DELETE — some routes need a body)
        const hint = bodyHints[path];
        if (hint) {
            bodyTa.value = hint;
        } else if (method === 'GET' || method === 'DELETE') {
            bodyTa.value = '';
        } else {
            bodyTa.value = bodyHints[path] ?? '';
        }
        details.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        details.classList.add('plug-tester-highlight');
        setTimeout(() => details.classList.remove('plug-tester-highlight'), 900);
    }

    // ── Endpoint area click handler — stored to prevent accumulation on re-render ──
    if (_scriptClickHandler) container.removeEventListener('click', _scriptClickHandler);
    _scriptClickHandler = (e: Event) => {
        const tgt = (e as MouseEvent).target as HTMLElement;
        // Scroll arrow buttons for lang tabs
        const scrollBtn = tgt.closest('.plug-ep-scroll-btn') as HTMLElement | null;
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
        const prefillBtn = tgt.closest('.plug-ep-prefill-btn') as HTMLElement | null;
        if (prefillBtn) {
            e.stopPropagation();
            prefillTester(prefillBtn.dataset.method || 'GET', prefillBtn.dataset.path || '');
            return;
        }
        // Copy URL button (handled by its own listener below)
        if (tgt.closest('.plug-ep-copy-btn')) return;
        // Copy response body button
        const copyRespBtn = tgt.closest('.plug-ep-copy-resp-btn') as HTMLElement | null;
        if (copyRespBtn) {
            e.stopPropagation();
            const body = copyRespBtn.dataset.body || '';
            navigator.clipboard.writeText(body).catch(() => {});
            toast(t('plugins.epCopyDone'), 'success');
            return;
        }
        // Copy code button
        const copyCodeBtn = tgt.closest('.plug-ep-copy-code-btn') as HTMLElement | null;
        if (copyCodeBtn) {
            e.stopPropagation();
            const epid = copyCodeBtn.dataset.epid || '';
            const pre = document.getElementById(`epc-${epid}`);
            const activeTab = copyCodeBtn.closest('.plug-ep-code-tabs')?.querySelector('.plug-ep-code-tab.active') as HTMLElement | null;
            const lang = activeTab?.dataset.lang || 'curl';
            const ep = _epCodeCache.get(epid);
            const rawText = ep ? (() => {
                const div = document.createElement('div');
                div.innerHTML = _genCode(ep, lang);
                return div.textContent || '';
            })() : (pre?.textContent || '');
            // For curl and ps1 → collapse multi-line to a single terminal-ready command
            const text = _toClipboardLine(rawText, lang);
            navigator.clipboard.writeText(text).catch(() => {});
            toast(t('plugins.epCopyDone'), 'success');
            return;
        }
        // Language tab switch
        const codeTab = tgt.closest('.plug-ep-code-tab') as HTMLElement | null;
        if (codeTab && codeTab.dataset.lang) {
            e.stopPropagation();
            const epid = codeTab.closest('.plug-ep-code-tabs')?.getAttribute('data-epid') || '';
            codeTab.closest('.plug-ep-lang-tabs-scroll')?.querySelectorAll('.plug-ep-code-tab').forEach(t2 => t2.classList.remove('active'));
            codeTab.classList.add('active');
            const lang = codeTab.dataset.lang;
            const pre = document.getElementById(`epc-${epid}`);
            if (pre) {
                const ep = _epCodeCache.get(epid);
                if (ep) pre.innerHTML = _genCode(ep, lang);
            }
            return;
        }
        // Chevron or row → toggle expand
        const row = tgt.closest('.plug-endpoint-row') as HTMLElement | null;
        if (!row) return;
        const epId = row.dataset.epId || '';
        const wrap = document.getElementById(`epw-${epId}`);
        const detail = document.getElementById(`epd-${epId}`);
        const chev  = document.getElementById(`epchev-${epId}`);
        if (!wrap || !detail) return;
        const isOpen = wrap.classList.contains('expanded');
        wrap.classList.toggle('expanded', !isOpen);
        detail.style.display = isOpen ? 'none' : 'grid';
        if (chev) chev.classList.toggle('rotated', !isOpen);
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
    container.addEventListener('wheel', (e: WheelEvent) => {
        const scrollEl = (e.target as HTMLElement).closest('.plug-ep-lang-tabs-scroll') as HTMLElement | null;
        if (!scrollEl) return;
        e.preventDefault();
        scrollEl.scrollLeft += e.deltaY !== 0 ? e.deltaY : e.deltaX;
    }, { passive: false });

    // Endpoint URL copy buttons (url path copy OR bmm:// deeplink copy)
    container.querySelectorAll('.plug-ep-copy-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const val = (btn as HTMLElement).dataset.copy || '';
            // bmm:// deeplinks are copied as-is; API paths get the base URL prepended
            const full = val.startsWith('bmm://') ? val : `http://127.0.0.1:51274${val}`;
            await navigator.clipboard.writeText(full).catch(() => {});
            toast(t('plugins.epCopyDone'), 'success');
        });
    });

    // Mode hint update
    container.querySelector('#plug-gen-mode')?.addEventListener('change', (e) => {
        const mode = (e.target as HTMLSelectElement).value;
        const hint = document.getElementById('plug-mode-hint');
        if (hint) hint.textContent = t(mode === 'api' ? 'plugins.modeApiHint' : 'plugins.modeDeeplinkHint');
    });

    // Token env toggle
    container.querySelector('#plug-gen-use-env')?.addEventListener('change', (e) => {
        const useEnv = (e.target as HTMLInputElement).checked;
        const hint = document.getElementById('plug-gen-token-hint');
        if (hint) hint.textContent = t(useEnv ? 'plugins.genTokenEnvOn' : 'plugins.genTokenEnvOff');
    });

    // Script gen
    container.querySelector('#plug-add-action')?.addEventListener('click', (e) => {
        _openActionPicker(e.currentTarget as HTMLElement);
    });
    container.querySelector('#plug-gen-preview')?.addEventListener('click', handlePreviewScript);
    container.querySelector('#plug-gen-save')?.addEventListener('click', handleSaveScript);
    container.querySelector('#plug-gen-zip')?.addEventListener('click', handleSaveScriptZip);
    container.querySelector('#plug-copy-script')?.addEventListener('click', async () => {
        const codeEl = document.getElementById('plug-gen-code');
        const raw = codeEl?.dataset.raw || codeEl?.textContent || '';
        await navigator.clipboard.writeText(raw).catch(() => {});
        toast(t('common.copy'), 'success');
    });

    _actionDndInstalled = false; // container was re-rendered → re-arm DnD
    _ensureActionDnd();
    addActionRow();
}

interface FieldDef { name: string; type: string; required: boolean; desc: string; }
interface RespStatus { code: number; label: string; body: string; }
interface EndpointDef {
    method: string;
    path: string;
    desc: string;
    auth: boolean;
    about: string;
    fields: FieldDef[] | null;
    responseStatuses: RespStatus[];
}

// ── Code syntax highlighter (multi-language, placeholder-safe) ───────────
// Uses a placeholder approach: strings/comments are extracted first as \x00N\x00
// tokens so that keyword/URL regexes never accidentally match inside HTML attribute
// values added by earlier passes. Tokens are restored last as styled spans.
function hlCode(raw: string, lang: string): string {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let h = esc(raw);

    const slots: string[] = [];
    const slot = (html: string) => { const i = slots.length; slots.push(html); return `\x00${i}\x00`; };
    const unslot = (s: string) => s.replace(/\x00(\d+)\x00/g, (_, i) => slots[+i]);

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
function _genCode(ep: EndpointDef, lang: string): string {
    const url = `http://127.0.0.1:51274${ep.path}`;
    const isGet = ep.method === 'GET';
    const bodyObj = ep.fields
        ? Object.fromEntries(ep.fields.map(f => [f.name, f.type === 'boolean' ? false : f.type === 'number' ? 0 : '']))
        : {};
    const bodyJson = JSON.stringify(bodyObj, null, 2);
    const authToken = 'YOUR_TOKEN';

    let code = '';
    switch (lang) {
        case 'curl': code = _curlEx(ep); break;
        case 'ps1':  code = _ps1Ex(ep);  break;
        case 'js':
            if (isGet) {
                code = `const resp = await fetch("${url}"${ep.auth ? `,\n  { headers: { Authorization: "Bearer ${authToken}" } }` : ''});\nconst data = await resp.json();\nconsole.log(data);`;
            } else {
                code = `const resp = await fetch("${url}", {\n  method: "POST",\n  headers: {\n    "Content-Type": "application/json"${ep.auth ? `,\n    Authorization: "Bearer ${authToken}"` : ''}\n  },\n  body: JSON.stringify(${bodyJson})\n});\nconst data = await resp.json();\nconsole.log(data);`;
            }
            break;
        case 'python':
            if (isGet) {
                code = `import requests\n\n${ep.auth ? `headers = {"Authorization": "Bearer ${authToken}"}\n` : ''}resp = requests.get("${url}"${ep.auth ? ', headers=headers' : ''})\nprint(resp.json())`;
            } else {
                const pyBody = bodyJson.replace(/true/g,'True').replace(/false/g,'False').replace(/null/g,'None');
                code = `import requests\n\nbody = ${pyBody}\nheaders = {"Content-Type": "application/json"${ep.auth ? `, "Authorization": "Bearer ${authToken}"` : ''}}\nresp = requests.post("${url}", json=body, headers=headers)\nprint(resp.json())`;
            }
            break;
        case 'lua':
            if (isGet) {
                code = `local http = require("socket.http")\nlocal body, code = http.request("${url}")\nprint(code, body)`;
            } else {
                code = `local http  = require("socket.http")\nlocal ltn12 = require("ltn12")\nlocal payload = '${bodyJson.replace(/\n/g,'').replace(/'/g,"\\'")}'
local t = {}\nhttp.request({\n  url    = "${url}",\n  method = "POST",\n  headers = {\n    ["Content-Type"] = "application/json"${ep.auth ? `,\n    Authorization = "Bearer ${authToken}"` : ''},\n    ["Content-Length"] = #payload\n  },\n  source = ltn12.source.string(payload),\n  sink   = ltn12.sink.table(t)\n})\nprint(table.concat(t))`;
            }
            break;
        case 'go':
            if (isGet) {
                code = `resp, _ := http.Get("${url}")\ndefer resp.Body.Close()\nbody, _ := io.ReadAll(resp.Body)\nfmt.Println(string(body))`;
            } else {
                code = `payload := []byte(\`${bodyJson}\`)\nreq, _ := http.NewRequest("POST", "${url}", bytes.NewBuffer(payload))\nreq.Header.Set("Content-Type", "application/json")${ep.auth ? `\nreq.Header.Set("Authorization", "Bearer ${authToken}")` : ''}\nclient := &http.Client{}\nresp, _ := client.Do(req)\nbody, _ := io.ReadAll(resp.Body)\nfmt.Println(string(body))`;
            }
            break;
        case 'rust':
            if (isGet) {
                code = `let resp = reqwest::get("${url}").await?;\nlet json: serde_json::Value = resp.json().await?;\nprintln!("{:#?}", json);`;
            } else {
                code = `let client = reqwest::Client::new();\nlet resp = client.post("${url}")\n    .header("Content-Type", "application/json")${ep.auth ? `\n    .bearer_auth("${authToken}")` : ''}\n    .json(&serde_json::json!(${bodyJson}))\n    .send().await?;\nprintln!("{}", resp.text().await?);`;
            }
            break;
        case 'java':
            if (isGet) {
                code = `HttpClient client = HttpClient.newHttpClient();\nHttpRequest req = HttpRequest.newBuilder()\n    .uri(URI.create("${url}"))${ep.auth ? `\n    .header("Authorization", "Bearer ${authToken}")` : ''}\n    .GET().build();\nHttpResponse<String> resp =\n    client.send(req, BodyHandlers.ofString());\nSystem.out.println(resp.body());`;
            } else {
                const jBody = bodyJson.replace(/"/g, '\\"').replace(/\n/g,'\\n');
                code = `HttpClient client = HttpClient.newHttpClient();\nString body = "${jBody}";\nHttpRequest req = HttpRequest.newBuilder()\n    .uri(URI.create("${url}"))\n    .header("Content-Type", "application/json")${ep.auth ? `\n    .header("Authorization", "Bearer ${authToken}")` : ''}\n    .POST(BodyPublishers.ofString(body))\n    .build();\nHttpResponse<String> resp =\n    client.send(req, BodyHandlers.ofString());\nSystem.out.println(resp.body());`;
            }
            break;
        case 'cs':
            if (isGet) {
                code = `using var client = new HttpClient();\n${ep.auth ? `client.DefaultRequestHeaders.Add(\n    "Authorization", "Bearer ${authToken}");\n` : ''}var resp = await client.GetStringAsync(\n    "${url}");\nConsole.WriteLine(resp);`;
            } else {
                const fields = ep.fields?.map(f => `${f.name} = ${f.type === 'boolean' ? 'false' : f.type === 'number' ? '0' : '""'}`).join(', ') || '';
                code = `using var client = new HttpClient();\n${ep.auth ? `client.DefaultRequestHeaders.Add(\n    "Authorization", "Bearer ${authToken}");\n` : ''}var body = JsonContent.Create(new { ${fields} });\nvar resp = await client.PostAsync(\n    "${url}", body);\nConsole.WriteLine(\n    await resp.Content.ReadAsStringAsync());`;
            }
            break;
        case 'php':
            if (isGet) {
                code = `<?php\n$ch = curl_init("${url}");\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);${ep.auth ? `\ncurl_setopt($ch, CURLOPT_HTTPHEADER,\n    ["Authorization: Bearer ${authToken}"]);` : ''}\n$resp = curl_exec($ch);\necho $resp;`;
            } else {
                code = `<?php\n$body = json_encode(${JSON.stringify(bodyObj)});\n$ch = curl_init("${url}");\ncurl_setopt($ch, CURLOPT_POST, true);\ncurl_setopt($ch, CURLOPT_POSTFIELDS, $body);\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\ncurl_setopt($ch, CURLOPT_HTTPHEADER, [\n    "Content-Type: application/json"${ep.auth ? `,\n    "Authorization: Bearer ${authToken}"` : ''}\n]);\n$resp = curl_exec($ch);\necho $resp;`;
            }
            break;
        case 'ruby':
            if (isGet) {
                code = `require "net/http"\n\nuri = URI("${url}")\nreq = Net::HTTP::Get.new(uri)${ep.auth ? `\nreq["Authorization"] = "Bearer ${authToken}"` : ''}\nputs Net::HTTP.start(uri.host, uri.port) { |h|\n  h.request(req).body\n}`;
            } else {
                code = `require "net/http"\nrequire "json"\n\nuri = URI("${url}")\nreq = Net::HTTP::Post.new(uri)\nreq["Content-Type"] = "application/json"${ep.auth ? `\nreq["Authorization"] = "Bearer ${authToken}"` : ''}\nreq.body = ${JSON.stringify(bodyObj)}.to_json\nputs Net::HTTP.start(uri.host, uri.port) { |h|\n  h.request(req).body\n}`;
            }
            break;
        default: code = _curlEx(ep);
    }
    return hlCode(code, lang);
}

function _curlEx(ep: EndpointDef): string {
    const url = `http://127.0.0.1:51274${ep.path}`;
    const authH = ep.auth ? `\n  -H "Authorization: Bearer $TOKEN" \\` : '';
    if (ep.method === 'GET') {
        return `curl${ep.auth ? ` \\\n  -H "Authorization: Bearer $TOKEN"` : ''} \\\n  "${url}"`;
    }
    const body = ep.fields
        ? JSON.stringify(Object.fromEntries(ep.fields.map(f => [f.name, f.type === 'boolean' ? false : f.type === 'number' ? 0 : ''])), null, 2)
        : '{}';
    return `curl -X POST \\\n  -H "Content-Type: application/json" \\${authH}\n  -d '${body}' \\\n  "${url}"`;
}

function _ps1Ex(ep: EndpointDef): string {
    const url = `http://127.0.0.1:51274${ep.path}`;
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
function _toClipboardLine(text: string, lang: string): string {
    // Goal: produce a single-line command that pastes straight into a
    // terminal and runs.  Handles both the line-continuation char (`\`,
    // backtick, or `^`) AND any leftover bare newlines inside arguments
    // (e.g. a pretty-printed JSON body).
    const collapse = (s: string, contChar: RegExp | null): string => {
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

function buildEndpointRow(ep: EndpointDef): string {
    const methodCls: Record<string, string> = {
        GET: 'plug-method-get', POST: 'plug-method-post',
        PUT: 'plug-method-put', DELETE: 'plug-method-delete', PATCH: 'plug-method-patch',
    };
    const cls = methodCls[ep.method] || 'plug-method-get';
    const safeId = (ep.method.toLowerCase() + '_' + ep.path).replace(/\//g, '_').replace(/^_/, '').replace(/:/g, '');

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
    const ps1Raw  = _ps1Ex(ep);
    const authNote = ep.auth
        ? `<span class="plug-ep-auth-note">${IC.lock} ${t('plugins.epAuthNote')}</span>`
        : `<span class="plug-ep-noauth-note">${IC.checkCircle} ${t('plugins.epNoAuthNote')}</span>`;

    // ── bmm:// deeplink equivalent (if one exists) ─────────────────────────
    const ENDPOINT_TO_DL: Record<string, string> = {
        'POST /api/mods/enable':       'bmm://mod/enable?id=<mod_id>',
        'POST /api/mods/disable':      'bmm://mod/disable?id=<mod_id>',
        'POST /api/profiles/activate': 'bmm://profile/activate?id=<profile_id>',
        'POST /api/plugins/apply':     'bmm://plugin/activate?id=<plugin_id>',
        'POST /api/plugins/compare':   'bmm://plugin/compare?id=<plugin_id>',
        'POST /api/modpacks/enable':   'bmm://modpack/enable?id=<modpack_id>',
        'POST /api/modpacks/disable':  'bmm://modpack/disable?id=<modpack_id>',
        'POST /api/repo/connect':      'bmm://repo/connect?url=<repo_url>',
        'POST /api/repo/sync':         'bmm://repo/sync?url=<repo_url>&profile=<repo_profile_id>',
    };
    const dlEquiv = ENDPOINT_TO_DL[`${ep.method} ${ep.path}`];
    const dlBadge = dlEquiv
        ? `<span class="plug-ep-dl-badge" data-tooltip="Équivalent bmm:// : ${dlEquiv}"
               style="font-size:9px;padding:1px 6px;border-radius:4px;background:rgba(139,92,246,0.12);color:#a78bfa;border:1px solid rgba(139,92,246,0.2);white-space:nowrap;font-weight:700;cursor:default;user-select:none;">bmm://</span>`
        : '';
    const dlInfoHtml = dlEquiv
        ? `<div class="plug-ep-dl-info" style="display:flex;align-items:center;gap:8px;padding:8px 12px;margin-top:6px;background:rgba(139,92,246,0.06);border:1px solid rgba(139,92,246,0.18);border-radius:8px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" style="flex-shrink:0"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                <span style="font-size:11px;color:var(--text-secondary);white-space:nowrap;flex-shrink:0;">Équivalent deeplink :</span>
                <code class="plug-ep-copy-btn" data-copy="${escHtml(dlEquiv)}" data-tooltip="Cliquer pour copier" style="flex:1;font-size:11px;color:#a78bfa;background:rgba(139,92,246,0.12);padding:2px 8px;border-radius:4px;cursor:pointer;user-select:all;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;" tabindex="0">${escHtml(dlEquiv)}</code>
                <button class="btn btn-xs plug-ep-copy-btn" data-copy="${escHtml(dlEquiv)}" data-tooltip="Copier" style="flex-shrink:0;padding:3px 7px;background:rgba(139,92,246,0.15);color:#a78bfa;border:1px solid rgba(139,92,246,0.25);border-radius:5px;">${IC.copy}</button>
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
                    <button class="btn btn-xs btn-ghost plug-ep-prefill-btn" data-method="${ep.method}" data-path="${ep.path}" data-tooltip="Préremplir la requête personnalisée">${IC.terminal}</button>
                    <button class="btn btn-xs btn-ghost plug-ep-copy-btn" data-copy="${ep.path}" data-tooltip="${t('plugins.epCopy')}">${IC.copy}</button>
                    ${ep.auth ? `<span class="plug-auth-badge" data-tooltip="${t('plugins.requiresToken')}">${IC.lock}</span>` : ''}
                </div>
            </div>
            <div class="plug-ep-detail plug-ep-swagger" id="epd-${safeId}" style="display:none;">
                <div class="plug-ep-swagger-left">
                    <p class="plug-ep-about">${escHtml(ep.about)}</p>
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

// ── Deep Link definitions ───────────────────────────────────────────────────

interface DeepLinkDef {
    scheme: string;        // e.g. "mod/enable"
    params: { name: string; required: boolean; desc: string }[];
    desc: string;
    about: string;
    example: string;       // full bmm:// example
}

function getDeepLinkDefs(): DeepLinkDef[] {
    return [
        {
            scheme: 'mod/enable',
            params: [{ name: 'id', required: true, desc: 'ID du mod à activer (UUID ou nom de dossier).' }],
            desc: 'Activer un mod',
            about: 'Active un mod spécifique dans le profil actif. BMM doit être en cours d\'exécution. Fonctionne depuis un .bat, un script ou n\'importe quelle application.',
            example: 'bmm://mod/enable?id=my-mod-folder',
        },
        {
            scheme: 'mod/disable',
            params: [{ name: 'id', required: true, desc: 'ID du mod à désactiver.' }],
            desc: 'Désactiver un mod',
            about: 'Désactive un mod spécifique dans le profil actif.',
            example: 'bmm://mod/disable?id=my-mod-folder',
        },
        {
            scheme: 'profile/activate',
            params: [{ name: 'id', required: true, desc: 'UUID du profil à activer.' }],
            desc: 'Activer un profil',
            about: 'Bascule le profil actif de BMM. Les mods du profil cible sont chargés automatiquement.',
            example: 'bmm://profile/activate?id=prof-uuid',
        },
        {
            scheme: 'plugin/activate',
            params: [{ name: 'id', required: true, desc: 'ID du plugin à appliquer (champ "id" dans plugin.json).' }],
            desc: 'Appliquer un plugin',
            about: 'Applique la modlist du plugin : active les mods requis et (si strict:true) désactive les autres.',
            example: 'bmm://plugin/activate?id=my-server-pack',
        },
        {
            scheme: 'plugin/compare',
            params: [{ name: 'id', required: true, desc: 'ID du plugin à comparer.' }],
            desc: 'Comparer un plugin',
            about: 'Ouvre le panneau de comparaison entre la modlist du plugin et les mods actuellement actifs.',
            example: 'bmm://plugin/compare?id=my-server-pack',
        },
        {
            scheme: 'modpack/enable',
            params: [{ name: 'id', required: true, desc: 'ID du modpack (LocalModpack.id).' }],
            desc: 'Activer un modpack',
            about: 'Active tous les mods appartenant au modpack spécifié dans le profil courant.',
            example: 'bmm://modpack/enable?id=modpack-uuid',
        },
        {
            scheme: 'modpack/disable',
            params: [{ name: 'id', required: true, desc: 'ID du modpack.' }],
            desc: 'Désactiver un modpack',
            about: 'Désactive tous les mods appartenant au modpack spécifié.',
            example: 'bmm://modpack/disable?id=modpack-uuid',
        },
        {
            scheme: 'install',
            params: [
                { name: 'url',  required: true,  desc: 'URL directe vers le fichier du mod à installer.' },
                { name: 'name', required: false, desc: 'Nom affiché dans BMM après l\'installation.' },
            ],
            desc: 'Installer un mod depuis une URL',
            about: 'Déclenche le téléchargement et l\'installation d\'un mod directement depuis une URL externe. BMM ouvre la boîte de dialogue d\'installation.',
            example: 'bmm://install?url=https://example.com/mod.zip&name=MyMod',
        },
        // ── Server Repo ──────────────────────────────────────────────────────
        {
            scheme: 'repo/connect',
            params: [
                { name: 'url',  required: true,  desc: 'URL vers le repo.json du serveur à connecter.' },
                { name: 'name', required: false, desc: 'Nom affiché dans BMM (récupéré automatiquement si omis).' },
            ],
            desc: 'Connecter un repo distant',
            about: 'Enregistre l\'URL d\'un repo distant dans la liste des repos connectés de BMM. Équivalent à POST /api/repo/connect. BMM doit être en cours d\'exécution. Utile depuis un installateur, un launcher, ou un lien de partage.',
            example: 'bmm://repo/connect?url=https://monserveur.com/repo.json&name=Mon+Serveur',
        },
        {
            scheme: 'repo/sync',
            params: [
                { name: 'url',      required: true,  desc: 'URL vers le repo.json distant.' },
                { name: 'profile',  required: true,  desc: 'ID du profil dans le repo distant (visible dans repo.json).' },
                { name: 'game_dir', required: false, desc: 'Chemin du dossier jeu (requis si nouveau profil).' },
                { name: 'mods_dir', required: false, desc: 'Dossier des mods (requis si nouveau profil).' },
                { name: 'backup_dir', required: false, desc: 'Dossier de backup (requis si nouveau profil).' },
                { name: 'local_profile', required: false, desc: 'UUID d\'un profil local existant à mettre à jour (omis = crée un nouveau profil).' },
            ],
            desc: 'Synchroniser depuis un repo distant',
            about: 'Déclenche le téléchargement et l\'intégration d\'un profil du repo distant dans BMM. Équivalent à POST /api/repo/sync. BMM ouvre l\'interface de synchronisation avec les paramètres pré-remplis. Utile depuis un launcher pour forcer la mise à jour des mods avant lancement.',
            example: 'bmm://repo/sync?url=https://monserveur.com/repo.json&profile=prof-uuid&mods_dir=C:/Mods',
        },
    ];
}

function buildDeepLinkRow(dl: DeepLinkDef): string {
    const safeId = 'dl_' + dl.scheme.replace(/\//g, '_');
    const fullUrl = `bmm://${dl.scheme}`;
    const paramsHtml = dl.params.length ? `
        <div class="plug-ep-fields" style="margin-top:10px;">
            <div class="plug-ep-section-lbl">Paramètres URL (query string)</div>
            <table class="plug-ep-fields-table">
                <colgroup><col class="col-field"><col class="col-type"><col class="col-req"><col class="col-desc"></colgroup>
                <thead><tr><th>Paramètre</th><th>Type</th><th></th><th>Description</th></tr></thead>
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

    const batExample = `REM ${dl.desc}\nstart "" "${dl.example}"`;
    const ps1Example = `# ${dl.desc}\nStart-Process "${dl.example}"`;

    return `
        <div class="plug-ep-wrap" id="${safeId}">
            <div class="plug-endpoint-row" data-method="DL" data-path="${escHtml(fullUrl)}">
                <button class="plug-ep-chevron" id="epchev-${safeId}" aria-label="expand">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <span class="plug-method" style="background:rgba(139,92,246,0.15);color:#a78bfa;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:700;white-space:nowrap;">bmm://</span>
                <code class="plug-path">${escHtml(fullUrl)}</code>
                <span class="plug-endpoint-desc">${escHtml(dl.desc)}</span>
                <div class="plug-ep-row-actions">
                    <button class="btn btn-xs btn-ghost plug-dl-open-btn" data-url="${escHtml(dl.example)}" data-tooltip="Ouvrir ce deep link">${IC.play}</button>
                    <button class="btn btn-xs btn-ghost plug-ep-copy-btn" data-copy="${escHtml(dl.example)}" data-tooltip="Copier l'URL">${IC.copy}</button>
                    <span class="plug-ep-noauth-note" style="font-size:10px;">${IC.checkCircle} Sans auth</span>
                </div>
            </div>
            <div class="plug-ep-detail" id="epd-${safeId}" style="display:none;padding:12px 16px 14px;gap:16px;display:none;flex-direction:row;">
                <div style="flex:1;min-width:0;">
                    <p class="plug-ep-about">${escHtml(dl.about)}</p>
                    ${paramsHtml}
                </div>
                <div style="flex:1;min-width:0;">
                    <div class="plug-ep-section-lbl">Exemple .bat</div>
                    <pre class="plug-ep-code-block" style="margin-bottom:8px;">${escHtml(batExample)}</pre>
                    <div class="plug-ep-section-lbl">Exemple PowerShell</div>
                    <pre class="plug-ep-code-block">${escHtml(ps1Example)}</pre>
                </div>
            </div>
        </div>`;
}

function getEndpointDefs(): EndpointDef[] {
    const e401 = { code: 401, label: 'Unauthorized',  body: '{ "error": "Unauthorized" }' };
    const e404 = { code: 404, label: 'Not Found',      body: '{ "error": "Not found" }' };
    const e400 = { code: 400, label: 'Bad Request',    body: '{ "error": "Invalid or missing fields" }' };
    const e500 = { code: 500, label: 'Server Error',   body: '{ "error": "Internal server error" }' };
    return [
        // ── System ──────────────────────────────────────────────────────────
        {
            method: 'GET', path: '/api/health', auth: false,
            desc: t('plugins.endpointHealth'), about: 'Sonde légère de disponibilité — aucune authentification requise. Utilise cet endpoint pour vérifier que le serveur API BMM est démarré et accessible.',
            fields: null,
            responseStatuses: [{ code: 200, label: 'OK', body: '{ "ok": true, "service": "BMM Plugin API", "port": 51274 }' }],
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
            about: 'Interroge la dernière release GitHub et la compare à la version en cours d\'exécution. Retourne si une mise à jour est disponible et l\'URL de la release.',
            fields: null,
            responseStatuses: [{ code: 200, label: 'OK', body: '{ "ok": true, "current": "1.2.0", "latest": "1.3.0", "has_update": true, "release_url": "https://github.com/FreeProject089/BetterModsManager/releases/latest" }' }],
        },
        {
            method: 'POST', path: '/api/restart', auth: true,
            desc: t('plugins.endpointRestart'),
            about: 'Redémarre proprement l\'application BMM. Le processus se ferme et se relance après un délai de 300 ms. L\'API sera brièvement indisponible pendant le redémarrage.',
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
            about: 'Met à jour partiellement les métadonnées éditables d\'un mod. Remplace :id dans l\'URL par l\'UUID du mod. Tous les champs sont optionnels — seuls les champs envoyés seront modifiés.',
            fields: [
                { name: 'name',        type: 'string', required: false, desc: 'Nouveau nom affiché dans l\'interface.' },
                { name: 'version',     type: 'string', required: false, desc: 'Chaîne de version, ex : "1.2.3".' },
                { name: 'author',      type: 'string', required: false, desc: 'Nom de l\'auteur ou du créateur.' },
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
            about: 'Supprime définitivement l\'entrée d\'un mod dans BMM. Remplace :id par l\'UUID du mod. Cela ne supprime PAS les fichiers sur le disque — utilise l\'interface pour une suppression complète.',
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
            about: 'Crée un nouveau profil de mods. Le profil n\'est pas automatiquement défini comme actif — appelle POST /api/profiles/activate ensuite si nécessaire.',
            fields: [
                { name: 'name',        type: 'string', required: true,  desc: 'Nom du profil affiché dans la barre latérale.' },
                { name: 'game_path',   type: 'string', required: true,  desc: 'Chemin absolu vers le dossier d\'installation du jeu.' },
                { name: 'mods_path',   type: 'string', required: true,  desc: 'Chemin absolu vers le dossier où sont stockés les mods.' },
                { name: 'backup_path', type: 'string', required: true,  desc: 'Chemin absolu où les copies de backup sont sauvegardées.' },
                { name: 'game_name',   type: 'string', required: false, desc: 'Label du jeu optionnel, ex : "DCS World".' },
                { name: 'color',       type: 'string', required: false, desc: 'Couleur d\'accentuation hex, ex : "#3b82f6". Bleu par défaut.' },
                { name: 'icon',        type: 'string', required: false, desc: 'Identifiant d\'icône affiché à côté du profil, ex : "star".' },
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
            about: 'Met à jour partiellement un profil existant. Remplace :id par l\'UUID du profil. Tous les champs sont optionnels — seuls les champs envoyés seront modifiés.',
            fields: [
                { name: 'name',        type: 'string', required: false, desc: 'Nouveau nom d\'affichage.' },
                { name: 'color',       type: 'string', required: false, desc: 'Nouvelle couleur d\'accentuation hex, ex : "#ef4444".' },
                { name: 'icon',        type: 'string', required: false, desc: 'Nouvel identifiant d\'icône.' },
                { name: 'game_path',   type: 'string', required: false, desc: 'Nouveau chemin absolu vers le dossier du jeu.' },
                { name: 'mods_path',   type: 'string', required: false, desc: 'Nouveau chemin absolu vers le dossier des mods.' },
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
            about: 'Supprime définitivement un profil et retire toutes les associations de mods pour ce profil. Remplace :id par l\'UUID du profil. Impossible de supprimer le profil actuellement actif.',
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
                { name: 'plugin_id',    type: 'string',  required: true,  desc: 'ID du plugin installé à appliquer.' },
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
            about: 'Récupère et retourne le contenu du repo.json distant (métadonnées, profils, liste de mods). Utile pour prévisualiser un repo avant de le connecter ou de le synchroniser. Aucune authentification requise.\n\nQuery string : ?url=<URL_du_repo>',
            fields: [
                { name: 'url', type: 'string', required: true, desc: 'URL vers le repo.json distant (query param). Ex : ?url=https://monserveur.com/repo.json' },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "data": { "name": "Mon Repo", "version": "1.0.0", "game_name": "DCS World", "profiles": [...], "author": "FreeProject" } }' },
                { code: 400, label: 'Bad Request', body: '{ "error": "url query param required" }' },
                { code: 502, label: 'Bad Gateway', body: '{ "error": "Remote returned 404" }' },
            ],
        },
        {
            method: 'GET', path: '/api/repo/list', auth: false,
            desc: 'Liste des repos connectés',
            about: 'Retourne la liste de tous les repos distants enregistrés dans BMM (ajoutés via POST /api/repo/connect ou depuis l\'interface). Chaque entrée contient l\'URL et le nom du repo.',
            fields: null,
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "data": [{ "url": "https://monserveur.com/repo.json", "name": "Mon Serveur" }] }' },
            ],
        },
        {
            method: 'POST', path: '/api/repo/connect', auth: true,
            desc: 'Connecter un repo distant',
            about: 'Enregistre l\'URL d\'un repo distant dans la liste des repos connectés de BMM. Si le champ name est omis, BMM tente de récupérer le nom depuis le repo.json distant. Si le repo est déjà dans la liste, aucun doublon n\'est ajouté.\n\nÉquivalent deeplink : bmm://repo/connect?url=<URL>',
            fields: [
                { name: 'url',  type: 'string', required: true,  desc: 'URL complète vers le repo.json distant (ou le dossier parent — /repo.json sera ajouté automatiquement).' },
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
            about: 'Retire un repo de la liste des repos connectés. Le corps de la requête doit contenir l\'URL exacte du repo tel qu\'il a été ajouté. Les fichiers locaux synchronisés ne sont PAS supprimés.',
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
            about: 'Télécharge les mods depuis un repo distant et les intègre dans des profils locaux BMM. L\'opération est démarrée en arrière-plan — la réponse est immédiate (202 Accepted) avec un job_id. <strong>Max 1 sync simultanée</strong> — retourne 409 si une sync est déjà en cours. Annulez avec <code>DELETE /api/repo/sync/cancel</code>.\n\nÉquivalent deeplink : bmm://repo/sync?url=&lt;URL&gt;&amp;profile=&lt;repo_profile_id&gt;',
            fields: [
                { name: 'url',                                type: 'string',  required: true,  desc: 'URL du repo.json distant.' },
                { name: 'choices',                            type: 'array',   required: true,  desc: 'Tableau de profils à synchroniser. Chaque entrée : { repoProfileId, targetLocalProfileId?, selectedModIds? }.' },
                { name: 'choices[].repoProfileId',            type: 'string',  required: true,  desc: 'ID du profil dans le repo distant (visible via GET /api/repo/info).' },
                { name: 'choices[].targetLocalProfileId',     type: 'string',  required: false, desc: 'UUID d\'un profil local existant à mettre à jour. Omis = crée un nouveau profil.' },
                { name: 'choices[].selectedModIds',           type: 'array',   required: false, desc: 'IDs de mods à télécharger (null = tous les mods du profil).' },
                { name: 'gameDir',                            type: 'string',  required: false, desc: 'Chemin du dossier jeu (requis si création d\'un nouveau profil).' },
                { name: 'modsDir',                            type: 'string',  required: false, desc: 'Dossier racine des mods (requis si création d\'un nouveau profil).' },
                { name: 'backupDir',                          type: 'string',  required: false, desc: 'Dossier de backup (requis si création d\'un nouveau profil).' },
                { name: 'creatorId',                          type: 'string',  required: false, desc: 'Creator ID à envoyer en header X-Creator-ID (pour repos privés).' },
                { name: 'overwriteAll',                       type: 'boolean', required: false, desc: 'Si true, re-télécharge tous les fichiers même si le hash correspond. Défaut : false.' },
                { name: 'deleteExtra',                        type: 'boolean', required: false, desc: 'Si true, supprime les fichiers locaux absents du repo distant. Défaut : false.' },
                { name: 'downloadLimit',                      type: 'number',  required: false, desc: 'Limite de téléchargement en KB/s (0 = illimité). Défaut : 0.' },
            ],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "message": "Sync started in background", "job_id": "uuid", "cancel_endpoint": "DELETE /api/repo/sync/cancel" }' },
                { code: 400, label: 'Bad Request', body: '{ "error": "gameDir is required when creating a new profile" }' },
                { code: 401, label: 'Unauthorized', body: '{ "error": "Unauthorized" }' },
                { code: 409, label: 'Conflict', body: '{ "error": "A sync is already running. Cancel it first with DELETE /api/repo/sync/cancel." }' },
            ],
        },
        {
            method: 'POST', path: '/api/repo/gen', auth: true,
            desc: 'Générer la structure repo (Gen)',
            about: 'Exporte des profils locaux au format repo serveur BMM (repo.json + mods hachés + structure de fichiers). Si <code>generate_server=true</code>, génère les scripts de démarrage du mini-serveur. Si <code>lightweight=true</code>, ne copie pas les fichiers de mods (manifeste seul). Si <code>zip_output=true</code>, compresse le tout dans un .zip. L\'opération est démarrée en arrière-plan — réponse immédiate (202). Annulez avec <code>DELETE /api/repo/gen/cancel</code>.',
            fields: [
                { name: 'profileIds',    type: 'array',   required: true,  desc: 'Tableau des UUIDs de profils locaux à exporter.' },
                { name: 'outputDir',     type: 'string',  required: true,  desc: 'Dossier de destination où créer repo.json et le dossier mods/.' },
                { name: 'authorName',    type: 'string',  required: true,  desc: 'Nom de l\'auteur inscrit dans repo.json.' },
                { name: 'seed',          type: 'string',  required: false, desc: 'Graine de stabilité du repo (réutilisation entre exports). Généré automatiquement si omis.' },
                { name: 'generateServer',type: 'boolean', required: false, desc: 'Si true, génère également les scripts de démarrage du mini-serveur. Défaut : false.' },
                { name: 'port',          type: 'number',  required: false, desc: 'Port d\'écoute du mini-serveur. Défaut : 8080.' },
                { name: 'uploadLimit',   type: 'number',  required: false, desc: 'Limite de bande passante montante KB/s (0 = illimité). Défaut : 0.' },
                { name: 'adminPassword', type: 'string',  required: false, desc: 'Mot de passe administrateur du mini-serveur.' },
                { name: 'useCloudflare', type: 'boolean', required: false, desc: 'Active le tunnel Cloudflare (cloudflared doit être installé).' },
                { name: 'useUpnp',       type: 'boolean', required: false, desc: 'Active l\'ouverture de port automatique via UPnP.' },
                { name: 'autoStart',     type: 'boolean', required: false, desc: 'Démarre le serveur automatiquement au lancement de BMM.' },
                { name: 'lang',          type: 'string',  required: false, desc: 'Langue de l\'interface du mini-serveur (ex: "fr", "en"). Défaut : "en".' },
                { name: 'serverVersion', type: 'number',  required: false, desc: 'Version cible du serveur BMM à générer (1 ou 2).' },
                { name: 'enableDocker',  type: 'boolean', required: false, desc: 'Génère un Dockerfile pour le mini-serveur.' },
                { name: 'dockerHostType',type: 'string',  required: false, desc: 'Type d\'hôte Docker : "linux" ou "windows".' },
                { name: 'zipOutput',     type: 'boolean', required: false, desc: 'Compresse la sortie en .zip — active également la config serveur de distribution.' },
                { name: 'useDocker',     type: 'boolean', required: false, desc: 'Génère un Dockerfile pour le mini-serveur de distribution.' },
                { name: 'dockerOs',      type: 'string',  required: false, desc: 'OS hôte Docker : "linux" (défaut) ou "windows".' },
                { name: 'serverVersion', type: 'string',  required: false, desc: 'Version serveur : "std" (standard) ou "lux" (premium).' },
            ],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "message": "Gen started in background", "job_id": "uuid", "cancel_endpoint": "DELETE /api/repo/gen/cancel" }' },
                { code: 400, label: 'Bad Request', body: '{ "error": "author_name is required" }' },
                { code: 401, label: 'Unauthorized', body: '{ "error": "Unauthorized" }' },
                { code: 409, label: 'Conflict', body: '{ "error": "A gen is already running. Cancel it first with DELETE /api/repo/gen/cancel." }' },
            ],
        },
        {
            method: 'POST', path: '/api/repo/host', auth: true,
            desc: 'Démarrer le serveur HTTP statique',
            about: 'Lance un serveur HTTP de fichiers statiques (warp::fs) sur le dossier spécifié. Utile pour servir un repo généré via <code>POST /api/repo/gen</code> directement sur le réseau local. Stoppez-le avec <code>DELETE /api/repo/host</code>.',
            fields: [
                { name: 'serveDir',    type: 'string',  required: true,  desc: 'Chemin absolu du dossier à servir (ex: "C:/BMM/Export").' },
                { name: 'port',        type: 'number',  required: false, desc: 'Port d\'écoute HTTP. Défaut : 8080.' },
                { name: 'uploadLimit', type: 'number',  required: false, desc: 'Limite de bande passante KB/s (0 = illimité). Défaut : 0.' },
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
            about: '<strong>What:</strong> a Better ModPack <code>.bmp</code> file. <strong>Where it goes:</strong> the imported modpack is added to BMM\'s modpack list (stored in the app-data file) and appears on the Modpacks page. <strong>Source:</strong> you pick the <code>.bmp</code> in the native file dialog.<br><br>UI-driven via the native modpack importer.',
            fields: [],
            responseStatuses: [
                { code: 202, label: 'Accepted', body: '{ "ok": true, "driven_by": "bmm-ui", "action": "modpack/import" }' },
                e401,
            ],
        },
        {
            method: 'POST', path: '/api/modpacks/export', auth: true,
            desc: 'Export a modpack (.bmp)',
            about: '<strong>What:</strong> the modpack identified by <code>id</code>, written as a Better ModPack <code>.bmp</code> file. <strong>Where:</strong> you choose the destination in the native save dialog BMM opens.<br><br>Get the id from <code>GET /api/modpacks</code>.',
            fields: [
                { name: 'id', type: 'string', required: true, desc: 'UUID of the modpack to export (from GET /api/modpacks).' },
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
            about: '<strong>What:</strong> a translation <code>.json</code> (same shape as BMM\'s built-in <code>Lang/</code> files). <strong>Where it goes:</strong> it is copied into BMM\'s <code>Lang/</code> folder and becomes selectable as a language in Settings. <strong>Source:</strong> you pick the file in the open dialog.',
            fields: [],
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
            about: 'Returns all profiles treated as modpacks, including their mod count and metadata. A modpack in BMM is essentially a named profile with a list of mods.',
            fields: [],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "data": [{ "id": "...", "name": "My Pack", "mod_count": 12, "active": true }] }' },
            ],
        },
        {
            method: 'POST', path: '/api/modpacks/create', auth: true,
            desc: t('plugins.endpointCreateModpack') || 'Créer un modpack',
            about: 'Crée un nouveau modpack avec un nom donné. Spécifie mod_ids pour inclure des mods directement, ou fournis source_profile_id pour capturer les mods actifs d\'un profil. Prend en charge multi_profile, skip_integrity_check, dependency_mode et des surcharges par mod (lien de téléchargement, include_dependencies, etc.).',
            fields: [
                { name: 'name',                 type: 'string',  required: true,  desc: 'Nom affiché pour le nouveau modpack.' },
                { name: 'mod_ids',              type: 'array',   required: false, desc: 'Tableau d\'UUIDs de mods à inclure directement. Prioritaire sur source_profile_id.' },
                { name: 'source_profile_id',    type: 'string',  required: false, desc: 'UUID d\'un profil dont capturer les mods actifs (utilisé si mod_ids n\'est pas fourni).' },
                { name: 'description',          type: 'string',  required: false, desc: 'Description courte du modpack.' },
                { name: 'game_name',            type: 'string',  required: false, desc: 'Label du jeu (hérité du profil source si omis).' },
                { name: 'sr_link',              type: 'string',  required: false, desc: 'URL du Server Repo lié à ce modpack.' },
                { name: 'multi_profile',        type: 'boolean', required: false, desc: 'Autoriser des mods de plusieurs profils dans un seul modpack.' },
                { name: 'skip_integrity_check', type: 'boolean', required: false, desc: 'Ignorer la vérification d\'intégrité des fichiers lors de l\'application du modpack.' },
                { name: 'dependency_mode',      type: 'string',  required: false, desc: 'Mode de résolution des dépendances : "none" (défaut, aucune), "all" (toutes auto-incluses), "manual" (par mod via include_dependencies).' },
                { name: 'mod_overrides',        type: 'array',   required: false, desc: 'Surcharges par mod : [{ "mod_id": "uuid", "include_dependencies": false, "download_link": "https://…", "fallback_link": "https://…", "fallback_type": "direct|gdrive|…" }]' },
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
                { name: 'name',                 type: 'string',  required: false, desc: 'Nouveau nom affiché du modpack.' },
                { name: 'description',          type: 'string',  required: false, desc: 'Nouvelle description.' },
                { name: 'game_name',            type: 'string',  required: false, desc: 'Label du jeu.' },
                { name: 'sr_link',              type: 'string',  required: false, desc: 'URL du Server Repo lié.' },
                { name: 'mod_ids',              type: 'array',   required: false, desc: 'Tableau de mod UUIDs pour remplacer la liste de mods.' },
                { name: 'multi_profile',        type: 'boolean', required: false, desc: 'Autoriser des mods de plusieurs profils.' },
                { name: 'skip_integrity_check', type: 'boolean', required: false, desc: 'Ignorer la vérification d\'intégrité des fichiers.' },
                { name: 'dependency_mode',      type: 'string',  required: false, desc: 'Mode de résolution : "none", "all", "manual".' },
                { name: 'mod_overrides',        type: 'array',   required: false, desc: 'Surcharges par mod (download_link, include_dependencies, etc.).' },
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
    ];
}

async function handleApiTest() {
    const methodSel   = document.getElementById('pt-method') as HTMLSelectElement;
    const pathInp     = document.getElementById('pt-path') as HTMLInputElement;
    const bodyTa      = document.getElementById('pt-body') as HTMLTextAreaElement;
    const respDiv     = document.getElementById('pt-response') as HTMLElement;
    const respPre     = document.getElementById('pt-resp-body') as HTMLElement;
    const statusBadge = document.getElementById('pt-status-badge') as HTMLElement;
    if (!methodSel || !pathInp || !respDiv) return;

    const method   = methodSel.value;
    let   path     = pathInp.value.trim();
    const bodyText = bodyTa?.value?.trim() || '';

    // Normalize path — must start with /
    if (path && !path.startsWith('/')) path = '/' + path;

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
        const headers: Record<string, string> = {
            'Authorization': `Bearer ${_apiToken}`,
        };
        const opts: RequestInit = { method, headers };

        // Send body for POST, PUT, PATCH, and DELETE (some DELETE routes need a body)
        const canHaveBody = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
        if (canHaveBody && bodyText) {
            // Be lenient like the quick test: tolerate // and /* */ comments and
            // trailing commas, then re-serialize to clean JSON. If it still won't
            // parse, send the raw text as-is and let the server respond — never
            // block the request on client-side validation.
            const cleaned = bodyText
                .replace(/\/\*[\s\S]*?\*\//g, '')      // /* block */ comments
                .replace(/(^|[^:])\/\/.*$/gm, '$1')    // // line comments (keep http://)
                .replace(/,(\s*[}\]])/g, '$1');        // trailing commas
            let sendBody = bodyText;
            try { sendBody = JSON.stringify(JSON.parse(cleaned)); } catch { sendBody = bodyText; }
            headers['Content-Type'] = 'application/json';
            opts.body = sendBody;
        }

        const res  = await fetch(`http://127.0.0.1:51274${path}`, opts);
        const text = await res.text().catch(() => '');

        statusBadge.textContent = `${res.status} ${res.statusText}`;
        statusBadge.className = `plug-tester-status ${res.ok ? 'plug-status-ok' : 'plug-status-err'}`;

        let display: string;
        if (!text || text.trim() === '') {
            display = `// ${(t('plugins.ptEmptyResponse') || '(empty response — {s})').replace('{s}', `${res.status} ${res.statusText}`)}`;
        } else {
            try {
                const json = JSON.parse(text);
                display = JSON.stringify(json, null, 2);
            } catch {
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
    } catch (e) {
        statusBadge.textContent = t('common.error') || 'Error';
        statusBadge.className = 'plug-tester-status plug-status-err';
        respPre.textContent = (t('plugins.ptNetworkError') || 'Network error: {e}\n\nMake sure BMM is running and the API is on port 51274.').replace('{e}', String(e));
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
        (document.querySelector('.nav-item[data-view="settings"]') as HTMLElement)?.click();
    });
    ov.querySelectorAll('.plug-ov-close-btn').forEach(b => b.addEventListener('click', () => ov.remove()));
}

// ─────────────────────────────────────────────────────────────────────────
// Script generator — card-based action editor
// Each action becomes a self-contained card with category, title,
// description, properly labelled inputs (no more "key=value key=value"
// strings) and inline drag/delete controls.  `_collectActions` reads
// from these typed fields and rebuilds the backend `extra` payload.
// ─────────────────────────────────────────────────────────────────────────

type _Field = {
    key: string;
    label: string;
    type: 'text' | 'number' | 'select' | 'switch' | 'textarea';
    placeholder?: string;
    default?: any;
    options?: Array<{ value: string; label: string }>;
    half?: boolean; // render half-width
};

type _ActionDef = {
    id: string;
    cat: 'mods' | 'repo' | 'read' | 'system' | 'control';
    label: string;
    desc: string;
    iconSvg: string;
    /** Pick from dropdown of mods / profiles / plugins. */
    target?: 'mod' | 'profile' | 'plugin';
    fields?: _Field[];
};

const _CAT_META: Record<string, { color: string; label: string }> = {
    mods:    { color: '#3b82f6', label: 'BMM' },
    repo:    { color: '#a855f7', label: 'Repo' },
    read:    { color: '#06b6d4', label: 'Read' },
    system:  { color: '#10b981', label: 'System' },
    control: { color: '#f59e0b', label: 'Control' },
};

function _actionCatalog(): _ActionDef[] {
    const sv = (p: string) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
    // i18n helper: t('plugins.<key>') with an English fallback when the key is missing.
    const d = (k: string, fb: string) => t('plugins.' + k) || fb;
    // Options for "Linked API": every action that performs an API call, so an
    // if_api_ok / if_api_err can be linked to (and run) any of them directly.
    const apiActionOpts = [
        { value: '', label: d('optApiLast', '— check the previous API call —') },
        { value: 'enable_mod',       label: d('actionEnableMod', 'Enable mod') },
        { value: 'disable_mod',      label: d('actionDisableMod', 'Disable mod') },
        { value: 'activate_profile', label: d('actionActivateProfile', 'Switch profile') },
        { value: 'enable_modpack',   label: d('actionEnableModpack', 'Enable modpack') },
        { value: 'disable_modpack',  label: d('actionDisableModpack', 'Disable modpack') },
        { value: 'apply_plugin',     label: d('actionApplyPlugin', 'Apply plugin') },
        { value: 'compare_plugin',   label: d('actionComparePlugin', 'Compare plugin') },
        { value: 'delete_mod',       label: d('actionDeleteMod', 'Delete mod') },
        { value: 'update_mod',       label: d('actionUpdateMod', 'Update mod') },
        { value: 'create_profile',   label: d('actionCreateProfile', 'Create profile') },
        { value: 'update_profile',   label: d('actionUpdateProfile', 'Update profile') },
        { value: 'delete_profile',   label: d('actionDeleteProfile', 'Delete profile') },
        { value: 'create_modpack',   label: d('actionCreateModpack', 'Create modpack') },
        { value: 'delete_modpack',   label: d('actionDeleteModpack', 'Delete modpack') },
        { value: 'sync_repo',        label: d('actionSyncRepo', 'Sync repo') },
        { value: 'cancel_sync',      label: d('actionCancelSync', 'Cancel sync') },
        { value: 'gen_repo',         label: d('actionGenRepo', 'Generate repo') },
        { value: 'cancel_gen',       label: d('actionCancelGen', 'Cancel gen') },
        { value: 'http_host',        label: d('actionHttpHost', 'Start HTTP host') },
        { value: 'stop_http_host',   label: d('actionStopHttpHost', 'Stop HTTP host') },
        { value: 'repo_connect',     label: d('actionRepoConnect', 'Connect repo') },
        { value: 'repo_remove',      label: d('actionRepoRemove', 'Remove repo') },
        { value: 'restart',          label: d('actionRestart', 'Restart BMM') },
        { value: 'get_status',       label: d('actionGetStatus', 'Get status') },
        { value: 'api_health',       label: d('actionApiHealth', 'API health') },
        { value: 'check_update',     label: d('actionCheckUpdate', 'Check for update') },
        { value: 'list_mods',        label: d('actionListMods', 'List mods') },
        { value: 'list_active_mods', label: d('actionListActiveMods', 'List active mods') },
        { value: 'list_profiles',    label: d('actionListProfiles', 'List profiles') },
        { value: 'list_plugins',     label: d('actionListPlugins', 'List plugins') },
        { value: 'list_modpacks',    label: d('actionListModpacks', 'List modpacks') },
        { value: 'get_creator_id',   label: d('actionGetCreatorId', 'Get creator ID') },
        { value: 'repo_list',        label: d('actionRepoList', 'List repos') },
        { value: 'repo_info',        label: d('actionRepoInfo', 'Repo info') },
    ];
    return [
        // ── BMM ─────────────────────────────────────────────────────────
        { id: 'enable_mod',       cat: 'mods', label: d('actionEnableMod', 'Enable mod'),
          desc: d('actionEnableModDesc', 'Activates the selected mod for the current profile.'),
          iconSvg: sv('<polyline points="20 6 9 17 4 12"/>'), target: 'mod' },
        { id: 'disable_mod',      cat: 'mods', label: d('actionDisableMod', 'Disable mod'),
          desc: d('actionDisableModDesc', 'Deactivates the selected mod for the current profile.'),
          iconSvg: sv('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'), target: 'mod' },
        { id: 'activate_profile', cat: 'mods', label: d('actionActivateProfile', 'Switch profile'),
          desc: d('actionActivateProfileDesc', 'Makes the selected profile the active one.'),
          iconSvg: sv('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'), target: 'profile' },
        { id: 'enable_modpack',   cat: 'mods', label: d('actionEnableModpack', 'Enable modpack'),
          desc: d('actionEnableModpackDesc', 'Enables the modpack tied to a profile.'),
          iconSvg: sv('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>'), target: 'profile' },
        { id: 'disable_modpack',  cat: 'mods', label: d('actionDisableModpack', 'Disable modpack'),
          desc: d('actionDisableModpackDesc', 'Disables the modpack tied to a profile.'),
          iconSvg: sv('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><line x1="3" y1="3" x2="21" y2="21"/>'), target: 'profile' },
        { id: 'apply_plugin',     cat: 'mods', label: d('actionApplyPlugin', 'Apply plugin'),
          desc: d('actionApplyPluginDesc', 'Runs an installed plugin.'),
          iconSvg: sv('<path d="M5 3v18l14-9z"/>'), target: 'plugin' },
        { id: 'compare_plugin',   cat: 'mods', label: d('actionComparePlugin', 'Compare plugin'),
          desc: d('actionComparePluginDesc', 'Compares the plugin\'s modlist against currently-enabled mods.'),
          iconSvg: sv('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>'), target: 'plugin' },
        { id: 'update_modpack',   cat: 'mods', label: d('actionUpdateModpack', 'Update modpack'),
          desc: d('actionUpdateModpackDesc', 'Renames a modpack and/or changes its dependency mode.'),
          iconSvg: sv('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'),
          fields: [
            { key: 'modpack_id', label: d('fldModpackId', 'Modpack ID'), type: 'text', placeholder: d('phModpackIdUpdate', 'UUID of the modpack to update') },
            { key: 'name',       label: d('fldNewName', 'New name'),   type: 'text', placeholder: 'My pack', half: true },
            { key: 'dependency_mode', label: d('fldDependencies', 'Dependencies'), type: 'select', half: true,
              options: [
                { value: 'none',    label: d('optDepNoneLeave', 'None — leave deps alone') },
                { value: 'include', label: d('optDepInclude', 'Include all deps') },
                { value: 'exclude', label: d('optDepExclude', 'Exclude all deps') },
              ], default: 'none' },
          ] },
        { id: 'delete_mod',       cat: 'mods', label: d('actionDeleteMod', 'Delete mod'),
          desc: d('actionDeleteModDesc', 'Permanently removes the selected mod.'),
          iconSvg: sv('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'), target: 'mod' },
        { id: 'update_mod',       cat: 'mods', label: d('actionUpdateMod', 'Update mod'),
          desc: d('actionUpdateModDesc', 'Edits metadata (name/version/author/description) of the selected mod.'),
          iconSvg: sv('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'), target: 'mod',
          fields: [
            { key: 'name',        label: d('fldName', 'Name'),        type: 'text', placeholder: d('phKeepEmpty', '(leave empty = keep)'), half: true },
            { key: 'version',     label: d('fldVersion', 'Version'),     type: 'text', placeholder: d('phKeepEmpty', '(leave empty = keep)'), half: true },
            { key: 'author',      label: d('fldAuthor', 'Author'),      type: 'text', placeholder: d('phKeepEmpty', '(leave empty = keep)'), half: true },
            { key: 'description', label: d('fldDescription', 'Description'),  type: 'text', placeholder: d('phKeepEmpty', '(leave empty = keep)'), half: true },
          ] },
        { id: 'create_profile',   cat: 'mods', label: d('actionCreateProfile', 'Create profile'),
          desc: d('actionCreateProfileDesc', 'Creates a new profile.'),
          iconSvg: sv('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>'),
          fields: [
            { key: 'name',        label: d('fldName', 'Name'),        type: 'text', placeholder: 'My profile' },
            { key: 'game_name',   label: d('fldGameName', 'Game name'),   type: 'text', placeholder: 'Skyrim', half: true },
            { key: 'game_path',   label: d('fldGamePath', 'Game path'),   type: 'text', placeholder: 'C:/Games/Skyrim', half: true },
            { key: 'mods_path',   label: d('fldModsPath', 'Mods path'),   type: 'text', placeholder: 'C:/Mods', half: true },
            { key: 'backup_path', label: d('fldBackupPath', 'Backup path'), type: 'text', placeholder: 'C:/Backups', half: true },
          ] },
        { id: 'update_profile',   cat: 'mods', label: d('actionUpdateProfile', 'Update profile'),
          desc: d('actionUpdateProfileDesc', 'Edits the selected profile. Empty fields are left unchanged.'),
          iconSvg: sv('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'), target: 'profile',
          fields: [
            { key: 'name',        label: d('fldName', 'Name'),        type: 'text', placeholder: d('phKeep', '(keep)'), half: true },
            { key: 'game_name',   label: d('fldGameName', 'Game name'),   type: 'text', placeholder: d('phKeep', '(keep)'), half: true },
            { key: 'color',       label: d('fldColor', 'Color'),       type: 'text', placeholder: '#3b82f6', half: true },
            { key: 'icon',        label: d('fldIcon', 'Icon'),        type: 'text', placeholder: d('phKeep', '(keep)'), half: true },
            { key: 'game_path',   label: d('fldGamePath', 'Game path'),   type: 'text', placeholder: d('phKeep', '(keep)'), half: true },
            { key: 'mods_path',   label: d('fldModsPath', 'Mods path'),   type: 'text', placeholder: d('phKeep', '(keep)'), half: true },
            { key: 'backup_path', label: d('fldBackupPath', 'Backup path'), type: 'text', placeholder: d('phKeep', '(keep)'), half: true },
          ] },
        { id: 'delete_profile',   cat: 'mods', label: d('actionDeleteProfile', 'Delete profile'),
          desc: d('actionDeleteProfileDesc', 'Permanently removes the selected profile.'),
          iconSvg: sv('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'), target: 'profile' },
        { id: 'create_modpack',   cat: 'mods', label: d('actionCreateModpack', 'Create modpack'),
          desc: d('actionCreateModpackDesc', 'Creates a new modpack.'),
          iconSvg: sv('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><line x1="12" y1="22" x2="12" y2="12"/>'),
          fields: [
            { key: 'name',        label: d('fldName', 'Name'),        type: 'text', placeholder: 'My pack' },
            { key: 'description', label: d('fldDescription', 'Description'), type: 'text', placeholder: d('phOptional', '(optional)'), half: true },
            { key: 'game_name',   label: d('fldGameName', 'Game name'),   type: 'text', placeholder: d('phOptional', '(optional)'), half: true },
            { key: 'sr_link',     label: d('fldSrLink', 'Server Repo link'), type: 'text', placeholder: d('phOptional', '(optional)'), half: true },
            { key: 'dependency_mode', label: d('fldDependencies', 'Dependencies'), type: 'select', half: true,
              options: [
                { value: 'none',    label: d('optDepNone', 'None') },
                { value: 'include', label: d('optDepInclude', 'Include all deps') },
                { value: 'exclude', label: d('optDepExclude', 'Exclude all deps') },
              ], default: 'none' },
          ] },
        { id: 'delete_modpack',   cat: 'mods', label: d('actionDeleteModpack', 'Delete modpack'),
          desc: d('actionDeleteModpackDesc', 'Permanently removes a modpack by ID.'),
          iconSvg: sv('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
          fields: [ { key: 'modpack_id', label: d('fldModpackId', 'Modpack ID'), type: 'text', placeholder: d('phModpackId', 'UUID of the modpack') } ] },

        // ── Repo ────────────────────────────────────────────────────────
        { id: 'sync_repo',      cat: 'repo', label: d('actionSyncRepo', 'Sync repo'),
          desc: d('actionSyncRepoDesc', 'Pulls a remote BMM repo into a local mods folder.'),
          iconSvg: sv('<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>'),
          fields: [
            { key: 'url',            label: d('fldRepoUrl', 'Repo URL'),       type: 'text',   placeholder: 'https://repo.example.com' },
            { key: 'mods_dir',       label: d('fldModsFolder', 'Mods folder'),    type: 'text',   placeholder: 'C:/Mods/MyGame' },
            { key: 'backup_dir',     label: d('fldBackupFolder', 'Backup folder'),  type: 'text',   placeholder: 'C:/BMM/Backups' },
            { key: 'game_dir',       label: d('fldGameRootOpt', 'Game root (opt)'),type: 'text',   placeholder: 'C:/Games/MyGame', half: true },
            { key: 'download_limit', label: d('fldDlLimit', 'DL limit (KB/s)'), type: 'number', placeholder: d('phUnlimited', '0 = unlimited'), default: '0', half: true },
            { key: 'overwrite_all',  label: d('fldOverwriteAll', 'Overwrite all'),  type: 'switch', default: false, half: true },
            { key: 'delete_extra',   label: d('fldDeleteExtra', 'Delete extra'),   type: 'switch', default: false, half: true },
          ] },
        { id: 'cancel_sync',    cat: 'repo', label: d('actionCancelSync', 'Cancel sync'),
          desc: d('actionCancelSyncDesc', 'Stops a running repo sync. No parameters.'),
          iconSvg: sv('<rect x="6" y="6" width="12" height="12" rx="1"/>') },
        { id: 'gen_repo',       cat: 'repo', label: d('actionGenRepo', 'Generate repo'),
          desc: d('actionGenRepoDesc', 'Exports your active profile as a redistributable repo folder/zip.'),
          iconSvg: sv('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 12 15 15"/>'),
          fields: [
            { key: 'profile_id',   label: d('fldProfileUuid', 'Profile UUID'),   type: 'text',   placeholder: d('phActiveProfile', 'Leave empty = active profile') },
            { key: 'output_dir',   label: d('fldOutputFolder', 'Output folder'),  type: 'text',   placeholder: 'C:/Export' },
            { key: 'author',       label: d('fldAuthorName', 'Author name'),    type: 'text',   placeholder: d('phYourName', 'Your name'), half: true },
            { key: 'port',         label: d('fldPortServer', 'Port (server)'),  type: 'number', placeholder: '8080', default: '8080', half: true },
            { key: 'admin_pass',   label: d('fldAdminPass', 'Admin password'), type: 'text',   placeholder: d('phOptional', '(optional)'), half: true },
            { key: 'upload_limit', label: d('fldUlLimit', 'UL limit (KB/s)'),type: 'number', placeholder: d('phUnlimited', '0 = unlimited'), default: '0', half: true },
            { key: 'lightweight',      label: d('fldLightweight', 'Lightweight'),      type: 'switch', default: false, half: true },
            { key: 'zip',              label: d('fldZipOutput', 'Zip output'),       type: 'switch', default: true,  half: true },
            { key: 'generate_server',  label: d('fldGenerateServer', 'Generate server'),  type: 'switch', default: false, half: true },
            { key: 'auto_start',       label: d('fldAutoStart', 'Auto start'),       type: 'switch', default: false, half: true },
          ] },
        { id: 'cancel_gen',     cat: 'repo', label: d('actionCancelGen', 'Cancel gen'),
          desc: d('actionCancelGenDesc', 'Stops a running repo generation. No parameters.'),
          iconSvg: sv('<rect x="6" y="6" width="12" height="12" rx="1"/>') },
        { id: 'http_host',      cat: 'repo', label: d('actionHttpHost', 'Start HTTP host'),
          desc: d('actionHttpHostDesc', 'Starts the local repo HTTP server so others can sync from you.'),
          iconSvg: sv('<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>'),
          fields: [
            { key: 'serve_dir',    label: d('fldFolderToHost', 'Folder to host'),  type: 'text',   placeholder: 'C:/Export' },
            { key: 'port',         label: d('fldPort', 'Port'),            type: 'number', placeholder: '8080', default: '8080', half: true },
            { key: 'upload_limit', label: d('fldUlLimit', 'UL limit (KB/s)'), type: 'number', placeholder: d('phUnlimited', '0 = unlimited'), default: '0', half: true },
          ] },
        { id: 'stop_http_host', cat: 'repo', label: d('actionStopHttpHost', 'Stop HTTP host'),
          desc: d('actionStopHttpHostDesc', 'Stops the local HTTP server. No parameters.'),
          iconSvg: sv('<rect x="6" y="6" width="12" height="12" rx="1"/>') },
        { id: 'repo_connect',   cat: 'repo', label: d('actionRepoConnect', 'Connect repo'),
          desc: d('actionRepoConnectDesc', 'Registers a remote BMM repo by URL.'),
          iconSvg: sv('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
          fields: [ { key: 'url', label: d('fldRepoUrl', 'Repo URL'), type: 'text', placeholder: 'https://repo.example.com' } ] },
        { id: 'repo_remove',    cat: 'repo', label: d('actionRepoRemove', 'Remove repo'),
          desc: d('actionRepoRemoveDesc', 'Unregisters a connected repo by URL.'),
          iconSvg: sv('<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>'),
          fields: [ { key: 'url', label: d('fldRepoUrl', 'Repo URL'), type: 'text', placeholder: 'https://repo.example.com' } ] },

        // ── Read (GET — no token required) ────────────────────────────────
        { id: 'get_status',       cat: 'read', label: d('actionGetStatus', 'Get status'),
          desc: d('actionGetStatusDesc', 'Fetches the current BMM status. Prints the JSON response.'),
          iconSvg: sv('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>') },
        { id: 'list_mods',        cat: 'read', label: d('actionListMods', 'List mods'),
          desc: d('actionListModsDesc', 'Lists all mods. Prints the JSON response.'),
          iconSvg: sv('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>') },
        { id: 'list_active_mods', cat: 'read', label: d('actionListActiveMods', 'List active mods'),
          desc: d('actionListActiveModsDesc', 'Lists currently-enabled mods. Prints the JSON response.'),
          iconSvg: sv('<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>') },
        { id: 'list_profiles',    cat: 'read', label: d('actionListProfiles', 'List profiles'),
          desc: d('actionListProfilesDesc', 'Lists all profiles. Prints the JSON response.'),
          iconSvg: sv('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>') },
        { id: 'list_plugins',     cat: 'read', label: d('actionListPlugins', 'List plugins'),
          desc: d('actionListPluginsDesc', 'Lists installed plugins. Prints the JSON response.'),
          iconSvg: sv('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>') },
        { id: 'list_modpacks',    cat: 'read', label: d('actionListModpacks', 'List modpacks'),
          desc: d('actionListModpacksDesc', 'Lists all modpacks. Prints the JSON response.'),
          iconSvg: sv('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>') },
        { id: 'check_update',     cat: 'read', label: d('actionCheckUpdate', 'Check for update'),
          desc: d('actionCheckUpdateDesc', 'Checks whether a BMM update is available. Prints the JSON response.'),
          iconSvg: sv('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>') },
        { id: 'get_creator_id',   cat: 'read', label: d('actionGetCreatorId', 'Get creator ID'),
          desc: d('actionGetCreatorIdDesc', 'Fetches the creator ID. Prints the JSON response.'),
          iconSvg: sv('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>') },
        { id: 'api_health',       cat: 'read', label: d('actionApiHealth', 'API health'),
          desc: d('actionApiHealthDesc', 'Pings the API health endpoint. Prints the JSON response.'),
          iconSvg: sv('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>') },
        { id: 'repo_list',        cat: 'read', label: d('actionRepoList', 'List repos'),
          desc: d('actionRepoListDesc', 'Lists connected repos. Prints the JSON response.'),
          iconSvg: sv('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>') },
        { id: 'repo_info',        cat: 'read', label: d('actionRepoInfo', 'Repo info'),
          desc: d('actionRepoInfoDesc', 'Fetches metadata for a repo by URL. Prints the JSON response.'),
          iconSvg: sv('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'),
          fields: [ { key: 'url', label: d('fldRepoUrl', 'Repo URL'), type: 'text', placeholder: 'https://repo.example.com' } ] },

        // ── System ──────────────────────────────────────────────────────
        { id: 'wait',          cat: 'system', label: d('actionWait', 'Wait'),
          desc: d('actionWaitDesc', 'Pauses the script for N seconds.'),
          iconSvg: sv('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
          fields: [ { key: 'duration_s', label: d('fldSeconds', 'Seconds'), type: 'number', placeholder: '3', default: '3' } ] },
        { id: 'close_process', cat: 'system', label: d('actionCloseProcess', 'Kill process'),
          desc: d('actionCloseProcessDesc', 'Force-terminates a running process by executable name.'),
          iconSvg: sv('<path d="M18 6L6 18M6 6l12 12"/>'),
          fields: [ { key: 'process_name', label: d('fldProcessName', 'Process name'), type: 'text', placeholder: 'notepad.exe' } ] },
        { id: 'open_url',      cat: 'system', label: d('actionOpenUrl', 'Open URL'),
          desc: d('actionOpenUrlDesc', 'Opens a URL in the default browser.'),
          iconSvg: sv('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
          fields: [ { key: 'url', label: d('fldUrl', 'URL'), type: 'text', placeholder: 'https://example.com' } ] },
        { id: 'show_message',  cat: 'system', label: d('actionShowMessage', 'Show message'),
          desc: d('actionShowMessageDesc', 'Displays a message popup or console line, then waits for the user.'),
          iconSvg: sv('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'),
          fields: [ { key: 'message', label: d('fldMessage', 'Message'), type: 'textarea', placeholder: 'Hello world' } ] },
        { id: 'launch_game',   cat: 'system', label: d('actionLaunchGame', 'Launch game'),
          desc: d('actionLaunchGameDesc', 'Starts a game executable then waits 1 second.'),
          iconSvg: sv('<polygon points="5 3 19 12 5 21 5 3"/>'),
          fields: [ { key: 'exe_path', label: d('fldGameExe', 'Game executable'), type: 'text', placeholder: 'C:/Games/MyGame/game.exe' } ] },
        { id: 'log',           cat: 'system', label: d('actionLog', 'Log line'),
          desc: d('actionLogDesc', 'Writes a message to the script\'s standard output / log.'),
          iconSvg: sv('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>'),
          fields: [ { key: 'message', label: d('fldMessage', 'Message'), type: 'text', placeholder: 'Step 1 done' } ] },
        { id: 'restart',       cat: 'system', label: d('actionRestart', 'Restart BMM'),
          desc: d('actionRestartDesc', 'Restarts the BetterModsManager app. No parameters.'),
          iconSvg: sv('<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>') },

        // ── Control flow ────────────────────────────────────────────────
        { id: 'comment',        cat: 'control', label: d('actionComment', 'Comment'),
          desc: d('actionCommentDesc', 'Inserts a comment line — does not execute.'),
          iconSvg: sv('<polyline points="3 6 5 6 21 6"/><path d="M9 14h6"/><path d="M9 10h6"/>'),
          fields: [ { key: 'text', label: d('fldComment', 'Comment'), type: 'text', placeholder: 'This part enables the mods' } ] },
        { id: 'set_variable',   cat: 'control', label: d('actionSetVariable', 'Set variable'),
          desc: d('actionSetVariableDesc', 'Defines a named variable usable later via if_var_eq.'),
          iconSvg: sv('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>'),
          fields: [
            { key: 'var_name',  label: d('fldVarName', 'Variable name'), type: 'text', placeholder: 'MY_VAR', half: true },
            { key: 'var_value', label: d('fldValue', 'Value'),         type: 'text', placeholder: 'hello',  half: true },
          ] },
        { id: 'if_file_exists', cat: 'control', label: d('actionIfFileExists', 'If file exists'),
          desc: d('actionIfFileExistsDesc', 'Subsequent actions run only if the given path exists. Pair with end_block.'),
          iconSvg: sv('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'),
          fields: [ { key: 'path', label: d('fldFilePath', 'File path'), type: 'text', placeholder: 'C:/path/to/file.txt' } ] },
        { id: 'if_file_not_exists', cat: 'control', label: d('actionIfFileNotExists', 'If file is missing'),
          desc: d('actionIfFileNotExistsDesc', 'Subsequent actions run only if the given path does NOT exist. Pair with end_block.'),
          iconSvg: sv('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/>'),
          fields: [ { key: 'path', label: d('fldFilePath', 'File path'), type: 'text', placeholder: 'C:/path/to/file.txt' } ] },
        { id: 'if_var_eq',      cat: 'control', label: d('actionIfVarEq', 'If variable =='),
          desc: d('actionIfVarEqDesc', 'Subsequent actions run only if the variable equals the given value.'),
          iconSvg: sv('<path d="M18 13a3 3 0 1 0-3-3"/><path d="M6 13a3 3 0 1 1 3-3"/><line x1="3" y1="20" x2="21" y2="20"/>'),
          fields: [
            { key: 'var_name',  label: d('fldVariable', 'Variable'), type: 'text', placeholder: 'MY_VAR', half: true },
            { key: 'var_value', label: d('fldEquals', 'Equals'),   type: 'text', placeholder: 'hello',  half: true },
          ] },
        { id: 'if_var_neq',     cat: 'control', label: d('actionIfVarNeq', 'If variable !='),
          desc: d('actionIfVarNeqDesc', 'Subsequent actions run only if the variable does NOT equal the given value.'),
          iconSvg: sv('<path d="M18 13a3 3 0 1 0-3-3"/><path d="M6 13a3 3 0 1 1 3-3"/><line x1="3" y1="20" x2="21" y2="20"/><line x1="4" y1="4" x2="20" y2="20"/>'),
          fields: [
            { key: 'var_name',  label: d('fldVariable', 'Variable'),     type: 'text', placeholder: 'MY_VAR', half: true },
            { key: 'var_value', label: d('fldNotEquals', 'Not equals'), type: 'text', placeholder: 'hello',  half: true },
          ] },
        { id: 'if_api_ok',      cat: 'control', label: d('actionIfApiOk', 'If API call OK'),
          desc: d('actionIfApiOkDesc', 'Runs the linked API call (or checks the previous one) and the inner actions only if it SUCCEEDED. Pair with end_block.'),
          iconSvg: sv('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'),
          fields: [ { key: 'api_action', label: d('fldLinkedApi', 'Linked API'), type: 'select', options: apiActionOpts, default: '' } ] },
        { id: 'if_api_err',     cat: 'control', label: d('actionIfApiErr', 'If API call failed'),
          desc: d('actionIfApiErrDesc', 'Runs the linked API call (or checks the previous one) and the inner actions only if it FAILED (e.g. stop the HTTP host on error). Pair with end_block.'),
          iconSvg: sv('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'),
          fields: [ { key: 'api_action', label: d('fldLinkedApi', 'Linked API'), type: 'select', options: apiActionOpts, default: '' } ] },
        { id: 'else_block',     cat: 'control', label: d('actionElse', 'Else'),
          desc: d('actionElseDesc', 'Marks the else branch of the previous if_*. No parameters.'),
          iconSvg: sv('<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>') },
        { id: 'end_block',      cat: 'control', label: d('actionEnd', 'End block'),
          desc: d('actionEndDesc', 'Closes the previous if_* / else block. No parameters.'),
          iconSvg: sv('<polyline points="20 6 9 17 4 12"/>') },
        { id: 'pause_key',      cat: 'control', label: d('actionPauseKey', 'Pause (wait for key)'),
          desc: d('actionPauseKeyDesc', 'Pauses the script until the user presses a key / Enter. No parameters.'),
          iconSvg: sv('<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>') },
        { id: 'stop_script',    cat: 'control', label: d('actionStopScript', 'Stop script'),
          desc: d('actionStopScriptDesc', 'Exits the script immediately. No parameters.'),
          iconSvg: sv('<rect x="5" y="5" width="14" height="14" rx="2"/>') },
        { id: 'raw_code',       cat: 'control', label: d('actionRawCode', 'Raw code'),
          desc: d('actionRawCodeDesc', 'Inserts native code in the target language verbatim.'),
          iconSvg: sv('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'),
          fields: [ { key: 'code', label: d('fldCode', 'Code'), type: 'textarea', placeholder: 'echo Custom code here' } ] },
    ];
}

function _renderField(cardId: string, f: _Field): string {
    const id = `${cardId}-f-${f.key}`;
    const wcls = f.half ? 'half' : 'full';
    if (f.type === 'select') {
        const opts = (f.options || []).map(o =>
            `<option value="${escHtml(o.value)}"${o.value === (f.default ?? '') ? ' selected' : ''}>${escHtml(o.label)}</option>`
        ).join('');
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
    // text or number
    const val = f.default !== undefined ? escHtml(String(f.default)) : '';
    return `<div class="plug-act-field ${wcls}">
        <label for="${id}">${escHtml(f.label)}</label>
        <input id="${id}" type="${f.type === 'number' ? 'number' : 'text'}" class="input input-sm"
            data-field="${f.key}" placeholder="${escHtml(f.placeholder || '')}" value="${val}">
    </div>`;
}

function _renderTargetSelect(cardId: string, kind: 'mod' | 'profile' | 'plugin'): string {
    let opts = '';
    let emptyLabel = '';
    if (kind === 'mod') {
        opts = _allMods.map(m => `<option value="${escHtml(m.id)}">${escHtml(m.name || m.id)}</option>`).join('');
        emptyLabel = t('plugins.noMods') || 'No mods available';
    } else if (kind === 'profile') {
        opts = _allProfiles.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join('');
        emptyLabel = t('plugins.noProfiles') || 'No profiles available';
    } else {
        opts = _installedPlugins.map(p => `<option value="${escHtml(p.manifest.id)}">${escHtml(p.manifest.name)}</option>`).join('');
        emptyLabel = t('plugins.noPlugins') || 'No plugins installed';
    }
    if (!opts) opts = `<option value="">${escHtml(emptyLabel)}</option>`;
    return `<div class="plug-act-field full">
        <label for="${cardId}-target">${kind === 'mod' ? 'Mod' : kind === 'profile' ? 'Profile' : 'Plugin'}</label>
        <select id="${cardId}-target" class="select select-sm plug-act-target">${opts}</select>
    </div>`;
}

let _actionCardCounter = 0;

function _renderActionCard(def: _ActionDef): HTMLElement {
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
        <div class="plug-act-grip" title="${t('common.move') || 'Move'}">
            <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="2" cy="3" r="1.2"/><circle cx="8" cy="3" r="1.2"/><circle cx="2" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="2" cy="13" r="1.2"/><circle cx="8" cy="13" r="1.2"/></svg>
        </div>
        <div class="plug-act-main">
            <div class="plug-act-head">
                <span class="plug-act-cat-badge" style="background:${meta.color}22;color:${meta.color};border-color:${meta.color}55;">${meta.label}</span>
                <span class="plug-act-icon" style="color:${meta.color};">${def.iconSvg}</span>
                <span class="plug-act-title">${escHtml(def.label)}</span>
                <div class="plug-act-toolbar">
                    <button class="plug-act-btn plug-act-up" title="${t('common.moveUp') || 'Move up'}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>
                    </button>
                    <button class="plug-act-btn plug-act-down" title="${t('common.moveDown') || 'Move down'}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                    <button class="plug-act-btn plug-act-del" title="${t('common.delete') || 'Delete'}">
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
        if (prev && container) container.insertBefore(card, prev);
    });
    card.querySelector('.plug-act-down')?.addEventListener('click', () => {
        const next = card.nextElementSibling;
        if (next && container) container.insertBefore(next, card);
    });

    // Drag-to-reorder via pointer events (native HTML5 DnD is unreliable inside
    // the Tauri webview and was swallowed by the inner form inputs). Dragging is
    // armed only from the grip so the form fields stay fully usable.
    const grip = card.querySelector('.plug-act-grip') as HTMLElement;
    grip?.addEventListener('pointerdown', (e) => _startCardDrag(card, e as PointerEvent));

    return card;
}

/** Find the card that the pointer (at vertical position `y`) should be inserted
 *  before. Returns null when the pointer is past the last card. */
function _cardAfter(container: HTMLElement, y: number): HTMLElement | null {
    const cards = Array.from(
        container.querySelectorAll('.plug-act-card:not(.plug-act-dragging)')
    ) as HTMLElement[];
    let closest: { offset: number; el: HTMLElement | null } = { offset: -Infinity, el: null };
    for (const child of cards) {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) closest = { offset, el: child };
    }
    return closest.el;
}

/** Pointer-based drag: live-reorders the card as the pointer moves, finalising
 *  on pointerup. Works reliably where native drag events do not. */
function _startCardDrag(card: HTMLElement, downEvt: PointerEvent) {
    const container = document.getElementById('plug-actions-container');
    if (!container) return;
    downEvt.preventDefault();

    let active = false;
    const startY = downEvt.clientY;
    const THRESH = 4; // px before a real drag starts (so plain clicks do nothing)

    const onMove = (e: PointerEvent) => {
        if (!active) {
            if (Math.abs(e.clientY - startY) < THRESH) return;
            active = true;
            card.classList.add('plug-act-dragging');
        }
        const after = _cardAfter(container, e.clientY);
        if (after == null) {
            if (card.nextElementSibling !== null) container.appendChild(card);
        } else if (after !== card) {
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
function _openActionPicker(anchorBtn: HTMLElement) {
    const existing = document.getElementById('plug-act-picker');
    if (existing) { existing.remove(); return; }

    const container = document.getElementById('plug-actions-container');
    if (!container) return;

    const catalog = _actionCatalog();
    const grouped: Record<string, _ActionDef[]> = {};
    catalog.forEach(a => { (grouped[a.cat] ||= []).push(a); });

    const pop = document.createElement('div');
    pop.id = 'plug-act-picker';
    pop.className = 'plug-act-picker';
    pop.innerHTML = `
        <div class="plug-act-picker-head">
            <input type="text" class="input input-sm plug-act-picker-search" placeholder="${t('common.search') || 'Search action…'}" autofocus>
        </div>
        <div class="plug-act-picker-body">
            ${(['mods','repo','read','system','control'] as const).map(cat => {
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
    const rect     = anchorBtn.getBoundingClientRect();
    const vw       = window.innerWidth;
    const vh       = window.innerHeight;
    const popW     = 420;
    const popMaxH  = 480;
    const gap      = 6;
    const spaceBelow = vh - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    let top: number, maxH: number;
    if (spaceBelow >= 220 || spaceBelow >= spaceAbove) {
        top  = rect.bottom + gap;
        maxH = Math.max(160, Math.min(popMaxH, spaceBelow - 4));
    } else {
        maxH = Math.max(160, Math.min(popMaxH, spaceAbove - 4));
        top  = rect.top - maxH - gap;
    }
    let left = Math.max(8, rect.right - popW);
    if (left + popW > vw - 8) left = vw - popW - 8;
    pop.style.top       = `${top}px`;
    pop.style.left      = `${left}px`;
    pop.style.maxHeight = `${maxH}px`;

    const search = pop.querySelector('.plug-act-picker-search') as HTMLInputElement;
    search.addEventListener('input', () => {
        const q = search.value.toLowerCase().trim();
        pop.querySelectorAll('.plug-act-pick-item').forEach(el => {
            const item = el as HTMLElement;
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
        const target = e.target as HTMLElement;
        const item = target.closest('.plug-act-pick-item') as HTMLElement | null;
        if (!item) return;
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

    const onOutsideClick = (ev: MouseEvent) => {
        const target = ev.target as Node;
        if (pop.contains(target)) return;
        if (anchorBtn.contains(target as Node) || target === anchorBtn) return;
        dismiss();
    };
    setTimeout(() => document.addEventListener('mousedown', onOutsideClick, true), 0);
}

function addActionRow() {
    // Backwards-compatible default add: appends an "enable_mod" card so the
    // existing init flow that calls addActionRow() at startup still works.
    const def = _actionCatalog().find(a => a.id === 'enable_mod');
    const container = document.getElementById('plug-actions-container');
    if (def && container) container.appendChild(_renderActionCard(def));
}

async function handlePreviewScript() {
    const script = await buildScript();
    if (script == null) return;
    const format      = (document.getElementById('plug-gen-format') as HTMLSelectElement)?.value || 'bat';
    const output      = document.getElementById('plug-gen-output') as HTMLElement;
    const placeholder = document.getElementById('plug-gen-placeholder') as HTMLElement;
    const code        = document.getElementById('plug-gen-code') as HTMLElement;
    if (placeholder) placeholder.style.display = 'none';
    output.style.display = 'flex';
    code.innerHTML = highlightScript(script, format);
    code.dataset.raw = script;
    dispatchBmmAction(BMM_ACTIONS.SCRIPT_GENERATED, { format });
}

async function handleSaveScript() {
    const script = await buildScript();
    if (script == null) return;
    const format = (document.getElementById('plug-gen-format') as HTMLSelectElement)?.value || 'bat';
    const path = await saveFile({ defaultPath: `bmm-script.${format}`, filters: [{ name: 'Script', extensions: [format] }] });
    if (!path) return;
    try {
        await invoke('write_text_file', { path, content: script });
        toast(t('plugins.scriptSaved'), 'success');
    } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
}

async function handleSaveScriptZip() {
    const script = await buildScript();
    if (script == null) return;

    const format    = (document.getElementById('plug-gen-format') as HTMLSelectElement)?.value || 'bat';
    const mode      = (document.getElementById('plug-gen-mode') as HTMLSelectElement)?.value || 'deeplink';
    const useEnv    = (document.getElementById('plug-gen-use-env') as HTMLInputElement)?.checked ?? false;
    const actions   = _collectActions() || [];
    const needApi   = mode === 'api' || _actionsNeedApi(actions, mode === 'deeplink');
    const needsEnv  = needApi && useEnv;

    const zipPath = await saveFile({ defaultPath: `bmm-plugin.zip`, filters: [{ name: 'ZIP Archive', extensions: ['zip'] }] });
    if (!zipPath) return;

    // Build .env content
    const envContent = needsEnv
        ? `# BMM Script — environment variables\n# Do NOT commit this file to version control!\nBMM_TOKEN=${_apiToken}\nBMM_API_BASE=http://127.0.0.1:51274\n`
        : `# BMM Script — no API token required (deeplink mode)\nBMM_API_BASE=http://127.0.0.1:51274\n`;

    // Build .gitignore
    const gitignore = `.env\n*.log\n__pycache__/\nnode_modules/\ntarget/\n`;

    // Build README.md
    const extMap: Record<string,string> = { bat:'cmd', ps1:'powershell', vbs:'cscript', py:'python', lua:'lua', js:'node', rb:'ruby', php:'php', go:'go run', java:'javac + java', cs:'dotnet run', rs:'cargo run' };
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
        needsEnv ? `1. Open \`.env\` and verify your \`BMM_TOKEN\` is correct.\n2. Make sure BMM is running (API on port 51274).\n3. Run the script with \`${runner} bmm-script.${format}\`.` : `1. Make sure BMM is running.\n2. Run: \`${runner} bmm-script.${format}\``,
        ``,
        `## Requirements`,
        _genFormatReqs(format),
        ``,
        `> Generated by [Better Mod Manager](https://github.com/YourRepo/BMM) — ${new Date().toISOString().slice(0,10)}`,
    ].filter(l => l !== '').join('\n');

    try {
        await invoke('write_zip_files', {
            destPath: zipPath,
            files: [
                { name: `bmm-script.${format}`, content: script },
                { name: '.env',                 content: envContent },
                { name: '.gitignore',           content: gitignore },
                { name: 'README.md',            content: readme },
            ],
        });
        toast(t('plugins.scriptZipSaved'), 'success');
    } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
}

function _genFormatReqs(fmt: string): string {
    const map: Record<string,string> = {
        bat: '- Windows CMD (built-in)',
        ps1: '- PowerShell 5+ (built-in on Windows)',
        vbs: '- VBScript / cscript.exe (built-in on Windows)',
        py:  '- Python 3.x + `pip install requests`',
        lua: '- Lua 5.x + `luarocks install http`',
        js:  '- Node.js 18+',
        rb:  '- Ruby 3.x (stdlib only)',
        php: '- PHP 7.4+ with cURL extension',
        go:  '- Go 1.18+',
        java:'- Java 11+ (stdlib only)',
        cs:  '- .NET 6+ (stdlib only)',
        rs:  '- Rust + `reqwest = { features = ["blocking"] }` in Cargo.toml',
    };
    return map[fmt] || `- ${fmt} runtime`;
}

// Snapshot the current script-generator action cards (id + target + field
// values) so they can survive a re-render (e.g. when the UI language changes).
function _snapshotActions(): Array<{ id: string; target: string; fields: Record<string, string | boolean> }> {
    return Array.from(document.querySelectorAll('.plug-act-card')).map(card => {
        const id = (card as HTMLElement).dataset.actionId || '';
        const target = (card.querySelector('.plug-act-target') as HTMLSelectElement | null)?.value || '';
        const fields: Record<string, string | boolean> = {};
        card.querySelectorAll('[data-field]').forEach(el => {
            const key = (el as HTMLElement).dataset.field || '';
            if (!key) return;
            if (el instanceof HTMLInputElement && el.type === 'checkbox') fields[key] = el.checked;
            else fields[key] = (el as any).value || '';
        });
        return { id, target, fields };
    });
}

// Rebuild action cards from a snapshot (used after a language re-render).
function _restoreActions(snap: Array<{ id: string; target: string; fields: Record<string, any> }> | null): void {
    const container = document.getElementById('plug-actions-container');
    if (!container || !snap || !snap.length) return;
    container.innerHTML = ''; // drop the default card renderScripts() adds
    const catalog = _actionCatalog();
    for (const s of snap) {
        const def = catalog.find(d => d.id === s.id);
        if (!def) continue;
        const card = _renderActionCard(def);
        container.appendChild(card);
        const tgt = card.querySelector('.plug-act-target') as HTMLSelectElement | null;
        if (tgt && s.target) tgt.value = s.target;
        for (const [key, val] of Object.entries(s.fields || {})) {
            const el = card.querySelector(`[data-field="${key}"]`) as HTMLInputElement | HTMLSelectElement | null;
            if (!el) continue;
            if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = val === true || val === 'true';
            else (el as any).value = String(val);
        }
    }
}

function _collectActions(): Array<{ action_type: string; target_id: string; extra: Record<string,any> }> | null {
    const cards = document.querySelectorAll('.plug-act-card');
    if (!cards.length) { toast(t('plugins.addActionFirst'), 'warning'); return null; }

    return Array.from(cards).map(card => {
        const type = (card as HTMLElement).dataset.actionId || '';
        const targetEl = card.querySelector('.plug-act-target') as HTMLSelectElement | null;
        const target_id = targetEl?.value || '';

        // Read all labelled inputs in the card → raw key/value map
        const raw: Record<string, string> = {};
        card.querySelectorAll('[data-field]').forEach(el => {
            const key = (el as HTMLElement).dataset.field || '';
            if (!key) return;
            if (el instanceof HTMLInputElement && el.type === 'checkbox') {
                raw[key] = el.checked ? 'true' : 'false';
            } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
                raw[key] = (el as any).value || '';
            }
        });

        // Map per-action raw fields → backend `extra` shape
        const extra: Record<string, any> = {};
        switch (type) {
            case 'wait':
                extra.duration_ms = (parseFloat(raw.duration_s) || 1) * 1000; break;
            case 'close_process':
                extra.process_name = raw.process_name || ''; break;
            case 'open_url':
                extra.url = raw.url || ''; break;
            case 'show_message':
            case 'log':
                extra.message = raw.message || ''; break;
            case 'launch_game':
                extra.exe_path = raw.exe_path || ''; break;
            case 'comment':
                extra.text = raw.text || ''; break;
            case 'set_variable':
                // Backend wants legacy "NAME=value" in extra.expr
                extra.expr = `${raw.var_name || ''}=${raw.var_value || ''}`; break;
            case 'if_file_exists':
            case 'if_file_not_exists':
                extra.path = raw.path || ''; break;
            case 'if_var_eq':
            case 'if_var_neq':
                extra.cond = `${raw.var_name || ''}=${raw.var_value || ''}`; break;
            case 'if_api_ok':
            case 'if_api_err':
                extra.api_action = raw.api_action || ''; break;
            case 'raw_code':
                extra.code = raw.code || ''; break;
            // Repo / modpack actions — store individual typed keys so values
            // with spaces (paths, names) survive intact. Booleans as real
            // booleans, numbers as real numbers.
            case 'sync_repo':
                extra.url            = raw.url || '';
                extra.mods_dir       = raw.mods_dir || '';
                extra.backup_dir     = raw.backup_dir || '';
                extra.game_dir       = raw.game_dir || '';
                extra.overwrite_all  = raw.overwrite_all === 'true';
                extra.delete_extra   = raw.delete_extra === 'true';
                extra.download_limit = parseInt(raw.download_limit || '0', 10) || 0;
                break;
            case 'gen_repo':
                extra.profile_id      = raw.profile_id || '';
                extra.output_dir      = raw.output_dir || '';
                extra.author          = raw.author || '';
                extra.port            = parseInt(raw.port || '8080', 10) || 8080;
                extra.admin_pass      = raw.admin_pass || '';
                extra.upload_limit    = parseInt(raw.upload_limit || '0', 10) || 0;
                extra.lightweight     = raw.lightweight === 'true';
                extra.zip             = raw.zip === 'true';
                extra.generate_server = raw.generate_server === 'true';
                extra.auto_start      = raw.auto_start === 'true';
                break;
            case 'http_host':
                extra.serve_dir    = raw.serve_dir || '';
                extra.port         = parseInt(raw.port || '8080', 10) || 8080;
                extra.upload_limit = parseInt(raw.upload_limit || '0', 10) || 0;
                break;
            case 'update_modpack':
                extra.modpack_id      = raw.modpack_id || '';
                extra.name            = raw.name || '';
                extra.dependency_mode = raw.dependency_mode || 'none';
                break;
            // ── New write/read endpoints ──────────────────────────────────
            case 'update_mod':
                extra.name        = raw.name || '';
                extra.version     = raw.version || '';
                extra.author      = raw.author || '';
                extra.description = raw.description || '';
                break;
            case 'create_profile':
                extra.name        = raw.name || '';
                extra.game_name   = raw.game_name || '';
                extra.game_path   = raw.game_path || '';
                extra.mods_path   = raw.mods_path || '';
                extra.backup_path = raw.backup_path || '';
                break;
            case 'update_profile':
                extra.name        = raw.name || '';
                extra.game_name   = raw.game_name || '';
                extra.color       = raw.color || '';
                extra.icon        = raw.icon || '';
                extra.game_path   = raw.game_path || '';
                extra.mods_path   = raw.mods_path || '';
                extra.backup_path = raw.backup_path || '';
                break;
            case 'create_modpack':
                extra.name            = raw.name || '';
                extra.description     = raw.description || '';
                extra.game_name       = raw.game_name || '';
                extra.sr_link         = raw.sr_link || '';
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

async function buildScript(): Promise<string | null> {
    const format    = (document.getElementById('plug-gen-format') as HTMLSelectElement)?.value || 'bat';
    const mode      = (document.getElementById('plug-gen-mode') as HTMLSelectElement)?.value || 'deeplink';
    const launchBmm = (document.getElementById('plug-gen-launch') as HTMLInputElement)?.checked ?? true;
    const useEnv    = (document.getElementById('plug-gen-use-env') as HTMLInputElement)?.checked ?? false;
    const actions   = _collectActions();
    if (!actions) return null;

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
    } catch (e) {
        toast(`${t('common.error')}: ${e}`, 'error');
        return null;
    }
}

// ── Local script generators (Python / Lua / Node.js) ─────────────────────────

function genScriptLocal(
    format: string,
    actions: Array<{ action_type: string; target_id: string; extra: Record<string,any> }>,
    token: string | null,
    useDeeplink: boolean,
    launchBmm: boolean,
    exePath: string,
    useEnvFile: boolean = false
): string {
    const BASE = 'http://127.0.0.1:51274';
    // When useEnvFile: generated code reads token from env var, not hardcoded
    const ENV_TOKEN_PY   = 'os.environ.get("BMM_TOKEN", "")';
    const ENV_TOKEN_LUA  = 'os.getenv("BMM_TOKEN") or ""';
    const ENV_TOKEN_JS   = 'process.env.BMM_TOKEN || ""';
    const ENV_TOKEN_RB   = 'ENV["BMM_TOKEN"] || ""';
    const ENV_TOKEN_PHP  = 'getenv("BMM_TOKEN") ?: ""';
    const ENV_TOKEN_GO   = 'os.Getenv("BMM_TOKEN")';
    const ENV_TOKEN_JAVA = 'System.getenv("BMM_TOKEN")';
    const ENV_TOKEN_CS   = 'Environment.GetEnvironmentVariable("BMM_TOKEN") ?? ""';
    const ENV_TOKEN_RS   = 'std::env::var("BMM_TOKEN").unwrap_or_default()';

    if (format === 'py') {
        const tok = useEnvFile ? ENV_TOKEN_PY : (token ? JSON.stringify(token) : '"YOUR_TOKEN_HERE"');
        const lines: string[] = [
            '# Generated by BMM Script Generator',
            'import subprocess, time, os, webbrowser',
            'try: import requests',
            'except ImportError: raise SystemExit("pip install requests")',
            '',
            ...(useEnvFile ? ['# Load .env if present (pip install python-dotenv)','try:', '    from dotenv import load_dotenv; load_dotenv()', 'except ImportError: pass', ''] : []),
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
        const lines: string[] = [
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
        const lines: string[] = [
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
        const lines: string[] = [
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
            lines.push('sleep(2)'); lines.push('');
        }
        for (const a of actions) lines.push(..._genericAction(a, 'rb', useEnvFile ? '__ENV__' : token, useDeeplink, BASE));
        return lines.join('\n');
    }

    if (format === 'php') {
        const tok = useEnvFile ? `getenv('BMM_TOKEN') ?: 'YOUR_TOKEN_HERE'` : `'${token || 'YOUR_TOKEN_HERE'}'`;
        const lines: string[] = [
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
            lines.push('sleep(2);'); lines.push('');
        }
        for (const a of actions) lines.push(..._genericAction(a, 'php', useEnvFile ? '__ENV__' : token, useDeeplink, BASE));
        lines.push('?>');
        return lines.join('\n');
    }

    if (format === 'go') {
        const al: string[] = [];
        const goTok = useEnvFile ? `os.Getenv("BMM_TOKEN")` : `"${token || 'YOUR_TOKEN_HERE'}"`;
        for (const a of actions) al.push(..._genericAction(a, 'go', useEnvFile ? '__ENV__' : token, useDeeplink, BASE).map(l => '\t' + l));
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
        const al: string[] = [];
        const javaTok = useEnvFile ? `System.getenv("BMM_TOKEN") != null ? System.getenv("BMM_TOKEN") : "YOUR_TOKEN_HERE"` : `"${token || 'YOUR_TOKEN_HERE'}"`;
        for (const a of actions) al.push(..._genericAction(a, 'java', useEnvFile ? '__ENV__' : token, useDeeplink, BASE).map(l => '        ' + l));
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
        const al: string[] = [];
        const csTok = useEnvFile ? `Environment.GetEnvironmentVariable("BMM_TOKEN") ?? "YOUR_TOKEN_HERE"` : `"${token || 'YOUR_TOKEN_HERE'}"`;
        for (const a of actions) al.push(..._genericAction(a, 'cs', useEnvFile ? '__ENV__' : token, useDeeplink, BASE).map(l => '        ' + l));
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
        const al: string[] = [];
        for (const a of actions) al.push(..._genericAction(a, 'rs', useEnvFile ? '__ENV__' : token, useDeeplink, BASE).map(l => '    ' + l));
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
function _apiBodyFor(a: any): { method: string; path: string; body: Record<string, any> } | null {
    const ex = a.extra || {};
    const s = (k: string) => (typeof ex[k] === 'string' ? ex[k] : (ex[k] != null ? String(ex[k]) : ''));
    const bool = (k: string) => ex[k] === true || ex[k] === 'true';
    const num = (k: string, d = 0) => { const v = parseInt(ex[k], 10); return isNaN(v) ? d : v; };
    switch (a.action_type) {
        case 'enable_mod':       return { method: 'POST', path: '/api/mods/enable',       body: { mod_id: a.target_id } };
        case 'disable_mod':      return { method: 'POST', path: '/api/mods/disable',      body: { mod_id: a.target_id } };
        case 'activate_profile': return { method: 'POST', path: '/api/profiles/activate', body: { profile_id: a.target_id } };
        case 'apply_plugin':     return { method: 'POST', path: '/api/plugins/apply',     body: { plugin_id: a.target_id, force_strict: false } };
        case 'compare_plugin':   return { method: 'POST', path: '/api/plugins/compare',   body: { plugin_id: a.target_id } };
        case 'enable_modpack':   return { method: 'POST', path: '/api/modpacks/enable',   body: { profile_id: a.target_id } };
        case 'disable_modpack':  return { method: 'POST', path: '/api/modpacks/disable',  body: { profile_id: a.target_id } };
        case 'update_modpack':   return { method: 'PUT', path: `/api/modpacks/${s('modpack_id') || 'MODPACK_ID'}`,
            body: { name: s('name'), dependency_mode: s('dependency_mode') || 'none' } };
        case 'sync_repo':        return { method: 'POST', path: '/api/repo/sync', body: {
            url: s('url') || 'REPO_URL', modsDir: s('mods_dir'), backupDir: s('backup_dir'), gameDir: s('game_dir'),
            choices: [], overwriteAll: bool('overwrite_all'), deleteExtra: bool('delete_extra'), downloadLimit: num('download_limit') } };
        case 'gen_repo':         return { method: 'POST', path: '/api/repo/gen', body: {
            profileIds: s('profile_id') ? [s('profile_id')] : [], outputDir: s('output_dir'), authorName: s('author') || 'Author',
            lightweight: bool('lightweight'), zipOutput: bool('zip'), generateServer: bool('generate_server'),
            autoStart: bool('auto_start'), port: num('port', 8080) || 8080, adminPassword: s('admin_pass'), uploadLimit: num('upload_limit') } };
        case 'http_host':        return { method: 'POST', path: '/api/repo/host', body: {
            serveDir: s('serve_dir'), port: num('port', 8080) || 8080, uploadLimit: num('upload_limit') } };
        case 'cancel_sync':      return { method: 'DELETE', path: '/api/repo/sync/cancel', body: {} };
        case 'cancel_gen':       return { method: 'DELETE', path: '/api/repo/gen/cancel',  body: {} };
        case 'stop_http_host':   return { method: 'DELETE', path: '/api/repo/host',        body: {} };

        // ── Read-only (GET, unauthenticated) ──────────────────────────────
        case 'get_status':       return { method: 'GET', path: '/api/status',       body: {} };
        case 'list_mods':        return { method: 'GET', path: '/api/mods',         body: {} };
        case 'list_active_mods': return { method: 'GET', path: '/api/mods/active',  body: {} };
        case 'list_profiles':    return { method: 'GET', path: '/api/profiles',     body: {} };
        case 'list_plugins':     return { method: 'GET', path: '/api/plugins',      body: {} };
        case 'list_modpacks':    return { method: 'GET', path: '/api/modpacks',     body: {} };
        case 'check_update':     return { method: 'GET', path: '/api/check-update', body: {} };
        case 'get_creator_id':   return { method: 'GET', path: '/api/creator-id',   body: {} };
        case 'api_health':       return { method: 'GET', path: '/api/health',       body: {} };
        case 'repo_list':        return { method: 'GET', path: '/api/repo/list',    body: {} };
        case 'repo_info':        return { method: 'GET',
            path: `/api/repo/info?url=${encodeURIComponent(s('url') || 'REPO_URL')}`, body: {} };

        // ── Mods / profiles / modpacks (writes — snake_case bodies) ───────
        case 'delete_mod':       return { method: 'DELETE', path: `/api/mods/${a.target_id || 'MOD_ID'}`, body: {} };
        case 'update_mod':       return { method: 'PUT', path: `/api/mods/${a.target_id || 'MOD_ID'}`,
            body: _prune({ name: s('name'), version: s('version'), author: s('author'), description: s('description') }) };
        case 'create_profile':   return { method: 'POST', path: '/api/profiles', body: {
            name: s('name'), game_name: s('game_name'), game_path: s('game_path'),
            mods_path: s('mods_path'), backup_path: s('backup_path') } };
        case 'update_profile':   return { method: 'PUT', path: `/api/profiles/${a.target_id || 'PROFILE_ID'}`,
            body: _prune({ name: s('name'), game_name: s('game_name'), color: s('color'), icon: s('icon'),
                game_path: s('game_path'), mods_path: s('mods_path'), backup_path: s('backup_path') }) };
        case 'delete_profile':   return { method: 'DELETE', path: `/api/profiles/${a.target_id || 'PROFILE_ID'}`, body: {} };
        case 'restart':          return { method: 'POST', path: '/api/restart', body: {} };
        case 'create_modpack':   return { method: 'POST', path: '/api/modpacks/create',
            body: _prune({ name: s('name'), description: s('description'), game_name: s('game_name'),
                sr_link: s('sr_link'), dependency_mode: s('dependency_mode') || 'none' }) };
        case 'delete_modpack':   return { method: 'DELETE', path: `/api/modpacks/${s('modpack_id') || 'MODPACK_ID'}`, body: {} };
        case 'repo_connect':     return { method: 'POST', path: '/api/repo/connect', body: { url: s('url') || 'REPO_URL' } };
        case 'repo_remove':      return { method: 'DELETE', path: '/api/repo', body: { url: s('url') || 'REPO_URL' } };
        default: return null;
    }
}

// Drops empty-string keys so PUT/update calls don't overwrite fields with "".
function _prune(o: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(o)) if (v !== '' && v != null) out[k] = v;
    return out;
}

// Actions that have a native bmm:// deeplink. Anything else that has an API
// call must fall back to HTTP (and therefore needs a token) even in deeplink
// mode. Mirrors action_to_deeplink in src-tauri/src/commands/plugins.rs.
const _DEEPLINKABLE = new Set([
    'enable_mod', 'disable_mod', 'activate_profile',
    'apply_plugin', 'compare_plugin', 'enable_modpack', 'disable_modpack',
]);

// Returns true if any action will issue an authenticated HTTP call given the
// chosen mode. Mirrors actions_need_api in the Rust backend so the generated
// token block (deeplink fallback) always gets a real token.
function _actionsNeedApi(actions: Array<{ action_type: string }>, useDeeplink: boolean): boolean {
    return actions.some(a => {
        const hasApi = _apiBodyFor(a) !== null;
        if (!hasApi) return false;
        return useDeeplink ? !_DEEPLINKABLE.has(a.action_type) : true;
    });
}

// Generic action renderer for simpler languages (Ruby, PHP, Go, Java, C#, Rust)
function _genericAction(a: any, lang: string, token: string | null, useDeeplink: boolean, base: string): string[] {
    const dlMap: Record<string, string> = {
        enable_mod:       `bmm://mod/enable?id=${a.target_id}`,
        disable_mod:      `bmm://mod/disable?id=${a.target_id}`,
        activate_profile: `bmm://profile/activate?id=${a.target_id}`,
        apply_plugin:     `bmm://plugin/activate?id=${a.target_id}`,
        compare_plugin:   `bmm://plugin/compare?id=${a.target_id}`,
        enable_modpack:   `bmm://modpack/enable?id=${a.target_id}`,
        disable_modpack:  `bmm://modpack/disable?id=${a.target_id}`,
    };

    const comment = (t: string) => lang === 'php' ? `// ${t}` : lang === 'rs' ? `// ${t}` : `// ${t}`;
    const printFn = (msg: string) => ({
        rb: `puts ${JSON.stringify(msg)}`,
        php: `echo ${JSON.stringify(msg)};`,
        go: `fmt.Println(${JSON.stringify(msg)})`,
        java: `System.out.println(${JSON.stringify(msg)});`,
        cs: `Console.WriteLine(${JSON.stringify(msg)});`,
        rs: `println!("{}", ${JSON.stringify(msg)});`,
    })[lang] || `// print: ${msg}`;

    const sleepFn = (ms: number) => {
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
    const phpStr = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    const postFn = (path: string, body: string) => ({
        rb: `bmm_post('${path}', ${body})`,
        php: `bmm_post($base, $token, '${path}', ${phpStr(body)});`,
        go: `bmmPost("${path}", \`${body}\`)`,
        java: `bmmPost("${path}", "${body.replace(/"/g, '\\"')}");`,
        cs: `await Post("${path}", "${body.replace(/"/g, '\\"')}");`,
        rs: isEnv ? `bmm_post("${path}", r#"${body}"#, &base, &token);` : `bmm_post("${path}", r#"${body}"#, BASE, TOKEN);`,
    })[lang] || `// post ${path}`;

    const dlFn = (url: string) => ({
        rb: `system('start "" "${url}"')`,
        php: `shell_exec('start "" "${url}"');`,
        go: `exec.Command("cmd","/c","start","","${url}").Run()`,
        java: `Runtime.getRuntime().exec(new String[]{"cmd","/c","start","","${url}"});`,
        cs: `Process.Start("${url}");`,
        rs: `Command::new("cmd").args(["/c","start","","${url}"]).spawn().ok();`,
    })[lang] || `// open ${url}`;

    // DELETE helper (cancel / stop / delete). Optional JSON body for the few
    // DELETE routes that require one (e.g. DELETE /api/repo needs { url }).
    const delFn = (path: string, body?: string) => {
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
    const putFn = (path: string, body: string) => ({
        rb: `bmm_put('${path}', ${body})`,
        php: `bmm_put($base, $token, '${path}', ${phpStr(body)});`,
        go: `bmmPut("${path}", \`${body}\`)`,
        java: `bmmPut("${path}", "${body.replace(/"/g, '\\"')}");`,
        cs: `await Put("${path}", "${body.replace(/"/g, '\\"')}");`,
        rs: isEnv ? `bmm_put("${path}", r#"${body}"#, &base, &token);` : `bmm_put("${path}", r#"${body}"#, BASE, TOKEN);`,
    })[lang] || `// PUT ${path}`;

    // GET helper — GET endpoints are unauthenticated, so emit a simple inline
    // request (no shared helper / token needed).
    const getFn = (path: string) => ({
        rb: `puts Net::HTTP.get(URI("#{BASE}${path}"))`,
        php: `echo file_get_contents($base . '${path}');`,
        go: `if r, e := http.Get(BASE+"${path}"); e==nil { b,_:=io.ReadAll(r.Body); fmt.Println(string(b)) }`,
        java: `System.out.println(new String(new java.net.URL(BASE + "${path}").openStream().readAllBytes()));`,
        cs: `Console.WriteLine(await new HttpClient().GetStringAsync(BASE + "${path}"));`,
        rs: isEnv ? `if let Ok(r)=reqwest::blocking::get(format!("{}{}",base,"${path}")){ println!("{}", r.text().unwrap_or_default()); }`
                  : `if let Ok(r)=reqwest::blocking::get(format!("{}{}",BASE,"${path}")){ println!("{}", r.text().unwrap_or_default()); }`,
    })[lang] || `// GET ${path}`;

    // Generic dispatch for any API-mapped action without a dedicated case above.
    const genericApi = (): string[] | null => {
        const ep = _apiBodyFor(a);
        if (!ep) return null;
        if (ep.method === 'GET')    return [getFn(ep.path)];
        if (ep.method === 'DELETE') return [delFn(ep.path, JSON.stringify(ep.body))];
        if (ep.method === 'PUT')    return [putFn(ep.path, JSON.stringify(ep.body))];
        return [postFn(ep.path, JSON.stringify(ep.body))];
    };

    switch (a.action_type) {
        case 'enable_mod': case 'disable_mod': case 'activate_profile':
        case 'apply_plugin': case 'compare_plugin':
        case 'enable_modpack': case 'disable_modpack':
        case 'sync_repo': case 'gen_repo': case 'http_host': {
            const dl = dlMap[a.action_type];
            const ep = _apiBodyFor(a)!;
            return [dl && useDeeplink ? dlFn(dl) : postFn(ep.path, JSON.stringify(ep.body))];
        }
        case 'update_modpack': {
            const ep = _apiBodyFor(a)!;
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

function _pyAction(a: any, token: string | null, useDeeplink: boolean, base: string): string[] {
    const isEnvVar = token === '__ENV__';
    const auth = isEnvVar
        ? `headers={"Authorization": f"Bearer {TOKEN}"}`
        : (token ? `headers={"Authorization": "Bearer ${token}"}` : '');
    const deeplink = (path: string, id: string) =>
        `webbrowser.open(f"bmm://${path}/${id}")`;
    // Each call captures `_bmm_ok` so if_api_ok / if_api_err can branch on it.
    const apiPost = (ep: string, body: object) =>
        `_bmm = requests.post(f"{BASE}${ep}", json=${JSON.stringify(body)}${auth ? ', ' + auth : ''}); _bmm_ok = _bmm.ok`;
    const apiDelete = (ep: string, body?: object) =>
        (body && Object.keys(body).length
            ? `_bmm = requests.delete(f"{BASE}${ep}", json=${JSON.stringify(body)}${auth ? ', ' + auth : ''})`
            : `_bmm = requests.delete(f"{BASE}${ep}"${auth ? ', ' + auth : ''})`) + `; _bmm_ok = _bmm.ok`;
    const apiPut = (ep: string, body: object) =>
        `_bmm = requests.put(f"{BASE}${ep}", json=${JSON.stringify(body)}${auth ? ', ' + auth : ''}); _bmm_ok = _bmm.ok`;

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
            const ep = _apiBodyFor(a)!;
            return [`${apiPut(ep.path, ep.body)}`];
        }
        case 'sync_repo': case 'gen_repo': case 'http_host': {
            const ep = _apiBodyFor(a)!;
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
        default: {
            const ep = _apiBodyFor(a);
            if (ep) {
                if (ep.method === 'GET')    return [`_bmm = requests.get(f"{BASE}${ep.path}"); _bmm_ok = _bmm.ok; print(_bmm.text)`];
                if (ep.method === 'DELETE') return [apiDelete(ep.path, ep.body)];
                if (ep.method === 'PUT')    return [apiPut(ep.path, ep.body)];
                return [apiPost(ep.path, ep.body)];
            }
            return [`# Unknown action: ${a.action_type}`];
        }
    }
}

function _luaAction(a: any, token: string | null, useDeeplink: boolean, base: string): string[] {
    // TOKEN and BASE are always declared as locals at the top of the Lua script
    const curlPost = (ep: string, body: string) =>
        `os.execute(('curl -s -X POST %s%s -H "Content-Type: application/json" -H "Authorization: Bearer %s" -d %q'):format(BASE, ${JSON.stringify(ep)}, TOKEN, ${JSON.stringify(body)}))`;
    const curlDelete = (ep: string, body?: string) =>
        body
            ? `os.execute(('curl -s -X DELETE %s%s -H "Content-Type: application/json" -H "Authorization: Bearer %s" -d %q'):format(BASE, ${JSON.stringify(ep)}, TOKEN, ${JSON.stringify(body)}))`
            : `os.execute(('curl -s -X DELETE %s%s -H "Authorization: Bearer %s"'):format(BASE, ${JSON.stringify(ep)}, TOKEN))`;
    const curlPut = (ep: string, body: string) =>
        `os.execute(('curl -s -X PUT %s%s -H "Content-Type: application/json" -H "Authorization: Bearer %s" -d %q'):format(BASE, ${JSON.stringify(ep)}, TOKEN, ${JSON.stringify(body)}))`;
    const curlGet = (ep: string) =>
        `os.execute(('curl -s %s%s'):format(BASE, ${JSON.stringify(ep)}))`;

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
            const ep = _apiBodyFor(a)!;
            return [curlPut(ep.path, JSON.stringify(ep.body))];
        }
        case 'sync_repo': case 'gen_repo': case 'http_host': {
            const ep = _apiBodyFor(a)!;
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
        default: {
            const ep = _apiBodyFor(a);
            if (ep) {
                if (ep.method === 'GET')    return [curlGet(ep.path)];
                if (ep.method === 'DELETE') return [curlDelete(ep.path, Object.keys(ep.body).length ? JSON.stringify(ep.body) : undefined)];
                if (ep.method === 'PUT')    return [curlPut(ep.path, JSON.stringify(ep.body))];
                return [curlPost(ep.path, JSON.stringify(ep.body))];
            }
            return [`-- Unknown action: ${a.action_type}`];
        }
    }
}

function _jsAction(a: any, token: string | null, useDeeplink: boolean, base: string): string[] {
    // bmmPost is the helper declared in the JS generator header
    const apiCall = (ep: string, body: object) =>
        `await bmmPost('${ep}', ${JSON.stringify(body)});`;
    const apiDelete = (ep: string, body?: object) =>
        body && Object.keys(body).length
            ? `await fetch(BASE + '${ep}', { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(${JSON.stringify(body)}) });`
            : `await fetch(BASE + '${ep}', { method: 'DELETE', headers: { Authorization: 'Bearer ' + TOKEN } });`;
    const apiPut = (ep: string, body: object) =>
        `await fetch(BASE + '${ep}', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(${JSON.stringify(body)}) });`;
    const apiGet = (ep: string) =>
        `console.log(await (await fetch(BASE + '${ep}')).text());`;
    const deeplink = (scheme: string, id: string) =>
        `execSync('start bmm://${scheme}/${id}');`;

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
            const ep = _apiBodyFor(a)!;
            return [apiPut(ep.path, ep.body)];
        }
        case 'sync_repo': case 'gen_repo': case 'http_host': {
            const ep = _apiBodyFor(a)!;
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
        default: {
            const ep = _apiBodyFor(a);
            if (ep) {
                if (ep.method === 'GET')    return [apiGet(ep.path)];
                if (ep.method === 'DELETE') return [apiDelete(ep.path, ep.body)];
                if (ep.method === 'PUT')    return [apiPut(ep.path, ep.body)];
                return [apiCall(ep.path, ep.body)];
            }
            return [`// Unknown action: ${a.action_type}`];
        }
    }
}

// ── Tab: Permissions ───────────────────────────────────────────────────────

async function renderPerms(container: HTMLElement) {
    const ALL_PERMS = [
        // ── Mods ──────────────────────
        'read_mods',
        'enable_mods',
        'disable_mods',
        'download_mods',
        'delete_mods',
        // ── Profiles ──────────────────
        'switch_profile',
        'manage_profiles',
        // ── Lists & Modpacks ──────────
        'apply_modlist',
        'compare_modlist',
        'manage_modpacks',
        // ── Server Repo ───────────────
        'manage_repo',
        // ── System ────────────────────
        'use_api',
    ];

    const globalAllowed   = localStorage.getItem('bmm_plug_allow_global') === 'always';
    const deepLinkAllowed = localStorage.getItem('bmm_deeplink_allow_global') !== 'blocked';
    const apiNoAuthAllow  = localStorage.getItem('bmm_api_public_allow') !== 'blocked';
    const unsafeAllowed   = localStorage.getItem('bmm_unsafe_plugins_allow') === 'allowed';

    container.innerHTML = `
        <p class="plug-perms-desc">${IC.shield} ${t('plugins.permsDesc')}</p>

        <!-- ── Global API permissions ─────────────────────────── -->
        <div class="plug-section-card" style="margin-bottom:14px;">
            <h3 class="plug-section-title" style="margin-bottom:10px;">${IC.globe} ${t('plugins.globalApiPermTitle') || 'Permissions globales (API & Deep Links)'}</h3>
            <p style="font-size:11px;color:var(--text-muted);margin:0 0 12px;line-height:1.5;">${t('plugins.globalApiPermDesc') || 'Ces paramètres s\'appliquent à tous les appelants externes : plugins, scripts .bat, PowerShell, applications tierces, etc.'}</p>

            <div class="plug-perm-global-card" style="margin-bottom:8px;">
                <div class="plug-perm-global-inner">
                    <div class="plug-perm-global-icon">${IC.shield}</div>
                    <div class="plug-perm-global-text">
                        <strong>${t('plugins.globalPermTitle')}</strong>
                        <span class="plug-perm-global-sub">${t('plugins.globalPermDesc')}</span>
                    </div>
                    <label class="plug-toggle" style="margin-left:auto;">
                        <input type="checkbox" id="plug-global-allow" ${globalAllowed ? 'checked' : ''}>
                        <span class="plug-toggle-slider"></span>
                    </label>
                </div>
                <p class="plug-perm-global-warn">${IC.alert} ${t('plugins.globalPermWarn')}</p>
            </div>

            <div class="plug-perm-global-card" style="margin-bottom:8px;">
                <div class="plug-perm-global-inner">
                    <div class="plug-perm-global-icon" style="color:#a78bfa;">${IC.zap}</div>
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

            <div class="plug-perm-global-card">
                <div class="plug-perm-global-inner">
                    <div class="plug-perm-global-icon">${IC.globe}</div>
                    <div class="plug-perm-global-text">
                        <strong>${t('plugins.apiPublicPermTitle') || 'Endpoints GET publics actifs'}</strong>
                        <span class="plug-perm-global-sub">${t('plugins.apiPublicPermDesc') || 'Les endpoints GET (health, status, mods...) sont accessibles sans token. Désactivez pour forcer l\'auth sur tout.'}</span>
                    </div>
                    <label class="plug-toggle" style="margin-left:auto;">
                        <input type="checkbox" id="plug-api-public-allow" ${apiNoAuthAllow ? 'checked' : ''}>
                        <span class="plug-toggle-slider"></span>
                    </label>
                </div>
            </div>

            <div class="plug-perm-global-card" style="margin-top:8px;border-color:rgba(239,68,68,0.25);">
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

        <!-- ── Per-plugin permissions ──────────────────────────── -->
        <h3 class="plug-section-title" style="margin-bottom:8px;">${IC.puzzle} ${t('plugins.perPluginPermTitle') || 'Permissions par plugin'}</h3>
        <div id="plug-perms-list"></div>`;

    container.querySelector('#plug-global-allow')?.addEventListener('change', (e) => {
        if ((e.target as HTMLInputElement).checked) {
            localStorage.setItem('bmm_plug_allow_global', 'always');
        } else {
            localStorage.removeItem('bmm_plug_allow_global');
        }
    });
    container.querySelector('#plug-deeplink-allow')?.addEventListener('change', (e) => {
        if ((e.target as HTMLInputElement).checked) {
            localStorage.removeItem('bmm_deeplink_allow_global');
        } else {
            localStorage.setItem('bmm_deeplink_allow_global', 'blocked');
        }
    });
    container.querySelector('#plug-api-public-allow')?.addEventListener('change', (e) => {
        if ((e.target as HTMLInputElement).checked) {
            localStorage.removeItem('bmm_api_public_allow');
        } else {
            localStorage.setItem('bmm_api_public_allow', 'blocked');
        }
        toast(t('plugins.apiPublicPermRestart') || 'Redémarrez BMM pour appliquer ce changement.', 'info');
    });
    container.querySelector('#plug-unsafe-allow')?.addEventListener('change', (e) => {
        const on = (e.target as HTMLInputElement).checked;
        if (on) localStorage.setItem('bmm_unsafe_plugins_allow', 'allowed');
        else    localStorage.removeItem('bmm_unsafe_plugins_allow');
        toast(on
            ? (t('plugins.unsafePluginsEnabled') || 'Unsafe plugins enabled — scripts can run after confirmation.')
            : (t('plugins.unsafePluginsDisabled') || 'Unsafe plugins disabled.'), on ? 'warning' : 'info');
    });

    const list = document.getElementById('plug-perms-list') as HTMLElement;

    if (!_installedPlugins.length) {
        list.innerHTML = `<p style="color:var(--text-muted);font-size:13px;margin:16px 0;text-align:center;">${t('plugins.noPluginsForPerms')}</p>`;
        return;
    }

    // Fetch every plugin's permissions IN PARALLEL (was N sequential awaits,
    // which made the page janky), then render the whole list in one pass.
    const permsArr: string[][] = await Promise.all(
        _installedPlugins.map(p =>
            (invoke('get_plugin_permissions', { pluginId: p.manifest.id }).catch(() => []) as Promise<string[]>)
        )
    );

    list.innerHTML = _installedPlugins.map((plugin, i) => {
        const currentPerms = permsArr[i] || [];
        const id = plugin.manifest.id;
        const alwaysAllowed = localStorage.getItem(`bmm_plug_allow_${id}`) === 'always';
        return `
            <div class="plug-perm-block" data-pid="${escHtml(id)}">
                <div class="plug-perm-header">
                    <div class="plug-card-icon-default" style="width:28px;height:28px;font-size:14px;">${IC.puzzle}</div>
                    <strong>${escHtml(plugin.manifest.name)}</strong>
                    <span class="plug-perm-id">${escHtml(id)}</span>
                    <label class="plug-perm-always" data-tooltip="${t('plugins.alwaysAllow')}">
                        <input type="checkbox" class="plug-perm-always-cb" ${alwaysAllowed ? 'checked' : ''}>
                        <span>${t('plugins.alwaysAllow')}</span>
                    </label>
                </div>
                <div class="plug-perm-grid">
                    ${ALL_PERMS.map(perm => `
                        <label class="plug-perm-item">
                            <input type="checkbox" class="plug-perm-check" data-perm="${perm}"
                                ${(currentPerms.includes(perm) || plugin.manifest.permissions?.includes(perm)) ? 'checked' : ''}>
                            <span>${t('plugins.perm_' + perm)}</span>
                        </label>`).join('')}
                </div>
                <button class="btn btn-sm btn-accent plug-save-perms" data-id="${escHtml(id)}">${IC.save} ${t('plugins.savePerms')}</button>
            </div>`;
    }).join('');

    // Wire listeners once (single pass over the rendered blocks).
    list.querySelectorAll('.plug-perm-block').forEach(block => {
        const id = (block as HTMLElement).dataset.pid || '';
        block.querySelector('.plug-perm-always-cb')?.addEventListener('change', (e) => {
            if ((e.target as HTMLInputElement).checked) localStorage.setItem(`bmm_plug_allow_${id}`, 'always');
            else localStorage.removeItem(`bmm_plug_allow_${id}`);
        });
        block.querySelector('.plug-save-perms')?.addEventListener('click', async () => {
            const perms = Array.from(block.querySelectorAll('.plug-perm-check:checked')).map(c => (c as HTMLInputElement).dataset.perm);
            try {
                await invoke('set_plugin_permissions', { pluginId: id, permissions: perms });
                toast(t('plugins.permsSaved'), 'success');
            } catch (err) { toast(`${t('common.error')}: ${err}`, 'error'); }
        });
    });
}

// ── Permission Dialog ──────────────────────────────────────────────────────

async function requestPermission(pluginId: string, pluginName: string, modNames: string[]): Promise<boolean> {
    if (localStorage.getItem('bmm_plug_allow_global') === 'always') return true;
    const alwaysKey = `bmm_plug_allow_${pluginId}`;
    if (localStorage.getItem(alwaysKey) === 'always') return true;

    const modList = modNames.length
        ? `<ul class="plug-perm-dialog-list">${modNames.map(n => `<li>${IC.check} ${escHtml(n)}</li>`).join('')}</ul>`
        : '';

    const content = `
        <div class="plug-perm-dialog">
            <div class="plug-perm-dialog-info">${IC.shield}<p>${t('plugins.permDialogDesc', { plugin: pluginName })}</p></div>
            ${modList}
            <div class="plug-perm-dialog-buttons">
                <button class="btn btn-accent" id="ppd-once">${t('plugins.permOnce')}</button>
                <button class="btn btn-ghost" id="ppd-always">${t('plugins.permAlways')}</button>
                <button class="btn btn-ghost plug-perm-deny" id="ppd-deny">${t('plugins.permDeny')}</button>
            </div>
        </div>`;

    return new Promise(resolve => {
        const modal = document.getElementById('modal-confirm-generic');
        const titleEl = document.getElementById('confirm-title');
        const msgEl = document.getElementById('confirm-message');
        const btnYes = document.getElementById('btn-confirm-yes');
        const btnCancel = document.getElementById('btn-confirm-cancel');
        const customArea = document.getElementById('confirm-custom-content');

        if (!modal || !titleEl || !btnYes || !btnCancel) { resolve(false); return; }

        titleEl.textContent = t('plugins.permDialogTitle');
        if (msgEl) msgEl.textContent = '';
        if (customArea) customArea.innerHTML = content;
        else if (msgEl) msgEl.innerHTML = content;
        btnYes.style.display = 'none';
        btnCancel.style.display = 'none';

        modal.classList.add('open');

        const cleanup = () => {
            modal.classList.remove('open');
            btnYes.style.display = '';
            btnCancel.style.display = '';
        };

        const onOnce   = () => { cleanup(); resolve(true); };
        const onAlways = () => { localStorage.setItem(alwaysKey, 'always'); cleanup(); resolve(true); };
        const onDeny   = () => { cleanup(); resolve(false); };

        (customArea || msgEl)?.querySelector('#ppd-once')?.addEventListener('click', onOnce, { once: true });
        (customArea || msgEl)?.querySelector('#ppd-always')?.addEventListener('click', onAlways, { once: true });
        (customArea || msgEl)?.querySelector('#ppd-deny')?.addEventListener('click', onDeny, { once: true });
    });
}

// ── Plugin Checksum Modal ─────────────────────────────────────────────────

function handlePluginChecksumModal(manifest: any, installDir: string, hash: string) {
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
        await navigator.clipboard.writeText(hash).catch(() => {});
        toast(t('common.copy'), 'success');
    });
    ov.querySelector('#plug-sha-recalc')?.addEventListener('click', async () => {
        try {
            const newHash: string = await invoke('compute_plugin_checksum', { pluginId: manifest.id });
            ov.remove();
            handlePluginChecksumModal(manifest, installDir, newHash);
            // Update badge
            const badge = document.querySelector(`.plug-btn-sha[data-id="${manifest.id}"]`) as HTMLElement | null;
            if (badge) {
                badge.innerHTML = `${IC.hash} ${newHash.substring(0, 8)}…`;
                badge.classList.remove('plug-sha-badge--pending');
                badge.dataset.full = newHash;
            }
            toast('SHA256 recalculated', 'success');
        } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
    });
    ov.querySelector('#plug-sha-delete')?.addEventListener('click', async () => {
        ov.remove();
        // Uninstall the plugin (reuse handler)
        handleUninstall(manifest.id, manifest.name);
    });
}

// ── Action Handlers ────────────────────────────────────────────────────────

async function handleInstall(downloadUrl: string, name: string) {
    if (!downloadUrl) { toast(t('plugins.noDownloadUrl'), 'error'); return; }
    try {
        toast(`${IC.download} ${t('plugins.installing')} ${name}...`, 'info');
        const plugin = await invoke('install_plugin', { downloadUrl });
        _installedPlugins = _installedPlugins.filter(p => p.manifest.id !== plugin.manifest.id);
        _installedPlugins.push(plugin);
        // Remember the catalog source so this plugin can be auto-updated later.
        try { localStorage.setItem('bmm_plugin_src_' + plugin.manifest.id, downloadUrl); } catch { /* ignore */ }
        toast(t('plugins.installSuccess', { name }), 'success');
        dispatchBmmAction(BMM_ACTIONS.PLUGIN_INSTALLED, { name });
        renderTab(_tab);
    } catch (e) { toast(`${t('plugins.installError')}: ${e}`, 'error'); }
}

async function handleImportFile() {
    const path = await pickFile({ filters: [{ name: 'BMM Plugin', extensions: ['bmmplug', 'zip'] }] });
    if (!path) return;
    try {
        toast(t('plugins.importing'), 'info');
        const plugin = await invoke('install_plugin_from_file', { filePath: path });
        _installedPlugins = _installedPlugins.filter(p => p.manifest.id !== plugin.manifest.id);
        _installedPlugins.push(plugin);
        toast(t('plugins.importSuccess'), 'success');
        renderTab(_tab);
    } catch (e) { toast(`${t('plugins.importError')}: ${e}`, 'error'); }
}

async function handleUninstall(pluginId: string, name: string) {
    const ok = await window.confirmCustom!(
        t('plugins.uninstallTitle'),
        t('plugins.uninstallDesc', { name }),
        'danger',
        { yesLabel: t('common.delete'), noLabel: t('common.cancel') }
    );
    if (!ok) return;
    try {
        await invoke('uninstall_plugin', { pluginId });
        _installedPlugins = _installedPlugins.filter(p => p.manifest.id !== pluginId);
        toast(t('plugins.uninstallSuccess', { name }), 'success');
        renderTab(_tab);
    } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
}

async function handleCompare(pluginId: string) {
    try {
        const result = await invoke('compare_plugin_mods', { pluginId });
        const plugin = _installedPlugins.find(p => p.manifest.id === pluginId);
        // Compare mode: informational only — no Apply button
        const ov = createOverlay(buildCompareContent(result, plugin?.manifest?.name, 'compare'));
        ov.querySelectorAll('.plug-ov-close-btn').forEach(b => b.addEventListener('click', () => ov.remove()));
    } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
}

async function handleApply(pluginId: string) {
    const plugin = _installedPlugins.find(p => p.manifest.id === pluginId);
    const pluginHasScripts = !!plugin?.manifest?.has_scripts || ((plugin?.manifest?.scripts?.length || 0) > 0);
    const applyMode = plugin?.manifest?.apply_mode || 'modlist';

    // "Run scripts only" mode: activating the plugin just runs its scripts.
    if (applyMode === 'script') { await maybeRunPluginScripts(pluginId); return; }

    if (!plugin?.manifest?.modlist?.required_mods?.length) {
        // No mod list: fall back to scripts if the plugin has any.
        if (pluginHasScripts) { await maybeRunPluginScripts(pluginId); return; }
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
    } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
}

async function doApply(pluginId: string, cmp?: any) {
    try {
        // Use provided compare result or fetch fresh one
        const compareResult = cmp ?? await invoke('compare_plugin_mods', { pluginId });

        let enabledCount = 0;
        const notFound: string[] = [];

        // Enable mods that are found but not currently active
        for (const entry of (compareResult.required || [])) {
            if (entry.found && !entry.active && entry.mod_id) {
                try {
                    await invoke('enable_mod', { modId: entry.mod_id, bypassSha: true });
                    enabledCount++;
                } catch (_) {
                    notFound.push(entry.name);
                }
            } else if (!entry.found && !entry.optional) {
                notFound.push(entry.name);
            }
        }

        // Strict mode: disable mods not in the plugin list
        if (compareResult.strict) {
            for (const modName of (compareResult.strict_extra || [])) {
                const m = _allMods.find(m => m.name === modName);
                if (m) {
                    try { await invoke('disable_mod', { modId: m.id }); } catch (_) {}
                }
            }
        }

        toast(t('plugins.applySuccess', { enabled: enabledCount }), 'success');
        if (notFound.length) toast(t('plugins.modsNotFound', { mods: notFound.join(', ') }), 'warning');

        // Refresh mods list
        try {
            const { refreshMods } = await import('../../features/mods/mods.js');
            await refreshMods(true);
        } catch (_) {}

        // Run bundled scripts only when the plugin's apply mode is "both".
        const applyMode = _installedPlugins.find(p => p.manifest.id === pluginId)?.manifest?.apply_mode || 'modlist';
        if (applyMode === 'both') await maybeRunPluginScripts(pluginId);
    } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
}

// ── Unsafe plugin scripts ───────────────────────────────────────────────────
const UNSAFE_PLUGINS_KEY = 'bmm_unsafe_plugins_allow';
export function unsafePluginsAllowed(): boolean {
    return localStorage.getItem(UNSAFE_PLUGINS_KEY) === 'allowed';
}

/** If the plugin ships external scripts, confirm + run them — but only when the
 *  "unsafe plugins" permission is granted. */
async function maybeRunPluginScripts(pluginId: string): Promise<void> {
    const plugin = _installedPlugins.find(p => p.manifest.id === pluginId);
    const allScripts: string[] = plugin?.manifest?.scripts || [];
    const hasScripts = !!plugin?.manifest?.has_scripts || allScripts.length > 0;
    if (!hasScripts) return;

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

    const runOne = async (script: string) => {
        try {
            const launched = await invoke('run_plugin_scripts', { pluginId, script }) as string[];
            toast((t('plugins.scriptsRan') || 'Ran {n} script(s).').replace('{n}', String(launched?.length ?? 0)), 'success');
        } catch (e) {
            toast(`${t('common.error')}: ${e}`, 'error');
        }
    };

    // Let the user pick which script to launch.
    const rows = runnable.map(s =>
        `<button class="plug-script-run-row" data-script="${escHtml(s)}">${IC.play}<code>${escHtml(s)}</code></button>`
    ).join('');
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
        const s = (b as HTMLElement).dataset.script!;
        ov.remove();
        await runOne(s);
    }));
}

async function handleExport(pluginId: string, name: string) {
    const path = await saveFile({ defaultPath: `${pluginId}.bmmplug`, filters: [{ name: 'BMM Plugin', extensions: ['bmmplug'] }] });
    if (!path) return;
    try {
        await invoke('export_plugin', { pluginId, destPath: path });
        toast(t('plugins.exportSuccess', { name }), 'success');
    } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
}

function handleInspect(plugin: any) {
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
        await navigator.clipboard.writeText(json).catch(() => {});
        toast(t('common.copy'), 'success');
    });
    ov.querySelectorAll('.plug-ov-close-btn').forEach(b => b.addEventListener('click', () => ov.remove()));
}

function handleEditPlugin(manifest: any) {
    // Navigate to Create tab with pre-filled data
    const tab = document.querySelector('.plug-tab[data-tab="create"]') as HTMLElement;
    if (tab) tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // Pre-fill after render
    setTimeout(() => prefillCreateTab(manifest), 60);
}

function handleDuplicatePlugin(manifest: any) {
    const copy = JSON.parse(JSON.stringify(manifest));
    copy.id = `${copy.id}-copy`;
    copy.name = `${copy.name} (Copy)`;
    const tab = document.querySelector('.plug-tab[data-tab="create"]') as HTMLElement;
    if (tab) tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    setTimeout(() => prefillCreateTab(copy), 60);
}

function prefillCreateTab(manifest: any) {
    const setVal = (id: string, val: string) => {
        const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
        if (el) el.value = val ?? '';
    };
    setVal('pc-id', manifest.id || '');
    setVal('pc-name', manifest.name || '');
    setVal('pc-version', manifest.version || '1.0.0');
    setVal('pc-game', manifest.game || '');
    setVal('pc-desc', manifest.description || '');
    const strictCb = document.getElementById('pc-strict') as HTMLInputElement | null;
    if (strictCb) {
        strictCb.checked = !!(manifest.modlist?.strict);
        strictCb.dispatchEvent(new Event('change'));
    }
    // Pre-select mods
    const mods: { name: string; optional: boolean }[] = manifest.modlist?.required_mods || [];
    for (const mod of mods) {
        // Find mod item by name and click add
        const items = document.querySelectorAll('.plug-mod-item');
        for (const item of Array.from(items) as HTMLElement[]) {
            if ((item.dataset.name || '').toLowerCase() === mod.name.toLowerCase()) {
                const optCb = item.querySelector('.plug-mod-optional-cb') as HTMLInputElement | null;
                if (optCb) optCb.checked = mod.optional;
                (item.querySelector('.plug-mod-add-btn') as HTMLElement)?.click();
                break;
            }
        }
    }
}

async function handleResetToken() {
    const ok = await window.confirmCustom!(
        t('plugins.resetTokenTitle'),
        t('plugins.resetTokenDesc'),
        'danger',
        { yesLabel: t('plugins.reset'), noLabel: t('common.cancel') }
    );
    if (!ok) return;
    try {
        _apiToken = await invoke('reset_api_token');
        const display = document.getElementById('plug-token-display') as HTMLInputElement;
        if (display) display.value = _apiToken;
        toast(t('plugins.tokenReset'), 'success');
    } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
}

// ── Tab: Docs (redirect to Help & Other > Plugins & API) ──────────────────

function renderDocs(container: HTMLElement) {
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
            </div>
        </div>`;

    container.querySelector('#plug-goto-helpdocs')?.addEventListener('click', () => {
        // Navigate to Help & Other, then activate the plugins-api tab
        const navBtn = document.querySelector('.nav-item[data-view="docs"], .nav-btn[data-view="docs"]') as HTMLElement;
        if (navBtn) {
            navBtn.click();
            setTimeout(() => {
                const tabBtn = document.querySelector('.docs-tab-btn[data-tab="plugins-api"]') as HTMLElement;
                if (tabBtn) tabBtn.click();
            }, 80);
        }
    });
    container.querySelector('#doc-guide-en')?.addEventListener('click', () => {
        invoke('open_file', { path: 'Update\\Guides\\Mod_Identity_Guide_EN.md' }).catch(() => {});
    });
    container.querySelector('#doc-guide-fr')?.addEventListener('click', () => {
        invoke('open_file', { path: 'Update\\Guides\\Mod_Identity_Guide_FR.md' }).catch(() => {});
    });
    container.querySelector('#doc-catalog-guide')?.addEventListener('click', () => {
        invoke('open_file', { path: 'Update\\Guides\\Plugin_Catalog_Guide_EN.md' }).catch(() => {});
    });
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function refreshPlugins() {
    _installedPlugins = await invoke('get_installed_plugins').catch(() => []);
    renderTab(_tab);
}

export async function handleApplyViaDeepLink(pluginId: string): Promise<void> {
    const plugins: any[] = await invoke('get_installed_plugins').catch(() => []);
    const plugin = plugins.find(p => p.manifest.id === pluginId);
    if (!plugin) { toast(t('plugins.deepLinkNotFound', { id: pluginId }), 'error'); return; }
    _installedPlugins = plugins;
    await handleApply(pluginId);
}
