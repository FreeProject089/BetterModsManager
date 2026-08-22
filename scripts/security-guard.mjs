#!/usr/bin/env node
/**
 * security-guard.mjs — CWE-95 / CWE-749 regression guard.
 *
 * Fails the build if dynamic-code-execution sinks reappear in the frontend
 * source. The Debug Hub REPL `eval()` was removed during the CWE remediation;
 * this guard makes sure it (or `new Function(...)`) is never reintroduced.
 *
 * Wired into `npm run build` (runs before `tsc`). Run standalone with:
 *   node scripts/security-guard.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(ROOT, 'frontend', 'src');

// Patterns that indicate runtime code execution from strings.
const FORBIDDEN = [
    { re: /\beval\s*\(/, name: 'eval(' },
    { re: /\bnew\s+Function\s*\(/, name: 'new Function(' },
];

/** Walk a directory recursively, yielding .ts/.js file paths. */
function* walk(dir) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            yield* walk(full);
        } else if (/\.(ts|js|mjs)$/.test(entry)) {
            yield full;
        }
    }
}

const violations = [];
for (const file of walk(SRC)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
        // Skip line comments so prose mentioning eval() doesn't trip the guard.
        const code = line.replace(/\/\/.*$/, '');
        for (const { re, name } of FORBIDDEN) {
            if (re.test(code)) {
                violations.push(`${relative(ROOT, file)}:${i + 1}  →  ${name}  ${line.trim()}`);
            }
        }
    });
}

if (violations.length) {
    console.error('\n\x1b[31m✗ security-guard: forbidden dynamic-code sink(s) found:\x1b[0m');
    for (const v of violations) console.error('  ' + v);
    console.error('\nRemove eval()/new Function() — they re-open the XSS→RCE chain (CWE-95).');
    process.exit(1);
}

// ── Inline event handlers: a ratchet, not a ban ─────────────────────────────────────
//
// `onclick="..."` in generated HTML only runs because script-src still carries
// 'unsafe-inline' — which is also why an injected `<img src=x onerror=…>` runs, and why a
// single missed escape in this app is code execution rather than a broken layout.
//
// There are 238 of them today, so failing the build outright would fail it on the
// first run. The guard fails only when the number GOES UP: the count can fall to zero at
// whatever pace the migration takes, and cannot quietly climb back while nobody is looking.
// When it reaches 0, turn BASELINE to 0 and this becomes a real ban.
//
// Update BASELINE deliberately, downwards. Raising it is the thing this exists to prevent.
const BASELINE = 238;

// Case-SENSITIVE and lowercase on purpose: HTML attributes in these templates are
// lowercase, while  is ordinary JavaScript. A /i flag counted
// those as inline handlers - 241 of them, which is how an over-wide pattern turns into
// a baseline nobody trusts.
const HANDLER = /\son(?:click|dblclick|mousedown|mouseup|mouseover|mouseout|mouseenter|mouseleave|focus|blur|change|input|submit|load|error|keydown|keyup|keypress|contextmenu|wheel|drop|dragover)\s*=\s*["']/g;

const handlers = [];
for (const file of walk(SRC)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
        // Comments skipped for the same reason as above: a note ABOUT onclick is not one.
        const code = line.replace(/\/\/.*$/, '');
        const found = code.match(HANDLER);
        if (found) handlers.push({ where: `${relative(ROOT, file)}:${i + 1}`, n: found.length, line: line.trim() });
    });
}
const total = handlers.reduce((a, h) => a + h.n, 0);

if (total > BASELINE) {
    console.error(`\n\x1b[31m✗ security-guard: inline event handlers went UP (${total} > ${BASELINE}).\x1b[0m`);
    console.error('  Each one needs script-src \'unsafe-inline\', which is what keeps an injected');
    console.error('  `<img src=x onerror=…>` executable in this app. Use addEventListener instead.');
    console.error('  If you genuinely removed some and the count still rose, the new ones are here:');
    for (const h of handlers.slice(0, 15)) console.error(`    ${h.where}  (${h.n})  ${h.line.slice(0, 90)}`);
    process.exit(1);
}
if (total < BASELINE) {
    console.log(`\x1b[33m! security-guard: inline handlers are down to ${total} (baseline ${BASELINE}).\x1b[0m`);
    console.log('  Lower BASELINE in scripts/security-guard.mjs to lock the gain in.');
} else {
    console.log(`  inline event handlers: ${total} (at baseline; script-src still needs 'unsafe-inline')`);
}

console.log('\x1b[32m✓ security-guard: no eval()/new Function() in frontend/src\x1b[0m');
