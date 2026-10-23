#!/usr/bin/env node
// CI gate: en.json and fr.json must have exactly the same keys (parity 0/0).
// Exits 1 (failing the build) and lists the offenders if they diverge.
import { readFileSync } from 'node:fs';

const load = (p) => JSON.parse(readFileSync(new URL(`../frontend/Lang/${p}`, import.meta.url), 'utf8'));
const en = load('en.json');
const fr = load('fr.json');

const missingInFr = Object.keys(en).filter((k) => !(k in fr));
const missingInEn = Object.keys(fr).filter((k) => !(k in en));

if (missingInFr.length || missingInEn.length) {
  if (missingInFr.length) {
    console.error(`✗ ${missingInFr.length} key(s) in en.json missing from fr.json:`);
    console.error('  ' + missingInFr.join('\n  '));
  }
  if (missingInEn.length) {
    console.error(`✗ ${missingInEn.length} key(s) in fr.json missing from en.json:`);
    console.error('  ' + missingInEn.join('\n  '));
  }
  process.exit(1);
}

console.log(`✓ i18n parity OK (${Object.keys(en).length} keys, en === fr)`);
