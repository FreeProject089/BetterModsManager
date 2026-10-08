import type { DiagramSpec } from '../diagram-spec.js';

// How a download avoids starting over. In a repo sync (repo.rs sync_server_repo) a file that is
// already on disk is compared by SHA-256, then chunk by chunk (4 MB), and only the chunks that
// differ are fetched with HTTP Range; everything else streams under the 4 GiB DownloadCap and
// the governor's Download budget, and is hashed again before it counts. The Laya offline pack
// (ai_embedded.rs fetch_pack) is the one download that resumes a .part file from its length.
export const resumableDownloads: DiagramSpec = {
    id: 'resumable-downloads',
    i18n: 'docs.diagram.resumable-downloads',
    category: 'sharing',
    dir: 'TB',
    article: 'resumable-downloads',
    related: ['server-mode', 'hosting-flow', 'disk-io-limiter'],
    groups: [
        { id: 'DECIDE' },
        { id: 'TRANSFER' },
        { id: 'CHECK', dir: 'LR' },
        { id: 'PACK' },
    ],
    nodes: [
        { id: 'FILE', kind: 'outcome', group: 'DECIDE', icon: 'icon-file', refs: ['src-tauri/src/commands/repo.rs › sync_server_repo', 'src-tauri/src/models/repo.rs › RepoChunk'] },
        { id: 'SAME', kind: 'decision', group: 'DECIDE', refs: ['src-tauri/src/commands/repo.rs › compute_file_hash_and_chunks'] },
        { id: 'CHUNKS', kind: 'decision', group: 'DECIDE', refs: ['src-tauri/src/commands/repo.rs › compute_local_chunk_hashes', 'src-tauri/src/commands/repo.rs › CHUNK_SIZE'] },

        { id: 'RANGE', kind: 'rust', group: 'TRANSFER', icon: 'icon-patch', refs: ['src-tauri/src/commands/repo.rs › sync_server_repo', 'src-tauri/src/commands/repo.rs › mod_file_url'] },
        { id: 'FULL', kind: 'rust', group: 'TRANSFER', icon: 'icon-download', refs: ['src-tauri/src/commands/repo.rs › sync_server_repo', 'src-tauri/src/commands/repo_ssh.rs › open_for_sync'] },
        { id: 'CAP', kind: 'rust', group: 'TRANSFER', icon: 'icon-meter', link: 'disk-io-limiter', refs: ['src-tauri/src/fs_utils.rs › DownloadCap', 'src-tauri/src/fs_utils.rs › MAX_DOWNLOAD_BYTES', 'src-tauri/src/governor/runtime.rs › limiter'] },
        { id: 'PAUSE', kind: 'ui', group: 'TRANSFER', icon: 'icon-stop', refs: ['src-tauri/src/commands/repo.rs › pause_repo_sync', 'src-tauri/src/commands/repo.rs › cancel_repo_sync', 'src-tauri/src/commands/repo.rs › sync_wait'] },

        { id: 'VERIFY', kind: 'decision', group: 'CHECK', icon: 'icon-integrity', refs: ['src-tauri/src/commands/repo.rs › compute_file_hash_and_chunks', 'src-tauri/src/models/mod_entry.rs › unverified'] },
        { id: 'DONE', kind: 'outcome', group: 'CHECK', icon: 'icon-check', refs: ['src-tauri/src/commands/repo.rs › ProfileSyncSummary'] },
        { id: 'FAIL', kind: 'outcome', group: 'CHECK', icon: 'icon-alert', refs: ['src-tauri/src/commands/repo.rs › sync_server_repo'] },

        { id: 'PART', kind: 'rust', group: 'PACK', icon: 'icon-brain', refs: ['src-tauri/src/commands/ai_embedded.rs › fetch_pack', 'src-tauri/src/commands/ai_embedded.rs › hash_prefix'] },
    ],
    edges: [
        { from: 'FILE', to: 'SAME', thick: true },
        { from: 'SAME', to: 'DONE', label: 'skip', tone: 'ok' },
        { from: 'SAME', to: 'CHUNKS', label: '~no', tone: 'warn', thick: true },
        { from: 'CHUNKS', to: 'RANGE', label: '~yes', tone: 'ok', thick: true },
        { from: 'CHUNKS', to: 'FULL', label: '~no', tone: 'warn' },
        { from: 'RANGE', to: 'CAP' , thick: true },
        { from: 'FULL', to: 'CAP' },
        { from: 'PAUSE', to: 'CAP', label: 'between', tone: 'info', dashed: true },
        { from: 'CAP', to: 'VERIFY', thick: true },
        { from: 'CAP', to: 'FAIL', label: 'tooLarge', tone: 'danger' },
        { from: 'VERIFY', to: 'DONE', label: '~ok', tone: 'ok', thick: true },
        { from: 'VERIFY', to: 'FAIL', label: '~fail', tone: 'danger' },
        { from: 'PART', to: 'VERIFY', label: 'sameRule', tone: 'info', dashed: true },
    ],
};
