// @ts-nocheck
/**
 * modpack-creator.ts — the Modpacks page.
 *
 * Oct 2026 redesign. The page is one list and a handful of dialogs, all on the house shell
 * (ui/modal-shell.ts + css/modal-shell.css):
 *
 *   · the overview: one bar (search, filter, sort, grid/list), then a card per pack with its
 *     cover, name, game or profile, mod count, size, state, ONE primary action (activate /
 *     deactivate) and a « … » menu for the rest (edit, export & share, delete);
 *   · the pack dialog (#mp-wizard): a short guided flow to create a pack — the basics (name,
 *     whose mods, game), the mods (search, multi-select, everything from the profile or what
 *     is on now in one click), the options (with defaults that suit most packs), a review with
 *     the order and the per-mod sources. It can finish from any step once it has a name and a
 *     mod. Editing a pack opens the same dialog with every step reachable;
 *   · import (file, link, catalogue), export & share, delete, repair: one anatomy each.
 *
 * The contracts did not move: load_modpacks / save_modpack / delete_modpack / export_modpack /
 * import_modpack / install_modpack_from_url / build_modpack_mod_ref / check_modpack_integrity /
 * repair_modpack_mod, the LocalModpack format, the `bmm:modpack-focus` event (plugins and the
 * API open the dialog through it) and the activation dialog (modpack-activate.ts).
 */
import { invoke } from '../../core/api.js';
import { copyIdButtons, wireCopyIds } from '../../core/copy-id.js';
import { fireEvent } from '../../core/bmm-events.js';
import { toast, toastSaved } from '../../ui/app.js';
import { t } from '../../core/i18n.js';
import { dispatchBmmAction, BMM_ACTIONS } from '../../ui/tutorial-events.js';
import { formatBytes, escHtml, escAttr } from '../../core/utils.js';
import { openModal } from '../../ui/modal-shell.js';
import { uiIcon, uiIconEl } from '../../ui/icons.js';
import { openModpackActivation, openModpackPicker, deactivateModpack, modpackState } from './modpack-activate.js';

// ── State ────────────────────────────────────────────────────────────────────

let _modpacks = [];
let _allMods = [];
let _profiles = [];
let _activeProfileId = null;
let _container = null;
/** The open pack dialog, if any: { refresh(), close() }. */
let _wiz = null;

/** How the overview is shown. Sort and view are remembered per viewer (localStorage, a
 *  convenience: the page works the same without it). */
const PREF_KEY = 'bmm.modpacks.overview';
const _ui = { q: '', filter: 'all', sort: 'recent', view: 'grid' };
(function loadPrefs() {
    try {
        const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
        if (['recent', 'name', 'mods', 'size'].includes(p.sort)) _ui.sort = p.sort;
        if (p.view === 'grid' || p.view === 'list') _ui.view = p.view;
    } catch { /* no storage: defaults */ }
})();
function _savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ sort: _ui.sort, view: _ui.view })); } catch { /* no storage */ }
}

/**
 * Resolves modpack mref SHA-256 hashes to local mod IDs in a single
 * backend round-trip.  Used by apply/deactivate flows below so we don't
 * have to ship every mod's full file_hashes map to the JS heap.
 */
async function _resolveHashesToModIds(mrefs: Array<{ sha256?: string }>): Promise<Record<string, string>> {
    const shas = Array.from(new Set(
        mrefs.map(m => m.sha256).filter((s): s is string => !!s)
    ));
    if (shas.length === 0) return {};
    try {
        const map = await invoke('find_local_mods_by_hashes', { hashes: shas }) as Record<string, string | null>;
        const out: Record<string, string> = {};
        for (const [sha, mid] of Object.entries(map)) {
            if (mid) out[sha] = mid;
        }
        return out;
    } catch { return {}; }
}

function _findLocalByMref(mref: any, shaIndex: Record<string, string>) {
    if (!mref) return null;
    if (mref.mod_id) {
        const byId = _allMods.find((m: any) => m.id === mref.mod_id);
        if (byId) return byId;
    }
    if (mref.sha256 && shaIndex[mref.sha256]) {
        return _allMods.find((m: any) => m.id === shaIndex[mref.sha256]) || null;
    }
    return null;
}

async function _loadData() {
    try {
        [_modpacks, _allMods, _profiles, _activeProfileId] = await Promise.all([
            invoke('load_modpacks'),
            invoke('get_all_mods'),
            invoke('get_profiles'),
            invoke('get_active_profile_id'),
        ]);
        _modpacks = _modpacks || [];
        _allMods = _allMods || [];
        _profiles = _profiles || [];
    } catch (e) {
        console.error('[ModpackCreator] load error', e);
    }
}

function _rerender() {
    if (_container && _container.isConnected) _renderModpackList(_container);
}

// ── Public init ──────────────────────────────────────────────────────────────

export async function initModpackCreator(container) {
    if (!container) return;
    _container = container;

    const btnCat = document.getElementById('btn-modpack-catalog');
    if (btnCat && !btnCat.dataset.bound) {
        btnCat.dataset.bound = 'true';
        btnCat.addEventListener('click', async () => {
            const m = await import('./modpack-catalog.js');
            await m.openModpackCatalog(toast);
        });
    }
    const btnImport = document.getElementById('btn-import-modpack');
    if (btnImport && !btnImport.dataset.bound) {
        btnImport.dataset.bound = 'true';
        btnImport.addEventListener('click', () => _openImportModal());
    }

    document.addEventListener('langChanged', () => _rerender());

    await _loadData();
    _renderModpackList(container);

    // Live refresh: update mod/profile lists without requiring a BMM restart
    window.addEventListener('bmm:mods-updated', async () => {
        try {
            [_allMods, _profiles, _activeProfileId] = await Promise.all([
                invoke('get_all_mods'),
                invoke('get_profiles'),
                invoke('get_active_profile_id'),
            ]);
            _wiz?.refresh();
            _rerender();
        } catch (e) { console.error('[ModpackCreator] live-refresh error', e); }
    });

    // Refresh modpack list when API creates/modifies/deletes a modpack
    window.addEventListener('bmm://modpacks-updated', async () => {
        try {
            await _loadData();
            _rerender();
        } catch (e) { console.error('[ModpackCreator] modpacks-updated error', e); }
    });

    // Open the pack dialog via event (from QT / plugins / external trigger)
    // detail: { action: 'create'|'update', modpackId?: string, prefill?: {...} }
    // With a name (create) or always (update) it saves by itself, no human interaction.
    window.addEventListener('bmm:modpack-focus', async (e: any) => {
        const { action, modpackId, prefill } = e.detail || {};
        try { await _loadData(); } catch (_) {}

        if (action === 'create') {
            const freshPack = {
                id: '', name: '', description: null, created_at: '', updated_at: '',
                multi_profile: true, dependency_mode: 'manual', mods: [], sr_link: null, game_name: null,
                skip_integrity_check: false,
            };
            if (prefill) {
                if (prefill.name)                  freshPack.name                  = prefill.name;
                if (prefill.description != null)   freshPack.description           = prefill.description;
                if (prefill.game_name != null)     freshPack.game_name             = prefill.game_name;
                if (prefill.sr_link != null)       freshPack.sr_link               = prefill.sr_link;
                if (prefill.multi_profile != null) freshPack.multi_profile         = prefill.multi_profile;
                if (prefill.skip_integrity_check != null) freshPack.skip_integrity_check = prefill.skip_integrity_check;
                if (prefill.dependency_mode)       freshPack.dependency_mode       = prefill.dependency_mode;
                // Pre-seed mods from mod_ids (stubs — just ids, no metadata yet)
                if (prefill.mod_ids?.length) {
                    freshPack.mods = prefill.mod_ids.map((id: string) => {
                        const found = _allMods.find(m => m.id === id);
                        return { mod_id: id, mod_name: found?.name || id, mod_version: found?.version || '', sha256: '', file_manifest: [] };
                    });
                }
            }
            await _openWizard(freshPack, { isNew: true, autoSave: !!prefill?.name });
        } else if (action === 'update' && modpackId) {
            const existing = _modpacks.find(m => m.id === modpackId);
            if (!existing) {
                console.warn('[ModpackCreator] bmm:modpack-focus update — pack not found:', modpackId);
                return;
            }
            // Merge prefill overrides onto the existing pack before opening
            const merged = JSON.parse(JSON.stringify(existing));
            if (prefill) {
                if (prefill.name != null)                  merged.name                  = prefill.name;
                if (prefill.description != null)           merged.description           = prefill.description;
                if (prefill.game_name != null)             merged.game_name             = prefill.game_name;
                if (prefill.sr_link != null)               merged.sr_link               = prefill.sr_link;
                if (prefill.multi_profile != null)         merged.multi_profile         = prefill.multi_profile;
                if (prefill.skip_integrity_check != null)  merged.skip_integrity_check  = prefill.skip_integrity_check;
                if (prefill.dependency_mode)               merged.dependency_mode       = prefill.dependency_mode;
                if (prefill.mod_ids?.length) {
                    // Replace mods list with the provided ids, preserving existing metadata where possible
                    merged.mods = prefill.mod_ids.map((id: string) => {
                        const existing_ref = merged.mods.find((mr: any) => mr.mod_id === id);
                        if (existing_ref) return existing_ref;
                        const found = _allMods.find(m => m.id === id);
                        return { mod_id: id, mod_name: found?.name || id, mod_version: found?.version || '', sha256: '', file_manifest: [] };
                    });
                }
            }
            await _openWizard(merged, { autoSave: true });
        }
    });
}

// ── Facts about a pack ───────────────────────────────────────────────────────

function _packSize(pack): number {
    let n = 0;
    for (const r of pack?.mods || []) for (const f of r?.file_manifest || []) n += Number(f?.size) || 0;
    return n;
}
function _packWhere(pack): string {
    return pack.multi_profile ? t('modpack.multiProfile') : (pack.game_name || t('modpack.general'));
}
/** Two letters for the cover: the first letters of the first two words, else the first two. */
function _monogram(name): string {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    const first = (w) => Array.from(w)[0] || '';
    const s = words.length > 1 ? first(words[0]) + first(words[1]) : Array.from(words[0]).slice(0, 2).join('');
    return s.toUpperCase();
}
function _stateChip(st): string {
    if (st === 'on') return `<span class="bms-chip bms-chip--ok"><span class="bms-dot"></span>${escHtml(t('modpack.act.stateOn'))}</span>`;
    if (st === 'partial') return `<span class="bms-chip bms-chip--warn"><span class="bms-dot"></span>${escHtml(t('modpack.act.statePartial'))}</span>`;
    return `<span class="bms-chip"><span class="bms-dot"></span>${escHtml(t('modpack.act.stateOff'))}</span>`;
}
/** The pack as a line: cover, name, meta. Used by the share and delete dialogs. */
function _packLine(pack): string {
    const n = pack.mods?.length || 0;
    const size = _packSize(pack);
    return `<div class="mp-line">
        <span class="mp-cover mp-cover--sm" aria-hidden="true">${escHtml(_monogram(pack.name))}</span>
        <span class="mp-line-txt"><b>${escHtml(pack.name)}</b><span>${escHtml(_packWhere(pack))} · ${escHtml(t('modpack.modsCount', { count: String(n) }))}${size ? ` · ${escHtml(formatBytes(size))}` : ''}</span></span>
    </div>`;
}

// ── The overview ─────────────────────────────────────────────────────────────

/** The header's primary action, beside Catalogues and Import; the tutorial points at its id. */
function _ensureCreateButton(): void {
    const actions = document.getElementById('modpack-header-actions');
    if (!actions) return;
    let btn = document.getElementById('modpack-create-btn') as HTMLButtonElement | null;
    if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'modpack-create-btn';
        btn.className = 'btn btn-primary mp-create';
        actions.appendChild(btn);
    }
    btn.innerHTML = `${uiIcon('add', 16)}<span>${escHtml(t('modpack.create'))}</span>`;
    btn.onclick = () => { void _openWizard(null); };
    btn.hidden = false;
}

function _renderModpackList(container) {
    _container = container;
    _closeMenu();
    container.innerHTML = '';
    container.classList.add('mp-page');
    _ensureCreateButton();

    if (_modpacks.length === 0) {
        // One line that says what a pack is, and the two ways to get one.
        const empty = document.createElement('div');
        empty.className = 'bms-empty mp-empty';
        empty.innerHTML = `
            <div class="bms-empty-ic">${uiIcon('package', 24)}</div>
            <div class="bms-empty-t">${escHtml(t('modpack.noMods'))}</div>
            <p class="bms-note">${escHtml(t('modpack.noModsDesc'))}</p>
            <div class="mp-empty-a">
                <button type="button" class="btn btn-primary" data-mp-go="create">${uiIcon('add', 16)}<span>${escHtml(t('modpack.create'))}</span></button>
                <button type="button" class="btn btn-secondary" data-mp-go="import">${uiIcon('import', 16)}<span>${escHtml(t('modpack.ui.importBtn'))}</span></button>
            </div>`;
        empty.addEventListener('click', (e) => {
            const go = (e.target as HTMLElement).closest<HTMLElement>('[data-mp-go]')?.dataset.mpGo;
            if (go === 'create') void _openWizard(null);
            else if (go === 'import') _openImportModal();
        });
        container.appendChild(empty);
        return;
    }

    // One bar: search, filter, sort, how many, grid or list.
    const games = Array.from(new Set(_modpacks.filter(p => !p.multi_profile && p.game_name).map(p => String(p.game_name)))).sort((a, b) => a.localeCompare(b));
    const anyMulti = _modpacks.some(p => p.multi_profile);
    if (_ui.filter.startsWith('g:') && !games.includes(_ui.filter.slice(2))) _ui.filter = 'all';
    if (_ui.filter === 'multi' && !anyMulti) _ui.filter = 'all';
    const opt = (v, label) => `<option value="${escAttr(v)}"${_ui.filter === v ? ' selected' : ''}>${escHtml(label)}</option>`;
    const sortOpt = (v, label) => `<option value="${v}"${_ui.sort === v ? ' selected' : ''}>${escHtml(label)}</option>`;
    const bar = document.createElement('div');
    bar.className = 'mp-toolbar';
    bar.innerHTML = `
        <label class="mp-search" id="mp-search-wrap">
            ${uiIcon('search', 14)}
            <input type="search" id="modpack-search" placeholder="${escAttr(t('modpack.searchPh'))}" aria-label="${escAttr(t('modpack.searchPh'))}" spellcheck="false" autocomplete="off" value="${escAttr(_ui.q)}">
        </label>
        <select id="mp-filter" class="form-input mp-select" aria-label="${escAttr(t('modpack.ui.filterLabel'))}" title="${escAttr(t('modpack.ui.filterLabel'))}">
            ${opt('all', t('modpack.filterAll'))}
            ${opt('on', t('modpack.ui.filterOn'))}
            ${opt('off', t('modpack.ui.filterOff'))}
            ${games.length > 1 || (games.length && anyMulti) ? games.map(g => opt('g:' + g, g)).join('') : ''}
            ${anyMulti && (games.length || _modpacks.length > 1) ? opt('multi', t('modpack.multiProfile')) : ''}
        </select>
        <select id="mp-sort" class="form-input mp-select" aria-label="${escAttr(t('modpack.ui.sortLabel'))}" title="${escAttr(t('modpack.ui.sortLabel'))}">
            ${sortOpt('recent', t('modpack.ui.sortRecent'))}
            ${sortOpt('name', t('modpack.ui.sortName'))}
            ${sortOpt('mods', t('modpack.ui.sortMods'))}
            ${sortOpt('size', t('modpack.ui.sortSize'))}
        </select>
        <span class="bms-spacer"></span>
        <span class="mp-count" id="modpack-count-badge" aria-live="polite"></span>
        <div class="bms-seg mp-view" role="group" aria-label="${escAttr(t('modpack.ui.viewLabel'))}">
            <button type="button" class="bms-seg-btn" data-view="grid" aria-pressed="${_ui.view === 'grid'}" title="${escAttr(t('modpack.ui.viewGrid'))}" aria-label="${escAttr(t('modpack.ui.viewGrid'))}">${uiIcon('grid', 14)}</button>
            <button type="button" class="bms-seg-btn" data-view="list" aria-pressed="${_ui.view === 'list'}" title="${escAttr(t('modpack.ui.viewList'))}" aria-label="${escAttr(t('modpack.ui.viewList'))}">${uiIcon('list', 14)}</button>
        </div>`;
    container.appendChild(bar);

    const grid = document.createElement('div');
    grid.className = `modpack-grid${_ui.view === 'list' ? ' is-list' : ''}`;
    grid.setAttribute('role', 'list');
    container.appendChild(grid);

    const noHit = document.createElement('div');
    noHit.className = 'bms-empty mp-nohit';
    noHit.hidden = true;
    container.appendChild(noHit);

    const search = bar.querySelector('#modpack-search') as HTMLInputElement;
    const count = bar.querySelector('#modpack-count-badge') as HTMLElement;

    const draw = () => {
        _closeMenu();
        const q = _ui.q.toLowerCase().trim();
        const states = new Map(_modpacks.map(p => [p.id, modpackState(p, _allMods)]));
        let list = _modpacks.filter(p => {
            if (q && !`${p.name} ${p.game_name || ''} ${p.description || ''}`.toLowerCase().includes(q)) return false;
            const st = states.get(p.id);
            if (_ui.filter === 'on') return st !== 'off';
            if (_ui.filter === 'off') return st === 'off';
            if (_ui.filter === 'multi') return !!p.multi_profile;
            if (_ui.filter.startsWith('g:')) return !p.multi_profile && String(p.game_name || '') === _ui.filter.slice(2);
            return true;
        });
        const time = (p) => Date.parse(p.updated_at || p.created_at || '') || 0;
        list = list.slice().sort((a, b) => {
            if (_ui.sort === 'name') return String(a.name).localeCompare(String(b.name));
            if (_ui.sort === 'mods') return (b.mods?.length || 0) - (a.mods?.length || 0);
            if (_ui.sort === 'size') return _packSize(b) - _packSize(a);
            return time(b) - time(a);
        });
        grid.innerHTML = list.map(p => _cardHtml(p, states.get(p.id))).join('');
        const filtered = !!q || _ui.filter !== 'all';
        count.textContent = filtered
            ? t('modpack.countOf', { n: String(list.length), total: String(_modpacks.length) })
            : t('modpack.countAll', { n: String(_modpacks.length) });
        noHit.hidden = list.length > 0;
        if (!list.length) {
            noHit.innerHTML = `<div class="bms-empty-ic">${uiIcon('search', 20)}</div>
                <div class="bms-empty-t">${escHtml(q ? t('modpack.noMatch', { q: _ui.q.trim() }) : t('modpack.ui.noFilterHit'))}</div>
                <div class="mp-empty-a"><button type="button" class="btn btn-secondary btn-sm" data-mp-clear>${escHtml(t('modpack.ui.resetFilters'))}</button></div>`;
            noHit.querySelector('[data-mp-clear]')?.addEventListener('click', () => {
                _ui.q = ''; _ui.filter = 'all';
                _renderModpackList(container);
                (document.getElementById('modpack-search') as HTMLInputElement | null)?.focus();
            });
        }
    };

    search.addEventListener('input', () => { _ui.q = search.value; draw(); });
    bar.querySelector('#mp-filter')?.addEventListener('change', (e) => { _ui.filter = (e.target as HTMLSelectElement).value; draw(); });
    bar.querySelector('#mp-sort')?.addEventListener('change', (e) => { _ui.sort = (e.target as HTMLSelectElement).value; _savePrefs(); draw(); });
    bar.querySelectorAll<HTMLElement>('[data-view]').forEach(b => b.addEventListener('click', () => {
        _ui.view = b.dataset.view === 'list' ? 'list' : 'grid';
        _savePrefs();
        grid.classList.toggle('is-list', _ui.view === 'list');
        bar.querySelectorAll<HTMLElement>('[data-view]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.view === _ui.view)));
    }));

    // One listener for every card: the primary action, the menu, and "open" anywhere else.
    grid.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const card = target.closest<HTMLElement>('.modpack-card');
        const pack = card && _modpacks.find(p => p.id === card.dataset.id);
        if (!pack) return;
        const act = target.closest<HTMLElement>('[data-mp-act]')?.dataset.mpAct;
        if (act === 'apply') { e.stopPropagation(); void _applyModpack(container, pack); return; }
        if (act === 'more') { e.stopPropagation(); _openCardMenu(target.closest('[data-mp-act]') as HTMLElement, pack); return; }
        if (act === 'edit' || !target.closest('button, a, input, select, [data-copy-id]')) void _openWizard(pack);
    });

    draw();
}

function _cardHtml(pack, st): string {
    const on = st !== 'off';
    const n = pack.mods?.length || 0;
    const size = _packSize(pack);
    const date = pack.updated_at ? new Date(pack.updated_at).toLocaleDateString() : '';
    const desc = String(pack.description || '').trim();
    const applyLabel = on ? t('modpack.deactivate') : t('modpack.ui.activate');
    return `<article class="modpack-card${on ? ' is-on' : ''}" role="listitem" data-id="${escAttr(pack.id)}">
        <span class="mp-cover" aria-hidden="true">${escHtml(_monogram(pack.name))}</span>
        <div class="mp-card-main">
            <div class="mp-card-head">
                <button type="button" class="modpack-card-title" data-mp-act="edit" title="${escAttr(pack.name)}">${escHtml(pack.name)}</button>
            </div>
            <div class="mp-card-meta">
                <span>${uiIcon(pack.multi_profile ? 'users' : 'game', 12)}${escHtml(_packWhere(pack))}</span>
                <span>${escHtml(t('modpack.modsCount', { count: String(n) }))}</span>
                ${size ? `<span>${escHtml(formatBytes(size))}</span>` : ''}
                ${date ? `<span title="${escAttr(t('modpack.updatedAt', { date }))}">${uiIcon('clock', 12)}${escHtml(date)}</span>` : ''}
                ${pack.skip_integrity_check ? `<span class="mp-meta-warn" title="${escAttr(t('modpack.skipIntegrityDesc'))}">${uiIcon('warning', 12)}${escHtml(t('modpack.noCheckChip'))}</span>` : ''}
            </div>
            ${desc ? `<p class="modpack-card-desc">${escHtml(desc)}</p>` : ''}
        </div>
        <div class="modpack-card-foot">
            ${_stateChip(st)}
            <span class="bms-spacer"></span>
            <button type="button" class="btn btn-sm ${on ? 'btn-secondary' : 'btn-primary'} btn-apply mp-apply-btn" data-mp-act="apply" aria-label="${escAttr(`${applyLabel}: ${pack.name}`)}"${n ? '' : ' disabled'}>${uiIcon(on ? 'power' : 'run', 14)}<span>${escHtml(applyLabel)}</span></button>
            <button type="button" class="btn btn-icon btn-ghost btn-sm mp-more" data-mp-act="more" aria-haspopup="menu" aria-expanded="false" title="${escAttr(t('modpack.ui.more'))}" aria-label="${escAttr(`${t('modpack.ui.more')}: ${pack.name}`)}">${uiIcon('more', 16)}</button>
        </div>
    </article>`;
}

// ── The « … » menu of a card ─────────────────────────────────────────────────

let _menu: { el: HTMLElement; btn: HTMLElement; off: () => void } | null = null;

function _closeMenu(refocus = false): void {
    if (!_menu) return;
    const { el, btn, off } = _menu;
    _menu = null;
    off();
    el.remove();
    btn.setAttribute('aria-expanded', 'false');
    if (refocus && btn.isConnected) btn.focus();
}

function _openCardMenu(btn: HTMLElement, pack): void {
    const again = _menu && _menu.btn === btn;
    _closeMenu();
    if (again) return;
    const el = document.createElement('div');
    el.className = 'mp-menu';
    el.setAttribute('role', 'menu');
    el.innerHTML = `
        <button type="button" role="menuitem" class="mp-menu-item" data-mi="edit">${uiIcon('edit', 14)}<span>${escHtml(t('modpack.edit'))}</span></button>
        <button type="button" role="menuitem" class="mp-menu-item" data-mi="share">${uiIcon('share', 14)}<span>${escHtml(t('modpack.ui.share'))}</span></button>
        <div class="mp-menu-sep" role="separator"></div>
        <button type="button" role="menuitem" class="mp-menu-item mp-menu-item--danger" data-mi="delete">${uiIcon('delete', 14)}<span>${escHtml(t('modpack.delete'))}</span></button>`;
    (document.getElementById('app-window-outer') || document.body).appendChild(el);
    // The items act on a click on the menu itself (bound to it, not to the document).
    el.addEventListener('click', (e) => {
        const mi = (e.target as HTMLElement).closest<HTMLElement>('[data-mi]')?.dataset.mi;
        if (!mi) return;
        _closeMenu();
        if (mi === 'edit') void _openWizard(pack);
        else if (mi === 'share') _openShareModal(pack);
        else if (mi === 'delete') void _deleteModpack(_container, pack);
    });

    // Under the button, right-aligned; above it when there is no room below.
    const r = btn.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    const top = r.bottom + 6 + h > window.innerHeight - 8 ? Math.max(8, r.top - 6 - h) : r.bottom + 6;
    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)))}px`;
    btn.setAttribute('aria-expanded', 'true');

    const items = () => [...el.querySelectorAll<HTMLElement>('.mp-menu-item')];
    const onDown = (e: Event) => { if (!el.contains(e.target as Node) && !btn.contains(e.target as Node)) _closeMenu(); };
    const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); _closeMenu(true); return; }
        if (e.key === 'Tab') { _closeMenu(); return; }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
        e.preventDefault();
        const list = items();
        const i = list.indexOf(document.activeElement as HTMLElement);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1
            : (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
        list[next]?.focus();
    };
    const onScroll = () => _closeMenu();
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onScroll);
    document.addEventListener('scroll', onScroll, true);
    _menu = {
        el, btn, off: () => {
            document.removeEventListener('pointerdown', onDown, true);
            document.removeEventListener('keydown', onKey, true);
            window.removeEventListener('resize', onScroll);
            document.removeEventListener('scroll', onScroll, true);
        },
    };
    items()[0]?.focus();
}

// ── The pack dialog: create (guided) and edit ────────────────────────────────

const STEP_COUNT = 4;
function _stepLabels(): string[] {
    return [t('modpack.ui.stepBasics'), t('modpack.ui.stepMods'), t('modpack.ui.stepOptions'), t('modpack.ui.stepReview')];
}

/** The profile a mod lives in, by its folder (the same match the old picker made). */
function _profileOfMod(m) {
    return _profiles.find(p => m.mod_folder_path && p.mods_path
        && (String(m.mod_folder_path).includes(String(p.mods_path)) || String(p.mods_path).includes(String(m.mod_folder_path)))) || null;
}

/** The mods offered for a source: one profile's (by id or by folder), or every mod. */
function _modsOfSource(source) {
    let list = [..._allMods];
    if (source !== 'multi') {
        const p = _profiles.find(x => String(x.id) === String(source));
        if (p) {
            const root = String(p.mods_path || '').toLowerCase();
            list = list.filter(m => (m.profile_id && String(m.profile_id) === String(p.id))
                || (root && String(m.mod_folder_path || '').toLowerCase().startsWith(root)));
        }
    }
    // Tutorial demo mods float to the top so they're easy to find while following a tutorial.
    const demo = (m) => (String(m.id || '').startsWith('__bmm_tutorial_demo_mod_') ? 1 : 0);
    return list.sort((a, b) => demo(b) - demo(a));
}

function _defaultSource(pack) {
    if (pack?.multi_profile) return 'multi';
    const fromRef = (pack?.mods || []).map(r => r.profile_id).find(id => id && _profiles.some(p => String(p.id) === String(id)));
    if (fromRef) return String(fromRef);
    const active = _activeProfileId || (window as any).cachedActiveProfileId;
    if (active && _profiles.some(p => String(p.id) === String(active))) return String(active);
    return _profiles[0] ? String(_profiles[0].id) : 'multi';
}

/**
 * Open the pack dialog. `pack` null = a new pack from scratch. `opts.isNew` = a new pack
 * pre-seeded by a caller (bmm:modpack-focus). `opts.autoSave` = save at once, no human step.
 */
async function _openWizard(pack, opts: { isNew?: boolean; autoSave?: boolean } = {}) {
    _closeMenu();
    _wiz?.close();
    const editing = !!pack && !opts.isNew;
    const base = pack ? JSON.parse(JSON.stringify(pack)) : {
        id: '', name: '', description: null, created_at: '', updated_at: '',
        multi_profile: false, dependency_mode: 'manual', skip_integrity_check: false,
        mods: [], sr_link: null, game_name: null,
    };

    // The pack's mods, keyed by the LOCAL mod they are (a pack made on another PC names its
    // mods by that PC's ids; the hash finds them here), in the pack's order.
    const refs = new Map();
    const selected: string[] = [];
    const sha = base.mods?.length ? await _resolveHashesToModIds(base.mods) : {};
    for (const r of base.mods || []) {
        const local = _findLocalByMref(r, sha);
        const key = String(local ? local.id : r.mod_id);
        if (refs.has(key)) continue;
        refs.set(key, r);
        selected.push(key);
    }

    const d = {
        name: base.name || '',
        description: base.description || '',
        game: base.game_name || '',
        source: _defaultSource(pack ? base : null),
        depMode: base.dependency_mode || 'manual',
        orderMode: base.order_mode || '',
        skip: !!base.skip_integrity_check,
        srLink: base.sr_link || '',
        autoSrc: true,
        selected,
        refs,
        step: 0,
        reached: editing ? STEP_COUNT - 1 : 0,
        q: '',
        building: false,
        cancelled: false,
        saving: false,
    };

    let m = null;
    const handle = {
        refresh: () => { if (m && d.step === 1 && !d.building) render(); },
        close: () => m?.close(),
    };
    m = openModal({
        id: 'mp-wizard',
        title: editing ? t('modpack.edit') : t('modpack.newPack'),
        subtitle: editing ? base.name : t('modpack.ui.createSub'),
        icon: uiIcon('package', 18),
        size: 'lg',
        tall: true,
        className: 'mpw',
        closeLabel: t('common.close'),
        body: '',
        footer: '',
        // A click beside the dialog must not throw away a half-made pack.
        backdropClose: false,
        onClose: () => { d.cancelled = true; if (_wiz === handle) _wiz = null; },
    });
    _wiz = handle;

    // The steps, as a band between the header and the body.
    const band = document.createElement('div');
    band.className = 'modal-toolbar mpw-band';
    band.innerHTML = `<ol class="mpw-steps">${_stepLabels().map((label, i) => `
        <li><button type="button" class="mpw-step" data-step="${i}"><span class="mpw-step-n">${i + 1}</span><span class="mpw-step-l">${escHtml(label)}</span></button></li>`).join('')}</ol>`;
    m.dialog.insertBefore(band, m.body);
    band.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.mpw-step');
        if (b && !b.disabled) void go(Number(b.dataset.step));
    });

    const canLeave = (step) => step === 0 ? !!d.name.trim() : step === 1 ? d.selected.length > 0 : true;
    const canFinish = () => !!d.name.trim() && d.selected.length > 0;
    const canReach = (i) => {
        if (editing || i <= d.reached) return true;
        for (let s = 0; s < i; s++) if (!canLeave(s)) return false;
        return i <= d.reached + 1;
    };

    const drawBand = () => {
        band.querySelectorAll<HTMLButtonElement>('.mpw-step').forEach((b) => {
            const i = Number(b.dataset.step);
            b.classList.toggle('is-done', !editing && i < d.step);
            if (i === d.step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
            b.disabled = d.building || d.saving || !canReach(i);
        });
    };

    const footerNote = () => {
        const parts = [];
        if (!editing) parts.push(t('modpack.ui.stepOf', { n: String(d.step + 1), total: String(STEP_COUNT) }));
        if (d.step === 1 || editing) parts.push(t('modpack.ui.selCount', { n: String(d.selected.length) }));
        return parts.join(' · ');
    };

    const drawFooter = () => {
        if (!m.footer) return;
        if (d.building) {
            m.footer.innerHTML = `<span class="modal-footer-note mpw-foot-note">${escHtml(t('modpack.ui.buildNote'))}</span>
                <button type="button" class="btn btn-secondary" data-w="stop">${escHtml(t('modpack.ui.stop'))}</button>`;
            m.footer.querySelector('[data-w="stop"]')?.addEventListener('click', () => { d.cancelled = true; });
            return;
        }
        const busy = d.saving ? ' disabled' : '';
        const finishOff = !canFinish() || d.saving ? ' disabled' : '';
        if (editing) {
            m.footer.innerHTML = `
                <div class="modal-footer-start"><span class="modal-footer-note mpw-foot-note">${escHtml(footerNote())}</span></div>
                <button type="button" class="btn btn-secondary" data-w="cancel"${busy}>${escHtml(t('common.cancel'))}</button>
                <button type="button" class="btn btn-primary" id="editor-save" data-w="finish"${finishOff}>${uiIcon('save', 14)}<span>${escHtml(d.saving ? t('modpack.saving') : t('common.save'))}</span></button>`;
        } else {
            const last = d.step === STEP_COUNT - 1;
            m.footer.innerHTML = `
                <div class="modal-footer-start">
                    <button type="button" class="btn btn-ghost" data-w="back"${busy}>${d.step === 0 ? escHtml(t('common.cancel')) : `${uiIcon('arrow-left', 14)}<span>${escHtml(t('common.back'))}</span>`}</button>
                    <span class="modal-footer-note mpw-foot-note">${escHtml(footerNote())}</span>
                </div>
                ${last
                    ? `<button type="button" class="btn btn-primary" id="editor-save" data-w="finish"${finishOff}>${uiIcon('check', 14)}<span>${escHtml(d.saving ? t('modpack.saving') : t('modpack.ui.createBtn'))}</span></button>`
                    : `<button type="button" class="btn btn-secondary" id="editor-save" data-w="finish" title="${escAttr(t('modpack.ui.finishNowTip'))}"${finishOff}>${escHtml(t('modpack.ui.finishNow'))}</button>
                       <button type="button" class="btn btn-primary" id="mp-next" data-w="next"${canLeave(d.step) && !d.saving ? '' : ' disabled'}><span>${escHtml(t('modpack.ui.next'))}</span>${uiIcon('arrow-right', 14)}</button>`}`;
        }
        const f = m.footer;
        f.querySelector('[data-w="cancel"]')?.addEventListener('click', () => m.close());
        f.querySelector('[data-w="back"]')?.addEventListener('click', () => { if (d.step === 0) m.close(); else void go(d.step - 1); });
        f.querySelector('[data-w="next"]')?.addEventListener('click', () => void go(d.step + 1));
        f.querySelector('[data-w="finish"]')?.addEventListener('click', () => void finish());
    };

    // ── Step bodies ──
    const bodyBasics = () => {
        const games = Array.from(new Set([
            ..._profiles.map(p => p.game_name).filter(Boolean),
            ..._modpacks.map(p => p.game_name).filter(Boolean),
        ].map(String))).sort((a, b) => a.localeCompare(b));
        m.body.innerHTML = `
            <label class="bms-field">
                <span class="bms-label">${escHtml(t('modpack.name'))}</span>
                <input id="mp-name" type="text" class="form-input" maxlength="120" autocomplete="off" placeholder="${escAttr(t('modpack.namePlaceholder'))}" value="${escAttr(d.name)}">
            </label>
            <div class="mpw-2col">
                <label class="bms-field">
                    <span class="bms-label">${escHtml(t('modpack.ui.source'))}</span>
                    <select id="mp-profile" class="form-input">
                        ${_profiles.map(p => `<option value="${escAttr(String(p.id))}"${String(p.id) === d.source ? ' selected' : ''}>${escHtml(p.name || String(p.id))}${p.game_name ? ` · ${escHtml(p.game_name)}` : ''}</option>`).join('')}
                        <option value="multi"${d.source === 'multi' ? ' selected' : ''}>${escHtml(t('modpack.ui.sourceMulti'))}</option>
                    </select>
                    <span class="bms-note">${escHtml(t('modpack.ui.sourceHint'))}</span>
                </label>
                <label class="bms-field">
                    <span class="bms-label">${escHtml(t('modpack.game'))}</span>
                    <input id="mp-game" type="text" class="form-input" list="mp-game-list" autocomplete="off" placeholder="${escAttr(t('modpack.gamePlaceholder'))}" value="${escAttr(d.game)}">
                    <datalist id="mp-game-list">${games.map(g => `<option value="${escAttr(g)}"></option>`).join('')}</datalist>
                </label>
            </div>
            <label class="bms-field">
                <span class="bms-label">${escHtml(t('modpack.ui.descOptional'))}</span>
                <textarea id="mp-desc" class="form-input" rows="3">${escHtml(d.description)}</textarea>
            </label>`;
        const name = m.q<HTMLInputElement>('#mp-name');
        name?.addEventListener('input', () => { d.name = name.value; drawFooter(); drawBand(); });
        name?.addEventListener('keydown', (e) => {
            if ((e as KeyboardEvent).key === 'Enter' && !editing && canLeave(0)) { e.preventDefault(); void go(1); }
        });
        m.q<HTMLSelectElement>('#mp-profile')?.addEventListener('change', (e) => {
            d.source = (e.target as HTMLSelectElement).value;
            const p = _profiles.find(x => String(x.id) === d.source);
            const game = m.q<HTMLInputElement>('#mp-game');
            if (p?.game_name && game && !game.value.trim()) { game.value = p.game_name; d.game = p.game_name; }
        });
        const game = m.q<HTMLInputElement>('#mp-game');
        game?.addEventListener('input', () => { d.game = game.value; });
        const desc = m.q<HTMLTextAreaElement>('#mp-desc');
        desc?.addEventListener('input', () => { d.description = desc.value; });
        // A new pack takes its game from the profile when nobody typed one.
        if (!editing && !d.game) {
            const p = _profiles.find(x => String(x.id) === d.source);
            if (p?.game_name && game) { game.value = p.game_name; d.game = p.game_name; }
        }
    };

    const bodyMods = () => {
        const avail = _modsOfSource(d.source);
        const availIds = new Set(avail.map(x => String(x.id)));
        const localIds = new Set(_allMods.map(x => String(x.id)));
        const sel = new Set(d.selected);
        // Picked earlier and still in the pack, but not offered here: another profile's, or
        // not installed on this PC. They stay listed (and picked) so nothing leaves silently.
        const others = d.selected.filter(id => !availIds.has(id));
        const enabled = avail.filter(x => x.enabled);
        const srcName = d.source === 'multi' ? t('modpack.ui.sourceAll') : (_profiles.find(p => String(p.id) === d.source)?.name || '');
        // The checkbox comes last in the markup and first on screen (CSS order), so the name and
        // its escaped data-name sit together where tests/modpack-xss.test.mjs looks for them.
        const row = (m, extra = '') => {
            const prof = _profileOfMod(m);
            const deps = m.dependencies?.length || 0;
            const on = sel.has(String(m.id));
            return `<label class="mpw-row mp-mod-item${on ? ' is-sel' : ''}" data-id="${escAttr(String(m.id))}" data-name="${escAttr(String(m.name || m.id).toLowerCase())}">
                <span class="mpw-row-txt"><span class="mp-mod-name">${escHtml(m.name || m.id)}</span>
                <span class="mpw-row-meta">${m.version ? `<span>v${escHtml(m.version)}</span>` : ''}${d.source === 'multi' && prof ? `<span>${escHtml(prof.name)}</span>` : ''}${deps ? `<span>${escHtml(t('modpack.ui.deps', { n: String(deps) }))}</span>` : ''}${extra}</span></span>
                ${m.enabled ? `<span class="bms-chip bms-chip--ok mpw-on"><span class="bms-dot"></span>${escHtml(t('modpack.act.stateOn'))}</span>` : ''}
                <input type="checkbox" class="mpw-cb" value="${escAttr(String(m.id))}"${on ? ' checked' : ''}>
            </label>`;
        };
        const ghost = (id) => {
            const local = _allMods.find(x => String(x.id) === id);
            if (local) return row(local);
            const r = d.refs.get(id);
            return `<label class="mpw-row is-sel is-ghost" data-id="${escAttr(id)}" data-name="${escAttr(String(r?.mod_name || id).toLowerCase())}">
                <span class="mpw-row-txt"><span class="mpw-row-name">${escHtml(r?.mod_name || id)}</span>
                <span class="mpw-row-meta">${r?.mod_version ? `<span>v${escHtml(r.mod_version)}</span>` : ''}<span>${escHtml(localIds.has(id) ? t('modpack.ui.otherProfile') : t('modpack.ui.notInstalled'))}</span></span></span>
                <input type="checkbox" class="mpw-cb" value="${escAttr(id)}" checked>
            </label>`;
        };
        m.body.innerHTML = `
            <div class="mpw-pick-bar">
                <label class="mp-search mpw-search">${uiIcon('search', 14)}<input type="search" id="mp-pick-q" placeholder="${escAttr(t('modpack.ui.searchMods'))}" aria-label="${escAttr(t('modpack.ui.searchMods'))}" autocomplete="off" spellcheck="false" value="${escAttr(d.q)}"></label>
                <div class="mpw-quick" role="group" aria-label="${escAttr(t('modpack.ui.quickPick', { src: srcName }))}">
                    <span class="mpw-quick-l">${escHtml(t('modpack.ui.quickPick', { src: srcName }))}</span>
                    <button type="button" class="btn btn-secondary btn-sm" id="mp-pick-all"${avail.length ? '' : ' disabled'}>${uiIcon('check', 14)}<span>${escHtml(t('modpack.ui.pickAll', { n: String(avail.length) }))}</span></button>
                    <button type="button" class="btn btn-ghost btn-sm" id="mp-pick-enabled"${enabled.length ? '' : ' disabled'}>${escHtml(t('modpack.ui.pickEnabled', { n: String(enabled.length) }))}</button>
                    <button type="button" class="btn btn-ghost btn-sm" id="mp-pick-clear"${d.selected.length ? '' : ' disabled'}>${escHtml(t('common.clear'))}</button>
                </div>
            </div>
            ${avail.length || others.length ? `<div class="mpw-list" id="mp-pick-list" role="group" aria-label="${escAttr(t('modpack.ui.stepMods'))}">
                ${avail.map(x => row(x)).join('')}
                ${others.length ? `<div class="mpw-group">${escHtml(t('modpack.ui.alsoInPack'))}</div>${others.map(ghost).join('')}` : ''}
            </div>
            <p class="bms-note mpw-nohit" id="mp-pick-none" hidden>${escHtml(t('modpack.ui.noModHit'))}</p>`
            : `<div class="bms-empty"><div class="bms-empty-ic">${uiIcon('folders', 20)}</div><div class="bms-empty-t">${escHtml(t('modpack.ui.noModsHere'))}</div><p class="bms-note">${escHtml(t('modpack.ui.noModsHereHint'))}</p></div>`}`;

        const list = m.q('#mp-pick-list');
        const filter = () => {
            const q = d.q.toLowerCase().trim();
            let shown = 0;
            list?.querySelectorAll<HTMLElement>('.mpw-row').forEach((r) => {
                const ok = !q || String(r.dataset.name || '').includes(q);
                r.hidden = !ok;
                if (ok) shown++;
            });
            list?.querySelectorAll<HTMLElement>('.mpw-group').forEach((g) => { g.hidden = !!q; });
            const none = m.q('#mp-pick-none');
            if (none) none.hidden = shown > 0;
        };
        const sync = () => {
            const s = new Set(d.selected);
            list?.querySelectorAll<HTMLElement>('.mpw-row').forEach((r) => {
                const on = s.has(String(r.dataset.id));
                r.classList.toggle('is-sel', on);
                const cb = r.querySelector<HTMLInputElement>('.mpw-cb');
                if (cb) cb.checked = on;
            });
            const clear = m.q<HTMLButtonElement>('#mp-pick-clear');
            if (clear) clear.disabled = !d.selected.length;
            drawFooter();
            drawBand();
        };
        const add = (ids) => { for (const id of ids) if (!d.selected.includes(id)) d.selected.push(id); sync(); };
        list?.addEventListener('change', (e) => {
            const cb = (e.target as HTMLElement).closest<HTMLInputElement>('.mpw-cb');
            if (!cb) return;
            if (cb.checked) { if (!d.selected.includes(cb.value)) d.selected.push(cb.value); }
            else d.selected = d.selected.filter(x => x !== cb.value);
            sync();
        });
        m.q('#mp-pick-all')?.addEventListener('click', () => add(avail.map(x => String(x.id))));
        m.q('#mp-pick-enabled')?.addEventListener('click', () => add(enabled.map(x => String(x.id))));
        m.q('#mp-pick-clear')?.addEventListener('click', () => { d.selected = []; sync(); });
        const q = m.q<HTMLInputElement>('#mp-pick-q');
        q?.addEventListener('input', () => { d.q = q.value; filter(); });
        filter();
    };

    const bodyOptions = () => {
        const sel = (v, cur) => (v === cur ? ' selected' : '');
        m.body.innerHTML = `
            <p class="bms-note">${escHtml(t('modpack.ui.optionsNote'))}</p>
            <section class="bms-card">
                <h3 class="bms-card-title">${escHtml(t('modpack.ui.whenApplied'))}</h3>
                <div class="mpw-2col">
                    <label class="bms-field">
                        <span class="bms-label">${escHtml(t('modpack.depMode'))}</span>
                        <select id="mp-depmode" class="form-input">
                            <option value="manual"${sel('manual', d.depMode)}>${escHtml(t('modpack.depModeManual'))}</option>
                            <option value="all"${sel('all', d.depMode)}>${escHtml(t('modpack.depModeAll'))}</option>
                            <option value="none"${sel('none', d.depMode)}>${escHtml(t('modpack.depModeNone'))}</option>
                        </select>
                    </label>
                    <label class="bms-field">
                        <span class="bms-label">${escHtml(t('modpack.orderMode'))}</span>
                        <select id="mp-ordermode" class="form-input" title="${escAttr(t('modpack.orderModeTip'))}">
                            <option value=""${sel('', d.orderMode)}>${escHtml(t('order.mode.default'))}</option>
                            <option value="top"${sel('top', d.orderMode)}>${escHtml(t('order.mode.top'))}</option>
                            <option value="bottom"${sel('bottom', d.orderMode)}>${escHtml(t('order.mode.bottom'))}</option>
                            <option value="keep"${sel('keep', d.orderMode)}>${escHtml(t('order.mode.keep'))}</option>
                        </select>
                    </label>
                </div>
                <label class="mp-opt mp-opt--warn">
                    <input type="checkbox" id="mp-skip-integrity"${d.skip ? ' checked' : ''}>
                    <span class="mp-opt-txt"><b>${escHtml(t('modpack.skipIntegrity'))}</b><span>${escHtml(t('modpack.skipIntegrityDesc'))}</span></span>
                </label>
            </section>
            <section class="bms-card">
                <h3 class="bms-card-title">${escHtml(t('modpack.ui.sources'))}</h3>
                <label class="mp-opt">
                    <input type="checkbox" id="ms-auto-update-src"${d.autoSrc ? ' checked' : ''}>
                    <span class="mp-opt-txt"><b>${escHtml(t('modpack.autoUpdateSrc'))}</b><span>${escHtml(t('modpack.autoUpdateSrcTip'))}</span></span>
                </label>
                <label class="bms-field">
                    <span class="bms-label">${escHtml(t('modpack.srLink'))}</span>
                    <input id="mp-srlink" type="text" class="form-input" autocomplete="off" placeholder="${escAttr(t('modpack.srLinkPlaceholder'))}" value="${escAttr(d.srLink)}">
                </label>
            </section>`;
        m.q('#mp-depmode')?.addEventListener('change', (e) => { d.depMode = (e.target as HTMLSelectElement).value; });
        m.q('#mp-ordermode')?.addEventListener('change', (e) => { d.orderMode = (e.target as HTMLSelectElement).value; });
        m.q('#mp-skip-integrity')?.addEventListener('change', (e) => { d.skip = (e.target as HTMLInputElement).checked; });
        m.q('#ms-auto-update-src')?.addEventListener('change', (e) => { d.autoSrc = (e.target as HTMLInputElement).checked; });
        const sr = m.q<HTMLInputElement>('#mp-srlink');
        sr?.addEventListener('input', () => { d.srLink = sr.value; });
    };

    const bodyReview = () => {
        _ensureOrderCss();
        const items = d.selected.map(id => d.refs.get(id)).filter(Boolean);
        const size = items.reduce((n, r) => n + (r.file_manifest || []).reduce((a, f) => a + (Number(f?.size) || 0), 0), 0);
        const src = d.source === 'multi' ? t('modpack.ui.sourceMulti') : (_profiles.find(p => String(p.id) === d.source)?.name || '');
        const depLabel = d.depMode === 'all' ? t('modpack.depModeAll') : d.depMode === 'none' ? t('modpack.depModeNone') : t('modpack.depModeManual');
        const orderLabel = d.orderMode === 'top' ? t('order.mode.top') : d.orderMode === 'bottom' ? t('order.mode.bottom') : d.orderMode === 'keep' ? t('order.mode.keep') : t('order.mode.default');
        const dt = (label, value) => `<div><dt>${escHtml(label)}</dt><dd>${value}</dd></div>`;
        m.body.innerHTML = `
            <dl class="mpw-sum">
                ${dt(t('modpack.name'), d.name.trim() ? escHtml(d.name.trim()) : `<span class="mpw-missing">${escHtml(t('modpack.errNoName'))}</span>`)}
                ${dt(t('modpack.game'), escHtml(d.game.trim() || t('modpack.general')))}
                ${dt(t('modpack.ui.source'), escHtml(src))}
                ${dt(t('modpack.ui.stepMods'), `${escHtml(t('modpack.modsCount', { count: String(items.length) }))}${size ? ` · ${escHtml(formatBytes(size))}` : ''}`)}
                ${dt(t('modpack.depMode'), escHtml(depLabel))}
                ${dt(t('modpack.orderMode'), escHtml(orderLabel))}
                ${d.skip ? dt(t('modpack.skipIntegrity'), `<span class="mp-meta-warn">${uiIcon('warning', 12)}${escHtml(t('modpack.noCheckChip'))}</span>`) : ''}
            </dl>
            <section class="bms-card">
                <div class="bms-card-h"><h3 class="bms-card-title">${escHtml(t('modpack.ui.reviewOrder'))}</h3></div>
                <p class="bms-note">${escHtml(t('modpack.orderHint'))}</p>
                ${items.length ? `<ol class="mpw-refs" id="mp-modlist">${items.map((r, i) => _refRowHtml(r, i, items.length)).join('')}</ol>`
                    : `<div class="bms-empty"><div class="bms-empty-t">${escHtml(t('modpack.editorNoMods'))}</div><button type="button" class="btn btn-secondary btn-sm" data-w="tomods">${escHtml(t('modpack.addMods'))}</button></div>`}
            </section>`;
        m.q('[data-w="tomods"]')?.addEventListener('click', () => void go(1));
        const ol = m.q('#mp-modlist');
        if (!ol) return;
        const keyAt = (li) => String(d.selected.filter(id => d.refs.has(id))[Number(li.dataset.i)]);
        ol.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-r]');
            const li = btn?.closest<HTMLElement>('.mpw-ref');
            if (!btn || !li) return;
            const i = Number(li.dataset.i);
            const ordered = d.selected.filter(id => d.refs.has(id));
            const act = btn.dataset.r;
            if (act === 'remove') {
                const key = keyAt(li);
                d.selected = d.selected.filter(x => x !== key);
                render();
                return;
            }
            const j = act === 'up' ? i - 1 : i + 1;
            if (j < 0 || j >= ordered.length) return;
            [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
            // Unbuilt picks (none at this point) would keep their place at the end.
            d.selected = [...ordered, ...d.selected.filter(id => !d.refs.has(id))];
            render();
            (m.body.querySelectorAll('.mpw-ref')[j]?.querySelector(act === 'up' ? '[data-r="up"]' : '[data-r="down"]') as HTMLElement | null)?.focus();
        });
        const edit = (e) => {
            const el = e.target as HTMLInputElement | HTMLSelectElement;
            const li = el.closest<HTMLElement>('.mpw-ref');
            const field = el.dataset?.f;
            if (!li || !field) return;
            const r = d.refs.get(keyAt(li));
            if (!r) return;
            if (field === 'include_dependencies') r.include_dependencies = (el as HTMLInputElement).checked;
            else if (field === 'fallback_type') r.fallback_type = el.value;
            else r[field] = el.value.trim();
        };
        ol.addEventListener('input', edit);
        ol.addEventListener('change', edit);
    };

    const render = () => {
        if (!m.overlay.isConnected) return;
        drawBand();
        if (d.step === 0) bodyBasics();
        else if (d.step === 1) bodyMods();
        else if (d.step === 2) bodyOptions();
        else bodyReview();
        drawFooter();
    };

    /** Build the refs of the mods picked since the dialog opened (hashes, file list), with
     *  progress in the body. False when it was stopped or the dialog closed. */
    const ensureRefs = async () => {
        const todo = d.selected.filter(id => !d.refs.has(id));
        if (!todo.length) return true;
        d.building = true;
        d.cancelled = false;
        drawBand();
        drawFooter();
        m.body.innerHTML = `<div class="mpw-building" role="status">
            <div class="mpw-building-t">${uiIcon('loader', 16, { cls: 'np-spin' })}<span id="mpw-build-txt"></span></div>
            <div class="bms-progress"><span id="mpw-build-bar"></span></div>
        </div>`;
        const txt = m.q('#mpw-build-txt');
        const bar = m.q<HTMLElement>('#mpw-build-bar');
        const includeDeps = d.depMode === 'all';
        let errors = 0;
        for (let i = 0; i < todo.length; i++) {
            if (d.cancelled) break;
            const id = todo[i];
            const mod = _allMods.find(x => String(x.id) === id);
            if (txt) txt.textContent = t('modpack.ui.building', { name: mod?.name || id, n: String(i + 1), total: String(todo.length) });
            if (bar) bar.style.width = `${Math.round((i / todo.length) * 100)}%`;
            if (!mod) {
                // Not installed here: kept as a reference by id, like a pre-seeded pack.
                d.refs.set(id, { mod_id: id, mod_name: id, mod_version: '', sha256: '', file_manifest: [] });
                continue;
            }
            // If the mod is linked to a repo, optionally seed that repo as a
            // Server Repo fallback download link so it stays updatable.
            let fallbackLink = null, fallbackType = 'direct';
            if (d.autoSrc) {
                const repo = mod.source_repo || mod.update_url
                    || (Array.isArray(mod.update_sources) && mod.update_sources[0]?.repo_url) || '';
                if (repo) { fallbackLink = repo; fallbackType = 'sr'; }
            }
            try {
                const ref = await invoke('build_modpack_mod_ref', {
                    modId: id,
                    profileId: _profileOfMod(mod)?.id || null,
                    includeDependencies: includeDeps,
                    downloadLink: null,
                    fallbackLink,
                    fallbackType,
                });
                d.refs.set(id, ref);
            } catch (e) {
                console.error(e);
                errors++;
                d.selected = d.selected.filter(x => x !== id);
            }
        }
        d.building = false;
        if (errors > 0) toast(t('modpack.addModErrors', { count: String(errors) }), 'warning');
        if (!m.overlay.isConnected) return false;
        if (d.cancelled) {
            d.cancelled = false;
            toast(t('modpack.addStopped'), 'info');
            render();
            return false;
        }
        return true;
    };

    const go = async (i) => {
        if (i < 0 || i >= STEP_COUNT || d.building || d.saving) return;
        if (!canReach(i)) {
            if (!d.name.trim()) toast(t('modpack.errNoName'), 'warning');
            else if (!d.selected.length) toast(t('modpack.errNoMods'), 'warning');
            return;
        }
        if (i === STEP_COUNT - 1 && !(await ensureRefs())) return;
        d.step = i;
        d.reached = Math.max(d.reached, i);
        render();
        m.body.scrollTop = 0;
        const first = d.step === 0 ? '#mp-name' : d.step === 1 ? '#mp-pick-q' : null;
        if (first) setTimeout(() => m.q<HTMLElement>(first)?.focus(), 0);
    };

    const finish = async () => {
        if (d.building || d.saving) return;
        if (!d.name.trim()) { toast(t('modpack.errNoName'), 'warning'); await go(0); return; }
        if (!d.selected.length) { toast(t('modpack.errNoMods'), 'warning'); await go(1); return; }
        if (!(await ensureRefs())) return;
        const mods = d.selected.map(id => d.refs.get(id)).filter(Boolean);
        if (!mods.length) { toast(t('modpack.errNoMods'), 'warning'); await go(1); return; }
        const payload = {
            ...base,
            name: d.name.trim(),
            description: d.description.trim() || null,
            game_name: d.game.trim() || null,
            multi_profile: d.source === 'multi',
            skip_integrity_check: d.skip,
            dependency_mode: d.depMode || 'manual',
            sr_link: d.srLink.trim() || null,
            order_mode: d.orderMode || null,
            mods,
        };
        d.saving = true;
        drawBand();
        drawFooter();
        try {
            await invoke('save_modpack', { modpack: payload });
            toast(t('modpack.savedOk'), 'success');
            dispatchBmmAction(BMM_ACTIONS.MODPACK_CREATED, { name: payload.name });
            m.close();
            await _loadData();
            _rerender();
            // Notify other components (like Repo page)
            window.dispatchEvent(new CustomEvent('bmm://modpacks-updated'));
        } catch (err) {
            toast(String(err), 'error');
            d.saving = false;
            if (m.overlay.isConnected) render();
        }
    };

    render();
    if (d.step === 0) setTimeout(() => m.q<HTMLElement>('#mp-name')?.focus(), 0);
    if (opts.autoSave) setTimeout(() => { void finish(); }, 150);
}

/** One row of the review: position, order buttons, name, remove, and the sources fold. */
function _refRowHtml(r, i, total): string {
    const open = r.download_link || r.download_fallback || r.fallback_link || r.include_dependencies;
    return `<li class="mpw-ref" data-i="${i}">
        <div class="mpw-ref-top">
            <span class="mp-order-btns">
                <button type="button" class="btn btn-icon btn-ghost" data-r="up" title="${escAttr(t('order.moveUp'))}" aria-label="${escAttr(t('order.moveUp'))}"${i === 0 ? ' disabled' : ''}>${uiIcon('chevron-up', 12)}</button>
                <button type="button" class="btn btn-icon btn-ghost" data-r="down" title="${escAttr(t('order.moveDown'))}" aria-label="${escAttr(t('order.moveDown'))}"${i === total - 1 ? ' disabled' : ''}>${uiIcon('chevron-down', 12)}</button>
            </span>
            <span class="mp-order-pos">${i + 1}</span>
            <span class="mpw-ref-txt"><b title="${escAttr(r.mod_name)}">${escHtml(r.mod_name)}</b>
                <span>${r.mod_version ? `v${escHtml(r.mod_version)} · ` : ''}${escHtml(r.profile_name || t('modpack.global'))}</span></span>
            <button type="button" class="btn btn-icon btn-ghost btn-sm mp-danger" data-r="remove" title="${escAttr(t('modpack.removeMod'))}" aria-label="${escAttr(`${t('modpack.removeMod')}: ${r.mod_name}`)}">${uiIcon('close', 14)}</button>
        </div>
        <details class="mp-mi-more"${open ? ' open' : ''}>
            <summary class="mp-mi-more-h">${uiIcon('chevron-right', 12)}<span>${escHtml(t('modpack.sourcesFold'))}</span></summary>
            <div class="mp-mi-grid">
                <label class="bms-field"><span class="bms-label">${escHtml(t('modpack.modDownloadLink'))}</span>
                    <input type="text" class="form-input" data-f="download_link" placeholder="https://..." value="${escAttr(r.download_link || '')}"></label>
                <label class="bms-field"><span class="bms-label">${escHtml(t('modpack.modFallback'))}</span>
                    <input type="text" class="form-input" data-f="download_fallback" placeholder="${escAttr(t('modpack.modFallbackPlaceholder'))}" value="${escAttr(r.download_fallback || '')}"></label>
            </div>
            <div class="mp-mi-row">
                <label class="checkbox-container mp-mi-check"><input type="checkbox" data-f="include_dependencies"${r.include_dependencies ? ' checked' : ''}><span>${escHtml(t('modpack.modDeps'))}</span></label>
                <label class="mp-mi-sel"><span class="bms-label">${escHtml(t('modpack.modFallbackType'))}</span>
                    <select class="form-input select-sm" data-f="fallback_type">
                        <option value="direct"${r.fallback_type !== 'sr' ? ' selected' : ''}>${escHtml(t('modpack.fallbackDirect'))}</option>
                        <option value="sr"${r.fallback_type === 'sr' ? ' selected' : ''}>${escHtml(t('modpack.fallbackServerRepo'))}</option>
                    </select></label>
            </div>
        </details>
    </li>`;
}

/** The order controls' styles live with the activation-order view (css/load-order.css). */
function _ensureOrderCss() {
    if (document.getElementById('load-order-css')) return;
    const link = document.createElement('link');
    link.id = 'load-order-css';
    link.rel = 'stylesheet';
    link.href = 'css/load-order.css';
    document.head.appendChild(link);
}

// ── Import ───────────────────────────────────────────────────────────────────

function _afterImport() {
    toast(t('modpack.importSuccess'), 'success');
    window.dispatchEvent(new CustomEvent('bmm://modpacks-updated'));
}

function _openImportModal() {
    const choice = (key, icon, title, desc) => `
        <button type="button" class="mpx-choice" data-imp="${key}">
            <span class="mpx-choice-ic" aria-hidden="true">${uiIcon(icon, 18)}</span>
            <span class="mpx-choice-txt"><b>${escHtml(title)}</b><span>${escHtml(desc)}</span></span>
            ${uiIcon('chevron-right', 16, { cls: 'mpx-choice-go' })}
        </button>`;
    const m = openModal({
        title: t('modpack.importTitle'),
        subtitle: t('modpack.ui.importSub'),
        icon: uiIcon('import', 18),
        size: 'sm',
        className: 'mpx',
        closeLabel: t('common.close'),
        body: `
            <div class="mpx-choices">
                ${choice('file', 'file', t('modpack.ui.fromFile'), t('modpack.ui.fromFileD'))}
                ${choice('link', 'link', t('modpack.ui.fromLink'), t('modpack.ui.fromLinkD'))}
                <div class="mpx-link" id="mpx-link" hidden>
                    <input type="url" class="form-input" id="mpx-url" placeholder="https://..." aria-label="${escAttr(t('modpack.ui.fromLink'))}" autocomplete="off" spellcheck="false">
                    <p class="bms-note mpx-err" id="mpx-err" role="alert" hidden></p>
                </div>
                ${choice('catalog', 'store', t('modpack.ui.fromCat'), t('modpack.ui.fromCatD'))}
            </div>`,
        footer: `
            <button type="button" class="btn btn-secondary" data-imp="close">${escHtml(t('common.cancel'))}</button>
            <button type="button" class="btn btn-primary" id="mpx-go" hidden>${uiIcon('import', 14)}<span>${escHtml(t('modpack.ui.importBtn'))}</span></button>`,
    });
    const linkBox = m.q('#mpx-link');
    const url = m.q<HTMLInputElement>('#mpx-url');
    const err = m.q('#mpx-err');
    const goBtn = m.q<HTMLButtonElement>('#mpx-go');
    const showErr = (msg) => { if (err) { err.textContent = msg; err.hidden = !msg; } };
    const fromLink = async () => {
        const v = (url?.value || '').trim();
        if (!/^https?:\/\/\S+$/i.test(v)) { showErr(t('modpack.ui.linkBad')); url?.focus(); return; }
        showErr('');
        if (goBtn) { goBtn.disabled = true; goBtn.innerHTML = `${uiIcon('loader', 14, { cls: 'np-spin' })}<span>${escHtml(t('modpack.ui.importing'))}</span>`; }
        try {
            await invoke('install_modpack_from_url', { downloadUrl: v });
            m.close();
            _afterImport();
        } catch (e) {
            const raw = String(e);
            showErr(raw.startsWith('modpack.errDownload') ? t('modpack.errDownload') : raw);
            if (goBtn) { goBtn.disabled = false; goBtn.innerHTML = `${uiIcon('import', 14)}<span>${escHtml(t('modpack.ui.importBtn'))}</span>`; }
        }
    };
    m.dialog.addEventListener('click', async (e) => {
        const key = (e.target as HTMLElement).closest<HTMLElement>('[data-imp]')?.dataset.imp;
        if (key === 'close') m.close();
        else if (key === 'catalog') { m.close(); document.getElementById('btn-modpack-catalog')?.click(); }
        else if (key === 'link') {
            if (linkBox) linkBox.hidden = false;
            if (goBtn) goBtn.hidden = false;
            m.q('[data-imp="link"]')?.classList.add('is-open');
            url?.focus();
        } else if (key === 'file') {
            m.close();
            try {
                await invoke('import_modpack');
                _afterImport();
            } catch (er) {
                if (String(er) !== 'repo.errCancel') toast(String(er), 'error');
            }
        }
    });
    goBtn?.addEventListener('click', () => void fromLink());
    url?.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); void fromLink(); } });
}

// ── Export & share ───────────────────────────────────────────────────────────

function _openShareModal(pack) {
    const m = openModal({
        title: t('modpack.ui.share'),
        subtitle: t('modpack.ui.shareSub'),
        icon: uiIcon('share', 18),
        size: 'sm',
        className: 'mpx',
        closeLabel: t('common.close'),
        body: `
            ${_packLine(pack)}
            <section class="bms-card">
                <span class="bms-label">${escHtml(t('modpack.ui.ids'))}</span>
                <p class="bms-note">${escHtml(t('modpack.ui.idsD'))}</p>
                <div class="mpx-ids">${copyIdButtons('modpack', pack.id)}</div>
            </section>`,
        footer: `
            <button type="button" class="btn btn-secondary" data-sh="close">${escHtml(t('common.close'))}</button>
            <button type="button" class="btn btn-primary" data-sh="file">${uiIcon('export', 14)}<span>${escHtml(t('modpack.ui.exportFile'))}</span></button>`,
        initialFocus: '[data-sh="file"]',
    });
    wireCopyIds(m.body, toast);
    m.q('[data-sh="close"]')?.addEventListener('click', () => m.close());
    m.q('[data-sh="file"]')?.addEventListener('click', async () => {
        if (await _exportModpack(pack)) m.close();
    });
}

/** True when the file was written. */
async function _exportModpack(pack): Promise<boolean> {
    if (!pack) return false;
    try {
        await invoke('export_modpack', { id: pack.id });
        toastSaved(t('modpack.exportSuccess'));
        return true;
    } catch (err) {
        if (String(err) !== 'repo.errCancel') toast(String(err), 'error');
        return false;
    }
}

// ── Delete ───────────────────────────────────────────────────────────────────

async function _deleteModpack(container, pack) {
    if (!pack) return;
    if (!(await _confirmDelete(pack))) return;
    try {
        await invoke('delete_modpack', { id: pack.id });
        toast(t('modpack.deletedOk'), 'success');
        await _loadData();
        if (container) _renderModpackList(container);
        window.dispatchEvent(new CustomEvent('bmm://modpacks-updated'));
    } catch (err) {
        toast(String(err), 'error');
    }
}

/** The question, with the pack it is about. Cancel has the focus. */
function _confirmDelete(pack): Promise<boolean> {
    return new Promise((resolve) => {
        let yes = false;
        const m = openModal({
            title: t('modpack.ui.deleteTitle'),
            subtitle: t('modpack.ui.deleteSub'),
            icon: uiIcon('delete', 18),
            tone: 'danger',
            size: 'sm',
            closeLabel: t('common.close'),
            body: _packLine(pack),
            footer: `
                <button type="button" class="btn btn-secondary" id="dmod-cancel">${escHtml(t('common.cancel'))}</button>
                <button type="button" class="btn btn-danger" id="dmod-confirm">${uiIcon('delete', 14)}<span>${escHtml(t('modpack.deleteConfirmBtn'))}</span></button>`,
            initialFocus: '#dmod-cancel',
            onClose: () => resolve(yes),
        });
        m.q('#dmod-cancel')?.addEventListener('click', () => m.close());
        m.q('#dmod-confirm')?.addEventListener('click', () => { yes = true; m.close(); });
    });
}

// ── Repair ───────────────────────────────────────────────────────────────────

async function _showRepairModal(container, pack, report, onComplete) {
    // Told to whoever is listening, before the modal opens.
    //
    // This is the moment an automation actually wants: the pack was applied and something is
    // missing or corrupt. Waiting for the person to read the modal and click something would
    // mean the task only ever runs when somebody is already fixing it by hand — which is the
    // one case where the task is not needed.
    //
    // One event per mod, so a task repairing them gets the id it needs rather than a count.
    for (const m of report.missingMods || []) {
        fireEvent('bmm.mod.missing', { id: m.mod_id, name: m.mod_name || m.mod_id, pack: pack?.name || '', packId: pack?.id || '' });
    }
    for (const m of report.corruptedMods || []) {
        fireEvent('bmm.mod.corrupt', { id: m.mod_id, name: m.mod_name || m.mod_id, pack: pack?.name || '', packId: pack?.id || '' });
    }
    if ((report.missingMods || []).length || (report.corruptedMods || []).length) {
        fireEvent('bmm.modpack.incomplete', {
            pack: pack?.name || '', packId: pack?.id || '',
            missing: (report.missingMods || []).length,
            corrupt: (report.corruptedMods || []).length,
        });
    }

    const activeProfileId = _activeProfileId || window.cachedActiveProfileId;
    if (!activeProfileId) {
        toast(t('common.error'), 'error');
        return;
    }

    const problematicMods = [...report.missingMods, ...report.corruptedMods];
    let canRepairAny = false;

    const rows = problematicMods.map(m => {
        const isMissing = report.missingMods.some(x => x.mod_id === m.mod_id);
        const fallbackType = m.fallback_type || 'direct';
        // Corrupted => can always be repaired locally (moved files), no link needed.
        // Missing   => needs a download link.
        const hasLink = fallbackType === 'sr' ? !!pack.sr_link : !!(m.download_fallback || m.download_link);
        if (hasLink || !isMissing) canRepairAny = true;
        const source = hasLink
            ? (fallbackType === 'sr' ? t('modpack.fallbackServerRepo') : t('modpack.repair.directLink'))
            : !isMissing ? t('modpack.repair.localRecovery') : t('modpack.repair.linkMissing');
        return `<li class="mp-rep-row">
            <span class="mp-rep-txt"><b>${escHtml(m.mod_name)}</b><span>${m.mod_version ? `v${escHtml(m.mod_version)} · ` : ''}${escHtml(source)}</span></span>
            <span class="bms-chip ${isMissing ? 'bms-chip--danger' : 'bms-chip--warn'}"><span class="bms-dot"></span>${escHtml(isMissing ? t('modpack.repair.statusMissing') : t('modpack.repair.statusCorrupted'))}</span>
        </li>`;
    }).join('');

    const modal = openModal({
        title: t('modpack.repair.title'),
        subtitle: t('modpack.repair.subtitle'),
        icon: uiIcon('download', 18),
        tone: 'warn',
        size: 'md',
        className: 'mp-rep',
        closeLabel: t('common.close'),
        body: `
            <ul class="mp-rep-list">${rows}</ul>
            <div class="mp-rep-progress" id="repair-progress-container" hidden>
                <div class="mp-rep-status"><span id="repair-status-text">${escHtml(t('modpack.repair.preparing'))}</span><span id="repair-status-pct">0%</span></div>
                <div class="bms-progress"><span id="repair-progress-bar"></span></div>
            </div>`,
        footer: `
            <button type="button" id="repair-cancel" class="btn btn-secondary">${escHtml(t('modpack.repair.cancel'))}</button>
            <button type="button" id="repair-start" class="btn btn-primary"${canRepairAny ? '' : ' disabled'}>${uiIcon('download', 14)}<span>${escHtml(canRepairAny ? t('modpack.repair.startBtn') : t('modpack.repair.impossible'))}</span></button>`,
    });

    const startBtn = modal.q('#repair-start');
    const progressContainer = modal.q('#repair-progress-container');
    const statusText = modal.q('#repair-status-text');
    const statusPct = modal.q('#repair-status-pct');
    const progressBar = modal.q<HTMLElement>('#repair-progress-bar');
    const actionsBlock = modal.footer;
    const closeModal = () => modal.close();
    const setTone = (tone: '' | 'err' | 'muted') => {
        statusText?.classList.toggle('is-err', tone === 'err');
        statusText?.classList.toggle('is-muted', tone === 'muted');
    };

    modal.q('#repair-cancel')?.addEventListener('click', closeModal);

    startBtn?.addEventListener('click', async () => {
        if (actionsBlock) actionsBlock.hidden = true;
        if (progressContainer) progressContainer.hidden = false;

        let unlisten = null;
        try {
            unlisten = await window.__TAURI__.event.listen('bmm://repair-progress', (event) => {
                const data = event.payload;
                statusText.textContent = `[${data.modName}] ${data.file}`;
                statusPct.textContent = `${Math.round(data.progress)}%`;
                progressBar.style.width = `${data.progress}%`;
            });

            const modRepairErrors = [];

            for (let i = 0; i < problematicMods.length; i++) {
                const mref = problematicMods[i];
                const fallbackType = mref.fallback_type || 'direct';
                const hasLink = fallbackType === 'sr' ? !!pack.sr_link : !!(mref.download_fallback || mref.download_link);
                const isMissingMref = report.missingMods.some(x => x.mod_id === mref.mod_id);

                // Missing mods without a link cannot be repaired: say so and move on.
                if (!hasLink && isMissingMref) {
                    modRepairErrors.push(t('modpack.repair.noLink', { name: mref.mod_name }));
                    setTone('muted');
                    statusText.textContent = t('modpack.repair.noLinkSkipped', { name: mref.mod_name });
                    await new Promise(r => setTimeout(r, 1200));
                    setTone('');
                    continue;
                }

                statusText.textContent = t('modpack.repair.repairing', { name: mref.mod_name });
                statusPct.textContent = '0%';
                progressBar.style.width = '0%';

                try {
                    await invoke('repair_modpack_mod', {
                        args: {
                            modRef: mref,
                            srLink: pack.sr_link || null,
                            targetProfileId: activeProfileId,
                            creatorId: null
                        }
                    });
                    statusText.replaceChildren(uiIconEl('success', 14, { style: 'vertical-align:-2px;margin-right:4px' }), mref.mod_name);
                } catch (modErr) {
                    const errStr = String(modErr);
                    let friendlyMsg;
                    if (errStr.includes('aucun lien') || errStr.includes('None lien')) {
                        friendlyMsg = t('modpack.repair.noLink', { name: mref.mod_name });
                    } else if (errStr.includes('non trouvé') || errStr.includes('404')) {
                        friendlyMsg = t('modpack.repair.notFound', { name: mref.mod_name });
                    } else if (errStr.includes('refusé') || errStr.includes('403')) {
                        friendlyMsg = t('modpack.repair.denied', { name: mref.mod_name });
                    } else {
                        friendlyMsg = `${mref.mod_name} : ${errStr}`;
                    }
                    modRepairErrors.push(friendlyMsg);
                    setTone('err');
                    statusText.replaceChildren(uiIconEl('error', 14, { style: 'vertical-align:-2px;margin-right:4px' }), friendlyMsg);
                    await new Promise(r => setTimeout(r, 1500));
                    setTone('');
                }
            }

            await _loadData();

            statusText.textContent = t('modpack.repair.finalCheck');
            const finalReport = await invoke('check_modpack_integrity', { modpack: pack });

            if (modRepairErrors.length > 0 && (finalReport.missingMods.length > 0 || finalReport.corruptedMods.length > 0)) {
                toast(t('modpack.repair.incomplete', { errors: modRepairErrors.join('\n• ') }), 'warning');
                closeModal();
            } else if (modRepairErrors.length > 0) {
                toast(t('modpack.repair.partial', { errors: modRepairErrors.join('\n• ') }), 'warning');
                closeModal();
                onComplete();
            } else if (finalReport.missingMods.length > 0 || finalReport.corruptedMods.length > 0) {
                toast(t('modpack.repair.unstable'), 'warning');
                closeModal();
                onComplete();
            } else {
                toast(t('modpack.repair.success'), 'success');
                closeModal();
                onComplete();
            }
        } catch (err) {
            toast(`${t('common.error')} : ${String(err)}`, 'error');
            if (actionsBlock) actionsBlock.hidden = false;
        } finally {
            if (unlisten) unlisten();
        }
    });
}

// ── Apply ────────────────────────────────────────────────────────────────────

/**
 * A pack's primary action. Off → the activation dialog (what will change, options), which runs
 * the pack as one background job (modpack-activate.ts). On → the pack's mods that are on go
 * off, also as a job. Either way the list redraws once the job has finished.
 */
async function _applyModpack(container, pack) {
    if (!pack || !pack.mods || pack.mods.length === 0) return;
    const onDone = async () => {
        await _loadData();
        if (container && container.isConnected) _renderModpackList(container);
    };
    try {
        const shaIndex = await _resolveHashesToModIds(pack.mods);
        const anyEnabled = pack.mods.some(mref => {
            const local = _findLocalByMref(mref, shaIndex);
            return local && local.enabled;
        });
        if (anyEnabled) await deactivateModpack(pack, { onDone });
        else await openModpackActivation(pack, { onDone, repair: _repairFor(container) });
    } catch (err) {
        toast(t('common.error') + ': ' + String(err), 'error');
    }
}

/** The repair dialog for the activation dialog's "Repair": re-plans once it is done. */
function _repairFor(container) {
    return (pack, report, after) => { void _showRepairModal(container, pack, report, async () => { after(); }); };
}

// ── Quick Apply Modal ────────────────────────────────────────────────────────
/** The library's "Activate a modpack": the packs, then the chosen one's plan (modpack-activate.ts). */
export async function openQuickApplyModal() {
    await openModpackPicker({ repair: _repairFor(null) });
}
