// @ts-nocheck
import { invoke, pickFolder, pickFile } from '../../core/api.js';
import { toast } from '../../ui/app.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { getLinks } from '../../core/links-config.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AppEntry {
    id: string; title: string; description: string;
    md_link?: string; category: string; price: string;
    tags: string[]; version?: string; requirements?: string;
    images?: { thumb?: string; extra?: string[] };
    download: { url: string; file_type: string; size?: number };
    official?: boolean; partner?: boolean; source_label?: string;
}
interface InstallResult {
    app_id: string; install_path: string;
    executables: { name: string; path: string; size: number }[];
    installer_launched: boolean;
}
interface InstalledAppInfo {
    id: string; title: string; install_path: string; exe_path?: string;
    installed_at: string; version?: string; usage_seconds: number;
    category?: string; thumb?: string; is_managed?: boolean; uninstaller?: string;
}
interface AppsState {
    installed: Record<string, InstalledAppInfo>;
    favorites: string[];
    history: { action: string; app_id: string; app_title: string; timestamp: string }[];
    community_sources: string[];
}

// ── Module state ──────────────────────────────────────────────────────────────

let _catalog: AppEntry[] = [];
let _state: AppsState = { installed: {}, favorites: [], history: [], community_sources: [] };
let _activeTab = 'browse';
let _searchQ = '';
let _filterCat = 'all';
let _filterPrice = 'all';
let _defaultPath = '';
let _loading = false;

// ── SVG icon helpers ──────────────────────────────────────────────────────────
const IC = {
    download: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    play:     `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    trash:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
    folder:   `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    star:     `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    starFill: `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    refresh:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.36"/></svg>`,
    close:    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    plus:     `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    link:     `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
    check:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
    info:     `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    histInstall: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    histLaunch:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    histRemove:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    monitor:  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
};

// ── Init ──────────────────────────────────────────────────────────────────────

export async function initAppsCatalog() {
    const view = document.getElementById('view-apps');
    if (!view) return;

    renderShell(view);
    await refreshState();
    _defaultPath = await invoke('get_default_apps_path').catch(() => '');
    setupEvents(view);
    await loadCatalog();

    document.addEventListener('langChanged', () => {
        renderShell(view);
        setupEvents(view);
        renderCurrentTab();
    });
}

// ── Smart state refresh ───────────────────────────────────────────────────────
// Only refreshes disk state (fast), never re-fetches the catalog network.
// Call after every mutating action so the UI stays in sync without user clicking Refresh.

async function refreshState() {
    try { _state = await invoke('get_apps_state'); } catch (_) {}
    const badge = document.getElementById('badge-installed');
    if (badge) badge.textContent = String(Object.keys(_state.installed).length);
}

async function refreshAndRender() {
    await refreshState();
    renderCurrentTab();
}

// ── Shell ─────────────────────────────────────────────────────────────────────

const TABS = ['browse', 'installed', 'favorites', 'history', 'sources', 'create'];

function renderShell(view: HTMLElement) {
    view.innerHTML = `
    <div class="apps-root">
      <div class="apps-header">
        <div class="apps-header-left">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="7" height="7" rx="1"/><rect x="15" y="3" width="7" height="7" rx="1"/>
            <rect x="2" y="14" width="7" height="7" rx="1"/><rect x="15" y="14" width="7" height="7" rx="1"/>
          </svg>
          <div>
            <h2 class="apps-title" data-i18n="apps.title">App Catalog</h2>
            <p class="apps-subtitle" data-i18n="apps.subtitle">Browse &amp; install apps in one click</p>
          </div>
        </div>
        <div class="apps-header-right">
          <button class="btn btn-sm btn-ghost" id="apps-btn-reload">${IC.refresh} <span data-i18n="common.refresh">Refresh</span></button>
        </div>
      </div>

      <div class="apps-tabs">
        ${TABS.map(tab => `
          <button class="apps-tab${_activeTab === tab ? ' active' : ''}" data-tab="${tab}">
            ${tabIcon(tab)} <span data-i18n="apps.tab.${tab}">${tabLabel(tab)}</span>
            ${tab === 'installed' ? `<span class="apps-tab-badge" id="badge-installed">0</span>` : ''}
          </button>`).join('')}
      </div>

      <div class="apps-toolbar" id="apps-toolbar" style="${_activeTab === 'browse' ? '' : 'display:none'}">
        <div class="apps-search-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input class="apps-search" id="apps-search" type="text" placeholder="${t('common.search') || 'Search...'}" value="${escAttr(_searchQ)}">
        </div>
        <select class="apps-filter" id="apps-filter-cat">
          <option value="all"${_filterCat==='all'?' selected':''}>${t('apps.filter.allCat')||'All categories'}</option>
          <option value="game"${_filterCat==='game'?' selected':''}>${t('apps.cat.game')||'Game'}</option>
          <option value="utility"${_filterCat==='utility'?' selected':''}>${t('apps.cat.utility')||'Utility'}</option>
          <option value="other"${_filterCat==='other'?' selected':''}>${t('apps.cat.other')||'Other'}</option>
        </select>
        <select class="apps-filter" id="apps-filter-price">
          <option value="all"${_filterPrice==='all'?' selected':''}>${t('apps.filter.allPrice')||'All prices'}</option>
          <option value="free"${_filterPrice==='free'?' selected':''}>${t('apps.price.free')||'Free'}</option>
          <option value="freemium"${_filterPrice==='freemium'?' selected':''}>${t('apps.price.freemium')||'Freemium'}</option>
          <option value="paid"${_filterPrice==='paid'?' selected':''}>${t('apps.price.paid')||'Paid'}</option>
        </select>
      </div>

      <div class="apps-content" id="apps-content">
        <div class="apps-loading" id="apps-loading"><div class="apps-spinner"></div><p data-i18n="apps.loading">Loading…</p></div>
      </div>
    </div>

    <!-- Detail Modal -->
    <div class="apps-modal-overlay" id="apps-detail-modal">
      <div class="apps-modal"><button class="apps-modal-close" id="apps-modal-close-btn">${IC.close}</button>
        <div class="apps-modal-body" id="apps-modal-body"></div></div>
    </div>

    <!-- Install Modal -->
    <div class="apps-modal-overlay" id="apps-install-modal">
      <div class="apps-modal apps-modal-sm"><button class="apps-modal-close" id="apps-install-close-btn">${IC.close}</button>
        <div class="apps-modal-body" id="apps-install-body"></div></div>
    </div>`;
}

function tabIcon(tab: string) {
    const icons: Record<string, string> = {
        browse:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
        installed: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
        favorites: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
        history:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 1 .5 4M3 16v-5h5"/></svg>`,
        sources:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
        create:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    };
    return icons[tab] || '';
}

function tabLabel(tab: string) {
    const labels: Record<string, string> = {
        browse: 'Browse', installed: 'Installed', favorites: 'Favorites',
        history: 'History', sources: 'Sources', create: 'Create'
    };
    return labels[tab];
}

// ── Events ────────────────────────────────────────────────────────────────────

function setupEvents(view: HTMLElement) {
    view.querySelectorAll('.apps-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            _activeTab = (btn as HTMLElement).dataset.tab || 'browse';
            view.querySelectorAll('.apps-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const toolbar = document.getElementById('apps-toolbar');
            if (toolbar) toolbar.style.display = _activeTab === 'browse' ? 'flex' : 'none';
            renderCurrentTab();
        });
    });

    document.getElementById('apps-btn-reload')?.addEventListener('click', () => loadCatalog(true));
    document.getElementById('apps-search')?.addEventListener('input', (e) => {
        _searchQ = (e.target as HTMLInputElement).value;
        renderBrowse();
    });
    document.getElementById('apps-filter-cat')?.addEventListener('change', (e) => {
        _filterCat = (e.target as HTMLSelectElement).value;
        renderBrowse();
    });
    document.getElementById('apps-filter-price')?.addEventListener('change', (e) => {
        _filterPrice = (e.target as HTMLSelectElement).value;
        renderBrowse();
    });

    document.getElementById('apps-modal-close-btn')?.addEventListener('click', closeDetailModal);
    document.getElementById('apps-install-close-btn')?.addEventListener('click', closeInstallModal);
    document.getElementById('apps-detail-modal')?.addEventListener('click', e => {
        if ((e.target as HTMLElement).id === 'apps-detail-modal') closeDetailModal();
    });
    document.getElementById('apps-install-modal')?.addEventListener('click', e => {
        if ((e.target as HTMLElement).id === 'apps-install-modal') closeInstallModal();
    });
}

// ── Catalog loading ───────────────────────────────────────────────────────────

async function loadCatalog(force = false) {
    if (_loading && !force) return;
    _loading = true;

    const content = document.getElementById('apps-content');
    if (content) content.innerHTML = `<div class="apps-loading"><div class="apps-spinner"></div><p>${t('apps.loading') || 'Loading…'}</p></div>`;

    try {
        const result = await invoke('fetch_app_catalogs', {
            catalogUrl: getLinks().apps_catalog,
            extraCommunityUrls: _state.community_sources,
        });
        _catalog = result.apps;
        if (result.sources_failed.length) toast(`${result.sources_failed.length} source(s) failed`, 'warning');
    } catch {
        _catalog = [];
        if (content) content.innerHTML = `<div class="apps-empty">${IC.info}<p>${t('apps.catalogUnavail') || 'Catalog unavailable'}</p></div>`;
        _loading = false;
        return;
    }

    _loading = false;
    renderCurrentTab();
}

// ── Tab dispatcher ────────────────────────────────────────────────────────────

function renderCurrentTab() {
    switch (_activeTab) {
        case 'browse':    renderBrowse(); break;
        case 'installed': renderInstalled(); break;
        case 'favorites': renderFavorites(); break;
        case 'history':   renderHistory(); break;
        case 'sources':   renderSources(); break;
        case 'create':    renderCreate(); break;
    }
}

// ── Browse ────────────────────────────────────────────────────────────────────

function filteredApps() {
    return _catalog.filter(a => {
        if (_filterCat !== 'all' && a.category !== _filterCat) return false;
        if (_filterPrice !== 'all' && a.price !== _filterPrice) return false;
        if (_searchQ) {
            const q = _searchQ.toLowerCase();
            return a.title.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
                || a.tags.some(t => t.toLowerCase().includes(q));
        }
        return true;
    });
}

function renderBrowse() {
    const content = document.getElementById('apps-content');
    if (!content) return;
    const apps = filteredApps();

    if (!apps.length) {
        content.innerHTML = `<div class="apps-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.4"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><p>${_searchQ ? (t('apps.noResults')||'No results') : (t('apps.emptyBrowse')||'Catalog is empty')}</p></div>`;
        return;
    }

    content.innerHTML = `<div class="apps-grid">${apps.map(renderAppCard).join('')}</div>`;
    content.querySelectorAll('[data-app-id]').forEach(card => {
        card.addEventListener('click', () => openDetailModal((card as HTMLElement).dataset.appId || ''));
    });
}

function renderAppCard(app: AppEntry) {
    const installed = !!_state.installed[app.id];
    const fav = _state.favorites.includes(app.id);
    const thumb = app.images?.thumb;

    return `
    <div class="apps-card${installed?' apps-card-installed':''}" data-app-id="${escAttr(app.id)}">
      <div class="apps-card-thumb">
        <div class="apps-card-thumb-placeholder">${thumbIcon(app.category)}</div>
        ${thumb ? `<img class="apps-card-thumb-img" src="${escAttr(thumb)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
        <div class="apps-card-badges">
          ${app.official ? `<span class="apps-official-badge">✦ Official</span>` : ''}
          ${app.partner && !app.official ? `<span class="apps-partner-badge">Partner</span>` : ''}
          ${priceBadge(app.price)}
        </div>
        ${fav ? `<div class="apps-card-fav-star">${IC.starFill}</div>` : ''}
        ${installed ? `<div class="apps-card-installed-chip">${IC.check} Installed</div>` : ''}
      </div>
      <div class="apps-card-body">
        <span class="apps-card-title">${escHtml(app.title)}</span>
        <div class="apps-card-meta">
          <span class="apps-cat-badge apps-cat-${app.category}">${escHtml(app.category)}</span>
          ${app.version ? `<span class="apps-version">v${escHtml(app.version)}</span>` : ''}
        </div>
        <p class="apps-card-desc">${escHtml(app.description)}</p>
        <div class="apps-card-tags">${app.tags.slice(0,3).map(tag=>`<span class="apps-tag">${escHtml(tag)}</span>`).join('')}</div>
      </div>
    </div>`;
}

function priceBadge(price: string) {
    const cls: Record<string,string> = { free:'apps-price-free', freemium:'apps-price-freemium', paid:'apps-price-paid' };
    return `<span class="apps-price-badge ${cls[price]||''}">${escHtml(price)}</span>`;
}

function thumbIcon(cat: string) {
    if (cat === 'game') return `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 12h4m-2-2v4"/><circle cx="16" cy="10" r="1" fill="currentColor"/><circle cx="18" cy="12" r="1" fill="currentColor"/></svg>`;
    if (cat === 'utility') return `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
    return `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>`;
}

// ── Shared uninstall flow (used by Installed tab + detail modal) ───────────────
// Renders the keep/delete (managed) or run-uninstaller/forget (setup) choice
// into `container`, then calls onDone() after the action or onCancel() on cancel.
function renderUninstallChoiceInto(
    container: HTMLElement,
    info: InstalledAppInfo,
    onDone: () => void | Promise<void>,
    onCancel: () => void,
) {
    const appId = info.id;
    const isManaged = (info as any).is_managed !== false; // default true (legacy state)

    const run = async (opts: { deleteFiles?: boolean; runUninstaller?: boolean }) => {
        try {
            await invoke('uninstall_app', {
                appId,
                deleteFiles: opts.deleteFiles ?? false,
                runUninstaller: opts.runUninstaller ?? false,
            });
            toast(opts.runUninstaller ? (t('apps.uninstall.launched')||'Uninstaller launched')
                : opts.deleteFiles ? (t('apps.uninstalled')||'App uninstalled')
                : (t('apps.uninstall.keptFiles')||'Removed from BMM (files kept)'), 'success');
            await onDone();
        } catch (e) { toast(String(e), 'error'); }
    };

    const buttons = isManaged
        ? `<button class="adm-uc-btn" data-u="keep">${t('apps.uninstall.keepFiles')||'Keep files'}</button>
           <button class="adm-uc-btn adm-uc-danger" data-u="delete">${IC.trash} ${t('apps.uninstall.deleteFiles')||'Delete everything'}</button>`
        : `<button class="adm-uc-btn adm-uc-danger" data-u="run">${IC.trash} ${t('apps.uninstall.runUninstaller')||'Run uninstaller'}</button>
           <button class="adm-uc-btn" data-u="forget">${t('apps.uninstall.forget')||'Remove from BMM only'}</button>`;

    container.innerHTML = `
    <div class="adm-uninstall-choice">
      <span class="adm-uninstall-label">${t('apps.uninstall.choice')||'Uninstall'} "${escHtml(info.title)}"?</span>
      <div class="adm-uninstall-buttons">
        ${buttons}
        <button class="adm-uc-btn adm-uc-ghost" data-u="cancel">${t('common.cancel')||'Cancel'}</button>
      </div>
    </div>`;

    container.querySelector('[data-u="cancel"]')?.addEventListener('click', onCancel);
    container.querySelector('[data-u="keep"]')?.addEventListener('click', () => run({ deleteFiles: false }));
    container.querySelector('[data-u="delete"]')?.addEventListener('click', () => run({ deleteFiles: true }));
    container.querySelector('[data-u="run"]')?.addEventListener('click', () => run({ runUninstaller: true }));
    container.querySelector('[data-u="forget"]')?.addEventListener('click', () => run({ deleteFiles: false }));
}

// ── Installed ─────────────────────────────────────────────────────────────────

function renderInstalled() {
    const content = document.getElementById('apps-content');
    if (!content) return;
    const apps = Object.values(_state.installed);

    if (!apps.length) {
        content.innerHTML = `<div class="apps-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.4"><polyline points="20 6 9 17 4 12"/></svg><p>${t('apps.noneInstalled')||'No apps installed yet'}</p></div>`;
        return;
    }

    content.innerHTML = `<div class="apps-installed-list">
      ${apps.map(app => `
      <div class="apps-installed-row">
        <div class="apps-installed-thumb">
          ${app.thumb ? `<img src="${escAttr(app.thumb)}" alt="" loading="lazy" onerror="this.style.display='none'">` : thumbIcon(app.category||'other')}
        </div>
        <div class="apps-installed-info">
          <div class="apps-installed-title">${escHtml(app.title)}</div>
          <div class="apps-installed-path" title="${escAttr(app.install_path)}">${escHtml(app.install_path||'—')}</div>
          <div class="apps-installed-meta">
            ${app.version ? `<span>v${escHtml(app.version)}</span>` : ''}
            <span>${t('apps.usage')||'Usage'}: ${formatDuration(app.usage_seconds)}</span>
            ${!app.exe_path ? `<span class="apps-pending-exe">${t('apps.noExe')||'Exe not set'}</span>` : ''}
          </div>
        </div>
        <div class="apps-installed-actions">
          ${app.exe_path
            ? `<button class="btn btn-sm btn-accent" data-action="launch" data-id="${escAttr(app.id)}" data-exe="${escAttr(app.exe_path)}">${IC.play} ${t('apps.launch')||'Launch'}</button>`
            : `<button class="btn btn-sm btn-ghost" data-action="pick-exe" data-id="${escAttr(app.id)}">${IC.monitor} ${t('apps.pickExe')||'Set exe'}</button>`}
          <button class="btn btn-sm btn-ghost" data-action="folder" data-id="${escAttr(app.id)}" data-path="${escAttr(app.install_path)}">${IC.folder}</button>
          <button class="btn btn-sm btn-ghost btn-danger-ghost" data-action="uninstall" data-id="${escAttr(app.id)}">${IC.trash}</button>
        </div>
      </div>`).join('')}
    </div>`;

    content.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const el = btn as HTMLElement;
            const action = el.dataset.action;
            const id = el.dataset.id || '';

            if (action === 'launch') {
                try {
                    await invoke('launch_app', { appId: id, exePath: el.dataset.exe });
                    toast(`${t('apps.launched')||'Launched'}: ${_state.installed[id]?.title}`, 'success');
                    await refreshState();
                } catch (err) { toast(String(err), 'error'); }
            }
            if (action === 'pick-exe') {
                const file = await pickFile({ filters: [{ name: 'Executable', extensions: ['exe', 'msi'] }] }).catch(() => null);
                if (!file) return;
                try {
                    await invoke('register_installed_exe', { appId: id, exePath: file });
                    toast(t('apps.exeSet')||'Executable set', 'success');
                    await refreshAndRender();
                } catch (err) { toast(String(err), 'error'); }
            }
            if (action === 'folder') {
                await invoke('open_app_folder', { installPath: el.dataset.path }).catch(() => {});
            }
            if (action === 'uninstall') {
                const info = _state.installed[id];
                if (!info) return;
                // Expand this row into the same inline choice the detail modal uses (full width)
                const row = el.closest('.apps-installed-row') as HTMLElement | null;
                if (!row) return;
                renderUninstallChoiceInto(
                    row,
                    info,
                    () => refreshAndRender(),   // re-render the Installed tab after action
                    () => renderInstalled(),    // cancel → restore the rows
                );
            }
        });
    });
}

// ── Favorites ─────────────────────────────────────────────────────────────────

function renderFavorites() {
    const content = document.getElementById('apps-content');
    if (!content) return;
    const apps = _catalog.filter(a => _state.favorites.includes(a.id));

    if (!apps.length) {
        content.innerHTML = `<div class="apps-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.4"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg><p>${t('apps.noFavorites')||'No favorites yet'}</p></div>`;
        return;
    }

    content.innerHTML = `<div class="apps-grid">${apps.map(renderAppCard).join('')}</div>`;
    content.querySelectorAll('[data-app-id]').forEach(card => {
        card.addEventListener('click', () => openDetailModal((card as HTMLElement).dataset.appId || ''));
    });
}

// ── History ───────────────────────────────────────────────────────────────────

function renderHistory() {
    const content = document.getElementById('apps-content');
    if (!content) return;
    const entries = [..._state.history].reverse();

    if (!entries.length) {
        content.innerHTML = `<div class="apps-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.4"><polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 1 .5 4M3 16v-5h5"/></svg><p>${t('apps.noHistory')||'No activity yet'}</p></div>`;
        return;
    }

    const actionSvg: Record<string, string> = {
        install:   IC.histInstall,
        launch:    IC.histLaunch,
        uninstall: IC.histRemove,
    };
    const actionClass: Record<string, string> = {
        install: 'apps-action-install', launch: 'apps-action-launch', uninstall: 'apps-action-uninstall'
    };

    content.innerHTML = `
    <div class="apps-history-header">
      <button class="btn btn-sm btn-ghost" id="apps-clear-history">
        ${IC.trash} ${t('apps.clearHistory')||'Clear'}
      </button>
    </div>
    <div class="apps-history-list">
      ${entries.map(e => `
      <div class="apps-history-row">
        <span class="apps-history-action ${actionClass[e.action]||''}">${actionSvg[e.action]||IC.info}</span>
        <span class="apps-history-title">${escHtml(e.app_title)}</span>
        <span class="apps-history-time">${escHtml(e.timestamp)}</span>
      </div>`).join('')}
    </div>`;

    document.getElementById('apps-clear-history')?.addEventListener('click', async () => {
        await invoke('clear_app_history').catch(() => {});
        await refreshAndRender();
    });
}

// ── Sources ───────────────────────────────────────────────────────────────────

function renderSources() {
    const content = document.getElementById('apps-content');
    if (!content) return;

    content.innerHTML = `
    <div class="apps-sources-wrap">
      <div class="apps-sources-header">
        <h3>${t('apps.sources.title')||'Community Catalog Sources'}</h3>
        <p class="apps-sources-desc">${t('apps.sources.desc')||'Add raw JSON URLs of community catalogs.'}</p>
      </div>
      <div class="apps-sources-add">
        <input class="apps-source-input" id="apps-source-input" type="text" placeholder="https://raw.githubusercontent.com/.../catalog.json">
        <button class="btn btn-sm btn-accent" id="apps-add-source">${IC.plus} ${t('apps.sources.add')||'Add'}</button>
      </div>
      <div class="apps-sources-list">
        <div class="apps-source-row apps-source-official">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
          <span class="apps-source-url">${escHtml(getLinks().apps_catalog)}</span>
          <span class="apps-source-label">${t('apps.sources.official')||'Official'}</span>
        </div>
        ${_state.community_sources.map(url => `
        <div class="apps-source-row">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <span class="apps-source-url" title="${escAttr(url)}">${escHtml(url)}</span>
          <button class="btn btn-xs btn-ghost btn-danger-ghost apps-source-remove" data-url="${escAttr(url)}">${IC.close}</button>
        </div>`).join('')}
      </div>
    </div>`;

    document.getElementById('apps-add-source')?.addEventListener('click', async () => {
        const input = document.getElementById('apps-source-input') as HTMLInputElement;
        const url = input.value.trim();
        if (!url.startsWith('http')) { toast(t('apps.sources.invalidUrl')||'Invalid URL', 'error'); return; }
        try {
            _state.community_sources = await invoke('add_community_source', { url });
            input.value = '';
            toast(t('apps.sources.added')||'Source added', 'success');
            renderSources();
            // Auto-reload catalog to include the new source
            await loadCatalog(true);
        } catch (e) { toast(String(e), 'error'); }
    });

    content.querySelectorAll('.apps-source-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
            const url = (btn as HTMLElement).dataset.url || '';
            try {
                _state.community_sources = await invoke('remove_community_source', { url });
                renderSources();
                await loadCatalog(true);
            } catch (e) { toast(String(e), 'error'); }
        });
    });
}

// ── Catalog Creator ───────────────────────────────────────────────────────────

interface CatalogDraft {
    name: string; description: string;
    partner_catalogs: string[]; community_imports: string[];
    apps: Partial<AppEntry>[];
}

let _draft: CatalogDraft = { name: '', description: '', partner_catalogs: [], community_imports: [], apps: [] };

function renderCreate() {
    const content = document.getElementById('apps-content');
    if (!content) return;

    content.innerHTML = `
    <div class="apps-create-wrap">
      <div class="apps-create-header">
        <h3>${t('apps.create.title')||'Create a Catalog'}</h3>
        <p class="apps-sources-desc">${t('apps.create.desc')||'Build a catalog.json to share with others or host on GitHub.'}</p>
      </div>

      <div class="apps-create-section">
        <label class="apps-install-label">${t('apps.create.catalogName')||'Catalog name'}</label>
        <input class="apps-path-input" id="cr-name" type="text" placeholder="My Catalog" value="${escAttr(_draft.name)}">
        <label class="apps-install-label" style="margin-top:10px">${t('apps.create.catalogDesc')||'Description'}</label>
        <input class="apps-path-input" id="cr-desc" type="text" placeholder="What this catalog is about" value="${escAttr(_draft.description)}">
      </div>

      <div class="apps-create-section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span class="apps-install-label">${t('apps.create.apps')||'Apps'} (${_draft.apps.length})</span>
          <button class="btn btn-sm btn-accent" id="cr-add-app">${IC.plus} ${t('apps.create.addApp')||'Add app'}</button>
        </div>
        <div id="cr-apps-list">
          ${_draft.apps.map((app, i) => `
          <div class="apps-create-app-row">
            <span class="apps-create-app-id">${escHtml(app.id||'untitled')}</span>
            <span style="color:var(--text-muted);font-size:11px">${escHtml(app.title||'')}</span>
            <div style="display:flex;gap:6px;margin-left:auto">
              <button class="btn btn-xs btn-ghost" data-cr-edit="${i}">Edit</button>
              <button class="btn btn-xs btn-ghost btn-danger-ghost" data-cr-del="${i}">${IC.trash}</button>
            </div>
          </div>`).join('') || `<p style="color:var(--text-muted);font-size:12px">${t('apps.create.noApps')||'No apps yet — click Add app'}</p>`}
        </div>
      </div>

      <div class="apps-create-actions">
        <button class="btn btn-ghost" id="cr-preview">${t('apps.create.preview')||'Preview JSON'}</button>
        <button class="btn btn-accent" id="cr-copy">${t('apps.create.copy')||'Copy JSON'}</button>
        <button class="btn btn-ghost" id="cr-download">${IC.download} ${t('apps.create.download')||'Download catalog.json'}</button>
      </div>

      <div id="cr-json-preview" class="apps-create-json" style="display:none"></div>
    </div>

    <!-- App editor sub-modal -->
    <div class="apps-modal-overlay" id="cr-app-modal" style="z-index:9700">
      <div class="apps-modal apps-modal-sm">
        <button class="apps-modal-close" id="cr-app-close">${IC.close}</button>
        <div class="apps-modal-body" id="cr-app-body"></div>
      </div>
    </div>`;

    // Sync name/desc inputs to draft
    document.getElementById('cr-name')?.addEventListener('input', e => { _draft.name = (e.target as HTMLInputElement).value; });
    document.getElementById('cr-desc')?.addEventListener('input', e => { _draft.description = (e.target as HTMLInputElement).value; });

    // Add app
    document.getElementById('cr-add-app')?.addEventListener('click', () => openAppEditor(null));

    // Edit / delete
    content.querySelectorAll('[data-cr-edit]').forEach(btn => {
        btn.addEventListener('click', () => openAppEditor(parseInt((btn as HTMLElement).dataset.crEdit!)));
    });
    content.querySelectorAll('[data-cr-del]').forEach(btn => {
        btn.addEventListener('click', () => {
            const i = parseInt((btn as HTMLElement).dataset.crDel!);
            _draft.apps.splice(i, 1);
            renderCreate();
        });
    });

    // Preview / copy / download
    document.getElementById('cr-preview')?.addEventListener('click', () => {
        const el = document.getElementById('cr-json-preview')!;
        const json = buildCatalogJson();
        el.style.display = el.style.display === 'none' ? 'block' : 'none';
        el.textContent = json;
    });
    document.getElementById('cr-copy')?.addEventListener('click', () => {
        navigator.clipboard.writeText(buildCatalogJson()).then(() => toast(t('apps.create.copied')||'Copied!', 'success'));
    });
    document.getElementById('cr-download')?.addEventListener('click', () => {
        const blob = new Blob([buildCatalogJson()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'catalog.json';
        a.click();
    });

    document.getElementById('cr-app-close')?.addEventListener('click', () => {
        document.getElementById('cr-app-modal')!.classList.remove('open');
    });
}

function buildCatalogJson(): string {
    const cat = {
        version: '1.0',
        name: _draft.name || 'My Catalog',
        description: _draft.description || '',
        partner_catalogs: [] as string[],
        community_imports: [] as string[],
        apps: _draft.apps,
    };
    return JSON.stringify(cat, null, 2);
}

function openAppEditor(index: number | null) {
    const existing = index !== null ? _draft.apps[index] : {};
    const body = document.getElementById('cr-app-body')!;

    const field = (id: string, label: string, val: string, placeholder = '') =>
        `<label class="apps-install-label">${label}</label>
         <input class="apps-path-input" id="cr-${id}" type="text" value="${escAttr(val||'')}" placeholder="${escAttr(placeholder)}" style="margin-bottom:8px">`;

    body.innerHTML = `
    <div class="apps-install-form">
      <h3 class="apps-install-title">${index !== null ? (t('apps.create.editApp')||'Edit App') : (t('apps.create.addApp')||'Add App')}</h3>
      ${field('id', 'ID (unique, no spaces)', existing.id||'', 'my-app-name')}
      ${field('title', t('apps.create.fTitle')||'Title', existing.title||'', 'My App')}
      <label class="apps-install-label">${t('apps.create.fDesc')||'Description'}</label>
      <textarea class="apps-path-input" id="cr-description" rows="2" style="resize:vertical;margin-bottom:8px">${escHtml(existing.description||'')}</textarea>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div>
          <label class="apps-install-label">${t('apps.create.fCategory')||'Category'}</label>
          <select class="apps-filter" id="cr-category" style="width:100%">
            <option value="game"${existing.category==='game'?' selected':''}>Game</option>
            <option value="utility"${existing.category==='utility'||!existing.category?' selected':''}>Utility</option>
            <option value="other"${existing.category==='other'?' selected':''}>Other</option>
          </select>
        </div>
        <div>
          <label class="apps-install-label">${t('apps.create.fPrice')||'Price'}</label>
          <select class="apps-filter" id="cr-price" style="width:100%">
            <option value="free"${existing.price==='free'||!existing.price?' selected':''}>Free</option>
            <option value="freemium"${existing.price==='freemium'?' selected':''}>Freemium</option>
            <option value="paid"${existing.price==='paid'?' selected':''}>Paid</option>
          </select>
        </div>
      </div>
      ${field('version', 'Version', existing.version||'', '1.0.0')}
      ${field('tags', t('apps.create.fTags')||'Tags (comma-separated, max 3)', (existing.tags||[]).join(', '), 'dcs, tool, audio')}
      ${field('requirements', t('apps.requirements')||'Requirements', existing.requirements||'', 'Windows 10+')}
      ${field('thumb', t('apps.create.fThumb')||'Thumbnail URL', existing.images?.thumb||'', 'https://.../thumb.png')}
      ${field('extra', t('apps.create.fExtra')||'Extra images (comma-separated URLs)', (existing.images?.extra||[]).join(', '))}
      ${field('md_link', t('apps.create.fMd')||'Documentation URL (md_link)', existing.md_link||'', 'https://github.com/.../README.md')}
      ${field('dl-url', t('apps.create.fDlUrl')||'Download URL', (existing.download as any)?.url||'', 'https://github.com/.../app.exe')}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div>
          <label class="apps-install-label">${t('apps.create.fType')||'Type'}</label>
          <select class="apps-filter" id="cr-filetype" style="width:100%">
            ${['zip','exe','msi','script'].map(v => `<option value="${v}"${(existing.download as any)?.file_type===v?' selected':''}>${v}</option>`).join('')}
          </select>
        </div>
        <div>${field('size', 'Size (bytes)', String((existing.download as any)?.size||''), '10485760')}</div>
      </div>
      <div class="apps-install-footer">
        <button class="btn btn-ghost" id="cr-app-cancel">${t('common.cancel')||'Cancel'}</button>
        <button class="btn btn-accent" id="cr-app-save">${t('common.confirm')||'Save'}</button>
      </div>
    </div>`;

    document.getElementById('cr-app-cancel')?.addEventListener('click', () => {
        document.getElementById('cr-app-modal')!.classList.remove('open');
    });

    document.getElementById('cr-app-save')?.addEventListener('click', () => {
        const get = (id: string) => (document.getElementById(`cr-${id}`) as HTMLInputElement)?.value.trim() || '';
        const tags = get('tags').split(',').map(s => s.trim()).filter(Boolean).slice(0, 3);
        const extra = get('extra').split(',').map(s => s.trim()).filter(Boolean);
        const app: Partial<AppEntry> = {
            id:           get('id') || `app-${Date.now()}`,
            title:        get('title'),
            description:  (document.getElementById('cr-description') as HTMLTextAreaElement)?.value.trim() || '',
            category:     (document.getElementById('cr-category') as HTMLSelectElement)?.value || 'utility',
            price:        (document.getElementById('cr-price') as HTMLSelectElement)?.value || 'free',
            tags,
            version:      get('version') || undefined,
            requirements: get('requirements') || undefined,
            md_link:      get('md_link') || undefined,
            images:       { thumb: get('thumb') || undefined, extra: extra.length ? extra : undefined },
            download: {
                url:       get('dl-url'),
                file_type: (document.getElementById('cr-filetype') as HTMLSelectElement)?.value || 'exe',
                size:      parseInt(get('size')) || undefined,
            } as any,
        };

        if (index !== null) _draft.apps[index] = app;
        else _draft.apps.push(app);

        document.getElementById('cr-app-modal')!.classList.remove('open');
        renderCreate();
    });

    document.getElementById('cr-app-modal')!.classList.add('open');
}

// ── Detail Modal (rebuilt) ────────────────────────────────────────────────────

function openDetailModal(appId: string) {
    const app = _catalog.find(a => a.id === appId);
    if (!app) return;

    const installed = _state.installed[appId];
    const fav       = _state.favorites.includes(appId);
    const extra     = app.images?.extra || [];
    const allImages = [app.images?.thumb, ...extra].filter(Boolean) as string[];
    const hasImages = allImages.length > 0;

    const body = document.getElementById('apps-modal-body');
    if (!body) return;

    // Accent color per category
    const catColor: Record<string,string> = { game:'#3b82f6', utility:'#8b5cf6', other:'#6b7280' };
    const accent = app.official ? '#f59e0b' : (catColor[app.category] || '#6b7280');

    // App initials badge (shown when no image)
    const initials = app.title.replace(/[^a-zA-Z0-9]/g,' ').trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase();

    // Info table rows
    const infoRows = [
        app.requirements ? `<div class="adm-info-row">
            <div class="adm-info-icon">${IC.info}</div>
            <div class="adm-info-label">${t('apps.requirements')||'Requirements'}</div>
            <div class="adm-info-value">${escHtml(app.requirements)}</div>
          </div>` : '',
        installed ? `<div class="adm-info-row adm-info-installed">
            <div class="adm-info-icon">${IC.check}</div>
            <div class="adm-info-label">${t('apps.installedAt')||'Installed'}</div>
            <div class="adm-info-value">${escHtml(installed.installed_at)}</div>
          </div>
          <div class="adm-info-row adm-info-installed">
            <div class="adm-info-icon">${IC.play}</div>
            <div class="adm-info-label">${t('apps.usage')||'Usage time'}</div>
            <div class="adm-info-value">${formatDuration(installed.usage_seconds)}</div>
          </div>` : '',
        app.download.size ? `<div class="adm-info-row">
            <div class="adm-info-icon">${IC.download}</div>
            <div class="adm-info-label">${t('apps.downloadSize')||'Download'}</div>
            <div class="adm-info-value">${formatBytes(app.download.size)} · <span style="opacity:.6">${escHtml(app.download.file_type.toUpperCase())}</span></div>
          </div>` : '',
        app.source_label ? `<div class="adm-info-row">
            <div class="adm-info-icon">${IC.link}</div>
            <div class="adm-info-label">${t('apps.source')||'Source'}</div>
            <div class="adm-info-value adm-info-source">${escHtml(labelFromUrl(app.source_label))}</div>
          </div>` : '',
    ].filter(Boolean).join('');

    body.innerHTML = `
    <div class="adm-root">

      ${hasImages ? `
      <div class="adm-gallery">
        <img class="adm-hero" id="adm-hero" src="${escAttr(allImages[0])}" alt=""
             onerror="this.closest('.adm-gallery').style.display='none'">
        ${allImages.length > 1 ? `
        <div class="adm-thumbs">
          ${allImages.map((img, i) => `
          <img class="adm-thumb${i===0?' active':''}" src="${escAttr(img)}" data-src="${escAttr(img)}"
               onerror="this.style.display='none'">`).join('')}
        </div>` : ''}
      </div>` : `<div class="adm-top-bar" style="background:linear-gradient(90deg,${accent}22,transparent)">
        <div class="adm-color-strip" style="background:${accent}"></div>
      </div>`}

      <div class="adm-body">
        <div class="adm-header">
          ${!hasImages ? `
          <div class="adm-initials-badge" style="background:linear-gradient(135deg,${accent}44,${accent}22);border:1px solid ${accent}44;color:${accent}">
            ${initials}
          </div>` : ''}
          <div class="adm-title-block">
            <div class="adm-title-row">
              <h2 class="adm-title">${escHtml(app.title)}</h2>
              ${installed ? `<span class="adm-installed-chip">${IC.check} ${t('apps.installed')||'Installed'}</span>` : ''}
            </div>
            <div class="adm-badges">
              <span class="apps-cat-badge apps-cat-${app.category}">${escHtml(app.category)}</span>
              ${priceBadge(app.price)}
              ${app.official ? `<span class="apps-official-badge">✦ Official</span>` : ''}
              ${app.partner && !app.official ? `<span class="apps-partner-badge">Partner</span>` : ''}
              ${app.version ? `<span class="apps-version">v${escHtml(app.version)}</span>` : ''}
            </div>
          </div>
          <div class="adm-header-actions">
            <button class="adm-fav-btn${fav?' adm-fav-active':''}" id="adm-fav-btn" title="${fav?(t('apps.unfavorite')||'Unfavorite'):(t('apps.favorite')||'Favorite')}">
              ${fav ? IC.starFill : IC.star}
            </button>
            ${installed
              ? (installed.exe_path
                  ? `<button class="adm-action-btn" id="adm-launch-btn" data-exe="${escAttr(installed.exe_path)}" style="background:${accent}">${IC.play} ${t('apps.launch')||'Launch'}</button>`
                  : `<button class="adm-action-btn adm-pick-btn" id="adm-pick-btn">${IC.monitor} ${t('apps.pickExe')||'Set executable'}</button>`)
              : `<button class="adm-action-btn" id="adm-install-btn" style="background:${accent}">${IC.download} ${t('apps.install')||'Install'}</button>`
            }
          </div>
        </div>

        <p class="adm-desc">${escHtml(app.description)}</p>
        <div class="adm-tags">${app.tags.map(tag=>`<span class="apps-tag">${escHtml(tag)}</span>`).join('')}</div>

        ${infoRows ? `<div class="adm-info-table">${infoRows}</div>` : ''}

        ${app.md_link ? `
        <div class="adm-readme">
          <button class="adm-readme-toggle" id="adm-readme-toggle" data-md="${escAttr(app.md_link)}" data-open="0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span>README</span>
            <svg class="adm-readme-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div class="adm-readme-content" id="adm-readme-content"></div>
        </div>` : ''}

        ${installed ? `
        <div class="adm-uninstall-area" id="adm-uninstall-area">
          <button class="adm-uninstall-link" id="adm-uninstall-btn">${IC.trash} ${t('apps.uninstall')||'Uninstall'}</button>
        </div>` : ''}
      </div>
    </div>`;

    // ── Gallery ──
    body.querySelectorAll('.adm-thumb').forEach(thumb => {
        thumb.addEventListener('click', () => {
            (document.getElementById('adm-hero') as HTMLImageElement).src = (thumb as HTMLElement).dataset.src || '';
            body.querySelectorAll('.adm-thumb').forEach(th => th.classList.remove('active'));
            thumb.classList.add('active');
        });
    });

    // ── README toggle (lazy fetch + markdown render) ──
    document.getElementById('adm-readme-toggle')?.addEventListener('click', async function () {
        const btn = this as HTMLElement;
        const content = document.getElementById('adm-readme-content')!;
        const isOpen = btn.dataset.open === '1';

        if (isOpen) {
            btn.dataset.open = '0';
            btn.classList.remove('open');
            content.style.maxHeight = '0';
        } else {
            btn.dataset.open = '1';
            btn.classList.add('open');
            content.style.maxHeight = '600px';
            if (!content.dataset.loaded) {
                content.innerHTML = `<div class="apps-loading" style="height:60px"><div class="apps-spinner" style="width:18px;height:18px;border-width:2px"></div></div>`;
                try {
                    const resp = await fetch(toRawUrl(btn.dataset.md!), { cache: 'no-cache' });
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const raw = await resp.text();
                    content.innerHTML = `<div class="adm-md">${renderMarkdown(raw.slice(0, 12000))}</div>`;
                    content.dataset.loaded = '1';
                } catch {
                    content.innerHTML = `<p class="adm-md-error">${t('apps.mdFailed')||'Could not load README'}</p>`;
                }
            }
        }
    });

    // ── Favorite ──
    document.getElementById('adm-fav-btn')?.addEventListener('click', async () => {
        try {
            _state.favorites = await invoke('toggle_app_favorite', { appId });
            await refreshState();
            openDetailModal(appId);
        } catch (e) { toast(String(e), 'error'); }
    });

    // ── Install ──
    document.getElementById('adm-install-btn')?.addEventListener('click', () => {
        closeDetailModal();
        openInstallModal(app);
    });

    // ── Launch ──
    document.getElementById('adm-launch-btn')?.addEventListener('click', async function () {
        const exe = (this as HTMLElement).dataset.exe || '';
        try {
            await invoke('launch_app', { appId, exePath: exe });
            toast(`${t('apps.launched')||'Launched'}: ${app.title}`, 'success');
            await refreshState();
        } catch (e) { toast(String(e), 'error'); }
    });

    // ── Pick exe ──
    document.getElementById('adm-pick-btn')?.addEventListener('click', async () => {
        const file = await pickFile({ filters: [{ name: 'Executable', extensions: ['exe', 'msi'] }] }).catch(() => null);
        if (!file) return;
        try {
            await invoke('register_installed_exe', { appId, exePath: file });
            toast(t('apps.exeSet')||'Executable set', 'success');
            await refreshState();
            openDetailModal(appId);
        } catch (e) { toast(String(e), 'error'); }
    });

    // ── Uninstall — inline choice ──
    const area = document.getElementById('adm-uninstall-area');
    const isManaged   = (installed as any)?.is_managed !== false; // default true for legacy state

    const runUninstall = async (opts: { deleteFiles?: boolean; runUninstaller?: boolean }) => {
        try {
            await invoke('uninstall_app', {
                appId,
                deleteFiles: opts.deleteFiles ?? false,
                runUninstaller: opts.runUninstaller ?? false,
            });
            const msg = opts.runUninstaller ? (t('apps.uninstall.launched')||'Uninstaller launched')
                : opts.deleteFiles ? (t('apps.uninstalled')||'App uninstalled')
                : (t('apps.uninstall.keptFiles')||'Removed from BMM (files kept)');
            toast(msg, 'success');
            closeDetailModal();
            await refreshAndRender();
        } catch (e) { toast(String(e), 'error'); }
    };

    const resetUninstallArea = () => {
        if (!area) return;
        area.innerHTML = `<button class="adm-uninstall-link" id="adm-uninstall-btn">${IC.trash} ${t('apps.uninstall')||'Uninstall'}</button>`;
        area.querySelector('#adm-uninstall-btn')?.addEventListener('click', showUninstallChoice);
    };

    function showUninstallChoice() {
        if (!area) return;

        // Managed (zip/portable): BMM owns the folder → keep or delete
        // Setup-installed with uninstaller: run the real uninstaller, or just forget it
        // Setup-installed without uninstaller: only forget it
        // Managed (zip/portable) → BMM owns the folder, keep or delete.
        // Setup-installed → offer the real uninstaller (backend looks it up in the
        // registry live, even for apps installed before BMM tracked it).
        let buttons = '';
        if (isManaged) {
            buttons = `
              <button class="adm-uc-btn" id="adm-keep-btn">${t('apps.uninstall.keepFiles')||'Keep files'}</button>
              <button class="adm-uc-btn adm-uc-danger" id="adm-delete-btn">${IC.trash} ${t('apps.uninstall.deleteFiles')||'Delete everything'}</button>`;
        } else {
            buttons = `
              <button class="adm-uc-btn adm-uc-danger" id="adm-run-uninst-btn">${IC.trash} ${t('apps.uninstall.runUninstaller')||'Run uninstaller'}</button>
              <button class="adm-uc-btn" id="adm-forget-btn">${t('apps.uninstall.forget')||'Remove from BMM only'}</button>`;
        }

        area.innerHTML = `
        <div class="adm-uninstall-choice">
          <span class="adm-uninstall-label">${t('apps.uninstall.choice')||'Uninstall'} "${escHtml(app.title)}"?</span>
          <div class="adm-uninstall-buttons">
            ${buttons}
            <button class="adm-uc-btn adm-uc-ghost" id="adm-cancel-uninstall">${t('common.cancel')||'Cancel'}</button>
          </div>
        </div>`;

        area.querySelector('#adm-cancel-uninstall')?.addEventListener('click', resetUninstallArea);
        area.querySelector('#adm-keep-btn')?.addEventListener('click', () => runUninstall({ deleteFiles: false }));
        area.querySelector('#adm-delete-btn')?.addEventListener('click', () => runUninstall({ deleteFiles: true }));
        area.querySelector('#adm-run-uninst-btn')?.addEventListener('click', () => runUninstall({ runUninstaller: true }));
        area.querySelector('#adm-forget-btn')?.addEventListener('click', () => runUninstall({ deleteFiles: false }));
    }

    area?.querySelector('#adm-uninstall-btn')?.addEventListener('click', showUninstallChoice);

    document.getElementById('apps-detail-modal')!.classList.add('open');
}

function closeDetailModal() {
    document.getElementById('apps-detail-modal')?.classList.remove('open');
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function inlineMd(raw: string): string {
    let s = escHtml(raw);
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    s = s.replace(/`([^`]+)`/g, '<code class="adm-code">$1</code>');
    // Images before links
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="adm-md-img" loading="lazy">');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="adm-link">$1</a>');
    return s;
}

function renderMarkdown(raw: string): string {
    const lines = raw.split('\n');
    let html = '';
    let inCode = false;
    let codeBuf = '';
    let inList = false;
    let listTag = 'ul';

    const flushList = () => {
        if (inList) { html += `</${listTag}>`;  inList = false; }
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Fenced code block
        if (line.startsWith('```')) {
            if (inCode) {
                flushList();
                html += `<pre class="adm-pre"><code>${escHtml(codeBuf)}</code></pre>`;
                inCode = false; codeBuf = '';
            } else {
                flushList(); inCode = true;
            }
            continue;
        }
        if (inCode) { codeBuf += line + '\n'; continue; }

        // Headings
        const h3 = line.match(/^### (.+)/);
        const h2 = line.match(/^## (.+)/);
        const h1 = line.match(/^# (.+)/);
        if (h3) { flushList(); html += `<h3 class="adm-h3">${inlineMd(h3[1])}</h3>`; continue; }
        if (h2) { flushList(); html += `<h2 class="adm-h2">${inlineMd(h2[1])}</h2>`; continue; }
        if (h1) { flushList(); html += `<h1 class="adm-h1">${inlineMd(h1[1])}</h1>`; continue; }

        // HR
        if (/^---+$/.test(line.trim())) { flushList(); html += `<hr class="adm-hr">`; continue; }

        // Blockquote
        if (line.startsWith('> ')) { flushList(); html += `<blockquote class="adm-blockquote">${inlineMd(line.slice(2))}</blockquote>`; continue; }

        // List — unordered
        const ul = line.match(/^[\-\*\+] (.+)/);
        if (ul) {
            if (!inList || listTag !== 'ul') { flushList(); html += `<ul class="adm-ul">`; inList = true; listTag = 'ul'; }
            html += `<li>${inlineMd(ul[1])}</li>`;
            continue;
        }
        // List — ordered
        const ol = line.match(/^\d+\. (.+)/);
        if (ol) {
            if (!inList || listTag !== 'ol') { flushList(); html += `<ol class="adm-ol">`; inList = true; listTag = 'ol'; }
            html += `<li>${inlineMd(ol[1])}</li>`;
            continue;
        }

        // Empty line
        if (!line.trim()) { flushList(); html += '<div class="adm-br"></div>'; continue; }

        // Paragraph
        flushList();
        html += `<p class="adm-p">${inlineMd(line)}</p>`;
    }

    flushList();
    return html;
}

// ── Install Modal ─────────────────────────────────────────────────────────────

function openInstallModal(app: AppEntry) {
    const body = document.getElementById('apps-install-body');
    if (!body) return;

    const isSetup = app.download.file_type === 'msi'
        || app.download.url.toLowerCase().includes('setup')
        || app.download.url.toLowerCase().includes('install');

    body.innerHTML = `
    <div class="apps-install-form">
      <h3 class="apps-install-title">${IC.download} ${t('apps.install')||'Install'} — ${escHtml(app.title)}</h3>

      <div class="apps-install-info">
        ${priceBadge(app.price)}
        <span>${escHtml(app.download.file_type.toUpperCase())}</span>
        ${app.download.size ? `<span>${formatBytes(app.download.size)}</span>` : ''}
      </div>

      ${app.requirements ? `<div class="apps-install-req">${IC.info} ${escHtml(app.requirements)}</div>` : ''}

      ${isSetup ? `<div class="apps-install-setup-note">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          ${t('apps.install.setupAuto')||'This app uses its own installer. Just click through its wizard — BMM detects the result automatically.'}
        </div>` : `
      <label class="apps-install-label">${t('apps.installPath')||'Install folder'}</label>
      <div class="apps-path-row">
        <input class="apps-path-input" id="apps-path-input" type="text" value="${escAttr(_defaultPath)}">
        <button class="btn btn-sm btn-ghost" id="apps-browse-path">${IC.folder}</button>
      </div>
      <p class="apps-install-path-hint">${t('apps.installPathHint')||'App installed to: folder/app-id/'}</p>`}

      <div id="apps-install-progress" style="display:none">
        <div class="apps-install-progress-bar"><div class="apps-install-progress-fill" id="apps-progress-fill"></div></div>
        <p id="apps-install-status" style="font-size:12px;color:var(--text-muted);margin-top:6px"></p>
      </div>

      <div class="apps-install-footer">
        <button class="btn btn-ghost" id="apps-install-cancel">${t('common.cancel')||'Cancel'}</button>
        <button class="btn btn-accent" id="apps-install-confirm">${IC.download} ${t('apps.installNow')||'Install'}</button>
      </div>
    </div>`;

    document.getElementById('apps-browse-path')?.addEventListener('click', async () => {
        const folder = await pickFolder().catch(() => null);
        if (folder) (document.getElementById('apps-path-input') as HTMLInputElement).value = folder;
    });

    document.getElementById('apps-install-cancel')?.addEventListener('click', closeInstallModal);

    document.getElementById('apps-install-confirm')?.addEventListener('click', async () => {
        const pathInput = document.getElementById('apps-path-input') as HTMLInputElement | null;
        const installPath = pathInput?.value.trim() || _defaultPath;
        const progress = document.getElementById('apps-install-progress')!;
        const fill = document.getElementById('apps-progress-fill')!;
        const status = document.getElementById('apps-install-status')!;
        const confirmBtn = document.getElementById('apps-install-confirm') as HTMLButtonElement;
        const cancelBtn = document.getElementById('apps-install-cancel') as HTMLButtonElement;

        progress.style.display = 'block';
        confirmBtn.disabled = true;
        cancelBtn.disabled = true;
        fill.style.width = '40%';
        // For setups, install_app blocks until the wizard finishes — explain the wait
        status.textContent = isSetup
            ? (t('apps.install.runningWizard')||'Downloading… then the app installer will open. Just follow it.')
            : (t('apps.downloading')||'Downloading…');

        try {
            const result: InstallResult = await invoke('install_app', {
                appId:       app.id,
                appTitle:    app.title,
                downloadUrl: app.download.url,
                fileType:    app.download.file_type,
                installPath,
                version:     app.version || null,
                category:    app.category,
                thumb:       app.images?.thumb || null,
            });

            fill.style.width = '100%';
            await refreshState();

            if (result.installer_launched && !result.auto_detected) {
                // Rare: BMM could not auto-find the exe. Offer a one-click optional fallback.
                status.textContent = t('apps.install.notDetected')||'Installed, but BMM could not auto-find the app. You can set it manually later.';
                confirmBtn.style.display = 'none';
                cancelBtn.disabled = false;
                cancelBtn.textContent = t('common.close')||'Close';
                cancelBtn.addEventListener('click', () => { renderCurrentTab(); }, { once: true });
                toast(`${app.title} ${t('apps.installed')||'installed!'}`, 'success');

            } else if (result.executables.length > 1) {
                // Zip with several exes — BMM picked the largest; let the user override if they want
                status.textContent = t('apps.install.detectedMain')||'Installed! Main app detected automatically.';
                closeInstallModal();
                renderCurrentTab();
                toast(`${app.title} ${t('apps.installed')||'installed!'}`, 'success');

            } else {
                closeInstallModal();
                renderCurrentTab();
                toast(`${app.title} ${t('apps.installed')||'installed!'}`, 'success');
            }

        } catch (e) {
            fill.style.background = 'var(--danger)';
            status.textContent = String(e);
            confirmBtn.disabled = false;
            cancelBtn.disabled = false;
            toast(String(e), 'error');
        }
    });

    document.getElementById('apps-install-modal')!.classList.add('open');
}

function closeInstallModal() {
    document.getElementById('apps-install-modal')?.classList.remove('open');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert GitHub blob URL to raw.githubusercontent for CORS-free fetch */
function toRawUrl(url: string): string {
    return url
        .replace('https://github.com/', 'https://raw.githubusercontent.com/')
        .replace('/blob/', '/');
}

/** Extract a readable label from a catalog source URL */
function labelFromUrl(url: string): string {
    try {
        const u = new URL(url);
        // e.g. raw.githubusercontent.com/BetterDCS/BMM_App_Catalogue/... → BetterDCS/BMM_App_Catalogue
        const parts = u.pathname.split('/').filter(Boolean);
        if (u.hostname.includes('githubusercontent') && parts.length >= 2) {
            return `${parts[0]}/${parts[1]}`;
        }
        return u.hostname.replace('www.', '');
    } catch {
        return url;
    }
}

function formatDuration(secs: number): string {
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}min`;
    return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}min`;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
}
