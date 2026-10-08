import type { DiagramSpec } from '../diagram-spec.js';

// "My disk is filling up": where BMM puts bytes, what it checks before writing (the space check
// and the optional space alerts in enable_mod_in), what really happens when a write fails
// mid-copy (the mod I/O worker stops; only a CANCEL is undone), and where to see and reclaim
// space (Storage Manager, session retention).
export const faqDiskFull: DiagramSpec = {
    id: 'faq-disk-full',
    i18n: 'docs.diagram.faq-disk-full',
    category: 'profiles',
    dir: 'TB',
    article: 'faq-disk-full',
    related: ['mod-activation', 'backup-system', 'cache-management', 'disk-io-limiter'],
    groups: [
        { id: 'GUARD' },
        { id: 'WHERE', dir: 'LR' },
        { id: 'RECLAIM', dir: 'LR' },
    ],
    nodes: [
        { id: 'ENABLE', kind: 'ui', group: 'GUARD', icon: 'icon-toggle', refs: ['src-tauri/src/commands/mods.rs › enable_mod_in', 'frontend/src/core/activation-jobs.ts › runActivationJob'], link: 'mod-activation' },
        { id: 'ROOM', kind: 'decision', group: 'GUARD', refs: ['src-tauri/src/commands/mods.rs › enable_mod_in', 'src-tauri/src/commands/disk.rs › strip_verbatim'] },
        { id: 'ALERTS', kind: 'decision', group: 'GUARD', refs: ['src-tauri/src/state.rs › storage_alert_enabled', 'src-tauri/src/state.rs › default_storage_warning', 'src-tauri/src/state.rs › default_storage_critical'] },
        { id: 'REFUSED', kind: 'outcome', group: 'GUARD', icon: 'icon-stop', refs: ['frontend/src/features/mods/mods-list.ts', 'src-tauri/src/commands/mods.rs › emit_mod_op'] },
        { id: 'COPY', kind: 'rust', group: 'GUARD', icon: 'icon-patch', refs: ['src-tauri/src/fs_utils.rs › run_mod_worker', 'src-tauri/src/fs_utils.rs › apply_mod_stacked_ticketed'] },
        { id: 'WRITE_FAIL', kind: 'outcome', group: 'GUARD', icon: 'icon-warning', refs: ['src-tauri/src/commands/mods.rs › run_mod_io_worker_with_mode', 'src-tauri/src/commands/ai_assist.rs'] },
        { id: 'ON', kind: 'outcome', group: 'GUARD', icon: 'icon-check', refs: ['frontend/src/core/activation-jobs.ts › handleProgressEvent'] },

        { id: 'DEPLOYED', kind: 'data', group: 'WHERE', icon: 'icon-drive', refs: ['src-tauri/src/fs_utils.rs › copy_file_governed'] },
        { id: 'ORIGINALS', kind: 'data', group: 'WHERE', icon: 'icon-archive', refs: ['src-tauri/src/fs_utils.rs › backup_original_file'], link: 'backup-system' },
        { id: 'EXTRACTED', kind: 'data', group: 'WHERE', icon: 'icon-folder', refs: ['src-tauri/src/archive.rs › materialize', 'src-tauri/src/archive.rs › cache_dir_for'], link: 'cache-management' },
        { id: 'SESSIONS', kind: 'data', group: 'WHERE', icon: 'icon-history', refs: ['src-tauri/src/commands/analytics.rs › prune_sessions', 'frontend/src/features/settings/crash-manager.ts › sessionMaxMb'] },

        { id: 'STORAGE', kind: 'ui', group: 'RECLAIM', icon: 'icon-chart', refs: ['frontend/src/features/settings/storage-modal.ts › mountSpace', 'src-tauri/src/commands/disk.rs › get_system_disks', 'src-tauri/src/commands/disk.rs › get_folder_size'] },
    ],
    edges: [
        { from: 'ENABLE', to: 'ROOM', thick: true },
        { from: 'ROOM', to: 'REFUSED', label: 'tooSmall', tone: 'danger' },
        { from: 'ROOM', to: 'ALERTS', label: 'enough', tone: 'ok', thick: true },
        { from: 'ALERTS', to: 'REFUSED', label: 'critical', tone: 'danger' },
        { from: 'ALERTS', to: 'COPY', label: 'offOrOk', tone: 'ok', thick: true },
        { from: 'COPY', to: 'ON', label: '~ok', tone: 'ok', thick: true },
        { from: 'COPY', to: 'WRITE_FAIL', label: 'writeError', tone: 'danger', dashed: true },
        { from: 'COPY', to: 'DEPLOYED', label: '~writes' },
        { from: 'COPY', to: 'ORIGINALS', label: '~writes' },
        { from: 'ENABLE', to: 'EXTRACTED', label: 'archivedMod', tone: 'info', dashed: true },
        { from: 'DEPLOYED', to: 'STORAGE', dashed: true },
        { from: 'ORIGINALS', to: 'STORAGE', dashed: true },
        { from: 'SESSIONS', to: 'STORAGE', label: 'retention', dashed: true },
    ],
};
