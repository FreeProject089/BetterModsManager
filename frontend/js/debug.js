import { appState } from './state.js';

class DebugHub {
    constructor() {
        this.logs = [];
        this.ipcCalls = [];
        this.actions = [];
        this.patches = []; // { id, type, content, timestamp }
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
            this.emit('state', { key, value });
        };

        this.setupGlobalHandlers();
    }

    /**
     * Subscribe to debug events
     */
    subscribe(callback) {
        this.listeners.add(callback);
    }

    /**
     * Unsubscribe from debug events
     */
    unsubscribe(callback) {
        this.listeners.delete(callback);
    }

    /**
     * Emit an event to all listeners
     */
    emit(type, data) {
        if (!this.isEnabled) return;
        const event = { type, data, timestamp: Date.now() };
        this.listeners.forEach(cb => cb(event));
    }

    /**
     * Record a console log
     */
    recordLog(level, args) {
        const message = args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');

        const item = { level, message, id: Math.random().toString(36).substr(2, 9) };
        this.logs.push(item);
        if (this.logs.length > this.maxItems) this.logs.shift();
        
        this.emit('log', item);
    }

    /**
     * Record an IPC (Invoke) call
     */
    recordIPC(command, args, status = 'pending', result = null, duration = 0) {
        let call = this.ipcCalls.find(c => c.command === command && c.args === args && c.status === 'pending');
        
        if (!call) {
            call = { 
                id: Math.random().toString(36).substr(2, 9),
                command, 
                args, 
                status, 
                result, 
                duration,
                timestamp: Date.now()
            };
            this.ipcCalls.push(call);
            if (this.ipcCalls.length > this.maxItems) this.ipcCalls.shift();
        } else {
            call.status = status;
            call.result = result;
            call.duration = duration;
        }

        this.emit('ipc', call);
        return call;
    }

    /**
     * Patch Management
     */
    applyPatch(type, content) {
        const id = 'patch-' + Math.random().toString(36).substr(2, 9);
        const patch = { id, type, content, timestamp: Date.now() };
        
        if (type === 'CSS') {
            const style = document.createElement('style');
            style.id = id;
            style.textContent = content;
            document.head.appendChild(style);
        } else if (type === 'JS') {
            try {
                // We wrap it to track it if needed, but eval is fine for playground
                eval(content);
            } catch (e) {
                this.recordLog('error', [`[Patch-JS] ${e.message}`]);
                throw e;
            }
        }
        
        this.patches.push(patch);
        this.emit('patches', this.patches);
        this.recordAction('PATCH_APPLY', { tagName: 'PATCH', id: id }, type);
        return id;
    }

    removePatch(id) {
        const index = this.patches.findIndex(p => p.id === id);
        if (index === -1) return;
        
        const patch = this.patches[index];
        if (patch.type === 'CSS') {
            const el = document.getElementById(id);
            if (el) el.remove();
        }
        
        this.patches.splice(index, 1);
        this.emit('patches', this.patches);
        this.recordAction('PATCH_REMOVE', { tagName: 'PATCH', id: id }, patch.type);
    }

    /**
     * Record a UI Action
     */
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
        if (this.actions.length > this.maxItems) this.actions.shift();
        this.emit('action', item);
    }

    /**
     * Clear all debug data
     */
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

        console.error(`[BMM-DEBUG] ${reason} DUMP GENERATED`, dump);
        
        // Auto-save to localStorage for persistence after reload
        localStorage.setItem('bmm_last_crash_dump', JSON.stringify(dump));
        
        // Download it if it's a critical crash
        if (reason !== 'MANUAL') {
            const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `bmm-crash-dump-${Date.now()}.json`;
            // a.click(); // Optional: don't annoy user with downloads unless they want it
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

        // Try to get memory info (Chrome/Tauri specific)
        if (window.performance && window.performance.memory) {
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

// Start tracking if not in a head-less environment
if (typeof window !== 'undefined') {
    requestAnimationFrame(updatePerformance);
}
