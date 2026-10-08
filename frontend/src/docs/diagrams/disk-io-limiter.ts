import type { DiagramSpec } from '../diagram-spec.js';

// The resource governor (src-tauri/src/governor/), which replaced the old per-copy "disk I/O
// limiter": every heavy operation takes a ticket of its kind (Deploy, Backup, Install, Extract,
// Compress, Scan, Hash, Download, Image, Maintenance), gets a policy resolved for the disk it
// touches (preset, then per-disk rules, then hard bounds), and copies through one rate limiter
// per volume, checking the ticket for pause and cancel between chunks.
export const diskIoLimiter: DiagramSpec = {
    id: 'disk-io-limiter',
    i18n: 'docs.diagram.disk-io-limiter',
    category: 'profiles',
    dir: 'TB',
    article: 'disk-io-limiter',
    related: ['mod-activation', 'cache-management', 'faq-disk-full', 'perf-monitoring'],
    groups: [
        { id: 'SET', dir: 'LR' },
        { id: 'GOV' },
        { id: 'COPY' },
    ],
    nodes: [
        { id: 'PRESET', kind: 'ui', group: 'SET', icon: 'icon-speed', refs: ['src-tauri/src/commands/resources.rs › resources_set_preset', 'src-tauri/src/governor/config.rs › Preset', 'src-tauri/src/commands/storage_presets.rs › storage_preset_apply'] },
        { id: 'RULES', kind: 'ui', group: 'SET', icon: 'icon-grid', refs: ['src-tauri/src/commands/resources_rules.rs › resources_set_rule', 'src-tauri/src/commands/disk.rs › set_disk_limit', 'src-tauri/src/commands/disk.rs › benchmark_disk'] },
        { id: 'APP_MODE', kind: 'ext', group: 'SET', icon: 'icon-app', refs: ['src-tauri/src/governor/game_mode.rs › effective_preset', 'src-tauri/src/governor/game_mode.rs › treatment', 'src-tauri/src/governor/procs.rs'] },
        { id: 'CONFIG', kind: 'data', group: 'SET', icon: 'icon-database', refs: ['src-tauri/src/governor/config.rs › ResourcesConfig', 'src-tauri/src/governor/runtime.rs › configure'] },

        { id: 'TICKET', kind: 'rust', group: 'GOV', icon: 'icon-list', refs: ['src-tauri/src/governor/runtime.rs › begin', 'src-tauri/src/governor/queue.rs › Ticket', 'src-tauri/src/governor/config.rs › OpKind'] },
        { id: 'RESOLVE', kind: 'rust', group: 'GOV', icon: 'icon-scales', refs: ['src-tauri/src/governor/runtime.rs › policy_for', 'src-tauri/src/governor/config.rs › resolve', 'src-tauri/src/governor/config.rs › clamp'] },
        { id: 'POOL', kind: 'rust', group: 'GOV', icon: 'icon-cpu', refs: ['src-tauri/src/governor/runtime.rs › pool', 'src-tauri/src/governor/config.rs › pool_threads', 'src-tauri/src/fs_utils.rs › run_deploy_parallel'] },

        { id: 'FULL_SPEED', kind: 'decision', group: 'COPY', refs: ['src-tauri/src/fs_utils.rs › legacy_full_speed', 'src-tauri/src/fs_utils.rs › copy_file_governed'] },
        { id: 'OS_COPY', kind: 'ext', group: 'COPY', icon: 'icon-zap', refs: ['src-tauri/src/fs_utils.rs › copy_file_governed'] },
        { id: 'CHUNKS', kind: 'rust', group: 'COPY', icon: 'icon-stream', refs: ['src-tauri/src/governor/io.rs › copy_file_governed', 'src-tauri/src/governor/win.rs'] },
        { id: 'LIMITER', kind: 'rust', group: 'COPY', icon: 'icon-meter', refs: ['src-tauri/src/governor/io.rs › RateLimiter', 'src-tauri/src/governor/io.rs › limiter_for', 'src-tauri/src/governor/config.rs › rate_is_op_specific'] },
        { id: 'CHECKPOINT', kind: 'decision', group: 'COPY', refs: ['src-tauri/src/governor/queue.rs › checkpoint', 'src-tauri/src/commands/resources.rs › resources_queue'] },
        { id: 'DONE', kind: 'outcome', group: 'COPY', icon: 'icon-check', refs: ['src-tauri/src/governor/io.rs › copy_file_governed'] },
        { id: 'CANCELLED', kind: 'outcome', group: 'COPY', icon: 'icon-stop', refs: ['src-tauri/src/governor/io.rs › copy_file_governed', 'src-tauri/src/governor/io.rs › CopyError'] },
    ],
    edges: [
        { from: 'PRESET', to: 'CONFIG', label: '~writes' },
        { from: 'RULES', to: 'CONFIG', label: '~writes' },
        { from: 'APP_MODE', to: 'RESOLVE', label: 'appPreset', tone: 'warn', dashed: true },
        { from: 'APP_MODE', to: 'TICKET', label: 'pausesBg', tone: 'warn', dashed: true },
        { from: 'CONFIG', to: 'RESOLVE', label: '~reads' },
        { from: 'TICKET', to: 'RESOLVE', thick: true },
        { from: 'RESOLVE', to: 'POOL', label: 'threads', tone: 'info' },
        { from: 'RESOLVE', to: 'FULL_SPEED', label: '~perFile', thick: true },
        { from: 'FULL_SPEED', to: 'OS_COPY', label: '~yes', tone: 'ok' },
        { from: 'FULL_SPEED', to: 'CHUNKS', label: '~no', tone: 'info', thick: true },
        { from: 'CHUNKS', to: 'LIMITER', label: 'perChunk', thick: true },
        { from: 'LIMITER', to: 'CHECKPOINT', thick: true },
        { from: 'CHECKPOINT', to: 'CHUNKS', label: '~next', tone: 'ok' },
        { from: 'CHECKPOINT', to: 'CANCELLED', label: '~cancel', tone: 'danger', dashed: true },
        { from: 'CHECKPOINT', to: 'DONE', label: 'eof', tone: 'ok', thick: true },
        { from: 'OS_COPY', to: 'DONE' },
    ],
};
