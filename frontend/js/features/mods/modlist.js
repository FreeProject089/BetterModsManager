// @ts-nocheck
/**
 * modlist.js — Mod List Import/Export/Install Logic
 */
import { invoke, pickFolder, pickFile, saveFile } from '../../core/api.js';
import { appState } from '../../core/state.js';
import { t } from '../../core/i18n.js';
import { dispatchBmmAction, BMM_ACTIONS } from '../../ui/tutorial-events.js';
import { refreshMods } from './mods.js';
import { renderProfiles } from '../profiles/profiles.js';
import { getGithubPat } from '../settings/settings.js';
import { escHtml, escAttr, formatBytes } from '../../core/utils.js';
let lastImportedModlistJson = null;
// Re-exporting toast from app.js for now or until moved to a better place
import { toast } from '../../ui/app.js';
export function initModlist() {
    const exportBtn = document.getElementById('btn-export-mm');
    const importBtn = document.getElementById('btn-import-mm');
    const exportCard = document.getElementById('export-form-card');
    const cancelExport = document.getElementById('btn-cancel-export');
    const confirmExportBtn = document.getElementById('btn-confirm-export');
    const previewCard = document.getElementById('imported-preview');
    const installBtn = document.getElementById('btn-install-from-mm');
    if (!exportBtn || !importBtn)
        return;
    exportBtn.addEventListener('click', () => {
        exportCard.style.display = exportCard.style.display === 'none' ? '' : 'none';
        previewCard.style.display = 'none';
    });
    // Top cancel button — only works when export is NOT yet running (form is visible)
    cancelExport.addEventListener('click', () => {
        exportCard.style.display = 'none';
    });
    // Dim the SHA badge when toggle is off
    const hashToggle = document.getElementById('mm-include-hashes');
    const hashesBadge = document.getElementById('mm-hashes-badge');
    hashToggle?.addEventListener('change', () => {
        if (hashesBadge)
            hashesBadge.style.opacity = hashToggle.checked ? '1' : '0.3';
    });
    const abortExportBtn = document.getElementById('btn-abort-export');
    confirmExportBtn.addEventListener('click', async () => {
        const listName = document.getElementById('mm-list-name').value.trim() || 'Ma liste';
        const description = document.getElementById('mm-description').value.trim();
        const author = document.getElementById('mm-author').value.trim();
        const includeHashes = document.getElementById('mm-include-hashes')?.checked ?? true;
        const path = await saveFile([{ name: 'Mod List', extensions: ['mm', 'json'] }]);
        if (!path)
            return;
        const progressOverlay = document.getElementById('export-progress-overlay');
        const progressBar = document.getElementById('export-progress-bar');
        const progressCount = document.getElementById('export-progress-count');
        const progressLabel = document.getElementById('export-progress-label');
        if (progressOverlay)
            progressOverlay.style.display = '';
        // Hide the top-level form buttons while export runs so only the in-overlay cancel is shown
        cancelExport.style.display = 'none';
        confirmExportBtn.disabled = true;
        const resetUI = () => {
            confirmExportBtn.disabled = false;
            cancelExport.style.display = '';
            if (progressOverlay) {
                progressOverlay.style.display = 'none';
                if (progressBar)
                    progressBar.style.width = '0%';
                if (progressCount)
                    progressCount.textContent = '';
                if (progressLabel)
                    progressLabel.textContent = '';
            }
        };
        let unlisten = null;
        let wasCancelled = false;
        // In-overlay abort button calls the Rust cancel command
        const onAbort = async () => {
            wasCancelled = true;
            try {
                await invoke('cancel_export_modlist');
            }
            catch { /* ignore */ }
        };
        abortExportBtn?.addEventListener('click', onAbort, { once: true });
        try {
            unlisten = await window.__TAURI__.event.listen('bmm://mm-export-progress', (e) => {
                const { current, total, mod_name, done, cancelled } = e.payload;
                if (cancelled) {
                    wasCancelled = true;
                    return;
                }
                const pct = total > 0 ? Math.round((current / total) * 100) : 0;
                if (progressBar)
                    progressBar.style.width = pct + '%';
                if (progressCount)
                    progressCount.textContent = `${current}/${total}`;
                if (progressLabel)
                    progressLabel.textContent = done ? '' : (mod_name || '');
            });
            await invoke('export_modlist', { listName, description, author, outputPath: path, includeHashes });
            if (wasCancelled) {
                toast(t('mm.exportCancelled') || 'Export annulé', 'info');
            }
            else {
                toast(t('mm.exportSuccess'), 'success');
                dispatchBmmAction(BMM_ACTIONS.MODLIST_EXPORTED, { name: listName });
                exportCard.style.display = 'none';
            }
        }
        catch (err) {
            if (wasCancelled) {
                toast(t('mm.exportCancelled') || 'Export annulé', 'info');
            }
            else {
                toast(t('mm.exportError').replace('{err}', err), 'error');
            }
        }
        finally {
            unlisten?.();
            resetUI();
        }
    });
    importBtn.addEventListener('click', async () => {
        const path = await pickFile([{ name: 'Mod List', extensions: ['mm', 'json'] }]);
        if (!path)
            return;
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
                        }
                        catch (e) {
                            console.error("Failed to get active profile mods path:", e);
                        }
                    }
                    else {
                        // Use default game path hint from modList (the .MM creator's suggestion)
                        pathHintEl.textContent = modList.game_path_hint || '—';
                    }
                };
                chkProfile.addEventListener('change', updatePath);
                updatePath(); // Initial call
            }
            toast(t('mm.importSuccess'), 'success');
        }
        catch (err) {
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
            toast(t('mm.installNone'), 'warning');
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
        if (progressOverlay)
            progressOverlay.style.display = 'flex';
        if (progressList)
            progressList.innerHTML = '';
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
                if (libraryTab)
                    libraryTab.click();
            }
            else {
                await refreshMods();
            }
        }
        catch (err) {
            if (err.includes('annulée') || err.includes('cancelled')) {
                toast(t('mm.installCancelled'), 'info');
            }
            else {
                toast(t('mm.installError').replace('{err}', err), 'error');
            }
        }
        finally {
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
        }
        else if (e.target.classList.contains('mm-mod-checkbox')) {
            updateInstallBtnText();
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
            }
            catch (err) {
                toast(t('mm.cancelError').replace('{err}', err), 'error');
            }
        }
    });
    // Listen for progress events
    window.__TAURI__.event.listen('bmm://mod-download-progress', (e) => {
        const data = e.payload; // { mod_index, total_mods, mod_name, progress, status }
        const container = document.getElementById('imported-progress-list');
        if (!container)
            return;
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
    // Handle path override button
    previewCard.addEventListener('click', async (e) => {
        const btn = e.target.closest('#btn-override-import-path');
        if (btn) {
            const newPath = await pickFolder();
            if (newPath) {
                const hintEl = document.getElementById('imported-path-hint');
                if (hintEl)
                    hintEl.textContent = newPath;
                toast(t('common.destUpdated'), 'info');
            }
        }
    });
}
function updateInstallBtnText() {
    const previewCard = document.getElementById('imported-preview');
    if (!previewCard)
        return;
    const count = previewCard.querySelectorAll('.mm-mod-checkbox:checked').length;
    const total = previewCard.querySelectorAll('.mm-mod-checkbox').length;
    const btn = document.getElementById('btn-install-from-mm');
    if (!btn)
        return;
    if (count === total) {
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ${t('mm.installAll')}`;
    }
    else {
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ${t('mm.installSelection')} (${count})`;
    }
}
export function renderImportedModlist(modlist) {
    const container = document.getElementById('imported-content');
    if (!container)
        return;
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
        // Hash integrity summary
        const fileEntries = m.file_tree ? m.file_tree.filter(f => !f.is_directory) : [];
        const hashedFiles = fileEntries.filter(f => f.sha256).length;
        const hashBadge = fileEntries.length === 0 ? '' :
            hashedFiles === fileEntries.length
                ? `<span style="font-size:9px;font-weight:700;color:#10b981;background:rgba(16,185,129,0.12);padding:2px 6px;border-radius:4px;border:1px solid rgba(16,185,129,0.25);flex-shrink:0;white-space:nowrap" title="${t('mm.hashVerifiedAll')} (${hashedFiles} ${t('mm.hashFiles')})">SHA-256 ✓</span>`
                : hashedFiles > 0
                    ? `<span style="font-size:9px;font-weight:700;color:#f59e0b;background:rgba(245,158,11,0.1);padding:2px 6px;border-radius:4px;border:1px solid rgba(245,158,11,0.25);flex-shrink:0;white-space:nowrap" title="${t('mm.hashPartial')}">${hashedFiles}/${fileEntries.length} SHA</span>`
                    : `<span style="font-size:9px;color:var(--text-muted);background:rgba(255,255,255,0.04);padding:2px 6px;border-radius:4px;border:1px solid var(--border);flex-shrink:0;white-space:nowrap" title="${t('mm.hashNone')}">${t('mm.noHashes')}</span>`;
        return `
        <div style="background:var(--bg-card); border:1px solid var(--border); border-radius:10px; padding:12px 16px; margin-bottom:8px; display:flex; flex-direction:column; gap:8px; position:relative; overflow:hidden; ${isAlreadyPresent ? 'opacity: 0.7;' : ''}">
          <div style="position:absolute; left:0; top:0; bottom:0; width:3px; background:${isAlreadyPresent ? 'var(--success)' : 'var(--accent)'}"></div>
          
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px">
            <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:0; flex-wrap:wrap">
                <span style="font-weight:700; font-size:14px; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px">${escHtml(m.name)}</span>
                <span style="font-family:var(--font-mono); font-size:10px; color:var(--cyan); background:rgba(6,182,212,0.1); padding:1px 6px; border-radius:4px; border:1px solid rgba(6,182,212,0.2); white-space:nowrap">v${escHtml(m.version || '?')}</span>
                <span style="font-size:10px; color:var(--text-muted); font-family:var(--font-mono); white-space:nowrap">${formatBytes(modSize)}</span>
                ${isAlreadyPresent ? `<span style="font-size:9px; font-weight:800; color:#10b981; background:rgba(16,185,129,0.15); padding:2px 6px; border-radius:4px; border:1px solid rgba(16,185,129,0.3); white-space:nowrap">${t('mm.modPresent')}</span>` : `<span style="font-size:9px; font-weight:800; color:var(--accent); background:var(--accent-dim); padding:2px 6px; border-radius:4px; border:1px solid var(--border-accent); white-space:nowrap">${t('mm.modNew')}</span>`}
                ${hashBadge}
            </div>
            <div style="display:flex; align-items:center; gap:8px; flex-shrink:0">
                <input type="checkbox" class="mm-mod-checkbox" data-index="${idx}" ${isAlreadyPresent ? '' : 'checked'} style="width:18px; height:18px; cursor:pointer; flex-shrink:0" title="${isAlreadyPresent ? t('mm.alreadyPresent') : ''}">
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
            ${m.tags && m.tags.length > 0 ? m.tags.map(tag => `<span style="font-size:9px; background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px; color:var(--text-secondary); border:1px solid var(--border)">${escHtml(tag)}</span>`).join('') : ''}

            ${m.download_links && m.download_links.length > 0 ? m.download_links.map(l => `
                <a href="${l.url}" target="_blank" class="btn btn-sm btn-ghost" style="padding:2px 8px; font-size:10px; height:22px; gap:4px; text-decoration:none; color:var(--accent)">
                    ${getLinkIcon(l.link_type)} ${escHtml(l.label || t('common.link'))}
                </a>
            `).join('') : ''}
          </div>

          ${fileCount > 0 ? (() => {
            const hashedCount = m.file_tree.filter(f => !f.is_directory && f.sha256).length;
            const fileCount2 = m.file_tree.filter(f => !f.is_directory).length;
            const allHashed = hashedCount === fileCount2 && fileCount2 > 0;
            return `
            <details style="margin-top:4px">
              <summary style="font-size:11px; color:var(--text-muted); cursor:pointer; font-family:var(--font-mono); display:flex; align-items:center; gap:6px; user-select:none">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                ${t('mm.fileTree').replace('{count}', fileCount)}
                ${allHashed
                ? `<span style="margin-left:4px;font-size:9px;font-weight:800;padding:1px 6px;border-radius:4px;background:rgba(16,185,129,0.15);color:#10b981;border:1px solid rgba(16,185,129,0.3);font-family:var(--font-sans);letter-spacing:0.03em" title="${t('mm.hashVerifiedAll')}">SHA-256 ✓</span>`
                : hashedCount > 0
                    ? `<span style="margin-left:4px;font-size:9px;font-weight:800;padding:1px 6px;border-radius:4px;background:rgba(245,158,11,0.12);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);font-family:var(--font-sans)" title="${t('mm.hashPartial')}">${hashedCount}/${fileCount2} SHA-256</span>`
                    : `<span style="margin-left:4px;font-size:9px;padding:1px 6px;border-radius:4px;background:rgba(255,255,255,0.04);color:var(--text-muted);border:1px solid var(--border);font-family:var(--font-sans)" title="${t('mm.hashNone')}">${t('mm.noHashes')}</span>`}
              </summary>
              <div style="max-height:180px; overflow-y:auto; margin-top:8px; padding:8px; background:rgba(0,0,0,0.2); border-radius:6px; font-size:10.5px; font-family:var(--font-mono); color:var(--text-muted); border:1px solid rgba(255,255,255,0.03)">
                ${m.file_tree.map(f => `
                    <div style="padding:3px 0; display:flex; align-items:center; gap:6px; border-bottom:1px solid rgba(255,255,255,0.02)">
                        <span style="opacity:0.6">${f.is_directory ? '📁' : '📄'}</span>
                        <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${escAttr(f.relative_path)}">${escHtml(f.relative_path)}</span>
                        ${!f.is_directory ? `<span style="opacity:0.4; font-size:9px; flex-shrink:0">${formatBytes(f.size)}</span>` : ''}
                        ${f.sha256 ? `
                            <span
                                style="font-size:9px; color:rgba(16,185,129,0.7); flex-shrink:0; cursor:pointer; padding:1px 4px; border-radius:3px; border:1px solid rgba(16,185,129,0.2); background:rgba(16,185,129,0.05); transition:background 0.15s"
                                title="${escAttr(f.sha256)}"
                                onclick="navigator.clipboard.writeText('${escAttr(f.sha256)}').then(()=>{this.style.background='rgba(16,185,129,0.2)';setTimeout(()=>this.style.background='rgba(16,185,129,0.05)',800)})"
                                onmouseenter="this.style.background='rgba(16,185,129,0.12)'"
                                onmouseleave="this.style.background='rgba(16,185,129,0.05)'"
                            >${f.sha256.substring(0, 8)}…</span>
                        ` : ''}
                    </div>
                `).join('')}
              </div>
            </details>`;
        })() : ''}
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
                        <label for="mm-select-all" style="cursor:pointer">${t('common.selectAll')}</label>
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
//# sourceMappingURL=modlist.js.map