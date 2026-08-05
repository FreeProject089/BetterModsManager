#!/usr/bin/env node
// sync-docs — copies the BMM Docs markdown into the app so Help & other can render the SAME
// pages the site does, instead of a parallel set of articles written separately.
//
// One source, two renderers: mkdocs builds the site, and BMM renders the same files through
// md-lite with its own theme, buttons and cross-links. A page can then never say two different
// things in two places, which is what happens the moment the texts are maintained apart.
//
// Output: frontend/assets/docs/<lang>/<path>.md  +  frontend/assets/docs/manifest.json
//
//   node scripts/sync-docs.mjs          # copy
//   node scripts/sync-docs.mjs --check  # fail if the copy is stale (for CI)

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'BMM Docs', 'docs');
const OUT = join(ROOT, 'frontend', 'assets', 'docs');
const CHECK = process.argv.includes('--check');

if (!existsSync(SRC)) {
  // BMM Docs is a separate git repo and may not be checked out beside this one.
  console.log('· BMM Docs not present — nothing to sync');
  process.exit(0);
}

/** Every page, as { path, en, fr } where path is the mkdocs route ("features/themes"). */
function collect() {
  const pages = new Map();
  (function walk(dir) {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) { if (n !== 'assets') walk(p); continue; }
      if (!n.endsWith('.md')) continue;
      const rel = relative(SRC, p).replace(/\\/g, '/');
      const isFr = /\.fr\.md$/.test(rel);
      const route = rel.replace(/\.fr\.md$/, '').replace(/\.md$/, '');
      const e = pages.get(route) || { path: route };
      e[isFr ? 'fr' : 'en'] = p;
      pages.set(route, e);
    }
  })(SRC);
  return [...pages.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** The first H1 is the page title; the nav shows it. */
const titleOf = (text, fallback) => (text.match(/^#\s+(.+)$/m) || [, fallback])[1].trim();

/** Rewrite what only makes sense on the website. */
function forApp(md) {
  return md
    // "Open in BMM" blocks are pointless inside BMM — it is already open.
    .replace(/^!!! tip "(Open in BMM|Ouvrir dans BMM)"[\s\S]*?(?=\n(?:#{1,6} |---|\S))/gm, '')
    // Site-relative links (../index.md#x, features/themes.md) become app doc routes.
    .replace(/\]\((?!https?:|bmm:|#)([^)]+?)\.md(#[^)]*)?\)/g, (_m, p, hash) => `](doc-page:${p.replace(/^\.\//, '')}${hash || ''})`)
    .trim() + '\n';
}

const pages = collect();
const manifest = { generated: 'scripts/sync-docs.mjs', pages: [] };
const files = [];

for (const p of pages) {
  if (!p.en) continue;                       // an FR page with no English source is a mistake
  const en = forApp(readFileSync(p.en, 'utf8'));
  const fr = p.fr ? forApp(readFileSync(p.fr, 'utf8')) : null;
  files.push({ rel: `en/${p.path}.md`, body: en });
  if (fr) files.push({ rel: `fr/${p.path}.md`, body: fr });
  manifest.pages.push({
    path: p.path,
    section: p.path.includes('/') ? p.path.split('/')[0] : 'root',
    title: { en: titleOf(en, p.path), fr: fr ? titleOf(fr, p.path) : titleOf(en, p.path) },
    fr: !!fr,
  });
}
const manifestText = JSON.stringify(manifest, null, 2) + '\n';

if (CHECK) {
  let stale = [];
  if (!existsSync(OUT)) stale.push('(the whole folder is missing)');
  else {
    for (const f of files) {
      const p = join(OUT, f.rel);
      if (!existsSync(p) || readFileSync(p, 'utf8') !== f.body) stale.push(f.rel);
    }
    const mp = join(OUT, 'manifest.json');
    if (!existsSync(mp) || readFileSync(mp, 'utf8') !== manifestText) stale.push('manifest.json');
  }
  if (stale.length) {
    console.error(`✗ the bundled docs are stale (${stale.length} file(s)) — run: node scripts/sync-docs.mjs`);
    console.error('  ' + stale.slice(0, 8).join('\n  ') + (stale.length > 8 ? `\n  …and ${stale.length - 8} more` : ''));
    process.exit(1);
  }
  console.log(`✓ bundled docs up to date (${manifest.pages.length} pages)`);
  process.exit(0);
}

rmSync(OUT, { recursive: true, force: true });
for (const f of files) {
  const p = join(OUT, f.rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, f.body);
}
writeFileSync(join(OUT, 'manifest.json'), manifestText);
console.log(`✓ synced ${manifest.pages.length} pages (${files.length} files) into frontend/assets/docs/`);
