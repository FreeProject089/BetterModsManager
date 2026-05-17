// @ts-nocheck
/**
 * profiles.js — Profile management
 */
import { invoke, pickFolder } from '../../core/api.js';
import { toast, updateLibraryProfileSelector } from '../../ui/app.js';
import { pickFile, convertFileSrc } from '../../core/api.js';
import { t, applyTranslations } from '../../core/i18n.js';
import { dispatchBmmAction, BMM_ACTIONS } from '../../ui/tutorial-events.js';
window.pendingBgState = { action: null, tmpPath: null }; // Tracks 'apply', 'remove', or null
let selectedGlobalModIds = new Set();
let selectedProfileIds = new Set();
let lastClickedGlobalModId = null;
let allModsCache = []; // Global cache for all mods
export async function initProfiles() {
    document.getElementById('btn-new-profile').addEventListener('click', openNewProfileModal);
    document.getElementById('btn-confirm-profile').addEventListener('click', confirmCreateProfile);
    // Generic dropdown logic
    const importMenuBtn = document.getElementById('btn-import-menu');
    const importDropdown = document.getElementById('import-dropdown-container');
    if (importMenuBtn && importDropdown) {
        importMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            importDropdown.classList.toggle('active');
        });
        document.addEventListener('click', () => {
            importDropdown.classList.remove('active');
        });
    }
    // OvGME Import
    const btnImportOvgme = document.getElementById('btn-import-ovgme');
    if (btnImportOvgme) {
        btnImportOvgme.addEventListener('click', async (e) => {
            e.preventDefault();
            importDropdown.classList.remove('active');
            const originalText = btnImportOvgme.innerHTML;
            btnImportOvgme.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;vertical-align:middle;margin-right:6px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>...';
            try {
                const count = await invoke('import_ovgme_profiles');
                if (count > 0) {
                    toast(t('prof.importSuccess').replace('{count}', count), 'success');
                    await renderProfiles();
                    updateProfileChip();
                    updateLibraryProfileSelector();
                    // Refresh repo export profiles list
                    const profilesListEl = document.getElementById('repo-export-profiles-list');
                    if (profilesListEl) {
                        const { loadProfilesForExport } = await import('../repo/repo.js');
                        await loadProfilesForExport(profilesListEl);
                    }
                }
                else {
                    toast(t('prof.importNone'), 'info');
                }
            }
            catch (err) {
                toast(t('prof.importError', { type: 'OvGME', err }), 'error');
            }
            finally {
                btnImportOvgme.innerHTML = originalText;
            }
        });
    }
    // OMM Auto Import
    const btnImportOmmAuto = document.getElementById('btn-import-omm-auto');
    if (btnImportOmmAuto) {
        btnImportOmmAuto.addEventListener('click', async (e) => {
            e.preventDefault();
            importDropdown.classList.remove('active');
            const originalText = btnImportOmmAuto.innerHTML;
            btnImportOmmAuto.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;vertical-align:middle;margin-right:6px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>...';
            try {
                const count = await invoke('auto_import_omm');
                if (count > 0) {
                    toast(t('prof.importSuccess', { type: 'OMM', count }), 'success');
                    await renderProfiles();
                    updateProfileChip();
                    updateLibraryProfileSelector();
                }
                else {
                    toast(t('prof.importNone'), 'info');
                }
            }
            catch (err) {
                toast(t('prof.importError', { type: 'OMM Auto', err }), 'error');
            }
            finally {
                btnImportOmmAuto.innerHTML = originalText;
            }
        });
    }
    // OMM Manual Import
    const btnImportOmm = document.getElementById('btn-import-omm');
    if (btnImportOmm) {
        btnImportOmm.addEventListener('click', async (e) => {
            e.preventDefault();
            importDropdown.classList.remove('active');
            // Use explicit filter object for better compatibility
            const path = await pickFile([{ name: 'Open Mod Manager', extensions: ['omx', 'omc'] }]);
            if (!path)
                return;
            const originalText = btnImportOmm.innerHTML;
            btnImportOmm.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;vertical-align:middle;margin-right:6px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>...';
            try {
                const count = await invoke('import_omm_profile', { path });
                if (count > 0) {
                    toast(t('prof.importSuccess', { type: 'OMM', count }), 'success');
                    await renderProfiles();
                    updateProfileChip();
                    updateLibraryProfileSelector();
                    // Refresh repo export profiles list
                    const profilesListEl = document.getElementById('repo-export-profiles-list');
                    if (profilesListEl) {
                        const { loadProfilesForExport } = await import('../repo/repo.js');
                        await loadProfilesForExport(profilesListEl);
                    }
                }
                else {
                    toast(t('prof.importNone'), 'info');
                }
            }
            catch (err) {
                toast(t('prof.importError', { type: 'OMM', err }), 'error');
            }
            finally {
                btnImportOmm.innerHTML = originalText;
            }
        });
    }
    document.getElementById('btn-pick-game-path').addEventListener('click', async () => {
        const path = await pickFolder();
        if (path)
            document.getElementById('prof-game-path').value = path;
    });
    document.getElementById('btn-pick-mods-path').addEventListener('click', async () => {
        const path = await pickFolder();
        if (path)
            document.getElementById('prof-mods-path').value = path;
    });
    document.getElementById('btn-pick-backup-path').addEventListener('click', async () => {
        const path = await pickFolder();
        if (path)
            document.getElementById('prof-backup-path').value = path;
    });
    // Edit profile specific buttons
    document.getElementById('btn-edit-pick-game-path').addEventListener('click', async () => {
        const path = await pickFolder();
        if (path)
            document.getElementById('edit-prof-game-path').value = path;
    });
    document.getElementById('btn-edit-pick-mods-path').addEventListener('click', async () => {
        const path = await pickFolder();
        if (path)
            document.getElementById('edit-prof-mods-path').value = path;
    });
    document.getElementById('btn-edit-pick-backup-path').addEventListener('click', async () => {
        const path = await pickFolder();
        if (path)
            document.getElementById('edit-prof-backup-path').value = path;
    });
    document.getElementById('btn-confirm-edit-profile').addEventListener('click', confirmEditProfile);
    // Initialize Icon Pickers
    renderIconPicker('prof-icon-grid', 'prof-icon');
    renderIconPicker('edit-prof-icon-grid', 'edit-prof-icon');
    window._refreshProfilesFn = renderProfiles;
    // Global Active Mods actions
    const btnDisableAllGlobal = document.getElementById('btn-disable-all-global');
    if (btnDisableAllGlobal) {
        btnDisableAllGlobal.addEventListener('click', async () => {
            const activeModsContainer = document.getElementById('global-active-mods-list');
            const items = activeModsContainer.querySelectorAll('.global-active-mod-item');
            if (items.length === 0 && selectedProfileIds.size === 0)
                return;
            let msg, confirmTitle;
            if (selectedProfileIds.size > 0) {
                msg = t('prof.confirmDisableSelected').replace('{count}', selectedProfileIds.size);
                confirmTitle = t('prof.disableSelected');
            }
            else {
                msg = t('prof.confirmDisableAllGlobal');
                confirmTitle = t('prof.disableAll');
            }
            const ok = await window.confirmCustom(confirmTitle, msg, 'danger');
            if (ok) {
                await disableAllRequestedMods();
            }
        });
    }
    // Global Context Menu click outside
    document.addEventListener('mousedown', (e) => {
        const menu = document.getElementById('global-mods-context-menu');
        if (menu && menu.style.display === 'block') {
            if (!e.target.closest('#global-mods-context-menu')) {
                menu.style.display = 'none';
            }
        }
        // Deselect on click outside
        if (selectedProfileIds.size > 0 || selectedGlobalModIds.size > 0) {
            const isClickInsideProfile = e.target.closest('.profile-card');
            const isClickInsideModItem = e.target.closest('.global-active-mod-item');
            const isClickInsideActions = e.target.closest('.profiles-active-mods-header-actions') || e.target.closest('#btn-disable-all-global');
            if (!isClickInsideProfile && !isClickInsideModItem && !isClickInsideActions) {
                selectedProfileIds.clear();
                selectedGlobalModIds.clear();
                renderProfiles();
            }
        }
    });
    // Global Context Menu actions
    document.getElementById('ctx-global-mod-disable')?.addEventListener('click', async () => {
        if (lastClickedGlobalModId) {
            await disableGlobalMods([lastClickedGlobalModId]);
        }
        document.getElementById('global-mods-context-menu').style.display = 'none';
    });
    document.getElementById('ctx-global-mod-disable-selected')?.addEventListener('click', async () => {
        if (selectedGlobalModIds.size > 0) {
            await disableGlobalMods(Array.from(selectedGlobalModIds));
            selectedGlobalModIds.clear();
        }
        document.getElementById('global-mods-context-menu').style.display = 'none';
    });
    await renderProfiles();
}
async function disableAllRequestedMods() {
    const profiles = await invoke('get_profiles');
    let profileIds = [];
    if (selectedProfileIds.size > 0) {
        profileIds = Array.from(selectedProfileIds);
    }
    else {
        // Disable All means ALL profiles
        profileIds = profiles.map(p => p.id);
    }
    if (profileIds.length === 0)
        return;
    const btn = document.getElementById('btn-disable-all-global');
    const originalContent = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="spin" style="margin-right:4px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> <span>${t('common.loading') || '...'}</span>`;
    }
    document.body.classList.add('loading');
    try {
        await invoke('disable_mods_for_profiles', { profileIds });
        toast(t('prof.modsDisabledBulk'), 'success');
    }
    catch (err) {
        toast(t('common.error') + ": " + err, 'error');
    }
    finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }
        document.body.classList.remove('loading');
        selectedProfileIds.clear();
        allModsCache = []; // Force refresh
        await renderProfiles();
    }
}
async function disableGlobalMods(modIds) {
    if (!modIds || modIds.length === 0)
        return;
    // Show a global loader if many mods
    const wasLoading = document.body.classList.contains('loading');
    if (modIds.length > 5)
        document.body.classList.add('loading');
    try {
        const profiles = await invoke('get_profiles');
        const activeProfileId = await invoke('get_active_profile_id');
        for (const modId of modIds) {
            // Find all profiles where it is active
            const targetProfiles = profiles.filter(p => Array.isArray(p.active_mods) && p.active_mods.includes(modId));
            for (const p of targetProfiles) {
                // If it's the active profile, we can use the regular disable_mod
                // Otherwise we might need to set it directly in the profile data
                // But the backend `disable_mod` actually syncs all profiles on the same root!
                // So calling it once per root is enough.
                // For simplicity, we'll try to use the most "correct" one.
                // If the mod is in the active profile's mods_path, we use it.
                await invoke('disable_mod', { modId });
                // Wait, disable_mod takes (window, state, mod_id). 
                // The frontend invoke only passes mod_id.
                // It uses the active profile in the backend.
            }
        }
        toast(t('prof.modsDisabled', { count: modIds.length }) || `${modIds.length} mods désactivés`, 'success');
        // Force cache refresh by clearing it before re-rendering
        allModsCache = [];
        await renderProfiles();
        const { refreshMods } = await import('../mods/mods.js');
        await refreshMods(true);
    }
    catch (err) {
        toast(t('common.error') + ' : ' + err, 'error');
    }
    finally {
        if (!wasLoading)
            document.body.classList.remove('loading');
    }
}
const AVAILABLE_ICONS = [
    // Row 1 — Essentials
    'star', 'flame', 'key', 'headphones', 'toggle', 'megaphone', 'radio', 'target',
    // Row 2 — Environment
    'gear', 'snowflake', 'sun', 'shield', 'wind', 'plane', 'wifi', 'bomb',
    // Row 3 — People & objects
    'hammer', 'user', 'globe', 'cursor', 'volume', 'music', 'bell', 'anchor',
    // Row 4 — Tech
    'zap', 'cpu', 'map', 'mountain', 'rocket', 'gamepad', 'sword', 'car',
    // Row 5 — Misc
    'triangle-alert', 'eye', 'heart', 'activity', 'package', 'database',
    'camera', 'briefcase', 'ghost', 'joystick', 'terminal', 'aperture', 'flask', 'moon',
    // Row 6 — Code & system
    'code', 'monitor', 'server', 'printer', 'keyboard', 'mouse-icon',
    'bluetooth', 'satellite', 'router', 'cloud',
    // Row 7 — Transport
    'bus', 'truck', 'ship', 'bicycle', 'train', 'helicopter',
    // Row 8 — Media & entertainment
    'film', 'tv', 'speaker', 'mic', 'clapperboard', 'disc',
    // Row 9 — Sport & fitness
    'trophy', 'medal', 'dumbbell', 'bike', 'swords', 'shield-check',
    // Row 10 — Tools & writing
    'pen', 'ruler', 'compass-icon', 'scissors-icon', 'book', 'bookmark-icon',
    // Row 11 — Time & calendar
    'clock', 'calendar', 'hourglass', 'alarm',
    // Row 12 — Nature & animals
    'tree', 'leaf', 'flower', 'bird', 'fish', 'bug',
    // Row 13 — Places & buildings
    'home', 'building', 'flag', 'castle', 'tent',
    // Row 14 — Symbols & shapes
    'infinity', 'diamond', 'hexagon', 'layers-icon',
    'fingerprint', 'sparkles', 'atom', 'crown',
    // Row 15 — Actions
    'lock', 'unlock-icon', 'search-icon', 'filter-icon',
    'share-icon', 'download-icon', 'upload-icon', 'link-icon',
];
function renderIconPicker(gridId, hiddenInputId) {
    const grid = document.getElementById(gridId);
    if (!grid)
        return;
    grid.innerHTML = '';
    const input = document.getElementById(hiddenInputId);
    AVAILABLE_ICONS.forEach(iconName => {
        const item = document.createElement('div');
        item.className = 'icon-option';
        if (input && input.value === iconName)
            item.classList.add('selected');
        item.dataset.icon = iconName;
        item.innerHTML = getProfileIconSvg(iconName, 'width:18px;height:18px');
        item.addEventListener('click', () => {
            grid.querySelectorAll('.icon-option').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');
            if (input)
                input.value = iconName;
        });
        grid.appendChild(item);
    });
}
function updateIconPickerSelection(gridId, iconName) {
    const grid = document.getElementById(gridId);
    if (!grid)
        return;
    grid.querySelectorAll('.icon-option').forEach(el => {
        el.classList.toggle('selected', el.dataset.icon === iconName);
    });
}
export function openNewProfileModal() {
    // Clear fields
    ['prof-name', 'prof-game', 'prof-game-path', 'prof-mods-path', 'prof-backup-path']
        .forEach(id => document.getElementById(id).value = '');
    document.getElementById('prof-color').value = '#3b82f6';
    document.getElementById('prof-icon').value = '';
    updateIconPickerSelection('prof-icon-grid', '');
    document.getElementById('modal-new-profile').classList.add('open');
}
async function checkDuplicateModsFolder(targetPath, currentProfileId = null) {
    if (localStorage.getItem('bmm_ignore_duplicate_folder') === 'true')
        return null;
    try {
        const profiles = await invoke('get_profiles');
        const duplicate = profiles.find(p => p.id !== currentProfileId && p.mods_path.toLowerCase().replace(/[\\/]$/, '') === targetPath.toLowerCase().replace(/[\\/]$/, ''));
        return duplicate ? duplicate.name : null;
    }
    catch {
        return null;
    }
}
function showDuplicateFolderModal(conflictingProfileName) {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-duplicate-folder-warning');
        const btnConfirm = document.getElementById('btn-confirm-duplicate-folder');
        const btnCancel = modal.querySelector('[data-close="modal-duplicate-folder-warning"]');
        const checkbox = document.getElementById('duplicate-folder-ignore-forever');
        const msgText = document.getElementById('duplicate-folder-msg-text') || modal.querySelector('[data-i18n="prof.duplicateFolderMsg"]');
        if (!modal || !btnConfirm) {
            resolve(true);
            return;
        }
        if (msgText) {
            const safeName = escHtml(conflictingProfileName);
            msgText.innerHTML = t('prof.duplicateFolderMsg', {
                profile: `<strong style="color:var(--text-primary)">${safeName}</strong>`
            });
        }
        const onConfirm = () => {
            if (checkbox.checked)
                localStorage.setItem('bmm_ignore_duplicate_folder', 'true');
            cleanup();
            resolve(true);
        };
        const onCancel = () => {
            cleanup();
            resolve(false);
        };
        const cleanup = () => {
            btnConfirm.removeEventListener('click', onConfirm);
            if (btnCancel)
                btnCancel.removeEventListener('click', onCancel);
            modal.classList.remove('open');
        };
        btnConfirm.addEventListener('click', onConfirm);
        if (btnCancel)
            btnCancel.addEventListener('click', onCancel);
        modal.classList.add('open');
    });
}
async function confirmCreateProfile() {
    const name = document.getElementById('prof-name').value.trim();
    const gameName = document.getElementById('prof-game').value.trim();
    const gamePath = document.getElementById('prof-game-path').value.trim();
    const modsPath = document.getElementById('prof-mods-path').value.trim();
    const backupPath = document.getElementById('prof-backup-path').value.trim();
    const color = document.getElementById('prof-color').value || '#3b82f6';
    const icon = document.getElementById('prof-icon').value || null;
    if (!name || !gamePath || !modsPath || !backupPath) {
        toast(t('prof.missingFields'), 'error');
        return;
    }
    // Duplicate Check
    const conflictingName = await checkDuplicateModsFolder(modsPath);
    if (conflictingName) {
        const confirmed = await showDuplicateFolderModal(conflictingName);
        if (!confirmed)
            return;
    }
    try {
        const profile = await invoke('create_profile', { payload: { name, gameName, gamePath, modsPath, backupPath, color, icon } });
        document.getElementById('modal-new-profile').classList.remove('open');
        toast(t('prof.created').replace('{name}', profile.name), 'success');
        dispatchBmmAction(BMM_ACTIONS.PROFILE_CREATED, { profileId: profile.id, name: profile.name });
        await renderProfiles();
        updateProfileChip();
        updateLibraryProfileSelector();
        // Refresh mods and conflicts
        const { refreshMods } = await import('../mods/mods.js');
        await refreshMods(true);
        // Refresh repo export profiles list
        const profilesListEl = document.getElementById('repo-export-profiles-list');
        if (profilesListEl) {
            const { loadProfilesForExport } = await import('../repo/repo.js');
            await loadProfilesForExport(profilesListEl);
        }
    }
    catch (err) {
        toast(t('common.error') + ' : ' + err, 'error');
    }
}
async function confirmEditProfile() {
    const profileId = document.getElementById('edit-prof-id').value;
    const name = document.getElementById('edit-prof-name').value.trim();
    const gameName = document.getElementById('edit-prof-game').value.trim();
    const gamePath = document.getElementById('edit-prof-game-path').value.trim();
    const modsPath = document.getElementById('edit-prof-mods-path').value.trim();
    const backupPath = document.getElementById('edit-prof-backup-path').value.trim();
    const color = document.getElementById('edit-prof-color').value || '#3b82f6';
    const icon = document.getElementById('edit-prof-icon').value || null;
    if (!name || !gamePath || !modsPath || !backupPath) {
        toast(t('prof.missingFields'), 'error');
        return;
    }
    // Duplicate Check
    const conflictingName = await checkDuplicateModsFolder(modsPath, profileId);
    if (conflictingName) {
        const confirmed = await showDuplicateFolderModal(conflictingName);
        if (!confirmed)
            return;
    }
    try {
        await invoke('update_profile', { profileId, payload: { name, gameName, gamePath, modsPath, backupPath, color, icon } });
        // Handle pending background updates
        if (window.pendingBgState.action === 'apply') {
            await invoke('apply_profile_background', { profileId });
        }
        else if (window.pendingBgState.action === 'remove') {
            await invoke('remove_profile_background', { profileId });
        }
        window.pendingBgState = { action: null, tmpPath: null };
        document.getElementById('modal-edit-profile').classList.remove('open');
        toast(t('prof.updated').replace('{name}', name), 'success');
        await renderProfiles();
        updateProfileChip();
        updateLibraryProfileSelector();
        // Refresh mods and conflicts
        const { refreshMods } = await import('../mods/mods.js');
        await refreshMods(true);
    }
    catch (err) {
        toast(t('common.error') + ' : ' + err, 'error');
    }
}
export async function renderProfiles() {
    const grid = document.getElementById('profile-grid');
    const emptyEl = document.getElementById('empty-profiles');
    const badgeEl = document.getElementById('badge-profiles');
    const [profiles, activeId] = await Promise.all([
        invoke('get_profiles'),
        invoke('get_active_profile_id'),
    ]);
    // Fetch all mods for count display
    try {
        allModsCache = await invoke('get_all_mods');
    }
    catch { }
    // Badge
    const count = profiles.length;
    badgeEl.textContent = count;
    badgeEl.classList.toggle('show', count > 0);
    // Clear old cards (keep empty-state)
    Array.from(grid.children).forEach(c => { if (!c.id.startsWith('empty'))
        grid.removeChild(c); });
    if (count === 0) {
        emptyEl.style.display = 'flex';
        emptyEl.style.width = '100%';
        emptyEl.style.minHeight = '400px';
        emptyEl.innerHTML = `
            <div class="empty-icon" style="margin-bottom:24px; opacity:0.6; background:rgba(255,255,255,0.03); width:100px; height:100px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:1px solid var(--border)">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
                    <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                </svg>
            </div>
            <h3 data-i18n="prof.emptyTitle" style="font-size:22px; margin-bottom:12px; font-weight:700">${t('prof.emptyTitle') || 'None profil configuré'}</h3>
            <p data-i18n="prof.emptyDesc" style="color:var(--text-secondary); max-width:440px; text-align:center; margin-bottom:32px; line-height:1.6">
                ${t('prof.emptyDesc') || 'Organisez vos mods par jeu ou par configuration...'}
            </p>
            <div style="display:flex; flex-wrap:wrap; justify-content:center; gap:16px; width:100%; margin-bottom: 24px;">
                <button class="btn btn-primary btn-lg" id="empty-create-profile" style="padding:12px 24px; font-size:14px; font-weight:600; min-width:180px">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:8px"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    <span data-i18n="prof.create">${t('prof.create') || 'Créer un profil'}</span>
                </button>
                <div class="dropdown dropdown-center">
                    <button class="btn btn-secondary btn-lg" style="padding:12px 24px; font-size:14px; font-weight:600; min-width:180px; display:flex; align-items:center; justify-content:center; gap:8px;">
                        <span data-i18n="prof.import">Importer</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
                    </button>
                    <div class="dropdown-content glass">
                        <a href="#" onclick="document.getElementById('btn-import-ovgme').click(); event.preventDefault();">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
                            <span data-i18n="prof.importOvgme">Logiciel OvGME</span>
                        </a>
                        <a href="#" onclick="document.getElementById('btn-import-omm-auto').click(); event.preventDefault();">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                                <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                                <line x1="12" y1="22.08" x2="12" y2="12"></line>
                            </svg>
                            <span data-i18n="prof.importOmmAuto">Auto-detect OMM</span>
                        </a>
                        <a href="#" onclick="document.getElementById('btn-import-omm').click(); event.preventDefault();">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                                <polyline points="13 2 13 9 20 9"></polyline>
                            </svg>
                            <span data-i18n="prof.importOmm">Open Mod Manager (.omx)</span>
                        </a>
                    </div>
                </div>
            </div>
            <button class="btn btn-ghost btn-sm" onclick="openDiagram('mod-architecture')" style="color:var(--accent); font-size:12px; border:1px solid rgba(59,130,246,0.3); margin: 0 auto; display: flex; align-items: center; gap: 8px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                    <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span data-i18n="prof.howItWorks">${t('prof.howItWorks') || 'Comment ça marche ?'}</span>
            </button>
        `;
        document.getElementById('empty-create-profile').onclick = () => document.getElementById('btn-new-profile').click();
        applyTranslations(emptyEl);
        return;
    }
    emptyEl.style.display = 'none';
    // Prefetch background paths for all profiles
    const bgPaths = {};
    await Promise.all(profiles.map(async (p) => {
        if (p.background_image) {
            try {
                const path = await invoke('get_profile_background_path', { profileId: p.id });
                if (path)
                    bgPaths[p.id] = path;
            }
            catch { }
        }
    }));
    profiles.forEach(p => {
        const isActive = p.id === activeId;
        const card = document.createElement('div');
        card.className = 'profile-card' + (isActive ? ' active-profile' : '');
        card.dataset.id = p.id;
        card.style.position = 'relative';
        card.style.overflow = 'hidden';
        const brandColor = p.color || '#3b82f6';
        // Count mods for this profile
        let modCountLabel = t('prof.noMods');
        let activeModsHtml = '';
        try {
            const profileMods = allModsCache.filter(m => m.mod_folder_path && m.mod_folder_path.startsWith(p.mods_path));
            const activeIds = Array.isArray(p.active_mods) ? p.active_mods : [];
            const enabledMods = profileMods.filter(m => activeIds.includes(m.id));
            const enabledCount = enabledMods.length;
            if (profileMods.length > 0) {
                modCountLabel = t('prof.modsActive', { count: enabledCount }) + ' / ' + profileMods.length;
            }
            if (enabledCount > 0) {
                activeModsHtml = `<div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:8px; max-height:60px; overflow-y:auto; padding-right:4px;" class="active-mods-list">
                    ${enabledMods.map(m => `<span style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(255,255,255,0.04); border:1px solid var(--border); color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:120px;" onmouseenter="window.showTaskyHelp('${escAttr(m.name)}', 'package', true)" onmouseleave="window.hideTaskyHelp()">${escHtml(m.name)}</span>`).join('')}
                </div>`;
            }
        }
        catch { }
        // Background image layer
        const bgPath = bgPaths[p.id];
        const cb = Date.now();
        const bgLayer = bgPath
            ? `<div style="position:absolute;inset:0;z-index:0;border-radius:inherit;overflow:hidden;pointer-events:none">
                <img src="${convertFileSrc(bgPath)}?t=${cb}" style="width:100%;height:100%;object-fit:cover;opacity:0.35;filter:blur(1px)" alt="">
                <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0.1) 0%,rgba(0,0,0,0.6) 100%)"></div>
              </div>`
            : '';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.innerHTML = `
      ${bgLayer}
      <div style="position:relative;z-index:1;display:flex;flex-direction:column;height:100%">
      <div class="profile-card-header" style="display:flex;align-items:flex-start;padding-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.05);margin-bottom:16px;min-height:54px;gap:12px">
        <div style="width:3px;height:32px;border-radius:2px;background:${escAttr(brandColor)};flex-shrink:0;margin-top:2px"></div>
        <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px">
            <div style="font-weight:700;font-size:16px;color:var(--text-primary);line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escAttr(p.name)}">${escHtml(p.name)}</div>
            ${p.icon ? `<div style="color:${escAttr(brandColor)};display:flex;align-items:center;opacity:0.9">${getProfileIconSvg(p.icon, 'margin:0;width:16px;height:16px')}</div>` : ''}
          </div>
          ${p.game_name ? `<div style="font-family:var(--font-mono);font-weight:600;font-size:10px;padding:2px 8px;border-radius:4px;background:${escAttr(brandColor)}15;color:${escAttr(brandColor)};border:1px solid ${escAttr(brandColor)}30;align-self:flex-start;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">${escHtml(t(p.game_name) || p.game_name)}</div>` : ''}
        </div>
      </div>
      <div class="profile-card-paths" style="margin-bottom:16px;background:rgba(255,255,255,0.015);padding:10px 12px;border-radius:8px;border:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
          <span class="clickable-label btn-open-path" data-path="${escAttr(p.game_path)}" style="font-size:11px;color:var(--text-secondary);width:110px;flex-shrink:0;text-transform:uppercase;letter-spacing:0.04em">${t('prof.gameDirLabel')}</span>
          <span class="btn-open-path" data-path="${escAttr(p.game_path)}" style="font-size:11px;color:var(--text-primary);font-family:var(--font-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;cursor:pointer" onmouseenter="window.showTaskyHelp('prof.openDirTip', 'folder')" onmouseleave="window.hideTaskyHelp()">${escHtml(p.game_path)}</span>
          <button class="btn-open-path" data-path="${escAttr(p.game_path)}" onmouseenter="window.showTaskyHelp('prof.openDirTip', 'folder')" onmouseleave="window.hideTaskyHelp()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:2px;display:flex">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </button>
        </div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
          <span class="clickable-label btn-open-path" data-path="${escAttr(p.mods_path)}" style="font-size:11px;color:var(--text-secondary);width:110px;flex-shrink:0;text-transform:uppercase;letter-spacing:0.04em">${t('prof.modsDirLabel')}</span>
          <span class="btn-open-path" data-path="${escAttr(p.mods_path)}" style="font-size:11px;color:var(--text-primary);font-family:var(--font-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;cursor:pointer" onmouseenter="window.showTaskyHelp('prof.openDirTip', 'folder')" onmouseleave="window.hideTaskyHelp()">${escHtml(p.mods_path)}</span>
          <button class="btn-open-path" data-path="${escAttr(p.mods_path)}" onmouseenter="window.showTaskyHelp('prof.openDirTip', 'folder')" onmouseleave="window.hideTaskyHelp()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:2px;display:flex">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </button>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span class="clickable-label btn-open-path" data-path="${escAttr(p.backup_path)}" style="font-size:11px;color:var(--text-secondary);width:110px;flex-shrink:0;text-transform:uppercase;letter-spacing:0.04em">${t('prof.backupDirLabel')}</span>
          <span class="btn-open-path" data-path="${escAttr(p.backup_path)}" style="font-size:11px;color:var(--text-primary);font-family:var(--font-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;cursor:pointer" onmouseenter="window.showTaskyHelp('prof.openDirTip', 'folder')" onmouseleave="window.hideTaskyHelp()">${escHtml(p.backup_path)}</span>
          <button class="btn-open-path" data-path="${escAttr(p.backup_path)}" onmouseenter="window.showTaskyHelp('prof.openDirTip', 'folder')" onmouseleave="window.hideTaskyHelp()" style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:2px;display:flex">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:12px;margin-top:auto;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <span style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono)">${escHtml(modCountLabel)}</span>
          <span class="profile-disk-usage" data-mods-path="${escAttr(p.mods_path)}" style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);opacity:0.7">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-block;vertical-align:middle;margin-right:2px;animation:spin 1.2s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          </span>
        </div>
        ${activeModsHtml}
      </div>
      <div class="profile-card-actions">
        <button class="btn btn-secondary btn-sm flex-1 btn-activate" style="flex:1" data-id="${escAttr(p.id)}">
          ${isActive ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="vertical-align:middle;margin-right:4px"><polyline points="20 6 9 17 4 12"/></svg>' + t('prof.active') : t('mod.activate')}
        </button>
        <button class="btn btn-secondary btn-sm btn-edit-profile" data-id="${escAttr(p.id)}" onmouseenter="window.showTaskyHelp('prof.editTip', 'edit')" onmouseleave="window.hideTaskyHelp()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
          </svg>
        </button>
        <button class="btn btn-danger btn-sm btn-del-profile" data-id="${escAttr(p.id)}" onmouseenter="window.showTaskyHelp('prof.deleteTip', 'trash')" onmouseleave="window.hideTaskyHelp()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/>
          </svg>
        </button>
      </div>
      </div>
    `;
        grid.appendChild(card);
        applyTranslations(card);
    });
    // Async: load disk usage for each profile mods folder
    (async () => {
        const diskSpans = grid.querySelectorAll('.profile-disk-usage');
        const formatBytes = (bytes) => {
            if (bytes === 0)
                return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
        };
        await Promise.allSettled(Array.from(diskSpans).map(async (span) => {
            const modsPath = span.dataset.modsPath;
            if (!modsPath) {
                span.textContent = '';
                return;
            }
            try {
                const size = await invoke('get_folder_size', { path: modsPath });
                span.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline-block;vertical-align:middle;margin-right:2px"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>${formatBytes(size)}`;
            }
            catch {
                span.textContent = '';
            }
        }));
    })();
    // Functions for card actions
    async function activateProfile(id) {
        await invoke('set_active_profile', { profileId: id });
        // Cache the new profile ID immediately so renderModList skips IPC
        const { appState } = await import('../../core/state.js');
        appState.set('cachedActiveProfileId', id);
        await renderProfiles();
        updateProfileChip();
        updateLibraryProfileSelector();
        // The import and call are already here, ensuring they are executed
        const { refreshMods } = await import('../mods/mods.js');
        await refreshMods(true);
        const { updateDiscordStatus } = await import('../settings/settings.js');
        await updateDiscordStatus();
    }
    function openEditProfile(id) {
        const profile = profiles.find(p => p.id === id);
        if (profile) {
            document.getElementById('edit-prof-id').value = profile.id;
            document.getElementById('edit-prof-name').value = profile.name;
            document.getElementById('edit-prof-game').value = profile.game_name || '';
            document.getElementById('edit-prof-game-path').value = profile.game_path;
            document.getElementById('edit-prof-mods-path').value = profile.mods_path;
            document.getElementById('edit-prof-backup-path').value = profile.backup_path;
            document.getElementById('edit-prof-color').value = profile.color || '#3b82f6';
            document.getElementById('edit-prof-icon').value = profile.icon || '';
            updateIconPickerSelection('edit-prof-icon-grid', profile.icon || '');
            window.pendingBgState = { action: null, tmpPath: null };
            // Background image section
            initEditBackgroundSection(profile);
            document.getElementById('modal-edit-profile').classList.add('open');
        }
    }
    // Individual Card Events
    grid.querySelectorAll('.profile-card').forEach(card => {
        const id = card.dataset.id;
        // Double click -> Activate
        card.addEventListener('dblclick', (e) => {
            // Don't trigger if clicking a button or a path
            if (e.target.closest('button') || e.target.closest('.btn-open-path'))
                return;
            activateProfile(id);
        });
    });
    // Button Events
    grid.querySelectorAll('.btn-activate').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            activateProfile(e.currentTarget.dataset.id);
        });
    });
    grid.querySelectorAll('.btn-edit-profile').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            openEditProfile(e.currentTarget.dataset.id);
        });
    });
    grid.querySelectorAll('.btn-del-profile').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = e.currentTarget.dataset.id;
            const profile = profiles.find(p => p.id === id);
            // Check for enabled mods in this profile
            const profileMods = allModsCache.filter(m => m.mod_folder_path && m.mod_folder_path.startsWith(profile.mods_path));
            const activeIds = Array.isArray(profile.active_mods) ? profile.active_mods : [];
            const enabledMods = profileMods.filter(m => activeIds.includes(m.id));
            if (enabledMods.length > 0 && id === activeId) {
                // ... (existing logic for disabling mods)
                openDeleteProfileModal(id, profile);
            }
            else {
                openDeleteProfileModal(id, profile);
            }
        });
    });
    grid.querySelectorAll('.btn-open-path').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const path = e.currentTarget.dataset.path;
            if (path) {
                try {
                    await invoke('open_folder', { path });
                }
                catch (err) {
                    toast(t('prof.folderError') + err, 'error');
                }
            }
        });
    });
    // --- New Feature: Global Active Mods List ---
    const activeModsContainer = document.getElementById('global-active-mods-list');
    function updateDisableAllGlobalButton() {
        const btnDisableAllGlobal = document.getElementById('btn-disable-all-global');
        if (!btnDisableAllGlobal)
            return;
        if (selectedProfileIds.size > 0) {
            btnDisableAllGlobal.classList.add('btn-warning');
            btnDisableAllGlobal.classList.remove('btn-danger');
            const btnSpan = btnDisableAllGlobal.querySelector('span');
            if (btnSpan)
                btnSpan.textContent = t('prof.disableSelected');
        }
        else {
            btnDisableAllGlobal.classList.add('btn-danger');
            btnDisableAllGlobal.classList.remove('btn-warning');
            const btnSpan = btnDisableAllGlobal.querySelector('span');
            if (btnSpan)
                btnSpan.textContent = t('prof.disableAll');
        }
    }
    if (activeModsContainer) {
        activeModsContainer.innerHTML = '';
        const btnDisableAllGlobal = document.getElementById('btn-disable-all-global');
        if (btnDisableAllGlobal) {
            btnDisableAllGlobal.style.display = 'none'; // Will show if mods found
            updateDisableAllGlobalButton();
        }
        // Collect all active mods and map them to their profiles
        const activeModsMap = new Map(); // modId -> { mod, profileIds: Set }
        profiles.forEach(p => {
            const profileMods = allModsCache.filter(m => m.mod_folder_path && m.mod_folder_path.startsWith(p.mods_path));
            const activeIds = Array.isArray(p.active_mods) ? p.active_mods : [];
            const enabledMods = profileMods.filter(m => activeIds.includes(m.id));
            enabledMods.forEach(m => {
                if (!activeModsMap.has(m.id)) {
                    activeModsMap.set(m.id, { mod: m, profileIds: new Set() });
                }
                activeModsMap.get(m.id).profileIds.add(p.id);
            });
        });
        const sortedMods = Array.from(activeModsMap.values()).sort((a, b) => a.mod.name.localeCompare(b.mod.name));
        if (sortedMods.length > 0 && btnDisableAllGlobal) {
            btnDisableAllGlobal.style.display = 'flex';
        }
        const searchInput = document.getElementById('prof-global-mod-search');
        const filterText = searchInput ? searchInput.value.toLowerCase() : '';
        sortedMods.forEach(({ mod, profileIds }) => {
            if (filterText && !mod.name.toLowerCase().includes(filterText))
                return;
            const item = document.createElement('div');
            item.className = 'global-active-mod-item';
            item.dataset.modId = mod.id;
            item.dataset.profileIds = JSON.stringify(Array.from(profileIds));
            item.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--accent); flex-shrink: 0;">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <span style="flex:1; overflow:hidden; text-overflow:ellipsis;">${escHtml(mod.name)}</span>
            `;
            activeModsContainer.appendChild(item);
        });
        const modItems = activeModsContainer.querySelectorAll('.global-active-mod-item');
        const profileCards = grid.querySelectorAll('.profile-card');
        // Click to highlight profile
        modItems.forEach(item => {
            const modId = item.dataset.modId;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                if (e.ctrlKey) {
                    // Multi-select logic
                    // If we were just highlighting one mod without having it in the selection set, add it first
                    const currentHighlight = document.querySelector('.global-active-mod-item.highlight-mod');
                    if (currentHighlight && selectedGlobalModIds.size === 0) {
                        const hId = currentHighlight.dataset.id;
                        if (hId) {
                            selectedGlobalModIds.add(hId);
                            currentHighlight.classList.add('selected');
                            currentHighlight.classList.remove('highlight-mod');
                        }
                    }
                    if (selectedGlobalModIds.has(modId)) {
                        selectedGlobalModIds.delete(modId);
                        item.classList.remove('selected');
                    }
                    else {
                        selectedGlobalModIds.add(modId);
                        item.classList.add('selected');
                    }
                    // Remove all dim/highlight states when in multi-select mode
                    modItems.forEach(mi => mi.classList.remove('highlight-mod', 'dim-mod'));
                    profileCards.forEach(pc => pc.classList.remove('highlight-profile', 'dim-profile'));
                }
                else {
                    // Single select / highlight
                    const isAlreadyHighlighted = item.classList.contains('highlight-mod');
                    // Reset all
                    modItems.forEach(mi => mi.classList.remove('highlight-mod', 'dim-mod', 'selected'));
                    profileCards.forEach(pc => pc.classList.remove('highlight-profile', 'dim-profile'));
                    selectedGlobalModIds.clear();
                    if (!isAlreadyHighlighted) {
                        item.classList.add('highlight-mod');
                        const pIds = JSON.parse(item.dataset.profileIds || '[]');
                        profileCards.forEach(pc => {
                            if (pIds.includes(pc.dataset.id)) {
                                pc.classList.add('highlight-profile');
                            }
                            else {
                                pc.classList.add('dim-profile');
                            }
                        });
                        modItems.forEach(mi => {
                            if (mi !== item)
                                mi.classList.add('dim-mod');
                        });
                    }
                }
            });
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                lastClickedGlobalModId = modId;
                const menu = document.getElementById('global-mods-context-menu');
                if (!menu)
                    return;
                // Show "Disable Selected" only if multiple items are selected
                const selectedItem = document.getElementById('ctx-global-mod-disable-selected');
                if (selectedItem) {
                    selectedItem.style.display = selectedGlobalModIds.size > 1 ? 'flex' : 'none';
                }
                menu.style.display = 'block';
                // Positioning
                const menuWidth = 200;
                const menuHeight = menu.offsetHeight || 100;
                let x = e.clientX;
                let y = e.clientY;
                if (x + menuWidth > window.innerWidth)
                    x -= menuWidth;
                if (y + menuHeight > window.innerHeight)
                    y -= menuHeight;
                menu.style.left = `${x}px`;
                menu.style.top = `${y}px`;
            });
            // Restore selection state if re-rendered
            if (selectedGlobalModIds.has(modId)) {
                item.classList.add('selected');
            }
        });
        // Click profile to highlight its active mods
        profileCards.forEach(card => {
            const profileId = card.dataset.id;
            // Restore selection state
            if (selectedProfileIds.has(profileId)) {
                card.classList.add('selected-profile');
            }
            card.addEventListener('click', (e) => {
                if (e.target.closest('button') || e.target.closest('.btn-open-path'))
                    return;
                if (e.ctrlKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (selectedProfileIds.has(profileId)) {
                        selectedProfileIds.delete(profileId);
                        card.classList.remove('selected-profile');
                    }
                    else {
                        selectedProfileIds.add(profileId);
                        card.classList.add('selected-profile');
                    }
                    // Highlight mods of ALL selected profiles
                    modItems.forEach(mi => {
                        const pIds = JSON.parse(mi.dataset.profileIds || '[]');
                        const isShared = pIds.some(pid => selectedProfileIds.has(pid));
                        if (isShared) {
                            mi.classList.add('highlight-mod');
                            mi.classList.remove('dim-mod');
                        }
                        else {
                            mi.classList.remove('highlight-mod');
                            mi.classList.add('dim-mod');
                        }
                    });
                    // Dim non-selected profiles
                    profileCards.forEach(pc => {
                        if (selectedProfileIds.has(pc.dataset.id)) {
                            pc.classList.add('highlight-profile');
                            pc.classList.remove('dim-profile');
                        }
                        else {
                            pc.classList.remove('highlight-profile');
                            pc.classList.add('dim-profile');
                        }
                    });
                    // If nothing selected anymore, reset all dims
                    if (selectedProfileIds.size === 0) {
                        modItems.forEach(mi => mi.classList.remove('highlight-mod', 'dim-mod'));
                        profileCards.forEach(pc => pc.classList.remove('highlight-profile', 'dim-profile'));
                    }
                    // Update button appearance without full re-render if possible
                    updateDisableAllGlobalButton();
                    return;
                }
                const isActive = card.classList.contains('highlight-profile');
                // Reset all
                modItems.forEach(mi => mi.classList.remove('highlight-mod', 'dim-mod'));
                profileCards.forEach(pc => pc.classList.remove('highlight-profile', 'dim-profile', 'selected-profile'));
                selectedProfileIds.clear();
                if (!isActive) {
                    card.classList.add('highlight-profile');
                    const pId = card.dataset.id;
                    profileCards.forEach(pc => {
                        if (pc !== card)
                            pc.classList.add('dim-profile');
                    });
                    modItems.forEach(mi => {
                        const pIds = JSON.parse(mi.dataset.profileIds || '[]');
                        if (pIds.includes(pId)) {
                            mi.classList.add('highlight-mod');
                        }
                        else {
                            mi.classList.add('dim-mod');
                        }
                    });
                }
                // Update button appearance (back to "Disable All")
                renderProfiles();
            });
        });
        // Search filter listener (re-render just the mods list if possible, or simple filter)
        if (searchInput && !searchInput.dataset.listenerAdded) {
            searchInput.dataset.listenerAdded = 'true';
            searchInput.addEventListener('input', () => {
                renderProfiles();
            });
        }
    }
}
function openDeleteProfileModal(id, profile) {
    const modal = document.getElementById('modal-delete-profile');
    if (!modal)
        return;
    const btnFinal = document.getElementById('btn-final-delete-profile');
    const warningText = document.getElementById('delete-profile-warning-text');
    // Ensure button is reset before cloning or using (in case it was disabled from a previous attempt)
    btnFinal.disabled = false;
    btnFinal.innerHTML = `<span>${t('lib.delete')}</span>`;
    // Ensure all data-i18n in the modal are translated
    applyTranslations(modal);
    warningText.innerHTML = t('prof.deleteConfirmLabel')
        .replace('{name}', `<strong style="color:var(--text-primary)">${escHtml(profile.name)}</strong>`);
    // Clone button to remove old listeners
    const btnContainer = btnFinal.parentElement;
    const newBtnFinal = btnFinal.cloneNode(true);
    btnFinal.remove();
    btnContainer.appendChild(newBtnFinal);
    newBtnFinal.addEventListener('click', async () => {
        newBtnFinal.disabled = true;
        newBtnFinal.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;vertical-align:middle;margin-right:6px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> <span>${t('common.loading') || 'Chargement...'}</span>`;
        try {
            await invoke('delete_profile', { profileId: id });
            modal.classList.remove('open');
            await renderProfiles();
            updateProfileChip();
            updateLibraryProfileSelector();
            // Refresh mods and conflicts
            const { refreshMods } = await import('../mods/mods.js');
            await refreshMods(true);
            toast(t('prof.deleted'), 'info');
        }
        catch (err) {
            toast(t('prof.deleteError') + err, 'error');
            newBtnFinal.disabled = false;
            newBtnFinal.innerHTML = `<span>${t('lib.delete')}</span>`;
        }
    });
    modal.classList.add('open');
}
export async function updateProfileChip() {
    const [profiles, activeId] = await Promise.all([
        invoke('get_profiles'),
        invoke('get_active_profile_id'),
    ]);
    const active = profiles.find(p => p.id === activeId);
    const nameEl = document.getElementById('chip-profile-name');
    nameEl.textContent = active ? active.name : '—';
}
/**
 * Utility: Fetch all profiles
 */
export async function getProfiles() {
    return await invoke('get_profiles');
}
/**
 * Utility: Fetch active profile ID
 */
export async function getActiveProfileId() {
    return await invoke('get_active_profile_id');
}
export function getProfileIconSvg(iconName, extraStyle = '') {
    if (!iconName)
        return '';
    const style = `vertical-align:middle;${extraStyle}`;
    switch (iconName) {
        case 'gamepad': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><line x1="6" y1="12" x2="10" y2="12"></line><line x1="8" y1="10" x2="8" y2="14"></line><line x1="15" y1="13" x2="15.01" y2="13"></line><line x1="18" y1="11" x2="18.01" y2="11"></line><rect x="2" y="6" width="20" height="12" rx="2"></rect></svg>`;
        case 'sword': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"></polyline><line x1="13" y1="19" x2="19" y2="13"></line><line x1="16" y1="16" x2="20" y2="20"></line><line x1="19" y1="21" x2="21" y2="19"></line></svg>`;
        case 'plane': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.2-1.1.7l-1.2 3.3c-.2.5.1 1 .6 1.1l7.3 2-2.8 2.8-3.2-.8c-.5-.1-.9.2-1.1.7l-1 2.6c-.2.5.2 1 .7 1.1l5.5 1.4 1.4 5.5c.1.5.6.9 1.1.7l2.6-1c.5-.2.8-.6.7-1.1l-.8-3.2 2.8-2.8 2 7.3c.1.5.6.8 1.1.6l3.3-1.2c.5-.2.8-.6.7-1.1z"></path></svg>`;
        case 'car': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a2 2 0 0 0-1.6-.8H9.3a2 2 0 0 0-1.6.8L5 11l-5.16.86a1 1 0 0 0-.84.99V16h3m10 0a2 2 0 1 1-4 0m4 0a2 2 0 1 0-4 0m-6 0a2 2 0 1 1-4 0m4 0a2 2 0 1 0-4 0"></path></svg>`;
        case 'star': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
        case 'flame': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path></svg>`;
        case 'key': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3L15.5 7.5z"></path></svg>`;
        case 'headphones': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg>`;
        case 'toggle': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><rect x="1" y="5" width="22" height="14" rx="7" ry="7"></rect><circle cx="16" cy="12" r="3"></circle></svg>`;
        case 'megaphone': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="m3 11 18-5v12L3 13v-2z"></path><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"></path></svg>`;
        case 'radio': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M16.2 7.8A6 6 0 1 0 7.8 16.2"></path><circle cx="12" cy="12" r="2"></circle><path d="M19.1 4.9a10 10 0 1 0-14.2 14.2"></path></svg>`;
        case 'target': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>`;
        case 'gear': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
        case 'snowflake': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><line x1="2" y1="12" x2="22" y2="12"></line><line x1="12" y1="2" x2="12" y2="22"></line><path d="m20 16-4-4 4-4"></path><path d="m4 8 4 4-4 4"></path><path d="m16 4-4 4-4-4"></path><path d="m8 20 4-4 4 4"></path></svg>`;
        case 'sun': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><circle cx="12" cy="12" r="4"></circle><line x1="12" y1="2" x2="12" y2="4"></line><line x1="12" y1="20" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"></line><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="4" y2="12"></line><line x1="20" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"></line><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"></line></svg>`;
        case 'shield': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`;
        case 'wind': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"></path><path d="M9.6 4.6A2 2 0 1 1 11 8H2"></path><path d="M12.6 19.4A2 2 0 1 0 14 16H2"></path></svg>`;
        case 'wifi': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M5 13a10 10 0 0 1 14 0"></path><path d="M8.5 16.5a5 5 0 0 1 7 0"></path><path d="M2 8a15 15 0 0 1 20 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>`;
        case 'bomb': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><circle cx="11" cy="13" r="9"></circle><path d="M18.35 5.65 21.5 2.5"></path><path d="M17 10c.5-2 2.5-2.5 3-1"></path></svg>`;
        case 'hammer': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="m15 12-8.5 8.5c-.83.83-2.17.83-3 0 0 0 0 0 0 0a2.12 2.12 0 0 1 0-3L12 9"></path><path d="M17.64 15 22 10.64"></path><path d="m20.91 11.7-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.31a2 2 0 0 0-2-2h-.28c-.84 0-1.64-.34-2.24-.93L12.96 3.7a2 2 0 0 0-2.82 0L6.5 7.34a2 2 0 0 0 0 2.82l1.25 1.25c.6.6.93 1.41.93 2.25v.28a2 2 0 0 0 2 2h.28c.84 0 1.64.34 2.24.93l1.25 1.25a2 2 0 0 0 2.82 0l3.64-3.64a2 2 0 0 0 0-2.82z"></path></svg>`;
        case 'user': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
        case 'globe': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;
        case 'cursor': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"></path><path d="m13 13 6 6"></path></svg>`;
        case 'volume': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
        case 'music': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`;
        case 'bell': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>`;
        case 'anchor': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><circle cx="12" cy="5" r="3"></circle><line x1="12" y1="22" x2="12" y2="8"></line><path d="M5 12H2a10 10 0 0 0 20 0h-3"></path></svg>`;
        case 'zap': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`;
        case 'cpu': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>`;
        case 'map': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><polygon points="1 6 8 2 16 6 23 2 23 18 16 22 8 18 1 22 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></svg>`;
        case 'mountain': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="m8 3 4 8 5-5 5 15H2L8 3z"></path></svg>`;
        case 'rocket': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path></svg>`;
        case 'crosshair': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><circle cx="12" cy="12" r="10"></circle><line x1="22" y1="12" x2="18" y2="12"></line><line x1="6" y1="12" x2="2" y2="12"></line><line x1="12" y1="6" x2="12" y2="2"></line><line x1="12" y1="22" x2="12" y2="18"></line></svg>`;
        case 'triangle-alert': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
        case 'eye': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>`;
        case 'heart': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`;
        case 'activity': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>`;
        case 'package': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`;
        case 'database': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>`;
        case 'camera': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>`;
        case 'briefcase': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`;
        case 'ghost': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M9 10h.01"/><path d="M15 10h.01"/><path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"/></svg>`;
        case 'joystick': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M21 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2Z"/><path d="M6 15v-2"/><path d="M12 15V9"/><circle cx="12" cy="6" r="3"/></svg>`;
        case 'terminal': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>`;
        case 'aperture': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><circle cx="12" cy="12" r="10"/><line x1="14.31" x2="20.05" y1="8" y2="17.94"/><line x1="9.69" x2="21.17" y1="8" y2="8"/><line x1="7.38" x2="13.12" y1="12" y2="2.06"/><line x1="9.69" x2="3.95" y1="16" y2="6.06"/><line x1="14.31" x2="2.83" y1="16" y2="16"/><line x1="16.62" x2="10.88" y1="12" y2="21.94"/></svg>`;
        case 'flask': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/></svg>`;
        case 'moon': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;
        // Extended icons
        case 'code': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
        case 'monitor': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
        case 'server': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`;
        case 'printer': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`;
        case 'keyboard': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="10" x2="6.01" y2="10"/><line x1="10" y1="10" x2="10.01" y2="10"/><line x1="14" y1="10" x2="14.01" y2="10"/><line x1="18" y1="10" x2="18.01" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/></svg>`;
        case 'mouse-icon': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><rect x="5" y="2" width="14" height="20" rx="7"/><line x1="12" y1="6" x2="12" y2="10"/></svg>`;
        case 'bluetooth': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><polyline points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5"/></svg>`;
        case 'satellite': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>`;
        case 'router': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="18" x2="6.01" y2="18"/><line x1="10" y1="18" x2="10.01" y2="18"/><path d="M15 10a5 5 0 0 0-5 5"/><path d="M19 6a9 9 0 0 0-9 9"/><path d="M11 2a13 13 0 0 0-9 12"/></svg>`;
        case 'cloud': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`;
        case 'bus': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/></svg>`;
        case 'truck': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11v10"/><path d="M12 17h5l3-3v-5h-8"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>`;
        case 'ship': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76"/><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/><path d="M12 10v4"/><path d="M12 2v3"/></svg>`;
        case 'bicycle': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>`;
        case 'train': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><rect x="4" y="3" width="16" height="16" rx="2"/><path d="M4 11h16"/><path d="M12 3v8"/><path d="m8 19-2 3"/><path d="m18 22-2-3"/><path d="M8 15h.01"/><path d="M16 15h.01"/></svg>`;
        case 'helicopter': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M12 8v5"/><path d="m8 14 4-4 4 4"/><path d="M2 8h20"/><path d="M12 2v4"/><path d="M17 16l2 5"/><path d="M7 16l-2 5"/></svg>`;
        case 'film': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>`;
        case 'tv': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>`;
        case 'speaker': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="14" r="4"/><line x1="12" y1="6" x2="12.01" y2="6"/></svg>`;
        case 'mic': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`;
        case 'clapperboard': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>`;
        case 'disc': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>`;
        case 'trophy': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>`;
        case 'medal': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><path d="M11 12 5.12 2.2"/><path d="m13 12 5.88-9.8"/><path d="M8 7h8"/><circle cx="12" cy="17" r="5"/><path d="M12 18v-2h-.5"/></svg>`;
        case 'dumbbell': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M14.4 14.4 9.6 9.6"/><path d="M18.657 5.343a4 4 0 0 1 0 5.657l-1.414-1.414a2 2 0 0 0 0-2.829l-1.414-1.414a4 4 0 0 1 5.657 0Z"/><path d="m11 12 2-2"/><path d="M5.343 18.657a4 4 0 0 1 0-5.657l1.414 1.414a2 2 0 0 0 0 2.829l1.414 1.414a4 4 0 0 1-5.657 0Z"/></svg>`;
        case 'bike': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-3 11.5V14l-3-3 4-3 2 3h2"/></svg>`;
        case 'swords': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" y1="14" x2="9" y2="18"/><line x1="7" y1="21" x2="9" y2="19"/></svg>`;
        case 'shield-check': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>`;
        case 'pen': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`;
        case 'ruler': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M21.3 8.7 8.7 21.3c-1 1-2.5 1-3.4 0l-2.6-2.6c-1-1-1-2.5 0-3.4L15.3 2.7c1-1 2.5-1 3.4 0l2.6 2.6c1 1 1 2.5 0 3.4Z"/><path d="m7.5 10.5 2 2"/><path d="m10.5 7.5 2 2"/><path d="m13.5 4.5 2 2"/><path d="m4.5 13.5 2 2"/></svg>`;
        case 'compass-icon': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`;
        case 'scissors-icon': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>`;
        case 'book': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>`;
        case 'bookmark-icon': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>`;
        case 'clock': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
        case 'calendar': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
        case 'hourglass': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>`;
        case 'alarm': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/><path d="M6.38 18.7 4 21"/><path d="M17.64 18.67 20 21"/></svg>`;
        case 'tree': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M12 22V13"/><path d="M8 6H5l7-4 7 4h-3"/><path d="M6 10H3l9-4 9 4h-3"/><path d="M5 14H2l10-4 10 4h-3"/></svg>`;
        case 'leaf': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>`;
        case 'flower': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><circle cx="12" cy="12" r="3"/><path d="M12 2a3 3 0 0 0 0 6 3 3 0 0 0 0-6z"/><path d="M12 16a3 3 0 0 0 0 6 3 3 0 0 0 0-6z"/><path d="M2 12a3 3 0 0 0 6 0 3 3 0 0 0-6 0z"/><path d="M16 12a3 3 0 0 0 6 0 3 3 0 0 0-6 0z"/></svg>`;
        case 'bird': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M16 7h.01"/><path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20"/><path d="m20 7 2 .5-2 .5"/><path d="M10 18v3"/><path d="M14 17.75V21"/><path d="M7 18a6 6 0 0 0 3.84-10.61"/></svg>`;
        case 'fish': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z"/><path d="M18 12v.5"/><path d="M16 17.93a9.77 9.77 0 0 1 0-11.86"/><path d="M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 3.12-.07 5.35 2.27 6.35C2.07 13.3.8 15.73 2 18c2.06.56 4.47-.05 6-2.24"/></svg>`;
        case 'bug': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>`;
        case 'home': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
        case 'building': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>`;
        case 'flag': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`;
        case 'castle': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M22 20v-9H2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2Z"/><path d="M18 11V4H6v7"/><path d="M15 22v-4a3 3 0 0 0-6 0v4"/><path d="M22 11V4"/><path d="M2 11V4"/><path d="M6 4V2"/><path d="M18 4V2"/><path d="M10 4V2"/><path d="M14 4V2"/></svg>`;
        case 'tent': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M3.5 21 14 3"/><path d="M20.5 21 10 3"/><path d="M15.5 21 12 15l-3.5 6"/><path d="M2 21h20"/></svg>`;
        case 'infinity': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M12 12c-2-2.5-4-4-6-4a4 4 0 0 0 0 8c2 0 4-1.5 6-4zm0 0c2 2.5 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.5-6 4z"/></svg>`;
        case 'diamond': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.58a2.41 2.41 0 0 0 3.41 0l7.59-7.58a2.41 2.41 0 0 0 0-3.41l-7.59-7.58a2.41 2.41 0 0 0-3.41 0Z"/></svg>`;
        case 'hexagon': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><polygon points="21 16 21 8 12 3 3 8 3 16 12 21 21 16"/></svg>`;
        case 'layers-icon': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`;
        case 'fingerprint': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 17.5c2.5-1.5 3.5-5 3.5-7.5"/><path d="M20 12a10 10 0 0 1-.39 2.87"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/></svg>`;
        case 'sparkles': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>`;
        case 'atom': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><circle cx="12" cy="12" r="1"/><path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z"/><path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z"/></svg>`;
        case 'crown': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M5 20h14"/></svg>`;
        case 'lock': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
        case 'unlock-icon': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`;
        case 'search-icon': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
        case 'filter-icon': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`;
        case 'share-icon': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;
        case 'download-icon': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
        case 'upload-icon': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
        case 'link-icon': return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
        default: return '';
    }
}
// ── Background Image Section in Edit Modal ──
function initEditBackgroundSection(profile) {
    let container = document.getElementById('edit-prof-bg-section');
    if (!container) {
        // Find the modal-body and append there, before the modal-footer
        const modalBody = document.querySelector('#modal-edit-profile .modal-body');
        if (!modalBody)
            return;
        container = document.createElement('div');
        container.id = 'edit-prof-bg-section';
        container.style.cssText = 'margin-top:16px;padding-top:16px;border-top:1px solid var(--border);';
        modalBody.appendChild(container);
    }
    // Determine current visual state (includes pending changes)
    let hasBg = !!profile.background_image;
    let previewPath = null;
    if (window.pendingBgState.action === 'apply') {
        hasBg = true;
        previewPath = window.pendingBgState.tmpPath;
    }
    else if (window.pendingBgState.action === 'remove') {
        hasBg = false;
        previewPath = null;
    }
    container.innerHTML = `
        <label style="font-size:12px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:var(--text-secondary);display:block;margin-bottom:12px">${t('prof.bgImage')}</label>
        <div style="display:flex;align-items:center;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:8px 12px;gap:12px">
            <div style="width:40px;height:40px;border-radius:6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0">
                ${hasBg ?
        (previewPath ? `<img src="${convertFileSrc(previewPath)}?t=${Date.now()}" style="width:100%;height:100%;object-fit:cover">`
            : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`)
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'}
            </div>
            <div style="flex:1">
                <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:2px">
                    ${hasBg ? t('prof.bgDefined') : t('prof.bgNone')}
                </div>
                <div style="font-size:11px;color:var(--text-muted)">
                    ${hasBg ? t('prof.bgPending') : t('prof.bgAddTouch')}
                </div>
            </div>
            <div style="display:flex;gap:8px">
                <button type="button" class="btn btn-secondary btn-sm" id="btn-edit-pick-bg" style="gap:6px">
                    ${hasBg ? t('prof.bgChange') : t('prof.bgImage')}
                </button>
                ${hasBg ? `<button type="button" class="btn btn-danger btn-sm" id="btn-edit-remove-bg" style="padding:0 8px" title="${t('prof.bgRemove')}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
            </div>
        </div>
    `;
    document.getElementById('btn-edit-pick-bg').addEventListener('click', async () => {
        const filePath = await pickFile([{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]);
        if (!filePath)
            return;
        openCropOverlay(filePath, profile);
    });
    if (hasBg) {
        document.getElementById('btn-edit-remove-bg').addEventListener('click', () => {
            window.pendingBgState = { action: 'remove', tmpPath: null };
            initEditBackgroundSection(profile);
            toast(t('prof.bgRemovePending'), 'info');
        });
    }
}
function openCropOverlay(sourcePath, profile) {
    // Remove existing overlay
    const existing = document.getElementById('crop-overlay');
    if (existing)
        existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'crop-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.9);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;gap:16px;';
    overlay.innerHTML = `
        <div style="font-size:16px;font-weight:700;color:white;margin-bottom:8px">${t('prof.bgCropTitle')}</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.6);margin-bottom:4px">${t('prof.bgCropDesc')}</div>
        <div style="width:100%;max-width:800px;height:500px;background:#111;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.1)">
            <img id="cropper-image" style="display:block;max-width:100%;">
        </div>
        <div style="display:flex;gap:12px;margin-top:12px">
            <button class="btn btn-ghost" id="crop-cancel" style="min-width:120px">${t('prof.bgCropCancel')}</button>
            <button class="btn btn-primary" id="crop-confirm" style="min-width:120px">${t('prof.bgCropConfirm')}</button>
        </div>
    `;
    document.getElementById('app-window-outer').appendChild(overlay);
    const imageElement = document.getElementById('cropper-image');
    imageElement.src = convertFileSrc(sourcePath);
    let cropper;
    imageElement.onload = () => {
        cropper = new Cropper(imageElement, {
            aspectRatio: 3.5 / 4.5,
            viewMode: 1, // Restrict crop box to not exceed size of canvas
            dragMode: 'move', // Allow moving the image inside the crop box
            autoCropArea: 1, // Start with maximum crop area
            restore: false,
            guides: true,
            center: true,
            highlight: false,
            cropBoxMovable: true,
            cropBoxResizable: true,
            toggleDragModeOnDblclick: false,
        });
    };
    imageElement.onerror = () => {
        toast(t('prof.bgLoadError'), 'error');
        overlay.remove();
    };
    document.getElementById('crop-cancel').addEventListener('click', () => {
        if (cropper)
            cropper.destroy();
        overlay.remove();
    });
    document.getElementById('crop-confirm').addEventListener('click', async () => {
        if (!cropper)
            return;
        const btn = document.getElementById('crop-confirm');
        btn.disabled = true;
        btn.textContent = t('prof.bgCropSaving') || 'Enregistrement...';
        try {
            // Get crop box data rounded to nearest integers
            const cropData = cropper.getData(true);
            const tmpPath = await invoke('crop_and_save_webp', {
                profileId: profile.id,
                sourcePath,
                x: cropData.x,
                y: cropData.y,
                width: cropData.width,
                height: cropData.height,
                isTemp: true
            });
            window.pendingBgState = { action: 'apply', tmpPath };
            initEditBackgroundSection(profile);
            toast(t('prof.bgPending'), 'success');
            if (cropper)
                cropper.destroy();
            overlay.remove();
        }
        catch (e) {
            toast(t('prof.bgCropError', { err: String(e) }), 'error');
            btn.disabled = false;
            btn.textContent = t('prof.bgCropConfirm');
        }
    });
}
function escHtml(str) {
    if (!str)
        return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function escAttr(str) {
    if (!str)
        return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
//# sourceMappingURL=profiles.js.map