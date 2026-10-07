// An overlay must be mounted inside the app FRAME, never on <body>.
//
// The Tauri window is transparent and the app is a rounded rectangle inset 40px from the
// window's top/left (mascot.css) — the gap Tasky leans out of. mascot.css pins any overlay
// INSIDE #app-window-outer to that rectangle and the frame's `contain: paint` clips it at the
// rounded edge. An overlay appended to <body> escapes all of that: it keeps
// `position: fixed; inset: 0`, so its dim and the dialog's drop-shadow paint across the
// invisible margin and the dialog centres on the WINDOW instead of on the app.
//
// It cost four rounds of "the shadow is still wrong" to find, because the symptom looks like a
// shadow bug and the cause is one appendChild. This makes the next one a failed check instead.
//
// What counts as an overlay: the house `.modal-overlay`, and any class token that NAMES one —
// `*-overlay`, `*-backdrop`, `*-lightbox`. The first version looked for `modal-overlay` only,
// and the four Community overlays (the image lightbox, the post history, the comments, a
// comment's history) all went to <body> under their own names without it noticing.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.join(import.meta.dirname, '..', 'frontend', 'src');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []));

/** A class list that names an overlay. */
export const OVERLAY_TOKEN = /(?:^|\s)(?:modal-overlay|[a-z][\w-]*-(?:overlay|backdrop|lightbox))(?=\s|$)/;

/**
 * Overlays that must sit on <body>, and why. Keyed `module:variable`. The list only shrinks:
 * an entry that no longer matches fails.
 */
export const BODY_MOUNTED = {
  'features/mods/lib-order.ts:backdrop': 'click-catcher for the order menu: the menu is fixed-positioned and the frame (contain: paint) would clip it near the bottom edge',
};

/** Variables in `src` given an overlay class and appended to document.body. Pure. */
export function bodyMounted(src) {
  const names = new Set();
  for (const m of src.matchAll(/(?:const\s+|let\s+)?([A-Za-z_$][\w$]*)\s*\.className\s*=\s*([`'"])([^`'"]*)\2/g)) {
    if (OVERLAY_TOKEN.test(m[3])) names.add(m[1]);
  }
  for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\.classList\.add\(\s*['"]([^'"]+)['"]/g)) {
    if (OVERLAY_TOKEN.test(m[2])) names.add(m[1]);
  }
  const out = [];
  for (const name of names) {
    const re = new RegExp(`document\\.body\\.(?:appendChild|append|prepend|insertBefore)\\(\\s*${name.replace(/\$/g, '\\$')}\\s*[,)]`, 'g');
    for (const m of src.matchAll(re)) out.push({ name, at: m.index });
  }
  return { names, out };
}

function main() {
  const bad = [];
  const seen = new Set();
  let scanned = 0;
  let overlays = 0;

  for (const file of walk(ROOT)) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const { names, out } = bodyMounted(src);
    if (!names.size) continue;
    scanned++;
    overlays += names.size;
    for (const b of out) {
      const key = `${rel}:${b.name}`;
      if (BODY_MOUNTED[key]) { seen.add(key); continue; }
      bad.push({ file: `frontend/src/${rel}`, name: b.name, line: src.slice(0, b.at).split('\n').length });
    }
  }
  const stale = Object.keys(BODY_MOUNTED).filter((k) => !seen.has(k));

  if (bad.length || stale.length) {
    if (bad.length) {
      console.error('An overlay is mounted on <body> instead of the app frame:\n');
      for (const b of bad) console.error(`  ${b.file}:${b.line}  →  document.body.appendChild(${b.name})`);
      console.error(`
  The window is transparent and the app is inset 40px from its top/left, so an overlay on
  <body> spreads its dim and the dialog's shadow across that invisible margin.

  Mount it in the frame, the way every other overlay here does:

    (document.getElementById('app-window-outer') || document.body).appendChild(${bad[0].name});
  `);
    }
    for (const k of stale) console.error(`  BODY_MOUNTED lists ${k}, which no longer mounts on <body> — remove the entry`);
    process.exit(1);
  }

  console.log(`✓ every runtime overlay mounts in the app frame (${overlays} in ${scanned} module(s); ${Object.keys(BODY_MOUNTED).length} on <body> by design)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
