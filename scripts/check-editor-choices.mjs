// Every value the Step type accepts must be offerable in the editor.
//
// Three times in one sitting the same defect: the runtime handled a value, the type allowed
// it, and the editor had no way to pick it. `for each` resolved `source: 'list'` from the
// first day and the picker listed only the six app collections, so iterating a list the task
// built itself worked and was unreachable. Nothing failed. Every check stayed green, because
// each of the three places was internally consistent — they just did not agree with each other.
//
// tsc cannot see this: an editor offering a subset of a union is perfectly well typed.
//
// A literal counts as offered if it turns up in an `as const` options array, a data-add
// attribute (the add-step chips), or an <option value="…">. Those are the three ways this
// editor puts a choice in front of somebody.
//
// Run as part of `npm run ci`.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'frontend', 'src', 'features', 'settings', 'scheduler.ts');
const text = readFileSync(SRC, 'utf8');

// The Step union, from `type Step = (` to the line that closes it.
const stepDecl = /type Step = \(([\s\S]*?)\n\) &/.exec(text);
if (!stepDecl) {
    console.error('✗ could not find the Step type — this checker needs updating before it can be trusted');
    process.exit(1);
}

// Fields whose type is a union of two or more string literals: `source: 'a' | 'b' | …`.
const fields = [];
for (const m of stepDecl[1].matchAll(/(\w+)\??:\s*((?:'[^']+'\s*\|\s*)+'[^']+')/g)) {
    fields.push({ field: m[1], values: [...m[2].matchAll(/'([^']+)'/g)].map((v) => v[1]) });
}
if (!fields.length) {
    console.error('✗ no literal unions found in Step — the parser is broken, not the code');
    process.exit(1);
}

// Everything the editor can put in front of somebody.
const offered = new Set();
for (const m of text.matchAll(/\[([^\]]*)\]\s*as const/g)) {
    for (const v of m[1].matchAll(/'([^']+)'/g)) offered.add(v[1]);
}
for (const m of text.matchAll(/data-add="([^"]+)"/g)) offered.add(m[1]);
for (const m of text.matchAll(/<option value="\$\{?([a-zA-Z]+)\}?"/g)) offered.add(m[1]);
for (const m of text.matchAll(/<option value="([a-z][a-zA-Z]*)"/g)) offered.add(m[1]);

const gaps = [];
for (const { field, values } of fields) {
    const missing = values.filter((v) => !offered.has(v));
    // All of them missing means the field is rendered some way this checker does not model —
    // a free-text input, a computed list. Reporting that as a gap would be noise. A PARTIAL
    // miss is the real signal: the editor offers some of the union and silently not the rest.
    if (missing.length && missing.length < values.length) gaps.push({ field, missing, values });
}

if (gaps.length) {
    console.error(`✗ ${gaps.length} Step field(s) whose editor offers only part of the type:`);
    for (const g of gaps) {
        console.error(`  ${g.field}: cannot pick ${g.missing.map((m) => `'${m}'`).join(', ')}`);
        console.error(`     (the type allows ${g.values.length}: ${g.values.join(', ')})`);
    }
    console.error('\n  The runtime probably handles them already, which is why nothing fails.');
    console.error('  Add them to the picker, or narrow the type so it stops promising them.');
    process.exit(1);
}

console.log(`✓ every Step choice is offerable (${fields.length} literal union(s) checked)`);
