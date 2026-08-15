// The module dependency graph of the frontend, from the import statements.
//
// This answers questions that `tsc` does not, because a compiler is happy with any graph
// that resolves:
//
//   · which module is the hub — the one 40 files import, so a change to it is never small.
//   · which modules are ORPHANS — never imported by anything reachable from an entry point.
//     tsc compiles them, the bundle carries them, nothing runs them. `docs-ui.ts` sat in
//     this state for a while and only a person remembering it was dead found out.
//   · which imports form a CYCLE. ES modules tolerate cycles until one of them reads a
//     binding at module-evaluation time, and then it is `undefined` at runtime with a
//     stack that points at the wrong file.
//
// Pure functions of text, like sched-vars.ts and http-action.ts: no filesystem, no Tauri.
// The caller supplies { path, src } pairs, so this is testable directly and the script and
// any future screen share one implementation rather than two that drift.
//
// The tree comes from mod-graph.ts rather than a second renderer. The shape a person wants
// — what does importing this actually pull in, drawn once per branch with cycles marked —
// is the same question for mods and for modules, and it is already tested there.
import type { GraphMod } from '../mods/mod-graph.js';

/**
 * Comments and string bodies removed, in ONE pass that tracks what it is inside.
 *
 * Two regexes cannot do this, and the way they fail is silent. Stripping block comments
 * first treats the `/*` in a line comment like `// no Lang/*.json churn` as opening a
 * block — which then runs to the next real `*` + `/` anywhere below and eats the four
 * import statements in between. docs-hub.ts has exactly that line, and the graph reported
 * md-lite.ts as dead code while md-lite.ts was imported on the line right there.
 *
 * Strings are blanked rather than removed so nothing shifts: a `//` inside 'https://…' is
 * not a comment, and a `/*` inside a string is not a block.
 */
export function stripComments(src: string): string {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        const d = src[i + 1];
        if (c === '/' && d === '/') {
            while (i < n && src[i] !== '\n') i++;
            continue;
        }
        if (c === '/' && d === '*') {
            i += 2;
            while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            // The quotes are KEPT and the body blanked: the import regexes match on the
            // quotes, and a specifier is the one string that must survive. So the body is
            // only blanked for template literals, where an embedded ${…} could otherwise
            // hide a quote and desynchronise everything after it.
            const quote = c;
            let body = '';
            i++;
            while (i < n && src[i] !== quote) {
                if (src[i] === '\\') { body += ' '; i += 2; continue; }
                body += quote === '`' ? ' ' : src[i];
                i++;
            }
            out += quote + body + quote;
            i++;
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

/**
 * Every specifier a module imports, deduplicated.
 *
 * NOT in source order — the forms are matched one pass each, so the result is grouped by
 * form. Nothing downstream depends on the order (a graph has no first edge), and saying so
 * is cheaper than a scan that preserves it.
 *
 * Comments are stripped first. A commented-out import is not an import, and counting one
 * resurrects a dependency somebody deliberately removed — the graph then says a module is
 * still reachable when nothing reaches it.
 *
 * Covers the four forms this codebase uses: `import x from`, bare `import 'x'`,
 * `export … from`, and dynamic `import('x')`. `require()` is not one of them and is not
 * matched, so a stray require shows up as a module with no dependencies rather than as a
 * confident wrong edge.
 */
export function parseImports(src: string): string[] {
    const text = stripComments(String(src));
    const out: string[] = [];
    const push = (s: string | undefined) => { if (s) out.push(s); };
    for (const m of text.matchAll(/\bimport\s+[^'"();]*?\bfrom\s*['"]([^'"]+)['"]/g)) push(m[1]);
    for (const m of text.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) push(m[1]);
    for (const m of text.matchAll(/\bexport\s+[^'"();]*?\bfrom\s*['"]([^'"]+)['"]/g)) push(m[1]);
    for (const m of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) push(m[1]);
    return [...new Set(out)];
}

/** A path with `.` and `..` collapsed. Used instead of node:path so this stays free of any
 *  platform module and can run in the app as well as in a script. */
export function normalizePath(p: string): string {
    const parts: string[] = [];
    for (const seg of p.split('/')) {
        if (!seg || seg === '.') continue;
        if (seg === '..') { parts.pop(); continue; }
        parts.push(seg);
    }
    return parts.join('/');
}

/**
 * Resolve one specifier to a module id, or null if it is external.
 *
 * The source imports `./foo.js` and the file on disk is `./foo.ts` — TypeScript's own
 * convention for emitting ES modules. Resolving the literal string would make every single
 * edge in this codebase point at a file that does not exist, and the graph would come out
 * completely empty while looking like it worked.
 */
export function resolveSpecifier(fromPath: string, spec: string, known: Set<string>): string | null {
    if (!spec.startsWith('.')) return null; // a package, not one of ours
    const dir = fromPath.split('/').slice(0, -1).join('/');
    const base = normalizePath(`${dir}/${spec}`);
    const candidates = [
        base.replace(/\.js$/, '.ts'),
        base,
        `${base}.ts`,
        `${base}/index.ts`,
    ];
    for (const c of candidates) if (known.has(c)) return c;
    return null;
}

/**
 * The graph, shaped as GraphMod so mod-graph's tree renderer takes it unchanged.
 *
 * An unresolved relative import is DROPPED rather than kept as a missing node. Unlike a
 * mod library — where "needs something not installed" is the most useful line in the tree —
 * an import that does not resolve here means this analyser failed, not that the code is
 * broken: tsc would have refused it. Reporting them separately keeps the two apart.
 */
export function buildModuleGraph(files: { path: string; src: string }[]): {
    modules: GraphMod[];
    unresolved: { from: string; spec: string }[];
} {
    const known = new Set(files.map((f) => f.path));
    const modules: GraphMod[] = [];
    const unresolved: { from: string; spec: string }[] = [];
    for (const f of files) {
        const deps: string[] = [];
        for (const spec of parseImports(f.src)) {
            const id = resolveSpecifier(f.path, spec, known);
            if (id) deps.push(id);
            else if (spec.startsWith('.')) unresolved.push({ from: f.path, spec });
        }
        modules.push({ id: f.path, name: f.path, dependencies: [...new Set(deps)] });
    }
    return { modules, unresolved };
}

/** How many modules import each one. The hub is the answer to "why is this change big". */
export function importCounts(modules: GraphMod[]): { id: string; importedBy: number }[] {
    const n = new Map<string, number>();
    for (const m of modules) for (const d of m.dependencies ?? []) n.set(d, (n.get(d) ?? 0) + 1);
    return modules
        .map((m) => ({ id: m.id, importedBy: n.get(m.id) ?? 0 }))
        .sort((a, b) => b.importedBy - a.importedBy);
}

/**
 * Modules nothing reachable from `entries` imports.
 *
 * Computed by reachability, not by "importedBy === 0". Two dead modules that import each
 * other both have a non-zero count and are both still dead — and a pair like that is
 * exactly what survives a deletion somebody did halfway.
 */
export function orphans(modules: GraphMod[], entries: string[]): string[] {
    const byId = new Map(modules.map((m) => [m.id, m]));
    const seen = new Set<string>();
    const stack = entries.filter((e) => byId.has(e));
    while (stack.length) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        for (const d of byId.get(id)?.dependencies ?? []) if (!seen.has(d)) stack.push(d);
    }
    return modules.filter((m) => !seen.has(m.id)).map((m) => m.id).sort();
}

/**
 * Every import cycle, each reported once.
 *
 * A cycle is legal in ES modules and usually harmless — until one module reads a binding
 * from another at evaluation time, when it is `undefined` with a stack pointing at the
 * wrong file. Worth seeing; not worth calling an error.
 *
 * The same cycle is reachable from every member and in every rotation, so it is keyed by
 * its sorted membership. Without that, a three-module cycle is reported three times and a
 * clean graph and a messy one are hard to tell apart.
 */
export function findCycles(modules: GraphMod[]): string[][] {
    const byId = new Map(modules.map((m) => [m.id, m]));
    const found = new Map<string, string[]>();
    const state = new Map<string, number>(); // 1 = on the stack, 2 = finished
    const path: string[] = [];

    const walk = (id: string) => {
        const s = state.get(id);
        if (s === 1) {
            const at = path.indexOf(id);
            if (at >= 0) {
                const cyc = path.slice(at);
                found.set([...cyc].sort().join(' '), cyc);
            }
            return;
        }
        if (s === 2) return;
        state.set(id, 1);
        path.push(id);
        for (const d of byId.get(id)?.dependencies ?? []) walk(d);
        path.pop();
        state.set(id, 2);
    };
    for (const m of modules) walk(m.id);
    return [...found.values()];
}
