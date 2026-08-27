#!/usr/bin/env node
// The permission column of every API reference, against the router.
//
// check-api-docs.mjs already asserts that each page MENTIONS every route. It cannot see the
// third column — the scope a route demands — and that column is what somebody reads before
// deciding whether to grant a plugin something.
//
// It was wrong, in the way a hand-kept column goes wrong: fifty routes had gained a
// permission and every page still said `token`, which reads as "any plugin may call this".
//
//   node scripts/check-api-perms.mjs           report
//   node scripts/check-api-perms.mjs --check   exit 1 when a page disagrees with the router
//   node scripts/check-api-perms.mjs --fix     rewrite the column from the router
//
// The router is the truth. A page is never the truth about what the code enforces.

import fs from 'node:fs';

const ROUTER = 'src-tauri/src/api/mod.rs';
// Only the two pages whose tables have a METHOD and a PERMISSION column.
//
// Update/Documentation/API_Reference_{EN,FR}.md list a route, whether it needs auth, and a
// body — there is no per-route scope cell to check. They are covered by check-api-docs.mjs
// for presence, and they carry the scope list as prose. Adding them here without a pattern
// that reads their shape would produce two permanent green ticks for two unchecked files,
// which is worse than not listing them.
const PAGES = [
  'BMM Docs/docs/reference/api.md',
  'BMM Docs/docs/reference/api.fr.md',
];

/** (METHOD, /path) → scope, or 'token' / 'open', read out of the warp filter chain. */
function routerTruth() {
  const src = fs.readFileSync(ROUTER, 'utf8');
  const lines = src.split(/\r?\n/);
  const map = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = /warp::path!\(([^)]*)\)/.exec(lines[i]);
    if (!m) continue;
    const parts = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    if (!parts.length || parts[0] !== 'api') continue;
    let path = `/${parts.join('/')}`;
    if (/\bString\b/.test(m[1])) path += '/:id';
    const blob = lines.slice(i, i + 10).join('\n');
    const meth = /warp::(get|post|put|delete|patch)\(\)/.exec(blob);
    if (!meth) continue;
    const perm = /require_permission\([^,]+,\s*"([^"]+)"\)/.exec(blob);
    const admin = /require_admin_token\(/.test(blob);
    const tok = /require_token\(/.test(blob);
    map.set(`${meth[1].toUpperCase()} ${path}`, perm ? perm[1] : admin ? 'admin' : tok ? 'token' : 'open');
  }
  return map;
}

const truth = routerTruth();
if (truth.size < 40) {
  console.error(`✗ only ${truth.size} routes parsed from ${ROUTER} — the extractor is stale`);
  process.exit(2);
}

// A table row: | `GET` | `/api/mods` | `mods.read` | … |
const ROW = /^\|\s*`?(GET|POST|PUT|DELETE|PATCH)`?\s*\|\s*`([^`]+)`\s*\|\s*([^|]*)\|/;

let bad = 0;
const FIX = process.argv.includes('--fix');

for (const page of PAGES) {
  let md;
  try { md = fs.readFileSync(page, 'utf8'); }
  catch { console.error(`✗ ${page} is missing`); bad++; continue; }
  const eol = md.includes('\r\n') ? '\r\n' : '\n';
  const lines = md.split(/\r?\n/);
  const wrong = [];
  let matched = 0;

  for (let i = 0; i < lines.length; i++) {
    const m = ROW.exec(lines[i]);
    if (!m) continue;
    const key = `${m[1]} ${m[2]}`;
    const want = truth.get(key);
    // A row for something that is not a route (an example, another product's API) is not
    // this gate's business.
    if (!want) continue;
    matched += 1;
    const said = m[3].trim().replace(/`/g, '').toLowerCase();
    const ok = want === 'token' ? (said === 'token' || said === 'jeton')
      : want === 'admin' ? said.includes('admin')
      : want === 'open' ? (said === '—' || said === '-' || said === 'open' || said === 'none' || said === 'aucune')
      : said === want;
    if (ok) continue;
    wrong.push({ line: i + 1, key, said: m[3].trim(), want });
    if (FIX) {
      const shown = want === 'token' ? 'token' : want === 'admin' ? 'admin token' : want === 'open' ? '—' : `\`${want}\``;
      lines[i] = lines[i].replace(m[3], ` ${shown} `);
    }
  }

  // Zero matched rows is not a clean page — it is a page whose table this pattern cannot
  // read, reporting perfection. That is the exact failure this gate exists to catch.
  if (!matched) {
    bad++;
    console.error(`✗ ${page} — no route row matched the pattern. Either the table changed shape`);
    console.error('    or this page lists routes without a method column; either way it is not checked.');
    continue;
  }
  if (FIX && wrong.length) {
    fs.writeFileSync(page, lines.join(eol));
    console.log(`✎ ${page} — rewrote ${wrong.length} permission cell(s)`);
    continue;
  }
  if (wrong.length) {
    bad++;
    console.error(`✗ ${page} — ${wrong.length} row(s) name the wrong permission:`);
    for (const w of wrong.slice(0, 12)) {
      console.error(`    line ${w.line}  ${w.key}  says "${w.said}", router demands "${w.want}"`);
    }
    if (wrong.length > 12) console.error(`    … and ${wrong.length - 12} more`);
  } else {
    console.log(`✓ ${page} — every permission cell matches the router`);
  }
}

if (bad && process.argv.includes('--check')) {
  console.error('');
  console.error('  A page that under-states what a route demands reads as "any plugin may');
  console.error('  call this". Run: node scripts/check-api-perms.mjs --fix');
  process.exit(1);
}
