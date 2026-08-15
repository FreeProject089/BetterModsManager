// Reading a variable as a TYPED value — the seam the scheduler's enum/match/maps work needs.
//
// The test that matters most is the last one. `readVar` answers for lists and `substituteVars`
// does not, on purpose, and that difference is a decision rather than an oversight: a saved
// task where {x} names a list leaves the braces alone today, and turning that into
// ["a","b"] inside a path or a command line would be invisible in review and destructive at
// run time. If somebody later "tidies" substituteVars to call readVar, that test goes red.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { readVar, renderVar, readNum, substituteVars } = await import(
    pathToFileURL(join(here, '../frontend/js/features/settings/sched-vars.js')).href
);

const ctx = (over = {}) => ({ nums: {}, text: {}, ...over });

describe('readVar', () => {
    test('each bag reports its own type', () => {
        assert.deepEqual(readVar(ctx({ text: { a: 'hi' } }), 'a'), { t: 'text', v: 'hi' });
        assert.deepEqual(readVar(ctx({ nums: { a: 3 } }), 'a'), { t: 'num', v: 3 });
        assert.deepEqual(readVar(ctx({ lists: { a: ['x'] } }), 'a'), { t: 'list', v: ['x'] });
    });

    test('a shared value reads as text', () => {
        assert.deepEqual(readVar(ctx({ shared: { a: 'kept' } }), 'a'), { t: 'text', v: 'kept' });
    });

    test('this run wins over a stored value with the same name', () => {
        // The failure this prevents: a task that captures `path` starts reading some other
        // task's `path` from last Tuesday, and it presents as the script misbehaving.
        const c = ctx({ text: { path: '/now' }, shared: { path: '/last-tuesday' } });
        assert.deepEqual(readVar(c, 'path'), { t: 'text', v: '/now' });
    });

    test('text wins over the number, matching what substitution has always done', () => {
        const c = ctx({ text: { a: 'seven' }, nums: { a: 7 } });
        assert.deepEqual(readVar(c, 'a'), { t: 'text', v: 'seven' });
    });

    test('a list wins over a text of the same name', () => {
        // Both bags can hold `x` at once; the list is the answer carrying more information.
        const c = ctx({ text: { x: 'a,b' }, lists: { x: ['a', 'b'] } });
        assert.deepEqual(readVar(c, 'x'), { t: 'list', v: ['a', 'b'] });
    });

    test('an unknown name is undefined, never a default', () => {
        // A caller that silently gets "" or 0 cannot tell empty from missing, and that
        // difference is the whole reason to ask.
        assert.equal(readVar(ctx(), 'nope'), undefined);
    });

    test('an empty string and a zero are values, not absences', () => {
        assert.deepEqual(readVar(ctx({ text: { a: '' } }), 'a'), { t: 'text', v: '' });
        assert.deepEqual(readVar(ctx({ nums: { a: 0 } }), 'a'), { t: 'num', v: 0 });
    });

    test('an inherited property is not a variable', () => {
        // hasOwnProperty, not `in` — otherwise every task has a variable called toString.
        assert.equal(readVar(ctx(), 'toString'), undefined);
        assert.equal(readVar(ctx(), 'constructor'), undefined);
    });
});

describe('renderVar', () => {
    test('a list renders as JSON so it round-trips through parseList', () => {
        // Comma-joining loses any item that itself contained a comma.
        assert.equal(renderVar({ t: 'list', v: ['a', 'b,c'] }), '["a","b,c"]');
    });

    test('a number renders without quotes, text as itself', () => {
        assert.equal(renderVar({ t: 'num', v: 3 }), '3');
        assert.equal(renderVar({ t: 'text', v: 'hi' }), 'hi');
    });
});

describe('substituteVars keeps its own rule', () => {
    test('{x} naming a list is left alone, exactly as before readVar existed', () => {
        // If this goes red because substituteVars was "tidied" to call readVar, that is the
        // behaviour change this test exists to catch — not a stale expectation to update.
        const c = ctx({ lists: { x: ['a', 'b'] } });
        assert.deepEqual(substituteVars({ p: 'run {x} now' }, c), { p: 'run {x} now' });
    });

    test('text, number and shared still substitute in that order', () => {
        const c = ctx({ text: { a: 'A' }, nums: { b: 2 }, shared: { c: 'C' } });
        assert.deepEqual(substituteVars({ p: '{a}/{b}/{c}' }, c), { p: 'A/2/C' });
    });

    test('an unknown name keeps its braces', () => {
        // Blanking it is how a task deletes the wrong folder.
        assert.deepEqual(substituteVars({ p: 'rm -rf {nope}' }, ctx()), { p: 'rm -rf {nope}' });
    });
});

describe('readNum — the shared-variable defect', () => {
    test('a shared variable resolves as a number', () => {
        // THE BUG. `var.set` scope:shared writes only ctx.shared; a run starts with nums:{}
        // and nothing copies between them. So `count + 1` on a shared counter read 0 and
        // evaluated to 1 on every run, forever, while {count} substituted correctly into a
        // string two lines above. Nothing errored.
        assert.equal(readNum(ctx({ shared: { count: '7' } }), 'count'), 7);
    });

    test('nums wins over text, so nothing that resolves today changes', () => {
        // A step may have written a number that is not parseFloat(text) — a version's part
        // count, a metric with a formatted label. Consulting text first would silently
        // change what those evaluate to.
        assert.equal(readNum(ctx({ nums: { v: 3 }, text: { v: '1.5.0' } }), 'v'), 3);
    });

    test('numeric text parses; non-numeric text falls back to its length', () => {
        // Length is odd, but it is what var.set has always stored for run-scope values, and
        // two rules for "the number of this text" would be worse than one odd rule.
        assert.equal(readNum(ctx({ text: { a: '4.5' } }), 'a'), 4.5);
        assert.equal(readNum(ctx({ text: { a: 'abc' } }), 'a'), 3);
    });

    test('a list resolves to its length', () => {
        assert.equal(readNum(ctx({ lists: { xs: ['a', 'b', 'c'] } }), 'xs'), 3);
    });

    test('an unknown name is undefined so each caller keeps its own default', () => {
        // evalExpr wants 0 and a comparison wants NaN. Collapsing that here would make an
        // absent variable compare equal to zero.
        assert.equal(readNum(ctx(), 'nope'), undefined);
    });

    test('zero survives as zero, not as missing', () => {
        assert.equal(readNum(ctx({ nums: { z: 0 } }), 'z'), 0);
    });
});
