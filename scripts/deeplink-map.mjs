// Every bmm:// action the app actually handles, and the parameters each one reads.
//
//   node scripts/deeplink-map.mjs           print the table
//   node scripts/deeplink-map.mjs --json    write frontend/Lang/../deeplinks.json
//   node scripts/deeplink-map.mjs --check   fail if the committed table has drifted
//
// This exists because the link builder in BCWEB's /dev/tools offered 4 of them, hand-typed,
// in a different repository. A builder that offers an action the app does not handle produces
// a link that opens BMM and does nothing — worse than no builder, because it looks like the
// app is broken. And a hand-copied list in another repo is wrong the first time somebody adds
// a deeplink here.
//
// Derived from deep_link_manager.ts, so the table cannot describe an app that no longer
// exists. The check makes drift a build failure rather than a support ticket.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'frontend/src/core/deep_link_manager.ts');
const OUT = path.join(ROOT, 'frontend/deeplinks.json');

/**
 * One entry per action, with the parameters read inside its block.
 *
 * Handlers look like `if (action === 'a' || action === 'b') { … params.get('id') … }`, so a
 * block is everything up to the next `if (action ===`. Grouped actions share their block and
 * therefore share its parameters, which is true of the code: mod/enable and mod/disable read
 * the same id.
 */
export function parseDeeplinks(src) {
  const text = String(src);

  // Reads that live in a SHARED HELPER, keyed by function name.
  //
  // A handler that calls `applySourceAccess(url, parsedUrl.searchParams)` reads `password`
  // and `key` as surely as if the lines were inline — and this parser saw neither, because it
  // only looks inside the block. The map then said `catalog/follow` takes `type` and `url`,
  // the check compared that to itself and passed, and the app's own deeplink reference
  // quietly stopped mentioning two parameters that work.
  //
  // Nothing failed anywhere. That is the point of doing it here rather than remembering.
  const helpers = new Map();
  for (const m of text.matchAll(/(?:async\s+)?function\s+(\w+)\s*\([^)]*URLSearchParams[^)]*\)\s*(?::[^{]*)?\{/g)) {
    // The body, to its closing brace at column 0 — these are top-level declarations.
    const from = m.index + m[0].length;
    const end = text.indexOf('\n}', from);
    const body = text.slice(from, end === -1 ? from + 4000 : end);
    const reads = [...new Set([...body.matchAll(/\.get\(\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*\)/g)].map((x) => x[1]))];
    if (reads.length) helpers.set(m[1], reads);
  }
  // Every `if (action === …)` position, in order.
  const heads = [...text.matchAll(/if\s*\(\s*action\s*===/g)].map((m) => m.index);
  const out = [];
  for (let i = 0; i < heads.length; i++) {
    const block = text.slice(heads[i], heads[i + 1] ?? text.length);
    // The condition is everything up to the opening brace of the block.
    const brace = block.indexOf('{');
    const cond = brace === -1 ? block : block.slice(0, brace);
    const actions = [...cond.matchAll(/action\s*===\s*'([^']+)'/g)].map((m) => m[1]);
    if (!actions.length) continue;
    const own = [...block.matchAll(/\.get\(\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*\)/g)].map((m) => m[1]);
    // …plus whatever a helper this block calls reads on its behalf.
    const viaHelper = [];
    for (const [name, reads] of helpers) {
      if (new RegExp(`\\b${name}\\s*\\(`).test(block)) viaHelper.push(...reads);
    }
    const params = [...new Set([...own, ...viaHelper])];
    for (const a of actions) out.push({ action: a, params });
  }
  // Deduplicated by action: a few are handled in more than one place (repo/update appears
  // twice), and the union of their parameters is what a builder must offer.
  const merged = new Map();
  for (const e of out) {
    const prev = merged.get(e.action);
    merged.set(e.action, prev ? { action: e.action, params: [...new Set([...prev.params, ...e.params])] } : e);
  }
  return [...merged.values()].sort((a, b) => a.action.localeCompare(b.action));
}

const table = parseDeeplinks(fs.readFileSync(SRC, 'utf8'));

// A parser that silently matched nothing would emit an empty table, and an empty table is a
// builder that offers no actions — which reads as "BMM has no deeplinks".
if (table.length < 15) {
  console.error(`✗ only ${table.length} actions parsed from deep_link_manager.ts — too few to be right`);
  process.exit(2);
}

if (process.argv.includes('--json')) {
  fs.writeFileSync(OUT, `${JSON.stringify(table, null, 2)}\n`);
  console.log(`wrote ${path.relative(ROOT, OUT)} (${table.length} actions)`);
  process.exit(0);
}

if (process.argv.includes('--check')) {
  let committed;
  try { committed = JSON.parse(fs.readFileSync(OUT, 'utf8')); }
  catch { console.error(`✗ ${path.relative(ROOT, OUT)} is missing — run: node scripts/deeplink-map.mjs --json`); process.exit(1); }
  const now = JSON.stringify(table);
  if (JSON.stringify(committed) !== now) {
    const a = new Set(committed.map((x) => x.action));
    const b = new Set(table.map((x) => x.action));
    const added = [...b].filter((x) => !a.has(x));
    const gone = [...a].filter((x) => !b.has(x));
    console.error('✗ deeplinks.json no longer matches deep_link_manager.ts');
    if (added.length) console.error(`  new: ${added.join(', ')}`);
    if (gone.length) console.error(`  removed: ${gone.join(', ')}`);
    if (!added.length && !gone.length) console.error('  the parameters of an existing action changed');
    console.error('  run: node scripts/deeplink-map.mjs --json');
    process.exit(1);
  }
  console.log(`✓ deeplinks.json matches the app (${table.length} actions)`);
  process.exit(0);
}

console.log(`${table.length} bmm:// actions\n`);
for (const e of table) console.log(`  ${e.action.padEnd(24)} ${e.params.join(', ') || '(no parameters)'}`);
