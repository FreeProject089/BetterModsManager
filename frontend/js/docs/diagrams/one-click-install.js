// A one-click mod install, as it runs today: a bmm://install (or import / download) link reaches
// the app (main.rs: protocol registration, single-instance forwarding, a pending link at cold
// start), passes the link gate (deeplink-guard.ts: https only from outside), asks the user in its
// own dialog (name, target profile, or a new profile), then download_mod streams the file under a
// Download ticket, unpacks a zip into a new mod folder, and records a disabled mod.
// The generic deeplink machinery is the `deeplinks` diagram.
export const oneClickInstall = {
    id: 'one-click-install',
    i18n: 'docs.diagram.one-click-install',
    category: 'mods',
    dir: 'TB',
    article: 'one-click-install',
    related: ['deeplinks', 'mod-import', 'security-system', 'mod-activation'],
    groups: [
        { id: 'LINK' },
        { id: 'ASK' },
        { id: 'DL' },
    ],
    nodes: [
        { id: 'URL', kind: 'ext', group: 'LINK', icon: 'icon-link', refs: ['frontend/src/core/deep_link_manager.ts › handleDeepLink'] },
        { id: 'OS', kind: 'rust', group: 'LINK', icon: 'icon-app', link: 'deeplinks', refs: ['src-tauri/src/main.rs › register_bmm_protocol', 'src-tauri/src/main.rs › PENDING_DEEP_LINK', 'src-tauri/src/main.rs › get_pending_deep_link'] },
        { id: 'GATE', kind: 'decision', group: 'LINK', icon: 'icon-shield', refs: ['frontend/src/core/deeplink-guard.ts › admitLink', 'frontend/src/core/deeplink-guard.ts › linkHttpsRefusal', 'frontend/src/core/deeplink-guard.ts › decideLink'] },
        { id: 'REFUSED', kind: 'outcome', group: 'LINK', icon: 'icon-stop', refs: ['frontend/src/core/deeplink-guard.ts › admitLink'] },
        { id: 'CONFIRM', kind: 'ui', group: 'ASK', icon: 'icon-help', refs: ['frontend/src/core/deep_link_manager.ts › handleDeepLink'] },
        { id: 'NEW_PROFILE', kind: 'rust', group: 'ASK', icon: 'icon-user', link: 'profile-system', refs: ['src-tauri/src/commands/profile.rs › create_profile'] },
        { id: 'STREAM', kind: 'rust', group: 'DL', icon: 'icon-download', refs: ['src-tauri/src/commands/mods.rs › download_mod', 'src-tauri/src/fs_utils.rs › DownloadCap', 'src-tauri/src/fs_utils.rs › copy_reader_ticketed'] },
        { id: 'IS_ZIP', kind: 'decision', group: 'DL', refs: ['src-tauri/src/commands/mods.rs › download_mod'] },
        { id: 'UNZIP', kind: 'rust', group: 'DL', icon: 'icon-archive', refs: ['src-tauri/src/archive.rs › check_zip_declared', 'src-tauri/src/archive.rs › ExtractBudget'] },
        { id: 'RAW', kind: 'rust', group: 'DL', icon: 'icon-file', refs: ['src-tauri/src/commands/mods.rs › download_mod'] },
        { id: 'ENTRY', kind: 'data', group: 'DL', icon: 'icon-database', link: 'mod-import', refs: ['src-tauri/src/models/mod_entry.rs › ModEntry', 'src-tauri/src/models/mod_entry.rs › derive_content_id'] },
        { id: 'DONE', kind: 'outcome', icon: 'icon-check', link: 'mod-activation', refs: ['frontend/src/features/mods/mods.ts › refreshMods'] },
    ],
    edges: [
        { from: 'URL', to: 'OS', label: 'click', thick: true },
        { from: 'OS', to: 'GATE', label: '~event', thick: true },
        { from: 'GATE', to: 'REFUSED', label: 'notHttps', tone: 'danger' },
        { from: 'GATE', to: 'CONFIRM', label: '~ok', tone: 'ok', thick: true },
        { from: 'CONFIRM', to: 'NEW_PROFILE', label: 'newProfile', dashed: true },
        { from: 'CONFIRM', to: 'STREAM', label: '~yes', tone: 'ok', thick: true },
        { from: 'NEW_PROFILE', to: 'STREAM' },
        { from: 'STREAM', to: 'IS_ZIP', thick: true },
        { from: 'IS_ZIP', to: 'UNZIP', label: '~yes', tone: 'ok', thick: true },
        { from: 'IS_ZIP', to: 'RAW', label: '~no', tone: 'warn' },
        { from: 'UNZIP', to: 'ENTRY', thick: true },
        { from: 'RAW', to: 'ENTRY' },
        { from: 'ENTRY', to: 'DONE', thick: true },
    ],
};
//# sourceMappingURL=one-click-install.js.map