// Every import specifier in the emitted JS must resolve to a file that exists.
//
// A missing module is not a 404 in this app: `frontendDist` is `../frontend`, so the Tauri
// asset protocol answers with index.html, and the browser rejects it with
//
//   Failed to load module script: Expected a JavaScript-or-Wasm module script but the
//   server responded with a MIME type of "text/html".
//
// which reads like a server configuration problem and is really a path that isn't there.
// It cost two rounds of debugging, and `tsc` cannot catch it: the specifier that broke was
// `../../node_modules/@tauri-apps/api/event.js`, which type-checks fine because the package
// really is installed — just not anywhere the webview can reach, since the real
// node_modules sits outside frontendDist entirely.
//
// A `.catch()` around a dynamic import does not help either. The fallback runs, the app
// keeps working, and the console error is logged anyway — so this stays invisible in
// testing and shows up in every user's devtools.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JS_DIR = join(ROOT, 'frontend', 'js');

// `from '…'` and `import('…')`, relative specifiers only — bare ones are not served here.
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.[^'"]+)['"]/g;

// Comments first, or a code EXAMPLE inside one reads as a real import.
//
// tsc keeps comments, so a doc comment explaining what a parser matches — api-map.ts writes
// `await import('../core/api.js')` to describe the shape it looks for — arrives in the emitted
// JS and fails this check against a path that was never meant to resolve. The report is
// convincing (real file, real line number) and the import does not exist, so the fix is to
// hunt a bug that isn't there.
//
// Reuses the dev tool's scanner rather than a second regex: it already handles regex literals
// and template `${}` holes, and it preserves newlines, so the line numbers below stay true.
// Depending on the compiled tree is consistent — this checker's whole input is that tree.
const { stripComments } = await import('../frontend/js/features/dev/dep-graph.js');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

if (!existsSync(JS_DIR)) {
  console.error('✗ frontend/js is missing — run `npm run compile` first');
  process.exit(1);
}

let checked = 0;
const missing = [];
for (const file of walk(JS_DIR)) {
  const text = stripComments(readFileSync(file, 'utf8'));
  for (const m of text.matchAll(SPEC)) {
    const spec = m[1];
    checked++;
    const base = dirname(file);
    const candidates = [spec, `${spec}.js`, `${spec}/index.js`].map((s) => resolve(base, s));
    if (candidates.some(existsSync)) continue;
    const line = text.slice(0, m.index).split('\n').length;
    missing.push(`${relative(ROOT, file)}:${line} → ${spec}`);
  }
}

if (missing.length) {
  console.error(`✗ ${missing.length} import(s) point at files that do not exist:`);
  for (const m of missing) console.error(`  ${m}`);
  console.error('\n  In the app these do not 404 — index.html is served instead, and the');
  console.error('  browser reports a MIME type error that looks like a server problem.');
  process.exit(1);
}
console.log(`✓ every emitted import resolves (${checked} checked)`);
