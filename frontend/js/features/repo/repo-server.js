// @ts-nocheck
import { invoke } from '../../core/api.js';
import { toast } from '../../ui/app.js';
import { t } from '../../core/i18n.js';
import { copyToClipboard } from './repo.js';
export function initRepoServer(elements) {
    const { btnToggleServer, urlContainerServer, urlInputServer, btnCopyUrlServer, serverStatusDot, serverStatusLabel, publicSection, publicUrlInput, btnCopyPublicUrl, upnpBadgeStatus, publicHintBox, repoCreatorIdContainer, repoCreatorIdValue, tunnelSection, tunnelUrlInput, btnCopyTunnelUrl, inputServerPort, inputServerUploadLimit, serverTools, btnGenMiniServer, btnPickMiniRepo, btnPickMiniFolder, inputMiniRepoPath, cbAutoStart, inputMiniServerUploadLimit, inputExportPath } = elements;
    let isServerRunning = false;
    // --- Host Server toggle ---
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
                    if (serverStatusLabel)
                        serverStatusLabel.textContent = t('repo.serverOffline') || 'Serveur hors ligne';
                    if (inputServerPort)
                        inputServerPort.disabled = false;
                    if (serverTools)
                        serverTools.style.display = 'none';
                    if (repoCreatorIdContainer)
                        repoCreatorIdContainer.style.display = 'none';
                    toast(t('repo.hostServerStopped') || "Serveur arrêté", "success");
                }
                catch (err) {
                    toast(String(err), "error");
                }
            }
            else {
                const hostPathInput = document.getElementById('repo-host-path');
                let path = hostPathInput ? hostPathInput.value.trim() : "";
                if (!path && inputExportPath)
                    path = inputExportPath.value.trim();
                if (!path) {
                    toast(t('repo.hostServerStartReq') || "Veuillez d'abord sélectionner un dossier de dépôt à héberger.", "warning");
                    return;
                }
                try {
                    const loadingBar = document.getElementById('repo-server-loading-bar');
                    if (loadingBar)
                        loadingBar.style.display = 'block';
                    btnToggleServer.disabled = true;
                    btnToggleServer.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 1s linear infinite;margin-right:8px"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> <span>${t('repo.initServer') || 'Initialisation...'}</span>`;
                    const port = parseInt(inputServerPort ? inputServerPort.value : "8000") || 8000;
                    if (inputServerPort)
                        inputServerPort.disabled = true;
                    const uploadLimit = parseInt(inputServerUploadLimit ? inputServerUploadLimit.value : "0") || 0;
                    const result = await invoke('start_repo_server', { path, port, uploadLimit });
                    isServerRunning = true;
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
                    if (serverStatusLabel)
                        serverStatusLabel.textContent = t('repo.serverOnline', { port }) || `Serveur en ligne — port ${port}`;
                    urlInputServer.value = result.lan_url;
                    if (result.seed && repoCreatorIdValue && repoCreatorIdContainer) {
                        try {
                            const saltedId = await invoke('get_salted_creator_id', { salt: result.seed });
                            repoCreatorIdValue.textContent = saltedId;
                            repoCreatorIdContainer.style.display = 'block';
                            const label = repoCreatorIdContainer.querySelector('label');
                            if (label)
                                label.textContent = t('repo.yourServerId') || "Votre ID sur ce serveur";
                        }
                        catch (e) {
                            console.error("Failed to get salted ID:", e);
                        }
                    }
                    if (result.public_url) {
                        publicUrlInput.value = result.public_url;
                        publicSection.style.display = 'block';
                        if (publicHintBox)
                            publicHintBox.style.display = 'none';
                        if (upnpBadgeStatus) {
                            if (result.upnp_success) {
                                upnpBadgeStatus.style.background = 'rgba(46, 204, 113, 0.2)';
                                upnpBadgeStatus.style.color = '#2ecc71';
                                upnpBadgeStatus.textContent = t('repo.upnpOk') || 'UPnP OK';
                            }
                            else {
                                upnpBadgeStatus.style.background = 'rgba(231, 76, 60, 0.2)';
                                upnpBadgeStatus.style.color = '#e74c3c';
                                upnpBadgeStatus.textContent = t('repo.upnpFail') || 'UPnP FAIL';
                            }
                        }
                    }
                    else {
                        if (publicSection)
                            publicSection.style.display = 'none';
                        if (publicHintBox)
                            publicHintBox.style.display = 'block';
                    }
                    if (result.tunnel_url) {
                        tunnelUrlInput.value = result.tunnel_url;
                        tunnelSection.style.display = 'block';
                    }
                    else {
                        if (tunnelSection)
                            tunnelSection.style.display = 'none';
                    }
                    urlContainerServer.style.display = "flex";
                    if (serverTools)
                        serverTools.style.display = 'flex';
                    toast(t('repo.hostServerStarted') || "Serveur démarré !", "success");
                }
                catch (err) {
                    const errMsg = String(err);
                    toast(t(errMsg) || errMsg, "error");
                    if (inputServerPort)
                        inputServerPort.disabled = false;
                    btnToggleServer.innerHTML = '<span id="repo-server-btn-text"></span>';
                    const txt = btnToggleServer.querySelector('#repo-server-btn-text');
                    txt.textContent = t('repo.hostStart') || "▶ Démarrer le serveur";
                }
                finally {
                    btnToggleServer.disabled = false;
                    const loadingBar = document.getElementById('repo-server-loading-bar');
                    if (loadingBar)
                        loadingBar.style.display = 'none';
                }
            }
        });
    }
    if (btnCopyUrlServer) {
        btnCopyUrlServer.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(urlInputServer.value);
                toast(t('repo.urlCopied') || "URL copiée dans le presse-papier", "success");
            }
            catch (e) {
                toast(t('repo.urlCopyError') || "Erreur lors de la copie", "error");
            }
        });
    }
    if (btnCopyPublicUrl) {
        btnCopyPublicUrl.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(publicUrlInput.value);
                toast(t('repo.urlCopied') || "URL copiée dans le presse-papier", "success");
            }
            catch (e) {
                toast(t('repo.urlCopyError') || "Erreur lors de la copie", "error");
            }
        });
    }
    if (btnCopyTunnelUrl) {
        btnCopyTunnelUrl.addEventListener('click', () => copyToClipboard(tunnelUrlInput.value));
    }
    // --- Restore Server Status ---
    const restoreServerStatus = async () => {
        try {
            const status = await invoke('get_repo_server_status');
            if (status) {
                isServerRunning = true;
                const btnTxt = btnToggleServer.querySelector('#repo-server-btn-text');
                if (btnTxt)
                    btnTxt.textContent = t('repo.hostStop') || "⏹ Arrêter le serveur";
                btnToggleServer.style.background = "rgba(231, 76, 60, 0.1)";
                btnToggleServer.style.color = "#e74c3c";
                btnToggleServer.style.borderColor = "rgba(231, 76, 60, 0.2)";
                if (serverStatusDot) {
                    serverStatusDot.style.background = '#2ecc71';
                    serverStatusDot.style.boxShadow = '0 0 8px #2ecc71';
                }
                if (serverStatusLabel)
                    serverStatusLabel.textContent = t('repo.serverOnline') || 'Serveur en ligne — port 8000';
                urlInputServer.value = status.lan_url;
                if (status.public_url) {
                    publicUrlInput.value = status.public_url;
                    publicSection.style.display = 'block';
                    if (publicHintBox)
                        publicHintBox.style.display = 'none';
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
                if (serverTools)
                    serverTools.style.display = 'flex';
            }
        }
        catch (err) {
            console.error("[BMM] restoreServerStatus error:", err);
        }
    };
    restoreServerStatus();
    // --- Mini-Server Generation ---
    if (btnPickMiniRepo) {
        btnPickMiniRepo.addEventListener('click', async () => {
            const { pickFile } = await import('../../core/api.js');
            const path = await pickFile(['json']);
            if (path) {
                inputMiniRepoPath.value = path;
                localStorage.setItem('bmm_last_mini_repo_json', path);
            }
        });
    }
    if (btnPickMiniFolder) {
        btnPickMiniFolder.addEventListener('click', async () => {
            const { pickFolder } = await import('../../core/api.js');
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
        if (last)
            inputMiniRepoPath.value = last;
    }
    if (btnGenMiniServer) {
        btnGenMiniServer.addEventListener('click', async () => {
            let jsonPath = inputMiniRepoPath ? inputMiniRepoPath.value.trim() : '';
            if (!jsonPath) {
                const hostPathInput = document.getElementById('repo-host-path');
                const fallbackDir = ((hostPathInput ? hostPathInput.value : "") || inputExportPath.value).trim();
                if (fallbackDir) {
                    jsonPath = fallbackDir.endsWith('.json') ? fallbackDir : (fallbackDir.endsWith('\\') || fallbackDir.endsWith('/') ? fallbackDir + 'repo.json' : fallbackDir + '/repo.json');
                }
            }
            if (!jsonPath)
                return toast(t('repo.errNoOutDir'), 'warning');
            const miniPortInput = document.getElementById('repo-mini-server-port');
            const port = parseInt(miniPortInput ? miniPortInput.value : "8000") || 8000;
            const autoStart = cbAutoStart ? cbAutoStart.checked : false;
            const useCloudflare = document.getElementById('repo-mini-server-cloudflare').checked;
            const useUpnp = document.getElementById('repo-mini-server-upnp').checked;
            const lang = localStorage.getItem('bmm-lang') || 'en';
            try {
                btnGenMiniServer.disabled = true;
                const uploadLimit = parseInt(inputMiniServerUploadLimit ? inputMiniServerUploadLimit.value : "0") || 0;
                await invoke('generate_standalone_server', {
                    payload: {
                        repoPath: jsonPath, port, autoStart, useCloudflare, useUpnp, lang, uploadLimit
                    }
                });
                toast(t('repo.miniServerSuccess') || "Scripts du serveur autonome générés ! (Lancer-Serveur.bat)", "success");
            }
            catch (err) {
                const errMsg = String(err);
                toast(t(errMsg) || errMsg, "error");
            }
            finally {
                btnGenMiniServer.disabled = false;
                btnGenMiniServer.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><path d="M12 5v14M5 12h14"/></svg> <span data-i18n="repo.miniServerGenerate">${t('repo.miniServerGenerate') || 'Générer le Serveur'}</span>`;
            }
        });
    }
    return {
        getIsServerRunning: () => isServerRunning
    };
}
//# sourceMappingURL=repo-server.js.map