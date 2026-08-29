#!/usr/bin/env node
// One emoji table, in two repositories.
//
// `:rocket:` exists so that a document written once reads the same in the browser and in the
// app. The table that resolves it is the website's, and BMM holds a copy — so the moment the
// two disagree, a post renders a rocket on BetterCommunity and the literal text `:rocket:` in
// the Community tab, for exactly the names nobody thought to check.
//
// That failure is silent by construction: an unknown shortcode is deliberately left as typed
// rather than dropped, which is the right behaviour and also the reason nothing complains.
//
// So the copy is checked against its source. `frontend/src/core/emoji.ts` says in its header
// that this file holds the two in step; without this file that header is a claim about a
// check that does not exist, which is worse than no header.
import { readFileSync, existsSync } from 'node:fs';

const MINE = 'frontend/src/core/emoji.ts';
// A gitlink with no .gitmodules: on a fresh clone the website simply is not here, and this
// says so out loud rather than reporting a comparison it did not make.
const SITE = 'BCW/BCWEB/apps/web/src/markdown/emoji.js';

if (!existsSync(MINE)) {
  console.error(`✗ ${MINE} is missing — refusing to report success`);
  process.exit(2);
}

/** name → character, out of either file. Both declare one object literal called EMOJI. */
function tableOf(file) {
  const src = readFileSync(file, 'utf8');
  const m = src.match(/EMOJI[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!m) return null;
  const out = new Map();
  // Several names sit on one line, so this matches occurrences rather than lines.
  //
  // The key is quoted OR bare, and that alternative is load-bearing: three names — '+1',
  // '-1' and 'ok' — are not valid identifiers, so both files quote them. A bare-key-only
  // pattern read 381 of 384 entries from each side, compared those 381, and reported the two
  // tables identical while saying nothing at all about the other three.
  for (const e of m[1].matchAll(/(?:'([^']+)'|([a-z0-9_+-]+))\s*:\s*'([^']*)'/g)) {
    out.set(e[1] || e[2], e[3]);
  }
  return out;
}

const mine = tableOf(MINE);
if (!mine) { console.error(`✗ could not read the EMOJI table out of ${MINE} — the extractor is stale`); process.exit(2); }
// Without this, a refactor that renamed the table would leave an empty map on both sides and
// the comparison below would pass by comparing nothing.
if (mine.size < 150) { console.error(`✗ read only ${mine.size} name(s) from ${MINE} — the extractor is stale`); process.exit(2); }

if (!existsSync(SITE)) {
  console.log(`✓ emoji table OK — ${mine.size} name(s); ${SITE} not checked out, so nothing was compared to the site`);
  process.exit(0);
}
const site = tableOf(SITE);
if (!site || site.size < 150) { console.error(`✗ could not read the EMOJI table out of ${SITE} — the extractor is stale`); process.exit(2); }

const missing = [...site.keys()].filter((k) => !mine.has(k));
const extra = [...mine.keys()].filter((k) => !site.has(k));
const differs = [...site.entries()].filter(([k, v]) => mine.has(k) && mine.get(k) !== v).map(([k]) => k);

const problems = [];
if (missing.length) problems.push(`the site has ${missing.length} name(s) BMM does not: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '…' : ''}`);
if (extra.length) problems.push(`BMM has ${extra.length} name(s) the site does not: ${extra.slice(0, 12).join(', ')}${extra.length > 12 ? '…' : ''}`);
if (differs.length) problems.push(`${differs.length} name(s) resolve to a different character: ${differs.slice(0, 12).join(', ')}${differs.length > 12 ? '…' : ''}`);

if (problems.length) {
  console.error('✗ emoji tables have drifted:');
  for (const p of problems) console.error(`    ${p}`);
  console.error(`\n  ${SITE} is the source of truth. Edit THAT file, then re-copy the table into`);
  console.error('  frontend/src/core/emoji.ts — an unknown shortcode is left as typed, so a drifted');
  console.error('  copy shows `:rocket:` to a reader in the app and a rocket to the same reader on the web.');
  process.exit(1);
}
console.log(`✓ emoji table OK — ${mine.size} name(s), identical to the website's`);
