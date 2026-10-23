// Every name imported from catalog-index.ts must actually be exported by it.
//
// tsc already checks this — except where it has been switched off. `plugins.ts` and
// `theme-catalog.ts` both start with `@ts-nocheck`, and both now import from catalog-index,
// so in those two files a mistyped or renamed import is not a build error: it is a
// ReferenceError the first time somebody opens the panel. That is the shape of a bug this
// codebase has shipped before.
//
// Cheap enough to run every time, and it fails LOUDLY on zero importers — a checker that
// silently finds nothing to check is worse than no checker, because it reports success.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'frontend', 'src');
const INDEX = path.join(SRC, 'features', 'catalogs', 'catalog-index.ts');

/** Every exported name, derived from the file rather than listed here. */
function exportsOf(text) {
    const names = new Set();
    for (const m of text.matchAll(/export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/g)) {
        names.add(m[1]);
    }
    // `export { a, b }` re-export form, in case one is added later.
    for (const m of text.matchAll(/export\s*\{([^}]*)\}\s*(?!from)/g)) {
        for (const raw of m[1].split(',')) {
            const n = raw.trim().split(/\s+as\s+/).pop()?.trim();
            if (n) names.add(n);
        }
    }
    return names;
}

/** Every .ts under frontend/src, so a new importer is covered without being registered. */
function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (e.name.endsWith('.ts')) out.push(p);
    }
    return out;
}

const exported = exportsOf(fs.readFileSync(INDEX, 'utf8'));
if (exported.size < 5) {
    console.error(`✗ catalog-index.ts parsed to only ${exported.size} export(s) — the parser is wrong, not the file`);
    process.exit(1);
}

const problems = [];
let importers = 0;

for (const file of walk(SRC)) {
    if (file === INDEX) continue;
    const text = fs.readFileSync(file, 'utf8');
    const blocks = text.match(/import\s+(?:type\s+)?\{[^}]*\}\s*from\s*['"][^'"]*catalog-index\.js['"]/g);
    if (!blocks) continue;
    importers += 1;
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const nocheck = /^\s*\/\/\s*@ts-nocheck/m.test(text.slice(0, 200));
    for (const block of blocks) {
        for (const raw of block.match(/\{([\s\S]*)\}/)[1].split(',')) {
            const name = raw.trim().split(/\s+as\s+/)[0].trim();
            if (!name) continue;
            if (!exported.has(name)) {
                problems.push(`${rel}: imports '${name}', which catalog-index.ts does not export`
                    + (nocheck ? '  (this file is @ts-nocheck — tsc will NOT catch it)' : ''));
            }
        }
    }
}

// The floor that stops this passing because a refactor moved every import somewhere the
// regex no longer matches.
if (importers < 4) {
    console.error(`✗ only ${importers} file(s) import catalog-index — expected at least 4; the match is broken`);
    process.exit(1);
}

if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(1);
}
console.log(`✓ catalog-index imports OK (${importers} importer(s), ${exported.size} exports)`);
