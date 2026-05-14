// @ts-nocheck
import { invoke, listenFileDrop, pickFolder } from '../../core/api.js';
import { toast } from '../../ui/app.js';
import { updateDiscordStatus } from '../settings/settings.js';
import { renderProfiles } from '../profiles/profiles.js';
import { t, applyTranslations } from '../../core/i18n.js';
import { escHtml, truncate } from '../../core/utils.js';
import { appState } from '../../core/state.js';

// Sub-modules
import { 
  renderModList, 
  updateBadge, 
  updateSubtitle, 
  updateToggleAllBtn 
} from './mods-list.js';
import { 
  checkAllConflicts, 
  restoreConflictCache 
} from './mods-conflicts.js';
import { 
  openAddModModal, 
  confirmAddMod, 
  toggleAllMods, 
  scanModsFolder, 
  verifyIntegrity 
} from './mods-actions.js';
import { 
  selectMod, 
  closeModDetail, 
  renderModDetail 
} from './mods-details.js';
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
    } catch (error) {
      console.error('Error picking folder:', error);
      toast((window.t ? window.t('common.error') : 'Error'), 'error');
    }
  });

  const viewBtn = document.getElementById('btn-view-mode');
  const modlist = document.getElementById('mod-list');
  const scrollContainer = document.querySelector('.content-area'); // Fixed selector typo (Issue 21)

  if (S.isCompact && modlist) modlist.classList.add('compact');

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
    if (modlist) modlist.classList.toggle('compact', val);
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
    btn.addEventListener('click', async e => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      S.currentFilter = e.currentTarget.dataset.filter;
      renderModList(true);
      try {
        const settings = await invoke('get_settings');
        settings.current_filter = S.currentFilter;
        await invoke('update_settings', { settings });
      } catch (e) {}
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
  sortSelect?.addEventListener('change', async e => {
    S.currentSort = (e.target as HTMLSelectElement).value;
    renderModList(true);
    try {
      const settings = await invoke('get_settings') as any;
      settings.current_sort_by = S.currentSort;
      await invoke('update_settings', { settings });
    } catch (e) {}
  });

  // Tag Filter
  const tagFilterSelect = document.getElementById('mod-tag-filter');
  tagFilterSelect?.addEventListener('change', e => {
    S.currentTagFilter = (e.target as HTMLSelectElement).value;
    renderModList(true);
  });

  // History
  const historyFilter = document.getElementById('history-filter') as HTMLSelectElement;
  
  document.getElementById('btn-show-history')?.addEventListener('click', async () => {
    const activeId = await invoke('get_active_profile_id').catch(() => null);
    if (!activeId) return toast(t('prof.noneActive'), 'error');
    try {
      S.currentHistory = await invoke('get_activity_history', { profileId: activeId });
      if (historyFilter) historyFilter.value = 'all';
      renderHistoryModal(S.currentHistory);
    } catch (err) { toast(t('history.error') + ' : ' + err, 'error'); }
  });

  historyFilter?.addEventListener('change', () => {
    if (S.currentHistory) {
      const filter = historyFilter.value;
      const filtered = filter === 'all' ? S.currentHistory : S.currentHistory.filter(i => {
          if (filter === 'Enabled') return i.action.startsWith('Enabled');
          return i.action === filter;
      });
      renderHistoryModal(filtered);
    }
  });

  document.getElementById('btn-clear-history')?.addEventListener('click', async () => {
    const activeId = await invoke('get_active_profile_id').catch(() => null);
    if (!activeId) return;
    try {
        await invoke('clear_activity_history', { profileId: activeId });
        S.currentHistory = [];
        renderHistoryModal(S.currentHistory);
        toast(t('common.success') || 'Success', 'success');
    } catch (err) {
        toast(t('common.error') + ': ' + err, 'error');
    }
  });

  const historyRetention = document.getElementById('history-retention') as HTMLSelectElement;
  const historyRetentionCustom = document.getElementById('history-retention-custom-days') as HTMLInputElement;

  const saveRetention = async (days: number) => {
      try {
          const settings = await invoke('get_settings') as any;
          settings.history_retention_days = days;
          await invoke('update_settings', { settings });
          toast(t('common.success') || 'Success', 'success');
      } catch (err) {
          console.error('Failed to save retention settings', err);
      }
  };

  historyRetention?.addEventListener('change', async (e) => {
      const val = (e.target as HTMLSelectElement).value;
      if (val === 'custom') {
          if (historyRetentionCustom) {
              historyRetentionCustom.style.display = 'inline-block';
              historyRetentionCustom.focus();
          }
      } else {
          if (historyRetentionCustom) historyRetentionCustom.style.display = 'none';
          const days = parseInt(val, 10);
          await saveRetention(days);
      }
  });

  historyRetentionCustom?.addEventListener('change', async (e) => {
      let days = parseInt((e.target as HTMLInputElement).value, 10);
      if (isNaN(days) || days < 1) {
          days = 1;
          (e.target as HTMLInputElement).value = '1';
      }
      await saveRetention(days);
  });

  // File Drop
  listenFileDrop(async paths => {
    const libView = document.getElementById('view-library');
    if (!libView || !libView.classList.contains('active')) return;
    if (document.querySelector('.modal-overlay.open')) return;
    if (paths && paths.length > 0) {
      openAddModModal();
      const folderInput = document.getElementById('mod-folder');
      if (folderInput) folderInput.value = paths[0];
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
      S.currentFilter = (settings as any).current_filter || 'all';
      S.currentSort = (settings as any).current_sort_by || 'name_asc';
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.filter === S.currentFilter));
      const sortSelect = document.getElementById('mod-sort') as HTMLSelectElement;
      if (sortSelect) sortSelect.value = S.currentSort;
      
      const retentionSelect = document.getElementById('history-retention') as HTMLSelectElement;
      const customInput = document.getElementById('history-retention-custom-days') as HTMLInputElement;
      if (retentionSelect && (settings as any).history_retention_days !== undefined) {
          const days = (settings as any).history_retention_days;
          if ([0, 7, 30, 90].includes(days)) {
              retentionSelect.value = String(days);
              if (customInput) customInput.style.display = 'none';
          } else {
              retentionSelect.value = 'custom';
              if (customInput) {
                  customInput.value = String(days);
                  customInput.style.display = 'inline-block';
              }
          }
      }
    }
    S.userTags = await invoke('get_tags').catch(() => []);
    S.allMods = await invoke('get_mods');
    updateTagFilterUI();
    renderModList();
  } catch (err) { S.allMods = []; }

  updateBadge();
  updateSubtitle();
  restoreConflictCache();

  if (S.selectedModId) {
    const m = S.allMods.find(mod => mod.id === S.selectedModId);
    if (m) renderModDetail(m.id);
    else closeModDetail();
  }

  checkAllConflicts();
}

export async function refreshMods(autoScan = false, immediate = false) {
  if (refreshTimeout) { clearTimeout(refreshTimeout); refreshTimeout = null; }

  const doRefresh = async () => {
    if (autoScan && S.processingMods.size === 0) {
      const activeId = S.cachedActiveProfileId || await invoke('get_active_profile_id').catch(() => null);
      if (activeId) await invoke('scan_mods_folder').catch(() => {});
    }
    try {
      S.userTags = await invoke('get_tags').catch(() => []);
      S.allMods = await invoke('get_mods').catch(() => []);
      S.cachedActiveProfileId = await invoke('get_active_profile_id').catch(() => null);
    } catch (err) { S.allMods = []; }

    updateBadge();
    updateSubtitle();
    updateToggleAllBtn();
    try { renderProfiles(); } catch (e) {}
    updateTagFilterUI();
    renderModList(true); 

    if (S.selectedModId) renderModDetail(S.selectedModId);
    checkAllConflicts();
  };

  if (immediate) return await doRefresh();
  return new Promise(resolve => {
    refreshTimeout = setTimeout(async () => { await doRefresh(); refreshTimeout = null; resolve(); }, 200);
  });
}

function renderHistoryModal(history) {
  const list = document.getElementById('history-list');
  if (!list) return;
  if (!history || history.length === 0) {
    list.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:20px">${t('history.empty')}</div>`;
  } else {
    // Clone to avoid mutating original
    const sorted = [...history].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    // Use array + join to avoid O(n²) innerHTML += accumulation
    const parts: string[] = [];
    if (!window.__historyCache) window.__historyCache = {};

    sorted.forEach((item, idx) => {
      const isEnabled = item.action.startsWith('Enabled');
      const isDisabled = item.action === 'Disabled';
      const isDeleted = item.action === 'Deleted';
      const isModified = item.action === 'Modified';
      
      let color = 'var(--text-muted)';
      let actionText = item.action;
      let bg = 'rgba(255,255,255,0.05)';

      if (isEnabled) {
          color = 'var(--success)';
          actionText = t('mod.statusActive') || 'Enabled';
          bg = 'rgba(16,185,129,0.15)';
      } else if (isDisabled) {
          color = 'var(--text-muted)';
          actionText = t('mod.statusInactive') || 'Disabled';
          bg = 'rgba(255,255,255,0.05)';
      } else if (isDeleted) {
          color = 'var(--danger)';
          actionText = t('history.action.Deleted') || 'Deleted';
          bg = 'rgba(239,68,68,0.15)';
      } else if (isModified) {
          color = 'var(--accent)';
          actionText = t('history.action.Modified') || 'Modified';
          bg = 'rgba(59,130,246,0.15)';
      }

      const dateStr = new Date(item.timestamp).toLocaleString();
      let detailsHtml = '';
      if (item.details && isModified) {
          try {
              const changes = JSON.parse(item.details);
              const cacheKey = `hist_${idx}`; 
              window.__historyCache[cacheKey] = item;

              const fieldBadges = changes.map(c => `
                <span style="background:rgba(59,130,246,0.15);color:var(--accent);padding:1px 6px;border-radius:4px;font-weight:600;font-size:9px">
                  ${escHtml(t('detail.' + c.field) || c.field)}
                </span>
              `).join('');

              detailsHtml = `
                <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;align-items:center">
                  <div style="font-size:10px;color:var(--text-muted);display:flex;align-items:center;gap:4px;background:rgba(255,255,255,0.04);padding:4px 10px;border-radius:12px;cursor:pointer;border:1px solid rgba(255,255,255,0.05);transition:all 0.2s" 
                       onmouseover="this.style.background='rgba(59,130,246,0.1)';this.style.borderColor='rgba(59,130,246,0.2)'" 
                       onmouseout="this.style.background='rgba(255,255,255,0.04)';this.style.borderColor='rgba(255,255,255,0.05)'" 
                       onclick="window.openHistoryDetail('${cacheKey}')">
                      <span style="opacity:0.7">${t('history.action.Modified') || 'Modifié'}: </span>
                      ${fieldBadges}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-left:2px;opacity:0.5"><polyline points="9 18 15 12 9 6"/></svg>
                  </div>
                </div>
              `;
          } catch(e) {
              detailsHtml = `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;font-style:italic;opacity:0.6">${escHtml(item.details)}</div>`;
          }
      } else if (item.details) {
          detailsHtml = `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;font-style:italic;opacity:0.6">${escHtml(item.details)}</div>`;
      }
      
      parts.push(`
        <div style="display:flex;align-items:center;gap:12px;padding:10px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid var(--border)">
          <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;align-self:flex-start;margin-top:6px"></div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                <div style="font-weight:600;color:var(--text-primary);word-break:break-all">${escHtml(item.mod_name)}</div>
                <div style="font-size:11px;font-family:var(--font-mono);padding:3px 8px;border-radius:6px;background:${bg};color:${color};flex-shrink:0;">
                    ${actionText}
                </div>
            </div>
            <div style="font-size:12px;color:var(--text-muted)">${dateStr}</div>
            ${detailsHtml}
          </div>
        </div>
      `);
    });
    // Single DOM write — eliminates O(n²) thrashing from innerHTML +=
    list.innerHTML = parts.join('');
  }
  document.getElementById('modal-history')?.classList.add('open');
}

window.openHistoryDetail = (cacheKey) => {
    console.log('Opening history detail for:', cacheKey);
    const item = window.__historyCache ? window.__historyCache[cacheKey] : null;
    if (!item) {
        console.error('Item not found in cache for key:', cacheKey);
        return;
    }
    
    const modal = document.getElementById('modal-history-detail');
    const container = document.getElementById('history-detail-diff-container');
    const modNameEl = document.getElementById('history-detail-modname');
    
    if (!modal || !container || !modNameEl) {
        console.error('History detail modal elements not found');
        return;
    }
    
    const modalTitle = document.getElementById('history-detail-modal-title');
    if (modalTitle) modalTitle.textContent = t('history.detail.title') || 'Modification Details';
    
    modNameEl.textContent = item.mod_name;
    container.innerHTML = '';
    
    try {
        const changes = JSON.parse(item.details);
        console.log('Changes to display:', changes);
        changes.forEach(c => {
            const fieldLabel = t('detail.' + c.field) || c.field;
            
            const formatValue = (v) => {
                if (v === null || v === undefined) return '-';
                if (typeof v === 'string') return v;
                if (Array.isArray(v)) {
                    if (v.length === 0) return '[]';
                    if (c.field === 'tags') {
                        return v.map(id => {
                            const tDef = S.userTags.find(t => t.id === id);
                            return tDef ? tDef.name : `[Unknown Tag: ${id}]`;
                        }).join(', ');
                    }
                    if (c.field === 'dependencies') {
                        return v.map(id => {
                            const m = S.allMods.find(mod => mod.id === id);
                            return m ? m.name : `[Missing Mod: ${id}]`;
                        }).join(', ');
                    }
                    return JSON.stringify(v, null, 2);
                }
                return JSON.stringify(v, null, 2);
            };
            
            const oldVal = formatValue(c.old);
            const newVal = formatValue(c.new);
            
            container.innerHTML += `
                <div class="diff-row" style="background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:12px; overflow:hidden">
                    <div style="background:rgba(59,130,246,0.1); padding:8px 15px; border-bottom:1px solid var(--border); font-weight:700; font-size:11px; color:var(--accent); text-transform:uppercase; letter-spacing:0.05em; display:flex; justify-content:space-between; align-items:center">
                        <span>${escHtml(truncate(fieldLabel, 50))}</span>
                        <span style="font-weight:400; opacity:0.5; font-size:10px">${escHtml(c.field)}</span>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:1px; background:var(--border)">
                        <div style="background:rgba(0,0,0,0.2); padding:15px; min-height:60px">
                            <div style="font-size:9px; color:var(--danger); font-weight:800; margin-bottom:10px; text-transform:uppercase; opacity:0.6; display:flex; align-items:center; gap:5px">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                ${t('history.before') || 'BEFORE'}
                            </div>
                            <pre style="margin:0; font-family:var(--font-mono); font-size:11px; color:var(--text-muted); white-space:pre-wrap; word-break:break-all; line-height:1.5">${escHtml(oldVal)}</pre>
                        </div>
                        <div style="background:rgba(16,185,129,0.03); padding:15px; min-height:60px">
                            <div style="font-size:9px; color:var(--success); font-weight:800; margin-bottom:10px; text-transform:uppercase; opacity:0.6; display:flex; align-items:center; gap:5px">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                                ${t('history.after') || 'AFTER'}
                            </div>
                            <pre style="margin:0; font-family:var(--font-mono); font-size:11px; color:var(--text-primary); white-space:pre-wrap; word-break:break-all; line-height:1.5; font-weight:500">${escHtml(newVal)}</pre>
                        </div>
                    </div>
                </div>
            `;
        });
        
        // Add Revert Button if applicable
        const footer = modal.querySelector('.modal-footer');
        if (footer) {
            const isModified = item.action === 'Modified';
            footer.innerHTML = `
                ${isModified ? `<button class="btn btn-primary" onclick="window.revertHistoryAction('${cacheKey}')" style="background:var(--accent); border:none; padding:10px 25px; border-radius:12px; font-weight:700; font-size:12px; color:white; cursor:pointer; box-shadow:0 4px 15px rgba(59,130,246,0.3); display:flex; align-items:center; gap:8px">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 10h10a8 8 0 0 1 8 8v2M3 10l6-6m-6 6l6 6"/></svg>
                        ${t('history.revert') || 'REVERT'}
                    </button>` : ''}
                <button class="btn btn-primary" style="padding:8px 25px" onclick="document.getElementById('modal-history-detail').classList.remove('open')" data-i18n="common.close">${t('common.close') || 'Close'}</button>
            `;
        }

        modal.classList.add('open');
    } catch(e) {
        console.error('Error parsing details', e);
    }
}

window.revertHistoryAction = async (cacheKey) => {
    const item = window.__historyCache ? window.__historyCache[cacheKey] : null;
    if (!item || !item.details) return;

    try {
        const changes = JSON.parse(item.details);
        const mod = S.allMods.find(m => m.id === item.mod_id);
        if (!mod) {
            toast(t('history.modNotFound') || 'Mod not found for revert', 'error');
            return;
        }

        // Prepare the reverted metadata
        // We take the current mod metadata and overwrite the fields from 'old' values in the log
        const updatedMeta = { ...mod };
        changes.forEach(c => {
            if (c.field === 'dependencies' && Array.isArray(c.old)) {
                // Keep only dependencies that still exist in the library
                updatedMeta.dependencies = c.old.filter(id => S.allMods.some(m => m.id === id));
            } else if (c.field === 'tags' && Array.isArray(c.old)) {
                // Keep only tags that still exist in global definitions
                updatedMeta.tags = c.old.filter(id => S.userTags.some(t => t.id === id));
            } else {
                updatedMeta[c.field] = c.old;
            }
        });

        const inv = typeof invoke !== 'undefined' ? invoke : window.__TAURI__.tauri.invoke;
        await inv('update_mod_meta', {
            modId: mod.id,
            payload: {
                name: updatedMeta.name,
                version: updatedMeta.version,
                author: updatedMeta.author,
                description: updatedMeta.description,
                tags: updatedMeta.tags,
                downloadLinks: updatedMeta.download_links,
                dependencies: updatedMeta.dependencies
            }
        });

        // Update local state
        Object.assign(mod, updatedMeta);
        appState.set('allMods', [...S.allMods]);

        toast(t('history.revertSuccess') || 'Changes reverted successfully!', 'success');
        document.getElementById('modal-history-detail').classList.remove('open');
        
        // Refresh history modal if open
        renderHistoryModal(S.currentHistory || []);
    } catch (e) {
        toast((t('history.revertError') || 'Error during revert: {error}').replace('{error}', String(e)), 'error');
        console.error(e);
    }
}
function updateTagFilterUI() {
  const select = document.getElementById('mod-tag-filter') as HTMLSelectElement | null;
  if (!select) return;
  const currentVal = S.currentTagFilter || 'all';
  let html = `<option value="all" data-i18n="lib.tagFilterAll">${t('lib.tagFilterAll') || 'All tags'}</option>`;
  if (S.userTags && S.userTags.length > 0) {
    const sortedTags = [...S.userTags].sort((a:any, b:any) => a.name.localeCompare(b.name));
    sortedTags.forEach((tag:any) => {
      html += `<option value="${tag.id}">${escHtml(tag.name)}</option>`;
    });
  }
  select.innerHTML = html;
  select.value = currentVal;
}

export { selectMod, closeModDetail, renderModDetail };
