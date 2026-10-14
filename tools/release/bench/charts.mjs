// Inline SVG charts for the benchmark report (pure: strings in, strings out).
//
// Colours are roles, not hex: every mark carries a class and the CSS below (or the page's own
// variables) decides light or dark. The previous version is the muted grey series, this version
// the blue one (two series ⇒ always a legend); verdicts use the status colours AND a ▲ / ▼ / =
// glyph and a word, never colour alone. Each mark has a <title> (hover tooltip) and the report
// always carries the same numbers as a table.

import { fmtValue, pct } from './compare.mjs';

export const THEME = {
  light: { surface: '#fcfcfb', ink: '#0b0b0b', ink2: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', prev: '#a8a69f', cur: '#2a78d6', good: '#0ca30c', bad: '#d03b3b', same: '#c3c2b7', goodText: '#006300' },
  dark: { surface: '#1a1a19', ink: '#ffffff', ink2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835', prev: '#6b6a65', cur: '#3987e5', good: '#0ca30c', bad: '#e66767', same: '#5a5955', goodText: '#0ca30c' },
};

/** CSS for chart classes, from CSS variables (page) or fixed values (standalone PNG). */
export function chartCss(t) {
  const v = (k) => (t ? t[k] : `var(--c-${k})`);
  return `.cv-bg{fill:${v('surface')}}.cv-t{fill:${v('ink')};font:600 15px system-ui,-apple-system,'Segoe UI',sans-serif}
.cv-l{fill:${v('ink2')};font:12px system-ui,-apple-system,'Segoe UI',sans-serif}.cv-m{fill:${v('muted')};font:11px system-ui,-apple-system,'Segoe UI',sans-serif;font-variant-numeric:tabular-nums}
.cv-v{fill:${v('ink2')};font:11px system-ui,-apple-system,'Segoe UI',sans-serif;font-variant-numeric:tabular-nums}
.cv-grid{stroke:${v('grid')};stroke-width:1}.cv-axis{stroke:${v('axis')};stroke-width:1}
.cv-prev{fill:${v('prev')}}.cv-cur{fill:${v('cur')}}.cv-ci{stroke:${v('ink2')};stroke-width:1.2}
.cv-good{fill:${v('good')}}.cv-bad{fill:${v('bad')}}.cv-same{fill:${v('same')}}
.cv-gt{fill:${v('goodText')}}.cv-bt{fill:${v('bad')}}`;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** A rounded-end bar anchored at x0 (4 px radius on the data end only). */
function bar(x0, y, w, h, cls, title) {
  const r = Math.min(4, w / 2, h / 2);
  const d = w <= 0 ? '' : `M${x0},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${w - r}z`;
  return d ? `<path class="${cls}" d="${d}"><title>${esc(title)}</title></path>` : '';
}

/**
 * Grouped horizontal bars for one benchmark group. rows: [{ label, prev, next, verdict, change }]
 * (prev / next are metrics or null). labels: { prev: '1.0.0', next: '1.0.2' }.
 */
export function groupChart(title, rows, labels, { width = 880, theme = null, progress = 1 } = {}) {
  const left = 230, right = 150, top = 52, rowH = 34, w = width - left - right;
  const h = top + rows.length * rowH + 18;
  const max = Math.max(...rows.flatMap((r) => [r.prev?.hi ?? r.prev?.value ?? 0, r.next?.hi ?? r.next?.value ?? 0])) || 1;
  const sx = (v) => (v / max) * w * progress;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" role="img" aria-label="${esc(title)}">`,
    `<style>${chartCss(theme)}</style>`, `<rect class="cv-bg" width="${width}" height="${h}" rx="8"/>`,
    `<text class="cv-t" x="16" y="26">${esc(title)}</text>`,
    // legend (two series ⇒ always a legend)
    `<rect class="cv-prev" x="${width - 250}" y="15" width="12" height="12" rx="3"/><text class="cv-l" x="${width - 233}" y="25">${esc(labels.prev ?? 'previous')}</text>`,
    `<rect class="cv-cur" x="${width - 150}" y="15" width="12" height="12" rx="3"/><text class="cv-l" x="${width - 133}" y="25">${esc(labels.next)}</text>`];
  for (let k = 1; k <= 4; k++) out.push(`<line class="cv-grid" x1="${left + (w * k) / 4}" x2="${left + (w * k) / 4}" y1="${top - 6}" y2="${h - 14}"/>`);
  out.push(`<line class="cv-axis" x1="${left}" x2="${left}" y1="${top - 6}" y2="${h - 14}"/>`);
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    out.push(`<text class="cv-l" x="${left - 10}" y="${y + 17}" text-anchor="end">${esc(trunc(r.label, 34))}</text>`);
    const draw = (m, yy, cls, tag) => {
      if (!m) return;
      out.push(bar(left, yy, sx(m.value), 11, cls, `${r.label} (${tag}): ${fmtValue(m)}${m.lo != null ? ` [95 % ${fmtValue({ ...m, value: m.lo })} – ${fmtValue({ ...m, value: m.hi })}]` : ''}`));
      if (m.lo != null && progress >= 1) out.push(`<line class="cv-ci" x1="${left + sx(m.lo)}" x2="${left + sx(m.hi)}" y1="${yy + 5.5}" y2="${yy + 5.5}"/>`);
    };
    draw(r.prev, y + 3, 'cv-prev', labels.prev);
    draw(r.next, y + 16, 'cv-cur', labels.next);
    const end = left + Math.max(sx(r.prev?.value ?? 0), sx(r.next?.value ?? 0)) + 8;
    if (progress >= 1) {
      out.push(`<text class="cv-v" x="${end}" y="${y + 26}">${esc(fmtValue(r.next))}</text>`);
      const g = r.verdict === 'better' ? ['cv-gt', '▼ better'] : r.verdict === 'worse' ? ['cv-bt', '▲ worse'] : r.verdict === 'new' ? ['cv-m', 'new'] : ['cv-m', '= same'];
      out.push(`<text class="${g[0]} cv-v" x="${width - 12}" y="${y + 21}" text-anchor="end">${esc(r.change != null ? `${pct(r.change)} ${g[1]}` : g[1])}</text>`);
    }
  });
  out.push('</svg>');
  return out.join('\n');
}

/**
 * Diverging chart of the change of every compared metric (clamped to ±clamp), sorted.
 * rows: [{ label, change, verdict }].
 */
export function changeChart(title, rows, { width = 880, theme = null, clamp = 1, progress = 1, sub = '' } = {}) {
  const left = 300, right = 30, top = 62, rowH = 20;
  const w = width - left - right, mid = left + w / 2;
  const h = top + rows.length * rowH + 30;
  const sx = (c) => (Math.max(-clamp, Math.min(clamp, c)) / clamp) * (w / 2) * progress;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" role="img" aria-label="${esc(title)}">`,
    `<style>${chartCss(theme)}</style>`, `<rect class="cv-bg" width="${width}" height="${h}" rx="8"/>`,
    `<text class="cv-t" x="16" y="26">${esc(title)}</text>`, `<text class="cv-m" x="16" y="46">${esc(sub)}</text>`];
  for (const k of [-1, -0.5, 0.5, 1]) {
    const x = mid + (k * w) / 2;
    out.push(`<line class="cv-grid" x1="${x}" x2="${x}" y1="${top - 6}" y2="${h - 22}"/><text class="cv-m" x="${x}" y="${h - 8}" text-anchor="middle">${k > 0 ? '+' : ''}${Math.round(k * clamp * 100)} %</text>`);
  }
  out.push(`<line class="cv-axis" x1="${mid}" x2="${mid}" y1="${top - 6}" y2="${h - 22}"/><text class="cv-m" x="${mid}" y="${h - 8}" text-anchor="middle">0</text>`);
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const cls = r.verdict === 'better' ? 'cv-good' : r.verdict === 'worse' ? 'cv-bad' : 'cv-same';
    out.push(`<text class="cv-l" x="${left - 10}" y="${y + 13}" text-anchor="end">${esc(trunc(r.label, 46))}</text>`);
    const dx = sx(r.change);
    const tip = `${r.label}: ${pct(r.change)} (${r.verdict})`;
    if (dx >= 0) out.push(bar(mid, y + 4, Math.max(dx, 1.5), 11, cls, tip));
    else out.push(`<g transform="translate(${mid * 2},0) scale(-1,1)">${bar(mid, y + 4, Math.max(-dx, 1.5), 11, cls, tip)}</g>`);
  });
  out.push('</svg>');
  return out.join('\n');
}
