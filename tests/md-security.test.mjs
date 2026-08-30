// Hostile documents, through both of BMM's markdown renderers.
//
// `withGlobalTauri` is on: anything that executes in this webview can call every Tauri command
// the app exposes. update-notes.ts already says so beside the Community sanitiser — "an
// unsanitised post = potential RCE" — and that sanitiser covers one of the two renderers.
//
// The other one, md-lite, renders a PLUGIN's own documentation, which arrives with the plugin
// and is written by somebody else. It returned any source starting with `<` verbatim, straight
// into innerHTML.
//
// These tests assert on what the renderers PRODUCE, before anything sanitises it. That is
// deliberately the stricter question: DOMPurify is the net, and a net is not a reason for the
// thing above it to emit `javascript:` in the first place. It also runs in node, where there
// is no DOM and therefore no DOMPurify — so this measures the renderer, not the net.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => 'en', setItem() {} };
const R = new URL('../frontend/js/', import.meta.url).href;
const { renderDocMarkdown } = await import(`${R}docs/md-lite.js`);
const { safeDocUrl } = await import(`${R}docs/md-safe.js`);
const { expandDocBlocks } = await import(`${R}ui/rich-markdown.js`);

/**
 * An event handler ON A TAG — the only form that runs.
 *
 * Two things fooled the first draft of this, and both are worth the extra line:
 *
 *   · escaped text holds the word without being markup, so `&lt;img … onerror=…&gt;` is a
 *     string a reader sees;
 *   · that escaped text sits INSIDE a real tag's attribute (`data-title="&lt;img … onerror=`),
 *     and `[^>]*` walks straight into it because `&gt;` contains no `>`.
 *
 * So quoted attribute values are emptied first. A handler cannot hide inside another
 * attribute's value, which makes this the exact question: does a TAG carry an `on*`?
 */
const ON_ATTR = /<[a-z][^>]*\son[a-z]+\s*=/i;
const hasHandler = (html) => ON_ATTR.test(String(html).replace(/"[^"]*"|'[^']*'/g, '""'));

/** A URL an author can write, and what neither renderer may build out of it. */
const HOSTILE_URL = [
    { name: 'javascript: link', md: '[go](javascript:alert(1))', forbid: [/href="javascript:/i, /data-ext="javascript:/i] },
    { name: 'JaVaScRiPt: link', md: '[go](JaVaScRiPt:alert(1))', forbid: [/href="javascript:/i, /data-ext="javascript:/i] },
    { name: 'protocol-relative link', md: '[go](//evil.example/x)', forbid: [/href="\/\/evil\.example/, /data-ext="\/\/evil\.example/] },
    { name: 'javascript: in a button', md: 'x :button[Go]{href=javascript:alert(1)}', forbid: [/javascript:/i] },
    { name: 'javascript: in a ref', md: 'x :ref[Go]{href=javascript:alert(1)}', forbid: [/javascript:/i] },
    { name: 'javascript: in a file row', md: ':::file[r.pdf]{href=javascript:alert(1)}\n:::', forbid: [/javascript:/i] },
    { name: 'javascript: in a replay', md: ':::replay[T]{src=javascript:alert(1)}\n:::', forbid: [/javascript:/i] },
    { name: 'javascript: in a card', md: ':::card[C]{href=javascript:alert(1)}\nx\n:::', forbid: [/javascript:/i] },
];

/**
 * Raw markup an author can put in a document, and which must not become a tag.
 *
 * md-lite ONLY. `expandDocBlocks` produces markdown for `marked`, not HTML, so raw HTML
 * passing through it is the design — `renderMarkdown` runs it past DOMPurify afterwards, and
 * asserting here that a pre-processor removed HTML would be asserting the wrong stage.
 */
const HOSTILE_MARKUP = [
    { name: 'markup in a callout label', md: ':::note[<img src=x onerror=alert(1)>]\nbody\n:::' },
    { name: 'markup in a heading', md: '# <img src=x onerror=alert(1)>' },
    { name: 'markup in a table cell', md: '| a |\n|---|\n| <img src=x onerror=alert(1)> |' },
    { name: 'markup in a code fence', md: '```\n<img src=x onerror=alert(1)>\n```' },
    { name: 'markup in a tab title', md: ':::tabs\n:::tab{title="<img src=x onerror=alert(1)>"}\nx\n:::\n:::' },
    { name: 'markup in a schedule zone', md: ':::schedule[S]{tz="<img src=x onerror=1>"}\n| a |\n|---|\n| b |\n:::' },
    { name: 'markup in an icon name', md: 'x :icon[<script>alert(1)</script>]' },
    { name: 'markup in a kbd', md: 'x :kbd[<script>alert(1)</script>]' },
    { name: 'a script tag on its own', md: 'a\n\n<script>alert(1)</script>\n' },
];

describe('what the two renderers do with a hostile document', () => {
    for (const c of HOSTILE_MARKUP) {
        test(`md-lite — ${c.name}`, () => {
            // `trusted`, so the sanitiser is out of the way and this measures the RENDERER.
            const html = renderDocMarkdown(c.md, { trusted: true });
            assert.ok(!hasHandler(html), `a handler survived md-lite: ${html.slice(0, 200)}`);
            assert.ok(!/<script/i.test(html), `a script tag survived md-lite: ${html.slice(0, 200)}`);
        });
    }

    for (const c of HOSTILE_URL) {
        test(`md-lite — ${c.name}`, () => {
            const html = renderDocMarkdown(c.md, { trusted: true });
            for (const re of c.forbid) {
                assert.ok(!re.test(html), `${re} survived md-lite: ${html.slice(0, 200)}`);
            }
        });
        test(`rich-markdown — ${c.name}`, () => {
            const html = expandDocBlocks(c.md);
            for (const re of c.forbid) {
                assert.ok(!re.test(html), `${re} survived rich-markdown: ${html.slice(0, 200)}`);
            }
        });
    }

    test('a plugin README that is raw HTML is not passed through', () => {
        // The hole this file was written for. Untrusted is the default, so a caller that
        // forgets the option gets the safe answer.
        const out = renderDocMarkdown('<img src=x onerror=alert(1)>');
        assert.ok(!hasHandler(out), `raw HTML survived: ${out.slice(0, 200)}`);
    });

    test('our own HTML article bodies still pass through when asked', () => {
        // The passthrough is not a bug — docs-hub.ts writes article bodies as HTML. It is only
        // a bug when it is the default.
        const out = renderDocMarkdown('<p class="x">ours</p>', { trusted: true });
        assert.equal(out, '<p class="x">ours</p>');
    });

    test('an ordinary document still renders', () => {
        // The failure mode of a hardening pass is a renderer that draws nothing.
        const out = renderDocMarkdown('# Title\n\nSee [the docs](https://example.com/x).', { trusted: true });
        assert.match(out, /<h3>Title<\/h3>/);
        assert.match(out, /data-ext="https:\/\/example\.com\/x"/);
    });

    test('an ordinary link still survives the community renderer', () => {
        const out = expandDocBlocks('x :button[Go]{href=https://example.com/x}');
        assert.match(out, /href="https:\/\/example\.com\/x"/);
    });
});

describe('safeDocUrl', () => {
    for (const ok of ['/hosting', 'guide.md', '#anchor', 'https://x.dev', 'http://x.dev',
        'mailto:a@b.c', 'bmm://docs/open?article=x']) {
        test(`allows ${JSON.stringify(ok)}`, () => assert.equal(safeDocUrl(ok), true));
    }
    for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x',
        'vbscript:x', '//evil.example', 'java\tscript:alert(1)', 'java\nscript:alert(1)', '']) {
        test(`refuses ${JSON.stringify(bad)}`, () => assert.equal(safeDocUrl(bad), false));
    }
});
