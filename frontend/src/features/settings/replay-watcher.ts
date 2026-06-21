// Local "replay watcher" — a user-controlled session recorder, separate from
// the telemetry pipeline. It captures the rrweb DOM actions (full or masked),
// the JS console output and the Rust session log, then lets the user EXPORT the
// bundle to a .bmmreplay file and IMPORT one back to replay + analyse it in-app.
//
// Nothing leaves the machine unless the user exports a file themselves.

import { invoke, saveFile, pickFile } from '../../core/api.js';
import { subscribeReplay, unsubscribeReplay, ReplaySubscriber, loadRrweb } from '../../core/replay-recorder.js';
import { t } from '../../core/i18n.js';
import { toast } from '../../ui/app.js';

const ON = 'bmm_watcher_on';
const FULL = 'bmm_watcher_full';
const RUST = 'bmm_watcher_rust';
const JS = 'bmm_watcher_js';

export const watcherEnabled = () => { try { return localStorage.getItem(ON) === '1'; } catch { return false; } };
export const watcherFull = () => { try { return localStorage.getItem(FULL) === '1'; } catch { return false; } };
const watcherRust = () => { try { return localStorage.getItem(RUST) !== '0'; } catch { return true; } };
const watcherJs = () => { try { return localStorage.getItem(JS) !== '0'; } catch { return true; } };

let _recording = false;
let _listener: ReplaySubscriber | null = null;
let _chunks: any[][] = [];
let _console: { t: number; level: string; msg: string }[] = [];
let _startedAt = 0;
let _consoleHooked = false;
const _orig: Record<string, any> = {};

function hookConsole(): void {
  if (_consoleHooked) return;
  _consoleHooked = true;
  (['log', 'info', 'warn', 'error'] as const).forEach((level) => {
    _orig[level] = (console as any)[level].bind(console);
    (console as any)[level] = (...args: any[]) => {
      try {
        if (_recording && watcherJs()) {
          const msg = args.map((a) => { try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); } }).join(' ').slice(0, 2000);
          _console.push({ t: Date.now(), level, msg });
          if (_console.length > 5000) _console.shift();
        }
      } catch { /* ignore */ }
      _orig[level](...args);
    };
  });
}

/** Wire the settings card controls + reflect saved state. Called once at startup. */
export function initWatcherUI(): void {
  const on = document.getElementById('watcher-toggle') as HTMLInputElement | null;
  const full = document.getElementById('watcher-full-toggle') as HTMLInputElement | null;
  const rust = document.getElementById('watcher-rust-toggle') as HTMLInputElement | null;
  const js = document.getElementById('watcher-js-toggle') as HTMLInputElement | null;
  if (on && !(on as any).dataset.wired) {
    (on as any).dataset.wired = '1';
    on.checked = watcherEnabled();
    if (full) full.checked = watcherFull();
    if (rust) rust.checked = watcherRust();
    if (js) js.checked = watcherJs();
    on.addEventListener('change', () => { localStorage.setItem(ON, on.checked ? '1' : '0'); syncWatcher(); });
    full?.addEventListener('change', async () => {
      localStorage.setItem(FULL, full.checked ? '1' : '0');
      if (_recording) { stopWatcher(); await startWatcher(); }   // re-arm with new masking
    });
    rust?.addEventListener('change', () => localStorage.setItem(RUST, rust.checked ? '1' : '0'));
    js?.addEventListener('change', () => localStorage.setItem(JS, js.checked ? '1' : '0'));
    document.getElementById('watcher-export')?.addEventListener('click', () => exportSession());
    document.getElementById('watcher-import')?.addEventListener('click', () => importAndPlay());
    document.getElementById('watcher-list')?.addEventListener('click', () => openReplayList());
  }
}

/** Start local recording (idempotent). */
export async function startWatcher(): Promise<void> {
  if (_recording) return;
  _recording = true;
  hookConsole();
  _chunks = [[]];
  _console = [];
  _startedAt = Date.now();
  
  _listener = ((ev: any, isCheckout: boolean) => {
    if (isCheckout && _chunks[_chunks.length - 1].length > 0) {
      _chunks.push([]);
    }
    _chunks[_chunks.length - 1].push(ev);
    if (_chunks.length > 3) _chunks.shift(); // keep max ~6 minutes
  }) as ReplaySubscriber;
  _listener.requiresMasking = !watcherFull();

  await subscribeReplay(_listener);
  registerCloseListeners();
}

let _closeListenersRegistered = false;
function registerCloseListeners(): void {
  if (_closeListenersRegistered) return;
  _closeListenersRegistered = true;
  window.addEventListener('bmm-closing', () => { autoSaveSession(); });
  try {
    const w = (window as any).__TAURI__;
    w?.event?.listen?.('tauri://close-requested', () => { autoSaveSession(); });
  } catch {}
}

/** Automatically save the current session without prompting (e.g. on close). */
export async function autoSaveSession(): Promise<void> {
  if (!_recording) return; // Not recording
  const events = _chunks.flat();
  if (events.length < 2) return;
  try {
    const rustLog = watcherRust() ? (await invoke('read_session_log_tail', { maxBytes: 262144 }).catch(() => '') as string) : '';
    const bundle = {
      bmmReplay: 1,
      app: 'BetterModsManager',
      createdAt: new Date().toISOString(),
      masked: !watcherFull(),
      durationMs: Date.now() - _startedAt,
      events,
      console: watcherJs() ? _console : [],
      rustLog,
    };
    const path = await invoke('save_local_replay', { content: JSON.stringify(bundle) }) as string;
    addRecent(path);
  } catch (e) {
    console.error('Auto-save replay failed:', e);
  }
}

/** Stop local recording (keeps the buffer for export). */
export function stopWatcher(): void {
  if (_recording) {
    _recording = false;
    if (_listener) unsubscribeReplay(_listener);
    _listener = null;
  }
}

/** Apply the on/off setting: start or stop accordingly. */
export async function syncWatcher(): Promise<void> {
  if (watcherEnabled()) await startWatcher();
  else stopWatcher();
}

/** Export the current recording (rrweb + console + Rust log) to a .bmmreplay file. */
export async function exportSession(): Promise<void> {
  const events = _chunks.flat();
  if (events.length < 2) { toast(t('watcher.nothing') || 'Rien à exporter pour le moment', 'info'); return; }
  const rustLog = watcherRust() ? (await invoke('read_session_log_tail', { maxBytes: 262144 }).catch(() => '') as string) : '';
  const bundle = {
    bmmReplay: 1,
    app: 'BetterModsManager',
    createdAt: new Date().toISOString(),
    masked: !watcherFull(),
    durationMs: Date.now() - _startedAt,
    events,
    console: watcherJs() ? _console : [],
    rustLog,
  };
  const path = await saveFile({ defaultPath: `bmm-session-${Date.now()}.bmmreplay`, filters: [{ name: 'BMM Replay', extensions: ['bmmreplay', 'json'] }] }).catch(() => null);
  if (!path) return;
  try {
    await invoke('write_text_file', { path, content: JSON.stringify(bundle) });
    toast(t('watcher.exported') || 'Session exportée', 'success');
  } catch (e) { toast((t('watcher.exportFail') || 'Export échoué') + ': ' + e, 'error'); }
}

// Recently imported bundles (path + name), so the list modal can re-open them.
const RECENTS = 'bmm_watcher_imports';
type Recent = { path: string; name: string; at: number };
function getRecents(): Recent[] { try { return JSON.parse(localStorage.getItem(RECENTS) || '[]'); } catch { return []; } }
function addRecent(path: string): void {
  const name = (path.split(/[\\/]/).pop() || path);
  const list = getRecents().filter((r) => r.path !== path);
  list.unshift({ path, name, at: Date.now() });
  localStorage.setItem(RECENTS, JSON.stringify(list.slice(0, 30)));
}

async function loadAndPlay(path: string): Promise<void> {
  let bundle: any;
  try { 
    const url = (window as any).__TAURI__.tauri.convertFileSrc(path);
    const res = await fetch(url);
    bundle = await res.json();
  }
  catch { toast(t('watcher.badFile') || 'Fichier illisible', 'error'); return; }
  if (!Array.isArray(bundle?.events) || bundle.events.length < 2) { toast(t('watcher.empty') || 'Enregistrement vide', 'error'); return; }
  addRecent(path);
  await playBundle(bundle);
}

/** Pick a .bmmreplay file and replay it in an in-app viewer. */
export async function importAndPlay(): Promise<void> {
  const src = await pickFile({ filters: [{ name: 'BMM Replay', extensions: ['bmmreplay', 'json'] }] }).catch(() => null);
  if (!src) return;
  await loadAndPlay(src);
}

/** Modal listing recently imported replays — click one to watch it. */
export function openReplayList(): void {
  const recents = getRecents();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)';
  const rows = recents.length
    ? recents.map((r, i) => `<div style="display:flex;gap:12px;align-items:center;width:100%;padding:14px 18px;border:1px solid var(--border,#2a2d34);border-radius:12px;background:rgba(255,255,255,.015);transition:background 0.2s" onmouseover="this.style.background='rgba(255,255,255,.04)'" onmouseout="this.style.background='rgba(255,255,255,.015)'">
        <button class="rw-pick" data-i="${i}" style="flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:4px;text-align:left;background:none;border:none;cursor:pointer;padding:0">
          <span style="font-size:14px;font-weight:600;color:var(--text-primary,#e2e8f0)">${r.name}</span>
          <span style="font-size:12px;color:var(--text-muted,#8a8f98)">${new Date(r.at).toLocaleString()}</span>
        </button>
        <button class="rw-del" data-i="${i}" style="color:var(--danger,#ef4444);font-size:16px;background:none;border:none;cursor:pointer;padding:4px;opacity:0.8;transition:opacity 0.2s" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'" title="${t('common.delete') || 'Supprimer'}">✖</button>
      </div>`).join('')
    : `<div style="font-size:13px;color:var(--text-muted,#8a8f98);padding:16px;text-align:center">${t('watcher.noImports') || "Aucun replay récent pour l'instant."}</div>`;
  overlay.innerHTML = `
    <div style="width:min(580px,92vw);max-height:80vh;background:#13151a;border:1px solid var(--border,#2a2d34);border-radius:16px;box-shadow:0 20px 40px rgba(0,0,0,0.4);display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;align-items:center;gap:16px;padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.06)">
        <strong style="font-size:16px;font-weight:700;color:#fff">${t('watcher.listTitle') || 'Imported replays'}</strong><span style="flex:1"></span>
        <button id="rw-list-pick" style="background:#e2e8f0;color:#0f1115;border:none;border-radius:20px;padding:6px 16px;font-size:13px;font-weight:600;cursor:pointer;transition:transform 0.1s" onmousedown="this.style.transform='scale(0.96)'" onmouseup="this.style.transform='none'">${t('watcher.import') || 'Import & replay'}</button>
        <button id="rw-list-close" style="background:none;border:none;color:var(--text-muted,#8a8f98);font-size:14px;font-weight:600;cursor:pointer;padding:6px 8px;transition:color 0.2s" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='var(--text-muted,#8a8f98)'">${t('common.close') || 'Close'}</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;padding:20px 24px;overflow-y:auto">${rows}</div>
    </div>`;
  (document.getElementById('app-window-outer') || document.body).appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  (overlay.querySelector('#rw-list-close') as HTMLElement).onclick = () => overlay.remove();
  (overlay.querySelector('#rw-list-pick') as HTMLElement).onclick = () => { overlay.remove(); importAndPlay(); };
  
  overlay.querySelectorAll('.rw-pick').forEach((b) => ((b as HTMLElement).onclick = () => {
    const r = recents[Number((b as HTMLElement).dataset.i)];
    overlay.remove();
    if (r) loadAndPlay(r.path);
  }));

  overlay.querySelectorAll('.rw-del').forEach((b) => ((b as HTMLElement).onclick = async (e) => {
    e.stopPropagation();
    const idx = Number((b as HTMLElement).dataset.i);
    const r = recents[idx];
    if (r) {
      try { await invoke('delete_local_replay', { path: r.path }); } catch (err) { console.warn(err); }
      const newList = recents.filter((_, i) => i !== idx);
      localStorage.setItem(RECENTS, JSON.stringify(newList));
    }
    overlay.remove();
    openReplayList();
  }));
}

// ── In-app replay viewer (rrweb Replayer in a modal) ───────────────────────────
async function playBundle(bundle: any): Promise<void> {
  const rrweb = await loadRrweb().catch(() => null);
  if (!rrweb?.Replayer) { toast(t('watcher.rrwebFail') || 'Lecteur indisponible', 'error'); return; }
  // rrweb replay stylesheet (cursor / mouse-tail) — inject once.
  if (!document.getElementById('rrweb-replay-css')) {
    const link = document.createElement('link');
    link.id = 'rrweb-replay-css';
    link.rel = 'stylesheet';
    link.href = 'assets/vendor/rrweb.min.css';
    document.head.appendChild(link);
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.setAttribute('data-prevent-close', 'true');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6)';
  const meta = `${bundle.masked ? (t('watcher.masked') || 'masqué') : 'full'} · ${Math.round((bundle.durationMs || 0) / 1000)}s`;
  overlay.innerHTML = `
    <div style="width:min(1120px,95vw);height:min(88vh,840px);background:var(--bg-secondary,#15171c);border:1px solid var(--border,#2a2d34);border-radius:14px;display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border,#2a2d34)">
        <strong style="font-size:13px">${t('watcher.viewerTitle') || 'Lecture de session'}</strong>
        <span style="font-size:11px;color:var(--text-muted,#8a8f98)">${meta}</span>
        <span style="flex:1"></span>
        <button id="rw-close" class="btn btn-sm btn-ghost">${t('common.close') || 'Fermer'}</button>
      </div>
      <div style="flex:1;display:flex;min-height:0">
        <div id="rw-host" style="flex:1;overflow:hidden;background:#000;position:relative"></div>
        <div id="rw-logs" style="width:320px;border-left:1px solid var(--border,#2a2d34);overflow:auto;font-family:var(--font-mono,monospace);font-size:10.5px;padding:8px;color:var(--text-secondary,#c9ccd1)"></div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-top:1px solid var(--border,#2a2d34)">
        <button id="rw-play" class="btn btn-sm" style="width:34px">⏸</button>
        <div style="position:relative;flex:1">
          <div id="rw-marks" style="position:relative;height:10px;margin-bottom:2px"></div>
          <input id="rw-seek" type="range" min="0" max="1000" value="0" style="width:100%;accent-color:var(--accent,#5b8cff)" />
        </div>
        <span id="rw-time" style="font-size:11px;color:var(--text-muted,#8a8f98);font-family:var(--font-mono,monospace);white-space:nowrap">0:00 / 0:00</span>
      </div>
    </div>`;
  (document.getElementById('app-window-outer') || document.body).appendChild(overlay);

  const host = overlay.querySelector('#rw-host') as HTMLElement;
  // Building the Replayer over a big event stream is a heavy synchronous DOM
  // rebuild that freezes the UI. Show a loading hint and let the modal paint
  // (double rAF) BEFORE the build, so the user sees feedback instead of a freeze.
  host.innerHTML = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#8a8f98;font-size:13px;gap:10px"><span style="width:16px;height:16px;border:2px solid #5b8cff;border-top-color:transparent;border-radius:50%;display:inline-block;animation:rwspin .8s linear infinite"></span>${t('watcher.loading') || 'Chargement du replay…'}</div><style>@keyframes rwspin{to{transform:rotate(360deg)}}</style>`;
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  host.innerHTML = '';
  const rep = new rrweb.Replayer(bundle.events, { root: host, speed: 1, skipInactive: true, showWarning: false, mouseTail: { strokeStyle: '#5b8cff' } });
  const fit = () => {
    const wrap = (rep as any).wrapper as HTMLElement | undefined;
    const m4 = bundle.events.find((e: any) => e.type === 4);
    const recW = m4?.data?.width || 1280;
    const recH = m4?.data?.height || 800;
    const w = host.clientWidth, h = host.clientHeight;
    if (!wrap || !w || !h) return;
    // Contain inside the host (fit both axes), centered — no dead space on a side.
    const s = Math.min(w / recW, h / recH);
    wrap.style.position = 'absolute';
    wrap.style.transformOrigin = 'top left';
    wrap.style.transform = `scale(${s})`;
    wrap.style.left = `${Math.max(0, (w - recW * s) / 2)}px`;
    wrap.style.top = `${Math.max(0, (h - recH * s) / 2)}px`;
  };
  const md = rep.getMetaData();
  const startAbs = md.startTime;
  const total = md.totalTime || 1;
  rep.play();
  setTimeout(fit, 60);
  window.addEventListener('resize', fit);

  const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  // Event markers above the scrubber: clicks + navigation derived from rrweb.
  const marks = overlay.querySelector('#rw-marks') as HTMLElement;
  for (const ev of bundle.events as any[]) {
    let kind = ''; let color = '#5b8cff';
    if (ev.type === 3 && ev.data?.source === 2 && [2, 4, 6].includes(ev.data?.type)) { kind = 'click'; color = '#37d399'; }
    else if (ev.type === 4) { kind = 'nav'; color = '#a78bfa'; }
    if (!kind) continue;
    const off = ev.timestamp - startAbs;
    if (off < 0 || off > total) continue;
    const dot = document.createElement('button');
    dot.title = `${mmss(off)} · ${kind}`;
    dot.style.cssText = `position:absolute;top:50%;transform:translate(-50%,-50%);width:6px;height:6px;border-radius:50%;border:0;cursor:pointer;background:${color};left:${(off / total) * 100}%`;
    dot.onclick = () => { rep.play(off); };
    marks.appendChild(dot);
  }

  // Logs panel (JS console + Rust), highlighted live as the replay plays.
  const logsEl = overlay.querySelector('#rw-logs') as HTMLElement;
  const jsLogs: { t: number; level: string; msg: string }[] = bundle.console || [];
  const jsHtml = jsLogs.length
    ? jsLogs.map((l, i) => `<div class="rw-log" data-i="${i}" style="padding:2px 4px;border-radius:4px;white-space:pre-wrap">[${new Date(l.t).toLocaleTimeString()}] <b>${(l.level || '').toUpperCase()}</b> ${escapeHtml(l.msg)}</div>`).join('')
    : '<div style="color:var(--text-muted,#8a8f98)">(no JS logs)</div>';
  logsEl.innerHTML = `<div id="rw-js">${jsHtml}</div>${bundle.rustLog ? `<div style="margin-top:10px;color:var(--text-muted,#8a8f98)">──── RUST LOG ────</div><pre style="white-space:pre-wrap;margin:4px 0 0">${escapeHtml(bundle.rustLog)}</pre>` : ''}`;
  const logEls = Array.from(logsEl.querySelectorAll('.rw-log')) as HTMLElement[];

  const seek = overlay.querySelector('#rw-seek') as HTMLInputElement;
  const timeEl = overlay.querySelector('#rw-time') as HTMLElement;
  let raf = 0; let lastHi = -1;
  const tick = () => {
    const cur = Math.min(rep.getCurrentTime(), total);
    seek.value = String(Math.round((cur / total) * 1000));
    timeEl.textContent = `${mmss(cur)} / ${mmss(total)}`;
    // highlight the latest JS log at/before the current absolute time
    const absNow = startAbs + cur;
    let hi = -1;
    for (let i = 0; i < jsLogs.length; i++) { if (jsLogs[i].t <= absNow) hi = i; else break; }
    if (hi !== lastHi) {
      if (logEls[lastHi]) logEls[lastHi].style.background = '';
      if (logEls[hi]) { logEls[hi].style.background = 'rgba(91,140,255,.18)'; logEls[hi].scrollIntoView({ block: 'nearest' }); }
      lastHi = hi;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  seek.oninput = () => { rep.play((Number(seek.value) / 1000) * total); };

  let playing = true;
  const playBtn = overlay.querySelector('#rw-play') as HTMLButtonElement;
  playBtn.onclick = () => { playing = !playing; if (playing) { rep.play(rep.getCurrentTime()); playBtn.textContent = '⏸'; } else { rep.pause(); playBtn.textContent = '▶'; } };
  const close = () => { try { cancelAnimationFrame(raf); window.removeEventListener('resize', fit); rep.pause(); (rep as any).destroy?.(); } catch { /* ignore */ } overlay.remove(); };
  (overlay.querySelector('#rw-close') as HTMLElement).onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
