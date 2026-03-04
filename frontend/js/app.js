/**
 * app.js — Main application controller
 * Entry point for Better Mod Manager frontend
 */

import { initProfiles, renderProfiles, updateProfileChip } from './profiles.js';
import { initMods, refreshMods } from './mods.js';
import { initI18n, setLang, getLang, applyTranslations, getLanguages } from './i18n.js';
import { shouldShowOnboarding, startOnboarding } from './onboarding.js';

// ── Tauri bridge ──────────────────────────────────────────
let _invoke;
let _dialog;
let _notifModule;

async function loadTauri() {
    try {
        const tauriModule = await import('https://unpkg.com/@tauri-apps/api@1/tauri.js');
        const dialogModule = await import('https://unpkg.com/@tauri-apps/api@1/dialog.js');
        _notifModule = await import('https://unpkg.com/@tauri-apps/api@1/notification.js');
        _invoke = tauriModule.invoke;
        _dialog = dialogModule;
    } catch {
        // Dev / browser mode fallback — mock Tauri
        console.warn('[BMM] Running in browser mock mode');
        _invoke = mockInvoke;
        _dialog = { open: async () => 'C:\\mock\\folder' };
        _notifModule = null;
    }
}

export async function invoke(command, args = {}) {
    return _invoke(command, args);
}

export async function pickFolder() {
    try {
        return await _dialog.open({ directory: true, multiple: false });
    } catch {
        return null;
    }
}

export async function pickFile(filters = []) {
    try {
        return await _dialog.open({ multiple: false, filters });
    } catch {
        return null;
    }
}

export async function saveFile(filters = []) {
    try {
        const saveDialog = await import('https://unpkg.com/@tauri-apps/api@1/dialog.js');
        return await saveDialog.save({ filters });
    } catch {
        return null;
    }
}

export async function listenFileDrop(callback) {
    try {
        const { listen } = await import('https://unpkg.com/@tauri-apps/api@1/event.js');
        return await listen('tauri://file-drop', e => {
            if (e.payload && e.payload.length > 0) {
                callback(e.payload);
            }
        });
    } catch {
        console.warn('[BMM] File drop not supported in browser mockup');
        return () => { };
    }
}

export async function sendOsNotification(title, body) {
    if (localStorage.getItem('bmm_sysNotif') !== 'true') return;
    try {
        let notif = _notifModule;
        // Fallback: try window.__TAURI__
        if (!notif && window.__TAURI__?.notification) {
            notif = window.__TAURI__.notification;
        }
        if (!notif) return;

        let permission = await notif.isPermissionGranted();
        if (!permission) {
            permission = (await notif.requestPermission()) === 'granted';
        }
        if (permission) {
            notif.sendNotification({ title, body });
        }
    } catch (e) {
        console.warn('Notification failed:', e);
    }
}

// ── Toast ─────────────────────────────────────────────────
export function toast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<div class="toast-dot"></div><span>${message}</span>`;
    container.appendChild(el);

    const remove = () => {
        el.classList.add('removing');
        el.addEventListener('animationend', () => el.remove(), { once: true });
    };

    setTimeout(remove, duration);
}

// ── Navigation ────────────────────────────────────────────
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item[data-view]');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const viewId = item.dataset.view;
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById('view-' + viewId)?.classList.add('active');
        });
    });
}

// ── Modals ────────────────────────────────────────────────
function initModals() {
    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.close;
            document.getElementById(id)?.classList.remove('open');
        });
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) overlay.classList.remove('open');
        });
    });
}

// ── Titlebar ──────────────────────────────────────────────
async function initTitlebar() {
    try {
        const { appWindow } = await import('https://unpkg.com/@tauri-apps/api@1/window.js');
        document.getElementById('tb-min')?.addEventListener('click', () => appWindow.minimize());
        document.getElementById('tb-max')?.addEventListener('click', () => appWindow.toggleMaximize());
        document.getElementById('tb-close')?.addEventListener('click', () => appWindow.close());
    } catch {
        // Browser mode: just hide close button behavior
        document.getElementById('tb-close')?.addEventListener('click', () => window.close());
    }
}

// ── Modlist view ──────────────────────────────────────────
let lastImportedModlistJson = null;

function initModlist() {
    const exportBtn = document.getElementById('btn-export-mm');
    const importBtn = document.getElementById('btn-import-mm');
    const exportCard = document.getElementById('export-form-card');
    const cancelExport = document.getElementById('btn-cancel-export');
    const confirmExportBtn = document.getElementById('btn-confirm-export');
    const previewCard = document.getElementById('imported-preview');
    const installBtn = document.getElementById('btn-install-from-mm');

    exportBtn.addEventListener('click', () => {
        exportCard.style.display = exportCard.style.display === 'none' ? '' : 'none';
        previewCard.style.display = 'none';
    });

    cancelExport.addEventListener('click', () => { exportCard.style.display = 'none'; });

    confirmExportBtn.addEventListener('click', async () => {
        const listName = document.getElementById('mm-list-name').value.trim() || 'Ma liste';
        const description = document.getElementById('mm-description').value.trim();
        const author = document.getElementById('mm-author').value.trim();

        const path = await saveFile([{ name: 'Mod List', extensions: ['mm', 'json'] }]);
        if (!path) return;

        try {
            await invoke('export_modlist', { listName, description, author, outputPath: path });
            toast('Liste .MM exportée avec succès.', 'success');
            exportCard.style.display = 'none';
        } catch (err) {
            toast('Erreur export : ' + err, 'error');
        }
    });

    importBtn.addEventListener('click', async () => {
        const path = await pickFile([{ name: 'Mod List', extensions: ['mm', 'json'] }]);
        if (!path) return;
        try {
            const modList = await invoke('import_modlist', { path });
            lastImportedModlistJson = JSON.stringify(modList);
            exportCard.style.display = 'none';
            previewCard.style.display = '';
            renderImportedModlist(modList);
            toast('Liste importée.', 'success');
        } catch (err) {
            toast('Erreur import : ' + err, 'error');
        }
    });

    // Install all mods from imported .MM list
    installBtn.addEventListener('click', async () => {
        if (!lastImportedModlistJson) {
            toast('Aucune liste importée.', 'warning');
            return;
        }
        installBtn.disabled = true;
        installBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;vertical-align:middle;margin-right:6px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Installation en cours...';
        try {
            const results = await invoke('install_from_modlist', { modlistJson: lastImportedModlistJson });
            // Show results
            const resultHtml = results.map(r => `<div style="padding:3px 0;font-size:12px;font-family:var(--font-mono)">${r}</div>`).join('');
            const resultsDiv = document.createElement('div');
            resultsDiv.style.cssText = 'margin-top:12px;padding:12px;background:rgba(0,0,0,0.3);border-radius:8px;border:1px solid var(--border)';
            resultsDiv.innerHTML = `<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.06em">Résultats d'installation</div>${resultHtml}`;
            previewCard.appendChild(resultsDiv);

            const successCount = results.filter(r => r.startsWith('[OK]')).length;
            toast(`${successCount}/${results.length} mod(s) installé(s).`, 'success');
            await refreshMods();
        } catch (err) {
            toast('Erreur installation : ' + err, 'error');
        }
        installBtn.disabled = false;
        installBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Tout installer`;
    });
}

function renderImportedModlist(modlist) {
    const container = document.getElementById('imported-content');
    container.innerHTML = `
    <div style="margin-bottom:14px">
      <p style="font-size:16px;font-weight:700;color:var(--text-primary)">${escHtml(modlist.name)}</p>
      <p style="font-size:12px;color:var(--text-muted);font-family:var(--font-mono)">
        ${modlist.game_name || '—'} • par ${modlist.author || '—'} • v${modlist.format_version}
      </p>
      ${modlist.game_path_hint ? `<p style="margin-top:4px;font-size:11px;color:var(--text-muted)"><span style="color:var(--cyan)">ROOT:</span> ${escHtml(modlist.game_path_hint)}</p>` : ''}
      ${modlist.description ? `<p style="margin-top:8px;font-size:13px;color:var(--text-secondary)">${escHtml(modlist.description)}</p>` : ''}
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${modlist.mods.map(m => `
        <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;padding:12px 14px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
            <span style="font-weight:600">${escHtml(m.name)}</span>
            <span style="font-family:var(--font-mono);font-size:11px;color:var(--cyan)">v${escHtml(m.version)}</span>
            <span style="font-size:11px;color:var(--text-muted)">priorité: ${m.sort_priority}</span>
          </div>
          ${m.description ? `<p style="font-size:12px;color:var(--text-muted);margin-bottom:6px">${escHtml(m.description)}</p>` : ''}
          ${(m.download_links && m.download_links.length > 0) ? `
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">
              ${m.download_links.map(dl => `
                <a style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--accent);font-family:var(--font-mono);background:var(--accent-dim);padding:3px 8px;border-radius:6px;text-decoration:none" href="${escHtml(dl.url)}" target="_blank">
                  ${getLinkIcon(dl.link_type)} ${escHtml(dl.label || dl.url)}
                </a>
              `).join('')}
            </div>
          ` : ''}
          ${(m.file_tree && m.file_tree.length > 0) ? `
            <details style="margin-top:6px">
              <summary style="font-size:11px;color:var(--cyan);cursor:pointer;font-family:var(--font-mono)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>Arborescence (${m.file_tree.length} fichier${m.file_tree.length > 1 ? 's' : ''})
              </summary>
              <div style="max-height:150px;overflow-y:auto;margin-top:6px;padding:6px 8px;background:rgba(0,0,0,0.3);border-radius:6px;font-size:10.5px;font-family:var(--font-mono);color:var(--text-muted)">
                ${m.file_tree.map(f => `<div style="padding:1px 0;display:flex;align-items:center;gap:4px">${f.is_directory ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'} ${escHtml(f.relative_path)} ${!f.is_directory ? `<span style="color:var(--text-muted);opacity:0.5">(${formatBytes(f.size)})</span>` : ''}</div>`).join('')}
              </div>
            </details>
          ` : ''}
          ${m.install_notes ? `<p style="font-size:11px;color:var(--warning);margin-top:4px;display:flex;align-items:center;gap:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${escHtml(m.install_notes)}</p>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function getLinkIcon(type) {
    switch (type) {
        case 'github': return 'GitHub';
        case 'google_drive': return 'GDrive';
        case 'mega': return 'MEGA';
        case 'direct': return 'Direct';
        default: return 'Link';
    }
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ── Settings keyboard shortcuts ────────────────────────────
export function getShortcuts() {
    return JSON.parse(localStorage.getItem('bmm_shortcuts')) || {
        "newProfile": "n",
        "addMod": "m",
        "exportModlist": "e",
        "importModlist": "i"
    };
}

function initShortcuts() {
    document.addEventListener('keydown', e => {
        if (e.ctrlKey) {
            const sc = getShortcuts();
            const key = e.key.toLowerCase();

            if (key === sc.newProfile) {
                e.preventDefault();
                document.getElementById('nav-profiles').click();
                setTimeout(() => document.getElementById('btn-new-profile')?.click(), 50);
            } else if (key === sc.addMod) {
                e.preventDefault();
                document.getElementById('nav-library').click();
                setTimeout(() => document.getElementById('btn-add-mod')?.click(), 50);
            } else if (key === sc.exportModlist) {
                e.preventDefault();
                document.getElementById('nav-modlist').click();
                setTimeout(() => document.getElementById('btn-export-mm')?.click(), 100);
            } else if (key === sc.importModlist) {
                e.preventDefault();
                document.getElementById('nav-modlist').click();
                setTimeout(() => document.getElementById('btn-import-mm')?.click(), 100);
            }
        }
    });
}

function renderSettingsShortcuts() {
    const sc = getShortcuts();
    const updateShortcut = (id, keyName) => {
        const input = document.getElementById(id);
        if (input) {
            input.value = sc[keyName];
            input.addEventListener('keydown', e => {
                e.preventDefault();
                const newKey = e.key.toLowerCase();
                if (newKey !== 'control' && newKey !== 'shift' && newKey !== 'alt') {
                    sc[keyName] = newKey;
                    localStorage.setItem('bmm_shortcuts', JSON.stringify(sc));
                    input.value = newKey;
                    toast('Raccourci mis à jour (' + newKey + ')', 'success');
                }
            });
        }
    };
    updateShortcut('sc-new-profile', 'newProfile');
    updateShortcut('sc-add-mod', 'addMod');
    updateShortcut('sc-export-mm', 'exportModlist');
    updateShortcut('sc-import-mm', 'importModlist');
}

// ── Mock backend (browser dev mode) ───────────────────────
const _mockState = { profiles: [], mods: [], activeProfileId: null };

async function mockInvoke(cmd, args = {}) {
    await new Promise(r => setTimeout(r, 60)); // simulate latency
    switch (cmd) {
        case 'get_profiles': return [..._mockState.profiles];
        case 'get_active_profile_id': return _mockState.activeProfileId;
        case 'set_active_profile': _mockState.activeProfileId = args.profileId; return null;
        case 'create_profile': {
            const p = {
                id: crypto.randomUUID(), name: args.name, game_name: args.gameName,
                game_path: args.gamePath, mods_path: args.modsPath, backup_path: args.backupPath,
                active_mods: [], created_at: new Date().toISOString()
            };
            _mockState.profiles.push(p);
            if (!_mockState.activeProfileId) _mockState.activeProfileId = p.id;
            return p;
        }
        case 'delete_profile':
            _mockState.profiles = _mockState.profiles.filter(p => p.id !== args.profileId);
            return null;
        case 'get_mods': return [..._mockState.mods];
        case 'add_mod': {
            const m = {
                id: crypto.randomUUID(), name: args.name, version: args.version || '1.0.0',
                author: args.author || '', description: args.description || '', enabled: false,
                mod_folder_path: args.modFolderPath, status: 'Disabled', added_at: new Date().toISOString(),
                installed_files: [], download_links: []
            };
            _mockState.mods.push(m);
            return m;
        }
        case 'remove_mod':
            _mockState.mods = _mockState.mods.filter(m => m.id !== args.modId);
            return null;
        case 'enable_mod': {
            const m = _mockState.mods.find(m => m.id === args.modId);
            if (m) { m.enabled = true; m.status = 'Enabled'; m.installed_files = ['mock/file1.txt']; }
            return null;
        }
        case 'disable_mod': {
            const m = _mockState.mods.find(m => m.id === args.modId);
            if (m) { m.enabled = false; m.status = 'Disabled'; m.installed_files = []; }
            return null;
        }
        case 'export_modlist':
            console.log('[mock] export_modlist', args);
            return null;
        case 'import_modlist':
            return {
                format_version: '1.0', name: 'Mock List', game_name: 'Test Game',
                author: 'Tester', description: 'Example mod list with download links',
                created_at: new Date().toISOString(),
                game_path_hint: 'C:\\Games\\Test', mods: [
                    {
                        name: 'Example Mod', version: '2.0', author: 'Someone', description: 'A test mod',
                        download_links: [{ url: 'https://github.com/example/mod', link_type: 'github', label: 'GitHub Repo' }],
                        sort_priority: 10, file_tree: [{ relative_path: 'textures/skin.dds', is_directory: false, size: 2048000 }],
                        install_notes: ''
                    }
                ]
            };
        case 'add_download_link': {
            const m = _mockState.mods.find(m => m.id === args.modId);
            if (m) m.download_links.push({ url: args.url, link_type: args.linkType, label: args.label });
            return null;
        }
        case 'remove_download_link': {
            const m = _mockState.mods.find(m => m.id === args.modId);
            if (m && args.linkIndex < m.download_links.length) m.download_links.splice(args.linkIndex, 1);
            return null;
        }
        default:
            console.warn('[mock] Unknown command:', cmd);
            return null;
    }
}

function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Navbar Language Dropdown ──────────────────────────────
function initNavbarLangDropdown() {
    const container = document.getElementById('nav-lang-dropdown');
    if (!container) return;

    function render() {
        const langs = getLanguages();
        const current = langs.find(l => l.active) || langs[0];
        container.innerHTML = `
            <button class="nav-lang-btn" id="nav-lang-toggle">
                <span class="nav-lang-flag">${current.flag}</span>
                <span class="nav-lang-name">${current.name}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="nav-lang-chevron"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
            <div class="nav-lang-menu" id="nav-lang-menu">
                ${langs.map(l => `
                    <button class="nav-lang-option ${l.active ? 'active' : ''}" data-lang="${l.code}">
                        <span class="nav-lang-flag">${l.flag}</span>
                        <span>${l.name}</span>
                        ${l.active ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="3" style="margin-left:auto"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                    </button>
                `).join('')}
            </div>
        `;

        const toggle = document.getElementById('nav-lang-toggle');
        const menu = document.getElementById('nav-lang-menu');

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.toggle('open');
            toggle.classList.toggle('open');
        });

        menu.querySelectorAll('.nav-lang-option').forEach(opt => {
            opt.addEventListener('click', () => {
                setLang(opt.dataset.lang);
                menu.classList.remove('open');
                toggle.classList.remove('open');
                render();
                // Re-render dynamic content
                if (window._refreshModsFn) window._refreshModsFn();
            });
        });

        document.addEventListener('click', () => {
            menu.classList.remove('open');
            toggle.classList.remove('open');
        });
    }
    render();
}

// ── Navbar Version Button ────────────────────────────────
function initNavbarVersion() {
    const btn = document.getElementById('nav-version-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        // Reuse the update notes logic
        const showUpdatesBtn = document.getElementById('btn-show-updates');
        if (showUpdatesBtn) showUpdatesBtn.click();
    });
}

// ── Update notes modal ───────────────────────────────────
function initUpdateNotes() {
    const btn = document.getElementById('btn-show-updates');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        // Try to read update files from the Update directory
        let content = '<p style="color:var(--text-muted)">Aucune note de mise à jour disponible.</p>';
        try {
            const notes = await invoke('get_update_notes');
            if (notes && notes.length > 0) {
                content = notes.map(n => renderMarkdown(n.content)).join('<hr style="border-color:var(--border);margin:16px 0">');
            }
        } catch {
            // Fallback: no backend command available yet
            content = '<p style="color:var(--text-muted)">Les notes de mise à jour seront disponibles prochainement.</p>';
        }

        // Create modal dynamically
        let modal = document.getElementById('modal-update-notes');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-update-notes';
            modal.className = 'modal-overlay';
            document.body.appendChild(modal);
        }
        modal.innerHTML = `
            <div class="modal glass" style="max-width:600px;width:90%">
                <div class="modal-header">
                    <h2 class="modal-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px;vertical-align:middle"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>Notes de mise à jour</h2>
                    <button class="modal-close" id="close-update-notes"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                </div>
                <div class="modal-body">
                    <div class="update-notes-content">${content}</div>
                </div>
            </div>
        `;
        modal.classList.add('open');
        modal.querySelector('#close-update-notes').addEventListener('click', () => modal.classList.remove('open'));
        modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
    });
}

// Simple Markdown renderer
function renderMarkdown(md) {
    if (!md) return '';
    return md
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/^- (.*$)/gim, '<li>$1</li>')
        .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
        .replace(/\n/g, '<br>');
}

// ── Boot ──────────────────────────────────────────────────
async function main() {
    await loadTauri();
    await initI18n();
    initNavigation();
    initModals();
    await initTitlebar();
    initModlist();
    initShortcuts();
    initNavbarLangDropdown();
    initNavbarVersion();
    initUpdateNotes();
    applyTranslations();
    await initProfiles();
    await initMods();
    await updateProfileChip();
    await initProfileSelector();

    // Init Settings
    const notifToggle = document.getElementById('setting-sys-notif');
    if (notifToggle) {
        notifToggle.checked = localStorage.getItem('bmm_sysNotif') === 'true';
        notifToggle.addEventListener('change', e => {
            localStorage.setItem('bmm_sysNotif', e.target.checked);
        });
    }

    // Tags Settings
    const btnCreateTag = document.getElementById('btn-create-tag');
    if (btnCreateTag) {
        btnCreateTag.addEventListener('click', async () => {
            const nameInput = document.getElementById('setting-tag-name');
            const colorInput = document.getElementById('setting-tag-color');
            const name = nameInput.value.trim();
            const color = colorInput.value;
            if (!name) return toast('Le nom du tag est requis.', 'error');
            try {
                await invoke('create_tag', { name, color, icon: '' });
                nameInput.value = '';
                toast('Tag créé.', 'success');
                renderSettingsTags();
                // trigger mods refresh to update library UI
                if (window._refreshModsFn) window._refreshModsFn();
            } catch (err) {
                toast('Erreur création tag : ' + err, 'error');
            }
        });
        renderSettingsTags();
    }

    renderSettingsShortcuts();

    const exportBtn = document.getElementById('btn-export-data');
    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            const destPath = await saveFile([{ name: 'App Data Backup', extensions: ['json'] }]);
            if (destPath) {
                try {
                    await invoke('export_app_data', { destPath });
                    toast('Configuration exportée.', 'success');
                } catch (e) {
                    toast('Erreur export : ' + e, 'error');
                }
            }
        });
    }

    const importBtn = document.getElementById('btn-import-data');
    if (importBtn) {
        importBtn.addEventListener('click', async () => {
            const srcPath = await pickFile([{ name: 'App Data Backup', extensions: ['json'] }]);
            if (srcPath) {
                if (confirm('Voulez-vous vraiment écraser votre configuration actuelle ?')) {
                    try {
                        await invoke('import_app_data', { srcPath });
                        toast('Configuration importée avec succès. Redémarrage...', 'success');
                        setTimeout(() => window.location.reload(), 2000);
                    } catch (e) {
                        toast('Erreur import : ' + e, 'error');
                    }
                }
            }
        });
    }

    // Show onboarding on first launch (language is step 0 inside onboarding)
    if (shouldShowOnboarding()) {
        setTimeout(() => startOnboarding(), 500);
    }

    const restartBtn = document.getElementById('btn-restart-onboarding');
    if (restartBtn) {
        restartBtn.addEventListener('click', () => {
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.querySelectorAll('.nav-item').forEach(v => v.classList.remove('active'));
            document.getElementById('view-library').classList.add('active');
            startOnboarding();
        });
    }
}

// ── Profile selector in Library ───────────────────────────
async function initProfileSelector() {
    const select = document.getElementById('lib-profile-select');
    if (!select) return;

    try {
        const profiles = await invoke('get_profiles');
        // Keep the first placeholder option
        select.innerHTML = `<option value="">${select.querySelector('option').textContent}</option>`;
        let activeId = null;
        try {
            const active = await invoke('get_active_profile');
            activeId = active?.id;
        } catch { }
        profiles.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name + (p.game_name ? ` — ${p.game_name}` : '');
            if (p.id === activeId) opt.selected = true;
            select.appendChild(opt);
        });
    } catch {
        // Mock mode — leave empty
    }

    select.addEventListener('change', async () => {
        const id = select.value;
        if (!id) return;
        try {
            await invoke('set_active_profile', { profileId: id });
            await updateProfileChip();
            if (window._refreshModsFn) await window._refreshModsFn();
            applyTranslations();
        } catch (e) {
            toast('Erreur chargement profil : ' + e, 'error');
        }
    });
}

async function renderSettingsTags() {
    const list = document.getElementById('settings-tags-list');
    if (!list) return;
    try {
        const tags = await invoke('get_tags');
        list.innerHTML = '';
        if (tags.length === 0) {
            list.innerHTML = '<span style="color:var(--text-muted);font-size:12px;font-style:italic">Aucun tag personnalisé pour le moment.</span>';
            return;
        }
        tags.forEach(t => {
            const chip = document.createElement('div');
            chip.style.cssText = `display:flex;align-items:center;gap:4px;background:${t.color}20;color:${t.color};border:1px solid ${t.color}40;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600`;
            chip.innerHTML = `<span>${String(t.name).replace(/</g, '&lt;')}</span><button data-id="${t.id}" class="btn-del-tag" style="background:none;border:none;color:inherit;cursor:pointer;padding:0;margin-left:6px;font-size:14px" title="Supprimer">&times;</button>`;
            list.appendChild(chip);
        });

        list.querySelectorAll('.btn-del-tag').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (confirm('Voulez-vous vraiment supprimer ce tag ? Il sera retiré de tous les mods.')) {
                    try {
                        await invoke('delete_tag', { tagId: btn.dataset.id });
                        toast('Tag supprimé.', 'success');
                        renderSettingsTags();
                        if (window._refreshModsFn) window._refreshModsFn();
                    } catch (err) {
                        toast('Erreur suppression tag : ' + err, 'error');
                    }
                }
            });
        });
    } catch (err) {
        console.error("Tags error", err);
    }
}

main().catch(console.error);
