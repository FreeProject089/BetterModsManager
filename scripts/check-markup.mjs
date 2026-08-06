#!/usr/bin/env node
// CI gate: no HTML attribute delimited by a typographic quote.
//
// `style=”display:flex”` — with U+201D instead of `"` — is not a syntax error anywhere. TypeScript
// compiles it, the template literal is valid, nothing warns. But a browser cannot read it as a
// quoted attribute: it falls back to the unquoted form and stops at the first space. The markup
// looks completely normal in the editor and does nothing at all in the app.
//
// This was not hypothetical. The plugin quick-tools panel was written this way throughout — 71
// attributes across style, class, id, value, placeholder, type and rows. The panel rendered with
// no styling, and because `id=”plug-qt-import-path”` never produced that id, every getElementById
// bound to it returned null and every handler on the panel was dead. It shipped like that until a
// COLOUR lint happened to flag one of the lines for an unrelated reason.
//
// Two spellings of a quote that look the same in most editors, one of which silently disables the
// markup, is exactly what a machine should be checking.
//
// Usage: node scripts/check-markup.mjs        (exit 1 on any hit)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// `js` is the compiled mirror of `src`; checking it would report every hit twice.
const SKIP = new Set(['node_modules', 'target', '.git', 'dist', '.vite', 'js', 'Lang']);
const EXTS = ['.ts', '.html', '.css'];

/** An attribute name, then `=`, then a curly quote where a straight one belongs. */
const CURLY_ATTR = /\b([\w-]+)\s*=\s*[“”‘’]/g;

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (EXTS.some((e) => name.endsWith(e))) files.push(p);
  }
})(join(ROOT, 'frontend'));

let hits = 0;
for (const f of files) {
  const rel = relative(ROOT, f).replace(/\\/g, '/');
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    for (const m of line.matchAll(CURLY_ATTR)) {
      hits++;
      console.error(`  ${rel}:${i + 1}  attribute "${m[1]}" is delimited by a typographic quote — a browser cannot parse it`);
    }
  });
}

if (hits) {
  console.error(`\n✗ ${hits} attribute(s) a browser will not parse — replace “ ” with " `);
  process.exit(1);
}
console.log(`✓ markup OK (${files.length} files, no typographic quotes in attributes)`);
