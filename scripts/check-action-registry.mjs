// check-action-registry.mjs — one action type, one registry entry, one switch case.
//
// A duplicate is not a cosmetic problem here, because the two lookups disagree about which
// copy wins:
//   · the editor does ACTION_TYPES.find(a => a.v === type) → the FIRST registry entry
//   · runAction is a switch → the FIRST matching case
// So a type declared twice can render one editor while running the other implementation.
// That is exactly what happened: `var.set` gained a second entry with a scope field, the
// editor kept rendering the older one that has none, and the shared-variable scope was
// unreachable from the UI while working perfectly at runtime. The action also appeared
// twice in the dropdown, which is how it was noticed — by looking, not by any check.
//
// TypeScript does not object to either: duplicate object literals in an array are fine, and
// duplicate `case` labels in a switch are legal JavaScript.

import fs from 'node:fs';

const F = 'frontend/src/features/settings/scheduler.ts';
const src = fs.readFileSync(F, 'utf8');

const dupes = (values) => {
  const seen = new Map();
  for (const v of values) seen.set(v, (seen.get(v) || 0) + 1);
  return [...seen].filter(([, n]) => n > 1);
};

// The registry, read from its initialiser. Aimed at `] = [` rather than the first `[`,
// because the type annotation ends in `}[]` and a naive search lands inside it.
const decl = src.indexOf('const ACTION_TYPES');
if (decl < 0) { console.error('✗ ACTION_TYPES not found — refusing to report success'); process.exit(2); }
const open = src.indexOf('] = [', decl);
if (open < 0) { console.error('✗ could not find the ACTION_TYPES initialiser'); process.exit(2); }
let depth = 0, end = -1;
for (let i = open + 4; i < src.length; i++) {
  if (src[i] === '[') depth++;
  else if (src[i] === ']' && --depth === 0) { end = i; break; }
}
if (end < 0) { console.error('✗ ACTION_TYPES initialiser is not closed'); process.exit(2); }
const registry = [...src.slice(open, end).matchAll(/\{ v: '([^']+)'/g)].map((m) => m[1]);
if (registry.length < 20) { console.error(`✗ only ${registry.length} actions parsed — too few to be right`); process.exit(2); }

// Switch cases inside runAction. Scoped to that function so a `case` elsewhere in the file
// (the condition evaluator has its own) is not counted as a duplicate of an action.
const runAt = src.indexOf('async function runAction');
if (runAt < 0) { console.error('✗ runAction not found'); process.exit(2); }
const runEnd = src.indexOf('\n}', src.indexOf('switch', runAt));
const cases = [...src.slice(runAt, runEnd).matchAll(/case '([a-zA-Z0-9_.]+)':/g)].map((m) => m[1]);

const problems = [];
for (const [v, n] of dupes(registry)) problems.push(`ACTION_TYPES declares '${v}' ${n} times — the editor uses the first, so the others are unreachable`);
for (const [v, n] of dupes(cases)) problems.push(`runAction has ${n} cases for '${v}' — the first wins, the rest are dead code`);

// An action people can pick but nothing implements does nothing, silently.
const missing = registry.filter((v) => !cases.includes(v));
// Not every action is a switch case — some are dispatched through the deeplink helper — so
// this is reported as information rather than as a failure, and says so.
if (!problems.length) {
  console.log(`✓ action registry OK (${registry.length} actions, no duplicates)${missing.length ? ` · ${missing.length} dispatched outside the switch` : ''}`);
  process.exit(0);
}
for (const p of problems) console.error(`✗ ${p}`);
console.error('\n  tsc accepts both: duplicate object literals are fine, and duplicate case labels');
console.error('  are legal JavaScript. The two lookups can disagree about which copy wins.');
process.exit(1);
