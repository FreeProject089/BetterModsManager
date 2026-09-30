#!/usr/bin/env node
// CI gate: no em dash ("—", U+2014) in the UI strings of frontend/Lang/en.json and fr.json.
//
// The owner's rule (Sept 29): less text everywhere, and above all no « X — longer explanation »
// messages. A dash glued a second idea onto a label, a toast or a hint, and that second idea was
// almost always an essay nobody reads. One idea per string: use a period or a colon, or drop it.
//
// Out of scope:
//   - keys starting with "_" (metadata: _info, _synonyms…);
//   - "docs.*" keys: documentation content (the diagram texts of the docs hub), not UI copy.
// Justified exceptions live in scripts/lang-emdash-allowlist.json as { "key": "why" }. An entry
// whose string no longer holds a dash (in both languages) is reported as stale and fails too, so
// the list can only shrink.
import { readFileSync } from 'node:fs';

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const en = load('../frontend/Lang/en.json');
const fr = load('../frontend/Lang/fr.json');
const allow = load('./lang-emdash-allowlist.json');

const DASH = '—';
const inScope = (k) => !k.startsWith('_') && !k.startsWith('docs.');
const offenders = [];
for (const [lang, dict] of [['en', en], ['fr', fr]]) {
  for (const [k, v] of Object.entries(dict)) {
    if (!inScope(k) || typeof v !== 'string' || !v.includes(DASH)) continue;
    if (Object.prototype.hasOwnProperty.call(allow, k)) continue;
    offenders.push(`${lang}  ${k}: ${v.length > 90 ? v.slice(0, 90) + '…' : v}`);
  }
}
const stale = Object.keys(allow).filter((k) => ![en[k], fr[k]].some((v) => typeof v === 'string' && v.includes(DASH)));

if (offenders.length || stale.length) {
  if (offenders.length) {
    console.error(`✗ ${offenders.length} UI string(s) use an em dash. Keep one idea per string: a period, a colon, or drop the second half.`);
    console.error('  ' + offenders.join('\n  '));
    console.error('  (A real exception goes in scripts/lang-emdash-allowlist.json with its reason.)');
  }
  if (stale.length) {
    console.error(`✗ ${stale.length} stale entr(y/ies) in scripts/lang-emdash-allowlist.json (no dash left): ${stale.join(', ')}`);
  }
  process.exit(1);
}
console.log(`✓ no em dash in the UI strings of en/fr (${Object.keys(allow).length} allowlisted)`);
