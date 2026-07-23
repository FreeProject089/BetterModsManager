import { invoke, listen, pickFile, pickFolder, saveFile } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';
import { debugHub } from '../debug/debug.js';
import { showTaskyHelp, hideTaskyHelp } from '../../docs/interactive-docs.js';

interface BenchmarkPoint {
    timestamp: number;
    cpu_usage: number;
    ram_usage: number;
    disk_read: number;
    disk_write: number;
    network_latency?: number;
    thread_count?: number;
    ram_virtual?: number;
    ram_swap?: number;
    async_tasks?: number;
    global_cpu?: number;
    process_uptime?: number;
}

let benchmarkData: BenchmarkPoint[] = [];
let isAdvancedMode = false;
let isLiveView = true;
let isRecording = true;
let benchmarkUnlisten: (() => void) | null = null;
let benchProgressUnlisten: (() => void) | null = null;
// Benchmark run state kept at module scope so the run survives closing/reopening
// the modal (it keeps running in the background) and can be restored/cancelled.
let lastBenchReport: any = null;
let benchRunning = false;
let benchLastPct = 0;
let benchLastLabel = '';
// Bumped on every run/cancel so a stale (still-aborting) run can't clobber the UI
// of a newer one.
let benchRunGen = 0;
// Loaded/run benchmark reports kept for side-by-side comparison (capped).
let benchCompare: Array<{ label: string; report: any }> = [];
// Set by openBenchmarkWithConfig() so a programmatic open (API / deep link) can
// pre-fill the dataset/size/sources and optionally auto-start the run. Consumed
// once when the modal finishes building.
let pendingBenchConfig: { dataset?: string; size?: string; mb?: number; sources?: string[]; autoRun?: boolean } | null = null;

/**
 * Open the benchmark modal pre-configured — used by the public API and the
 * `bmm://benchmark/run` deep link. `autoRun: true` starts the run immediately
 * (auto mode); otherwise everything is set up and the user clicks Run (manual mode).
 */
export async function openBenchmarkWithConfig(
    cfg: { dataset?: string; size?: string; mb?: number; sources?: string[]; profiles?: string[]; autoRun?: boolean },
): Promise<void> {
    const sources = [...(cfg.sources || [])];
    // Resolve profile ids/names → their mods folder, and merge with explicit folders.
    if (Array.isArray(cfg.profiles) && cfg.profiles.length) {
        try {
            const profs = (await invoke('get_profiles') as any[]) || [];
            for (const pid of cfg.profiles) {
                const p = profs.find((x: any) => x.id === pid || x.name === pid);
                if (p?.mods_path && !sources.includes(p.mods_path)) sources.push(p.mods_path);
            }
        } catch { /* ignore */ }
    }
    const dataset = (cfg.dataset === 'real' || sources.length) ? 'real' : (cfg.dataset || 'sandbox');
    pendingBenchConfig = { dataset, size: cfg.size, mb: cfg.mb, sources, autoRun: cfg.autoRun };
    // Rebuild from scratch so the config is applied even if the modal was already open.
    document.getElementById('modal-advanced-perf-overlay')?.remove();
    await openAdvancedPerfModal();
}

/** Add a report to the comparison set (most-recent first, max 6). */
function addBenchToCompare(label: string, report: any): void {
    if (!report || !Array.isArray(report.results)) return;
    benchCompare.unshift({ label, report });
    if (benchCompare.length > 6) benchCompare.length = 6;
}

/** Flatten a benchmark report to CSV (one row per operation). */
function benchReportToCsv(report: any): string {
    const head = 'id,label,category,ms,min_ms,max_ms,throughput_mb_s,bytes,items,note';
    const esc = (v: any) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = (report.results || []).map((o: any) =>
        [o.id, o.label, o.category, o.ms, o.min_ms, o.max_ms, o.throughput_mb_s, o.bytes, o.items, o.note]
            .map(esc).join(','));
    return [head, ...rows].join('\n');
}

/** Parse a benchmark report from JSON or CSV text into the report shape. */
function parseBenchReportText(text: string): any | null {
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) {
        try { const j = JSON.parse(trimmed); if (Array.isArray(j.results)) return j; } catch {}
        return null;
    }
    // CSV: split respecting simple quoting.
    const lines = trimmed.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return null;
    const splitCsv = (line: string): string[] => {
        const out: string[] = []; let cur = ''; let q = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
            else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
        }
        out.push(cur); return out;
    };
    const head = splitCsv(lines[0]).map(h => h.trim());
    const idx = (k: string) => head.indexOf(k);
    const num = (v: string) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
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
let hoverIndex: number | null = null;
let miniMonitorActive = false;
let seekIndex: number | null = null;

// Initialization
export async function initBenchmark() {
    const isEnabled = await invoke('is_benchmark_enabled');
    const btn = document.getElementById('btn-open-benchmark');
    if (!isEnabled) {
        if (btn) btn.style.display = 'none';
        return;
    }

    if (btn) {
        btn.style.display = 'flex';
        btn.onclick = () => {
            const modal = document.getElementById('modal-advanced-perf-overlay');
            const mini = document.getElementById('bmm-mini-monitor');
            
            if (modal && modal.classList.contains('open') && modal.style.display !== 'none') {
                const closeBtn = modal.querySelector('#perf-modal-close') as HTMLElement;
                closeBtn?.click();
            } else if (mini) {
                toggleMiniMonitor(false);
                openAdvancedPerfModal();
            } else {
                openAdvancedPerfModal();
            }
        };
    }
}

// Helper for dynamic units
function formatUnit(val: number, type: 'MB' | 'KB/s' | 's'): string {
    if (type === 's') {
        const h = Math.floor(val / 3600);
        const m = Math.floor((val % 3600) / 60);
        const s = Math.floor(val % 60);
        return `${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${s}s`;
    }
    if (val < 1024) return `${val.toFixed(0)} ${type}`;
    const base = 1024;
    const units = type === 'MB' ? ['MB', 'GB', 'TB'] : ['KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(val) / Math.log(base));
    return (val / Math.pow(base, i)).toFixed(2) + ' ' + units[i];
}

export async function openAdvancedPerfModal() {
    const existing = document.getElementById('modal-advanced-perf-overlay');
    if (existing) {
        existing.classList.add('open');
        existing.style.display = 'flex';
        existing.style.opacity = '1';
        return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'modal-advanced-perf-overlay';
    overlay.className = 'modal-overlay open';
    overlay.style.zIndex = '100003';
    overlay.style.backdropFilter = 'blur(16px)';
    
    const content = document.createElement('div');
    content.className = 'modal glass';
    content.style.width = '1200px'; 
    content.style.maxWidth = '95vw';
    content.style.borderRadius = '28px';
    content.style.overflow = 'visible'; 
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.maxHeight = '92vh';
    content.style.border = '1px solid rgba(255,255,255,0.1)';
    content.style.position = 'relative';

    content.innerHTML = `
        <div class="modal-header" style="padding: 24px 32px; background: rgba(255,255,255,0.03); border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; border-radius: 28px 28px 0 0; z-index: 10;">
            <div style="display: flex; align-items: center; gap: 16px;">
                <div style="width: 44px; height: 44px; background: rgba(59, 130, 246, 0.15); border-radius: 12px; display: flex; align-items: center; justify-content: center; color: var(--accent);">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                </div>
                <div>
                    <h2 style="margin:0; font-size: 1.25rem; font-weight: 800; color: #fff;">${t('bench.title') || 'Benchmark'}</h2>
                    <p id="perf-subtitle" style="margin: 2px 0 0; font-size: 0.75rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">${t('bench.subtitle') || 'Live Diagnostics & Replay'}</p>
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
                <div id="perf-tabs" style="display:flex; gap:4px; background:rgba(0,0,0,0.28); padding:3px; border-radius:10px; margin-right:6px;">
                    <button class="perf-tab active" data-mode="live">${t('bench.tabLive') || 'Live Monitor'}</button>
                    <button class="perf-tab" data-mode="bench">${t('bench.tabBench') || 'Benchmark'}</button>
                </div>
                <div id="perf-live-controls" style="display: flex; align-items: center; gap: 12px;">
                <button class="btn btn-ghost btn-sm" id="btn-perf-rec" style="gap:8px; border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 8px; color: #ef4444;">
                    <div id="rec-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #ef4444; box-shadow: 0 0 8px #ef4444;"></div>
                    <span id="rec-text">${t('bench.stopRec') || 'Stop Recording'}</span>
                </button>
                <div style="width: 1px; height: 24px; background: var(--border); margin: 0 8px;"></div>
                <button class="btn btn-ghost btn-sm" id="btn-perf-mini" style="gap:8px; color: var(--accent); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 8px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 15h4v4h-4z"/></svg>
                    ${t('bench.miniMonitor') || 'Mini-Monitor'}
                </button>
                <div id="live-controls" style="display: flex; align-items: center; gap: 12px; margin-left: 12px; border-left: 1px solid var(--border); padding-left: 12px;">
                    <label class="bmm-switch" style="margin-right: 8px;">
                        <input type="checkbox" id="perf-advanced-toggle">
                        <span class="bmm-switch-track"><span class="bmm-switch-thumb"></span></span>
                    </label>
                    <span style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">${t('bench.advanced') || 'Advanced'}</span>
                </div>
                </div>
                <button class="modal-close" id="perf-modal-close" style="position: static; margin-left: 20px;">&times;</button>
            </div>
        </div>

        <div class="modal-body" style="padding: 32px; overflow-y: auto; overflow-x: visible; flex: 1; display: flex; flex-direction: column; gap: 24px; z-index: 1;">
            <div id="perf-live-view" style="display:flex; flex-direction:column; gap:24px;">

            <!-- Real-time Stats + Averages -->
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px;">
                <div class="glass-card" style="padding: 24px; background: rgba(0,0,0,0.3); border-radius: 20px; position: relative; overflow: hidden;">
                    <span class="label" style="display:block; font-size: 11px; color: var(--text-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">${t('bench.cpuAvg') || 'CPU Usage (Avg)'}</span>
                    <div style="display: flex; align-items: baseline; gap: 8px;">
                        <span id="perf-cpu-val" style="font-size: 32px; font-weight: 900; color: var(--accent); font-family: var(--font-mono);">0.0%</span>
                        <span id="perf-cpu-avg" style="font-size: 14px; color: var(--text-muted); font-weight: 600;">avg: 0%</span>
                    </div>
                    <div id="mini-activity-cpu" style="position: absolute; bottom: 0; left: 0; right: 0; height: 30px; opacity: 0.2;"></div>
                </div>
                <div class="glass-card" style="padding: 24px; background: rgba(0,0,0,0.3); border-radius: 20px;">
                    <span class="label" style="display:block; font-size: 11px; color: var(--text-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">${t('bench.ramPeak') || 'RAM Usage (Peak)'}</span>
                    <div style="display: flex; align-items: baseline; gap: 8px;">
                        <span id="perf-ram-val" style="font-size: 32px; font-weight: 900; color: #fff; font-family: var(--font-mono);">0 MB</span>
                        <span id="perf-ram-peak" style="font-size: 14px; color: var(--text-muted); font-weight: 600;">peak: 0</span>
                    </div>
                </div>
                <div class="glass-card" style="padding: 24px; background: rgba(0,0,0,0.3); border-radius: 20px;">
                    <span class="label" style="display:block; font-size: 11px; color: var(--text-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">${t('bench.diskIo') || 'Disk I/O R/W'}</span>
                    <span id="perf-disk-val" style="font-size: 24px; font-weight: 900; color: #fbbf24; font-family: var(--font-mono);">0 / 0 KB/s</span>
                </div>
                <div class="glass-card" style="padding: 24px; background: rgba(0,0,0,0.3); border-radius: 20px;">
                    <span class="label" style="display:block; font-size: 11px; color: var(--text-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">${t('bench.uptime') || 'Process Uptime'}</span>
                    <span id="perf-uptime-val" style="font-size: 24px; font-weight: 900; color: #10b981; font-family: var(--font-mono);">0s</span>
                </div>
            </div>

            <!-- Charts -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
                <div class="glass-card chart-container" style="padding: 24px; background: rgba(255,255,255,0.02); position: relative; border-radius: 20px;">
                    <h3 style="margin: 0 0 20px; font-size: 13px; color: #fff; text-transform: uppercase; font-weight: 800; letter-spacing: 0.05em;">${t('bench.sysHist') || 'System Resources History'}</h3>
                    <canvas id="perf-chart-main" style="width: 100%; height: 320px; cursor: crosshair;"></canvas>
                </div>

                <div class="glass-card chart-container" style="padding: 24px; background: rgba(255,255,255,0.02); position: relative; border-radius: 20px;">
                    <h3 style="margin: 0 0 20px; font-size: 13px; color: #fff; text-transform: uppercase; font-weight: 800; letter-spacing: 0.05em;">${t('bench.ioHist') || 'Disk Throughput History'}</h3>
                    <canvas id="perf-chart-io" style="width: 100%; height: 320px; cursor: crosshair;"></canvas>
                </div>
            </div>

            <!-- Seek Bar / Replay -->
            <div class="glass-card" style="padding: 20px; background: rgba(0,0,0,0.4); border-radius: 16px; display: flex; flex-direction: column; gap: 12px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <button class="btn btn-primary btn-sm" id="btn-perf-live" style="background: var(--accent); border-radius: 6px; font-size: 10px; padding: 4px 10px; display: none;">${t('bench.liveMode') || 'BACK TO LIVE'}</button>
                        <span id="replay-time" style="font-size: 12px; color: var(--text-muted); font-family: var(--font-mono); font-weight: 700;">${t('bench.replayTime') || 'Replay'}: 00:00:00</span>
                    </div>
                    <span style="font-size: 10px; color: var(--text-muted); font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;">${t('bench.timelineActivity') || 'Timeline Activity Map'}</span>
                </div>
                <div style="position: relative; height: 36px; background: rgba(255,255,255,0.02); border-radius: 8px; cursor: pointer;" id="timeline-container">
                    <canvas id="activity-heatmap" style="width: 100%; height: 100%; position: absolute; top: 0; left: 0; pointer-events: none; opacity: 0.6;"></canvas>
                    <div id="timeline-seek-handle" style="position: absolute; top: -4px; left: 0; width: 4px; height: 44px; background: var(--accent); box-shadow: 0 0 15px var(--accent); border-radius: 2px; transition: left 0.1s linear;"></div>
                </div>
            </div>

            <!-- Advanced Metrics with Tasky Help -->
            <div id="perf-advanced-section" style="display: none; flex-direction: column; gap: 20px;">
                <div style="height: 1px; background: var(--border); margin: 8px 0;"></div>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;">
                    <div class="glass-card" style="padding: 20px; background: rgba(59, 130, 246, 0.05); border-radius: 12px; position: relative;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <span style="font-size: 10px; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">${t('bench.network') || 'Net Latency'}</span>
                            <span class="tasky-info" data-help="latency" style="cursor: help; color: var(--accent); opacity: 0.6;">?</span>
                        </div>
                        <span id="perf-net-val" style="font-size: 20px; font-weight: 900; color: var(--accent); font-family: var(--font-mono);">-- ms</span>
                    </div>
                    <div class="glass-card" style="padding: 20px; background: rgba(59, 130, 246, 0.05); border-radius: 12px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <span style="font-size: 10px; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">${t('bench.globalCpu') || 'Global CPU Load'}</span>
                            <span class="tasky-info" data-help="global_cpu" style="cursor: help; color: var(--accent); opacity: 0.6;">?</span>
                        </div>
                        <span id="perf-global-cpu-val" style="font-size: 20px; font-weight: 900; color: #fff; font-family: var(--font-mono);">-- %</span>
                    </div>
                    <div class="glass-card" style="padding: 20px; background: rgba(59, 130, 246, 0.05); border-radius: 12px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <span style="font-size: 10px; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">${t('bench.virtual') || 'Virtual Memory'}</span>
                            <span class="tasky-info" data-help="virtual" style="cursor: help; color: var(--accent); opacity: 0.6;">?</span>
                        </div>
                        <span id="perf-vram-val" style="font-size: 20px; font-weight: 900; color: #fff; font-family: var(--font-mono);">-- MB</span>
                    </div>
                </div>
            </div>
            </div> <!-- /perf-live-view -->

            <!-- ── Benchmark view ───────────────────────────────────────── -->
            <div id="perf-bench-view" style="display:none; flex-direction:column; gap:20px;">
                <div class="glass-card" style="padding:18px 22px; background:rgba(0,0,0,0.28); border-radius:16px; display:flex; flex-wrap:wrap; align-items:flex-end; gap:22px;">
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        <span style="font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.08em; color:var(--text-muted);">${t('bench.dataset') || 'Dataset'}</span>
                        <div id="bench-mode-seg" style="display:flex; gap:3px; background:rgba(0,0,0,0.32); padding:3px; border-radius:9px;">
                            <button class="bench-seg active" data-mode="sandbox">${t('bench.sandbox') || 'Sandbox'}</button>
                            <button class="bench-seg" data-mode="real">${t('bench.myMods') || 'My mods'}</button>
                        </div>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        <span style="font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.08em; color:var(--text-muted);">${t('bench.scale') || 'Size'}</span>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div id="bench-scale-seg" style="display:flex; gap:3px; background:rgba(0,0,0,0.32); padding:3px; border-radius:9px;">
                                <button class="bench-seg" data-scale="small" data-tooltip="${t('bench.sizeSmallTip') || '~6 MB'}">S</button>
                                <button class="bench-seg active" data-scale="medium" data-tooltip="${t('bench.sizeMediumTip') || '~48 MB'}">M</button>
                                <button class="bench-seg" data-scale="large" data-tooltip="${t('bench.sizeLargeTip') || '~160 MB'}">L</button>
                                <button class="bench-seg" data-scale="xlarge" data-tooltip="${t('bench.xlargeTip') || '~400 MB'}">XL</button>
                                <button class="bench-seg" data-scale="custom" data-tooltip="${t('bench.sizeCustomTip') || 'Custom total size'}">${t('bench.sizeCustom') || 'Custom'}</button>
                            </div>
                            <div id="bench-custom-wrap" style="display:none; align-items:center; gap:5px;">
                                <input id="bench-custom-mb" type="number" min="1" max="8192" value="250" data-tooltip="${t('bench.sizeCustomMaxTip') || 'Total dataset size in MB (1–8192).'}" style="width:74px; height:30px; background:rgba(0,0,0,0.32); border:1px solid var(--bmm-s08,rgba(255,255,255,0.08)); border-radius:8px; color:var(--text-primary); font-size:12px; font-weight:700; text-align:right; padding:0 7px;" />
                                <span style="font-size:11px; font-weight:700; color:var(--text-muted);">MB</span>
                                <span style="font-size:11px; color:var(--text-muted); margin:0 1px;">×</span>
                                <input id="bench-custom-files" type="number" min="1" max="200000" placeholder="auto" data-tooltip="${t('bench.filesCountTip') || 'Number of files (blank = auto from size). Raise it to stress-test scanning/hashing of many files.'}" style="width:78px; height:30px; background:rgba(0,0,0,0.32); border:1px solid var(--bmm-s08,rgba(255,255,255,0.08)); border-radius:8px; color:var(--text-primary); font-size:12px; font-weight:700; text-align:right; padding:0 7px;" />
                                <span style="font-size:11px; font-weight:700; color:var(--text-muted);">${t('bench.filesUnit') || 'files'}</span>
                            </div>
                        </div>
                    </div>
                    <div style="flex:1 1 auto;"></div>
                    <button class="btn btn-primary" id="btn-bench-run" style="height:42px; padding:0 28px; border-radius:11px; font-weight:800; gap:8px;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        ${t('bench.run') || 'Run Benchmark'}
                    </button>
                    <button class="btn btn-danger" id="btn-bench-cancel" style="display:none; height:42px; padding:0 22px; border-radius:11px; font-weight:800; gap:8px;">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                        ${t('bench.cancel') || 'Cancel'}
                    </button>
                </div>

                <div id="bench-realnote" style="display:none; font-size:12px; color:#fbbf24; background:rgba(251,191,36,0.08); border:1px solid rgba(251,191,36,0.2); border-radius:10px; padding:10px 14px;">
                    ${t('bench.realNote') || '“My mods” uses the real mods of the selected profile(s) as test data — they are only read, never changed. Every operation (copy, activate, deactivate…) runs in a temporary workspace, so your game folder is never touched. Gives you numbers for your actual library instead of synthetic files.'}
                </div>

                <div id="bench-sources" style="display:none; flex-direction:column; gap:10px; background:rgba(0,0,0,0.22); border:1px solid var(--border); border-radius:12px; padding:14px 16px;">
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
                        <span style="font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; color:var(--text-muted); display:flex; align-items:center; gap:8px;">
                            ${t('bench.chooseProfiles') || 'Profiles to benchmark'}
                            <span id="bench-src-count" style="font-size:10px; font-weight:700; color:var(--accent); background:rgba(59,130,246,0.12); padding:2px 7px; border-radius:99px;"></span>
                        </span>
                        <div style="display:flex; gap:6px;">
                            <button class="bench-seg" id="bench-src-all">${t('bench.selectAll') || 'All'}</button>
                            <button class="bench-seg" id="bench-src-none">${t('bench.selectNone') || 'None'}</button>
                            <button class="bench-seg" id="bench-src-custom" style="display:inline-flex; align-items:center; gap:5px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>${t('bench.customFolder') || 'Folder'}</button>
                        </div>
                    </div>
                    <div id="bench-src-list" style="display:flex; flex-wrap:wrap; gap:8px; max-height:168px; overflow-y:auto; padding:2px;"></div>
                </div>

                <div id="bench-progress-wrap" style="display:none; flex-direction:column; gap:8px;">
                    <div style="display:flex; justify-content:space-between; font-size:12px;">
                        <span id="bench-progress-label" style="color:var(--text-secondary); font-weight:600;"></span>
                        <span id="bench-progress-pct" style="color:var(--accent); font-family:var(--font-mono); font-weight:700;">0%</span>
                    </div>
                    <div style="height:8px; background:rgba(255,255,255,0.06); border-radius:4px; overflow:hidden;">
                        <div id="bench-progress-bar" style="height:100%; width:0%; background:var(--accent); transition:width .2s ease; box-shadow:0 0 10px var(--accent);"></div>
                    </div>
                </div>

                <div id="bench-intro" style="background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:16px; padding:28px 30px; color:var(--text-secondary); font-size:13px; line-height:1.7;">
                    <h3 style="margin:0 0 12px; font-size:15px; color:#fff;">${t('bench.introTitle') || 'Full operation benchmark'}</h3>
                    ${t('bench.introBody') || 'Runs BMM’s real hot-path operations on a controlled dataset and reports how fast each one is, with throughput. It covers everything BMM does to your mods:'}
                    <ul style="margin:12px 0 0; padding-left:18px; columns:2; gap:24px;">
                        <li>${t('bench.opScan') || 'Scanning mod files'}</li>
                        <li>${t('bench.opHash') || 'SHA-256 integrity hashing'}</li>
                        <li>${t('bench.opCopyFull') || 'Copy — full speed'}</li>
                        <li>${t('bench.opCopySmart') || 'Copy — Smart I/O'}</li>
                        <li>${t('bench.opArchive') || 'Extracting archived mods'}</li>
                        <li>${t('bench.opActivate') || 'Activating a mod'}</li>
                        <li>${t('bench.opDeactivate') || 'Deactivating a mod'}</li>
                        <li>${t('bench.opCancel') || 'Cancelling an operation'}</li>
                    </ul>
                </div>

                <div id="bench-results" style="display:none; flex-direction:column; gap:18px;"></div>
            </div>
        </div>

        <div class="modal-footer" style="padding: 24px 32px; border-top: 1px solid var(--border); background: rgba(0,0,0,0.2); display: flex; justify-content: flex-end; align-items: center; gap: 16px; border-radius: 0 0 28px 28px;">
            <button class="btn btn-ghost" id="btn-perf-import" style="font-weight: 700; gap: 8px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                ${t('bench.import') || 'Import Session'}
            </button>
            <button class="btn btn-ghost" id="btn-perf-clear" style="font-weight: 700;">${t('bench.clear') || 'Clear Session'}</button>
            <button class="btn btn-primary" id="btn-perf-export" style="font-weight: 800; padding: 0 32px; height: 40px; border-radius: 10px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 10px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                ${t('bench.export') || 'Export Session'}
            </button>
        </div>
    `;

    overlay.appendChild(content);
    (document.getElementById('app-window-outer') || document.body).appendChild(overlay);

    // Elements
    const closeBtn = content.querySelector('#perf-modal-close') as HTMLElement;
    const recBtn = content.querySelector('#btn-perf-rec') as HTMLElement;
    const miniBtn = content.querySelector('#btn-perf-mini') as HTMLElement;
    const advancedToggle = content.querySelector('#perf-advanced-toggle') as HTMLInputElement;
    const liveBtn = content.querySelector('#btn-perf-live') as HTMLElement;
    const timeline = content.querySelector('#timeline-container') as HTMLElement;
    const seekHandle = content.querySelector('#timeline-seek-handle') as HTMLElement;
    const taskyElements = content.querySelectorAll('.tasky-info');

    // Create Tooltips directly on body to avoid backdrop-filter coordinate issues
    let globalTooltip = document.getElementById('perf-global-tooltip');
    if (!globalTooltip) {
        globalTooltip = document.createElement('div');
        globalTooltip.id = 'perf-global-tooltip';
        globalTooltip.style.cssText = 'display:none; position: fixed; pointer-events: none; background: rgba(15, 23, 42, 0.98); border: 1px solid var(--accent); padding: 12px 16px; border-radius: 12px; z-index: 2000000; font-size: 12px; box-shadow: 0 20px 50px rgba(0,0,0,0.6); backdrop-filter: blur(12px);';
        document.body.appendChild(globalTooltip);
    }

    if (!closeBtn || !recBtn || !miniBtn || !advancedToggle || !liveBtn || !timeline || !seekHandle) return;

    // Tasky Help Tooltips
    const helpText: Record<string, string> = {
        latency: t('bench.help.latency') || "Network Latency: The time (ms) it takes for a request to reach Google. High values mean your connection or BMM's network thread is busy.",
        global_cpu: t('bench.help.globalCpu') || "Global CPU Load: Total usage of all cores on your PC. Helps you see if other background apps are slowing down BMM.",
        virtual: t('bench.help.virtual') || "Virtual Memory: Address space reserved by the OS for BMM. Not necessarily physical RAM, but indicates memory pressure.",
        swap: t('bench.help.swap') || "Swap Memory: Data moved from RAM to your disk. If this is high, your PC is out of real RAM, which causes major slowdowns."
    };

    taskyElements.forEach(el => {
        (el as HTMLElement).onmouseenter = (e) => {
            const key = (el as HTMLElement).dataset.help!;
            showTaskyHelp(helpText[key], 'info', true);
        };
        (el as HTMLElement).onmouseleave = () => hideTaskyHelp();
    });

    const cleanup = async () => {
        if (benchmarkUnlisten) {
            benchmarkUnlisten();
            benchmarkUnlisten = null;
        }
        if (benchProgressUnlisten) {
            benchProgressUnlisten();
            benchProgressUnlisten = null;
        }
        await invoke('stop_benchmark');
        if (globalTooltip) globalTooltip.style.display = 'none';
        hideTaskyHelp();
        overlay.classList.remove('open');
        overlay.style.opacity = '0';
        setTimeout(() => {
            overlay.remove();
            if (globalTooltip) globalTooltip.remove();
        }, 250);
    };

    closeBtn.onclick = cleanup;
    // Clicking the backdrop (outside the modal card) closes it. A running benchmark
    // keeps going in the background and is restored on reopen.
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) cleanup();
    });

    recBtn.onclick = async () => {
        isRecording = !isRecording;
        if (isRecording) {
            await invoke('start_benchmark');
            recBtn.style.color = '#ef4444';
            (recBtn.querySelector('#rec-text') as HTMLElement).textContent = t('bench.stopRecording') || 'Stop Recording';
            (recBtn.querySelector('#rec-dot') as HTMLElement).style.display = 'block';
        } else {
            await invoke('stop_benchmark');
            recBtn.style.color = '#fff';
            (recBtn.querySelector('#rec-text') as HTMLElement).textContent = t('bench.startMonitoring') || 'Start Monitoring';
            (recBtn.querySelector('#rec-dot') as HTMLElement).style.display = 'none';
        }
    };

    miniBtn.onclick = () => {
        overlay.classList.remove('open');
        overlay.style.display = 'none';
        toggleMiniMonitor(true);
    };

    advancedToggle.onchange = async () => {
        isAdvancedMode = advancedToggle.checked;
        const section = content.querySelector('#perf-advanced-section') as HTMLElement;
        if (section) section.style.display = isAdvancedMode ? 'flex' : 'none';
        await invoke('set_advanced_benchmark_mode', { enabled: isAdvancedMode });
    };

    // Replay Logic
    timeline.onclick = (e) => {
        const rect = timeline.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const ratio = x / rect.width;
        seekIndex = Math.round(ratio * (benchmarkData.length - 1));
        isLiveView = false;
        liveBtn.style.display = 'block';
        updateStatsView(content, benchmarkData[seekIndex!]);
        renderCharts(content, benchmarkData, seekIndex);
        updateSeekHandle(content, ratio);
    };

    liveBtn.onclick = () => {
        isLiveView = true;
        seekIndex = null;
        liveBtn.style.display = 'none';
        renderCharts(content, benchmarkData);
    };

    // Global Tooltip Polish
    const setupCanvasHover = (canvas: HTMLCanvasElement, type: 'main' | 'io') => {
        canvas.onmousemove = (e) => {
            if (benchmarkData.length < 2) return;
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const ratio = x / rect.width;
            hoverIndex = Math.round(ratio * (benchmarkData.length - 1));
            
            const point = benchmarkData[hoverIndex];
            globalTooltip.style.display = 'block';
            
            // Fixed: Position closer and flip if needed
            let tx = e.clientX + 10;
            if (tx + 180 > window.innerWidth) tx = e.clientX - 190;
            globalTooltip.style.left = tx + 'px';
            globalTooltip.style.top = (e.clientY - 10) + 'px';

            globalTooltip.innerHTML = `
                <div style="color:var(--accent); font-weight:900; margin-bottom:6px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px;">${new Date(point.timestamp * 1000).toLocaleTimeString()}</div>
                <div style="color:#fff; margin: 4px 0;">CPU: <span style="color:var(--accent); font-weight:700">${point.cpu_usage.toFixed(1)}%</span></div>
                <div style="color:#fff; margin: 4px 0;">RAM: <span style="color:#fff; font-weight:700">${formatUnit(point.ram_usage, 'MB')}</span></div>
                ${point.network_latency ? `<div style="color:#3b82f6; margin: 4px 0;">Ping: <span style="font-weight:700">${point.network_latency}ms</span></div>` : ''}
            `;
            renderCharts(content, benchmarkData, isLiveView ? null : seekIndex);
        };
        canvas.onmouseleave = () => {
            hoverIndex = null;
            globalTooltip.style.display = 'none';
            renderCharts(content, benchmarkData, isLiveView ? null : seekIndex);
        };
    };

    setupCanvasHover(content.querySelector('#perf-chart-main') as HTMLCanvasElement, 'main');
    setupCanvasHover(content.querySelector('#perf-chart-io') as HTMLCanvasElement, 'io');

    // ── Benchmark view wiring ───────────────────────────────────────────────
    injectBenchStyle();
    let benchMode: 'sandbox' | 'real' = 'sandbox';
    let benchScale = 'medium';
    const subtitle = content.querySelector('#perf-subtitle') as HTMLElement;
    const liveControls = content.querySelector('#perf-live-controls') as HTMLElement;
    const liveView = content.querySelector('#perf-live-view') as HTMLElement;
    const benchView = content.querySelector('#perf-bench-view') as HTMLElement;

    const setSeg = (segId: string, key: string, val: string) =>
        content.querySelectorAll(`#${segId} .bench-seg`).forEach(b => {
            const el = b as HTMLElement;
            el.classList.toggle('active', el.dataset[key] === val);
        });

    // ── Real-mode source selection (which profile(s) / folders to benchmark) ──
    let benchProfiles: any[] = [];
    const benchSelected = new Set<string>();
    const benchCustom: string[] = [];
    const sourcesPanel = content.querySelector('#bench-sources') as HTMLElement;
    const srcList = content.querySelector('#bench-src-list') as HTMLElement;
    const escA = (s: any) => String(s).replace(/[&<>"]/g, (c: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
    const shortPath = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).slice(-2).join('/');

    const folderIcon = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
    const xIcon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;opacity:.7;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    const checkIcon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="flex-shrink:0;"><polyline points="20 6 9 17 4 12"/></svg>';
    const renderSrcChips = () => {
        if (!srcList) return;
        const prof = benchProfiles.map(p => {
            const on = benchSelected.has(p.id);
            return `<button class="bench-chip ${on ? 'active' : ''}" data-pid="${escA(p.id)}" data-tooltip="${escA(p.mods_path || '')}" style="display:inline-flex;align-items:center;gap:6px;">${on ? checkIcon : ''}${escA(p.name || p.id)}</button>`;
        }).join('');
        const custom = benchCustom.map((f, i) =>
            `<button class="bench-chip active" data-custom="${i}" data-tooltip="${escA(f)}" style="display:inline-flex;align-items:center;gap:6px;">${folderIcon}${escA(shortPath(f))}${xIcon}</button>`).join('');
        srcList.innerHTML = (prof + custom) || `<span style="font-size:12px;color:var(--text-muted);">${t('bench.noProfilesFound') || 'No profiles found — use the Folder button.'}</span>`;
        srcList.querySelectorAll('.bench-chip[data-pid]').forEach(c => ((c as HTMLElement).onclick = () => {
            const id = (c as HTMLElement).dataset.pid!;
            if (benchSelected.has(id)) benchSelected.delete(id); else benchSelected.add(id);
            renderSrcChips();
        }));
        srcList.querySelectorAll('.bench-chip[data-custom]').forEach(c => ((c as HTMLElement).onclick = () => {
            benchCustom.splice(Number((c as HTMLElement).dataset.custom), 1);
            renderSrcChips();
        }));
        const countEl = content.querySelector('#bench-src-count') as HTMLElement;
        if (countEl) {
            const n = benchSelected.size + benchCustom.length;
            countEl.textContent = `${n} ${t('bench.selected') || 'selected'}`;
            countEl.style.display = n ? 'inline-block' : 'none';
        }
    };

    const loadProfiles = async () => {
        if (benchProfiles.length) { renderSrcChips(); return; }
        try {
            const activeId = await invoke('get_active_profile_id');
            benchProfiles = (await invoke('get_profiles') as any[]) || [];
            const def = benchProfiles.find(p => p.id === activeId) || benchProfiles[0];
            if (def) benchSelected.add(def.id); // default: the active profile
        } catch { benchProfiles = []; }
        renderSrcChips();
    };

    const switchPerfMode = (mode: 'live' | 'bench') => {
        content.querySelectorAll('.perf-tab').forEach(b =>
            (b as HTMLElement).classList.toggle('active', (b as HTMLElement).dataset.mode === mode));
        const isBench = mode === 'bench';
        if (liveView) liveView.style.display = isBench ? 'none' : 'flex';
        if (benchView) benchView.style.display = isBench ? 'flex' : 'none';
        if (liveControls) liveControls.style.display = isBench ? 'none' : 'flex';
        if (subtitle) subtitle.textContent = isBench
            ? (t('bench.subtitleBench') || 'Operation Benchmark')
            : (t('bench.subtitle') || 'Live Diagnostics & Replay');
    };
    content.querySelectorAll('.perf-tab').forEach(b =>
        ((b as HTMLElement).onclick = () => switchPerfMode((b as HTMLElement).dataset.mode as any)));

    content.querySelectorAll('#bench-mode-seg .bench-seg').forEach(b => ((b as HTMLElement).onclick = () => {
        benchMode = (b as HTMLElement).dataset.mode as any;
        setSeg('bench-mode-seg', 'mode', benchMode);
        const isReal = benchMode === 'real';
        const note = content.querySelector('#bench-realnote') as HTMLElement;
        if (note) note.style.display = isReal ? 'block' : 'none';
        if (sourcesPanel) sourcesPanel.style.display = isReal ? 'flex' : 'none';
        if (isReal) loadProfiles();
    }));
    const customWrap = content.querySelector('#bench-custom-wrap') as HTMLElement | null;
    content.querySelectorAll('#bench-scale-seg .bench-seg').forEach(b => ((b as HTMLElement).onclick = () => {
        benchScale = (b as HTMLElement).dataset.scale!;
        setSeg('bench-scale-seg', 'scale', benchScale);
        if (customWrap) customWrap.style.display = benchScale === 'custom' ? 'inline-flex' : 'none';
    }));
    const srcAll = content.querySelector('#bench-src-all') as HTMLElement;
    const srcNone = content.querySelector('#bench-src-none') as HTMLElement;
    const srcCustom = content.querySelector('#bench-src-custom') as HTMLElement;
    if (srcAll) srcAll.onclick = () => { benchProfiles.forEach(p => benchSelected.add(p.id)); renderSrcChips(); };
    if (srcNone) srcNone.onclick = () => { benchSelected.clear(); renderSrcChips(); };
    if (srcCustom) srcCustom.onclick = async () => { const f = await pickFolder(); if (f) { benchCustom.push(f); renderSrcChips(); } };

    const runBtn = content.querySelector('#btn-bench-run') as HTMLElement;
    const progWrap = content.querySelector('#bench-progress-wrap') as HTMLElement;
    const progBar = content.querySelector('#bench-progress-bar') as HTMLElement;
    const progLabel = content.querySelector('#bench-progress-label') as HTMLElement;
    const progPct = content.querySelector('#bench-progress-pct') as HTMLElement;
    const introEl = content.querySelector('#bench-intro') as HTMLElement;
    const resultsEl = content.querySelector('#bench-results') as HTMLElement;

    benchProgressUnlisten = await listen('app-benchmark-progress', (event) => {
        const p = event.payload as { step: number, total: number, label: string };
        const pct = Math.round((p.step / p.total) * 100);
        benchLastPct = pct; benchLastLabel = p.label;
        // Re-query by id so progress lands in whatever modal instance is open now
        // (the run keeps going in the background across close/reopen).
        const bar = document.getElementById('bench-progress-bar') as HTMLElement | null;
        const pctEl = document.getElementById('bench-progress-pct');
        const lblEl = document.getElementById('bench-progress-label');
        if (bar) bar.style.width = pct + '%';
        if (pctEl) pctEl.textContent = pct + '%';
        if (lblEl) lblEl.textContent = p.label + '…';
    });

    const cancelBtn = content.querySelector('#btn-bench-cancel') as HTMLElement | null;
    // Toggle the Run/Cancel/progress UI for a given running state.
    const setRunningUI = (running: boolean) => {
        if (runBtn) { runBtn.style.display = running ? 'none' : ''; }
        if (cancelBtn) cancelBtn.style.display = running ? 'inline-flex' : 'none';
        if (progWrap) progWrap.style.display = running ? 'flex' : 'none';
        if (running && introEl) introEl.style.display = 'none';
    };
    if (cancelBtn) cancelBtn.onclick = async () => {
        try { await invoke('cancel_app_benchmark'); } catch {}
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
        if (progBar) progBar.style.width = benchLastPct + '%';
        if (progPct) progPct.textContent = benchLastPct + '%';
        if (progLabel) progLabel.textContent = benchLastLabel ? benchLastLabel + '…' : '';
    } else if (lastBenchReport) {
        renderBenchResults(resultsEl, lastBenchReport);
        if (resultsEl) resultsEl.style.display = 'flex';
        if (introEl) introEl.style.display = 'none';
    }

    if (runBtn) runBtn.onclick = async () => {
        let realSources: string[] = [];
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
        benchRunning = true; benchLastPct = 0; benchLastLabel = '';
        setRunningUI(true);
        if (resultsEl) resultsEl.style.display = 'none';
        if (progBar) progBar.style.width = '0%';
        if (progPct) progPct.textContent = '0%';

        // For a custom size, send "custom:<MB>[:<files>]".
        let scaleArg = benchScale;
        if (benchScale === 'custom') {
            const mbEl = content.querySelector('#bench-custom-mb') as HTMLInputElement | null;
            const filesEl = content.querySelector('#bench-custom-files') as HTMLInputElement | null;
            const mb = Math.min(8192, Math.max(1, parseInt(mbEl?.value || '250', 10) || 250));
            const filesRaw = parseInt(filesEl?.value || '', 10);
            scaleArg = (filesRaw && filesRaw > 0)
                ? `custom:${mb}:${Math.min(200000, filesRaw)}`
                : `custom:${mb}`;
        }
        try {
            // A just-cancelled run may still be aborting; the backend rejects an
            // overlapping start with "already running" — retry briefly until free.
            let report: any = null;
            for (let attempt = 0; ; attempt++) {
                if (myGen !== benchRunGen) return; // superseded
                try {
                    report = await invoke('run_app_benchmark', { mode: benchMode, realSources, scale: scaleArg });
                    break;
                } catch (err) {
                    if (/already running/i.test(String(err)) && attempt < 30) {
                        await new Promise(r => setTimeout(r, 300));
                        continue;
                    }
                    throw err;
                }
            }
            if (myGen !== benchRunGen) return; // a newer run/cancel happened
            lastBenchReport = report;
            // Telemetry (opt-in): report benchmark medians per operation so the team
            // can track performance across versions and hardware.
            try {
                const { track } = await import('../../core/analytics.js');
                const ops: Record<string, number> = {};
                (report?.results || []).forEach((o: any) => { if (o?.id) ops[o.id] = o.ms; });
                track('benchmark', {
                    mode: benchMode,
                    dataset_bytes: report?.env?.dataset_bytes,
                    total_ms: report?.total_ms,
                    ops,
                });
            } catch {}
            // Keep each finished run for side-by-side comparison.
            const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const sizeMb = report?.env?.dataset_bytes ? ` · ${(report.env.dataset_bytes / 1048576).toFixed(0)}MB` : '';
            addBenchToCompare(`${stamp}${sizeMb}`, report);
            // Re-query by id: the modal may have been closed/reopened during the run.
            const liveResults = document.getElementById('bench-results') as HTMLElement | null;
            if (liveResults) { renderBenchResults(liveResults, report); liveResults.style.display = 'flex'; }
            const liveIntro = document.getElementById('bench-intro');
            if (liveIntro) liveIntro.style.display = 'none';
            const secs = report?.total_ms ? ` (${(report.total_ms / 1000).toFixed(1)}s)` : '';
            toast((t('bench.done') || 'Benchmark finished') + secs, 'success');
        } catch (e) {
            if (myGen !== benchRunGen) return; // ignore a superseded run's error
            const msg = String(e);
            const liveIntro = document.getElementById('bench-intro');
            if (/cancel/i.test(msg)) {
                toast(t('bench.cancelled') || 'Benchmark cancelled', 'info');
            } else {
                toast((t('bench.failed') || 'Benchmark failed') + ': ' + e, 'error');
            }
            if (liveIntro) liveIntro.style.display = 'block';
        } finally {
            // Only the current run owns the shared UI state.
            if (myGen === benchRunGen) {
                benchRunning = false;
                setRunningUI(false);
            }
        }
    };

    // ── Footer buttons (context-aware: Benchmark report vs Live session) ─────
    const inBenchMode = () => !!benchView && benchView.style.display !== 'none';
    const footExport = content.querySelector('#btn-perf-export') as HTMLElement;
    const footClear = content.querySelector('#btn-perf-clear') as HTMLElement;
    const footImport = content.querySelector('#btn-perf-import') as HTMLElement;

    if (footExport) footExport.onclick = async () => {
        if (inBenchMode()) {
            // Export the benchmark report as JSON, CSV or a standalone HTML report —
            // chosen by the file extension the user picks.
            if (!lastBenchReport) { toast(t('bench.runFirst') || 'Run a benchmark first', 'info'); return; }
            const dest = await saveFile({ defaultPath: 'bmm-benchmark.json', filters: [
                { name: 'JSON', extensions: ['json'] },
                { name: 'CSV', extensions: ['csv'] },
                { name: 'HTML report', extensions: ['html'] },
            ] });
            if (!dest) return;
            const lower = dest.toLowerCase();
            const content = lower.endsWith('.csv') ? benchReportToCsv(lastBenchReport)
                : lower.endsWith('.html') ? buildBenchReportHtml(lastBenchReport)
                : JSON.stringify(lastBenchReport, null, 2);
            try {
                await invoke('write_text_file', { path: dest, content });
                toast((t('bench.reportSaved') || 'Report saved') + ': ' + dest, 'success');
            } catch (e) { toast((t('bench.reportFailed') || 'Could not save report') + ': ' + e, 'error'); }
        } else {
            // Export the live monitoring session as CSV.
            if (!benchmarkData.length) { toast(t('bench.noSession') || 'No session data to export yet', 'info'); return; }
            const dest = await saveFile({ defaultPath: 'bmm-session.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
            if (!dest) return;
            try {
                await invoke('export_benchmark_csv', { dataJson: JSON.stringify(benchmarkData), destPath: dest });
                toast((t('bench.sessionSaved') || 'Session exported') + ': ' + dest, 'success');
            } catch (e) { toast((t('bench.reportFailed') || 'Export failed') + ': ' + e, 'error'); }
        }
    };

    if (footClear) footClear.onclick = () => {
        if (inBenchMode()) {
            lastBenchReport = null;
            if (resultsEl) { resultsEl.style.display = 'none'; resultsEl.innerHTML = ''; }
            if (introEl) introEl.style.display = 'block';
        } else {
            benchmarkData = [];
            renderCharts(content, benchmarkData);
            renderActivityMap(content, benchmarkData);
        }
        toast(t('bench.cleared') || 'Cleared', 'success');
    };

    if (footImport) footImport.onclick = async () => {
        // In benchmark mode, import a benchmark report (JSON or CSV) → render it and
        // add it to the comparison set.
        if (inBenchMode()) {
            const src = await pickFile({ filters: [
                { name: 'Benchmark report', extensions: ['json', 'csv'] },
                { name: 'All files', extensions: ['*'] },
            ] });
            if (!src) return;
            try {
                const text = await invoke('read_file_text', { path: src }) as string;
                const report = parseBenchReportText(text);
                if (!report || !report.results.length) { toast(t('bench.importEmpty') || 'No data found in file', 'error'); return; }
                lastBenchReport = report;
                const name = (src.split(/[\\/]/).pop() || 'import').replace(/\.(json|csv)$/i, '');
                addBenchToCompare(name, report);
                const liveResults = document.getElementById('bench-results') as HTMLElement | null;
                if (liveResults) { renderBenchResults(liveResults, report); liveResults.style.display = 'flex'; }
                const liveIntro = document.getElementById('bench-intro');
                if (liveIntro) liveIntro.style.display = 'none';
                toast((t('bench.imported') || 'Imported') + `: ${name}`, 'success');
            } catch (e) { toast((t('bench.importFailed') || 'Import failed') + ': ' + e, 'error'); }
            return;
        }
        const src = await pickFile({ filters: [{ name: 'CSV session', extensions: ['csv'] }] });
        if (!src) return;
        try {
            const text = await invoke('read_file_text', { path: src }) as string;
            const lines = text.split(/\r?\n/).filter(l => l.trim());
            // Skip header row; columns: Timestamp,CPU,RAM,DiskR,DiskW,Net,VMem,Swap,GlobalCPU,Uptime
            const pts: BenchmarkPoint[] = [];
            for (const line of lines.slice(1)) {
                const c = line.split(',');
                if (c.length < 5) continue;
                pts.push({
                    timestamp: Number(c[0]) || 0, cpu_usage: Number(c[1]) || 0, ram_usage: Number(c[2]) || 0,
                    disk_read: Number(c[3]) || 0, disk_write: Number(c[4]) || 0,
                    network_latency: Number(c[5]) || undefined, ram_virtual: Number(c[6]) || undefined,
                    ram_swap: Number(c[7]) || undefined, global_cpu: Number(c[8]) || undefined, process_uptime: Number(c[9]) || undefined,
                });
            }
            if (!pts.length) { toast(t('bench.importEmpty') || 'No data found in file', 'error'); return; }
            benchmarkData = pts;
            isLiveView = false;
            if (liveBtn) liveBtn.style.display = 'block';
            switchPerfMode('live');
            updateStatsView(content, benchmarkData[benchmarkData.length - 1]);
            renderCharts(content, benchmarkData);
            renderActivityMap(content, benchmarkData);
            toast((t('bench.imported') || 'Session imported') + ` (${pts.length} pts)`, 'success');
        } catch (e) { toast((t('bench.importFailed') || 'Import failed') + ': ' + e, 'error'); }
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
        const realNote = content.querySelector('#bench-realnote') as HTMLElement | null;
        if (realNote) realNote.style.display = isReal ? 'block' : 'none';
        if (sourcesPanel) sourcesPanel.style.display = isReal ? 'flex' : 'none';
        // Size / scale
        const scaleMap: Record<string, string> = { S: 'small', M: 'medium', L: 'large', XL: 'xlarge', CUSTOM: 'custom' };
        const sz = String(cfg.size || 'M').toUpperCase();
        benchScale = scaleMap[sz]
            || (['small', 'medium', 'large', 'xlarge', 'custom'].includes(String(cfg.size)) ? String(cfg.size) : 'medium');
        setSeg('bench-scale-seg', 'scale', benchScale);
        if (customWrap) customWrap.style.display = benchScale === 'custom' ? 'inline-flex' : 'none';
        if (benchScale === 'custom' && cfg.mb) {
            const mbEl = content.querySelector('#bench-custom-mb') as HTMLInputElement | null;
            if (mbEl) mbEl.value = String(Math.min(8192, Math.max(1, Math.round(cfg.mb))));
        }
        // Real sources: add the supplied mod folders as custom sources.
        if (isReal) {
            await loadProfiles();
            if (Array.isArray(cfg.sources)) {
                for (const s of cfg.sources) { if (s && !benchCustom.includes(s)) benchCustom.push(s); }
            }
            renderSrcChips();
        }
        // Auto mode starts the run now; manual mode leaves it to the user.
        if (cfg.autoRun && runBtn) runBtn.click();
    }

    // Live Monitoring
    benchmarkUnlisten = await listen('benchmark-point', (event) => {
        const point = event.payload as BenchmarkPoint;
        benchmarkData.push(point);
        if (benchmarkData.length > 500) benchmarkData.shift();

        if (isLiveView) {
            updateStatsView(content, point);
            renderCharts(content, benchmarkData);
            renderActivityMap(content, benchmarkData);
            updateSeekHandle(content, 1);
        }
        
        if (miniMonitorActive) updateMiniMonitor(point);
    });

    await invoke('start_benchmark');
}

function updateStatsView(container: HTMLElement, point: BenchmarkPoint) {
    if (!point) return;
    const cpuVal = container.querySelector('#perf-cpu-val');
    const cpuAvg = container.querySelector('#perf-cpu-avg');
    const ramVal = container.querySelector('#perf-ram-val');
    const ramPeak = container.querySelector('#perf-ram-peak');
    const diskVal = container.querySelector('#perf-disk-val');
    const uptimeVal = container.querySelector('#perf-uptime-val');
    const replayTime = container.querySelector('#replay-time');

    if (cpuVal) cpuVal.textContent = point.cpu_usage.toFixed(1) + '%';
    if (ramVal) ramVal.textContent = formatUnit(point.ram_usage, 'MB');
    if (diskVal) diskVal.textContent = `${formatUnit(point.disk_read, 'KB/s')} / ${formatUnit(point.disk_write, 'KB/s')}`;
    if (uptimeVal) uptimeVal.textContent = formatUnit(point.process_uptime || 0, 's');
    if (replayTime) replayTime.textContent = `Time: ${new Date(point.timestamp * 1000).toLocaleTimeString()}`;

    // Averages/Peaks
    if (benchmarkData.length > 0) {
        const avgCpu = benchmarkData.reduce((acc, p) => acc + p.cpu_usage, 0) / benchmarkData.length;
        const peakRam = Math.max(...benchmarkData.map(p => p.ram_usage));
        if (cpuAvg) cpuAvg.textContent = `avg: ${avgCpu.toFixed(1)}%`;
        if (ramPeak) ramPeak.textContent = `peak: ${peakRam.toFixed(0)} MB`;
    }

    if (isAdvancedMode) {
        const netVal = container.querySelector('#perf-net-val');
        const gCpuVal = container.querySelector('#perf-global-cpu-val');
        const vramVal = container.querySelector('#perf-vram-val');
        const swapVal = container.querySelector('#perf-swap-val');

        if (netVal) netVal.textContent = point.network_latency ? point.network_latency + ' ms' : '-- ms';
        if (gCpuVal) gCpuVal.textContent = point.global_cpu ? point.global_cpu.toFixed(1) + ' %' : '-- %';
        if (vramVal) vramVal.textContent = point.ram_virtual ? formatUnit(point.ram_virtual, 'MB') : '--';
        if (swapVal) swapVal.textContent = point.ram_swap ? formatUnit(point.ram_swap, 'MB') : '--';
    }
}

function updateSeekHandle(container: HTMLElement, ratio: number) {
    const handle = container.querySelector('#timeline-seek-handle') as HTMLElement;
    if (handle) {
        handle.style.left = `calc(${ratio * 100}% - 2px)`;
    }
}

function renderActivityMap(container: HTMLElement, data: BenchmarkPoint[]) {
    const canvas = container.querySelector('#activity-heatmap') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    canvas.width = w; canvas.height = h;

    if (data.length < 2) return;

    const maxCpu = Math.max(...data.map(p => p.cpu_usage)) || 1;
    ctx.clearRect(0, 0, w, h);
    
    data.forEach((p, i) => {
        const x = (i / (data.length - 1)) * w;
        const intensity = p.cpu_usage / maxCpu;
        ctx.fillStyle = `rgba(59, 130, 246, ${0.1 + intensity * 0.9})`;
        ctx.fillRect(x, h - (intensity * h), 2, intensity * h);
    });
}

function toggleMiniMonitor(active: boolean) {
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
        el = document.createElement('div');
        el.id = 'bmm-mini-monitor';
        el.className = 'glass';
        el.style.cssText = `
            position: fixed; top: 100px; right: 40px; width: 240px; 
            padding: 20px; border-radius: 20px; z-index: 2000000;
            border: 1px solid rgba(255,255,255,0.2); cursor: grab;
            box-shadow: 0 30px 60px rgba(0,0,0,0.8); backdrop-filter: blur(24px);
            background: rgba(15, 23, 42, 0.85); transition: opacity 0.3s, transform 0.3s;
            display: flex; flex-direction: column; gap: 14px;
            pointer-events: auto;
        `;
        el.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; pointer-events: none;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="width: 12px; height: 12px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 10px var(--accent);"></div>
                    <span style="font-size:11px; font-weight:900; letter-spacing:0.12em; color: #fff; text-transform: uppercase;">PERF MINI</span>
                </div>
                <div style="display: flex; gap: 4px; align-items: center; pointer-events: auto;">
                    <button id="mini-startstop" style="background:none; border:1px solid rgba(239,68,68,0.3); color:#ef4444; cursor:pointer; font-size:10px; font-weight:700; padding:2px 6px; border-radius: 4px; text-transform:uppercase; transition:all 0.2s;">STOP</button>
                    <button id="mini-back" style="background:none; border:none; color:rgba(255,255,255,0.4); cursor:pointer; font-size:12px; padding:6px; border-radius: 8px;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 3h6v6M10 14L21 3M9 21H3v-6M21 21L13 13"/></svg>
                    </button>
                    <button id="mini-close" style="background:none; border:none; color:rgba(255,255,255,0.4); cursor:pointer; font-size:22px; padding:0 6px; border-radius: 8px;">&times;</button>
                </div>
            </div>
            <div style="display:flex; flex-direction:column; gap:12px; pointer-events: none;">
                <!-- CPU Gauge -->
                <div style="display:flex; align-items:center; gap:12px;">
                    <span style="font-size:10px; font-weight:900; color:rgba(255,255,255,0.4); width:35px;">CPU</span>
                    <div style="flex:1; height:6px; background:rgba(255,255,255,0.05); border-radius:3px; overflow:hidden;">
                        <div id="mini-cpu-bar" style="width:0%; height:100%; background:var(--accent); transition: width 0.3s ease;"></div>
                    </div>
                    <span id="mini-cpu" style="font-size:11px; font-weight:900; color:var(--accent); width:35px; text-align:right;">0%</span>
                </div>
                <!-- RAM Gauge -->
                <div style="display:flex; align-items:center; gap:12px;">
                    <span style="font-size:10px; font-weight:900; color:rgba(255,255,255,0.4); width:35px;">RAM</span>
                    <div style="flex:1; height:6px; background:rgba(255,255,255,0.05); border-radius:3px; overflow:hidden;">
                        <div id="mini-ram-bar" style="width:0%; height:100%; background:#fff; transition: width 0.3s ease;"></div>
                    </div>
                    <span id="mini-ram" style="font-size:11px; font-weight:900; color:#fff; width:35px; text-align:right;">0M</span>
                </div>
                <!-- DISK Gauge -->
                <div style="display:flex; align-items:center; gap:12px;">
                    <span style="font-size:10px; font-weight:900; color:rgba(255,255,255,0.4); width:35px;">DISK</span>
                    <div style="flex:1; height:6px; background:rgba(255,255,255,0.05); border-radius:3px; overflow:hidden;">
                        <div id="mini-disk-bar" style="width:0%; height:100%; background:#fbbf24; transition: width 0.3s ease;"></div>
                    </div>
                    <span id="mini-disk" style="font-size:11px; font-weight:900; color:#fbbf24; width:35px; text-align:right;">0K</span>
                </div>
            </div>
        `;
        document.body.appendChild(el);

        let isDragging = false;
        let startPos = { x: 0, y: 0 }, startElPos = { x: 0, y: 0 };
        el.onmousedown = (e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            isDragging = true;
            el!.style.cursor = 'grabbing';
            startPos = { x: e.clientX, y: e.clientY };
            const rect = el!.getBoundingClientRect();
            startElPos = { x: rect.left, y: rect.top };
            el!.style.transition = 'none';
        };
        document.addEventListener('mousemove', (e) => {
            if (!isDragging || !el) return;
            el.style.left = (startElPos.x + e.clientX - startPos.x) + 'px';
            el.style.top = (startElPos.y + e.clientY - startPos.y) + 'px';
            el.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => { isDragging = false; if (el) { el.style.cursor = 'grab'; el.style.transition = 'all 0.3s'; } });

        (el.querySelector('#mini-close') as HTMLElement).onclick = () => toggleMiniMonitor(false);
        (el.querySelector('#mini-back') as HTMLElement).onclick = () => { toggleMiniMonitor(false); openAdvancedPerfModal(); };

        const startStopBtn = el.querySelector('#mini-startstop') as HTMLElement;
        const updateMiniBtnVisuals = () => {
            if (isRecording) {
                startStopBtn.textContent = t('bench.stop') || 'STOP';
                startStopBtn.style.color = '#ef4444';
                startStopBtn.style.borderColor = 'rgba(239,68,68,0.3)';
            } else {
                startStopBtn.textContent = t('bench.start') || 'START';
                startStopBtn.style.color = '#10b981';
                startStopBtn.style.borderColor = 'rgba(16,185,129,0.3)';
            }
        };
        updateMiniBtnVisuals();
        startStopBtn.onclick = () => {
            isRecording = !isRecording;
            if (isRecording) {
                invoke('start_benchmark');
            } else {
                invoke('stop_benchmark');
            }
            updateMiniBtnVisuals();
            const recBtn = document.getElementById('btn-perf-rec');
            if (recBtn) {
                recBtn.style.color = isRecording ? '#ef4444' : '#fff';
                (recBtn.querySelector('#rec-text') as HTMLElement).textContent = isRecording ? (t('bench.stopRec') || 'Stop Recording') : (t('bench.startRec') || 'Start Monitoring');
                (recBtn.querySelector('#rec-dot') as HTMLElement).style.display = isRecording ? 'block' : 'none';
            }
        };
    }
}

function updateMiniMonitor(point: BenchmarkPoint | null) {
    const el = document.getElementById('bmm-mini-monitor');
    if (!el || !point) return;
    
    const cpu = el.querySelector('#mini-cpu');
    const cpuBar = el.querySelector('#mini-cpu-bar') as HTMLElement;
    const ram = el.querySelector('#mini-ram');
    const ramBar = el.querySelector('#mini-ram-bar') as HTMLElement;
    const disk = el.querySelector('#mini-disk');
    const diskBar = el.querySelector('#mini-disk-bar') as HTMLElement;

    if (cpu && cpuBar) {
        cpu.textContent = point.cpu_usage.toFixed(0) + '%';
        cpuBar.style.width = Math.min(100, point.cpu_usage) + '%';
    }
    
    if (ram && ramBar) {
        // Estimate RAM percentage based on a 16GB baseline if total not known
        const ramMb = point.ram_usage;
        ram.textContent = (ramMb > 1024 ? (ramMb / 1024).toFixed(1) + 'G' : ramMb.toFixed(0) + 'M');
        ramBar.style.width = Math.min(100, (ramMb / 16384) * 100) + '%';
    }
    
    if (disk && diskBar) {
        const totalIo = point.disk_read + point.disk_write;
        disk.textContent = (totalIo > 1024 ? (totalIo / 1024).toFixed(1) + 'M' : totalIo.toFixed(0) + 'K');
        // Scale 50MB/s as 100% for the mini bar
        diskBar.style.width = Math.min(100, (totalIo / 51200) * 100) + '%';
    }
}

interface Series {
    key: keyof BenchmarkPoint;
    color: string;
    label: string;
    /** Formats a raw value into a human string with units (for legend + axis). */
    fmt: (v: number) => string;
}

function renderCharts(container: HTMLElement, data: BenchmarkPoint[], highlightIndex: number | null = null) {
    const mainCanvas = container.querySelector('#perf-chart-main') as HTMLCanvasElement;
    const ioCanvas = container.querySelector('#perf-chart-io') as HTMLCanvasElement;
    if (!mainCanvas || !ioCanvas) return;

    // Resolve theme tokens so users can recolour the graphs from the theme editor.
    const cv = (name: string, fb: string) =>
        getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;

    drawChart(mainCanvas, data, [
        { key: 'cpu_usage', color: cv('--bmm-chart-cpu', '#3b82f6'), label: 'CPU', fmt: v => `${v.toFixed(1)}%` },
        { key: 'ram_usage', color: cv('--bmm-chart-ram', '#e2e8f0'), label: 'RAM', fmt: v => formatUnit(v, 'MB') }
    ], highlightIndex);

    drawChart(ioCanvas, data, [
        { key: 'disk_read', color: cv('--bmm-chart-disk-read', '#fbbf24'), label: 'Read', fmt: v => formatUnit(v, 'KB/s') },
        { key: 'disk_write', color: cv('--bmm-chart-disk-write', '#f87171'), label: 'Write', fmt: v => formatUnit(v, 'KB/s') }
    ], highlightIndex);
}

// Professional time-series chart: padded plot area, horizontal gridlines with
// %-of-scale labels, an X time axis, a live-value legend (real units), and
// per-series auto-scaling so every metric is readable regardless of magnitude.
function drawChart(canvas: HTMLCanvasElement, data: BenchmarkPoint[], series: Series[], highlightIndex: number | null) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px ui-monospace, monospace';
    ctx.textBaseline = 'middle';

    // Plot area (leave room for axis labels + a legend strip on top).
    const PADL = 40, PADR = 12, PADT = 26, PADB = 20;
    const px = PADL, py = PADT, pw = Math.max(1, W - PADL - PADR), ph = Math.max(1, H - PADT - PADB);
    const muted = 'rgba(148,163,184,0.55)';
    const grid = 'rgba(148,163,184,0.12)';

    // Per-series max (with 15% headroom) so each line uses the full height.
    const maxOf = (s: Series) => {
        let m = 0;
        for (const p of data) { const v = (p[s.key] as number) || 0; if (v > m) m = v; }
        return m * 1.15 || 1;
    };
    const maxes = series.map(maxOf);

    // ── Horizontal gridlines + %-of-scale labels ──
    ctx.strokeStyle = grid; ctx.fillStyle = muted; ctx.lineWidth = 1; ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
        const y = py + (ph * i) / 4;
        ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px + pw, y); ctx.stroke();
        ctx.fillText(`${100 - i * 25}%`, px - 6, y);
    }

    if (data.length < 2) {
        ctx.textAlign = 'center'; ctx.fillStyle = muted;
        ctx.fillText('collecting samples…', px + pw / 2, py + ph / 2);
        return;
    }

    // ── X time axis (oldest → newest) ──
    ctx.textAlign = 'center'; ctx.fillStyle = muted;
    const tFmt = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' });
    for (let i = 0; i <= 3; i++) {
        const idx = Math.round(((data.length - 1) * i) / 3);
        const x = px + (pw * i) / 3;
        if (data[idx]) ctx.fillText(tFmt(data[idx].timestamp), x, py + ph + 11);
    }

    // ── Series lines + gradient fill (each normalized to its own max) ──
    series.forEach((s, si) => {
        const max = maxes[si];
        ctx.beginPath(); ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
        data.forEach((p, i) => {
            const x = px + (i / (data.length - 1)) * pw;
            const y = py + ph - Math.min(ph, (((p[s.key] as number) || 0) / max) * ph);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.lineTo(px + pw, py + ph); ctx.lineTo(px, py + ph); ctx.closePath();
        const grad = ctx.createLinearGradient(0, py, 0, py + ph);
        grad.addColorStop(0, s.color + '2e'); grad.addColorStop(1, s.color + '00');
        ctx.fillStyle = grad; ctx.fill();
    });

    // ── Legend (top strip): colour chip + label + live/peak value in real units ──
    const index = highlightIndex !== null ? highlightIndex : hoverIndex;
    const sample = (index !== null && data[index]) ? data[index] : data[data.length - 1];
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    let lx = px;
    series.forEach((s) => {
        ctx.fillStyle = s.color;
        ctx.fillRect(lx, PADT / 2 - 4, 9, 9);
        lx += 13;
        ctx.fillStyle = '#e2e8f0';
        const txt = `${s.label} ${s.fmt((sample[s.key] as number) || 0)}`;
        ctx.fillText(txt, lx, PADT / 2);
        lx += ctx.measureText(txt).width + 18;
    });

    // ── Hover / replay crosshair + markers ──
    if (index !== null && data[index]) {
        const x = px + (index / (data.length - 1)) * pw;
        ctx.beginPath(); ctx.strokeStyle = highlightIndex !== null ? (cssAccent()) : 'rgba(255,255,255,0.4)';
        ctx.setLineDash([4, 4]); ctx.moveTo(x, py); ctx.lineTo(x, py + ph); ctx.stroke(); ctx.setLineDash([]);
        series.forEach((s, si) => {
            const y = py + ph - Math.min(ph, (((data[index]![s.key] as number) || 0) / maxes[si]) * ph);
            ctx.beginPath(); ctx.fillStyle = s.color; ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        });
    }
}

function cssAccent(): string {
    return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3b82f6';
}

/** Side-by-side comparison table across the runs in `benchCompare`. Per row,
 *  the best value (highest throughput, else lowest time) is highlighted green. */
function benchCompareHtml(): string {
    if (benchCompare.length < 2) return '';
    const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
    const runs = benchCompare;
    const order: string[] = [];
    const labelById: Record<string, string> = {};
    for (const r of runs) for (const o of (r.report.results || [])) {
        if (!(o.id in labelById)) { labelById[o.id] = o.label || o.id; order.push(o.id); }
    }
    const fmtTput = (v: any) => v == null ? '—' : (v >= 1000 ? `${(v / 1000).toFixed(2)} GB/s` : `${v.toFixed(0)} MB/s`);
    const fmtMs = (ms: number) => ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : ms < 1000 ? `${ms.toFixed(1)}ms` : `${(ms / 1000).toFixed(2)}s`;
    const th = `<th style="text-align:left; padding:6px 8px; color:var(--text-muted); font-weight:600;">${t('bench.cmpOp') || 'Operation'}</th>` +
        runs.map(r => `<th style="text-align:right; padding:6px 8px; color:#fff; font-weight:700; white-space:nowrap;">${esc(r.label)}</th>`).join('');
    const body = order.map(id => {
        const cells = runs.map(r => (r.report.results || []).find((o: any) => o.id === id));
        const hasTput = cells.some(c => c && c.throughput_mb_s != null);
        let bestIdx = -1, bestVal = hasTput ? -Infinity : Infinity;
        cells.forEach((c, i) => { if (!c) return; const v = hasTput ? (c.throughput_mb_s ?? -Infinity) : c.ms; if (hasTput ? v > bestVal : v < bestVal) { bestVal = v; bestIdx = i; } });
        const tds = cells.map((c, i) => {
            if (!c) return `<td style="text-align:right; padding:6px 8px; color:var(--text-muted);">—</td>`;
            const txt = hasTput ? fmtTput(c.throughput_mb_s) : fmtMs(c.ms);
            const best = i === bestIdx && runs.length > 1;
            return `<td style="text-align:right; padding:6px 8px; font-family:var(--font-mono); color:${best ? '#10b981' : '#cbd5e1'}; font-weight:${best ? '800' : '500'};">${txt}</td>`;
        }).join('');
        return `<tr style="border-top:1px solid var(--border);"><td style="padding:6px 8px; color:#fff; font-weight:600;">${esc(labelById[id])}</td>${tds}</tr>`;
    }).join('');
    return `<div style="background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:14px; padding:16px 18px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <h4 style="margin:0; font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--text-muted);">${(t('bench.cmpTitle') || 'Comparison').replace('{n}', String(runs.length))} <span style="color:#64748b; text-transform:none; font-weight:400;">· ${runs.length} ${t('bench.cmpRuns') || 'runs'}</span></h4>
            <button class="btn btn-ghost btn-sm" id="bench-clear-compare" style="font-weight:700;">${t('bench.cmpClear') || 'Clear comparison'}</button>
        </div>
        <div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:12px;"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>
        <p style="margin:8px 0 0; font-size:11px; color:var(--text-muted);">${t('bench.cmpHint') || 'Green = best per row (highest throughput, or lowest time).'}</p>
    </div>`;
}

// ── Benchmark results rendering ──────────────────────────────────────────────
function renderBenchResults(container: HTMLElement | null, report: any) {
    if (!container || !report) return;
    const ops: any[] = report.results || [];
    const env = report.env || {};
    const maxMs = Math.max(...ops.map(o => o.ms), 0.0001);

    const fmtMs = (ms: number) => ms < 1 ? `${(ms * 1000).toFixed(0)} µs` : ms < 1000 ? `${ms.toFixed(1)} ms` : `${(ms / 1000).toFixed(2)} s`;
    const fmtTput = (v: number | null | undefined) => (v == null) ? '' : (v >= 1000 ? `${(v / 1000).toFixed(2)} GB/s` : `${v.toFixed(0)} MB/s`);
    const catColor: Record<string, string> = { scan: '#a78bfa', hash: '#22d3ee', io: '#3b82f6', archive: '#fbbf24', activation: '#10b981' };

    const rows = ops.map(op => {
        const col = catColor[op.category] || '#3b82f6';
        const w = Math.max(3, (op.ms / maxMs) * 100);
        const tp = fmtTput(op.throughput_mb_s);
        const range = (op.max_ms > op.min_ms) ? `<span style="color:var(--text-muted); font-weight:400; font-size:11px; font-family:var(--font-mono);"> ${fmtMs(op.min_ms)}–${fmtMs(op.max_ms)}</span>` : '';
        const note = opNote(op);
        return `<div style="background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:12px; padding:14px 16px;">
            <div style="display:flex; justify-content:space-between; align-items:baseline; gap:12px;">
                <span style="font-weight:700; color:#fff; font-size:13px;">${opLabel(op)}</span>
                <span style="font-family:var(--font-mono); font-weight:800; color:${col}; white-space:nowrap;">${fmtMs(op.ms)}${tp ? ` · ${tp}` : ''}${range}</span>
            </div>
            <div style="height:6px; background:rgba(255,255,255,0.05); border-radius:3px; margin:9px 0 7px; overflow:hidden;">
                <div style="height:100%; width:${w}%; background:${col}; border-radius:3px;"></div>
            </div>
            <div style="font-size:11.5px; color:var(--text-muted); line-height:1.55;">${opDesc(op)}${note ? ` <span style="color:${col}; font-weight:600;">(${note})</span>` : ''}</div>
        </div>`;
    }).join('');

    const dsMb = ((env.dataset_bytes || 0) / 1048576).toFixed(1);
    const cardStyle = 'background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:14px; padding:16px 18px;';
    const chartTitle = (txt: string, sub: string) =>
        `<h4 style="margin:0 0 10px; font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--text-muted);">${txt} <span style="color:#64748b; text-transform:none; font-weight:400;">· ${sub}</span></h4>`;
    const chartTput = benchSvgChart(ops, 'tput');
    container.innerHTML = `
        <div style="display:flex; flex-wrap:wrap; gap:14px; align-items:center; justify-content:space-between; padding:4px 2px;">
            <div style="display:flex; gap:18px; flex-wrap:wrap; font-size:12px; color:var(--text-muted);">
                <span>${t('bench.colMode') || 'Mode'}: <b style="color:#fff;">${env.mode === 'real' ? (t('bench.real') || 'Real') : (t('bench.sandbox') || 'Sandbox')}</b></span>
                <span>${t('bench.colDataset') || 'Dataset'}: <b style="color:#fff;">${env.dataset_files || 0} ${t('bench.files') || 'files'} · ${dsMb} MB</b></span>
                <span>CPU: <b style="color:#fff;">${env.cores || '?'} ${t('bench.cores') || 'cores'}</b></span>
                ${env.disk ? `<span>${t('bench.disk') || 'Disk'}: <b style="color:#fff;">${env.disk}</b></span>` : ''}
                ${env.reps ? `<span>${t('bench.samples') || 'Samples'}: <b style="color:#fff;">${env.reps}× ${t('bench.eachOp') || 'each op'}</b></span>` : ''}
                <span>${t('bench.colTotal') || 'Total'}: <b style="color:#fff;">${fmtMs(report.total_ms || 0)}</b></span>
            </div>
            <div style="display:flex; gap:8px;">
                <button class="btn btn-ghost btn-sm" id="bench-copy-json" style="font-weight:700;">${t('bench.copyJson') || 'Copy JSON'}</button>
                <button class="btn btn-primary btn-sm" id="bench-export-html" style="font-weight:700;">${t('bench.exportReport') || 'Export report'}</button>
            </div>
        </div>
        <div style="display:grid; grid-template-columns:${chartTput ? '1fr 1fr' : '1fr'}; gap:14px;">
            <div style="${cardStyle}">${chartTitle(t('bench.chartTime') || 'Operation time', t('bench.lowerBetter') || 'lower is better')}${benchSvgChart(ops, 'time')}</div>
            ${chartTput ? `<div style="${cardStyle}">${chartTitle(t('bench.chartTput') || 'Throughput', t('bench.higherBetter') || 'higher is better')}${chartTput}</div>` : ''}
        </div>
        <div style="display:flex; flex-direction:column; gap:10px;">${rows}</div>
        ${benchCompareHtml()}`;

    const copyBtn = container.querySelector('#bench-copy-json') as HTMLElement;
    if (copyBtn) copyBtn.onclick = async () => {
        try {
            await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
            toast(t('bench.copied') || 'Results copied to clipboard', 'success');
        } catch {
            toast(t('bench.copyFailed') || 'Could not copy', 'error');
        }
    };

    const exportBtn = container.querySelector('#bench-export-html') as HTMLElement;
    if (exportBtn) exportBtn.onclick = async () => {
        try {
            const dest = await saveFile({ defaultPath: 'bmm-benchmark-report.html', filters: [{ name: 'HTML', extensions: ['html'] }] });
            if (!dest) return;
            await invoke('write_text_file', { path: dest, content: buildBenchReportHtml(report) });
            toast((t('bench.reportSaved') || 'Report saved') + ': ' + dest, 'success');
        } catch (e) {
            toast((t('bench.reportFailed') || 'Could not save report') + ': ' + e, 'error');
        }
    };

    const clearCmpBtn = container.querySelector('#bench-clear-compare') as HTMLElement;
    if (clearCmpBtn) clearCmpBtn.onclick = () => {
        // Keep only the run currently on screen, drop the rest of the comparison.
        benchCompare = lastBenchReport ? benchCompare.filter(r => r.report === lastBenchReport).slice(0, 1) : [];
        renderBenchResults(container, report);
    };
}

// ── i18n for benchmark results ───────────────────────────────────────────────
// The backend sends stable ids + English label/explanation; we translate by id
// (falling back to the backend text) so the whole results view is localised.
const OP_LABEL_KEY: Record<string, string> = {
    scan: 'bench.opScan', hash: 'bench.opHash', copy_full: 'bench.opCopyFull', copy_smart: 'bench.opCopySmart',
    archive_extract: 'bench.opArchive', activate: 'bench.opActivate', deactivate: 'bench.opDeactivate', cancel: 'bench.opCancel',
};
const OP_DESC_KEY: Record<string, string> = {
    scan: 'bench.d.scan', hash: 'bench.d.hash', copy_full: 'bench.d.copyFull', copy_smart: 'bench.d.copySmart',
    archive_extract: 'bench.d.archive', activate: 'bench.d.activate', deactivate: 'bench.d.deactivate', cancel: 'bench.d.cancel',
};
function opLabel(op: any): string { const k = OP_LABEL_KEY[op.id]; return (k ? t(k) : '') || op.label || op.id; }
function opDesc(op: any): string { const k = OP_DESC_KEY[op.id]; return (k ? t(k) : '') || op.explanation || ''; }
function opNote(op: any): string {
    if (op.id === 'scan') return `${op.items} ${t('bench.files') || 'files'}`;
    if (op.id === 'cancel') return t('bench.d.cancelNote') || op.note || '';
    return op.note || '';
}

// Inline SVG horizontal bar chart for a metric — used both in the live results
// panel and the exported HTML, so they look identical to the dev-suite deck.
function benchSvgChart(ops: any[], metric: 'time' | 'tput'): string {
    const catColor: Record<string, string> = { scan: '#a78bfa', hash: '#22d3ee', io: '#3b82f6', archive: '#fbbf24', activation: '#10b981' };
    const esc = (s: any) => String(s).replace(/[&<>]/g, (c: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c]);
    const rows = metric === 'tput' ? ops.filter(o => o.throughput_mb_s != null) : ops.slice();
    if (!rows.length) return '';
    const val = (o: any) => metric === 'tput' ? (o.throughput_mb_s || 0) : o.ms;
    const fmt = metric === 'tput'
        ? (v: number) => v >= 1000 ? `${(v / 1000).toFixed(2)} GB/s` : `${v.toFixed(0)} MB/s`
        : (v: number) => v < 1 ? `${(v * 1000).toFixed(0)} µs` : v < 1000 ? `${v.toFixed(1)} ms` : `${(v / 1000).toFixed(2)} s`;
    const max = Math.max(...rows.map(val), 1e-9);
    const W = 460, rowH = 30, padL = 150, padR = 96, top = 6, barW = W - padL - padR;
    const H = top + rows.length * rowH + 6;
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif">`;
    s += `<line x1="${padL}" y1="${top}" x2="${padL}" y2="${H - 6}" stroke="rgba(148,163,184,0.25)" stroke-width="1"/>`;
    rows.forEach((o, i) => {
        const y = top + i * rowH;
        const col = catColor[o.category] || '#3b82f6';
        const med = Math.max(2, (val(o) / max) * barW);
        s += `<text x="${padL - 8}" y="${y + 15}" text-anchor="end" font-size="11" fill="#cbd5e1">${esc(opLabel(o))}</text>`;
        // For the time chart, draw the min–max sample range as a faint band behind
        // the median bar — a compact distribution view (like Criterion's spread).
        if (metric === 'time' && o.max_ms > o.min_ms) {
            const xMin = (o.min_ms / max) * barW, xMax = (o.max_ms / max) * barW;
            s += `<rect x="${padL + xMin}" y="${y + 7}" width="${Math.max(1, xMax - xMin)}" height="11" rx="2" fill="${col}" opacity="0.28"/>`;
        }
        s += `<rect x="${padL}" y="${y + 5}" width="${med}" height="15" rx="3" fill="${col}"/>`;
        s += `<text x="${padL + Math.max(med, metric === 'time' && o.max_ms > o.min_ms ? (o.max_ms / max) * barW : med) + 6}" y="${y + 15}" font-size="10.5" fill="#e2e8f0" font-family="ui-monospace,monospace">${fmt(val(o))}</text>`;
    });
    return s + '</svg>';
}

// Build a self-contained HTML report (inline SVG charts + table) from a
// BenchReport — the same presentable format as the dev suite's deck.
function buildBenchReportHtml(report: any): string {
    const ops: any[] = report.results || [];
    const env = report.env || {};
    const esc = (s: any) => String(s).replace(/[&<>]/g, (c: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c]);
    const fmtMs = (ms: number) => ms < 1 ? `${(ms * 1000).toFixed(0)} µs` : ms < 1000 ? `${ms.toFixed(1)} ms` : `${(ms / 1000).toFixed(2)} s`;
    const fmtTput = (v: number | null | undefined) => (v == null) ? '' : (v >= 1000 ? `${(v / 1000).toFixed(2)} GB/s` : `${v.toFixed(0)} MB/s`);
    const catColor: Record<string, string> = { scan: '#a78bfa', hash: '#22d3ee', io: '#3b82f6', archive: '#fbbf24', activation: '#10b981' };

    const chartTput = benchSvgChart(ops, 'tput');
    const charts = `<div style="display:grid;grid-template-columns:${chartTput ? '1fr 1fr' : '1fr'};gap:16px">
        <div class="card"><h2 style="font-size:13px;margin:0 0 10px;color:#94a3b8">Operation time · lower is better</h2>${benchSvgChart(ops, 'time')}</div>
        ${chartTput ? `<div class="card"><h2 style="font-size:13px;margin:0 0 10px;color:#94a3b8">Throughput · higher is better</h2>${chartTput}</div>` : ''}
    </div>`;

    const rowsHtml = ops.map(op => { const note = opNote(op); return `<tr>
        <td style="font-weight:600;color:#f1f5f9;">${esc(opLabel(op))}</td>
        <td style="font-family:ui-monospace,monospace;color:${catColor[op.category] || '#3b82f6'};white-space:nowrap;">${fmtMs(op.ms)}${op.max_ms > op.min_ms ? ` <span style="color:#64748b">(${fmtMs(op.min_ms)}–${fmtMs(op.max_ms)})</span>` : ''}</td>
        <td style="font-family:ui-monospace,monospace;color:#94a3b8;">${fmtTput(op.throughput_mb_s)}</td>
        <td style="color:#94a3b8;font-size:12px;">${esc(opDesc(op))}${note ? ` <em>(${esc(note)})</em>` : ''}</td>
    </tr>`; }).join('');

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

// One-time styles for the perf tabs + benchmark segmented controls.
function injectBenchStyle() {
    if (document.getElementById('perf-bench-style')) return;
    const s = document.createElement('style');
    s.id = 'perf-bench-style';
    s.textContent = `
        .perf-tab { background:transparent; border:none; color:var(--text-muted); font-size:12px; font-weight:700;
            padding:6px 14px; border-radius:8px; cursor:pointer; transition:all .15s; }
        .perf-tab:hover { color:var(--text-secondary); }
        .perf-tab.active { background:var(--accent); color:#fff; box-shadow:0 2px 8px rgba(0,0,0,0.3); }
        .bench-seg { background:transparent; border:none; color:var(--text-muted); font-size:12px; font-weight:700;
            min-width:38px; padding:7px 14px; border-radius:7px; cursor:pointer; transition:all .15s; }
        .bench-seg:hover { color:var(--text-secondary); }
        .bench-seg.active { background:rgba(255,255,255,0.10); color:#fff; }
        .bench-chip { background:rgba(255,255,255,0.05); border:1px solid var(--border); color:var(--text-secondary);
            font-size:12px; font-weight:600; padding:6px 12px; border-radius:8px; cursor:pointer; transition:all .15s; }
        .bench-chip:hover { border-color:var(--bmm-s15, rgba(255,255,255,0.15)); color:#fff; }
        .bench-chip.active { background:var(--accent); border-color:var(--accent); color:#fff; }
    `;
    document.head.appendChild(s);
}

// Compatibility exports
export function openBenchmarkModal() { openAdvancedPerfModal(); }
// Allow inline doc/gallery buttons to open the benchmark panel directly.
(window as any).bmmOpenBenchmark = () => openAdvancedPerfModal();
export function startBenchmark() { invoke('start_benchmark'); }
export function stopBenchmark() { invoke('stop_benchmark'); }
