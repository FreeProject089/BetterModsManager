// @ts-nocheck
import { appState } from '../../core/state.js';
import { actAttrs } from '../../core/inline-actions.js';
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr, escJs } from '../../core/utils.js';
import { toast } from '../../ui/app.js';
const S = new Proxy(appState.state, {
    get(target, prop) { return target[prop]; },
    set(target, prop, value) { appState.set(prop, value); return true; }
});
let conflictCheckGeneration = 0;
export async function checkAllConflicts() {
    const currentGen = ++conflictCheckGeneration;
    // ONE batched IPC call instead of N/5 round-trips (was the main import/large-
    // library lag): the backend computes every mod's conflicts behind a single
    // lock pass and returns a `mod_id -> conflicts` map (conflict-free mods omitted).
    let conflictMap = {};
    try {
        conflictMap = await invoke('get_all_mod_conflicts');
    }
    catch {
        return; // backend unavailable / no active profile — leave cache untouched
    }
    if (currentGen !== conflictCheckGeneration)
        return;
    // Rebuild the cache from the fresh map (drops stale/deleted mods automatically).
    const newCache = {};
    for (const id in conflictMap) {
        if (conflictMap[id] && conflictMap[id].length > 0)
            newCache[id] = conflictMap[id];
    }
    // Update only the badges that actually changed to avoid touching every card.
    const changed = new Set([...Object.keys(S.conflictCache), ...Object.keys(newCache)]);
    S.conflictCache = newCache;
    changed.forEach(id => updateConflictBadgeOnCard(id));
    saveConflictCache();
}
export function updateConflictBadgeOnCard(modId) {
    const card = document.querySelector(`.mod-card[data-id="${modId}"]`);
    if (!card)
        return;
    const reports = S.conflictCache[modId] || [];
    const modInfo = card.querySelector('.mod-info');
    const nameRow = modInfo ? modInfo.firstElementChild : null;
    if (!nameRow)
        return;
    nameRow.querySelectorAll('.tag-conflict, .conflict-badge').forEach(e => e.remove());
    if (reports.length > 0) {
        const hasIntraActive = reports.some(c => c.category === 'Intra' && c.status === 'Active');
        const hasIntraPotential = reports.some(c => c.category === 'Intra' && c.status === 'Potential');
        const hasInterActive = reports.some(c => c.category === 'Inter' && c.status === 'Active');
        const hasInterPotential = reports.some(c => c.category === 'Inter' && c.status === 'Potential');
        let conflictHtml = '';
        const intraSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';
        const interSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
        if (hasIntraActive)
            conflictHtml += `<div class="tag-conflict tag-intra-conflict active" data-tasky="lib.conflictActiveTip" data-tasky-icon="warning" ${actAttrs('openGlobalConflictModal', modId)} style="cursor:pointer">${intraSvg}Intra</div>`;
        else if (hasIntraPotential)
            conflictHtml += `<div class="tag-conflict tag-intra-conflict potential" data-tasky="lib.conflictPotentialTip" data-tasky-icon="warning" ${actAttrs('openGlobalConflictModal', modId)} style="cursor:pointer">${intraSvg}Intra</div>`;
        if (hasInterActive)
            conflictHtml += `<div class="tag-conflict tag-inter-conflict active" data-tasky="lib.conflictInterActiveTip" data-tasky-icon="warning" ${actAttrs('openGlobalConflictModal', modId)} style="cursor:pointer">${interSvg}Inter</div>`;
        else if (hasInterPotential)
            conflictHtml += `<div class="tag-conflict tag-inter-conflict potential" data-tasky="lib.conflictInterPotentialTip" data-tasky-icon="warning" ${actAttrs('openGlobalConflictModal', modId)} style="cursor:pointer">${interSvg}Inter</div>`;
        if (conflictHtml)
            nameRow.insertAdjacentHTML('beforeend', conflictHtml);
    }
}
export function saveConflictCache() {
    try {
        localStorage.setItem('bmm_conflict_cache', JSON.stringify(S.conflictCache));
    }
    catch (e) { }
}
export function restoreConflictCache() {
    try {
        const cached = localStorage.getItem('bmm_conflict_cache');
        if (cached)
            S.conflictCache = JSON.parse(cached);
    }
    catch (e) {
        S.conflictCache = {};
    }
}
export async function openGlobalConflictModal(preselectModId = null) {
    const modal = document.getElementById('modal-global-conflicts');
    const container = document.getElementById('global-conflicts-list');
    const searchInput = document.getElementById('global-conflict-search');
    const profileFilter = document.getElementById('global-conflict-profile-filter');
    const typeFilter = document.getElementById('global-conflict-type-filter');
    const sortSelect = document.getElementById('global-conflict-sort-order');
    const closeBtn = document.getElementById('btn-close-global-conflicts');
    if (!modal || !container)
        return;
    try {
        const activeId = await invoke('get_active_profile_id').catch(() => null);
        if (!activeId)
            return toast(t('prof.noneActive'), 'error');
        modal.classList.add('open');
        container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg><br>${t('conflict.loading') || 'Analyse des conflits...'}</div>`;
        let allConflicts = [];
        const allModsGlobal = await invoke('get_all_mods').catch(() => []);
        Object.keys(S.conflictCache).forEach(mid => {
            const reports = S.conflictCache[mid];
            if (reports && reports.length > 0) {
                const mod = allModsGlobal.find(m => m.id === mid);
                const modName = mod?.name || mid;
                const activationOrder = mod?.activation_order ?? -1;
                allConflicts.push({ sourceModId: mid, sourceModName: modName, reports, activationOrder });
            }
        });
        if (preselectModId) {
            const idx = allConflicts.findIndex(c => c.sourceModId === preselectModId);
            if (idx > -1) {
                const [target] = allConflicts.splice(idx, 1);
                allConflicts.unshift(target);
            }
        }
        const profiles = await invoke('get_profiles');
        profileFilter.innerHTML = `<option value="all">${t('conflict.allProfiles') || 'All profiles'}</option>` + profiles.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
        const renderList = (respectPrioritization = false) => {
            const q = searchInput.value.toLowerCase();
            const p = profileFilter.value;
            const tFilter = typeFilter.value;
            const sortBy = sortSelect.value;
            if (!respectPrioritization || !preselectModId) {
                allConflicts.sort((a, b) => {
                    if (sortBy === 'asc')
                        return a.activationOrder - b.activationOrder;
                    return b.activationOrder - a.activationOrder;
                });
            }
            let html = '';
            let totalActive = 0;
            let totalPotential = 0;
            const rendered = [];
            allConflicts.forEach(item => {
                let filteredReports = item.reports;
                if (tFilter !== 'all') {
                    filteredReports = filteredReports.filter(r => r.category.toLowerCase() === tFilter.toLowerCase());
                }
                if (p !== 'all') {
                    const pName = profiles.find(pr => pr.id === p)?.name || '';
                    filteredReports = filteredReports.filter(r => r.other_profile_name === pName);
                }
                if (q) {
                    const sourceMatch = item.sourceModName.toLowerCase().includes(q);
                    if (!sourceMatch) {
                        filteredReports = filteredReports.filter(r => r.other_mod_name.toLowerCase().includes(q));
                    }
                }
                if (filteredReports.length === 0)
                    return;
                const activeCount = filteredReports.filter(r => r.status === 'Active').length;
                const potentialCount = filteredReports.filter(r => r.status === 'Potential').length;
                totalActive += activeCount;
                totalPotential += potentialCount;
                const hasIntra = filteredReports.some(r => r.category === 'Intra');
                const hasInter = filteredReports.some(r => r.category === 'Inter');
                const typeBadges = [
                    hasIntra ? `<span style="font-size:9px;font-weight:800;padding:1px 6px;border-radius:10px;background:rgba(139,92,246,0.15);color:color-mix(in srgb, var(--bmm-purple) 70%, var(--bmm-text-primary));border:1px solid rgba(139,92,246,0.3)">INTRA</span>` : '',
                    hasInter ? `<span style="font-size:9px;font-weight:800;padding:1px 6px;border-radius:10px;background:rgba(59,130,246,0.15);color:var(--accent);border:1px solid rgba(59,130,246,0.3)">INTER</span>` : '',
                ].filter(Boolean).join('');
                const groups = {};
                filteredReports.forEach(r => {
                    if (!groups[r.other_profile_name])
                        groups[r.other_profile_name] = [];
                    groups[r.other_profile_name].push(r);
                });
                const targetsHtml = Object.keys(groups).map(pName => {
                    const grps = groups[pName];
                    grps.sort((a, b) => a.activation_order - b.activation_order);
                    return `
             <div style="margin-bottom:8px">
               <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;padding:4px 8px;background:rgba(255,255,255,0.03);border-radius:6px">
                 <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                 <span style="font-size:10px;color:var(--text-secondary);font-weight:700;text-transform:uppercase;letter-spacing:0.04em">${escHtml(pName)}</span>
                 <span style="font-size:9px;color:var(--text-muted);background:rgba(255,255,255,0.05);padding:1px 5px;border-radius:4px;margin-left:auto">${grps.length} ${grps.length > 1 ? (t('conflict.conflicts') || 'conflicts') : (t('conflict.conflict') || 'conflict')}</span>
               </div>
               <div style="display:flex;flex-direction:column;gap:3px;padding-left:4px">
                 ${grps.map(r => {
                        const isActive = r.status === 'Active';
                        const statusColor = isActive ? 'var(--danger)' : 'var(--warning)';
                        const statusBg = isActive ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)';
                        return `
                   <div style="display:flex;align-items:center;background:${statusBg};padding:7px 10px;border-radius:6px;border-left:2px solid ${statusColor};gap:8px">
                     <span style="font-size:11.5px;font-weight:600;color:var(--text-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:help"
                           data-tooltip="${escAttr(r.other_mod_name)}"
                           data-tasky="${escAttr(escJs(r.other_mod_name))}" data-tasky-icon="package" data-tasky-literal="1"
                          >${escHtml(r.other_mod_name)}</span>
                     ${isActive ? `<span style="font-size:10px;background:rgba(255,255,255,0.08);color:var(--text-secondary);padding:1px 6px;border-radius:4px;font-family:var(--font-mono);flex-shrink:0" data-tooltip="${t('conflict.activationOrder') || 'Activation order'}">#${r.activation_order}</span>` : ''}
                     <button style="font-size:10px;font-family:var(--font-mono);color:var(--accent);background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.2);padding:2px 7px;border-radius:5px;cursor:pointer;flex-shrink:0" ${actAttrs('showConflictContextMenu', item.sourceModId, r.other_mod_id)} data-act-with="event">${r.file_count} ${t('conflict.files') || 'files'}</button>
                     <span style="font-size:9px;font-weight:900;padding:2px 7px;border-radius:10px;text-transform:uppercase;color:${statusColor};border:1px solid ${statusColor};background:${statusBg};flex-shrink:0">${isActive ? (t('conflict.active') || 'ACTIVE') : (t('conflict.potential') || 'POTENTIAL')}</span>
                   </div>`;
                    }).join('')}
               </div>
             </div>
           `;
                }).join('');
                rendered.push(`
          <div class="conflict-group-card" style="background:rgba(0,0,0,0.22);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:10px">
             <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(255,255,255,0.02);border-bottom:1px solid var(--border)">
               <div style="width:6px;height:6px;border-radius:50%;background:${activeCount > 0 ? 'var(--danger)' : 'var(--warning)'};flex-shrink:0;box-shadow:0 0 6px ${activeCount > 0 ? 'var(--danger)' : 'var(--warning)'}"></div>
               <span style="font-weight:700;font-size:12.5px;color:var(--text-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:help"
                     data-tooltip="${escAttr(item.sourceModName)}"
                     data-tasky="${escAttr(escJs(item.sourceModName))}" data-tasky-icon="package" data-tasky-literal="1"
                    >${escHtml(item.sourceModName)}</span>
               <div style="display:flex;align-items:center;gap:5px">${typeBadges}</div>
               ${activeCount > 0 ? `<span style="font-size:9px;font-weight:800;padding:2px 7px;border-radius:10px;color:var(--danger);border:1px solid var(--danger);background:rgba(239,68,68,0.1)">${activeCount} ${t('conflict.active') || 'ACTIVE'}</span>` : ''}
               ${potentialCount > 0 ? `<span style="font-size:9px;font-weight:800;padding:2px 7px;border-radius:10px;color:var(--warning);border:1px solid var(--warning);background:rgba(245,158,11,0.1)">${potentialCount} ${t('conflict.potential') || 'POTENTIAL'}</span>` : ''}
             </div>
             <div style="padding:10px 14px;overflow-y:auto;max-height:280px">
               ${targetsHtml}
             </div>
          </div>
        `);
            });
            if (rendered.length > 0) {
                const summaryBar = `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;margin-bottom:12px;background:rgba(0,0,0,0.2);border-radius:8px;border:1px solid var(--border)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${totalActive > 0 ? 'var(--danger)' : 'var(--warning)'}" stroke-width="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
          <span style="font-size:12px;font-weight:700;color:var(--text-primary)">${rendered.length} ${t('conflict.modsInConflict') || 'mods in conflict'}</span>
          ${totalActive > 0 ? `<span style="font-size:11px;color:var(--danger);font-weight:600">— ${totalActive} ${t('conflict.active') || 'active'}</span>` : ''}
          ${totalPotential > 0 ? `<span style="font-size:11px;color:var(--warning);font-weight:600">— ${totalPotential} ${t('conflict.potential') || 'potential'}</span>` : ''}
        </div>`;
                container.innerHTML = summaryBar + rendered.join('');
            }
            else {
                container.innerHTML = `<div style="padding:48px;text-align:center;color:var(--text-muted)">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.25;margin-bottom:12px"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
          <div>${t('conflict.empty') || 'No conflicts detected.'}</div>
        </div>`;
            }
        };
        renderList(true);
        searchInput.oninput = () => renderList(false);
        profileFilter.onchange = () => renderList(false);
        typeFilter.onchange = () => renderList(false);
        sortSelect.onchange = () => renderList(false);
        if (closeBtn)
            closeBtn.onclick = () => modal.classList.remove('open');
        if (preselectModId) {
            setTimeout(() => {
                searchInput.value = S.allMods.find(m => m.id === preselectModId)?.name || '';
                renderList(true);
            }, 100);
        }
    }
    catch (err) {
        container.innerHTML = '<div style="color:var(--danger)">' + err + '</div>';
    }
}
window.openGlobalConflictModal = openGlobalConflictModal;
export function showConflictContextMenu(e, mod1Id, mod2Id) {
    e.preventDefault();
    const ctx = document.getElementById('conflict-context-menu');
    if (!ctx)
        return;
    ctx.style.display = 'block';
    ctx.style.left = e.pageX + 'px';
    ctx.style.top = e.pageY + 'px';
    const btn = document.getElementById('ctx-open-explorer');
    btn.onclick = async () => {
        ctx.style.display = 'none';
        const modal = document.getElementById('modal-conflict-tree');
        const container = document.getElementById('conflict-tree-container');
        const btnConfirm = document.getElementById('btn-confirm-conflict-tree');
        if (btnConfirm)
            btnConfirm.style.display = 'none';
        modal.style.zIndex = '10005';
        modal.classList.add('open');
        container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted)">${t('conflict.loadingTree') || "Chargement de l'arbre..."}</div>`;
        try {
            // The command now returns { files, total, truncated } and caps the list: two mods can
            // share tens of thousands of paths, and this view builds one DOM row per entry, so an
            // uncapped answer cost a huge payload, a huge HTML string and thousands of nodes at once.
            const tree = await invoke('get_conflict_file_tree', { modId: mod1Id, otherModId: mod2Id });
            const files = Array.isArray(tree) ? tree : (tree?.files || []); // tolerate the old shape
            const total = Array.isArray(tree) ? tree.length : (tree?.total ?? files.length);
            const truncated = Array.isArray(tree) ? false : !!tree?.truncated;
            if (files.length === 0) {
                container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted)">${t('conflict.noTreeFiles')}</div>`;
                return;
            }
            container.innerHTML = files.map(f => `<div style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.05);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.4;min-height:24px;display:flex;align-items:center;gap:8px;cursor:pointer;transition:all 0.15s ease;border-radius:6px;margin-bottom:2px"
           data-hover="background:rgba(59,130,246,0.15);border-left:2px solid var(--accent)"
           data-hover-out="background:transparent;border-left:none"
           ${actAttrs('showFileConflictSelector', f, mod1Id, mod2Id)} data-act-with="event"
           data-tooltip="${escAttr(f)}" data-tooltip="${escAttr(f)}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;color:var(--accent)"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;font-size:11.5px;color:var(--text-primary)">${escHtml(f)}</span>
      </div>`).join('');
            // Say so when the list was cut, rather than silently implying these are all of them.
            if (truncated) {
                container.innerHTML += `<div style="padding:10px;text-align:center;font-size:11px;color:var(--text-muted)">`
                    + (t('conflict.treeTruncated') || 'Showing the first {n} of {total} shared files.')
                        .replace('{n}', String(files.length)).replace('{total}', String(total))
                    + `</div>`;
            }
        }
        catch (err) {
            container.innerHTML = `<span style="color:var(--danger)">${t('common.error') || "Error"}: ${err}</span>`;
        }
    };
    document.addEventListener('mousedown', function hideCtx(ev) {
        if (!ctx.contains(ev.target)) {
            ctx.style.display = 'none';
            document.removeEventListener('mousedown', hideCtx);
        }
    });
}
window.showConflictContextMenu = showConflictContextMenu;
let fileConflictSelectorState = {
    currentFile: '',
    modIds: [],
    selectedMods: new Set()
};
export async function showFileConflictSelectorAsync(e, filePath, mod1Id, mod2Id) {
    e.preventDefault();
    const modal = document.getElementById('modal-conflict-file-selector');
    const nameLabel = document.getElementById('conflict-file-selector-name');
    const list = document.getElementById('conflict-file-selector-list');
    const openBtn = document.getElementById('btn-open-conflict-files');
    const cancelBtn = document.getElementById('btn-cancel-conflict-file-selector');
    const closeBtn = document.getElementById('btn-close-conflict-file-selector');
    if (!modal)
        return;
    fileConflictSelectorState = {
        currentFile: filePath,
        modIds: [mod1Id, mod2Id],
        selectedMods: new Set()
    };
    nameLabel.textContent = filePath;
    list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">Chargement...</div>';
    const allModsGlobal = await invoke('get_all_mods').catch(() => []);
    const modsByIdMap = new Map(allModsGlobal.map(m => [m.id, m]));
    list.innerHTML = [mod1Id, mod2Id].map(modId => {
        const mod = modsByIdMap.get(modId);
        const modName = mod?.name || modId;
        const checkboxId = `conflict-mod-checkbox-${modId}`;
        return `
      <label style="display:flex;align-items:center;gap:10px;padding:12px;background:rgba(255,255,255,0.03);border-radius:8px;cursor:pointer;border:1.5px solid rgba(255,255,255,0.1);transition:all 0.15s ease"
           data-hover="background:rgba(59,130,246,0.1);border-color:rgba(59,130,246,0.3);box-shadow:0 0 0 1px rgba(59,130,246,0.2)"
           data-hover-out="background:rgba(255,255,255,0.03);border-color:rgba(255,255,255,0.1);box-shadow:none">
        <input type="checkbox" id="${checkboxId}" style="width:18px;height:18px;cursor:pointer;accent-color:var(--accent);flex-shrink:0" data-act-change="toggleModSelector" data-act-change-args='["${modId}"]'>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(modName)}</div>
          <div style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);margin-top:2px">${escHtml(modId)}</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;color:var(--accent);opacity:0.6">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      </label>
    `;
    }).join('');
    cancelBtn.onclick = () => modal.classList.remove('open');
    closeBtn.onclick = () => modal.classList.remove('open');
    openBtn.onclick = async () => {
        if (fileConflictSelectorState.selectedMods.size === 0) {
            toast(t('common.selectOneMod') || 'Select at least one mod', 'warning');
            return;
        }
        modal.classList.remove('open');
        for (const modId of fileConflictSelectorState.selectedMods) {
            try {
                await invoke('open_mod_folder_at', { modId, relativePath: filePath });
            }
            catch (err) {
                toast(t('toast.openError', { id: modId, err: String(err) }) || `Error opening ${modId}: ${err}`, 'error');
            }
        }
    };
    modal.classList.add('open');
}
export function showFileConflictSelector(e, filePath, mod1Id, mod2Id) {
    showFileConflictSelectorAsync(e, filePath, mod1Id, mod2Id).catch(err => {
        console.error('Erreur sélecteur conflit:', err);
        toast((t('common.error') || 'Error') + ': ' + err, 'error');
    });
}
window.showFileConflictSelector = showFileConflictSelector;
export function toggleModSelector(modId) {
    if (fileConflictSelectorState.selectedMods.has(modId)) {
        fileConflictSelectorState.selectedMods.delete(modId);
    }
    else {
        fileConflictSelectorState.selectedMods.add(modId);
    }
}
window.toggleModSelector = toggleModSelector;
export function showActivationWarning(modId, conflicts, onConfirm) {
    const modal = document.getElementById('modal-activation-warning');
    const list = document.getElementById('activation-warning-list');
    const btn = document.getElementById('btn-confirm-activation-anyway');
    const cancelBtn = document.getElementById('btn-cancel-activation-warning');
    const orderPanel = document.getElementById('activation-order-panel');
    const orderList = document.getElementById('activation-order-list');
    if (!modal)
        return;
    list.innerHTML = conflicts.map(c => `
    <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(0,0,0,0.3);padding:8px 12px;border-radius:6px;border-left:3px solid ${c.status === 'Active' ? 'var(--danger)' : 'var(--warning)'}">
      <div style="flex:1;min-width:0;padding-right:10px">
        <div style="font-size:12px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" data-tooltip="${escAttr(c.other_mod_name)}">${escHtml(c.other_mod_name)}</div>
        <div style="font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(c.other_profile_name)}</div>
      </div>
      <div style="font-size:10px;font-weight:900;padding:2px 6px;border-radius:12px;color:${c.status === 'Active' ? 'var(--danger)' : 'var(--warning)'};border:1px solid ${c.status === 'Active' ? 'var(--danger)' : 'var(--warning)'};flex-shrink:0">
        ${c.status === 'Active' ? (t('conflict.active') || 'ACTIF') : (t('conflict.potential') || 'POTENTIEL')}
      </div>
    </div>
  `).join('');
    const activeConflicts = conflicts.filter(c => c.status === 'Active');
    if (activeConflicts.length > 0) {
        activeConflicts.sort((a, b) => a.activation_order - b.activation_order);
        orderList.innerHTML = activeConflicts.map(c => `
      <div style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;background:rgba(255,255,255,0.04)">
        <span style="font-size:10px;background:rgba(255,255,255,0.12);color:var(--text-primary);padding:1px 6px;border-radius:4px;font-weight:700;flex-shrink:0">#${c.activation_order}</span>
        <span style="font-size:11px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" data-tooltip="${escAttr(c.other_mod_name)}">${escHtml(c.other_mod_name)}</span>
        <span style="font-size:9px;color:var(--text-muted);flex-shrink:0">${escHtml(c.other_profile_name)}</span>
      </div>
    `).join('');
        orderPanel.style.display = '';
    }
    else {
        orderPanel.style.display = 'none';
    }
    btn.onclick = () => {
        modal.classList.remove('open');
        onConfirm();
    };
    if (cancelBtn)
        cancelBtn.onclick = () => modal.classList.remove('open');
    modal.classList.add('open');
}
window.showActivationWarning = showActivationWarning;
//# sourceMappingURL=mods-conflicts.js.map