// "I deleted a mod": what actually happens, from the code. Inside BMM, an enabled mod cannot be
// removed (remove_mod refuses). Deleted from Explorer while enabled, its entry survives until the
// next scan, and disable_mod still works from the recorded installed_files. A scan that finds the
// folder gone (drive reachable) drops the entry and its place in the active list, but leaves its
// deployed files and the _original/ backups where they are (mods.rs scan_mods_folder).
export const faqDeletedMod = {
    id: 'faq-deleted-mod',
    i18n: 'docs.diagram.faq-deleted-mod',
    category: 'mods',
    dir: 'TB',
    article: 'faq-deleted-mod',
    related: ['mod-sync', 'mod-activation', 'backup-system', 'integrity-engine'],
    groups: [
        { id: 'HOW' },
        { id: 'BEFORE' },
        { id: 'AFTER' },
    ],
    nodes: [
        { id: 'IN_APP', kind: 'ui', group: 'HOW', icon: 'icon-trash', refs: ['frontend/src/features/mods/mods-list.ts › performDeletion', 'src-tauri/src/commands/mods.rs › remove_mod'] },
        { id: 'SAFE', kind: 'outcome', group: 'HOW', icon: 'icon-check', refs: ['src-tauri/src/commands/mods.rs › remove_mod'] },
        { id: 'EXPLORER', kind: 'ext', group: 'HOW', icon: 'icon-folder', refs: ['src-tauri/src/models/mod_entry.rs › mod_folder_path'] },
        { id: 'SCANNED', kind: 'decision', group: 'BEFORE', link: 'mod-sync', refs: ['src-tauri/src/commands/mods.rs › scan_mods_folder', 'frontend/src/features/mods/mods.ts › refreshMods'] },
        { id: 'VERIFY', kind: 'ui', group: 'BEFORE', icon: 'icon-verify', link: 'integrity-engine', refs: ['src-tauri/src/commands/mods.rs › verify_integrity', 'frontend/src/features/mods/mods-actions.ts › verifyIntegrity'] },
        { id: 'DISABLE', kind: 'rust', group: 'BEFORE', icon: 'icon-minus', link: 'mod-activation', refs: ['src-tauri/src/commands/mods.rs › disable_mod_in', 'src-tauri/src/models/mod_entry.rs › installed_files'] },
        { id: 'CLEAN', kind: 'outcome', group: 'BEFORE', icon: 'icon-done', refs: ['src-tauri/src/fs_utils.rs › unapply_mod_stacked_shared_ticketed'] },
        { id: 'PRUNED', kind: 'rust', group: 'AFTER', icon: 'icon-delete', refs: ['src-tauri/src/commands/mods.rs › scan_mods_folder'] },
        { id: 'LEFT', kind: 'data', group: 'AFTER', icon: 'icon-warning', refs: ['src-tauri/src/fs_utils.rs › backup_original_file'] },
        { id: 'PUT_BACK', kind: 'ui', group: 'AFTER', icon: 'icon-restore', refs: ['frontend/src/features/mods/mods-actions.ts › scanModsFolder', 'src-tauri/src/commands/mods.rs › download_mod'] },
        { id: 'CYCLE', kind: 'rust', group: 'AFTER', icon: 'icon-refresh', refs: ['src-tauri/src/commands/mods.rs › enable_mod_in', 'src-tauri/src/fs_utils.rs › backup_original_file'] },
        { id: 'ADDED_LEFT', kind: 'outcome', group: 'AFTER', icon: 'icon-alert', refs: ['src-tauri/src/fs_utils.rs › backup_original_file', 'src-tauri/src/fs_utils.rs › unapply_mod_stacked_shared_ticketed'] },
    ],
    edges: [
        { from: 'IN_APP', to: 'SAFE', label: 'onlyDisabled', tone: 'ok' },
        { from: 'EXPLORER', to: 'SAFE', label: 'wasDisabled', tone: 'ok', dashed: true },
        { from: 'EXPLORER', to: 'SCANNED', label: 'wasEnabled', tone: 'warn', thick: true },
        { from: 'SCANNED', to: 'VERIFY', label: 'check', tone: 'info', dashed: true },
        { from: 'SCANNED', to: 'DISABLE', label: '~no', tone: 'ok' },
        { from: 'VERIFY', to: 'DISABLE', label: 'fix', tone: 'info' },
        { from: 'DISABLE', to: 'CLEAN', tone: 'ok' },
        { from: 'SCANNED', to: 'PRUNED', label: '~yes', tone: 'danger', thick: true },
        { from: 'PRUNED', to: 'LEFT', thick: true },
        { from: 'LEFT', to: 'PUT_BACK', label: 'fix', tone: 'info', thick: true },
        { from: 'PUT_BACK', to: 'CYCLE', thick: true },
        { from: 'CYCLE', to: 'CLEAN', label: 'replacedFiles', tone: 'ok', thick: true },
        { from: 'CYCLE', to: 'ADDED_LEFT', label: 'addedFiles', tone: 'warn' },
    ],
};
//# sourceMappingURL=faq-deleted-mod.js.map