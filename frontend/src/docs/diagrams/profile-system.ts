import type { DiagramSpec } from '../diagram-spec.js';

// What a profile is and what each profile action really does (commands/profile.rs, the Profiles
// screen in features/profiles/profiles.ts). A profile is an entry in data.json: a game folder, a
// mods folder, a backup folder and the ordered list of its active mods. Switching the active
// profile moves no file: it only changes which profile the Library and the toggles act on. Files
// move only when mods are turned on or off (mod-activation).
export const profileSystem: DiagramSpec = {
    id: 'profile-system',
    i18n: 'docs.diagram.profile-system',
    category: 'profiles',
    dir: 'TB',
    article: 'first-profile',
    related: ['mod-activation', 'backup-system', 'profile-customization', 'faq-disk-full'],
    groups: [
        { id: 'SETUP' },
        { id: 'STORE', dir: 'LR' },
        { id: 'USE' },
    ],
    nodes: [
        { id: 'FORM', kind: 'ui', group: 'SETUP', icon: 'icon-add', refs: ['frontend/src/features/profiles/profiles.ts › confirmCreateProfile', 'frontend/src/features/profiles/profile-folders-model.ts › folderNotes', 'frontend/src/features/profiles/profiles.ts › checkDuplicateModsFolder'] },
        { id: 'CREATE', kind: 'rust', group: 'SETUP', icon: 'icon-folder', refs: ['src-tauri/src/commands/profile.rs › create_profile', 'src-tauri/src/models/profile.rs › Profile'] },
        { id: 'BACKUP_GIVEN', kind: 'decision', group: 'SETUP', refs: ['src-tauri/src/commands/profile.rs › create_profile'] },
        { id: 'BACKUP_AUTO', kind: 'data', group: 'SETUP', icon: 'icon-archive', refs: ['src-tauri/src/commands/profile.rs › create_profile'], link: 'backup-system' },
        { id: 'EDIT', kind: 'rust', group: 'SETUP', icon: 'icon-edit', refs: ['src-tauri/src/commands/profile.rs › update_profile', 'frontend/src/features/profiles/profiles.ts › confirmEditProfile'] },
        { id: 'REHASH', kind: 'rust', group: 'SETUP', icon: 'icon-refresh', refs: ['src-tauri/src/commands/mods.rs › invalidate_cache', 'src-tauri/src/commands/mods.rs › populate_sha_queue'], link: 'cache-management' },

        { id: 'DATA', kind: 'data', group: 'STORE', icon: 'icon-database', refs: ['src-tauri/src/state.rs › save', 'src-tauri/src/state.rs › load_with_recovery'] },
        { id: 'SHARE', kind: 'rust', group: 'STORE', icon: 'icon-share', refs: ['src-tauri/src/commands/mod_order.rs › game_folder_share', 'src-tauri/src/commands/mod_order.rs › GameFolderShare'], link: 'mod-activation' },

        { id: 'CARDS', kind: 'ui', group: 'USE', icon: 'icon-grid', refs: ['frontend/src/features/profiles/profiles.ts › renderProfiles'] },
        { id: 'SWITCH', kind: 'rust', group: 'USE', icon: 'icon-check', refs: ['src-tauri/src/commands/profile.rs › set_active_profile', 'frontend/src/features/profiles/profiles.ts › activateProfile'] },
        { id: 'LIBRARY', kind: 'outcome', group: 'USE', icon: 'icon-toggle', refs: ['src-tauri/src/commands/mods.rs › get_mods', 'src-tauri/src/commands/mods.rs › enable_mod_in'], link: 'mod-activation' },
        { id: 'BULK_OFF', kind: 'rust', group: 'USE', icon: 'icon-minus', refs: ['src-tauri/src/commands/mods.rs › disable_mods_for_profiles', 'frontend/src/features/profiles/profiles.ts › disableAllRequestedMods'] },
        { id: 'DELETE', kind: 'rust', group: 'USE', icon: 'icon-trash', refs: ['src-tauri/src/commands/profile.rs › delete_profile', 'frontend/src/features/profiles/profiles.ts › openDeleteProfileModal'] },
    ],
    edges: [
        { from: 'FORM', to: 'CREATE', thick: true },
        { from: 'CREATE', to: 'BACKUP_GIVEN' },
        { from: 'BACKUP_GIVEN', to: 'BACKUP_AUTO', label: 'blank', tone: 'info' },
        { from: 'BACKUP_GIVEN', to: 'DATA', label: 'given', tone: 'ok', thick: true },
        { from: 'BACKUP_AUTO', to: 'DATA' },
        { from: 'CARDS', to: 'EDIT', label: 'edit', dashed: true },
        { from: 'EDIT', to: 'DATA', label: '~writes' },
        { from: 'EDIT', to: 'REHASH', label: 'modsMoved', tone: 'warn', dashed: true },
        { from: 'DATA', to: 'CARDS', label: '~reads', thick: true },
        { from: 'CARDS', to: 'SWITCH', thick: true },
        { from: 'SWITCH', to: 'LIBRARY', thick: true },
        { from: 'DATA', to: 'SHARE', label: 'sameGame', tone: 'info' },
        { from: 'SHARE', to: 'LIBRARY', dashed: true },
        { from: 'CARDS', to: 'BULK_OFF', label: 'disableAll', tone: 'warn', dashed: true },
        { from: 'CARDS', to: 'DELETE', label: 'delete', tone: 'danger', dashed: true },
        { from: 'DELETE', to: 'DATA', label: 'entryOnly', tone: 'danger' },
    ],
};
