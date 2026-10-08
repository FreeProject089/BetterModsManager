import type { DiagramSpec } from '../diagram-spec.js';

// BMMScript is a COMPILER, not a second engine (commands/bmms.rs): text from the Code tab, a
// .bmmscript file or a code.run step is compiled to the same Step tree the blocks produce, and the
// scheduler's runner executes it. bmms_decompile prints a tree back as text, bmms_line_map maps
// lines to steps for the debugger, and scripts/gen-bmms-reference.mjs generates the vocabulary
// (completions, docs pages) from the scheduler's own action and condition lists.
export const bmmscriptFlow: DiagramSpec = {
    id: 'bmmscript-flow',
    i18n: 'docs.diagram.bmmscript-flow',
    category: 'automation',
    dir: 'TB',
    article: 'bmmscript',
    related: ['scheduler', 'mcp-server'],
    groups: [
        { id: 'WRITE', dir: 'LR' },
        { id: 'COMPILE' },
        { id: 'USE' },
    ],
    nodes: [
        { id: 'REF', kind: 'data', group: 'WRITE', icon: 'icon-list', refs: ['scripts/gen-bmms-reference.mjs', 'frontend/src/docs/bmms-reference.gen.ts › BMMS_INDEX'] },
        { id: 'CODE_TAB', kind: 'ui', group: 'WRITE', icon: 'icon-code', refs: ['frontend/src/features/settings/scheduler.ts › wireCodeMode', 'frontend/src/features/settings/bmms-complete.ts › mountCompletions', 'frontend/src/features/settings/bmms-prism.ts › registerBmmsLanguage'] },
        { id: 'FILE', kind: 'data', group: 'WRITE', icon: 'icon-file', refs: ['src-tauri/src/main.rs › register_bmmscript_association', 'src-tauri/src/main.rs › get_pending_script_file', 'frontend/src/features/settings/bmmscript-open.ts › openBmmScriptFile'] },
        { id: 'CODE_RUN', kind: 'front', group: 'WRITE', icon: 'icon-script', refs: ['frontend/src/features/settings/scheduler.ts › runAction', 'src-tauri/src/commands/bmms.rs › bmms_compile_steps'] },

        { id: 'LEX', kind: 'rust', group: 'COMPILE', icon: 'icon-cog', refs: ['src-tauri/src/commands/bmms.rs › bmms_compile', 'src-tauri/src/commands/bmms.rs › compile_with', 'src-tauri/src/commands/bmms.rs › lex'] },
        { id: 'OK', kind: 'decision', group: 'COMPILE', refs: ['src-tauri/src/commands/bmms.rs › Diagnostic', 'src-tauri/src/commands/bmms.rs › CompileOut'] },
        { id: 'TREE', kind: 'data', group: 'COMPILE', icon: 'icon-blocks', refs: ['src-tauri/src/commands/bmms.rs › CompileOut', 'frontend/src/features/settings/scheduler.ts › Step'] },
        { id: 'DECOMPILE', kind: 'rust', group: 'COMPILE', icon: 'icon-refresh', refs: ['src-tauri/src/commands/bmms.rs › bmms_decompile'] },
        { id: 'LINEMAP', kind: 'rust', group: 'COMPILE', icon: 'icon-pin', refs: ['src-tauri/src/commands/bmms.rs › bmms_line_map', 'frontend/src/features/settings/sched-debug-map.ts › debugTargetFor'] },

        { id: 'REVIEW', kind: 'ui', group: 'USE', icon: 'icon-shield', refs: ['frontend/src/features/settings/bmmscript-open.ts › showReview', 'frontend/src/features/settings/bmmpa-inspect.ts › grantedPermissions'] },
        { id: 'SAVED', kind: 'data', group: 'USE', icon: 'icon-database', refs: ['frontend/src/features/settings/scheduler.ts › importTaskObject', 'src-tauri/src/commands/scheduler.rs › save_schedules'] },
        { id: 'RUNNER', kind: 'front', group: 'USE', icon: 'icon-play', link: 'scheduler', refs: ['frontend/src/features/settings/scheduler.ts › runSteps', 'frontend/src/features/settings/scheduler.ts › runTaskOnce'] },
    ],
    edges: [
        { from: 'REF', to: 'CODE_TAB', label: 'completions', dashed: true },
        { from: 'CODE_TAB', to: 'LEX', label: 'leaveCode', thick: true },
        { from: 'FILE', to: 'LEX', label: 'open', tone: 'info' },
        { from: 'CODE_RUN', to: 'LEX', label: 'atRunTime', dashed: true },

        { from: 'LEX', to: 'OK', thick: true },
        { from: 'OK', to: 'TREE', label: '~yes', tone: 'ok', thick: true },
        { from: 'OK', to: 'CODE_TAB', label: 'lineCol', tone: 'danger' },
        { from: 'TREE', to: 'DECOMPILE', label: 'openCode', dashed: true },
        { from: 'DECOMPILE', to: 'CODE_TAB' },
        { from: 'CODE_TAB', to: 'LINEMAP', label: 'debugger', dashed: true },

        { from: 'TREE', to: 'SAVED', label: 'save', thick: true },
        { from: 'TREE', to: 'REVIEW', label: 'fromFile', tone: 'info' },
        { from: 'REVIEW', to: 'RUNNER', label: 'runOnce', tone: 'warn' },
        { from: 'REVIEW', to: 'SAVED', label: 'addDisabled', tone: 'ok' },
        { from: 'SAVED', to: 'RUNNER', thick: true },
        { from: 'RUNNER', to: 'CODE_RUN', label: 'codeRun', dashed: true },
    ],
};
