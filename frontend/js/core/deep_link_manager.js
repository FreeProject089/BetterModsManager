/**
 * deep_link_manager.ts
 * Handles bmm:// protocol links for one-click mod installation.
 */
import { invoke, apiBase } from './api.js';
import { toast } from '../ui/app.js';
import { t } from './i18n.js';
import { refreshMods } from '../features/mods/mods.js';
import { escHtml } from './utils.js';
import { handleApplyViaDeepLink } from '../features/plugins/plugins.js';
/** Reads the live API token from settings (for deeplinks that call the local API). */
async function getApiToken() {
    try {
        const s = await invoke('get_settings');
        return s?.api_token || '';
    }
    catch {
        return '';
    }
}
/**
 * Initializes the deep link listener.
 * Listens for 'deep-link-received' events from the Rust backend.
 */
export async function initDeepLinks() {
    if (typeof window === 'undefined' || !window.__TAURI__ || !window.__TAURI__.event) {
        console.warn('[DEEP-LINK] Tauri event module not available. Deep links disabled.');
        return;
    }
    // Expose __bmmDeeplink so custom theme elements can trigger any bmm:// action
    window.__bmmDeeplink = (url) => handleDeepLink(url);
    console.log('[BMM] Initializing Deep Link Manager...');
    const { listen } = window.__TAURI__.event;
    await listen('deep-link-received', async (event) => {
        handleDeepLink(event.payload);
    });
    try {
        const pending = await invoke('get_pending_deep_link');
        if (pending) {
            console.log('[BMM] Found pending deep link from startup:', pending);
            setTimeout(() => handleDeepLink(pending), 500);
        }
    }
    catch (e) {
        console.error('[BMM] Failed to fetch pending deep link:', e);
    }
}
/**
 * Common handler for deep link URLs
 */
async function handleDeepLink(urlStr) {
    if (!urlStr || !urlStr.startsWith('bmm://'))
        return;
    // ── Permission gate ────────────────────────────────────────────────────
    const deepLinkAllowed = localStorage.getItem('bmm_deeplink_allow_global') !== 'blocked';
    if (!deepLinkAllowed) {
        console.warn('[BMM] Deep link blocked by permission settings:', urlStr);
        toast(t('plugins.deepLinkBlocked') || 'Deep links désactivés dans les paramètres.', 'error');
        return;
    }
    console.log('[BMM] Processing deep link:', urlStr);
    toast(`Deep Link: ${urlStr.split('?')[0]}`, 'info');
    try {
        const parsedUrl = new URL(urlStr.replace('bmm://', 'https://bmm.local/'));
        const action = parsedUrl.pathname.replace(/^\/|\/$/g, '');
        // ── Plugin actions ────────────────────────────────────────────────
        if (action === 'plugin/activate' || action === 'plugin/compare') {
            const pluginId = parsedUrl.searchParams.get('id');
            if (!pluginId) {
                toast(t('plugins.deepLinkMissingId'), 'error');
                return;
            }
            // Navigate to plugins view first, then show compare overlay
            const navBtn = document.querySelector('[data-view="plugins"]');
            navBtn?.click();
            try {
                await handleApplyViaDeepLink(pluginId);
            }
            catch (e) {
                toast(`${t('common.error')}: ${e}`, 'error');
            }
            return;
        }
        // ── Mod actions ───────────────────────────────────────────────────
        if (action === 'mod/enable' || action === 'mod/disable') {
            const modId = parsedUrl.searchParams.get('id');
            if (!modId) {
                toast(t('plugins.deepLinkMissingId'), 'error');
                return;
            }
            const isEnable = action === 'mod/enable';
            console.log(`[BMM-API] bmm:// ${isEnable ? 'enable' : 'disable'} mod: ${modId}`);
            const modCard = document.querySelector(`[data-mod-id="${modId}"]`);
            if (modCard) {
                modCard.classList.add('mod-api-toggling');
                setTimeout(() => modCard.classList.remove('mod-api-toggling'), 800);
            }
            try {
                if (isEnable) {
                    await invoke('enable_mod', { modId, dependencies: [] });
                    console.log(`[BMM-API] Mod enabled via deep link: ${modId}`);
                    toast(t('plugins.deepLinkModEnabled', { id: modId }), 'success');
                }
                else {
                    await invoke('disable_mod', { modId });
                    console.log(`[BMM-API] Mod disabled via deep link: ${modId}`);
                    toast(t('plugins.deepLinkModDisabled', { id: modId }), 'success');
                }
                await refreshMods(true);
            }
            catch (e) {
                console.error(`[BMM-API] Failed to ${isEnable ? 'enable' : 'disable'} mod via deep link:`, e);
                toast(`${t('common.error')}: ${e}`, 'error');
            }
            return;
        }
        // ── Profile action ────────────────────────────────────────────────
        if (action === 'profile/activate') {
            const profileId = parsedUrl.searchParams.get('id');
            if (!profileId) {
                toast(t('plugins.deepLinkMissingId'), 'error');
                return;
            }
            console.log(`[BMM-API] bmm:// activate profile: ${profileId}`);
            try {
                await invoke('set_active_profile', { profileId });
                console.log(`[BMM-API] Profile activated via deep link: ${profileId}`);
                toast(t('plugins.deepLinkProfileActivated', { id: profileId }), 'success');
                await refreshMods(true);
                if (window._refreshProfilesFn)
                    await window._refreshProfilesFn();
                const sel = document.getElementById('library-profile-select');
                if (sel)
                    sel.value = profileId;
            }
            catch (e) {
                console.error('[BMM-API] Failed to activate profile via deep link:', e);
                toast(`${t('common.error')}: ${e}`, 'error');
            }
            return;
        }
        // ── Modpack actions ───────────────────────────────────────────────
        if (action === 'modpack/enable' || action === 'modpack/disable') {
            const profileId = parsedUrl.searchParams.get('id');
            if (!profileId) {
                toast(t('plugins.deepLinkMissingId'), 'error');
                return;
            }
            const isEnable = action === 'modpack/enable';
            console.log(`[BMM-API] bmm:// ${isEnable ? 'enable' : 'disable'} modpack/profile (in-app): ${profileId}`);
            try {
                // Resolve the list of mod IDs IN-APP (like the quick action does), without
                // hitting the local HTTP server: `id` may be a modpack id or a profile id.
                const [modpacks, profiles] = await Promise.all([
                    invoke('load_modpacks').catch(() => []),
                    invoke('get_profiles').catch(() => []),
                ]);
                let modIds = [];
                const mp = (modpacks || []).find((m) => m.id === profileId);
                if (mp) {
                    modIds = (mp.mods || []).map((mr) => mr.mod_id).filter(Boolean);
                }
                else {
                    const prof = (profiles || []).find((p) => p.id === profileId);
                    if (prof)
                        modIds = [...(prof.active_mods || [])];
                }
                if (!mp && modIds.length === 0) {
                    toast(`${t('common.error')}: ${profileId}`, 'error');
                    return;
                }
                // Apply each mod via the native in-app commands (same path as quick actions).
                for (const modId of modIds) {
                    try {
                        if (isEnable)
                            await invoke('enable_mod', { modId, dependencies: [] });
                        else
                            await invoke('disable_mod', { modId });
                    }
                    catch (err) {
                        console.warn(`[BMM-API] modpack toggle: failed for ${modId}:`, err);
                    }
                }
                toast(isEnable
                    ? (t('plugins.deepLinkModpackEnabled') || 'Modpack activé.')
                    : (t('plugins.deepLinkModpackDisabled') || 'Modpack désactivé.'), 'success');
                await refreshMods(true);
                if (window._refreshProfilesFn)
                    await window._refreshProfilesFn();
            }
            catch (e) {
                console.error('[BMM-API] Failed to toggle modpack via deep link:', e);
                toast(`${t('common.error')}: ${e}`, 'error');
            }
            return;
        }
        // ── Repo actions ──────────────────────────────────────────────────
        if (action === 'repo/connect') {
            const repoUrl = parsedUrl.searchParams.get('url');
            if (!repoUrl) {
                toast(t('plugins.deepLinkMissingUrl') || 'URL manquante dans le deep link.', 'error');
                return;
            }
            const confirmed = await window.confirmCustom(t('plugins.deepLinkConnectRepoTitle') || 'Connecter un repo ?', `<p style="font-size:13px;line-height:1.5;margin:10px 0 4px;">${t('plugins.deepLinkConnectRepoDesc') || 'Ajouter ce repo à la liste des repos connectés dans BMM ?'}</p>
                 <div style="font-size:11px;font-family:var(--font-mono);background:rgba(0,0,0,0.3);padding:6px 10px;border-radius:6px;word-break:break-all;margin-top:8px;color:var(--text-muted);">${escHtml(repoUrl)}</div>`, 'accent', { yesLabel: t('common.yes'), noLabel: t('common.no') });
            if (!confirmed)
                return;
            try {
                // Do the action IN-APP (like the quick action): navigate to the repo page
                // and let the native UI fetch/connect the repo — no background HTTP call.
                const navBtn = document.querySelector('.nav-item[data-view="repo"], .nav-btn[data-view="repo"], [data-view="repo"]');
                navBtn?.click();
                setTimeout(() => {
                    document.dispatchEvent(new CustomEvent('bmm:repo-focus', {
                        detail: { section: 'connect', prefill: { url: repoUrl } },
                    }));
                }, 350);
                toast(t('plugins.deepLinkConnectRepoOk') || 'Repo connecté avec succès.', 'success');
            }
            catch (e) {
                toast(`${t('common.error')}: ${e}`, 'error');
            }
            return;
        }
        if (action === 'repo/sync') {
            const repoUrl = parsedUrl.searchParams.get('url');
            if (!repoUrl) {
                toast(t('plugins.deepLinkMissingUrl') || 'URL manquante dans le deep link.', 'error');
                return;
            }
            // Navigate to the repo page so the user can complete the sync from there
            const navBtn = document.querySelector('[data-view="repo"]');
            if (navBtn)
                navBtn.click();
            toast(t('plugins.deepLinkSyncRepoNav') || 'Ouvre la page Serveur Repo pour lancer la synchronisation.', 'info');
            // Dispatch a custom event so the repo page can pre-fill the URL
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent('bmm:deeplink-repo-sync', { detail: { url: repoUrl } }));
            }, 300);
            return;
        }
        // ── Generic passthrough: bmm://api?method=&path=&<field>=… ────────
        // Lets a single deeplink hit ANY documented API endpoint. Example:
        //   bmm://api?method=POST&path=/api/mods/enable&mod_id=abc
        //   bmm://api?method=GET&path=/api/status
        // Query params (other than method/path) become the JSON body (POST/PUT)
        // or the query string (GET/DELETE).
        if (action === 'api') {
            const method = (parsedUrl.searchParams.get('method') || 'GET').toUpperCase();
            let apiPath = parsedUrl.searchParams.get('path') || '';
            if (!apiPath.startsWith('/api/')) {
                toast(t('toast.deeplinkInvalidPath') || 'Deep link: invalid path', 'error');
                return;
            }
            const params = {};
            parsedUrl.searchParams.forEach((v, k) => { if (k !== 'method' && k !== 'path')
                params[k] = v; });
            try {
                const tok = await getApiToken();
                const opts = { method, headers: { 'Authorization': `Bearer ${tok}` } };
                if (method === 'GET' || method === 'DELETE') {
                    const qs = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
                    if (qs)
                        apiPath += (apiPath.includes('?') ? '&' : '?') + qs;
                }
                else if (Object.keys(params).length) {
                    opts.headers['Content-Type'] = 'application/json';
                    // Coerce booleans/numbers where obvious
                    const body = {};
                    for (const [k, v] of Object.entries(params)) {
                        body[k] = v === 'true' ? true : v === 'false' ? false : (/^-?\d+$/.test(v) ? Number(v) : v);
                    }
                    opts.body = JSON.stringify(body);
                }
                const r = await fetch(`${apiBase()}${apiPath}`, opts);
                if (r.ok) {
                    toast(`${method} ${apiPath.split('?')[0]} ✓`, 'success');
                    window._refreshModsFn?.(true);
                }
                else
                    toast(`${method} ${apiPath.split('?')[0]} → ${r.status}`, 'error');
            }
            catch (e) {
                toast(`${t('common.error')}: ${e}`, 'error');
            }
            return;
        }
        // ── Repo: gen / update / host ─────────────────────────────────────
        if (action === 'repo/gen' || action === 'repo/update' || action === 'repo/host') {
            const navBtn = document.querySelector('.nav-item[data-view="repo"], [data-view="repo"]');
            navBtn?.click();
            const section = action === 'repo/gen' ? 'gen' : action === 'repo/update' ? 'update' : 'host';
            const prefill = {};
            if (action === 'repo/update')
                prefill.repoDir = parsedUrl.searchParams.get('dir') || '';
            if (action === 'repo/host') {
                prefill.serveDir = parsedUrl.searchParams.get('dir') || '';
                const port = parsedUrl.searchParams.get('port');
                if (port)
                    prefill.port = parseInt(port, 10);
            }
            setTimeout(() => document.dispatchEvent(new CustomEvent('bmm:repo-focus', { detail: { section, prefill } })), 400);
            toast(`Deep Link: ${action}`, 'info');
            return;
        }
        // ── App Catalog: install / launch ─────────────────────────────────
        if (action === 'app/install') {
            const id = parsedUrl.searchParams.get('id');
            const url = parsedUrl.searchParams.get('url');
            if (!id || !url) {
                toast(t('plugins.deepLinkMissingUrl') || 'Missing id/url', 'error');
                return;
            }
            try {
                await invoke('install_app', {
                    appId: id,
                    appTitle: parsedUrl.searchParams.get('title') || id,
                    downloadUrl: url,
                    fileType: parsedUrl.searchParams.get('type') || 'exe',
                    installPath: parsedUrl.searchParams.get('path') || '',
                    version: null, category: null, thumb: null,
                });
                toast(`${parsedUrl.searchParams.get('title') || id} ${t('apps.installed') || 'installed'}`, 'success');
            }
            catch (e) {
                toast(`${t('common.error')}: ${e}`, 'error');
            }
            return;
        }
        if (action === 'app/launch') {
            const id = parsedUrl.searchParams.get('id');
            const exe = parsedUrl.searchParams.get('exe');
            if (!id || !exe) {
                toast(t('plugins.deepLinkMissingId') || 'Missing id/exe', 'error');
                return;
            }
            try {
                await invoke('launch_app', { appId: id, exePath: exe });
                toast(`${t('apps.launched') || 'Launched'}: ${id}`, 'success');
            }
            catch (e) {
                toast(`${t('common.error')}: ${e}`, 'error');
            }
            return;
        }
        // ── Modpack: create from a profile (via local API) ───────────────
        if (action === 'modpack/create') {
            const name = parsedUrl.searchParams.get('name');
            const profileId = parsedUrl.searchParams.get('profile');
            if (!name) {
                toast(t('plugins.deepLinkMissingId') || 'Missing name', 'error');
                return;
            }
            try {
                const tok = await getApiToken();
                const r = await fetch(apiBase() + '/api/modpacks/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
                    body: JSON.stringify({ name, source_profile_id: profileId || undefined }),
                });
                if (r.ok) {
                    toast(`${t('plugins.actionCreateModpack') || 'Modpack created'}: ${name}`, 'success');
                    window._refreshModsFn?.(true);
                }
                else
                    toast(`${t('common.error')}: ${r.status}`, 'error');
            }
            catch (e) {
                toast(`${t('common.error')}: ${e}`, 'error');
            }
            return;
        }
        // ── Language: import a translation file by path ───────────────────
        if (action === 'language/import') {
            const path = parsedUrl.searchParams.get('path');
            try {
                await invoke('import_language', { path: path || null });
                toast(t('settings.langImported') || 'Language imported', 'success');
            }
            catch (e) {
                toast(`${t('common.error')}: ${e}`, 'error');
            }
            return;
        }
        // ── Language: install a shared translation embedded in the link ───
        if (action === 'language/import-inline') {
            const data = parsedUrl.searchParams.get('data');
            const code = parsedUrl.searchParams.get('code') || 'custom';
            const gz = parsedUrl.searchParams.get('gz') === '1';
            if (data) {
                try {
                    // base64url → bytes
                    const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
                    const bin = atob(b64);
                    let content;
                    if (gz) {
                        const bytes = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++)
                            bytes[i] = bin.charCodeAt(i);
                        const ds = new window.DecompressionStream('gzip');
                        const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
                        content = new TextDecoder().decode(buf);
                    }
                    else {
                        content = decodeURIComponent(escape(bin));
                    }
                    const installed = await invoke('import_language_data', { code, content });
                    toast(`${t('settings.langImported') || 'Language imported'}: ${installed}`, 'success');
                }
                catch (e) {
                    toast(`${t('common.error')}: ${e}`, 'error');
                }
            }
            return;
        }
        // ── Restart BMM (via local API) ───────────────────────────────────
        if (action === 'restart') {
            try {
                const tok = await getApiToken();
                await fetch(apiBase() + '/api/restart', { method: 'POST', headers: { 'Authorization': `Bearer ${tok}` } });
            }
            catch (e) {
                toast(`${t('common.error')}: ${e}`, 'error');
            }
            return;
        }
        // ── Theme deeplinks ──────────────────────────────────────────────────
        if (action === 'theme/apply') {
            const id = parsedUrl.searchParams.get('id');
            if (id) {
                const { activateTheme, loadInstalledThemes } = await import('../features/themes/theme-engine.js');
                await loadInstalledThemes();
                await activateTheme(id);
                toast(t('themes.deeplink.apply') || 'Theme applied', 'success');
            }
            return;
        }
        if (action === 'theme/import') {
            const url = parsedUrl.searchParams.get('url');
            if (url) {
                toast(t('themes.deeplink.import') || 'Importing theme…', 'info');
                const { installTheme } = await import('../features/themes/theme-engine.js');
                try {
                    const resp = await fetch(url);
                    const json = await resp.json();
                    await installTheme(json);
                    toast(`${t('themes.imported') || 'Theme imported'}: ${json.name}`, 'success');
                }
                catch (e) {
                    toast(String(e), 'error');
                }
            }
            return;
        }
        if (action === 'theme/editor') {
            window.openThemeEditor?.();
            return;
        }
        if (action === 'theme/import-inline') {
            const data = parsedUrl.searchParams.get('data');
            if (data) {
                try {
                    const json = decodeURIComponent(escape(atob(data)));
                    const theme = JSON.parse(json);
                    const { installTheme, activateTheme, loadInstalledThemes } = await import('../features/themes/theme-engine.js');
                    await installTheme(theme);
                    await loadInstalledThemes();
                    await activateTheme(theme.id);
                    toast(`${t('themes.imported') || 'Theme installed'}: ${theme.name}`, 'success');
                }
                catch (e) {
                    toast(String(e), 'error');
                }
            }
            return;
        }
        if (action === 'import' || action === 'install' || action === 'download') {
            const modUrl = parsedUrl.searchParams.get('url');
            const modNameFromUrl = parsedUrl.searchParams.get('name') || t('mod.unknownName') || 'Mod Inconnu';
            if (!modUrl) {
                console.warn('[BMM] Deep link missing "url" parameter:', urlStr);
                return;
            }
            let profiles = [];
            let activeId = null;
            try {
                [profiles, activeId] = await Promise.all([
                    invoke('get_profiles'),
                    invoke('get_active_profile_id')
                ]);
            }
            catch (err) {
                console.error('[BMM] Failed to fetch profiles for deep link:', err);
            }
            const title = t('mod.importTitle') || 'Installation en 1 clic';
            const descTemplate = t('mod.importConfirmDesc');
            const desc = descTemplate.replace('{name}', modNameFromUrl);
            const customContent = `
                <div class="confirm-import-container" style="display:flex; flex-direction:column; gap:12px; margin-top:12px; text-align:left;">
                    <p style="font-size:13px; margin-bottom:4px; line-height:1.4;">${desc}</p>
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        <label style="font-size:10px; font-weight:700; text-transform:uppercase; color:var(--text-secondary); opacity:0.8; letter-spacing:0.05em;">${t('mod.importNameLabel')}</label>
                        <input type="text" id="import-mod-name" class="input" value="${escHtml(modNameFromUrl)}" 
                            style="width:100%; padding:10px; background:rgba(0,0,0,0.3); border:1px solid var(--border); border-radius:6px; color:var(--text-primary); font-size:13px; font-family:inherit;">
                    </div>
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        <label style="font-size:10px; font-weight:700; text-transform:uppercase; color:var(--text-secondary); opacity:0.8; letter-spacing:0.05em;">${t('mod.importProfileLabel')}</label>
                        <select id="import-mod-profile" class="select" 
                            style="width:100%; padding:10px; background:rgba(0,0,0,0.3); border:1px solid var(--border); border-radius:6px; color:var(--text-primary); font-size:13px; font-family:inherit; cursor:pointer;">
                            ${profiles.map(p => `<option value="${p.id}" ${p.id === activeId ? 'selected' : ''}>${escHtml(p.name)}</option>`).join('')}
                            <option value="NEW" style="color:var(--accent); font-weight:700;">+ ${t('mod.importProfileNew')}</option>
                        </select>
                    </div>

                    <div id="new-profile-fields" style="display:none; flex-direction:column; gap:10px; padding:12px; background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:8px; margin-top:4px;">
                        <div style="display:flex; flex-direction:column; gap:4px;">
                            <label style="font-size:9px; font-weight:800; text-transform:uppercase; color:var(--accent); opacity:0.8;">${t('prof.nameLabel')}</label>
                            <input type="text" id="new-prof-name" class="input" placeholder="Ex: DCS World 2.9" style="width:100%; padding:8px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:4px; font-size:12px; color:white;">
                        </div>
                        
                        <div style="display:flex; flex-direction:column; gap:4px;">
                            <label style="font-size:9px; font-weight:800; text-transform:uppercase; color:var(--text-secondary);">${t('prof.gameDirLabel')}</label>
                            <div style="display:flex; gap:6px;">
                                <input type="text" id="new-prof-game-path" class="input" readonly style="flex:1; padding:8px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:4px; font-size:11px; color:var(--text-muted);">
                                <button class="btn btn-sm btn-secondary" id="btn-pick-import-game" style="padding:0 10px; height:32px; font-size:11px;">${t('common.browse')}</button>
                            </div>
                        </div>

                        <div style="display:flex; flex-direction:column; gap:4px;">
                            <label style="font-size:9px; font-weight:800; text-transform:uppercase; color:var(--text-secondary);">${t('prof.modsDirLabel')}</label>
                            <div style="display:flex; gap:6px;">
                                <input type="text" id="new-prof-mods-path" class="input" readonly style="flex:1; padding:8px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:4px; font-size:11px; color:var(--text-muted);">
                                <button class="btn btn-sm btn-secondary" id="btn-pick-import-mods" style="padding:0 10px; height:32px; font-size:11px;">${t('common.browse')}</button>
                            </div>
                        </div>

                        <div style="display:flex; flex-direction:column; gap:4px;">
                            <label style="font-size:9px; font-weight:800; text-transform:uppercase; color:var(--text-secondary);">${t('prof.backupDirLabel')}</label>
                            <div style="display:flex; gap:6px;">
                                <input type="text" id="new-prof-backup-path" class="input" readonly style="flex:1; padding:8px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:4px; font-size:11px; color:var(--text-muted);">
                                <button class="btn btn-sm btn-secondary" id="btn-pick-import-backup" style="padding:0 10px; height:32px; font-size:11px;">${t('common.browse')}</button>
                            </div>
                        </div>
                    </div>

                    <div style="font-size:10px; opacity:0.4; word-break:break-all; margin-top:8px; font-family:var(--font-mono); border-top:1px solid rgba(255,255,255,0.05); padding-top:8px;">${escHtml(modUrl)}</div>
                </div>
            `;
            const confirmPromise = window.confirmCustom(title, customContent, 'accent', {
                yesLabel: t('common.yes'),
                noLabel: t('common.no')
            });
            setTimeout(() => {
                const select = document.getElementById('import-mod-profile');
                const newFields = document.getElementById('new-profile-fields');
                const yesBtn = document.getElementById('btn-confirm-yes');
                const modalInner = document.querySelector('#modal-confirm-generic .modal');
                const nameInp = document.getElementById('new-prof-name');
                const gameInp = document.getElementById('new-prof-game-path');
                const modsInp = document.getElementById('new-prof-mods-path');
                const backupInp = document.getElementById('new-prof-backup-path');
                if (!select || !newFields || !yesBtn || !modalInner)
                    return;
                function validate() {
                    const isNew = select.value === 'NEW';
                    if (isNew) {
                        const ok = !!(nameInp.value.trim() && gameInp.value.trim() && modsInp.value.trim() && backupInp.value.trim());
                        yesBtn.disabled = !ok;
                        yesBtn.style.opacity = ok ? '1' : '0.5';
                        yesBtn.style.cursor = ok ? 'pointer' : 'not-allowed';
                        modalInner.style.maxWidth = '550px';
                        newFields.style.display = 'flex';
                    }
                    else {
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
                    if (p) {
                        gameInp.value = p;
                        validate();
                    }
                };
                document.getElementById('btn-pick-import-mods').onclick = async () => {
                    const p = await window.__TAURI__.dialog.open({ directory: true });
                    if (p) {
                        modsInp.value = p;
                        validate();
                    }
                };
                document.getElementById('btn-pick-import-backup').onclick = async () => {
                    const p = await window.__TAURI__.dialog.open({ directory: true });
                    if (p) {
                        backupInp.value = p;
                        validate();
                    }
                };
                validate();
            }, 100);
            const confirmed = await confirmPromise;
            if (confirmed) {
                const finalName = document.getElementById('import-mod-name').value || modNameFromUrl;
                let finalProfileId = document.getElementById('import-mod-profile').value;
                if (finalProfileId === 'NEW') {
                    const newName = document.getElementById('new-prof-name').value.trim();
                    const newGamePath = document.getElementById('new-prof-game-path').value.trim();
                    const newModsPath = document.getElementById('new-prof-mods-path').value.trim();
                    const newBackupPath = document.getElementById('new-prof-backup-path').value.trim();
                    try {
                        const profile = await invoke('create_profile', { payload: {
                                name: newName,
                                gameName: '',
                                gamePath: newGamePath,
                                modsPath: newModsPath,
                                backupPath: newBackupPath,
                                color: '#3b82f6',
                                icon: 'star'
                            } });
                        finalProfileId = profile.id;
                        console.log('[BMM] New profile created from import:', finalProfileId);
                        if (window._refreshProfilesFn)
                            await window._refreshProfilesFn();
                    }
                    catch (err) {
                        toast(t('prof.createError', { err: String(err) }), 'error');
                        return;
                    }
                }
                toast(t('mod.downloading', { name: finalName }), 'info');
                try {
                    await invoke('download_mod', { url: modUrl, modName: finalName, profileId: finalProfileId });
                    toast(t('mod.installed', { name: finalName }), 'success');
                    if (window._refreshModsFn) {
                        await window._refreshModsFn(true);
                    }
                }
                catch (err) {
                    console.error('[BMM] Mod download failed:', err);
                    toast((t('common.error') || 'Error') + ' : ' + err, 'error');
                }
            }
        }
    }
    catch (e) {
        console.error('[BMM] Deep link processing error:', e);
    }
}
//# sourceMappingURL=deep_link_manager.js.map