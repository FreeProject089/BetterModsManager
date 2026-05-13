/**
 * api.ts — Tauri Bridge
 * Handles communication between frontend and Rust backend
 */

import { debugHub } from '../features/debug/debug.js';
import type { AppSettings } from '../types/models.js';

let _invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<any>) | null = null;
let _dialog: any = null;
let _notifModule: any = null;
let _convertFileSrc: ((path: string) => string) | null = null;

// --- Console Interceptor ---
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

function bridgeLog(level: string, args: any[]): void {
    debugHub.recordLog(level, args);

    const message = args.map((arg: any) => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    
    if (_invoke) {
        _invoke('log_frontend_line', { line: `[${level}] ${message}` }).catch(() => {});
    }
}

console.log = (...args: any[]) => {
    originalLog.apply(console, args);
    bridgeLog('INFO', args);
};
console.warn = (...args: any[]) => {
    originalWarn.apply(console, args);
    bridgeLog('WARN', args);
};
console.error = (...args: any[]) => {
    originalError.apply(console, args);
    bridgeLog('ERROR', args);
};

export async function loadTauri(): Promise<void> {
    if (window.__TAURI__) {
        _invoke = window.__TAURI__.invoke;
        _dialog = window.__TAURI__.dialog;
        _notifModule = window.__TAURI__.notification;
        _convertFileSrc = window.__TAURI__.tauri ? window.__TAURI__.tauri.convertFileSrc : (p:string) => `asset.localhost/${p}`;
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
    } catch {
        console.warn('[BMM] Running in browser mock mode');
        _invoke = mockInvoke;
        _dialog = { open: async () => 'C:\\mock\\folder', save: async () => null };
        _notifModule = null;
        _convertFileSrc = (path: string) => `file://${path}`;
    }
}

export async function invoke(command: string, args: Record<string, unknown> = {}): Promise<any> {
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
    } catch (err) {
        const duration = Math.round(performance.now() - startTime);
        debugHub.recordIPC(command, args, 'error', err, duration);
        console.error(`[RPC ERROR] ${command}:`, err);
        throw err;
    }
}

export async function pickFolder(): Promise<string | null> {
    try {
        return await _dialog.open({ directory: true, multiple: false }) as string | null;
    } catch {
        return null;
    }
}

export async function pickFile(filters: Array<string | { name: string; extensions: string[] }> = []): Promise<string | null> {
    try {
        let normalizedFilters = filters;
        if (filters.length > 0 && typeof filters[0] === 'string') {
            normalizedFilters = [{ name: (filters as string[]).join(', ').toUpperCase(), extensions: filters as string[] }];
        }
        return await _dialog.open({ multiple: false, filters: normalizedFilters }) as string | null;
    } catch {
        return null;
    }
}

export async function saveFile(filters: Array<{ name: string; extensions: string[] }> = []): Promise<string | null> {
    try {
        const saveDialog = await import('https://unpkg.com/@tauri-apps/api@1/dialog.js');
        return await saveDialog.save({ filters }) as string | null;
    } catch {
        return null;
    }
}

export async function getSettings(): Promise<AppSettings> {
    return await invoke('get_settings') as AppSettings;
}

export async function updateSettings(settings: AppSettings): Promise<void> {
    return await invoke('update_settings', { settings });
}

export async function listenFileDrop(callback: (paths: string[]) => void): Promise<() => void> {
    try {
        const { listen } = await getEventModule();
        return await listen('tauri://file-drop', (e: { payload: any }) => {
            if (e.payload && e.payload.length > 0) {
                callback(e.payload);
            }
        });
    } catch {
        console.warn('[BMM] File drop not supported in browser mockup');
        return () => {};
    }
}

async function getEventModule(): Promise<any> {
    if (window.__TAURI__) {
        return window.__TAURI__.event;
    }
    return await import('https://unpkg.com/@tauri-apps/api@1/event.js');
}

export async function listen(event: string, callback: (payload: any) => void): Promise<() => void> {
    try {
        const { listen } = await getEventModule();
        return await listen(event, callback);
    } catch (e) {
        console.warn(`[BMM] Event listening (${event}) not supported in current environment`, e);
        return () => {};
    }
}

export async function sendOsNotification(_title: string, _body: string): Promise<void> {
    // Deprecated per user request. OS notifications and settings removed.
    return;
}

// Mock invoke for browser testing
async function mockInvoke(command: string, args?: Record<string, unknown>): Promise<any> {
    console.log(`[Mock] ${command}`, args);
    switch (command) {
        case 'get_profiles': return [];
        case 'get_active_profile_id': return null;
        case 'get_all_mods': return [];
        default: return null;
    }
}

export function convertFileSrc(path: string): string {
    if (_convertFileSrc) return _convertFileSrc(path);
    return `asset.localhost/${path}`;
}
