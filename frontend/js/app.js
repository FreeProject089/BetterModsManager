/**
 * app.js — Main application controller
 * Entry point for Better Mod Manager frontend
 */

import { initProfiles, renderProfiles, updateProfileChip } from './profiles.js';
import { initMods, refreshMods } from './mods.js';
import { initI18n, setLang, getLang, applyTranslations, getLanguages, t } from './i18n.js';
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

            // Auto-sync when entering library
            if (viewId === 'library') {
                window._refreshModsFn?.(true);
            }
        });
    });

    // Auto-detect when app regained focus
    window.addEventListener('focus', () => {
        const libView = document.getElementById('view-library');
        if (libView && libView.classList.contains('active')) {
            window._refreshModsFn?.(true);
        }
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
            toast(t('mm.exportSuccess'), 'success');
            exportCard.style.display = 'none';
        } catch (err) {
            toast(t('mm.exportError').replace('{err}', err), 'error');
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
            toast(t('mm.importSuccess'), 'success');
        } catch (err) {
            toast(t('mm.importError').replace('{err}', err), 'error');
        }
    });

    // Install all mods from imported .MM list
    installBtn.addEventListener('click', async () => {
        if (!lastImportedModlistJson) {
            toast(t('mm.installNone'), 'warning');
            return;
        }
        installBtn.disabled = true;
        installBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;vertical-align:middle;margin-right:6px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> ${t('common.installing')}`;
        try {
            const results = await invoke('install_from_modlist', { modlistJson: lastImportedModlistJson });
            const resultHtml = results.map(r => {
                const isOk = r.startsWith('[OK]');
                const txt = r.replace(/^\[OK\] |^\[ERR\] /g, '');
                return `<div style="padding:2px 0;font-size:11.5px;font-family:var(--font-mono);color:var(--text-primary);display:flex;align-items:center;gap:6px">
                    ${isOk ? '<div style="background:var(--success);color:#000;border-radius:2px;padding:0 2px;display:flex;align-items:center"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>' : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'} 
                    ${escHtml(txt)}
                </div>`;
            }).join('');
            const resultsDiv = document.createElement('div');
            resultsDiv.style.cssText = 'margin-top:12px;padding:12px;background:rgba(0,0,0,0.3);border-radius:8px;border:1px solid var(--border)';
            resultsDiv.innerHTML = `<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.06em">${t('mm.installResults')}</div>${resultHtml}`;
            previewCard.appendChild(resultsDiv);

            const successCount = results.filter(r => r.startsWith('[OK]')).length;
            toast(t('mm.installSuccess').replace('{success}', successCount).replace('{total}', results.length), 'success');
            await refreshMods();
        } catch (err) {
            toast(t('mm.installError').replace('{err}', err), 'error');
        }
        installBtn.disabled = false;
        installBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ${t('mm.installAll')}`;
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
      ${modlist.mods.map(m => `
        <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:6px;padding:8px 12px;display:flex;flex-direction:column;gap:4px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-weight:600;font-size:13px">${escHtml(m.name)}</span>
            <span style="font-family:var(--font-mono);font-size:10px;color:var(--cyan)">v${escHtml(m.version)}</span>
            <span style="font-size:10px;color:var(--text-muted)">priorité: ${m.sort_priority}</span>
          </div>
          ${(m.file_tree && m.file_tree.length > 0) ? `
            <details>
              <summary style="font-size:11px;color:var(--cyan);cursor:pointer;font-family:var(--font-mono);display:flex;align-items:center;gap:4px">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> Arborescence (${m.file_tree.length} fichier${m.file_tree.length > 1 ? 's' : ''})
              </summary>
              <div style="max-height:120px;overflow-y:auto;margin-top:4px;padding:4px 0 0 12px;font-size:10px;font-family:var(--font-mono);color:var(--text-muted)">
                ${m.file_tree.map(f => `<div style="padding:1px 0;display:flex;align-items:center;gap:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escHtml(f.relative_path)}">${f.is_directory ? '📁' : '📄'} ${escHtml(f.relative_path)} <span style="color:var(--text-muted);opacity:0.5">${f.is_directory ? '' : `(${formatBytes(f.size)})`}</span></div>`).join('')}
              </div>
            </details>
          ` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function getLinkIcon(type) {
    const style = 'width:14px;height:14px;vertical-align:middle;margin-right:6px;opacity:0.8';
    switch (type) {
        case 'github':
            return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>`;
        case 'google_drive':
            return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M22 10L14 10L14 2L22 10Z"/><path d="M6 22L14 22L22 10L14 10L6 22Z"/><path d="M2 10L10 10L6 22L2 10Z"/></svg>`;
        case 'mega':
            return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M12 3l9 4v10l-9 4-9-4V7l9-4z"/><path d="M12 8v8M8 12h8"/></svg>`;
        case 'direct':
            return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
        default:
            return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="${style}"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>`;
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
        const flagFr = `<svg width="14" height="10" viewBox="0 0 3 2" style="margin-right:8px;vertical-align:middle"><rect width="1" height="2" fill="#002395"/><rect width="1" height="2" x="1" fill="#fff"/><rect width="1" height="2" x="2" fill="#ED2939"/></svg>`;
        const flagEn = `<svg width="14" height="10" viewBox="0 0 60 30" style="margin-right:8px;vertical-align:middle"><clipPath id="s2"><path d="M0,0 v30 h60 v-30 z"/></clipPath><clipPath id="t2"><path d="M30,15 h30 v15 z v0 h-30 z v-15 h-30 z v0 h30 z"/></clipPath><g clip-path="url(#s2)"><path d="M0,0 v30 h60 v-30 z" fill="#012169"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" stroke-width="4" clip-path="url(#t2)"/><path d="M30,0 v30 M0,15 h60" stroke="#fff" stroke-width="10"/><path d="M30,0 v30 M0,15 h60" stroke="#C8102E" stroke-width="6"/></g></svg>`;

        const getFlag = (code) => code === 'fr' ? flagFr : flagEn;

        container.innerHTML = `
            <button class="nav-lang-btn" id="nav-lang-toggle">
                <span class="nav-lang-flag">${getFlag(current.code)}</span>
                <span class="nav-lang-name">${current.name}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="nav-lang-chevron"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
            <div class="nav-lang-menu" id="nav-lang-menu">
                ${langs.map(l => `
                    <button class="nav-lang-option ${l.active ? 'active' : ''}" data-lang="${l.code}">
                        <span class="nav-lang-flag">${getFlag(l.code).replace('margin-right:8px', 'margin-right:10px')}</span>
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
                updateLibraryProfileSelector();
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
        let notes = [];
        let oldNotes = [];
        try {
            notes = await invoke('get_update_notes', { subDir: null });
            oldNotes = await invoke('get_update_notes', { subDir: 'Old_Update' });
        } catch (e) { console.error(e); }

        const allNotes = [...notes, ...oldNotes];

        let modal = document.getElementById('modal-update-notes');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-update-notes';
            modal.className = 'modal-overlay';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="modal glass" style="max-width:900px; width:95%; height:80vh; display:flex; flex-direction:column;">
                <div class="modal-header" style="flex-shrink:0">
                    <h2 class="modal-title" style="display:flex; align-items:center; gap:10px;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        ${t('update.title')}
                    </h2>
                    <button class="modal-close" id="close-update-notes"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                </div>
                <div class="modal-body" style="padding:0; flex:1; overflow:hidden;">
                    <div class="archive-modal-container" style="display:flex; height:100%;">
                        <div class="archive-sidebar" id="archive-sidebar" style="width:260px; background:rgba(0,0,0,0.2); border-right:1px solid var(--border); overflow-y:auto; padding:12px 0;">
                            
                            <div class="tree-group" style="margin-bottom:16px;">
                                <div class="tree-label" style="padding:0 16px 8px; font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:6px;">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                                    Release Notes
                                </div>
                                ${notes.map((n, i) => `
                                    <div class="archive-sidebar-item ${i === 0 ? 'active' : ''}" data-index="${i}" style="padding:8px 16px; font-size:13px; cursor:pointer; display:flex; align-items:center; gap:10px; transition:var(--transition); border-left:2px solid transparent;">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(n.filename)}</span>
                                    </div>
                                `).join('')}
                            </div>

                            <div class="tree-group">
                                <div class="tree-label" style="padding:0 16px 8px; font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:6px;">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                                    Archives
                                </div>
                                ${oldNotes.map((n, i) => `
                                    <div class="archive-sidebar-item" data-index="${notes.length + i}" style="padding:8px 16px; font-size:13px; cursor:pointer; display:flex; align-items:center; gap:10px; transition:var(--transition); border-left:2px solid transparent;">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(n.filename)}</span>
                                    </div>
                                `).join('')}
                            </div>

                        </div>
                        <div class="archive-content" id="archive-content" style="flex:1; overflow-y:auto; padding:32px; background:var(--bg-primary);">
                            ${allNotes.length > 0 ? renderMarkdown(allNotes[0].content) : `<p style="color:var(--text-muted)">${t('update.none')}</p>`}
                        </div>
                    </div>
                </div>
            </div>
        `;
        modal.classList.add('open');
        modal.querySelector('#close-update-notes').addEventListener('click', () => modal.classList.remove('open'));
        modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });

        // Sidebar selection logic
        const sidebarItems = modal.querySelectorAll('.archive-sidebar-item');
        const contentArea = modal.querySelector('#archive-content');

        sidebarItems.forEach(item => {
            item.addEventListener('click', () => {
                sidebarItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                const note = allNotes[item.dataset.index];
                contentArea.innerHTML = renderMarkdown(note.content);
                contentArea.scrollTop = 0;
            });
        });
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

    // ── Sync App Version ──
    try {
        const v = await invoke('get_app_version');
        document.querySelectorAll('.titlebar-version').forEach(el => el.textContent = 'V' + v);
        document.querySelectorAll('.footer-version-pill').forEach(el => el.textContent = 'v' + v);
        document.querySelectorAll('.about-version').forEach(el => el.textContent = 'v' + v + ' — Vanguard Workstation');

        const heroVer = document.getElementById('credits-hero-version');
        if (heroVer) heroVer.textContent = 'v' + v;

        const creditsSub = document.getElementById('credits-version-subtitle');
        if (creditsSub) creditsSub.textContent = t('credits.subtitle', { version: v });
    } catch (e) { console.warn("Failed to sync version:", e); }

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
    await updateLibraryProfileSelector();


    // Show happy tasky when everything is ready
    const loaderImg = document.getElementById('loader-img');
    const loaderText = document.getElementById('loader-text');
    if (loaderImg) loaderImg.src = 'assets/Tasky_Happy.png';
    if (loaderText) loaderText.textContent = 'CHARGÉ !';

    // Hide loader smoothly after a small delay to see the happy face
    const loader = document.getElementById('app-loader');
    if (loader) {
        setTimeout(() => {
            loader.style.opacity = '0';
            loader.style.visibility = 'hidden';
            setTimeout(() => loader.remove(), 600);
        }, 800);
    }

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
export async function updateLibraryProfileSelector() {
    const select = document.getElementById('lib-profile-select');
    if (!select) return;

    try {
        const profiles = await invoke('get_profiles');
        const activeId = await invoke('get_active_profile_id');

        // Always include/reset to the placeholder as the first option
        select.innerHTML = `<option value="" data-i18n="lib.selectProfile">${t('lib.selectProfile') || '— Select a profile —'}</option>`;

        profiles.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name + (p.game_name ? ` — ${p.game_name}` : '');
            if (p.id === activeId) opt.selected = true;
            select.appendChild(opt);
        });

        // Add change listener only once
        if (!select._hasListener) {
            select.addEventListener('change', async () => {
                const id = select.value;
                if (!id) return;
                try {
                    await invoke('set_active_profile', { profileId: id });
                    await updateProfileChip();
                    if (window._refreshModsFn) await window._refreshModsFn();
                    await updateLibraryProfileSelector(); // Keep labels in sync
                    applyTranslations();
                } catch (e) {
                    toast('Erreur chargement profil : ' + e, 'error');
                }
            });
            select._hasListener = true;
        }
    } catch (err) {
        console.warn("Profile selector update failed:", err);
    }
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

// ── Licenses ──────────────────────────────────────────────
async function openLicenseModal() {
    const modal = document.getElementById('modal-license');
    const contentEl = document.getElementById('license-content');
    if (!modal || !contentEl) return;

    modal.classList.add('open');
    contentEl.textContent = t('common.loading');

    try {
        const text = await invoke('get_license_text');
        contentEl.textContent = text;
    } catch (err) {
        contentEl.textContent = "Error loading license: " + err;
    }
}

// Global expose for onclick
window.openLicenseModal = openLicenseModal;

main().catch(console.error);
