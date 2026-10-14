// README / release screenshots of the real interface, with demo data, composed like the real app.
//
// How: a frontend folder (BMM's by default) is served on 127.0.0.1 (a random port, by this
// script); with no Tauri runtime the app falls back to its built-in browser mock, which answers
// invoke() from assets/mock-fixtures.json. That file is replaced in flight by fixtures.mjs (demo
// data only). Headless Chrome/Edge (puppeteer-core) drives each scene of scenes.mjs.
//
// Composition (the default, « app »): what BMM looks like on a desktop. BMM's window is
// transparent around the app: the rounded app window with its own title bar sits 40 px in from
// the top-left, and Tasky (the mascot, ~110 px, the app's own Tasky_Happy.png or the theme's
// replacement) floats at the top-left corner, his centre near the window's corner, half of him
// outside it. The picture is the whole transparent canvas with a margin all round, so neither
// the window's shadow nor Tasky is clipped. --no-tasky hides him (same canvas); --tasky br is
// the old bottom-right placement inside the window.
//
// Each scene gives three pictures:
//   <name>.png                what you see
//   layers/<name>.screen.png  the same without Tasky      ┐ the editable layers, assembled in
//   layers/<name>.tasky.png   Tasky alone, transparent   ┘ source/<name>.svg (and .psd)
// The footer version pill and get_app_version say the version being released.
//
//   node tools/release/screenshots/shoot.mjs --version 1.0.3 [--out dir] [--lang en] [--theme dark]
//        [--theme-id bmm-white] [--frontend <dir>] [--no-tasky | --tasky app|br|off] [--no-psd] [scene …]

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildFixtures } from './fixtures.mjs';
import { scenes as allScenes } from './scenes.mjs';
import { ROOT, writeText } from '../lib/util.mjs';
import { launch, serveStatic } from '../lib/browser.mjs';
import { decodePng } from '../lib/png.mjs';
import { writePsd } from '../lib/psd.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Canvas geometry: viewport, margin round Tasky, window inset (the app's own 40 px offset kept). */
export const CANVAS = { width: 1640, height: 1040, taskyAt: 16, windowAt: 56, windowEnd: 24 };

const HIDE_NOISE = 'html,body{background:transparent!important} #toast-container{display:none!important}';
const layoutCss = (g) => `body:not(.is-maximized) #app-window-outer{top:${g.windowAt}px!important;left:${g.windowAt}px!important;right:${g.windowEnd}px!important;bottom:${g.windowEnd}px!important}
#app-mascot-container{top:${g.taskyAt}px!important;left:${g.taskyAt}px!important;animation:none!important;transition:none!important}
#app-mascot{animation:none!important;transition:none!important}
.resize-strips{display:none!important}`;
const NO_TASKY = '#app-mascot-container{visibility:hidden!important}';
const ONLY_TASKY = 'body *{visibility:hidden!important} #app-mascot-container,#app-mascot-container *{visibility:visible!important} html,body{background:transparent!important}';

/**
 * opts: { version, outDir, lang='en', theme='dark', themeId=null, only=[], tasky='app', psd=true,
 *         frontend=<BMM>/frontend, scenes=null (list to use instead of scenes.mjs), names={scene: file name}, log }
 * Returns { shots: [{ name, png, psd, w, h, readme }], missing: [commands] }.
 */
export async function shoot(o) {
  const { version, outDir, lang = 'en', theme = 'dark', themeId = null, only = [], tasky = 'app', psd = true, log = console } = o;
  const frontend = o.frontend ?? join(ROOT, 'frontend');
  const sceneList = o.scenes ?? allScenes;
  const g = CANVAS;
  mkdirSync(join(outDir, 'layers'), { recursive: true });
  mkdirSync(join(outDir, 'source'), { recursive: true });
  const base = JSON.parse(readFileSync(join(frontend, 'assets', 'mock-fixtures.json'), 'utf8'));
  const server = await serveStatic(frontend);
  const profileDir = join(outDir, '.chrome-profile');
  const browser = await launch({ userDataDir: profileDir, args: [`--window-size=${g.width},${g.height}`, '--hide-scrollbars', '--force-color-profile=srgb', '--no-sandbox'], defaultViewport: { width: g.width, height: g.height, deviceScaleFactor: 1 } });
  const missing = new Set();
  const shots = [];
  try {
    for (const s of sceneList) {
      if (only.length && !only.includes(s.name)) continue;
      const th = s.theme ?? theme;
      const fixtures = buildFixtures(base, { lang, theme: th, version, frontend });
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: th }, { name: 'prefers-reduced-motion', value: s.motion ? 'no-preference' : 'reduce' }]);
      await page.setRequestInterception(true);
      page.on('request', (r) => (r.url().endsWith('/assets/mock-fixtures.json')
        ? r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(fixtures) }) : r.continue()));
      page.on('console', (m) => { const mm = /^\[Mock\] (\S+)/.exec(m.text()); if (mm && !(mm[1] in fixtures)) missing.add(mm[1]); });
      if (s.pre) await page.evaluateOnNewDocument(s.pre, { lang, theme: th });
      await page.evaluateOnNewDocument((p) => {
        try {
          localStorage.setItem('bmm_lang', p.lang); localStorage.setItem('bmm-lang', p.lang);
          localStorage.setItem('bmm_lang_selected', 'true');
          localStorage.setItem('bmm_launch_mute_release_notes', '1');
          localStorage.setItem('bmm_launch_deck_enabled', '0');
          localStorage.setItem('bmm_tasky_visible', 'true');      // Tasky as in the app (hidden later for --no-tasky)
          localStorage.setItem('bmm_tasky_tooltip', 'false');     // no speech bubble over the content
          localStorage.setItem('bmm_tasky_animated', 'false');    // still pose, no bounce mid-capture
          localStorage.setItem('bmm_tips_visible', 'false');
          const id = p.themeId ?? (p.theme === 'light' ? 'bmm-white' : null);
          if (id) localStorage.setItem('bmm_active_theme', id);
        } catch { /* storage off */ }
      }, { lang, theme: th, themeId: s.themeId ?? themeId });
      await page.goto(server.url, { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(s.bootWait ?? 4000);
      try { if (s.run) await s.run(page); } catch (e) { log.warn?.(`${s.name}: scene script failed (${e.message})`); }
      await page.evaluate((v, css) => {
        const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
        document.querySelectorAll('.footer-version-pill').forEach((el) => { el.textContent = `v${v}`; });
        document.body.classList.remove('tasky-hidden', 'is-maximized');
        const c = document.getElementById('app-mascot-container'); if (c) c.style.display = '';
      }, version, HIDE_NOISE + '\n' + layoutCss(g));
      await page.evaluate((mode) => {
        const c = document.getElementById('app-mascot-container');
        if (!c) return;
        if (mode === 'off') c.style.visibility = 'hidden';
        if (mode === 'br') {
          const r = document.getElementById('app-window-outer').getBoundingClientRect();
          c.style.setProperty('top', 'auto', 'important'); c.style.setProperty('left', 'auto', 'important');
          c.style.position = 'fixed'; c.style.right = `${window.innerWidth - r.right + 18}px`; c.style.bottom = `${window.innerHeight - r.bottom + 34}px`;
        }
      }, tasky);
      await sleep(400);
      const clip = s.clip || { x: 0, y: 0, width: g.width, height: g.height };
      const shotWith = async (css) => {
        let handle = null;
        if (css) handle = await page.evaluateHandle((t) => { const st = document.createElement('style'); st.textContent = t; document.head.appendChild(st); return st; }, css);
        await sleep(120);
        const buf = await page.screenshot({ clip, omitBackground: true, type: 'png' });
        if (handle) { await page.evaluate((st) => st.remove(), handle); await handle.dispose(); }
        return buf;
      };
      const full = await shotWith(null);
      const screen = tasky === 'off' ? full : await shotWith(NO_TASKY);
      const mascot = tasky === 'off' ? null : await shotWith(ONLY_TASKY);
      const name = o.names?.[s.name] ?? s.name;
      writeFileSync(join(outDir, `${name}.png`), full);
      const W = Math.round(clip.width), H = Math.round(clip.height);
      let psdFile = null;
      if (o.layers !== false) {
        writeFileSync(join(outDir, 'layers', `${name}.screen.png`), screen);
        if (mascot) writeFileSync(join(outDir, 'layers', `${name}.tasky.png`), mascot);
        writeText(join(outDir, 'source', `${name}.svg`), screenshotSvg(name, W, H, version, { tasky: !!mascot }));
        if (psd) {
          const a = decodePng(screen), f = decodePng(full);
          const layers = [{ name: 'screenshot', rgba: a.data }];
          if (mascot) layers.push({ name: 'Tasky', rgba: decodePng(mascot).data });
          psdFile = join(outDir, 'source', `${name}.psd`);
          writeFileSync(psdFile, writePsd({ width: a.width, height: a.height, layers, composite: f.data, matte: [11, 15, 25] }));
        }
      }
      shots.push({ name, readme: s.readme !== false, png: join(outDir, `${name}.png`), psd: psdFile, w: W, h: H, tasky: !!mascot });
      log.info?.(`  shot ${name} (${W}×${H})`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    await server.close();
    rmSync(profileDir, { recursive: true, force: true });
  }
  if (o.layers !== false) writeText(join(outDir, 'layers', 'missing-mock-commands.txt'), [...missing].sort().join('\n') + '\n');
  return { shots, missing: [...missing].sort() };
}

/**
 * Layered SVG of one screenshot: « screenshot » and « Tasky » layers, linked from ../layers/ so
 * it stays small next to the PNGs.
 */
export function screenshotSvg(name, w, h, version, { tasky = true } = {}) {
  const img = (f) => `<image href="../layers/${f}" xlink:href="../layers/${f}" width="${w}" height="${h}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <!-- BMM ${version} screenshot « ${name} », demo data, transparent canvas. Layers: screenshot (the app window without Tasky)${tasky ? ', Tasky (the mascot alone, movable)' : ''}.
       Generated by tools/release/screenshots/shoot.mjs. Images are linked from ../layers/. -->
  <g id="screenshot" inkscape:groupmode="layer" inkscape:label="screenshot">${img(`${name}.screen.png`)}</g>
${tasky ? `  <g id="tasky" inkscape:groupmode="layer" inkscape:label="Tasky">${img(`${name}.tasky.png`)}</g>\n` : ''}</svg>
`;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('screenshots/shoot.mjs')) {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(k); if (i < 0) return null; const v = a[i + 1]; a.splice(i, 2); return v; };
  const flag = (k) => { const i = a.indexOf(k); if (i < 0) return false; a.splice(i, 1); return true; };
  const version = get('--version') ?? JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const outDir = get('--out') ?? join(ROOT, 'Release', version, 'media', 'screenshots');
  const lang = get('--lang') ?? 'en', theme = get('--theme') ?? 'dark', themeId = get('--theme-id'), frontend = get('--frontend');
  let tasky = get('--tasky') ?? 'app';
  if (flag('--no-tasky')) tasky = 'off';
  const psd = !flag('--no-psd');
  const r = await shoot({ version, outDir, lang, theme, themeId, frontend: frontend ?? undefined, tasky, psd, only: a.filter((x) => !x.startsWith('--')), log: { info: console.log, warn: console.log } });
  console.log(`${r.shots.length} scenes → ${outDir}${r.missing.length ? ` (mock commands without demo data: ${r.missing.length}, see layers/missing-mock-commands.txt)` : ''}`);
}
