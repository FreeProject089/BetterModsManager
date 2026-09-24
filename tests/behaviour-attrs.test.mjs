// Foreign markup may not decide what the app calls.
//
// inline-actions.ts replaced every inline `on…=` handler with delegated listeners on
// `document` that act on data attributes: `data-act="fn"` + `data-act-args` calls
// `window.fn(...args)` on click, `data-click-proxy` clicks another element, `data-hover`
// writes inline styles. Every sanitiser of other people's markup (Community posts and
// comments, release notes, a plugin's README, a theme's custom elements) kept `data-*`, so
// those attributes arrived intact and the listeners acted on them. One of the window
// functions within reach was `__bmmDeeplink(url, origin)`, whose SECOND argument chose
// between "ask the user" and "trusted, no dialog".
//
// Two independent fixes, each pinned here:
//   1. `window.__bmmDeeplink` cannot claim a trusted origin (deeplink-guard `windowOrigin`);
//      the scheduler and the local API use link-dispatch.ts, which is not on window.
//   2. Every sanitiser drops the listeners' vocabulary (inline-actions `isBehaviourAttr`),
//      and a document-level listener that starts reading a NEW attribute fails this file
//      until it is classified.
//
// Against the COMPILED modules where they load in Node, against the source for the wiring.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'frontend/src');
const js = (p) => import(pathToFileURL(join(ROOT, 'frontend/js', p)).href);
const src = (p) => readFileSync(join(SRC, p), 'utf8');

const G = await js('core/deeplink-guard.js');
const IA = await js('core/inline-actions.js');

describe('window.__bmmDeeplink cannot claim a trusted origin', () => {
    test('trusted origins are downgraded, the others kept', () => {
        assert.equal(typeof G.windowOrigin, 'function', 'deeplink-guard has no windowOrigin');
        for (const o of ['scheduler', 'api', 'self']) assert.equal(G.windowOrigin(o), 'unknown', o);
        for (const o of ['theme', 'panel', 'external', 'unknown']) assert.equal(G.windowOrigin(o), o, o);
        assert.equal(G.windowOrigin(undefined), 'unknown');
        assert.equal(G.windowOrigin('SCHEDULER'), 'unknown');
    });

    test('a downgraded call is asked about (control: the trusted one is not)', async () => {
        const url = `bmm://app/launch?id=obs`;
        const ask = async (origin) => {
            const asked = [];
            await G.admitLink(url, origin, { confirm: async (p) => { asked.push(p); return false; }, refuse: () => {} });
            return asked.length;
        };
        assert.equal(await ask('scheduler'), 0, 'control: a trusted origin is not asked');
        assert.equal(await ask(G.windowOrigin('scheduler')), 1, 'a window call claiming scheduler was not asked');
    });

    test('the window function goes through windowOrigin', () => {
        const dlm = src('core/deep_link_manager.ts');
        assert.match(dlm, /__bmmDeeplink\s*=\s*\([^)]*\)\s*=>\s*handleDeepLink\(url,\s*windowOrigin\(origin\)\)/);
        assert.match(dlm, /setTrustedLinkDispatcher\(/);
    });

    test('no caller asks window.__bmmDeeplink for a trusted origin', () => {
        const hits = [];
        (function walk(d) {
            for (const f of readdirSync(d)) {
                const p = join(d, f);
                if (statSync(p).isDirectory()) { walk(p); continue; }
                if (!p.endsWith('.ts')) continue;
                // Comments out first: the ones explaining this very change name the function
                // and the origin within a line of each other.
                const s = readFileSync(p, 'utf8')
                    .replace(/\/\*[\s\S]*?\*\//g, '')
                    .replace(/^[ \t]*\/\/[^\n]*$/gm, '');
                // `go = window.__bmmDeeplink` then `go(url, 'api')`, or the direct call.
                if (/__bmmDeeplink[\s\S]{0,300}?,\s*'(scheduler|api|self)'\s*\)/.test(s)) hits.push(p.slice(SRC.length + 1));
            }
        })(SRC);
        assert.deepEqual(hits, [], `still handing a trusted origin to the window function: ${hits.join(', ')}`);
    });
});

describe('sanitisers drop the delegated listeners\' vocabulary', () => {
    test('isBehaviourAttr: the vocabulary out, the renderers\' own attributes in', () => {
        const out = ['data-act', 'data-act-args', 'data-act-with', 'data-act-change', 'data-click-proxy',
            'data-hover', 'data-hover-out', 'data-press-out', 'data-onerror-target', 'data-copy',
            'data-open-url', 'data-url', 'DATA-ACT', 'data-sched-act', 'data-plug-act', 'data-bcweb-url'];
        const keep = ['data-lucide', 'data-ph', 'data-src', 'data-title', 'data-i', 'data-tab',
            'data-marker', 'data-bmm-deeplink', 'data-md-open', 'data-tex', 'class', 'href', 'data-actor'];
        for (const a of out) assert.equal(IA.isBehaviourAttr(a), true, `${a} survives`);
        for (const a of keep) assert.equal(IA.isBehaviourAttr(a), false, `${a} is dropped (breaks a renderer)`);
    });

    test('md-safe installs a DOMPurify hook that drops them (both DOMPurify callers share it)', async () => {
        const hooks = [];
        globalThis.DOMPurify = { addHook: (name, fn) => hooks.push({ name, fn }), sanitize: (h) => h };
        try {
            // First import in this process, so its module-load registration runs against the fake.
            await js('docs/md-safe.js');
        } finally { delete globalThis.DOMPurify; }
        const h = hooks.find((x) => x.name === 'uponSanitizeAttribute');
        assert.ok(h, 'no uponSanitizeAttribute hook installed at module load');
        const run = (attrName) => { const d = { attrName, keepAttr: true }; h.fn({}, d); return d.keepAttr; };
        assert.equal(run('data-act'), false);
        assert.equal(run('data-act-args'), false);
        assert.equal(run('data-click-proxy'), false);
        assert.equal(run('data-lucide'), true, 'control: a renderer attribute is kept');
        assert.equal(run('href'), true, 'control: an ordinary attribute is kept');
    });

    test('the theme sanitiser drops them too', () => {
        const te = src('features/themes/theme-engine.ts');
        const fn = te.slice(te.indexOf('function sanitizeHtml('), te.indexOf('return tpl.innerHTML'));
        assert.ok(fn.length > 50, 'sanitizeHtml not found');
        assert.match(fn, /isBehaviourAttr\(name\)/);
    });
});

// Every attribute a listener on document/window reads must be either dropped from foreign
// markup or listed here with the reason it is harmless when a stranger sets it.
const HARMLESS = {
    'data-view': 'navigation between the app\'s own views',
    'data-bmm-deeplink': 'theme buttons: dispatched with origin "theme", which asks first',
    'data-tooltip': 'tooltip text, written with textContent',
    'data-i18n': 'translation key lookup', 'data-i18n-placeholder': 'translation key lookup',
    'data-i18n-title': 'translation key lookup', 'data-i18n-tooltip': 'translation key lookup',
    'data-i': 'renderer vocabulary (:::tabs)', 'data-tab': 'renderer vocabulary (:::tabs)',
    'data-src': 'renderer vocabulary (:::replay); fetch()ed by the webview, whose CSP bounds it',
    'data-bmm-no-record': 'hides an element from a local recording; no action',
    'data-reorder-wired': 'internal marker read by card-order', 'data-hl': 'syntax-highlight language',
    'data-id': 'read from .mod-card, an app element', 'data-close': 'mods-details menu, own element only',
    'data-full': 'mods-details menu, own element only', 'data-type': 'mods-details menu, own element only',
    'data-go': 'ssh-browse listing, bound to its own modal', 'data-kofi-go': 'kofi modal, own element',
    'data-pi-close': 'plugin-inspect overlay, own element', 'data-flappy': 'mini-game, own element',
    'data-raw': 'plugins dropdown, own element', 'data-quality': 'tutorial picker, own element',
    'data-var': 'theme editor, own panel', 'data-bte-tab': 'theme editor, own panel',
    'data-repo-profile-id': 'custom event detail, not a DOM read', 'data-repo-tab': 'custom event detail, not a DOM read',
    'data-path': 'tooltip key source (data-tasky-from)',
};

function documentListenerAttrs() {
    const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    const found = new Map();
    (function walk(d) {
        for (const f of readdirSync(d)) {
            const p = join(d, f);
            if (statSync(p).isDirectory()) { walk(p); continue; }
            if (!p.endsWith('.ts')) continue;
            const s = readFileSync(p, 'utf8');
            const re = /(?:document|window|document\.body|document\.documentElement)\.addEventListener\(/g;
            let m;
            while ((m = re.exec(s))) {
                let i = m.index + m[0].length; let depth = 1;
                while (i < s.length && depth > 0) { const c = s[i]; if (c === '(') depth++; else if (c === ')') depth--; i++; }
                let body = s.slice(m.index, i);
                // A named handler: read its body too.
                const named = body.match(/addEventListener\(\s*'[a-z]+'\s*,\s*([A-Za-z_$][\w$]*)\s*[,)]/);
                if (named) {
                    const at = new RegExp(`(?:function\\s+${named[1]}\\s*\\(|const\\s+${named[1]}\\s*=)`).exec(s);
                    if (at) body += s.slice(at.index, at.index + 3000);
                }
                const add = (a) => { if (!found.has(a)) found.set(a, p.slice(SRC.length + 1)); };
                for (const a of body.matchAll(/\[data-([a-z0-9-]+)/g)) add('data-' + a[1]);
                for (const a of body.matchAll(/dataset\??\.([a-zA-Z0-9]+)/g)) add('data-' + kebab(a[1]));
                for (const a of body.matchAll(/getAttribute\('(data-[a-z0-9-]+)'\)/g)) add(a[1]);
            }
        }
    })(SRC);
    return found;
}

describe('every attribute a document-level listener reads is classified', () => {
    const found = documentListenerAttrs();

    test('the inventory is not empty (the probe works)', () => {
        // The known ones must be found, or the extraction is what is broken.
        for (const a of ['data-act', 'data-click-proxy', 'data-tooltip']) assert.ok(found.has(a), `probe missed ${a}`);
    });

    test('dropped from foreign markup, or harmless with a reason', () => {
        const open = [...found].filter(([a]) => !IA.isBehaviourAttr(a) && !(a in HARMLESS));
        assert.deepEqual(open.map(([a, f]) => `${a} (${f})`), [],
            'a document-level listener reads an attribute foreign markup can still carry. Add it to '
            + 'UNTRUSTED_DROP_ATTRS in inline-actions.ts, or to HARMLESS here with the reason.');
    });
});
