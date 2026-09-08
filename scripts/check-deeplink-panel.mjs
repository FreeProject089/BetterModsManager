#!/usr/bin/env node
// Every deeplink the app handles is in the app's own deeplink reference, with its parameters.
//
// `deeplinks.json` is extracted from `deep_link_manager.ts`, so it is what the app ACTUALLY
// accepts. The Plugins & Script screen holds a second, hand-written list — the one somebody
// reads before building a link, and the one the quick-tester builds its form from.
//
// Nothing compared them. Six actions were absent from the screen entirely, and eight more
// documented some of their parameters and not others — including `repo/connect`, which takes
// a download password so it can read the name of a protected repo, and said nothing about it.
// A parameter nobody is told about is a capability nobody sends.
//
// This is the deeplink twin of check-api-panel, and it exists for the same reason: the
// reference and the code are two lists of one thing, and only one of them runs.
import { readFileSync, existsSync } from 'node:fs';

const MAP = 'frontend/deeplinks.json';
const PANEL = 'frontend/src/features/plugins/plugins.ts';
for (const f of [MAP, PANEL]) {
  if (!existsSync(f)) { console.error(`✗ ${f} is missing — refusing to report success`); process.exit(2); }
}

const real = JSON.parse(readFileSync(MAP, 'utf8'));
const panel = readFileSync(PANEL, 'utf8');

if (!Array.isArray(real) || real.length < 30) {
  console.error(`✗ read ${real?.length} action(s) from ${MAP} — too few to be right, so this check cannot be trusted`);
  process.exit(2);
}

// One documented entry runs from its `scheme:` to the next one. Splitting on the boundary
// rather than slicing a fixed number of characters: the longest entry here carries a dozen
// parameters and a capped window reported it as having none.
const heads = [...panel.matchAll(/scheme: '([a-z0-9/-]+)'/g)].map((m) => ({ name: m[1], at: m.index }));
if (heads.length < 20) {
  console.error(`✗ found ${heads.length} documented scheme(s) — the shape changed, refusing to report success`);
  process.exit(2);
}
const documented = new Map();
for (let i = 0; i < heads.length; i++) {
  const body = panel.slice(heads[i].at, heads[i + 1]?.at ?? heads[i].at + 4000);
  documented.set(heads[i].name, new Set([...body.matchAll(/name: '([A-Za-z_][A-Za-z0-9_]*)'/g)].map((m) => m[1])));
}

// Deliberately undocumented: actions that take no parameters and exist to be fired by the
// app itself. Listed rather than pattern-matched, so adding one is a decision.
const INTERNAL = new Set(['telemetry/set', 'restart', 'theme/editor']);

// Parameters a PERSON never supplies, per action. `k` on schedule/run is minted on this
// machine and kept in settings for the Windows Scheduled Task mirror — never shown, never
// sent anywhere. Documenting it would describe a value nobody can provide and invite somebody
// to try forging it, which is the opposite of what this check is for.
const INTERNAL_PARAM = { 'schedule/run': ['k'], 'schedule/enable': ['k'] };

const absent = [];
const partial = [];
for (const { action, params } of real) {
  if (INTERNAL.has(action)) continue;
  const doc = documented.get(action);
  if (!doc) { absent.push(`${action} (${params.join(', ') || 'no parameters'})`); continue; }
  const hidden = INTERNAL_PARAM[action] || [];
  const gap = params.filter((p) => !doc.has(p) && !hidden.includes(p));
  if (gap.length) partial.push(`${action} — reads ${gap.join(', ')}, and the screen never mentions ${gap.length > 1 ? 'them' : 'it'}`);
}

if (absent.length || partial.length) {
  console.error('✗ the deeplink reference does not match the app:\n');
  for (const a of absent) console.error(`  MISSING   ${a}`);
  for (const p of partial) console.error(`  PARTIAL   ${p}`);
  console.error(`
  The screen is what somebody reads before building a link, and what the quick-tester builds
  its form from. An action it does not list cannot be tried; a parameter it omits is a
  capability nobody sends, because nobody sends a field they have never been told exists.

  Add it to the deeplink list in ${PANEL}.
`);
  process.exit(1);
}
// ── ENDPOINT_TO_DL: the "bmm://" badge on an endpoint row ─────────────────────────────
//
// A separate list, and a third chance to disagree. It is keyed by "<METHOD> <path>", so a
// key that does not name a real endpoint renders no badge and nothing says why; a target
// that names no real action offers a link that does nothing when clicked.
//
// It was also incomplete in the direction nobody notices: `DELETE /api/plugins/:id` and the
// whole catalogue subsystem had working deeplinks and no badge, so the screen said they had
// none. The reference page even recorded the plugin one as a known inconsistency — a note
// that stayed true for as long as it was written down instead of checked.
const mapAt = panel.indexOf('const ENDPOINT_TO_DL');
if (mapAt < 0) { console.error('✗ ENDPOINT_TO_DL not found — refusing to report success'); process.exit(2); }
const mapSrc = panel.slice(mapAt, panel.indexOf('};', mapAt));
const mapKeys = [...mapSrc.matchAll(/^\s*'([A-Z]+ \/api\/[^']+)':/gm)].map((m) => m[1]);
const mapTargets = [...mapSrc.matchAll(/bmm:\/\/([a-z0-9/_-]+)/g)].map((m) => m[1]);
if (mapKeys.length < 20) { console.error(`✗ parsed ${mapKeys.length} ENDPOINT_TO_DL row(s) — the shape changed`); process.exit(2); }

const defsAt = panel.indexOf('function getEndpointDefs()');
const endpoints = new Set([...panel.slice(defsAt).matchAll(/^[ \t]*method: '(\w+)', path: '([^']+)'/gm)].map((m) => `${m[1]} ${m[2]}`));
const actions = new Set(real.map((a) => a.action));

// UI-only on purpose: a deeplink that opens a screen, or drives something the HTTP API does
// not expose. Listed rather than inferred, so a new action with a route behind it fails here
// until somebody decides which endpoint it belongs to.
const NO_ENDPOINT = new Set([
  'api',                                        // the generic passthrough — it IS every endpoint
  'benchmark/open', 'docs/open', 'view/open',   // open a screen
  'settings/layout', 'settings/navbar',
  'theme/apply', 'theme/editor', 'theme/import', 'theme/import-inline',
  'language/import-inline',                     // the payload rides in the link, not a body
  'repo/fetch-ssh', 'repo/publish-ssh',         // git-over-SSH, no HTTP route
  'download', 'import', 'install',              // one-word aliases that dispatch by file kind
  'catalog/unfollow',                           // same route as catalog/follow, one row for both
]);

const mapBad = [];
for (const k of mapKeys) if (!endpoints.has(k)) mapBad.push(`KEY       ${k} — no endpoint by that name, so the badge never renders`);
for (const tgt of mapTargets) if (!actions.has(tgt)) mapBad.push(`TARGET    bmm://${tgt} — the app handles no such action`);
for (const a of actions) {
  if (NO_ENDPOINT.has(a) || INTERNAL.has(a)) continue;
  if (!mapTargets.includes(a)) mapBad.push(`UNBADGED  ${a} has a working deeplink and no endpoint row — the screen says it has none`);
}
if (mapBad.length) {
  console.error('✗ the endpoint ↔ deeplink map does not match the app:\n');
  for (const b of mapBad) console.error(`  ${b}`);
  console.error(`
  ENDPOINT_TO_DL in ${PANEL} is what puts the bmm:// badge on an endpoint row. Fix the row,
  or declare the action UI-only in NO_ENDPOINT here.
`);
  process.exit(1);
}

const total = real.reduce((n, a) => n + a.params.length, 0);
console.log(`✓ deeplink reference OK — ${real.length} action(s), ${total} parameter(s), all documented`);
console.log(`✓ endpoint ↔ deeplink map OK — ${mapKeys.length} badge(s), every key an endpoint and every target an action`);
