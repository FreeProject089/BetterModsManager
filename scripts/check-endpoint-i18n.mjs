#!/usr/bin/env node
// The endpoint catalogue is written in French, and half the app's users are not.
//
// Plugins & API lists every HTTP endpoint with a description and a field-by-field breakdown.
// Those strings are object PROPERTIES in a data array — not text inside a template literal —
// so check-hardcoded-text cannot see them. It scans markup handed to innerHTML, which is the
// right thing for it to scan and the reason this hole exists by construction rather than by
// oversight.
//
// The result: an English-speaking reader opens the API reference inside the app and gets
// French. Nothing warns, nothing fails, and the page looks finished.
//
// This is a RATCHET, not a wall. Failing outright would mean either a 400-string translation
// in one commit or a gate switched off on day one. So it counts what is left and refuses to let
// the number grow — which makes the debt visible, bounded, and payable in batches.
//
//   node scripts/check-endpoint-i18n.mjs           report
//   node scripts/check-endpoint-i18n.mjs --check   fail when the count went UP

import fs from 'node:fs';

const FILE = 'frontend/src/features/plugins/plugins.ts';
const BASELINE = 'scripts/.endpoint-i18n-baseline.json';

const src = fs.readFileSync(FILE, 'utf8');

// `about: '…'` at the start of a line — the endpoint's prose.
const about = [...src.matchAll(/^\s*about:\s*'((?:[^'\\]|\\.)*)'/gm)].map((m) => m[1]);
// `desc: '…'` inside a fields array — one per parameter.
const desc = [...src.matchAll(/\{\s*name:[^}]*?desc:\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);

if (about.length + desc.length === 0) {
  // A pattern that matches nothing reports zero debt and passes forever. Refuse instead.
  console.error('✗ found no endpoint strings at all — the pattern is stale, not the debt paid');
  process.exit(2);
}

const counts = { about: about.length, desc: desc.length };
const total = counts.about + counts.desc;

if (!process.argv.includes('--check')) {
  console.log(`endpoint catalogue: ${counts.about} descriptions and ${counts.desc} field labels still hardcoded`);
  console.log(`  via t(): ${(src.match(/^\s*about:\s*t\(/gm) || []).length} descriptions`);
  process.exit(0);
}

let base;
try {
  base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
} catch {
  fs.writeFileSync(BASELINE, `${JSON.stringify(counts, null, 2)}\n`);
  console.log(`✓ endpoint i18n baseline recorded: ${total} string(s) to translate`);
  process.exit(0);
}

const was = base.about + base.desc;
if (total > was) {
  console.error(`✗ the endpoint catalogue gained ${total - was} untranslated string(s) (${was} → ${total})`);
  console.error('');
  console.error('  These are shown to every reader, in French, whatever language they picked.');
  console.error('  New entries should use t(\'plugins.epAbout.<name>\') with an entry in both');
  console.error('  dictionaries — see the six routes added in the endpoint audit for the shape.');
  process.exit(1);
}
if (total < was) {
  fs.writeFileSync(BASELINE, `${JSON.stringify(counts, null, 2)}\n`);
  console.log(`✓ endpoint i18n: ${was - total} string(s) translated — baseline lowered to ${total}`);
  process.exit(0);
}
console.log(`✓ endpoint i18n: ${total} string(s) still to translate, and no more than before`);
