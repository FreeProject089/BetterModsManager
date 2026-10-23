import type { DiagramSpec } from '../diagram-spec.js';

// Offline mode as core/offline.ts implements it: the OS signal (navigator.onLine and the window
// online/offline events) plus a reachability probe of two public endpoints, re-run on two
// timers. Being offline shows the #offline-banner and fires a bmm-connectivity event; it gates
// nothing. A network feature started offline runs and fails with its own error, which is what
// lets a repo on the LAN or the local API work with no internet at all.
export const offlineMode: DiagramSpec = {
    id: 'offline-mode',
    i18n: 'docs.diagram.offline-mode',
    category: 'sharing',
    dir: 'TB',
    article: 'offline',
    related: ['server-mode', 'telemetry-pipeline', 'app-update'],
    groups: [
        { id: 'DETECT' },
        { id: 'STATE', dir: 'LR' },
        { id: 'EFFECT' },
    ],
    nodes: [
        { id: 'BOOT', kind: 'front', group: 'DETECT', icon: 'icon-start', refs: ['frontend/src/ui/app.ts › initOfflineDetection', 'frontend/src/core/offline.ts › initOffline'] },
        { id: 'OS', kind: 'ext', group: 'DETECT', icon: 'icon-network', refs: ['frontend/src/core/offline.ts › initOffline'] },
        { id: 'TIMERS', kind: 'front', group: 'DETECT', icon: 'icon-time', refs: ['frontend/src/core/offline.ts › initOffline'] },
        { id: 'PROBE', kind: 'front', group: 'DETECT', icon: 'icon-search', refs: ['frontend/src/core/offline.ts › recheck', 'frontend/src/core/offline.ts › probe'] },
        { id: 'ENDPOINTS', kind: 'ext', group: 'DETECT', icon: 'icon-globe', refs: ['frontend/src/core/offline.ts › PROBE_URLS'] },
        { id: 'REACH', kind: 'decision', group: 'DETECT', refs: ['frontend/src/core/offline.ts › probe'] },

        { id: 'ONLINE', kind: 'outcome', group: 'STATE', icon: 'icon-check', refs: ['frontend/src/core/offline.ts › setOnline', 'frontend/src/core/offline.ts › isOnline'] },
        { id: 'OFFLINE', kind: 'outcome', group: 'STATE', icon: 'icon-warning', refs: ['frontend/src/core/offline.ts › setOnline'] },

        { id: 'BANNER', kind: 'ui', group: 'EFFECT', icon: 'icon-info', refs: ['frontend/src/core/offline.ts › render', 'frontend/index.html'] },
        { id: 'EVENT', kind: 'front', group: 'EFFECT', icon: 'icon-activity', refs: ['frontend/src/core/offline.ts › setOnline', 'frontend/src/core/offline.ts › bmmIsOnline'] },
        { id: 'NOTLOCK', kind: 'outcome', group: 'EFFECT', icon: 'icon-unlock', refs: ['frontend/src/core/offline.ts', 'frontend/src/features/repo/repo-sync.ts', 'src-tauri/src/commands/repo_server.rs › start_repo_server'] },
    ],
    edges: [
        { from: 'BOOT', to: 'PROBE', label: 'first', thick: true },
        { from: 'OS', to: 'PROBE', label: '~online', tone: 'info' },
        { from: 'OS', to: 'OFFLINE', label: '~offline', tone: 'warn', dashed: true },
        { from: 'TIMERS', to: 'PROBE', label: 'timer', dashed: true },
        { from: 'PROBE', to: 'ENDPOINTS', label: 'noCors', tone: 'info' },
        { from: 'ENDPOINTS', to: 'REACH', thick: true },
        { from: 'REACH', to: 'ONLINE', label: 'anyAnswer', tone: 'ok', thick: true },
        { from: 'REACH', to: 'OFFLINE', label: 'bothFail', tone: 'danger' },
        { from: 'OFFLINE', to: 'BANNER', thick: true },
        { from: 'OFFLINE', to: 'EVENT' },
        { from: 'ONLINE', to: 'EVENT', label: 'changed', dashed: true },
        { from: 'BANNER', to: 'NOTLOCK', thick: true },
    ],
};
