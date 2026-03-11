/**
 * components.js — Reusable UI Components and DOM generators
 * Extracts large template literals and DOM manipulations from main controllers.
 */

import { t } from './i18n.js';
import { escHtml, escAttr } from './utils.js';

/**
 * Returns the innerHTML for a Mod Card.
 * @param {Object} mod - The mod object
 * @param {Object} ctx - Context { selectedModId, conflictCache, processingMods, userTags }
 * @returns {string} HTML string
 */
export function getModCardHTML(mod, ctx) {
  const hasConflict = ctx.conflictCache[mod.id] && ctx.conflictCache[mod.id].length > 0;
  const isProcessing = ctx.processingMods.has(mod.id);

  let tagsHtml = '';
  if (mod.tags && mod.tags.length > 0) {
    const visibleTags = mod.tags.slice(0, 3).map(tid => {
      const tDef = ctx.userTags.find(t => t.id === tid);
      if (!tDef) return '';
      return `<span style="background:${tDef.color}15;color:${tDef.color};border:1px solid ${tDef.color}30;padding:1px 5px;border-radius:4px;font-size:9px;font-weight:600">${escHtml(tDef.name)}</span>`;
    }).join('');

    const extraTagsCount = mod.tags.length > 3 ? `<span style="color:var(--text-muted);font-size:9px;align-self:center">+${mod.tags.length - 3}</span>` : '';
    tagsHtml = `<div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap">${visibleTags}${extraTagsCount}</div>`;
  }

  const conflictHtml = hasConflict ? `<div class="conflict-badge" style="background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid rgba(239,68,68,0.4);font-size:9px;font-weight:900;padding:1px 5px;border-radius:4px;letter-spacing:0.4px;text-transform:uppercase">Conflict</div>` : '';

  const processingHtml = isProcessing ? `<div class="mod-loading-overlay" style="position:absolute;inset:0;background:rgba(15,23,42,0.6);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;border-radius:var(--radius-card);z-index:10;animation:fadeIn 0.2s ease"><div style="display:flex;flex-direction:column;align-items:center;gap:10px"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></div></div>` : '';

  return `
        <label class="mod-toggle" title="${mod.enabled ? 'Désactiver' : 'Activer'}">
            <input type="checkbox" class="mod-toggle-input" ${mod.enabled ? 'checked' : ''} />
            <div class="mod-toggle-track">
                <div class="mod-toggle-thumb"></div>
            </div>
        </label>

        <div class="mod-status-dot ${mod.enabled ? 'enabled' : 'disabled'}"></div>

        <div class="mod-info">
            <div style="display:flex;align-items:center;gap:8px">
                <div class="mod-name">${escHtml(mod.name)}</div>
                ${conflictHtml}
            </div>
            <div class="mod-meta">
                <span class="mono" style="color: var(--cyan)">v${escHtml(mod.version)}</span>
                ${mod.author ? `<span>· ${escHtml(mod.author)}</span>` : ''}
                ${tagsHtml}
            </div>
            <div class="mod-path-hint" style="font-size:10px;font-family:var(--font-mono);color:var(--text-muted);opacity:0.6;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:400px;display:flex;align-items:center;gap:4px">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                ${escHtml(mod.mod_folder_path || '')}
            </div>
        </div>

        <div class="mod-actions">
            <button class="btn btn-sm btn-icon btn-open-folder" title="Ouvrir le dossier" data-id="${mod.id}" style="background:rgba(255,255,255,0.05);color:var(--text-secondary);border:none;padding:4px 6px;border-radius:6px;cursor:pointer">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
            </button>
            <button class="btn btn-sm btn-icon btn-edit-mod" title="Détails / Éditer" data-id="${mod.id}" style="background:rgba(59,130,246,0.15);color:var(--accent);border:none;padding:4px 6px;border-radius:6px;cursor:pointer">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                    <path d="M12 20h9"/>
                    <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3l-12 12L3 20l1.5-4.5z"/>
                </svg>
            </button>
            <button class="btn btn-danger btn-sm btn-icon btn-remove-mod" title="Supprimer" data-id="${mod.id}">
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
        ">
            ${mod.enabled ? 'ACTIF' : 'INACTIF'}
        </div>
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
  const conflictsHtml = ctx.conflicts.length > 0 ? `
      <div id="conflict-alert" style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:12px;margin-bottom:8px">
        <h4 style="color:var(--danger);font-size:12px;font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          ${t('mod.conflictsTitle')}
        </h4>
        <p style="font-size:11px;color:rgba(255,255,255,0.7);line-height:1.4">
          ${t('mod.conflictsDesc').replace('{mods}', `<strong style="color:var(--text-primary)">${ctx.conflicts.join(', ')}</strong>`)}
        </p>
      </div>` : '';

  const installedFilesHtml = mod.installed_files && mod.installed_files.length > 0 ? `
      <div class="detail-section">
        <label class="detail-label" style="display:flex;align-items:center;gap:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> ${t('detail.files')} (${mod.installed_files.length})</label>
        <div style="max-height:120px;overflow-y:auto;font-family:var(--font-mono);font-size:10px;color:var(--text-muted);background:rgba(0,0,0,0.3);padding:6px 10px;border-radius:8px">
          ${mod.installed_files.map(f => `<div style="padding:1px 0;display:flex;align-items:center;gap:4px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>${escHtml(f)}</div>`).join('')}
        </div>
      </div>
      ` : '';

  const linksHtml = ctx.links.map((dl, i) => `
            <div style="display:flex;align-items:center;gap:6px;background:rgba(0,0,0,0.2);padding:6px 8px;border-radius:8px">
              <select class="detail-link-type input-field" style="width:100px;padding:3px;font-size:10px" data-index="${i}">
                <option value="github" ${dl.link_type === 'github' ? 'selected' : ''}>GitHub</option>
                <option value="google_drive" ${dl.link_type === 'google_drive' ? 'selected' : ''}>Google Drive</option>
                <option value="mega" ${dl.link_type === 'mega' ? 'selected' : ''}>MEGA</option>
                <option value="direct" ${dl.link_type === 'direct' ? 'selected' : ''}>Direct</option>
                <option value="other" ${dl.link_type === 'other' ? 'selected' : ''}>Autre</option>
              </select>
              <input type="text" class="detail-link-url input-field" style="flex:1;padding:3px 6px;font-size:10px" value="${escAttr(dl.url)}" placeholder="URL" data-index="${i}" />
              <input type="text" class="detail-link-label input-field" style="width:80px;padding:3px 6px;font-size:10px" value="${escAttr(dl.label)}" placeholder="Label" data-index="${i}" />
              <button class="btn-remove-link" data-index="${i}" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px;display:flex;align-items:center" title="Supprimer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
          `).join('');

  return `
    <div class="detail-header">
      <div>
        <h3 style="margin:0;font-size:16px;color:var(--text-primary)">${escHtml(mod.name)}</h3>
        <span style="font-family:var(--font-mono);font-size:11px;color:var(--cyan)">v${escHtml(mod.version)}</span>
        <span style="font-size:11px;color:var(--text-muted);margin-left:8px;display:inline-flex;align-items:center;gap:4px">${mod.enabled ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="var(--success)" stroke="none"><circle cx="12" cy="12" r="6"/></svg> ACTIF' : '<svg width="10" height="10" viewBox="0 0 24 24" fill="var(--text-muted)" stroke="none"><circle cx="12" cy="12" r="6"/></svg> INACTIF'}</span>
      </div>
      <button id="btn-close-detail-inner" class="btn btn-sm btn-icon" style="background:rgba(255,255,255,0.05);border:none;color:var(--text-muted);cursor:pointer;padding:4px 8px;border-radius:6px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>

    <div class="detail-body" style="display:flex;flex-direction:column;gap:12px;margin-top:12px">
      ${conflictsHtml}

      <!-- Editable Fields -->
      <div class="detail-section">
        <label class="detail-label">${t('detail.name')}</label>
        <input type="text" id="detail-name" class="input-field" value="${escAttr(mod.name)}" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="detail-section">
          <label class="detail-label">${t('detail.version')}</label>
          <input type="text" id="detail-version" class="input-field" value="${escAttr(mod.version)}" />
        </div>
        <div class="detail-section">
          <label class="detail-label">${t('detail.author')}</label>
          <input type="text" id="detail-author" class="input-field" value="${escAttr(mod.author || '')}" />
        </div>
      </div>
      <div class="detail-section">
        <label class="detail-label">${t('detail.description')}</label>
        <textarea id="detail-desc" class="input-field" rows="4" style="resize:vertical;min-height:80px;line-height:1.5;padding:10px">${escHtml(mod.description || '')}</textarea>
      </div>

      <!-- Tags Selection -->
      <div class="detail-section" id="detail-tags-container">
        <label class="detail-label" data-i18n="detail.tags" style="display:flex;align-items:center;gap:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> Tags</label>
        <div id="detail-tags-list" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px"></div>
        <select id="detail-tag-select" class="input-field" style="width:100%;padding:6px;font-size:11px">
            <option value="">— ${t('detail.selectTag')} —</option>
        </select>
      </div>

      <!-- Mod Folder Path -->
      <div class="detail-section">
        <label class="detail-label" style="display:flex;align-items:center;gap:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> ${t('prof.modsDir')}</label>
        <div style="display:flex;gap:8px">
          <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);background:rgba(0,0,0,0.3);padding:8px 10px;border-radius:8px;word-break:break-all;flex:1">
            ${escHtml(mod.mod_folder_path || 'Non défini')}
          </div>
          <button id="btn-browse-archive" class="btn btn-secondary btn-sm" title="${t('mod.explorerBtn')}" style="padding:6px 12px">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><rect x="8" y="8" width="6" height="6"/></svg>
          </button>
        </div>
      </div>

      <!-- Installed Files -->
      ${installedFilesHtml}

      <!-- Download Links -->
      <div class="detail-section">
        <label class="detail-label" style="display:flex;align-items:center;gap:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> ${t('detail.links')}</label>
        <div id="detail-links-list" style="display:flex;flex-direction:column;gap:6px">
          ${linksHtml}
        </div>
        <button id="btn-add-link" class="btn btn-sm" style="margin-top:6px;background:rgba(59,130,246,0.15);color:var(--accent);border:none;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px">+ ${t('detail.addLink')}</button>
      </div>

      <!-- Save Button -->
      <button id="btn-save-detail" class="btn btn-primary" style="align-self:flex-start;margin-top:6px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> ${t('detail.save')}
      </button>
    </div>
  `;
}
