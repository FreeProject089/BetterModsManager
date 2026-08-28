#!/usr/bin/env node
// check-counts — a number in prose is the quietest way a document goes wrong.
//
// Same shape and the same reason as check-theme-count, for the two counts that move most:
// how many task ACTIONS the scheduler has, and how many ROUTES the API serves. Both are
// quoted across five files in two languages, and both had drifted:
//
//   docs-hub.ts               said 75 actions   (there were 95)
//   BMM Docs/…/scheduler.md   said 60 actions
//   Technical_Analysis_EN.md  said 59 actions
//   Technical_Analysis_FR.md  said 49 actions   ← the two halves of one document disagreed
//   three files               said 75 endpoints (there were 80)
//
// Nothing compiled, nothing ran, and nobody could disprove any of it without counting by
// hand. The EN/FR pair is the giveaway: a translated page keeps whatever number it was
// translated from, so a stale count survives every later edit to the sentence around it.
//
// Deliberately narrow. This does not police every number in the documentation — only the two
// that are derivable from the code, which is what makes them checkable at all.
//
// Usage: node scripts/check-counts.mjs
// Exit 1 when a page's number disagrees with the source.

import { readFileSync, existsSync } from 'node:fs';

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

// ── What is true ────────────────────────────────────────────────────────────
const sched = read('frontend/src/features/settings/scheduler.ts');
if (!sched) { console.error('✗ scheduler.ts is missing — refusing to report success'); process.exit(2); }
// The same shape the action list is declared with: `{ v: 'x.y', label: '…'`.
const actions = new Set();
for (const line of sched.split('\n')) {
  const m = /\{\s*v:\s*'([a-zA-Z.]+)'/.exec(line);
  if (m && line.includes('label:')) actions.add(m[1]);
}

const api = read('src-tauri/src/api/mod.rs');
if (!api) { console.error('✗ api/mod.rs is missing — refusing to report success'); process.exit(2); }
const routes = new Set();
for (const m of api.matchAll(/warp::path!\("api"((?: \/ "[a-z0-9-]+")+)\)/g)) {
  routes.add([...m[1].matchAll(/"([a-z0-9-]+)"/g)].map((x) => x[1]).join('/'));
}

if (!actions.size || !routes.size) {
  console.error('✗ counted zero of something — the patterns have drifted, refusing to report success');
  process.exit(2);
}

// ── What the pages claim ────────────────────────────────────────────────────
const PAGES = [
  'frontend/src/docs/docs-hub.ts',
  'BMM Docs/docs/features/scheduler.md',
  'BMM Docs/docs/features/scheduler.fr.md',
  'Update/Documentation/Technical_Analysis_EN.md',
  'Update/Documentation/Technical_Analysis_FR.md',
  'Update/Documentation/App_Features_EN.md',
  'Update/Documentation/App_Features_FR.md',
];

const WANT = [
  { what: 'actions', truth: actions.size, re: /(\d{2,3}) (?:actions|actions de t\u00e2che)\b/g },
  { what: 'endpoints', truth: routes.size, re: /(\d{2,3}) (?:endpoints|routes)\b/g },
];

// A count that describes a PAST measurement is not a stale total.
//
// "the runner on 49 of 59 actions" is a coverage figure from an audit, and the French edition
// renders the same sentence as "49 actions sur 59" — which is why a pattern looking for
// "<number> actions" catches both and is wrong about both. Rewriting them would falsify a
// measurement rather than fix a claim. The first run of this script wanted to do exactly
// that, which is the reason this list exists.
// Ordered alternation bites here: `of` matches before `of the`, then fails on "the" and
// the whole branch is abandoned - which is why "49 of the 59 actions" slipped through the
// first version of this line. The optional group is the fix.
const HISTORICAL = /(?:of(?:\s+the)?|sur|des|parmi|out of)\s*\d{2,3}/;

const wrong = [];
for (const page of PAGES) {
  const text = read(page);
  if (!text) continue;
  for (const { what, truth, re } of WANT) {
    for (const m of text.matchAll(re)) {
      const said = Number(m[1]);
      if (said === truth) continue;
      // Look at the sentence around it, not the two words the pattern matched.
      const around = text.slice(Math.max(0, m.index - 40), m.index + 60);
      if (HISTORICAL.test(around)) continue;
      const line = text.slice(0, m.index).split('\n').length;
      wrong.push(`${page}:${line} — says ${said} ${what}, there are ${truth}`);
    }
  }
}

if (wrong.length) {
  console.error('✗ a page quotes a count that is no longer true:\n');
  for (const w of wrong) console.error(`  ${w}`);
  console.error(`
  ${actions.size} task actions · ${routes.size} API routes.

  A number in prose is not checked by anything else: it compiles, it renders, and it is
  wrong. Update the page, or rewrite the sentence so it does not carry a number.
`);
  process.exit(1);
}
console.log(`✓ quoted counts agree with the code (${actions.size} actions, ${routes.size} routes)`);
