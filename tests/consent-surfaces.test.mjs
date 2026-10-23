// Every surface where a privacy / Terms answer is given writes a consent receipt
// (core/consent.ts → consent_ledger.rs). A new surface that only flips a setting leaves no proof,
// and nothing would notice: this reads the sources and says which one forgot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');

test('accepting the Terms and the Privacy Policy records a receipt', () => {
    const notes = src('frontend/src/ui/update-notes.ts');
    const eula = notes.slice(notes.indexOf('export function markEulaAccepted'));
    assert.match(eula.slice(0, 800), /recordConsent\(\{ doc: 'tos', choice: 'accepted'/);
    const priv = notes.slice(notes.indexOf('export function markPrivacyAccepted'));
    assert.match(priv.slice(0, 600), /recordConsent\(\{ doc: 'privacy', choice: 'accepted'/);
    // The policy's own Accept button goes through it.
    assert.match(notes, /localStorage\.setItem\(PRIVACY_SEEN_KEY, 'true'\); } catch \{ \/\* best effort \*\/ \}\s*markPrivacyAccepted\(\);/);
});

test('start-up asks again what has no receipt, and records the policy step of the deck', () => {
    const app = src('frontend/src/ui/app.ts');
    const deck = app.indexOf("await import('./launch-steps.js')");
    const prep = app.indexOf('prepareLaunchConsents()');
    assert.ok(prep > 0 && prep < deck, 'consent_prepare_launch runs before the start-up deck');
    assert.match(app, /consent\.recordConsent\(\{ doc: 'privacy', choice: 'accepted', source: 'app' \}\)/);
    const consent = src('frontend/src/core/consent.ts');
    assert.match(consent, /invoke\('consent_prepare_launch'/);
    assert.match(consent, /bmm_eula_accepted_hash/);
    assert.match(consent, /bmm_privacy_seen_hash/);
});

test('every telemetry answer carries its receipt context', () => {
    const a = src('frontend/src/core/analytics.ts');
    assert.match(a, /invoke\('set_analytics_consent', \{ enabled, liveErrors: opts\.liveErrors \?\? null, receipt \}\)/);
    // The dialog: where, and the text on screen.
    assert.match(a, /source: link \? 'link' : \(opts\.source \?\? 'app'\), shownText:/);
    assert.match(a, /setConsent\(false, \{ receipt: c \}\)/);
    // API / CLI / MCP and links name themselves.
    assert.match(a, /setConsent\(opts\.consent, \{ receipt: \{ source: opts\.source \?\? 'api' \} \}\)/);
    assert.match(a, /applyTelemetrySettings\(\{ \.\.\.plan\.apply, source: 'link' \}\)/);
    // An unchanged consent with changed categories is recorded too.
    assert.match(a, /recordConsent\(\{\s*doc: 'telemetry'/);
});

test('the API tells the UI whether the CLI or the MCP server asked', () => {
    const api = src('src-tauri/src/api/mod.rs');
    assert.match(api, /Some\("cli"\) => "cli", Some\("mcp"\) => "mcp", _ => "api"/);
    assert.match(src('src-tauri/src/extra_tools/mcp_server.rs'), /"\/api\/telemetry\/consent", Some\(serde_json::json!\(\{ "enabled": enabled, "via": "cli" \}\)\)/);
    assert.match(src('src-tauri/src/mcp/server.rs'), /"\/api\/telemetry\/consent", Some\(json!\(\{ "enabled": enabled, "via": "mcp" \}\)\)/);
});

test('My consents is reachable from Settings → Privacy', () => {
    assert.match(src('frontend/index.html'), /id="analytics-consents"/);
    assert.match(src('frontend/src/core/analytics.ts'), /getElementById\('analytics-consents'\)[\s\S]{0,200}openMyConsents\(\)/);
});
