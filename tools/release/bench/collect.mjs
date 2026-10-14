// Collects the raw output of the benchmark suite into one summary per version.
//
//   Criterion  benchmarks/rust/target/criterion/**/new/{benchmark,estimates,sample}.json
//   JS         benchmarks/js/results/js-results.json
//   hyperfine  benchmarks/results/hyperfine/*.json
//   memory     benchmarks/results/mem-report.json
//
// Every metric becomes { id, source, group, name, unit, value, lo, hi, n, better, throughput }:
// `value` is the point estimate (mean), [lo, hi] its 95 % confidence interval when the tool
// gives one (Criterion: bootstrap CI of the mean; JS runner: ±1.96·SEM; hyperfine: ±1.96·σ/√n;
// the memory collector runs once, so it has none). Times are in nanoseconds.
//
// The summary (benchmarks/results/<version>/summary.json) is small and committed; the raw
// files copied next to it (raw/) are gitignored.

import { readdirSync, existsSync, statSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import os from 'node:os';
import { ROOT, readJson } from '../lib/util.mjs';
import { capture } from '../lib/exec.mjs';

export const BENCH = join(ROOT, 'benchmarks');
export const CRIT = join(BENCH, 'rust', 'target', 'criterion');
export const JS_RESULTS = join(BENCH, 'js', 'results', 'js-results.json');
export const HF_DIR = join(BENCH, 'results', 'hyperfine');
export const MEM = join(BENCH, 'results', 'mem-report.json');
export const RESULTS = join(BENCH, 'results');

const mtime = (p) => { try { return statSync(p).mtime.toISOString(); } catch { return null; } };

function walkCriterion(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === 'report') continue;
    const p = join(dir, e.name);
    if (e.name === 'new' && existsSync(join(p, 'benchmark.json'))) out.push(dirname(p));
    else walkCriterion(p, out);
  }
  return out;
}

export function collectCriterion() {
  const metrics = [];
  for (const d of walkCriterion(CRIT)) {
    const b = readJson(join(d, 'new', 'benchmark.json'));
    const est = readJson(join(d, 'new', 'estimates.json'));
    let n = null;
    try { n = readJson(join(d, 'new', 'sample.json')).iters.length; } catch { /* optional */ }
    const m = est.mean ?? est.slope;
    let change = null;
    if (existsSync(join(d, 'change', 'estimates.json'))) {
      const ch = readJson(join(d, 'change', 'estimates.json')).mean;
      if (ch) change = { value: ch.point_estimate, lo: ch.confidence_interval.lower_bound, hi: ch.confidence_interval.upper_bound, at: mtime(join(d, 'change', 'estimates.json')) };
    }
    const tp = b.throughput ? (b.throughput.Bytes != null ? { bytes: b.throughput.Bytes } : b.throughput.Elements != null ? { elements: b.throughput.Elements } : null) : null;
    metrics.push({
      id: `criterion:${b.full_id}`, source: 'criterion', group: b.group_id, name: [b.function_id, b.value_str].filter(Boolean).join('/') || b.group_id,
      unit: 'ns', value: m.point_estimate, lo: m.confidence_interval.lower_bound, hi: m.confidence_interval.upper_bound,
      median: est.median?.point_estimate ?? null, n, better: 'lower', throughput: tp, at: mtime(join(d, 'new', 'estimates.json')), criterionChange: change,
      rawDir: relative(CRIT, d).split(sep).join('/'),
    });
  }
  return metrics;
}

export function collectJs() {
  if (!existsSync(JS_RESULTS)) return [];
  const j = readJson(JS_RESULTS);
  const metrics = [];
  for (const s of j.suites) for (const r of s.results) {
    const half = (r.rme_pct / 100) * r.mean_ns;
    metrics.push({ id: `js:${s.suite}/${r.name}`, source: 'js', group: s.suite, name: r.name, unit: 'ns', value: r.mean_ns, lo: r.mean_ns - half, hi: r.mean_ns + half,
      median: r.median_ns, n: r.samples, better: 'lower', kind: r.meta?.kind ?? null, at: j.generatedAt });
  }
  return metrics;
}

export function collectHyperfine() {
  if (!existsSync(HF_DIR)) return [];
  const metrics = [];
  for (const f of readdirSync(HF_DIR).filter((x) => x.endsWith('.json')).sort()) {
    let j;
    try { j = readJson(join(HF_DIR, f)); } catch { continue; } // a failed hyperfine run leaves an empty file
    for (const r of j.results ?? []) {
      const n = r.times?.length ?? 10;
      const half = 1.96 * (r.stddev ?? 0) / Math.sqrt(n);
      metrics.push({ id: `e2e:${f.replace(/\.json$/, '')}/${r.command}`, source: 'hyperfine', group: `e2e ${f.replace(/\.json$/, '')}`, name: r.command,
        unit: 'ns', value: r.mean * 1e9, lo: (r.mean - half) * 1e9, hi: (r.mean + half) * 1e9, median: r.median * 1e9, n, better: 'lower', at: mtime(join(HF_DIR, f)) });
    }
  }
  return metrics;
}

export function collectMem() {
  if (!existsSync(MEM)) return [];
  const j = readJson(MEM);
  const at = mtime(MEM);
  return j.operations.flatMap((o) => [
    { id: `mem:${o.op}/time`, source: 'mem', group: 'memory collector (one run)', name: `${o.op} time`, unit: 'ns', value: o.ms * 1e6, lo: null, hi: null, n: 1, better: 'lower', bytes: o.bytes, at },
    { id: `mem:${o.op}/peak`, source: 'mem', group: 'memory collector (one run)', name: `${o.op} peak heap`, unit: 'KiB', value: o.peakHeapKiB, lo: null, hi: null, n: 1, better: 'lower', bytes: o.bytes, at },
  ]);
}

export function machineInfo() {
  const cpus = os.cpus();
  return {
    cpu: cpus[0]?.model?.trim() ?? null, logicalCores: cpus.length, ramGiB: Math.round(os.totalmem() / 2 ** 30),
    os: `${os.type()} ${os.release()} ${os.arch()}`, node: process.version,
    rustc: capture('rustc', ['-V']), cargo: capture('cargo', ['-V']), hyperfine: capture('hyperfine', ['--version']),
  };
}

export function collectAll() {
  return [...collectCriterion(), ...collectJs(), ...collectHyperfine(), ...collectMem()];
}

/** Copy the raw result files into results/<version>/raw (no Criterion HTML/SVG). */
export function snapshotRaw(destDir) {
  const raw = join(destDir, 'raw');
  const cp = (src, rel) => { if (!existsSync(src)) return; const d = join(raw, rel); mkdirSync(dirname(d), { recursive: true }); copyFileSync(src, d); };
  for (const d of walkCriterion(CRIT)) for (const f of ['benchmark.json', 'estimates.json', 'sample.json']) cp(join(d, 'new', f), join('criterion', relative(CRIT, d), f));
  cp(JS_RESULTS, 'js/js-results.json');
  if (existsSync(HF_DIR)) for (const f of readdirSync(HF_DIR)) cp(join(HF_DIR, f), join('hyperfine', f));
  cp(MEM, 'mem-report.json');
  return raw;
}

/** Earliest and latest timestamp of the metrics (when the data was produced). */
export function span(metrics) {
  const ts = metrics.map((m) => m.at).filter(Boolean).sort();
  return ts.length ? { from: ts[0], to: ts[ts.length - 1] } : null;
}

export function readSummary(path) { return JSON.parse(readFileSync(path, 'utf8')); }
