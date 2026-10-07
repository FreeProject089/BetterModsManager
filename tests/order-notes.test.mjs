// A saved order list's notes: the size rule the counter shares with the backend, the editor's
// toolbar edits, and the untrusted path an IMPORTED list's notes take.
//
// The backend half (notes keep their line breaks, the 20 000 cap, the sticky `imported` flag,
// the .bmmorder file read strictly, the code's ceiling) is tested in Rust
// (src-tauri/src/commands/order_lists_tests.rs). This checks what the frontend renders.
//
// The renderer runs here without a DOM, so without DOMPurify: the hostile cases below measure
// md-lite's markup after `offlineMarkup` alone, which is the stricter question. In the app the
// sanitiser and a DOM pass (order-notes.ts `scrubFetches`) run after it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

globalThis.localStorage = { getItem: () => 'en', setItem() {} };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const js = (p) => import(pathToFileURL(join(ROOT, 'frontend/js', p)).href);
const N = await js('features/profiles/order-notes-model.js');
const { renderDocMarkup } = await js('docs/md-lite.js');

/** The imported path, minus the two nets that need a DOM. */
const untrusted = (md) => N.offlineMarkup(renderDocMarkup(md));

/** An event handler ON A TAG (quoted attribute values emptied first, as md-security does). */
const hasHandler = (html) => /<[a-z][^>]*\son[a-z]+\s*=/i.test(String(html).replace(/"[^"]*"|'[^']*'/g, '""'));
/** Anything in the markup that makes the webview fetch from somewhere. */
const FETCHES = [/<img\b/i, /<iframe\b/i, /<video\b/i, /<audio\b/i, /<source\b/i, /<embed\b/i, /<object\b/i, /\ssrc="/i, /srcset=/i, /poster=/i, /url\(/i, /data-lucide=/i, /data-ph=/i, /data-src=/i];

describe('the size rule', () => {
    test('counted like the backend: code points, a CRLF is one break', () => {
        assert.equal(N.NOTES_MAX, 20000);
        assert.equal(N.notesLength('a\r\nb'), 3);
        assert.equal(N.notesLength('é😀'), 2);
        assert.equal(N.notesLength(''), 0);
    });
    test('the counter warns from 90 % and refuses past the cap', () => {
        assert.equal(N.notesFill(100), 'ok');
        assert.equal(N.notesFill(18000), 'near');
        assert.equal(N.notesFill(20000), 'near');
        assert.equal(N.notesFill(20001), 'over');
    });
});

describe('the toolbar', () => {
    test('bold wraps the selection, and a second click takes it off', () => {
        const one = N.applyFormat('say hi now', 4, 6, 'bold');
        assert.deepEqual(one, { value: 'say **hi** now', start: 6, end: 8 });
        const two = N.applyFormat(one.value, one.start, one.end, 'bold');
        assert.deepEqual(two, { value: 'say hi now', start: 4, end: 6 });
    });
    test('nothing selected: a placeholder in the reader\'s words, selected', () => {
        const r = N.applyFormat('', 0, 0, 'italic', { text: 'texte' });
        assert.deepEqual(r, { value: '*texte*', start: 1, end: 6 });
    });
    test('lists prefix every selected line, and toggle off', () => {
        const r = N.applyFormat('a\nb\nc', 0, 3, 'ol');
        assert.equal(r.value, '1. a\n2. b\nc');
        assert.equal(N.applyFormat(r.value, r.start, r.end, 'ol').value, 'a\nb\nc');
        assert.equal(N.applyFormat('x', 0, 1, 'ul').value, '- x');
        assert.equal(N.applyFormat('## x', 0, 4, 'h3').value, '### x');
    });
    test('blocks go on lines of their own', () => {
        const r = N.applyFormat('before', 6, 6, 'mermaid');
        assert.match(r.value, /^before\n\n```mermaid\n[\s\S]+\n```$/);
        assert.equal(r.value.slice(r.start, r.end), 'flowchart LR\n  A[Mod A] --> B[Mod B]');
        assert.match(N.applyFormat('', 0, 0, 'warning').value, /^:::warning\ntext\n:::$/);
        assert.match(N.applyFormat('', 0, 0, 'math').value, /^\$\$\n.+\n\$\$$/);
    });
    test('every kind has a label in every language', () => {
        for (const lang of ['en', 'fr', 'template']) {
            const d = JSON.parse(read(`frontend/Lang/${lang}.json`));
            for (const k of N.FORMAT_KINDS) assert.ok(d[`orderList.fmt.${k}`], `${lang}: orderList.fmt.${k}`);
        }
    });
});

describe('imported notes: rendered, nothing executes, nothing is fetched', () => {
    const REMOTE = [
        ['a markdown image', '![logo](https://evil.example/x.png)'],
        ['an image block', ':::img{src="https://evil.example/x.png" alt="pic"}\n:::'],
        ['an inline image', 'see :img[pic]{src="https://evil.example/x.png"}'],
        ['a YouTube embed', '::youtube{src="https://youtu.be/dQw4w9WgXcQ"}'],
        ['a Spotify embed', '::spotify{src="https://open.spotify.com/track/abc123"}'],
        ['an audio block', ':::audio{src="https://evil.example/a.mp3"}\n:::'],
        ['a card with an image', ':::cards\n:::card[C]{image="https://evil.example/c.png"}\nx\n:::\n:::'],
        ['a card with a video', ':::cards\n:::card[C]{video="https://evil.example/c.mp4"}\nx\n:::\n:::'],
        ['a hero image', ':::hero[H]{image="https://evil.example/h.png"}\nx\n:::'],
        ['a quote avatar', ':::quote{author="A" avatar="https://evil.example/a.png"}\nx\n:::'],
        ['a CDN icon', 'x :icon[rocket] :icon[ph:rocket] :icon[brand:github]'],
        ['a replay', ':::replay{src="https://evil.example/r.bmmreplay" title="T"}\n:::'],
    ];
    for (const [name, md] of REMOTE) {
        test(`no fetch: ${name}`, () => {
            const html = untrusted(md);
            for (const re of FETCHES) assert.doesNotMatch(html, re, `${name}: ${html.slice(0, 240)}`);
        });
    }

    const HOSTILE = [
        ['raw HTML first (the trusted passthrough is never taken)', '<img src=x onerror=alert(1)><script>alert(1)</script>'],
        ['a script in a paragraph', 'a\n\n<script>alert(1)</script>\n'],
        ['a handler in a callout label', ':::note[<img src=x onerror=alert(1)>]\nbody\n:::'],
        ['a javascript: link', '[go](javascript:alert(1))'],
        ['an iframe written raw', '<iframe src="https://evil.example"></iframe>'],
    ];
    for (const [name, md] of HOSTILE) {
        test(`nothing executes: ${name}`, () => {
            const html = untrusted(md);
            assert.ok(!hasHandler(html), `${name}: ${html.slice(0, 240)}`);
            assert.doesNotMatch(html, /<script|<iframe|href="javascript:|data-ext="javascript:/i, name);
        });
    }

    test('diagram sources reach the shared sanitiser intact (it keeps them: md-diagrams-sanitise.test.mjs)', () => {
        const html = untrusted('```mermaid\nflowchart LR\n  A --> B\n```\n\n:::mermaid\ngraph TD\n  C --> D\n:::');
        assert.match(html, /<div class="dh-mermaid" data-mermaid="flowchart LR\n  A --&gt; B"/);
        assert.match(html, /<div class="dh-mermaid" data-mermaid="graph TD\n  C --&gt; D"/);
    });

    test('an image leaves its alt text', () => {
        assert.match(untrusted('![the load order](https://x.example/a.png)'), /olm-img-alt">the load order</);
    });

    test('what is local still renders: headings, tables, callouts, code, maths, diagrams', () => {
        const html = untrusted([
            '## Install first',
            '',
            '| Mod | Why |',
            '| --- | --- |',
            '| A | base |',
            '',
            ':::warning',
            'Back up first.',
            ':::',
            '',
            '```mermaid',
            'flowchart LR',
            '  A["Base"] --> B["Patch"]',
            '```',
            '',
            '$$',
            'E = mc^2',
            '$$',
        ].join('\n'));
        assert.match(html, /<h[23]\b/);
        assert.match(html, /<table\b/);
        assert.match(html, /doc-callout/);
        assert.match(html, /class="dh-mermaid" data-mermaid="flowchart LR\n  A\[&quot;Base&quot;\] --&gt; B\[&quot;Patch&quot;\]"/, 'the diagram source reaches mermaid whole');
        assert.match(html, /math|katex/i);
    });
});

describe('wiring', () => {
    const notes = read('frontend/src/features/profiles/order-notes.ts');
    const lists = read('frontend/src/features/profiles/order-lists.ts');
    const mmd = read('frontend/src/docs/md-mermaid.ts');

    test('imported notes take the three nets, own notes the sanitised renderer', () => {
        const body = notes.slice(notes.indexOf('export function notesHtml'), notes.indexOf('export function hydrateNotes'));
        assert.match(body, /tpl\.innerHTML = md\.sanitizeDocHtml\(imported \? offlineMarkup\(markup\) : markup\)/, 'both paths sanitised; imported: every fetch out first');
        assert.match(body, /if \(imported\) scrubFetches\(tpl\.content\)/);
        assert.doesNotMatch(notes, /trusted:\s*true/, 'notes are never rendered on the trusted path');
    });

    test('diagrams are drawn in strict mode, and an imported list\'s SVG is scrubbed', () => {
        assert.match(notes, /drawDiagrams\(host, \{ strict: true, scrub: imported \? scrubSvg : undefined \}\)/);
        assert.match(mmd, /mermaidTheme\(opts\.strict \? 'strict' : 'loose'\)/);
        assert.match(mmd, /securityLevel,/);
    });

    test('a list read from a code or a file is flagged imported', () => {
        const use = lists.slice(lists.indexOf("use.addEventListener('click'"));
        assert.match(use, /base\.imported = true/);
        assert.match(use, /base\.description = got\.notes/);
    });

    test('every key the notes and the share dialog use exists in every language', () => {
        const keys = new Set([...notes.matchAll(/t\('((?:orderList|order)\.[\w.]+)'\)/g), ...lists.matchAll(/(?:t|fill)\('((?:orderList|order)\.[\w.]+)'/g)].map((m) => m[1]));
        for (const v of ['source', 'split', 'preview']) keys.add(`orderList.view.${v}`);
        assert.ok(keys.size > 30, `only ${keys.size}`);
        for (const lang of ['en', 'fr', 'template']) {
            const d = JSON.parse(read(`frontend/Lang/${lang}.json`));
            // template.json mirrors the lists' own keys; the older `order.*` ones predate it there.
            for (const k of keys) {
                if (lang === 'template' && !k.startsWith('orderList.')) continue;
                assert.ok(typeof d[k] === 'string' && d[k], `${lang}.json is missing ${k}`);
            }
        }
    });
});
