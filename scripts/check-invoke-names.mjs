// check-invoke-names.mjs — every invoke('name') must reach a command Rust actually exposes.
//
// `invoke` in this codebase is non-generic and returns Promise<any>, so TypeScript has
// nothing to check: a typo, a renamed command, or one that was written but never added to
// the handler list all compile perfectly. The failure arrives at runtime as a rejected
// promise, usually surfacing as a toast that names the command — by which point it is a bug
// report rather than a build error.
//
// This is the same shape as the repoList ReferenceError that started this: a name that does
// not exist, invisible to the compiler, discovered by clicking. Cheap to check statically,
// so it should be.
//
// It reads the generate_handler list rather than looking for `#[tauri::command]`: a command
// can exist and still be unreachable if nobody registered it, and "exists but unreachable"
// is precisely one of the bugs worth catching.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Comments are not calls. This gate read raw text, so a commented-out or merely DISCUSSED
// invoke failed the build — which is what happened the moment a file documented the shape
// `invoke('name')` in prose. Falls back to raw text when nothing is compiled yet, so the
// gate still runs (as it always did) rather than refusing to start.
let strip = (s) => s;
try {
  ({ stripComments: strip } = await import(pathToFileURL('frontend/js/features/dev/dep-graph.js').href));
} catch { /* not compiled: behave exactly as before */ }

const MAIN = 'src-tauri/src/main.rs';
const SRC = 'frontend/src';

const main = fs.readFileSync(MAIN, 'utf8');

// The handler list holds two shapes: `commands::module::name` for the bulk of them, and a
// bare `name` for the few defined in main.rs itself. Missing the second kind made this
// report three false positives on its first run.
const list = main.match(/generate_handler!\s*\[([\s\S]*?)\]/);
if (!list) { console.error(`✗ could not find generate_handler! in ${MAIN} — refusing to report success`); process.exit(2); }
const registered = new Set(
  list[1]
    .split(',')
    .map((s) => s.replace(/\/\/.*$/gm, '').trim())
    .filter(Boolean)
    .map((s) => s.split('::').pop()),
);
if (registered.size < 50) { console.error(`✗ only ${registered.size} commands parsed out of the handler list — that is too few to be right`); process.exit(2); }

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts')) files.push(p);
  }
})(SRC);

const bad = [];
for (const f of files) {
  const s = strip(fs.readFileSync(f, 'utf8'));
  for (const m of s.matchAll(/invoke\(\s*'([a-z0-9_]+)'/g)) {
    if (registered.has(m[1])) continue;
    const line = s.slice(0, m.index).split('\n').length;
    bad.push(`${f}:${line} — invoke('${m[1]}') is not in generate_handler!`);
  }
}

if (!bad.length) {
  console.log(`✓ every invoke() name reaches a registered command (${registered.size} registered)`);
  process.exit(0);
}
for (const b of bad) console.error(`✗ ${b}`);
console.error('\n  invoke() returns Promise<any>, so tsc cannot see this. It fails at runtime,');
console.error('  as a rejected promise — a bug report rather than a build error.');
process.exit(1);
