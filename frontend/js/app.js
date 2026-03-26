/**
 * app.js — Main application controller
 * Entry point for Better Mod Manager frontend
 */

import { initProfiles, renderProfiles, updateProfileChip, openNewProfileModal } from './profiles.js';
import { initMods, refreshMods } from './mods.js';
import { initI18n, setLang, getLang, applyTranslations, getLanguages, t } from './i18n.js';
import { initBenchmark } from './benchmark.js';
import { shouldShowOnboarding, startOnboarding } from './onboarding.js';
import { initRepo } from './repo.js';
import { appState } from './state.js';
import { initInteractiveDocs, openDiagram } from './interactive-docs.js';
import { debugUI } from './debug-ui.js';
import { initDeepLinks } from './deep_link_manager.js';
import { initTitlebar } from './titlebar.js';
import { initSettings, updateDiscordStatus, getGithubPat, runAutoBenchmarks } from './settings.js';
import { initModals } from './modals.js';
import { initNavbarVersion, initUpdateNotes, initAutoUpdate, checkPtbMode, openLicenseModal } from './update-notes.js';

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

            // Yield to main thread so the nav button highlights instantly
            setTimeout(() => {
                document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
                document.getElementById('view-' + viewId)?.classList.add('active');

                // Auto-sync when entering library
                if (viewId === 'library') {
                    window._refreshModsFn?.(true);
                }

                // Credits video background control
                const creditsVideo = document.getElementById('credits-bg-video');
                if (creditsVideo) {
                    if (viewId === 'credits') {
                        creditsVideo.play().catch(() => { });
                    } else {
                        creditsVideo.pause();
                    }
                }
            }, 15);
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

    // Credits video visibility control
    document.addEventListener('visibilitychange', () => {
        const creditsVideo = document.getElementById('credits-bg-video');
        const creditsView = document.getElementById('view-credits');
        if (creditsVideo && creditsView && creditsView.classList.contains('active')) {
            if (document.hidden) {
                creditsVideo.pause();
            } else {
                creditsVideo.play().catch(() => { });
            }
        }
    });
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
            // Refresh local mods to ensure "Present" status is accurate
            const localMods = await invoke('get_mods');
            appState.set('allMods', localMods);

            const modList = await invoke('import_modlist', { path });
            lastImportedModlistJson = JSON.stringify(modList);
            exportCard.style.display = 'none';
            previewCard.style.display = '';
            renderImportedModlist(modList);
            updateInstallBtnText();

            // Auto-update path hint based on active profile if not creating a new profile
            const chkProfile = document.getElementById('chk-import-as-profile');
            const pathHintEl = document.getElementById('imported-path-hint');

            if (chkProfile && pathHintEl) {
                const updatePath = async () => {
                    if (!chkProfile.checked) {
                        try {
                            const activeId = await invoke('get_active_profile_id');
                            const profiles = await invoke('get_profiles');
                            const activeP = profiles.find(p => p.id === activeId);
                            if (activeP) {
                                pathHintEl.textContent = activeP.mods_path;
                            }
                        } catch (e) {
                            console.error("Failed to get active profile mods path:", e);
                        }
                    } else {
                        // Use default game path hint from modList (the .MM creator's suggestion)
                        pathHintEl.textContent = modList.game_path_hint || '—';
                    }
                };

                chkProfile.addEventListener('change', updatePath);
                updatePath(); // Initial call
            }
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
        let currentList = JSON.parse(lastImportedModlistJson);
        if (pathHintEl) {
            currentList.game_path_hint = pathHintEl.textContent;
        }

        // Filter: only install checked mods
        const checkboxes = previewCard.querySelectorAll('.mm-mod-checkbox');
        const selectedIndices = Array.from(checkboxes)
            .filter(cb => cb.checked)
            .map(cb => parseInt(cb.dataset.index));

        if (selectedIndices.length === 0) {
            toast(t('mm.installNone') || 'Veuillez sélectionner au moins un mod.', 'warning');
            return;
        }

        currentList.mods = currentList.mods.filter((_, idx) => selectedIndices.includes(idx));
        lastImportedModlistJson = JSON.stringify(currentList);

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
            const githubToken = await getGithubPat();
            const results = await invoke('install_from_modlist', {
                modlistJson: lastImportedModlistJson,
                createProfile: createProfile,
                githubToken: githubToken
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
            installBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ${t('mm.installSelection') || t('mm.installAll')}`;
            if (progressOverlay) {
                setTimeout(() => { progressOverlay.style.display = 'none'; }, 2000);
            }
        }
    });

    // Handle select/unselect all in imported list
    previewCard.addEventListener('change', (e) => {
        if (e.target.id === 'mm-select-all') {
            const checked = e.target.checked;
            const checkboxes = previewCard.querySelectorAll('.mm-mod-checkbox');
            checkboxes.forEach(cb => { cb.checked = checked; });
            updateInstallBtnText();
        } else if (e.target.classList.contains('mm-mod-checkbox')) {
            updateInstallBtnText();
        }
    });

    function updateInstallBtnText() {
        const count = previewCard.querySelectorAll('.mm-mod-checkbox:checked').length;
        const total = previewCard.querySelectorAll('.mm-mod-checkbox').length;
        const btn = document.getElementById('btn-install-from-mm');
        if (!btn) return;

        if (count === total) {
            btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ${t('mm.installAll')}`;
        } else {
            btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ${t('mm.installSelection')} (${count})`;
        }
    }

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
                toast(t('common.destUpdated'), 'info');
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
                    <span data-i18n="mm.importedBadge" style="font-size:10px; font-weight:700; text-transform:uppercase; padding:2px 8px; background:var(--accent-dim); color:var(--accent); border-radius:4px">${t('mm.importedBadge')}</span>
                    <span style="font-size:11px; color:var(--text-muted)"><span data-i18n="mm.by">${t('mm.by')}</span> <span style="color:var(--text-secondary); font-weight:600">${escHtml(modlist.author || 'Inconnu')}</span></span>
                    <span style="font-size:11px; color:var(--text-muted)">• v${modlist.format_version}</span>
                </div>
            </div>
            <div style="display:flex; gap:20px; text-align:right">
                <div>
                    <div data-i18n="mm.modsCount" style="font-size:10px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em">${t('mm.modsCount')}</div>
                    <div style="font-size:20px; font-weight:800; color:var(--accent)">${modlist.mods.length}</div>
                </div>
                <div>
                    <div data-i18n="mm.totalWeight" style="font-size:10px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em">${t('mm.totalWeight')}</div>
                    <div style="font-size:20px; font-weight:800; color:var(--cyan)">${formatBytes(totalBytes)}</div>
                </div>
            </div>
        </div>
        
        <div style="display:flex; align-items:center; gap:10px; padding:12px; background:rgba(255,255,255,0.02); border-radius:10px; border:1px solid var(--border); margin-top:10px">
            <div style="flex:1">
                 <div data-i18n="mm.autoProfile" style="font-size:12px; font-weight:700; color:var(--text-primary)">${t('mm.autoProfile')}</div>
                 <div data-i18n="mm.autoProfileDesc" style="font-size:10px; color:var(--text-muted)">${t('mm.autoProfileDesc')}</div>
            </div>
            <label class="switch">
                <input type="checkbox" id="chk-import-as-profile" checked>
                <span class="slider round"></span>
            </label>
        </div>

        <div style="display:flex; align-items:center; gap:10px; padding:8px 12px; background:rgba(0,255,255,0.03); border-radius:8px; border:1px solid rgba(6,182,212,0.1); margin-top:10px">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <div style="flex:1; min-width:0">
                <div data-i18n="mm.installPath" style="font-size:9px; color:var(--text-muted); text-transform:uppercase; font-weight:700">${t('mm.installPath')}</div>
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
    const currentMods = appState.state.allMods || [];
    const modsHtml = modlist.mods.map((m, idx) => {
        const fileCount = m.file_tree ? m.file_tree.length : 0;
        const modSize = m.file_tree ? m.file_tree.reduce((acc, f) => acc + (f.size || 0), 0) : 0;

        // Presence check
        const isAlreadyPresent = currentMods.some(cm => cm.name === m.name);

        return `
        <div style="background:var(--bg-card); border:1px solid var(--border); border-radius:10px; padding:12px 16px; margin-bottom:8px; display:flex; flex-direction:column; gap:8px; position:relative; overflow:hidden; ${isAlreadyPresent ? 'opacity: 0.7;' : ''}">
          <div style="position:absolute; left:0; top:0; bottom:0; width:3px; background:${isAlreadyPresent ? 'var(--success)' : 'var(--accent)'}"></div>
          
          <div style="display:flex; align-items:center; justify-content:space-between">
            <div style="display:flex; align-items:center; gap:12px">
                <span style="font-weight:700; font-size:14px; color:var(--text-primary)">${escHtml(m.name)}</span>
                <span style="font-family:var(--font-mono); font-size:10px; color:var(--cyan); background:rgba(6,182,212,0.1); padding:1px 6px; border-radius:4px; border:1px solid rgba(6,182,212,0.2)">v${escHtml(m.version)}</span>
                <span style="font-size:10px; color:var(--text-muted); font-family:var(--font-mono)">${formatBytes(modSize)}</span>
                ${isAlreadyPresent ? `<span style="font-size:9px; font-weight:800; color:#10b981; background:rgba(16,185,129,0.15); padding:2px 6px; border-radius:4px; border:1px solid rgba(16,185,129,0.3)">${t('mm.modPresent')}</span>` : `<span style="font-size:9px; font-weight:800; color:var(--accent); background:var(--accent-dim); padding:2px 6px; border-radius:4px; border:1px solid var(--border-accent)">${t('mm.modNew')}</span>`}
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
          
          ${m.install_notes ? `
            <div style="background:rgba(245,158,11,0.08); border:1px dashed rgba(245,158,11,0.3); border-radius:8px; padding:10px; margin-top:4px">
                <div style="font-size:10px; font-weight:800; color:#fbbf24; text-transform:uppercase; margin-bottom:4px; display:flex; align-items:center; gap:6px">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                    Installation Notes
                </div>
                <p style="font-size:11.5px; color:var(--text-secondary); margin:0; line-height:1.5">${escHtml(m.install_notes)}</p>
            </div>
          ` : ''}
          
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap">
            ${m.tags && m.tags.length > 0 ? m.tags.map(t => `<span style="font-size:9px; background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px; color:var(--text-secondary); border:1px solid var(--border)">${escHtml(t)}</span>`).join('') : ''}
            
            ${m.download_links && m.download_links.length > 0 ? m.download_links.map(l => `
                <a href="${l.url}" target="_blank" class="btn btn-sm btn-ghost" style="padding:2px 8px; font-size:10px; height:22px; gap:4px; text-decoration:none; color:var(--accent)">
                    ${getLinkIcon(l.link_type)} ${escHtml(l.label || t('common.link'))}
                </a>
            `).join('') : ''}
          </div>

          <!-- Mod Selection Checkbox -->
          <div style="position:absolute; right:16px; top:50%; transform:translateY(-50%); display:flex; align-items:center; gap:10px">
              <input type="checkbox" class="mm-mod-checkbox" data-index="${idx}" ${isAlreadyPresent ? '' : 'checked'} style="width:18px; height:18px; cursor:pointer" title="${isAlreadyPresent ? t('mm.alreadyPresent') || 'Déjà installé' : ''}">
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
                    
                    <div style="margin-left:auto; display:flex; align-items:center; gap:8px; font-size:10px; color:var(--text-secondary); cursor:pointer; user-select:none">
                        <input type="checkbox" id="mm-select-all" checked style="cursor:pointer">
                        <label for="mm-select-all" style="cursor:pointer">${t('common.selectAll') || 'Tout sélectionner'}</label>
                    </div>
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

export function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
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
                toast(t('common.crashFolderError') + ': ' + err, 'error');
            }
        });
    }

    // New Container Click (Better UX)
    const pathContainer = document.getElementById('crash-path-container');
    const openZip = async () => {
        const pathEl = document.getElementById('crash-zip-path');
        const path = pathEl?.textContent?.trim();
        if (path && path !== '—') {
            try {
                await invoke('open_crash_zip', { path });
            } catch (err) {
                toast('Could not open zip: ' + err, 'error');
            }
        }
    };

    if (pathContainer) {
        pathContainer.addEventListener('click', openZip);
    }

    // Modal Path click (legacy support if layout changes back)
    const pathEl = document.getElementById('crash-zip-path');
    if (pathEl) {
        pathEl.style.cursor = 'pointer';
        pathEl.addEventListener('click', openZip);
    }

    // Crash modal: "Open in Explorer" button
    const openZipBtn = document.getElementById('btn-crash-open-zip');
    if (openZipBtn) {
        openZipBtn.addEventListener('click', openZip);
    }
}

/** Call on startup – shows crash modal if a recent zip was generated OR backend detected dirty session. */
async function checkPreviousCrash() {
    try {
        const startupStatus = await invoke('get_startup_status');
        const { getSettings, updateSettings } = await import('./api.js');
        const settings = await getSettings();

        const backendCrashed = startupStatus.backend_crashed;
        const reports = await invoke('get_crash_reports') || [];
        const newest = reports.length > 0 ? reports[0] : null;
        const lastSeen = settings.last_seen_crash;

        let shouldShow = false;

        // ONLY show if:
        // 1. The backend explicitly detected a hard crash/orphan (backendCrashed).
        // 2. We have a NEW zip file that starts with "crash_".
        // We skip "session_" zips to avoid false positives from clean shutdowns 
        // that used to generate them or legacy files.
        if (backendCrashed) {
            shouldShow = true;
            invoke('log_frontend_line', { line: `Startup: Crash detected by backend.` });
        } else if (newest && newest !== lastSeen) {
            const isCrashFile = newest.split(/[\\/]/).pop().startsWith('crash_');
            if (isCrashFile) {
                shouldShow = true;
            }
        }

        if (shouldShow) {
            const pathEl = document.getElementById('crash-zip-path');
            if (pathEl && newest) {
                pathEl.textContent = newest;
                // Save this so we don't show it again
                settings.last_seen_crash = newest;
            }

            const modal = document.getElementById('modal-crash-report');
            if (modal) {
                modal.classList.add('open');
                await updateSettings(settings);
                invoke('log_frontend_line', { line: `Crash modal displayed for: ${newest || 'unknown'}` });
            }
        }
    } catch (e) {
        console.warn('Crash check failed:', e);
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

    // Keyboard toggle
    document.addEventListener('keydown', e => {
        const key = e.key.toLowerCase();

        // Ctrl+Alt+D: Toggle DevTools (ONLY if unlocked via Ctrl+D in Settings)
        if (e.ctrlKey && e.altKey && key === 'd') {
            e.preventDefault();
            if (appState.get('debugMode')) {
                debugUI.toggle();
            } else {
                console.warn('[BMM-DEBUG] Access denied. Unlock Debug Mode in Settings (Ctrl+D) first.');
                toast('DevTools locked. Unlock in Settings.', 'warning');
            }
        }
        // Ctrl+Shift+F: Toggle DevTools (Legacy FSDM)
        else if (e.ctrlKey && e.shiftKey && key === 'f') {
            if (window.bmmFSDMEnabled) {
                debugUI.toggle();
            }
        }
        // Ctrl+D: Unlock Debug Mode (ONLY in Settings)
        else if (e.ctrlKey && !e.altKey && !e.shiftKey && key === 'd') {
            const settingsView = document.getElementById('view-settings');
            if (settingsView && settingsView.classList.contains('active')) {
                e.preventDefault();
                const card = document.getElementById('debug-menu-card') || document.getElementById('settings-debug-section');
                if (card) {
                    const isHidden = card.style.display === 'none';
                    card.style.display = isHidden ? 'block' : 'none';
                    if (isHidden) {
                        appState.set('debugMode', true);
                        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        toast('Debug Mode Unlocked', 'success');
                    } else {
                        // We don't necessarily lock it back, but we hide the section
                        toast('Debug Section Hidden', 'info');
                    }
                }
            }
        }
    });

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
export function initNavbarLangDropdown() {
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
    document.addEventListener('langChanged', render);
}

// ── Offline Detection ─────────────────────────────────────
function initOfflineDetection() {
    const banner = document.getElementById('offline-banner');
    if (!banner) return;

    function updateStatus() {
        if (navigator.onLine) {
            banner.classList.remove('visible');
        } else {
            banner.classList.add('active'); // active matches the CSS transition
            banner.classList.add('visible');
        }
    }

    window.addEventListener('online', () => {
        banner.classList.remove('visible');
        setTimeout(() => banner.classList.remove('active'), 400);
    });
    window.addEventListener('offline', () => {
        banner.classList.add('active');
        setTimeout(() => banner.classList.add('visible'), 10);
    });

    // Initial check
    if (!navigator.onLine) {
        banner.classList.add('active');
        banner.classList.add('visible');
    }
}

// ── Boot ──────────────────────────────────────────────────
async function main() {
    console.log('[BMM] App starting...');

    // Initialize Offline Detection
    initOfflineDetection();

    // Initialize DevTools
    const { debugUI } = await import('./debug-ui.js');
    // debugUI.init(); // Redundant, called in initDebugMenu()

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

            const suffix = isPtb ? "-FAB" : "";
            const PatchVersion = " {P U.4.LPU}";
            const versionStr = `V${version}${suffix} ${PatchVersion}`;

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
    initRepo();
    initInteractiveDocs();
    initDeepLinks();

    // Bind Docs Diagram buttons
    document.getElementById('btn-docs-resumable')?.addEventListener('click', () => openDiagram('resumable-downloads'));
    document.getElementById('btn-faq-resumable')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openDiagram('resumable-downloads');
    });
    document.getElementById('btn-faq-resumable-alt')?.addEventListener('click', () => openDiagram('resumable-downloads'));
    initNavbarLangDropdown();
    initNavbarVersion();
    initUpdateNotes();

    document.getElementById('btn-restart-onboarding')?.addEventListener('click', () => {
        startOnboarding();
    });

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
    if (loaderText) loaderText.textContent = t('common.loaded');

    // Hide loader smoothly after a small delay to see the happy face
    const loader = document.getElementById('app-loader');
    if (loader) {
        setTimeout(() => {
            loader.style.opacity = '0';
            loader.style.visibility = 'hidden';
            setTimeout(() => loader.remove(), 600);
        }, 800);
    }

    await initSettings();

    // Show onboarding on first launch (language is step 0 inside onboarding)
    if (await shouldShowOnboarding()) {
        setTimeout(() => startOnboarding(), 500);
    }

    // ── Auto-Calibration trigger at startup ──
    try {
        const { getSettings } = await import('./api.js');
        const settings = await getSettings();
        if (settings.auto_io_calibration) {
            console.log("[BMM] Auto-Calibration enabled, running boot optimization...");
            const disks = await invoke('get_system_disks');
            runAutoBenchmarks(disks, true); // true = silent/boot mode
        }
    } catch (e) {
        console.error("[BMM] Auto-Calibration startup failed:", e);
    }

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

    // Onboarding check
    if (await shouldShowOnboarding()) {
        startOnboarding();
    }

    const restartBtn = document.getElementById('btn-restart-tutorial');
    if (restartBtn) {
        restartBtn.addEventListener('click', () => {
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.querySelectorAll('.nav-item').forEach(v => v.classList.remove('active'));
            document.getElementById('view-library').classList.add('active');
            startOnboarding();
        });
    }

    const newProfileLibBtn = document.getElementById('btn-new-profile-lib');
    if (newProfileLibBtn) {
        newProfileLibBtn.addEventListener('click', () => {
            openNewProfileModal();
        });
    }

    // Global helper for navigation
    window.showProfiles = () => {
        document.querySelector('.nav-item[data-view="profiles"]')?.click();
    };
    window.openNewProfileModal = openNewProfileModal;

    // Version button and Release Notes buttons
    const verBtn = document.getElementById('nav-version-btn');
    if (verBtn) {
        verBtn.addEventListener('click', () => {
            sessionStorage.removeItem(PTB_DISMISSED_KEY); // Force reload
            checkPtbMode();
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

// ── Debug Menu ──────────────────────────────────────────

function initDebugMenu() {
    // Show/Hide based on app.cfg (Prod=false or FSDM=true)
    Promise.all([invoke('is_debug_mode'), invoke('is_fsdm_mode')]).then(([isDebug, isFSDM]) => {
        window.bmmDebugEnabled = isDebug || isFSDM;
        window.bmmFSDMEnabled = isFSDM;

        // CRITICAL: Initialize the Debug UI if any debug mode is active
        if (window.bmmDebugEnabled) {
            debugUI.init();
        }

        const card = document.getElementById('debug-menu-card');
        if (card) {
            // Manual hide by default (even if enabled) per user request
            // Section is toggled via Alt+Shift+D
            card.style.display = 'none';
        }
    });

    // Logic moved to global listener near line 915

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

    const openDebugBtn = document.getElementById('btn-open-debug') || document.getElementById('dbg-open-menu');
    if (openDebugBtn) {
        openDebugBtn.addEventListener('click', () => {
            debugUI.toggle(true); // Force open
        });
    }
}

main().catch(console.error);
