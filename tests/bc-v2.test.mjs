// BMM 1.0.3 — BetterCommunity v2, shipped dormant and switchable. Against the COMPILED modules.
//
// What is pinned here:
//   1. v1 stays the default: without the switch no URL changes (links.json as bundled included);
//   2. the remote switch's precedence (app.cfg > links.json > v1), mirrored in Rust (bc_v2.rs);
//   3. which links.json URLs move to the v2 root, and which stay on v1 (ADR 0023 §2);
//   4. the device-flow state machine the sign-in dialog runs;
//   5. adapters against fixtures shaped like the v2 contracts (packages/contracts, copied here,
//      never imported across repositories);
//   6. the wiring that keeps all of it behind the session's mode.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const E = await import(pathToFileURL(join(ROOT, 'frontend/js/core/bc-endpoints.js')).href);
const F = await import(pathToFileURL(join(ROOT, 'frontend/js/core/bc-device-flow.js')).href);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const sw = (o = {}) => ({ testMode: false, testBase: 'http://localhost:5176', linksRoot: 'https://bettercommunity.ch/', apiVersion: 'v1', v2Base: '', ...o });
const V1 = E.resolveRoots(sw());
const V2 = E.resolveRoots(sw({ apiVersion: 'v2', v2Base: 'https://v2.bettercommunity.ch' }));

describe('v1 is the default: nothing moves without the switch', () => {
    const links = JSON.parse(read('frontend/assets/links.json'));
    test('the bundled links.json carries no switch', () => {
        for (const k of ['bc_api', 'bc_v2_base', 'bc_v2_client_id', 'bc_v2_app_key', 'bc_v2_app_id']) assert.equal(k in links, false, k);
        const asked = E.pickSwitch({ cfgSet: false, cfgVersion: '', cfgBase: '', linksVersion: links.bc_api, linksBase: links.bc_v2_base || '' });
        assert.equal(asked.version, 'v1');
        assert.equal(asked.source, 'default');
    });
    test('every links.json URL is left as it is in v1 mode', () => {
        for (const [k, v] of Object.entries(links)) {
            for (const u of (Array.isArray(v) ? v : [v])) if (typeof u === 'string') assert.equal(E.rehomeUrl(V1, u), u, k);
        }
    });
    test('v1 roots are the v1 root twice', () => {
        assert.deepEqual(V1, { version: 'v1', v1Root: 'https://bettercommunity.ch', v2Root: 'https://bettercommunity.ch' });
        for (const route of ['/blog', '/assets/contributors.json', '/updates/bmm', '/v1/notifications', '/ai/bmm/suggest', '/feedback/bmm']) {
            assert.equal(E.v1ApiUrl(V1, route), `https://bettercommunity.ch/api${route}`);
        }
    });
});

describe('the remote switch: app.cfg > links.json > v1 (bc_v2.rs pick_switch mirrors it)', () => {
    const pick = (o) => E.pickSwitch({ cfgSet: false, cfgVersion: '', cfgBase: '', linksVersion: '', linksBase: '', ...o });
    test('links.json alone selects v2 and its base', () => {
        assert.deepEqual(pick({ linksVersion: 'v2', linksBase: 'https://v2.example' }), { version: 'v2', base: 'https://v2.example', source: 'links.json' });
    });
    test('an app.cfg line wins, either way', () => {
        assert.equal(pick({ cfgSet: true, cfgVersion: 'v1', linksVersion: 'v2' }).version, 'v1');
        assert.equal(pick({ cfgSet: true, cfgVersion: 'V2', linksVersion: 'v1' }).version, 'v2');
        assert.equal(pick({ cfgSet: true, cfgVersion: '2' }).source, 'app.cfg');
    });
    test('the base: app.cfg first, then links.json', () => {
        assert.equal(pick({ cfgBase: 'https://cfg.example', linksVersion: 'v2', linksBase: 'https://links.example' }).base, 'https://cfg.example');
    });
    test('anything but v2 / 2 is v1', () => {
        for (const v of ['yes', 'true', 'v3', 'V1']) assert.equal(pick({ linksVersion: v }).version, 'v1', v);
    });
    test('Rust and the webview agree on the precedence (same cases, both sides)', () => {
        const rs = read('src-tauri/src/commands/bc_v2.rs');
        assert.match(rs, /fn app_cfg_wins_over_links_json_which_wins_over_v1\(\)/);
        assert.match(rs, /pub fn pick_switch\(cfg_set: bool/);
    });
});

describe('what moves to the v2 root in v2 mode', () => {
    test('links.json URLs on v2-served routes move', () => {
        assert.equal(E.rehomeUrl(V2, 'https://bettercommunity.ch/api/updates/bmm'), 'https://v2.bettercommunity.ch/api/updates/bmm');
        assert.equal(E.rehomeUrl(V2, 'https://bettercommunity.ch/api/assets/contributors.json'), 'https://v2.bettercommunity.ch/api/assets/contributors.json');
        assert.equal(E.rehomeUrl(V2, 'https://bettercommunity.ch/api/catalog.json?project=bmm&kind=THEME'), 'https://v2.bettercommunity.ch/api/catalog.json?project=bmm&kind=THEME');
    });
    test('the rest stays where it is', () => {
        for (const u of ['https://bettercommunity.ch/api/catalogs.json', 'https://bettercommunity.ch/api/bmm/launch?version=1.0.3',
            'https://api.github.com/repos/FreeProject089/BetterModsManager/releases', 'https://telemetry.bettercommunity.ch/batch/',
            'https://bettercommunity.ch/blog', 'https://evil.example/api/updates/bmm']) {
            assert.equal(E.rehomeUrl(V2, u), u, u);
        }
    });
    test('avatars, launch announcements, user search and the Discord link stay on v1 (documented)', () => {
        for (const r of ['/avatar/1?size=64', '/bmm/launch?version=1&lang=en', '/users/search?q=x', '/link/discord']) {
            assert.equal(E.v1ApiUrl(V2, r), `https://bettercommunity.ch/api${r}`);
        }
        const doc = read('Update/Documentation/BC-v2-readiness.md');
        for (const w of ['avatar', 'launch', 'users/search', 'link/discord']) assert.match(doc, new RegExp(w.replace('/', '\\/')), w);
    });
});

describe('device flow state machine', () => {
    const t0 = 1_000_000;
    const started = () => F.flowStep(F.flowStep(F.initialFlow(), { type: 'start' }), { type: 'started', user_code: 'ABCD-1234', verification_uri_complete: 'https://bc/device?c=1', interval: 5, expires_in: 600, now: t0 });
    test('start, then wait at the server pace', () => {
        const s = started();
        assert.equal(s.phase, 'waiting');
        assert.equal(s.userCode, 'ABCD-1234');
        assert.equal(F.nextPollMs(s), 5000);
    });
    test('pending keeps waiting, slow_down slows down', () => {
        let s = F.flowStep(started(), { type: 'polled', state: 'pending', interval: 5, now: t0 + 5000 });
        assert.equal(s.phase, 'waiting');
        s = F.flowStep(s, { type: 'polled', state: 'slow_down', interval: 10, now: t0 + 10000 });
        assert.equal(F.nextPollMs(s), 10000);
        s = F.flowStep(s, { type: 'polled', state: 'slow_down', now: t0 + 20000 });
        assert.equal(s.interval, 15, 'without an interval from Rust: five seconds more');
    });
    test('approved, denied and expired end it', () => {
        const a = F.flowStep(started(), { type: 'polled', state: 'approved', account: { name: 'Ann' }, now: t0 + 5000 });
        assert.equal(a.phase, 'approved');
        assert.equal(a.account.name, 'Ann');
        assert.equal(F.nextPollMs(a), null);
        assert.equal(F.flowStep(started(), { type: 'polled', state: 'denied', now: t0 }).phase, 'denied');
        assert.equal(F.flowStep(started(), { type: 'polled', state: 'expired', now: t0 }).phase, 'expired');
    });
    test('the deadline wins over a late answer', () => {
        assert.equal(F.flowStep(started(), { type: 'polled', state: 'approved', now: t0 + 601_000 }).phase, 'expired');
        assert.equal(F.flowStep(started(), { type: 'tick', now: t0 + 600_000 }).phase, 'expired');
    });
    test('offline polls are counted, not fatal', () => {
        const s = F.flowStep(started(), { type: 'polled', state: 'pending', offline: true, now: t0 + 5000 });
        assert.equal(s.phase, 'waiting');
        assert.equal(s.offline, 1);
    });
    test('cancel is final, and a final state ignores late events', () => {
        const c = F.flowStep(started(), { type: 'cancel' });
        assert.equal(c.phase, 'cancelled');
        assert.equal(F.flowStep(c, { type: 'polled', state: 'approved', now: t0 }).phase, 'cancelled');
        assert.equal(F.flowStep(c, { type: 'start' }).phase, 'starting', 'but a new sign-in can begin');
    });
    test('a start failure is an error with its reason', () => {
        const s = F.flowStep(F.flowStep(F.initialFlow(), { type: 'start' }), { type: 'start_failed', error: 'no_client_id' });
        assert.equal(s.phase, 'error');
        assert.equal(s.error, 'no_client_id');
    });
    test('an unknown answer is an error, a silly interval is bounded', () => {
        assert.equal(F.flowStep(started(), { type: 'polled', state: 'weird', now: t0 }).phase, 'error');
        assert.equal(F.flowStep(started(), { type: 'polled', state: 'pending', interval: 9999, now: t0 }).interval, 60);
    });
});

describe('adapters against v2 contract-shaped fixtures', () => {
    // packages/contracts/src/feedback.ts FeedbackConfigView (public config)
    const configV2 = { enabled: true, kinds: ['feedback', 'bug', 'crash'], crash_sampling: 25, max_body_kb: 64, max_attach_mb: 0.7, max_attachments: 5, max_request_mb: 1, require_contact: true, min_version: '1.0.0' };
    test('feedback config (final contract, max_request_mb included)', () => {
        assert.deepEqual(E.feedbackConfigFromV2(configV2), { enabled: true, kinds: { feedback: true, bug: true, crash: true }, crashSampling: 25, maxBodyKB: 64, maxAttachMB: 0.7, maxAttachments: 5, maxRequestMB: 1, requireContact: true, minVersion: '1.0.0' });
    });
    test('feedback 201 with a null id (a crash left out by sampling)', () => {
        assert.deepEqual(E.feedbackAnswerFromV2(201, { id: null, duplicate: false, sampled: false }).body, { ok: true, id: '', threadId: null, linked: false, duplicate: false, sampled: false });
    });
    test('feedback body only has keys of the strict v2 object', () => {
        const allowed = ['kind', 'title', 'body', 'email', 'discord', 'app_version', 'os', 'meta', 'fingerprint', 'attachments'];
        const b = E.feedbackToV2({ kind: 'crash', body: 'x', meta: { a: 1 }, attachments: [{ name: 'a.zip', type: 'application/zip', data: 'AA==' }] });
        for (const k of Object.keys(b)) assert.ok(allowed.includes(k), k);
        assert.deepEqual(Object.keys(b.attachments[0]).sort(), ['content_type', 'data', 'name']);
    });
    test('every v2 feedback refusal code maps to a v1 answer the dialog explains', () => {
        // the codes the v2 feedback service emits (services/src/feedback)
        const map = { disabled: [403, 'disabled'], body_too_large: [413, 'body_too_large'], too_many_attachments: [413, 'too_many_attachments'], attachments_too_large: [413, 'attachments_too_large'],
            version_too_old: [422, 'version_too_old'], version_blocked: [422, 'version_blocked'], contact_required: [422, 'contact_required'], filtered: [422, 'filtered'], kind_closed: [422, 'kind_disabled'] };
        for (const [code, [st, err]] of Object.entries(map)) {
            const a = E.feedbackAnswerFromV2(422, { code: `feedback.${code}`, status: 422 });
            assert.equal(a.status, st, code);
            assert.equal(a.body.error, err, code);
        }
    });
    test('the poller reads the v2 compat notifications as it read v1 (compat-community.ts)', () => {
        const fixture = { notifications: [{ id: 'ntf_1', kind: 'feedback.reply', body: 'Title\nText', bodyFr: null, url: '/account/reports', createdAt: '2026-10-14T10:00:00.000Z' }] };
        const src = read('frontend/src/core/bcweb-notifications.ts');
        for (const k of ['notifications', 'kind', 'body', 'bodyFr', 'createdAt']) assert.match(src, new RegExp(`\\b${k}\\b`), k);
        assert.equal(Object.keys(fixture.notifications[0]).includes('createdAt'), true);
        assert.match(src, /invoke\('bc_v2_notifications', \{ since: since\(\) \}/);
    });
    test('the blog list and post keep the fields the Community page reads (compat-community.ts)', () => {
        const src = read('frontend/src/features/community/community.ts');
        for (const k of ['posts', 'slug', 'titleFr', 'excerptFr', 'bodyFr', 'publishedAt', 'displayName', 'revisions', 'comments']) assert.match(src, new RegExp(`\\b${k}\\b`), k);
    });
    test('the update feed keeps GitHub fields and the verification chain is untouched', () => {
        const rs = read('src-tauri/src/commands/autoupdate.rs');
        for (const k of ['tag_name', 'prerelease', 'draft', 'browser_download_url', 'update-manifest.json']) assert.ok(rs.includes(k), k);
        const ui = read('frontend/src/ui/update-notes.ts');
        assert.match(ui, /bcRehome\(getLinks\(\)\.autoupdate_api_fallback/);
        assert.doesNotMatch(ui, /bcRehome\(getLinks\(\)\.autoupdate_api\b(?!_)/, 'the GitHub primary is never moved');
    });
    test('the telemetry declaration satisfies the v2 contract (telemetry.ts Config)', () => {
        const d = JSON.parse(read('src-tauri/src/commands/bc_v2_telemetry.json'));
        const key = /^[a-z][a-z0-9_]{1,39}$/;
        const ev = /^[a-z$][a-z0-9_.:$-]{1,79}$/;
        const prop = /^[a-z$][a-zA-Z0-9_.$-]{0,59}$/;
        assert.ok(d.categories.length >= 1 && d.categories.length <= 20);
        const cats = new Set(d.categories.map((c) => c.key));
        for (const c of d.categories) {
            assert.match(c.key, key);
            for (const f of ['name', 'description']) for (const l of ['en', 'fr']) assert.ok(c[f][l].trim().length >= 1 && c[f][l].length <= 300);
            assert.deepEqual(Object.keys(c).sort(), ['description', 'key', 'name']);
        }
        assert.ok(d.events.length <= 200);
        for (const e of d.events) {
            assert.match(e.name, ev);
            assert.ok(cats.has(e.category), e.name);
            assert.ok(e.properties.length <= 40, e.name);
            for (const p of e.properties) assert.match(p, prop, `${e.name}.${p}`);
            assert.deepEqual(Object.keys(e).sort(), ['category', 'name', 'properties']);
        }
        // the categories are the consent dialog's (telemetry-model.ts)
        assert.deepEqual([...cats], ['usage', 'perf', 'errors', 'laya', 'replay']);
    });
});

describe('wiring: behind the session mode, tokens stay in Rust', () => {
    test('every new command is registered', () => {
        const main = read('src-tauri/src/main.rs');
        for (const c of ['bc_v2::bc_v2_activate', 'bc_v2::bc_v2_runtime', 'bc_v2::bc_v2_legal_status', 'bc_v2::bc_v2_legal_answer', 'bc_v2::bc_v2_legal_answers',
            'bc_v2_auth::bc_v2_device_start', 'bc_v2_auth::bc_v2_device_poll', 'bc_v2_auth::bc_v2_device_cancel', 'bc_v2_auth::bc_v2_auth_status',
            'bc_v2_auth::bc_v2_sign_out', 'bc_v2_auth::bc_v2_ensure_token', 'bc_v2_auth::bc_v2_feedback_send', 'bc_v2_auth::bc_v2_notifications']) {
            assert.ok(main.includes(`commands::${c},`), c);
        }
    });
    test('v2 is used only after the health check, and the fallback is logged', () => {
        const rs = read('src-tauri/src/commands/bc_v2.rs');
        assert.match(rs, /\/v2\/health/);
        assert.match(rs, /this session stays on v1/);
        assert.match(rs, /pub fn effective_v2_root\(\)/);
        assert.match(rs, /let Some\(root\) = effective_v2_root\(\) else \{\s*return Ok\(json!\(\{ "sent": 0, "skipped": "not_v2" \}\)\);/);
    });
    test('the webview never chooses v2 on its own', () => {
        const lc = read('frontend/src/core/links-config.ts');
        assert.match(lc, /let _bcApiVersion: 'v1' \| 'v2' = 'v1';/);
        assert.doesNotMatch(lc, /_bcApiVersion = String\(cfg\.api_version/);
        const b = read('frontend/src/core/bc-v2.ts');
        assert.match(b, /setBcSession\(_session\.version, _session\.v2_root\)/);
    });
    test('the sign-in never hands a token to the webview', () => {
        const rs = read('src-tauri/src/commands/bc_v2_auth.rs');
        assert.match(rs, /fn the_webview_never_sees_a_token\(\)/);
        for (const f of ['frontend/src/core/bc-v2.ts', 'frontend/src/features/settings/bc-v2-account.ts']) {
            assert.doesNotMatch(read(f), /access_token|refresh_token/, f);
        }
    });
    test('telemetry v2 keeps the consent gate and the ledger header', () => {
        const rs = read('src-tauri/src/commands/analytics.rs');
        const flush = rs.slice(rs.indexOf('pub async fn analytics_flush'));
        assert.ok(flush.indexOf('if !consent_granted(&state) { return Ok(0); }') < flush.indexOf('bc_v2_telemetry::flush'));
        assert.match(rs, /bc_v2_telemetry::consent_header\(&receipts\)/);
    });
    test('the Laya suggest in v2 mode carries the account token only', () => {
        const rs = read('src-tauri/src/commands/ai.rs');
        assert.match(rs, /effective_v2_root\(\)[\s\S]{0,400}access_token_now\(dir\)\?/);
    });
});
