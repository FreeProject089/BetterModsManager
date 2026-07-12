#!/usr/bin/env node
// CI gate: no NEW hard-coded text colours.
//
// Themes only swap the --bmm-* tokens, so any literal `color: #fff / white /
// black / rgb(255…)` is stuck — it stays white when the user picks a light theme
// (the "white text on a light background" bug) and vice-versa. Text colours must
// go through a token: --bmm-text-primary/secondary/muted, or --bmm-text-on-accent
// for text that sits on a coloured accent/badge fill.
//
// The codebase already has a backlog of these, so this gate is *baselined*: it
// only fails on offenders that aren't in scripts/hardcoded-colors-baseline.json.
// Fix one and it drops out of the baseline automatically; add a new one and the
// build fails. Regenerate the baseline (only when intentionally accepting the
// current set) with:  node scripts/check-hardcoded-colors.mjs --update
//
// tokens.css is exempt (it DEFINES the literals) and debug.css is exempt (the
// DevTools overlay is intentionally always-dark).

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BASELINE = join(__dirname, 'hardcoded-colors-baseline.json');

// A literal text colour: the `color` property (not background-/border-/-color)
// set to a white/black-family literal instead of a var().
const OFFENDER = /(?<![a-z-])color\s*:\s*(#fff(?:fff)?\b|#000(?:000)?\b|\bwhite\b|\bblack\b|rgba?\(\s*255\s*,\s*255\s*,\s*255|rgba?\(\s*0\s*,\s*0\s*,\s*0)/i;

// Directories to skip entirely.
const SKIP_DIRS = new Set(['node_modules', 'js', 'Lang', 'target', '.git', 'dist', '.vite']);
// Files exempt from the rule.
const EXEMPT = new Set(['tokens.css', 'debug.css']);
// Extensions to scan.
const EXTS = ['.css', '.ts', '.html'];

/** Recursively collect scannable files under frontend/. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXTS.some((e) => name.endsWith(e)) && !EXEMPT.has(name)) out.push(full);
  }
  return out;
}

/** Stable key: repo-relative path + the trimmed offending text (NOT line number,
 *  which shifts on every edit). */
function keyFor(file, text) {
  return `${relative(ROOT, file).replace(/\\/g, '/')}::${text.trim()}`;
}

function collect() {
  const found = new Map(); // key -> { file, line, text }
  for (const file of walk(join(ROOT, 'frontend'))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (OFFENDER.test(line)) {
        const k = keyFor(file, line);
        if (!found.has(k)) found.set(k, { file, line: i + 1, text: line.trim() });
      }
    });
  }
  return found;
}

const found = collect();

if (process.argv.includes('--update')) {
  const keys = [...found.keys()].sort();
  writeFileSync(BASELINE, JSON.stringify(keys, null, 2) + '\n');
  console.log(`✓ baseline written: ${keys.length} known hard-coded text colour(s)`);
  process.exit(0);
}

const baseline = existsSync(BASELINE)
  ? new Set(JSON.parse(readFileSync(BASELINE, 'utf8')))
  : new Set();

const offenders = [...found.entries()].filter(([k]) => !baseline.has(k));

if (offenders.length) {
  console.error(`✗ ${offenders.length} NEW hard-coded text colour(s) — use a --bmm-text-* token`);
  console.error(`  (--bmm-text-primary/secondary/muted, or --bmm-text-on-accent on a coloured fill)\n`);
  for (const [, o] of offenders) {
    console.error(`  ${relative(ROOT, o.file).replace(/\\/g, '/')}:${o.line}  ${o.text}`);
  }
  console.error(`\n  If these are intentional, run: node scripts/check-hardcoded-colors.mjs --update`);
  process.exit(1);
}

const stale = [...baseline].filter((k) => !found.has(k)).length;
console.log(
  `✓ no new hard-coded text colours (${found.size} known${stale ? `, ${stale} fixed since baseline` : ''})`,
);
