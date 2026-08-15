// Which tests exercise a change — and which changes no test touches at all.
//
// This codebase has 14 test files against 149 modules, and the honest reading of that is not
// "run everything, it only takes 200ms". It is: most of what you change is covered by
// nothing, and there is no way to know which part without tracing it by hand.
//
// So the useful output here is the SECOND list. "These 3 tests cover your change" is a
// convenience; "these 4 changed files are covered by no test" is the thing you did not know.
//
// Coverage is computed through the dependency graph, not from the test's own imports. A test
// that imports docs-hub.ts exercises md-lite.ts too, because docs-hub imports it — and a
// tool that only matched direct imports would report "no test covers this" for a file three
// tests actually run.
//
// It cannot see coverage that is not structural: a test importing module A does not
// necessarily EXERCISE everything A imports. So this over-reports coverage and under-reports
// gaps, and the gaps it does report are real. Stated rather than hidden, because a tool that
// claims to know what is tested is worse than one that says which direction it errs in.
import type { GraphMod } from '../mods/mod-graph.js';

/**
 * The modules a test file loads, as source ids.
 *
 * These tests import the COMPILED module by path — `import(pathToFileURL(join(here,
 * '../frontend/js/core/utils.js')).href)` — so there is no static import to read. The path
 * string is the edge, and `frontend/js/x.js` maps to the `x.ts` the graph is keyed by.
 */
export function parseTestTargets(src: string): string[] {
    const out = new Set<string>();
    for (const m of String(src).matchAll(/frontend\/js\/([A-Za-z0-9_/.-]+)\.js/g)) out.add(`${m[1]}.ts`);
    return [...out];
}

/** Everything reachable from a set of modules, including the modules themselves. */
export function reachable(modules: GraphMod[], from: string[]): Set<string> {
    const byId = new Map(modules.map((m) => [m.id, m]));
    const seen = new Set<string>();
    const stack = from.filter((f) => byId.has(f));
    while (stack.length) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        for (const d of byId.get(id)?.dependencies ?? []) if (!seen.has(d)) stack.push(d);
    }
    return seen;
}

export interface Impact {
    /** Tests to run, and which changed file each one reaches. */
    run: { test: string; covers: string[] }[];
    /** Changed modules no test reaches. The list worth reading. */
    uncovered: string[];
    /** Changed paths that are not modules at all (CSS, HTML, Rust, docs) — reported so a
     *  short "run" list is not mistaken for "your change is covered". */
    notModules: string[];
    counts: { changed: number; tests: number; run: number; uncovered: number };
}

export function buildImpact(
    modules: GraphMod[],
    tests: { path: string; src: string }[],
    changed: string[],
): Impact {
    const known = new Set(modules.map((m) => m.id));
    const changedModules = changed.filter((c) => known.has(c));
    const notModules = changed.filter((c) => !known.has(c));

    const run: { test: string; covers: string[] }[] = [];
    const covered = new Set<string>();
    for (const t of tests) {
        const reach = reachable(modules, parseTestTargets(t.src));
        const covers = changedModules.filter((c) => reach.has(c));
        if (covers.length) {
            run.push({ test: t.path, covers });
            for (const c of covers) covered.add(c);
        }
    }
    // Most-relevant first: a test reaching four of your changed files is the one to run.
    run.sort((a, b) => b.covers.length - a.covers.length);

    const uncovered = changedModules.filter((c) => !covered.has(c)).sort();
    return {
        run,
        uncovered,
        notModules,
        counts: { changed: changed.length, tests: tests.length, run: run.length, uncovered: uncovered.length },
    };
}
