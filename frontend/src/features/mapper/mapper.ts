/**
 * mapper.ts — Mod Mapper feature
 * Handles file restructuration by mapping mod files to game directory structure
 */

import { invoke } from '../../core/api.js';
import { toast } from '../../ui/app.js';
import { t } from '../../core/i18n.js';
import type { Profile, ModEntry, FileTreeNode, EnrichedMod } from '../../types/models.js';

let selectedModId: string | null = null;
let activeProfile: Profile | null = null;
let modTreeData: FileTreeNode[] = [];
let gameTreeData: FileTreeNode[] = [];

// Selection State
let selectedPaths = new Set<string>();
let lastSelectedPath: string | null = null;

// Pending changes (Draft mode)
let pendingMoves = new Map<string, string>();

// Input Modal State
let currentInputCallback: ((value: string) => void) | null = null;

// Cache guards — avoid re-loading trees if nothing changed
let lastGamePath: string | null = null;
let lastModFolderPath: string | null = null;
let lastProfileId: string | null = null;

/**
 * Initializes the Mod Mapper UI and event listeners
 */
export async function initMapper(): Promise<void> {
    const view = document.getElementById('view-mapper');
    if (!view) return;

    const modSelect = document.getElementById('mapper-mod-select') as HTMLSelectElement;
    const profileSelect = document.getElementById('mapper-profile-select') as HTMLSelectElement;
    const previewBtn = document.getElementById('btn-mapper-preview');
    const refreshBtn = document.getElementById('btn-mapper-refresh');
    const saveBtn = document.getElementById('btn-mapper-save');

    // 1. Initial Data Load
    await refreshMapperData();

    // 2. Events
    modSelect?.addEventListener('change', async () => {
        if (!modSelect.value && modSelect.value !== "") return;
        selectedModId = modSelect.value;
        selectedPaths.clear();
        pendingMoves.clear();
        updateSaveButtonVisibility();
        updateSelectionCounter();
        
        modSelect.disabled = true;
        profileSelect.disabled = true;
        try {
            await refreshModTree();
        } finally {
            modSelect.disabled = false;
            profileSelect.disabled = false;
        }
    });

    profileSelect?.addEventListener('change', async () => {
        const newProfileId = profileSelect.value;
        if (!newProfileId) return;
        
        modSelect.disabled = true;
        profileSelect.disabled = true;
        
        try {
            await invoke('set_active_profile', { profileId: newProfileId });
            // Profile changed — force reload both trees and reset caches
            lastGamePath = null;
            lastModFolderPath = null;
            await refreshMapperData();
            await refreshGameTree(true);
            if (selectedModId) await refreshModTree(true);
            toast(t("common.saved"), "success");
        } catch (e: any) { 
            toast(e.message || e, "error"); 
        } finally {
            modSelect.disabled = false;
            profileSelect.disabled = false;
        }
    });

    previewBtn?.addEventListener('click', showMapperPreview);
    
    refreshBtn?.addEventListener('click', async () => {
        if (pendingMoves.size > 0) {
            if (!confirm(t("mapper.confirmRefresh"))) return;
        }
        pendingMoves.clear();
        updateSaveButtonVisibility();
        
        modSelect.disabled = true;
        profileSelect.disabled = true;
        
        try {
            await refreshMapperData();
            // Manual refresh — always bypass cache
            await refreshGameTree(true);
            if (selectedModId) await refreshModTree(true);
        } finally {
            modSelect.disabled = false;
            profileSelect.disabled = false;
        }
    });

    saveBtn?.addEventListener('click', applyAllChanges);

    // 3. Search Filters & Controls
    setupFilters();
    setupContextMenu();
    setupInputModal();

    // 4. Initial Game Tree
    await refreshGameTree();
    
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
                if (selectedModId) await refreshModTree();
            } finally {
                modSelect.disabled = false;
                profileSelect.disabled = false;
            }
        }
    });

    // Global click to hide context menu
    document.addEventListener('mousedown', (e) => {
        const menu = document.getElementById('mapper-context-menu');
        if (menu && menu.style.display === 'block') {
            if (!menu.contains(e.target as Node)) hideContextMenu();
        }
    });
}

/**
 * Refreshes available mods and the active profile
 */
async function refreshMapperData(): Promise<void> {
    try {
        const profiles: Profile[] = await invoke('get_profiles');
        const activeId: string | null = await invoke('get_active_profile_id');
        activeProfile = profiles.find(p => p.id === activeId) || null;
        lastProfileId = activeId;

        const profileSelect = document.getElementById('mapper-profile-select') as HTMLSelectElement;
        if (profileSelect) {
            profileSelect.innerHTML = `<option value="">— ${t('mapper.selectProfile') || 'Changer de profil'} —</option>`;
            profiles.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                if (p.id === activeId) opt.selected = true;
                profileSelect.appendChild(opt);
            });
        }

        if (activeProfile) {
            const pathEl = document.getElementById('mapper-game-path');
            if (pathEl) {
                pathEl.textContent = activeProfile.game_path;
                pathEl.title = activeProfile.game_path;
            }
            
            const modSelect = document.getElementById('mapper-mod-select') as HTMLSelectElement;
            if (modSelect) {
                const enrichedMods = await invoke('get_mods');
                const currentVal = modSelect.value;
                modSelect.innerHTML = `<option value="">— ${t('mapper.selectMod') || 'Sélectionner un mod'} —</option>`;
                enrichedMods.forEach((m: EnrichedMod) => {
                    const opt = document.createElement('option');
                    opt.value = m.id;
                    opt.textContent = m.name;
                    // Store folder path in dataset to avoid extra get_all_mods call
                    opt.dataset.folderPath = (m as any).mod_folder_path || '';
                    if (m.id === currentVal) opt.selected = true;
                    modSelect.appendChild(opt);
                });
            }
        }
    } catch (e) { console.error("[MAPPER] Data load failed:", e); }
}

/**
 * Loads and renders the selected mod's file tree
 */
async function refreshModTree(force = false): Promise<void> {
    const container = document.getElementById('mapper-mod-tree');
    if (!container) return;
    if (!selectedModId) {
        container.innerHTML = `<div class="empty-hint">${t('mapper.selectModHint') || 'Sélectionnez un mod pour voir son contenu'}</div>`;
        return;
    }

    // Try to get folder path from the select option (cached) to avoid an extra invoke
    const modSelect = document.getElementById('mapper-mod-select') as HTMLSelectElement;
    const selectedOption = modSelect?.options[modSelect.selectedIndex];
    let modFolderPath: string | null = selectedOption?.dataset.folderPath || null;

    // If no cached path, fall back to get_all_mods
    if (!modFolderPath) {
        try {
            const mods: ModEntry[] = await invoke('get_all_mods');
            const m = mods.find(mod => mod.id === selectedModId);
            if (!m) { container.innerHTML = `<div class="empty-hint error">Mod non trouvé</div>`; return; }
            modFolderPath = m.mod_folder_path;
        } catch (e) { container.innerHTML = `<div class="empty-hint error" style="color:var(--danger)">${e}</div>`; return; }
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
    } catch (e) { container.innerHTML = `<div class="empty-hint error" style="color:var(--danger)">${e}</div>`; }
}

/**
 * Loads and renders the game directory tree
 */
async function refreshGameTree(force = false): Promise<void> {
    const container = document.getElementById('mapper-game-tree');
    if (!container) return;
    if (!activeProfile) {
        container.innerHTML = `<div class="empty-hint">${t('mapper.loadProfileHint') || 'Chargez un profil pour voir le dossier du jeu'}</div>`;
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
    } catch (e: any) {
        container.innerHTML = `<div class="empty-hint error" style="color:var(--danger)">Erreur: ${e.message || e}</div>`;
    }
}

function setupFilters(): void {
    const modFilter = document.getElementById('mapper-mod-search') as HTMLInputElement;
    const gameFilter = document.getElementById('mapper-game-search') as HTMLInputElement;
    
    let debounceModTimer: any;
    let debounceGameTimer: any;
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
    
    document.getElementById('btn-mapper-mod-expand')?.addEventListener('click', () => toggleAll('mapper-mod-tree', true));
    document.getElementById('btn-mapper-mod-collapse')?.addEventListener('click', () => toggleAll('mapper-mod-tree', false));
    document.getElementById('btn-mapper-game-expand')?.addEventListener('click', () => toggleAll('mapper-game-tree', true));
    document.getElementById('btn-mapper-game-collapse')?.addEventListener('click', () => toggleAll('mapper-game-tree', false));
}

function toggleAll(containerId: string, expand: boolean): void {
    const container = document.getElementById(containerId);
    if (!container) return;
    const children = container.querySelectorAll('.tree-children');
    children.forEach((c) => {
        (c as HTMLElement).style.display = expand ? 'block' : 'none';
        const item = c.previousElementSibling as HTMLElement;
        if (item) item.style.opacity = expand ? '1' : '0.7';
    });
}

/**
 * Builds a virtual tree reflecting pending moves
 */
function getVirtualModTree(): FileTreeNode[] {
    if (pendingMoves.size === 0) return modTreeData;

    const virtualTree: FileTreeNode[] = typeof structuredClone === 'function' ? structuredClone(modTreeData) : JSON.parse(JSON.stringify(modTreeData)); // Deep copy

    // 1. Remove moved items from their original locations
    const movedOriginalPaths = Array.from(pendingMoves.keys());
    const removeFromTree = (nodes: FileTreeNode[]) => {
        for (let i = nodes.length - 1; i >= 0; i--) {
            if (movedOriginalPaths.includes(nodes[i].path)) {
                nodes.splice(i, 1);
            } else if (nodes[i].children) {
                removeFromTree(nodes[i].children!);
            }
        }
    };
    removeFromTree(virtualTree);

    // 2. Insert items into their new virtual locations
    pendingMoves.forEach((targetFolder, sourcePath) => {
        const fileName = sourcePath.split(/[\\/]/).pop() || sourcePath;
        const newNode: FileTreeNode = {
            name: fileName,
            path: sourcePath,
            is_dir: false,
            children: null
        };

        if (targetFolder === ".") {
            virtualTree.push(newNode);
        } else {
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
                    if (!folder.children) folder.children = [];
                    folder.children.push(newNode);
                } else {
                    if (!folder.children) folder.children = [];
                    currentLevel = folder.children;
                }
            });
        }
    });

    return virtualTree;
}

async function renderFilteredModTree(): Promise<void> {
    const modFilter = (document.getElementById('mapper-mod-search') as HTMLInputElement)?.value.toLowerCase() || '';
    const modContainer = document.getElementById('mapper-mod-tree');
    if (modContainer) {
        modContainer.innerHTML = '';
        
        // Add Virtual "Racine du Mod" item
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
                <span class="tree-item-label">Racine du Mod</span>`;
            rootItem.dataset.path = ".";
            rootItem.addEventListener('contextmenu', (e) => {
                e.preventDefault(); e.stopPropagation();
                showContextMenu(e.clientX, e.clientY, ".", true, true);
            });
            modContainer.appendChild(rootItem);
        }

        await renderTree(filterTree(getVirtualModTree(), modFilter), modContainer, true);
    }
    updateLiveMappingHighlight();
}

async function renderFilteredGameTree(): Promise<void> {
    const gameFilter = (document.getElementById('mapper-game-search') as HTMLInputElement)?.value.toLowerCase() || '';
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
            <span class="tree-item-label">Racine du Jeu</span>`;
        rootItem.dataset.path = ".";
        rootItem.addEventListener('dblclick', () => { if (selectedPaths.size > 0) queueMoveTo("."); });
        rootItem.addEventListener('contextmenu', (e) => {
            e.preventDefault(); e.stopPropagation();
            showContextMenu(e.clientX, e.clientY, ".", true, false);
        });
        gameContainer.appendChild(rootItem);
        await renderTree(filterTree(gameTreeData, gameFilter), gameContainer, false);
    }
    updateLiveMappingHighlight();
}

function filterTree(nodes: FileTreeNode[], query: string): FileTreeNode[] {
    if (!query) return nodes;
    return nodes.reduce((acc: FileTreeNode[], node) => {
        const matchesSelf = node.name.toLowerCase().includes(query);
        const filteredChildren = node.children ? filterTree(node.children, query) : null;
        const hasMatchingChildren = filteredChildren && filteredChildren.length > 0;
        if (matchesSelf || hasMatchingChildren) {
            acc.push({ ...node, children: filteredChildren });
        }
        return acc;
    }, []);
}

async function renderTree(nodes: FileTreeNode[], container: HTMLElement, isModSide: boolean): Promise<void> {
    if (!nodes || nodes.length === 0) {
        if (container.classList.contains('file-tree')) {
            const empty = document.createElement('div');
            empty.className = 'empty-hint';
            empty.textContent = t('common.noResults') || 'Aucun résultat';
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
        item.className = `tree-item ${node.is_dir ? 'folder' : 'file'}`;
        
        if (isModSide) {
            const isPending = pendingMoves.has(node.path);
            let isAtRoot = true;
            if (isPending) {
                const target = pendingMoves.get(node.path)!;
                isAtRoot = target === ".";
            } else if (!node.path.startsWith('VIRTUAL_')) {
                isAtRoot = !node.path.includes('/') && !node.path.includes('\\');
            }
            if (isAtRoot) item.classList.add('root-item');
            else item.classList.add('mapped-item');
            if (isPending) item.classList.add('pending-item');
        }

        if (selectedPaths.has(node.path)) item.classList.add('selected');
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
            const targetDisplay = target === "." ? "Racine" : target;
            label.innerHTML = `${node.name} <span class="pending-badge">→ ${targetDisplay}</span>`;
        } else {
            label.textContent = node.name;
        }

        if (node.is_dir) {
            const chevron = document.createElement('span');
            chevron.className = 'tree-item-chevron';
            chevron.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>`;
            chevron.addEventListener('click', (e) => {
                e.stopPropagation();
                const childrenContainer = item.nextElementSibling as HTMLElement;
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

        item.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            if (isModSide && !node.path.startsWith('VIRTUAL_')) {
                if (e.ctrlKey) {
                    if (selectedPaths.has(node.path)) selectedPaths.delete(node.path);
                    else selectedPaths.add(node.path);
                } else {
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
            item.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                if (selectedPaths.size > 0) queueMoveTo(node.path);
            });
        }
        
        // Also allow clicking the folder item itself to toggle (if not selecting)
        item.addEventListener('click', (e) => {
            if (node.is_dir && (!isModSide || !e.ctrlKey)) {
                const chevron = item.querySelector('.tree-item-chevron') as HTMLElement;
                chevron?.click();
            }
        });

        item.addEventListener('contextmenu', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (!node.path.startsWith('VIRTUAL_')) {
                if (isModSide && !selectedPaths.has(node.path)) {
                    selectedPaths.clear(); selectedPaths.add(node.path);
                    updateSelectionVisuals(); updateSelectionCounter(); updateLiveMappingHighlight();
                }
                showContextMenu(e.clientX, e.clientY, node.path, node.is_dir, isModSide);
            }
        });

        if (node.is_dir) {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'tree-children';
            const isSearching = (document.getElementById(isModSide ? 'mapper-mod-search' : 'mapper-game-search') as HTMLInputElement)?.value.length > 0;
            childrenContainer.style.display = isSearching ? 'block' : 'none';
            
            fragment.appendChild(childrenContainer);
            
            // Render children asynchronously if needed
            if (node.children && node.children.length > 0) {
                await renderTree(node.children, childrenContainer, isModSide);
            }
        }
    }

    container.appendChild(fragment);
}

function updateSelectionCounter() {
    const el = document.getElementById('mapper-selection-count');
    if (el) el.textContent = `${selectedPaths.size} ${t("modpack.modsSelected")}`;
}

function updateSaveButtonVisibility() {
    const saveBtn = document.getElementById('btn-mapper-save');
    if (saveBtn) saveBtn.style.display = pendingMoves.size > 0 ? 'flex' : 'none';
}

async function applyAllChanges() {
    if (pendingMoves.size === 0) return;
    const count = pendingMoves.size;
    try {
        for (const [source, target] of pendingMoves.entries()) {
            await invoke('restructure_mod_item', { modId: selectedModId, itemRelPath: source, targetGameFolderRel: target });
        }
        toast(t("mapper.success"), "success");
        pendingMoves.clear();
        updateSaveButtonVisibility();
        await refreshModTree();
        selectedPaths.clear(); updateSelectionCounter(); updateSelectionVisuals();
    } catch (e: any) { toast(e.message || e, "error"); }
}

function queueMoveTo(targetPath: string) {
    const count = selectedPaths.size;
    selectedPaths.forEach(p => { pendingMoves.set(p, targetPath); });
    toast(`${count} éléments déplacés vers "${targetPath === "." ? "la racine" : targetPath}"`, "info");
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
            highlightParents(htmlItem as HTMLElement);
        });
    });
}

function highlightParents(item: HTMLElement) {
    let p = item.parentElement;
    while (p && !p.classList.contains('file-tree')) {
        if (p.classList.contains('tree-children')) {
            const trigger = p.previousElementSibling as HTMLElement;
            if (trigger && trigger.classList.contains('tree-item')) {
                trigger.classList.add('parent-highlight');
            }
        }
        p = p.parentElement;
    }
}

function updateLiveMappingHighlight() {
    const gameContainer = document.getElementById('mapper-game-tree');
    if (!gameContainer) return;

    gameContainer.querySelectorAll('.mapping-target-folder').forEach(el => el.classList.remove('mapping-target-folder'));

    if (selectedPaths.size === 0) return;

    selectedPaths.forEach(path => {
        const targetFolder = pendingMoves.get(path) || ".";
        const safeTarget = targetFolder.replace(/\//g, '\\').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const targetItem = gameContainer.querySelector(`.tree-item[data-path="${safeTarget}"]`);
        if (targetItem) {
            targetItem.classList.add('mapping-target-folder');
            highlightParents(targetItem as HTMLElement);
            let p = targetItem.parentElement as HTMLElement;
            while (p && p !== gameContainer) {
                if (p.classList.contains('tree-children')) {
                    if (p.style.display !== 'block') {
                        p.style.display = 'block';
                        const trigger = p.previousElementSibling as HTMLElement;
                        if (trigger) trigger.style.opacity = '1';
                    }
                }
                p = p.parentElement as HTMLElement;
            }
        }
    });
}

/**
 * Context Menu
 */
function setupContextMenu() {
    const menu = document.getElementById('mapper-context-menu');
    if (!menu) return;
    document.getElementById('ctx-mapper-open')?.addEventListener('click', async (e) => {
        e.stopPropagation(); 
        if (lastSelectedPath) {
            const isModSide = menu.classList.contains('mod-side-active');
            if (isModSide) await invoke('open_item_in_explorer', { modId: selectedModId, itemRelPath: lastSelectedPath });
            // For game side, we might want a different command, but for now we skip or add if needed.
        }
        hideContextMenu();
    });
    document.getElementById('ctx-mapper-copy')?.addEventListener('click', (e) => {
        e.stopPropagation(); if (lastSelectedPath) { navigator.clipboard.writeText(lastSelectedPath); toast('Chemin copié !'); }
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
            });
            if (count > 0) {
                toast(t("mapper.mappingCancelled", { count: count.toString() }), "info");
                updateSaveButtonVisibility();
                renderFilteredModTree();
            }
        }
        hideContextMenu();
    });
    document.getElementById('ctx-mapper-new-folder')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openInputModal(t("mapper.newFolder"), t("mapper.enterName"), "", async (name) => {
            if (name && selectedModId) {
                try {
                    await invoke('create_mod_folder', { modId: selectedModId, parentRelPath: lastSelectedPath || ".", folderName: name });
                    toast(t("common.saved"), "success"); await refreshModTree();
                } catch (e: any) { toast(e.message || e, "error"); }
            }
        });
        hideContextMenu();
    });
    document.getElementById('ctx-mapper-rename')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentName = lastSelectedPath?.split(/[\\/]/).pop() || "";
        openInputModal(t("mapper.rename"), t("mapper.enterName"), currentName, async (name) => {
            if (name && selectedModId && lastSelectedPath) {
                try {
                    await invoke('rename_mod_item', { modId: selectedModId, itemRelPath: lastSelectedPath, newName: name });
                    toast(t("common.saved"), "success"); await refreshModTree();
                } catch (e: any) { toast(e.message || e, "error"); }
            }
        });
        hideContextMenu();
    });
    document.getElementById('ctx-mapper-delete')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (selectedPaths.size > 0) {
            if (confirm(t("common.confirmDelete"))) {
                try {
                    for (const p of selectedPaths) { await invoke('delete_mod_item', { modId: selectedModId, itemRelPath: p }); }
                    toast(t("common.success"), 'success'); selectedPaths.clear(); await refreshModTree(); updateSelectionCounter();
                } catch (e: any) { toast(e.message || e, 'error'); }
            }
        }
        hideContextMenu();
    });
}

function showContextMenu(x: number, y: number, path: string, isDir: boolean, isModSide: boolean) {
    const menu = document.getElementById('mapper-context-menu');
    if (!menu) return;
    lastSelectedPath = path; menu.style.display = 'block';
    
    if (isModSide) menu.classList.add('mod-side-active');
    else menu.classList.remove('mod-side-active');

    // Toggle Mod-only items
    const modOnly = menu.querySelectorAll('.mod-only-menu');
    modOnly.forEach(el => (el as HTMLElement).style.display = isModSide ? 'flex' : 'none');

    // For folders on mod side, show "New Folder"
    const newFolderBtn = document.getElementById('ctx-mapper-new-folder');
    if (newFolderBtn && isModSide) newFolderBtn.style.display = isDir ? 'flex' : 'none';

    // Show "Cancel Mapping" only if at least one selected item is in pendingMoves
    const cancelMappingBtn = document.getElementById('ctx-mapper-cancel-mapping');
    if (cancelMappingBtn) {
        if (isModSide) {
            let hasPending = false;
            selectedPaths.forEach(p => { if (pendingMoves.has(p)) hasPending = true; });
            cancelMappingBtn.style.display = hasPending ? 'flex' : 'none';
        } else {
            cancelMappingBtn.style.display = 'none';
        }
    }

    const menuWidth = menu.offsetWidth; const menuHeight = menu.offsetHeight;
    const winWidth = window.innerWidth; const winHeight = window.innerHeight;
    if (x + menuWidth > winWidth) x -= menuWidth;
    if (y + menuHeight > winHeight) y -= menuHeight;
    menu.style.left = `${x}px`; menu.style.top = `${y}px`;
}

function hideContextMenu() {
    const menu = document.getElementById('mapper-context-menu');
    if (menu) menu.style.display = 'none';
}

/**
 * Input Modal Logic
 */
function setupInputModal() {
    const modal = document.getElementById('modal-mapper-input');
    const field = document.getElementById('mapper-input-field') as HTMLInputElement;
    const confirmBtn = document.getElementById('btn-mapper-input-confirm');
    const cancelBtn = document.getElementById('btn-mapper-input-cancel');

    confirmBtn?.addEventListener('click', () => {
        if (currentInputCallback) currentInputCallback(field.value);
        modal?.classList.remove('open');
    });

    cancelBtn?.addEventListener('click', () => {
        modal?.classList.remove('open');
    });

    field?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') confirmBtn?.click();
    });
}

function openInputModal(title: string, label: string, defaultValue: string, callback: (val: string) => void) {
    const modal = document.getElementById('modal-mapper-input');
    const titleEl = document.getElementById('mapper-input-title');
    const labelEl = document.getElementById('mapper-input-label');
    const field = document.getElementById('mapper-input-field') as HTMLInputElement;

    if (titleEl) titleEl.textContent = title;
    if (labelEl) labelEl.textContent = label;
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
async function showMapperPreview(): Promise<void> {
    if (!selectedModId) { toast(t("mapper.selectModHint"), 'warning'); return; }
    try {
        const files: string[] = await invoke('list_mod_files_recursive', { modId: selectedModId });
        
        let html = `
        <div class="mapper-preview-container">
            <div class="preview-header">
                <div class="preview-explanation">
                    <h3>${t("mapper.diagnosticTitle")}</h3>
                    <p>${t("mapper.diagnosticDesc")}</p>
                </div>
                <div class="preview-stats">
                    <div class="stat-pill"><span class="dot orange"></span> ${t("mapper.statsRoot")}: ${files.filter(f => !f.includes('\\') && !f.includes('/')).length}</div>
                    <div class="stat-pill"><span class="dot green"></span> ${t("mapper.statsSub")}: ${files.filter(f => f.includes('\\') || f.includes('/')).length}</div>
                </div>
            </div>
            <div class="preview-list-wrapper">
                <table class="preview-table">
                    <thead>
                        <tr>
                            <th>${t("mapper.tableSource")}</th>
                            <th style="width: 40px;"></th>
                            <th>${t("mapper.tableDest")}</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        if (files.length === 0) {
            html += `<tr><td colspan="3" class="empty-hint">${t("mapper.noFiles")}</td></tr>`;
        } else {
            files.forEach(f => {
                const isAtRoot = !f.includes('\\') && !f.includes('/');
                const statusClass = isAtRoot ? 'root-warning' : 'ok-path';
                const targetPath = `${activeProfile?.game_path}\\${f}`;
                const icon = isAtRoot ? 
                    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5">
                        <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
                        <path d="m3.3 7 8.7 5 8.7-5"/>
                        <path d="M12 22V12"/>
                    </svg>` : 
                    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;

                html += `
                <tr class="${statusClass}">
                    <td>
                        <div class="path-cell">
                            ${icon}
                            <span class="path-text main">${f}</span>
                        </div>
                    </td>
                    <td class="arrow-cell">→</td>
                    <td>
                        <div class="path-cell">
                            <span class="path-text muted" title="${targetPath}">${targetPath}</span>
                        </div>
                    </td>
                </tr>`;
            });
        }

        html += `
                    </tbody>
                </table>
            </div>
        </div>`;

        const confirmTitle = document.getElementById('confirm-title');
        const confirmMsg = document.getElementById('confirm-message');
        const confirmModal = document.getElementById('modal-confirm-generic');
        
        if (confirmTitle && confirmMsg && confirmModal) {
            confirmTitle.textContent = t("mapper.preview");
            confirmMsg.innerHTML = html;
            
            confirmModal.classList.add('modal-large');
            confirmModal.classList.add('open');
            
            const yesBtn = document.getElementById('btn-confirm-yes') as HTMLButtonElement;
            const noBtn = document.getElementById('btn-confirm-cancel') as HTMLButtonElement;
            
            if (yesBtn) yesBtn.style.display = 'none';
            if (noBtn) noBtn.textContent = t("common.close");

            const closeFn = () => {
                confirmModal.classList.remove('open');
                confirmModal.classList.remove('modal-large');
                if (yesBtn) yesBtn.style.display = 'block';
                if (noBtn) noBtn.textContent = t("common.cancel");
            };
            
            noBtn.addEventListener('click', closeFn, { once: true });
        }
    } catch (e: any) {
        toast(e.message || e, 'error');
    }
}
