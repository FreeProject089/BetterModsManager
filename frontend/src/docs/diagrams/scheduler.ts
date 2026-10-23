import type { DiagramSpec } from '../diagram-spec.js';

// The scheduler as it runs today: the engine is front-end (features/settings/scheduler.ts), a
// 20-second tick over the tasks of schedules.json; a task's steps run in one context with its
// variables, gated actions need their own grant, and the few things that reach outside BMM run in
// Rust (custom scripts, webhooks and feeds in sched_net.rs, the Laya steps in ai_ops.rs). Every run
// ends in the task's history, its run log (sched_runs.rs) and a bmm.task.done event.
export const scheduler: DiagramSpec = {
    id: 'scheduler',
    i18n: 'docs.diagram.scheduler',
    category: 'automation',
    dir: 'TB',
    article: 'scheduler',
    related: ['bmmscript-flow', 'mcp-server', 'laya-pipeline', 'mod-activation'],
    groups: [
        { id: 'DEFINE', dir: 'LR' },
        { id: 'WHEN' },
        { id: 'EXECUTE' },
        { id: 'DO', dir: 'LR' },
    ],
    nodes: [
        { id: 'EDITOR', kind: 'ui', group: 'DEFINE', icon: 'icon-edit', refs: ['frontend/src/features/settings/scheduler.ts › openTaskModal', 'frontend/src/features/settings/sched-flow.ts › mountFlow', 'frontend/src/features/settings/scheduler.ts › sanitiseImportedTask'] },
        { id: 'TASKS', kind: 'data', group: 'DEFINE', icon: 'icon-database', refs: ['src-tauri/src/commands/scheduler.rs › get_schedules', 'src-tauri/src/commands/scheduler.rs › save_schedules', 'frontend/src/features/settings/scheduler.ts › loadTasks'] },

        { id: 'TICK', kind: 'front', group: 'WHEN', icon: 'icon-time', refs: ['frontend/src/features/settings/scheduler.ts › startEngine', 'frontend/src/features/settings/scheduler.ts › tick', 'frontend/src/features/settings/scheduler.ts › isDue'] },
        { id: 'OS_TASK', kind: 'ext', group: 'WHEN', icon: 'icon-server', refs: ['src-tauri/src/commands/scheduler.rs › register_os_schedule', 'frontend/src/features/settings/scheduler.ts › syncOsSchedule'] },
        { id: 'MANUAL', kind: 'ui', group: 'WHEN', icon: 'icon-play', refs: ['frontend/src/features/settings/scheduler.ts › runTaskById', 'frontend/src/core/deep_link_manager.ts › findTask'] },
        { id: 'GAME_HOLD', kind: 'decision', group: 'WHEN', refs: ['frontend/src/features/settings/sched-why.ts › gameHoldsTasks'] },

        { id: 'RUN', kind: 'front', group: 'EXECUTE', icon: 'icon-flow', refs: ['frontend/src/features/settings/scheduler.ts › runTask', 'frontend/src/features/settings/sched-vars.ts › RunCtx'] },
        { id: 'STEPS', kind: 'front', group: 'EXECUTE', icon: 'icon-list', refs: ['frontend/src/features/settings/scheduler.ts › runSteps', 'frontend/src/features/settings/scheduler.ts › waitForCondition', 'frontend/src/features/settings/scheduler.ts › evalCondition'] },
        { id: 'ACTION', kind: 'front', group: 'EXECUTE', icon: 'icon-bolt', refs: ['frontend/src/features/settings/scheduler.ts › runAction', 'frontend/src/features/settings/scheduler.ts › recordedAction', 'frontend/src/features/settings/scheduler.ts › ACTION_TYPES'] },
        { id: 'PERMS', kind: 'decision', group: 'EXECUTE', icon: 'icon-lock', refs: ['frontend/src/features/settings/scheduler.ts › requirePerm', 'frontend/src/features/settings/scheduler.ts › hasPerm', 'frontend/src/features/settings/scheduler.ts › TaskPerms'] },

        { id: 'EXEC', kind: 'rust', group: 'DO', icon: 'icon-terminal', refs: ['src-tauri/src/commands/scheduler.rs › run_scheduled_script_full', 'src-tauri/src/commands/sched_net.rs › sched_webhook', 'src-tauri/src/commands/sched_net.rs › sched_feed_fetch'] },
        { id: 'LAYA', kind: 'rust', group: 'DO', icon: 'icon-brain', refs: ['frontend/src/features/settings/scheduler.ts › aiCall', 'frontend/src/features/settings/sched-ai.ts › AI_MAX_STEPS', 'src-tauri/src/commands/ai_ops.rs › ai_task_classify'] },

        { id: 'RESULT', kind: 'outcome', icon: 'icon-check', refs: ['src-tauri/src/commands/sched_runs.rs › sched_run_append', 'frontend/src/features/settings/sched-runlog.ts › finishRun', 'frontend/src/core/bmm-events.ts › fireEvent'] },
    ],
    edges: [
        { from: 'EDITOR', to: 'TASKS', label: '~writes', thick: true },
        { from: 'TASKS', to: 'TICK', label: '~reads', thick: true },
        { from: 'TICK', to: 'GAME_HOLD', label: 'due', tone: 'info', thick: true },
        { from: 'GAME_HOLD', to: 'TICK', label: 'owed', tone: 'warn', dashed: true },
        { from: 'GAME_HOLD', to: 'RUN', label: '~no', tone: 'ok', thick: true },
        { from: 'OS_TASK', to: 'MANUAL', label: 'link', dashed: true },
        { from: 'MANUAL', to: 'RUN', label: 'runNow', tone: 'info' },

        { from: 'RUN', to: 'STEPS', thick: true },
        { from: 'STEPS', to: 'ACTION', thick: true },
        { from: 'ACTION', to: 'STEPS', label: '~next', dashed: true },
        { from: 'ACTION', to: 'PERMS', label: 'gated', tone: 'info' },
        { from: 'PERMS', to: 'EXEC', label: 'granted', tone: 'ok' },
        { from: 'PERMS', to: 'LAYA', label: 'granted', tone: 'ok' },
        { from: 'PERMS', to: 'RESULT', label: '~refused', tone: 'danger' },
        { from: 'STEPS', to: 'RESULT', label: 'end', thick: true },
        { from: 'RESULT', to: 'TICK', label: 'afterTask', dashed: true },
    ],
};
