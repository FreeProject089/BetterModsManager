import type { DiagramSpec } from '../diagram-spec.js';

// The integrity engine as it runs today: a per-file baseline (file_hashes, BLAKE3) is built by the
// background SHA worker (commands/mods.rs: a normal queue + a priority queue, one mod at a time), a
// check re-reads one mod and compares (get_mod_integrity, driven by the Integrity center,
// features/settings/integrity-center.ts), and "require valid SHA" makes enable_mod refuse a mod
// that has no baseline (MISSING_SHA), which the library turns into a question (askMissingHash).
export const integrityEngine: DiagramSpec = {
    id: 'integrity-engine',
    i18n: 'docs.diagram.integrity-engine',
    category: 'integrity',
    dir: 'TB',
    article: 'integrity-engine',
    related: ['blake3-hashing', 'mtime-cache', 'mod-activation', 'security-system'],
    groups: [
        { id: 'BASE' },
        { id: 'CHECK' },
        { id: 'GUARD' },
    ],
    nodes: [
        { id: 'QUEUE', kind: 'rust', group: 'BASE', icon: 'icon-list', refs: ['src-tauri/src/commands/mods.rs › populate_sha_queue', 'src-tauri/src/commands/mods.rs › trigger_sha_background_population', 'src-tauri/src/commands/mods.rs › recalculate_all_hashes'] },
        { id: 'PRIORITY', kind: 'rust', group: 'BASE', icon: 'icon-priority', refs: ['src-tauri/src/commands/mods.rs › add_mod_to_priority_sha_queue'] },
        { id: 'WORKER', kind: 'rust', group: 'BASE', icon: 'icon-cpu', refs: ['src-tauri/src/commands/mods.rs › start_sha_calculation_background', 'src-tauri/src/commands/mods.rs › process_single_mod_hashing', 'src-tauri/src/commands/mods.rs › recalculate_mod_sha'] },
        { id: 'BASELINE', kind: 'data', group: 'BASE', icon: 'icon-key', link: 'blake3-hashing', refs: ['src-tauri/src/models/mod_entry.rs › file_hashes', 'src-tauri/src/fs_utils.rs › compute_file_hash_bulk_ticketed'] },

        { id: 'CENTER', kind: 'ui', group: 'CHECK', icon: 'icon-integrity', refs: ['frontend/src/features/settings/integrity-center.ts › openIntegrityCenter', 'frontend/src/features/settings/integrity-model.ts › stateOf'] },
        { id: 'VERIFY', kind: 'rust', group: 'CHECK', icon: 'icon-verify', refs: ['src-tauri/src/commands/mods.rs › get_mod_integrity', 'src-tauri/src/commands/mods.rs › IntegrityWork'] },
        { id: 'COMPARE', kind: 'decision', group: 'CHECK', refs: ['src-tauri/src/fs_utils.rs › file_matches_hash', 'src-tauri/src/commands/mods.rs › IntegrityReport'] },
        { id: 'VERIFIED', kind: 'outcome', group: 'CHECK', icon: 'icon-check', refs: ['src-tauri/src/commands/mods.rs › get_mod_integrity', 'frontend/src/features/settings/integrity-model.ts › stateOf'] },
        { id: 'MISMATCH', kind: 'outcome', group: 'CHECK', icon: 'icon-warning', refs: ['src-tauri/src/models/mod_entry.rs › file_hashes_invalid', 'frontend/src/features/settings/integrity-center.ts › rehashMany'] },

        { id: 'ENABLE', kind: 'rust', group: 'GUARD', icon: 'icon-toggle', link: 'mod-activation', refs: ['src-tauri/src/commands/mods.rs › enable_mod_in', 'src-tauri/src/state.rs › require_valid_sha'] },
        { id: 'STRICT', kind: 'decision', group: 'GUARD', refs: ['src-tauri/src/commands/mods.rs › enable_mod_in'] },
        { id: 'ASK', kind: 'ui', group: 'GUARD', icon: 'icon-help', refs: ['frontend/src/features/mods/integrity-report.ts › askMissingHash', 'frontend/src/features/mods/mods-list.ts › askMissingHash'] },
        { id: 'ACTIVATE', kind: 'outcome', group: 'GUARD', icon: 'icon-play', link: 'mod-activation', refs: ['src-tauri/src/commands/mods.rs › enable_mod', 'frontend/src/core/activation-jobs.ts › runActivationJob'] },
    ],
    edges: [
        { from: 'QUEUE', to: 'WORKER', thick: true },
        { from: 'PRIORITY', to: 'WORKER', label: 'first', tone: 'info' },
        { from: 'WORKER', to: 'BASELINE', label: '~writes', thick: true },

        { from: 'CENTER', to: 'VERIFY', label: 'perMod', tone: 'info', thick: true },
        { from: 'VERIFY', to: 'BASELINE', label: 'noBaseline', tone: 'warn', dashed: true },
        { from: 'BASELINE', to: 'COMPARE', label: '~reads' },
        { from: 'VERIFY', to: 'COMPARE', thick: true },
        { from: 'COMPARE', to: 'VERIFIED', label: 'same', tone: 'ok' },
        { from: 'COMPARE', to: 'MISMATCH', label: 'changed', tone: 'danger' },
        { from: 'MISMATCH', to: 'WORKER', label: 'rehash', tone: 'warn', dashed: true },

        { from: 'ENABLE', to: 'STRICT', thick: true },
        { from: 'STRICT', to: 'ACTIVATE', label: '~no', tone: 'ok', thick: true },
        { from: 'STRICT', to: 'ASK', label: 'missingSha', tone: 'warn' },
        { from: 'ASK', to: 'ACTIVATE', label: 'anyway', tone: 'warn', dashed: true },
        { from: 'ASK', to: 'WORKER', label: 'hashFirst', tone: 'info', dashed: true },
        { from: 'ENABLE', to: 'PRIORITY', label: 'noHash', dashed: true },
    ],
};
