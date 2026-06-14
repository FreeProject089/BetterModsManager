// A small, dependency-free micro-benchmark runner.
//
// For each registered case it: (1) warms up (lets the JIT optimize), (2) auto-
// calibrates an inner batch size so one sample takes ~the target time, (3)
// collects N samples, and (4) reports mean / median / min / p99 / ops-per-sec
// plus relative-margin-of-error. Timing uses process.hrtime.bigint() (ns).

const NS = 1e9;

function now() { return process.hrtime.bigint(); }
function toMs(ns) { return Number(ns) / 1e6; }

function stats(samplesNsPerOp) {
  const s = [...samplesNsPerOp].sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  const min = s[0];
  const p99 = s[Math.min(n - 1, Math.ceil(0.99 * n) - 1)];
  const variance = s.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
  const stddev = Math.sqrt(variance);
  // 95% CI margin of error (t≈1.96 for large n), as a % of the mean.
  const sem = stddev / Math.sqrt(n);
  const rme = mean > 0 ? (1.96 * sem / mean) * 100 : 0;
  return {
    mean_ns: mean, median_ns: median, min_ns: min, p99_ns: p99,
    stddev_ns: stddev, rme_pct: rme, samples: n,
    ops_per_sec: mean > 0 ? NS / mean : 0,
  };
}

// Run one case. opts: { warmupMs, sampleMs, samples }
function runCase(fn, opts) {
  const { warmupMs = 200, sampleMs = 80, samples = 25 } = opts;

  // 1. Warmup (fixed wall-time).
  let warmEnd = now() + BigInt(Math.round(warmupMs * 1e6));
  let warmIters = 0;
  while (now() < warmEnd) { fn(); warmIters++; }

  // 2. Calibrate batch so a single timed batch ≈ sampleMs.
  let batch = 1;
  for (;;) {
    const t0 = now();
    for (let i = 0; i < batch; i++) fn();
    const elapsed = toMs(now() - t0);
    if (elapsed >= sampleMs || batch > 1e9) break;
    // scale up toward the target, with headroom
    const factor = elapsed > 0 ? (sampleMs / elapsed) : 4;
    batch = Math.max(batch + 1, Math.ceil(batch * Math.min(8, factor)));
  }

  // 3. Collect samples (ns per op).
  const perOp = [];
  for (let s = 0; s < samples; s++) {
    const t0 = now();
    for (let i = 0; i < batch; i++) fn();
    const ns = Number(now() - t0) / batch;
    perOp.push(ns);
  }

  return { ...stats(perOp), batch, warmup_iters: warmIters };
}

export class Suite {
  constructor(name, opts = {}) {
    this.name = name;
    this.opts = opts;
    this.cases = [];
  }
  add(name, fn, meta = {}) {
    this.cases.push({ name, fn, meta });
    return this;
  }
  run() {
    process.stdout.write(`\n▸ ${this.name}\n`);
    const results = [];
    for (const c of this.cases) {
      // Make sure the function actually produces a value we consume, so the
      // engine can't dead-code-eliminate the work.
      const wrapped = () => { globalThis.__sink = c.fn(); };
      const r = runCase(wrapped, this.opts);
      results.push({ name: c.name, meta: c.meta, ...r });
      const opsTxt = r.ops_per_sec >= 1000
        ? `${(r.ops_per_sec / 1000).toFixed(1)}k ops/s`
        : `${r.ops_per_sec.toFixed(1)} ops/s`;
      process.stdout.write(
        `   ${c.name.padEnd(34)} ${fmtTime(r.mean_ns).padStart(11)}  ±${r.rme_pct.toFixed(1)}%   ${opsTxt}\n`
      );
    }
    // Annotate the fastest as baseline ratio.
    const fastest = Math.min(...results.map(r => r.mean_ns));
    for (const r of results) r.relative = r.mean_ns / fastest;
    return { suite: this.name, results };
  }
}

export function fmtTime(ns) {
  if (ns < 1e3) return `${ns.toFixed(1)} ns`;
  if (ns < 1e6) return `${(ns / 1e3).toFixed(2)} µs`;
  if (ns < 1e9) return `${(ns / 1e6).toFixed(2)} ms`;
  return `${(ns / 1e9).toFixed(2)} s`;
}
