import { invoke, listen, pickFile, pickFolder, saveFile, isTauri } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
import { showTaskyHelp, hideTaskyHelp } from '../../docs/interactive-docs.js';
import { bindModal, ensureModalShellCss } from '../../ui/modal-shell.js';
import { BOOT_KEY, REC_EVENT, EXPAND_EVENT, CLOSED_EVENT } from './mini-window.js';
import { viewBounds } from './bench-view.js';
let benchmarkData = [];
let isAdvancedMode = false;
let isLiveView = true;
let isRecording = true;
let benchmarkUnlisten = null;
let benchProgressUnlisten = null;
// Benchmark run state kept at module scope so the run survives closing/reopening
// the modal (it keeps running in the background) and can be restored/cancelled.
let lastBenchReport = null;
let benchRunning = false;
let benchLastPct = 0;
let benchLastLabel = '';
// Bumped on every run/cancel so a stale (still-aborting) run can't clobber the UI
// of a newer one.
let benchRunGen = 0;
// Loaded/run benchmark reports kept for side-by-side comparison (capped).
let benchCompare = [];
// Set by openBenchmarkWithConfig() so a programmatic open (API / deep link) can
// pre-fill the dataset/size/sources and optionally auto-start the run. Consumed
// once when the modal finishes building.
let pendingBenchConfig = null;
/**
 * Open the benchmark modal pre-configured — used by the public API and the
 * `bmm://benchmark/run` deep link. `autoRun: true` starts the run immediately
 * (auto mode); otherwise everything is set up and the user clicks Run (manual mode).
 */
export async function openBenchmarkWithConfig(cfg) {
    const sources = [...(cfg.sources || [])];
    // Resolve profile ids/names → their mods folder, and merge with explicit folders.
    if (Array.isArray(cfg.profiles) && cfg.profiles.length) {
        try {
            const profs = await invoke('get_profiles') || [];
            for (const pid of cfg.profiles) {
                const p = profs.find((x) => x.id === pid || x.name === pid);
                if (p?.mods_path && !sources.includes(p.mods_path))
                    sources.push(p.mods_path);
            }
        }
        catch { /* ignore */ }
    }
    const dataset = (cfg.dataset === 'real' || sources.length) ? 'real' : (cfg.dataset || 'sandbox');
    pendingBenchConfig = { dataset, size: cfg.size, mb: cfg.mb, sources, autoRun: cfg.autoRun };
    // Rebuild from scratch so the config is applied even if the modal was already open.
    document.getElementById('modal-advanced-perf-overlay')?.remove();
    await openAdvancedPerfModal();
}
/** Add a report to the comparison set (most-recent first, max 6). */
function addBenchToCompare(label, report) {
    if (!report || !Array.isArray(report.results))
        return;
    benchCompare.unshift({ label, report });
    if (benchCompare.length > 6)
        benchCompare.length = 6;
}
/** Flatten a benchmark report to CSV (one row per operation). */
function benchReportToCsv(report) {
    const head = 'id,label,category,ms,min_ms,max_ms,throughput_mb_s,bytes,items,note';
    const esc = (v) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = (report.results || []).map((o) => [o.id, o.label, o.category, o.ms, o.min_ms, o.max_ms, o.throughput_mb_s, o.bytes, o.items, o.note]
        .map(esc).join(','));
    return [head, ...rows].join('\n');
}
/** Parse a benchmark report from JSON or CSV text into the report shape. */
function parseBenchReportText(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) {
        try {
            const j = JSON.parse(trimmed);
            if (Array.isArray(j.results))
                return j;
        }
        catch { }
        return null;
    }
    // CSV: split respecting simple quoting.
    const lines = trimmed.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2)
        return null;
    const splitCsv = (line) => {
        const out = [];
        let cur = '';
        let q = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (q) {
                if (c === '"') {
                    if (line[i + 1] === '"') {
                        cur += '"';
                        i++;
                    }
                    else
                        q = false;
                }
                else
                    cur += c;
            }
            else if (c === '"')
                q = true;
            else if (c === ',') {
                out.push(cur);
                cur = '';
            }
            else
                cur += c;
        }
        out.push(cur);
        return out;
    };
    const head = splitCsv(lines[0]).map(h => h.trim());
    const idx = (k) => head.indexOf(k);
    const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
    const results = lines.slice(1).map(l => {
        const c = splitCsv(l);
        const ms = num(c[idx('ms')] ?? '') ?? 0;
        return {
            id: c[idx('id')] || '', label: c[idx('label')] || c[idx('id')] || '',
            category: c[idx('category')] || '', ms,
            min_ms: num(c[idx('min_ms')] ?? '') ?? ms, max_ms: num(c[idx('max_ms')] ?? '') ?? ms,
            samples: [], throughput_mb_s: num(c[idx('throughput_mb_s')] ?? ''),
            bytes: num(c[idx('bytes')] ?? '') ?? 0, items: num(c[idx('items')] ?? '') ?? 0,
            note: c[idx('note')] || null,
        };
    });
    return { env: {}, results, total_ms: 0 };
}
let hoverIndex = null;
let miniMonitorActive = false;
let seekIndex = null;
/** How many samples the live monitor keeps: an hour at one a second. */
const MAX_POINTS = 3600;
/** The time window shown (seconds back from the last sample), or null for everything. */
let rangeSecs = 300;
/** A drag-selected time range (timestamps, inclusive), inside the window above. */
let zoom = null;
/** Series the user switched off by clicking their legend entry (BenchmarkPoint keys). */
const hiddenSeries = new Set();
/** The run the results compare against (a label in benchCompare), or null for the previous one. */
let compareBase = null;
/** The mini monitor lives in its own window (Tauri) while this is true. */
let miniWindowOpen = false;
// Initialization
export async function initBenchmark() {
    const isEnabled = await invoke('is_benchmark_enabled');
    const btn = document.getElementById('btn-open-benchmark');
    if (!isEnabled) {
        if (btn)
            btn.style.display = 'none';
        return;
    }
    // The mini monitor window asks for the full monitor back, says it closed, or paused.
    void listen(EXPAND_EVENT, () => {
        miniWindowOpen = false;
        void openAdvancedPerfModal();
        try {
            void window.__TAURI__?.window?.getCurrentWindow?.()?.setFocus?.();
        }
        catch { /* focus is a nicety */ }
    });
    void listen(CLOSED_EVENT, () => {
        miniWindowOpen = false;
        // Nothing on screen draws the samples any more (the monitor is closed or hidden): stop
        // sampling. Showing the monitor again starts it again.
        if (!perfRoot?.closest('.modal-overlay')?.classList.contains('open'))
            void invoke('stop_benchmark');
    });
    void listen(REC_EVENT, (e) => { isRecording = !!e?.payload; paintRecState(); });
    if (btn) {
        btn.style.display = 'flex';
        btn.onclick = () => {
            const modal = document.getElementById('modal-advanced-perf-overlay');
            const mini = document.getElementById('bmm-mini-monitor');
            if (modal && modal.classList.contains('open') && modal.style.display !== 'none') {
                const closeBtn = modal.querySelector('#perf-modal-close');
                closeBtn?.click();
            }
            else if (mini) {
                toggleMiniMonitor(false);
                openAdvancedPerfModal();
            }
            else {
                openAdvancedPerfModal();
            }
        };
    }
}
// Helper for dynamic units
function formatUnit(val, type) {
    if (type === 's') {
        const h = Math.floor(val / 3600);
        const m = Math.floor((val % 3600) / 60);
        const s = Math.floor(val % 60);
        return `${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${s}s`;
    }
    if (val < 1024)
        return `${val.toFixed(0)} ${type}`;
    const base = 1024;
    const units = type === 'MB' ? ['MB', 'GB', 'TB'] : ['KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(val) / Math.log(base));
    return (val / Math.pow(base, i)).toFixed(2) + ' ' + units[i];
}
// ── Shared look + behaviour ──────────────────────────────────────────────────────────────
// The modal shell (css/modal-shell.css, linked at boot) plus this feature's own file.
function ensureBenchCss() {
    ensureModalShellCss();
    if (document.getElementById('bench-css'))
        return;
    const link = document.createElement('link');
    link.id = 'bench-css';
    link.rel = 'stylesheet';
    link.href = 'css/bench.css';
    document.head.appendChild(link);
}
const tt = (key, en, vars) => {
    const v = vars ? t(key, vars) : t(key);
    if (v && v !== key)
        return v;
    return vars ? en.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : en;
};
const escB = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// ── Live view: one render per frame, however many points arrive ──────────────────────────
// Points come in bursts (a CSV import, the backend catching up after a stall). Redrawing two
// canvases, four sparklines and the heatmap per point was the jank: now each point only
// marks the view dirty and the next animation frame paints the latest state once.
let perfRoot = null;
let perfRebind = null;
let renderQueued = false;
function scheduleLiveRender() {
    if (renderQueued)
        return;
    renderQueued = true;
    requestAnimationFrame(() => {
        renderQueued = false;
        const root = perfRoot;
        if (!root || !root.isConnected)
            return;
        const idx = isLiveView ? benchmarkData.length - 1 : (seekIndex ?? benchmarkData.length - 1);
        const point = benchmarkData[idx];
        if (point)
            updateStatsView(root, point);
        renderCharts(root, benchmarkData, isLiveView ? null : seekIndex);
        renderActivityMap(root, benchmarkData);
        renderSparklines(root, benchmarkData);
        updateSeekHandle(root, isLiveView || benchmarkData.length < 2 ? 1 : (seekIndex ?? 0) / (benchmarkData.length - 1));
        paintInspect(root);
        const n = root.querySelector('#perf-samples');
        if (n)
            n.textContent = tt('bench.ui.samples', '{n} samples', { n: benchmarkData.length });
        const zr = root.querySelector('#btn-perf-zoom-reset');
        if (zr)
            zr.hidden = !zoom;
    });
}
/** Replaying a moment: its time and every value in one line under the timeline. */
function paintInspect(root) {
    const box = root.querySelector('#perf-inspect');
    if (!box)
        return;
    const p = !isLiveView && seekIndex != null ? benchmarkData[seekIndex] : null;
    if (!p) {
        box.hidden = true;
        return;
    }
    const all = [...mainSeries(), ...ioSeries()];
    const html = `<b class="pf-mono">${escB(new Date(p.timestamp * 1000).toLocaleTimeString())}</b>`
        + all.map(s => `<span><span class="pf-swatch" style="--c:${s.css}"></span>${escB(s.label)} <b>${escB(s.fmt(p[s.key] || 0))}</b></span>`).join('');
    if (box.dataset.html !== html) {
        box.dataset.html = html;
        box.innerHTML = html;
    }
    box.hidden = false;
}
/** The recording state, said the same way in the modal and the mini monitor. */
function paintRecState() {
    const chip = document.getElementById('perf-rec-chip');
    const state = document.getElementById('perf-rec-state');
    const txt = document.getElementById('rec-text');
    const ic = document.getElementById('rec-dot');
    if (chip)
        chip.className = `bms-chip ${isRecording ? 'bms-chip--ok bms-chip--live' : 'bms-chip--warn'}`;
    if (state)
        state.textContent = isRecording ? tt('bench.ui.recording', 'Recording') : tt('bench.ui.paused', 'Paused');
    if (txt)
        txt.textContent = isRecording ? tt('bench.ui.pause', 'Pause') : tt('bench.ui.resume', 'Resume');
    if (ic)
        ic.className = `pf-rec-ic${isRecording ? '' : ' is-play'}`;
    const mini = document.getElementById('mini-startstop');
    if (mini) {
        mini.textContent = isRecording ? tt('bench.ui.pause', 'Pause') : tt('bench.ui.resume', 'Resume');
        mini.className = `pf-mini-btn ${isRecording ? 'is-stop' : 'is-start'}`;
    }
}
// ── Benchmark run: stages ─────────────────────────────────────────────────────────────────
// The backend reports {step, total, label}. Each new label is a stage; the list shows what
// is done, what runs now, and how far along the whole run is.
let benchStages = [];
let benchStep = 0;
let benchTotal = 0;
let benchStartedAt = 0;
let benchTick = null;
function fmtElapsed(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
/** The backend names its steps in English (commands/benchmark.rs `emit`): said in the user's
 *  language here, by label, with the backend's words for a step this list does not know. */
const STEP_KEY = {
    'Scanning mod files': 'bench.step.scan',
    'Hashing files (BLAKE3)': 'bench.step.hash',
    'Copying (full speed)': 'bench.step.copyFull',
    'Copying (Smart I/O)': 'bench.step.copySmart',
    'Extracting archive (.zip)': 'bench.step.extract',
    'Activating mod': 'bench.step.activate',
    'Activating archived mod (.zip)': 'bench.step.activateZip',
    'Deactivating mod': 'bench.step.deactivate',
    'Testing cancel responsiveness': 'bench.step.cancel',
    'Verifying (BLAKE3 compare)': 'bench.step.verify',
};
export function stepLabel(label) {
    const k = STEP_KEY[label];
    return k ? tt(k, label) : label;
}
function paintBenchProgress() {
    const bar = document.getElementById('bench-progress-bar');
    const pctEl = document.getElementById('bench-progress-pct');
    const lblEl = document.getElementById('bench-progress-label');
    const stepEl = document.getElementById('bench-progress-step');
    const elEl = document.getElementById('bench-elapsed');
    const list = document.getElementById('bench-stages');
    if (bar)
        bar.style.width = benchLastPct + '%';
    if (pctEl)
        pctEl.textContent = benchLastPct + '%';
    if (lblEl)
        lblEl.textContent = benchLastLabel ? stepLabel(benchLastLabel) + '…' : tt('bench.ui.starting', 'Preparing the dataset…');
    if (stepEl)
        stepEl.textContent = benchTotal ? tt('bench.ui.stepOf', 'Step {n} of {total}', { n: benchStep, total: benchTotal }) : '';
    if (elEl && benchStartedAt)
        elEl.textContent = tt('bench.ui.elapsed', '{t} elapsed', { t: fmtElapsed(Date.now() - benchStartedAt) });
    if (list) {
        const html = benchStages.map((s, i) => {
            const now = i === benchStages.length - 1 && benchLastPct < 100;
            return `<li class="${now ? 'is-now' : 'is-done'}"><span class="pf-st-ic" aria-hidden="true"></span><span>${escB(stepLabel(s))}</span></li>`;
        }).join('');
        if (list.dataset.html !== html) {
            list.dataset.html = html;
            list.innerHTML = html;
        }
    }
}
export async function openAdvancedPerfModal() {
    ensureBenchCss();
    const existing = document.getElementById('modal-advanced-perf-overlay');
    if (existing) {
        existing.classList.add('open');
        existing.style.display = 'flex';
        existing.style.opacity = '1';
        perfRebind?.();
        scheduleLiveRender();
        if (isRecording)
            void invoke('start_benchmark');
        return;
    }
    const overlay = document.createElement('div');
    overlay.id = 'modal-advanced-perf-overlay';
    overlay.className = 'modal-overlay open';
    const content = document.createElement('div');
    content.className = 'modal bms modal--xl';
    const I = {
        pulse: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
        x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        mini: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M13 13h6v6h-6z"/></svg>',
        play: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg>',
        stop: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
        up: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
        down: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
        plus: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
        dot: '<svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><circle cx="4" cy="4" r="3" fill="currentColor"/></svg>',
    };
    const stat = (key, label, swatch, valId, auxId, spark) => `
        <div class="pf-stat glass-card" data-stat="${key}">
            <div class="pf-stat-h"><span class="bms-label"><span class="pf-swatch" style="--c:${swatch}"></span>${escB(label)}</span></div>
            <div class="pf-stat-v" id="${valId}">–</div>
            <div class="pf-stat-aux" id="${auxId}"></div>
            <canvas class="pf-spark" data-spark="${spark}" style="--c:${swatch}" aria-hidden="true"></canvas>
        </div>`;
    content.innerHTML = `
        <div class="modal-header bms-head">
            <div class="bms-icon">${I.pulse}</div>
            <div class="bms-titles">
                <h2 class="bms-title" id="perf-title">${escB(t('bench.title') || 'Benchmark')}</h2>
                <p class="bms-sub" id="perf-subtitle">${escB(t('bench.subtitle') || 'Live Diagnostics & Replay')}</p>
            </div>
            <div class="bms-head-end">
                <div id="perf-tabs" class="bms-tabs" role="tablist" aria-label="${escB(tt('bench.ui.tabsAria', 'Benchmark views'))}">
                    <button type="button" class="bms-tab perf-tab active" role="tab" id="perf-tab-live" aria-controls="perf-live-view" aria-selected="true" data-mode="live">${escB(t('bench.tabLive') || 'Live Monitor')}</button>
                    <button type="button" class="bms-tab perf-tab" role="tab" id="perf-tab-bench" aria-controls="perf-bench-view" aria-selected="false" tabindex="-1" data-mode="bench">${escB(t('bench.tabBench') || 'Benchmark')}</button>
                </div>
                <button type="button" class="modal-close" id="perf-modal-close" aria-label="${escB(t('common.close') || 'Close')}">${I.x}</button>
            </div>
        </div>

        <div class="modal-body bms-body">
            <section id="perf-live-view" class="pf-view" role="tabpanel" aria-labelledby="perf-tab-live">
                <div class="bms-toolbar pf-toolbar" id="perf-live-controls">
                    <span id="perf-rec-chip" class="bms-chip bms-chip--ok bms-chip--live" role="status"><span class="bms-dot" aria-hidden="true"></span><span id="perf-rec-state"></span></span>
                    <span class="bms-chip pf-num" id="perf-samples"></span>
                    <button type="button" class="btn btn-primary btn-sm" id="btn-perf-live" hidden>${escB(t('bench.liveMode') || 'Back to live')}</button>
                    <span class="bms-spacer"></span>
                    <div id="perf-range" class="bms-seg" role="group" aria-label="${escB(tt('bench.ui.rangeAria', 'Time shown'))}">
                        ${[['60', tt('bench.ui.range1m', '1 min')], ['300', tt('bench.ui.range5m', '5 min')], ['900', tt('bench.ui.range15m', '15 min')], ['all', tt('bench.ui.rangeAll', 'All')]]
        .map(([v, l]) => `<button type="button" class="bms-seg-btn" data-range="${v}" aria-pressed="${String(rangeSecs == null ? v === 'all' : String(rangeSecs) === v)}">${escB(l)}</button>`).join('')}
                    </div>
                    <button type="button" class="btn btn-ghost btn-sm" id="btn-perf-zoom-reset" hidden data-tooltip="${escB(tt('bench.ui.zoomResetTip', 'Show the whole time range again (or double-click a chart).'))}">${escB(tt('bench.ui.zoomReset', 'Reset zoom'))}</button>
                    <button type="button" class="btn btn-secondary btn-sm" id="btn-perf-rec"><span id="rec-dot" class="pf-rec-ic" aria-hidden="true"></span><span id="rec-text"></span></button>
                    <button type="button" class="btn btn-secondary btn-sm" id="btn-perf-mini">${I.mini}<span>${escB(t('bench.miniMonitor') || 'Mini-Monitor')}</span></button>
                    <span class="bms-sep" aria-hidden="true"></span>
                    <label class="pf-adv" id="live-controls">
                        <span class="bmm-switch"><input type="checkbox" id="perf-advanced-toggle"><span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span></span>
                        <span>${escB(t('bench.advanced') || 'Advanced')}</span>
                    </label>
                </div>

                <div class="pf-stats">
                    ${stat('cpu', tt('bench.ui.cpu', 'CPU (BMM)'), 'var(--bmm-chart-cpu)', 'perf-cpu-val', 'perf-cpu-avg', 'cpu_usage')}
                    ${stat('ram', tt('bench.ui.ram', 'Memory (BMM)'), 'var(--bmm-chart-ram)', 'perf-ram-val', 'perf-ram-peak', 'ram_usage')}
                    ${stat('disk', t('bench.diskIo') || 'Disk I/O R/W', 'var(--bmm-chart-disk-read)', 'perf-disk-val', 'perf-disk-aux', 'disk_total')}
                    ${stat('uptime', t('bench.uptime') || 'Process Uptime', 'var(--bmm-success)', 'perf-uptime-val', 'perf-uptime-aux', '')}
                </div>

                <div id="perf-advanced-section" class="pf-stats" hidden>
                    <div class="pf-stat glass-card is-adv">
                        <div class="pf-stat-h"><span class="bms-label">${escB(t('bench.globalCpu') || 'Global CPU Load')}</span><span class="pf-help tasky-info" data-help="global_cpu" tabindex="0" role="note" aria-label="${escB(t('bench.help.globalCpu') || '')}">?</span></div>
                        <div class="pf-stat-v" id="perf-global-cpu-val">–</div>
                    </div>
                    <div class="pf-stat glass-card is-adv">
                        <div class="pf-stat-h"><span class="bms-label">${escB(t('bench.virtual') || 'Virtual Memory')}</span><span class="pf-help tasky-info" data-help="virtual" tabindex="0" role="note" aria-label="${escB(t('bench.help.virtual') || '')}">?</span></div>
                        <div class="pf-stat-v" id="perf-vram-val">–</div>
                    </div>
                    <div class="pf-stat glass-card is-adv">
                        <div class="pf-stat-h"><span class="bms-label">${escB(t('bench.swap') || 'Swap Memory')}</span><span class="pf-help tasky-info" data-help="swap" tabindex="0" role="note" aria-label="${escB(t('bench.help.swap') || '')}">?</span></div>
                        <div class="pf-stat-v" id="perf-swap-val">–</div>
                    </div>
                </div>

                <div class="pf-charts">
                    <div class="bms-card chart-container">
                        <div class="bms-card-h"><h3 class="bms-card-title">${escB(t('bench.sysHist') || 'System Resources History')}</h3><div class="pf-legend" id="perf-legend-main"></div></div>
                        <div class="pf-canvas-wrap"><canvas id="perf-chart-main"></canvas><div class="pf-sel" hidden></div><div class="pf-tip" hidden></div></div>
                    </div>
                    <div class="bms-card chart-container">
                        <div class="bms-card-h"><h3 class="bms-card-title">${escB(t('bench.ioHist') || 'Disk Throughput History')}</h3><div class="pf-legend" id="perf-legend-io"></div></div>
                        <div class="pf-canvas-wrap"><canvas id="perf-chart-io"></canvas><div class="pf-sel" hidden></div><div class="pf-tip" hidden></div></div>
                    </div>
                </div>

                <div class="bms-card">
                    <div class="bms-card-h">
                        <span class="bms-label">${escB(t('bench.timelineActivity') || 'Timeline Activity Map')}</span>
                        <span id="replay-time" class="pf-mono bms-note"></span>
                    </div>
                    <div id="timeline-container" class="pf-track" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100" aria-label="${escB(tt('bench.ui.timelineAria', 'Timeline: click or use the arrow keys to replay a moment'))}">
                        <canvas id="activity-heatmap" aria-hidden="true"></canvas>
                        <div id="timeline-seek-handle" aria-hidden="true"></div>
                    </div>
                    <div id="perf-inspect" class="pf-inspect" role="status" hidden></div>
                    <p class="bms-note pf-hint">${escB(tt('bench.ui.chartHint', 'Drag across a chart to zoom. Click to inspect a moment. Click a legend entry to hide its curve.'))}</p>
                </div>
            </section>

            <section id="perf-bench-view" class="pf-view" role="tabpanel" aria-labelledby="perf-tab-bench" hidden>
                <div class="bms-card pf-setup">
                    <div class="bms-field">
                        <span class="bms-label" id="bench-mode-lbl">${escB(t('bench.dataset') || 'Dataset')}</span>
                        <div id="bench-mode-seg" class="bms-seg" role="group" aria-labelledby="bench-mode-lbl">
                            <button type="button" class="bms-seg-btn bench-seg active" data-mode="sandbox">${escB(t('bench.sandbox') || 'Sandbox')}</button>
                            <button type="button" class="bms-seg-btn bench-seg" data-mode="real">${escB(t('bench.myMods') || 'My mods')}</button>
                        </div>
                    </div>
                    <div class="bms-field">
                        <span class="bms-label" id="bench-scale-lbl">${escB(t('bench.scale') || 'Size')}</span>
                        <div class="bms-toolbar">
                            <div id="bench-scale-seg" class="bms-seg" role="group" aria-labelledby="bench-scale-lbl">
                                <button type="button" class="bms-seg-btn bench-seg" data-scale="small" data-tooltip="${escB(t('bench.sizeSmallTip') || '~6 MB')}">S</button>
                                <button type="button" class="bms-seg-btn bench-seg active" data-scale="medium" data-tooltip="${escB(t('bench.sizeMediumTip') || '~48 MB')}">M</button>
                                <button type="button" class="bms-seg-btn bench-seg" data-scale="large" data-tooltip="${escB(t('bench.sizeLargeTip') || '~160 MB')}">L</button>
                                <button type="button" class="bms-seg-btn bench-seg" data-scale="xlarge" data-tooltip="${escB(t('bench.xlargeTip') || '~400 MB')}">XL</button>
                                <button type="button" class="bms-seg-btn bench-seg" data-scale="custom" data-tooltip="${escB(t('bench.sizeCustomTip') || 'Custom total size')}">${escB(t('bench.sizeCustom') || 'Custom')}</button>
                            </div>
                            <div id="bench-custom-wrap" class="pf-custom" style="display:none;">
                                <input id="bench-custom-mb" type="number" min="1" max="8192" value="250" aria-label="MB" data-tooltip="${escB(t('bench.sizeCustomMaxTip') || 'Total dataset size in MB (1–8192).')}" />
                                <span>MB</span><span aria-hidden="true">×</span>
                                <input id="bench-custom-files" type="number" min="1" max="200000" placeholder="auto" aria-label="${escB(t('bench.filesUnit') || 'files')}" data-tooltip="${escB(t('bench.filesCountTip') || 'Number of files (blank = auto from size).')}" />
                                <span>${escB(t('bench.filesUnit') || 'files')}</span>
                            </div>
                        </div>
                    </div>
                    <span class="bms-spacer"></span>
                    <button type="button" class="btn btn-primary btn-lg" id="btn-bench-run">${I.play}<span>${escB(t('bench.run') || 'Run Benchmark')}</span></button>
                    <button type="button" class="btn btn-danger btn-lg" id="btn-bench-cancel" style="display:none;">${I.stop}<span>${escB(t('bench.cancel') || 'Cancel')}</span></button>
                </div>

                <p id="bench-realnote" class="pf-callout" style="display:none;">${escB(t('bench.realNote') || '“My mods” uses the real mods of the selected profile(s) as test data — they are only read, never changed.')}</p>

                <div id="bench-sources" class="bms-card" style="display:none;">
                    <div class="bms-card-h">
                        <span class="bms-label" style="display:inline-flex;align-items:center;gap:8px;">${escB(t('bench.chooseProfiles') || 'Profiles to benchmark')}<span id="bench-src-count" class="pf-count"></span></span>
                        <div class="bms-toolbar">
                            <button type="button" class="btn btn-ghost btn-sm" id="bench-src-all">${escB(t('bench.selectAll') || 'All')}</button>
                            <button type="button" class="btn btn-ghost btn-sm" id="bench-src-none">${escB(t('bench.selectNone') || 'None')}</button>
                            <button type="button" class="btn btn-secondary btn-sm" id="bench-src-custom" style="display:inline-flex;align-items:center;gap:6px;">${I.plus}${escB(t('bench.customFolder') || 'Folder')}</button>
                        </div>
                    </div>
                    <div id="bench-src-list" class="pf-src-list"></div>
                </div>

                <div id="bench-progress-wrap" class="bms-card" style="display:none;" aria-live="polite">
                    <div class="pf-run-h">
                        <span><b id="bench-progress-label"></b></span>
                        <span class="pf-run-pct" id="bench-progress-pct">0%</span>
                    </div>
                    <div class="bms-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-labelledby="bench-progress-label"><span id="bench-progress-bar"></span></div>
                    <div class="pf-run-h"><span id="bench-progress-step"></span><span id="bench-elapsed" class="pf-num"></span></div>
                    <ol class="pf-stages" id="bench-stages" aria-label="${escB(tt('bench.ui.stages', 'Stages'))}"></ol>
                </div>

                <div id="bench-intro" class="bms-card">
                    <h3 class="bms-card-title">${escB(t('bench.introTitle') || 'Full operation benchmark')}</h3>
                    <p class="bms-note">${escB(t('bench.introBody') || 'Runs BMM’s real hot-path operations on a controlled dataset and reports how fast each one is, with throughput.')}</p>
                    <ul class="pf-ops-list">
                        ${[['bench.opScan', 'Scanning mod files', 'purple'], ['bench.opHash', 'SHA-256 integrity hashing', 'cyan'], ['bench.opCopyFull', 'Copy — full speed', 'info'], ['bench.opCopySmart', 'Copy — Smart I/O', 'info'], ['bench.opArchive', 'Extracting archived mods', 'warning'], ['bench.opActivate', 'Activating a mod', 'success'], ['bench.opDeactivate', 'Deactivating a mod', 'success'], ['bench.opCancel', 'Cancelling an operation', 'success']]
        .map(([k, en, c]) => `<li><span class="pf-swatch" style="--c:var(--bmm-${c})"></span>${escB(t(k) || en)}</li>`).join('')}
                    </ul>
                </div>

                <div id="bench-results" class="pf-view" style="display:none;"></div>
            </section>
        </div>

        <div class="modal-footer bms-foot">
            <div class="bms-foot-start">
                <button type="button" class="btn btn-ghost" id="btn-perf-import">${I.up}<span>${escB(t('bench.import') || 'Import Session')}</span></button>
                <button type="button" class="btn btn-ghost" id="btn-perf-clear">${escB(t('bench.clear') || 'Clear Session')}</button>
            </div>
            <button type="button" class="btn btn-primary" id="btn-perf-export">${I.down}<span>${escB(t('bench.export') || 'Export Session')}</span></button>
        </div>
    `;
    overlay.appendChild(content);
    (document.getElementById('app-window-outer') || document.body).appendChild(overlay);
    perfRoot = content;
    paintRecState();
    // Elements
    const closeBtn = content.querySelector('#perf-modal-close');
    const recBtn = content.querySelector('#btn-perf-rec');
    const miniBtn = content.querySelector('#btn-perf-mini');
    const advancedToggle = content.querySelector('#perf-advanced-toggle');
    const liveBtn = content.querySelector('#btn-perf-live');
    const timeline = content.querySelector('#timeline-container');
    const seekHandle = content.querySelector('#timeline-seek-handle');
    const taskyElements = content.querySelectorAll('.tasky-info');
    if (!closeBtn || !recBtn || !miniBtn || !advancedToggle || !liveBtn || !timeline || !seekHandle)
        return;
    // Tasky Help Tooltips
    const helpText = {
        latency: t('bench.help.latency') || "Network Latency: The time (ms) it takes for a request to reach Google. High values mean your connection or BMM's network thread is busy.",
        global_cpu: t('bench.help.globalCpu') || "Global CPU Load: Total usage of all cores on your PC. Helps you see if other background apps are slowing down BMM.",
        virtual: t('bench.help.virtual') || "Virtual Memory: Address space reserved by the OS for BMM. Not necessarily physical RAM, but indicates memory pressure.",
        swap: t('bench.help.swap') || "Swap Memory: Data moved from RAM to your disk. If this is high, your PC is out of real RAM, which causes major slowdowns."
    };
    taskyElements.forEach(el => {
        const show = () => showTaskyHelp(helpText[el.dataset.help], 'info', true);
        el.onmouseenter = show;
        el.onfocus = show;
        el.onmouseleave = () => hideTaskyHelp();
        el.onblur = () => hideTaskyHelp();
    });
    let release = () => { };
    const cleanup = async () => {
        release();
        if (benchmarkUnlisten) {
            benchmarkUnlisten();
            benchmarkUnlisten = null;
        }
        if (benchProgressUnlisten) {
            benchProgressUnlisten();
            benchProgressUnlisten = null;
        }
        if (benchTick) {
            clearInterval(benchTick);
            benchTick = null;
        }
        overlay.dispatchEvent(new Event('bmm:perf-gone'));
        // The mini monitor window still draws the samples: the sampler keeps running for it.
        if (!miniWindowOpen)
            await invoke('stop_benchmark');
        hideTaskyHelp();
        overlay.classList.remove('open');
        overlay.style.opacity = '0';
        if (perfRoot === content) {
            perfRoot = null;
            perfRebind = null;
        }
        setTimeout(() => overlay.remove(), 250);
    };
    closeBtn.onclick = cleanup;
    // Clicking the backdrop (outside the modal card) closes it. A running benchmark
    // keeps going in the background and is restored on reopen.
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay)
            cleanup();
    });
    // Escape closes it, Tab stays in it, the focus comes back where it was. Re-armed when the
    // modal comes back from the mini monitor.
    perfRebind = () => { release = bindModal(overlay, { onClose: () => { void cleanup(); }, initialFocus: content.querySelector('.perf-tab.active') }); };
    perfRebind();
    recBtn.onclick = async () => {
        isRecording = !isRecording;
        paintRecState();
        await invoke(isRecording ? 'start_benchmark' : 'stop_benchmark');
        // The mini monitor window shows the same state.
        if (miniWindowOpen) {
            try {
                await window.__TAURI__?.event?.emit?.(REC_EVENT, isRecording);
            }
            catch { /* it shows its own state */ }
        }
    };
    // The mini monitor: its own always-on-top window in the app (it stays over a game), the
    // floating panel inside BMM's window in a browser (the mock) or when the window can't open.
    miniBtn.onclick = async () => {
        const own = await openMiniWindow();
        overlay.classList.remove('open');
        overlay.style.display = 'none';
        release();
        if (!own)
            toggleMiniMonitor(true);
    };
    advancedToggle.onchange = async () => {
        isAdvancedMode = advancedToggle.checked;
        const section = content.querySelector('#perf-advanced-section');
        if (section)
            section.hidden = !isAdvancedMode;
        await invoke('set_advanced_benchmark_mode', { enabled: isAdvancedMode });
    };
    // Replay Logic
    const seekTo = (ratio) => {
        if (benchmarkData.length < 2)
            return;
        ratio = Math.min(1, Math.max(0, ratio));
        seekIndex = Math.round(ratio * (benchmarkData.length - 1));
        isLiveView = false;
        liveBtn.hidden = false;
        timeline.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
        scheduleLiveRender();
    };
    timeline.onclick = (e) => {
        const rect = timeline.getBoundingClientRect();
        seekTo((e.clientX - rect.left) / rect.width);
    };
    timeline.onkeydown = (e) => {
        if (benchmarkData.length < 2)
            return;
        const last = benchmarkData.length - 1;
        const cur = isLiveView ? last : (seekIndex ?? last);
        const to = e.key === 'ArrowLeft' ? cur - 1 : e.key === 'ArrowRight' ? cur + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
        if (to == null)
            return;
        e.preventDefault();
        if (to >= last && e.key !== 'ArrowLeft') {
            liveBtn.click();
            return;
        }
        seekTo(to / last);
    };
    liveBtn.onclick = () => {
        isLiveView = true;
        seekIndex = null;
        liveBtn.hidden = true;
        timeline.setAttribute('aria-valuenow', '100');
        scheduleLiveRender();
    };
    // Charts: one crosshair shared by both charts, each with its values in a tooltip; drag
    // across a chart to zoom on that stretch, click it to replay that moment, double-click to
    // zoom back out. Everything maps the mouse onto the samples on screen (viewBounds).
    const canvases = [content.querySelector('#perf-chart-main'), content.querySelector('#perf-chart-io')];
    const tipOf = (c) => c.parentElement?.querySelector('.pf-tip');
    const indexAt = (canvas, clientX) => {
        const [a, b] = viewBounds(benchmarkData, rangeSecs, zoom, isLiveView ? null : seekIndex);
        if (b - a < 1)
            return null;
        const rect = canvas.getBoundingClientRect();
        const plotW = Math.max(1, rect.width - CHART_PAD.l - CHART_PAD.r);
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left - CHART_PAD.l) / plotW));
        return a + Math.round(ratio * (b - a));
    };
    const paintTips = (clientX) => {
        const point = hoverIndex != null ? benchmarkData[hoverIndex] : null;
        for (const c of canvases) {
            const tip = tipOf(c);
            if (!tip)
                continue;
            if (!point || clientX == null) {
                tip.hidden = true;
                continue;
            }
            const series = (c.id === 'perf-chart-io' ? ioSeries() : mainSeries()).filter(s => !hiddenSeries.has(s.key));
            tip.innerHTML = `<div class="pf-tip-t">${escB(new Date(point.timestamp * 1000).toLocaleTimeString())}</div>`
                + series.map(s => `<div class="pf-tip-r"><span class="pf-swatch" style="--c:${s.css}"></span>${escB(s.label)}<b>${escB(s.fmt(point[s.key] || 0))}</b></div>`).join('');
            tip.hidden = !series.length;
            const rect = c.getBoundingClientRect();
            const x = clientX - rect.left;
            const w = tip.offsetWidth || 160;
            tip.style.left = (x + 14 + w > rect.width ? Math.max(0, x - 14 - w) : x + 14) + 'px';
        }
    };
    let drag = null;
    let raf = 0;
    const redraw = () => { if (!raf)
        raf = requestAnimationFrame(() => { raf = 0; renderCharts(content, benchmarkData, isLiveView ? null : seekIndex); }); };
    for (const canvas of canvases) {
        const sel = canvas.parentElement?.querySelector('.pf-sel');
        canvas.onmousemove = (e) => {
            if (benchmarkData.length < 2)
                return;
            hoverIndex = indexAt(canvas, e.clientX);
            paintTips(e.clientX);
            if (drag && drag.canvas === canvas && sel) {
                const rect = canvas.getBoundingClientRect();
                const x1 = Math.min(rect.width - CHART_PAD.r, Math.max(CHART_PAD.l, e.clientX - rect.left));
                const x0 = drag.x0 - rect.left;
                sel.style.left = Math.min(x0, x1) + 'px';
                sel.style.width = Math.abs(x1 - x0) + 'px';
                sel.hidden = Math.abs(x1 - x0) < 4;
            }
            redraw();
        };
        canvas.onmouseleave = () => { hoverIndex = null; paintTips(null); redraw(); };
        canvas.onmousedown = (e) => { if (e.button === 0 && benchmarkData.length >= 2) {
            drag = { canvas, x0: e.clientX };
            e.preventDefault();
        } };
        canvas.ondblclick = () => { zoom = null; scheduleLiveRender(); };
    }
    const onUp = (e) => {
        if (!drag)
            return;
        const { canvas, x0 } = drag;
        drag = null;
        const sel = canvas.parentElement?.querySelector('.pf-sel');
        if (sel)
            sel.hidden = true;
        const i0 = indexAt(canvas, x0), i1 = indexAt(canvas, e.clientX);
        if (i0 == null || i1 == null)
            return;
        if (Math.abs(e.clientX - x0) >= 6 && Math.abs(i1 - i0) >= 1) {
            const [lo, hi] = i0 < i1 ? [i0, i1] : [i1, i0];
            zoom = { from: benchmarkData[lo].timestamp, to: benchmarkData[hi].timestamp };
            scheduleLiveRender();
        }
        else {
            seekTo(i1 / Math.max(1, benchmarkData.length - 1));
        }
    };
    window.addEventListener('mouseup', onUp);
    const prevRelease = () => window.removeEventListener('mouseup', onUp);
    overlay.addEventListener('bmm:perf-gone', prevRelease, { once: true });
    // A click on a legend entry hides or shows that curve (both charts rescale to what is left).
    for (const id of ['#perf-legend-main', '#perf-legend-io']) {
        content.querySelector(id)?.addEventListener('click', (e) => {
            const b = e.target.closest('[data-key]');
            if (!b)
                return;
            const k = b.dataset.key;
            if (hiddenSeries.has(k))
                hiddenSeries.delete(k);
            else
                hiddenSeries.add(k);
            scheduleLiveRender();
        });
    }
    // The time window: 1, 5, 15 minutes or the whole session. Choosing one drops the zoom.
    const rangeSeg = content.querySelector('#perf-range');
    rangeSeg?.addEventListener('click', (e) => {
        const b = e.target.closest('[data-range]');
        if (!b)
            return;
        rangeSecs = b.dataset.range === 'all' ? null : Number(b.dataset.range);
        zoom = null;
        rangeSeg.querySelectorAll('[data-range]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        scheduleLiveRender();
    });
    const zoomReset = content.querySelector('#btn-perf-zoom-reset');
    if (zoomReset)
        zoomReset.onclick = () => { zoom = null; scheduleLiveRender(); };
    // ── Benchmark view wiring ───────────────────────────────────────────────
    let benchMode = 'sandbox';
    let benchScale = 'medium';
    const subtitle = content.querySelector('#perf-subtitle');
    const liveView = content.querySelector('#perf-live-view');
    const benchView = content.querySelector('#perf-bench-view');
    const setSeg = (segId, key, val) => content.querySelectorAll(`#${segId} .bench-seg`).forEach(b => {
        const el = b;
        const on = el.dataset[key] === val;
        el.classList.toggle('active', on);
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    setSeg('bench-mode-seg', 'mode', 'sandbox');
    setSeg('bench-scale-seg', 'scale', 'medium');
    // ── Real-mode source selection (which profile(s) / folders to benchmark) ──
    let benchProfiles = [];
    const benchSelected = new Set();
    const benchCustom = [];
    const sourcesPanel = content.querySelector('#bench-sources');
    const srcList = content.querySelector('#bench-src-list');
    const shortPath = (p) => p.replace(/[\\/]+$/, '').split(/[\\/]/).slice(-2).join('/');
    const folderIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
    const xIcon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    const checkIcon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="flex-shrink:0;" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
    const renderSrcChips = () => {
        if (!srcList)
            return;
        const prof = benchProfiles.map(p => {
            const on = benchSelected.has(p.id);
            return `<button type="button" class="bench-chip ${on ? 'active' : ''}" aria-pressed="${on}" data-pid="${escB(p.id)}" data-tooltip="${escB(p.mods_path || '')}">${on ? checkIcon : ''}${escB(p.name || p.id)}</button>`;
        }).join('');
        const custom = benchCustom.map((f, i) => `<button type="button" class="bench-chip active" data-custom="${i}" data-tooltip="${escB(f)}">${folderIcon}${escB(shortPath(f))}${xIcon}</button>`).join('');
        srcList.innerHTML = (prof + custom) || `<span class="bms-note">${escB(t('bench.noProfilesFound') || 'No profiles found — use the Folder button.')}</span>`;
        srcList.querySelectorAll('.bench-chip[data-pid]').forEach(c => (c.onclick = () => {
            const id = c.dataset.pid;
            if (benchSelected.has(id))
                benchSelected.delete(id);
            else
                benchSelected.add(id);
            renderSrcChips();
        }));
        srcList.querySelectorAll('.bench-chip[data-custom]').forEach(c => (c.onclick = () => {
            benchCustom.splice(Number(c.dataset.custom), 1);
            renderSrcChips();
        }));
        const countEl = content.querySelector('#bench-src-count');
        if (countEl) {
            const n = benchSelected.size + benchCustom.length;
            countEl.textContent = `${n} ${t('bench.selected') || 'selected'}`;
            countEl.style.display = n ? 'inline-block' : 'none';
        }
    };
    const loadProfiles = async () => {
        if (benchProfiles.length) {
            renderSrcChips();
            return;
        }
        try {
            const activeId = await invoke('get_active_profile_id');
            benchProfiles = await invoke('get_profiles') || [];
            const def = benchProfiles.find(p => p.id === activeId) || benchProfiles[0];
            if (def)
                benchSelected.add(def.id); // default: the active profile
        }
        catch {
            benchProfiles = [];
        }
        renderSrcChips();
    };
    const tabs = [...content.querySelectorAll('.perf-tab')];
    const switchPerfMode = (mode) => {
        tabs.forEach(b => {
            const on = b.dataset.mode === mode;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
            b.tabIndex = on ? 0 : -1;
        });
        const isBench = mode === 'bench';
        if (liveView)
            liveView.hidden = isBench;
        if (benchView)
            benchView.hidden = !isBench;
        if (subtitle)
            subtitle.textContent = isBench
                ? (t('bench.subtitleBench') || 'Operation Benchmark')
                : (t('bench.subtitle') || 'Live Diagnostics & Replay');
        if (!isBench)
            scheduleLiveRender();
    };
    tabs.forEach(b => (b.onclick = () => switchPerfMode(b.dataset.mode)));
    // The tabs pattern: arrows, Home and End move between the tabs and show them.
    content.querySelector('#perf-tabs')?.addEventListener('keydown', (e) => {
        const ev = e;
        const i = tabs.findIndex(b => b.getAttribute('aria-selected') === 'true');
        const n = ev.key === 'ArrowRight' ? i + 1 : ev.key === 'ArrowLeft' ? i - 1 : ev.key === 'Home' ? 0 : ev.key === 'End' ? tabs.length - 1 : null;
        if (n == null)
            return;
        ev.preventDefault();
        const to = tabs[(n + tabs.length) % tabs.length];
        switchPerfMode(to.dataset.mode);
        to.focus();
    });
    content.querySelectorAll('#bench-mode-seg .bench-seg').forEach(b => (b.onclick = () => {
        benchMode = b.dataset.mode;
        setSeg('bench-mode-seg', 'mode', benchMode);
        const isReal = benchMode === 'real';
        const note = content.querySelector('#bench-realnote');
        if (note)
            note.style.display = isReal ? 'block' : 'none';
        if (sourcesPanel)
            sourcesPanel.style.display = isReal ? 'flex' : 'none';
        if (isReal)
            loadProfiles();
    }));
    const customWrap = content.querySelector('#bench-custom-wrap');
    content.querySelectorAll('#bench-scale-seg .bench-seg').forEach(b => (b.onclick = () => {
        benchScale = b.dataset.scale;
        setSeg('bench-scale-seg', 'scale', benchScale);
        if (customWrap)
            customWrap.style.display = benchScale === 'custom' ? 'inline-flex' : 'none';
    }));
    const srcAll = content.querySelector('#bench-src-all');
    const srcNone = content.querySelector('#bench-src-none');
    const srcCustom = content.querySelector('#bench-src-custom');
    if (srcAll)
        srcAll.onclick = () => { benchProfiles.forEach(p => benchSelected.add(p.id)); renderSrcChips(); };
    if (srcNone)
        srcNone.onclick = () => { benchSelected.clear(); renderSrcChips(); };
    if (srcCustom)
        srcCustom.onclick = async () => { const f = await pickFolder(); if (f) {
            benchCustom.push(f);
            renderSrcChips();
        } };
    const runBtn = content.querySelector('#btn-bench-run');
    const progWrap = content.querySelector('#bench-progress-wrap');
    const introEl = content.querySelector('#bench-intro');
    const resultsEl = content.querySelector('#bench-results');
    benchProgressUnlisten = await listen('app-benchmark-progress', (event) => {
        const p = event.payload;
        const pct = p.total ? Math.round((p.step / p.total) * 100) : 0;
        benchLastPct = pct;
        benchLastLabel = p.label;
        benchStep = p.step;
        benchTotal = p.total;
        if (p.label && benchStages[benchStages.length - 1] !== p.label)
            benchStages.push(p.label);
        // By id, so progress lands in whatever modal instance is open now
        // (the run keeps going in the background across close/reopen).
        paintBenchProgress();
    });
    const cancelBtn = content.querySelector('#btn-bench-cancel');
    // Toggle the Run/Cancel/progress UI for a given running state.
    const setRunningUI = (running) => {
        if (runBtn) {
            runBtn.style.display = running ? 'none' : '';
        }
        if (cancelBtn)
            cancelBtn.style.display = running ? 'inline-flex' : 'none';
        if (progWrap)
            progWrap.style.display = running ? 'flex' : 'none';
        if (running && introEl)
            introEl.style.display = 'none';
        if (benchTick) {
            clearInterval(benchTick);
            benchTick = null;
        }
        if (running) {
            paintBenchProgress();
            benchTick = setInterval(paintBenchProgress, 1000);
        }
    };
    if (cancelBtn)
        cancelBtn.onclick = async () => {
            try {
                await invoke('cancel_app_benchmark');
            }
            catch { }
            // Reset the UI immediately so the user can set up and start a new run right
            // away; the old run keeps aborting in the background (its result is ignored
            // via the generation guard, and the backend rejects an overlapping start
            // until it has fully stopped).
            benchRunGen++;
            benchRunning = false;
            setRunningUI(false);
            toast(t('bench.cancelling') || 'Cancelling…', 'info');
        };
    // Restore state when (re)opening: a run in progress shows live progress; an
    // already-finished run shows its results.
    if (benchRunning) {
        setRunningUI(true);
    }
    else if (lastBenchReport) {
        renderBenchResults(resultsEl, lastBenchReport);
        if (resultsEl)
            resultsEl.style.display = 'flex';
        if (introEl)
            introEl.style.display = 'none';
    }
    if (runBtn)
        runBtn.onclick = async () => {
            let realSources = [];
            if (benchMode === 'real') {
                // Gather the selected profiles' real mod folders + any custom folders.
                realSources = [
                    ...benchProfiles.filter(p => benchSelected.has(p.id)).map(p => p.mods_path).filter(Boolean),
                    ...benchCustom,
                ];
                if (!realSources.length) {
                    toast(t('bench.noProfile') || 'Select at least one profile or folder, or use Sandbox mode.', 'error');
                    return;
                }
            }
            // Tag this run; if a cancel or a newer run happens, this one's results are
            // ignored so it can't clobber the UI.
            const myGen = ++benchRunGen;
            benchRunning = true;
            benchLastPct = 0;
            benchLastLabel = '';
            benchStages = [];
            benchStep = 0;
            benchTotal = 0;
            benchStartedAt = Date.now();
            setRunningUI(true);
            if (resultsEl)
                resultsEl.style.display = 'none';
            // For a custom size, send "custom:<MB>[:<files>]".
            let scaleArg = benchScale;
            if (benchScale === 'custom') {
                const mbEl = content.querySelector('#bench-custom-mb');
                const filesEl = content.querySelector('#bench-custom-files');
                const mb = Math.min(8192, Math.max(1, parseInt(mbEl?.value || '250', 10) || 250));
                const filesRaw = parseInt(filesEl?.value || '', 10);
                scaleArg = (filesRaw && filesRaw > 0)
                    ? `custom:${mb}:${Math.min(200000, filesRaw)}`
                    : `custom:${mb}`;
            }
            try {
                // A just-cancelled run may still be aborting; the backend rejects an
                // overlapping start with "already running" — retry briefly until free.
                let report = null;
                for (let attempt = 0;; attempt++) {
                    if (myGen !== benchRunGen)
                        return; // superseded
                    try {
                        report = await invoke('run_app_benchmark', { mode: benchMode, realSources, scale: scaleArg });
                        break;
                    }
                    catch (err) {
                        if (/already running/i.test(String(err)) && attempt < 30) {
                            await new Promise(r => setTimeout(r, 300));
                            continue;
                        }
                        throw err;
                    }
                }
                if (myGen !== benchRunGen)
                    return; // a newer run/cancel happened
                lastBenchReport = report;
                // Telemetry (opt-in): report benchmark medians per operation so the team
                // can track performance across versions and hardware.
                try {
                    const { track } = await import('../../core/analytics.js');
                    const ops = {};
                    (report?.results || []).forEach((o) => { if (o?.id)
                        ops[o.id] = o.ms; });
                    track('benchmark', {
                        mode: benchMode,
                        dataset_bytes: report?.env?.dataset_bytes,
                        total_ms: report?.total_ms,
                        ops,
                    });
                }
                catch { }
                // Keep each finished run for side-by-side comparison.
                const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const sizeMb = report?.env?.dataset_bytes ? ` · ${(report.env.dataset_bytes / 1048576).toFixed(0)}MB` : '';
                addBenchToCompare(`${stamp}${sizeMb}`, report);
                // Re-query by id: the modal may have been closed/reopened during the run.
                const liveResults = document.getElementById('bench-results');
                if (liveResults) {
                    renderBenchResults(liveResults, report);
                    liveResults.style.display = 'flex';
                }
                const liveIntro = document.getElementById('bench-intro');
                if (liveIntro)
                    liveIntro.style.display = 'none';
                const secs = report?.total_ms ? ` (${(report.total_ms / 1000).toFixed(1)}s)` : '';
                toast((t('bench.done') || 'Benchmark finished') + secs, 'success');
            }
            catch (e) {
                if (myGen !== benchRunGen)
                    return; // ignore a superseded run's error
                const msg = String(e);
                const liveIntro = document.getElementById('bench-intro');
                if (/cancel/i.test(msg)) {
                    toast(t('bench.cancelled') || 'Benchmark cancelled', 'info');
                }
                else {
                    toast((t('bench.failed') || 'Benchmark failed') + ': ' + e, 'error');
                }
                if (liveIntro)
                    liveIntro.style.display = 'flex';
            }
            finally {
                // Only the current run owns the shared UI state.
                if (myGen === benchRunGen) {
                    benchRunning = false;
                    setRunningUI(false);
                }
            }
        };
    // ── Footer buttons (context-aware: Benchmark report vs Live session) ─────
    const inBenchMode = () => !!benchView && !benchView.hidden;
    const footExport = content.querySelector('#btn-perf-export');
    const footClear = content.querySelector('#btn-perf-clear');
    const footImport = content.querySelector('#btn-perf-import');
    if (footExport)
        footExport.onclick = async () => {
            if (inBenchMode()) {
                // Export the benchmark report as JSON, CSV or a standalone HTML report —
                // chosen by the file extension the user picks.
                if (!lastBenchReport) {
                    toast(t('bench.runFirst') || 'Run a benchmark first', 'info');
                    return;
                }
                const dest = await saveFile({ defaultPath: 'bmm-benchmark.json', filters: [
                        { name: 'JSON', extensions: ['json'] },
                        { name: 'CSV', extensions: ['csv'] },
                        { name: 'HTML report', extensions: ['html'] },
                    ] });
                if (!dest)
                    return;
                const lower = dest.toLowerCase();
                const content = lower.endsWith('.csv') ? benchReportToCsv(lastBenchReport)
                    : lower.endsWith('.html') ? buildBenchReportHtml(lastBenchReport)
                        : JSON.stringify(lastBenchReport, null, 2);
                try {
                    await invoke('write_text_file', { path: dest, content });
                    toast((t('bench.reportSaved') || 'Report saved') + ': ' + dest, 'success');
                }
                catch (e) {
                    toast((t('bench.reportFailed') || 'Could not save report') + ': ' + e, 'error');
                }
            }
            else {
                // Export the live monitoring session as CSV.
                if (!benchmarkData.length) {
                    toast(t('bench.noSession') || 'No session data to export yet', 'info');
                    return;
                }
                const dest = await saveFile({ defaultPath: 'bmm-session.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
                if (!dest)
                    return;
                try {
                    await invoke('export_benchmark_csv', { dataJson: JSON.stringify(benchmarkData), destPath: dest });
                    toast((t('bench.sessionSaved') || 'Session exported') + ': ' + dest, 'success');
                }
                catch (e) {
                    toast((t('bench.reportFailed') || 'Export failed') + ': ' + e, 'error');
                }
            }
        };
    if (footClear)
        footClear.onclick = () => {
            if (inBenchMode()) {
                lastBenchReport = null;
                if (resultsEl) {
                    resultsEl.style.display = 'none';
                    resultsEl.innerHTML = '';
                }
                if (introEl)
                    introEl.style.display = 'flex';
            }
            else {
                benchmarkData = [];
                scheduleLiveRender();
            }
            toast(t('bench.cleared') || 'Cleared', 'success');
        };
    if (footImport)
        footImport.onclick = async () => {
            // In benchmark mode, import a benchmark report (JSON or CSV) → render it and
            // add it to the comparison set.
            if (inBenchMode()) {
                const src = await pickFile({ filters: [
                        { name: 'Benchmark report', extensions: ['json', 'csv'] },
                        { name: 'All files', extensions: ['*'] },
                    ] });
                if (!src)
                    return;
                try {
                    const text = await invoke('read_file_text', { path: src });
                    const report = parseBenchReportText(text);
                    if (!report || !report.results.length) {
                        toast(t('bench.importEmpty') || 'No data found in file', 'error');
                        return;
                    }
                    lastBenchReport = report;
                    const name = (src.split(/[\\/]/).pop() || 'import').replace(/\.(json|csv)$/i, '');
                    addBenchToCompare(name, report);
                    const liveResults = document.getElementById('bench-results');
                    if (liveResults) {
                        renderBenchResults(liveResults, report);
                        liveResults.style.display = 'flex';
                    }
                    const liveIntro = document.getElementById('bench-intro');
                    if (liveIntro)
                        liveIntro.style.display = 'none';
                    toast((t('bench.imported') || 'Imported') + `: ${name}`, 'success');
                }
                catch (e) {
                    toast((t('bench.importFailed') || 'Import failed') + ': ' + e, 'error');
                }
                return;
            }
            const src = await pickFile({ filters: [{ name: 'CSV session', extensions: ['csv'] }] });
            if (!src)
                return;
            try {
                const text = await invoke('read_file_text', { path: src });
                const lines = text.split(/\r?\n/).filter(l => l.trim());
                // Skip header row; columns: Timestamp,CPU,RAM,DiskR,DiskW,Net,VMem,Swap,GlobalCPU,Uptime
                const pts = [];
                for (const line of lines.slice(1)) {
                    const c = line.split(',');
                    if (c.length < 5)
                        continue;
                    pts.push({
                        timestamp: Number(c[0]) || 0, cpu_usage: Number(c[1]) || 0, ram_usage: Number(c[2]) || 0,
                        disk_read: Number(c[3]) || 0, disk_write: Number(c[4]) || 0,
                        network_latency: Number(c[5]) || undefined, ram_virtual: Number(c[6]) || undefined,
                        ram_swap: Number(c[7]) || undefined, global_cpu: Number(c[8]) || undefined, process_uptime: Number(c[9]) || undefined,
                    });
                }
                if (!pts.length) {
                    toast(t('bench.importEmpty') || 'No data found in file', 'error');
                    return;
                }
                benchmarkData = pts;
                isLiveView = false;
                seekIndex = pts.length - 1;
                if (liveBtn)
                    liveBtn.hidden = false;
                switchPerfMode('live');
                scheduleLiveRender();
                toast((t('bench.imported') || 'Session imported') + ` (${pts.length} pts)`, 'success');
            }
            catch (e) {
                toast((t('bench.importFailed') || 'Import failed') + ': ' + e, 'error');
            }
        };
    // ── Programmatic open (public API / deep link): pre-fill the config and, in
    //    auto mode, start the run. In manual mode everything is set up and the
    //    user clicks Run themselves. ───────────────────────────────────────────
    if (pendingBenchConfig) {
        const cfg = pendingBenchConfig;
        pendingBenchConfig = null;
        switchPerfMode('bench');
        // Dataset (sandbox | real)
        benchMode = cfg.dataset === 'real' ? 'real' : 'sandbox';
        setSeg('bench-mode-seg', 'mode', benchMode);
        const isReal = benchMode === 'real';
        const realNote = content.querySelector('#bench-realnote');
        if (realNote)
            realNote.style.display = isReal ? 'block' : 'none';
        if (sourcesPanel)
            sourcesPanel.style.display = isReal ? 'flex' : 'none';
        // Size / scale
        const scaleMap = { S: 'small', M: 'medium', L: 'large', XL: 'xlarge', CUSTOM: 'custom' };
        const sz = String(cfg.size || 'M').toUpperCase();
        benchScale = scaleMap[sz]
            || (['small', 'medium', 'large', 'xlarge', 'custom'].includes(String(cfg.size)) ? String(cfg.size) : 'medium');
        setSeg('bench-scale-seg', 'scale', benchScale);
        if (customWrap)
            customWrap.style.display = benchScale === 'custom' ? 'inline-flex' : 'none';
        if (benchScale === 'custom' && cfg.mb) {
            const mbEl = content.querySelector('#bench-custom-mb');
            if (mbEl)
                mbEl.value = String(Math.min(8192, Math.max(1, Math.round(cfg.mb))));
        }
        // Real sources: add the supplied mod folders as custom sources.
        if (isReal) {
            await loadProfiles();
            if (Array.isArray(cfg.sources)) {
                for (const s of cfg.sources) {
                    if (s && !benchCustom.includes(s))
                        benchCustom.push(s);
                }
            }
            renderSrcChips();
        }
        // Auto mode starts the run now; manual mode leaves it to the user.
        if (cfg.autoRun && runBtn)
            runBtn.click();
    }
    // Live Monitoring: store the point, paint on the next frame.
    benchmarkUnlisten = await listen('benchmark-point', (event) => {
        const point = event.payload;
        benchmarkData.push(point);
        if (benchmarkData.length > MAX_POINTS) {
            benchmarkData.shift();
            // Indices point at samples: keep them on the same ones.
            if (seekIndex != null)
                seekIndex = Math.max(0, seekIndex - 1);
            if (hoverIndex != null)
                hoverIndex = Math.max(0, hoverIndex - 1);
        }
        if (isLiveView)
            scheduleLiveRender();
        if (miniMonitorActive)
            updateMiniMonitor(point);
    });
    scheduleLiveRender();
    await invoke('start_benchmark');
}
function updateStatsView(container, point) {
    if (!point)
        return;
    const set = (sel, txt) => { const el = container.querySelector(sel); if (el && el.textContent !== txt)
        el.textContent = txt; };
    set('#perf-cpu-val', point.cpu_usage.toFixed(1) + ' %');
    set('#perf-ram-val', formatUnit(point.ram_usage, 'MB'));
    set('#perf-disk-val', formatUnit(point.disk_read + point.disk_write, 'KB/s'));
    set('#perf-disk-aux', `R ${formatUnit(point.disk_read, 'KB/s')} · W ${formatUnit(point.disk_write, 'KB/s')}`);
    set('#perf-uptime-val', formatUnit(point.process_uptime || 0, 's'));
    set('#perf-uptime-aux', point.network_latency ? `${t('bench.network') || 'Net Latency'} ${point.network_latency} ms` : '');
    set('#replay-time', (isLiveView ? '' : `${t('bench.replayTime') || 'Replay'} · `) + t('bench.pointTime', { time: new Date(point.timestamp * 1000).toLocaleTimeString() }));
    // Averages/Peaks over the whole session.
    if (benchmarkData.length > 0) {
        let sum = 0, peak = 0;
        for (const p of benchmarkData) {
            sum += p.cpu_usage;
            if (p.ram_usage > peak)
                peak = p.ram_usage;
        }
        set('#perf-cpu-avg', tt('bench.ui.avg', 'avg {v}', { v: (sum / benchmarkData.length).toFixed(1) + ' %' }));
        set('#perf-ram-peak', tt('bench.ui.peak', 'peak {v}', { v: formatUnit(peak, 'MB') }));
    }
    if (isAdvancedMode) {
        set('#perf-global-cpu-val', point.global_cpu ? point.global_cpu.toFixed(1) + ' %' : '–');
        set('#perf-vram-val', point.ram_virtual ? formatUnit(point.ram_virtual, 'MB') : '–');
        set('#perf-swap-val', point.ram_swap ? formatUnit(point.ram_swap, 'MB') : '–');
    }
}
function updateSeekHandle(container, ratio) {
    const handle = container.querySelector('#timeline-seek-handle');
    if (handle) {
        handle.style.left = `calc(${ratio * 100}% - 1.5px)`;
    }
}
/** A theme token's current value (custom properties resolve their own var()s). */
function tok(name, fb, el = document.documentElement) {
    return getComputedStyle(el).getPropertyValue(name).trim() || fb;
}
/** Size a canvas to its box at the device pixel ratio; returns the 2D context in CSS pixels. */
function fitCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx)
        return null;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (W < 2 || H < 2)
        return null;
    const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    return { ctx, W, H };
}
function renderActivityMap(container, data) {
    const canvas = container.querySelector('#activity-heatmap');
    if (!canvas)
        return;
    const fit = fitCanvas(canvas);
    if (!fit || data.length < 2)
        return;
    const { ctx, W: w, H: h } = fit;
    let maxCpu = 0;
    for (const p of data)
        if (p.cpu_usage > maxCpu)
            maxCpu = p.cpu_usage;
    maxCpu = maxCpu || 1;
    ctx.fillStyle = tok('--bmm-accent', '#3b82f6');
    const bw = Math.max(1.5, w / data.length - 1);
    data.forEach((p, i) => {
        const x = (i / (data.length - 1)) * (w - bw);
        const intensity = p.cpu_usage / maxCpu;
        ctx.globalAlpha = 0.25 + intensity * 0.75;
        const bh = Math.max(2, intensity * (h - 8));
        ctx.fillRect(x, h - 4 - bh, bw, bh);
    });
    // The stretch the charts show stays bright; the rest of the session is dimmed.
    const [a, b] = viewBounds(data, rangeSecs, zoom, isLiveView ? null : seekIndex);
    if (a > 0 || b < data.length - 1) {
        const xa = (a / (data.length - 1)) * w, xb = (b / (data.length - 1)) * w;
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = tok('--bmm-bg-elevated', '#111827');
        ctx.fillRect(0, 0, xa, h);
        ctx.fillRect(xb, 0, w - xb, h);
    }
    ctx.globalAlpha = 1;
}
/** The small trend line at the bottom of each stat card: the last minute or so. */
function renderSparklines(container, data) {
    container.querySelectorAll('canvas.pf-spark').forEach((canvas) => {
        const key = canvas.dataset.spark;
        if (!key)
            return;
        const fit = fitCanvas(canvas);
        if (!fit)
            return;
        const { ctx, W, H } = fit;
        const pts = data.slice(-90);
        if (pts.length < 2)
            return;
        const val = (p) => key === 'disk_total' ? p.disk_read + p.disk_write : p[key] || 0;
        let max = 0, min = Infinity;
        for (const p of pts) {
            const v = val(p);
            if (v > max)
                max = v;
            if (v < min)
                min = v;
        }
        // RAM barely moves in absolute terms; a floor at 0 would draw it flat.
        const lo = key === 'ram_usage' ? min * 0.98 : 0;
        const span = (max - lo) || 1;
        const color = tok('--c', tok('--bmm-accent', '#3b82f6'), canvas);
        ctx.beginPath();
        pts.forEach((p, i) => {
            const x = (i / (pts.length - 1)) * W;
            const y = H - 2 - ((val(p) - lo) / span) * (H - 6);
            if (i === 0)
                ctx.moveTo(x, y);
            else
                ctx.lineTo(x, y);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.lineTo(W, H);
        ctx.lineTo(0, H);
        ctx.closePath();
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 1;
    });
}
/** Theme tokens the mini monitor window paints with (it loads no BMM stylesheet). */
const MINI_TOKENS = ['--bmm-text-primary', '--bmm-text-secondary', '--bmm-border-hover', '--bmm-bg-elevated', '--bmm-success',
    '--bmm-s06', '--bmm-accent', '--bmm-chart-cpu', '--bmm-chart-ram', '--bmm-chart-disk-read', '--font-sans', '--bmm-font-mono'];
/** Open the mini monitor in its own always-on-top window. False when there is no such window
 *  here (a browser) or it could not open: the caller shows the in-app panel instead. */
async function openMiniWindow() {
    if (!isTauri())
        return false;
    const cs = getComputedStyle(document.documentElement);
    const boot = {
        tokens: Object.fromEntries(MINI_TOKENS.map(k => [k, cs.getPropertyValue(k).trim()])),
        labels: {
            title: t('bench.miniMonitor') || 'Mini-Monitor', cpu: 'CPU', ram: 'RAM', disk: tt('bench.ui.disk', 'Disk'),
            expand: tt('bench.ui.miniExpand', 'Open the full monitor'), close: t('common.close') || 'Close',
            pause: tt('bench.ui.pause', 'Pause'), resume: tt('bench.ui.resume', 'Resume'), paused: tt('bench.ui.paused', 'Paused'),
            waiting: tt('bench.ui.miniWaiting', 'Waiting for the first sample…'), updated: tt('bench.ui.miniUpdated', 'Updated'),
            mb: 'MB', gb: 'GB', kbs: 'KB/s', mbs: 'MB/s',
        },
        recording: isRecording,
    };
    try {
        localStorage.setItem(BOOT_KEY, JSON.stringify(boot));
    }
    catch { /* the window falls back to bare labels */ }
    try {
        await invoke('open_mini_monitor', {}, { quiet: true });
        miniWindowOpen = true;
        if (isRecording)
            await invoke('start_benchmark');
        return true;
    }
    catch (e) {
        console.warn('[bench] mini monitor window:', e);
        return false;
    }
}
function toggleMiniMonitor(active) {
    miniMonitorActive = active;
    let el = document.getElementById('bmm-mini-monitor');
    if (!active) {
        if (el) {
            el.style.opacity = '0';
            setTimeout(() => el?.remove(), 300);
        }
        return;
    }
    if (!el) {
        ensureBenchCss();
        el = document.createElement('div');
        el.id = 'bmm-mini-monitor';
        el.className = 'pf-mini';
        el.setAttribute('role', 'region');
        el.setAttribute('aria-label', t('bench.miniMonitor') || 'Mini-Monitor');
        const row = (lbl, bar, val, c) => `
            <div class="pf-mini-row">
                <span class="bms-label">${lbl}</span>
                <div class="pf-bar" style="--c:${c}"><span id="${bar}" style="width:0%"></span></div>
                <span class="pf-mini-val" id="${val}">–</span>
            </div>`;
        el.innerHTML = `
            <div class="pf-mini-h">
                <span class="bms-label"><span class="bms-dot" style="background:var(--bmm-accent)"></span>${escB(t('bench.miniMonitor') || 'Mini-Monitor')}</span>
                <div class="pf-mini-btns">
                    <button type="button" id="mini-startstop" class="pf-mini-btn is-stop"></button>
                    <button type="button" id="mini-back" class="pf-mini-btn" aria-label="${escB(t('bench.title') || 'Benchmark')}" data-tooltip="${escB(t('bench.title') || 'Benchmark')}">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M15 3h6v6M10 14L21 3M9 21H3v-6M21 21L13 13"/></svg>
                    </button>
                    <button type="button" id="mini-close" class="pf-mini-btn" aria-label="${escB(t('common.close') || 'Close')}">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            </div>
            ${row('CPU', 'mini-cpu-bar', 'mini-cpu', 'var(--bmm-chart-cpu)')}
            ${row('RAM', 'mini-ram-bar', 'mini-ram', 'var(--bmm-chart-ram)')}
            ${row(escB(tt('bench.ui.disk', 'Disk')), 'mini-disk-bar', 'mini-disk', 'var(--bmm-chart-disk-read)')}
        `;
        document.body.appendChild(el);
        let isDragging = false;
        let startPos = { x: 0, y: 0 }, startElPos = { x: 0, y: 0 };
        el.onmousedown = (e) => {
            if (e.target.closest('button'))
                return;
            isDragging = true;
            el.style.cursor = 'grabbing';
            startPos = { x: e.clientX, y: e.clientY };
            const rect = el.getBoundingClientRect();
            startElPos = { x: rect.left, y: rect.top };
            el.style.transition = 'none';
        };
        document.addEventListener('mousemove', (e) => {
            if (!isDragging || !el)
                return;
            el.style.left = (startElPos.x + e.clientX - startPos.x) + 'px';
            el.style.top = (startElPos.y + e.clientY - startPos.y) + 'px';
            el.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => { isDragging = false; if (el) {
            el.style.cursor = 'grab';
            el.style.transition = '';
        } });
        el.querySelector('#mini-close').onclick = () => toggleMiniMonitor(false);
        el.querySelector('#mini-back').onclick = () => { toggleMiniMonitor(false); openAdvancedPerfModal(); };
        const startStopBtn = el.querySelector('#mini-startstop');
        startStopBtn.onclick = () => {
            isRecording = !isRecording;
            invoke(isRecording ? 'start_benchmark' : 'stop_benchmark');
            paintRecState();
        };
        paintRecState();
    }
}
function updateMiniMonitor(point) {
    const el = document.getElementById('bmm-mini-monitor');
    if (!el || !point)
        return;
    const cpu = el.querySelector('#mini-cpu');
    const cpuBar = el.querySelector('#mini-cpu-bar');
    const ram = el.querySelector('#mini-ram');
    const ramBar = el.querySelector('#mini-ram-bar');
    const disk = el.querySelector('#mini-disk');
    const diskBar = el.querySelector('#mini-disk-bar');
    if (cpu && cpuBar) {
        cpu.textContent = point.cpu_usage.toFixed(0) + '%';
        cpuBar.style.width = Math.min(100, point.cpu_usage) + '%';
    }
    if (ram && ramBar) {
        // Estimate RAM percentage based on a 16GB baseline if total not known
        const ramMb = point.ram_usage;
        ram.textContent = (ramMb > 1024 ? (ramMb / 1024).toFixed(1) + ' GB' : ramMb.toFixed(0) + ' MB');
        ramBar.style.width = Math.min(100, (ramMb / 16384) * 100) + '%';
    }
    if (disk && diskBar) {
        const totalIo = point.disk_read + point.disk_write;
        disk.textContent = (totalIo > 1024 ? (totalIo / 1024).toFixed(1) + ' MB/s' : totalIo.toFixed(0) + ' KB/s');
        // Scale 50MB/s as 100% for the mini bar
        diskBar.style.width = Math.min(100, (totalIo / 51200) * 100) + '%';
    }
}
// The plot's margins: the left axis carries the first series' unit, the right axis the
// second's. The hover handler reads the same numbers to map the mouse onto a sample.
const CHART_PAD = { l: 64, r: 64, t: 10, b: 22 };
const mainSeries = () => [
    { key: 'cpu_usage', css: 'var(--bmm-chart-cpu)', color: tok('--bmm-chart-cpu', '#3b82f6'), label: 'CPU', fmt: v => `${v.toFixed(1)} %` },
    { key: 'ram_usage', css: 'var(--bmm-chart-ram)', color: tok('--bmm-chart-ram', '#94a3b8'), label: 'RAM', fmt: v => formatUnit(v, 'MB') },
];
const ioSeries = () => [
    { key: 'disk_read', css: 'var(--bmm-chart-disk-read)', color: tok('--bmm-chart-disk-read', '#fbbf24'), label: tt('bench.ui.read', 'Read'), fmt: v => formatUnit(v, 'KB/s') },
    { key: 'disk_write', css: 'var(--bmm-chart-disk-write)', color: tok('--bmm-chart-disk-write', '#f87171'), label: tt('bench.ui.write', 'Write'), fmt: v => formatUnit(v, 'KB/s') },
];
function renderCharts(container, data, highlightIndex = null) {
    const mainCanvas = container.querySelector('#perf-chart-main');
    const ioCanvas = container.querySelector('#perf-chart-io');
    if (!mainCanvas || !ioCanvas)
        return;
    const main = mainSeries(), io = ioSeries();
    // Only the samples on screen (time window or zoom); indices move into that slice.
    const [a, b] = viewBounds(data, rangeSecs, zoom, highlightIndex);
    const view = data.slice(a, b + 1);
    const rel = (i) => (i != null && i >= a && i <= b ? i - a : null);
    const hl = rel(highlightIndex), hv = rel(hoverIndex);
    drawChart(mainCanvas, view, main.filter(s => !hiddenSeries.has(s.key)), hl, hv);
    drawChart(ioCanvas, view, io.filter(s => !hiddenSeries.has(s.key)), hl, hv);
    paintLegend(container.querySelector('#perf-legend-main'), data, main, highlightIndex);
    paintLegend(container.querySelector('#perf-legend-io'), data, io, highlightIndex);
}
/** The legend is HTML (readable, themed): one button per curve that hides or shows it; only
 *  the values change per frame. */
function paintLegend(el, data, series, highlightIndex) {
    if (!el)
        return;
    const index = highlightIndex !== null ? highlightIndex : hoverIndex;
    const sample = (index !== null && data[index]) ? data[index] : data[data.length - 1];
    if (el.childElementCount !== series.length) {
        el.innerHTML = series.map((s, i) => `<button type="button" class="pf-leg" data-key="${escB(s.key)}" aria-pressed="true" data-tooltip="${escB(tt('bench.ui.legendTip', 'Show or hide this curve'))}"><span class="pf-swatch" style="--c:${s.css}"></span>${escB(s.label)} <b data-i="${i}">–</b></button>`).join('');
    }
    series.forEach((s, i) => {
        const b = el.querySelector(`b[data-i="${i}"]`);
        const txt = sample ? s.fmt(sample[s.key] || 0) : '–';
        if (b && b.textContent !== txt)
            b.textContent = txt;
        const btn = b?.parentElement;
        const on = String(!hiddenSeries.has(s.key));
        if (btn && btn.getAttribute('aria-pressed') !== on)
            btn.setAttribute('aria-pressed', on);
    });
}
// Time-series chart: a padded plot, three gridlines labelled in each series' OWN unit (left
// axis = first series, right axis = second), a time axis, and a crosshair with markers on
// hover or replay. Each series scales to its own peak so both stay readable.
function drawChart(canvas, data, series, highlightIndex, hoverAt = null) {
    const fit = fitCanvas(canvas);
    if (!fit)
        return;
    const { ctx, W, H } = fit;
    ctx.font = `10.5px ${tok('--bmm-font-mono', 'monospace')}`;
    ctx.textBaseline = 'middle';
    const px = CHART_PAD.l, py = CHART_PAD.t;
    const pw = Math.max(1, W - CHART_PAD.l - CHART_PAD.r), ph = Math.max(1, H - CHART_PAD.t - CHART_PAD.b);
    const ink = tok('--bmm-text-secondary', '#94a3b8');
    const grid = tok('--bmm-border-hover', 'rgba(148,163,184,0.15)');
    const maxOf = (s) => {
        let m = 0;
        for (const p of data) {
            const v = p[s.key] || 0;
            if (v > m)
                m = v;
        }
        return m * 1.15 || 1;
    };
    const maxes = series.map(maxOf);
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = ink;
    for (let i = 0; i <= 2; i++) {
        const y = Math.round(py + (ph * i) / 2) + 0.5;
        ctx.beginPath();
        ctx.moveTo(px, y);
        ctx.lineTo(px + pw, y);
        ctx.stroke();
        if (data.length >= 2 && series[0]) {
            const frac = 1 - i / 2;
            ctx.textAlign = 'right';
            ctx.fillText(series[0].fmt(maxes[0] * frac), px - 8, y);
            if (series[1]) {
                ctx.textAlign = 'left';
                ctx.fillText(series[1].fmt(maxes[1] * frac), px + pw + 8, y);
            }
        }
    }
    if (data.length < 2 || !series.length) {
        ctx.textAlign = 'center';
        ctx.fillStyle = ink;
        ctx.fillText(data.length < 2 ? tt('bench.ui.collecting', 'Collecting samples…') : tt('bench.ui.allHidden', 'Every curve is hidden: click the legend to show one.'), px + pw / 2, py + ph / 2);
        return;
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = ink;
    const tFmt = (ts) => new Date(ts * 1000).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' });
    for (let i = 0; i <= 3; i++) {
        const idx = Math.round(((data.length - 1) * i) / 3);
        const x = px + (pw * i) / 3;
        ctx.textAlign = i === 0 ? 'left' : i === 3 ? 'right' : 'center';
        if (data[idx])
            ctx.fillText(tFmt(data[idx].timestamp), x, py + ph + 13);
    }
    const yOf = (v, max) => py + ph - Math.min(ph, (v / max) * ph);
    series.forEach((s, si) => {
        const max = maxes[si];
        ctx.beginPath();
        data.forEach((p, i) => {
            const x = px + (i / (data.length - 1)) * pw;
            const y = yOf(p[s.key] || 0, max);
            if (i === 0)
                ctx.moveTo(x, y);
            else
                ctx.lineTo(x, y);
        });
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.lineTo(px + pw, py + ph);
        ctx.lineTo(px, py + ph);
        ctx.closePath();
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = s.color;
        ctx.fill();
        ctx.globalAlpha = 1;
    });
    const index = hoverAt !== null ? hoverAt : highlightIndex;
    if (index !== null && data[index]) {
        const x = px + (index / (data.length - 1)) * pw;
        ctx.beginPath();
        ctx.strokeStyle = hoverAt === null ? tok('--bmm-accent', '#3b82f6') : ink;
        ctx.setLineDash([4, 4]);
        ctx.moveTo(x, py);
        ctx.lineTo(x, py + ph);
        ctx.stroke();
        ctx.setLineDash([]);
        const ring = tok('--bmm-bg-elevated', '#111827');
        series.forEach((s, si) => {
            const y = yOf(data[index][s.key] || 0, maxes[si]);
            ctx.beginPath();
            ctx.fillStyle = s.color;
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = ring;
            ctx.lineWidth = 2;
            ctx.stroke();
        });
    }
}
const fmtMsU = (ms) => ms < 1 ? `${(ms * 1000).toFixed(0)} µs` : ms < 1000 ? `${ms.toFixed(1)} ms` : `${(ms / 1000).toFixed(2)} s`;
const fmtTputU = (v) => (v == null) ? '' : (v >= 1000 ? `${(v / 1000).toFixed(2)} GB/s` : `${v.toFixed(0)} MB/s`);
/** Category → the semantic token its bars and edges wear. */
const CAT_TOKEN = { scan: '--bmm-purple', hash: '--bmm-cyan', io: '--bmm-info', archive: '--bmm-warning', activation: '--bmm-success' };
const catVar = (cat) => `var(${CAT_TOKEN[cat] || '--bmm-info'})`;
/** The run to compare against: the one picked in "Compare with", else the most recent OTHER
 *  report in the comparison set. */
function previousReport(report) {
    const picked = compareBase != null ? benchCompare.find(r => r.label === compareBase && r.report !== report) : null;
    const other = picked || benchCompare.find(r => r.report !== report);
    return other ? other.report : null;
}
/** "Compare with [run]": which earlier run the arrows and the total time are measured against. */
function comparePickHtml(report) {
    const others = benchCompare.filter(r => r.report !== report);
    if (!others.length)
        return '';
    const base = previousReport(report);
    return `<label class="pf-cmp-pick"><span>${escB(tt('bench.ui.compareWith', 'Compare with'))}</span><select id="bench-compare-base">${others.map(r => `<option value="${escB(r.label)}"${r.report === base ? ' selected' : ''}>${escB(r.label)}</option>`).join('')}</select></label>`;
}
/** Change of one operation against the previous run: throughput when both have it (higher
 *  is better), time otherwise (lower is better). The arrow is the direction of the number,
 *  the colour (and the hidden word) whether that is good. Within ±2 % it is noise. */
function opDelta(op, prev) {
    if (!prev)
        return '';
    const p = (prev.results || []).find((o) => o.id === op.id);
    if (!p)
        return '';
    const tput = op.throughput_mb_s != null && p.throughput_mb_s != null && p.throughput_mb_s > 0;
    const cur = tput ? op.throughput_mb_s : op.ms, old = tput ? p.throughput_mb_s : p.ms;
    if (!old)
        return '';
    const pct = ((cur - old) / old) * 100;
    const title = escB(tt('bench.ui.vsBase', 'vs the compared run'));
    if (Math.abs(pct) < 2)
        return `<span class="pf-delta" title="${title}">≈ 0 %</span>`;
    const better = tput ? pct > 0 : pct < 0;
    const word = better ? tt('bench.ui.better', 'better') : tt('bench.ui.worse', 'worse');
    return `<span class="pf-delta ${better ? 'pf-delta--better' : 'pf-delta--worse'}" title="${title}">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)} % <span class="pf-sr">${escB(word)}</span></span>`;
}
/** Side-by-side comparison table across the runs in `benchCompare`. Per row,
 *  the best value (highest throughput, else lowest time) is highlighted. */
function benchCompareHtml() {
    if (benchCompare.length < 2)
        return '';
    const runs = benchCompare;
    const order = [];
    const opById = {};
    for (const r of runs)
        for (const o of (r.report.results || [])) {
            if (!(o.id in opById)) {
                opById[o.id] = o;
                order.push(o.id);
            }
        }
    const th = `<th scope="col">${escB(t('bench.cmpOp') || 'Operation')}</th>` + runs.map(r => `<th scope="col">${escB(r.label)}</th>`).join('');
    const body = order.map(id => {
        const cells = runs.map(r => (r.report.results || []).find((o) => o.id === id));
        const hasTput = cells.some(c => c && c.throughput_mb_s != null);
        let bestIdx = -1, bestVal = hasTput ? -Infinity : Infinity;
        cells.forEach((c, i) => { if (!c)
            return; const v = hasTput ? (c.throughput_mb_s ?? -Infinity) : c.ms; if (hasTput ? v > bestVal : v < bestVal) {
            bestVal = v;
            bestIdx = i;
        } });
        const tds = cells.map((c, i) => {
            if (!c)
                return `<td>—</td>`;
            const txt = hasTput ? (fmtTputU(c.throughput_mb_s) || '—') : fmtMsU(c.ms);
            return `<td${i === bestIdx ? ' class="pf-best"' : ''}>${txt}</td>`;
        }).join('');
        return `<tr><td>${escB(opLabel(opById[id]))}</td>${tds}</tr>`;
    }).join('');
    return `<div class="bms-card">
        <div class="bms-card-h">
            <h4 class="bms-card-title">${escB((t('bench.cmpTitle') || 'Comparison').replace('{n}', String(runs.length)))}<small>${runs.length} ${escB(t('bench.cmpRuns') || 'runs')}</small></h4>
            <button type="button" class="btn btn-ghost btn-sm" id="bench-clear-compare">${escB(t('bench.cmpClear') || 'Clear comparison')}</button>
        </div>
        <div class="pf-table-wrap"><table class="pf-table"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>
        <p class="bms-note">${escB(t('bench.cmpHint') || 'Green = best per row (highest throughput, or lowest time).')}</p>
    </div>`;
}
// ── Benchmark results rendering ──────────────────────────────────────────────
function renderBenchResults(container, report) {
    if (!container || !report)
        return;
    const ops = report.results || [];
    const env = report.env || {};
    const prev = previousReport(report);
    const maxMs = Math.max(...ops.map(o => o.ms), 0.0001);
    const rows = ops.map(op => {
        const w = Math.max(2, (op.ms / maxMs) * 100);
        const tp = fmtTputU(op.throughput_mb_s);
        const range = (op.max_ms > op.min_ms) ? `<span class="pf-mono">${fmtMsU(op.min_ms)} – ${fmtMsU(op.max_ms)}</span>` : '';
        const note = opNote(op);
        return `<article class="pf-op" style="--c:${catVar(op.category)}">
            <div class="pf-op-h">
                <span class="pf-op-name">${escB(opLabel(op))}</span>
                <span class="pf-op-v">${fmtMsU(op.ms)}</span>
            </div>
            <div class="pf-bar" aria-hidden="true"><span style="width:${w}%"></span></div>
            <div class="pf-op-meta">${tp ? `<span class="bms-chip">${tp}</span>` : ''}${range}${note ? `<span>${escB(note)}</span>` : ''}${opDelta(op, prev)}</div>
            <p class="pf-op-d">${escB(opDesc(op))}</p>
        </article>`;
    }).join('');
    const dsMb = ((env.dataset_bytes || 0) / 1048576).toFixed(1);
    const best = ops.filter(o => o.throughput_mb_s != null).sort((a, b) => b.throughput_mb_s - a.throughput_mb_s)[0];
    // Total time against the previous run: lower is better, said by colour AND by word.
    let totalDelta = '';
    if (prev?.total_ms && report.total_ms) {
        const pct = ((report.total_ms - prev.total_ms) / prev.total_ms) * 100;
        const cls = Math.abs(pct) < 2 ? '' : pct < 0 ? ' pf-delta--better' : ' pf-delta--worse';
        const word = Math.abs(pct) < 2 ? '' : ` <span class="pf-sr">${escB(pct < 0 ? tt('bench.ui.better', 'better') : tt('bench.ui.worse', 'worse'))}</span>`;
        totalDelta = `<span class="pf-delta${cls}">${Math.abs(pct) < 2 ? '≈ 0 %' : `${pct < 0 ? '▼' : '▲'} ${Math.abs(pct).toFixed(1)} %`}${word}</span> ${escB(tt('bench.ui.vsBase', 'vs the compared run'))}`;
    }
    const kpi = (label, value, sub, subHtml = '') => `<div class="pf-kpi"><span class="bms-label">${escB(label)}</span><span class="pf-kpi-v">${escB(value)}</span><span class="pf-kpi-s">${subHtml || escB(sub)}</span></div>`;
    const chip = (label, value) => `<span class="bms-chip">${escB(label)} <b>${escB(value)}</b></span>`;
    const chartTput = benchSvgChart(ops, 'tput', true);
    container.innerHTML = `
        <div class="pf-res-head">
            <div class="pf-env">
                ${chip(t('bench.colMode') || 'Mode', env.mode === 'real' ? (t('bench.real') || 'Real') : (t('bench.sandbox') || 'Sandbox'))}
                ${chip('CPU', `${env.cores || '?'} ${t('bench.cores') || 'cores'}`)}
                ${env.disk ? chip(t('bench.disk') || 'Disk', String(env.disk)) : ''}
                ${env.reps ? chip(t('bench.samples') || 'Samples', `${env.reps}× ${t('bench.eachOp') || 'each op'}`) : ''}
            </div>
            <div class="bms-toolbar">
                ${comparePickHtml(report)}
                <button type="button" class="btn btn-ghost btn-sm" id="bench-copy-json">${escB(t('bench.copyJson') || 'Copy JSON')}</button>
                <button type="button" class="btn btn-secondary btn-sm" id="bench-export-html">${escB(t('bench.exportReport') || 'Export report')}</button>
            </div>
        </div>
        <div class="pf-kpis">
            ${kpi(tt('bench.ui.totalTime', 'Total time'), fmtMsU(report.total_ms || 0), prev ? '' : tt('bench.ui.noPrev', 'Run again to compare with this run.'), totalDelta)}
            ${kpi(t('bench.colDataset') || 'Dataset', `${dsMb} MB`, `${env.dataset_files || 0} ${t('bench.files') || 'files'}`)}
            ${best ? kpi(tt('bench.ui.bestTput', 'Best throughput'), fmtTputU(best.throughput_mb_s), opLabel(best)) : ''}
            ${kpi(tt('bench.ui.opsCount', 'Operations'), String(ops.length), benchCompare.length > 1 ? `${benchCompare.length} ${t('bench.cmpRuns') || 'runs'}` : '')}
        </div>
        <div class="pf-res-charts">
            <div class="bms-card"><h4 class="bms-card-title">${escB(t('bench.chartTime') || 'Operation time')}<small>${escB(t('bench.lowerBetter') || 'lower is better')}</small></h4>${benchSvgChart(ops, 'time', true)}</div>
            ${chartTput ? `<div class="bms-card"><h4 class="bms-card-title">${escB(t('bench.chartTput') || 'Throughput')}<small>${escB(t('bench.higherBetter') || 'higher is better')}</small></h4>${chartTput}</div>` : ''}
        </div>
        <div class="pf-ops">${rows}</div>
        ${benchCompareHtml()}`;
    const copyBtn = container.querySelector('#bench-copy-json');
    if (copyBtn)
        copyBtn.onclick = async () => {
            try {
                await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
                toast(t('bench.copied') || 'Results copied to clipboard', 'success');
            }
            catch {
                toast(t('bench.copyFailed') || 'Could not copy', 'error');
            }
        };
    const exportBtn = container.querySelector('#bench-export-html');
    if (exportBtn)
        exportBtn.onclick = async () => {
            try {
                const dest = await saveFile({ defaultPath: 'bmm-benchmark-report.html', filters: [{ name: 'HTML', extensions: ['html'] }] });
                if (!dest)
                    return;
                await invoke('write_text_file', { path: dest, content: buildBenchReportHtml(report) });
                toast((t('bench.reportSaved') || 'Report saved') + ': ' + dest, 'success');
            }
            catch (e) {
                toast((t('bench.reportFailed') || 'Could not save report') + ': ' + e, 'error');
            }
        };
    const basePick = container.querySelector('#bench-compare-base');
    if (basePick)
        basePick.onchange = () => { compareBase = basePick.value; renderBenchResults(container, report); };
    const clearCmpBtn = container.querySelector('#bench-clear-compare');
    if (clearCmpBtn)
        clearCmpBtn.onclick = () => {
            // Keep only the run currently on screen, drop the rest of the comparison.
            benchCompare = lastBenchReport ? benchCompare.filter(r => r.report === lastBenchReport).slice(0, 1) : [];
            renderBenchResults(container, report);
        };
}
// ── i18n for benchmark results ───────────────────────────────────────────────
// The backend sends stable ids + English label/explanation; we translate by id
// (falling back to the backend text) so the whole results view is localised.
const OP_LABEL_KEY = {
    scan: 'bench.opScan', hash: 'bench.opHash', copy_full: 'bench.opCopyFull', copy_smart: 'bench.opCopySmart',
    archive_extract: 'bench.opArchive', activate: 'bench.opActivate', activate_zip: 'bench.opActivateZip', deactivate: 'bench.opDeactivate', cancel: 'bench.opCancel',
    verify: 'bench.opVerify',
};
const OP_DESC_KEY = {
    scan: 'bench.d.scan', hash: 'bench.d.hash', copy_full: 'bench.d.copyFull', copy_smart: 'bench.d.copySmart',
    archive_extract: 'bench.d.archive', activate: 'bench.d.activate', deactivate: 'bench.d.deactivate', cancel: 'bench.d.cancel',
};
function opLabel(op) { const k = OP_LABEL_KEY[op.id]; return (k ? t(k) : '') || op.label || op.id; }
function opDesc(op) { const k = OP_DESC_KEY[op.id]; return (k ? t(k) : '') || op.explanation || ''; }
function opNote(op) {
    if (op.id === 'scan')
        return `${op.items} ${t('bench.files') || 'files'}`;
    if (op.id === 'cancel')
        return t('bench.d.cancelNote') || op.note || '';
    return op.note || '';
}
// Inline SVG horizontal bar chart for a metric — used both in the live results
// panel (`themed`: colours from the theme tokens) and the exported HTML (a standalone
// document with no BMM stylesheet, so it keeps fixed colours).
function benchSvgChart(ops, metric, themed = false) {
    const catColor = { scan: '#a78bfa', hash: '#22d3ee', io: '#3b82f6', archive: '#fbbf24', activation: '#10b981' };
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const rows = metric === 'tput' ? ops.filter(o => o.throughput_mb_s != null) : ops.slice();
    if (!rows.length)
        return '';
    const val = (o) => metric === 'tput' ? (o.throughput_mb_s || 0) : o.ms;
    const fmt = metric === 'tput'
        ? (v) => v >= 1000 ? `${(v / 1000).toFixed(2)} GB/s` : `${v.toFixed(0)} MB/s`
        : (v) => v < 1 ? `${(v * 1000).toFixed(0)} µs` : v < 1000 ? `${v.toFixed(1)} ms` : `${(v / 1000).toFixed(2)} s`;
    // Paint: an attribute for the standalone report, a themed style for the app.
    const paint = (lit, cssVar) => themed ? `style="fill:${cssVar}"` : `fill="${lit}"`;
    const inkLabel = paint('#cbd5e1', 'var(--bmm-text-secondary)');
    const inkValue = paint('#e2e8f0', 'var(--bmm-text-primary)');
    const axis = themed ? 'style="stroke:var(--bmm-border-hover)"' : 'stroke="rgba(148,163,184,0.25)"';
    // The time chart draws each op's min–max band too: the scale must hold the band's end.
    const max = Math.max(...rows.map(o => metric === 'time' ? Math.max(o.ms, o.max_ms || 0) : val(o)), 1e-9);
    // The label column grows with the longest label (a French one is longer) instead of
    // pushing its first letters out of the viewBox.
    const longest = Math.max(...rows.map(o => opLabel(o).length));
    const rowH = 30, padL = Math.max(150, Math.round(longest * 6.2 + 14)), padR = 96, top = 6, barW = 214;
    const W = padL + barW + padR;
    const H = top + rows.length * rowH + 6;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif" role="img" aria-label="${esc(metric === 'tput' ? (t('bench.chartTput') || 'Throughput') : (t('bench.chartTime') || 'Operation time'))}">`;
    s += `<line x1="${padL}" y1="${top}" x2="${padL}" y2="${H - 6}" ${axis} stroke-width="1"/>`;
    rows.forEach((o, i) => {
        const y = top + i * rowH;
        const col = paint(catColor[o.category] || '#3b82f6', catVar(o.category));
        const med = Math.max(2, (val(o) / max) * barW);
        s += `<text x="${padL - 8}" y="${y + 15}" text-anchor="end" font-size="11" ${inkLabel}>${esc(opLabel(o))}</text>`;
        // For the time chart, draw the min–max sample range as a faint band behind
        // the median bar — a compact distribution view (like Criterion's spread).
        if (metric === 'time' && o.max_ms > o.min_ms) {
            const xMin = (o.min_ms / max) * barW, xMax = (o.max_ms / max) * barW;
            s += `<rect x="${padL + xMin}" y="${y + 7}" width="${Math.max(1, xMax - xMin)}" height="11" rx="2" ${col} opacity="0.28"/>`;
        }
        s += `<rect x="${padL}" y="${y + 5}" width="${med}" height="15" rx="3" ${col}/>`;
        s += `<text x="${padL + Math.max(med, metric === 'time' && o.max_ms > o.min_ms ? (o.max_ms / max) * barW : med) + 6}" y="${y + 15}" font-size="10.5" ${inkValue} font-family="ui-monospace,monospace">${fmt(val(o))}</text>`;
    });
    return s + '</svg>';
}
// Build a self-contained HTML report (inline SVG charts + table) from a
// BenchReport — the same presentable format as the dev suite's deck.
function buildBenchReportHtml(report) {
    const ops = report.results || [];
    const env = report.env || {};
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const fmtMs = (ms) => ms < 1 ? `${(ms * 1000).toFixed(0)} µs` : ms < 1000 ? `${ms.toFixed(1)} ms` : `${(ms / 1000).toFixed(2)} s`;
    const fmtTput = (v) => (v == null) ? '' : (v >= 1000 ? `${(v / 1000).toFixed(2)} GB/s` : `${v.toFixed(0)} MB/s`);
    const catColor = { scan: '#a78bfa', hash: '#22d3ee', io: '#3b82f6', archive: '#fbbf24', activation: '#10b981' };
    const chartTput = benchSvgChart(ops, 'tput');
    const charts = `<div style="display:grid;grid-template-columns:${chartTput ? '1fr 1fr' : '1fr'};gap:16px">
        <div class="card"><h2 style="font-size:13px;margin:0 0 10px;color:#94a3b8">Operation time · lower is better</h2>${benchSvgChart(ops, 'time')}</div>
        ${chartTput ? `<div class="card"><h2 style="font-size:13px;margin:0 0 10px;color:#94a3b8">Throughput · higher is better</h2>${chartTput}</div>` : ''}
    </div>`;
    const rowsHtml = ops.map(op => {
        const note = opNote(op);
        return `<tr>
        <td style="font-weight:600;color:#f1f5f9;">${esc(opLabel(op))}</td>
        <td style="font-family:ui-monospace,monospace;color:${catColor[op.category] || '#3b82f6'};white-space:nowrap;">${fmtMs(op.ms)}${op.max_ms > op.min_ms ? ` <span style="color:#64748b">(${fmtMs(op.min_ms)}–${fmtMs(op.max_ms)})</span>` : ''}</td>
        <td style="font-family:ui-monospace,monospace;color:#94a3b8;">${fmtTput(op.throughput_mb_s)}</td>
        <td style="color:#94a3b8;font-size:12px;">${esc(opDesc(op))}${note ? ` <em>(${esc(note)})</em>` : ''}</td>
    </tr>`;
    }).join('');
    const dsMb = ((env.dataset_bytes || 0) / 1048576).toFixed(1);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>BMM — Benchmark Report</title>
<style>:root{color-scheme:dark}body{margin:0;background:#0a0f1e;color:#e2e8f0;font:15px/1.5 system-ui,sans-serif;padding:32px}
h1{margin:0 0 4px;font-size:24px}.meta{color:#94a3b8;font-size:13px;margin-bottom:24px}
.card{background:#111a2e;border:1px solid #1e293b;border-radius:14px;padding:20px 24px;margin-bottom:18px}
table{width:100%;border-collapse:collapse;font-size:14px}td{padding:9px 10px;border-bottom:1px solid #1e293b;vertical-align:top}
th{text-align:left;padding:9px 10px;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #1e293b}
</style></head><body>
<h1>BetterModsManager — Benchmark Report</h1>
<div class="meta">${esc(new Date().toLocaleString())} · mode: <b style="color:#fff">${esc(env.mode)}</b> · dataset: <b style="color:#fff">${env.dataset_files || 0} files · ${dsMb} MB</b> · ${env.cores || '?'} cores${env.disk ? ` · disk ${esc(env.disk)}` : ''}${env.reps ? ` · ${env.reps}× samples/op` : ''} · ${esc(env.os)} · total ${fmtMs(report.total_ms || 0)}</div>
${charts}
<div class="card"><table><thead><tr><th>Operation</th><th>Time</th><th>Throughput</th><th>What it measures</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
<footer style="color:#64748b;font-size:12px">Generated by BMM's in-app benchmark. Operations run on a ${esc(env.mode)} dataset; writes occur only in a temporary workspace.</footer>
</body></html>`;
}
// Compatibility exports
export function openBenchmarkModal() { openAdvancedPerfModal(); }
// Allow inline doc/gallery buttons to open the benchmark panel directly.
window.bmmOpenBenchmark = () => openAdvancedPerfModal();
export function startBenchmark() { invoke('start_benchmark'); }
export function stopBenchmark() { invoke('stop_benchmark'); }
//# sourceMappingURL=benchmark.js.map