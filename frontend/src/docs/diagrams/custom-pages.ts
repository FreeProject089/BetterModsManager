import type { DiagramSpec } from '../diagram-spec.js';

// How a custom page gets its permissions and how it runs, from src-tauri/src/commands/custom_pages.rs
// (grants, import review, bmmpage:// protocol and its CSP, require_cap) and the front end
// (ui/nav-bundle-import.ts, ui/nav-grant-review.ts, ui/custom-page-broker.ts). An imported page
// starts with nothing; every command that acts for a page re-checks the page id and its
// effective grants, and refuses a call that comes from a page frame itself.
export const customPages: DiagramSpec = {
    id: 'custom-pages',
    i18n: 'docs.diagram.custom-pages',
    category: 'automation',
    dir: 'TB',
    article: 'custom-pages',
    related: ['security-system', 'deeplinks', 'theme-system'],
    groups: [
        { id: 'GRANT' },
        { id: 'RUN' },
        { id: 'CALLS' },
    ],
    nodes: [
        { id: 'IMPORT', kind: 'ui', group: 'GRANT', icon: 'icon-import', refs: ['frontend/src/ui/nav-bundle-import.ts › runNavBundleImport', 'frontend/src/ui/nav-bundle-import.ts › planNavBundleImport'] },
        { id: 'PENDING', kind: 'rust', group: 'GRANT', icon: 'icon-lock', refs: ['src-tauri/src/commands/custom_pages.rs › create_imported_custom_page', 'src-tauri/src/commands/custom_pages.rs › mark_import_pending_in'] },
        { id: 'REVIEW', kind: 'ui', group: 'GRANT', icon: 'icon-shield', refs: ['frontend/src/ui/nav-grant-review.ts › openGrantReview', 'frontend/src/ui/nav-bundle-import.ts › reviewAnswer'] },
        { id: 'APPLY', kind: 'rust', group: 'GRANT', icon: 'icon-check', refs: ['src-tauri/src/commands/custom_pages.rs › page_apply_reviewed_grants', 'src-tauri/src/commands/custom_pages.rs › apply_review_in'] },
        { id: 'EDITOR', kind: 'ui', group: 'GRANT', icon: 'icon-edit', refs: ['src-tauri/src/commands/custom_pages.rs › page_set_grant', 'src-tauri/src/commands/custom_pages.rs › page_set_net_origins'] },
        { id: 'GRANTS', kind: 'data', group: 'GRANT', icon: 'icon-key', refs: ['src-tauri/src/commands/custom_pages.rs › effective_grants_in', 'src-tauri/src/commands/custom_pages.rs › GRANTS_META', 'src-tauri/src/commands/custom_pages.rs › KNOWN_CAPS'] },

        { id: 'FRAME', kind: 'ui', group: 'RUN', icon: 'icon-layout', refs: ['frontend/src/ui/navbar-customize.ts › activateCustom', 'frontend/src/ui/navbar-customize.ts › pageBundleUrl'] },
        { id: 'PROTO', kind: 'rust', group: 'RUN', icon: 'icon-shield', refs: ['src-tauri/src/commands/custom_pages.rs › bmmpage_protocol', 'src-tauri/src/commands/custom_pages.rs › page_csp'] },

        { id: 'BROKER', kind: 'front', group: 'CALLS', icon: 'icon-message', refs: ['frontend/src/ui/custom-page-broker.ts › initPageBroker', 'frontend/src/ui/custom-page-broker.ts › pageIdFor'] },
        { id: 'GATE', kind: 'decision', group: 'CALLS', refs: ['src-tauri/src/commands/custom_pages.rs › require_cap_in', 'src-tauri/src/commands/custom_pages.rs › refuse_page_caller', 'src-tauri/src/commands/custom_pages.rs › page_installed_in'] },
        { id: 'DENIED', kind: 'outcome', group: 'CALLS', icon: 'icon-stop', refs: ['src-tauri/src/commands/custom_pages.rs › require_cap_in', 'frontend/src/ui/custom-page-broker.ts › initPageBroker'] },
        { id: 'STORAGE', kind: 'rust', group: 'CALLS', icon: 'icon-database', refs: ['src-tauri/src/commands/custom_pages.rs › page_storage_set', 'src-tauri/src/commands/custom_pages.rs › MAX_STORAGE_BYTES', 'src-tauri/src/commands/custom_pages.rs › page_system_info'] },
        { id: 'FETCH', kind: 'rust', group: 'CALLS', icon: 'icon-globe', refs: ['src-tauri/src/commands/custom_pages.rs › page_fetch', 'src-tauri/src/commands/custom_pages.rs › page_fetch_client', 'src-tauri/src/commands/custom_pages.rs › MAX_FETCH_BYTES'] },
    ],
    edges: [
        { from: 'IMPORT', to: 'PENDING', label: 'bmmnav', thick: true },
        { from: 'PENDING', to: 'REVIEW', label: 'requests', tone: 'info', thick: true },
        { from: 'REVIEW', to: 'APPLY', label: 'ticked', tone: 'warn', thick: true },
        { from: 'APPLY', to: 'GRANTS', label: '~writes', thick: true },
        { from: 'EDITOR', to: 'GRANTS', label: '~writes' },

        { from: 'FRAME', to: 'PROTO', label: 'bmmpage', thick: true },
        { from: 'GRANTS', to: 'PROTO', label: 'origins', dashed: true },
        { from: 'FRAME', to: 'BROKER', label: 'postMessage', tone: 'info', thick: true },
        { from: 'BROKER', to: 'GATE', label: '~invoke', thick: true },
        { from: 'GRANTS', to: 'GATE', label: '~reads', dashed: true },
        { from: 'GATE', to: 'DENIED', label: '~refused', tone: 'danger' },
        { from: 'GATE', to: 'STORAGE', label: 'granted', tone: 'ok' },
        { from: 'GATE', to: 'FETCH', label: 'network', tone: 'ok' },
    ],
};
