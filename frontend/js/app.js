/**
 * app.js — Main application controller
 * Entry point for Better Mod Manager frontend
 */

import { initProfiles, renderProfiles, updateProfileChip } from './profiles.js';
import { initMods, refreshMods } from './mods.js';
import { initI18n, setLang, getLang, applyTranslations, getLanguages, t } from './i18n.js';
import { initBenchmark } from './benchmark.js';
import { shouldShowOnboarding, startOnboarding } from './onboarding.js';

// ── Tauri bridge ──────────────────────────────────────────
import { loadTauri, invoke, pickFolder, pickFile, saveFile, listenFileDrop, sendOsNotification } from './api.js';

export { invoke, pickFolder, pickFile, saveFile, listenFileDrop, sendOsNotification };


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

            invoke('log_frontend_line', { line: `Navigated to view: ${viewId}` });

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
        const detailOpen = !!document.getElementById('mod-detail-panel');
        if (libView && libView.classList.contains('active') && !detailOpen) {
            window._refreshModsFn?.(true);
        }
    });
}

// ── Modals ────────────────────────────────────────────────
function initModals() {
    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.close;
            invoke('log_frontend_line', { line: `Modal closed: ${id}` });
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

        // Sync the current path hint back into the JSON before sending to backend
        const pathHintEl = document.getElementById('imported-path-hint');
        if (pathHintEl) {
            const currentList = JSON.parse(lastImportedModlistJson);
            currentList.game_path_hint = pathHintEl.textContent;
            lastImportedModlistJson = JSON.stringify(currentList);
        }

        const createProfile = document.getElementById('chk-import-as-profile')?.checked || false;

        installBtn.disabled = true;
        installBtn.classList.add('loading');
        installBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;vertical-align:middle;margin-right:6px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> ${t('common.installing')}`;

        // Show progress UI
        const progressOverlay = document.getElementById('imported-progress-overlay');
        const progressList = document.getElementById('imported-progress-list');
        if (progressOverlay) progressOverlay.style.display = 'flex';
        if (progressList) progressList.innerHTML = '';

        // Reset Cancel button state
        const cancelBtn = document.getElementById('btn-cancel-import-dl');
        if (cancelBtn) {
            cancelBtn.disabled = false;
            cancelBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="margin-right:6px"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> ${t('prof.cancel').toUpperCase()}`;
        }

        // Clear previous results
        const existingResults = previewCard.querySelectorAll('.install-results-container');
        existingResults.forEach(r => r.remove());

        try {
            const results = await invoke('install_from_modlist', {
                modlistJson: lastImportedModlistJson,
                createProfile: createProfile,
                githubToken: getGithubPat()
            });

            // Final results summary
            const resultHtml = results.map(r => {
                const isOk = r.startsWith('[OK]') || r.includes('✅');
                const txt = r.replace(/^\[OK\] |^\[ERR\] |^✅ |^❌ /g, '');
                return `<div style="padding:4px 0;font-size:11.5px;font-family:var(--font-mono);color:var(--text-primary);display:flex;align-items:center;gap:8px">
                    ${isOk ? '<div style="background:var(--success);color:#000;border-radius:2px;padding:0 4px;font-size:9px;font-weight:800">OK</div>' : '<div style="background:var(--danger);color:white;border-radius:2px;padding:0 4px;font-size:9px;font-weight:800">ERR</div>'} 
                    ${escHtml(txt)}
                </div>`;
            }).join('');

            const resultsDiv = document.createElement('div');
            resultsDiv.className = 'install-results-container';
            resultsDiv.style.cssText = 'margin-top:12px;padding:16px;background:rgba(0,0,0,0.4);border-radius:10px;border:1px solid var(--border);box-shadow:0 4px 12px rgba(0,0,0,0.2)';
            resultsDiv.innerHTML = `<div style="font-size:10px;color:var(--accent);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.08em;font-weight:800">${t('mm.installResults')}</div>${resultHtml}`;
            previewCard.appendChild(resultsDiv);

            const successCount = results.filter(r => r.includes('✅') || r.startsWith('[OK]')).length;
            toast(t('mm.installSuccess').replace('{success}', successCount).replace('{total}', results.length), 'success');

            if (createProfile) {
                await renderProfiles();
                // Profile selector in library might need update
                const libraryTab = document.querySelector('.nav-item[data-view="library"]');
                if (libraryTab) libraryTab.click();
            } else {
                await refreshMods();
            }
        } catch (err) {
            if (err.includes('annulée') || err.includes('cancelled')) {
                toast(t('mm.installCancelled'), 'info');
            } else {
                toast(t('mm.installError').replace('{err}', err), 'error');
            }
        } finally {
            installBtn.disabled = false;
            installBtn.classList.remove('loading');
            installBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ${t('mm.installAll')}`;
            if (progressOverlay) {
                setTimeout(() => { progressOverlay.style.display = 'none'; }, 2000);
            }
        }
    });

    // Cancel installation
    previewCard.addEventListener('click', async (e) => {
        const btn = e.target.closest('#btn-cancel-import-dl');
        if (btn) {
            try {
                await invoke('cancel_install_from_modlist');
                btn.disabled = true;
                btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="animation:spin 1s linear infinite;margin-right:6px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> ${t('prof.cancel')}...`;
                toast(t('mm.cancelRequested'), 'info');
            } catch (err) {
                toast(t('mm.cancelError').replace('{err}', err), 'error');
            }
        }
    });

    // Listen for progress events
    import('https://unpkg.com/@tauri-apps/api@1/event.js').then(({ listen }) => {
        listen('bmm://mod-download-progress', (e) => {
            const data = e.payload; // { mod_index, total_mods, mod_name, progress, status }
            const container = document.getElementById('imported-progress-list');
            if (!container) return;

            let row = document.getElementById(`dl-progress-${data.mod_index}`);
            if (!row) {
                row = document.createElement('div');
                row.id = `dl-progress-${data.mod_index}`;
                row.style.cssText = 'margin-bottom:10px; background:rgba(255,255,255,0.03); padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.05)';
                container.appendChild(row);
            }

            row.innerHTML = `
                <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px">
                    <span style="font-weight:600; color:var(--text-primary)">${escHtml(data.mod_name)}</span>
                    <span style="color:var(--accent); font-family:var(--font-mono)">${Math.round(data.progress)}%</span>
                </div>
                <div style="height:4px; background:rgba(255,255,255,0.05); border-radius:2px; overflow:hidden">
                    <div style="height:100%; background:var(--accent); width:${data.progress}%; transition:width 0.2s ease; box-shadow:0 0 8px var(--accent)"></div>
                </div>
                <div style="font-size:9px; color:var(--text-muted); margin-top:4px; text-transform:uppercase">${escHtml(data.status)}</div>
            `;

            // Auto scroll progress list
            container.scrollTop = container.scrollHeight;
        });
    });

    // Handle path override button
    previewCard.addEventListener('click', async (e) => {
        const btn = e.target.closest('#btn-override-import-path');
        if (btn) {
            const newPath = await pickFolder();
            if (newPath) {
                const hintEl = document.getElementById('imported-path-hint');
                if (hintEl) hintEl.textContent = newPath;
                toast('Destination mise à jour.', 'info');
            }
        }
    });
}

function renderImportedModlist(modlist) {
    const container = document.getElementById('imported-content');

    // Calculate totals
    let totalFiles = 0;
    let totalBytes = 0;
    modlist.mods.forEach(m => {
        if (m.file_tree) {
            totalFiles += m.file_tree.length;
            m.file_tree.forEach(f => { totalBytes += (f.size || 0); });
        }
    });

    // Header section
    const headerHtml = `
      <div style="margin-bottom:20px; padding:20px; background:rgba(0,0,0,0.2); border-radius:12px; border:1px solid var(--border)">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px">
            <div>
                <h3 style="font-size:20px; font-weight:800; color:var(--text-primary); margin:0">${escHtml(modlist.name)}</h3>
                <div style="display:flex; align-items:center; gap:8px; margin-top:6px; flex-wrap:wrap">
                    <span style="font-size:10px; font-weight:700; text-transform:uppercase; padding:2px 8px; background:var(--accent-dim); color:var(--accent); border-radius:4px">${t('mm.importedBadge')}</span>
                    <span style="font-size:11px; color:var(--text-muted)">${t('mm.by')} <span style="color:var(--text-secondary); font-weight:600">${escHtml(modlist.author || 'Inconnu')}</span></span>
                    <span style="font-size:11px; color:var(--text-muted)">• v${modlist.format_version}</span>
                </div>
            </div>
            <div style="display:flex; gap:20px; text-align:right">
                <div>
                    <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em">${t('mm.modsCount')}</div>
                    <div style="font-size:20px; font-weight:800; color:var(--accent)">${modlist.mods.length}</div>
                </div>
                <div>
                    <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em">${t('mm.totalWeight')}</div>
                    <div style="font-size:20px; font-weight:800; color:var(--cyan)">${formatBytes(totalBytes)}</div>
                </div>
            </div>
        </div>
        
        <div style="display:flex; align-items:center; gap:10px; padding:12px; background:rgba(255,255,255,0.02); border-radius:10px; border:1px solid var(--border); margin-top:10px">
            <div style="flex:1">
                 <div style="font-size:12px; font-weight:700; color:var(--text-primary)">${t('mm.autoProfile')}</div>
                 <div style="font-size:10px; color:var(--text-muted)">${t('mm.autoProfileDesc')}</div>
            </div>
            <label class="switch">
                <input type="checkbox" id="chk-import-as-profile" checked>
                <span class="slider round"></span>
            </label>
        </div>

        <div style="display:flex; align-items:center; gap:10px; padding:8px 12px; background:rgba(0,255,255,0.03); border-radius:8px; border:1px solid rgba(6,182,212,0.1); margin-top:10px">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <div style="flex:1; min-width:0">
                <div style="font-size:9px; color:var(--text-muted); text-transform:uppercase; font-weight:700">${t('mm.installPath')}</div>
                <div style="font-family:var(--font-mono); font-size:11px; color:var(--cyan); white-space:nowrap; overflow:hidden; text-overflow:ellipsis" id="imported-path-hint">${escHtml(modlist.game_path_hint || '—')}</div>
            </div>
            <button class="btn btn-sm btn-ghost" id="btn-override-import-path" title="Modifier le dossier de destination" style="height:28px; width:28px; border-radius:6px; padding:0; display:flex; align-items:center; justify-content:center">
                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
        </div>
        
        ${modlist.description ? `
            <p style="margin-top:12px; font-size:13px; color:var(--text-secondary); line-height:1.5; border-top:1px solid rgba(255,255,255,0.05); padding-top:12px">
                ${escHtml(modlist.description)}
            </p>
        ` : ''}
      </div>
    `;

    // Cards for each mod
    const modsHtml = modlist.mods.map(m => {
        const fileCount = m.file_tree ? m.file_tree.length : 0;
        const modSize = m.file_tree ? m.file_tree.reduce((acc, f) => acc + (f.size || 0), 0) : 0;

        return `
        <div style="background:var(--bg-card); border:1px solid var(--border); border-radius:10px; padding:12px 16px; margin-bottom:8px; display:flex; flex-direction:column; gap:8px; position:relative; overflow:hidden">
          <div style="position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--accent)"></div>
          
          <div style="display:flex; align-items:center; justify-content:space-between">
            <div style="display:flex; align-items:center; gap:12px">
                <span style="font-weight:700; font-size:14px; color:var(--text-primary)">${escHtml(m.name)}</span>
                <span style="font-family:var(--font-mono); font-size:10px; color:var(--cyan); background:rgba(6,182,212,0.1); padding:1px 6px; border-radius:4px; border:1px solid rgba(6,182,212,0.2)">v${escHtml(m.version)}</span>
                <span style="font-size:10px; color:var(--text-muted); font-family:var(--font-mono)">${formatBytes(modSize)}</span>
            </div>
            <div style="font-size:10px; font-weight:700; font-family:var(--font-mono); padding:2px 6px; border-radius:4px; ${(() => {
                const p = m.sort_priority || 0;
                if (p >= 1000) {
                    const alpha = Math.min(0.8, 0.15 + (p - 1000) / 10000);
                    return `background:rgba(239,68,68,${alpha}); color:${alpha > 0.4 ? 'white' : '#ef4444'}; border:1px solid rgba(239,68,68,${alpha + 0.1})`;
                } else if (p >= 100) {
                    const alpha = Math.min(0.6, 0.15 + (p - 100) / 1000);
                    return `background:rgba(245,158,11,${alpha}); color:${alpha > 0.4 ? 'white' : '#f59e0b'}; border:1px solid rgba(245,158,11,${alpha + 0.1})`;
                } else {
                    const alpha = Math.min(0.4, 0.05 + p / 100);
                    return `background:rgba(255,255,255,${alpha}); color:var(--text-muted); border:1px solid rgba(255,255,255,${alpha + 0.05})`;
                }
            })()}" title="PRIO: ${m.sort_priority}">
                ${m.sort_priority >= 1000 ? 'MAX' : m.sort_priority >= 100 ? 'MED' : 'LOW'}
            </div>
          </div>
          
          ${m.description ? `<p style="font-size:12px; color:var(--text-secondary); margin:0; opacity:0.8">${escHtml(m.description)}</p>` : ''}
          
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap">
            ${m.tags && m.tags.length > 0 ? m.tags.map(t => `<span style="font-size:9px; background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px; color:var(--text-secondary); border:1px solid var(--border)">${escHtml(t)}</span>`).join('') : ''}
            
            ${m.download_links && m.download_links.length > 0 ? m.download_links.map(l => `
                <a href="${l.url}" target="_blank" class="btn btn-sm btn-ghost" style="padding:2px 8px; font-size:10px; height:22px; gap:4px; text-decoration:none; color:var(--accent)">
                    ${getLinkIcon(l.link_type)} ${escHtml(l.label || t('common.link'))}
                </a>
            `).join('') : ''}
          </div>

          ${fileCount > 0 ? `
            <details style="margin-top:4px">
              <summary style="font-size:11px; color:var(--text-muted); cursor:pointer; font-family:var(--font-mono); display:flex; align-items:center; gap:6px; user-select:none">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                ${t('mm.fileTree').replace('{count}', fileCount)}
              </summary>
              <div style="max-height:150px; overflow-y:auto; margin-top:8px; padding:8px; background:rgba(0,0,0,0.2); border-radius:6px; font-size:10.5px; font-family:var(--font-mono); color:var(--text-muted); border:1px solid rgba(255,255,255,0.03)">
                ${m.file_tree.map(f => `
                    <div style="padding:2px 0; display:flex; align-items:center; gap:6px; border-bottom:1px solid rgba(255,255,255,0.02)">
                        <span style="opacity:0.6">${f.is_directory ? '📁' : '📄'}</span> 
                        <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${escAttr(f.relative_path)}">${escHtml(f.relative_path)}</span>
                        ${!f.is_directory ? `<span style="opacity:0.4; font-size:9px">${formatBytes(f.size)}</span>` : ''}
                    </div>
                `).join('')}
              </div>
            </details>
          ` : ''}
        </div>
        `;
    }).join('');

    container.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:4px; position:relative">
            ${headerHtml}
            
            <!-- Progress Overlay -->
            <div id="imported-progress-overlay" style="display:none; position:absolute; top:0; left:0; right:0; bottom:0; background:rgba(10,14,23,0.9); z-index:100; border-radius:12px; flex-direction:column; padding:24px; backdrop-filter:blur(8px)">
                <div style="display:flex; align-items:center; gap:16px; margin-bottom:24px">
                    <div style="width:40px; height:40px; background:var(--accent-dim); border-radius:10px; display:flex; align-items:center; justify-content:center">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5" style="animation:spin 2s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    </div>
                    <div>
                        <h4 style="margin:0; font-size:16px; font-weight:800; color:var(--text-primary)">${t('mm.installingTitle')}</h4>
                        <p style="margin:0; font-size:12px; color:var(--text-muted)">${t('mm.installingDesc')}</p>
                    </div>
                    <button class="btn btn-danger btn-sm" id="btn-cancel-import-dl" style="margin-left:auto; height:32px; padding:0 16px; font-size:11px; font-weight:800">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="margin-right:6px"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        ${t('prof.cancel').toUpperCase()}
                    </button>
                </div>
                <div id="imported-progress-list" style="flex:1; overflow-y:auto; padding-right:8px">
                    <!-- Progress bars injected here -->
                </div>
            </div>

            <div style="padding:0 4px">
                <div style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:10px; display:flex; align-items:center; gap:8px">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                    ${t('mm.installPreview')}
                </div>
                ${modsHtml}
            </div>
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

// ── GitHub PAT helper ─────────────────────────────────────
const GITHUB_PAT_KEY = 'bmm_github_pat';

export function getGithubPat() {
    return localStorage.getItem(GITHUB_PAT_KEY) || '';
}

function initGithubPatSettings() {
    const input = document.getElementById('setting-github-pat');
    const saveBtn = document.getElementById('btn-save-github-pat');
    const clearBtn = document.getElementById('btn-clear-github-pat');
    const toggleBtn = document.getElementById('btn-toggle-pat-visibility');
    const statusMsg = document.getElementById('pat-status-msg');
    if (!input) return;

    // Pre-fill from localStorage
    const stored = getGithubPat();
    if (stored) {
        input.value = stored;
        if (statusMsg) statusMsg.innerHTML = `<span style="color:var(--success)">&#10003; Token saved (${stored.length} chars)</span>`;
    }

    // Toggle show/hide
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            const icon = document.getElementById('pat-eye-icon');
            if (icon) {
                if (isPassword) {
                    icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';
                } else {
                    icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
                }
            }
        });
    }

    // Save
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const val = input.value.trim();
            if (!val) {
                if (statusMsg) statusMsg.innerHTML = `<span style="color:var(--warning)">⚠ No token entered. Use Clear to remove the stored token.</span>`;
                return;
            }
            localStorage.setItem(GITHUB_PAT_KEY, val);
            if (statusMsg) statusMsg.innerHTML = `<span style="color:var(--success)">&#10003; Token saved (${val.length} chars)</span>`;
            toast(t('settings.githubPatSaved'), 'success');
        });
    }

    // Clear
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            localStorage.removeItem(GITHUB_PAT_KEY);
            input.value = '';
            input.type = 'password';
            const icon = document.getElementById('pat-eye-icon');
            if (icon) icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
            if (statusMsg) statusMsg.innerHTML = `<span style="color:var(--text-muted)">Token cleared.</span>`;
            toast(t('settings.githubPatCleared'), 'info');
        });
    }

    // "Need Help?" → open Documentation view and reveal the GitHub PAT FAQ entry
    const helpBtn = document.getElementById('btn-pat-need-help');
    if (helpBtn) {
        helpBtn.addEventListener('click', () => {
            // Navigate to Docs view
            const docsNav = document.querySelector('.nav-item[data-view="docs"]');
            if (docsNav) docsNav.click();
            // Small delay to let the view render, then scroll & open the FAQ
            setTimeout(() => {
                const faqEl = document.getElementById('faq-github-pat');
                if (faqEl) {
                    faqEl.open = true;
                    faqEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    faqEl.classList.add('faq-highlight');
                    setTimeout(() => faqEl.classList.remove('faq-highlight'), 2000);
                }
            }, 200);
        });
    }
}

// ── Crash Report UI ───────────────────────────────────────

function initCrashReportUI() {
    // Open Crash Folder (settings card)
    const openFolderBtn = document.getElementById('btn-open-crash-folder');
    if (openFolderBtn) {
        openFolderBtn.addEventListener('click', async () => {
            try {
                await invoke('open_crash_folder');
            } catch (err) {
                toast('Could not open crash folder: ' + err, 'error');
            }
        });
    }

    // Crash modal: "Open in Explorer" button
    const openZipBtn = document.getElementById('btn-crash-open-zip');
    if (openZipBtn) {
        openZipBtn.addEventListener('click', async () => {
            const pathEl = document.getElementById('crash-zip-path');
            const path = pathEl?.textContent?.trim();
            if (path && path !== '—') {
                try {
                    await invoke('open_crash_zip', { path });
                } catch (err) {
                    toast('Could not open zip: ' + err, 'error');
                }
            }
        });
    }
}

/** Call on startup – shows crash modal if a recent zip was generated. */
async function checkPreviousCrash() {
    try {
        const reports = await invoke('get_crash_reports');
        if (!reports || reports.length === 0) return;

        const newest = reports[0]; // already sorted newest-first
        const lastSeen = localStorage.getItem('bmm_last_seen_crash');

        // If we already showed this report, don't show it again
        if (newest === lastSeen) return;

        const pathEl = document.getElementById('crash-zip-path');
        if (pathEl) pathEl.textContent = newest;

        const modal = document.getElementById('modal-crash-report');
        if (modal) {
            // Un crash_*.zip a été détecté et on ne l'a pas encore "vu"
            // On l'affiche systématiquement si c'est nouveau, pour être sûr de ne pas le rater
            modal.classList.add('open');
            localStorage.setItem('bmm_last_seen_crash', newest);
            invoke('log_frontend_line', { line: `Crash modal displayed for: ${newest}` });
        }
    } catch (_) {
        // Tauri not available in browser mode — silently ignore
    }
}

/** Global interaction logger */
function initInteractionLogging() {
    // Log clicks
    document.addEventListener('click', (e) => {
        const target = e.target;
        const btn = target.closest('button');
        const link = target.closest('a');

        if (btn) {
            const text = btn.innerText?.trim() || btn.title || btn.id || 'anonymous button';
            invoke('log_frontend_line', { line: `Click: Button [${text}]` });
        } else if (link) {
            const text = link.innerText?.trim() || link.href;
            invoke('log_frontend_line', { line: `Click: Link [${text}]` });
        }
    }, true);

    // Log scrolls (debounced)
    let scrollTimeout;
    document.addEventListener('scroll', (e) => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            const target = e.target === document ? document.documentElement : e.target;
            if (target && target.scrollTop > 0) {
                const view = document.querySelector('.view.active')?.id || 'unknown';
                invoke('log_frontend_line', { line: `Scroll: View [${view}] at ${target.scrollTop}px` });
            }
        }, 1000);
    }, true);

    // Log keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey) {
            const key = e.key?.toUpperCase();
            if (['N', 'E', 'S', 'F'].includes(key)) {
                invoke('log_frontend_line', { line: `Shortcut: Ctrl+${key}` });
            }
        }
    });

    // Log drag-and-drop
    document.addEventListener('drop', (e) => {
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            const names = Array.from(files).map(f => f.name).join(', ');
            invoke('log_frontend_line', { line: `Drop: ${files.length} file(s) [${names}]` });
        }
    });

    // Log toggle/checkbox changes
    document.addEventListener('change', (e) => {
        const t = e.target;
        if (t.type === 'checkbox' || t.classList?.contains('toggle-switch')) {
            const id = t.id || t.name || 'unknown';
            invoke('log_frontend_line', { line: `Toggle: [${id}] = ${t.checked}` });
        }
        if (t.tagName === 'SELECT') {
            const id = t.id || t.name || 'unknown';
            invoke('log_frontend_line', { line: `Select: [${id}] = ${t.value}` });
        }
    });

    // Log window focus/blur
    window.addEventListener('focus', () => invoke('log_frontend_line', { line: 'Window: Focus gained' }));
    window.addEventListener('blur', () => invoke('log_frontend_line', { line: 'Window: Focus lost' }));

    // Log unhandled JS errors
    window.addEventListener('error', (e) => {
        invoke('log_frontend_line', { line: `[JS-ERROR] ${e.message} at ${e.filename}:${e.lineno}` });
    });

    window.addEventListener('unhandledrejection', (e) => {
        invoke('log_frontend_line', { line: `[JS-PROMISE-ERROR] ${e.reason}` });
    });
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

export function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function escAttr(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ── Navbar Language Dropdown ──────────────────────────────
function initNavbarLangDropdown() {
    const container = document.getElementById('nav-lang-dropdown');
    if (!container) return;

    function render() {
        const langs = getLanguages();
        const current = langs.find(l => l.active) || langs[0];
        const getFlag = (l) => {
            if (!l || !l.flag) return '⚪';

            const f = l.flag.trim();
            // If it's already an emoji (complex character) or a long string, return it as is
            if (f.length > 2) return f;

            // If it's a 2-letter ISO code (e.g., "us", "FR", "de")
            if (f.length === 2) {
                const code = f.toLowerCase();
                // Use flagcdn.com for high quality flags with an offline text fallback
                return `<img src="https://flagcdn.com/w20/${code}.png" 
                             width="20" 
                             height="14" 
                             alt="${f.toUpperCase()}"
                             style="vertical-align: middle; border-radius: 2px; object-fit: cover;"
                             onerror="this.outerHTML='<span style=\\'font-size:10px; font-weight:700\\'>${f.toUpperCase()}</span>'">`;
            }

            return f;
        };

        container.innerHTML = `
            <button class="nav-lang-btn" id="nav-lang-toggle">
                <span class="nav-lang-flag" style="margin-right:8px">${getFlag(current)}</span>
                <span class="nav-lang-name">${current.name}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="nav-lang-chevron"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
            <div class="nav-lang-menu" id="nav-lang-menu">
                ${langs.map(l => `
                    <button class="nav-lang-option ${l.active ? 'active' : ''}" data-lang="${l.code}">
                        <span class="nav-lang-flag" style="margin-right:10px">${getFlag(l)}</span>
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
    if (typeof marked !== 'undefined') {
        return marked.parse(md);
    }
    return md.replace(/\n/g, '<br>');
}

// ── Boot ──────────────────────────────────────────────────
async function main() {
    // ── Version & Build Display ──
    const initVersionDisplay = async () => {
        // Safety delay
        await new Promise(r => setTimeout(r, 300));

        console.log("[BMM] Starting version display initialization...");
        try {
            // Safe extraction of Tauri APIs
            const tauri = window.__TAURI__;
            if (!tauri) {
                console.warn("[BMM] window.__TAURI__ is not available. Skipping version injection.");
                return;
            }

            const getVersion = tauri.app.getVersion;
            const version = await getVersion();
            console.log("[BMM] Found version:", version);

            // Fetch PTB mode
            let isPtb = false;
            try {
                isPtb = await invoke('is_ptb_mode');
            } catch (err) {
                console.warn("[BMM] Failed to fetch PTB mode:", err);
            }

            const suffix = isPtb ? "-PTB" : "";
            const versionStr = `v${version}${suffix}`;

            let buildDate = "Unknown";
            try {
                buildDate = await invoke('get_build_date');
                console.log("[BMM] Found build date:", buildDate);
            } catch (invErr) {
                console.warn("[BMM] get_build_date invoke failed, using current date as fallback:", invErr);
                buildDate = new Date().toISOString().split('T')[0];
            }

            const buildStr = `Build: ${buildDate} — ${versionStr}`;

            const buildDisplay = document.getElementById('app-build-display');
            if (buildDisplay) {
                buildDisplay.textContent = buildStr;
                console.log("[BMM] Updated build display.");
            } else {
                console.warn("[BMM] app-build-display element not found.");
            }

            const versionBadge = document.getElementById('credits-hero-version');
            if (versionBadge) {
                versionBadge.textContent = versionStr;
                console.log("[BMM] Updated version badge.");
            }

            const creditsVerSub = document.getElementById('credits-version-subtitle');
            if (creditsVerSub) {
                creditsVerSub.textContent = `Better Mod Manager — ${versionStr} —`;
                console.log("[BMM] Updated credits subtitle.");
            }

            // Exhaustive sync for all version labels
            document.querySelectorAll('.titlebar-version').forEach(el => el.textContent = 'V' + version);
            document.querySelectorAll('.footer-version-pill').forEach(el => el.textContent = 'v' + version);
            document.querySelectorAll('.about-version').forEach(el => el.textContent = 'v' + version);

        } catch (e) {
            console.error("[BMM] CRITICAL: Failed to init version display:", e);
        }
    };
    await loadTauri();
    await initI18n();

    initNavigation();
    initModals();
    initBenchmark();
    await initTitlebar();
    initModlist();
    initShortcuts();
    initNavbarLangDropdown();
    initNavbarVersion();
    initUpdateNotes();
    applyTranslations();

    // Call this after translations to ensure it's not overwritten and elements are ready
    await initVersionDisplay();

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
    initGithubPatSettings();

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

    // ── Storage Performance Settings ──
    const initStorageSettings = async () => {
        // Open modal button
        const openBtn = document.getElementById('btn-open-storage');
        if (openBtn) {
            openBtn.addEventListener('click', () => {
                const modal = document.getElementById('modal-storage');
                if (modal) { modal.classList.add('open'); renderStorageModal(); }
            });
        }
        // FAQ redirect button
        const faqBtn = document.getElementById('btn-storage-faq');
        if (faqBtn) {
            faqBtn.addEventListener('click', () => {
                document.getElementById('nav-docs')?.click();
                setTimeout(() => {
                    const ioFaq = document.querySelector('[data-i18n="faq.qIo"]');
                    if (ioFaq) {
                        const details = ioFaq.closest('details');
                        if (details) { details.open = true; details.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
                    }
                }, 200);
            });
        }
    };

    const renderStorageModal = async () => {
        const container = document.getElementById('storage-disks-container');
        if (!container) return;

        container.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:13px;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite;margin-bottom:8px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            <div data-i18n="common.loading">Chargement...</div></div>`;

        try {
            const disks = await invoke('get_system_disks');
            if (!disks || disks.length === 0) {
                container.innerHTML = `<div style="font-size:13px;color:var(--text-muted);text-align:center;padding:30px;">Aucun disque détecté.</div>`;
                return;
            }

            const formatBytes = (bytes) => {
                if (bytes >= 1e12) return (bytes / 1e12).toFixed(1) + ' TB';
                if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
                return (bytes / 1e6).toFixed(0) + ' MB';
            };

            const usageTypeLabels = {
                game_directory: { label: t('storage.gameDir') || 'Game Dir', color: '#60a5fa' },
                mod_folder: { label: t('storage.modsDir') || 'Mods', color: '#a78bfa' },
                backup: { label: t('storage.backupDir') || 'Backup', color: '#fbbf24' },
            };

            const getKindBadge = (disk) => {
                if (disk.is_cloud && disk.cloud_provider) {
                    if (disk.kind === 'Network') return `<span style="background:rgba(245,158,11,0.15);color:#fbbf24;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">🌐 ${disk.cloud_provider}</span>`;
                    return `<span style="background:rgba(168,85,247,0.15);color:#c084fc;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">☁️ ${disk.cloud_provider}</span>`;
                }
                if (disk.kind === 'SSD') return '<span style="background:rgba(59,130,246,0.15);color:#60a5fa;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">SSD</span>';
                if (disk.kind === 'HDD') return '<span style="background:rgba(245,158,11,0.15);color:#fbbf24;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">HDD</span>';
                return '<span style="background:rgba(156,163,175,0.15);color:#9ca3af;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;">' + disk.kind + '</span>';
            };

            container.innerHTML = disks.map(disk => {
                const limitVal = disk.current_limit_mb_s || 0;
                const usedPct = disk.total_space_bytes > 0 ? ((disk.total_space_bytes - disk.available_space_bytes) / disk.total_space_bytes * 100).toFixed(0) : 0;
                const usedColor = usedPct > 90 ? '#ef4444' : usedPct > 70 ? '#fbbf24' : '#60a5fa';

                // Profile pills
                let profilePills = '';
                if (disk.profiles_using && disk.profiles_using.length > 0) {
                    profilePills = disk.profiles_using.map(pu => {
                        const info = usageTypeLabels[pu.usage_type] || { label: pu.usage_type, color: '#9ca3af' };
                        return `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,0.05);border:1px solid ${info.color}33;color:${info.color};padding:2px 8px;border-radius:12px;font-size:10px;font-weight:500;">
                            <span style="width:6px;height:6px;border-radius:50%;background:${info.color};flex-shrink:0;"></span>
                            ${pu.profile_name} → ${info.label}
                        </span>`;
                    }).join('');
                }

                // Removed mountSafe because escaping backslashes breaks Rust exact string matching

                return `
                <div style="background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px;transition:border-color 0.2s;" class="storage-disk-card">
                    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px;">
                        <div style="display:flex;align-items:center;gap:12px;min-width:0;">
                            <div style="width:38px;height:38px;background:rgba(59,130,246,0.08);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2">
                                    <rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><line x1="6" y1="12" x2="6.01" y2="12"/>
                                </svg>
                            </div>
                            <div style="min-width:0;">
                                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                                    <span style="font-size:14px;font-weight:700;color:var(--text-bright);">${disk.name}</span>
                                    ${getKindBadge(disk)}
                                    <span style="font-size:10px;color:var(--text-muted);background:rgba(255,255,255,0.04);padding:1px 6px;border-radius:4px;">${disk.file_system}</span>
                                </div>
                                <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${disk.mount_point}</div>
                            </div>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
                            <input type="number" min="0" step="10" class="form-input disk-limit-input" data-mount="${disk.mount_point}" value="${limitVal}" style="width:90px;font-size:13px;padding:6px 8px;text-align:right;border-radius:8px;" placeholder="0">
                            <span style="font-size:12px;color:var(--text-muted);font-weight:600;">MB/s</span>
                        </div>
                    </div>

                    <!-- Capacity bar -->
                    <div style="margin-bottom:8px;">
                        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);margin-bottom:4px;">
                            <span>${formatBytes(disk.total_space_bytes - disk.available_space_bytes)} / ${formatBytes(disk.total_space_bytes)}</span>
                            <span style="color:${usedColor};font-weight:600;">${usedPct}%</span>
                        </div>
                        <div style="height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
                            <div style="height:100%;width:${usedPct}%;background:${usedColor};border-radius:2px;transition:width 0.3s;"></div>
                        </div>
                    </div>

                    ${profilePills ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">${profilePills}</div>` : ''}

                    <!-- Benchmark row -->
                    <div style="display:flex;align-items:center;gap:8px;">
                        <button class="btn btn-ghost btn-sm disk-bench-btn" data-mount="${disk.mount_point}" style="font-size:11px;gap:6px;padding:4px 10px;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                            <span data-i18n="storage.benchmark">${t('storage.benchmark') || 'Tester la vitesse'}</span>
                        </button>
                        <span class="disk-bench-result" style="font-size:11px;color:var(--text-muted);"></span>
                    </div>
                </div>`;
            }).join('');

            // Input listeners (debounced)
            container.querySelectorAll('.disk-limit-input').forEach(input => {
                let timer;
                input.addEventListener('input', (e) => {
                    clearTimeout(timer);
                    timer = setTimeout(async () => {
                        let val = parseInt(e.target.value, 10);
                        if (isNaN(val) || val < 0) val = 0;
                        const limitMbS = val === 0 ? null : val;
                        const mountPoint = e.target.getAttribute('data-mount');
                        try {
                            await invoke('set_disk_limit', { mountPoint, limitMbS });
                            toast(t('common.success') || 'Saved', 'success');
                        } catch (err) { toast('Error: ' + err, 'error'); }
                    }, 800);
                });
            });

            // Benchmark buttons
            container.querySelectorAll('.disk-bench-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const mountPoint = btn.getAttribute('data-mount');
                    const resultSpan = btn.closest('div').querySelector('.disk-bench-result');
                    const original = btn.innerHTML;
                    btn.disabled = true;
                    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> <span>${t('storage.benchmarking') || 'Test en cours...'}</span>`;

                    try {
                        const res = await invoke('benchmark_disk', { mountPoint });
                        resultSpan.innerHTML = `
                            <span style="color:#60a5fa;">↓ ${res.read_mb_s} MB/s</span>
                            <span style="margin:0 4px;">·</span>
                            <span style="color:#a78bfa;">↑ ${res.write_mb_s} MB/s</span>
                            <span style="margin:0 4px;">·</span>
                            <span style="color:#34d399;">${t('storage.suggestedLimit') || 'Suggestion'}: ${res.suggested_limit} MB/s</span>
                            <button class="btn btn-ghost btn-sm disk-apply-suggestion" data-mount="${mountPoint}" data-value="${res.suggested_limit}" style="font-size:10px;padding:2px 8px;margin-left:4px;">${t('storage.applySuggested') || 'Appliquer'}</button>
                        `;

                        // Apply button
                        resultSpan.querySelector('.disk-apply-suggestion')?.addEventListener('click', async (ev) => {
                            const sugVal = parseInt(ev.target.getAttribute('data-value'), 10);
                            const mp = ev.target.getAttribute('data-mount');
                            // Use DOM traversal to avoid bad CSS selectors with backslashes
                            const input = btn.closest('.storage-disk-card').querySelector('.disk-limit-input');
                            if (input) input.value = sugVal;
                            try {
                                await invoke('set_disk_limit', { mountPoint: mp, limitMbS: sugVal });
                                toast(t('common.success') || 'Saved', 'success');
                            } catch (err) { toast('Error: ' + err, 'error'); }
                        });
                    } catch (err) {
                        resultSpan.textContent = 'Error: ' + err;
                        resultSpan.style.color = 'var(--error)';
                    }
                    btn.disabled = false;
                    btn.innerHTML = original;
                });
            });

        } catch (err) {
            console.error(err);
            container.innerHTML = `<div style="font-size:12px;color:var(--error);text-align:center;padding:30px;">Erreur: ${err}</div>`;
        }
    };
    initStorageSettings();

    // ── Language Settings ──
    const initLanguageSettings = async () => {
        const langContainer = document.getElementById('settings-lang-container');
        if (!langContainer) return;

        const { getLanguages, setLang } = await import('./i18n.js');

        const getFlag = (l) => {
            if (!l || !l.flag) return '⚪';
            const f = l.flag.trim();
            if (f.length > 2) return f;
            if (f.length === 2) {
                const code = f.toLowerCase();
                return `<img src="https://flagcdn.com/w20/${code}.png" 
                             width="20" height="14" alt="${f.toUpperCase()}"
                             style="vertical-align: middle; border-radius: 2px; object-fit: cover;"
                             onerror="this.outerHTML='<span style=\\'font-size:10px; font-weight:700\\'>${f.toUpperCase()}</span>'">`;
            }
            return f;
        };

        const renderLangs = () => {
            const languages = getLanguages();
            const current = languages.find(l => l.active) || languages[0];

            langContainer.innerHTML = `
                <button class="nav-lang-btn" id="settings-lang-toggle" style="width: 240px; background: rgba(0,0,0,0.3);">
                    <span class="nav-lang-flag" style="margin-right:8px">${getFlag(current)}</span>
                    <span class="nav-lang-name">${current.name}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="nav-lang-chevron"><polyline points="18 15 12 9 6 15"/></svg>
                </button>
                <div class="settings-lang-menu" id="settings-lang-menu">
                    ${languages.map(l => `
                        <button class="nav-lang-option ${l.active ? 'active' : ''}" data-lang="${l.code}">
                            <span class="nav-lang-flag" style="margin-right:10px">${getFlag(l)}</span>
                            <span>${l.name}</span>
                            ${l.active ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="3" style="margin-left:auto"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                        </button>
                    `).join('')}
                </div>
            `;

            const toggle = document.getElementById('settings-lang-toggle');
            const menu = document.getElementById('settings-lang-menu');

            if (toggle && menu) {
                toggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isOpen = menu.classList.contains('open');

                    // Close all menus first
                    document.querySelectorAll('.settings-lang-menu, .nav-lang-menu').forEach(m => m.classList.remove('open'));
                    document.querySelectorAll('.nav-lang-btn').forEach(b => b.classList.remove('open'));

                    if (!isOpen) {
                        menu.classList.add('open');
                        toggle.classList.add('open');
                    }
                });

                menu.querySelectorAll('.nav-lang-option').forEach(opt => {
                    opt.addEventListener('click', () => {
                        setLang(opt.dataset.lang);
                        menu.classList.remove('open');
                        toggle.classList.remove('open');
                        renderLangs();
                        // Also update navbar if needed (it will re-render on next view change or we can force it)
                        if (typeof initNavbarLangDropdown === 'function') initNavbarLangDropdown();
                    });
                });
            }
        };

        // Close on outside click
        document.addEventListener('click', () => {
            const menu = document.getElementById('settings-lang-menu');
            const toggle = document.getElementById('settings-lang-toggle');
            if (menu && toggle) {
                menu.classList.remove('open');
                toggle.classList.remove('open');
            }
        });

        renderLangs();

        // Guide button
        const btnGuide = document.getElementById('btn-show-lang-guide');
        if (btnGuide) {
            btnGuide.addEventListener('click', () => {
                const updateBtn = document.getElementById('btn-show-updates');
                if (updateBtn) {
                    updateBtn.click();
                    // Wait for modal and select guide
                    setTimeout(() => {
                        const items = document.querySelectorAll('.archive-sidebar-item');
                        items.forEach(item => {
                            if (item.textContent.includes('TranslationGuide')) {
                                item.click();
                            }
                        });
                    }, 500);
                }
            });
        }

        // Copy Template button
        const btnCopyTemplate = document.getElementById('btn-copy-lang-template');
        if (btnCopyTemplate) {
            btnCopyTemplate.addEventListener('click', async () => {
                try {
                    const resp = await fetch('Lang/template.json');
                    const text = await resp.text();
                    await navigator.clipboard.writeText(text);
                    toast('Modèle de traduction copié !', 'success');
                } catch (e) {
                    toast('Erreur copie : ' + e, 'error');
                }
            });
        }
    };
    initLanguageSettings();

    // Interaction log
    initInteractionLogging();

    // Debug Menu
    initDebugMenu();

    // Crash report UI wiring
    initCrashReportUI();
    // Check if the previous session crashed and show the modal
    checkPreviousCrash();

    // Auto Update System
    initAutoUpdate();

    // PTB Mode check
    checkPtbMode();

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


// ── Debug Menu ──────────────────────────────────────────

function initDebugMenu() {
    // Show/Hide based on app.cfg (Prod=false)
    invoke('is_debug_mode').then(isDebug => {
        const card = document.getElementById('debug-menu-card');
        if (card && isDebug) {
            card.style.display = 'block';
        }
    });

    const genCrashBtn = document.getElementById('btn-debug-gen-crash');
    if (genCrashBtn) {
        genCrashBtn.addEventListener('click', async () => {
            try {
                toast(t('common.loading'), 'info');
                const path = await invoke('trigger_manual_crash_report');
                toast(`Report generated: ${path}`, 'success', 5000);
            } catch (err) {
                toast('Failed: ' + err, 'error');
            }
        });
    }

    const resetAppBtn = document.getElementById('btn-debug-reset-app');
    if (resetAppBtn) {
        resetAppBtn.addEventListener('click', async () => {
            const confirmed = confirm(t('settings.debugResetConfirm') || "DANGER: This will delete everything (Profiles, Mods, Settings). Are you sure?");
            if (confirmed) {
                try {
                    // 1. Reset backend (data.json)
                    await invoke('reset_app_data');
                    // 2. Reset frontend (localStorage)
                    localStorage.clear();
                    // 3. Restart app
                    toast("System Reset. Restarting...", "warning");
                    setTimeout(() => window.location.reload(), 1500);
                } catch (err) {
                    toast('Reset failed: ' + err, 'error');
                }
            }
        });
    }
}

// ── Auto Update System ──────────────────────────────────

const AUTO_UPDATE_KEY = 'bmm_auto_update_enabled';

function isAutoUpdateEnabled() {
    const val = localStorage.getItem(AUTO_UPDATE_KEY);
    return val !== 'false'; // Default to enabled
}

function setAutoUpdateEnabled(enabled) {
    localStorage.setItem(AUTO_UPDATE_KEY, enabled ? 'true' : 'false');
}

async function initAutoUpdate() {
    let isDisabled = false;
    try {
        isDisabled = await invoke('is_update_disabled');
    } catch (e) {
        console.warn('[BMM] Failed to check update disabled status:', e);
    }

    // Toggle checkbox
    const chk = document.getElementById('chk-auto-update');
    if (chk) {
        if (isDisabled) {
            chk.checked = false;
            chk.disabled = true;
            const card = document.getElementById('settings-auto-update-card');
            if (card) {
                card.classList.add('config-disabled');
                card.dataset.i18nContent = 'settings.disabledOverlay';
                card.setAttribute('data-content', t('settings.disabledOverlay'));
                card.title = t('update.disabled') || 'Updates disabled via configuration.';
            }
        } else {
            chk.checked = isAutoUpdateEnabled();
            chk.addEventListener('change', () => {
                setAutoUpdateEnabled(chk.checked);
                toast(chk.checked
                    ? (t('settings.autoUpdateEnabled') || 'Auto-update enabled')
                    : (t('settings.autoUpdateDisabled') || 'Auto-update disabled'), 'info');
            });
        }
    }

    // Sidebar button
    const sidebarBtn = document.getElementById('btn-check-updates');
    if (sidebarBtn) {
        if (isDisabled) {
            sidebarBtn.style.opacity = '0.5';
            sidebarBtn.style.cursor = 'not-allowed';
            sidebarBtn.title = t('update.disabled');
            sidebarBtn.addEventListener('click', () => {
                toast(t('update.disabled') || 'Updates are disabled.', 'warning');
            });
        } else {
            sidebarBtn.addEventListener('click', () => performUpdateCheck(true));
        }
    }

    // Settings button
    const settingsBtn = document.getElementById('btn-settings-check-update');
    if (settingsBtn) {
        if (isDisabled) {
            settingsBtn.style.opacity = '0.5';
            settingsBtn.style.cursor = 'not-allowed';
            settingsBtn.title = t('update.disabled');
            settingsBtn.addEventListener('click', () => {
                toast(t('update.disabled') || 'Updates are disabled.', 'warning');
            });
        } else {
            settingsBtn.addEventListener('click', () => performUpdateCheck(true));
        }
    }

    // Auto-check on startup
    if (!isDisabled && isAutoUpdateEnabled()) {
        setTimeout(() => performUpdateCheck(false), 3000); // Delay 3s to let app load
    }
}

async function performUpdateCheck(showNoUpdateToast = false) {
    const sidebarBtn = document.getElementById('btn-check-updates');
    const statusMsg = document.getElementById('update-status-msg');

    // Visual feedback
    if (sidebarBtn) {
        sidebarBtn.classList.add('checking');
        sidebarBtn.querySelector('span').textContent = t('settings.checking') || 'Checking...';
    }
    if (statusMsg) {
        statusMsg.innerHTML = `<span style="color:var(--accent)">${t('settings.checking') || 'Checking...'}</span>`;
    }

    try {
        const info = await invoke('check_for_update');

        if (info.has_update) {
            showUpdateAvailableModal(info);
            if (statusMsg) {
                statusMsg.innerHTML = `<span style="color:var(--success)">✓ ${t('settings.updateAvailable') || 'Update available'}: v${escHtml(info.latest_version)}</span>`;
            }
        } else {
            if (showNoUpdateToast) {
                toast(t('settings.upToDate') || 'You are running the latest version!', 'success');
            }
            if (statusMsg) {
                statusMsg.innerHTML = `<span style="color:var(--success)">✓ ${t('settings.upToDate') || 'Up to date'} (v${escHtml(info.current_version)})</span>`;
            }
        }
    } catch (err) {
        console.warn('[BMM] Update check failed:', err);
        const errStr = String(err);
        if (errStr.includes('NO_RELEASE')) {
            // No releases published yet — not a real error
            if (showNoUpdateToast) {
                toast(t('settings.noRelease') || 'No releases published on GitHub yet.', 'info');
            }
            if (statusMsg) {
                statusMsg.innerHTML = `<span style="color:var(--warning)">⚠ ${t('settings.noRelease') || 'No releases yet'}</span>`;
            }
        } else {
            if (showNoUpdateToast) {
                toast((t('settings.updateCheckFailed') || 'Update check failed') + ': ' + err, 'error');
            }
            if (statusMsg) {
                statusMsg.innerHTML = `<span style="color:var(--danger)">✗ ${t('settings.updateCheckFailed') || 'Check failed'}</span>`;
            }
        }
    } finally {
        // Reset sidebar button
        if (sidebarBtn) {
            sidebarBtn.classList.remove('checking');
            sidebarBtn.querySelector('span').textContent = t('settings.checkUpdates') || 'Check for Updates';
        }
    }
}

function showUpdateAvailableModal(info) {
    // Remove existing modal if any
    const existing = document.getElementById('update-available-modal');
    if (existing) existing.remove();

    const releaseNotes = info.release_notes
        ? (typeof marked !== 'undefined' ? marked.parse(info.release_notes) : info.release_notes.replace(/\n/g, '<br>'))
        : '';

    const modal = document.createElement('div');
    modal.id = 'update-available-modal';
    modal.className = 'update-modal-backdrop';
    modal.innerHTML = `
        <div class="update-modal-card">
            <button class="update-modal-close" id="close-update-modal">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>

            <div style="text-align:center;margin-bottom:24px">
                <div style="display:inline-flex;width:56px;height:56px;background:rgba(16,185,129,0.12);border-radius:16px;align-items:center;justify-content:center;margin-bottom:16px;border:1px solid rgba(16,185,129,0.25)">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2">
                        <path d="M23 4v6h-6M1 20v-6h6" />
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                </div>
                <h2 style="font-size:20px;font-weight:800;color:var(--text-primary);margin-bottom:8px">
                    ${t('settings.updateAvailableTitle') || 'Update Available!'}
                </h2>
                <p style="font-size:13px;color:var(--text-muted)">
                    ${t('settings.newVersionReady') || 'A new version of Better Mod Manager is ready.'}
                </p>
            </div>

            <div style="display:flex;gap:12px;margin-bottom:20px">
                <div style="flex:1;padding:12px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.15);border-radius:10px;text-align:center">
                    <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);font-weight:700;margin-bottom:4px">${t('settings.currentVersion') || 'CURRENT'}</div>
                    <div style="font-size:18px;font-weight:800;font-family:var(--font-mono);color:var(--danger)">v${escHtml(info.current_version)}</div>
                </div>
                <div style="display:flex;align-items:center;color:var(--text-muted)">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </div>
                <div style="flex:1;padding:12px;background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.15);border-radius:10px;text-align:center">
                    <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);font-weight:700;margin-bottom:4px">${t('settings.latestVersion') || 'LATEST'}</div>
                    <div style="font-size:18px;font-weight:800;font-family:var(--font-mono);color:var(--success)">v${escHtml(info.latest_version)}</div>
                </div>
            </div>

            ${releaseNotes ? `
                <div style="max-height:280px;overflow-y:auto;padding:12px;background:rgba(0,0,0,0.3);border-radius:10px;border:1px solid var(--border);margin-bottom:20px;font-size:12px;line-height:1.6;color:var(--text-secondary)" class="custom-scrollbar">
                    <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);font-weight:700;margin-bottom:8px">${t('settings.releaseNotes') || 'RELEASE NOTES'}</div>
                    ${releaseNotes}
                </div>
            ` : ''}

            <div style="display:flex;gap:10px">
                <button class="btn btn-ghost" id="btn-update-later" style="flex:1">
                    ${t('settings.later') || 'Later'}
                </button>
                <button class="btn btn-primary" id="btn-download-install-update" style="flex:2;text-align:center;display:flex;align-items:center;justify-content:center;gap:8px">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    ${t('settings.downloadUpdate') || 'Download Update'}
                </button>
            </div>

            <div style="text-align:center;margin-top:12px">
                <a href="${escAttr(info.release_url)}" target="_blank" style="font-size:11px;color:var(--accent);text-decoration:none">
                    ${t('settings.viewOnGithub') || 'View on GitHub →'}
                </a>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const downloadBtn = modal.querySelector('#btn-download-install-update');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', async () => {
            const originalContent = downloadBtn.innerHTML;
            downloadBtn.disabled = true;
            downloadBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Downloading...';
            try {
                let filename = info.download_url.split('/').pop() || 'setup.exe';
                if (!filename.includes('.')) filename += '.exe';
                await invoke('download_and_install_update', { url: info.download_url, filename });
                downloadBtn.innerHTML = 'Installing...';
            } catch (err) {
                toast(`Failed to download update: ${err}`, 'error');
                downloadBtn.disabled = false;
                downloadBtn.innerHTML = originalContent;
            }
        });
    }

    // Close handlers
    modal.querySelector('#close-update-modal').addEventListener('click', () => modal.remove());
    modal.querySelector('#btn-update-later').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

// ── PTB (Public Test Build) Modal ───────────────────────

const PTB_DISMISSED_KEY = 'bmm_ptb_dismissed';

async function checkPtbMode() {
    try {
        const isPtb = await invoke('is_ptb_mode');
        if (!isPtb) return;

        // Check if user already dismissed this session
        if (sessionStorage.getItem(PTB_DISMISSED_KEY) === 'true') return;

        // Load PTB notes
        let content = '';
        try {
            content = await invoke('get_ptb_notes');
        } catch (e) {
            console.warn('[BMM] No PTB notes found:', e);
            return;
        }

        // Render markdown
        const rendered = typeof marked !== 'undefined'
            ? marked.parse(content)
            : content.replace(/\n/g, '<br>');

        showPtbModal(rendered);
    } catch (e) {
        console.warn('[BMM] PTB check failed:', e);
    }
}

function showPtbModal(htmlContent) {
    const existing = document.getElementById('ptb-welcome-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'ptb-welcome-modal';
    modal.className = 'update-modal-backdrop';
    modal.innerHTML = `
        <div class="ptb-modal-card">
            <button class="update-modal-close" id="close-ptb-modal">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>

            <div class="ptb-modal-header">
                <div style="display:inline-flex;width:52px;height:52px;background:var(--accent-dim);border-radius:14px;align-items:center;justify-content:center;margin-bottom:14px;border:1px solid var(--border-accent)">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2">
                        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                    </svg>
                </div>
                <h2 style="font-size:19px;font-weight:800;color:var(--text-primary);margin-bottom:6px">
                    ${t('ptb.title') || 'Public Test Build'}
                </h2>
                <div style="display:inline-block;padding:3px 12px;background:var(--accent-dim);border:1px solid var(--border-accent);border-radius:var(--radius-chip);font-size:10px;font-weight:700;color:var(--accent);letter-spacing:0.06em;text-transform:uppercase;font-family:var(--font-mono)">
                    PTB
                </div>
            </div>

            <div class="ptb-modal-body">
                ${htmlContent}
            </div>

            <div class="ptb-modal-footer">
                <button class="btn-ptb-ok" id="btn-ptb-dismiss">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    ${t('ptb.understood') || 'Understood!'}
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Close handlers
    const close = () => {
        sessionStorage.setItem(PTB_DISMISSED_KEY, 'true');
        modal.remove();
    };
    modal.querySelector('#close-ptb-modal').addEventListener('click', close);
    modal.querySelector('#btn-ptb-dismiss').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
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
