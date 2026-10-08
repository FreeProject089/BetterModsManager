import type { DiagramSpec } from '../diagram-spec.js';

// The standalone ("lightweight") repo server, opened from Server Repo → Host beside
// "Generate the server". generate_standalone_server (commands/repo.rs) writes a small Node
// server next to an existing repo.json: either a polyglot .bat/.sh script (type "User") or an
// Express app (type "Server"), plus the access gate, the ban and allow lists, optional Docker
// files and an optional Windows autostart. It runs without BMM; BMM subscribers sync from it
// over HTTP.
export const lightweightArchitecture: DiagramSpec = {
    id: 'lightweight-architecture',
    i18n: 'docs.diagram.lightweight-architecture',
    category: 'internals',
    dir: 'TB',
    article: 'server-host',
    related: ['hosting-flow', 'server-mode', 'docker-deployment', 'security-system'],
    groups: [
        { id: 'BMM' },
        { id: 'FILES' },
        { id: 'HOST' },
    ],
    nodes: [
        { id: 'FORM', kind: 'ui', group: 'BMM', icon: 'icon-settings', refs: ['frontend/src/features/repo/repo-server.ts › generate_standalone_server', 'frontend/index.html'] },
        { id: 'GEN', kind: 'rust', group: 'BMM', icon: 'icon-build', refs: ['src-tauri/src/commands/repo.rs › generate_standalone_server', 'src-tauri/src/commands/repo.rs › StandaloneServerConfig'] },
        { id: 'TYPE', kind: 'decision', group: 'BMM', refs: ['src-tauri/src/commands/repo.rs › generate_mini_server_files'] },

        { id: 'SCRIPT', kind: 'data', group: 'FILES', icon: 'icon-script', refs: ['src-tauri/src/templates/mini-server/server.v2.bat.template', 'src-tauri/src/templates/mini-server/server.hybrid.sh.template'] },
        { id: 'EXPRESS', kind: 'data', group: 'FILES', icon: 'icon-code', refs: ['src-tauri/src/templates/mini-server/server.express.js.template', 'src-tauri/src/templates/mini-server/package.json.template', 'src-tauri/src/templates/mini-server/start.server.bat.template'] },
        { id: 'ACCESS', kind: 'data', group: 'FILES', icon: 'icon-key', refs: ['src-tauri/src/commands/repo.rs › write_access_gate', 'src-tauri/src/commands/repo.rs › write_access_starter', 'scripts/check-keyauth-copy.mjs'] },
        { id: 'LISTS', kind: 'data', group: 'FILES', icon: 'icon-shield', refs: ['src-tauri/src/commands/ban_manager.rs › get_ban_file_path', 'src-tauri/src/commands/whitelist_manager.rs › get_whitelist_file_path'] },
        { id: 'DOCKER', kind: 'data', group: 'FILES', icon: 'icon-box', link: 'docker-deployment', refs: ['src-tauri/src/commands/docker_export.rs › write_docker_files'] },
        { id: 'AUTOSTART', kind: 'ext', group: 'FILES', icon: 'icon-start', refs: ['src-tauri/src/commands/repo.rs › generate_mini_server_files'] },

        { id: 'NODE', kind: 'ext', group: 'HOST', icon: 'icon-server', refs: ['src-tauri/src/templates/mini-server/server.v2.bat.template', 'src-tauri/src/templates/mini-server/access-gate.js.template'] },
        { id: 'ENDPOINTS', kind: 'ext', group: 'HOST', icon: 'icon-network', refs: ['src-tauri/src/templates/mini-server/server.express.js.template', 'src-tauri/src/templates/mini-server/dashboard.html.template', 'src-tauri/src/commands/repo_server.rs › get_active_downloads'] },
        { id: 'SUBSCRIBERS', kind: 'outcome', group: 'HOST', icon: 'icon-users', link: 'server-mode', refs: ['src-tauri/src/commands/repo.rs › fetch_repo_info', 'src-tauri/src/commands/repo_keyauth.rs › add_proof'] },
    ],
    edges: [
        { from: 'FORM', to: 'GEN', label: '~invoke', tone: 'info', thick: true },
        { from: 'GEN', to: 'TYPE', thick: true },
        { from: 'TYPE', to: 'SCRIPT', label: 'user', tone: 'ok', thick: true },
        { from: 'TYPE', to: 'EXPRESS', label: 'server', tone: 'info' },
        { from: 'GEN', to: 'ACCESS' },
        { from: 'GEN', to: 'LISTS', label: 'copies' },
        { from: 'GEN', to: 'DOCKER', label: 'ifDocker', dashed: true },
        { from: 'GEN', to: 'AUTOSTART', label: 'ifAutostart', dashed: true },
        { from: 'SCRIPT', to: 'NODE', thick: true },
        { from: 'EXPRESS', to: 'NODE' },
        { from: 'ACCESS', to: 'NODE', label: '~reads', dashed: true },
        { from: 'LISTS', to: 'NODE', label: '~reads', dashed: true },
        { from: 'DOCKER', to: 'NODE', dashed: true },
        { from: 'AUTOSTART', to: 'NODE', label: 'atLogon', dashed: true },
        { from: 'NODE', to: 'ENDPOINTS', thick: true },
        { from: 'ENDPOINTS', to: 'SUBSCRIBERS', label: 'http', tone: 'ok', thick: true },
    ],
};
