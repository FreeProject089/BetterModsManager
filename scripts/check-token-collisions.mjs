// No stylesheet may redefine a `:root` token that tokens.css owns.
//
// tokens.css is the palette: it defines the `--bmm-*` tokens and the short aliases
// (`--text-primary: var(--bmm-text-primary)`) that the theme engine drives. Every other
// stylesheet loads AFTER it, so a `:root { --text-primary: … }` anywhere else wins on
// order at equal specificity — and silently pins that token to a constant, in every
// theme, forever.
//
// debug.css did exactly that with --text-primary / --text-secondary / --text-muted. The
// symptom was white text on white surfaces across the light themes, and the cause was in
// a file about the DevTools overlay, which is nowhere anyone would look. Nothing about
// reading either file suggests they are related.
//
// Rule: private tokens get a private prefix. --debug-text-primary collides with nothing.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = join(ROOT, 'frontend/css');

/** Custom properties declared inside a `:root { … }` block.
 *
 * Comments are stripped first. Without that the checker reads prose: this very file's
 * fix is documented in debug.css with the old token names spelled out, and the first
 * version of this guard failed on its own explanation. */
function rootTokens(src) {
  const css = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Set();
  // `:root` possibly in a selector list, up to the matching close brace. Good enough:
  // these files do not nest braces inside a :root block.
  for (const m of css.matchAll(/(^|\})([^{}]*\B:root\b[^{}]*)\{([^}]*)\}/g)) {
    for (const d of m[3].matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) out.add(d[1]);
  }
  return out;
}

const owner = 'tokens.css';
const owned = rootTokens(readFileSync(join(CSS, owner), 'utf8'));

const clashes = [];
for (const file of readdirSync(CSS).filter((f) => f.endsWith('.css') && f !== owner)) {
  const mine = rootTokens(readFileSync(join(CSS, file), 'utf8'));
  for (const tok of mine) if (owned.has(tok)) clashes.push([file, tok]);
}

if (clashes.length) {
  console.error(`✗ ${clashes.length} token(s) redefined on :root outside ${owner}:`);
  for (const [file, tok] of clashes.sort()) console.error(`  ${basename(file).padEnd(18)} ${tok}`);
  console.error(`\n  These load after ${owner} and win at equal specificity, pinning the`);
  console.error('  token to a constant in every theme. Give private tokens a private prefix.');
  process.exit(1);
}

console.log(`✓ no :root token collisions (${owned.size} owned by ${owner})`);
