#!/usr/bin/env node
// The CLI reference, against the clap enum it describes.
//
// The same binary that serves the MCP tools is a 62-command CLI, and until this check was
// written it had NO reference page at all: `reference/mcp.md` documents 69 tools and never
// mentions that the executable takes subcommands, and the only place any of them appeared
// was two `bmm plugin-asset` lines inside a feature page.
//
// So the page is new, and it starts out with the thing the MCP page had to be given later:
// something that fails when it stops being true. Three questions, per language:
//
//   · every command in the enum is on the page — a command nobody documents is a command
//     nobody runs;
//   · every ARGUMENT is named. A command that takes `--password` and does not say so is not
//     half-documented, it is documented wrong: somebody reads the row, runs it against a
//     protected repo, and gets a failure the page told them nothing about;
//   · the count the page states is the real one. Both language editions say it, and a
//     translated page keeps whatever number it was translated from, which is exactly how
//     these numbers rot.
//
//   node scripts/check-cli-reference.mjs           report
//   node scripts/check-cli-reference.mjs --check   exit 1 on any disagreement
import { readFileSync, existsSync } from 'node:fs';
import { cliTree } from './cli-tree.mjs';

const SRC = 'src-tauri/src/extra_tools/mcp_server.rs';
const PAGES = ['BMM Docs/docs/reference/cli.md', 'BMM Docs/docs/reference/cli.fr.md'];

if (!existsSync(SRC)) { console.error(`✗ ${SRC} is missing — refusing to report success`); process.exit(2); }
const tree = cliTree(readFileSync(SRC, 'utf8'));

if (tree.length < 30) {
  // The parser is the whole check. If the enum is renamed or restructured, this must fail
  // loudly rather than report that a page listing nothing is complete.
  console.error(`✗ parsed ${tree.length} subcommand(s) from ${SRC} — too few to be right, so this check cannot be trusted`);
  process.exit(2);
}
const args = tree.reduce((n, c) => n + c.args.length, 0);
if (args < 30) {
  console.error(`✗ parsed ${args} argument(s) — the #[arg] shape moved and this check no longer reads it`);
  process.exit(2);
}

// Arguments a person never types, per command. `serve` is the MCP entry point and takes
// none; nothing is exempt today, and the list exists so that exempting one is a decision
// somebody writes down rather than a row quietly left off a table.
const INTERNAL_ARG = {};

let bad = 0;
for (const page of PAGES) {
  if (!existsSync(page)) { console.error(`✗ ${page} is missing`); bad++; continue; }
  const doc = readFileSync(page, 'utf8');

  const missing = tree.filter((c) => !doc.includes(`\`${c.name}\``)).map((c) => c.name);
  const partial = [];
  for (const c of tree) {
    if (!doc.includes(`\`${c.name}\``)) continue;
    // The row runs from this command's name to the next table row, so a neighbour's
    // `--password` cannot stand in for this one's.
    const at = doc.indexOf(`| \`${c.name}\``);
    const row = at < 0 ? doc : doc.slice(at, doc.indexOf('\n|', at + 1) < 0 ? doc.length : doc.indexOf('\n|', at + 1));
    const hidden = INTERNAL_ARG[c.name] || [];
    const gap = c.args
      .filter((a) => !hidden.includes(a.name))
      // clap renames a field with `#[arg(long = "type")]`; the page writes the wire name.
      .filter((a) => !row.includes(`\`${a.flag ? '--' : '<'}${a.name}`) && !row.includes(`\`${a.name}\``))
      .map((a) => a.name);
    if (gap.length) partial.push(`${c.name} — takes ${gap.join(', ')}, and the row never names ${gap.length > 1 ? 'them' : 'it'}`);
  }

  // "62 of them." / "62 au total." — the sentence above the tables, in both editions.
  // `\s+` and not a space: both editions wrap these sentences, so the number and the
  // words that identify it are routinely on different lines.
  const claims = [...doc.matchAll(/(\d+)(?=\s+(?:of them\.|au total\.|commands from a terminal|commandes utilisables))/g)].map((m) => Number(m[1]));
  const countProblems = [];
  if (claims.length < 2) countProblems.push(`found ${claims.length} count claim(s), expected at least 2 — the wording moved and this check no longer reads it`);
  const wrongCount = [...new Set(claims)].filter((n) => n !== tree.length);
  if (wrongCount.length) countProblems.push(`claims ${wrongCount.join('/')} command(s); the enum declares ${tree.length}`);

  if (missing.length || partial.length || countProblems.length) {
    bad++;
    console.error(`✗ ${page}:`);
    for (const m of missing) console.error(`    MISSING   ${m}`);
    for (const p of partial) console.error(`    PARTIAL   ${p}`);
    for (const c of countProblems) console.error(`    COUNT     ${c}`);
  } else {
    console.log(`✓ ${page} — all ${tree.length} command(s) and ${args} argument(s)`);
  }
}

if (bad) {
  console.error('');
  console.error('  An undocumented command is one nobody runs, and an unnamed argument is worse:');
  console.error('  the row reads as the whole story. Add it to the page.');
  if (process.argv.includes('--check')) process.exit(1);
}
