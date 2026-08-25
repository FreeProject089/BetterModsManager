// Every Step kind must be handled everywhere a step is walked or offered.
//
// A kind is not one feature, it is seven places: the type, the runner, the editor, a default
// instance, an add chip, an icon, and — the two that fail silently — `stepCount` and the
// `walk` inside `substituteItem`.
//
// Those two are the dangerous ones because nothing errors when they miss a kind:
//   - stepCount just under-reports, so the header says "4 steps" for a task with nine.
//   - walk stops recursing, so `{item.x}` silently stops resolving inside that kind when it
//     is nested in a FOR EACH. That is the exact bug walk was written to fix, reintroduced
//     for one kind only, and it looks like the task misbehaving rather than a missing case.
//
// Container kinds are derived, not listed: a union member carrying `steps:`, `then:`,
// `onError:`, `cases:` or `branches:` holds other steps and therefore has to be walked.
// `branches` joined that list with the parallel kind, and it is worth saying why the
// derivation still needs maintaining: the field NAME is the signal, so a container that
// invents a new one stays invisible here until somebody adds it. So adding a kind
// with a body wires itself into this check without anyone remembering to.
//
// Run as part of `npm run ci`.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'frontend', 'src', 'features', 'settings', 'scheduler.ts');
const text = readFileSync(SRC, 'utf8');

const stepDecl = /type Step = \(([\s\S]*?)\n\) &/.exec(text);
if (!stepDecl) {
    console.error('✗ could not find the Step type — this checker needs updating before it can be trusted');
    process.exit(1);
}

// One entry per union member: its kind, and whether it carries other steps.
const kinds = [];
for (const line of stepDecl[1].split('\n')) {
    const m = /kind:\s*'([^']+)'/.exec(line);
    if (!m) continue;
    kinds.push({ kind: m[1], container: /\b(steps|then|onError|cases|branches)\s*:/.test(line) });
}
if (kinds.length < 5) {
    console.error(`✗ only ${kinds.length} kinds found — the parser is broken, not the code`);
    process.exit(1);
}

const body = (name) => {
    const at = text.indexOf(`function ${name}`);
    if (at < 0) return null;
    // Far enough to cover the function; these are all well under this size.
    return text.slice(at, at + 6000);
};

const stepCount = body('stepCount');
const makeStep = body('_makeStep');
if (!stepCount || !makeStep) {
    console.error('✗ could not find stepCount or _makeStep — this checker needs updating');
    process.exit(1);
}
// substituteItem's recursion is an arrow assigned to `walk`, not a named function.
const walkAt = text.indexOf('const walk =');
const walk = walkAt < 0 ? null : text.slice(walkAt, walkAt + 4000);
if (!walk) {
    console.error("✗ could not find substituteItem's walk — this checker needs updating");
    process.exit(1);
}

const problems = [];
for (const { kind, container } of kinds) {
    const q = `'${kind}'`;
    if (!makeStep.includes(q)) problems.push(`${kind}: _makeStep has no default instance`);
    if (!text.includes(`data-add="${kind}"`)) problems.push(`${kind}: no add chip (data-add="${kind}")`);
    if (container) {
        if (!stepCount.includes(q)) problems.push(`${kind}: stepCount does not recurse — the step count will under-report`);
        if (!walk.includes(q)) problems.push(`${kind}: substituteItem's walk does not recurse — {item.x} will stop resolving inside it`);
    }
}

if (problems.length) {
    console.error(`✗ ${problems.length} Step kind gap(s):`);
    for (const p of problems) console.error(`  ${p}`);
    console.error('\n  Nothing throws for the stepCount and walk cases — they under-report and');
    console.error('  silently stop substituting. Add the kind to each place it is missing.');
    process.exit(1);
}

const containers = kinds.filter((k) => k.container).length;
console.log(`✓ every Step kind is handled (${kinds.length} kinds, ${containers} with bodies, walked and offered)`);
