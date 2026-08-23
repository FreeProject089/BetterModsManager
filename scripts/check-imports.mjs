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

// EVERY specifier, not just the relative ones.
//
// This used to match `\.[^'"]+` only, on the reasoning that bare specifiers "are not served
// here" — true, and exactly why one must never appear. Nothing bundles this frontend: the
// compiled JS is loaded by the webview as plain ES modules, with no import map. A bare
// specifier therefore does not 404 and fall back to index.html the way a wrong relative path
// does; it throws `Failed to resolve module specifier` at parse time, and the whole module —
// plus whatever called it — dies with it.
//
// Not hypothetical: `import('@tauri-apps/api/event')` in repo-ssh.ts took down the entire
// Server Repo screen, because initRepoSsh threw and initRepo never finished. tsc was happy
// (the package IS installed, for its types) and this checker skipped the line by design.
//
// The fix for a bare Tauri import is never a relative path into node_modules — that sits
// outside frontendDist and the webview cannot reach it either. Read the API off the global:
// `withGlobalTauri: true` puts it on `window.__TAURI__`.
// `[^'"\s]+` and not `[^'"]+`: widening the capture to "anything" made `from '` match text
// INSIDE template literals (stripComments keeps those, deliberately), and the checker
// reported nine phantom imports whose "specifier" was half a line of generated HTML. A module
// specifier never contains whitespace, so excluding it costs nothing and removes the class.
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"\s]+)['"]/g;

// Three kinds of specifier, and only one of them is checkable on disk.
//
//   remote   https://unpkg.com/…   fetched over the network; nothing local to verify
//   local    ./x.js, /x.js         must exist under frontend/js
//   bare     @tauri-apps/api/…     cannot resolve at all, ever
const isRemote = (s) => /^[a-z][a-z0-9+.-]*:/i.test(s);
const isLocal = (s) => s.startsWith('.') || s.startsWith('/');

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
const bare = [];
let remote = 0;
for (const file of walk(JS_DIR)) {
  const text = stripComments(readFileSync(file, 'utf8'));
  for (const m of text.matchAll(SPEC)) {
    const spec = m[1];
    // Is this match INSIDE a string literal rather than a real import?
    //
    // Two different false positives, one cause. `getElementById('activity-date-from')` ends
    // in `from'`, so the pattern matched from inside the id and captured the rest of the
    // line. And plugins.js is a script GENERATOR: it holds Node source as data, including
    // "import { execSync } from 'child_process';" — a perfectly real import, for a file the
    // user downloads and runs outside the app.
    //
    // A real import's specifier is the FIRST quote on its line, so the text before it holds
    // an even number of each quote character. Inside a string literal it is odd. That single
    // rule removes both classes without a per-file skip list, which would also hide genuine
    // bare imports in the skipped file.
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const prefix = text.slice(lineStart, m.index);
    const odd = (ch) => (prefix.split(ch).length - 1) % 2 === 1;
    if (odd("'") || odd('"') || odd('`')) continue;
    checked++;
    if (isRemote(spec)) { remote++; continue; }
    if (!isLocal(spec)) {
      const line = text.slice(0, m.index).split('\n').length;
      bare.push(`${relative(ROOT, file)}:${line} → ${spec}`);
      continue;
    }
    const base = dirname(file);
    const candidates = [spec, `${spec}.js`, `${spec}/index.js`].map((s) => resolve(base, s));
    if (candidates.some(existsSync)) continue;
    const line = text.slice(0, m.index).split('\n').length;
    missing.push(`${relative(ROOT, file)}:${line} → ${spec}`);
  }
}

if (bare.length) {
  console.error(`✗ ${bare.length} BARE import specifier(s) — nothing resolves these at runtime:`);
  for (const b of bare) console.error(`  ${b}`);
  console.error('\n  There is no bundler and no import map here: the browser throws');
  console.error('  "Failed to resolve module specifier" and the module never loads.');
  console.error('  For Tauri APIs read the global instead — window.__TAURI__.event.listen, etc.');
}

if (missing.length) {
  console.error(`✗ ${missing.length} import(s) point at files that do not exist:`);
  for (const m of missing) console.error(`  ${m}`);
  console.error('\n  In the app these do not 404 — index.html is served instead, and the');
  console.error('  browser reports a MIME type error that looks like a server problem.');
  process.exit(1);
}
if (bare.length) process.exit(1);
console.log(`✓ every emitted import resolves (${checked} checked, ${remote} remote URL(s) skipped)`);
