/**
 * deep_link_manager.js
 * Handles bmm:// protocol links for one-click mod installation.
 */

import { invoke } from './api.js';
import { toast } from './app.js';
import { t } from './i18n.js';
import { refreshMods } from './mods.js';
import { escHtml } from './utils.js';

/**
 * Initializes the deep link listener.
 * Listens for 'deep-link-received' events from the Rust backend.
 */
export async function initDeepLinks() {
    console.log('[BMM] Initializing Deep Link Manager...');
    
    const { listen } = window.__TAURI__.event;

    // 1. Listen for future deep links (if app is already open)
    await listen('deep-link-received', async (event) => {
        handleDeepLink(event.payload);
    });

    // 2. Check for pending deep link from startup
    try {
        const pending = await invoke('get_pending_deep_link');
        if (pending) {
            console.log('[BMM] Found pending deep link from startup:', pending);
            // Small delay to ensure UI is ready (modals, toasts)
            setTimeout(() => handleDeepLink(pending), 500);
        }
    } catch (e) {
        console.error('[BMM] Failed to fetch pending deep link:', e);
    }
}

/**
 * Common handler for deep link URLs
 */
async function handleDeepLink(urlStr) {
    if (!urlStr || !urlStr.startsWith('bmm://')) return;

    console.log('[BMM] Processing deep link:', urlStr);
    toast(`Deep Link: ${urlStr.split('?')[0]}`, 'info');
    
    try {
        // Standardize URL for parsing (bmm://import?url=... -> https://bmm.local/import?url=...)
        const parsedUrl = new URL(urlStr.replace('bmm://', 'https://bmm.local/'));
        // Remove leading and trailing slashes to be robust (e.g. /import/ -> import)
        const action = parsedUrl.pathname.replace(/^\/|\/$/g, ''); 
        
        if (action === 'import' || action === 'install' || action === 'download') {
            const modUrl = parsedUrl.searchParams.get('url');
            const modNameFromUrl = parsedUrl.searchParams.get('name') || t('mod.unknownName') || 'Mod Inconnu';
            
            if (!modUrl) {
                console.warn('[BMM] Deep link missing "url" parameter:', urlStr);
                return;
            }

            // Fetch profiles to allow selection
            let profiles = [];
            let activeId = null;
            try {
                [profiles, activeId] = await Promise.all([
                    invoke('get_profiles'),
                    invoke('get_active_profile_id')
                ]);
            } catch (err) {
                console.error('[BMM] Failed to fetch profiles for deep link:', err);
            }

            // Show confirmation modal via Tasky with custom inputs
            const title = t('mod.importTitle') || 'Installation en 1 clic';
            const descTemplate = t('mod.importConfirmDesc') || 'Voulez-vous télécharger et installer <strong>{name}</strong> ?';
            const desc = descTemplate.replace('{name}', modNameFromUrl);

            const customContent = `
                <div class="confirm-import-container" style="display:flex; flex-direction:column; gap:12px; margin-top:12px; text-align:left;">
                    <p style="font-size:13px; margin-bottom:4px; line-height:1.4;">${desc}</p>
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        <label style="font-size:10px; font-weight:700; text-transform:uppercase; color:var(--text-secondary); opacity:0.8; letter-spacing:0.05em;">${t('mod.importNameLabel') || 'Nom du mod'}</label>
                        <input type="text" id="import-mod-name" class="input" value="${escHtml(modNameFromUrl)}" 
                            style="width:100%; padding:10px; background:rgba(0,0,0,0.3); border:1px solid var(--border); border-radius:6px; color:var(--text-primary); font-size:13px; font-family:inherit;">
                    </div>
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        <label style="font-size:10px; font-weight:700; text-transform:uppercase; color:var(--text-secondary); opacity:0.8; letter-spacing:0.05em;">${t('mod.importProfileLabel') || 'Profil de destination'}</label>
                        <select id="import-mod-profile" class="select" 
                            style="width:100%; padding:10px; background:rgba(0,0,0,0.3); border:1px solid var(--border); border-radius:6px; color:var(--text-primary); font-size:13px; font-family:inherit; cursor:pointer;">
                            ${profiles.map(p => `<option value="${p.id}" ${p.id === activeId ? 'selected' : ''}>${escHtml(p.name)}</option>`).join('')}
                            <option value="NEW" style="color:var(--accent); font-weight:700;">+ ${t('mod.importProfileNew') || 'Créer un nouveau profil...'}</option>
                        </select>
                    </div>

                    <!-- New Profile Fields (Hidden by default) -->
                    <div id="new-profile-fields" style="display:none; flex-direction:column; gap:10px; padding:12px; background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:8px; margin-top:4px;">
                        <div style="display:flex; flex-direction:column; gap:4px;">
                            <label style="font-size:9px; font-weight:800; text-transform:uppercase; color:var(--accent); opacity:0.8;">${t('prof.nameLabel') || 'Nom du profil'}</label>
                            <input type="text" id="new-prof-name" class="input" placeholder="Ex: DCS World 2.9" style="width:100%; padding:8px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:4px; font-size:12px; color:white;">
                        </div>
                        
                        <div style="display:flex; flex-direction:column; gap:4px;">
                            <label style="font-size:9px; font-weight:800; text-transform:uppercase; color:var(--text-secondary);">${t('prof.gameDirLabel') || 'Répertoire du jeu'}</label>
                            <div style="display:flex; gap:6px;">
                                <input type="text" id="new-prof-game-path" class="input" readonly style="flex:1; padding:8px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:4px; font-size:11px; color:var(--text-muted);">
                                <button class="btn btn-sm btn-secondary" id="btn-pick-import-game" style="padding:0 10px; height:32px; font-size:11px;">${t('common.browse') || '...'}</button>
                            </div>
                        </div>

                        <div style="display:flex; flex-direction:column; gap:4px;">
                            <label style="font-size:9px; font-weight:800; text-transform:uppercase; color:var(--text-secondary);">${t('prof.modsDirLabel') || 'Dossier des mods'}</label>
                            <div style="display:flex; gap:6px;">
                                <input type="text" id="new-prof-mods-path" class="input" readonly style="flex:1; padding:8px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:4px; font-size:11px; color:var(--text-muted);">
                                <button class="btn btn-sm btn-secondary" id="btn-pick-import-mods" style="padding:0 10px; height:32px; font-size:11px;">${t('common.browse') || '...'}</button>
                            </div>
                        </div>

                        <div style="display:flex; flex-direction:column; gap:4px;">
                            <label style="font-size:9px; font-weight:800; text-transform:uppercase; color:var(--text-secondary);">${t('prof.backupDirLabel') || 'Dossier de sauvegarde'}</label>
                            <div style="display:flex; gap:6px;">
                                <input type="text" id="new-prof-backup-path" class="input" readonly style="flex:1; padding:8px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:4px; font-size:11px; color:var(--text-muted);">
                                <button class="btn btn-sm btn-secondary" id="btn-pick-import-backup" style="padding:0 10px; height:32px; font-size:11px;">${t('common.browse') || '...'}</button>
                            </div>
                        </div>
                    </div>

                    <div style="font-size:10px; opacity:0.4; word-break:break-all; margin-top:8px; font-family:var(--font-mono); border-top:1px solid rgba(255,255,255,0.05); padding-top:8px;">${escHtml(modUrl)}</div>
                </div>
            `;

            // Start the confirmation modal
            const confirmPromise = window.confirmCustom(
                title,
                customContent,
                'accent',
                { 
                    yesLabel: t('common.yes') || 'Installer', 
                    noLabel: t('common.no') || 'Annuler' 
                }
            );

            // Execute logic after modal is open
            setTimeout(() => {
                const select = document.getElementById('import-mod-profile');
                const newFields = document.getElementById('new-profile-fields');
                const yesBtn = document.getElementById('btn-confirm-yes');
                const modalInner = document.querySelector('#modal-confirm-generic .modal');
                
                const nameInp = document.getElementById('new-prof-name');
                const gameInp = document.getElementById('new-prof-game-path');
                const modsInp = document.getElementById('new-prof-mods-path');
                const backupInp = document.getElementById('new-prof-backup-path');

                if (!select || !newFields || !yesBtn || !modalInner) return;

                function validate() {
                    const isNew = select.value === 'NEW';
                    if (isNew) {
                        const ok = nameInp.value.trim() && gameInp.value.trim() && modsInp.value.trim() && backupInp.value.trim();
                        yesBtn.disabled = !ok;
                        yesBtn.style.opacity = ok ? '1' : '0.5';
                        yesBtn.style.cursor = ok ? 'pointer' : 'not-allowed';
                        modalInner.style.maxWidth = '550px';
                        newFields.style.display = 'flex';
                    } else {
                        yesBtn.disabled = false;
                        yesBtn.style.opacity = '1';
                        yesBtn.style.cursor = 'pointer';
                        modalInner.style.maxWidth = '400px';
                        newFields.style.display = 'none';
                    }
                }

                select.addEventListener('change', validate);

                [nameInp, gameInp, modsInp, backupInp].forEach(inp => {
                    inp.addEventListener('input', validate);
                });

                document.getElementById('btn-pick-import-game').onclick = async () => {
                    const p = await window.__TAURI__.dialog.open({ directory: true });
                    if (p) { gameInp.value = p; validate(); }
                };
                document.getElementById('btn-pick-import-mods').onclick = async () => {
                    const p = await window.__TAURI__.dialog.open({ directory: true });
                    if (p) { modsInp.value = p; validate(); }
                };
                document.getElementById('btn-pick-import-backup').onclick = async () => {
                    const p = await window.__TAURI__.dialog.open({ directory: true });
                    if (p) { backupInp.value = p; validate(); }
                };

                // Initial run
                validate();
            }, 100);

            const confirmed = await confirmPromise;

            if (confirmed) {
                const finalName = document.getElementById('import-mod-name').value || modNameFromUrl;
                let finalProfileId = document.getElementById('import-mod-profile').value;

                // Handle New Profile Creation
                if (finalProfileId === 'NEW') {
                    const newName = document.getElementById('new-prof-name').value.trim();
                    const newGamePath = document.getElementById('new-prof-game-path').value.trim();
                    const newModsPath = document.getElementById('new-prof-mods-path').value.trim();
                    const newBackupPath = document.getElementById('new-prof-backup-path').value.trim();
                    
                    try {
                        const profile = await invoke('create_profile', { 
                            name: newName, 
                            gameName: '', 
                            gamePath: newGamePath, 
                            modsPath: newModsPath, 
                            backupPath: newBackupPath, 
                            color: '#3b82f6', 
                            icon: 'star' 
                        });
                        finalProfileId = profile.id;
                        console.log('[BMM] New profile created from import:', finalProfileId);
                        
                        // Notify profiles system to refresh
                        if (window._refreshProfilesFn) await window._refreshProfilesFn();
                    } catch (err) {
                        toast(t('prof.createError') || 'Erreur lors de la création du profil : ' + err, 'error');
                        return;
                    }
                }

                toast(t('mod.downloading', { name: finalName }) || `Téléchargement de ${finalName}...`, 'info');
                
                try {
                    // Trigger the Rust download and installation logic
                    await invoke('download_mod', { url: modUrl, modName: finalName, profileId: finalProfileId });
                    
                    toast(t('mod.installed', { name: finalName }) || `${finalName} installé avec succès !`, 'success');
                    
                    // Refresh the UI
                    if (window._refreshModsFn) {
                        await window._refreshModsFn(true);
                    }
                } catch (err) {
                    console.error('[BMM] Mod download failed:', err);
                    toast((t('common.error') || 'Erreur') + ' : ' + err, 'error');
                }
            }
        }
    } catch (e) {
        console.error('[BMM] Deep link processing error:', e);
    }
}
