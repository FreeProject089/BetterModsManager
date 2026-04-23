// @ts-nocheck
/**
 * modpack-creator.ts — Modpack Creator UI
 * Allows users to create, edit, and manage Modpacks stored in AppData.
 * Features: single/multi-profile, dependency modes, per-mod download links & fallbacks,
 * optional ServerRepo link, SHA-256 identification for cross-PC recognition.
 */
import { invoke } from '../../core/api.js';
import { toast } from '../../ui/app.js';
import { t } from '../../core/i18n.js';
import { formatBytes } from '../../core/utils.js';

// ── State ────────────────────────────────────────────────────────────────────

let _modpacks = [];
let _editingPack = null; // LocalModpack currently being edited
let _allMods = [];
let _profiles = [];
let _activeProfileId = null;
let _packMods = []; // ModpackModRef[] being assembled
let _isAddingMods = false; // Background state for selection modal
let _currentAddingModName = ''; // Name of the mod currently being processed
let _currentSelectionModalUpdateFn = null; // Ref to update UI from background
let _currentSelectionModalOverlay = null; // Ref to current modal overlay for auto-close

// ── Public init ──────────────────────────────────────────────────────────────

export async function initModpackCreator(container) {
    if (!container) return;

    // Bind buttons
    const btnImport = document.getElementById('btn-import-modpack');
    if (btnImport && !btnImport.dataset.bound) {
        btnImport.dataset.bound = 'true';
        btnImport.addEventListener('click', async () => {
            try {
                await invoke('import_modpack');
                toast(t('modpack.importSuccess') || 'Modpack importé avec succès', 'success');
                await _loadData();
                _renderModpackList(container);
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

function _renderModpackList(container) {
    container.innerHTML = '';

    const countHeader = document.createElement('div');
    countHeader.style.cssText = 'display:flex; align-items:center; justify-content:space-between; margin-bottom:24px; flex-wrap: wrap; gap: 16px;';
    countHeader.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:4px; height:20px; background:var(--accent); border-radius:2px;"></div>
            <span style="font-size:16px; font-weight:800; color:var(--text-primary); text-transform:uppercase; letter-spacing:0.5px;">${t('modpack.title')}</span>
            <span style="font-size:12px; color:var(--text-muted); background:rgba(255,255,255,0.05); padding:2px 8px; border-radius:10px; font-weight:600;" id="modpack-count-badge">${_modpacks.length}</span>
        </div>
        <div style="display:flex; align-items:center; gap:12px; flex: 1; justify-content: flex-end;">
            <div class="search-box" id="mp-search-wrap" style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:8px 12px;transition:border-color 0.2s; max-width: 250px; width: 100%;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2.5" style="flex-shrink:0;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="text" id="modpack-search" placeholder="${t('common.search') || 'Rechercher...'}" style="flex:1; background:none; border:none; outline:none; font-size:13px; color:var(--text-primary);">
            </div>
            <button id="modpack-create-btn" class="btn btn-primary" style="height:38px; padding:0 20px; font-size:12px; font-weight:700; border-radius:10px; background:linear-gradient(135deg, var(--accent) 0%, #0081ff 100%); border:none; box-shadow: 0 4px 15px rgba(0,194,255,0.25);">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:8px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                ${t('modpack.create')}
            </button>
        </div>
    `;
    container.appendChild(countHeader);

    const searchInput = countHeader.querySelector('#modpack-search');
    const searchWrap = countHeader.querySelector('#mp-search-wrap');
    searchWrap.addEventListener('focusin', () => searchWrap.style.borderColor = 'rgba(0,194,255,0.35)');
    searchWrap.addEventListener('focusout', () => searchWrap.style.borderColor = 'rgba(255,255,255,0.08)');
    
    const countBadge = countHeader.querySelector('#modpack-count-badge');

    const createBtn = countHeader.querySelector('#modpack-create-btn');
    createBtn.addEventListener('click', () => _openEditor(container, null));

    if (_modpacks.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'text-align:center;padding:60px 20px;color:var(--text-muted);display:flex;flex-direction:column;align-items:center;gap:16px;';
        empty.innerHTML = `
            <div style="width:64px; height:64px; border-radius:20px; background:rgba(255,255,255,0.02); display:flex; align-items:center; justify-content:center; border:1px dashed rgba(255,255,255,0.1);">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" style="opacity:0.5;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
            </div>
            <div style="font-size:14px; font-weight:600; color:var(--text-secondary);">${t('modpack.noMods')}</div>
            <p style="font-size:12px; max-width:300px; line-height:1.5;">${t('modpack.noModsDesc')}</p>
        `;
        container.appendChild(empty);
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'modpack-grid';
    
    const cards = [];

    _modpacks.forEach(pack => {
        const card = document.createElement('div');
        card.className = 'modpack-card';

        const modsCount = pack.mods ? pack.mods.length : 0;
        const lastUpdate = pack.updated_at ? new Date(pack.updated_at).toLocaleDateString() : '—';
        const description = pack.description || t('modpack.noDesc');

        const anyEnabled = pack.mods && pack.mods.length > 0 && pack.mods.some(mref => {
            const local = _allMods.find(m => m.id === mref.mod_id || m.sha256 === mref.sha256);
            return local && local.enabled;
        });
        
        const applyIcon = anyEnabled 
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>' 
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
        const applyTitle = anyEnabled ? t('modpack.deactivate') || 'Désactiver le modpack' : t('modpack.apply');
        const applyClass = anyEnabled ? 'btn-apply active' : 'btn-apply';
        const applyColor = anyEnabled ? 'color: var(--success);' : '';

        card.innerHTML = `
            <div class="modpack-card-info" style="margin-left: 0; display: flex; flex-direction: column; height: 100%;">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 8px; padding-right: 90px;">
                    <div class="modpack-card-title" title="${pack.name}">${pack.name}</div>
                </div>
                <div class="modpack-card-meta">
                    <span>${t('modpack.modsCount', { count: modsCount })}</span>
                    <span style="opacity:0.3">•</span>
                    <span>${pack.game_name || t('modpack.general')}</span>
                </div>
                <div style="font-size:10px; color:var(--text-muted); margin-top:8px; line-height:1.4; display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden; height:28px;">
                    ${description}
                </div>
                <div style="margin-top:auto; display:flex; align-items:flex-end; justify-content:space-between;">
                    <div style="font-size:9px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; opacity:0.6; padding-bottom: 4px;">
                        ${t('modpack.updatedAt', { date: lastUpdate })}
                    </div>
                    <div class="bmm-switch-wrap btn-apply ${anyEnabled ? 'active' : ''}" 
                         style="width:38px; height:20px; position:relative; cursor:pointer; flex-shrink:0;"
                         onmouseenter="window.showTaskyHelp('${t('modpack.quickApplyDesc') || 'Cliquez pour activer ou désactiver ce pack.'}', 'zap')"
                         onmouseleave="window.hideTaskyHelp()">
                        <div class="switch-bg" style="position:absolute; inset:0; border-radius:10px; background:${anyEnabled ? 'var(--success)' : 'rgba(255,255,255,0.1)'}; transition:all 0.3s; border:1px solid ${anyEnabled ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.05)'};"></div>
                        <div class="switch-knob" style="position:absolute; top:3px; ${anyEnabled ? 'right:3px' : 'left:3px'}; width:14px; height:14px; border-radius:50%; background:#fff; transition:all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); box-shadow:0 2px 4px rgba(0,0,0,0.2);"></div>
                    </div>
                </div>
            </div>
            <div class="modpack-card-actions">
                <button class="btn btn-icon btn-ghost btn-export" title="${t('modpack.exportTitle')}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></button>
                <button class="btn btn-icon btn-ghost btn-edit" title="${t('modpack.edit')}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                <button class="btn btn-icon btn-ghost btn-delete" style="color:var(--danger)" title="${t('modpack.delete')}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </div>
        `;

        card.querySelector('.btn-edit').onclick = (e) => { e.stopPropagation(); _openEditor(container, pack); };
        card.querySelector('.btn-apply').onclick = (e) => { e.stopPropagation(); _applyModpack(container, pack); };
        card.querySelector('.btn-export').onclick = (e) => { e.stopPropagation(); _exportModpack(pack); };
        card.querySelector('.btn-delete').onclick = (e) => { e.stopPropagation(); _deleteModpack(container, pack); };
        card.onclick = () => _openEditor(container, pack);

        grid.appendChild(card);
        cards.push({ card, name: pack.name.toLowerCase() });
    });

    container.appendChild(grid);

    searchInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        let visible = 0;
        cards.forEach(({ card, name }) => {
            if (!q || name.includes(q)) {
                card.style.display = 'flex';
                visible++;
            } else {
                card.style.display = 'none';
            }
        });
        countBadge.textContent = visible.toString();
    });
}

// ── Editor ───────────────────────────────────────────────────────────────────

async function _openEditor(container, pack) {
    _editingPack = pack ? JSON.parse(JSON.stringify(pack)) : {
        id: '', name: '', description: null, created_at: '', updated_at: '',
        multi_profile: false, dependency_mode: 'manual', mods: [], sr_link: null, game_name: null
    };
    _packMods = _editingPack.mods ? [..._editingPack.mods] : [];

    container.innerHTML = '';

    // Premium Header / Breadcrumbs
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:center; justify-content:space-between; margin-bottom:24px;';
    header.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:4px;">
            <div style="display:flex; align-items:center; gap:8px; color:var(--text-muted); font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">
                <span style="cursor:pointer;" id="bc-home">${t('modpack.title')}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 18 15 12 9 6"/></svg>
                <span style="color:var(--accent);">${pack ? t('modpack.edit') : t('modpack.create')}</span>
            </div>
            <h2 style="font-size:20px; font-weight:800; margin:0; color:var(--text-primary);">${pack ? pack.name : t('modpack.newPack')}</h2>
        </div>
        <div style="display:flex; gap:10px;">
            <button class="btn btn-ghost" id="editor-cancel" style="border:1px solid rgba(255,255,255,0.05);">${t('common.cancel')}</button>
            <button class="btn btn-primary" id="editor-save" style="background:linear-gradient(135deg, var(--accent) 0%, #0081ff 100%); border:none; box-shadow:0 4px 15px rgba(0,194,255,0.25); min-width:120px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:8px"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                ${t('modpack.save')}
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="13 2 13 8 20 8"/></svg>
            ${t('modpack.generalInfo')}
        </div>
    `;

    const metaForm = document.createElement('div');
    metaForm.style.cssText = 'display:flex; flex-direction:column; gap:16px;';
    
    metaForm.appendChild(_formField(t('modpack.name'), `<input id="mp-name" type="text" class="form-input" placeholder="${t('modpack.namePlaceholder')}" value="${_editingPack.name || ''}" style="width:100%;">`));
    metaForm.appendChild(_formField(t('modpack.description'), `<textarea id="mp-desc" class="form-input" style="width:100%; height:100px; resize:none;">${_editingPack.description || ''}</textarea>`));
    metaForm.appendChild(_formField(t('modpack.game'), `<input id="mp-game" type="text" class="form-input" placeholder="${t('modpack.gamePlaceholder') || 'e.g. DCS World'}" value="${_editingPack.game_name || ''}" style="width:100%;">`));
    
    // Multi-profile toggle (re-styled)
    const multiRow = document.createElement('label');
    multiRow.style.cssText = 'display:flex; align-items:center; gap:12px; cursor:pointer; padding:16px; border-radius:14px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); transition:all 0.2s;';
    multiRow.onmouseenter = () => multiRow.style.borderColor = 'rgba(var(--accent-rgb), 0.2)';
    multiRow.onmouseleave = () => multiRow.style.borderColor = 'rgba(255,255,255,0.05)';
    
    const multiCb = document.createElement('input');
    multiCb.type = 'checkbox';
    multiCb.id = 'mp-multi';
    multiCb.style.cssText = 'width:20px; height:20px; accent-color:var(--accent); cursor:pointer;';
    multiCb.checked = _editingPack.multi_profile;
    multiCb.onchange = () => {
        _editingPack.multi_profile = multiCb.checked;
    };
    
    const multiInfo = document.createElement('div');
    multiInfo.innerHTML = `
        <div style="font-size:13px; font-weight:700; color:var(--text-primary);">${t('modpack.multiProfile')}</div>
        <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${t('modpack.multiProfileDesc')}</div>
    `;
    
    multiRow.appendChild(multiCb);
    multiRow.appendChild(multiInfo);
    metaForm.appendChild(multiRow);

    // Skip Integrity Check toggle
    const skipRow = document.createElement('label');
    skipRow.style.cssText = 'display:flex; align-items:center; gap:12px; cursor:pointer; padding:16px; border-radius:14px; background:rgba(255,136,0,0.05); border:1px solid rgba(255,136,0,0.1); transition:all 0.2s;';
    skipRow.onmouseenter = () => skipRow.style.borderColor = 'rgba(255,136,0,0.3)';
    skipRow.onmouseleave = () => skipRow.style.borderColor = 'rgba(255,136,0,0.1)';
    
    const skipCb = document.createElement('input');
    skipCb.type = 'checkbox';
    skipCb.id = 'mp-skip-integrity';
    skipCb.style.cssText = 'width:20px; height:20px; accent-color:#ff8800; cursor:pointer;';
    skipCb.checked = _editingPack.skip_integrity_check;
    skipCb.onchange = () => {
        _editingPack.skip_integrity_check = skipCb.checked;
    };
    
    const skipInfo = document.createElement('div');
    skipInfo.innerHTML = `
        <div style="font-size:13px; font-weight:700; color:#ff8800;">Ignorer la vérification d'intégrité</div>
        <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Désactive la vérification des fichiers au lancement (plus rapide, mais ne répare pas les mods cassés).</div>
    `;
    
    skipRow.appendChild(skipCb);
    skipRow.appendChild(skipInfo);
    metaForm.appendChild(skipRow);

    metaForm.appendChild(_formField(t('modpack.depMode'), `
        <select id="mp-depmode" class="form-input" style="width:100%;">
            <option value="all" ${_editingPack.dependency_mode === 'all' ? 'selected' : ''}>${t('modpack.depModeAll')}</option>
            <option value="none" ${_editingPack.dependency_mode === 'none' ? 'selected' : ''}>${t('modpack.depModeNone')}</option>
            <option value="manual" ${_editingPack.dependency_mode === 'manual' ? 'selected' : ''}>${t('modpack.depModeManual')}</option>
        </select>
    `));

    metaForm.appendChild(_formField(t('modpack.srLink'), `<input id="mp-srlink" type="text" class="form-input" placeholder="${t('modpack.srLinkPlaceholder')}" value="${_editingPack.sr_link || ''}" style="width:100%;">`));

    leftCol.appendChild(metaForm);
    layout.appendChild(leftCol);

    // RIGHT: Mods
    const rightCol = document.createElement('div');
    rightCol.className = 'editor-section-card';
    rightCol.style.flex = '1';
    rightCol.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
            <div class="editor-section-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                ${t('modpack.modsManagement')}
            </div>
            <button class="btn btn-secondary btn-sm" id="btn-add-mods-pack" style="font-size:11px; height:32px; border-radius:8px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                ${t('modpack.addMods')}
            </button>
        </div>
    `;

    const modListEl = document.createElement('div');
    modListEl.id = 'mp-modlist';
    modListEl.style.cssText = 'display:flex; flex-direction:column; gap:10px; margin-top:10px;';
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
            mods: _packMods,
        };

        try {
            const btn = header.querySelector('#editor-save');
            btn.disabled = true;
            btn.textContent = t('modpack.saving');
            await invoke('save_modpack', { modpack: payload });
            toast(t('modpack.savedOk') || 'Modpack sauvegardé !', 'success');
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

function _renderPackModList(listEl) {
    listEl.innerHTML = '';
    if (_packMods.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:40px 20px; text-align:center; color:var(--text-muted); border-radius:16px; border:1px dashed rgba(255,255,255,0.08); background:rgba(0,0,0,0.02); display:flex; flex-direction:column; align-items:center; gap:12px;';
        empty.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
            <span style="font-size:12px;">${t('modpack.noMods')}</span>
        `;
        listEl.appendChild(empty);
        return;
    }

    _packMods.forEach((pm, idx) => {
        const card = document.createElement('div');
        card.className = 'mod-item-card';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.gap = '12px';

        card.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px;">
                <div style="flex:1; min-width:0;">
                    <div style="font-size:13px; font-weight:700; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${pm.mod_name}</div>
                    <div style="font-size:10px; color:var(--text-muted); display:flex; gap:6px;">
                        <span>V${pm.mod_version}</span>
                        <span style="opacity:0.3">|</span>
                        <span style="color:var(--text-secondary);">${pm.profile_name || t('modpack.global') || 'Global'}</span>
                    </div>
                </div>
                <button class="btn btn-icon btn-ghost btn-remove" style="color:var(--danger); opacity:0.5;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.03);">
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <label style="font-size:9px; font-weight:800; color:var(--text-muted); text-transform:uppercase;">${t('modpack.modDownloadLink')}</label>
                    <input type="text" class="form-input dl-input" placeholder="https://..." value="${pm.download_link || ''}" style="font-size:11px; height:30px; padding:0 8px;">
                </div>
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <label style="font-size:9px; font-weight:800; color:var(--text-muted); text-transform:uppercase;">${t('modpack.modFallback')}</label>
                    <input type="text" class="form-input fb-input" placeholder="${t('modpack.modFallbackPlaceholder') || 'Nexus, Drive, etc.'}" value="${pm.download_fallback || ''}" style="font-size:11px; height:30px; padding:0 8px;">
                </div>
            </div>

            <div style="display:flex; flex-direction:column; gap:8px; margin-top:4px;">
                <div style="display:flex; align-items:center; gap:16px;">
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:10px; font-weight:600; color:var(--text-secondary);">
                        <input type="checkbox" class="deps-cb" ${pm.include_dependencies ? 'checked' : ''} style="width:14px; height:14px; accent-color:var(--accent);">
                        ${t('modpack.modDeps')}
                    </label>
                    <div style="display:flex; align-items:center; gap:6px;">
                        <span style="font-size:9px; font-weight:800; color:var(--text-muted); text-transform:uppercase;">${t('modpack.modFallbackType')}</span>
                        <select class="form-select fb-type-select" style="font-size:10px; height:24px; padding:0 4px; border-radius:4px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); color:var(--text-primary);">
                            <option value="direct" ${pm.fallback_type === 'direct' ? 'selected' : ''}>${t('modpack.fallbackDirect') || 'Direct Link'}</option>
                            <option value="sr" ${pm.fallback_type === 'sr' ? 'selected' : ''}>${t('modpack.fallbackServerRepo') || 'Server Repo'}</option>
                        </select>
                    </div>
                </div>
                
                <div class="deps-list" style="display:flex; flex-wrap:wrap; gap:4px; opacity:0.6;"></div>
            </div>
        `;

        card.querySelector('.btn-remove').onclick = () => {
            _packMods.splice(idx, 1);
            _renderPackModList(listEl);
        };

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
                tag.style.cssText = 'font-size:9px; padding:2px 6px; border-radius:4px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.05); color:var(--text-muted);';
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
    wrap.style.marginBottom = '16px';
    wrap.innerHTML = `
        <div style="font-size:12px; font-weight:600; color:var(--text-muted); margin-bottom:8px; text-transform:uppercase; letter-spacing:0.05em;">${label}</div>
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
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.85); backdrop-filter:blur(8px); display:flex; align-items:center; justify-content:center; z-index:100000; opacity:0; transition:opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1); pointer-events:auto;';



    const content = document.createElement('div');
    content.className = 'modal-content glass';
    content.style.cssText = 'width:660px; max-width:95vw; height:80vh; max-height:700px; display:flex; flex-direction:column; padding:0; border-radius:16px; overflow:hidden; background:var(--card-bg, #0f172a); border:1px solid var(--border, #1e293b); box-shadow:0 32px 64px rgba(0,0,0,0.7); transform:translateY(20px) scale(0.98); transition:all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); pointer-events:auto;';

    // Header with search
    const header = document.createElement('div');
    header.style.cssText = 'padding:20px 24px 0; border-bottom:1px solid rgba(255,255,255,0.06); background:rgba(255,255,255,0.02); flex-shrink:0;';
    header.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <div style="display:flex; align-items:center; gap:12px;">
                <div style="width:36px; height:36px; border-radius:10px; background:rgba(0,194,255,0.12); border:1px solid rgba(0,194,255,0.25); display:flex; align-items:center; justify-content:center; color:var(--accent);">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                </div>
                <div>
                    <div style="font-size:16px; font-weight:700; color:var(--text-primary);">${t('modpack.selectMods')}</div>
                    <div style="font-size:11px; color:var(--text-muted); margin-top:1px;" id="ms-count-label"></div>
                </div>
            </div>
            <button class="btn btn-icon btn-ghost" id="ms-close" style="color:var(--text-muted); width:32px; height:32px; border-radius:8px;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>
        <div style="padding-bottom:16px; display:flex; align-items:center; gap:10px;">
            <div style="flex:1; display:flex; align-items:center; gap:8px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:8px 12px; transition:border-color 0.2s;" id="ms-search-wrap">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2.5" style="flex-shrink:0;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="text" id="ms-search" placeholder="${t('common.search') || 'Rechercher...'}" style="flex:1; background:none; border:none; outline:none; font-size:13px; color:var(--text-primary);">
            </div>
        </div>
    `;

    // Body
    const body = document.createElement('div');
    body.style.cssText = 'flex:1; overflow-y:auto; padding:12px 16px; display:flex; flex-direction:column; gap:5px;';

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
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="opacity:0.3;"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
            <span>${t('modpack.noMoreMods')}</span>
        </div>`;
    }

    availableMods.forEach(m => {
        const prof = _profiles.find(p => m.mod_folder_path && (m.mod_folder_path.toString().includes(p.mods_path?.toString()) || p.mods_path?.toString().includes(m.mod_folder_path?.toString())));
        const depCount = m.dependencies ? m.dependencies.length : 0;
        const searchLabel = (m.name + (prof ? prof.name : '')).toLowerCase();
        
        const alreadyInPack = _packMods.some(pm => String(pm.mod_id) === String(m.id));

        const row = document.createElement('label');
        row.style.cssText = `display:flex; align-items:center; gap:14px; padding:10px 12px; border-radius:12px; cursor:pointer; transition:all 0.15s; border:1px solid transparent; background:${alreadyInPack ? 'rgba(0,194,255,0.08)' : 'rgba(255,255,255,0.02)'};`;
        if (alreadyInPack) row.style.borderColor = 'rgba(0,194,255,0.25)';
        if (_isAddingMods) {
            row.style.pointerEvents = 'none';
            row.style.opacity = '0.7';
        }
        
        row.addEventListener('mouseenter', () => { 
            if (!row.querySelector('input').checked) {
                row.style.background = 'rgba(0,194,255,0.04)';
                row.style.borderColor = 'rgba(0,194,255,0.12)'; 
            }
        });
        row.addEventListener('mouseleave', () => { 
            if (!row.querySelector('input').checked) { 
                row.style.background = 'rgba(255,255,255,0.02)'; 
                row.style.borderColor = 'transparent'; 
            } else if (alreadyInPack) {
                row.style.background = 'rgba(0,194,255,0.08)';
                row.style.borderColor = 'rgba(0,194,255,0.25)';
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
            row.style.background = cb.checked ? 'rgba(0,194,255,0.08)' : 'rgba(255,255,255,0.02)';
            row.style.borderColor = cb.checked ? 'rgba(0,194,255,0.25)' : 'transparent';
            updateSelCount();
        });

        const info = document.createElement('div');
        info.style.cssText = 'flex:1; min-width:0;';
        info.innerHTML = `
            <div style="font-size:13px; font-weight:600; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${m.name}</div>
            <div style="display:flex; align-items:center; gap:5px; margin-top:3px; flex-wrap:wrap;">
                <span style="font-size:10px; color:var(--text-muted);">v${m.version || '?'}</span>
                ${prof ? `<span style="font-size:9px; font-weight:700; color:var(--accent); background:rgba(0,194,255,0.1); border:1px solid rgba(0,194,255,0.2); border-radius:4px; padding:1px 6px;">${prof.name}</span>` : ''}
                ${depCount > 0 ? `<span style="font-size:9px; color:var(--text-muted); background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.06); border-radius:4px; padding:1px 6px;">&rarr; ${depCount} ${t('modpack.dependenciesShort') || 'dep.'}</span>` : ''}
                ${alreadyInPack ? `<span style="font-size:8px; font-weight:800; color:var(--success); background:rgba(16,185,129,0.1); padding:1px 4px; border-radius:3px; text-transform:uppercase;">${t('modpack.alreadyAdded') || 'DÉJÀ AJOUTÉ'}</span>` : ''}
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
    footer.style.cssText = 'padding:14px 20px; border-top:1px solid rgba(255,255,255,0.05); display:flex; align-items:center; justify-content:space-between; gap:12px; background:rgba(0,0,0,0.15); flex-shrink:0;';
    footer.innerHTML = `
        <span style="font-size:11px; color:var(--text-muted);" id="ms-footer-count"></span>
        <div style="display:flex; gap:10px;">
            <button class="btn btn-ghost" id="ms-cancel" style="border:1px solid rgba(255,255,255,0.07);">${t('common.cancel')}</button>
            <button class="btn btn-primary" id="ms-confirm" style="background:linear-gradient(135deg, var(--accent) 0%, #0081ff 100%); border:none; box-shadow:0 4px 15px rgba(0,194,255,0.2); min-width:130px; opacity:0.5; transition:opacity 0.2s;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px;"><polyline points="20 6 9 17 4 12"/></svg>
                ${t('modpack.addMod')}
            </button>
        </div>
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
            confirmBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:8px; animation: bmm-loading-spin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> ${t('common.loading')}`;
            return;
        }
        
        // Restore buttons if we just finished
        confirmBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px;"><polyline points="20 6 9 17 4 12"/></svg> ${t('modpack.addMod')}`;
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
    header.querySelector('#ms-search-wrap').addEventListener('focusin', () => {
        header.querySelector('#ms-search-wrap').style.borderColor = 'rgba(0,194,255,0.35)';
    });
    header.querySelector('#ms-search-wrap').addEventListener('focusout', () => {
        header.querySelector('#ms-search-wrap').style.borderColor = 'rgba(255,255,255,0.08)';
    });

    const close = () => {
        _currentSelectionModalUpdateFn = null;
        _currentSelectionModalOverlay = null;
        overlay.style.opacity = '0';
        content.style.transform = 'translateY(10px) scale(0.97)';
        setTimeout(() => overlay.remove(), 220);
    };

    footer.querySelector('#ms-cancel').addEventListener('click', close);
    header.querySelector('#ms-close').addEventListener('click', close);

    confirmBtn.addEventListener('click', async () => {
        const checked = checkboxes.filter(cb => cb.checked);
        if (checked.length === 0) return;

        _isAddingMods = true;
        updateSelCount(); // Show loading state in current modal
        
        // No more prevent-close here as per user request
        
        const depMode = document.getElementById('mp-depmode')?.value || 'manual';
        const includeDeps = depMode === 'all';
        let errors = 0;
        
        // Clear current pack mods and rebuild from selection to ensure sync and uniqueness
        // Actually, we should only add the new ones, or rebuild the whole list.
        // The user wants uniqueness, so we filter out what's already there before pushing.
        
        for (const cb of checked) {
            // Uniqueness check: avoid adding if already in _packMods
            const exists = _packMods.some(pm => String(pm.mod_id) === String(cb.value));
            if (exists) continue;

            try {
                const targetMod = availableMods.find(m => String(m.id) === String(cb.value));
                _currentAddingModName = targetMod ? targetMod.name : '';
                if (_currentSelectionModalUpdateFn) _currentSelectionModalUpdateFn();

                const ref = await invoke('build_modpack_mod_ref', {
                    modId: cb.value,
                    profileId: cb.dataset.profId || null,
                    includeDependencies: includeDeps,
                    downloadLink: null,
                    fallbackLink: null,
                    fallbackType: 'direct',
                });
                _packMods.push(ref);
            } catch(e) {
                console.error(e);
                errors++;
            }
        }
        
        // Also remove mods that were UNCHECKED in the modal
        const selectedIds = checked.map(cb => String(cb.value));
        _packMods = _packMods.filter(pm => selectedIds.includes(String(pm.mod_id)));

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

    content.appendChild(header);
    content.appendChild(body);
    content.appendChild(footer);
    overlay.appendChild(content);

    // Close on click outside (backdrop)
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) close();
    });

    const appOuter = document.getElementById('app-window-outer') || document.body;
    appOuter.appendChild(overlay);
    _currentSelectionModalOverlay = overlay;

    requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        content.style.transform = 'translateY(0) scale(1)';
        setTimeout(() => header.querySelector('#ms-search').focus(), 100);
    });
}


async function _showRepairModal(container, pack, report, onComplete) {
    const activeProfileId = _activeProfileId || window.cachedActiveProfileId;
    if (!activeProfileId) {
        toast("Aucun profil actif", "error");
        return;
    }

    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'mod-repair-overlay';
    modalOverlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.7); backdrop-filter:blur(10px); z-index:9999; display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1);';
    
    const content = document.createElement('div');
    content.className = 'editor-section-card';
    content.style.cssText = 'width:600px; max-width:90vw; max-height:85vh; display:flex; flex-direction:column; padding:24px; border-radius:16px; background:var(--bg-secondary); border:1px solid rgba(255,255,255,0.08); box-shadow:0 20px 50px rgba(0,0,0,0.5); transform:scale(0.95); transition:all 0.3s cubic-bezier(0.16, 1, 0.3, 1);';
    
    // Build lists
    let modsHtml = '';
    const problematicMods = [...report.missingMods, ...report.corruptedMods];
    
    let canRepairAny = false;
    
    problematicMods.forEach(m => {
        const isMissing = report.missingMods.some(x => x.mod_id === m.mod_id);
        const statusText = isMissing ? t('modpack.repair.statusMissing') || "Manquant" : t('modpack.repair.statusCorrupted') || "Corrompu";
        const statusColor = isMissing ? "var(--danger)" : "#fbbf24";
        const fallbackType = m.fallback_type || "direct";
        
        // Vérification de la possibilité de réparation :
        // - Corrompu => peut toujours être réparé localement (fichiers déplacés), pas besoin de lien
        // - Manquant  => nécessite un lien de téléchargement
        const hasLink = fallbackType === "sr" ? !!pack.sr_link : !!(m.download_fallback || m.download_link);
        const isCorrupted = !isMissing; // Corrupted = can be fixed locally (moved file)
        if (hasLink || isCorrupted) canRepairAny = true;
        
        const sourceLabel = hasLink
            ? (fallbackType === "sr" ? "ServerRepo" : t('modpack.repair.directLink') || "Lien Direct")
            : isCorrupted
                ? `<span style="color:#fbbf24; font-weight:800;">${t('modpack.repair.localRecovery') || 'Récupération Locale'}</span>`
                : `<span style="color:var(--danger); font-weight:800;">${t('modpack.repair.linkMissing') || 'Lien Manquant'}</span>`;
        
        modsHtml += `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:12px; background:rgba(255,255,255,0.03); border-radius:12px; border:1px solid rgba(255,255,255,0.05); margin-bottom:8px;">
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <div style="font-size:13px; font-weight:600; color:var(--text-primary);">${m.mod_name}</div>
                    <div style="font-size:10px; color:var(--text-muted);">${m.mod_version}</div>
                </div>
                <div style="text-align:right; display:flex; flex-direction:column; gap:4px;">
                    <div style="font-size:11px; font-weight:800; color:${statusColor}; text-transform:uppercase; letter-spacing:0.5px;">${statusText}</div>
                    <div style="font-size:10px; color:var(--text-muted); opacity:0.6;">Source: ${sourceLabel}</div>
                </div>
            </div>
        `;
    });

    content.innerHTML = `
        <div style="display:flex; align-items:center; gap:14px; margin-bottom:24px;">
            <div style="width:48px; height:48px; border-radius:14px; background:linear-gradient(135deg, rgba(255,136,0,0.2) 0%, rgba(255,85,0,0.05) 100%); color:#ff8800; display:flex; align-items:center; justify-content:center; border:1px solid rgba(255,136,0,0.2);">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
            </div>
            <div style="display:flex; flex-direction:column; gap:4px;">
                <h3 style="font-size:20px; font-weight:800; margin:0; color:var(--text-primary); letter-spacing:-0.5px;">${t('modpack.repair.title') || 'Réparation Requise'}</h3>
                <p style="font-size:12px; color:var(--text-muted); margin:0;">${t('modpack.repair.subtitle') || 'Certains mods sont manquants ou corrompus.'}</p>
            </div>
        </div>
        
        <div style="max-height:350px; overflow-y:auto; margin-bottom:24px; padding-right:8px; display:flex; flex-direction:column;" class="custom-scrollbar">
            ${modsHtml}
        </div>
        
        <div id="repair-progress-container" style="display:none; flex-direction:column; gap:8px; margin-bottom:24px; padding:16px; background:rgba(0,0,0,0.2); border-radius:12px; border:1px solid rgba(255,255,255,0.03);">
            <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">
                <span id="repair-status-text">${t('modpack.repair.preparing') || 'Préparation...'}</span>
                <span id="repair-status-pct" style="color:#ff8800;">0%</span>
            </div>
            <div style="width:100%; height:6px; background:rgba(0,0,0,0.4); border-radius:10px; overflow:hidden;">
                <div id="repair-progress-bar" style="height:100%; background:linear-gradient(90deg, #ff8800, #ff5500); width:0%; transition:width 0.3s ease; box-shadow:0 0 10px rgba(255,136,0,0.5);"></div>
            </div>
        </div>

        <div id="repair-actions" style="display:flex; justify-content:flex-end; gap:12px; margin-top:auto;">
            <button id="repair-cancel" class="btn btn-ghost" style="border:1px solid rgba(255,255,255,0.05); border-radius:10px;">${t('modpack.repair.cancel') || 'Annuler'}</button>
            <button id="repair-start" class="btn btn-primary" style="background:linear-gradient(135deg, #ff8800 0%, #ff5500 100%); border:none; border-radius:10px; box-shadow:0 4px 15px rgba(255, 136, 0, 0.3); ${!canRepairAny ? 'opacity:0.5; cursor:not-allowed;' : ''}" ${!canRepairAny ? 'disabled' : ''}>
                ${canRepairAny ? (t('modpack.repair.startBtn') || 'Réparer et Appliquer') : (t('modpack.repair.impossible') || 'Réparation Impossible')}
            </button>
        </div>
    `;
    
    modalOverlay.appendChild(content);
    
    const appOuter = document.getElementById('app-window-outer') || document.body;
    appOuter.appendChild(modalOverlay);
    
    requestAnimationFrame(() => {
        modalOverlay.style.opacity = '1';
        content.style.transform = 'scale(1)';
    });

    const closeBtn = content.querySelector('#repair-cancel');
    const startBtn = content.querySelector('#repair-start');
    const progressContainer = content.querySelector('#repair-progress-container');
    const statusText = content.querySelector('#repair-status-text');
    const statusPct = content.querySelector('#repair-status-pct');
    const progressBar = content.querySelector('#repair-progress-bar');
    const actionsBlock = content.querySelector('#repair-actions');

    const closeModal = () => {
        modalOverlay.style.opacity = '0';
        content.style.transform = 'scale(0.95)';
        setTimeout(() => modalOverlay.remove(), 300);
    };

    closeBtn.addEventListener('click', closeModal);
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
                    statusText.textContent = `⚠ ${mref.mod_name} : aucun lien fourni, ignoré.`;
                    await new Promise(r => setTimeout(r, 1200));
                    statusText.style.color = '';
                    continue;
                }

                statusText.textContent = `Réparation de ${mref.mod_name}...`;
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
                    if (errStr.includes('aucun lien') || errStr.includes('Aucun lien')) {
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
            toast('Erreur de réparation : ' + err.toString(), 'error');
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

    for (const mref of pack.mods) {
        // Find local mod by ID or SHA-256
        const local = _allMods.find(m => m.id === mref.mod_id || (m.file_hashes && Object.values(m.file_hashes).includes(mref.sha256)));
        if (local) {
            if (isApplying && !local.enabled) {
                await invoke('enable_mod', { modId: local.id });
                appliedCount++;
                if (mref.include_dependencies && local.dependencies && local.dependencies.length > 0) {
                    for (const depId of local.dependencies) {
                        const depLocal = _allMods.find(m => m.id === depId);
                        if (depLocal && !depLocal.enabled) {
                            await invoke('enable_mod', { modId: depId });
                            appliedCount++;
                        }
                    }
                }
            } else if (!isApplying && local.enabled) {
                await invoke('disable_mod', { modId: local.id });
                appliedCount++;
                if (mref.include_dependencies && local.dependencies && local.dependencies.length > 0) {
                    for (const depId of local.dependencies) {
                        const depLocal = _allMods.find(m => m.id === depId);
                        if (depLocal && depLocal.enabled) {
                            await invoke('disable_mod', { modId: depId });
                            appliedCount++;
                        }
                    }
                }
            }
        } else {
            if (isApplying) missingCount++;
        }
    }

    if (isApplying && missingCount > 0) {
        toast(t('modpack.applyPartial').replace('{applied}', appliedCount.toString()).replace('{missing}', missingCount.toString()), 'warning');
    } else {
        toast(isApplying ? t('modpack.applyOk') : t('modpack.deactivateOk') || 'Modpack désactivé avec succès !', 'success');
    }
    
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
        const anyEnabled = pack.mods.some(mref => {
            const local = _allMods.find(m => m.id === mref.mod_id || (m.file_hashes && Object.values(m.file_hashes).includes(mref.sha256)));
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
        toast('Erreur: ' + err.toString(), 'error');
    }
}

async function _exportModpack(pack) {
    if (!pack) return;
    try {
        await invoke('export_modpack', { id: pack.id });
        toast(t('modpack.exportSuccess') || 'Modpack exporté !', 'success');
    } catch (err) {
        if (String(err) !== 'repo.errCancel') toast(String(err), 'error');
    }
}

async function _deleteModpack(container, pack) {
    if (!pack) return;
    
    const ok = await window.confirmCustom(
        t('modpack.delete') || 'Supprimer',
        t('modpack.deleteConfirm') || 'Voulez-vous vraiment supprimer ce modpack ?',
        'danger'
    );
    if (!ok) return;

    try {
        await invoke('delete_modpack', { id: pack.id });
        toast(t('modpack.deletedOk') || 'Modpack supprimé.', 'success');
        await _loadData();
        _renderModpackList(container);
        
        // Notify other components (like Repo page)
        window.dispatchEvent(new CustomEvent('bmm://modpacks-updated'));
    } catch (err) {
        toast(String(err), 'error');
    }
}
