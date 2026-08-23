// Every translation attribute in index.html must name a key that EXISTS in both languages.
//
// Nothing checked this. check-i18n-keys.mjs reads t() calls in TypeScript, and
// check-hardcoded-text.mjs treats the mere PRESENCE of a data-i18n attribute as proof the
// element is translated — it never asks whether the key resolves. So a typo, or a key nobody
// ever added, sailed through every gate and shipped: applyTranslations() finds nothing and
// leaves the literal text baked into the markup, in BOTH languages. It looks like a design
// choice rather than a bug, which is why it survives review.
//
// Caught the day this was written: seven attributes added in one sitting, all green, all
// untranslated — plus three older ones whose baked-in fallback is FRENCH, so the English UI
// was reading "Ne plus m'avertir".
//
// WHICH attributes count is read out of i18n.ts rather than listed here. index.html also
// carries data-i18n-tab / -filter / -panel, which are state, not keys; hardcoding a list
// would either flag those or silently miss a destination added to the runtime later.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'frontend/index.html'), 'utf8');
const runtime = readFileSync(join(root, 'frontend/src/core/i18n.ts'), 'utf8');
const en = JSON.parse(readFileSync(join(root, 'frontend/Lang/en.json'), 'utf8'));
const fr = JSON.parse(readFileSync(join(root, 'frontend/Lang/fr.json'), 'utf8'));

// The selectors applyTranslations() actually queries: querySelectorAll('[data-i18n…]').
const attrs = [...runtime.matchAll(/querySelectorAll\(\s*['"]\[(data-i18n(?:-[a-z-]+)?)\]/g)]
  .map((m) => m[1]);
const known = [...new Set(attrs)];
if (!known.length) {
  console.error('✗ could not read any [data-i18n…] selector out of core/i18n.ts.');
  console.error('  The gate derives its attribute list from the runtime; if the runtime');
  console.error('  changed shape, fix this reader rather than hardcoding the list.');
  process.exit(1);
}

const missing = [];
const seen = new Set();
for (const attr of known) {
  const re = new RegExp(`\\b${attr}\\s*=\\s*"([^"]+)"`, 'g');
  for (const m of html.matchAll(re)) {
    const key = m[1].trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const inEn = Object.prototype.hasOwnProperty.call(en, key);
    const inFr = Object.prototype.hasOwnProperty.call(fr, key);
    if (inEn && inFr) continue;
    const line = html.slice(0, m.index).split('\n').length;
    missing.push({ key, line, where: !inEn && !inFr ? 'en + fr' : (inEn ? 'fr' : 'en') });
  }
}

if (missing.length) {
  console.error(`✗ ${missing.length} translation key(s) in index.html do not resolve:`);
  for (const x of missing.sort((a, b) => a.line - b.line)) {
    console.error(`    ${x.key}  (index.html:${x.line}) — missing from ${x.where}`);
  }
  console.error('');
  console.error('  applyTranslations() leaves the element alone on a miss, so whatever text');
  console.error('  is written in the markup ships as-is — in both languages.');
  process.exit(1);
}

console.log(`✓ all ${seen.size} translation key(s) in index.html resolve in en + fr (${known.length} attribute kinds)`);
