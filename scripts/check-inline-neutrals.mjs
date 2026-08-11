// No fixed white or black wash in an inline style.
//
// `rgba(255,255,255,0.05)` means "a faint light tint over a dark surface". On a LIGHT
// theme it is white over white: the border vanishes, the panel vanishes, and nothing
// errors. `rgba(0,0,0,0.3)` is the same mistake mirrored — a hole punched in a pale card.
//
// tokens.css already carries the ladder these should use: --bmm-s02 … --bmm-s20 resolve
// through --bmm-surface-r/g/b, which every light theme sets to a dark colour. The tokens
// existed; the markup simply predates them, and inline styles are where they were never
// applied because no stylesheet ever touched them.
//
// Scoped to index.html, which is where BMM's inline styles live.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'frontend/index.html'), 'utf8');

// Two shapes are correct and are not counted:
//
//  · box-shadow / text-shadow. A shadow is black in every theme — that is what a shadow
//    is. Tokenising it would be wrong, not thorough.
//  · a literal used as a var() FALLBACK, `var(--bmm-border, rgba(...))`. It only applies
//    when the token is missing, which is exactly what a fallback is for.
//
// What remains after those is a small tail of odd alphas (0.01, 0.1, 0.12) that the
// surface ladder has no step for. The budget covers them so the check passes today while
// still failing the moment someone adds a new wash.
const BUDGET = 8;

const NEUTRAL = /rgba\(\s*(?:255\s*,\s*255\s*,\s*255|0\s*,\s*0\s*,\s*0)\s*,\s*[\d.]+\s*\)/g;
// Written deliberately, not generated. A previous version of this line ended in a
// literal backspace (0x08) where a word boundary was meant — a VALID regex requiring a
// control character after the property name, so nothing was ever exempt and the count
// was silently wrong. The same accident has happened once before in scripts/, and it is
// invisible in every editor. Matching the colon instead removes the need for \b at all.
const EXEMPT_PROP = /^\s*(?:box-shadow|text-shadow|filter|backdrop-filter)\s*:/i;

const offenders = [];
for (const m of html.matchAll(/style="([^"]*)"/g)) {
  for (const decl of m[1].split(';')) {
    if (EXEMPT_PROP.test(decl)) continue;
    // Strip var() fallbacks before looking: `var(--tok, rgba(...))` is guarded already.
    const bare = decl.replace(/var\(\s*--[a-zA-Z0-9-]+\s*,[^)]*\)/g, '');
    for (const hit of bare.matchAll(NEUTRAL)) offenders.push(hit[0]);
  }
}

if (offenders.length > BUDGET) {
  console.error(`✗ ${offenders.length} fixed white/black washes in inline styles (budget ${BUDGET}).`);
  const counts = new Map();
  for (const o of offenders) counts.set(o, (counts.get(o) ?? 0) + 1);
  for (const [v, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.error(`  ${String(n).padStart(4)}  ${v}`);
  }
  console.error('\n  These are invisible on the light themes. Use the surface ladder in');
  console.error('  tokens.css instead: --bmm-s02 … --bmm-s20, or --bmm-bg-base for a sunken field.');
  process.exit(1);
}
console.log(`✓ inline neutral washes within budget (${offenders.length} of ${BUDGET})`);
