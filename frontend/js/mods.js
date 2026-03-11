/**
 * mods.js — Mod library management with detail panel + scan + edit
 */
import { invoke, pickFolder, listenFileDrop, toast, sendOsNotification } from './app.js';
import { renderProfiles } from './profiles.js';
import { t, applyTranslations } from './i18n.js';
import { escHtml, escAttr } from './utils.js';
import { getModCardHTML, getModDetailHTML } from './components.js';
import { appState } from './state.js';

const S = new Proxy(appState.state, {
  get(target, prop) { return target[prop]; },
  set(target, prop, value) { appState.set(prop, value); return true; }
});









let refreshTimeout = null;

let ghostFilteredMods = []; // Cache for virtualization
let lastStartIndex = -1;
let lastEndIndex = -1;

export async function initMods() {
  window._refreshModsFn = refreshMods;
  document.getElementById('btn-add-mod').addEventListener('click', openAddModModal);
  document.getElementById('btn-confirm-add-mod').addEventListener('click', confirmAddMod);
  document.getElementById('btn-enable-all').addEventListener('click', () => toggleAllMods());

  const viewBtn = document.getElementById('btn-view-mode');
  const modlist = document.getElementById('mod-list');
  const scrollContainer = document.querySelector('.content-area');

  if (S.isCompact) modlist.classList.add('compact');

  viewBtn.addEventListener('click', () => {
    S.isCompact = !S.isCompact;
    localStorage.setItem('bmm-view-compact', S.isCompact);
    modlist.classList.toggle('compact', S.isCompact);
    renderModList(); // Re-render with new heights
    toast(S.isCompact ? 'Mode compact activé' : 'Mode standard activé', 'info', 1500);
  });

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

  document.getElementById('btn-pick-mod-folder').addEventListener('click', async () => {
    const path = await pickFolder();
    if (path) {
      document.getElementById('mod-folder').value = path;
      const nameInput = document.getElementById('mod-name');
      if (!nameInput.value) {
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
      renderModList();
      
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
    renderModList();
  });

  // History Modal
  const historyBtn = document.getElementById('btn-show-history');
  if (historyBtn) {
    historyBtn.addEventListener('click', async () => {
      const activeId = await invoke('get_active_profile_id').catch(() => null);
      if (!activeId) {
        toast('Aucun profil actif.', 'error');
        return;
      }
      try {
        const history = await invoke('get_activity_history', { profileId: activeId });
        renderHistoryModal(history);
      } catch (err) {
        toast('Erreur historique : ' + err, 'error');
      }
    });
  }

  // Sort
  const sortSelect = document.getElementById('mod-sort');
  if (sortSelect) {
    sortSelect.addEventListener('change', async e => {
      S.currentSort = e.target.value;
      renderModList();
      
      // Save setting
      try {
        const settings = await invoke('get_settings');
        settings.current_sort_by = S.currentSort;
        await invoke('update_settings', { settings });
      } catch (e) { console.error("Failed to save sort setting:", e); }
    });
  }

  // File Drop
  listenFileDrop(paths => {
    // Check if Library view is active
    const libView = document.getElementById('view-library');
    if (!libView || !libView.classList.contains('active')) return;

    // Check if an existing modal is already open
    if (document.querySelector('.modal-overlay.open')) return;

    if (paths && paths.length > 0) {
      const path = paths[0]; // Take first dropped file/folder
      openAddModModal();
      document.getElementById('mod-folder').value = path;
      const nameInput = document.getElementById('mod-name');
      const parts = path.replace(/\\/g, '/').split('/');
      nameInput.value = parts[parts.length - 1] || '';
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
  if (S.selectedModId) {
    const m = S.allMods.find(mod => mod.id === S.selectedModId);
    if (m) renderModDetail(m);
    else closeModDetail();
  }

  // Background check for conflicts
  checkAllConflicts();
}

async function checkAllConflicts() {
  const activeId = await invoke('get_active_profile_id').catch(() => null);
  if (!activeId) return;

  // Check in parallel to be faster
  const results = await Promise.allSettled(S.allMods.map(m => invoke('check_conflicts', { modId: m.id })));

  results.forEach((res, idx) => {
    const mid = S.allMods[idx].id;
    if (res.status === 'fulfilled' && res.value && res.value.length > 0) {
      S.conflictCache[mid] = res.value;
    } else {
      delete S.conflictCache[mid];
    }
  });

  renderModList();
}

export function refreshMods(autoScan = false, immediate = false) {
  if (refreshTimeout) {
    clearTimeout(refreshTimeout);
    refreshTimeout = null;
  }

  const doRefresh = async () => {
    // Prevent autoScan if any mod is still processing to avoid "spam refresh"
    if (autoScan && S.processingMods.size === 0) {
      try { await invoke('scan_mods_folder'); } catch (e) { }
    }

    try {
      S.userTags = await invoke('get_tags').catch(() => []);
      S.allMods = await invoke('get_mods').catch(() => []);

      const activeId = await invoke('get_active_profile_id').catch(() => null);
      if (activeId) {
        // Optimization: only check conflicts for enabled mods or the currently selected one
        const modsToCheck = S.allMods.filter(m => m.enabled || m.id === S.selectedModId);
        const results = await Promise.allSettled(modsToCheck.map(m => invoke('check_conflicts', { modId: m.id })));

        // Clear conflict cache and then fill with new results
        S.conflictCache = {};

        results.forEach((res, idx) => {
          const mod = modsToCheck[idx];
          if (mod && res.status === 'fulfilled' && res.value && res.value.length > 0) {
            S.conflictCache[mod.id] = res.value;
          }
        });
      }
    } catch (err) {
      S.allMods = [];
    }

    updateBadge();
    updateSubtitle();
    updateToggleAllBtn();
    try { renderProfiles(); } catch (e) { }

    renderModList(); // Single final render

    if (S.selectedModId) {
      renderModDetail(S.selectedModId);
    }
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
  el.textContent = total === 0
    ? 'Ajoutez votre premier mod.'
    : `${enabled} actif${enabled !== 1 ? 's' : ''} sur ${total} mod${total !== 1 ? 's' : ''}`;
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
    list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px" data-i18n="history.empty">Aucun historique disponible.</div>';
    import('./i18n.js').then(m => m.applyTranslations());
  } else {
    // sort newest first
    history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    history.forEach(item => {
      const isEnabled = item.action === 'Enabled';
      const color = isEnabled ? 'var(--success)' : 'var(--text-muted)';
      const actionText = isEnabled ? 'ACTIF' : 'INACTIF';
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

async function renderModList() {
  const list = document.getElementById('mod-list');
  const viewport = document.getElementById('mod-list-viewport');
  const spacer = document.getElementById('mod-list-spacer');
  const empty = document.getElementById('empty-mods');

  if (!list || !viewport || !empty) return;

  let activeId = null;
  try {
    activeId = await invoke('get_active_profile_id');
    if (!activeId) {
      viewport.innerHTML = '';
      if (spacer) spacer.style.height = '0px';
      empty.style.display = 'none';

      let noProf = document.getElementById('empty-no-profile');
      if (!noProf) {
        noProf = document.createElement('div');
        noProf.id = 'empty-no-profile';
        noProf.className = 'empty-state';
        noProf.style.padding = '60px 20px';
        noProf.innerHTML = `
          <div class="empty-icon" style="margin-bottom:24px; opacity:0.6">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
              <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
            </svg>
          </div>
          <h3 data-i18n="lib.noProfileTitle" style="font-size:22px; margin-bottom:12px; font-weight:700">Aucun profil actif</h3>
          <p data-i18n="lib.noProfileDesc" style="color:var(--text-secondary); max-width:420px; margin:0 auto 32px; line-height:1.6">Veuillez sélectionner ou créer un profil pour gérer vos mods.</p>
          <div style="display:flex; justify-content:center; gap:16px;">
            <button class="btn btn-primary" onclick="document.getElementById('nav-profiles').click(); document.getElementById('btn-new-profile').click();" style="padding:12px 24px; font-size:14px">
              <span data-i18n="prof.create">Créer un profil</span>
            </button>
            <button class="btn btn-secondary" onclick="document.getElementById('nav-profiles').click(); document.getElementById('btn-import-ovgme').click();" style="padding:12px 24px; font-size:14px">
              <span data-i18n="prof.importOvgme">Importer OvGME</span>
            </button>
          </div>
        `;
        list.appendChild(noProf);
        applyTranslations(noProf);
      } else {
        noProf.style.display = '';
      }
      return;
    }

    if (document.getElementById('empty-no-profile')) {
      document.getElementById('empty-no-profile').style.display = 'none';
    }
  } catch (e) { return; }

  const mods = getFilteredMods();

  if (mods.length === 0) {
    viewport.innerHTML = '';
    if (spacer) spacer.style.height = '0px';
    empty.style.display = '';
    return;
  }

  empty.style.display = 'none';
  if (spacer) spacer.style.height = '0px';
  viewport.style.transform = 'translateY(0px)';

  // Safely detach detail panel if it exists so we don't lose its state
  const existingPanel = document.getElementById('mod-detail-panel');
  let activeEl = null;
  let selStart = null;
  let selEnd = null;

  if (existingPanel) {
    if (document.activeElement && existingPanel.contains(document.activeElement)) {
      activeEl = document.activeElement;
      if (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') {
        try {
          selStart = activeEl.selectionStart;
          selEnd = activeEl.selectionEnd;
        } catch (e) { }
      }
    }
    existingPanel.remove();
  }

  // Preserve DOM nodes instead of destroying them to prevent layout flashing
  const existingMap = new Map();
  Array.from(viewport.children).forEach(c => {
    if (c.dataset && c.dataset.id) existingMap.set(c.dataset.id, c);
  });

  let i = 0;
  for (const mod of mods) {
    let card = existingMap.get(mod.id);

    if (!card) {
      card = createModCard(mod);
    } else {
      // Gently update existing card without modifying innerHTML to preserve event listeners
      card.className = `mod-card ${mod.enabled ? 'enabled' : 'disabled'} ${S.selectedModId === mod.id ? 'selected' : ''}`;

      const toggle = card.querySelector('.mod-toggle-input');
      if (toggle && toggle.checked !== !!mod.enabled) toggle.checked = !!mod.enabled;

      // Update name and meta
      const nameEl = card.querySelector('.mod-name');
      if (nameEl && nameEl.textContent !== mod.name) nameEl.textContent = mod.name;

      const metaEl = card.querySelector('.mod-meta');
      if (metaEl) {
        // Since meta, tags and description are complex, we selectively update or use innerHTML here if it changed
        // To be safe and fast, we check if anything besides the toggle/processing changed
        const versionStr = `v${mod.version}`;
        const versionEl = metaEl.querySelector('.mono');
        if (versionEl && versionEl.textContent !== versionStr) versionEl.textContent = versionStr;

        // For author/desc/tags, simpler to rebuild this small part if needed or just re-run the component helper for the meta part
        // But to keep it "gentle", let's just update the meta container if the data is different
        // actually, let's just update the text content of specific spans if we can find them,
        // or just accept a small innerHTML update for the meta div only.
        const tagsHtml = mod.tags && mod.tags.length > 0 ? mod.tags.slice(0, 3).map(tid => {
          const tDef = S.userTags.find(t => t.id === tid);
          return tDef ? `<span style="background:${tDef.color}15;color:${tDef.color};border:1px solid ${tDef.color}30;padding:1px 5px;border-radius:4px;font-size:9px;font-weight:600">${escHtml(tDef.name)}</span>` : '';
        }).join('') : '';

        const newMetaHtml = `
          <span class="mono" style="color: var(--cyan)">v${escHtml(mod.version)}</span>
          ${mod.author ? `<span>· ${escHtml(mod.author)}</span>` : ''}
          ${tagsHtml && mod.tags.length > 3 ? `<div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap">${tagsHtml}<span style="color:var(--text-muted);font-size:9px;align-self:center">+${mod.tags.length - 3}</span></div>` : tagsHtml ? `<div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap">${tagsHtml}</div>` : ''}
        `;
        // Only update DOM if HTML changed to avoid unnecessary reflows
        if (metaEl.dataset.lastHtml !== newMetaHtml) {
          metaEl.innerHTML = newMetaHtml;
          metaEl.dataset.lastHtml = newMetaHtml;
        }
      }

      const statusPill = card.querySelector('.mod-status-pill');
      if (statusPill) {
        statusPill.className = `mod-status-pill ${mod.enabled ? 'enabled' : 'disabled'}`;
        statusPill.style.background = mod.enabled ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)';
        statusPill.style.color = mod.enabled ? 'var(--success)' : 'var(--text-muted)';
        statusPill.textContent = mod.enabled ? 'ACTIF' : 'INACTIF';
      }

      // Update conflict badge safely
      const hasConflict = !!(S.conflictCache[mod.id] && S.conflictCache[mod.id].length > 0);
      const modInfo = card.querySelector('.mod-info');
      const nameRow = modInfo ? modInfo.firstElementChild : null;
      if (nameRow) {
        const conflictBadge = nameRow.querySelector('.conflict-badge');
        if (hasConflict && !conflictBadge) {
          nameRow.insertAdjacentHTML('beforeend', `<div class="conflict-badge" style="background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid rgba(239,68,68,0.4);font-size:9px;font-weight:900;padding:1px 5px;border-radius:4px;letter-spacing:0.4px;text-transform:uppercase">Conflict</div>`);
        } else if (!hasConflict && conflictBadge) {
          conflictBadge.remove();
        }
      }

      // Update Shared Info
      let sharedInfo = card.querySelector('.mod-shared-info');
      const hasShared = mod.shared_activations && mod.shared_activations.length > 1;

      if (hasShared) {
        const subHtml = mod.shared_activations.map(sa => `
          <div class="shared-activation-item" style="display:flex; align-items:center; gap:8px; font-size:10.5px; opacity:${sa.active ? '1' : '0.4'}" title="${escAttr(sa.profile_name)}\n${escAttr(sa.game_path)}">
            <div style="width:8px; height:8px; border-radius:50%; background:${sa.active ? 'var(--success)' : 'var(--text-muted)'}; flex-shrink:0; box-shadow:${sa.active ? '0 0 6px var(--success)' : 'none'}"></div>
            <div style="display:flex; flex-direction:column; min-width:0; flex:1">
              <span style="font-weight:600; color:${sa.active ? 'var(--text-primary)' : 'var(--text-muted)'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${escHtml(sa.profile_name)}</span>
              <span style="font-size:9px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-family:var(--font-mono)">${escHtml(sa.game_path)}</span>
            </div>
          </div>
        `).join('');

        if (!sharedInfo) {
           card.innerHTML = getModCardHTML(mod, { selectedModId: S.selectedModId, conflictCache: S.conflictCache, processingMods: S.processingMods, userTags: S.userTags });
        } else {
           if (sharedInfo.dataset.lastSharedHtml !== subHtml) {
             sharedInfo.innerHTML = subHtml;
             sharedInfo.dataset.lastSharedHtml = subHtml;
           }
        }
      } else if (sharedInfo) {
        sharedInfo.remove();
      }

      // Update processing overlay safely
      const isProcessing = S.processingMods.has(mod.id);
      const overlay = card.querySelector('.mod-loading-overlay');
      if (isProcessing && !overlay) {
        card.insertAdjacentHTML('beforeend', `<div class="mod-loading-overlay" style="position:absolute;inset:0;background:rgba(15,23,42,0.6);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;border-radius:var(--radius-card);z-index:10;animation:fadeIn 0.2s ease"><div style="display:flex;flex-direction:column;align-items:center;gap:10px"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></div></div>`);
      } else if (!isProcessing && overlay) {
        overlay.remove();
      }
    }

    if (existingPanel && mod.id === S.selectedModId) {
      card.appendChild(existingPanel);
    }

    // Ensure card is in the correct DOM position safely
    if (viewport.children[i] !== card) {
      viewport.insertBefore(card, viewport.children[i] || null);
    }
    i++;
  }

  // Remove trailing unused cards
  while (viewport.children.length > mods.length) {
    viewport.lastElementChild.remove();
  }

  // Restore focus if needed
  if (activeEl) {
    setTimeout(() => {
      activeEl.focus();
      try {
        if (selStart !== null && selEnd !== null) activeEl.setSelectionRange(selStart, selEnd);
      } catch (e) { }
    }, 0);
  }
}

function createModCard(mod) {
  const card = document.createElement('div');
  card.className = `mod-card ${mod.enabled ? 'enabled' : 'disabled'} ${S.selectedModId === mod.id ? 'selected' : ''}`;
  card.dataset.id = mod.id;

  const hasConflict = S.conflictCache[mod.id] && S.conflictCache[mod.id].length > 0;

  card.innerHTML = getModCardHTML(mod, { selectedModId: S.selectedModId, conflictCache: S.conflictCache, processingMods: S.processingMods, userTags: S.userTags });

  // Toggle handler
  const toggle = card.querySelector('.mod-toggle-input');
  toggle.addEventListener('change', async () => {
    // Conflict Check (Keep it blocking for safety)
    const conflicts = S.conflictCache[mod.id];
    const ignoreConflicts = localStorage.getItem('bmm_ignore_conflicts') === 'true';

    if (toggle.checked && conflicts && conflicts.length > 0 && !ignoreConflicts) {
      toggle.checked = false;
      const modal = document.getElementById('modal-conflict-warning');
      const listContainer = document.getElementById('conflict-warning-list');
      const msgEl = modal.querySelector('[data-i18n="conflict.warningMsg"]');
      if (msgEl) msgEl.innerHTML = t('conflict.warningMsg', { mods: '' }).replace(': ', '');
      listContainer.innerHTML = conflicts.map(c => `<div style="margin-bottom:4px;color:var(--warning);font-size:13px"><span style="color:var(--text-muted)">></span> ${escHtml(c)}</div>`).join('');
      modal.classList.add('open');

      const confirmBtn = document.getElementById('btn-confirm-conflict-toggle');
      confirmBtn.onclick = () => {
        modal.classList.remove('open');
        if (document.getElementById('conflict-ignore-forever').checked) localStorage.setItem('bmm_ignore_conflicts', 'true');
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));
      };
      return;
    }

    const originalState = !toggle.checked;
    S.processingMods.add(mod.id);
    renderModList(); // Show loading state immediately

    try {
      if (toggle.checked) {
        const warningMsg = await invoke('enable_mod', { modId: mod.id });
        if (warningMsg && warningMsg.startsWith('WARNING_SPACE|')) {
          const parts = warningMsg.split('|');
          toast(t('storage.alertWarningMod', { label: parts[1], free: parts[2], limit: parts[3] }) || `Attention : l'espace sur le disque ${parts[1]} est faible (${parts[2]}% libres, limite à ${parts[3]}%).`, 'warning', 5000);
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
        toast(t('storage.alertCriticalMod', { label: parts[1], free: parts[2], limit: parts[3] }) || `Action bloquée : espace critique sur le disque ${parts[1]} (${parts[2]}% libres, limite à ${parts[3]}%).`, 'error', 6000);
        toggle.checked = false; // Revert visually
      } else {
        toast('Erreur : ' + err, 'error');
        toggle.checked = !toggle.checked; // Revert visually
      }
    } finally {
      S.processingMods.delete(mod.id);
      await refreshMods();
    }
  });

  // Double-click to toggle
  card.addEventListener('dblclick', (e) => {
    // Don't trigger if clicking on an interactive element like a button or switch
    if (e.target.closest('button') || e.target.closest('.mod-toggle') || e.target.closest('input')) return;
    toggle.click();
  });

  // Open folder handler
  const openFolderBtn = card.querySelector('.btn-open-folder');
  if (openFolderBtn) {
    openFolderBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (mod.mod_folder_path) {
        try {
          await invoke('open_folder', { path: mod.mod_folder_path });
        } catch (err) {
          toast('Erreur dossier : ' + err, 'error');
        }
      }
    });
  }

  // Click card to show detail
  card.addEventListener('click', (e) => {
    if (e.target.closest('.mod-toggle') || e.target.closest('.btn-remove-mod') || e.target.closest('.btn-edit-mod') || e.target.closest('.btn-open-folder')) return;
    selectMod(mod.id);
  });

  // Edit button
  card.querySelector('.btn-edit-mod').addEventListener('click', (e) => {
    e.stopPropagation();
    selectMod(mod.id);
  });

  // Remove handler
  card.querySelector('.btn-remove-mod').addEventListener('click', async e => {
    e.stopPropagation();
    if (mod.enabled) {
      toast(t('mod.disableFirst'), 'warning');
      return;
    }

    const modal = document.getElementById('modal-delete-mod');
    const warningText = document.getElementById('delete-mod-warning-text');
    const confirmCheck = document.getElementById('check-delete-confirm');
    const finalBtn = document.getElementById('btn-final-delete-mod');

    if (warningText) {
      warningText.innerHTML = t('mod.deleteWarning', { name: `<strong style="color:var(--text-primary)">${mod.name}</strong>` });
    }
    confirmCheck.checked = false;
    finalBtn.disabled = true;
    finalBtn.style.opacity = '0.5';

    modal.classList.add('open');

    const subButtons = modal.querySelectorAll('.modal-footer .btn');
    const btnRemoveOnly = modal.querySelector('#btn-remove-only-mod');

    // Reset button state
    finalBtn.innerHTML = `<span>${t('lib.delete')}</span>`;
    finalBtn.disabled = true;
    finalBtn.style.opacity = '0.5';
    btnRemoveOnly.disabled = false;
    btnRemoveOnly.innerHTML = `<span>${t('mod.removeOnly')}</span>`;

    // Setup listeners for this specific mod deletion
    const onCheckChange = () => {
      finalBtn.disabled = !confirmCheck.checked;
      finalBtn.style.opacity = confirmCheck.checked ? '1' : '0.5';
    };

    const performDeletion = async (deleteFiles) => {
      const activeBtn = deleteFiles ? finalBtn : btnRemoveOnly;
      const otherBtn = deleteFiles ? btnRemoveOnly : finalBtn;

      try {
        activeBtn.disabled = true;
        otherBtn.disabled = true;
        const originalHtml = activeBtn.innerHTML;
        activeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';

        await invoke('remove_mod', { modId: mod.id, deleteFiles });

        const toastKey = deleteFiles ? 'mod.removed' : 'mod.removedOnly';
        toast(t(toastKey, { name: mod.name }), 'info');

        modal.classList.remove('open');
        if (S.selectedModId === mod.id) closeModDetail();
        await refreshMods();
      } catch (err) {
        toast('Erreur : ' + err, 'error');
      } finally {
        activeBtn.disabled = false;
        otherBtn.disabled = false;
        finalBtn.innerHTML = `<span>${t('lib.delete')}</span>`;
        btnRemoveOnly.innerHTML = `<span>${t('mod.removeOnly')}</span>`;
        onCheckChange(); // Re-sync disabled state based on checkbox
      }
    };

    confirmCheck.onchange = onCheckChange;
    finalBtn.onclick = () => performDeletion(true);
    btnRemoveOnly.onclick = () => performDeletion(false);
  });

  return card;
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
      const conflicts = await invoke('check_conflicts', { modId: mod.id });
      if (conflicts && conflicts.length > 0) {
        // Update the conflict badge in the already rendered panel
        const badgeContainer = panel.querySelector('.conflict-badge-container');
        if (badgeContainer) {
          badgeContainer.innerHTML = `<span class="badge badge-warning" style="font-size:10px">${t('mod.conflictsFound').replace('{n}', conflicts.length)}</span>`;
        }
        // Update the conflict list if present
        const listContainer = panel.querySelector('#detail-conflicts-list');
        if (listContainer) {
          listContainer.innerHTML = conflicts.map(c => `<div style="color:var(--warning);font-size:11px;margin-bottom:2px">• ${escHtml(c)}</div>`).join('');
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

  renderTagsUI();

  // Save button
  panel.querySelector('#btn-save-detail').addEventListener('click', async () => {
    const name = panel.querySelector('#detail-name').value.trim();
    const version = panel.querySelector('#detail-version').value.trim();
    const author = panel.querySelector('#detail-author').value.trim();
    const description = panel.querySelector('#detail-desc').value.trim();
    const tags = mod._currentTags || mod.tags || [];

    try {
      await invoke('update_mod_meta', { modId: mod.id, name, author, description, version, tags });

      // Save download links: remove all, then add new
      const linkRows = panel.querySelectorAll('#detail-links-list > div');
      // First remove existing
      for (let i = (mod.download_links || []).length - 1; i >= 0; i--) {
        await invoke('remove_download_link', { modId: mod.id, linkIndex: i });
      }
      // Then add new
      for (const row of linkRows) {
        const url = row.querySelector('.detail-link-url').value.trim();
        const linkType = row.querySelector('.detail-link-type').value;
        const label = row.querySelector('.detail-link-label').value.trim();
        if (url) {
          await invoke('add_download_link', { modId: mod.id, url, linkType, label });
        }
      }

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
                <option value="google_drive">Google Drive</option>
                <option value="mega">MEGA</option>
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
    document.getElementById(id).value = '';
  });
  document.getElementById('mod-version').value = '1.0.0';

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

  document.getElementById('modal-add-mod').classList.add('open');
}

async function confirmAddMod() {
  const name = document.getElementById('mod-name').value.trim();
  const folder = document.getElementById('mod-folder').value.trim();
  const version = document.getElementById('mod-version').value.trim() || '1.0.0';
  const author = document.getElementById('mod-author').value.trim();
  const description = document.getElementById('mod-desc').value.trim();
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

  try {
    await invoke('add_mod', {
      name,
      modFolderPath: folder,
      author,
      description,
      version,
      tags: tagId ? [tagId] : [],
    });
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
    btn.disabled = false;
    if (altBtn) altBtn.disabled = false;
    btn.innerHTML = originalHtml;
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
    label.innerHTML = t('lib.disableAll');
    svg.innerHTML = '<path d="M18 6L6 18M6 6l12 12" /><circle cx="12" cy="12" r="10" />';
    btn.className = 'btn btn-ghost btn-split-main';
    btn.style.color = 'var(--danger)';
    if (container) container.classList.add('all-enabled');
  } else {
    label.innerHTML = t('lib.enableAll');
    svg.innerHTML = '<path d="m5 12 5 5L20 7" /><circle cx="12" cy="12" r="10" />';
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
