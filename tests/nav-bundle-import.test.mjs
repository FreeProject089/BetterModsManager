// A shared .bmmnav cannot grant its pages anything on its own.
//
// The defect this pins: importing a .bmmnav called `page_set_grant` for every capability the
// file listed and `page_set_net_origins` for every origin, with nothing shown. A navbar shared
// by a stranger arrived with `network` + `clipboard` + `system` already granted to their
// script. Now the file's lists are requests: each page is created holding nothing, the user
// answers a review whose default is "grant none", and only that answer is applied.
//
// The Rust side (custom_pages.rs, page_grant_review_tests) pins the same rules where they are
// enforced; this pins that the import flow never goes around them.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { planNavBundleImport, reviewAnswer, runNavBundleImport, PAGE_CAPS } = await import(
    pathToFileURL(join(ROOT, 'frontend/js/ui/nav-bundle-import.js')).href
);

/** The file an attacker would share. */
const HOSTILE = {
    format: 'bmmnav', version: 1, navbar: { order: [], hidden: {}, labels: {}, custom: [] },
    pages: [
        { id: 'pA', name: 'Tools', html: '<p>x</p>', css: '', js: 'steal()', grants: ['network', 'clipboard', 'system', 'storage', 'shell'], netOrigins: ['https://collect.example', 'https://cdn.example'] },
        { id: 'pB', name: 'Plain', html: '<p>y</p>', css: '', js: '', grants: [], netOrigins: [] },
    ],
};

/** A fake backend: records every call, answers like the Rust commands do. */
function fakeBackend({ existing = [] } = {}) {
    const calls = [];
    const pages = new Map(existing.map(id => [id, { grants: ['storage'], origins: [] }]));
    let n = 0;
    const invoke = async (cmd, args = {}) => {
        calls.push({ cmd, args });
        if (cmd === 'create_imported_custom_page') {
            const id = `pnew${++n}`;
            pages.set(id, { grants: [], origins: [], pending: true });
            return { page: { id }, review: { source: 'import-pending', requested: args.requested, requestedOrigins: args.requestedOrigins } };
        }
        if (cmd === 'page_apply_reviewed_grants') {
            const p = pages.get(args.id);
            if (!p?.pending) throw new Error('review_not_pending');
            Object.assign(p, { grants: args.caps, origins: args.origins, pending: false });
            return { grants: args.caps, origins: args.origins };
        }
        throw new Error(`unexpected command ${cmd}`);
    };
    return { invoke, calls, pages };
}

const GRANTING = ['page_set_grant', 'page_set_net_origins', 'create_custom_page', 'update_custom_page'];

describe('.bmmnav import', () => {
    test('the file lists are requests: unknown capabilities are set aside, nothing is a grant', () => {
        const [a, b] = planNavBundleImport(HOSTILE);
        assert.deepEqual(a.requested, ['storage', 'clipboard', 'network', 'system']);
        assert.deepEqual(a.unknown, ['shell']);
        assert.deepEqual(a.requestedOrigins, ['https://collect.example', 'https://cdn.example']);
        assert.equal('grants' in a, false);
        assert.deepEqual(b.requested, []);
        for (const c of a.requested) assert.ok(PAGE_CAPS.includes(c));
    });

    test('import with grants applies none until the review answers', async () => {
        const be = fakeBackend();
        let seenBeforeReview = null;
        const res = await runNavBundleImport(HOSTILE, {
            invoke: be.invoke,
            review: async (pending) => {
                seenBeforeReview = [...be.pages.values()].map(p => [...p.grants]);
                assert.deepEqual(pending.map(p => p.name), ['Tools'], 'only a page that asks for something is reviewed');
                assert.deepEqual(pending[0].requested, ['storage', 'clipboard', 'network', 'system']);
                return new Map(); // "Grant none" / Escape / ×
            },
        });
        assert.deepEqual(seenBeforeReview, [[], []], 'pages hold nothing while the review is open');
        assert.equal(be.calls.filter(c => GRANTING.includes(c.cmd)).length, 0, 'never the old granting commands');
        for (const p of be.pages.values()) assert.deepEqual(p.grants, []);
        for (const p of be.pages.values()) assert.deepEqual(p.origins, []);
        for (const p of be.pages.values()) assert.equal(p.pending, false, 'grant none is a recorded answer');
        assert.deepEqual(Object.keys(res.idMap), ['pA', 'pB']);
    });

    test('a failing review dialog is grant none', async () => {
        const be = fakeBackend();
        await runNavBundleImport(HOSTILE, { invoke: be.invoke, review: async () => { throw new Error('closed'); } });
        for (const p of be.pages.values()) assert.deepEqual(p.grants, []);
    });

    test('partial grant: only the ticked items, origins only with network', async () => {
        const be = fakeBackend();
        const res = await runNavBundleImport(HOSTILE, {
            invoke: be.invoke,
            review: async ([p]) => new Map([[p.id, { caps: ['storage', 'network', 'shell'], origins: ['https://cdn.example', 'https://not-asked.example'] }]]),
        });
        const id = res.idMap.pA;
        assert.deepEqual(be.pages.get(id).grants, ['storage', 'network']);
        assert.deepEqual(be.pages.get(id).origins, ['https://cdn.example']);

        // An origin ticked without internet is not kept.
        assert.deepEqual(reviewAnswer({ requested: ['storage', 'network'], requestedOrigins: ['https://a.example'] }, { caps: ['storage'], origins: ['https://a.example'] }),
            { caps: ['storage'], origins: [] });
        // A malformed answer is grant none.
        assert.deepEqual(reviewAnswer({ requested: ['storage'], requestedOrigins: [] }, { caps: 'storage' }), { caps: [], origins: [] });
        assert.deepEqual(reviewAnswer({ requested: ['storage'], requestedOrigins: [] }, undefined), { caps: [], origins: [] });
    });

    test('re-importing does not escalate an existing page', async () => {
        // The same file imported on the machine that already has pA, which the user restricted.
        const be = fakeBackend({ existing: ['pA'] });
        await runNavBundleImport(HOSTILE, {
            invoke: be.invoke,
            review: async (pending) => new Map(pending.map(p => [p.id, { caps: p.requested, origins: p.requestedOrigins }])),
        });
        assert.deepEqual(be.pages.get('pA').grants, ['storage'], 'the existing page is untouched');
        const touched = be.calls.filter(c => c.args && c.args.id === 'pA');
        assert.deepEqual(touched, [], 'no call names the existing page');
        assert.ok(be.calls.filter(c => c.cmd === 'create_imported_custom_page').length === 2, 'always new pages');
    });

    test('the backend refusing the answer leaves the page with nothing', async () => {
        const be = fakeBackend();
        const realInvoke = be.invoke;
        const res = await runNavBundleImport(HOSTILE, {
            invoke: async (cmd, args) => { if (cmd === 'page_apply_reviewed_grants') throw new Error('not_requested'); return realInvoke(cmd, args); },
            review: async ([p]) => new Map([[p.id, { caps: ['system'] }]]),
        });
        for (const a of Object.values(res.applied)) assert.deepEqual(a, { caps: [], origins: [] });
        for (const p of be.pages.values()) assert.deepEqual(p.grants, []);
    });
});

describe('review dialog defaults', () => {
    test('nothing starts ticked and "Grant none" is the default action', async () => {
        const { readFileSync } = await import('node:fs');
        const src = readFileSync(join(ROOT, 'frontend/src/ui/nav-grant-review.ts'), 'utf8');
        assert.match(src, /cb\.checked = false;/);
        assert.match(src, /initialFocus: '\.ngr-grant-none'/);
        assert.match(src, /onClose: \(\) => finish\(new Map\(\)\)/, 'closing the dialog answers grant none');
    });

    test('the import never calls the granting commands directly', async () => {
        const { readFileSync } = await import('node:fs');
        const src = readFileSync(join(ROOT, 'frontend/src/ui/navbar-customize.ts'), 'utf8');
        const start = src.indexOf('async function importNavBundle');
        const end = src.indexOf('\nfunction ', start);
        const body = src.slice(start, end);
        assert.ok(start > 0 && body.includes('runNavBundleImport'));
        assert.doesNotMatch(body, /page_set_grant|page_set_net_origins/);
    });
});
