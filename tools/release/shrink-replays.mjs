// Brings .bmmreplay files under the docs bundle budget (8 MB a file) without touching what they
// show: the recorder inlines every picture of the page as a data URL at its full size, which is
// most of a long take. Each big picture is redrawn at a size no screen shows it larger than
// (WebP, replay.mjs shrinkReplayImages), pointer-move and touch-move noise is dropped, and the
// size is checked. A file that cannot get under the limit is listed, never silently kept.
//
//   node tools/release/shrink-replays.mjs <file|dir> [...] [--max 8] [--dry] [--no-gzip]
//
// In place. Run it on a copy first if the original matters (BMM Docs is a git repository: the
// diff is the backup).

import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { join, extname } from 'node:path';
import { launch } from './lib/browser.mjs';
import { shrinkReplayImages } from './screenshots/replay.mjs';

const a = process.argv.slice(2);
const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
const maxMb = Number(get('--max') ?? 8);
const dry = a.includes('--dry');
const targets = a.filter((x, i) => !x.startsWith('--') && a[i - 1] !== '--max');
const files = [];
for (const t of targets) {
  if (statSync(t).isDirectory()) for (const f of readdirSync(t)) { if (extname(f) === '.bmmreplay') files.push(join(t, f)); }
  else files.push(t);
}
if (!files.length) { console.log('usage: node tools/release/shrink-replays.mjs <file|dir> [--max 8] [--dry]'); process.exit(1); }

const browser = await launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><title>shrink</title>');
const over = [];
try {
  for (const f of files) {
    const before = statSync(f).size;
    if (before <= maxMb * 1048576) { console.log(`ok     ${(before / 1e6).toFixed(1).padStart(6)} MB  ${f}`); continue; }
    const raw = readFileSync(f);
    let text = (raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw).toString('utf8');
    let b = JSON.parse(text);
    b.events = b.events.filter((e) => !(e.type === 3 && (e.data?.source === 1 || e.data?.source === 6)));
    text = JSON.stringify(b);
    b = null;
    for (const [edge, q, minBytes] of [[420, 0.8, 30000], [320, 0.7, 12000], [240, 0.6, 6000]]) {
      text = await shrinkReplayImages(page, text, { maxEdge: edge, quality: q, minBytes });
      if (Buffer.byteLength(text) <= maxMb * 1048576) break;
    }
    let out = Buffer.from(text, 'utf8');
    // Still over: gzip, under the same name. The docs player (bmm-replay.js) reads either form.
    if (out.length > maxMb * 1048576 && !a.includes('--no-gzip')) out = gzipSync(out, { level: 9 });
    const after = out.length;
    if (!dry) writeFileSync(f, out);
    console.log(`${after <= maxMb * 1048576 ? 'shrunk' : 'STILL OVER'} ${(before / 1e6).toFixed(1)} -> ${(after / 1e6).toFixed(1)} MB  ${f}`);
    if (after > maxMb * 1048576) over.push(f);
  }
} finally { await browser.close(); }
if (over.length) { console.log(`\n${over.length} file(s) over ${maxMb} MB:\n  ${over.join('\n  ')}`); process.exitCode = 2; }
