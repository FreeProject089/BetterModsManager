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

// Article ids come from TWO places, and reading only the first is how 25 of 67 articles went
// unchecked here for months: their docsPath was never resolved, and a cross-link naming one
// would have been reported broken.
//
//   · literal objects   — `id: 'foo'` at the start of a line
//   · devArticle(…)     — a positional helper; the id is argument 1, unless argument 7
//                          overrides it (which it must when one diagram backs two articles)
//
// The helper's arguments contain quotes, braces, apostrophes and template literals, so they are
// scanned with real depth/quote tracking rather than a regex — a regex for this is guesswork.
function devArticleArgs(src) {
  const calls = [];
  for (let i = src.indexOf('devArticle('); i >= 0; i = src.indexOf('devArticle(', i + 1)) {
    let p = i + 'devArticle('.length;
    let depth = 0, quote = null, start = p;
    const args = [];
    for (; p < src.length; p++) {
      const ch = src[p];
      if (quote) {
        if (ch === '\\') { p++; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === '(' || ch === '{' || ch === '[') { depth++; continue; }
      if (ch === ')' && depth === 0) { args.push(src.slice(start, p)); break; }
      if (ch === ')' || ch === '}' || ch === ']') { depth--; continue; }
      if (ch === ',' && depth === 0) { args.push(src.slice(start, p)); start = p + 1; }
    }
    calls.push(args.map((a) => a.trim()));
  }
  return calls;
}
const literalOf = (a) => {
  const m = /^'((?:[^'\\]|\\.)*)'$/.exec(a || '');
  return m ? m[1].replace(/\\(.)/g, '$1') : null;
};

const devCalls = devArticleArgs(hub);
// id = argument 7 when given, else argument 1 (the diagram id).
const devIds = devCalls.map((a) => literalOf(a[6]) || literalOf(a[0])).filter(Boolean);
const litIds = [...hub.matchAll(/^\s*id: '([a-z0-9-]+)'/gm)].map((m) => m[1]);
const artIds = new Set([...litIds, ...devIds]);

const pageExists = (p) => {
  const clean = String(p).replace(/^\/+|\/+$/g, '');
  if (!clean) return true;                       // '' → the site root
  return existsSync(join(DOCS, clean + '.md')) || existsSync(join(DOCS, clean, 'index.md'));
};

let failed = 0;
const fail = (msg) => { console.error('  ✗ ' + msg); failed++; };

// 0 ── article ids must be unique across ALL categories.
// findArticle() scans every category and returns the first match, so a repeated id does not
// raise anything — it makes the second article unreachable, and every route to it silently
// renders the first. `launch-packs` existed twice (a user article and a dev one sharing a
// diagram) and nothing showed it: both rendered, one was simply never the one you reached.
const before0 = failed;
const seenIds = new Map();
for (const [id, where] of [...litIds.map((i) => [i, 'literal']), ...devIds.map((i) => [i, 'devArticle'])]) {
  if (seenIds.has(id)) fail(`article id used twice: '${id}' (${seenIds.get(id)} + ${where}) — the second is unreachable`);
  else seenIds.set(id, where);
}
if (failed === before0) console.log(`✓ ${artIds.size} article id(s) unique`);

// 1 ── docsPath → a real page
// devArticle takes its docsPath positionally (argument 6), so it never matched `docsPath:`.
const devPaths = devCalls.map((a) => literalOf(a[5])).filter((p) => p && p !== '#');
const paths = [...new Set([
  ...[...hub.matchAll(/docsPath:\s*'([^']*)'/g)].map((m) => m[1]),
  ...devPaths,
])];
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

// 5 ── every diagram must survive md-lite's HTML attribute intact.
// md-lite stashes a ```mermaid source in data-mermaid="…". When esc() did not escape the double
// quote, the first quote in the source closed the attribute — and since mermaid labels are
// normally written A["Label"], that silently truncated 54 of 56 bundled diagrams to a few
// characters. They rendered as a placeholder with no error anywhere. Nothing else catches this:
// the markdown is valid, the TypeScript compiles, and the failure only appears on screen.
const before5 = failed;
const MD_LITE = join(ROOT, 'frontend/js/docs/md-lite.js');
const BUNDLE = join(ROOT, 'frontend/assets/docs');
if (!existsSync(MD_LITE)) {
  console.log('· frontend/js not compiled — skipping the diagram round-trip check');
} else if (!existsSync(BUNDLE)) {
  console.log('· docs bundle not built — skipping the diagram round-trip check');
} else {
  const { renderDocMarkdown } = await import('file://' + MD_LITE.replace(/\\/g, '/'));
  const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  // This gate asks whether md-lite's HTML escaping loses any of the diagram — not what the
  // file's line endings are. md-lite normalises CRLF to LF, so comparing raw bytes made the
  // check fail on every Windows working copy (core.autocrlf hands out CRLF) while staying
  // green in CI, which runs on Linux. It reported the CR count as "truncated": 425 vs 413
  // chars on repo.md, exactly its 12 lines.
  const lf = (s) => s.replace(/\r\n/g, '\n');
  let checked = 0;
  for (const f of walk(BUNDLE)) {
    if (!f.endsWith('.md')) continue;
    const md = readFileSync(f, 'utf8');
    const want = [...md.matchAll(/^```mermaid[ \t]*\r?\n([\s\S]*?)^```/gm)].map((m) => lf(m[1]).trim());
    if (!want.length) continue;
    // Read each attribute the way a browser would: up to the next unescaped quote.
    // `trusted`: these are OUR bundled pages, and the default is now the untrusted path —
    // which ends in a sanitiser that needs a DOM. In node it fails closed, so every page
    // came back as escaped text and every diagram went missing. This check measures the
    // RENDERER, so it renders the way the app renders a page of ours.
    const got = [...renderDocMarkdown(md, { trusted: true }).matchAll(/data-mermaid="([^"]*)"/g)].map((m) => lf(unesc(m[1])).trim());
    const where = relative(ROOT, f);
    if (got.length !== want.length) { fail(`${where}: ${want.length} diagram(s) in the source, ${got.length} in the HTML`); continue; }
    for (let i = 0; i < want.length; i++) {
      checked++;
      if (got[i] !== want[i]) fail(`${where}: diagram ${i + 1} is truncated in data-mermaid (got ${got[i].length} of ${want[i].length} chars)`);
    }
  }
  if (failed === before5) console.log(`✓ ${checked} diagram source(s) survive md-lite's HTML intact`);
}

// 6 ── nothing that is invisible on the SITE may be visible in the app.
// md-lite escapes HTML it does not recognise, which turns anything stray into body text. That has
// now bitten three times: the recording embed printed as a tag, mkdocs heading anchors printed
// their braces, and the authors' own `<!-- TODO(content): … -->` notes printed as a paragraph.
// The reader should never see markup, and never see a note written for the writers.
const before6 = failed;
if (existsSync(MD_LITE) && existsSync(BUNDLE)) {
  const { renderDocMarkdown } = await import('file://' + MD_LITE.replace(/\\/g, '/'));
  let checked = 0;
  for (const f of walk(BUNDLE)) {
    if (!f.endsWith('.md')) continue;
    checked++;
    const html = renderDocMarkdown(readFileSync(f, 'utf8'), { trusted: true });
    const where = relative(ROOT, f);
    // The escaped form is what a reader actually saw.
    if (/&lt;!--/.test(html)) fail(`${where}: an HTML comment is rendered as visible text`);
    if (/&lt;(?:div|span|a|img|br|p)[\s&]/i.test(html)) fail(`${where}: raw HTML is rendered as visible text`);
    if (/\{#[\w-]+\}/.test(html)) fail(`${where}: a mkdocs heading anchor prints its own braces`);
    // An admonition the renderer did not recognise falls through as a paragraph, so the
    // reader sees the literal `!!! note "…"`. This gate passed while exactly that was on
    // screen — a title containing escaped quotes matched nothing — because it only looked
    // for HTML-ish leftovers. The marker is only ever markup: it has no business in output.
    if (/(?:^|>|\n)\s*(?:!!!|\?\?\?\+?)\s+[a-z-]+/im.test(html)) {
      fail(`${where}: an admonition is rendered as literal "!!! …" text`);
    }
  }
  if (failed === before6) console.log(`✓ ${checked} page(s) render no stray markup`);
}

// A number written in prose cannot update itself. The docs told readers the in-app hub
// carried "44 diagrams" while the registry held 40 — nothing was broken, the sentence had
// simply outlived the code, and no gate could see it. This is the smallest thing that
// notices: count the registry, count the claim, refuse to let them disagree.
{
  const before7 = failed;
  const reg = readFileSync(join(ROOT, 'frontend/src/docs/interactive-docs.ts'), 'utf8');
  const body = reg.match(/export const diagrams = \{([\s\S]*?)\n\};/);
  if (!body) {
    fail('interactive-docs.ts: the `diagrams` registry is no longer a plain object literal — this check needs updating');
  } else {
    const actual = (body[1].match(/^\s+'[a-z0-9-]+':/gm) || []).length;
    for (const rel of ['reference/troubleshooting.md', 'reference/troubleshooting.fr.md']) {
      const f = join(ROOT, 'BMM Docs', 'docs', rel);
      if (!existsSync(f)) continue;
      const m = readFileSync(f, 'utf8').match(/(\d+)\s+diagram(?:me)?s/i);
      if (m && Number(m[1]) !== actual) {
        fail(`${rel}: claims ${m[1]} diagrams, the registry has ${actual}`);
      }
    }
    if (failed === before7) console.log(`✓ diagram count claim matches the registry (${actual})`);
  }
}

if (failed) {
  console.error(`\n✗ ${failed} broken documentation cross-reference(s)`);
  process.exit(1);
}
console.log('✓ documentation cross-references OK');
