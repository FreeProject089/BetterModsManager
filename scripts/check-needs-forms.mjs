// Every action that declares a params form must actually have one.
//
// `renderParams` is one long else-if chain over `needs`, and it only ever assigns
// host.innerHTML inside a matching branch. A `needs` with no branch therefore does not render
// an empty form — it leaves the PREVIOUS action's fields on screen. You pick "List — set it",
// you see the fields of whatever you looked at before, and the parameters you type land on
// nothing.
//
// That is how the three list actions shipped unusable: list.set, list.push and list.clear all
// worked at run time, and none of them could be configured. Nothing failed, nothing logged,
// and every existing check stayed green — the action registry only asks that a `needs` be
// declared, not that it be handled.
//
// Run as part of `npm run ci`.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'frontend', 'src', 'features', 'settings', 'scheduler.ts');
const text = readFileSync(SRC, 'utf8');

const declared = [...new Set([...text.matchAll(/needs:\s*'([^']+)'/g)].map((m) => m[1]))];
const branched = new Set([...text.matchAll(/needs === '([^']+)'/g)].map((m) => m[1]));

// The simple ones need no branch: _field() renders a single labelled control for any `needs`
// listed in NEEDS_LABEL, so being in that table counts as being handled.
const labelBlock = /const NEEDS_LABEL: Record<string, string> = \{([\s\S]*?)\}/.exec(text);
if (!labelBlock) {
    console.error('✗ could not find NEEDS_LABEL — this checker needs updating before it can be trusted');
    process.exit(1);
}
const labelled = new Set([...labelBlock[1].matchAll(/(\w+)\s*:/g)].map((m) => m[1]));

// A parser that silently matched nothing would report a clean bill of health over an empty
// list, which is the same shape of lie this check exists to catch.
if (declared.length < 20) {
    console.error(`✗ only ${declared.length} needs found — the parser is broken, not the code`);
    process.exit(1);
}

const orphans = declared.filter((n) => !branched.has(n) && !labelled.has(n));
if (orphans.length) {
    console.error(`✗ ${orphans.length} action form(s) declared with nothing to render them:`);
    for (const o of orphans) console.error(`  needs: '${o}'`);
    console.error('\n  renderParams only sets innerHTML inside a matching branch, so these leave');
    console.error('  the previously selected action\'s fields on screen and silently discard input.');
    console.error('  Add a branch in renderParams, or an entry in NEEDS_LABEL for a single field.');
    process.exit(1);
}

console.log(`✓ every action form renders (${declared.length} needs: ${branched.size} branches, ${labelled.size} single-field)`);
