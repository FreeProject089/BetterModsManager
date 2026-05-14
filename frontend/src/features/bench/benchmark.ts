import { invoke, listen, pickFile, saveFile } from '../../core/api.js';
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
                <button class="modal-close" id="perf-modal-close" style="position: static; margin-left: 20px;">&times;</button>
            </div>
        </div>

        <div class="modal-body" style="padding: 32px; overflow-y: auto; overflow-x: visible; flex: 1; display: flex; flex-direction: column; gap: 24px; z-index: 1;">
            
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
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px;">
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
                    <div class="glass-card" style="padding: 20px; background: rgba(59, 130, 246, 0.05); border-radius: 12px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <span style="font-size: 10px; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">${t('bench.swap') || 'Swap Memory'}</span>
                            <span class="tasky-info" data-help="swap" style="cursor: help; color: var(--accent); opacity: 0.6;">?</span>
                        </div>
                        <span id="perf-swap-val" style="font-size: 20px; font-weight: 900; color: #fff; font-family: var(--font-mono);">-- MB</span>
                    </div>
                </div>
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
    
    recBtn.onclick = async () => {
        isRecording = !isRecording;
        if (isRecording) {
            await invoke('start_benchmark');
            recBtn.style.color = '#ef4444';
            (recBtn.querySelector('#rec-text') as HTMLElement).textContent = 'Stop Recording';
            (recBtn.querySelector('#rec-dot') as HTMLElement).style.display = 'block';
        } else {
            await invoke('stop_benchmark');
            recBtn.style.color = '#fff';
            (recBtn.querySelector('#rec-text') as HTMLElement).textContent = 'Start Monitoring';
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
                startStopBtn.textContent = 'STOP';
                startStopBtn.style.color = '#ef4444';
                startStopBtn.style.borderColor = 'rgba(239,68,68,0.3)';
            } else {
                startStopBtn.textContent = 'START';
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

function renderCharts(container: HTMLElement, data: BenchmarkPoint[], highlightIndex: number | null = null) {
    const mainCanvas = container.querySelector('#perf-chart-main') as HTMLCanvasElement;
    const ioCanvas = container.querySelector('#perf-chart-io') as HTMLCanvasElement;
    if (!mainCanvas || !ioCanvas) return;

    drawChart(mainCanvas, data, [
        { key: 'cpu_usage', color: '#3b82f6', label: 'CPU %' },
        { key: 'ram_usage', color: '#ffffff', label: 'RAM MB', scale: 0.1 }
    ], highlightIndex);

    drawChart(ioCanvas, data, [
        { key: 'disk_read', color: '#fbbf24', label: 'Read' },
        { key: 'disk_write', color: '#f87171', label: 'Write' }
    ], highlightIndex);
}

function drawChart(canvas: HTMLCanvasElement, data: BenchmarkPoint[], series: { key: string, color: string, label: string, scale?: number }[], highlightIndex: number | null) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width, h = rect.height;
    ctx.clearRect(0, 0, w, h);

    if (data.length < 2) return;

    let maxVal = 1;
    data.forEach(p => series.forEach(s => {
        const val = (p as any)[s.key] * (s.scale || 1);
        if (val > maxVal) maxVal = val;
    }));
    maxVal *= 1.2;

    series.forEach(s => {
        ctx.beginPath(); ctx.strokeStyle = s.color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
        data.forEach((p, i) => {
            const x = (i / (data.length - 1)) * w;
            const y = Math.max(2, h - ((p as any)[s.key] * (s.scale || 1) / maxVal) * h);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.lineTo(w, h); ctx.lineTo(0, h);
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, s.color + '33'); grad.addColorStop(1, s.color + '00');
        ctx.fillStyle = grad; ctx.fill();
    });

    // Hover or Highlight logic
    const index = highlightIndex !== null ? highlightIndex : hoverIndex;
    if (index !== null && data[index]) {
        const x = (index / (data.length - 1)) * w;
        ctx.beginPath(); ctx.strokeStyle = highlightIndex !== null ? 'var(--accent)' : 'rgba(255,255,255,0.4)';
        ctx.setLineDash([5, 5]); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); ctx.setLineDash([]);
        series.forEach(s => {
            const y = Math.max(2, h - ((data[index] as any)[s.key] * (s.scale || 1) / maxVal) * h);
            ctx.beginPath(); ctx.fillStyle = s.color; ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        });
    }
}

// Compatibility exports
export function openBenchmarkModal() { openAdvancedPerfModal(); }
export function startBenchmark() { invoke('start_benchmark'); }
export function stopBenchmark() { invoke('stop_benchmark'); }
