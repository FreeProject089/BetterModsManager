// check-i18n-dynamic.mjs — the keys check-i18n-keys structurally cannot see.
//
// The scheduler builds most of its visible words from a registry: `t('sched.act.' + a.v)`,
// `t('sched.grp.' + grp.g)`, and six more families. check-i18n-keys scans for LITERAL
// t('…') calls, so every one of these is invisible to it — and t() returns the key itself
// on a miss, which means the `|| a.label` fallback sitting right next to the call never
// runs. The failure mode is not English-in-a-French-UI; it is the action dropdown listing
// `sched.act.http.request` as the name of an action.
//
// That is exactly what shipped: two actions added to the registry, both gates green, and
// both would have rendered as their own key in the menu.
//
// So: read the registries out of the source, expand each family, and check both language
// files. Extracted rather than restated — a list typed in here would be a second registry
// to keep in agreement with the first.

import fs from 'node:fs';

const SRC = 'frontend/src/features/settings/scheduler.ts';
const LANGS = ['frontend/Lang/en.json', 'frontend/Lang/fr.json'];

const src = fs.readFileSync(SRC, 'utf8');
const dicts = LANGS.map((f) => ({ f, d: JSON.parse(fs.readFileSync(f, 'utf8')) }));

/**
 * The text of `const NAME … = [ … ];`, from the declaration to the matching `\n];`.
 *
 * Found by scanning for `= [` rather than by a `[^=]*` pattern: PRESETS is annotated
 * `{ …; make: () => Partial<Task> }[]`, and the arrow's `=` ended the match early, so the
 * gate reported it could not find a registry that was sitting right there. It refused
 * instead of checking nothing, which is the only reason that was a five-minute problem.
 */
function block(name) {
  const at = src.indexOf(`const ${name}`);
  if (at < 0) return null;
  // The assignment `=`, which is not the first `=` after the name: PRESETS is annotated
  // `{ …; make: () => Partial<Task> }[]`, so the arrow gets there first and the bracket
  // search then landed on the `[]` of the type — an empty registry.
  let eq = -1;
  for (let i = at; i < src.length; i++) {
    if (src[i] !== '=') continue;
    if (src[i + 1] === '>' || src[i + 1] === '=' || '=!<>'.includes(src[i - 1])) continue;
    eq = i; break;
  }
  if (eq < 0) return null;
  const open = src.indexOf('[', eq);
  if (open < 0) return null;
  // Bracket counting, not a search for `\n];`. COND_TYPES is one line, so looking for a
  // closing bracket at the start of a line ran straight past it and swallowed the NEXT
  // array — the gate then reported every VALUE_SOURCES entry as a missing condition name.
  // A wrong answer that looks like twenty findings is worse than no gate.
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']' && --depth === 0) return src.slice(open, i);
  }
  return null;
}

/** Values from `{ v: 'x', … }` entries inside a named array literal. */
function fromArray(name, field) {
  const b = block(name);
  if (!b) return null;
  return [...b.matchAll(new RegExp(`${field}: '([^']+)'`, 'g'))].map((m) => m[1]);
}

/** A plain `const X = ['a', 'b']` list. */
function fromList(name) {
  const b = block(name);
  if (!b) return null;
  return [...b.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

// Each family: the prefix in the code, and where its values come from. `optional` marks a
// family where a missing entry is a description rather than a name — still wrong, but it
// renders as a raw key in a tooltip instead of in a menu, so it is reported separately.
const FAMILIES = [
  { prefix: 'sched.act.',     values: () => fromArray('ACTION_TYPES', 'v'),   what: 'action name' },
  { prefix: 'sched.actd.',    values: () => fromArray('ACTION_TYPES', 'v'),   what: 'action description', optional: true },
  { prefix: 'sched.grp.',     values: () => fromArray('ACTION_GROUPS', 'g'),  what: 'action group' },
  { prefix: 'sched.cond.',    values: () => fromList('COND_TYPES'),           what: 'condition name' },
  { prefix: 'sched.preset.',  values: () => fromArray('PRESETS', 'key'),      what: 'preset name' },
  { prefix: 'sched.presetd.', values: () => fromArray('PRESETS', 'key'),      what: 'preset description' },
];

const hard = [];
const soft = [];
for (const fam of FAMILIES) {
  const values = fam.values();
  if (!values) { console.error(`✗ could not read the registry behind ${fam.prefix} — the gate cannot check what it cannot find`); process.exit(2); }
  if (!values.length) { console.error(`✗ the registry behind ${fam.prefix} came back empty — refusing to report success`); process.exit(2); }
  for (const v of values) {
    for (const { f, d } of dicts) {
      if (d[`${fam.prefix}${v}`] !== undefined) continue;
      (fam.optional ? soft : hard).push(`${fam.prefix}${v}  (${fam.what}, ${f})`);
    }
  }
}

if (!hard.length && !soft.length) {
  console.log(`✓ every dynamic scheduler key resolves in both languages (${FAMILIES.length} families)`);
  process.exit(0);
}
for (const h of hard) console.error(`✗ ${h}`);
for (const s of soft) console.error(`· ${s}`);
if (hard.length) {
  console.error(`\n  ${hard.length} name(s) would render as their own key on screen — "sched.act.http.request"`);
  console.error('  in the action menu, not an English word in a French UI. The `|| fallback` beside');
  console.error('  the call cannot help: t() returns the key on a miss, so the || never fires.');
  process.exit(1);
}
console.error(`\n  ${soft.length} description(s) missing — a raw key in a tooltip. Not fatal; fix when convenient.`);
process.exit(0);
