// Adding one mod by hand, as it runs today: the Add a mod dialog (picked or dropped folder or
// archive) calls add_mod, which copies the source into the active profile's mods folder under an
// Install ticket. An archive is stored as-is (archive.rs extracts it only when it is read), a
// folder has its content copied. The new entry lands in data.json disabled; its BLAKE3 baseline
// comes later from the background hash queue (mods.rs populate_sha_queue).
export const modImport = {
    id: 'mod-import',
    i18n: 'docs.diagram.mod-import',
    category: 'mods',
    dir: 'TB',
    article: 'scan',
    related: ['mod-sync', 'one-click-install', 'mod-activation', 'mod-architecture'],
    groups: [
        { id: 'IN', dir: 'LR' },
        { id: 'COPY' },
        { id: 'AFTER' },
    ],
    nodes: [
        { id: 'DIALOG', kind: 'ui', group: 'IN', icon: 'icon-add', refs: ['frontend/src/features/mods/mods-actions.ts › openAddModModal', 'frontend/src/features/mods/mods-actions.ts › confirmAddMod'] },
        { id: 'DROP', kind: 'ui', group: 'IN', icon: 'icon-import', refs: ['frontend/src/core/api.ts › listenFileDrop', 'frontend/src/features/mods/mods.ts › initMods'] },
        { id: 'OTHER', kind: 'outcome', group: 'IN', icon: 'icon-download', link: 'one-click-install', refs: ['src-tauri/src/commands/mods.rs › download_mod', 'src-tauri/src/commands/mods.rs › install_from_modlist', 'src-tauri/src/commands/mods.rs › scan_mods_folder'] },
        { id: 'ADD', kind: 'rust', group: 'COPY', icon: 'icon-plus', refs: ['src-tauri/src/commands/mods.rs › add_mod'] },
        { id: 'KIND', kind: 'decision', group: 'COPY', refs: ['src-tauri/src/archive.rs › is_archive'] },
        { id: 'KEEP_ZIP', kind: 'rust', group: 'COPY', icon: 'icon-archive', refs: ['src-tauri/src/commands/mods.rs › add_mod', 'src-tauri/src/fs_utils.rs › copy_file_install'] },
        { id: 'COPY_DIR', kind: 'rust', group: 'COPY', icon: 'icon-folder', refs: ['src-tauri/src/commands/mods.rs › get_unique_mod_info', 'src-tauri/src/fs_utils.rs › copy_dir_governed'] },
        { id: 'TICKET', kind: 'rust', group: 'COPY', icon: 'icon-stop', refs: ['src-tauri/src/commands/mods.rs › install_mod_source'] },
        { id: 'ENTRY', kind: 'data', group: 'AFTER', icon: 'icon-database', refs: ['src-tauri/src/models/mod_entry.rs › ModEntry', 'src-tauri/src/models/mod_entry.rs › derive_content_id', 'src-tauri/src/commands/mods.rs › invalidate_cache'] },
        { id: 'HASH', kind: 'rust', group: 'AFTER', icon: 'icon-integrity', refs: ['src-tauri/src/commands/mods.rs › populate_sha_queue', 'src-tauri/src/commands/mods.rs › process_single_mod_hashing'] },
        { id: 'LISTED', kind: 'outcome', group: 'AFTER', icon: 'icon-check', link: 'mod-activation', refs: ['frontend/src/features/mods/mods.ts › refreshMods', 'frontend/src/features/mods/mods-conflicts.ts › checkAllConflicts'] },
    ],
    edges: [
        { from: 'DROP', to: 'DIALOG', label: 'prefill', tone: 'info' },
        { from: 'DIALOG', to: 'ADD', label: '~invoke', thick: true },
        { from: 'ADD', to: 'KIND', thick: true },
        { from: 'KIND', to: 'KEEP_ZIP', label: 'archive', tone: 'info' },
        { from: 'KIND', to: 'COPY_DIR', label: 'folder', tone: 'info' },
        { from: 'KEEP_ZIP', to: 'TICKET' },
        { from: 'COPY_DIR', to: 'TICKET' },
        { from: 'TICKET', to: 'ENTRY', label: '~ok', tone: 'ok', thick: true },
        { from: 'TICKET', to: 'DIALOG', label: '~cancel', tone: 'danger', dashed: true },
        { from: 'ENTRY', to: 'LISTED', thick: true },
        { from: 'ENTRY', to: 'HASH', label: '~later', dashed: true },
        { from: 'OTHER', to: 'ENTRY', label: 'sameRecord', dashed: true },
    ],
};
//# sourceMappingURL=mod-import.js.map