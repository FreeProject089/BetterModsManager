/**
 * api.ts — Tauri Bridge
 * Handles communication between frontend and Rust backend
 */
import { debugHub } from '../features/debug/debug.js';
let _invoke = null;
let _dialog = null;
let _notifModule = null;
let _convertFileSrc = null;
// --- Console Interceptor ---
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
function bridgeLog(level, args) {
    debugHub.recordLog(level, args);
    const message = args.map((arg) => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
    if (_invoke) {
        _invoke('log_frontend_line', { line: `[${level}] ${message}` }).catch(() => { });
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
        _invoke = window.__TAURI__.invoke;
        _dialog = window.__TAURI__.dialog;
        _notifModule = window.__TAURI__.notification;
        _convertFileSrc = window.__TAURI__.tauri ? window.__TAURI__.tauri.convertFileSrc : (p) => `asset.localhost/${p}`;
        console.log('[BMM] Using local Tauri bridge');
        return;
    }
    // SECURITY: In production, we should NEVER fallback to unpkg without SRI (Issue 5)
    // For now, we add a warning and a mock mode if not in Tauri.
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isLocalhost) {
        console.error('[SECURITY] Tauri bridge missing in production! Fallback to CDN disabled for security.');
        _invoke = mockInvoke;
        _dialog = { open: async () => null, save: async () => null };
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
}
export async function invoke(command, args = {}) {
    if (!_invoke) {
        console.error(`[RPC ERROR] Cannot invoke ${command}: Tauri bridge not initialized`);
        throw new Error('Tauri bridge not initialized');
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
        console.error(`[RPC ERROR] ${command}:`, err);
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
export async function saveFile(options = {}) {
    try {
        if (_dialog?.save) {
            return await _dialog.save(options);
        }
        const mod = await import('https://unpkg.com/@tauri-apps/api@1/dialog.js');
        return await mod.save(options);
    }
    catch {
        return null;
    }
}
export async function getSettings() {
    return await invoke('get_settings');
}
export async function updateSettings(settings) {
    return await invoke('update_settings', { settings });
}
export async function listenFileDrop(callback) {
    try {
        const { listen } = await getEventModule();
        return await listen('tauri://file-drop', (e) => {
            if (e.payload && e.payload.length > 0) {
                callback(e.payload);
            }
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
async function mockInvoke(command, args) {
    console.log(`[Mock] ${command}`, args);
    switch (command) {
        case 'get_profiles': return [];
        case 'get_active_profile_id': return null;
        case 'get_all_mods': return [];
        default: return null;
    }
}
export function convertFileSrc(path) {
    if (_convertFileSrc)
        return _convertFileSrc(path);
    return `asset.localhost/${path}`;
}
//# sourceMappingURL=api.js.map