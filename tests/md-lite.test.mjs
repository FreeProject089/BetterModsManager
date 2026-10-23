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

/**
 * Every call here renders as TRUSTED, and that is the point of these tests.
 *
 * `renderDocMarkdown` is untrusted by default now — a plugin's README goes through it —
 * so the default path ends in a sanitiser that needs a DOM, and node has none. These
 * measure the RENDERER; tests/md-security.test.mjs measures what happens to a document
 * nobody vouched for.
 */
const render = (md) => renderDocMarkdown(md, { trusted: true });

describe('admonitions', () => {
  test('a plain one renders as a callout, not as text', () => {
    const html = render('!!! warning "Careful"\n\n    Body text.\n');
    assert.match(html, /doc-callout-warning/);
    assert.doesNotMatch(html, /!!!\s+warning/, 'the marker must never reach the reader');
  });

  test('a title containing ESCAPED QUOTES still renders', () => {
    // This shipped broken: `[^"]*` stopped at the first inner quote, so the whole block fell
    // through to a paragraph and the reader saw `!!! note "\"Conflict rules\"…`.
    const html = render('!!! note "\\"Conflict rules\\" = the order"\n\n    Body.\n');
    assert.match(html, /doc-callout/);
    assert.doesNotMatch(html, /!!!\s+note/);
    assert.match(html, /Conflict rules/);
  });

  test('a collapsible one becomes <details>, and ???+ starts open', () => {
    assert.match(render('??? tip "More"\n\n    Body.\n'), /<details[^>]*class="doc-details"/);
    assert.match(render('???+ tip "More"\n\n    Body.\n'), /<details[^>]*\sopen/);
  });

  test('the callout icon is an inline SVG, not an emoji', () => {
    // Emoji rendered in whatever font the OS supplied: some full-colour, some monochrome, at
    // a size that ignored the badge. currentColor keeps them one family and theme-aware.
    const html = render('!!! tip "T"\n\n    Body.\n');
    assert.match(html, /<svg[^>]*stroke="currentColor"/);
    assert.doesNotMatch(html, /💡|⛔|ℹ/u);
  });
});

describe('escaping', () => {
  test('an HTML comment is removed, not printed', () => {
    const html = render('Before\n\n<!-- TODO: not for readers -->\n\nAfter\n');
    assert.doesNotMatch(html, /TODO/);
    assert.doesNotMatch(html, /&lt;!--/);
  });

  test('raw HTML in the source cannot inject an element', () => {
    const html = render('Hello <img src=x onerror=alert(1)> world\n');
    assert.doesNotMatch(html, /<img/i, 'author-supplied HTML must not become an element');
  });

  test('a mermaid source survives its attribute intact', () => {
    // 54 of 56 diagrams once reached mermaid truncated, because an unescaped `"` inside
    // A["Label"] closed the data-mermaid attribute early.
    const html = render('```mermaid\ngraph TD\n  A["Label & more"] --> B\n```\n');
    const m = /data-mermaid="([^"]*)"/.exec(html);
    assert.ok(m, 'the diagram source must be stashed in an attribute');
    const decoded = m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    assert.match(decoded, /A\["Label & more"\]/, 'it must decode to exactly what went in');
  });
});

describe('structure', () => {
  test('a GFM table becomes a table', () => {
    const html = render('| A | B |\n|---|---|\n| 1 | 2 |\n');
    assert.match(html, /<table/);
    assert.match(html, /<th/);
  });

  test('content tabs become a tab bar', () => {
    const html = render('=== "One"\n\n    First.\n\n=== "Two"\n\n    Second.\n');
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
    assert.match(render('## Conflicts {#conflict-rules}\n'), /\{#conflict-rules\}/);
    // What md-lite must honour is the form sync-docs produces.
    assert.match(render('<a id="conflict-rules"></a>\n\n## Conflicts\n'), /id="conflict-rules"/);
  });

  test('a fenced block carries its language, which is what colours it', () => {
    assert.match(render('```json\n{"a":1}\n```\n'), /class="[^"]*language-json/);
  });
});

// ── Tabs, hours and instants ─────────────────────────────────────────────────
//
// These three arrived together, so they are tested together. Each assertion below is a
// decision that could be quietly reversed by somebody "simplifying" the renderer.
describe('tabs, hours and instants', () => {
  test('tabs get a strip, and only the first panel is open', () => {
    const html = render(
      ':::tabs\n:::tab{title="Windows"}\nRun it.\n:::\n:::tab{title="Linux"}\nRun it too.\n:::\n:::\n');
    assert.match(html, /class="doc-tabs-bar"/);
    assert.match(html, /doc-tabs-btn is-on"[^>]*data-tab="0"/);
    assert.match(html, /class="doc-tab is-on" data-title="Windows"/);
    // The second panel must NOT be open: two open panels is the stacked page this block
    // exists to replace, wearing a tab strip.
    assert.match(html, /class="doc-tab" data-title="Linux"/);
  });

  test('the strip reads its labels off the panels', () => {
    // Not from a separate list. A label written twice is a label that drifts from the content
    // it names, and nothing would report the drift.
    const html = render(':::tabs\n:::tab{title="Only"}\nBody.\n:::\n:::\n');
    assert.match(html, />Only<\/button>/);
  });

  test('an untitled panel is numbered rather than left blank', () => {
    const html = render(':::tabs\n:::tab\nBody.\n:::\n:::\n');
    assert.match(html, />1<\/button>/);
  });

  test('`:::tabs` around ordinary content renders the content, not an empty strip', () => {
    const html = render(':::tabs\nJust a paragraph.\n:::\n');
    assert.match(html, /Just a paragraph\./);
    assert.doesNotMatch(html, /doc-tabs-bar/);
  });

  test('a schedule names its zone and leaves the rows ALONE', () => {
    // The point of the block. "Monday 09:00 Europe/Paris" is 09:00 in Paris every week of the
    // year; converting the row would make it right today and wrong in March, with nothing on
    // the page admitting it.
    const html = render(
      ':::schedule[Support]{tz=Europe/Paris}\n| Day | Open |\n|---|---|\n| Mon-Fri | 09:00-18:00 |\n:::\n');
    assert.match(html, /class="doc-schedule"/);
    assert.match(html, /doc-schedule-tz">Europe\/Paris</);
    assert.match(html, /09:00-18:00/);
    assert.match(html, /<table/);
  });

  test('the schedule note is left EMPTY for the page to fill', () => {
    // md-lite has no dictionary. It carries the zone and hydrateDocPage writes the sentence —
    // and if hydration never runs, an empty <p> is a blank line rather than a wrong hour.
    const html = render(':::hours{tz=Asia/Tokyo}\nAlways.\n:::\n');
    assert.match(html, /<p class="doc-schedule-note" data-sched-note="Asia\/Tokyo"><\/p>/);
  });

  test('an instant is converted, and carries what the author typed', () => {
    const html = render('Starts at :time[2026-09-01T20:00]{tz=Europe/Paris}.\n');
    assert.match(html, /<time class="doc-time"/);
    // 20:00 in Paris on that date is 18:00 UTC — the date is what settles the DST side.
    assert.match(html, /datetime="2026-09-01T18:00:00\.000Z"/);
    assert.match(html, /title="2026-09-01T20:00 Europe\/Paris"/);
  });

  test('an unparseable instant is shown as written, never as "Invalid Date"', () => {
    const html = render('Meet :at[whenever]{tz=Europe/Paris}.\n');
    assert.match(html, /class="doc-time">whenever</);
    assert.doesNotMatch(html, /Invalid Date/);
  });
});
