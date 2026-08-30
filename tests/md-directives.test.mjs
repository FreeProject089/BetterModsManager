// Every directive BMM claims, put in — and something has to come out.
//
// Written after `:time` was found on the website rendering NOTHING: no element, no fallback,
// no console line, just a gap in the middle of a sentence. It had been documented in five
// places and named by three checks, every one of which confirmed it was DOCUMENTED. Not one
// rendered it.
//
// BMM has two renderers and the same exposure. `check-md-parity.mjs` compares BMM's directive
// NAMES against the website's; a name is not an output. So this feeds each directive its
// documented syntax and insists the result is not simply the source handed back.
//
// The assertion is deliberately weak, and that is what makes it honest. Asserting WHAT each
// one draws would be this file re-implementing the renderers, and it would agree with them by
// construction. "It produced something" is the claim that was false.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// i18n reads localStorage the moment it is imported, and rich-markdown imports it. Guarded in
// the module itself now; the stub keeps this suite honest about which language it measured.
globalThis.localStorage ??= { getItem: () => 'en', setItem() {} };

const { expandDocBlocks } = await import(pathToFileURL(join(ROOT, 'frontend/js/ui/rich-markdown.js')).href);
const { renderDocMarkdown } = await import(pathToFileURL(join(ROOT, 'frontend/js/docs/md-lite.js')).href);

/**
 * Every call here renders as TRUSTED, and that is the point of these tests.
 *
 * `renderDocMarkdown` is untrusted by default now — a plugin's README goes through it —
 * so the default path ends in a sanitiser that needs a DOM, and node has none. These
 * measure the RENDERER; tests/md-security.test.mjs measures what happens to a document
 * nobody vouched for.
 */
const render = (md) => renderDocMarkdown(md, { trusted: true });

/** How each directive is WRITTEN. Anything unlisted gets the plain container form. */
const FORM = {
  badge: 'x :badge[NEW]{color=#0a7}', tag: 'x :tag[OLD]', icon: 'x :icon[rocket]',
  kbd: 'x :kbd[Ctrl+K]', button: 'x :button[Go]{href=/x}', btn: 'x :btn[Go]{href=/x}',
  link: 'x :link[Go]{href=/x color=#0a7}',
  time: 'x :time[2026-09-01T20:00]{tz=Europe/Paris}',
  at: 'x :at[2026-09-01T20:00]{tz=Europe/Paris}',
  toc: '## A heading\n\n::toc\n',
  file: ':::file[r.pdf]{href=/x size="1 MB"}\n:::',
  cards: ':::cards\n:::card[C]\nx\n:::\n:::',
  columns: ':::columns\n:::column\nL\n:::\n:::', column: ':::columns\n:::column\nL\n:::\n:::',
  row: ':::row\n:::col\nL\n:::\n:::', col: ':::row\n:::col\nL\n:::\n:::',
  steps: ':::steps\n:::step[One]\nx\n:::\n:::', step: ':::steps\n:::step[One]\nx\n:::\n:::',
  tabs: ':::tabs\n:::tab{title="W"}\nx\n:::\n:::', tab: ':::tabs\n:::tab{title="W"}\nx\n:::\n:::',
  roadmap: ':::roadmap[R]\n:::stage[Done]{state=done}\n- a\n:::\n:::',
  progress: ':::progress[R]\n:::stage[Done]{state=done}\n- a\n:::\n:::',
  stage: ':::roadmap[R]\n:::stage[Done]{state=done}\n- a\n:::\n:::',
  phase: ':::roadmap[R]\n:::phase[Done]{state=done}\n- a\n:::\n:::',
  replay: ':::replay[T]{src=/x.bmmreplay}\n:::',
  bmmreplay: ':::bmmreplay[T]{src=/x.bmmreplay}\n:::',
  schedule: ':::schedule[S]{tz=Europe/Paris}\n| a | b |\n|---|---|\n| c | d |\n:::',
  hours: ':::hours[S]{tz=Europe/Paris}\n| a | b |\n|---|---|\n| c | d |\n:::',
};
const formOf = (n) => FORM[n] || `:::${n}[T]\nx\n:::`;

/** Every name a renderer answers to, read from it rather than listed here. */
function directivesOf(file, calloutRe) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/name === '([a-z0-9-]+)'/g)) names.add(m[1]);
  const table = src.match(calloutRe);
  if (table) for (const m of table[1].matchAll(/([a-z0-9-]+):/g)) names.add(m[1]);
  for (const m of src.matchAll(/\/:(?:\(\?:)?([a-z0-9|-]+)\)?\\\[/g)) for (const n of m[1].split('|')) names.add(n);
  if (/::toc\b/.test(src)) names.add('toc');
  return [...names].sort();
}

const RICH = directivesOf('frontend/src/ui/rich-markdown.ts', /^const CALLOUT_ALERT: Record<string, string> = \{([\s\S]*?)^\};/m);
const LITE = directivesOf('frontend/src/docs/md-lite.ts', /^const CALLOUT_KIND: Record<string, string> = \{([\s\S]*?)^\};/m);

/**
 * Did the directive get transformed?
 *
 * Not "is there HTML" — rich-markdown down-converts callouts to a `> [!TIP]` blockquote for
 * `marked`, which is markdown and correct. The failure being caught is the source coming back
 * untouched, or the whole thing coming back empty.
 */
function transformed(name, out, src) {
  if (!out.trim()) return `produced nothing at all from ${JSON.stringify(src)}`;
  if (new RegExp(`:{1,3}${name}\\b`).test(out.replace(/<[^>]*>/g, ' '))) return `came back as literal text`;
  // An inline leaf whose paragraph survived and whose directive did not is the `:time` shape
  // exactly: the sentence renders, the thing inside it does not.
  if (FORM[name]?.startsWith('x :') && !/<[a-z]/i.test(out)) return `left its paragraph and nothing inside it`;
  return null;
}

describe('the Community-tab renderer draws everything it answers to', () => {
  test(`all ${RICH.length} directives produce output`, () => {
    const bad = [];
    for (const n of RICH) {
      const src = formOf(n);
      let out;
      try { out = expandDocBlocks(src); } catch (e) { bad.push(`:${n} threw — ${e?.message || e}`); continue; }
      const why = transformed(n, out, src);
      if (why) bad.push(`:${n} ${why}`);
    }
    assert.deepEqual(bad, [], `directives that do not render:\n  ${bad.join('\n  ')}`);
  });

  test('the list is real, so passing means something', () => {
    assert.ok(RICH.length >= 40, `only found ${RICH.length} directives — the extractor is stale`);
    for (const must of ['tabs', 'schedule', 'time', 'roadmap', 'note']) {
      assert.ok(RICH.includes(must), `expected "${must}" among them`);
    }
  });
});

describe('the documentation renderer draws everything it answers to', () => {
  test(`all ${LITE.length} directives produce output`, () => {
    const bad = [];
    for (const n of LITE) {
      const src = formOf(n);
      let out;
      try { out = render(src); } catch (e) { bad.push(`:${n} threw — ${e?.message || e}`); continue; }
      const why = transformed(n, out, src);
      if (why) bad.push(`:${n} ${why}`);
    }
    assert.deepEqual(bad, [], `directives that do not render:\n  ${bad.join('\n  ')}`);
  });

  test('it is a SUBSET of the other one, and deliberately so', () => {
    // Documentation needs the blocks that explain something; a landing page's cards and
    // buttons belong on a landing page. What must never happen is the subset drifting into
    // things the other renderer cannot draw — a doc page read in the Community tab would then
    // lose them.
    const extra = LITE.filter((n) => !RICH.includes(n));
    assert.deepEqual(extra, [], `the documentation renderer draws ${extra.join(', ')} and the Community tab does not`);
  });
});
