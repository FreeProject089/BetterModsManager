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
// The STATIC MARKUP is the third copy of the same values, and it drifted the same way.
// `patchHtmlLinks()` in app.ts rewrites every `[data-link-key]` element from the registry
// after load, which is what makes a rotated Discord invite or a moved forum thread reach
// installed copies without a release. An `<a href="https://…">` written WITHOUT that
// attribute opts out of all of it — silently, because it keeps working right up until the
// address changes. That is what happened to the feedback dashboard link: added later than
// its neighbours, missed the attribute, and left `feedback_web` in the registry as a key
// nothing could reach.
//
// So this checks four things:
//   · every key DEFAULTS declares exists in assets/links.json
//   · where both have a key, the values are identical
//   · every external URL in index.html names a registry key that exists
//   · the URL written in the markup MATCHES the registry's value for that key
//
// The last one is the easy one to skip and the reason for the other three. The markup's URL
// is what a person sees for the moment before `patchHtmlLinks` runs, and what they keep if
// the registry cannot be reached at all — offline, or a first run. If the two disagree,
// which address somebody gets depends on their network.
//
// It does NOT require links.json to be a subset: the file legitimately carries the Discord Rich
// Presence entries, which are read on the Rust side and never go through the TypeScript.
//
// It cannot see anchors built in TypeScript. Those read `getLinks()` directly, and `tsc`
// covers them; the failure mode here — a URL typed into markup — is specific to the static file.
//
// Usage: node scripts/check-links.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TS = join(ROOT, 'frontend/src/core/links-config.ts');
const JSON_PATH = join(ROOT, 'frontend/assets/links.json');
const HTML_PATH = join(ROOT, 'frontend/index.html');

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
// ── The markup ─────────────────────────────────────────────────────────────────────
const html = readFileSync(HTML_PATH, 'utf8');

/** Line number of a character offset, so a failure names a place to go. */
const lineOf = (idx) => html.slice(0, idx).split('\n').length;

/** The `key="value"` attributes of one tag, tolerant of newlines inside the tag.
 *
 * Values are ENTITY-DECODED, because an attribute is entity-encoded and the registry is not.
 * A URL with a query string is written `?a=1&amp;b=2` in HTML — that is the correct spelling,
 * not a second URL — and comparing it raw against `?a=1&b=2` reports a disagreement between a
 * value and itself. Only the five that matter in an attribute; anything else in a URL is
 * percent-encoded, where `&` and `<` cannot appear as entities in the first place. */
function attrs(tag) {
  const out = {};
  const decode = (v) => v
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');   // last, so `&amp;lt;` decodes to `&lt;` and not to `<`
  for (const m of tag.matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decode(m[2]);
  return out;
}

/** One external URL in the markup: where it is, what it points at, which key it claims. */
function auditSite(where, url, key, what) {
  if (!key) {
    console.error(`✗ ${where}  ${what} "${url}" has no data-link-key`);
    console.error('    the registry cannot move it — it is fixed until somebody ships a new BMM');
    return 1;
  }
  if (!(key in registry)) {
    console.error(`✗ ${where}  data-link-key="${key}" is not a key in links.json`);
    return 1;
  }
  if (registry[key] !== url) {
    console.error(`✗ ${where}  the markup and links.json["${key}"] disagree`);
    console.error(`    markup   : ${url}`);
    console.error(`    registry : ${registry[key]}`);
    console.error('    which one a person gets then depends on whether the registry was reachable');
    return 1;
  }
  return 0;
}

let markupFailed = 0;
let sites = 0;

// Anchors. Only `<a`: `<link rel="preconnect" href="https://fonts…">` is a resource hint,
// not a link a person can follow, and has nothing to do with the registry.
for (const m of html.matchAll(/<a\b[^>]*>/g)) {
  const a = attrs(m[0]);
  if (!a.href || !/^https?:\/\//i.test(a.href)) continue;
  sites++;
  markupFailed += auditSite(`index.html:${lineOf(m.index)}`, a.href, a['data-link-key'], '<a href>');
}

// Quicklink cards — not anchors, but a `<div data-url="…">` opened by the [data-open-url]
// delegate. `patchHtmlLinks` rewrites `dataset.url` for them, so the same rule applies.
for (const m of html.matchAll(/<div\b[^>]*\bdata-url\s*=\s*"[^"]*"[^>]*>/g)) {
  const d = attrs(m[0]);
  if (!d['data-url'] || !/^https?:\/\//i.test(d['data-url'])) continue;
  sites++;
  markupFailed += auditSite(`index.html:${lineOf(m.index)}`, d['data-url'], d['data-link-key'], 'data-url');
}

if (markupFailed) {
  console.error(`\n✗ ${markupFailed} external URL(s) in index.html the registry cannot reach`);
  console.error('  Add data-link-key="<key from links.json>" and make the two values match.');
  process.exit(1);
}

const extra = Object.keys(registry).filter((k) => !k.startsWith('_') && !(k in defaults)).length;
console.log(`✓ links registry OK (${Object.keys(defaults).length} shared entries agree${extra ? `, ${extra} Rust-only entries ignored` : ''}; ${sites} URL(s) in index.html registry-backed)`);
