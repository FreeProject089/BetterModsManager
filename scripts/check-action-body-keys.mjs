#!/usr/bin/env node
// A body key the route does not have is DROPPED, in silence.
//
// serde ignores unknown fields by default, so `{ dir: "C:/Repo" }` posted to a route whose
// struct calls it `modsDir` is not an error: the request succeeds, the field never arrives,
// and the route runs as if nothing had been given. "Rebuild a repo manifest" did exactly
// that — the folder you typed was ignored on every run since the action was written.
//
// The comment above `_apiBodyFor` says "camelCase field names the warp API expects (see
// src-tauri/src/api/mod.rs)". That is a worry somebody already had, written down and never
// checked. This checks it: every key an action's body sends must be a field the endpoint
// declares for the same method and path — both lists living in this one file, twelve hundred
// lines apart.
import { readFileSync, existsSync } from 'node:fs';

const SRC = 'frontend/src/features/plugins/plugins.ts';
if (!existsSync(SRC)) { console.error(`✗ ${SRC} is missing — refusing to report success`); process.exit(2); }
const src = readFileSync(SRC, 'utf8');

// Keys a route accepts that the tester deliberately does not advertise. Each needs a reason,
// and the reason has to be that the ROUTE takes it — not that the check is inconvenient.
const UNDECLARED = {
  // `EnableDisableModpackRealBody` takes `modpack_id` OR a legacy `profile_id`, and the
  // action still sends the legacy one. Documented in the Rust, deliberately absent from the
  // tester's field list: offering both spellings in a form invites somebody to pick the old
  // one for new work.
  'POST /api/modpacks/enable': ['profile_id'],
  'POST /api/modpacks/disable': ['profile_id'],
};

// ── what each endpoint declares ──
const eps = new Map();
for (const m of src.matchAll(/method: '(\w+)', path: '([^']+)'[\s\S]{0,600}?fields: (\[[\s\S]*?\n {12}\]|null)/g)) {
  eps.set(`${m[1]} ${m[2]}`, m[3] === 'null' ? [] : [...m[3].matchAll(/name: '(\w+)'/g)].map((x) => x[1]));
}

// ── what each action sends ──
const bodyAt = src.indexOf('function _apiBodyFor(');
const bodyEnd = src.indexOf('\nfunction _prune(', bodyAt);
if (bodyAt < 0 || bodyEnd < 0) { console.error('✗ _apiBodyFor moved — this check cannot be trusted'); process.exit(2); }
const region = src.slice(bodyAt, bodyEnd);

const problems = [];
let checked = 0;
for (const m of region.matchAll(/case '(\w+)':\s*return \{ method: '(\w+)', path: ([^,]+),([\s\S]*?)\n? *\};/g)) {
  const [, id, method, rawPath, body] = m;
  // Only literal paths. A template path (`/api/modpacks/${id}`) puts its value in the URL,
  // which is a different join and not this check's business.
  const pm = /^'([^']+)'$/.exec(rawPath.trim());
  if (!pm) continue;
  const key = `${method} ${pm[1]}`;
  const declared = eps.get(key);
  if (!declared) continue;
  checked++;
  const allowed = new Set([...declared, ...(UNDECLARED[key] || [])]);
  const sent = [...new Set([...body.matchAll(/(?:^|[{,]\s*)([A-Za-z_]\w*)\s*:/g)].map((x) => x[1]))]
    .filter((k) => !['method', 'path', 'body'].includes(k));
  for (const k of sent) {
    if (!allowed.has(k)) problems.push(`${id} sends "${k}" to ${key}, which declares no such field — serde drops it and the value never arrives`);
  }
}

if (checked < 20) {
  console.error(`✗ joined only ${checked} action(s) to an endpoint — the extractors are stale, so this cannot be trusted`);
  process.exit(2);
}
// An exception for a route that no longer has that action is a comment claiming something
// untrue about code that moved on.
for (const key of Object.keys(UNDECLARED)) {
  if (!eps.has(key)) problems.push(`the exception list names ${key}, and no endpoint by that name exists any more`);
}

if (problems.length) {
  console.error('✗ action body keys:');
  for (const p of problems) console.error(`    ${p}`);
  console.error('\n  An unknown field is not an error anywhere in this chain. The request succeeds,');
  console.error('  the route runs with a value it never received, and the task reports success.');
  process.exit(1);
}
console.log(`✓ action body keys OK — ${checked} action(s) joined to their route, every key one the route declares`);
