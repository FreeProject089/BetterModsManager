/**
 * mapper.ts — Mod Mapper feature
 * Handles file restructuration by mapping mod files to game directory structure
 */
import { invoke } from '../../core/api.js';
import { wireDismissibleTip } from '../../ui/dismissible-tip.js';
import { toast, fetchProfileIconPaths, updateSelectProfileIcon, decorateProfileOptions } from '../../ui/app.js';
import { t } from '../../core/i18n.js';
import { dispatchBmmAction, BMM_ACTIONS, onBmmAction } from '../../ui/tutorial-events.js';
import { escHtml } from '../../core/utils.js';
let selectedModId = null;
// Guard so a refresh can't run twice concurrently — WITHOUT disabling the <select>
// (toggling `.disabled` on a custom-select-enhanced element left its trigger stuck,
// so you couldn't pick another mod).
let _mapperBusy = false;
let activeProfile = null;
let modTreeData = [];
let gameTreeData = [];
// Selection State
let selectedPaths = new Set();
let lastSelectedPath = null;
// Pending changes (Draft mode)
let pendingMoves = new Map();
let pendingDeletions = new Set();
let pendingNewFolders = new Map();
// Input Modal State
let currentInputCallback = null;
// Cache guards — avoid re-loading trees if nothing changed
let lastGamePath = null;
let lastModFolderPath = null;
let lastProfileId = null;
// Expand-all cancellation tokens — incremented on collapse to stop a running doExpandAll
const _expandTokens = new Map();
/**
 * Initializes the Mod Mapper UI and event listeners
 */
export async function initMapper() {
    const view = document.getElementById('view-mapper');
    if (!view)
        return;
    // Intercept [data-tooltip] elements inside the mapper → use Tasky (mouse-follow,
    // never clipped by the tree panel's overflow) instead of the CSS ::after tooltip.
    if (!view._taskyTipBound) {
        view._taskyTipBound = true;
        view.addEventListener('mouseover', (e) => {
            const el = e.target.closest('[data-tooltip]');
            if (!el)
                return;
            // The FINAL PREVIEW modal has its OWN mouse-follow tooltip (_previewTipEl);
            // don't also fire the Tasky one there or the path shows twice.
            if (el.closest('.mapper-preview-container'))
                return;
            const tip = el.getAttribute('data-tooltip') || '';
            if (tip)
                window.showTaskyHelp?.(tip, 'info', true);
        });
        view.addEventListener('mouseout', (e) => {
            const el = e.target.closest('[data-tooltip]');
            if (el && !el.closest('.mapper-preview-container'))
                window.hideTaskyHelp?.();
        });
    }
    const modSelect = document.getElementById('mapper-mod-select');
    const profileSelect = document.getElementById('mapper-profile-select');
    const previewBtn = document.getElementById('btn-mapper-preview');
    const refreshBtn = document.getElementById('btn-mapper-refresh');
    const saveBtn = document.getElementById('btn-mapper-save');
    // Re-populate translated dropdowns when language changes
    document.addEventListener('langChanged', () => refreshMapperData());
    // EVENTS FIRST, DATA LAST — the order is the point.
    //
    // This used to open with `await refreshMapperData()`, with every addEventListener below
    // it. initMapper() is called from app.ts without await and without catch, so if that one
    // call rejected — a profile with a missing game path, an unreadable mod folder, anything
    // — the promise died there and NOT ONE listener in this function was ever attached. The
    // mapper then sat looking perfectly normal and did nothing at all: no preview button, no
    // context menus, no save. Exactly the shape of "it does nothing and the log is clean",
    // because as far as the app was concerned nothing had gone wrong.
    //
    // Binding listeners needs no data. Doing it first means a data failure costs the data,
    // not the interface.
    // 2. Events
    modSelect?.addEventListener('change', async () => {
        if (_mapperBusy)
            return;
        if (!modSelect.value && modSelect.value !== "")
            return;
        selectedModId = modSelect.value;
        selectedPaths.clear();
        pendingMoves.clear();
        pendingDeletions.clear();
        updateSaveButtonVisibility();
        updateSelectionCounter();
        _mapperBusy = true;
        try {
            await refreshModTree();
        }
        finally {
            _mapperBusy = false;
        }
        if (selectedModId)
            dispatchBmmAction(BMM_ACTIONS.MAPPER_MOD_SELECTED, { modId: selectedModId });
    });
    profileSelect?.addEventListener('change', async () => {
        const newProfileId = profileSelect.value;
        if (!newProfileId || _mapperBusy)
            return;
        _mapperBusy = true;
        try {
            await invoke('set_active_profile', { profileId: newProfileId });
            // Profile changed — force reload both trees and reset caches
            lastGamePath = null;
            lastModFolderPath = null;
            await refreshMapperData();
            await refreshGameTree(true);
            if (selectedModId)
                await refreshModTree(true);
            toast(t("common.saved"), "success");
        }
        catch (e) {
            toast(e.message || e, "error");
        }
        finally {
            _mapperBusy = false;
        }
    });
    previewBtn?.addEventListener('click', showMapperPreview);
    refreshBtn?.addEventListener('click', async () => {
        if (pendingMoves.size > 0) {
            if (!confirm(t("mapper.confirmRefresh")))
                return;
        }
        pendingMoves.clear();
        updateSaveButtonVisibility();
        modSelect.disabled = true;
        profileSelect.disabled = true;
        try {
            await refreshMapperData();
            // Manual refresh — always bypass cache
            await refreshGameTree(true);
            if (selectedModId)
                await refreshModTree(true);
        }
        finally {
            modSelect.disabled = false;
            profileSelect.disabled = false;
        }
    });
    saveBtn?.addEventListener('click', applyAllChanges);
    // 3. Search Filters & Controls
    setupFilters();
    setupContextMenu();
    setupInputModal();
    // 4. Initial data — BOTH halves of it.
    //
    // This called refreshGameTree() alone, and that function reads `activeProfile`, which
    // ONLY refreshMapperData() ever sets. Both of its other call sites are inside event
    // listeners (the profile dropdown and the Refresh button), so on a fresh start nothing
    // had ever set it: the tree rendered "load a profile to view the game folder" and stayed
    // that way until you pressed Refresh by hand, every single time.
    //
    // The events-first ordering above is preserved — this is still the last thing the
    // function does — and the catch keeps the lesson that comment records: a data failure
    // costs the data, not the interface.
    try {
        await refreshMapperData();
        await refreshGameTree();
    }
    catch (e) {
        console.error('[MAPPER] initial load failed; the interface is still bound', e);
    }
    // Auto-refresh when entering view — only if profile changed
    document.querySelector('.nav-item[data-view="mapper"]')?.addEventListener('click', async () => {
        const currentProfileId = profileSelect?.value || null;
        const profileChanged = currentProfileId !== lastProfileId;
        if (profileChanged) {
            modSelect.disabled = true;
            profileSelect.disabled = true;
            try {
                await refreshMapperData();
                await refreshGameTree();
                if (selectedModId)
                    await refreshModTree();
            }
            finally {
                modSelect.disabled = false;
                profileSelect.disabled = false;
            }
        }
    });
    // Global click to hide context menu
    document.addEventListener('mousedown', (e) => {
        const menu = document.getElementById('mapper-context-menu');
        if (menu && menu.style.display === 'block') {
            if (!menu.contains(e.target))
                hideContextMenu();
        }
    });
    // Auto-refresh mapper profiles/mods when a profile is created or mods are scanned
    onBmmAction(BMM_ACTIONS.PROFILE_CREATED, async () => {
        await refreshMapperData();
        await refreshGameTree(true);
        if (selectedModId)
            await refreshModTree(true);
    });
    onBmmAction(BMM_ACTIONS.MODS_SCANNED, async () => {
        const modSelect = document.getElementById('mapper-mod-select');
        const currentVal = selectedModId;
        await refreshMapperData();
        // Restore selection silently after scan
        if (currentVal && modSelect?.querySelector(`option[value="${currentVal}"]`)) {
            modSelect.value = currentVal;
        }
    });
    // Live refresh: update mod selector when mods list changes from any part of the app
    window.addEventListener('bmm:mods-updated', async () => {
        const modSelect = document.getElementById('mapper-mod-select');
        if (!modSelect)
            return;
        const currentVal = modSelect.value;
        await refreshMapperData();
        // Restore selection if mod still exists
        if (currentVal && modSelect.querySelector(`option[value="${currentVal}"]`)) {
            modSelect.value = currentVal;
        }
    });
    // ── Auto-detect new mods in the active profile's mods folder ──
    // Poll every 8s while mapper is visible; scan+notify only when count changes.
    let _mapperPollTimer = null;
    let _lastKnownModCount = -1;
    const startMapperPoll = async () => {
        if (_mapperPollTimer)
            return;
        _mapperPollTimer = setInterval(async () => {
            if (!document.getElementById('view-mapper')?.classList.contains('active-view') &&
                !document.querySelector('.nav-item[data-view="mapper"]')?.classList.contains('active')) {
                return; // Mapper not visible, skip
            }
            try {
                const mods = await invoke('get_mods');
                const count = mods.length;
                if (_lastKnownModCount !== -1 && count !== _lastKnownModCount) {
                    // New mod detected — auto-scan without user action
                    await invoke('scan_mods_folder').catch(() => { });
                    const modSelect = document.getElementById('mapper-mod-select');
                    const currentVal = selectedModId;
                    await refreshMapperData();
                    if (currentVal && modSelect?.querySelector(`option[value="${currentVal}"]`)) {
                        modSelect.value = currentVal;
                    }
                    const diff = count - _lastKnownModCount;
                    if (diff > 0) {
                        toast(`${diff} ${t('mapper.newModsDetected') || 'new mod(s) detected and added automatically'}`, 'success', 3000);
                    }
                }
                _lastKnownModCount = count;
            }
            catch (_) { }
        }, 8000);
    };
    const stopMapperPoll = () => {
        if (_mapperPollTimer) {
            clearInterval(_mapperPollTimer);
            _mapperPollTimer = null;
        }
    };
    // Start/stop poll based on visibility
    document.querySelector('.nav-item[data-view="mapper"]')?.addEventListener('click', () => {
        _lastKnownModCount = -1; // reset so first poll sets baseline
        startMapperPoll();
    });
    document.querySelectorAll('.nav-item:not([data-view="mapper"])').forEach(n => n.addEventListener('click', stopMapperPoll));
    // 1. Initial data load, LAST, and its failure is its own problem: everything above is
    // already wired, so a bad profile costs an empty tree rather than a dead panel.
    try {
        await refreshMapperData();
    }
    catch (e) {
        console.error('[mapper] initial data load failed', e);
    }
}
/**
 * Refreshes available mods and the active profile
 */
async function refreshMapperData() {
    try {
        const profiles = await invoke('get_profiles');
        const activeId = await invoke('get_active_profile_id');
        activeProfile = profiles.find(p => p.id === activeId) || null;
        lastProfileId = activeId;
        const profileSelect = document.getElementById('mapper-profile-select');
        if (profileSelect) {
            // Fetch custom icons in parallel then populate options.
            const iconPaths = await fetchProfileIconPaths(profiles);
            profileSelect.innerHTML = `<option value="">— ${t('mapper.selectProfile') || 'Changer de profil'} —</option>`;
            profiles.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                if (p.id === activeId)
                    opt.selected = true;
                profileSelect.appendChild(opt);
            });
            // Show the selected profile's icon in the sibling display element.
            const wrap = profileSelect.closest('.profile-select-icon-wrap');
            if (wrap) {
                let iconEl = wrap.querySelector('.profile-icon-display');
                if (!iconEl) {
                    iconEl = document.createElement('span');
                    iconEl.className = 'profile-icon-display';
                    wrap.insertBefore(iconEl, profileSelect);
                }
                decorateProfileOptions(profileSelect, profiles, iconPaths);
                updateSelectProfileIcon(profileSelect, profiles, iconPaths, iconEl);
                profileSelect.addEventListener('change', () => updateSelectProfileIcon(profileSelect, profiles, iconPaths, iconEl));
            }
        }
        if (activeProfile) {
            const pathEl = document.getElementById('mapper-game-path');
            if (pathEl) {
                pathEl.textContent = activeProfile.game_path;
                pathEl.title = activeProfile.game_path;
            }
            const modSelect = document.getElementById('mapper-mod-select');
            if (modSelect) {
                const enrichedMods = await invoke('get_mods');
                const currentVal = modSelect.value;
                modSelect.innerHTML = `<option value="">— ${t('mapper.selectMod') || 'Sélectionner un mod'} —</option>`;
                enrichedMods.forEach((m) => {
                    const opt = document.createElement('option');
                    opt.value = m.id;
                    opt.textContent = m.name;
                    // Store folder path in dataset to avoid extra get_all_mods call
                    opt.dataset.folderPath = m.mod_folder_path || '';
                    if (m.id === currentVal)
                        opt.selected = true;
                    modSelect.appendChild(opt);
                });
            }
        }
    }
    catch (e) {
        console.error("[MAPPER] Data load failed:", e);
    }
}
/**
 * Loads and renders the selected mod's file tree
 */
async function refreshModTree(force = false) {
    const container = document.getElementById('mapper-mod-tree');
    if (!container)
        return;
    if (!selectedModId) {
        container.innerHTML = `<div class="empty-hint">${t('mapper.selectModHint') || 'Select a mod to see its contents'}</div>`;
        return;
    }
    // Try to get folder path from the select option (cached) to avoid an extra invoke
    const modSelect = document.getElementById('mapper-mod-select');
    const selectedOption = modSelect?.options[modSelect.selectedIndex];
    let modFolderPath = selectedOption?.dataset.folderPath || null;
    // If no cached path, fall back to get_all_mods
    if (!modFolderPath) {
        try {
            const mods = await invoke('get_all_mods');
            const m = mods.find(mod => mod.id === selectedModId);
            if (!m) {
                container.innerHTML = `<div class="empty-hint error">${t('mapper.modNotFound') || 'Mod non trouvé'}</div>`;
                return;
            }
            modFolderPath = m.mod_folder_path;
        }
        catch (e) {
            container.innerHTML = `<div class="empty-hint error" style="color:var(--danger)">${e}</div>`;
            return;
        }
    }
    // Skip reload if same mod folder is already loaded
    if (!force && lastModFolderPath === modFolderPath && modTreeData.length > 0) {
        await renderFilteredModTree();
        return;
    }
    container.innerHTML = `<div class="loading-spinner-container"><div class="loading-spinner"></div></div>`;
    try {
        modTreeData = await invoke('get_directory_tree', { path: modFolderPath });
        lastModFolderPath = modFolderPath;
        await renderFilteredModTree();
    }
    catch (e) {
        // Mod folder may have been moved externally — show a friendly error and
        // clear the selection so the user can pick a different mod.
        const msg = String(e);
        const isMissing = msg.includes('not found') || msg.includes('introuvable') ||
            msg.includes('n\'existe pas') || msg.includes('NotFound') || msg.includes('os error 2');
        if (isMissing) {
            selectedModId = null;
            modTreeData = [];
            lastModFolderPath = null;
            container.innerHTML = `
                <div class="empty-hint error" style="color:var(--danger);text-align:center;padding:20px;">
                    <div style="font-size:22px;margin-bottom:8px;">📂</div>
                    <strong>${t('mapper.modFolderMissing') || 'Mod folder not found'}</strong><br>
                    <span style="font-size:11px;color:var(--text-muted);display:block;margin-top:6px;">
                        ${t('mapper.modFolderMissingHint') || 'This mod\'s folder was moved or deleted externally. Rescan mods to update the list.'}
                    </span>
                    <button class="btn btn-sm btn-secondary" style="margin-top:12px;" id="btn-mapper-missing-rescan">
                        ${t('mapper.rescanMods') || 'Rescan mods'}
                    </button>
                </div>`;
            document.getElementById('btn-mapper-missing-rescan')?.addEventListener('click', async () => {
                await invoke('scan_mods_folder').catch(() => { });
                await refreshMapperData();
            });
            const modSelect = document.getElementById('mapper-mod-select');
            if (modSelect)
                modSelect.value = '';
        }
        else {
            container.innerHTML = `<div class="empty-hint error" style="color:var(--danger)">${escHtml(msg)}</div>`;
        }
    }
}
/**
 * Loads and renders the game directory tree
 */
async function refreshGameTree(force = false) {
    const container = document.getElementById('mapper-game-tree');
    if (!container)
        return;
    if (!activeProfile) {
        container.innerHTML = `<div class="empty-hint">${t('mapper.loadProfileHint') || 'Load a profile to view the destination folder'}</div>`;
        return;
    }
    if (!force && activeProfile.game_path === lastGamePath && gameTreeData.length > 0) {
        await renderFilteredGameTree();
        return;
    }
    container.innerHTML = `<div class="loading-spinner-container"><div class="loading-spinner"></div></div>`;
    try {
        gameTreeData = await invoke('get_directory_tree', { path: activeProfile.game_path });
        lastGamePath = activeProfile.game_path;
        await renderFilteredGameTree();
    }
    catch (e) {
        container.innerHTML = `<div class="empty-hint error" style="color:var(--danger)">Error: ${e.message || e}</div>`;
    }
}
function setupFilters() {
    const modFilter = document.getElementById('mapper-mod-search');
    const gameFilter = document.getElementById('mapper-game-search');
    let debounceModTimer;
    let debounceGameTimer;
    const debouncedModSearch = () => {
        clearTimeout(debounceModTimer);
        debounceModTimer = setTimeout(() => renderFilteredModTree(), 300);
    };
    const debouncedGameSearch = () => {
        clearTimeout(debounceGameTimer);
        debounceGameTimer = setTimeout(() => renderFilteredGameTree(), 300);
    };
    modFilter?.addEventListener('input', debouncedModSearch);
    gameFilter?.addEventListener('input', debouncedGameSearch);
    // (btn-mapper-mod-selectroot is now rendered on the mod-root tree item itself)
    document.getElementById('btn-mapper-mod-expand')?.addEventListener('click', () => toggleAll('mapper-mod-tree', true));
    document.getElementById('btn-mapper-mod-collapse')?.addEventListener('click', () => toggleAll('mapper-mod-tree', false));
    document.getElementById('btn-mapper-game-expand')?.addEventListener('click', () => toggleAll('mapper-game-tree', true));
    document.getElementById('btn-mapper-game-collapse')?.addEventListener('click', () => toggleAll('mapper-game-tree', false));
    // Shared with the server repo's banner — ui/dismissible-tip.ts.
    wireDismissibleTip({
        bannerId: 'mapper-help-banner',
        closeId: 'btn-mapper-hint-close',
        showId: 'btn-mapper-hint-show',
        storageKey: 'bmm_mapper_hint_hidden',
    });
}
function toggleAll(containerId, expand) {
    const container = document.getElementById(containerId);
    if (!container)
        return;
    // Bump token — any running doExpandAll for this container will see the mismatch and abort
    const myToken = (_expandTokens.get(containerId) ?? 0) + 1;
    _expandTokens.set(containerId, myToken);
    if (!expand) {
        // Collapse all: hide everything immediately (cancels any ongoing expansion)
        container.querySelectorAll('.tree-children').forEach((c) => {
            c.style.display = 'none';
            const item = c.previousElementSibling;
            if (item) {
                item.style.opacity = '0.7';
                item.classList.remove('expanded');
            }
        });
        return;
    }
    // Expand: use _expandFn with cancellation support.
    // Process in batches with requestAnimationFrame yields to keep UI responsive.
    const BATCH = 6;
    const doExpandAll = async () => {
        let round = 0;
        while (round++ < 10) {
            if (_expandTokens.get(containerId) !== myToken)
                return; // cancelled by collapse
            const toExpand = Array.from(container.querySelectorAll('.folder'))
                .filter(el => {
                const next = el.nextElementSibling;
                return next?.classList.contains('tree-children') &&
                    next.style.display !== 'block';
            });
            if (toExpand.length === 0)
                break;
            // Process in small batches, yielding to the browser between each
            for (let i = 0; i < toExpand.length; i += BATCH) {
                if (_expandTokens.get(containerId) !== myToken)
                    return; // cancelled
                const batch = toExpand.slice(i, i + BATCH);
                for (const folderItem of batch) {
                    if (folderItem._expandFn) {
                        await folderItem._expandFn();
                    }
                }
                await new Promise(r => requestAnimationFrame(r));
            }
        }
    };
    doExpandAll();
}
/**
 * Builds a virtual tree reflecting pending moves
 */
function getVirtualModTree() {
    if (pendingMoves.size === 0 && pendingNewFolders.size === 0)
        return modTreeData;
    const virtualTree = typeof structuredClone === 'function' ? structuredClone(modTreeData) : JSON.parse(JSON.stringify(modTreeData)); // Deep copy
    // 1. Remove moved items from their original locations
    const movedOriginalPaths = Array.from(pendingMoves.keys());
    const removeFromTree = (nodes) => {
        for (let i = nodes.length - 1; i >= 0; i--) {
            if (movedOriginalPaths.includes(nodes[i].path)) {
                nodes.splice(i, 1);
            }
            else if (nodes[i].children) {
                removeFromTree(nodes[i].children);
            }
        }
    };
    removeFromTree(virtualTree);
    // 2. Insert items into their new virtual locations
    pendingMoves.forEach((targetFolder, sourcePath) => {
        const fileName = sourcePath.split(/[\\/]/).pop() || sourcePath;
        const newNode = {
            name: fileName,
            path: sourcePath,
            is_dir: false,
            children: null
        };
        if (targetFolder === ".") {
            virtualTree.push(newNode);
        }
        else {
            const folderParts = targetFolder.split(/[\\/]/);
            let currentLevel = virtualTree;
            let currentPath = "";
            folderParts.forEach((part, idx) => {
                currentPath = currentPath ? `${currentPath}\\${part}` : part;
                let folder = currentLevel.find(n => n.name === part && n.is_dir);
                if (!folder) {
                    folder = { name: part, path: `VIRTUAL_${currentPath}`, is_dir: true, children: [] };
                    currentLevel.push(folder);
                }
                if (idx === folderParts.length - 1) {
                    if (!folder.children)
                        folder.children = [];
                    folder.children.push(newNode);
                }
                else {
                    if (!folder.children)
                        folder.children = [];
                    currentLevel = folder.children;
                }
            });
        }
    });
    // 3. Insert pending new folders
    pendingNewFolders.forEach((data, virtualPath) => {
        const newNode = {
            name: data.name,
            path: virtualPath,
            is_dir: true,
            children: []
        };
        if (data.parent === ".") {
            virtualTree.push(newNode);
        }
        else {
            const findAndInsert = (nodes) => {
                for (const node of nodes) {
                    if (node.path === data.parent || (node.path === "." && data.parent === ".")) {
                        if (!node.children)
                            node.children = [];
                        node.children.push(newNode);
                        return true;
                    }
                    if (node.children && findAndInsert(node.children))
                        return true;
                }
                return false;
            };
            findAndInsert(virtualTree);
        }
    });
    return virtualTree;
}
async function renderFilteredModTree() {
    const modFilter = document.getElementById('mapper-mod-search')?.value.toLowerCase() || '';
    const modContainer = document.getElementById('mapper-mod-tree');
    if (modContainer) {
        modContainer.innerHTML = '';
        // Add Virtual "Racine du Mod" item — with a "select whole mod" button on it
        if (selectedModId) {
            const rootItem = document.createElement('div');
            rootItem.className = 'tree-item folder root-target-item mod-root-target';
            rootItem.innerHTML = `
                <span class="tree-item-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
                        <path d="m3.3 7 8.7 5 8.7-5"/>
                        <path d="M12 22V12"/>
                    </svg>
                </span>
                <span class="tree-item-label">${t('mapper.modRoot') || 'Racine du Mod'}</span>
                <button class="mapper-root-select-btn" id="btn-mapper-mod-selectroot" data-tooltip="${t('mapper.selectRoot') || 'Select whole mod root'}">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                        <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                    </svg>
                </button>`;
            rootItem.dataset.path = ".";
            rootItem.querySelector('#btn-mapper-mod-selectroot')?.addEventListener('click', (e) => {
                e.stopPropagation();
                selectModRoot();
            });
            rootItem.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showContextMenu(e.clientX, e.clientY, ".", true, true);
            });
            modContainer.appendChild(rootItem);
        }
        await renderTree(filterTree(getVirtualModTree(), modFilter), modContainer, true);
    }
    updateLiveMappingHighlight();
}
async function renderFilteredGameTree() {
    const gameFilter = document.getElementById('mapper-game-search')?.value.toLowerCase() || '';
    const gameContainer = document.getElementById('mapper-game-tree');
    if (gameContainer) {
        gameContainer.innerHTML = '';
        const rootItem = document.createElement('div');
        rootItem.className = 'tree-item folder root-target-item game-root-target';
        rootItem.innerHTML = `
            <span class="tree-item-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
                    <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
                    <line x1="6" y1="6" x2="6.01" y2="6"/>
                    <line x1="6" y1="18" x2="6.01" y2="18"/>
                </svg>
            </span>
            <span class="tree-item-label">${t('mapper.gameRoot') || 'Racine du Jeu'}</span>`;
        rootItem.dataset.path = ".";
        rootItem.title = t('mapper.dblClickDumpHint') || 'Double-click: move selection here (or the whole mod if nothing is selected)';
        rootItem.addEventListener('dblclick', () => queueMoveSelectedOrRoot("."));
        rootItem.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showContextMenu(e.clientX, e.clientY, ".", true, false);
        });
        gameContainer.appendChild(rootItem);
        await renderTree(filterTree(gameTreeData, gameFilter), gameContainer, false);
    }
    updateLiveMappingHighlight();
}
function filterTree(nodes, query) {
    if (!query)
        return nodes;
    return nodes.reduce((acc, node) => {
        const matchesSelf = node.name.toLowerCase().includes(query);
        const filteredChildren = node.children ? filterTree(node.children, query) : null;
        const hasMatchingChildren = filteredChildren && filteredChildren.length > 0;
        if (matchesSelf || hasMatchingChildren) {
            acc.push({ ...node, children: filteredChildren });
        }
        return acc;
    }, []);
}
async function renderTree(nodes, container, isModSide) {
    if (!nodes || nodes.length === 0) {
        if (container.classList.contains('file-tree')) {
            const empty = document.createElement('div');
            empty.className = 'empty-hint';
            empty.textContent = t('common.noResults') || 'No results';
            container.appendChild(empty);
        }
        return;
    }
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < nodes.length; i++) {
        if (i > 0 && i % 100 === 0) {
            // Yield to main thread to prevent UI freezing on huge trees
            await new Promise(r => setTimeout(r, 0));
        }
        const node = nodes[i];
        const item = document.createElement('div');
        item.className = `tree-item ${node.is_dir ? 'folder pointer-clickable' : 'file'}`;
        if (isModSide) {
            const isPending = pendingMoves.has(node.path);
            let isAtRoot = true;
            if (isPending) {
                const target = pendingMoves.get(node.path);
                isAtRoot = target === ".";
            }
            else if (!node.path.startsWith('VIRTUAL_')) {
                isAtRoot = !node.path.includes('/') && !node.path.includes('\\');
            }
            if (isAtRoot)
                item.classList.add('root-item');
            else
                item.classList.add('mapped-item');
            if (isPending)
                item.classList.add('pending-item');
        }
        if (selectedPaths.has(node.path))
            item.classList.add('selected');
        item.dataset.path = node.path;
        item.dataset.name = node.name;
        const icon = document.createElement('span');
        icon.className = 'tree-item-icon';
        icon.innerHTML = node.is_dir ?
            `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>` :
            `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`;
        const label = document.createElement('span');
        label.className = 'tree-item-label';
        if (isModSide && pendingMoves.has(node.path)) {
            const target = pendingMoves.get(node.path);
            const targetDisplay = target === "." ? (t('mapper.root') || "Racine") : target;
            label.innerHTML = `${node.name} <span class="pending-badge">→ ${targetDisplay}</span>`;
        }
        else if (isModSide && pendingDeletions.has(node.path)) {
            label.innerHTML = `<span style="text-decoration: line-through; opacity: 0.6;">${node.name}</span> <span class="pending-badge danger" style="background: var(--danger);">${t('common.delete') || 'Supprimer'}</span>`;
            item.classList.add('pending-delete');
        }
        else if (isModSide && pendingNewFolders.has(node.path)) {
            label.innerHTML = `${node.name} <span class="pending-badge success" style="background: var(--success);">${t('mapper.newBadge') || 'NOUVEAU'}</span>`;
            item.classList.add('pending-new');
        }
        else {
            label.textContent = node.name;
        }
        if (node.is_dir) {
            const chevron = document.createElement('span');
            chevron.className = 'tree-item-chevron';
            chevron.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>`;
            chevron.addEventListener('click', (e) => {
                e.stopPropagation();
                const childrenContainer = item.nextElementSibling;
                if (childrenContainer && childrenContainer.classList.contains('tree-children')) {
                    const isCollapsed = childrenContainer.style.display === 'none';
                    childrenContainer.style.display = isCollapsed ? 'block' : 'none';
                    chevron.style.transform = isCollapsed ? 'rotate(0deg)' : 'rotate(-90deg)';
                }
            });
            item.appendChild(chevron);
        }
        item.appendChild(icon);
        item.appendChild(label);
        fragment.appendChild(item);
        // Selection logic on mousedown
        item.addEventListener('mousedown', (e) => {
            if (e.button !== 0)
                return;
            e.stopPropagation();
            if (isModSide && !node.path.startsWith('VIRTUAL_')) {
                if (e.ctrlKey) {
                    if (selectedPaths.has(node.path))
                        selectedPaths.delete(node.path);
                    else
                        selectedPaths.add(node.path);
                }
                else {
                    selectedPaths.clear();
                    selectedPaths.add(node.path);
                }
                lastSelectedPath = node.path;
                updateSelectionVisuals();
                updateSelectionCounter();
                updateLiveMappingHighlight();
            }
        });
        if (!isModSide && node.is_dir) {
            item.title = t('mapper.dblClickDumpHint') || 'Double-click: move selection here (or the whole mod if nothing is selected)';
            item.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                queueMoveSelectedOrRoot(node.path);
            });
        }
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!node.path.startsWith('VIRTUAL_')) {
                // If the right-clicked item is not already selected, make it the only selection
                if (!selectedPaths.has(node.path)) {
                    selectedPaths.clear();
                    selectedPaths.add(node.path);
                    updateSelectionVisuals();
                    updateSelectionCounter();
                    if (isModSide)
                        updateLiveMappingHighlight();
                }
                showContextMenu(e.clientX, e.clientY, node.path, node.is_dir, isModSide);
            }
        });
        if (node.is_dir) {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'tree-children';
            const isSearching = document.getElementById(isModSide ? 'mapper-mod-search' : 'mapper-game-search')?.value.length > 0;
            // LAZY LOADING OPTIMIZATION: 
            // If we are searching, we render everything. 
            // If NOT searching, we only render children if the folder is already expanded (rare) or wait for user click.
            childrenContainer.style.display = isSearching ? 'block' : 'none';
            fragment.appendChild(childrenContainer);
            if (isSearching && node.children && node.children.length > 0) {
                await renderTree(node.children, childrenContainer, isModSide);
            }
            // Click listener for lazy expansion
            const toggleFolder = async (e) => {
                e.stopPropagation();
                const isCollapsed = childrenContainer.style.display === 'none';
                if (isCollapsed) {
                    // If not rendered yet, do it now
                    if (childrenContainer.children.length === 0 && node.children && node.children.length > 0) {
                        const spinner = document.createElement('div');
                        spinner.className = 'tree-loading-inline';
                        spinner.innerHTML = '<span class="spinner-tiny"></span>';
                        childrenContainer.appendChild(spinner);
                        childrenContainer.style.display = 'block';
                        await renderTree(node.children, childrenContainer, isModSide);
                        spinner.remove();
                    }
                    else {
                        childrenContainer.style.display = 'block';
                    }
                    if (chevron)
                        chevron.style.transform = 'rotate(0deg)';
                    item.style.opacity = '1';
                    item.classList.add('expanded');
                    const iconBox = item.querySelector('.tree-item-icon');
                    if (iconBox)
                        iconBox.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v2"></path><path d="M2 11h20"></path></svg>`;
                }
                else {
                    childrenContainer.style.display = 'none';
                    if (chevron)
                        chevron.style.transform = 'rotate(-90deg)';
                    item.style.opacity = '0.7';
                    item.classList.remove('expanded');
                    const iconBox = item.querySelector('.tree-item-icon');
                    if (iconBox)
                        iconBox.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
                }
            };
            const chevron = item.querySelector('.tree-item-chevron');
            if (chevron) {
                // Replace old listener
                const newChevron = chevron.cloneNode(true);
                chevron.parentNode?.replaceChild(newChevron, chevron);
                newChevron.addEventListener('click', toggleFolder);
            }
            // Also toggle on item click (includes icon and label) if not selecting
            item.addEventListener('click', (e) => {
                const isSelectionAction = e.ctrlKey || e.shiftKey;
                if (!isSelectionAction) {
                    toggleFolder(e);
                }
            });
            // Direct expand function for toggleAll — avoids click-event race conditions
            item._expandFn = async () => {
                if (childrenContainer.style.display === 'block')
                    return; // already open
                if (childrenContainer.children.length === 0 && node.children && node.children.length > 0) {
                    await renderTree(node.children, childrenContainer, isModSide);
                }
                childrenContainer.style.display = 'block';
                const ch = item.querySelector('.tree-item-chevron');
                if (ch)
                    ch.style.transform = 'rotate(0deg)';
                item.style.opacity = '1';
                item.classList.add('expanded');
            };
        }
    }
    container.appendChild(fragment);
}
function updateSelectionCounter() {
    const el = document.getElementById('mapper-selection-count');
    if (!el)
        return;
    // Hidden at zero rather than reading "0 selected". A badge that is always present says
    // nothing when it says zero, and it competes with the panel title for the same glance.
    const n = selectedPaths.size;
    el.hidden = n === 0;
    el.textContent = n === 0 ? '' : `${n} ${t("modpack.modsSelected")}`;
}
function updateSaveButtonVisibility() {
    const saveBtn = document.getElementById('btn-mapper-save');
    if (saveBtn) {
        saveBtn.style.display = (pendingMoves.size > 0 || pendingDeletions.size > 0 || pendingNewFolders.size > 0) ? 'flex' : 'none';
    }
}
const _archiveChoice = new Map();
/** Ask what should happen to an archived mod. null = the user cancelled. */
function askArchiveStrategy(wasZip) {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-confirm-generic');
        const titleEl = document.getElementById('confirm-title');
        const msgEl = document.getElementById('confirm-message');
        const yesBtn = document.getElementById('btn-confirm-yes');
        const noBtn = document.getElementById('btn-confirm-cancel');
        if (!modal || !titleEl || !msgEl || !yesBtn || !noBtn) {
            resolve(null);
            return;
        }
        titleEl.textContent = t('mapper.archiveTitle');
        // Shown only when the original was NOT a .zip. BMM READS 7z and rar but can only
        // WRITE zip, so "put it back" cannot mean "back into a .rar". Said before the choice,
        // not discovered afterwards as a changed extension on their disk.
        const note = wasZip ? '' : '<p class="mapper-arch-note">' + escHtml(t('mapper.archiveNoteFormat')) + '</p>';
        msgEl.innerHTML =
            '<div class="mapper-arch">' +
                '<p class="mapper-arch-intro">' + escHtml(t('mapper.archiveIntro')) + '</p>' +
                note +
                '<button type="button" class="mapper-arch-opt" id="mapper-arch-zip">' +
                '<span class="mapper-arch-opt-t">' + escHtml(t('mapper.archiveKeepZip')) + '</span>' +
                '<span class="mapper-arch-opt-d">' + escHtml(t('mapper.archiveKeepZipDesc')) + '</span>' +
                '</button>' +
                '<button type="button" class="mapper-arch-opt" id="mapper-arch-folder">' +
                '<span class="mapper-arch-opt-t">' + escHtml(t('mapper.archiveKeepFolder')) + '</span>' +
                '<span class="mapper-arch-opt-d">' + escHtml(t('mapper.archiveKeepFolderDesc')) + '</span>' +
                '</button>' +
                '</div>';
        // The two real answers are the cards; the footer keeps only a way out. Same borrowing
        // pattern the plugin-permission modal uses — and confirmCustom normalises this shared
        // modal on its next open, so an exit by any route cannot leave it broken.
        yesBtn.style.display = 'none';
        noBtn.textContent = t('common.cancel');
        let done = false;
        const finish = (v) => {
            if (done)
                return;
            done = true;
            modal.classList.remove('open');
            yesBtn.style.display = '';
            noBtn.removeEventListener('click', onCancel);
            modal.removeEventListener('click', onBackdrop);
            resolve(v);
        };
        const onCancel = () => finish(null);
        const onBackdrop = (ev) => { if (ev.target === modal)
            finish(null); };
        noBtn.addEventListener('click', onCancel);
        modal.addEventListener('click', onBackdrop);
        msgEl.querySelector('#mapper-arch-zip')?.addEventListener('click', () => finish('zip'));
        msgEl.querySelector('#mapper-arch-folder')?.addEventListener('click', () => finish('folder'));
        modal.classList.add('open');
    });
}
/**
 * Make the selected mod writable, asking first if it is archived.
 * Returns false when the user cancelled — the caller must then do nothing at all.
 */
async function ensureModWritable() {
    if (!selectedModId)
        return false;
    let archived = false;
    try {
        archived = await invoke('is_mod_archived', { modId: selectedModId });
    }
    catch {
        return true;
    } // cannot tell → let the Rust guard have the last word
    if (!archived)
        return true;
    const choice = await askArchiveStrategy(_selectedModIsZip());
    if (!choice)
        return false;
    try {
        const folder = await invoke('unarchive_mod', { modId: selectedModId });
        _archiveChoice.set(selectedModId, choice);
        // THE MOD HAS MOVED. `Mod.zip` is gone and `Mod/` has taken its place, and
        // refreshModTree reads the folder path out of the <option>'s dataset — a cache
        // filled when the list was built. Leaving the dead .zip path there made the very
        // next get_directory_tree fail with "Le dossier n'existe pas", which refreshModTree
        // reads as "this mod was deleted externally" and answers by setting selectedModId
        // to null. applyAllChanges then carried on and sent `modId: null` to
        // restructure_mod_item. Two errors in the console, one cause, and both of them here.
        const sel = document.getElementById('mapper-mod-select');
        const opt = sel?.options[sel.selectedIndex];
        if (opt)
            opt.dataset.folderPath = folder;
        lastModFolderPath = null; // the tree cache is keyed on the path, which just changed
        toast(t('mapper.archiveUnpacked'), 'success');
        await refreshModTree(true);
        return true;
    }
    catch (e) {
        toast(e.message || e, 'error');
        return false;
    }
}
/** True when the selected mod's file name ends in .zip (so repacking is lossless). */
function _selectedModIsZip() {
    const sel = document.getElementById('mapper-mod-select');
    const label = sel?.options[sel.selectedIndex]?.text || '';
    return /\.zip\s*$/i.test(label.trim());
}
/** Put the mod back into a .zip if that is what was asked, once the changes are applied. */
async function restoreArchiveIfAsked(modId) {
    if (_archiveChoice.get(modId) !== 'zip')
        return;
    try {
        await invoke('rearchive_mod', { modId });
        _archiveChoice.delete(modId);
        lastModFolderPath = null; // the mod moved again: folder -> .zip
        toast(t('mapper.archiveRezipped'), 'success');
        await refreshMapperData();
    }
    catch (e) {
        // The changes ARE saved; only the repacking failed. Say exactly that — a bare "error"
        // would read as if the edit had been lost, and the user would redo it.
        toast(t('mapper.archiveRezipFailed', { err: String(e?.message || e) }), 'warning');
    }
}
async function applyAllChanges() {
    if (pendingMoves.size === 0 && pendingDeletions.size === 0)
        return;
    // Archived mod → ask, unpack, and only then write. Cancelling leaves every queued
    // change pending, so nothing the user lined up is thrown away by saying no.
    if (!await ensureModWritable())
        return;
    // Capture the id ONCE and use it for every call below.
    //
    // selectedModId is module state that other code is entitled to clear — refreshModTree
    // nulls it when a mod's folder has gone missing, which is a reasonable thing for it to
    // do. What is not reasonable is a half-finished batch of writes then sending `null` as
    // the mod id and getting "invalid type: null, expected a string" from the Rust side. A
    // batch that has started works on the mod it started with.
    const modId = selectedModId;
    if (!modId) {
        toast(t('mapper.selectModHint'), 'warning');
        return;
    }
    const saveBtn = document.getElementById('btn-mapper-save');
    const originalText = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span class="spinner"></span> ${t('common.saving') || 'Saving...'}`;
    try {
        // 1. Handle new folders
        for (const [vPath, data] of pendingNewFolders.entries()) {
            await invoke('create_mod_folder', { modId, parentRelPath: data.parent, folderName: data.name });
        }
        // 2. Handle moves
        for (const [src, dst] of pendingMoves.entries()) {
            await invoke('restructure_mod_item', { modId, itemRelPath: src, targetGameFolderRel: dst });
        }
        // 3. Handle deletions
        for (const path of pendingDeletions) {
            await invoke('delete_mod_item', { modId, itemRelPath: path });
        }
        toast(t('common.success'), 'success');
        pendingMoves.clear();
        pendingDeletions.clear();
        pendingNewFolders.clear();
        await restoreArchiveIfAsked(modId);
        await refreshModTree(true);
        updateSaveButtonVisibility();
        selectedPaths.clear();
        updateSelectionCounter();
        updateSelectionVisuals();
    }
    catch (e) {
        toast(e.message || e, 'error');
    }
    finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalText;
    }
}
function queueMoveTo(targetPath) {
    const count = selectedPaths.size;
    selectedPaths.forEach(p => { pendingMoves.set(p, targetPath); });
    const targetDisplay = targetPath === "." ? (t("mapper.root") || "la racine") : targetPath;
    // t() returns the KEY itself when a key is missing, and a key is truthy — so the `||`
    // fallback that used to sit here could never run, and the toast read "mapper.itemsMoved"
    // verbatim. The key exists now; the fallback is gone because it was decoration.
    toast(t("mapper.itemsMoved", { count: count.toString(), target: targetDisplay }), "info");
    updateSaveButtonVisibility();
    renderFilteredModTree();
}
/** Select every top-level item of the current mod (the "mod root"), so the user
 *  visibly sees the whole mod selected and can dump it into a game folder. */
function selectModRoot() {
    if (!selectedModId) {
        toast(t('mapper.selectModFirst') || 'Select a mod first', 'warning');
        return;
    }
    const topLevel = (modTreeData || []).filter(n => !n.path.includes('/') && !n.path.includes('\\'));
    if (topLevel.length === 0) {
        toast(t('mapper.modEmpty') || 'This mod is empty', 'info');
        return;
    }
    selectedPaths.clear();
    topLevel.forEach(n => selectedPaths.add(n.path));
    lastSelectedPath = topLevel[topLevel.length - 1].path;
    updateSelectionVisuals();
    updateSelectionCounter();
    updateLiveMappingHighlight();
    toast(t('mapper.modRootSelected', { count: topLevel.length.toString() })
        || `Whole mod root selected (${topLevel.length} items) — double-click a destination folder to map it there`, 'info', 3500);
}
/** Move the current selection to `targetPath`. If nothing is selected, move the
 *  ENTIRE mod root (all top-level mod items) — "dump the whole mod here". */
function queueMoveSelectedOrRoot(targetPath) {
    if (selectedPaths.size > 0) {
        queueMoveTo(targetPath);
        return;
    }
    // No selection → dump every top-level mod item into the target folder
    const topLevel = (modTreeData || []).filter(n => {
        // top-level = path has no separator (or starts a virtual root)
        return !n.path.includes('/') && !n.path.includes('\\');
    });
    if (topLevel.length === 0) {
        toast(t('mapper.nothingToMap') || 'Nothing to map — select a mod first', 'warning');
        return;
    }
    topLevel.forEach(n => pendingMoves.set(n.path, targetPath));
    const targetDisplay = targetPath === "." ? (t("mapper.root") || "la racine") : targetPath;
    toast(t('mapper.modRootMapped', { count: topLevel.length.toString(), target: targetDisplay })
        || `Whole mod (${topLevel.length} items) mapped to "${targetDisplay}"`, 'success');
    updateSaveButtonVisibility();
    renderFilteredModTree();
}
function updateSelectionVisuals() {
    document.querySelectorAll('.tree-item.selected, .tree-item.parent-highlight').forEach(el => {
        el.classList.remove('selected', 'parent-highlight');
    });
    selectedPaths.forEach(path => {
        const safePath = path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        document.querySelectorAll(`.tree-item[data-path="${safePath}"]`).forEach(htmlItem => {
            htmlItem.classList.add('selected');
            highlightParents(htmlItem);
        });
    });
}
function highlightParents(item) {
    let p = item.parentElement;
    while (p && !p.classList.contains('file-tree')) {
        if (p.classList.contains('tree-children')) {
            const trigger = p.previousElementSibling;
            if (trigger && trigger.classList.contains('tree-item')) {
                trigger.classList.add('parent-highlight');
            }
        }
        p = p.parentElement;
    }
}
function updateLiveMappingHighlight() {
    const gameContainer = document.getElementById('mapper-game-tree');
    if (!gameContainer)
        return;
    gameContainer.querySelectorAll('.mapping-target-folder').forEach(el => el.classList.remove('mapping-target-folder'));
    if (selectedPaths.size === 0)
        return;
    selectedPaths.forEach(path => {
        const targetFolder = pendingMoves.get(path) || ".";
        const safeTarget = targetFolder.replace(/\//g, '\\').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const targetItem = gameContainer.querySelector(`.tree-item[data-path="${safeTarget}"]`);
        if (targetItem) {
            targetItem.classList.add('mapping-target-folder');
            highlightParents(targetItem);
            let p = targetItem.parentElement;
            while (p && p !== gameContainer) {
                if (p.classList.contains('tree-children')) {
                    if (p.style.display !== 'block') {
                        p.style.display = 'block';
                        const trigger = p.previousElementSibling;
                        if (trigger)
                            trigger.style.opacity = '1';
                    }
                }
                p = p.parentElement;
            }
        }
    });
}
/**
 * Context Menu
 */
function setupContextMenu() {
    const menu = document.getElementById('mapper-context-menu');
    if (!menu)
        return;
    document.getElementById('ctx-mapper-open')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (lastSelectedPath) {
            const isModSide = menu.classList.contains('mod-side-active');
            try {
                if (isModSide)
                    await invoke('open_item_in_explorer', { modId: selectedModId, itemRelPath: lastSelectedPath });
                else
                    await invoke('open_game_item_in_explorer', { itemRelPath: lastSelectedPath });
            }
            catch (err) {
                toast(err.message || err, 'error');
            }
        }
        hideContextMenu();
    });
    document.getElementById('ctx-mapper-copy')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const isModSide = menu.classList.contains('mod-side-active');
        const getAbsolutePath = (relPath) => {
            if (relPath === ".") {
                return isModSide ? lastModFolderPath : activeProfile?.game_path;
            }
            const root = isModSide ? lastModFolderPath : activeProfile?.game_path;
            if (!root)
                return relPath;
            // Ensure no double slashes
            const separator = root.endsWith('\\') || root.endsWith('/') ? '' : '\\';
            return `${root}${separator}${relPath}`;
        };
        if (selectedPaths.size > 1) {
            const paths = Array.from(selectedPaths).map(p => getAbsolutePath(p)).join('\n');
            navigator.clipboard.writeText(paths);
            toast(t('mapper.pathCopiedCount', { count: selectedPaths.size.toString() }) || `${selectedPaths.size} chemin(s) copié(s) !`);
        }
        else if (lastSelectedPath) {
            const fullPath = getAbsolutePath(lastSelectedPath);
            navigator.clipboard.writeText(fullPath || "");
            toast(t('mapper.pathCopied') || 'Chemin copié !');
        }
        hideContextMenu();
    });
    document.getElementById('ctx-mapper-cancel-mapping')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (selectedPaths.size > 0) {
            let count = 0;
            selectedPaths.forEach(p => {
                if (pendingMoves.has(p)) {
                    pendingMoves.delete(p);
                    count++;
                }
                else if (pendingDeletions.has(p)) {
                    pendingDeletions.delete(p);
                    count++;
                }
                else if (pendingNewFolders.has(p)) {
                    pendingNewFolders.delete(p);
                    // Also cancel any moves targeted to this folder?
                    // (Might be complex, for now just remove the folder)
                    count++;
                }
            });
            if (count > 0) {
                toast(t("mapper.actionCancelled", { count: count.toString() }) || `${count} action(s) annulée(s)`, "info");
                updateSaveButtonVisibility();
                renderFilteredModTree();
            }
        }
        hideContextMenu();
    });
    // Stage a new folder inside the mod. `parent` is the currently-selected mod folder
    // (or the mod root). Nothing hits disk until Save; cancel it via the item's
    // "Cancel mapping" action or the Refresh button (draft model).
    const stageNewFolder = () => {
        if (!selectedModId) {
            toast(t("mapper.selectModFirst") || "Sélectionnez d'abord un mod.", "warning");
            return;
        }
        openInputModal(t("mapper.newFolder"), t("mapper.enterName"), "", async (name) => {
            if (name && selectedModId) {
                const parent = lastSelectedPath || ".";
                const virtualPath = `NEW_${parent}_${name}`;
                pendingNewFolders.set(virtualPath, { parent, name });
                toast(t("mapper.folderStaged") || "Dossier planifié pour création", "info");
                try {
                    dispatchBmmAction(BMM_ACTIONS.MAPPER_FOLDER_STAGED, { name, parent });
                }
                catch { /* ignore */ }
                updateSaveButtonVisibility();
                renderFilteredModTree();
            }
        });
    };
    document.getElementById('ctx-mapper-new-folder')?.addEventListener('click', (e) => {
        e.stopPropagation();
        stageNewFolder();
        hideContextMenu();
    });
    // Discoverable toolbar button — same staging as the right-click "New folder".
    document.getElementById('btn-mapper-new-folder')?.addEventListener('click', (e) => {
        e.stopPropagation();
        stageNewFolder();
    });
    document.getElementById('ctx-mapper-rename')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentName = lastSelectedPath?.split(/[\\/]/).pop() || "";
        openInputModal(t("mapper.rename"), t("mapper.enterName"), currentName, async (name) => {
            if (name && selectedModId && lastSelectedPath) {
                // Renaming writes straight away instead of queueing, so it needs the same
                // archived-mod question that applyAllChanges asks.
                if (!await ensureModWritable())
                    return;
                // Captured AFTER the question, for the same reason applyAllChanges captures:
                // ensureModWritable may unpack the mod and refresh the tree, and a refresh
                // that finds a missing folder clears selectedModId. The rename then went out
                // with modId: null.
                const modId = selectedModId;
                if (!modId)
                    return;
                try {
                    const isRoot = lastSelectedPath === "." || lastSelectedPath === "" || lastSelectedPath === "/";
                    await invoke('rename_mod_item', { modId, itemRelPath: lastSelectedPath, newName: name });
                    if (isRoot) {
                        await refreshMapperData();
                        // Search for the mod with the new name in the select
                        const modSelect = document.getElementById('mapper-mod-select');
                        if (modSelect) {
                            for (let i = 0; i < modSelect.options.length; i++) {
                                // We check text content because ID might have changed if derived from folder name
                                if (modSelect.options[i].text === name) {
                                    modSelect.selectedIndex = i;
                                    selectedModId = modSelect.value;
                                    break;
                                }
                            }
                        }
                    }
                    toast(t("common.saved"), "success");
                    await refreshModTree(true);
                }
                catch (e) {
                    toast(e.message || e, "error");
                }
            }
        });
        hideContextMenu();
    });
    document.getElementById('ctx-mapper-delete')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (selectedPaths.size > 0) {
            const msg = t("mapper.confirmStagedDelete", { count: selectedPaths.size.toString() })
                || `Voulez-vous marquer ${selectedPaths.size} élément(s) pour suppression définitive ? (Sera appliqué lors du clic sur 'Appliquer la structure')`;
            openConfirmModal(t("common.confirmDelete") || "Confirmation de suppression", msg, () => {
                const count = selectedPaths.size;
                selectedPaths.forEach(p => {
                    pendingDeletions.add(p);
                    pendingMoves.delete(p);
                });
                selectedPaths.clear();
                updateSelectionCounter();
                updateSaveButtonVisibility();
                renderFilteredModTree();
                toast(t("mapper.itemsMarkedForDelete", { count: count.toString() }) || `${count} élément(s) marqué(s) pour suppression`, "info");
            });
        }
        hideContextMenu();
    });
}
function openConfirmModal(title, message, onOk) {
    const modal = document.getElementById('modal-mapper-confirm');
    const titleEl = document.getElementById('mapper-confirm-title');
    const msgEl = document.getElementById('mapper-confirm-message');
    const okBtn = document.getElementById('btn-mapper-confirm-ok');
    const cancelBtn = document.getElementById('btn-mapper-confirm-cancel');
    if (!modal || !okBtn || !cancelBtn)
        return;
    if (titleEl)
        titleEl.textContent = title;
    if (msgEl)
        msgEl.textContent = message;
    if (okBtn)
        okBtn.textContent = t("common.confirm") || "Confirmer";
    if (cancelBtn)
        cancelBtn.textContent = t("common.cancel") || "Annuler";
    const close = () => {
        modal.classList.remove('open');
        okBtn.removeEventListener('click', handleOk);
        cancelBtn.removeEventListener('click', close);
        modal.removeEventListener('click', handleOverlayClick);
    };
    const handleOk = () => {
        onOk();
        close();
    };
    const handleOverlayClick = (e) => {
        if (e.target === modal)
            close();
    };
    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', close);
    modal.addEventListener('click', handleOverlayClick);
    modal.classList.add('open');
}
function showContextMenu(x, y, path, isDir, isModSide) {
    const menu = document.getElementById('mapper-context-menu');
    if (!menu)
        return;
    lastSelectedPath = path;
    menu.style.display = 'block';
    if (isModSide)
        menu.classList.add('mod-side-active');
    else
        menu.classList.remove('mod-side-active');
    // Toggle Mod-only items
    const modOnly = menu.querySelectorAll('.mod-only-menu');
    modOnly.forEach(el => el.style.display = isModSide ? 'flex' : 'none');
    // For folders on mod side, show "New Folder"
    const newFolderBtn = document.getElementById('ctx-mapper-new-folder');
    if (newFolderBtn && isModSide)
        newFolderBtn.style.display = isDir ? 'flex' : 'none';
    // Protect ModRoot: Hide Rename/Delete if path is "." (root)
    const renameBtn = document.getElementById('ctx-mapper-rename');
    const deleteBtn = document.getElementById('ctx-mapper-delete');
    const isRoot = path === "." || path === "";
    if (renameBtn)
        renameBtn.style.display = (isModSide && !isRoot) ? 'flex' : 'none';
    if (deleteBtn)
        deleteBtn.style.display = (isModSide && !isRoot) ? 'flex' : 'none';
    // Show "Cancel Mapping" only if at least one selected item is in pendingMoves, pendingDeletions or pendingNewFolders
    const cancelMappingBtn = document.getElementById('ctx-mapper-cancel-mapping');
    if (cancelMappingBtn) {
        if (isModSide) {
            let hasPending = false;
            selectedPaths.forEach(p => {
                if (pendingMoves.has(p) || pendingDeletions.has(p) || pendingNewFolders.has(p))
                    hasPending = true;
            });
            cancelMappingBtn.style.display = hasPending ? 'flex' : 'none';
        }
        else {
            cancelMappingBtn.style.display = 'none';
        }
    }
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const winWidth = window.innerWidth;
    const winHeight = window.innerHeight;
    if (x + menuWidth > winWidth)
        x -= menuWidth;
    if (y + menuHeight > winHeight)
        y -= menuHeight;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
}
function hideContextMenu() {
    const menu = document.getElementById('mapper-context-menu');
    if (menu)
        menu.style.display = 'none';
}
/**
 * Input Modal Logic
 */
function setupInputModal() {
    const modal = document.getElementById('modal-mapper-input');
    const field = document.getElementById('mapper-input-field');
    const confirmBtn = document.getElementById('btn-mapper-input-confirm');
    const cancelBtn = document.getElementById('btn-mapper-input-cancel');
    confirmBtn?.addEventListener('click', () => {
        if (currentInputCallback)
            currentInputCallback(field.value);
        modal?.classList.remove('open');
    });
    cancelBtn?.addEventListener('click', () => {
        modal?.classList.remove('open');
    });
    field?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter')
            confirmBtn?.click();
    });
}
function openInputModal(title, label, defaultValue, callback) {
    const modal = document.getElementById('modal-mapper-input');
    const titleEl = document.getElementById('mapper-input-title');
    const labelEl = document.getElementById('mapper-input-label');
    const field = document.getElementById('mapper-input-field');
    if (titleEl)
        titleEl.textContent = title;
    if (labelEl)
        labelEl.textContent = label;
    if (field) {
        field.value = defaultValue;
        setTimeout(() => field.focus(), 100);
    }
    currentInputCallback = callback;
    modal?.classList.add('open');
}
/**
 * Preview
 */
async function showMapperPreview() {
    if (!selectedModId) {
        toast(t("mapper.selectModHint"), 'warning');
        return;
    }
    try {
        const files = await invoke('list_mod_files_recursive', { modId: selectedModId });
        dispatchBmmAction(BMM_ACTIONS.MAPPER_OPENED);
        const gamePath = activeProfile?.game_path || '';
        const rootCount = files.filter(f => !f.includes('\\') && !f.includes('/')).length;
        const subCount = files.filter(f => f.includes('\\') || f.includes('/')).length;
        let html = `
        <div class="mapper-preview-container">
            <div class="mpv-header">
                <div class="mpv-heading">
                    <!-- No <h3> here: the modal's own title bar already reads FINAL PREVIEW
                         two lines above. A second heading ("Structure Diagnostic") stacked
                         under it spent a line of vertical room saying the same thing twice. -->
                    <p class="mpv-desc">${escHtml(t("mapper.diagnosticDesc"))}</p>
                </div>
                <div class="mpv-stats">
                    <span class="mpv-stat mpv-stat-root"><span class="mpv-dot"></span> ${escHtml(t("mapper.statsRoot"))}: <b>${rootCount}</b></span>
                    <span class="mpv-stat mpv-stat-sub"><span class="mpv-dot"></span> ${escHtml(t("mapper.statsSub"))}: <b>${subCount}</b></span>
                </div>
            </div>
            <div class="mpv-base" data-tooltip="${escHtml(gamePath)}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
                <span class="mpv-base-label">${escHtml(t("mapper.destBase") || 'Destination')}</span>
                <code class="mpv-base-path">${escHtml(gamePath)}\\…</code>
            </div>
            <div class="mpv-list">
        `;
        let previewItems = files.map(f => {
            let isPending = false;
            let finalPath = f;
            pendingMoves.forEach((targetFolder, sourcePath) => {
                const isMatch = f === sourcePath || f.startsWith(sourcePath + '\\') || f.startsWith(sourcePath + '/');
                if (isMatch) {
                    isPending = true;
                    if (targetFolder !== ".") {
                        const fileName = sourcePath.split(/[\\/]/).pop() || sourcePath;
                        if (f === sourcePath) {
                            finalPath = `${targetFolder}\\${fileName}`;
                        }
                        else {
                            const remainder = f.substring(sourcePath.length + 1);
                            finalPath = `${targetFolder}\\${fileName}\\${remainder}`;
                        }
                    }
                    else {
                        // Moved to root
                        const fileName = sourcePath.split(/[\\/]/).pop() || sourcePath;
                        if (f === sourcePath) {
                            finalPath = fileName;
                        }
                        else {
                            const remainder = f.substring(sourcePath.length + 1);
                            finalPath = `${fileName}\\${remainder}`;
                        }
                    }
                }
            });
            return {
                original: f,
                finalPath: finalPath,
                isPending: isPending,
                isRoot: !finalPath.includes('\\') && !finalPath.includes('/')
            };
        });
        // Priority sorting: Pending -> Mapped -> Root
        previewItems.sort((a, b) => {
            if (a.isPending && !b.isPending)
                return -1;
            if (!a.isPending && b.isPending)
                return 1;
            if (!a.isRoot && b.isRoot)
                return -1;
            if (a.isRoot && !b.isRoot)
                return 1;
            return a.finalPath.localeCompare(b.finalPath);
        });
        if (previewItems.length === 0) {
            html += `<div class="mpv-empty">${escHtml(t("mapper.noFiles"))}</div>`;
        }
        else {
            previewItems.forEach(item => {
                const status = item.isPending ? 'pending' : (item.isRoot ? 'root' : 'ok');
                const targetPath = `${gamePath}\\${item.finalPath}`;
                const label = status === 'pending' ? (t('mapper.newBadge') || 'NEW')
                    : status === 'root' ? (t('mapper.root') || 'Root')
                        : (t('mapper.subfolder') || 'Sub-folder');
                const icon = status === 'pending'
                    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>`
                    : status === 'root'
                        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/></svg>`
                        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>`;
                // Source = the file's path inside the mod; destination = the FINAL relative
                // path. The huge absolute game-path prefix is NOT repeated per row (it's on
                // the base line above + in the tooltip), so rows stay scannable.
                html += `
                <div class="mpv-row mpv-row-${status}">
                    <span class="mpv-badge" data-tooltip="${escHtml(label)}">${icon}</span>
                    <span class="mpv-src" data-tooltip="${escHtml(item.original)}">${escHtml(item.original)}</span>
                    <svg class="mpv-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
                    <span class="mpv-dst" data-tooltip="${escHtml(targetPath)}">${escHtml(item.finalPath)}</span>
                    ${item.isPending ? `<span class="mpv-chip">${escHtml(t('mapper.newBadge') || 'NEW')}</span>` : ''}
                </div>`;
            });
        }
        html += `
            </div>
        </div>`;
        const confirmTitle = document.getElementById('confirm-title');
        const confirmMsg = document.getElementById('confirm-message');
        const confirmModal = document.getElementById('modal-confirm-generic');
        if (confirmTitle && confirmMsg && confirmModal) {
            confirmTitle.textContent = t("mapper.preview");
            confirmMsg.innerHTML = html;
            // The shared modal's icon is a RED danger triangle in the markup, and only
            // confirmCustom ever repaints it. Borrowing the modal without touching it put a
            // red alert badge on a read-only preview. Neutral accent instead.
            const icon = document.getElementById('confirm-icon-container');
            if (icon) {
                icon.style.background = 'var(--accent-dim)';
                icon.style.color = 'var(--accent)';
            }
            confirmModal.classList.add('modal-large');
            confirmModal.classList.add('open');
            const yesBtn = document.getElementById('btn-confirm-yes');
            const noBtn = document.getElementById('btn-confirm-cancel');
            if (yesBtn)
                yesBtn.style.display = 'none';
            if (noBtn)
                noBtn.textContent = t("common.close");
            // NOTE: the [data-tooltip] paths are handled by the global fixed-position
            // tooltip system (ui/tooltips.ts). We used to ALSO attach a mapper-specific
            // tooltip here — which showed the path TWICE on hover. Removed.
            // Restore on EVERY exit, not just the Cancel button.
            //
            // The old version was `noBtn.addEventListener('click', closeFn, {once:true})`.
            // Clicking the backdrop closes the overlay through the global handler in
            // modals.ts WITHOUT going through the button, so closeFn never ran: `modal-large`
            // and the hidden confirm button stayed on the shared modal, and the leftover
            // once-listener was still armed — it fired on the NEXT unrelated confirmation's
            // Cancel click and overwrote that dialog's button label.
            //
            // `display = ''` and not 'block': .btn is inline-flex, so 'block' would leave the
            // button permanently mis-laid-out (icon and gap) everywhere else in the app.
            let closed = false;
            const closeFn = () => {
                if (closed)
                    return;
                closed = true;
                confirmModal.classList.remove('open');
                confirmModal.classList.remove('modal-large');
                if (yesBtn)
                    yesBtn.style.display = '';
                if (noBtn)
                    noBtn.textContent = t("common.cancel");
                noBtn?.removeEventListener('click', closeFn);
                confirmModal.removeEventListener('click', onBackdrop);
            };
            const onBackdrop = (ev) => { if (ev.target === confirmModal)
                closeFn(); };
            noBtn.addEventListener('click', closeFn);
            confirmModal.addEventListener('click', onBackdrop);
        }
    }
    catch (e) {
        toast(e.message || e, 'error');
    }
}
// ── Fixed-position tooltip for the preview modal ──────────────────────────
// CSS ::after tooltips get clipped by overflow:auto on .preview-list-wrapper,
// and can disappear behind the sticky table header. This JS approach appends
// the tooltip to <body> at position:fixed so it's never clipped.
let _previewTipEl = null;
let _previewTipContainer = null;
function attachPreviewTooltip(container) {
    if (!_previewTipEl) {
        _previewTipEl = document.createElement('div');
        _previewTipEl.id = 'mapper-preview-tip';
        Object.assign(_previewTipEl.style, {
            position: 'fixed',
            background: 'rgba(10,10,20,0.97)',
            color: 'var(--text-primary)',
            fontSize: '11px',
            padding: '4px 10px',
            borderRadius: '6px',
            border: '1px solid var(--border)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
            zIndex: '9999999',
            whiteSpace: 'nowrap',
            display: 'none',
            maxWidth: '600px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
        });
        document.body.appendChild(_previewTipEl);
    }
    _previewTipContainer = container;
    container.addEventListener('mouseover', _previewTipOver);
    container.addEventListener('mousemove', _previewTipMove);
    container.addEventListener('mouseout', _previewTipOut);
}
function detachPreviewTooltip() {
    if (_previewTipContainer) {
        _previewTipContainer.removeEventListener('mouseover', _previewTipOver);
        _previewTipContainer.removeEventListener('mousemove', _previewTipMove);
        _previewTipContainer.removeEventListener('mouseout', _previewTipOut);
        _previewTipContainer = null;
    }
    if (_previewTipEl)
        _previewTipEl.style.display = 'none';
}
function _previewTipOver(e) {
    const el = e.target.closest('[data-tooltip]');
    if (!el || !_previewTipEl)
        return;
    const tip = el.getAttribute('data-tooltip');
    if (!tip)
        return;
    _previewTipEl.textContent = tip;
    _previewTipEl.style.display = 'block';
    _positionPreviewTip(e.clientX, e.clientY);
}
function _previewTipMove(e) {
    if (!_previewTipEl || _previewTipEl.style.display === 'none')
        return;
    _positionPreviewTip(e.clientX, e.clientY);
}
function _previewTipOut(e) {
    const el = e.target.closest('[data-tooltip]');
    if (el && !el.contains(e.relatedTarget)) {
        if (_previewTipEl)
            _previewTipEl.style.display = 'none';
    }
}
function _positionPreviewTip(mx, my) {
    if (!_previewTipEl)
        return;
    const tipW = _previewTipEl.offsetWidth;
    const tipH = _previewTipEl.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 12;
    let x = mx + gap;
    let y = my - tipH - gap;
    if (x + tipW > vw - 8)
        x = mx - tipW - gap;
    if (y < 8)
        y = my + gap;
    _previewTipEl.style.left = x + 'px';
    _previewTipEl.style.top = y + 'px';
}
//# sourceMappingURL=mapper.js.map