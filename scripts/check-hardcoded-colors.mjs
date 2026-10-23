#!/usr/bin/env node
// CI gate: no NEW hard-coded text colours.
//
// Themes only swap the --bmm-* tokens, so ANY literal `color:` (or SVG fill/stroke) is
// stuck. The obvious case is `color: #fff` staying white under a light theme, but a
// chromatic literal like `color: #94a3b8` is just as broken: it ignores every theme, in
// both directions. Text colours must go through a token: --bmm-text-primary/secondary/
// muted, or --bmm-text-on-accent for text that sits on a coloured accent/badge fill.
//
// This gate is *baselined*: it only fails on offenders that aren't in
// scripts/hardcoded-colors-baseline.json. Fix one and it drops out automatically;
// add a new one and the build fails. Regenerate the baseline (only when
// intentionally accepting the current set) with:
//     node scripts/check-hardcoded-colors.mjs --update
//
// THE BASELINE IS NO LONGER A BACKLOG. It started at 301 and every convertible one
// has been converted. What remains is an allowlist, and each entry is there for a
// reason worth knowing before you "fix" it:
//
//   · Standalone documents — the benchmark HTML report, dev-pages/, the
//     tutorial games in their iframes. They link no BMM stylesheet, so a var()
//     resolves to nothing and the page renders with no colours at all.
//   · Brand colours — Ko-fi orange, Discord blurple, the BetterCommunity yellow.
//     A theme that recolours someone else's logo is wrong, not configurable.
//   · Ink on a saturated fill — white on red, black on amber, black on green.
//     --bmm-text-on-accent is the ink for the ACCENT fill and defaults to white; a
//     light-accent theme may set it dark, which fails on a saturated red. These are
//     contrast requirements, not choices. (--bmm-text-on-accent IS used wherever the
//     fill really is var(--bmm-accent) — that is the case it exists for.)
//   · Palettes that must stay distinguishable — the highlight.js syntax colours, the
//     "major" badge's orange (warning is already worn by the badge beside it).
//   · The light-theme <option> rescue, which needs a guaranteed pair on a forced white.
//
// If you are adding a colour, none of the above applies to you: use a token.
//
// tokens.css is exempt (it DEFINES the literals) and debug.css is exempt (the
// DevTools overlay is intentionally always-dark).

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BASELINE = join(__dirname, 'hardcoded-colors-baseline.json');

// A literal text colour: the `color` property (not background-/border-/-color), or an SVG
// `fill`/`stroke`, set to ANY literal instead of a var().
//
// This used to match only the white/black family. That hid the bigger half of the problem:
// a chromatic literal (`color:#94a3b8`, `color:#ef4444`) is just as un-themable, because a
// hard-coded colour inside a stylesheet is never rewritten on a dark->dark theme change —
// the runtime rescue layers only touch inline styles, a fixed hex table, and light themes.
// Widening it took the known count from 125 to the real figure; everything already in the
// codebase is baselined, so this only gates NEW ones.
// `rgba(var(--bmm-accent-r),…,0.65)` is NOT a literal — the channels come from tokens and a theme
// moves it. Flagging it sent the reader looking for a hard-coded colour that was not there, and
// the only "fix" available would have been to make it less themable.
const LITERAL = String.raw`#[0-9a-f]{3,8}\b|\brgba?\((?!\s*var\()|\bhsla?\((?!\s*var\()|\b(?:white|black|red|blue|green|yellow|orange|purple|pink|gray|grey|cyan|magenta|silver|gold|navy|teal|lime|maroon|olive|aqua|fuchsia)\b`;
const OFFENDER = new RegExp(String.raw`(?<![a-z-])(?:color|fill|stroke)\s*:\s*(?:${LITERAL})`, 'i');

// Directories to skip entirely. `docs/diagrams` is exempt on purpose: those files are
// Mermaid source, and a `style X fill:…,color:…` directive is parsed by Mermaid, not by
// CSS — a var() there does not resolve. Their palette is data-viz, not app chrome, and the
// diagram container already themes what it can via --bmm-diagram-*.
const SKIP_DIRS = new Set(['node_modules', 'js', 'Lang', 'target', '.git', 'dist', '.vite', 'diagrams']);
// Files exempt from the rule.
const EXEMPT = new Set(['tokens.css', 'debug.css']);
// The DevTools overlay is exempt as a whole, not just its stylesheet. debug.css was already
// exempt for being "intentionally always-dark", but the same overlay is built from
// features/debug/*.ts, and those were being gated — the same surface judged two ways.
// The overlay must stay readable while you are DEBUGGING A THEME, which is exactly when
// following that theme would make it unusable; and its code viewer uses editor syntax colours
// (#9cdcfe / #ce9178), which are a language palette, not app chrome.
const EXEMPT_DIRS = [join('frontend', 'src', 'features', 'debug')];
// Extensions to scan.
const EXTS = ['.css', '.ts', '.html'];

/** A literal inside an ATTRIBUTE SELECTOR is the pattern being fixed, not a colour being painted.
 *
 *  The light-theme rescue layer in theme-engine.ts is built entirely out of these:
 *      [style*="color: #94a3b8"] { color: var(--bmm-text-secondary) !important; }
 *  Reporting that line asks for exactly the wrong change — "fixing" the literal would stop the
 *  selector matching the inline styles it exists to override, and quietly disable the rescue. */
const inAttributeSelector = (line) => /\[[a-z-]+[*^$~|]?=\s*["'][^"']*$/i.test(line.slice(0, line.search(OFFENDER)));

/** A colour inside a placeholder or a tooltip is TEXT SHOWN TO THE USER, not paint.
 *  navbar-customize offers `placeholder="body { color: white }"` as an example of the CSS you
 *  can type into a custom page. Reporting it invites someone to "fix" the example. */
const inUserFacingText = (line) => {
  const before = line.slice(0, line.search(OFFENDER));
  const attr = /\b(placeholder|title|aria-label|data-tooltip)\s*=\s*["'][^"']*$/i;
  return attr.test(before);
};

/** Recursively collect scannable files under frontend/. */
function walk(dir, out = []) {
  if (EXEMPT_DIRS.some((d) => relative(ROOT, dir).replace(/\\/g, '/') === d.replace(/\\/g, '/'))) return out;
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
      if (OFFENDER.test(line) && !inAttributeSelector(line) && !inUserFacingText(line)) {
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
  console.error(`✗ ${offenders.length} NEW hard-coded text colour(s) — use a --bmm-* token`);
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
