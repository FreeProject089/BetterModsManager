import type { DiagramSpec } from '../diagram-spec.js';

// The mod file-list cache, from commands/mods.rs › ensure_cache_populated: each mod's file list is
// reused while its FOLDER's modification time is unchanged, and rebuilt otherwise. The lists feed
// the in-memory conflict index. A changed folder of a mod that already has hashes is queued for a
// background re-hash (the SHA worker of the integrity engine); the scan itself never hashes.
export const mtimeCache: DiagramSpec = {
    id: 'mtime-cache',
    i18n: 'docs.diagram.mtime-cache',
    category: 'integrity',
    dir: 'TB',
    article: 'mtime-cache',
    related: ['integrity-engine', 'conflict-management', 'blake3-hashing', 'mod-sync'],
    groups: [
        { id: 'ENTRY', dir: 'LR' },
        { id: 'PERMOD' },
        { id: 'RESULT', dir: 'LR' },
    ],
    nodes: [
        { id: 'CALLER', kind: 'rust', group: 'ENTRY', icon: 'icon-list', refs: ['src-tauri/src/commands/mods.rs › get_mods', 'src-tauri/src/commands/mods.rs › get_mod_conflicts', 'src-tauri/src/commands/mods.rs › enable_mod_in'] },
        { id: 'FRESH', kind: 'decision', group: 'ENTRY', refs: ['src-tauri/src/commands/mods.rs › ensure_cache_populated', 'src-tauri/src/state.rs › last_cache_update'] },
        { id: 'INVALIDATE', kind: 'rust', group: 'ENTRY', icon: 'icon-refresh', refs: ['src-tauri/src/commands/mods.rs › invalidate_cache', 'src-tauri/src/commands/mods.rs › flush_mem_caches'] },

        { id: 'MTIME', kind: 'rust', group: 'PERMOD', icon: 'icon-time', refs: ['src-tauri/src/commands/mods.rs › ensure_cache_populated', 'src-tauri/src/models/mod_entry.rs › last_scan_mtime'] },
        { id: 'SAME', kind: 'decision', group: 'PERMOD', refs: ['src-tauri/src/models/mod_entry.rs › cached_files', 'src-tauri/src/models/mod_entry.rs › last_scan_mtime'] },
        { id: 'REUSE', kind: 'rust', group: 'PERMOD', icon: 'icon-bolt', refs: ['src-tauri/src/models/mod_entry.rs › cached_files'] },
        { id: 'REACHABLE', kind: 'decision', group: 'PERMOD', refs: ['src-tauri/src/commands/mods.rs › ensure_cache_populated'] },
        { id: 'RELIST', kind: 'rust', group: 'PERMOD', icon: 'icon-search', refs: ['src-tauri/src/fs_utils.rs › list_mod_files', 'src-tauri/src/archive.rs › archive_entries'] },
        { id: 'REHASH', kind: 'rust', group: 'PERMOD', icon: 'icon-sync', link: 'integrity-engine', refs: ['src-tauri/src/state.rs › sha_queue', 'src-tauri/src/commands/mods.rs › process_single_mod_hashing'] },

        { id: 'INDEX', kind: 'data', group: 'RESULT', icon: 'icon-database', refs: ['src-tauri/src/state.rs › mod_files_cache', 'src-tauri/src/state.rs › conflict_index'] },
        { id: 'SAVE', kind: 'data', group: 'RESULT', icon: 'icon-save', refs: ['src-tauri/src/state.rs › save', 'src-tauri/src/models/mod_entry.rs › last_scan_mtime'] },
        { id: 'CONFLICTS', kind: 'outcome', group: 'RESULT', icon: 'icon-compare', link: 'conflict-management', refs: ['src-tauri/src/commands/mods.rs › calculate_conflicts_from_cache'] },
    ],
    edges: [
        { from: 'CALLER', to: 'FRESH', thick: true },
        { from: 'INVALIDATE', to: 'FRESH', label: 'reset', tone: 'warn', dashed: true },
        { from: 'FRESH', to: 'INDEX', label: '~yes', tone: 'ok' },
        { from: 'FRESH', to: 'MTIME', label: 'eachMod', tone: 'info', thick: true },

        { from: 'MTIME', to: 'SAME', thick: true },
        { from: 'SAME', to: 'REUSE', label: '~yes', tone: 'ok', thick: true },
        { from: 'SAME', to: 'REACHABLE', label: '~no', tone: 'warn' },
        { from: 'REACHABLE', to: 'REUSE', label: 'unplugged', tone: 'warn', dashed: true },
        { from: 'REACHABLE', to: 'RELIST', label: '~yes', tone: 'info' },
        { from: 'RELIST', to: 'REHASH', label: 'hashed', tone: 'warn', dashed: true },
        { from: 'RELIST', to: 'SAVE', label: '~writes' },

        { from: 'REUSE', to: 'INDEX', thick: true },
        { from: 'RELIST', to: 'INDEX' },
        { from: 'INDEX', to: 'CONFLICTS', thick: true },
    ],
};
