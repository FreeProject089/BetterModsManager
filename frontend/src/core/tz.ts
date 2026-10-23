// Timezone arithmetic, in one place because it is written wrong in three obvious ways and
// two of them look right in testing.
//
// Both markdown renderers need it — rich-markdown.ts for the blog and the release notes,
// md-lite.ts for the bundled documentation — and the website has its own copy in md.jsx. Two
// copies inside this app would be one copy that drifts, and the drift would be a wrong hour
// on a page nobody is checking against a clock.
//
// No dependency: `Intl` is in the webview and in node, and a date library for four functions
// is a date library to keep updated.

/** The reader's own zone, or UTC when the platform will not say. */
export function readerZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

/**
 * What a wall-clock time in `tz` is, in UTC, on a given date.
 *
 * There is no built-in for this. The trick is the standard one: format the instant IN the
 * zone, read back what the clock there said, and the difference is the offset. Done for a
 * SPECIFIC date, which is what makes daylight saving come out right — the same wall-clock
 * time has two different offsets across a year.
 */
export function zoneOffsetMs(dateUtcMs: number, tz: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p: Record<string, string> = {};
    for (const x of dtf.formatToParts(new Date(dateUtcMs))) p[x.type] = x.value;
    // `hour` comes back as 24 at midnight in some engines, which Date.UTC reads as the next
    // day — correct arithmetic, wrong day, and a silent one-day error.
    const h = p.hour === '24' ? 0 : Number(p.hour);
    const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), h, Number(p.minute), Number(p.second));
    return asUtc - dateUtcMs;
  } catch { return 0; }
}

/**
 * How far the reader is from `tz`, right now.
 *
 * Returned in pieces rather than as a sentence: the two callers word it with their own
 * dictionary, and a sentence assembled here would be a third place that has to be translated.
 */
export function zoneDelta(tz: string): { dir: 'none' | 'same' | 'ahead' | 'behind'; here: string; span: string } {
  const here = readerZone();
  if (!tz || tz === here) return { dir: 'none', here, span: '' };
  const now = Date.now();
  const diffMin = Math.round((zoneOffsetMs(now, here) - zoneOffsetMs(now, tz)) / 60000);
  if (!diffMin) return { dir: 'same', here, span: '' };
  const h = Math.floor(Math.abs(diffMin) / 60);
  const m = Math.abs(diffMin) % 60;
  return { dir: diffMin > 0 ? 'ahead' : 'behind', here, span: m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h` };
}

/**
 * One instant, written as a wall-clock time in `tz`, read in the reader's own zone.
 *
 * `ok: false` means it could not be parsed, and the caller must then show what the author
 * typed. Never "Invalid Date": a reader should see the author's words, not the failure of a
 * parser.
 */
export function readInstant(raw: string, tz: string): { ok: boolean; shown: string; iso: string; here: string } {
  const here = readerZone();
  const fail = { ok: false, shown: raw, iso: '', here };
  if (!raw) return fail;
  // Parsed as a wall-clock time IN `tz`, not in whatever zone this machine is set to:
  // `Date.parse('2026-09-01T20:00')` is local time, so without this the answer would be
  // right only for readers who already live where the author does.
  const naive = Date.parse(raw.includes('T') ? `${raw}Z` : `${raw.replace(' ', 'T')}Z`);
  if (Number.isNaN(naive)) return fail;
  const instant = tz ? naive - zoneOffsetMs(naive, tz) : naive;
  try {
    const shown = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: here }).format(new Date(instant));
    return { ok: true, shown, iso: new Date(instant).toISOString(), here };
  } catch { return fail; }
}
