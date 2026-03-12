import { invoke, pickFolder } from './api.js';
import { toast, updateLibraryProfileSelector, formatBytes, escHtml, escAttr } from './app.js';
import { renderProfiles } from './profiles.js';
import { t } from './i18n.js';

export function initRepo() {
    // ── Export elements ──────────────────────────────────────────────
    const btnPickExport = document.getElementById('btn-pick-repo-export');
    const inputExportPath = document.getElementById('repo-export-path');
    const btnStartExport = document.getElementById('btn-start-repo-export');
    const exportProgressContainer = document.getElementById('repo-export-progress-container');
    const exportStatus = document.getElementById('repo-export-status');
    const exportPercent = document.getElementById('repo-export-percent');
    const exportFill = document.getElementById('repo-export-progress-fill');

    // ── Sync elements ─────────────────────────────────────────────────
    const inputSyncUrl = document.getElementById('repo-sync-url');
    const inputSyncGamePath   = document.getElementById('repo-sync-game-path');
    const inputSyncModsPath   = document.getElementById('repo-sync-mods-path');
    const inputSyncBackupPath = document.getElementById('repo-sync-backup-path');
    const btnPickSyncGame   = document.getElementById('btn-pick-sync-game');
    const btnPickSyncMods   = document.getElementById('btn-pick-sync-mods');
    const btnPickSyncBackup = document.getElementById('btn-pick-sync-backup');
    const btnStartSync = document.getElementById('btn-start-repo-sync');
    const syncProgressContainer = document.getElementById('repo-sync-progress-container');
    const syncStatus = document.getElementById('repo-sync-status');
    const syncPercent = document.getElementById('repo-sync-percent');
    const syncFill = document.getElementById('repo-sync-progress-fill');
    const syncDetails = document.getElementById('repo-sync-details');
    const btnPauseSync = document.getElementById('btn-pause-sync');
    const btnCancelSync = document.getElementById('btn-cancel-sync');
    const pauseText = document.getElementById('repo-sync-pause-text');
    const pausedBadge = document.getElementById('repo-sync-paused-badge');

    // ── Host Server elements ──────────────────────────────────────────
    const profilesListEl = document.getElementById('repo-export-profiles-list');
    const btnToggleServer = document.getElementById('btn-toggle-repo-server');
    const textToggleServer = document.getElementById('repo-server-btn-text');
    const urlContainerServer = document.getElementById('repo-server-url-container');
    const urlInputServer = document.getElementById('repo-server-url');
    const btnCopyUrlServer = document.getElementById('btn-copy-repo-url');
    const serverStatusDot = document.getElementById('repo-server-status-dot');
    const serverStatusLabel = document.getElementById('repo-server-status-label');
    const publicSection = document.getElementById('repo-server-public-section');
    const publicUrlInput = document.getElementById('repo-server-public-url');
    const btnCopyPublicUrl = document.getElementById('btn-copy-repo-public-url');
    const upnpBadgeStatus = document.getElementById('upnp-status-badge');
    const publicHintBox = document.getElementById('public-ip-hint-box');
    const repoCreatorIdContainer = document.getElementById('repo-creator-id-container');
    const repoCreatorIdValue = document.getElementById('repo-creator-id-value');
    const inputExportAuthor = document.getElementById('repo-export-author-name');
    const tunnelSection = document.getElementById('repo-server-tunnel-section');
    const tunnelUrlInput = document.getElementById('repo-server-tunnel-url');
    const btnCopyTunnelUrl = document.getElementById('btn-copy-repo-tunnel-url');
    
    // Sync elements
    const btnFetchInfo = document.getElementById('btn-fetch-repo-info');
    const syncInfoCard = document.getElementById('repo-sync-info-card');
    const syncBadge = document.getElementById('repo-sync-author-badge');
    const syncGameBadge = document.getElementById('repo-sync-game-badge');
    const syncNameDisplay = document.getElementById('repo-sync-name-display');
    const syncAuthorDisplay = document.getElementById('repo-sync-author-display');
    const syncDescDisplay = document.getElementById('repo-sync-desc-display');
    
    // History Elements
    const hostHistorySelect = document.getElementById('repo-host-history-select');
    const hostHistoryContainer = document.getElementById('repo-host-history-container');
    const hostMetadataPreview = document.getElementById('repo-host-metadata-preview');
    
    // Sync History Elements
    const syncHistoryContainer = document.getElementById('repo-sync-history-container');
    const syncHistoryList = document.getElementById('repo-sync-history-list');

    let isServerRunning = false;

    // ── Load Histories ──
    const loadRepoHistories = () => {
        try {
            const urls = JSON.parse(localStorage.getItem('bmm_repo_history_client') || '[]');
            if (syncHistoryContainer && syncHistoryList) {
                if (urls.length > 0) {
                    syncHistoryContainer.style.display = 'block';
                    syncHistoryList.innerHTML = urls.map(u => `
                        <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:6px 10px;">
                            <div style="font-size:11px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;" title="${escAttr(u)}">
                                ${escHtml(u)}
                            </div>
                            <div style="display:flex;gap:4px;">
                                <button class="btn btn-secondary btn-sm sync-hist-connect" data-url="${escAttr(u)}" style="padding:2px 8px;font-size:10px;background:rgba(59,130,246,0.15);color:var(--accent);border:none;">
                                    ${t('repo.connectBtn') || 'Connecter'}
                                </button>
                                <button class="btn btn-secondary btn-sm sync-hist-delete" data-url="${escAttr(u)}" style="padding:2px 6px;background:rgba(231,76,60,0.1);color:#e74c3c;border:none;">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                </button>
                            </div>
                        </div>
                    `).join('');
                    
                    // Attach listeners
                    syncHistoryList.querySelectorAll('.sync-hist-connect').forEach(btn => {
                        btn.addEventListener('click', () => {
                            if (inputSyncUrl) inputSyncUrl.value = btn.dataset.url;
                            if (btnFetchInfo) btnFetchInfo.click();
                        });
                    });
                    
                    syncHistoryList.querySelectorAll('.sync-hist-delete').forEach(btn => {
                        btn.addEventListener('click', () => {
                            let current = JSON.parse(localStorage.getItem('bmm_repo_history_client') || '[]');
                            current = current.filter(url => url !== btn.dataset.url);
                            localStorage.setItem('bmm_repo_history_client', JSON.stringify(current));
                            loadRepoHistories();
                        });
                    });
                    
                } else {
                    syncHistoryContainer.style.display = 'none';
                }
            }
        } catch(e) {}
        try {
            const paths = JSON.parse(localStorage.getItem('bmm_repo_history_host') || '[]');
            if (hostHistorySelect) {
                if (paths.length > 0) {
                    if (hostHistoryContainer) hostHistoryContainer.style.display = 'block';
                    hostHistorySelect.innerHTML = `<option value="">${t('repo.hostHistoryDefault')}</option>` +
                        paths.map(p => `<option value="${escAttr(p)}">${escHtml(p)}</option>`).join('');
                } else if (hostHistoryContainer) {
                    hostHistoryContainer.style.display = 'none';
                }
            }
        } catch(e) {}
    };
    loadRepoHistories();

    // --- Extracted Metadata Preview Function ---
    const previewHostRepo = async (path) => {
        if (!path) {
            if (hostMetadataPreview) hostMetadataPreview.style.display = 'none';
            return;
        }
        const hostInput = document.getElementById('repo-host-path');
        if (hostInput) hostInput.value = path;
        
        try {
            if (window.__TAURI__) {
                const { readTextFile } = window.__TAURI__.fs;
                const content = await readTextFile(path + '/repo.json');
                const repo = JSON.parse(content);
                const pCount = repo.profiles ? repo.profiles.length : 0;
                const pNames = repo.profiles ? repo.profiles.map(p => p.name).join(', ') : '';
                let totalSize = 0;
                if (repo.profiles) {
                    repo.profiles.forEach(p => {
                        if (p.mods) p.mods.forEach(m => {
                            if (m.files) m.files.forEach(f => totalSize += f.size);
                        });
                    });
                }
                if (hostMetadataPreview) {
                    hostMetadataPreview.style.display = 'block';
                    hostMetadataPreview.innerHTML = `
                        <div style="color:var(--accent);font-weight:700;margin-bottom:4px;font-size:14px;">${escHtml(repo.name)}</div>
                        <div style="color:var(--text-secondary);margin-bottom:2px;">Auteur : <span style="color:var(--text-primary)">${escHtml(repo.author || '-')}</span></div>
                        <div style="color:var(--text-secondary);margin-bottom:2px;">Profils (${pCount}) : <span style="color:var(--text-primary)">${escHtml(pNames)}</span></div>
                        <div style="color:var(--cyan);margin-top:6px;font-family:var(--font-mono)">Taille Totale : ${formatBytes(totalSize)}</div>
                    `;
                }
            }
        } catch (err) {
            if (hostMetadataPreview) {
                hostMetadataPreview.style.display = 'block';
                hostMetadataPreview.innerHTML = `<div style="color:var(--danger);">Impossible de lire le repo.json généré (${err})</div>`;
            }
        }
    };

    if (hostHistorySelect) {
        hostHistorySelect.addEventListener('change', (e) => {
            previewHostRepo(e.target.value);
        });
    }

    const saveClientHistory = (url) => {
        try {
            let urls = JSON.parse(localStorage.getItem('bmm_repo_history_client') || '[]');
            urls = urls.filter(u => u !== url);
            urls.unshift(url);
            if (urls.length > 10) urls.length = 10;
            localStorage.setItem('bmm_repo_history_client', JSON.stringify(urls));
            loadRepoHistories();
        } catch(e) {}
    };

    const saveHostHistory = (path) => {
        try {
            let paths = JSON.parse(localStorage.getItem('bmm_repo_history_host') || '[]');
            paths = paths.filter(p => p !== path);
            paths.unshift(path);
            if (paths.length > 10) paths.length = 10;
            localStorage.setItem('bmm_repo_history_host', JSON.stringify(paths));
            loadRepoHistories();
        } catch(e) {}
    };

    // ─── Load available profiles for the export checklist ────────────
    const loadProfilesForExport = async () => {
        if (!profilesListEl) return;
        try {
            const profiles = await invoke('get_profiles');
            profilesListEl.innerHTML = '';
            
            if (!profiles || profiles.length === 0) {
                profilesListEl.innerHTML = `<div style="color:var(--text-muted); font-size:12px; text-align:center;">${t('repo.noProfiles') || "Aucun profil trouvé."}</div>`;
                return;
            }

            profiles.forEach(p => {
                const item = document.createElement('div');
                item.className = 'repo-profile-item';
                item.style.display = 'flex';
                item.style.alignItems = 'center';
                item.style.padding = '10px 12px';
                item.style.marginBottom = '6px';
                item.style.background = 'rgba(255,255,255,0.03)';
                item.style.borderRadius = '8px';
                item.style.border = '1px solid rgba(255,255,255,0.05)';
                item.style.cursor = 'pointer';
                item.style.transition = 'all 0.2s ease';

                // Hover effect
                item.onmouseenter = () => {
                    item.style.background = 'rgba(255,255,255,0.06)';
                    item.style.borderColor = 'rgba(255,255,255,0.1)';
                };
                item.onmouseleave = () => {
                    item.style.background = 'rgba(255,255,255,0.03)';
                    item.style.borderColor = 'rgba(255,255,255,0.05)';
                };

                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.value = p.id;
                cb.className = 'repo-profile-cb';
                cb.style.margin = '0';
                cb.style.flexShrink = '0';
                cb.style.cursor = 'pointer';

                // If active profile, check it
                if (window.activeProfileId === p.id) {
                    cb.checked = true;
                }

                // Clicking the item toggles the checkbox
                item.onclick = (e) => {
                    if (e.target !== cb) {
                        cb.checked = !cb.checked;
                    }
                };

                const info = document.createElement('div');
                info.style.marginLeft = '12px';
                info.style.display = 'flex';
                info.style.flexDirection = 'column';

                const name = document.createElement('span');
                name.textContent = p.name;
                name.style.fontSize = '13.5px';
                name.style.fontWeight = '600';
                name.style.color = 'var(--text-color)';

                const game = document.createElement('span');
                game.textContent = p.game_name || t('repo.genericGame') || 'Generic Game';
                game.style.fontSize = '11px';
                game.style.color = 'var(--text-muted)';
                game.style.opacity = '0.7';

                info.appendChild(name);
                info.appendChild(game);
                
                item.appendChild(cb);
                item.appendChild(info);
                profilesListEl.appendChild(item);
            });
        } catch (err) {
            console.error(err);
        }
    };

    loadProfilesForExport();

    // ─── Folder picker for export destination ────────────────────────
    if (btnPickExport) {
        btnPickExport.addEventListener('click', async () => {
            const folder = await pickFolder();
            if (folder) inputExportPath.value = folder;
        });
    }
    
    // ─── Folder picker for Host repository ───────────────────────────
    const btnPickRepoHost = document.getElementById('btn-pick-repo-host');
    if (btnPickRepoHost) {
        btnPickRepoHost.addEventListener('click', async () => {
            const folder = await pickFolder();
            if (folder) {
                previewHostRepo(folder);
            }
        });
    }

    // ─── Folder pickers for sync ──────────────────────────────────────
    if (btnPickSyncGame) {
        btnPickSyncGame.addEventListener('click', async () => {
            const folder = await pickFolder();
            if (folder) inputSyncGamePath.value = folder;
        });
    }
    if (btnPickSyncMods) {
        btnPickSyncMods.addEventListener('click', async () => {
            const folder = await pickFolder();
            if (folder) inputSyncModsPath.value = folder;
        });
    }
    if (btnPickSyncBackup) {
        btnPickSyncBackup.addEventListener('click', async () => {
            const folder = await pickFolder();
            if (folder) inputSyncBackupPath.value = folder;
        });
    }

    // ─── Initialize Creator ID ────────────────────────────────────────
    const initCreatorId = async () => {
        try {
            const creatorId = await invoke('get_creator_id');
            if (repoCreatorIdValue) repoCreatorIdValue.textContent = creatorId;
            if (repoCreatorIdContainer) repoCreatorIdContainer.style.display = 'block';
        } catch (err) {
            console.error("Failed to load Creator ID:", err);
        }
    };
    initCreatorId();

    const syncPathsSection = document.getElementById('repo-sync-paths-section');
    const profilesSelectionEl = document.getElementById('repo-sync-profiles-selection');
    let lastFetchedRepo = null;
    
    const updateSyncPathsVisibility = () => {
        const sec = document.getElementById('repo-sync-paths-section');
        if (!sec) return;
        const boxes = document.querySelectorAll('.repo-sync-choice-cb:checked');
        const hasNew = Array.from(boxes).some(cb => cb.value === 'NEW');
        sec.style.display = hasNew ? 'block' : 'none';
        updateSyncTotalSize();
    };

    const updateSyncTotalSize = () => {
        const totalSizeEl = document.getElementById('repo-sync-total-size');
        if (!totalSizeEl || !lastFetchedRepo) return;

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
        } else {
            totalSizeEl.textContent = "";
        }
    };

    if (btnFetchInfo) {
        btnFetchInfo.addEventListener('click', async () => {
            const url = inputSyncUrl.value.trim();
            if (!url) return toast(t('repo.errNoUrl'), 'warning');

            try {
                btnFetchInfo.disabled = true;
                const repo = await invoke('fetch_repo_info', { url });
                saveClientHistory(url);
                lastFetchedRepo = repo;
                const isVerified = await invoke('verify_repo_signature', { repo });

                syncInfoCard.style.display = 'block';
                syncNameDisplay.textContent = repo.name;
                syncAuthorDisplay.textContent = (t('repo.authorShort') || "Auteur :") + " " + (repo.author || "Inconnu");
                syncDescDisplay.textContent = repo.description || "";
                syncGameBadge.textContent = repo.game_name;

                if (isVerified) {
                    syncBadge.textContent = t('repo.verified') || "Vérifié ✅";
                    syncBadge.style.background = 'rgba(46, 204, 113, 0.2)';
                    syncBadge.style.color = '#2ecc71';
                } else {
                    syncBadge.textContent = t('repo.unverified') || "Non vérifié ⚠️";
                    syncBadge.style.background = 'rgba(231, 76, 60, 0.2)';
                    syncBadge.style.color = '#e74c3c';
                }

                // Render profiles selection
                if (profilesSelectionEl && repo.profiles) {
                    profilesSelectionEl.innerHTML = `<div style="font-size:11px; font-weight:700; color:var(--text-secondary); margin-bottom:10px; opacity:0.8;">${t('repo.selectSyncTasks') || 'SÉLECTION DES PROFILS À SYNCHRONISER :'}</div>`;
                    
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

                        // Helper for checkboxes
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

                        // 1. Choice: New Profile
                        addOption(t('repo.syncNew') || "+ Créer un nouveau profil", "NEW", !localProfiles.some(lp => lp.origin_repo_profile_id === rp.id));

                        // 2. Choice: Update existing local matches
                        const matches = localProfiles.filter(lp => lp.origin_repo_profile_id === rp.id);
                        matches.forEach(m => {
                            addOption(`${t('repo.syncUpdate') || 'Mettre à jour :'} ${m.name}`, m.id, true);
                        });

                        group.appendChild(optionsContainer);
                        profilesSelectionEl.appendChild(group);
                    });
                    updateSyncPathsVisibility();
                }

            } catch (err) {
                toast(String(err), 'error');
            } finally {
                btnFetchInfo.disabled = false;
            }
        });
    }

    // ─── Export button ────────────────────────────────────────────────
    if (btnStartExport) {
        btnStartExport.addEventListener('click', async () => {
            const outPath = inputExportPath.value.trim();
            const authorName = inputExportAuthor ? inputExportAuthor.value.trim() : null;
            if (!outPath) {
                toast(t('repo.errNoOutDir') || "Veuillez sélectionner un dossier de destination.", 'warning');
                return;
            }

            const cbs = document.querySelectorAll('.repo-profile-cb:checked');
            const profileIds = Array.from(cbs).map(c => c.value);
            if (profileIds.length === 0) {
                toast(t('repo.errNoProfile') || "Veuillez sélectionner au moins un profil à exporter.", 'warning');
                return;
            }

            let unlisten;
            try {
                btnStartExport.disabled = true;
                exportProgressContainer.style.display = 'block';
                exportStatus.textContent = t('repo.exporting') || "Génération en cours...";
                exportPercent.textContent = "0%";
                exportFill.style.width = "0%";

                if (window.__TAURI__) {
                    const { listen } = await import('https://unpkg.com/@tauri-apps/api@1/event.js');
                    // Rust emits: { step: String, progress: f32, current_file: String }
                    unlisten = await listen('bmm://repo-export-progress', (event) => {
                        const { step, progress } = event.payload;
                        if (progress !== undefined) {
                            const pct = Math.round(progress);
                            exportPercent.textContent = `${pct}%`;
                            exportFill.style.width = `${pct}%`;
                        }
                        if (step) {
                            exportStatus.textContent = step;
                        }
                    });
                }

                await invoke('export_server_repo', { profileIds, outputDir: outPath, authorName });
                saveHostHistory(outPath);

                exportStatus.textContent = t('repo.exportDone') || "Génération terminée avec succès !";
                exportPercent.textContent = "100%";
                exportFill.style.width = "100%";
                toast(t('repo.exportSuccess') || "Repository serveur généré.", 'success');
            } catch (err) {
                exportStatus.textContent = t('repo.exportError') || "Erreur...";
                toast(String(err), 'error');
            } finally {
                btnStartExport.disabled = false;
                if (unlisten) unlisten();
            }
        });
    }

    // ─── Sync button ──────────────────────────────────────────────────
    if (btnStartSync) {
        btnStartSync.addEventListener('click', async () => {
            const url = inputSyncUrl.value.trim();
            if (!url) {
                toast(t('repo.errNoUrl') || "Veuillez entrer une URL valide.", 'warning');
                return;
            }

            const gameDir   = inputSyncGamePath   ? inputSyncGamePath.value.trim()   : '';
            const modsDir   = inputSyncModsPath   ? inputSyncModsPath.value.trim()   : '';
            const backupDir = inputSyncBackupPath ? inputSyncBackupPath.value.trim() : '';

            if (syncPathsSection && syncPathsSection.style.display !== 'none') {
                if (!gameDir || !modsDir || !backupDir) {
                    toast(t('repo.errSyncFolders') || "Veuillez renseigner les 3 dossiers (Jeu, Mods, Backup) avant de synchroniser.", 'warning');
                    return;
                }
            }

            // Collect choices
            const selectedBoxes = document.querySelectorAll('.repo-sync-choice-cb:checked');
            const choices = Array.from(selectedBoxes).map(cb => {
                return {
                    repo_profile_id: cb.dataset.repoProfileId,
                    target_local_profile_id: cb.value === 'NEW' ? null : cb.value
                };
            });

            if (choices.length === 0) {
                toast(t('repo.errNoSelection') || "Veuillez sélectionner au moins une action à synchroniser.", 'warning');
                return;
            }

            let unlisten;
            try {
                btnStartSync.disabled = true;
                syncProgressContainer.style.display = 'block';
                syncStatus.textContent = t('repo.syncing') || "Synchronisation...";
                syncPercent.textContent = "0%";
                syncFill.style.width = "0%";        // ← Start at 0, not 100 !
                syncDetails.textContent = t('repo.syncStarting') || "Démarrage...";
                if (btnPauseSync) btnPauseSync.style.display = 'flex';
                if (btnCancelSync) {
                    btnCancelSync.style.display = 'flex';
                    btnCancelSync.disabled = false;
                }

                if (window.__TAURI__) {
                    const { listen } = await import('https://unpkg.com/@tauri-apps/api@1/event.js');
                    // Rust emits: { step: String, progress: f32, current_file: String }
                    unlisten = await listen('bmm://repo-sync-progress', (event) => {
                        const { step, progress, current_file } = event.payload;
                        if (progress !== undefined) {
                            const pct = Math.min(Math.round(progress), 100);
                            syncPercent.textContent = `${pct}%`;
                            syncFill.style.width = `${pct}%`;
                        }
                        if (step) {
                            syncStatus.textContent = step;
                        }
                        if (current_file) {
                            syncDetails.textContent = current_file;
                        }
                    });
                }

                const summary = await invoke('sync_server_repo', {
                    args: {
                        url,
                        game_dir: gameDir,
                        mods_dir: modsDir,
                        backup_dir: backupDir,
                        choices
                    }
                });

                showSyncSummary(summary);

                syncStatus.textContent = t('repo.syncDone') || "Synchronisation terminée !";
                syncPercent.textContent = "100%";
                syncFill.style.width = "100%";
                syncDetails.textContent = t('repo.syncComplete') || "Opération terminée.";
                
                toast(t('repo.syncSuccess') || "Profil synchronisé avec succès.", 'success');
                
                if (window._refreshModsFn) {
                    window._refreshModsFn(true);
                }
                await renderProfiles();
                updateLibraryProfileSelector();
            } catch (err) {
                const errMsg = String(err);
                if (errMsg.includes("Synchronisation annulée")) {
                    syncStatus.textContent = t('repo.syncCancelled') || "Synchronisation annulée";
                    toast(t('repo.syncCancelled') || "Synchronisation annulée", 'info');
                } else {
                    syncStatus.textContent = t('repo.syncError') || "Erreur de synchro";
                    toast(errMsg, 'error');
                }
            } finally {
                btnStartSync.disabled = false;
                if (unlisten) unlisten();
                if (btnPauseSync) {
                    btnPauseSync.style.display = 'none';
                    pausedBadge.style.display = 'none';
                    pauseText.textContent = "Pause";
                }
                if (btnCancelSync) btnCancelSync.style.display = 'none';
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
                    pauseText.textContent = "Pause";
                    btnPauseSync.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> <span>Pause</span>';
                } else {
                    await invoke('pause_repo_sync');
                    pausedBadge.style.display = 'block';
                    pauseText.textContent = "Reprendre";
                    btnPauseSync.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> <span>Reprendre</span>';
                }
            } catch (err) {
                toast("Erreur Pause/Reprise : " + err, 'error');
            }
        });
    }

    if (btnCancelSync) {
        btnCancelSync.addEventListener('click', async () => {
            try {
                await invoke('cancel_repo_sync');
                toast("Demande d'annulation envoyée...", 'info');
                btnCancelSync.disabled = true;
            } catch (err) {
                toast("Erreur Annulation : " + err, 'error');
            }
        });
    }

    // ─── Host Server toggle ───────────────────────────────────────────
    if (btnToggleServer) {
        btnToggleServer.addEventListener('click', async () => {
            if (isServerRunning) {
                try {
                    await invoke('stop_repo_server');
                    isServerRunning = false;
                    btnToggleServer.innerHTML = '<span id="repo-server-btn-text"></span>';
                    const txt = btnToggleServer.querySelector('#repo-server-btn-text');
                    txt.textContent = t('repo.hostStart') || "▶ Démarrer le serveur";
                    btnToggleServer.style.background = "rgba(46, 204, 113, 0.1)";
                    btnToggleServer.style.color = "#2ecc71";
                    btnToggleServer.style.borderColor = "rgba(46, 204, 113, 0.2)";
                    urlContainerServer.style.display = "none";
                    if (serverStatusDot) {
                        serverStatusDot.style.background = '#555';
                        serverStatusDot.style.boxShadow = 'none';
                    }
                    if (serverStatusLabel) serverStatusLabel.textContent = t('repo.serverOffline') || 'Serveur hors ligne';
                    toast(t('repo.hostServerStopped') || "Serveur arrêté", "success");
                } catch (err) {
                    toast(String(err), "error");
                }
            } else {
                const hostPathInput = document.getElementById('repo-host-path');
                let path = hostPathInput ? hostPathInput.value.trim() : "";
                if (!path && inputExportPath) path = inputExportPath.value.trim();

                if (!path) {
                    toast(t('repo.hostServerStartReq') || "Veuillez d'abord sélectionner un dossier de dépôt à héberger.", "warning");
                    return;
                }
                try {
                    const loadingBar = document.getElementById('repo-server-loading-bar');
                    if (loadingBar) loadingBar.style.display = 'block';
                    btnToggleServer.disabled = true;
                    const originalBtnContent = btnToggleServer.innerHTML;
                    btnToggleServer.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 1s linear infinite;margin-right:8px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> <span>Initialisation...</span>';
                    
                    // Now returns { lan_url, public_url, upnp_success }
                    const result = await invoke('start_repo_server', { path });
                    
                    isServerRunning = true;
                    // Re-set HTML structure properly
                    btnToggleServer.innerHTML = '<span id="repo-server-btn-text"></span>';
                    const newTextEl = btnToggleServer.querySelector('#repo-server-btn-text');
                    newTextEl.textContent = t('repo.hostStop') || "⏹ Arrêter le serveur";
                    btnToggleServer.style.background = "rgba(231, 76, 60, 0.1)";
                    btnToggleServer.style.color = "#e74c3c";
                    btnToggleServer.style.borderColor = "rgba(231, 76, 60, 0.2)";
                    if (serverStatusDot) {
                        serverStatusDot.style.background = '#2ecc71';
                        serverStatusDot.style.boxShadow = '0 0 8px #2ecc71';
                    }
                    if (serverStatusLabel) serverStatusLabel.textContent = t('repo.serverOnline') || 'Serveur en ligne — port 8000';
                    
                    urlInputServer.value = result.lan_url;
                    
                    if (result.public_url) {
                        publicUrlInput.value = result.public_url;
                        publicSection.style.display = 'block';
                        publicHintBox.style.display = 'none'; // Hide manual hint if we have public URL
                        
                        if (upnpBadgeStatus) {
                            if (result.upnp_success) {
                                upnpBadgeStatus.style.background = 'rgba(46, 204, 113, 0.2)';
                                upnpBadgeStatus.style.color = '#2ecc71';
                                upnpBadgeStatus.textContent = t('repo.upnpOk') || 'UPnP OK';
                            } else {
                                upnpBadgeStatus.style.background = 'rgba(231, 76, 60, 0.2)';
                                upnpBadgeStatus.style.color = '#e74c3c';
                                upnpBadgeStatus.textContent = t('repo.upnpFail') || 'UPnP FAIL';
                            }
                        }
                    } else {
                        publicSection.style.display = 'none';
                        publicHintBox.style.display = 'block';
                    }

                    if (result.tunnel_url) {
                        tunnelUrlInput.value = result.tunnel_url;
                        tunnelSection.style.display = 'block';
                    } else {
                        tunnelSection.style.display = 'none';
                    }

                    urlContainerServer.style.display = "flex";
                    toast(t('repo.hostServerStarted') || "Serveur démarré !", "success");
                } catch (err) {
                    toast(String(err), "error");
                    // Revert button content on error
                    btnToggleServer.innerHTML = '<span id="repo-server-btn-text"></span>';
                    const txt = btnToggleServer.querySelector('#repo-server-btn-text');
                    txt.textContent = t('repo.hostStart') || "▶ Démarrer le serveur";
                } finally {
                    btnToggleServer.disabled = false;
                    const loadingBar = document.getElementById('repo-server-loading-bar');
                    if (loadingBar) loadingBar.style.display = 'none';
                }
            }
        });
    }

    if (btnCopyUrlServer) {
        btnCopyUrlServer.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(urlInputServer.value);
                toast(t('repo.urlCopied') || "URL copiée dans le presse-papier", "success");
            } catch(e) {
                toast(t('repo.urlCopyError') || "Erreur lors de la copie", "error");
            }
        });
    }

    if (btnCopyPublicUrl) {
        btnCopyPublicUrl.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(publicUrlInput.value);
                toast(t('repo.urlCopied') || "URL copiée dans le presse-papier", "success");
            } catch(e) {
                toast(t('repo.urlCopyError') || "Erreur lors de la copie", "error");
            }
        });
    }

    if (btnCopyTunnelUrl) {
        btnCopyTunnelUrl.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(tunnelUrlInput.value);
                toast(t('repo.urlCopied') || "URL copiée dans le presse-papier", "success");
            } catch(e) {
                toast(t('repo.urlCopyError') || "Erreur lors de la copie", "error");
            }
        });
    }

    // ─── Restore Server Status ───────────────────────────────────────
    const restoreServerStatus = async () => {
        try {
            const status = await invoke('get_repo_server_status');
            if (status) {
                isServerRunning = true;
                const btnTxt = btnToggleServer.querySelector('#repo-server-btn-text');
                if (btnTxt) btnTxt.textContent = t('repo.hostStop') || "⏹ Arrêter le serveur";
                btnToggleServer.style.background = "rgba(231, 76, 60, 0.1)";
                btnToggleServer.style.color = "#e74c3c";
                btnToggleServer.style.borderColor = "rgba(231, 76, 60, 0.2)";
                
                if (serverStatusDot) {
                    serverStatusDot.style.background = '#2ecc71';
                    serverStatusDot.style.boxShadow = '0 0 8px #2ecc71';
                }
                if (serverStatusLabel) serverStatusLabel.textContent = t('repo.serverOnline') || 'Serveur en ligne — port 8000';
                
                urlInputServer.value = status.lan_url;
                if (status.public_url) {
                    publicUrlInput.value = status.public_url;
                    publicSection.style.display = 'block';
                    if (publicHintBox) publicHintBox.style.display = 'none';
                    if (upnpBadgeStatus) {
                        upnpBadgeStatus.style.background = status.upnp_success ? 'rgba(46, 204, 113, 0.2)' : 'rgba(231, 76, 60, 0.2)';
                        upnpBadgeStatus.style.color = status.upnp_success ? '#2ecc71' : '#e74c3c';
                        upnpBadgeStatus.textContent = status.upnp_success ? (t('repo.upnpOk') || 'UPnP OK') : (t('repo.upnpFail') || 'UPnP FAIL');
                    }
                }
                if (status.tunnel_url) {
                    tunnelUrlInput.value = status.tunnel_url;
                    tunnelSection.style.display = 'block';
                }
                urlContainerServer.style.display = "flex";
            }
        } catch (err) {
            console.error("[BMM] restoreServerStatus error:", err);
        }
    };
    restoreServerStatus();
}

function showSyncSummary(summary) {
    const body = document.getElementById('repo-sync-summary-body');
    const modal = document.getElementById('modal-repo-sync-summary');
    if (!body || !modal) return;

    if (!summary || !summary.profiles || summary.profiles.length === 0) {
        body.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">${t('repo.noChanges') || "Aucun changement détecté."}</div>`;
    } else {
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
                            <div style="font-size:12px; color:var(--success); font-weight:600;">+ ${p.mods_added} ${t('repo.summaryAdded') || 'ajoutés'}</div>
                            <div style="font-size:12px; color:var(--accent); font-weight:600;">~ ${p.mods_updated} ${t('repo.summaryUpdated') || 'mis à jour'}</div>
                            <div style="font-size:12px; color:var(--danger); font-weight:600;">- ${p.mods_removed} ${t('repo.summaryRemoved') || 'supprimés'}</div>
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
