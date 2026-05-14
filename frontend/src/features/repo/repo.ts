// @ts-nocheck
import { invoke, pickFolder } from '../../core/api.js';
import { toast, updateLibraryProfileSelector } from '../../ui/app.js';
import { escHtml, escAttr, formatBytes } from '../../core/utils.js';
import { renderProfiles } from '../profiles/profiles.js';
import { t } from '../../core/i18n.js';

// Sub-modules
import { initRepoServer } from './repo-server.js';
import { initRepoMonitoring } from './repo-monitoring.js';
import { initRepoSync, showSyncSummary } from './repo-sync.js';
import { initRepoAdmin } from './repo-admin.js';
import { initModpackCreator } from '../mods/modpack-creator.js';

export const copyToClipboard = async (text, successMsg) => {
    try {
        await navigator.clipboard.writeText(text);
        toast(successMsg || t('repo.urlCopied'), "success");
    } catch (err) {
        toast(t('repo.urlCopyError') || "Copy error", "error");
    }
};

export const showConfirm = (title, message, isDanger = true) => {
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

// --- Profile Checklist (exportable function) ---
export const loadProfilesForExport = async (profilesListEl) => {
    if (!profilesListEl) return;
    try {
        // Store currently checked profile IDs before refresh
        const currentlyChecked = new Set();
        profilesListEl.querySelectorAll('.repo-profile-cb:checked').forEach(cb => {
            currentlyChecked.add(cb.value);
        });

        const profiles = await invoke('get_profiles');
        profilesListEl.innerHTML = '';
        if (!profiles || profiles.length === 0) {
            profilesListEl.innerHTML = `<div style="color:var(--text-muted); font-size:12px; text-align:center;">${t('repo.noProfiles')}</div>`;
            return;
        }
        profiles.forEach(p => {
            const item = document.createElement('div');
            item.className = 'repo-profile-item';
            item.style.cssText = 'display:flex; align-items:center; padding:10px 12px; margin-bottom:6px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); border-radius:8px; cursor:pointer; transition:all 0.2s ease;';
            item.onmouseenter = () => { item.style.background = 'rgba(255,255,255,0.06)'; item.style.borderColor = 'rgba(255,255,255,0.1)'; };
            item.onmouseleave = () => { item.style.background = 'rgba(255,255,255,0.03)'; item.style.borderColor = 'rgba(255,255,255,0.05)'; };

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = p.id;
            cb.className = 'repo-profile-cb';
            // Check if profile was previously checked or if it's the active profile
            cb.checked = currentlyChecked.has(p.id) || (window.activeProfileId === p.id);
            item.onclick = (e) => { if (e.target !== cb) cb.checked = !cb.checked; };

            const info = document.createElement('div');
            info.style.cssText = 'margin-left:12px; display:flex; flex-direction:column;';
            info.innerHTML = `<span style="font-size:13.5px; font-weight:600; color:var(--text-color);">${escHtml(p.name)}</span>
                <span style="font-size:11px; color:var(--text-muted); margin-top:2px;">${escHtml(t(p.game_name) || p.game_name || t('repo.genericGame'))}</span>`;
            
            item.appendChild(cb);
            item.appendChild(info);
            profilesListEl.appendChild(item);
        });
    } catch (err) {
        console.error("Failed to load profiles for export:", err);
    }
};

// --- Modpack Checklist (exportable function) ---
export const loadModpacksForExport = async (modpacksListEl) => {
    if (!modpacksListEl) return;
    try {
        const modpacks = await invoke('load_modpacks');
        modpacksListEl.innerHTML = '';
        if (!modpacks || modpacks.length === 0) {
            modpacksListEl.innerHTML = `<div style="color:var(--text-muted); font-size:12px; text-align:center; padding: 10px;">${t('modpack.noMods') || 'No modpack available'}</div>`;
            return;
        }
        modpacks.forEach(pack => {
            const item = document.createElement('div');
            item.className = 'repo-modpack-item';
            item.style.cssText = 'display:flex; flex-direction:column; padding:10px; margin-bottom:8px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); border-radius:8px;';

            const topRow = document.createElement('div');
            topRow.style.cssText = 'display:flex; align-items:center; gap:10px; margin-bottom:8px;';

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = pack.id;
            cb.className = 'repo-modpack-cb';
            cb.dataset.pack = JSON.stringify(pack);

            const name = document.createElement('span');
            name.style.cssText = 'font-size:13px; font-weight:600; color:var(--text-color); flex:1;';
            name.textContent = pack.name;

            topRow.appendChild(cb);
            topRow.appendChild(name);
            item.appendChild(topRow);

            const settingsRow = document.createElement('div');
            settingsRow.style.cssText = 'display:flex; align-items:center; gap:8px; padding-left:26px;';
            settingsRow.innerHTML = `
                <select class="repo-modpack-share-mode input-field" style="font-size:11px; padding:4px; flex:1; background: rgba(0,0,0,0.3);">
                    <option value="public">${t('modpack.sharePublic') || 'Public'}</option>
                    <option value="whitelist_repo">${t('modpack.shareWhitelistRepo') || 'Whitelist Serveur'}</option>
                    <option value="whitelist_custom">${t('modpack.shareWhitelistCustom') || 'Whitelist Dédiée'}</option>
                </select>
            `;
            
            const customWhitelistInput = document.createElement('input');
            customWhitelistInput.type = 'text';
            customWhitelistInput.className = 'input-field repo-modpack-custom-whitelist';
            customWhitelistInput.placeholder = 'IDs (sép. par virgule)';
            customWhitelistInput.style.cssText = 'font-size:11px; padding:4px; flex:1; display:none; background: rgba(0,0,0,0.3);';
            
            const shareModeSelect = settingsRow.querySelector('.repo-modpack-share-mode');
            shareModeSelect.addEventListener('change', () => {
                customWhitelistInput.style.display = shareModeSelect.value === 'whitelist_custom' ? 'block' : 'none';
            });

            settingsRow.appendChild(customWhitelistInput);
            item.appendChild(settingsRow);
            modpacksListEl.appendChild(item);
        });
    } catch (err) {
        console.error("Failed to load modpacks for export:", err);
    }
};

export function initRepo() {
    const elements = {
        // --- Export elements ---
        btnPickExport: document.getElementById('btn-pick-repo-export'),
        inputExportPath: document.getElementById('repo-export-path'),
        btnStartExport: document.getElementById('btn-start-repo-export'),
        exportProgressContainer: document.getElementById('repo-export-progress-container'),
        exportStatus: document.getElementById('repo-export-status'),
        exportPercent: document.getElementById('repo-export-percent'),
        exportFill: document.getElementById('repo-export-progress-fill'),
        inputExportSeed: document.getElementById('repo-export-seed'),
        inputExportAuthor: document.getElementById('repo-export-author-name'),
        btnCancelExport: document.getElementById('btn-cancel-repo-export'),

        // --- Sync elements ---
        inputSyncUrl: document.getElementById('repo-sync-url'),
        inputSyncGamePath: document.getElementById('repo-sync-game-path'),
        inputSyncModsPath: document.getElementById('repo-sync-mods-path'),
        inputSyncBackupPath: document.getElementById('repo-sync-backup-path'),
        btnPickSyncGame: document.getElementById('btn-pick-sync-game'),
        btnPickSyncMods: document.getElementById('btn-pick-sync-mods'),
        btnPickSyncBackup: document.getElementById('btn-pick-sync-backup'),
        btnStartSync: document.getElementById('btn-start-repo-sync'),
        syncProgressContainer: document.getElementById('repo-sync-progress-container'),
        syncStatus: document.getElementById('repo-sync-status'),
        syncPercent: document.getElementById('repo-sync-percent'),
        syncFill: document.getElementById('repo-sync-progress-fill'),
        syncDetails: document.getElementById('repo-sync-details'),
        btnPauseSync: document.getElementById('btn-pause-sync'),
        btnCancelSync: document.getElementById('btn-cancel-sync'),
        pauseText: document.getElementById('repo-sync-pause-text'),
        pausedBadge: document.getElementById('repo-sync-paused-badge'),
        inputSyncDownloadLimit: document.getElementById('repo-sync-download-limit'),
        btnFetchInfo: document.getElementById('btn-fetch-repo-info'),
        syncInfoCard: document.getElementById('repo-sync-info-card'),
        syncBadge: document.getElementById('repo-sync-author-badge'),
        syncGameBadge: document.getElementById('repo-sync-game-badge'),
        syncNameDisplay: document.getElementById('repo-sync-name-display'),
        syncAuthorDisplay: document.getElementById('repo-sync-author-display'),
        syncDescDisplay: document.getElementById('repo-sync-desc-display'),
        btnClearFetchedRepo: document.getElementById('btn-clear-fetched-repo'),
        profilesSelectionEl: document.getElementById('repo-sync-profiles-selection'),
        syncTotalSizeEl: document.getElementById('repo-sync-total-size'),
        syncUrlCard: document.getElementById('repo-sync-url-card'),
        syncPathsSection: document.getElementById('repo-sync-paths-section'),

        // --- Host Server elements ---
        profilesListEl: document.getElementById('repo-export-profiles-list'),
        modpacksListEl: document.getElementById('repo-export-modpacks-list'),
        btnRefreshProfiles: document.getElementById('btn-refresh-repo-profiles'),
        btnToggleServer: document.getElementById('btn-toggle-repo-server'),
        urlContainerServer: document.getElementById('repo-server-url-container'),
        urlInputServer: document.getElementById('repo-server-url'),
        btnCopyUrlServer: document.getElementById('btn-copy-repo-url'),
        serverStatusDot: document.getElementById('repo-server-status-dot'),
        serverStatusLabel: document.getElementById('repo-server-status-label'),
        publicSection: document.getElementById('repo-server-public-section'),
        publicUrlInput: document.getElementById('repo-server-public-url'),
        btnCopyPublicUrl: document.getElementById('btn-copy-repo-public-url'),
        upnpBadgeStatus: document.getElementById('upnp-status-badge'),
        publicHintBox: document.getElementById('public-ip-hint-box'),
        repoCreatorIdContainer: document.getElementById('repo-creator-id-container'),
        repoCreatorIdValue: document.getElementById('repo-creator-id-value'),
        tunnelSection: document.getElementById('repo-server-tunnel-section'),
        tunnelUrlInput: document.getElementById('repo-server-tunnel-url'),
        btnCopyTunnelUrl: document.getElementById('btn-copy-repo-tunnel-url'),
        inputServerPort: document.getElementById('repo-server-port'),
        inputServerUploadLimit: document.getElementById('repo-server-upload-limit'),
        serverTools: document.getElementById('repo-server-tools'),
        inputMiniServerUploadLimit: document.getElementById('repo-mini-server-upload-limit'),

        // --- Advanced ---
        advancedToggle: document.getElementById('repo-server-advanced-toggle'),
        advancedContent: document.getElementById('repo-server-advanced-content'),
        advancedCaret: document.getElementById('repo-advanced-caret'),
        inputCloudflaredPath: document.getElementById('settings-cloudflared-path'),
        btnPickCloudflared: document.getElementById('btn-pick-cloudflared'),

        // --- Monitoring, Bans, Whitelist ---
        btnOpenMonitoring: document.getElementById('btn-open-monitoring'),
        modalMonitoring: document.getElementById('modal-monitoring'),
        monitoringListBody: document.getElementById('monitoring-list-body'),
        monitoringEmptyHint: document.getElementById('monitoring-empty-hint'),
        btnOpenBans: document.getElementById('btn-open-bans'),
        modalBans: document.getElementById('modal-bans'),
        banListContainer: document.getElementById('ban-list-container'),
        inputBanSearch: document.getElementById('ban-search'),
        selectBanFilter: document.getElementById('ban-filter-type'),
        btnUnbanAll: document.getElementById('btn-unban-all'),
        btnExportBans: document.getElementById('btn-export-bans'),
        btnAddManualBan: document.getElementById('btn-add-manual-ban'),
        manualBanIp: document.getElementById('manual-ban-ip'),
        manualBanKey: document.getElementById('manual-ban-key'),
        btnOpenWhitelist: document.getElementById('btn-open-whitelist'),
        modalWhitelist: document.getElementById('modal-whitelist'),
        whitelistListContainer: document.getElementById('whitelist-list-container'),
        whitelistToggle: document.getElementById('whitelist-toggle'),
        whitelistSearch: document.getElementById('whitelist-search'),
        btnClearWhitelist: document.getElementById('btn-clear-whitelist'),
        btnAddManualWhitelist: document.getElementById('btn-add-manual-whitelist'),
        manualWhitelistIp: document.getElementById('manual-whitelist-ip'),
        manualWhitelistKey: document.getElementById('manual-whitelist-key'),

        // --- Mini-Server ---
        btnGenMiniServer: document.getElementById('btn-generate-mini-server'),
        btnPickMiniRepo: document.getElementById('btn-pick-mini-server-repo'),
        btnPickMiniFolder: document.getElementById('btn-pick-mini-folder'),
        inputMiniRepoPath: document.getElementById('repo-mini-server-json-path'),
        cbAutoStart: document.getElementById('repo-mini-server-autostart'),

        // --- Distribution ZIP ---
        cbZipEnable: document.getElementById('repo-export-zip-enable'),
        zipOptionsPanel: document.getElementById('repo-export-zip-options'),
        inputZipPort: document.getElementById('repo-export-server-port'),
        inputZipLimit: document.getElementById('repo-export-server-limit'),
        inputZipPass: document.getElementById('repo-export-server-pass'),
        selectZipVersion: document.getElementById('repo-export-server-version'),
        cbZipCloudflare: document.getElementById('repo-export-server-cloudflare'),
        cbZipUpnp: document.getElementById('repo-export-server-upnp'),
        btnToggleZipPass: document.getElementById('toggle-repo-export-pass'),

        // --- History & Previews ---
        hostHistorySelect: document.getElementById('repo-host-history-select'),
        hostHistoryContainer: document.getElementById('repo-host-history-container'),
        hostMetadataPreview: document.getElementById('repo-host-metadata-preview'),
        syncHistoryContainer: document.getElementById('repo-sync-history-container'),
        syncHistoryList: document.getElementById('repo-sync-history-list')
    };

    // Initialize Sub-Modules
    initRepoServer(elements);
    initRepoMonitoring(elements);
    initRepoSync(elements);
    initRepoAdmin(elements);

    // ── Load Settings ──
    const loadRepoSettings = async () => {
        try {
            const settings = await invoke('get_settings');
            if (elements.inputCloudflaredPath && settings.cloudflared_path) {
                elements.inputCloudflaredPath.value = settings.cloudflared_path;
            }
        } catch (e) {
            console.error("[BMM] Failed to load repo settings:", e);
        }
    };
    loadRepoSettings();

    // ── Advanced Toggle ──
    if (elements.advancedToggle) {
        elements.advancedToggle.addEventListener('click', () => {
            const isHidden = elements.advancedContent.style.display === 'none';
            elements.advancedContent.style.display = isHidden ? 'block' : 'none';
            if (elements.advancedCaret) {
                elements.advancedCaret.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
            }
        });
    }

    if (elements.btnPickCloudflared) {
        elements.btnPickCloudflared.addEventListener('click', async () => {
            const { pickFile } = await import('../../core/api.js');
            const path = await pickFile(['exe']);
            if (path) {
                elements.inputCloudflaredPath.value = path;
                try {
                    const settings = await invoke('get_settings');
                    settings.cloudflared_path = path;
                    await invoke('update_settings', { settings });
                    toast(t('repo.cloudflaredPathUpdated'), 'success');
                } catch (e) { toast(String(e), 'error'); }
            }
        });
    }

    // ── History Helpers ──
    window.saveClientHistory = (url) => {
        try {
            let urls = JSON.parse(localStorage.getItem('bmm_repo_history_client') || '[]');
            urls = urls.filter(u => u !== url);
            urls.unshift(url);
            if (urls.length > 10) urls.length = 10;
            localStorage.setItem('bmm_repo_history_client', JSON.stringify(urls));
            loadRepoHistories();
        } catch(e) {}
    };

    // ── Repo Browser ──
    const initRepoBrowser = () => {
        const btnBrowse = document.getElementById('btn-browse-repos');
        const modal = document.getElementById('modal-repo-browser');
        const loadingEl = document.getElementById('repo-browser-loading');
        const contentEl = document.getElementById('repo-browser-content');
        const errorEl = document.getElementById('repo-browser-error');
        const listEl = document.getElementById('repo-browser-list');
        const btnRetry = document.getElementById('btn-retry-repo-browser');
        const filterBtns = document.querySelectorAll('.repo-browser-filter');

        let currentFilter = 'all';
        let repoList = [];

        const REPO_LIST_URL = 'https://raw.githubusercontent.com/BetterDCS/Better_ModManager_ServerBrowse/main/repos.json';

        const fetchRepoList = async () => {
            loadingEl.style.display = 'block';
            contentEl.style.display = 'none';
            errorEl.style.display = 'none';

            try {
                const response = await fetch(REPO_LIST_URL);
                if (!response.ok) throw new Error('Failed to fetch');
                repoList = await response.json();
                renderRepoList();
                loadingEl.style.display = 'none';
                contentEl.style.display = 'block';
            } catch (err) {
                console.error('Failed to fetch repo list:', err);
                // Show empty state message instead of error
                loadingEl.style.display = 'none';
                contentEl.style.display = 'block';
                listEl.innerHTML = `
                    <div style="text-align:center; padding:40px; color:var(--text-muted);">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.5;">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="2" y1="12" x2="22" y2="12"></line>
                            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                        </svg>
                        <p style="margin-top:16px; font-size:13px;">No repositories available yet</p>
                        <p style="font-size:11px; opacity:0.7;">The repository list will be available soon</p>
                    </div>
                `;
            }
        };

        const renderRepoList = () => {
            const filtered = currentFilter === 'all' 
                ? repoList 
                : repoList.filter(r => r.category === currentFilter);

            listEl.innerHTML = filtered.map(repo => `
                <div class="repo-browser-item" style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:16px; cursor:pointer; transition:all 0.2s ease;" data-url="${escAttr(repo.url)}">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
                        <div style="flex:1;">
                            <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                                <span style="font-size:14px; font-weight:700; color:var(--text-primary);">${escHtml(repo.name)}</span>
                                <span class="repo-badge" style="font-size:9px; font-weight:800; padding:2px 8px; border-radius:4px; text-transform:uppercase; letter-spacing:0.5px; ${repo.category === 'official' ? 'background:rgba(16,185,129,0.15); color:#10b981;' : 'background:rgba(59,130,246,0.15); color:#3b82f6;'}">${escHtml(repo.category)}</span>
                            </div>
                            <p style="font-size:12px; color:var(--text-secondary); margin:0; line-height:1.5;">${escHtml(repo.description || '')}</p>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-end; margin-left:16px;">
                            <span style="font-size:10px; color:var(--text-muted);">${escHtml(repo.region || 'Unknown')}</span>
                            ${repo.tags && repo.tags.length > 0 ? `
                                <div style="display:flex; gap:4px; flex-wrap:wrap; justify-content:flex-end;">
                                    ${repo.tags.slice(0, 2).map(tag => `<span style="font-size:9px; padding:2px 6px; background:rgba(255,255,255,0.05); border-radius:3px; color:var(--text-muted);">${escHtml(tag)}</span>`).join('')}
                                    ${repo.tags.length > 2 ? `<span style="font-size:9px; color:var(--text-muted);">+${repo.tags.length - 2}</span>` : ''}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    <div style="display:flex; gap:16px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.05);">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2">
                                <rect x="2" y="3" width="20" height="14" rx="2"/>
                                <path d="M8 21h8M12 17v4"/>
                            </svg>
                            <span style="font-size:11px; color:var(--text-secondary);"><span style="color:var(--accent); font-weight:600;">${repo.mods_count || 0}</span> mods</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            <span style="font-size:11px; color:var(--text-secondary);">${formatBytes(repo.size || 0)}</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/>
                                <polyline points="12 6 12 12 16 14"/>
                            </svg>
                            <span style="font-size:11px; color:var(--text-muted);">${escHtml(repo.last_update || 'Unknown')}</span>
                        </div>
                        ${repo.ping ? `
                        <div style="display:flex; align-items:center; gap:6px;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${repo.ping < 100 ? '#10b981' : repo.ping < 200 ? '#f59e0b' : '#ef4444'}" stroke-width="2">
                                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                            </svg>
                            <span style="font-size:11px; color:${repo.ping < 100 ? '#10b981' : repo.ping < 200 ? '#f59e0b' : '#ef4444'}; font-weight:600;">${repo.ping}ms</span>
                        </div>
                        ` : ''}
                    </div>
                    ${repo.changelog_link ? `
                    <div style="margin-top:8px;">
                        <a href="${escAttr(repo.changelog_link)}" target="_blank" style="font-size:10px; color:var(--accent); text-decoration:none; display:flex; align-items:center; gap:4px;">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                                <line x1="16" y1="13" x2="8" y2="13"/>
                                <line x1="16" y1="17" x2="8" y2="17"/>
                                <polyline points="10 9 9 9 8 9"/>
                            </svg>
                            View Changelog
                        </a>
                    </div>
                    ` : ''}
                </div>
            `).join('');

            // Add click handlers
            listEl.querySelectorAll('.repo-browser-item').forEach(item => {
                item.addEventListener('click', () => {
                    const url = item.dataset.url;
                    if (elements.inputSyncUrl) {
                        elements.inputSyncUrl.value = url;
                    }
                    if (elements.btnFetchInfo) {
                        elements.btnFetchInfo.click();
                    }
                    modal.classList.remove('open');
                });

                item.addEventListener('mouseenter', () => {
                    item.style.background = 'rgba(255,255,255,0.06)';
                    item.style.borderColor = 'rgba(255,255,255,0.15)';
                });

                item.addEventListener('mouseleave', () => {
                    item.style.background = 'rgba(255,255,255,0.03)';
                    item.style.borderColor = 'rgba(255,255,255,0.08)';
                });
            });
        };

        if (btnBrowse) {
            btnBrowse.addEventListener('click', () => {
                modal.classList.add('open');
                fetchRepoList();
            });
        }

        if (btnRetry) {
            btnRetry.addEventListener('click', fetchRepoList);
        }

        filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                filterBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentFilter = btn.dataset.filter;
                renderRepoList();
            });
        });
    };
    initRepoBrowser();

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

    const loadRepoHistories = () => {
        try {
            const urls = JSON.parse(localStorage.getItem('bmm_repo_history_client') || '[]');
            if (elements.syncHistoryContainer && elements.syncHistoryList) {
                if (urls.length > 0) {
                    elements.syncHistoryContainer.style.display = 'block';
                    // Show only first 3 by default, with expand button
                    const displayUrls = urls.slice(0, 3);
                    const hasMore = urls.length > 3;
                    
                    elements.syncHistoryList.innerHTML = displayUrls.map((u, idx) => `
                        <div class="sync-history-item" style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:6px 10px; ${idx >= 3 ? 'display:none;' : ''}" data-index="${idx}">
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
                    `).join('') + (hasMore ? `
                        <button id="sync-history-expand" style="width:100%;padding:6px;font-size:10px;color:var(--text-muted);background:rgba(255,255,255,0.02);border:1px dashed rgba(255,255,255,0.1);border-radius:6px;cursor:pointer;margin-top:4px;">
                            Show ${urls.length - 3} more...
                        </button>
                    ` : '');
                    
                    elements.syncHistoryList.querySelectorAll('.sync-hist-connect').forEach(btn => {
                        btn.onclick = () => {
                            if (elements.inputSyncUrl) elements.inputSyncUrl.value = btn.dataset.url;
                            if (elements.btnFetchInfo) elements.btnFetchInfo.click();
                        };
                    });
                    
                    elements.syncHistoryList.querySelectorAll('.sync-hist-delete').forEach(btn => {
                        btn.onclick = () => {
                            let current = JSON.parse(localStorage.getItem('bmm_repo_history_client') || '[]');
                            current = current.filter(url => url !== btn.dataset.url);
                            localStorage.setItem('bmm_repo_history_client', JSON.stringify(current));
                            loadRepoHistories();
                        };
                    });

                    if (hasMore) {
                        const expandBtn = document.getElementById('sync-history-expand');
                        if (expandBtn) {
                            expandBtn.onclick = () => {
                                const allItems = elements.syncHistoryList.querySelectorAll('.sync-history-item');
                                allItems.forEach(item => item.style.display = 'flex');
                                expandBtn.style.display = 'none';
                            };
                        }
                    }
                } else {
                    elements.syncHistoryContainer.style.display = 'none';
                }
            }
        } catch(e) {}
        try {
            const paths = JSON.parse(localStorage.getItem('bmm_repo_history_host') || '[]');
            if (elements.hostHistorySelect) {
                if (paths.length > 0) {
                    if (elements.hostHistoryContainer) elements.hostHistoryContainer.style.display = 'block';
                    elements.hostHistorySelect.innerHTML = `<option value="">${t('repo.hostHistoryDefault')}</option>` +
                        paths.map(p => `<option value="${escAttr(p)}">${escHtml(p)}</option>`).join('');
                } else if (elements.hostHistoryContainer) {
                    elements.hostHistoryContainer.style.display = 'none';
                }
            }
        } catch(e) {}
    };
    loadRepoHistories();

    const previewHostRepo = async (path) => {
        if (!path) {
            if (elements.hostMetadataPreview) elements.hostMetadataPreview.style.display = 'none';
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
                if (elements.hostMetadataPreview) {
                    elements.hostMetadataPreview.style.display = 'block';
                    elements.hostMetadataPreview.innerHTML = `
                        <div style="color:var(--accent);font-weight:700;margin-bottom:4px;font-size:14px;">${escHtml(repo.name)}</div>
                        <div style="color:var(--text-secondary);margin-bottom:2px;">${t('repo.authorShort')} <span style="color:var(--text-primary)">${escHtml(repo.author || '-')}</span></div>
                        <div style="color:var(--text-secondary);margin-bottom:2px;">${t('repo.profilesCount').replace('{count}', pCount)} <span style="color:var(--text-primary)">${escHtml(pNames)}</span></div>
                        <div style="color:var(--cyan);margin-top:6px;font-family:var(--font-mono)">${t('repo.totalSizeLabel')} ${formatBytes(totalSize)}</div>
                    `;
                }
            }
        } catch (err) {
            if (elements.hostMetadataPreview) {
                elements.hostMetadataPreview.style.display = 'block';
                elements.hostMetadataPreview.innerHTML = `<div style="color:var(--danger);">${t('repo.readError')} (${err})</div>`;
            }
        }
    };

    if (elements.hostHistorySelect) {
        elements.hostHistorySelect.addEventListener('change', (e) => {
            previewHostRepo(e.target.value);
        });
    }

    // --- Profile Checklist ---
    loadProfilesForExport(elements.profilesListEl);
    loadModpacksForExport(elements.modpacksListEl);

    // Refresh button
    if (elements.btnRefreshProfiles) {
        elements.btnRefreshProfiles.addEventListener('click', () => {
            loadProfilesForExport(elements.profilesListEl);
            loadModpacksForExport(elements.modpacksListEl);
            toast(t('repo.profilesRefreshed') || 'Profiles list refreshed', 'success');
        });
    }

    // --- Pickers ---
    if (elements.btnPickExport) {
        elements.btnPickExport.addEventListener('click', async () => {
            const folder = await pickFolder();
            if (folder) {
                elements.inputExportPath.value = folder;
                try {
                    if (window.__TAURI__) {
                        const content = await window.__TAURI__.fs.readTextFile(folder + '/repo.json');
                        const repo = JSON.parse(content);
                        if (repo.seed && elements.inputExportSeed) {
                            elements.inputExportSeed.value = repo.seed;
                            toast(t('repo.seedDetected'), 'info');
                        }
                    }
                } catch (e) { if (elements.inputExportSeed) elements.inputExportSeed.value = ''; }
            }
        });
    }

    const btnPickRepoHost = document.getElementById('btn-pick-repo-host');
    if (btnPickRepoHost) btnPickRepoHost.onclick = async () => {
        const folder = await pickFolder();
        if (folder) previewHostRepo(folder);
    };

    if (elements.btnPickSyncGame) elements.btnPickSyncGame.onclick = async () => { const f = await pickFolder(); if (f) elements.inputSyncGamePath.value = f; };
    if (elements.btnPickSyncMods) elements.btnPickSyncMods.onclick = async () => { const f = await pickFolder(); if (f) elements.inputSyncModsPath.value = f; };
    if (elements.btnPickSyncBackup) elements.btnPickSyncBackup.onclick = async () => { const f = await pickFolder(); if (f) elements.inputSyncBackupPath.value = f; };

    // --- Creator ID ---
    const initCreatorId = async () => {
        try {
            const creatorId = await invoke('get_creator_id');
            if (elements.repoCreatorIdValue) elements.repoCreatorIdValue.textContent = creatorId;
            if (elements.repoCreatorIdContainer) elements.repoCreatorIdContainer.style.display = 'block';
        } catch (err) { console.error("Failed to load Creator ID:", err); }
    };
    initCreatorId();

    // --- Export process ---
    if (elements.btnStartExport) {
        elements.btnStartExport.addEventListener('click', async () => {
            const outPath = elements.inputExportPath.value.trim();
            const authorName = elements.inputExportAuthor ? elements.inputExportAuthor.value.trim() : "";
            if (!outPath) return toast(t('repo.errNoOutDir'), 'warning');
            if (!authorName) { toast(t('repo.errNoAuthor'), 'warning'); elements.inputExportAuthor?.focus(); return; }
            localStorage.setItem('bmm_last_author', authorName);

            const cbs = document.querySelectorAll('.repo-profile-cb:checked');
            const profileIds = Array.from(cbs).map(c => c.value);
            if (profileIds.length === 0) return toast(t('repo.errNoProfile'), 'warning');

            let unlisten;
            try {
                elements.btnStartExport.disabled = true;
                elements.exportProgressContainer.style.display = 'block';
                elements.exportStatus.textContent = t('repo.exporting');
                if (elements.btnCancelExport) { elements.btnCancelExport.style.display = 'flex'; elements.btnCancelExport.disabled = false; }

                if (window.__TAURI__) {
                    const { listen } = await import('https://unpkg.com/@tauri-apps/api@1/event.js');
                    unlisten = await listen('bmm://repo-export-progress', (event) => {
                        const { step, progress } = event.payload;
                        if (progress !== undefined) {
                            const pct = Math.round(progress);
                            const currentPct = parseInt(elements.exportPercent.textContent) || 0;
                            if (pct >= currentPct) {
                                elements.exportPercent.textContent = `${pct}%`;
                                elements.exportFill.style.width = `${pct}%`;
                            }
                        }
                        if (step) elements.exportStatus.textContent = t(step) || step;
                    });
                }

                const modpackCbs = document.querySelectorAll('.repo-modpack-cb:checked');
                const modpacksShareConfig = Array.from(modpackCbs).map(cb => {
                    const pack = JSON.parse(cb.dataset.pack);
                    const item = cb.closest('.repo-modpack-item');
                    const shareMode = item.querySelector('.repo-modpack-share-mode').value;
                    const customWhitelistStr = item.querySelector('.repo-modpack-custom-whitelist').value;
                    const customWhitelist = shareMode === 'whitelist_custom' ? 
                        customWhitelistStr.split(',').map(s => s.trim()).filter(s => s.length > 0) : null;
                    
                    return {
                        modpack: pack,
                        share_mode: shareMode,
                        custom_whitelist: customWhitelist
                    };
                });

                let serverOptions = null;
                if (elements.cbZipEnable && elements.cbZipEnable.checked) {
                    serverOptions = {
                        port: parseInt(elements.inputZipPort.value) || 8000,
                        upload_limit: parseInt(elements.inputZipLimit.value) || 0,
                        admin_password: elements.inputZipPass.value || "admin",
                        server_version: parseInt(elements.selectZipVersion.value) || 2,
                        use_cloudflare: elements.cbZipCloudflare.checked,
                        use_upnp: elements.cbZipUpnp.checked
                    };
                }

                await invoke('export_server_repo', { 
                    profileIds, 
                    outputDir: outPath, 
                    authorName,
                    seed: elements.inputExportSeed ? elements.inputExportSeed.value.trim() || null : null,
                    modpacksShareConfig: modpacksShareConfig.length > 0 ? modpacksShareConfig : null,
                    zipOutput: elements.cbZipEnable ? elements.cbZipEnable.checked : false,
                    serverOptions: serverOptions
                });
                saveHostHistory(outPath);
                elements.exportStatus.textContent = t('repo.exportDone');
                toast(t('repo.exportSuccess'), 'success');
            } catch (err) {
                const errMsg = String(err);
                const isCancel = errMsg.includes('cancel');
                elements.exportStatus.textContent = isCancel ? t('repo.cancelled') : t('repo.exportError');
                if (!isCancel) toast(errMsg, 'error');
            } finally {
                elements.btnStartExport.disabled = false;
                if (elements.btnCancelExport) elements.btnCancelExport.style.display = 'none';
                if (unlisten) unlisten();
                
                // Hide progress bar if it was a cancellation
                if (elements.exportStatus.textContent === t('repo.cancelled')) {
                    elements.exportProgressContainer.style.display = 'none';
                }
            }
        });
    }

    if (elements.btnCancelExport) {
        elements.btnCancelExport.onclick = async () => {
            try {
                elements.btnCancelExport.disabled = true;
                await invoke('cancel_repo_export');
                toast(t('repo.cancelExport'), 'info');
            } catch (e) {}
        };
    }

    const lastAuthor = localStorage.getItem('bmm_last_author');
    if (lastAuthor && elements.inputExportAuthor) elements.inputExportAuthor.value = lastAuthor;

    if (elements.cbZipEnable && elements.zipOptionsPanel) {
        elements.cbZipEnable.addEventListener('change', () => {
            elements.zipOptionsPanel.style.display = elements.cbZipEnable.checked ? 'block' : 'none';
        });
    }

    if (elements.btnToggleZipPass && elements.inputZipPass) {
        elements.btnToggleZipPass.addEventListener('click', () => {
            const isPass = elements.inputZipPass.type === 'password';
            elements.inputZipPass.type = isPass ? 'text' : 'password';
            elements.btnToggleZipPass.innerHTML = isPass 
                ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>'
                : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
        });
    }

    // --- Events ---
    window.addEventListener('bmm://modpacks-updated', () => {
        if (elements.modpacksListEl) {
            loadModpacksForExport(elements.modpacksListEl);
        }
    });
}
