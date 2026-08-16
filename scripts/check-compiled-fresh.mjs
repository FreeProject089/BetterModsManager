#!/usr/bin/env node
// The committed JavaScript must be what the committed TypeScript compiles to.
//
// `frontend/js/**/*.js` is in .gitignore, but 66 of those files were force-added long ago and a
// tracked file ignores the ignore rule. So they sit in the repository as a second copy of the
// source that nothing keeps honest: change a .ts, forget to commit the output, and the tree
// carries JavaScript that no longer matches the TypeScript beside it. That has happened at least
// twice — there is a commit called "rebuild compiled js/ output to match committed TypeScript" —
// and three files were adrift again when this check was written.
//
// Nothing catches it otherwise: `tsc` is happy (it reads the .ts), the app is built from the .ts,
// and the stale .js is only ever read by a person, who has no way to know it is out of date.
//
// Runs after `tsc` in `npm run ci`, so what it compares is a fresh compile.
import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

let dirty;
try {
    // Only TRACKED files: an untracked compiled file is a build artifact behaving exactly as
    // .gitignore intends, and is nobody's problem.
    // Against HEAD, not against the index: a staged file is still not committed, and the claim
    // being checked is about what the repository holds.
    dirty = git('diff', 'HEAD', '--name-only', '--', 'frontend/js').split('\n').filter(Boolean);
} catch (e) {
    // No git (a source tarball, a container without the history) — nothing to compare against.
    console.log(`compiled-fresh: skipped (${String(e.message || e).split('\n')[0]})`);
    process.exit(0);
}

if (dirty.length) {
    console.error('The committed JavaScript no longer matches the TypeScript it comes from:\n');
    for (const f of dirty) console.error(`  ${f}`);
    console.error('\nThese files are tracked, so they are read as the truth about the app. Compile and');
    console.error('commit them with the source change that caused it:\n');
    console.error('  npm run compile && git add ' + dirty.join(' '));
    process.exit(1);
}

const tracked = git('ls-files', 'frontend/js').split('\n').filter(Boolean).length;
// A guard that silently stops guarding is worse than none: if the force-added files are ever
// untracked, this check would pass for ever while checking nothing.
if (tracked === 0) {
    console.error('compiled-fresh: no compiled file is tracked any more — this check now proves nothing.');
    console.error('Either the outputs were untracked on purpose (then delete this script), or something went wrong.');
    process.exit(1);
}

console.log(`compiled-fresh OK — ${tracked} compiled file(s) match their source`);
