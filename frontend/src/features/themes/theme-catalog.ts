// @ts-nocheck
// ── BMM Theme Catalogue ───────────────────────────────────────────────────────
// Fetches official / partner / community theme lists (same pattern as app-catalog)
// and displays a gallery with preview, install & apply buttons.

import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
import { escHtml, escAttr } from '../../core/utils.js';
import { installTheme, activateTheme, getInstalledThemes, BmmTheme } from './theme-engine.js';

const OFFICIAL_CATALOG = 'https://raw.githubusercontent.com/BetterDCS/BMM_Themes/main/catalog.json';
const COMMUNITY_SRC_KEY = 'bmm_theme_community_sources';

let _modal: HTMLElement | null = null;
let _catalog: BmmTheme[] = [];
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
                        <h2 style="margin:0;font-size:16px;" data-i18n="themes.catalogue">Theme Catalogue</h2>
                        <p style="margin:0;font-size:11px;color:var(--bmm-text-muted);" data-i18n="themes.catalogueSub">Official, partner & community themes</p>
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
                <button class="btn btn-ghost btn-sm" id="theme-cat-add-community">${t('themes.addCommunity') || '+ Community source'}</button>
                <button class="btn btn-ghost btn-sm" id="theme-cat-refresh">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="margin-right:5px;"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                    ${t('common.refresh') || 'Refresh'}
                </button>
            </div>
            <div id="theme-cat-list" style="flex:1;overflow-y:auto;padding:16px 18px;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;"></div>
            <div class="modal-footer" style="padding:12px 18px;border-top:1px solid rgba(255,255,255,0.06);font-size:11px;color:var(--bmm-text-muted);">
                <span id="theme-cat-count"></span>
                <button class="btn btn-ghost btn-sm" id="theme-cat-import-file">${t('themes.importFile') || 'Import .bmmtheme file'}</button>
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
    _modal.querySelector('#theme-cat-add-community')!.addEventListener('click', addCommunitySource);
    _modal.querySelector('#theme-cat-import-file')!.addEventListener('click', importFromFile);
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchCatalog(force = false): Promise<void> {
    const listEl = document.getElementById('theme-cat-list');
    if (listEl) listEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--bmm-text-muted);font-size:13px;">${t('common.loading') || 'Loading…'}</div>`;

    try {
        const urls = [OFFICIAL_CATALOG, ..._communitySources];
        const results = await Promise.allSettled(urls.map(u =>
            fetch(`${u}?t=${force ? Date.now() : ''}`, { cache: force ? 'no-store' : 'default' })
                .then(r => r.ok ? r.json() : [])
                .catch(() => [])
        ));
        const all: BmmTheme[] = [];
        for (const r of results) {
            if (r.status === 'fulfilled') {
                const list = Array.isArray(r.value) ? r.value : r.value?.themes || [];
                all.push(...list);
            }
        }
        // Also try backend command (which may include locally-registered sources)
        try {
            const fromBackend: string = await invoke('fetch_theme_catalogs', {
                officialUrl: OFFICIAL_CATALOG,
                communityUrls: _communitySources,
            });
            all.push(...(JSON.parse(fromBackend || '[]')));
        } catch {}
        // Deduplicate by id
        const seen = new Set<string>();
        _catalog = all.filter(th => { if (seen.has(th.id)) return false; seen.add(th.id); return true; });
    } catch {
        _catalog = [];
    }
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

    if (!filtered.length) {
        listEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--bmm-text-muted);">${t('themes.noCatalog') || 'No themes found.'}</div>`;
        if (countEl) countEl.textContent = '';
        return;
    }

    if (countEl) countEl.textContent = `${filtered.length} ${t('themes.themes') || 'theme(s)'}`;
    listEl.innerHTML = filtered.map(th => {
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

    // Wire actions
    listEl.querySelectorAll('.btc-install').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = (btn as HTMLElement).dataset.id!;
            const theme = _catalog.find(th => th.id === id);
            if (!theme) return;
            (btn as HTMLButtonElement).textContent = t('common.loading') || 'Installing…';
            (btn as HTMLButtonElement).disabled = true;
            await installTheme(theme);
            toast(`${t('themes.installed') || 'Installed'}: ${theme.name}`, 'success');
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
function addCommunitySource(): void {
    const url = prompt(t('themes.communityUrlPrompt') || 'Enter the URL of the community themes catalog.json:');
    if (!url?.trim()) return;
    _communitySources.push(url.trim());
    localStorage.setItem(COMMUNITY_SRC_KEY, JSON.stringify(_communitySources));
    fetchCatalog(true).then(renderCatalog);
}

async function importFromFile(): Promise<void> {
    const { pickFile } = await import('../../core/api.js');
    const path = await pickFile([{ name: 'BMM Theme', extensions: ['bmmtheme', 'json'] }]);
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
