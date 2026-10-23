// Which tests exercise a change, against the COMPILED module.
//
// The failure that matters is the transitive one. A test importing docs-hub.ts exercises
// md-lite.ts too, because docs-hub imports it — and a tool that matched only a test's direct
// imports would report "no test covers this" for a file three tests actually run. That false
// "uncovered" is worse than no tool: it sends somebody to write a test that already exists.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { parseTestTargets, reachable, buildImpact } =
    await import(pathToFileURL(join(here, '../frontend/js/features/dev/test-impact.js')).href);

describe('parseTestTargets', () => {
    test('the compiled path a test loads maps back to its source id', () => {
        // These tests have no static import to read: they load the compiled module by path.
        const src = "await import(pathToFileURL(join(here, '../frontend/js/core/utils.js')).href);";
        assert.deepEqual(parseTestTargets(src), ['core/utils.ts']);
    });

    test('several targets, deduplicated', () => {
        const src = 'frontend/js/a.js and frontend/js/b.js and frontend/js/a.js';
        assert.deepEqual(parseTestTargets(src).sort(), ['a.ts', 'b.ts']);
    });

    test('a test that loads nothing compiled targets nothing', () => {
        assert.deepEqual(parseTestTargets("import assert from 'node:assert';"), []);
    });
});

describe('reachable', () => {
    const MODULES = [
        { id: 'a.ts', name: 'a.ts', dependencies: ['b.ts'] },
        { id: 'b.ts', name: 'b.ts', dependencies: ['c.ts'] },
        { id: 'c.ts', name: 'c.ts', dependencies: ['a.ts'] }, // a cycle
        { id: 'z.ts', name: 'z.ts', dependencies: [] },
        // d4 is queued TWICE before it is visited once — the only shape that exercises the
        // guard at the top of the walk. A plain cycle does not: the push-time check already
        // prevents that revisit. Neither does an ordinary diamond, because the stack is LIFO
        // and the grandchild is popped before its second parent is. It takes a parent that
        // queues both a sibling and the sibling's own dependency.
        { id: 'd1.ts', name: '', dependencies: ['d4.ts', 'd2.ts'] },
        { id: 'd2.ts', name: '', dependencies: ['d4.ts'] },
        { id: 'd4.ts', name: '', dependencies: [] },
    ];

    test('follows the graph, and includes the starting point', () => {
        assert.deepEqual([...reachable(MODULES, ['a.ts'])].sort(), ['a.ts', 'b.ts', 'c.ts']);
    });

    test('a cycle does not hang it', () => {
        assert.equal(reachable(MODULES, ['c.ts']).has('b.ts'), true);
    });

    test('a module queued twice before it is visited is still walked once', () => {
        assert.deepEqual([...reachable(MODULES, ['d1.ts'])].sort(), ['d1.ts', 'd2.ts', 'd4.ts']);
    });

    test('an unknown starting point reaches nothing rather than throwing', () => {
        assert.deepEqual([...reachable(MODULES, ['ghost.ts'])], []);
    });
});

describe('buildImpact', () => {
    const MODULES = [
        { id: 'ui/widget.ts', name: '', dependencies: ['core/fmt.ts'] },
        { id: 'core/fmt.ts', name: '', dependencies: ['core/utils.ts'] },
        { id: 'core/utils.ts', name: '', dependencies: [] },
        { id: 'ui/app.ts', name: '', dependencies: [] },
    ];
    const TESTS = [
        { path: 'tests/widget.test.mjs', src: "join(here, '../frontend/js/ui/widget.js')" },
        { path: 'tests/utils.test.mjs', src: "join(here, '../frontend/js/core/utils.js')" },
    ];

    test('a test covers what its target imports, not only the target', () => {
        // core/utils.ts is two hops below ui/widget.ts. A direct-import match would miss it.
        const imp = buildImpact(MODULES, TESTS, ['core/utils.ts']);
        assert.deepEqual(imp.run.map((r) => r.test).sort(), ['tests/utils.test.mjs', 'tests/widget.test.mjs']);
    });

    test('the test reaching most of the change comes first', () => {
        const imp = buildImpact(MODULES, TESTS, ['core/utils.ts', 'core/fmt.ts']);
        assert.equal(imp.run[0].test, 'tests/widget.test.mjs');
        assert.deepEqual(imp.run[0].covers.sort(), ['core/fmt.ts', 'core/utils.ts']);
    });

    test('a changed module no test reaches is the list worth reading', () => {
        const imp = buildImpact(MODULES, TESTS, ['ui/app.ts']);
        assert.deepEqual(imp.run, []);
        assert.deepEqual(imp.uncovered, ['ui/app.ts']);
    });

    test('a changed path outside the graph is neither covered nor uncovered', () => {
        // Rust, CSS and docs are most of what changes here. Counting them as "uncovered"
        // would bury the real gaps; counting them as covered would be a lie. They are
        // reported separately so a short run-list is not read as "your change is covered".
        const imp = buildImpact(MODULES, TESTS, ['src-tauri/src/main.rs', 'frontend/style.css']);
        assert.deepEqual(imp.uncovered, []);
        assert.deepEqual(imp.notModules, ['src-tauri/src/main.rs', 'frontend/style.css']);
    });

    test('a module both covered and changed is not also reported uncovered', () => {
        const imp = buildImpact(MODULES, TESTS, ['core/utils.ts', 'ui/app.ts']);
        assert.deepEqual(imp.uncovered, ['ui/app.ts']);
    });

    test('counts describe the change rather than judging it', () => {
        const imp = buildImpact(MODULES, TESTS, ['core/utils.ts', 'ui/app.ts', 'README.md']);
        assert.deepEqual(imp.counts, { changed: 3, tests: 2, run: 2, uncovered: 1 });
    });
});
