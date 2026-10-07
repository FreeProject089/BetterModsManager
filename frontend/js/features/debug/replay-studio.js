// Replay Studio — a DevTools recorder that turns a live BMM session into a .bmmreplay
// (rrweb) file, with a movable capture FRAME, pause/resume, and a post-record trim.
//
// How it relates to the existing recorder: it reuses the shared rrweb engine via
// `subscribeReplay` (same masking/blocking/image-inlining as telemetry), forcing a fresh
// FULL snapshot at start and after every resume so each segment is self-contained. The
// frame is realised at PLAYBACK: we record the whole DOM (rrweb can't crop to a visual
// region) and store a `regions` timeline; a region-aware player crops the viewport to the
// active frame. Existing players ignore `regions` and simply show the full frame — so the
// file stays backward-compatible.
//
// NOTE: the rrweb runtime behaviours here (forced `takeFullSnapshot`, multi-segment
// playback, pause-gap compression, region crop) follow rrweb's documented APIs but need a
// live-app pass to confirm end-to-end — they can't be exercised without the running webview.
import { invoke } from '../../core/api.js';
import { planCuts, applyCuts, shiftPastCuts } from './replay-cut.js';
import { t } from '../../core/i18n.js';
import { loadRrweb, subscribeReplay, unsubscribeReplay, isFullReplay, setExtraBlockSelectors } from '../../core/replay-recorder.js';
import { captureSupport, startCapture, stopCapture, isCapturing } from './video-capture.js';
// A studio recording buffers every event in memory until you export, so it needs a hard
// ceiling — the shared telemetry watcher has one, and this path used to have none at all
// (an afk recording grew until Tauri ran out of memory). Trimming the HEAD is not an option
// here: the buffer opens with the full snapshot every later event is a delta against, so
// dropping from the front produces a file that cannot be played. We therefore STOP at the
// cap and say so, which keeps the recording valid and the choice with the user.
const STUDIO_BYTE_BUDGET = 64 * 1024 * 1024;
const STUDIO_WARN_AT = 0.75;
function approxBytes(ev) {
    try {
        return JSON.stringify(ev).length * 2;
    }
    catch {
        return 4096;
    }
}
function fmtMB(bytes) { return (bytes / (1024 * 1024)).toFixed(1) + ' MB'; }
let S = null;
let listener = null;
let bar = null;
// Collapsed to a pill. Module-level rather than on S, because the bar re-renders on
// every state change and a flag living inside the render would reset itself each
// time — you would minimise it and watch it reopen on the next meter tick.
let minimized = false;
let frameEl = null;
// Everything the studio hangs on window/document (frame drag, element picker) is registered
// with this signal, so closing the studio removes all of it in one call — closing used to
// leave the frame's pointermove/pointerup on window for good, and a picker started before
// closing kept eating the app's next click.
let studioAC = null;
let cancelPick = null;
// ── frame geometry ──────────────────────────────────────────────────────────────
function fullscreenRect() {
    return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
}
// "Main window without the Tasky decoration": everything below the custom title/top bar.
// We measure a title/top-bar element if present, else fall back to fullscreen.
function mainRect() {
    const barSel = '#titlebar, .titlebar, .window-titlebar, #app-titlebar, .app-topbar, [data-titlebar]';
    const el = document.querySelector(barSel);
    const top = el ? Math.round(el.getBoundingClientRect().bottom) : 0;
    return { x: 0, y: top, w: window.innerWidth, h: window.innerHeight - top };
}
function presetRect(p) {
    if (p === 'fullscreen')
        return fullscreenRect();
    if (p === 'main')
        return mainRect();
    // custom default: a centred 70% box
    const w = Math.round(window.innerWidth * 0.7);
    const h = Math.round(window.innerHeight * 0.7);
    return { x: Math.round((window.innerWidth - w) / 2), y: Math.round((window.innerHeight - h) / 2), w, h };
}
// ── the on-screen frame overlay (not recorded — carries bmm-no-record) ──
function renderFrame() {
    if (!S)
        return;
    if (!frameEl) {
        frameEl = document.createElement('div');
        frameEl.className = 'rstudio-frame bmm-no-record';
        frameEl.setAttribute('data-bmm-no-record', '1');
        document.body.appendChild(frameEl);
        makeDraggable(frameEl);
    }
    const editable = S.preset === 'custom'; // the custom frame stays draggable while recording
    const r = S.frame;
    Object.assign(frameEl.style, {
        left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px',
        pointerEvents: editable ? 'auto' : 'none',
        cursor: editable ? 'move' : 'default',
    });
    frameEl.classList.toggle('rstudio-frame-locked', !editable);
}
function removeFrame() { frameEl?.remove(); frameEl = null; }
// The studio's floating UI lives in the app frame like every other overlay (an overlay on
// <body> spills over the transparent window margin). The capture FRAME stays on <body>:
// its rectangle is in window coordinates, the same ones the recording uses.
function uiHost() {
    return document.getElementById('app-window-outer') || document.body;
}
// Drag to move + a bottom-right handle to resize (custom preset only).
function makeDraggable(el) {
    const handle = document.createElement('div');
    handle.className = 'rstudio-frame-handle';
    el.appendChild(handle);
    let mode = '';
    let ox = 0, oy = 0, or = { x: 0, y: 0, w: 0, h: 0 };
    const down = (e, m) => {
        if (!S || S.preset !== 'custom')
            return;
        mode = m;
        ox = e.clientX;
        oy = e.clientY;
        or = { ...S.frame };
        e.target.setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
    };
    el.addEventListener('pointerdown', (e) => { if (e.target === el)
        down(e, 'move'); });
    handle.addEventListener('pointerdown', (e) => down(e, 'resize'));
    const move = (e) => {
        if (!S || !mode)
            return;
        const dx = e.clientX - ox, dy = e.clientY - oy;
        if (mode === 'move') {
            S.frame = { ...or, x: Math.max(0, or.x + dx), y: Math.max(0, or.y + dy) };
        }
        else {
            S.frame = { ...or, w: Math.max(120, or.w + dx), h: Math.max(90, or.h + dy) };
        }
        renderFrame();
    };
    const up = () => { if (mode && S?.recording && !S.paused)
        pushRegion(); mode = ''; };
    const signal = studioAC?.signal;
    window.addEventListener('pointermove', move, { signal });
    window.addEventListener('pointerup', up, { signal });
}
// ── region timeline ──
function pushRegion() {
    if (!S)
        return;
    S.regions.push({ ts: Date.now(), rect: { ...S.frame } });
}
// ── forced full snapshot (segment anchor) ──
async function takeSnapshot() {
    try {
        (await loadRrweb())?.record?.takeFullSnapshot?.(true);
    }
    catch { /* ignore */ }
}
// Hide every no-record overlay (the studios themselves) with INLINE display:none. rrweb
// serialises the live DOM for a snapshot, so hiding them just before the start snapshot keeps
// them out of it entirely (no placeholder box). The later reveal is a mutation on a blocked
// element, which rrweb ignores — so they stay absent from the whole recording.
//
// It restores EXACTLY what it changed. It used to reveal by writing display:'' onto every
// no-record element in the document — including ones that were hidden on purpose by an
// inline style (a closed DevTools dialog, a highlighter box), which then reappeared.
const hiddenByStudio = new Map();
function hideNoRecord(on) {
    if (on) {
        document.querySelectorAll('.bmm-no-record, [data-bmm-no-record]').forEach((el) => {
            if (hiddenByStudio.has(el))
                return;
            hiddenByStudio.set(el, el.style.display);
            el.style.display = 'none';
        });
    }
    else {
        for (const [el, prev] of hiddenByStudio)
            el.style.display = prev;
        hiddenByStudio.clear();
    }
}
// A stable-ish CSS selector for a picked element (id → a couple of classes → tag), skipping
// our own studio classes so a pick never targets the toolbar.
function selectorFor(el) {
    if (el.id)
        return '#' + CSS.escape(el.id);
    const cn = typeof el.className === 'string' ? el.className : '';
    const cls = cn.trim().split(/\s+/).filter((c) => c && !c.startsWith('rstudio') && !c.startsWith('anim-') && c !== 'bmm-no-record').slice(0, 2);
    return el.tagName.toLowerCase() + (cls.length ? '.' + cls.map((c) => CSS.escape(c)).join('.') : '');
}
// A hover-highlight box so the user sees what they're about to hide while picking.
function makeHighlighter() {
    const box = document.createElement('div');
    box.setAttribute('data-bmm-no-record', '1');
    Object.assign(box.style, {
        position: 'fixed', zIndex: '2147483646', pointerEvents: 'none', border: '2px solid var(--bmm-danger)',
        background: 'color-mix(in srgb, var(--bmm-danger) 12%, transparent)', borderRadius: '4px', transition: 'all .05s linear', display: 'none',
    });
    document.body.appendChild(box);
    return {
        move(el) {
            if (!el) {
                box.style.display = 'none';
                return;
            }
            const r = el.getBoundingClientRect();
            Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
        },
        done() { box.remove(); },
    };
}
// Click-to-pick an element whose selector is added to the hidden list. Hover highlights the
// target; Esc cancels.
function pickToHide() {
    if (!S)
        return;
    S.picking = true;
    renderBar();
    setStatus(t('rstudio.pick.hint') || 'Hover to highlight, click to hide it from the recording — Esc to cancel');
    const hi = makeHighlighter();
    const ownUI = (el) => !!(el.closest('.rstudio-bar') || el.closest('.rstudio-frame'));
    const finish = () => {
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('keydown', onKey, true);
        hi.done();
        if (cancelPick === finish)
            cancelPick = null;
        if (S)
            S.picking = false;
        renderBar();
    };
    cancelPick?.();
    cancelPick = finish;
    const onMove = (e) => { const el = e.target; hi.move(el && !ownUI(el) ? el : null); };
    const onKey = (e) => { if (e.key === 'Escape') {
        e.preventDefault();
        finish();
    } };
    const onClick = (e) => {
        const el = e.target;
        if (ownUI(el))
            return; // ignore our own UI
        e.preventDefault();
        e.stopPropagation();
        const sel = selectorFor(el);
        finish();
        if (!S)
            return;
        if (sel && !S.hideSelectors.includes(sel))
            S.hideSelectors.push(sel);
        applyHideSelectors();
        renderBar();
    };
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
}
function applyHideSelectors() {
    if (!S)
        return;
    // Only push to the live recorder while a recording is active; otherwise it's applied at start.
    if (S.recording)
        setExtraBlockSelectors(S.hideSelectors);
}
// Toggle whether BOTH studio panels count as recordable. The studios normally carry
// `bmm-no-record` (the recorder blocks them); when the user opts to SHOW them in the rec we strip
// those markers so rrweb captures them as real content, and restore them afterwards so the next
// (telemetry) recording excludes them again.
function markStudioRecordable(recordable) {
    document.querySelectorAll('.rstudio-bar, .rstudio-frame, .anim-panel').forEach((el) => {
        if (recordable) {
            el.classList.remove('bmm-no-record');
            el.removeAttribute('data-bmm-no-record');
        }
        else {
            el.classList.add('bmm-no-record');
            el.setAttribute('data-bmm-no-record', '1');
        }
    });
}
// ── recording lifecycle ──
export async function studioStart() {
    if (!S || S.recording)
        return;
    S.recording = true;
    S.paused = false;
    S.events = [];
    S.regions = [];
    S.pauses = [];
    S.bytes = 0;
    S.warned = false;
    S.autoStopped = false;
    S.startTs = Date.now();
    const l = ((ev) => {
        if (!S || !S.recording || S.paused)
            return;
        S.events.push(ev);
        S.bytes += approxBytes(ev);
        if (S.bytes >= STUDIO_BYTE_BUDGET) {
            // At the ceiling: end the take rather than keep growing. What is already buffered is a
            // complete, playable recording, so nothing is lost — it just stops here.
            S.autoStopped = true;
            void studioStop();
        }
        else if (!S.warned && S.bytes >= STUDIO_BYTE_BUDGET * STUDIO_WARN_AT) {
            S.warned = true;
        }
    });
    l.requiresMasking = !isFullReplay();
    listener = l;
    // Pre-load rrweb so the hide window below is a few ms (no visible flicker of the toolbar),
    // then exclude the studio overlays + any user-chosen selectors from the very first snapshot.
    try {
        await loadRrweb();
    }
    catch { /* ignore */ }
    await setExtraBlockSelectors(S.hideSelectors);
    markStudioRecordable(!!S.showStudios);
    // The reveal is in `finally`: if the recorder fails to start, the studios (and DevTools)
    // must not stay hidden with display:none — that left the UI gone with no way back.
    try {
        if (!S.showStudios)
            hideNoRecord(true);
        await subscribeReplay(listener);
        await takeSnapshot(); // seed the buffer with a self-contained full snapshot
    }
    catch (e) {
        console.warn('[Replay Studio] recorder failed to start', e);
        if (listener) {
            try {
                await unsubscribeReplay(listener);
            }
            catch { /* ignore */ }
            listener = null;
        }
        if (S)
            S.recording = false;
    }
    finally {
        hideNoRecord(false); // reveal — a blocked-element mutation, ignored by the recorder
    }
    if (!S || !S.recording) {
        markStudioRecordable(false);
        renderBar();
        setStatus(t('rstudio.startfail') || 'The recorder could not start.');
        return;
    }
    pushRegion(); // initial frame keyframe
    renderFrame();
    renderBar();
    startMeter();
}
export function studioPause() {
    if (!S || !S.recording || S.paused)
        return;
    S.paused = true;
    S.pauseStart = Date.now();
    renderBar();
}
export async function studioResume() {
    if (!S || !S.recording || !S.paused)
        return;
    S.pauses.push({ start: S.pauseStart, end: Date.now() });
    S.paused = false;
    await takeSnapshot(); // fresh anchor so the post-pause segment stands alone
    pushRegion(); // record the (possibly moved) frame at resume
    renderBar();
}
export async function studioStop() {
    if (!S || !S.recording)
        return;
    S.recording = false;
    S.paused = false;
    stopMeter();
    if (listener) {
        await unsubscribeReplay(listener);
        listener = null;
    }
    await setExtraBlockSelectors([]); // restore the shared recorder (e.g. telemetry) to base blocking
    markStudioRecordable(false); // studios excluded again for any later (telemetry) recording
    renderFrame();
    renderBar(); // switches the bar to the review/export state
    if (S.autoStopped) {
        setStatus(t('rstudio.autostop') || `Stopped at the ${fmtMB(STUDIO_BYTE_BUDGET)} memory budget — the take is complete and playable.`);
    }
}
// Compress paused gaps out of a raw timestamp: subtract every fully-elapsed pause before it.
function compress(ts, pauses) {
    let paused = 0;
    for (const p of pauses) {
        if (p.end <= ts)
            paused += p.end - p.start;
        else if (p.start < ts)
            paused += ts - p.start; // inside a pause (shouldn't happen)
    }
    return ts - paused;
}
// Cuts asked for on the review bar, in COMPRESSED time (what the user sees on the
// timeline), applied on export. Kept out of S.events so the raw take survives and a cut can
// be taken back by rebuilding from it.
let cutRanges = [];
// Build the .bmmreplay (rrweb events + region timeline), honouring an optional END trim and
// any mid-timeline cuts.
function buildBundle(trimEndMs) {
    if (!S || S.events.length < 2)
        return null;
    const first = S.events[0].timestamp;
    let events = S.events
        .map((ev) => ({ ...ev, timestamp: compress(ev.timestamp, S.pauses) }))
        .filter((ev) => trimEndMs == null || ev.timestamp - compress(first, S.pauses) <= trimEndMs);
    // After pause-compression and the end trim, so the ranges mean what the review bar showed.
    // planCuts snaps every cut end forward to the next full snapshot; see replay-cut.ts for
    // why a cut cannot end anywhere else.
    if (cutRanges.length) {
        const base0 = events.length ? events[0].timestamp : 0;
        const abs = cutRanges.map((c) => ({ start: base0 + c.start, end: base0 + c.end }));
        const plan = planCuts(events, abs);
        events = applyCuts(events, plan.cuts);
    }
    const base = compress(first, S.pauses);
    // Region keyframes ride the same timeline as the events, so a cut has to move them too —
    // otherwise the viewport would pan to a frame that belongs to a moment no longer in the
    // file. Keyframes that fall INSIDE a cut are dropped; the one before it still applies.
    let regions = S.regions.map((r) => ({ t: Math.max(0, compress(r.ts, S.pauses) - base), rect: r.rect }));
    if (cutRanges.length) {
        regions = regions
            .filter((r) => !cutRanges.some((c) => r.t >= c.start && r.t < c.end))
            .map((r) => ({ ...r, t: Math.max(0, shiftPastCuts(r.t, cutRanges)) }));
    }
    const durationMs = events.length ? events[events.length - 1].timestamp - events[0].timestamp : 0;
    return JSON.stringify({
        bmmReplay: 1,
        app: 'BetterModsManager',
        createdAt: new Date().toISOString(),
        masked: !isFullReplay(),
        durationMs,
        events,
        regions, // [{ t, rect }] — region-aware players crop to this
        frame: S.preset, // which preset produced the recording
        studio: true,
    });
}
// ── Video ────────────────────────────────────────────────────────────────────────────
//
// Independent of the .bmmreplay recorder: you can run either, or both at once, because they
// capture different things (a mutation log vs. pixels) and neither interferes with the other.
//
// Converting an existing .bmmreplay is the same operation rather than a second code path —
// open it in the viewer, press Record video, let it play. A DOM cannot be photographed from
// inside the page (captureStream is for <canvas> and media elements), and rasterising it
// ourselves would redraw an approximation with the wrong fonts and no shadows, which for a
// tool meant to show what the app really looked like is worse than not offering it.
async function videoStart() {
    try {
        const { ext } = await startCapture({ onStopped: () => renderBar() });
        setStatus((t('rstudio.vstarted') || 'Recording video') + ` (.${ext}) — ` + (t('rstudio.vstophint') || 'press Stop video when done'));
    }
    catch (e) {
        const why = String(e?.message || e);
        setStatus(why === 'cancelled' ? (t('rstudio.vcancel') || 'Screen picker cancelled.')
            : why === 'no-encoder' ? (t('rstudio.vnoenc') || 'This runtime has no video encoder (MediaRecorder).')
                : why === 'no-display-media' ? (t('rstudio.vnodisp') || 'This runtime cannot capture the screen (getDisplayMedia).')
                    : (t('rstudio.vfail') || 'Could not start the video capture.'));
    }
    renderBar();
}
async function videoStop() {
    setStatus(t('rstudio.vsaving') || 'Saving the clip…');
    try {
        const r = await stopCapture();
        if (!r)
            setStatus(t('rstudio.vnone') || 'No video was being recorded.');
        else if (!r.path)
            setStatus(t('rstudio.vempty') || 'The capture produced no frames — nothing saved.');
        else
            setStatus(`${t('rstudio.vsaved') || 'Clip saved'} — ${r.path.split(/[\/]/).pop()} · ${fmtMB(r.bytes)} · ${(r.ms / 1000).toFixed(1)}s`);
    }
    catch {
        setStatus(t('rstudio.vsavefail') || 'Saving the clip failed.');
    }
    renderBar();
}
async function studioExport(trimEndMs) {
    const content = buildBundle(trimEndMs);
    if (!content) {
        setStatus(t('rstudio.empty') || 'Nothing recorded yet.');
        return;
    }
    try {
        const path = await invoke('save_local_replay', { content });
        setStatus((t('rstudio.saved') || 'Saved to Replays') + (path ? ` — ${path.split(/[\\/]/).pop()}` : ''));
    }
    catch {
        setStatus(t('rstudio.savefail') || 'Save failed.');
    }
}
// ── UI: a compact floating control bar ──
function setStatus(msg) {
    const s = bar?.querySelector('.rstudio-status');
    if (s)
        s.textContent = msg;
}
// The meter ticks on its own so the bar is never re-rendered mid-recording — a full
// renderBar() would blow away the focus/caret in the trim input and the hidden-element row.
let meterTimer = null;
function updateMeter() {
    if (!S || !bar)
        return;
    const txt = bar.querySelector('.rstudio-meter-txt');
    const fill = bar.querySelector('.rstudio-gauge > i');
    if (!txt || !fill)
        return;
    const elapsed = S.paused
        ? (S.pauseStart - S.startTs - S.pauses.reduce((a, p) => a + (p.end - p.start), 0))
        : (Date.now() - S.startTs - S.pauses.reduce((a, p) => a + (p.end - p.start), 0));
    const pct = Math.min(100, (S.bytes / STUDIO_BYTE_BUDGET) * 100);
    txt.textContent = `${(Math.max(0, elapsed) / 1000).toFixed(1)}s · ${fmtMB(S.bytes)}`;
    fill.style.width = pct.toFixed(1) + '%';
    const el = bar.querySelector('.rstudio-meter');
    el?.classList.toggle('warn', pct >= STUDIO_WARN_AT * 100);
    if (el)
        el.title = `${fmtMB(S.bytes)} / ${fmtMB(STUDIO_BYTE_BUDGET)} ${t('rstudio.budget') || 'memory budget'}`;
}
function startMeter() {
    stopMeter();
    meterTimer = window.setInterval(updateMeter, 500);
    updateMeter();
}
function stopMeter() {
    if (meterTimer != null) {
        clearInterval(meterTimer);
        meterTimer = null;
    }
}
function renderBar() {
    if (!S || !bar)
        return;
    const rec = S.recording, paused = S.paused;
    const btn = (id, label, cls = '') => `<button class="rstudio-btn ${cls}" data-rs-act="${id}">${label}</button>`;
    const presetSel = `
    <select class="rstudio-sel" data-rs-act="preset" ${rec ? 'disabled' : ''}>
      <option value="fullscreen" ${S.preset === 'fullscreen' ? 'selected' : ''}>${t('rstudio.fullscreen') || 'Fullscreen'}</option>
      <option value="main" ${S.preset === 'main' ? 'selected' : ''}>${t('rstudio.main') || 'Main window (no Tasky bar)'}</option>
      <option value="custom" ${S.preset === 'custom' ? 'selected' : ''}>${t('rstudio.custom') || 'Custom frame'}</option>
    </select>`;
    let controls;
    if (!rec && S.events.length >= 2) {
        // review / export state
        const dur = (S.events[S.events.length - 1].timestamp - S.events[0].timestamp) / 1000;
        // Only an END trim is offered. A start trim would have to drop the opening full snapshot
        // that every later event is a delta against, producing a file that cannot be played — so
        // it is deliberately absent rather than quietly broken.
        const cutList = cutRanges.length
            ? `<span class="rstudio-cuts">${cutRanges.map((c, i) => `<span class="rstudio-cut-chip" data-cut="${i}">${(c.start / 1000).toFixed(1)}–${(c.end / 1000).toFixed(1)}s ×</span>`).join('')}</span>`
            : '';
        controls =
            `<span class="rstudio-status">${t('rstudio.done') || 'Recorded'} ${dur.toFixed(1)}s · ${fmtMB(S.bytes)}</span>` +
                `<label class="rstudio-trim">${t('rstudio.trimend') || 'Keep first'} <input type="number" class="rstudio-trim-in" min="1" step="1" max="${Math.ceil(dur)}" value="${Math.ceil(dur)}"> s</label>` +
                // Cutting from the middle, unlike the end trim above, cannot land wherever it likes:
                // the end of a cut snaps forward to the next full snapshot, and the chip shows where
                // it actually landed rather than what was typed.
                `<label class="rstudio-trim">${t('rstudio.cut') || 'Cut'} ` +
                `<input type="number" class="rstudio-cut-a" min="0" step="0.5" max="${Math.ceil(dur)}" placeholder="${t('rstudio.cutfrom') || 'from'}"> – ` +
                `<input type="number" class="rstudio-cut-b" min="0" step="0.5" max="${Math.ceil(dur)}" placeholder="${t('rstudio.cutto') || 'to'}"> s</label>` +
                btn('cutadd', t('rstudio.cutadd') || 'Add cut') +
                cutList +
                `<span class="rstudio-est"></span>` +
                btn('export', t('rstudio.export') || 'Export .bmmreplay', 'rstudio-primary') +
                btn('reset', t('rstudio.new') || 'New');
    }
    else if (!rec) {
        // Video sits beside the .bmmreplay recorder rather than replacing it: they answer
        // different needs — a .bmmreplay is inspectable and tiny, an mp4 is what you paste
        // into a message. The label names the container this runtime will ACTUALLY produce,
        // so "record mp4" never turns into a webm at save time.
        const vid = captureSupport();
        const vidBtn = isCapturing()
            ? btn('vstop', '■ ' + (t('rstudio.vstop') || 'Stop video'), 'rstudio-primary')
            : vid.ok
                ? btn('vstart', '● ' + (t('rstudio.vrec') || 'Record video') + ` (.${vid.ext})`)
                : `<span class="rstudio-hide-none" data-tooltip="${vid.reason === 'no-encoder'
                    ? (t('rstudio.vnoenc') || 'This runtime has no video encoder (MediaRecorder).')
                    : (t('rstudio.vnodisp') || 'This runtime cannot capture the screen (getDisplayMedia).')}">${t('rstudio.vunavail') || 'video n/a'}</span>`;
        controls = presetSel + btn('start', '● ' + (t('rstudio.rec') || 'Record'), 'rstudio-primary') + vidBtn + `<span class="rstudio-status"></span>`;
    }
    else {
        // A live meter (elapsed + buffered size + how much of the memory budget is used) so a long
        // take never grows invisibly — this used to be a bare "Recording…" with no way to tell.
        controls =
            `<span class="rstudio-dot ${paused ? 'paused' : ''}"></span>` +
                (paused ? btn('resume', t('rstudio.resume') || 'Resume') : btn('pause', t('rstudio.pause') || 'Pause')) +
                btn('stop', '■ ' + (t('rstudio.stop') || 'Stop'), 'rstudio-primary') +
                `<span class="rstudio-meter"><span class="rstudio-meter-txt"></span><span class="rstudio-gauge"><i></i></span></span>` +
                `<span class="rstudio-status">${paused ? (t('rstudio.paused') || 'Paused — move the frame') : (t('rstudio.recording') || 'Recording…')}</span>`;
    }
    // "Hidden elements" row — pick app elements to exclude from the recording (the studios
    // themselves are always excluded). Available before AND during a recording; not shown in the
    // review/export state.
    const showHide = rec || S.events.length < 2;
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const chips = S.hideSelectors.map((s) => `<span class="rstudio-chip" data-tooltip="${esc(s)}">${esc(s)}<button data-rs-act="unhide" data-sel="${esc(s)}" aria-label="remove">✕</button></span>`).join('');
    const studioToggle = `<label class="rstudio-showstudios" data-tooltip="${t('rstudio.showstudios.tip') || 'Include the Replay/Animation Studio panels in the recording'}"><input type="checkbox" data-rs-act="showstudios" ${S.showStudios ? 'checked' : ''} ${rec ? 'disabled' : ''}> ${t('rstudio.showstudios') || 'Show studios in rec'}</label>`;
    const hideRow = showHide
        ? `<div class="rstudio-hide"><span class="rstudio-hide-lbl">${t('rstudio.hidden') || 'Hidden'}:</span>${chips || `<span class="rstudio-hide-none">${t('rstudio.hidden.none') || 'nothing'}</span>`}<button class="rstudio-btn rstudio-mini ${S.picking ? 'rstudio-primary' : ''}" data-rs-act="pick-hide">${S.picking ? (t('rstudio.pick.active') || 'Click one…') : '＋ ' + (t('rstudio.pick') || 'Hide element')}</button>${studioToggle}</div>`
        : '';
    bar.innerHTML = `<div class="rstudio-main"><div class="rstudio-title">${t('rstudio.title') || 'Replay Studio'}</div>${controls}<button class="rstudio-btn rstudio-min" data-rs-act="min" data-tooltip="${esc(t('rstudio.minimize') || 'Minimise — recording continues')}" aria-label="${esc(t('rstudio.minimize') || 'Minimise')}"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M5 12h14"/></svg></button><button class="rstudio-btn rstudio-x" data-rs-act="close" aria-label="${esc(t('common.close') || 'Close')}"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div>${hideRow}`;
    if (!bar.dataset.miniWired) {
        bar.dataset.miniWired = '1';
        bar.addEventListener('click', (e) => {
            if (!minimized)
                return;
            // The buttons inside the pill still do their own job; only a click on the pill
            // ITSELF restores. Otherwise stopping the recording from the collapsed state
            // would also expand it, which is the opposite of what you asked for.
            if (e.target.closest('[data-rs-act]'))
                return;
            minimized = false;
            renderBar();
        });
    }
    bar.classList.toggle('rstudio-mini', minimized);
    bar.classList.toggle('rstudio-live', !!rec && !paused);
    const trimIn = bar.querySelector('.rstudio-trim-in');
    if (trimIn) {
        trimIn.addEventListener('input', updateEstimate);
        updateEstimate();
    }
    if (rec)
        updateMeter();
}
/** How many events (and roughly how many bytes) survive the current end-trim. */
function updateEstimate() {
    if (!S || !bar)
        return;
    const out = bar.querySelector('.rstudio-est');
    const inp = bar.querySelector('.rstudio-trim-in');
    if (!out || !inp || S.events.length < 2)
        return;
    const keep = parseFloat(inp.value);
    const first = S.events[0].timestamp;
    let n = 0, bytes = 0;
    for (const ev of S.events) {
        if (Number.isFinite(keep) && (ev.timestamp - first) / 1000 > keep)
            break;
        n++;
        bytes += approxBytes(ev);
    }
    out.textContent = `≈ ${fmtMB(bytes)} · ${n} ${t('rstudio.events') || 'events'}`;
}
function onBarClick(e) {
    // A cut chip removes itself. Handled before the [data-rs-act] lookup because a chip is not a
    // button — making it one would have put it in the toolbar's tab order between the fields
    // it sits next to.
    const chip = e.target.closest('[data-cut]');
    if (chip && S) {
        e.stopPropagation();
        const i = Number(chip.getAttribute('data-cut'));
        if (Number.isInteger(i)) {
            cutRanges.splice(i, 1);
            renderBar();
        }
        return;
    }
    const el = e.target.closest('[data-rs-act]');
    if (!el || !S)
        return;
    // Keep the click on the toolbar — never let it bubble to the app underneath.
    e.stopPropagation();
    const act = el.getAttribute('data-rs-act');
    switch (act) {
        case 'start':
            studioStart();
            break;
        case 'pause':
            studioPause();
            break;
        case 'resume':
            studioResume();
            break;
        case 'stop':
            studioStop();
            break;
        case 'export': {
            const inp = bar?.querySelector('.rstudio-trim-in');
            const keep = inp ? parseFloat(inp.value) : NaN;
            studioExport(Number.isFinite(keep) ? keep * 1000 : undefined);
            break;
        }
        case 'cutadd': {
            const a = bar?.querySelector('.rstudio-cut-a');
            const b = bar?.querySelector('.rstudio-cut-b');
            const from = a ? parseFloat(a.value) : NaN;
            const to = b ? parseFloat(b.value) : NaN;
            if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
                setStatus(t('rstudio.cutbad') || 'Give a start and an end, with the end after the start.');
                break;
            }
            // Planned against the real events so the chip shows where the cut ACTUALLY lands —
            // its end snaps forward to the next full snapshot, and a cut with no snapshot after
            // it is refused rather than silently swallowing the rest of the take.
            const compressed = S.events.map((ev) => ({ ...ev, timestamp: compress(ev.timestamp, S.pauses) }));
            const base0 = compressed.length ? compressed[0].timestamp : 0;
            const plan = planCuts(compressed, [{ start: base0 + from * 1000, end: base0 + to * 1000 }]);
            if (!plan.cuts.length) {
                setStatus(t('rstudio.cutnoanchor') || 'Nothing to resume on after that point — a cut has to end where the recording was paused and resumed.');
                break;
            }
            const c = plan.cuts[0];
            cutRanges.push({ start: c.start - base0, end: c.end - base0 });
            if (plan.snapped.length) {
                setStatus((t('rstudio.cutsnapped') || 'Cut ends at {s}s — the next point the recording can resume from.')
                    .replace('{s}', ((c.end - base0) / 1000).toFixed(1)));
            }
            if (a)
                a.value = '';
            if (b)
                b.value = '';
            renderBar();
            break;
        }
        case 'reset':
            S.events = [];
            S.regions = [];
            S.pauses = [];
            S.bytes = 0;
            S.warned = false;
            S.autoStopped = false;
            cutRanges = [];
            renderBar();
            break;
        case 'pick-hide':
            pickToHide();
            break;
        case 'unhide': {
            const sel = el.getAttribute('data-sel');
            if (sel) {
                S.hideSelectors = S.hideSelectors.filter((x) => x !== sel);
                applyHideSelectors();
                renderBar();
            }
            break;
        }
        case 'vstart':
            void videoStart();
            break;
        case 'vstop':
            void videoStop();
            break;
        // Minimise never stops the capture — that is the whole point of asking for it.
        // Clicking the collapsed pill expands it again; the pill itself is the target, so
        // there is no separate restore control to find.
        case 'min':
            minimized = !minimized;
            renderBar();
            break;
        case 'close':
            closeReplayStudio();
            break;
    }
}
function onBarChange(e) {
    const el = e.target;
    if (!S)
        return;
    const act = el.getAttribute('data-rs-act');
    if (act === 'preset') {
        S.preset = el.value;
        S.frame = presetRect(S.preset);
        renderFrame();
    }
    else if (act === 'showstudios') {
        // Only changeable before recording (the checkbox is disabled while recording).
        S.showStudios = el.checked;
    }
}
// Styles injected once, on first open, so they cost nothing at boot. Colours are the app's
// theme tokens: the bar follows light and dark themes like the rest of BMM, on an opaque
// elevated surface so it stays readable over whatever it floats on.
function ensureStyles() {
    if (document.getElementById('rstudio-styles'))
        return;
    const s = document.createElement('style');
    s.id = 'rstudio-styles';
    s.textContent = `
  .rstudio-bar{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147483647;
    isolation:isolate;pointer-events:auto;
    display:flex;flex-direction:column;gap:8px;padding:8px 10px;border-radius:14px;
    background:var(--bmm-bg-elevated);color:var(--bmm-text-primary);border:1px solid var(--bmm-border-hover);
    box-shadow:var(--bmm-shadow-modal);
    font:600 13px/1.2 var(--bmm-font-sans,system-ui),sans-serif;
    /* max-content, then capped. A fixed, shrink-to-fit flex container that is allowed to WRAP
       computes a narrow preferred width and wraps early. Asking for max-content makes it take
       the room it is allowed before wrapping at all. */
    width:max-content;max-width:min(94%,980px);}
  /* Wraps to a second row instead of crushing its children. */
  .rstudio-main{display:flex;align-items:center;flex-wrap:wrap;gap:8px;row-gap:8px;}
  .rstudio-hide{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-top:7px;border-top:1px solid var(--bmm-border-hover);}
  .rstudio-hide-lbl{font-weight:700;color:var(--bmm-text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em;}
  .rstudio-hide-none{color:var(--bmm-text-muted);font-weight:500;font-size:12px;}
  .rstudio-showstudios{display:inline-flex;align-items:center;gap:6px;margin-left:auto;font-size:11.5px;font-weight:600;color:var(--bmm-text-secondary);cursor:pointer;white-space:nowrap;}
  .rstudio-showstudios input{cursor:pointer;accent-color:var(--bmm-accent);}
  .rstudio-chip{display:inline-flex;align-items:center;gap:5px;background:var(--bmm-bg-base);border:1px solid var(--bmm-border-hover);border-radius:999px;
    padding:2px 4px 2px 9px;font:600 11px/1.4 var(--bmm-font-mono,ui-monospace),monospace;max-width:200px;}
  .rstudio-chip>span,.rstudio-chip{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .rstudio-chip button{border:0;background:var(--bmm-s10);color:var(--bmm-text-primary);border-radius:50%;width:15px;height:15px;line-height:1;cursor:pointer;font-size:10px;flex-shrink:0;}
  .rstudio-chip button:hover{background:var(--bmm-danger);color:var(--bmm-text-on-accent);}
  .rstudio-mini{padding:4px 8px;font-size:12px;}
  .rstudio-title{font-weight:800;margin-right:2px;color:var(--bmm-accent);display:flex;align-items:center;gap:6px;}
  .rstudio-btn{border:1px solid var(--bmm-border-hover);background:var(--bmm-bg-base);color:var(--bmm-text-primary);border-radius:9px;
    padding:6px 10px;cursor:pointer;font:inherit;white-space:nowrap;flex:0 0 auto;
    transition:background .12s,border-color .12s;}
  .rstudio-btn:focus-visible,.rstudio-sel:focus-visible{outline:2px solid var(--bmm-accent);outline-offset:2px;}
  /* Minimise + close ride to the right end of whatever row they land on. */
  .rstudio-min{margin-left:auto;}
  .rstudio-btn:hover{background:var(--bmm-bg-hover);border-color:var(--bmm-accent);}
  .rstudio-primary{background:var(--bmm-accent);border-color:var(--bmm-accent);color:var(--bmm-text-on-accent);}
  .rstudio-primary:hover{background:var(--bmm-accent);filter:brightness(1.1);}
  .rstudio-x{padding:6px 9px;color:var(--bmm-text-secondary);}
  .rstudio-x:hover{border-color:var(--bmm-danger);color:var(--bmm-danger);}
  .rstudio-sel{background:var(--bmm-bg-base);color:var(--bmm-text-primary);border:1px solid var(--bmm-border-hover);border-radius:9px;padding:6px 8px;font:inherit;}
  .rstudio-status{color:var(--bmm-text-secondary);font-weight:500;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:0 1 auto;min-width:0;}
  .rstudio-trim{display:flex;align-items:center;gap:6px;font-weight:500;color:var(--bmm-text-secondary);white-space:nowrap;flex:0 0 auto;}
  /* The cut fields are styled WITH the trim field, so the next field cannot be forgotten. */
  .rstudio-trim-in,.rstudio-cut-a,.rstudio-cut-b{width:56px;background:var(--bmm-bg-base);color:var(--bmm-text-primary);
    border:1px solid var(--bmm-border-hover);border-radius:7px;padding:4px 6px;font:inherit;flex:0 0 auto;}
  .rstudio-trim-in:focus,.rstudio-cut-a:focus,.rstudio-cut-b:focus{outline:none;border-color:var(--bmm-accent);}
  .rstudio-cut-a::placeholder,.rstudio-cut-b::placeholder{color:var(--bmm-text-muted);font-weight:500;}
  .rstudio-cuts{display:flex;align-items:center;gap:5px;flex-wrap:wrap;}
  .rstudio-cut-chip{display:inline-flex;align-items:center;gap:4px;background:var(--bmm-bg-base);
    border:1px solid var(--bmm-border-hover);border-radius:999px;padding:3px 9px;cursor:pointer;
    font:600 11px/1.4 var(--bmm-font-mono,ui-monospace),monospace;white-space:nowrap;}
  .rstudio-cut-chip:hover{border-color:var(--bmm-danger);color:var(--bmm-danger);}
  .rstudio-est{color:var(--bmm-text-muted);font-size:11.5px;font-variant-numeric:tabular-nums;white-space:nowrap;}
  /* Live meter: elapsed + buffered size, with a gauge against the memory budget. */
  .rstudio-meter{display:flex;align-items:center;gap:7px;font-variant-numeric:tabular-nums;}
  .rstudio-meter-txt{font-size:11.5px;color:var(--bmm-text-secondary);white-space:nowrap;min-width:96px;}
  .rstudio-gauge{width:54px;height:5px;border-radius:999px;background:var(--bmm-s10);overflow:hidden;}
  .rstudio-gauge > i{display:block;height:100%;width:0;border-radius:999px;background:var(--bmm-accent);transition:width .3s linear;}
  .rstudio-meter.warn .rstudio-gauge > i{background:var(--bmm-warning);}
  .rstudio-meter.warn .rstudio-meter-txt{color:var(--bmm-warning);}
  .rstudio-dot{width:10px;height:10px;border-radius:50%;background:var(--bmm-danger);animation:rstudio-pulse 1.4s infinite;}
  .rstudio-dot.paused{background:var(--bmm-warning);animation:none;}
  @keyframes rstudio-pulse{0%{opacity:1}50%{opacity:.35}100%{opacity:1}}
  @media (prefers-reduced-motion: reduce){.rstudio-dot{animation:none;}}
  .rstudio-frame{position:fixed;z-index:2147482000;border:2px solid var(--bmm-accent);border-radius:8px;
    box-shadow:0 0 0 100vmax var(--bmm-bg-overlay);pointer-events:none;}
  .rstudio-frame-locked{box-shadow:0 0 0 2px var(--bmm-accent-dim);}
  .rstudio-frame-handle{position:absolute;right:-7px;bottom:-7px;width:14px;height:14px;border-radius:50%;
    background:var(--bmm-accent);border:2px solid var(--bmm-text-on-accent);cursor:nwse-resize;}
  `;
    document.head.appendChild(s);
}
/** Open the Replay Studio control bar (called from the DevTools menu). Idempotent. */
export function openReplayStudio() {
    ensureStyles();
    if (bar && bar.isConnected) {
        bar.style.display = 'flex';
        bar.querySelector('.rstudio-btn')?.focus();
        return;
    }
    studioAC?.abort();
    studioAC = new AbortController();
    S = { recording: false, paused: false, events: [], bytes: 0, warned: false, autoStopped: false, regions: [], pauses: [], startTs: 0, pauseStart: 0, preset: 'fullscreen', frame: presetRect('fullscreen'), hideSelectors: [], picking: false, showStudios: false };
    cutRanges = [];
    minimized = false;
    bar = document.createElement('div');
    bar.className = 'rstudio-bar bmm-no-record';
    bar.setAttribute('data-bmm-no-record', '1');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', t('rstudio.title') || 'Replay Studio');
    bar.addEventListener('click', onBarClick);
    bar.addEventListener('change', onBarChange);
    // Esc inside the bar closes it, like every other panel. Not while a recording runs: one
    // stray keypress must not end a take.
    bar.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !(S?.recording)) {
            e.preventDefault();
            e.stopPropagation();
            closeReplayStudio();
        }
    });
    uiHost().appendChild(bar);
    renderBar();
    document.dispatchEvent(new CustomEvent('bmm-debug-studio'));
}
export function isReplayStudioOpen() {
    return !!(bar && bar.isConnected);
}
/** Close the studio and undo everything it changed. Idempotent, and every step runs even if
 *  an earlier one throws — a half-finished close is how a studio leaves the app altered. */
export function closeReplayStudio() {
    const steps = [
        () => { cancelPick?.(); cancelPick = null; },
        () => stopMeter(),
        () => {
            if (listener) {
                const l = listener;
                listener = null;
                if (S)
                    S.recording = false;
                void Promise.resolve(unsubscribeReplay(l)).catch(() => { });
            }
        },
        // A video capture still running when the studio closes is stopped and SAVED, not dropped.
        () => { if (isCapturing())
            void stopCapture().catch(() => { }); },
        // Never leave studio-only block rules on the shared recorder.
        () => { void Promise.resolve(setExtraBlockSelectors([])).catch(() => { }); },
        () => markStudioRecordable(false),
        () => hideNoRecord(false),
        () => removeFrame(),
        () => { studioAC?.abort(); studioAC = null; },
        () => { bar?.remove(); },
    ];
    for (const step of steps) {
        try {
            step();
        }
        catch (e) {
            console.warn('[Replay Studio] close step failed', e);
        }
    }
    bar = null;
    S = null;
    cutRanges = [];
    minimized = false;
    document.dispatchEvent(new CustomEvent('bmm-debug-studio'));
}
//# sourceMappingURL=replay-studio.js.map