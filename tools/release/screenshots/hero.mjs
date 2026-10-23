// The FLAT README banner (1600×640), kept as hero-flat.png since 1.0.4 (hero.png is the semi-3D one,
// hero3d.mjs): logo, title, tagline, « Version X », two screenshots.
// Built as a layered SVG (the editable source) and rasterised from that same SVG, so the PNG
// and the source never disagree. The version comes from the caller.
//
// Successor of the scratch hero.html: same layout, as SVG layers
// background / logo / title / tagline / version / screenshot-back / screenshot-front.

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, writeText } from '../lib/util.mjs';
import { svgToPng } from '../lib/browser.mjs';
import { decodePng } from '../lib/png.mjs';
import { writePsd } from '../lib/psd.mjs';
import { srgbProfile } from '../lib/icc.mjs';

export const HERO = { w: 1600, h: 640 };
const FONT = "Inter,'Segoe UI',system-ui,sans-serif";
export const HERO_FONT_NOTE = 'Fonts: Inter (fallback Segoe UI, system-ui); title 56 px weight 800, tagline 22 px weight 500, version pill 17 px weight 700.';
// Text colour on its background, for the contrast test (WCAG AA = 4.5): the hero is dark navy
// with a blue glow top-left and an amber glow bottom-right.
export const HERO_PAIRS = [['title', '#e8edf7', '#1d2b4f'], ['title, second line', '#fbbf24', '#1d2b4f'], ['tagline', '#cdd6e6', '#1d2b4f'], ['version', '#b9d0ff', '#121a2c']];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const dataUri = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;

/**
 * shots: { back: { href, w, h }, front: { href, w, h } } (href = data URI or relative path).
 * logoHref: data URI or path. Returns the layer list [{ id, label, body }].
 */
export function heroLayers(version, shots, logoHref, { tagline = ['Profiles, a mod library, modpacks and', 'Server Repo sync, in one Windows app.'] } = {}) {
  const { w, h } = HERO;
  const L = (id, label, body) => ({ id, label, body });
  const img = (id, s, x, y, width, extra = '') => {
    const height = Math.round((s.h / s.w) * width);
    // The screenshots are the whole transparent canvas (rounded window + Tasky sticking out of
    // its top-left corner): drawn as they are, with a shadow that follows their own shape.
    return `<image href="${s.href}" xlink:href="${s.href}" x="${x}" y="${y}" width="${width}" height="${height}" filter="url(#shot-shadow)" ${extra}/>`;
  };
  return [
    L('background', 'background', `<defs>
      <clipPath id="hero-clip"><rect width="${w}" height="${h}" rx="20"/></clipPath>
      <radialGradient id="g1" cx="${w * 0.15}" cy="0" r="1100" gradientUnits="userSpaceOnUse" gradientTransform="translate(${w * 0.15} 0) scale(1 0.42) translate(${-w * 0.15} 0)"><stop offset="0" stop-color="#1d2b4f"/><stop offset="0.6" stop-color="#1d2b4f" stop-opacity="0"/></radialGradient>
      <radialGradient id="g2" cx="${w}" cy="${h}" r="900" gradientUnits="userSpaceOnUse" gradientTransform="translate(${w} ${h}) scale(1 0.55) translate(${-w} ${-h})"><stop offset="0" stop-color="#3a2410"/><stop offset="0.55" stop-color="#3a2410" stop-opacity="0"/></radialGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="160%"><feGaussianBlur stdDeviation="28"/></filter>
      <filter id="shot-shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000" flood-opacity="0.6"/></filter>
    </defs>
    <g clip-path="url(#hero-clip)"><rect width="${w}" height="${h}" fill="#0b0f19"/><rect width="${w}" height="${h}" fill="url(#g1)"/><rect width="${w}" height="${h}" fill="url(#g2)"/></g>`),
    L('screenshot-back', 'screenshot (back)', `<g clip-path="url(#hero-clip)">${img('s1', shots.back, 600, 22, 960)}</g>`),
    L('screenshot-front', 'screenshot (front)', `<g clip-path="url(#hero-clip)">${img('s2', shots.front, 860, 290, 760)}</g>`),
    L('logo', 'logo', `<defs><clipPath id="logo-clip"><rect x="72" y="84" width="112" height="112" rx="28"/></clipPath></defs>
      <rect x="72" y="96" width="112" height="112" rx="28" fill="#000" opacity="0.5" filter="url(#shadow)"/>
      <rect x="72" y="84" width="112" height="112" rx="28" fill="#eef2f9"/>
      <image href="${logoHref}" xlink:href="${logoHref}" x="82" y="94" width="92" height="92"/>`),
    L('title', 'title', `<text font-family="${FONT}" font-size="56" font-weight="800" letter-spacing="-1" fill="#e8edf7"><tspan x="72" y="270">Better</tspan><tspan x="72" y="332" fill="#fbbf24">Mod Manager</tspan></text>`),
    L('tagline', 'tagline', tagline.map((t, i) => `<text x="72" y="${384 + i * 32}" font-family="${FONT}" font-size="22" font-weight="500" fill="#cdd6e6">${esc(t)}</text>`).join('')),
    L('version', 'version', `<rect x="72" y="458" width="${Math.round(8.6 * `Version ${version}`.length) + 30}" height="34" rx="17" fill="#121a2c" stroke="#5d77b0"/>
      <text x="${72 + 15}" y="481" font-family="${FONT}" font-size="17" font-weight="700" fill="#b9d0ff">Version ${esc(version)}</text>`),
  ];
}

export function heroSvg(layers, { only = null, comment = '' } = {}) {
  const { w, h } = HERO;
  const body = layers.map((l) => {
    const keep = !only || only === l.id;
    const content = keep ? l.body : (l.body.match(/<defs>[\s\S]*?<\/defs>/g) || []).join('');
    return `  <g id="${l.id}" inkscape:groupmode="layer" inkscape:label="${l.label}">${content}</g>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
${comment ? `  <!-- ${comment} -->\n` : ''}${body}
</svg>
`;
}

export function logoFile() {
  return [join(ROOT, 'frontend', 'assets', 'BMm.png'), join(ROOT, '.Assets', 'AssetsoTH', 'BMMLogo.png')].find(existsSync);
}

/**
 * Write <name>.png (hero-flat.png) into pngDir, and two sources: sourceDir/<name>.svg with images LINKED relative to
 * linkBase (for .github/screenshots/source), and fullSourceDir/hero.svg + hero.psd self-contained.
 * shotsDir holds library.png / repo-host.png.
 */
export async function buildHero({ version, browser, shotsDir, pngDir, linkedSourceDir = null, linkPrefix = '../', fullSourceDir = null, psdDir = fullSourceDir, back = 'library', front = 'repo-host', name = 'hero-flat' }) {
  const size = (p) => { const d = decodePng(readFileSync(p)); return { w: d.width, h: d.height }; };
  const bp = join(shotsDir, `${back}.png`), fp = join(shotsDir, `${front}.png`);
  if (!existsSync(bp) || !existsSync(fp)) throw new Error(`hero needs ${back}.png and ${front}.png in ${shotsDir}`);
  const logo = logoFile();
  for (const d of [pngDir, linkedSourceDir, fullSourceDir, psdDir]) if (d) mkdirSync(d, { recursive: true });
  const embedded = heroLayers(version, { back: { href: dataUri(bp), ...size(bp) }, front: { href: dataUri(fp), ...size(fp) } }, logo ? dataUri(logo) : '');
  const note = `BMM ${version} README hero. ${HERO_FONT_NOTE} Generated by tools/release/screenshots/hero.mjs.`;
  const png = await svgToPng(browser, heroSvg(embedded), HERO.w, HERO.h, { transparent: true });
  writeFileSync(join(pngDir, `${name}.png`), png);
  const out = { png: join(pngDir, `${name}.png`) };
  if (linkedSourceDir) {
    const linked = heroLayers(version, { back: { href: `${linkPrefix}${back}.png`, ...size(bp) }, front: { href: `${linkPrefix}${front}.png`, ...size(fp) } }, '');
    // The logo is small: embed it so the linked source still shows it.
    linked.find((l) => l.id === 'logo').body = embedded.find((l) => l.id === 'logo').body;
    writeText(join(linkedSourceDir, `${name}.svg`), heroSvg(linked, { comment: `${note} Screenshots are linked from ${linkPrefix}.` }));
    out.linked = join(linkedSourceDir, `${name}.svg`);
  }
  if (fullSourceDir) {
    writeText(join(fullSourceDir, `${name}.svg`), heroSvg(embedded, { comment: note }));
    const layers = [];
    for (const l of embedded) {
      const p = await svgToPng(browser, heroSvg(embedded, { only: l.id }), HERO.w, HERO.h, { transparent: true });
      layers.push({ name: l.label, group: { background: 'Background', 'screenshot-back': 'Windows', 'screenshot-front': 'Windows', logo: 'Brand', version: 'Brand' }[l.id] ?? 'Text', rgba: decodePng(p).data });
    }
    writeFileSync(join(psdDir, `${name}.psd`), writePsd({ width: HERO.w, height: HERO.h, layers, composite: decodePng(png).data, matte: [11, 15, 25], icc: srgbProfile() }));
    out.full = join(fullSourceDir, `${name}.svg`);
    out.psd = join(psdDir, `${name}.psd`);
  }
  return out;
}
