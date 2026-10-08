import type { DiagramSpec } from '../diagram-spec.js';

// The MCP server and the CLI are ONE executable, bmm-mcp-server (a cargo [[example]] built from
// src/extra_tools/mcp_server.rs, shipped as the app's externalBin sidecar): no subcommand serves MCP
// over stdio (mcp/server.rs), a subcommand runs the CLI. Both read and write BMM's files directly
// (mcp/state_bridge.rs), so they work with BMM closed, and reach the running app through the live
// bridge api_call → the local HTTP API (src/api/mod.rs) with the admin token.
export const mcpServer: DiagramSpec = {
    id: 'mcp-server',
    i18n: 'docs.diagram.mcp-server',
    category: 'automation',
    dir: 'TB',
    article: 'mcp-server',
    related: ['scheduler', 'bmmscript-flow', 'laya-pipeline', 'security-system'],
    groups: [
        { id: 'CALLERS', dir: 'LR' },
        { id: 'BINARY' },
        { id: 'APP' },
    ],
    nodes: [
        { id: 'AI_CLIENT', kind: 'ext', group: 'CALLERS', icon: 'icon-brain', refs: ['src-tauri/src/extra_tools/mcp_server.rs › run_mcp_server'] },
        { id: 'TERMINAL', kind: 'ext', group: 'CALLERS', icon: 'icon-terminal', refs: ['src-tauri/src/extra_tools/mcp_server.rs › Commands'] },

        { id: 'EXE', kind: 'rust', group: 'BINARY', icon: 'icon-app', refs: ['src-tauri/src/extra_tools/mcp_server.rs › run', 'src-tauri/Cargo.toml', 'src-tauri/tauri.conf.json › externalBin'] },
        { id: 'MCP', kind: 'rust', group: 'BINARY', icon: 'icon-command', refs: ['src-tauri/src/mcp/server.rs › BmmMcpServer', 'src-tauri/src/mcp/server.rs › list_tools', 'scripts/check-mcp-tools.mjs'] },
        { id: 'CLI', kind: 'rust', group: 'BINARY', icon: 'icon-terminal', refs: ['src-tauri/src/extra_tools/mcp_server.rs › run_cli_command', 'src-tauri/src/extra_tools/mcp_server.rs › read_json_arg'] },
        { id: 'OFFLINE', kind: 'rust', group: 'BINARY', icon: 'icon-disk', refs: ['src-tauri/src/mcp/state_bridge.rs › read_app_data', 'src-tauri/src/mcp/state_bridge.rs › write_app_data', 'src-tauri/src/mcp/state_bridge.rs › get_bmm_data_dir'] },
        { id: 'SHARED', kind: 'rust', group: 'BINARY', icon: 'icon-layers', refs: ['src-tauri/src/extra_tools/mcp_server.rs › bmms', 'src-tauri/src/mcp/tools/ai.rs', 'src-tauri/src/mcp/server.rs › BMMS_VOCABULARY'] },
        { id: 'LIVE', kind: 'rust', group: 'BINARY', icon: 'icon-link', refs: ['src-tauri/src/mcp/state_bridge.rs › api_call', 'src-tauri/src/mcp/server.rs › tool_api_call'] },

        { id: 'DATA', kind: 'data', group: 'APP', icon: 'icon-database', refs: ['src-tauri/src/mcp/state_bridge.rs › BmmAppData', 'src-tauri/src/mcp/state_bridge.rs › list_schedules', 'src-tauri/src/mcp/state_bridge.rs › schedule_runs'] },
        { id: 'API', kind: 'rust', group: 'APP', icon: 'icon-server', refs: ['src-tauri/src/api/mod.rs › start_api_server', 'src-tauri/src/api/mod.rs › require_token', 'src-tauri/src/api/mod.rs › require_permission'] },
        { id: 'APP_UI', kind: 'front', group: 'APP', icon: 'icon-play', refs: ['frontend/src/core/api_activity.ts › initApiActivity'] },
    ],
    edges: [
        { from: 'AI_CLIENT', to: 'EXE', label: 'stdio', tone: 'info', thick: true },
        { from: 'TERMINAL', to: 'EXE', label: 'subcommand', tone: 'info' },
        { from: 'EXE', to: 'MCP', label: 'serve', thick: true },
        { from: 'EXE', to: 'CLI', label: 'cli' },
        { from: 'MCP', to: 'OFFLINE', thick: true },
        { from: 'CLI', to: 'OFFLINE' },
        { from: 'MCP', to: 'SHARED', dashed: true },
        { from: 'MCP', to: 'LIVE', label: 'appRunning', tone: 'warn' },
        { from: 'CLI', to: 'LIVE', label: 'appRunning', tone: 'warn' },
        { from: 'OFFLINE', to: 'DATA', label: 'readWrite', thick: true },
        { from: 'LIVE', to: 'API', label: 'bearer', tone: 'ok', thick: true },
        { from: 'API', to: 'APP_UI', label: '~event', dashed: true },
        { from: 'API', to: 'DATA', label: '~writes' },
        { from: 'MCP', to: 'AI_CLIENT', label: 'result', dashed: true },
    ],
};
