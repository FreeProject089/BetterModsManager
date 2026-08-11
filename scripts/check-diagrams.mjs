// Every openDiagram('…') in the markup must exist in the diagram registry.
//
// A missing id is not an error the user can see: openDiagram() logs to the console and
// returns, so the button appears to do nothing at all. `lightweight-architecture` sat
// broken that way — one of five ids in index.html, the only one absent from the registry,
// and nothing in the build or the type-checker had an opinion about it.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'frontend/index.html'), 'utf8');
const registry = readFileSync(join(ROOT, 'frontend/src/docs/interactive-docs.ts'), 'utf8');

// The registry block, so a stray quoted id elsewhere in the file cannot vouch for itself.
const block = registry.match(/export const diagrams\s*=\s*\{([\s\S]*?)\n\};/);
if (!block) {
  console.error('✗ could not find the `diagrams` registry in interactive-docs.ts');
  process.exit(1);
}
const known = new Set([...block[1].matchAll(/'([a-z0-9-]+)'\s*:/g)].map((m) => m[1]));

const used = [...html.matchAll(/openDiagram\(\s*['"]([a-z0-9-]+)['"]/g)].map((m) => m[1]);
const missing = [...new Set(used)].filter((id) => !known.has(id));

// The reverse question, as a warning: a diagram nobody links to is written, translated and
// shipped, and unreachable. Nothing breaks, which is why it accumulates — five had built up
// before anyone counted. Not a failure, because parking one deliberately is legitimate; but
// it should be a decision, not a drift.
const hub = readFileSync(join(ROOT, 'frontend/src/docs/docs-hub.ts'), 'utf8');
const unreachable = [...known].filter((id) => !hub.includes(`'${id}'`) && !html.includes(id));
if (unreachable.length) {
  console.warn(`⚠ ${unreachable.length} diagram(s) nothing links to:`);
  for (const id of unreachable.sort()) console.warn(`  ${id}`);
  console.warn('  Attach them to a docs-hub article, or drop them.');
}

// ── Icon classes: every <i class='icon-…'> in a diagram must exist in the CSS ──
//
// The icons are mask-image classes; an undefined one renders as NOTHING — an empty
// <i> beside the label, no error anywhere. Audited by hand once (66 used, 66 defined,
// zero contradictions); this keeps that true when diagram 42 invents `icon-hasing`.
import { readdirSync } from 'node:fs';
const DIAG = join(ROOT, 'frontend/src/docs/diagrams');
const usedIcons = new Map();
for (const f of readdirSync(DIAG).filter((x) => x.endsWith('.ts'))) {
  const src = readFileSync(join(DIAG, f), 'utf8');
  for (const m of src.matchAll(/class='(icon-[a-z0-9-]+)'/g)) {
    if (!usedIcons.has(m[1])) usedIcons.set(m[1], f);
  }
}
let cssAll = '';
for (const f of readdirSync(join(ROOT, 'frontend/css')).filter((x) => x.endsWith('.css'))) {
  cssAll += readFileSync(join(ROOT, 'frontend/css', f), 'utf8');
}
const definedIcons = new Set([...cssAll.matchAll(/\.(icon-[a-z0-9-]+)/g)].map((m) => m[1]));
const ghostIcons = [...usedIcons].filter(([i]) => !definedIcons.has(i));
if (ghostIcons.length) {
  console.error(`✗ ${ghostIcons.length} diagram icon class(es) have no CSS definition:`);
  for (const [i, f] of ghostIcons.sort()) console.error(`  ${i}  (first in ${f})`);
  console.error('  These render as an empty <i> beside the label — an invisible icon.');
  process.exit(1);
}

if (missing.length) {
  console.error(`✗ ${missing.length} diagram id(s) used in index.html are not registered:`);
  for (const id of missing) console.error(`  ${id}`);
  console.error('\n  These render as buttons that silently do nothing when clicked.');
  process.exit(1);
}
console.log(`✓ every diagram id resolves (${new Set(used).size} used, ${known.size} registered)`);
