// The frontend module graph: hubs, orphans, cycles — and the tree under any module.
//
//   node scripts/dep-graph.mjs                    the report
//   node scripts/dep-graph.mjs --tree <module>    what importing that module pulls in
//   node scripts/dep-graph.mjs --check            non-zero if an orphan or cycle appeared
//
// The analysis lives in frontend/src/features/dev/dep-graph.ts and is unit-tested there;
// this file only reads the disk and prints. The tree is mod-graph's renderer, unchanged —
// "what does this actually pull in, drawn once per branch with cycles marked" is the same
// question for a mod library and for a module graph.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'frontend/src');
const JS = (p) => pathToFileURL(path.join(ROOT, 'frontend/js', p)).href;

let dep, tree;
try {
  dep = await import(JS('features/dev/dep-graph.js'));
  tree = await import(JS('features/mods/mod-graph.js'));
} catch {
  // Reading frontend/src and reporting on a graph built from a STALE frontend/js would be
  // a confident wrong answer about which file imports what.
  console.error('Compile first: npx tsc --project frontend');
  process.exit(2);
}

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    // A .d.ts declares types and emits no module. Counting one makes it permanently
    // "unreachable" — true, meaningless, and one more line between a reader and the two
    // findings that matter.
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) {
      files.push({ path: path.relative(SRC, p).replaceAll('\\', '/'), src: fs.readFileSync(p, 'utf8') });
    }
  }
})(SRC);

// The entry points, read from the HTML that loads them rather than guessed from a filename.
//
// Guessing `main.ts` found ZERO of them — this app enters through `js/ui/app.js`, declared
// in index.html — and zero entry points makes every one of the 149 modules "unreachable".
// A dead-code report that names the entire codebase is the most useless possible answer,
// and it looked exactly like a working tool.
const ENTRIES = [];
for (const html of fs.readdirSync(ROOT + '/frontend').filter((f) => f.endsWith('.html'))) {
  const text = fs.readFileSync(path.join(ROOT, 'frontend', html), 'utf8');
  for (const m of text.matchAll(/<script[^>]*\bsrc="(?:\.\/)?js\/([^"]+)\.js"/g)) {
    const id = `${m[1]}.ts`;
    if (files.some((f) => f.path === id)) ENTRIES.push(id);
  }
}
if (!ENTRIES.length) {
  console.error('No entry point found in frontend/*.html — every module would read as dead.');
  process.exit(2);
}

const { modules, unresolved } = dep.buildModuleGraph(files);
const arg = process.argv.indexOf('--tree');
if (arg >= 0) {
  const want = process.argv[arg + 1];
  const hit = modules.find((m) => m.id === want || m.id.endsWith(`/${want}`) || m.id.endsWith(`/${want}.ts`));
  if (!hit) { console.error(`No module matches "${want}".`); process.exit(2); }
  console.log(tree.renderTreeText(tree.buildTree(hit.id, modules, [])));
  process.exit(0);
}

const counts = dep.importCounts(modules);
const orphaned = dep.orphans(modules, ENTRIES);
const cycles = dep.findCycles(modules);

// In --check the lists are suppressed. Seventy-six cycle lines in a CI log is noise that
// pushes every other gate's output off the screen — the counts are the gate, the lists are
// what you run the tool without --check to read.
const QUIET = process.argv.includes('--check');

console.log(`${modules.length} modules, ${modules.reduce((n, m) => n + m.dependencies.length, 0)} edges, ${ENTRIES.length} entry point(s)`);

if (!QUIET) {
  console.log('\nMost imported — a change here is never small:');
  for (const c of counts.slice(0, 10)) console.log(`  ${String(c.importedBy).padStart(3)}  ${c.id}`);

  console.log(`\nImport cycles: ${cycles.length}`);
  // Legal in ES modules, and harmless until one member reads a binding from another at
  // evaluation time — then it is undefined at runtime with a stack pointing at the wrong file.
  for (const c of cycles) console.log(`  ${c.join(' → ')} → ${c[0]}`);

  console.log(`\nUnreachable from an entry point: ${orphaned.length}`);
  for (const o of orphaned) console.log(`  ${o}`);
}

if (unresolved.length && !QUIET) {
  // This analyser failing, not the code being broken — tsc would have refused a real one.
  console.log(`\nRelative imports this could not resolve: ${unresolved.length}`);
  for (const u of unresolved.slice(0, 10)) console.log(`  ${u.from} → ${u.spec}`);
}

if (process.argv.includes('--check')) {
  // A ratchet, not a zero. This codebase has 76 import cycles and 5 unreachable modules
  // today; a gate demanding zero on day one is a gate somebody switches off in week two.
  // This one fails when the number GROWS, and the baseline is committed so lowering it is
  // a deliberate edit somebody reviews.
  const file = path.join(import.meta.dirname, 'dep-graph.baseline.json');
  const now = { orphans: orphaned.length, cycles: cycles.length };
  if (process.argv.includes('--update')) {
    fs.writeFileSync(file, `${JSON.stringify(now, null, 2)}\n`);
    console.log(`\nbaseline written: ${JSON.stringify(now)}`);
    process.exit(0);
  }
  let base;
  try { base = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { console.error(`\nNo baseline. Run: node scripts/dep-graph.mjs --check --update`); process.exit(2); }

  const grew = Object.keys(now).filter((k) => now[k] > base[k]);
  if (grew.length) {
    for (const k of grew) console.error(`\n${k}: ${base[k]} → ${now[k]} — this change added ${now[k] - base[k]}.`);
    process.exit(1);
  }
  const shrank = Object.keys(now).filter((k) => now[k] < base[k]);
  // Said, not enforced: a run that cleans some up should not fail, but the baseline going
  // stale upward is how a ratchet quietly stops ratcheting.
  for (const k of shrank) console.log(`\n${k}: ${base[k]} → ${now[k]} — lower the baseline (--check --update).`);
  console.log(`\ndep-graph OK (${JSON.stringify(now)})`);
}
