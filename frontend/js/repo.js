import { invoke, pickFolder } from './api.js';
import { toast } from './app.js';
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
    const upnpBadge = document.getElementById('upnp-status-badge');
    const publicHintBox = document.getElementById('public-ip-hint-box');
    
    let isServerRunning = false;

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

    // ─── Export button ────────────────────────────────────────────────
    if (btnStartExport) {
        btnStartExport.addEventListener('click', async () => {
            const outPath = inputExportPath.value.trim();
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
                        const { step, progress, current_file } = event.payload;
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

                await invoke('export_server_repo', { profileIds, outputDir: outPath });

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

            if (!gameDir || !modsDir || !backupDir) {
                toast("Veuillez renseigner les 3 dossiers (Jeu, Mods, Backup) avant de synchroniser.", 'warning');
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

                await invoke('sync_server_repo', {
                    url,
                    gameDir,
                    modsDir,
                    backupDir,
                });

                syncStatus.textContent = t('repo.syncDone') || "Synchronisation terminée !";
                syncPercent.textContent = "100%";
                syncFill.style.width = "100%";
                syncDetails.textContent = t('repo.syncComplete') || "Opération terminée.";
                
                toast(t('repo.syncSuccess') || "Profil synchronisé avec succès.", 'success');
                
                if (window._refreshModsFn) {
                    window._refreshModsFn(true);
                }
            } catch (err) {
                syncStatus.textContent = t('repo.syncError') || "Erreur de synchro";
                toast(String(err), 'error');
            } finally {
                btnStartSync.disabled = false;
                if (unlisten) unlisten();
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
                    textToggleServer.textContent = t('repo.hostStart') || "▶ Démarrer le serveur";
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
                const path = inputExportPath.value.trim();
                if (!path) {
                    toast(t('repo.hostServerStartReq') || "Veuillez d'abord définir un dossier de destination et générer le repo.", "warning");
                    return;
                }
                try {
                    btnToggleServer.disabled = true;
                    // Now returns { lan_url, public_url, upnp_success }
                    const result = await invoke('start_repo_server', { path });
                    
                    isServerRunning = true;
                    textToggleServer.textContent = t('repo.hostStop') || "⏹ Arrêter le serveur";
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
                        
                        if (upnpBadge) {
                            if (result.upnp_success) {
                                upnpBadge.style.background = 'rgba(46, 204, 113, 0.2)';
                                upnpBadge.style.color = '#2ecc71';
                                upnpBadge.textContent = t('repo.upnpOk') || 'UPnP OK';
                            } else {
                                upnpBadge.style.background = 'rgba(231, 76, 60, 0.2)';
                                upnpBadge.style.color = '#e74c3c';
                                upnpBadge.textContent = t('repo.upnpFail') || 'UPnP FAIL';
                            }
                        }
                    } else {
                        publicSection.style.display = 'none';
                        publicHintBox.style.display = 'block';
                    }

                    urlContainerServer.style.display = "flex";
                    toast(t('repo.hostServerStarted') || "Serveur démarré !", "success");
                } catch (err) {
                    toast(String(err), "error");
                } finally {
                    btnToggleServer.disabled = false;
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
}
