// @ts-nocheck
/**
 * components.js — Reusable UI Components and DOM generators
 * Extracts large template literals and DOM manipulations from main controllers.
 */
import { t } from '../core/i18n.js';
import { actAttrs, actAttrsStop } from '../core/inline-actions.js';
import { renderTagChip } from './icon-pack.js';
import { escHtml, escAttr, escJs, truncate } from '../core/utils.js';
import { uiIcon } from './icons.js';
export function getLoadingOverlayHTML() {
    return `<div class="mod-loading-overlay"><div style="display:flex;flex-direction:column;align-items:center;gap:10px">${uiIcon('loader', 24, { style: 'color:var(--accent);animation:spin 1s linear infinite' })}</div></div>`;
}
/**
 * Returns the innerHTML for a Mod Card.
 * @param {Object} mod - The mod object
 * @param {Object} ctx - Context { selectedModId, conflictCache, processingMods, userTags }
 * @returns {string} HTML string
 */
export function getModCardHTML(mod, ctx) {
    const isProcessing = ctx.processingMods.has(mod.id);
    const isShaInvalid = mod.file_hashes_invalid;
    const isMissing = !mod.file_hashes || Object.keys(mod.file_hashes).length === 0;
    let tagsHtml = '';
    if (mod.tags && mod.tags.length > 0) {
        const visibleTags = mod.tags.slice(0, 3).map(tid => {
            const tDef = ctx.userTags.find(t => t.id === tid);
            if (!tDef)
                return '';
            // Pack icons render '' until their JSON is in memory (warmed on refresh);
            // a miss just renders the name — the next re-render finds the glyph.
            return renderTagChip(tDef, { fontSize: 9, pad: '1px 5px' });
        }).join('');
        const extraTagsCount = mod.tags.length > 3 ? `<button type="button" ${actAttrsStop('showModTagsModal', mod.id)} class="btn btn-ghost mod-tags-more">+${mod.tags.length - 3}</button>` : '';
        tagsHtml = `<div class="mod-tags-container" style="display:inline-flex;gap:4px;align-items:center;margin-left:6px">${visibleTags}${extraTagsCount}</div>`;
    }
    else {
        tagsHtml = `<div class="mod-tags-container" style="display:none;gap:4px;align-items:center;margin-left:6px"></div>`;
    }
    let conflictHtml = '';
    const conflicts = ctx && ctx.conflictCache ? ctx.conflictCache[mod.id] : (mod.conflicts || []);
    if (conflicts && conflicts.length > 0) {
        const hasIntraActive = conflicts.some(c => c.category === 'Intra' && c.status === 'Active');
        const hasIntraPotential = conflicts.some(c => c.category === 'Intra' && c.status === 'Potential');
        const hasInterActive = conflicts.some(c => c.category === 'Inter' && c.status === 'Active');
        const hasInterPotential = conflicts.some(c => c.category === 'Inter' && c.status === 'Potential');
        if (hasIntraActive)
            conflictHtml += `<div class="tag-conflict tag-intra-conflict active" data-tasky="lib.conflictActiveTip" data-tasky-icon="alert" ${actAttrs('openConflictsFor', mod.id)} style="cursor:pointer"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>Intra</div>`;
        else if (hasIntraPotential)
            conflictHtml += `<div class="tag-conflict tag-intra-conflict potential" data-tasky="lib.conflictPotentialTip" data-tasky-icon="warning" ${actAttrs('openGlobalConflictModal', mod.id)} style="cursor:pointer"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>Intra</div>`;
        if (hasInterActive)
            conflictHtml += `<div class="tag-conflict tag-inter-conflict active" data-tasky="lib.conflictInterActiveTip" data-tasky-icon="alert" ${actAttrs('openGlobalConflictModal', mod.id)} style="cursor:pointer">${uiIcon('globe', 12)}Inter</div>`;
        else if (hasInterPotential)
            conflictHtml += `<div class="tag-conflict tag-inter-conflict potential" data-tasky="lib.conflictInterPotentialTip" data-tasky-icon="warning" ${actAttrs('openGlobalConflictModal', mod.id)} style="cursor:pointer">${uiIcon('globe', 12)}Inter</div>`;
    }
    // "Update available" tag — driven by the last update check (window.__bmmModUpdates)
    let updateHtml = '';
    try {
        const upd = window.__bmmModUpdates;
        const info = upd && upd.get ? upd.get(mod.id) : null;
        if (info) {
            const tip = (info.current_version && info.new_version)
                ? `${info.current_version} → ${info.new_version}` : (t('mod.updateAvailable') || 'Update available');
            updateHtml = `<div class="tag-mod-update" ${actAttrsStop('bmmShowModUpdates')} data-tasky="${escAttr(escJs(tip))}" data-tasky-icon="package" data-tasky-literal="1" style="display:inline-flex;align-items:center;gap:3px;cursor:pointer;background:rgba(46,204,113,0.16);color:var(--bmm-success);border:1px solid rgba(46,204,113,0.32);padding:1px 6px;border-radius:4px;font-size:9px;font-weight:700;">${uiIcon('refresh', 12)}${t('mod.updateTag') || 'Update'}</div>`;
        }
    }
    catch { }
    const processingHtml = isProcessing ? getLoadingOverlayHTML() : '';
    return `
        <span class="mod-pick" aria-hidden="true">${uiIcon('check', 12)}</span>
        <label class="mod-toggle" data-tasky="mod.toggleTip" data-tasky-icon="toggle">
            <input type="checkbox" class="mod-toggle-input" ${mod.enabled ? 'checked' : ''} />
            <div class="mod-toggle-track">
                <div class="mod-toggle-thumb"></div>
            </div>
        </label>

        <div class="mod-status-dot ${mod.enabled ? 'enabled' : 'disabled'}"></div>

        <div class="mod-info">
            <div style="display:flex;align-items:center;gap:8px">
                <!-- Hover the name for the folder: the path used to be a third line on every card. -->
                <div class="mod-name" data-tasky="${escAttr(escJs(mod.mod_folder_path || mod.name))}" data-tasky-icon="${mod.mod_folder_path ? 'folder' : 'package'}" data-tasky-literal="1">${escHtml(truncate(mod.name, 100))}</div>
                <div class="sha-status-icon ${isShaInvalid ? 'invalid' : (isMissing ? 'missing' : 'verified')}" 
                     ${actAttrsStop('recalculateModSha', mod.id)}
                     data-tasky="${isShaInvalid ? 'hashes.status.invalid' : (isMissing ? 'hashes.status.missing' : 'hashes.status.verified')}" data-tasky-icon="${isShaInvalid ? 'alert' : 'shield'}"
                    
                     style="display:inline-flex;align-items:center;justify-content:center;cursor:pointer;color:${isShaInvalid ? 'var(--danger)' : (isMissing ? 'var(--text-muted)' : 'var(--success)')};opacity:${isMissing ? '0.5' : '0.9'}; transition: all 0.2s ease;">
                    ${uiIcon('shield', 12)}
                </div>
                ${mod.enabled ? `<span class="badge badge-accent mod-order-badge" data-tasky="mod.activationOrderTip" data-tasky-icon="help">#${mod.activation_order}</span>` : ''}
                ${/\.(zip|rar|7z|tar|gz|tgz)$/i.test(mod.mod_folder_path || '') ? `<span class="mod-archive-badge" data-tasky="mod.archiveBadgeTip" data-tasky-icon="package">${uiIcon('box', 12)}${t('mod.archiveBadge') || 'Archive'}</span>` : ''}
                ${conflictHtml}
                ${updateHtml}
            </div>
            <div class="mod-meta">
                <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px">
                    <span class="mono mod-version" style="color: var(--cyan); font-weight:600">v${escHtml(mod.version)}</span>
                    ${tagsHtml}
                </div>
                <div class="mod-author-container" style="font-size:10px;color:var(--text-muted);margin-top:4px;opacity:0.8;display:${mod.author ? 'flex' : 'none'};align-items:center;gap:4px;cursor:help" data-tasky="${escAttr(mod.author || '')}" data-tasky-icon="user" data-tasky-literal="1">
                    ${uiIcon('user', 12, { style: 'opacity:0.7' })}
                    <span class="mod-author-name">${escHtml(truncate(mod.author || '', 50))}</span>
                </div>
            </div>
        </div>

        <div class="mod-actions">
            <div class="mod-actions-dropdown">
            <button type="button" class="btn btn-sm btn-icon btn-dropdown-toggle mod-more-btn"
                ${actAttrsStop('showGlobalDropdown')} data-act-with="element,next"
                data-tasky="mod.moreActionsTip" data-tasky-icon="help">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        <polyline points="6 9 12 15 18 9" stroke-width="2.5" style="opacity: 0.8; transform: scale(0.6); transform-origin: center; translate: 0 4px;"/>
                    </svg>
                </button>
                <div class="mod-actions-dropdown-content">
                    <div class="dropdown-item btn-open-active-folder" data-id="${mod.id}" 
                         data-tasky="mod.openActiveFolderTip" data-tasky-icon="folder" 
                        >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2" aria-hidden="true">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                            <path d="m9 13 2 2 4-4"/>
                        </svg>
                        <span data-i18n="mod.openActiveFolder">${t('mod.openActiveFolder')}</span>
                    </div>
                    <div class="dropdown-item btn-open-backup-folder" data-id="${mod.id}" 
                         data-tasky="mod.openBackupFolderTip" data-tasky-icon="folder" 
                        >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2" aria-hidden="true">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                            <path d="M12 10v4l2 2"/>
                        </svg>
                        <span data-i18n="mod.openBackupFolder">${t('mod.openBackupFolder')}</span>
                    </div>
                    <div class="dropdown-divider"></div>
                    <div class="dropdown-item btn-open-folder" data-id="${mod.id}"
                         data-tasky="mod.openSourceFolderTip" data-tasky-icon="folder"
                        >
                        ${uiIcon('open-folder', 14, { style: 'color:var(--accent)' })}
                        <span data-i18n="mod.openSourceFolder">${t('mod.openSourceFolder')}</span>
                    </div>
                    <div class="dropdown-divider"></div>
                    <div class="dropdown-item btn-copy-id" data-id="${mod.id}"
                         data-tasky="mod.copyIdTip" data-tasky-icon="icon-copy"
                        >
                        ${uiIcon('copy', 14, { style: 'color:var(--text-muted)' })}
                        <span>Copy ID</span>
                        <span style="margin-left:auto;font-family:var(--font-mono);font-size:9px;color:var(--text-muted);opacity:0.55;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(mod.id.slice(0, 8))}…</span>
                    </div>
                    <div class="dropdown-item btn-copy-content-id" data-content-id="${escHtml(mod.content_id || '')}" data-id="${mod.id}"
                         data-tasky="mod.copyContentIdTip" data-tasky-icon="icon-copy"
                        
                         style="${!mod.content_id ? 'opacity:0.4;pointer-events:none;' : ''}">
                        ${uiIcon('copy', 14, { style: 'color:var(--accent)' })}
                        <span>Copy Content ID</span>
                        <span style="margin-left:auto;font-family:var(--font-mono);font-size:9px;color:var(--accent);opacity:0.6;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${mod.content_id ? escHtml(mod.content_id.slice(0, 8)) + '…' : 'N/A'}</span>
                    </div>
                    <div class="dropdown-divider"></div>
                    <div class="dropdown-item btn-copy-repo-mod-id" data-repo-mod-id="${escAttr(mod.repo_mod_id || mod.id)}"
                         data-tasky="mod.copyRepoModIdTip" data-tasky-icon="icon-copy"
                        >
                        ${uiIcon('copy', 14, { style: 'color:var(--cyan)' })}
                        <span data-i18n="mod.copyRepoModId">${t('mod.copyRepoModId') || 'Copy repo_mod_id'}</span>
                        <span style="margin-left:auto;font-family:var(--font-mono);font-size:9px;color:var(--cyan);opacity:0.6;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml((mod.repo_mod_id || mod.id).slice(0, 8))}…</span>
                    </div>
                    <div class="dropdown-divider"></div>
                    <div class="dropdown-item" ${actAttrsStop('bmmMenuCheckModUpdate', mod.id)}
                         data-tasky="mod.checkUpdateTip" data-tasky-icon="refresh"
                        >
                        ${uiIcon('refresh', 14, { style: 'color:var(--cyan)' })}
                        <span data-i18n="mod.checkUpdate">${t('mod.checkUpdate') || 'Check for updates'}</span>
                    </div>
                    <div class="dropdown-item" ${actAttrsStop('bmmMenuOpenModUpdateConfig', mod.id)}
                         data-tasky="mod.updateConfigTip" data-tasky-icon="package"
                        >
                        ${uiIcon('sliders', 14, { style: 'color:var(--success)' })}
                        <span data-i18n="mod.updateConfig">${t('mod.updateConfig') || 'Configure updates'}</span>
                    </div>
                </div>
            </div>
            
            <button type="button" class="btn btn-sm btn-icon btn-edit-mod mod-edit-btn" data-tasky="mod.editTip" data-tasky-icon="edit" data-id="${mod.id}">
                ${uiIcon('edit', 14)}
            </button>
            <button type="button" class="btn btn-danger btn-sm btn-icon btn-remove-mod" data-tasky="mod.removeTip" data-tasky-icon="trash" data-id="${mod.id}">
                ${uiIcon('delete', 12)}
            </button>
        </div>

        <!-- No ACTIVE / INACTIVE pill: the switch, the dot and the card's edge already say it. -->

        ${mod.shared_activations && mod.shared_activations.length > 1 ? `
        <div class="mod-shared-info" style="border-left:1px solid var(--border); padding-left:14px; margin-left:8px; align-self:stretch; display:flex; flex-direction:column; justify-content:center; gap:4px; max-width:240px; overflow-y:auto; max-height:80px; scrollbar-width: none;">
            ${mod.shared_activations.map(sa => `
                <div class="shared-activation-item" style="display:flex; align-items:center; gap:8px; font-size:10.5px; opacity:${sa.active ? '1' : '0.4'}" data-tooltip="${escAttr(sa.profile_name)}\n${escAttr(sa.game_path)}">
                    <div style="width:8px; height:8px; border-radius:50%; background:${sa.active ? 'var(--success)' : 'var(--text-muted)'}; flex-shrink:0; box-shadow:${sa.active ? '0 0 6px var(--success)' : 'none'}"></div>
                    <div style="display:flex; flex-direction:column; min-width:0; flex:1">
                        <span style="font-weight:600; color:${sa.active ? 'var(--text-primary)' : 'var(--text-muted)'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escHtml(sa.profile_name)}</span>
                        <span style="font-size:9px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-family:var(--font-mono)">${escHtml(sa.game_path)}</span>
                    </div>
                </div>
            `).join('')}
        </div>
        ` : ''}
        ${processingHtml}
    `;
}
// The mod details open in a dialog over the library: features/mods/mod-detail-view.ts (markup) and
// mods-details.ts (wiring).
// Two menu entries have to close the dropdown before they act, or the modal they open is
// drawn behind a still-open menu. Both spelled that out inline, twice; it is one function
// each now, which is also what makes them reachable as a plain `data-act` name.
window.bmmMenuCheckModUpdate = (id) => {
    window.closeGlobalDropdown?.(true);
    window.bmmCheckModUpdate?.(id);
};
window.bmmMenuOpenModUpdateConfig = (id) => {
    window.closeGlobalDropdown?.(true);
    window.openModUpdateConfig?.(id);
};
//# sourceMappingURL=components.js.map