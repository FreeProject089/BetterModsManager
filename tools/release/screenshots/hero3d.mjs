// The README hero, semi-3D (1600×800, since 1.0.4): three real BMM windows (screenshots of the
// release, shoot.mjs) floating in perspective with soft depth shadows, a slight tilt each,
// layered parallax, a glow in the brand blue and a floor reflection, Tasky peeking over the
// front window, and the wordmark, tagline and version on the left. The flat banner of earlier
// releases is kept as hero-flat.png (hero.mjs).
//
// Outputs (buildHero3d):
//   hero.png, hero@2x.png               the still (t = 0 of the loop)
//   hero.svg, hero.psd                  layered sources: background (field + glow, grid), the
//                                       windows and Tasky as raster layers drawn in 3D by the
//                                       stage, the wordmark / tagline / badge as vector text
//   hero.mp4, hero.webm, hero.gif       the loop (6 s): every window floats on its own sine,
//                                       so the windows drift apart and back (parallax)
//
//   node tools/release/screenshots/hero3d.mjs --version 1.0.4 --shots <screenshots dir> [--out dir] [--no-loop]

import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { backgroundLayers, lockup, badge, lines, C, assembleSvg, layeredPsd, windowItem, findShots, taskyHref, textSidecar } from '../media/cards.mjs';
import { fitText } from '../media/metrics.mjs';
import { openStage } from '../media/stage.mjs';
import { writeText, ROOT } from '../lib/util.mjs';
import { ffmpegPath, ff } from './gifs.mjs';

export const HERO3D = { w: 1600, h: 800, period: 6, fps: 30 };
export const HERO3D_SHOTS = { back: 'library', middle: 'theme-editor', front: 'automations-flow' };
const TAGLINE = { en: 'Profiles, a mod library, modpacks and Server Repo sync, in one Windows app.', fr: 'Profils, bibliothèque de mods, modpacks et Server Repo, dans une appli Windows.' };

/** The stage items (windows) of the hero. shots = { name: { src, w, h } }, tasky = { src } or null. */
export function heroItems(shots, tasky, names = HERO3D_SHOTS) {
  const rot = { x: 7, y: -19, z: 1.2 };
  const items = [];
  if (shots[names.back]) items.push(windowItem('window-back', 'Window (back)', shots[names.back], { x: 790, y: 60, w: 740, rotate: rot, perspective: 2200, glow: 'rgba(59,130,246,0.20)', shadow: { dy: 30, blur: 60, alpha: 0.5 }, float: { amp: 7, rot: 0.25, phase: 0 } }));
  if (shots[names.middle]) items.push(windowItem('window-middle', 'Window (middle)', shots[names.middle], { x: 1010, y: 260, w: 620, rotate: rot, perspective: 2200, glow: 'rgba(59,130,246,0.22)', shadow: { dy: 40, blur: 70, alpha: 0.6 }, float: { amp: 10, rot: 0.35, phase: 0.33 } }));
  if (shots[names.front]) {
    items.push(windowItem('window-front', 'Window (front)', shots[names.front], { x: 760, y: 410, w: 580, rotate: rot, perspective: 2200, glow: 'rgba(245,158,11,0.16)', reflect: 0.12, shadow: { dy: 50, blur: 80, alpha: 0.7 }, float: { amp: 13, rot: 0.45, phase: 0.66 },
      perch: tasky ? { src: tasky.src, size: 104, along: 0.16 } : null }));
  }
  return items;
}

/** The vector layers: background and grid, then the text on the left. lang = 'en' | 'fr'. */
export function heroTextLayers(version, lang = 'en') {
  const { w, h } = HERO3D;
  const x = 104;
  const tag = fitText(TAGLINE[lang] ?? TAGLINE.en, { face: 'seg500', maxW: 560, maxLines: 2, size: 30, min: 24, balance: true });
  const blockH = 92 + 46 + tag.size * 0.8 + (tag.lines.length - 1) * tag.size * 1.3 + 44 + 44;
  const top = (h - blockH) / 2;
  const lk = lockup(x, top, 92);
  const tl = lines(x, top + 92 + 46 + tag.size * 0.8, tag.lines, { size: tag.size, face: 'seg500', fill: C.ink2, lh: 1.3 });
  const bd = badge(x, tl.bottom + 44, 44, version, { prefix: 'Version ' });
  const meta = lines(x + bd.w + 18, tl.bottom + 44 + 30, [lang === 'fr' ? 'Windows · Gratuit et libre' : 'Windows · Free and open source'], { size: 20, face: 'seg600', fill: C.muted });
  const L = (id, label, group, body) => ({ id, label, group, body });
  return {
    under: backgroundLayers(w, h, { blue: [w * 0.7, h * 0.5], amber: [w * 0.62, h * 1.05], focus: [w * 0.7, h * 0.52], seed: 4 }),
    over: [L('brand', 'Wordmark', 'Brand', lk.svg), L('tagline', 'Tagline', 'Text', tl.svg), L('version', 'Badge', 'Brand', bd.svg), L('meta', 'Platform', 'Text', meta.svg)],
    texts: [{ layer: 'Tagline', text: tag.lines.join(' ') }, { layer: 'Badge', text: `Version ${version}` }, { layer: 'Platform', text: lang === 'fr' ? 'Windows · Gratuit et libre' : 'Windows · Free and open source' }],
  };
}

/**
 * Write the semi-3D hero. shotsDirs: where the screenshots are. pngDir gets hero.png and
 * hero@2x.png; svgDir / psdDir the layered sources; loopDir (when ffmpeg is there and loop is
 * on) hero.mp4, hero.webm, hero.gif. linkedSourceDir + layersDir: a copy of hero.svg whose
 * raster layers are LINKED PNGs in layersDir (for .github/screenshots). Returns the paths.
 */
export async function buildHero3d({ version, browser, shotsDirs, pngDir, svgDir, psdDir, loopDir = null, loop = true, linkedSourceDir = null, layersDir = null, linkPrefix = '../layers/', lang = 'en', log = console }) {
  const { w, h, period, fps } = HERO3D;
  const shots = findShots(Object.values(HERO3D_SHOTS), shotsDirs);
  const missing = Object.values(HERO3D_SHOTS).filter((n) => !shots[n]);
  if (missing.length === 3) throw new Error(`the hero needs the screenshots ${Object.values(HERO3D_SHOTS).join(', ')}`);
  const tasky = taskyHref();
  const items = heroItems(shots, tasky);
  const text = heroTextLayers(version, lang);
  const out = { missing };
  // Raster layers at 2x: the SVG stays sharp for hero@2x.png.
  const st = await openStage(browser, { w, h, period, items }, { scale: 2 });
  const raster = [];
  try {
    for (const it of items) {
      if (it.perch) raster.push({ id: it.perch.id, label: 'Tasky', group: 'Tasky', body: '', png: await st.shot({ only: it.perch.id }) });
      raster.push({ id: it.id, label: it.label, group: 'Windows', body: '', png: await st.shot({ only: it.id }) });
    }
  } finally { await st.close(); }
  for (const r of raster) r.body = `<image width="${w}" height="${h}" href="data:image/png;base64,${r.png.toString('base64')}"/>`;
  const layers = [...text.under, ...raster, ...text.over];
  const note = `BMM ${version} README hero (semi-3D). Fonts: Segoe UI Variable, Bricolage Grotesque 800 (embedded); the wordmark is outlined. Generated by tools/release/screenshots/hero3d.mjs.`;
  mkdirSync(svgDir, { recursive: true }); mkdirSync(psdDir, { recursive: true }); mkdirSync(pngDir, { recursive: true });
  writeText(join(svgDir, 'hero.svg'), assembleSvg(w, h, layers, { note })); out.svg = join(svgDir, 'hero.svg');
  const r1 = await layeredPsd(browser, w, h, layers);
  writeFileSync(join(psdDir, 'hero.psd'), r1.psd); out.psd = join(psdDir, 'hero.psd');
  writeText(join(psdDir, 'hero.txt'), textSidecar('hero.psd', text.texts, '../svg/hero.svg'));
  writeFileSync(join(pngDir, 'hero.png'), r1.png); out.png = join(pngDir, 'hero.png');
  const { svgToPng } = await import('../lib/browser.mjs');
  writeFileSync(join(pngDir, 'hero@2x.png'), await svgToPng(browser, assembleSvg(w, h, layers, { source: false }), w, h, { scale: 2, transparent: true }));
  out.png2x = join(pngDir, 'hero@2x.png');
  if (linkedSourceDir && layersDir) {
    mkdirSync(layersDir, { recursive: true });
    const { decodePng } = await import('../lib/png.mjs');
    const linked = layers.map((L) => {
      if (!L.png) return L;
      const f = `hero.${L.id}.png`;
      writeFileSync(join(layersDir, f), L.png);
      void decodePng;
      return { ...L, body: `<image width="${w}" height="${h}" href="${linkPrefix}${f}" xlink:href="${linkPrefix}${f}"/>` };
    });
    writeText(join(linkedSourceDir, 'hero.svg'), assembleSvg(w, h, linked, { note: `${note} Raster layers are linked from ${linkPrefix}.` }));
    out.linked = join(linkedSourceDir, 'hero.svg');
  }
  if (loop && loopDir) out.loop = await renderLoop({ browser, items, text, loopDir, log });
  return out;
}

/** Frames of the loop through the stage (background and text drawn once, the windows move), then ffmpeg. */
export async function renderLoop({ browser, items, text, loopDir, seconds = HERO3D.period, fps = HERO3D.fps, log = console }) {
  const ffmpeg = ffmpegPath();
  if (!ffmpeg) { log.warn?.('hero loop skipped: ffmpeg not found'); return null; }
  const { w, h, period } = HERO3D;
  const frames = join(loopDir, '.hero-frames');
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const under = assembleSvg(w, h, text.under, { source: false });
  const over = assembleSvg(w, h, text.over, { source: false });
  const st = await openStage(browser, { w, h, period, items, under, over }, { scale: 1 });
  const n = Math.round(seconds * fps);
  try {
    for (let i = 0; i < n; i++) writeFileSync(join(frames, `f${String(i).padStart(4, '0')}.png`), await st.shot({ t: (i / n) * period }));
  } finally { await st.close(); }
  const src = ['-framerate', String(fps), '-i', join(frames, 'f%04d.png')];
  const mp4 = join(loopDir, 'hero.mp4'), webm = join(loopDir, 'hero.webm'), gif = join(loopDir, 'hero.gif');
  ff(ffmpeg, [...src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', mp4]);
  try { ff(ffmpeg, [...src, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-crf', '34', '-b:v', '0', '-row-mt', '1', webm]); } catch (e) { log.warn?.(`hero.webm not written: ${e.message}`); }
  ff(ffmpeg, [...src, '-vf', 'fps=15,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=3', '-loop', '0', gif]);
  rmSync(frames, { recursive: true, force: true });
  return { mp4, webm: existsSync(webm) ? webm : null, gif, frames: n };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('screenshots/hero3d.mjs')) {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const version = get('--version') ?? JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const shots = get('--shots') ?? join(ROOT, 'Release', version, 'media', 'screenshots');
  const outDir = get('--out') ?? join(ROOT, 'Release', version, 'media');
  const { launch } = await import('../lib/browser.mjs');
  const browser = await launch();
  try {
    const r = await buildHero3d({ version, browser, shotsDirs: [shots, join(ROOT, '.github', 'screenshots')], pngDir: join(outDir, 'screenshots'), svgDir: join(outDir, 'source', 'svg'), psdDir: join(outDir, 'source', 'psd'), loopDir: join(outDir, 'screenshots'), loop: !a.includes('--no-loop'), log: { warn: console.log } });
    console.log(JSON.stringify(r, null, 1));
  } finally { await browser.close(); }
}
