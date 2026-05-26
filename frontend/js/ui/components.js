// @ts-nocheck
/**
 * components.js — Reusable UI Components and DOM generators
 * Extracts large template literals and DOM manipulations from main controllers.
 */
import { t } from '../core/i18n.js';
import { escHtml, escAttr, escJs, truncate } from '../core/utils.js';
export function getLoadingOverlayHTML() {
    return `<div class="mod-loading-overlay"><div style="display:flex;flex-direction:column;align-items:center;gap:10px"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></div></div>`;
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
            return `<span style="background:${tDef.color}15;color:${tDef.color};border:1px solid ${tDef.color}30;padding:1px 5px;border-radius:4px;font-size:9px;font-weight:600">${escHtml(tDef.name)}</span>`;
        }).join('');
        const extraTagsCount = mod.tags.length > 3 ? `<button class="btn btn-ghost" onclick="window.showModTagsModal('${mod.id}'); event.stopPropagation();" style="color:var(--text-muted);font-size:9px;padding:0;height:auto;min-height:0;margin:0;background:rgba(255,255,255,0.05);border-radius:4px;padding:1px 4px;border:1px solid rgba(255,255,255,0.1)">+${mod.tags.length - 3}</button>` : '';
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
            conflictHtml += `<div class="tag-conflict tag-intra-conflict active" onmouseenter="window.showTaskyHelp('lib.conflictActiveTip', 'alert')" onmouseleave="window.hideTaskyHelp()" onclick="window.openGlobalConflictModal('${mod.id}')" style="cursor:pointer"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>Intra</div>`;
        else if (hasIntraPotential)
            conflictHtml += `<div class="tag-conflict tag-intra-conflict potential" onmouseenter="window.showTaskyHelp('lib.conflictPotentialTip', 'warning')" onmouseleave="window.hideTaskyHelp()" onclick="window.openGlobalConflictModal('${mod.id}')" style="cursor:pointer"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>Intra</div>`;
        if (hasInterActive)
            conflictHtml += `<div class="tag-conflict tag-inter-conflict active" onmouseenter="window.showTaskyHelp('lib.conflictInterActiveTip', 'alert')" onmouseleave="window.hideTaskyHelp()" onclick="window.openGlobalConflictModal('${mod.id}')" style="cursor:pointer"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>Inter</div>`;
        else if (hasInterPotential)
            conflictHtml += `<div class="tag-conflict tag-inter-conflict potential" onmouseenter="window.showTaskyHelp('lib.conflictInterPotentialTip', 'warning')" onmouseleave="window.hideTaskyHelp()" onclick="window.openGlobalConflictModal('${mod.id}')" style="cursor:pointer"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>Inter</div>`;
    }
    const processingHtml = isProcessing ? getLoadingOverlayHTML() : '';
    return `
        <label class="mod-toggle" onmouseenter="window.showTaskyHelp('mod.toggleTip', 'toggle')" onmouseleave="window.hideTaskyHelp()">
            <input type="checkbox" class="mod-toggle-input" ${mod.enabled ? 'checked' : ''} />
            <div class="mod-toggle-track">
                <div class="mod-toggle-thumb"></div>
            </div>
        </label>

        <div class="mod-status-dot ${mod.enabled ? 'enabled' : 'disabled'}"></div>

        <div class="mod-info">
            <div style="display:flex;align-items:center;gap:8px">
                <div class="mod-name" onmouseenter="window.showTaskyHelp('${escAttr(escJs(mod.name))}', 'package', true)" onmouseleave="window.hideTaskyHelp()">${escHtml(truncate(mod.name, 100))}</div>
                <div class="sha-status-icon ${isShaInvalid ? 'invalid' : (isMissing ? 'missing' : 'verified')}" 
                     onclick="window.recalculateModSha('${mod.id}'); event.stopPropagation();"
                     onmouseenter="window.showTaskyHelp('${isShaInvalid ? 'hashes.status.invalid' : (isMissing ? 'hashes.status.missing' : 'hashes.status.verified')}', '${isShaInvalid ? 'alert' : 'shield'}')"
                     onmouseleave="window.hideTaskyHelp()"
                     style="display:inline-flex;align-items:center;justify-content:center;cursor:pointer;color:${isShaInvalid ? 'var(--danger)' : (isMissing ? 'var(--text-muted)' : 'var(--success)')};opacity:${isMissing ? '0.5' : '0.9'}; transition: all 0.2s ease;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                </div>
                ${mod.enabled ? `<span class="badge badge-accent" style="font-size:9px;padding:1px 6px;border-radius:4px;font-family:var(--font-mono);font-weight:800;background:rgba(59,130,246,0.2);color:var(--accent);border:1px solid rgba(59,130,246,0.3)" onmouseenter="window.showTaskyHelp('mod.activationOrderTip', 'help')" onmouseleave="window.hideTaskyHelp()">#${mod.activation_order}</span>` : ''}
                ${conflictHtml}
            </div>
            <div class="mod-meta">
                <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px">
                    <span class="mono mod-version" style="color: var(--cyan); font-weight:600">v${escHtml(mod.version)}</span>
                    ${tagsHtml}
                </div>
                <div class="mod-author-container" style="font-size:10px;color:var(--text-muted);margin-top:4px;opacity:0.8;display:${mod.author ? 'flex' : 'none'};align-items:center;gap:4px;cursor:help" onmouseenter="window.showTaskyHelp('${escAttr(escJs(mod.author || ''))}', 'user', true)" onmouseleave="window.hideTaskyHelp()">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="opacity:0.7"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    <span class="mod-author-name">${escHtml(truncate(mod.author || '', 50))}</span>
                </div>
            </div>
            <div class="mod-path-hint" onmouseenter="window.showTaskyHelp('${escAttr(escJs(mod.mod_folder_path || ''))}', 'folder', true)" onmouseleave="window.hideTaskyHelp()" style="font-size:10px;font-family:var(--font-mono);color:var(--text-muted);opacity:0.5;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:400px;display:flex;align-items:center;gap:4px;cursor:help">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.6"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                ${escHtml(mod.mod_folder_path || '')}
            </div>
        </div>

        <div class="mod-actions">
            <div class="mod-actions-dropdown">
            <button class="btn btn-sm btn-icon btn-dropdown-toggle" 
                onclick="window.showGlobalDropdown(this, this.nextElementSibling); event.stopPropagation();" 
                onmouseenter="window.showTaskyHelp('mod.openFolderTip', 'folder');" 
                onmouseleave="window.hideTaskyHelp();" 
                style="background:rgba(255,255,255,0.05);color:var(--text-secondary);border:none;padding:4px 6px;border-radius:6px;cursor:pointer">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        <polyline points="6 9 12 15 18 9" stroke-width="2.5" style="opacity: 0.8; transform: scale(0.6); transform-origin: center; translate: 0 4px;"/>
                    </svg>
                </button>
                <div class="mod-actions-dropdown-content">
                    <div class="dropdown-item btn-open-active-folder" data-id="${mod.id}" 
                         onmouseenter="window.showTaskyHelp('mod.openActiveFolderTip', 'folder')" 
                         onmouseleave="window.hideTaskyHelp()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                            <path d="m9 13 2 2 4-4"/>
                        </svg>
                        <span data-i18n="mod.openActiveFolder">${t('mod.openActiveFolder')}</span>
                    </div>
                    <div class="dropdown-item btn-open-backup-folder" data-id="${mod.id}" 
                         onmouseenter="window.showTaskyHelp('mod.openBackupFolderTip', 'folder')" 
                         onmouseleave="window.hideTaskyHelp()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2.5">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                            <path d="M12 10v4l2 2"/>
                        </svg>
                        <span data-i18n="mod.openBackupFolder">${t('mod.openBackupFolder')}</span>
                    </div>
                    <div class="dropdown-divider"></div>
                    <div class="dropdown-item btn-open-folder" data-id="${mod.id}"
                         onmouseenter="window.showTaskyHelp('mod.openSourceFolderTip', 'folder')"
                         onmouseleave="window.hideTaskyHelp()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                        <span data-i18n="mod.openSourceFolder">${t('mod.openSourceFolder')}</span>
                    </div>
                    <div class="dropdown-divider"></div>
                    <div class="dropdown-item btn-copy-id" data-id="${mod.id}"
                         onmouseenter="window.showTaskyHelp('mod.copyIdTip', 'copy')"
                         onmouseleave="window.hideTaskyHelp()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2.5">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                        <span>Copy ID</span>
                        <span style="margin-left:auto;font-family:var(--font-mono);font-size:9px;color:var(--text-muted);opacity:0.55;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(mod.id.slice(0, 8))}…</span>
                    </div>
                    <div class="dropdown-item btn-copy-content-id" data-content-id="${escHtml(mod.content_id || '')}" data-id="${mod.id}"
                         onmouseenter="window.showTaskyHelp('mod.copyContentIdTip', 'copy')"
                         onmouseleave="window.hideTaskyHelp()"
                         style="${!mod.content_id ? 'opacity:0.4;pointer-events:none;' : ''}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                        <span>Copy Content ID</span>
                        <span style="margin-left:auto;font-family:var(--font-mono);font-size:9px;color:var(--accent);opacity:0.6;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${mod.content_id ? escHtml(mod.content_id.slice(0, 8)) + '…' : 'N/A'}</span>
                    </div>
                </div>
            </div>
            <button class="btn btn-sm btn-icon btn-copy-id-card" data-id="${mod.id}" title="Copier l'ID du mod" onmouseenter="window.showTaskyHelp('mod.copyIdTip', 'copy')" onmouseleave="window.hideTaskyHelp()" style="background:rgba(255,255,255,0.04);color:var(--text-muted);border:1px solid rgba(255,255,255,0.07);padding:4px 6px;border-radius:6px;cursor:pointer;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
            </button>
            <button class="btn btn-sm btn-icon btn-edit-mod" onmouseenter="window.showTaskyHelp('mod.editTip', 'edit')" onmouseleave="window.hideTaskyHelp()" data-id="${mod.id}" style="background:rgba(59,130,246,0.15);color:var(--accent);border:none;padding:4px 6px;border-radius:6px;cursor:pointer">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                    <path d="M12 20h9"/>
                    <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3l-12 12L3 20l1.5-4.5z"/>
                </svg>
            </button>
            <button class="btn btn-danger btn-sm btn-icon btn-remove-mod" onmouseenter="window.showTaskyHelp('mod.removeTip', 'trash')" onmouseleave="window.hideTaskyHelp()" data-id="${mod.id}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                </svg>
            </button>
        </div>

        <div class="mod-status-pill ${mod.enabled ? 'enabled' : 'disabled'}" style="
            font-size: 10px;
            font-family: var(--font-mono);
            padding: 3px 8px;
            border-radius: 6px;
            background: ${mod.enabled ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)'};
            color: ${mod.enabled ? 'var(--success)' : 'var(--text-muted)'};
            flex-shrink: 0;
            width: 70px;
            text-align: center;
        ">
            ${mod.enabled ? (t('mod.statusActive') || 'ACTIVE') : (t('mod.statusInactive') || 'INACTIVE')}
        </div>

        ${mod.shared_activations && mod.shared_activations.length > 1 ? `
        <div class="mod-shared-info" style="border-left:1px solid var(--border); padding-left:14px; margin-left:8px; align-self:stretch; display:flex; flex-direction:column; justify-content:center; gap:4px; max-width:240px; overflow-y:auto; max-height:80px; scrollbar-width: none;">
            ${mod.shared_activations.map(sa => `
                <div class="shared-activation-item" style="display:flex; align-items:center; gap:8px; font-size:10.5px; opacity:${sa.active ? '1' : '0.4'}" title="${escAttr(sa.profile_name)}\n${escAttr(sa.game_path)}">
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
/**
 * Returns the innerHTML for the Mod Detail panel.
 * @param {Object} mod - The mod object
 * @param {Object} ctx - Context { conflicts, links }
 * @returns {string} HTML string
 */
export function getModDetailHTML(mod, ctx) {
    const isShaInvalid = mod.file_hashes_invalid;
    const isMissing = !mod.file_hashes || Object.keys(mod.file_hashes).length === 0;
    const hasContentId = !!mod.content_id;
    const isBmmDeclared = hasContentId && !/^[0-9a-f]{32}$/.test(mod.content_id);
    const hasFileHashes = !isMissing;
    const contentIdStatus = !hasContentId ? 'missing' : isBmmDeclared ? 'declared' : hasFileHashes ? 'precise' : 'approximate';
    const contentIdColor = contentIdStatus === 'missing' ? 'var(--text-muted)' : contentIdStatus === 'approximate' ? 'var(--warning)' : 'var(--success)';
    const contentIdLabel = contentIdStatus === 'missing' ? 'NOT COMPUTED' : contentIdStatus === 'declared' ? 'DECLARED' : contentIdStatus === 'precise' ? 'PRECISE' : 'APPROXIMATE';
    const contentIdHint = contentIdStatus === 'missing' ? 'Click ↻ SHA to compute' : contentIdStatus === 'declared' ? 'From bmm.json' : contentIdStatus === 'precise' ? 'Content hash (reliable)' : 'Path+size only — click ↻ SHA for precise';
    // Helper for collapsible sections
    const renderSection = (id, title, icon, content, defaultExpanded = false) => {
        const storageKey = `bmm_section_${id}_expanded`;
        const isExpanded = localStorage.getItem(storageKey) === null ? defaultExpanded : localStorage.getItem(storageKey) === 'true';
        return `
      <div class="collapsible-section ${isExpanded ? '' : 'collapsed'}" id="section-${id}">
        <div class="collapsible-header" onclick="window.toggleDetailSection('${id}')">
          <h4>${icon} ${title}</h4>
          <svg class="collapsible-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="collapsible-content">
          ${content}
        </div>
      </div>
    `;
    };
    const conflictsContent = (mod.conflicts && mod.conflicts.length > 0) ? `
        <div id="detail-conflicts-list" style="display:flex;flex-direction:column;gap:8px;max-height:200px;overflow-y:auto;padding-right:4px">
          ${mod.conflicts.map(c => `
            <div style="background:rgba(0,0,0,0.2);padding:8px 10px;border-radius:8px;border:1px solid ${c.status === 'Active' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                <span class="tag-conflict tag-${c.category.toLowerCase()}-conflict ${c.status.toLowerCase()}" 
                      style="cursor:pointer" 
                      onclick="window.openGlobalConflictModal('${mod.id}')">
                   ${c.category === 'Intra' ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="margin-right:4px"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>' : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="margin-right:4px"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'}
                   ${c.category}
                </span>
                <span style="font-size:10px;font-family:var(--font-mono);color:var(--text-muted)">${c.file_count} f.</span>
              </div>
              <div style="font-size:11px;color:var(--text-primary);font-weight:600">${escHtml(c.other_mod_name)}</div>
              <div style="font-size:10px;color:var(--text-muted)">Profil: ${escHtml(c.other_profile_name)}</div>
            </div>
          `).join('')}
        </div>` : `<div id="detail-conflicts-list" style="font-size:12px;color:var(--text-muted);font-style:italic">${t('conflict.empty') || 'No conflicts detected.'}</div>`;
    const infoContent = `
      <!-- Editable Fields -->
      <div class="detail-section">
        <label class="detail-label" style="display:flex;justify-content:space-between">
            <span>${t('detail.name')}</span>
            <span id="counter-name" style="font-size:9px;opacity:0.5;font-weight:400">0/100</span>
        </label>
        <input type="text" id="detail-name" class="input-field" value="${escAttr(mod.name)}" maxlength="100" oninput="if(this.value.length > 100) this.value = this.value.substring(0, 100)" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
        <div class="detail-section">
          <label class="detail-label">${t('detail.version')}</label>
          <input type="text" id="detail-version" class="input-field" value="${escAttr(mod.version)}" maxlength="30" />
        </div>
        <div class="detail-section">
          <label class="detail-label" style="display:flex;justify-content:space-between">
            <span>${t('detail.author')}</span>
            <span id="counter-author" style="font-size:9px;opacity:0.5;font-weight:400">0/50</span>
          </label>
          <input type="text" id="detail-author" class="input-field" value="${escAttr(mod.author || '')}" maxlength="50" oninput="if(this.value.length > 50) this.value = this.value.substring(0, 50)" />
        </div>
      </div>
      <div class="detail-section" style="margin-top:10px">
        <label class="detail-label" style="display:flex;justify-content:space-between">
            <span>${t('detail.description')}</span>
            <span id="counter-desc" style="font-size:9px;opacity:0.5;font-weight:400">0/2000</span>
        </label>
        <textarea id="detail-desc" class="input-field" rows="4" style="resize:vertical;min-height:80px;line-height:1.5;padding:10px" maxlength="2000" oninput="if(this.value.length > 2000) this.value = this.value.substring(0, 2000)"></textarea>
      </div>

      <!-- Tags Selection -->
      <div class="detail-section" id="detail-tags-container" style="margin-top:10px">
        <label class="detail-label" data-i18n="detail.tags" style="display:flex;align-items:center;gap:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> Tags</label>
        <div id="detail-tags-list" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px"></div>
        <select id="detail-tag-select" class="input-field" style="width:100%;padding:6px;font-size:11px">
            <option value="">— ${t('detail.selectTag')} —</option>
        </select>
      </div>

      <!-- Dependencies Section -->
      <div class="detail-section" style="margin-top:10px">
        <label class="detail-label" style="display:flex;align-items:center;gap:4px">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            ${t('mod.dependencies')}
        </label>
        <div id="detail-deps-list" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px"></div>
        <div style="position:relative">
            <input type="text" id="detail-dep-input" class="input-field" style="width:100%;padding:6px;font-size:11px" placeholder="${t('mod.addDepPlaceholder') || 'Add a required mod...'}" />
            <div id="detail-dep-suggestions" class="glass" style="display:none; position:absolute; z-index:100; max-height:150px; overflow-y:auto; width:100%; border:1px solid var(--border); border-radius:8px; margin-top:4px"></div>
        </div>
      </div>

      <div class="detail-section" style="margin-top:12px">
        <label class="detail-label" style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <span style="font-weight:700; color:var(--text-primary); font-size:11px; text-transform:uppercase; letter-spacing:0.5px">${t('settings.shaTitle')}</span>
        </label>
        <div style="display:flex; align-items:center; gap:12px; background:rgba(255,255,255,0.03); padding:10px 14px; border-radius:10px; border:1px solid var(--border); box-shadow:inset 0 0 10px rgba(0,0,0,0.1)">
            <div style="flex:1; display:flex; flex-direction:column; gap:2px">
                <div style="font-size:11px; color:${isShaInvalid ? 'var(--danger)' : (isMissing ? 'var(--text-muted)' : 'var(--success)')}; font-weight:700; display:flex; align-items:center; gap:6px">
                    <div style="width:6px; height:6px; border-radius:50%; background:currentColor; box-shadow: 0 0 6px currentColor"></div>
                    ${isShaInvalid ? (t('hashes.status.invalid') || 'INVALID') : (isMissing ? (t('hashes.status.missing') || 'MISSING') : (t('hashes.status.verified') || 'VERIFIED'))}
                </div>
                <div style="font-size:9px; color:var(--text-muted); font-family:var(--font-mono); opacity:0.7">
                    ${mod.file_hashes_timestamp ? new Date(mod.file_hashes_timestamp).toLocaleString() : '—'}
                </div>
            </div>
            <div style="display:flex; gap:6px">
                <button class="btn btn-sm btn-icon" onclick="window.deleteModHashes('${mod.id}')" onmouseenter="window.showTaskyHelp('mods.sha.delete', 'trash')" onmouseleave="window.hideTaskyHelp()" style="background:rgba(239,68,68,0.1); color:var(--danger); border:1px solid rgba(239,68,68,0.2); width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                </button>
                <button class="btn btn-sm btn-icon" id="btn-recalculate-sha" onclick="window.recalculateModSha('${mod.id}')" onmouseenter="window.showTaskyHelp('mods.sha.recalculate', 'refresh')" onmouseleave="window.hideTaskyHelp()" style="background:rgba(59,130,246,0.15); color:var(--accent); border:1px solid rgba(59,130,246,0.2); width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                </button>
            </div>
        </div>
      </div>

      <div class="detail-section" style="margin-top:10px">
        <label class="detail-label" style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          <span style="font-weight:700; color:var(--text-primary); font-size:11px; text-transform:uppercase; letter-spacing:0.5px">Content ID</span>
        </label>
        <div id="content-id-box" style="display:flex; align-items:center; gap:12px; background:rgba(255,255,255,0.03); padding:10px 14px; border-radius:10px; border:1px solid var(--border); box-shadow:inset 0 0 10px rgba(0,0,0,0.1); transition:border-color 0.2s">
          <div style="flex:1; display:flex; flex-direction:column; gap:2px; min-width:0">
            <div id="content-id-status-label" style="font-size:11px; color:${contentIdColor}; font-weight:700; display:flex; align-items:center; gap:6px">
              <div id="content-id-dot" style="width:6px; height:6px; border-radius:50%; background:currentColor; box-shadow:0 0 6px currentColor; flex-shrink:0"></div>
              ${contentIdLabel}
            </div>
            <div id="content-id-value" style="font-size:9px; color:var(--text-muted); font-family:var(--font-mono); opacity:0.7; white-space:nowrap; overflow:hidden; text-overflow:ellipsis" title="${mod.content_id || ''}">
              ${hasContentId ? mod.content_id : '—'}
            </div>
            <div id="content-id-hint" style="font-size:9px; color:var(--text-muted); font-style:italic; opacity:0.6">${contentIdHint}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
            ${hasContentId ? `
            <button class="btn btn-sm btn-icon btn-copy-content-id" data-content-id="${escHtml(mod.content_id)}" title="Copier le Content ID" style="background:rgba(139,92,246,0.12);color:#a78bfa;border:1px solid rgba(139,92,246,0.25);width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background 0.15s;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>` : ''}
            ${contentIdStatus === 'missing' || contentIdStatus === 'approximate' ? `
            <button id="btn-compute-content-id" class="btn btn-sm btn-icon" onclick="window.recalculateModSha('${mod.id}')" title="Compute precise content ID" style="background:rgba(59,130,246,0.15); color:var(--accent); border:1px solid rgba(59,130,246,0.2); width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center; flex-shrink:0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            </button>` : ''}
          </div>
        </div>
      </div>
  `;
    const filesContent = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px">
          <span style="font-size:11px; color:var(--text-muted)">${t('mod.filesCount', { count: mod.installed_files ? mod.installed_files.length : 0 })}</span>
          <button id="btn-browse-archive" class="btn btn-sm" style="background:rgba(59,130,246,0.15); color:var(--accent); border:none; padding:4px 10px; border-radius:6px; cursor:pointer; font-size:11px">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:middle; margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            ${t('mod.exploreArchive')}
          </button>
          <button id="btn-verify-mod-integrity" class="btn btn-sm" style="background:rgba(16,185,129,0.15); color:var(--success); border:none; padding:4px 10px; border-radius:6px; cursor:pointer; font-size:11px; margin-left:8px">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:middle; margin-right:4px"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            ${t('mod.verifyIntegrityDeep')}
          </button>
        </div>
        ${mod.installed_files && mod.installed_files.length > 0 ? `
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);background:rgba(0,0,0,0.3);padding:10px;border-radius:8px;max-height:200px;overflow-y:auto">
            ${mod.installed_files.slice(0, 50).map(f => `<div style="padding:1px 0;display:flex;align-items:center;gap:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>${escHtml(f)}</div>`).join('')}
            ${mod.installed_files.length > 50 ? `<div style="padding:6px 0;color:var(--text-muted);font-style:italic">${t('mod.archiveMoreFiles', { count: mod.installed_files.length - 50 })}</div>` : ''}
          </div>
        ` : `<div style="font-size:12px;color:var(--text-muted);font-style:italic">${t('detail.noFiles')}</div>`}
      `;
    const linksContent = `
        <div style="font-size:10px;background:rgba(59,130,246,0.1);color:var(--accent);padding:6px 8px;border-radius:6px;margin-bottom:8px;line-height:1.4;border:1px solid rgba(59,130,246,0.2)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:middle;margin-right:2px;margin-top:-2px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <span data-i18n="detail.linksInfo">${t('detail.linksInfo') || 'Pour les listes .MM, seuls les liens directs fonctionnent.'}</span>
        </div>
        <div id="detail-links-list" style="display:flex;flex-direction:column;gap:6px">
          ${ctx.links.map((dl, i) => `
            <div style="display:flex;align-items:center;gap:6px;background:rgba(0,0,0,0.2);padding:6px 8px;border-radius:8px">
              <select class="detail-link-type input-field" style="width:90px;padding:3px;font-size:10px" data-index="${i}">
                <option value="github" ${dl.link_type === 'github' ? 'selected' : ''}>GitHub</option>
                <option value="direct" ${dl.link_type === 'direct' ? 'selected' : ''}>Direct</option>
                <option value="other" ${dl.link_type === 'other' ? 'selected' : ''}>Autre</option>
              </select>
              <input type="text" class="detail-link-url input-field" style="flex:1;padding:3px 6px;font-size:10px" value="${escAttr(dl.url)}" placeholder="URL" data-index="${i}" />
              <input type="text" class="detail-link-label input-field" style="width:80px;padding:3px 6px;font-size:10px" value="${escAttr(dl.label || '')}" placeholder="Label" data-index="${i}" />
              <button class="btn-remove-link" data-index="${i}" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px;display:flex;align-items:center"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
          `).join('')}
        </div>
        <button id="btn-add-link" class="btn btn-sm" style="margin-top:8px;background:rgba(59,130,246,0.15);color:var(--accent);border:none;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px">+ ${t('detail.addLink')}</button>
  `;
    return `
    <div class="detail-header">
      <div style="flex:1; min-width:0">
        <h3 style="margin:0;font-size:16px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" onmouseenter="window.showTaskyHelp('${escAttr(escJs(mod.name))}', 'package', true)" onmouseleave="window.hideTaskyHelp()">${escHtml(truncate(mod.name, 100))}</h3>
        <div style="display:flex;align-items:center;gap:8px;margin-top:2px">
          <span style="font-family:var(--font-mono);font-size:11px;color:var(--cyan)">v${escHtml(mod.version)}</span>
          <span style="font-size:10px;color:var(--text-muted);display:inline-flex;align-items:center;gap:4px;cursor:help" onmouseenter="window.showTaskyHelp('${escAttr(escJs(mod.mod_folder_path || ''))}', 'folder', true)" onmouseleave="window.hideTaskyHelp()">
            ${mod.enabled ? `<svg width="8" height="8" viewBox="0 0 24 24" fill="var(--success)"><circle cx="12" cy="12" r="10"/></svg> ${t('mod.statusActive') || 'ACTIVE'}` : `<svg width="8" height="8" viewBox="0 0 24 24" fill="var(--text-muted)"><circle cx="12" cy="12" r="10"/></svg> ${t('mod.statusInactive') || 'INACTIVE'}`}
          </span>
        </div>
      </div>
      <button id="btn-close-detail-inner" class="btn btn-sm btn-icon" style="background:rgba(255,255,255,0.05);border:none;color:var(--text-muted);cursor:pointer;padding:6px;border-radius:8px;display:flex;align-items:center;margin-left:auto"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>

    <div class="detail-body" style="display:flex;flex-direction:column;gap:8px;margin-top:12px;padding:0 4px;overflow-y:auto;max-height:calc(100vh - 180px);scrollbar-width:thin">
      ${renderSection('info', t('detail.sectionGeneral') || 'Général', '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>', infoContent, true)}
      ${renderSection('conflicts', t('detail.sectionConflicts') || 'Conflits', '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>', conflictsContent, false)}
      ${renderSection('links', t('detail.sectionLinks') || 'Liens', '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>', linksContent, false)}
      ${renderSection('files', t('detail.sectionFiles') || 'Files', '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>', filesContent, false)}

      <button id="btn-save-detail" class="btn btn-primary" style="margin-top:12px;width:100%;height:38px;font-weight:700;flex-shrink:0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:8px"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> 
        ${t('detail.save') || 'SAUVEGARDER'}
      </button>
    </div>
  `;
}
// Add global toggle function for collapsible sections
if (typeof window !== 'undefined') {
    window.toggleDetailSection = (id) => {
        const el = document.getElementById(`section-${id}`);
        if (!el)
            return;
        const isCollapsed = el.classList.contains('collapsed');
        if (isCollapsed) {
            el.classList.remove('collapsed');
            localStorage.setItem(`bmm_section_${id}_expanded`, 'true');
        }
        else {
            el.classList.add('collapsed');
            localStorage.setItem(`bmm_section_${id}_expanded`, 'false');
        }
    };
}
//# sourceMappingURL=components.js.map