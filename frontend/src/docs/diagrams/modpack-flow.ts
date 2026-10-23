import type { DiagramSpec } from '../diagram-spec.js';

// Modpacks (commands/modpack.rs, features/mods/modpack-creator.ts, modpack-plan-model.ts): a pack
// is a JSON file in AppData/modpacks/ listing mods by local id AND by content hash (a per-file
// BLAKE3 manifest), so it can be matched on another PC. Exported as a signed .bmp, imported from
// a file or a catalogue under a new id. Applying it checks integrity (unless the pack skips it),
// offers repairs, turns the found mods on (the per-mod work is mod-activation), then places the
// pack's block in the profile's activation order.
export const modpackFlow: DiagramSpec = {
    id: 'modpack-flow',
    i18n: 'docs.diagram.modpack-flow',
    category: 'mods',
    dir: 'TB',
    article: 'modpacks',
    related: ['mod-activation', 'integrity-engine', 'conflict-management', 'blake3-hashing'],
    groups: [
        { id: 'BUILD' },
        { id: 'SHARE', dir: 'LR' },
        { id: 'APPLY' },
    ],
    nodes: [
        { id: 'EDITOR', kind: 'ui', group: 'BUILD', icon: 'icon-edit', refs: ['frontend/src/features/mods/modpack-creator.ts', 'src-tauri/src/models/modpack.rs › LocalModpack'] },
        { id: 'MOD_REF', kind: 'rust', group: 'BUILD', icon: 'icon-integrity', refs: ['src-tauri/src/commands/modpack.rs › build_modpack_mod_ref', 'src-tauri/src/models/modpack.rs › ModpackModRef'], link: 'blake3-hashing' },
        { id: 'PACK_FILE', kind: 'data', group: 'BUILD', icon: 'icon-file', refs: ['src-tauri/src/commands/modpack.rs › save_modpack', 'src-tauri/src/commands/modpack.rs › load_modpacks'] },

        { id: 'EXPORT', kind: 'rust', group: 'SHARE', icon: 'icon-export', refs: ['src-tauri/src/commands/modpack.rs › export_modpack', 'src-tauri/src/commands/doc_sign.rs › sign_doc'] },
        { id: 'IMPORT', kind: 'rust', group: 'SHARE', icon: 'icon-import', refs: ['src-tauri/src/commands/modpack.rs › import_modpack', 'src-tauri/src/commands/modpack.rs › install_modpack_from_url', 'src-tauri/src/commands/modpack_catalog.rs › install_from_modpack_catalog'] },

        { id: 'SWITCH', kind: 'ui', group: 'APPLY', icon: 'icon-toggle', refs: ['frontend/src/features/mods/modpack-creator.ts', 'frontend/src/features/mods/modpack-plan-model.ts › planModpack'] },
        { id: 'MATCH', kind: 'rust', group: 'APPLY', icon: 'icon-search', refs: ['src-tauri/src/commands/mods.rs › find_local_mods_by_hashes', 'frontend/src/features/mods/modpack-plan-model.ts › findLocal'] },
        { id: 'ANY_ON', kind: 'decision', group: 'APPLY', refs: ['frontend/src/features/mods/modpack-plan-model.ts › planModpack'] },
        { id: 'CHECK', kind: 'decision', group: 'APPLY', refs: ['src-tauri/src/commands/modpack.rs › check_modpack_integrity', 'src-tauri/src/fs_utils.rs › file_matches_hash'] },
        { id: 'REPAIR', kind: 'ui', group: 'APPLY', icon: 'icon-download', refs: ['src-tauri/src/commands/modpack.rs › repair_modpack_mod'] },
        { id: 'TOGGLE', kind: 'front', group: 'APPLY', icon: 'icon-flow', refs: ['src-tauri/src/commands/mods.rs › enable_mod', 'src-tauri/src/commands/mods.rs › disable_mod'], link: 'mod-activation' },
        { id: 'ORDER', kind: 'rust', group: 'APPLY', icon: 'icon-priority', refs: ['src-tauri/src/commands/order_share.rs › mod_order_arrange', 'frontend/src/features/profiles/load-order.ts › arrangeBlock'] },
        { id: 'RESULT', kind: 'outcome', group: 'APPLY', icon: 'icon-check', refs: ['frontend/src/features/mods/modpack-creator.ts'] },
    ],
    edges: [
        { from: 'EDITOR', to: 'MOD_REF', label: 'perMod', thick: true },
        { from: 'MOD_REF', to: 'PACK_FILE', label: '~writes', thick: true },
        { from: 'PACK_FILE', to: 'EXPORT', label: 'bmp', dashed: true },
        { from: 'IMPORT', to: 'PACK_FILE', label: 'newId', tone: 'info' },
        { from: 'PACK_FILE', to: 'SWITCH', label: '~reads', thick: true },
        { from: 'SWITCH', to: 'MATCH', thick: true },
        { from: 'MATCH', to: 'ANY_ON', thick: true },
        { from: 'ANY_ON', to: 'TOGGLE', label: 'deactivate', tone: 'warn' },
        { from: 'ANY_ON', to: 'CHECK', label: 'activate', tone: 'ok', thick: true },
        { from: 'CHECK', to: 'TOGGLE', label: '~valid', tone: 'ok', thick: true },
        { from: 'CHECK', to: 'REPAIR', label: 'missingOrBad', tone: 'danger' },
        { from: 'REPAIR', to: 'TOGGLE', label: 'repaired', tone: 'ok' },
        { from: 'TOGGLE', to: 'ORDER', label: 'afterOn', tone: 'info' },
        { from: 'ORDER', to: 'RESULT', thick: true },
        { from: 'TOGGLE', to: 'RESULT', label: 'afterOff', dashed: true },
    ],
};
