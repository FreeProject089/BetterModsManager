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

console.log('\x1b[32m✓ security-guard: no eval()/new Function() in frontend/src\x1b[0m');
