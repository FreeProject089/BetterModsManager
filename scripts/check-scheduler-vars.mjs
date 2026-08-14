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

if (unreachable.length === 0 && alwaysZero.length === 0) {
    console.log(`✓ scheduler variables: ${written.size} written, all readable, none dangling`);
    process.exit(0);
}
for (const v of unreachable) {
    console.error(`✗ '${v}' is written by an action but not in VALUE_SOURCES — no condition can read it`);
}
for (const v of alwaysZero) {
    console.error(`✗ '${v}' is offered as a condition source but nothing writes it — it is always 0`);
}
console.error(`\n  Fix: keep VALUE_SOURCES in ${FILE} in step with the context writes in runAction.`);
process.exit(1);
