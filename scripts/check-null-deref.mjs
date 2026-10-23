#!/usr/bin/env node
// A constant set to `null`, and then asked for a property.
//
// The bug this exists for: `frontend/src/features/repo/repo.ts` declared
//
//     const modpacksShareConfig = null;
//
// with a comment explaining exactly why it should be null — and twenty lines later still read
//
//     modpacksShareConfig.length > 0 ? modpacksShareConfig : null
//
// which throws. The repo export button therefore did nothing at all: it raised a TypeError
// before it ever reached Rust, on the one path a person actually uses to publish a repository.
//
// Nothing could have caught it. The file starts with `@ts-nocheck`, so tsc never looked; the
// two OTHER callers of the same command pass `null` straight through and work perfectly, so
// there was no comparison to fail; and a null dereference is not a spelling mistake, so
// `check-undefined-names.mjs` has nothing to say about it either.
//
// So: the narrowest check that would have caught it, and nothing wider.
//
// CONST only, and that restriction is the whole design. A `const x = null` can never hold
// anything else, so `x.` on it throws unconditionally — no dataflow analysis, no guards, no
// doubt. The first draft of this file also accepted `let`, and reported twenty-five
// module-level state variables (`let _panel = null`, assigned in one function and read in
// another behind an `if`) — every one of them correct code. A check that is right once in
// twenty-six is a check people learn to skim, which is worse than not having one.
//
// Reported EVERYWHERE, and reported louder inside a `@ts-nocheck` file, because those are the
// files where this is the only thing looking.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = 'frontend/src';

/** Every .ts under the tree, so a new folder is covered without editing this file. */
function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) walk(p, out);
        else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p);
    }
    return out;
}

const files = walk(ROOT);
if (files.length < 50) {
    console.error(`✗ only ${files.length} source files found — the walk is broken, refusing to report success`);
    process.exit(2);
}

// `const x = null;` — a BARE null, nothing else on the right. `= null as Foo` and
// `= cond ? null : y` are different statements about a different thing.
const DECL = /(?:^|\n)[ \t]*const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*null\s*;/g;

const findings = [];
for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const nocheck = /^\s*\/\/\s*@ts-nocheck/m.test(src.slice(0, 200));
    for (const m of src.matchAll(DECL)) {
        const name = m[1];
        const from = m.index + m[0].length;
        // Only AFTER the declaration, and only within the same file. A const is never
        // reassigned, so the whole of the rest is in scope for this question.
        const window = src.slice(from);
        // `name.` — a property access. Not `name?.`, which is the correct way to touch a
        // value that may be null and is what somebody writes when they have thought about it.
        const deref = new RegExp(`(?:^|[^.\\w$?])${name}\\.(?!\\.)`).exec(window);
        if (!deref) continue;
        const line = src.slice(0, from + deref.index).split('\n').length;
        findings.push({ file: relative('.', file), name, line, nocheck });
    }
}

if (findings.length) {
    console.error('✗ a constant is null and is then asked for a property — this throws:\n');
    for (const f of findings) {
        console.error(`    ${f.file}:${f.line}  ${f.name} = null, then ${f.name}.…`
            + (f.nocheck ? '   (@ts-nocheck — tsc will NOT catch it)' : ''));
    }
    console.error('\n  Pass the value through, or use ?. if it is genuinely sometimes null.');
    process.exit(1);
}

console.log(`✓ no null constant is dereferenced — ${files.length} file(s) read`);
