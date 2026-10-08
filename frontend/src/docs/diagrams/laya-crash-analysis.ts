import type { DiagramSpec } from '../diagram-spec.js';

// Laya on crash reports and bug reports (commands/ai_assist.rs, features/ai/laya-crash.ts,
// features/ai/laya-assist.ts). The crash manager reads a masked excerpt of each crash zip, groups
// the same failures, and on a click asks Laya for a probable cause in two levels (family, then
// cause) blended with keyword evidence and judged by the « crashes » answer settings. Local engines
// only (embedded or the user's laya-serve); « Expliquer » is the one written answer, and only with
// a generator the user configured.
export const layaCrashAnalysis: DiagramSpec = {
    id: 'laya-crash-analysis',
    i18n: 'docs.diagram.laya-crash-analysis',
    category: 'laya',
    dir: 'TB',
    article: 'ai-optional',
    related: ['laya-pipeline', 'crash-reporting', 'scheduler'],
    groups: [
        { id: 'READ' },
        { id: 'LABEL' },
        { id: 'SHOW', dir: 'LR' },
    ],
    nodes: [
        { id: 'MANAGER', kind: 'ui', icon: 'icon-list', refs: ['frontend/src/features/ai/laya-crash.ts › mountCrashInsights', 'frontend/src/features/settings/crash-manager.ts › initCrashManager'] },

        { id: 'DIGESTS', kind: 'rust', group: 'READ', icon: 'icon-file', refs: ['src-tauri/src/commands/ai_assist.rs › ai_crash_digests', 'src-tauri/src/commands/ai_assist.rs › excerpt_of', 'src-tauri/src/commands/ai_assist.rs › crash_excerpt'] },
        { id: 'OFF', kind: 'outcome', group: 'READ', icon: 'icon-lock', refs: ['src-tauri/src/commands/ai_assist.rs › local_provider'] },
        { id: 'GROUPS', kind: 'front', group: 'READ', icon: 'icon-group', refs: ['frontend/src/features/ai/laya-assist-model.ts › groupCrashes', 'frontend/src/features/ai/laya-assist-model.ts › crashSignature'] },

        { id: 'LABEL_CALL', kind: 'rust', group: 'LABEL', icon: 'icon-brain', refs: ['src-tauri/src/commands/ai_assist.rs › ai_crash_label', 'src-tauri/src/commands/ai_assist.rs › MAX_LABEL_PATHS'] },
        { id: 'CACHED', kind: 'decision', group: 'LABEL', refs: ['src-tauri/src/commands/ai_assist.rs › cache_key', 'src-tauri/src/commands/ai_assist.rs › CACHE_MAX'] },
        { id: 'QUESTIONS', kind: 'rust', group: 'LABEL', icon: 'icon-list', refs: ['src-tauri/src/commands/ai_assist.rs › cause_questions', 'src-tauri/src/commands/ai_assist.rs › CRASH_FAMILIES', 'src-tauri/src/commands/ai_assist.rs › CRASH_CAUSES'] },
        { id: 'BLEND', kind: 'rust', group: 'LABEL', icon: 'icon-compare', refs: ['src-tauri/src/commands/ai_assist.rs › combine_cause', 'src-tauri/src/commands/ai_assist.rs › lexical_cause', 'src-tauri/src/commands/ai_assist.rs › blend_cause'] },
        { id: 'DECIDE', kind: 'decision', group: 'LABEL', icon: 'icon-scales', refs: ['src-tauri/src/commands/ai_assist.rs › decide_single', 'src-tauri/src/commands/ai_tuning.rs › Crashes'] },

        { id: 'CHIPS', kind: 'ui', group: 'SHOW', icon: 'icon-pin', refs: ['frontend/src/features/ai/laya-assist-model.ts › spreadLabels', 'frontend/src/features/ai/laya-assist-model.ts › familyCounts', 'src-tauri/src/commands/ai_assist.rs › cause_evidence'] },
        { id: 'TASKS', kind: 'front', group: 'SHOW', icon: 'icon-time', refs: ['frontend/src/features/ai/laya-crash-events.ts › announceCrashLabels', 'src-tauri/src/commands/ai_ops.rs › ai_task_crash_label'] },
        { id: 'EXPLAIN', kind: 'ui', group: 'SHOW', icon: 'icon-message', refs: ['frontend/src/features/ai/laya-crash.ts › mountExplain', 'src-tauri/src/commands/ai_assist.rs › ai_crash_explain', 'frontend/src/features/ai/laya-explain-md.ts › explainHtml'] },
        { id: 'GENERATOR', kind: 'ext', group: 'SHOW', icon: 'icon-edit', refs: ['src-tauri/src/commands/ai_core.rs › gen_target', 'src-tauri/src/commands/ai_core.rs › chat'] },

        { id: 'FEEDBACK', kind: 'ui', icon: 'icon-message', refs: ['frontend/src/features/ai/laya-assist.ts › mountReportAssist', 'src-tauri/src/commands/ai_assist.rs › ai_report_assist', 'frontend/src/features/ai/laya-assist-model.ts › bestCrashFor'] },
    ],
    edges: [
        { from: 'MANAGER', to: 'DIGESTS', label: '~invoke', thick: true },
        { from: 'DIGESTS', to: 'OFF', label: '~refused', tone: 'danger' },
        { from: 'DIGESTS', to: 'GROUPS', label: 'maskedExcerpts', tone: 'ok', thick: true },
        { from: 'GROUPS', to: 'LABEL_CALL', label: 'onePerGroup', thick: true },
        { from: 'LABEL_CALL', to: 'CACHED' },
        { from: 'CACHED', to: 'CHIPS', label: '~yes', tone: 'ok', dashed: true },
        { from: 'CACHED', to: 'QUESTIONS', label: '~no', tone: 'info', thick: true },
        { from: 'QUESTIONS', to: 'BLEND', thick: true },
        { from: 'BLEND', to: 'DECIDE', thick: true },
        { from: 'DECIDE', to: 'CHIPS', label: 'causeOrUnknown', thick: true },
        { from: 'CHIPS', to: 'TASKS', label: '~event', dashed: true },
        { from: 'GROUPS', to: 'EXPLAIN', label: 'generatorSet', tone: 'warn', dashed: true },
        { from: 'EXPLAIN', to: 'GENERATOR', label: 'excerptOnly', tone: 'warn' },
        { from: 'FEEDBACK', to: 'DIGESTS', label: 'matchCrash', dashed: true },
    ],
};
