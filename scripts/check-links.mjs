#!/usr/bin/env node
// CI gate: the bundled link registry and the compiled-in fallback must agree.
//
// BMM resolves links.json from three places — BetterCommunity, then GitHub, then the bundled
// assets/links.json — and DEFAULTS in core/links-config.ts is the last resort when none of them
// answered. Two copies of the same values, so they drift.
//
// They already had: analytics_endpoint and analytics_key existed ONLY in DEFAULTS. Everything
// else in the registry can be changed from the BetterCommunity admin panel and reaches every
// installed copy without a release — but the telemetry collector and its ingest key could not,
// because they were never in the file the registry is made of. Moving the collector or rotating
// the key would have meant shipping a new BMM.
//
// This checks both directions:
//   · every key DEFAULTS declares exists in assets/links.json
//   · where both have a key, the values are identical
//
// It does NOT require links.json to be a subset: the file legitimately carries the Discord Rich
// Presence entries, which are read on the Rust side and never go through the TypeScript.
//
// Usage: node scripts/check-links.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TS = join(ROOT, 'frontend/src/core/links-config.ts');
const JSON_PATH = join(ROOT, 'frontend/assets/links.json');

const ts = readFileSync(TS, 'utf8');
const start = ts.indexOf('const DEFAULTS');
const end = ts.indexOf('let _links');
if (start < 0 || end < 0) {
  console.error('✗ could not find the DEFAULTS block in links-config.ts');
  process.exit(1);
}
const defaults = {};
for (const m of ts.slice(start, end).matchAll(/^\s*([A-Za-z_][\w]*)\s*:\s*'([^']*)'/gm)) {
  defaults[m[1]] = m[2];
}

const registry = JSON.parse(readFileSync(JSON_PATH, 'utf8'));

let failed = 0;
for (const [key, value] of Object.entries(defaults)) {
  if (!(key in registry)) {
    console.error(`✗ "${key}" is in DEFAULTS but missing from assets/links.json`);
    console.error(`    it can then only be changed by shipping a new BMM, which defeats the registry`);
    failed++;
  } else if (registry[key] !== value) {
    console.error(`✗ "${key}" differs between the two`);
    console.error(`    links-config.ts : ${value}`);
    console.error(`    links.json      : ${registry[key]}`);
    console.error(`    the offline fallback would behave differently from the shipped app`);
    failed++;
  }
}

if (failed) {
  console.error(`\n✗ ${failed} mismatch(es) between links.json and its compiled-in fallback`);
  process.exit(1);
}
const extra = Object.keys(registry).filter((k) => !k.startsWith('_') && !(k in defaults)).length;
console.log(`✓ links registry OK (${Object.keys(defaults).length} shared entries agree${extra ? `, ${extra} Rust-only entries ignored` : ''})`);
