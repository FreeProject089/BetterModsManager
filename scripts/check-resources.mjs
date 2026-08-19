#!/usr/bin/env node
// Every file the Rust asks for at runtime must actually be shipped in the bundle.
//
// WHY THIS EXISTS
//
// Tauri copies `bundle.resources` from tauri.conf.json into the installed app. A path
// listed as "../frontend/Lang" lands under `_up_/frontend/Lang`, and resolve_path() knows
// to look there. Nothing checked that the two lists agreed.
//
// The failure is invisible in development. resolve_path()'s fourth strategy CLIMBS UP TO
// FIVE DIRECTORIES from the resource directory, so under `npm run dev` — and under
// `tauri build --no-bundle`, which runs from src-tauri/target/release — it finds the file
// at the repository root whether or not it was ever declared as a resource. Add a
// resolve_path(&h, "catalogs/index.json") without the matching bundle entry and everything
// works on your machine, all the way through CI, and the file is simply absent for every
// installed user. The feature silently does nothing.
//
// So this checks both directions:
//
//   1. Every path in DECLARED below is satisfied by a bundle.resources entry AND exists on
//      disk. A resource that was renamed or deleted fails here.
//   2. Every string literal handed to resolve_path() or to .resolve(…, BaseDirectory::
//      Resource) in the Rust appears in DECLARED. A new call site fails the check until
//      somebody says where the file is meant to come from — which is the moment to notice
//      it needs a bundle entry.
//
// Paths built with format!() cannot be read out of the source, so they are declared by
// hand, with the call site named. That is the honest limit of this check and it is stated
// rather than hidden.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONF = join(ROOT, 'src-tauri/tauri.conf.json');

// ── What the app asks for at runtime, and who asks ──────────────────────────
// `optional: true` = the app has a working fallback if it is absent, so it is checked for
// consistency but never required to exist.
const DECLARED = [
    { path: 'app.cfg', by: 'settings.rs — is_debug_mode / is_ptb_mode / get_bc_config …' },
    { path: 'LICENSE.md', by: 'settings.rs — get_license_text' },
    { path: 'PRIVACY.md', by: 'settings.rs — get_privacy_text' },
    { path: 'PRIVACY_FR.md', by: 'settings.rs — get_privacy_text, format!("PRIVACY_{LANG}.md")' },
    { path: 'TOS.md', by: 'settings.rs — get_eula_text' },
    { path: 'TOS_FR.md', by: 'settings.rs — get_eula_text, format!("TOS_{LANG}.md")' },
    { path: 'Lang/en.json', by: 'settings.rs — get_available_languages' },
    { path: 'assets/tutorial-assets', by: 'settings.rs — tutorial asset lookup' },
    { path: 'frontend/assets/links.json', by: 'discord.rs — Discord RPC ids' },
    { path: 'builtin-themes', by: 'themes.rs — list_builtin_themes' },
    // get_eula_text also tries EULA_{LANG}.md and EULA.md, but only AFTER TOS.md, which is
    // shipped and always answers. No EULA file exists anywhere in the repository; these are
    // dead fallbacks, not missing resources, so they are declared optional rather than
    // quietly ignored.
    { path: 'EULA.md', by: 'settings.rs — get_eula_text (dead fallback, TOS.md answers first)', optional: true },
    { path: 'EULA_FR.md', by: 'settings.rs — get_eula_text, format!("EULA_{LANG}.md") (dead fallback)', optional: true },
];

// ── The candidate forms resolve_path() tries, in its own order ──────────────
// Mirrors fs_utils.rs resolve_path(). Kept next to the check that depends on it: if that
// function grows a strategy, this list has to grow with it or the check goes stale.
const candidates = (p) => [
    p,
    `_up_/${p}`,
    `_up_/frontend/${p}`,
    p.split('/').pop(),
    `frontend/${p}`,
    // themes.rs and discord.rs bypass resolve_path and try these forms directly.
    `_up_/frontend/assets/${p}`,
    `../frontend/${p}`,
];

const fail = [];
const conf = JSON.parse(readFileSync(CONF, 'utf8'));
const resources = conf?.bundle?.resources ?? conf?.tauri?.bundle?.resources;
if (!Array.isArray(resources)) {
    console.error(`check-resources: no bundle.resources array in ${CONF}`);
    process.exit(1);
}

// A resource "../frontend/Lang" is installed at "_up_/frontend/Lang" and covers everything
// beneath it, so matching is by prefix rather than by exact path.
const shipped = resources.map((r) => {
    const repoRel = r.replace(/^\.\.\//, '');
    const installed = r.startsWith('../') ? `_up_/${repoRel}` : repoRel;
    return { spec: r, repoRel, installed };
});

const covers = (installed, want) => installed === want || want.startsWith(`${installed}/`);

// ── 1. Everything declared is shipped, and exists ───────────────────────────
for (const need of DECLARED) {
    const hit = shipped.find((s) => candidates(need.path).some((c) => covers(s.installed, c)));
    if (!hit) {
        if (need.optional) continue;
        fail.push(
            `not shipped: "${need.path}" (${need.by})\n` +
            `    No bundle.resources entry installs it. resolve_path() would still find it\n` +
            `    in development by climbing to the repo root, so this breaks ONLY for\n` +
            `    installed users. Add it to "resources" in src-tauri/tauri.conf.json.`
        );
        continue;
    }
    const onDisk = join(ROOT, hit.repoRel);
    if (!existsSync(onDisk)) {
        fail.push(`resource missing on disk: "${hit.spec}" — declared for ${need.by}`);
        continue;
    }
    // A directory resource that is empty ships nothing at all.
    if (statSync(onDisk).isDirectory() && readdirSync(onDisk).length === 0) {
        fail.push(`resource directory is empty: "${hit.spec}" — declared for ${need.by}`);
    }
}

// ── 2. Every literal in the Rust is declared ────────────────────────────────
const rustFiles = [];
(function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.rs')) rustFiles.push(p);
    }
})(join(ROOT, 'src-tauri/src'));

const CALL = /(?:resolve_path\s*\(\s*&?\w+\s*,\s*&?"([^"]+)"|\.resolve\s*\(\s*"([^"]+)"\s*,\s*tauri::path::BaseDirectory::Resource)/g;
const declared = new Set(DECLARED.map((d) => d.path));
const seen = new Map();

for (const f of rustFiles) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(CALL)) {
        const raw = m[1] ?? m[2];
        // Normalise the hand-written prefixes the direct .resolve() call sites use, so
        // "../frontend/assets/links.json" and "frontend/assets/links.json" are one entry.
        const norm = raw.replace(/^\.\.\//, '').replace(/^_up_\/frontend\/assets\//, '')
            .replace(/^_up_\//, '');
        if (!seen.has(norm)) seen.set(norm, `${f.slice(ROOT.length + 1)}`);
    }
}

for (const [p, where] of seen) {
    if (declared.has(p)) continue;
    // The alternate spellings of an already-declared path are fine.
    if ([...declared].some((d) => d.endsWith(`/${p}`) || p.endsWith(`/${d}`) || d === p)) continue;
    fail.push(
        `asked for but not declared: "${p}" (${where})\n` +
        `    Add it to DECLARED in scripts/check-resources.mjs, and make sure\n` +
        `    src-tauri/tauri.conf.json actually ships it — development finds files the\n` +
        `    bundle does not contain, so nothing else will tell you.`
    );
}

if (fail.length) {
    console.error('check-resources FAILED\n');
    for (const f of fail) console.error(`  - ${f}\n`);
    console.error(
        'The bundle is what installed users get. A path that resolves on your machine and\n' +
        'is absent from bundle.resources is a feature that silently does nothing for them.'
    );
    process.exit(1);
}

const req = DECLARED.filter((d) => !d.optional).length;
console.log(
    `resources OK — ${req} runtime path(s) shipped by ${resources.length} bundle entr(ies); ` +
    `${seen.size} literal(s) in the Rust all declared`
);
