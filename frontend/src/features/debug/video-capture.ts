// Video capture for the Replay Studio — record the app to .mp4 (or .webm) instead of, or as
// well as, a .bmmreplay.
//
// WHY IT IS SCREEN CAPTURE AND NOT A CONVERSION OF THE .bmmreplay
//
// A .bmmreplay is a DOM mutation log, not pictures. Turning one into video means replaying it
// and photographing the result, and a DOM cannot be photographed from inside the page:
// captureStream() exists on <canvas> and media elements only. Rasterising the DOM ourselves
// (html2canvas and friends) redraws an approximation — different fonts, no shadows, broken
// transforms — which for a tool whose whole point is showing what the app really looked like
// is worse than useless.
//
// So the honest path is the platform's own screen capture: what you see is exactly what lands
// in the file. It also means converting an existing .bmmreplay is the same operation — play it
// back and capture the playback — rather than a second, weaker code path.
//
// CONTAINER: mp4 when the runtime can, webm otherwise. Chromium only gained MediaRecorder mp4
// support recently and WebView2 tracks a different release train, so this is asked at runtime
// rather than assumed. Both play in BMM's own viewer; mp4 is what other tools want.

import { invoke } from '../../core/api.js';

export interface CaptureResult {
  /** Where it was written, or null if the user cancelled the picker. */
  path: string | null;
  ext: 'mp4' | 'webm';
  bytes: number;
  ms: number;
}

/** MIME types in order of preference. The first the runtime admits to supporting wins.
 *  H.264-in-mp4 first (universally playable), then VP9/VP8 in webm. */
const CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/** The container this runtime will actually produce, or null if it cannot record at all.
 *  Exported so the UI can say "webm here" up front instead of surprising you at save time. */
export function pickMime(): { mime: string; ext: 'mp4' | 'webm' } | null {
  const MR = (globalThis as any).MediaRecorder;
  if (!MR?.isTypeSupported) return null;
  for (const mime of CANDIDATES) {
    try { if (MR.isTypeSupported(mime)) return { mime, ext: mime.startsWith('video/mp4') ? 'mp4' : 'webm' }; }
    catch { /* keep trying */ }
  }
  return null;
}

/** Whether video capture is possible here at all. Two separate things can be missing:
 *  the encoder (MediaRecorder) and the source (getDisplayMedia). Reported separately because
 *  they have different causes and the message should say which. */
export function captureSupport(): { ok: boolean; reason?: 'no-encoder' | 'no-display-media'; ext?: 'mp4' | 'webm' } {
  const picked = pickMime();
  if (!picked) return { ok: false, reason: 'no-encoder' };
  if (!navigator.mediaDevices?.getDisplayMedia) return { ok: false, reason: 'no-display-media' };
  return { ok: true, ext: picked.ext };
}

let active: {
  rec: any;
  stream: MediaStream;
  chunks: Blob[];
  ext: 'mp4' | 'webm';
  startedAt: number;
  onEnded?: () => void;
} | null = null;

export function isCapturing(): boolean { return !!active; }

/** Start capturing. Resolves once recording is under way, or throws with a reason the caller
 *  can show. The picker is the platform's — we cannot pre-select the BMM window for you. */
export async function startCapture(opts: { fps?: number; onStopped?: () => void } = {}): Promise<{ ext: 'mp4' | 'webm' }> {
  if (active) throw new Error('already-capturing');
  const support = captureSupport();
  if (!support.ok) throw new Error(support.reason);
  const picked = pickMime()!;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: opts.fps ?? 30 },
      // No audio: BMM has none to capture, and asking for it makes the picker demand a
      // permission the user has no reason to grant for a UI recording.
      audio: false,
    });
  } catch (e: any) {
    // NotAllowedError is the user closing the picker — a choice, not a failure.
    throw new Error(e?.name === 'NotAllowedError' ? 'cancelled' : 'display-media-failed');
  }

  const MR = (globalThis as any).MediaRecorder;
  const rec = new MR(stream, { mimeType: picked.mime });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e: any) => { if (e.data && e.data.size) chunks.push(e.data); };
  active = { rec, stream, chunks, ext: picked.ext, startedAt: Date.now(), onEnded: opts.onStopped };

  // Stopping from the browser's own "Stop sharing" bar ends the track without touching the
  // recorder. Without this the UI would still claim to be recording while nothing arrives.
  stream.getVideoTracks().forEach((tr) => tr.addEventListener('ended', () => { void stopCapture(); }));

  // A timeslice makes the recorder flush periodically, so a crash mid-take leaves usable
  // chunks rather than one buffer that never got written.
  rec.start(1000);
  return { ext: picked.ext };
}

/** Stop, write the file next to the .bmmreplay files, and report where it went. */
export async function stopCapture(): Promise<CaptureResult | null> {
  if (!active) return null;
  const a = active;
  active = null;

  const blob: Blob = await new Promise((resolve) => {
    a.rec.onstop = () => resolve(new Blob(a.chunks, { type: a.rec.mimeType || `video/${a.ext}` }));
    try { a.rec.stop(); } catch { resolve(new Blob(a.chunks)); }
  });
  a.stream.getTracks().forEach((tr) => { try { tr.stop(); } catch { /* ignore */ } });
  try { a.onEnded?.(); } catch { /* ignore */ }

  const ms = Date.now() - a.startedAt;
  if (!blob.size) return { path: null, ext: a.ext, bytes: 0, ms };

  // Base64 in chunks: String.fromCharCode(...bytes) on a multi-megabyte array blows the
  // argument limit and throws a RangeError — which would look like "saving video is broken"
  // and only for long takes.
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000) as unknown as number[]);
  }
  const b64 = btoa(bin);

  const path = await invoke('save_local_video', { b64, ext: a.ext }) as string;
  return { path, ext: a.ext, bytes: blob.size, ms };
}
