// check-scheduler-vars.mjs — every scheduler variable must be both writable and readable.
//
// The scheduler has two lists that have to agree and nothing kept them in step:
//   - actions write measured values into the run context (`ctx['disk.free_gb'] = …`),
//   - `VALUE_SOURCES` is what the "value" condition's dropdown offers.
// The dropdown is the ONLY way to name a source, so a write missing from VALUE_SOURCES is
// a variable no condition can ever read.
//
// They had already drifted: check_disk_space wrote disk.free_gb, disk.free_percent and
// disk.total_gb, and app.checkUpdate wrote update.available, none of which were offered.
// Four actions were quietly writing to nowhere — "if an update is available, notify me"
// was not expressible, with nothing to indicate why.
//
// The reverse direction matters too: a source offered with nothing writing it is always
// zero, so the condition silently never holds — which reads as "the condition was false"
// rather than "this variable does not exist".

import fs from 'node:fs';

const FILE = 'frontend/src/features/settings/scheduler.ts';
const src = fs.readFileSync(FILE, 'utf8');

// Assignments only. A read (`ctx[name]` in a comparison) does not create a variable.
const written = new Set([...src.matchAll(/ctx\['([a-zA-Z0-9._]+)'\]\s*=/g)].map((m) => m[1]));

const block = src.match(/const VALUE_SOURCES = \[(.*?)\];/s);
if (!block) {
    console.error(`✗ ${FILE}: could not find VALUE_SOURCES — has it been renamed?`);
    process.exit(2);
}
const offered = new Set([...block[1].matchAll(/'([a-zA-Z0-9._]+)'/g)].map((m) => m[1]));

const unreachable = [...written].filter((v) => !offered.has(v)).sort();
const alwaysZero = [...offered].filter((v) => !written.has(v)).sort();

// ── Presets may only name things that exist ──────────────────────────────────────
//
// A preset is offered as the correct way to do something, so an invented action type or
// condition source is worse there than anywhere else: it fails at run time, in a task the
// user did not write, and it looks like the feature is broken rather than the example.
// Nothing else checks these — the params are `Record<string, any>` and the action type is
// a bare string, so a typo type-checks perfectly.
// Anchored on the declaration line, not on "everything up to the first =": the type
// annotation contains `() => Partial<Task>`, so an [^=]* prefix never matched and this
// whole section silently checked nothing while reporting success.
const presetBlock = src.match(/const PRESETS\b.*?=\s*\[(.*?)\n\];/s);
if (!presetBlock) {
    console.error('✗ could not find the PRESETS array — has it been renamed? Refusing to report success on an unchecked file.');
    process.exit(2);
}
const badRefs = [];
{
    const body = presetBlock[1];
    const knownActions = new Set([...src.matchAll(/\{ v: '([a-zA-Z0-9._]+)', label:/g)].map((m) => m[1]));
    const knownConds = (src.match(/const COND_TYPES = \[(.*?)\];/s) || [, ''])[1];
    const condSet = new Set([...knownConds.matchAll(/'([a-zA-Z0-9._]+)'/g)].map((m) => m[1]));

    for (const m of body.matchAll(/type: '([a-zA-Z0-9._]+)', params:/g)) {
        // One arm names an action, the other a condition; a name in neither is a typo.
        if (!knownActions.has(m[1]) && !condSet.has(m[1])) {
            badRefs.push(`preset uses '${m[1]}', which is neither an action nor a condition type`);
        }
    }
    for (const m of body.matchAll(/source: '([a-zA-Z0-9._]+)'/g)) {
        if (!offered.has(m[1])) {
            badRefs.push(`preset reads value source '${m[1]}', which is not in VALUE_SOURCES`);
        }
    }
}

if (unreachable.length === 0 && alwaysZero.length === 0 && badRefs.length === 0) {
    console.log(`✓ scheduler variables: ${written.size} written, all readable, none dangling`);
    if (presetBlock) console.log('✓ presets reference only real actions, conditions and value sources');
    process.exit(0);
}
for (const v of unreachable) {
    console.error(`✗ '${v}' is written by an action but not in VALUE_SOURCES — no condition can read it`);
}
for (const v of alwaysZero) {
    console.error(`✗ '${v}' is offered as a condition source but nothing writes it — it is always 0`);
}
for (const b of badRefs) console.error(`✗ ${b}`);
console.error(`\n  Fix: keep VALUE_SOURCES in ${FILE} in step with the context writes in runAction.`);
process.exit(1);
