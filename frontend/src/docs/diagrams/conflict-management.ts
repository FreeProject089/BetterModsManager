import type { DiagramSpec } from '../diagram-spec.js';

// Conflicts as they work today: overlaps are read from the in-memory file -> mods index
// (mods.rs calculate_conflicts_from_cache, one batched get_all_mod_conflicts call), shown as
// Intra/Inter badges and a warning before enabling, and RESOLVED by one list only: the profile's
// activation order (Profile.active_mods, last wins). Changing it re-copies only the files that
// change hands (mod_order.rs commit / redeploy). The per-file deploy itself is mod-activation.
export const conflictManagement: DiagramSpec = {
    id: 'conflict-management',
    i18n: 'docs.diagram.conflict-management',
    category: 'mods',
    dir: 'TB',
    article: 'conflicts',
    related: ['mod-activation', 'mod-sync', 'profile-system', 'mod-architecture'],
    groups: [
        { id: 'DETECT' },
        { id: 'SHOW' },
        { id: 'ORDER' },
    ],
    nodes: [
        { id: 'INDEX', kind: 'data', group: 'DETECT', icon: 'icon-grid', link: 'mod-sync', refs: ['src-tauri/src/state.rs › conflict_index', 'src-tauri/src/commands/mods.rs › ensure_cache_populated'] },
        { id: 'CALC', kind: 'rust', group: 'DETECT', icon: 'icon-compare', refs: ['src-tauri/src/commands/mods.rs › get_all_mod_conflicts', 'src-tauri/src/commands/mods.rs › calculate_conflicts_from_cache', 'src-tauri/src/models/mod_entry.rs › ConflictReport'] },
        { id: 'KIND', kind: 'decision', group: 'DETECT', refs: ['src-tauri/src/models/mod_entry.rs › ConflictCategory', 'src-tauri/src/models/mod_entry.rs › ConflictStatus'] },

        { id: 'BADGES', kind: 'ui', group: 'SHOW', icon: 'icon-warning', refs: ['frontend/src/features/mods/mods-conflicts.ts › checkAllConflicts', 'frontend/src/features/mods/mods-conflicts.ts › updateConflictBadgeOnCard', 'frontend/src/features/mods/mods-conflicts.ts › openGlobalConflictModal'] },
        { id: 'WARN', kind: 'ui', group: 'SHOW', icon: 'icon-alert', refs: ['frontend/src/features/mods/mods-conflicts.ts › showActivationWarning', 'frontend/src/features/mods/mods-list.ts › showActivationWarning'] },
        { id: 'TREE', kind: 'ui', group: 'SHOW', icon: 'icon-file', refs: ['frontend/src/features/mods/mods-conflicts.ts › openConflictTree', 'src-tauri/src/commands/mods.rs › get_conflict_file_tree', 'src-tauri/src/commands/mods.rs › CONFLICT_TREE_MAX'] },

        { id: 'ACTIVE', kind: 'data', group: 'ORDER', icon: 'icon-list', refs: ['src-tauri/src/models/profile.rs › active_mods', 'src-tauri/src/commands/mod_order.rs › contested'] },
        { id: 'VIEW', kind: 'ui', group: 'ORDER', icon: 'icon-priority', refs: ['frontend/src/features/profiles/load-order.ts › openLoadOrder', 'src-tauri/src/commands/mod_order.rs › mod_order_get', 'src-tauri/src/commands/mod_order.rs › mod_order_preview'] },
        { id: 'SET', kind: 'rust', group: 'ORDER', icon: 'icon-save', refs: ['src-tauri/src/commands/mod_order.rs › mod_order_set', 'src-tauri/src/commands/mod_order.rs › is_permutation', 'src-tauri/src/commands/mod_order.rs › commit'] },
        { id: 'REDEPLOY', kind: 'rust', group: 'ORDER', icon: 'icon-patch', refs: ['src-tauri/src/commands/mod_order.rs › handovers', 'src-tauri/src/commands/mod_order.rs › redeploy', 'src-tauri/src/commands/mod_order.rs › read_roots'] },
        { id: 'REAPPLY', kind: 'rust', group: 'ORDER', icon: 'icon-refresh', refs: ['src-tauri/src/commands/mod_order.rs › mod_order_reapply'] },
        { id: 'GAME', kind: 'outcome', icon: 'icon-check', link: 'mod-activation', refs: ['src-tauri/src/fs_utils.rs › copy_file_governed', 'src-tauri/src/commands/mod_order.rs › RedeployReport'] },
    ],
    edges: [
        { from: 'INDEX', to: 'CALC', label: '~reads', thick: true },
        { from: 'CALC', to: 'KIND', label: 'eachPair', tone: 'info', thick: true },
        { from: 'KIND', to: 'BADGES', thick: true },
        { from: 'BADGES', to: 'WARN', label: 'onEnable', tone: 'warn' },
        { from: 'BADGES', to: 'TREE', label: 'openPair', tone: 'info' },
        { from: 'WARN', to: 'ACTIVE', label: 'anyway', tone: 'warn' },
        { from: 'TREE', to: 'SET', label: 'makeWin', tone: 'ok' },
        { from: 'TREE', to: 'VIEW', label: 'openOrder', dashed: true },
        { from: 'ACTIVE', to: 'VIEW', label: '~reads' },
        { from: 'VIEW', to: 'SET', label: 'apply', tone: 'ok', thick: true },
        { from: 'VIEW', to: 'REAPPLY', label: 'repair', dashed: true },
        { from: 'SET', to: 'ACTIVE', label: '~writes' },
        { from: 'SET', to: 'REDEPLOY', label: 'changedHands', thick: true },
        { from: 'REAPPLY', to: 'REDEPLOY', label: 'allContested' },
        { from: 'REDEPLOY', to: 'GAME', thick: true },
    ],
};
