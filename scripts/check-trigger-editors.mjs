// Every trigger type must have its own branch in the editor, and the editor must not end in
// a catch-all.
//
// Four of the thirteen triggers shipped with no configuration UI. `onEvent`, `condition`,
// `script` and `afterTask` each build a real editor — an engine picker and a code box, the
// full 34-condition editor, an event list — in their own `if` block ABOVE the
// `interval → hourly → … → once` chain. None of them was named IN that chain, and the chain
// ended in a bare `else` that set `ph.innerHTML` to "Runs once each time BMM launches."
//
// So the editor was built and then overwritten, one line later, by a sentence about a
// different trigger. Their change handlers were bound to elements that no longer existed.
// Picking "when a script says so" gave you nowhere to write the script and a claim that it
// runs at startup.
//
// Nothing could see it. It typechecks — every branch is valid TypeScript. It renders — there
// is always something in the box. And `appStart`, the trigger the catch-all was written for,
// had no branch of its own, so it reached that sentence through the `else` and looked right.
// The one case anybody would check by hand was the one case that worked.
//
// Two rules, and the second is what makes the first hold:
//   1. every member of the `Trigger` union is named in `renderTriggerEditor`
//   2. that function has no `else { … }` fallback — a new trigger must fail loudly, not
//      inherit somebody else's description
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'frontend/src/features/settings/scheduler.ts');

if (!existsSync(SRC)) {
  console.error(`✗ ${SRC} is missing — refusing to report success`);
  process.exit(2);
}
const src = readFileSync(SRC, 'utf8');

const unionStart = src.indexOf('type Trigger =');
if (unionStart < 0) {
  console.error('✗ the Trigger union is not where this check looks for it — it cannot be trusted');
  process.exit(2);
}
const union = src.slice(unionStart);
const body = union.slice(0, union.indexOf('};') + 1);
const types = [...new Set([...body.matchAll(/\{\s*type:\s*'([a-zA-Z]+)'/g)].map((m) => m[1]))];

const fnStart = src.indexOf('function renderTriggerEditor(');
if (fnStart < 0) {
  console.error('✗ renderTriggerEditor is not where this check looks for it — it cannot be trusted');
  process.exit(2);
}
const fnEnd = src.indexOf('\nfunction ', fnStart + 10);
const fn = src.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);
const handled = new Set([...fn.matchAll(/tr\.type === '([a-zA-Z]+)'/g)].map((m) => m[1]));

if (types.length < 8 || handled.size < 8) {
  console.error(`✗ read ${types.length} trigger type(s) and ${handled.size} branch(es) — too few to be right`);
  process.exit(2);
}

const problems = [];
for (const t of types) {
  if (!handled.has(t)) problems.push(`the "${t}" trigger has no branch — it falls through to whatever comes last`);
}
for (const h of handled) {
  if (!types.includes(h)) problems.push(`the editor has a branch for "${h}", which is not a trigger type`);
}
// The catch-all itself. `} else {` followed by an assignment to the params host is the shape
// that caused this; a trigger that is not named must render nothing rather than inherit a
// sentence written for another one.
if (/\}\s*else\s*\{[\s\S]{0,200}?ph\.innerHTML/.test(fn)) {
  problems.push('renderTriggerEditor still ends in a catch-all `else` that writes the params host — a new trigger would silently inherit it');
}

// ── and the keyword each trigger PRINTS ────────────────────────────────────
//
// The code box shows the task's steps; the sidebar owns its header. Which lines are which was
// decided by a regex naming four keywords out of thirteen, so for `watchFile`, `onEvent`,
// `afterTask`, `condition` and `script` the trigger line was left in the box AS A STEP — and
// that text is what gets compiled back when you press Blocks, so it was not a display bug.
//
// TRIGGER_HEAD is a Record keyed by the union, so tsc already refuses a missing key. This
// checks the thing tsc cannot: that the table has not been widened to `Record<string, …>`,
// which would make every future omission compile.
const table = fn.length && src.slice(src.indexOf('const TRIGGER_HEAD'));
if (!/const TRIGGER_HEAD: Record<Trigger\['type'\], RegExp>/.test(src)) {
  problems.push("TRIGGER_HEAD is no longer typed as Record<Trigger['type'], RegExp> — a missing trigger would stop being a compile error");
} else {
  const lit = table.slice(0, table.indexOf('};') + 1);
  const keys = new Set([...lit.matchAll(/(?:^|[{,]\s*)([a-zA-Z][\w]*)\s*:\s*\//g)].map((m) => m[1]));
  for (const t of types) if (!keys.has(t)) problems.push(`TRIGGER_HEAD has no entry for "${t}" — its header line would be read as a step`);
}

if (problems.length) {
  console.error('✗ trigger editors:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`✓ trigger editors OK — all ${types.length} type(s) have their own branch, no catch-all`);
