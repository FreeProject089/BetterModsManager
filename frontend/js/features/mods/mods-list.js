// @ts-nocheck
import { appState } from '../../core/state.js';
import { t, applyTranslations } from '../../core/i18n.js';
import { getModCardHTML, getLoadingOverlayHTML } from '../../ui/components.js';
import { invoke, sendOsNotification } from '../../core/api.js';
import { toast } from '../../ui/app.js';
import { updateDiscordStatus } from '../settings/settings.js';
import { refreshMods, selectMod, closeModDetail } from './mods.js';
const S = new Proxy(appState.state, {
    get(target, prop) { return target[prop]; },
    set(target, prop, value) { appState.set(prop, value); return true; }
});
let ghostFilteredMods = [];
let lastStartIndex = -1;
let lastEndIndex = -1;
const CARD_HEIGHTS = { standard: 110, compact: 54 };
export function updateBadge() {
    const badge = document.getElementById('badge-library');
    if (!badge)
        return;
    badge.textContent = S.allMods.length;
    badge.classList.toggle('show', S.allMods.length > 0);
}
export function updateSubtitle() {
    const enabled = S.allMods.filter(m => m.enabled).length;
    const total = S.allMods.length;
    const el = document.getElementById('lib-subtitle');
    if (!el)
        return;
    if (total === 0) {
        el.textContent = t('lib.subtitle.empty');
    }
    else {
        el.textContent = t('lib.subtitle', {
            enabled,
            total,
            s1: enabled !== 1 ? 's' : '',
            s2: total !== 1 ? 's' : ''
        });
    }
}
export function getFilteredMods() {
    let filtered = S.allMods.filter((m) => {
        const matchFilter = S.currentFilter === 'all' ||
            (S.currentFilter === 'enabled' && m.enabled) ||
            (S.currentFilter === 'disabled' && !m.enabled);
        const matchTag = !S.currentTagFilter || S.currentTagFilter === 'all' || (m.tags && m.tags.includes(S.currentTagFilter));
        let matchSearch = !S.searchQuery || m.name.toLowerCase().includes(S.searchQuery);
        if (!matchSearch && S.searchQuery && m.tags && m.tags.length > 0) {
            matchSearch = m.tags.some((tid) => {
                const tDef = S.userTags.find((t) => t.id === tid);
                return tDef && tDef.name.toLowerCase().includes(S.searchQuery);
            });
        }
        return matchFilter && matchSearch && matchTag;
    });
    filtered.sort((a, b) => {
        if (S.currentSort === 'name_asc')
            return a.name.localeCompare(b.name);
        if (S.currentSort === 'name_desc')
            return b.name.localeCompare(a.name);
        if (S.currentSort === 'status') {
            if (a.enabled === b.enabled)
                return a.name.localeCompare(b.name);
            return a.enabled ? -1 : 1;
        }
        if (S.currentSort === 'activation_order') {
            if (!a.enabled && !b.enabled)
                return a.name.localeCompare(b.name);
            if (!a.enabled)
                return 1;
            if (!b.enabled)
                return -1;
            return a.activation_order - b.activation_order;
        }
        return 0;
    });
    return filtered;
}
export async function renderModList(force = false) {
    const list = document.getElementById('mod-list');
    const viewport = document.getElementById('mod-list-viewport');
    const spacer = document.getElementById('mod-list-spacer');
    const empty = document.getElementById('empty-mods');
    const scrollContainer = document.querySelector('.content-area');
    if (!list || !viewport || !empty || !scrollContainer)
        return;
    // Only re-filter when necessary to improve performance
    if (force || ghostFilteredMods.length === 0) {
        ghostFilteredMods = getFilteredMods();
    }
    const modCount = ghostFilteredMods.length;
    if (modCount === 0) {
        viewport.innerHTML = '';
        if (spacer)
            spacer.style.height = '0px';
        const hasProfile = !!S.cachedActiveProfileId;
        const noProfileEmpty = document.getElementById('empty-library-no-profile');
        if (!hasProfile) {
            if (noProfileEmpty)
                noProfileEmpty.style.display = 'block';
            empty.style.display = 'none';
        }
        else {
            if (noProfileEmpty)
                noProfileEmpty.style.display = 'none';
            empty.style.display = 'block';
        }
        return;
    }
    const noProfileEmpty = document.getElementById('empty-library-no-profile');
    if (noProfileEmpty)
        noProfileEmpty.style.display = 'none';
    empty.style.display = 'none';
    const rowHeight = S.isCompact ? CARD_HEIGHTS.compact : CARD_HEIGHTS.standard;
    const scrollTop = scrollContainer.scrollTop;
    const containerHeight = scrollContainer.clientHeight || 800;
    const buffer = 20;
    let startIndex = Math.floor(scrollTop / rowHeight) - buffer;
    let endIndex = Math.ceil((scrollTop + containerHeight) / rowHeight) + buffer;
    if (startIndex < 0)
        startIndex = 0;
    if (endIndex > modCount)
        endIndex = modCount;
    if (!force && startIndex === lastStartIndex && endIndex === lastEndIndex) {
        return;
    }
    lastStartIndex = startIndex;
    lastEndIndex = endIndex;
    if (spacer)
        spacer.style.height = (modCount * rowHeight) + 'px';
    const visibleBatch = ghostFilteredMods.slice(startIndex, endIndex);
    viewport.style.transform = `translateY(${startIndex * rowHeight}px)`;
    const newVisibleIds = new Set(visibleBatch.map(m => m.id));
    const currentNodes = Array.from(viewport.children);
    currentNodes.forEach(node => {
        if (!newVisibleIds.has(node.dataset.id)) {
            node.remove();
        }
    });
    const existingMap = new Map();
    Array.from(viewport.children).forEach(node => {
        existingMap.set(node.dataset.id, node);
    });
    for (let i = 0; i < visibleBatch.length; i++) {
        const mod = visibleBatch[i];
        let card = existingMap.get(mod.id);
        // Only recreate cards when force is true AND mod has tags that changed
        const shouldRecreate = !card || (force && mod.tags && mod.tags.length > 0);
        if (shouldRecreate) {
            if (card)
                card.remove(); // Remove existing card if forcing recreation
            card = createModCard(mod);
            if (S.selectedModId === mod.id) {
                // Re-render detail panel if this is the selected mod
                setTimeout(() => import('./mods-details.js').then(m => m.renderModDetail(mod.id)), 0);
            }
        }
        else {
            updateCardState(card, mod);
        }
        if (viewport.children[i] !== card) {
            viewport.insertBefore(card, viewport.children[i] || null);
        }
    }
    applyTranslations(viewport);
}
export function createModCard(mod) {
    const card = document.createElement('div');
    card.className = `mod-card ${mod.enabled ? 'enabled' : 'disabled'} ${S.selectedModId === mod.id ? 'selected' : ''}`;
    card.dataset.id = mod.id;
    const ctx = {
        selectedModId: S.selectedModId,
        conflictCache: S.conflictCache,
        processingMods: S.processingMods,
        userTags: S.userTags
    };
    card.innerHTML = getModCardHTML(mod, ctx);
    // Toggle handler
    const toggle = card.querySelector('.mod-toggle-input');
    toggle.addEventListener('change', async () => {
        if (S.isGlobalProcessing || S.processingMods.has(mod.id)) {
            toggle.checked = !toggle.checked;
            return;
        }
        const conflicts = S.conflictCache[mod.id];
        let ignoreConflicts = false;
        try {
            ignoreConflicts = localStorage.getItem('bmm_ignore_conflicts') === 'true';
        }
        catch (e) { }
        const bypassKey = `bypass_conflict_${mod.id}`;
        if (toggle.checked && conflicts && conflicts.length > 0 && !ignoreConflicts && !window[bypassKey]) {
            toggle.checked = false;
            const { showActivationWarning } = await import('./mods-conflicts.js');
            showActivationWarning(mod.id, conflicts, () => {
                try {
                    if (document.getElementById('conflict-ignore-forever')?.checked)
                        localStorage.setItem('bmm_ignore_conflicts', 'true');
                }
                catch (e) { }
                window[bypassKey] = true;
                toggle.checked = true;
                toggle.dispatchEvent(new Event('change'));
            });
            return;
        }
        window[bypassKey] = false;
        S.isGlobalProcessing = true;
        S.processingMods.add(mod.id);
        // 360° spin animation on the toggle when activating
        if (toggle.checked) {
            const toggleLabel = card.querySelector('.mod-toggle');
            if (toggleLabel) {
                toggleLabel.classList.remove('spin-360');
                void toggleLabel.offsetWidth; // force reflow
                toggleLabel.classList.add('spin-360');
                setTimeout(() => toggleLabel.classList.remove('spin-360'), 600);
            }
        }
        setModLoading(mod.id, true);
        try {
            if (toggle.checked) {
                const warningMsg = await invoke('enable_mod', { modId: mod.id });
                if (warningMsg && warningMsg.startsWith('WARNING_SPACE|')) {
                    const parts = warningMsg.split('|');
                    toast(t('storage.alertWarningMod', { label: parts[1], free: parts[2], limit: parts[3] }), 'warning', 5000);
                }
                else {
                    toast(t('mod.activated', { name: mod.name }), 'success');
                    try {
                        if (localStorage.getItem('bmm_sysNotif') === 'true')
                            sendOsNotification('Better Mod Manager', t('mod.activated', { name: mod.name }));
                    }
                    catch (e) { }
                }
            }
            else {
                const modDeps = mod.dependencies || [];
                const dependents = S.allMods.filter(m => m.enabled && m.dependencies && m.dependencies.includes(mod.id));
                let requirements = S.allMods.filter(m => m.enabled && modDeps.includes(m.id));
                // Filtrer les requirements: n'afficher B que si AUCUN autre mod actif (sauf A) n'a besoin de B
                requirements = requirements.filter(req => {
                    const otherDependents = S.allMods.filter(other => other.id !== mod.id &&
                        other.enabled &&
                        other.dependencies &&
                        other.dependencies.includes(req.id));
                    return otherDependents.length === 0;
                });
                const relatedMods = [...new Set([...dependents, ...requirements])];
                if (relatedMods.length > 0) {
                    const names = relatedMods.map(m => m.name).join(', ');
                    const title = t('mod.disableDependentsTitle') || 'Désactiver les mods liés ?';
                    const desc = (t('mod.disableDependentsDesc') || 'Les mods suivants sont liés à celui-ci et pourraient être désactivés : {names}. Voulez-vous les désactiver aussi ?').replace('{names}', `<strong>${names}</strong>`);
                    const ok = await window.confirmCustom(title, desc, 'danger', { noLabel: t('common.no') || 'Non' });
                    if (ok) {
                        for (const rel of relatedMods) {
                            await invoke('disable_mod', { modId: rel.id });
                        }
                    }
                }
                await invoke('disable_mod', { modId: mod.id });
                toast(t('mod.deactivated', { name: mod.name }), 'info');
                try {
                    if (localStorage.getItem('bmm_sysNotif') === 'true')
                        sendOsNotification('Better Mod Manager', t('mod.deactivated', { name: mod.name }));
                }
                catch (e) { }
            }
        }
        catch (err) {
            if (typeof err === 'string' && err.startsWith('CRITICAL_SPACE|')) {
                const parts = err.split('|');
                toast(t('storage.alertCriticalMod', { label: parts[1], free: parts[2], limit: parts[3] }), 'error', 6000);
                toggle.checked = false;
            }
            else {
                toast(t('common.error') + ' : ' + err, 'error');
                toggle.checked = !toggle.checked;
            }
        }
        finally {
            setModLoading(mod.id, false);
            await new Promise(r => setTimeout(r, 250));
            S.processingMods.delete(mod.id);
            S.isGlobalProcessing = false;
            await refreshMods();
            await updateDiscordStatus();
        }
    });
    // Action listeners
    // Action listeners
    const toggleBtn = card.querySelector('.btn-dropdown-toggle');
    if (toggleBtn) {
        // Dropdown is now handled via CSS :hover for better stability and to prevent ghosting.
        // We only keep JS for specific click actions if needed, but for now we follow the "hover to open" request via CSS.
    }
    card.querySelector('.btn-open-folder').addEventListener('click', async (e) => {
        e.stopPropagation();
        window.closeGlobalDropdown(true);
        try {
            await invoke('open_folder', { path: mod.mod_folder_path });
        }
        catch (err) {
            toast(t('common.error') + ' : ' + err, 'error');
        }
    });
    card.querySelector('.btn-open-active-folder').addEventListener('click', async (e) => {
        e.stopPropagation();
        window.closeGlobalDropdown(true);
        try {
            await invoke('open_mod_active_folder', { modId: mod.id });
        }
        catch (err) {
            toast(t('common.error') + ' : ' + err, 'error');
        }
    });
    card.querySelector('.btn-open-backup-folder').addEventListener('click', async (e) => {
        e.stopPropagation();
        window.closeGlobalDropdown(true);
        try {
            await invoke('open_mod_backup_folder', { modId: mod.id });
        }
        catch (err) {
            toast(t('common.error') + ' : ' + err, 'error');
        }
    });
    card.querySelector('.btn-edit-mod').addEventListener('click', (e) => {
        e.stopPropagation();
        window.closeGlobalDropdown(true);
        selectMod(mod.id);
    });
    card.querySelector('.btn-remove-mod').addEventListener('click', async (e) => {
        e.stopPropagation();
        window.closeGlobalDropdown(true);
        if (mod.enabled) {
            toast(t('mod.disableFirst'), 'warning');
            return;
        }
        const modal = document.getElementById('modal-delete-mod');
        const warningText = document.getElementById('delete-mod-warning-text');
        const confirmCheck = document.getElementById('check-delete-confirm');
        const finalBtn = document.getElementById('btn-final-delete-mod');
        const btnRemoveOnly = document.getElementById('btn-remove-only-mod');
        if (warningText)
            warningText.innerHTML = t('mod.deleteWarning', { name: `<strong style="color:var(--text-primary)">${mod.name}</strong>` });
        confirmCheck.checked = false;
        finalBtn.disabled = true;
        modal.classList.add('open');
        confirmCheck.onchange = () => { finalBtn.disabled = !confirmCheck.checked; };
        const performDeletion = async (deleteFiles) => {
            try {
                await invoke('remove_mod', { modId: mod.id, deleteFiles });
                toast(t(deleteFiles ? 'mod.removed' : 'mod.removedOnly', { name: mod.name }), 'info');
                modal.classList.remove('open');
                if (S.selectedModId === mod.id)
                    closeModDetail();
                await refreshMods();
            }
            catch (err) {
                toast(t('common.error') + ' : ' + err, 'error');
            }
        };
        finalBtn.onclick = () => performDeletion(true);
        btnRemoveOnly.onclick = () => performDeletion(false);
    });
    card.addEventListener('click', (e) => {
        if (e.target.closest('.mod-toggle') || e.target.closest('.btn-remove-mod') || e.target.closest('.btn-edit-mod') || e.target.closest('.btn-open-folder'))
            return;
        selectMod(mod.id);
    });
    return card;
}
export function updateCardState(card, mod) {
    card.classList.toggle('enabled', mod.enabled);
    card.classList.toggle('disabled', !mod.enabled);
    const toggle = card.querySelector('.mod-toggle-input');
    if (toggle)
        toggle.checked = mod.enabled;
    const dot = card.querySelector('.mod-status-dot');
    if (dot) {
        dot.classList.toggle('enabled', mod.enabled);
        dot.classList.toggle('disabled', !mod.enabled);
    }
    const nameRow = card.querySelector('.mod-name')?.parentElement;
    if (nameRow) {
        let badge = nameRow.querySelector('.badge-accent');
        if (mod.enabled) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'badge badge-accent';
                badge.style.cssText = 'font-size:9px;padding:1px 6px;border-radius:4px;font-family:var(--font-mono);font-weight:800;background:rgba(59,130,246,0.2);color:var(--accent);border:1px solid rgba(59,130,246,0.3)';
                badge.onmouseenter = () => window.showTaskyHelp('lib.activationOrderTip', 'help');
                badge.onmouseleave = () => window.hideTaskyHelp();
                const nameEl = nameRow.querySelector('.mod-name');
                if (nameEl && nameEl.nextSibling) {
                    nameRow.insertBefore(badge, nameEl.nextSibling);
                }
                else {
                    nameRow.appendChild(badge);
                }
            }
            badge.textContent = `#${mod.activation_order}`;
        }
        else if (badge) {
            badge.remove();
        }
    }
    const pill = card.querySelector('.mod-status-pill');
    if (pill) {
        pill.classList.toggle('enabled', mod.enabled);
        pill.classList.toggle('disabled', !mod.enabled);
        pill.style.background = mod.enabled ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)';
        pill.style.color = mod.enabled ? 'var(--success)' : 'var(--text-muted)';
        pill.textContent = mod.enabled ? (t('mod.statusActive') || 'ACTIVE') : (t('mod.statusInactive') || 'INACTIVE');
    }
}
export function setModLoading(modId, isLoading) {
    const card = document.querySelector(`.mod-card[data-id="${modId}"]`);
    if (!card)
        return;
    const existingOverlay = card.querySelector('.mod-loading-overlay');
    if (isLoading && !existingOverlay) {
        card.insertAdjacentHTML('beforeend', getLoadingOverlayHTML());
    }
    else if (!isLoading && existingOverlay) {
        existingOverlay.classList.add('fade-out');
        setTimeout(() => existingOverlay.remove(), 300);
    }
}
export function updateToggleAllBtn() {
    const btn = document.getElementById('btn-enable-all');
    const container = document.getElementById('enable-all-container');
    if (!btn)
        return;
    const enabledCount = S.allMods.filter(m => m.enabled).length;
    const allEnabled = S.allMods.length > 0 && enabledCount === S.allMods.length;
    const label = btn.querySelector('span');
    const svg = btn.querySelector('svg');
    if (allEnabled) {
        if (label)
            label.innerHTML = t('lib.disableAll');
        if (svg)
            svg.innerHTML = '<path d="M18 6L6 18M6 6l12 12" /><circle cx="12" cy="12" r="10" />';
        btn.className = 'btn btn-ghost btn-split-main';
        btn.style.color = 'var(--danger)';
        if (container)
            container.classList.add('all-enabled');
    }
    else {
        if (label)
            label.innerHTML = t('lib.enableAll');
        if (svg)
            svg.innerHTML = '<path d="m5 12 5 5L20 7" /><circle cx="12" cy="12" r="10" />';
        btn.className = 'btn btn-primary btn-split-main';
        btn.style.color = '';
        if (container)
            container.classList.remove('all-enabled');
    }
}
window.showModTagsModal = function (modId) {
    const mod = S.allMods.find((m) => m.id === modId);
    if (!mod || !mod.tags || mod.tags.length === 0)
        return;
    const container = document.getElementById('mod-tags-list-container');
    const title = document.getElementById('mod-tags-modal-title');
    if (!container || !title)
        return;
    title.innerText = (t('mod.tagsTitle') || 'Tags du Mod') + ' - ' + mod.name;
    container.innerHTML = mod.tags.map((tid) => {
        const tDef = S.userTags.find((t) => t.id === tid);
        if (!tDef)
            return '';
        return `<span style="background:${tDef.color}15;color:${tDef.color};border:1px solid ${tDef.color}30;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600">${escHtml(tDef.name)}</span>`;
    }).join('');
    const modal = document.getElementById('modal-mod-tags');
    if (modal)
        modal.classList.add('open');
};
//# sourceMappingURL=mods-list.js.map