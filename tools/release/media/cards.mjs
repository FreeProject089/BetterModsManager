// Release cards (social, Discord, blog header, square, « what's new »), parameterised by version.
// Successor of Release/1.0.2/media/make-cards.mjs: same look, but
//   - the version comes from the caller (every card and file name says it);
//   - every card is a LAYERED SVG (Inkscape layers + ids Illustrator/Affinity read as layer
//     names): background, logo, title, version, subtitle, chips/features, footer;
//   - each card is also written as a layered PSD (one raster layer per SVG layer), and as PNG.
//
//   node tools/release/media/cards.mjs --version 1.0.3 [--out Release/1.0.3/media]

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { cardText, cardSpecs, fitChips } from './cards-text.mjs';
import { ROOT, TOOL_DIR, writeText, releaseDir, ensureDir, readJson } from '../lib/util.mjs';
import { launch, svgToPng } from '../lib/browser.mjs';
import { decodePng } from '../lib/png.mjs';
import { writePsd } from '../lib/psd.mjs';
import { writeFileSync } from 'node:fs';
import { ratio, blend, AA } from '../lib/contrast.mjs';

export const C = { bg: '#121315', bg2: '#1b1c20', yellow: '#ffcc00', ink: '#f4f4f5', muted: '#c9c9d2', faint: '#3f3f46', tile: '#ececec' };
export const FONT = "'Segoe UI Variable Display','Segoe UI',Inter,'Helvetica Neue',Arial,sans-serif";
export const FONT_NOTE = 'Fonts: Segoe UI Variable Display / Segoe UI (Windows), fallback Inter, Helvetica Neue, Arial. Weights 500, 600, 700, 800.';

// Every text colour of a card, with the colour it sits on (the glow and the translucent panels
// are blended in), so the tests and the step can measure WCAG contrast instead of trusting the eye.
export const TEXT_PAIRS = [
  ['title and kicker', C.ink, C.bg2], ['version', C.yellow, blend(C.yellow, C.bg2, 0.16)],
  ['subtitle, footer, feature text', C.muted, blend('#ffffff', C.bg, 0.06)], ['subtitle on the field', C.muted, C.bg2],
  ['chip text', C.ink, blend(C.yellow, C.bg, 0.16)], ['feature title', C.ink, blend('#ffffff', C.bg, 0.06)],
];
/** { min, rows: [{ what, ratio }] } over TEXT_PAIRS. AA for body text is 4.5. */
export function cardContrast() {
  const rows = TEXT_PAIRS.map(([what, fg, bg]) => ({ what, ratio: +ratio(fg, bg).toFixed(2), ok: ratio(fg, bg) >= AA }));
  return { min: Math.min(...rows.map((r) => r.ratio)), rows };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function logoHref() {
  const p = [join(ROOT, '.Assets', 'AssetsoTH', 'BMMLogo.svg'), join(ROOT, 'frontend', 'assets', 'BMm.png')].find(existsSync);
  if (!p) return null;
  return `data:${p.endsWith('.svg') ? 'image/svg+xml' : 'image/png'};base64,${readFileSync(p).toString('base64')}`;
}

/** Card wording: tools/release/media/cards.<v>.json, else Release/<v>/media/cards.json, else defaults. */
export function loadCustomText(version) {
  for (const p of [join(TOOL_DIR, 'media', `cards.${version}.json`), join(releaseDir(version), 'media', 'cards.json')]) if (existsSync(p)) return { custom: readJson(p), from: p };
  return { custom: null, from: null };
}

const layer = (id, label, body) => ({ id, label, body });

function background(w, h, gx, gy) {
  return layer('background', 'Background', `
    <defs>
      <radialGradient id="glow" cx="${gx}" cy="${gy}" r="${Math.max(w, h) * 0.55}" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="${C.yellow}" stop-opacity="0.16"/><stop offset="1" stop-color="${C.yellow}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="field" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.bg2}"/><stop offset="1" stop-color="${C.bg}"/></linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#field)"/><rect width="${w}" height="${h}" fill="url(#glow)"/><rect x="0" y="0" width="${w}" height="6" fill="${C.yellow}"/>`);
}

function logoTile(x, y, size, href) {
  const r = Math.round(size * 0.22);
  return layer('logo', 'Logo', `
    <clipPath id="logo-clip"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}"/></clipPath>
    <rect x="${x}" y="${y + size * 0.04}" width="${size}" height="${size}" rx="${r}" fill="#000" opacity="0.35"/>
    <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}" fill="${C.tile}"/>
    ${href ? `<image href="${href}" x="${x}" y="${y}" width="${size}" height="${size}" clip-path="url(#logo-clip)"/>` : ''}`);
}

function chipsBody(x, y, list, fs, center, maxW) {
  const f = fitChips(list, fs, maxW);
  let cx = center ? x - f.total / 2 : x;
  return f.items.map((c, i) => {
    const s = `<rect x="${cx}" y="${y}" width="${f.widths[i]}" height="${f.h}" rx="${f.h / 2}" fill="${C.yellow}" fill-opacity="0.16" stroke="${C.yellow}" stroke-opacity="0.75"/>
    <text x="${cx + f.widths[i] / 2}" y="${y + f.h * 0.66}" text-anchor="middle" fill="${C.ink}" font-size="${fs}" font-weight="700">${esc(c)}</text>`;
    cx += f.widths[i] + f.gap;
    return s;
  }).join('');
}

const txt = (x, y, fill, size, weight, s, extra = '') => `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" ${extra}>${s}</text>`;

/** Layers of one card. */
export function cardLayers(spec, t, href) {
  const { w, h } = spec;
  if (spec.layout === 'wide') {
    const s = spec.s, tile = Math.round(h * 0.5 * s.tile), tx = Math.round(w * s.left), ty = Math.round((h - tile) / 2 - h * 0.03);
    const x = tx + tile + Math.round(w * 0.05), cy = h / 2;
    return [background(w, h, tx + tile / 2, cy), logoTile(tx, ty, tile, href),
      layer('title', 'Title', txt(x, cy - h * 0.15, C.ink, Math.round(h * 0.075 * s.text), 600, esc(t.kicker))),
      layer('version', 'Version', txt(x - 4, cy + h * 0.11, C.yellow, Math.round(h * 0.27 * s.text), 800, esc(t.version), 'letter-spacing="-2"')),
      layer('subtitle', 'Subtitle', txt(x, cy + h * 0.215, C.muted, Math.round(h * 0.044 * s.text), 600, esc(t.sub))),
      layer('chips', 'Chips', chipsBody(x, cy + h * 0.265, t.chips, Math.round(h * 0.03), false, w - x - Math.round(w * s.left))),
      layer('footer', 'Footer', `${txt(Math.round(w * s.left), h - Math.round(h * 0.07), C.muted, Math.round(h * 0.032), 600, esc(t.foot))}
        <rect x="${Math.round(w * s.left)}" y="${h - Math.round(h * 0.125)}" width="${w - 2 * Math.round(w * s.left)}" height="1" fill="${C.faint}"/>`)];
  }
  if (spec.layout === 'square') {
    const size = w, tile = Math.round(size * 0.34), tx = Math.round((size - tile) / 2), ty = Math.round(size * 0.13), cx = size / 2;
    const mid = 'text-anchor="middle"';
    return [background(size, size, cx, ty + tile / 2), logoTile(tx, ty, tile, href),
      layer('title', 'Title', txt(cx, size * 0.6, C.ink, Math.round(size * 0.052), 600, esc(t.kicker), mid)),
      layer('version', 'Version', txt(cx, size * 0.775, C.yellow, Math.round(size * 0.17), 800, esc(t.version), `${mid} letter-spacing="-2"`)),
      layer('subtitle', 'Subtitle', txt(cx, size * 0.84, C.muted, Math.round(size * 0.032), 600, esc(t.sub), mid)),
      layer('chips', 'Chips', chipsBody(cx, size * 0.865, t.chips.slice(0, 3), Math.round(size * 0.02), true, size * 0.9)),
      layer('footer', 'Footer', txt(cx, size * 0.96, C.muted, Math.round(size * 0.024), 600, esc(t.foot), mid))];
  }
  // features
  const m = Math.round(w * 0.06), tile = Math.round(h * 0.15);
  const cols = 2, rows = 3, top = m + tile + Math.round(h * 0.07), gap = Math.round(w * 0.02);
  const cw = (w - 2 * m - gap) / cols, ch = (h - top - m * 1.2 - gap * (rows - 1)) / rows;
  const cells = t.features.map(([title, desc], i) => {
    const x = m + (i % cols) * (cw + gap), y = top + Math.floor(i / cols) * (ch + gap);
    return `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="14" fill="#ffffff" fill-opacity="0.06" stroke="#52525b"/>
    <rect x="${x}" y="${y + ch * 0.22}" width="4" height="${ch * 0.56}" rx="2" fill="${C.yellow}"/>
    ${txt(x + 24, y + ch * 0.45, C.ink, Math.round(h * 0.038), 700, esc(title))}
    ${txt(x + 24, y + ch * 0.75, C.muted, Math.round(h * 0.029), 600, esc(desc))}`;
  }).join('');
  return [background(w, h, w * 0.15, h * 0.1), logoTile(m, m, tile, href),
    layer('version', 'Version', `<text x="${m + tile + 22}" y="${m + tile * 0.42}" fill="${C.muted}" font-size="${Math.round(h * 0.034)}" font-weight="700">${esc(t.kicker)} <tspan fill="${C.yellow}" font-weight="800">${esc(t.version)}</tspan></text>`),
    layer('title', 'Title', txt(m + tile + 22, m + tile * 0.9, C.ink, Math.round(h * 0.06), 800, esc(t.whatsNew))),
    layer('features', 'Features', cells)];
}

/**
 * The SVG of a card. only = layer id to keep alone (for PSD layers), null = all.
 * source = true adds the Inkscape layer attributes and the font note.
 */
export function assembleSvg(w, h, layers, { only = null, source = true, note = FONT_NOTE } = {}) {
  const ns = source ? ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"' : '';
  const body = layers.map((L) => {
    const attrs = source ? ` inkscape:groupmode="layer" inkscape:label="${L.label}"` : '';
    // Defs (gradients, clip paths) stay in every partial render so a lone layer still draws.
    const hide = only && only !== L.id;
    const content = hide ? (L.body.match(/<defs>[\s\S]*?<\/defs>|<clipPath[\s\S]*?<\/clipPath>/g) || []).join('') : L.body;
    return `  <g id="${L.id}"${attrs} font-family="${FONT}">${content}</g>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"${ns} width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${source ? `<!-- ${note} Layers: ${layers.map((l) => l.label).join(', ')}. Generated by tools/release; edit the layers, not the PNG. -->\n  <desc>${esc(note)}</desc>` : ''}
${body}
</svg>`;
}

/** Rasterise every layer alone + the whole, and pack a PSD. */
export async function layeredPsd(browser, w, h, layers) {
  const psdLayers = [];
  for (const L of layers) {
    const png = await svgToPng(browser, assembleSvg(w, h, layers, { only: L.id, source: false }), w, h, { transparent: true });
    psdLayers.push({ name: L.label, rgba: decodePng(png).data });
  }
  const full = await svgToPng(browser, assembleSvg(w, h, layers, { source: false }), w, h, { transparent: true });
  return { psd: writePsd({ width: w, height: h, layers: psdLayers, composite: decodePng(full).data, matte: [18, 19, 21] }), png: full };
}

/** Write every card of `version`: PNG in outDir, layered SVG + PSD in outDir/source. */
export async function renderCards(version, { outDir = join(releaseDir(version), 'media'), browser = null, psd = true, log = console } = {}) {
  const { custom, from } = loadCustomText(version);
  const href = logoHref();
  const src = ensureDir(join(outDir, 'source'));
  const written = [];
  for (const spec of cardSpecs(version)) {
    const t = cardText(version, spec.lang, custom);
    const layers = cardLayers(spec, t, href);
    const svg = assembleSvg(spec.w, spec.h, layers);
    writeText(join(src, `${spec.name}.svg`), svg); written.push(`source/${spec.name}.svg`);
    if (browser) {
      if (psd) {
        const r = await layeredPsd(browser, spec.w, spec.h, layers);
        writeFileSync(join(src, `${spec.name}.psd`), r.psd); written.push(`source/${spec.name}.psd`);
        writeFileSync(join(outDir, `${spec.name}.png`), r.png);
      } else writeFileSync(join(outDir, `${spec.name}.png`), await svgToPng(browser, assembleSvg(spec.w, spec.h, layers, { source: false }), spec.w, spec.h));
      written.push(`${spec.name}.png`);
    }
  }
  return { written, textFrom: from, generic: !custom, logo: !!href };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('media/cards.mjs')) {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const version = get('--version') ?? JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const browser = await launch().catch((e) => { console.log('PNG/PSD skipped:', e.message); return null; });
  try {
    const r = await renderCards(version, { outDir: get('--out') ?? undefined, browser });
    console.log(`${r.written.length} files${r.generic ? ' (generic text: add tools/release/media/cards.' + version + '.json)' : ` (text: ${r.textFrom})`}`);
  } finally { await browser?.close(); }
}
