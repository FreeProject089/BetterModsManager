// `:::steps` and `:::roadmap` in the shared down-converter, against the COMPILED module.
//
// The point of this file existing at all: the SAME markdown has to render the same way on
// the BCWEB site and in BMM. These assertions pin the parts where the two could silently
// disagree — which marker a step gets, and what a phase state looks like.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// rich-markdown imports t() for a couple of labels, and core/i18n reads localStorage at
// module load — so importing it under node dies before a single test runs. The module
// under test never touches storage itself; only that transitive import does, at load
// time. A minimal stub is honest here, and smaller than splitting a module that is
// browser-only from end to end.
globalThis.localStorage ??= {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};

const { expandDocBlocks, stepMarker } = await import(
  pathToFileURL(join(ROOT, 'frontend/js/ui/rich-markdown.js')).href
);

const steps = (attrs = '') => `:::steps${attrs}
::::step[First]
Do the thing.
::::
::::step[Second]
Then the other.
::::
:::`;

describe('stepMarker', () => {
  test('the four alphabets match the website', () => {
    assert.deepEqual([1, 2, 3].map((n) => stepMarker('1', n)), ['1', '2', '3']);
    assert.deepEqual([1, 2, 3].map((n) => stepMarker('a', n)), ['A', 'B', 'C']);
    assert.deepEqual([1, 2, 3].map((n) => stepMarker('i', n)), ['i', 'ii', 'iii']);
    assert.equal(stepMarker('dot', 2), '•');
  });

  test('past the end of an alphabet it falls back to the number, never repeats', () => {
    // Wrapping to A would silently give two steps the same marker.
    assert.equal(stepMarker('a', 27), '27');
    assert.equal(stepMarker('i', 13), '13');
  });
});

describe(':::steps', () => {
  test('numbers its steps in order', () => {
    const html = expandDocBlocks(steps());
    const marks = [...html.matchAll(/data-marker="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(marks, ['1', '2']);
  });

  test('honours type and start', () => {
    const marks = [...expandDocBlocks(steps('{type=a start=3}')).matchAll(/data-marker="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(marks, ['C', 'D']);
  });

  test('a step keeps its own markdown, which is the whole point of the block', () => {
    // Nesting is why this is a container rather than a list: a step must be able to hold
    // a callout, a table, or another block.
    const html = expandDocBlocks(`:::steps
::::step[One]
:::::note
Careful.
:::::
::::
:::`);
    assert.match(html, /data-marker="1"/);
    assert.match(html, /NOTE|community-callout|blockquote/i, 'the nested callout was lost');
  });

  test('orientation switches the container class', () => {
    assert.match(expandDocBlocks(steps()), /community-steps-v/);
    assert.match(expandDocBlocks(steps('{orientation=horizontal}')), /community-steps-h/);
  });

  test('a step outside a steps block still renders, with a bullet', () => {
    // Half a component is worse than a plain paragraph.
    const html = expandDocBlocks(`::::step[Lonely]\nBody.\n::::`);
    assert.match(html, /community-step/);
    assert.match(html, /data-marker="•"/);
  });

  test('escapes a title rather than trusting it', () => {
    const html = expandDocBlocks(`:::steps\n::::step[<img src=x onerror=alert(1)>]\nx\n::::\n:::`);
    assert.ok(!html.includes('<img src=x'), 'raw tag survived in a step title');
    assert.match(html, /&lt;img/);
  });
});

describe(':::roadmap', () => {
  const road = `:::roadmap[Plan]
::::phase[Done bit]{state=done}
Shipped.
::::
::::phase[In flight]{state=doing}
Working.
::::
::::phase[Later]{state=todo}
Not yet.
::::
:::`;

  test('each state gets its own mark and class', () => {
    const html = expandDocBlocks(road);
    assert.match(html, /community-phase-done[\s\S]*?✓/);
    assert.match(html, /community-phase-doing[\s\S]*?→/);
    assert.match(html, /community-phase-todo[\s\S]*?○/);
  });

  test('an unknown state falls back to todo instead of an empty marker', () => {
    const html = expandDocBlocks(`:::roadmap\n::::phase[X]{state=banana}\ny\n::::\n:::`);
    assert.match(html, /community-phase-todo/);
    assert.match(html, /○/);
  });

  test('carries its title and orientation', () => {
    assert.match(expandDocBlocks(road), /community-roadmap-title[^>]*>Plan/);
    assert.match(expandDocBlocks(`:::roadmap{orientation=horizontal}\n:::`), /community-roadmap-h/);
  });
});

describe('a roadmap written the way the docs teach it', () => {
  // THE BUG THIS FILE MISSED. The authoring guide teaches `:::stage`; `:::phase` is the older
  // alias. `stage` fell into the STEP branch, so a roadmap copied from the website rendered in
  // the app as a numbered list — the stages became steps and every state vanished. The tests
  // above passed the whole time because they only ever wrote `phase`.
  const ROADMAP = [
    ':::roadmap[Where we are]',
    '::::stage[Shipped]{state=done}',
    '- The scanner',
    '::::',
    '::::stage[In progress]{state=doing percent=40}',
    '- The mapper',
    '::::',
    '::::stage[Next]{state=planned}',
    '- Sync',
    '::::',
    ':::',
  ].join('\n');

  test('a roadmap made of stages draws the tracker', () => {
    // This used to assert `community-roadmap` and a column of `community-phase` rows, which
    // is what the app drew and the website did not. The site builds the tracker's JSON from
    // the same stages, so the same post had two renderings and the app had the poorer one:
    // no category bars, no overall figure.
    const html = expandDocBlocks(ROADMAP);
    assert.match(html, /community-tracker/);
    assert.ok(!/community-step"/.test(html), 'a stage rendered as a step is the bug');
    assert.ok(!/community-phase/.test(html), 'the compact phase rows are the old rendering');
  });

  test('each state reaches the tracker', () => {
    const html = expandDocBlocks(ROADMAP);
    assert.match(html, /community-track-done/);
    assert.match(html, /community-track-progress/);
    assert.match(html, /community-track-planned/, 'the site writes `planned`');
  });

  test('a stage on its own is still a phase row', () => {
    // Outside a roadmap there is no tracker to build, and `:::stage` remains its own block.
    // Changing the roadmap must not take that with it.
    const html = expandDocBlocks(':::stage[Alone]{state=doing percent=25}\nBody.\n:::');
    assert.match(html, /community-phase-doing/);
    assert.match(html, /width:25%/);
  });

  test('the words people actually type are understood', () => {
    for (const w of ['shipped', 'complete']) {
      assert.match(expandDocBlocks(`:::roadmap\n::::stage[X]{state=${w}}\ny\n::::\n:::`), /community-phase-done/, w);
    }
    for (const w of ['active', 'wip', 'progress']) {
      assert.match(expandDocBlocks(`:::roadmap\n::::stage[X]{state=${w}}\ny\n::::\n:::`), /community-phase-doing/, w);
    }
  });

  test('a state nobody recognises is never "done"', () => {
    const html = expandDocBlocks(`:::roadmap\n::::stage[X]{state=banana}\ny\n::::\n:::`);
    assert.match(html, /community-phase-todo/);
    assert.ok(!/community-phase-done/.test(html), 'a typo must not report work as finished');
  });

  test('percent draws a bar, and a finished stage is full', () => {
    const html = expandDocBlocks(ROADMAP);
    assert.match(html, /width:40%/);
    assert.match(html, /width:100%/, 'done is 100 by definition — a finished stage with a half bar is a detail everybody notices');
  });

  test('no percent means no bar', () => {
    // An empty bar on every stage reads as "nothing has been done" rather than "no figure
    // was given".
    const html = expandDocBlocks(`:::roadmap\n::::stage[X]{state=doing}\ny\n::::\n:::`);
    assert.ok(!/community-phase-bar/.test(html));
  });

  test('`step` still means a step', () => {
    const html = expandDocBlocks(`:::steps\n::::step[Install]\ndo it\n::::\n:::`);
    assert.match(html, /community-step"/);
  });
});

describe('what the website writes, rendered the same way here', () => {
  // These three came off one real blog post that looked right on the site and wrong in the app.
  test('a roadmap carrying a ```json``` block draws the tracker', () => {
    // Without this branch the block fell through to "render the body plainly", so the reader
    // got `{"categories":[…]}` printed into the middle of the article.
    const html = expandDocBlocks([
      ':::roadmap[Roadmap]{orientation=vertical}',
      '```json',
      '{"categories":[{"name":"v1.0","items":[{"label":"Core","status":"done"},{"label":"Docs","status":"progress","percent":40},{"label":"Polish","status":"planned"}]}]}',
      '```',
      ':::',
    ].join('\n'));
    assert.match(html, /community-tracker/);
    assert.ok(!html.includes('"categories"'), 'the raw JSON must not reach the reader');
    assert.match(html, /<b>47%<\/b>/, 'the mean of 100, 40 and 0');
    assert.match(html, /1 done · 1 active · 1 planned/);
  });

  test('a finished item is full whatever its percent says', () => {
    const html = expandDocBlocks([
      ':::roadmap',
      '```json',
      '{"categories":[{"name":"x","items":[{"label":"a","status":"done","percent":10}]}]}',
      '```',
      ':::',
    ].join('\n'));
    assert.match(html, /width:100%/, 'a done line with a half bar is what everybody notices');
  });

  test('malformed JSON is left visible rather than drawn as an empty box', () => {
    // An empty tracker reads as "no work planned", which is a claim. Printing the block is
    // ugly and true.
    const html = expandDocBlocks(':::roadmap\n```json\n{not json\n```\n:::');
    assert.ok(!/community-tracker/.test(html));
  });

  test('a step colour reaches the marker', () => {
    const html = expandDocBlocks('::::steps{color="#7c3aed"}\n:::step[A]\nx\n:::\n::::');
    assert.match(html, /--stepc:#7c3aed/);
  });

  test('a roadmap written as :::stage children draws the tracker, not phase rows', () => {
    // The website accepts three sources for a roadmap and BMM knew two: a `json` block and a
    // `src=`. The third — `:::stage` children, which is the short way and the one the guide
    // teaches — fell through to "render the body plainly", so the app drew its own compact
    // phase rows: a thin bar, a tick, no category bars and no overall figure. Same post, two
    // renderings, and the app had the poorer one.
    const html = expandDocBlocks([
      ':::roadmap[Where we are]',
      ':::stage[Shipped]{state=done}',
      '- The block system',
      ':::',
      ':::stage[Under way]{state=doing percent=40}',
      '- The page builder',
      ':::',
      ':::',
    ].join('\n'));
    assert.match(html, /community-tracker/);
    // The exact summary the site prints for this input. Two categories, two items, and the
    // mean of 100 and 40 — if this number moves, the two renderers have drifted apart.
    assert.match(html, /<b>70%<\/b> overall · 1 done · 1 active · 0 planned/);
    assert.equal((html.match(/community-track-cathead/g) || []).length, 2);
    assert.ok(!/community-phase/.test(html), 'fell back to the compact phase rows');
  });

  test('a stage with no bullets is dropped rather than drawn empty', () => {
    // The site filters those out (`.filter(c => c.items.length)`). A category with no rows is
    // a heading with a 0% bar under it, which reads as "nothing done" rather than "nothing
    // said" — and those are different claims.
    const html = expandDocBlocks(':::roadmap\n:::stage[Empty]{state=done}\n:::\n:::');
    assert.ok(!/community-tracker/.test(html));
  });

  test('a step with a status still gets its number', () => {
    // The numbering rewrote markers by matching the exact opening tag, so adding a state class
    // silently dropped the number and left the bullet.
    const html = expandDocBlocks('::::steps{type=a}\n:::step[A]\nx\n:::\n:::step[B]{status=done}\ny\n:::\n::::');
    assert.match(html, /data-marker="A"/);
    assert.match(html, /data-marker="B"/);
    assert.match(html, /community-step-done/);
  });
});
