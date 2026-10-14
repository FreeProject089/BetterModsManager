// Theme previews (THEMES.md): the Library of the real app, demo data, once per built-in theme,
// in the same composition as every other screenshot (whole window on a transparent canvas,
// Tasky — or the theme's replacement for him — over the top-left corner).
//
//   node tools/release/screenshots/themes.mjs --frontend <checkout>/frontend --out <checkout>/.github/themes
//        [--version 1.0.3] [--no-tasky] [--scale 0.78] [id …]
//
// --frontend picks the checkout whose interface and built-in themes are shown (e.g. a release
// worktree); the version shown in the app defaults to that checkout's package.json. --scale
// shrinks the pictures (THEMES.md shows 14 of them; 0.78 keeps them about 1280 px wide).

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, renameSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { shoot } from './shoot.mjs';
import { launch } from '../lib/browser.mjs';
import { ROOT } from '../lib/util.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nav = (v) => async (p) => { await p.click(`#nav-${v}`); await p.mouse.move(1600, 1020); await sleep(2500); };

export function builtinThemes(frontend) {
  const dir = join(frontend, 'assets', 'builtin-themes');
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))).map((t) => ({ id: t.id, name: t.name, mode: t.mode === 'light' ? 'light' : 'dark' }));
}

/** Downscale PNGs in place with the browser (keeps transparency). */
async function downscale(files, scale) {
  const b = await launch();
  try {
    const page = await b.newPage();
    for (const f of files) {
      const data = readFileSync(f).toString('base64');
      const out = await page.evaluate(async (src, k) => {
        const img = new Image(); img.src = src; await img.decode();
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL('image/png').split(',')[1];
      }, `data:image/png;base64,${data}`, scale);
      writeFileSync(f, Buffer.from(out, 'base64'));
    }
  } finally { await b.close(); }
}

export async function shootThemes({ frontend, outDir, version, tasky = 'app', scale = 0.78, only = [], log = console }) {
  const themes = builtinThemes(frontend).filter((t) => !only.length || only.includes(t.id));
  const work = join(outDir, '.work');
  mkdirSync(work, { recursive: true });
  const scenes = themes.map((t) => ({ name: t.id, themeId: t.id, theme: t.mode, run: nav('library') }));
  const r = await shoot({ version, outDir: work, frontend, scenes, tasky, psd: false, layers: false, log });
  const files = [];
  for (const s of r.shots) { const dest = join(outDir, `${s.name}.png`); renameSync(s.png, dest); files.push(dest); }
  rmSync(work, { recursive: true, force: true });
  if (scale && scale !== 1) await downscale(files, scale);
  return files;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('screenshots/themes.mjs')) {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(k); if (i < 0) return null; const v = a[i + 1]; a.splice(i, 2); return v; };
  const flag = (k) => { const i = a.indexOf(k); if (i < 0) return false; a.splice(i, 1); return true; };
  const frontend = resolve(get('--frontend') ?? join(ROOT, 'frontend'));
  const outDir = resolve(get('--out') ?? join(dirname(frontend), '.github', 'themes'));
  let version = get('--version');
  if (!version) { try { version = JSON.parse(readFileSync(join(dirname(frontend), 'package.json'), 'utf8')).version; } catch { version = '0.0.0'; } }
  const scale = +(get('--scale') ?? 0.78);
  const files = await shootThemes({ frontend, outDir, version, tasky: flag('--no-tasky') ? 'off' : 'app', scale, only: a.filter((x) => !x.startsWith('--')), log: { info: console.log, warn: console.log } });
  console.log(`${files.length} theme previews → ${outDir} (BMM ${version})`);
}
