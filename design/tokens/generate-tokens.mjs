#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// BMM → W3C Design Tokens (DTCG) generator
//
// Reads the official theming surface (frontend/css/tokens.css, the --bmm-*
// custom properties) and every built-in theme (frontend/assets/builtin-themes)
// and emits Design Tokens Community Group JSON files, importable into Penpot
// (native design-tokens support) or Figma (Variables / Tokens Studio).
//
//   node design/tokens/generate-tokens.mjs
//
// Outputs into design/tokens/out/:
//   bmm.default.tokens.json          — the full default token set
//   themes/bmm.<id>.tokens.json      — per built-in theme, ONLY its overrides
//
// Zero dependencies. Classification is heuristic but conservative: anything we
// can't confidently type is emitted WITHOUT a $type (spec-legal; importers may
// skip those) under its raw string value, so nothing is silently mistyped.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const TOKENS_CSS = join(ROOT, 'frontend', 'css', 'tokens.css');
const THEMES_DIR = join(ROOT, 'frontend', 'assets', 'builtin-themes');
const OUT_DIR = join(HERE, 'out');
const OUT_THEMES = join(OUT_DIR, 'themes');

// ── 1. Parse the :root block of tokens.css ─────────────────────────────────
function parseCssVars(css) {
  // Strip comments first so commented-out declarations never register.
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const vars = new Map();
  // Declarations can share a line; match each `--name: value;` pair.
  const re = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(noComments)) !== null) {
    const name = m[1].trim();
    // The surface is every --bmm-* token PLUS the --space-* scale (which has no --bmm-
    // counterpart). All other bare --name tokens are legacy compat aliases → skipped.
    if (!name.startsWith('--bmm-') && !name.startsWith('--space-')) continue;
    vars.set(name, m[2].trim().replace(/\s+/g, ' '));
  }
  return vars;
}

// Bare token name (drop the --bmm-/-- prefix) — used for grouping + the DTCG key.
const bareName = (name) => name.replace(/^--(bmm-)?/, '');

// ── 2. Classify a token → DTCG $type (or null = leave untyped) ─────────────
const COLOR_VALUE = /^(#([0-9a-fA-F]{3,8})|rgba?\([^)]*\)|hsla?\([^)]*\)|transparent|white|black)$/;
const DIMENSION = /^-?\d+(\.\d+)?(px|rem|em|vh|vw|%)$/;
const NUMBER = /^-?\d+(\.\d+)?$/;

function classify(name, value) {
  const bare = bareName(name);
  // Pure var() reference → alias (type comes from the target at import time).
  const aliasMatch = value.match(/^var\((--bmm-[a-zA-Z0-9-]+)\)$/);
  if (aliasMatch) return { type: null, alias: aliasMatch[1] };
  // RGB channel triplets are plain numbers used for rgba() composition.
  if (/-(r|g|b)$/.test(bare) && NUMBER.test(value)) return { type: 'number' };
  if (COLOR_VALUE.test(value) && !value.includes('var(')) return { type: 'color' };
  if (DIMENSION.test(value)) return { type: 'dimension' };
  if (NUMBER.test(value)) return { type: 'number' };
  if (/font-(sans|mono)/.test(bare)) return { type: 'fontFamily' };
  // Shadows/glows, gradients, url(...), computed rgba(var(...)) → untyped raw.
  return { type: null };
}

// Sub-grouping keeps the Penpot/Figma tree navigable.
function groupOf(bare, type) {
  if (/^(bg|border|accent|cyan|success|warning|danger|amber|purple|info|text|brand|chart|diagram|surface|s\d\d|glass|toast|tasky|titlebar)/.test(bare) && type === 'color') return 'color';
  if (/-(r|g|b)$/.test(bare)) return 'channel';
  if (type === 'dimension' || /^(space|radius|sidebar-w|titlebar-h|font-size|font-scale)/.test(bare)) return 'size';
  if (/^font/.test(bare)) return 'font';
  if (/shadow|glow|lift/.test(bare)) return 'shadow';
  if (/img|image|url|logo|mascot|loader/.test(bare)) return 'asset';
  if (/anim|transition|duration/.test(bare)) return 'motion';
  return type === 'color' ? 'color' : 'other';
}

// ── 3. Build a DTCG tree from a map of vars ────────────────────────────────
function toDtcg(vars, { description }) {
  const rootGroup = { $description: description };
  let typed = 0, untyped = 0, aliases = 0;
  for (const [name, value] of vars) {
    const bare = bareName(name);
    const cls = classify(name, value);
    const grp = groupOf(bare, cls.type);
    rootGroup[grp] ??= {};
    const token = {};
    if (cls.alias) {
      const target = bareName(cls.alias);
      const targetVal = vars.get(cls.alias);
      const targetCls = targetVal ? classify(cls.alias, targetVal) : { type: null };
      const targetGrp = groupOf(target, targetCls.type);
      token.$value = `{bmm.${targetGrp}.${target}}`;
      aliases++;
    } else {
      token.$value = value;
    }
    if (cls.type) { token.$type = cls.type; typed++; } else if (!cls.alias) { untyped++; }
    token.$description = `CSS: ${name}`;
    rootGroup[grp][bare] = token;
  }
  return { tree: { bmm: rootGroup }, stats: { typed, untyped, aliases, total: vars.size } };
}

// ── 4. Default set from tokens.css ─────────────────────────────────────────
mkdirSync(OUT_THEMES, { recursive: true });
const cssVars = parseCssVars(readFileSync(TOKENS_CSS, 'utf8'));
const def = toDtcg(cssVars, { description: 'BMM default design tokens — generated from frontend/css/tokens.css. Do not edit by hand; run design/tokens/generate-tokens.mjs.' });
writeFileSync(join(OUT_DIR, 'bmm.default.tokens.json'), JSON.stringify(def.tree, null, 2) + '\n');
console.log(`bmm.default.tokens.json  — ${def.stats.total} tokens (${def.stats.typed} typed, ${def.stats.aliases} aliases, ${def.stats.untyped} raw)`);

// ── 5. One overlay file per built-in theme (only its overrides) ────────────
for (const file of readdirSync(THEMES_DIR).filter(f => f.endsWith('.bmmtheme.json')).sort()) {
  const theme = JSON.parse(readFileSync(join(THEMES_DIR, file), 'utf8'));
  const vars = new Map(Object.entries(theme.vars || {}).filter(([k]) => k.startsWith('--bmm-')));
  if (!vars.size) { console.log(`(skip ${file} — no --bmm- vars)`); continue; }
  const { tree, stats } = toDtcg(vars, {
    description: `BMM theme "${theme.name}" (${theme.id}${theme.mode ? ', ' + theme.mode : ''}) — token OVERRIDES over bmm.default. Generated from frontend/assets/builtin-themes/${file}.`,
  });
  const out = `bmm.${theme.id}.tokens.json`;
  writeFileSync(join(OUT_THEMES, out), JSON.stringify(tree, null, 2) + '\n');
  console.log(`themes/${out}  — ${stats.total} overrides (${stats.typed} typed)`);
}
console.log('\nDone. Import bmm.default.tokens.json first; add a theme file as a second set to preview that theme.');
