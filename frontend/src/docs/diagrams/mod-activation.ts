import type { DiagramSpec } from '../diagram-spec.js';

// Turning a mod on or off, as it runs today: every toggle, order list or modpack becomes a job of
// core/activation-jobs.ts (one mod at a time, its own cancel scope), and each mod is one
// enable_mod / disable_mod call whose file work runs in the mod I/O worker (fs_utils.rs).
// The game folder is shared by every profile pointed at it, so "is this file a game original?"
// and "who provides it now?" are asked across those profiles (mod_order::game_folder_share).
export const modActivation: DiagramSpec = {
    id: 'mod-activation',
    i18n: 'docs.diagram.mod-activation',
    category: 'mods',
    dir: 'TB',
    article: 'activation',
    related: ['conflict-management', 'profile-system', 'integrity-engine', 'disk-io-limiter'],
    groups: [
        { id: 'JOB', dir: 'LR' },
        { id: 'ON' },
        { id: 'OFF' },
    ],
    nodes: [
        { id: 'START', kind: 'ui', group: 'JOB', icon: 'icon-toggle', refs: ['frontend/src/core/activation-jobs.ts › runActivationJob', 'frontend/src/core/activation-jobs.ts › runActivationBatch'] },
        { id: 'QUEUE', kind: 'front', group: 'JOB', icon: 'icon-list', refs: ['frontend/src/core/activation-jobs.ts › pump', 'frontend/src/core/activation-jobs.ts › runJob'] },
        { id: 'CANCEL', kind: 'ui', group: 'JOB', icon: 'icon-stop', refs: ['src-tauri/src/commands/mods.rs › cancel_mod_ops', 'src-tauri/src/fs_utils.rs › CancelScope', 'src-tauri/src/commands/mods.rs › make_inverse_undo_input'] },

        { id: 'ENABLE', kind: 'rust', group: 'ON', icon: 'icon-plus', refs: ['src-tauri/src/commands/mods.rs › enable_mod', 'src-tauri/src/commands/mods.rs › enable_mod_in', 'src-tauri/src/commands/mods.rs › resolve_dependencies'] },
        { id: 'OWNED', kind: 'decision', group: 'ON', refs: ['src-tauri/src/fs_utils.rs › backup_original_file', 'src-tauri/src/commands/mod_order.rs › game_folder_share'] },
        { id: 'BACKUP', kind: 'data', group: 'ON', icon: 'icon-disk', refs: ['src-tauri/src/fs_utils.rs › backup_original_file'] },
        { id: 'COPY', kind: 'rust', group: 'ON', icon: 'icon-patch', refs: ['src-tauri/src/fs_utils.rs › apply_mod_stacked_ticketed', 'src-tauri/src/fs_utils.rs › run_deploy_parallel'] },

        { id: 'DISABLE', kind: 'rust', group: 'OFF', icon: 'icon-minus', refs: ['src-tauri/src/commands/mods.rs › disable_mod', 'src-tauri/src/commands/mods.rs › disable_mod_in', 'src-tauri/src/commands/mod_order.rs › shared_fallback_order'] },
        { id: 'PROVIDER', kind: 'decision', group: 'OFF', refs: ['src-tauri/src/fs_utils.rs › unapply_mod_stacked_shared_ticketed'] },
        { id: 'RESTORE_MOD', kind: 'rust', group: 'OFF', icon: 'icon-layers', refs: ['src-tauri/src/fs_utils.rs › unapply_mod_stacked_shared_ticketed', 'src-tauri/src/commands/mod_order.rs › read_roots'] },
        { id: 'ORIGINAL', kind: 'decision', group: 'OFF', refs: ['src-tauri/src/fs_utils.rs › unapply_mod_stacked_shared_ticketed'] },
        { id: 'RESTORE_ORIG', kind: 'rust', group: 'OFF', icon: 'icon-restore', refs: ['src-tauri/src/fs_utils.rs › unapply_mod_stacked_shared_ticketed'] },
        { id: 'DELETE', kind: 'rust', group: 'OFF', icon: 'icon-trash', refs: ['src-tauri/src/fs_utils.rs › ensure_removed'] },
        { id: 'CASCADE', kind: 'rust', group: 'OFF', icon: 'icon-flow', refs: ['src-tauri/src/commands/mods.rs › disable_mod_in', 'src-tauri/src/commands/mods.rs › parse_dep_ref'] },

        { id: 'SAVED', kind: 'outcome', icon: 'icon-check', refs: ['src-tauri/src/commands/mods.rs › emit_mod_op', 'frontend/src/core/activation-jobs.ts › handleProgressEvent', 'src-tauri/src/commands/history.rs › log_activity'] },
    ],
    edges: [
        { from: 'START', to: 'QUEUE', thick: true },
        { from: 'CANCEL', to: 'QUEUE', label: 'stop', tone: 'danger', dashed: true },
        { from: 'QUEUE', to: 'ENABLE', label: 'enable', tone: 'ok', thick: true },
        { from: 'QUEUE', to: 'DISABLE', label: 'disable', tone: 'warn', thick: true },

        { from: 'ENABLE', to: 'OWNED', label: 'perFile', tone: 'info' },
        { from: 'OWNED', to: 'BACKUP', label: 'gameFile', tone: 'ok' },
        { from: 'OWNED', to: 'COPY', label: 'modFile', tone: 'warn' },
        { from: 'BACKUP', to: 'COPY' },
        { from: 'COPY', to: 'SAVED', thick: true },

        { from: 'DISABLE', to: 'PROVIDER', label: 'perFile', tone: 'info' },
        { from: 'PROVIDER', to: 'RESTORE_MOD', label: '~yes', tone: 'ok' },
        { from: 'PROVIDER', to: 'ORIGINAL', label: '~no', tone: 'warn' },
        { from: 'ORIGINAL', to: 'RESTORE_ORIG', label: '~yes', tone: 'ok' },
        { from: 'ORIGINAL', to: 'DELETE', label: '~no', tone: 'danger' },
        { from: 'RESTORE_MOD', to: 'CASCADE' },
        { from: 'RESTORE_ORIG', to: 'CASCADE' },
        { from: 'DELETE', to: 'CASCADE' },
        { from: 'CASCADE', to: 'DISABLE', label: 'orphans', dashed: true },
        { from: 'CASCADE', to: 'SAVED', thick: true },
    ],
};
