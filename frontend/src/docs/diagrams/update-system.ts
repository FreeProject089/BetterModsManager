import type { DiagramSpec } from '../diagram-spec.js';

// Updates for MODS (BMM's own update is app-update.ts): check_mod_updates (commands/repo.rs)
// compares every update-linked mod with the repo(s) it is linked to, and watches direct
// download links for a change of their remote validator; features/repo/mod-updates.ts shows the
// result and applies it, through a delta repo sync or apply_direct_update.
export const updateSystem: DiagramSpec = {
    id: 'update-system',
    i18n: 'docs.diagram.update-system',
    category: 'updates',
    dir: 'TB',
    article: 'staying-updated',
    related: ['app-update', 'server-mode', 'mod-sync'],
    groups: [
        { id: 'SOURCES', dir: 'LR' },
        { id: 'DETECT' },
        { id: 'APPLY' },
    ],
    nodes: [
        { id: 'LINKS', kind: 'data', group: 'SOURCES', icon: 'icon-link', refs: ['src-tauri/src/commands/repo.rs › set_mod_update_config', 'frontend/src/features/repo/mod-updates.ts › openModUpdateConfig', 'frontend/src/features/repo/mod-updates.ts › getGlobalUpdateRepos'] },
        { id: 'REPO', kind: 'ext', group: 'SOURCES', icon: 'icon-server', refs: ['src-tauri/src/commands/repo.rs › fetch_repo_info'] },
        { id: 'DIRECT', kind: 'ext', group: 'SOURCES', icon: 'icon-globe', refs: ['src-tauri/src/commands/repo.rs › fetch_url_validator'] },

        { id: 'TRIGGER', kind: 'ui', group: 'DETECT', icon: 'icon-refresh', refs: ['frontend/src/features/repo/mod-updates.ts › checkModUpdates', 'frontend/src/features/repo/mod-updates.ts › startAutoUpdateChecks', 'frontend/src/features/repo/mod-updates.ts › checkSingleModUpdate'] },
        { id: 'CHECK', kind: 'rust', group: 'DETECT', icon: 'icon-search', refs: ['src-tauri/src/commands/repo.rs › check_mod_updates', 'src-tauri/src/commands/repo.rs › normalize_repo_url'] },
        { id: 'VERSION', kind: 'decision', group: 'DETECT', refs: ['src-tauri/src/commands/repo.rs › check_mod_updates', 'src-tauri/src/commands/repo.rs › ModUpdateInfo'] },
        { id: 'BASELINE', kind: 'decision', group: 'DETECT', refs: ['src-tauri/src/commands/repo.rs › DirectSourceInfo', 'src-tauri/src/commands/repo.rs › describe_sig_change'] },
        { id: 'NOTHING', kind: 'outcome', group: 'DETECT', icon: 'icon-check', refs: ['src-tauri/src/commands/repo.rs › ModUpdateCheckResult', 'frontend/src/features/repo/mod-updates.ts › checkModUpdates'] },

        { id: 'MODAL', kind: 'ui', group: 'APPLY', icon: 'icon-list', refs: ['frontend/src/features/repo/mod-updates.ts › openUpdatesModal', 'frontend/src/features/repo/mod-updates.ts › setUpdateState'] },
        { id: 'REPO_SYNC', kind: 'rust', group: 'APPLY', icon: 'icon-sync', refs: ['frontend/src/features/repo/mod-updates.ts › applyRepoUpdate', 'src-tauri/src/commands/repo.rs › sync_server_repo', 'src-tauri/src/commands/repo.rs › check_repo_signature'] },
        { id: 'DIRECT_APPLY', kind: 'rust', group: 'APPLY', icon: 'icon-download', refs: ['src-tauri/src/commands/repo.rs › apply_direct_update', 'frontend/src/features/repo/mod-updates.ts › applyDirectUpdate'] },
        { id: 'DONE', kind: 'outcome', group: 'APPLY', icon: 'icon-done', refs: ['frontend/src/features/repo/mod-updates.ts › applyDirectUpdate', 'src-tauri/src/commands/repo.rs › derive_content_id'] },
    ],
    edges: [
        { from: 'TRIGGER', to: 'CHECK', thick: true },
        { from: 'LINKS', to: 'CHECK', label: '~reads', dashed: true },
        { from: 'CHECK', to: 'REPO', label: 'perRepo', tone: 'info', thick: true },
        { from: 'CHECK', to: 'DIRECT', label: 'perLink', tone: 'info' },
        { from: 'REPO', to: 'VERSION', thick: true },
        { from: 'REPO', to: 'MODAL', label: 'unreachable', tone: 'danger', dashed: true },
        { from: 'DIRECT', to: 'BASELINE' },
        { from: 'VERSION', to: 'MODAL', label: '~yes', tone: 'ok', thick: true },
        { from: 'VERSION', to: 'NOTHING', label: '~no', tone: 'info' },
        { from: 'BASELINE', to: 'MODAL', label: 'changed', tone: 'warn' },
        { from: 'BASELINE', to: 'NOTHING', label: 'sameOrNew', tone: 'info' },

        { from: 'MODAL', to: 'REPO_SYNC', label: 'repo', tone: 'ok', thick: true },
        { from: 'MODAL', to: 'DIRECT_APPLY', label: 'direct', tone: 'warn' },
        { from: 'REPO_SYNC', to: 'DONE', thick: true },
        { from: 'DIRECT_APPLY', to: 'DONE' },
    ],
};
