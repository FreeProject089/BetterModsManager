// Where a BetterCommunity call goes, v1 or v2 — against the COMPILED module.
//
// The promise of the switch is "no behaviour change unless app.cfg says BCApiVersion=v2", so the
// first suite pins that every v1-mode URL is the one BMM built by hand before the client layer
// existed. The rest pins the v2 side: which routes move, how a v1 report becomes a v2 body, and
// how a v2 answer reads as the v1 one the dialog already knows how to explain.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import(pathToFileURL(join(ROOT, 'frontend/js/core/bc-endpoints.js')).href);
const { parseApiVersion, resolveRoots, v1ApiUrl, v2ApiUrl, servedByV2Compat, feedbackEndpointFor,
    feedbackToV2, feedbackConfigFromV2, feedbackAnswerFromV2, flattenMeta, baseAllowed, signedFeedUrls } = M;

const sw = (o = {}) => ({ testMode: false, testBase: 'http://localhost:5176', linksRoot: 'https://bettercommunity.ch/', apiVersion: 'v1', v2Base: '', ...o });

describe('v1 mode is what BMM always built', () => {
    // The hand-written forms the call sites used, before bc-client.ts.
    const bcRoot = (s) => (s.testMode ? s.testBase : (s.linksRoot || 'https://bettercommunity.ch/')).replace(/\/+$/, '');
    for (const s of [sw(), sw({ testMode: true }), sw({ testMode: true, testBase: 'https://abc.trycloudflare.com/' }), sw({ linksRoot: '' }),
        sw({ v2Base: 'https://v2.example' }) /* a stale BCv2Base without the switch changes nothing */]) {
        test(`root ${bcRoot(s)}`, () => {
            const r = resolveRoots(s);
            assert.equal(r.version, 'v1');
            for (const route of ['/link/status?creatorId=abc', '/link/upgrade', '/link/request', '/blog', '/feedback/bmm', '/catalog.json?project=bmm&kind=THEME', '/repos.json', '/bmm/launch?version=1&lang=fr']) {
                assert.equal(v1ApiUrl(r, route), `${bcRoot(s)}/api${route}`);
            }
            assert.equal(feedbackEndpointFor(r), `${bcRoot(s)}/api/feedback/bmm`);
        });
    }
    test('the switch reads only v2 / 2', () => {
        for (const v of [undefined, null, '', 'v1', '1', 'V3', 'true', 'v2 please']) assert.equal(parseApiVersion(v), 'v1', String(v));
        for (const v of ['v2', 'V2', ' 2 ', '2']) assert.equal(parseApiVersion(v), 'v2', v);
    });
});

describe('v2 mode', () => {
    const r = resolveRoots(sw({ apiVersion: 'v2', v2Base: 'https://v2.bettercommunity.ch/' }));
    test('roots: BCv2Base for v2, v1 untouched', () => {
        assert.deepEqual(r, { version: 'v2', v1Root: 'https://bettercommunity.ch', v2Root: 'https://v2.bettercommunity.ch' });
        assert.equal(resolveRoots(sw({ apiVersion: 'v2' })).v2Root, 'https://bettercommunity.ch', 'no BCv2Base: same domain');
    });
    test('only routes v2 serves move to the v2 root', () => {
        assert.equal(v1ApiUrl(r, '/catalog.json?project=bmm&kind=THEME'), 'https://v2.bettercommunity.ch/api/catalog.json?project=bmm&kind=THEME');
        assert.equal(v1ApiUrl(r, '/repos.json'), 'https://v2.bettercommunity.ch/api/repos.json');
        assert.equal(v1ApiUrl(r, '/repos/my-repo/repo.json'), 'https://v2.bettercommunity.ch/api/repos/my-repo/repo.json');
        assert.equal(v1ApiUrl(r, '/feedback/bmm/config'), 'https://v2.bettercommunity.ch/api/feedback/bmm/config');
        // v2 serves these v1 paths too (ADR 0019 assets and update feed, 0020 suggest, 0023 blog and poller)
        for (const route of ['/assets/links.json', '/assets/contributors.json', '/assets/bmm-laya-offline', '/updates/bmm', '/updates/bmm/latest', '/updates/bmm/releases?per_page=20',
            '/blog', '/blog/my-post', '/blog/ent_0123456789abcdefghjkmnpqrs/history', '/blog/ent_0123456789abcdefghjkmnpqrs/comments', '/v1/notifications?since=2026-10-14T00:00:00.000Z', '/ai/bmm/suggest']) {
            assert.equal(servedByV2Compat(route), true, route);
            assert.equal(v1ApiUrl(r, route), `https://v2.bettercommunity.ch/api${route}`);
        }
        // no v2 route (ADR 0023 §2): stays on v1 rather than calling a server that would 404
        for (const route of ['/link/status?creatorId=x', '/link/request', '/link/discord', '/avatar/1?size=64', '/users/search?q=x', '/catalogs.json', '/bmm/launch', '/bmm/launch?version=1.0.4&lang=fr',
            '/blog/ent_0123456789abcdefghjkmnpqrs/history/rev1', '/blog/7/comments/3/history']) {
            assert.equal(servedByV2Compat(route), false, route);
            assert.equal(v1ApiUrl(r, route), `https://bettercommunity.ch/api${route}`);
        }
    });
    test('native v2 urls, with or without the prefix', () => {
        assert.equal(v2ApiUrl(r, '/consents'), 'https://v2.bettercommunity.ch/v2/consents');
        assert.equal(v2ApiUrl(r, '/v2/consents'), 'https://v2.bettercommunity.ch/v2/consents');
        assert.equal(v2ApiUrl(r, 'feeds/keys'), 'https://v2.bettercommunity.ch/v2/feeds/keys');
        assert.equal(feedbackEndpointFor(r), 'https://v2.bettercommunity.ch/v2/projects/bmm/feedback');
        const f = signedFeedUrls(r);
        assert.equal(f.index, 'https://v2.bettercommunity.ch/v2/feeds/catalog');
        assert.equal(f.catalog('a b'), 'https://v2.bettercommunity.ch/v2/feeds/catalogs/a%20b');
    });
    test('a plaintext or odd BCv2Base is ignored, not followed', () => {
        assert.equal(resolveRoots(sw({ apiVersion: 'v2', v2Base: 'http://v2.example' })).v2Root, 'https://bettercommunity.ch');
        assert.equal(resolveRoots(sw({ apiVersion: 'v2', v2Base: 'http://localhost:3000/' })).v2Root, 'http://localhost:3000');
        assert.equal(baseAllowed('https://x.example/?a=1'), false);
        assert.equal(baseAllowed('https://user@x.example'), false);
        assert.equal(baseAllowed('javascript:alert(1)'), false);
    });
});

describe('feedback: v1 payload to the v2 contract', () => {
    test('snake_case, content_type, flat meta, nothing the strict object refuses', () => {
        const b = feedbackToV2({
            kind: 'bug', title: '  Crash\u0007 on start ', body: 'boom', email: 'a@b.ch', discord: 'x',
            appVersion: '1.2.3', os: 'Win32', fingerprint: 'fp:1', meta: { lang: 'fr', nested: { a: 1 }, 'bad key': 1, n: 3, u: undefined },
            attachments: [{ name: 'log.txt', type: 'text/plain', data: 'aGk=' }, { name: 'x', type: 'not a type', data: '' }],
        });
        assert.deepEqual(Object.keys(b).sort(), ['app_version', 'attachments', 'body', 'email', 'fingerprint', 'kind', 'meta', 'os', 'title']);
        assert.equal(b.title, 'Crash on start');
        assert.equal(b.app_version, '1.2.3');
        assert.deepEqual(b.meta, { lang: 'fr', nested: '{"a":1}', n: 3 });
        assert.deepEqual(b.attachments[0], { name: 'log.txt', content_type: 'text/plain', data: 'aGk=' });
        assert.equal(b.attachments[1].content_type, 'application/octet-stream');
        assert.equal('discord' in b, false, 'a one-letter discord name is below the v2 minimum');
    });
    test('an invalid e-mail or fingerprint is dropped, not sent to be refused', () => {
        const b = feedbackToV2({ kind: 'feedback', body: 'x', email: 'nope', fingerprint: 'has space' });
        assert.equal('email' in b, false);
        assert.equal('fingerprint' in b, false);
        assert.deepEqual(b.attachments, []);
    });
    test('meta keeps at most 40 keys', () => {
        const meta = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, i]));
        assert.equal(Object.keys(flattenMeta(meta)).length, 40);
    });
    test('the v2 config reads as the v1 one', () => {
        assert.deepEqual(feedbackConfigFromV2({ enabled: true, kinds: ['bug', 'crash'], crash_sampling: 50, max_body_kb: 64, max_attach_mb: 5, max_attachments: 3, max_request_mb: 1, require_contact: false, min_version: '1.0.0' }),
            { enabled: true, kinds: { feedback: false, bug: true, crash: true }, crashSampling: 50, maxBodyKB: 64, maxAttachMB: 5, maxAttachments: 3, maxRequestMB: 1, requireContact: false, minVersion: '1.0.0' });
    });
    test('v2 answers become the v1 answers the dialog explains', () => {
        assert.deepEqual(feedbackAnswerFromV2(201, { id: 'fbk_1', duplicate: false, sampled: true }),
            { status: 200, body: { ok: true, id: 'fbk_1', threadId: null, linked: false, duplicate: false, sampled: true } });
        assert.deepEqual(feedbackAnswerFromV2(413, { code: 'feedback.too_many_attachments', status: 413 }), { status: 413, body: { error: 'too_many_attachments' } });
        assert.deepEqual(feedbackAnswerFromV2(422, { code: 'feedback.contact_required' }), { status: 422, body: { error: 'contact_required' } });
        assert.deepEqual(feedbackAnswerFromV2(422, { code: 'feedback.version_too_old' }), { status: 422, body: { error: 'version_too_old' } });
        assert.deepEqual(feedbackAnswerFromV2(422, { code: 'feedback.kind_closed' }), { status: 422, body: { error: 'kind_disabled' } });
        assert.deepEqual(feedbackAnswerFromV2(409, { code: 'feedback.disabled' }), { status: 403, body: { error: 'disabled' } });
        assert.equal(feedbackAnswerFromV2(404, { code: 'resource.not_found' }).status, 404);
        assert.equal(feedbackAnswerFromV2(503, {}).status, 503);
    });
});

describe('wiring', () => {
    const read = (p) => readFileSync(join(ROOT, p), 'utf8');
    test('the telemetry envelope is versioned the same way in Rust and in the beacon', () => {
        const rs = read('src-tauri/src/commands/analytics.rs');
        assert.match(rs, /TELEMETRY_SCHEMA: &str = "bmm-telemetry"/);
        assert.match(rs, /TELEMETRY_SCHEMA_V: u32 = 1;/);
        assert.match(read('frontend/src/core/analytics.ts'), /schema: 'bmm-telemetry', v: 1, api_key:/);
    });
    test('the v2 consent sync is registered and gated in Rust, not only in the webview', () => {
        assert.match(read('src-tauri/src/main.rs'), /commands::bc_v2::consent_sync_bc_v2/);
        const rs = read('src-tauri/src/commands/bc_v2.rs');
        assert.match(rs, /return Ok\(json!\(\{ "sent": 0, "skipped": "not_v2" \}\)\)/);
        assert.match(rs, /analytics_consent == Some\(true\)/);
    });
    test('bc-link builds its URLs through the client', () => {
        const s = read('frontend/src/core/bc-link.ts');
        assert.doesNotMatch(s, /\$\{bcRoot\(\)\}\/api\//);
        assert.match(s, /bcUrl\('\/link\/request'\)/);
    });
});
