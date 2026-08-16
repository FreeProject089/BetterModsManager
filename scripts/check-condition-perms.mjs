// A condition that reaches OUT must ask permission first.
//
// Conditions used to be unable to: evalCondition took (cond, ctx) and no Task, so
// `commandSucceeds` passed `allow: true` to run_scheduled_command and spawned any program on
// the machine — while the ACTION that runs a program refused without the `command`
// permission. Putting the command in an `if` was the whole bypass.
//
// The task is threaded now, and this keeps it that way: for every `case` in the condition
// evaluator that invokes a command on this list, `needPerm(` must appear BEFORE the invoke.
// Comments are stripped first — the first version of this check compared raw offsets and
// reported a correct gate as missing, because the comment ABOVE it named the command.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'frontend', 'src', 'features', 'settings', 'scheduler.ts');

/** Commands a condition must not reach without the task's say-so. */
const GATED = ['run_scheduled_command', 'http_request', 'fetch_remote_json', 'write_text_file', 'run_script'];

const text = fs.readFileSync(SRC, 'utf8');
const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

const at = stripped.indexOf('async function evalConditionRaw');
if (at < 0) { console.error('✗ evalConditionRaw not found — this check is looking at the wrong thing'); process.exit(1); }
// The evaluator ends at the next top-level function.
const endMarkers = ['\nfunction cmpNum', '\nasync function ', '\nfunction '];
let end = stripped.length;
for (const m of endMarkers) {
    const i = stripped.indexOf(m, at + 20);
    if (i > 0 && i < end) end = i;
}
const body = stripped.slice(at, end);

// Split into cases so a gate in one case cannot vouch for another.
const parts = [...body.matchAll(/case '([a-zA-Z0-9_.]+)':/g)];
if (parts.length < 15) { console.error(`✗ only ${parts.length} condition case(s) found — the split is broken`); process.exit(1); }

const problems = [];
let gatedSeen = 0;
for (let i = 0; i < parts.length; i++) {
    const from = parts[i].index;
    const to = i + 1 < parts.length ? parts[i + 1].index : body.length;
    const seg = body.slice(from, to);
    const hit = GATED.find((c) => seg.includes(c));
    if (!hit) continue;
    gatedSeen += 1;
    const perm = seg.indexOf('needPerm(');
    const cmd = seg.indexOf(hit);
    if (perm < 0) problems.push(`${parts[i][1]} invokes ${hit} and never calls needPerm()`);
    else if (perm > cmd) problems.push(`${parts[i][1]} calls needPerm() AFTER invoking ${hit}`);
}

// A floor: if the split stops finding the gated cases, the check passes by finding nothing.
if (gatedSeen < 2) {
    console.error(`✗ only ${gatedSeen} gated condition(s) found — expected at least 2; the scan is broken`);
    process.exit(1);
}

if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(1);
}
console.log(`✓ condition permissions OK (${gatedSeen} reaching condition(s), all gated)`);
