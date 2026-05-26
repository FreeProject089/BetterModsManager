// @ts-nocheck
import { invoke, pickFile, saveFile, convertFileSrc } from '../../core/api.js';
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
    // Re-render when user switches language — no full-page refresh needed
    document.addEventListener('langChanged', () => {
        renderPluginsView();
        setupPluginTabs();
        renderTab(_tab);
    });
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
                    </button>
                    <button class="btn btn-sm btn-secondary plug-btn-apply" data-id="${escHtml(manifest.id)}" data-tooltip="${t('plugins.applyTip')}">
                        ${IC.play} ${t('plugins.apply')}
                    </button>` : ''}
                <div class="plug-card-actions-right">
                    ${plugin.install_dir ? `
                    <span class="plug-sha-badge plug-sha-badge--pending plug-btn-sha" data-id="${escHtml(manifest.id)}" data-tooltip="${t('plugins.checksumTitle')}">
                        ${IC.hash} SHA
                    </span>` : ''}
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

function openSmartQuickTest(m: string, p: string, rawBody: string) {
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
            : modSel + txtInput('plug-qt-s-name', 'name (nouveau nom)', 'Nouveau nom du mod', true);
    } else if (p === '/api/profiles/activate') {
        formHtml = profSel;
    } else if (p === '/api/modpacks/enable' || p === '/api/modpacks/disable') {
        formHtml = modpackSel;
    } else if (p === '/api/profiles/:id') {
        formHtml = m === 'DELETE'
            ? profSel + `<p style="font-size:11px;color:var(--danger);margin:8px 0 0;opacity:0.8;">⚠ Cette action est irréversible.</p>`
            : profSel + txtInput('plug-qt-s-name', 'name (nouveau nom)', 'Nouveau nom', true) + txtInput('plug-qt-s-color', 'color', '#3b82f6', true);
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
    } else if (p === '/api/server-repo/connect') {
        formHtml = txtInput('plug-qt-s-url', 'url', 'https://monserveur.com/repo.json')
            + txtInput('plug-qt-s-name', 'name', 'Mon Serveur', true);
    } else if (p === '/api/server-repo/sync') {
        formHtml = txtInput('plug-qt-s-url', 'url', 'https://monserveur.com/repo.json')
            + `<div class="plug-qt-smart-field" style="margin-top:8px;">
                <label class="plug-form-label" style="margin-bottom:4px;">sync_mode</label>
                <select id="plug-qt-s-sync-mode" class="select"><option value="all">all — tous les mods</option><option value="selected">selected — mods spécifiques</option></select>
               </div>`;
    } else if (p === '/api/restart') {
        formHtml = `<p style="font-size:13px;color:var(--text-secondary);margin:0;">BMM va redémarrer dans 300 ms. L'API sera brièvement indisponible.</p>`;
    } else if (p === '/api/modpacks/create') {
        formHtml = txtInput('plug-qt-s-name', 'name (nom du modpack)', 'Mon Modpack', true)
            + `<div class="plug-qt-smart-field" style="margin-top:8px;">
                <label class="plug-form-label" style="margin-bottom:4px;">profile_id (source — optionnel)</label>
                <select id="plug-qt-s-profile" class="select"><option value="">— aucun (modpack vide) —</option>${_allProfiles.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join('')}</select>
               </div>`;
    } else if (p === '/api/server-repo/host') {
        formHtml = txtInput('plug-qt-s-path', 'mods_path (chemin absolu)', 'C:\\mods', true)
            + txtInput('plug-qt-s-secret', 'host_secret', '', true)
            + txtInput('plug-qt-s-name', 'name (optionnel)', 'Mon Repo')
            + `<div class="plug-qt-smart-field" style="margin-top:8px;">
                <label class="plug-form-label" style="margin-bottom:4px;">port (défaut: 8765)</label>
                <input id="plug-qt-s-port" class="input" type="number" value="8765" min="1024" max="65535" style="width:100px;">
               </div>`;
    } else if (p === '/api/modpacks' || p === '/api/server-repo/list') {
        formHtml = `<p style="font-size:13px;color:var(--text-secondary);margin:0;">Requête GET — aucun corps requis.</p>`;
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
            <button class="btn btn-accent" id="plug-qt-s-run">${IC.play} ${t('plugins.run')}</button>
        </div>`);

    overlay.querySelectorAll('.plug-ov-close-btn').forEach(b => b.addEventListener('click', () => overlay.remove()));
    overlay.querySelector('#plug-qt-s-run')?.addEventListener('click', () => {
        let body = '{}';
        let resolvedPath = p;

        if (p === '/api/mods/enable' || p === '/api/mods/disable') {
            body = JSON.stringify({ mod_id: (overlay.querySelector('#plug-qt-s-mod') as HTMLSelectElement)?.value || '' });
        } else if (p === '/api/mods/:id') {
            const modId = (overlay.querySelector('#plug-qt-s-mod') as HTMLSelectElement)?.value || '';
            resolvedPath = `/api/mods/${modId}`;
            if (m === 'PUT') {
                const name = (overlay.querySelector('#plug-qt-s-name') as HTMLInputElement)?.value || '';
                body = name ? JSON.stringify({ name }) : '{}';
            }
        } else if (p === '/api/profiles/activate') {
            body = JSON.stringify({ profile_id: (overlay.querySelector('#plug-qt-s-profile') as HTMLSelectElement)?.value || '' });
        } else if (p === '/api/modpacks/enable' || p === '/api/modpacks/disable') {
            body = JSON.stringify({ modpack_id: (overlay.querySelector('#plug-qt-s-modpack') as HTMLSelectElement)?.value || '' });
        } else if (p === '/api/profiles/:id') {
            const profId = (overlay.querySelector('#plug-qt-s-profile') as HTMLSelectElement)?.value || '';
            resolvedPath = `/api/profiles/${profId}`;
            if (m === 'PUT') {
                const name  = (overlay.querySelector('#plug-qt-s-name')  as HTMLInputElement)?.value || '';
                const color = (overlay.querySelector('#plug-qt-s-color') as HTMLInputElement)?.value || '';
                const obj: any = {};
                if (name)  obj.name  = name;
                if (color) obj.color = color;
                body = JSON.stringify(obj);
            }
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
        } else if (p === '/api/server-repo/connect') {
            const url  = (overlay.querySelector('#plug-qt-s-url')  as HTMLInputElement)?.value || '';
            const name = (overlay.querySelector('#plug-qt-s-name') as HTMLInputElement)?.value || '';
            if (!url) return;
            body = JSON.stringify({ url, name });
        } else if (p === '/api/server-repo/sync') {
            const url  = (overlay.querySelector('#plug-qt-s-url')       as HTMLInputElement)?.value || '';
            const mode = (overlay.querySelector('#plug-qt-s-sync-mode') as HTMLSelectElement)?.value || 'all';
            if (!url) return;
            overlay.remove();
            (document.querySelector('.nav-item[data-view="repo"]') as HTMLElement)?.click();
            setTimeout(() => {
                const urlInput = document.getElementById('repo-sync-url') as HTMLInputElement | null;
                if (urlInput) { urlInput.value = url; urlInput.dispatchEvent(new Event('input')); }
                const fetchBtn = document.getElementById('btn-fetch-repo-info') as HTMLElement | null;
                if (fetchBtn) fetchBtn.click();
            }, 500);
            return;
        } else if (p === '/api/restart') {
            body = '{}';
        } else if (p === '/api/modpacks/create') {
            const name   = (overlay.querySelector('#plug-qt-s-name')    as HTMLInputElement)?.value || '';
            const profId = (overlay.querySelector('#plug-qt-s-profile') as HTMLSelectElement)?.value || '';
            if (!name) return;
            body = JSON.stringify({ name, ...(profId ? { profile_id: profId } : {}) });
        } else if (p === '/api/server-repo/host') {
            const modsPath  = (overlay.querySelector('#plug-qt-s-path')   as HTMLInputElement)?.value || '';
            const secret    = (overlay.querySelector('#plug-qt-s-secret') as HTMLInputElement)?.value || '';
            const name      = (overlay.querySelector('#plug-qt-s-name')   as HTMLInputElement)?.value || '';
            const port      = parseInt((overlay.querySelector('#plug-qt-s-port') as HTMLInputElement)?.value || '8765', 10);
            if (!modsPath || !secret) return;
            body = JSON.stringify({ mods_path: modsPath, host_secret: secret, port, ...(name ? { name } : {}) });
        } else if (p === '/api/modpacks' || p === '/api/server-repo/list') {
            body = '';
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

async function handleQuickTest(method: string, path: string, body?: string) {
    const resultDiv = document.getElementById('plug-qt-result') as HTMLElement;
    const statusEl  = document.getElementById('plug-qt-status') as HTMLElement;
    const pathEl    = document.getElementById('plug-qt-path') as HTMLElement;
    const bodyEl    = document.getElementById('plug-qt-body') as HTMLElement;
    if (!resultDiv) return;

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
        if (method === 'POST' && body) opts.body = body;
        const res = await fetch(`http://127.0.0.1:51274${path}`, opts);
        const json = await res.json().catch(() => null);
        statusEl.textContent = `${res.status} ${res.statusText}`;
        statusEl.className = `plug-tester-status ${res.ok ? 'plug-status-ok' : 'plug-status-err'}`;
        const pretty = json !== null ? JSON.stringify(json, null, 2) : '';
        bodyEl.innerHTML = hlJson(pretty);
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
                                        ${Object.entries(IC).map(([k, svg]) => `<button class="plug-icon-builtin-btn" data-ickey="${k}" title="${k}">${svg}</button>`).join('')}
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
                            <select id="pc-profile-filter" class="select" style="font-size:11px;padding:4px 8px;height:28px;border-radius:6px;" title="${t('plugins.filterByProfile')}">
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
                                <span class="plug-mod-profile-badge" style="display:none;" title="${t('plugins.activeInProfile')}">${IC.checkCircle}</span>
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
            });
            await invoke('export_plugin', { pluginId: manifest.id, destPath: path });
            toast(t('plugins.exportSuccess', { name: manifest.name }), 'success');
        } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
    });
}

// ── Tab: API & Scripts ─────────────────────────────────────────────────────

function renderScripts(container: HTMLElement) {
    const QT_ENDPOINTS = [
        { m: 'GET',    p: '/api/health',              l: 'Health',           icon: IC.checkCircle },
        { m: 'GET',    p: '/api/status',              l: 'Status',           icon: IC.info },
        { m: 'GET',    p: '/api/check-update',        l: 'Check Update',     icon: IC.refresh },
        { m: 'GET',    p: '/api/mods',                l: 'All Mods',         icon: IC.list },
        { m: 'GET',    p: '/api/mods/active',         l: 'Active Mods',      icon: IC.check },
        { m: 'GET',    p: '/api/profiles',            l: 'Profiles',         icon: IC.puzzle },
        { m: 'GET',    p: '/api/plugins',             l: 'Plugins',          icon: IC.zap },
        { m: 'GET',    p: '/api/creator-id',          l: 'Creator ID',       icon: IC.shield },
        { m: 'POST',   p: '/api/mods/enable',         l: 'Enable Mod',       icon: IC.check,      body: '{"mod_id":""}' },
        { m: 'POST',   p: '/api/mods/disable',        l: 'Disable Mod',      icon: IC.x,          body: '{"mod_id":""}' },
        { m: 'POST',   p: '/api/profiles/activate',   l: 'Activate Profile', icon: IC.puzzle,     body: '{"profile_id":""}' },
        { m: 'POST',   p: '/api/profiles',            l: 'Create Profile',   icon: IC.plus,       body: '{"name":"","game_path":"","mods_path":"","backup_path":""}' },
        { m: 'POST',   p: '/api/plugins/apply',       l: 'Apply Plugin',     icon: IC.zap,        body: '{"plugin_id":"","force_strict":false}' },
        { m: 'POST',   p: '/api/plugins/compare',     l: 'Compare Plugin',   icon: IC.shield,     body: '{"plugin_id":""}' },
        { m: 'POST',   p: '/api/modpacks/enable',     l: 'Enable Modpack',   icon: IC.folder,     body: '{"modpack_id":""}' },
        { m: 'POST',   p: '/api/modpacks/disable',    l: 'Disable Modpack',  icon: IC.folder,     body: '{"modpack_id":""}' },
        { m: 'POST',   p: '/api/modpacks/create',     l: 'Create Modpack',   icon: IC.plus,       body: '{"name":"","profile_id":""}' },
        { m: 'POST',   p: '/api/server-repo/connect', l: 'Connect Repo',     icon: IC.globe,      body: '{"url":"https://","name":""}' },
        { m: 'POST',   p: '/api/server-repo/sync',    l: 'Sync Repo',        icon: IC.refresh,    body: '{"url":"https://","sync_mode":"all"}' },
        { m: 'POST',   p: '/api/server-repo/host',    l: 'Host Repo',        icon: IC.upload,     body: '{"mods_path":"","host_secret":"","port":8765}' },
        { m: 'POST',   p: '/api/restart',             l: 'Restart BMM',      icon: IC.refresh,    body: '' },
        { m: 'GET',    p: '/api/modpacks',            l: 'List Modpacks',    icon: IC.list },
        { m: 'GET',    p: '/api/server-repo/list',    l: 'Repo List',        icon: IC.globe },
        { m: 'PUT',    p: '/api/profiles/:id',        l: 'Update Profile',   icon: IC.editIcon,   body: '{"name":""}' },
        { m: 'PUT',    p: '/api/mods/:id',            l: 'Update Mod',       icon: IC.editIcon,   body: '{"name":""}' },
        { m: 'DELETE', p: '/api/mods/:id',            l: 'Delete Mod',       icon: IC.trash },
        { m: 'DELETE', p: '/api/profiles/:id',        l: 'Delete Profile',   icon: IC.trash },
    ];

    container.innerHTML = `
        <div class="plug-scripts-root">

            <!-- Token -->
            <div class="plug-section-card plug-token-card">
                <div class="plug-token-card-top">
                    <h3 class="plug-section-title" style="margin:0;">${IC.lock} ${t('plugins.apiToken')}</h3>
                    <span class="plug-api-hint">${IC.info} ${t('plugins.apiHint')} <code id="plug-api-base-url" class="plug-api-url-copy" title="${t('plugins.copyApiUrl')}">http://127.0.0.1:51274/api/</code></span>
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
                <div class="plug-qt-grid">
                    ${QT_ENDPOINTS.map(e => {
                        const mc = e.m.toLowerCase();
                        const badge = `<span class="plug-qt-method-badge plug-qt-${mc}">${e.m}</span>`;
                        const body = (e as any).body !== undefined ? ` data-body="${escHtml((e as any).body || '')}"` : '';
                        return `<button class="plug-qt-btn" data-method="${e.m}" data-path="${e.p}"${body} data-tooltip="${e.m} ${e.p}">
                            ${e.icon} <span>${e.l}</span>${badge}
                        </button>`;
                    }).join('')}
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
                        <textarea id="pt-body" class="input plug-tester-body" placeholder='{"key": "value"}  — POST only'></textarea>
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
                <div class="plug-endpoint-list" id="plug-ep-list">
                    ${(() => { const defs = getEndpointDefs(); defs.forEach(ep => { const sid = ep.path.replace(/\//g,'_').replace(/^_/,''); _epCodeCache.set(sid, ep); }); return defs.map(ep => buildEndpointRow(ep)).join(''); })()}
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
                                <input type="checkbox" id="plug-gen-use-env" checked>
                                <span class="plug-toggle-slider"></span>
                            </label>
                            <span id="plug-gen-token-hint" class="plug-mode-hint-txt" style="flex:1;">${t('plugins.genTokenEnvOn')}</span>
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
                            <pre id="plug-gen-code" class="plug-code-pre" style="flex:1;overflow:auto;"></pre>
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
            const needsOverlay = p.includes(':id') || ((m === 'POST' || m === 'PUT' || m === 'PATCH') && rawBody !== undefined);
            if (needsOverlay) {
                openSmartQuickTest(m, p, rawBody || '{}');
            } else {
                handleQuickTest(m, p);
            }
        });
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
            '/api/mods/enable':           '{\n  "mod_id": ""\n}',
            '/api/mods/disable':          '{\n  "mod_id": ""\n}',
            '/api/mods/:id':              '{\n  "name": ""\n}',
            '/api/profiles/activate':     '{\n  "profile_id": ""\n}',
            '/api/profiles':              '{\n  "name": "",\n  "game_path": "",\n  "mods_path": "",\n  "backup_path": ""\n}',
            '/api/profiles/:id':          '{\n  "name": ""\n}',
            '/api/plugins/compare':       '{\n  "plugin_id": ""\n}',
            '/api/plugins/apply':         '{\n  "plugin_id": "",\n  "force_strict": false\n}',
            '/api/modpacks/enable':       '{\n  "modpack_id": ""\n}',
            '/api/modpacks/disable':      '{\n  "modpack_id": ""\n}',
            '/api/modpacks/create':       '{\n  "name": "",\n  "profile_id": ""\n}',
            '/api/server-repo/connect':   '{\n  "url": "https://",\n  "name": ""\n}',
            '/api/server-repo/sync':      '{\n  "url": "https://",\n  "sync_mode": "all"\n}',
            '/api/server-repo/host':      '{\n  "mods_path": "",\n  "host_secret": "",\n  "port": 8765,\n  "name": ""\n}',
            '/api/restart':               '',
        };
        bodyTa.value = (method !== 'GET' && method !== 'DELETE') ? (bodyHints[path] ?? '') : '';
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
            const text = ep ? (() => {
                const div = document.createElement('div');
                div.innerHTML = _genCode(ep, lang);
                return div.textContent || '';
            })() : (pre?.textContent || '');
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

    // Endpoint URL copy buttons (url path copy)
    container.querySelectorAll('.plug-ep-copy-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const path = (btn as HTMLElement).dataset.copy || '';
            const full = `http://127.0.0.1:51274${path}`;
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
    container.querySelector('#plug-add-action')?.addEventListener('click', addActionRow);
    container.querySelector('#plug-gen-preview')?.addEventListener('click', handlePreviewScript);
    container.querySelector('#plug-gen-save')?.addEventListener('click', handleSaveScript);
    container.querySelector('#plug-gen-zip')?.addEventListener('click', handleSaveScriptZip);
    container.querySelector('#plug-copy-script')?.addEventListener('click', async () => {
        const codeEl = document.getElementById('plug-gen-code');
        const raw = codeEl?.dataset.raw || codeEl?.textContent || '';
        await navigator.clipboard.writeText(raw).catch(() => {});
        toast(t('common.copy'), 'success');
    });

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
    if (ep.method === 'GET') {
        const auth = ep.auth ? `\n  -Headers @{Authorization="Bearer $TOKEN"} \\` : '';
        return `Invoke-RestMethod \\\n  -Uri "${url}" \\${auth}\n  -Method GET`;
    }
    const body = ep.fields
        ? JSON.stringify(Object.fromEntries(ep.fields.map(f => [f.name, f.type === 'boolean' ? false : f.type === 'number' ? 0 : ''])), null, 2)
        : '{}';
    return `Invoke-RestMethod \\\n  -Uri "${url}" \\\n  -Method POST \\\n  -Headers @{Authorization="Bearer $TOKEN"; "Content-Type"="application/json"} \\\n  -Body '${body}'`;
}

function buildEndpointRow(ep: EndpointDef): string {
    const methodCls: Record<string, string> = {
        GET: 'plug-method-get', POST: 'plug-method-post',
        PUT: 'plug-method-put', DELETE: 'plug-method-delete', PATCH: 'plug-method-patch',
    };
    const cls = methodCls[ep.method] || 'plug-method-get';
    const safeId = ep.path.replace(/\//g, '_').replace(/^_/, '');

    const fieldsHtml = ep.fields ? `
        <div class="plug-ep-fields">
            <div class="plug-ep-section-lbl">${t('plugins.epRequestBody')}</div>
            <table class="plug-ep-fields-table">
                <colgroup><col class="col-field"><col class="col-type"><col class="col-req"><col class="col-desc"></colgroup>
                <thead><tr><th>Field</th><th>Type</th><th></th><th>Description</th></tr></thead>
                <tbody>
                    ${ep.fields.map(f => `<tr>
                        <td style="white-space:nowrap;min-width:80px;"><code class="plug-ep-fname" title="${escHtml(f.name)}">${escHtml(f.name)}</code></td>
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

    return `
        <div class="plug-ep-wrap" id="epw-${safeId}">
            <div class="plug-endpoint-row" data-method="${ep.method}" data-path="${ep.path}" data-ep-id="${safeId}">
                <button class="plug-ep-chevron" id="epchev-${safeId}" aria-label="expand" data-tooltip="${t('plugins.epExpandTip')}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <span class="plug-method ${cls}">${ep.method}</span>
                <code class="plug-path">${ep.path}</code>
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
            desc: t('plugins.endpointHealth'), about: 'Lightweight liveness probe — no auth needed. Use this to verify the BMM API server is running.',
            fields: null,
            responseStatuses: [{ code: 200, label: 'OK', body: '{ "ok": true, "service": "BMM Plugin API", "port": 51274 }' }],
        },
        {
            method: 'GET', path: '/api/status', auth: false,
            desc: t('plugins.endpointStatus'), about: 'Returns the application version, active profile, and aggregate counts for mods/profiles/plugins.',
            fields: null,
            responseStatuses: [{ code: 200, label: 'OK', body: '{ "ok": true, "version": "1.2.0", "active_profile": { "id": "abc", "name": "DCS World" }, "mod_count": 42, "profile_count": 3, "plugin_count": 1 }' }],
        },
        {
            method: 'GET', path: '/api/check-update', auth: false,
            desc: t('plugins.endpointCheckUpdate') || 'Check for BMM updates',
            about: 'Fetches the latest release from GitHub and compares it to the running version. Returns whether an update is available and the release URL.',
            fields: null,
            responseStatuses: [{ code: 200, label: 'OK', body: '{ "ok": true, "current": "1.2.0", "latest": "1.3.0", "has_update": true, "release_url": "https://github.com/FreeProject089/BetterModsManager/releases/latest" }' }],
        },
        {
            method: 'POST', path: '/api/restart', auth: true,
            desc: t('plugins.endpointRestart') || 'Restart BMM',
            about: 'Gracefully restarts the BMM application. The process exits and relaunches after a 300 ms delay. The API will become briefly unavailable.',
            fields: null,
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "message": "Restarting..." }' },
                e401,
            ],
        },
        // ── Mods ────────────────────────────────────────────────────────────
        {
            method: 'GET', path: '/api/mods', auth: false,
            desc: t('plugins.endpointMods'), about: 'Returns all mods visible in the active profile, including their enabled/active state and folder path.',
            fields: null,
            responseStatuses: [{ code: 200, label: 'OK', body: '{ "ok": true, "data": [{ "id": "mod-uuid", "name": "MyMod", "active": true, "enabled": true, "path": "C:/mods/MyMod" }] }' }],
        },
        {
            method: 'GET', path: '/api/mods/active', auth: false,
            desc: t('plugins.endpointModsActive'), about: 'Shorthand for listing only enabled mods in the active profile.',
            fields: null,
            responseStatuses: [{ code: 200, label: 'OK', body: '{ "ok": true, "data": [{ "id": "mod-uuid", "name": "MyMod", "active": true }] }' }],
        },
        {
            method: 'POST', path: '/api/mods/enable', auth: true,
            desc: t('plugins.endpointEnableMod'), about: 'Enables a single mod by its ID. Applies to the currently active profile.',
            fields: [{ name: 'mod_id', type: 'string', required: true, desc: 'UUID of the mod to enable (use GET /api/mods to find IDs).' }],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "mod_id": "mod-uuid" }' },
                e401, e404,
            ],
        },
        {
            method: 'POST', path: '/api/mods/disable', auth: true,
            desc: t('plugins.endpointDisableMod'), about: 'Disables a single mod by its ID. Applies to the currently active profile.',
            fields: [{ name: 'mod_id', type: 'string', required: true, desc: 'UUID of the mod to disable.' }],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "mod_id": "mod-uuid" }' },
                e401, e404,
            ],
        },
        {
            method: 'PUT', path: '/api/mods/:id', auth: true,
            desc: t('plugins.endpointUpdateMod') || 'Update mod metadata',
            about: 'Partially updates editable metadata fields on a mod. Replace :id in the URL with the mod UUID. All fields are optional — only the fields you send will be updated.',
            fields: [
                { name: 'name',        type: 'string', required: false, desc: 'New display name shown in the UI.' },
                { name: 'version',     type: 'string', required: false, desc: 'Version string, e.g. "1.2.3".' },
                { name: 'author',      type: 'string', required: false, desc: 'Author or creator name.' },
                { name: 'description', type: 'string', required: false, desc: 'Short description shown in mod details.' },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "mod": { "id": "mod-uuid", "name": "Updated Name" } }' },
                e400, e401, e404,
            ],
        },
        {
            method: 'DELETE', path: '/api/mods/:id', auth: true,
            desc: t('plugins.endpointDeleteMod') || 'Delete a mod',
            about: 'Permanently removes a mod record from BMM. Replace :id with the mod UUID. This does NOT delete the files on disk — use the UI for full removal.',
            fields: null,
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "mod_id": "mod-uuid" }' },
                e401, e404,
            ],
        },
        // ── Profiles ────────────────────────────────────────────────────────
        {
            method: 'GET', path: '/api/profiles', auth: false,
            desc: t('plugins.endpointProfiles'), about: 'Returns all profiles, including their mod lists. Useful for discovering profile IDs before activating or updating one.',
            fields: null,
            responseStatuses: [{ code: 200, label: 'OK', body: '[{ "id": "prof-uuid", "name": "DCS World", "active_mods": ["mod-id-1", "mod-id-2"] }]' }],
        },
        {
            method: 'POST', path: '/api/profiles', auth: true,
            desc: t('plugins.endpointCreateProfile') || 'Create a profile',
            about: 'Creates a new mod profile. The profile is not automatically set as active — call POST /api/profiles/activate afterwards if needed.',
            fields: [
                { name: 'name',        type: 'string', required: true,  desc: 'Profile display name shown in the sidebar.' },
                { name: 'game_path',   type: 'string', required: true,  desc: 'Absolute path to the game installation folder.' },
                { name: 'mods_path',   type: 'string', required: true,  desc: 'Absolute path to the folder where mods are stored.' },
                { name: 'backup_path', type: 'string', required: true,  desc: 'Absolute path where backup copies are saved.' },
                { name: 'game_name',   type: 'string', required: false, desc: 'Optional game label, e.g. "DCS World".' },
                { name: 'color',       type: 'string', required: false, desc: 'Accent color hex, e.g. "#3b82f6". Defaults to blue.' },
                { name: 'icon',        type: 'string', required: false, desc: 'Icon slug shown next to the profile, e.g. "star".' },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "profile": { "id": "prof-uuid", "name": "My Profile" } }' },
                e400, e401,
            ],
        },
        {
            method: 'POST', path: '/api/profiles/activate', auth: true,
            desc: t('plugins.endpointActivateProfile'), about: 'Switches the active profile. All subsequent mod operations will operate on the newly active profile.',
            fields: [{ name: 'profile_id', type: 'string', required: true, desc: 'UUID of the profile to activate (use GET /api/profiles to find IDs).' }],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "profile_id": "prof-uuid" }' },
                e401, e404,
            ],
        },
        {
            method: 'PUT', path: '/api/profiles/:id', auth: true,
            desc: t('plugins.endpointUpdateProfile') || 'Update a profile',
            about: 'Partially updates an existing profile. Replace :id with the profile UUID. All fields are optional — only the fields you send will be changed.',
            fields: [
                { name: 'name',        type: 'string', required: false, desc: 'New display name.' },
                { name: 'color',       type: 'string', required: false, desc: 'New accent color hex, e.g. "#ef4444".' },
                { name: 'icon',        type: 'string', required: false, desc: 'New icon slug.' },
                { name: 'game_path',   type: 'string', required: false, desc: 'New absolute path to the game folder.' },
                { name: 'mods_path',   type: 'string', required: false, desc: 'New absolute path to the mods folder.' },
                { name: 'backup_path', type: 'string', required: false, desc: 'New absolute path to the backup folder.' },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "profile": { "id": "prof-uuid", "name": "Updated Name" } }' },
                e400, e401, e404,
            ],
        },
        {
            method: 'DELETE', path: '/api/profiles/:id', auth: true,
            desc: t('plugins.endpointDeleteProfile') || 'Delete a profile',
            about: 'Permanently deletes a profile and removes all mod associations for that profile. Replace :id with the profile UUID. Cannot delete the currently active profile.',
            fields: null,
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "profile_id": "prof-uuid" }' },
                e400, e401, e404,
            ],
        },
        // ── Plugins ─────────────────────────────────────────────────────────
        {
            method: 'GET', path: '/api/plugins', auth: false,
            desc: t('plugins.endpointPlugins'), about: 'Returns all installed BMM plugins with their manifests and enabled state.',
            fields: null,
            responseStatuses: [{ code: 200, label: 'OK', body: '[{ "manifest": { "id": "my-plugin", "name": "My Plugin", "version": "1.0.0" }, "enabled": true }]' }],
        },
        {
            method: 'POST', path: '/api/plugins/compare', auth: true,
            desc: t('plugins.endpointCompare'), about: 'Compares the mods a plugin requires against the currently active mods. Returns which required mods are missing and which extra mods are active.',
            fields: [{ name: 'plugin_id', type: 'string', required: true, desc: 'ID of the installed plugin to compare against.' }],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "plugin_id": "my-plugin", "all_required_active": false, "missing_required": 2, "required": ["mod-a", "mod-b"], "strict_extra": ["mod-c"] }' },
                e401, e404,
            ],
        },
        {
            method: 'POST', path: '/api/plugins/apply', auth: true,
            desc: t('plugins.endpointApply'), about: 'Enables all mods required by a plugin. Optionally disable mods not in the plugin\'s list (strict mode). Returns a count of enabled mods and any IDs that were not found.',
            fields: [
                { name: 'plugin_id',    type: 'string',  required: true,  desc: 'ID of the installed plugin to apply.' },
                { name: 'force_strict', type: 'boolean', required: false, desc: 'If true, disables mods not in the plugin list. Default: false.' },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "enabled": 3, "not_found": [], "strict": false }' },
                e400, e401, e404,
            ],
        },
        {
            method: 'GET', path: '/api/creator-id', auth: false,
            desc: t('plugins.endpointCreatorId'), about: 'Returns the unique creator ID generated for this BMM installation. Used as the publisher identifier when exporting plugins.',
            fields: null,
            responseStatuses: [{ code: 200, label: 'OK', body: '{ "ok": true, "creator_id": "a1b2c3d4e5f6..." }' }],
        },
        // ── Modpacks ────────────────────────────────────────────────────────
        {
            method: 'POST', path: '/api/modpacks/enable', auth: true,
            desc: t('plugins.endpointEnableModpack'), about: 'Enables all mods associated with the given modpack. Useful for one-click activation of an entire preset.',
            fields: [{ name: 'modpack_id', type: 'string', required: true, desc: 'UUID of the LocalModpack to enable all mods for.' }],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "modpack_id": "mp-uuid", "enabled_count": 5 }' },
                e401, e404,
            ],
        },
        {
            method: 'POST', path: '/api/modpacks/disable', auth: true,
            desc: t('plugins.endpointDisableModpack'), about: 'Disables all mods associated with the given modpack.',
            fields: [{ name: 'modpack_id', type: 'string', required: true, desc: 'UUID of the LocalModpack to disable all mods for.' }],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "modpack_id": "mp-uuid", "disabled_count": 5 }' },
                e401, e404,
            ],
        },
        // ── Server Repo ─────────────────────────────────────────────────────
        {
            method: 'POST', path: '/api/server-repo/connect', auth: true,
            desc: t('plugins.endpointServerRepoConnect'), about: 'Registers a remote server repository URL in BMM settings. Once connected, you can sync mods from the repo via the Sync tab or the /api/server-repo/sync endpoint.',
            fields: [
                { name: 'url',  type: 'string', required: true,  desc: 'Base URL of the server repository, e.g. "https://myserver.com/mods".' },
                { name: 'name', type: 'string', required: false, desc: 'Optional friendly name for the repository.' },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "url": "https://myserver.com/mods", "name": "My Server" }' },
                e400, e401,
            ],
        },
        {
            method: 'POST', path: '/api/server-repo/sync', auth: true,
            desc: t('plugins.endpointServerRepoSync') || 'Sync mods from server repo',
            about: 'Starts a background download job that fetches mods from a server repository. Large downloads run asynchronously — poll GET /api/status or listen to Tauri events for progress.',
            fields: [
                { name: 'url',            type: 'string',  required: true,  desc: 'Base URL of the server repository to sync from.' },
                { name: 'profile_id',     type: 'string',  required: false, desc: 'Target profile UUID. Defaults to the currently active profile.' },
                { name: 'sync_mode',      type: 'string',  required: false, desc: '"all" — sync every mod from the repo. "selected" — only the mod IDs listed in mod_ids. Default: "all".' },
                { name: 'mod_ids',        type: 'array',   required: false, desc: 'Array of mod ID strings to sync when sync_mode is "selected".' },
                { name: 'download_limit', type: 'number',  required: false, desc: 'Speed cap in KB/s (0 = unlimited). Default: 0.' },
                { name: 'clean_extras',   type: 'boolean', required: false, desc: 'If true, deletes local mods that are NOT present in the remote repo. Default: false.' },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "started": true, "mods_queued": 12, "sync_mode": "all" }' },
                e400, e401,
            ],
        },
        {
            method: 'GET', path: '/api/server-repo/list', auth: false,
            desc: 'List connected server repos',
            about: 'Returns all server repository URLs that have been connected via POST /api/server-repo/connect. Saved persistently in BMM settings.',
            fields: [],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "data": [{ "url": "https://...", "name": "My Repo" }] }' },
            ],
        },
        {
            method: 'POST', path: '/api/server-repo/host', auth: true,
            desc: 'Host a local server repo',
            about: 'Generates a repo.json from a local mods folder so other BMM clients can sync from it. Requires a special host_secret in addition to the Bearer token. The folder must be served separately (e.g. via a static file server or BMM\'s built-in mini-server).',
            fields: [
                { name: 'mods_path',   type: 'string', required: true,  desc: 'Absolute path to the folder containing mod files to expose.' },
                { name: 'host_secret', type: 'string', required: true,  desc: 'Special authorization secret required to host a repo. Set in BMM settings → Server Repo.' },
                { name: 'port',        type: 'number', required: false, desc: 'Port for the mini HTTP server (default: 8765).' },
                { name: 'name',        type: 'string', required: false, desc: 'Friendly name shown to clients connecting to this repo.' },
            ],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "port": 8765, "mod_count": 5, "repo_json": "C:\\\\mods\\\\repo.json" }' },
                e400, e401,
                { code: 403, label: 'Forbidden', body: '{ "error": "host_secret is required to host a server repo" }' },
            ],
        },
        // ── Modpacks (list + create) ─────────────────────────────────────────
        {
            method: 'GET', path: '/api/modpacks', auth: false,
            desc: 'List all modpacks',
            about: 'Returns all profiles treated as modpacks, including their mod count and metadata. A modpack in BMM is essentially a named profile with a list of mods.',
            fields: [],
            responseStatuses: [
                { code: 200, label: 'OK', body: '{ "ok": true, "data": [{ "id": "...", "name": "My Pack", "mod_count": 12, "active": true }] }' },
            ],
        },
        {
            method: 'POST', path: '/api/modpacks/create', auth: true,
            desc: 'Create a new modpack',
            about: 'Creates a new modpack (profile snapshot) with a given name. If a source profile_id is provided, the new modpack inherits that profile\'s active mod list. Otherwise it starts empty.',
            fields: [
                { name: 'name',        type: 'string', required: true,  desc: 'Display name for the new modpack.' },
                { name: 'profile_id',  type: 'string', required: false, desc: 'UUID of the source profile to snapshot mods from. Defaults to the active profile.' },
                { name: 'game_name',   type: 'string', required: false, desc: 'Game name (inherited from source profile if omitted).' },
                { name: 'game_path',   type: 'string', required: false, desc: 'Absolute path to the game executable (inherited if omitted).' },
                { name: 'mods_path',   type: 'string', required: false, desc: 'Absolute path to the mods folder (inherited if omitted).' },
                { name: 'backup_path', type: 'string', required: false, desc: 'Absolute path to the backup folder (inherited if omitted).' },
            ],
            responseStatuses: [
                { code: 201, label: 'Created', body: '{ "ok": true, "modpack_id": "new-uuid", "mod_count": 12 }' },
                e400, e401,
            ],
        },
    ];
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
        if ((method === 'POST' || method === 'PUT' || method === 'PATCH') && bodyText) opts.body = bodyText;
        const res = await fetch(`http://127.0.0.1:51274${path}`, opts);
        const json = await res.json().catch(() => null);
        statusBadge.textContent = `${res.status} ${res.statusText}`;
        statusBadge.className = `plug-tester-status ${res.ok ? 'plug-status-ok' : 'plug-status-err'}`;
        const pretty = json !== null ? JSON.stringify(json, null, 2) : '';
        respPre.innerHTML = hlJson(pretty);

        // ── Special handling for /api/server-repo/connect ──────────────────
        if (path === '/api/server-repo/connect') {
            if (res.status === 401) {
                _showServerRepoAuthModal();
            } else if (res.ok && json?.ok) {
                toast(t('plugins.serverRepoConnected'), 'success');
                // Pre-fill the repo sync URL input before navigating
                const repoUrl = json.url || '';
                setTimeout(() => {
                    (document.querySelector('.nav-item[data-view="repo"]') as HTMLElement)?.click();
                    // After tab switch, pre-fill the URL input and trigger fetch
                    setTimeout(() => {
                        const urlInput = document.getElementById('repo-sync-url') as HTMLInputElement | null;
                        if (urlInput && repoUrl) {
                            urlInput.value = repoUrl;
                            // Trigger the fetch button if available
                            const fetchBtn = document.getElementById('btn-fetch-repo-info') as HTMLElement | null;
                            fetchBtn?.click();
                        }
                    }, 400);
                }, 600);
            }
        }
    } catch (e) {
        statusBadge.textContent = t('common.error');
        statusBadge.className = 'plug-tester-status plug-status-err';
        respPre.textContent = String(e);
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

function addActionRow() {
    const container = document.getElementById('plug-actions-container');
    if (!container) return;

    const modOpts  = _allMods.map(m => `<option value="${escHtml(m.id)}">${escHtml(m.name || m.id)}</option>`).join('');
    const profOpts = _allProfiles.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join('');
    const plugOpts = _installedPlugins.map(p => `<option value="${escHtml(p.manifest.id)}">${escHtml(p.manifest.name)}</option>`).join('');

    const EXTRA_TYPES = new Set(['wait','close_process','open_url','show_message','launch_game','log','comment','set_variable','if_file_exists','if_var_eq','raw_code','connect_server_repo']);
    const NO_INPUT_TYPES = new Set(['else_block','end_block']);
    const EXTRA_PH: Record<string,string> = {
        wait:                t('plugins.waitDuration'),
        close_process:       t('plugins.processName'),
        open_url:            t('plugins.urlToOpen'),
        show_message:        t('plugins.messageText'),
        launch_game:         t('plugins.gameExePath'),
        log:                 t('plugins.logMessage'),
        comment:             t('plugins.commentText'),
        set_variable:        t('plugins.varNameValue'),
        if_file_exists:      t('plugins.filePathCheck'),
        if_var_eq:           'VARNAME=value',
        raw_code:            t('plugins.rawCodeHint'),
        connect_server_repo: 'https://server.example.com/repo.json | Server Name',
    };

    const row = document.createElement('div');
    row.className = 'plug-action-row';
    row.innerHTML = `
        <div class="plug-action-row-inner">
            <div class="plug-action-reorder">
                <button class="btn btn-xs btn-ghost plug-row-up">${IC.arrowUp}</button>
                <button class="btn btn-xs btn-ghost plug-row-down">${IC.arrowDown}</button>
            </div>
            <select class="select select-sm plug-action-type" style="min-width:148px;" data-tooltip="${t('plugins.actionTypeTip')}">
                <optgroup label="${t('plugins.actionGroupBmm')}">
                    <option value="enable_mod">${t('plugins.actionEnableMod')}</option>
                    <option value="disable_mod">${t('plugins.actionDisableMod')}</option>
                    <option value="activate_profile">${t('plugins.actionActivateProfile')}</option>
                    <option value="enable_modpack">${t('plugins.actionEnableModpack') || 'Activer liste de mods du plugin'}</option>
                    <option value="disable_modpack">${t('plugins.actionDisableModpack') || 'Désactiver liste de mods du plugin'}</option>
                    <option value="apply_plugin">${t('plugins.actionApplyPlugin')}</option>
                    <option value="compare_plugin">${t('plugins.actionComparePlugin')}</option>
                    <option value="connect_server_repo">${t('plugins.actionConnectRepo') || 'Se connecter à un repo'}</option>
                </optgroup>
                <optgroup label="${t('plugins.actionGroupSystem')}">
                    <option value="wait">${t('plugins.actionWait')}</option>
                    <option value="close_process">${t('plugins.actionCloseProcess')}</option>
                    <option value="open_url">${t('plugins.actionOpenUrl')}</option>
                    <option value="show_message">${t('plugins.actionShowMessage')}</option>
                    <option value="launch_game">${t('plugins.actionLaunchGame')}</option>
                    <option value="log">${t('plugins.actionLog')}</option>
                </optgroup>
                <optgroup label="${t('plugins.actionGroupControl')}">
                    <option value="comment">${t('plugins.actionComment')}</option>
                    <option value="set_variable">${t('plugins.actionSetVariable')}</option>
                    <option value="if_file_exists">${t('plugins.actionIfFileExists')}</option>
                    <option value="if_var_eq">${t('plugins.actionIfVarEq')}</option>
                    <option value="else_block">${t('plugins.actionElse')}</option>
                    <option value="end_block">${t('plugins.actionEnd')}</option>
                    <option value="raw_code">${t('plugins.actionRawCode')}</option>
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
        const isNoInput = NO_INPUT_TYPES.has(type);
        targetWrap.style.display  = (!isExtra && !isNoInput) ? '' : 'none';
        extraWrap.style.display   = isExtra ? '' : 'none';
        extraInput.placeholder    = EXTRA_PH[type] || '';
        extraInput.type           = type === 'wait' ? 'number' : 'text';
        if (type === 'wait' && !extraInput.value) extraInput.value = '3';

        if (!isExtra && !isNoInput) {
            if (type === 'enable_mod' || type === 'disable_mod') {
                targetSelect.innerHTML = modOpts || `<option value="">${t('plugins.noMods')}</option>`;
            } else if (type === 'activate_profile' || type === 'enable_modpack' || type === 'disable_modpack') {
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
    const useEnv    = (document.getElementById('plug-gen-use-env') as HTMLInputElement)?.checked ?? true;
    const needsEnv  = mode === 'api' && useEnv;

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

function _collectActions(): Array<{ action_type: string; target_id: string; extra: Record<string,any> }> | null {
    const rows = document.querySelectorAll('.plug-action-row');
    if (!rows.length) { toast(t('plugins.addActionFirst'), 'warning'); return null; }
    return Array.from(rows).map(row => {
        const type = (row.querySelector('.plug-action-type') as HTMLSelectElement).value;
        const extra: Record<string, any> = {};
        const extraWrap = row.querySelector('.plug-action-extra-wrap') as HTMLElement;
        const extraInp  = row.querySelector('.plug-action-extra-input') as HTMLInputElement;
        if (extraInp && extraWrap?.style.display !== 'none') {
            const val = extraInp.value.trim();
            switch (type) {
                case 'wait':                extra.duration_ms = (parseFloat(val) || 1) * 1000; break;
                case 'close_process':       extra.process_name = val; break;
                case 'open_url':            extra.url = val; break;
                case 'show_message':        extra.message = val; break;
                case 'launch_game':         extra.exe_path = val; break;
                case 'log':                 extra.message = val; break;
                case 'comment':             extra.text = val; break;
                case 'set_variable':        extra.expr = val; break;
                case 'if_file_exists':      extra.path = val; break;
                case 'if_var_eq':           extra.cond = val; break;
                case 'raw_code':            extra.code = val; break;
                case 'connect_server_repo': {
                    const [u, ...rest2] = val.split('|');
                    extra.url  = u.trim();
                    extra.name = rest2.join('|').trim();
                    break;
                }
            }
        }
        return {
            action_type: type,
            target_id:   (row.querySelector('.plug-action-target') as HTMLSelectElement)?.value || '',
            extra,
        };
    });
}

async function buildScript(): Promise<string | null> {
    const format    = (document.getElementById('plug-gen-format') as HTMLSelectElement)?.value || 'bat';
    const mode      = (document.getElementById('plug-gen-mode') as HTMLSelectElement)?.value || 'deeplink';
    const launchBmm = (document.getElementById('plug-gen-launch') as HTMLInputElement)?.checked ?? true;
    const useEnv    = (document.getElementById('plug-gen-use-env') as HTMLInputElement)?.checked ?? true;
    const actions   = _collectActions();
    if (!actions) return null;

    // Token: if useEnv → pass null so generators use env-var placeholder; else inline token
    const tokenArg = mode === 'api' ? (useEnv ? null : _apiToken) : null;

    // TS-side generation for non-native formats
    const TS_FORMATS = new Set(['py', 'lua', 'js', 'rb', 'php', 'go', 'java', 'cs', 'rs']);
    if (TS_FORMATS.has(format)) {
        return genScriptLocal(format, actions, tokenArg, mode === 'deeplink', launchBmm, _exePath, useEnv && mode === 'api');
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
            'function bmm_post($base, $token, $path, $body) {',
            '    $ch = curl_init($base . $path);',
            `    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json', 'Authorization: Bearer ' . $token]);`,
            '    curl_setopt($ch, CURLOPT_POST, 1);',
            '    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));',
            '    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);',
            '    curl_close($ch);',
            '}', '',
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
            'func bmmPost(path, body string) {',
            '\treq,_:=http.NewRequest("POST",bmmBase+path,bytes.NewBufferString(body))',
            '\treq.Header.Set("Content-Type","application/json")',
            '\treq.Header.Set("Authorization","Bearer "+bmmToken)',
            '\thttp.DefaultClient.Do(req)',
            '}',
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
            '    static void bmmPost(String p,String b) throws Exception{',
            '        var r=HttpRequest.newBuilder(URI.create(BASE+p)).POST(HttpRequest.BodyPublishers.ofString(b))',
            '            .header("Content-Type","application/json").header("Authorization","Bearer "+TOKEN).build();',
            '        HttpClient.newHttpClient().send(r,HttpResponse.BodyHandlers.discarding());',
            '    }',
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
            '    static async Task Post(string p,string b){',
            '        var r=new HttpRequestMessage(HttpMethod.Post,Base+p);',
            '        r.Headers.Add("Authorization","Bearer "+Token);',
            '        r.Content=new StringContent(b,Encoding.UTF8,"application/json");',
            '        await Http.SendAsync(r);',
            '    }',
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
            'fn bmm_post(path:&str,body:&str,base:&str,token:&str){',
            '    let _=reqwest::blocking::Client::new()',
            '        .post(format!("{}{}",base,path))',
            '        .bearer_auth(token)',
            '        .header("Content-Type","application/json")',
            '        .body(body.to_string()).send();',
            '}',
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

// Generic action renderer for simpler languages (Ruby, PHP, Go, Java, C#, Rust)
function _genericAction(a: any, lang: string, token: string | null, useDeeplink: boolean, base: string): string[] {
    const apiEps: Record<string, [string, string]> = {
        enable_mod:          ['/api/mods/enable',        JSON.stringify({ mod_id: a.target_id })],
        disable_mod:         ['/api/mods/disable',       JSON.stringify({ mod_id: a.target_id })],
        activate_profile:    ['/api/profiles/activate',  JSON.stringify({ profile_id: a.target_id })],
        apply_plugin:        ['/api/plugins/apply',      JSON.stringify({ plugin_id: a.target_id, force_strict: false })],
        compare_plugin:      ['/api/plugins/compare',    JSON.stringify({ plugin_id: a.target_id })],
        enable_modpack:      ['/api/modpacks/enable',    JSON.stringify({ profile_id: a.target_id })],
        disable_modpack:     ['/api/modpacks/disable',   JSON.stringify({ profile_id: a.target_id })],
        connect_server_repo: ['/api/server-repo/connect', JSON.stringify({ url: a.extra?.url || '', name: a.extra?.name || '' })],
    };

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
    const postFn = (path: string, body: string) => ({
        rb: `bmm_post('${path}', ${body})`,
        php: `bmm_post($base, $token, '${path}', ${body});`,
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

    switch (a.action_type) {
        case 'enable_mod': case 'disable_mod': case 'activate_profile':
        case 'apply_plugin': case 'compare_plugin':
        case 'enable_modpack': case 'disable_modpack':
        case 'connect_server_repo': {
            const dl = dlMap[a.action_type];
            const ep = apiEps[a.action_type];
            return [dl && useDeeplink ? dlFn(dl) : postFn(ep[0], ep[1])];
        }
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
            return [comment(`Unknown action: ${a.action_type}`)];
    }
}

function _pyAction(a: any, token: string | null, useDeeplink: boolean, base: string): string[] {
    const isEnvVar = token === '__ENV__';
    const auth = isEnvVar
        ? `headers={"Authorization": f"Bearer {TOKEN}"}`
        : (token ? `headers={"Authorization": "Bearer ${token}"}` : '');
    const deeplink = (path: string, id: string) =>
        `webbrowser.open(f"bmm://${path}/${id}")`;
    const apiPost = (ep: string, body: object) =>
        `requests.post(f"{BASE}${ep}", json=${JSON.stringify(body)}${auth ? ', ' + auth : ''})`;

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
        case 'connect_server_repo':
            return [`${apiPost('/api/server-repo/connect', { url: a.extra?.url || '', name: a.extra?.name || '' })}`];
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
        case 'if_var_eq': {
            const [vn, ...vr] = (a.extra.cond || 'name=value').split('=');
            return [`if ${vn.trim()} == ${JSON.stringify(vr.join('=').trim())}:`];
        }
        case 'else_block':
            return ['else:'];
        case 'end_block':
            return ['# end'];
        case 'raw_code':
            return [a.extra.code || ''];
        default:
            return [`# Unknown action: ${a.action_type}`];
    }
}

function _luaAction(a: any, token: string | null, useDeeplink: boolean, base: string): string[] {
    // TOKEN and BASE are always declared as locals at the top of the Lua script
    const curlPost = (ep: string, body: string) =>
        `os.execute(('curl -s -X POST %s%s -H "Content-Type: application/json" -H "Authorization: Bearer %s" -d %q'):format(BASE, ${JSON.stringify(ep)}, TOKEN, ${JSON.stringify(body)}))`;

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
        case 'connect_server_repo':
            return [curlPost('/api/server-repo/connect', `{"url":"${(a.extra?.url||'').replace(/"/g,'\\"')}","name":"${(a.extra?.name||'').replace(/"/g,'\\"')}"}`)];
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
        case 'if_var_eq': {
            const [vn, ...vr] = (a.extra.cond || 'name=value').split('=');
            return [`if ${vn.trim()} == ${JSON.stringify(vr.join('=').trim())} then`];
        }
        case 'else_block':
            return ['else'];
        case 'end_block':
            return ['end'];
        case 'raw_code':
            return [a.extra.code || ''];
        default:
            return [`-- Unknown action: ${a.action_type}`];
    }
}

function _jsAction(a: any, token: string | null, useDeeplink: boolean, base: string): string[] {
    // bmmPost is the helper declared in the JS generator header
    const apiCall = (ep: string, body: object) =>
        `await bmmPost('${ep}', ${JSON.stringify(body)});`;
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
        case 'connect_server_repo':
            return [apiCall('/api/server-repo/connect', { url: a.extra.url || '', name: a.extra.name || '' })];
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
        case 'if_var_eq': {
            const [vn, ...vr] = (a.extra.cond || 'name=value').split('=');
            return [`if (${vn.trim()} === ${JSON.stringify(vr.join('=').trim())}) {`];
        }
        case 'else_block':
            return ['} else {'];
        case 'end_block':
            return ['}'];
        case 'raw_code':
            return [a.extra.code || ''];
        default:
            return [`// Unknown action: ${a.action_type}`];
    }
}

// ── Tab: Permissions ───────────────────────────────────────────────────────

async function renderPerms(container: HTMLElement) {
    const ALL_PERMS = ['read_mods','enable_mods','disable_mods','switch_profile','apply_modlist','compare_modlist'];

    const globalAllowed = localStorage.getItem('bmm_plug_allow_global') === 'always';
    container.innerHTML = `
        <p class="plug-perms-desc">${IC.shield} ${t('plugins.permsDesc')}</p>
        <div class="plug-perm-global-card">
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
        <div id="plug-perms-list"></div>`;

    container.querySelector('#plug-global-allow')?.addEventListener('change', (e) => {
        if ((e.target as HTMLInputElement).checked) {
            localStorage.setItem('bmm_plug_allow_global', 'always');
        } else {
            localStorage.removeItem('bmm_plug_allow_global');
        }
    });

    const list = document.getElementById('plug-perms-list') as HTMLElement;

    if (!_installedPlugins.length) {
        list.innerHTML = `<p style="color:var(--text-muted);font-size:13px;margin:16px 0;text-align:center;">${t('plugins.noPluginsForPerms')}</p>`;
        return;
    }

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
    if (!plugin?.manifest?.modlist?.required_mods?.length) {
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
