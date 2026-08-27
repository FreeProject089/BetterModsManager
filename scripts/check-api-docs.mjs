#!/usr/bin/env node
// Every API reference, against the router.
//
// There are FOUR of them: `BMM Docs/docs/reference/api{,.fr}.md` and
// `Update/Documentation/API_Reference_{EN,FR}.md`. The second pair ships inside the app —
// `Update` is a bundle resource — and calls itself "the single source of truth for everything
// that can be driven programmatically".
//
// Four hand-maintained copies of one list is four chances to be out of date, and they were:
// an audit found three routes missing from one English page, five from its French twin, and
// eleven from each of the shipped pair. None of it failed anything, because nothing compared
// a page to the code.
//
// This does. Extract the routes from `warp::path!`, extract every `/api/…` each page names,
// and report what a page does not mention.
//
//   node scripts/check-api-docs.mjs           report
//   node scripts/check-api-docs.mjs --check   exit 1 when a page is missing a route

import fs from 'node:fs';

const ROUTER = 'src-tauri/src/api/mod.rs';
const PAGES = [
  'BMM Docs/docs/reference/api.md',
  'BMM Docs/docs/reference/api.fr.md',
  'Update/Documentation/API_Reference_EN.md',
  'Update/Documentation/API_Reference_FR.md',
];

const rs = fs.readFileSync(ROUTER, 'utf8');
const routes = new Set();
for (const m of rs.matchAll(/warp::path!\(([^)]*)\)/g)) {
  const parts = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  if (parts.length && parts[0] === 'api') routes.add(`/${parts.join('/')}`);
}
if (routes.size < 40) {
  // A pattern that stops matching reports every page as perfect. Refuse instead.
  console.error(`✗ only ${routes.size} routes parsed from ${ROUTER} — the extractor is stale, not the docs perfect`);
  process.exit(2);
}

let bad = 0;
for (const page of PAGES) {
  let md;
  try { md = fs.readFileSync(page, 'utf8'); }
  catch { console.error(`✗ ${page} is missing`); bad++; continue; }

  // `:id` and friends are written differently per page; compare the bare path.
  const named = new Set([...md.matchAll(/(\/api\/[a-zA-Z0-9/_:.-]+)/g)]
    .map((m) => m[1].replace(/\/:[a-zA-Z]+/g, '').replace(/[.,)]+$/, '')));
  const missing = [...routes].filter((r) => !named.has(r)).sort();

  if (missing.length) {
    bad++;
    console.error(`✗ ${page} never mentions ${missing.length} route(s):`);
    for (const r of missing) console.error(`    ${r}`);
  } else {
    console.log(`✓ ${page} — all ${routes.size} routes mentioned`);
  }
}

if (bad && process.argv.includes('--check')) {
  console.error('');
  console.error('  A route nobody documented is a feature nobody finds. Add it to the page,');
  console.error('  or delete the route.');
  process.exit(1);
}
