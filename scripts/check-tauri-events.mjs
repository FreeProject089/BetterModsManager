#!/usr/bin/env node
// Are we listening for events Tauri 2 still emits?
//
// This exists because of a real, silent outage: after the v2 migration the app kept listening
// for `tauri://file-drop`, which v2 renamed to `tauri://drag-drop`. Dropping a folder onto the
// mod library did nothing — no error, no warning, no failed call. An event that is never
// emitted cannot fail loudly, which is what makes this class of break worth a build gate rather
// than a comment.
//
// The payload changed with the name (`string[]` → `{ paths, position }`), so a rename fixed by
// hand tends to be only half fixed. That half is not checkable from here; the listener's own
// comment carries it.
//
// NOTE: written with an editor, never generated through a shell heredoc — the backslashes in
// the regexes below come back mangled that way, which is a documented trap in this repo and is
// exactly how it went wrong the first time this file was created.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not `new URL(...).pathname`: the latter percent-encodes, so a checkout under a
// directory with a space in its name yields a path containing %20 and every read fails.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// v1 name → what v2 calls it.
const RENAMED = {
    'tauri://file-drop': 'tauri://drag-drop',
    'tauri://file-drop-hover': 'tauri://drag-over',
    'tauri://file-drop-cancelled': 'tauri://drag-leave',
};

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'target', 'gen']);

const files = [];
function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
        if (SKIP_DIRS.has(e.name)) continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|js|mjs|rs)$/.test(e.name)) files.push(p);
    }
}
walk(join(ROOT, 'frontend'));
walk(join(ROOT, 'src-tauri'));

const problems = [];
for (const f of files) {
    // This checker names the old events itself; it must not report on its own source.
    if (f.endsWith('check-tauri-events.mjs')) continue;
    const src = readFileSync(f, 'utf8');
    for (const [old, now] of Object.entries(RENAMED)) {
        // Only a STRING LITERAL in straight quotes counts — the thing actually passed to
        // `listen`. A first version matched the name anywhere in the file and immediately
        // reported the fixed listener's own comment, which names the old event to explain why
        // it changed. A checker that flags the explanation of the fix is a checker people learn
        // to skip, and it would have been read as "the fix did not land".
        const re = new RegExp(`['"]${old.replace(/[/:]/g, (c) => `\\${c}`)}['"]`);
        const m = re.exec(src);
        if (!m) continue;
        const line = src.slice(0, m.index).split('\n').length;
        const rel = relative(ROOT, f).split('\\').join('/');
        problems.push(`${rel}:${line}  "${old}" is a Tauri 1 event — v2 emits "${now}"`);
    }
}

if (!problems.length) {
    console.log(`tauri-events: checked ${files.length} files — no Tauri 1 event names`);
    process.exit(0);
}
for (const p of problems) console.log('  ' + p);
console.log(`\n${problems.length} listener(s) waiting for an event nothing sends.`);
process.exit(1);
