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

/** The page's opening sentence, as a plain-text blurb.
 *  The index used to show each page's raw path under its title, which told a reader nothing they
 *  could not already see. The first paragraph is what the page is actually about. */
function summaryOf(text) {
  const lines = text.split(/\r?\n/);
  let i = lines.findIndex((l) => /^#\s+/.test(l));
  if (i < 0) i = -1;
  let para = '';
  for (let n = i + 1; n < lines.length; n++) {
    const l = lines[n].trim();
    if (!l) { if (para) break; continue; }
    // Skip anything that is not prose: admonitions, fences, tables, images, headings, HTML.
    if (/^(#{1,6}\s|!!!|\?\?\?|```|\||===|<|!\[|---)/.test(l)) { if (para) break; continue; }
    // Most pages open with a "> one-line tagline" blockquote; that IS the summary, minus its marker.
    para += (para ? ' ' : '') + l.replace(/^>\s?/, '');
    if (para.length > 200) break;
  }
  para = para
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')      // keep the link text, drop the target
    .replace(/<[^>]+>/g, '')                      // inline HTML (<kbd>…) would render as literal text
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (para.length <= 160) return para;
  // Cut on a sentence if one ends nearby, otherwise on a word.
  const dot = para.slice(0, 170).lastIndexOf('. ');
  return dot > 70 ? para.slice(0, dot + 1) : para.slice(0, para.lastIndexOf(' ', 158)) + '…';
}

/** Roughly how long the page is, and whether it carries diagrams — the two things a reader wants
 *  to know before opening one of 36 pages. Prose only: fences and tables are not read word by word. */
function statsOf(text) {
  const prose = text.replace(/^```[\s\S]*?^```/gm, '').replace(/^\|.*$/gm, '');
  return {
    words: (prose.match(/[\p{L}\p{N}'’-]+/gu) || []).length,
    diagrams: (text.match(/^```mermaid/gm) || []).length,
  };
}

/** Resolve a link written relative to `fromDir` into an absolute doc route.
 *  "library" inside features/modlist is features/library — leaving it relative made every
 *  same-folder link resolve to a page that does not exist. */
function resolveRoute(fromDir, target) {
  const segs = (fromDir ? fromDir.split('/') : []).concat(target.replace(/^\.\//, '').split('/'));
  const out = [];
  for (const s of segs) {
    if (s === '..') out.pop();
    else if (s && s !== '.') out.push(s);
  }
  return out.join('/');
}

/** Rewrite what only makes sense on the website. `route` is the page's own path. */
function forApp(md, route) {
  const dir = route.includes('/') ? route.slice(0, route.lastIndexOf('/')) : '';
  return md
    // "Open in BMM" blocks are pointless inside BMM — it is already open.
    .replace(/^!!! tip "(Open in BMM|Ouvrir dans BMM)"[\s\S]*?(?=\n(?:#{1,6} |---|\S))/gm, '')
    // Same for the site's own "open this in the app" buttons, in both the raw-HTML and the
    // markdown-with-attributes form Material supports.
    .replace(/^\s*<a class="md-button"[^>]*href="bmm:\/\/[^"]*"[^>]*>[\s\S]*?<\/a>\s*$/gm, '')
    .replace(/^\s*\[[^\]]*\]\(bmm:\/\/[^)]*\)\{[^}]*\}\s*$/gm, '')
    // Material's attribute lists ({ .md-button }, { #id }) have no meaning here and would
    // otherwise render as literal text next to the link.
    .replace(/\)\{[^}\n]*\}/g, ')')
    // Images live under docs/assets/ on the site; they are copied next to the markdown here.
    .replace(/\]\((?!https?:|data:)([^)]*?\/)?assets\/([^)]+)\)/g, (_m, _p, rest) => `](assets/docs/media/${rest})`)
    // Site-relative .md links become app doc routes, resolved against this page's folder.
    .replace(/\]\((?!https?:|bmm:|#)([^)]+?)\.md(#[^)]*)?\)/g,
      (_m, p, hash) => `](doc-page:${resolveRoute(dir, p)}${hash || ''})`)
    .trim() + '\n';
}

const pages = collect();
const manifest = { generated: 'scripts/sync-docs.mjs', pages: [] };
const files = [];

// The screenshots the pages embed. Small (~0.1 MB for 21 files) and worth bundling: without
// them every page that illustrates a screen renders a broken image.
const media = [];
(function walkMedia(dir, rel = '') {
  if (!existsSync(dir)) return;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { walkMedia(p, rel ? `${rel}/${n}` : n); continue; }
    if (/\.(png|jpe?g|gif|svg|webp)$/i.test(n)) media.push({ rel: `media/${rel ? rel + '/' : ''}${n}`, src: p });
  }
})(join(SRC, 'assets'));

for (const p of pages) {
  if (!p.en) continue;                       // an FR page with no English source is a mistake
  const en = forApp(readFileSync(p.en, 'utf8'), p.path);
  const fr = p.fr ? forApp(readFileSync(p.fr, 'utf8'), p.path) : null;
  files.push({ rel: `en/${p.path}.md`, body: en });
  if (fr) files.push({ rel: `fr/${p.path}.md`, body: fr });
  const st = statsOf(en);
  manifest.pages.push({
    path: p.path,
    section: p.path.includes('/') ? p.path.split('/')[0] : 'root',
    title: { en: titleOf(en, p.path), fr: fr ? titleOf(fr, p.path) : titleOf(en, p.path) },
    summary: { en: summaryOf(en), fr: fr ? summaryOf(fr) : summaryOf(en) },
    words: st.words,
    diagrams: st.diagrams,
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
for (const m of media) {
  const p = join(OUT, m.rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, readFileSync(m.src));
}
writeFileSync(join(OUT, 'manifest.json'), manifestText);
console.log(`✓ synced ${manifest.pages.length} pages (${files.length} files, ${media.length} images) into frontend/assets/docs/`);
