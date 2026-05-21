// @ts-nocheck
import { invoke, pickFile, saveFile } from '../../core/api.js';
import { toast } from '../../ui/app.js';
import { t } from '../../core/i18n.js';
import { escHtml } from '../../core/utils.js';

// ── SVG Icons (no unicode emoji) ───────────────────────────────────────────

const IC = {
  puzzle:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/></svg>`,
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
};

// ── State ──────────────────────────────────────────────────────────────────

let _tab = 'installed';
let _installedPlugins = [];
let _catalog = null;
let _allMods = [];
let _allProfiles = [];
let _apiToken = '';
let _exePath = '';

// ── Init ───────────────────────────────────────────────────────────────────

export async function initPlugins() {
    const view = document.getElementById('view-plugins');
    if (!view) return;
    renderPluginsView();
    setupPluginTabs();
    await loadInitialData();
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
            <button class="plug-tab" data-tab="docs">${IC.info} ${t('plugins.tabDocs')}</button>
        </div>
        <div id="plug-tab-content" class="plug-tab-content"></div>
    `;
}

function setupPluginTabs() {
    const view = document.getElementById('view-plugins');
    if (!view) return;
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
        case 'docs':      renderDocs(container); break;
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

    card.innerHTML = `
        <div class="plug-card-header">
            <div class="plug-card-icon-wrap">
                ${plugin.icon_path
                    ? `<img src="asset://localhost/${plugin.icon_path}" class="plug-card-icon" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
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
                    <button class="btn btn-sm btn-accent plug-btn-compare" data-id="${escHtml(manifest.id)}" title="${t('plugins.compare')}">
                        ${IC.search} ${t('plugins.compare')}
                    </button>
                    <button class="btn btn-sm btn-secondary plug-btn-apply" data-id="${escHtml(manifest.id)}" title="${t('plugins.apply')}">
                        ${IC.play} ${t('plugins.apply')}
                    </button>` : ''}
                <div class="plug-card-actions-right">
                    <button class="btn btn-xs btn-ghost plug-btn-export" data-id="${escHtml(manifest.id)}" title="${t('common.export')}">
                        ${IC.exportIcon}
                    </button>
                    <button class="btn btn-xs btn-danger plug-btn-uninstall" data-id="${escHtml(manifest.id)}" title="${t('plugins.uninstall')}">
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
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
    const onEsc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { ov.remove(); document.removeEventListener('keydown', onEsc); }
    };
    document.addEventListener('keydown', onEsc);
    return ov;
}

function buildCompareContent(result: any, pluginName?: string): string {
    const name = pluginName ?? result.plugin_name ?? '';
    const allOk = result.all_required_active && !(result.strict_extra?.length);

    const rows = (result.required || []).map((entry: any) => {
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

    return `
        <div class="plug-ov-header">
            <span class="plug-ov-title">${IC.search} <strong>${escHtml(name)}</strong></span>
            <button class="btn btn-xs btn-ghost plug-ov-close-btn">${IC.x}</button>
        </div>
        <div class="plug-ov-body">
            <div class="plug-cmp-banner ${allOk ? 'plug-cmp-banner-ok' : 'plug-cmp-banner-warn'}">
                ${allOk ? IC.checkCircle : IC.alert}
                <strong>${allOk ? t('plugins.canJoin') : t('plugins.cannotJoin', { n: result.missing_required ?? 0 })}</strong>
            </div>
            <div class="plug-cmp-list">${rows}</div>
            ${extraRows ? `<div class="plug-cmp-extra-section">
                <div class="plug-cmp-extra-title">${t('plugins.strictExtraTitle')}</div>
                ${extraRows}
            </div>` : ''}
        </div>
        <div class="plug-ov-footer">
            <button class="btn btn-accent" id="plug-ov-apply">${IC.play} ${t('plugins.applyNow')}</button>
            <button class="btn btn-ghost plug-ov-close-btn">${t('common.close')}</button>
        </div>`;
}

async function handleQuickTest(method: string, path: string) {
    const resultDiv = document.getElementById('plug-qt-result') as HTMLElement;
    const statusEl  = document.getElementById('plug-qt-status') as HTMLElement;
    const pathEl    = document.getElementById('plug-qt-path') as HTMLElement;
    const bodyEl    = document.getElementById('plug-qt-body') as HTMLElement;
    if (!resultDiv) return;

    resultDiv.style.display = 'block';
    statusEl.textContent = '...';
    statusEl.className = 'plug-tester-status';
    if (pathEl) pathEl.textContent = `${method} ${path}`;
    bodyEl.textContent = t('common.loading');

    try {
        const res = await fetch(`http://127.0.0.1:51274${path}`, {
            method,
            headers: { 'Authorization': `Bearer ${_apiToken}`, 'Content-Type': 'application/json' },
        });
        const json = await res.json().catch(() => null);
        statusEl.textContent = `${res.status} ${res.statusText}`;
        statusEl.className = `plug-tester-status ${res.ok ? 'plug-status-ok' : 'plug-status-err'}`;
        bodyEl.textContent = json !== null ? JSON.stringify(json, null, 2) : '';
    } catch (e) {
        statusEl.textContent = t('common.error');
        statusEl.className = 'plug-tester-status plug-status-err';
        bodyEl.textContent = String(e);
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
                    <div class="plug-form-row" style="flex-direction:row;align-items:center;gap:12px;">
                        <label class="plug-form-label" style="margin:0;">${t('plugins.strictMode')}</label>
                        <label class="plug-toggle">
                            <input type="checkbox" id="pc-strict">
                            <span class="plug-toggle-slider"></span>
                        </label>
                        <span class="plug-toggle-hint" id="pc-strict-hint">${t('plugins.strictOff')}</span>
                    </div>
                </div>
            </div>

            <div class="plug-create-mods-col">
                <h3 class="plug-section-title">${IC.list} ${t('plugins.createModList')}</h3>
                <div class="plug-mod-selector">
                    <div class="plug-mod-selector-header">
                        <div class="plug-search-wrap">
                            ${IC.search}
                            <input type="text" id="pc-mod-search" class="input plug-search-input" placeholder="${t('plugins.searchMods')}">
                        </div>
                        <select id="pc-profile-filter" class="select" style="font-size:11px;padding:4px 8px;height:30px;" title="${t('plugins.filterByProfile')}">
                            <option value="">${t('plugins.allMods')}</option>
                            ${_allProfiles.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join('')}
                        </select>
                        <span class="plug-mod-count-hint" id="pc-mod-count">0 ${t('plugins.modsSelected')}</span>
                    </div>
                    <div class="plug-mod-available" id="pc-available-mods">
                        ${_allMods.length ? _allMods.map(m => `
                            <div class="plug-mod-item" data-id="${escHtml(m.id)}" data-name="${escHtml(m.name || m.id)}">
                                <span class="plug-mod-item-name">${escHtml(m.name || m.id)}</span>
                                <span class="plug-mod-profile-badge" style="display:none;" title="${t('plugins.activeInProfile')}">${IC.checkCircle}</span>
                                <label class="plug-mod-optional-lbl" title="${t('plugins.optional')}">
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

    // Profile filter
    container.querySelector('#pc-profile-filter')?.addEventListener('change', (e) => {
        const profileId = (e.target as HTMLSelectElement).value;
        const profile = _allProfiles.find(p => p.id === profileId);
        const activeMods = new Set<string>(profile?.active_mods || []);
        container.querySelectorAll('.plug-mod-item').forEach(item => {
            const id = (item as HTMLElement).dataset.id || '';
            const badge = item.querySelector('.plug-mod-profile-badge') as HTMLElement;
            if (badge) badge.style.display = profileId && activeMods.has(id) ? '' : 'none';
        });
    });

    container.querySelector('#pc-mod-search')?.addEventListener('input', (e) => {
        const q = (e.target as HTMLInputElement).value.toLowerCase();
        container.querySelectorAll('.plug-mod-item').forEach(el => {
            const name = (el as HTMLElement).dataset.name?.toLowerCase() || '';
            (el as HTMLElement).style.display = name.includes(q) ? '' : 'none';
        });
    });

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
            const plugin = await invoke('create_local_plugin', { manifest });
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
            await invoke('create_local_plugin', { manifest });
            await invoke('export_plugin', { pluginId: manifest.id, destPath: path });
            toast(t('plugins.exportSuccess', { name: manifest.name }), 'success');
        } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
    });
}

// ── Tab: API & Scripts ─────────────────────────────────────────────────────

function renderScripts(container: HTMLElement) {
    const QT_ENDPOINTS = [
        { m: 'GET',  p: '/api/health',      l: 'Health',      icon: IC.checkCircle },
        { m: 'GET',  p: '/api/status',      l: 'Status',      icon: IC.info },
        { m: 'GET',  p: '/api/mods',        l: 'All Mods',    icon: IC.list },
        { m: 'GET',  p: '/api/mods/active', l: 'Active Mods', icon: IC.check },
        { m: 'GET',  p: '/api/profiles',    l: 'Profiles',    icon: IC.puzzle },
        { m: 'GET',  p: '/api/plugins',     l: 'Plugins',     icon: IC.zap },
    ];

    container.innerHTML = `
        <div class="plug-scripts-root">

            <!-- Token -->
            <div class="plug-section-card plug-token-card">
                <div class="plug-token-card-top">
                    <h3 class="plug-section-title" style="margin:0;">${IC.lock} ${t('plugins.apiToken')}</h3>
                    <span class="plug-api-hint">${IC.info} ${t('plugins.apiHint')} <code>http://127.0.0.1:51274/api/</code></span>
                </div>
                <div class="plug-token-row">
                    <input type="password" id="plug-token-display" class="input plug-token-input" readonly value="${escHtml(_apiToken)}">
                    <button class="btn btn-xs btn-ghost" id="plug-token-eye" title="${t('plugins.showToken')}">${IC.eye}</button>
                    <button class="btn btn-sm btn-ghost" id="plug-copy-token">${IC.copy} ${t('common.copy')}</button>
                    <button class="btn btn-sm btn-danger" id="plug-reset-token">${IC.refresh} ${t('plugins.resetToken')}</button>
                </div>
            </div>

            <div class="plug-scripts-cols">

                <!-- Left: Quick test + endpoints -->
                <div class="plug-section-card">
                    <h3 class="plug-section-title">${IC.zap} ${t('plugins.quickTest')}</h3>
                    <div class="plug-qt-grid">
                        ${QT_ENDPOINTS.map(e =>
                            `<button class="btn btn-sm btn-ghost plug-qt-btn" data-method="${e.m}" data-path="${e.p}" title="${e.m} ${e.p}">
                                ${e.icon} ${e.l}
                            </button>`
                        ).join('')}
                    </div>
                    <div id="plug-qt-result" class="plug-qt-result" style="display:none;">
                        <div class="plug-qt-result-header">
                            <span id="plug-qt-status" class="plug-tester-status"></span>
                            <span id="plug-qt-path" class="plug-qt-path-label"></span>
                            <button class="btn btn-xs btn-ghost" id="plug-qt-copy">${IC.copy}</button>
                        </div>
                        <pre id="plug-qt-body" class="plug-code-pre" style="max-height:220px;overflow:auto;"></pre>
                    </div>

                    <details class="plug-details-section" id="plug-custom-tester">
                        <summary class="plug-details-summary">${IC.terminal} ${t('plugins.customRequest')}</summary>
                        <div class="plug-tester" style="margin: 10px;">
                            <div class="plug-tester-row">
                                <select id="pt-method" class="select select-sm" style="width:80px;">
                                    <option>GET</option><option>POST</option>
                                </select>
                                <input type="text" id="pt-path" class="input input-sm" value="/api/health" style="flex:1;">
                                <button class="btn btn-sm btn-accent" id="pt-run">${IC.play} ${t('plugins.run')}</button>
                            </div>
                            <textarea id="pt-body" class="input plug-tester-body" placeholder='{"key": "value"}  (POST only)'></textarea>
                            <div class="plug-tester-resp" id="pt-response" style="display:none;">
                                <div class="plug-tester-resp-header">
                                    <span id="pt-status-badge" class="plug-tester-status"></span>
                                    <button class="btn btn-xs btn-ghost" id="pt-copy-resp">${IC.copy}</button>
                                </div>
                                <pre id="pt-resp-body" class="plug-code-pre"></pre>
                            </div>
                        </div>
                    </details>

                    <h3 class="plug-section-title" style="margin-top:18px;">${IC.list} ${t('plugins.apiEndpoints')}</h3>
                    <div class="plug-endpoint-list">
                        ${buildEndpointRow('GET',  '/api/health',             t('plugins.endpointHealth'),          false)}
                        ${buildEndpointRow('GET',  '/api/status',             t('plugins.endpointStatus'),          false)}
                        ${buildEndpointRow('GET',  '/api/mods',               t('plugins.endpointMods'),            false)}
                        ${buildEndpointRow('GET',  '/api/mods/active',        t('plugins.endpointModsActive'),      false)}
                        ${buildEndpointRow('GET',  '/api/profiles',           t('plugins.endpointProfiles'),        false)}
                        ${buildEndpointRow('GET',  '/api/plugins',            t('plugins.endpointPlugins'),         false)}
                        ${buildEndpointRow('POST', '/api/mods/enable',        t('plugins.endpointEnableMod'),       true)}
                        ${buildEndpointRow('POST', '/api/mods/disable',       t('plugins.endpointDisableMod'),      true)}
                        ${buildEndpointRow('POST', '/api/profiles/activate',  t('plugins.endpointActivateProfile'), true)}
                        ${buildEndpointRow('POST', '/api/plugins/compare',    t('plugins.endpointCompare'),         true)}
                        ${buildEndpointRow('POST', '/api/plugins/apply',      t('plugins.endpointApply'),           true)}
                    </div>
                </div>

                <!-- Right: Script generator -->
                <div class="plug-section-card">
                    <h3 class="plug-section-title">${IC.terminal} ${t('plugins.scriptGenerator')}</h3>
                    <div class="plug-gen-form">
                        <div class="plug-gen-row2">
                            <div class="plug-form-row">
                                <label class="plug-form-label">${t('plugins.genFormat')}</label>
                                <select id="plug-gen-format" class="select">
                                    <option value="bat">.bat — Windows CMD</option>
                                    <option value="ps1">.ps1 — PowerShell</option>
                                    <option value="vbs">.vbs — VBScript</option>
                                </select>
                            </div>
                            <div class="plug-form-row">
                                <label class="plug-form-label">${t('plugins.genMode')}</label>
                                <select id="plug-gen-mode" class="select">
                                    <option value="deeplink">${t('plugins.genModeDeeplink')}</option>
                                    <option value="api">${t('plugins.genModeApi')}</option>
                                </select>
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
                        <div class="plug-gen-buttons">
                            <button class="btn btn-secondary" id="plug-gen-preview">${IC.eye} ${t('plugins.preview')}</button>
                            <button class="btn btn-accent" id="plug-gen-save">${IC.save} ${t('plugins.saveScript')}</button>
                        </div>
                    </div>
                    <div id="plug-gen-output" class="plug-gen-output" style="display:none;">
                        <div class="plug-gen-output-header">
                            <span class="plug-form-label" style="margin:0;">${t('plugins.preview')}</span>
                            <button class="btn btn-xs btn-ghost" id="plug-copy-script">${IC.copy} ${t('common.copy')}</button>
                        </div>
                        <pre id="plug-gen-code" class="plug-code-pre"></pre>
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
    });
    container.querySelector('#plug-reset-token')?.addEventListener('click', handleResetToken);

    // Quick test
    container.querySelectorAll('.plug-qt-btn').forEach(btn => {
        btn.addEventListener('click', () => handleQuickTest(
            (btn as HTMLElement).dataset.method || 'GET',
            (btn as HTMLElement).dataset.path || '/api/health'
        ));
    });
    container.querySelector('#plug-qt-copy')?.addEventListener('click', () => {
        const txt = document.getElementById('plug-qt-body')?.textContent || '';
        navigator.clipboard.writeText(txt).catch(() => {});
        toast(t('common.copy'), 'success');
    });

    // Custom tester
    container.querySelector('#pt-run')?.addEventListener('click', handleApiTest);
    container.querySelector('#pt-copy-resp')?.addEventListener('click', () => {
        const txt = document.getElementById('pt-resp-body')?.textContent || '';
        navigator.clipboard.writeText(txt).catch(() => {});
        toast(t('common.copy'), 'success');
    });

    // Endpoint click → prefill custom tester
    container.querySelectorAll('.plug-endpoint-row[data-method]').forEach(row => {
        row.addEventListener('click', () => {
            const method = (row as HTMLElement).dataset.method!;
            const path   = (row as HTMLElement).dataset.path!;
            const details = document.getElementById('plug-custom-tester') as HTMLDetailsElement;
            if (details) details.open = true;
            (document.getElementById('pt-method') as HTMLSelectElement).value = method;
            (document.getElementById('pt-path') as HTMLInputElement).value = path;
            const bodyHints: Record<string,string> = {
                '/api/mods/enable':        '{"mod_id": ""}',
                '/api/mods/disable':       '{"mod_id": ""}',
                '/api/profiles/activate':  '{"profile_id": ""}',
                '/api/plugins/compare':    '{"plugin_id": ""}',
                '/api/plugins/apply':      '{"plugin_id": "", "force_strict": false}',
            };
            if (method === 'POST') (document.getElementById('pt-body') as HTMLTextAreaElement).value = bodyHints[path] || '';
        });
    });

    // Script gen
    container.querySelector('#plug-add-action')?.addEventListener('click', addActionRow);
    container.querySelector('#plug-gen-preview')?.addEventListener('click', handlePreviewScript);
    container.querySelector('#plug-gen-save')?.addEventListener('click', handleSaveScript);
    container.querySelector('#plug-copy-script')?.addEventListener('click', async () => {
        const code = document.getElementById('plug-gen-code')?.textContent || '';
        await navigator.clipboard.writeText(code).catch(() => {});
        toast(t('common.copy'), 'success');
    });

    addActionRow();
}

function buildEndpointRow(method: string, path: string, desc: string, needsAuth: boolean) {
    const cls = method === 'GET' ? 'plug-method-get' : 'plug-method-post';
    return `
        <div class="plug-endpoint-row" data-method="${method}" data-path="${path}" style="cursor:pointer;" title="${t('plugins.clickToTest')}">
            <span class="plug-method ${cls}">${method}</span>
            <code class="plug-path">${path}</code>
            <span class="plug-endpoint-desc">${desc}</span>
            ${needsAuth ? `<span class="plug-auth-badge" title="${t('plugins.requiresToken')}">${IC.lock}</span>` : ''}
        </div>`;
}

async function handleApiTest() {
    const method    = (document.getElementById('pt-method') as HTMLSelectElement).value;
    const path      = (document.getElementById('pt-path') as HTMLInputElement).value.trim();
    const bodyText  = (document.getElementById('pt-body') as HTMLTextAreaElement).value.trim();
    const respDiv   = document.getElementById('pt-response') as HTMLElement;
    const respPre   = document.getElementById('pt-resp-body') as HTMLElement;
    const statusBadge = document.getElementById('pt-status-badge') as HTMLElement;

    respDiv.style.display = 'block';
    respPre.textContent = t('common.loading');
    statusBadge.textContent = '...';
    statusBadge.className = 'plug-tester-status';

    try {
        const opts: RequestInit = { method, headers: { 'Authorization': `Bearer ${_apiToken}`, 'Content-Type': 'application/json' } };
        if (method === 'POST' && bodyText) opts.body = bodyText;
        const res = await fetch(`http://127.0.0.1:51274${path}`, opts);
        const json = await res.json().catch(() => null);
        statusBadge.textContent = `${res.status} ${res.statusText}`;
        statusBadge.className = `plug-tester-status ${res.ok ? 'plug-status-ok' : 'plug-status-err'}`;
        respPre.textContent = json !== null ? JSON.stringify(json, null, 2) : '';
    } catch (e) {
        statusBadge.textContent = t('common.error');
        statusBadge.className = 'plug-tester-status plug-status-err';
        respPre.textContent = String(e);
    }
}

function addActionRow() {
    const container = document.getElementById('plug-actions-container');
    if (!container) return;

    const modOpts  = _allMods.map(m => `<option value="${escHtml(m.id)}">${escHtml(m.name || m.id)}</option>`).join('');
    const profOpts = _allProfiles.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join('');
    const plugOpts = _installedPlugins.map(p => `<option value="${escHtml(p.manifest.id)}">${escHtml(p.manifest.name)}</option>`).join('');

    const EXTRA_TYPES = new Set(['wait','close_process','open_url','show_message','launch_game']);
    const EXTRA_PH: Record<string,string> = {
        wait:          t('plugins.waitDuration'),
        close_process: t('plugins.processName'),
        open_url:      t('plugins.urlToOpen'),
        show_message:  t('plugins.messageText'),
        launch_game:   t('plugins.gameExePath'),
    };

    const row = document.createElement('div');
    row.className = 'plug-action-row';
    row.innerHTML = `
        <div class="plug-action-row-inner">
            <div class="plug-action-reorder">
                <button class="btn btn-xs btn-ghost plug-row-up">${IC.arrowUp}</button>
                <button class="btn btn-xs btn-ghost plug-row-down">${IC.arrowDown}</button>
            </div>
            <select class="select select-sm plug-action-type" style="min-width:148px;">
                <optgroup label="BMM">
                    <option value="enable_mod">${t('plugins.actionEnableMod')}</option>
                    <option value="disable_mod">${t('plugins.actionDisableMod')}</option>
                    <option value="activate_profile">${t('plugins.actionActivateProfile')}</option>
                    <option value="apply_plugin">${t('plugins.actionApplyPlugin')}</option>
                    <option value="compare_plugin">${t('plugins.actionComparePlugin')}</option>
                </optgroup>
                <optgroup label="System">
                    <option value="wait">${t('plugins.actionWait')}</option>
                    <option value="close_process">${t('plugins.actionCloseProcess')}</option>
                    <option value="open_url">${t('plugins.actionOpenUrl')}</option>
                    <option value="show_message">${t('plugins.actionShowMessage')}</option>
                    <option value="launch_game">${t('plugins.actionLaunchGame')}</option>
                </optgroup>
            </select>
            <div class="plug-action-target-wrap" style="flex:1;">
                <select class="select select-sm plug-action-target" style="width:100%;">
                    ${modOpts || `<option value="">${t('plugins.noMods')}</option>`}
                </select>
            </div>
            <div class="plug-action-extra-wrap" style="flex:1;display:none;">
                <input type="text" class="input input-sm plug-action-extra-input" style="width:100%;" placeholder="${t('plugins.waitDuration')}">
            </div>
            <button class="btn btn-xs btn-danger plug-remove-action">${IC.x}</button>
        </div>`;

    const typeSelect  = row.querySelector('.plug-action-type') as HTMLSelectElement;
    const targetWrap  = row.querySelector('.plug-action-target-wrap') as HTMLElement;
    const targetSelect = row.querySelector('.plug-action-target') as HTMLSelectElement;
    const extraWrap   = row.querySelector('.plug-action-extra-wrap') as HTMLElement;
    const extraInput  = row.querySelector('.plug-action-extra-input') as HTMLInputElement;

    typeSelect.addEventListener('change', () => {
        const type = typeSelect.value;
        const isExtra = EXTRA_TYPES.has(type);
        targetWrap.style.display  = isExtra ? 'none' : '';
        extraWrap.style.display   = isExtra ? '' : 'none';
        extraInput.placeholder    = EXTRA_PH[type] || '';
        extraInput.type           = type === 'wait' ? 'number' : 'text';
        if (type === 'wait' && !extraInput.value) extraInput.value = '3';

        if (!isExtra) {
            if (type === 'enable_mod' || type === 'disable_mod') {
                targetSelect.innerHTML = modOpts || `<option value="">${t('plugins.noMods')}</option>`;
            } else if (type === 'activate_profile') {
                targetSelect.innerHTML = profOpts || `<option value="">${t('plugins.noProfiles')}</option>`;
            } else {
                targetSelect.innerHTML = plugOpts || `<option value="">${t('plugins.noPlugins')}</option>`;
            }
        }
    });

    row.querySelector('.plug-remove-action')?.addEventListener('click', () => row.remove());
    row.querySelector('.plug-row-up')?.addEventListener('click', () => {
        const prev = row.previousElementSibling;
        if (prev) container.insertBefore(row, prev);
    });
    row.querySelector('.plug-row-down')?.addEventListener('click', () => {
        const next = row.nextElementSibling;
        if (next) container.insertBefore(next, row);
    });

    container.appendChild(row);
}

async function handlePreviewScript() {
    const script = await buildScript();
    if (script == null) return;
    const output = document.getElementById('plug-gen-output') as HTMLElement;
    const code   = document.getElementById('plug-gen-code') as HTMLElement;
    output.style.display = 'block';
    code.textContent = script;
    output.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

async function buildScript(): Promise<string | null> {
    const format    = (document.getElementById('plug-gen-format') as HTMLSelectElement)?.value || 'bat';
    const mode      = (document.getElementById('plug-gen-mode') as HTMLSelectElement)?.value || 'deeplink';
    const launchBmm = (document.getElementById('plug-gen-launch') as HTMLInputElement)?.checked ?? true;
    const rows      = document.querySelectorAll('.plug-action-row');

    if (!rows.length) { toast(t('plugins.addActionFirst'), 'warning'); return null; }

    const actions = Array.from(rows).map(row => {
        const type = (row.querySelector('.plug-action-type') as HTMLSelectElement).value;
        const extra: Record<string, any> = {};
        const extraWrap = row.querySelector('.plug-action-extra-wrap') as HTMLElement;
        const extraInp  = row.querySelector('.plug-action-extra-input') as HTMLInputElement;
        if (extraInp && extraWrap?.style.display !== 'none') {
            const val = extraInp.value.trim();
            switch (type) {
                case 'wait':          extra.duration_ms = (parseFloat(val) || 1) * 1000; break;
                case 'close_process': extra.process_name = val; break;
                case 'open_url':      extra.url = val; break;
                case 'show_message':  extra.message = val; break;
                case 'launch_game':   extra.exe_path = val; break;
            }
        }
        return {
            action_type: type,
            target_id:   (row.querySelector('.plug-action-target') as HTMLSelectElement)?.value || '',
            extra,
        };
    });

    try {
        return await invoke('generate_script', {
            req: { format, actions, use_deeplink: mode === 'deeplink', token: mode === 'api' ? _apiToken : null, launch_bmm: launchBmm, exe_path: _exePath }
        });
    } catch (e) {
        toast(`${t('common.error')}: ${e}`, 'error');
        return null;
    }
}

// ── Tab: Permissions ───────────────────────────────────────────────────────

async function renderPerms(container: HTMLElement) {
    if (!_installedPlugins.length) {
        container.innerHTML = `<div class="plug-empty"><p>${t('plugins.noPluginsForPerms')}</p></div>`;
        return;
    }

    const ALL_PERMS = ['read_mods','enable_mods','disable_mods','switch_profile','apply_modlist','compare_modlist'];

    container.innerHTML = `
        <p class="plug-perms-desc">${IC.shield} ${t('plugins.permsDesc')}</p>
        <div id="plug-perms-list"></div>`;

    const list = document.getElementById('plug-perms-list') as HTMLElement;

    for (const plugin of _installedPlugins) {
        let currentPerms: string[] = [];
        try { currentPerms = await invoke('get_plugin_permissions', { pluginId: plugin.manifest.id }); } catch (_) {}

        const alwaysKey = `bmm_plug_allow_${plugin.manifest.id}`;
        const alwaysAllowed = localStorage.getItem(alwaysKey) === 'always';

        const block = document.createElement('div');
        block.className = 'plug-perm-block';
        block.innerHTML = `
            <div class="plug-perm-header">
                <div class="plug-card-icon-default" style="width:28px;height:28px;font-size:14px;">${IC.puzzle}</div>
                <strong>${escHtml(plugin.manifest.name)}</strong>
                <span class="plug-perm-id">${escHtml(plugin.manifest.id)}</span>
                <label class="plug-perm-always" title="${t('plugins.alwaysAllow')}">
                    <input type="checkbox" id="perm-always-${plugin.manifest.id}" ${alwaysAllowed ? 'checked' : ''}>
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
            <button class="btn btn-sm btn-accent plug-save-perms" data-id="${escHtml(plugin.manifest.id)}">${IC.save} ${t('plugins.savePerms')}</button>
        `;

        block.querySelector(`#perm-always-${plugin.manifest.id}`)?.addEventListener('change', (e) => {
            if ((e.target as HTMLInputElement).checked) localStorage.setItem(alwaysKey, 'always');
            else localStorage.removeItem(alwaysKey);
        });

        block.querySelector('.plug-save-perms')?.addEventListener('click', async (e) => {
            const id = (e.target as HTMLElement).closest('.plug-save-perms')?.dataset.id;
            const checks = block.querySelectorAll('.plug-perm-check:checked');
            const perms = Array.from(checks).map(c => (c as HTMLInputElement).dataset.perm);
            try {
                await invoke('set_plugin_permissions', { pluginId: id, permissions: perms });
                toast(t('plugins.permsSaved'), 'success');
            } catch (err) { toast(`${t('common.error')}: ${err}`, 'error'); }
        });

        list.appendChild(block);
    }
}

// ── Permission Dialog ──────────────────────────────────────────────────────

async function requestPermission(pluginId: string, pluginName: string, modNames: string[]): Promise<boolean> {
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

// ── Action Handlers ────────────────────────────────────────────────────────

async function handleInstall(downloadUrl: string, name: string) {
    if (!downloadUrl) { toast(t('plugins.noDownloadUrl'), 'error'); return; }
    try {
        toast(`${IC.download} ${t('plugins.installing')} ${name}...`, 'info');
        const plugin = await invoke('install_plugin', { downloadUrl });
        _installedPlugins = _installedPlugins.filter(p => p.manifest.id !== plugin.manifest.id);
        _installedPlugins.push(plugin);
        toast(t('plugins.installSuccess', { name }), 'success');
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
        const ov = createOverlay(buildCompareContent(result, plugin?.manifest?.name));
        ov.querySelectorAll('.plug-ov-close-btn').forEach(b => b.addEventListener('click', () => ov.remove()));
        ov.querySelector('#plug-ov-apply')?.addEventListener('click', async () => {
            ov.remove();
            await doApply(pluginId, result);
        });
    } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
}

async function handleApply(pluginId: string) {
    const plugin = _installedPlugins.find(p => p.manifest.id === pluginId);
    if (!plugin?.manifest?.modlist?.required_mods?.length) {
        toast(t('plugins.noModlist'), 'warning');
        return;
    }
    await handleCompare(pluginId);
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
    } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
}

async function handleExport(pluginId: string, name: string) {
    const path = await saveFile({ defaultPath: `${pluginId}.bmmplug`, filters: [{ name: 'BMM Plugin', extensions: ['bmmplug'] }] });
    if (!path) return;
    try {
        await invoke('export_plugin', { pluginId, destPath: path });
        toast(t('plugins.exportSuccess', { name }), 'success');
    } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
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

// ── Tab: Docs ──────────────────────────────────────────────────────────────

function renderDocs(container: HTMLElement) {
    const S = (title: string, icon: string, body: string) => `
        <details class="plug-doc-section" open>
            <summary class="plug-doc-summary">${icon} <strong>${title}</strong></summary>
            <div class="plug-doc-body">${body}</div>
        </details>`;

    const CODE = (c: string) => `<code class="plug-doc-code">${escHtml(c)}</code>`;
    const PRE  = (c: string) => `<pre class="plug-code-pre" style="margin-top:8px;font-size:11px;">${escHtml(c)}</pre>`;
    const H    = (txt: string) => `<p class="plug-doc-h">${txt}</p>`;
    const P    = (txt: string) => `<p class="plug-doc-p">${txt}</p>`;
    const UL   = (items: string[]) => `<ul class="plug-doc-ul">${items.map(i=>`<li>${i}</li>`).join('')}</ul>`;

    container.innerHTML = `
        <div class="plug-docs-root">

            ${S(t('docs.pluginFormatTitle'), IC.puzzle, `
                ${P(t('docs.pluginFormatDesc'))}
                ${H(t('docs.pluginJsonTitle'))}
                ${PRE(`{
  "id": "my-server",
  "name": "My Server Modlist",
  "version": "1.0.0",
  "author": "YourName",
  "game": "DCS World",
  "description": "Required mods for My Server",
  "official": false,
  "permissions": ["read_mods", "enable_mods"],
  "modlist": {
    "strict": false,
    "required_mods": [
      { "name": "Mod Folder Name", "optional": false },
      { "name": "Optional Mod",    "optional": true  }
    ]
  }
}`)}
                ${UL([
                    `${CODE('id')} — ${t('docs.fieldId')}`,
                    `${CODE('name')} — ${t('docs.fieldName')}`,
                    `${CODE('modlist.strict')} — ${t('docs.fieldStrict')}`,
                    `${CODE('required_mods[].name')} — ${t('docs.fieldModName')}`,
                    `${CODE('required_mods[].optional')} — ${t('docs.fieldOptional')}`,
                ])}
                ${H(t('docs.bmmplugTitle'))}
                ${P(t('docs.bmmplugDesc'))}
                ${PRE(`my-plugin.bmmplug  (ZIP file containing)
├── plugin.json     ← required
└── icon.png        ← optional (40×40 recommended)`)}
            `)}

            ${S(t('docs.deepLinkTitle'), IC.globe, `
                ${P(t('docs.deepLinkDesc'))}
                ${UL([
                    `${CODE('bmm://plugin/activate?id=my-server')} — ${t('docs.dlActivate')}`,
                    `${CODE('bmm://plugin/compare?id=my-server')}  — ${t('docs.dlCompare')}`,
                    `${CODE('bmm://mod/enable?id=mod-id')}          — ${t('docs.dlEnableMod')}`,
                    `${CODE('bmm://mod/disable?id=mod-id')}         — ${t('docs.dlDisableMod')}`,
                    `${CODE('bmm://profile/activate?id=prof-id')}   — ${t('docs.dlProfile')}`,
                    `${CODE('bmm://install?url=https://...&name=ModName')} — ${t('docs.dlInstall')}`,
                ])}
                ${H(t('docs.dlScriptTitle'))}
                ${PRE(`start "" "bmm://plugin/activate?id=my-server"`)}
            `)}

            ${S(t('docs.apiTitle'), IC.zap, `
                ${P(t('docs.apiDesc'))} ${CODE('http://127.0.0.1:51274')}
                ${H(t('docs.apiAuth'))}
                ${PRE(`Authorization: Bearer <your-token>`)}
                ${H('GET endpoints (no auth required)')}
                ${UL([
                    `${CODE('GET /api/health')} — ${t('plugins.endpointHealth')}`,
                    `${CODE('GET /api/status')} — ${t('plugins.endpointStatus')}`,
                    `${CODE('GET /api/mods')} — ${t('plugins.endpointMods')}`,
                    `${CODE('GET /api/mods/active')} — ${t('plugins.endpointModsActive')}`,
                    `${CODE('GET /api/profiles')} — ${t('plugins.endpointProfiles')}`,
                    `${CODE('GET /api/plugins')} — ${t('plugins.endpointPlugins')}`,
                ])}
                ${H('POST endpoints (Bearer token required)')}
                ${PRE(`# Enable a mod
curl -X POST http://127.0.0.1:51274/api/mods/enable \\
  -H "Authorization: Bearer TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"mod_id":"my-mod-id"}'

# Apply plugin modlist
curl -X POST http://127.0.0.1:51274/api/plugins/apply \\
  -H "Authorization: Bearer TOKEN" \\
  -d '{"plugin_id":"my-server","force_strict":false}'`)}
                ${H('PowerShell example')}
                ${PRE(`Invoke-RestMethod -Method POST \\
  -Uri "http://127.0.0.1:51274/api/mods/enable" \\
  -Headers @{Authorization="Bearer $TOKEN"} \\
  -Body '{"mod_id":"my-mod-id"}' \\
  -ContentType "application/json"`)}
            `)}

            ${S(t('docs.scriptGenTitle'), IC.terminal, `
                ${P(t('docs.scriptGenDesc'))}
                ${H(t('docs.scriptGenFormats'))}
                ${UL([
                    `${CODE('.bat')} — Windows CMD, works on all Windows versions`,
                    `${CODE('.ps1')} — PowerShell, more reliable, supports long paths`,
                    `${CODE('.vbs')} — VBScript, silent execution (no console window)`,
                ])}
                ${H(t('docs.scriptGenModes'))}
                ${UL([
                    `<strong>Deep links</strong> — ${t('docs.modeDeeplink')}`,
                    `<strong>HTTP API</strong> — ${t('docs.modeApi')}`,
                ])}
                ${H(t('docs.scriptGenActions'))}
                ${UL([
                    `${CODE('enable_mod')} / ${CODE('disable_mod')} — ${t('docs.actEnableDisable')}`,
                    `${CODE('activate_profile')} — ${t('docs.actProfile')}`,
                    `${CODE('apply_plugin')} — ${t('docs.actApply')}`,
                    `${CODE('compare_plugin')} — ${t('docs.actCompare')}`,
                    `${CODE('wait')} — ${t('docs.actWait')}`,
                    `${CODE('close_process')} — ${t('docs.actClose')}`,
                    `${CODE('open_url')} — ${t('docs.actUrl')}`,
                    `${CODE('show_message')} — ${t('docs.actMsg')}`,
                    `${CODE('launch_game')} — ${t('docs.actLaunch')}`,
                ])}
            `)}

            ${S(t('docs.publishTitle'), IC.upload, `
                ${P(t('docs.publishDesc'))}
                ${UL([
                    t('docs.publishStep1'),
                    t('docs.publishStep2'),
                    t('docs.publishStep3'),
                    t('docs.publishStep4'),
                ])}
                <div style="margin-top:12px;">
                    <a class="btn btn-sm btn-ghost" href="https://github.com/BetterDCS/BetterModsManager_Plugins" target="_blank">${IC.globe} BetterDCS/BetterModsManager_Plugins</a>
                    <a class="btn btn-sm btn-ghost" href="https://github.com/FreeProject089/BetterModsManager" target="_blank">${IC.globe} BMM GitHub</a>
                </div>
            `)}

        </div>`;
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
    await handleCompare(pluginId);
}
