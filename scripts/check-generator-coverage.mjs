#!/usr/bin/env node
// Which endpoints the script generator can actually reach.
//
// The generator turns cards into a script. Each card that talks to the API has a case in the
// request builder, and that case names a method and a path — so the set of endpoints the
// generator can drive is computable, and it was 63 of 108. Forty-four routes had no card at
// all, including every import and export, uninstalling a plugin, setting the deployment
// order, and the whole catalogue subsystem. Somebody who needed one of those had to leave the
// generator and write the request by hand, which is the thing the generator exists to avoid.
//
// Nothing said so. There is no error for a capability nobody exposed.
//
// This makes the gap a declaration instead. Every endpoint must be reachable from a card, or
// listed below with the reason it is not — so adding a route and forgetting the generator
// fails the build, and a deliberate omission is a sentence somebody wrote.
//
//   node scripts/check-generator-coverage.mjs           report
//   node scripts/check-generator-coverage.mjs --check   exit 1 on an undeclared gap
import { readFileSync } from 'node:fs';

const PANEL = 'frontend/src/features/plugins/plugins.ts';
const src = readFileSync(PANEL, 'utf8');

// ── what the generator can reach ──────────────────────────────────────────────────────
const swAt = src.indexOf('switch (a.action_type)');
if (swAt < 0) { console.error('✗ the request builder was not found — refusing to report success'); process.exit(2); }
const builder = src.slice(swAt, src.indexOf('\n    }', swAt));
const reachable = new Set();
for (const m of builder.matchAll(/method: '(\w+)',\s*\n?\s*path: (`[^`]*`|'[^']*')/g)) {
  const path = m[2].slice(1, -1).split('?')[0].replace(/\$\{[^}]*\}/g, ':id');
  reachable.add(`${m[1]} ${path}`);
}

// ── every endpoint there is ───────────────────────────────────────────────────────────
const defsAt = src.indexOf('function getEndpointDefs()');
if (defsAt < 0) { console.error('✗ getEndpointDefs() was not found'); process.exit(2); }
const endpoints = [...src.slice(defsAt).matchAll(/^[ \t]*method: '(\w+)', path: '([^']+)'/gm)]
  .map((m) => `${m[1]} ${m[2].replace(/\/:[a-zA-Z_]+/, '/:id')}`);

if (reachable.size < 20 || endpoints.length < 50) {
  console.error(`✗ read ${reachable.size} reachable and ${endpoints.length} endpoint(s) — the shapes moved, so this check cannot be trusted`);
  process.exit(2);
}

// ── the declared gaps ─────────────────────────────────────────────────────────────────
//
// One line each, and the line is the argument. "Not scriptable" is a claim about the route,
// not a shrug: if the reason stops being true the card is owed.
const DECLARED = {
  'GET /api/data': 'a file download, not a value a script branches on — `export_data` writes it to a folder instead',
  'POST /api/data/export': 'opens the save dialog with no path field; `export_data` (/api/data/export-auto) is the unattended one',
  'GET /api/apps/permissions': 'admin token only — a generated script authenticates with a plugin token and would always get 401',
  'GET /api/apps/permissions/:id': 'admin token only, same as above',
  'PUT /api/apps/permissions/:id': 'admin token only, and granting permissions from a script is the escalation this route exists to prevent',
  'POST /api/profiles/import/ovgme': 'drives a native import wizard that asks questions; a script cannot answer them',
  'POST /api/profiles/import/omm': 'same wizard, other format',
  'GET /api/language/template': 'a file download for a translator, not an automation step',
  'GET /api/catalog': 'the catalogue you author, as one blob — read it with the escape hatch if a script really needs it',
  'DELETE /api/catalog': 'deletes a catalogue you author, whole. Deliberately a decision made in front of the confirm dialog',
  'POST /api/catalog/new': 'creates or RESETS the local catalogue; same reason',
  'POST /api/catalog/apps': 'catalogue authoring — a form with a dozen fields per entry, which is a screen, not a card',
  'PUT /api/catalog/apps/:id': 'catalogue authoring, same shape',
  'DELETE /api/catalog/apps/:id': 'catalogue authoring, same shape',
  'POST /api/catalog/entries': 'catalogue authoring, same shape',
  'PUT /api/catalog/entries/:id': 'catalogue authoring, same shape',
  'DELETE /api/catalog/entries/:id': 'catalogue authoring, same shape',
  'POST /api/catalog/import': 'catalogue authoring, same shape',
  'POST /api/catalog/publish': 'catalogue authoring, same shape',
  'GET /api/hook': 'the whole ring register; `read_hook` covers the one a script waits on',
  'DELETE /api/hook/:id': 'clearing ONE name — `clear_hooks` clears them all, which is what a script that has finished reading wants',
  'GET /api/mods/order': 'read half of the order; `set_mod_order` is the half a script uses',
  'GET /api/repo/modpacks': 'reads what a repo shares; the writing half below is the one automation wants and it is not written yet',
  'POST /api/repo/modpacks': 'shares modpacks from a repo you host — needs the share list as structured JSON, which wants a screen',
  'GET /api/plugins/assets': 'reads one plugin’s shipped files; the CLI (`plugin-asset`) is the shape that fits',
  'POST /api/repo/publish-ssh': 'git-over-SSH, with a key and a passphrase — credentials a generated script should not carry',
  'POST /api/repo/fetch-ssh': 'same, other direction',
};

const gaps = endpoints.filter((e) => !reachable.has(e) && !(e in DECLARED));
const stale = Object.keys(DECLARED).filter((e) => reachable.has(e));
const unknown = Object.keys(DECLARED).filter((e) => !endpoints.includes(e));

let bad = 0;
if (gaps.length) {
  bad++;
  console.error(`✗ ${gaps.length} endpoint(s) the generator cannot reach, and nobody said why:\n`);
  for (const g of gaps) console.error(`    ${g}`);
  console.error('\n  Add a card in getScriptActions(), a case in the request builder, or a line in');
  console.error('  DECLARED here saying why a card would be wrong.');
}
if (stale.length) {
  // A declaration that is no longer true is the same failure as a stale comment, one level up.
  bad++;
  console.error(`\n✗ ${stale.length} declared gap(s) are no longer gaps — a card reaches them now:\n`);
  for (const s of stale) console.error(`    ${s}`);
  console.error('\n  Delete the line from DECLARED.');
}
if (unknown.length) {
  bad++;
  console.error(`\n✗ ${unknown.length} declared gap(s) name no endpoint at all:\n`);
  for (const u of unknown) console.error(`    ${u}`);
}

if (bad) {
  if (process.argv.includes('--check')) process.exit(1);
} else {
  console.log(`✓ generator coverage OK — ${reachable.size} of ${endpoints.length} endpoint(s) have a card, ${Object.keys(DECLARED).length} declared as unsuited, and an escape hatch for the rest`);
}
