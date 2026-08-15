// Which tests exercise the current change, and which parts of it nothing covers.
//
//   node scripts/test-impact.mjs                 uncommitted changes vs HEAD
//   node scripts/test-impact.mjs --since <ref>   everything since a commit/branch
//   node scripts/test-impact.mjs --run           run exactly the tests it selected
//
// The second list is the point. This repo has 14 test files for 149 modules, so the answer
// to "did I break anything" is usually "no test would tell you either way", and that is
// worth knowing before shipping rather than after.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'frontend/src');

let dep, ti;
try {
  dep = await import(pathToFileURL(path.join(ROOT, 'frontend/js/features/dev/dep-graph.js')).href);
  ti = await import(pathToFileURL(path.join(ROOT, 'frontend/js/features/dev/test-impact.js')).href);
} catch { console.error('Compile first: npx tsc --project frontend'); process.exit(2); }

const since = process.argv.indexOf('--since');
// --name-only over the same range git would show a reviewer, so "what changed" here means
// the same thing it means everywhere else.
const args = since >= 0
  ? ['diff', '--name-only', `${process.argv[since + 1]}...HEAD`]
  : ['diff', '--name-only', 'HEAD'];
let changedRaw;
// stderr is dropped: git emits a CRLF warning per file on this repo, and dozens of those
// between the command and its answer is how a useful tool stops being read.
const GIT = { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
try { changedRaw = execFileSync('git', args, GIT); }
catch (e) { console.error(`git ${args.join(' ')} failed: ${String(e.message).slice(0, 160)}`); process.exit(2); }

// Untracked files count as changed too: a brand-new module is exactly the case where "no
// test covers this" is the answer somebody needs.
if (since < 0) {
  try { changedRaw += execFileSync('git', ['ls-files', '--others', '--exclude-standard'], GIT); }
  catch { /* the diff alone is still an answer */ }
}

const changed = [...new Set(changedRaw.split('\n').map((s) => s.trim()).filter(Boolean))]
  .map((p) => (p.startsWith('frontend/src/') ? p.slice('frontend/src/'.length) : p));

if (!changed.length) { console.log('Nothing changed.'); process.exit(0); }

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) {
      files.push({ path: path.relative(SRC, p).replaceAll('\\', '/'), src: fs.readFileSync(p, 'utf8') });
    }
  }
})(SRC);
const { modules } = dep.buildModuleGraph(files);

const testDir = path.join(ROOT, 'tests');
const tests = fs.readdirSync(testDir).filter((f) => f.endsWith('.test.mjs'))
  .map((f) => ({ path: `tests/${f}`, src: fs.readFileSync(path.join(testDir, f), 'utf8') }));

const imp = ti.buildImpact(modules, tests, changed);

console.log(`${imp.counts.changed} changed path(s) · ${imp.counts.tests} test files\n`);

console.log(`Tests that reach your change: ${imp.run.length}`);
for (const r of imp.run) console.log(`  ${r.test}  (${r.covers.length}: ${r.covers.slice(0, 3).join(', ')}${r.covers.length > 3 ? '…' : ''})`);

// The list worth reading. Structural reachability over-reports coverage — a test that
// imports A does not necessarily exercise everything A imports — so a file listed here is
// genuinely untested, not merely maybe-untested.
console.log(`\nChanged modules NO test reaches: ${imp.uncovered.length}`);
for (const u of imp.uncovered) console.log(`  ${u}`);

if (imp.notModules.length) {
  // Said out loud so a short "run" list is not read as "your change is covered". Rust, CSS,
  // HTML and docs are most of what changes here and none of it is in the module graph.
  console.log(`\nChanged and outside the module graph (Rust, CSS, HTML, docs — not analysed): ${imp.notModules.length}`);
  for (const n of imp.notModules.slice(0, 12)) console.log(`  ${n}`);
}

if (process.argv.includes('--run')) {
  if (!imp.run.length) { console.log('\nNo test selected — nothing to run.'); process.exit(0); }
  console.log(`\n$ node --test ${imp.run.map((r) => r.test).join(' ')}\n`);
  try { execFileSync('node', ['--test', ...imp.run.map((r) => r.test)], { cwd: ROOT, stdio: 'inherit' }); }
  catch { process.exit(1); }
}
