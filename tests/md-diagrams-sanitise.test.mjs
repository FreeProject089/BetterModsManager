// Diagrams through the sanitiser: every SANITISED B.MD render keeps its mermaid sources.
//
// DOMPurify drops any attribute whose value holds `-->` (its guard against comment-based mXSS),
// and `-->` is the arrow of every flowchart. md-lite carries a diagram's source in
// `data-mermaid`, so through the sanitiser a plugin's README (plugin-assets.ts) lost every
// diagram: the block drew as an empty placeholder. The order-list notes had worked around it on
// their own; the fix now lives in the shared path (md-safe.ts `sanitizeDocHtml`).
//
// Node has no DOM and no DOMPurify, so this installs a stand-in that does the one thing that
// matters here exactly as DOMPurify does it: an attribute whose DECODED value contains `-->`
// is removed. Everything else passes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.localStorage = { getItem: () => 'en', setItem() {} };

const decode = (v) => v.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
let sanitizeCalls = 0;
globalThis.DOMPurify = {
  addHook() {},
  sanitize(html) {
    sanitizeCalls += 1;
    return String(html).replace(/\s([\w-]+)="([^"]*)"/g, (m, _name, value) => (decode(value).includes('-->') ? '' : m));
  },
};

const R = new URL('../frontend/js/', import.meta.url).href;
const { renderDocMarkdown, renderDocMarkup } = await import(`${R}docs/md-lite.js`);
const S = await import(`${R}docs/md-safe.js`);
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const DOC = '# Plugin\n\n```mermaid\nflowchart LR\n  A[Mod A] --> B[Mod B]\n```\n\n:::mermaid\ngraph TD\n  C --> D\n:::\n';

describe('a sanitised render keeps its diagrams', () => {
  test('the stand-in reproduces the bug: sanitising md-lite markup directly empties data-mermaid', () => {
    const raw = globalThis.DOMPurify.sanitize(renderDocMarkup(DOC));
    assert.doesNotMatch(raw, /data-mermaid=/, 'without the stash, the source is gone');
  });

  test('renderDocMarkdown (untrusted, sanitised) keeps both sources, on their own blocks', () => {
    const before = sanitizeCalls;
    const html = renderDocMarkdown(DOC);
    assert.ok(sanitizeCalls > before, 'the untrusted path did go through the sanitiser');
    assert.match(html, /<div class="dh-mermaid" data-mermaid="flowchart LR\n {2}A\[Mod A\] --&gt; B\[Mod B\]">/);
    assert.match(html, /<div class="dh-mermaid" data-mermaid="graph TD\n {2}C --&gt; D">/);
    assert.doesNotMatch(html, /data-mermaid-ref/, 'no reference is left behind');
  });

  test('a source with raw markup characters is put back escaped, never as markup', () => {
    const { html, sources } = S.stashDiagrams('<div class="dh-mermaid" data-mermaid="A --> <img src=x onerror=1>"></div>', 'n1');
    assert.equal(html, '<div class="dh-mermaid" data-mermaid-ref="n1:0"></div>');
    assert.equal(sources[0], 'A --&gt; &lt;img src=x onerror=1&gt;');
    const back = S.restoreDiagrams(html, sources, 'n1');
    assert.equal(back, '<div class="dh-mermaid" data-mermaid="A --&gt; &lt;img src=x onerror=1&gt;"></div>');
    assert.doesNotMatch(back, /<img/);
  });

  test('a reference the document wrote itself matches nothing and is dropped', () => {
    const sources = ['graph TD\n  X --&gt; Y'];
    // Wrong nonce on a diagram block, and the right nonce on an element that is not one.
    const forged = '<div class="dh-mermaid" data-mermaid-ref="guess:0"></div><p class="x" data-mermaid-ref="n2:0">t</p>';
    const out = S.restoreDiagrams(forged, sources, 'n2');
    assert.equal(out, '<div class="dh-mermaid"></div><p class="x">t</p>');
  });

  test('only md-lite\'s own diagram block is stashed', () => {
    const { html, sources } = S.stashDiagrams('<p data-mermaid="a --> b">x</p>', 'n3');
    assert.equal(sources.length, 0);
    assert.equal(html, '<p data-mermaid="a --> b">x</p>', 'left for the sanitiser to judge');
  });
});

describe('the surfaces', () => {
  test('a plugin\'s documentation draws its diagrams in strict mode', () => {
    const pa = read('frontend/src/features/plugins/plugin-assets.ts');
    const at = pa.indexOf('renderDocMarkdown(text)');
    assert.ok(at > 0);
    assert.match(pa.slice(at), /drawDiagrams\(view, \{ strict: true \}\)/);
  });

  test('the order-list notes rely on the shared path, not their own stash', () => {
    const notes = read('frontend/src/features/profiles/order-notes.ts');
    assert.doesNotMatch(notes, /stashDiagrams\(|data-mermaid-ref/);
    assert.match(notes, /md\.sanitizeDocHtml\(/);
  });

  test('sanitizeDocHtml stashes before DOMPurify and restores after it', () => {
    const src = read('frontend/src/docs/md-safe.ts');
    const body = src.slice(src.indexOf('export function sanitizeDocHtml'), src.indexOf('export function safeDocUrl'));
    const stash = body.indexOf('stashDiagrams(html, nonce)');
    const purify = body.indexOf('DP.sanitize(stashed');
    const restore = body.indexOf('restoreDiagrams(clean, sources, nonce)');
    assert.ok(stash > 0 && purify > stash && restore > purify, 'stash → sanitise → restore');
  });
});
