// @ts-nocheck
import { appState } from '../../core/state.js';
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { escHtml } from '../../core/utils.js';
const S = new Proxy(appState.state, {
    get(target, prop) { return target[prop]; },
    set(target, prop, value) { appState.set(prop, value); return true; }
});
let conflictCheckGeneration = 0;
export async function checkAllConflicts() {
    const currentGen = ++conflictCheckGeneration;
    const allModsGlobal = await invoke('get_all_mods').catch(() => []);
    const existingModIds = new Set(allModsGlobal.map(m => m.id));
    Object.keys(S.conflictCache).forEach(mid => {
        if (!existingModIds.has(mid))
            delete S.conflictCache[mid];
    });
    const activeId = S.cachedActiveProfileId || await invoke('get_active_profile_id').catch(() => null);
    if (!activeId && allModsGlobal.length === 0)
        return;
    const BATCH_SIZE = 5;
    const mods = [...allModsGlobal];
    for (let i = 0; i < mods.length; i += BATCH_SIZE) {
        const batch = mods.slice(i, i + BATCH_SIZE);
        if (currentGen !== conflictCheckGeneration)
            return;
        const results = await Promise.allSettled(batch.map(m => invoke('get_mod_conflicts', { modId: m.id })));
        if (currentGen !== conflictCheckGeneration)
            return;
        results.forEach((res, idx) => {
            const mod = batch[idx];
            if (mod && res.status === 'fulfilled' && res.value && res.value.length > 0) {
                S.conflictCache[mod.id] = res.value;
            }
            else if (mod) {
                delete S.conflictCache[mod.id];
            }
        });
        batch.forEach(mod => updateConflictBadgeOnCard(mod.id));
    }
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
            conflictHtml += `<div class="tag-conflict tag-intra-conflict active" onmouseenter="window.showTaskyHelp('lib.conflictActiveTip', 'warning')" onmouseleave="window.hideTaskyHelp()" onclick="window.openGlobalConflictModal('${modId}')" style="cursor:pointer">${intraSvg}Intra</div>`;
        else if (hasIntraPotential)
            conflictHtml += `<div class="tag-conflict tag-intra-conflict potential" onmouseenter="window.showTaskyHelp('lib.conflictPotentialTip', 'warning')" onmouseleave="window.hideTaskyHelp()" onclick="window.openGlobalConflictModal('${modId}')" style="cursor:pointer">${intraSvg}Intra</div>`;
        if (hasInterActive)
            conflictHtml += `<div class="tag-conflict tag-inter-conflict active" onmouseenter="window.showTaskyHelp('lib.conflictInterActiveTip', 'warning')" onmouseleave="window.hideTaskyHelp()" onclick="window.openGlobalConflictModal('${modId}')" style="cursor:pointer">${interSvg}Inter</div>`;
        else if (hasInterPotential)
            conflictHtml += `<div class="tag-conflict tag-inter-conflict potential" onmouseenter="window.showTaskyHelp('lib.conflictInterPotentialTip', 'warning')" onmouseleave="window.hideTaskyHelp()" onclick="window.openGlobalConflictModal('${modId}')" style="cursor:pointer">${interSvg}Inter</div>`;
        if (conflictHtml)
            nameRow.insertAdjacentHTML('beforeend', conflictHtml);
    }
}
export function saveConflictCache() {
    try {
        const serialized = JSON.stringify(S.conflictCache);
        if (serialized.length > 1024 * 1024) {
            console.warn('[CACHE] Conflict cache too large, skipping persistence.');
            return;
        }
        localStorage.setItem('bmm_conflict_cache', serialized);
    }
    catch (e) {
        console.warn('[CACHE] Failed to save conflict cache:', e);
    }
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
    if (!modal || !container)
        return;
    const render = (filter = '') => {
        container.innerHTML = '';
        const entries = Object.entries(S.conflictCache);
        if (entries.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)">${t('conflict.none') || 'Aucun conflit détecté'}</div>`;
            return;
        }
        entries.forEach(([modId, reports]) => {
            const mod = S.allMods.find(m => m.id === modId);
            if (!mod)
                return;
            if (filter && !mod.name.toLowerCase().includes(filter.toLowerCase()))
                return;
            const group = document.createElement('div');
            group.className = 'conflict-group glass';
            group.style.cssText = 'margin-bottom:16px; padding:16px; border-radius:12px; border:1px solid rgba(255,255,255,0.08)';
            let itemsHtml = '';
            reports.forEach(rep => {
                const isWarning = rep.status === 'Potential';
                const color = isWarning ? 'var(--warning)' : 'var(--danger)';
                itemsHtml += `
            <div style="display:flex; gap:12px; margin-top:10px; padding:10px; background:rgba(0,0,0,0.2); border-radius:8px; border-left:3px solid ${color}">
                <div style="flex:1">
                    <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em">${rep.category} Conflict</div>
                    <div style="font-family:var(--font-mono); font-size:12px; margin:4px 0; word-break:break-all">${escHtml(rep.file_path)}</div>
                    <div style="font-size:11px; color:var(--text-secondary)">${t('conflict.with')}: <strong>${escHtml(rep.conflicting_mod_name || rep.conflicting_mod_id)}</strong></div>
                </div>
            </div>
          `;
            });
            group.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between">
            <h4 style="margin:0; color:var(--text-primary)">${escHtml(mod.name)}</h4>
            <span class="badge" style="background:rgba(239,68,68,0.15); color:var(--danger)">${reports.length} files</span>
        </div>
        ${itemsHtml}
      `;
            container.appendChild(group);
        });
    };
    render();
    if (searchInput) {
        searchInput.value = '';
        searchInput.oninput = () => render(searchInput.value);
    }
    modal.classList.add('open');
}
export async function showActivationWarning(modId, conflicts, onConfirm) {
    const modal = document.getElementById('modal-conflict-warning');
    const list = document.getElementById('conflict-warning-list');
    if (!modal || !list)
        return;
    list.innerHTML = conflicts.map(c => `
        <div style="padding:8px; background:rgba(0,0,0,0.2); border-radius:6px; margin-bottom:6px; font-size:12px;">
            <div style="font-family:var(--font-mono); color:var(--warning); word-break:break-all">${escHtml(c.file_path)}</div>
            <div style="color:var(--text-muted); font-size:11px">${t('conflict.with')}: ${escHtml(c.conflicting_mod_name || c.conflicting_mod_id)}</div>
        </div>
    `).join('');
    const btn = document.getElementById('btn-confirm-conflict-ignore');
    if (btn)
        btn.onclick = () => {
            modal.classList.remove('open');
            onConfirm();
        };
    modal.classList.add('open');
}
//# sourceMappingURL=mods-conflicts.js.map