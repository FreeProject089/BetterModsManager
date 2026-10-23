import type { DiagramSpec } from '../diagram-spec.js';

// BMM updating ITSELF (mod updates are update-system.ts): the release check of
// ui/update-notes.ts → check_for_update (GitHub feed, BCWEB fallback from links.json), the
// BetterInstaller override, the update dialog, and the three ways in: Quick Update (signed
// incremental manifest), BetterInstaller's own updater, or the full installer, which runs only
// when the signed manifest lists it with its SHA-256 (commands/autoupdate.rs).
export const appUpdate: DiagramSpec = {
    id: 'app-update',
    i18n: 'docs.diagram.app-update',
    category: 'updates',
    dir: 'TB',
    article: 'staying-updated',
    related: ['update-system', 'security-system'],
    groups: [
        { id: 'CHECK' },
        { id: 'INSTALL' },
    ],
    nodes: [
        { id: 'START', kind: 'ui', group: 'CHECK', icon: 'icon-refresh', refs: ['frontend/src/ui/update-notes.ts › initAutoUpdate', 'frontend/src/ui/update-notes.ts › performUpdateCheck', 'src-tauri/src/commands/settings.rs › is_update_disabled'] },
        { id: 'LINKS', kind: 'data', group: 'CHECK', icon: 'icon-link', refs: ['frontend/src/core/links-config.ts › loadLinks', 'frontend/src/core/links-config.ts › getLinks'] },
        { id: 'FEED', kind: 'ext', group: 'CHECK', icon: 'icon-cloud', refs: ['src-tauri/src/commands/autoupdate.rs › DEFAULT_UPDATE_API', 'src-tauri/src/commands/autoupdate.rs › release_url'] },
        { id: 'FETCH', kind: 'rust', group: 'CHECK', icon: 'icon-network', refs: ['src-tauri/src/commands/autoupdate.rs › check_for_update', 'src-tauri/src/commands/autoupdate.rs › fetch_release', 'src-tauri/src/commands/autoupdate.rs › worth_retrying'] },
        { id: 'BI_CHECK', kind: 'rust', group: 'CHECK', icon: 'icon-search', refs: ['src-tauri/src/commands/autoupdate.rs › check_update_via_installer', 'src-tauri/src/commands/autoupdate.rs › installer_maintenance_exe'] },
        { id: 'NEWER', kind: 'decision', group: 'CHECK', refs: ['src-tauri/src/commands/autoupdate.rs › is_newer_version', 'src-tauri/src/commands/autoupdate.rs › cmp_version'] },
        { id: 'UPTODATE', kind: 'outcome', group: 'CHECK', icon: 'icon-check', refs: ['frontend/src/ui/update-notes.ts › performUpdateCheck'] },

        { id: 'MODAL', kind: 'ui', group: 'INSTALL', icon: 'icon-download', refs: ['frontend/src/ui/update-notes.ts › showUpdateAvailableModal'] },
        { id: 'QUICK', kind: 'rust', group: 'INSTALL', icon: 'icon-zap', refs: ['src-tauri/src/commands/autoupdate.rs › fetch_update_manifest', 'src-tauri/src/commands/autoupdate.rs › apply_incremental_update'] },
        { id: 'BI_UPDATE', kind: 'rust', group: 'INSTALL', icon: 'icon-package', refs: ['src-tauri/src/commands/autoupdate.rs › update_via_installer'] },
        { id: 'FULL', kind: 'rust', group: 'INSTALL', icon: 'icon-download', refs: ['src-tauri/src/commands/autoupdate.rs › download_and_install_update', 'src-tauri/src/commands/autoupdate.rs › installer_for', 'src-tauri/src/commands/autoupdate.rs › check_installer_bytes'] },
        { id: 'VERIFY', kind: 'decision', group: 'INSTALL', icon: 'icon-shield', refs: ['src-tauri/src/commands/autoupdate.rs › verify_manifest_text', 'src-tauri/src/commands/autoupdate.rs › MANIFEST_PUBLIC_KEY_HEX', 'src-tauri/src/commands/autoupdate.rs › fetch_manifest_document'] },
        { id: 'STAY', kind: 'outcome', group: 'INSTALL', icon: 'icon-stop', refs: ['src-tauri/src/commands/autoupdate.rs › verify_manifest_text'] },
        { id: 'RESTART', kind: 'outcome', group: 'INSTALL', icon: 'icon-start', refs: ['src-tauri/src/commands/autoupdate.rs › IncrementalResult', 'src-tauri/src/commands/autoupdate.rs › download_and_install_update'] },
    ],
    edges: [
        { from: 'START', to: 'FETCH', thick: true },
        { from: 'LINKS', to: 'FETCH', label: '~reads', dashed: true },
        { from: 'FEED', to: 'FETCH', label: 'release', tone: 'info' },
        { from: 'FETCH', to: 'BI_CHECK', thick: true },
        { from: 'BI_CHECK', to: 'NEWER', thick: true },
        { from: 'NEWER', to: 'UPTODATE', label: '~no', tone: 'info' },
        { from: 'NEWER', to: 'MODAL', label: '~yes', tone: 'ok', thick: true },

        { from: 'MODAL', to: 'QUICK', label: 'quick', tone: 'ok', thick: true },
        { from: 'MODAL', to: 'BI_UPDATE', label: 'full', tone: 'info' },
        { from: 'BI_UPDATE', to: 'FULL', label: 'notInstaller', tone: 'warn', dashed: true },
        { from: 'QUICK', to: 'VERIFY', thick: true },
        { from: 'FULL', to: 'VERIFY' },
        { from: 'VERIFY', to: 'STAY', label: '~refused', tone: 'danger' },
        { from: 'VERIFY', to: 'RESTART', label: '~valid', tone: 'ok', thick: true },
        { from: 'BI_UPDATE', to: 'RESTART', tone: 'ok' },
    ],
};
