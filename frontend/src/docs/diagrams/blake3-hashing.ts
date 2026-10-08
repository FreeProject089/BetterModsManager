import type { DiagramSpec } from '../diagram-spec.js';

// Which hash BMM computes where, from fs_utils.rs: local content hashes are BLAKE3 (tagged `b3:`),
// one file per thread on the governor's Hash pool; a stored hash is checked with the algorithm it
// names (file_matches_hash), so legacy SHA-256 baselines still verify. SHA-256 stays on purpose
// for the content_id identity (models/mod_entry.rs), the repo wire format (commands/repo.rs) and
// the signed update manifest (commands/autoupdate.rs).
export const blake3Hashing: DiagramSpec = {
    id: 'blake3-hashing',
    i18n: 'docs.diagram.blake3-hashing',
    category: 'integrity',
    dir: 'TB',
    article: 'blake3-hashing',
    related: ['integrity-engine', 'mtime-cache', 'disk-io-limiter', 'modpack-flow'],
    groups: [
        { id: 'ENGINE', dir: 'LR' },
        { id: 'LOCAL', dir: 'LR' },
        { id: 'WIRE', dir: 'LR' },
    ],
    nodes: [
        { id: 'FILES', kind: 'data', icon: 'icon-folder', refs: ['src-tauri/src/archive.rs › mod_read_root', 'src-tauri/src/fs_utils.rs › list_mod_files'] },

        { id: 'POOL', kind: 'rust', group: 'ENGINE', icon: 'icon-cpu', refs: ['src-tauri/src/fs_utils.rs › hash_bulk_in', 'src-tauri/src/fs_utils.rs › compute_file_hash_bulk_ticketed'] },
        { id: 'HASH', kind: 'rust', group: 'ENGINE', icon: 'icon-key', refs: ['src-tauri/src/fs_utils.rs › compute_file_hash'] },
        { id: 'MATCH', kind: 'decision', group: 'ENGINE', refs: ['src-tauri/src/fs_utils.rs › file_matches_hash'] },
        { id: 'SHA', kind: 'rust', group: 'ENGINE', icon: 'icon-key', refs: ['src-tauri/src/fs_utils.rs › compute_file_sha256'] },

        { id: 'BASELINE', kind: 'data', group: 'LOCAL', icon: 'icon-integrity', link: 'integrity-engine', refs: ['src-tauri/src/commands/mods.rs › process_single_mod_hashing', 'src-tauri/src/commands/mods.rs › get_mod_integrity'] },
        { id: 'MODPACK', kind: 'rust', group: 'LOCAL', icon: 'icon-package', link: 'modpack-flow', refs: ['src-tauri/src/commands/modpack.rs › find_file_by_hash_in_dir', 'src-tauri/src/models/modpack.rs › ModpackFileRef'] },
        { id: 'HASHFILE', kind: 'rust', group: 'LOCAL', icon: 'icon-verify', refs: ['src-tauri/src/commands/verify.rs › hash_file'] },

        { id: 'CONTENT_ID', kind: 'rust', group: 'WIRE', icon: 'icon-link', refs: ['src-tauri/src/models/mod_entry.rs › derive_content_id', 'src-tauri/src/models/mod_entry.rs › update_content_id_from_hashes'] },
        { id: 'REPO', kind: 'rust', group: 'WIRE', icon: 'icon-server', refs: ['src-tauri/src/commands/repo.rs › compute_file_hash_and_chunks', 'src-tauri/src/commands/repo.rs › CHUNK_SIZE'] },
        { id: 'UPDATE', kind: 'rust', group: 'WIRE', icon: 'icon-download', refs: ['src-tauri/src/commands/autoupdate.rs › check_installer_bytes', 'src-tauri/src/commands/autoupdate.rs › apply_incremental_update'] },
    ],
    edges: [
        { from: 'FILES', to: 'POOL', thick: true },
        { from: 'POOL', to: 'HASH', label: '~perFile', tone: 'info', thick: true },
        { from: 'HASH', to: 'BASELINE', label: 'b3', tone: 'ok', thick: true },
        { from: 'HASH', to: 'MODPACK', label: 'b3', tone: 'ok' },
        { from: 'HASH', to: 'HASHFILE', label: 'b3', tone: 'ok', dashed: true },
        { from: 'BASELINE', to: 'MATCH', label: 'check' },
        { from: 'MODPACK', to: 'MATCH', label: 'check' },
        { from: 'MATCH', to: 'HASH', label: 'tagged', tone: 'ok' },
        { from: 'MATCH', to: 'SHA', label: 'untagged', tone: 'warn' },
        { from: 'FILES', to: 'CONTENT_ID', label: 'pathSize', tone: 'info', dashed: true },
        { from: 'SHA', to: 'CONTENT_ID', dashed: true },
        { from: 'SHA', to: 'REPO', dashed: true },
        { from: 'SHA', to: 'UPDATE', dashed: true },
    ],
};
