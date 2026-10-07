// @ts-nocheck
/**
 * modpack-creator.ts — Modpack Creator UI
 * Allows users to create, edit, and manage Modpacks stored in AppData.
 * Features: single/multi-profile, dependency modes, per-mod download links & fallbacks,
 * optional ServerRepo link, SHA-256 identification for cross-PC recognition.
 */
import { invoke } from '../../core/api.js';
import { copyIdButtons, wireCopyIds } from '../../core/copy-id.js';
import { fireEvent } from '../../core/bmm-events.js';
import { toast, toastSaved } from '../../ui/app.js';
import { t } from '../../core/i18n.js';
import { dispatchBmmAction, BMM_ACTIONS } from '../../ui/tutorial-events.js';
import { formatBytes, escHtml, escAttr } from '../../core/utils.js';
import { MODAL_CLOSE_SVG, openModal } from '../../ui/modal-shell.js';
import { raiseAboveAll } from '../../ui/layer.js';
import { uiIcon } from '../../ui/icons.js';

// ── State ────────────────────────────────────────────────────────────────────

let _modpacks = [];
let _editingPack = null; // LocalModpack currently being edited
let _allMods = [];

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
let _profiles = [];
let _activeProfileId = null;
let _packMods = []; // ModpackModRef[] being assembled
let _isAddingMods = false; // Background state for selection modal
let _addCancelled = false; // Set when the user cancels an in-progress add
let _currentAddingModName = ''; // Name of the mod currently being processed
let _currentSelectionModalUpdateFn = null; // Ref to update UI from background
let _currentSelectionModalOverlay = null; // Ref to current modal overlay for auto-close

// ── Public init ──────────────────────────────────────────────────────────────

export async function initModpackCreator(container) {
    if (!container) return;

    // Bind buttons
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
        btnImport.addEventListener('click', async () => {
            try {
                await invoke('import_modpack');
                toast(t('modpack.importSuccess') || 'Modpack importé avec succès', 'success');
                await _loadData();
                _renderModpackList(container);
                window.dispatchEvent(new CustomEvent('bmm://modpacks-updated'));
            } catch (err) {
                if (String(err) !== 'repo.errCancel') toast(String(err), 'error');
            }
        });
    }


    // Listen for language changes
    document.addEventListener('langChanged', () => {
        if (_editingPack) {
            // If editing, re-render the editor
            _openEditor(container, _editingPack);
        } else {
            // If viewing list, re-render the list
            _renderModpackList(container);
        }
    });

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
            // If editing, refresh the mod selector in the editor
            if (_editingPack) {
                _refreshModSelectorInEditor();
            } else {
                _renderModpackList(container);
            }
        } catch (e) { console.error('[ModpackCreator] live-refresh error', e); }
    });

    // Refresh modpack list when API creates/modifies/deletes a modpack
    window.addEventListener('bmm://modpacks-updated', async () => {
        try {
            await _loadData();
            if (!_editingPack) _renderModpackList(container);
        } catch (e) { console.error('[ModpackCreator] modpacks-updated error', e); }
    });

    // Open modpack editor via event (from QT / external trigger)
    // detail: { action: 'create'|'update', modpackId?: string, prefill?: {...} }
    window.addEventListener('bmm:modpack-focus', async (e: any) => {
        const { action, modpackId, prefill } = e.detail || {};
        try {
            await _loadData();
        } catch (_) {}

        if (action === 'create') {
            // Build a fresh pack skeleton pre-seeded from prefill
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
            // Open in "new pack" mode (pack=null → shows Create title, empty skeleton)
            _openEditor(container, null);
            // After editor renders, apply all prefill values + pre-seeded mods, then auto-save
            requestAnimationFrame(() => {
                if (prefill?.name && document.getElementById('mp-name'))
                    (document.getElementById('mp-name') as HTMLInputElement).value = prefill.name;
                if (prefill?.description != null && document.getElementById('mp-desc'))
                    (document.getElementById('mp-desc') as HTMLTextAreaElement).value = prefill.description || '';
                if (prefill?.game_name != null && document.getElementById('mp-game'))
                    (document.getElementById('mp-game') as HTMLInputElement).value = prefill.game_name || '';
                if (prefill?.sr_link != null && document.getElementById('mp-srlink'))
                    (document.getElementById('mp-srlink') as HTMLInputElement).value = prefill.sr_link || '';
                if (prefill?.dependency_mode && document.getElementById('mp-depmode'))
                    (document.getElementById('mp-depmode') as HTMLSelectElement).value = prefill.dependency_mode;
                if (prefill?.multi_profile != null) {
                    const cb = document.getElementById('mp-multi') as HTMLInputElement;
                    if (cb) { cb.checked = !!prefill.multi_profile; _editingPack.multi_profile = !!prefill.multi_profile; }
                }
                if (prefill?.skip_integrity_check != null) {
                    const cb = document.getElementById('mp-skip-integrity') as HTMLInputElement;
                    if (cb) { cb.checked = !!prefill.skip_integrity_check; _editingPack.skip_integrity_check = !!prefill.skip_integrity_check; }
                }
                // Populate mods list from prefill.mod_ids
                if (freshPack.mods.length > 0) {
                    _packMods = [...freshPack.mods];
                    _editingPack.mods = [..._packMods];
                    const modListEl = document.getElementById('mp-modlist');
                    if (modListEl) _renderPackModList(modListEl);
                }
                // Auto-save if a name was provided (no human interaction required)
                if (prefill?.name) {
                    setTimeout(() => {
                        const saveBtn = document.getElementById('editor-save') as HTMLButtonElement | null;
                        if (saveBtn && !saveBtn.disabled) saveBtn.click();
                    }, 150);
                }
            });

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
            _openEditor(container, merged);
            // Auto-save after editor renders (no human interaction required)
            requestAnimationFrame(() => {
                setTimeout(() => {
                    const saveBtn = document.getElementById('editor-save') as HTMLButtonElement | null;
                    if (saveBtn && !saveBtn.disabled) saveBtn.click();
                }, 150);
            });
        }
    });
}

/** Refreshes the mod picker list inside an open editor without closing it */
function _refreshModSelectorInEditor() {
    const availableContainer = document.getElementById('mp-available-mods');
    if (!availableContainer) return;
    const existingIds = new Set(
        Array.from(document.querySelectorAll('#mp-selected-items [data-mod-id]'))
            .map(el => (el as HTMLElement).dataset.modId || '')
    );
    // Tutorial demo mods float to the top so they're easy to find while following a tutorial.
    const sortedMods = [..._allMods].sort((a: any, b: any) =>
        (b.id?.startsWith('__bmm_tutorial_demo_mod_') ? 1 : 0) - (a.id?.startsWith('__bmm_tutorial_demo_mod_') ? 1 : 0));
    availableContainer.innerHTML = sortedMods.length
        ? sortedMods.map(m => `
            <div class="mp-mod-item${existingIds.has(m.id) ? ' mp-mod-selected' : ''}" data-id="${escAttr(m.id)}" data-name="${escAttr(m.name || m.id)}">
                <span class="mp-mod-name">${escHtml(m.name || m.id)}</span>
                <button class="btn btn-xs mp-mod-add-btn" ${existingIds.has(m.id) ? 'disabled' : ''}>+</button>
            </div>`).join('')
        : `<div class="plug-mod-empty">Aucun mod disponible</div>`;
}

async function _loadData() {
    try {
        [_modpacks, _allMods, _profiles, _activeProfileId] = await Promise.all([
            invoke('load_modpacks'),
            invoke('get_all_mods'),
            invoke('get_profiles'),
            invoke('get_active_profile_id'),
        ]);
    } catch (e) {
        console.error('[ModpackCreator] load error', e);
    }
}

// ── List view ────────────────────────────────────────────────────────────────

// ── The apply switch (list cards and the quick-apply dialog) ─────────────────────────────────
//
// A real <button role="switch">: it was a div with an onclick, so the keyboard could not reach
// it and a screen reader announced nothing. `.btn-apply` and `.bmm-switch-wrap` stay on it: the
// tutorial points at `btn-apply`, and three built-in themes style `.bmm-switch-wrap`.
function _switchHtml(on: boolean, label: string): string {
    return `<button type="button" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${escAttr(label)}"`
        + ` class="mp-switch bmm-switch-wrap btn-apply${on ? ' active' : ''}"><span class="mp-switch-knob" aria-hidden="true"></span></button>`;
}
function _setSwitch(el: HTMLElement | null, on: boolean): void {
    if (!el) return;
    el.classList.toggle('active', on);
    el.setAttribute('aria-checked', on ? 'true' : 'false');
}

/** The header's primary action. Lives in the view header beside Catalogues and Import, so the
 *  page has one row of actions; the id is the one the tutorial points at. */
function _ensureCreateButton(container): void {
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
    btn.onclick = () => _openEditor(container, null);
    btn.hidden = false;
}
function _hideHeaderActions(hide: boolean): void {
    const actions = document.getElementById('modpack-header-actions');
    if (actions) actions.hidden = hide;
}

function _renderModpackList(container) {
    container.innerHTML = '';
    container.classList.add('mp-page');
    _editingPack = null;
    _hideHeaderActions(false);
    _ensureCreateButton(container);

    if (_modpacks.length === 0) {
        // The empty page says what a pack is and offers the three ways to get one.
        const empty = document.createElement('div');
        empty.className = 'empty-state mp-empty';
        empty.innerHTML = `
            <div class="empty-icon">${uiIcon('package', 32)}</div>
            <p class="empty-title">${escHtml(t('modpack.noMods'))}</p>
            <p class="empty-desc">${escHtml(t('modpack.noModsDesc'))}</p>
            <div class="mp-empty-a">
                <button type="button" class="btn btn-primary" data-mp-go="create">${uiIcon('add', 16)}<span>${escHtml(t('modpack.create'))}</span></button>
                <button type="button" class="btn btn-secondary" data-mp-go="catalog">${uiIcon('store', 16)}<span>${escHtml(t('modpack.cat.open'))}</span></button>
                <button type="button" class="btn btn-secondary" data-mp-go="import">${uiIcon('import', 16)}<span>${escHtml(t('modpack.import'))}</span></button>
            </div>`;
        empty.addEventListener('click', (e) => {
            const go = (e.target as HTMLElement).closest<HTMLElement>('[data-mp-go]')?.dataset.mpGo;
            if (go === 'create') _openEditor(container, null);
            else if (go === 'catalog') document.getElementById('btn-modpack-catalog')?.click();
            else if (go === 'import') document.getElementById('btn-import-modpack')?.click();
        });
        container.appendChild(empty);
        return;
    }

    // Toolbar: search, and how many of how many are shown.
    const bar = document.createElement('div');
    bar.className = 'mp-toolbar';
    bar.innerHTML = `
        <label class="mp-search" id="mp-search-wrap">
            ${uiIcon('search', 14)}
            <input type="search" id="modpack-search" placeholder="${escAttr(t('modpack.searchPh'))}" aria-label="${escAttr(t('modpack.searchPh'))}" spellcheck="false" autocomplete="off">
        </label>
        <span class="mp-count" id="modpack-count-badge" aria-live="polite">${escHtml(t('modpack.countAll', { n: String(_modpacks.length) }))}</span>
    `;
    container.appendChild(bar);
    const searchInput = bar.querySelector('#modpack-search') as HTMLInputElement;
    const countBadge = bar.querySelector('#modpack-count-badge') as HTMLElement;

    const grid = document.createElement('div');
    grid.className = 'modpack-grid';

    const cards = [];

    _modpacks.forEach(pack => {
        const card = document.createElement('div');
        card.className = 'modpack-card';

        const modsCount = pack.mods ? pack.mods.length : 0;
        const lastUpdate = pack.updated_at ? new Date(pack.updated_at).toLocaleDateString() : '';
        const hasDesc = !!(pack.description && String(pack.description).trim());

        const anyEnabled = pack.mods && pack.mods.length > 0 && pack.mods.some(mref => {
            const local = _allMods.find(m => m.id === mref.mod_id || (!!mref.sha256 && m.sha256 === mref.sha256));
            return local && local.enabled;
        });
        const applyLabel = anyEnabled ? (t('modpack.deactivate') || 'Désactiver le modpack') : t('modpack.apply');

        card.innerHTML = `
            <div class="modpack-card-top">
                <div class="modpack-card-icon">${uiIcon('package', 20)}</div>
                <div class="modpack-card-info">
                    <div class="modpack-card-title" title="${escAttr(pack.name)}">${escHtml(pack.name)}</div>
                    <div class="modpack-card-meta">
                        <span class="mp-chip">${escHtml(t('modpack.modsCount', { count: modsCount }))}</span>
                        <span class="mp-chip">${escHtml(pack.multi_profile ? t('modpack.multiProfile') : (pack.game_name || t('modpack.general')))}</span>
                        ${pack.skip_integrity_check ? `<span class="mp-chip mp-chip--warn" title="${escAttr(t('modpack.skipIntegrityDesc'))}">${uiIcon('warning', 12)}${escHtml(t('modpack.noCheckChip'))}</span>` : ''}
                    </div>
                </div>
                <div class="mp-apply" data-tasky="${escAttr(t('modpack.quickApplyDesc') || 'Cliquez pour activer ou désactiver ce pack.')}" data-tasky-icon="zap" data-tasky-literal="1">
                    ${_switchHtml(!!anyEnabled, `${applyLabel}: ${pack.name}`)}
                </div>
            </div>
            <p class="modpack-card-desc${hasDesc ? '' : ' is-empty'}">${escHtml(hasDesc ? pack.description : t('modpack.noDesc'))}</p>
            <div class="modpack-card-ids">${copyIdButtons('modpack', pack.id, { compact: true })}</div>
            <div class="modpack-card-foot">
                <span class="modpack-card-date">${lastUpdate ? escHtml(t('modpack.updatedAt', { date: lastUpdate })) : ''}</span>
                <div class="modpack-card-actions">
                    <button type="button" class="btn btn-icon btn-ghost btn-sm btn-export" title="${escAttr(t('modpack.exportBtn'))}" aria-label="${escAttr(t('modpack.exportBtn'))}">${uiIcon('export', 16)}</button>
                    <button type="button" class="btn btn-icon btn-ghost btn-sm btn-edit" title="${escAttr(t('modpack.edit'))}" aria-label="${escAttr(t('modpack.edit'))}">${uiIcon('edit', 16)}</button>
                    <button type="button" class="btn btn-icon btn-ghost btn-sm btn-delete mp-danger" title="${escAttr(t('modpack.delete'))}" aria-label="${escAttr(t('modpack.delete'))}">${uiIcon('delete', 16)}</button>
                </div>
            </div>
        `;

        wireCopyIds(card, toast);
        card.querySelector('.btn-edit').onclick = (e) => { e.stopPropagation(); _openEditor(container, pack); };
        card.querySelector('.btn-apply').onclick = (e) => { e.stopPropagation(); _applyModpack(container, pack); };
        card.querySelector('.btn-export').onclick = (e) => { e.stopPropagation(); _exportModpack(pack); };
        card.querySelector('.btn-delete').onclick = (e) => { e.stopPropagation(); _deleteModpack(container, pack); };
        // The card opens the editor on a click anywhere that is not a control (the copy-id
        // chips and the buttons above stop the event themselves or are matched here).
        card.onclick = (e) => {
            if ((e.target as HTMLElement).closest('button, a, input, [data-copy-id]')) return;
            _openEditor(container, pack);
        };

        grid.appendChild(card);
        cards.push({ card, name: `${pack.name} ${pack.game_name || ''} ${pack.description || ''}`.toLowerCase() });
    });

    container.appendChild(grid);

    const noHit = document.createElement('div');
    noHit.className = 'empty-state mp-nohit';
    noHit.hidden = true;
    container.appendChild(noHit);

    searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase().trim();
        let visible = 0;
        cards.forEach(({ card, name }) => {
            const hit = !q || name.includes(q);
            card.hidden = !hit;
            if (hit) visible++;
        });
        countBadge.textContent = q
            ? t('modpack.countOf', { n: String(visible), total: String(cards.length) })
            : t('modpack.countAll', { n: String(cards.length) });
        noHit.hidden = visible > 0;
        if (!visible) {
            noHit.innerHTML = `<div class="empty-icon">${uiIcon('search', 24)}</div>
                <p class="empty-title">${escHtml(t('modpack.noMatch', { q: searchInput.value.trim() }))}</p>
                <div class="mp-empty-a"><button type="button" class="btn btn-secondary btn-sm" data-mp-clear>${escHtml(t('common.clear'))}</button></div>`;
            noHit.querySelector('[data-mp-clear]')?.addEventListener('click', () => {
                searchInput.value = '';
                searchInput.dispatchEvent(new Event('input'));
                searchInput.focus();
            });
        }
    });
}

// ── Editor ───────────────────────────────────────────────────────────────────

async function _openEditor(container, pack) {
    _editingPack = pack ? JSON.parse(JSON.stringify(pack)) : {
        id: '', name: '', description: null, created_at: '', updated_at: '',
        multi_profile: true, dependency_mode: 'manual', mods: [], sr_link: null, game_name: null
    };
    _packMods = _editingPack.mods ? [..._editingPack.mods] : [];

    container.innerHTML = '';

    // The editor replaces the page body, so the page header's actions (Catalogues, Import,
    // Create) step aside: two rows of buttons acting on different things read as one.
    _hideHeaderActions(true);
    const header = document.createElement('div');
    header.className = 'mp-ed-head';
    header.innerHTML = `
        <div class="mp-ed-titles">
            <nav class="mp-crumbs" aria-label="${escAttr(t('modpack.title'))}">
                <button type="button" class="mp-crumb" id="bc-home">${uiIcon('arrow-left', 14)}<span>${escHtml(t('modpack.title'))}</span></button>
                ${uiIcon('chevron-right', 12)}
                <span class="mp-crumb-now">${escHtml(pack ? t('modpack.edit') : t('modpack.create'))}</span>
            </nav>
            <h2 class="mp-ed-title">${pack ? escHtml(pack.name) : escHtml(t('modpack.newPack'))}</h2>
        </div>
        <div class="mp-ed-actions">
            <button type="button" class="btn btn-secondary" id="editor-cancel">${escHtml(t('common.cancel'))}</button>
            <button type="button" class="btn btn-primary" id="editor-save">
                ${uiIcon('save', 16)}
                <span>${escHtml(t('modpack.save'))}</span>
            </button>
        </div>
    `;
    container.appendChild(header);

    const goBack = async () => { await _loadData(); _renderModpackList(container); };
    header.querySelector('#bc-home').onclick = goBack;
    header.querySelector('#editor-cancel').onclick = goBack;

    // Split Layout
    const layout = document.createElement('div');
    layout.className = 'modpack-editor-layout';
    container.appendChild(layout);

    // LEFT: Meta
    const leftCol = document.createElement('div');
    leftCol.className = 'editor-section-card';
    leftCol.innerHTML = `
        <div class="editor-section-title">
            ${uiIcon('file-text', 14)}
            <span>${escHtml(t('modpack.generalInfo'))}</span>
        </div>
    `;

    const metaForm = document.createElement('div');
    metaForm.className = 'mp-form';

    // Escaped: a modpack can be imported from a file or a deeplink, so its name/description are
    // not always the user's own typing. A raw `"` closes the value attribute and a raw
    // `</textarea>` closes the field — both let markup in (CWE-79).
    metaForm.appendChild(_formField(t('modpack.name'), `<input id="mp-name" type="text" class="form-input" placeholder="${escAttr(t('modpack.namePlaceholder'))}" value="${escAttr(_editingPack.name || '')}">`));
    metaForm.appendChild(_formField(t('modpack.description'), `<textarea id="mp-desc" class="form-input" rows="4">${escHtml(_editingPack.description || '')}</textarea>`));
    metaForm.appendChild(_formField(t('modpack.game'), `<input id="mp-game" type="text" class="form-input" placeholder="${escAttr(t('modpack.gamePlaceholder') || 'e.g. DCS World')}" value="${escAttr(_editingPack.game_name || '')}">`));

    // Two options that change what applying the pack does: a check row each, the risky one
    // in the warning tone (classes in modpack.css).
    const multiRow = document.createElement('label');
    multiRow.className = 'mp-opt';
    const multiCb = document.createElement('input');
    multiCb.type = 'checkbox';
    multiCb.id = 'mp-multi';
    multiCb.checked = _editingPack.multi_profile;
    multiCb.onchange = () => {
        _editingPack.multi_profile = multiCb.checked;
    };
    const multiInfo = document.createElement('span');
    multiInfo.className = 'mp-opt-txt';
    multiInfo.innerHTML = `<b>${escHtml(t('modpack.multiProfile'))}</b><span>${escHtml(t('modpack.multiProfileDesc'))}</span>`;
    multiRow.appendChild(multiCb);
    multiRow.appendChild(multiInfo);
    metaForm.appendChild(multiRow);

    const skipRow = document.createElement('label');
    skipRow.className = 'mp-opt mp-opt--warn';
    const skipCb = document.createElement('input');
    skipCb.type = 'checkbox';
    skipCb.id = 'mp-skip-integrity';
    skipCb.checked = _editingPack.skip_integrity_check;
    skipCb.onchange = () => {
        _editingPack.skip_integrity_check = skipCb.checked;
    };
    const skipInfo = document.createElement('span');
    skipInfo.className = 'mp-opt-txt';
    skipInfo.innerHTML = `<b>${escHtml(t('modpack.skipIntegrity'))}</b><span>${escHtml(t('modpack.skipIntegrityDesc'))}</span>`;
    skipRow.appendChild(skipCb);
    skipRow.appendChild(skipInfo);
    metaForm.appendChild(skipRow);

    metaForm.appendChild(_formField(t('modpack.depMode'), `
        <select id="mp-depmode" class="form-input">
            <option value="all" ${_editingPack.dependency_mode === 'all' ? 'selected' : ''}>${t('modpack.depModeAll')}</option>
            <option value="none" ${_editingPack.dependency_mode === 'none' ? 'selected' : ''}>${t('modpack.depModeNone')}</option>
            <option value="manual" ${_editingPack.dependency_mode === 'manual' ? 'selected' : ''}>${t('modpack.depModeManual')}</option>
        </select>
    `));

    // Where the pack's mods go in the profile's activation order when it is applied
    // (commands/order_share.rs). Empty = the setting "Bulk enable" in Settings.
    const om = _editingPack.order_mode || '';
    metaForm.appendChild(_formField(t('modpack.orderMode'), `
        <select id="mp-ordermode" class="form-input" title="${escAttr(t('modpack.orderModeTip'))}">
            <option value="" ${om === '' ? 'selected' : ''}>${escHtml(t('order.mode.default'))}</option>
            <option value="top" ${om === 'top' ? 'selected' : ''}>${escHtml(t('order.mode.top'))}</option>
            <option value="bottom" ${om === 'bottom' ? 'selected' : ''}>${escHtml(t('order.mode.bottom'))}</option>
            <option value="keep" ${om === 'keep' ? 'selected' : ''}>${escHtml(t('order.mode.keep'))}</option>
        </select>
    `));

    metaForm.appendChild(_formField(t('modpack.srLink'), `<input id="mp-srlink" type="text" class="form-input" placeholder="${escAttr(t('modpack.srLinkPlaceholder'))}" value="${escAttr(_editingPack.sr_link || '')}">`));

    leftCol.appendChild(metaForm);
    layout.appendChild(leftCol);

    // RIGHT: Mods
    const rightCol = document.createElement('div');
    rightCol.className = 'editor-section-card mp-ed-mods';
    rightCol.innerHTML = `
        <div class="mp-ed-mods-h">
            <div class="editor-section-title">
                ${uiIcon('folders', 14)}
                <span>${escHtml(t('modpack.modsManagement'))}</span>
                <span class="mp-count" id="mp-modcount">${_packMods.length}</span>
            </div>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-add-mods-pack">
                ${uiIcon('add', 14)}
                <span>${escHtml(t('modpack.addMods'))}</span>
            </button>
        </div>
    `;

    const modListEl = document.createElement('div');
    modListEl.id = 'mp-modlist';
    modListEl.className = 'mp-modlist';
    rightCol.appendChild(modListEl);
    _renderPackModList(modListEl);

    rightCol.querySelector('#btn-add-mods-pack').onclick = () => _openMultiSelectModal(modListEl);

    layout.appendChild(rightCol);

    // Save Logic
    header.querySelector('#editor-save').onclick = async () => {
        const name = document.getElementById('mp-name')?.value.trim();
        if (!name) return toast(t('modpack.errNoName'), 'warning');
        if (_packMods.length === 0) return toast(t('modpack.errNoMods'), 'warning');

        const payload = {
            ..._editingPack,
            name,
            description: document.getElementById('mp-desc')?.value.trim() || null,
            game_name: document.getElementById('mp-game')?.value.trim() || null,
            multi_profile: document.getElementById('mp-multi')?.checked || false,
            skip_integrity_check: document.getElementById('mp-skip-integrity')?.checked || false,
            dependency_mode: document.getElementById('mp-depmode')?.value || 'manual',
            sr_link: document.getElementById('mp-srlink')?.value.trim() || null,
            order_mode: (document.getElementById('mp-ordermode') as HTMLSelectElement | null)?.value || null,
            mods: _packMods,
        };

        try {
            const btn = header.querySelector('#editor-save');
            btn.disabled = true;
            btn.textContent = t('modpack.saving');
            await invoke('save_modpack', { modpack: payload });
            toast(t('modpack.savedOk') || 'Modpack sauvegardé !', 'success');
            dispatchBmmAction(BMM_ACTIONS.MODPACK_CREATED, { name: payload.name });
            await _loadData();
            _renderModpackList(container);

            // Notify other components (like Repo page)
            window.dispatchEvent(new CustomEvent('bmm://modpacks-updated'));
        } catch (err) {
            toast(String(err), 'error');
            header.querySelector('#editor-save').disabled = false;
            header.querySelector('#editor-save').textContent = t('modpack.save');
        }
    };
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

function _renderPackModList(listEl) {
    listEl.innerHTML = '';
    const countEl = document.getElementById('mp-modcount');
    if (countEl) countEl.textContent = String(_packMods.length);
    if (_packMods.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state mp-modlist-empty';
        empty.innerHTML = `
            <div class="empty-icon">${uiIcon('folders', 24)}</div>
            <p class="empty-title">${escHtml(t('modpack.editorNoMods'))}</p>
            <p class="empty-desc">${escHtml(t('modpack.editorNoModsHint'))}</p>
            <div class="mp-empty-a"><button type="button" class="btn btn-primary btn-sm" data-mp-add>${uiIcon('add', 14)}<span>${escHtml(t('modpack.addMods'))}</span></button></div>
        `;
        empty.querySelector('[data-mp-add]')?.addEventListener('click', () => document.getElementById('btn-add-mods-pack')?.click());
        listEl.appendChild(empty);
        return;
    }

    // The pack's order is its activation order: applied, these mods go on top of the
    // profile's order in this sequence (the last one wins a file they share).
    _ensureOrderCss();
    const hint = document.createElement('p');
    hint.className = 'mp-order-hint';
    hint.textContent = t('modpack.orderHint');
    listEl.appendChild(hint);

    _packMods.forEach((pm, idx) => {
        const card = document.createElement('div');
        card.className = 'mod-item-card';

        card.innerHTML = `
            <div class="mp-mi-top">
                <span class="mp-order-btns">
                    <button type="button" class="btn btn-icon btn-ghost mp-up" title="${escHtml(t('order.moveUp'))}" aria-label="${escHtml(t('order.moveUp'))}" ${idx === 0 ? 'disabled' : ''}>${uiIcon('chevron-up', 12)}</button>
                    <button type="button" class="btn btn-icon btn-ghost mp-down" title="${escHtml(t('order.moveDown'))}" aria-label="${escHtml(t('order.moveDown'))}" ${idx === _packMods.length - 1 ? 'disabled' : ''}>${uiIcon('chevron-down', 12)}</button>
                </span>
                <span class="mp-order-pos" title="${escHtml(t('order.position').replace('{n}', String(idx + 1)))}">${idx + 1}</span>
                <div class="mp-mi-main">
                    <div class="mp-mi-name" title="${escAttr(pm.mod_name)}">${escHtml(pm.mod_name)}</div>
                    <div class="mp-mi-meta">
                        ${pm.mod_version ? `<span>v${escHtml(pm.mod_version)}</span>` : ''}
                        <span>${escHtml(pm.profile_name || t('modpack.global') || 'Global')}</span>
                    </div>
                </div>
                <button type="button" class="btn btn-icon btn-ghost btn-sm btn-remove mp-danger" title="${escAttr(t('modpack.removeMod'))}" aria-label="${escAttr(t('modpack.removeMod'))}: ${escAttr(pm.mod_name)}">${uiIcon('delete', 14)}</button>
            </div>

            <details class="mp-mi-more"${pm.download_link || pm.download_fallback || pm.include_dependencies ? ' open' : ''}>
            <summary class="mp-mi-more-h">${uiIcon('chevron-right', 12)}<span>${escHtml(t('modpack.sourcesFold'))}</span></summary>
            <div class="mp-mi-grid">
                <label class="mp-field">
                    <span class="form-label">${escHtml(t('modpack.modDownloadLink'))}</span>
                    <input type="text" class="form-input dl-input" placeholder="https://..." value="${escAttr(pm.download_link || '')}">
                </label>
                <label class="mp-field">
                    <span class="form-label">${escHtml(t('modpack.modFallback'))}</span>
                    <input type="text" class="form-input fb-input" placeholder="${escAttr(t('modpack.modFallbackPlaceholder') || 'Nexus, Drive, etc.')}" value="${escAttr(pm.download_fallback || '')}">
                </label>
            </div>

            <div class="mp-mi-opts">
                <div class="mp-mi-row">
                    <label class="checkbox-container mp-mi-check">
                        <input type="checkbox" class="deps-cb" ${pm.include_dependencies ? 'checked' : ''}>
                        <span>${escHtml(t('modpack.modDeps'))}</span>
                    </label>
                    <label class="mp-mi-sel">
                        <span class="form-label">${escHtml(t('modpack.modFallbackType'))}</span>
                        <select class="form-input select-sm fb-type-select">
                            <option value="direct" ${pm.fallback_type === 'direct' ? 'selected' : ''}>${t('modpack.fallbackDirect') || 'Direct Link'}</option>
                            <option value="sr" ${pm.fallback_type === 'sr' ? 'selected' : ''}>${t('modpack.fallbackServerRepo') || 'Server Repo'}</option>
                        </select>
                    </label>
                </div>

                <div class="deps-list"></div>
            </div>
            </details>
        `;

        card.querySelector('.btn-remove').onclick = () => {
            _packMods.splice(idx, 1);
            _renderPackModList(listEl);
        };
        // Reorder: the pack's list IS the order its mods are applied in.
        const swap = (j: number) => {
            if (j < 0 || j >= _packMods.length) return;
            [_packMods[idx], _packMods[j]] = [_packMods[j], _packMods[idx]];
            _renderPackModList(listEl);
            (listEl.querySelectorAll('.mod-item-card')[j]?.querySelector(j < idx ? '.mp-up' : '.mp-down') as HTMLElement | null)?.focus();
        };
        card.querySelector('.mp-up').onclick = () => swap(idx - 1);
        card.querySelector('.mp-down').onclick = () => swap(idx + 1);

        const dlIn = card.querySelector('.dl-input');
        dlIn.oninput = () => { _packMods[idx].download_link = dlIn.value.trim(); };

        const fbIn = card.querySelector('.fb-input');
        fbIn.oninput = () => { _packMods[idx].download_fallback = fbIn.value.trim(); };

        const depCb = card.querySelector('.deps-cb');
        depCb.onchange = () => { _packMods[idx].include_dependencies = depCb.checked; };

        const fbTypeSelect = card.querySelector('.fb-type-select');
        fbTypeSelect.onchange = () => { _packMods[idx].fallback_type = fbTypeSelect.value; };

        // Pre-show dependencies if mod is found locally
        const localMod = _allMods.find(m => m.id === pm.mod_id);
        if (localMod && localMod.dependencies && localMod.dependencies.length > 0) {
            const dlist = card.querySelector('.deps-list');
            localMod.dependencies.forEach(did => {
                const tag = document.createElement('span');
                tag.className = 'mp-chip';
                const dmod = _allMods.find(m => m.id === did);
                tag.textContent = dmod ? dmod.name : did;
                dlist.appendChild(tag);
            });
        }

        listEl.appendChild(card);
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _formField(label, inputHtml) {
    const wrap = document.createElement('div');
    wrap.className = 'mp-field';
    wrap.innerHTML = `
        <div class="form-label">${escHtml(label)}</div>
        ${inputHtml}
    `;
    return wrap;
}

function _makeIconBtn(svgHtml, bgColor, color) {
    const btn = document.createElement('button');
    btn.style.cssText = `
        width:26px;height:26px;border-radius:6px;border:1px solid ${bgColor};
        background:${bgColor};color:${color};cursor:pointer;
        display:flex;align-items:center;justify-content:center;flex-shrink:0;
        transition:all 0.15s;
    `;
    btn.innerHTML = svgHtml;
    btn.addEventListener('mouseenter', () => btn.style.opacity = '0.8');
    btn.addEventListener('mouseleave', () => btn.style.opacity = '1');
    return btn;
}

function _openMultiSelectModal(listEl) {
    // The house shell: .modal-overlay > .modal.modal--md.modal--tall, a header with the
    // count as its subtitle, the search as a toolbar band, a scrolling list, the footer.
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';

    const content = document.createElement('div');
    content.className = 'modal bms modal--md modal--tall';
    content.setAttribute('role', 'dialog');
    content.setAttribute('aria-modal', 'true');

    // Header + search band, written straight into the card; `header` stays the name the
    // queries below use for "where the search and the count live".
    const header = content;
    content.innerHTML = `
        <div class="modal-header">
            <div class="bms-icon" aria-hidden="true">${uiIcon('folders', 18)}</div>
            <div class="bms-titles">
                <h2 class="modal-title">${escHtml(t('modpack.selectMods'))}</h2>
                <p class="bms-sub" id="ms-count-label"></p>
            </div>
            <button type="button" class="modal-close" id="ms-close" aria-label="${escAttr(t('common.close') || 'Close')}">${MODAL_CLOSE_SVG}</button>
        </div>
        <div class="modal-toolbar">
            <div class="mp-ms-search" id="ms-search-wrap">
                ${uiIcon('search', 14)}
                <input type="text" id="ms-search" placeholder="${escAttr(t('common.search') || 'Search…')}">
            </div>
        </div>
    `;

    // Body
    const body = document.createElement('div');
    body.className = 'modal-body';
    body.style.cssText = 'gap:5px;';

    // Filter available mods
    // Show all mods, but mark those already in pack
    let availableMods = [..._allMods];

    // If multi-profile is OFF, only show mods from the current active profile
    if (!_editingPack.multi_profile) {
        const targetId = _activeProfileId || window.cachedActiveProfileId;
        const activeProfile = _profiles.find(p => String(p.id) === String(targetId));
        console.log('[Modpack] Active Profile detected:', activeProfile?.name, 'ID:', targetId);

        if (activeProfile) {
            availableMods = availableMods.filter(m => {
                // Match by profile_id or by directory path (path is very reliable in BMM)
                const matchesId = m.profile_id && String(m.profile_id) === String(activeProfile.id);
                const matchesPath = m.mod_folder_path && m.mod_folder_path.toLowerCase().startsWith(activeProfile.mods_path.toLowerCase());
                return matchesId || matchesPath;
            });
            console.log('[Modpack] Available after profile filter:', availableMods.length);
        } else {
            console.warn('[Modpack] No active profile found, showing all mods.');
        }
    }

    const checkboxes = [];
    const rows = [];

    if (availableMods.length === 0) {
        body.innerHTML = `<div style="text-align:center;color:var(--text-muted);font-size:13px;padding:60px 20px; display:flex; flex-direction:column; align-items:center; gap:12px;">
            ${uiIcon('folders', 48, { style: 'opacity:0.3; margin-bottom: 4px;' })}
            <span>${t('modpack.noMoreMods')}</span>
        </div>`;
    }

    availableMods.forEach(m => {
        const prof = _profiles.find(p => m.mod_folder_path && (m.mod_folder_path.toString().includes(p.mods_path?.toString()) || p.mods_path?.toString().includes(m.mod_folder_path?.toString())));
        const depCount = m.dependencies ? m.dependencies.length : 0;
        const searchLabel = (m.name + (prof ? prof.name : '')).toLowerCase();

        const alreadyInPack = _packMods.some(pm => String(pm.mod_id) === String(m.id));

        const row = document.createElement('label');
        row.style.cssText = `display:flex; align-items:center; gap:14px; padding:10px 12px; border-radius:12px; cursor:pointer; transition:all 0.15s; border:1px solid transparent; background:${alreadyInPack ? 'color-mix(in srgb, var(--bmm-cyan) 8%, transparent)' : 'var(--bmm-s02)'};`;
        if (alreadyInPack) row.style.borderColor = 'color-mix(in srgb, var(--bmm-cyan) 25%, transparent)';
        if (_isAddingMods) {
            row.style.pointerEvents = 'none';
            row.style.opacity = '0.7';
        }

        row.addEventListener('mouseenter', () => {
            if (!row.querySelector('input').checked) {
                row.style.background = 'color-mix(in srgb, var(--bmm-cyan) 4%, transparent)';
                row.style.borderColor = 'color-mix(in srgb, var(--bmm-cyan) 12%, transparent)';
            }
        });
        row.addEventListener('mouseleave', () => {
            if (!row.querySelector('input').checked) {
                row.style.background = 'var(--bmm-s02)';
                row.style.borderColor = 'transparent';
            } else if (alreadyInPack) {
                row.style.background = 'color-mix(in srgb, var(--bmm-cyan) 8%, transparent)';
                row.style.borderColor = 'color-mix(in srgb, var(--bmm-cyan) 25%, transparent)';
            }
        });

        const switchWrap = document.createElement('label');
        switchWrap.className = 'bmm-switch';
        switchWrap.style.cssText = 'flex-shrink:0;';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = m.id;
        cb.checked = alreadyInPack;
        cb.dataset.profId = prof?.id || '';

        const track = document.createElement('span');
        track.className = 'bmm-switch-track';
        const thumb = document.createElement('span');
        thumb.className = 'bmm-switch-thumb';
        track.appendChild(thumb);

        switchWrap.appendChild(cb);
        switchWrap.appendChild(track);

        cb.addEventListener('change', () => {
            row.style.background = cb.checked ? 'color-mix(in srgb, var(--bmm-cyan) 8%, transparent)' : 'var(--bmm-s02)';
            row.style.borderColor = cb.checked ? 'color-mix(in srgb, var(--bmm-cyan) 25%, transparent)' : 'transparent';
            updateSelCount();
        });

        const info = document.createElement('div');
        info.style.cssText = 'flex:1; min-width:0;';
        info.innerHTML = `
            <div style="font-size:13px; font-weight:600; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escHtml(m.name)}</div>
            <div style="display:flex; align-items:center; gap:5px; margin-top:3px; flex-wrap:wrap;">
                <span style="font-size:10px; color:var(--text-muted);">v${escHtml(m.version || '?')}</span>
                ${prof ? `<span style="font-size:9px; font-weight:700; color:var(--accent); background:color-mix(in srgb, var(--bmm-cyan) 10%, transparent); border:1px solid color-mix(in srgb, var(--bmm-cyan) 20%, transparent); border-radius:4px; padding:1px 6px;">${escHtml(prof.name)}</span>` : ''}
                ${depCount > 0 ? `<span style="font-size:9px; color:var(--text-muted); background:var(--bmm-s05); border:1px solid var(--bmm-s06); border-radius:4px; padding:1px 6px;">&rarr; ${depCount} ${t('modpack.dependenciesShort') || 'dep.'}</span>` : ''}
                ${alreadyInPack ? `<span style="font-size:8px; font-weight:800; color:var(--success); background:color-mix(in srgb, var(--bmm-success) 10%, transparent); padding:1px 4px; border-radius:3px; text-transform:uppercase;">${t('modpack.alreadyAdded') || 'DÉJÀ AJOUTÉ'}</span>` : ''}
            </div>
        `;

        row.appendChild(switchWrap);
        row.appendChild(info);
        body.appendChild(row);
        checkboxes.push(cb);
        rows.push({ row, searchLabel });
    });

    // Footer
    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    footer.innerHTML = `
        <div class="modal-footer-start">
            <span class="modal-footer-note" id="ms-footer-count"></span>
            <label class="modal-footer-note" style="cursor:pointer;" data-tooltip="${t('modpack.autoUpdateSrcTip') || 'For mods linked to a repo, set that repo as a Server Repo fallback link.'}">
                <input type="checkbox" id="ms-auto-update-src" checked>
                <span>${t('modpack.autoUpdateSrc') || 'Auto-add update repo as fallback'}</span>
            </label>
        </div>
            <button class="btn btn-ghost" id="ms-cancel">${t('common.cancel')}</button>
            <button class="btn btn-primary" id="ms-confirm" style="opacity:0.5; transition:opacity 0.2s;">
                ${uiIcon('check', 14, { style: 'margin-right:6px;' })}
                ${t('modpack.addMod')}
            </button>
    `;

    const countLabel = header.querySelector('#ms-count-label');
    const footerCount = footer.querySelector('#ms-footer-count');
    const confirmBtn = footer.querySelector('#ms-confirm');

    function updateSelCount() {
        if (_isAddingMods) {
            countLabel.textContent = _currentAddingModName ? `${t('modpack.adding')}: ${_currentAddingModName}` : t('modpack.addingInProgress');
            footerCount.textContent = '';
            confirmBtn.style.opacity = '0.5';
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = `${uiIcon('loader', 14, { style: 'margin-right:8px; animation: bmm-loading-spin 1s linear infinite;' })} ${t('common.loading')}`;
            return;
        }

        // Restore buttons if we just finished
        confirmBtn.innerHTML = `${uiIcon('check', 14, { style: 'margin-right:6px;' })} ${t('modpack.addMod')}`;
        footer.querySelector('#ms-cancel').disabled = false;
        header.querySelector('#ms-close').disabled = false;

        const selCount = checkboxes.filter(c => c.checked).length;
        const total = availableMods.length;
        countLabel.textContent = `${total} ${t('modpack.modsAvailable')}`;
        footerCount.textContent = selCount > 0 ? `${selCount} ${t('modpack.modsSelected')}` : '';
        confirmBtn.style.opacity = selCount === 0 ? '0.5' : '1';
        confirmBtn.disabled = selCount === 0;
    }
    _currentSelectionModalUpdateFn = updateSelCount;
    updateSelCount();

    // Search
    header.querySelector('#ms-search').addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        rows.forEach(({ row, searchLabel }) => {
            row.style.display = !q || searchLabel.includes(q) ? 'flex' : 'none';
        });
    });
    const close = () => {
        _currentSelectionModalUpdateFn = null;
        _currentSelectionModalOverlay = null;
        overlay.remove();
    };

    // Cancel: if mods are still being added, abort the in-progress run; otherwise close.
    const cancelOrAbort = () => {
        if (_isAddingMods) {
            _addCancelled = true;
            toast(t('modpack.addCancelled') || 'Stopping — finishing the current mod…', 'info');
            return;
        }
        close();
    };
    footer.querySelector('#ms-cancel').addEventListener('click', cancelOrAbort);
    header.querySelector('#ms-close').addEventListener('click', cancelOrAbort);

    confirmBtn.addEventListener('click', async () => {
        const checked = checkboxes.filter(cb => cb.checked);
        if (checked.length === 0) return;

        _isAddingMods = true;
        _addCancelled = false;
        const autoUpdateSrc = !!(footer.querySelector('#ms-auto-update-src') as HTMLInputElement)?.checked;
        updateSelCount(); // Show loading state in current modal

        // No more prevent-close here as per user request

        const depMode = document.getElementById('mp-depmode')?.value || 'manual';
        const includeDeps = depMode === 'all';
        let errors = 0;

        // Clear current pack mods and rebuild from selection to ensure sync and uniqueness
        // Actually, we should only add the new ones, or rebuild the whole list.
        // The user wants uniqueness, so we filter out what's already there before pushing.

        let cancelledDuringAdd = false;
        for (const cb of checked) {
            // Stop early if the user hit Cancel during the run.
            if (_addCancelled) { cancelledDuringAdd = true; break; }
            // Uniqueness check: avoid adding if already in _packMods
            const exists = _packMods.some(pm => String(pm.mod_id) === String(cb.value));
            if (exists) continue;

            try {
                const targetMod = availableMods.find(m => String(m.id) === String(cb.value));
                _currentAddingModName = targetMod ? targetMod.name : '';
                if (_currentSelectionModalUpdateFn) _currentSelectionModalUpdateFn();

                // If the mod is linked to a repo, optionally seed that repo as a
                // Server Repo fallback download link so it stays updatable.
                let fallbackLink = null, fallbackType = 'direct';
                if (autoUpdateSrc && targetMod) {
                    const repo = targetMod.source_repo || targetMod.update_url
                        || (Array.isArray(targetMod.update_sources) && targetMod.update_sources[0]?.repo_url) || '';
                    if (repo) { fallbackLink = repo; fallbackType = 'sr'; }
                }

                const ref = await invoke('build_modpack_mod_ref', {
                    modId: cb.value,
                    profileId: cb.dataset.profId || null,
                    includeDependencies: includeDeps,
                    downloadLink: null,
                    fallbackLink,
                    fallbackType,
                });
                _packMods.push(ref);
            } catch (e) {
                console.error(e);
                errors++;
            }
        }

        // Remove mods that were UNCHECKED in the modal — but only when the run
        // completed; on cancel we keep whatever was already added and don't prune.
        if (!cancelledDuringAdd) {
            const selectedIds = checked.map(cb => String(cb.value));
            _packMods = _packMods.filter(pm => selectedIds.includes(String(pm.mod_id)));
        }

        if (cancelledDuringAdd) toast(t('modpack.addStopped') || 'Adding stopped', 'info');
        if (errors > 0) toast(t('modpack.addModErrors')?.replace('{count}', String(errors)) || `${errors} mods ont échoué.`, 'warning');
        _renderPackModList(listEl);

        _isAddingMods = false;
        _currentAddingModName = '';

        if (_currentSelectionModalUpdateFn) {
            _currentSelectionModalUpdateFn();
        }
        // Close the modal if it exists (even if it was reopened)
        if (_currentSelectionModalOverlay && document.body.contains(_currentSelectionModalOverlay)) {
            const closeBtn = _currentSelectionModalOverlay.querySelector('#ms-close') || _currentSelectionModalOverlay.querySelector('#ms-cancel');
            if (closeBtn) closeBtn.click();
        }
    });

    content.appendChild(body);
    content.appendChild(footer);
    overlay.appendChild(content);

    // Close on click outside (backdrop)
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) close();
    });

    const appOuter = document.getElementById('app-window-outer') || document.body;
    appOuter.appendChild(overlay);
    raiseAboveAll(overlay);
    _currentSelectionModalOverlay = overlay;

    requestAnimationFrame(() => header.querySelector('#ms-search').focus());
}


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
        toast((window.t ? window.t('common.error') : 'No active profile'), "error");
        return;
    }

    // The house shell (.modal-overlay > .modal.modal--md): header with a warning tile, the
    // list and the progress in the body, the actions in the footer.
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'modal-overlay open';

    const content = document.createElement('div');
    content.className = 'modal bms modal--md';
    content.setAttribute('role', 'dialog');
    content.setAttribute('aria-modal', 'true');

    // Build lists
    let modsHtml = '';
    const problematicMods = [...report.missingMods, ...report.corruptedMods];

    let canRepairAny = false;

    problematicMods.forEach(m => {
        const isMissing = report.missingMods.some(x => x.mod_id === m.mod_id);
        const statusText = isMissing ? t('modpack.repair.statusMissing') || "Manquant" : t('modpack.repair.statusCorrupted') || "Corrompu";
        const statusColor = isMissing ? "var(--danger)" : "var(--bmm-warning)";
        const fallbackType = m.fallback_type || "direct";

        // Vérification de la possibilité de réparation :
        // - Corrompu => peut toujours être réparé localement (files déplacés), pas besoin de lien
        // - Manquant  => nécessite un lien de téléchargement
        const hasLink = fallbackType === "sr" ? !!pack.sr_link : !!(m.download_fallback || m.download_link);
        const isCorrupted = !isMissing; // Corrupted = can be fixed locally (moved file)
        if (hasLink || isCorrupted) canRepairAny = true;

        const sourceLabel = hasLink
            ? (fallbackType === "sr" ? "ServerRepo" : t('modpack.repair.directLink') || "Lien Direct")
            : isCorrupted
                ? `<span style="color:var(--bmm-warning); font-weight:800;">${t('modpack.repair.localRecovery') || 'Récupération Locale'}</span>`
                : `<span style="color:var(--danger); font-weight:800;">${t('modpack.repair.linkMissing') || 'Lien Manquant'}</span>`;

        modsHtml += `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:12px; background:var(--bmm-s03); border-radius:12px; border:1px solid var(--bmm-s05); margin-bottom:8px;">
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <div style="font-size:13px; font-weight:600; color:var(--text-primary);">${escHtml(m.mod_name)}</div>
                    <div style="font-size:10px; color:var(--text-muted);">${escHtml(m.mod_version)}</div>
                </div>
                <div style="text-align:right; display:flex; flex-direction:column; gap:4px;">
                    <div style="font-size:11px; font-weight:800; color:${statusColor}; text-transform:uppercase; letter-spacing:0.5px;">${statusText}</div>
                    <div style="font-size:10px; color:var(--text-muted); opacity:0.6;">Source: ${sourceLabel}</div>
                </div>
            </div>
        `;
    });

    content.innerHTML = `
        <div class="modal-header">
            <div class="bms-icon bms-icon--warn" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
            </div>
            <div class="bms-titles">
                <h2 class="modal-title">${t('modpack.repair.title') || 'Repair needed'}</h2>
                <p class="bms-sub">${t('modpack.repair.subtitle') || 'Some mods are missing or corrupted.'}</p>
            </div>
            <button type="button" class="modal-close" id="repair-x" aria-label="${escAttr(t('common.close') || 'Close')}">${MODAL_CLOSE_SVG}</button>
        </div>
        <div class="modal-body" style="display:block">
        <div class="custom-scrollbar" style="display:flex; flex-direction:column;">
            ${modsHtml}
        </div>

        <div id="repair-progress-container" style="display:none; flex-direction:column; gap:8px; margin-top:16px; padding:16px; background:var(--bmm-s03); border-radius:12px; border:1px solid var(--bmm-border);">
            <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">
                <span id="repair-status-text">${t('modpack.repair.preparing') || 'Préparation...'}</span>
                <span id="repair-status-pct" style="color:var(--bmm-warning);">0%</span>
            </div>
            <div style="width:100%; height:6px; background:var(--bmm-s08); border-radius:10px; overflow:hidden;">
                <div id="repair-progress-bar" style="height:100%; background:var(--bmm-warning); width:0%; transition:width 0.3s ease; box-shadow:0 0 10px color-mix(in srgb, var(--bmm-warning) 50%, transparent);"></div>
            </div>
        </div>

        </div>
        <div class="modal-footer" id="repair-actions">
            <button id="repair-cancel" class="btn btn-ghost">${t('modpack.repair.cancel') || 'Cancel'}</button>
            <button id="repair-start" class="btn btn-warning" ${!canRepairAny ? 'disabled' : ''}>
                ${canRepairAny ? (t('modpack.repair.startBtn') || 'Réparer et Appliquer') : (t('modpack.repair.impossible') || 'Réparation Impossible')}
            </button>
        </div>
    `;

    modalOverlay.appendChild(content);

    const appOuter = document.getElementById('app-window-outer') || document.body;
    appOuter.appendChild(modalOverlay);
    raiseAboveAll(modalOverlay);

    const closeBtn = content.querySelector('#repair-cancel');
    const startBtn = content.querySelector('#repair-start');
    const progressContainer = content.querySelector('#repair-progress-container');
    const statusText = content.querySelector('#repair-status-text');
    const statusPct = content.querySelector('#repair-status-pct');
    const progressBar = content.querySelector('#repair-progress-bar');
    const actionsBlock = content.querySelector('#repair-actions');

    const closeModal = () => { modalOverlay.remove(); };

    closeBtn.addEventListener('click', closeModal);
    content.querySelector('#repair-x')?.addEventListener('click', closeModal);
    modalOverlay.addEventListener('mousedown', (e) => {
        if (e.target === modalOverlay) closeModal();
    });

    startBtn.addEventListener('click', async () => {
        actionsBlock.style.display = 'none';
        progressContainer.style.display = 'flex';

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

                const fallbackType = mref.fallback_type || "direct";
                const hasLink = fallbackType === "sr" ? !!pack.sr_link : !!(mref.download_fallback || mref.download_link);

                const isMissingMref = report.missingMods.some(x => x.mod_id === mref.mod_id);

                // Mods manquants sans lien : impossible à réparer, on notifie et on passe
                if (!hasLink && isMissingMref) {
                    modRepairErrors.push(t('modpack.repair.noLink', { name: mref.mod_name }) || `${mref.mod_name} : aucun lien fourni`);
                    statusText.style.color = 'var(--text-muted)';
                    statusText.textContent = `⚠ ${t('modpack.repair.noLinkSkipped', { name: mref.mod_name })}`;
                    await new Promise(r => setTimeout(r, 1200));
                    statusText.style.color = '';
                    continue;
                }

                statusText.textContent = t('modpack.repair.repairing', { name: mref.mod_name });
                statusPct.textContent = `0%`;
                progressBar.style.width = `0%`;

                try {
                    await invoke('repair_modpack_mod', {
                        args: {
                            modRef: mref,
                            srLink: pack.sr_link || null,
                            targetProfileId: activeProfileId,
                            creatorId: null
                        }
                    });
                    statusText.textContent = `✓ ${mref.mod_name}`;
                } catch (modErr) {
                    const errStr = String(modErr);
                    let friendlyMsg;
                    if (errStr.includes('aucun lien') || errStr.includes('None lien')) {
                        friendlyMsg = t('modpack.repair.noLink', { name: mref.mod_name }) || `${mref.mod_name} : aucun lien de téléchargement fourni`;
                    } else if (errStr.includes('non trouvé') || errStr.includes('404')) {
                        friendlyMsg = t('modpack.repair.notFound', { name: mref.mod_name }) || `${mref.mod_name} : fichier introuvable sur le serveur`;
                    } else if (errStr.includes('refusé') || errStr.includes('403')) {
                        friendlyMsg = t('modpack.repair.denied', { name: mref.mod_name }) || `${mref.mod_name} : accès refusé par le serveur`;
                    } else {
                        friendlyMsg = `${mref.mod_name} : ${errStr}`;
                    }
                    modRepairErrors.push(friendlyMsg);
                    statusText.style.color = 'var(--danger)';
                    statusText.textContent = `✗ ${friendlyMsg}`;
                    await new Promise(r => setTimeout(r, 1500));
                    statusText.style.color = '';
                }
            }

            await _loadData();

            statusText.textContent = t('modpack.repair.finalCheck') || 'Vérification finale...';
            const finalReport = await invoke('check_modpack_integrity', { modpack: pack });

            if (modRepairErrors.length > 0 && (finalReport.missingMods.length > 0 || finalReport.corruptedMods.length > 0)) {
                toast(t('modpack.repair.incomplete', { errors: modRepairErrors.join('\n• ') }) || `Réparation incomplète :\n• ${modRepairErrors.join('\n• ')}`, 'warning');
                closeModal();
            } else if (modRepairErrors.length > 0) {
                toast(t('modpack.repair.partial', { errors: modRepairErrors.join('\n• ') }) || `Réparé, mais certains mods ont été ignorés :\n• ${modRepairErrors.join('\n• ')}`, 'warning');
                closeModal();
                onComplete();
            } else if (finalReport.missingMods.length > 0 || finalReport.corruptedMods.length > 0) {
                toast(t('modpack.repair.unstable') || "La réparation n'a pas pu tout résoudre.", 'warning');
                closeModal();
                onComplete();
            } else {
                toast(t('modpack.repair.success') || "Réparation terminée avec succès !", 'success');
                closeModal();
                onComplete();
            }
        } catch (err) {
            toast((window.t ? window.t('common.error') : 'Error') + ' : ' + err.toString(), 'error');
            actionsBlock.style.display = 'flex';
        } finally {
            if (unlisten) unlisten();
        }
    });
}

async function _executeApplyModpack(container, pack, isApplying) {
    toast(isApplying ? t('modpack.applying') : t('modpack.deactivating') || 'Désactivation du modpack...', 'info');

    let appliedCount = 0;
    let missingCount = 0;
    // Mods the backend refused, kept apart from the ones that were not found at all: "you do
    // not have it" and "it is here and would not turn on" are different problems with different
    // fixes, and reporting them as one number sends people looking in the wrong place.
    const failed: string[] = [];

    const shaIndex = await _resolveHashesToModIds(pack.mods);

    // Each toggle is guarded on its own.
    //
    // Every `invoke` below used to be unguarded inside this loop, so the FIRST mod the backend
    // refused threw straight out of it — every mod after that one was silently skipped, and the
    // pack was left half applied with a single generic error. `enable_mod` refuses for ordinary
    // reasons: MISSING_SHA when hashes have not been computed yet, an archive that cannot be
    // extracted. One awkward mod should cost you that mod, not the pack.
    const toggle = async (id: string, on: boolean, label: string) => {
        try {
            await invoke(on ? 'enable_mod' : 'disable_mod', { modId: id });
            appliedCount++;
            return true;
        } catch (e: any) {
            const raw = String(e?.message || e || '');
            // The backend encodes this one as `MISSING_SHA|id|name` — shown as the name, since
            // the pipe-delimited form is for the caller, not the reader.
            failed.push(raw.startsWith('MISSING_SHA|') ? `${label} (SHA)` : label);
            return false;
        }
    };

    // The pack's own order, as local ids: once its mods are on, the block is placed in the
    // profile's activation order by the pack's mode (or the setting): on top in this sequence
    // by default, so the pack wins as it was built (commands/order_share.rs).
    const packOrder: string[] = [];
    for (const mref of pack.mods) {
        // Find local mod by ID or SHA-256
        const local = _findLocalByMref(mref, shaIndex);
        if (local) packOrder.push(local.id);
        if (local) {
            if (isApplying && !local.enabled) {
                await toggle(local.id, true, local.name || local.id);
                if (mref.include_dependencies && local.dependencies && local.dependencies.length > 0) {
                    for (const depId of local.dependencies) {
                        const depLocal = _allMods.find(m => m.id === depId);
                        if (depLocal && !depLocal.enabled) await toggle(depId, true, depLocal.name || depId);
                    }
                }
            } else if (!isApplying && local.enabled) {
                await toggle(local.id, false, local.name || local.id);
                if (mref.include_dependencies && local.dependencies && local.dependencies.length > 0) {
                    for (const depId of local.dependencies) {
                        const depLocal = _allMods.find(m => m.id === depId);
                        if (depLocal && depLocal.enabled) await toggle(depId, false, depLocal.name || depId);
                    }
                }
            }
        } else {
            if (isApplying) missingCount++;
        }
    }

    if (failed.length > 0) {
        // Named, and capped at three: a list of forty names is a wall nobody reads, and the
        // first few are enough to go and look.
        const shown = failed.slice(0, 3).join(', ') + (failed.length > 3 ? ` +${failed.length - 3}` : '');
        toast(`${t('modpack.applyFailed') || 'Could not toggle'}: ${shown}`, 'error');
    } else if (isApplying && missingCount > 0) {
        toast(t('modpack.applyPartial').replace('{applied}', appliedCount.toString()).replace('{missing}', missingCount.toString()), 'warning');
    } else {
        toast(isApplying ? t('modpack.applyOk') : t('modpack.deactivateOk') || 'Modpack désactivé avec succès !', 'success');
    }
    if (isApplying && packOrder.length > 0) {
        const { arrangeBlock } = await import('../profiles/load-order.js');
        await arrangeBlock(packOrder, pack.order_mode || null, null, toast);
    }
    if (isApplying) dispatchBmmAction(BMM_ACTIONS.MODPACK_APPLIED, { name: pack?.name });

    await _loadData();
    if (container) _renderModpackList(container);

    if (window._refreshModsFn) {
        window._refreshModsFn(false, true);
    } else {
        window.dispatchEvent(new CustomEvent('bmm://mods-updated'));
    }
}

async function _applyModpack(container, pack) {
    if (!pack || !pack.mods || pack.mods.length === 0) return;

    try {
        const shaIndex = await _resolveHashesToModIds(pack.mods);
        const anyEnabled = pack.mods.some(mref => {
            const local = _findLocalByMref(mref, shaIndex);
            return local && local.enabled;
        });

        const isApplying = !anyEnabled;

        if (isApplying && !pack.skip_integrity_check) {
            const report = await invoke('check_modpack_integrity', { modpack: pack });

            if (report.missingMods.length > 0 || report.corruptedMods.length > 0) {
                _showRepairModal(container, pack, report, async () => {
                    await _executeApplyModpack(container, pack, true);
                });
                return;
            }
        }

        await _executeApplyModpack(container, pack, isApplying);
    } catch (err) {
        toast((window.t ? window.t('common.error') : 'Error') + ': ' + err.toString(), 'error');
    }
}

async function _exportModpack(pack) {
    if (!pack) return;
    try {
        await invoke('export_modpack', { id: pack.id });
        toastSaved(t('modpack.exportSuccess') || 'Modpack exporté !');
    } catch (err) {
        if (String(err) !== 'repo.errCancel') toast(String(err), 'error');
    }
}

async function _deleteModpack(container, pack) {
    if (!pack) return;

    const action = await _showDeleteModal(container, pack);
    if (action === 'edit') {
        _openEditor(container, pack);
        return;
    }
    if (!action) return;

    try {
        await invoke('delete_modpack', { id: pack.id });
        toast(t('modpack.deletedOk') || 'Modpack supprimé.', 'success');
        await _loadData();
        _renderModpackList(container);
        window.dispatchEvent(new CustomEvent('bmm://modpacks-updated'));
    } catch (err) {
        toast(String(err), 'error');
    }
}

/**
 * Premium delete-confirmation modal.
 * Returns:  'delete' → user confirmed,  'edit' → user clicked Edit,  null → cancelled.
 */
function _showDeleteModal(container: any, pack: any): Promise<'delete' | 'edit' | null> {
    return new Promise((resolve) => {
        const modsCount = pack.mods?.length || 0;
        const gameLine = pack.game_name ? ` · ${escHtml(pack.game_name)}` : '';
        const descBlock = pack.description
            ? `<div class="mp-del-desc">${escHtml(pack.description)}</div>`
            : '';
        let result: 'delete' | 'edit' | null = null;
        const TRASH = (uiIcon('delete', 20));
        const m = openModal({
            title: t('modpack.deleteTitle') || 'Delete the launchpack',
            subtitle: t('modpack.deleteSubtitle') || 'This cannot be undone. The pack will be deleted for good.',
            icon: TRASH,
            tone: 'danger',
            size: 'sm',
            closeLabel: t('common.close') || 'Close',
            body: `
            <div class="mp-del-card">
                <div class="mp-del-row">
                    <div class="mp-del-ic">${uiIcon('folders', 16)}</div>
                    <div style="min-width:0;">
                        <div class="mp-del-name">${escHtml(pack.name)}</div>
                        <div class="mp-del-meta">${modsCount} mod${modsCount !== 1 ? 's' : ''}${gameLine}</div>
                    </div>
                </div>
                ${descBlock}
            </div>`,
            // The destructive action stands apart: Edit on the left, Cancel then Delete.
            footer: `
                <div class="modal-footer-start">
                    <button type="button" class="btn btn-ghost" id="dmod-edit">
                        ${uiIcon('edit', 12)}
                        ${t('modpack.edit') || 'Edit'}
                    </button>
                </div>
                <button type="button" class="btn btn-secondary" id="dmod-cancel">${t('common.cancel') || 'Cancel'}</button>
                <button type="button" class="btn btn-danger" id="dmod-confirm">${t('modpack.deleteConfirmBtn') || 'Delete'}</button>`,
            initialFocus: '#dmod-cancel',
            onClose: () => resolve(result),
        });
        const close = (r: 'delete' | 'edit' | null) => { result = r; m.close(); };
        m.q('#dmod-cancel')?.addEventListener('click', () => close(null));
        m.q('#dmod-confirm')?.addEventListener('click', () => close('delete'));
        m.q('#dmod-edit')?.addEventListener('click', () => close('edit'));
    });
}

// ── Quick Apply Modal ────────────────────────────────────────────────────────
export async function openQuickApplyModal() {
    await _loadData();

    // The house shell, like the mod picker: header, a search/filter toolbar band, the list.
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';

    const content = document.createElement('div');
    content.className = 'modal bms modal--md modal--tall';
    content.setAttribute('role', 'dialog');
    content.setAttribute('aria-modal', 'true');

    // Header + toolbar written straight into the card; `header` is where the queries look.
    const header = content;
    content.innerHTML = `
        <div class="modal-header">
            <div class="bms-icon" aria-hidden="true">${uiIcon('run', 18)}</div>
            <div class="bms-titles">
                <h2 class="modal-title">${t('modpack.quickApplyTitle') || 'Activate a modpack'}</h2>
                <p class="bms-sub">${_modpacks.length} ${t('modpack.available') || 'available'}</p>
            </div>
            <button type="button" class="modal-close" id="qa-close" aria-label="${escAttr(t('common.close') || 'Close')}">${MODAL_CLOSE_SVG}</button>
        </div>
        <div class="modal-toolbar">
            <div class="mp-ms-search" id="qa-search-wrap">
                ${uiIcon('search', 14)}
                <input type="text" id="qa-search" placeholder="${escAttr(t('common.search') || 'Search…')}">
            </div>
            <select id="qa-filter" class="form-input" style="flex:none;width:auto;">
                <option value="all">${t('modpack.filterAll') || 'Tous'}</option>
                <option value="single">${t('modpack.singleProfile') || 'Profil unique'}</option>
                <option value="multi">${t('modpack.multiProfile') || 'Multi-profil'}</option>
            </select>
        </div>
    `;

    // Body
    const body = document.createElement('div');
    body.className = 'modal-body custom-scrollbar';
    body.style.cssText = 'gap:8px;';

    const cards = [];

    if (_modpacks.length === 0) {
        body.innerHTML = `<div style="text-align:center;color:var(--text-muted);font-size:13px;padding:60px 20px; display:flex; flex-direction:column; align-items:center; gap:12px;">
 ${uiIcon('folders', 18)}            <span>${t('modpack.noModpacks') || 'No modpack found'}</span>
        </div>`;
    }

    _modpacks.forEach(pack => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-radius:12px; background:var(--bmm-s03); border:1px solid var(--bmm-s05); transition:background 0.2s, border-color 0.2s;';
        row.onmouseenter = () => {
            row.style.background = 'var(--bmm-s05)';
            row.style.borderColor = 'color-mix(in srgb, var(--bmm-cyan) 20%, transparent)';
        };
        row.onmouseleave = () => {
            row.style.background = 'var(--bmm-s03)';
            row.style.borderColor = 'var(--bmm-s05)';
        };

        const modsCount = pack.mods ? pack.mods.length : 0;

        let anyEnabled = false;
        if (pack.mods) {
            anyEnabled = pack.mods.some(mref => {
                // Hash matching now lives in the dedicated apply/deactivate flow (resolved
// in one batch backend call) — for the row toggle indicator we only need
// mod_id match here, which covers ~all real cases.
const local = _allMods.find(m => m.id === mref.mod_id);
                return local && local.enabled;
            });
        }

        row.innerHTML = `
            <div style="flex:1; min-width:0; padding-right:16px;">
                <div style="font-size:14px; font-weight:700; color:var(--text-primary); margin-bottom:4px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${escHtml(pack.name)}</div>
                <div style="font-size:11px; color:var(--text-muted); display:flex; gap:8px; align-items:center;">
                    <span>${t('modpack.modsCount', { count: modsCount }) || modsCount + ' mods'}</span>
                    <span style="opacity:0.3">•</span>
                    <span style="color:var(--text-secondary);">${pack.multi_profile ? t('modpack.multiProfile') : escHtml(pack.game_name || t('modpack.general'))}</span>
                </div>
            </div>
            ${_switchHtml(!!anyEnabled, `${anyEnabled ? (t('modpack.deactivate') || 'Deactivate') : t('modpack.apply')}: ${pack.name}`)}
        `;

        const applyBtn = row.querySelector('.btn-apply');
        applyBtn.onclick = async () => {
            const wrap = applyBtn as HTMLElement;
            wrap.style.opacity = '0.5';
            wrap.style.pointerEvents = 'none';
            await _applyModpack(null, pack);

            // Recalculate anyEnabled after apply
            await _loadData();
            let newAnyEnabled = false;
            const updatedPack = _modpacks.find(p => p.id === pack.id);
            if (updatedPack && updatedPack.mods) {
                newAnyEnabled = updatedPack.mods.some(mref => {
                    // Hash matching now lives in the dedicated apply/deactivate flow (resolved
// in one batch backend call) — for the row toggle indicator we only need
// mod_id match here, which covers ~all real cases.
const local = _allMods.find(m => m.id === mref.mod_id);
                    return local && local.enabled;
                });
            }

            _setSwitch(wrap, newAnyEnabled);
            wrap.style.opacity = '1';
            wrap.style.pointerEvents = 'auto';
        };

        body.appendChild(row);
        cards.push({ card: row, name: pack.name.toLowerCase(), isMulti: pack.multi_profile });
    });

    const searchInput = header.querySelector('#qa-search');
    const filterSelect = header.querySelector('#qa-filter');

    const applyFilters = () => {
        const q = searchInput.value.toLowerCase().trim();
        const f = filterSelect.value;
        cards.forEach(({ card, name, isMulti }) => {
            let match = true;
            if (q && !name.includes(q)) match = false;
            if (f === 'single' && isMulti) match = false;
            if (f === 'multi' && !isMulti) match = false;
            card.style.display = match ? 'flex' : 'none';
        });
    };

    searchInput.addEventListener('input', applyFilters);
    filterSelect.addEventListener('change', applyFilters);

    content.appendChild(body);
    overlay.appendChild(content);

    const appOuter = document.getElementById('app-window-outer') || document.body;
    appOuter.appendChild(overlay);
    raiseAboveAll(overlay);

    const closeBtn = header.querySelector('#qa-close');

    const closeModal = () => { overlay.remove(); };

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) closeModal();
    });
}

