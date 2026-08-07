// The in-app documentation renderer, against the COMPILED module.
//
// Every assertion here is a bug that actually shipped, or one the escaping rules make easy to
// reintroduce. md-lite writes HTML into innerHTML from files anyone may edit, so its escaping
// is a security boundary as much as a formatting one.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { renderDocMarkdown } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/docs/md-lite.js')).href
);

describe('admonitions', () => {
  test('a plain one renders as a callout, not as text', () => {
    const html = renderDocMarkdown('!!! warning "Careful"\n\n    Body text.\n');
    assert.match(html, /doc-callout-warning/);
    assert.doesNotMatch(html, /!!!\s+warning/, 'the marker must never reach the reader');
  });

  test('a title containing ESCAPED QUOTES still renders', () => {
    // This shipped broken: `[^"]*` stopped at the first inner quote, so the whole block fell
    // through to a paragraph and the reader saw `!!! note "\"Conflict rules\"…`.
    const html = renderDocMarkdown('!!! note "\\"Conflict rules\\" = the order"\n\n    Body.\n');
    assert.match(html, /doc-callout/);
    assert.doesNotMatch(html, /!!!\s+note/);
    assert.match(html, /Conflict rules/);
  });

  test('a collapsible one becomes <details>, and ???+ starts open', () => {
    assert.match(renderDocMarkdown('??? tip "More"\n\n    Body.\n'), /<details[^>]*class="doc-details"/);
    assert.match(renderDocMarkdown('???+ tip "More"\n\n    Body.\n'), /<details[^>]*\sopen/);
  });

  test('the callout icon is an inline SVG, not an emoji', () => {
    // Emoji rendered in whatever font the OS supplied: some full-colour, some monochrome, at
    // a size that ignored the badge. currentColor keeps them one family and theme-aware.
    const html = renderDocMarkdown('!!! tip "T"\n\n    Body.\n');
    assert.match(html, /<svg[^>]*stroke="currentColor"/);
    assert.doesNotMatch(html, /💡|⛔|ℹ/u);
  });
});

describe('escaping', () => {
  test('an HTML comment is removed, not printed', () => {
    const html = renderDocMarkdown('Before\n\n<!-- TODO: not for readers -->\n\nAfter\n');
    assert.doesNotMatch(html, /TODO/);
    assert.doesNotMatch(html, /&lt;!--/);
  });

  test('raw HTML in the source cannot inject an element', () => {
    const html = renderDocMarkdown('Hello <img src=x onerror=alert(1)> world\n');
    assert.doesNotMatch(html, /<img/i, 'author-supplied HTML must not become an element');
  });

  test('a mermaid source survives its attribute intact', () => {
    // 54 of 56 diagrams once reached mermaid truncated, because an unescaped `"` inside
    // A["Label"] closed the data-mermaid attribute early.
    const html = renderDocMarkdown('```mermaid\ngraph TD\n  A["Label & more"] --> B\n```\n');
    const m = /data-mermaid="([^"]*)"/.exec(html);
    assert.ok(m, 'the diagram source must be stashed in an attribute');
    const decoded = m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    assert.match(decoded, /A\["Label & more"\]/, 'it must decode to exactly what went in');
  });
});

describe('structure', () => {
  test('a GFM table becomes a table', () => {
    const html = renderDocMarkdown('| A | B |\n|---|---|\n| 1 | 2 |\n');
    assert.match(html, /<table/);
    assert.match(html, /<th/);
  });

  test('content tabs become a tab bar', () => {
    const html = renderDocMarkdown('=== "One"\n\n    First.\n\n=== "Two"\n\n    Second.\n');
    assert.match(html, /dh-tabs/);
    assert.match(html, /data-tab=/);
  });

  test("custom heading anchors are sync-docs' job, not md-lite's", () => {
    // Written to record WHERE the work happens, because the first version of this test
    // asserted the wrong layer and looked like a bug in md-lite.
    //
    // sync-docs rewrites `## H {#id}` into `<a id="id"></a>` while copying, so md-lite never
    // meets the brace form — and prints it verbatim if handed one directly. That IS the
    // contract: render a page outside the pipeline and its anchors will not work.
    assert.match(renderDocMarkdown('## Conflicts {#conflict-rules}\n'), /\{#conflict-rules\}/);
    // What md-lite must honour is the form sync-docs produces.
    assert.match(renderDocMarkdown('<a id="conflict-rules"></a>\n\n## Conflicts\n'), /id="conflict-rules"/);
  });

  test('a fenced block carries its language, which is what colours it', () => {
    assert.match(renderDocMarkdown('```json\n{"a":1}\n```\n'), /class="[^"]*language-json/);
  });
});
