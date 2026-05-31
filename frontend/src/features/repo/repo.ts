// @ts-nocheck
import { invoke, pickFolder } from '../../core/api.js';
import { toast, updateLibraryProfileSelector } from '../../ui/app.js';
import { escHtml, escAttr, formatBytes } from '../../core/utils.js';
import { getLinks } from '../../core/links-config.js';
import { renderProfiles } from '../profiles/profiles.js';
import { t } from '../../core/i18n.js';

// Sub-modules
import { initRepoServer } from './repo-server.js';
import { initRepoMonitoring } from './repo-monitoring.js';
import { initRepoSync, showSyncSummary } from './repo-sync.js';
import { initRepoAdmin } from './repo-admin.js';
import { initModpackCreator } from '../mods/modpack-creator.js';

// Normalise a repo URL so map lookups match regardless of trailing slash / repo.json
export const normRepoUrl = (url: string): string => {
    let u = (url || '').trim();
    u = u.replace(/\/repo\.json$/i, '').replace(/\/+$/, '');
    return u.toLowerCase();
};

// ── Repo favorites (localStorage) ─────────────────────────────────────────────
const REPO_FAV_KEY = 'bmm_repo_favorites';
export const getRepoFavorites = (): string[] => {
    try { return JSON.parse(localStorage.getItem(REPO_FAV_KEY) || '[]'); } catch { return []; }
};
export const isRepoFav = (url: string): boolean => getRepoFavorites().includes(url);
export const toggleRepoFav = (url: string): boolean => {
    let favs = getRepoFavorites();
    const has = favs.includes(url);
    favs = has ? favs.filter(u => u !== url) : [...favs, url];
    localStorage.setItem(REPO_FAV_KEY, JSON.stringify(favs));
    return !has; // new state
};

// Star button markup (shared between browse + history)
const repoStarBtn = (url: string) => {
    const fav = isRepoFav(url);
    return `<button class="repo-fav-btn${fav ? ' active' : ''}" data-fav-url="${escAttr(url)}" title="${fav ? (t('repo.unfavorite') || 'Unfavorite') : (t('repo.favorite') || 'Favorite')}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="${fav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
    </button>`;
};

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
        btnRepoHistory: document.getElementById('btn-repo-history'),

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
        statsContainer: document.getElementById('repo-server-stats-container'),
        statDls: document.getElementById('repo-server-stat-dls'),
        statBytes: document.getElementById('repo-server-stat-bytes'),

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
        whitelistToggleBtn: document.getElementById('whitelist-toggle-btn'),
        whitelistSearch: document.getElementById('whitelist-search'),
        btnClearWhitelist: document.getElementById('btn-clear-whitelist'),
        btnExportWhitelist: document.getElementById('btn-export-whitelist'),
        btnAddManualWhitelist: document.getElementById('btn-add-manual-whitelist'),
        manualWhitelistIp: document.getElementById('manual-whitelist-ip'),
        manualWhitelistKey: document.getElementById('manual-whitelist-key'),

        // --- Mini-Server ---
        btnGenMiniServer: document.getElementById('btn-generate-mini-server'),
        btnPickMiniRepo: document.getElementById('btn-pick-mini-server-repo'),
        btnPickMiniFolder: document.getElementById('btn-pick-mini-folder'),
        inputMiniRepoPath: document.getElementById('repo-mini-server-json-path'),
        cbAutoStart: document.getElementById('repo-mini-server-autostart'),
        cbDocker: document.getElementById('repo-mini-server-docker'),
        dockerOptions: document.getElementById('repo-mini-server-docker-options'),
        dockerHostSelect: document.getElementById('repo-mini-server-docker-host'),

        // --- Distribution ZIP ---
        cbZipEnable: document.getElementById('repo-export-zip-enable'),
        zipOptionsPanel: document.getElementById('repo-export-zip-options'),
        inputZipPort: document.getElementById('repo-export-server-port'),
        inputZipLimit: document.getElementById('repo-export-server-limit'),
        inputZipPass: document.getElementById('repo-export-server-pass'),
        selectZipVersion: document.getElementById('repo-export-server-version'),
        selectZipType: document.getElementById('repo-export-server-type'),
        cbZipCloudflare: document.getElementById('repo-export-server-cloudflare'),
        cbZipUpnp: document.getElementById('repo-export-server-upnp'),
        cbZipDocker: document.getElementById('repo-export-server-docker'),
        zipDockerOptions: document.getElementById('repo-export-server-docker-options'),
        zipDockerHostSelect: document.getElementById('repo-export-server-docker-host'),
        btnToggleZipPass: document.getElementById('toggle-repo-export-pass'),

        // --- History & Previews ---
        hostHistorySelect: document.getElementById('repo-host-history-select'),
        hostHistoryContainer: document.getElementById('repo-host-history-container'),
        hostMetadataPreview: document.getElementById('repo-host-metadata-preview')
    };

    // Initialize Sub-Modules
    initRepoServer(elements);
    initRepoMonitoring(elements);
    initRepoSync(elements);
    initRepoAdmin(elements);

    // ZIP Export Server Type Listener (lock cloudflare/upnp for "server")
    if (elements.selectZipType) {
        elements.selectZipType.addEventListener('change', (e: any) => {
            const isServer = e.target.value === 'server';
            if (isServer) {
                if (elements.cbZipCloudflare) { (elements.cbZipCloudflare as HTMLInputElement).checked = false; (elements.cbZipCloudflare as HTMLInputElement).disabled = true; }
                if (elements.cbZipUpnp) { (elements.cbZipUpnp as HTMLInputElement).checked = false; (elements.cbZipUpnp as HTMLInputElement).disabled = true; }
            } else {
                if (elements.cbZipCloudflare) (elements.cbZipCloudflare as HTMLInputElement).disabled = false;
                if (elements.cbZipUpnp) (elements.cbZipUpnp as HTMLInputElement).disabled = false;
            }
        });
        // Dispatch initial change event
        elements.selectZipType.dispatchEvent(new Event('change'));
    }

    // ── bmm:repo-focus — auto-launch + pre-fill from Quick Test ──
    document.addEventListener('bmm:repo-focus', (e: any) => {
        const section: string  = e.detail?.section ?? '';
        const prefill: any     = e.detail?.prefill ?? null;

        if (section === 'sync') {
            // ── Pre-fill sync form fields from QT data ──
            if (prefill) {
                if (prefill.url && elements.inputSyncUrl)
                    (elements.inputSyncUrl as HTMLInputElement).value = prefill.url;
                if (prefill.gameDir && elements.inputSyncGamePath)
                    (elements.inputSyncGamePath as HTMLInputElement).value = prefill.gameDir;
                if (prefill.modsDir && elements.inputSyncModsPath)
                    (elements.inputSyncModsPath as HTMLInputElement).value = prefill.modsDir;
                if (prefill.backupDir && elements.inputSyncBackupPath)
                    (elements.inputSyncBackupPath as HTMLInputElement).value = prefill.backupDir;
                if (typeof prefill.downloadLimit === 'number' && elements.inputSyncDownloadLimit)
                    (elements.inputSyncDownloadLimit as HTMLInputElement).value = String(prefill.downloadLimit);
            }

            // Scroll the sync URL card into view
            const target = elements.syncUrlCard ?? elements.inputSyncUrl;
            if (target) (target as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });

            // Auto-click Fetch to load remote repo profiles
            setTimeout(() => {
                if (elements.btnFetchInfo) (elements.btnFetchInfo as HTMLElement).click();
            }, 300);

            // If choices were specified, wait for Fetch to complete then auto-select profiles + auto-sync
            const wantedProfileIds: string[] = (prefill?.choices || [])
                .map((c: any) => c.repoProfileId)
                .filter(Boolean);
            if (wantedProfileIds.length > 0 && elements.profilesSelectionEl) {
                let attempts = 0;
                const pollId = setInterval(() => {
                    attempts++;
                    const cbs = (elements.profilesSelectionEl as HTMLElement).querySelectorAll<HTMLInputElement>('.repo-sync-choice-cb');
                    if (cbs.length > 0) {
                        clearInterval(pollId);
                        // Auto-select matching profiles
                        cbs.forEach(cb => {
                            if (wantedProfileIds.includes(cb.dataset.repoProfileId || '')) {
                                if (!cb.checked) cb.click();
                            }
                        });
                        // Auto-click Sync after profiles are selected
                        setTimeout(() => {
                            if (elements.btnStartSync) (elements.btnStartSync as HTMLElement).click();
                        }, 400);
                    }
                    if (attempts >= 20) clearInterval(pollId); // max 10s
                }, 500);
            }

        } else if (section === 'connect') {
            // Fill URL in sync form and auto-fetch the repo info
            if (prefill?.url && elements.inputSyncUrl)
                (elements.inputSyncUrl as HTMLInputElement).value = prefill.url;
            const connectTarget = elements.syncUrlCard ?? elements.inputSyncUrl;
            if (connectTarget) (connectTarget as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(() => {
                if (elements.btnFetchInfo) (elements.btnFetchInfo as HTMLElement).click();
            }, 300);

        } else if (section === 'disconnect') {
            // Clear the fetched repo state (equivalent to disconnecting from the UI)
            const disconnectTarget = elements.syncUrlCard ?? elements.inputSyncUrl;
            if (disconnectTarget) (disconnectTarget as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(() => {
                if (elements.btnClearFetchedRepo) (elements.btnClearFetchedRepo as HTMLElement).click();
            }, 300);

        } else if (section === 'host') {
            // Pre-fill host server settings and start the server
            if (prefill) {
                // repo-host-path is the directory the server serves from
                const hostPathInput = document.getElementById('repo-host-path') as HTMLInputElement | null;
                if (prefill.serveDir && hostPathInput)
                    hostPathInput.value = prefill.serveDir;
                if (prefill.port && elements.inputServerPort)
                    (elements.inputServerPort as HTMLInputElement).value = String(prefill.port);
                if (prefill.uploadLimit !== undefined && elements.inputServerUploadLimit)
                    (elements.inputServerUploadLimit as HTMLInputElement).value = String(prefill.uploadLimit);
            }
            // Scroll to the toggle server button
            if (elements.btnToggleServer) (elements.btnToggleServer as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => {
                if (elements.btnToggleServer) (elements.btnToggleServer as HTMLElement).click();
            }, 300);

        } else if (section === 'gen') {
            // Switch to export/gen tab if tab system is present
            const genTab = document.querySelector('[data-repo-tab="export"], [data-repo-tab="gen"]') as HTMLElement | null;
            if (genTab) genTab.click();

            // ── Pre-fill gen/export form fields from QT data ──
            if (prefill) {
                if (prefill.outputDir && elements.inputExportPath)
                    (elements.inputExportPath as HTMLInputElement).value = prefill.outputDir;
                if (prefill.authorName && elements.inputExportAuthor)
                    (elements.inputExportAuthor as HTMLInputElement).value = prefill.authorName;
                if (prefill.seed && elements.inputExportSeed)
                    (elements.inputExportSeed as HTMLInputElement).value = prefill.seed;

                // ── Select profiles matching prefill.profileIds ──
                if (Array.isArray(prefill.profileIds) && prefill.profileIds.length > 0) {
                    // Wait a tick for the profile list to be rendered
                    requestAnimationFrame(() => {
                        const allCbs = document.querySelectorAll<HTMLInputElement>('.repo-profile-cb');
                        allCbs.forEach(cb => {
                            cb.checked = prefill.profileIds.includes(cb.value);
                        });
                    });
                }

                // ── Zip output — only check the ZIP checkbox if zipOutput is explicitly true ──
                // generateServer alone (standalone .bat) does NOT produce a zip — it fills the mini server section
                if (prefill.zipOutput && elements.cbZipEnable) {
                    (elements.cbZipEnable as HTMLInputElement).checked = true;
                    elements.cbZipEnable.dispatchEvent(new Event('change', { bubbles: true }));
                }

                // ── Server distribution options (only apply when zip output is active) ──
                if (prefill.zipOutput) {
                    requestAnimationFrame(() => {
                        // Port
                        if (prefill.port && elements.inputZipPort)
                            (elements.inputZipPort as HTMLInputElement).value = String(prefill.port);
                        // Upload limit
                        if (prefill.uploadLimit !== undefined && elements.inputZipLimit)
                            (elements.inputZipLimit as HTMLInputElement).value = String(prefill.uploadLimit);
                        // Admin password
                        if (prefill.adminPassword && elements.inputZipPass)
                            (elements.inputZipPass as HTMLInputElement).value = prefill.adminPassword;
                        // Cloudflare tunnel
                        if (prefill.useCloudflare && elements.cbZipCloudflare)
                            (elements.cbZipCloudflare as HTMLInputElement).checked = true;
                        // UPnP
                        if (prefill.useUpnp && elements.cbZipUpnp)
                            (elements.cbZipUpnp as HTMLInputElement).checked = true;
                        // Docker
                        if (prefill.useDocker && elements.cbZipDocker) {
                            (elements.cbZipDocker as HTMLInputElement).checked = true;
                            // Trigger docker toggle to show sub-options
                            elements.cbZipDocker.dispatchEvent(new Event('change', { bubbles: true }));
                            // Docker OS
                            if (prefill.dockerOs && elements.zipDockerHostSelect)
                                (elements.zipDockerHostSelect as HTMLSelectElement).value = prefill.dockerOs;
                        }
                        // Server version: std/standard → '1' (Hybrid), lux/premium → '2' (V2 Luxe)
                        if (prefill.serverVersion && elements.selectZipVersion) {
                            const vmap: Record<string, string> = { std: '1', lux: '2', standard: '1', premium: '2' };
                            const v = vmap[prefill.serverVersion] ?? prefill.serverVersion;
                            (elements.selectZipVersion as HTMLSelectElement).value = v;
                        }
                        if (prefill.serverType && elements.selectZipType) {
                            (elements.selectZipType as HTMLSelectElement).value = prefill.serverType;
                            elements.selectZipType.dispatchEvent(new Event('change'));
                        }
                    });
                }
            }

            // Scroll the export path input or start button into view
            const target = elements.btnStartExport ?? elements.inputExportPath;
            if (target) (target as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });

            // Auto-click the Start Export / Gen button
            setTimeout(() => {
                if (elements.btnStartExport) (elements.btnStartExport as HTMLElement).click();
            }, 300);

            // ── If standalone server (generateServer without zipOutput), pre-fill the mini server section ──
            // The mini server section is always visible — pre-fill it so after gen the user just clicks "Generate Server"
            if (prefill?.generateServer && !prefill?.zipOutput && prefill?.outputDir) {
                const miniRepoPath = elements.inputMiniRepoPath as HTMLInputElement | null;
                if (miniRepoPath) miniRepoPath.value = prefill.outputDir;

                const miniPort = document.getElementById('repo-mini-server-port') as HTMLInputElement | null;
                if (miniPort && prefill.port) miniPort.value = String(prefill.port);

                const miniLimit = document.getElementById('repo-mini-server-upload-limit') as HTMLInputElement | null;
                if (miniLimit && prefill.uploadLimit !== undefined) miniLimit.value = String(prefill.uploadLimit);

                const miniPass = document.getElementById('repo-mini-server-password') as HTMLInputElement | null;
                if (miniPass && prefill.adminPassword) miniPass.value = prefill.adminPassword;

                // Version: std→'1', lux→'2'
                const miniVer = document.getElementById('repo-mini-server-version') as HTMLSelectElement | null;
                if (miniVer && prefill.serverVersion) {
                    const vmap2: Record<string, string> = { std: '1', lux: '2', standard: '1', premium: '2' };
                    miniVer.value = vmap2[prefill.serverVersion] ?? prefill.serverVersion;
                }

                const miniCf = document.getElementById('repo-mini-server-cloudflare') as HTMLInputElement | null;
                if (miniCf && prefill.useCloudflare != null) miniCf.checked = !!prefill.useCloudflare;

                const miniUpnp = document.getElementById('repo-mini-server-upnp') as HTMLInputElement | null;
                if (miniUpnp && prefill.useUpnp != null) miniUpnp.checked = !!prefill.useUpnp;

                const miniAutoStart = elements.cbAutoStart as HTMLInputElement | null;
                if (miniAutoStart && prefill.autoStart != null) miniAutoStart.checked = !!prefill.autoStart;

                if (prefill.useDocker && elements.cbDocker) {
                    (elements.cbDocker as HTMLInputElement).checked = true;
                    elements.cbDocker.dispatchEvent(new Event('change', { bubbles: true }));
                    if (prefill.dockerOs && elements.dockerHostSelect)
                        (elements.dockerHostSelect as HTMLSelectElement).value = prefill.dockerOs;
                }

                // Scroll to mini server section after gen starts (give it a moment)
                setTimeout(() => {
                    const miniSection = document.getElementById('repo-mini-server-json-path');
                    if (miniSection) miniSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 1500);
            }
        }
    });

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
    window.saveClientHistory = (url, repoInfo = null) => {
        try {
            let history = JSON.parse(localStorage.getItem('bmm_repo_history_client') || '[]');
            history = history.filter(h => h.url !== url);
            const entry = {
                url: url,
                date: new Date().toISOString(),
                name: repoInfo?.name || '',
                author: repoInfo?.author || '',
                game: repoInfo?.game_name || '',
                description: repoInfo?.description || '',
                category: repoInfo?.category || 'private'
            };
            history.unshift(entry);
            if (history.length > 20) history.length = 20;
            localStorage.setItem('bmm_repo_history_client', JSON.stringify(history));
        } catch(e) {}
    };

    // ── Repo History Modal ──
    const initRepoHistory = () => {
        const btnHistory = document.getElementById('btn-repo-history');
        const modal = document.getElementById('modal-repo-history');
        const historyList = document.getElementById('repo-history-list');
        const emptyState = document.getElementById('repo-history-empty');
        const btnClear = document.getElementById('btn-clear-repo-history');

        const checkRepo = async (url) => {
            const start = performance.now();
            try {
                const target = url.trim().endsWith('repo.json') ? url.trim() : (url.trim().endsWith('/') ? url.trim() + 'repo.json' : url.trim() + '/repo.json');
                let finalUrl = target;
                if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
                    finalUrl = 'https://' + finalUrl;
                }
                
                let rawInvoke;
                if (window.__TAURI__) {
                    rawInvoke = window.__TAURI__.invoke;
                } else {
                    const tauriApi = await import('https://unpkg.com/@tauri-apps/api@1/tauri.js');
                    rawInvoke = tauriApi.invoke;
                }
                await rawInvoke('fetch_repo_info', { url: finalUrl });
                return Math.round(performance.now() - start);
            } catch(e) {}
            return -1;
        };

        const renderHistory = () => {
            try {
                const history = JSON.parse(localStorage.getItem('bmm_repo_history_client') || '[]');
                if (history.length === 0) {
                    historyList.style.display = 'none';
                    emptyState.style.display = 'block';
                    return;
                }
                historyList.style.display = 'flex';
                emptyState.style.display = 'none';

                historyList.innerHTML = history.map((entry, idx) => {
                    const date = new Date(entry.date);
                    const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                    const categoryColor = entry.category === 'official' ? '#2ecc71' : entry.category === 'partner' ? '#bc74ff' : '#fb923c';
                    const categoryLabel = entry.category === 'official' ? 'Official' : entry.category === 'partner' ? 'Partner' : 'Private';

                    return `
                        <div class="repo-history-item" style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:12px; display:flex; gap:12px; align-items:flex-start;">
                            <div style="width:40px; height:40px; display:flex; align-items:center; justify-content:center; background:rgba(251,146,60,0.1); border-radius:6px; flex-shrink:0;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fb923c" stroke-width="2">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <polyline points="12 6 12 12 16 14"></polyline>
                                </svg>
                            </div>
                            <div style="flex:1; min-width:0;">
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                                    <span style="font-size:13px; font-weight:600; color:var(--text-primary);">${escHtml(entry.name || 'Unknown')}</span>
                                    <div style="display:flex; align-items:center; gap:8px;">
                                        ${repoStarBtn(entry.url)}
                                        <div style="display:flex; align-items:center; gap:4px;" class="repo-history-ping-container" data-url="${escAttr(entry.url)}">
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" class="repo-history-ping-icon">
                                                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                                            </svg>
                                            <span style="font-size:10px; color:var(--text-muted); font-weight:600;" class="repo-history-ping-text">Pinging...</span>
                                        </div>
                                        <span style="font-size:10px; color:var(--text-muted);">${dateStr}</span>
                                    </div>
                                </div>
                                <div style="display:flex; gap:8px; align-items:center; margin-bottom:6px;">
                                    <span style="font-size:10px; padding:2px 8px; background:${categoryColor}20; color:${categoryColor}; border-radius:100px; font-weight:600;">${categoryLabel}</span>
                                    ${entry.game ? `
                                        <span style="font-size:10px; color:var(--text-muted); display:flex; align-items:center; gap:4px; background:rgba(255,255,255,0.05); padding:2px 8px; border-radius:100px;">
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.7;">
                                                <rect x="2" y="3" width="20" height="14" rx="2"/>
                                                <path d="M8 21h8M12 17v4"/>
                                            </svg>
                                            ${escHtml(entry.game)}
                                        </span>
                                    ` : ''}
                                </div>
                                ${entry.author ? `
                                    <div style="font-size:11px; color:var(--text-secondary); margin-bottom:4px; display:flex; align-items:center; gap:6px; background:rgba(255,255,255,0.05); padding:2px 8px; border-radius:100px; width:fit-content;">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.7;">
                                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                            <circle cx="12" cy="7" r="4"/>
                                        </svg>
                                        ${escHtml(entry.author)}
                                    </div>
                                ` : ''}
                                ${entry.description ? `<div style="font-size:11px; color:var(--text-muted); line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${escHtml(entry.description)}</div>` : ''}
                                <div style="margin-top:8px; display:flex; gap:8px;">
                                    <button class="btn-history-connect" data-url="${escAttr(entry.url)}" style="font-size:11px; padding:4px 12px; background:rgba(59,130,246,0.15); color:var(--accent); border:1px solid rgba(59,130,246,0.3); border-radius:4px; cursor:pointer;">${t('repo.historyConnect')}</button>
                                    <button class="btn-history-delete" data-idx="${idx}" style="font-size:11px; padding:4px 8px; background:rgba(239,68,68,0.1); color:#ef4444; border:1px solid rgba(239,68,68,0.2); border-radius:4px; cursor:pointer;">${t('repo.historyDelete')}</button>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');

                historyList.querySelectorAll('.btn-history-connect').forEach(btn => {
                    btn.onclick = () => {
                        if (elements.inputSyncUrl) elements.inputSyncUrl.value = btn.dataset.url;
                        if (elements.btnFetchInfo) elements.btnFetchInfo.click();
                        modal.classList.remove('open');
                    };
                });

                historyList.querySelectorAll('.btn-history-delete').forEach(btn => {
                    btn.onclick = () => {
                        const idx = parseInt(btn.dataset.idx);
                        let history = JSON.parse(localStorage.getItem('bmm_repo_history_client') || '[]');
                        history.splice(idx, 1);
                        localStorage.setItem('bmm_repo_history_client', JSON.stringify(history));
                        renderHistory();
                    };
                });

                // Favorite star handlers
                historyList.querySelectorAll('.repo-fav-btn').forEach(btn => {
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        const nowFav = toggleRepoFav(btn.dataset.favUrl);
                        btn.classList.toggle('active', nowFav);
                        const svg = btn.querySelector('svg');
                        if (svg) svg.setAttribute('fill', nowFav ? 'currentColor' : 'none');
                    };
                });

                // Ping history repos
                const updateHistoryPings = async () => {
                    const pingContainers = historyList.querySelectorAll('.repo-history-ping-container');
                    for (const container of pingContainers) {
                        const url = container.dataset.url;
                        if (!url) continue;
                        
                        const ping = await checkRepo(url);
                        const icon = container.querySelector('.repo-history-ping-icon');
                        const text = container.querySelector('.repo-history-ping-text');
                        
                        if (ping >= 0) {
                            const color = ping < 100 ? '#10b981' : ping < 250 ? '#f59e0b' : '#ef4444';
                            icon.setAttribute('stroke', color);
                            text.style.color = color;
                            text.textContent = ping + 'ms';
                        } else {
                            icon.setAttribute('stroke', '#ef4444');
                            text.style.color = '#ef4444';
                            text.textContent = 'Offline';
                        }
                    }
                };
                updateHistoryPings();

                // Add click handler for manual ping refresh
                historyList.querySelectorAll('.repo-history-ping-container').forEach(container => {
                    container.style.cursor = 'pointer';
                    container.onclick = async () => {
                        const url = container.dataset.url;
                        if (!url) return;
                        
                        const icon = container.querySelector('.repo-history-ping-icon');
                        const text = container.querySelector('.repo-history-ping-text');
                        
                        text.textContent = 'Pinging...';
                        icon.setAttribute('stroke', 'var(--text-muted)');
                        text.style.color = 'var(--text-muted)';
                        
                        const ping = await checkRepo(url);
                        
                        if (ping >= 0) {
                            const color = ping < 100 ? '#10b981' : ping < 250 ? '#f59e0b' : '#ef4444';
                            icon.setAttribute('stroke', color);
                            text.style.color = color;
                            text.textContent = ping + 'ms';
                        } else {
                            icon.setAttribute('stroke', '#ef4444');
                            text.style.color = '#ef4444';
                            text.textContent = 'Offline';
                        }
                    };
                });
            } catch(e) {
                console.error('Error loading repo history:', e);
            }
        };

        if (btnHistory) {
            btnHistory.onclick = () => {
                renderHistory();
                modal.classList.add('open');
            };
        }

        const btnClearAll = document.getElementById('btn-clear-all-repo-history');

        // "Clear" → removes only non-favorited entries (keeps favorites)
        if (btnClear) {
            btnClear.onclick = async () => {
                const ok = await showConfirm(
                    t('repo.historyClearTitle') || 'Clear history',
                    t('repo.historyClearMsg') || 'Remove all non-favorited history entries? Favorited repos are kept.',
                    true
                );
                if (!ok) return; // only delete AFTER confirmation
                const history = JSON.parse(localStorage.getItem('bmm_repo_history_client') || '[]');
                const kept = history.filter(h => isRepoFav(h.url));
                localStorage.setItem('bmm_repo_history_client', JSON.stringify(kept));
                renderHistory();
            };
        }

        // "Clear All" → removes everything, including favorited entries
        if (btnClearAll) {
            btnClearAll.onclick = async () => {
                const ok = await showConfirm(
                    t('repo.historyClearAllTitle') || 'Clear everything',
                    t('repo.historyClearAllMsg') || 'Remove ALL history entries, including favorited repos? This cannot be undone.',
                    true
                );
                if (!ok) return;
                localStorage.removeItem('bmm_repo_history_client');
                renderHistory();
            };
        }
    };
    initRepoHistory();

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
        const searchInput = document.getElementById('repo-browser-search');
        const regionFilter = document.getElementById('repo-browser-region-filter');
        const onlineFilter = document.getElementById('repo-browser-online-filter');
        const whitelistFilterEl = document.getElementById('repo-browser-whitelist-filter');

        let currentFilter = 'all';
        let whitelistFilter = 'all'; // 'all' | 'whitelist' | 'no-whitelist'
        let repoList = [];
        let repoPingData = new Map();

        const fetchRepoList = async () => {
            loadingEl.style.display = 'block';
            contentEl.style.display = 'none';
            errorEl.style.display = 'none';

            try {
                // Bypass browser and GitHub caching to get the absolute latest list
                const bustUrl = `${getLinks().server_browse}?t=${Date.now()}`;
                const response = await fetch(bustUrl, { cache: 'no-store' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                repoList = await response.json();
                // Build a url → expected-signature map (recorded by the BMM team when
                // validating the repo). repo-sync compares the live repo's signature
                // against this to detect content changed since verification.
                (window as any).__bmmRepoExpectedSig = {};
                repoList.forEach(r => {
                    if (r.url && r.signature) (window as any).__bmmRepoExpectedSig[normRepoUrl(r.url)] = r.signature;
                });
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
            const searchTerm = searchInput?.value?.toLowerCase() || '';
            const regionValue = regionFilter?.value || 'all';
            const onlineOnly = onlineFilter?.checked || false;
            whitelistFilter = whitelistFilterEl?.value || 'all';

            let filtered = repoList;

            // Only show repos validated by the BMM team (hash field present and non-empty).
            // This is intentional — unvalidated entries in repos.json stay hidden until
            // the team adds a hash. The Verified badge is then shown for those entries.
            filtered = filtered.filter(r => r.hash && r.hash.length > 0);

            // Filter by category
            if (currentFilter !== 'all') {
                filtered = filtered.filter(r => r.category === currentFilter);
            }

            // Filter by search term
            if (searchTerm) {
                filtered = filtered.filter(r =>
                    r.name?.toLowerCase().includes(searchTerm) ||
                    r.description?.toLowerCase().includes(searchTerm) ||
                    r.tags?.some(tag => tag.toLowerCase().includes(searchTerm))
                );
            }

            // Filter by region
            if (regionValue !== 'all') {
                filtered = filtered.filter(r => r.region === regionValue);
            }

            // Filter by online status - only apply if checkbox is checked
            // Offline servers are still displayed by default
            if (onlineOnly) {
                filtered = filtered.filter(r => {
                    const pingData = repoPingData.get(r.url);
                    return pingData && pingData.online;
                });
            }

            // Filter by whitelist
            if (whitelistFilter === 'whitelist') {
                filtered = filtered.filter(r => r.whitelist_enabled === true);
            } else if (whitelistFilter === 'no-whitelist') {
                filtered = filtered.filter(r => !r.whitelist_enabled);
            }

            listEl.innerHTML = filtered.map(repo => `
                <div class="repo-browser-item" style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:16px; cursor:pointer; transition:all 0.2s ease;" data-url="${escAttr(repo.url)}">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
                        <div style="flex:1;">
                            <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                                <span style="font-size:14px; font-weight:700; color:var(--text-primary);">${escHtml(repo.name)}</span>
                                <span class="repo-badge" style="font-size:9px; font-weight:800; padding:2px 8px; border-radius:4px; text-transform:uppercase; letter-spacing:0.5px; ${repo.category === 'official' ? 'background:rgba(16,185,129,0.15); color:#10b981;' : 'background:rgba(59,130,246,0.15); color:#3b82f6;'}">${escHtml(repo.category)}</span>
                                ${repo.hash ? `<span style="font-size:9px; font-weight:800; padding:2px 7px; border-radius:4px; text-transform:uppercase; letter-spacing:0.5px; background:rgba(16,185,129,0.12); color:#10b981; border:1px solid rgba(16,185,129,0.25); display:flex; align-items:center; gap:3px;" data-tooltip="Verified server — hash validated by the BMM team"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Verified</span>` : ''}
                                ${repo.whitelist_enabled === true
                                    ? `<span style="font-size:9px; font-weight:800; padding:2px 7px; border-radius:4px; text-transform:uppercase; letter-spacing:0.5px; background:rgba(34,197,94,0.12); color:#22c55e; border:1px solid rgba(34,197,94,0.3); display:flex; align-items:center; gap:3px;" data-tooltip="This server uses a whitelist — access is restricted"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Whitelist</span>`
                                    : repo.whitelist_enabled === false
                                    ? `<span style="font-size:9px; font-weight:800; padding:2px 7px; border-radius:4px; text-transform:uppercase; letter-spacing:0.5px; background:rgba(239,68,68,0.08); color:#f87171; border:1px solid rgba(239,68,68,0.2); display:flex; align-items:center; gap:3px;" data-tooltip="This server has no whitelist — open access"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg> Open</span>`
                                    : ''
                                }
                            </div>
                            <p style="font-size:12px; color:var(--text-secondary); margin:0; line-height:1.5;">${escHtml(repo.description || '')}</p>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-end; margin-left:16px;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                ${repoStarBtn(repo.url)}
                                <span style="font-size:10px; color:var(--text-muted);">${escHtml(repo.region || 'Unknown')}</span>
                            </div>
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
                        <div style="display:flex; align-items:center; gap:6px;" class="repo-ping-container" data-url="${escAttr(repo.url)}">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" class="repo-ping-icon">
                                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                            </svg>
                            <span style="font-size:11px; color:var(--text-muted); font-weight:600;" class="repo-ping-text">Pinging...</span>
                        </div>
                        <div style="display:flex; gap:4px; margin-left:auto;">
                            ${repo.website_link ? `
                            <a href="${escAttr(repo.website_link)}" target="_blank" style="width:20px; height:20px; display:flex; align-items:center; justify-content:center; background:rgba(6,182,212,0.15); border:1px solid rgba(6,182,212,0.3); border-radius:4px; text-decoration:none; color:var(--cyan);" >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="12" r="10"/>
                                    <line x1="2" y1="12" x2="22" y2="12"/>
                                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                                </svg>
                            </a>
                            ` : ''}
                            ${repo.discord_link ? `
                            <a href="${escAttr(repo.discord_link)}" target="_blank" title="Discord" style="width:22px; height:22px; display:flex; align-items:center; justify-content:center; background:#5865F2; border-radius:5px; text-decoration:none; flex-shrink:0; transition:opacity 0.15s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">
                                <svg width="13" height="10" viewBox="0 0 71 55" fill="white" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M60.1 4.9A58.5 58.5 0 0 0 45.6.7a.2.2 0 0 0-.2.1 40.8 40.8 0 0 0-1.8 3.7 54 54 0 0 0-16.2 0A37.5 37.5 0 0 0 25.6.8a.2.2 0 0 0-.2-.1 58.3 58.3 0 0 0-14.5 4.2.2.2 0 0 0-.1.1C1.6 18.5-.9 31.7.3 44.8v.1a58.7 58.7 0 0 0 17.7 9 .2.2 0 0 0 .2-.1 42 42 0 0 0 3.6-5.9.2.2 0 0 0-.1-.3 38.7 38.7 0 0 1-5.5-2.6.2.2 0 0 1 0-.4c.4-.3.7-.6 1.1-.8a.2.2 0 0 1 .2 0c11.6 5.3 24.1 5.3 35.5 0a.2.2 0 0 1 .2 0l1.1.8a.2.2 0 0 1 0 .4 36 36 0 0 1-5.5 2.6.2.2 0 0 0-.1.3 47 47 0 0 0 3.6 5.9.2.2 0 0 0 .2.1 58.5 58.5 0 0 0 17.7-9v-.1c1.5-15.3-2.5-28.4-10.7-40.1a.2.2 0 0 0-.1 0ZM23.7 37c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.5 3.3 6.4 7.2 0 4-2.8 7.2-6.4 7.2Zm23.6 0c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.5 3.3 6.4 7.2 0 4-2.8 7.2-6.4 7.2Z"/>
                                </svg>
                            </a>
                            ` : ''}
                        </div>
                    </div>
                    
                    ${repo.changelog_link ? `
                    <div style="margin-top:8px;">
                        <a href="${escAttr(repo.changelog_link)}" target="_blank" style="font-size:10px; color:var(--accent); text-decoration:none; display:flex; align-items:center; gap:4px; padding:3px 8px; background:rgba(59,130,246,0.1); border-radius:4px; width:fit-content;">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                                <line x1="16" y1="13" x2="8" y2="13"/>
                                <line x1="16" y1="17" x2="8" y2="17"/>
                                <polyline points="10 9 9 9 8 9"/>
                            </svg>
                            Changelog
                        </a>
                    </div>
                    ` : ''}
                </div>
            `).join('');

            // Favorite star handlers (must run before item-click; stop propagation)
            listEl.querySelectorAll('.repo-fav-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const url = btn.dataset.favUrl;
                    const nowFav = toggleRepoFav(url);
                    btn.classList.toggle('active', nowFav);
                    const svg = btn.querySelector('svg');
                    if (svg) svg.setAttribute('fill', nowFav ? 'currentColor' : 'none');
                });
            });

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

            // Dynamically ping repos
            const checkRepo = async (url) => {
                const start = performance.now();
                try {
                    const target = url.trim().endsWith('repo.json') ? url.trim() : (url.trim().endsWith('/') ? url.trim() + 'repo.json' : url.trim() + '/repo.json');
                    let finalUrl = target;
                    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
                        finalUrl = 'https://' + finalUrl;
                    }
                    
                    // Use native Tauri invoke to completely bypass browser CORS restrictions 
                    // and avoid api.ts wrapper that logs console.error spam on failure
                    let rawInvoke;
                    if (window.__TAURI__) {
                        rawInvoke = window.__TAURI__.invoke;
                    } else {
                        const tauriApi = await import('https://unpkg.com/@tauri-apps/api@1/tauri.js');
                        rawInvoke = tauriApi.invoke;
                    }
                    await rawInvoke('fetch_repo_info', { url: finalUrl });
                    return Math.round(performance.now() - start);
                } catch(e) {}
                return -1;
            };

            // Process pinging sequentially or in small batches to avoid network saturation
            const updatePings = async () => {
                const pingContainers = listEl.querySelectorAll('.repo-ping-container');
                for (const container of pingContainers) {
                    const url = container.dataset.url;
                    if (!url) continue;
                    
                    const ping = await checkRepo(url);
                    const icon = container.querySelector('.repo-ping-icon');
                    const text = container.querySelector('.repo-ping-text');
                    
                    // Store ping data for online filter
                    repoPingData.set(url, { online: ping >= 0, ping });
                    
                    if (ping >= 0) {
                        const color = ping < 100 ? '#10b981' : ping < 250 ? '#f59e0b' : '#ef4444';
                        icon.setAttribute('stroke', color);
                        text.style.color = color;
                        text.textContent = ping + 'ms';
                    } else {
                        icon.setAttribute('stroke', '#ef4444');
                        text.style.color = '#ef4444';
                        text.textContent = 'Offline';
                    }
                }
                
                // Add click handler for manual ping refresh
                listEl.querySelectorAll('.repo-ping-container').forEach(container => {
                    container.style.cursor = 'pointer';
                    container.onclick = async (e) => {
                        e.stopPropagation();
                        const url = container.dataset.url;
                        if (!url) return;
                        
                        const icon = container.querySelector('.repo-ping-icon');
                        const text = container.querySelector('.repo-ping-text');
                        
                        text.textContent = 'Pinging...';
                        icon.setAttribute('stroke', 'var(--text-muted)');
                        text.style.color = 'var(--text-muted)';
                        
                        const ping = await checkRepo(url);
                        
                        // Store ping data for online filter
                        repoPingData.set(url, { online: ping >= 0, ping });
                        
                        if (ping >= 0) {
                            const color = ping < 100 ? '#10b981' : ping < 250 ? '#f59e0b' : '#ef4444';
                            icon.setAttribute('stroke', color);
                            text.style.color = color;
                            text.textContent = ping + 'ms';
                        } else {
                            icon.setAttribute('stroke', '#ef4444');
                            text.style.color = '#ef4444';
                            text.textContent = 'Offline';
                        }
                        
                        // Re-render if online filter is active (debounced to avoid infinite loop)
                        if (onlineFilter?.checked) {
                            setTimeout(() => renderRepoList(), 100);
                        }
                    };
                });
                
                // Re-render if online filter is active (debounced to avoid infinite loop)
                if (onlineFilter?.checked) {
                    setTimeout(() => renderRepoList(), 100);
                }
            };
            
            // Start the background ping task
            updatePings();
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

        const btnRefresh = document.getElementById('btn-refresh-repo-browser');
        if (btnRefresh) {
            btnRefresh.addEventListener('click', () => {
                btnRefresh.style.opacity = '0.5';
                btnRefresh.style.pointerEvents = 'none';
                const svg = btnRefresh.querySelector('svg');
                if (svg) svg.style.animation = 'spin 0.6s linear infinite';
                fetchRepoList().then(() => {
                    btnRefresh.style.opacity = '';
                    btnRefresh.style.pointerEvents = '';
                    if (svg) svg.style.animation = '';
                });
            });
        }

        filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                filterBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentFilter = btn.dataset.filter;
                renderRepoList();
            });
        });

        // Add event listeners for new filters
        if (searchInput) {
            searchInput.addEventListener('input', renderRepoList);
        }

        if (regionFilter) {
            regionFilter.addEventListener('change', renderRepoList);
        }

        if (onlineFilter) {
            onlineFilter.addEventListener('change', renderRepoList);
        }

        if (whitelistFilterEl) {
            whitelistFilterEl.addEventListener('change', renderRepoList);
        }
    };
    initRepoBrowser();

    const saveHostHistory = (path) => {
        try {
            let paths = JSON.parse(localStorage.getItem('bmm_repo_history_host') || '[]');
            paths = paths.filter(p => p !== path);
            paths.unshift(path);
            if (paths.length > 10) paths.length = 10;
            localStorage.setItem('bmm_repo_history_host', JSON.stringify(paths));
            loadHostHistory();
        } catch(e) {}
    };

    const loadHostHistory = () => {
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
    loadHostHistory();

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
                // Mark the API guard busy so external API gen calls are rejected.
                try { invoke('set_repo_busy', { kind: 'gen', busy: true }); } catch (_) {}
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
                        server_type: elements.selectZipType ? elements.selectZipType.value : "user",
                        use_cloudflare: elements.cbZipCloudflare.checked,
                        use_upnp: elements.cbZipUpnp.checked,
                        enable_docker: elements.cbZipDocker ? elements.cbZipDocker.checked : false,
                        docker_host_type: elements.zipDockerHostSelect ? elements.zipDockerHostSelect.value : "linux"
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
                // Release the API "generation in progress" guard.
                try { invoke('set_repo_busy', { kind: 'gen', busy: false }); } catch (_) {}

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

    // ZIP Docker toggle
    if (elements.cbZipDocker) {
        elements.cbZipDocker.addEventListener('change', () => {
            if (elements.zipDockerOptions) {
                elements.zipDockerOptions.style.display = elements.cbZipDocker.checked ? 'block' : 'none';
            }
        });
    }

    // --- Events ---
    window.addEventListener('bmm://modpacks-updated', () => {
        if (elements.modpacksListEl) {
            loadModpacksForExport(elements.modpacksListEl);
        }
    });
}
