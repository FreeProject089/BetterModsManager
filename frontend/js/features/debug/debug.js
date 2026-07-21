import { appState } from '../../core/state.js';
// Hook into addEventListener early to track listeners for the DevTools A11y Event Inspector
const originalAddEventListener = EventTarget.prototype.addEventListener;
EventTarget.prototype.addEventListener = function (type, listener, options) {
    try {
        if (this instanceof Element && !this.classList.contains('debug-btn') && !this.closest?.('#bmm-debug-overlay')) {
            const events = this.getAttribute('data-bmm-events') || '';
            if (!events.includes(type)) {
                this.setAttribute('data-bmm-events', events ? events + ', ' + type : type);
            }
        }
    }
    catch (_e) { /* ignore */ }
    return originalAddEventListener.call(this, type, listener, options);
};
class DebugHub {
    logs;
    ipcCalls;
    actions;
    patches;
    metrics;
    listeners;
    maxItems;
    isEnabled;
    constructor() {
        this.logs = [];
        this.ipcCalls = [];
        this.actions = [];
        this.patches = [];
        this.metrics = {
            fps: 0,
            memory: null,
            startTime: Date.now()
        };
        this.listeners = new Set();
        this.maxItems = 500;
        this.isEnabled = true;
        // Bridge appState changes to DebugHub
        appState.onChange = (key, value) => {
            if (this.listeners.size > 0 || key.includes('Error')) {
                this.emit('state', { key, value });
            }
        };
        this.setupGlobalHandlers();
    }
    subscribe(callback) {
        this.listeners.add(callback);
    }
    unsubscribe(callback) {
        this.listeners.delete(callback);
    }
    emit(type, data) {
        if (!this.isEnabled)
            return;
        const event = { type, data, timestamp: Date.now() };
        this.listeners.forEach(cb => cb(event));
    }
    recordLog(level, args) {
        let message = args.map((arg) => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' ');
        // A single logged object can be enormous; never retain more than a few KB per line.
        if (message.length > 4000)
            message = message.slice(0, 4000) + `…(+${message.length - 4000} chars)`;
        const item = { level, message, id: Math.random().toString(36).substr(2, 9) };
        this.logs.push(item);
        if (this.logs.length > this.maxItems)
            this.logs.shift();
        this.emit('log', item);
    }
    // Shrink a value before it's stored in a debug buffer, so the panel never RETAINS a
    // multi-MB payload. The session `content` string passed to save_crash_session/
    // save_local_replay used to be held (by reference) across up to maxItems IPC records —
    // every 45s flush leaked another copy, which could OOM the webview. Truncates long strings,
    // caps arrays, and flattens nested objects.
    _slim(v, maxStr = 1500) {
        if (typeof v === 'string')
            return v.length > maxStr ? v.slice(0, maxStr) + `…(+${v.length - maxStr} chars)` : v;
        if (v == null || typeof v !== 'object')
            return v;
        if (Array.isArray(v))
            return v.length > 40 ? [`…${v.length} items`] : v.map((x) => this._slim(x, 400));
        const out = {};
        for (const k of Object.keys(v)) {
            const val = v[k];
            out[k] = (val && typeof val === 'object') ? '[object]' : this._slim(val, 600);
        }
        return out;
    }
    recordIPC(command, args, status = 'pending', result = null, duration = 0) {
        // Match the most recent still-pending call for this command (we can no longer match by
        // `args` reference — a slimmed copy is stored to avoid retaining huge payloads).
        let call;
        for (let i = this.ipcCalls.length - 1; i >= 0; i--) {
            if (this.ipcCalls[i].command === command && this.ipcCalls[i].status === 'pending') {
                call = this.ipcCalls[i];
                break;
            }
        }
        if (!call) {
            call = {
                id: Math.random().toString(36).substr(2, 9),
                command,
                args: this._slim(args),
                status,
                result: this._slim(result),
                duration,
                timestamp: Date.now()
            };
            this.ipcCalls.push(call);
            if (this.ipcCalls.length > this.maxItems)
                this.ipcCalls.shift();
        }
        else {
            call.status = status;
            call.result = this._slim(result);
            call.duration = duration;
        }
        this.emit('ipc', call);
        return call;
    }
    applyPatch(type, content) {
        const id = 'patch-' + Math.random().toString(36).substr(2, 9);
        const patch = { id, type, content, timestamp: Date.now() };
        if (type === 'CSS') {
            const style = document.createElement('style');
            style.id = id;
            style.textContent = content;
            document.head.appendChild(style);
        }
        else if (type === 'JS') {
            const msg = "⚠️ Patch JS désactivé pour des raisons de sécurité (Security Audit). Utilisez la console (F12) si nécessaire.";
            this.recordLog('warn', [msg]);
            console.warn(msg, content);
        }
        this.patches.push(patch);
        if (this.patches.length > this.maxItems)
            this.patches.shift();
        this.emit('patches', this.patches);
        this.recordAction('PATCH_APPLY', { tagName: 'PATCH', id: id }, type);
        return id;
    }
    removePatch(id) {
        const index = this.patches.findIndex(p => p.id === id);
        if (index === -1)
            return;
        const patch = this.patches[index];
        if (patch.type === 'CSS') {
            const el = document.getElementById(id);
            if (el)
                el.remove();
        }
        this.patches.splice(index, 1);
        this.emit('patches', this.patches);
        this.recordAction('PATCH_REMOVE', { tagName: 'PATCH', id: id }, patch.type);
    }
    recordAction(type, target, details = '') {
        const item = {
            type,
            status: type.includes('ERR') ? 'error' : (type.includes('PATCH') ? 'success' : 'info'),
            target: target.tagName + (target.id ? '#' + target.id : ''),
            details,
            timestamp: Date.now(),
            id: Math.random().toString(36).substr(2, 9)
        };
        this.actions.push(item);
        if (this.actions.length > this.maxItems)
            this.actions.shift();
        this.emit('action', item);
    }
    clear() {
        this.logs = [];
        this.ipcCalls = [];
        this.actions = [];
        this.emit('clear', null);
    }
    setupGlobalHandlers() {
        window.onerror = (msg, url, line, col, error) => {
            this.recordAction('CRASH_ERR', { tagName: 'WINDOW', id: 'global' }, `${msg} at ${line}:${col}`);
            this.exportCrashDump('CRASH');
            this.emit('crash', { msg, url, line, col, error });
        };
        window.onunhandledrejection = (event) => {
            this.recordAction('CRASH_REJ', { tagName: 'PROMISE', id: 'global' }, event.reason?.message || 'Unhandled Rejection');
            this.exportCrashDump('REJECTION');
            this.emit('crash', { msg: event.reason?.message || 'Promise Rejection', error: event.reason });
        };
    }
    exportCrashDump(reason = 'MANUAL') {
        const dump = {
            reason,
            timestamp: new Date().toISOString(),
            appState: typeof appState !== 'undefined' ? appState.state : {},
            logs: this.logs,
            ipcCalls: this.ipcCalls,
            actions: this.actions,
            patches: this.patches,
            metrics: this.metrics,
            userAgent: navigator.userAgent,
            url: window.location.href
        };
        const storageDump = {
            ...dump,
            logs: dump.logs.slice(-20),
            ipcCalls: dump.ipcCalls.slice(-20),
            actions: dump.actions.slice(-20)
        };
        try {
            localStorage.setItem('bmm_last_crash_dump', JSON.stringify(storageDump));
        }
        catch (_e) {
            try {
                localStorage.removeItem('bmm_last_crash_dump');
                localStorage.setItem('bmm_last_crash_dump', JSON.stringify({ reason: dump.reason, timestamp: dump.timestamp }));
            }
            catch (_e2) { /* ignore */ }
        }
        const dumpStr = JSON.stringify(dump, null, 2);
        if (window.__TAURI__ && window.__TAURI__.core) {
            window.__TAURI__.core.invoke('trigger_manual_crash_report', { frontendDump: dumpStr })
                .then(path => console.log('[BMM-DEBUG] Crash report generated at:', path))
                .catch(err => {
                console.error('[BMM-DEBUG] Failed to send crash dump to backend:', err);
                this._fallbackDownload(dumpStr, reason);
            });
        }
        else {
            this._fallbackDownload(dumpStr, reason);
        }
    }
    _fallbackDownload(dumpStr, reason) {
        if (reason !== 'MANUAL') {
            const _blob = new Blob([dumpStr], { type: 'application/json' });
            const _url = URL.createObjectURL(_blob);
            const _a = document.createElement('a');
            _a.href = _url;
            _a.download = `bmm-crash-dump-${Date.now()}.json`;
        }
    }
}
export const debugHub = new DebugHub();
// --- Performance Tracking ---
let frameCount = 0;
let lastTime = performance.now();
function updatePerformance() {
    frameCount++;
    const now = performance.now();
    if (now >= lastTime + 1000) {
        debugHub.metrics.fps = Math.round((frameCount * 1000) / (now - lastTime));
        frameCount = 0;
        lastTime = now;
        if (window.performance?.memory) {
            debugHub.metrics.memory = {
                used: window.performance.memory.usedJSHeapSize,
                total: window.performance.memory.totalJSHeapSize,
                limit: window.performance.memory.jsHeapSizeLimit
            };
        }
        debugHub.emit('metrics', debugHub.metrics);
    }
    requestAnimationFrame(updatePerformance);
}
if (typeof window !== 'undefined') {
    requestAnimationFrame(updatePerformance);
}
//# sourceMappingURL=debug.js.map