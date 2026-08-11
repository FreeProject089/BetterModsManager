// Every selector a tutorial step highlights must exist somewhere, and every i18n key it
// names must be translated.
//
// A step pointing at a selector that is nowhere in the app renders as a dimmed screen with
// nothing lit up. The lesson looks broken and no error is raised anywhere, because the
// engine simply finds no element — so this is invisible until someone walks the whole
// tutorial by hand.
//
// Most of BMM's markup is rendered by TypeScript rather than written in index.html — mod
// cards, the command palette, the scheduler. Checking only the static file would report all
// of those as dead, so the sources count as evidence too: a name that appears NOWHERE is a
// real finding, one that appears in a template string is simply built at runtime.
//
// What this does NOT catch: a selector that exists but is not REACHABLE yet, because the
// panel or modal holding it has to be opened first. That is the other half of the tutorial's
// problems and it needs to know what each step leaves on screen — a judgement, not a lookup.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = readFileSync(join(ROOT, 'frontend/src/ui/tutorial-data.ts'), 'utf8');
const html = readFileSync(join(ROOT, 'frontend/index.html'), 'utf8');
const en = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/en.json'), 'utf8'));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|js)$/.test(name)) out.push(p);
  }
  return out;
}
// tutorial-data itself is excluded: a selector cannot vouch for its own existence.
const sources = walk(join(ROOT, 'frontend/src'))
  .filter((f) => !f.endsWith('tutorial-data.ts'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const classes = new Set(
  [...html.matchAll(/\bclass="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean),
);

const RUNTIME = /[$`]|\$\{|\[data-|:nth|,/; // built or compound — not statically checkable

function known(name) {
  if (ids.has(name) || classes.has(name)) return true;
  // Rendered by code: require the name to appear as a whole word, so "apps-search" is not
  // satisfied by "apps-search-results".
  return new RegExp(`["'\`\\s.#]${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'\`\\s]`).test(sources);
}

function resolvable(sel) {
  const s = sel.trim();
  if (!s || RUNTIME.test(s)) return true;
  return known(s.replace(/^[#.]/, ''));
}

const missingSel = [];
const missingKey = [];

for (const m of data.matchAll(/\b(?:modal_)?selector:\s*'([^']+)'/g)) {
  if (!resolvable(m[1])) missingSel.push(m[1]);
}
for (const block of data.matchAll(/\bselectors:\s*\[([^\]]*)\]/g)) {
  for (const one of block[1].matchAll(/'([^']+)'/g)) {
    if (!resolvable(one[1])) missingSel.push(one[1]);
  }
}
for (const m of data.matchAll(/\b(?:title|text|desc)_key:\s*'([^']+)'/g)) {
  if (!(m[1] in en)) missingKey.push(m[1]);
}

const uniq = (a) => [...new Set(a)].sort();
let bad = false;

if (uniq(missingSel).length) {
  bad = true;
  console.error(`✗ ${uniq(missingSel).length} tutorial selector(s) exist nowhere in the app:`);
  for (const s of uniq(missingSel)) console.error(`  ${s}`);
  console.error('\n  These dim the screen and highlight nothing, with no error anywhere.');
}
if (uniq(missingKey).length) {
  bad = true;
  console.error(`✗ ${uniq(missingKey).length} tutorial i18n key(s) are missing from en.json:`);
  for (const k of uniq(missingKey)) console.error(`  ${k}`);
}
if (bad) process.exit(1);

console.log('✓ every tutorial selector and i18n key resolves');
