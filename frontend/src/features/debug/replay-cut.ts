// Cutting a segment out of the MIDDLE of a recording.
//
// Trimming the end is safe by construction: you keep a prefix, and a prefix of a valid
// recording is a valid recording. Cutting from the middle is not, and the reason is the only
// thing that matters here.
//
// An rrweb recording is one full snapshot followed by mutations that reference nodes BY ID.
// Remove a stretch of the middle and the events after it will address nodes that were
// created inside the stretch you removed — the player throws, or worse, silently renders a
// DOM that never existed. The recorder already solves this for pauses by forcing a fresh
// full snapshot on every resume, so each segment is self-contained.
//
// A cut decided after the fact has no such anchor, so this makes one: the END of every cut
// is snapped FORWARD to the next full snapshot. The user asks to cut 12s–20s and gets
// 12s–23.4s, because 23.4s is where the recording can honestly resume. That is reported
// rather than done quietly — a cut that silently lands somewhere else is worse than a cut
// that is refused.
//
// Pure and DOM-free on purpose: this is the part that can be proved without rrweb, a
// webview, or a Tauri window, none of which exist in a test run.

/** rrweb's EventType.FullSnapshot. The only point a recording can be re-entered. */
export const FULL_SNAPSHOT = 2;

export interface CutRange { start: number; end: number }
export interface TimedEvent { type: number; timestamp: number }

export interface CutPlan {
  /** The cuts as they will actually be applied, ends snapped to a snapshot, merged, sorted. */
  cuts: CutRange[];
  /** Cuts that could not be applied at all, with the reason — never dropped in silence. */
  refused: { range: CutRange; reason: 'no_anchor' | 'empty' | 'out_of_range' }[];
  /** Where a cut end moved, so the UI can say "12–20s became 12–23.4s". */
  snapped: { asked: number; applied: number }[];
}

const sortByStart = (a: CutRange, b: CutRange) => a.start - b.start;

/**
 * Work out which cuts can be applied, and where they really end.
 *
 * `events` must be in timeline order and carry ABSOLUTE timestamps; `ranges` are in the same
 * units. Everything is computed against the events themselves rather than against a
 * duration, because the last event and the intended duration are not always the same number.
 */
export function planCuts(events: TimedEvent[], ranges: CutRange[]): CutPlan {
  const plan: CutPlan = { cuts: [], refused: [], snapped: [] };
  if (!events.length || !ranges.length) return plan;

  const first = events[0].timestamp;
  const last = events[events.length - 1].timestamp;
  // Snapshot times, excluding the opening one: cutting back to the very first snapshot would
  // just be "delete the beginning", which is a different operation with a different name.
  const anchors = events.filter((e, i) => i > 0 && e.type === FULL_SNAPSHOT).map((e) => e.timestamp);

  for (const raw of ranges) {
    const start = Math.max(first, Math.min(raw.start, raw.end));
    const end = Math.min(last, Math.max(raw.start, raw.end));
    if (end <= start) { plan.refused.push({ range: raw, reason: 'empty' }); continue; }
    if (start >= last || end <= first) { plan.refused.push({ range: raw, reason: 'out_of_range' }); continue; }

    const anchor = anchors.find((t) => t >= end);
    if (anchor == null) {
      // Nothing to resume on. Refused rather than stretched to the end of the recording:
      // "cut the middle" and "delete everything after 12s" are not the same request, and
      // turning one into the other is exactly the kind of helpfulness nobody asked for.
      plan.refused.push({ range: raw, reason: 'no_anchor' });
      continue;
    }
    if (anchor !== end) plan.snapped.push({ asked: end, applied: anchor });
    plan.cuts.push({ start, end: anchor });
  }

  // Overlapping cuts merge, so the same millisecond is never subtracted twice.
  plan.cuts.sort(sortByStart);
  const merged: CutRange[] = [];
  for (const c of plan.cuts) {
    const prev = merged[merged.length - 1];
    if (prev && c.start <= prev.end) prev.end = Math.max(prev.end, c.end);
    else merged.push({ ...c });
  }
  plan.cuts = merged;
  return plan;
}

/**
 * Shift a timestamp back past every cut that ends before it.
 *
 * Identical in shape to the pause compression the recorder already does, and deliberately so:
 * a pause and a cut are the same operation decided at different times, and two functions that
 * subtract elapsed intervals would eventually disagree about the edges.
 */
export function shiftPastCuts(ts: number, cuts: CutRange[]): number {
  let removed = 0;
  for (const c of cuts) {
    if (c.end <= ts) removed += c.end - c.start;
    // A timestamp strictly inside a cut belongs to an event that is about to be dropped;
    // collapsing it onto the cut's start keeps the sequence monotonic if one slips through.
    else if (c.start < ts) removed += ts - c.start;
  }
  return ts - removed;
}

/** Is this event inside a cut, and therefore gone? Boundaries: start is out, the snapped
 *  end is IN — the anchor snapshot is what the recording resumes on. */
export function isCut(ts: number, cuts: CutRange[]): boolean {
  return cuts.some((c) => ts >= c.start && ts < c.end);
}

/**
 * Apply a plan: drop what is inside the cuts, and pull everything after them back.
 *
 * Returns new objects; the caller's array is never mutated, because the studio keeps the
 * raw take so a cut can be undone by rebuilding from it.
 */
export function applyCuts<T extends TimedEvent>(events: T[], cuts: CutRange[]): T[] {
  if (!cuts.length) return events.slice();
  return events
    .filter((e) => !isCut(e.timestamp, cuts))
    .map((e) => ({ ...e, timestamp: shiftPastCuts(e.timestamp, cuts) }));
}
