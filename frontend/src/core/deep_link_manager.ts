/**
 * deep_link_manager.ts
 * Handles bmm:// protocol links for one-click mod installation.
 */

import { invoke, apiBase, pickFolder, pickFolderAt, askConfirm } from './api.js';
import { toast } from '../ui/app.js';
import { t } from './i18n.js';
import { refreshMods } from '../features/mods/mods.js';
import { escHtml } from './utils.js';
import type { Profile } from '../types/models.js';
import { refreshPlugins, handleApplyViaDeepLink } from '../features/plugins/plugins.js';
import { admitLink, catalogRoute, windowOrigin, linkForLog, type LinkOrigin, type LinkPrompt } from './deeplink-guard.js';
import { setTrustedLinkDispatcher } from './link-dispatch.js';

declare global {
    interface Window {
        _refreshProfilesFn?: () => Promise<void>;
    }
}

/** Reads the live API token from settings (for deeplinks that call the local API). */
async function getApiToken(): Promise<string> {
    try { const s: any = await invoke('get_settings'); return s?.api_token || ''; } catch { return ''; }
}

/**
 * Initializes the deep link listener.
 * Listens for 'deep-link-received' events from the Rust backend.
 */
/**
 * The two ways a source is protected, applied the same way wherever a link names one.
 *
 *   ?password=…   a shared secret, remembered for this run only and never written to disk
 *   ?key=…        which identity key signs the request — an id or a name
 *   ?passphrase=… unlocks that key, for this run only, when the key file has one
 *
 * `key` takes either because both are real handles to a person: the id is what a script
 * should carry (it survives a rename), the name is what somebody reads off their own screen.
 *
 * A key that does not resolve is REPORTED. Continuing quietly would send the request signed
 * by whatever the ring had active — usually the wrong one, or none — and the answer would be
 * "could not read it", with nothing anywhere pointing at the key. That is the exact shape of
 * defect `scripts/check-creds-wired.mjs` exists to catch inside the scheduler; a deeplink can
 * reach the same sources and deserves the same honesty.
 */
async function applySourceAccess(url: string, params: URLSearchParams): Promise<void> {
    if (!url) return;
    const password = params.get('password') || '';
    if (password) {
        const { rememberSourcePassword } = await import('./source-fetch.js');
        try { rememberSourcePassword(url, password); } catch { /* proceed unprotected */ }
    }
    const key = (params.get('key') || '').trim();
    if (!key) return;
    // Unlocked BEFORE the key is bound to the origin, so a wrong passphrase is reported as a
    // passphrase problem rather than as the "could not read it" a server gives once the key
    // has been chosen and then fails to sign.
    //
    // Not trimmed: leading and trailing spaces are legal in a passphrase, and silently
    // dropping them would turn a correct secret into a wrong one.
    const passphrase = params.get('passphrase') || '';
    if (passphrase) {
        try {
            await invoke('key_auth_unlock', { name: key, passphrase });
        } catch (e) {
            toast(t('deeplink.keyLocked').replace('{k}', key), 'warning', 9000);
            console.warn('[deeplink] passphrase', key, e);
            return;
        }
    }
    try {
        await invoke('key_auth_set_for_url', { url, name: key });
    } catch (e) {
        // Named and not found, versus found and refused by the server, are different problems
        // with different fixes, and only the first one is knowable here.
        toast(t('deeplink.keyUnknown').replace('{k}', key), 'warning', 9000);
        console.warn('[deeplink] key', key, e);
    }
}

export async function initDeepLinks(): Promise<void> {
    if (typeof window === 'undefined' || !window.__TAURI__ || !window.__TAURI__.event) {
        console.warn('[DEEP-LINK] Tauri event module not available. Deep links disabled.');
        return;
    }

    // The app's own callers dispatch through here too, and say who they are: a theme's
    // button ('theme'), the deep-link tester ('panel'). No origin → 'unknown', which is
    // treated like a link from a web page. See deeplink-guard.ts for what each origin may do.
    //
    // This function is on `window`, so whoever calls it chooses the second argument — and a
    // `data-act` attribute in rendered markdown could call it. It therefore cannot claim a
    // trusted origin (windowOrigin downgrades 'scheduler'/'api'/'self' to 'unknown'). The
    // scheduler and the local API, which ARE trusted, come in through link-dispatch.ts.
    (window as any).__bmmDeeplink = (url: string, origin?: LinkOrigin) => handleDeepLink(url, windowOrigin(origin));
    setTrustedLinkDispatcher((url, origin) => handleDeepLink(url, origin));

    console.log('[BMM] Initializing Deep Link Manager...');

    const { listen } = window.__TAURI__.event;

    // From the OS: a web page or another program. The browser does not say which page.
    await listen('deep-link-received', async (event: { payload: string }) => {
        handleDeepLink(event.payload, 'external');
    });

    try {
        const pending = await invoke('get_pending_deep_link') as string | null;
        if (pending) {
            console.log('[BMM] Found pending deep link from startup:', linkForLog(pending));
            setTimeout(() => handleDeepLink(pending, 'external'), 500);
        }
    } catch (e) {
        console.error('[BMM] Failed to fetch pending deep link:', e);
    }
}

/** A name a person recognises, for the ids the dialog would otherwise show bare. Best effort:
 *  the id is always shown too, so a failed lookup hides nothing. */
async function friendlyName(p: LinkPrompt): Promise<string> {
    try {
        if (p.action === 'plugin/delete' || p.action === 'plugin/activate') {
            const list: any[] = await invoke('get_installed_plugins');
            return list.find((x) => x?.manifest?.id === p.target)?.manifest?.name || '';
        }
        if (p.action === 'launchpack/run') {
            const list: any[] = await invoke('get_launch_packs');
            const pack = list.find((x) => x?.id === p.target);
            return pack ? `${pack.name} — ${(pack.executable_paths || []).join(', ')}` : '';
        }
        if (p.action === 'app/launch') {
            const st: any = await invoke('get_apps_state');
            const a = st?.installed?.[p.target];
            return a ? `${a.title} — ${a.exe_path || ''}` : '';
        }
    } catch { /* the id alone is still shown */ }
    return '';
}

const mono = 'font-size:11px;font-family:var(--font-mono);background:rgba(0,0,0,0.3);padding:6px 10px;border-radius:6px;word-break:break-all;margin-top:6px;color:var(--text-muted);white-space:pre-wrap;';

/** How the gate talks to the person: BMM's own dialog, Cancel first. */
const GATE_UI = {
    async confirm(p: LinkPrompt): Promise<boolean> {
        const name = await friendlyName(p);
        const row = (label: string, value: string) =>
            `<div style="margin-top:8px;font-size:11px;color:var(--text-secondary);">${escHtml(label)}</div><div style="${mono}">${escHtml(value)}</div>`;
        const body =
            `<p style="font-size:13px;line-height:1.5;margin:10px 0 4px;">${escHtml(t(p.descKey))}</p>`
            + (p.targetKind !== 'none' && p.target ? row(t('dlg.target'), p.target) : '')
            + (name ? row(t('dlg.name'), name) : '')
            + (p.host ? row(t('dlg.host'), p.host) : '')
            + row(t('dlg.origin'), t(`dlg.origin.${p.origin}`))
            + p.notes.map((k) => `<p style="font-size:12px;line-height:1.45;margin:8px 0 0;color:var(--text-secondary);">${escHtml(t(k))}</p>`).join('');
        return window.confirmCustom!(t('dlg.title'), body, p.danger ? 'danger' : 'warning',
            { yesLabel: t('dlg.allow'), noLabel: t('common.cancel'), defaultCancel: true });
    },
    refuse(r: { action: string; reason: string; detail: string }): void {
        console.warn('[deeplink] refused', r.action, r.reason, r.detail);
        toast(t('dlg.refused').replace('{action}', r.action).replace('{why}', t(`dlg.why.${r.reason}`)), 'error', 10000);
    },
};

/** A folder the PERSON chose, starting from what a link suggested. Null = they cancelled. */
async function chooseFolder(suggested: string, trusted: boolean): Promise<string | null> {
    if (trusted) return suggested || null;
    return pickFolderAt(suggested || undefined);
}

/**
 * Common handler for deep link URLs
 */
async function handleDeepLink(urlStr: string, originIn: LinkOrigin = 'unknown'): Promise<void> {
    if (!urlStr || !urlStr.startsWith('bmm://')) return;

    // ── Permission gate ────────────────────────────────────────────────────
    const deepLinkAllowed = localStorage.getItem('bmm_deeplink_allow_global') !== 'blocked';
    if (!deepLinkAllowed) {
        console.warn('[BMM] Deep link blocked by permission settings:', linkForLog(urlStr));
        toast(t('plugins.deepLinkBlocked') || 'Deep links désactivés dans les paramètres.', 'error');
        return;
    }

    // Through linkForLog: this line lands in the session log and a link can carry a password.
    console.log('[BMM] Processing deep link:', linkForLog(urlStr));
    toast(`Deep Link: ${urlStr.split('?')[0]}`, 'info');
    
    try {
        // ── The gate. Every route passes here BEFORE anything is read, fetched, written or
        // run: hard limits refuse outright, and anything that changes state asks in-app
        // (Cancel is the default) unless the caller is the app itself. The rules, and the
        // routes deliberately left prompt-free, are in deeplink-guard.ts.
        const adm = await admitLink(urlStr, originIn, GATE_UI);
        if (!adm) return;
        const { action, trusted } = adm;
        const parsedUrl = { searchParams: adm.params };

        // ── Plugin actions ────────────────────────────────────────────────
        if (action === 'plugin/activate' || action === 'plugin/compare') {
            const pluginId = parsedUrl.searchParams.get('id');
            if (!pluginId) {
                toast(t('plugins.deepLinkMissingId'), 'error');
                return;
            }
            // Navigate to plugins view first, then show compare overlay
            const navBtn = document.querySelector('[data-view="plugins"]') as HTMLElement;
            navBtn?.click();
            try {
                await handleApplyViaDeepLink(pluginId);
            } catch (e) {
                toast(`${t('common.error')}: ${e}`, 'error');
            }
            return;
        }

        // ── Uninstall a plugin (registry + permissions + files) ───────────
        if (action === 'plugin/delete') {
            const pluginId = parsedUrl.searchParams.get('id');
            if (!pluginId) { toast(t('plugins.deepLinkMissingId'), 'error'); return; }
            try {
                await invoke('uninstall_plugin', { pluginId });
                toast(`${t('plugins.deleted') || 'Plugin deleted'}: ${pluginId}`, 'success');
                window._refreshModsFn?.(true);
            } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
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
            const modCard = document.querySelector(`[data-mod-id="${modId}"]`) as HTMLElement | null;
            if (modCard) {
                modCard.classList.add('mod-api-toggling');
                setTimeout(() => modCard.classList.remove('mod-api-toggling'), 800);
            }
            try {
                if (isEnable) {
                    await invoke('enable_mod', { modId, dependencies: [] });
                    console.log(`[BMM-API] Mod enabled via deep link: ${modId}`);
                    toast(t('plugins.deepLinkModEnabled', { id: modId }), 'success');
                } else {
                    await invoke('disable_mod', { modId });
                    console.log(`[BMM-API] Mod disabled via deep link: ${modId}`);
                    toast(t('plugins.deepLinkModDisabled', { id: modId }), 'success');
                }
                await refreshMods(true);
            } catch (e) {
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
                if (window._refreshProfilesFn) await window._refreshProfilesFn();
                const sel = document.getElementById('library-profile-select') as HTMLSelectElement | null;
                if (sel) sel.value = profileId;
            } catch (e) {
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
                    invoke('load_modpacks').catch(() => []) as Promise<any[]>,
                    invoke('get_profiles').catch(() => []) as Promise<Profile[]>,
                ]);
                let modIds: string[] = [];
                const mp = (modpacks || []).find((m: any) => m.id === profileId);
                if (mp) {
                    modIds = (mp.mods || []).map((mr: any) => mr.mod_id).filter(Boolean);
                } else {
                    const prof = (profiles || []).find((p) => p.id === profileId);
                    if (prof) modIds = [...(prof.active_mods || [])];
                }
                if (!mp && modIds.length === 0) {
                    toast(`${t('common.error')}: ${profileId}`, 'error');
                    return;
                }
                // Apply each mod via the native in-app commands (same path as quick actions).
                for (const modId of modIds) {
                    try {
                        if (isEnable) await invoke('enable_mod', { modId, dependencies: [] });
                        else await invoke('disable_mod', { modId });
                    } catch (err) {
                        console.warn(`[BMM-API] modpack toggle: failed for ${modId}:`, err);
                    }
                }
                toast(isEnable
                    ? (t('plugins.deepLinkModpackEnabled') || 'Modpack activé.')
                    : (t('plugins.deepLinkModpackDisabled') || 'Modpack désactivé.'), 'success');
                await refreshMods(true);
                if (window._refreshProfilesFn) await window._refreshProfilesFn();
            } catch (e) {
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
            if (!/^https?:\/\//i.test(repoUrl)) {
                toast(t('toast.deeplinkInvalidPath') || 'Deep link: invalid path', 'error');
                return;
            }
            // The question was asked by the gate, BEFORE this line: the password is remembered
            // and the connect screen pre-filled only once the user said yes. It used to be
            // applied first and asked about after, so Cancel left the credential in place.
            // A `key`/`passphrase` from an outside link never gets here (deeplink-guard).
            await applySourceAccess(repoUrl, parsedUrl.searchParams);
            try {
                // Do the action IN-APP (like the quick action): navigate to the repo page
                // and let the native UI fetch/connect the repo — no background HTTP call.
                const navBtn = document.querySelector('.nav-item[data-view="repo"], .nav-btn[data-view="repo"], [data-view="repo"]') as HTMLElement | null;
                navBtn?.click();
                // A protected repo needs its password to be READ, not just to be synced.
                // `repo/sync` has carried one for a while; connect did not, so a link to a
                // protected repo opened the screen with an empty box — the one thing the
                // link was supposed to save you typing.
                const pw = parsedUrl.searchParams.get('password');
                setTimeout(() => {
                    document.dispatchEvent(new CustomEvent('bmm:repo-focus', {
                        detail: { section: 'connect', prefill: { url: repoUrl, ...(pw ? { password: pw } : {}) } },
                    }));
                }, 350);
                toast(t('plugins.deepLinkConnectRepoOk') || 'Repo connecté avec succès.', 'success');
            } catch (e) {
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
            // `ssh://` is allowed here and means ONE thing: the SSH target saved in Server
            // Repo. It deliberately carries no host, user or key -- a link able to name those
            // could decide which machine BMM reads mods from and which private key it opens to
            // do it. Everything else must still be http(s).
            if (!/^https?:\/\//i.test(repoUrl) && repoUrl.trim().toLowerCase() !== 'ssh://') {
                toast(t('toast.deeplinkInvalidPath') || 'Deep link: invalid path', 'error');
                return;
            }
            // The same source credentials as everywhere else, applied before the screen opens
            // so the sync it starts is already signed and already knows the password.
            if (/^https?:\/\//i.test(repoUrl)) await applySourceAccess(repoUrl, parsedUrl.searchParams);
            // Navigate to the repo page so the user can complete the sync from there
            const navBtn = document.querySelector('[data-view="repo"]') as HTMLElement;
            if (navBtn) navBtn.click();
            toast(t('plugins.deepLinkSyncRepoNav') || 'Ouvre la page Serveur Repo pour lancer la synchronisation.', 'info');
            // Pre-fill the sync form and auto-fetch via the repo page's bmm:repo-focus handler
            // (the same path the API/Quick Test uses). Honours the optional params — including
            // a download password for a password-protected self-hosted repo.
            const sp = parsedUrl.searchParams;
            const profileId = sp.get('profile');
            const localProfile = sp.get('local_profile');
            const prefill: any = { url: repoUrl };
            if (sp.get('game_dir')) prefill.gameDir = sp.get('game_dir');
            if (sp.get('mods_dir')) prefill.modsDir = sp.get('mods_dir');
            if (sp.get('backup_dir')) prefill.backupDir = sp.get('backup_dir');
            if (sp.get('password')) prefill.password = sp.get('password');
            if (profileId) prefill.choices = [{ repoProfileId: profileId, ...(localProfile ? { targetLocalProfileId: localProfile } : {}) }];
            setTimeout(() => {
                document.dispatchEvent(new CustomEvent('bmm:repo-focus', { detail: { section: 'sync', prefill } }));
            }, 400);
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
            if (!apiPath.startsWith('/api/')) { toast(t('toast.deeplinkInvalidPath') || 'Deep link: invalid path', 'error'); return; }
            const params: Record<string, string> = {};
            parsedUrl.searchParams.forEach((v, k) => { if (k !== 'method' && k !== 'path') params[k] = v; });
            // Any website can trigger a bmm:// link, so the gate asks before EVERY call from
            // outside — GET included, since a GET is not guaranteed to change nothing. The
            // app's own callers (scheduler, local API) are not asked.
            try {
                const tok = await getApiToken();
                const opts: RequestInit = { method, headers: { 'Authorization': `Bearer ${tok}` } };
                if (method === 'GET' || method === 'DELETE') {
                    const qs = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
                    if (qs) apiPath += (apiPath.includes('?') ? '&' : '?') + qs;
                } else if (Object.keys(params).length) {
                    (opts.headers as any)['Content-Type'] = 'application/json';
                    // Coerce booleans/numbers where obvious
                    const body: Record<string, any> = {};
                    for (const [k, v] of Object.entries(params)) {
                        body[k] = v === 'true' ? true : v === 'false' ? false : (/^-?\d+$/.test(v) ? Number(v) : v);
                    }
                    opts.body = JSON.stringify(body);
                }
                const r = await fetch(`${apiBase()}${apiPath}`, opts);
                if (r.ok) { toast(`${method} ${apiPath.split('?')[0]} ✓`, 'success'); window._refreshModsFn?.(true); }
                else toast(`${method} ${apiPath.split('?')[0]} → ${r.status}`, 'error');
            } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
            return;
        }

        // ── Repo: gen / update / host ─────────────────────────────────────
        if (action === 'repo/gen' || action === 'repo/update' || action === 'repo/host') {
            const navBtn = document.querySelector('.nav-item[data-view="repo"], [data-view="repo"]') as HTMLElement | null;
            navBtn?.click();
            const section = action === 'repo/gen' ? 'gen' : action === 'repo/update' ? 'update' : 'host';
            const prefill: any = {};
            if (action === 'repo/update') prefill.repoDir = parsedUrl.searchParams.get('dir') || '';
            if (action === 'repo/host') {
                prefill.serveDir = parsedUrl.searchParams.get('dir') || '';
                const port = parsedUrl.searchParams.get('port'); if (port) prefill.port = parseInt(port, 10);
            }
            setTimeout(() => document.dispatchEvent(new CustomEvent('bmm:repo-focus', { detail: { section, prefill } })), 400);
            toast(t('deeplink.opened', { action }), 'info');
            return;
        }

        // ── Publish an exported repo over SSH ──
        //
        // `?target=` names WHICH saved target; it still cannot say what a target is. A link
        // able to name a host and a key path would let any page the user clicks decide where
        // their repo is uploaded and which private key is read to do it. A NAME refers to a
        // machine the owner already configured and resolves to nothing if they did not —
        // which is the difference between choosing among your own servers and being handed
        // one. Absent still means the default target, as before.
        if (action === 'repo/publish-ssh') {
            const suggested = parsedUrl.searchParams.get('dir') || '';
            if (!suggested) { toast(t('repo.ssh.pickExportFirst'), 'error'); return; }
            // A link only SUGGESTS the folder to upload; the person picks it (the picker opens
            // there). Otherwise any page could upload any folder of theirs to their server.
            const dir = await chooseFolder(suggested, trusted);
            if (!dir) return;
            const { publishStoredTarget } = await import('../features/repo/repo-ssh.js');
            const target = (parsedUrl.searchParams.get('target') || '').trim();
            toast(t('repo.ssh.testing'), 'info');
            try {
                const bytes = await publishStoredTarget(dir, target || undefined);
                toast(t('repo.ssh.uploaded').replace('{n}', '✓').replace('{size}', String(bytes)), 'success', 7000);
            } catch (e) {
                toast(String((e as Error)?.message || e), 'error', 9000);
            }
            return;
        }

        // ── Fetch a repo back DOWN over SSH ──
        //
        // Same rule as publishing: the target comes from Settings, never from the URL.
        // It matters more here, not less — a link that could name a host would be able to
        // pull arbitrary files from a machine of its choosing onto the user's disk.
        //
        // This one asks first. Publishing overwrites files on a server the user configured;
        // fetching overwrites files on their own machine, and a link is something you click
        // before you know what it does.
        if (action === 'repo/fetch-ssh') {
            const dir = parsedUrl.searchParams.get('dir') || '';
            if (!dir) { toast(t('repo.ssh.pickExportFirst'), 'error'); return; }
            const { pullStoredTarget } = await import('../features/repo/repo-ssh.js');
            const ok = await askConfirm(
                t('repo.ssh.pullConfirm').replace('{dir}', dir),
                { title: t('repo.ssh.pull'), type: 'warning' },
            );
            if (!ok) return;
            toast(t('repo.ssh.testing'), 'info');
            try {
                const bytes = await pullStoredTarget(dir);
                toast(t('repo.ssh.pulled').replace('{n}', '✓').replace('{size}', String(bytes)), 'success', 7000);
            } catch (e) {
                toast(String((e as Error)?.message || e), 'error', 9000);
            }
            return;
        }

        // ── Mod updates: check / apply ────────────────────────────────────
        if (action === 'mod/check-updates') {
            const navBtn = document.querySelector('.nav-item[data-view="repo"], [data-view="repo"]') as HTMLElement | null;
            navBtn?.click();
            setTimeout(() => { import('../features/repo/mod-updates.js').then(m => m.checkModUpdates(false)).catch(() => {}); }, 400);
            toast(t('deeplink.opened', { action }), 'info');
            return;
        }
        if (action === 'mod/update') {
            const url = parsedUrl.searchParams.get('url') || '';
            const navBtn = document.querySelector('.nav-item[data-view="repo"], [data-view="repo"]') as HTMLElement | null;
            navBtn?.click();
            setTimeout(() => {
                if (url) document.dispatchEvent(new CustomEvent('bmm:repo-focus', { detail: { section: 'connect', prefill: { url } } }));
                else import('../features/repo/mod-updates.js').then(m => m.checkModUpdates(false)).catch(() => {});
            }, 400);
            toast(t('deeplink.opened', { action }), 'info');
            return;
        }

        // ── BetterCommunity catalog install: bmm://catalog/<kind>/install ──
        // The web (bettercommunity) generates these for its catalog items. Kind is
        // app | plugin | theme; `url` is the download (payload) and `name` the label.
        // `catalogRoute` and not `startsWith('catalog/') && endsWith('/install')`: the gate
        // matches the action whole, so a prefix match here meant `catalog/app/x/install`
        // was an unknown action to the gate — admitted with no dialog and no hard limit —
        // and an app install to this line, which downloads and runs the payload. One parser
        // for both sides (deeplink-guard.ts) is what stops them reading a link differently.
        if (catalogRoute(action)?.verb === 'install') {
            const kind = catalogRoute(action)!.kind;
            const url = parsedUrl.searchParams.get('url') || '';
            const name = parsedUrl.searchParams.get('name') || kind;
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || kind;
            // No download URL → open the matching catalog view so the user can pick it.
            if (!url) {
                const view = kind === 'app' ? 'apps' : kind === 'theme' ? 'themes' : 'plugins';
                (document.querySelector(`[data-view="${view}"]`) as HTMLElement | null)?.click();
                toast(`${t('common.openInBmm') || 'Opened'}: ${name}`, 'info');
                return;
            }
            // The gate already refused anything but https, a script payload, and (apps) a
            // link with no sha256; the user saw the host before this line. The link_* commands
            // enforce the same limits in Rust.
            try {
                if (kind === 'app') {
                    await invoke('link_install_app', {
                        appId: slug, appTitle: name, downloadUrl: url,
                        fileType: parsedUrl.searchParams.get('type') || 'exe',
                        installPath: null,
                        sha256: parsedUrl.searchParams.get('sha256') || null,
                    });
                    toast(`${name} ${t('apps.installed') || 'installed'}`, 'success');
                } else if (kind === 'plugin') {
                    // Installed DISABLED, with any earlier grant for that id cleared.
                    await invoke('link_install_plugin', { downloadUrl: url, sha256: parsedUrl.searchParams.get('sha256') || null });
                    toast(`${name} ${t('plugins.installed') || 'installed'} — ${t('dlg.note.pluginDisabled')}`, 'success', 8000);
                    window._refreshModsFn?.(true);
                } else if (kind === 'theme') {
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const themeJson = await res.text();
                    JSON.parse(themeJson); // validate it's a theme JSON before installing
                    await invoke('install_theme', { themeJson });
                    toast(`${name} ${t('themes.installed') || 'installed'}`, 'success');
                } else {
                    toast(`${t('common.error')}: unknown catalog kind "${kind}"`, 'error');
                }
            } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
            return;
        }

        // ── Add a whole catalog as a SOURCE: bmm://catalog/<kind>/add-source?url=… ──
        // The web (bettercommunity) generates these for its catalog.json feeds so a
        // user can subscribe to a community app/plugin/theme catalog in one click.
        if (catalogRoute(action)?.verb === 'add-source') {
            const kind = catalogRoute(action)!.kind; // app | plugin | theme
            const url = parsedUrl.searchParams.get('url') || '';
            if (!url || !/^https?:\/\//i.test(url)) {
                toast(t('plugins.deepLinkMissingUrl') || 'URL manquante dans le deep link.', 'error');
                return;
            }
            const confirmed = await window.confirmCustom!(
                t('catalog.addSourceTitle') || 'Add a catalog source?',
                `<p style="font-size:13px;line-height:1.5;margin:10px 0 4px;">${t('catalog.addSourceDesc') || `Add this ${kind} catalog as a source in BMM?`}</p>
                 <div style="font-size:11px;font-family:var(--font-mono);background:rgba(0,0,0,0.3);padding:6px 10px;border-radius:6px;word-break:break-all;margin-top:8px;color:var(--text-muted);">${escHtml(url)}</div>`,
                'accent',
                { yesLabel: t('common.yes'), noLabel: t('common.no') }
            );
            if (!confirmed) return;
            try {
                const view = kind === 'app' ? 'apps' : kind === 'theme' ? 'themes' : 'plugins';
                if (kind === 'app') {
                    await invoke('add_community_source', { url }); // app sources live in the Rust backend
                } else if (kind === 'plugin' || kind === 'theme') {
                    // Through the shared helpers, not a second copy of the same rule. This path
                    // used to name the storage keys itself and dedupe with `includes` — case
                    // SENSITIVE, while addSource is not — so a link differing only in case added
                    // a duplicate that every other screen already considered followed.
                    const { STORE_KEY, addSource, recordHistory } = await import('../features/catalogs/catalog-index.js');
                    const KEY = STORE_KEY[kind];
                    let list: string[] = [];
                    try { list = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { list = []; }
                    if (addSource(list, url)) {
                        localStorage.setItem(KEY, JSON.stringify(list));
                        // So a source added by a link can be brought back like any other.
                        recordHistory({ action: 'add', type: kind, url, via: 'deeplink' });
                    }
                } else {
                    toast(`${t('common.error')}: unknown catalog kind "${kind}"`, 'error');
                    return;
                }
                // Open the matching view so the new source loads + renders.
                (document.querySelector(`[data-view="${view}"]`) as HTMLElement | null)?.click();
                toast(t('catalog.sourceAdded') || 'Catalog source added.', 'success');
            } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
            return;
        }

        // ── App Catalog: install / launch ─────────────────────────────────
        if (action === 'app/install') {
            const id = parsedUrl.searchParams.get('id');
            const url = parsedUrl.searchParams.get('url');
            if (!id || !url) { toast(t('plugins.deepLinkMissingUrl') || 'Missing id/url', 'error'); return; }
            // https, a sha256 that must match, no scripts: refused by the gate otherwise, and
            // again by link_install_app. A `path` is only where the folder picker starts.
            const suggested = parsedUrl.searchParams.get('path') || '';
            let installPath: string | null = null;
            if (suggested) {
                installPath = await chooseFolder(suggested, trusted);
                if (!installPath) return;
            }
            try {
                await invoke('link_install_app', {
                    appId: id,
                    appTitle: parsedUrl.searchParams.get('title') || id,
                    downloadUrl: url,
                    fileType: parsedUrl.searchParams.get('type') || 'exe',
                    installPath,
                    sha256: parsedUrl.searchParams.get('sha256') || null,
                });
                toast(`${parsedUrl.searchParams.get('title') || id} ${t('apps.installed') || 'installed'}`, 'success');
            } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
            return;
        }
        if (action === 'app/launch') {
            // Only an app BMM registered, by id. `exe=` is refused by the gate: a link that
            // could name a path could run anything on the disk (a .ps1 was started with
            // -ExecutionPolicy Bypass). link_launch_app looks the program up itself and
            // refuses anything that is not a plain .exe.
            const id = parsedUrl.searchParams.get('id');
            if (!id) { toast(t('plugins.deepLinkMissingId') || 'Missing id', 'error'); return; }
            try { await invoke('link_launch_app', { appId: id }); toast(`${t('apps.launched') || 'Launched'}: ${id}`, 'success'); }
            catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
            return;
        }

        // ── Modpack: create from a profile (via local API) ───────────────
        if (action === 'modpack/create') {
            const name = parsedUrl.searchParams.get('name');
            const profileId = parsedUrl.searchParams.get('profile');
            if (!name) { toast(t('plugins.deepLinkMissingId') || 'Missing name', 'error'); return; }
            try {
                const tok = await getApiToken();
                const r = await fetch(apiBase() + '/api/modpacks/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
                    body: JSON.stringify({ name, source_profile_id: profileId || undefined }),
                });
                if (r.ok) { toast(`${t('plugins.actionCreateModpack') || 'Modpack created'}: ${name}`, 'success'); window._refreshModsFn?.(true); }
                else toast(`${t('common.error')}: ${r.status}`, 'error');
            } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
            return;
        }

        // ── Language: import a translation file by path ───────────────────
        if (action === 'language/import') {
            // A bare path reads whatever local file is named: the gate refused a network or
            // relative path and asked about any other, before this line.
            const path = parsedUrl.searchParams.get('path');
            try { await invoke('import_language', { path: path || null }); toast(t('settings.langImported') || 'Language imported', 'success'); }
            catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
            return;
        }

        // ── Language: install a shared translation embedded in the link ───
        if (action === 'language/import-inline') {
            const data = parsedUrl.searchParams.get('data');
            const code = parsedUrl.searchParams.get('code') || 'custom';
            const gz   = parsedUrl.searchParams.get('gz') === '1';
            if (data) {
                try {
                    // base64url → bytes
                    const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
                    const bin = atob(b64);
                    let content: string;
                    if (gz) {
                        const bytes = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                        const ds = new (window as any).DecompressionStream('gzip');
                        const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
                        content = new TextDecoder().decode(buf);
                    } else {
                        content = decodeURIComponent(escape(bin));
                    }
                    const installed: string = await invoke('import_language_data', { code, content });
                    toast(`${t('settings.langImported') || 'Language imported'}: ${installed}`, 'success');
                } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
            }
            return;
        }

        // ── Restart BMM (via local API) ───────────────────────────────────
        if (action === 'restart') {
            try {
                const tok = await getApiToken();
                await fetch(apiBase() + '/api/restart', { method: 'POST', headers: { 'Authorization': `Bearer ${tok}` } });
            } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
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
                } catch (e) { toast(String(e), 'error'); }
            }
            return;
        }

        if (action === 'theme/editor') {
            (window as any).openThemeEditor?.();
            return;
        }

        // Jump to any screen: bmm://view/open?id=<library|profiles|mapper|repo|…>
        //
        // docs/open has navigated by clicking the sidebar item since it was written; this is
        // the same two lines made general, because "open the docs" was never the only screen
        // worth linking to. BMM Docs can now point at the screen a page describes, and the
        // local API can walk the app without anybody touching a mouse — which is what makes
        // a scripted .bmmreplay recording possible at all.
        //
        // The id IS the sidebar's data-view value, so the set of valid ids is whatever the
        // sidebar has, and an unknown id does nothing rather than throwing. Deliberately not
        // validated against a hard-coded list: a list here would be a second copy of the
        // navigation that could disagree with it.
        if (action === 'view/open') {
            const id = parsedUrl.searchParams.get('id');
            if (!id) return;
            const item = document.querySelector(`.nav-item[data-view="${CSS.escape(id)}"]`) as HTMLElement | null;
            if (item) item.click();
            else console.warn(`[deeplink] view/open: no screen named "${id}"`);
            return;
        }

        // Publish a catalogue from what this BMM holds.
        //
        //   bmm://catalog/publish?kind=theme&dir=C:/out&name=My%20themes&base=https://x/y
        //
        // The kinds are `BUILDABLE_KINDS`, and the builder is the scheduler's own — a second
        // implementation here would be a second set of the shapes each catalogue format
        // expects, and the format is the part that has to be right.
        //
        // Until this existed, publishing was reachable from a scheduled task and by no other
        // means: exactly the gap that once made FOLLOWING a catalogue clickable-only.
        if (action === 'catalog/publish') {
            const kind = (parsedUrl.searchParams.get('kind') || 'tutorial').trim();
            const suggestedDir = (parsedUrl.searchParams.get('dir') || '').trim();
            const name = (parsedUrl.searchParams.get('name') || '').trim() || 'My catalogue';
            const base = (parsedUrl.searchParams.get('base') || '').trim().replace(/\/+$/, '');
            if (!suggestedDir) { toast(t('cat.pubNoDir'), 'warning', 8000); return; }
            // From outside, the link only suggests the folder; the person picks where to write.
            const dir = await chooseFolder(suggestedDir, trusted);
            if (!dir) return;
            const { BUILDABLE_KINDS, buildCatalogueInto } = await import('../features/settings/scheduler.js');
            if (!BUILDABLE_KINDS.some((k) => k.kind === kind)) {
                // Named rather than guessed at. Falling through to a default would write a
                // catalogue of the wrong thing into somebody's folder and report success.
                toast(t('cat.pubBadKind').replace('{k}', kind)
                    .replace('{list}', BUILDABLE_KINDS.map((k) => k.kind).join(', ')), 'warning', 10000);
                return;
            }
            try {
                const wrote = await buildCatalogueInto(kind, dir, name, base);
                // Nothing written is not a success. A catalogue with no entries is a file that
                // looks published and installs nothing.
                if (!wrote) toast(t('cat.pubEmpty').replace('{k}', kind), 'warning', 10000);
                else toast(t('cat.pubDone').replace('{n}', String(wrote)).replace('{k}', kind), 'success', 9000);
            } catch (e) {
                toast(`${t('common.error')}: ${e}`, 'error', 10000);
            }
            return;
        }

        // Follow / stop following a catalogue.
        //
        //   bmm://catalog/follow?type=theme&url=https://…/catalog.json
        //   bmm://catalog/unfollow?type=theme&url=…
        //
        // The catalogue source lists live in localStorage, which is the right place for them
        // and a place nothing outside the interface can reach — so until this existed the
        // whole subsystem could be driven by clicking and by no other means. Every other
        // route in (the API, the CLI, an assistant, a scheduled task) comes through here.
        //
        // It goes through the SCREENS' own store rather than writing localStorage directly,
        // so a source added this way appears in the following list, carries an origin, and
        // is removable by the button that removes the others.
        if (action === 'catalog/follow' || action === 'catalog/unfollow') {
            const type = parsedUrl.searchParams.get('type') || '';
            const url = parsedUrl.searchParams.get('url') || '';
            // A catalogue can be password-protected, exactly as a repo can. Remembered for
            // this run only, which is the rule the source-access panel already states: a
            // password is never written to disk. Following an unprotected one is unchanged.
            await applySourceAccess(url, parsedUrl.searchParams);
            const { STORE_KEY, addSource, removeSource, rememberOrigin, forgetOrigin, recordHistory } =
                await import('../features/catalogs/catalog-index.js');
            const { writeSources } = await import('../features/catalogs/catalog-sources.js');

            // `app` is the one type whose sources live in the Rust backend rather than in
            // localStorage, so it has its own command. Special-cased here exactly as it is
            // in importIndexForType — one exception, stated twice, rather than a second
            // store invented to make it uniform.
            if (type === 'app') {
                if (!url) return;
                try {
                    await invoke(action === 'catalog/follow' ? 'add_community_source' : 'remove_community_source', { url });
                    toast(t(action === 'catalog/follow' ? 'cat.followed' : 'cat.unfollowed'), 'success');
                } catch (e) { toast(String(e), 'error'); }
                return;
            }

            const key = STORE_KEY[type];
            if (!key || !url) {
                // Named. "Nothing happened" for a type that does not exist is the failure
                // somebody spends an afternoon on.
                toast(t('cat.badType').replace('{t}', type || '?'), 'warning', 8000);
                return;
            }
            let list: string[] = [];
            try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch { list = []; }
            if (!Array.isArray(list)) list = [];

            if (action === 'catalog/follow') {
                if (!/^https?:\/\//i.test(url) && !url.startsWith('bundle:')) {
                    toast(t('cat.badUrl'), 'warning', 8000);
                    return;
                }
                if (!addSource(list, url)) { toast(t('cat.already'), 'info'); return; }
                writeSources(key, list);
                rememberOrigin(url, 'deeplink');
                recordHistory({ action: 'add', type, url, via: 'deeplink' });
                toast(t('cat.followed'), 'success');
            } else {
                const { list: next, removed } = removeSource(list, url);
                if (!removed) { toast(t('cat.notFollowed'), 'info'); return; }
                writeSources(key, next);
                forgetOrigin(url);
                recordHistory({ action: 'remove', type, url });
                toast(t('cat.unfollowed'), 'success');
            }
            return;
        }

        // Follow whatever is at this address, without being told what it is.
        //
        //   bmm://catalog/import?url=https://…/something.json
        //   bmm://catalog/import?url=…&type=plugin      (only that kind, out of an index)
        //   bmm://catalog/import?url=…&password=…       (a protected source)
        //
        // `catalog/follow` needs the kind in the link, and a link that carries the wrong one
        // is followed into the wrong list — a theme catalogue sitting in the plugin browser,
        // fetched on every start, showing nothing. Whoever pastes an address usually does not
        // know which of the eight kinds it is; the DOCUMENT does.
        //
        // Reads through fetchSourceText, so a protected catalogue is asked for its password
        // exactly as everywhere else, and then hands off to the same importer and the same
        // writer the screens use. Nothing about what a catalogue IS is decided here.
        if (action === 'catalog/import') {
            const url = parsedUrl.searchParams.get('url') || '';
            const want = parsedUrl.searchParams.get('type') || '';
            if (!/^https?:\/\//i.test(url)) { toast(t('cat.badUrl'), 'warning', 8000); return; }
            await applySourceAccess(url, parsedUrl.searchParams);
            let doc: unknown;
            try {
                const { fetchSourceText } = await import('./source-fetch.js');
                doc = JSON.parse(await fetchSourceText(url));
            } catch (e) {
                // The address, and why. "Could not import" on its own is the message that
                // sends somebody to check their internet when the file was not JSON.
                toast(`${t('cat.importFailed') || 'Could not read that address'} — ${String(e).slice(0, 120)}`, 'error', 9000);
                return;
            }
            const ix = await import('../features/catalogs/catalog-index.js');
            const cs = await import('../features/catalogs/catalog-sources.js');

            if (ix.looksLikeIndex(doc)) {
                // An index lists catalogues for several kinds. With no `type` every routable
                // one is taken, which is what "import this index" means; with a `type`, only
                // that one — the same restraint importIndexForType already applies.
                const kinds = want ? [want] : (ix.ROUTABLE as readonly string[]);
                let added = 0;
                for (const k of kinds) {
                    try {
                        const r = await ix.importIndexForType(doc as any, k as any, url, undefined, cs.writeSources);
                        added += r.added || 0;
                    } catch { /* one kind failing must not stop the rest */ }
                }
                toast(added
                    ? (t('cat.importedN') || '{n} catalogue(s) followed').replace('{n}', String(added))
                    : (t('cat.importedNone') || 'Nothing new in that index'), added ? 'success' : 'info', 7000);
                return;
            }

            // Not an index: one catalogue. Work out which kind it is from its own shape, and
            // refuse rather than guess — a document that matches nothing is not a catalogue,
            // and following it would put an address in a list that fetches it for ever.
            const kind = want || (ix.INDEX_TYPES as readonly string[])
                .find((k) => ix.catalogLooksLike(doc, k)) || '';
            if (!kind || !ix.catalogLooksLike(doc, kind)) {
                toast(t('cat.importUnknown') || 'That address is not a catalogue this app knows', 'warning', 9000);
                return;
            }
            // Followed through the same path the link with a type takes, so there is one
            // implementation of "follow", with its history entry and its origin.
            // 'self': the person already answered the gate for this import; asking twice for
            // one click would teach them to click through.
            await handleDeepLink(`bmm://catalog/follow?type=${encodeURIComponent(kind)}&url=${encodeURIComponent(url)}`, 'self');
            return;
        }

        // One entry of a catalogue this machine AUTHORS — not one it follows.
        //
        //   bmm://catalog/entry?mode=add&type=plugin&id=my-plugin&fields={"name":"…"}
        //   bmm://catalog/entry?mode=update&type=plugin&id=my-plugin&fields={"version":"2"}
        //   bmm://catalog/entry?mode=remove&type=plugin&id=my-plugin
        //
        // The two senses of "catalogue" are worth keeping apart: the ones you FOLLOW are
        // addresses and live with the screens, the ones you AUTHOR are documents on this disk.
        // This is the second kind. `catalog/follow` is the first.
        if (action === 'catalog/entry') {
            const mode = parsedUrl.searchParams.get('mode') || 'add';
            const kind = parsedUrl.searchParams.get('type') || 'app';
            const id = parsedUrl.searchParams.get('id') || '';
            const raw = parsedUrl.searchParams.get('fields') || '';
            let fields: unknown = null;
            if (raw) {
                // Refused rather than sent on as text. A catalogue entry whose fields are the
                // STRING "{...}" is valid JSON and installs nothing.
                try { fields = JSON.parse(raw); }
                catch { toast(t('cat.badFields') || 'The fields are not valid JSON', 'warning', 8000); return; }
            }
            try {
                const r: any = await invoke('catalog_entry', { kind, mode, id, fields });
                toast((t('cat.entryOk') || '{mode}: {id} — {n} entr(ies)')
                    .replace('{mode}', mode).replace('{id}', id).replace('{n}', String(r?.total ?? '?')), 'success');
            } catch (e) { toast(String(e), 'error', 9000); }
            return;
        }

        // Throw away a whole authored catalogue.
        //
        //   bmm://catalog/delete?type=plugin
        //
        // Asks first. It is one click from a link somebody else wrote, and the thing it
        // removes is a document this machine authored rather than an address it can follow
        // again in a second.
        if (action === 'catalog/delete') {
            const kind = parsedUrl.searchParams.get('type') || 'app';
            const ok = await askConfirm(
                (t('cat.deleteAsk') || 'Delete the {k} catalogue you author on this machine?').replace('{k}', kind),
                { title: t('cat.deleteTitle') || 'Delete a catalogue', type: 'warning' },
            );
            if (!ok) return;
            try {
                await invoke('catalog_drop', { kind });
                toast((t('cat.deleted') || '{k} catalogue deleted').replace('{k}', kind), 'success');
            } catch (e) { toast(String(e), 'error', 9000); }
            return;
        }

        // Open a Help & Other article in-app. Lets BMM Docs (the website) link straight
        // into the integrated docs: bmm://docs/open?article=<id> (or no id → docs home).
        if (action === 'docs/open') {
            const id = parsedUrl.searchParams.get('article');
            (document.querySelector('.nav-item[data-view="docs"]') as HTMLElement | null)?.click();
            if (id) (window as any).openDocsArticleById?.(id);
            else (window as any).openDocsHome?.();
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
                    toast(`${t('themes.imported')||'Theme installed'}: ${theme.name}`, 'success');
                } catch (e) { toast(String(e), 'error'); }
            }
            return;
        }

        // ── Settings card layout (reorderable cards) ─────────────────────────
        if (action === 'settings/layout') {
            const code = parsedUrl.searchParams.get('code');
            if (code) {
                try { sessionStorage.setItem('bmm_pending_layout', code); } catch {}
                const navBtn = document.querySelector('.nav-item[data-view="settings"], [data-view="settings"]') as HTMLElement | null;
                navBtn?.click();
                setTimeout(() => { import('../features/settings/card-order.js').then(m => m.initCardReorder()).catch(() => {}); }, 600);
            }
            return;
        }

        // ── Navbar customization (shared layout) ─────────────────────────────
        if (action === 'settings/navbar') {
            const code = parsedUrl.searchParams.get('code');
            if (code) {
                import('../ui/navbar-customize.js').then(m => {
                    if (m.applyNavCodeFromLink?.(code)) (window as any).toast?.('Navigation applied', 'success');
                }).catch(() => {});
            }
            return;
        }

        // ── Scheduler: run a specific task by id (Windows Task Scheduler hook) ──
        // ── Scheduled tasks: bmm://schedule/run?id=…  ·  bmm://schedule/enable?id=…&on=0|1
        //
        // Both ASK first, and the question names the task rather than its id.
        //
        // Task ids are minted as `sched-<Date.now()>` — a millisecond timestamp, which is
        // predictable in a way a random id is not. Running one of somebody's tasks is not a
        // navigation, it is executing whatever they wrote in it, up to and including a script
        // step. A link that could do that silently would only have to guess when the task was
        // created. So the id stops being a secret and the person watching decides.
        if (action === 'schedule/run' || action === 'schedule/enable') {
            // A boolean, not a second equality test against `action`: deeplink-map.mjs ends
            // a handler's block at the next such test, so a nested one splits this handler
            // in two and gives schedule/enable a parameter list that is not its own.
            // (Writing the pattern out in this comment did it too, which is how I found it.)
            const isRun = action === 'schedule/run';
            const id = parsedUrl.searchParams.get('id');
            if (!id) {
                toast(t('sched.dl.noId'), 'error');
                return;
            }
            const sched = await import('../features/settings/scheduler.js');
            const task = await sched.findTask(id);
            if (!task) {
                // Named, because the usual cause is a link written against another machine's
                // BMM — and "no task with that id" is the one answer that tells you so.
                toast(`${t('sched.dl.noTask')} ${id}`, 'warning', 9000);
                return;
            }
            // The Windows Scheduled Task mirror launches THIS link, at an hour when nobody is
            // there to answer a question. It carries a key minted on this machine and kept in
            // settings — never shown, never sent anywhere, and not the API token, because
            // resetting that one is an ordinary thing to do and would quietly turn every
            // registered task into a prompt. A page can write the id; it cannot write this.
            if (isRun) {
                const k = parsedUrl.searchParams.get('k') || '';
                if (k) {
                    const expected = await invoke('get_os_schedule_key').catch(() => '') as string;
                    // No feedback either way: the link answers nothing to whoever opened it, so
                    // a wrong key simply falls through to the question below.
                    if (expected && k === expected) {
                        await sched.runTaskById(id).catch(() => {});
                        return;
                    }
                }
            }
            const steps = (task.steps || []).filter((s: any) => !s.disabled).length;
            const label = escHtml(task.name || id);
            let title: string;
            let body: string;
            let tone: 'accent' | 'danger' = 'accent';
            if (isRun) {
                title = t('sched.dl.runTitle');
                // Whether it may run programs is the fact that changes the answer, so it is
                // in the question and not in a tooltip somewhere.
                const perms = task.allowCustomCommands ? t('sched.dl.runsPrograms') : t('sched.dl.noPrograms');
                body = `<p style="font-size:13px;line-height:1.5;margin:10px 0 4px;">${t('sched.dl.runDesc')}</p>
                        <div style="font-size:12px;background:rgba(0,0,0,0.3);padding:8px 10px;border-radius:6px;margin-top:8px;">
                            <b>${label}</b><br><span style="color:var(--text-muted);">${escHtml(t('sched.dl.steps').replace('{n}', String(steps)))} · ${escHtml(perms)}</span>
                        </div>`;
                if (task.allowCustomCommands) tone = 'danger';
            } else {
                const on = parsedUrl.searchParams.get('on') !== '0';
                title = on ? t('sched.dl.armTitle') : t('sched.dl.disarmTitle');
                body = `<p style="font-size:13px;line-height:1.5;margin:10px 0 4px;">${on ? t('sched.dl.armDesc') : t('sched.dl.disarmDesc')}</p>
                        <div style="font-size:12px;background:rgba(0,0,0,0.3);padding:8px 10px;border-radius:6px;margin-top:8px;"><b>${label}</b></div>`;
            }
            const ok = await window.confirmCustom!(title, body, tone,
                { yesLabel: t('common.yes'), noLabel: t('common.no') });
            if (!ok) return;
            if (isRun) {
                await sched.runTaskById(id).catch((e) => toast(`${t('common.error')}: ${e}`, 'error'));
            } else {
                const on = parsedUrl.searchParams.get('on') !== '0';
                await sched.setTaskEnabled(id, on);
                toast(on ? t('sched.dl.armed') : t('sched.dl.disarmed'), 'success');
            }
            return;
        }

        // ── A task's run log: bmm://schedule/runs?id=… ──────────────────────
        //
        // Read-only: the same panel as the task's History button. An id that names no task
        // opens an empty log, which says nothing about which ids exist.
        if (action === 'schedule/runs') {
            const id = parsedUrl.searchParams.get('id');
            if (!id) { toast(t('sched.dl.noId'), 'error'); return; }
            const sched = await import('../features/settings/scheduler.js');
            await sched.openRunLog(id);
            return;
        }

        // ── The resource governor (A4) ───────────────────────────────────────
        //
        // `resources/open` shows the Storage manager, where the live dashboard is.
        // `resources/preset?name=` picks a NAMED preset: the gate asked an external caller
        // (one question per 10 s) and refused any name it does not know. Nothing finer — a
        // per-disk rule — can be set by a link at all.
        if (action === 'resources/open') {
            (window as any).bmmOpenStorageManager?.();
            return;
        }
        if (action === 'resources/preset') {
            const name = (parsedUrl.searchParams.get('name') || '').trim().toLowerCase();
            try {
                await invoke('resources_set_preset', { name, scope: 'persistent', ttlSecs: null, overridesGame: null });
                console.info(`[BMM] resources: preset ${name} set by a link (${adm.origin})`);
                toast(t('resources.link.presetSet').replace('{name}', name), 'success', 5000);
            } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
            return;
        }

        // ── Ring a hook: bmm://hook?name=…[&data=…] ─────────────────────────
        //
        // The counterpart of `POST /api/hook` for something that cannot hold an API token — a
        // browser, a game's launcher, a shortcut on the desktop.
        //
        // It asks, for the same reason: a task waiting on a hook runs when the hook rings, so
        // ringing one is running that task at one remove. Hook names are chosen by whoever
        // wrote the task and are often obvious (`joined-server`), which makes them easier to
        // guess than the ids above, not harder.
        if (action === 'hook') {
            const name = parsedUrl.searchParams.get('name');
            if (!name) {
                toast(t('sched.dl.noHook'), 'error');
                return;
            }
            const ok = await window.confirmCustom!(
                t('sched.dl.hookTitle'),
                `<p style="font-size:13px;line-height:1.5;margin:10px 0 4px;">${t('sched.dl.hookDesc')}</p>
                 <div style="font-size:12px;font-family:var(--font-mono);background:rgba(0,0,0,0.3);padding:6px 10px;border-radius:6px;margin-top:8px;word-break:break-all;">${escHtml(name)}</div>`,
                'accent', { yesLabel: t('common.yes'), noLabel: t('common.no') });
            if (!ok) return;
            try {
                const raw = parsedUrl.searchParams.get('data');
                // Sent as text when it is not JSON. A link carrying `data=hello` is a caller
                // saying hello, not a caller making a mistake.
                let data: unknown = raw;
                if (raw) { try { data = JSON.parse(raw); } catch { data = raw; } }
                await invoke('hook_fire', { name, data: data ?? null });
                toast(`${t('sched.dl.hookRang')} ${name}`, 'success');
            } catch (e) { toast(`${t('common.error')}: ${e}`, 'error'); }
            return;
        }

        // ── Benchmark: bmm://benchmark/run?dataset=sandbox&size=M[&mb=512]
        //    [&mode=manual|auto][&sources=path1;path2] ───────────────────────────
        //    mode=auto (default for the deep link) opens the benchmark and starts
        //    it; mode=manual opens it pre-filled and lets the user click Run.
        if (action === 'benchmark/run' || action === 'benchmark/open') {
            const dataset = parsedUrl.searchParams.get('dataset') === 'real' ? 'real' : 'sandbox';
            const size = (parsedUrl.searchParams.get('size') || 'M').toUpperCase();
            const mb = parseInt(parsedUrl.searchParams.get('mb') || '', 10) || undefined;
            const mode = (parsedUrl.searchParams.get('mode') || '').toLowerCase();
            const autoRun = action === 'benchmark/open' ? mode === 'auto' : mode !== 'manual';
            const splitList = (v: string | null) => (v || '').split(/[;|]/).map(s => s.trim()).filter(Boolean);
            const sources = [...splitList(parsedUrl.searchParams.get('sources')), ...splitList(parsedUrl.searchParams.get('folders'))];
            const profiles = splitList(parsedUrl.searchParams.get('profiles'));
            toast(t('bench.deeplinkStart') || `Benchmark (${dataset} ${size})…`, 'info');
            try {
                const { openBenchmarkWithConfig } = await import('../features/bench/benchmark.js');
                await openBenchmarkWithConfig({ dataset, size, mb, sources, profiles, autoRun });
            } catch (e) { toast(`${t('common.error') || 'Error'}: ${e}`, 'error'); }
            return;
        }

        // ── Privacy & telemetry: bmm://telemetry/consent?enabled=1
        //    bmm://telemetry/set?replay=1&full=0&bench=1 ──────────────────────────
        //
        // Any web page can open this link. It used to apply what it said with no question —
        // `?enabled=1&full=1` switched telemetry on with UNMASKED replay. Now a link only
        // REQUESTS a change: BMM's own consent dialog (or, for turning things off, a plain
        // confirmation) decides, and `full=1` is dropped outright — unmasked replay is turned
        // on in Settings → Privacy or not at all. The rule is in telemetry-link.ts.
        if (action === 'telemetry/consent' || action === 'telemetry/set') {
            try {
                const { parseTelemetryLink, planTelemetryLink } = await import('./telemetry-link.js');
                const plan = planTelemetryLink(parseTelemetryLink(parsedUrl.searchParams));
                if (plan.refusedUnmasked) toast(t('analytics.linkNoUnmask') || 'Unmasked replay cannot be turned on from a link. Use Settings → Privacy.', 'warning', 9000);
                if (plan.empty) return;
                const { confirmTelemetryFromLink } = await import('./analytics.js');
                const applied = await confirmTelemetryFromLink(plan);
                toast(applied ? (t('analytics.linkApplied') || 'Telemetry settings updated') : (t('analytics.linkNotApplied') || 'Telemetry settings unchanged'), applied ? 'success' : 'info');
            } catch (e) { toast(`${t('common.error') || 'Error'}: ${e}`, 'error'); }
            return;
        }

        // ── Local Session recorder: bmm://recorder/set?on=1&full=0&rust=1&js=1 ─────
        if (action === 'recorder/set') {
            const q = parsedUrl.searchParams;
            const b = (k: string) => q.has(k) ? (q.get(k) === '1' || q.get(k) === 'true') : undefined;
            // `full=1` (unmasked recording) never reaches this line: the gate drops it for
            // every origin, as telemetry does. Unmasking is a Settings > Privacy decision.
            if (adm.dropped.includes('full')) toast(t('dlg.note.fullDropped'), 'warning', 9000);
            if (!['on', 'full', 'rust', 'js'].some((k) => q.has(k))) return;
            try {
                const { setWatcherOptions } = await import('../features/settings/replay-watcher.js');
                await setWatcherOptions({ on: b('on'), full: b('full'), rust: b('rust'), js: b('js') });
                toast(t('watcher.title') || 'Recorder updated', 'success');
            } catch (e) { toast(`${t('common.error') || 'Error'}: ${e}`, 'error'); }
            return;
        }

        // ── Session replay export / import:
        //    bmm://replay/export  ·  bmm://replay/import?path=…  |  ?url=… ──────────
        if (action === 'replay/export') {
            // ?path= writes straight there and skips the save dialog, for the app's own callers
            // (scheduler, local API) only. From outside, the gate removed `path` after refusing
            // a network one, so the save dialog opens and the person picks where it goes.
            const dest = parsedUrl.searchParams.get('path') || undefined;
            try { await (await import('../features/settings/replay-watcher.js')).exportSession(dest); }
            catch (e) { toast(`${t('common.error') || 'Error'}: ${e}`, 'error'); }
            return;
        }

        // ── Launch pack: bmm://launchpack/run?id=… ────────────────────────────────
        if (action === 'launchpack/run') {
            const id = parsedUrl.searchParams.get('id') || '';
            try { await invoke('run_launch_pack', { id }); toast(t('settings.lpRunning') || 'Launch pack started', 'success'); }
            catch (e) { toast(`${t('common.error') || 'Error'}: ${e}`, 'error'); }
            return;
        }

        // ── Discord RPC: bmm://discord/rpc?enabled=1 ──────────────────────────────
        if (action === 'discord/rpc') {
            const enabled = parsedUrl.searchParams.get('enabled') === '1' || parsedUrl.searchParams.get('enabled') === 'true';
            try { await (await import('../features/settings/settings.js')).setDiscordRpc(enabled); toast(t(enabled ? 'settings.discordRpcOn' : 'settings.discordRpcOff'), 'success'); }
            catch (e) { toast(`${t('common.error') || 'Error'}: ${e}`, 'error'); }
            return;
        }

        // ── Automated data export: bmm://data/export-auto?dir=…&name=…&increment=… ─
        if (action === 'data/export-auto') {
            const dir = parsedUrl.searchParams.get('dir') || '';
            const name = parsedUrl.searchParams.get('name') || null;
            const increment = parsedUrl.searchParams.get('increment') || null;
            try {
                // A scheduled backup (trusted) writes the full file to the folder its task
                // names. From outside, the person picks the folder and the copy is REDACTED:
                // no token, key or password ever leaves through a link (link_export_app_data).
                let dest: unknown;
                if (trusted) dest = await invoke('export_app_data_auto', { dir, name, increment });
                else {
                    const picked = await chooseFolder(dir, false);
                    if (!picked) return;
                    dest = await invoke('link_export_app_data', { dir: picked, name, increment });
                }
                toast((t('settings.exportSuccess') || 'Data exported') + ': ' + dest, 'success');
            } catch (e) { toast(`${t('common.error') || 'Error'}: ${e}`, 'error'); }
            return;
        }
        if (action === 'replay/import') {
            const path = parsedUrl.searchParams.get('path');
            const url = parsedUrl.searchParams.get('url');
            try {
                const m = await import('../features/settings/replay-watcher.js');
                if (url) await m.importReplayFromUrl(url);
                else if (path) await m.importReplayFromPath(path);
                else await m.importAndPlay();
            } catch (e) { toast(`${t('common.error') || 'Error'}: ${e}`, 'error'); }
            return;
        }

        if (action === 'import' || action === 'install' || action === 'download') {
            const modUrl = parsedUrl.searchParams.get('url');
            const modNameFromUrl = parsedUrl.searchParams.get('name') || t('mod.unknownName') || 'Mod Inconnu';
            
            if (!modUrl) {
                console.warn('[BMM] Deep link missing "url" parameter:', linkForLog(urlStr));
                return;
            }

            let profiles: Profile[] = [];
            let activeId: string | null = null;
            try {
                [profiles, activeId] = await Promise.all([
                    invoke('get_profiles') as Promise<Profile[]>,
                    invoke('get_active_profile_id') as Promise<string | null>
                ]);
            } catch (err) {
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
                            <input type="text" id="new-prof-name" class="input" placeholder="Ex: DCS World 2.9" style="width:100%; padding:8px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:4px; font-size:12px; color:var(--bmm-text-primary);">
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

            const confirmPromise = window.confirmCustom!(
                title,
                customContent,
                'accent',
                { 
                    yesLabel: t('common.yes'), 
                    noLabel: t('common.no') 
                }
            );

            setTimeout(() => {
                const select = document.getElementById('import-mod-profile') as HTMLSelectElement | null;
                const newFields = document.getElementById('new-profile-fields') as HTMLElement | null;
                const yesBtn = document.getElementById('btn-confirm-yes') as HTMLButtonElement | null;
                const modalInner = document.querySelector('#modal-confirm-generic .modal') as HTMLElement | null;
                
                const nameInp = document.getElementById('new-prof-name') as HTMLInputElement;
                const gameInp = document.getElementById('new-prof-game-path') as HTMLInputElement;
                const modsInp = document.getElementById('new-prof-mods-path') as HTMLInputElement;
                const backupInp = document.getElementById('new-prof-backup-path') as HTMLInputElement;

                if (!select || !newFields || !yesBtn || !modalInner) return;

                function validate(): void {
                    const isNew = select!.value === 'NEW';
                    if (isNew) {
                        const ok = !!(nameInp.value.trim() && gameInp.value.trim() && modsInp.value.trim() && backupInp.value.trim());
                        yesBtn!.disabled = !ok;
                        yesBtn!.style.opacity = ok ? '1' : '0.5';
                        yesBtn!.style.cursor = ok ? 'pointer' : 'not-allowed';
                        modalInner!.style.maxWidth = '550px';
                        newFields!.style.display = 'flex';
                    } else {
                        yesBtn!.disabled = false;
                        yesBtn!.style.opacity = '1';
                        yesBtn!.style.cursor = 'pointer';
                        modalInner!.style.maxWidth = '400px';
                        newFields!.style.display = 'none';
                    }
                }

                select.addEventListener('change', validate);

                [nameInp, gameInp, modsInp, backupInp].forEach(inp => {
                    inp.addEventListener('input', validate);
                });

                document.getElementById('btn-pick-import-game')!.onclick = async () => {
                    const p = await pickFolder();
                    if (p) { gameInp.value = p as string; validate(); }
                };
                document.getElementById('btn-pick-import-mods')!.onclick = async () => {
                    const p = await pickFolder();
                    if (p) { modsInp.value = p as string; validate(); }
                };
                document.getElementById('btn-pick-import-backup')!.onclick = async () => {
                    const p = await pickFolder();
                    if (p) { backupInp.value = p as string; validate(); }
                };

                validate();
            }, 100);

            const confirmed = await confirmPromise;

            if (confirmed) {
                const finalName = (document.getElementById('import-mod-name') as HTMLInputElement).value || modNameFromUrl;
                let finalProfileId = (document.getElementById('import-mod-profile') as HTMLSelectElement).value;

                if (finalProfileId === 'NEW') {
                    const newName = (document.getElementById('new-prof-name') as HTMLInputElement).value.trim();
                    const newGamePath = (document.getElementById('new-prof-game-path') as HTMLInputElement).value.trim();
                    const newModsPath = (document.getElementById('new-prof-mods-path') as HTMLInputElement).value.trim();
                    const newBackupPath = (document.getElementById('new-prof-backup-path') as HTMLInputElement).value.trim();
                    
                    try {
                        const profile = await invoke('create_profile', { payload: {
                            name: newName, 
                            gameName: '', 
                            gamePath: newGamePath, 
                            modsPath: newModsPath, 
                            backupPath: newBackupPath, 
                            color: '#3b82f6', 
                            icon: 'star' 
                        } }) as Profile;
                        finalProfileId = profile.id;
                        console.log('[BMM] New profile created from import:', finalProfileId);
                        
                        if (window._refreshProfilesFn) await window._refreshProfilesFn();
                    } catch (err) {
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
                } catch (err) {
                    console.error('[BMM] Mod download failed:', err);
                    toast((t('common.error') || 'Error') + ' : ' + err, 'error');
                }
            }
        }
    } catch (e) {
        console.error('[BMM] Deep link processing error:', e);
    }
}
