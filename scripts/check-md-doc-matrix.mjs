#!/usr/bin/env node
// A table that said BMM renders no roadmap, on the page that documents BMM's roadmap.
//
// `BMM Docs/docs/reference/custom-markdown.md` compares what each renderer draws. It had two
// columns for three renderers — the app's documentation renderer (md-lite) and the one behind
// the Community tab and the release notes (rich-markdown) are not the same set — and its rows
// had aged: `roadmap`, `file`, `:badge`, `:icon`, `::toc` were all marked as website-only
// while BMM had been rendering them for months. Three sections further down, the same page
// explained how to write a roadmap in the app.
//
// Nobody had lied. The table was written once, the renderers grew, and a table is the one
// kind of documentation that cannot be wrong loudly.
//
// So the table is checked instead of maintained: every row that names directives in backticks
// is read, and its Yes/— for the two BMM columns must match what the two renderers actually
// answer to. The website column is check-md-parity.mjs's job.
import { readFileSync, existsSync } from 'node:fs';

const LITE = 'frontend/src/docs/md-lite.ts';
const RICH = 'frontend/src/ui/rich-markdown.ts';
const PAGES = [
  // [file, the word that means yes in that language]
  ['BMM Docs/docs/reference/custom-markdown.md', 'Yes'],
  ['BMM Docs/docs/reference/custom-markdown.fr.md', 'Oui'],
];

for (const f of [LITE, RICH, ...PAGES.map((p) => p[0])]) {
  if (!existsSync(f)) { console.error(`✗ ${f} is missing — refusing to report success`); process.exit(2); }
}

/** Every name a renderer answers to: block branches, callout table, inline leaf regexes. */
function directivesOf(file, calloutRe) {
  const src = readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/name === '([a-z0-9-]+)'/g)) names.add(m[1]);
  const table = src.match(calloutRe);
  if (table) for (const m of table[1].matchAll(/([a-z0-9-]+):/g)) names.add(m[1]);
  for (const m of src.matchAll(/\/:(?:\(\?:)?([a-z0-9|-]+)\)?\\\[/g)) for (const n of m[1].split('|')) names.add(n);
  if (/::toc\b/.test(src)) names.add('toc');
  return names;
}

const lite = directivesOf(LITE, /^const CALLOUT_KIND: Record<string, string> = \{([\s\S]*?)^\};/m);
const rich = directivesOf(RICH, /^const CALLOUT_ALERT: Record<string, string> = \{([\s\S]*?)^\};/m);

// Without these, a refactor of either renderer would empty a set and every row would agree
// with nothing at all.
if (lite.size < 10) { console.error(`✗ only found ${lite.size} directive(s) in ${LITE} — the extractor is stale`); process.exit(2); }
if (rich.size < 25) { console.error(`✗ only found ${rich.size} directive(s) in ${RICH} — the extractor is stale`); process.exit(2); }

const problems = [];
let rowsChecked = 0;

for (const [page, YES] of PAGES) {
  const md = readFileSync(page, 'utf8');
  // The rows of the comparison table: four cells, the last three being the renderer columns.
  const rows = [...md.matchAll(/^\|([^|\n]*)\|([^|\n]*)\|([^|\n]*)\|([^|\n]*)\|\s*$/gm)];
  const body = rows.filter((r) => [r[2], r[3], r[4]].every((c) => [YES, '—', '-'].includes(c.trim())));
  if (body.length < 8) {
    console.error(`✗ read ${body.length} comparison row(s) from ${page} — the table moved or changed shape, so this check cannot be trusted`);
    process.exit(2);
  }
  for (const r of body) {
    const names = [...r[1].matchAll(/`:{0,3}([a-z][a-z0-9-]*)`/g)].map((m) => m[1]);
    // A row that names nothing in backticks is prose ("Tables, fenced code, lists, quotes").
    // Nothing to check, and nothing to pretend to check.
    if (!names.length) continue;
    rowsChecked++;
    const claims = [[r[2].trim() === YES, lite, 'the app’s documentation renderer'], [r[3].trim() === YES, rich, 'the Community tab renderer']];
    for (const [claimed, set, who] of claims) {
      for (const n of names) {
        const real = set.has(n);
        if (claimed && !real) problems.push(`${page}: the table says ${who} draws "${n}" and it does not`);
        if (!claimed && real) problems.push(`${page}: ${who} draws "${n}" and the table says it does not`);
      }
    }
  }
}

// ── the in-app article, which is the version most people actually read ──
//
// Prose, not a table, so only one thing is checkable and it is the one that matters: every
// `:::name` it teaches must be a name the documentation renderer answers to. Teaching a block
// that comes out as literal text is the failure this article exists to prevent, and it had
// the opposite problem — it sent people to the website for a roadmap the app draws.
const HUB = 'frontend/src/docs/docs-hub.ts';
if (existsSync(HUB)) {
  const hub = readFileSync(HUB, 'utf8');
  const at = hub.indexOf("id: 'custom-markdown'");
  if (at < 0) {
    console.error('✗ the custom-markdown article moved — this half of the check cannot be trusted');
    process.exit(2);
  }
  // From the article's id to the end of its object. The next `id: '` is the next article.
  const end = hub.indexOf("        id: '", at + 10);
  const body = hub.slice(at, end < 0 ? hub.length : end);
  const taught = new Set([...body.matchAll(/<code>:{1,3}([a-z][a-z0-9-]*)/g)].map((m) => m[1]));
  // `:::name` is the article's own placeholder for "a directive name".
  taught.delete('name');
  taught.delete('nom');
  if (taught.size < 6) {
    console.error(`✗ read ${taught.size} directive(s) from the in-app article — the extractor is stale`);
    process.exit(2);
  }
  for (const n of taught) {
    if (!lite.has(n)) problems.push(`${HUB}: the in-app article teaches ":::${n}" and the documentation renderer does not draw it`);
  }
}

if (problems.length) {
  console.error('✗ markdown documentation matrix:');
  for (const p of [...new Set(problems)]) console.error(`    ${p}`);
  console.error('\n  A comparison table is the one kind of documentation that cannot be wrong loudly:');
  console.error('  it reads as authoritative right up until somebody follows it and gets literal text.');
  process.exit(1);
}
console.log(`✓ markdown doc matrix OK — ${rowsChecked} row(s) across ${PAGES.length} language(s) agree with both renderers (${lite.size} + ${rich.size} directives)`);
