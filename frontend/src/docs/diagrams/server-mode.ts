import type { DiagramSpec } from '../diagram-spec.js';

// Subscribing to a hosted repo and syncing it, both sides of the wire: the repo server's access
// gate (built-in server: repo_server.rs start_repo_server; standalone ones: access-gate.js),
// then the client's sync_server_repo (repo.rs), which refuses a bad signature or an unsafe
// manifest path BEFORE it writes anything, skips files whose SHA-256 already matches, checks
// every downloaded file and records the repo on each mod for the update checker.
export const serverMode: DiagramSpec = {
    id: 'server-mode',
    i18n: 'docs.diagram.server-mode',
    category: 'sharing',
    dir: 'TB',
    article: 'server-sync',
    related: ['hosting-flow', 'resumable-downloads', 'security-system', 'update-system'],
    groups: [
        { id: 'SUB', dir: 'LR' },
        { id: 'HOST' },
        { id: 'SYNC' },
    ],
    nodes: [
        { id: 'FETCH', kind: 'ui', group: 'SUB', icon: 'icon-search', refs: ['frontend/src/features/repo/repo-sync.ts › fetchRepoInfoWithPassword', 'src-tauri/src/commands/repo.rs › fetch_repo_info', 'src-tauri/src/commands/security.rs › get_salted_creator_id'] },
        { id: 'SIGCARD', kind: 'ui', group: 'SUB', icon: 'icon-verify', refs: ['frontend/src/features/repo/repo-sync.ts › repoSignatureState', 'frontend/src/features/repo/repo-sync.ts › paintSignature', 'frontend/src/features/repo/repo-pin.ts › expectedRepoSignature'] },

        { id: 'GATE', kind: 'rust', group: 'HOST', icon: 'icon-shield', refs: ['src-tauri/src/commands/repo_server.rs › start_repo_server', 'src-tauri/src/commands/repo_keyauth.rs › verify_proof', 'src-tauri/src/templates/mini-server/access-gate.js.template'] },
        { id: 'DENIED', kind: 'outcome', group: 'HOST', icon: 'icon-lock', refs: ['src-tauri/src/commands/repo.rs › fetch_repo_info', 'frontend/src/features/repo/repo-sync.ts › promptRepoPassword', 'src-tauri/src/commands/ban_manager.rs › is_banned_with_identity'] },
        { id: 'MANIFEST', kind: 'data', group: 'HOST', icon: 'icon-file', refs: ['src-tauri/src/models/repo.rs › ServerRepo', 'src-tauri/src/commands/repo.rs › discovered_repo'] },

        { id: 'SIGGATE', kind: 'decision', group: 'SYNC', refs: ['src-tauri/src/commands/repo.rs › check_repo_signature', 'src-tauri/src/commands/repo.rs › first_unsafe_manifest_path', 'src-tauri/src/fs_utils.rs › safe_relative_path'] },
        { id: 'REFUSED', kind: 'outcome', group: 'SYNC', icon: 'icon-stop', refs: ['src-tauri/src/commands/repo.rs › RepoSignatureState'] },
        { id: 'SAME', kind: 'decision', group: 'SYNC', refs: ['src-tauri/src/commands/repo.rs › compute_file_hash_and_chunks'] },
        { id: 'DOWNLOAD', kind: 'rust', group: 'SYNC', icon: 'icon-download', link: 'resumable-downloads', refs: ['src-tauri/src/commands/repo.rs › sync_server_repo', 'src-tauri/src/commands/repo.rs › mod_file_url', 'src-tauri/src/commands/repo_ssh.rs › open_for_sync'] },
        { id: 'VERIFY', kind: 'decision', group: 'SYNC', icon: 'icon-integrity', refs: ['src-tauri/src/commands/repo.rs › sync_server_repo', 'src-tauri/src/models/mod_entry.rs › unverified'] },
        { id: 'STOPPED', kind: 'outcome', group: 'SYNC', icon: 'icon-alert', refs: ['src-tauri/src/commands/repo.rs › cancel_repo_sync', 'src-tauri/src/commands/repo.rs › sync_wait'] },
        { id: 'CLEAN', kind: 'rust', group: 'SYNC', icon: 'icon-trash', refs: ['src-tauri/src/fs_utils.rs › list_mod_files', 'src-tauri/src/fs_utils.rs › remove_empty_dirs', 'src-tauri/src/commands/repo.rs › repo_mod_folder_name'] },

        { id: 'SAVED', kind: 'outcome', icon: 'icon-check', refs: ['src-tauri/src/commands/repo.rs › push_repo_source', 'src-tauri/src/commands/repo.rs › SyncSummary', 'frontend/src/features/repo/repo-sync.ts › showSyncSummary'] },
    ],
    edges: [
        { from: 'FETCH', to: 'GATE', label: 'request', thick: true },
        { from: 'GATE', to: 'DENIED', label: '~refused', tone: 'danger' },
        { from: 'GATE', to: 'MANIFEST', label: '~ok', tone: 'ok', thick: true },
        { from: 'MANIFEST', to: 'SIGCARD', thick: true },
        { from: 'SIGCARD', to: 'SIGGATE', label: 'sync', thick: true },
        { from: 'SIGGATE', to: 'REFUSED', label: '~invalid', tone: 'danger' },
        { from: 'SIGGATE', to: 'SAME', label: 'allowed', tone: 'ok', thick: true },
        { from: 'SAME', to: 'CLEAN', label: 'skip', tone: 'ok' },
        { from: 'SAME', to: 'DOWNLOAD', label: '~no', tone: 'warn', thick: true },
        { from: 'DOWNLOAD', to: 'GATE', label: '~perFile', tone: 'info', dashed: true },
        { from: 'DOWNLOAD', to: 'VERIFY', thick: true },
        { from: 'VERIFY', to: 'STOPPED', label: '~fail', tone: 'danger' },
        { from: 'VERIFY', to: 'CLEAN', label: '~ok', tone: 'ok', thick: true },
        { from: 'CLEAN', to: 'SAVED', thick: true },
    ],
};
