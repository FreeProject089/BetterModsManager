#!/usr/bin/env node
// Sixteen automation actions whose form values never reached the script they generated.
//
// The chain in `features/plugins/plugins.ts` is three hops:
//
//   the card's inputs  →  `raw`   (generic: every [data-field] on the card)
//   `raw`              →  `extra` (an ALLOWLIST, one case per action type)
//   `extra`            →  the request body, read key by key in `_apiBodyFor`
//
// The middle hop stopped being extended. Thirty-three action types had a case; sixteen newer
// ones declared form fields and had none — so `extra` stayed `{}`, every `s('…')` in their
// body read an empty string, and "Host this repo" generated `{"path":"","port":0}`. The form
// accepted what you typed, the script ran, and nothing anywhere said the values were gone.
//
// Two things are checked, and the second is the one that would have caught it:
//
//   1. every field an action's body READS must be a field that action DECLARES — otherwise
//      the body asks `extra` for something no input ever fills;
//   2. every action whose body reads its own fields must be reachable by the raw→extra hop.
//
// A `default:` that copies `raw` satisfies (2) for everything at once, which is the fix that
// shipped: the explicit cases exist to RESHAPE (duration_s → duration_ms), and an action that
// needs no reshaping should need no case.
import { readFileSync, existsSync } from 'node:fs';

const SRC = 'frontend/src/features/plugins/plugins.ts';
if (!existsSync(SRC)) { console.error(`✗ ${SRC} is missing — refusing to report success`); process.exit(2); }
const src = readFileSync(SRC, 'utf8');

// ── what each action DECLARES as form fields ──
// By BLOCK boundary, not by a closing bracket at a guessed indentation. The first version
// required `] }` at exactly ten spaces, silently missed thirteen actions, and then reported
// every one of them as declaring no fields at all — a checker that cries wolf on correct code
// is a checker somebody switches off.
const declared = new Map();
const starts = [...src.matchAll(/\n {8}\{ id: '(\w+)',/g)];
for (let i = 0; i < starts.length; i++) {
  const from = starts[i].index;
  const to = i + 1 < starts.length ? starts[i + 1].index : from + 4000;
  declared.set(starts[i][1], [...src.slice(from, to).matchAll(/key: '(\w+)'/g)].map((x) => x[1]));
}

// ── the raw → extra hop ──
const ca = src.indexOf('function _collectActions(');
const caEnd = src.indexOf('\nasync function buildScript(', ca);
if (ca < 0 || caEnd < 0) { console.error('✗ _collectActions moved — this check cannot be trusted'); process.exit(2); }
const collect = src.slice(ca, caEnd);
const reshaped = new Set([...collect.matchAll(/case '(\w+)':/g)].map((m) => m[1]));
// Comments stripped: a gate that greps a source file must grep the CODE. A comment naming
// `Object.assign(extra, raw)` while the call is gone would otherwise report success.
const collectCode = collect.replace(/^\s*\/\/.*$/gm, '');
const copiesEverything = /default:\s*\n\s*Object\.assign\(extra, raw\);/.test(collectCode);

// ── what each body READS out of extra ──
const bodyAt = src.indexOf('function _apiBodyFor(');
const bodyEnd = src.indexOf('\nfunction _prune(', bodyAt);
if (bodyAt < 0 || bodyEnd < 0) { console.error('✗ _apiBodyFor moved — this check cannot be trusted'); process.exit(2); }
const bodies = new Map();
for (const m of src.slice(bodyAt, bodyEnd).matchAll(/case '(\w+)':([\s\S]*?)\n? *\};/g)) bodies.set(m[1], m[2]);

if (declared.size < 20 || reshaped.size < 20 || bodies.size < 30) {
  console.error(`✗ read ${declared.size} declared / ${reshaped.size} reshaped / ${bodies.size} bodies — the extractors are stale`);
  process.exit(2);
}

const problems = [];
for (const [id, body] of bodies) {
  // Every `s('x')` / `bool('x')` / `num('x')` the body asks `extra` for.
  const wants = [...new Set([...body.matchAll(/\b(?:s|bool|num)\('(\w+)'/g)].map((m) => m[1]))];
  if (!wants.length) continue;
  const fields = declared.get(id);
  if (!fields) {
    // The body reads fields for an action that declares none. Either the action is gone and
    // the case is dead, or it lost its form — both are worth a look.
    problems.push(`${id}: its body reads ${wants.join(', ')} and the action declares no fields at all`);
    continue;
  }
  const unfillable = wants.filter((w) => !fields.includes(w));
  if (unfillable.length) problems.push(`${id}: its body reads ${unfillable.join(', ')}, which no input on its card fills`);
  if (!reshaped.has(id) && !copiesEverything) {
    problems.push(`${id}: nothing copies its fields into extra — every value it reads comes back empty`);
  }
}

if (problems.length) {
  console.error('✗ automation action fields:');
  for (const p of problems) console.error(`    ${p}`);
  console.error('\n  A form that accepts what you type and a script that posts empty strings is the');
  console.error('  quietest failure in this file: nothing errors, and the task reports success.');
  process.exit(1);
}
console.log(`✓ action fields OK — ${bodies.size} action bodies, every value they read is one a card can fill`);
