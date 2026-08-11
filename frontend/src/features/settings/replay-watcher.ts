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

// The session is ALWAYS recorded in memory (and the latest is attached to a crash
// report). This toggle only controls whether each session is also SAVED to the
// persistent replay list. Default OFF = record-for-crashes only, never saved.
export const watcherEnabled = () => { try { return localStorage.getItem(ON) === '1'; } catch { return false; } };
export const watcherFull = () => { try { return localStorage.getItem(FULL) === '1'; } catch { return false; } };
const watcherRust = () => { try { return localStorage.getItem(RUST) !== '0'; } catch { return true; } };
const watcherJs = () => { try { return localStorage.getItem(JS) !== '0'; } catch { return true; } };

let _recording = false;
let _listener: ReplaySubscriber | null = null;

// ── The session is SPOOLED TO DISK, not held in memory ─────────────────────────
// It used to keep the whole rrweb stream in a rolling in-memory buffer and re-serialise
// all of it every 45s. Two things made that fatal: a single event is not a fixed size (a
// FullSnapshot serialises the entire DOM, and in "full" mode assets are inlined as base64
// data URLs, so one event can weigh megabytes), and JSON.stringify holds the source objects
// AND the resulting string at once, so the flush peak was roughly double the buffer. On a
// long idle session that took the webview out.
//
// Now each event is serialised on its own and appended to a spool file in the Rust core, and
// the .bmmreplay is assembled there by streaming the segments through a file handle. The
// frontend's peak is one small batch; the full document never exists in the webview at all.
// The rolling window still exists — it is just a file delete now (see replay_spool_trim).
let _spoolId: string | null = null;
let _seq = 0;                    // current segment; a new one starts at each rrweb checkout
let _prevWasCheckout = false;    // a checkout flags TWO events (Meta + FullSnapshot); split once
let _batch: string[] = [];       // serialised events waiting to be appended
let _batchBytes = 0;
let _spoolBytes = 0;             // total on disk, as reported by the last append
let _batchTimer: number | null = null;
// One IPC call per event would be far too chatty, so events are grouped — but only up to a
// small ceiling, which is the entire point: this is the largest thing the frontend ever holds.
const BATCH_BYTE_BUDGET = 512 * 1024;
const BATCH_MAX_EVENTS = 200;
const BATCH_FLUSH_MS = 3000;     // so a hard crash loses at most a few seconds
// The on-DISK rolling window. Much larger than the old memory budget could ever be, because
// it costs disk rather than the webview's heap.
const SPOOL_BYTE_BUDGET = 512 * 1024 * 1024;
// What the 45s crash flush assembles: the newest whole segments fitting in this, not the whole
// window. A crash report wants the minutes before the crash — and this file is rewritten every
// 45 seconds, so its size is a disk-write cost paid over and over.
const CRASH_TAIL_BYTES = 24 * 1024 * 1024;
// Console lines are capped by count (5000) but each can be 2000 chars, i.e. ~20 MB of UTF-16
// in the worst case — enough to matter next to the events. Cap the bytes too.
const CONSOLE_BYTE_BUDGET = 2 * 1024 * 1024;
let _consoleBytes = 0;
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
          _consoleBytes += msg.length * 2 + 32;
          while (_console.length > 5000 || (_consoleBytes > CONSOLE_BYTE_BUDGET && _console.length > 1)) {
            const gone = _console.shift();
            _consoleBytes -= (gone?.msg?.length || 0) * 2 + 32;
          }
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
    // Retention limits (shared with the Crash Reports manager).
    const keepEl = document.getElementById('watcher-keep') as HTMLInputElement | null;
    const mbEl = document.getElementById('watcher-maxmb') as HTMLInputElement | null;
    if (keepEl) keepEl.value = String(Math.max(1, parseInt(localStorage.getItem('bmm_session_keep_count') || '30', 10) || 30));
    if (mbEl) mbEl.value = String(Math.max(0, parseInt(localStorage.getItem('bmm_session_max_mb') || '2048', 10) || 2048));
    document.getElementById('watcher-applylimits')?.addEventListener('click', async () => {
      const keep = Math.max(1, parseInt(keepEl?.value || '30', 10) || 30);
      const mb = Math.max(0, parseInt(mbEl?.value || '2048', 10) || 2048);
      localStorage.setItem('bmm_session_keep_count', String(keep));
      localStorage.setItem('bmm_session_max_mb', String(mb));
      try { const n = await invoke('prune_sessions', { maxCount: keep, maxMb: mb }); toast(`${t('crashmgr.pruned') || 'Pruned'}: ${n}`, 'success'); } catch { /* ignore */ }
    });
  }
}

/** Hand the pending batch to the spool. Never throws — losing a batch must not take the
 *  recorder (or the app) down, and the next one will still land. */
async function flushBatch(): Promise<void> {
  if (!_spoolId || _batch.length === 0) return;
  const lines = _batch.join('\n');
  _batch = [];
  _batchBytes = 0;
  try {
    _spoolBytes = await invoke('replay_spool_append', { id: _spoolId, seq: _seq, lines }) as number;
    if (_spoolBytes > SPOOL_BYTE_BUDGET) {
      // Rolling window, on disk: drop whole oldest segments. Each starts with a full
      // snapshot, so what remains is always playable.
      _spoolBytes = await invoke('replay_spool_trim', { id: _spoolId, maxBytes: SPOOL_BYTE_BUDGET }) as number;
    }
  } catch { /* keep recording */ }
}

/** Start local recording (idempotent). */
export async function startWatcher(): Promise<void> {
  if (_recording) return;
  _recording = true;
  hookConsole();
  _console = [];
  _consoleBytes = 0;
  _startedAt = Date.now();
  _seq = 0;
  _batch = [];
  _batchBytes = 0;
  _spoolBytes = 0;
  try { _spoolId = await invoke('replay_spool_begin') as string; } catch { _spoolId = null; }

  _listener = ((ev: any, isCheckout: boolean) => {
    if (!_spoolId) return;
    // A checkout starts a new self-contained segment. Flush what belongs to the PREVIOUS one
    // first, or its tail would land in the new segment's file. flushBatch() reads _seq and
    // empties _batch synchronously before it awaits, so bumping _seq right after is safe:
    // the in-flight append still carries the old number, and the next event starts the new one.
    //
    // Only the FIRST event of a checkout may split. rrweb flags isCheckout on BOTH the Meta and
    // the FullSnapshot that open a checkout, so splitting on each one cut between them: every
    // other segment held a lone Meta event (~200 bytes) and the snapshot it belongs to started
    // the next file without it. On disk that showed up as a run of 0 MB segments.
    if (isCheckout && !_prevWasCheckout && _batch.length > 0) {
      void flushBatch();
      _seq++;
    }
    _prevWasCheckout = isCheckout;
    let line: string;
    // Serialise ONE event. This is the only stringify left on this path, and it is bounded
    // by the size of a single event rather than by the session.
    try { line = JSON.stringify(ev); } catch { return; }
    if (line.includes('\n')) line = line.replace(/\n/g, ' ');  // the spool is line-delimited
    _batch.push(line);
    _batchBytes += line.length;
    if (_batchBytes >= BATCH_BYTE_BUDGET || _batch.length >= BATCH_MAX_EVENTS) void flushBatch();
  }) as ReplaySubscriber;
  _listener.requiresMasking = !watcherFull();
  if (_batchTimer === null) _batchTimer = window.setInterval(() => { void flushBatch(); }, BATCH_FLUSH_MS);

  await subscribeReplay(_listener);
  registerCloseListeners();
  // Periodically flush the rolling buffer to disk so a hard crash (which kills
  // the frontend before any close handler runs) still leaves a recent session
  // that the crash report can attach. Silent = doesn't clutter the replay list.
  if (_autoSaveTimer === null) {
    _autoSaveTimer = window.setInterval(() => { flushSession('crash'); }, 45000);
    // Clean up the accumulated session backlog once at boot, per the user's limits.
    const keep = Math.max(1, parseInt(localStorage.getItem('bmm_session_keep_count') || '30', 10) || 30);
    const mb = Math.max(0, parseInt(localStorage.getItem('bmm_session_max_mb') || '2048', 10) || 2048);
    invoke('prune_sessions', { maxCount: keep, maxMb: mb }).catch(() => {});
  }
}

let _autoSaveTimer: number | null = null;

let _closeListenersRegistered = false;
function registerCloseListeners(): void {
  if (_closeListenersRegistered) return;
  _closeListenersRegistered = true;
  // On close: always refresh the crash buffer; persist a real replay to the list
  // only if the user enabled the Session recorder.
  const onClose = () => { flushSession('crash'); if (watcherEnabled()) flushSession('list'); };
  window.addEventListener('bmm-closing', onClose);
  try {
    const w = (window as any).__TAURI__;
    w?.event?.listen?.('tauri://close-requested', onClose);
  } catch {}
}

/** Assemble the spooled session into a .bmmreplay. The events never come back through the
 *  webview: only the small metadata/console fragments are passed down, and the core streams
 *  the event array straight from the spool segments into the output file.
 *  `destPath` writes to a file the user picked instead of the managed folders. */
async function writeBundle(mode: 'crash' | 'list', destPath?: string): Promise<string | null> {
  if (!_spoolId) return null;
  await flushBatch();                       // whatever is still pending belongs in this bundle
  const rustLog = watcherRust() ? (await invoke('read_session_log_tail', { maxBytes: 262144 }).catch(() => '') as string) : '';
  const metaJson = JSON.stringify({
    bmmReplay: 1, app: 'BetterModsManager', createdAt: new Date().toISOString(),
    masked: !watcherFull(), durationMs: Date.now() - _startedAt,
  });
  const consoleJson = JSON.stringify(watcherJs() ? _console : []);
  try {
    return await invoke('replay_spool_finalize', {
      id: _spoolId, metaJson, consoleJson, rustLog, mode, destPath: destPath || null,
      // The crash buffer is rewritten every 45s, so it takes a bounded TAIL rather than the whole
      // rolling window — otherwise each flush wrote the entire session to disk again, and a crash
      // report carried a file that grew towards the 512 MB window. Saving or exporting a replay
      // is a one-off, so it takes everything.
      tailBytes: mode === 'crash' ? CRASH_TAIL_BYTES : null,
    }) as string;
  } catch (e) {
    // "empty spool" is the normal answer before anything has been recorded.
    return null;
  }
}

/**
 * Write the spooled recording out.
 *  - 'crash': overwrite the single rolling crash buffer (NOT a saved replay). Done
 *    always, so a crash report can attach the session. Never shown in the list.
 *  - 'list':  save a real replay to the persistent list. Only when the user enabled
 *    the Session recorder.
 */
async function flushSession(mode: 'crash' | 'list'): Promise<void> {
  if (!_recording) return;
  try {
    const path = await writeBundle(mode);
    if (!path) return;
    if (mode === 'list') {
      addRecent(path);
      // Enforce the configurable retention (count + total size) after each save.
      const keep = Math.max(1, parseInt(localStorage.getItem('bmm_session_keep_count') || '30', 10) || 30);
      const mb = Math.max(0, parseInt(localStorage.getItem('bmm_session_max_mb') || '2048', 10) || 2048);
      invoke('prune_sessions', { maxCount: keep, maxMb: mb }).catch(() => {});
    }
  } catch (e) { console.error('Session flush failed:', e); }
}

/** Back-compat: manual "save to list now". */
export async function autoSaveSession(): Promise<void> { await flushSession('list'); }

/** Stop local recording (keeps the buffer for export). */
export function stopWatcher(): void {
  if (_autoSaveTimer !== null) { clearInterval(_autoSaveTimer); _autoSaveTimer = null; }
  if (_batchTimer !== null) { clearInterval(_batchTimer); _batchTimer = null; }
  void flushBatch();   // the spool keeps the session, so export still works after stopping
  if (_recording) {
    _recording = false;
    if (_listener) unsubscribeReplay(_listener);
    _listener = null;
  }
}

/**
 * Recording is ALWAYS on (for crash diagnostics) — so this always starts it. The
 * `bmm_watcher_on` toggle no longer gates recording; it only controls whether each
 * session is *persisted to the replay list* (handled on close / by the editor).
 */
export async function syncWatcher(): Promise<void> {
  await startWatcher();
}

/** Export the current recording (rrweb + console + Rust log) to a .bmmreplay file.
 *  Streams out of the spool straight into the chosen file — the bundle is never built in
 *  the webview, so exporting a long session costs no more memory than a short one. */
export async function exportSession(): Promise<void> {
  if (!_spoolId) { toast(t('watcher.nothing') || 'Rien à exporter pour le moment', 'info'); return; }
  const path = await saveFile({ defaultPath: `bmm-session-${Date.now()}.bmmreplay`, filters: [{ name: 'BMM Replay', extensions: ['bmmreplay', 'json'] }] }).catch(() => null);
  if (!path) return;
  try {
    const written = await writeBundle('list', path);
    if (!written) { toast(t('watcher.nothing') || 'Rien à exporter pour le moment', 'info'); return; }
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
    const url = (window as any).__TAURI__.core.convertFileSrc(path);
    const res = await fetch(url);
    bundle = await res.json();
  }
  catch { toast(t('watcher.badFile') || 'Fichier illisible', 'error'); return; }
  if (!Array.isArray(bundle?.events) || bundle.events.length < 2) { toast(t('watcher.empty') || 'Enregistrement vide', 'error'); return; }
  addRecent(path);
  await playBundle(bundle);
}

/** Play a .bmmreplay fetched from a URL — used by :::replay embeds in rendered markdown
 *  (release/update notes + the in-app Community blog). Reuses the full in-app viewer. */
export async function playReplayFromUrl(url: string): Promise<void> {
  let bundle: any;
  try { const res = await fetch(url); if (!res.ok) throw new Error('http'); bundle = await res.json(); }
  catch { toast(t('watcher.badFile') || 'Fichier illisible', 'error'); return; }
  const events = Array.isArray(bundle) ? bundle : bundle?.events;
  if (!Array.isArray(events) || events.length < 2) { toast(t('watcher.empty') || 'Empty recording', 'error'); return; }
  await playBundle(Array.isArray(bundle) ? { events } : bundle);
}

/** Pick a .bmmreplay file and replay it in an in-app viewer. */
export async function importAndPlay(): Promise<void> {
  const src = await pickFile({ filters: [{ name: 'BMM Replay', extensions: ['bmmreplay', 'json'] }] }).catch(() => null);
  if (!src) return;
  await loadAndPlay(src);
}

/** Programmatically set the local recorder options (used by the API + deep links). */
export async function setWatcherOptions(opts: { on?: boolean; full?: boolean; rust?: boolean; js?: boolean }): Promise<void> {
  if (opts.on !== undefined) localStorage.setItem(ON, opts.on ? '1' : '0');
  if (opts.full !== undefined) localStorage.setItem(FULL, opts.full ? '1' : '0');
  if (opts.rust !== undefined) localStorage.setItem(RUST, opts.rust ? '1' : '0');
  if (opts.js !== undefined) localStorage.setItem(JS, opts.js ? '1' : '0');
  // reflect into the settings card toggles if they're mounted
  const set = (id: string, v?: boolean) => { const el = document.getElementById(id) as HTMLInputElement | null; if (el && v !== undefined) el.checked = v; };
  set('watcher-toggle', opts.on); set('watcher-full-toggle', opts.full); set('watcher-rust-toggle', opts.rust); set('watcher-js-toggle', opts.js);
  stopWatcher();
  await syncWatcher();   // re-arm with the new settings (or stop if turned off)
}

/** Import + replay a .bmmreplay from an absolute file path (API / deep link). */
export async function importReplayFromPath(path: string): Promise<void> { await loadAndPlay(path); }

/** Replay a session directly from its JSON (e.g. one extracted from a crash zip). */
export async function playReplayJson(json: string): Promise<void> {
  let bundle: any;
  try { bundle = JSON.parse(json); } catch { toast(t('watcher.badFile') || 'Unreadable file', 'error'); return; }
  if (!Array.isArray(bundle?.events) || bundle.events.length < 2) { toast(t('watcher.empty') || 'Empty recording', 'error'); return; }
  await playBundle(bundle);
}

/** Import + replay a .bmmreplay from a download URL (API / deep link). */
export async function importReplayFromUrl(url: string): Promise<void> {
  let bundle: any;
  try { const res = await fetch(url); bundle = await res.json(); }
  catch { toast(t('watcher.badFile') || 'Fichier illisible', 'error'); return; }
  if (!Array.isArray(bundle?.events) || bundle.events.length < 2) { toast(t('watcher.empty') || 'Enregistrement vide', 'error'); return; }
  await playBundle(bundle);
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
        <button class="rw-del" data-i="${i}" style="color:var(--danger,#ef4444);font-size:16px;background:none;border:none;cursor:pointer;padding:4px;opacity:0.8;transition:opacity 0.2s" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'" data-tooltip="${t('common.delete') || 'Supprimer'}">✖</button>
      </div>`).join('')
    : `<div style="font-size:13px;color:var(--text-muted,#8a8f98);padding:16px;text-align:center">${t('watcher.noImports') || "Aucun replay récent pour l'instant."}</div>`;
  overlay.innerHTML = `
    <div style="width:min(580px,92vw);max-height:80vh;background:#13151a;border:1px solid var(--border,#2a2d34);border-radius:16px;box-shadow:0 20px 40px rgba(0,0,0,0.4);display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;align-items:center;gap:16px;padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.06)">
        <strong style="font-size:16px;font-weight:700;color:var(--bmm-text-primary)">${t('watcher.listTitle') || 'Imported replays'}</strong><span style="flex:1"></span>
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
        <button id="rw-video" class="btn btn-sm">${t('watcher.tovideo') || 'Exporter en vidéo'}</button>
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
  host.innerHTML = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--bmm-text-muted);font-size:13px;gap:10px"><span style="width:16px;height:16px;border:2px solid #5b8cff;border-top-color:transparent;border-radius:50%;display:inline-block;animation:rwspin .8s linear infinite"></span>${t('watcher.loading') || 'Chargement du replay…'}</div><style>@keyframes rwspin{to{transform:rotate(360deg)}}</style>`;
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  host.innerHTML = '';
  const rep = new rrweb.Replayer(bundle.events, { root: host, speed: 1, skipInactive: true, showWarning: false, mouseTail: { strokeStyle: '#5b8cff' } });
  const m4 = bundle.events.find((e: any) => e.type === 4);
  const recW = m4?.data?.width || 1280;
  const recH = m4?.data?.height || 800;
  // A Replay-Studio recording can carry a `regions` timeline (the moving capture frame).
  // When present we crop the host to the active region and follow it; the host's overflow
  // clips the rest. No regions → the whole recording, centered, exactly as before.
  const regs: any[] = (Array.isArray(bundle.regions) ? bundle.regions : []).filter((r: any) => r && r.rect && r.rect.w).sort((a: any, b: any) => a.t - b.t);
  const hasRegions = regs.length > 0;
  if (hasRegions) host.style.overflow = 'hidden';
  const rectAt = (ms: number) => { let r = { x: 0, y: 0, w: recW, h: recH }; for (const k of regs) { if (k.t <= ms) r = k.rect; else break; } return r; };
  const fit = (ms?: number) => {
    const wrap = (rep as any).wrapper as HTMLElement | undefined;
    const w = host.clientWidth, h = host.clientHeight;
    if (!wrap || !w || !h) return;
    const rect = hasRegions ? rectAt(ms ?? rep.getCurrentTime()) : { x: 0, y: 0, w: recW, h: recH };
    // Contain the (region or full) box inside the host, centered; position so the box's
    // top-left lands at the centre offset — the host clips anything outside it.
    const s = Math.min(w / rect.w, h / rect.h);
    const offX = Math.max(0, (w - rect.w * s) / 2);
    const offY = Math.max(0, (h - rect.h * s) / 2);
    wrap.style.position = 'absolute';
    wrap.style.transformOrigin = 'top left';
    wrap.style.transform = `scale(${s})`;
    wrap.style.left = `${offX - rect.x * s}px`;
    wrap.style.top = `${offY - rect.y * s}px`;
    if (hasRegions) wrap.style.transition = 'left .35s ease, top .35s ease, transform .35s ease';
  };
  const md = rep.getMetaData();
  const startAbs = md.startTime;
  const total = md.totalTime || 1;
  const onResize = () => fit();
  rep.play();
  setTimeout(onResize, 60);
  window.addEventListener('resize', onResize);

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
  let raf = 0; let lastHi = -1; let lastRegionIdx = -2;
  const tick = () => {
    const cur = Math.min(rep.getCurrentTime(), total);
    seek.value = String(Math.round((cur / total) * 1000));
    timeEl.textContent = `${mmss(cur)} / ${mmss(total)}`;
    // Follow the capture frame — re-fit only when the active region changes so the CSS
    // transition animates the pan/zoom instead of thrashing layout every frame.
    if (hasRegions) { let i = -1; for (let k = 0; k < regs.length; k++) { if (regs[k].t <= cur) i = k; else break; } if (i !== lastRegionIdx) { lastRegionIdx = i; fit(cur); } }
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
  const close = () => {
    // Closing mid-export must end the capture, or the screen keeps being recorded after the
    // window that started it is gone — with nothing left on screen to stop it.
    if (exportTimer !== null) { window.clearTimeout(exportTimer); exportTimer = null; }
    void import('../debug/video-capture.js').then((cap) => { if (cap.isCapturing()) return cap.stopCapture(); }).catch(() => {});
    try { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); rep.pause(); (rep as any).destroy?.(); } catch { /* ignore */ }
    overlay.remove();
  };
  (overlay.querySelector('#rw-close') as HTMLElement).onclick = close;

  // ── Export the replay as a video ──────────────────────────────────────────────────
  //
  // This plays the recording and captures the result, rather than converting the file.
  // rrweb ships `rrvideo` for exactly this, and it works the same way underneath — open the
  // replay in a browser, play it, record the frames — but it does so with Puppeteer (its own
  // ~150 MB Chromium) plus ffmpeg. BMM already IS a Chromium, and already has the player you
  // are looking at, so pulling in that toolchain would ship two more browsers to do what this
  // window can do now.
  //
  // A .bmmreplay is a DOM mutation log, not pictures, so SOMETHING has to render it either
  // way. The only question is which renderer, and the one on screen is already correct —
  // right fonts, right theme, right region cropping.
  const videoBtn = overlay.querySelector('#rw-video') as HTMLButtonElement;
  let exporting = false;
  // Held so close() can cancel it. Without that, closing mid-export leaves a timer that
  // fires into a dead overlay, calls stopCapture() a second time (the first already saved
  // the file), gets null back and reports "no frames" — an error on a successful export.
  let exportTimer: number | null = null;
  videoBtn.onclick = async () => {
    if (exporting) return;
    const cap = await import('../debug/video-capture.js');
    const support = cap.captureSupport();
    if (!support.ok) {
      toast(support.reason === 'no-encoder'
        ? (t('watcher.vnoenc') || 'Ce build n’a pas d’encodeur vidéo (MediaRecorder).')
        : (t('watcher.vnodisp') || 'Ce build ne peut pas capturer l’écran (getDisplayMedia).'), 'error');
      return;
    }
    try {
      await cap.startCapture({ fps: 30 });
    } catch (e: any) {
      const why = String(e?.message || e);
      toast(why === 'cancelled' ? (t('watcher.vcancel') || 'Capture annulée.') : (t('watcher.vfail') || 'Impossible de démarrer la capture.'), why === 'cancelled' ? 'info' : 'error');
      return;
    }
    exporting = true;
    videoBtn.disabled = true;
    videoBtn.textContent = t('watcher.vrec') || '● Enregistrement…';

    // Restart from the beginning so the clip is the WHOLE replay, wherever the scrubber
    // happened to be. Then stop on the recording's own duration rather than on a Replayer
    // event: `finish` does not fire when the last event is a mutation with nothing after it,
    // and a clip that never stops is worse than one that ends a beat late.
    rep.play(0);
    playing = true;
    playBtn.textContent = '⏸';
    const tail = 400;   // let the final frame land before cutting
    exportTimer = window.setTimeout(async () => {
      exportTimer = null;
      try {
        const r = await cap.stopCapture();
        if (!r?.path) toast(t('watcher.vempty') || 'La capture n’a produit aucune image.', 'error');
        else toast(`${t('watcher.vsaved') || 'Vidéo enregistrée'} — ${r.path.split(/[\/]/).pop()}`, 'success');
      } catch {
        toast(t('watcher.vsavefail') || 'L’enregistrement de la vidéo a échoué.', 'error');
      }
      exporting = false;
      videoBtn.disabled = false;
      videoBtn.textContent = t('watcher.tovideo') || 'Exporter en vidéo';
    }, total + tail);
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
