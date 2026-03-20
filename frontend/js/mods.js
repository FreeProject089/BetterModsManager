/**
 * mods.js — Mod library management with detail panel + scan + edit
 */
import { invoke, pickFolder, listenFileDrop, toast, sendOsNotification } from './app.js';
import { renderProfiles } from './profiles.js';
import { t, applyTranslations } from './i18n.js';
import { escHtml, escAttr } from './utils.js';
import { getModCardHTML, getModDetailHTML, getLoadingOverlayHTML } from './components.js';
import { appState } from './state.js';

const S = new Proxy(appState.state, {
  get(target, prop) { return target[prop]; },
  set(target, prop, value) { appState.set(prop, value); return true; }
});


let pendingMetadata = null;
let refreshTimeout = null;

let ghostFilteredMods = []; // Snapshot for virtualization
let lastStartIndex = -1;
let lastEndIndex = -1;
const CARD_HEIGHTS = { standard: 110, compact: 54 }; // Constants for virtualization
let isVirtualizing = false;

let conflictCheckGeneration = 0;

export async function initMods() {
  window._refreshModsFn = refreshMods;
  document.getElementById('btn-add-mod').addEventListener('click', openAddModModal);
  document.getElementById('btn-confirm-add-mod').addEventListener('click', confirmAddMod);
  document.getElementById('btn-enable-all').addEventListener('click', () => toggleAllMods());

  const viewBtn = document.getElementById('btn-view-mode');
  const modlist = document.getElementById('mod-list');
  const scrollContainer = document.querySelector('.content-area');

  if (S.isCompact) modlist.classList.add('compact');

  // React to state changes (e.g. from DevTools)
  appState.subscribe('isCompact', (val) => {
    modlist.classList.toggle('compact', val);
    renderModList(true);
  });

  appState.subscribe('currentFilter', () => renderModList(true));
  appState.subscribe('currentSort', () => renderModList(true));

  viewBtn.addEventListener('click', () => {
    S.isCompact = !S.isCompact;
    localStorage.setItem('bmm-view-compact', S.isCompact);
    // Subscription above handles the rest
  });

  // Attach scroll listener for virtualization
  if (scrollContainer) {
    scrollContainer.addEventListener('scroll', () => {
      if (ghostFilteredMods.length > 0) {
        requestAnimationFrame(() => renderModList(false));
      }
    }, { passive: true });
  }

  const altDisable = document.getElementById('btn-disable-all-alt');
  if (altDisable) altDisable.addEventListener('click', () => toggleAllMods(false));

  // Verify Integrity
  const verifyBtn = document.getElementById('btn-verify-integrity');
  if (verifyBtn) {
    verifyBtn.addEventListener('click', async () => {
      try {
        toast(t('integrity.checking'), 'info');
        const alteredFiles = await invoke('verify_integrity');
        const modal = document.getElementById('modal-integrity');
        const content = document.getElementById('integrity-report-content');

        if (alteredFiles.length === 0) {
          content.innerHTML = `<div style="color:var(--success);padding:20px;text-align:center;"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-bottom:12px"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg><br><h3>${t('integrity.ok')}</h3><p style="font-size:13px;color:var(--text-muted);margin-top:8px">${t('integrity.okDesc')}</p></div>`;
        } else {
          let html = `<div style="color:var(--warning);padding:10px 0;"><h3 style="margin-bottom:12px;display:flex;align-items:center;gap:8px"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg> ${t('integrity.issues')}</h3><p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">${t('integrity.issuesDesc')}</p><ul style="background:rgba(0,0,0,0.2);padding:12px;border-radius:8px;max-height:300px;overflow-y:auto;list-style:none;margin:0;border:1px solid var(--border)">`;
          alteredFiles.forEach(f => {
            html += `<li style="font-size:12px;font-family:var(--font-mono);margin-bottom:6px;word-break:break-all;color:var(--text-primary)"><span style="color:var(--accent)">></span> ${String(f).replace(/</g, '&lt;')}</li>`;
          });
          html += `</ul><div style="margin-top:16px;font-size:12px;color:var(--text-secondary)">${t('integrity.tip')}</div></div>`;
          content.innerHTML = html;
        }

        modal.classList.add('open');
      } catch (err) {
        toast(t('common.error') + ' : ' + err, 'error');
      }
    });
  }

  // Scan mods folder button
  const scanBtn = document.getElementById('btn-scan-mods');
  if (scanBtn) {
    scanBtn.addEventListener('click', async () => {
      try {
        const added = await invoke('scan_mods_folder');
        if (added.length === 0) {
          toast(t('mod.scanNone'), 'info');
        } else {
          toast(t('mod.scanFound').replace('{count}', added.length), 'success');
          await refreshMods();
        }
      } catch (err) {
        toast(t('common.error') + ' : ' + err, 'error');
      }
    });
  }

  document.getElementById('btn-pick-mod-folder')?.addEventListener('click', async () => {
    const path = await pickFolder();
    if (path) {
      const folderInput = document.getElementById('mod-folder');
      if (folderInput) folderInput.value = path;
      
      const nameInput = document.getElementById('mod-name');
      if (nameInput && !nameInput.value) {
        const parts = path.replace(/\\/g, '/').split('/');
        nameInput.value = parts[parts.length - 1] || '';
      }


    }
  });





  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      S.currentFilter = e.currentTarget.dataset.filter;
      renderModList(true);
      
      // Save setting
      try {
        const settings = await invoke('get_settings');
        settings.current_filter = S.currentFilter;
        await invoke('update_settings', { settings });
      } catch (e) { console.error("Failed to save filter setting:", e); }
    });
  });

  // Search
  document.getElementById('mod-search').addEventListener('input', e => {
    S.searchQuery = e.target.value.toLowerCase();
    renderModList(true);
  });

  // History Modal
  const historyBtn = document.getElementById('btn-show-history');
  if (historyBtn) {
    historyBtn.addEventListener('click', async () => {
      const activeId = await invoke('get_active_profile_id').catch(() => null);
      if (!activeId) {
        toast(t('prof.noneActive'), 'error');
        return;
      }
      try {
        const history = await invoke('get_activity_history', { profileId: activeId });
        renderHistoryModal(history);
      } catch (err) {
        toast(t('history.error') + ' : ' + err, 'error');
      }
    });
  }

  // Sort
  const sortSelect = document.getElementById('mod-sort');
  if (sortSelect) {
    sortSelect.addEventListener('change', async e => {
      S.currentSort = e.target.value;
      renderModList(true);
      
      // Save setting
      try {
        const settings = await invoke('get_settings');
        settings.current_sort_by = S.currentSort;
        await invoke('update_settings', { settings });
      } catch (e) { console.error("Failed to save sort setting:", e); }
    });
  }

  // File Drop
  listenFileDrop(async paths => {
    // Check if Library view is active
    const libView = document.getElementById('view-library');
    if (!libView || !libView.classList.contains('active')) return;

    // Check if an existing modal is already open
    if (document.querySelector('.modal-overlay.open')) return;

    if (paths && paths.length > 0) {
      const path = paths[0]; // Take first dropped file/folder
      openAddModModal();
      
      const folderInput = document.getElementById('mod-folder');
      if (folderInput) folderInput.value = path;
      
      const nameInput = document.getElementById('mod-name');
      if (nameInput) {
        const parts = path.replace(/\\/g, '/').split('/');
        nameInput.value = parts[parts.length - 1] || '';
      }


    }
  });



  // Close detail panel
  const closeDetail = document.getElementById('btn-close-detail');
  if (closeDetail) closeDetail.addEventListener('click', closeModDetail);

  try {
    const settings = await invoke('get_settings').catch(() => null);
    if (settings) {
      S.currentFilter = settings.current_filter || 'all';
      S.currentSort = settings.current_sort_by || 'name_asc';
      
      // Update UI state
      document.querySelectorAll('.filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === S.currentFilter);
      });
      if (sortSelect) sortSelect.value = S.currentSort;
    }

    S.userTags = await invoke('get_tags').catch(() => []);
    S.allMods = await invoke('get_mods');
    renderModList();
  } catch (err) {
    console.warn("Could not get mods:", err);
    S.allMods = [];
  }
  updateBadge();
  updateSubtitle();

  // Restore conflict cache from localStorage for instant badges
  restoreConflictCache();
  if (S.selectedModId) {
    const m = S.allMods.find(mod => mod.id === S.selectedModId);
    if (m) renderModDetail(m);
    else closeModDetail();
  }

  // Background check for conflicts (non-blocking, batched)
  checkAllConflicts();
}

async function checkAllConflicts() {
  const currentGen = ++conflictCheckGeneration;
  const activeId = S.cachedActiveProfileId || await invoke('get_active_profile_id').catch(() => null);
  if (!activeId) return;

  // Process mods in small batches to avoid flooding the IPC bridge
  const BATCH_SIZE = 5;
  const mods = [...S.allMods]; // snapshot
  for (let i = 0; i < mods.length; i += BATCH_SIZE) {
    const batch = mods.slice(i, i + BATCH_SIZE);
    
    if (currentGen !== conflictCheckGeneration) return; // Abort if a new refresh started
    
    const results = await Promise.allSettled(batch.map(m => invoke('get_mod_conflicts', { modId: m.id })));

    if (currentGen !== conflictCheckGeneration) return; // Abort after await if stale

    results.forEach((res, idx) => {
      const mod = batch[idx];
      if (mod && res.status === 'fulfilled' && res.value && res.value.length > 0) {
        S.conflictCache[mod.id] = res.value;
      } else if (mod) {
        delete S.conflictCache[mod.id];
      }
    });

    // Update conflict badges IN-PLACE on existing cards — no full re-render, no flicker
    batch.forEach(mod => updateConflictBadgeOnCard(mod.id));
  }

  // Save conflict cache to localStorage for instant restore on next launch
  saveConflictCache();
}

/** Update the conflict badge on a single existing mod card without re-rendering */
function updateConflictBadgeOnCard(modId) {
  const card = document.querySelector(`.mod-card[data-id="${modId}"]`);
  if (!card) return;

  const reports = S.conflictCache[modId] || [];
  const modInfo = card.querySelector('.mod-info');
  const nameRow = modInfo ? modInfo.firstElementChild : null;
  if (!nameRow) return;

  // Remove old conflict badges
  nameRow.querySelectorAll('.tag-conflict, .conflict-badge').forEach(e => e.remove());

  if (reports.length > 0) {
    const hasIntraActive = reports.some(c => c.category === 'Intra' && c.status === 'Active');
    const hasIntraPotential = reports.some(c => c.category === 'Intra' && c.status === 'Potential');
    const hasInterActive = reports.some(c => c.category === 'Inter' && c.status === 'Active');
    const hasInterPotential = reports.some(c => c.category === 'Inter' && c.status === 'Potential');

    let conflictHtml = '';
    if (hasIntraActive) conflictHtml += `<div class="tag-conflict tag-intra-conflict active" title="Conflit Interne Actif" onclick="window.openGlobalConflictModal('${modId}')" style="cursor:pointer"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>Intra</div>`;
    else if (hasIntraPotential) conflictHtml += `<div class="tag-conflict tag-intra-conflict potential" title="Risque de Conflit Interne" onclick="window.openGlobalConflictModal('${modId}')" style="cursor:pointer"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>Intra</div>`;

    if (hasInterActive) conflictHtml += `<div class="tag-conflict tag-inter-conflict active" title="Conflit Entre Profils Actif" onclick="window.openGlobalConflictModal('${modId}')" style="cursor:pointer"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>Inter</div>`;
    else if (hasInterPotential) conflictHtml += `<div class="tag-conflict tag-inter-conflict potential" title="Risque de Conflit Entre Profils" onclick="window.openGlobalConflictModal('${modId}')" style="cursor:pointer"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>Inter</div>`;

    if (conflictHtml) nameRow.insertAdjacentHTML('beforeend', conflictHtml);
  }
}

/** Save conflict cache to localStorage for instant restore on next launch */
function saveConflictCache() {
  try {
    localStorage.setItem('bmm_conflict_cache', JSON.stringify(S.conflictCache));
  } catch (e) { /* quota exceeded — ignore */ }
}

/** Restore conflict cache from localStorage */
function restoreConflictCache() {
  try {
    const cached = localStorage.getItem('bmm_conflict_cache');
    if (cached) {
      S.conflictCache = JSON.parse(cached);
    }
  } catch (e) { S.conflictCache = {}; }
}

export function refreshMods(autoScan = false, immediate = false) {
  if (refreshTimeout) {
    clearTimeout(refreshTimeout);
    refreshTimeout = null;
  }

  const doRefresh = async () => {
    // Skip heavy scan on profile switch — only scan on explicit user action
    if (autoScan && S.processingMods.size === 0) {
      // Fire and forget — don't block rendering
      invoke('scan_mods_folder').catch(() => {});
    }

    try {
      S.userTags = await invoke('get_tags').catch(() => []);
      S.allMods = await invoke('get_mods').catch(() => []);

      // Cache the active profile ID so renderModList never needs IPC
      S.cachedActiveProfileId = await invoke('get_active_profile_id').catch(() => null);
    } catch (err) {
      S.allMods = [];
    }

    updateBadge();
    updateSubtitle();
    updateToggleAllBtn();
    try { renderProfiles(); } catch (e) { }

    renderModList(true); // Force re-calculate ghost list from S.allMods

    if (S.selectedModId) {
      renderModDetail(S.selectedModId);
    }

    // Conflict checking happens AFTER render — non-blocking, batched
    checkAllConflicts();
  };

  if (immediate) {
    return doRefresh();
  }

  return new Promise(resolve => {
    refreshTimeout = setTimeout(async () => {
      await doRefresh();
      refreshTimeout = null;
      resolve();
    }, 200);
  });
}

function updateBadge() {
  const badge = document.getElementById('badge-library');
  badge.textContent = S.allMods.length;
  badge.classList.toggle('show', S.allMods.length > 0);
}

function updateSubtitle() {
  const enabled = S.allMods.filter(m => m.enabled).length;
  const total = S.allMods.length;
  const el = document.getElementById('lib-subtitle');
  if (!el) return;
  
  if (total === 0) {
    el.textContent = t('lib.subtitle.empty');
  } else {
    el.textContent = t('lib.subtitle', {
      enabled,
      total,
      s1: enabled !== 1 ? 's' : '',
      s2: total !== 1 ? 's' : ''
    });
  }
}

function getFilteredMods() {
  let filtered = S.allMods.filter(m => {
    const matchFilter =
      S.currentFilter === 'all' ||
      (S.currentFilter === 'enabled' && m.enabled) ||
      (S.currentFilter === 'disabled' && !m.enabled);
    // Search also matches tag names
    let matchSearch = !S.searchQuery || m.name.toLowerCase().includes(S.searchQuery);
    if (!matchSearch && S.searchQuery && m.tags && m.tags.length > 0) {
      matchSearch = m.tags.some(tid => {
        const tDef = S.userTags.find(t => t.id === tid);
        return tDef && tDef.name.toLowerCase().includes(S.searchQuery);
      });
    }
    return matchFilter && matchSearch;
  });

  filtered.sort((a, b) => {
    if (S.currentSort === 'name_asc') return a.name.localeCompare(b.name);
    if (S.currentSort === 'name_desc') return b.name.localeCompare(a.name);
    if (S.currentSort === 'status') {
      if (a.enabled === b.enabled) return a.name.localeCompare(b.name);
      return a.enabled ? -1 : 1;
    }
    return 0;
  });

  return filtered;
}

function renderHistoryModal(history) {
  const list = document.getElementById('history-list');
  list.innerHTML = '';
  if (!history || history.length === 0) {
    list.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:20px" data-i18n="history.empty">${t('history.empty')}</div>`;
    import('./i18n.js').then(m => m.applyTranslations());
  } else {
    // sort newest first
    history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    history.forEach(item => {
      const isEnabled = item.action === 'Enabled';
      const color = isEnabled ? 'var(--success)' : 'var(--text-muted)';
      const actionText = isEnabled ? t('mod.statusActive') : t('mod.statusInactive');
      const dateStr = new Date(item.timestamp).toLocaleString();
      const safeName = escHtml(item.mod_name);

      list.innerHTML += `
        <div style="display:flex;align-items:center;gap:12px;padding:10px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid var(--border)">
          <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></div>
          <div style="flex:1">
            <div style="font-weight:600;color:var(--text-primary);word-break:break-all">${safeName}</div>
            <div style="font-size:12px;color:var(--text-muted)">${dateStr}</div>
          </div>
          <div style="font-size:11px;font-family:var(--font-mono);padding:3px 8px;border-radius:6px;background:${isEnabled ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)'};color:${color}">
            ${actionText}
          </div>
        </div>
      `;
    });
  }
  document.getElementById('modal-history').classList.add('open');
}

async function renderModList(force = false) {
  const list = document.getElementById('mod-list');
  const viewport = document.getElementById('mod-list-viewport');
  const spacer = document.getElementById('mod-list-spacer');
  const empty = document.getElementById('empty-mods');
  const scrollContainer = document.querySelector('.content-area');

  if (!list || !viewport || !empty || !scrollContainer) return;

  // 1. Get current data state
  if (force || ghostFilteredMods.length === 0) {
    ghostFilteredMods = getFilteredMods();
  }

  const modCount = ghostFilteredMods.length;
  if (modCount === 0) {
    viewport.innerHTML = '';
    if (spacer) spacer.style.height = '0px';

    const hasProfile = !!S.cachedActiveProfileId;
    const noProfileEmpty = document.getElementById('empty-library-no-profile');

    if (!hasProfile) {
      if (noProfileEmpty) noProfileEmpty.style.display = 'block';
      empty.style.display = 'none';
    } else {
      if (noProfileEmpty) noProfileEmpty.style.display = 'none';
      // Profile active but NO MODS found
      empty.style.display = 'block';
    }
    return;
  }
  
  const noProfileEmpty = document.getElementById('empty-library-no-profile');
  if (noProfileEmpty) noProfileEmpty.style.display = 'none';
  empty.style.display = 'none';

  // 2. Virtualization Math
  const rowHeight = S.isCompact ? CARD_HEIGHTS.compact : CARD_HEIGHTS.standard;
  const scrollTop = scrollContainer.scrollTop;
  const containerHeight = scrollContainer.clientHeight || 800;

  // Increased buffer to 20 for smoother rapid scrolling
  const buffer = 20;
  let startIndex = Math.floor(scrollTop / rowHeight) - buffer;
  let endIndex = Math.ceil((scrollTop + containerHeight) / rowHeight) + buffer;

  if (startIndex < 0) startIndex = 0;
  if (endIndex > modCount) endIndex = modCount;

  if (!force && startIndex === lastStartIndex && endIndex === lastEndIndex) {
    return; 
  }

  lastStartIndex = startIndex;
  lastEndIndex = endIndex;

  if (spacer) spacer.style.height = (modCount * rowHeight) + 'px';

  // 3. Render visible slice with IN-PLACE RECONCILIATION
  const visibleBatch = ghostFilteredMods.slice(startIndex, endIndex);
  viewport.style.transform = `translateY(${startIndex * rowHeight}px)`;

  const newVisibleIds = new Set(visibleBatch.map(m => m.id));

  // A. Remove nodes that are no longer in the visible range
  const currentNodes = Array.from(viewport.children);
  currentNodes.forEach(node => {
     if (!newVisibleIds.has(node.dataset.id)) {
       node.remove();
     }
  });

  // B. Ensure all visible items have a card in the correct order
  // Pre-fetching existing cards into a map for fast lookup
  const existingMap = new Map();
  Array.from(viewport.children).forEach(node => {
     existingMap.set(node.dataset.id, node);
  });

  for (let i = 0; i < visibleBatch.length; i++) {
    const mod = visibleBatch[i];
    let card = existingMap.get(mod.id);

    if (!card) {
      card = createModCard(mod);
      // Re-append detail panel if this is the selected mod
      if (S.selectedModId === mod.id) {
        setTimeout(() => renderModDetail(mod.id), 0);
      }
    } else {
      updateCardState(card, mod);
    }

    // Insert or move at the specific position (insertBefore is sub-ms if already in place)
    if (viewport.children[i] !== card) {
       viewport.insertBefore(card, viewport.children[i] || null);
    }
  }

  // Trigger translations only on new elements (optional optimization, but applyTranslations is recursive)
  applyTranslations(viewport);
}

function updateCardState(card, mod) {
  card.classList.toggle('enabled', mod.enabled);
  card.classList.toggle('disabled', !mod.enabled);
  
  const toggle = card.querySelector('.mod-toggle-input');
  if (toggle) toggle.checked = mod.enabled;
  
  const dot = card.querySelector('.mod-status-dot');
  if (dot) {
    dot.classList.toggle('enabled', mod.enabled);
    dot.classList.toggle('disabled', !mod.enabled);
  }
}

export function updateModListDisplay() {
  renderModList(true);
}

function createModCard(mod) {
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
    const ignoreConflicts = localStorage.getItem('bmm_ignore_conflicts') === 'true';
    const bypassKey = `bypass_conflict_${mod.id}`;

    if (toggle.checked && conflicts && conflicts.length > 0 && !ignoreConflicts && !window[bypassKey]) {
      toggle.checked = false;
      window.showActivationWarning(mod.id, conflicts, () => {
        if (document.getElementById('conflict-ignore-forever')?.checked) localStorage.setItem('bmm_ignore_conflicts', 'true');
        window[bypassKey] = true;
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));
      });
      return;
    }
    window[bypassKey] = false;

    S.isGlobalProcessing = true;
    S.processingMods.add(mod.id);
    setModLoading(mod.id, true);

    try {
      if (toggle.checked) {
        const warningMsg = await invoke('enable_mod', { modId: mod.id });
        if (warningMsg && warningMsg.startsWith('WARNING_SPACE|')) {
          const parts = warningMsg.split('|');
          toast(t('storage.alertWarningMod', { label: parts[1], free: parts[2], limit: parts[3] }), 'warning', 5000);
        } else {
          toast(t('mod.activated', { name: mod.name }), 'success');
          if (localStorage.getItem('bmm_sysNotif') === 'true') sendOsNotification('Better Mod Manager', t('mod.activated', { name: mod.name }));
        }
      } else {
        await invoke('disable_mod', { modId: mod.id });
        toast(t('mod.deactivated', { name: mod.name }), 'info');
        if (localStorage.getItem('bmm_sysNotif') === 'true') sendOsNotification('Better Mod Manager', t('mod.deactivated', { name: mod.name }));
      }
    } catch (err) {
      if (typeof err === 'string' && err.startsWith('CRITICAL_SPACE|')) {
        const parts = err.split('|');
        toast(t('storage.alertCriticalMod', { label: parts[1], free: parts[2], limit: parts[3] }), 'error', 6000);
        toggle.checked = false;
      } else {
        toast(t('common.error') + ' : ' + err, 'error');
        toggle.checked = !toggle.checked;
      }
    } finally {
      setModLoading(mod.id, false);
      // Give time for fade-out before the card is potentially replaced by refreshMods
      await new Promise(r => setTimeout(r, 250));
      S.processingMods.delete(mod.id);
      S.isGlobalProcessing = false;
      await refreshMods();
    }
  });

  // Action listeners
  card.querySelector('.btn-open-folder').addEventListener('click', async (e) => {
    e.stopPropagation();
    try { await invoke('open_folder', { path: mod.mod_folder_path }); } catch (err) { toast(t('common.error') + ' : ' + err, 'error'); }
  });

  card.querySelector('.btn-edit-mod').addEventListener('click', (e) => {
    e.stopPropagation();
    selectMod(mod.id);
  });

  card.querySelector('.btn-remove-mod').addEventListener('click', async e => {
    e.stopPropagation();
    if (mod.enabled) {
      toast(t('mod.disableFirst'), 'warning');
      return;
    }
    // Deletion Modal Trigger
    const modal = document.getElementById('modal-delete-mod');
    const warningText = document.getElementById('delete-mod-warning-text');
    const confirmCheck = document.getElementById('check-delete-confirm');
    const finalBtn = document.getElementById('btn-final-delete-mod');
    const btnRemoveOnly = document.getElementById('btn-remove-only-mod');

    if (warningText) warningText.innerHTML = t('mod.deleteWarning', { name: `<strong style="color:var(--text-primary)">${mod.name}</strong>` });
    confirmCheck.checked = false;
    finalBtn.disabled = true;
    modal.classList.add('open');

    confirmCheck.onchange = () => { finalBtn.disabled = !confirmCheck.checked; };
    
    const performDeletion = async (deleteFiles) => {
      try {
        await invoke('remove_mod', { modId: mod.id, deleteFiles });
        toast(t(deleteFiles ? 'mod.removed' : 'mod.removedOnly', { name: mod.name }), 'info');
        modal.classList.remove('open');
        if (S.selectedModId === mod.id) closeModDetail();
        await refreshMods();
      } catch (err) { toast(t('common.error') + ' : ' + err, 'error'); }
    };

    finalBtn.onclick = () => performDeletion(true);
    btnRemoveOnly.onclick = () => performDeletion(false);
  });

  card.addEventListener('click', (e) => {
    if (e.target.closest('.mod-toggle') || e.target.closest('.btn-remove-mod') || e.target.closest('.btn-edit-mod') || e.target.closest('.btn-open-folder')) return;
    selectMod(mod.id);
  });

  return card;
}

function setModLoading(modId, isLoading) {
  const card = document.querySelector(`.mod-card[data-id="${modId}"]`);
  if (!card) return;

  const existingOverlay = card.querySelector('.mod-loading-overlay');
  if (isLoading && !existingOverlay) {
    card.insertAdjacentHTML('beforeend', getLoadingOverlayHTML());
  } else if (!isLoading && existingOverlay) {
    existingOverlay.classList.add('fade-out');
    setTimeout(() => existingOverlay.remove(), 300);
  }
}

// ── Detail / Edit Panel ──────────────────────────────────────
function selectMod(modId) {
  if (S.selectedModId === modId) {
    closeModDetail();
    return;
  }

  // Remove .selected from previously selected card
  if (S.selectedModId) {
    const oldCard = document.querySelector(`.mod-card[data-id="${S.selectedModId}"]`);
    if (oldCard) oldCard.classList.remove('selected');
  }

  S.selectedModId = modId;

  // Add .selected to the newly selected card
  const newCard = document.querySelector(`.mod-card[data-id="${modId}"]`);
  if (newCard) newCard.classList.add('selected');

  renderModDetail(modId);
}

function closeModDetail() {
  if (S.selectedModId) {
    const oldCard = document.querySelector(`.mod-card[data-id="${S.selectedModId}"]`);
    if (oldCard) oldCard.classList.remove('selected');
  }
  S.selectedModId = null;
  const panel = document.getElementById('mod-detail-panel');
  if (panel) panel.remove();
}

async function renderModDetail(modId) {
  const mod = S.allMods.find(m => m.id === modId);
  if (!mod) {
    closeModDetail();
    return;
  }

  let panel = document.getElementById('mod-detail-panel');
  if (panel) panel.remove();

  panel = document.createElement('div');
  panel.id = 'mod-detail-panel';
  panel.className = 'mod-detail-panel inline-panel';

  // Prevent click bubbling to avoid auto-closing when clicking input fields inside
  panel.addEventListener('click', e => e.stopPropagation());

  const card = document.querySelector(`.mod-card[data-id="${mod.id}"]`);
  if (!card) return;
  card.appendChild(panel);

  // Scroll into view if it's off screen
  setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);

  const links = mod.download_links || [];
  panel.innerHTML = getModDetailHTML(mod, { conflicts: [], links });

  // 1. ASYNC UPDATE: Fetch conflicts in background
  (async () => {
    try {
      const conflicts = await invoke('get_mod_conflicts', { modId: mod.id });
      if (conflicts && conflicts.length > 0) {
        // Update the conflict badge in the already rendered panel
        const badgeContainer = panel.querySelector('.conflict-badge-container');
        if (badgeContainer) {
          badgeContainer.innerHTML = `<span class="badge badge-warning" style="font-size:10px">${t('mod.conflictsFound').replace('{n}', conflicts.length)}</span>`;
        }
        // Update the conflict list if present
        const listContainer = panel.querySelector('#detail-conflicts-list');
        if (listContainer) {
          listContainer.innerHTML = conflicts.map(c => `
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
              <div style="font-size:11px;color:var(--text-primary);font-weight:600" title="${escAttr(c.other_mod_name)}">${escHtml(c.other_mod_name)}</div>
              <div style="font-size:10px;color:var(--text-muted)">${t('mod.profilLabel')}${escHtml(c.other_profile_name)}</div>
            </div>
          `).join('');
        }
      }
    } catch (e) {
      console.warn('[BMM] Failed to update conflicts in detail panel:', e);
    }
  })();

  // Close button
  panel.querySelector('#btn-close-detail-inner').addEventListener('click', closeModDetail);

  // Archive Explorer button
  panel.querySelector('#btn-browse-archive').addEventListener('click', () => openArchiveExplorer(mod));

  // Description auto-resize and explicit value set
  const descTextarea = panel.querySelector('#detail-desc');
  if (descTextarea) {
    descTextarea.value = mod.description || '';
    const autoResize = () => {
      descTextarea.style.height = 'auto';
      descTextarea.style.height = (descTextarea.scrollHeight + 2) + 'px';
    };
    descTextarea.addEventListener('input', autoResize);
    setTimeout(autoResize, 0); // Initial resize
  }

  // Load Tags logic
  const tagSelect = panel.querySelector('#detail-tag-select');
  const tagList = panel.querySelector('#detail-tags-list');
  let modTags = [...(mod.tags || [])];

  const renderTagsUI = () => {
    tagList.innerHTML = '';
    modTags.forEach(tid => {
      const tDef = S.userTags.find(t => t.id === tid);
      if (!tDef) return;
      const chip = document.createElement('div');
      chip.style.cssText = `display:flex;align-items:center;gap:4px;background:${tDef.color}20;color:${tDef.color};border:1px solid ${tDef.color}40;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600`;
      chip.innerHTML = `<span>${escHtml(tDef.name)}</span><button data-id="${tid}" style="background:none;border:none;color:inherit;cursor:pointer;padding:0;margin-left:4px">&times;</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        modTags = modTags.filter(id => id !== tid);
        renderTagsUI();
      });
      tagList.appendChild(chip);
    });
    mod._currentTags = modTags;
  };

  S.userTags.forEach(tDef => {
    const opt = document.createElement('option');
    opt.value = tDef.id;
    opt.textContent = tDef.name;
    tagSelect.appendChild(opt);
  });

  tagSelect.addEventListener('change', e => {
    const tid = e.target.value;
    if (tid && !modTags.includes(tid)) {
      if (modTags.length >= 3) {
        toast(t('mod.tagLimit'), 'warning');
      } else {
        modTags.push(tid);
        renderTagsUI();
      }
    }
    e.target.value = '';
  });

  // Initial tags render
  renderTagsUI();
  
  // Save button
  panel.querySelector('#btn-save-detail').addEventListener('click', async () => {
    const name = panel.querySelector('#detail-name').value.trim();
    const version = panel.querySelector('#detail-version').value.trim();
    const author = panel.querySelector('#detail-author').value.trim();
    const description = panel.querySelector('#detail-desc').value.trim();
    const tags = mod._currentTags || mod.tags || [];

    try {
      const linkRows = panel.querySelectorAll('#detail-links-list > div');
      const downloadLinks = [];
      for (const row of linkRows) {
        const url = row.querySelector('.detail-link-url').value.trim();
        const linkType = row.querySelector('.detail-link-type').value;
        const label = row.querySelector('.detail-link-label').value.trim();
        if (url) {
          downloadLinks.push({ url, link_type: linkType, label });
        }
      }

      await invoke('update_mod_meta', { 
        modId: mod.id, 
        name, 
        author, 
        description, 
        version, 
        tags,
        downloadLinks
      });

      toast('Mod sauvegardé.', 'success');
      await refreshMods(false, true);
    } catch (err) {
      toast('Erreur : ' + err, 'error');
    }
  });

  // Add link button
  panel.querySelector('#btn-add-link').addEventListener('click', () => {
    const list = panel.querySelector('#detail-links-list');
    const idx = list.children.length;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;background:rgba(0,0,0,0.2);padding:6px 8px;border-radius:8px';
    row.innerHTML = `
            <select class="detail-link-type input-field" style="width:100px;padding:3px;font-size:10px" data-index="${idx}">
                <option value="github">GitHub</option>
                <option value="direct" selected>Direct</option>
                <option value="other">Autre</option>
            </select>
            <input type="text" class="detail-link-url input-field" style="flex:1;padding:3px 6px;font-size:10px" value="" placeholder="URL" data-index="${idx}" />
            <input type="text" class="detail-link-label input-field" style="width:80px;padding:3px 6px;font-size:10px" value="" placeholder="Label" data-index="${idx}" />
            <button class="btn-remove-link" data-index="${idx}" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px;display:flex;align-items:center" title="Supprimer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        `;
    row.querySelector('.btn-remove-link').addEventListener('click', () => row.remove());
    list.appendChild(row);
  });

  // Remove link buttons
  panel.querySelectorAll('.btn-remove-link').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('div').remove());
  });
}

function openAddModModal() {
  ['mod-name', 'mod-folder', 'mod-version', 'mod-author', 'mod-desc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  
  const verEl = document.getElementById('mod-version');
  if (verEl) verEl.value = '1.0.0';

  const tagSelect = document.getElementById('mod-tag');
  if (tagSelect) {
    tagSelect.innerHTML = '<option value="" data-i18n="prof.none">Aucun</option>';
    S.userTags.forEach(tDef => {
      const opt = document.createElement('option');
      opt.value = tDef.id;
      opt.textContent = tDef.name;
      tagSelect.appendChild(opt);
    });
  }

  document.getElementById('modal-add-mod')?.classList.add('open');
}

async function confirmAddMod() {
  const nameEl = document.getElementById('mod-name');
  const folderEl = document.getElementById('mod-folder');
  if (!nameEl || !folderEl) return;
  
  const name = nameEl.value.trim();
  const folder = folderEl.value.trim();
  const version = document.getElementById('mod-version')?.value.trim() || '1.0.0';
  const author = document.getElementById('mod-author')?.value.trim() || '';
  const description = document.getElementById('mod-desc')?.value.trim() || '';
  const tagSelect = document.getElementById('mod-tag');
  const tagId = tagSelect ? tagSelect.value : '';

  if (!name || !folder) {
    toast(t('mod.folderRequired'), 'error');
    return;
  }

  const btn = document.getElementById('btn-confirm-add-mod');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;vertical-align:middle;margin-right:6px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Copie en cours...';

  // Get pending links if any
  const modal = document.getElementById('modal-add-mod');
  const downloadLinks = modal ? modal._pendingLinks : null;

  try {
    await invoke('add_mod', {
      name,
      modFolderPath: folder,
      author,
      description,
      version,
      tags: tagId ? [tagId] : [],
      downloadLinks: downloadLinks
    });
    
    if (modal) modal._pendingLinks = null; // Clear after use
    document.getElementById('modal-add-mod').classList.remove('open');
    toast(t('mod.added').replace('{name}', name), 'success');
    await refreshMods();
  } catch (err) {
    toast(t('common.error') + ' : ' + err, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

async function toggleAllMods(forcedEnable = null) {
  const currentStatus = getToggleAllStatus();
  // If forcedEnable is null, use currentStatus, else user clicked a specific sub-button
  const enable = (forcedEnable === null) ? (currentStatus === 'enable') : forcedEnable;

  const targetMods = enable ? S.allMods.filter(m => !m.enabled) : S.allMods.filter(m => m.enabled);
  if (targetMods.length === 0) return;

  // Add all target mods to processing set
  S.isGlobalProcessing = true;
  targetMods.forEach(m => {
    S.processingMods.add(m.id);
    setModLoading(m.id, true);
  });

  const btn = document.getElementById('btn-enable-all');
  const altBtn = document.getElementById('btn-disable-all-alt');
  const originalHtml = btn.innerHTML;

  btn.disabled = true;
  if (altBtn) altBtn.disabled = true;

  btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;margin-right:6px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> ${enable ? 'Activation...' : 'Désactivation...'}`;

  try {
    await invoke('toggle_all_mods', { enable });
    await refreshMods();
    const key = enable ? 'mod.enabledCount' : 'mod.disabledCount';
    toast(t(key).replace('{count}', targetMods.length), 'success');
  } catch (err) {
    toast(t('common.error') + ' : ' + err, 'error');
  } finally {
    targetMods.forEach(m => setModLoading(m.id, false));
    await new Promise(r => setTimeout(r, 250));
    targetMods.forEach(m => S.processingMods.delete(m.id));
    S.isGlobalProcessing = false;
    btn.disabled = false;
    if (altBtn) altBtn.disabled = false;
    btn.innerHTML = originalHtml;
    await refreshMods();
  }
}

function getToggleAllStatus() {
  const enabledCount = S.allMods.filter(m => m.enabled).length;
  // If some are disabled, main action is to ENABLE all
  return (enabledCount < S.allMods.length && S.allMods.length > 0) ? 'enable' : 'disable';
}

function updateToggleAllBtn() {
  const btn = document.getElementById('btn-enable-all');
  const container = document.getElementById('enable-all-container');
  if (!btn) return;

  const status = getToggleAllStatus();
  const label = btn.querySelector('span');
  const svg = btn.querySelector('svg');

  // Logic: 
  // - If some mods are disabled: Main action is "Enable All", Dropdown shows "Disable All"
  // - If ALL mods are enabled: Main action becomes "Disable All", no need for dropdown/split

  const allEnabled = S.allMods.length > 0 && S.allMods.every(m => m.enabled);

  if (allEnabled) {
    if (label) label.innerHTML = t('lib.disableAll');
    if (svg) svg.innerHTML = '<path d="M18 6L6 18M6 6l12 12" /><circle cx="12" cy="12" r="10" />';
    btn.className = 'btn btn-ghost btn-split-main';
    btn.style.color = 'var(--danger)';
    if (container) container.classList.add('all-enabled');
  } else {
    if (label) label.innerHTML = t('lib.enableAll');
    if (svg) svg.innerHTML = '<path d="m5 12 5 5L20 7" /><circle cx="12" cy="12" r="10" />';
    btn.className = 'btn btn-primary btn-split-main';
    btn.style.color = '';
    if (container) container.classList.remove('all-enabled');
  }
}

async function openArchiveExplorer(mod) {
  window._currentExplorerModId = mod.id;
  const modal = document.getElementById('modal-archive-explorer');
  const searchInput = document.getElementById('archive-explorer-search');
  if (searchInput) {
    searchInput.value = '';
    searchInput.placeholder = t('ctx.searchPlaceholder');
  }
  const container = document.getElementById('archive-explorer-content');
  container.innerHTML = `
    <div style="text-align:center;padding:40px;color:var(--text-muted)">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;margin-bottom:12px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
      <br>Scan en cours...
    </div>`;

  modal.classList.add('open');

  try {
    const files = await invoke('list_mod_files_recursive', { modId: mod.id });
    if (files.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:40px;">${t('lib.emptyTitle')}</div>`;
      return;
    }

    // Build the tree
    const tree = buildFileTree(files);
    const treeHtml = renderTree(tree);

    container.innerHTML = `<div class="tree-container">${treeHtml}</div>`;

    // Setup interactions
    setupTreeInteractions(mod);

  } catch (err) {
    container.innerHTML = `<div style="color:var(--danger);padding:20px;">${err}</div>`;
  }
}

function buildFileTree(files) {
  const root = {};
  files.sort().forEach(f => {
    const parts = f.split(/[/\\]/);
    let current = root;
    parts.forEach((part, i) => {
      if (!current[part]) {
        current[part] = {
          _isFolder: i < parts.length - 1,
          _fullPath: f,
          _relPath: parts.slice(0, i + 1).join('\\'),
          children: {}
        };
      }
      current = current[part].children;
    });
  });
  return root;
}

function renderTree(nodes) {
  let html = '';
  // Sort folders first, then alphabetically
  const keys = Object.keys(nodes).sort((a, b) => {
    if (nodes[a]._isFolder && !nodes[b]._isFolder) return -1;
    if (!nodes[a]._isFolder && nodes[b]._isFolder) return 1;
    return a.localeCompare(b);
  });

  keys.forEach(key => {
    const node = nodes[key];
    const isFolder = node._isFolder;
    const arrow = isFolder ? `
      <span class="tree-node-arrow">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </span>` : '<span style="width:16px"></span>';

    const icon = isFolder ? `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
    ` : `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    `;

    html += `
      <div class="tree-node ${isFolder ? 'collapsed' : ''}" data-path="${escAttr(node._relPath)}" data-full="${escAttr(node._fullPath)}" data-type="${isFolder ? 'folder' : 'file'}">
        ${arrow}
        <span class="tree-node-icon">${icon}</span>
        <span class="tree-node-label">${escHtml(key)}</span>
      </div>
    `;

    if (isFolder) {
      html += `<div class="tree-children">${renderTree(node.children)}</div>`;
    }
  });
  return html;
}

function setupTreeInteractions(mod) {
  const container = document.getElementById('archive-explorer-content');
  const ctxMenu = document.getElementById('archive-context-menu');
  let selectedNode = null;

  // Toggle folders
  container.querySelectorAll('.tree-node[data-type="folder"]').forEach(node => {
    node.addEventListener('click', (e) => {
      node.classList.toggle('collapsed');
      // Highlight selection
      container.querySelectorAll('.tree-node').forEach(n => n.classList.remove('selected'));
      node.classList.add('selected');
      selectedNode = node;
    });
  });

  // Highlight files
  container.querySelectorAll('.tree-node[data-type="file"]').forEach(node => {
    node.addEventListener('click', () => {
      container.querySelectorAll('.tree-node').forEach(n => n.classList.remove('selected'));
      node.classList.add('selected');
      selectedNode = node;
    });
  });

  // Right click
  container.querySelectorAll('.tree-node').forEach(node => {
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      selectedNode = node;

      // Highlight
      container.querySelectorAll('.tree-node').forEach(n => n.classList.remove('selected'));
      node.classList.add('selected');

      const x = e.clientX;
      const y = e.clientY;

      ctxMenu.style.top = y + 'px';
      ctxMenu.style.left = x + 'px';
      ctxMenu.style.display = 'block';

      // Ensure it stays in viewport
      const box = ctxMenu.getBoundingClientRect();
      if (box.right > window.innerWidth) ctxMenu.style.left = (x - box.width) + 'px';
      if (box.bottom > window.innerHeight) ctxMenu.style.top = (y - box.height) + 'px';

      e.stopPropagation(); // Avoid immediate dismissal if using bubble
    });
  });
}

// Global Context Menu Handlers
document.addEventListener('DOMContentLoaded', () => {
  const ctxMenu = document.getElementById('archive-context-menu');
  const searchInput = document.getElementById('archive-explorer-search');
  if (!ctxMenu) return;

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const val = e.target.value.toLowerCase();
      const nodes = document.querySelectorAll('.tree-node');
      nodes.forEach(node => {
        const label = node.querySelector('.tree-node-label').textContent.toLowerCase();
        const path = node.dataset.path.toLowerCase();
        const isMatch = label.includes(val) || path.includes(val);

        node.style.display = isMatch ? 'flex' : 'none';

        // If it's a file and match, show parents
        if (isMatch && node.dataset.type === 'file') {
          let parent = node.parentElement.previousElementSibling;
          while (parent && parent.classList.contains('tree-node')) {
            parent.style.display = 'flex';
            parent.classList.remove('collapsed');
            parent = parent.parentElement.previousElementSibling;
          }
        }
      });
    });
  }

  // GLOBAL DISMISS for right click menu
  document.addEventListener('mousedown', (e) => {
    if (!ctxMenu.contains(e.target)) {
      ctxMenu.style.display = 'none';
    }
  });

  document.getElementById('ctx-open-file').addEventListener('click', async () => {
    const selected = document.querySelector('.tree-node.selected');
    if (!selected || selected.dataset.type !== 'file') return;
    const relPath = selected.dataset.path;
    ctxMenu.style.display = 'none';
    try {
      await invoke('open_mod_file_at', { modId: window._currentExplorerModId, relativePath: relPath });
    } catch (e) { toast(e, 'error'); }
  });

  document.getElementById('ctx-open-folder').addEventListener('click', async () => {
    const selected = document.querySelector('.tree-node.selected');
    if (!selected) return;
    const relPath = selected.dataset.path;
    ctxMenu.style.display = 'none';
    try {
      await invoke('open_mod_folder_at', { modId: window._currentExplorerModId, relativePath: relPath });
    } catch (e) { toast(e, 'error'); }
  });

  document.getElementById('ctx-copy-path').addEventListener('click', () => {
    const selected = document.querySelector('.tree-node.selected');
    if (!selected) return;
    const path = selected.dataset.path;
    navigator.clipboard.writeText(path);
    toast('Chemin copié', 'success');
    ctxMenu.style.display = 'none';
  });
});

window.openGlobalConflictModal = async function(preselectModId = null) {
  const modal = document.getElementById('modal-global-conflicts');
  const container = document.getElementById('global-conflicts-list');
  const searchInput = document.getElementById('global-conflict-search');
  const profileFilter = document.getElementById('global-conflict-profile-filter');
  const typeFilter = document.getElementById('global-conflict-type-filter');
  const sortSelect = document.getElementById('global-conflict-sort-order');
  const closeBtn = document.getElementById('btn-close-global-conflicts');

  try {
    const activeId = await invoke('get_active_profile_id').catch(() => null);
    if (!activeId) return toast(t('prof.noneActive'), 'error');

    modal.classList.add('open');
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg><br>'+(t('conflict.loading')||'Analyse des conflits...')+'</div>';

    let allConflicts = [];
    Object.keys(S.conflictCache).forEach(mid => {
       const reports = S.conflictCache[mid];
       if (reports && reports.length > 0) {
          const mod = S.allMods.find(m => m.id === mid);
          const modName = mod?.name || mid;
          const activationOrder = mod?.activation_order ?? -1;
          allConflicts.push({ sourceModId: mid, sourceModName: modName, reports, activationOrder });
       }
    });

    // Prioritize preselected mod ONLY on first load (no sorting yet)
    if (preselectModId) {
      const idx = allConflicts.findIndex(c => c.sourceModId === preselectModId);
      if (idx > -1) {
        const [target] = allConflicts.splice(idx, 1);
        allConflicts.unshift(target);
      }
    }

    const profiles = await invoke('get_profiles');
    profileFilter.innerHTML = `<option value="all">${t('conflict.allProfiles') || 'Tous les profils'}</option>` + profiles.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');

    const renderList = (respectPrioritization = false) => {
      const q = searchInput.value.toLowerCase();
      const p = profileFilter.value;
      const tFilter = typeFilter.value;
      const sortBy = sortSelect.value;

      // Sort logic
      if (!respectPrioritization || !preselectModId) {
        allConflicts.sort((a, b) => {
           if (sortBy === 'asc') return a.activationOrder - b.activationOrder;
           return b.activationOrder - a.activationOrder;
        });
      }

      let html = '';
      allConflicts.forEach(item => {
        let filteredReports = item.reports;
        if (tFilter !== 'all') {
           filteredReports = filteredReports.filter(r => r.category.toLowerCase() === tFilter.toLowerCase());
        }
        if (p !== 'all') {
           const pName = profiles.find(pr => pr.id === p)?.name || '';
           filteredReports = filteredReports.filter(r => r.other_profile_name === pName);
        }
        
        if (q) {
           const sourceMatch = item.sourceModName.toLowerCase().includes(q);
           if (!sourceMatch) {
              filteredReports = filteredReports.filter(r => r.other_mod_name.toLowerCase().includes(q));
           }
        }

        if (filteredReports.length === 0) return;

        // Group by profile
        const groups = {};
        filteredReports.forEach(r => {
           if (!groups[r.other_profile_name]) groups[r.other_profile_name] = [];
           groups[r.other_profile_name].push(r);
        });

        const targetsHtml = Object.keys(groups).map(pName => {
           const grps = groups[pName];
           
           // Sort by activation order for active mods
           grps.sort((a,b) => a.activation_order - b.activation_order);
           
           return `
             <div style="margin-top:6px">
               <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;font-weight:600">${escHtml(pName)}</div>
               <div style="display:flex;flex-direction:column;gap:4px">
                 ${grps.map(r => `
                   <div style="display:flex;align-items:center;background:rgba(0,0,0,0.3);padding:6px 10px;border-radius:6px;border-left:3px solid ${r.status === 'Active' ? 'var(--danger)' : 'var(--warning)'};justify-content:space-between">
                     <span style="font-size:12px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px" title="${escAttr(r.other_mod_name)}">${escHtml(r.other_mod_name)}</span>
                     <div style="display:flex;align-items:center;gap:10px">
                       ${r.status === 'Active' ? `<span style="font-size:9px;background:rgba(255,255,255,0.1);color:var(--text-primary);padding:2px 5px;border-radius:4px" title="Ordre d activation">#${r.activation_order}</span>` : ''}
                       <span style="font-size:10px;font-family:var(--font-mono);color:var(--text-muted);cursor:pointer;text-decoration:underline" onclick="window.showConflictContextMenu(event, '${item.sourceModId}', '${r.other_mod_id}')">${r.file_count} f.</span>
                       <span style="font-size:9px;font-weight:900;padding:2px 6px;border-radius:12px;text-transform:uppercase;color:${r.status==='Active'?'var(--danger)':'var(--warning)'};border:1px solid ${r.status==='Active'?'var(--danger)':'var(--warning)'}">${r.status === 'Active' ? (t('conflict.active')||'ACTIF') : (t('conflict.potential')||'POTENTIEL')}</span>
                     </div>
                   </div>
                 `).join('')}
               </div>
             </div>
           `;
        }).join('');

        html += `
          <div class="conflict-group-card" style="display:flex;background:rgba(0,0,0,0.2);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:10px;height:95px">
             <div style="flex:1;padding:10px 12px;border-right:1px solid var(--border);background:rgba(255,255,255,0.02);display:flex;flex-direction:column;justify-content:center">
               <div style="font-weight:600;font-size:12px;color:var(--text-primary);margin-bottom:2px;line-height:1.2;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${escHtml(item.sourceModName)}</div>
               <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">${t('conflict.modSource') || 'Mod Source'}</div>
             </div>
             <div style="flex:2;padding:8px 12px;overflow-y:auto;background:rgba(0,0,0,0.1)">
               ${targetsHtml}
             </div>
          </div>
        `;
      });
      container.innerHTML = html || `<div style="padding:40px;text-align:center;color:var(--text-muted)">${t('conflict.empty') || 'Aucun conflit.'}</div>`;
    };

    renderList(true); // Initial render respects prioritization

    searchInput.oninput = () => renderList(false);
    profileFilter.onchange = () => renderList(false);
    typeFilter.onchange = () => renderList(false);
    sortSelect.onchange = () => renderList(false);
    
    // Explicit close button wiring
    if (closeBtn) {
      closeBtn.onclick = () => modal.classList.remove('open');
    }

    if (preselectModId) {
      setTimeout(() => {
        searchInput.value = S.allMods.find(m => m.id === preselectModId)?.name || '';
        renderList(true); // Re-render with text filter but still prioritized
      }, 100);
    }

  } catch (err) {
    container.innerHTML = '<div style="color:var(--danger)">'+err+'</div>';
  }
};

window.showConflictContextMenu = async function(e, mod1Id, mod2Id) {
  e.preventDefault();
  const ctx = document.getElementById('conflict-context-menu');
  if (!ctx) return;
  
  ctx.style.display = 'block';
  ctx.style.left = e.pageX + 'px';
  ctx.style.top = e.pageY + 'px';
  
  const btn = document.getElementById('ctx-open-explorer');
  btn.onclick = async () => {
    ctx.style.display = 'none';
    const modal = document.getElementById('modal-conflict-tree');
    const container = document.getElementById('conflict-tree-container');
    const btnConfirm = document.getElementById('btn-confirm-conflict-tree');
    if (btnConfirm) btnConfirm.style.display = 'none';
    
    modal.style.zIndex = '10005'; // Ensure it opens above the global conflict modal
    modal.classList.add('open');
    container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted)">${t('conflict.loadingTree')||"Chargement de l'arbre..."}</div>`;
    
    try {
      const files = await invoke('get_conflict_file_tree', { modId: mod1Id, otherModId: mod2Id });
      if (files.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted)">${t('conflict.noTreeFiles')||"Aucun fichier conflictuel direct trouvé."}</div>`;
        return;
      }
      container.innerHTML = files.map(f => `<div style="padding:4px;border-bottom:1px solid rgba(255,255,255,0.05);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escAttr(f)}">${escHtml(f)}</div>`).join('');
    } catch (err) {
      container.innerHTML = `<span style="color:var(--danger)">${t('common.error')||"Erreur"}: ${err}</span>`;
    }
  };
  
  document.addEventListener('mousedown', function hideCtx(ev) {
    if (!ctx.contains(ev.target)) {
      ctx.style.display = 'none';
      document.removeEventListener('mousedown', hideCtx);
    }
  });
};

window.showActivationWarning = function(modId, conflicts, onConfirm) {
  const modal = document.getElementById('modal-activation-warning');
  const list = document.getElementById('activation-warning-list');
  const btn = document.getElementById('btn-confirm-activation-anyway');
  const cancelBtn = document.getElementById('btn-cancel-activation-warning');
  const orderPanel = document.getElementById('activation-order-panel');
  const orderList = document.getElementById('activation-order-list');
  
  list.innerHTML = conflicts.map(c => `
    <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(0,0,0,0.3);padding:8px 12px;border-radius:6px;border-left:3px solid ${c.status === 'Active' ? 'var(--danger)' : 'var(--warning)'}">
      <div style="flex:1;min-width:0;padding-right:10px">
        <div style="font-size:12px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escAttr(c.other_mod_name)}">${escHtml(c.other_mod_name)}</div>
        <div style="font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(c.other_profile_name)}</div>
      </div>
      <div style="font-size:10px;font-weight:900;padding:2px 6px;border-radius:12px;color:${c.status==='Active'?'var(--danger)':'var(--warning)'};border:1px solid ${c.status==='Active'?'var(--danger)':'var(--warning)'};flex-shrink:0">
        ${c.status === 'Active' ? (t('conflict.active')||'ACTIF') : (t('conflict.potential')||'POTENTIEL')}
      </div>
    </div>
  `).join('');
  
  // Activation order panel (only for active conflicts)
  const activeConflicts = conflicts.filter(c => c.status === 'Active');
  if (activeConflicts.length > 0) {
    activeConflicts.sort((a, b) => a.activation_order - b.activation_order);
    orderList.innerHTML = activeConflicts.map((c, i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;background:rgba(255,255,255,0.04)">
        <span style="font-size:10px;background:rgba(255,255,255,0.12);color:var(--text-primary);padding:1px 6px;border-radius:4px;font-weight:700;flex-shrink:0">#${c.activation_order}</span>
        <span style="font-size:11px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escAttr(c.other_mod_name)}">${escHtml(c.other_mod_name)}</span>
        <span style="font-size:9px;color:var(--text-muted);flex-shrink:0">${escHtml(c.other_profile_name)}</span>
      </div>
    `).join('');
    orderPanel.style.display = '';
  } else {
    orderPanel.style.display = 'none';
  }
  
  btn.onclick = () => {
    modal.classList.remove('open');
    onConfirm();
  };
  
  if (cancelBtn) {
    cancelBtn.onclick = () => modal.classList.remove('open');
  }
  
  modal.classList.add('open');
};

// Wire up close buttons for global conflicts modal and conflict tree modal
function wireConflictButtons() {
  const btnCloseGlobal = document.getElementById('btn-close-global-conflicts');
  if (btnCloseGlobal) {
    btnCloseGlobal.onclick = () => {
      document.getElementById('modal-global-conflicts')?.classList.remove('open');
    };
  }

  const btnCloseTree = document.getElementById('btn-close-conflict-tree');
  if (btnCloseTree) {
    btnCloseTree.onclick = () => {
      document.getElementById('modal-conflict-tree')?.classList.remove('open');
    };
  }
}

// Call it immediately and also on DOMContentLoaded just in case
wireConflictButtons();
document.addEventListener('DOMContentLoaded', wireConflictButtons);


