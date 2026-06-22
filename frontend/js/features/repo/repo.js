// @ts-nocheck
import { invoke, pickFolder } from '../../core/api.js';
import { toast } from '../../ui/app.js';
import { escHtml, escAttr, formatBytes } from '../../core/utils.js';
import { getLinks } from '../../core/links-config.js';
import { t } from '../../core/i18n.js';
// Sub-modules
import { initRepoServer } from './repo-server.js';
import { initRepoMonitoring } from './repo-monitoring.js';
import { initRepoSync } from './repo-sync.js';
import { initModUpdates } from './mod-updates.js';
import { initRepoAdmin } from './repo-admin.js';
// Normalise a repo URL so map lookups match regardless of trailing slash / repo.json
export const normRepoUrl = (url) => {
    let u = (url || '').trim();
    u = u.replace(/\/repo\.json$/i, '').replace(/\/+$/, '');
    return u.toLowerCase();
};
// ── Repo favorites (localStorage) ─────────────────────────────────────────────
const REPO_FAV_KEY = 'bmm_repo_favorites';
export const getRepoFavorites = () => {
    try {
        return JSON.parse(localStorage.getItem(REPO_FAV_KEY) || '[]');
    }
    catch {
        return [];
    }
};
export const isRepoFav = (url) => getRepoFavorites().includes(url);
export const toggleRepoFav = (url) => {
    let favs = getRepoFavorites();
    const has = favs.includes(url);
    favs = has ? favs.filter(u => u !== url) : [...favs, url];
    localStorage.setItem(REPO_FAV_KEY, JSON.stringify(favs));
    return !has; // new state
};
// Star button markup (shared between browse + history)
const repoStarBtn = (url) => {
    const fav = isRepoFav(url);
    return `<button class="repo-fav-btn${fav ? ' active' : ''}" data-fav-url="${escAttr(url)}" title="${fav ? (t('repo.unfavorite') || 'Unfavorite') : (t('repo.favorite') || 'Favorite')}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="${fav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
    </button>`;
};
export const copyToClipboard = async (text, successMsg) => {
    try {
        await navigator.clipboard.writeText(text);
        toast(successMsg || t('repo.urlCopied'), "success");
    }
    catch (err) {
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
        if (!modal || !btnYes || !btnCancel)
            return resolve(false);
        titleEl.textContent = title || t('common.confirm') || "Confirmation";
        messageEl.textContent = message || "";
        if (isDanger) {
            btnYes.className = 'btn btn-danger';
            if (iconContainer) {
                iconContainer.style.background = 'rgba(239, 68, 68, 0.1)';
                iconContainer.style.color = 'var(--danger)';
            }
        }
        else {
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
        modal.onclick = (e) => { if (e.target === modal) {
            cleanup();
            resolve(false);
        } };
        modal.classList.add('open');
    });
};
// --- Profile Checklist (exportable function) ---
export const loadProfilesForExport = async (profilesListEl) => {
    if (!profilesListEl)
        return;
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
            item.onclick = (e) => { if (e.target !== cb)
                cb.checked = !cb.checked; };
            const info = document.createElement('div');
            info.style.cssText = 'margin-left:12px; display:flex; flex-direction:column;';
            info.innerHTML = `<span style="font-size:13.5px; font-weight:600; color:var(--text-color);">${escHtml(p.name)}</span>
                <span style="font-size:11px; color:var(--text-muted); margin-top:2px;">${escHtml(t(p.game_name) || p.game_name || t('repo.genericGame'))}</span>`;
            item.appendChild(cb);
            item.appendChild(info);
            profilesListEl.appendChild(item);
        });
    }
    catch (err) {
        console.error("Failed to load profiles for export:", err);
    }
};
// --- Modpack Checklist (exportable function) ---
export const loadModpacksForExport = async (modpacksListEl) => {
    if (!modpacksListEl)
        return;
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
    }
    catch (err) {
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
    initModUpdates();
    // ── Sync / Hosting tab switcher ──────────────────────────────────────
    const activateRepoTab = (name) => {
        const view = document.getElementById('view-repo');
        if (!view)
            return;
        view.querySelectorAll('.repo-tab-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.repoTab === name);
        });
        view.querySelectorAll('.repo-tab-panel').forEach(p => {
            p.classList.toggle('active', p.dataset.repoPanel === name);
        });
    };
    window.activateRepoTab = activateRepoTab;
    document.querySelectorAll('#view-repo .repo-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => activateRepoTab(btn.dataset.repoTab || 'sync'));
    });
    // ZIP Export Server Type Listener (lock cloudflare/upnp for "server")
    if (elements.selectZipType) {
        elements.selectZipType.addEventListener('change', (e) => {
            const isServer = e.target.value === 'server';
            if (isServer) {
                if (elements.cbZipCloudflare) {
                    elements.cbZipCloudflare.checked = false;
                    elements.cbZipCloudflare.disabled = true;
                }
                if (elements.cbZipUpnp) {
                    elements.cbZipUpnp.checked = false;
                    elements.cbZipUpnp.disabled = true;
                }
            }
            else {
                if (elements.cbZipCloudflare)
                    elements.cbZipCloudflare.disabled = false;
                if (elements.cbZipUpnp)
                    elements.cbZipUpnp.disabled = false;
            }
        });
        // Dispatch initial change event
        elements.selectZipType.dispatchEvent(new Event('change'));
    }
    // ── bmm:repo-focus — auto-launch + pre-fill from Quick Test ──
    document.addEventListener('bmm:repo-focus', (e) => {
        const section = e.detail?.section ?? '';
        const prefill = e.detail?.prefill ?? null;
        // Make sure the relevant tab is visible before scrolling/pre-filling
        const HOST_SECTIONS = ['host', 'gen', 'update'];
        activateRepoTab(HOST_SECTIONS.includes(section) ? 'host' : 'sync');
        if (section === 'sync') {
            // ── Pre-fill sync form fields from QT data ──
            if (prefill) {
                if (prefill.url && elements.inputSyncUrl)
                    elements.inputSyncUrl.value = prefill.url;
                if (prefill.gameDir && elements.inputSyncGamePath)
                    elements.inputSyncGamePath.value = prefill.gameDir;
                if (prefill.modsDir && elements.inputSyncModsPath)
                    elements.inputSyncModsPath.value = prefill.modsDir;
                if (prefill.backupDir && elements.inputSyncBackupPath)
                    elements.inputSyncBackupPath.value = prefill.backupDir;
                if (typeof prefill.downloadLimit === 'number' && elements.inputSyncDownloadLimit)
                    elements.inputSyncDownloadLimit.value = String(prefill.downloadLimit);
            }
            // Scroll the sync URL card into view
            const target = elements.syncUrlCard ?? elements.inputSyncUrl;
            if (target)
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            // Auto-click Fetch to load remote repo profiles
            setTimeout(() => {
                if (elements.btnFetchInfo)
                    elements.btnFetchInfo.click();
            }, 300);
            // If choices were specified, wait for Fetch to complete then auto-select profiles + auto-sync
            const wantedProfileIds = (prefill?.choices || [])
                .map((c) => c.repoProfileId)
                .filter(Boolean);
            if (wantedProfileIds.length > 0 && elements.profilesSelectionEl) {
                let attempts = 0;
                const pollId = setInterval(() => {
                    attempts++;
                    const cbs = elements.profilesSelectionEl.querySelectorAll('.repo-sync-choice-cb');
                    if (cbs.length > 0) {
                        clearInterval(pollId);
                        // Auto-select matching profiles
                        cbs.forEach(cb => {
                            if (wantedProfileIds.includes(cb.dataset.repoProfileId || '')) {
                                if (!cb.checked)
                                    cb.click();
                            }
                        });
                        // Auto-click Sync after profiles are selected
                        setTimeout(() => {
                            if (elements.btnStartSync)
                                elements.btnStartSync.click();
                        }, 400);
                    }
                    if (attempts >= 20)
                        clearInterval(pollId); // max 10s
                }, 500);
            }
        }
        else if (section === 'connect') {
            // Fill URL in sync form and auto-fetch the repo info
            if (prefill?.url && elements.inputSyncUrl)
                elements.inputSyncUrl.value = prefill.url;
            const connectTarget = elements.syncUrlCard ?? elements.inputSyncUrl;
            if (connectTarget)
                connectTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(() => {
                if (elements.btnFetchInfo)
                    elements.btnFetchInfo.click();
            }, 300);
        }
        else if (section === 'disconnect') {
            // Clear the fetched repo state (equivalent to disconnecting from the UI)
            const disconnectTarget = elements.syncUrlCard ?? elements.inputSyncUrl;
            if (disconnectTarget)
                disconnectTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(() => {
                if (elements.btnClearFetchedRepo)
                    elements.btnClearFetchedRepo.click();
            }, 300);
        }
        else if (section === 'host') {
            // Pre-fill host server settings and start the server
            if (prefill) {
                // repo-host-path is the directory the server serves from
                const hostPathInput = document.getElementById('repo-host-path');
                if (prefill.serveDir && hostPathInput)
                    hostPathInput.value = prefill.serveDir;
                if (prefill.port && elements.inputServerPort)
                    elements.inputServerPort.value = String(prefill.port);
                if (prefill.uploadLimit !== undefined && elements.inputServerUploadLimit)
                    elements.inputServerUploadLimit.value = String(prefill.uploadLimit);
            }
            // Scroll to the toggle server button
            if (elements.btnToggleServer)
                elements.btnToggleServer.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => {
                if (elements.btnToggleServer)
                    elements.btnToggleServer.click();
            }, 300);
        }
        else if (section === 'gen') {
            // Switch to export/gen tab if tab system is present
            const genTab = document.querySelector('[data-repo-tab="export"], [data-repo-tab="gen"]');
            if (genTab)
                genTab.click();
            // ── Pre-fill gen/export form fields from QT data ──
            if (prefill) {
                if (prefill.outputDir && elements.inputExportPath)
                    elements.inputExportPath.value = prefill.outputDir;
                if (prefill.authorName && elements.inputExportAuthor)
                    elements.inputExportAuthor.value = prefill.authorName;
                if (prefill.seed && elements.inputExportSeed)
                    elements.inputExportSeed.value = prefill.seed;
                // ── Select profiles matching prefill.profileIds ──
                if (Array.isArray(prefill.profileIds) && prefill.profileIds.length > 0) {
                    // Wait a tick for the profile list to be rendered
                    requestAnimationFrame(() => {
                        const allCbs = document.querySelectorAll('.repo-profile-cb');
                        allCbs.forEach(cb => {
                            cb.checked = prefill.profileIds.includes(cb.value);
                        });
                    });
                }
                // ── Zip output — only check the ZIP checkbox if zipOutput is explicitly true ──
                // generateServer alone (standalone .bat) does NOT produce a zip — it fills the mini server section
                if (prefill.zipOutput && elements.cbZipEnable) {
                    elements.cbZipEnable.checked = true;
                    elements.cbZipEnable.dispatchEvent(new Event('change', { bubbles: true }));
                }
                // ── Server distribution options (only apply when zip output is active) ──
                if (prefill.zipOutput) {
                    requestAnimationFrame(() => {
                        // Port
                        if (prefill.port && elements.inputZipPort)
                            elements.inputZipPort.value = String(prefill.port);
                        // Upload limit
                        if (prefill.uploadLimit !== undefined && elements.inputZipLimit)
                            elements.inputZipLimit.value = String(prefill.uploadLimit);
                        // Admin password
                        if (prefill.adminPassword && elements.inputZipPass)
                            elements.inputZipPass.value = prefill.adminPassword;
                        // Cloudflare tunnel
                        if (prefill.useCloudflare && elements.cbZipCloudflare)
                            elements.cbZipCloudflare.checked = true;
                        // UPnP
                        if (prefill.useUpnp && elements.cbZipUpnp)
                            elements.cbZipUpnp.checked = true;
                        // Docker
                        if (prefill.useDocker && elements.cbZipDocker) {
                            elements.cbZipDocker.checked = true;
                            // Trigger docker toggle to show sub-options
                            elements.cbZipDocker.dispatchEvent(new Event('change', { bubbles: true }));
                            // Docker OS
                            if (prefill.dockerOs && elements.zipDockerHostSelect)
                                elements.zipDockerHostSelect.value = prefill.dockerOs;
                        }
                        // Server version: std/standard → '1' (Hybrid), lux/premium → '2' (V2 Luxe)
                        if (prefill.serverVersion && elements.selectZipVersion) {
                            const vmap = { std: '1', lux: '2', standard: '1', premium: '2' };
                            const v = vmap[prefill.serverVersion] ?? prefill.serverVersion;
                            elements.selectZipVersion.value = v;
                        }
                        if (prefill.serverType && elements.selectZipType) {
                            elements.selectZipType.value = prefill.serverType;
                            elements.selectZipType.dispatchEvent(new Event('change'));
                        }
                    });
                }
            }
            // Scroll the export path input or start button into view
            const target = elements.btnStartExport ?? elements.inputExportPath;
            if (target)
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            // Auto-click the Start Export / Gen button
            setTimeout(() => {
                if (elements.btnStartExport)
                    elements.btnStartExport.click();
            }, 300);
            // ── If standalone server (generateServer without zipOutput), pre-fill the mini server section ──
            // The mini server section is always visible — pre-fill it so after gen the user just clicks "Generate Server"
            if (prefill?.generateServer && !prefill?.zipOutput && prefill?.outputDir) {
                const miniRepoPath = elements.inputMiniRepoPath;
                if (miniRepoPath)
                    miniRepoPath.value = prefill.outputDir;
                const miniPort = document.getElementById('repo-mini-server-port');
                if (miniPort && prefill.port)
                    miniPort.value = String(prefill.port);
                const miniLimit = document.getElementById('repo-mini-server-upload-limit');
                if (miniLimit && prefill.uploadLimit !== undefined)
                    miniLimit.value = String(prefill.uploadLimit);
                const miniPass = document.getElementById('repo-mini-server-password');
                if (miniPass && prefill.adminPassword)
                    miniPass.value = prefill.adminPassword;
                // Version: std→'1', lux→'2'
                const miniVer = document.getElementById('repo-mini-server-version');
                if (miniVer && prefill.serverVersion) {
                    const vmap2 = { std: '1', lux: '2', standard: '1', premium: '2' };
                    miniVer.value = vmap2[prefill.serverVersion] ?? prefill.serverVersion;
                }
                const miniCf = document.getElementById('repo-mini-server-cloudflare');
                if (miniCf && prefill.useCloudflare != null)
                    miniCf.checked = !!prefill.useCloudflare;
                const miniUpnp = document.getElementById('repo-mini-server-upnp');
                if (miniUpnp && prefill.useUpnp != null)
                    miniUpnp.checked = !!prefill.useUpnp;
                const miniAutoStart = elements.cbAutoStart;
                if (miniAutoStart && prefill.autoStart != null)
                    miniAutoStart.checked = !!prefill.autoStart;
                if (prefill.useDocker && elements.cbDocker) {
                    elements.cbDocker.checked = true;
                    elements.cbDocker.dispatchEvent(new Event('change', { bubbles: true }));
                    if (prefill.dockerOs && elements.dockerHostSelect)
                        elements.dockerHostSelect.value = prefill.dockerOs;
                }
                // Scroll to mini server section after gen starts (give it a moment)
                setTimeout(() => {
                    const miniSection = document.getElementById('repo-mini-server-json-path');
                    if (miniSection)
                        miniSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 1500);
            }
        }
        else if (section === 'update') {
            // ── Open the "Update existing repo" modal and pre-fill from API params ──
            // This drives the UI exactly as a human would — the user sees the modal
            // with the repo loaded, can adjust the selection, then clicks Apply.
            const btnOpenUpdate = document.getElementById('btn-open-repo-update');
            if (btnOpenUpdate)
                btnOpenUpdate.click();
            // Pre-fill the repo dir and trigger a load
            if (prefill?.repoDir) {
                setTimeout(async () => {
                    const pathInput = document.getElementById('repo-update-path');
                    if (pathInput)
                        pathInput.value = prefill.repoDir;
                    // Load the repo content into the modal
                    try {
                        const repo = await invoke('read_local_repo', { repoDir: prefill.repoDir });
                        // Trigger renderLoaded via a custom event (the modal handler listens for this)
                        document.dispatchEvent(new CustomEvent('bmm:repo-update-loaded', { detail: { repo, repoDir: prefill.repoDir } }));
                    }
                    catch (_) { /* show user-friendly error — already handled */ }
                }, 350);
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
        }
        catch (e) {
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
                }
                catch (e) {
                    toast(String(e), 'error');
                }
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
            if (history.length > 20)
                history.length = 20;
            localStorage.setItem('bmm_repo_history_client', JSON.stringify(history));
        }
        catch (e) { }
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
                    rawInvoke = window.__TAURI__.core.invoke;
                }
                else {
                    const tauriApi = await import('https://unpkg.com/@tauri-apps/api@1/tauri.js');
                    rawInvoke = tauriApi.invoke;
                }
                await rawInvoke('fetch_repo_info', { url: finalUrl });
                return Math.round(performance.now() - start);
            }
            catch (e) { }
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
                    const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
                        if (elements.inputSyncUrl)
                            elements.inputSyncUrl.value = btn.dataset.url;
                        if (elements.btnFetchInfo)
                            elements.btnFetchInfo.click();
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
                        if (svg)
                            svg.setAttribute('fill', nowFav ? 'currentColor' : 'none');
                    };
                });
                // Ping history repos
                const updateHistoryPings = async () => {
                    const pingContainers = historyList.querySelectorAll('.repo-history-ping-container');
                    for (const container of pingContainers) {
                        const url = container.dataset.url;
                        if (!url)
                            continue;
                        const ping = await checkRepo(url);
                        const icon = container.querySelector('.repo-history-ping-icon');
                        const text = container.querySelector('.repo-history-ping-text');
                        if (ping >= 0) {
                            const color = ping < 100 ? '#10b981' : ping < 250 ? '#f59e0b' : '#ef4444';
                            icon.setAttribute('stroke', color);
                            text.style.color = color;
                            text.textContent = ping + 'ms';
                        }
                        else {
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
                        if (!url)
                            return;
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
                        }
                        else {
                            icon.setAttribute('stroke', '#ef4444');
                            text.style.color = '#ef4444';
                            text.textContent = 'Offline';
                        }
                    };
                });
            }
            catch (e) {
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
                const ok = await showConfirm(t('repo.historyClearTitle') || 'Clear history', t('repo.historyClearMsg') || 'Remove all non-favorited history entries? Favorited repos are kept.', true);
                if (!ok)
                    return; // only delete AFTER confirmation
                const history = JSON.parse(localStorage.getItem('bmm_repo_history_client') || '[]');
                const kept = history.filter(h => isRepoFav(h.url));
                localStorage.setItem('bmm_repo_history_client', JSON.stringify(kept));
                renderHistory();
            };
        }
        // "Clear All" → removes everything, including favorited entries
        if (btnClearAll) {
            btnClearAll.onclick = async () => {
                const ok = await showConfirm(t('repo.historyClearAllTitle') || 'Clear everything', t('repo.historyClearAllMsg') || 'Remove ALL history entries, including favorited repos? This cannot be undone.', true);
                if (!ok)
                    return;
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
                if (!response.ok)
                    throw new Error(`HTTP ${response.status}`);
                repoList = await response.json();
                // Build a url → expected-signature map (recorded by the BMM team when
                // validating the repo). repo-sync compares the live repo's signature
                // against this to detect content changed since verification.
                window.__bmmRepoExpectedSig = {};
                repoList.forEach(r => {
                    if (r.url && r.signature)
                        window.__bmmRepoExpectedSig[normRepoUrl(r.url)] = r.signature;
                });
                renderRepoList();
                loadingEl.style.display = 'none';
                contentEl.style.display = 'block';
            }
            catch (err) {
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
                filtered = filtered.filter(r => r.name?.toLowerCase().includes(searchTerm) ||
                    r.description?.toLowerCase().includes(searchTerm) ||
                    r.tags?.some(tag => tag.toLowerCase().includes(searchTerm)));
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
            }
            else if (whitelistFilter === 'no-whitelist') {
                filtered = filtered.filter(r => !r.whitelist_enabled);
            }
            // Favourites: optional "favourites only" filter + always float favourites to the top.
            const favOnly = document.getElementById('repo-browser-fav-filter')?.checked;
            if (favOnly)
                filtered = filtered.filter(r => isRepoFav(r.url));
            filtered = [...filtered].sort((a, b) => (isRepoFav(b.url) ? 1 : 0) - (isRepoFav(a.url) ? 1 : 0));
            listEl.innerHTML = filtered.map(repo => `
                <div class="repo-browser-item" style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:16px; cursor:pointer; transition:all 0.2s ease;" data-url="${escAttr(repo.url)}">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
                        <div style="flex:1;">
                            <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                                <span style="font-size:14px; font-weight:700; color:var(--text-primary);">${escHtml(repo.name)}</span>
                                <span class="repo-badge" style="font-size:9px; font-weight:800; padding:2px 8px; border-radius:4px; text-transform:uppercase; letter-spacing:0.5px; ${repo.category === 'official' ? 'background:rgba(16,185,129,0.15); color:#10b981;' : 'background:rgba(59,130,246,0.15); color:#3b82f6;'}">${escHtml(repo.category)}</span>
                                ${repo.hash ? `<span style="font-size:9px; font-weight:800; padding:2px 7px; border-radius:4px; text-transform:uppercase; letter-spacing:0.5px; background:rgba(16,185,129,0.12); color:#10b981; border:1px solid rgba(16,185,129,0.25); display:flex; align-items:center; gap:3px;" data-tooltip="${t('repo.verifiedServer') || 'Verified server — hash validated by the BMM team'}"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Verified</span>` : ''}
                                ${repo.whitelist_enabled === true
                ? `<span style="font-size:9px; font-weight:800; padding:2px 7px; border-radius:4px; text-transform:uppercase; letter-spacing:0.5px; background:rgba(34,197,94,0.12); color:#22c55e; border:1px solid rgba(34,197,94,0.3); display:flex; align-items:center; gap:3px;" data-tooltip="${t('repo.whitelistServer') || 'This server uses a whitelist — access is restricted'}"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Whitelist</span>`
                : repo.whitelist_enabled === false
                    ? `<span style="font-size:9px; font-weight:800; padding:2px 7px; border-radius:4px; text-transform:uppercase; letter-spacing:0.5px; background:rgba(239,68,68,0.08); color:#f87171; border:1px solid rgba(239,68,68,0.2); display:flex; align-items:center; gap:3px;" data-tooltip="${t('repo.openServer') || 'This server has no whitelist — open access'}"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg> Open</span>`
                    : ''}
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
                    if (svg)
                        svg.setAttribute('fill', nowFav ? 'currentColor' : 'none');
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
                        rawInvoke = window.__TAURI__.core.invoke;
                    }
                    else {
                        const tauriApi = await import('https://unpkg.com/@tauri-apps/api@1/tauri.js');
                        rawInvoke = tauriApi.invoke;
                    }
                    await rawInvoke('fetch_repo_info', { url: finalUrl });
                    return Math.round(performance.now() - start);
                }
                catch (e) { }
                return -1;
            };
            // Process pinging sequentially or in small batches to avoid network saturation
            const updatePings = async () => {
                const pingContainers = listEl.querySelectorAll('.repo-ping-container');
                for (const container of pingContainers) {
                    const url = container.dataset.url;
                    if (!url)
                        continue;
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
                    }
                    else {
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
                        if (!url)
                            return;
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
                        }
                        else {
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
                if (svg)
                    svg.style.animation = 'spin 0.6s linear infinite';
                fetchRepoList().then(() => {
                    btnRefresh.style.opacity = '';
                    btnRefresh.style.pointerEvents = '';
                    if (svg)
                        svg.style.animation = '';
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
        const favFilterEl = document.getElementById('repo-browser-fav-filter');
        if (favFilterEl) {
            favFilterEl.addEventListener('change', renderRepoList);
        }
    };
    initRepoBrowser();
    // ── Repo Update (incremental) ──
    // Persistent state so closing the modal does NOT stop the running update;
    // reopening shows the live progress until it finishes.
    const _ru = { running: false, percent: 0, status: '', repoDir: '', done: false, summary: '' };
    let _ruListenerAttached = false;
    const initRepoUpdate = () => {
        const modal = document.getElementById('modal-repo-update');
        const btnOpen = document.getElementById('btn-open-repo-update');
        const pathInput = document.getElementById('repo-update-path');
        const btnPick = document.getElementById('btn-pick-repo-update-folder');
        const contentEl = document.getElementById('repo-update-content');
        const currentEl = document.getElementById('repo-update-current');
        const addEl = document.getElementById('repo-update-add');
        const btnApply = document.getElementById('btn-apply-repo-update');
        const btnCancel = document.getElementById('btn-cancel-repo-update');
        const progressEl = document.getElementById('repo-update-progress');
        const statusEl = document.getElementById('repo-update-status');
        const percentEl = document.getElementById('repo-update-percent');
        const fillEl = document.getElementById('repo-update-fill');
        if (!modal || !btnOpen)
            return;
        let repoDir = '';
        // Reflect _ru state into the progress UI (called on every event + on open)
        const syncProgressUI = () => {
            if (!progressEl)
                return;
            if (_ru.running || _ru.done) {
                progressEl.style.display = 'block';
                percentEl.textContent = `${Math.round(_ru.percent)}%`;
                fillEl.style.width = `${Math.round(_ru.percent)}%`;
                statusEl.textContent = _ru.done ? (_ru.summary || t('repo.update.done') || 'Done') : _ru.status;
                fillEl.style.background = _ru.done ? 'var(--green)' : 'linear-gradient(90deg,var(--cyan),#00f0ff)';
            }
            else {
                progressEl.style.display = 'none';
            }
            if (btnApply)
                btnApply.disabled = _ru.running || !repoDir;
            if (btnCancel)
                btnCancel.style.display = _ru.running ? 'inline-flex' : 'none';
        };
        // After an update finishes, reload the repo content so the modal shows the
        // NEW post-update state (no need to re-pick the folder).
        const reloadCurrentRepo = async () => {
            if (!repoDir)
                return;
            try {
                const repo = await invoke('read_local_repo', { repoDir });
                await renderLoaded(repo);
            }
            catch { /* repo may have been emptied/removed */ }
        };
        // Persistent progress listener (attached once, survives modal close)
        const attachListener = async () => {
            if (_ruListenerAttached || !window.__TAURI__)
                return;
            _ruListenerAttached = true;
            const { listen } = window.__TAURI__.event;
            await listen('bmm://repo-export-progress', (event) => {
                if (!_ru.running)
                    return; // ignore generic export events
                const { step, progress } = event.payload;
                if (progress !== undefined)
                    _ru.percent = progress;
                if (step) {
                    try {
                        _ru.status = t(JSON.parse(step).key) || step;
                    }
                    catch {
                        _ru.status = t(step) || step;
                    }
                }
                syncProgressUI();
            });
        };
        const renderLoaded = async (repo) => {
            // Current repo content — checkbox per mod (checked = keep, unchecked = remove)
            currentEl.innerHTML = (repo.profiles || []).map(p => `
                <div class="ru-current-block" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:10px;">
                    <div style="font-size:12px;font-weight:700;color:var(--accent);margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
                        <span>${escHtml(p.name)} <span style="color:var(--text-muted);font-weight:400;">(${p.mods.length} mods)</span></span>
                        <button class="btn btn-xs btn-outline-danger repo-up-rm-profile" data-pid="${escAttr(p.id)}" style="font-size:10px;flex-shrink:0;">${t('repo.update.removeProfile') || 'Remove profile'}</button>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:3px;">
                        ${p.mods.map(m => `
                        <div>
                            <label style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text-secondary);cursor:pointer;">
                                <input type="checkbox" class="repo-up-keep-mod" data-mid="${escAttr(m.id)}" checked>
                                <span>${escHtml(m.name)} <span style="color:var(--text-muted);">v${escHtml(m.version)}</span></span>
                            </label>
                            <div style="display:flex;align-items:center;gap:6px;margin:1px 0 3px 22px;font-size:9px;color:var(--text-muted);font-family:var(--font-mono);">
                                <span>repo_mod_id:</span>
                                <span style="color:var(--text-secondary);user-select:all;">${escHtml(m.id)}</span>
                                <button type="button" class="repo-up-copy-id" data-mid="${escAttr(m.id)}" title="${escAttr(t('common.copy') || 'Copy')}" style="border:none;background:rgba(255,255,255,0.06);color:var(--text-secondary);border-radius:3px;padding:1px 5px;cursor:pointer;font-size:9px;">${t('common.copy') || 'Copy'}</button>
                            </div>
                        </div>`).join('')}
                    </div>
                </div>`).join('') || `<div style="color:var(--text-muted);font-size:12px;">${t('repo.update.empty') || 'Repo is empty'}</div>`;
            // Local profiles to add — expandable per-mod selection
            const localProfiles = await invoke('get_profiles');
            addEl.innerHTML = localProfiles.map(p => `
                <div class="ru-add-block" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;overflow:hidden;">
                    <div style="display:flex;align-items:center;gap:8px;padding:10px;cursor:pointer;font-size:12px;">
                        <input type="checkbox" class="repo-up-add-profile" data-pid="${escAttr(p.id)}">
                        <span style="font-weight:600;flex:1;">${escHtml(p.name)} <span style="color:var(--text-muted);font-size:11px;font-weight:400;">${escHtml(p.game_name || '')}</span></span>
                        <button class="btn btn-xs btn-ghost repo-up-expand" data-pid="${escAttr(p.id)}" style="font-size:10px;">${t('repo.update.chooseMods') || 'Choose mods'}</button>
                    </div>
                    <div class="repo-up-mods" data-pid="${escAttr(p.id)}" style="display:none;padding:0 10px 10px 32px;border-top:1px solid rgba(255,255,255,0.04);"></div>
                </div>`).join('');
            contentEl.style.display = 'block';
            btnApply.disabled = false;
            currentEl.querySelectorAll('.repo-up-copy-id').forEach(b => b.addEventListener('click', (e) => {
                e.preventDefault();
                navigator.clipboard?.writeText(b.dataset.mid || '').then(() => {
                    toast(t('repo.update.idCopied') || 'repo_mod_id copied', 'success');
                }).catch(() => { });
            }));
            currentEl.querySelectorAll('.repo-up-rm-profile').forEach(btn => {
                btn.addEventListener('click', () => {
                    const block = btn.closest('.ru-current-block');
                    btn.dataset.removed = btn.dataset.removed === '1' ? '0' : '1';
                    const removed = btn.dataset.removed === '1';
                    if (block)
                        block.style.opacity = removed ? '0.4' : '1';
                    btn.textContent = removed ? (t('repo.update.removed') || 'Will remove ✓') : (t('repo.update.removeProfile') || 'Remove profile');
                });
            });
            // Expand → load that profile's mods with per-mod checkboxes
            addEl.querySelectorAll('.repo-up-expand').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const pid = btn.dataset.pid;
                    const box = addEl.querySelector(`.repo-up-mods[data-pid="${pid}"]`);
                    if (!box)
                        return;
                    if (box.style.display === 'block') {
                        box.style.display = 'none';
                        return;
                    }
                    box.style.display = 'block';
                    if (!box.dataset.loaded) {
                        box.innerHTML = `<div style="font-size:11px;color:var(--text-muted);padding:6px 0;">${t('common.loading') || 'Loading…'}</div>`;
                        try {
                            const mods = await invoke('get_profile_mod_list', { profileId: pid });
                            box.innerHTML = `
                                <div style="font-size:10px;color:var(--text-muted);margin:6px 0 4px;">${t('repo.update.modsHint') || 'Checked mods will be added. Leave all checked to add the whole profile.'}</div>
                                ${mods.map(m => `
                                <div style="padding:1px 0;">
                                    <label style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text-secondary);cursor:pointer;">
                                        <input type="checkbox" class="repo-up-add-mod" data-pid="${escAttr(pid)}" data-mid="${escAttr(m.id)}" checked>
                                        <span>${escHtml(m.name)} <span style="color:var(--text-muted);">v${escHtml(m.version)}</span></span>
                                    </label>
                                    <input type="text" class="repo-up-mod-changelog" data-mid="${escAttr(m.id)}"
                                        placeholder="${escAttr(t('repo.update.changelogPlaceholder') || 'Changelog for this version (optional)')}"
                                        style="width:100%;margin:3px 0 2px 22px;max-width:calc(100% - 22px);font-size:10px;padding:3px 6px;border-radius:4px;border:1px solid var(--bmm-s08,rgba(255,255,255,0.08));background:var(--bmm-s03,rgba(255,255,255,0.03));color:var(--text-secondary);" />
                                    <div style="display:flex;align-items:center;gap:6px;margin:0 0 4px 22px;font-size:9px;color:var(--text-muted);font-family:var(--font-mono);">
                                        <span>repo_mod_id:</span>
                                        <span style="color:var(--text-secondary);user-select:all;">${escHtml(m.id)}</span>
                                        <button type="button" class="repo-up-copy-id" data-mid="${escAttr(m.id)}" title="${escAttr(t('common.copy') || 'Copy')}" style="border:none;background:rgba(255,255,255,0.06);color:var(--text-secondary);border-radius:3px;padding:1px 5px;cursor:pointer;font-size:9px;">${t('common.copy') || 'Copy'}</button>
                                    </div>
                                </div>`).join('') || `<div style="font-size:11px;color:var(--text-muted);">${t('repo.update.noMods') || 'No mods in this profile'}</div>`}`;
                            box.dataset.loaded = '1';
                            // Selecting any mod auto-checks the profile
                            const profCb = addEl.querySelector(`.repo-up-add-profile[data-pid="${pid}"]`);
                            box.querySelectorAll('.repo-up-add-mod').forEach(cb => cb.addEventListener('change', () => { if (profCb)
                                profCb.checked = true; }));
                            box.querySelectorAll('.repo-up-copy-id').forEach(b => b.addEventListener('click', (e) => {
                                e.preventDefault();
                                navigator.clipboard?.writeText(b.dataset.mid || '').then(() => {
                                    toast(t('repo.update.idCopied') || 'repo_mod_id copied', 'success');
                                }).catch(() => { });
                            }));
                        }
                        catch (e) {
                            box.innerHTML = `<div style="font-size:11px;color:var(--danger);">${escHtml(String(e))}</div>`;
                        }
                    }
                });
            });
        };
        btnOpen.addEventListener('click', async () => {
            await attachListener();
            modal.classList.add('open');
            // If an update is still running from before, keep showing its progress
            if (_ru.running || _ru.done) {
                repoDir = _ru.repoDir;
                pathInput.value = _ru.repoDir;
                syncProgressUI();
            }
            else {
                repoDir = '';
                pathInput.value = '';
                contentEl.style.display = 'none';
                progressEl.style.display = 'none';
                btnApply.disabled = true;
            }
        });
        btnPick?.addEventListener('click', async () => {
            const folder = await pickFolder().catch(() => null);
            if (!folder)
                return;
            try {
                const repo = await invoke('read_local_repo', { repoDir: folder });
                repoDir = folder;
                pathInput.value = folder;
                _ru.done = false;
                progressEl.style.display = 'none';
                await renderLoaded(repo);
            }
            catch (e) {
                toast(t('repo.update.errNoRepo') || 'No valid repo.json found in this folder', 'error');
            }
        });
        btnApply?.addEventListener('click', async () => {
            if (!repoDir || _ru.running)
                return;
            const removeProfileIds = Array.from(currentEl.querySelectorAll('.repo-up-rm-profile'))
                .filter(b => b.dataset.removed === '1')
                .map(b => b.dataset.pid);
            const removeModIds = Array.from(currentEl.querySelectorAll('.repo-up-keep-mod'))
                .filter(cb => !cb.checked)
                .map(cb => cb.dataset.mid);
            // Build add_profiles with per-mod selection
            const addProfiles = Array.from(addEl.querySelectorAll('.repo-up-add-profile'))
                .filter(cb => cb.checked)
                .map(cb => {
                const pid = cb.dataset.pid;
                const modCbs = Array.from(addEl.querySelectorAll(`.repo-up-add-mod[data-pid="${pid}"]`));
                // If the mod list was expanded, honour the per-mod selection; else add all (null)
                let modIds = null;
                if (modCbs.length) {
                    const checked = modCbs.filter(m => m.checked).map(m => m.dataset.mid);
                    // null = all; only send a subset if not everything is checked
                    if (checked.length !== modCbs.length)
                        modIds = checked;
                }
                return { profile_id: pid, mod_ids: modIds };
            });
            if (!removeProfileIds.length && !removeModIds.length && !addProfiles.length) {
                toast(t('repo.update.noChanges') || 'No changes selected', 'warning');
                return;
            }
            // Per-mod author changelogs (only for mods actually being added/updated)
            const addedModIds = new Set();
            addProfiles.forEach(p => {
                const cbs = addEl.querySelectorAll(`.repo-up-add-mod[data-pid="${p.profile_id}"]`);
                if (!cbs.length || p.mod_ids === null) {
                    // whole profile → include every expanded mod row + leave room for non-expanded
                    cbs.forEach(cb => { if (cb.checked)
                        addedModIds.add(cb.dataset.mid); });
                }
                else {
                    p.mod_ids.forEach(id => addedModIds.add(id));
                }
            });
            const modChangelogs = {};
            addEl.querySelectorAll('.repo-up-mod-changelog').forEach(inp => {
                const mid = inp.dataset.mid;
                const val = inp.value.trim();
                if (val && addedModIds.has(mid))
                    modChangelogs[mid] = val;
            });
            const authorName = localStorage.getItem('bmm_last_author') || '';
            _ru.running = true;
            _ru.done = false;
            _ru.percent = 0;
            _ru.status = t('repo.update.starting') || 'Starting…';
            _ru.repoDir = repoDir;
            _ru.summary = '';
            syncProgressUI();
            try {
                const res = await invoke('update_server_repo', {
                    repoDir,
                    authorName: authorName || null,
                    ops: { remove_mod_ids: removeModIds, remove_profile_ids: removeProfileIds, add_profiles: addProfiles, mod_changelogs: modChangelogs }
                });
                _ru.running = false;
                _ru.done = true;
                _ru.percent = 100;
                _ru.summary = `${t('repo.update.done') || 'Repo updated'} — +${res.mods_added} / ~${res.mods_updated} / -${res.mods_removed}`;
                syncProgressUI();
                toast(_ru.summary, 'success');
                // Reload the modal content to reflect the new post-update state
                await reloadCurrentRepo();
            }
            catch (e) {
                _ru.running = false;
                _ru.done = false;
                syncProgressUI();
                const msg = String(e);
                toast(msg.includes('cancel') ? (t('repo.cancelled') || 'Cancelled') : msg, msg.includes('cancel') ? 'info' : 'error');
                // Even after a cancel, reload to show whatever state the repo is in
                await reloadCurrentRepo();
            }
        });
        // Cancel the running update (sets the shared cancel flag; the Rust loop
        // checks it per-file so it stops quickly without freezing).
        btnCancel?.addEventListener('click', () => {
            invoke('cancel_repo_export').catch(() => { });
            _ru.status = t('repo.cancelling') || 'Cancelling…';
            syncProgressUI();
        });
        // Closing the modal does NOT cancel the running update.
        modal.addEventListener('click', (e) => { if (e.target === modal)
            modal.classList.remove('open'); });
        // ── Listen for API-driven pre-load (from bmm:repo-focus section='update') ──
        // When the API quicktest drives this modal, it emits this event after opening.
        document.addEventListener('bmm:repo-update-loaded', async (e) => {
            const { repo, repoDir: apiDir } = e.detail || {};
            if (!repo || !apiDir)
                return;
            repoDir = apiDir;
            pathInput.value = apiDir;
            _ru.done = false;
            progressEl.style.display = 'none';
            await renderLoaded(repo);
        });
    };
    initRepoUpdate();
    // ── Repo Hub (multi-repo Node server) ──
    const initRepoHub = () => {
        const modal = document.getElementById('modal-repo-hub');
        const btnOpen = document.getElementById('btn-open-repo-hub');
        const pathInput = document.getElementById('repo-hub-path');
        const btnPick = document.getElementById('btn-pick-repo-hub-folder');
        const listEl = document.getElementById('repo-hub-list');
        const btnGen = document.getElementById('btn-generate-repo-hub');
        const resultEl = document.getElementById('repo-hub-result');
        if (!modal || !btnOpen)
            return;
        let hubDir = '';
        const fmt = (b) => { if (!b)
            return '0 B'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.floor(Math.log(b) / Math.log(1024)); return (b / Math.pow(1024, i)).toFixed(1) + ' ' + u[i]; };
        btnOpen.addEventListener('click', () => {
            hubDir = '';
            pathInput.value = '';
            listEl.style.display = 'none';
            listEl.innerHTML = '';
            resultEl.style.display = 'none';
            btnGen.disabled = true;
            modal.classList.add('open');
        });
        btnPick?.addEventListener('click', async () => {
            const folder = await pickFolder().catch(() => null);
            if (!folder)
                return;
            hubDir = folder;
            pathInput.value = folder;
            resultEl.style.display = 'none';
            try {
                const repos = await invoke('scan_repo_hub', { hubDir: folder });
                if (!repos.length) {
                    listEl.innerHTML = `<div style="font-size:12px;color:var(--text-muted);padding:8px;">${t('repo.hub.none') || 'No repos found in this folder. Each repo must be its own sub-folder with a repo.json.'}</div>`;
                }
                else {
                    listEl.innerHTML = `<div style="font-size:12px;font-weight:700;color:var(--text-secondary);margin-bottom:8px;">${repos.length} ${t('repo.hub.found') || 'repos found'}</div>` +
                        repos.map(r => `
                        <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px;gap:12px;">
                            <div style="flex:1; display:flex; align-items:center; gap:10px; min-width:0;">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" stroke-width="2" style="flex-shrink:0;">
                                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                                </svg>
                                <div style="flex:1; min-width:0;">
                                    <div style="font-size:12px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(r.name)}</div>
                                    <div style="font-size:10px;color:var(--text-muted);font-family:var(--font-mono);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" data-repo-path="${escAttr(folder)}/${r.folder === '.' ? '' : escAttr(r.folder) + '/'}repo.json">${r.folder === '.' ? '(hub root)' : escHtml(r.folder)}/repo.json</div>
                                </div>
                            </div>
                            <div style="display:flex; gap:8px; align-items:center; flex-shrink:0;">
                                <button class="repo-hub-copy-btn" data-path="${escAttr(folder)}/${r.folder === '.' ? '' : escAttr(r.folder) + '/'}repo.json" data-folder="${escAttr(r.folder)}" style="padding:6px 10px;font-size:11px;background:rgba(6,182,212,0.15);color:var(--cyan);border:1px solid rgba(6,182,212,0.3);border-radius:6px;cursor:pointer;white-space:nowrap;transition:all 0.15s;" onmouseenter="this.style.background='rgba(6,182,212,0.25)';window.showTaskyHelp('repo.hub.copyPath','copy')" onmouseleave="this.style.background='rgba(6,182,212,0.15)';window.hideTaskyHelp()">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;margin-right:4px;vertical-align:-1px;">
                                        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                                        <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                                    </svg>
                                    Copy
                                </button>
                                <span style="font-size:11px;color:var(--text-muted);white-space:nowrap;">${r.profiles} prof · ${r.mods} mods · ${fmt(r.size)}</span>
                            </div>
                        </div>`).join('');
                    // Add event listeners to copy buttons
                    document.querySelectorAll('.repo-hub-copy-btn').forEach(btn => {
                        btn.addEventListener('click', async () => {
                            const path = btn.getAttribute('data-path');
                            if (path) {
                                navigator.clipboard.writeText(path);
                                toast(t('common.copied') || 'Copied!', 'success');
                            }
                        });
                    });
                }
                listEl.style.display = 'flex';
                btnGen.disabled = false;
            }
            catch (e) {
                listEl.innerHTML = `<div style="font-size:12px;color:var(--danger);padding:8px;">${escHtml(String(e))}</div>`;
                listEl.style.display = 'flex';
                btnGen.disabled = true;
            }
        });
        // Highlight selected mode card
        document.querySelectorAll('input[name="repo-hub-mode"]').forEach(r => {
            r.addEventListener('change', () => {
                document.querySelectorAll('.repo-hub-mode-opt').forEach(l => {
                    const inp = l.querySelector('input');
                    l.style.borderColor = inp.checked ? 'var(--cyan)' : 'var(--border)';
                });
            });
        });
        btnGen?.addEventListener('click', async () => {
            if (!hubDir)
                return;
            const port = parseInt(document.getElementById('repo-hub-port').value) || 8080;
            const limit = parseInt(document.getElementById('repo-hub-limit').value) || 0;
            const adminPassword = document.getElementById('repo-hub-adminpw')?.value?.trim() || null;
            const mode = document.querySelector('input[name="repo-hub-mode"]:checked')?.value || 'serve';
            const serve = mode === 'serve';
            btnGen.disabled = true;
            try {
                await invoke('generate_repo_hub', { hubDir, port, uploadLimit: limit, serve, adminPassword });
                if (serve) {
                    resultEl.innerHTML = `
                        ✓ ${t('repo.hub.done') || 'Hub server generated!'}<br>
                        <span style="color:var(--text-secondary)">${t('repo.hub.runHint') || 'Run'} <code style="background:rgba(0,0,0,0.3);padding:1px 6px;border-radius:4px;">Start-Hub.bat</code> / <code style="background:rgba(0,0,0,0.3);padding:1px 6px;border-radius:4px;">start-hub.sh</code>.<br>${t('repo.hub.dashHint') || 'Dashboard:'} <code style="background:rgba(0,0,0,0.3);padding:1px 6px;border-radius:4px;">http://&lt;ip&gt;:${port}/</code> · ${t('repo.hub.perRepo') || 'each repo has its own page'}</span>`;
                }
                else {
                    resultEl.innerHTML = `
                        ✓ ${t('repo.hub.doneStatic') || 'Static directory generated!'}<br>
                        <span style="color:var(--text-secondary)">${t('repo.hub.staticHint') || 'Edit'} <code style="background:rgba(0,0,0,0.3);padding:1px 6px;border-radius:4px;">hub-repos.json</code> ${t('repo.hub.staticHint2') || 'to fill each repo URL, then host this folder anywhere (open index.html).'}</span>`;
                }
                resultEl.style.display = 'block';
                toast(serve ? (t('repo.hub.done') || 'Hub server generated!') : (t('repo.hub.doneStatic') || 'Static directory generated!'), 'success');
            }
            catch (e) {
                toast(String(e), 'error');
            }
            finally {
                btnGen.disabled = false;
            }
        });
        modal.addEventListener('click', (e) => { if (e.target === modal)
            modal.classList.remove('open'); });
    };
    initRepoHub();
    const saveHostHistory = (path) => {
        try {
            let paths = JSON.parse(localStorage.getItem('bmm_repo_history_host') || '[]');
            paths = paths.filter(p => p !== path);
            paths.unshift(path);
            if (paths.length > 10)
                paths.length = 10;
            localStorage.setItem('bmm_repo_history_host', JSON.stringify(paths));
            loadHostHistory();
        }
        catch (e) { }
    };
    const loadHostHistory = () => {
        try {
            const paths = JSON.parse(localStorage.getItem('bmm_repo_history_host') || '[]');
            if (elements.hostHistorySelect) {
                if (paths.length > 0) {
                    if (elements.hostHistoryContainer)
                        elements.hostHistoryContainer.style.display = 'block';
                    elements.hostHistorySelect.innerHTML = `<option value="">${t('repo.hostHistoryDefault')}</option>` +
                        paths.map(p => `<option value="${escAttr(p)}">${escHtml(p)}</option>`).join('');
                }
                else if (elements.hostHistoryContainer) {
                    elements.hostHistoryContainer.style.display = 'none';
                }
            }
        }
        catch (e) { }
    };
    loadHostHistory();
    const previewHostRepo = async (path) => {
        if (!path) {
            if (elements.hostMetadataPreview)
                elements.hostMetadataPreview.style.display = 'none';
            return;
        }
        const hostInput = document.getElementById('repo-host-path');
        if (hostInput)
            hostInput.value = path;
        try {
            if (window.__TAURI__) {
                const content = await invoke('read_file_text', { path: path + '/repo.json' });
                const repo = JSON.parse(content);
                const pCount = repo.profiles ? repo.profiles.length : 0;
                const pNames = repo.profiles ? repo.profiles.map(p => p.name).join(', ') : '';
                let totalSize = 0;
                if (repo.profiles) {
                    repo.profiles.forEach(p => {
                        if (p.mods)
                            p.mods.forEach(m => {
                                if (m.files)
                                    m.files.forEach(f => totalSize += f.size);
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
        }
        catch (err) {
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
    // Re-render these JS-built lists on language change so their labels
    // (empty states, game names, share-mode options) translate live without a refresh.
    document.addEventListener('langChanged', () => {
        loadProfilesForExport(elements.profilesListEl);
        loadModpacksForExport(elements.modpacksListEl);
    });
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
                        const content = await invoke('read_file_text', { path: folder + '/repo.json' });
                        const repo = JSON.parse(content);
                        if (repo.seed && elements.inputExportSeed) {
                            elements.inputExportSeed.value = repo.seed;
                            toast(t('repo.seedDetected'), 'info');
                        }
                    }
                }
                catch (e) {
                    if (elements.inputExportSeed)
                        elements.inputExportSeed.value = '';
                }
            }
        });
    }
    const btnPickRepoHost = document.getElementById('btn-pick-repo-host');
    if (btnPickRepoHost)
        btnPickRepoHost.onclick = async () => {
            const folder = await pickFolder();
            if (folder)
                previewHostRepo(folder);
        };
    if (elements.btnPickSyncGame)
        elements.btnPickSyncGame.onclick = async () => { const f = await pickFolder(); if (f)
            elements.inputSyncGamePath.value = f; };
    if (elements.btnPickSyncMods)
        elements.btnPickSyncMods.onclick = async () => { const f = await pickFolder(); if (f)
            elements.inputSyncModsPath.value = f; };
    if (elements.btnPickSyncBackup)
        elements.btnPickSyncBackup.onclick = async () => { const f = await pickFolder(); if (f)
            elements.inputSyncBackupPath.value = f; };
    // --- Creator ID ---
    const initCreatorId = async () => {
        try {
            const creatorId = await invoke('get_creator_id');
            if (elements.repoCreatorIdValue)
                elements.repoCreatorIdValue.textContent = creatorId;
            if (elements.repoCreatorIdContainer)
                elements.repoCreatorIdContainer.style.display = 'block';
        }
        catch (err) {
            console.error("Failed to load Creator ID:", err);
        }
    };
    initCreatorId();
    // Copy-my-creator-id button (was unwired → copied nothing).
    const btnCopyCreator = document.getElementById('btn-copy-my-creator-id');
    if (btnCopyCreator && !btnCopyCreator.dataset.wired) {
        btnCopyCreator.dataset.wired = '1';
        btnCopyCreator.addEventListener('click', async () => {
            let id = elements.repoCreatorIdValue?.textContent?.trim() || '';
            if (!id || id === '…') {
                try {
                    id = await invoke('get_creator_id');
                }
                catch { }
            }
            if (!id) {
                toast(t('repo.errNoCreatorId') || 'Creator ID not ready', 'warning');
                return;
            }
            try {
                await navigator.clipboard.writeText(id);
                toast(t('repo.creatorIdCopied') || 'Creator ID copied', 'success');
            }
            catch {
                toast(t('common.error') || 'Copy failed', 'error');
            }
        });
    }
    // --- Export process ---
    if (elements.btnStartExport) {
        elements.btnStartExport.addEventListener('click', async () => {
            const outPath = elements.inputExportPath.value.trim();
            const authorName = elements.inputExportAuthor ? elements.inputExportAuthor.value.trim() : "";
            if (!outPath)
                return toast(t('repo.errNoOutDir'), 'warning');
            if (!authorName) {
                toast(t('repo.errNoAuthor'), 'warning');
                elements.inputExportAuthor?.focus();
                return;
            }
            const safeAuthor = authorName.slice(0, 25); // creator name capped at 25 chars
            localStorage.setItem('bmm_last_author', safeAuthor);
            // Telemetry (opt-in): the team tracks every creator name a user hosts under.
            try {
                const { track } = await import('../../core/analytics.js');
                track('repo_host', { creator_name: safeAuthor });
            }
            catch { }
            const cbs = document.querySelectorAll('.repo-profile-cb:checked');
            const profileIds = Array.from(cbs).map(c => c.value);
            if (profileIds.length === 0)
                return toast(t('repo.errNoProfile'), 'warning');
            let unlisten;
            try {
                // Mark the API guard busy so external API gen calls are rejected.
                try {
                    invoke('set_repo_busy', { kind: 'gen', busy: true });
                }
                catch (_) { }
                elements.btnStartExport.disabled = true;
                elements.exportProgressContainer.style.display = 'block';
                elements.exportStatus.textContent = t('repo.exporting');
                // Reset progress bar from any previous run (otherwise the >= guard
                // below keeps it stuck at the old 100%).
                if (elements.exportPercent)
                    elements.exportPercent.textContent = '0%';
                if (elements.exportFill)
                    elements.exportFill.style.width = '0%';
                if (elements.btnCancelExport) {
                    elements.btnCancelExport.style.display = 'flex';
                    elements.btnCancelExport.disabled = false;
                }
                if (window.__TAURI__) {
                    const { listen } = window.__TAURI__.event;
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
                        if (step)
                            elements.exportStatus.textContent = t(step) || step;
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
            }
            catch (err) {
                const errMsg = String(err);
                const isCancel = errMsg.includes('cancel');
                elements.exportStatus.textContent = isCancel ? t('repo.cancelled') : t('repo.exportError');
                if (!isCancel)
                    toast(errMsg, 'error');
            }
            finally {
                elements.btnStartExport.disabled = false;
                if (elements.btnCancelExport)
                    elements.btnCancelExport.style.display = 'none';
                if (unlisten)
                    unlisten();
                // Release the API "generation in progress" guard.
                try {
                    invoke('set_repo_busy', { kind: 'gen', busy: false });
                }
                catch (_) { }
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
            }
            catch (e) { }
        };
    }
    const lastAuthor = localStorage.getItem('bmm_last_author');
    if (lastAuthor && elements.inputExportAuthor)
        elements.inputExportAuthor.value = lastAuthor;
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
//# sourceMappingURL=repo.js.map