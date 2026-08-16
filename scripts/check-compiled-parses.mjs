#!/usr/bin/env node
// Does every compiled module actually parse?
//
// `settings.ts` — 4000 lines, the biggest file in the front end — begins with `// @ts-nocheck`.
// So `tsc` emits it without reading it, and a duplicate `const all` in one function body went
// out as `Uncaught SyntaxError: Identifier 'all' has already been declared`. The whole settings
// module failed to load, in the browser, on a build where every gate was green.
//
// That is the shape of the problem: a file exempt from type-checking is exempt from the ONLY
// thing that reads it before a user does. This does not type-check anything — it asks the one
// question a syntax error always answers wrongly: can this file be loaded at all?
//
// Cheap enough to run over the whole tree (a parse, not an execution — nothing here runs the
// modules), and it catches the class exactly: any error that stops a module parsing stops the
// screen that imports it from existing.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Run with --experimental-vm-modules (the npm script passes it) so `SourceTextModule` exists.
//
// There WAS a fallback here that stripped the import/export lines with regexes and parsed the
// rest with `new Function`. It reported notification-center.js as broken when it is fine — a
// multi-line import defeated the stripping. A checker that cries wolf is worse than no checker,
// because the first false positive teaches everybody to skip it. Refuse loudly instead.
if (typeof vm.SourceTextModule !== 'function') {
    console.error('compiled-parses: needs node --experimental-vm-modules (see the npm script).');
    process.exit(1);
}

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'frontend/js');

const files = [];
(function walk(d) {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.js')) files.push(p);
    }
})(DIR);

if (!files.length) {
    console.error('compiled-parses: nothing compiled under frontend/js — run `npm run compile` first.');
    console.error('A check with no input passes for ever while checking nothing.');
    process.exit(1);
}

const bad = [];
for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    try {
        // As a MODULE: `import`/`export` at top level are syntax errors in a script, and
        // every file here is one. Compiling is a parse — the module is never linked or
        // evaluated, so nothing in it runs.
        new vm.SourceTextModule(src, { identifier: f });
    } catch (e) {
        bad.push({ file: path.relative(ROOT, f).replace(/\\/g, '/'), message: String(e?.message || e).split('\n')[0] });
    }
}

if (bad.length) {
    console.error(`${bad.length} compiled module(s) do not parse — the screens importing them cannot load:\n`);
    for (const b of bad) console.error(`  ${b.file}\n    ${b.message}`);
    process.exit(1);
}

console.log(`✓ all ${files.length} compiled module(s) parse`);
