// Aggregate every benchmark source into ONE presentable HTML deck:
//   - Rust/Criterion : benchmarks/rust/target/criterion/**/new/estimates.json
//   - JS micro-bench : benchmarks/js/results/js-results.json
//   - hyperfine E2E  : benchmarks/results/hyperfine/*.json
//
// Output: benchmarks/results/index.html (self-contained, inline SVG).
// Run: node benchmarks/scripts/make-report.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCH = join(__dirname, '..');
const CRIT = join(BENCH, 'rust', 'target', 'criterion');
const JS = join(BENCH, 'js', 'results', 'js-results.json');
const HYPER = join(BENCH, 'results', 'hyperfine');
const OUT_DIR = join(BENCH, 'results');

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmtNs = (ns) =>
  ns < 1e3 ? `${ns.toFixed(0)} ns` :
  ns < 1e6 ? `${(ns / 1e3).toFixed(2)} µs` :
  ns < 1e9 ? `${(ns / 1e6).toFixed(2)} ms` : `${(ns / 1e9).toFixed(2)} s`;
const fmtBytesPerSec = (bps) =>
  bps >= 1 << 30 ? `${(bps / (1 << 30)).toFixed(2)} GiB/s` :
  bps >= 1 << 20 ? `${(bps / (1 << 20)).toFixed(1)} MiB/s` :
  `${(bps / 1024).toFixed(0)} KiB/s`;

// ── Criterion: walk target/criterion for new/estimates.json ───────────────────
function collectCriterion() {
  const groups = {};
  if (!existsSync(CRIT)) return groups;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (name === 'estimates.json' && dir.endsWith(join('new'))) {
        try {
          const est = JSON.parse(readFileSync(p, 'utf8'));
          const benchPath = join(dir, 'benchmark.json');
          let group = 'misc', value = '';
          let throughput = null;
          if (existsSync(benchPath)) {
            const b = JSON.parse(readFileSync(benchPath, 'utf8'));
            group = b.group_id || b.function_id || 'misc';
            value = b.value_str || b.function_id || '';
            if (b.throughput) {
              // criterion throughput: { Bytes: n } or { Elements: n }
              const [unit, n] = Object.entries(b.throughput)[0] || [];
              throughput = { unit, n };
            }
          }
          const mean = est.mean?.point_estimate ?? est.Mean?.point_estimate;
          if (mean == null) continue;
          (groups[group] ||= []).push({
            label: value || group,
            mean_ns: mean,
            throughput,
          });
        } catch { /* skip malformed */ }
      }
    }
  };
  walk(CRIT);
  for (const g of Object.values(groups)) g.sort((a, b) => a.mean_ns - b.mean_ns);
  return groups;
}

// ── hyperfine: read exported JSON files ───────────────────────────────────────
function collectHyperfine() {
  const out = [];
  if (!existsSync(HYPER)) return out;
  for (const f of readdirSync(HYPER)) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = JSON.parse(readFileSync(join(HYPER, f), 'utf8'));
      out.push({ file: f.replace(/\.json$/, ''), results: data.results || [] });
    } catch { /* skip */ }
  }
  return out;
}

// ── SVG bar chart helpers ─────────────────────────────────────────────────────
function svgBars(rows, { unit = 'time', valueKey = 'mean_ns' } = {}) {
  const max = Math.max(...rows.map((r) => r[valueKey]), 1e-9);
  const W = 760, rowH = 34, padL = 230, padR = 150, top = 8;
  const H = top + rows.length * rowH + 8, barW = W - padL - padR;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">`;
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const w = Math.max(2, (r[valueKey] / max) * barW);
    const fill = r.color || (/optim/i.test(r.label) ? '#10b981' : '#3b82f6');
    const right = unit === 'time'
      ? fmtNs(r[valueKey]) + (r.throughput ? ` · ${fmtBytesPerSec(r.throughput.n / (r.mean_ns / 1e9))}` : '')
      : `${r[valueKey].toFixed(3)} s`;
    s += `<text x="${padL - 10}" y="${y + 19}" text-anchor="end" font-size="12" fill="#cbd5e1" font-family="system-ui">${esc(r.label)}</text>`;
    s += `<rect x="${padL}" y="${y + 5}" width="${w}" height="18" rx="4" fill="${fill}"/>`;
    s += `<text x="${padL + w + 8}" y="${y + 19}" font-size="11" fill="#e2e8f0" font-family="system-ui">${esc(right)}</text>`;
  });
  return s + '</svg>';
}

// ── Build sections ────────────────────────────────────────────────────────────
const crit = collectCriterion();
const critSections = Object.entries(crit).map(([group, rows]) => {
  const note = rows[0]?.throughput?.unit === 'Bytes' ? ' (throughput against uncompressed size)' : '';
  // Criterion writes a violin SVG + an interactive HTML report per group.
  const violinAbs = join(CRIT, group, 'report', 'violin.svg');
  const htmlAbs = join(CRIT, group, 'report', 'index.html');
  const violin = existsSync(violinAbs)
    ? `<details style="margin-top:10px;"><summary style="cursor:pointer;color:#94a3b8;font-size:12px;">Distribution (Criterion violin plot)</summary>
         <img src="../rust/target/criterion/${encodeURIComponent(group)}/report/violin.svg" alt="violin" style="width:100%;margin-top:8px;background:#fff;border-radius:8px;"/></details>` : '';
  const htmlLink = existsSync(htmlAbs)
    ? ` · <a href="../rust/target/criterion/${encodeURIComponent(group)}/report/index.html" style="color:#60a5fa;">interactive report ↗</a>` : '';
  return `<section class="card"><h3>${esc(group)}<span class="src rust">Rust · Criterion</span></h3>
    ${svgBars(rows)}<p class="hint">lower is better${note}${htmlLink}</p>${violin}</section>`;
}).join('\n');

let jsSections = '';
if (existsSync(JS)) {
  const jsData = JSON.parse(readFileSync(JS, 'utf8'));
  jsSections = jsData.suites.map((su) => {
    const rows = su.results.map((r) => ({ label: r.name, mean_ns: r.mean_ns, color: r.meta?.kind === 'optimized' ? '#10b981' : (r.meta?.kind === 'shipped' ? '#3b82f6' : '#a78bfa') }));
    return `<section class="card"><h3>${esc(su.suite)}<span class="src js">JS · micro-bench</span></h3>${svgBars(rows)}<p class="hint">lower is better</p></section>`;
  }).join('\n');
}

const hyper = collectHyperfine();
const hyperSections = hyper.length
  ? hyper.map((h) => {
      const rows = h.results.map((r) => ({ label: r.command, mean_ns: r.mean * 1e9, _sec: r.mean }));
      const mdLink = existsSync(join(HYPER, `${h.file}.md`)) ? ` · <a href="hyperfine/${encodeURIComponent(h.file)}.md" style="color:#60a5fa;">markdown table ↗</a>` : '';
      return `<section class="card"><h3>hyperfine: ${esc(h.file)}<span class="src e2e">E2E · process</span></h3>${svgBars(rows)}<p class="hint">whole-process wall time, lower is better${mdLink}</p></section>`;
    }).join('\n')
  : `<section class="card muted"><h3>hyperfine: end-to-end<span class="src e2e">E2E · process</span></h3>
     <p>No hyperfine results yet. Run <code>benchmarks/hyperfine/run.ps1</code> (Windows) or <code>run.sh</code> (POSIX) after installing hyperfine.</p></section>`;

const critLink = existsSync(join(CRIT, 'report', 'index.html'))
  ? `<a href="../rust/target/criterion/report/index.html">Open Criterion's full interactive report ↗</a>` : '';
const jsLink = existsSync(join(BENCH, 'js', 'results', 'js-report.html'))
  ? `<a href="../js/results/js-report.html">Open the standalone JS report ↗</a>` : '';

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BMM — Performance Benchmarks</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#0a0f1e; color:#e2e8f0; font:15px/1.55 system-ui,sans-serif; }
  header { padding:40px 40px 24px; background:linear-gradient(135deg,#0f1830,#0a0f1e); border-bottom:1px solid #1e293b; }
  h1 { margin:0 0 6px; font-size:28px; }
  header p { margin:0; color:#94a3b8; font-size:14px; }
  main { padding:28px 40px 60px; max-width:980px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.1em; color:#64748b; margin:34px 0 14px; }
  .card { background:#111a2e; border:1px solid #1e293b; border-radius:14px; padding:18px 22px; margin-bottom:16px; }
  .card.muted { color:#94a3b8; } .card code{ background:#0a0f1e; padding:2px 6px; border-radius:4px; }
  .card h3 { margin:0 0 12px; font-size:15px; color:#f1f5f9; display:flex; justify-content:space-between; align-items:center; }
  .src { font-size:10px; font-weight:700; padding:3px 8px; border-radius:99px; text-transform:uppercase; letter-spacing:.05em; }
  .src.rust{ background:rgba(251,146,60,.15); color:#fb923c; } .src.js{ background:rgba(96,165,250,.15); color:#60a5fa; } .src.e2e{ background:rgba(167,139,250,.15); color:#a78bfa; }
  .hint { color:#64748b; font-size:11px; margin:6px 0 0; }
  .legend{ display:flex; gap:16px; font-size:13px; margin:8px 0 0; color:#cbd5e1; }
  .legend i{ width:12px;height:12px;border-radius:3px;display:inline-block;vertical-align:-1px;margin-right:5px;}
  .links{ margin:10px 0 0; } .links a{ color:#60a5fa; margin-right:18px; font-size:13px; }
</style></head><body>
<header>
  <h1>BetterModsManager — Performance Benchmarks</h1>
  <p>Generated ${new Date().toISOString()} · Criterion (Rust hot-paths) + micro-benchmarks (frontend) + hyperfine (end-to-end)</p>
  <div class="legend"><span><i style="background:#3b82f6"></i>shipped / baseline</span><span><i style="background:#10b981"></i>optimized</span><span><i style="background:#fb923c"></i>Rust</span><span><i style="background:#a78bfa"></i>process E2E</span></div>
  <div class="links">${critLink}${jsLink}</div>
</header>
<main>
  <h2>Rust — Criterion (in-process, steady state)</h2>
  ${critSections || '<div class="card muted"><p>No Criterion data. Run <code>cargo bench</code> in <code>benchmarks/rust</code>.</p></div>'}
  <h2>Frontend — JS/TS micro-benchmarks</h2>
  ${jsSections || '<div class="card muted"><p>No JS data. Run <code>node bench.mjs</code> in <code>benchmarks/js</code>.</p></div>'}
  <h2>End-to-end — hyperfine (whole process)</h2>
  ${hyperSections}
</main></body></html>`;

mkdirSync(OUT_DIR, { recursive: true });
const file = join(OUT_DIR, 'index.html');
writeFileSync(file, html);
process.stdout.write(`Wrote ${file}\n`);
process.stdout.write(`  Criterion groups: ${Object.keys(crit).length}, hyperfine files: ${hyper.length}\n`);
