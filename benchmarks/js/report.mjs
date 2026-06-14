// Renders benchmarks/js/results/js-results.json into a self-contained HTML page
// with inline SVG bar charts (no external deps). Run: `node report.mjs`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(__dirname, 'results');
const data = JSON.parse(readFileSync(join(RESULTS, 'js-results.json'), 'utf8'));

const fmt = (ns) =>
  ns < 1e3 ? `${ns.toFixed(0)} ns` :
  ns < 1e6 ? `${(ns / 1e3).toFixed(2)} µs` :
  ns < 1e9 ? `${(ns / 1e6).toFixed(2)} ms` : `${(ns / 1e9).toFixed(2)} s`;

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function barChart(suite) {
  const rows = suite.results;
  const max = Math.max(...rows.map((r) => r.mean_ns));
  const W = 720, rowH = 38, padL = 250, padR = 120, top = 12;
  const H = top + rows.length * rowH + 12;
  const barW = W - padL - padR;
  const color = (r) => (r.meta?.kind === 'optimized' ? '#10b981' : (r.meta?.kind === 'shipped' ? '#3b82f6' : '#a78bfa'));

  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="ui-sans-serif,system-ui,sans-serif">`;
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const w = max > 0 ? Math.max(2, (r.mean_ns / max) * barW) : 2;
    const ratio = r.relative ? `${r.relative.toFixed(2)}×` : '';
    svg += `<text x="${padL - 10}" y="${y + 20}" text-anchor="end" font-size="12" fill="#cbd5e1">${esc(r.name)}</text>`;
    svg += `<rect x="${padL}" y="${y + 6}" width="${w}" height="20" rx="5" fill="${color(r)}"/>`;
    svg += `<text x="${padL + w + 8}" y="${y + 20}" font-size="11" fill="#e2e8f0">${fmt(r.mean_ns)} · ±${r.rme_pct.toFixed(1)}% · ${ratio}</text>`;
  });
  svg += `</svg>`;
  return svg;
}

const charts = data.suites.map((s) => `
  <section class="card">
    <h2>${esc(s.suite)}</h2>
    ${barChart(s)}
  </section>`).join('\n');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BMM — JS/TS Micro-Benchmarks</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0b1120; color: #e2e8f0; font: 15px/1.5 ui-sans-serif,system-ui,sans-serif; padding: 32px; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .meta { color: #94a3b8; font-size: 13px; margin-bottom: 24px; }
  .card { background: #111a2e; border: 1px solid #1e293b; border-radius: 14px; padding: 18px 22px; margin-bottom: 18px; }
  .card h2 { font-size: 15px; font-weight: 700; margin: 0 0 10px; color: #f1f5f9; }
  .legend { display: flex; gap: 18px; font-size: 13px; margin-bottom: 20px; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .dot { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
  footer { color: #64748b; font-size: 12px; margin-top: 24px; }
</style></head><body>
  <h1>BMM — Frontend Micro-Benchmarks</h1>
  <div class="meta">Generated ${esc(data.generatedAt)} · Node ${esc(data.node)} · ${esc(data.platform)} · lower is better, ratio vs fastest in each suite</div>
  <div class="legend">
    <span><i class="dot" style="background:#3b82f6"></i> shipped</span>
    <span><i class="dot" style="background:#10b981"></i> optimized</span>
    <span><i class="dot" style="background:#a78bfa"></i> other</span>
  </div>
  ${charts}
  <footer>Hot-paths mirrored verbatim from frontend/src (mods-list.ts getFilteredMods, core/i18n.ts t()). Optimized variants are validated equal to shipped before timing.</footer>
</body></html>`;

const file = join(RESULTS, 'js-report.html');
writeFileSync(file, html);
process.stdout.write(`Wrote ${file}\n`);
