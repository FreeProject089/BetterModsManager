#!/usr/bin/env node
// check-doc-links — a relative link between two documents must land on a document.
//
// `check-docs-xref` already keeps the two documentation SURFACES wired to each other: `doc:`
// ids, `bmm://docs/open`, and each article's docsPath. What nothing looked at was the
// ordinary case — one markdown file linking to another by relative path. Those rot quietly:
// a guide is moved into a subfolder, a file is renamed, an archive is retired, and every
// link to it keeps rendering as a link. The reader finds out; the repository never does.
//
// This found three real ones on its first run, all of them stale for months:
//   · TranslationGuide pointed at ../Guides/video_localization_EN.md, which lives one folder
//     deeper, in Guides/Translation/
//   · BCW's readme pointed at BCWEB/ARCHITECTURE.md, moved to guides/reference/
//   · a remediation plan pointed at a SECURITY_AUDIT.md that had been archived
//
// Deliberately narrow, for the same reason check-catalog-docs is: it checks that a target
// EXISTS, never what it says.
//
// Usage: node scripts/check-doc-links.mjs
// Exit code 1 on any broken link.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';

const ROOT = resolve(process.cwd());

// BMM's own documentation. BCWEB has its own link checker (BCWEB/guides/check-links.mjs) and
// running a second one over it would report the same things twice in a different voice.
const TREES = ['Update', 'BMM Docs/docs', 'BetterInstaller'];

// Third-party skill bundles vendored under .Assets are somebody else's documentation, and
// their broken links are not this project's to fix.
const SKIP = ['node_modules', '.git', 'target', 'dist', 'build'];

const files = [];
const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
        if (SKIP.includes(name)) continue;
        const full = join(dir, name);
        let st;
        try { st = statSync(full); } catch { continue; }
        if (st.isDirectory()) walk(full);
        else if (name.endsWith('.md')) files.push(full);
    }
};
for (const t of TREES) {
    const dir = join(ROOT, t);
    if (existsSync(dir)) walk(dir);
    else console.log(`  skip  ${t} — not present`);
}

/**
 * Blank out code spans and fenced blocks before looking for links.
 *
 * A syntax table that documents `[x](page.md)` as an EXAMPLE is not a link, and flagging it
 * teaches people the checker is wrong — which is how a gate ends up switched off. Replaced
 * with spaces rather than removed so nothing after them shifts.
 */
const stripCode = (text) => text
    .replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length))
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));

const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const broken = [];
let checked = 0;

for (const file of files) {
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    const body = stripCode(text);
    for (const m of body.matchAll(LINK)) {
        const raw = m[1];
        // Schemes, in-page anchors and protocol-relative URLs are not this checker's business.
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) || raw.startsWith('#') || raw.startsWith('//')) continue;
        // A path is written for a markdown renderer, so it is percent-encoded: a folder with
        // a space in its name arrives as %20 and is a real path once decoded.
        let path;
        try { path = decodeURIComponent(raw.split('#')[0].split('?')[0]); } catch { path = raw.split('#')[0]; }
        if (!path) continue;
        checked += 1;

        const from = dirname(file);
        const target = resolve(from, path.split('/').join(sep));
        if (existsSync(target)) continue;
        // mkdocs links without the extension, and to a directory holding an index.
        if (existsSync(`${target}.md`) || existsSync(join(target, 'index.md'))) continue;
        // The bundled docs are rendered inside the app, so their asset paths resolve against
        // the app root rather than against the file they are written in.
        if (existsSync(join(ROOT, 'frontend', path.split('/').join(sep)))) continue;

        broken.push({ file: relative(ROOT, file), raw });
    }
}

if (broken.length) {
    console.error(`✗ ${broken.length} broken link(s) between documents:\n`);
    for (const b of broken) console.error(`  ${b.file}\n    → ${b.raw}`);
    console.error('\n  A link that renders is not a link that resolves. Move the target back,');
    console.error('  or point at where it went.');
    process.exit(1);
}
console.log(`✓ ${checked} relative doc link(s) resolve (${files.length} file(s))`);
