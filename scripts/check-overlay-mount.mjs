// A `.modal-overlay` must be mounted inside the app FRAME, never on <body>.
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
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..', 'frontend', 'src');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []));

const bad = [];
let scanned = 0;
let overlays = 0;

for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes('modal-overlay')) continue;
  scanned++;
  // Every variable that is given the modal-overlay class, however the string is built.
  const names = new Set();
  for (const m of src.matchAll(/(?:const\s+|let\s+)?([A-Za-z_$][\w$]*)\s*\.className\s*=\s*[`'"][^`'"]*modal-overlay/g)) names.add(m[1]);
  for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\.classList\.add\(\s*['"]modal-overlay['"]/g)) names.add(m[1]);
  overlays += names.size;
  for (const name of names) {
    const re = new RegExp(`document\\.body\\.appendChild\\(\\s*${name.replace(/\$/g, '\\$')}\\s*\\)`);
    const at = src.search(re);
    if (at >= 0) {
      bad.push({ file: path.relative(path.join(import.meta.dirname, '..'), file), name, line: src.slice(0, at).split('\n').length });
    }
  }
}

if (bad.length) {
  console.error('A .modal-overlay is mounted on <body> instead of the app frame:\n');
  for (const b of bad) console.error(`  ${b.file}:${b.line}  →  document.body.appendChild(${b.name})`);
  console.error(`
The window is transparent and the app is inset 40px from its top/left, so an overlay on
<body> spreads its dim and the dialog's shadow across that invisible margin.

Mount it in the frame, the way every other overlay here does:

  (document.getElementById('app-window-outer') || document.body).appendChild(${bad[0].name});
`);
  process.exit(1);
}

console.log(`✓ every runtime .modal-overlay mounts in the app frame (${overlays} in ${scanned} module(s))`);
