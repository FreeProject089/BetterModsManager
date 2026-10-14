// Example-usage GIFs (and MP4 copies) of the real interface, recorded from the same static
// preview as the screenshots (shoot.mjs): BMM's frontend served on 127.0.0.1, the built-in
// browser mock answering invoke() from demo data (fixtures.mjs), headless Chrome/Edge driven
// by puppeteer-core. The composition is the screenshots' one: the app window inset from the
// top-left, Tasky at its corner, half outside it, on a dark « desktop ».
//
// How a clip is made:
//   1. the scene's `setup` brings the app where the clip starts (not recorded);
//   2. the page is recorded with the DevTools screencast (a frame on every repaint, with its
//      timestamp) while the scene's `run` clicks, types and scrolls, a drawn mouse pointer
//      following the real (synthetic) mouse;
//   3. ffmpeg turns the frames, each held for its real duration, into an MP4 (native size,
//      30 fps) and a palette-optimised GIF (default 1000 px wide, 14 fps). A GIF over the size
//      limit is made again smaller (fewer colours, then narrower) until it fits.
//
// The scenes are in gif-scenes.mjs. A scene can answer mock commands itself (`mock`: a value,
// or a function (args, state) run in the page, which may return a promise to show a spinner),
// for what the static fixtures cannot show: a repo that answers a test, a list that grows.
//
//   node tools/release/screenshots/gifs.mjs [--version 1.0.3] [--out dir] [--width 1000] [--fps 14]
//        [--max-mb 8] [--lang en] [--previews] [--keep-frames] [scene …]
//
// Output: <out>/<name>.gif, <name>.mp4, gifs.json (name, title, size, duration), and with
// --previews <out>/previews/<name>.png (a frame from the middle of the clip).

import { readFileSync, writeFileSync, mkdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildFixtures } from './fixtures.mjs';
import { gifScenes } from './gif-scenes.mjs';
import { ROOT, writeText, writeJson } from '../lib/util.mjs';
import { launch, serveStatic } from '../lib/browser.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Recording geometry: smaller than the screenshots' canvas so the UI reads at GIF width. */
export const GIF_CANVAS = { width: 1360, height: 860, taskyAt: 12, windowAt: 48, windowEnd: 18 };
export const GIF_DEFAULTS = { width: 1000, fps: 14, maxMb: 8, mp4Fps: 30 };
const DESKTOP = '#0b0f19';

const layoutCss = (g) => `html{background:radial-gradient(1200px 520px at 12% 0%,#1d2b4f 0%,rgba(29,43,79,0) 62%),radial-gradient(900px 500px at 100% 100%,#3a2410 0%,rgba(58,36,16,0) 58%),${DESKTOP}!important;min-height:100%}
body{background:transparent!important}
body:not(.is-maximized) #app-window-outer{top:${g.windowAt}px!important;left:${g.windowAt}px!important;right:${g.windowEnd}px!important;bottom:${g.windowEnd}px!important}
#app-mascot-container{top:${g.taskyAt}px!important;left:${g.taskyAt}px!important;animation:none!important;transition:none!important}
#app-mascot{animation:none!important;transition:none!important}
.resize-strips{display:none!important}
#gif-cursor{position:fixed;left:0;top:0;width:22px;height:28px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.55))}
.gif-ripple{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid rgba(245,158,11,.95);background:rgba(245,158,11,.18);z-index:2147483646;pointer-events:none;animation:gif-ripple .45s ease-out forwards}
@keyframes gif-ripple{from{transform:scale(.35);opacity:1}to{transform:scale(1.25);opacity:0}}`;

/** In the page before any script: scene mock answers in front of the fixtures, and the pointer. */
function pageHooks(p) {
  const mock = {};
  for (const [k, v] of Object.entries(p.mock || {})) {
    // eslint-disable-next-line no-new-func
    mock[k] = v && v.fn ? new Function(`return (${v.fn})`)() : v.value;
  }
  window.__gifState = {};
  window.__gifArgs = {};
  window.__gifMock = mock;
  // mockInvoke logs `[Mock] <command>` with its arguments just before it reads the fixtures.
  const log = console.log;
  console.log = function (...a) {
    if (typeof a[0] === 'string' && a[0].startsWith('[Mock] ')) window.__gifArgs[a[0].slice(7)] = a[1] || {};
    return log.apply(this, a);
  };
  const json = Response.prototype.json;
  Response.prototype.json = async function () {
    const data = await json.call(this);
    if (!/\/assets\/mock-fixtures\.json$/.test(this.url) || !data || typeof data !== 'object') return data;
    const answer = (cmd) => {
      const v = window.__gifMock[cmd];
      return typeof v === 'function' ? v(window.__gifArgs[cmd] || {}, window.__gifState, data) : v;
    };
    return new Proxy(data, {
      get: (t, k) => (typeof k === 'string' && Object.prototype.hasOwnProperty.call(window.__gifMock, k) ? answer(k) : t[k]),
      getOwnPropertyDescriptor: (t, k) => (typeof k === 'string' && Object.prototype.hasOwnProperty.call(window.__gifMock, k)
        ? { value: undefined, writable: true, enumerable: true, configurable: true } : Reflect.getOwnPropertyDescriptor(t, k)),
      has: (t, k) => (typeof k === 'string' && Object.prototype.hasOwnProperty.call(window.__gifMock, k)) || k in t,
    });
  };
}

/** The drawn pointer: follows mousemove, a ripple on each press. */
function installCursor() {
  if (document.getElementById('gif-cursor')) return;
  const c = document.createElement('div');
  c.id = 'gif-cursor';
  c.innerHTML = '<svg width="22" height="28" viewBox="0 0 22 28"><path d="M2 2 L2 22 L7.5 17 L11.5 26 L15 24.5 L11 15.8 L18.5 15.8 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  document.documentElement.appendChild(c);
  const pos = { x: -100, y: -100 };
  document.addEventListener('mousemove', (e) => { pos.x = e.clientX; pos.y = e.clientY; c.style.transform = `translate(${e.clientX - 2}px,${e.clientY - 2}px)`; }, true);
  document.addEventListener('mousedown', () => {
    const r = document.createElement('div'); r.className = 'gif-ripple';
    r.style.left = `${pos.x}px`; r.style.top = `${pos.y}px`;
    document.documentElement.appendChild(r); setTimeout(() => r.remove(), 600);
  }, true);
}

/** The helpers a scene's setup/run receives. */
function helpers(page) {
  const mouse = { x: 1100, y: 760 };
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const box = async (target) => {
    if (typeof target === 'object' && 'x' in target) return target;
    const el = typeof target === 'string' ? await page.waitForSelector(target, { visible: true, timeout: 8000 }) : target;
    await el.evaluate((n) => n.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    const b = await el.boundingBox();
    if (!b) throw new Error(`no box for ${target}`);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const h = {
    page, sleep,
    /** Glide the pointer to a selector, element or {x,y}. */
    async move(target, ms = 650) {
      const to = await box(target);
      // Paced by the clock, not by a step count: each synthetic move costs a round trip.
      const from = { ...mouse };
      const t0 = Date.now();
      for (;;) {
        const k = Math.min(1, (Date.now() - t0) / ms);
        await page.mouse.move(from.x + (to.x - from.x) * ease(k), from.y + (to.y - from.y) * ease(k));
        if (k >= 1) break;
        await sleep(16);
      }
      mouse.x = to.x; mouse.y = to.y;
      return to;
    },
    async click(target, { pause = 380, ms, quick = false } = {}) {
      await h.move(target, ms);
      await sleep(140);
      // quick: press and release in one go, for a target that repaints (a live list).
      if (quick) await page.mouse.click(mouse.x, mouse.y);
      else { await page.mouse.down(); await sleep(70); await page.mouse.up(); }
      await sleep(pause);
    },
    /** Type like a person (a selector focuses it with a click first). */
    async type(target, text, { delay = 75 } = {}) {
      if (target) await h.click(target, { pause: 200 });
      for (const ch of text) { await page.keyboard.type(ch); await sleep(delay + Math.random() * 40); }
    },
    async key(k, pause = 300) { await page.keyboard.press(k); await sleep(pause); },
    async combo(mod, k, pause = 300) { await page.keyboard.down(mod); await page.keyboard.press(k); await page.keyboard.up(mod); await sleep(pause); },
    /** Smooth wheel scroll over a point/selector: total px, positive = down. */
    async scroll(target, total, ms = 900) {
      await h.move(target, 400);
      const steps = Math.max(6, Math.round(ms / 40));
      for (let i = 0; i < steps; i++) { await page.mouse.wheel({ deltaY: total / steps }); await sleep(ms / steps); }
    },
    eval: (fn, ...a) => page.evaluate(fn, ...a),
    /** Click without the pointer (setup only). */
    async tap(sel) { await page.evaluate((s) => document.querySelector(s)?.click(), sel); },
    async nav(view, wait = 1800) { await page.evaluate((v) => document.getElementById(`nav-${v}`)?.click(), view); await sleep(wait); },
    /** The first visible element whose text matches, as a handle (for click/move). */
    async byText(selector, re) {
      const handle = await page.evaluateHandle((s, src, flags) => {
        const rx = new RegExp(src, flags);
        return [...document.querySelectorAll(s)].find((n) => n.offsetParent !== null && rx.test(n.textContent || n.title || n.getAttribute('aria-label') || '')) || null;
      }, selector, re.source, re.flags);
      const el = handle.asElement();
      if (!el) throw new Error(`nothing matches ${selector} ${re}`);
      return el;
    },
    /** The i-th match of a selector (negative counts from the end), as a handle. */
    async nth(selector, i) {
      const handle = await page.evaluateHandle((s, n) => { const all = [...document.querySelectorAll(s)]; return all.at(n) || null; }, selector, i);
      const el = handle.asElement();
      if (!el) throw new Error(`no match ${i} for ${selector}`);
      return el;
    },
    mouse,
  };
  return h;
}

function ffmpegPath() {
  const c = [process.env.FFMPEG, 'C:/ffmpeg/bin/ffmpeg.exe', 'C:/Program Files/ffmpeg/bin/ffmpeg.exe'];
  const p = c.find((x) => x && existsSync(x));
  if (p) return p;
  const w = spawnSync('where', ['ffmpeg'], { encoding: 'utf8', windowsHide: true });
  return w.status === 0 ? w.stdout.split(/\r?\n/)[0].trim() || null : null;
}

function ff(ffmpeg, args) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${(r.stderr || '').trim().split(/\r?\n/).slice(-3).join(' | ')}`);
}

/** Frames → concat list with each frame's real duration (the last one held `hold` s). */
export function writeConcat(dir, frames, endTs, hold) {
  const lines = ['ffconcat version 1.0'];
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].ts : endTs;
    const d = Math.max(0.001, next - f.ts) + (i + 1 === frames.length ? hold : 0);
    lines.push(`file '${f.file}'`, `duration ${d.toFixed(4)}`);
  });
  lines.push(`file '${frames.at(-1).file}'`);
  writeFileSync(join(dir, 'list.ffconcat'), lines.join('\n') + '\n');
  return join(dir, 'list.ffconcat');
}

/** Encode one clip: MP4 at native size, then a GIF that fits under maxMb. */
export function encodeClip(ffmpeg, list, { gif, mp4, width, fps, maxMb, mp4Fps = GIF_DEFAULTS.mp4Fps, speed = 1 }) {
  // speed > 1 plays the recording faster (a long form typed at a human pace).
  const pts = speed && speed !== 1 ? `setpts=PTS/${speed},` : '';
  ff(ffmpeg, ['-f', 'concat', '-safe', '0', '-i', list, '-vf', `${pts}fps=${mp4Fps},scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', '-an', mp4]);
  const tries = [[width, fps, 256], [width, fps, 192], [width, fps, 128], [Math.round(width * 0.9), fps, 128], [Math.round(width * 0.8), Math.max(10, fps - 2), 128]];
  let last = null;
  for (const [w, f, colors] of tries) {
    ff(ffmpeg, ['-i', mp4, '-vf', `fps=${f},scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, '-loop', '0', gif]);
    last = { width: w, fps: f, colors, bytes: statSync(gif).size };
    if (last.bytes <= maxMb * 1048576) return last;
  }
  return { ...last, overLimit: true };
}

function probeDuration(ffmpeg, file) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8', windowsHide: true });
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr || '');
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
}

/**
 * opts: { version, outDir, lang='en', theme='dark', only=[], width, fps, maxMb, previews=false,
 *         keepFrames=false, frontend, scenes (instead of gif-scenes.mjs), log }
 * Returns { clips: [{ name, title, desc, gif, mp4, bytes, mp4Bytes, seconds, width, fps }], skipped: [{ name, why }] }.
 */
export async function recordGifs(o) {
  const { version, outDir, lang = 'en', theme = 'dark', only = [], log = console } = o;
  const width = o.width ?? GIF_DEFAULTS.width, fps = o.fps ?? GIF_DEFAULTS.fps, maxMb = o.maxMb ?? GIF_DEFAULTS.maxMb;
  const ffmpeg = o.ffmpeg ?? ffmpegPath();
  if (!ffmpeg) throw new Error('ffmpeg not found (set FFMPEG, or install it to C:/ffmpeg/bin)');
  const frontend = o.frontend ?? join(ROOT, 'frontend');
  const list = (o.scenes ?? gifScenes).filter((s) => !only.length || only.includes(s.name));
  const g = GIF_CANVAS;
  mkdirSync(outDir, { recursive: true });
  const base = JSON.parse(readFileSync(join(frontend, 'assets', 'mock-fixtures.json'), 'utf8'));
  const server = await serveStatic(frontend);
  const profileDir = join(outDir, '.chrome-profile');
  const browser = await launch({ userDataDir: profileDir, args: [`--window-size=${g.width},${g.height}`, '--hide-scrollbars', '--force-color-profile=srgb', '--no-sandbox'], defaultViewport: { width: g.width, height: g.height, deviceScaleFactor: 1 } });
  const clips = [], skipped = [];
  try {
    for (const s of list) {
      if (s.skip) { skipped.push({ name: s.name, why: s.skip }); continue; }
      const th = s.theme ?? theme;
      const fixtures = buildFixtures(base, { lang, theme: th, version, frontend });
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      const work = join(outDir, '.frames', s.name);
      rmSync(work, { recursive: true, force: true });
      mkdirSync(work, { recursive: true });
      try {
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: th }, { name: 'prefers-reduced-motion', value: 'no-preference' }]);
        await page.setRequestInterception(true);
        page.on('request', (r) => (r.url().endsWith('/assets/mock-fixtures.json')
          ? r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(fixtures) }) : r.continue()));
        const mock = Object.fromEntries(Object.entries(s.mock || {}).map(([k, v]) => [k, typeof v === 'function' ? { fn: v.toString() } : { value: v }]));
        await page.evaluateOnNewDocument(pageHooks, { mock });
        await page.evaluateOnNewDocument((p) => {
          try {
            localStorage.setItem('bmm_lang', p.lang); localStorage.setItem('bmm-lang', p.lang);
            localStorage.setItem('bmm_lang_selected', 'true');
            localStorage.setItem('bmm_launch_mute_release_notes', '1');
            localStorage.setItem('bmm_launch_deck_enabled', '0');
            localStorage.setItem('bmm_tasky_visible', 'true');
            localStorage.setItem('bmm_tasky_tooltip', 'false');
            localStorage.setItem('bmm_tasky_animated', 'false');
            localStorage.setItem('bmm_tips_visible', 'false');
            if (p.theme === 'light') localStorage.setItem('bmm_active_theme', 'bmm-white');
            for (const [k, v] of Object.entries(p.storage || {})) localStorage.setItem(k, v);
          } catch { /* storage off */ }
        }, { lang, theme: th, storage: s.storage || {} });
        await page.goto(server.url, { waitUntil: 'networkidle2', timeout: 60000 });
        await sleep(s.bootWait ?? 3500);
        await page.evaluate((v, css) => {
          const st = document.createElement('style'); st.id = 'gif-layout'; st.textContent = css; document.head.appendChild(st);
          document.querySelectorAll('.footer-version-pill').forEach((el) => { el.textContent = `v${v}`; });
          document.body.classList.remove('tasky-hidden', 'is-maximized');
          const c = document.getElementById('app-mascot-container'); if (c) c.style.display = '';
          // Boot toasts (the mock's « could not read… » and friends) are not part of a clip.
          document.querySelectorAll('#toast-container > *').forEach((n) => n.remove());
        }, version, layoutCss(g));
        await page.evaluate(installCursor);
        const h = helpers(page);
        await page.mouse.move(h.mouse.x, h.mouse.y);
        if (s.setup) await s.setup(h);
        await page.evaluate(() => document.querySelectorAll('#toast-container > *').forEach((n) => n.remove()));
        await sleep(500);

        // Record.
        const cdp = await page.createCDPSession();
        const frames = [];
        let n = 0;
        cdp.on('Page.screencastFrame', (f) => {
          const file = `f${String(n++).padStart(5, '0')}.jpg`;
          writeFileSync(join(work, file), Buffer.from(f.data, 'base64'));
          frames.push({ file, ts: f.metadata.timestamp });
          cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
        });
        await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: g.width, maxHeight: g.height, everyNthFrame: 1 });
        // A first frame even if nothing repaints: nudge the pointer.
        await page.mouse.move(h.mouse.x + 1, h.mouse.y); await page.mouse.move(h.mouse.x, h.mouse.y);
        await sleep(s.leadIn ?? 700);
        let failed = null;
        try { await s.run(h); } catch (e) { failed = e; }
        await sleep(s.tail ?? 1200);
        const endTs = Date.now() / 1000;
        await cdp.send('Page.stopScreencast');
        await sleep(200);
        await cdp.detach().catch(() => {});
        if (failed) throw failed;
        if (frames.length < 2) throw new Error('no frames recorded');
        frames.sort((a, b) => a.ts - b.ts);
        const listFile = writeConcat(work, frames, endTs, s.hold ?? 0.6);
        const gif = join(outDir, `${s.name}.gif`), mp4 = join(outDir, `${s.name}.mp4`);
        const enc = encodeClip(ffmpeg, listFile, { gif, mp4, width, fps, maxMb, speed: s.speed ?? 1 });
        const seconds = probeDuration(ffmpeg, mp4);
        if (o.previews) {
          mkdirSync(join(outDir, 'previews'), { recursive: true });
          const at = s.previewAt ?? (seconds ? seconds * 0.6 : 3);
          ff(ffmpeg, ['-ss', at.toFixed(2), '-i', mp4, '-frames:v', '1', join(outDir, 'previews', `${s.name}.png`)]);
        }
        const clip = { name: s.name, title: s.title, desc: s.desc, gif, mp4, bytes: enc.bytes, mp4Bytes: statSync(mp4).size, seconds, width: enc.width, fps: enc.fps, colors: enc.colors, frames: frames.length, overLimit: !!enc.overLimit };
        clips.push(clip);
        log.info?.(`  ${s.name}: ${(clip.bytes / 1048576).toFixed(2)} MB GIF, ${seconds?.toFixed(1)} s, ${enc.width}px @ ${enc.fps} fps (${frames.length} frames)${enc.overLimit ? ' OVER THE LIMIT' : ''}`);
      } catch (e) {
        skipped.push({ name: s.name, why: `recording failed: ${e.message}` });
        log.warn?.(`  ${s.name}: ${e.message}`);
        if (o.debug) await page.screenshot({ path: join(outDir, `debug-${s.name}.png`) }).catch(() => {});
      } finally {
        await ctx.close().catch(() => {});
        if (!o.keepFrames) rmSync(work, { recursive: true, force: true });
      }
    }
  } finally {
    await browser.close();
    await server.close();
    rmSync(profileDir, { recursive: true, force: true });
    if (!o.keepFrames) rmSync(join(outDir, '.frames'), { recursive: true, force: true });
  }
  const rel = (p) => p.slice(outDir.length + 1).replace(/\\/g, '/');
  // A run of some scenes updates their entries and keeps the others' (scene order).
  const index = join(outDir, 'gifs.json');
  let prev = { clips: [], skipped: [] };
  try { prev = JSON.parse(readFileSync(index, 'utf8')); } catch { /* first run */ }
  const fresh = new Map(clips.map((c) => [c.name, { name: c.name, title: c.title, desc: c.desc, gif: rel(c.gif), mp4: rel(c.mp4), gifBytes: c.bytes, mp4Bytes: c.mp4Bytes, seconds: c.seconds && +c.seconds.toFixed(2), width: c.width, fps: c.fps, colors: c.colors, recorded: new Date().toISOString() }]));
  const done = new Set([...fresh.keys(), ...skipped.map((s) => s.name)]);
  const order = (o.scenes ?? gifScenes).map((s) => s.name);
  const all = [...(prev.clips || []).filter((c) => !done.has(c.name) && existsSync(join(outDir, c.gif))), ...fresh.values()]
    .sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  const allSkipped = [...(prev.skipped || []).filter((s) => !done.has(s.name) && !all.some((c) => c.name === s.name)), ...skipped];
  writeJson(index, { version, note: 'Demo data only, recorded from the browser preview (tools/release/screenshots/gifs.mjs).', clips: all, skipped: allSkipped });
  return { clips, skipped, all };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('screenshots/gifs.mjs')) {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(k); if (i < 0) return null; const v = a[i + 1]; a.splice(i, 2); return v; };
  const flag = (k) => { const i = a.indexOf(k); if (i < 0) return false; a.splice(i, 1); return true; };
  const version = get('--version') ?? JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const outDir = get('--out') ?? join(ROOT, 'Release', version, 'media', 'gifs');
  const num = (k) => { const v = get(k); return v == null ? undefined : +v; };
  const r = await recordGifs({
    version, outDir, lang: get('--lang') ?? 'en', width: num('--width'), fps: num('--fps'), maxMb: num('--max-mb'),
    previews: flag('--previews'), debug: flag('--debug'), keepFrames: flag('--keep-frames'), only: a.filter((x) => !x.startsWith('--')),
    log: { info: console.log, warn: console.log },
  });
  console.log(`${r.clips.length} clips → ${outDir}${r.skipped.length ? `; skipped: ${r.skipped.map((x) => `${x.name} (${x.why})`).join(', ')}` : ''}`);
  writeText(join(outDir, 'README.txt'), `BMM ${version} usage clips, demo data. Review before copying to .github/gifs/.\n\n${r.all.map((c) => `${c.gif}  ${(c.gifBytes / 1048576).toFixed(2)} MB  ${c.seconds?.toFixed(1)} s  ${c.title}: ${c.desc}`).join('\n')}\n`);
}
