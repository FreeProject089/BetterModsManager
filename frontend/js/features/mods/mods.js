// @ts-nocheck
import { invoke, listenFileDrop, pickFolder } from '../../core/api.js';
import { toast } from '../../ui/app.js';
import { renderProfiles } from '../profiles/profiles.js';
import { t } from '../../core/i18n.js';
import { escHtml } from '../../core/utils.js';
import { appState } from '../../core/state.js';
// Sub-modules
import { renderModList, updateBadge, updateSubtitle, updateToggleAllBtn } from './mods-list.js';
import { checkAllConflicts, restoreConflictCache } from './mods-conflicts.js';
import { openAddModModal, confirmAddMod, toggleAllMods, scanModsFolder, verifyIntegrity } from './mods-actions.js';
import { selectMod, closeModDetail, renderModDetail } from './mods-details.js';
import { openQuickApplyModal } from './modpack-creator.js';
const S = new Proxy(appState.state, {
    get(target, prop) { return target[prop]; },
    set(target, prop, value) { appState.set(prop, value); return true; }
});
let refreshTimeout = null;
export async function initMods() {
    window._refreshModsFn = refreshMods;
    // --- Core Listeners ---
    document.getElementById('btn-add-mod')?.addEventListener('click', openAddModModal);
    document.getElementById('btn-quick-apply-modpack')?.addEventListener('click', openQuickApplyModal);
    document.getElementById('btn-confirm-add-mod')?.addEventListener('click', confirmAddMod);
    document.getElementById('btn-enable-all')?.addEventListener('click', () => toggleAllMods());
    document.getElementById('btn-disable-all-alt')?.addEventListener('click', () => toggleAllMods(false));
    document.getElementById('btn-scan-mods')?.addEventListener('click', scanModsFolder);
    document.getElementById('btn-verify-integrity')?.addEventListener('click', verifyIntegrity);
    document.getElementById('btn-close-detail')?.addEventListener('click', closeModDetail);
    // Add Mod folder picker
    document.getElementById('btn-pick-mod-folder')?.addEventListener('click', async () => {
        try {
            const folder = await pickFolder();
            if (folder) {
                document.getElementById('mod-folder').value = folder;
            }
        }
        catch (error) {
            console.error('Error picking folder:', error);
            toast((window.t ? window.t('common.error') : 'Error'), 'error');
        }
    });
    const viewBtn = document.getElementById('btn-view-mode');
    const modlist = document.getElementById('mod-list');
    const scrollContainer = document.querySelector('.content-area'); // Fixed selector typo (Issue 21)
    if (S.isCompact && modlist)
        modlist.classList.add('compact');
    // React to state changes with debouncing
    let stateChangeTimeout = null;
    const debouncedRender = () => {
        if (stateChangeTimeout) {
            clearTimeout(stateChangeTimeout);
        }
        stateChangeTimeout = setTimeout(() => {
            renderModList(true);
            stateChangeTimeout = null;
        }, 50); // 50ms debounce for better performance
    };
    appState.subscribe('isCompact', (val) => {
        if (modlist)
            modlist.classList.toggle('compact', val);
        debouncedRender();
    });
    appState.subscribe('currentFilter', debouncedRender);
    appState.subscribe('currentSort', debouncedRender);
    viewBtn?.addEventListener('click', () => {
        S.isCompact = !S.isCompact;
        localStorage.setItem('bmm-view-compact', S.isCompact);
    });
    if (scrollContainer) {
        let scrollTimeout = null;
        scrollContainer.addEventListener('scroll', () => {
            // Throttle scroll events to improve performance
            if (scrollTimeout) {
                cancelAnimationFrame(scrollTimeout);
            }
            scrollTimeout = requestAnimationFrame(() => renderModList(false));
        }, { passive: true });
    }
    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            S.currentFilter = e.currentTarget.dataset.filter;
            renderModList(true);
            try {
                const settings = await invoke('get_settings');
                settings.current_filter = S.currentFilter;
                await invoke('update_settings', { settings });
            }
            catch (e) { }
        });
    });
    // Search
    const searchInput = document.getElementById('mod-search');
    searchInput?.addEventListener('input', e => {
        S.searchQuery = e.target.value.toLowerCase();
        renderModList(true);
    });
    // Sort
    const sortSelect = document.getElementById('mod-sort');
    sortSelect?.addEventListener('change', async (e) => {
        S.currentSort = e.target.value;
        renderModList(true);
        try {
            const settings = await invoke('get_settings');
            settings.current_sort_by = S.currentSort;
            await invoke('update_settings', { settings });
        }
        catch (e) { }
    });
    // Tag Filter
    const tagFilterSelect = document.getElementById('mod-tag-filter');
    tagFilterSelect?.addEventListener('change', e => {
        S.currentTagFilter = e.target.value;
        renderModList(true);
    });
    // History
    document.getElementById('btn-show-history')?.addEventListener('click', async () => {
        const activeId = await invoke('get_active_profile_id').catch(() => null);
        if (!activeId)
            return toast(t('prof.noneActive'), 'error');
        try {
            const history = await invoke('get_activity_history', { profileId: activeId });
            renderHistoryModal(history);
        }
        catch (err) {
            toast(t('history.error') + ' : ' + err, 'error');
        }
    });
    // File Drop
    listenFileDrop(async (paths) => {
        const libView = document.getElementById('view-library');
        if (!libView || !libView.classList.contains('active'))
            return;
        if (document.querySelector('.modal-overlay.open'))
            return;
        if (paths && paths.length > 0) {
            openAddModModal();
            const folderInput = document.getElementById('mod-folder');
            if (folderInput)
                folderInput.value = paths[0];
            const nameInput = document.getElementById('mod-name');
            if (nameInput) {
                const parts = paths[0].replace(/\\/g, '/').split('/');
                nameInput.value = parts[parts.length - 1] || '';
            }
        }
    });
    // Initial Data Load
    try {
        const settings = await invoke('get_settings').catch(() => null);
        if (settings) {
            S.currentFilter = settings.current_filter || 'all';
            S.currentSort = settings.current_sort_by || 'name_asc';
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === S.currentFilter));
            const sortSelect = document.getElementById('mod-sort');
            if (sortSelect)
                sortSelect.value = S.currentSort;
        }
        S.userTags = await invoke('get_tags').catch(() => []);
        S.allMods = await invoke('get_mods');
        updateTagFilterUI();
        renderModList();
    }
    catch (err) {
        S.allMods = [];
    }
    updateBadge();
    updateSubtitle();
    restoreConflictCache();
    if (S.selectedModId) {
        const m = S.allMods.find(mod => mod.id === S.selectedModId);
        if (m)
            renderModDetail(m.id);
        else
            closeModDetail();
    }
    checkAllConflicts();
}
export async function refreshMods(autoScan = false, immediate = false) {
    if (refreshTimeout) {
        clearTimeout(refreshTimeout);
        refreshTimeout = null;
    }
    const doRefresh = async () => {
        if (autoScan && S.processingMods.size === 0) {
            const activeId = S.cachedActiveProfileId || await invoke('get_active_profile_id').catch(() => null);
            if (activeId)
                await invoke('scan_mods_folder').catch(() => { });
        }
        try {
            S.userTags = await invoke('get_tags').catch(() => []);
            S.allMods = await invoke('get_mods').catch(() => []);
            S.cachedActiveProfileId = await invoke('get_active_profile_id').catch(() => null);
        }
        catch (err) {
            S.allMods = [];
        }
        updateBadge();
        updateSubtitle();
        updateToggleAllBtn();
        try {
            renderProfiles();
        }
        catch (e) { }
        updateTagFilterUI();
        renderModList(true);
        if (S.selectedModId)
            renderModDetail(S.selectedModId);
        checkAllConflicts();
    };
    if (immediate)
        return await doRefresh();
    return new Promise(resolve => {
        refreshTimeout = setTimeout(async () => { await doRefresh(); refreshTimeout = null; resolve(); }, 200);
    });
}
function renderHistoryModal(history) {
    const list = document.getElementById('history-list');
    if (!list)
        return;
    list.innerHTML = '';
    if (!history || history.length === 0) {
        list.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:20px">${t('history.empty')}</div>`;
    }
    else {
        history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        history.forEach(item => {
            const isEnabled = item.action === 'Enabled';
            const color = isEnabled ? 'var(--success)' : 'var(--text-muted)';
            const actionText = isEnabled ? t('mod.statusActive') : t('mod.statusInactive');
            const dateStr = new Date(item.timestamp).toLocaleString();
            list.innerHTML += `
        <div style="display:flex;align-items:center;gap:12px;padding:10px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid var(--border)">
          <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></div>
          <div style="flex:1">
            <div style="font-weight:600;color:var(--text-primary);word-break:break-all">${escHtml(item.mod_name)}</div>
            <div style="font-size:12px;color:var(--text-muted)">${dateStr}</div>
          </div>
          <div style="font-size:11px;font-family:var(--font-mono);padding:3px 8px;border-radius:6px;background:${isEnabled ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)'};color:${color}">
            ${actionText}
          </div>
        </div>
      `;
        });
    }
    document.getElementById('modal-history')?.classList.add('open');
}
function updateTagFilterUI() {
    const select = document.getElementById('mod-tag-filter');
    if (!select)
        return;
    const currentVal = S.currentTagFilter || 'all';
    let html = `<option value="all" data-i18n="lib.tagFilterAll">${t('lib.tagFilterAll') || 'All tags'}</option>`;
    if (S.userTags && S.userTags.length > 0) {
        const sortedTags = [...S.userTags].sort((a, b) => a.name.localeCompare(b.name));
        sortedTags.forEach((tag) => {
            html += `<option value="${tag.id}">${escHtml(tag.name)}</option>`;
        });
    }
    select.innerHTML = html;
    select.value = currentVal;
}
export { selectMod, closeModDetail, renderModDetail };
//# sourceMappingURL=mods.js.map