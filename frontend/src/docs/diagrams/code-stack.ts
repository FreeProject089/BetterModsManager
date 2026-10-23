import type { DiagramSpec } from '../diagram-spec.js';

// The layers BMM is built from, as they run today: one HTML page in the OS webview whose
// TypeScript (compiled by tsc, no bundler) reaches the Rust core only through invoke()
// (core/api.ts); a Tauri v2 core (main.rs) registering every command, one shared AppState saved
// to data.json, the resource governor and the separate mod I/O worker process; and beside the
// window, the local HTTP API (api/mod.rs, warp) and the bmm-mcp-server sidecar (CLI + MCP).
export const codeStack: DiagramSpec = {
    id: 'code-stack',
    i18n: 'docs.diagram.code-stack',
    category: 'internals',
    dir: 'TB',
    article: 'code-stack',
    related: ['engine-threads', 'mcp-server', 'theme-system', 'i18n-system'],
    groups: [
        { id: 'WEB' },
        { id: 'CORE' },
        { id: 'SIDE', dir: 'LR' },
        { id: 'OUT', dir: 'LR' },
    ],
    nodes: [
        { id: 'PAGE', kind: 'ui', group: 'WEB', icon: 'icon-layout', refs: ['frontend/index.html', 'frontend/css/tokens.css'] },
        { id: 'MODULES', kind: 'front', group: 'WEB', icon: 'icon-code', refs: ['frontend/src/ui/app.ts', 'frontend/tsconfig.json'] },
        { id: 'LAZY', kind: 'front', group: 'WEB', icon: 'icon-download', refs: ['frontend/src/ui/lazy-vendor.ts › ensureMermaid', 'frontend/src/ui/lazy-vendor.ts › ensureKatex', 'scripts/check-boot-weight.mjs'] },
        { id: 'BRIDGE', kind: 'front', group: 'WEB', icon: 'icon-link', refs: ['frontend/src/core/api.ts › invoke', 'frontend/src/core/api.ts › loadTauri'] },

        { id: 'BUILDER', kind: 'rust', group: 'CORE', icon: 'icon-app', refs: ['src-tauri/src/main.rs › generate_handler', 'src-tauri/src/boot_flags.rs › apply_at_boot', 'src-tauri/tauri.conf.json'] },
        { id: 'COMMANDS', kind: 'rust', group: 'CORE', icon: 'icon-command', refs: ['src-tauri/src/commands/mod.rs', 'src-tauri/src/commands/mods.rs › spawn_blocking'] },
        { id: 'STATE', kind: 'rust', group: 'CORE', icon: 'icon-database', refs: ['src-tauri/src/state.rs › AppState', 'src-tauri/src/state.rs › atomic_write_bytes'] },
        { id: 'GOVERNOR', kind: 'rust', group: 'CORE', icon: 'icon-meter', link: 'engine-threads', refs: ['src-tauri/src/governor/runtime.rs › global', 'src-tauri/src/governor/mod.rs'] },
        { id: 'WORKER', kind: 'rust', group: 'CORE', icon: 'icon-cpu', link: 'engine-threads', refs: ['src-tauri/src/main.rs › run_mod_worker', 'src-tauri/src/fs_utils.rs › run_mod_worker'] },

        { id: 'API', kind: 'rust', group: 'SIDE', icon: 'icon-server', refs: ['src-tauri/src/api/mod.rs › start_api_server', 'src-tauri/src/api/mod.rs › host_allowed'] },
        { id: 'MCP', kind: 'rust', group: 'SIDE', icon: 'icon-terminal', link: 'mcp-server', refs: ['src-tauri/src/extra_tools/mcp_server.rs', 'src-tauri/src/mcp/state_bridge.rs › api_call'] },

        { id: 'DATA', kind: 'data', group: 'OUT', icon: 'icon-disk', refs: ['src-tauri/src/main.rs › migrate_legacy_appdata', 'src-tauri/src/state.rs › save'] },
        { id: 'NET', kind: 'ext', group: 'OUT', icon: 'icon-globe', refs: ['src-tauri/Cargo.toml', 'src-tauri/src/commands/net.rs › client'] },
    ],
    edges: [
        { from: 'PAGE', to: 'MODULES', label: 'loads', thick: true },
        { from: 'MODULES', to: 'LAZY', label: 'onDemand', dashed: true },
        { from: 'MODULES', to: 'BRIDGE', thick: true },
        { from: 'BRIDGE', to: 'BUILDER', label: '~invoke', tone: 'info', thick: true },
        { from: 'BUILDER', to: 'COMMANDS', thick: true },
        { from: 'COMMANDS', to: 'BRIDGE', label: '~event', tone: 'info', dashed: true },
        { from: 'COMMANDS', to: 'STATE', thick: true },
        { from: 'COMMANDS', to: 'GOVERNOR', label: 'heavyWork' },
        { from: 'COMMANDS', to: 'WORKER', label: 'bigCopies' },
        { from: 'WORKER', to: 'GOVERNOR', label: 'sameRules', dashed: true },
        { from: 'STATE', to: 'DATA', label: '~writes', thick: true },
        { from: 'COMMANDS', to: 'NET', dashed: true },
        { from: 'BUILDER', to: 'API', label: 'starts', dashed: true },
        { from: 'API', to: 'STATE', label: 'sameState' },
        { from: 'MCP', to: 'API', label: 'liveCalls' },
        { from: 'MCP', to: 'DATA', label: '~reads', dashed: true },
    ],
};
