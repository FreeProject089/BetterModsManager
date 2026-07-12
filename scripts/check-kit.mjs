#!/usr/bin/env node
// Contract test for the ui/kit.ts component factories (src/ui/kit.ts → js/ui/kit.js).
// Locks in the two things that matter for a shared UI kit: (1) untrusted text is
// ESCAPED in every factory (no XSS through a label/body/meta), and (2) each factory
// emits the expected classes/states so screens built on it stay consistent.
//
// Runs against the COMPILED output (js/ui/kit.js) so it exercises exactly what ships.
// Wired into `npm run ci`. If it fails, recompile the frontend first (npm run compile).

import { button, badge, card, field, meta, spinner } from '../frontend/js/ui/kit.js';
import { trustedHtml } from '../frontend/js/core/utils.js';

let failed = 0;
const S = (v) => String(v); // TrustedHtml.toString() → markup string
function ok(cond, msg) { if (!cond) { console.error(`  ✗ ${msg}`); failed++; } }
function has(hay, needle, msg) { ok(S(hay).includes(needle), `${msg}\n     expected to contain: ${needle}\n     got: ${S(hay)}`); }
function not(hay, needle, msg) { ok(!S(hay).includes(needle), `${msg}\n     expected NOT to contain: ${needle}\n     got: ${S(hay)}`); }

// ── XSS: untrusted text must be escaped in every text-taking factory ──────────
const XSS = '<img src=x onerror=alert(1)>';
not(button({ label: XSS }), '<img', 'button() must escape its label');
not(badge(XSS), '<img', 'badge() must escape its label');
not(card({ body: XSS }), '<img', 'card() must escape a plain-string body');
not(field({ label: XSS, input: 'x' }), '<img', 'field() must escape its label');
not(meta([XSS, 'ok']), '<img', 'meta() must escape its items');
// Trusted markup passes through (e.g. an SVG icon or a nested factory).
has(card({ body: trustedHtml('<b>kept</b>') }), '<b>kept</b>', 'card() must keep trusted body markup');

// ── button: classes + states ─────────────────────────────────────────────────
has(button({ label: 'Go', variant: 'accent' }), 'class="btn btn-accent"', 'button() emits .btn .btn-accent');
has(button({ label: 'S', variant: 'ghost', size: 'xs' }), 'btn-xs', 'button() applies size class');
has(button({ label: 'L', loading: true }), 'kit-spin', 'button(loading) shows a spinner');
has(button({ label: 'L', loading: true }), 'disabled', 'button(loading) is disabled');
has(button({ label: 'D', disabled: true }), 'disabled', 'button(disabled) is disabled');
has(button({ label: 'A', attrs: { 'data-act': 'save' } }), 'data-act="save"', 'button() renders extra attrs');
has(button({ label: 'A', id: 'x1' }), 'id="x1"', 'button() renders id');

// ── badge / card / field / meta / spinner ────────────────────────────────────
has(badge('Ok', 'success'), 'kit-badge kit-badge-success', 'badge() emits tone class');
has(badge('N'), 'kit-badge-neutral', 'badge() defaults to neutral tone');
has(card({ body: 'x', title: 'Title' }), 'kit-card-title', 'card() renders a title');
has(field({ label: 'Name', input: trustedHtml('<input>'), hint: 'help' }), 'kit-field-hint', 'field() renders a hint');
has(field({ label: 'N', input: trustedHtml('<input>'), htmlFor: 'n' }), 'for="n"', 'field() renders label for=');
has(meta(['a', 'b']), 'kit-meta-sep', 'meta() separates items');
not(meta(['a', false, null, 'b']), 'undefined', 'meta() drops falsy items cleanly');
has(spinner(20), 'width="20"', 'spinner() honors size');

if (failed) {
  console.error(`\n✗ ui/kit contract: ${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('✓ ui/kit contract OK (escaping + classes/states verified)');
