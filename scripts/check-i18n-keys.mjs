// Every literal t('…') key must exist in en.json.
//
// t() resolves `dict[key] || fr[key] || key` — on a miss it returns the KEY ITSELF,
// never ''. Two consequences, both invisible until a user meets them:
//
//   · a missing key renders raw on screen. "PROF.IMPORTSOURCEOVGME" and
//     "repo.selectMods (9)" were photographed in the live app — that report is why this
//     guard exists.
//   · every `t('x') || 'fallback'` in the codebase is dead code. The fallback LOOKS like
//     a safety net, which is exactly why 58 keys were missing: the net convinced everyone
//     there was nothing to catch. Their fallback texts have been promoted into the
//     dictionaries; nothing had ever rendered them.
//
// check-i18n-parity cannot catch this class: it compares en against fr, and a key absent
// from BOTH is in perfect parity.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const en = JSON.parse(readFileSync(join(ROOT, 'frontend/Lang/en.json'), 'utf8'));

// Known-missing baseline: calls with no fallback text to harvest, so writing their
// wording is authoring work, not promotion. Shrink this list, never grow it.
// Baseline emptied Aug 11 2026 — every literal key now exists. Keep it empty: a key
// added here is a string a user will see raw.
const KNOWN_MISSING = new Set([]);

function walk(d, out = []) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(n)) out.push(p);
  }
  return out;
}

const missing = [];
for (const f of walk(join(ROOT, 'frontend/src'))) {
  const src = readFileSync(f, 'utf8');
  // Literal single-quoted keys only. A computed key cannot be checked statically, and a
  // double-quoted or template one is rare enough here to not carry the false-positive
  // risk of a looser net.
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.-]+)'\s*[,)]/g)) {
    if (!(m[1] in en) && !KNOWN_MISSING.has(m[1])) {
      missing.push([relative(ROOT, f), m[1]]);
    }
  }
}

const uniq = [...new Map(missing.map(([f, k]) => [k, [f, k]])).values()];
if (uniq.length) {
  console.error(`✗ ${uniq.length} t() key(s) missing from en.json — they render RAW on screen:`);
  for (const [f, k] of uniq.sort((a, b) => a[1].localeCompare(b[1])).slice(0, 20)) {
    console.error(`  ${k}  (${f})`);
  }
  console.error("\n  t() returns the key itself on a miss, so a `|| 'fallback'` next to the");
  console.error('  call never fires. Add the key to both Lang files.');
  process.exit(1);
}
console.log(`✓ every literal t() key resolves (${KNOWN_MISSING.size} known-missing to author)`);
