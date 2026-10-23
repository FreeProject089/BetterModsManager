// The two kinds of backup BMM keeps, and nothing else.
//  · Game originals: the first time a mod replaces a real game file, the original goes to the
//    profile's backup folder under _original/ (fs_utils::backup_original_file); disabling the last
//    mod that covers the file puts it back and deletes the copy. The per-file detail of
//    enable/disable is in mod-activation; this shows the backup folder's life.
//  · BMM's own data: data.json is written with a rolling data.json.bak (state.rs), and a
//    .DATABMM archive is written on demand or by a scheduled task (data-backup.ts,
//    export_bundle.rs) and restored with a safety copy first (restore_bundle.rs).
// There is no per-profile snapshot of the game folder.
export const backupSystem = {
    id: 'backup-system',
    i18n: 'docs.diagram.backup-system',
    category: 'profiles',
    dir: 'TB',
    article: 'backups',
    related: ['mod-activation', 'profile-system', 'faq-disk-full', 'scheduler'],
    groups: [
        { id: 'ORIG' },
        { id: 'APP' },
    ],
    nodes: [
        { id: 'ENABLE', kind: 'rust', group: 'ORIG', icon: 'icon-plus', refs: ['src-tauri/src/fs_utils.rs › apply_mod_stacked_ticketed', 'src-tauri/src/commands/mods.rs › enable_mod_in'], link: 'mod-activation' },
        { id: 'IS_ORIGINAL', kind: 'decision', group: 'ORIG', refs: ['src-tauri/src/fs_utils.rs › backup_original_file', 'src-tauri/src/commands/mod_order.rs › game_folder_share'] },
        { id: 'ORIGINALS', kind: 'data', group: 'ORIG', icon: 'icon-archive', refs: ['src-tauri/src/fs_utils.rs › backup_original_file', 'src-tauri/src/fs_utils.rs › copy_file_governed', 'src-tauri/src/commands/profile.rs › create_profile'] },
        { id: 'DISABLE', kind: 'rust', group: 'ORIG', icon: 'icon-minus', refs: ['src-tauri/src/fs_utils.rs › unapply_mod_stacked_shared_ticketed', 'src-tauri/src/commands/mods.rs › disable_mod_in'], link: 'mod-activation' },
        { id: 'RESTORED', kind: 'outcome', group: 'ORIG', icon: 'icon-restore', refs: ['src-tauri/src/fs_utils.rs › unapply_mod_stacked_shared_ticketed', 'src-tauri/src/fs_utils.rs › remove_empty_dirs'] },
        { id: 'SAVE', kind: 'rust', group: 'APP', icon: 'icon-save', refs: ['src-tauri/src/state.rs › save', 'src-tauri/src/state.rs › load_with_recovery'] },
        { id: 'DATA_BAK', kind: 'data', group: 'APP', icon: 'icon-database', refs: ['src-tauri/src/state.rs › load_with_recovery'] },
        { id: 'EXPORT_UI', kind: 'ui', group: 'APP', icon: 'icon-export', refs: ['frontend/src/features/settings/data-backup.ts › writeBackup', 'frontend/src/features/settings/data-backup.ts › DEFAULT_SECTIONS'], link: 'scheduler' },
        { id: 'BUNDLE', kind: 'rust', group: 'APP', icon: 'icon-package', refs: ['src-tauri/src/commands/export_bundle.rs › export_data_bundle', 'src-tauri/src/commands/settings.rs › backup_dest_path'] },
        { id: 'DATABMM', kind: 'data', group: 'APP', icon: 'icon-archive', refs: ['src-tauri/src/commands/settings.rs › backup_dest_path', 'src-tauri/src/commands/secret_box.rs'] },
        { id: 'RESTORE', kind: 'rust', group: 'APP', icon: 'icon-restore', refs: ['src-tauri/src/commands/restore_bundle.rs › inspect_data_bundle', 'src-tauri/src/commands/restore_bundle.rs › restore_data_bundle', 'src-tauri/src/commands/restore_bundle.rs › foreign_restore_refusal'] },
        { id: 'BEFORE', kind: 'data', group: 'APP', icon: 'icon-history', refs: ['src-tauri/src/commands/restore_bundle.rs › restore_data_bundle'] },
    ],
    edges: [
        { from: 'ENABLE', to: 'IS_ORIGINAL', label: '~perFile', tone: 'info', thick: true },
        { from: 'IS_ORIGINAL', to: 'ORIGINALS', label: 'firstTime', tone: 'ok', thick: true },
        { from: 'IS_ORIGINAL', to: 'ENABLE', label: 'skip', tone: 'warn', dashed: true },
        { from: 'ORIGINALS', to: 'DISABLE', label: '~later', dashed: true },
        { from: 'DISABLE', to: 'RESTORED', label: 'lastProvider', tone: 'ok', thick: true },
        { from: 'RESTORED', to: 'ORIGINALS', label: 'deleted', tone: 'warn', dashed: true },
        { from: 'SAVE', to: 'DATA_BAK', label: 'everySave', thick: true },
        { from: 'EXPORT_UI', to: 'BUNDLE', thick: true },
        { from: 'DATA_BAK', to: 'SAVE', label: 'recover', tone: 'warn', dashed: true },
        { from: 'BUNDLE', to: 'DATABMM', label: '~writes', thick: true },
        { from: 'DATABMM', to: 'RESTORE', label: 'restore', tone: 'info' },
        { from: 'RESTORE', to: 'BEFORE', label: 'firstCopy', tone: 'warn' },
        { from: 'RESTORE', to: 'SAVE', label: 'replaces', tone: 'danger' },
    ],
};
//# sourceMappingURL=backup-system.js.map