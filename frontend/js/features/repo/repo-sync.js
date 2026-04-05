// @ts-nocheck
import { invoke } from '../../core/api.js';
import { toast, updateLibraryProfileSelector } from '../../ui/app.js';
import { t } from '../../core/i18n.js';
import { renderProfiles } from '../profiles/profiles.js';
import { formatBytes } from '../../core/utils.js';
let lastFetchedRepo = null;
let lastFetchedRepoSaltedId = null;
export function initRepoSync(elements) {
    const { inputSyncUrl, inputSyncGamePath, inputSyncModsPath, inputSyncBackupPath, btnStartSync, syncProgressContainer, syncStatus, syncPercent, syncFill, syncDetails, btnPauseSync, btnCancelSync, pauseText, pausedBadge, inputSyncDownloadLimit, btnFetchInfo, syncInfoCard, syncBadge, syncGameBadge, syncNameDisplay, syncAuthorDisplay, syncDescDisplay, btnClearFetchedRepo, profilesSelectionEl, syncPathsSection, syncUrlCard } = elements;
    const updateSyncPathsVisibility = () => {
        const sec = document.getElementById('repo-sync-paths-section');
        if (!sec)
            return;
        const boxes = document.querySelectorAll('.repo-sync-choice-cb:checked');
        const hasNew = Array.from(boxes).some(cb => cb.value === 'NEW');
        sec.style.display = hasNew ? 'block' : 'none';
        updateSyncTotalSize();
    };
    const updateSyncTotalSize = () => {
        const totalSizeEl = document.getElementById('repo-sync-total-size');
        if (!totalSizeEl || !lastFetchedRepo)
            return;
        const checkedBoxes = document.querySelectorAll('.repo-sync-choice-cb:checked');
        let total = 0;
        checkedBoxes.forEach(cb => {
            const profileId = cb.dataset.repoProfileId;
            const profile = lastFetchedRepo.profiles.find(p => p.id === profileId);
            if (profile && profile.mods) {
                profile.mods.forEach(m => {
                    if (m.files) {
                        m.files.forEach(f => total += f.size);
                    }
                });
            }
        });
        if (total > 0) {
            totalSizeEl.textContent = (t('repo.totalSize') || "Taille totale :") + " " + formatBytes(total);
        }
        else {
            totalSizeEl.textContent = "";
        }
    };
    if (btnFetchInfo) {
        btnFetchInfo.addEventListener('click', async () => {
            const url = inputSyncUrl.value.trim();
            if (!url)
                return toast(t('repo.errNoUrl'), 'warning');
            try {
                btnFetchInfo.disabled = true;
                let repo = await invoke('fetch_repo_info', { url, creatorId: null });
                let saltedCreatorId = null;
                if (repo.seed) {
                    saltedCreatorId = await invoke('get_salted_creator_id', { salt: repo.seed });
                    lastFetchedRepoSaltedId = saltedCreatorId;
                    repo = await invoke('fetch_repo_info', { url, creatorId: saltedCreatorId });
                }
                if (window.saveClientHistory)
                    window.saveClientHistory(url);
                lastFetchedRepo = repo;
                const isVerified = await invoke('verify_repo_signature', { repo });
                syncInfoCard.style.display = 'block';
                syncNameDisplay.textContent = repo.name;
                syncAuthorDisplay.textContent = (t('repo.authorShort') || "Auteur :") + " " + (repo.author || "Inconnu");
                syncDescDisplay.textContent = repo.description || "";
                syncGameBadge.textContent = repo.game_name;
                if (isVerified) {
                    syncBadge.textContent = t('repo.verified');
                    syncBadge.style.background = 'rgba(46, 204, 113, 0.2)';
                    syncBadge.style.color = '#2ecc71';
                }
                else {
                    syncBadge.textContent = t('repo.unverified');
                    syncBadge.style.background = 'rgba(231, 76, 60, 0.2)';
                    syncBadge.style.color = '#e74c3c';
                }
                if (profilesSelectionEl && repo.profiles) {
                    profilesSelectionEl.innerHTML = `<div style="font-size:11px; font-weight:700; color:var(--text-secondary); margin-bottom:10px; opacity:0.8;">${t('repo.selectSyncTasks')}</div>`;
                    const localProfiles = await invoke('get_profiles');
                    repo.profiles.forEach(rp => {
                        const rpSizeTotal = rp.mods.reduce((acc, m) => acc + (m.files ? m.files.reduce((a, f) => a + f.size, 0) : 0), 0);
                        const group = document.createElement('div');
                        group.style.background = 'rgba(255,255,255,0.02)';
                        group.style.border = '1px solid rgba(255,255,255,0.05)';
                        group.style.borderRadius = '8px';
                        group.style.padding = '10px';
                        group.style.marginBottom = '8px';
                        const title = document.createElement('div');
                        title.style.display = 'flex';
                        title.style.justifyContent = 'space-between';
                        title.style.alignItems = 'center';
                        title.innerHTML = `
                            <span style="font-size:12px; font-weight:700;">${rp.name}</span>
                            <span style="font-size:10px; color:var(--text-muted);">${formatBytes(rpSizeTotal)}</span>
                        `;
                        title.style.color = 'var(--accent)';
                        title.style.marginBottom = '8px';
                        group.appendChild(title);
                        const optionsContainer = document.createElement('div');
                        optionsContainer.style.display = 'flex';
                        optionsContainer.style.flexDirection = 'column';
                        optionsContainer.style.gap = '6px';
                        const addOption = (label, value, checked = false) => {
                            const row = document.createElement('label');
                            row.style.display = 'flex';
                            row.style.alignItems = 'center';
                            row.style.gap = '8px';
                            row.style.cursor = 'pointer';
                            row.style.fontSize = '11px';
                            row.style.color = 'var(--text-secondary)';
                            const cb = document.createElement('input');
                            cb.type = 'checkbox';
                            cb.value = value;
                            cb.dataset.repoProfileId = rp.id;
                            cb.className = 'repo-sync-choice-cb';
                            cb.checked = checked;
                            cb.addEventListener('change', updateSyncPathsVisibility);
                            row.appendChild(cb);
                            row.appendChild(document.createTextNode(label));
                            optionsContainer.appendChild(row);
                        };
                        addOption(t('repo.syncNew'), "NEW", !localProfiles.some(lp => lp.origin_repo_profile_id === rp.id));
                        const matches = localProfiles.filter(lp => lp.origin_repo_profile_id === rp.id);
                        matches.forEach(m => {
                            addOption(`${t('repo.syncUpdate')} ${m.name}`, m.id, true);
                        });
                        if (localProfiles.length > matches.length) {
                            const selectRow = document.createElement('div');
                            selectRow.style.display = 'flex';
                            selectRow.style.alignItems = 'center';
                            selectRow.style.gap = '8px';
                            selectRow.style.marginTop = '4px';
                            const selectLabel = document.createElement('span');
                            selectLabel.textContent = (t('repo.syncOther') || 'Autre profil :');
                            selectLabel.style.fontSize = '10px';
                            selectLabel.style.color = 'var(--text-muted)';
                            const select = document.createElement('select');
                            select.className = 'input-field repo-sync-manual-select';
                            select.style.fontSize = '10px';
                            select.style.padding = '2px 6px';
                            select.style.height = '24px';
                            select.style.flex = '1';
                            select.innerHTML = `<option value="">-- ${t('repo.selectLocal') || 'Choisir un profil local'} --</option>` +
                                localProfiles.map(lp => `<option value="${lp.id}">${lp.name}</option>`).join('');
                            const cb = document.createElement('input');
                            cb.type = 'checkbox';
                            cb.dataset.repoProfileId = rp.id;
                            cb.className = 'repo-sync-choice-cb manual-sync-cb';
                            select.onchange = () => {
                                cb.checked = !!select.value;
                                cb.value = select.value;
                                updateSyncPathsVisibility();
                            };
                            selectRow.appendChild(cb);
                            selectRow.appendChild(selectLabel);
                            selectRow.appendChild(select);
                            optionsContainer.appendChild(selectRow);
                        }
                        group.appendChild(optionsContainer);
                        profilesSelectionEl.appendChild(group);
                    });
                    updateSyncPathsVisibility();
                }
            }
            catch (err) {
                const errMsg = String(err);
                toast(t(errMsg) || errMsg, 'error');
            }
            finally {
                btnFetchInfo.disabled = false;
            }
        });
    }
    if (btnClearFetchedRepo) {
        btnClearFetchedRepo.addEventListener('click', () => {
            syncInfoCard.style.display = 'none';
            lastFetchedRepo = null;
            if (profilesSelectionEl)
                profilesSelectionEl.innerHTML = '';
            const totalSizeEl = document.getElementById('repo-sync-total-size');
            if (totalSizeEl)
                totalSizeEl.textContent = '';
            updateSyncPathsVisibility();
        });
    }
    if (btnStartSync) {
        btnStartSync.addEventListener('click', async () => {
            const url = inputSyncUrl.value.trim();
            if (!url)
                return toast(t('repo.errNoUrl'), 'warning');
            const gameDir = inputSyncGamePath ? inputSyncGamePath.value.trim() : '';
            const modsDir = inputSyncModsPath ? inputSyncModsPath.value.trim() : '';
            const backupDir = inputSyncBackupPath ? inputSyncBackupPath.value.trim() : '';
            if (syncPathsSection && syncPathsSection.style.display !== 'none') {
                if (!gameDir || !modsDir || !backupDir) {
                    toast(t('repo.errSyncFolders'), 'warning');
                    return;
                }
            }
            const selectedBoxes = document.querySelectorAll('.repo-sync-choice-cb:checked');
            const choices = Array.from(selectedBoxes).map(cb => ({
                repoProfileId: cb.dataset.repoProfileId,
                targetLocalProfileId: cb.value === 'NEW' ? null : cb.value
            }));
            if (choices.length === 0)
                return toast(t('repo.errNoSelection'), 'warning');
            let unlisten;
            try {
                btnStartSync.disabled = true;
                syncProgressContainer.style.display = 'block';
                syncStatus.textContent = t('repo.syncing') || "Synchronisation...";
                syncPercent.textContent = "0%";
                syncFill.style.width = "0%";
                syncDetails.textContent = t('repo.syncStarting');
                if (btnPauseSync)
                    btnPauseSync.style.display = 'flex';
                if (btnCancelSync) {
                    btnCancelSync.style.display = 'flex';
                    btnCancelSync.disabled = false;
                }
                if (window.__TAURI__) {
                    const { listen } = await import('https://unpkg.com/@tauri-apps/api@1/event.js');
                    unlisten = await listen('bmm://repo-sync-progress', (event) => {
                        const { step, progress, current_file } = event.payload;
                        if (progress !== undefined) {
                            const pct = Math.min(Math.round(progress), 100);
                            syncPercent.textContent = `${pct}%`;
                            syncFill.style.width = `${pct}%`;
                        }
                        if (step) {
                            if (step.startsWith('{')) {
                                try {
                                    const data = JSON.parse(step);
                                    syncStatus.textContent = t(data.key, data);
                                }
                                catch (e) {
                                    syncStatus.textContent = t(step) || step;
                                }
                            }
                            else {
                                syncStatus.textContent = t(step) || step;
                            }
                        }
                        if (current_file)
                            syncDetails.textContent = current_file;
                    });
                }
                const finalCreatorId = lastFetchedRepoSaltedId || await invoke('get_creator_id');
                const syncMode = document.getElementById('repo-sync-mode')?.value || 'missing';
                const cleanExtra = document.getElementById('repo-sync-clean-extra')?.checked || false;
                const downloadLimit = parseInt(inputSyncDownloadLimit ? inputSyncDownloadLimit.value : "0") || 0;
                const summary = await invoke('sync_server_repo', {
                    args: {
                        url, creatorId: finalCreatorId, gameDir, modsDir, backupDir, choices,
                        overwriteAll: syncMode === 'all', deleteExtra: cleanExtra, downloadLimit
                    }
                });
                showSyncSummary(summary);
                syncStatus.textContent = t('repo.syncDone');
                syncPercent.textContent = "100%";
                syncFill.style.width = "100%";
                syncDetails.textContent = t('repo.syncComplete');
                toast(t('repo.syncSuccess'), 'success');
                if (window._refreshModsFn)
                    window._refreshModsFn(true);
                await renderProfiles();
                updateLibraryProfileSelector();
            }
            catch (err) {
                const errMsg = String(err);
                if (errMsg.includes("Synchronisation annulée")) {
                    syncStatus.textContent = t('repo.syncCancelled');
                    syncPercent.textContent = "0%";
                    syncFill.style.width = "0%";
                    toast(t('repo.syncCancelled'), 'info');
                }
                else {
                    syncStatus.textContent = t('repo.syncError') || "Erreur de synchro";
                    toast(t(errMsg) || errMsg, 'error');
                }
            }
            finally {
                btnStartSync.disabled = false;
                if (unlisten)
                    unlisten();
                if (btnPauseSync) {
                    btnPauseSync.style.display = 'none';
                    pausedBadge.style.display = 'none';
                    pauseText.textContent = "Pause";
                }
                if (btnCancelSync)
                    btnCancelSync.style.display = 'none';
            }
        });
    }
    if (btnPauseSync) {
        btnPauseSync.addEventListener('click', async () => {
            const isPaused = pausedBadge.style.display === 'block';
            try {
                if (isPaused) {
                    await invoke('resume_repo_sync');
                    pausedBadge.style.display = 'none';
                    pauseText.textContent = t('repo.pauseSync');
                    btnPauseSync.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> <span>${t('repo.pauseSync')}</span>`;
                }
                else {
                    await invoke('pause_repo_sync');
                    pausedBadge.style.display = 'block';
                    pauseText.textContent = t('repo.resumeSync');
                    btnPauseSync.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> <span>${t('repo.resumeSync')}</span>`;
                }
            }
            catch (err) {
                toast(t('repo.syncError') + err, 'error');
            }
        });
    }
    if (btnCancelSync) {
        btnCancelSync.addEventListener('click', async () => {
            try {
                await invoke('cancel_repo_sync');
                toast(t('repo.syncCancelled') || "Annulation en cours...", 'info');
                btnCancelSync.disabled = true;
            }
            catch (err) {
                toast(t('common.error') + ': ' + err, 'error');
            }
        });
    }
    return {
        updateSyncTotalSize,
        updateSyncPathsVisibility
    };
}
export function showSyncSummary(summary) {
    const body = document.getElementById('repo-sync-summary-body');
    const modal = document.getElementById('modal-repo-sync-summary');
    if (!body || !modal)
        return;
    if (!summary || !summary.profiles || summary.profiles.length === 0) {
        body.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">${t('repo.noChanges')}</div>`;
    }
    else {
        body.innerHTML = summary.profiles.map(p => `
            <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:12px; padding:15px; margin-bottom:12px;">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
                    <div style="width:8px; height:8px; border-radius:50%; background:var(--accent);"></div>
                    <span style="font-weight:700; font-size:14px; color:var(--text-primary);">${p.name}</span>
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                    <div style="background:rgba(0,0,0,0.2); padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
                        <div style="font-size:9px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px;">MODS</div>
                        <div style="display:flex; flex-direction:column; gap:4px;">
                            <div style="font-size:12px; color:var(--success); font-weight:600;">+ ${p.mods_added} ${t('repo.summaryAdded')}</div>
                            <div style="font-size:12px; color:var(--accent); font-weight:600;">~ ${p.mods_updated} ${t('repo.summaryUpdated')}</div>
                            <div style="font-size:12px; color:var(--danger); font-weight:600;">- ${p.mods_removed} ${t('repo.summaryRemoved')}</div>
                        </div>
                    </div>
                    <div style="background:rgba(0,0,0,0.2); padding:10px; border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
                        <div style="font-size:9px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px;">TRANSFERT</div>
                        <div style="display:flex; flex-direction:column; gap:4px;">
                            <div style="font-size:12px; color:var(--text-primary); font-weight:600;">${p.files_downloaded} ${t('repo.summaryFiles') || 'fichiers'}</div>
                            <div style="font-size:12px; color:var(--cyan); font-weight:600;">${formatBytes(p.bytes_downloaded)}</div>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    }
    modal.classList.add('open');
}
//# sourceMappingURL=repo-sync.js.map