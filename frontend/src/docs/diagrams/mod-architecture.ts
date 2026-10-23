import type { DiagramSpec } from '../diagram-spec.js';

// The mod data model: what a mod IS on disk (a folder mirroring the game tree, or an archive kept
// zipped and read through an extraction cache, archive.rs), what BMM records about it
// (ModEntry in data.json, Profile.active_mods as the order), and the in-memory views every
// feature reads instead of the disk (state.rs). How files move on enable/disable is
// mod-activation; this is the shape of the data those moves read and write.
export const modArchitecture: DiagramSpec = {
    id: 'mod-architecture',
    i18n: 'docs.diagram.mod-architecture',
    category: 'mods',
    dir: 'LR',
    article: 'mod-architecture',
    related: ['mod-activation', 'profile-system', 'mod-sync', 'integrity-engine'],
    groups: [
        { id: 'DISK', dir: 'TB' },
        { id: 'RECORD', dir: 'TB' },
        { id: 'MEMORY', dir: 'TB' },
        { id: 'GAME', dir: 'TB' },
    ],
    nodes: [
        { id: 'FOLDER', kind: 'data', group: 'DISK', icon: 'icon-folder', link: 'mod-mapper', refs: ['src-tauri/src/fs_utils.rs › list_mod_files'] },
        { id: 'ARCHIVE', kind: 'data', group: 'DISK', icon: 'icon-archive', refs: ['src-tauri/src/archive.rs › is_archive', 'src-tauri/src/archive.rs › archive_entries'] },
        { id: 'XCACHE', kind: 'data', group: 'DISK', icon: 'icon-box', refs: ['src-tauri/src/archive.rs › materialize', 'src-tauri/src/archive.rs › cache_dir_for', 'src-tauri/src/archive.rs › MAX_EXTRACT_TOTAL'] },
        { id: 'READ_ROOT', kind: 'rust', group: 'DISK', icon: 'icon-flow', refs: ['src-tauri/src/archive.rs › mod_read_root'] },

        { id: 'ENTRY', kind: 'data', group: 'RECORD', icon: 'icon-database', refs: ['src-tauri/src/models/mod_entry.rs › ModEntry', 'src-tauri/src/state.rs › save'] },
        { id: 'IDENTITY', kind: 'rust', group: 'RECORD', icon: 'icon-key', refs: ['src-tauri/src/models/mod_entry.rs › derive_content_id', 'src-tauri/src/models/mod_entry.rs › repo_mod_id'] },
        { id: 'HASHES', kind: 'data', group: 'RECORD', icon: 'icon-integrity', link: 'integrity-engine', refs: ['src-tauri/src/models/mod_entry.rs › file_hashes', 'src-tauri/src/fs_utils.rs › file_matches_hash'] },
        { id: 'PROFILE', kind: 'data', group: 'RECORD', icon: 'icon-user', link: 'profile-system', refs: ['src-tauri/src/models/profile.rs › Profile', 'src-tauri/src/models/profile.rs › active_mods'] },

        { id: 'FILES', kind: 'data', group: 'MEMORY', icon: 'icon-grid', link: 'mod-sync', refs: ['src-tauri/src/state.rs › mod_files_cache', 'src-tauri/src/state.rs › conflict_index', 'src-tauri/src/commands/mods.rs › ensure_cache_populated'] },
        { id: 'WIRE', kind: 'rust', group: 'MEMORY', icon: 'icon-list', refs: ['src-tauri/src/commands/mods.rs › get_mods', 'src-tauri/src/commands/mods.rs › get_mod_hashes'] },

        { id: 'INSTALLED', kind: 'ext', group: 'GAME', icon: 'icon-app', link: 'mod-activation', refs: ['src-tauri/src/models/mod_entry.rs › installed_files', 'src-tauri/src/commands/mods.rs › enable_mod'] },
        { id: 'BACKUP', kind: 'data', group: 'GAME', icon: 'icon-restore', link: 'backup-system', refs: ['src-tauri/src/fs_utils.rs › backup_original_file', 'src-tauri/src/models/profile.rs › backup_path'] },
    ],
    edges: [
        { from: 'ARCHIVE', to: 'XCACHE', label: 'extractOnRead', dashed: true },
        { from: 'FOLDER', to: 'READ_ROOT' },
        { from: 'XCACHE', to: 'READ_ROOT' },
        { from: 'FOLDER', to: 'ENTRY', label: 'pathIn', thick: true },
        { from: 'ARCHIVE', to: 'ENTRY', label: 'pathIn' },
        { from: 'ENTRY', to: 'IDENTITY' },
        { from: 'ENTRY', to: 'HASHES' },
        { from: 'PROFILE', to: 'ENTRY', label: 'ownsByPath', tone: 'info', thick: true },
        { from: 'ENTRY', to: 'FILES', label: 'fileLists', thick: true },
        { from: 'ENTRY', to: 'WIRE', label: 'slimCopy', dashed: true },
        { from: 'PROFILE', to: 'WIRE', label: 'orderAndState' },
        { from: 'READ_ROOT', to: 'INSTALLED', label: 'enable', tone: 'ok', thick: true },
        { from: 'INSTALLED', to: 'ENTRY', label: 'tracked', dashed: true },
        { from: 'INSTALLED', to: 'BACKUP', label: 'replacedOriginal', tone: 'warn' },
    ],
};
