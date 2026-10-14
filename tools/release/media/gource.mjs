// Gource visualisation of the project history: BMM and its sibling repositories in one tree.
//
//   1. `gource --output-custom-log` per repository (BMM, BMM Docs, BetterInstaller, BCW, and
//      ../BetterCommunity-v2 when it is there). Each line is « unix time|author name|A/M/D|path »:
//      names only, gource's custom log has no e-mail field, and nothing is sent anywhere.
//   2. Paths are prefixed with the repository name, the logs merged and sorted by time.
//   3. Captions at each version bump of package.json (« BMM 1.0.0 », …).
//   4. Gource renders a PPM stream at a fixed size, speed, frame rate and hash seed; ffmpeg encodes
//      it to H.264 (yuv420p, +faststart). From that MP4: a short palette-optimised GIF, a poster
//      PNG, and the credits page background (frontend/assets/videos/credits_bg.mp4: muted,
//      faded in and out so its loop has no jump).
//
// Avatars: only local images, matched by author name (frontend/assets/userpfp/<name>.png, and
// the pictures contributors.json names). Unmatched authors get gource's default.
//
//   node tools/release/media/gource.mjs --version 1.0.3 [--seconds 75] [--no-credits]

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync, readdirSync, copyFileSync } from 'node:fs';
import { join, resolve, extname, basename } from 'node:path';
import { ROOT, TOOL_DIR, releaseDir, readJson, fmtBytes } from '../lib/util.mjs';
import { run, capture } from '../lib/exec.mjs';
import { git, logRange } from '../lib/git.mjs';

export const GOURCE_CANDIDATES = [process.env.GOURCE, 'C:/Program Files/Gource/gource.exe', 'C:/Program Files (x86)/Gource/gource.exe'];
export const findGource = () => GOURCE_CANDIDATES.find((p) => p && existsSync(p)) ?? null;
export const CREDITS_VIDEO = join(ROOT, 'frontend', 'assets', 'videos', 'credits_bg.mp4');

/** The repositories that exist on this machine: [{ name, path }]. */
export function gourceRepos() {
  const list = [
    { name: 'BMM', path: ROOT },
    { name: 'BMM Docs', path: join(ROOT, 'BMM Docs') },
    { name: 'BetterInstaller', path: join(ROOT, 'BetterInstaller') },
    { name: 'BCW', path: join(ROOT, 'BCW') },
    { name: 'BetterCommunity-v2', path: resolve(ROOT, '..', 'BetterCommunity-v2') },
  ];
  return list.filter((r) => existsSync(join(r.path, '.git')) && git(['rev-parse', 'HEAD'], r.path));
}

/** Prefix every path of a gource custom log with /<repo>/ (pure). Drops malformed lines. */
export function prefixLog(text, repo) {
  const tag = repo.replace(/[|/\\]/g, '-');
  return String(text).split(/\r?\n/).filter(Boolean).map((l) => l.split('|')).filter((p) => p.length >= 4 && /^\d+$/.test(p[0]))
    .map(([t, user, type, ...rest]) => {
      const path = rest.join('|').replace(/^\/+/, '');
      return `${t}|${user.trim()}|${type}|/${tag}/${path}`;
    });
}

/** Merge several prefixed logs, sorted by time (stable within a second). Pure. */
export function mergeLogs(lists) {
  return lists.flat().map((l, i) => ({ l, i, t: +l.split('|', 1)[0] })).sort((a, b) => a.t - b.t || a.i - b.i).map((x) => x.l);
}

/** Seconds per day so that `span` days play in about `target` seconds (auto-skip shortens idle gaps). */
export function secondsPerDay(firstT, lastT, target) {
  const days = Math.max(1, (lastT - firstT) / 86400);
  return Math.max(0.01, +(target / days).toFixed(3));
}

/** Captions « BMM x.y.z » at each package.json version change of BMM (gource caption file). */
export function versionCaptions(cwd = ROOT) {
  const out = git(['log', '--reverse', '--format=%H %at', '-G', '"version": "', '--', 'package.json'], cwd) || '';
  const seen = new Set();
  const lines = [];
  for (const row of out.split(/\r?\n/).filter(Boolean)) {
    const [h, t] = row.split(' ');
    let v = null;
    try { v = JSON.parse(git(['show', `${h}:package.json`], cwd) || '{}').version; } catch { /* unreadable */ }
    if (v && !seen.has(v)) { seen.add(v); lines.push(`${t}|BMM ${v}`); }
  }
  return lines;
}

/** Avatar folder: <author>.png for every local picture we can match by name. */
export async function buildAvatars(dir, authors, ffmpeg, log) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const wanted = new Map([...authors].map((a) => [a.toLowerCase(), a]));
  const cands = [];
  const upfp = join(ROOT, 'frontend', 'assets', 'userpfp');
  if (existsSync(upfp)) for (const f of readdirSync(upfp)) cands.push({ name: basename(f, extname(f)), file: join(upfp, f) });
  try {
    const c = readJson(join(ROOT, 'frontend', 'assets', 'contributors.json'));
    for (const p of c.contributors ?? []) if (p.username && p.pfp) cands.push({ name: p.username, file: join(ROOT, 'frontend', p.pfp) });
  } catch { /* optional */ }
  const used = [];
  for (const cnd of cands) {
    const author = wanted.get(cnd.name.toLowerCase());
    if (!author || !existsSync(cnd.file) || used.includes(author)) continue;
    const dest = join(dir, `${author}.png`);
    if (/\.png$/i.test(cnd.file)) copyFileSync(cnd.file, dest);
    else if (ffmpeg) { const r = await run(ffmpeg, ['-y', '-v', 'error', '-i', cnd.file, '-vf', 'scale=256:-1', dest], { quiet: true, log }); if (r.code) continue; }
    else continue;
    used.push(author);
  }
  return used;
}

function pipe(gourceExe, gArgs, ffmpeg, fArgs, log) {
  return new Promise((ok) => {
    log?.line(`$ "${gourceExe}" ${gArgs.join(' ')} | ffmpeg ${fArgs.join(' ')}`);
    const g = spawn(gourceExe, gArgs, { windowsHide: false });
    const f = spawn(ffmpeg, fArgs, { windowsHide: true });
    g.stdout.pipe(f.stdin);
    let err = '';
    g.stderr.on('data', (d) => { err += d; });
    f.stderr.on('data', (d) => { err += d; });
    let gc = null;
    g.on('close', (c) => { gc = c; });
    g.on('error', (e) => { err += e.message; });
    f.on('close', (fc) => { log?.write(err); ok({ gource: gc, ffmpeg: fc, err }); });
  });
}

const probe = (ffmpeg, file) => {
  const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace('ffmpeg', 'ffprobe'));
  const out = capture(ffprobe, ['-v', 'error', '-show_entries', 'stream=width,height,r_frame_rate,codec_name:format=duration,size', '-of', 'json', file]);
  try { const j = JSON.parse(out); const s = j.streams.find((x) => x.width) ?? {}; return { width: s.width, height: s.height, codec: s.codec_name, fps: s.r_frame_rate, duration: +j.format.duration, size: +j.format.size }; } catch { return null; }
};

/**
 * Render everything. opts: { version, outDir, seconds=75, width=1920, height=1080, fps=30,
 * credits=true, ffmpeg, log }. Returns { mp4, gif, poster, credits, repos, authors, avatars, info }.
 */
export async function renderGource(o) {
  const { version, outDir = join(releaseDir(version), 'media'), seconds = 75, width = 1920, height = 1080, fps = 30, credits = true, ffmpeg, log } = o;
  const gourceExe = findGource();
  if (!gourceExe) throw new Error('Gource not found (set GOURCE or install it)');
  if (!ffmpeg) throw new Error('ffmpeg not found (set FFMPEG)');
  const work = join(TOOL_DIR, '.cache', 'gource');
  rmSync(work, { recursive: true, force: true }); mkdirSync(work, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const repos = gourceRepos();
  const lists = [];
  for (const r of repos) {
    const f = join(work, `${r.name.replace(/\W+/g, '_')}.log`);
    const res = await run(gourceExe, ['--output-custom-log', f, r.path], { quiet: true, log });
    if (res.code !== 0 || !existsSync(f)) { log?.warn(`gource log failed for ${r.name}`); continue; }
    lists.push(prefixLog(readFileSync(f, 'utf8'), r.name));
  }
  const merged = mergeLogs(lists);
  if (!merged.length) throw new Error('no history to render');
  const logFile = join(work, 'combined.log');
  writeFileSync(logFile, merged.join('\n') + '\n');
  const authors = new Set(merged.map((l) => l.split('|')[1]));
  const first = +merged[0].split('|')[0], last = +merged.at(-1).split('|')[0];
  const spd = secondsPerDay(first, last, seconds);
  const captions = join(work, 'captions.txt');
  writeFileSync(captions, versionCaptions().filter((l) => +l.split('|')[0] >= first).join('\n') + '\n');
  const avatars = await buildAvatars(join(work, 'avatars'), authors, ffmpeg, log);

  const logoSrc = [join(ROOT, 'frontend', 'assets', 'BMm.png'), join(ROOT, '.Assets', 'AssetsoTH', 'BMMLogo.png')].find(existsSync);
  const logo = join(work, 'logo.png');
  if (logoSrc) await run(ffmpeg, ['-y', '-v', 'error', '-i', logoSrc, '-vf', 'scale=96:-1', logo], { quiet: true, log });
  const font = ['C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/segoeui.ttf'].find(existsSync);

  const gArgs = [`-${width}x${height}`, '--output-framerate', String(fps), '--seconds-per-day', String(spd), '--auto-skip-seconds', '0.4',
    '--max-file-lag', '0.2', '--hash-seed', '42', '--stop-at-end', '--disable-input', '--hide', 'filenames,mouse,progress',
    '--dir-name-depth', '1', '--dir-font-size', '15', '--user-font-size', '13', '--font-size', '24', '--font-colour', 'E8EDF7',
    '--background-colour', '0B0F19', '--bloom-multiplier', '0.6', '--bloom-intensity', '0.5', '--elasticity', '0.03',
    '--file-idle-time', '0', '--user-scale', '1.2', '--max-user-speed', '400', '--highlight-users', '--highlight-colour', 'FFCC00',
    '--date-format', '%d %B %Y', '--title', `Better Mods Manager ${version}  ·  BMM, BMM Docs, BetterInstaller, BCW${repos.some((r) => r.name === 'BetterCommunity-v2') ? ', BetterCommunity v2' : ''}`,
    '--caption-file', captions, '--caption-size', '28', '--caption-colour', 'FFCC00', '--caption-duration', '4',
    '--multi-sampling', '--no-vsync', '--output-ppm-stream', '-', '--log-format', 'custom'];
  if (existsSync(logo)) gArgs.push('--logo', logo);
  if (font) gArgs.push('--font-file', font);
  if (avatars.length) gArgs.push('--user-image-dir', join(work, 'avatars'));
  gArgs.push(logFile);

  const mp4 = join(outDir, `gource-${version}.mp4`);
  const enc = ['-y', '-v', 'error', '-r', String(fps), '-f', 'image2pipe', '-vcodec', 'ppm', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4];
  log?.info(`  gource: ${repos.length} repositories, ${merged.length} file events, ${authors.size} authors, ${avatars.length} avatar(s), ${spd} s/day`);
  const p = await pipe(gourceExe, gArgs, ffmpeg, enc, log);
  if (p.ffmpeg !== 0 || !existsSync(mp4)) throw new Error(`render failed (gource ${p.gource}, ffmpeg ${p.ffmpeg}): ${p.err.slice(-400)}`);
  const info = probe(ffmpeg, mp4);

  // Poster: a frame near the end (the whole tree is there).
  const poster = join(outDir, `gource-${version}-poster.png`);
  await run(ffmpeg, ['-y', '-v', 'error', '-sseof', '-1.5', '-i', mp4, '-frames:v', '1', '-update', '1', poster], { quiet: true, log });
  // GIF: 3× faster, 640 px wide, 12 fps, 128-colour palette.
  const gif = join(outDir, `gource-${version}.gif`);
  await run(ffmpeg, ['-y', '-v', 'error', '-i', mp4, '-vf', 'setpts=PTS/3,fps=12,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', '-loop', '0', gif], { quiet: true, log });

  let creditsInfo = null;
  if (credits) creditsInfo = await creditsVideo(ffmpeg, mp4, info, log);
  return { mp4, gif: existsSync(gif) ? gif : null, poster: existsSync(poster) ? poster : null, credits: creditsInfo, repos: repos.map((r) => r.name), events: merged.length, authors: authors.size, avatars, info, secondsPerDay: spd };
}

/** Re-encode the render for the credits page: same path, muted, fade in/out, small. */
export async function creditsVideo(ffmpeg, mp4, info, log) {
  const before = existsSync(CREDITS_VIDEO) ? probe(ffmpeg, CREDITS_VIDEO) : null;
  const tmp = join(TOOL_DIR, '.cache', 'gource', 'credits_bg.mp4');
  const d = info?.duration ?? 75;
  const vf = `scale=1920:1080:flags=lanczos,fade=t=in:st=0:d=1.2,fade=t=out:st=${Math.max(0, d - 1.2).toFixed(2)}:d=1.2`;
  let r = await run(ffmpeg, ['-y', '-v', 'error', '-i', mp4, '-vf', vf, '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', tmp], { quiet: true, log });
  if (r.code !== 0) return { error: 'encode failed' };
  // Never heavier than the file it replaces: fall back to 720p if 1080p came out bigger.
  if (before?.size && statSync(tmp).size > before.size) {
    r = await run(ffmpeg, ['-y', '-v', 'error', '-i', mp4, '-vf', vf.replace('1920:1080', '1280:720'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', tmp], { quiet: true, log });
  }
  copyFileSync(tmp, CREDITS_VIDEO);
  const after = probe(ffmpeg, CREDITS_VIDEO);
  return { path: CREDITS_VIDEO, before, after, text: `credits_bg.mp4: ${before ? `${before.width}×${before.height}, ${before.duration?.toFixed(1)} s, ${fmtBytes(before.size)}` : 'none'} → ${after.width}×${after.height}, ${after.duration?.toFixed(1)} s, ${fmtBytes(after.size)}` };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('media/gource.mjs')) {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const { findFfmpeg } = await import('../bench/run.mjs');
  const version = get('--version') ?? JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const r = await renderGource({ version, seconds: +(get('--seconds') ?? 75), credits: !a.includes('--no-credits'), ffmpeg: findFfmpeg(), log: { info: console.log, warn: console.log, line() {}, write() {} } });
  console.log(r);
}
