// The scheduler's action registry, exported for the MCP server and the CLI.
//
// `bmm_create_schedule`'s description told agents to call `bmm_list_actions` — a tool that
// did not exist. This is the extract-and-diff failure mode in tool form: a name that reads
// fine and points at nothing. The tool needs a machine-readable list of action types, and the
// only source of truth is ACTION_TYPES in scheduler.ts; hand-copying it into Rust would be a
// second registry, free to drift with every action added.
//
// So this script EXTRACTS it. Rust embeds the result with include_str!, and `--check` runs in
// CI: adding an action without regenerating fails the build instead of silently shipping an
// MCP list that lies about what the scheduler can do.
//
// Run:            node scripts/gen-mcp-actions.mjs
// Verify (CI):    node scripts/gen-mcp-actions.mjs --check

import fs from 'node:fs';

const SRC = 'frontend/src/features/settings/scheduler.ts';
const OUT = 'src-tauri/src/mcp/actions.gen.json';

const src = fs.readFileSync(SRC, 'utf8');
const start = src.indexOf('const ACTION_TYPES');
if (start < 0) { console.error('✗ ACTION_TYPES not found in scheduler.ts'); process.exit(1); }
const end = src.indexOf('];', start);
const block = src.slice(start, end);

// One entry per object literal. The registry is flat `{ v, label, needs?, group }` literals,
// which is what makes this extraction safe; anything fancier would fail loudly below.
const entries = [];
// Escaped quotes included: `[^']*` stops at the backslash in a label like
// `Rebuild a repo's manifest`, so that entry does not match and the count check below
// fails — correctly refusing, but over a shape that is perfectly legal JavaScript.
const re = /\{\s*v:\s*'((?:[^'\\]|\\.)+)'\s*,\s*label:\s*'((?:[^'\\]|\\.)*)'\s*(?:,\s*needs:\s*'([^']+)')?\s*,\s*group:\s*'([^']+)'\s*\}/g;
let m;
while ((m = re.exec(block))) {
  entries.push({ type: m[1], label: m[2], needs: m[3] || null, group: m[4] });
}

// The count check is the drift alarm: a registry entry the regex cannot read is an entry the
// export silently drops, and a dropped action is exactly the lie this file exists to prevent.
const declared = (block.match(/\bv:\s*'/g) || []).length;
if (entries.length !== declared) {
  console.error(`✗ extracted ${entries.length} actions but scheduler.ts declares ${declared} — an entry's shape defeated the extractor; fix the extractor, not the registry`);
  process.exit(1);
}

const json = JSON.stringify({ actions: entries }, null, 2) + '\n';

// Content, not bytes. Git checks these files out with CRLF on Windows while the generator
// writes LF, so a byte comparison reports "stale" on a clean tree with nothing wrong — and a
// gate that cries wolf on checkout is one people learn to re-run until it agrees.
const sameText = (a, b) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');

if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (!sameText(cur, json)) {
    console.error('✗ src-tauri/src/mcp/actions.gen.json is stale — run: node scripts/gen-mcp-actions.mjs');
    process.exit(1);
  }
  console.log(`✓ mcp actions.gen.json is fresh (${entries.length} actions)`);
} else {
  fs.writeFileSync(OUT, json);
  console.log(`wrote ${OUT} (${entries.length} actions)`);
}
