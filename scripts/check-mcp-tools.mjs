// check-mcp-tools — every MCP tool is declared once, dispatched once, and the two agree.
//
// Written after nearly shipping a second `bmm_list_schedules`. One already existed, reading
// data.json directly so it answers with BMM closed; the new one went through the HTTP API
// and needed the app running. Both compiled. Both were registered. `list_tools` would have
// returned the name twice, and the `match` would have silently used whichever arm came
// first — the worse one.
//
// Nothing had an opinion about it: Rust allows two entries in a `vec![]` and warns about an
// unreachable match arm only when the patterns are literally identical, which these were,
// buried in a 1300-line file among sixty-five siblings. It was caught by counting by hand,
// which is not a thing that happens twice.
//
// Three questions, and they fail differently on purpose:
//   · declared twice   → the client sees a name twice and the dispatch is ambiguous
//   · declared, never dispatched → a tool that errors when called
//   · dispatched, never declared → dead code no client can reach
//
// And a fourth, which is a different KIND of wrong. `bmm_create_schedule` listed its trigger
// types in prose, and the prose said 'daily' and 'weekly' — names that have never existed —
// while omitting nine that do, `interval` and `dailyAt` and `watchFile` among them. Nothing
// was broken in the ordinary sense: it compiled, it dispatched, it was declared exactly once.
//
// But a tool description is not a comment. It is the only thing a model reads before calling
// the tool, so a wrong one is a wrong instruction: an agent asked for a nightly task wrote
// {type:'daily'}, the runner did not recognise it, and the task simply never fired. Silent,
// and blamed on the scheduler.
//
// So: every variant of the Trigger union must appear in that description. Prose is checked
// against the type, because the type is the thing that is true.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src-tauri/src/mcp/server.rs');

if (!existsSync(SRC)) {
  console.error(`✗ ${SRC} is missing — refusing to report success`);
  process.exit(2);
}
const src = readFileSync(SRC, 'utf8');

// `Tool::new("bmm_x", …)` — the declaration the server hands to a client.
const declared = [...src.matchAll(/Tool::new\(\s*"(bmm_[a-z0-9_]+)"/g)].map((m) => m[1]);
// `"bmm_x" => …` — the match arm that runs when one is called.
const dispatched = [...src.matchAll(/"(bmm_[a-z0-9_]+)"\s*=>/g)].map((m) => m[1]);

if (declared.length < 20 || dispatched.length < 20) {
  // The regexes are the whole check. If either stops matching — the macro is renamed, the
  // dispatch becomes a map — this must fail loudly rather than report that nothing is wrong.
  console.error(
    `✗ read ${declared.length} declaration(s) and ${dispatched.length} dispatch arm(s) — too few to be right, so this check cannot be trusted`,
  );
  process.exit(2);
}

const dupes = (list) => {
  const seen = new Map();
  for (const n of list) seen.set(n, (seen.get(n) || 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([k, n]) => `${k} (×${n})`);
};

const problems = [];
const dupDecl = dupes(declared);
const dupDisp = dupes(dispatched);
if (dupDecl.length) problems.push(`declared more than once: ${dupDecl.join(', ')}`);
if (dupDisp.length) problems.push(`dispatched more than once: ${dupDisp.join(', ')}`);

const declSet = new Set(declared);
const dispSet = new Set(dispatched);
const noArm = [...declSet].filter((n) => !dispSet.has(n));
const noDecl = [...dispSet].filter((n) => !declSet.has(n));
if (noArm.length) problems.push(`declared but never dispatched (errors when called): ${noArm.join(', ')}`);
if (noDecl.length) problems.push(`dispatched but never declared (no client can reach it): ${noDecl.join(', ')}`);

// ── The trigger vocabulary in `bmm_create_schedule`'s description ──────────
//
// Read from the TS union rather than a list kept here: a second list is the same failure one
// level up, and it goes stale the day somebody adds a trigger.
const SCHED = join(ROOT, 'frontend/src/features/settings/scheduler.ts');
if (!existsSync(SCHED)) {
  console.error(`\u2717 ${SCHED} is missing \u2014 refusing to report success`);
  process.exit(2);
}
const schedSrc = readFileSync(SCHED, 'utf8');
const union = schedSrc.slice(schedSrc.indexOf('type Trigger ='));
// Up to the `;` that closes the union \u2014 the doc comments inside it contain no semicolons at
// the start of a line, but the member fields do, so cut at the first `};` instead.
const unionBody = union.slice(0, union.indexOf('};') + 1);
const triggers = [...unionBody.matchAll(/\{\s*type:\s*'([a-zA-Z]+)'/g)].map((m) => m[1]);

if (triggers.length < 8) {
  console.error(
    `\u2717 read ${triggers.length} trigger type(s) from scheduler.ts \u2014 too few to be right, so this check cannot be trusted`,
  );
  process.exit(2);
}

// The description is the second argument of `Tool::new("bmm_create_schedule", "...")`.
const declBlock = src.slice(src.indexOf('"bmm_create_schedule",'));
const descEnd = declBlock.indexOf('std::sync::Arc::new');
const desc = descEnd > 0 ? declBlock.slice(0, descEnd) : '';
const missing = triggers.filter((tt) => !desc.includes(`'${tt}'`));
if (missing.length) {
  problems.push(
    `bmm_create_schedule's description never names these trigger type(s), so an agent cannot use them: ${missing.join(', ')}`,
  );
}
// And the reverse: a name in the prose that the union does not have is what shipped for
// months. It reads as available and produces a task that never fires.
const known = new Set(triggers);
const invented = [...new Set([...desc.matchAll(/\{type:'([a-zA-Z]+)'/g)].map((m) => m[1]))]
  .filter((tt) => !known.has(tt));
if (invented.length) {
  problems.push(
    `bmm_create_schedule's description offers trigger type(s) that do not exist: ${invented.join(', ')}`,
  );
}

// ── The reference page, against the server ───────────────────────────────
//
// reference/mcp.md says its tables are generated from the `Tool::new(...)` declarations
// "rather than written by hand, because N tools with their parameters is exactly the list
// that rots the first time someone adds one". It then rotted: it claimed 63 while the server
// declared 68, and five tools an agent could call appeared nowhere on the page.
//
// A claim about being generated is not a generator. This is the generator's missing half.
const DOCS = ['BMM Docs/docs/reference/mcp.md', 'BMM Docs/docs/reference/mcp.fr.md'];
for (const rel of DOCS) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) {
    console.error(`\u2717 ${rel} is missing \u2014 refusing to report success`);
    process.exit(2);
  }
  const doc = readFileSync(p, 'utf8');
  const undocumented = [...declSet].filter((n) => !doc.includes(`\`${n}\``));
  if (undocumented.length) {
    problems.push(`${rel} never mentions: ${undocumented.join(', ')}`);
  }
  // Every number the page states about how many tools there are. Three sentences say it, and
  // the last time they were wrong they were wrong together.
  const claims = [...doc.matchAll(/(\d+)(?= of them\.| au total\.| tools with their| outils avec leurs)/g)]
    .map((m) => Number(m[1]));
  const both = [...doc.matchAll(/(?:sets are|ensembles font) (\d+)/g)].map((m) => Number(m[1]));
  const all = [...claims, ...both];
  if (all.length < 3) {
    problems.push(`${rel}: found ${all.length} tool-count claim(s), expected at least 3 \u2014 the wording moved and this check no longer reads it`);
  }
  const wrong = [...new Set(all)].filter((n) => n !== declSet.size);
  if (wrong.length) {
    problems.push(`${rel} claims ${wrong.join('/')} tool(s); the server declares ${declSet.size}`);
  }
}

// ── every parameter says what it is ──
//
// A tool description is the only thing a model reads before calling the tool — that is the
// argument the trigger-type check above already makes. It applies one level down: `profile_id`
// with no description leaves "which id, out of what" to a guess, and a guess that happens to
// parse fails the same way a wrong trigger type did, one level quieter.
//
// Thirty-four tools had properties with no `description` at all when this was written.
//
// The schema's own keys are not properties: `type`, `items` and `enum` appear inside one.
for (const m of src.matchAll(/Tool::new\(\s*"(bmm_[a-z0-9_]+)",/g)) {
  const start = m.index;
  const next = src.indexOf('Tool::new(', start + 10);
  const block = src.slice(start, next < 0 ? src.length : next);
  const props = block.match(/"properties"\s*:\s*\{([\s\S]*)/);
  if (!props) continue;
  // Each `"name": { … }` at the top level of that object, and whether it carries a description.
  for (const pm of props[1].matchAll(/"(\w+)"\s*:\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
    const [, prop, body] = pm;
    if (['type', 'items', 'enum', 'properties', 'required'].includes(prop)) continue;
    if (!/"type"\s*:/.test(body)) continue;          // not a property schema
    if (/"description"\s*:/.test(body)) continue;
    problems.push(`${m[1]}.${prop} has no description — it is the only thing a model reads before sending a value`);
  }
}

if (problems.length) {
  console.error('✗ MCP tools:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(`✓ MCP tools OK (${declSet.size} declared, dispatched, no duplicates)`);
