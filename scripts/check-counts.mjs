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
import { cliTree } from './cli-tree.mjs';

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

// The MCP server's tool declarations — the same ones check-mcp-tools reads.
const mcp = read('src-tauri/src/mcp/server.rs');
const tools = new Set([...(mcp || '').matchAll(/Tool::new\(\s*"(bmm_[a-z0-9_]+)"/g)].map((m) => m[1]));

// The CLI on the same binary. Parsed from the clap enum, not counted by hand.
const cli = cliTree();

// Commands the Rust core registers. `check-invoke-names.mjs` gates the other direction;
// this only needs the total, and the total is quoted in four documents.
const cmds = new Set();
for (const f of ['src-tauri/src/main.rs', 'src-tauri/src/lib.rs']) {
  const t = read(f);
  if (!t) continue;
  const at = t.indexOf('generate_handler!');
  if (at < 0) continue;
  let i = t.indexOf('[', at), d = 0, j = i;
  for (; j < t.length; j++) { if (t[j] === '[') d++; else if (t[j] === ']') { d--; if (!d) break; } }
  for (const m of t.slice(i, j).matchAll(/([a-z_][a-z0-9_]*)\s*(?:,|\]|$)/g)) cmds.add(m[1]);
}

// Cycles and unreachable modules come from the COMMITTED baseline rather than from a fresh
// dep-graph run: the baseline is the number the gate enforces, so it is the number a page
// describing that gate has to agree with, and reading it costs nothing.
let baseline = {};
try { baseline = JSON.parse(read('scripts/dep-graph.baseline.json') || '{}'); } catch { /* caught below */ }

// `npm run ci` is quoted as a step count in the commands reference, both editions.
let ciSteps = 0;
try { ciSteps = (JSON.parse(read('package.json')).scripts.ci || '').split('&&').length; } catch { /* caught below */ }

if (!actions.size || !routes.size || !tools.size || !cli.length || !cmds.size || !baseline.cycles || !ciSteps) {
  console.error('✗ counted zero of something — the patterns have drifted, refusing to report success');
  console.error(`  actions ${actions.size} · routes ${routes.size} · mcp ${tools.size} · cli ${cli.length} · commands ${cmds.size} · cycles ${baseline.cycles} · ci ${ciSteps}`);
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
  // Added after a sweep found the same four numbers wrong in four places, and wrong
  // DIFFERENTLY: codebase-maps said 368/324/63/44 while the in-app article said
  // 367/322/45, for a surface that had 483/426/87/57. Nobody was going to notice.
  'BMM Docs/docs/how-it-works/codebase-maps.md',
  'BMM Docs/docs/how-it-works/codebase-maps.fr.md',
  'BMM Docs/docs/reference/api.md',
  'BMM Docs/docs/reference/api.fr.md',
  'BMM Docs/docs/reference/commands.md',
  'BMM Docs/docs/reference/commands.fr.md',
];

const WANT = [
  { what: 'actions', truth: actions.size, re: /(\d{2,3}) (?:actions|actions de t\u00e2che)\b/g },
  { what: 'endpoints', truth: routes.size, re: /(\d{2,3}) (?:endpoints|routes)\b/g },
  // `outils` on its own would catch "trois outils de développement" and every other tool in
  // the prose, so both languages are anchored on the words beside the number.
  { what: 'MCP tools', truth: tools.size, re: /(\d{2,3}) (?:MCP tools|tools an AI client|atomic tools|outils MCP|outils atomiques|outils qu'un client IA)\b/g },
  { what: 'CLI commands', truth: cli.length, re: /(\d{2,3}) (?:CLI subcommands|subcommands|sous-commandes CLI|sous-commandes)\b/g },
  { what: 'registered commands', truth: cmds.size, re: /(\d{2,4})\*{0,2} (?:commands (?:are )?registered|commandes enregistr\u00e9es)\b/g },
  { what: 'import cycles', truth: baseline.cycles, re: /(\d{2,3}) (?:cycles)\b/g },
  { what: 'ci steps', truth: ciSteps, re: /(\d{2,3}) (?:steps|\u00e9tapes)\b/g },
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

// Nor is a FLOOR or a HYPOTHESIS a total. Two pages describe a parser that "refuses to emit
// fewer than 15 actions" and a reference that "would keep promising 75 actions while the app
// grew to 90" — one is a sanity bound and the other is the illustration of the very rot this
// script exists to stop. Rewriting either to today's number would destroy the sentence.
const NOT_A_TOTAL = /(?:fewer than|at least|more than|no more than|moins de|au moins|plus de|promising|promettre|promettant)\s*$/;

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
      if (NOT_A_TOTAL.test(text.slice(Math.max(0, m.index - 40), m.index))) continue;
      const line = text.slice(0, m.index).split('\n').length;
      wrong.push(`${page}:${line} — says ${said} ${what}, there are ${truth}`);
    }
  }
}

if (wrong.length) {
  console.error('✗ a page quotes a count that is no longer true:\n');
  for (const w of wrong) console.error(`  ${w}`);
  console.error(`
  ${actions.size} task actions · ${routes.size} API routes · ${tools.size} MCP tools ·
  ${cli.length} CLI commands · ${cmds.size} registered commands · ${baseline.cycles} import cycles ·
  ${ciSteps} ci steps.

  A number in prose is not checked by anything else: it compiles, it renders, and it is
  wrong. Update the page, or rewrite the sentence so it does not carry a number.
`);
  process.exit(1);
}
console.log(
  `✓ quoted counts agree with the code (${actions.size} actions, ${routes.size} routes, ` +
  `${tools.size} MCP tools, ${cli.length} CLI commands, ${cmds.size} registered commands, ` +
  `${baseline.cycles} cycles, ${ciSteps} ci steps)`,
);
