/**
 * api.js — Tauri Bridge
 * Handles communication between frontend and Rust backend
 */

let _invoke;
let _dialog;
let _notifModule;
let _convertFileSrc;

// --- Console Interceptor ---
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

function bridgeLog(level, args) {
    const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    
    // Send to backend if bridge is available
    if (_invoke) {
        _invoke('log_frontend_line', { line: `[${level}] ${message}` }).catch(() => {});
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
    // 1. Prioritize window.__TAURI__ (injected locally by Tauri when withGlobalTauri is true)
    if (window.__TAURI__) {
        _invoke = window.__TAURI__.invoke;
        _dialog = window.__TAURI__.dialog;
        _notifModule = window.__TAURI__.notification;
        _convertFileSrc = window.__TAURI__.tauri.convertFileSrc;
        console.log('[BMM] Using local Tauri bridge');
        return;
    }

    // 2. Fallback to unpkg (requires internet)
    try {
        const tauriModule = await import('https://unpkg.com/@tauri-apps/api@1/tauri.js');
        const dialogModule = await import('https://unpkg.com/@tauri-apps/api@1/dialog.js');
        _notifModule = await import('https://unpkg.com/@tauri-apps/api@1/notification.js');
        _invoke = tauriModule.invoke;
        _dialog = dialogModule;
        _convertFileSrc = tauriModule.convertFileSrc;
    } catch {
        // 3. Last fallback: mock for browser testing
        console.warn('[BMM] Running in browser mock mode');
        _invoke = mockInvoke;
        _dialog = { open: async () => 'C:\\mock\\folder', save: async () => null };
        _notifModule = null;
        _convertFileSrc = (path) => `file://${path}`;
    }
}

export async function invoke(command, args = {}) {
    console.log(`[BMM] Invoke: ${command}`, args);
    // Log every tauri invoke for real-time tracking
    // const start = Date.now();
    try {
        const res = await _invoke(command, args);
        return res;
    } catch (err) {
        console.error(`[RPC ERROR] ${command}:`, err);
        throw err;
    }
}

export async function pickFolder() {
    try {
        return await _dialog.open({ directory: true, multiple: false });
    } catch {
        return null;
    }
}

export async function pickFile(filters = []) {
    try {
        // If filters is a flat array like ['omx', 'omc'], convert to Tauri format
        let normalizedFilters = filters;
        if (filters.length > 0 && typeof filters[0] === 'string') {
            normalizedFilters = [{ name: filters.join(', ').toUpperCase(), extensions: filters }];
        }
        return await _dialog.open({ multiple: false, filters: normalizedFilters });
    } catch {
        return null;
    }
}

export async function saveFile(filters = []) {
    try {
        const saveDialog = await import('https://unpkg.com/@tauri-apps/api@1/dialog.js');
        return await saveDialog.save({ filters });
    } catch {
        return null;
    }
}

export async function getSettings() { return await invoke('get_settings'); }
export async function updateSettings(settings) { return await invoke('update_settings', { settings }); }

export async function listenFileDrop(callback) {
    try {
        const { listen } = await import('https://unpkg.com/@tauri-apps/api@1/event.js');
        return await listen('tauri://file-drop', e => {
            if (e.payload && e.payload.length > 0) {
                callback(e.payload);
            }
        });
    } catch {
        console.warn('[BMM] File drop not supported in browser mockup');
        return () => { };
    }
}

export async function sendOsNotification(title, body) {
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
    if (_convertFileSrc) return _convertFileSrc(path);
    return `asset.localhost/${path}`;
}
