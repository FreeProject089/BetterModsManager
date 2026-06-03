/**
 * api_activity.ts
 * Global notifier + log for the local HTTP API (port 51274).
 *
 * The Rust backend emits a `bmm://api-action` event for every API request it
 * serves. We listen here (once, app-wide) so that actions triggered by EXTERNAL
 * callers — scripts, curl, deep-link helpers, other apps — produce the same
 * visible feedback as the in-app Quick Test: a toast notification, a log entry,
 * and a live UI refresh of the affected page.
 *
 * We also keep persistent listeners for the repo sync / HTTP-host progress
 * events so that a sync or server started via the API is visible on the
 * Server Repo page even when the user didn't start it from the UI.
 */

import { toast } from '../ui/app.js';
import { t } from './i18n.js';
import { invoke } from './api.js';

interface ApiActionPayload { method: string; path: string; status: number; }
interface ApiLogEntry { time: number; method: string; path: string; status: number; ok: boolean; label: string; icon: string; }

/** Inline feather-style SVG icons (stroke = currentColor) — no unicode emoji. */
const sv = (p: string) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICN = {
    check:   sv('<path d="M20 6 9 17l-5-5"/>'),
    ban:     sv('<circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/>'),
    list:    sv('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>'),
    edit:    sv('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>'),
    plus:    sv('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
    trash:   sv('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
    play:    sv('<polygon points="5 3 19 12 5 21 5 3"/>'),
    search:  sv('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
    package: sv('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>'),
    globe:   sv('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'),
    link:    sv('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
    info:    sv('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'),
    activity:sv('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'),
    refresh: sv('<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>'),
    stop:    sv('<rect x="5" y="5" width="14" height="14" rx="2"/>'),
    switch:  sv('<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'),
    id:      sv('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h4M15 12h4M7 16h10"/>'),
    server:  sv('<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>'),
};

// Keep only a tiny window in RAM — the full history lives on disk (see
// append_api_log / read_api_log). This prevents both memory growth and the
// render lag that came from re-drawing a large in-memory array.
const MAX_LOG = 50;

declare global {
    interface Window {
        __bmmApiLog?: ApiLogEntry[];
    }
}

/** Human-friendly label + SVG icon for a given METHOD + path (no emoji). */
function describe(method: string, path: string): { label: string; icon: string } {
    // Strip query string for matching
    const p = path.split('?')[0];
    const tl = (k: string, fb: string) => t('plugins.' + k) || fb;
    const map: Array<[RegExp, string, string]> = [
        [/^\/api\/mods\/enable$/,        tl('actionEnableMod', 'Enable mod'),       ICN.check],
        [/^\/api\/mods\/disable$/,       tl('actionDisableMod', 'Disable mod'),     ICN.ban],
        [/^\/api\/mods\/active$/,        tl('actionListActiveMods', 'List active mods'), ICN.list],
        [/^\/api\/mods\/[^/]+$/,         method === 'DELETE' ? tl('actionDeleteMod', 'Delete mod') : tl('actionUpdateMod', 'Update mod'), method === 'DELETE' ? ICN.trash : ICN.edit],
        [/^\/api\/mods$/,                tl('actionListMods', 'List mods'),         ICN.list],
        [/^\/api\/profiles\/activate$/,  tl('actionActivateProfile', 'Switch profile'), ICN.switch],
        [/^\/api\/profiles\/[^/]+$/,     method === 'DELETE' ? tl('actionDeleteProfile', 'Delete profile') : tl('actionUpdateProfile', 'Update profile'), method === 'DELETE' ? ICN.trash : ICN.edit],
        [/^\/api\/profiles$/,            method === 'POST' ? tl('actionCreateProfile', 'Create profile') : tl('actionListProfiles', 'List profiles'), method === 'POST' ? ICN.plus : ICN.list],
        [/^\/api\/plugins\/apply$/,      tl('actionApplyPlugin', 'Apply plugin'),   ICN.play],
        [/^\/api\/plugins\/compare$/,    tl('actionComparePlugin', 'Compare plugin'), ICN.search],
        [/^\/api\/plugins$/,             tl('actionListPlugins', 'List plugins'),   ICN.list],
        [/^\/api\/modpacks\/enable$/,    tl('actionEnableModpack', 'Enable modpack'), ICN.check],
        [/^\/api\/modpacks\/disable$/,   tl('actionDisableModpack', 'Disable modpack'), ICN.ban],
        [/^\/api\/modpacks\/create$/,    tl('actionCreateModpack', 'Create modpack'), ICN.plus],
        [/^\/api\/modpacks\/[^/]+$/,     method === 'DELETE' ? tl('actionDeleteModpack', 'Delete modpack') : tl('actionUpdateModpack', 'Update modpack'), method === 'DELETE' ? ICN.trash : ICN.edit],
        [/^\/api\/modpacks$/,            tl('actionListModpacks', 'List modpacks'), ICN.package],
        [/^\/api\/repo\/sync\/cancel$/,  tl('actionCancelSync', 'Cancel sync'),     ICN.stop],
        [/^\/api\/repo\/sync$/,          tl('actionSyncRepo', 'Sync repo'),         ICN.refresh],
        [/^\/api\/repo\/gen\/cancel$/,   tl('actionCancelGen', 'Cancel gen'),       ICN.stop],
        [/^\/api\/repo\/gen$/,           tl('actionGenRepo', 'Generate repo'),      ICN.package],
        [/^\/api\/repo\/host$/,          method === 'DELETE' ? tl('actionStopHttpHost', 'Stop HTTP host') : tl('actionHttpHost', 'Start HTTP host'), method === 'DELETE' ? ICN.stop : ICN.server],
        [/^\/api\/repo\/connect$/,       tl('actionRepoConnect', 'Connect repo'),   ICN.link],
        [/^\/api\/repo\/info$/,          tl('actionRepoInfo', 'Repo info'),         ICN.info],
        [/^\/api\/repo\/list$/,          tl('actionRepoList', 'List repos'),        ICN.list],
        [/^\/api\/repo$/,                tl('actionRepoRemove', 'Remove repo'),     ICN.trash],
        [/^\/api\/restart$/,             tl('actionRestart', 'Restart BMM'),        ICN.refresh],
        [/^\/api\/status$/,              tl('actionGetStatus', 'Get status'),       ICN.activity],
        [/^\/api\/health$/,              tl('actionApiHealth', 'API health'),       ICN.activity],
        [/^\/api\/check-update$/,        tl('actionCheckUpdate', 'Check for update'), ICN.refresh],
        [/^\/api\/creator-id$/,          tl('actionGetCreatorId', 'Get creator ID'), ICN.id],
    ];
    for (const [re, label, icon] of map) if (re.test(p)) return { label, icon };
    return { label: `${method} ${p}`, icon: ICN.globe };
}

/** Record an entry: persist to disk, keep a tiny RAM window, notify the panel. */
function pushLog(entry: ApiLogEntry): void {
    // 1. Persist to disk (full history, bounded by the backend). Fire-and-forget.
    try { invoke('append_api_log', { line: JSON.stringify(entry) }).catch(() => {}); } catch { /* ignore */ }
    // 2. Tiny in-memory window for instant display only.
    if (!window.__bmmApiLog) window.__bmmApiLog = [];
    window.__bmmApiLog.push(entry);
    if (window.__bmmApiLog.length > MAX_LOG) window.__bmmApiLog.shift();
    const tag = entry.ok ? '[API ✓]' : '[API ✗]';
    console.info(`${tag} ${entry.method} ${entry.path} → ${entry.status} (${entry.label})`);
    // 3. Let the panel append just this one row (no full re-render).
    try { document.dispatchEvent(new CustomEvent('bmm:api-activity', { detail: entry })); } catch { /* ignore */ }
}

/** Refresh whatever page the action touched — same logic as the Quick Test. */
function smartRefresh(path: string): void {
    const p = path.split('?')[0];
    if (p.includes('/profiles')) {
        window._refreshProfilesFn?.();
        window._refreshModsFn?.(true);
    }
    if (p.includes('/mods') && !p.includes('/modpacks')) {
        window._refreshModsFn?.(true);
    }
    if (p.includes('/modpacks') || p.includes('/plugins/apply')) {
        window._refreshModsFn?.(true);
    }
}

function gotoRepoPage(): void {
    const navBtn = document.querySelector('.nav-item[data-view="repo"], .nav-btn[data-view="repo"], [data-view="repo"]') as HTMLElement | null;
    navBtn?.click();
}

/** Reflect repo-sync progress on the Server Repo page DOM if it is mounted. */
function updateSyncProgressDom(payload: any): void {
    const container = document.getElementById('repo-sync-progress-container');
    if (container) container.style.display = 'block';
    const pct = payload?.progress;
    if (pct !== undefined && pct !== null) {
        const clamped = Math.min(Math.round(Number(pct)), 100);
        const pctEl  = document.getElementById('repo-sync-percent');
        const fillEl = document.getElementById('repo-sync-progress-fill');
        if (pctEl)  pctEl.textContent = `${clamped}%`;
        if (fillEl) (fillEl as HTMLElement).style.width = `${clamped}%`;
    }
    const step = payload?.step;
    if (step) {
        const statusEl = document.getElementById('repo-sync-status');
        if (statusEl) {
            let txt = String(step);
            if (txt.startsWith('{')) { try { const d = JSON.parse(txt); txt = t(d.key, d); } catch { txt = t(txt) || txt; } }
            else txt = t(txt) || txt;
            statusEl.textContent = txt;
        }
    }
    if (payload?.current_file) {
        const detailsEl = document.getElementById('repo-sync-details');
        if (detailsEl) detailsEl.textContent = payload.current_file;
    }
}

/**
 * Initialize the global API activity listener. Call once at startup.
 */
export async function initApiActivity(): Promise<void> {
    if (typeof window === 'undefined' || !window.__TAURI__ || !window.__TAURI__.event) {
        console.warn('[API-ACTIVITY] Tauri event module unavailable — API notifications disabled.');
        return;
    }
    const { listen } = window.__TAURI__.event;

    // ── One toast + one log entry per API request ─────────────────────────────
    await listen('bmm://api-action', (event: { payload: ApiActionPayload }) => {
        const { method, path, status } = event.payload || ({} as ApiActionPayload);
        if (!method || !path) return;
        const ok = status >= 200 && status < 400;
        const { label, icon } = describe(method, path);
        pushLog({ time: Date.now(), method, path, status, ok, label, icon });

        // Notify: only surface mutations (POST/PUT/DELETE) as toasts to avoid
        // spamming on read polling; always surface failures.
        const isMutation = method !== 'GET';
        if (isMutation || !ok) {
            const prefix = t('plugins.apiActionPrefix') || 'API';
            if (ok) toast(`${prefix}: ${label}`, 'success', 3000, icon);
            else    toast(`${prefix}: ${label} — ${status}`, 'error', 4000, icon);
        }

        if (ok && method !== 'GET') {
            smartRefresh(path);
            // Repo sync/gen/host navigation + execution is handled by the
            // `bmm://api-exec` listener (UI-driven flow).
        }
    });

    // ── UI-driven actions: the backend asks the interface to perform the
    //    action exactly as a human would (fill the form + click the button),
    //    instead of running it headless in the background. ───────────────────
    await listen('bmm://api-exec', async (event: { payload: any }) => {
        const action: string = event.payload?.action || '';
        const params: any    = event.payload?.params || {};
        if (!action) return;

        const driveRepo = (section: string, prefill: any) => {
            gotoRepoPage();
            setTimeout(() => {
                document.dispatchEvent(new CustomEvent('bmm:repo-focus', { detail: { section, prefill } }));
            }, 450);
        };
        // Navigate to a page, then click one of its buttons — reuses the exact
        // native flow (dialogs, options, confirmations) a human would trigger.
        const navClick = (view: string, btnId: string) => {
            const nav = document.querySelector(`.nav-item[data-view="${view}"], .nav-btn[data-view="${view}"], [data-view="${view}"]`) as HTMLElement | null;
            nav?.click();
            setTimeout(() => {
                const btn = document.getElementById(btnId) as HTMLElement | null;
                if (btn) btn.click();
                else toast(`${t('plugins.apiActionPrefix') || 'API'}: ${action}`, 'info');
            }, 500);
        };
        // Run a Tauri command directly (the command opens its own native dialog).
        const run = async (cmd: string, args?: any, okMsg?: string) => {
            try {
                await invoke(cmd, args);
                if (okMsg) toast(okMsg, 'success', 3000, ICN.check);
            } catch (e) {
                const s = String(e);
                if (!/cancel/i.test(s)) toast(`${t('common.error') || 'Error'}: ${s}`, 'error', 4000, ICN.ban);
            }
        };

        switch (action) {
            // ── Repo (existing UI-driven flows) ──────────────────────────────
            case 'repo/host': driveRepo('host', params); break;
            case 'repo/sync': driveRepo('sync', params); break;
            case 'repo/gen':  driveRepo('gen', params);  break;
            case 'repo/update':
                // Drive the BMM UI exactly like gen/sync — opens the update modal,
                // pre-fills the repo dir and profile list, then lets the user confirm.
                driveRepo('update', params);
                break;
            case 'repo/host-stop':
                gotoRepoPage();
                setTimeout(async () => {
                    try {
                        const status = await invoke('get_repo_server_status');
                        if (status) (document.getElementById('btn-toggle-repo-server') as HTMLElement | null)?.click();
                        else toast(t('plugins.actionStopHttpHost') || 'No HTTP host running', 'info');
                    } catch { /* ignore */ }
                }, 450);
                break;

            // ── Data management (Settings page) ──────────────────────────────
            case 'data/export':    navClick('settings', 'btn-export-data'); break;
            case 'data/import':     navClick('settings', 'btn-import-data'); break;

            // ── Mod lists (.mmlist) — Settings page export/import ─────────────
            case 'modlist/export':  navClick('settings', 'btn-export-mm'); break;
            case 'modlist/import':  navClick('settings', 'btn-import-mm'); break;

            // ── Language file ────────────────────────────────────────────────
            case 'language/import': run('import_language', { path: params.path || null },
                t('settings.langImported') || 'Language imported'); break;

            // ── App Catalog: install via API ─────────────────────────────────
            case 'apps/install': {
                const installPath = params.installPath
                    || `${(window as any).__bmmAppsDefaultDir || 'C:/BMM/Apps'}`;
                run('install_app', {
                    appId:       params.appId,
                    appTitle:    params.appTitle || params.appId,
                    downloadUrl: params.downloadUrl,
                    fileType:    params.fileType || 'exe',
                    installPath: params.installPath || installPath,
                    version:     params.version || null,
                    category:    params.category || null,
                    thumb:       params.thumb || null,
                }, `${params.appTitle || params.appId} ${t('apps.installed') || 'installed'}`);
                break;
            }

            // ── Modpacks (.bmp) — self-contained file dialogs ────────────────
            case 'modpack/import':  run('import_modpack', { path: params.path || null },
                t('plugins.actionCreateModpack') || 'Modpack imported'); break;
            case 'modpack/export':
                if (params.id) run('export_modpack', { id: params.id, destDir: params.destDir || null },
                    t('common.exported') || 'Exported');
                else navClick('modpacks', 'btn-import-modpack'); // fallback: open modpacks page
                break;

            // ── Profiles (OVGME / OMM / OMX) — Profiles page ─────────────────
            case 'profile/import-ovgme': navClick('profiles', 'btn-import-ovgme'); break;
            case 'profile/import-omm':   navClick('profiles', 'btn-import-omm'); break;

            // ── Plugins (.bmmplug) ───────────────────────────────────────────
            case 'plugin/import': {
                const tauri = (window as any).__TAURI__;
                try {
                    const file = await tauri?.dialog?.open({ multiple: false, filters: [{ name: 'BMM Plugin', extensions: ['bmmplug', 'zip'] }] });
                    if (file) await run('install_plugin_from_file', { filePath: file },
                        t('plugins.imported') || 'Plugin imported');
                } catch (e) { console.warn('[api-exec] plugin/import', e); }
                break;
            }
            case 'plugin/export': {
                if (!params.id) { navClick('plugins', ''); break; }
                const tauri = (window as any).__TAURI__;
                try {
                    const dest = await tauri?.dialog?.save({ defaultPath: `${params.id}.bmmplug`, filters: [{ name: 'BMM Plugin', extensions: ['bmmplug'] }] });
                    if (dest) await run('export_plugin', { pluginId: params.id, destPath: dest },
                        t('plugins.exported') || 'Plugin exported');
                } catch (e) { console.warn('[api-exec] plugin/export', e); }
                break;
            }
        }
    });

    // ── API rejected (e.g. a process is already running) → toast reason + code ─
    await listen('bmm://api-rejected', (event: { payload: any }) => {
        const action: string = event.payload?.action || '';
        const reason: string = event.payload?.reason || (t('common.error') || 'Error');
        const code = event.payload?.code;
        const prefix = t('plugins.apiActionPrefix') || 'API';
        const label = action ? describe('POST', '/api/' + action).label : prefix;
        const codePart = code != null ? ` (${code})` : '';
        toast(`${prefix}: ${label} — ${reason}${codePart}`, 'error', 5000, ICN.ban);
    });

    // ── Persistent repo listeners (visible even when API-triggered) ───────────
    await listen('bmm://repo-sync-progress', (event: { payload: any }) => {
        updateSyncProgressDom(event.payload || {});
    });
    await listen('bmm://repo-sync-done', () => {
        toast(t('repo.syncSuccess') || 'Synchronization completed', 'success', 3000, ICN.check);
        window._refreshModsFn?.(true);
        const statusEl = document.getElementById('repo-sync-status');
        if (statusEl) statusEl.textContent = t('repo.syncDone') || 'Done';
        const pctEl  = document.getElementById('repo-sync-percent');
        const fillEl = document.getElementById('repo-sync-progress-fill');
        if (pctEl)  pctEl.textContent = '100%';
        if (fillEl) (fillEl as HTMLElement).style.width = '100%';
    });
    await listen('bmm://repo-sync-error', (event: { payload: any }) => {
        const msg = event.payload?.error || event.payload?.message || '';
        toast(`${t('repo.syncError') || 'Sync error'}${msg ? `: ${msg}` : ''}`, 'error', 4000, ICN.ban);
    });
    await listen('bmm://repo-host-started', (event: { payload: any }) => {
        const port = event.payload?.port;
        toast(`${t('plugins.actionHttpHost') || 'HTTP host started'}${port ? ` — :${port}` : ''}`, 'success', 3000, ICN.server);
    });
    await listen('bmm://repo-host-stopped', () => {
        toast(t('plugins.actionStopHttpHost') || 'HTTP host stopped', 'info', 3000, ICN.stop);
    });

    console.log('[API-ACTIVITY] Listener initialized.');
}
