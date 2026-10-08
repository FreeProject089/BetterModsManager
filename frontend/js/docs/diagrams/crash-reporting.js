// How a crash report is made, as the code runs today (commands/crash.rs). Three triggers write a
// crash_*.zip (a Rust panic, a window error, a session that never logged its [SHUTDOWN]); a clean
// exit writes a lighter session_*.zip. Every entry goes through report_redact::Redactor before it
// is written. The rolling session recording (last_crash_session.bmmreplay, flushed by
// replay-watcher.ts) is attached to crash reports only; DxDiag is never in the zip.
export const crashReporting = {
    id: 'crash-reporting',
    i18n: 'docs.diagram.crash-reporting',
    category: 'internals',
    dir: 'TB',
    article: 'crash-reporting',
    related: ['laya-crash-analysis', 'telemetry-pipeline', 'security-system'],
    groups: [
        { id: 'TRIGGER', dir: 'LR' },
        { id: 'INPUT', dir: 'LR' },
        { id: 'BUILD' },
        { id: 'AFTER', dir: 'LR' },
    ],
    nodes: [
        { id: 'PANIC', kind: 'rust', group: 'TRIGGER', icon: 'icon-alert', refs: ['src-tauri/src/commands/crash.rs › setup_panic_hook'] },
        { id: 'JS_ERROR', kind: 'front', group: 'TRIGGER', icon: 'icon-code', refs: ['frontend/src/features/debug/debug.ts › setupGlobalHandlers', 'frontend/src/features/debug/debug.ts › exportCrashDump', 'src-tauri/src/commands/crash.rs › trigger_manual_crash_report'] },
        { id: 'DIRTY', kind: 'rust', group: 'TRIGGER', icon: 'icon-history', refs: ['src-tauri/src/commands/crash.rs › init_session', 'src-tauri/src/commands/crash.rs › generate_report_from_content'] },
        { id: 'CLEAN_EXIT', kind: 'rust', group: 'TRIGGER', icon: 'icon-stop', refs: ['src-tauri/src/commands/crash.rs › finalize_and_close_app'] },
        { id: 'LOG', kind: 'data', group: 'INPUT', icon: 'icon-file', refs: ['src-tauri/src/commands/crash.rs › log_line', 'src-tauri/src/commands/crash.rs › MAX_LOG_LINES'] },
        { id: 'REPLAY', kind: 'data', group: 'INPUT', icon: 'icon-play', refs: ['frontend/src/features/settings/replay-watcher.ts › flushSession', 'src-tauri/src/commands/analytics.rs › replay_spool_finalize', 'src-tauri/src/commands/crash.rs › read_crash_replay'] },
        { id: 'COLLECT', kind: 'rust', group: 'BUILD', icon: 'icon-layers', refs: ['src-tauri/src/commands/crash.rs › generate_report_internal', 'src-tauri/src/commands/crash.rs › ReportParts', 'src-tauri/src/commands/crash.rs › get_system_snapshot_impl'] },
        { id: 'REDACT', kind: 'rust', group: 'BUILD', icon: 'icon-shield', refs: ['src-tauri/src/commands/report_redact.rs › Redactor', 'src-tauri/src/commands/crash.rs › redactor_for_report', 'src-tauri/src/commands/crash.rs › write_report_zip'] },
        { id: 'ZIP', kind: 'data', group: 'BUILD', icon: 'icon-archive', refs: ['src-tauri/src/commands/crash.rs › get_report_dir', 'src-tauri/src/commands/crash.rs › archive_old_reports'] },
        { id: 'OLD_REPORTS', kind: 'rust', group: 'BUILD', icon: 'icon-refresh', refs: ['src-tauri/src/commands/crash.rs › redact_existing_reports', 'src-tauri/src/commands/crash.rs › rewrite_report_zip_bytes'] },
        { id: 'NOTICE', kind: 'ui', group: 'AFTER', icon: 'icon-warning', refs: ['frontend/src/ui/crash-detect.ts › detectPreviousCrash', 'src-tauri/src/commands/crash.rs › get_startup_status', 'frontend/src/ui/crash-report.ts › checkPreviousCrash'] },
        { id: 'MANAGER', kind: 'ui', group: 'AFTER', icon: 'icon-list', link: 'laya-crash-analysis', refs: ['frontend/src/features/settings/crash-manager.ts › initCrashManager', 'src-tauri/src/commands/crash.rs › list_crash_reports', 'src-tauri/src/commands/crash.rs › read_crash_report'] },
        { id: 'FEEDBACK', kind: 'ui', group: 'AFTER', icon: 'icon-message', refs: ['frontend/src/features/feedback/feedback-modal.ts › openFeedback', 'frontend/src/ui/crash-report.ts › openFeedback', 'src-tauri/src/commands/crash.rs › get_dxdiag_report'] },
        { id: 'LIVE', kind: 'ext', group: 'AFTER', icon: 'icon-cloud', refs: ['src-tauri/src/commands/live_issues.rs › record_panic'] },
    ],
    edges: [
        { from: 'PANIC', to: 'COLLECT', label: 'crash', tone: 'danger', thick: true },
        { from: 'JS_ERROR', to: 'COLLECT', label: 'crash', tone: 'danger', thick: true },
        { from: 'DIRTY', to: 'COLLECT', label: 'crash', tone: 'danger' },
        { from: 'CLEAN_EXIT', to: 'COLLECT', label: 'session', tone: 'ok' },
        { from: 'LOG', to: 'COLLECT', label: '~reads' },
        { from: 'LOG', to: 'DIRTY', label: 'nextStart', dashed: true },
        { from: 'REPLAY', to: 'COLLECT', label: 'crashOnly', tone: 'warn', dashed: true },
        { from: 'COLLECT', to: 'REDACT', thick: true },
        { from: 'REDACT', to: 'ZIP', label: '~writes', thick: true },
        { from: 'OLD_REPORTS', to: 'ZIP', label: 'onceAtStart', dashed: true },
        { from: 'PANIC', to: 'LIVE', label: 'ifConsented', tone: 'info', dashed: true },
        { from: 'ZIP', to: 'NOTICE', label: 'nextStart', thick: true },
        { from: 'ZIP', to: 'MANAGER' },
        { from: 'NOTICE', to: 'FEEDBACK', label: 'report' },
        { from: 'ZIP', to: 'FEEDBACK', label: 'attach', dashed: true },
    ],
};
//# sourceMappingURL=crash-reporting.js.map