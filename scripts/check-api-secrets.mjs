#!/usr/bin/env node
// check-api-secrets — a route that accepts a password its form never offers.
//
// The API page documents each endpoint with a field list, and that list is what somebody
// building against BMM reads. When a route's request body carries a `password` (or a
// passphrase, or a key name) and the documented fields do not mention it, the capability is
// unreachable in practice: nobody sends a field they have never been told exists, and the
// quick-test form cannot even be made to send it.
//
// `/api/repo/connect` was exactly that. It takes a download password, uses it to read the
// name of a protected repo, and neither the docs nor the form said so — so connecting to a
// protected repo through the API silently ended up named after its URL.
//
// Narrow on purpose. This does not police every field: only the ones whose NAME says they
// are a secret, which are the ones that cannot be guessed from a 400 and retried.
//
// Usage: node scripts/check-api-secrets.mjs
// Exit 1 when a route accepts a secret its documented form does not offer.

import { readFileSync, existsSync } from 'node:fs';

const API = 'src-tauri/src/api/mod.rs';
const WEB = 'frontend/src/features/plugins/plugins.ts';
for (const f of [API, WEB]) {
  if (!existsSync(f)) {
    console.error(`✗ ${f} is missing — refusing to report success`);
    process.exit(2);
  }
}
const api = readFileSync(API, 'utf8');
const web = readFileSync(WEB, 'utf8');

/** A field name that says it carries a secret. */
const SECRET = /password|passphrase|keyname|secret/i;

// ── What each request shape carries ─────────────────────────────────────────
const structs = {};
for (const m of api.matchAll(/struct\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
  structs[m[1]] = [...m[2].matchAll(/^\s{4}(?:#\[[^\]]*\]\s*)?(\w+)\s*:/gm)]
    .map((f) => f[1])
    .filter((f) => SECRET.test(f));
}

// ── Which route deserialises it ─────────────────────────────────────────────
// The nearest `path!("api" / …)` above the `body::json::<T>()` line. Structural rather than a
// table: a new route with a secret is caught without anybody adding it here.
const routeSecrets = new Map();
for (const m of api.matchAll(/body::json::<(\w+)>\(\)/g)) {
  const secrets = structs[m[1]];
  if (!secrets?.length) continue;
  const paths = [...api.slice(0, m.index).matchAll(/path!\("api"((?:\s*\/\s*"[a-z0-9-]+")+)\)/g)];
  const last = paths[paths.length - 1];
  if (!last) continue;
  const path = '/api/' + [...last[1].matchAll(/"([a-z0-9-]+)"/g)].map((x) => x[1]).join('/');
  routeSecrets.set(path, secrets);
}

// ── What each documented form offers ────────────────────────────────────────
// Split on the definition boundary, never on a character count: /api/repo/sync is the longest
// entry in the file and a capped slice reported it as having no fields at all — which would
// have added a second password box beside the one already there.
const arr = web.slice(web.indexOf('function getEndpointDefs'));
const forms = new Map();
for (const raw of arr.split(/\n\s{8}\{\n\s{12}method:/).slice(1)) {
  const head = /^\s*'(\w+)',\s*path:\s*'([^']+)'/.exec(raw);
  if (!head) continue;
  forms.set(`${head[1]} ${head[2]}`, [...raw.matchAll(/name:\s*'([^']+)'/g)].map((f) => f[1]));
}

if (!routeSecrets.size || !forms.size) {
  console.error('✗ parsed zero routes or zero forms — the patterns have drifted, refusing to report success');
  process.exit(2);
}

const missing = [];
for (const [path, secrets] of routeSecrets) {
  for (const [key, fields] of forms) {
    if (!key.endsWith(' ' + path)) continue;
    if (fields.some((f) => SECRET.test(f))) continue;
    missing.push(`${key} — the route accepts ${secrets.join(', ')}, the documented fields do not mention it`);
  }
}

if (missing.length) {
  console.error('✗ an endpoint takes a secret its own documentation does not offer:\n');
  for (const m of missing) console.error(`  ${m}`);
  console.error(`
  Somebody building against BMM sends the fields this page lists. A password that is
  accepted and undocumented is a capability nobody can reach, and the failure it produces
  is quiet: the call succeeds and does the wrong half of the job.

  Add the field to getEndpointDefs() in ${WEB}, with a description of what it is FOR — a
  password that only unlocks one part of a route should say which part.
`);
  process.exit(1);
}
console.log(`✓ every route that takes a secret documents it (${routeSecrets.size} checked, ${forms.size} forms)`);
