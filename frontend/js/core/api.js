/**
 * api.ts — Tauri Bridge
 * Handles communication between frontend and Rust backend
 */
import { debugHub } from '../features/debug/debug.js';
let _invoke = null;
// Bridge-readiness gate. The bridge is wired up by loadTauri(), but some boot code (e.g.
// loadLinks → fetch_links_json) can invoke BEFORE loadTauri() has run. Rather than fail those
// with "Tauri bridge not initialized", invoke() awaits this promise first — loadTauri resolves
// it on every path (real bridge, unpkg dev, or browser mock), so an early call just waits a
// few ms instead of throwing.
let _markBridgeReady = null;
const _bridgeReady = new Promise((res) => { _markBridgeReady = res; });
function markBridgeReady() { if (_markBridgeReady) {
    _markBridgeReady();
    _markBridgeReady = null;
} }
// ── Local Plugin API base URL (configurable port) ─────────────────────────────
// The port comes from settings.api_port (default 51274). Cached in localStorage
// so it's correct synchronously at boot; refreshed once settings load.
let _apiPort = parseInt(localStorage.getItem('bmm_api_port') || '51274', 10) || 51274;
export function apiBase() { return `http://127.0.0.1:${_apiPort}`; }
export function setApiPort(p) {
    if (!p || p < 1 || p > 65535)
        return;
    _apiPort = p;
    localStorage.setItem('bmm_api_port', String(p));
}
// Is anything actually LISTENING on that port?
//
// The port is only which one the server tried. Binding can fail — a zombie instance from a
// previous run still holds it — and the Rust side degrades gracefully and writes one line to
// the crash log. The frontend never knew: it read the cached port and fetched, so every
// feature that touched the API logged its own ERR_CONNECTION_REFUSED and the real cause was
// in a file nobody opens.
//
// Starts FALSE and is corrected at boot. A wrong "off" costs one skipped fetch; a wrong "on"
// costs the console noise this exists to remove.
let _apiRunning = false;
export function apiRunning() { return _apiRunning; }
/** Ask the backend for the truth, once, at boot. */
export async function refreshApiStatus() {
    try {
        const s = await invoke('get_api_status', {}, { quiet: true });
        if (s?.port)
            setApiPort(s.port);
        _apiRunning = !!s?.running;
    }
    catch {
        // An old backend without the command, or a bridge that is not up yet. Assume off:
        // the callers all degrade to an empty list, which is what they did anyway.
        _apiRunning = false;
    }
}
let _dialog = null;
let _notifModule = null;
let _convertFileSrc = null;
// --- Console Interceptor ---
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
// Re-entrancy guard: forwarding a log to the backend can itself log (e.g. the
// browser mock's mockInvoke console.logs the command it received). Without this
// guard that recurses infinitely — bridgeLog → log_frontend_line → console.log →
// bridgeLog → … — flooding output and freezing the main thread. Prod invoke never
// re-enters synchronously, so this is a no-op there.
let _bridging = false;
function bridgeLog(level, args) {
    debugHub.recordLog(level, args);
    if (_bridging || !_invoke)
        return;
    const message = args.map((arg) => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
    _bridging = true;
    try {
        _invoke('log_frontend_line', { line: `[${level}] ${message}` }).catch(() => { });
    }
    finally {
        _bridging = false;
    }
}
console.log = (...args) => {
    originalLog.apply(console, args);
    bridgeLog('INFO', args);
};
console.warn = (...args) => {
    originalWarn.apply(console, args);
    bridgeLog('WARN', args);
};
console.error = (...args) => {
    originalError.apply(console, args);
    bridgeLog('ERROR', args);
};
export async function loadTauri() {
    if (window.__TAURI__) {
        // Tauri v2: invoke / convertFileSrc live under the `core` global. The
        // dialog plugin's JS is NOT injected by withGlobalTauri, so dialogs are
        // routed through Rust commands (commands::dialog) instead of __TAURI__.dialog.
        const core = window.__TAURI__.core || window.__TAURI__;
        _invoke = core.invoke;
        _convertFileSrc = typeof core.convertFileSrc === 'function'
            ? core.convertFileSrc
            : (p) => `asset.localhost/${p}`;
        _dialog = {
            open: async (opts = {}) => opts && opts.directory
                ? await _invoke('dlg_pick_folder')
                : await _invoke('dlg_pick_file', { filters: opts?.filters ?? null }),
            save: async (opts = {}) => await _invoke('dlg_save_file', { defaultPath: opts?.defaultPath ?? null, filters: opts?.filters ?? null }),
            ask: async (message, opts = {}) => await _invoke('dlg_confirm', { message, title: opts?.title ?? null }),
        };
        _notifModule = null;
        console.log('[BMM] Using local Tauri v2 bridge');
        markBridgeReady();
        return;
    }
    // SECURITY: In production, we should NEVER fallback to unpkg without SRI (Issue 5)
    // For now, we add a warning and a mock mode if not in Tauri.
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isLocalhost) {
        console.error('[SECURITY] Tauri bridge missing in production! Fallback to CDN disabled for security.');
        _invoke = mockInvoke;
        _dialog = { open: async () => null, save: async () => null };
        markBridgeReady();
        return;
    }
    try {
        // Only allow unpkg in development/localhost
        const tauriModule = await import('https://unpkg.com/@tauri-apps/api@1/tauri.js');
        const dialogModule = await import('https://unpkg.com/@tauri-apps/api@1/dialog.js');
        _notifModule = await import('https://unpkg.com/@tauri-apps/api@1/notification.js');
        _invoke = tauriModule.invoke;
        _dialog = dialogModule;
        _convertFileSrc = tauriModule.convertFileSrc;
    }
    catch {
        console.warn('[BMM] Running in browser mock mode');
        _invoke = mockInvoke;
        _dialog = { open: async () => 'C:\\mock\\folder', save: async () => null };
        _notifModule = null;
        _convertFileSrc = (path) => `file://${path}`;
    }
    markBridgeReady();
}
export async function invoke(command, args = {}, opts) {
    if (!_invoke) {
        // Early boot call before loadTauri() finished — wait for the bridge (max 5s) instead
        // of failing outright. loadTauri() resolves _bridgeReady on every path.
        await Promise.race([_bridgeReady, new Promise((r) => setTimeout(r, 5000))]);
        if (!_invoke) {
            if (!opts?.quiet)
                console.error(`[RPC ERROR] Cannot invoke ${command}: Tauri bridge not initialized`);
            throw new Error('Tauri bridge not initialized');
        }
    }
    const startTime = performance.now();
    const _call = debugHub.recordIPC(command, args, 'pending');
    try {
        const res = await _invoke(command, args);
        const duration = Math.round(performance.now() - startTime);
        debugHub.recordIPC(command, args, 'success', res, duration);
        return res;
    }
    catch (err) {
        const duration = Math.round(performance.now() - startTime);
        debugHub.recordIPC(command, args, 'error', err, duration);
        // Suppress console noise for expected "user cancelled" signals — callers handle these gracefully
        const errStr = String(err);
        const isCancelled = errStr.includes('cancel') || errStr.includes('Cancel') || errStr === 'repo.errCancel'
            || errStr.includes('annulée') || errStr.includes('annulé') || errStr.includes('Annulé');
        // Network/DNS failures (unreachable repo URL, dead tunnel, offline) are
        // expected runtime conditions the caller surfaces via a toast — don't
        // log them as hard errors.
        const isNetwork = /dns error|error sending request|error trying to connect|connection (refused|reset|closed)|failed to connect|timed out|os error 11001|Hôte inconnu|name resolution|no address|NETWORK_ERROR|NO_RELEASE/i.test(errStr);
        // User-facing validation errors (path not found, wrong format, etc.): the
        // Rust backend throws AppError::NotFound / validation messages that are
        // already shown to the user as toasts by the caller — downgrade to warn.
        const isValidation = /Ressource non trouvée|not found|introuvable|n.existe pas|does not exist|n.a pas été trouvé|invalid|invalide|requis|required|errNoExistingRepo|errNoProfile|errNoUrl|errNoOutDir|errNoAuthor/i.test(errStr);
        if (opts?.quiet) {
            // Caller owns this failure entirely (e.g. an optional feed that may 404
            // when the endpoint isn't deployed) — keep the console clean.
        }
        else if (isCancelled) {
            console.warn(`[RPC CANCEL] ${command}: ${errStr}`);
        }
        else if (isNetwork) {
            console.warn(`[RPC NET] ${command}: ${errStr}`);
        }
        else if (isValidation) {
            console.warn(`[RPC VALIDATION] ${command}: ${errStr}`);
        }
        else {
            console.error(`[RPC ERROR] ${command}:`, err);
        }
        throw err;
    }
}
export async function pickFolder() {
    try {
        return await _dialog.open({ directory: true, multiple: false });
    }
    catch {
        return null;
    }
}
/**
 * Several files at once.
 *
 * A separate function rather than an option on `pickFile`: widening that one's return type
 * to `string | string[]` broke three existing call sites that reasonably assume a string,
 * and every one of them would have had to grow a check for a case it can never see. The
 * compiler caught it, which is the argument for not doing it.
 */
export async function pickFiles(filters) {
    try {
        const r = await _dialog.open({ multiple: true, ...(filters?.length ? { filters } : {}) });
        return Array.isArray(r) ? r : (r ? [r] : []);
    }
    catch {
        return [];
    }
}
export async function pickFile(options = []) {
    try {
        let dialogOptions = { multiple: false };
        if (Array.isArray(options)) {
            let filters = options;
            if (filters.length > 0 && typeof filters[0] === 'string') {
                filters = [{ name: filters.join(', ').toUpperCase(), extensions: filters }];
            }
            if (filters.length > 0)
                dialogOptions.filters = filters;
        }
        else {
            if (options.filters?.length)
                dialogOptions.filters = options.filters;
        }
        return await _dialog.open(dialogOptions);
    }
    catch {
        return null;
    }
}
/** The last path the user chose in a save dialog, or null.
 *
 *  Every export in the app picks its destination through saveFile() and then writes
 *  to it, so the success toast fires a few lines after this was set — which is what
 *  lets `toastSaved()` name the destination without each of a dozen call sites
 *  threading its own local variable through. A cancelled dialog does not overwrite
 *  it, so a later export cannot inherit an abandoned path. */
let _lastSavePath = null;
export function lastSavePath() { return _lastSavePath; }
export async function saveFile(options = {}) {
    try {
        const picked = _dialog?.save
            ? await _dialog.save(options)
            : await (await import('https://unpkg.com/@tauri-apps/api@1/dialog.js')).save(options);
        if (picked)
            _lastSavePath = picked;
        return picked;
    }
    catch {
        return null;
    }
}
/** Native yes/no confirmation dialog. Returns true if the user accepted. */
export async function askConfirm(message, options = {}) {
    try {
        if (_dialog?.ask)
            return await _dialog.ask(message, options);
        if (_dialog?.confirm)
            return await _dialog.confirm(message, options);
    }
    catch { /* fall through */ }
    // THERE IS NO NATIVE PATH, and that is not a permissions problem to be fixed in
    // capabilities/default.json. tauri-plugin-dialog 2.x ships exactly three commands —
    // message, open, save (see its permissions/autogenerated/commands/) — so `ask` and
    // `confirm` are not un-granted, they do not exist. window.confirm() is worse still: the
    // webview routes it at that missing `confirm` command, which rejects as an UNCAUGHT
    // promise while the synchronous call returns undefined immediately.
    //
    // Returning false here — which is what this did — makes every
    // `if (!await askConfirm(…)) return;` in the app answer "no" without asking anybody. The
    // button appears to do nothing at all, and nothing is logged, because as far as the code
    // is concerned the user declined.
    //
    // The in-app modal IS this app's confirmation dialog. Ask it.
    if (!_inAppConfirmBusy) {
        const inApp = window.confirmCustom;
        if (typeof inApp === 'function' && document.getElementById('modal-confirm-generic')) {
            _inAppConfirmBusy = true;
            try {
                return await inApp(options.title || message, options.title ? message : '', 'warning');
            }
            finally {
                _inAppConfirmBusy = false;
            }
        }
    }
    // Outside Tauri (browser, mock) the native dialog is real and works.
    if (!isTauri()) {
        try {
            return window.confirm(message);
        }
        catch { /* fall through */ }
    }
    return false;
}
/** Guards the one loop this could form: modals.ts calls askConfirm when its markup is
 *  missing, and askConfirm calls confirmCustom. If the modal exists but is incomplete,
 *  those two would hand the question back and forth forever. */
let _inAppConfirmBusy = false;
/** True when running inside the Tauri webview (as opposed to a browser or the mock).
 *  Exported because "can I use a native browser dialog" is a question several modules ask. */
export function isTauri() {
    try {
        return !!window.__TAURI__;
    }
    catch {
        return false;
    }
}
export async function getSettings() {
    return await invoke('get_settings');
}
export async function updateSettings(settings) {
    return await invoke('update_settings', { settings });
}
/**
 * Files and folders dropped onto the window.
 *
 * The event is `tauri://drag-drop`. It was `tauri://file-drop` in Tauri 1, and this listened for
 * that name until long after the v2 migration — so dropping a folder or a zip onto the library
 * did nothing at all, with no error anywhere: an event that is never emitted cannot fail loudly.
 *
 * The PAYLOAD changed with it, and that was the second half of the same break. v1 sent a bare
 * array of paths; v2 sends `{ paths, position }`. The old code tested `payload.length > 0`,
 * which on a v2 object is `undefined > 0` — false — so even under the right event name the
 * callback would still never have run.
 *
 * Both shapes are accepted below. Not for v1 compatibility, which is gone, but because reading
 * the paths out of whatever arrived is what makes the next rename a shrug instead of a silent
 * dead feature. scripts/check-tauri-events.mjs now fails the build on a v1 event name.
 */
export async function listenFileDrop(callback) {
    try {
        const { listen } = await getEventModule();
        return await listen('tauri://drag-drop', (e) => {
            const p = e?.payload;
            const paths = Array.isArray(p) ? p : (Array.isArray(p?.paths) ? p.paths : []);
            if (paths.length > 0)
                callback(paths);
        });
    }
    catch {
        console.warn('[BMM] File drop not supported in browser mockup');
        return () => { };
    }
}
async function getEventModule() {
    if (window.__TAURI__) {
        return window.__TAURI__.event;
    }
    return await import('https://unpkg.com/@tauri-apps/api@1/event.js');
}
export async function listen(event, callback) {
    try {
        const { listen } = await getEventModule();
        return await listen(event, callback);
    }
    catch (e) {
        console.warn(`[BMM] Event listening (${event}) not supported in current environment`, e);
        return () => { };
    }
}
export async function sendOsNotification(_title, _body) {
    // Deprecated per user request. OS notifications and settings removed.
    return;
}
// Mock invoke for browser testing
/** Demo data for the browser mock, fetched once. Never loaded inside the Tauri app —
 *  mockInvoke is only installed when the bridge is absent. */
let _fixtures;
async function mockFixtures() {
    if (_fixtures !== undefined)
        return _fixtures;
    try {
        const r = await fetch('assets/mock-fixtures.json');
        _fixtures = r.ok ? await r.json() : null;
    }
    catch {
        _fixtures = null;
    }
    return _fixtures ?? null;
}
async function mockInvoke(command, args) {
    console.log(`[Mock] ${command}`, args);
    // The language files are ordinary static assets, so the browser can read them itself.
    // Returning null here — which is what this did — made loadLang() throw on `data._info`,
    // left `t()` returning raw keys and every label in the preview blank. The preview was
    // useless for looking at the interface, which is the one thing it is for.
    if (command === 'get_language_content') {
        const lang = String(args?.lang || 'fr');
        const r = await fetch(`Lang/${lang}.json`);
        if (!r.ok)
            throw new Error(`no language file for ${lang}`);
        return await r.text();
    }
    const fx = await mockFixtures();
    if (fx && Object.prototype.hasOwnProperty.call(fx, command))
        return fx[command];
    // Anything list-shaped answers with an empty list rather than null.
    //
    // Returning null for everything meant the preview died in a cascade of
    // "Cannot read properties of null (reading 'length'/'filter'/'slice')" — each one an
    // unawaited init that gave up half-way. The app is entitled to assume `list_x` returns a
    // list; a mock that says null is lying about the contract, not testing it.
    //
    // A NAME heuristic, deliberately: the alternative is hard-coding a shape for a few
    // hundred commands, which would be wrong the moment one changes. Anything needing real
    // content gets an explicit entry in mock-fixtures.json instead.
    if (/^(list_|get_all_)/.test(command) || /s$/.test(command))
        return [];
    return null;
}
export function convertFileSrc(path) {
    if (_convertFileSrc)
        return _convertFileSrc(path);
    return `asset.localhost/${path}`;
}
//# sourceMappingURL=api.js.map