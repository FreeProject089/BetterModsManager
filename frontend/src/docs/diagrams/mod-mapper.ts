import type { DiagramSpec } from '../diagram-spec.js';

// The Mapper, as it works today: two trees side by side (the mod, the game folder, both read by
// mapper.rs get_directory_tree), moves queued as a draft in mapper.ts, an optional final preview
// (mapper-preview-model.ts), then Save writes them inside the MOD folder only (create, move,
// delete). An archived mod is browsable but must be unpacked first (mod_archive.rs), and can be
// zipped again afterwards. Nothing here touches the game folder: that is enabling (mod-activation).
export const modMapper: DiagramSpec = {
    id: 'mod-mapper',
    i18n: 'docs.diagram.mod-mapper',
    category: 'mods',
    dir: 'TB',
    article: 'mod-structure',
    related: ['mod-architecture', 'mod-activation', 'mod-import'],
    groups: [
        { id: 'READ', dir: 'LR' },
        { id: 'DRAFT' },
        { id: 'SAVE' },
    ],
    nodes: [
        { id: 'MOD_TREE', kind: 'ui', group: 'READ', icon: 'icon-folder', refs: ['frontend/src/features/mapper/mapper.ts › refreshModTree', 'src-tauri/src/commands/mapper.rs › get_directory_tree', 'src-tauri/src/archive.rs › mod_read_root'] },
        { id: 'GAME_TREE', kind: 'ui', group: 'READ', icon: 'icon-app', refs: ['frontend/src/features/mapper/mapper.ts › refreshGameTree', 'src-tauri/src/commands/mapper.rs › get_directory_tree'] },

        { id: 'PICK', kind: 'ui', group: 'DRAFT', icon: 'icon-edit', refs: ['frontend/src/features/mapper/mapper.ts › queueMoveSelectedOrRoot', 'frontend/src/features/mapper/mapper.ts › queueMoveTo'] },
        { id: 'QUEUE', kind: 'front', group: 'DRAFT', icon: 'icon-list', refs: ['frontend/src/features/mapper/mapper.ts › pendingMoves', 'frontend/src/features/mapper/mapper.ts › pendingChangeCount'] },
        { id: 'PREVIEW', kind: 'ui', group: 'DRAFT', icon: 'icon-search', refs: ['frontend/src/features/mapper/mapper.ts › showMapperPreview', 'frontend/src/features/mapper/mapper-preview-model.ts › buildPreview'] },

        { id: 'ARCHIVED', kind: 'decision', group: 'SAVE', refs: ['frontend/src/features/mapper/mapper.ts › ensureModWritable', 'src-tauri/src/commands/mod_archive.rs › is_mod_archived'] },
        { id: 'UNPACK', kind: 'rust', group: 'SAVE', icon: 'icon-archive', refs: ['src-tauri/src/commands/mod_archive.rs › unarchive_mod'] },
        { id: 'APPLY', kind: 'rust', group: 'SAVE', icon: 'icon-patch', refs: ['frontend/src/features/mapper/mapper.ts › applyAllChanges', 'src-tauri/src/commands/mapper.rs › restructure_mod_item', 'src-tauri/src/commands/mapper.rs › move_into'] },
        { id: 'REZIP', kind: 'rust', group: 'SAVE', icon: 'icon-box', refs: ['frontend/src/features/mapper/mapper.ts › restoreArchiveIfAsked', 'src-tauri/src/commands/mod_archive.rs › rearchive_mod'] },
        { id: 'MOD_DIR', kind: 'data', group: 'SAVE', icon: 'icon-disk', refs: ['src-tauri/src/commands/mapper.rs › write_root', 'src-tauri/src/commands/mods.rs › invalidate_cache'] },
        { id: 'READY', kind: 'outcome', icon: 'icon-check', link: 'mod-activation', refs: ['src-tauri/src/commands/mods.rs › enable_mod'] },
    ],
    edges: [
        { from: 'MOD_TREE', to: 'PICK', label: 'select', tone: 'info' },
        { from: 'GAME_TREE', to: 'PICK', label: 'dblClick', tone: 'info', thick: true },
        { from: 'PICK', to: 'QUEUE', thick: true },
        { from: 'QUEUE', to: 'PREVIEW', label: 'check', dashed: true },
        { from: 'QUEUE', to: 'ARCHIVED', label: 'save', thick: true },
        { from: 'PREVIEW', to: 'ARCHIVED', label: 'save' },
        { from: 'ARCHIVED', to: 'UNPACK', label: '~yes', tone: 'warn' },
        { from: 'ARCHIVED', to: 'APPLY', label: '~no', tone: 'ok', thick: true },
        { from: 'UNPACK', to: 'APPLY' },
        { from: 'APPLY', to: 'MOD_DIR', label: '~writes', thick: true },
        { from: 'MOD_DIR', to: 'REZIP', label: 'keepZip', dashed: true },
        { from: 'MOD_DIR', to: 'READY', thick: true },
        { from: 'REZIP', to: 'READY' },
    ],
};
