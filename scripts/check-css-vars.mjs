// check-css-vars.mjs — every CSS variable used must be defined somewhere.
//
// `var(--nothing)` with no fallback resolves to nothing. A background silently does not
// paint, a colour silently inherits, and the page looks *almost* right — which is worse
// than looking broken, because nobody investigates it.
//
// Nothing else here catches it. check-hardcoded-colors is happy, because an invented token
// IS a var() call and that is exactly what it wants to see. check-css-targets looks at id
// selectors. tsc does not read CSS. It took rendering the page and reading a computed style
// to find three invented names — hence this.
//
// Variables with a fallback (`var(--x, #fff)`) are allowed to be undefined: the fallback is
// the author saying "this may not exist", which is a decision rather than a mistake.

import fs from 'node:fs';
import path from 'node:path';

const CSS_DIR = 'frontend/css';
const files = fs.readdirSync(CSS_DIR).filter((f) => f.endsWith('.css')).map((f) => path.join(CSS_DIR, f));
if (!files.length) { console.error('✗ no stylesheets found — refusing to report success'); process.exit(2); }

const all = files.map((f) => ({ f, css: fs.readFileSync(f, 'utf8') }));
const blob = all.map((x) => x.css).join('\n');

// Definitions: `--name:` at the start of a declaration.
const defined = new Set([...blob.matchAll(/(^|[;{\s])(--[\w-]+)\s*:/g)].map((m) => m[2]));

// Uses WITHOUT a fallback. `var(--x, y)` is deliberate and skipped.
const missing = new Map();
for (const { f, css } of all) {
  for (const m of css.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
    const name = m[1];
    if (defined.has(name)) continue;
    const line = css.slice(0, m.index).split('\n').length;
    if (!missing.has(name)) missing.set(name, []);
    missing.get(name).push(`${f}:${line}`);
  }
}

// Some variables are set from JavaScript at runtime (theme engine, per-page accents) and
// are legitimately absent from the stylesheets. Listed rather than pattern-matched, so
// adding one is a decision somebody makes on purpose.
const SET_AT_RUNTIME = new Set(['--bc', '--glass-alpha']);
for (const k of SET_AT_RUNTIME) missing.delete(k);

// Undefined before this check existed. Baselined rather than fixed in one sweep, the same
// way check-hardcoded-colors carries its 54: a gate that fails on somebody else's ten-year
// -old stylesheet on the day it lands is a gate that gets commented out, and fixing all of
// them here would smuggle a large unrelated change into whatever commit added the check.
//
// The point is to stop the number GROWING. Fix one and delete its line; never add to it
// without a reason worth writing next to it.
const KNOWN = new Set([
  '--bg-tertiary',   // apps.css
  '--text-bright',   // main.css
  '--text-normal',   // main.css
  '--text',          // main.css:5785 — one older use; the newer one was fixed
  '--font-inter',    // main.css
  '--text-main',     // mapper.css
  '--border-color',  // mapper.css
  '--accent-low',    // mapper.css
  '--tile-accent',   // style-modal.css — probably set per tile from JS
  '--tut-color',     // tutorial.css — set per step from JS
]);
const knownHits = [];
for (const k of KNOWN) if (missing.delete(k)) knownHits.push(k);

if (!missing.size) {
  console.log(`✓ no new undefined CSS variables (${defined.size} defined, ${knownHits.length} known-undefined carried)`);
  process.exit(0);
}
for (const [name, where] of missing) {
  console.error(`✗ ${name} is used but never defined — ${where.slice(0, 3).join(', ')}${where.length > 3 ? ` (+${where.length - 3} more)` : ''}`);
}
console.error('\n  var(--undefined) paints nothing and inherits everything: the page looks almost right.');
console.error('  If it is set from JavaScript, add it to SET_AT_RUNTIME in this script.');
process.exit(1);
