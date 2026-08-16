// The recursion cap on reusable blocks.
//
// A block that calls itself is the one failure mode this feature adds that nothing else in the
// scheduler has: every loop already carries maxIters, and a call graph cannot borrow it. Without
// a cap the runner recurses until the JS stack dies, which in a Tauri webview is the whole app,
// not one task.
//
// runSteps cannot be imported (scheduler.ts reaches Tauri, the DOM and localStorage at import),
// so the RULE is tested here directly, in the same form the runner applies it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const MAX_DEPTH = 20;

/** The guard as runSteps states it: refuse before recursing, never after. */
const tooDeep = (depth) => depth >= MAX_DEPTH;

describe('block recursion cap', () => {
    test('an ordinary nesting depth is allowed', () => {
        for (const d of [0, 1, 5, 19]) assert.equal(tooDeep(d), false, String(d));
    });

    test('the cap refuses at the boundary, not one past it', () => {
        // `>=`, not `>`. Off by one here means one more frame than intended, every time.
        assert.equal(tooDeep(MAX_DEPTH), true);
    });

    test('a self-calling block terminates instead of running forever', () => {
        // Simulates the runner: each call descends one level, and the guard is what stops it.
        let frames = 0;
        const run = (depth) => {
            if (tooDeep(depth)) throw new Error('too deep');
            frames++;
            run(depth + 1);          // the block calls itself
        };
        assert.throws(() => run(0), /too deep/);
        assert.equal(frames, MAX_DEPTH, 'stops after exactly the allowed number of frames');
    });

    test('depth is shared with the loop guards, so nesting inside loops counts', () => {
        // runSteps passes `depth + 1` for if/repeat/forEach/try as well, so a block called from
        // inside three loops starts deeper. That is deliberate: the cap is about total nesting,
        // which is what the stack actually cares about.
        assert.equal(tooDeep(MAX_DEPTH - 3), false);
        assert.equal(tooDeep(MAX_DEPTH + 3), true);
    });
});
