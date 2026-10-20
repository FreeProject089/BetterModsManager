#!/usr/bin/env node
// check-native-dialogs — no new native confirm / alert / prompt in the UI.
//
// WHY THIS EXISTS
//
// In the Tauri webview the browser's own dialogs are broken in two different ways, and both
// read as « the button does nothing »:
//   · window.confirm / alert / prompt: tauri-plugin-dialog 2.x has no `confirm` command, so the
//     webview's call rejects as an uncaught promise while the synchronous call returns undefined
//     at once. `if (!confirm(…)) return;` silently answers « no »; `if (confirm(…))` never runs.
//   · core/api.ts askConfirm → `dlg_confirm`: it does open, but as a bare Windows message box:
//     not themed, its buttons not translated, outside the app's keyboard rules, and it blocks
//     the whole window (owner, Oct 20: « confirmations must be BMM modals, not Windows dialogs »).
// BMM's own dialogs are ui/verify.ts — confirmAction({ title, message, confirmLabel, tone }) and
// promptText({ … }) — on the house modal shell (and ui/confirm.ts showConfirm for the static
// #modal-confirm-generic).
//
// WHAT IT COUNTS, per file of frontend/src, comments and strings removed first:
//   · `window.confirm(` `window.alert(` `window.prompt(`
//   · a bare `confirm(` `alert(` `prompt(` call — not a method (`x.confirm(`), not a definition
//     (`function confirm(`, `async confirm(p: …)`, `confirm(p: T): …;`), and not in a file that
//     binds its own `confirm` / `alert` / `prompt` (`const confirm = window.confirmCustom`)
//   · `askConfirm(` outside core/api.ts (where it is defined)
// and compares with scripts/native-dialogs-allowlist.json ({ file: { kind: { count, why } } }).
// More than listed, or a file not listed → fail: use ui/verify.ts. Fewer than listed → fail
// too: lower the count (the list only goes down; a count left high hides the next addition).
//
// Usage: node scripts/check-native-dialogs.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'frontend', 'src');
const ALLOW = JSON.parse(readFileSync(join(ROOT, 'scripts', 'native-dialogs-allowlist.json'), 'utf8'));

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

/**
 * Code only: comments removed, string and template-literal TEXT replaced by spaces (the code
 * inside `${…}` is kept). A tiny scanner rather than a regex: a regex that strips `//` also eats
 * the `//` in 'https://…', which is how another gate of this repo once went wrong.
 */
export function codeOnly(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const stack = []; // template nesting: each entry counts the braces opened inside its ${ }
  let mode = 'code';
  let quote = '';
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; } i += 2; continue; }
      if (c === '\'' || c === '"') { mode = 'str'; quote = c; out += c; i++; continue; }
      if (c === '`') { mode = 'tpl'; out += c; i++; continue; }
      if (stack.length) {
        if (c === '{') stack[stack.length - 1]++;
        else if (c === '}') {
          if (stack[stack.length - 1] === 0) { stack.pop(); mode = 'tpl'; out += c; i++; continue; }
          stack[stack.length - 1]--;
        }
      }
      out += c; i++; continue;
    }
    if (mode === 'str') {
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === quote || c === '\n') { mode = 'code'; out += c; i++; continue; }
      out += ' '; i++; continue;
    }
    // template literal text
    if (c === '\\') { out += '  '; i += 2; continue; }
    if (c === '`') { mode = 'code'; out += c; i++; continue; }
    if (c === '$' && d === '{') { stack.push(0); mode = 'code'; out += '${'; i += 2; continue; }
    out += c === '\n' ? '\n' : ' '; i++;
  }
  return out;
}

const WINDOW = /\bwindow\s*\.\s*(confirm|alert|prompt)\s*\(/g;
const BARE = /(?<![\w$.])(confirm|alert|prompt)\s*\(/g;
const ASK = /(?<![\w$.])askConfirm\s*\(/g;

export function count(rel, src) {
  const code = codeOnly(src);
  const found = {};
  const add = (k) => { found[k] = (found[k] || 0) + 1; };
  for (const m of code.matchAll(WINDOW)) add(`window.${m[1]}`);
  for (const m of code.matchAll(BARE)) {
    const name = m[1];
    // The file binds its own name (a local helper, the in-app confirmCustom): not the native one.
    if (new RegExp(`\\b(const|let|var|function)\\s+${name}\\b|\\b${name}\\s*:\\s*\\(`).test(code)) continue;
    const before = code.slice(Math.max(0, m.index - 20), m.index);
    if (/(function|async|get|set)\s+$/.test(before)) continue;
    // A method signature: `confirm(p: T): R;` or `confirm(p: T) {` at the start of a line.
    const lineStart = code.lastIndexOf('\n', m.index) + 1;
    const line = code.slice(lineStart, code.indexOf('\n', m.index) === -1 ? undefined : code.indexOf('\n', m.index));
    if (/^\s*(async\s+)?(confirm|alert|prompt)\s*\([^)]*:\s*[^)]*\)\s*[:{]/.test(line)) continue;
    add(name);
  }
  if (rel !== 'frontend/src/core/api.ts') for (const _ of code.matchAll(ASK)) add('askConfirm');
  return found;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const problems = [];
  const seen = new Set();
  for (const f of walk(SRC).filter((p) => p.endsWith('.ts'))) {
    const rel = relative(ROOT, f).split('\\').join('/');
    const found = count(rel, readFileSync(f, 'utf8'));
    const allow = ALLOW[rel] || {};
    for (const [kind, n] of Object.entries(found)) {
      seen.add(`${rel}|${kind}`);
      const max = allow[kind]?.count ?? 0;
      if (n > max) problems.push(`${rel}: ${n} × ${kind}(…)${max ? ` (${max} listed)` : ''}. Use ui/verify.ts confirmAction / promptText (a BMM dialog), not a native one.`);
      else if (n < max) problems.push(`${rel}: ${kind} listed ${max}, found ${n}. Lower the count in scripts/native-dialogs-allowlist.json.`);
    }
  }
  for (const [rel, kinds] of Object.entries(ALLOW)) {
    if (rel.startsWith('_')) continue;
    for (const kind of Object.keys(kinds)) if (!seen.has(`${rel}|${kind}`)) problems.push(`${rel}: ${kind} is listed but no longer found. Remove the entry from scripts/native-dialogs-allowlist.json.`);
  }
  if (problems.length) {
    console.error(`✗ native dialogs: ${problems.length} problem(s)`);
    for (const p of problems) console.error('  ' + p);
    process.exit(1);
  }
  const listed = Object.entries(ALLOW).filter(([k]) => !k.startsWith('_')).reduce((a, [, v]) => a + Object.values(v).reduce((b, x) => b + x.count, 0), 0);
  console.log(`✓ native dialogs: none new (${listed} older call(s) listed with a reason, to be moved to ui/verify.ts)`);
}
