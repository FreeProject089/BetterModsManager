// Local "replay watcher" — a user-controlled session recorder, separate from
// the telemetry pipeline. It captures the rrweb DOM actions (full or masked),
// the JS console output and the Rust session log, then lets the user EXPORT the
// bundle to a .bmmreplay file and IMPORT one back to replay + analyse it in-app.
//
// Nothing leaves the machine unless the user exports a file themselves.

import { invoke, saveFile, pickFile } from '../../core/api.js';
import { loadRrweb, SENSITIVE_SELECTOR } from '../../core/replay-recorder.js';
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

let _stop: (() => void) | null = null;
let _events: any[] = [];
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
        if (_stop && watcherJs()) {
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
      if (_stop) { stopWatcher(); await startWatcher(); }   // re-arm with new masking
    });
    rust?.addEventListener('change', () => localStorage.setItem(RUST, rust.checked ? '1' : '0'));
    js?.addEventListener('change', () => localStorage.setItem(JS, js.checked ? '1' : '0'));
    document.getElementById('watcher-export')?.addEventListener('click', () => exportSession());
    document.getElementById('watcher-import')?.addEventListener('click', () => importAndPlay());
  }
}

/** Start local recording (idempotent). */
export async function startWatcher(): Promise<void> {
  if (_stop) return;
  const rrweb = await loadRrweb().catch(() => null);
  if (!rrweb?.record) { toast(t('watcher.rrwebFail') || 'Enregistreur indisponible', 'error'); return; }
  hookConsole();
  _events = [];
  _console = [];
  _startedAt = Date.now();
  const full = watcherFull();
  _stop = rrweb.record({
    emit: (ev: any) => { _events.push(ev); if (_events.length > 20000) _events.shift(); },
    maskAllInputs: !full,
    maskTextSelector: full ? undefined : SENSITIVE_SELECTOR,
    blockClass: 'bmm-no-record',
    ignoreClass: 'bmm-no-record',
    sampling: { mousemove: false, mouseInteraction: true, scroll: 250, input: 'last' },
    recordCanvas: false,
    collectFonts: false,
  }) || null;
}

/** Stop local recording (keeps the buffer for export). */
export function stopWatcher(): void {
  if (_stop) { try { _stop(); } catch { /* ignore */ } _stop = null; }
}

/** Apply the on/off setting: start or stop accordingly. */
export async function syncWatcher(): Promise<void> {
  if (watcherEnabled()) await startWatcher();
  else stopWatcher();
}

/** Export the current recording (rrweb + console + Rust log) to a .bmmreplay file. */
export async function exportSession(): Promise<void> {
  if (_events.length < 2) { toast(t('watcher.nothing') || 'Rien à exporter pour le moment', 'info'); return; }
  const rustLog = watcherRust() ? (await invoke('read_session_log_tail', { maxBytes: 262144 }).catch(() => '') as string) : '';
  const bundle = {
    bmmReplay: 1,
    app: 'BetterModsManager',
    createdAt: new Date().toISOString(),
    masked: !watcherFull(),
    durationMs: Date.now() - _startedAt,
    events: _events,
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

/** Pick a .bmmreplay file and replay it in an in-app viewer. */
export async function importAndPlay(): Promise<void> {
  const src = await pickFile({ filters: [{ name: 'BMM Replay', extensions: ['bmmreplay', 'json'] }] }).catch(() => null);
  if (!src) return;
  let bundle: any;
  try { bundle = JSON.parse(await invoke('read_file_text', { path: src }) as string); }
  catch { toast(t('watcher.badFile') || 'Fichier illisible', 'error'); return; }
  if (!Array.isArray(bundle?.events) || bundle.events.length < 2) { toast(t('watcher.empty') || 'Enregistrement vide', 'error'); return; }
  await playBundle(bundle);
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
  const meta = `${bundle.masked ? (t('watcher.masked') || 'masqué') : 'full'} · ${Math.round((bundle.durationMs || 0) / 1000)}s · ${(bundle.console || []).length} logs JS`;
  overlay.innerHTML = `
    <div style="width:min(1100px,94vw);height:min(86vh,820px);background:var(--bg-secondary,#15171c);border:1px solid var(--border,#2a2d34);border-radius:14px;display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border,#2a2d34)">
        <strong style="font-size:13px">${t('watcher.viewerTitle') || 'Lecture de session'}</strong>
        <span style="font-size:11px;color:var(--text-muted,#8a8f98)">${meta}</span>
        <span style="flex:1"></span>
        <button id="rw-play" class="btn btn-sm">⏸</button>
        <button id="rw-close" class="btn btn-sm btn-ghost">${t('common.close') || 'Fermer'}</button>
      </div>
      <div style="flex:1;display:flex;min-height:0">
        <div id="rw-host" style="flex:1;overflow:hidden;background:#000;position:relative"></div>
        <div id="rw-logs" style="width:300px;border-left:1px solid var(--border,#2a2d34);overflow:auto;font-family:var(--font-mono,monospace);font-size:10.5px;padding:8px;white-space:pre-wrap;color:var(--text-secondary,#c9ccd1)"></div>
      </div>
    </div>`;
  (document.getElementById('app-window-outer') || document.body).appendChild(overlay);

  const host = overlay.querySelector('#rw-host') as HTMLElement;
  const rep = new rrweb.Replayer(bundle.events, { root: host, speed: 1, skipInactive: true, showWarning: false, mouseTail: { strokeStyle: '#5b8cff' } });
  // scale to fit the host width
  const fit = () => {
    const wrap = (rep as any).wrapper as HTMLElement | undefined;
    const m4 = bundle.events.find((e: any) => e.type === 4);
    const recW = m4?.data?.width || 1280;
    if (wrap) { const s = Math.min(1, host.clientWidth / recW); wrap.style.transform = `scale(${s})`; wrap.style.transformOrigin = 'top left'; }
  };
  rep.play();
  setTimeout(fit, 60);
  window.addEventListener('resize', fit);

  // logs panel: JS console + a Rust-log toggle
  const logs = overlay.querySelector('#rw-logs') as HTMLElement;
  const jsTxt = (bundle.console || []).map((l: any) => `[${new Date(l.t).toLocaleTimeString()}] ${l.level.toUpperCase()}  ${l.msg}`).join('\n');
  logs.textContent = (jsTxt || '(no JS logs)') + (bundle.rustLog ? `\n\n──── RUST LOG ────\n${bundle.rustLog}` : '');

  let playing = true;
  const playBtn = overlay.querySelector('#rw-play') as HTMLButtonElement;
  playBtn.onclick = () => { playing = !playing; if (playing) { rep.play(rep.getCurrentTime()); playBtn.textContent = '⏸'; } else { rep.pause(); playBtn.textContent = '▶'; } };
  const close = () => { try { window.removeEventListener('resize', fit); rep.pause(); (rep as any).destroy?.(); } catch { /* ignore */ } overlay.remove(); };
  (overlay.querySelector('#rw-close') as HTMLElement).onclick = close;
}
