// @ts-nocheck
import { appState } from '../../core/state.js';
import { renderTagChip } from '../../ui/icon-pack.js';
import { invoke } from '../../core/api.js';
import { toast, openExternal } from '../../ui/app.js';
import { t } from '../../core/i18n.js';
import { escHtml, escAttr, escJs } from '../../core/utils.js';
import { getModDetailHTML } from '../../ui/components.js';
import { renderModList, updateCardState } from './mods-list.js';
import { setupDependencyInput } from './mods-actions.js';
import { dispatchBmmAction, BMM_ACTIONS } from '../../ui/tutorial-events.js';

const S = new Proxy(appState.state, {
  get(target, prop) { return target[prop]; },
  set(target, prop, value) { appState.set(prop, value); return true; }
});

let archiveCtxInit = false;
function initArchiveContextMenu() {
  if (archiveCtxInit) return;
  const ctxMenu = document.getElementById('archive-context-menu');
  if (!ctxMenu) return;
  archiveCtxInit = true;

  const hideCtx = () => { ctxMenu.style.display = 'none'; };
  document.addEventListener('click', hideCtx);
  document.addEventListener('contextmenu', (e: any) => {
      if (!e.target.closest('#archive-context-menu') && !e.target.closest('.tree-node')) hideCtx();
  });

  const modalOverlay = document.getElementById('modal-archive-explorer');
  if (modalOverlay) {
      modalOverlay.addEventListener('click', (e) => {
          if (e.target === modalOverlay) hideCtx();
      });
  }

  document.querySelectorAll('[data-close="modal-archive-explorer"]').forEach(btn => {
      btn.addEventListener('click', hideCtx);
  });

  const ctxOpenFile = document.getElementById('ctx-open-file');
  const ctxOpenFolder = document.getElementById('ctx-open-folder');
  const ctxCopyPath = document.getElementById('ctx-copy-path');

  if (ctxOpenFile) {
    ctxOpenFile.addEventListener('click', async () => {
        if (!(window as any)._currentArchiveNode) return;
        const relPath = (window as any)._currentArchiveNode.dataset.full;
        const tType = (window as any)._currentArchiveNode.dataset.type;
        const modId = (window as any)._currentExplorerModId;
        if (!relPath || !modId) return;
        
        try {
            const mod = S.allMods.find(m => m.id === modId);
            if (!mod) return;
            const modFolderPath = mod.mod_folder_path;
            const fullPath = modFolderPath.replace(/\\/g, '/') + '/' + relPath.replace(/\\/g, '/');
            
            if (tType === 'folder') invoke('open_folder', { path: fullPath }).catch((e:any) => toast(String(e), 'error'));
            else invoke('open_file', { path: fullPath }).catch((e:any) => toast(String(e), 'error'));
        } catch (e) {
            toast(String(e), 'error');
        }
        hideCtx();
    });
  }

  if (ctxOpenFolder) {
    ctxOpenFolder.addEventListener('click', async () => {
        const modId = (window as any)._currentExplorerModId;
        if (!modId) return;
        
        try {
            const mod = S.allMods.find(m => m.id === modId);
            if (!mod) return;
            
            // Use the appropriate command based on mod status
            if (mod.enabled) {
                await invoke('open_mod_active_folder', { modId });
            } else {
                await invoke('open_mod_backup_folder', { modId });
            }
        } catch (e) {
            toast(String(e), 'error');
        }
        hideCtx();
    });
  }

  if (ctxCopyPath) {
    ctxCopyPath.addEventListener('click', async () => {
        if (!(window as any)._currentArchiveNode) return;
        const relPath = (window as any)._currentArchiveNode.dataset.full;
        const modId = (window as any)._currentExplorerModId;
        if (!relPath || !modId) return;
        
        try {
            const mod = S.allMods.find(m => m.id === modId);
            if (!mod) return;
            const modFolderPath = mod.mod_folder_path;
            const fullPath = modFolderPath.replace(/\\/g, '/') + '/' + relPath.replace(/\\/g, '/');
            
            navigator.clipboard.writeText(fullPath).then(() => toast(t('common.copied') || 'Copié !', 'success'));
        } catch (e) {
            toast(String(e), 'error');
        }
        hideCtx();
    });
  }
}


export function selectMod(modId) {
  if (S.selectedModId === modId) {
    closeModDetail();
    return;
  }
  if (S.selectedModId) {
    const oldCard = document.querySelector(`.mod-card[data-id="${S.selectedModId}"]`);
    if (oldCard) oldCard.classList.remove('selected');
  }
  S.selectedModId = modId;
  const newCard = document.querySelector(`.mod-card[data-id="${modId}"]`);
  if (newCard) newCard.classList.add('selected');
  renderModDetail(modId);
  dispatchBmmAction(BMM_ACTIONS.MOD_DETAIL_OPENED, { modId });
}

export function closeModDetail() {
  if (S.selectedModId) {
    const oldCard = document.querySelector(`.mod-card[data-id="${S.selectedModId}"]`);
    if (oldCard) oldCard.classList.remove('selected');
  }
  S.selectedModId = null;
  const panel = document.getElementById('mod-detail-panel');
  if (panel) panel.remove();
}

export async function renderModDetail(modId) {
  const mod = S.allMods.find(m => m.id === modId);
  if (!mod) return closeModDetail();

  let panel = document.getElementById('mod-detail-panel');
  if (panel) panel.remove();

  panel = document.createElement('div');
  panel.id = 'mod-detail-panel';
  panel.className = 'mod-detail-panel inline-panel';
  panel.onclick = e => e.stopPropagation();

  const card = document.querySelector(`.mod-card[data-id="${mod.id}"]`);
  if (!card) return;
  card.appendChild(panel);

  setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);

  // A mod synced from a server repo already HAS a source, it just was not among
  // its "Links" — that list only ever held the download URLs someone typed in by
  // hand, so for every repo mod the one link that mattered was the one missing.
  //
  // Passed separately, and rendered OUTSIDE #detail-links-list on purpose: the save
  // handler rebuilds download_links by reading the rows in that container, so a
  // derived link placed among them would be written back as if the user had entered
  // it — and would then survive re-syncing from a different repo.
  panel.innerHTML = getModDetailHTML(mod, {
    conflicts: [],
    links: mod.download_links || [],
    repoLink: mod.source_repo || mod.update_url || null,
  });

  // The derived repo link opens in the system browser. window.open is a no-op in the
  // Tauri v2 webview, so it goes through the same open_external route every other
  // link in the app uses — a second mechanism here is how one of them silently stops
  // working after a migration and nobody notices for a release.
  panel.querySelector('[data-open-url]')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    openExternal((ev.currentTarget as HTMLElement).dataset.openUrl || '');
  });

  // Update conflicts in background
  (async () => {
    try {
      const conflicts = await invoke('get_mod_conflicts', { modId: mod.id });
      if (conflicts && conflicts.length > 0) {
        const badgeContainer = panel.querySelector('.conflict-badge-container');
        if (badgeContainer) badgeContainer.innerHTML = `<span class="badge badge-warning" style="font-size:10px">${t('mod.conflictsFound', { n: conflicts.length })}</span>`;
        const listContainer = panel.querySelector('#detail-conflicts-list');
        if (listContainer) {
          listContainer.innerHTML = conflicts.map(c => `
            <div style="background:rgba(0,0,0,0.2);padding:8px 10px;border-radius:8px;border:1px solid ${c.status === 'Active' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                <span class="tag-conflict tag-${c.category.toLowerCase()}-conflict ${c.status.toLowerCase()}" style="cursor:pointer" onclick="window.openGlobalConflictModal('${mod.id}')">
                   ${c.category === 'Intra' ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="margin-right:4px"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>' : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="margin-right:4px"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'}
                   ${c.category}
                </span>
                <span style="font-size:10px;font-family:var(--font-mono);color:var(--text-muted)">${c.file_count} f.</span>
              </div>
              <div style="font-size:11px;color:var(--text-primary);font-weight:600" data-tooltip="${escAttr(c.other_mod_name)}">${escHtml(c.other_mod_name)}</div>
              <div style="font-size:10px;color:var(--text-muted)">${t('mod.profilLabel')}${escHtml(c.other_profile_name)}</div>
            </div>
          `).join('');
        }
      }
    } catch (e) {}
  })();

  const depInput = panel.querySelector('#detail-dep-input');
  if (depInput) {
    depInput._currentModId = mod.id;
    setupDependencyInput('detail-dep-input', 'detail-deps-list', 'detail-dep-suggestions', mod.dependencies || []);
  }

  panel.querySelector('#btn-close-detail-inner').onclick = closeModDetail;
  panel.querySelector('#btn-browse-archive').onclick = () => openArchiveExplorer(mod);

  // Copy Content ID button (inside the detail panel content-id-box)
  panel.querySelector('.btn-copy-content-id')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const contentId = (e.currentTarget as HTMLElement).dataset.contentId || '';
    if (!contentId) return;
    try {
      await navigator.clipboard.writeText(contentId);
      toast(t('common.contentIdCopied', { id: contentId.slice(0, 16) }) || ('Content ID copied: ' + contentId.slice(0, 16) + '…'), 'success', 2000);
    } catch (err) {
      toast(t('common.error') + ' : ' + err, 'error');
    }
  });
  panel.querySelector('#btn-verify-mod-integrity')?.addEventListener('click', async () => {
    try {
      // If hashes are missing, trigger calculation first
      if (!mod.file_hashes || Object.keys(mod.file_hashes).length === 0) {
          toast(t('mods.sha.calculating'), 'info');
          await invoke('recalculate_mod_sha', { modId: mod.id });
          // Note: Background calculation started, report might still be empty if we call it immediately.
          // But get_mod_integrity in Rust will report all files as "added" if no hash exists.
      }
      toast(t('integrity.checking'), 'info');
      const report = await invoke('get_mod_integrity', { modId: mod.id });
      showIntegrityReport(mod, report);
    } catch (err) { toast(t('common.error') + ' : ' + err, 'error'); }
  });

  const setupCounter = (inputId, counterId, max) => {
    const input = panel.querySelector('#' + inputId);
    const counter = panel.querySelector('#' + counterId);
    if (input && counter) {
      const update = () => { counter.textContent = `${input.value.length}/${max}`; };
      input.addEventListener('input', update);
      update();
    }
  };

  setupCounter('detail-name', 'counter-name', 100);
  setupCounter('detail-author', 'counter-author', 50);
  setupCounter('detail-desc', 'counter-desc', 2000);

  const descTextarea = panel.querySelector('#detail-desc');
  if (descTextarea) {
    descTextarea.value = mod.description || '';
    const autoResize = () => { descTextarea.style.height = 'auto'; descTextarea.style.height = (descTextarea.scrollHeight + 2) + 'px'; };
    descTextarea.addEventListener('input', autoResize);
    setTimeout(autoResize, 0);
  }

  const tagList = panel.querySelector('#detail-tags-list');
  let modTags = [...(mod.tags || [])];

  const renderTagsUI = () => {
    tagList.innerHTML = '';
    modTags.forEach(tid => {
      const tDef = S.userTags.find(t => t.id === tid);
      if (!tDef) return;
      const chip = document.createElement('div');
      chip.style.cssText = 'display:flex;align-items:center;gap:4px';
      chip.innerHTML = renderTagChip(tDef, { fontSize: 11, pad: '2px 8px' })
        + `<button data-id="${tid}" data-tasky="mod.removeTagTip" data-tasky-icon="trash" style="background:none;border:none;color:${tDef.color};cursor:pointer;padding:0">&times;</button>`;
      chip.querySelector('button').onclick = async () => { 
        const ok = await window.confirmCustom(
          t('common.delete') || 'Retirer le tag',
          (t('mod.removeTagConfirm') || 'Voulez-vous vraiment retirer le tag {name} ?').replace('{name}', `<strong>${escHtml(tDef.name)}</strong>`),
          'danger'
        );
        if (ok) {
          modTags = modTags.filter(id => id !== tid); 
          renderTagsUI(); 
        }
      };
      tagList.appendChild(chip);
    });
    mod._currentTags = modTags;
  };

  const addTag = (tid: string) => {
    if (!tid || modTags.includes(tid)) return;
    if (modTags.length >= 3) { toast(t('mod.tagLimit'), 'warning'); return; }
    modTags.push(tid);
    renderTagsUI();
  };

  setupTagPicker(panel, () => modTags, addTag);
  renderTagsUI();
  
  panel.querySelector('#btn-save-detail').onclick = async () => {
    const name = panel.querySelector('#detail-name').value.trim().substring(0, 100);
    const version = panel.querySelector('#detail-version').value.trim().substring(0, 30);
    const author = panel.querySelector('#detail-author').value.trim().substring(0, 50);
    const description = panel.querySelector('#detail-desc').value.trim().substring(0, 2000);
    const tags = mod._currentTags || mod.tags || [];

    try {
      const linkRows = panel.querySelectorAll('#detail-links-list > div');
      const download_links = [];
      for (const row of linkRows) {
        const url = row.querySelector('.detail-link-url').value.trim();
        const linkType = row.querySelector('.detail-link-type').value;
        const label = row.querySelector('.detail-link-label').value.trim();
        if (url) download_links.push({ url, link_type: linkType, label });
      }
      const dependencies = panel.querySelector('#detail-dep-input')?._selectedDeps || [];
      await invoke('update_mod_meta', { 
        modId: mod.id, payload: { name, author, description, version, tags, downloadLinks: download_links, dependencies }
      });
      toast(t('common.saved') || 'Mod sauvegardé.', 'success');
      mod.name = name;
      mod.version = version;
      mod.author = author;
      mod.description = description;
      mod.tags = tags;
      mod.download_links = download_links;
      mod.dependencies = dependencies;

      // Force a global state update to trigger observers and ensure UI consistency
      appState.set('allMods', [...(S.allMods || [])]);

      // Update the card in the list immediately
      const card = document.querySelector(`.mod-card[data-id="${mod.id}"]`);
      if (card) updateCardState(card, mod);

      renderModList(true);
      renderModDetail(mod.id);
    } catch (err) { toast((window.t ? window.t('common.error') : 'Error') + ' : ' + err, 'error'); }
  };

  // Attach remove listeners to existing links
  panel.querySelectorAll('.btn-remove-link').forEach(btn => {
    btn.onclick = () => btn.closest('div').remove();
  });

  panel.querySelector('#btn-add-link').onclick = () => {
    const list = panel.querySelector('#detail-links-list');
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;background:rgba(0,0,0,0.2);padding:6px 8px;border-radius:8px';
    row.innerHTML = `
            <select class="detail-link-type input-field" style="width:100px;padding:3px;font-size:10px">
                <option value="github">GitHub</option>
                <option value="direct" selected>Direct</option>
                <option value="other">Autre</option>
            </select>
            <input type="text" class="detail-link-url input-field" style="flex:1;padding:3px 6px;font-size:10px" placeholder="URL" />
            <input type="text" class="detail-link-label input-field" style="width:80px;padding:3px 6px;font-size:10px" placeholder="Label" />
            <button class="btn-remove-link" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px;display:flex;align-items:center"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        `;
    row.querySelector('.btn-remove-link').onclick = () => row.remove();
    list.appendChild(row);
  };
}

export async function openArchiveExplorer(mod) {
  window._currentExplorerModId = mod.id;
  const modal = document.getElementById('modal-archive-explorer');
  const container = document.getElementById('archive-explorer-content');
  if (!modal || !container) return;

  initArchiveContextMenu();

  container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;margin-bottom:12px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg><br>Scan en cours...</div>`;
  modal.classList.add('open');

  try {
    const files = await invoke('list_mod_files_recursive', { modId: mod.id });
    if (files.length === 0) { container.innerHTML = `<div style="text-align:center;padding:40px;">${t('lib.emptyTitle')}</div>`; return; }

    const tree = buildFileTree(files);
    container.innerHTML = `<div class="tree-container">${renderTree(tree)}</div>`;
    setupTreeInteractions(mod);
  } catch (err) { container.innerHTML = `<div style="color:var(--danger);padding:20px;">${err}</div>`; }
}

function buildFileTree(files) {
  const root = {};
  files.sort().forEach(f => {
    const parts = f.split(/[/\\]/);
    let current = root;
    parts.forEach((part, i) => {
      if (!current[part]) current[part] = { _isFolder: i < parts.length - 1, _fullPath: f, _relPath: parts.slice(0, i + 1).join('\\'), children: {} };
      current = current[part].children;
    });
  });
  return root;
}

function renderTree(nodes) {
  let html = '';
  const keys = Object.keys(nodes).sort((a, b) => {
    if (nodes[a]._isFolder && !nodes[b]._isFolder) return -1;
    if (!nodes[a]._isFolder && nodes[b]._isFolder) return 1;
    return a.localeCompare(b);
  });
  keys.forEach(key => {
    const node = nodes[key];
    const isFolder = node._isFolder;
    const arrow = isFolder ? `<span class="tree-node-arrow"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg></span>` : '<span style="width:16px"></span>';
    const icon = isFolder ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>` : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    html += `<div class="tree-node ${isFolder ? 'collapsed' : ''}" data-path="${escAttr(node._relPath)}" data-full="${escAttr(node._fullPath)}" data-type="${isFolder ? 'folder' : 'file'}">${arrow}<span class="tree-node-icon">${icon}</span><span class="tree-node-label">${escHtml(key)}</span></div>`;
    if (isFolder) html += `<div class="tree-children">${renderTree(node.children)}</div>`;
  });
  return html;
}

function setupTreeInteractions(mod) {
  const container = document.getElementById('archive-explorer-content');
  if (!container) return;
  container.querySelectorAll('.tree-node').forEach(node => {
    node.onclick = () => {
      if (node.dataset.type === 'folder') node.classList.toggle('collapsed');
      container.querySelectorAll('.tree-node').forEach(n => n.classList.remove('selected'));
      node.classList.add('selected');
    };
    node.oncontextmenu = (e) => {
      e.preventDefault(); e.stopPropagation();
      const ctxMenu = document.getElementById('archive-context-menu');
      container.querySelectorAll('.tree-node').forEach(n => n.classList.remove('selected'));
      node.classList.add('selected');
      (window as any)._currentArchiveNode = node;
      ctxMenu.style.top = e.pageY + 'px'; ctxMenu.style.left = e.pageX + 'px'; ctxMenu.style.display = 'block';
    };
  });
}

export function showIntegrityReport(mod: any, report: any) {
  const modal = document.getElementById('modal-integrity');
  const content = document.getElementById('integrity-report-content');
  if (!modal || !content) return;

  // Update local mod object and global state
  const is_valid = report.is_valid;
  mod.file_hashes_invalid = !is_valid;
  
  // Find the mod in appState and update it there too
  const stateMod = appState.state.allMods.find(m => m.id === mod.id);
  if (stateMod) stateMod.file_hashes_invalid = !is_valid;

  // Refresh only the mod list UI (non-blocking)
  if (window._refreshModsFn) window._refreshModsFn(false, true);

  const hasIssues = report.missing.length > 0 || report.modified.length > 0 || report.added.length > 0;
  if (!hasIssues) {
    content.innerHTML = `<div style="color:var(--success);padding:20px;text-align:center;"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-bottom:16px"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg><h3>${t('integrity.ok')}</h3><p style="font-size:13px;color:var(--text-muted)">${t('integrity.modClean')}</p></div>`;
  } else {
    const renderSec = (title, items, color) => items.length === 0 ? '' : `<div><div style="font-size:11px;font-weight:700;color:${color}">${title} (${items.length})</div><ul style="background:rgba(0,0,0,0.25);padding:10px;border-radius:8px;list-style:none">${items.map(f => `<li style="font-size:11px;font-family:var(--font-mono);color:var(--text-primary)">> ${escHtml(f)}</li>`).join('')}</ul></div>`;
    content.innerHTML = `<div style="padding:10px 0;"><h3 style="color:var(--warning)">${t('integrity.issues')}</h3><p>Mod: <strong>${escHtml(mod.name)}</strong></p>${renderSec(t('integrity.missing'), report.missing, 'var(--danger)')}${renderSec(t('integrity.modified'), report.modified, 'var(--warning)')}${renderSec(t('integrity.added'), report.added, 'var(--accent)')}</div>`;
  }
  modal.classList.add('open');
}

/**
 * The tag picker: a list of real chips, and a way to make a new one without leaving.
 *
 * It was a native `<select>`. An `<option>` is text — the browser will not draw an icon or a
 * colour inside one — so the two things that tell tags apart were invisible in the one place
 * you pick a tag, and the only way to create a tag was to leave the mod, go to Settings, make
 * it, come back and find the mod again.
 */
function setupTagPicker(panel, currentTags: () => string[], addTag: (id: string) => void) {
  const btn = panel.querySelector('#detail-tag-open');
  const menu = panel.querySelector('#detail-tag-menu');
  if (!btn || !menu) return;

  const close = () => { menu.style.display = 'none'; };
  const draw = () => {
    const taken = new Set(currentTags());
    menu.innerHTML = '';

    const tags = [...(S.userTags || [])].sort((a, b) => a.name.localeCompare(b.name));
    if (!tags.length) {
      const empty = document.createElement('div');
      empty.className = 'bmm-tag-menu-row';
      empty.setAttribute('disabled', '');
      empty.textContent = t('detail.noTagsYet') || 'No tags yet';
      menu.appendChild(empty);
    }
    for (const tDef of tags) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bmm-tag-menu-row';
      // The chip is the whole point: same renderer as everywhere else, so a tag looks here
      // exactly like it looks on the card it is about to land on.
      row.innerHTML = renderTagChip(tDef, { fontSize: 11, pad: '2px 8px' });
      if (taken.has(tDef.id)) {
        row.setAttribute('disabled', '');
        row.disabled = true;
      } else {
        row.onclick = () => { addTag(tDef.id); draw(); };
      }
      menu.appendChild(row);
    }

    const sep = document.createElement('div');
    sep.className = 'bmm-tag-menu-sep';
    menu.appendChild(sep);

    const newRow = document.createElement('button');
    newRow.type = 'button';
    newRow.className = 'bmm-tag-menu-row';
    newRow.innerHTML = `<span style="font-weight:700">＋</span> <span>${escHtml(t('detail.newTag') || 'New tag…')}</span>`;
    newRow.onclick = () => drawNew();
    menu.appendChild(newRow);
  };

  /** The creation form, inline. Name, colour, icon — the same three fields Settings asks
   *  for, and the same `create_tag` behind them, so a tag made here is not a lesser tag. */
  const drawNew = () => {
    menu.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'bmm-tag-new';
    box.innerHTML = `
      <div class="bmm-tag-new-row">
        <input type="text" class="input-field bmm-tag-name" maxlength="30"
               placeholder="${escAttr(t('settings.tagName') || 'Tag name')}"
               style="flex:1;padding:5px;font-size:11px">
        <input type="color" class="bmm-tag-color" value="#f97316"
               style="width:30px;height:26px;padding:0;border:none;background:none;cursor:pointer">
        <button type="button" class="btn btn-sm bmm-tag-icon" style="height:26px;padding:0 8px;font-size:11px">＋</button>
      </div>
      <div class="bmm-tag-new-row" style="justify-content:flex-end">
        <button type="button" class="btn btn-sm bmm-tag-cancel" style="height:24px;padding:0 8px;font-size:10px">${escHtml(t('common.cancel') || 'Cancel')}</button>
        <button type="button" class="btn btn-sm btn-primary bmm-tag-save" style="height:24px;padding:0 10px;font-size:10px">${escHtml(t('common.create') || 'Create')}</button>
      </div>`;
    menu.appendChild(box);

    let iconRef = '';
    const nameEl = box.querySelector('.bmm-tag-name') as HTMLInputElement;
    nameEl.focus();

    box.querySelector('.bmm-tag-icon').onclick = async () => {
      const { openIconPicker, renderPackIcon } = await import('../../ui/icon-pack.js');
      const ref = await openIconPicker({ current: iconRef });
      if (ref === null) return;
      iconRef = ref;
      box.querySelector('.bmm-tag-icon').innerHTML = renderPackIcon(ref, 14) || '＋';
    };
    box.querySelector('.bmm-tag-cancel').onclick = () => draw();
    box.querySelector('.bmm-tag-save').onclick = async () => {
      const name = nameEl.value.trim();
      if (!name) { toast(t('settings.tagNameRequired') || 'Name required', 'error'); return; }
      try {
        const color = (box.querySelector('.bmm-tag-color') as HTMLInputElement).value;
        const tag = await invoke('create_tag', { name, color, icon: iconRef, color2: null });
        // Refreshed from the backend rather than pushed locally: Settings reads the same
        // list, and two copies of "the tags" is how one of them goes stale.
        S.userTags = await invoke('get_tags').catch(() => S.userTags);
        addTag(tag.id);
        draw();
      } catch (err) {
        toast(t('settings.tagCreateError', { err: String(err) }) || String(err), 'error');
      }
    };
  };

  btn.onclick = (e) => {
    e.stopPropagation();
    const open = menu.style.display !== 'none';
    if (open) { close(); return; }
    draw();
    menu.style.display = 'block';
  };
  // Anywhere else closes it, including the panel behind — but not a click inside the menu,
  // which is how the creation form survives long enough to be filled in.
  document.addEventListener('mousedown', (ev) => {
    if (menu.style.display === 'none') return;
    if (ev.target.closest?.('#detail-tag-picker')) return;
    close();
  });
}
