import type { DiagramSpec } from '../diagram-spec.js';

// The App Catalog page (features/apps/apps-catalog.ts): fetch_app_catalogs (apps.rs) walks the
// official catalogue, the partners IT names and the community sources, and assigns trust by
// where an entry came from; .bmmbundle sources are opened locally and merged. install_app
// streams the payload to a .part file under the 4 GiB cap, checks its SHA-256 before anything
// is renamed or run, then runs a setup, extracts a zip or keeps a portable exe.
export const appCatalog: DiagramSpec = {
    id: 'app-catalog',
    i18n: 'docs.diagram.app-catalog',
    category: 'sharing',
    dir: 'TB',
    article: 'catalogs',
    related: ['deeplinks', 'launch-packs', 'security-system'],
    groups: [
        { id: 'SOURCES', dir: 'LR' },
        { id: 'LOAD' },
        { id: 'INSTALL' },
    ],
    nodes: [
        { id: 'OFFICIAL', kind: 'ext', group: 'SOURCES', icon: 'icon-shield', refs: ['frontend/src/core/links-config.ts › apps_catalog', 'src-tauri/src/commands/apps.rs › fetch_app_catalogs'] },
        { id: 'PARTNER', kind: 'ext', group: 'SOURCES', icon: 'icon-users', refs: ['src-tauri/src/commands/apps.rs › partner_catalogs'] },
        { id: 'COMMUNITY', kind: 'ui', group: 'SOURCES', icon: 'icon-globe', refs: ['frontend/src/features/apps/apps-catalog.ts › renderSources', 'src-tauri/src/commands/apps.rs › add_community_source', 'src-tauri/src/commands/apps.rs › community_imports'] },
        { id: 'BUNDLE', kind: 'data', group: 'SOURCES', icon: 'icon-package', refs: ['frontend/src/features/apps/apps-catalog.ts › appsFromBundle', 'src-tauri/src/commands/catalog_bundle.rs › catalog_bundle_open'] },

        { id: 'FETCH', kind: 'rust', group: 'LOAD', icon: 'icon-download', refs: ['src-tauri/src/commands/apps.rs › fetch_raw_catalog', 'src-tauri/src/commands/net.rs › catalog_get', 'frontend/src/features/apps/apps-catalog.ts › loadCatalog'] },
        { id: 'TRUST', kind: 'rust', group: 'LOAD', icon: 'icon-verify', refs: ['src-tauri/src/commands/apps.rs › apply_trust', 'frontend/src/features/apps/apps-catalog.ts › claimChip'] },
        { id: 'BROWSE', kind: 'ui', group: 'LOAD', icon: 'icon-layout', refs: ['frontend/src/features/apps/apps-catalog.ts › renderBrowse', 'frontend/src/features/apps/apps-catalog.ts › openDetailModal'] },

        { id: 'INSTALL_APP', kind: 'rust', group: 'INSTALL', icon: 'icon-download', refs: ['frontend/src/features/apps/apps-catalog.ts › openInstallModal', 'src-tauri/src/commands/apps.rs › install_app', 'src-tauri/src/fs_utils.rs › DownloadCap'] },
        { id: 'CHECKSUM', kind: 'decision', group: 'INSTALL', icon: 'icon-integrity', refs: ['src-tauri/src/commands/apps.rs › install_app', 'frontend/src/features/apps/apps-catalog.ts › integrityChip'] },
        { id: 'DROPPED', kind: 'outcome', group: 'INSTALL', icon: 'icon-trash', refs: ['src-tauri/src/commands/apps.rs › install_app'] },
        { id: 'SETUP', kind: 'rust', group: 'INSTALL', icon: 'icon-cog', refs: ['src-tauri/src/commands/apps.rs › auto_detect_installed_exe', 'src-tauri/src/commands/apps.rs › find_registry_app', 'src-tauri/src/archive.rs'] },
        { id: 'STATE', kind: 'data', group: 'INSTALL', icon: 'icon-database', refs: ['src-tauri/src/commands/apps.rs › state_path', 'src-tauri/src/commands/apps.rs › get_apps_state'] },
        { id: 'LAUNCH', kind: 'outcome', group: 'INSTALL', icon: 'icon-play', refs: ['src-tauri/src/commands/apps.rs › launch_app', 'src-tauri/src/commands/apps.rs › uninstall_app'] },

        { id: 'CREATE', kind: 'ui', icon: 'icon-edit', refs: ['frontend/src/features/apps/apps-catalog.ts › renderCreate', 'frontend/src/features/apps/apps-catalog.ts › publishBundle', 'src-tauri/src/commands/catalog_bundle.rs › catalog_bundle_pack'] },
    ],
    edges: [
        { from: 'OFFICIAL', to: 'FETCH', thick: true },
        { from: 'OFFICIAL', to: 'PARTNER', label: 'names', tone: 'info', dashed: true },
        { from: 'PARTNER', to: 'FETCH' },
        { from: 'COMMUNITY', to: 'FETCH' },
        { from: 'FETCH', to: 'TRUST', thick: true },
        { from: 'TRUST', to: 'BROWSE', thick: true },
        { from: 'BUNDLE', to: 'BROWSE', label: 'merged', dashed: true },
        { from: 'BROWSE', to: 'INSTALL_APP', label: 'install', thick: true },
        { from: 'INSTALL_APP', to: 'CHECKSUM', thick: true },
        { from: 'CHECKSUM', to: 'SETUP', label: '~ok', tone: 'ok', thick: true },
        { from: 'CHECKSUM', to: 'DROPPED', label: '~refused', tone: 'danger' },
        { from: 'SETUP', to: 'STATE', label: '~writes', thick: true },
        { from: 'STATE', to: 'LAUNCH', thick: true },
        { from: 'CREATE', to: 'COMMUNITY', label: 'publish', tone: 'info', dashed: true },
    ],
};
