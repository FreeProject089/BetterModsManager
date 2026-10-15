// Story clips: BMM used for real, end to end, with no tutorial on screen. Each story is one take
// in the browser preview (the page, fixtures and composition of gifs.mjs: the app window inset on
// a dark desktop, Tasky at its corner, a drawn pointer) that goes after a goal in a few steps:
// set up a game, share a setup, make BMM yours, automate it… The stories are in stories/*.mjs.
//
// One take gives:
//
//   <name>.gif / .mp4             the whole story (the GIF sped up when it has to, ≤ 8 MB)
//   steps/<name>-NN-<step>.gif     one short clip per step, cut from the same take (≤ 1.6 MB),
//                                  for the docs page or tutorial topic of that step
//   <name>.bmmreplay              the rrweb recording (replay.mjs), a chapter per step
//   stories.json                  what each file shows: titles and step titles (EN, FR), the
//                                  tutorial topics and docs pages it illustrates, start and end
//                                  of each step in the take, sizes (docs-media.mjs reads it)
//
// A small caption on the desktop above the window names the story and the step (« 2/5 · Import
// the mods »): the clips are watched without sound, often one step at a time.
//
//   node tools/release/screenshots/stories.mjs [--out dir] [--lang en] [--dry] [--no-replay]
//        [--keep-frames] [story …]
//
// --dry walks the stories without recording and saves a picture after each step in <out>/dry/:
// the way to check a story after the interface moved. A step whose target is missing fails the
// story loudly (the step and the selector are named), it is never skipped silently.

import { readFileSync, writeFileSync, mkdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, writeJson, writeText } from '../lib/util.mjs';
import { launch, serveStatic } from '../lib/browser.mjs';
import { GIF_CANVAS, GIF_DEFAULTS, openScenePage, startFrames, writeConcat, ffmpegPath, ff, probeDuration, EXPLAINERS } from './gifs.mjs';
import { startReplay, stopReplay, buildReplay, replayProblem, shrinkReplayImages } from './replay.mjs';
import { stories as allStories } from './stories/index.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');

/** Step clips sit in a docs page, several to a page: narrower and lighter than a usage clip. */
export const STEP_DEFAULTS = { width: 820, fps: 12, maxMb: 1.6 };
/** The whole story: at the usage clips' size, sped up when it has to fit. */
export const FULL_DEFAULTS = { width: 1000, fps: 14, maxMb: 8, speed: 1 };
/** A .bmmreplay over this is reported (the docs bundle budget is 8 MB a file). */
export const REPLAY_MAX_MB = 8;

/** GIF from a part of an MP4: palette per clip, then smaller until it fits. */
export function gifFromMp4(ffmpeg, mp4, gif, { from = null, to = null, width, fps, maxMb, speed = 1, tries = null }) {
  const cut = [...(from != null ? ['-ss', from.toFixed(3)] : []), ...(to != null ? ['-to', to.toFixed(3)] : [])];
  const list = tries ?? [[width, fps, 256], [width, fps, 160], [width, fps, 96], [Math.round(width * 0.88), Math.max(8, fps - 2), 96], [Math.round(width * 0.76), Math.max(8, fps - 4), 64]];
  const pts = speed !== 1 ? `setpts=PTS/${speed},` : '';
  let last = null;
  for (const [w, f, colors] of list) {
    ff(ffmpeg, [...cut, '-i', mp4, '-vf', `${pts}fps=${f},scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, '-loop', '0', gif]);
    last = { width: w, fps: f, colors, bytes: statSync(gif).size };
    if (last.bytes <= maxMb * 1048576) return last;
  }
  return { ...last, overLimit: true };
}

/** The caption chip on the desktop, above the window, right of Tasky. */
function captionCss() {
  return `#story-cap{position:fixed;left:132px;top:11px;z-index:2147483640;display:flex;align-items:center;gap:10px;height:28px;padding:0 14px 0 6px;border-radius:999px;background:rgba(18,19,21,.82);border:1px solid rgba(255,255,255,.12);color:#e8eaee;font:600 13px/1 Inter,"Segoe UI",system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.4);pointer-events:none;transition:opacity .3s}
#story-cap .n{display:grid;place-items:center;min-width:44px;height:20px;padding:0 7px;border-radius:999px;background:#ffcc00;color:#121315;font-weight:700;font-size:11.5px}
#story-cap .s{color:#9aa1ad;font-weight:500}
#story-cap .t{transition:opacity .25s}`;
}
async function setCaption(page, { story, n, total, step }) {
  await page.evaluate((p, css) => {
    let c = document.getElementById('story-cap');
    if (!c) {
      const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
      c = document.createElement('div'); c.id = 'story-cap';
      c.innerHTML = '<span class="n"></span><span class="s"></span><span class="t"></span>';
      document.documentElement.appendChild(c);
    }
    c.querySelector('.n').textContent = `${p.n}/${p.total}`;
    c.querySelector('.s').textContent = p.story;
    c.querySelector('.t').textContent = p.step;
  }, { story: `${story} ·`, n, total, step }, captionCss());
}

/**
 * An explainer step: an animated page of explainers/ (what the app has no screen for: the game
 * folder during an activation) filmed in a page of its own beside the app, then cut into the take
 * at its place. Its page exposes window.__play() (resolves when the animation ends) and reads
 * window.__explainer = { lang, version, appUrl }.
 */
async function playExplainer({ ctx, page, st, n, work, dry, explainerServer, appUrl, lang, version, outDir, name, record = false, last = false }) {
  const ep = await ctx.newPage();
  try {
    await ep.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    await ep.evaluateOnNewDocument((p) => { window.__explainer = p; }, { lang, version, appUrl, ...(st.explainerArgs || {}) });
    await ep.goto(explainerServer.url + st.explainer, { waitUntil: 'networkidle2', timeout: 60000 });
    if (!(await ep.evaluate(() => typeof window.__play === 'function'))) throw new Error(`${st.explainer} has no window.__play()`);
    await sleep(500);
    if (dry) {
      await ep.evaluate(() => window.__play());
      await ep.screenshot({ path: join(outDir, 'dry', `${name}-${pad(n)}-${st.id}-explainer.png`) });
      return { from: 0, to: 0, frames: [] };
    }
    const sub = `x${pad(n)}`;
    mkdirSync(join(work, sub), { recursive: true });
    // The .bmmreplay gets this part too: rrweb (the app's vendored copy) records the explainer
    // page, and its Meta + FullSnapshot switch the player to it, as a page change would.
    if (record) {
      await ep.addScriptTag({ url: `${appUrl}assets/vendor/rrweb.min.js` });
      await ep.evaluate(() => {
        window.__xev = [];
        window.__xstop = window.rrweb.record({ emit: (e) => window.__xev.push(e), inlineImages: true, sampling: { mousemove: false, scroll: 300 }, recordCanvas: false });
      });
    }
    const from = Date.now() / 1000;
    const cap = await startFrames(ep, join(work, sub), { mouse: { x: -40, y: -40 } });
    await ep.evaluate(() => window.__play());
    await sleep(st.hold ?? 900);
    const { frames } = await cap.stop();
    const events = record ? await ep.evaluate(() => { window.__xstop?.(); return window.__xev || []; }) : [];
    return { from, to: Date.now() / 1000, frames: frames.map((f) => ({ ...f, file: `${sub}/${f.file}` })), events };
  } finally {
    await ep.close().catch(() => {});
    await page.bringToFront().catch(() => {});
    // Back in the app: a fresh full snapshot, so the player returns to the app after the
    // explainer (a new block list restarts the app's recorder, see replay.mjs).
    if (record && !last) await page.evaluate(async () => { const m = await import('/js/core/replay-recorder.js'); await m.setExtraBlockSelectors([`[data-gif-replay-${Date.now()}]`]); }).catch(() => {});
  }
}

/** Validate a story's shape (also run by the tests). Returns a list of problems. */
export function storyProblems(s) {
  const p = [];
  if (!/^[a-z0-9-]+$/.test(s.name || '')) p.push(`bad name ${s.name}`);
  for (const k of ['title', 'desc']) if (!s[k]?.en || !s[k]?.fr) p.push(`${s.name}: ${k} needs en and fr`);
  if (!Array.isArray(s.steps) || !s.steps.length) p.push(`${s.name}: no steps`);
  const ids = new Set();
  for (const st of s.steps || []) {
    if (!/^[a-z0-9-]+$/.test(st.id || '')) p.push(`${s.name}: bad step id ${st.id}`);
    if (ids.has(st.id)) p.push(`${s.name}: duplicate step ${st.id}`);
    ids.add(st.id);
    if (!st.title?.en || !st.title?.fr) p.push(`${s.name}/${st.id}: title needs en and fr`);
    if (typeof st.run !== 'function' && !st.explainer) p.push(`${s.name}/${st.id}: no run`);
  }
  return p;
}

/**
 * opts: { version, outDir, lang='en', only=[], dry=false, keepFrames=false, replays=true,
 *         step: STEP_DEFAULTS, full: FULL_DEFAULTS, frontend, stories, log }
 * Returns { results, skipped }.
 */
export async function recordStories(o) {
  const { version, outDir, lang = 'en', only = [], log = console, dry = false } = o;
  const stepOpt = { ...STEP_DEFAULTS, ...(o.step || {}) }, fullOpt = { ...FULL_DEFAULTS, ...(o.full || {}) };
  const ffmpeg = dry ? null : (o.ffmpeg ?? ffmpegPath());
  if (!dry && !ffmpeg) throw new Error('ffmpeg not found (set FFMPEG, or install it to C:/ffmpeg/bin)');
  const frontend = o.frontend ?? join(ROOT, 'frontend');
  const source = o.stories ?? allStories;
  for (const s of source) { const pr = storyProblems(s); if (pr.length) throw new Error(pr.join('; ')); }
  const list = source.filter((s) => !only.length || only.includes(s.name));
  if (only.length && !list.length) throw new Error(`no story named ${only.join(', ')} (have: ${source.map((s) => s.name).join(', ')})`);
  const sfx = lang === 'en' ? '' : `.${lang}`;
  const g = GIF_CANVAS;
  mkdirSync(join(outDir, 'steps'), { recursive: true });
  const base = JSON.parse(readFileSync(join(frontend, 'assets', 'mock-fixtures.json'), 'utf8'));
  const server = await serveStatic(frontend);
  const explainerServer = await serveStatic(EXPLAINERS);
  const profileDir = join(outDir, '.chrome-profile');
  const browser = await launch({ userDataDir: profileDir, args: [`--window-size=${g.width},${g.height}`, '--hide-scrollbars', '--force-color-profile=srgb', '--no-sandbox'], defaultViewport: { width: g.width, height: g.height, deviceScaleFactor: 1 } });
  const results = [], skipped = [];
  try {
    for (const story of list) {
      if (story.skip) { skipped.push({ name: story.name, why: story.skip }); continue; }
      const work = join(outDir, '.frames', story.name);
      rmSync(work, { recursive: true, force: true });
      mkdirSync(work, { recursive: true });
      if (dry) mkdirSync(join(outDir, 'dry'), { recursive: true });
      let ctx = null, page = null;
      try {
        const opened = await openScenePage(browser, server, story, { lang, version, base, frontend, explainerServer });
        ctx = opened.ctx; page = opened.page;
        const h = opened.h;
        h.strict = true;
        const segments = [];
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        const wantReplay = !dry && o.replays !== false && story.replay !== false;
        if (wantReplay) await startReplay(page);
        const cap = dry ? null : await startFrames(page, work, h);
        const tStart = Date.now();
        const steps = [];
        const total = story.steps.length;
        const storyTitle = story.title[lang] ?? story.title.en;
        await setCaption(page, { story: storyTitle, n: 1, total, step: story.steps[0].title[lang] ?? story.steps[0].title.en });
        await sleep(story.leadIn ?? 800);
        for (let i = 0; i < total; i++) {
          const st = story.steps[i];
          const t0 = Date.now();
          h.mark(`${pad(i + 1)} · ${st.title.en}`);
          await setCaption(page, { story: storyTitle, n: i + 1, total, step: st.title[lang] ?? st.title.en });
          await sleep(st.leadIn ?? 350);
          try {
            if (st.explainer) segments.push(await playExplainer({ ctx, page, st, n: i + 1, work, dry, explainerServer, appUrl: server.url, lang, version, outDir, name: story.name, record: wantReplay, last: i === total - 1 }));
            else await st.run(h);
          } catch (e) { throw new Error(`step ${i + 1} « ${st.id} »: ${e.message.split('\n')[0]}`); }
          await sleep(st.tail ?? 600);
          const t1 = Date.now();
          if (dry) await page.screenshot({ path: join(outDir, 'dry', `${story.name}-${pad(i + 1)}-${st.id}.png`) });
          steps.push({ n: i + 1, id: st.id, title: st.title, topics: st.topics || [], docs: st.docs || [], from: (t0 - tStart) / 1000, to: (t1 - tStart) / 1000 });
        }
        await sleep(story.tail ?? 1200);
        const endTs = Date.now() / 1000;
        if (errors.length) log.warn?.(`  ${story.name}: page errors: ${[...new Set(errors)].slice(0, 3).join(' | ')}`);
        let events = wantReplay ? await stopReplay(page) : null;
        // The explainers' own recordings, spliced in at their time (each starts with its Meta).
        if (events) for (const sg of segments) if (sg.events?.length) events = [...events, ...sg.events].sort((a, b) => a.timestamp - b.timestamp);
        if (dry) { results.push({ name: story.name, steps }); log.info?.(`  ${story.name}: ${steps.length} steps walked (dry) in ${((Date.now() - tStart) / 1000).toFixed(0)} s`); continue; }
        let { frames } = await cap.stop();
        // An explainer step was filmed on its own page: its frames replace the app's for that time.
        for (const sg of segments) frames = [...frames.filter((f) => f.ts < sg.from || f.ts > sg.to), ...sg.frames];
        frames.sort((a, b) => a.ts - b.ts);
        if (frames.length < 2) throw new Error('no frames recorded');
        const listFile = writeConcat(work, frames, endTs, 0.8);
        const mp4 = join(outDir, `${story.name}${sfx}.mp4`);
        // The MP4 starts at the first frame: shift the step times by the gap to tStart.
        const offset = frames[0].ts - tStart / 1000;
        ff(ffmpeg, ['-f', 'concat', '-safe', '0', '-i', listFile, '-vf', `fps=${GIF_DEFAULTS.mp4Fps},scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,format=yuv420p`,
          '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', '-an', mp4]);
        const seconds = probeDuration(ffmpeg, mp4);
        const gif = join(outDir, `${story.name}${sfx}.gif`);
        let speed = story.speed ?? fullOpt.speed;
        // The full width first (the usage clips' look): faster before narrower, narrower last.
        const w = fullOpt.width;
        const wide = [[w, fullOpt.fps, 256], [w, 12, 192], [w, 12, 128]];
        let enc = gifFromMp4(ffmpeg, mp4, gif, { ...fullOpt, speed, tries: wide });
        while (enc.overLimit && speed < 1.9) { speed = +(speed * 1.2).toFixed(2); enc = gifFromMp4(ffmpeg, mp4, gif, { ...fullOpt, speed, tries: wide }); }
        if (enc.overLimit) enc = gifFromMp4(ffmpeg, mp4, gif, { ...fullOpt, speed, tries: [[Math.round(w * 0.9), 12, 128], [Math.round(w * 0.8), 10, 128], [Math.round(w * 0.7), 10, 96]] });
        const stepFiles = [];
        for (const s of steps) {
          const rel = `steps/${story.name}-${pad(s.n)}-${s.id}${sfx}.gif`;
          const from = Math.max(0, s.from - offset), to = Math.min(seconds ?? 1e9, s.to - offset + 0.2);
          const sp = story.steps[s.n - 1].speed ?? story.stepSpeed ?? 1;
          const se = gifFromMp4(ffmpeg, mp4, join(outDir, rel), { from, to, width: stepOpt.width, fps: stepOpt.fps, maxMb: stepOpt.maxMb, speed: sp });
          if (se.overLimit) log.warn?.(`  ${rel}: ${(se.bytes / 1048576).toFixed(2)} MB, over the step limit`);
          stepFiles.push({ ...s, from: +from.toFixed(2), to: +to.toFixed(2), gif: rel, gifBytes: se.bytes, seconds: +((to - from) / sp).toFixed(2), width: se.width, overLimit: !!se.overLimit });
        }
        let replay = null, replayBytes = 0;
        if (events) {
          const problem = replayProblem(events);
          if (problem) log.warn?.(`  ${story.name}: no .bmmreplay (${problem})`);
          else {
            replay = `${story.name}${sfx}.bmmreplay`;
            writeFileSync(join(outDir, replay), await shrinkReplayImages(page, buildReplay(events, { title: storyTitle, markers: h.marks, origin: server.url })));
            replayBytes = statSync(join(outDir, replay)).size;
            if (replayBytes > REPLAY_MAX_MB * 1048576) log.warn?.(`  ${replay}: ${(replayBytes / 1048576).toFixed(1)} MB, over ${REPLAY_MAX_MB} MB`);
          }
        }
        const res = {
          name: story.name, lang, title: story.title, desc: story.desc, topics: story.topics || [], docs: story.docs || [],
          gif: `${story.name}${sfx}.gif`, gifBytes: enc.bytes, gifWidth: enc.width, gifFps: enc.fps, gifSpeed: speed, overLimit: !!enc.overLimit,
          mp4: `${story.name}${sfx}.mp4`, mp4Bytes: statSync(mp4).size, seconds: seconds && +seconds.toFixed(2), replay, replayBytes,
          steps: stepFiles, recorded: new Date().toISOString(),
        };
        results.push(res);
        const stepTotal = stepFiles.reduce((a, s) => a + s.gifBytes, 0);
        log.info?.(`  ${story.name}: ${seconds?.toFixed(0)} s, GIF ${(enc.bytes / 1048576).toFixed(2)} MB (×${speed}, ${enc.width}px)${enc.overLimit ? ' OVER THE LIMIT' : ''}, ${stepFiles.length} step GIFs ${(stepTotal / 1048576).toFixed(2)} MB, replay ${(replayBytes / 1048576).toFixed(2)} MB`);
      } catch (e) {
        skipped.push({ name: story.name, why: e.message });
        log.warn?.(`  ${story.name}: FAILED ${e.message}`);
        if (page) await page.screenshot({ path: join(outDir, `failed-${story.name}.png`) }).catch(() => {});
      } finally {
        if (ctx) await ctx.close().catch(() => {});
        if (!o.keepFrames) rmSync(work, { recursive: true, force: true });
      }
    }
  } finally {
    await browser.close();
    await server.close();
    await explainerServer.close();
    rmSync(profileDir, { recursive: true, force: true });
    if (!o.keepFrames) rmSync(join(outDir, '.frames'), { recursive: true, force: true });
  }
  if (!dry) {
    // A run of some stories updates their entries and keeps the others' (story order).
    const index = join(outDir, `stories${sfx}.json`);
    let prev = { stories: [] };
    try { prev = JSON.parse(readFileSync(index, 'utf8')); } catch { /* first run */ }
    const fresh = new Map(results.map((r) => [r.name, r]));
    const order = source.map((s) => s.name);
    const all = [...(prev.stories || []).filter((t) => !fresh.has(t.name) && order.includes(t.name) && existsSync(join(outDir, t.gif))), ...fresh.values()]
      .sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
    writeJson(index, { version, note: 'Demo data only, recorded from the browser preview (tools/release/screenshots/stories.mjs).', stories: all, skipped });
    const mb = (b) => (b / 1048576).toFixed(2);
    writeText(join(outDir, 'README.txt'), `BMM ${version} story clips, demo data (tools/release/screenshots/stories.mjs).\n\n${all.map((r) => `${r.gif}  ${mb(r.gifBytes)} MB  ${r.seconds} s  ${r.title.en}: ${r.desc.en}\n${r.replay ? `${r.replay}  ${mb(r.replayBytes)} MB\n` : ''}${r.steps.map((s) => `  ${s.gif}  ${mb(s.gifBytes)} MB  ${s.seconds} s  ${s.title.en}`).join('\n')}`).join('\n\n')}\n`);
  }
  return { results, skipped };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('screenshots/stories.mjs')) {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(k); if (i < 0) return null; const v = a[i + 1]; a.splice(i, 2); return v; };
  const flag = (k) => { const i = a.indexOf(k); if (i < 0) return false; a.splice(i, 1); return true; };
  const version = get('--version') ?? JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const outDir = get('--out') ?? join(ROOT, 'Release', version, 'media', 'stories');
  const r = await recordStories({ version, outDir, lang: get('--lang') ?? 'en', dry: flag('--dry'), replays: !flag('--no-replay'), keepFrames: flag('--keep-frames'), only: a.filter((x) => !x.startsWith('--')), log: { info: console.log, warn: console.log } });
  console.log(`${r.results.length} stories → ${outDir}${r.skipped.length ? `; failed/skipped: ${r.skipped.map((x) => `${x.name} (${x.why})`).join(', ')}` : ''}`);
  if (r.skipped.length) process.exitCode = 1;
}
