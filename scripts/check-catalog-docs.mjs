// check-catalog-docs.mjs — the catalogue guides must describe the code that exists.
//
// Documentation is the one place a wrong field name survives every other check: nothing
// compiles it, nothing runs it, and a reader who follows it builds a feed the client
// silently ignores. This extracts the vocabulary from the source and asserts the guides
// use exactly that.
//
// Deliberately narrow. It does NOT try to check prose — it checks the names, which are the
// part that can be objectively wrong and the part people copy.

import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const fail = [];
const ok = [];

// ── the vocabulary, from the code ─────────────────────────────────────────────
const idx = read('frontend/src/features/catalogs/catalog-index.ts');
const types = [...(idx.match(/export const INDEX_TYPES = \[(.*?)\]/s)?.[1] || '').matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
if (!types.length) { console.error('✗ could not read INDEX_TYPES — refusing to report success'); process.exit(2); }

const stores = [...(idx.match(/export const STORE_KEY[^{]*\{(.*?)\n\};/s)?.[1] || '').matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);

const preset = read('frontend/src/features/settings/preset-catalog.ts');
const presetFields = [...(preset.match(/export interface PresetEntry \{(.*?)\n\}/s)?.[1] || '').matchAll(/^\s{4}(\w+)\??:/gm)].map((m) => m[1]);
if (!presetFields.length) { console.error('✗ could not read PresetEntry'); process.exit(2); }

// ── the guides ────────────────────────────────────────────────────────────────
const GUIDES = 'Update/Guides/Catalogs-and-Repos';
const indexDocs = ['catalog-index-format_EN.md', 'catalog-index-format_FR.md'].map((f) => `${GUIDES}/${f}`);

// The published site says the same thing in its own words, and drifted for exactly as long
// as nothing looked at it: it listed five index types while the reader accepted eight, so a
// publisher following the site wrote entries BMM drops on the floor. Checked here for the
// type NAMES only — the prose is its own, and the names are the part that can be objectively
// wrong. Those pages have no "Fields on an entry" heading, so the field check below finds
// nothing in them and only the type check applies, which is the intent.
//
// The submodule may not be checked out. That is normal, and it is reported as a SKIP rather
// than passing quietly: "OK" for a comparison that never ran is the lie this file exists to
// prevent.
const SITE = 'BMM Docs/docs/reference';
const siteDocs = ['catalog-index.md', 'catalog-index.fr.md']
  .map((f) => `${SITE}/${f}`)
  .filter((p) => fs.existsSync(p));
const presetDocs = ['preset-catalog-format_EN.md', 'preset-catalog-format_FR.md'].map((f) => `${GUIDES}/${f}`);

for (const p of [...indexDocs, ...presetDocs]) {
  if (!fs.existsSync(p)) { fail.push(`${p} is missing`); continue; }
}
if (fail.length) { fail.forEach((f) => console.error(`✗ ${f}`)); process.exit(1); }

// Every routable type must be named in the index guides — a type a client accepts but the
// guide never mentions is a feature nobody knows exists.
for (const p of [...indexDocs, ...siteDocs]) {
  const doc = read(p);
  for (const t of types) {
    if (!new RegExp(`\`${t}\``).test(doc)) fail.push(`${p}: does not mention the \`${t}\` type`);
  }
  // And it must not promise a FIELD that does not exist.
  //
  // Anchored on the field table specifically. The first version scanned every table row in
  // the file and flagged the "where each type goes" table — it read `plugin` as an
  // undocumented field and reported four failures against perfectly correct prose. A
  // checker that cries wolf on good docs is a checker people switch off.
  const fieldTable = doc.split(/### (?:Fields on an entry|Champs d.une entr)/)[1]?.split(/\n---/)[0] || '';
  for (const m of fieldTable.matchAll(/^\| `(\w+)` \|/gm)) {
    const field = m[1];
    const known = ['type', 'url', 'app', 'name', 'description', 'owner', 'items', 'updatedAt', 'sha256', 'official'];
    if (!known.includes(field)) fail.push(`${p}: documents an index field \`${field}\` that the reader does not use`);
  }
  ok.push(`${p}: ${types.length} types documented`);
}
if (!siteDocs.length) {
  ok.push("BMM Docs is not checked out — the site's copy of the index reference was NOT checked");
}

// The preset guide's field table must match PresetEntry, allowing the feed's snake_case
// spelling for the one field that differs between wire and model.
//
// `null` means "not part of the published shape" — a field the PARSER sets from where it
// read the catalogue, never one a publisher writes. Documenting those in the field table
// would invite somebody to set them, which is exactly backwards: `local` in a document is
// a claim that a remote entry is a local file, and it is ignored for that reason.
const WIRE = { downloadUrl: 'download_url', source: null, local: null };
for (const p of presetDocs) {
  const doc = read(p);
  for (const f of presetFields) {
    const wire = f in WIRE ? WIRE[f] : f;
    if (wire === null) continue; // internal, not part of the published shape
    if (!new RegExp(`\`${wire}\``).test(doc)) fail.push(`${p}: does not document \`${wire}\``);
  }
  ok.push(`${p}: ${presetFields.length - 1} preset fields documented`);
}

// The store list and the type list must agree, or the guide's "where each type goes" table
// promises a destination that does not exist.
for (const t of types) {
  if (t !== 'app' && !stores.includes(t)) fail.push(`STORE_KEY has no entry for the \`${t}\` type`);
}

// ── words that mean two things ────────────────────────────────────────────────
//
// This is a REGRESSION guard, not a detector, and the difference matters: it cannot find
// the next ambiguous term, only stop this one being un-said.
//
// `preset` means a BSM audio preset AND a BMM automation, and both publish as kind=PRESET.
// The preset guides asserted the second flatly, which sends a BSM author to the wrong page.
// Nothing else here would catch that — every field name in those guides was correct, and a
// name check is blind to a sentence being wrong about what the names describe.
//
// What actually caught it was reading the existing BCWEB pages before adding one. That is a
// habit, not a script. This just makes sure the sentence it produced cannot quietly go away.
const AMBIGUOUS = [
  { term: 'preset', docs: presetDocs, must: /BSM/ },
];
for (const { term, docs, must: needle } of AMBIGUOUS) {
  for (const p of docs) {
    if (!needle.test(read(p))) {
      fail.push(`${p}: does not say which kind of "${term}" it means — the word covers more than one thing`);
    }
  }
}

if (fail.length) {
  fail.forEach((f) => console.error(`✗ ${f}`));
  console.error('\n  The guides are the one place a wrong name passes every other check.');
  process.exit(1);
}
ok.forEach((o) => console.log(`✓ ${o}`));
console.log('✓ catalogue guides match the code');
