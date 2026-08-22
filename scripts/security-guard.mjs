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
// frontend/src is now at ZERO (238 before the delegation work), so for that tree this is a
// real ban rather than a ratchet: any new inline handler fails the build.
//
// index.html is counted SEPARATELY and is not at zero. It was outside this guard entirely
// until the src count reached 0 and the remaining blocker turned out to be a file the guard
// never looked at -- 216 handlers, invisible because the walk only covered src. A guard
// reporting 0 while 216 sat in the entry document is worse than no guard, so it is measured
// here, out loud, with its own descending baseline.
//
// Update either baseline deliberately, downwards. Raising one is the thing this exists to
// prevent.
const BASELINE = 0;
const BASELINE_INDEX = 0;
const INDEX_HTML = join(ROOT, 'frontend', 'index.html');

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

// index.html carries its own handlers, and its own count. Comments are not stripped here:
// the file is HTML, where `//` starts nothing.
let indexTotal = 0;
try {
    indexTotal = (readFileSync(INDEX_HTML, 'utf8').match(HANDLER) || []).length;
} catch { /* no index.html: nothing to measure */ }

if (indexTotal > BASELINE_INDEX) {
    console.error(`\n\x1b[31m\u2717 security-guard: inline handlers in index.html went UP (${indexTotal} > ${BASELINE_INDEX}).\x1b[0m`);
    process.exit(1);
}
if (indexTotal < BASELINE_INDEX) {
    console.log(`\x1b[33m! security-guard: index.html is down to ${indexTotal} (baseline ${BASELINE_INDEX}).\x1b[0m`);
    console.log('  Lower BASELINE_INDEX in scripts/security-guard.mjs to lock the gain in.');
} else {
    console.log(`  index.html inline handlers: ${indexTotal} (at baseline)`);
}

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
} else if (BASELINE === 0) {
    console.log('\x1b[32m\u2713 security-guard: no inline event handlers in frontend/src\x1b[0m');
} else {
    console.log(`  inline event handlers: ${total} (at baseline; script-src still needs 'unsafe-inline')`);
}

// A handler does not have to be written as an attribute to BE one. Three sites built them
// at runtime with setAttribute('onmouseenter', '...'), which the attribute pattern above
// cannot see and which the strict CSP blocks exactly like the written ones -- silently.
// This is the check that would have caught them.
const RUNTIME = /\.setAttribute\s*\(\s*['"`]on[a-z]+['"`]/g;
const runtime = [];
for (const file of walk(SRC)) {
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (line.replace(/\/\/.*$/, '').match(RUNTIME)) {
            runtime.push(`${relative(ROOT, file)}:${i + 1}  ${line.trim().slice(0, 90)}`);
        }
    });
}
if (runtime.length) {
    console.error(`\n\x1b[31m\u2717 security-guard: ${runtime.length} handler(s) built at runtime via setAttribute('on...').\x1b[0m`);
    console.error("  These need script-src 'unsafe-inline' just like written attributes, and the");
    console.error('  strict CSP blocks them without an error. Assign a dataset property instead.');
    for (const r of runtime) console.error(`    ${r}`);
    process.exit(1);
}
console.log('\x1b[32m\u2713 security-guard: no handlers built at runtime\x1b[0m');

if (total === 0 && indexTotal === 0) {
    console.log("  both trees are clean -- script-src can drop 'unsafe-inline' in frontend/index.html.");
}

console.log('\x1b[32m✓ security-guard: no eval()/new Function() in frontend/src\x1b[0m');
