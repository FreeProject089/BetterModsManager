// The performance window (features/bench/benchmark.ts), as it runs today. Two halves:
//   · the live monitor: a sysinfo sampler in Rust (commands/benchmark.rs start_benchmark) emits a
//     `benchmark-point` every 1 s (500 ms in advanced mode) to the charts and the always-on-top
//     mini monitor window; sessions export to / import from CSV;
//   · the app benchmark: run_app_benchmark times ten real operations (scan, BLAKE3, copies,
//     extraction, activation…) on a synthetic set or on a capped copy of the user's own mods.
// It reads BMM's own process; it throttles nothing (that is the disk governor, disk-io-limiter).
export const perfMonitoring = {
    id: 'perf-monitoring',
    i18n: 'docs.diagram.perf-monitoring',
    category: 'internals',
    dir: 'TB',
    article: 'benchmarks',
    related: ['blake3-hashing', 'disk-io-limiter', 'telemetry-pipeline'],
    groups: [
        { id: 'LIVE' },
        { id: 'BENCH' },
    ],
    nodes: [
        { id: 'OPEN', kind: 'ui', icon: 'icon-meter', refs: ['frontend/src/features/bench/benchmark.ts › openAdvancedPerfModal', 'frontend/src/features/bench/benchmark.ts › openBenchmarkWithConfig'] },
        { id: 'SAMPLER', kind: 'rust', group: 'LIVE', icon: 'icon-activity', refs: ['src-tauri/src/commands/benchmark.rs › start_benchmark', 'src-tauri/src/commands/benchmark.rs › stop_benchmark', 'src-tauri/src/commands/benchmark.rs › BenchmarkPoint'] },
        { id: 'ADVANCED', kind: 'ui', group: 'LIVE', icon: 'icon-settings', refs: ['src-tauri/src/commands/benchmark.rs › set_advanced_benchmark_mode'] },
        { id: 'CHARTS', kind: 'ui', group: 'LIVE', icon: 'icon-chart', refs: ['frontend/src/features/bench/benchmark.ts › renderCharts', 'frontend/src/features/bench/benchmark.ts › MAX_POINTS', 'frontend/src/features/bench/bench-view.ts › viewBounds'] },
        { id: 'MINI', kind: 'ui', group: 'LIVE', icon: 'icon-pin', refs: ['src-tauri/src/commands/benchmark.rs › open_mini_monitor', 'frontend/src/features/bench/mini-window.ts'] },
        { id: 'SESSION_FILE', kind: 'data', group: 'LIVE', icon: 'icon-export', refs: ['src-tauri/src/commands/benchmark.rs › export_benchmark_csv', 'src-tauri/src/commands/benchmark.rs › read_file_text'] },
        { id: 'RUN', kind: 'rust', group: 'BENCH', icon: 'icon-play', refs: ['src-tauri/src/commands/benchmark.rs › run_app_benchmark', 'src-tauri/src/commands/benchmark.rs › BENCH_RUNNING'] },
        { id: 'DATASET', kind: 'decision', group: 'BENCH', refs: ['src-tauri/src/commands/benchmark.rs › run_app_benchmark_blocking'] },
        { id: 'SANDBOX', kind: 'data', group: 'BENCH', icon: 'icon-folder', refs: ['src-tauri/src/commands/benchmark.rs › gen_tree'] },
        { id: 'MY_MODS', kind: 'data', group: 'BENCH', icon: 'icon-drive', refs: ['src-tauri/src/commands/benchmark.rs › copy_capped'] },
        { id: 'STEPS', kind: 'rust', group: 'BENCH', icon: 'icon-speed', refs: ['src-tauri/src/commands/benchmark.rs › run_app_benchmark_blocking', 'src-tauri/src/commands/benchmark.rs › med_min_max'] },
        { id: 'CANCEL', kind: 'ui', group: 'BENCH', icon: 'icon-stop', refs: ['src-tauri/src/commands/benchmark.rs › cancel_app_benchmark', 'src-tauri/src/commands/benchmark.rs › BENCH_CANCEL'] },
        { id: 'REPORT', kind: 'outcome', group: 'BENCH', icon: 'icon-compare', refs: ['frontend/src/features/bench/benchmark.ts › renderBenchResults', 'frontend/src/features/bench/benchmark.ts › addBenchToCompare', 'frontend/src/features/bench/benchmark.ts › buildBenchReportHtml'] },
        { id: 'TELEMETRY', kind: 'front', icon: 'icon-cloud', refs: ['frontend/src/core/analytics.ts › runTelemetryBenchmark', 'frontend/src/core/analytics.ts › maybePeriodicBenchmark'] },
    ],
    edges: [
        { from: 'OPEN', to: 'SAMPLER', label: 'monitor', thick: true },
        { from: 'ADVANCED', to: 'SAMPLER', label: 'faster', tone: 'info', dashed: true },
        { from: 'SAMPLER', to: 'CHARTS', label: 'point', thick: true },
        { from: 'SAMPLER', to: 'MINI', label: 'point', dashed: true },
        { from: 'CHARTS', to: 'SESSION_FILE', label: 'exportImport', dashed: true },
        { from: 'OPEN', to: 'RUN', label: 'runBench', thick: true },
        { from: 'RUN', to: 'DATASET', thick: true },
        { from: 'DATASET', to: 'SANDBOX', label: 'sandbox', tone: 'ok', thick: true },
        { from: 'DATASET', to: 'MY_MODS', label: 'myMods', tone: 'info' },
        { from: 'SANDBOX', to: 'STEPS', thick: true },
        { from: 'MY_MODS', to: 'STEPS' },
        { from: 'CANCEL', to: 'STEPS', label: '~cancel', tone: 'danger', dashed: true },
        { from: 'STEPS', to: 'REPORT', thick: true },
        { from: 'TELEMETRY', to: 'RUN', label: 'weekly', dashed: true },
    ],
};
//# sourceMappingURL=perf-monitoring.js.map