// Replay Studio post-record editing: start trim, end trim and arbitrary cuts, as pure math.
//
// HOW A CUT STAYS PLAYABLE (re-anchoring by fast-forward)
//
// An rrweb recording is a full snapshot followed by deltas that address nodes BY ID. Dropping
// a stretch of the middle would leave later deltas pointing at nodes created inside the
// stretch. replay-cut.ts solved that by snapping the END of a cut forward to the next full
// snapshot, which means a cut rarely lands where it was asked (and a take with no pause has
// no snapshot to land on at all, so nothing could be cut).
//
// This module removes the constraint instead. Inside a removed range, every event that
// changes DOM STATE (mutations, inputs, scroll, styles, viewport, the snapshots themselves)
// is KEPT but squashed onto the range's start, and only what is purely visual and transient
// (pointer moves, clicks, touch, drag, console) is dropped. At playback the player applies
// the squashed batch in a single tick: the screen jumps from "just before the cut" to "just
// after the cut", which is exactly what a cut looks like, and every later delta still finds
// its nodes. A start trim is the same operation on [0, start). If a full snapshot lies inside
// a range, everything in the range before it (and its Meta) is dropped outright, since that
// snapshot rebuilds the page on its own; that is where cuts actually save bytes.
//
// The output is always a valid rrweb stream for the three existing players: same event
// shapes, monotonic timestamps, a full snapshot before the first delta. Nothing new is
// required of a player, so old players read edited files unchanged.
//
// Pure and DOM-free so it can be tested under node (tests/replay-edit-model.test.mjs).

import { FULL_SNAPSHOT, shiftPastCuts, type CutRange } from './replay-cut.js';

export const EV_DOM_LOADED = 0;
export const EV_LOAD = 1;
export const EV_INCREMENTAL = 3;
export const EV_META = 4;
export const EV_CUSTOM = 5;
export const EV_PLUGIN = 6;

// rrweb IncrementalSource values that only paint the cursor or log: safe to drop anywhere.
const SRC_MOUSE_MOVE = 1;
const SRC_MOUSE_INTERACTION = 2;
const SRC_TOUCH_MOVE = 6;
const SRC_LOG = 11;
const SRC_DRAG = 12;
const TRANSIENT_SOURCES = new Set([SRC_MOUSE_MOVE, SRC_MOUSE_INTERACTION, SRC_TOUCH_MOVE, SRC_LOG, SRC_DRAG]);

export interface ReplayEvent { type: number; timestamp: number; data?: any }
export interface Rect { x: number; y: number; w: number; h: number }
export interface RegionKey { t: number; rect: Rect }
export interface Marker { t: number; label: string }

/** Every time below is in ms RELATIVE to the first event of the (pause-compressed) take. */
export interface ReplayEdit {
  trimStart: number;
  /** null = keep to the end. */
  trimEnd: number | null;
  cuts: CutRange[];
}

export function emptyEdit(): ReplayEdit { return { trimStart: 0, trimEnd: null, cuts: [] }; }

export function isEditEmpty(e: ReplayEdit): boolean {
  return e.trimStart <= 0 && e.trimEnd == null && e.cuts.length === 0;
}

/** Shortest cut kept. Below this a drag on the timeline is a click, not a selection. */
export const MIN_CUT_MS = 50;

/** Clamp to [0, dur], drop slivers, sort, merge overlaps (and touching ranges). */
export function normalizeCuts(cuts: CutRange[], durationMs: number): CutRange[] {
  const out: CutRange[] = [];
  const clean = cuts
    .map((c) => ({ start: Math.max(0, Math.min(c.start, c.end)), end: Math.min(durationMs, Math.max(c.start, c.end)) }))
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end - c.start >= MIN_CUT_MS)
    .sort((a, b) => a.start - b.start);
  for (const c of clean) {
    const prev = out[out.length - 1];
    if (prev && c.start <= prev.end) prev.end = Math.max(prev.end, c.end);
    else out.push({ ...c });
  }
  return out;
}

/** The last kept moment, in original time. */
export function keepUntil(edit: ReplayEdit, durationMs: number): number {
  return edit.trimEnd == null ? durationMs : Math.max(0, Math.min(durationMs, edit.trimEnd));
}

/** Interior removed ranges (start trim + cuts), clipped to the kept span, merged. The tail
 *  past the end trim is not here: it is dropped, never squashed. */
export function removedRanges(edit: ReplayEdit, durationMs: number): CutRange[] {
  const until = keepUntil(edit, durationMs);
  const raw = [...edit.cuts];
  if (edit.trimStart > 0) raw.push({ start: 0, end: edit.trimStart });
  return normalizeCuts(raw.map((c) => ({ start: c.start, end: Math.min(c.end, until) })), until);
}

/** Original time → edited time. A moment inside a removed range maps onto the range start;
 *  a moment past the end trim maps to null. */
export function mapTime(t: number, edit: ReplayEdit, durationMs: number): number | null {
  if (t > keepUntil(edit, durationMs)) return null;
  return shiftPastCuts(t, removedRanges(edit, durationMs));
}

/** Edited time → original time (the first original moment that shows it). */
export function unmapTime(e: number, edit: ReplayEdit, durationMs: number): number {
  let r = Math.max(0, e);
  for (const c of removedRanges(edit, durationMs)) {
    if (c.start <= r) r += c.end - c.start;
    else break;
  }
  return Math.min(r, keepUntil(edit, durationMs));
}

export function editedDuration(edit: ReplayEdit, durationMs: number): number {
  return mapTime(keepUntil(edit, durationMs), edit, durationMs) ?? 0;
}

export function isRemoved(t: number, edit: ReplayEdit, durationMs: number): boolean {
  if (t > keepUntil(edit, durationMs)) return true;
  return removedRanges(edit, durationMs).some((c) => t >= c.start && t < c.end);
}

/** Does this event change what the page IS (as opposed to where the cursor is)? */
export function isStateEvent(ev: ReplayEvent): boolean {
  if (ev.type === EV_INCREMENTAL) return !TRANSIENT_SOURCES.has(ev.data?.source);
  // Custom and plugin events (console, BMM tags) are moments, not state.
  return ev.type !== EV_CUSTOM && ev.type !== EV_PLUGIN;
}

export function isPointerMove(ev: ReplayEvent): boolean {
  return ev.type === EV_INCREMENTAL && (ev.data?.source === SRC_MOUSE_MOVE || ev.data?.source === SRC_TOUCH_MOVE);
}

export interface EditOptions {
  /** Drop cursor-move events everywhere (smaller file, no cursor trail at playback). */
  dropPointerMoves?: boolean;
}

/**
 * Apply an edit to a take. `events` carry ABSOLUTE timestamps (pause-compressed) in timeline
 * order; the output keeps the first event's absolute timestamp as its origin. New objects;
 * the input is never mutated, so the raw take survives and every edit stays undoable.
 */
export function editEvents<T extends ReplayEvent>(events: T[], edit: ReplayEdit, opts: EditOptions = {}): T[] {
  if (!events.length) return [];
  const base = events[0].timestamp;
  return planEdit(events, edit, opts).map((p) => ({ ...events[p.index], timestamp: base + p.t }));
}

/** Which events survive an edit, and at what new relative time — without copying them, so
 *  the studio can size the result on every edit from per-event sizes it already has. */
export function planEdit(events: ReplayEvent[], edit: ReplayEdit, opts: EditOptions = {}): { index: number; t: number }[] {
  if (!events.length) return [];
  const base = events[0].timestamp;
  const dur = events[events.length - 1].timestamp - base;
  const until = keepUntil(edit, dur);
  const ranges = removedRanges(edit, dur);

  // Per range: the index from which squashed state is still needed. A full snapshot inside
  // the range rebuilds the page by itself, so anything before it (and before its Meta) goes.
  const reanchor = ranges.map((c) => {
    let snap = -1;
    for (let i = 0; i < events.length; i++) {
      const r = events[i].timestamp - base;
      if (r >= c.end) break;
      if (r >= c.start && events[i].type === FULL_SNAPSHOT) snap = i;
    }
    if (snap < 0) return -1;
    const prev = events[snap - 1];
    return prev && prev.type === EV_META && prev.timestamp - base >= c.start ? snap - 1 : snap;
  });

  const out: { index: number; t: number }[] = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const r = ev.timestamp - base;
    if (r > until) continue;
    const k = ranges.findIndex((c) => r >= c.start && r < c.end);
    if (k < 0) {
      if (opts.dropPointerMoves && isPointerMove(ev)) continue;
      out.push({ index: i, t: shiftPastCuts(r, ranges) });
      continue;
    }
    if (!isStateEvent(ev)) continue;
    if (reanchor[k] >= 0 && i < reanchor[k]) continue;
    out.push({ index: i, t: shiftPastCuts(ranges[k].start, ranges) });
  }
  return out;
}

/** Region keyframes through the same edit. Keyframes inside a removed range collapse onto
 *  its start (the last one wins), so the frame after a cut is the frame that was live when
 *  the recording resumed, not a stale one from before the cut. */
export function editRegions(regions: RegionKey[], edit: ReplayEdit, durationMs: number): RegionKey[] {
  const out: RegionKey[] = [];
  const sorted = [...regions].filter((r) => r && r.rect && Number.isFinite(r.t)).sort((a, b) => a.t - b.t);
  for (const r of sorted) {
    const m = mapTime(Math.max(0, r.t), edit, durationMs);
    if (m == null) continue;
    const prev = out[out.length - 1];
    if (prev && prev.t === m) prev.rect = { ...r.rect };
    else out.push({ t: m, rect: { ...r.rect } });
  }
  return out;
}

/** Markers point at a moment; a marker whose moment was removed is dropped with it. */
export function editMarkers(markers: Marker[], edit: ReplayEdit, durationMs: number): Marker[] {
  const until = keepUntil(edit, durationMs);
  const ranges = removedRanges(edit, durationMs);
  // Strictly inside: a marker ON a cut's start (where "Cut selection" leaves the playhead)
  // marks the join, which still exists after the cut.
  const gone = (t: number) => t > until || ranges.some((c) => t > c.start && t < c.end);
  return markers
    .filter((m) => m && Number.isFinite(m.t) && !gone(m.t))
    .map((m) => ({ t: mapTime(m.t, edit, durationMs) as number, label: String(m.label || '').slice(0, 80) }))
    .sort((a, b) => a.t - b.t);
}

/** Full-snapshot times (relative). Shown on the timeline: a seek lands cheapest there. */
export function anchorsOf(events: ReplayEvent[]): number[] {
  if (!events.length) return [];
  const base = events[0].timestamp;
  return events.filter((e) => e.type === FULL_SNAPSHOT).map((e) => e.timestamp - base);
}

/**
 * Can a player open this? The checks the three players depend on: a full snapshot before
 * any delta, and timestamps that never go backwards. Returns the first problem, or null.
 */
export function playabilityProblem(events: ReplayEvent[]): string | null {
  if (events.length < 2) return 'too_short';
  let seenSnapshot = false;
  let last = -Infinity;
  for (const ev of events) {
    if (!Number.isFinite(ev.timestamp) || ev.timestamp < last) return 'non_monotonic';
    last = ev.timestamp;
    if (ev.type === FULL_SNAPSHOT) seenSnapshot = true;
    else if (ev.type === EV_INCREMENTAL && !seenSnapshot) return 'delta_before_snapshot';
  }
  return seenSnapshot ? null : 'no_snapshot';
}

/** Size of the JSON as written (compact, UTF-8 ≈ string length for this mostly-ASCII data). */
export function estimateBytes(events: unknown[]): number {
  let n = 0;
  for (const ev of events) { try { n += JSON.stringify(ev).length + 1; } catch { n += 4096; } }
  return n + 256; // the envelope
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/** m:ss.d for a timeline readout. */
export function fmtClock(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

/**
 * Embed snippets for a saved file, in the two syntaxes the players read: the md-lite
 * `:::replay{…}` directive (in-app markdown, BCWEB) and the docs site's `bmm-replay` div.
 * The path is where the docs keep recordings; the user moves the file there.
 */
export function embedSnippets(fileName: string, title: string): { md: string; html: string } {
  const file = (String(fileName || '').split(/[\\/]/).pop() || 'recording.bmmreplay').replace(/["<>]/g, '');
  const ttl = String(title || '').replace(/["\r\n]/g, ' ').trim();
  const attr = ttl.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return {
    md: `:::replay{src="assets/replays/${file}"${ttl ? ` title="${ttl}"` : ''}}\n:::`,
    html: `<div class="bmm-replay" data-src="../assets/replays/${file}"${ttl ? ` data-title="${attr}"` : ''}></div>`,
  };
}
