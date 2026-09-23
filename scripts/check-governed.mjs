#!/usr/bin/env node
// check-governed — every place in the Rust app that starts heavy work outside the resource
// governor is either migrated to it or listed here with a reason.
//
// WHY THIS EXISTS
//
// The governor (src-tauri/src/governor, PLAN-BMM-RESOURCES-2026.md) only works if heavy work
// goes THROUGH it: a copy loop, a rayon pool or a hashing thread that nobody routed there keeps
// running at full speed while the dashboard says "Silent". Migrating ~60 sites takes several
// phases (G3a / G3b / G3c), and the risk in between is a NEW site added the old way, which
// nothing would notice. So this counts the constructs that start heavy work, per file, and
// compares them with scripts/governed-allowlist.json:
//
//   · a file or construct that is not listed, or more occurrences than listed → a new
//     ungoverned site: route it through the governor or list it with a reason;
//   · fewer occurrences than listed → the list is looser than the code: lower it (a count that
//     only ever goes up hides the next addition);
//   · --strict (phase G7): any entry whose reason still says TODO fails.
//
// Comments are stripped before counting, so a doc comment naming `par_iter` is not a site.
//
// Usage: node scripts/check-governed.mjs [--strict] [--init]
//   --init writes the allowlist from the current code with a TODO label per file (only when
//   the file does not exist yet).

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src-tauri', 'src');
const LIST = join(ROOT, 'scripts', 'governed-allowlist.json');
const PATTERNS = ['par_iter', 'thread::spawn', 'spawn_blocking', 'fs::copy', 'fs_extra::', 'ThreadPoolBuilder', 'update_mmap', 'io::copy'];

const strict = process.argv.includes('--strict');
const init = process.argv.includes('--init');

/** Line comments and block comments out; string contents are left alone (good enough here). */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'])\/\/.*$/gm, '$1');

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== 'governor') walk(p, out); }
    else if (n.endsWith('.rs')) out.push(p);
  }
  return out;
}

const counts = {};
for (const f of walk(SRC)) {
  const code = stripComments(readFileSync(f, 'utf8'));
  const rel = relative(join(ROOT, 'src-tauri'), f).replace(/\\/g, '/');
  for (const pat of PATTERNS) {
    const n = code.split(pat).length - 1;
    if (n) (counts[rel] ||= {})[pat] = n;
  }
}

// The phase that migrates each file (PLAN-BMM-RESOURCES-2026.md §2.1); anything else is a
// small or one-shot operation to be confirmed as exempt in G7.
const PHASE = {
  'src/commands/mods.rs': 'TODO(G3a/G3b): deploy, install, download, hashing',
  'src/fs_utils.rs': 'TODO(G2/G3b): the copy engine and the hash pool',
  'src/archive.rs': 'TODO(G3c): extraction', 'src/commands/mod_archive.rs': 'TODO(G3c): (re)archiving',
  'src/commands/zipping.rs': 'TODO(G3c): compression', 'src/commands/repo.rs': 'TODO(G3c): repo export and sync',
  'src/commands/catalog_bundle.rs': 'TODO(G3c)', 'src/commands/modlist.rs': 'TODO(G3c)',
  'src/commands/image.rs': 'TODO(G3c): image decoding', 'src/commands/modpack.rs': 'TODO(G3a)',
  'src/commands/verify.rs': 'TODO(G3b): hashing', 'src/commands/mod_order.rs': 'TODO(G3b)',
  'src/commands/format_check.rs': 'TODO(G3b)', 'src/commands/mapper.rs': 'TODO(G3b)',
  'src/main.rs': 'TODO(G1): the global rayon pool',
};

if (init) {
  if (existsSync(LIST)) { console.error('✗ scripts/governed-allowlist.json exists — edit it, --init only creates it'); process.exit(1); }
  const out = {};
  for (const [file, pats] of Object.entries(counts).sort()) {
    out[file] = {};
    for (const [pat, n] of Object.entries(pats)) out[file][pat] = { count: n, why: PHASE[file] || 'TODO(G7): triage; small or one-shot, confirm exempt' };
  }
  writeFileSync(LIST, JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${relative(ROOT, LIST)} (${Object.keys(out).length} files)`);
  process.exit(0);
}

if (!existsSync(LIST)) { console.error('✗ scripts/governed-allowlist.json is missing — refusing to report success'); process.exit(2); }
const allow = JSON.parse(readFileSync(LIST, 'utf8'));
const problems = [];
let todo = 0;
for (const [file, pats] of Object.entries(counts)) {
  for (const [pat, n] of Object.entries(pats)) {
    const a = allow[file]?.[pat];
    if (!a) problems.push(`  new: ${file} uses ${pat} ×${n}; route it through the governor or list it with a reason`);
    else if (n > a.count) problems.push(`  new: ${file} uses ${pat} ×${n}, ${a.count} listed; route the new one through the governor or list it`);
    else if (n < a.count) problems.push(`  loose: ${file} ${pat} is listed ×${a.count} but used ×${n}; lower the count`);
  }
}
for (const [file, pats] of Object.entries(allow)) {
  for (const [pat, a] of Object.entries(pats)) {
    if (!counts[file]?.[pat]) problems.push(`  gone: ${file} no longer uses ${pat}; remove the entry`);
    if (/TODO/.test(a.why || '')) todo++;
    if (!String(a.why || '').trim()) problems.push(`  ${file} ${pat}: an entry needs a reason`);
  }
}
if (strict && todo) problems.push(`  --strict: ${todo} entr${todo === 1 ? 'y still says' : 'ies still say'} TODO`);

if (problems.length) {
  console.error('✗ heavy work outside the resource governor:\n' + problems.join('\n'));
  process.exit(1);
}
const sites = Object.values(counts).reduce((a, p) => a + Object.values(p).reduce((x, y) => x + y, 0), 0);
console.log(`✓ governed: ${sites} site(s) outside the governor, all listed${todo ? ` (${todo} still marked TODO for their phase)` : ''}`);
