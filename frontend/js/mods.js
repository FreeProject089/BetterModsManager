/**
 * mods.js — Mod library management with detail panel + scan + edit
 */
import { invoke, pickFolder, listenFileDrop, toast, sendOsNotification } from './app.js';
import { renderProfiles } from './profiles.js';
import { t } from './i18n.js';

let allMods = [];
let userTags = [];
let currentFilter = 'all';
let currentSort = 'name_asc';
let searchQuery = '';
let selectedModId = null;
let isModOperationRunning = false;
let conflictCache = {}; // modId -> Array of conflicting mod names

export async function initMods() {
  window._refreshModsFn = refreshMods;
  document.getElementById('btn-add-mod').addEventListener('click', openAddModModal);
  document.getElementById('btn-confirm-add-mod').addEventListener('click', confirmAddMod);
  document.getElementById('btn-enable-all').addEventListener('click', toggleAllMods);

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
    btn.addEventListener('click', e => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      currentFilter = e.currentTarget.dataset.filter;
      renderModList();
    });
  });

  // Search
  document.getElementById('mod-search').addEventListener('input', e => {
    searchQuery = e.target.value.toLowerCase();
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
    sortSelect.addEventListener('change', e => {
      currentSort = e.target.value;
      renderModList();
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
    userTags = await invoke('get_tags').catch(() => []);
    allMods = await invoke('get_mods');
    renderModList();
  } catch (err) {
    console.warn("Could not get mods:", err);
    allMods = [];
  }
  updateBadge();
  updateSubtitle();
  if (selectedModId) {
    const m = allMods.find(mod => mod.id === selectedModId);
    if (m) renderModDetail(m);
    else closeModDetail();
  }

  // Background check for conflicts
  checkAllConflicts();
}

async function checkAllConflicts() {
  const activeId = await invoke('get_active_profile_id').catch(() => null);
  if (!activeId) return;

  for (const mod of allMods) {
    try {
      const conflicts = await invoke('check_conflicts', { modId: mod.id });
      if (conflicts && conflicts.length > 0) {
        conflictCache[mod.id] = conflicts;
      } else {
        delete conflictCache[mod.id];
      }
    } catch (e) { }
  }
  renderModList();
}

export async function refreshMods(autoScan = false) {
  if (autoScan) {
    try {
      await invoke('scan_mods_folder');
    } catch (e) {
      console.warn("Auto-scan error:", e);
    }
  }

  try {
    userTags = await invoke('get_tags');
  } catch (err) { }

  try {
    allMods = await invoke('get_mods');
  } catch (err) {
    console.warn("Could not get mods:", err);
    allMods = [];
  }
  updateBadge();
  renderModList();
  updateSubtitle();
  updateToggleAllBtn();
  checkAllConflicts();

  // Dynamic refresh for profiles to update counts/status
  try {
    renderProfiles();
  } catch (e) { }

  if (selectedModId) {
    const m = allMods.find(mod => mod.id === selectedModId);
    if (m) renderModDetail(m);
    else closeModDetail();
  }
}

function updateBadge() {
  const badge = document.getElementById('badge-library');
  badge.textContent = allMods.length;
  badge.classList.toggle('show', allMods.length > 0);
}

function updateSubtitle() {
  const enabled = allMods.filter(m => m.enabled).length;
  const total = allMods.length;
  const el = document.getElementById('lib-subtitle');
  el.textContent = total === 0
    ? 'Ajoutez votre premier mod.'
    : `${enabled} actif${enabled !== 1 ? 's' : ''} sur ${total} mod${total !== 1 ? 's' : ''}`;
}

function getFilteredMods() {
  let filtered = allMods.filter(m => {
    const matchFilter =
      currentFilter === 'all' ||
      (currentFilter === 'enabled' && m.enabled) ||
      (currentFilter === 'disabled' && !m.enabled);
    // Search also matches tag names
    let matchSearch = !searchQuery || m.name.toLowerCase().includes(searchQuery);
    if (!matchSearch && searchQuery && m.tags && m.tags.length > 0) {
      matchSearch = m.tags.some(tid => {
        const tDef = userTags.find(t => t.id === tid);
        return tDef && tDef.name.toLowerCase().includes(searchQuery);
      });
    }
    return matchFilter && matchSearch;
  });

  filtered.sort((a, b) => {
    if (currentSort === 'name_asc') return a.name.localeCompare(b.name);
    if (currentSort === 'name_desc') return b.name.localeCompare(a.name);
    if (currentSort === 'status') {
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

function renderModList() {
  const list = document.getElementById('mod-list');
  const empty = document.getElementById('empty-mods');
  const mods = getFilteredMods();

  // Remove old mod cards
  Array.from(list.children).forEach(c => {
    if (!c.id.startsWith('empty')) list.removeChild(c);
  });

  if (mods.length === 0) {
    empty.style.display = '';
    return;
  }

  empty.style.display = 'none';

  mods.forEach(mod => {
    const card = createModCard(mod);
    list.appendChild(card);
  });
}

function createModCard(mod) {
  const card = document.createElement('div');
  card.className = `mod-card ${mod.enabled ? 'enabled' : 'disabled'} ${selectedModId === mod.id ? 'selected' : ''}`;
  card.dataset.id = mod.id;

  const hasConflict = conflictCache[mod.id] && conflictCache[mod.id].length > 0;

  card.innerHTML = `
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
        ${hasConflict ? `
          <div style="background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid rgba(239,68,68,0.4);font-size:9px;font-weight:900;padding:1px 5px;border-radius:4px;letter-spacing:0.4px;text-transform:uppercase">Conflict</div>
        ` : ''}
      </div>
      <div class="mod-meta">
        <span class="mono" style="color: var(--cyan)">v${escHtml(mod.version)}</span>
        ${mod.author ? `<span>· ${escHtml(mod.author)}</span>` : ''}
        ${mod.description ? `<span style="color: var(--text-muted)">· ${escHtml(mod.description)}</span>` : ''}
        ${mod.tags?.length > 0 ? `<div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap">
          ${mod.tags.slice(0, 3).map(tid => {
    const tDef = userTags.find(t => t.id === tid);
    if (!tDef) return '';
    return `<span style="background:${tDef.color}15;color:${tDef.color};border:1px solid ${tDef.color}30;padding:1px 5px;border-radius:4px;font-size:9px;font-weight:600">${escHtml(tDef.name)}</span>`;
  }).join('')}
          ${mod.tags.length > 3 ? `<span style="color:var(--text-muted);font-size:9px;align-self:center">+${mod.tags.length - 3}</span>` : ''}
        </div>` : ''}
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
  `;

  // Toggle handler
  const toggle = card.querySelector('.mod-toggle-input');
  toggle.addEventListener('change', async () => {
    if (isModOperationRunning) {
      toggle.checked = !toggle.checked;
      toast("Une opération est déjà en cours...", "warning");
      return;
    }

    // Conflict Check
    const conflicts = conflictCache[mod.id];
    const ignoreConflicts = localStorage.getItem('bmm_ignore_conflicts') === 'true';

    if (toggle.checked && conflicts && conflicts.length > 0 && !ignoreConflicts) {
      // Show conflict warning modal
      toggle.checked = false; // Reset visually until confirmed
      const modal = document.getElementById('modal-conflict-warning');
      const listContainer = document.getElementById('conflict-warning-list');
      const msgEl = modal.querySelector('[data-i18n="conflict.warningMsg"]');

      if (msgEl) {
        msgEl.innerHTML = t('conflict.warningMsg', { mods: '' }).replace(': ', ''); // Clear placeholder if used in title
      }

      listContainer.innerHTML = conflicts.map(c => `<div style="margin-bottom:4px;color:var(--warning);font-size:13px"><span style="color:var(--text-muted)">></span> ${escHtml(c)}</div>`).join('');

      modal.classList.add('open');

      const confirmBtn = document.getElementById('btn-confirm-conflict-toggle');
      const onConfirm = async () => {
        modal.classList.remove('open');
        confirmBtn.removeEventListener('click', onConfirm);

        if (document.getElementById('conflict-ignore-forever').checked) {
          localStorage.setItem('bmm_ignore_conflicts', 'true');
        }

        // Re-trigger toggle
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));
      };
      confirmBtn.onclick = onConfirm; // Use onclick to replace previous listeners
      return;
    }

    const originalState = !toggle.checked;
    const pill = card.querySelector('.mod-status-pill');
    const oldPillContent = pill.innerHTML;
    pill.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
    toggle.disabled = true;
    isModOperationRunning = true;

    try {
      if (toggle.checked) {
        await invoke('enable_mod', { modId: mod.id });
        toast(t('mod.activated', { name: mod.name }), 'success');
        if (localStorage.getItem('bmm_sysNotif') === 'true') {
          sendOsNotification('Better Mod Manager', t('mod.activated', { name: mod.name }));
        }
      } else {
        await invoke('disable_mod', { modId: mod.id });
        toast(t('mod.deactivated', { name: mod.name }), 'info');
        if (localStorage.getItem('bmm_sysNotif') === 'true') {
          sendOsNotification('Better Mod Manager', t('mod.deactivated', { name: mod.name }));
        }
      }
      await refreshMods();
    } catch (err) {
      toggle.checked = originalState;
      toast('Erreur : ' + err, 'error');
      pill.innerHTML = oldPillContent;
    } finally {
      isModOperationRunning = false;
      toggle.disabled = false;
    }
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
    selectMod(mod);
  });

  // Edit button
  card.querySelector('.btn-edit-mod').addEventListener('click', (e) => {
    e.stopPropagation();
    selectMod(mod);
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

    // Setup listeners for this specific mod deletion
    const onCheckChange = () => {
      finalBtn.disabled = !confirmCheck.checked;
      finalBtn.style.opacity = confirmCheck.checked ? '1' : '0.5';
    };

    const onFinalDelete = async () => {
      try {
        finalBtn.disabled = true;
        finalBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';

        await invoke('remove_mod', { modId: mod.id });
        toast(t('mod.removed', { name: mod.name }), 'info');

        modal.classList.remove('open');
        if (selectedModId === mod.id) closeModDetail();
        await refreshMods();
      } catch (err) {
        toast('Erreur : ' + err, 'error');
        finalBtn.disabled = false;
        finalBtn.innerHTML = `<span>${t('lib.delete')}</span>`;
      }
    };

    confirmCheck.onchange = onCheckChange;
    finalBtn.onclick = onFinalDelete;
  });

  return card;
}

// ── Detail / Edit Panel ──────────────────────────────────────
function selectMod(mod) {
  if (selectedModId === mod.id) {
    closeModDetail();
    return;
  }
  selectedModId = mod.id;
  renderModList(); // re-render to show selected state
  renderModDetail(mod);
}

function closeModDetail() {
  selectedModId = null;
  const panel = document.getElementById('mod-detail-panel');
  if (panel) panel.style.display = 'none';
  renderModList();
}

async function renderModDetail(mod) {
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

  // Fetch conflicts
  let conflicts = [];
  try {
    conflicts = await invoke('check_conflicts', { modId: mod.id });
  } catch (e) { }

  const links = mod.download_links || [];

  panel.innerHTML = `
    <div class="detail-header">
      <div>
        <h3 style="margin:0;font-size:16px;color:var(--text-primary)">${escHtml(mod.name)}</h3>
        <span style="font-family:var(--font-mono);font-size:11px;color:var(--cyan)">v${escHtml(mod.version)}</span>
        <span style="font-size:11px;color:var(--text-muted);margin-left:8px;display:inline-flex;align-items:center;gap:4px">${mod.enabled ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="var(--success)" stroke="none"><circle cx="12" cy="12" r="6"/></svg> ACTIF' : '<svg width="10" height="10" viewBox="0 0 24 24" fill="var(--text-muted)" stroke="none"><circle cx="12" cy="12" r="6"/></svg> INACTIF'}</span>
      </div>
      <button id="btn-close-detail-inner" class="btn btn-sm btn-icon" style="background:rgba(255,255,255,0.05);border:none;color:var(--text-muted);cursor:pointer;padding:4px 8px;border-radius:6px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>

    <div class="detail-body" style="display:flex;flex-direction:column;gap:12px;margin-top:12px">
      ${conflicts.length > 0 ? `
      <div id="conflict-alert" style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:12px;margin-bottom:8px">
        <h4 style="color:var(--danger);font-size:12px;font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          ${t('mod.conflictsTitle')}
        </h4>
        <p style="font-size:11px;color:rgba(255,255,255,0.7);line-height:1.4">
          ${t('mod.conflictsDesc').replace('{mods}', `<strong style="color:var(--text-primary)">${conflicts.join(', ')}</strong>`)}
        </p>
      </div>` : ''}

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
        <textarea id="detail-desc" class="input-field" rows="2" style="resize:vertical">${escHtml(mod.description || '')}</textarea>
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
      ${mod.installed_files && mod.installed_files.length > 0 ? `
      <div class="detail-section">
        <label class="detail-label" style="display:flex;align-items:center;gap:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> ${t('detail.files')} (${mod.installed_files.length})</label>
        <div style="max-height:120px;overflow-y:auto;font-family:var(--font-mono);font-size:10px;color:var(--text-muted);background:rgba(0,0,0,0.3);padding:6px 10px;border-radius:8px">
          ${mod.installed_files.map(f => `<div style="padding:1px 0;display:flex;align-items:center;gap:4px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>${escHtml(f)}</div>`).join('')}
        </div>
      </div>
      ` : ''}

      <!-- Download Links -->
      <div class="detail-section">
        <label class="detail-label" style="display:flex;align-items:center;gap:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> ${t('detail.links')}</label>
        <div id="detail-links-list" style="display:flex;flex-direction:column;gap:6px">
          ${links.map((dl, i) => `
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
          `).join('')}
        </div>
        <button id="btn-add-link" class="btn btn-sm" style="margin-top:6px;background:rgba(59,130,246,0.15);color:var(--accent);border:none;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px">+ ${t('detail.addLink')}</button>
      </div>

      <!-- Save Button -->
      <button id="btn-save-detail" class="btn btn-primary" style="align-self:flex-start;margin-top:6px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> ${t('detail.save')}
      </button>
    </div>
  `;

  // Close button
  panel.querySelector('#btn-close-detail-inner').addEventListener('click', closeModDetail);

  // Archive Explorer button
  panel.querySelector('#btn-browse-archive').addEventListener('click', () => openArchiveExplorer(mod));

  // Load Tags logic
  const tagSelect = panel.querySelector('#detail-tag-select');
  const tagList = panel.querySelector('#detail-tags-list');
  let modTags = [...(mod.tags || [])];

  const renderTagsUI = () => {
    tagList.innerHTML = '';
    modTags.forEach(tid => {
      const tDef = userTags.find(t => t.id === tid);
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

  userTags.forEach(tDef => {
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
      await refreshMods();
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
    userTags.forEach(tDef => {
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

async function toggleAllMods() {
  if (isModOperationRunning) {
    toast("Une opération est déjà en cours...", "warning");
    return;
  }

  const currentStatus = getToggleAllStatus();
  const enable = currentStatus === 'enable';
  const targetMods = enable ? allMods.filter(m => !m.enabled) : allMods.filter(m => m.enabled);

  if (targetMods.length === 0) return;

  isModOperationRunning = true;

  const btn = document.getElementById('btn-enable-all');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;margin-right:6px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> ${enable ? 'Activation...' : 'Désactivation...'}`;

  try {
    await invoke('toggle_all_mods', { enable });
    await refreshMods();
    const key = enable ? 'mod.enabledCount' : 'mod.deactivatedCount'; // Should add i18n key for multi-deact if needed
    toast(t(enable ? 'mod.enabledCount' : 'mod.enabledCount').replace('{count}', targetMods.length), 'success');
  } catch (err) {
    toast(t('common.error') + ' : ' + err, 'error');
  } finally {
    isModOperationRunning = false;
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

function getToggleAllStatus() {
  const enabledCount = allMods.filter(m => m.enabled).length;
  // If some are disabled, main action is to ENABLE all
  return (enabledCount < allMods.length && allMods.length > 0) ? 'enable' : 'disable';
}

function updateToggleAllBtn() {
  const btn = document.getElementById('btn-enable-all');
  if (!btn) return;
  const status = getToggleAllStatus();
  const label = btn.querySelector('span');
  const svg = btn.querySelector('svg');

  if (status === 'disable') {
    label.innerHTML = t('lib.disableAll');
    svg.innerHTML = '<path d="M18 6L6 18M6 6l12 12" /><circle cx="12" cy="12" r="10" />';
    btn.classList.replace('btn-primary', 'btn-ghost');
    btn.style.color = 'var(--danger)';
  } else {
    label.innerHTML = t('lib.enableAll');
    svg.innerHTML = '<path d="m5 12 5 5L20 7" /><circle cx="12" cy="12" r="10" />';
    btn.classList.replace('btn-ghost', 'btn-primary');
    btn.style.color = '';
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


function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
