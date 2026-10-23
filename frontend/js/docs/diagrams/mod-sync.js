// Keeping the library in step with the mods folder, as it runs today: scan_mods_folder prunes
// entries whose folder is gone (only when the drive that holds them is reachable) and adds
// top-level folders and archives it does not know; ensure_cache_populated rebuilds the per-mod
// file lists and the file -> mods index lazily, reusing a list when the folder's mtime is
// unchanged; hashing is left to the throttled background queue (mods.rs).
// This is NOT repo sync (hosting-flow covers that).
export const modSync = {
    id: 'mod-sync',
    i18n: 'docs.diagram.mod-sync',
    category: 'mods',
    dir: 'TB',
    article: 'mod-sync',
    related: ['mod-import', 'mtime-cache', 'conflict-management', 'faq-deleted-mod'],
    groups: [
        { id: 'SCAN' },
        { id: 'INDEX' },
        { id: 'HASH', dir: 'LR' },
    ],
    nodes: [
        { id: 'TRIGGER', kind: 'ui', group: 'SCAN', icon: 'icon-refresh', refs: ['frontend/src/features/mods/mods-actions.ts › scanModsFolder', 'frontend/src/features/mods/mods.ts › refreshMods', 'frontend/src/features/settings/scheduler.ts'] },
        { id: 'GONE', kind: 'decision', group: 'SCAN', refs: ['src-tauri/src/commands/mods.rs › scan_mods_folder'] },
        { id: 'KEEP', kind: 'outcome', group: 'SCAN', icon: 'icon-drive', refs: ['src-tauri/src/commands/mods.rs › scan_mods_folder'] },
        { id: 'PRUNE', kind: 'rust', group: 'SCAN', icon: 'icon-trash', link: 'faq-deleted-mod', refs: ['src-tauri/src/commands/mods.rs › scan_mods_folder'] },
        { id: 'WALK', kind: 'rust', group: 'SCAN', icon: 'icon-search', refs: ['src-tauri/src/commands/mods.rs › scan_mods_folder', 'src-tauri/src/archive.rs › is_archive'] },
        { id: 'NEW', kind: 'rust', group: 'SCAN', icon: 'icon-add', refs: ['src-tauri/src/models/mod_entry.rs › ModEntry', 'src-tauri/src/models/mod_entry.rs › derive_content_id'] },
        { id: 'DATA', kind: 'data', group: 'SCAN', icon: 'icon-database', refs: ['src-tauri/src/state.rs › save', 'src-tauri/src/commands/mods.rs › invalidate_cache'] },
        { id: 'POPULATE', kind: 'rust', group: 'INDEX', icon: 'icon-layers', refs: ['src-tauri/src/commands/mods.rs › ensure_cache_populated', 'src-tauri/src/commands/mods.rs › get_mods'] },
        { id: 'MTIME', kind: 'decision', group: 'INDEX', link: 'mtime-cache', refs: ['src-tauri/src/commands/mods.rs › ensure_cache_populated', 'src-tauri/src/models/mod_entry.rs › last_scan_mtime'] },
        { id: 'LIST', kind: 'rust', group: 'INDEX', icon: 'icon-list', refs: ['src-tauri/src/fs_utils.rs › list_mod_files', 'src-tauri/src/archive.rs › archive_entries'] },
        { id: 'CACHE', kind: 'data', group: 'INDEX', icon: 'icon-grid', link: 'conflict-management', refs: ['src-tauri/src/state.rs › mod_files_cache', 'src-tauri/src/state.rs › conflict_index'] },
        { id: 'QUEUE', kind: 'data', group: 'HASH', icon: 'icon-list', refs: ['src-tauri/src/state.rs › sha_queue', 'src-tauri/src/commands/mods.rs › populate_sha_queue', 'src-tauri/src/commands/mods.rs › trigger_sha_background_population'] },
        { id: 'WORKER', kind: 'rust', group: 'HASH', icon: 'icon-integrity', link: 'blake3-hashing', refs: ['src-tauri/src/commands/mods.rs › start_sha_calculation_background', 'src-tauri/src/commands/mods.rs › process_single_mod_hashing'] },
    ],
    edges: [
        { from: 'TRIGGER', to: 'GONE', label: 'eachEntry', thick: true },
        { from: 'GONE', to: 'KEEP', label: 'driveOffline', tone: 'info' },
        { from: 'GONE', to: 'PRUNE', label: 'folderGone', tone: 'danger' },
        { from: 'GONE', to: 'WALK', label: 'stillThere', tone: 'ok', thick: true },
        { from: 'PRUNE', to: 'WALK' },
        { from: 'WALK', to: 'NEW', label: 'unknownPath', tone: 'ok', thick: true },
        { from: 'NEW', to: 'DATA', label: '~writes', thick: true },
        { from: 'PRUNE', to: 'DATA', label: '~writes' },
        { from: 'DATA', to: 'POPULATE', label: 'nextRead', dashed: true },
        { from: 'POPULATE', to: 'MTIME', label: 'eachMod', tone: 'info' },
        { from: 'MTIME', to: 'CACHE', label: 'unchanged', tone: 'ok' },
        { from: 'MTIME', to: 'LIST', label: 'changed', tone: 'warn' },
        { from: 'LIST', to: 'CACHE' },
        { from: 'LIST', to: 'QUEUE', label: 'rehash', dashed: true },
        { from: 'TRIGGER', to: 'QUEUE', label: 'modsAdded', dashed: true },
        { from: 'QUEUE', to: 'WORKER' },
        { from: 'WORKER', to: 'DATA', label: 'hashes', dashed: true },
    ],
};
//# sourceMappingURL=mod-sync.js.map