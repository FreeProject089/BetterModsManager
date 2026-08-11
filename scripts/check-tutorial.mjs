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
// It also flags the OTHER half of the problem, as warnings rather than failures: a selector
// that exists but sits inside a modal, so the step dims the screen and highlights something
// nobody can reach until that modal is opened. Whether a given step is wrong depends on what
// the previous one left on screen, which is a judgement — so these are listed for review,
// not failed. A step declaring `modal_selector` is doing this on purpose and is skipped.

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

// ── reachability: selectors that live inside a modal ─────────────────────────
//
// Built from index.html by walking each `id="modal-…"` element to its matching close tag, so
// nesting is respected — a naive "next </div>" would end the region at the first inner div
// and miss almost everything inside it.
function modalRegions() {
  const out = [];
  for (const m of html.matchAll(/<div[^>]*\bid="(modal-[^"]+)"/g)) {
    let i = m.index, depth = 0;
    for (const tag of html.slice(m.index).matchAll(/<div\b|<\/div>/g)) {
      depth += tag[0] === '</div>' ? -1 : 1;
      if (depth === 0) { out.push([m[1], m.index, m.index + tag.index]); break; }
    }
    void i;
  }
  return out;
}
const regions = modalRegions();

function insideModal(name) {
  const at = html.indexOf(`id="${name}"`);
  if (at < 0) return null;
  const hit = regions.find(([, a, b]) => at > a && at < b);
  return hit ? hit[0] : null;
}

// Steps that declare modal_selector are deliberately about a modal — not a finding.
const deliberate = new Set(
  [...data.matchAll(/modal_selector:\s*'([^']+)'/g)].map((m) => m[1].replace(/^[#.]/, '')),
);
const gated = [];
for (const m of data.matchAll(/\bselector:\s*'([^']+)'/g)) {
  const name = m[1].trim().replace(/^[#.]/, '');
  if (RUNTIME.test(m[1]) || deliberate.has(name)) continue;
  const modal = insideModal(name);
  if (modal) gated.push(`${m[1]}  (inside ${modal})`);
}

// ── every `nav:` must reach a real nav item ───────────────────────────────────
//
// _navigate() does `querySelector('.nav-item[data-view=…]')?.click()`. On a typo the optional
// chain swallows it: no error, no navigation, and the step then highlights its selector on
// whatever view happened to be open. The engine's alias table is read out of the source
// rather than copied here, so the two cannot drift apart.
const views = new Set([...html.matchAll(/data-view="([a-z-]+)"/g)].map((m) => m[1]));
const aliasBlock = sources.match(/VIEW_ALIAS[^=]*=\s*\{([^}]*)\}/);
const alias = {};
if (aliasBlock) {
  for (const a of aliasBlock[1].matchAll(/(\w+)\s*:\s*'([^']+)'/g)) alias[a[1]] = a[2];
}
const badNav = [];
for (const m of data.matchAll(/nav:\s*'([^']+)'/g)) {
  const key = alias[m[1]] ?? m[1];
  if (!views.has(key)) badNav.push(alias[m[1]] ? `${m[1]} (aliased to ${key})` : m[1]);
}

const uniq = (a) => [...new Set(a)].sort();
let bad = false;

if (uniq(badNav).length) {
  bad = true;
  console.error(`✗ ${uniq(badNav).length} step nav target(s) match no nav item:`);
  for (const n of uniq(badNav)) console.error(`  ${n}`);
  console.error('  _navigate() swallows these: the step simply does not move, silently.');
}

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

if (uniq(gated).length) {
  console.warn(`\n⚠ ${uniq(gated).length} step selector(s) live inside a modal — check a prior step opens it:`);
  for (const g of uniq(gated)) console.warn(`  ${g}`);
  console.warn('  (warning only: whether this is wrong depends on the step before it)');
}

console.log('✓ every tutorial selector and i18n key resolves');
