import { invoke, pickFolder } from './api.js';
import { toast, updateLibraryProfileSelector, formatBytes, escHtml, escAttr } from './app.js';
import { renderProfiles } from './profiles.js';
import { t } from './i18n.js';

const copyToClipboard = async (text, successMsg) => {
    try {
        await navigator.clipboard.writeText(text);
        toast(successMsg || t('repo.urlCopied') || "Copié !", "success");
    } catch (err) {
        toast(t('repo.urlCopyError') || "Erreur de copie", "error");
    }
};

const showConfirm = (title, message, isDanger = true) => {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-confirm-generic');
        const titleEl = document.getElementById('confirm-title');
        const messageEl = document.getElementById('confirm-message');
        const btnYes = document.getElementById('btn-confirm-yes');
        const btnCancel = document.getElementById('btn-confirm-cancel');
        const iconContainer = document.getElementById('confirm-icon-container');

        if (!modal || !btnYes || !btnCancel) return resolve(false);

        titleEl.textContent = title || t('common.confirm') || "Confirmation";
        messageEl.textContent = message || "";
        
        if (isDanger) {
            btnYes.className = 'btn btn-danger';
            if (iconContainer) {
                iconContainer.style.background = 'rgba(239, 68, 68, 0.1)';
                iconContainer.style.color = 'var(--danger)';
            }
        } else {
            btnYes.className = 'btn btn-accent';
            if (iconContainer) {
                iconContainer.style.background = 'rgba(59, 130, 246, 0.1)';
                iconContainer.style.color = 'var(--accent)';
            }
        }

        const cleanup = () => {
            modal.classList.remove('open');
            btnYes.onclick = null;
            btnCancel.onclick = null;
            modal.onclick = null;
        };

        btnYes.onclick = () => { cleanup(); resolve(true); };
        btnCancel.onclick = () => { cleanup(); resolve(false); };
        modal.onclick = (e) => { if (e.target === modal) { cleanup(); resolve(false); } };

        modal.classList.add('open');
    });
};

export function initRepo() {
    // ── Export elements ──────────────────────────────────────────────
    const btnPickExport = document.getElementById('btn-pick-repo-export');
    const inputExportPath = document.getElementById('repo-export-path');
    const btnStartExport = document.getElementById('btn-start-repo-export');
    const exportProgressContainer = document.getElementById('repo-export-progress-container');
    const exportStatus = document.getElementById('repo-export-status');
    const exportPercent = document.getElementById('repo-export-percent');
    const exportFill = document.getElementById('repo-export-progress-fill');
    const inputExportSeed = document.getElementById('repo-export-seed');

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
    const inputSyncDownloadLimit = document.getElementById('repo-sync-download-limit');

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
    const btnCancelExport = document.getElementById('btn-cancel-repo-export');
    const tunnelSection = document.getElementById('repo-server-tunnel-section');
    const tunnelUrlInput = document.getElementById('repo-server-tunnel-url');
    const btnCopyTunnelUrl = document.getElementById('btn-copy-repo-tunnel-url');
    const inputServerPort = document.getElementById('repo-server-port');
    const inputServerUploadLimit = document.getElementById('repo-server-upload-limit');
    const btnOpenMonitoring = document.getElementById('btn-open-monitoring');
    const btnOpenBans = document.getElementById('btn-open-bans');
    const btnOpenWhitelist = document.getElementById('btn-open-whitelist');
    const modalMonitoring = document.getElementById('modal-monitoring');
    const modalBans = document.getElementById('modal-bans');
    const modalWhitelist = document.getElementById('modal-whitelist');
    const monitoringListBody = document.getElementById('monitoring-list-body');
    const monitoringEmptyHint = document.getElementById('monitoring-empty-hint');
    const banListContainer = document.getElementById('ban-list-container');
    const whitelistListContainer = document.getElementById('whitelist-list-container');
    const btnAddManualBan = document.getElementById('btn-add-manual-ban');
    const btnAddManualWhitelist = document.getElementById('btn-add-manual-whitelist');
    const manualBanIp = document.getElementById('manual-ban-ip');
    const manualBanKey = document.getElementById('manual-ban-key');
    const manualWhitelistIp = document.getElementById('manual-whitelist-ip');
    const manualWhitelistKey = document.getElementById('manual-whitelist-key');
    const whitelistToggle = document.getElementById('whitelist-toggle');
    const whitelistSearch = document.getElementById('whitelist-search');
    const btnClearWhitelist = document.getElementById('btn-clear-whitelist');
    const serverTools = document.getElementById('repo-server-tools');
    const inputMiniServerUploadLimit = document.getElementById('repo-mini-server-upload-limit');

    // Advanced Repo Settings
    const advancedToggle = document.getElementById('repo-server-advanced-toggle');
    const advancedContent = document.getElementById('repo-server-advanced-content');
    const advancedCaret = document.getElementById('repo-advanced-caret');
    const inputCloudflaredPath = document.getElementById('settings-cloudflared-path');
    const btnPickCloudflared = document.getElementById('btn-pick-cloudflared');
    
    // Sync elements
    const btnFetchInfo = document.getElementById('btn-fetch-repo-info');
    const syncInfoCard = document.getElementById('repo-sync-info-card');
    const syncBadge = document.getElementById('repo-sync-author-badge');
    const syncGameBadge = document.getElementById('repo-sync-game-badge');
    const syncNameDisplay = document.getElementById('repo-sync-name-display');
    const syncAuthorDisplay = document.getElementById('repo-sync-author-display');
    const syncDescDisplay = document.getElementById('repo-sync-desc-display');
    const btnClearFetchedRepo = document.getElementById('btn-clear-fetched-repo');
    const profilesSelectionEl = document.getElementById('repo-sync-profiles-selection');
    const syncTotalSizeEl = document.getElementById('repo-sync-total-size');
    const syncUrlCard = document.getElementById('repo-sync-url-card');
    const syncPathsSection = document.getElementById('repo-sync-paths-section');
    
    // History Elements
    const hostHistorySelect = document.getElementById('repo-host-history-select');
    const hostHistoryContainer = document.getElementById('repo-host-history-container');
    const hostMetadataPreview = document.getElementById('repo-host-metadata-preview');
    
    // Sync History Elements
    const syncHistoryContainer = document.getElementById('repo-sync-history-container');
    const syncHistoryList = document.getElementById('repo-sync-history-list');

    let isServerRunning = false;

    // ── Load Settings ──
    const loadRepoSettings = async () => {
        try {
            const settings = await invoke('get_settings');
            if (inputCloudflaredPath && settings.cloudflared_path) {
                inputCloudflaredPath.value = settings.cloudflared_path;
            }
        } catch (e) {
            console.error("[BMM] Failed to load repo settings:", e);
        }
    };
    loadRepoSettings();

    // ── Advanced Toggle ──
    if (advancedToggle) {
        advancedToggle.addEventListener('click', () => {
            const isHidden = advancedContent.style.display === 'none';
            advancedContent.style.display = isHidden ? 'block' : 'none';
            if (advancedCaret) {
                advancedCaret.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
            }
        });
    }

    if (btnPickCloudflared) {
        btnPickCloudflared.addEventListener('click', async () => {
            const { pickFile } = await import('./api.js');
            const path = await pickFile(['exe']);
            if (path) {
                inputCloudflaredPath.value = path;
                // Save immediately
                try {
                    const settings = await invoke('get_settings');
                    settings.cloudflared_path = path;
                    await invoke('update_settings', { settings });
                    toast(t('repo.cloudflaredPathUpdated') || "Chemin cloudflared mis à jour.", 'success');
                } catch (e) {
                    toast(String(e), 'error');
                }
            }
        });
    }

    if (inputCloudflaredPath) {
        inputCloudflaredPath.addEventListener('change', async () => {
            try {
                const settings = await invoke('get_settings');
                settings.cloudflared_path = inputCloudflaredPath.value.trim() || null;
                await invoke('update_settings', { settings });
            } catch (e) {
                console.error("[BMM] Failed to save cloudflared path:", e);
            }
        });
    }

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
                                    ${t('repo.connectBtn')}
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
                        <div style="color:var(--text-secondary);margin-bottom:2px;">${t('repo.authorShort')} <span style="color:var(--text-primary)">${escHtml(repo.author || '-')}</span></div>
                        <div style="color:var(--text-secondary);margin-bottom:2px;">${t('repo.profilesCount').replace('{count}', pCount)} <span style="color:var(--text-primary)">${escHtml(pNames)}</span></div>
                        <div style="color:var(--cyan);margin-top:6px;font-family:var(--font-mono)">${t('repo.totalSizeLabel')} ${formatBytes(totalSize)}</div>
                    `;
                }
            }
        } catch (err) {
            if (hostMetadataPreview) {
                hostMetadataPreview.style.display = 'block';
                hostMetadataPreview.innerHTML = `<div style="color:var(--danger);">${t('repo.readError')} (${err})</div>`;
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
                profilesListEl.innerHTML = `<div style="color:var(--text-muted); font-size:12px; text-align:center;">${t('repo.noProfiles')}</div>`;
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
            if (folder) {
                inputExportPath.value = folder;
                
                // Try to detect existing seed
                try {
                    if (window.__TAURI__) {
                        const { readTextFile } = window.__TAURI__.fs;
                        const manifestPath = folder + '/repo.json';
                        const content = await readTextFile(manifestPath);
                        const repo = JSON.parse(content);
                        if (repo.seed && inputExportSeed) {
                            inputExportSeed.value = repo.seed;
                            toast(t('repo.seedDetected') || "Graine serveur détectée et chargée.", 'info');
                        }
                    }
                } catch (e) {
                    // No existing repo or no seed, it's fine
                    if (inputExportSeed) inputExportSeed.value = '';
                }
            }
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

    let lastFetchedRepo = null;
    let lastFetchedRepoSaltedId = null;
    
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
                
                // 1. Fetch basic info (no salted ID yet)
                let repo = await invoke('fetch_repo_info', { url, creatorId: null });
                
                // 2. If it has a seed, generate a salted ID for THIS server
                let saltedCreatorId = null;
                if (repo.seed) {
                    saltedCreatorId = await invoke('get_salted_creator_id', { salt: repo.seed });
                    // Store for the sub-tasks
                    lastFetchedRepoSaltedId = saltedCreatorId;
                    
                    // Re-fetch with the salted ID to pass the server's whitelist/ban check and get full data
                    repo = await invoke('fetch_repo_info', { url, creatorId: saltedCreatorId });
                }

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

                        // 3. Selection of ANY existing profile
                        if (localProfiles.length > matches.length) {
                             const otherProfiles = localProfiles;
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
                                 otherProfiles.map(lp => `<option value="${lp.id}">${lp.name}</option>`).join('');

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

            } catch (err) {
                const errMsg = String(err);
                toast(t(errMsg) || errMsg, 'error');
            } finally {
                btnFetchInfo.disabled = false;
            }
        });
    }

    if (btnClearFetchedRepo) {
        btnClearFetchedRepo.addEventListener('click', () => {
            syncInfoCard.style.display = 'none';
            lastFetchedRepo = null;
            if (profilesSelectionEl) profilesSelectionEl.innerHTML = '';
            const totalSizeEl = document.getElementById('repo-sync-total-size');
            if (totalSizeEl) totalSizeEl.textContent = '';
            updateSyncPathsVisibility();
        });
    }

    // ─── Export button ────────────────────────────────────────────────
    if (btnStartExport) {
        btnStartExport.addEventListener('click', async () => {
            const outPath = inputExportPath.value.trim();
            const authorName = inputExportAuthor ? inputExportAuthor.value.trim() : "";
            
            if (!outPath) {
                toast(t('repo.errNoOutDir'), 'warning');
                return;
            }
            if (!authorName) {
                toast(t('repo.errNoAuthor') || "Le nom du créateur est requis.", 'warning');
                if (inputExportAuthor) inputExportAuthor.focus();
                return;
            }
            // Save author name for next time
            localStorage.setItem('bmm_last_author', authorName);


            const cbs = document.querySelectorAll('.repo-profile-cb:checked');
            const profileIds = Array.from(cbs).map(c => c.value);
            if (profileIds.length === 0) {
                toast(t('repo.errNoProfile'), 'warning');
                return;
            }

            let unlisten;
            try {
                btnStartExport.disabled = true;
                exportProgressContainer.style.display = 'block';
                exportStatus.textContent = t('repo.exporting') || "Génération en cours...";
                exportPercent.textContent = "0%";
                exportFill.style.width = "0%";
                if (btnCancelExport) {
                    btnCancelExport.style.display = 'flex';
                    btnCancelExport.disabled = false;
                }

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
                            if (step.startsWith('{')) {
                                try {
                                    const data = JSON.parse(step);
                                    exportStatus.textContent = t(data.key, data);
                                } catch (e) {
                                    exportStatus.textContent = t(step) || step;
                                }
                            } else {
                                exportStatus.textContent = t(step) || step;
                            }
                        }
                    });
                }

                await invoke('export_server_repo', { 
                    profileIds, 
                    outputDir: outPath, 
                    authorName,
                    seed: inputExportSeed ? inputExportSeed.value.trim() || null : null
                });
                saveHostHistory(outPath);

                exportStatus.textContent = t('repo.exportDone') || "Génération terminée avec succès !";
                exportPercent.textContent = "100%";
                exportFill.style.width = "100%";
                toast(t('repo.exportSuccess') || "Repository serveur généré.", 'success');
            } catch (err) {
                const errMsg = String(err);
                if (errMsg.includes('annul') || errMsg.includes('cancel')) {
                    exportStatus.textContent = t('repo.cancelExport') || "Génération annulée";
                    toast(t('repo.cancelExport') || "Génération annulée", 'info');
                } else {
                    exportStatus.textContent = t('repo.exportError') || "Erreur...";
                    toast(errMsg, 'error');
                }
            } finally {
                btnStartExport.disabled = false;
                if (btnCancelExport) btnCancelExport.style.display = 'none';
                if (unlisten) unlisten();
            }
        });
    }

    // ─── Sync button ──────────────────────────────────────────────────
    if (btnStartSync) {
        btnStartSync.addEventListener('click', async () => {
            const url = inputSyncUrl.value.trim();
            if (!url) {
                toast(t('repo.errNoUrl'), 'warning');
                return;
            }

            const gameDir   = inputSyncGamePath   ? inputSyncGamePath.value.trim()   : '';
            const modsDir   = inputSyncModsPath   ? inputSyncModsPath.value.trim()   : '';
            const backupDir = inputSyncBackupPath ? inputSyncBackupPath.value.trim() : '';

            if (syncPathsSection && syncPathsSection.style.display !== 'none') {
                if (!gameDir || !modsDir || !backupDir) {
                    toast(t('repo.errSyncFolders'), 'warning');
                    return;
                }
            }

            // Collect choices
            const selectedBoxes = document.querySelectorAll('.repo-sync-choice-cb:checked');
            const choices = Array.from(selectedBoxes).map(cb => {
                return {
                    repoProfileId: cb.dataset.repoProfileId,
                    targetLocalProfileId: cb.value === 'NEW' ? null : cb.value
                };
            });

            if (choices.length === 0) {
                toast(t('repo.errNoSelection'), 'warning');
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
                            if (step.startsWith('{')) {
                                try {
                                    const data = JSON.parse(step);
                                    syncStatus.textContent = t(data.key, data);
                                } catch (e) {
                                    syncStatus.textContent = t(step) || step;
                                }
                            } else {
                                syncStatus.textContent = t(step) || step;
                            }
                        }
                        if (current_file) {
                            syncDetails.textContent = current_file;
                        }
                    });
                }

                const finalCreatorId = lastFetchedRepoSaltedId || await invoke('get_creator_id');
                const syncMode = document.getElementById('repo-sync-mode')?.value || 'missing';
                const cleanExtra = document.getElementById('repo-sync-clean-extra')?.checked || false;

                const downloadLimit = parseInt(inputSyncDownloadLimit ? inputSyncDownloadLimit.value : "0") || 0;

                const summary = await invoke('sync_server_repo', {
                    args: {
                        url,
                        creatorId: finalCreatorId,
                        gameDir: gameDir,
                        modsDir: modsDir,
                        backupDir: backupDir,
                        choices,
                        overwriteAll: syncMode === 'all',
                        deleteExtra: cleanExtra,
                        downloadLimit: downloadLimit
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
                    // If errMsg is a key (e.g. repo.errSyncForbidden), translate it
                    toast(t(errMsg) || errMsg, 'error');
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
                    pauseText.textContent = t('repo.pauseSync');
                    btnPauseSync.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> <span>${t('repo.pauseSync')}</span>`;
                } else {
                    await invoke('pause_repo_sync');
                    pausedBadge.style.display = 'block';
                    pauseText.textContent = t('repo.resumeSync');
                    btnPauseSync.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> <span>${t('repo.resumeSync')}</span>`;
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
                toast(t('repo.syncCancelled') || "Annulation en cours...", 'info');
                btnCancelSync.disabled = true;
            } catch (err) {
                toast(t('common.error') + ': ' + err, 'error');
            }
        });
    }

    // ─── Cancel Export button ─────────────────────────────────────────
    if (btnCancelExport) {
        btnCancelExport.addEventListener('click', async () => {
            try {
                btnCancelExport.disabled = true;
                // Try invoking a cancel command - graceful fallback if not implemented
                if (window.__TAURI__) {
                    try { await invoke('cancel_repo_export'); } catch(e) {}
                }
                toast(t('repo.cancelExport') || "Annulation en cours...", 'info');
            } catch (err) {
                toast(String(err), 'error');
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
                    if (inputServerPort) inputServerPort.disabled = false;
                    if (serverTools) serverTools.style.display = 'none';
                    if (repoCreatorIdContainer) repoCreatorIdContainer.style.display = 'none';
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
                    btnToggleServer.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 1s linear infinite;margin-right:8px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> <span>${t('repo.initServer') || 'Initialisation...'}</span>`;
                    
                    const port = parseInt(inputServerPort ? inputServerPort.value : "8000") || 8000;
                    if (inputServerPort) inputServerPort.disabled = true;

                    const uploadLimit = parseInt(inputServerUploadLimit ? inputServerUploadLimit.value : "0") || 0;

                    // Now returns { lan_url, public_url, upnp_success }
                    const result = await invoke('start_repo_server', { path, port, uploadLimit });
                    
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
                    if (serverStatusLabel) serverStatusLabel.textContent = t('repo.serverOnline', { port }) || `Serveur en ligne — port ${port}`;
                    
                    urlInputServer.value = result.lan_url;
                    
                    if (result.seed && repoCreatorIdValue && repoCreatorIdContainer) {
                        try {
                            const saltedId = await invoke('get_salted_creator_id', { salt: result.seed });
                            repoCreatorIdValue.textContent = saltedId;
                            repoCreatorIdContainer.style.display = 'block';
                            // Suggest changing the label to "Your ID on this server"
                            const label = repoCreatorIdContainer.querySelector('label');
                            if (label) label.textContent = t('repo.yourServerId') || "Votre ID sur ce serveur";
                        } catch (e) {
                            console.error("Failed to get salted ID:", e);
                        }
                    }
                    
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
                    if (serverTools) serverTools.style.display = 'flex';
                    toast(t('repo.hostServerStarted') || "Serveur démarré !", "success");
                } catch (err) {
                    const errMsg = String(err);
                    // Try to translate if it looks like a key, or show as is
                    toast(t(errMsg) || errMsg, "error");
                    if (inputServerPort) inputServerPort.disabled = false;
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
        btnCopyTunnelUrl.addEventListener('click', () => copyToClipboard(tunnelUrlInput.value));
    }

    const btnCopyMyCreatorId = document.getElementById('btn-copy-my-creator-id');
    if (btnCopyMyCreatorId) {
        btnCopyMyCreatorId.addEventListener('click', () => {
            const val = document.getElementById('repo-creator-id-value')?.textContent;
            if (val && val !== '...') copyToClipboard(val, t('repo.idCopied') || "ID Créateur copié !");
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
                if (serverTools) serverTools.style.display = 'flex';
            }
        } catch (err) {
            console.error("[BMM] restoreServerStatus error:", err);
        }
    };
    restoreServerStatus();

    // ─── Mini-Server Generation ──────────────────────────────────────
    const btnGenMiniServer = document.getElementById('btn-generate-mini-server');
    const btnPickMiniRepo = document.getElementById('btn-pick-mini-server-repo');
    const btnPickMiniFolder = document.getElementById('btn-pick-mini-folder');
    const inputMiniRepoPath = document.getElementById('repo-mini-server-json-path');
    const cbAutoStart = document.getElementById('repo-mini-server-autostart');
    
    if (btnPickMiniRepo) {
        btnPickMiniRepo.addEventListener('click', async () => {
            const { pickFile } = await import('./api.js');
            const path = await pickFile(['json']);
            if (path) {
                inputMiniRepoPath.value = path;
                localStorage.setItem('bmm_last_mini_repo_json', path);
            }
        });
    }

    if (btnPickMiniFolder) {
        btnPickMiniFolder.addEventListener('click', async () => {
            const { pickFolder } = await import('./api.js');
            const path = await pickFolder();
            if (path) {
                const fullPath = path.endsWith('\\') || path.endsWith('/') ? path + 'repo.json' : path + '/repo.json';
                inputMiniRepoPath.value = fullPath;
                localStorage.setItem('bmm_last_mini_repo_json', fullPath);
            }
        });
    }

    // Restore last mini repo path
    if (inputMiniRepoPath) {
        const last = localStorage.getItem('bmm_last_mini_repo_json');
        if (last) inputMiniRepoPath.value = last;
    }
    
    if (btnGenMiniServer) {
        btnGenMiniServer.addEventListener('click', async () => {
            let jsonPath = inputMiniRepoPath ? inputMiniRepoPath.value.trim() : '';
            
            // Fallback if empty
            if (!jsonPath) {
                const fallbackDir = (document.getElementById('repo-host-path').value || inputExportPath.value).trim();
                if (fallbackDir) {
                    // Try to guess repo.json in that folder
                    jsonPath = fallbackDir.endsWith('.json') ? fallbackDir : (fallbackDir.endsWith('\\') || fallbackDir.endsWith('/') ? fallbackDir + 'repo.json' : fallbackDir + '/repo.json');
                }
            }

            if (!jsonPath) {
                return toast(t('repo.errNoOutDir'), 'warning');
            }

            // Extract directory from jsonPath
            let outPath = jsonPath;
            if (jsonPath.toLowerCase().endsWith('.json')) {
                outPath = jsonPath.substring(0, Math.max(jsonPath.lastIndexOf('/'), jsonPath.lastIndexOf('\\')));
            }
            const miniPortInput = document.getElementById('repo-mini-server-port');
            const port = parseInt(miniPortInput ? miniPortInput.value : "8000") || 8000;
            const autoStart = cbAutoStart ? cbAutoStart.checked : false;
            const useCloudflare = document.getElementById('repo-mini-server-cloudflare').checked;
            const useUpnp = document.getElementById('repo-mini-server-upnp').checked;
            const lang = localStorage.getItem('bmm-lang') || 'en';

            try {
                btnGenMiniServer.disabled = true;
                const originalText = btnGenMiniServer.innerHTML;
                const uploadLimit = parseInt(inputMiniServerUploadLimit ? inputMiniServerUploadLimit.value : "0") || 0;

                await invoke('generate_standalone_server', { 
                    repoPath: jsonPath, 
                    port, 
                    autoStart, 
                    useCloudflare, 
                    useUpnp, 
                    lang,
                    uploadLimit
                });

                toast(t('repo.miniServerSuccess') || "Scripts du serveur autonome générés ! (Lancer-Serveur.bat)", "success");
            } catch (err) {
                const errMsg = String(err);
                toast(t(errMsg) || errMsg, "error");
            } finally {
                btnGenMiniServer.disabled = false;
                btnGenMiniServer.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><path d="M12 5v14M5 12h14"/></svg> <span data-i18n="repo.miniServerGenerate">${t('repo.miniServerGenerate') || 'Générer le Serveur'}</span>`;
            }
        });
    }

    // Restore last author name
    const lastAuthor = localStorage.getItem('bmm_last_author');
    if (lastAuthor && inputExportAuthor) {
        inputExportAuthor.value = lastAuthor;
    }
    // ─── Monitoring & Bans ───────────────────────────────────────────
    let monitoringInterval = null;

    const startMonitoring = () => {
        if (monitoringInterval) clearInterval(monitoringInterval);
        updateMonitoring();
        monitoringInterval = setInterval(updateMonitoring, 1000);
    };

    const stopMonitoring = () => {
        if (monitoringInterval) {
            clearInterval(monitoringInterval);
            monitoringInterval = null;
        }
        modalMonitoring?.classList.remove('open');
    };

    const updateMonitoring = async () => {
        try {
            const downloads = await invoke('get_active_downloads');
            if (!downloads || downloads.length === 0) {
                monitoringListBody.innerHTML = '';
                monitoringEmptyHint.style.display = 'block';
                return;
            }

            monitoringEmptyHint.style.display = 'none';
            monitoringListBody.innerHTML = downloads.map(d => {
                const pct = Math.round(d.progress) || 0;
                const speed = d.speed || 0;
                const creatorIdText = d.creator_id && d.creator_id !== '-' ? d.creator_id : '-';
                const creatorIdHtml = d.creator_id && d.creator_id !== '-' ? 
                    `<div style="display:flex; align-items:center; gap:4px;">
                        <span style="overflow:hidden; text-overflow:ellipsis;">${escHtml(d.creator_id)}</span>
                        <button class="btn btn-ghost btn-xs copy-mon-id" data-val="${escAttr(d.creator_id)}" style="padding:0; min-width:18px; height:18px; opacity:0.5;">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        </button>
                    </div>` : '<span style="opacity:0.3;">-</span>';
                const protocol = d.protocol || 'Unknown';
                const protocolColor = protocol === 'LAN' ? 'var(--success)' : protocol === 'WAN' ? 'var(--accent)' : 'var(--cyan)';
                
                return `
                    <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                        <td style="padding:10px 8px; font-family:var(--font-mono); font-size:11px;">
                            <div style="display:flex; align-items:center; gap:4px;">
                                ${escHtml(d.ip)}
                                <button class="btn btn-ghost btn-xs copy-mon-id" data-val="${escAttr(d.ip)}" style="padding:0; min-width:18px; height:18px; opacity:0.5;">
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                </button>
                            </div>
                        </td>
                        <td style="padding:10px 8px; font-family:var(--font-mono); font-size:10px; color:var(--text-secondary); max-width:120px;">${creatorIdHtml}</td>
                        <td style="padding:10px 8px;">
                            <span style="font-size:9px; font-weight:800; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px; color:${protocolColor};">${protocol}</span>
                        </td>
                        <td style="padding:10px 8px; max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escAttr(d.file)}">${escHtml(d.file)}</td>
                        <td style="padding:10px 8px;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <div style="flex:1; height:4px; background:rgba(255,255,255,0.1); border-radius:2px; overflow:hidden;">
                                    <div style="height:100%; width:${pct}%; background:var(--accent);"></div>
                                </div>
                                <span style="font-size:10px; min-width:30px;">${pct}%</span>
                            </div>
                        </td>
                        <td style="padding:10px 8px; font-family:var(--font-mono); font-size:11px;">${formatBytes(speed)}/s</td>
                        <td style="padding:10px 8px; text-align:right;">
                            <div style="display:flex; justify-content:flex-end; gap:4px;">
                                <button class="btn btn-ghost btn-xs whitelist-from-mon" data-ip="${escAttr(d.ip)}" data-key="${escAttr(d.creator_id || '')}" style="color:var(--accent); padding:2px 6px;">
                                    ${t('repo.whitelistBtn') || 'AUTORISER'}
                                </button>
                                <button class="btn btn-ghost btn-xs ban-from-mon" data-ip="${escAttr(d.ip)}" data-key="${escAttr(d.creator_id || '')}" style="color:var(--danger); padding:2px 6px;">
                                    ${t('repo.banBtn') || 'BANNIR'}
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            // Attach listeners
            monitoringListBody.querySelectorAll('.whitelist-from-mon').forEach(btn => {
                btn.onclick = () => {
                    const ip = btn.dataset.ip;
                    const key = btn.dataset.key;
                    invoke('add_to_whitelist', { ip: ip || null, key: key || null })
                        .then(() => toast(t('repo.whitelistAddSuccess') || "Ajouté à la whitelist !", 'success'))
                        .catch(e => toast(String(e), 'error'));
                };
            });
            monitoringListBody.querySelectorAll('.ban-from-mon').forEach(btn => {
                btn.onclick = () => banUser(btn.dataset.ip, btn.dataset.key);
            });
            // Attach copy listeners
            monitoringListBody.querySelectorAll('.copy-mon-id').forEach(btn => {
                btn.onclick = () => copyToClipboard(btn.dataset.val);
            });

        } catch (err) {
            console.error("[BMM] Monitoring error:", err);
        }
    };

    if (btnOpenMonitoring) {
        btnOpenMonitoring.addEventListener('click', () => {
            modalMonitoring.classList.add('open');
            startMonitoring();
        });
    }

    // Modal close handle

    document.querySelectorAll('[data-close="modal-monitoring"]').forEach(btn => {
        btn.addEventListener('click', stopMonitoring);
    });
    modalMonitoring?.addEventListener('click', (e) => {
        if (e.target === modalMonitoring) stopMonitoring();
    });

    let currentBans = { banned_ips: [], banned_keys: [] };

    const renderBanItem = (val, type) => {
        const dataAttr = type === 'IP' ? `data-ip="${escAttr(val)}"` : `data-key="${escAttr(val)}"`;
        return `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.03);">
                <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">
                    <div style="display:flex; flex-direction:column; gap:2px; flex:1; min-width:0;">
                        <div style="font-family:var(--font-mono); font-size:12px; color:var(--text-primary); word-break:break-all;">${escHtml(val)}</div>
                        <div style="font-size:9px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; font-weight:700;">${type}</div>
                    </div>
                    <button class="btn btn-ghost btn-xs copy-ban-val" data-val="${escAttr(val)}" style="padding:0; min-width:24px; height:24px; opacity:0.6;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                </div>
                <button class="btn btn-ghost btn-xs btn-unban" ${dataAttr} style="color:var(--danger); font-size:10px; font-weight:800; margin-left:15px;">
                    ${t('common.delete') || 'SUPPRIMER'}
                </button>
            </div>
        `;
    };

    const inputBanSearch = document.getElementById('ban-search');
    const selectBanFilter = document.getElementById('ban-filter-type');

    const updateBanListUI = () => {
        const search = inputBanSearch?.value.toLowerCase() || '';
        const filter = selectBanFilter?.value || 'ALL';
        
        let filteredIps = (filter === 'ALL' || filter === 'IP') ? (currentBans.banned_ips || []).filter(ip => ip.toLowerCase().includes(search)) : [];
        let filteredKeys = (filter === 'ALL' || filter === 'KEY') ? (currentBans.banned_keys || []).filter(key => key.toLowerCase().includes(search)) : [];

        if (filteredIps.length === 0 && filteredKeys.length === 0) {
            if (banListContainer) banListContainer.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:12px;">${t('repo.noBansFound') || 'Aucun résultat...'}</div>`;
            return;
        }

        let html = '';
        filteredIps.forEach(ip => html += renderBanItem(ip, 'IP'));
        filteredKeys.forEach(key => html += renderBanItem(key, 'KEY'));
        if (banListContainer) {
            banListContainer.innerHTML = html;
            // Re-attach listeners
            banListContainer.querySelectorAll('.btn-unban').forEach(btn => {
                btn.onclick = async () => {
                    const { ip, key } = btn.dataset;
                    const val = ip || key;
                    const confirmed = await showConfirm(t('common.confirm') || "Confirmation", `${t('common.delete') || 'Supprimer'} : ${val} ?`);
                    if (!confirmed) return;
                    await invoke('unban_user', { ip: ip || null, key: key || null });
                    loadBanList();
                };
            });
            banListContainer.querySelectorAll('.copy-ban-val').forEach(btn => {
                btn.onclick = () => copyToClipboard(btn.dataset.val);
            });
        }
    };

    if (inputBanSearch) inputBanSearch.oninput = updateBanListUI;
    if (selectBanFilter) selectBanFilter.onchange = updateBanListUI;

    const loadBanList = async () => {
        try {
            currentBans = await invoke('get_ban_list');
            updateBanListUI();
        } catch (err) { console.error("[BMM] loadBanList error:", err); }
    };

    const btnUnbanAll = document.getElementById('btn-unban-all');
    if (btnUnbanAll) {
        btnUnbanAll.addEventListener('click', async () => {
            const confirmed = await showConfirm(t('repo.bansTitle') || "BANS", t('repo.confirmUnbanAll') || "Voulez-vous vraiment débannir TOUT LE MONDE ?");
            if (!confirmed) return;
            try {
                await invoke('unban_all');
                toast(t('repo.unbanAllSuccess') || "Liste des bans vidée.", 'success');
                loadBanList();
            } catch(e) { toast(String(e), 'error'); }
        });
    }

    const btnExportBans = document.getElementById('btn-export-bans');
    if (btnExportBans) {
        btnExportBans.addEventListener('click', () => {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentBans, null, 2));
            const dlAnchorElem = document.createElement('a');
            dlAnchorElem.setAttribute("href", dataStr);
            dlAnchorElem.setAttribute("download", "bmm_bans_export.json");
            dlAnchorElem.click();
            toast(t('repo.exportSuccess') || "Export terminé !", 'success');
        });
    }

    const banUser = async (ip, key) => {
        try {
            await invoke('ban_user', { ip: ip || null, key: key || null });
            toast(t('repo.banSuccess') || 'Utilisateur banni !', 'success');
            loadBanList(); 
        } catch (err) {
            toast(String(err), 'error');
        }
    };

    if (btnOpenBans) {
        btnOpenBans.addEventListener('click', () => {
            modalBans.classList.add('open');
            loadBanList();
        });
    }

    // Modal close handle for Bans
    document.querySelectorAll('[data-close="modal-bans"]').forEach(btn => {
        btn.onclick = () => {
            modalBans.classList.remove('open');
        };
    });
    modalBans?.addEventListener('click', (e) => {
        if (e.target === modalBans) modalBans.classList.remove('open');
    });

    if (btnAddManualBan) {
        btnAddManualBan.addEventListener('click', async () => {
            const ip = manualBanIp ? manualBanIp.value.trim() : "";
            const key = manualBanKey ? manualBanKey.value.trim() : "";
            if (ip || key) {
                await banUser(ip || null, key || null);
                if (manualBanIp) manualBanIp.value = '';
                if (manualBanKey) manualBanKey.value = '';
            }
        });
    }

    // --- Whitelist Logic ---

    let currentWhitelist = { enabled: false, ips: [], keys: [] };

    const renderWhitelistItem = (val, type) => {
        const dataAttr = type === 'IP' ? `data-ip="${escAttr(val)}"` : `data-key="${escAttr(val)}"`;
        return `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.03);">
                <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">
                    <div style="display:flex; flex-direction:column; gap:2px; flex:1; min-width:0;">
                        <div style="font-family:var(--font-mono); font-size:12px; color:var(--text-primary); word-break:break-all;">${escHtml(val)}</div>
                        <div style="font-size:9px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; font-weight:700;">${type}</div>
                    </div>
                    <button class="btn btn-ghost btn-xs copy-whitelist-val" data-val="${escAttr(val)}" style="padding:0; min-width:24px; height:24px; opacity:0.6;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                </div>
                <button class="btn btn-ghost btn-xs btn-remove-whitelist" ${dataAttr} style="color:var(--danger); font-size:10px; font-weight:800; margin-left:15px;">
                    ${t('common.delete') || 'SUPPRIMER'}
                </button>
            </div>
        `;
    };

    const updateWhitelistUI = () => {
        const search = whitelistSearch?.value.toLowerCase() || '';
        
        let filteredIps = (currentWhitelist.ips || []).filter(ip => ip.toLowerCase().includes(search));
        let filteredKeys = (currentWhitelist.keys || []).filter(key => key.toLowerCase().includes(search));

        if (whitelistToggle) whitelistToggle.checked = currentWhitelist.enabled;

        if (filteredIps.length === 0 && filteredKeys.length === 0) {
            if (whitelistListContainer) whitelistListContainer.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:12px;">${t('repo.noWhitelistFound') || 'Aucun résultat...'}</div>`;
            return;
        }

        let html = '';
        filteredIps.forEach(ip => html += renderWhitelistItem(ip, 'IP'));
        filteredKeys.forEach(key => html += renderWhitelistItem(key, 'KEY'));
        
        if (whitelistListContainer) {
            whitelistListContainer.innerHTML = html;
            // Re-attach listeners
            whitelistListContainer.querySelectorAll('.btn-remove-whitelist').forEach(btn => {
                btn.onclick = async () => {
                    const { ip, key } = btn.dataset;
                    const val = ip || key;
                    const confirmed = await showConfirm(t('common.confirm') || "Confirmation", `${t('common.delete') || 'Retirer'} : ${val} ?`);
                    if (!confirmed) return;
                    await invoke('remove_from_whitelist', { ip: ip || null, key: key || null });
                    loadWhitelist();
                };
            });
            whitelistListContainer.querySelectorAll('.copy-whitelist-val').forEach(btn => {
                btn.onclick = () => copyToClipboard(btn.dataset.val);
            });
        }
    };

    const loadWhitelist = async () => {
        try {
            currentWhitelist = await invoke('get_whitelist');
            updateWhitelistUI();
        } catch (err) { console.error("[BMM] loadWhitelist error:", err); }
    };

    if (whitelistSearch) whitelistSearch.oninput = updateWhitelistUI;

    if (whitelistToggle) {
        whitelistToggle.addEventListener('change', async () => {
            try {
                await invoke('toggle_whitelist', { enabled: whitelistToggle.checked });
                currentWhitelist.enabled = whitelistToggle.checked;
                toast(t('repo.whitelistUpdated') || "Paramètre whitelist mis à jour.", 'success');
            } catch (e) {
                toast(String(e), 'error');
                whitelistToggle.checked = !whitelistToggle.checked; // Revert
            }
        });
    }

    if (btnAddManualWhitelist) {
        btnAddManualWhitelist.addEventListener('click', async () => {
            const ip = manualWhitelistIp ? manualWhitelistIp.value.trim() : "";
            const key = manualWhitelistKey ? manualWhitelistKey.value.trim() : "";
            if (ip || key) {
                try {
                    await invoke('add_to_whitelist', { ip: ip || null, key: key || null });
                    toast(t('repo.whitelistAddSuccess') || "Ajouté à la whitelist !", 'success');
                    if (manualWhitelistIp) manualWhitelistIp.value = '';
                    if (manualWhitelistKey) manualWhitelistKey.value = '';
                    loadWhitelist();
                } catch (e) {
                    toast(String(e), 'error');
                }
            }
        });
    }

    if (btnClearWhitelist) {
        btnClearWhitelist.addEventListener('click', async () => {
            const confirmed = await showConfirm(t('repo.whitelistTitle') || "WHITELIST", t('repo.confirmClearWhitelist') || "Voulez-vous vraiment vider la whitelist ?");
            if (!confirmed) return;
            try {
                await invoke('clear_whitelist');
                toast(t('repo.whitelistClearSuccess') || "Whitelist vidée.", 'success');
                loadWhitelist();
            } catch(e) { toast(String(e), 'error'); }
        });
    }

    if (btnOpenWhitelist) {
        btnOpenWhitelist.addEventListener('click', () => {
            modalWhitelist.classList.add('open');
            loadWhitelist();
        });
    }

    // Modal close handle for Whitelist
    document.querySelectorAll('[data-close="modal-whitelist"]').forEach(btn => {
        btn.onclick = () => {
            modalWhitelist.classList.remove('open');
        };
    });
    modalWhitelist?.addEventListener('click', (e) => {
        if (e.target === modalWhitelist) modalWhitelist.classList.remove('open');
    });

    // Show server tools if already running
    if (isServerRunning && serverTools) {
        serverTools.style.display = 'flex';
    }
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
