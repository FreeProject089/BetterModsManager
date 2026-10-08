import type { DiagramSpec } from '../diagram-spec.js';

// Laya as it runs today: a multilingual CLASSIFIER (it picks among options it is given, or gives
// P(true); it never writes text). Every call goes through ai_core::gate (master switch off by
// default, `--no-ai` / BMM_NO_AI, per-feature toggles, the provider), then ai_laya builds the
// questions, one of three engines answers (the embedded ONNX pack, the user's laya-serve,
// BetterCommunity), and ai_tuning decides what the probabilities mean per area. An optional
// generator (ai_hybrid) may word a draft, always re-checked. Nothing is applied without a click.
export const layaPipeline: DiagramSpec = {
    id: 'laya-pipeline',
    i18n: 'docs.diagram.laya-pipeline',
    category: 'laya',
    dir: 'TB',
    article: 'ai-optional',
    related: ['laya-crash-analysis', 'semantic-search', 'scheduler', 'mcp-server'],
    groups: [
        { id: 'ASK', dir: 'LR' },
        { id: 'RULES' },
        { id: 'ENGINES', dir: 'LR' },
        { id: 'ANSWER' },
    ],
    nodes: [
        { id: 'SETTINGS', kind: 'ui', group: 'ASK', icon: 'icon-settings', refs: ['frontend/src/features/ai/laya-hub.ts › openLaya', 'src-tauri/src/commands/ai.rs › ai_save_settings', 'src-tauri/src/commands/ai_core.rs › SETTINGS_FILE'] },
        { id: 'FEATURES', kind: 'ui', group: 'ASK', icon: 'icon-brain', refs: ['frontend/src/features/ai/ai-suggest.ts › openAiSuggest', 'frontend/src/features/ai/ai-library.ts › openAnalyzeLibrary', 'src-tauri/src/commands/ai.rs › ai_suggest_mod_metadata'] },
        { id: 'PROGRAMS', kind: 'rust', group: 'ASK', icon: 'icon-script', refs: ['src-tauri/src/commands/ai_ops.rs › guard', 'src-tauri/src/commands/ai_ops.rs › PER_MINUTE', 'src-tauri/src/commands/ai_api_core.rs › DEFAULT_PORT'] },

        { id: 'EXTRACT', kind: 'rust', group: 'RULES', icon: 'icon-file', refs: ['src-tauri/src/commands/ai_core.rs › extract', 'src-tauri/src/commands/ai_core.rs › gather_detailed'] },
        { id: 'GATE', kind: 'decision', group: 'RULES', icon: 'icon-lock', refs: ['src-tauri/src/commands/ai_core.rs › gate', 'src-tauri/src/commands/ai_core.rs › kill_switch', 'src-tauri/src/commands/ai_core.rs › effective_settings'] },
        { id: 'BLOCKED', kind: 'outcome', group: 'RULES', icon: 'icon-stop', refs: ['src-tauri/src/commands/ai_core.rs › Blocked'] },
        { id: 'QUESTIONS', kind: 'rust', group: 'RULES', icon: 'icon-list', refs: ['src-tauri/src/commands/ai_laya.rs › CONCEPTS', 'src-tauri/src/commands/ai_laya.rs › MAX_CHOICE', 'src-tauri/src/commands/ai_core.rs › neutralize'] },

        { id: 'EMBEDDED', kind: 'rust', group: 'ENGINES', icon: 'icon-cpu', refs: ['src-tauri/src/commands/ai_embedded.rs › predict', 'src-tauri/src/commands/ai_embedded.rs › IDLE_UNLOAD', 'src-tauri/src/commands/ai_embedded.rs › INTRA_OP_THREADS'] },
        { id: 'PACK', kind: 'data', group: 'ENGINES', icon: 'icon-package', refs: ['src-tauri/src/commands/ai_embedded.rs › find_model_dir', 'src-tauri/src/commands/ai_embedded.rs › install_user_copy', 'scripts/check-laya-pins.mjs', 'laya-model.lock.json'] },
        { id: 'LAYA_SERVE', kind: 'ext', group: 'ENGINES', icon: 'icon-server', refs: ['src-tauri/src/commands/ai_core.rs › ask_laya', 'src-tauri/src/commands/ai_core.rs › DEFAULT_LOCAL_URL', 'src-tauri/src/commands/ai_core.rs › validate_url'] },
        { id: 'BC', kind: 'ext', group: 'ENGINES', icon: 'icon-cloud', refs: ['src-tauri/src/commands/ai_core.rs › bc_suggest', 'src-tauri/src/commands/ai_core.rs › classify_mod_in', 'src-tauri/src/commands/ai_core.rs › triage_report'] },

        { id: 'TUNING', kind: 'rust', group: 'ANSWER', icon: 'icon-scales', refs: ['src-tauri/src/commands/ai_tuning.rs › decide', 'src-tauri/src/commands/ai_tuning.rs › builtin', 'frontend/src/features/ai/ai-tuning.ts › mountLayaTuning'] },
        { id: 'GENERATOR', kind: 'ext', group: 'ANSWER', icon: 'icon-edit', refs: ['src-tauri/src/commands/ai_hybrid.rs › draft_mod', 'src-tauri/src/commands/ai_hybrid.rs › check_generated', 'src-tauri/src/commands/ai_core.rs › chat'] },
        { id: 'CALL_LOG', kind: 'data', group: 'ANSWER', icon: 'icon-history', refs: ['src-tauri/src/commands/ai_core.rs › record_laya_call', 'src-tauri/src/commands/ai_core.rs › LAYA_CALLS_KEPT', 'frontend/src/features/ai/laya-debug.ts › mountLayaDebug'] },
        { id: 'PROPOSALS', kind: 'outcome', group: 'ANSWER', icon: 'icon-check', refs: ['src-tauri/src/commands/ai.rs › ai_apply_mod_metadata', 'src-tauri/src/commands/ai_core.rs › build_patch'] },
    ],
    edges: [
        { from: 'SETTINGS', to: 'GATE', label: '~reads', dashed: true },
        { from: 'FEATURES', to: 'EXTRACT', thick: true },
        { from: 'PROGRAMS', to: 'GATE', label: 'tasksApi' },
        { from: 'EXTRACT', to: 'GATE', thick: true },
        { from: 'EXTRACT', to: 'PROPOSALS', label: 'filesOnly', tone: 'info', dashed: true },
        { from: 'GATE', to: 'BLOCKED', label: '~refused', tone: 'danger' },
        { from: 'GATE', to: 'QUESTIONS', label: 'classifier', tone: 'ok', thick: true },
        { from: 'GATE', to: 'BC', label: 'bcConsent', tone: 'warn', dashed: true },
        { from: 'GATE', to: 'GENERATOR', label: 'generator', tone: 'warn', dashed: true },

        { from: 'QUESTIONS', to: 'EMBEDDED', label: 'embedded', tone: 'ok', thick: true },
        { from: 'QUESTIONS', to: 'LAYA_SERVE', label: 'local', tone: 'info' },
        { from: 'PACK', to: 'EMBEDDED', label: 'load' },

        { from: 'EMBEDDED', to: 'TUNING', thick: true },
        { from: 'LAYA_SERVE', to: 'TUNING' },
        { from: 'BC', to: 'PROPOSALS', label: 'fixedCut', tone: 'warn' },
        { from: 'EMBEDDED', to: 'CALL_LOG', label: 'noText', dashed: true },
        { from: 'LAYA_SERVE', to: 'CALL_LOG', dashed: true },
        { from: 'TUNING', to: 'PROPOSALS', thick: true },
        { from: 'GENERATOR', to: 'PROPOSALS', label: 'checked', tone: 'warn' },
    ],
};
