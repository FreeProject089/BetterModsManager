// A stylesheet may not target an id that exists nowhere.
//
// Twice in one session a selector pointed at markup that had been removed:
// `.tut-hub-container` in the theme editor's live preview, and `.tut-hub-mascot` in the
// themeable-image list. Neither failed. A selector that matches nothing costs nothing at
// runtime and quietly asserts something false — a reader concludes the rule is doing work.
//
// Ids only, deliberately. Classes are generated, composed and toggled from code far more
// than ids are, so a class-level check is mostly noise; an `#id` is a promise about one
// specific element and is either kept or not.
//
// Evidence is index.html AND the TypeScript sources: most of BMM's markup is rendered by
// code, so a scan of the static file alone would report half the app as dead.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'frontend/index.html'), 'utf8');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|js)$/.test(name)) out.push(p);
  }
  return out;
}
const sources = walk(join(ROOT, 'frontend/src')).map((f) => readFileSync(f, 'utf8')).join('\n');

const CSS = join(ROOT, 'frontend/css');
const files = readdirSync(CSS).filter((f) => f.endsWith('.css'));

/** Does this id appear anywhere as a real element id, or in code that builds one? */
function exists(id) {
  if (html.includes(`id="${id}"`)) return true;
  // Built at runtime: `el.id = 'foo'`, getElementById('foo'), a template string, etc.
  // Whole-word so `#apps-search` is not vouched for by `apps-search-results`.
  // Ids are [A-Za-z0-9_-] by the selector regex above, so nothing here needs escaping —
  // which also removes the only place a backslash could be eaten between here and the file.
  return new RegExp(`["'\`\\s#]${id}["'\`\\s]`).test(sources);
}

// Pre-existing dead rules, left as a visible baseline rather than deleted blind: each
// styles a screen I could not confirm is gone, and removing CSS for a feature that still
// exists under another name is worse than leaving it. Shrink this list, never grow it.
const KNOWN_DEAD = new Set([
  'docker-doc-card', 'modal-benchmark', 'playback-controls', 'playback-time-display',
  // theme-editor live-preview targets whose elements are gone. Same defect as
  // .tut-hub-container: the preview silently does nothing for these labels. Left listed
  // rather than repointed because finding the CURRENT selector for each needs the editor
  // open, and a wrong guess previews the wrong element — which is worse than none.
  '.card-title', '.form-label', '.progress-bar', '.tasky-speech-bubble',
]);

const dead = [];
for (const file of files) {
  const css = readFileSync(join(CSS, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // Selector position only: `#id` inside a url() or a colour would not match this anyway,
  // but requiring a selector-ish boundary keeps hex colours (#fff) out.
  for (const m of css.matchAll(/(?:^|[\s,>+~(])#([a-zA-Z][a-zA-Z0-9_-]*)/g)) {
    const id = m[1];
    // A hex colour reads exactly like an id at this position — `linear-gradient(…, #e4e4e8)`
    // is the common case. Nothing in BMM names an element in hex, so anything that is
    // ONLY hex digits is a colour, not a selector.
    if (/^[0-9a-fA-F]{3,8}$/.test(id)) continue;
    if (KNOWN_DEAD.has(id)) continue;
    if (!exists(id)) dead.push([file, id]);
  }
}

// ── Selector TABLES in code ──────────────────────────────────────────────────
//
// The two failures that prompted this guard were not in CSS at all: the theme editor's
// live-preview list targeted `.tut-hub-container` and the themeable-image list targeted
// `.tut-hub-mascot`, both of which the hub rebuild deleted. A CSS-only check would not
// have caught either — so the two tables are read directly.
//
// Only these two, and only their literal single-selector entries. A general sweep of every
// querySelector() in the codebase would be noise: most are built, scoped to a subtree, or
// legitimately optional. These two are DECLARATIONS — a list whose whole purpose is to
// name things that exist.
const TABLES = [
  ['theme-editor.ts', 'frontend/src/features/themes/theme-editor.ts', /[\s{]sel:\s*'([^',]+)'/g],
  ['theme-engine.ts', 'frontend/src/features/themes/theme-engine.ts', /MASCOT_SELECTORS[^\]]*\]/g],
];

for (const [label, rel, re] of TABLES) {
  // Comments stripped first. A note explaining why a selector was REMOVED quotes it, and
  // the extraction would read the prose and re-report it — which is exactly what happened
  // the first time, and what check-token-collisions.mjs hit before it.
  const src = readFileSync(join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ 	]*\/\/.*$/gm, '');
  const found = label === 'theme-engine.ts'
    ? [...(src.match(re)?.[0] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
    : [...src.matchAll(re)].map((m) => m[1]);
  for (const sel of found) {
    // Compound and descendant selectors describe a shape, not one named element; only a
    // bare #id or .class is a claim this check can settle.
    const m = /^([#.])([a-zA-Z][a-zA-Z0-9_-]*)$/.exec(sel.trim());
    if (!m) continue;
    const [, kind, name] = m;
    const present = kind === '#'
      ? html.includes(`id="${name}"`) || exists(name)
      : new RegExp(`class="[^"]*\b${name}\b`).test(html) || exists(name);
    if (KNOWN_DEAD.has(sel.trim())) continue;
    if (!present) dead.push([label, sel]);
  }
}

const uniq = [...new Map(dead.map(([f, i]) => [`${f}#${i}`, [f, i]])).values()];
if (uniq.length) {
  console.error(`✗ ${uniq.length} selector(s) match nothing in the app:`);
  for (const [f, i] of uniq.sort()) console.error(`  ${basename(f).padEnd(20)} #${i}`);
  console.error('\n  These style nothing and read as if they do. Remove them, or fix the id.');
  process.exit(1);
}
console.log(`✓ every CSS id selector and declared selector resolves (${files.length} stylesheets + 2 tables)`);
