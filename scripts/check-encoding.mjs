#!/usr/bin/env node
// check-encoding — catches text that has been re-encoded by a tool that assumed the wrong
// charset, before it ships.
//
// The failure this exists for: PowerShell 5.1's `Get-Content` reads a UTF-8 file as Windows-1252
// unless told otherwise, and `Set-Content` then writes those mis-decoded characters back as
// UTF-8. Every accent becomes two characters — "intégrité" turns into "intÃ©gritÃ©" — and
// nothing else notices. tsc is happy, the app builds, and the damage only shows up on screen.
// It happened to docs-hub.ts and shipped 3242 mangled sequences into the in-app docs.
//
// Detection is signature-based rather than heuristic: the sequences below are what UTF-8 accents
// look like after that specific round trip. They effectively never occur in correct text.
//
// Usage: node scripts/check-encoding.mjs
// Exit 1 if any file looks double-encoded.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// `tmp` is scratch space — and it already holds a fix_encoding script from a previous round of
// this same problem, which is the best argument for having this gate at all.
const SKIP = new Set(['node_modules', '.git', 'target', 'dist', '.Assets', 'BCW', 'BetterInstaller', 'BMM Docs', 'tmp']);
// This file necessarily quotes the mangled sequences it looks for.
const SELF = 'scripts\\check-encoding.mjs';
const EXT = /\.(ts|mjs|cjs|js|json|md|css|html|rs|yml|yaml)$/i;
const MAX = 8 * 1024 * 1024;

// "Ã©" = é, "â€™" = ’, "Â·" = ·, and so on for the accents this codebase actually uses.
const MANGLED = /Ã[ -ÿ]|â€[¦]|Â[ -¿]/g;

const bad = [];
(function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const n of entries) {
    if (SKIP.has(n)) continue;
    const p = join(dir, n);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { walk(p); continue; }
    if (!EXT.test(n) || st.size > MAX) continue;
    let text;
    try { text = readFileSync(p, 'utf8'); } catch { continue; }
    const rel = relative(ROOT, p);
    if (rel === SELF || rel.replace(/\\/g, '/') === SELF.replace(/\\/g, '/')) continue;
    const hits = text.match(MANGLED);
    if (hits && hits.length) {
      // One or two can be a deliberate mention; a real re-encode produces dozens.
      bad.push({ file: rel, count: hits.length, sample: hits.slice(0, 3).join(' ') });
    }
  }
})(ROOT);

const real = bad.filter((b) => b.count >= 3);
if (!real.length) {
  console.log(`✓ encoding OK${bad.length ? ` (${bad.length} file(s) with 1-2 look-alike sequences, ignored)` : ''}`);
  process.exit(0);
}
console.error('✗ double-encoded text (UTF-8 read as Windows-1252, then written back as UTF-8):\n');
for (const b of real) console.error(`  ${String(b.count).padStart(5)}×  ${b.file}   e.g. ${b.sample}`);
console.error('\n  Do NOT edit source files with PowerShell Get-Content/Set-Content — they re-encode.');
console.error('  To repair: read as utf8, map the chars back to Windows-1252 bytes, decode as utf8.');
process.exit(1);
