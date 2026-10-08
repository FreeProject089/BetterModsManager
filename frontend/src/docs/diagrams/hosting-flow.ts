import type { DiagramSpec } from '../diagram-spec.js';

// Publishing a repo from Server Repo → Host: three alternative ways to produce the signed
// repo.json (export_server_repo, generate_repo_manifest, refresh_repo_from_server), then the
// ways to serve it (the built-in server of repo_server.rs, a generated standalone server, a
// multi-repo hub, or any static host reached over SSH), and the access rules that apply.
export const hostingFlow: DiagramSpec = {
    id: 'hosting-flow',
    i18n: 'docs.diagram.hosting-flow',
    category: 'sharing',
    dir: 'TB',
    article: 'server-host',
    related: ['server-mode', 'docker-deployment', 'security-system', 'resumable-downloads'],
    groups: [
        { id: 'BUILD' },
        { id: 'SERVE', dir: 'LR' },
    ],
    nodes: [
        { id: 'PICK', kind: 'ui', group: 'BUILD', icon: 'icon-list', refs: ['frontend/src/features/repo/repo.ts › initRepo', 'frontend/src/features/repo/repo.ts › loadProfilesForExport', 'frontend/src/features/repo/repo.ts › loadModpacksForExport'] },
        { id: 'EXPORT', kind: 'rust', group: 'BUILD', icon: 'icon-export', refs: ['src-tauri/src/commands/repo.rs › export_server_repo', 'src-tauri/src/commands/zipping.rs'] },
        { id: 'MANIFEST', kind: 'rust', group: 'BUILD', icon: 'icon-file', refs: ['frontend/src/features/repo/manifest-only.ts › initManifestOnly', 'src-tauri/src/commands/repo.rs › generate_repo_manifest'] },
        { id: 'REFRESH', kind: 'rust', group: 'BUILD', icon: 'icon-refresh', refs: ['frontend/src/features/repo/remote-refresh.ts › initRemoteRefresh', 'src-tauri/src/commands/repo_autoindex.rs › plan_remote_repo_refresh', 'src-tauri/src/commands/repo_autoindex.rs › refresh_repo_from_server'] },
        { id: 'SIGN', kind: 'rust', group: 'BUILD', icon: 'icon-key', refs: ['src-tauri/src/commands/security.rs › sign_message', 'src-tauri/src/commands/security.rs › load_or_generate_keys'] },
        { id: 'FOLDER', kind: 'data', group: 'BUILD', icon: 'icon-folder', refs: ['src-tauri/src/models/repo.rs › ServerRepo', 'src-tauri/src/commands/repo.rs › CHUNK_SIZE'] },

        { id: 'ACCESS', kind: 'ui', icon: 'icon-lock', refs: ['frontend/src/features/repo/repo-server.ts › initRepoServer', 'src-tauri/src/commands/repo_server.rs › set_repo_require_login', 'src-tauri/src/commands/repo.rs › write_access_starter'] },

        { id: 'BUILTIN', kind: 'rust', group: 'SERVE', icon: 'icon-server', link: 'server-mode', refs: ['src-tauri/src/commands/repo_server.rs › start_repo_server', 'src-tauri/src/commands/repo_server.rs › get_cloudflared_path', 'src-tauri/src/commands/repo_server.rs › get_repo_server_status'] },
        { id: 'STANDALONE', kind: 'rust', group: 'SERVE', icon: 'icon-terminal', link: 'docker-deployment', refs: ['src-tauri/src/commands/repo.rs › generate_standalone_server', 'src-tauri/src/commands/repo.rs › generate_mini_server_files'] },
        { id: 'HUB', kind: 'rust', group: 'SERVE', icon: 'icon-grid', refs: ['src-tauri/src/commands/repo.rs › generate_repo_hub', 'src-tauri/src/commands/repo.rs › scan_repo_hub'] },
        { id: 'SSH', kind: 'rust', group: 'SERVE', icon: 'icon-network', refs: ['frontend/src/features/repo/repo-ssh.ts › publishStoredTarget', 'src-tauri/src/commands/repo_ssh.rs › ssh_upload_repo'] },

        { id: 'LINK', kind: 'outcome', icon: 'icon-share', link: 'server-mode', refs: ['frontend/src/features/repo/repo-server.ts › initRepoServer', 'frontend/src/features/repo/repo.ts › copyToClipboard'] },
    ],
    edges: [
        { from: 'PICK', to: 'EXPORT', label: 'full', thick: true },
        { from: 'PICK', to: 'MANIFEST', label: 'manifestOnly' },
        { from: 'PICK', to: 'REFRESH', label: 'fromServer' },
        { from: 'EXPORT', to: 'SIGN', thick: true },
        { from: 'MANIFEST', to: 'SIGN' },
        { from: 'REFRESH', to: 'SIGN' },
        { from: 'SIGN', to: 'FOLDER', label: '~writes', thick: true },

        { from: 'FOLDER', to: 'BUILTIN', thick: true },
        { from: 'FOLDER', to: 'STANDALONE' },
        { from: 'FOLDER', to: 'HUB' },
        { from: 'FOLDER', to: 'SSH' },
        { from: 'ACCESS', to: 'BUILTIN', label: 'rules', tone: 'info', dashed: true },
        { from: 'ACCESS', to: 'STANDALONE', label: 'rules', tone: 'info', dashed: true },

        { from: 'BUILTIN', to: 'LINK', thick: true },
        { from: 'STANDALONE', to: 'LINK' },
        { from: 'HUB', to: 'LINK' },
        { from: 'SSH', to: 'LINK' },
    ],
};
