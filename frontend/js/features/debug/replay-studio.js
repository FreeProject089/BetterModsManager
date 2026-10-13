// Replay Studio — a DevTools recorder that turns a live BMM session into a .bmmreplay
// (rrweb) file, with a movable capture FRAME, pause/resume, and a post-record editor.
//
// How it relates to the existing recorder: it reuses the shared rrweb engine via
// `subscribeReplay` (same masking/blocking/image-inlining as telemetry), forcing a fresh
// FULL snapshot at start and after every resume so each segment is self-contained. The
// frame is realised at PLAYBACK: we record the whole DOM (rrweb can't crop to a visual
// region) and store a `regions` timeline; a region-aware player crops the viewport to the
// active frame. Existing players ignore `regions` and simply show the full frame — so the
// file stays backward-compatible.
//
// THE EDITOR (after Stop). A timeline of the take with: scrub (click/drag the playhead),
// range selection (drag), cuts of any range, start and end trim (handles), markers, the
// capture-frame keyframes and the full-snapshot anchors, undo/redo, and an optional live
// preview (an rrweb Replayer over the EDITED stream, seeked as you scrub). The edit math is
// in replay-edit-model.ts; how a cut stays playable is explained at the top of that file.
//
// FILE FORMAT. Unchanged envelope `{ bmmReplay:1, app, durationMs, events, regions, frame,
// studio:true }`. Optional additions, ignored by players that do not know them: `title`,
// `markers: [{ t, label }]` (ms from start) and `edit: { trimStart, trimEnd, cuts }`
// (provenance only — the events are already edited). No compression: none of the three
// players can open a gzip file, so the export stays plain compact JSON.
//
// NOTE: the rrweb runtime behaviours here (forced `takeFullSnapshot`, multi-segment
// playback, pause-gap compression, region crop, the preview Replayer) follow rrweb's
// documented APIs but need a live-app pass to confirm end-to-end — they can't be exercised
// without the running webview.
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { loadRrweb, subscribeReplay, unsubscribeReplay, isFullReplay, setExtraBlockSelectors } from '../../core/replay-recorder.js';
import { captureSupport, startCapture, stopCapture, isCapturing } from './video-capture.js';
import { uiIcon } from '../../ui/icons.js';
import { emptyEdit, isEditEmpty, normalizeCuts, keepUntil, mapTime, unmapTime, editedDuration, editEvents, planEdit, editRegions, editMarkers, anchorsOf, playabilityProblem, fmtBytes, fmtClock, embedSnippets, MIN_CUT_MS, } from './replay-edit-model.js';
import { uniqueSelector } from './anim-timeline-model.js';
// A studio recording buffers every event in memory until you export, so it needs a hard
// ceiling — the shared telemetry watcher has one, and this path used to have none at all
// (an afk recording grew until Tauri ran out of memory). Trimming the HEAD is not an option
// while recording: the buffer opens with the full snapshot every later event is a delta
// against. We therefore STOP at the cap and say so, which keeps the recording valid and the
// choice with the user.
const STUDIO_BYTE_BUDGET = 64 * 1024 * 1024;
const STUDIO_WARN_AT = 0.75;
function jsonLen(ev) {
    try {
        return JSON.stringify(ev).length;
    }
    catch {
        return 2048;
    }
}
function fmtMB(bytes) { return (bytes / (1024 * 1024)).toFixed(1) + ' MB'; }
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let S = null;
let R = null;
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
// Drag to move + a bottom-right handle to resize (custom preset only). The frame is kept
// inside the window: it used to be draggable off the right/bottom edge, recording a region
// the player then cropped to empty space.
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
        const W = window.innerWidth, H = window.innerHeight;
        if (mode === 'move') {
            S.frame = { ...or, x: Math.min(Math.max(0, or.x + dx), Math.max(0, W - or.w)), y: Math.min(Math.max(0, or.y + dy), Math.max(0, H - or.h)) };
        }
        else {
            S.frame = { ...or, w: Math.min(Math.max(120, or.w + dx), W - or.x), h: Math.min(Math.max(90, or.h + dy), H - or.y) };
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
// A selector that matches the picked element ALONE when the page allows it. The old
// "tag + first two classes" form hid every element sharing those classes (pick one mod card,
// lose the whole list) — see uniqueSelector for the order of attempts.
function selectorFor(el) {
    return uniqueSelector(el, (s) => document.querySelectorAll(s).length);
}
// A hover-highlight box so the user sees what they're about to hide while picking.
function makeHighlighter() {
    const box = document.createElement('div');
    box.setAttribute('data-bmm-no-record', '1');
    Object.assign(box.style, {
        position: 'fixed', zIndex: '2147483646', pointerEvents: 'none', border: '2px solid var(--bmm-danger)',
        background: 'color-mix(in srgb, var(--bmm-danger) 12%, transparent)', borderRadius: '4px', display: 'none',
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
// target; Esc cancels (and only cancels: it no longer also reaches the bar and closes it).
function pickToHide() {
    if (!S)
        return;
    S.picking = true;
    renderBar();
    setStatus(t('rstudio.pick.hint') || 'Hover to highlight, click to hide it. Esc to cancel.');
    const hi = makeHighlighter();
    const ownUI = (el) => !!(el.closest('.rstudio-bar') || el.closest('.rstudio-frame') || el.closest('.anim-panel'));
    const pickable = (el) => !!el && el !== document.documentElement && el !== document.body && !ownUI(el);
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
    const onMove = (e) => { const el = e.target; hi.move(pickable(el) ? el : null); };
    const onKey = (e) => { if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish();
    } };
    const onClick = (e) => {
        const el = e.target;
        if (!pickable(el))
            return; // our own UI, or the document roots
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
    leaveReview();
    S.recording = true;
    S.paused = false;
    S.events = [];
    S.sizes = [];
    S.regions = [];
    S.pauses = [];
    S.bytes = 0;
    S.warned = false;
    S.autoStopped = false;
    S.startTs = Date.now();
    const l = ((ev) => {
        if (!S || !S.recording || S.paused)
            return;
        const n = jsonLen(ev);
        S.events.push(ev);
        S.sizes.push(n);
        S.bytes += n * 2;
        if (S.bytes >= STUDIO_BYTE_BUDGET) {
            // At the ceiling: end the take rather than keep growing. What is already buffered is a
            // complete, playable recording, so nothing is lost — it just stops here.
            S.autoStopped = true;
            void studioStop();
        }
        else if (!S.warned && S.bytes >= STUDIO_BYTE_BUDGET * STUDIO_WARN_AT) {
            S.warned = true;
            setStatus(t('rstudio.warn') || 'Memory budget at 75%. The take stops by itself at the limit.');
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
    // Stopping while paused closes the open pause, so its gap is compressed like the others.
    if (S.paused)
        S.pauses.push({ start: S.pauseStart, end: Date.now() });
    S.recording = false;
    S.paused = false;
    stopMeter();
    if (listener) {
        await unsubscribeReplay(listener);
        listener = null;
    }
    await setExtraBlockSelectors([]); // restore the shared recorder (e.g. telemetry) to base blocking
    markStudioRecordable(false); // studios excluded again for any later (telemetry) recording
    removeFrame(); // the dimmed frame has no job in the editor
    enterReview();
    renderBar(); // switches the bar to the editor
    if (S.autoStopped) {
        setStatus(t('rstudio.autostop') || `Stopped at the ${fmtMB(STUDIO_BYTE_BUDGET)} memory budget. The take is complete and playable.`);
    }
    else if (!R) {
        setStatus(t('rstudio.empty') || 'Nothing recorded yet.');
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
// ── the editor ───────────────────────────────────────────────────────────────────────
function enterReview() {
    R = null;
    if (!S || S.events.length < 2)
        return;
    const events = S.events.map((ev) => ({ ...ev, timestamp: compress(ev.timestamp, S.pauses) }));
    const base = events[0].timestamp;
    const dur = Math.max(1, events[events.length - 1].timestamp - base);
    const regions = S.regions.map((r) => ({ t: Math.max(0, compress(r.ts, S.pauses) - base), rect: r.rect }));
    R = {
        events, sizes: S.sizes.slice(), bytes: S.bytes, dur, regions, anchors: anchorsOf(events),
        edit: emptyEdit(), markers: [], playhead: 0, sel: null, undo: [], redo: [],
        title: '', dropMoves: false, previewOn: false, savedPath: null, dirty: true, busy: false,
    };
    // The raw buffer is not needed any more; the editor works from its compressed copies.
    S.events = [];
    S.sizes = [];
}
function leaveReview() {
    destroyPreview();
    R = null;
    disarm();
}
const snapshotEdit = () => JSON.stringify({ edit: R.edit, markers: R.markers });
function restoreEdit(s) {
    if (!R)
        return;
    const o = JSON.parse(s);
    R.edit = o.edit;
    R.markers = o.markers;
}
/** Every edit goes through here: one undo step, the redo stack cleared, views refreshed. */
function commit(mutate) {
    if (!R)
        return;
    const before = snapshotEdit();
    mutate();
    if (snapshotEdit() === before)
        return;
    R.undo.push(before);
    if (R.undo.length > 100)
        R.undo.shift();
    R.redo = [];
    editChanged();
}
function editChanged() {
    if (!R)
        return;
    R.dirty = true;
    renderTimeline();
    renderLists();
    updateSummary();
    updateToolState();
    schedulePreview();
}
function undo() {
    if (!R || !R.undo.length)
        return;
    R.redo.push(snapshotEdit());
    restoreEdit(R.undo.pop());
    editChanged();
}
function redo() {
    if (!R || !R.redo.length)
        return;
    R.undo.push(snapshotEdit());
    restoreEdit(R.redo.pop());
    editChanged();
}
function setTrimStart(ms) {
    commit(() => {
        const until = keepUntil(R.edit, R.dur);
        R.edit.trimStart = Math.max(0, Math.min(Math.round(ms), until - MIN_CUT_MS));
    });
}
function setTrimEnd(ms) {
    commit(() => {
        const v = Math.max(R.edit.trimStart + MIN_CUT_MS, Math.min(Math.round(ms), R.dur));
        R.edit.trimEnd = v >= R.dur ? null : v;
    });
}
function cutSelection() {
    if (!R)
        return;
    if (!R.sel || R.sel.b - R.sel.a < MIN_CUT_MS) {
        setStatus(t('rstudio.cutsel.none') || 'Select a range on the timeline first.');
        return;
    }
    const { a, b } = R.sel;
    commit(() => { R.edit.cuts = normalizeCuts([...R.edit.cuts, { start: a, end: b }], R.dur); });
    R.sel = null;
    setPlayhead(a);
    renderTimeline();
    updateToolState();
}
function addMarker() {
    if (!R)
        return;
    const at = Math.round(R.playhead);
    commit(() => {
        R.markers = [...R.markers.filter((m) => Math.abs(m.t - at) > 1),
            { t: at, label: `${t('rstudio.marker') || 'Marker'} ${R.markers.length + 1}` }].sort((x, y) => x.t - y.t);
    });
}
// ── timeline view ──
const pct = (ms) => (R ? Math.max(0, Math.min(100, (ms / R.dur) * 100)) : 0).toFixed(3) + '%';
function renderTimeline() {
    if (!R || !bar)
        return;
    const track = bar.querySelector('.rstudio-tl-track');
    if (!track)
        return;
    const e = R.edit;
    const until = keepUntil(e, R.dur);
    const parts = [];
    if (e.trimStart > 0)
        parts.push(`<div class="rstudio-tl-trim" style="left:0;width:${pct(e.trimStart)}"></div>`);
    if (e.trimEnd != null)
        parts.push(`<div class="rstudio-tl-trim" style="left:${pct(e.trimEnd)};right:0"></div>`);
    for (const c of normalizeCuts(e.cuts, R.dur)) {
        parts.push(`<div class="rstudio-tl-cut" style="left:${pct(c.start)};width:calc(${pct(c.end)} - ${pct(c.start)})" data-tooltip="${esc((t('rstudio.cut') || 'Cut') + ' ' + fmtClock(c.start) + ' – ' + fmtClock(c.end))}"></div>`);
    }
    if (R.sel)
        parts.push(`<div class="rstudio-tl-sel" style="left:${pct(R.sel.a)};width:calc(${pct(R.sel.b)} - ${pct(R.sel.a)})"></div>`);
    for (const a of R.anchors)
        parts.push(`<i class="rstudio-tl-anchor" style="left:${pct(a)}"></i>`);
    for (const r of R.regions) {
        parts.push(`<i class="rstudio-tl-region" style="left:${pct(r.t)}" data-tooltip="${esc((t('rstudio.tl.frame') || 'Frame') + ` ${Math.round(r.rect.w)}×${Math.round(r.rect.h)} · ${fmtClock(r.t)}`)}"></i>`);
    }
    for (const m of R.markers)
        parts.push(`<i class="rstudio-tl-marker" style="left:${pct(m.t)}" data-tooltip="${esc(m.label + ' · ' + fmtClock(m.t))}"></i>`);
    parts.push(`<span class="rstudio-tl-h" data-h="start" style="left:${pct(e.trimStart)}" data-tooltip="${esc(t('rstudio.setstart') || 'Start')}"></span>`);
    parts.push(`<span class="rstudio-tl-h rstudio-tl-h-end" data-h="end" style="left:${pct(until)}" data-tooltip="${esc(t('rstudio.setend') || 'End')}"></span>`);
    parts.push(`<i class="rstudio-tl-head"></i>`);
    track.innerHTML = parts.join('');
    updatePlayhead();
}
function updatePlayhead() {
    if (!R || !bar)
        return;
    const head = bar.querySelector('.rstudio-tl-head');
    if (head)
        head.style.left = pct(R.playhead);
    const tl = bar.querySelector('.rstudio-tl');
    if (tl) {
        tl.setAttribute('aria-valuenow', String(Math.round(R.playhead)));
        tl.setAttribute('aria-valuetext', fmtClock(R.playhead));
    }
    const ro = bar.querySelector('.rstudio-tl-time');
    if (ro) {
        const m = mapTime(R.playhead, R.edit, R.dur);
        ro.textContent = `${fmtClock(R.playhead)} / ${fmtClock(R.dur)}` + (isEditEmpty(R.edit) ? '' : `  ·  ${m == null ? '–' : fmtClock(m)} / ${fmtClock(editedDuration(R.edit, R.dur))}`);
    }
}
function setPlayhead(ms) {
    if (!R)
        return;
    R.playhead = Math.max(0, Math.min(R.dur, ms));
    updatePlayhead();
    previewSeek();
}
function renderLists() {
    if (!R || !bar)
        return;
    const box = bar.querySelector('.rstudio-lists');
    if (!box)
        return;
    const cuts = normalizeCuts(R.edit.cuts, R.dur);
    const cutChips = cuts.map((c, i) => `<span class="rstudio-chip rstudio-chip-cut"><span>${fmtClock(c.start)}–${fmtClock(c.end)}</span><button type="button" data-rs-act="uncut" data-i="${i}" aria-label="${esc(t('rstudio.removecut') || 'Remove cut')}">${uiIcon('close', 12)}</button></span>`).join('');
    const mkChips = R.markers.map((m, i) => `<span class="rstudio-chip rstudio-chip-mk"><button type="button" class="rstudio-mk-go" data-rs-act="mkgo" data-i="${i}">${fmtClock(m.t)}</button><input class="rstudio-mk-in" data-mk="${i}" value="${esc(m.label)}" maxlength="80" aria-label="${esc(t('rstudio.marker') || 'Marker')}"><button type="button" data-rs-act="unmark" data-i="${i}" aria-label="${esc(t('rstudio.removemarker') || 'Remove marker')}">${uiIcon('close', 12)}</button></span>`).join('');
    box.innerHTML =
        (cutChips ? `<span class="rstudio-hide-lbl">${esc(t('rstudio.cuts') || 'Cuts')}</span>${cutChips}` : '') +
            (mkChips ? `<span class="rstudio-hide-lbl">${esc(t('rstudio.markers') || 'Markers')}</span>${mkChips}` : '');
    box.hidden = !cutChips && !mkChips;
}
function updateSummary() {
    if (!R || !bar)
        return;
    const el = bar.querySelector('.rstudio-sum');
    if (!el)
        return;
    // Sized from per-event lengths captured while recording: no JSON is built per edit.
    const plan = planEdit(R.events, R.edit, { dropPointerMoves: R.dropMoves });
    let bytes = 256;
    for (const p of plan)
        bytes += (R.sizes[p.index] || 64) + 1;
    const ed = editedDuration(R.edit, R.dur);
    el.textContent = `${t('rstudio.done') || 'Recorded'} ${fmtClock(R.dur)}` +
        (isEditEmpty(R.edit) ? '' : ` → ${fmtClock(ed)}`) +
        ` · ≈ ${fmtBytes(bytes)} · ${plan.length} ${t('rstudio.events') || 'events'}`;
}
function updateToolState() {
    if (!R || !bar)
        return;
    const set = (act, on) => { const b = bar.querySelector(`[data-rs-act="${act}"]`); if (b)
        b.disabled = !on; };
    set('undo', R.undo.length > 0);
    set('redo', R.redo.length > 0);
    set('cutsel', !!R.sel && R.sel.b - R.sel.a >= MIN_CUT_MS);
    set('clearedits', !isEditEmpty(R.edit) || R.markers.length > 0);
    set('export', !R.busy);
}
/** Wire the timeline element after a render. Listeners live on the element itself, so the
 *  next render (which replaces it) drops them with it — nothing accumulates on window. */
function wireTimeline() {
    if (!R || !bar)
        return;
    const tl = bar.querySelector('.rstudio-tl');
    const track = bar.querySelector('.rstudio-tl-track');
    if (!tl || !track)
        return;
    const tAt = (x) => {
        const r = track.getBoundingClientRect();
        return r.width ? Math.max(0, Math.min(1, (x - r.left) / r.width)) * R.dur : 0;
    };
    let drag = null;
    track.addEventListener('pointerdown', (e) => {
        if (!R || e.button !== 0)
            return;
        if (pv?.playing)
            void togglePreviewPlay(); // grabbing the timeline pauses the preview
        const h = e.target.closest('[data-h]')?.getAttribute('data-h');
        const t0 = tAt(e.clientX);
        drag = { mode: h || 'scrub', t0, x0: e.clientX, moved: false, before: snapshotEdit() };
        track.setPointerCapture(e.pointerId);
        if (!h)
            setPlayhead(t0);
        tl.focus();
        e.preventDefault();
    });
    track.addEventListener('pointermove', (e) => {
        if (!R || !drag)
            return;
        const tm = tAt(e.clientX);
        if (Math.abs(e.clientX - drag.x0) > 4)
            drag.moved = true;
        if (drag.mode === 'start') {
            R.edit.trimStart = Math.max(0, Math.min(Math.round(tm), keepUntil(R.edit, R.dur) - MIN_CUT_MS));
            renderTimeline();
        }
        else if (drag.mode === 'end') {
            const v = Math.max(R.edit.trimStart + MIN_CUT_MS, Math.min(Math.round(tm), R.dur));
            R.edit.trimEnd = v >= R.dur - 1 ? null : v;
            renderTimeline();
        }
        else {
            setPlayhead(tm);
            if (drag.moved) {
                R.sel = { a: Math.min(drag.t0, tm), b: Math.max(drag.t0, tm) };
                renderTimeline();
                updateToolState();
            }
        }
    });
    const end = () => {
        if (!R || !drag)
            return;
        const d = drag;
        drag = null;
        if (d.mode !== 'scrub') {
            // A handle drag is one undo step, recorded once on release.
            if (snapshotEdit() !== d.before) {
                R.undo.push(d.before);
                R.redo = [];
                editChanged();
            }
        }
        else if (!d.moved && R.sel) {
            R.sel = null;
            renderTimeline();
            updateToolState();
        }
    };
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
    // Keyboard: the timeline is a slider over the take, plus editing keys.
    tl.addEventListener('keydown', (e) => {
        if (!R)
            return;
        const step = e.shiftKey ? 1000 : 100;
        let handled = true;
        switch (e.key) {
            case 'ArrowLeft':
                setPlayhead(R.playhead - step);
                break;
            case 'ArrowRight':
                setPlayhead(R.playhead + step);
                break;
            case 'Home':
                setPlayhead(R.edit.trimStart);
                break;
            case 'End':
                setPlayhead(keepUntil(R.edit, R.dur));
                break;
            case 'i':
            case 'I':
                R.sel = { a: R.playhead, b: Math.max(R.playhead, R.sel?.b ?? R.playhead) };
                renderTimeline();
                updateToolState();
                break;
            case 'o':
            case 'O':
                R.sel = { a: Math.min(R.sel?.a ?? R.playhead, R.playhead), b: R.playhead };
                renderTimeline();
                updateToolState();
                break;
            case 'x':
            case 'X':
            case 'Delete':
            case 'Backspace':
                cutSelection();
                break;
            case 'm':
            case 'M':
                addMarker();
                break;
            case '[':
                setTrimStart(R.playhead);
                break;
            case ']':
                setTrimEnd(R.playhead);
                break;
            case ' ':
                void togglePreviewPlay();
                break;
            case 'Escape':
                if (R.sel) {
                    R.sel = null;
                    renderTimeline();
                    updateToolState();
                }
                else
                    handled = false; // let the bar handle it
                break;
            default: handled = false;
        }
        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    });
}
// ── preview: an rrweb Replayer over the EDITED stream, seeked as you scrub ──
let pv = null;
let pvGen = 0;
let pvTimer = null;
let pvSeekRaf = 0;
function ensureReplayCss() {
    if (document.getElementById('rrweb-replay-css'))
        return;
    const link = document.createElement('link');
    link.id = 'rrweb-replay-css';
    link.rel = 'stylesheet';
    link.href = 'assets/vendor/rrweb.min.css';
    document.head.appendChild(link);
}
function destroyPreview() {
    pvGen++;
    if (pvTimer != null) {
        clearTimeout(pvTimer);
        pvTimer = null;
    }
    if (pvSeekRaf) {
        cancelAnimationFrame(pvSeekRaf);
        pvSeekRaf = 0;
    }
    if (!pv)
        return;
    const p = pv;
    pv = null;
    try {
        cancelAnimationFrame(p.raf);
    }
    catch { /* ignore */ }
    try {
        p.rep.pause();
    }
    catch { /* ignore */ }
    try {
        p.rep.destroy?.();
    }
    catch { /* ignore */ }
    const host = bar?.querySelector('.rstudio-pv-host');
    if (host)
        host.innerHTML = '';
}
function schedulePreview() {
    if (!R?.previewOn)
        return;
    if (pvTimer != null)
        clearTimeout(pvTimer);
    // Rebuilding a Replayer over a long take is a heavy synchronous DOM build; coalesce edits.
    pvTimer = window.setTimeout(() => { pvTimer = null; void mountPreview(); }, 300);
}
async function mountPreview() {
    destroyPreview();
    const gen = pvGen;
    if (!R || !R.previewOn || !bar)
        return;
    const host = bar.querySelector('.rstudio-pv-host');
    if (!host)
        return;
    host.innerHTML = `<span class="rstudio-pv-msg">${esc(t('watcher.loading') || 'Loading…')}</span>`;
    const rr = await loadRrweb().catch(() => null);
    if (gen !== pvGen || !R || !host.isConnected)
        return;
    if (!rr?.Replayer) {
        host.innerHTML = `<span class="rstudio-pv-msg">${esc(t('rstudio.pv.fail') || 'Preview unavailable.')}</span>`;
        return;
    }
    ensureReplayCss();
    const evs = editEvents(R.events, R.edit, { dropPointerMoves: R.dropMoves });
    if (playabilityProblem(evs)) {
        host.innerHTML = `<span class="rstudio-pv-msg">${esc(t('rstudio.badedit') || 'This edit would not play back. Undo it.')}</span>`;
        return;
    }
    host.innerHTML = '';
    let rep;
    try {
        rep = new rr.Replayer(evs, { root: host, speed: 1, skipInactive: false, showWarning: false, mouseTail: false, triggerFocus: false });
    }
    catch (e) {
        console.warn('[Replay Studio] preview failed', e);
        host.innerHTML = `<span class="rstudio-pv-msg">${esc(t('rstudio.pv.fail') || 'Preview unavailable.')}</span>`;
        return;
    }
    const m4 = evs.find((x) => x.type === 4 && x.data?.width);
    const frameOutline = document.createElement('div');
    frameOutline.className = 'rstudio-pv-frame';
    host.appendChild(frameOutline);
    pv = { rep, recW: m4?.data?.width || window.innerWidth, recH: m4?.data?.height || window.innerHeight, regions: editRegions(R.regions, R.edit, R.dur), dur: editedDuration(R.edit, R.dur), raf: 0, playing: false };
    fitPreview();
    previewSeek();
    updatePlayButton();
}
/** Scale the replayed page into the preview box and draw the capture frame active at `ms`. */
function fitPreview(ms) {
    if (!pv || !bar)
        return;
    const host = bar.querySelector('.rstudio-pv-host');
    const wrap = pv.rep.wrapper;
    if (!host || !wrap)
        return;
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h)
        return;
    const s = Math.min(w / pv.recW, h / pv.recH);
    const ox = (w - pv.recW * s) / 2, oy = (h - pv.recH * s) / 2;
    Object.assign(wrap.style, { position: 'absolute', transformOrigin: 'top left', transform: `scale(${s})`, left: ox + 'px', top: oy + 'px' });
    const fr = host.querySelector('.rstudio-pv-frame');
    if (!fr)
        return;
    const at = ms ?? 0;
    let rect = null;
    for (const k of pv.regions) {
        if (k.t <= at)
            rect = k.rect;
        else
            break;
    }
    const full = !rect || (rect.x <= 0 && rect.y <= 0 && rect.w >= pv.recW && rect.h >= pv.recH);
    fr.hidden = full;
    if (rect && !full)
        Object.assign(fr.style, { left: ox + rect.x * s + 'px', top: oy + rect.y * s + 'px', width: rect.w * s + 'px', height: rect.h * s + 'px' });
}
function previewSeek() {
    if (!pv || !R || pv.playing)
        return;
    if (pvSeekRaf)
        return;
    pvSeekRaf = requestAnimationFrame(() => {
        pvSeekRaf = 0;
        if (!pv || !R)
            return;
        const m = mapTime(R.playhead, R.edit, R.dur) ?? pv.dur;
        try {
            pv.rep.pause(m);
        }
        catch { /* ignore */ }
        fitPreview(m);
    });
}
function updatePlayButton() {
    const b = bar?.querySelector('[data-rs-act="pvplay"]');
    if (!b)
        return;
    const on = !!pv?.playing;
    b.innerHTML = uiIcon(on ? 'pause' : 'play', 14);
    b.setAttribute('aria-label', on ? (t('rstudio.pause') || 'Pause') : (t('rstudio.pv.play') || 'Play'));
    b.setAttribute('data-tooltip', on ? (t('rstudio.pause') || 'Pause') : (t('rstudio.pv.play') || 'Play'));
}
async function togglePreviewPlay() {
    if (!R)
        return;
    if (!R.previewOn) {
        R.previewOn = true;
        renderBar();
        bar?.querySelector('.rstudio-tl')?.focus();
        await mountPreview();
    }
    if (!pv)
        return;
    const p = pv;
    if (p.playing) {
        p.playing = false;
        cancelAnimationFrame(p.raf);
        try {
            p.rep.pause();
        }
        catch { /* ignore */ }
        updatePlayButton();
        return;
    }
    let from = mapTime(R.playhead, R.edit, R.dur) ?? 0;
    if (from >= p.dur - 50)
        from = 0;
    p.playing = true;
    try {
        p.rep.play(from);
    }
    catch {
        p.playing = false;
        return;
    }
    updatePlayButton();
    const tick = () => {
        if (!pv || pv !== p || !p.playing || !R)
            return;
        const cur = Math.min(p.rep.getCurrentTime(), p.dur);
        R.playhead = unmapTime(cur, R.edit, R.dur);
        updatePlayhead();
        fitPreview(cur);
        if (cur >= p.dur) {
            p.playing = false;
            try {
                p.rep.pause();
            }
            catch { /* ignore */ }
            updatePlayButton();
            return;
        }
        p.raf = requestAnimationFrame(tick);
    };
    p.raf = requestAnimationFrame(tick);
}
// ── export ───────────────────────────────────────────────────────────────────────────
// Build the .bmmreplay from the edited take. Returns null (and says why) if the result
// would not play: the editor never writes a file the players cannot open.
function buildBundle() {
    if (!R)
        return null;
    const events = editEvents(R.events, R.edit, { dropPointerMoves: R.dropMoves });
    const problem = playabilityProblem(events);
    if (problem) {
        console.warn('[Replay Studio] edited take is not playable:', problem);
        setStatus(t('rstudio.badedit') || 'This edit would not play back. Undo it.');
        return null;
    }
    const regions = editRegions(R.regions, R.edit, R.dur);
    const markers = editMarkers(R.markers, R.edit, R.dur);
    const durationMs = events[events.length - 1].timestamp - events[0].timestamp;
    const bundle = {
        bmmReplay: 1,
        app: 'BetterModsManager',
        createdAt: new Date().toISOString(),
        masked: !isFullReplay(),
        durationMs,
        events,
        regions, // [{ t, rect }] — region-aware players crop to this
        frame: S?.preset || 'fullscreen',
        studio: true,
    };
    if (R.title.trim())
        bundle.title = R.title.trim().slice(0, 120);
    if (markers.length)
        bundle.markers = markers;
    if (!isEditEmpty(R.edit))
        bundle.edit = { trimStart: R.edit.trimStart, trimEnd: R.edit.trimEnd, cuts: normalizeCuts(R.edit.cuts, R.dur) };
    return JSON.stringify(bundle);
}
async function studioExport() {
    if (!R || R.busy)
        return null;
    const content = buildBundle();
    if (!content)
        return null;
    R.busy = true;
    updateToolState();
    setStatus(t('rstudio.saving') || 'Saving…');
    try {
        const path = await invoke('save_local_replay', { content });
        if (R) {
            R.savedPath = path || null;
            R.dirty = false;
        }
        setStatus((t('rstudio.saved') || 'Saved to Replays') + (path ? ` · ${path.split(/[\\/]/).pop()}` : '') + ` · ${fmtBytes(content.length)}`);
        return path || null;
    }
    catch {
        setStatus(t('rstudio.savefail') || 'Save failed.');
        return null;
    }
    finally {
        if (R)
            R.busy = false;
        updateToolState();
    }
}
async function copyEmbed(kind) {
    if (!R)
        return;
    // An embed names a file, so it needs the current edit on disk first.
    let path = R.savedPath;
    if (!path || R.dirty)
        path = await studioExport();
    if (!path || !R)
        return;
    const s = embedSnippets(path.split(/[\\/]/).pop() || '', R.title);
    try {
        await navigator.clipboard.writeText(kind === 'md' ? s.md : s.html);
        setStatus(t('rstudio.copied') || 'Embed copied. Put the file in the docs assets/replays folder.');
    }
    catch {
        setStatus(t('rstudio.copyfail') || 'Could not copy.');
    }
}
async function openInViewer() {
    const content = buildBundle();
    if (!content)
        return;
    // The viewer is a modal at the bottom of the window; collapse the bar so it does not
    // sit over the viewer's own controls (its "Export as video" lives there).
    minimized = true;
    renderBar();
    try {
        const w = await import('../settings/replay-watcher.js');
        await w.playReplayJson(content);
    }
    catch (e) {
        console.warn('[Replay Studio] viewer failed', e);
        setStatus(t('rstudio.pv.fail') || 'Preview unavailable.');
    }
}
// ── Video ────────────────────────────────────────────────────────────────────────────
//
// Independent of the .bmmreplay recorder: you can run either, or both at once, because they
// capture different things (a mutation log vs. pixels) and neither interferes with the other.
//
// Converting an existing .bmmreplay is the same operation rather than a second code path —
// open it in the viewer (the editor's "Open in viewer"), press Export as video, let it play.
// A DOM cannot be photographed from inside the page (captureStream is for <canvas> and media
// elements), and rasterising it ourselves would redraw an approximation with the wrong fonts
// and no shadows, which for a tool meant to show what the app really looked like is worse
// than not offering it.
async function videoStart() {
    try {
        const { ext } = await startCapture({ onStopped: () => renderBar() });
        setStatus((t('rstudio.vstarted') || 'Recording video') + ` (.${ext}): ` + (t('rstudio.vstophint') || 'press Stop video when done'));
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
            setStatus(t('rstudio.vempty') || 'The capture produced no frames. Nothing saved.');
        else
            setStatus(`${t('rstudio.vsaved') || 'Clip saved'} · ${r.path.split(/[\\/]/).pop()} · ${fmtMB(r.bytes)} · ${(r.ms / 1000).toFixed(1)}s`);
    }
    catch {
        setStatus(t('rstudio.vsavefail') || 'Saving the clip failed.');
    }
    renderBar();
}
// ── UI: a compact floating control bar ──
function setStatus(msg) {
    const s = bar?.querySelector('.rstudio-status');
    if (s) {
        s.textContent = msg;
        s.title = msg;
    }
}
// Two-step discard: "New" and close (×, Esc) on an unsaved take arm first and act on the
// second press. A finished take used to vanish on one stray Esc.
let armed = null;
let armTimer = null;
function disarm() {
    armed = null;
    if (armTimer != null) {
        clearTimeout(armTimer);
        armTimer = null;
    }
    bar?.querySelectorAll('.rstudio-armed').forEach((b) => b.classList.remove('rstudio-armed'));
}
function confirmDiscard(act) {
    // A take in progress counts as unsaved too: × used to end it on one click.
    if (!S?.recording && (!R || !R.dirty))
        return true;
    if (armed === act) {
        disarm();
        return true;
    }
    disarm();
    armed = act;
    armTimer = window.setTimeout(disarm, 4000);
    bar?.querySelector(`[data-rs-act="${act}"]`)?.classList.add('rstudio-armed');
    setStatus(t('rstudio.discard') || 'Unsaved take. Press again to discard it.');
    return false;
}
// The meter ticks on its own so the bar is never re-rendered mid-recording — a full
// renderBar() would blow away the focus in the hidden-element row.
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
    const p = Math.min(100, (S.bytes / STUDIO_BYTE_BUDGET) * 100);
    txt.textContent = `${fmtClock(Math.max(0, elapsed))} · ${fmtMB(S.bytes)}`;
    fill.style.width = p.toFixed(1) + '%';
    const el = bar.querySelector('.rstudio-meter');
    el?.classList.toggle('warn', p >= STUDIO_WARN_AT * 100);
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
const btn = (id, label, cls = '', extra = '') => `<button type="button" class="rstudio-btn ${cls}" data-rs-act="${id}"${extra}>${label}</button>`;
const ibtn = (id, icon, tip, cls = '') => `<button type="button" class="rstudio-btn rstudio-ibtn ${cls}" data-rs-act="${id}" data-tooltip="${esc(tip)}" aria-label="${esc(tip)}">${uiIcon(icon, 14)}</button>`;
function videoControl() {
    const vid = captureSupport();
    if (isCapturing())
        return btn('vstop', '■ ' + (t('rstudio.vstop') || 'Stop video'), 'rstudio-primary');
    if (vid.ok)
        return btn('vstart', '● ' + (t('rstudio.vrec') || 'Record video') + ` (.${vid.ext})`);
    return `<span class="rstudio-hide-none" data-tooltip="${esc(vid.reason === 'no-encoder'
        ? (t('rstudio.vnoenc') || 'This runtime has no video encoder (MediaRecorder).')
        : (t('rstudio.vnodisp') || 'This runtime cannot capture the screen (getDisplayMedia).'))}">${t('rstudio.vunavail') || 'video n/a'}</span>`;
}
function editorHtml() {
    if (!R)
        return '';
    const help = t('rstudio.tl.help') || 'Drag to select. Arrows move, I and O mark a range, X cuts, M adds a marker, [ and ] trim, Space plays.';
    const preview = R.previewOn ? `<div class="rstudio-pv"><div class="rstudio-pv-host"></div></div>` : '';
    return `
    ${preview}
    <div class="rstudio-tl" tabindex="0" role="slider" aria-label="${esc(t('rstudio.tl.label') || 'Timeline')}" aria-valuemin="0" aria-valuemax="${Math.round(R.dur)}" aria-valuenow="0" aria-describedby="rstudio-tl-help">
      <div class="rstudio-tl-track"></div>
      <div class="rstudio-tl-ruler"><span>${fmtClock(0)}</span><span>${fmtClock(R.dur / 2)}</span><span>${fmtClock(R.dur)}</span></div>
    </div>
    <div class="rstudio-tools">
      ${ibtn('pvplay', 'play', t('rstudio.pv.play') || 'Play')}
      <button type="button" class="rstudio-btn rstudio-mini ${R.previewOn ? 'rstudio-on' : ''}" data-rs-act="pvtoggle" aria-pressed="${R.previewOn}">${uiIcon('eye', 14)} ${esc(t('rstudio.preview') || 'Preview')}</button>
      <span class="rstudio-tl-time"></span>
      <span class="rstudio-sep"></span>
      ${btn('setstart', '[ ' + esc(t('rstudio.setstart') || 'Start here'), 'rstudio-mini')}
      ${btn('setend', esc(t('rstudio.setend') || 'End here') + ' ]', 'rstudio-mini')}
      ${btn('cutsel', esc(t('rstudio.cutsel') || 'Cut selection'), 'rstudio-mini')}
      ${btn('marker', uiIcon('pin', 14) + ' ' + esc(t('rstudio.marker') || 'Marker'), 'rstudio-mini')}
      <span class="rstudio-sep"></span>
      ${ibtn('undo', 'undo', t('rstudio.undo') || 'Undo')}
      ${ibtn('redo', 'redo', t('rstudio.redo') || 'Redo')}
      ${ibtn('clearedits', 'reset', t('rstudio.clearedits') || 'Clear edits')}
    </div>
    <p class="rstudio-help" id="rstudio-tl-help">${esc(help)}</p>
    <div class="rstudio-lists rstudio-hide" hidden></div>
    <div class="rstudio-export">
      <input class="rstudio-title-in" type="text" maxlength="120" value="${esc(R.title)}" placeholder="${esc(t('rstudio.title.ph') || 'Title for embeds')}" aria-label="${esc(t('rstudio.title.ph') || 'Title for embeds')}">
      <label class="rstudio-showstudios" data-tooltip="${esc(t('rstudio.dropmoves.tip') || 'Smaller file. Playback shows no cursor trail.')}"><input type="checkbox" data-rs-act="dropmoves" ${R.dropMoves ? 'checked' : ''}> ${esc(t('rstudio.dropmoves') || 'Drop cursor moves')}</label>
      <span class="rstudio-grow"></span>
      ${btn('copymd', uiIcon('copy', 14) + ' :::replay', 'rstudio-mini', ` data-tooltip="${esc(t('rstudio.copymd') || 'Copy the markdown embed')}"`)}
      ${btn('copyhtml', uiIcon('code', 14) + ' HTML', 'rstudio-mini', ` data-tooltip="${esc(t('rstudio.copyhtml') || 'Copy the docs HTML embed')}"`)}
      ${btn('viewer', uiIcon('launch', 14) + ' ' + esc(t('rstudio.openviewer') || 'Open in viewer'), 'rstudio-mini', ` data-tooltip="${esc(t('rstudio.openviewer.tip') || 'Play it back. Export as video from there.')}"`)}
      ${btn('export', uiIcon('save', 14) + ' ' + esc(t('rstudio.export') || 'Export .bmmreplay'), 'rstudio-primary')}
    </div>`;
}
function renderBar() {
    if (!S || !bar)
        return;
    destroyPreview();
    const rec = S.recording, paused = S.paused;
    const presetSel = `
    <select class="rstudio-sel" data-rs-act="preset" ${rec ? 'disabled' : ''} aria-label="${esc(t('rstudio.framepreset') || 'Capture frame')}">
      <option value="fullscreen" ${S.preset === 'fullscreen' ? 'selected' : ''}>${t('rstudio.fullscreen') || 'Fullscreen'}</option>
      <option value="main" ${S.preset === 'main' ? 'selected' : ''}>${t('rstudio.main') || 'Main window (no Tasky bar)'}</option>
      <option value="custom" ${S.preset === 'custom' ? 'selected' : ''}>${t('rstudio.custom') || 'Custom frame'}</option>
    </select>`;
    let controls;
    const review = !rec && !!R;
    if (review) {
        controls = `<span class="rstudio-sum"></span>` + btn('reset', uiIcon('add', 14) + ' ' + (t('rstudio.new') || 'New'), 'rstudio-mini');
    }
    else if (!rec) {
        // Video sits beside the .bmmreplay recorder rather than replacing it: they answer
        // different needs — a .bmmreplay is inspectable and tiny, an mp4 is what you paste
        // into a message. The label names the container this runtime will ACTUALLY produce,
        // so "record mp4" never turns into a webm at save time.
        controls = presetSel + btn('start', '● ' + (t('rstudio.rec') || 'Record'), 'rstudio-primary') + videoControl();
    }
    else {
        // A live meter (elapsed + buffered size + how much of the memory budget is used) so a long
        // take never grows invisibly. A running video capture keeps its Stop button here too: it
        // used to be unreachable until the .bmmreplay take ended.
        controls =
            `<span class="rstudio-dot ${paused ? 'paused' : ''}" aria-hidden="true"></span>` +
                (paused ? btn('resume', t('rstudio.resume') || 'Resume') : btn('pause', t('rstudio.pause') || 'Pause')) +
                btn('stop', '■ ' + (t('rstudio.stop') || 'Stop'), 'rstudio-primary') +
                (isCapturing() ? btn('vstop', '■ ' + (t('rstudio.vstop') || 'Stop video')) : '') +
                `<span class="rstudio-meter"><span class="rstudio-meter-txt"></span><span class="rstudio-gauge"><i></i></span></span>`;
    }
    const status = `<span class="rstudio-status" role="status" aria-live="polite">${rec ? esc(paused ? (t('rstudio.paused') || 'Paused. Move the frame.') : (t('rstudio.recording') || 'Recording…')) : ''}</span>`;
    // "Hidden elements" row — pick app elements to exclude from the recording (the studios
    // themselves are always excluded). Available before AND during a recording; not shown in the
    // editor.
    const chips = S.hideSelectors.map((s) => `<span class="rstudio-chip" data-tooltip="${esc(s)}"><span>${esc(s)}</span><button type="button" data-rs-act="unhide" data-sel="${esc(s)}" aria-label="${esc(t('rstudio.unhide') || 'Show again')}">${uiIcon('close', 12)}</button></span>`).join('');
    const studioToggle = `<label class="rstudio-showstudios" data-tooltip="${esc(t('rstudio.showstudios.tip') || 'Include the Replay/Animation Studio panels in the recording')}"><input type="checkbox" data-rs-act="showstudios" ${S.showStudios ? 'checked' : ''} ${rec ? 'disabled' : ''}> ${t('rstudio.showstudios') || 'Show studios in rec'}</label>`;
    const hideRow = !review
        ? `<div class="rstudio-hide"><span class="rstudio-hide-lbl">${t('rstudio.hidden') || 'Hidden'}</span>${chips || `<span class="rstudio-hide-none">${t('rstudio.hidden.none') || 'nothing'}</span>`}<button type="button" class="rstudio-btn rstudio-mini ${S.picking ? 'rstudio-primary' : ''}" data-rs-act="pick-hide">${S.picking ? (t('rstudio.pick.active') || 'Click one…') : '＋ ' + (t('rstudio.pick') || 'Hide element')}</button>${studioToggle}</div>`
        : '';
    bar.innerHTML =
        `<div class="rstudio-main"><div class="rstudio-title">${uiIcon('activity', 14)}${t('rstudio.title') || 'Replay Studio'}</div>${controls}${status}` +
            `<button type="button" class="rstudio-btn rstudio-ibtn rstudio-min" data-rs-act="min" data-tooltip="${esc(t('rstudio.minimize') || 'Minimise. Recording continues.')}" aria-label="${esc(t('rstudio.minimize') || 'Minimise')}" aria-expanded="${!minimized}">${uiIcon('remove', 12)}</button>` +
            `<button type="button" class="rstudio-btn rstudio-ibtn rstudio-x" data-rs-act="close" aria-label="${esc(t('common.close') || 'Close')}">${uiIcon('close', 12)}</button></div>` +
            (review ? `<div class="rstudio-editor">${editorHtml()}</div>` : hideRow);
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
    bar.classList.toggle('rstudio-review', review);
    if (rec)
        updateMeter();
    if (review) {
        renderTimeline();
        renderLists();
        updateSummary();
        updateToolState();
        wireTimeline();
        if (R.previewOn && !minimized)
            void mountPreview();
    }
}
function onBarClick(e) {
    const el = e.target.closest('[data-rs-act]');
    if (!el || !S)
        return;
    // Keep the click on the toolbar — never let it bubble to the app underneath.
    e.stopPropagation();
    const act = el.getAttribute('data-rs-act');
    if (act !== 'reset' && act !== 'close')
        disarm();
    const i = Number(el.getAttribute('data-i'));
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
        case 'export':
            void studioExport();
            break;
        case 'setstart':
            if (R)
                setTrimStart(R.playhead);
            break;
        case 'setend':
            if (R)
                setTrimEnd(R.playhead);
            break;
        case 'cutsel':
            cutSelection();
            break;
        case 'marker':
            addMarker();
            break;
        case 'undo':
            undo();
            break;
        case 'redo':
            redo();
            break;
        case 'clearedits':
            commit(() => { R.edit = emptyEdit(); R.markers = []; });
            break;
        case 'uncut':
            if (R && Number.isInteger(i))
                commit(() => { const c = normalizeCuts(R.edit.cuts, R.dur); c.splice(i, 1); R.edit.cuts = c; });
            break;
        case 'unmark':
            if (R && Number.isInteger(i))
                commit(() => { R.markers = R.markers.filter((_, k) => k !== i); });
            break;
        case 'mkgo':
            if (R && R.markers[i])
                setPlayhead(R.markers[i].t);
            break;
        case 'pvtoggle':
            if (R) {
                R.previewOn = !R.previewOn;
                renderBar();
            }
            break;
        case 'pvplay':
            void togglePreviewPlay();
            break;
        case 'copymd':
            void copyEmbed('md');
            break;
        case 'copyhtml':
            void copyEmbed('html');
            break;
        case 'viewer':
            void openInViewer();
            break;
        case 'reset':
            if (!confirmDiscard('reset'))
                break;
            leaveReview();
            S.events = [];
            S.sizes = [];
            S.regions = [];
            S.pauses = [];
            S.bytes = 0;
            S.warned = false;
            S.autoStopped = false;
            if (S.preset !== 'fullscreen')
                renderFrame();
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
            if (confirmDiscard('close'))
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
    else if (act === 'dropmoves' && R) {
        R.dropMoves = el.checked;
        R.dirty = true;
        updateSummary();
        schedulePreview();
    }
    else if (el.classList.contains('rstudio-mk-in') && R) {
        const i = Number(el.getAttribute('data-mk'));
        const v = el.value.trim().slice(0, 80);
        if (R.markers[i] && v && v !== R.markers[i].label)
            commit(() => { R.markers = R.markers.map((m, k) => (k === i ? { ...m, label: v } : m)); });
    }
}
function onBarInput(e) {
    const el = e.target;
    if (R && el.classList.contains('rstudio-title-in')) {
        R.title = el.value;
        R.dirty = true;
    }
}
function onBarKey(e) {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (R && !typing && (e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'y' || e.shiftKey)
            redo();
        else
            undo();
        return;
    }
    // Esc inside the bar closes it, like every other panel. Not while a recording runs (one
    // stray keypress must not end a take), and an unsaved edit asks twice.
    if (e.key === 'Escape' && !(S?.recording)) {
        e.preventDefault();
        e.stopPropagation();
        if (confirmDiscard('close'))
            closeReplayStudio();
    }
}
// Styles injected once, on first open, so they cost nothing at boot. Colours are the app's
// theme tokens: the bar follows light and dark themes like the rest of BMM, on an opaque
// elevated surface so it stays readable over whatever it floats on. Every foreground sits on
// a token background of its own family (text-on-accent on accent, text-primary on bg-*).
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
    width:max-content;max-width:min(calc(100% - 24px),980px);box-sizing:border-box;}
  .rstudio-bar.rstudio-review{width:min(calc(100% - 24px),920px);max-height:calc(100% - 40px);overflow:auto;}
  /* The collapsed pill itself is styled in css/debug.css; the editor folds away with it. */
  .rstudio-bar.rstudio-mini{width:auto;overflow:visible;}
  .rstudio-bar.rstudio-mini .rstudio-editor{display:none;}
  /* Wraps to a second row instead of crushing its children. */
  .rstudio-main{display:flex;align-items:center;flex-wrap:wrap;gap:8px;row-gap:8px;min-width:0;}
  .rstudio-hide{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-top:7px;border-top:1px solid var(--bmm-border-hover);}
  .rstudio-hide[hidden]{display:none;}
  .rstudio-hide-lbl{font-weight:700;color:var(--bmm-text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em;}
  .rstudio-hide-none{color:var(--bmm-text-muted);font-weight:500;font-size:12px;}
  .rstudio-showstudios{display:inline-flex;align-items:center;gap:6px;margin-left:auto;font-size:11.5px;font-weight:600;color:var(--bmm-text-secondary);cursor:pointer;white-space:nowrap;}
  .rstudio-showstudios input{cursor:pointer;accent-color:var(--bmm-accent);}
  .rstudio-chip{display:inline-flex;align-items:center;gap:5px;background:var(--bmm-bg-base);color:var(--bmm-text-primary);border:1px solid var(--bmm-border-hover);border-radius:999px;
    padding:2px 4px 2px 9px;font:600 11px/1.4 var(--bmm-font-mono,ui-monospace),monospace;max-width:240px;min-width:0;}
  .rstudio-chip > span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
  .rstudio-chip button{border:0;background:var(--bmm-s10);color:var(--bmm-text-primary);border-radius:50%;width:17px;height:17px;padding:0;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;}
  .rstudio-chip button:hover{background:var(--bmm-danger);color:var(--bmm-text-on-accent);}
  .rstudio-chip button:focus-visible,.rstudio-mk-in:focus-visible{outline:2px solid var(--bmm-accent);outline-offset:1px;}
  .rstudio-chip-cut{border-color:color-mix(in srgb, var(--bmm-danger) 55%, var(--bmm-border-hover));}
  .rstudio-chip .rstudio-mk-go{width:auto;height:auto;border-radius:999px;padding:0 4px;background:transparent;color:var(--bmm-text-secondary);font:inherit;}
  .rstudio-chip .rstudio-mk-go:hover{background:var(--bmm-bg-hover);color:var(--bmm-text-primary);}
  .rstudio-mk-in{width:110px;min-width:0;background:transparent;border:0;color:var(--bmm-text-primary);font:inherit;padding:0 2px;}
  .rstudio-title{font-weight:800;margin-right:2px;color:var(--bmm-accent);display:flex;align-items:center;gap:6px;white-space:nowrap;}
  .rstudio-btn{border:1px solid var(--bmm-border-hover);background:var(--bmm-bg-base);color:var(--bmm-text-primary);border-radius:9px;
    padding:6px 10px;cursor:pointer;font:inherit;white-space:nowrap;flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;
    transition:background .12s,border-color .12s;}
  .rstudio-btn.rstudio-mini{padding:4px 8px;font-size:12px;}
  .rstudio-ibtn{padding:5px 7px;}
  .rstudio-btn:disabled{opacity:.45;cursor:default;}
  .rstudio-btn:focus-visible,.rstudio-sel:focus-visible,.rstudio-title-in:focus-visible{outline:2px solid var(--bmm-accent);outline-offset:2px;}
  /* Minimise + close ride to the right end of whatever row they land on. */
  .rstudio-min{margin-left:auto;}
  .rstudio-btn:not(:disabled):hover{background:var(--bmm-bg-hover);border-color:var(--bmm-accent);}
  .rstudio-primary{background:var(--bmm-accent);border-color:var(--bmm-accent);color:var(--bmm-text-on-accent);}
  .rstudio-primary:not(:disabled):hover{background:var(--bmm-accent);color:var(--bmm-text-on-accent);filter:brightness(1.1);}
  .rstudio-on{border-color:var(--bmm-accent);background:var(--bmm-accent-dim);}
  .rstudio-armed{border-color:var(--bmm-danger);color:var(--bmm-danger);}
  .rstudio-x{color:var(--bmm-text-secondary);}
  .rstudio-x:hover{border-color:var(--bmm-danger);color:var(--bmm-danger);}
  .rstudio-sel{background:var(--bmm-bg-base);color:var(--bmm-text-primary);border:1px solid var(--bmm-border-hover);border-radius:9px;padding:6px 8px;font:inherit;}
  .rstudio-status{color:var(--bmm-text-secondary);font-weight:500;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:0 1 auto;min-width:0;}
  .rstudio-sum{color:var(--bmm-text-secondary);font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}
  /* Live meter: elapsed + buffered size, with a gauge against the memory budget. */
  .rstudio-meter{display:flex;align-items:center;gap:7px;font-variant-numeric:tabular-nums;}
  .rstudio-meter-txt{font-size:11.5px;color:var(--bmm-text-secondary);white-space:nowrap;min-width:96px;}
  .rstudio-gauge{width:54px;height:5px;border-radius:999px;background:var(--bmm-s10);overflow:hidden;}
  .rstudio-gauge > i{display:block;height:100%;width:0;border-radius:999px;background:var(--bmm-accent);transition:width .3s linear;}
  .rstudio-meter.warn .rstudio-gauge > i{background:var(--bmm-warning);}
  .rstudio-meter.warn .rstudio-meter-txt{color:var(--bmm-warning);}
  .rstudio-dot{width:10px;height:10px;border-radius:50%;background:var(--bmm-danger);animation:rstudio-pulse 1.4s infinite;flex:0 0 auto;}
  .rstudio-dot.paused{background:var(--bmm-warning);animation:none;}
  @keyframes rstudio-pulse{0%{opacity:1}50%{opacity:.35}100%{opacity:1}}
  /* ── editor ── */
  .rstudio-editor{display:flex;flex-direction:column;gap:8px;padding-top:8px;border-top:1px solid var(--bmm-border-hover);min-width:0;}
  .rstudio-pv{border-radius:10px;overflow:hidden;border:1px solid var(--bmm-border-hover);background:var(--bmm-bg-base);}
  .rstudio-pv-host{position:relative;height:clamp(140px,28vh,260px);overflow:hidden;}
  .rstudio-pv-host iframe{pointer-events:none;}
  .rstudio-pv-msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--bmm-text-muted);font-weight:500;font-size:12px;text-align:center;padding:8px;}
  .rstudio-pv-frame{position:absolute;border:2px solid var(--bmm-accent);border-radius:4px;pointer-events:none;box-shadow:0 0 0 999px color-mix(in srgb, var(--bmm-bg-base) 45%, transparent);transition:all .3s ease;}
  .rstudio-pv-frame[hidden]{display:none;}
  .rstudio-tl{position:relative;padding:4px 0 0;outline:none;border-radius:8px;}
  .rstudio-tl:focus-visible{outline:2px solid var(--bmm-accent);outline-offset:3px;}
  .rstudio-tl-track{position:relative;height:40px;border-radius:8px;background:var(--bmm-bg-base);border:1px solid var(--bmm-border-hover);cursor:crosshair;touch-action:none;overflow:visible;}
  .rstudio-tl-trim{position:absolute;top:0;bottom:0;background:var(--bmm-s10);
    background-image:repeating-linear-gradient(135deg,transparent 0 6px,color-mix(in srgb, var(--bmm-text-muted) 18%, transparent) 6px 7px);}
  .rstudio-tl-cut{position:absolute;top:0;bottom:0;background:color-mix(in srgb, var(--bmm-danger) 16%, transparent);
    border-left:2px solid var(--bmm-danger);border-right:2px solid var(--bmm-danger);
    background-image:repeating-linear-gradient(135deg,transparent 0 5px,color-mix(in srgb, var(--bmm-danger) 30%, transparent) 5px 7px);}
  .rstudio-tl-sel{position:absolute;top:0;bottom:0;background:var(--bmm-accent-dim);border:1px solid var(--bmm-accent);border-radius:3px;pointer-events:none;}
  .rstudio-tl-anchor{position:absolute;top:0;width:1px;height:9px;background:var(--bmm-text-muted);pointer-events:none;}
  .rstudio-tl-region{position:absolute;bottom:4px;width:8px;height:8px;margin-left:-4px;transform:rotate(45deg);background:var(--bmm-accent);border:1px solid var(--bmm-bg-base);border-radius:1px;}
  .rstudio-tl-marker{position:absolute;top:-4px;width:10px;height:10px;margin-left:-5px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:var(--bmm-warning);border:1px solid var(--bmm-bg-base);}
  .rstudio-tl-h{position:absolute;top:-3px;bottom:-3px;width:10px;margin-left:-5px;border-radius:4px;background:var(--bmm-text-primary);border:2px solid var(--bmm-bg-base);cursor:ew-resize;z-index:2;}
  .rstudio-tl-h:hover{background:var(--bmm-accent);}
  .rstudio-tl-head{position:absolute;top:-6px;bottom:-6px;width:2px;margin-left:-1px;background:var(--bmm-accent);pointer-events:none;z-index:3;border-radius:2px;}
  .rstudio-tl-head::before{content:'';position:absolute;top:0;left:-4px;width:10px;height:6px;background:var(--bmm-accent);border-radius:2px 2px 6px 6px;}
  .rstudio-tl-ruler{display:flex;justify-content:space-between;font:500 10.5px/1.6 var(--bmm-font-mono,ui-monospace),monospace;color:var(--bmm-text-muted);padding:2px 1px 0;}
  .rstudio-tools,.rstudio-export{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;}
  .rstudio-tl-time{font:500 11.5px/1.2 var(--bmm-font-mono,ui-monospace),monospace;color:var(--bmm-text-secondary);white-space:pre;font-variant-numeric:tabular-nums;}
  .rstudio-sep{width:1px;align-self:stretch;background:var(--bmm-border-hover);margin:0 2px;}
  .rstudio-help{margin:0;font-weight:500;font-size:11px;color:var(--bmm-text-muted);}
  .rstudio-grow{flex:1 1 0;}
  .rstudio-title-in{flex:0 1 220px;min-width:120px;background:var(--bmm-bg-base);color:var(--bmm-text-primary);border:1px solid var(--bmm-border-hover);border-radius:8px;padding:5px 8px;font:inherit;font-weight:500;}
  .rstudio-title-in::placeholder{color:var(--bmm-text-muted);}
  .rstudio-export .rstudio-showstudios{margin-left:0;}
  @media (max-width:640px){.rstudio-sep,.rstudio-help{display:none;}.rstudio-title-in{flex:1 1 100%;}}
  @media (prefers-reduced-motion: reduce){.rstudio-dot{animation:none;}.rstudio-pv-frame,.rstudio-gauge > i,.rstudio-btn{transition:none;}}
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
    S = { recording: false, paused: false, events: [], sizes: [], bytes: 0, warned: false, autoStopped: false, regions: [], pauses: [], startTs: 0, pauseStart: 0, preset: 'fullscreen', frame: presetRect('fullscreen'), hideSelectors: [], picking: false, showStudios: false };
    R = null;
    minimized = false;
    bar = document.createElement('div');
    bar.className = 'rstudio-bar bmm-no-record';
    bar.setAttribute('data-bmm-no-record', '1');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', t('rstudio.title') || 'Replay Studio');
    bar.addEventListener('click', onBarClick);
    bar.addEventListener('change', onBarChange);
    bar.addEventListener('input', onBarInput);
    bar.addEventListener('keydown', onBarKey);
    uiHost().appendChild(bar);
    renderBar();
    bar.querySelector('.rstudio-btn')?.focus();
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
        () => destroyPreview(),
        () => disarm(),
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
    R = null;
    minimized = false;
    document.dispatchEvent(new CustomEvent('bmm-debug-studio'));
}
//# sourceMappingURL=replay-studio.js.map