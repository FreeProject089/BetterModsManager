// Release cards: social 1200×630, Discord 960×540, blog header 1600×600, square 1080, « what's new »
// 1200×675, each in English and French, parameterised by version.
//
// The look (2026-10, redone from zero): the BMM identity first (the « Better Mod.Manager »
// wordmark in Bricolage Grotesque 800, outlined; the app tile; the brand amber on the app's navy),
// one headline, one subline, three highlights at most, and a REAL product shot: the release
// screenshots (shoot.mjs): the Automations editor in Flow mode in front of the Mod Library, large,
// tilted in perspective with a soft shadow and a glow, coming in from the right / bottom edge, over
// a navy field with a distorted grid (seeded, so every run draws the same). No Tasky on the cards.
// Every format is composed for its own ratio and keeps its text inside the zone its platform shows
// (cardSpecs().safe). Text contrast is AAA (7:1) over what it sits on.
//
// Every card is a LAYERED SVG (Inkscape layers in groups: Background, Product shot, Brand, Text,
// Screenshots; the shots are raster layers drawn in 3D by stage.mjs, the rest is vector), a grouped PSD with the sRGB profile (+ a .txt of its words) and a PNG.
//
//   node tools/release/media/cards.mjs --version 1.0.4 [--out Release/1.0.4/media] [--shots <dir>] [--no-psd]

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cardText, cardSpecs, cardFile, textProblems } from './cards-text.mjs';
import { textWidth, fitText } from './metrics.mjs';
import { openStage, WINDOW, dataUri } from './stage.mjs';
import { vignetteOf } from './vignettes.mjs';
import { ROOT, TOOL_DIR, writeText, releaseDir, ensureDir, readJson } from '../lib/util.mjs';
import { launch, svgToPng } from '../lib/browser.mjs';
import { decodePng } from '../lib/png.mjs';
import { writePsd } from '../lib/psd.mjs';
import { srgbProfile } from '../lib/icc.mjs';
import { ratio, blend } from '../lib/contrast.mjs';

/** The palette: the app's navy and brand amber (frontend/css/tokens.css), inks chosen for AAA. */
export const C = {
  top: '#0d1426', bottom: '#060912', ink: '#f8fafc', ink2: '#e2e8f0', muted: '#cbd5e1',
  amber: '#fbbf24', amber2: '#f59e0b', blue: '#3b82f6', badgeInk: '#0a0e17', tile: '#ffffff', tileFill: '#141b2e',
};
export const AAA = 7;
// Type: the BetterCommunity brand pair, embedded in every SVG (media/fonts/, SIL OFL 1.1), so a card
// renders the same on any machine and offline. Bricolage Grotesque (the face the wordmark is drawn
// from) sets the headlines; Atkinson Hyperlegible Next sets the text and the version tag. Both files
// cover Latin-1 (French accents, « », œ, ’). Segoe stays for the hero's tagline (seg* faces).
const DISPLAY = "'Segoe UI Variable Display','Segoe UI',Inter,'Helvetica Neue',Arial,sans-serif";
const TEXT = "'Segoe UI Variable Text','Segoe UI',Inter,'Helvetica Neue',Arial,sans-serif";
const BRAND = "'Bricolage Grotesque','Segoe UI Variable Display','Segoe UI',sans-serif";
const BODY = "'Atkinson Hyperlegible Next','Segoe UI Variable Text','Segoe UI',Arial,sans-serif";
const FAMILY = { seg700: DISPLAY, seg600: DISPLAY, seg500: TEXT, brico: BRAND, bg800: BRAND, bg700: BRAND, ahn400: BODY, ahn500: BODY, ahn600: BODY, ahn700: BODY };
const WEIGHT = { seg700: 700, seg600: 600, seg500: 500, brico: 800, bg800: 800, bg700: 700, ahn400: 400, ahn500: 500, ahn600: 600, ahn700: 700 };
/** The faces of each role on the cards (keys of FAMILY and of metrics ADVANCE). */
export const TYPE = { head: 'bg800', body: 'ahn500', strong: 'ahn600', tile: 'ahn700', tag: 'bg700' };
export const FONT_NOTE = 'Fonts (embedded, SIL OFL 1.1, tools/release/media/fonts): Bricolage Grotesque 800 for the headlines, Atkinson Hyperlegible Next 500/600/700 for the text and the version tag; the wordmark is outlined.';

// Every text colour with the colour under it (the glows and the tiles blended in, at their
// strongest where text can sit), so the tests and the step measure contrast instead of trusting the eye.
const AMBER_GLOW = blend(C.amber2, C.top, 0.14), BLUE_GLOW = blend(C.blue, C.top, 0.3), TILE = blend(C.tile, C.top, 0.07);
const TAG = blend('#ffffff', AMBER_GLOW, 0.06);
export const TEXT_PAIRS = [
  ['headline', C.ink, AMBER_GLOW], ['headline over the blue glow', C.ink, BLUE_GLOW],
  ['kicker (amber)', C.amber, AMBER_GLOW], ['kicker over the blue glow', C.amber, BLUE_GLOW],
  ['highlight title', C.ink2, AMBER_GLOW], ['highlight title on a tile', C.ink2, TILE],
  ['description, footer', C.muted, BLUE_GLOW], ['description on a tile', C.muted, TILE],
  ['version tag label', C.ink2, TAG], ['version tag number (amber)', C.amber, TAG], ['tag « NEW » on amber (split style)', C.badgeInk, C.amber],
  ['feature tile title (amber glow)', C.ink, blend(C.amber2, C.tileFill, 0.16)], ['feature tile title (blue glow)', C.ink, blend(C.blue, C.tileFill, 0.16)],
  ['feature tile description (amber glow)', C.muted, blend(C.amber2, C.tileFill, 0.16)], ['feature tile description (blue glow)', C.muted, blend(C.blue, C.tileFill, 0.16)],
];
/** { min, rows: [{ what, ratio, ok }] } over TEXT_PAIRS; ok = AAA (7:1). */
export function cardContrast() {
  const rows = TEXT_PAIRS.map(([what, fg, bg]) => ({ what, ratio: +ratio(fg, bg).toFixed(2), ok: ratio(fg, bg) >= AAA }));
  return { min: Math.min(...rows.map((r) => r.ratio)), rows };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const layer = (id, label, body) => ({ id, label, body });
const r1 = (v) => Math.round(v * 10) / 10;

// ── Brand assets ─────────────────────────────────────────────────────────────────────────────
const BRAND_DIR = join(ROOT, 'frontend', 'assets', 'brand');
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

/** The outlined wordmark (bmm-wordmark-dark.svg) as a nested <svg> at (x, y), h px high. */
export function wordmark(x, y, h, id = 'wm') {
  const src = read(join(BRAND_DIR, 'bmm-wordmark-dark.svg'));
  const w = h * (694 / 190);
  if (!src) return { svg: `<text x="${x}" y="${y + h * 0.8}" font-family="${BRAND}" font-weight="800" font-size="${h * 0.8}" fill="${C.amber}">Better Mod.Manager</text>`, w };
  const inner = src.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<title[^>]*>[\s\S]*?<\/title>/, '')
    .replace(/id="glow"/g, `id="${id}-glow"`).replace(/url\(#glow\)/g, `url(#${id}-glow)`);
  return { svg: `<svg x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" viewBox="-6 -6 694 190" overflow="visible">${inner.trim()}</svg>`, w };
}

/** The app tile (bmm-logo-tile.svg), s px square. */
export function logoTile(x, y, s) {
  const src = read(join(BRAND_DIR, 'bmm-logo-tile.svg'));
  if (!src) return '';
  const inner = src.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return `<svg x="${r1(x)}" y="${r1(y)}" width="${s}" height="${s}" viewBox="0 0 512 512">${inner}</svg>`;
}

let _lucide = null;
/** A Lucide icon (frontend/assets/icons/lucide.json) as SVG markup, size px, stroke colour. */
export function icon(name, x, y, size, color) {
  if (!_lucide) { try { _lucide = JSON.parse(readFileSync(join(ROOT, 'frontend', 'assets', 'icons', 'lucide.json'), 'utf8')); } catch { _lucide = {}; } }
  const nodes = _lucide[name] || _lucide.sparkles || [];
  const body = nodes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/>`).join('');
  return `<g transform="translate(${r1(x)} ${r1(y)}) scale(${size / 24})" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
}

let _gh = null;
function githubMark(x, y, size, color) {
  if (_gh === null) { try { _gh = JSON.parse(readFileSync(join(ROOT, 'frontend', 'assets', 'icons', 'simple-icons.json'), 'utf8')).github?.p || ''; } catch { _gh = ''; } }
  return _gh ? `<path transform="translate(${r1(x)} ${r1(y)}) scale(${size / 24})" fill="${color}" d="${_gh}"/>` : '';
}

/** The embedded faces: [family, weight range, file in media/fonts/]. Variable fonts (wght axis). */
export const FONT_FILES = [
  ['Bricolage Grotesque', '600 800', 'bricolage-grotesque-latin.woff2'],
  ['Atkinson Hyperlegible Next', '400 700', 'atkinson-hyperlegible-next-latin.woff2'],
];
let _faces = null;
function fontFace() {
  if (_faces === null) {
    _faces = FONT_FILES.map(([fam, wt, file]) => {
      const p = join(TOOL_DIR, 'media', 'fonts', file);
      return existsSync(p) ? `@font-face{font-family:'${fam}';font-weight:${wt};src:url(data:font/woff2;base64,${readFileSync(p).toString('base64')}) format('woff2')}` : '';
    }).join('');
  }
  return _faces ? `<style>${_faces}</style>` : '';
}

// ── Text ─────────────────────────────────────────────────────────────────────────────────────
/** Tracking (px) of the display face at size z: tight for big type, as display faces want. */
export const tight = (z) => (z >= 40 ? -z * 0.03 : z >= 28 ? -z * 0.018 : 0);
/** Line height of the headlines (Bricolage has a tall x-height: set solid, not loose). */
const HEAD_LH = 1.02;
/** Cap height of both embedded faces (em): a first baseline at y + size × CAP puts the caps' top at y. */
const CAP = 0.672;
/** Line height of the sublines (Atkinson Hyperlegible Next: open, for two lines read at a glance). */
const SUB_LH = 1.36;

/** A <text> of several lines; y is the first baseline. Returns { svg, bottom } (last baseline). */
export function lines(x, y, ls, { size, face = 'seg700', fill = C.ink, lh = 1.12, tracking = 0, anchor = 'start' }) {
  const spans = ls.map((l, i) => `<tspan x="${r1(x)}" y="${r1(y + i * size * lh)}">${esc(l)}</tspan>`).join('');
  const tr = tracking ? ` letter-spacing="${r1(tracking)}"` : '';
  const an = anchor !== 'start' ? ` text-anchor="${anchor}"` : '';
  return { svg: `<text font-family="${FAMILY[face]}" font-weight="${WEIGHT[face]}" font-size="${size}" fill="${fill}"${tr}${an}>${spans}</text>`, bottom: y + (ls.length - 1) * size * lh };
}

/** « New » in the card's language, for the split tag. */
const NEW_WORD = { en: 'NEW', fr: 'NOUVEAU' };
/** The tag style the cards and the hero use (see badge()). */
// Chosen 2026-10 over « outline » (amber on amber next to the amber « Mod.Manager »: too loud) and
// « split » (a solid amber block reads as a button again, and « NOUVEAU » doubles its width in French).
export const BADGE = { style: 'glass', prefix: 'Version ' };

/**
 * The release tag: h px high at (x, y), the label `${prefix}${version}` set in Atkinson Hyperlegible
 * Next 700 with its caps centred on the tag. Styles:
 *   outline  a pill with an amber hairline over a faint amber wash, a lit amber dot, amber label
 *   split    « NEW » on solid amber, then the version on the navy with an amber hairline
 *   glass    (the cards' and the hero's) a frosted pill with an amber hairline, a lit amber dot,
 *            « Version » in the text face and the number in Bricolage amber
 * Returns { svg, w }.
 */
export function badge(x, y, h, version, { prefix = BADGE.prefix, style = BADGE.style, lang = 'en' } = {}) {
  const fs = r1(h * 0.44), base = r1(y + h / 2 + fs * CAP / 2), track = r1(fs * 0.01);
  const txt = (tx, s, fill, { face = TYPE.tag, size = fs, ls = track, anchor = 'start' } = {}) =>
    `<text x="${r1(tx)}" y="${base}" font-family="${FAMILY[face]}" font-weight="${WEIGHT[face]}" font-size="${size}" letter-spacing="${ls}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''} fill="${fill}">${esc(s)}</text>`;
  const pad = h * 0.4, dotR = r1(h * 0.1);
  if (style === 'split') {
    const word = NEW_WORD[lang] ?? NEW_WORD.en, ws = r1(h * 0.34), wls = r1(ws * 0.09);
    const lw = Math.round(textWidth(word, ws, 'bg800', wls) + pad * 1.5);
    const label = `${prefix}${version}`;
    const vw = Math.round(textWidth(label, fs, TYPE.tag, track) + pad * 1.7);
    const w = lw + vw, rx = r1(h * 0.26);
    return {
      w,
      svg: `<defs><clipPath id="tag-clip"><rect x="${r1(x)}" y="${r1(y)}" width="${w}" height="${h}" rx="${rx}"/></clipPath></defs>
    <g clip-path="url(#tag-clip)"><rect x="${r1(x)}" y="${r1(y)}" width="${w}" height="${h}" fill="${C.amber}" fill-opacity="0.08"/><rect x="${r1(x)}" y="${r1(y)}" width="${lw}" height="${h}" fill="${C.amber}"/></g>
    <rect x="${r1(x + 0.75)}" y="${r1(y + 0.75)}" width="${r1(w - 1.5)}" height="${r1(h - 1.5)}" rx="${rx}" fill="none" stroke="${C.amber}" stroke-opacity="0.75" stroke-width="1.5"/>
    ${txt(x + lw / 2, word, C.badgeInk, { face: 'bg800', size: ws, ls: wls, anchor: 'middle' }).replace(`y="${base}"`, `y="${r1(y + h / 2 + ws * CAP / 2)}"`)}
    ${txt(x + lw + vw / 2, label, C.amber, { anchor: 'middle' })}`,
    };
  }
  if (style === 'glass') {
    const pre = prefix.trim() ? prefix : '', num = version;
    const gap = h * 0.24;
    const pw = pre ? textWidth(pre, fs, 'ahn500', track) : 0, nw = textWidth(num, fs, TYPE.tag, track);
    const w = Math.round(pad + dotR * 2 + gap + pw + nw + pad);
    const tx = x + pad + dotR * 2 + gap;
    return {
      w,
      svg: `<rect x="${r1(x)}" y="${r1(y)}" width="${w}" height="${h}" rx="${h / 2}" fill="#ffffff" fill-opacity="0.06" stroke="${C.amber}" stroke-opacity="0.38"/>
    <circle cx="${r1(x + pad + dotR)}" cy="${r1(y + h / 2)}" r="${r1(dotR * 2.1)}" fill="${C.amber}" fill-opacity="0.18"/><circle cx="${r1(x + pad + dotR)}" cy="${r1(y + h / 2)}" r="${dotR}" fill="${C.amber}"/>
    ${pre ? txt(tx, pre, C.ink2, { face: 'ahn500' }) : ''}${txt(tx + pw, num, C.amber)}`,
    };
  }
  // outline (default)
  const label = `${prefix}${version}`, gap = h * 0.26;
  const w = Math.round(pad * 0.9 + dotR * 2 + gap + textWidth(label, fs, TYPE.tag, track) + pad);
  const cx = x + pad * 0.9 + dotR;
  return {
    w,
    svg: `<rect x="${r1(x + 0.75)}" y="${r1(y + 0.75)}" width="${r1(w - 1.5)}" height="${r1(h - 1.5)}" rx="${r1(h / 2 - 0.75)}" fill="${C.amber}" fill-opacity="0.1" stroke="${C.amber}" stroke-opacity="0.7" stroke-width="1.5"/>
    <circle cx="${r1(cx)}" cy="${r1(y + h / 2)}" r="${r1(dotR * 2.2)}" fill="${C.amber}" fill-opacity="0.2"/><circle cx="${r1(cx)}" cy="${r1(y + h / 2)}" r="${dotR}" fill="${C.amber}"/>
    ${txt(cx + dotR + gap, label, C.amber)}`,
  };
}

/** Lockup: app tile + wordmark, h px high, at (x, y). Returns { svg, w, cy } (cy = the tile's centre line). */
export function lockup(x, y, h) {
  const tile = logoTile(x, y, h);
  const gap = Math.round(h * 0.32);
  const wm = wordmark(x + h + gap, y + h * 0.04, h * 0.92);
  return { svg: `${tile ? `<rect x="${x}" y="${r1(y + h * 0.06)}" width="${h}" height="${h}" rx="${r1(h * 0.22)}" fill="#000" opacity="0.35"/>${tile}` : ''}${wm.svg}`, w: h + gap + wm.w, cy: y + h / 2 };
}

/**
 * The release tag after a lockup: a hairline divider, then the tag centred on the lockup's centre
 * line. lk = lockup(), h = tag height. Returns { svg, w } (w from the lockup's right edge).
 */
export function tagAfter(lk, x, h, version, opts = {}) {
  const gap = Math.round(h * 0.55);
  const dx = x + lk.w + gap, top = lk.cy - h / 2;
  const bd = badge(dx + gap, top, h, version, opts);
  return { svg: `<rect x="${r1(dx)}" y="${r1(lk.cy - h * 0.5)}" width="1" height="${h}" fill="#ffffff" fill-opacity="0.2"/>${bd.svg}`, w: gap * 2 + 1 + bd.w };
}

/** One highlight row: icon tile + title. Returns { svg, h }. */
function highlightRow(x, y, hl, { size, maxW }) {
  const t = Math.round(size * 1.7);
  const tx = x + t + Math.round(size * 0.7);
  const title = fitText(hl.title, { face: TYPE.strong, maxW: maxW - (tx - x), maxLines: 1, size, min: Math.round(size * 0.8) });
  const svg = `<rect x="${x}" y="${y}" width="${t}" height="${t}" rx="${Math.round(t * 0.28)}" fill="${C.amber}" fill-opacity="0.12" stroke="${C.amber}" stroke-opacity="0.45"/>
    ${icon(hl.icon, x + t * 0.21, y + t * 0.21, t * 0.58, C.amber)}
    ${lines(tx, y + t * 0.5 + title.size * CAP / 2, title.lines, { size: title.size, face: TYPE.strong, fill: C.ink2 }).svg}`;
  return { svg, h: t };
}

function footer(x, y, size, text, anchor = 'start') {
  const w = textWidth(text, size, TYPE.body);
  const gx = anchor === 'end' ? x - w - size * 1.5 : x;
  const tx = anchor === 'end' ? x - w : x + size * 1.5;
  return `${githubMark(gx, y - size * 0.95, size * 1.05, C.muted)}${lines(tx, y, [text], { size, face: TYPE.body, fill: C.muted }).svg}`;
}

// ── Background ───────────────────────────────────────────────────────────────────────────────
/** A small seeded PRNG (mulberry32): the same seed draws the same grid on every run. */
export function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * The distorted grid: a regular mesh bent by a lens (it swells around the product shot at
 * focus [x, y], radius r) and by a slow wave field (seeded phases), with a gentle perspective
 * that pulls the lines towards a horizon above the card. Pure: returns polyline path data, so
 * the step redraws it and the tests can check it is the same for the same seed.
 */
export function warpedGrid(w, h, { focus = [w * 0.7, h * 0.55], radius = Math.max(w, h) * 0.32, step = 46, seed = 1, lens = 0.22, wave = 7 } = {}) {
  const rnd = prng(seed);
  const ph = [rnd() * 6.283, rnd() * 6.283, rnd() * 6.283];
  const horizon = -h * 0.9;
  const warp = (x, y) => {
    // Perspective: rows further up are squeezed towards the horizon, columns lean to the vanishing point.
    const depth = (y - horizon) / (h - horizon);
    const px = focus[0] + (x - focus[0]) * (0.72 + 0.28 * depth);
    const py = horizon + (h - horizon) * depth ** 1.18;
    // Lens: points near the focus are pushed outwards, smoothly.
    const dx = px - focus[0], dy = py - focus[1];
    const k = 1 + lens * Math.exp(-(dx * dx + dy * dy) / (radius * radius));
    let qx = focus[0] + dx * k, qy = focus[1] + dy * k;
    // Wave field.
    qx += wave * Math.sin(qy / 97 + ph[0]) * 0.6;
    qy += wave * Math.sin(qx / 131 + ph[1]) + wave * 0.5 * Math.sin((qx + qy) / 211 + ph[2]);
    return [qx, qy];
  };
  const m = step * 3, seg = 18;
  const paths = [];
  const poly = (pts) => 'M' + pts.map(([a, b]) => `${a.toFixed(1)} ${b.toFixed(1)}`).join('L');
  for (let y = -m; y <= h + m; y += step) { const pts = []; for (let x = -m; x <= w + m; x += seg) pts.push(warp(x, y)); paths.push(poly(pts)); }
  for (let x = -m * 2; x <= w + m * 2; x += step) { const pts = []; for (let y = -m; y <= h + m; y += seg) pts.push(warp(x, y)); paths.push(poly(pts)); }
  return paths;
}

/** The background layers: the navy field with its glows and grain, and the distorted grid. */
export function backgroundLayers(w, h, { blue = [w * 0.75, h * 0.55], amber = [w * 0.1, h * 0.05], focus = blue, seed = 1 } = {}) {
  const R = Math.max(w, h);
  const field = layer('background', 'Field and glow', `<defs>
      ${fontFace()}
      <linearGradient id="field" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${C.top}"/><stop offset="1" stop-color="${C.bottom}"/></linearGradient>
      <radialGradient id="glow-blue" cx="${r1(blue[0])}" cy="${r1(blue[1])}" r="${r1(R * 0.55)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.blue}" stop-opacity="0.42"/><stop offset="0.45" stop-color="${C.blue}" stop-opacity="0.14"/><stop offset="1" stop-color="${C.blue}" stop-opacity="0"/></radialGradient>
      <radialGradient id="glow-amber" cx="${r1(amber[0])}" cy="${r1(amber[1])}" r="${r1(R * 0.42)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.amber2}" stop-opacity="0.14"/><stop offset="1" stop-color="${C.amber2}" stop-opacity="0"/></radialGradient>
      <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${seed}" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.035 0"/></filter>
      <radialGradient id="grid-fade" cx="${r1(focus[0])}" cy="${r1(focus[1])}" r="${r1(R * 0.62)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset="0.6" stop-color="#fff" stop-opacity="0.45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      <mask id="grid-mask"><rect width="${w}" height="${h}" fill="url(#grid-fade)"/></mask>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#field)"/>
    <rect width="${w}" height="${h}" fill="url(#glow-amber)"/>
    <rect width="${w}" height="${h}" fill="url(#glow-blue)"/>
    <rect width="${w}" height="${h}" filter="url(#grain)"/>
    <rect x="0" y="0" width="${w}" height="3" fill="${C.amber2}" opacity="0.9"/>`);
  field.group = 'Background';
  const grid = layer('grid', 'Grid', `<g mask="url(#grid-mask)" fill="none" stroke="#93b4ff" stroke-opacity="0.085" stroke-width="1">${warpedGrid(w, h, { focus, seed }).map((d) => `<path d="${d}"/>`).join('')}</g>`);
  grid.group = 'Background';
  return [field, grid];
}

// ── Product shots (stage items) ──────────────────────────────────────────────────────────────
/**
 * What a card shows of a screenshot: BMM's window, or for the Automations editor (shown in BMM as
 * a panel over the dimmed app) the editor panel alone, so no backdrop ever shows.
 */
export const VIEW = {
  window: { x: WINDOW.x, y: WINDOW.y, w: WINDOW.w, h: WINDOW.h },
  flow: { x: 88, y: 88, w: 1496, h: 896 },
};
/** The view each screenshot is shown with (shoot.mjs scene name → VIEW key; default: window). */
export const VIEW_OF = { 'automations-flow': 'flow' };
export const viewOf = (name) => VIEW[VIEW_OF[name] ?? 'window'];

/**
 * A window item for the stage: the screenshot `shot` ({ src, w, h }) cropped to `view` (BMM's
 * window by default), at (x, y) w px wide, tilted.
 */
export function windowItem(id, label, shot, { x, y, w, view = VIEW.window, rotate, perspective = 2000, origin = '0% 50%', glow = 'rgba(59,130,246,0.30)', reflect = 0, z = 0, float = null, shadow }) {
  return { id, label, src: shot.src, srcW: shot.w, srcH: shot.h, crop: { ...view }, x, y, w, rotate, perspective, origin, glow, reflect, z, float, shadow };
}

// ── « What's new » vignettes ──────────────────────────────────────────────────────────────────
/**
 * The picture of a « what's new » tile in the box { x, y, w, h }: the scene's vignette (vignettes.mjs)
 * scaled to fit with a margin, or, for a scene without one, the highlight's crop zoomed to fill.
 * The screenshot is embedded once per tile and each piece reuses it.
 */
export function vignetteSvg(hl, shot, i, box) {
  const id = `shot-${i}`;
  const img = `<defs><image id="${id}" href="${shot.src}" width="${shot.w}" height="${shot.h}"/></defs>`;
  const v = vignetteOf(hl.shot);
  if (!v) {
    const [cx0, cy0, cw, chh] = hl.crop || [WINDOW.x, WINDOW.y, WINDOW.w, WINDOW.h];
    return `${img}<svg x="${r1(box.x)}" y="${r1(box.y)}" width="${r1(box.w)}" height="${r1(box.h)}" viewBox="${cx0} ${cy0} ${cw} ${chh}" preserveAspectRatio="xMidYMid slice"><use href="#${id}"/></svg>`;
  }
  const m = 14, k = Math.min((box.w - 2 * m) / v.w, (box.h - 2 * m) / v.h);
  const ox = box.x + (box.w - v.w * k) / 2, oy = box.y + (box.h - v.h * k) / 2;
  const pieces = v.pieces.map((p) => { const [cx, cy, cw, ch] = p.crop; return `<svg x="${r1(p.x)}" y="${r1(p.y)}" width="${r1(cw * p.s)}" height="${r1(ch * p.s)}" viewBox="${cx} ${cy} ${cw} ${ch}"><use href="#${id}"/></svg>`; }).join('');
  return `${img}<g transform="translate(${r1(ox)} ${r1(oy)}) scale(${k.toFixed(4)})">${v.under || ''}${pieces}${v.over || ''}</g>`;
}

// ── Layouts ──────────────────────────────────────────────────────────────────────────────────
// The text boxes of each layout, shared by the drawing and by overflowReport().
const boxes = () => ({
  social: { headline: { face: TYPE.head, maxW: 500, maxLines: 3, size: 52, min: 38, tracking: tight, balance: true }, subline: { face: TYPE.body, maxW: 500, maxLines: 2, size: 22, min: 18, balance: true } },
  discord: { headline: { face: TYPE.head, maxW: 450, maxLines: 3, size: 54, min: 40, tracking: tight, balance: true }, subline: { face: TYPE.body, maxW: 440, maxLines: 3, size: 22, min: 19, balance: true } },
  blog: { headline: { face: TYPE.head, maxW: 580, maxLines: 2, size: 60, min: 42, tracking: tight, balance: true }, subline: { face: TYPE.body, maxW: 560, maxLines: 2, size: 24, min: 19, balance: true } },
  square: { headline: { face: TYPE.head, maxW: 810, maxLines: 3, size: 80, min: 54, tracking: tight, balance: true }, subline: { face: TYPE.body, maxW: 780, maxLines: 2, size: 30, min: 24, balance: true } },
  whatsnew: { title: { face: TYPE.head, maxW: 1088, maxLines: 1, size: 50, min: 36, tracking: tight }, meta: { face: TYPE.body, maxW: 900, maxLines: 1, size: 19, min: 16 },
    tileTitle: { face: TYPE.tile, maxW: 270, maxLines: 1, size: 21, min: 17 }, desc: { face: TYPE.body, maxW: 317, maxLines: 1, size: 16, min: 13 } },
});

const TEXT_FILL = { headline: C.ink, subline: C.ink2 };
const g = (L, group) => { L.group = group; return L; };

/**
 * The layers and stage items of one card. t = cardText(), shots = { name: { src, w, h } } (may be
 * empty: the card is then drawn without product shots). Returns { layers, items, texts }: layers
 * in paint order with a group each (Background, Product shot, Brand, Text, Screenshots); raster layers
 * hold a placeholder filled by the stage; texts = [{ layer, text }] for the PSD sidecar.
 */
export function cardLayout(spec, t, shots = {}) {
  const { w, h, safe } = spec;
  const items = [], texts = [];
  const L = [];
  const x = safe.x;
  const BOX = boxes();
  const T = (id, label, svg, text) => { L.push(g(layer(id, label, svg), id === 'brand' || id === 'version' ? 'Brand' : 'Text')); if (text) texts.push({ layer: label, text }); };
  const head = (box, y0) => { const f = fitText(t.headline, box); return { f, b: lines(x, y0 + f.size * CAP, f.lines, { size: f.size, face: TYPE.head, lh: HEAD_LH, tracking: tight(f.size), fill: TEXT_FILL.headline }) }; };
  const sub = (box, y0) => { const f = fitText(t.subline, box); return { f, b: lines(x, y0 + f.size * CAP, f.lines, { size: f.size, face: TYPE.body, lh: SUB_LH, fill: TEXT_FILL.subline }) }; };
  const rows = (y0, size, maxW, limit = Infinity) => {
    let svg = '', yy = y0;
    for (const hl of t.highlights) {
      const rh = Math.round(size * 1.7);
      if (yy + rh > limit) break;
      svg += highlightRow(x, yy, hl, { size, maxW }).svg; yy += rh + Math.round(size * 0.6);
    }
    return { svg, bottom: yy };
  };
  const hlText = t.highlights.map((hl) => `• ${hl.title}`).join('\n');
  // The product shots: the names of t.shots.<format> in paint order ([behind, front], or one).
  // The front window keeps the large placement each format had; the one behind sits up and right.
  const pair = (names, front, back) => {
    const list = (Array.isArray(names) ? names : [names]).filter((n) => shots[n]).slice(-2);
    if (list.length === 2 && back) items.push(windowItem('product-back', 'Product shot (back)', shots[list[0]], { view: viewOf(list[0]), glow: 'rgba(59,130,246,0.22)', ...back }));
    const f = list.at(-1);
    if (f) items.push(windowItem('product', list.length === 2 && back ? 'Product shot (front)' : 'Product shot', shots[f], { view: viewOf(f), ...front }));
  };

  if (spec.layout === 'social') {
    L.push(...backgroundLayers(w, h, { blue: [w * 0.8, h * 0.6], amber: [w * 0.05, 0], focus: [w * 0.78, h * 0.5], seed: 11 }));
    const lk = lockup(x, safe.y, 40);
    const bd = tagAfter(lk, x, 30, t.version, { lang: spec.lang });
    const hd = head(BOX.social.headline, safe.y + 40 + 46);
    const sb = sub(BOX.social.subline, hd.b.bottom + 30);
    const rw = rows(sb.b.bottom + 34, 20, 500, safe.y + safe.h - 40);
    T('brand', 'Wordmark', lk.svg); T('version', 'Badge', bd.svg, `v${t.version}`);
    T('headline', 'Headline', hd.b.svg, t.headline); T('subline', 'Subline', sb.b.svg, t.subline);
    T('highlights', 'Highlights', rw.svg, hlText); T('footer', 'Footer', footer(x, safe.y + safe.h, 16, t.foot), t.foot);
    pair(t.shots.social, { x: 640, y: 150, w: 800, rotate: { x: 6, y: -22, z: 1.5 }, perspective: 1700 }, { x: 770, y: 36, w: 760, rotate: { x: 6, y: -22, z: 1.5 }, perspective: 1700 });
  } else if (spec.layout === 'discord') {
    L.push(...backgroundLayers(w, h, { blue: [w * 0.8, h * 0.62], amber: [0, 0], focus: [w * 0.78, h * 0.55], seed: 12 }));
    const lk = lockup(x, safe.y, 36);
    const bd = tagAfter(lk, x, 28, t.version, { lang: spec.lang });
    const f = fitText(t.headline, BOX.discord.headline);
    const fs = fitText(t.subline, BOX.discord.subline);
    const blockH = f.size * CAP + (f.lines.length - 1) * f.size * HEAD_LH + 30 + fs.size * CAP + (fs.lines.length - 1) * fs.size * SUB_LH;
    const room0 = safe.y + 36 + 20, room1 = safe.y + safe.h;
    const hd = head(BOX.discord.headline, room0 + Math.max(0, (room1 - room0 - blockH) / 2));
    const sb = sub(BOX.discord.subline, hd.b.bottom + 30);
    T('brand', 'Wordmark', lk.svg); T('version', 'Badge', bd.svg, `v${t.version}`);
    T('headline', 'Headline', hd.b.svg, t.headline); T('subline', 'Subline', sb.b.svg, t.subline);
    pair(t.shots.discord, { x: 545, y: 150, w: 620, rotate: { x: 6, y: -24, z: 1.5 }, perspective: 1500 }, { x: 650, y: 48, w: 580, rotate: { x: 6, y: -24, z: 1.5 }, perspective: 1500 });
  } else if (spec.layout === 'blog') {
    L.push(...backgroundLayers(w, h, { blue: [w * 0.74, h * 0.55], amber: [w * 0.12, 0], focus: [w * 0.74, h * 0.5], seed: 13 }));
    const f = fitText(t.headline, BOX.blog.headline), fs = fitText(t.subline, BOX.blog.subline);
    const blockH = 52 + 52 + f.size * CAP + (f.lines.length - 1) * f.size * HEAD_LH + 32 + fs.size * CAP + (fs.lines.length - 1) * fs.size * SUB_LH;
    const top = safe.y + Math.max(0, (safe.h - blockH) / 2);
    const lk = lockup(x, top, 52);
    const bd = tagAfter(lk, x, 34, t.version, { lang: spec.lang });
    const hd = head(BOX.blog.headline, top + 52 + 52);
    const sb = sub(BOX.blog.subline, hd.b.bottom + 32);
    T('brand', 'Wordmark', lk.svg); T('version', 'Badge', bd.svg, `v${t.version}`);
    T('headline', 'Headline', hd.b.svg, t.headline); T('subline', 'Subline', sb.b.svg, t.subline);
    pair(t.shots.blog, { x: 1010, y: 230, w: 620, rotate: { x: 5, y: -26, z: 1 }, perspective: 1800, shadow: { dy: 50, blur: 80, alpha: 0.7 } }, { x: 880, y: 40, w: 680, rotate: { x: 5, y: -26, z: 1 }, perspective: 1800 });
  } else if (spec.layout === 'square') {
    L.push(...backgroundLayers(w, h, { blue: [w * 0.66, h * 0.8], amber: [w * 0.1, 0], focus: [w * 0.62, h * 0.78], seed: 14 }));
    const lk = lockup(x, safe.y, 48);
    const bd = tagAfter(lk, x, 36, t.version, { lang: spec.lang });
    const hd = head(BOX.square.headline, safe.y + 48 + 72);
    const sb = sub(BOX.square.subline, hd.b.bottom + 40);
    const rw = rows(sb.b.bottom + 44, 25, safe.w);
    T('brand', 'Wordmark', lk.svg); T('version', 'Badge', bd.svg, `v${t.version}`);
    T('headline', 'Headline', hd.b.svg, t.headline); T('subline', 'Subline', sb.b.svg, t.subline); T('highlights', 'Highlights', rw.svg, hlText);
    const fy = Math.max(rw.bottom + 80, 690);
    pair(t.shots.square, { x: 300, y: fy, w: 980, rotate: { x: 18, y: -16, z: 1.5 }, perspective: 2000, origin: '50% 0%' }, { x: 560, y: fy - 120, w: 860, rotate: { x: 18, y: -16, z: 1.5 }, perspective: 2000, origin: '50% 0%' });
  } else {
    // « What's new »: the title and a meta line, then three feature tiles. Each tile: a vignette of
    // the feature (real pixels, zoomed until they read; vignettes.mjs) in a dark well whose edges
    // fade instead of cutting, then an icon, a title and a one-line description. Depth: a soft
    // shadow under each tile, a light on its top edge, an inner glow (amber, blue, amber).
    L.push(...backgroundLayers(w, h, { blue: [w * 0.85, h * 0.15], amber: [w * 0.05, 0], focus: [w * 0.5, h * 0.62], seed: 15 }));
    const lk = lockup(x, safe.y, 38);
    const bw = badge(0, 0, 32, t.version, { lang: spec.lang }).w;
    const ft = fitText(t.whatsNew, BOX.whatsnew.title);
    const ty = safe.y + 38 + 32 + ft.size * CAP;
    const title = lines(x, ty, ft.lines, { size: ft.size, face: TYPE.head, tracking: tight(ft.size) });
    const fm = fitText(t.meta, BOX.whatsnew.meta);
    const my = ty + ft.size * 0.25 + 16 + fm.size * CAP;
    const meta = lines(x, my, fm.lines, { size: fm.size, face: TYPE.body, fill: C.muted });
    const gy = my + fm.size * 0.3 + 26, gap = 20, n = Math.max(1, Math.min(3, t.highlights.length));
    const tw = (safe.w - gap * (n - 1)) / n, th = safe.y + safe.h - gy;
    const pad = 12, capH = 96, ibh = th - pad - capH, glows = [C.amber2, C.blue, C.amber2];
    let under = `<defs><filter id="tile-shadow" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur stdDeviation="14"/></filter>
      <linearGradient id="tile-light" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.07"/><stop offset="1" stop-color="#fff" stop-opacity="0.05"/></linearGradient></defs>`;
    let tiles = '', thumbs = '';
    t.highlights.slice(0, 3).forEach((hl, i) => {
      const tx = x + i * (tw + gap);
      const bx = tx + pad, by = gy + pad, bwid = tw - 2 * pad;
      under += `<rect x="${r1(tx + 6)}" y="${r1(gy + 18)}" width="${r1(tw - 12)}" height="${r1(th - 10)}" rx="18" fill="#000" opacity="0.55" filter="url(#tile-shadow)"/>`;
      tiles += `<defs><radialGradient id="tile-glow-${i}" cx="${r1(tx + tw / 2)}" cy="${r1(gy)}" r="${r1(tw * 0.9)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${glows[i]}" stop-opacity="0.16"/><stop offset="1" stop-color="${glows[i]}" stop-opacity="0"/></radialGradient></defs>
        <rect x="${r1(tx)}" y="${r1(gy)}" width="${r1(tw)}" height="${r1(th)}" rx="18" fill="${C.tileFill}"/>
        <rect x="${r1(tx)}" y="${r1(gy)}" width="${r1(tw)}" height="${r1(th)}" rx="18" fill="url(#tile-glow-${i})"/>
        <rect x="${r1(tx + 0.5)}" y="${r1(gy + 0.5)}" width="${r1(tw - 1)}" height="${r1(th - 1)}" rx="17.5" fill="none" stroke="url(#tile-light)"/>`;
      // Caption: icon tile, title, description.
      const cy0 = by + ibh + 14, it = 34, tx2 = bx + 4 + it + 12;
      const tt = fitText(hl.title, { ...BOX.whatsnew.tileTitle, maxW: tx + tw - pad - 4 - tx2 });
      const dd = fitText(hl.desc || '', { ...BOX.whatsnew.desc, maxW: bwid - 8 });
      tiles += `<rect x="${r1(bx + 4)}" y="${r1(cy0)}" width="${it}" height="${it}" rx="9" fill="${C.amber}" fill-opacity="0.12" stroke="${C.amber}" stroke-opacity="0.45"/>
        ${icon(hl.icon, bx + 4 + it * 0.21, cy0 + it * 0.21, it * 0.58, C.amber)}
        ${lines(tx2, cy0 + it / 2 + tt.size * CAP / 2, tt.lines, { size: tt.size, face: TYPE.tile, fill: C.ink }).svg}
        ${hl.desc ? lines(bx + 4, cy0 + it + 12 + dd.size * CAP, dd.lines, { size: dd.size, face: TYPE.body, fill: C.muted }).svg : ''}`;
      // The well and its vignette; its edges fade to the well (a mask), so nothing ends on a hard cut.
      const s = hl.shot ? shots[hl.shot] : null;
      thumbs += `<defs><clipPath id="well-${i}"><rect x="${r1(bx)}" y="${r1(by)}" width="${r1(bwid)}" height="${r1(ibh)}" rx="11"/></clipPath>
          <linearGradient id="well-fade-x-${i}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000"/><stop offset="0.035" stop-color="#fff"/><stop offset="0.965" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
          <linearGradient id="well-fade-y-${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000"/><stop offset="0.04" stop-color="#fff"/><stop offset="0.96" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
          <mask id="well-mask-y-${i}" maskUnits="userSpaceOnUse" x="${r1(bx)}" y="${r1(by)}" width="${r1(bwid)}" height="${r1(ibh)}"><rect x="${r1(bx)}" y="${r1(by)}" width="${r1(bwid)}" height="${r1(ibh)}" fill="url(#well-fade-y-${i})"/></mask>
          <mask id="well-mask-x-${i}" maskUnits="userSpaceOnUse" x="${r1(bx)}" y="${r1(by)}" width="${r1(bwid)}" height="${r1(ibh)}"><rect x="${r1(bx)}" y="${r1(by)}" width="${r1(bwid)}" height="${r1(ibh)}" fill="url(#well-fade-x-${i})"/></mask>
          <radialGradient id="well-glow-${i}" cx="0.5" cy="0.45" r="0.7"><stop offset="0" stop-color="${glows[i]}" stop-opacity="0.2"/><stop offset="1" stop-color="${glows[i]}" stop-opacity="0"/></radialGradient></defs>
        <rect x="${r1(bx)}" y="${r1(by)}" width="${r1(bwid)}" height="${r1(ibh)}" rx="11" fill="#0a0f1c"/>
        <rect x="${r1(bx)}" y="${r1(by)}" width="${r1(bwid)}" height="${r1(ibh)}" rx="11" fill="url(#well-glow-${i})"/>`;
      if (s) thumbs += `<g clip-path="url(#well-${i})"><g mask="url(#well-mask-x-${i})"><g mask="url(#well-mask-y-${i})">${vignetteSvg(hl, s, i, { x: bx, y: by, w: bwid, h: ibh })}</g></g></g>`;
      thumbs += `<rect x="${r1(bx + 0.5)}" y="${r1(by + 0.5)}" width="${r1(bwid - 1)}" height="${r1(ibh - 1)}" rx="10.5" fill="none" stroke="#ffffff" stroke-opacity="0.1"/>`;
    });
    T('brand', 'Wordmark', lk.svg); T('version', 'Badge', badge(safe.x + safe.w - bw, lk.cy - 16, 32, t.version, { lang: spec.lang }).svg, `Version ${t.version}`);
    T('title', 'Title', title.svg, t.whatsNew); T('meta', 'Meta', meta.svg, t.meta);
    L.push(g(layer('tile-shadows', 'Tile shadows', under), 'Text'));
    L.push(g(layer('tiles', 'Feature tiles', tiles), 'Text'));
    texts.push({ layer: 'Feature tiles', text: t.highlights.map((hl) => `• ${hl.title}${hl.desc ? ` (${hl.desc})` : ''}`).join('\n') });
    L.push(g(layer('thumbnails', 'Screenshots', thumbs), 'Screenshots'));
  }
  // The product shots (raster layers filled from the stage) go right above the background.
  const firstText = L.findIndex((l) => l.group !== 'Background');
  L.splice(firstText, 0, ...items.map((it) => ({ id: it.id, label: it.label, body: '', raster: true, group: 'Product shot' })));
  return { layers: L, items, texts };
}

/**
 * The SVG of a card. only = layer id to keep alone (for PSD layers), null = all.
 * source = true adds the Inkscape layer attributes, the groups (« Background / Grid ») and the font note.
 */
export function assembleSvg(w, h, layers, { only = null, source = true, note = FONT_NOTE } = {}) {
  const ink = (label) => (source ? ` inkscape:groupmode="layer" inkscape:label="${esc(label)}"` : '');
  const one = (L, pad) => {
    // Defs (gradients, clip paths, masks, the embedded font) stay in every partial render so a lone layer still draws.
    const hide = only && only !== L.id;
    const content = hide ? (L.body.match(/<defs>[\s\S]*?<\/defs>/g) || []).join('') : L.body;
    return `${pad}<g id="${L.id}"${ink(L.label)}>${content}</g>`;
  };
  const out = [];
  for (let i = 0; i < layers.length;) {
    const grp = layers[i].group;
    let j = i; while (j < layers.length && layers[j].group === grp) j++;
    if (grp) out.push(`  <g id="group-${grp.toLowerCase().replace(/[^a-z]+/g, '-')}"${ink(grp)}>\n${layers.slice(i, j).map((L) => one(L, '    ')).join('\n')}\n  </g>`);
    else out.push(...layers.slice(i, j).map((L) => one(L, '  ')));
    i = j;
  }
  const ns = source ? ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"${ns} width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
${source ? `  <!-- ${note} Layers: ${layers.map((l) => (l.group ? `${l.group} / ${l.label}` : l.label)).join(', ')}. Generated by tools/release; edit the layers, not the PNG. -->\n  <desc>${esc(note)}</desc>\n` : ''}${out.join('\n')}
</svg>`;
}

/** Rasterise every layer alone + the whole, and pack a grouped PSD with the sRGB profile. */
export async function layeredPsd(browser, w, h, layers, { matte = [6, 9, 18], scale = 1 } = {}) {
  const W = Math.round(w * scale), H = Math.round(h * scale);
  const psdLayers = [];
  for (const L of layers) {
    const png = await svgToPng(browser, assembleSvg(w, h, layers, { only: L.id, source: false }), w, h, { transparent: true, scale });
    psdLayers.push({ name: L.label, group: L.group, rgba: decodePng(png).data });
  }
  const full = await svgToPng(browser, assembleSvg(w, h, layers, { source: false }), w, h, { transparent: true, scale });
  return { psd: writePsd({ width: W, height: H, layers: psdLayers, composite: decodePng(full).data, matte, icc: srgbProfile() }), png: full };
}

/** Card wording: tools/release/media/cards.<v>.json, else Release/<v>/media/cards.json, else defaults. */
export function loadCustomText(version) {
  for (const p of [join(TOOL_DIR, 'media', `cards.${version}.json`), join(releaseDir(version), 'media', 'cards.json')]) if (existsSync(p)) return { custom: readJson(p), from: p };
  return { custom: null, from: null };
}

/**
 * The screenshots the cards may use: <dir>/layers/<name>.screen.png (the window without Tasky)
 * or <dir>/<name>.png, from the first dir that has it. Returns { name: { src, w, h, file } }.
 */
export function findShots(names, dirs) {
  const out = {};
  for (const n of new Set(names.filter(Boolean))) {
    for (const d of dirs.filter(Boolean)) {
      const p = [join(d, 'layers', `${n}.screen.png`), join(d, `${n}.png`)].find(existsSync);
      if (!p) continue;
      const png = decodePng(readFileSync(p));
      out[n] = { src: dataUri(p), w: png.width, h: png.height, file: p };
      break;
    }
  }
  return out;
}

/** Every screenshot name a card text asks for. */
export function shotNames(t) {
  const flat = (v) => (Array.isArray(v) ? v : [v]);
  return [...Object.values(t.shots).flatMap(flat), ...t.highlights.map((h) => h.shot)].filter(Boolean);
}

/** Card text that does not fit its box at the smallest size allowed: [{ card, what }]. */
export function overflowReport(version, custom) {
  const out = [];
  for (const spec of cardSpecs(version)) {
    const t = cardText(version, spec.lang, custom);
    const check = (what, s, o) => { if (!fitText(s, o).fits) out.push({ card: cardFile(spec), what }); };
    const box = boxes()[spec.layout];
    if (box.headline) check('headline', t.headline, box.headline);
    if (box.title) check('title', t.whatsNew, box.title);
    if (box.subline) check('subline', t.subline, box.subline);
    if (box.meta) check('meta', t.meta, box.meta);
    if (box.tileTitle) for (const hl of t.highlights) check(`highlight « ${hl.title} »`, hl.title, box.tileTitle);
    if (box.desc) for (const hl of t.highlights) check(`description « ${hl.desc} »`, hl.desc || '', box.desc);
  }
  return out;
}

/** Fill the raster layers of a layout from the stage (one transparent PNG per window). */
async function rasterise(browser, spec, layout, scale = 1) {
  if (!layout.items.length) return;
  const st = await openStage(browser, { w: spec.w, h: spec.h, items: layout.items }, { scale });
  try {
    for (const L of layout.layers.filter((l) => l.raster)) {
      const png = await st.shot({ only: L.id });
      L.body = `<image width="${spec.w}" height="${spec.h}" href="data:image/png;base64,${png.toString('base64')}"/>`;
    }
  } finally { await st.close(); }
}

/** The sidecar of a PSD: what each text layer says (PSD layers are pixels; edit words in the SVG). */
export function textSidecar(name, texts, svgRel) {
  return `${name}\n${'='.repeat(name.length)}\n\nText layers (pixels in the PSD; the words are editable in ${svgRel}):\n\n${texts.map((x) => `[${x.layer}]\n${x.text}\n`).join('\n')}`;
}

/**
 * Write every card of `version` in both languages (bmm-<v>-<format>[.fr]):
 *   <outDir>/<file>.png, <outDir>/source/svg/<file>.svg, <outDir>/source/psd/<file>.psd + .txt
 * shotsDirs: where the screenshots are (the media step passes the fresh ones, then .github/screenshots).
 */
export async function renderCards(version, { outDir = join(releaseDir(version), 'media'), browser = null, psd = true, shotsDirs = null, log = console } = {}) {
  const { custom, from } = loadCustomText(version);
  const svgDir = ensureDir(join(outDir, 'source', 'svg')), psdDir = ensureDir(join(outDir, 'source', 'psd'));
  const dirs = shotsDirs ?? [join(releaseDir(version), 'media', 'screenshots'), join(ROOT, '.github', 'screenshots')];
  const written = [], cards = [];
  const missingShots = new Set();
  for (const spec of cardSpecs(version)) {
    const t = cardText(version, spec.lang, custom);
    const shots = browser ? findShots(shotNames(t), dirs) : {};
    if (browser) for (const n of shotNames(t)) if (!shots[n]) missingShots.add(n);
    {
      const file = cardFile(spec);
      const layout = cardLayout(spec, t, shots);
      if (browser) await rasterise(browser, spec, layout);
      const layers = layout.layers.filter((l) => l.body);
      writeText(join(svgDir, `${file}.svg`), assembleSvg(spec.w, spec.h, layers)); written.push(`source/svg/${file}.svg`);
      const card = { file, w: spec.w, h: spec.h, png: null, psd: null, layers: layers.map((l) => (l.group ? `${l.group} / ${l.label}` : l.label)) };
      if (browser) {
        if (psd) {
          const r = await layeredPsd(browser, spec.w, spec.h, layers);
          writeFileSync(join(psdDir, `${file}.psd`), r.psd); written.push(`source/psd/${file}.psd`);
          writeText(join(psdDir, `${file}.txt`), textSidecar(`${file}.psd`, layout.texts, `../svg/${file}.svg`));
          writeFileSync(join(outDir, `${file}.png`), r.png);
          card.psd = join(psdDir, `${file}.psd`);
        } else writeFileSync(join(outDir, `${file}.png`), await svgToPng(browser, assembleSvg(spec.w, spec.h, layers, { source: false }), spec.w, spec.h));
        card.png = join(outDir, `${file}.png`);
        written.push(`${file}.png`);
      }
      cards.push(card);
    }
  }
  const overflow = overflowReport(version, custom);
  for (const o of overflow) log.warn?.(`card ${o.card}: ${o.what} is too long for its box`);
  const wording = textProblems(custom);
  for (const p of wording) log.warn?.(`card text: ${p}`);
  return { written, cards, textFrom: from, generic: !custom, missingShots: [...missingShots], overflow, wording };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('media/cards.mjs')) {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const version = get('--version') ?? JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const browser = await launch().catch((e) => { console.log('PNG/PSD skipped:', e.message); return null; });
  try {
    const shotsDirs = get('--shots') ? [get('--shots'), join(ROOT, '.github', 'screenshots')] : null;
    const r = await renderCards(version, { outDir: get('--out') ?? undefined, browser, shotsDirs, psd: !a.includes('--no-psd'), log: { warn: console.log } });
    console.log(`${r.written.length} files${r.generic ? ' (generic text: add tools/release/media/cards.' + version + '.json)' : ` (text: ${r.textFrom})`}${r.missingShots.length ? `; screenshots not found: ${r.missingShots.join(', ')}` : ''}`);
  } finally { await browser?.close(); }
}
