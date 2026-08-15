// The frontend→Rust API surface: who calls what, what has no caller, what is dynamic.
//
//   node scripts/api-map.mjs              the report
//   node scripts/api-map.mjs --module x   every command one frontend module calls
//
// The analysis lives in frontend/src/features/dev/api-map.ts and is unit-tested there; this
// only reads the disk and prints. check-invoke-names.mjs remains the GATE (an invoke() that
// reaches nothing fails the build); this is the map.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'frontend/src');

let api;
try { api = await import(pathToFileURL(path.join(ROOT, 'frontend/js/features/dev/api-map.js')).href); }
catch { console.error('Compile first: npx tsc --project frontend'); process.exit(2); }

const handlers = api.parseHandlerList(fs.readFileSync(path.join(ROOT, 'src-tauri/src/main.rs'), 'utf8'));
// Refusing to report on a list that failed to parse: zero registered commands would make
// every invoke() "unregistered" and every module look broken.
if (handlers.length < 50) {
  console.error(`Only ${handlers.length} commands parsed from generate_handler! — too few to be right.`);
  process.exit(2);
}

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

const map = api.buildApiMap(files, handlers);

const only = process.argv.indexOf('--module');
if (only >= 0) {
  const want = process.argv[only + 1];
  const hit = map.byCaller.find((c) => c.module === want || c.module.endsWith(`/${want}`) || c.module.endsWith(`/${want}.ts`));
  if (!hit) { console.error(`No frontend module matches "${want}", or it calls no command.`); process.exit(2); }
  console.log(`${hit.module} → ${hit.commands.length} command(s)`);
  for (const c of hit.commands) console.log(`  ${c}`);
  process.exit(0);
}

const c = map.counts;
console.log(`${c.registered} commands registered · ${c.called} called from the frontend · ${map.byCaller.length} modules call at least one\n`);

console.log('Frontend modules by how much of the Rust API they touch:');
for (const b of map.byCaller.slice(0, 12)) console.log(`  ${String(b.commands.length).padStart(3)}  ${b.module}`);

console.log('\nRust modules, and how much of each the UI actually uses:');
for (const r of map.byRustModule) console.log(`  ${String(r.called).padStart(3)}/${String(r.total).padEnd(3)} ${r.module}`);

// Deliberately NOT called "unused". The MCP server, the CLI and bmm:// deeplinks all reach
// commands the UI never touches; this cannot tell an MCP-only command from a forgotten one,
// and saying "unused" would invite deleting something the CLI depends on.
console.log(`\nNo frontend caller — reached by MCP/CLI/deeplinks, or by nothing (this cannot tell which): ${c.noFrontendCaller}`);
for (const n of map.noFrontendCaller) console.log(`  ${n}`);

if (c.dynamic) {
  // The honest measure of this tool's own coverage.
  console.log(`\ninvoke(variable) — invisible to every static check, including this one: ${c.dynamic}`);
  for (const d of map.dynamic) console.log(`  ${d.module}:${d.line}`);
}

if (c.unregistered) {
  console.log(`\nCALLED AND NOT REGISTERED — a rejected promise at runtime: ${c.unregistered}`);
  for (const u of map.unregistered) console.log(`  ${u.module}:${u.line} → ${u.command}`);
  process.exit(1);
}
