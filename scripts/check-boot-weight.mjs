// Nothing heavy may be loaded before the window can paint.
//
// index.html's <script src> tags are blocking: the webview fetches, parses and RUNS every one
// of them before first paint, wherever in the file they sit. mermaid.min.js was one of them —
// 3.3 MB, 92% of all the JavaScript BMM shipped at boot, needed only by the diagram viewer
// and the docs hub. Nothing failed; the app simply started slower than it needed to, on every
// launch, for years.
//
// That is invisible by inspection: a <script> tag buried on line 6620 of a 7700-line file
// looks exactly like the ones that belong there. So the size is the check.

import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'frontend/index.html'), 'utf8');

// Above this, a library has to earn its place at boot or be loaded on demand
// (see frontend/src/ui/lazy-vendor.ts).
const MAX_ONE = 256 * 1024;
// The app's own entry module pulls in the rest of the code through ES imports; this budget is
// about vendored blobs, which is what actually grew unnoticed.
const MAX_TOTAL = 512 * 1024;

const tags = [...html.matchAll(/<script\b([^>]*)\bsrc="([^"]+)"([^>]*)>/g)];
const eager = [];
for (const [, before, src, after] of tags) {
  const attrs = before + after;
  // Modules and deferred scripts do not block the parser; remote URLs are not ours to weigh.
  if (/\btype="module"|\bdefer\b|\basync\b/.test(attrs)) continue;
  if (/^https?:/.test(src)) continue;
  try {
    eager.push([src, statSync(join(ROOT, 'frontend', src)).size]);
  } catch {
    // A missing file is check-links.mjs's problem, not this one.
  }
}

const total = eager.reduce((n, [, s]) => n + s, 0);
const kb = (n) => `${Math.round(n / 1024)} KB`;
const heavy = eager.filter(([, s]) => s > MAX_ONE);

// Loading the same file twice parses it twice. cropper was in <head> and again mid-body.
const seen = new Map();
for (const [src] of eager) seen.set(src, (seen.get(src) ?? 0) + 1);
const dupes = [...seen].filter(([, n]) => n > 1).map(([src]) => src);

let bad = false;
if (dupes.length) {
  bad = true;
  console.error(`✗ ${dupes.length} script(s) loaded more than once at boot:`);
  for (const d of dupes) console.error(`  ${d}`);
}
if (heavy.length) {
  bad = true;
  console.error(`✗ ${heavy.length} blocking script(s) over ${kb(MAX_ONE)}:`);
  for (const [src, size] of heavy.sort((a, b) => b[1] - a[1])) console.error(`  ${kb(size).padStart(8)}  ${src}`);
  console.error('\n  These are parsed before the window paints, on every launch.');
  console.error('  Load them on demand instead — see frontend/src/ui/lazy-vendor.ts.');
}
if (total > MAX_TOTAL) {
  bad = true;
  console.error(`✗ ${kb(total)} of blocking script at boot (budget ${kb(MAX_TOTAL)}):`);
  for (const [src, size] of eager.sort((a, b) => b[1] - a[1])) console.error(`  ${kb(size).padStart(8)}  ${src}`);
}
if (bad) process.exit(1);

console.log(`✓ boot scripts within budget (${eager.length} files, ${kb(total)} of ${kb(MAX_TOTAL)})`);
