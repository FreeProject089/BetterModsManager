#!/usr/bin/env node
// A test suite that never ran, reported as a pass.
//
// Found by accident and reproduced in isolation. On node 24, a `describe` body that THROWS —
// a typo in a constant name, an import that came back undefined — is printed under "failing
// tests" and does not count:
//
//     describe('a suite whose body throws', () => {
//       for (const x of MISSING) { test('never registered', () => {}); }
//     });
//
//     ℹ tests 1 · ℹ pass 1 · ℹ fail 0        → exit 0
//
// The tests inside it were never registered, so there is nothing to fail. `npm test` goes
// green over a file that did not execute, which is the worst shape a gate can take: the more
// broken the file, the quieter it is.
//
// So the run is read as well as counted. `✖ failing tests:` is printed by the reporter only
// when something failed, so this cannot report a false failure — and it catches the ordinary
// case too, where a real assertion fails and the exit code already says so.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = readdirSync(join(ROOT, 'tests')).filter((f) => f.endsWith('.test.mjs'));
if (files.length < 10) {
  console.error(`✗ found ${files.length} test file(s) — too few to be right, so this check cannot be trusted`);
  process.exit(2);
}

const run = spawnSync(process.execPath, ['--test', ...files.map((f) => join('tests', f))], {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
const out = `${run.stdout || ''}${run.stderr || ''}`;

const problems = [];
if (run.status !== 0) problems.push(`the test run exited ${run.status}`);
// The reporter's own section header. Present ⇒ something failed, whatever the counters say.
if (/^✖ failing tests:/m.test(out)) {
  problems.push('the reporter printed a "failing tests" section');
  for (const m of out.matchAll(/^✖ (.+?) \(\d/gm)) problems.push(`  ${m[1]}`);
  for (const m of out.matchAll(/^\s+((?:Reference|Type|Syntax)Error: .+)$/gm)) problems.push(`  ${m[1]}`);
}
// A suite whose body threw registers nothing, so the count drops rather than the failures
// rising. Reading it out loud is what makes that visible in a log.
const counted = /^ℹ tests (\d+)$/m.exec(out);
const passed = /^ℹ pass (\d+)$/m.exec(out);
const failed = /^ℹ fail (\d+)$/m.exec(out);

if (problems.length) {
  console.error('✗ tests:');
  for (const p of problems) console.error(`    ${p}`);
  console.error(`\n  Reported: ${counted?.[1] ?? '?'} test(s), ${passed?.[1] ?? '?'} passed, ${failed?.[1] ?? '?'} failed.`);
  console.error('  A suite whose body throws is not counted at all — the numbers above can look');
  console.error('  perfect while a whole file never ran.');
  process.exit(1);
}
console.log(`✓ every suite ran — ${counted?.[1] ?? '?'} test(s) across ${files.length} file(s), ${failed?.[1] ?? '0'} failed`);
