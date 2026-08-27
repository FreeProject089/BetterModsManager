// The three decisions the debugger's new half makes, against the COMPILED module.
//
// A trail that records every step would be a wall of the same value; a breakpoint box that
// treats a blank entry as a needle would stop at every step; a failure line that says
// "unknown error" loses the only description there was. All three are cheap to get wrong
// and invisible until somebody is already staring at a broken task.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.localStorage = globalThis.localStorage || {
    getItem: () => null, setItem: () => {}, removeItem: () => {},
};

const here = dirname(fileURLToPath(import.meta.url));
const { recordHistory, breakpointList, hitsBreakpoint, failLine, debugReport } = await import(
    pathToFileURL(join(here, '../frontend/js/features/settings/sched-debug.js')).href
);

const row = (k, v) => [k, 'text', v];

describe('the trail behind a variable', () => {
  test('only a CHANGE is recorded, so the trail is the answer and not the transcript', () => {
    const h = new Map();
    recordHistory(h, 1, [row('path', 'C:/a')]);
    recordHistory(h, 2, [row('path', 'C:/a')]);
    recordHistory(h, 3, [row('path', 'C:/a')]);
    recordHistory(h, 4, [row('path', '')]);
    // Four steps, two entries: it was C:/a, then at step 4 it was emptied. That second
    // number is the entire reason somebody opened this.
    assert.deepEqual(h.get('path'), [
      { step: 1, value: 'C:/a' },
      { step: 4, value: '' },
    ]);
  });

  test('a variable that appears halfway through starts at the step it appeared', () => {
    const h = new Map();
    recordHistory(h, 1, [row('a', '1')]);
    recordHistory(h, 7, [row('a', '1'), row('b', 'hello')]);
    assert.deepEqual(h.get('b'), [{ step: 7, value: 'hello' }]);
  });

  test('the cap drops the OLDEST, because a loop\u2019s last turn is the one that broke', () => {
    const h = new Map();
    for (let i = 1; i <= 10; i++) recordHistory(h, i, [row('n', String(i))]);
    const trail = h.get('n');
    // Capped at 4: the four most recent survive.
    const h2 = new Map();
    for (let i = 1; i <= 10; i++) recordHistory(h2, i, [row('n', String(i))], 4);
    assert.equal(trail.length, 10);
    assert.deepEqual(h2.get('n').map((x) => x.step), [7, 8, 9, 10]);
  });
});

describe('several breakpoints in one box', () => {
  test('a comma separates needles', () => {
    assert.deepEqual(breakpointList('download, upload'), ['download', 'upload']);
    assert(hitsBreakpoint('Download the file', 'download, upload'));
    assert(hitsBreakpoint('Upload it back', 'download, upload'));
    assert(!hitsBreakpoint('Wait 5 seconds', 'download, upload'));
  });

  test('blanks between commas are dropped, or the box would stop at everything', () => {
    // `download,,upload` with a naive split gives an empty needle, and every label
    // contains the empty string.
    assert.deepEqual(breakpointList('download,,upload'), ['download', 'upload']);
    assert(!hitsBreakpoint('Wait 5 seconds', 'download,,upload'));
    // And a box holding only separators is still "run to the end".
    assert(!hitsBreakpoint('anything', ' , , '));
    assert(!hitsBreakpoint('anything', ''));
  });

  test('matching is case-insensitive both ways', () => {
    assert(hitsBreakpoint('DOWNLOAD the file', 'download'));
    assert(hitsBreakpoint('download the file', 'DOWNLOAD'));
  });
});

describe('what a failure says', () => {
  test('an Error contributes its message, not "Error: " in front of it', () => {
    assert.equal(failLine(new Error('file not found')), 'file not found');
  });

  test('something thrown that is not an Error is printed as it is', () => {
    // A task can throw a string. "unknown error" would discard the only description.
    assert.equal(failLine('nope'), 'nope');
    assert.equal(failLine(404), '404');
  });

  test('an Error with no message falls back to its name rather than to nothing', () => {
    const e = new Error('');
    e.name = 'TimeoutError';
    assert.equal(failLine(e), 'TimeoutError');
  });

  test('newlines are folded, because this goes on one line', () => {
    assert.equal(failLine(new Error('line one\n\n  line two')), 'line one line two');
  });
});

describe('the pasted report', () => {
  test('a failure is stated at the top, above two hundred steps of log', () => {
    const log = [{ label: 'Step A', done: true }, { label: 'Step B', done: false }];
    const txt = debugReport('My task', log, [['path', 'text', 'C:/a']], 'file not found');
    const firstTwo = txt.split('\n').slice(0, 2);
    assert.equal(firstTwo[0], 'BMM debug \u2014 My task');
    assert.equal(firstTwo[1], 'FAILED: file not found');
  });

  test('a run that did not fail says nothing about failing', () => {
    const txt = debugReport('My task', [], []);
    assert(!txt.includes('FAILED'));
    // And the parts that were always there still are.
    assert(txt.includes('(nothing ran)'));
    assert(txt.includes('(no variables)'));
  });
});
