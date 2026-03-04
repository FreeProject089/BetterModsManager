/**
 * mods.js — Mod library management with detail panel + scan + edit
 */
import { invoke, pickFolder, listenFileDrop, toast, sendOsNotification } from './app.js';

let allMods = [];
let userTags = [];
let currentFilter = 'all';
let currentSort = 'name_asc';
let searchQuery = '';
let selectedModId = null;

export async function initMods() {
  document.getElementById('btn-add-mod').addEventListener('click', openAddModModal);
  document.getElementById('btn-confirm-add-mod').addEventListener('click', confirmAddMod);
  document.getElementById('btn-enable-all').addEventListener('click', enableAll);

  // Scan mods folder button
  const scanBtn = document.getElementById('btn-scan-mods');
  if (scanBtn) {
    scanBtn.addEventListener('click', async () => {
      try {
        const added = await invoke('scan_mods_folder');
        if (added.length === 0) {
          toast('Aucun nouveau mod détecté.', 'info');
        } else {
          toast(`${added.length} mod(s) découvert(s) !`, 'success');
          await refreshMods();
        }
      } catch (err) {
        toast('Erreur scan : ' + err, 'error');
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
}

export async function refreshMods() {
  try {
    allMods = await invoke('get_mods');
  } catch (err) {
    console.warn("Could not get mods:", err);
    allMods = [];
  }
  updateBadge();
  renderModList();
  updateSubtitle();
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

  card.innerHTML = `
    <label class="mod-toggle" title="${mod.enabled ? 'Désactiver' : 'Activer'}">
      <input type="checkbox" class="mod-toggle-input" ${mod.enabled ? 'checked' : ''} />
      <div class="mod-toggle-track">
        <div class="mod-toggle-thumb"></div>
      </div>
    </label>

    <div class="mod-status-dot ${mod.enabled ? 'enabled' : 'disabled'}"></div>

    <div class="mod-info">
      <div class="mod-name">${escHtml(mod.name)}</div>
      <div class="mod-meta">
        <span class="mono" style="color: var(--cyan)">v${escHtml(mod.version)}</span>
        ${mod.author ? `<span>· ${escHtml(mod.author)}</span>` : ''}
        ${mod.description ? `<span style="color: var(--text-muted)">· ${escHtml(mod.description)}</span>` : ''}
        ${mod.tags?.length > 0 ? `<div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap">
          ${mod.tags.map(tid => {
    const tDef = userTags.find(t => t.id === tid);
    if (!tDef) return '';
    return `<span style="background:${tDef.color}15;color:${tDef.color};border:1px solid ${tDef.color}30;padding:1px 5px;border-radius:4px;font-size:9px;font-weight:600">${escHtml(tDef.name)}</span>`;
  }).join('')}
        </div>` : ''}
      </div>
      <div class="mod-path-hint" style="font-size:10px;font-family:var(--font-mono);color:var(--text-muted);opacity:0.6;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:400px;display:flex;align-items:center;gap:4px">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        ${escHtml(mod.mod_folder_path || '')}
      </div>
    </div>

    <div class="mod-actions">
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
    const originalState = !toggle.checked;
    const pill = card.querySelector('.mod-status-pill');
    const oldPillContent = pill.innerHTML;
    pill.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
    toggle.disabled = true;

    try {
      if (toggle.checked) {
        await invoke('enable_mod', { modId: mod.id });
        toast(`"${mod.name}" activé.`, 'success');
        if (localStorage.getItem('bmm_sysNotif') === 'true') {
          sendOsNotification('Better Mod Manager', `"${mod.name}" activé — fichiers transférés.`);
        }
      } else {
        await invoke('disable_mod', { modId: mod.id });
        toast(`"${mod.name}" désactivé.`, 'info');
        if (localStorage.getItem('bmm_sysNotif') === 'true') {
          sendOsNotification('Better Mod Manager', `"${mod.name}" désactivé — fichiers restaurés.`);
        }
      }
      await refreshMods();
    } catch (err) {
      toggle.checked = originalState;
      toast('Erreur : ' + err, 'error');
      pill.innerHTML = oldPillContent;
    } finally {
      toggle.disabled = false;
    }
  });

  // Click card to show detail
  card.addEventListener('click', (e) => {
    if (e.target.closest('.mod-toggle') || e.target.closest('.btn-remove-mod') || e.target.closest('.btn-edit-mod')) return;
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
      toast('Désactivez le mod avant de le supprimer.', 'warning');
      return;
    }
    if (!confirm(`Supprimer "${mod.name}" de la bibliothèque ?`)) return;
    try {
      await invoke('remove_mod', { modId: mod.id });
      toast(`"${mod.name}" supprimé.`, 'info');
      if (selectedModId === mod.id) closeModDetail();
      await refreshMods();
    } catch (err) {
      toast('Erreur : ' + err, 'error');
    }
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

function renderModDetail(mod) {
  let panel = document.getElementById('mod-detail-panel');
  if (panel) panel.remove();

  panel = document.createElement('div');
  panel.id = 'mod-detail-panel';
  panel.className = 'mod-detail-panel inline-panel';

  const card = document.querySelector(`.mod-card[data-id="${mod.id}"]`);
  if (!card) return;
  card.appendChild(panel);

  // Scroll into view if it's off screen
  setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);

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
      <!-- Editable Fields -->
      <div class="detail-section">
        <label class="detail-label">Nom</label>
        <input type="text" id="detail-name" class="input-field" value="${escAttr(mod.name)}" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="detail-section">
          <label class="detail-label">Version</label>
          <input type="text" id="detail-version" class="input-field" value="${escAttr(mod.version)}" />
        </div>
        <div class="detail-section">
          <label class="detail-label">Auteur</label>
          <input type="text" id="detail-author" class="input-field" value="${escAttr(mod.author || '')}" />
        </div>
      </div>
      <div class="detail-section">
        <label class="detail-label">Description</label>
        <textarea id="detail-desc" class="input-field" rows="2" style="resize:vertical">${escHtml(mod.description || '')}</textarea>
      </div>

      <!-- Tags Selection -->
      <div class="detail-section" id="detail-tags-container">
        <label class="detail-label" data-i18n="detail.tags" style="display:flex;align-items:center;gap:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> Tags</label>
        <div id="detail-tags-list" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px"></div>
        <select id="detail-tag-select" class="input-field" style="width:100%;padding:6px;font-size:11px">
            <option value="">— Ajouter un tag —</option>
        </select>
      </div>

      <!-- Mod Folder Path -->
      <div class="detail-section">
        <label class="detail-label" style="display:flex;align-items:center;gap:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> Dossier du mod</label>
        <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);background:rgba(0,0,0,0.3);padding:8px 10px;border-radius:8px;word-break:break-all">
          ${escHtml(mod.mod_folder_path || 'Non défini')}
        </div>
      </div>

      <!-- Installed Files -->
      ${mod.installed_files && mod.installed_files.length > 0 ? `
      <div class="detail-section">
        <label class="detail-label" style="display:flex;align-items:center;gap:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Fichiers installés (${mod.installed_files.length})</label>
        <div style="max-height:120px;overflow-y:auto;font-family:var(--font-mono);font-size:10px;color:var(--text-muted);background:rgba(0,0,0,0.3);padding:6px 10px;border-radius:8px">
          ${mod.installed_files.map(f => `<div style="padding:1px 0;display:flex;align-items:center;gap:4px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>${escHtml(f)}</div>`).join('')}
        </div>
      </div>
      ` : ''}

      <!-- Download Links -->
      <div class="detail-section">
        <label class="detail-label" style="display:flex;align-items:center;gap:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Liens de téléchargement</label>
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
        <button id="btn-add-link" class="btn btn-sm" style="margin-top:6px;background:rgba(59,130,246,0.15);color:var(--accent);border:none;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px">+ Ajouter un lien</button>
      </div>

      <!-- Save Button -->
      <button id="btn-save-detail" class="btn btn-primary" style="align-self:flex-start;margin-top:6px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Sauvegarder
      </button>
    </div>
  `;

  // Close button
  panel.querySelector('#btn-close-detail-inner').addEventListener('click', closeModDetail);

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
      modTags.push(tid);
      renderTagsUI();
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
  document.getElementById('modal-add-mod').classList.add('open');
}

async function confirmAddMod() {
  const name = document.getElementById('mod-name').value.trim();
  const folder = document.getElementById('mod-folder').value.trim();
  const version = document.getElementById('mod-version').value.trim() || '1.0.0';
  const author = document.getElementById('mod-author').value.trim();
  const description = document.getElementById('mod-desc').value.trim();

  if (!name || !folder) {
    toast('Le nom et le fichier/dossier sont obligatoires.', 'error');
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
    });
    document.getElementById('modal-add-mod').classList.remove('open');
    toast(`"${name}" importé et ajouté à la bibliothèque.`, 'success');
    await refreshMods();
  } catch (err) {
    toast('Erreur : ' + err, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

async function enableAll() {
  const disabled = allMods.filter(m => !m.enabled);
  if (disabled.length === 0) {
    toast('Tous les mods sont déjà actifs.', 'info');
    return;
  }
  for (const mod of disabled) {
    try {
      await invoke('enable_mod', { modId: mod.id });
    } catch (err) {
      toast(`Erreur sur "${mod.name}" : ${err}`, 'error');
    }
  }
  await refreshMods();
  toast(`${disabled.length} mod(s) activé(s).`, 'success');
}

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
