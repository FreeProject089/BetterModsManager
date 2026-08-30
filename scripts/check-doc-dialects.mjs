#!/usr/bin/env node
// One page, two renderers, and the syntax only one of them knows.
//
// BMM Docs is published twice: by mkdocs as a website, and bundled into the app where md-lite
// draws it. Neither renderer ERRORS on the other's spelling — it comes out as the characters
// the author typed, in the middle of a paragraph, on one of the two surfaces.
//
// Measured before this existed: `++esc++` ten times (keycaps on the site, literal text in the
// app) and `:kbd[…]` four times (the reverse), in the SAME two files. A documentation pass had
// read every one of those pages.
//
// Both spellings now work in both places. This is what stops the next one arriving: a
// mkdocs extension somebody enables, or a B.MD directive somebody starts using, that only one
// side draws.
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'BMM Docs/docs');
const HOOK = join(ROOT, 'BMM Docs/tools/md_directives.py');
const LITE = join(ROOT, 'frontend/src/docs/md-lite.ts');

// BMM Docs is a gitlink with no .gitmodules; on a fresh clone it is simply absent, and this
// says so rather than reporting a comparison it did not make.
if (!existsSync(DOCS)) {
  console.log('  · BMM Docs not checked out — nothing to compare');
  process.exit(0);
}
for (const f of [HOOK, LITE]) {
  if (!existsSync(f)) { console.error(`✗ ${f} is missing — refusing to report success`); process.exit(2); }
}

const hook = readFileSync(HOOK, 'utf8');
const lite = readFileSync(LITE, 'utf8');

const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n.endsWith('.md')) files.push(p);
  }
})(DOCS);
if (files.length < 20) {
  console.error(`✗ read ${files.length} page(s) — too few to be right, so this check cannot be trusted`);
  process.exit(2);
}

/** Fenced and inline code out: a page documenting a syntax legitimately contains it. */
const prose = (md) => md
  .replace(/^```[\s\S]*?^```/gm, '')
  .replace(/^~~~[\s\S]*?^~~~/gm, '')
  .replace(/`[^`\n]*`/g, '');

/**
 * mkdocs extensions whose syntax the app has to know as well.
 *
 * Each names the file that proves md-lite handles it. An extension enabled in mkdocs.yml with
 * no row here is not checked — that is the honest limit, and it is why the row says what to
 * look for rather than just naming the extension.
 */
const SITE_SYNTAX = [
  { re: /\+\+[a-z0-9][a-z0-9+.-]*\+\+/gi, what: '++keys++', drawnBy: /\\\+\\\+\(\[a-z0-9\]/ },
  { re: /\{:\s*[.#][\w-]/g, what: '{: .attr }', drawnBy: /attr_list/ },
];

/** B.MD spellings the mkdocs hook has to translate, or the site prints them. */
const APP_SYNTAX = [
  { re: /(?<![:\w]):kbd\[/g, what: ':kbd[…]', drawnBy: /:kbd\\\[/ },
  { re: /(?<![:\w]):(?:time|at)\[/g, what: ':time[…]', drawnBy: /:(?:time|at)\\\[/ },
  { re: /(?<![:\w]):(?:badge|tag)\[/g, what: ':badge[…]', drawnBy: /:\(\?:badge\|tag\)\\\[/ },
  { re: /(?<![:\w]):icon\[/g, what: ':icon[…]', drawnBy: /:icon\\\[/ },
];

// Container directives the hook converts. Anything else reaches the site as literal text.
const hookKinds = new Set();
const kindTable = hook.match(/_KIND = \{([\s\S]*?)\}/);
if (kindTable) for (const m of kindTable[1].matchAll(/"([a-z-]+)"\s*:/g)) hookKinds.add(m[1]);
for (const extra of ['details', 'collapse']) hookKinds.add(extra);
if (hookKinds.size < 8) {
  console.error(`✗ read ${hookKinds.size} kind(s) from the mkdocs hook — the extractor is stale`);
  process.exit(2);
}

const problems = [];
for (const f of files) {
  const rel = f.slice(ROOT.length + 1).replace(/\\/g, '/');
  const text = prose(readFileSync(f, 'utf8'));

  for (const rule of SITE_SYNTAX) {
    if (!rule.drawnBy.test(lite) && rule.re.test(text)) {
      problems.push(`${rel}: uses ${rule.what}, which the site draws and md-lite prints as text`);
    }
    rule.re.lastIndex = 0;
  }
  for (const rule of APP_SYNTAX) {
    if (!rule.drawnBy.test(hook) && rule.re.test(text)) {
      problems.push(`${rel}: uses ${rule.what}, which the app draws and the site prints as text`);
    }
    rule.re.lastIndex = 0;
  }
  for (const m of text.matchAll(/^:::+\s*([a-z][\w-]*)/gm)) {
    if (!hookKinds.has(m[1].toLowerCase())) {
      problems.push(`${rel}: uses :::${m[1]} outside a code fence — the mkdocs hook only converts callouts and details, so the site prints it`);
    }
  }
}

if (problems.length) {
  console.error('✗ documentation dialects:');
  for (const p of [...new Set(problems)]) console.error(`    ${p}`);
  console.error('\n  Neither renderer errors on the other\'s syntax. It arrives as the characters the');
  console.error('  author typed, in the middle of a paragraph, on exactly one of the two surfaces.');
  process.exit(1);
}
console.log(`✓ documentation dialects OK — ${files.length} page(s) render the same on both surfaces`);
