// How a profile gets its look (commands/image.rs, the profile dialogs in
// features/profiles/profiles.ts): a colour and a built-in icon are plain fields of the profile in
// data.json; a custom icon is copied as is next to data.json; a background is cropped in the
// dialog, written as a temporary WebP, and only made final when the dialog is saved. Image work
// runs under an Image ticket of the resource governor, off the main thread.
export const profileCustomization = {
    id: 'profile-customization',
    i18n: 'docs.diagram.profile-customization',
    category: 'profiles',
    dir: 'TB',
    article: 'first-profile',
    related: ['profile-system', 'disk-io-limiter', 'theme-system'],
    groups: [
        { id: 'DIALOG' },
        { id: 'WORK' },
        { id: 'DISK', dir: 'LR' },
    ],
    nodes: [
        { id: 'LOOK', kind: 'ui', group: 'DIALOG', icon: 'icon-edit', refs: ['frontend/src/features/profiles/profiles.ts › renderIconPicker', 'src-tauri/src/commands/profile.rs › ProfilePayload'] },
        { id: 'PICK_ICON', kind: 'ui', group: 'DIALOG', icon: 'icon-image', refs: ['frontend/src/features/profiles/profiles.ts › pickProfileIconFile'] },
        { id: 'PICK_BG', kind: 'ui', group: 'DIALOG', icon: 'icon-image', refs: ['frontend/src/features/profiles/profiles.ts › initEditBackgroundSection'] },
        { id: 'CROPPER', kind: 'ui', group: 'DIALOG', icon: 'icon-layout', refs: ['frontend/src/features/profiles/profiles.ts › openCropOverlay'] },
        { id: 'SAVE', kind: 'decision', group: 'DIALOG', refs: ['frontend/src/features/profiles/profiles.ts › confirmEditProfile', 'frontend/src/features/profiles/profiles.ts › confirmCreateProfile'] },
        { id: 'IMPORT_ICON', kind: 'rust', group: 'WORK', icon: 'icon-copy', refs: ['src-tauri/src/commands/image.rs › import_profile_icon'] },
        { id: 'CROP', kind: 'rust', group: 'WORK', icon: 'icon-image', refs: ['src-tauri/src/commands/image.rs › crop_and_save_webp', 'src-tauri/src/commands/image.rs › crop_to_webp'] },
        { id: 'TICKET', kind: 'rust', group: 'WORK', icon: 'icon-meter', refs: ['src-tauri/src/commands/image.rs › image_gate', 'src-tauri/src/governor/config.rs › OpKind'], link: 'disk-io-limiter' },
        { id: 'APPLY', kind: 'rust', group: 'WORK', icon: 'icon-check', refs: ['src-tauri/src/commands/image.rs › apply_profile_background'] },
        { id: 'REMOVE', kind: 'rust', group: 'WORK', icon: 'icon-trash', refs: ['src-tauri/src/commands/image.rs › remove_profile_background', 'src-tauri/src/commands/image.rs › remove_profile_icon'] },
        { id: 'FILES', kind: 'data', group: 'DISK', icon: 'icon-folder', refs: ['src-tauri/src/commands/image.rs › import_profile_icon', 'src-tauri/src/commands/image.rs › apply_profile_background'] },
        { id: 'DATA', kind: 'data', group: 'DISK', icon: 'icon-database', refs: ['src-tauri/src/models/profile.rs › Profile', 'src-tauri/src/state.rs › save'] },
        { id: 'CARD', kind: 'outcome', icon: 'icon-grid', refs: ['frontend/src/features/profiles/profiles.ts › renderProfiles', 'src-tauri/src/commands/image.rs › get_profile_background_path', 'src-tauri/src/commands/image.rs › get_profile_icon_path'] },
    ],
    edges: [
        { from: 'LOOK', to: 'DATA', label: 'fields', tone: 'info' },
        { from: 'PICK_ICON', to: 'SAVE' },
        { from: 'PICK_BG', to: 'CROPPER', thick: true },
        { from: 'CROPPER', to: 'CROP', label: 'confirm', thick: true },
        { from: 'CROP', to: 'TICKET', dashed: true },
        { from: 'IMPORT_ICON', to: 'TICKET', dashed: true },
        { from: 'CROP', to: 'SAVE', label: 'tempFile', thick: true },
        { from: 'SAVE', to: 'IMPORT_ICON', label: 'icon', tone: 'ok' },
        { from: 'SAVE', to: 'APPLY', label: 'background', tone: 'ok', thick: true },
        { from: 'SAVE', to: 'REMOVE', label: 'removed', tone: 'warn', dashed: true },
        { from: 'IMPORT_ICON', to: 'FILES', label: '~writes' },
        { from: 'APPLY', to: 'FILES', label: 'rename', thick: true },
        { from: 'REMOVE', to: 'FILES', label: 'deletes', tone: 'danger' },
        { from: 'FILES', to: 'DATA', label: 'fileName' },
        { from: 'DATA', to: 'CARD', label: '~reads', thick: true },
    ],
};
//# sourceMappingURL=profile-customization.js.map