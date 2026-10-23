// Comparing two benchmark summaries (pure).
//
// A verdict is « better » or « worse » only when BOTH hold:
//   1. the change is larger than the noise threshold (5 % for timed runs with a confidence
//      interval; 15 % for one-shot numbers such as the memory collector, which has none);
//   2. the 95 % confidence intervals of the two runs do not overlap (when both have one).
// Otherwise it is « same ». Criterion's own change estimate (its bootstrap CI of the relative
// change against the previous saved run) is shown alongside when the previous saved run IS the
// previous version's data, and it can only make a verdict more cautious, never bolder.

export const NOISE = { ci: 0.05, oneShot: 0.15 };

/** Relative change new/old − 1 (negative = faster / smaller, for « lower is better »). */
export const relChange = (oldV, newV) => (oldV ? newV / oldV - 1 : null);

/**
 * a = previous metric, b = new metric (same id). Returns
 * { change, lo, hi, verdict: 'better'|'worse'|'same'|'new'|'gone', reason }.
 */
export function verdict(a, b, noise = NOISE) {
  if (!a && b) return { change: null, verdict: 'new', reason: 'no measurement in the previous version' };
  if (a && !b) return { change: null, verdict: 'gone', reason: 'not measured in this version' };
  const change = relChange(a.value, b.value);
  const hasCi = a.lo != null && a.hi != null && b.lo != null && b.hi != null;
  // Conservative interval of the change: best case to worst case of the two intervals.
  const lo = hasCi ? b.lo / a.hi - 1 : null;
  const hi = hasCi ? b.hi / a.lo - 1 : null;
  const threshold = hasCi ? noise.ci : noise.oneShot;
  const overlap = hasCi ? !(b.hi < a.lo || b.lo > a.hi) : false;
  const lowerBetter = (b.better ?? a.better ?? 'lower') === 'lower';
  if (change == null || !Number.isFinite(change)) return { change: null, verdict: 'same', reason: 'previous value is zero' };
  if (Math.abs(change) < threshold) return { change, lo, hi, verdict: 'same', reason: `within ±${Math.round(threshold * 100)} % noise` };
  if (overlap) return { change, lo, hi, verdict: 'same', reason: 'the confidence intervals overlap' };
  const crit = b.criterionChange;
  if (crit && crit.lo <= 0 && crit.hi >= 0) return { change, lo, hi, verdict: 'same', reason: "Criterion's change interval includes zero" };
  const faster = change < 0;
  return { change, lo, hi, verdict: faster === lowerBetter ? 'better' : 'worse', reason: hasCi ? `beyond ±${Math.round(threshold * 100)} % and outside both confidence intervals` : `beyond ±${Math.round(threshold * 100)} % (single run, no interval)` };
}

/** Pair every metric of prev and next by id. Returns rows sorted as `next` lists them, then the gone ones. */
export function compareSummaries(prev, next) {
  const old = new Map((prev?.metrics ?? []).map((m) => [m.id, m]));
  const rows = next.metrics.map((m) => ({ id: m.id, prev: old.get(m.id) ?? null, next: m, ...verdict(old.get(m.id), m) }));
  const seen = new Set(next.metrics.map((m) => m.id));
  for (const m of prev?.metrics ?? []) if (!seen.has(m.id)) rows.push({ id: m.id, prev: m, next: null, ...verdict(m, null) });
  return rows;
}

export function tally(rows) {
  const t = { better: 0, worse: 0, same: 0, new: 0, gone: 0 };
  for (const r of rows) t[r.verdict]++;
  return t;
}

/** Human time: 1.23 µs, 45.6 ms … */
export function fmtNs(ns) {
  if (ns == null || !Number.isFinite(ns)) return '-';
  const a = Math.abs(ns);
  if (a < 1e3) return `${ns.toFixed(1)} ns`;
  if (a < 1e6) return `${(ns / 1e3).toFixed(2)} µs`;
  if (a < 1e9) return `${(ns / 1e6).toFixed(2)} ms`;
  return `${(ns / 1e9).toFixed(3)} s`;
}

export function fmtValue(m) {
  if (!m) return '-';
  if (m.unit === 'KiB') return `${m.value >= 1024 ? (m.value / 1024).toFixed(2) + ' MiB' : m.value.toFixed(1) + ' KiB'}`;
  return fmtNs(m.value);
}

/** MiB/s or elements/s from a throughput annotation, or null. */
export function throughputText(m) {
  if (!m?.throughput || !m.value) return null;
  const perSec = 1e9 / m.value;
  if (m.throughput.bytes != null) return `${((m.throughput.bytes * perSec) / 2 ** 20).toFixed(1)} MiB/s`;
  if (m.throughput.elements != null) return `${Math.round(m.throughput.elements * perSec).toLocaleString('en-US')} items/s`;
  return null;
}

export const pct = (x, digits = 1) => (x == null ? '-' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(digits)} %`);
