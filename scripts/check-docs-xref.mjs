#!/usr/bin/env node
// check-docs-xref — keeps BMM's two documentation surfaces wired to each other.
//
// The in-app hub (Help & other) and the BMM Docs site are two views of the same material, and
// they link both ways. Nothing else validates those links: `mkdocs --strict` checks markdown
// links inside the site, and tsc checks the TypeScript, but neither can see across the boundary.
// Both failure modes are silent — a "Read full docs" button that quietly lands on the homepage,
// or an "Open in BMM" link naming an article that no longer exists.
//
// Checks:
//   1. every article's docsPath resolves to a real page in BMM Docs
//   2. every in-app `[label](doc:id)` cross-link names a real article
//   3. every `bmm://docs/open?article=id` in BMM Docs names a real article
//   4. reports articles with no docsPath (they fall back to the site homepage)
//
// Usage: node scripts/check-docs-xref.mjs
// Exit code 1 on any broken reference. The report in (4) is informational.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HUB = join(ROOT, 'frontend/src/docs/docs-hub.ts');
const DOCS = join(ROOT, 'BMM Docs/docs');

if (!existsSync(DOCS)) {
  // BMM Docs is its own git repo and may simply not be checked out next to this one.
  console.log('· BMM Docs not present — skipping the cross-reference check');
  process.exit(0);
}

const hub = readFileSync(HUB, 'utf8');
// Article ids sit at the start of a line; a nested `{ id: … }` (tutorial, media) never does.
const artIds = new Set([...hub.matchAll(/^\s*id: '([a-z0-9-]+)'/gm)].map((m) => m[1]));

const pageExists = (p) => {
  const clean = String(p).replace(/^\/+|\/+$/g, '');
  if (!clean) return true;                       // '' → the site root
  return existsSync(join(DOCS, clean + '.md')) || existsSync(join(DOCS, clean, 'index.md'));
};

let failed = 0;
const fail = (msg) => { console.error('  ✗ ' + msg); failed++; };

// 1 ── docsPath → a real page
const paths = [...new Set([...hub.matchAll(/docsPath:\s*'([^']*)'/g)].map((m) => m[1]))];
for (const p of paths) if (!pageExists(p)) fail(`docsPath has no page: ${JSON.stringify(p)}`);
if (!failed) console.log(`✓ ${paths.length} docsPath target(s) resolve`);

// 2 ── in-app doc: cross-links → a real article
const before2 = failed;
for (const id of new Set([...hub.matchAll(/\(doc:([a-z0-9-]+)\)/g)].map((m) => m[1]))) {
  if (!artIds.has(id)) fail(`in-app cross-link to unknown article: doc:${id}`);
}
if (failed === before2) console.log('✓ in-app doc: cross-links resolve');

// 3 ── BMM Docs deeplinks → a real article
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : (n.endsWith('.md') ? [p] : []);
});
const before3 = failed;
let deepCount = 0;
for (const f of walk(DOCS)) {
  for (const m of readFileSync(f, 'utf8').matchAll(/bmm:\/\/docs\/open\?article=([a-z0-9-]+)/g)) {
    deepCount++;
    if (!artIds.has(m[1])) fail(`${relative(DOCS, f)} links to unknown article: ${m[1]}`);
  }
}
if (failed === before3) console.log(`✓ ${deepCount} bmm://docs/open link(s) resolve`);

// 4 ── informational: which articles still carry hand-written text instead of a doc page.
// An article with a docsPath renders the bundled page; one without keeps a body maintained
// separately from the site, which is how the two came to disagree in the first place.
const routes = new Set();
try {
  const mf = join(ROOT, 'frontend/assets/docs/manifest.json');
  if (existsSync(mf)) for (const p of JSON.parse(readFileSync(mf, 'utf8')).pages) routes.add(p.path);
} catch { /* the bundle may simply not be built yet */ }

const blocks = hub.split(/\n\s*\{\s*\n?\s*id:/).slice(1);
const orphans = [];
for (const b of blocks) {
  const id = (b.match(/^\s*'([a-z0-9-]+)'/) || [])[1];
  if (!id) continue;
  // Categories carry `part:` and have no article view, so they need no docsPath.
  const head = b.slice(0, 400);
  if (/\bpart:\s*'/.test(head)) continue;
  const dp = (head.match(/docsPath:\s*'([^']*)'/) || [])[1];
  const clean = dp ? dp.replace(/^\/+|\/+$/g, '') : '';
  if (!clean || (routes.size && !routes.has(clean))) orphans.push(id);
}
if (orphans.length) {
  console.log(`· ${orphans.length} article(s) still show hand-written text (no bundled page behind them):`);
  console.log('  ' + orphans.join(', '));
}

if (failed) {
  console.error(`\n✗ ${failed} broken documentation cross-reference(s)`);
  process.exit(1);
}
console.log('✓ documentation cross-references OK');
