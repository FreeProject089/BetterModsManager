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
import { t } from '../../core/i18n.js';
import { loadRrweb, subscribeReplay, unsubscribeReplay, isFullReplay, setExtraBlockSelectors, type ReplaySubscriber } from '../../core/replay-recorder.js';

type Rect = { x: number; y: number; w: number; h: number };
type RegionKey = { t: number; rect: Rect }; // t = ms from recording start (post-compression)
type Preset = 'fullscreen' | 'main' | 'custom';

interface StudioState {
  recording: boolean;
  paused: boolean;
  events: any[];             // buffered rrweb events (raw timestamps)
  regions: { ts: number; rect: Rect }[]; // raw-timestamp region keyframes
  pauses: { start: number; end: number }[]; // raw-timestamp paused intervals
  startTs: number;
  pauseStart: number;
  preset: Preset;
  frame: Rect;
  hideSelectors: string[]; // user-chosen selectors to exclude from the recording
  picking: boolean;        // element-picker active (for "hide this element")
  showStudios: boolean;    // include the studio panels themselves in the recording (default: no)
}

let S: StudioState | null = null;
let listener: ReplaySubscriber | null = null;
let bar: HTMLElement | null = null;
let frameEl: HTMLElement | null = null;

// ── frame geometry ──────────────────────────────────────────────────────────────
function fullscreenRect(): Rect {
  return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
}
// "Main window without the Tasky decoration": everything below the custom title/top bar.
// We measure a title/top-bar element if present, else fall back to fullscreen.
function mainRect(): Rect {
  const barSel = '#titlebar, .titlebar, .window-titlebar, #app-titlebar, .app-topbar, [data-titlebar]';
  const el = document.querySelector(barSel) as HTMLElement | null;
  const top = el ? Math.round(el.getBoundingClientRect().bottom) : 0;
  return { x: 0, y: top, w: window.innerWidth, h: window.innerHeight - top };
}
function presetRect(p: Preset): Rect {
  if (p === 'fullscreen') return fullscreenRect();
  if (p === 'main') return mainRect();
  // custom default: a centred 70% box
  const w = Math.round(window.innerWidth * 0.7);
  const h = Math.round(window.innerHeight * 0.7);
  return { x: Math.round((window.innerWidth - w) / 2), y: Math.round((window.innerHeight - h) / 2), w, h };
}

// ── the on-screen frame overlay (not recorded — carries bmm-no-record) ──
function renderFrame() {
  if (!S) return;
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
  } as any);
  frameEl.classList.toggle('rstudio-frame-locked', !editable);
}
function removeFrame() { frameEl?.remove(); frameEl = null; }

// Drag to move + a bottom-right handle to resize (custom preset only).
function makeDraggable(el: HTMLElement) {
  const handle = document.createElement('div');
  handle.className = 'rstudio-frame-handle';
  el.appendChild(handle);
  let mode: '' | 'move' | 'resize' = '';
  let ox = 0, oy = 0, or: Rect = { x: 0, y: 0, w: 0, h: 0 };
  const down = (e: PointerEvent, m: 'move' | 'resize') => {
    if (!S || S.preset !== 'custom') return;
    mode = m; ox = e.clientX; oy = e.clientY; or = { ...S.frame };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault(); e.stopPropagation();
  };
  el.addEventListener('pointerdown', (e) => { if (e.target === el) down(e, 'move'); });
  handle.addEventListener('pointerdown', (e) => down(e, 'resize'));
  const move = (e: PointerEvent) => {
    if (!S || !mode) return;
    const dx = e.clientX - ox, dy = e.clientY - oy;
    if (mode === 'move') {
      S.frame = { ...or, x: Math.max(0, or.x + dx), y: Math.max(0, or.y + dy) };
    } else {
      S.frame = { ...or, w: Math.max(120, or.w + dx), h: Math.max(90, or.h + dy) };
    }
    renderFrame();
  };
  const up = () => { if (mode && S?.recording && !S.paused) pushRegion(); mode = ''; };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// ── region timeline ──
function pushRegion() {
  if (!S) return;
  S.regions.push({ ts: Date.now(), rect: { ...S.frame } });
}

// ── forced full snapshot (segment anchor) ──
async function takeSnapshot() {
  try { (await loadRrweb())?.record?.takeFullSnapshot?.(true); } catch { /* ignore */ }
}

// Hide every no-record overlay (the studios themselves) with INLINE display:none. rrweb
// serialises the live DOM for a snapshot, so hiding them just before the start snapshot keeps
// them out of it entirely (no placeholder box). The later reveal is a mutation on a blocked
// element, which rrweb ignores — so they stay absent from the whole recording.
function hideNoRecord(on: boolean) {
  document.querySelectorAll<HTMLElement>('.bmm-no-record, [data-bmm-no-record]').forEach((el) => {
    el.style.display = on ? 'none' : '';
  });
}

// A stable-ish CSS selector for a picked element (id → a couple of classes → tag), skipping
// our own studio classes so a pick never targets the toolbar.
function selectorFor(el: Element): string {
  if (el.id) return '#' + CSS.escape(el.id);
  const cn = typeof el.className === 'string' ? el.className : '';
  const cls = cn.trim().split(/\s+/).filter((c) => c && !c.startsWith('rstudio') && !c.startsWith('anim-') && c !== 'bmm-no-record').slice(0, 2);
  return el.tagName.toLowerCase() + (cls.length ? '.' + cls.map((c) => CSS.escape(c)).join('.') : '');
}

// A hover-highlight box so the user sees what they're about to hide while picking.
function makeHighlighter() {
  const box = document.createElement('div');
  box.setAttribute('data-bmm-no-record', '1');
  Object.assign(box.style, {
    position: 'fixed', zIndex: '2147483646', pointerEvents: 'none', border: '2px solid #ef4444',
    background: 'rgba(239,68,68,.12)', borderRadius: '4px', transition: 'all .05s linear', display: 'none',
  } as any);
  document.body.appendChild(box);
  return {
    move(el: Element | null) {
      if (!el) { box.style.display = 'none'; return; }
      const r = el.getBoundingClientRect();
      Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' } as any);
    },
    done() { box.remove(); },
  };
}

// Click-to-pick an element whose selector is added to the hidden list. Hover highlights the
// target; Esc cancels.
function pickToHide() {
  if (!S) return;
  S.picking = true;
  renderBar();
  setStatus(t('rstudio.pick.hint') || 'Hover to highlight, click to hide it from the recording — Esc to cancel');
  const hi = makeHighlighter();
  const ownUI = (el: Element) => !!(el.closest('.rstudio-bar') || el.closest('.rstudio-frame'));
  const finish = () => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('keydown', onKey, true);
    hi.done();
    if (S) S.picking = false;
    renderBar();
  };
  const onMove = (e: MouseEvent) => { const el = e.target as Element; hi.move(el && !ownUI(el) ? el : null); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); finish(); } };
  const onClick = (e: MouseEvent) => {
    const el = e.target as Element;
    if (ownUI(el)) return; // ignore our own UI
    e.preventDefault(); e.stopPropagation();
    const sel = selectorFor(el);
    finish();
    if (!S) return;
    if (sel && !S.hideSelectors.includes(sel)) S.hideSelectors.push(sel);
    applyHideSelectors();
    renderBar();
  };
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
}

function applyHideSelectors() {
  if (!S) return;
  // Only push to the live recorder while a recording is active; otherwise it's applied at start.
  if (S.recording) setExtraBlockSelectors(S.hideSelectors);
}

// Toggle whether BOTH studio panels count as recordable. The studios normally carry
// `bmm-no-record` (the recorder blocks them); when the user opts to SHOW them in the rec we strip
// those markers so rrweb captures them as real content, and restore them afterwards so the next
// (telemetry) recording excludes them again.
function markStudioRecordable(recordable: boolean) {
  document.querySelectorAll('.rstudio-bar, .rstudio-frame, .anim-panel').forEach((el) => {
    if (recordable) { el.classList.remove('bmm-no-record'); el.removeAttribute('data-bmm-no-record'); }
    else { el.classList.add('bmm-no-record'); el.setAttribute('data-bmm-no-record', '1'); }
  });
}

// ── recording lifecycle ──
export async function studioStart() {
  if (!S || S.recording) return;
  S.recording = true; S.paused = false;
  S.events = []; S.regions = []; S.pauses = [];
  S.startTs = Date.now();
  const l = ((ev: any) => {
    if (!S || !S.recording || S.paused) return;
    S.events.push(ev);
  }) as unknown as ReplaySubscriber;
  l.requiresMasking = !isFullReplay();
  listener = l;
  // Pre-load rrweb so the hide window below is a few ms (no visible flicker of the toolbar),
  // then exclude the studio overlays + any user-chosen selectors from the very first snapshot.
  try { await loadRrweb(); } catch { /* ignore */ }
  await setExtraBlockSelectors(S.hideSelectors);
  markStudioRecordable(!!S.showStudios);
  if (!S.showStudios) hideNoRecord(true);
  await subscribeReplay(listener);
  await takeSnapshot();          // seed the buffer with a self-contained full snapshot
  if (!S.showStudios) hideNoRecord(false); // reveal — a blocked-element mutation, ignored by the recorder
  pushRegion();                  // initial frame keyframe
  renderFrame();
  renderBar();
}

export function studioPause() {
  if (!S || !S.recording || S.paused) return;
  S.paused = true; S.pauseStart = Date.now();
  renderBar();
}

export async function studioResume() {
  if (!S || !S.recording || !S.paused) return;
  S.pauses.push({ start: S.pauseStart, end: Date.now() });
  S.paused = false;
  await takeSnapshot();          // fresh anchor so the post-pause segment stands alone
  pushRegion();                  // record the (possibly moved) frame at resume
  renderBar();
}

export async function studioStop() {
  if (!S) return;
  S.recording = false; S.paused = false;
  if (listener) { await unsubscribeReplay(listener); listener = null; }
  await setExtraBlockSelectors([]);  // restore the shared recorder (e.g. telemetry) to base blocking
  markStudioRecordable(false);       // studios excluded again for any later (telemetry) recording
  renderFrame();
  renderBar();                   // switches the bar to the review/export state
}

// Compress paused gaps out of a raw timestamp: subtract every fully-elapsed pause before it.
function compress(ts: number, pauses: { start: number; end: number }[]): number {
  let paused = 0;
  for (const p of pauses) {
    if (p.end <= ts) paused += p.end - p.start;
    else if (p.start < ts) paused += ts - p.start; // inside a pause (shouldn't happen)
  }
  return ts - paused;
}

// Build the .bmmreplay (rrweb events + region timeline), honouring an optional END trim.
function buildBundle(trimEndMs?: number): string | null {
  if (!S || S.events.length < 2) return null;
  const first = S.events[0].timestamp;
  const events = S.events
    .map((ev) => ({ ...ev, timestamp: compress(ev.timestamp, S!.pauses) }))
    .filter((ev) => trimEndMs == null || ev.timestamp - compress(first, S!.pauses) <= trimEndMs);
  const base = compress(first, S.pauses);
  const regions: RegionKey[] = S.regions.map((r) => ({ t: Math.max(0, compress(r.ts, S!.pauses) - base), rect: r.rect }));
  const durationMs = events.length ? events[events.length - 1].timestamp - events[0].timestamp : 0;
  return JSON.stringify({
    bmmReplay: 1,
    app: 'BetterModsManager',
    createdAt: new Date().toISOString(),
    masked: !isFullReplay(),
    durationMs,
    events,
    regions,                       // [{ t, rect }] — region-aware players crop to this
    frame: S.preset,               // which preset produced the recording
    studio: true,
  });
}

async function studioExport(trimEndMs?: number) {
  const content = buildBundle(trimEndMs);
  if (!content) { setStatus(t('rstudio.empty') || 'Nothing recorded yet.'); return; }
  try {
    const path = await invoke('save_local_replay', { content }) as string;
    setStatus((t('rstudio.saved') || 'Saved to Replays') + (path ? ` — ${path.split(/[\\/]/).pop()}` : ''));
  } catch {
    setStatus(t('rstudio.savefail') || 'Save failed.');
  }
}

// ── UI: a compact floating control bar ──
function setStatus(msg: string) {
  const s = bar?.querySelector('.rstudio-status') as HTMLElement | null;
  if (s) s.textContent = msg;
}
function renderBar() {
  if (!S || !bar) return;
  const rec = S.recording, paused = S.paused;
  const btn = (id: string, label: string, cls = '') => `<button class="rstudio-btn ${cls}" data-act="${id}">${label}</button>`;
  const presetSel = `
    <select class="rstudio-sel" data-act="preset" ${rec ? 'disabled' : ''}>
      <option value="fullscreen" ${S.preset === 'fullscreen' ? 'selected' : ''}>${t('rstudio.fullscreen') || 'Fullscreen'}</option>
      <option value="main" ${S.preset === 'main' ? 'selected' : ''}>${t('rstudio.main') || 'Main window (no Tasky bar)'}</option>
      <option value="custom" ${S.preset === 'custom' ? 'selected' : ''}>${t('rstudio.custom') || 'Custom frame'}</option>
    </select>`;
  let controls: string;
  if (!rec && S.events.length >= 2) {
    // review / export state
    const dur = (S.events[S.events.length - 1].timestamp - S.events[0].timestamp) / 1000;
    controls =
      `<span class="rstudio-status">${t('rstudio.done') || 'Recorded'} ${dur.toFixed(1)}s</span>` +
      `<label class="rstudio-trim">${t('rstudio.trimend') || 'Keep first'} <input type="number" class="rstudio-trim-in" min="1" step="1" value="${Math.ceil(dur)}"> s</label>` +
      btn('export', t('rstudio.export') || 'Export .bmmreplay', 'rstudio-primary') +
      btn('reset', t('rstudio.new') || 'New');
  } else if (!rec) {
    controls = presetSel + btn('start', '● ' + (t('rstudio.rec') || 'Record'), 'rstudio-primary') + `<span class="rstudio-status"></span>`;
  } else {
    controls =
      `<span class="rstudio-dot ${paused ? 'paused' : ''}"></span>` +
      (paused ? btn('resume', t('rstudio.resume') || 'Resume') : btn('pause', t('rstudio.pause') || 'Pause')) +
      btn('stop', '■ ' + (t('rstudio.stop') || 'Stop'), 'rstudio-primary') +
      `<span class="rstudio-status">${paused ? (t('rstudio.paused') || 'Paused — move the frame') : (t('rstudio.recording') || 'Recording…')}</span>`;
  }
  // "Hidden elements" row — pick app elements to exclude from the recording (the studios
  // themselves are always excluded). Available before AND during a recording; not shown in the
  // review/export state.
  const showHide = rec || S.events.length < 2;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const chips = S.hideSelectors.map((s) => `<span class="rstudio-chip" title="${esc(s)}">${esc(s)}<button data-act="unhide" data-sel="${esc(s)}" aria-label="remove">✕</button></span>`).join('');
  const studioToggle = `<label class="rstudio-showstudios" title="${t('rstudio.showstudios.tip') || 'Include the Replay/Animation Studio panels in the recording'}"><input type="checkbox" data-act="showstudios" ${S.showStudios ? 'checked' : ''} ${rec ? 'disabled' : ''}> ${t('rstudio.showstudios') || 'Show studios in rec'}</label>`;
  const hideRow = showHide
    ? `<div class="rstudio-hide"><span class="rstudio-hide-lbl">${t('rstudio.hidden') || 'Hidden'}:</span>${chips || `<span class="rstudio-hide-none">${t('rstudio.hidden.none') || 'nothing'}</span>`}<button class="rstudio-btn rstudio-mini ${S.picking ? 'rstudio-primary' : ''}" data-act="pick-hide">${S.picking ? (t('rstudio.pick.active') || 'Click one…') : '＋ ' + (t('rstudio.pick') || 'Hide element')}</button>${studioToggle}</div>`
    : '';
  bar.innerHTML = `<div class="rstudio-main"><div class="rstudio-title">${t('rstudio.title') || 'Replay Studio'}</div>${controls}<button class="rstudio-btn rstudio-x" data-act="close">✕</button></div>${hideRow}`;
}

function onBarClick(e: Event) {
  const el = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!el || !S) return;
  // Keep the click on the toolbar — never let it bubble to the app underneath.
  e.stopPropagation();
  const act = el.getAttribute('data-act');
  switch (act) {
    case 'start': studioStart(); break;
    case 'pause': studioPause(); break;
    case 'resume': studioResume(); break;
    case 'stop': studioStop(); break;
    case 'export': {
      const inp = bar?.querySelector('.rstudio-trim-in') as HTMLInputElement | null;
      const keep = inp ? parseFloat(inp.value) : NaN;
      studioExport(Number.isFinite(keep) ? keep * 1000 : undefined);
      break;
    }
    case 'reset': S.events = []; S.regions = []; S.pauses = []; renderBar(); break;
    case 'pick-hide': pickToHide(); break;
    case 'unhide': {
      const sel = el.getAttribute('data-sel');
      if (sel) { S.hideSelectors = S.hideSelectors.filter((x) => x !== sel); applyHideSelectors(); renderBar(); }
      break;
    }
    case 'close': closeReplayStudio(); break;
  }
}
function onBarChange(e: Event) {
  const el = e.target as HTMLElement;
  if (!S) return;
  const act = el.getAttribute('data-act');
  if (act === 'preset') {
    S.preset = (el as HTMLSelectElement).value as Preset;
    S.frame = presetRect(S.preset);
    renderFrame();
  } else if (act === 'showstudios') {
    // Only changeable before recording (the checkbox is disabled while recording).
    S.showStudios = (el as HTMLInputElement).checked;
  }
}

// Self-contained styles (injected once) so the studio doesn't depend on the build's CSS.
function ensureStyles() {
  if (document.getElementById('rstudio-styles')) return;
  const s = document.createElement('style');
  s.id = 'rstudio-styles';
  s.textContent = `
  .rstudio-bar{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147483647;
    isolation:isolate;pointer-events:auto;
    display:flex;flex-direction:column;gap:8px;padding:8px 10px;border-radius:14px;
    background:#161b22;color:#e6edf3;border:1px solid #2a2f3a;box-shadow:0 10px 40px rgba(0,0,0,.5);
    font:600 13px/1.2 system-ui,sans-serif;max-width:min(94vw,760px);}
  .rstudio-main{display:flex;align-items:center;gap:8px;}
  .rstudio-hide{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding-top:7px;border-top:1px solid #2a2f3a;}
  .rstudio-hide-lbl{font-weight:700;opacity:.7;font-size:11px;text-transform:uppercase;letter-spacing:.04em;}
  .rstudio-hide-none{opacity:.5;font-weight:500;font-size:12px;}
  .rstudio-showstudios{display:inline-flex;align-items:center;gap:6px;margin-left:auto;font-size:11.5px;font-weight:600;opacity:.85;cursor:pointer;white-space:nowrap;}
  .rstudio-showstudios input{cursor:pointer;}
  .rstudio-chip{display:inline-flex;align-items:center;gap:5px;background:#0d1117;border:1px solid #2a2f3a;border-radius:999px;
    padding:2px 4px 2px 9px;font:600 11px/1.4 ui-monospace,monospace;max-width:200px;}
  .rstudio-chip>span,.rstudio-chip{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .rstudio-chip button{border:0;background:#2a2f3a;color:#e6edf3;border-radius:50%;width:15px;height:15px;line-height:1;cursor:pointer;font-size:10px;flex-shrink:0;}
  .rstudio-chip button:hover{background:#ef4444;}
  .rstudio-mini{padding:4px 8px;font-size:12px;}
  .rstudio-title{font-weight:800;margin-right:2px;color:#3b82f6;display:flex;align-items:center;gap:6px;}
  .rstudio-btn{border:1px solid #2a2f3a;background:#0d1117;color:#e6edf3;border-radius:9px;
    padding:6px 10px;cursor:pointer;font:inherit;transition:background .12s,border-color .12s;}
  .rstudio-btn:hover{background:#1c2333;border-color:#3b82f6;}
  .rstudio-primary{background:#3b82f6;border-color:#3b82f6;color:#fff;}
  .rstudio-primary:hover{background:#2563eb;}
  .rstudio-x{padding:6px 9px;opacity:.7;}
  .rstudio-sel{background:#0d1117;color:#e6edf3;border:1px solid #2a2f3a;border-radius:9px;padding:6px 8px;font:inherit;}
  .rstudio-status{opacity:.8;font-weight:500;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .rstudio-trim{display:flex;align-items:center;gap:6px;font-weight:500;opacity:.9;}
  .rstudio-trim-in{width:56px;background:#0d1117;color:#e6edf3;border:1px solid #2a2f3a;border-radius:7px;padding:4px 6px;font:inherit;}
  .rstudio-dot{width:10px;height:10px;border-radius:50%;background:#ef4444;box-shadow:0 0 0 0 rgba(239,68,68,.6);animation:rstudio-pulse 1.4s infinite;}
  .rstudio-dot.paused{background:#f59e0b;animation:none;}
  @keyframes rstudio-pulse{0%{box-shadow:0 0 0 0 rgba(239,68,68,.6)}70%{box-shadow:0 0 0 8px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
  .rstudio-frame{position:fixed;z-index:2147482000;border:2px solid #3b82f6;border-radius:8px;
    box-shadow:0 0 0 100vmax rgba(0,0,0,.35);pointer-events:none;}
  .rstudio-frame-locked{box-shadow:0 0 0 2px rgba(59,130,246,.4);}
  .rstudio-frame-handle{position:absolute;right:-7px;bottom:-7px;width:14px;height:14px;border-radius:50%;
    background:#3b82f6;border:2px solid #fff;cursor:nwse-resize;}
  `;
  document.head.appendChild(s);
}

/** Open the Replay Studio control bar (called from the DevTools menu). */
export function openReplayStudio() {
  ensureStyles();
  if (bar) { bar.style.display = 'flex'; return; }
  S = { recording: false, paused: false, events: [], regions: [], pauses: [], startTs: 0, pauseStart: 0, preset: 'fullscreen', frame: presetRect('fullscreen'), hideSelectors: [], picking: false, showStudios: false };
  bar = document.createElement('div');
  bar.className = 'rstudio-bar bmm-no-record';
  bar.setAttribute('data-bmm-no-record', '1');
  bar.addEventListener('click', onBarClick);
  bar.addEventListener('change', onBarChange);
  document.body.appendChild(bar);
  renderBar();
}

export function closeReplayStudio() {
  if (S?.recording && listener) { unsubscribeReplay(listener); listener = null; }
  setExtraBlockSelectors([]);   // never leave studio-only block rules on the shared recorder
  markStudioRecordable(false);
  hideNoRecord(false);
  removeFrame();
  bar?.remove(); bar = null;
  S = null;
}
