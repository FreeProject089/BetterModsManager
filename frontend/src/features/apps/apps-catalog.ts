// @ts-nocheck
import { sourceAccessHtml, wireSourceAccess } from '../../core/source-access.js';
import { invoke, pickFolder, pickFile, saveFile } from '../../core/api.js';
import { toast } from '../../ui/app.js';
import { t } from '../../core/i18n.js';
import {
    readOrigins, originLabel, forgetOrigin, enabledOnly, isDisabled, setDisabled, recordHistory,
    looksLikeIndex, importIndexForType, describeKinds } from '../catalogs/catalog-index.js';
import { showConfirm } from '../../ui/confirm.js';
import { copyIdButtons, wireCopyIds } from '../../core/copy-id.js';
import { bundleEntryKind, resolveBundleEntry } from '../../core/catalog-bundle.js';
import { draftFromCatalog as parseCatalog, draftProblems as problemsOf } from './catalog-draft.js';
import { writeSources } from '../catalogs/catalog-sources.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { getLinks } from '../../core/links-config.js';
import { fetchSourceText } from '../../core/source-fetch.js';

// Renders a labelled, fully-visible (wrapping) + copyable hash block for the
// checksum warning modals. Inline styles so it works inside the generic confirm
// modal without depending on extra CSS.
function hashBlock(label: string, hash: string): string {
    const h = escHtml(hash);
    return `<div style="margin-top:12px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text-muted)">${escHtml(label)}</span>
            <button type="button" data-copy="${escAttr(h)}" data-copy-flash="tick"
                style="font-size:10px;padding:2px 8px;border-radius:5px;border:1px solid var(--border);background:transparent;color:var(--text-secondary);cursor:pointer">copy</button>
        </div>
        <code style="display:block;font-family:var(--font-mono);font-size:11px;line-height:1.5;word-break:break-all;white-space:pre-wrap;user-select:all;background:rgba(0,0,0,0.25);border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:var(--text-secondary)">${h}</code>
    </div>`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface AppEntry {
    id: string; title: string; description: string;
    md_link?: string; category: string; price: string;
    tags: string[]; version?: string; requirements?: string;
    images?: { thumb?: string; extra?: string[] };
    download: { url: string; file_type: string; size?: number; sha256?: string };
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
// Read once per render rather than per row — localStorage is synchronous, and a dozen
// rows would be a dozen parses of the same JSON.
let _origins: Record<string, string> = {};
let _state: AppsState = { installed: {}, favorites: [], history: [], community_sources: [] };
let _activeTab = 'browse';
let _searchQ = '';
let _searchDeb: any;
let _favSearchDeb: any;
let _filterCat = 'all';
let _filterPrice = 'all';
let _filterTag  = 'all';
let _historyFilter = 'all'; // all | install | launch | uninstall
let _favSearch = '';
let _favFilterCat = 'all';
let _favFilterSource = 'all';
let _favCollection = 'all'; // 'all' or collection id
let _defaultPath = '';
let _loading = false;

// ── Favorite Collections (stored in localStorage, no Rust changes needed) ─────
interface FavCollection { id: string; name: string; appIds: string[]; }
function loadCollections(): FavCollection[] {
    try { return JSON.parse(localStorage.getItem('bmm_fav_collections') || '[]'); } catch { return []; }
}
function saveCollections(cols: FavCollection[]) {
    localStorage.setItem('bmm_fav_collections', JSON.stringify(cols));
}
let _collections: FavCollection[] = loadCollections();

// ── SVG icon helpers ──────────────────────────────────────────────────────────
const IC = {
    lock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
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
    replace:  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-replace-icon lucide-replace"><path d="M14 4a1 1 0 0 1 1-1"/><path d="M15 10a1 1 0 0 1-1-1"/><path d="M21 4a1 1 0 0 0-1-1"/><path d="M21 9a1 1 0 0 1-1 1"/><path d="m3 7 3 3 3-3"/><path d="M6 10V5a2 2 0 0 1 2-2h2"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>`,
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

    // Lazy tracking: if any installed app was already running when BMM started
    invoke('scan_and_track_running_apps').catch(() => {});

    document.addEventListener('langChanged', () => {
        renderShell(view);
        setupEvents(view);
        renderCurrentTab();
    });

    // When BMM regains focus (e.g. returning from a launched app), refresh the
    // state-dependent tabs so accumulated usage time / installs show up.
    window.addEventListener('focus', () => {
        if (!view.classList.contains('active')) return;
        if (_activeTab === 'installed' || _activeTab === 'favorites' || _activeTab === 'history') {
            refreshAndRender();
        }
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
          <option value="oss"${_filterPrice==='oss'?' selected':''}>${t('apps.price.oss')}</option>
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
        btn.addEventListener('click', async () => {
            _activeTab = (btn as HTMLElement).dataset.tab || 'browse';
            view.querySelectorAll('.apps-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const toolbar = document.getElementById('apps-toolbar');
            if (toolbar) toolbar.style.display = _activeTab === 'browse' ? 'flex' : 'none';
            // Re-read disk state so usage time / installs update after returning from an app
            if (_activeTab === 'installed' || _activeTab === 'favorites' || _activeTab === 'history') {
                await refreshState();
            }
            renderCurrentTab();
        });
    });

    document.getElementById('apps-btn-reload')?.addEventListener('click', () => loadCatalog(true));
    document.getElementById('apps-search')?.addEventListener('input', (e) => {
        _searchQ = (e.target as HTMLInputElement).value;
        clearTimeout(_searchDeb);
        _searchDeb = setTimeout(() => renderBrowse(), 150);
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
    // Note: cr-app-modal backdrop close is attached in renderCreate() since
    // that function replaces the entire DOM including the modal element.
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
            // enabledOnly, so a source switched off is kept in the list and not fetched.
            // The flag is inert until a fetcher honours it, and this is the app fetcher.
            extraCommunityUrls: enabledOnly(_state.community_sources),
        });
        _catalog = result.apps;
        // A catalogue that CARRIES its apps.
        //
        // `fetch_app_catalogs` speaks http; a `.bmmbundle` is a zip on this disk, so it is
        // opened here and merged in. Plugins and mod lists have read bundles for a while
        // and app catalogues were the one kind that could only ever point at an address —
        // which meant publishing one always needed a host, and following one meant that
        // host still being there.
        for (const src of enabledOnly(_state.community_sources)) {
            if (!src.startsWith('bundle:')) continue;
            try {
                _catalog = _catalog.concat(await appsFromBundle(src));
            } catch (e) {
                console.warn('[BMM] bundle source failed:', src, e);
                result.sources_failed.push(src);
            }
        }
        // Only alert if EVERY source failed; partial failures (e.g. a placeholder
        // partner URL) are just logged, not shown as a noisy toast.
        if (result.sources_failed.length) {
            console.warn('[BMM] App catalog sources failed:', result.sources_failed);
            if (result.sources_loaded.length === 0) {
                toast(t('apps.allSourcesFailed') || 'Could not load any catalog source', 'error');
            }
        }
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
        if (_filterTag !== 'all' && !a.tags.includes(_filterTag)) return false;
        if (_searchQ) {
            const q = _searchQ.toLowerCase();
            return a.title.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
                || a.tags.some(tg => tg.toLowerCase().includes(q));
        }
        return true;
    });
}

function renderBrowse() {
    const content = document.getElementById('apps-content');
    if (!content) return;
    const apps = filteredApps();

    // Build tag chips from all catalog tags
    const allTags = [...new Set(_catalog.flatMap(a => a.tags))].sort();

    let html = '';
    if (allTags.length) {
        html += `<div class="apps-tags-row">
          <button class="apps-tag-chip${_filterTag === 'all' ? ' active' : ''}" data-tag="all">${t('apps.filter.allTags')||'All tags'}</button>
          ${allTags.map(tag => `<button class="apps-tag-chip${_filterTag === tag ? ' active' : ''}" data-tag="${escAttr(tag)}">${escHtml(tag)}</button>`).join('')}
        </div>`;
    }

    if (!apps.length) {
        html += `<div class="apps-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.4"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><p>${_searchQ || _filterTag !== 'all' ? (t('apps.noResults')||'No results') : (t('apps.emptyBrowse')||'Catalog is empty')}</p></div>`;
    } else {
        html += `<div class="apps-grid">${apps.map(renderAppCard).join('')}</div>`;
    }

    content.innerHTML = html;

    content.querySelectorAll('.apps-tag-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            _filterTag = (chip as HTMLElement).dataset.tag || 'all';
            renderBrowse();
        });
    });
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
        ${thumb ? `<img class="apps-card-thumb-img" src="${escAttr(thumb)}" alt="" loading="lazy" data-onerror="hide">` : ''}
        <div class="apps-card-badges">
          ${installed
            ? `<span class="apps-card-installed-chip">${IC.check} ${t('apps.installed')||'Installed'}</span>`
            // Translated, like the community badge two lines down. These three sit on the
            // same card and two of them were written in English — so a French reader was told
            // "Official" and "Communauté", which reads as two different systems rather than
            // three rungs of one.
            : app.official ? `<span class="apps-official-badge">✦ ${escHtml(t('apps.badge.official'))}</span>`
            : app.partner ? `<span class="apps-partner-badge">${escHtml(t('apps.badge.partner'))}</span>`
            // A community entry used to render NOTHING here. An absent badge is not a
            // warning — a reader who does not know the badge system reads blank as neutral,
            // which is exactly the gap an impersonating catalogue lives in. Say it plainly.
            : `<span class="apps-community-badge">${escHtml(t('apps.badge.community') || 'Community')}</span>`}
          ${claimChip(app)}
        </div>
        ${fav ? `<div class="apps-card-fav-star">${IC.starFill}</div>` : ''}
      </div>
      <div class="apps-card-body">
        <span class="apps-card-title" data-tooltip="${escAttr(app.title)}">${escHtml(app.title)}</span>
        <div class="apps-card-meta">
          <span class="apps-cat-badge apps-cat-${app.category}">${catIconSm(app.category)}${escHtml(catLabel(app.category))}</span>
          ${app.version ? `<span class="apps-version">v${escHtml(app.version)}</span>` : ''}
          ${priceText(app.price)}
        </div>
        <p class="apps-card-desc">${escHtml(app.description)}</p>
        <!-- Two rows, because these are two different kinds of thing and they were sharing
             one. A TAG is a word the publisher chose; "unverified" and "http" are facts
             about the download that BMM worked out. Mixed together, the fact that matters
             most read as the publisher's fourth hashtag — and it wrapped onto its own line
             anyway, so the row was two rows already, just not the useful two. -->
        ${(app.tags || []).length ? `
        <div class="apps-card-tags">
          ${app.tags.slice(0, 3).map(tag => `<span class="apps-tag">${escHtml(tag)}</span>`).join('')}
          ${app.tags.length > 3
            // The +N chip said how many were cut and not WHICH, so the only way to read the
            // fourth tag was to open the entry.
            ? `<span class="apps-tag apps-tag-more" data-tooltip="${escAttr(app.tags.slice(3).join(' · '))}">+${app.tags.length - 3}</span>`
            : ''}
        </div>` : ''}
        <div class="apps-card-facts">
          ${integrityChip(app)}
          ${httpChip(app.download?.url || '')}
          ${app.download?.size ? `<span class="apps-fact">${escHtml(formatBytes(app.download.size))}</span>` : ''}
          ${app.download?.file_type ? `<span class="apps-fact">${escHtml(app.download.file_type.toUpperCase())}</span>` : ''}
        </div>
      </div>
    </div>`;
}

/**
 * Whether this entry can be checked when it downloads.
 *
 * The catalogue's `sha256` is the hash of the PAYLOAD — the installer or the zip at that
 * URL — and `install_catalog_app` recomputes it while downloading, refusing to rename the
 * .part file if it does not match. An entry without one installs after a warning, and that
 * warning arrives once you have already chosen it.
 *
 * So it belongs on the card. Not as an alarm: a missing checksum is common and is not proof
 * of anything, which is why the unverifiable state is a quiet outline rather than a red
 * badge. It is the difference between two entries offering the same app, which is exactly
 * the choice being made at this moment.
 */
function integrityChip(app: AppEntry): string {
    const has = !!(app.download?.sha256 || '').trim();
    return has
        ? `<span class="apps-fact-chip apps-fact-sha" data-tooltip="${escAttr(t('apps.shaYesTip') || 'The catalogue publishes a checksum for the download. It is verified before anything is run.')}">${escHtml(t('apps.shaYes') || 'checksum')}</span>`
        : `<span class="apps-fact-chip apps-fact-nosha" data-tooltip="${escAttr(t('apps.shaNoTip') || 'No checksum published. The download cannot be verified — BMM will warn you before installing.')}">${escHtml(t('apps.shaNo') || 'unverified')}</span>`;
}

/** Is this address plain http? Empty, relative and https all answer no. */
export function isPlainHttp(url: string): boolean {
    return /^http:\/\//i.test((url || '').trim());
}

/**
 * The `http` marker.
 *
 * Shown, not blocked. http sources and http downloads are allowed everywhere in this
 * screen — plenty of small catalogues are served from a box without a certificate, and
 * refusing them just means the entry is not in the list at all. What is NOT acceptable is
 * that being invisible: over http anyone on the path serves whatever they like, including
 * a different installer and a matching checksum, and nothing about the row would have said
 * so. So it says so, once, in the same place every other fact about the row lives.
 */
function httpChip(url: string, cls = ''): string {
    if (!isPlainHttp(url)) return '';
    return `<span class="apps-fact-chip apps-fact-http${cls ? ' ' + cls : ''}" data-tooltip="${escAttr(t('apps.httpTip') || 'Served over plain http. Anyone between you and it can change what arrives — including the file and the checksum that would match it.')}">${escHtml(t('apps.http') || 'http')}</span>`;
}

/** Loud pill kept for the detail modal (priceBadge); the browse card uses the
 *  quieter priceText() below so the card carries only one prominent signal. */
function priceBadge(price: string) {
    const cls: Record<string,string> = {
        free: 'apps-price-free', freemium: 'apps-price-freemium',
        paid: 'apps-price-paid', oss: 'apps-price-oss',
    };
    return `<span class="apps-price-badge ${cls[price] || ''}">${escHtml(priceLabel(price))}</span>`;
}

/**
 * The word for a price value — translated, and never guessed.
 *
 * priceText used to fall through to "Free" for anything it did not recognise, so an entry
 * with a missing or misspelt price was announced as free of charge. That is the one wrong
 * answer with consequences: it is the reassuring one.
 */
function priceLabel(price: string): string {
    if (price === 'paid') return t('apps.price.paid') || 'Paid';
    if (price === 'freemium') return t('apps.price.freemium') || 'Freemium';
    if (price === 'oss') return t('apps.price.oss');
    if (price === 'free') return t('apps.price.free') || 'Free';
    return t('apps.price.unknown');
}

/** Subtle, localized price as muted meta text (not a loud overlay pill). */
function priceText(price: string) {
    return `<span class="apps-card-price apps-card-price-${escAttr(price || 'unknown')}">${escHtml(priceLabel(price))}</span>`;
}

/**
 * The word for a category.
 *
 * The card printed the raw value — `utility`, `game` — so a French UI showed an English
 * lowercase identifier on a badge beside three translated ones. The keys existed the whole
 * time; the card simply never asked for them.
 */
function catLabel(cat: string): string {
    const key = `apps.cat.${cat}`;
    const word = t(key);
    // t() returns the key on a miss. A category nobody has named yet should read as the
    // value the catalogue used, not as "apps.cat.whatever".
    return word === key ? cat : word;
}

/** Small (badge-sized) category icon — drawn at 12px via CSS. */
function catIconSm(cat: string) {
    if (cat === 'game') return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="3"/><path d="M7 12h3m-1.5-1.5v3"/><circle cx="16" cy="11" r=".7" fill="currentColor" stroke="none"/><circle cx="18" cy="13" r=".7" fill="currentColor" stroke="none"/></svg>`;
    if (cat === 'utility') return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/></svg>`;
}

/**
 * The tier a source CLAIMED for an entry it was not granted, shown attributed to that source.
 *
 * BMM assigns trust from where a catalogue was fetched, so a community list calling its own
 * entries "official" cannot take the badge — apply_trust overwrites it. It used to be dropped
 * there and forgotten, which is worse than it sounds: a careless catalogue and a deliberate
 * impersonation then looked identical, and the one signal that separates them was thrown away
 * before anybody could see it.
 *
 * So it is rendered, and the wording carries the attribution rather than the styling: "claims
 * official" next to the source host. There is no version of this chip that could be mistaken
 * for BMM's own badge — it never uses the official/partner colours, and it always names who
 * said it.
 */
function claimChip(app: any): string {
    if (!app?.claimed_tier) return '';
    let host = '';
    try { host = new URL(String(app.source_label || '')).host; } catch { host = String(app.source_label || ''); }
    const label = app.claimed_tier === 'official'
        ? (t('apps.badge.claimsOfficial') || 'claims “official”')
        : (t('apps.badge.claimsPartner') || 'claims “partner”');
    const title = (t('apps.badge.claimHint') || 'This catalogue calls itself that. BMM did not — trust comes from where a catalogue is fetched, not from what it says.')
        + (host ? ` (${host})` : '');
    return `<span class="apps-claim-badge" title="${escAttr(title)}">⚠ ${escHtml(label)}</span>`;
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
          ${app.thumb ? `<img src="${escAttr(app.thumb)}" alt="" loading="lazy" data-onerror="hide">` : thumbIcon(app.category||'other')}
        </div>
        <div class="apps-installed-info">
          <div class="apps-installed-title">${escHtml(app.title)}</div>
          <div class="apps-installed-path" data-tooltip="${escAttr(app.install_path)}">${escHtml(app.install_path||'—')}</div>
          <div class="apps-installed-meta">
            ${app.version ? `<span>v${escHtml(app.version)}</span>` : ''}
            <span>${t('apps.usage')||'Usage'}: ${formatDuration(app.usage_seconds)}</span>
            ${!app.exe_path ? `<span class="apps-pending-exe">${t('apps.noExe')||'Exe not set'}</span>` : ''}
          </div>
        </div>
        <div class="apps-installed-actions">
          <button class="apps-inst-fav-btn${_state.favorites.includes(app.id)?' active':''}" data-action="fav" data-id="${escAttr(app.id)}" data-tooltip="${_state.favorites.includes(app.id)?(t('apps.unfavorite')||'Unfavorite'):(t('apps.favorite')||'Favorite')}">
            ${_state.favorites.includes(app.id) ? IC.starFill : IC.star}
          </button>
          ${app.exe_path
            ? `<button class="btn btn-sm btn-accent" data-action="launch" data-id="${escAttr(app.id)}" data-exe="${escAttr(app.exe_path)}">${IC.play} ${t('apps.launch')||'Launch'}</button>`
            : `<button class="btn btn-sm btn-ghost" data-action="pick-exe" data-id="${escAttr(app.id)}">${IC.monitor} ${t('apps.pickExe')||'Set exe'}</button>`}
          ${app.exe_path ? `<button class="btn btn-sm btn-ghost" data-action="change-launcher" data-id="${escAttr(app.id)}" data-tooltip="${escAttr(app.exe_path)}">${IC.replace || IC.replace}</button>` : ''}
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

            if (action === 'fav') {
                try {
                    _state.favorites = await invoke('toggle_app_favorite', { appId: id });
                    await refreshState();
                    renderInstalled();
                } catch (err) { toast(String(err), 'error'); }
                return;
            }
            if (action === 'launch') {
                try {
                    await invoke('launch_app', { appId: id, exePath: el.dataset.exe });
                    toast(`${t('apps.launched')||'Launched'}: ${_state.installed[id]?.title}`, 'success');
                    await refreshState();
                } catch (err) { toast(String(err), 'error'); }
            }
            if (action === 'pick-exe') {
                const file = await pickFile({ filters: [{ name: 'Executable', extensions: ['exe', 'msi', 'bat', 'cmd', 'vbs', 'ps1'] }] }).catch(() => null);
                if (!file) return;
                try {
                    await invoke('register_installed_exe', { appId: id, exePath: file });
                    toast(t('apps.exeSet')||'Executable set', 'success');
                    await refreshAndRender();
                } catch (err) { toast(String(err), 'error'); }
            }
            if (action === 'change-launcher') {
                // List every runnable file in the app folder and let the user re-pick
                // the one BMM launches (with Browse fallback). Current choice pre-selected.
                let exes: { name: string; path: string; size: number }[] = [];
                try { exes = await invoke('list_app_executables', { appId: id }); } catch {}
                const current = _state.installed[id]?.exe_path;
                if (current) {
                    // Put the current launcher first so it's the pre-selected "★ auto" entry
                    exes = [
                        ...exes.filter(e => e.path === current),
                        ...exes.filter(e => e.path !== current),
                    ];
                    if (!exes.some(e => e.path === current)) {
                        exes.unshift({ name: current.split(/[\\/]/).pop() || current, path: current, size: 0 });
                    }
                }
                if (exes.length === 0) {
                    // Nothing detected → straight to Browse
                    const file = await pickFile([{ name: 'Executable / Script', extensions: ['exe', 'bat', 'cmd', 'vbs', 'ps1', 'msi'] }]).catch(() => null);
                    if (file) {
                        try { await invoke('set_app_main_exe', { appId: id, exePath: file }); toast(t('apps.launcherSet')||'Launcher updated', 'success'); await refreshAndRender(); }
                        catch (err) { toast(String(err), 'error'); }
                    }
                    return;
                }
                showLauncherPicker(id, exes, () => refreshAndRender());
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

    // Base: all favorited apps present in catalog
    let apps = _catalog.filter(a => _state.favorites.includes(a.id));

    if (!apps.length) {
        content.innerHTML = `<div class="apps-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.4"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg><p>${t('apps.noFavorites')||'No favorites yet'}</p></div>`;
        return;
    }

    // All unique sources in favorites
    const allSources = [...new Set(apps.map(a => a.source_label || '').filter(Boolean))];
    // All unique categories in favorites
    const allCats = [...new Set(apps.map(a => a.category))];

    // Apply collection filter
    if (_favCollection !== 'all') {
        const col = _collections.find(c => c.id === _favCollection);
        apps = col ? apps.filter(a => col.appIds.includes(a.id)) : apps;
    }
    // Apply search
    if (_favSearch) {
        const q = _favSearch.toLowerCase();
        apps = apps.filter(a => a.title.toLowerCase().includes(q) || a.tags.some(tg => tg.toLowerCase().includes(q)));
    }
    // Apply category filter
    if (_favFilterCat !== 'all') apps = apps.filter(a => a.category === _favFilterCat);
    // Apply source filter
    if (_favFilterSource !== 'all') apps = apps.filter(a => a.source_label === _favFilterSource);

    const chip = (val: string, cur: string, label: string, cb: string) =>
        `<button class="apps-tag-chip${cur === val ? ' active' : ''}" data-ffc="${cb}" data-ffv="${escAttr(val)}">${escHtml(label)}</button>`;

    content.innerHTML = `
    <div class="apps-fav-toolbar">
      <div class="apps-fav-search-wrap">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="apps-fav-search" id="fav-search" type="text" placeholder="${t('common.search')||'Search...'}" value="${escAttr(_favSearch)}">
      </div>
      ${allCats.length > 1 ? `<select class="apps-filter" id="fav-filter-cat">
        <option value="all"${_favFilterCat==='all'?' selected':''}>${t('apps.filter.allCat')||'All categories'}</option>
        ${allCats.map(c => `<option value="${escAttr(c)}"${_favFilterCat===c?' selected':''}>${escHtml(c)}</option>`).join('')}
      </select>` : ''}
      ${allSources.length > 1 ? `<select class="apps-filter" id="fav-filter-source">
        <option value="all"${_favFilterSource==='all'?' selected':''}>${t('apps.fav.allSources')||'All sources'}</option>
        ${allSources.map(s => `<option value="${escAttr(s)}"${_favFilterSource===s?' selected':''}>${escHtml(labelFromUrl(s))}</option>`).join('')}
      </select>` : ''}
    </div>

    <div class="apps-collections">
      <div class="apps-collection-row${_favCollection==='all'?' active':''}" data-coll="all">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        <span class="apps-collection-name">${t('apps.fav.allFavs')||'All favorites'}</span>
        <span class="apps-collection-count">${_state.favorites.length}</span>
      </div>
      ${_collections.map(col => `
      <div class="apps-collection-row${_favCollection===col.id?' active':''}" data-coll="${escAttr(col.id)}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span class="apps-collection-name">${escHtml(col.name)}</span>
        <span class="apps-collection-count">${col.appIds.filter(id => _state.favorites.includes(id)).length}</span>
        <button class="btn btn-xs btn-ghost btn-danger-ghost" data-del-coll="${escAttr(col.id)}" style="margin-left:auto">${IC.trash}</button>
      </div>`).join('')}
      <div class="apps-coll-add-row">
        <input class="apps-path-input" id="new-coll-name" type="text" placeholder="${t('apps.fav.newCollection')||'New collection name…'}" style="font-size:12px">
        <button class="btn btn-sm btn-ghost" id="add-coll-btn">${IC.plus}</button>
      </div>
    </div>

    ${apps.length === 0
      ? `<div class="apps-empty" style="height:140px"><p>${t('apps.fav.noMatch')||'No matching favorites'}</p></div>`
      : `<div class="apps-grid">${apps.map(a => renderAppCardWithCollMenu(a)).join('')}</div>`}`;

    // Search
    document.getElementById('fav-search')?.addEventListener('input', e => { _favSearch = (e.target as HTMLInputElement).value; clearTimeout(_favSearchDeb); _favSearchDeb = setTimeout(() => renderFavorites(), 150); });
    // Category filter
    document.getElementById('fav-filter-cat')?.addEventListener('change', e => { _favFilterCat = (e.target as HTMLSelectElement).value; renderFavorites(); });
    // Source filter
    document.getElementById('fav-filter-source')?.addEventListener('change', e => { _favFilterSource = (e.target as HTMLSelectElement).value; renderFavorites(); });

    // Collection select
    content.querySelectorAll('[data-coll]').forEach(r => {
        r.addEventListener('click', e => {
            if ((e.target as HTMLElement).closest('[data-del-coll]')) return;
            _favCollection = (r as HTMLElement).dataset.coll || 'all';
            renderFavorites();
        });
    });
    // Delete collection
    content.querySelectorAll('[data-del-coll]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const id = (btn as HTMLElement).dataset.delColl!;
            _collections = _collections.filter(c => c.id !== id);
            saveCollections(_collections);
            if (_favCollection === id) _favCollection = 'all';
            renderFavorites();
        });
    });
    // Add collection
    document.getElementById('add-coll-btn')?.addEventListener('click', () => {
        const inp = document.getElementById('new-coll-name') as HTMLInputElement;
        const name = inp.value.trim();
        if (!name) return;
        _collections.push({ id: `coll_${Date.now()}`, name, appIds: [] });
        saveCollections(_collections);
        inp.value = '';
        renderFavorites();
    });
    // Card click + "add to collection" context
    content.querySelectorAll('[data-app-id]').forEach(card => {
        card.addEventListener('click', e => {
            if ((e.target as HTMLElement).closest('[data-add-to-coll]')) return;
            openDetailModal((card as HTMLElement).dataset.appId || '');
        });
    });
    // Add to collection button
    content.querySelectorAll('[data-add-to-coll]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const el = btn as HTMLElement;
            const appId = el.dataset.addToColl!;
            const collId = el.dataset.collTarget!;
            if (!collId) return;
            const col = _collections.find(c => c.id === collId);
            if (!col) return;
            if (!col.appIds.includes(appId)) col.appIds.push(appId);
            else col.appIds = col.appIds.filter(id => id !== appId);
            saveCollections(_collections);
            renderFavorites();
        });
    });
}

// App card with "add to collection" mini-menu
function renderAppCardWithCollMenu(app: AppEntry) {
    const base = renderAppCard(app);
    if (!_collections.length) return base;

    // Inject a small "folder+" button at the bottom of the card body
    const menuId = `coll-menu-${app.id}`;
    const inColls = _collections.filter(c => c.appIds.includes(app.id));
    return base.replace('</div>\n    </div>', `
      <div style="margin-top:4px;position:relative">
        <button class="apps-tag-chip" id="btn-${menuId}" data-tooltip="${t('apps.fav.addToCollection')||'Add to collection'}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          ${inColls.length ? inColls.map(c => escHtml(c.name)).join(', ') : (t('apps.fav.addToCollection')||'Collection')}
        </button>
        <div id="${menuId}" style="display:none;position:absolute;bottom:28px;left:0;background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:4px;z-index:100;min-width:140px">
          ${_collections.map(c => `
          <button class="apps-hist-row" data-add-to-coll="${escAttr(app.id)}" data-coll-target="${escAttr(c.id)}" style="width:100%;text-align:left;border:none;cursor:pointer">
            ${c.appIds.includes(app.id) ? IC.check : '<svg width="13" height="13" viewBox="0 0 24 24"></svg>'}
            ${escHtml(c.name)}
          </button>`).join('')}
        </div>
      </div>
    </div>\n    </div>`);
}

// ── History ───────────────────────────────────────────────────────────────────

const HIST_CFG: Record<string, { svg: string; cls: string; label: string }> = {
    install:   { svg: IC.histInstall, cls: 'apps-action-install',   label: 'Installed' },
    launch:    { svg: IC.histLaunch,  cls: 'apps-action-launch',    label: 'Launched' },
    uninstall: { svg: IC.histRemove,  cls: 'apps-action-uninstall', label: 'Uninstalled' },
};

function parseTs(ts: string): Date | null {
    // Rust format: "YYYY-MM-DD HH:MM:SS UTC"
    const m = ts.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]));
}

function histDayLabel(ts: string): string {
    const d = parseTs(ts);
    if (!d) return ts;
    const now = new Date();
    const dayDiff = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
        - Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    if (dayDiff <= 0)  return t('apps.history.today')     || 'Today';
    if (dayDiff === 1) return t('apps.history.yesterday') || 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}

function histTime(ts: string): string {
    const d = parseTs(ts);
    if (!d) return '';
    return d.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
}

function renderHistory() {
    const content = document.getElementById('apps-content');
    if (!content) return;

    const all = [..._state.history].reverse();

    if (!all.length) {
        content.innerHTML = `<div class="apps-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3"><polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 1 .5 4M3 16v-5h5"/></svg>
          <p>${t('apps.noHistory')||'No activity yet'}</p>
        </div>`;
        return;
    }

    // Counts per action
    const cnt: Record<string, number> = { all: all.length, install: 0, launch: 0, uninstall: 0 };
    all.forEach(e => { if (cnt[e.action] !== undefined) cnt[e.action]++; });

    // Filter
    const entries = _historyFilter === 'all' ? all : all.filter(e => e.action === _historyFilter);

    // Group by day
    const days: { label: string; rows: typeof entries }[] = [];
    entries.forEach(e => {
        const label = histDayLabel(e.timestamp);
        const last = days[days.length - 1];
        if (last && last.label === label) last.rows.push(e);
        else days.push({ label, rows: [e] });
    });

    const chip = (id: string, label: string) => `
      <button class="apps-hist-chip${_historyFilter === id ? ' active' : ''}" data-hf="${id}">
        ${label}
        <span class="apps-hist-chip-n">${cnt[id] ?? 0}</span>
      </button>`;

    content.innerHTML = `
    <div class="apps-hist-toolbar">
      <div class="apps-hist-chips">
        ${chip('all',       t('apps.history.all')        || 'All')}
        ${chip('install',   t('apps.history.installed')  || 'Installed')}
        ${chip('launch',    t('apps.history.launched')   || 'Launched')}
        ${chip('uninstall', t('apps.history.uninstalled')|| 'Uninstalled')}
      </div>
      <button class="btn btn-sm btn-ghost" id="apps-clear-history">
        ${IC.trash} ${t('apps.clearHistory') || 'Clear'}
      </button>
    </div>

    ${entries.length === 0
        ? `<div class="apps-empty" style="height:120px"><p>${t('apps.history.noneFilter')||'No entries for this filter'}</p></div>`
        : days.map(day => `
      <div class="apps-hist-day">
        <div class="apps-hist-day-label">${escHtml(day.label)}</div>
        <div class="apps-hist-day-rows">
          ${day.rows.map(e => {
              const cfg = HIST_CFG[e.action] || { svg: IC.info, cls: '', label: e.action };
              return `<div class="apps-hist-entry">
                <div class="apps-hist-icon ${cfg.cls}">${cfg.svg}</div>
                <div class="apps-hist-body">
                  <span class="apps-hist-action-label">${cfg.label}</span>
                  <span class="apps-hist-app-name">${escHtml(e.app_title)}</span>
                </div>
                <span class="apps-hist-clock">${escHtml(histTime(e.timestamp))}</span>
              </div>`;
          }).join('')}
        </div>
      </div>`).join('')
    }`;

    content.querySelectorAll('.apps-hist-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            _historyFilter = (btn as HTMLElement).dataset.hf || 'all';
            renderHistory();
        });
    });

    document.getElementById('apps-clear-history')?.addEventListener('click', async () => {
        await invoke('clear_app_history').catch(() => {});
        _historyFilter = 'all';
        await refreshAndRender();
    });
}

// ── Sources ───────────────────────────────────────────────────────────────────

function renderSources() {
    _origins = readOrigins();
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
        <!-- A catalogue that needs no host at all. -->
        <button class="btn btn-sm btn-secondary" id="apps-add-bundle">${IC.folder} ${escHtml(t('apps.sources.addBundle') || 'Follow a .bmmbundle…')}</button>
      </div>
      ${sourceAccessHtml('apps')}
      <div class="apps-sources-list">
        <div class="apps-source-row apps-source-official">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
          <span class="apps-source-url">${escHtml(getLinks().apps_catalog)}</span>
          <span class="apps-source-label">${t('apps.sources.official')||'Official'}</span>
        </div>
        ${_state.community_sources.map(url => `
        <div class="apps-source-row${isDisabled(url) ? ' is-off' : ''}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <span class="apps-source-url" data-tooltip="${escAttr(url)}">${escHtml(url)}</span>
          ${httpChip(url, 'apps-source-label')}
          ${(() => {
            // Where this source came from. Shown because a list of a dozen URLs gives no
            // way to tell one you chose from one an index brought in — which matters when
            // you want to stop following a whole index rather than hunt its entries.
            //
            // No badge at all when nobody recorded an origin: absent means "added by hand",
            // which is a real answer, and labelling it would be inventing one.
            const from = _origins[url];
            return from ? `<span class="apps-source-from" data-tooltip="${escAttr(from)}">${escHtml(t('apps.sources.via') || 'via')} ${escHtml(originLabel(from))}</span>` : '';
          })()}
          <button class="btn btn-xs btn-ghost apps-source-toggle" data-url="${escAttr(url)}"
                  data-tooltip="${escAttr(isDisabled(url)
                      ? (t('apps.sources.on') || 'Fetch this one again')
                      : (t('apps.sources.off') || 'Keep it listed but stop fetching it'))}">${escHtml(isDisabled(url) ? (t('apps.sources.isOff') || 'off') : (t('apps.sources.isOn') || 'on'))}</button>
          <button class="btn btn-xs btn-ghost btn-danger-ghost apps-source-remove" data-url="${escAttr(url)}">${IC.close}</button>
        </div>`).join('')}
      </div>
    </div>`;

    // Wired HERE, right after the markup is in the DOM — not inside a click handler.
    //
    // It was inside the "Add" handler, so nothing about the protected-source block existed
    // until you pressed a button that has nothing to do with it: the key list never filled and
    // MANAGE KEYS did nothing. A wire call that runs at the wrong moment fails exactly like a
    // wire call that was never written, and neither says anything.
    wireSourceAccess('apps', (m, k) => toast(m, k === 'warning' ? 'warning' : 'success'),
        () => { (document.getElementById('nav-settings') as HTMLElement | null)?.click(); setTimeout(() => document.getElementById('settings-identity-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250); },
        () => (document.getElementById('apps-source-input') as HTMLInputElement | null)?.value?.trim() || '');

    document.getElementById('apps-add-bundle')?.addEventListener('click', async () => {
        const path = await pickFile({ filters: [{ name: t('catpub.bundleKind') || 'Bundle', extensions: ['bmmbundle', 'zip'] }] }).catch(() => null);
        if (!path) return;
        const src = `bundle:${path}`;
        if (_state.community_sources.includes(src)) { toast(t('apps.sources.already') || 'Already following that one', 'info'); return; }
        try {
            // Opened before it is followed. A file that is not an app catalogue must fail
            // HERE, with the reason, rather than becoming a source that quietly contributes
            // nothing to the list.
            const found = await appsFromBundle(src);
            if (!found.length) { toast(t('apps.create.errNoApps') || 'No apps in there', 'warning', 7000); return; }
            _state.community_sources.push(src);
            await writeSources('apps', _state.community_sources);
            toast((t('apps.sources.bundleAdded') || 'Following — {n} app(s)').replace('{n}', String(found.length)), 'success');
            _catalog = null;
            renderSources();
        } catch (e) {
            toast(`${t('common.error')}: ${e}`, 'error', 7000);
        }
    });

    document.getElementById('apps-add-source')?.addEventListener('click', async () => {
        const input = document.getElementById('apps-source-input') as HTMLInputElement;
        const url = input.value.trim();
        if (!url.startsWith('http')) { toast(t('apps.sources.invalidUrl')||'Invalid URL', 'error'); return; }
        try {
            // An index pasted here would be accepted and then read as an app catalog with no
            // `apps` array — a source that "works" and contains nothing, with no hint that
            // the wrong kind of document was added. Somebody handed an index URL pastes it
            // into whichever box is in front of them; they all take a URL and none of them
            // says which document it wants.
            //
            // Checked by SHAPE, not by the address: a file called catalogs.json can be
            // anything. Fetched through the backend so the same TLS and identity handling
            // every other catalog fetch gets applies here too.
            try {
                const probe: string = await fetchSourceText(url, true);
                const doc = JSON.parse(probe);
                if (looksLikeIndex(doc)) {
                    // Imported HERE, and only its app entries. This used to refuse and point at
                    // Settings, which was correct and unhelpful: this panel knows it is the app
                    // browser, the index says which entries are apps, and following them is the
                    // same three writes this handler already does by hand.
                    //
                    // Its other four types are left alone. An index lists catalogues for all of
                    // them, and an app browser quietly following theme catalogues would be a
                    // bigger action than the one that was asked for.
                    const r = await importIndexForType(doc, 'app', url,
                        async (u) => { _state.community_sources = await invoke('add_community_source', { url: u }); },
                        writeSources);
                    input.value = '';
                    toast(r.added
                        ? (t('apps.sources.fromIndex') || 'Added {n} app catalog(s) from that index.').replace('{n}', String(r.added))
                        : r.ofType
                            ? (t('apps.sources.indexAll') || 'That index lists {n} app catalog(s) and you already follow them all.').replace('{n}', String(r.ofType))
                            : (t('apps.sources.indexNone2') || 'No app catalogues in that index — it holds {what}. Add those from their own screens.')
                                .replace('{what}', describeKinds(r.kinds) || String(r.total)),
                        r.added ? 'success' : 'info');
                    renderSources();
                    await loadCatalog(true);
                    return;
                }
            } catch { /* unreachable or not JSON — let the normal add path report it */ }

            _state.community_sources = await invoke('add_community_source', { url });
            input.value = '';
            toast(t('apps.sources.added')||'Source added', 'success');
            renderSources();
            // Auto-reload catalog to include the new source
            await loadCatalog(true);
        } catch (e) { toast(String(e), 'error'); }
    });

    content.querySelectorAll('.apps-source-toggle').forEach(btn => {
        btn.addEventListener('click', async () => {
            const url = (btn as HTMLElement).dataset.url || '';
            setDisabled(url, !isDisabled(url));
            renderSources();
            await loadCatalog(true);
        });
    });

    content.querySelectorAll('.apps-source-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
            const url = (btn as HTMLElement).dataset.url || '';
            try {
                _state.community_sources = await invoke('remove_community_source', { url });
                // The same three things Settings drops when it unfollows. Removing here used
                // to leave the origin behind, write no history line — so a source removed
                // from this panel could not be brought back from the history that exists for
                // exactly that — and keep an OFF flag that would come back with it.
                forgetOrigin(url);
                setDisabled(url, false);
                recordHistory({ action: 'remove', type: 'app', url });
                renderSources();   // re-reads _origins itself
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

const DRAFT_KEY = 'bmm_apps_catalog_draft';

/**
 * The catalogue being built.
 *
 * Kept on disk between sessions. It was a module-level variable, so closing BMM threw away
 * a catalogue somebody had been assembling entry by entry — and each entry takes a URL, a
 * size and a checksum, which is not work anybody wants to do twice.
 */
let _draft: CatalogDraft = { name: '', description: '', partner_catalogs: [], community_imports: [], apps: [] };

function loadDraft(): void {
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return;
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.apps)) {
            _draft = {
                name: String(d.name || ''), description: String(d.description || ''),
                partner_catalogs: d.partner_catalogs || [], community_imports: d.community_imports || [],
                apps: d.apps,
            };
        }
    } catch { /* a draft that will not parse is one to start again from, not to crash on */ }
}

/** Parse a catalogue document into the draft, and keep it. Returns how many came in. */
function intoDraft(json: any): number {
    _draft = parseCatalog(json) as CatalogDraft;
    saveDraft();
    return _draft.apps.length;
}

function saveDraft(): void {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(_draft)); } catch { /* quota, private mode */ }
}

/** True once the stored draft has been read, so switching tabs does not re-read it over
 *  edits made since. */
let _draftLoaded = false;

/** The file the app editor is currently offering to pack, while its modal is open. */
let _pickedFile = '';

function renderCreate() {
    const content = document.getElementById('apps-content');
    if (!content) return;
    if (!_draftLoaded) { _draftLoaded = true; loadDraft(); }
    const problems = problemsOf(_draft, (k, f) => t(k) || f);

    content.innerHTML = `
    <div class="apps-create-wrap">
      <div class="apps-create-header">
        <h3>${t('apps.create.title')||'Create a Catalog'}</h3>
        <p class="apps-sources-desc">${t('apps.create.desc')||'Build a catalog.json to share with others or host on GitHub.'}</p>
        <!-- Reopening one. The screen could only build from nothing, so publishing a
             catalogue was a one-way trip: a typo in one entry meant reassembling all of
             them by hand, each with a URL, a size and a checksum. -->
        <div class="apps-create-open">
          <button class="btn btn-xs btn-secondary" id="cr-open-file">${IC.folder} ${escHtml(t('apps.create.openFile') || 'Open a catalog.json…')}</button>
          <input class="apps-source-input apps-create-open-url" id="cr-open-url-input" type="text"
                 placeholder="${escAttr(t('apps.create.openUrlPh') || 'https://…/catalog.json')}">
          <button class="btn btn-xs btn-ghost" id="cr-open-url">${escHtml(t('apps.create.openUrl') || 'From a URL')}</button>
          ${_draft.apps.length || _draft.name
            ? `<button class="btn btn-xs btn-ghost btn-danger-ghost" id="cr-clear">${escHtml(t('apps.create.clear') || 'Start again')}</button>`
            : ''}
        </div>
        <!-- The same panel the Sources tab has. fetchSourceText already asks for a password
             when a source turns out to be protected, and already reads ssh:// sources by
             name — but only the Sources tab let you REGISTER either, so opening your own
             protected catalogue from here was the one place credentials could not be
             attached. -->
        ${sourceAccessHtml('appscreate')}
      </div>

      <div class="apps-create-section">
        <label class="apps-install-label">${t('apps.create.catalogName')||'Catalog name'}</label>
        <input class="apps-path-input" id="cr-name" type="text" placeholder="${escAttr(t('apps.create.namePh'))}" value="${escAttr(_draft.name)}">
        <label class="apps-install-label" style="margin-top:10px">${t('apps.create.catalogDesc')||'Description'}</label>
        <input class="apps-path-input" id="cr-desc" type="text" placeholder="${escAttr(t('apps.create.descPh'))}" value="${escAttr(_draft.description)}">
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
            <!-- The row said id and title. Auditing your own catalogue meant opening every
                 entry to see whether it had a URL and a checksum at all. -->
            <span class="apps-create-app-facts">
              ${app.category ? `<span class="apps-tag">${escHtml(catLabel(app.category))}</span>` : ''}
              ${app.price ? `<span class="apps-tag">${escHtml(priceLabel(app.price))}</span>` : ''}
              ${((app as any).download?.sha256 || '').trim()
                ? `<span class="apps-fact-chip apps-fact-sha">${escHtml(t('apps.shaYes') || 'checksum')}</span>`
                : `<span class="apps-fact-chip apps-fact-nosha">${escHtml(t('apps.shaNo') || 'unverified')}</span>`}
              ${((app as any).download?.url || '').trim()
                ? httpChip((app as any).download?.url || '')
                : `<span class="apps-fact-chip apps-fact-bad">${escHtml(t('apps.create.pbNoUrlShort') || 'no URL')}</span>`}
            </span>
            <div style="display:flex;gap:6px;margin-left:auto">
              <button class="btn btn-xs btn-ghost" data-cr-edit="${i}">${escHtml(t('common.edit') || 'Edit')}</button>
              <button class="btn btn-xs btn-ghost btn-danger-ghost" data-cr-del="${i}">${IC.trash}</button>
            </div>
          </div>`).join('') || `<p style="color:var(--text-muted);font-size:12px">${t('apps.create.noApps')||'No apps yet — click Add app'}</p>`}
        </div>
      </div>

      <!-- Said before the export, not after somebody follows it. Never blocking: it is a
           document, and a document with a problem in it is still the author's to publish. -->
      ${problems.length ? `
      <div class="apps-create-problems">
        <span class="apps-create-problems-h">${escHtml((t('apps.create.problems') || '{n} thing(s) to look at').replace('{n}', String(problems.length)))}</span>
        <ul>${problems.map(p => `<li>${escHtml(p)}</li>`).join('')}</ul>
      </div>` : ''}

      <div class="apps-create-actions">
        <button class="btn btn-ghost" id="cr-preview">${t('apps.create.preview')||'Preview JSON'}</button>
        <button class="btn btn-accent" id="cr-copy">${t('apps.create.copy')||'Copy JSON'}</button>
        <button class="btn btn-ghost" id="cr-download">${IC.download} ${t('apps.create.download')||'Download catalog.json'}</button>
        <!-- The only one of these that needs no hosting afterwards. -->
        <button class="btn btn-secondary" id="cr-bundle">${escHtml(t('apps.create.publishBundle') || 'Publish as one file (.bmmbundle)…')}</button>
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

    // Close sub-modal by clicking backdrop (re-attach each time renderCreate runs since it rebuilds DOM)
    document.getElementById('cr-app-modal')?.addEventListener('click', e => {
        if ((e.target as HTMLElement).id === 'cr-app-modal') {
            document.getElementById('cr-app-modal')!.classList.remove('open');
        }
    });
    document.getElementById('cr-app-close')?.addEventListener('click', () => {
        document.getElementById('cr-app-modal')!.classList.remove('open');
    });

    wireSourceAccess('appscreate', (m, k) => toast(m, k === 'warning' ? 'warning' : 'success'),
        () => { (document.getElementById('nav-settings') as HTMLElement | null)?.click(); setTimeout(() => document.getElementById('settings-identity-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250); },
        () => (document.getElementById('cr-open-url-input') as HTMLInputElement | null)?.value?.trim() || '');

    // Sync name/desc inputs to draft
    document.getElementById('cr-name')?.addEventListener('input', e => { _draft.name = (e.target as HTMLInputElement).value; saveDraft(); });
    document.getElementById('cr-desc')?.addEventListener('input', e => { _draft.description = (e.target as HTMLInputElement).value; saveDraft(); });

    {
        // The failure carries a KEY, so it reaches the reader in their language rather than
        // as `apps.create.errNoApps` in both.
        const blame = (e: unknown) => {
            const key = String(e).replace(/^Error:\s*/, '').split('|')[0].trim();
            toast(key.startsWith('apps.create.') ? (t(key) || key) : String(e), 'error', 7000);
        };
        const took = (n: number) => {
            toast((t('apps.create.opened') || 'Opened — {n} app(s)').replace('{n}', String(n)), 'success');
            renderCreate();
        };
        document.getElementById('cr-open-file')?.addEventListener('click', async () => {
            const picked = await pickFile({ filters: [{ name: 'catalog.json', extensions: ['json'] }] }).catch(() => null);
            if (!picked) return;
            try { took(intoDraft(JSON.parse(await invoke('read_file_text', { path: picked }) as string))); }
            catch (e) { blame(e); }
        });
        document.getElementById('cr-open-url')?.addEventListener('click', async () => {
            const url = (document.getElementById('cr-open-url-input') as HTMLInputElement)?.value.trim() || '';
            if (!url.startsWith('http')) { toast(t('apps.sources.invalidUrl') || 'Invalid URL', 'error'); return; }
            try { took(intoDraft(JSON.parse(await fetchSourceText(url)))); }
            catch (e) { blame(e); }
        });
        document.getElementById('cr-clear')?.addEventListener('click', async () => {
            const ok = await showConfirm(
                t('apps.create.clear') || 'Start again',
                (t('apps.create.clearBody') || 'This throws away the draft — {n} entr(ies). Export it first if you want to keep it.').replace('{n}', String(_draft.apps.length)),
                true,
            );
            if (!ok) return;
            _draft = { name: '', description: '', partner_catalogs: [], community_imports: [], apps: [] };
            saveDraft();
            renderCreate();
        });
    }

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
            saveDraft();
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

    document.getElementById('cr-bundle')?.addEventListener('click', () => { void publishBundle(); });

    document.getElementById('cr-app-close')?.addEventListener('click', () => {
        document.getElementById('cr-app-modal')!.classList.remove('open');
    });
}

/**
 * Write the catalogue and everything it packs into one `.bmmbundle`.
 *
 * The same shape the plugin catalogue builder uses, and deliberately so: stage in a
 * temporary folder, copy the packed payloads beside the document, zip the folder, throw the
 * staging away. Publishing used to leave a pile of loose files in whatever directory
 * somebody had picked for one thing.
 *
 * An entry with an address keeps it. An entry with a file handed over gets that file copied
 * in and its `url` rewritten to the neighbour's name. An entry with NEITHER is named and
 * left alone — a catalogue that silently dropped one app is worse than one that says which.
 */
async function publishBundle(): Promise<void> {
    const out = (await saveFile({
        defaultPath: `${(_draft.name || 'catalog').replace(/[^A-Za-z0-9._-]/g, '_')}.bmmbundle`,
        filters: [{ name: t('catpub.bundleKind') || 'Bundle', extensions: ['bmmbundle'] }],
    }).catch(() => null)) as string;
    if (!out) return;
    const dir = (await invoke('catalog_bundle_stage').catch(() => null)) as string;
    if (!dir) { toast(t('catpub.stageFailed') || 'Could not stage', 'error'); return; }
    const sep = dir.includes('\\') ? '\\' : '/';
    try {
        const doc: any = JSON.parse(buildCatalogJson());
        let packed = 0;
        for (let i = 0; i < doc.apps.length; i++) {
            const src = String((_draft.apps[i] as any)?.src_file || '');
            const hasUrl = String(doc.apps[i]?.download?.url || '').trim();
            if (!src) {
                if (!hasUrl) {
                    toast((t('apps.create.pbNoUrl') || '{id}: no download URL').replace('{id}', doc.apps[i]?.id || '?'), 'warning', 6000);
                }
                continue;
            }
            // The name inside the bundle. Derived from the id, not from the source path:
            // two authors' files can share a basename, and the id is already unique here.
            const ext = (src.replace(/^.*[/\\]/, '').split('.').pop() || 'bin').toLowerCase();
            const file = `${String(doc.apps[i].id).replace(/[^A-Za-z0-9._-]/g, '_')}.${ext}`;
            try {
                await invoke('copy_file', { src, dest: `${dir}${sep}${file}` });
                doc.apps[i].download.url = file;
                packed++;
            } catch (e) {
                // Named, and the entry keeps whatever address it had.
                toast(`${t('apps.create.packFailed') || 'Could not pack'} ${doc.apps[i]?.id}: ${e}`, 'warning', 7000);
            }
        }
        await invoke('write_text_file', { path: `${dir}${sep}catalog.json`, content: JSON.stringify(doc, null, 2) });
        const res: any = await invoke('catalog_bundle_pack', { dir, out });
        toast((t('apps.create.bundled') || 'Published — {n} app(s) packed, {f}')
            .replace('{n}', String(packed))
            .replace('{f}', String(out).replace(/^.*[/\\]/, '')), 'success', 7000);
        if (res?.missing?.length) {
            toast((t('apps.create.packMissing') || '{n} entr(ies) name a file that is not in the folder')
                .replace('{n}', String(res.missing.length)), 'warning', 8000);
        }
    } catch (e) {
        toast(`${t('common.error')}: ${e}`, 'error', 8000);
    } finally {
        // Whatever happened, the staging folder is not left behind.
        await invoke('catalog_bundle_unstage', { dir }).catch(() => {});
    }
}

function buildCatalogJson(): string {
    const cat = {
        version: '1.0',
        name: _draft.name || 'My Catalog',
        description: _draft.description || '',
        partner_catalogs: [] as string[],
        community_imports: [] as string[],
        // NOT the draft's entries verbatim.
        //
        // `src_file` is where the payload sits on THIS machine — `C:\Users\<name>\Downloads\
        // setup.exe` — and publishing the draft as-is would put the author's home directory
        // and their username in a document meant to be handed to strangers. Anything that
        // starts with `_` goes the same way: those are this screen's bookkeeping, never part
        // of what a catalogue says.
        apps: _draft.apps.map((a) => {
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(a)) {
                if (k === 'src_file' || k.startsWith('_')) continue;
                out[k] = v;
            }
            return out;
        }),
    };
    return JSON.stringify(cat, null, 2);
}

function openAppEditor(index: number | null) {
    // Which file this entry hands over, for as long as the modal is open. Seeded from the
    // entry so reopening one that already had a file does not silently drop it on Save.
    _pickedFile = String((_draft.apps[index ?? -1] as any)?.src_file || '');
    const existing = index !== null ? _draft.apps[index] : {};
    const body = document.getElementById('cr-app-body')!;

    const field = (id: string, label: string, val: string, placeholder = '') =>
        `<label class="apps-install-label">${label}</label>
         <input class="apps-path-input" id="cr-${id}" type="text" value="${escAttr(val||'')}" placeholder="${escAttr(placeholder)}" style="margin-bottom:8px">`;

    body.innerHTML = `
    <div class="apps-install-form">
      <h3 class="apps-install-title">${index !== null ? (t('apps.create.editApp')||'Edit App') : (t('apps.create.addApp')||'Add App')}</h3>
      ${field('id', t('apps.create.fId')||'ID (unique, no spaces)', existing.id||'', 'my-app-name')}
      ${field('title', t('apps.create.fTitle')||'Title', existing.title||'', 'My App')}
      <label class="apps-install-label">${t('apps.create.fDesc')||'Description'}</label>
      <textarea class="apps-path-input" id="cr-description" rows="2" style="resize:vertical;margin-bottom:8px">${escHtml(existing.description||'')}</textarea>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div>
          <label class="apps-install-label">${t('apps.create.fCategory')||'Category'}</label>
          <select class="apps-filter" id="cr-category" style="width:100%">
            <option value="game"${existing.category==='game'?' selected':''}>${t('apps.cat.game')||'Game'}</option>
            <option value="utility"${existing.category==='utility'||!existing.category?' selected':''}>${t('apps.cat.utility')||'Utility'}</option>
            <option value="other"${existing.category==='other'?' selected':''}>${t('apps.cat.other')||'Other'}</option>
          </select>
        </div>
        <div>
          <label class="apps-install-label">${t('apps.create.fPrice')||'Price'}</label>
          <select class="apps-filter" id="cr-price" style="width:100%">
            <option value="free"${existing.price==='free'||!existing.price?' selected':''}>${t('apps.price.free')||'Free'}</option>
            <option value="freemium"${existing.price==='freemium'?' selected':''}>${t('apps.price.freemium')||'Freemium'}</option>
            <option value="paid"${existing.price==='paid'?' selected':''}>${t('apps.price.paid')||'Paid'}</option>
            <!-- The filter learnt this; the creator had not, so a catalogue made in-app could
                 not produce the value the browser can filter for. -->
            <option value="oss"${existing.price==='oss'?' selected':''}>${escHtml(t('apps.price.oss'))}</option>
          </select>
        </div>
      </div>
      ${field('version', t('apps.create.fVersion')||'Version', existing.version||'', '1.0.0')}
      <div class="apps-cr-sec">${escHtml(t('apps.create.secLook') || 'How it looks in the list')}</div>
      ${field('tags', t('apps.create.fTags')||'Tags (comma-separated, max 3)', (existing.tags||[]).join(', '), 'dcs, tool, audio')}
      ${field('requirements', t('apps.requirements')||'Requirements', existing.requirements||'', 'Windows 10+')}
      ${field('thumb', t('apps.create.fThumb')||'Thumbnail URL', existing.images?.thumb||'', 'https://.../thumb.png')}
      ${field('extra', t('apps.create.fExtra')||'Extra images (comma-separated URLs)', (existing.images?.extra||[]).join(', '))}
      ${field('md_link', t('apps.create.fMd')||'Documentation URL (md_link)', existing.md_link||'', 'https://github.com/.../README.md')}
      <div class="apps-cr-sec">${escHtml(t('apps.create.secGet') || 'Where it comes from')}</div>
      <!-- An address OR a file. Publishing a catalogue used to mean finding somewhere to
           host every installer in it first; a file handed over here is packed INTO the
           catalogue when it is published as one, and nothing needs hosting at all. -->
      <div class="apps-cr-src">
        <button type="button" class="btn btn-xs ${existing.src_file ? 'btn-accent' : 'btn-ghost'}" id="cr-pick-file">
          ${escHtml(existing.src_file ? (t('apps.create.fileChosen') || 'File chosen — change…') : (t('apps.create.useFile') || 'Use a file instead…'))}
        </button>
        <span class="apps-cr-src-say" id="cr-src-say">${escHtml(
            existing.src_file
                ? String(existing.src_file).replace(/^.*[/\\]/, '')
                : (t('apps.create.useFileHint') || 'Or give an address below. A file is packed into the catalogue when you publish it as one file.'))}</span>
        ${existing.src_file ? `<button type="button" class="btn btn-xs btn-ghost" id="cr-clear-file">${escHtml(t('common.remove') || 'Remove')}</button>` : ''}
      </div>
      ${field('dl-url', t('apps.create.fDlUrl')||'Download URL', (existing.download as any)?.url||'', 'https://github.com/.../app.exe')}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div>
          <label class="apps-install-label">${t('apps.create.fType')||'Type'}</label>
          <select class="apps-filter" id="cr-filetype" style="width:100%">
            ${['zip','exe','msi','script'].map(v => `<option value="${v}"${(existing.download as any)?.file_type===v?' selected':''}>${v}</option>`).join('')}
          </select>
        </div>
        <div>${field('size', t('apps.create.fSize')||'Size (bytes)', String((existing.download as any)?.size||''), '10485760')}</div>
      </div>
      ${field('sha256', t('apps.create.fSha')||'SHA-256 checksum (recommended — verified before install)', (existing.download as any)?.sha256||'', 'e3b0c44298fc1c149afbf4c8996fb924…')}
      <!-- The two fields nobody can fill by hand. They were asked for as free text, so the
           honest outcomes were "left empty" (no integrity check at all) and "typed wrong"
           (every install refused). Both are computed from the same bytes the installer will
           hash, which is the only version of this number that means anything. -->
      <div class="apps-cr-probe">
        <button type="button" class="btn btn-xs btn-secondary" id="cr-probe-url">${escHtml(t('apps.create.probeUrl') || 'Fetch from the URL')}</button>
        <button type="button" class="btn btn-xs btn-ghost" id="cr-probe-file">${escHtml(t('apps.create.probeFile') || 'From a local file…')}</button>
        <span class="apps-cr-probe-say" id="cr-probe-say">${escHtml(t('apps.create.probeHint') || 'This hashes the file people will download — the installer or the zip at that URL, not the app once installed.')}</span>
      </div>
      <div class="apps-install-footer">
        <button class="btn btn-ghost" id="cr-app-cancel">${t('common.cancel')||'Cancel'}</button>
        <button class="btn btn-accent" id="cr-app-save">${t('common.confirm')||'Save'}</button>
      </div>
    </div>`;

    document.getElementById('cr-app-cancel')?.addEventListener('click', () => {
        document.getElementById('cr-app-modal')!.classList.remove('open');
    });

    {
        const say = document.getElementById('cr-probe-say');
        const sizeEl = document.getElementById('cr-size') as HTMLInputElement | null;
        const shaEl = document.getElementById('cr-sha256') as HTMLInputElement | null;
        const fill = (r: { size: number; sha256: string; insecure?: boolean }) => {
            if (sizeEl) sizeEl.value = String(r.size);
            if (shaEl) shaEl.value = r.sha256;
            if (!say) return;
            const read = `${t('apps.create.probeOk') || 'Read'} — ${(r.size / 1048576).toFixed(1)} MB`;
            // http is allowed and said out loud. The number is probably right; over http it
            // is the checksum of whatever arrived, and what arrives is not only up to the
            // publisher.
            say.textContent = r.insecure ? `${read} · ${t('apps.create.probeHttp') || 'over plain http — this is the checksum of whatever arrived'}` : read;
            say.classList.toggle('is-warn', !!r.insecure);
            say.classList.remove('is-bad');
        };
        // The command answers with a KEY on failure, sometimes with a detail after a `|`.
        // Printing it raw would put `apps.probe.errHttps` in front of somebody in both
        // languages, which is the same bug as an untranslated toast.
        const blame = (e: unknown) => {
            const raw = String(e);
            const [key, detail] = raw.split('|');
            const said = key.startsWith('apps.probe.') ? (t(key.trim()) || key.trim()) : raw;
            if (say) say.textContent = detail ? `${said} (${detail})` : said;
            say?.classList.add('is-bad');
        };
        const busy = (on: boolean) => {
            for (const id of ['cr-probe-url', 'cr-probe-file']) {
                const b = document.getElementById(id) as HTMLButtonElement | null;
                if (b) b.disabled = on;
            }
            if (on && say) { say.classList.remove('is-bad'); say.textContent = t('apps.create.probeBusy') || 'Reading…'; }
        };
        document.getElementById('cr-probe-url')?.addEventListener('click', async () => {
            const url = (document.getElementById('cr-dl-url') as HTMLInputElement)?.value.trim();
            if (!url) { if (say) say.textContent = t('apps.create.probeNoUrl') || 'Put the download URL in first.'; return; }
            busy(true);
            try { fill(await invoke('catalog_probe_url', { url }) as any); } catch (e) { blame(e); }
            busy(false);
        });
        document.getElementById('cr-pick-file')?.addEventListener('click', async () => {
            const picked = await pickFile().catch(() => null);
            if (!picked) return;
            _pickedFile = picked;
            const name = picked.replace(/^.*[/\\]/, '');
            const el = document.getElementById('cr-src-say');
            if (el) el.textContent = name;
            // The extension is the file type, and the file is right here — so the two
            // fields nobody can fill by hand get filled from the thing itself.
            const ext = (name.split('.').pop() || '').toLowerCase();
            const sel = document.getElementById('cr-filetype') as HTMLSelectElement | null;
            if (sel && ['zip', 'exe', 'msi'].includes(ext)) sel.value = ext;
            else if (sel && ['ps1', 'bat', 'cmd', 'py', 'sh', 'vbs'].includes(ext)) sel.value = 'script';
            busy(true);
            try { fill(await invoke('catalog_probe_file', { path: picked }) as any); } catch (e) { blame(e); }
            busy(false);
        });
        document.getElementById('cr-clear-file')?.addEventListener('click', () => {
            _pickedFile = '';
            const el = document.getElementById('cr-src-say');
            if (el) el.textContent = t('apps.create.useFileHint') || '';
        });
        document.getElementById('cr-probe-file')?.addEventListener('click', async () => {
            const picked = await pickFile().catch(() => null);
            if (!picked) return;
            busy(true);
            try { fill(await invoke('catalog_probe_file', { path: picked }) as any); } catch (e) { blame(e); }
            busy(false);
        });
    }

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
                sha256:    get('sha256') || undefined,
            } as any,
            // Where the bytes are on THIS machine, until the catalogue is published. Never
            // part of the published document — stripped in draftToCatalog below, because a
            // path off somebody's disk is not something a catalogue should carry.
            ...(_pickedFile ? { src_file: _pickedFile } : {}),
        };

        if (index !== null) _draft.apps[index] = app;
        else _draft.apps.push(app);
        saveDraft();

        document.getElementById('cr-app-modal')!.classList.remove('open');
        renderCreate();
    });

    document.getElementById('cr-app-modal')!.classList.add('open');
}

/**
 * The entries inside a `.bmmbundle`, with their payloads pointed at the extracted copy.
 *
 * An entry inside a bundle may name a file that travelled with it OR still point at a URL,
 * and both are legal in the same document — one catalogue can carry the three small tools
 * and link the 90 MB one somebody already hosts. `_local` records which, so the installer
 * reaches for the disk or the network deliberately rather than sniffing the string later.
 *
 * `bundleEntryKind` is the shared rule that decides: it refuses absolute paths, drive
 * letters, UNC, `..` segments, control characters and every scheme that is not http(s).
 * Reusing it is the point — a second reading of "is this a safe relative name" is a second
 * place for `..` to be got wrong.
 */
async function appsFromBundle(src: string): Promise<AppEntry[]> {
    const res: any = await invoke('catalog_bundle_open', { path: src.slice('bundle:'.length) });
    const dir = String(res?.dir || '');
    const cat = JSON.parse(String(res?.catalog || '{}'));
    const apps: any[] = Array.isArray(cat?.apps) ? cat.apps : [];
    return apps.map((a) => {
        const url = a?.download?.url ?? a?.download_url ?? '';
        const inside = dir && bundleEntryKind(url) === 'inside';
        const resolved = inside ? resolveBundleEntry(url, dir) : '';
        return {
            ...a,
            official: false,          // a bundle somebody sent you is never official
            partner: false,
            source_label: src,
            download: {
                ...(a.download || {}),
                url: resolved || (a.download?.url ?? a.download_url ?? ''),
            },
            ...(resolved ? { _local: true } : {}),
        };
    });
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
        // The two ids. In the detail modal rather than on the card: a browse grid is for
        // choosing, and "which exact entry is this" is a question you ask once you have.
        `<div class="adm-info-row">
            <div class="adm-info-icon">${IC.link}</div>
            <div class="adm-info-label">${escHtml(t('copyid.label') || 'Ids')}</div>
            <div class="adm-info-value">${copyIdButtons('app', app.id, { compact: true, doc: { download: app.download } })}</div>
          </div>`,
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
            <div class="adm-info-value">${formatBytes(app.download.size)}${app.download.file_type ? ` · <span style="opacity:.6">${escHtml(app.download.file_type.toUpperCase())}</span>` : ''}</div>
          </div>` : '',
        // Whether this download can be checked at all, at the moment the Install button is
        // the next thing under the pointer. It was said in a confirm AFTER choosing, which
        // is the wrong end of the decision — and the modal already lists the size and the
        // type from the same object.
        `<div class="adm-info-row">
            <div class="adm-info-icon">${IC.lock}</div>
            <div class="adm-info-label">${escHtml(t('apps.integrity') || 'Integrity')}</div>
            <div class="adm-info-value">${(app.download.sha256 || '').trim()
                ? `<span class="apps-fact-chip apps-fact-sha">${escHtml(t('apps.shaYes') || 'checksum')}</span> <span style="opacity:.6">${escHtml(t('apps.shaYesShort') || 'verified before anything runs')}</span>`
                : `<span class="apps-fact-chip apps-fact-nosha">${escHtml(t('apps.shaNo') || 'unverified')}</span> <span style="opacity:.6">${escHtml(t('apps.shaNoShort') || 'the publisher did not provide one')}</span>`}</div>
          </div>`,
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
             data-onerror="hide-parent" data-onerror-target=".adm-gallery">
        ${allImages.length > 1 ? `
        <div class="adm-thumbs">
          ${allImages.map((img, i) => `
          <img class="adm-thumb${i===0?' active':''}" src="${escAttr(img)}" data-src="${escAttr(img)}"
               data-onerror="hide">`).join('')}
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
              ${!app.official && !app.partner ? `<span class="apps-community-badge">${escHtml(t('apps.badge.community') || 'Community')}</span>` : ''}
              ${claimChip(app)}
              ${app.version ? `<span class="apps-version">v${escHtml(app.version)}</span>` : ''}
            </div>
          </div>
          <div class="adm-header-actions">
            <button class="adm-fav-btn${fav?' adm-fav-active':''}" id="adm-fav-btn" data-tooltip="${fav?(t('apps.unfavorite')||'Unfavorite'):(t('apps.favorite')||'Favorite')}">
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
    wireCopyIds(body, toast);
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
                    // A README is mostly install commands; highlighting them is the point.
                    try { const { highlightIn } = await import('../../ui/code-highlight.js'); highlightIn(content); } catch { /* plain text is fine */ }
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
            // CWE-494: if the source is plain HTTP, warn the user first and only
            // proceed (allowInsecure) if they explicitly accept the risk.
            let allowInsecure = false;
            if (/^http:\/\//i.test(app.download.url.trim())) {
                const ok = await window.confirmCustom!(
                    t('apps.install.httpWarnTitle') || 'Insecure source (HTTP)',
                    t('apps.install.httpWarn') ||
                     'This app downloads over an insecure HTTP connection (not HTTPS). The file could be tampered with in transit. Install anyway?',
                    'warning',
                    { yesLabel: t('apps.install.httpWarnYes') || 'Install anyway', noLabel: t('common.cancel') || 'Cancel' }
                );
                if (!ok) {
                    progress.style.display = 'none';
                    confirmBtn.disabled = false;
                    cancelBtn.disabled = false;
                    return;
                }
                allowInsecure = true;
            }

            const doInstall = (allowBadChecksum: boolean): Promise<InstallResult> => invoke('install_app', {
                appId:       app.id,
                appTitle:    app.title,
                downloadUrl: app.download.url,
                fileType:    app.download.file_type,
                installPath,
                version:     app.version || null,
                category:    app.category,
                thumb:       app.images?.thumb || null,
                sha256:      app.download.sha256 || null,
                allowInsecure,
                allowBadChecksum,
                // Set only for an entry that came out of a bundle. The backend then reads
                // the file instead of the network and runs the SAME checksum gate on it —
                // a bundle somebody sent you is not more trustworthy than a download, it is
                // just closer.
                localPath:   (app as any)._local ? app.download.url : null,
            });

            let result: InstallResult;
            try {
                result = await doInstall(false);
            } catch (err) {
                // CWE-494: a checksum mismatch OR a missing checksum is a strong
                // reminder, not a hard ban. Warn the user and let them install
                // anyway if they accept.
                const msg = String(err);
                const mm = msg.match(/SHA_MISMATCH:([^:\s]*):([^:\s]*)/);
                const nc = msg.match(/NO_CHECKSUM:([^:\s]*)/);
                if (!mm && !nc) throw err;

                let body: string;
                if (mm) {
                    body = (t('apps.install.shaWarn') ||
                        'The downloaded file does not match the expected checksum. It may have been modified or corrupted. Install anyway?') +
                        hashBlock(t('apps.install.shaExpected') || 'Expected', mm[1]) +
                        hashBlock(t('apps.install.shaActual') || 'Downloaded', mm[2]);
                } else {
                    body = (t('apps.install.noShaWarn') ||
                        'This app has no published checksum, so its integrity cannot be verified. Install anyway?') +
                        hashBlock(t('apps.install.shaActual') || 'Downloaded', nc![1]);
                }

                const ok = await window.confirmCustom!(
                    mm ? (t('apps.install.shaWarnTitle') || 'Checksum mismatch')
                       : (t('apps.install.noShaWarnTitle') || 'Unverified download'),
                    body,
                    'warning',
                    { yesLabel: t('apps.install.shaWarnYes') || 'Install anyway', noLabel: t('common.cancel') || 'Cancel' }
                );
                if (!ok) {
                    progress.style.display = 'none';
                    confirmBtn.disabled = false;
                    cancelBtn.disabled = false;
                    return;
                }
                result = await doInstall(true);
            }

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
                // Zip with several executables — let the user pick the launcher,
                // with BMM's auto-detected (root-priority) choice pre-selected.
                toast(`${app.title} ${t('apps.installed')||'installed!'}`, 'success');
                closeInstallModal();
                showLauncherPicker(app.id, result.executables, () => renderCurrentTab());

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

/** Lightweight modal to manually pick which executable/script launches a zip app.
 *  The first entry is BMM's auto-detected (root-priority) choice. */
function showLauncherPicker(appId: string, exes: { name: string; path: string; size: number }[], onDone: () => void): void {
    document.getElementById('__app-launcher-picker')?.remove();
    const fmtSize = (b: number) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b/1024).toFixed(0)} KB` : `${(b/1048576).toFixed(1)} MB`;
    const auto = exes[0]; // detect_executables_in returns root-first → [0] is auto choice

    const ov = document.createElement('div');
    ov.id = '__app-launcher-picker';
    ov.className = 'modal-overlay open';
    ov.style.zIndex = '10000';
    ov.innerHTML = `
      <div class="modal glass" style="max-width:560px;width:94%;">
        <div class="modal-header">
          <h2 style="margin:0;font-size:16px;">${escHtml(t('apps.pickLauncher')||'Choose launcher')}</h2>
          <button class="modal-close" id="alp-close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div class="modal-body" style="padding:16px 18px;">
          <p style="font-size:12px;color:var(--text-muted);margin:0 0 14px;">${escHtml(t('apps.pickLauncherDesc')||'This app contains several executables. Pick the one to launch, or keep BMM auto choice.')}</p>
          <div style="display:flex;flex-direction:column;gap:6px;max-height:340px;overflow-y:auto;">
            ${exes.map((e, i) => {
              const depth = (e.path.match(/[\\/]/g) || []).length;
              const rel = e.path.split(/[\\/]/).slice(-2).join('/');
              return `<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid rgba(255,255,255,0.08);border-radius:9px;cursor:pointer;background:${i===0?'rgba(6,182,212,0.08)':'rgba(255,255,255,0.02)'};">
                <input type="radio" name="alp-exe" value="${escAttr(e.path)}" ${i===0?'checked':''} style="accent-color:var(--cyan);">
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${escHtml(e.name)} ${i===0?`<span style="font-size:9px;color:var(--cyan);font-weight:800;">★ ${escHtml(t('apps.autoDetected')||'AUTO')}</span>`:''}</div>
                  <div style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);">${escHtml(rel)} · ${fmtSize(e.size)} · depth ${depth}</div>
                </div>
              </label>`;
            }).join('')}
          </div>
        </div>
        <div class="modal-footer" style="padding:12px 18px;display:flex;justify-content:flex-end;gap:10px;border-top:1px solid rgba(255,255,255,0.08);">
          <button class="btn btn-ghost btn-sm" id="alp-browse">${escHtml(t('plugins.qtBrowse')||'Browse…')}</button>
          <button class="btn btn-ghost btn-sm" id="alp-auto">${escHtml(t('apps.autoDetected')||'Keep auto')}</button>
          <button class="btn btn-accent btn-sm" id="alp-use">${escHtml(t('apps.useThis')||'Use this')}</button>
        </div>
      </div>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(ov);

    const close = () => { ov.remove(); onDone(); };
    const apply = async (path: string) => {
        try { await invoke('set_app_main_exe', { appId, exePath: path }); toast(t('apps.launcherSet')||'Launcher updated', 'success'); }
        catch (e) { toast(String(e), 'error'); }
        close();
    };
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    ov.querySelector('#alp-close')?.addEventListener('click', close);
    ov.querySelector('#alp-auto')?.addEventListener('click', () => apply(auto.path));
    ov.querySelector('#alp-use')?.addEventListener('click', () => {
        const sel = ov.querySelector('input[name="alp-exe"]:checked') as HTMLInputElement;
        apply(sel?.value || auto.path);
    });
    // Browse for a launcher manually
    ov.querySelector('#alp-browse')?.addEventListener('click', async () => {
        const picked = await pickFile([{ name: 'Executable / Script', extensions: ['exe', 'bat', 'cmd', 'vbs', 'ps1', 'msi'] }]).catch(() => null);
        if (picked) apply(picked);
    });
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
    // Shows the two largest units, dropping the second when it's zero:
    // 30s · 1min30 · 5min · 1h30 · 5h 
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return s > 0 ? `${m}min${String(s).padStart(2, '0')}` : `${m}min`;
    }
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
}
