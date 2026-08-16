// A placeholder is user-facing text, and it is the easiest place to forget that.
//
// plugins.ts had seven of them written straight into the markup — and in BOTH languages at once:
// "Nouveau nom", "Mon Modpack", "Mon Pseudo" beside "My App", "My Server Mods", "My Server
// Plugins". Whichever language you picked, some of the app was in the other one. That is the
// whole of the "BMM mixes French and English" report, and nothing could have caught it: t() is
// never called, so the key checkers see nothing to check, and tsc has no opinion about a string.
//
// So the rule is inverted here: a literal placeholder must be language-NEUTRAL, or be listed
// below with a reason. The list only ever shrinks.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'frontend/src';

// Literals that are the same text in any language, and why. A game's name is its name.
const NEUTRAL = new Map([
    ['Ex: DCS World 2.9', 'a game name; "Ex:" reads the same in French'],
    ['DCS World…', 'a game name'],
    ['DCS World, ArmA 3...', 'game names'],
    ['(disk.read_mbps + disk.write_mbps) / 2', 'an expression the user types, not prose'],
]);

// Prose in either language: a space, real letters, and a function word from EN or FR. The
// function word is what separates "Save your profile" from "catalog.json" or ".mod-item".
const FUNCTION_WORD = /(^|\s)(the|a|an|is|are|to|not|no|your|this|that|and|or|for|of|in|with|be|has|was|will|can|it|does|what|my|le|la|les|un|une|des|du|de|mon|ma|mes|votre|vos|ce|cette|et|ou|pour|dans|avec|est|sont|que|qui|sans|sur)(\s|$)/i;
const NEVER_PROSE = /^(https?:|\/|\.|#|\{)|@|^[\d.\s]+$|[;{}]/;

const files = [];
(function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts')) files.push(p);
    }
})(ROOT);

const bad = [];
let checked = 0;
for (const f of files) {
    const rel = f.replace(/\\/g, '/');
    // Developer-only surfaces. Their English is a tool's English, not the product's.
    if (/\/debug\//.test(rel)) continue;
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => {
        for (const m of l.matchAll(/placeholder="([^"]*)"/g)) {
            const s = m[1];
            if (s.includes('${')) return;          // built from t(), which the key checkers cover
            checked += 1;
            if (NEUTRAL.has(s)) return;
            // Prose is at least two words. A single one is a code, a unit or a field name
            // ("de", "auto", "URL") — the first run of this gate flagged the German language
            // code in the translation sandbox, because "de" is also a French preposition.
            if (!s.trim().includes(' ')) return;
            if (NEVER_PROSE.test(s)) return;
            if (!FUNCTION_WORD.test(s)) return;
            bad.push(`${rel}:${i + 1}  placeholder="${s}"`);
        }
    });
}

if (bad.length) {
    console.error(`✗ ${bad.length} hardcoded placeholder(s) in prose — wrap in t(), or add to NEUTRAL with a reason:`);
    for (const b of bad) console.error(`    ${b}`);
    process.exit(1);
}

// A gate that stops finding placeholders passes for the wrong reason. This is the same ratchet
// the other checkers use: prove the extractor still sees the codebase.
if (checked < 40) {
    console.error(`✗ only ${checked} literal placeholder(s) found — the extractor is stale, not the code clean`);
    process.exit(1);
}

const stale = [...NEUTRAL.keys()].filter((k) => !files.some((f) => fs.readFileSync(f, 'utf8').includes(`placeholder="${k}"`)));
if (stale.length) {
    console.error(`✗ NEUTRAL lists ${stale.length} placeholder(s) that no longer exist — remove them: ${stale.join(', ')}`);
    process.exit(1);
}

console.log(`✓ placeholders OK (${checked} literal, ${NEUTRAL.size} allowed as language-neutral)`);
