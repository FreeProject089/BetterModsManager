import type { DiagramSpec } from '../diagram-spec.js';

// Where BMM's work runs, as it does today: the webview calls async commands on Tauri's runtime;
// long work moves to blocking tasks, takes a ticket of the resource governor (governor/queue.rs)
// and runs on that kind's rayon pool (governor/runtime.rs). A mod's file work goes further, to a
// second process (`bmm.exe --mod-worker`, fs_utils.rs run_mod_worker) spawned and watched by
// mods.rs run_mod_io_worker_with_mode, killed on cancel and followed by an inverse undo.
export const engineThreads: DiagramSpec = {
    id: 'engine-threads',
    i18n: 'docs.diagram.engine-threads',
    category: 'internals',
    dir: 'TB',
    article: 'engine-threads',
    related: ['code-stack', 'disk-io-limiter', 'mod-activation', 'blake3-hashing'],
    groups: [
        { id: 'APP' },
        { id: 'GOV' },
        { id: 'PROC' },
    ],
    nodes: [
        { id: 'WEBVIEW', kind: 'ui', group: 'APP', icon: 'icon-layout', refs: ['src-tauri/src/main.rs › main', 'src-tauri/src/boot_flags.rs › apply_at_boot'] },
        { id: 'ASYNC', kind: 'rust', group: 'APP', icon: 'icon-flow', refs: ['src-tauri/src/main.rs › start_api_server', 'src-tauri/src/commands/mods.rs › spawn_blocking', 'src-tauri/src/fs_utils.rs › enter_thread_scope'] },
        { id: 'LOCK', kind: 'rust', group: 'APP', icon: 'icon-lock', refs: ['src-tauri/src/commands/mods.rs › MOD_OP_LOCK'] },
        { id: 'BG', kind: 'rust', group: 'APP', icon: 'icon-time', refs: ['src-tauri/src/commands/mods.rs › start_sha_calculation_background', 'src-tauri/src/commands/mods.rs › start_content_id_background'] },

        { id: 'TICKET', kind: 'rust', group: 'GOV', icon: 'icon-list', refs: ['src-tauri/src/governor/queue.rs › Ticket', 'src-tauri/src/governor/queue.rs › is_background', 'src-tauri/src/governor/runtime.rs › begin'] },
        { id: 'GAME', kind: 'decision', group: 'GOV', refs: ['src-tauri/src/governor/procs.rs › start', 'src-tauri/src/governor/game_mode.rs › treatment'] },
        { id: 'POOLS', kind: 'rust', group: 'GOV', icon: 'icon-cpu', refs: ['src-tauri/src/governor/config.rs › pool_threads', 'src-tauri/src/governor/runtime.rs › pool', 'src-tauri/src/main.rs › ThreadPoolBuilder'] },
        { id: 'DISK', kind: 'data', group: 'GOV', icon: 'icon-drive', link: 'disk-io-limiter', refs: ['src-tauri/src/governor/io.rs › RateLimiter', 'src-tauri/src/governor/io.rs › copy_file_governed'] },

        { id: 'SPAWN', kind: 'rust', group: 'PROC', icon: 'icon-play', refs: ['src-tauri/src/commands/mods.rs › run_mod_io_worker_with_mode', 'src-tauri/src/commands/proc.rs › hidden_command'] },
        { id: 'WORKER', kind: 'rust', group: 'PROC', icon: 'icon-cpu', refs: ['src-tauri/src/fs_utils.rs › run_mod_worker', 'src-tauri/src/main.rs › run_mod_worker'] },
        { id: 'CANCEL', kind: 'rust', group: 'PROC', icon: 'icon-stop', refs: ['src-tauri/src/commands/mods.rs › cancel_mod_ops', 'src-tauri/src/commands/mods.rs › kill_worker_pid', 'src-tauri/src/commands/mods.rs › make_inverse_undo_input'] },

        { id: 'PROGRESS', kind: 'outcome', icon: 'icon-activity', refs: ['src-tauri/src/commands/mods.rs › emit_mod_op', 'frontend/src/core/activation-jobs.ts › MOD_OP_PROGRESS_EVENT'] },
    ],
    edges: [
        { from: 'WEBVIEW', to: 'ASYNC', label: '~invoke', tone: 'info', thick: true },
        { from: 'ASYNC', to: 'LOCK', label: 'blockingTask', thick: true },
        { from: 'LOCK', to: 'TICKET', label: 'deploy', thick: true },
        { from: 'BG', to: 'TICKET', label: 'background', dashed: true },
        { from: 'GAME', to: 'TICKET', label: 'pauses', tone: 'warn', dashed: true },
        { from: 'TICKET', to: 'POOLS', label: 'otherKinds' },
        { from: 'POOLS', to: 'DISK' },
        { from: 'TICKET', to: 'SPAWN', thick: true },
        { from: 'SPAWN', to: 'WORKER', thick: true },
        { from: 'WORKER', to: 'DISK', label: 'sameRules', thick: true },
        { from: 'WEBVIEW', to: 'CANCEL', label: '~cancel', tone: 'danger', dashed: true },
        { from: 'CANCEL', to: 'WORKER', label: 'kill', tone: 'danger', dashed: true },
        { from: 'SPAWN', to: 'PROGRESS', label: 'progress', thick: true },
        { from: 'PROGRESS', to: 'WEBVIEW', label: '~event', tone: 'info', dashed: true },
    ],
};
