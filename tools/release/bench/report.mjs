// BENCHMARK.md / BENCHMARK_FR.md / BENCHMARK.html + charts (PNG) + an animated GIF, from two
// summaries (previous version, this version).

import { join } from 'node:path';
import { writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { compareSummaries, tally, fmtValue, pct, throughputText } from './compare.mjs';
import { explain, unitText, SOURCES } from './metrics.mjs';
import { groupChart, changeChart, THEME, chartCss } from './charts.mjs';
import { writeText } from '../lib/util.mjs';
import { run } from '../lib/exec.mjs';

const T = {
  en: {
    title: (v) => `BMM ${v} benchmarks`, vs: (p) => `compared with ${p}`, noPrev: 'No previous results were found: every number is a first measurement.',
    intro: 'Every benchmark below says what it measures, why it matters to you, its unit, and how this version compares with the previous one. Times are means; lower is better everywhere.',
    howToRead: 'How to read the verdicts', rule: (n1, n2) => `**better** / **worse** only when the change is beyond the noise (±${n1} % for timed runs with an interval, ±${n2} % for single runs) **and** the two 95 % confidence intervals do not overlap (and Criterion\'s own change interval, when it compared against the previous version, does not include zero). Everything else is **same**: a difference that the measurement cannot separate from noise. **new** = not measured before.`,
    summary: 'Summary', machine: 'Machine and toolchain', caveats: 'Caveats', group: 'Benchmark', what: 'What it measures', why: 'Why it matters', unit: 'Unit',
    cols: ['Case', 'Previous', 'This version', 'Change', '95 % interval of the change', 'Throughput', 'Verdict'], counts: (t) => `${t.better} better, ${t.worse} worse, ${t.same} same, ${t.new} new${t.gone ? `, ${t.gone} not measured any more` : ''}.`,
    verdicts: { better: '▼ better', worse: '▲ worse', same: '= same', new: 'new', gone: 'not measured' }, overview: 'Every change at a glance', overviewSub: 'Relative change of the mean, this version vs previous (clamped to ±100 %). Left = faster or smaller.',
    sources: 'The four kinds of measurement', files: 'Files', biggest: 'Largest changes',
  },
  fr: {
    title: (v) => `Benchmarks de BMM ${v}`, vs: (p) => `comparés à la ${p}`, noPrev: 'Aucun résultat précédent : chaque chiffre est une première mesure.',
    intro: 'Chaque mesure ci-dessous dit ce qu\'elle mesure, pourquoi elle compte pour vous, son unité, et comment cette version se compare à la précédente. Les temps sont des moyennes ; plus bas = mieux partout.',
    howToRead: 'Lire les verdicts', rule: (n1, n2) => `**mieux** / **moins bien** seulement quand l\'écart dépasse le bruit (±${n1} % pour les mesures avec intervalle, ±${n2} % pour les mesures uniques) **et** que les deux intervalles de confiance à 95 % ne se chevauchent pas (et que l\'intervalle de variation de Criterion, quand il a comparé à la version précédente, ne contient pas zéro). Sinon **identique** : un écart que la mesure ne distingue pas du bruit. **nouveau** = pas mesuré avant.`,
    summary: 'Résumé', machine: 'Machine et outils', caveats: 'Limites', group: 'Mesure', what: 'Ce qui est mesuré', why: 'Pourquoi c\'est important', unit: 'Unité',
    cols: ['Cas', 'Précédente', 'Cette version', 'Écart', 'Intervalle à 95 % de l\'écart', 'Débit', 'Verdict'], counts: (t) => `${t.better} mieux, ${t.worse} moins bien, ${t.same} identiques, ${t.new} nouvelles${t.gone ? `, ${t.gone} plus mesurées` : ''}.`,
    verdicts: { better: '▼ mieux', worse: '▲ moins bien', same: '= identique', new: 'nouveau', gone: 'plus mesuré' }, overview: 'Tous les écarts d\'un coup d\'œil', overviewSub: 'Variation relative de la moyenne, cette version contre la précédente (bornée à ±100 %). À gauche = plus rapide ou plus petit.',
    sources: 'Les quatre types de mesure', files: 'Fichiers', biggest: 'Plus grands écarts',
  },
};

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** Rows grouped by (source, group), in a stable order. */
export function groupRows(rows) {
  const order = ['criterion', 'js', 'hyperfine', 'mem'];
  const map = new Map();
  for (const r of rows) {
    const m = r.next ?? r.prev;
    const key = `${m.source}|${m.group}`;
    if (!map.has(key)) map.set(key, { source: m.source, group: m.group, rows: [] });
    map.get(key).rows.push(r);
  }
  return [...map.values()].sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source));
}

function mdReport(lang, prev, next, rows, groups, charts) {
  const t = T[lang];
  const tl = tally(rows.filter((r) => !explain(r.next ?? r.prev).ignore));
  const out = [`# ${t.title(next.version)}${prev ? ` (${t.vs(prev.version)})` : ''}`, ''];
  if (next.valid === false) {
    out.push(lang === 'fr'
      ? `> **⚠ Mesures NON VALABLES** : ${next.invalidReason}. Les écarts ci-dessous viennent de la machine occupée, pas de BMM. Relancez sur une machine au repos (\`node tools/release/bench/run.mjs --version ${next.version}\`) ; ce résumé ne servira jamais de référence.`
      : `> **⚠ INVALID run**: ${next.invalidReason}. The deltas below come from the busy machine, not from BMM. Run it again on an idle machine (\`node tools/release/bench/run.mjs --version ${next.version}\`); this summary is never used as a baseline.`, '');
  }
  out.push(t.intro, '');
  if (!prev) out.push(`> ${t.noPrev}`, '');
  out.push(`## ${t.summary}`, '', t.counts(tl), '');
  if (charts.overview) out.push(`![${t.overview}](charts/${charts.overview})`, '');
  const big = rows.filter((r) => r.verdict === 'better' || r.verdict === 'worse').sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 8);
  if (big.length) {
    out.push(`### ${t.biggest}`, '');
    for (const r of big) out.push(`- ${t.verdicts[r.verdict]} **${pct(r.change)}**: ${r.next.group} / ${r.next.name} (${fmtValue(r.prev)} → ${fmtValue(r.next)})`);
    out.push('');
  }
  out.push(`### ${t.howToRead}`, '', t.rule(5, 15), '');
  out.push(`### ${t.sources}`, '');
  for (const k of ['criterion', 'js', 'hyperfine', 'mem']) out.push(`- ${SOURCES[k][lang]}`);
  out.push('');
  for (const g of groups) {
    const ex = explain(g.rows[0].next ?? g.rows[0].prev, lang);
    out.push(`## ${g.group}`, '');
    out.push(`- **${t.what}:** ${ex.what}`, `- **${t.why}:** ${ex.why}`, `- **${t.unit}:** ${unitText(g.rows[0].next ?? g.rows[0].prev, lang)}`, '');
    if (charts[g.key]) out.push(`![${g.group}](charts/${charts[g.key]})`, '');
    if (ex.ignore) continue;
    out.push(`| ${t.cols.join(' | ')} |`, `|${t.cols.map((_, i) => (i === 0 ? '---' : i === 6 ? ':---:' : '---:')).join('|')}|`);
    for (const r of g.rows) {
      const m = r.next ?? r.prev;
      out.push(`| ${m.name} | ${fmtValue(r.prev)} | ${fmtValue(r.next)} | ${pct(r.change)} | ${r.lo != null ? `${pct(r.lo)} … ${pct(r.hi)}` : '-'} | ${throughputText(r.next) ?? '-'} | ${t.verdicts[r.verdict]} |`);
    }
    out.push('');
  }
  out.push(`## ${t.machine}`, '');
  const mi = (s, label) => {
    out.push(`**${label}** (${s.version}${s.capturedAt ? `, ${String(s.capturedAt.from).slice(0, 10)} – ${String(s.capturedAt.to).slice(0, 10)}` : ''}${s.commit ? `, commit \`${s.commit.slice(0, 10)}\`` : ''})`, '');
    for (const [k, v] of Object.entries(s.machine ?? {})) if (v != null) out.push(`- ${k}: ${v}`);
    out.push('');
  };
  if (prev) mi(prev, lang === 'fr' ? 'Précédente' : 'Previous');
  mi(next, lang === 'fr' ? 'Cette version' : 'This version');
  out.push(`## ${t.caveats}`, '');
  for (const c of next.caveats?.[lang] ?? []) out.push(`- ${c}`);
  out.push('');
  return out.join('\n');
}

function htmlReport(prev, next, rows, groups, svgs, mdEn) {
  const t = T.en;
  const tl = tally(rows.filter((r) => !explain(r.next ?? r.prev).ignore));
  const css = (th) => Object.entries(th).map(([k, v]) => `--c-${k}:${v}`).join(';');
  const table = (g) => `<table><thead><tr>${t.cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${g.rows.map((r) => {
    const m = r.next ?? r.prev;
    return `<tr><td>${esc(m.name)}</td><td>${fmtValue(r.prev)}</td><td>${fmtValue(r.next)}</td><td>${pct(r.change)}</td><td>${r.lo != null ? `${pct(r.lo)} … ${pct(r.hi)}` : '-'}</td><td>${throughputText(r.next) ?? '-'}</td><td class="v-${r.verdict}">${t.verdicts[r.verdict]}</td></tr>`;
  }).join('')}</tbody></table>`;
  const sections = groups.map((g) => {
    const ex = explain(g.rows[0].next ?? g.rows[0].prev, 'en');
    const fr = explain(g.rows[0].next ?? g.rows[0].prev, 'fr');
    return `<section id="${g.key}"><h2>${esc(g.group)}</h2><p><b>What:</b> ${esc(ex.what)}<br><b>Why:</b> ${esc(ex.why)}<br><b>Unit:</b> ${esc(unitText(g.rows[0].next ?? g.rows[0].prev))}</p>
<details><summary>En français</summary><p>${esc(fr.what)} ${esc(fr.why)}</p></details>
<div class="chart">${svgs[g.key] ?? ''}</div>${ex.ignore ? '' : table(g)}</section>`;
  }).join('\n');
  const mi = (s) => `<dl>${Object.entries(s.machine ?? {}).filter(([, v]) => v != null).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BMM ${next.version} benchmarks</title><style>
:root{color-scheme:light;${css(THEME.light)};--page:#f9f9f7;--card:#fcfcfb;--line:#c9c8bf}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;${css(THEME.dark)};--page:#0d0d0d;--card:#1a1a19;--line:#2c2c2a}}
:root[data-theme="dark"]{color-scheme:dark;${css(THEME.dark)};--page:#0d0d0d;--card:#1a1a19;--line:#2c2c2a}
${chartCss(null)}
body{margin:0;background:var(--page);color:var(--c-ink);font:15px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px 64px}h1{font-size:28px;margin:8px 0}h2{margin-top:40px;font-size:20px}
p,li,dd{color:var(--c-ink2)}section,.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:4px 16px 16px;margin:16px 0}
.chart svg{width:100%;height:auto}table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums;display:block;overflow-x:auto}
th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}th:first-child,td:first-child{text-align:left;white-space:normal}
.v-better{color:var(--c-goodText);font-weight:600}.v-worse{color:var(--c-bad);font-weight:600}.v-same,.v-new{color:var(--c-muted)}
.tiles{display:flex;gap:12px;flex-wrap:wrap}.tile{flex:1 1 120px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}
.tile b{display:block;font-size:26px}nav a{margin-right:12px;color:var(--c-cur)}dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px}dt{font-weight:600}
button{float:right;background:var(--card);color:var(--c-ink);border:1px solid var(--line);border-radius:8px;padding:6px 10px;cursor:pointer}
</style></head><body><main>
<button id="theme" type="button">Light / dark</button>
<h1>${esc(t.title(next.version))}${prev ? ` <small style="font-weight:400;color:var(--c-muted)">${esc(t.vs(prev.version))}</small>` : ''}</h1>
${next.valid === false ? `<div class="card" style="border-color:var(--c-bad)"><p><b class="v-worse">⚠ INVALID run:</b> ${esc(next.invalidReason)}. The deltas below come from the busy machine, not from BMM; run it again on an idle machine. This summary is never used as a baseline.</p></div>` : ''}
<p>${esc(t.intro)}</p>
<div class="tiles"><div class="tile"><b class="v-better">${tl.better}</b>better</div><div class="tile"><b class="v-worse">${tl.worse}</b>worse</div><div class="tile"><b>${tl.same}</b>same</div><div class="tile"><b>${tl.new}</b>new</div></div>
<div class="card"><h2>How to read the verdicts</h2><p>${md2html(t.rule(5, 15))}</p><ul>${['criterion', 'js', 'hyperfine', 'mem'].map((k) => `<li>${esc(SOURCES[k].en)}</li>`).join('')}</ul></div>
${svgs.overview ? `<section><h2>${esc(t.overview)}</h2><div class="chart">${svgs.overview}</div></section>` : ''}
<nav>${groups.map((g) => `<a href="#${g.key}">${esc(g.group)}</a>`).join(' ')}</nav>
${sections}
<section><h2>${esc(t.machine)}</h2>${prev ? `<h3>Previous: ${esc(prev.version)}</h3>${mi(prev)}` : ''}<h3>This version: ${esc(next.version)}</h3>${mi(next)}</section>
<section><h2>${esc(t.caveats)}</h2><ul>${(next.caveats?.en ?? []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul></section>
</main><script>
(function(){var b=document.getElementById('theme'),r=document.documentElement;var k='bmm-bench-theme';try{var s=localStorage.getItem(k);if(s)r.dataset.theme=s}catch(e){}
b.onclick=function(){var d=r.dataset.theme?r.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;r.dataset.theme=d?'light':'dark';try{localStorage.setItem(k,r.dataset.theme)}catch(e){}}})();
</script></body></html>`;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const md2html = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

/**
 * Write the whole report. opts: { browser (puppeteer, optional), ffmpeg (path or null), log }.
 * Returns { files, tally, rows }.
 */
export async function writeReport(outDir, prev, next, { browser = null, ffmpeg = null, log = null } = {}) {
  mkdirSync(join(outDir, 'charts'), { recursive: true });
  const rows = compareSummaries(prev, next);
  const groups = groupRows(rows).map((g) => ({ ...g, key: slug(`${g.source}-${g.group}`) }));
  const labels = { prev: prev?.version ?? 'previous', next: next.version };
  const chartRows = (g) => g.rows.map((r) => ({ label: (r.next ?? r.prev).name, prev: r.prev, next: r.next, verdict: r.verdict, change: r.change }));
  const svgs = {}, svgsLight = {};
  for (const g of groups) {
    if (explain(g.rows[0].next ?? g.rows[0].prev).ignore) continue;
    svgs[g.key] = groupChart(g.group, chartRows(g), labels);
    svgsLight[g.key] = groupChart(g.group, chartRows(g), labels, { theme: THEME.light });
  }
  const compared = rows.filter((r) => r.change != null && !explain(r.next ?? r.prev).ignore).map((r) => ({ label: `${(r.next ?? r.prev).group.replace(/\s*\(.*$/, '').slice(0, 22)} · ${(r.next ?? r.prev).name}`, change: r.change, verdict: r.verdict }))
    .sort((a, b) => a.change - b.change);
  if (compared.length) {
    const sub = `${T.en.overviewSub} ${labels.next} vs ${labels.prev}.`;
    svgs.overview = changeChart(T.en.overview, compared, { sub });
    svgsLight.overview = changeChart(T.en.overview, compared, { sub, theme: THEME.light });
  }
  const files = [];
  const charts = {};
  for (const [k, svg] of Object.entries(svgsLight)) {
    const f = `${k}.svg`;
    writeText(join(outDir, 'charts', f), svg);
    charts[k] = f;
  }
  if (browser) {
    const page = await browser.newPage();
    try {
      for (const [k, svg] of Object.entries(svgsLight)) {
        const w = +/width="(\d+)"/.exec(svg)[1], h = +/height="(\d+)"/.exec(svg)[1];
        await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
        await page.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0}</style>${svg}`);
        await page.screenshot({ path: join(outDir, 'charts', `${k}.png`), clip: { x: 0, y: 0, width: w, height: h } });
        charts[k] = `${k}.png`;
      }
      // GIF: the overview growing from zero, frames assembled by ffmpeg (palette-optimised).
      if (ffmpeg && compared.length) {
        const fdir = join(outDir, 'charts', '.frames');
        rmSync(fdir, { recursive: true, force: true }); mkdirSync(fdir, { recursive: true });
        const N = 24;
        for (let i = 0; i <= N + 12; i++) {
          const p = Math.min(1, i / N), e = 1 - (1 - p) ** 3;
          const svg = changeChart(T.en.overview, compared, { sub: `${T.en.overviewSub}`, theme: THEME.light, progress: e });
          const w = +/width="(\d+)"/.exec(svg)[1], h = +/height="(\d+)"/.exec(svg)[1];
          await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
          await page.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0}</style>${svg}`);
          await page.screenshot({ path: join(fdir, `f${String(i).padStart(3, '0')}.png`), clip: { x: 0, y: 0, width: w, height: h } });
        }
        const gif = join(outDir, 'charts', 'overview.gif');
        const r = await run(ffmpeg, ['-y', '-v', 'error', '-framerate', '12', '-i', join(fdir, 'f%03d.png'),
          '-vf', 'split[a][b];[a]palettegen=max_colors=64:stats_mode=full[p];[b][p]paletteuse=dither=none', '-loop', '0', gif], { log, quiet: true });
        if (r.code === 0 && existsSync(gif)) files.push('charts/overview.gif');
        rmSync(fdir, { recursive: true, force: true });
      }
    } finally { await page.close(); }
  }
  const mdEn = mdReport('en', prev, next, rows, groups, charts);
  writeText(join(outDir, 'BENCHMARK.md'), mdEn);
  writeText(join(outDir, 'BENCHMARK_FR.md'), mdReport('fr', prev, next, rows, groups, charts));
  writeText(join(outDir, 'BENCHMARK.html'), htmlReport(prev, next, rows, groups, svgs, mdEn));
  writeText(join(outDir, 'comparison.json'), JSON.stringify({ previous: prev?.version ?? null, version: next.version, tally: tally(rows), rows: rows.map((r) => ({ id: r.id, prev: r.prev?.value ?? null, next: r.next?.value ?? null, unit: (r.next ?? r.prev).unit, change: r.change, lo: r.lo ?? null, hi: r.hi ?? null, verdict: r.verdict, reason: r.reason })) }, null, 2) + '\n');
  files.push('BENCHMARK.md', 'BENCHMARK_FR.md', 'BENCHMARK.html', 'comparison.json', ...readdirSync(join(outDir, 'charts')).filter((f) => /\.(png|svg)$/.test(f)).map((f) => `charts/${f}`));
  return { files: [...new Set(files)], tally: tally(rows), rows };
}
