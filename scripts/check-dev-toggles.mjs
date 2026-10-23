// check-dev-toggles.mjs — local dev switches must never reach a build.
//
// Four independent review passes flagged the same hazard: `links-config.ts` ships
// `_bcTestMode`/`_bcLoaded` defaults that a developer flips to `true` to point BMM
// at a local BetterCommunity. Because `loadBcConfig()` starts with
// `if (_bcLoaded) return;`, a committed `_bcLoaded = true` means app.cfg is NEVER
// read and every BetterCommunity surface (blog, account, catalogs) resolves to
// http://localhost:5176 for every user — with no way to turn it off.
//
// It is invisible in review (two characters), harmless in dev, and total in prod.
// That is exactly the shape a guard is for.

import fs from 'node:fs';

const CHECKS = [
    {
        file: 'frontend/src/core/links-config.ts',
        rules: [
            { re: /^\s*let\s+_bcTestMode\s*=\s*true\s*;/m, msg: '_bcTestMode defaults to true — BetterCommunity would point at localhost for every user' },
            { re: /^\s*let\s+_bcLoaded\s*=\s*true\s*;/m,   msg: '_bcLoaded defaults to true — loadBcConfig() returns early, so app.cfg is never read' },
        ],
    },
];

let bad = 0;
for (const { file, rules } of CHECKS) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const { re, msg } of rules) {
        const m = re.exec(src);
        if (!m) continue;
        const line = src.slice(0, m.index).split('\n').length;
        console.error(`✗ ${file}:${line} — ${msg}`);
        bad++;
    }
}

if (bad) {
    console.error(`\n  ${bad} dev toggle(s) left on. Flip them back before building/committing.`);
    process.exit(1);
}
console.log('✓ no dev toggles left on');
