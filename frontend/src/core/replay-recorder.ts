// Session replay recorder (rrweb). Captures the REAL BMM DOM — cursor, scroll,
// clicks, navigation — so the telemetry dashboard can replay a session visually
// (like Rybbit), instead of reconstructing it from discrete events.
//
// Privacy-first: by default every typed value is masked AND the elements that
// show mod / profile / path NAMES are masked too (they render as •••• in the
// replay). The user can opt in to a full, unmasked recording via the setting
// `bmm_replay_full` ('1') — then the replay shows exactly what they saw.
//
// rrweb is vendored as a global UMD script and loaded lazily, only once a
// recording actually starts, so users without consent never pay its weight.

import { invoke } from './api.js';

const RRWEB_SRC = 'assets/vendor/rrweb.min.js';

// ── asset:// inlining ──────────────────────────────────────────────────────────
// BMM <img> assets use Tauri's asset protocol (asset://localhost/… or
// https://asset.localhost/…) — those files live on the user's disk and can't be
// fetched by the remote dashboard. We read them in Rust and embed a data URL so
// the replay shows the real images. Cached per URL; capped server-side.
const _assetCache = new Map<string, string>();

function isAssetUrl(u: string): boolean {
  return /^asset:\/\//i.test(u) || /^https?:\/\/asset\.localhost\//i.test(u) || /^https?:\/\/[^/]*\.?asset\.localhost\//i.test(u);
}

async function resolveAsset(url: string): Promise<string> {
  if (_assetCache.has(url)) return _assetCache.get(url)!;
  let dataUrl = '';
  try { dataUrl = (await invoke('replay_asset_data_url', { url })) as string || ''; } catch { /* ignore */ }
  _assetCache.set(url, dataUrl);
  return dataUrl;
}

// Walk an rrweb serialized node tree and collect <img> nodes with an asset src.
function collectImgNodes(node: any, out: any[]): void {
  if (!node || typeof node !== 'object') return;
  if (node.type === 2 && node.tagName === 'img' && node.attributes) {
    const src = node.attributes.src || node.attributes.rr_dataURL;
    if (typeof src === 'string' && isAssetUrl(src) && !node.attributes.rr_dataURL?.startsWith?.('data:')) out.push(node);
  }
  if (Array.isArray(node.childNodes)) for (const c of node.childNodes) collectImgNodes(c, out);
}

// Replace asset:// <img> srcs with inline data URLs inside one rrweb event.
async function inlineAssets(ev: any): Promise<void> {
  const imgs: any[] = [];
  try {
    if (ev.type === 2) {
      // FullSnapshot — the whole document node tree.
      collectImgNodes(ev.data?.node, imgs);
    } else if (ev.type === 3 && ev.data?.source === 0) {
      // Mutation — newly added node trees + src attribute changes.
      for (const add of ev.data.adds || []) collectImgNodes(add.node, imgs);
      for (const at of ev.data.attributes || []) {
        const a = at.attributes;
        if (a && typeof a.src === 'string' && isAssetUrl(a.src)) {
          const d = await resolveAsset(a.src);
          if (d) a.rr_dataURL = d;
        }
      }
    }
  } catch { /* ignore */ }
  for (const n of imgs) {
    const d = await resolveAsset(n.attributes.src || n.attributes.rr_dataURL);
    if (d) n.attributes.rr_dataURL = d;
  }
}

// DOM that renders user-owned names/paths. Masked unless full mode is enabled.
export const SENSITIVE_SELECTOR = [
  '.mod-name', '.mp-mod-name', '.mod-path-hint',
  '.footer-profile-name', '.profile-card-paths',
  '.game-path-display', '.storage-disk-path',
  '.path', '.path-cell', '.path-text', '.path-picker',
  '.apps-installed-path', '.apps-install-path-hint',
  '.plug-path', '.plug-qt-path-label', '.plug-uqt-path',
  '.tut-assets-path', '[data-bmm-mask]',
].join(', ');

let _stop: (() => void) | null = null;
let _buf: any[] = [];
let _flushTimer: number | null = null;
let _seq = 0;
let _emit: ((payload: Record<string, any>) => void) | null = null;
let _full = false;
// Ordered async pipeline for emitted events (so asset inlining stays in order).
let _queue: Promise<void> = Promise.resolve();

/** True when the user opted into capturing the real (unmasked) content. */
export function isFullReplay(): boolean {
  try { return localStorage.getItem('bmm_replay_full') === '1'; } catch { return false; }
}

export function loadRrweb(): Promise<any> {
  const w = window as any;
  if (w.rrweb?.record) return Promise.resolve(w.rrweb);
  if (w.__rrwebLoading) return w.__rrwebLoading;
  w.__rrwebLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = RRWEB_SRC;
    s.async = true;
    s.onload = () => resolve((window as any).rrweb);
    s.onerror = () => reject(new Error('rrweb failed to load'));
    document.head.appendChild(s);
  });
  return w.__rrwebLoading;
}

// Gzip a value to a base64 string using the browser's native CompressionStream.
// rrweb chunks (especially full snapshots) compress ~8-12x, so this is the single
// biggest size win. Returns null when unsupported, so we can fall back to raw.
async function gzipToBase64(value: any): Promise<string | null> {
  try {
    const CS = (window as any).CompressionStream;
    if (typeof CS === 'undefined') return null;
    const json = JSON.stringify(value);
    const stream = new Blob([json]).stream().pipeThrough(new CS('gzip'));
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = '';
    const STEP = 0x8000;
    for (let i = 0; i < buf.length; i += STEP) bin += String.fromCharCode(...buf.subarray(i, i + STEP));
    return btoa(bin);
  } catch { return null; }
}

function flushChunk(): void {
  if (!_buf.length || !_emit) return;
  const chunk = _buf;
  _buf = [];
  // Capture seq + emit synchronously-ordered even though compression is async.
  const seq = _seq++;
  const emit = _emit;
  const full = _full;
  gzipToBase64(chunk).then((dz) => {
    if (dz) emit({ dz, n: chunk.length, seq, full });   // gzipped (base64) payload
    else emit({ d: chunk, seq, full });                  // uncompressed fallback
  });
}

/**
 * Start recording. `emit` receives each chunk `{ d: rrwebEvent[], seq, full }`;
 * the caller forwards it through the normal telemetry transport (which gives us
 * offline buffering + per-packet GDPR erasure for free).
 */
export async function startReplayRecording(emit: (payload: Record<string, any>) => void): Promise<void> {
  if (_stop) return;
  let rrweb: any;
  try { rrweb = await loadRrweb(); } catch { return; }
  if (!rrweb?.record) return;

  _emit = emit;
  _full = isFullReplay();
  _buf = [];
  _seq = 0;

  _stop = rrweb.record({
    emit: (ev: any) => {
      // Serialise through a promise chain so asset inlining (async) finishes IN
      // ORDER before the event is buffered/flushed.
      _queue = _queue.then(async () => {
        if (_full) await inlineAssets(ev);
        _buf.push(ev);
        // Flush a fresh full snapshot (the player needs a checkpoint to start a
        // seek from), and cap chunk size so single payloads stay reasonable.
        if (ev.type === 2 /* FullSnapshot */ || _buf.length >= 80) flushChunk();
      }).catch(() => {});
    },
    // Privacy defaults — only relaxed when the user explicitly opts into full mode.
    maskAllInputs: !_full,
    maskTextSelector: _full ? undefined : SENSITIVE_SELECTOR,
    blockClass: 'bmm-no-record',
    ignoreClass: 'bmm-no-record',
    // Size optimisation: NO mouse-move tracking (the biggest source of bloat),
    // keep clicks/scroll/inputs. Coarse scroll sampling, last-value inputs only.
    sampling: {
      mousemove: false,              // drop pointer-move positions entirely
      mouseInteraction: true,        // but keep clicks / taps
      scroll: 250,
      media: 1000,
      input: 'last',
    },
    recordCanvas: false,
    collectFonts: false,
    // NOTE: rrweb's own inlineImages uses canvas.toDataURL, which taints (and
    // fails) on BMM's cross-origin asset:// images. We instead resolve asset://
    // URLs to data URLs ourselves from disk (see inlineAssets below) — reliable,
    // and only in full mode since those images are user content. External https
    // images keep their URL and load directly on the dashboard.
    slimDOMOptions: { comment: true, headFavicon: true, headMetaDescKeywords: true, headMetaSocial: true, headMetaRobots: true, headMetaHttpEquiv: true, headMetaVerification: true },
    // A fresh full snapshot every 2 min keeps seeking cheap and bounds the cost
    // of a single missing chunk.
    checkoutEveryNms: 2 * 60 * 1000,
  }) || null;

  if (_flushTimer === null) _flushTimer = window.setInterval(flushChunk, 10000);
}

/** Stop recording and flush whatever is buffered. */
export function stopReplayRecording(): void {
  if (_flushTimer !== null) { clearInterval(_flushTimer); _flushTimer = null; }
  if (_stop) { try { _stop(); } catch { /* ignore */ } _stop = null; }
  flushChunk();
  _emit = null;
}
