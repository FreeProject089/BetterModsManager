// The module dependency graph, against the COMPILED module.
//
// The test that carries the weight is the `.js` → `.ts` one. The source imports './foo.js'
// and the file on disk is './foo.ts' — TypeScript's own convention for emitting ES modules.
// Resolving the literal specifier makes EVERY edge in this codebase point at a file that
// does not exist, and the graph comes out empty while looking like it worked.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(join(here, '../frontend/js/features/dev/dep-graph.js')).href);
const { stripComments, parseImports, normalizePath, resolveSpecifier, buildModuleGraph, importCounts, orphans, findCycles } = mod;

describe('stripComments', () => {
    test('a /* inside a LINE comment does not open a block', () => {
        // The bug this exists for. Stripping block comments with a regex first turns
        // `// … Lang/*.json churn` into an open block that runs to the next */ anywhere
        // below — in docs-hub.ts that swallowed four import statements, and the graph
        // called md-lite.ts dead while it was imported three lines further down.
        const src = [
            '// no Lang/*.json churn',
            "import { a } from './a.js';",
            "import { b } from './b.js';",
            '/* a real block */',
            "import { c } from './c.js';",
        ].join('\n');
        assert.deepEqual(parseImports(src).sort(), ['./a.js', './b.js', './c.js']);
    });

    test('a // inside a string is not a comment', () => {
        const src = "const u = 'https://x.dev'; import { a } from './a.js';";
        assert.deepEqual(parseImports(src), ['./a.js']);
    });

    test('a quote inside a template literal cannot desynchronise the scan', () => {
        const src = "const s = `it's here`;\nimport { a } from './a.js';";
        assert.deepEqual(parseImports(src), ['./a.js']);
    });

    test('an escaped quote does not end the string', () => {
        const src = "const s = 'it\\'s here';\nimport { a } from './a.js';";
        assert.deepEqual(parseImports(src), ['./a.js']);
    });

    test('the specifier survives stripping — it is the one string that must', () => {
        assert.match(stripComments("import x from './keep.js';"), /'\.\/keep\.js'/);
    });
});

describe('parseImports', () => {
    test('the four forms this codebase uses', () => {
        const src = [
            "import { a } from './a.js';",
            "import './side-effect.js';",
            "export { b } from './b.js';",
            "const c = await import('./c.js');",
            "import type { T } from './t.js';",
        ].join('\n');
        // Sorted: the result is grouped by form, not in source order, and a graph has no
        // first edge. Asserting an order would be asserting an implementation detail.
        assert.deepEqual(parseImports(src).sort(), ['./a.js', './b.js', './c.js', './side-effect.js', './t.js']);
    });

    test('a commented-out import is not an import', () => {
        // Counting one resurrects a dependency somebody deliberately removed, and the graph
        // then says a module is reachable when nothing reaches it.
        assert.deepEqual(parseImports("// import { x } from './dead.js';"), []);
        assert.deepEqual(parseImports("/* import { x } from './dead.js'; */"), []);
    });

    test('a URL in a string is not a line comment', () => {
        // The naive /\/\/.*/ strips from the // of https:// to end of line, taking the real
        // import on that line with it.
        const src = "const u = 'https://example.com'; import { a } from './a.js';";
        assert.deepEqual(parseImports(src), ['./a.js']);
    });

    test('the same specifier twice is one dependency', () => {
        assert.deepEqual(parseImports("import {a} from './x.js';\nimport {b} from './x.js';"), ['./x.js']);
    });
});

describe('normalizePath', () => {
    test('.. and . collapse', () => {
        assert.equal(normalizePath('a/b/../c/./d'), 'a/c/d');
        assert.equal(normalizePath('a//b'), 'a/b');
    });
});

describe('resolveSpecifier', () => {
    const known = new Set(['f/features/mods/mods.ts', 'f/core/util.ts', 'f/core/index.ts']);

    test('a .js specifier resolves to the .ts file that emits it', () => {
        assert.equal(resolveSpecifier('f/features/mods/mods.ts', '../../core/util.js', known), 'f/core/util.ts');
    });

    test('an extensionless specifier, and a directory index', () => {
        assert.equal(resolveSpecifier('f/features/mods/mods.ts', '../../core/util', known), 'f/core/util.ts');
        assert.equal(resolveSpecifier('f/features/mods/mods.ts', '../../core', known), 'f/core/index.ts');
    });

    test('a package is not one of ours', () => {
        assert.equal(resolveSpecifier('f/a.ts', '@tauri-apps/api/core', known), null);
        assert.equal(resolveSpecifier('f/a.ts', 'lodash', known), null);
    });

    test('a relative import of a file that is not there resolves to nothing', () => {
        assert.equal(resolveSpecifier('f/a.ts', './ghost.js', known), null);
    });
});

describe('buildModuleGraph', () => {
    const FILES = [
        { path: 'src/main.ts', src: "import './a.js';\nimport './b.js';" },
        { path: 'src/a.ts', src: "import './shared.js';" },
        { path: 'src/b.ts', src: "import './shared.js';\nimport 'lodash';" },
        { path: 'src/shared.ts', src: '' },
        { path: 'src/dead.ts', src: "import './dead2.js';" },
        { path: 'src/dead2.ts', src: "import './dead.js';" },
    ];

    test('edges resolve, and a package is not an edge', () => {
        const { modules } = buildModuleGraph(FILES);
        const by = Object.fromEntries(modules.map((m) => [m.id, m.dependencies]));
        assert.deepEqual(by['src/main.ts'], ['src/a.ts', 'src/b.ts']);
        assert.deepEqual(by['src/b.ts'], ['src/shared.ts']);
    });

    test('an unresolved RELATIVE import is reported, not turned into a node', () => {
        // Unlike a mod library, a missing node here means this analyser failed rather than
        // that the code is broken — tsc would have refused it. Keeping the two apart is the
        // difference between a tool you trust and one you argue with.
        const { modules, unresolved } = buildModuleGraph([{ path: 'src/x.ts', src: "import './ghost.js';" }]);
        assert.deepEqual(modules[0].dependencies, []);
        assert.deepEqual(unresolved, [{ from: 'src/x.ts', spec: './ghost.js' }]);
    });

    test('the diamond: shared is imported by two, and counted twice', () => {
        const counts = Object.fromEntries(importCounts(buildModuleGraph(FILES).modules).map((c) => [c.id, c.importedBy]));
        assert.equal(counts['src/shared.ts'], 2);
        assert.equal(counts['src/main.ts'], 0);
    });

    test('orphans are found by reachability, not by import count', () => {
        // dead.ts and dead2.ts import EACH OTHER, so both have importedBy === 1 and both are
        // dead. A count-based check reports neither — and a mutual pair like that is exactly
        // what survives a deletion somebody did halfway.
        assert.deepEqual(orphans(buildModuleGraph(FILES).modules, ['src/main.ts']), ['src/dead.ts', 'src/dead2.ts']);
    });

    test('a diamond is not a cycle', () => {
        assert.deepEqual(findCycles(buildModuleGraph(FILES.slice(0, 4)).modules), []);
    });

    test('a cycle is found once, not once per member', () => {
        const cyc = findCycles(buildModuleGraph([
            { path: 'a.ts', src: "import './b.js';" },
            { path: 'b.ts', src: "import './c.js';" },
            { path: 'c.ts', src: "import './a.js';" },
        ]).modules);
        assert.equal(cyc.length, 1);
        assert.deepEqual([...cyc[0]].sort(), ['a.ts', 'b.ts', 'c.ts']);
    });

    test('a module importing itself is a cycle of one', () => {
        const cyc = findCycles(buildModuleGraph([{ path: 'a.ts', src: "import './a.js';" }]).modules);
        assert.deepEqual(cyc, [['a.ts']]);
    });
});
