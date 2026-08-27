#!/usr/bin/env node
// A backtick inside markup that lives in a template literal.
//
// Most of this app's HTML is written inside `` ` `` template literals, and the comments
// alongside it are written in the same voice as the rest of the codebase — which means
// `identifiers` in backticks. Inside a template literal a backtick ENDS the template.
//
// The compiler usually catches it, as a syntax error dozens of lines away with no
// resemblance to the cause: "';' expected", "Unterminated regular expression literal",
// "Module declaration names may only use quoted strings". Three times in one session the
// error pointed at markup that was perfectly fine. This says what actually happened.
//
// Worse, an EVEN number of them can parse: the template ends, the text between the pair is
// read as code, and a second template begins. That produces a file that compiles and emits
// something nobody wrote.
//
// Only HTML comments are checked. A backtick anywhere else inside a template is either a
// deliberate escape (`\``) or already a syntax error the compiler describes accurately.
//
//   node scripts/check-template-backticks.mjs [--check]

import fs from 'node:fs';
import path from 'node:path';

const SRC = 'frontend/src';

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts')) files.push(p);
  }
})(SRC);
if (!files.length) {
  console.error('✗ no sources found — refusing to report success');
  process.exit(2);
}

const hits = [];
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  // `<!--` … `-->` across lines. The markup these live in is multi-line by nature.
  for (const m of text.matchAll(/<!--[\s\S]*?-->/g)) {
    const body = m[0];
    // An escaped backtick is the author saying they meant it.
    const raw = body.replace(/\\`/g, '');
    if (!raw.includes('`')) continue;
    const line = text.slice(0, m.index).split('\n').length;
    const n = (raw.match(/`/g) || []).length;
    hits.push({ f, line, n, snippet: body.split('\n')[0].trim().slice(0, 60) });
  }
}

if (!hits.length) {
  console.log(`✓ no backticks in HTML comments (${files.length} file(s))`);
  process.exit(0);
}
for (const h of hits) {
  console.error(`✗ ${h.f}:${h.line} — ${h.n} backtick(s) in an HTML comment`);
  console.error(`    ${h.snippet}…`);
}
console.error('');
console.error('  A backtick ends the template literal the markup is written in. An odd count');
console.error('  is a syntax error pointing somewhere else entirely; an even count can COMPILE');
console.error('  and emit code from what you meant as prose. Drop the backticks.');
if (process.argv.includes('--check')) process.exit(1);
