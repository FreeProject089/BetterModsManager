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

if (problems.length) {
  console.error('✗ MCP tools:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(`✓ MCP tools OK (${declSet.size} declared, dispatched, no duplicates)`);
