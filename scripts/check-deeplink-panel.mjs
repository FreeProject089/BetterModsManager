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
const total = real.reduce((n, a) => n + a.params.length, 0);
console.log(`✓ deeplink reference OK — ${real.length} action(s), ${total} parameter(s), all documented`);
