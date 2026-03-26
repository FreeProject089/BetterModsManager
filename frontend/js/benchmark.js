import { invoke } from './api.js';
import { t } from './i18n.js';
import { toast } from './app.js';

let benchmarkPoints = [];
let fullBenchmarkHistory = [];
let recentEvents = [];
let isBenchmarkActive = false;
let currentEvent = "";
let eventTimeout = null;
let benchmarkStartTime = null;
let playbackIndex = -1;
let replayInterval = null;
let autoStopTimeout = null;
let activeDiskName = "";

const MAX_DISPLAY_POINTS = 60;

export async function initBenchmark() {
    const isEnabled = await invoke('is_benchmark_enabled');
    const btn = document.getElementById('btn-open-benchmark');
    if (!isEnabled) {
        if (btn) btn.style.display = 'none';
        return;
    }

    if (btn) {
        btn.style.display = 'flex';
        btn.addEventListener('click', openBenchmarkModal);
    }

    // Listen for backend data
    const { listen } = window.__TAURI__.event;
    await listen('benchmark-point', (event) => {
        if (!isBenchmarkActive) return;
        const point = event.payload;
        point.event = currentEvent;

        benchmarkPoints.push(point);
        if (benchmarkPoints.length > MAX_DISPLAY_POINTS) benchmarkPoints.shift();

        fullBenchmarkHistory.push({ ...point });

        updateBenchmarkUI();
        updateFloatingMonitor(point);
    });

    await listen('benchmark-event', (event) => {
        let payloadText = "";
        let etaStr = "";

        if (typeof event.payload === 'object' && event.payload !== null) {
            payloadText = event.payload.text || "";
            activeDiskName = event.payload.disk_name || "";
            const tMb = event.payload.total_mb || 0;
            const lMb = event.payload.limit_mb_s;

            let diskStr = activeDiskName ? ` [${activeDiskName}]` : "";

            if (lMb && lMb > 0 && tMb > 0) {
                // Approximate 5% overhead in calculation 
                const sec = Math.ceil((tMb / lMb) * 1.05);
                const m = Math.floor(sec / 60);
                const s = Math.floor(sec % 60);
                etaStr = ` ⏱️ ETA: ${m > 0 ? m + 'm ' : ''}${s}s`;
            } else if (tMb > 0) {
                etaStr = ` ⏱️ ${t('benchmark.maxSpeed')}`;
            }

            currentEvent = payloadText + diskStr + etaStr;
        } else {
            currentEvent = event.payload;
            activeDiskName = "";
        }

        if (currentEvent) {
            const isFinished = (typeof event.payload === 'object' && event.payload !== null) ? event.payload.finished : true;
            const eventId = Date.now() + Math.random().toString(36).substr(2, 9);

            // If it's a "finished" event, try to find and remove the "progress" entry for the same mod to avoid duplicates
            if (isFinished && typeof event.payload === 'object' && event.payload !== null) {
                const modName = payloadText.split(': ').pop();
                recentEvents = recentEvents.filter(e => {
                    const isOldProgress = e.text.includes('Activating mod:') || e.text.includes('Disabling mod:');
                    const sameMod = e.text.includes(modName);
                    return !(isOldProgress && sameMod);
                });
            }

            recentEvents.unshift({
                id: eventId,
                text: currentEvent,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            });

            if (recentEvents.length > 20) recentEvents.pop();

            // Granular clearing: only remove this specific event after 5s if it's finished
            if (isFinished) {
                setTimeout(() => {
                    recentEvents = recentEvents.filter(e => e.id !== eventId);

                    // Also clear main label if it matches
                    if (currentEvent === payloadText + (activeDiskName ? ` [${activeDiskName}]` : "")) {
                        currentEvent = "";
                        activeDiskName = "";
                    }

                    updateBenchmarkUI();
                    const lastPoint = benchmarkPoints[benchmarkPoints.length - 1];
                    if (lastPoint) updateFloatingMonitor(lastPoint);
                }, 5000);
            }
        }

        updateBenchmarkUI();
        const lastPoint = benchmarkPoints[benchmarkPoints.length - 1];
        if (lastPoint) updateFloatingMonitor(lastPoint);
    });

    document.getElementById('btn-toggle-bench').addEventListener('click', () => {
        if (isBenchmarkActive) stopBenchmark();
        else startBenchmark();
    });
    document.getElementById('btn-export-bench').addEventListener('click', exportBenchmark);
    document.getElementById('btn-import-bench').addEventListener('click', importBenchmark);
    document.getElementById('btn-toggle-pip').addEventListener('click', togglePiP);

    const btnReset = document.getElementById('btn-reset-bench');
    if (btnReset) btnReset.addEventListener('click', resetBenchmarkSession);

    const btnReplay = document.getElementById('btn-replay-playpause');
    if (btnReplay) btnReplay.addEventListener('click', toggleReplay);

    const slider = document.getElementById('benchmark-playback-slider');
    if (slider) {
        slider.addEventListener('input', (e) => {
            if (fullBenchmarkHistory.length === 0) return;
            playbackIndex = parseInt(e.target.value);
            syncPlaybackView();
        });
    }

    // Global listener to ensure PiP stays active if it was already active
    const modal = document.getElementById('modal-benchmark');
    if (modal) {
        // No-op or specific persistence logic if needed
    }

    const timeline = document.getElementById('main-timeline');
    if (timeline) {
        timeline.addEventListener('click', (e) => {
            if (fullBenchmarkHistory.length === 0) return;
            const rect = timeline.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const ratio = x / rect.width;
            playbackIndex = Math.floor(ratio * fullBenchmarkHistory.length);
            playbackIndex = Math.min(Math.max(0, playbackIndex), fullBenchmarkHistory.length - 1);
            syncPlaybackView();
        });
    }
}

function resetBenchmarkSession() {
    benchmarkPoints = [];
    fullBenchmarkHistory = [];
    recentEvents = [];
    benchmarkStartTime = isBenchmarkActive ? Date.now() : null;
    playbackIndex = -1;
    updateBenchmarkUI();
    toast(t('benchmark.sessionReset'), "info");
}

async function importBenchmark() {
    try {
        const { open } = window.__TAURI__.dialog;
        const selected = await open({
            multiple: false,
            filters: [{ name: 'CSV', extensions: ['csv'] }]
        });

        if (selected) {
            const { readTextFile } = window.__TAURI__.fs;
            const content = await readTextFile(selected);
            const lines = content.split('\n');
            const data = [];

            // Basic CSV parser for BMM format
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split(',');
                if (parts.length < 5 || isNaN(parseInt(parts[0]))) continue;
                data.push({
                    timestamp: parseInt(parts[0]),
                    cpu_usage: parseFloat(parts[1]),
                    ram_usage: parseInt(parts[2]),
                    disk_read: parseInt(parts[3]),
                    disk_write: parseInt(parts[4]),
                    event: parts[5] || ""
                });
            }

            if (data.length > 0) {
                stopBenchmark(); // stop live tracking if active
                benchmarkPoints = data.length > MAX_DISPLAY_POINTS ? data.slice(-MAX_DISPLAY_POINTS) : data;
                fullBenchmarkHistory = data;
                isBenchmarkActive = false; // It's a static view
                updateBenchmarkUI();
                toast(t('benchmark.importSuccess').replace('{count}', data.length), "success");
            } else {
                toast(t('benchmark.importInvalid'), "error");
            }
        }
    } catch (e) {
        toast(t('common.error') + " : " + e, "error");
    }
}

async function startBenchmark() {
    try {
        await invoke('start_benchmark');
        isBenchmarkActive = true;
        benchmarkStartTime = Date.now();
        benchmarkPoints = [];
        fullBenchmarkHistory = [];
        recentEvents = [];
        playbackIndex = -1;

        const pb = document.getElementById('playback-controls');
        if (pb) pb.style.display = 'none';

        const autoStopVal = document.getElementById('benchmark-autostop-val');
        const autoStopUnit = document.getElementById('benchmark-autostop-unit');
        const val = parseInt(autoStopVal ? autoStopVal.value : "0");
        const unit = autoStopUnit ? autoStopUnit.value : "m";

        if (val > 0) {
            let mult = 60 * 1000;
            if (unit === 'h') mult = 60 * 60 * 1000;
            if (unit === 'd') mult = 24 * 60 * 60 * 1000;

            autoStopTimeout = setTimeout(() => {
                if (isBenchmarkActive) stopBenchmark();
            }, val * mult);
        }

        updateBenchmarkUI();
        updateFloatingMonitorState(true);
        renderEmptyMonitor();

        const btn = document.getElementById('btn-toggle-bench');
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-danger', 'pulse');
        btn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <rect x="6" y="6" width="12" height="12" rx="2" ry="2" />
            </svg>
            <span id="label-toggle-bench" data-i18n="benchmark.stop">${t('benchmark.stop') || 'Stop Tracking'}</span>
        `;
        toast(t('benchmark.started'), "info");
    } catch (e) {
        toast(t('common.error') + " : " + e, "error");
    }
}

async function stopBenchmark() {
    await invoke('stop_benchmark');
    isBenchmarkActive = false;
    updateFloatingMonitorState(false);

    if (autoStopTimeout) {
        clearTimeout(autoStopTimeout);
        autoStopTimeout = null;
    }

    const btn = document.getElementById('btn-toggle-bench');
    btn.classList.remove('btn-danger', 'pulse');
    btn.classList.add('btn-primary');
    btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M5 3l14 9-14 9V3z" />
        </svg>
        <span id="label-toggle-bench" data-i18n="benchmark.startTracking">${t('benchmark.startTracking') || 'Start Tracking'}</span>
    `;

    toast(t('benchmark.stopped'), "success");

    // Sync PiP buttons
    if (fullBenchmarkHistory.length > 0) {
        updateFloatingMonitor(fullBenchmarkHistory[fullBenchmarkHistory.length - 1]);
    } else {
        renderEmptyMonitor();
    }
}

function openBenchmarkModal() {
    document.getElementById('modal-benchmark').classList.add('open');
    updateBenchmarkUI();
}

function togglePiP() {
    const pip = document.getElementById('benchmark-pip');
    pip.classList.toggle('active');
    if (pip.classList.contains('active') && benchmarkPoints.length > 0) {
        updateFloatingMonitor(benchmarkPoints[benchmarkPoints.length - 1]);
    } else if (pip.classList.contains('active')) {
        renderEmptyMonitor();
    }
}

function updateFloatingMonitorState(active) {
    const pip = document.getElementById('benchmark-pip');
    if (active) pip.classList.add('is-tracking');
    else pip.classList.remove('is-tracking');
}



function getElapsedString(customStartTime = null) {
    const start = customStartTime || benchmarkStartTime;
    if (!start) return "00:00";
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const s = (elapsed % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function formatDisk(kbps) {
    if (kbps >= 1024) return (kbps / 1024).toFixed(1) + ' MB/s';
    return kbps.toFixed(0) + ' KB/s';
}

function syncPlaybackView() {
    if (playbackIndex < 0 || playbackIndex >= fullBenchmarkHistory.length) return;

    const point = fullBenchmarkHistory[playbackIndex];
    const startWindow = Math.max(0, playbackIndex - MAX_DISPLAY_POINTS + 1);
    benchmarkPoints = fullBenchmarkHistory.slice(startWindow, playbackIndex + 1);

    updateBenchmarkUI(true);
    updateFloatingMonitor(point, true);

    const timeDisplay = document.getElementById('playback-time-display');
    if (timeDisplay) timeDisplay.textContent = `${playbackIndex + 1} / ${fullBenchmarkHistory.length}`;
}

function renderEmptyMonitor() {
    const pip = document.getElementById('benchmark-pip');
    pip.innerHTML = `
        <div class="pip-header">
            <span>${t('benchmark.title')}</span>
        </div>
        <div class="pip-body" style="text-align:center; padding:20px 0; color:var(--text-muted); font-size:11px">
            ${t('benchmark.noData')}
        </div>
        <div class="pip-actions">
            <button class="pip-btn ${isBenchmarkActive ? 'stop' : 'start'}" onclick="window.dispatchBenchmarkAction('${isBenchmarkActive ? 'stop' : 'start'}')">${t(isBenchmarkActive ? 'benchmark.stop' : 'benchmark.start')}</button>
            <button class="pip-btn close" onclick="document.getElementById('benchmark-pip').classList.remove('active')">${t('common.close')}</button>
        </div>
    `;
}

function updateBenchmarkUI(isPlayback = false) {
    const cpuData = benchmarkPoints.map(p => p.cpu_usage);
    const ramData = benchmarkPoints.map(p => p.ram_usage);
    const diskData = benchmarkPoints.map(p => p.disk_read + p.disk_write);

    const maxCpu = Math.max(10, ...cpuData, 100);
    const maxRam = Math.max(128, ...ramData) * 1.1;
    const maxDisk = Math.max(100, ...diskData) * 1.2;

    const last = benchmarkPoints.length > 0 ? benchmarkPoints[benchmarkPoints.length - 1] : { cpu_usage: 0, ram_usage: 0, disk_read: 0, disk_write: 0 };
    const totalDisk = last.disk_read + last.disk_write;

    // Calculate Averages
    const getAvg = (arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const cpuAvg = getAvg(cpuData);
    const ramAvg = getAvg(ramData);
    const diskAvg = getAvg(diskData);

    renderChart('cpu-chart', cpuData, maxCpu, '#3b82f6', '%', MAX_DISPLAY_POINTS, last.cpu_usage.toFixed(1), cpuAvg);
    renderChart('ram-chart', ramData, maxRam, '#10b981', 'MB', MAX_DISPLAY_POINTS, last.ram_usage.toFixed(0), ramAvg);
    renderChart('disk-chart', diskData, maxDisk, '#f59e0b', 'KB/s', MAX_DISPLAY_POINTS, formatDisk(totalDisk), diskAvg);

    // Update Avg Badges
    const updateAvgBadge = (id, val, unit) => {
        const el = document.getElementById(id);
        if (el) el.textContent = `AVG: ${val} ${unit}`;
    };
    updateAvgBadge('cpu-avg-badge', cpuAvg.toFixed(1), '%');
    updateAvgBadge('ram-avg-badge', ramAvg.toFixed(0), 'MB');
    updateAvgBadge('disk-avg-badge', formatDisk(diskAvg), '');

    updateTimeline();
    updateReplayControls();

    const stats = document.getElementById('benchmark-live-stats');
    if (stats) {
        stats.innerHTML = `<div style="color:var(--success); font-weight:700; font-size:12px; height:20px; text-align:center">${currentEvent ? '• ' + currentEvent : ''}</div>`;
    }

    const diskTitleSpan = document.querySelector('#disk-chart')?.closest('.chart-container')?.querySelector('.chart-title span');
    if (diskTitleSpan) {
        if (!diskTitleSpan.dataset.origText) diskTitleSpan.dataset.origText = diskTitleSpan.textContent;
        diskTitleSpan.textContent = diskTitleSpan.dataset.origText + (activeDiskName ? ' [' + activeDiskName + ']' : '');
    }
}

function updateTimeline() {
    const total = fullBenchmarkHistory.length;
    if (total === 0) return;

    const currentIdx = playbackIndex >= 0 ? playbackIndex : total - 1;
    const windowSize = MAX_DISPLAY_POINTS;
    const half = Math.floor(windowSize / 2);

    // Calculate visualization window based on playhead at center
    let startWindow = currentIdx - half;
    let endWindow = currentIdx + half - 1;

    // Clamp
    if (startWindow < 0) {
        endWindow -= startWindow;
        startWindow = 0;
    }
    endWindow = Math.min(total - 1, endWindow);

    // Total Duration (Purple) - always 100% in this view
    const totalTimeEl = document.getElementById('timeline-total-time');
    if (totalTimeEl) {
        const totalSec = total; // 1 sample = 1s
        const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
        const s = (totalSec % 60).toString().padStart(2, '0');
        totalTimeEl.textContent = `${m}:${s}`;
    }

    // Current Time (based on playhead/playbackIndex)
    const currentTimeEl = document.getElementById('timeline-current-time');
    if (currentTimeEl) {
        const curSec = currentIdx + 1;
        const m = Math.floor(curSec / 60).toString().padStart(2, '0');
        const s = (curSec % 60).toString().padStart(2, '0');
        currentTimeEl.textContent = `${m}:${s}`;
    }

    // Bars
    const redTrack = document.getElementById('tl-track-window');
    if (redTrack) {
        const left = (startWindow / total) * 100;
        const width = ((endWindow - startWindow + 1) / total) * 100;
        redTrack.style.left = left + '%';
        redTrack.style.width = width + '%';
    }

    const playhead = document.getElementById('tl-playhead');
    if (playhead) {
        playhead.style.left = (currentIdx / total) * 100 + '%';
    }

    // Draw Activity Spikes
    drawTimelineSpikes(total);
}

function drawTimelineSpikes(total) {
    const purpleTrack = document.getElementById('tl-track-total');
    if (!purpleTrack) return;

    // Only draw once or update efficiently
    if (purpleTrack.dataset.renderedTotal === String(total)) return;
    purpleTrack.dataset.renderedTotal = total;

    // Clear old spikes
    purpleTrack.innerHTML = '';

    // Calculate max activity to normalize spikes
    const maxDisk = Math.max(...fullBenchmarkHistory.map(p => p.disk_read + p.disk_write), 10);
    const maxCpu = Math.max(...fullBenchmarkHistory.map(p => p.cpu_usage), 10);

    // Create spikes
    const MAX_SPIKES = 200;
    const step = Math.max(1, Math.floor(total / MAX_SPIKES));

    for (let i = 0; i < total; i += step) {
        const p = fullBenchmarkHistory[i];
        const activity = Math.max((p.cpu_usage / maxCpu), ((p.disk_read + p.disk_write) / maxDisk));

        if (activity > 0.1) {
            const spike = document.createElement('div');
            spike.style.position = 'absolute';
            spike.style.left = (i / total) * 100 + '%';
            spike.style.bottom = '0';
            spike.style.width = '3px';
            spike.style.height = Math.max((activity * 100), 20) + '%';
            spike.style.backgroundColor = '#facc15'; // Bright yellow
            spike.style.boxShadow = '0 0 10px #facc15';
            spike.style.borderRadius = '2px';
            spike.style.zIndex = '5';
            purpleTrack.appendChild(spike);
        }
    }
}

function toggleReplay() {
    const btn = document.getElementById('btn-replay-playpause');
    if (!btn) return;

    if (replayInterval) {
        clearInterval(replayInterval);
        replayInterval = null;
        // set icon to play
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
    } else {
        // start playback
        if (playbackIndex >= fullBenchmarkHistory.length - 1) {
            playbackIndex = 0; // restart if at end
        }
        replayInterval = setInterval(() => {
            playbackIndex++;
            syncPlaybackView();
            if (playbackIndex >= fullBenchmarkHistory.length - 1) {
                toggleReplay(); // stop at end
            }
        }, 1000);
        // set icon to pause
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
    }
}

function updateReplayControls() {
    const replayBtn = document.getElementById('btn-replay-playpause');
    if (!replayBtn) return;

    if (!isBenchmarkActive && fullBenchmarkHistory.length > 0) {
        replayBtn.style.display = 'flex';
    } else {
        replayBtn.style.display = 'none';
        if (replayInterval) toggleReplay(); // stop it
    }
}


function updateFloatingMonitor(point, isPlayback = false) {
    const pip = document.getElementById('benchmark-pip');
    if (!pip || !pip.classList.contains('active')) return;

    if (!pip.querySelector('.pip-stat') || pip.querySelector('.READY-TO-RECORD')) {
        pip.innerHTML = `
            <div class="pip-header">
                <span>${t('benchmark.title')}</span>
                <div style="display:flex; gap:8px; align-items:center">
                    <span id="pip-timer" class="ev-time" style="font-size:10px">00:00</span>
                    <button class="pip-maximize" onclick="window.dispatchBenchmarkAction('maximize')">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                    </button>
                </div>
            </div>
            <div class="pip-body">
                <div class="pip-stat"><span class="stat-label">CPU</span><div class="pip-bar"><div id="pip-cpu-bar"></div></div><span id="pip-cpu-val" class="stat-value">0%</span></div>
                <div class="pip-stat"><span class="stat-label">RAM</span><div class="pip-bar"><div id="pip-ram-bar"></div></div><span id="pip-ram-val" class="stat-value">0MB</span></div>
                <div class="pip-stat"><span class="stat-label" id="pip-disk-label">DISK</span><div class="pip-bar"><div id="pip-disk-bar"></div></div><span id="pip-disk-val" class="stat-value">0K</span></div>
                <div class="pip-event-list" id="pip-events"></div>
            </div>
            <div class="pip-actions" id="pip-actions-root"></div>
        `;
    }

    const timerEl = document.getElementById('pip-timer');
    if (timerEl) {
        timerEl.textContent = isPlayback ? "PLAYBACK" : getElapsedString();
    }

    const cpuBar = document.getElementById('pip-cpu-bar');
    const cpuVal = document.getElementById('pip-cpu-val');
    if (cpuBar) {
        cpuBar.style.width = Math.min(point.cpu_usage, 100) + '%';
        cpuBar.style.background = '#3b82f6';
        if (cpuVal) cpuVal.textContent = point.cpu_usage.toFixed(0) + '%';
    }

    const ramBar = document.getElementById('pip-ram-bar');
    const ramVal = document.getElementById('pip-ram-val');
    if (ramBar) {
        ramBar.style.width = Math.min((point.ram_usage / 4096) * 100, 100) + '%';
        ramBar.style.background = '#10b981';
        if (ramVal) ramVal.textContent = point.ram_usage + 'M';
    }

    const totalDisk = point.disk_read + point.disk_write;
    const diskBar = document.getElementById('pip-disk-bar');
    const diskVal = document.getElementById('pip-disk-val');
    if (diskBar) {
        diskBar.style.width = Math.min((totalDisk / 50000) * 100, 100) + '%';
        diskBar.style.background = '#f59e0b';
        const formatted = formatDisk(totalDisk);
        if (diskVal) diskVal.textContent = formatted.replace(' MB/s', 'M').replace(' KB/s', 'K');
    }

    const pipDiskLabel = document.getElementById('pip-disk-label');
    if (pipDiskLabel) {
        pipDiskLabel.textContent = `DISK ${activeDiskName ? '[' + activeDiskName + ']' : ''}`;
    }

    const eventList = document.getElementById('pip-events');
    if (eventList) {
        const newEventsHtml = recentEvents.map(ev => `
            <div class="pip-event-item">
                <span class="ev-time">${ev.time}</span>
                <span class="ev-text">${ev.text}</span>
            </div>
        `).join('');

        if (eventList.innerHTML !== newEventsHtml) {
            const oldScroll = eventList.scrollTop;
            eventList.innerHTML = newEventsHtml || '<div style="text-align:center; padding:15px; opacity:0.3; font-size:9px; letter-spacing:1px">IDLE</div>';
            if (oldScroll > 0) eventList.scrollTop = oldScroll;
        }
    }

    const actions = document.getElementById('pip-actions-root');
    if (actions) {
        let actionBtn = '';
        if (!isPlayback) {
            if (isBenchmarkActive) {
                actionBtn = `<button class="pip-btn stop" onclick="window.dispatchBenchmarkAction('stop')">${t('benchmark.stop') || 'Stop'}</button>`;
            } else {
                actionBtn = `<button class="pip-btn start" onclick="window.dispatchBenchmarkAction('start')">${t('benchmark.start') || 'Start'}</button>`;
            }
        }

        const actionsHtml = `
            ${actionBtn}
            <button class="pip-btn close" onclick="document.getElementById('benchmark-pip').classList.remove('active')">${t('common.close')}</button>
        `;
        if (actions.innerHTML !== actionsHtml) {
            actions.innerHTML = actionsHtml;
        }
    }
}

window.dispatchBenchmarkAction = (action) => {
    if (action === 'start') startBenchmark();
    if (action === 'stop') stopBenchmark();
    if (action === 'maximize') openBenchmarkModal();
};

function renderChart(elementId, data, maxValue, color, unit, maxPoints, currentValue, avgValue = 0) {
    const container = document.getElementById(elementId);
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const width = rect.width || 600;
    const height = 120;
    const padding = 10;

    const parent = container.closest('.chart-container');
    if (parent) {
        const badge = parent.querySelector('.chart-badge:not(.avg)');
        if (badge) badge.textContent = `${currentValue} ${unit.includes('/') ? '' : unit}`;
    }

    if (data.length < 2) {
        container.innerHTML = `<div style="height:${height}px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px; opacity:0.5; letter-spacing:1px">${t('benchmark.waitingSensors')}</div>`;
        return;
    }

    let pointsStr = '';
    const step = width / (maxPoints - 1);
    data.forEach((val, i) => {
        const x = i * step;
        const y = height - (val / maxValue) * (height - padding * 2) - padding;
        pointsStr += `${x},${y} `;
    });

    const avgY = height - (avgValue / maxValue) * (height - padding * 2) - padding;

    // Build the SVG
    container.innerHTML = `
        <div class="chart-tooltip">${currentValue} ${unit}</div>
        <div class="chart-seeker" style="display:none"></div>
        <svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="display:block">
            <defs>
                <linearGradient id="grad-${elementId}" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="${color}" stop-opacity="0.4" />
                    <stop offset="100%" stop-color="${color}" stop-opacity="0" />
                </linearGradient>
            </defs>
            <!-- Average Line -->
            <line x1="0" y1="${avgY}" x2="${width}" y2="${avgY}" stroke="${color}" stroke-width="1" stroke-dasharray="4,4" opacity="0.4" />
            
            <polyline points="${pointsStr} ${(data.length - 1) * step},${height} 0,${height}" fill="url(#grad-${elementId})" />
            <polyline points="${pointsStr}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
        </svg>
    `;

    // Interactivity: Seeker Line
    container.onmousemove = (e) => {
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const tooltip = container.querySelector('.chart-tooltip');
        const seeker = container.querySelector('.chart-seeker');

        if (seeker) {
            seeker.style.display = 'block';
            seeker.style.left = x + 'px';
        }

        if (data.length > 0) {
            const index = Math.round(x / step);
            const val = data[index];
            if (val !== undefined && tooltip) {
                tooltip.style.display = 'block';
                tooltip.style.left = (x + 10) + 'px';
                tooltip.style.top = (height / 2) + 'px';
                tooltip.textContent = `${unit === 'KB/s' ? formatDisk(val) : val.toFixed(1) + ' ' + unit}`;
            }
        }
    };
    container.onmouseleave = () => {
        const tooltip = container.querySelector('.chart-tooltip');
        const seeker = container.querySelector('.chart-seeker');
        if (seeker) seeker.style.display = 'none';
        // Keep tooltip showing last value or hide? User said "naviguée", so showing hover value is good.
        if (tooltip) tooltip.textContent = `${currentValue} ${unit}`;
    };
}

async function exportBenchmark() {
    const dataToExport = fullBenchmarkHistory.length > 0 ? fullBenchmarkHistory : benchmarkPoints;
    if (dataToExport.length === 0) return;

    try {
        const { save } = window.__TAURI__.dialog;
        const dest = await save({
            defaultPath: `BMM_Benchmark_${new Date().toISOString().split('T')[0]}.csv`,
            filters: [{ name: 'CSV', extensions: ['csv'] }]
        });
        if (dest) {
            const duration = getElapsedString();
            const cpuAvg = (dataToExport.reduce((s, p) => s + p.cpu_usage, 0) / dataToExport.length).toFixed(2);
            const ramMax = Math.max(...dataToExport.map(p => p.ram_usage));
            const diskMax = Math.max(...dataToExport.map(p => p.disk_read + p.disk_write));

            let csv = "BMM BENCHMARK SESSION\n";
            csv += `Date,${new Date().toLocaleString()}\n`;
            csv += `Duration,${duration}\n`;
            csv += `Total Samples,${dataToExport.length}\n\n`;

            csv += "Timestamp,CPU (%),RAM (MB),Disk Read (KB/s),Disk Write (KB/s),Event\n";
            dataToExport.forEach(p => {
                csv += `${p.timestamp},${p.cpu_usage},${p.ram_usage},${p.disk_read},${p.disk_write},"${p.event || ""}"\n`;
            });

            csv += `\nSUMMARY\n`;
            csv += `Average CPU,${cpuAvg}%\n`;
            csv += `Peak RAM,${ramMax} MB\n`;
            csv += `Peak Disk,${formatDisk(diskMax)}\n`;

            const { writeTextFile } = window.__TAURI__.fs;
            await writeTextFile(dest, csv);
            toast(t('benchmark.exportSuccessStatus'), "success");
        }
    } catch (e) {
        toast(t('common.error') + " : " + e, "error");
    }
}
