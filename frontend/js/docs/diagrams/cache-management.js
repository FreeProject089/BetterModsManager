// What BMM caches about the mods, and when each cache is rebuilt or dropped (commands/mods.rs
// ensure_cache_populated / invalidate_cache / flush_mem_caches, archive.rs materialize, the
// background hasher). Two in-memory structures (the per-mod file sets and the file → mods
// conflict index) are rebuilt lazily from the per-mod file list stored in data.json; archived
// mods are listed from the archive index and only extracted, to %TEMP%, when their files are
// needed. The mtime rule itself is drawn in mtime-cache.
export const cacheManagement = {
    id: 'cache-management',
    i18n: 'docs.diagram.cache-management',
    category: 'profiles',
    dir: 'TB',
    article: 'mtime-cache',
    related: ['mtime-cache', 'mod-activation', 'faq-disk-full', 'disk-io-limiter'],
    groups: [
        { id: 'MEM' },
        { id: 'BUILD' },
        { id: 'DISK', dir: 'LR' },
    ],
    nodes: [
        { id: 'REQUEST', kind: 'ui', group: 'MEM', icon: 'icon-list', refs: ['src-tauri/src/commands/mods.rs › get_mods', 'src-tauri/src/commands/mods.rs › enable_mod_in'] },
        { id: 'FRESH', kind: 'decision', group: 'MEM', refs: ['src-tauri/src/commands/mods.rs › ensure_cache_populated', 'src-tauri/src/state.rs › last_cache_update'] },
        { id: 'INDEX', kind: 'data', group: 'MEM', icon: 'icon-grid', refs: ['src-tauri/src/state.rs › mod_files_cache', 'src-tauri/src/state.rs › conflict_index', 'src-tauri/src/commands/mods.rs › calculate_conflicts_from_cache'] },
        { id: 'INVALIDATE', kind: 'rust', group: 'MEM', icon: 'icon-refresh', refs: ['src-tauri/src/commands/mods.rs › invalidate_cache', 'src-tauri/src/commands/profile.rs › update_profile'] },
        { id: 'FLUSH', kind: 'front', group: 'MEM', icon: 'icon-trash', refs: ['frontend/src/core/state.ts › flushMemory', 'frontend/src/ui/app.ts', 'src-tauri/src/commands/mods.rs › flush_mem_caches'] },
        { id: 'PER_MOD', kind: 'decision', group: 'BUILD', refs: ['src-tauri/src/commands/mods.rs › ensure_cache_populated'], link: 'mtime-cache' },
        { id: 'ARCHIVE_LIST', kind: 'rust', group: 'BUILD', icon: 'icon-archive', refs: ['src-tauri/src/archive.rs › archive_entries', 'src-tauri/src/archive.rs › is_archive'] },
        { id: 'WALK', kind: 'rust', group: 'BUILD', icon: 'icon-search', refs: ['src-tauri/src/fs_utils.rs › list_mod_files'] },
        { id: 'HASH_QUEUE', kind: 'rust', group: 'BUILD', icon: 'icon-integrity', refs: ['src-tauri/src/commands/mods.rs › start_sha_calculation_background', 'src-tauri/src/commands/mods.rs › populate_sha_queue'], link: 'integrity-engine' },
        { id: 'CACHED_FILES', kind: 'data', group: 'DISK', icon: 'icon-database', refs: ['src-tauri/src/models/mod_entry.rs › cached_files', 'src-tauri/src/models/mod_entry.rs › last_scan_mtime'] },
        { id: 'EXTRACTED', kind: 'data', group: 'DISK', icon: 'icon-folder', refs: ['src-tauri/src/archive.rs › materialize', 'src-tauri/src/archive.rs › cache_dir_for', 'src-tauri/src/archive.rs › mod_read_root'] },
    ],
    edges: [
        { from: 'REQUEST', to: 'FRESH', thick: true },
        { from: 'FRESH', to: 'INDEX', label: 'built', tone: 'ok', thick: true },
        { from: 'FRESH', to: 'PER_MOD', label: 'rebuild', tone: 'warn' },
        { from: 'INVALIDATE', to: 'FRESH', label: 'reset', tone: 'warn', dashed: true },
        { from: 'FLUSH', to: 'INDEX', label: 'empties', tone: 'danger', dashed: true },
        { from: 'PER_MOD', to: 'CACHED_FILES', label: 'unchanged', tone: 'ok' },
        { from: 'PER_MOD', to: 'ARCHIVE_LIST', label: 'archive', tone: 'info' },
        { from: 'PER_MOD', to: 'WALK', label: 'changed', tone: 'warn' },
        { from: 'WALK', to: 'CACHED_FILES', label: '~writes' },
        { from: 'ARCHIVE_LIST', to: 'CACHED_FILES', label: '~writes' },
        { from: 'WALK', to: 'HASH_QUEUE', label: 'reHash', dashed: true },
        { from: 'CACHED_FILES', to: 'INDEX', thick: true },
        { from: 'REQUEST', to: 'EXTRACTED', label: 'archivedFiles', tone: 'info', dashed: true },
    ],
};
//# sourceMappingURL=cache-management.js.map