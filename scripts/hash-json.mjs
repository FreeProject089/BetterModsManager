/**
 * hash-json.mjs — Hash any JSON file (handles UTF-8, UTF-16 LE/BE with BOM)
 *
 * Usage:
 *   node scripts/hash-json.mjs <path>
 *   node scripts/hash-json.mjs "path with spaces/file.json"
 */

import { createHash } from 'crypto';
import { readFileSync, statSync } from 'fs';
import { resolve, basename } from 'path';

// ── Path — join all args after [2] to handle un-quoted spaces ─────────────────
const args = process.argv.slice(2);
if (!args.length) {
    console.error('Usage: node scripts/hash-json.mjs <file.json>');
    process.exit(1);
}
const filePath = resolve(args.join(' '));

// ── Read as raw bytes ─────────────────────────────────────────────────────────
let buf;
try {
    buf = readFileSync(filePath);
} catch (e) {
    console.error(`Cannot read file: ${filePath}\n${e.message}`);
    process.exit(1);
}

// ── Detect encoding & strip BOM ───────────────────────────────────────────────
let text;
if (buf[0] === 0xFF && buf[1] === 0xFE) {
    // UTF-16 LE BOM
    text = buf.slice(2).toString('utf16le');
} else if (buf[0] === 0xFE && buf[1] === 0xFF) {
    // UTF-16 BE BOM — swap bytes then read as utf16le
    const swapped = Buffer.alloc(buf.length - 2);
    for (let i = 2; i < buf.length - 1; i += 2) {
        swapped[i - 2] = buf[i + 1];
        swapped[i - 1] = buf[i];
    }
    text = swapped.toString('utf16le');
} else if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    // UTF-8 BOM
    text = buf.slice(3).toString('utf8');
} else {
    // Plain UTF-8
    text = buf.toString('utf8');
}

// ── Parse JSON ────────────────────────────────────────────────────────────────
let parsed;
try {
    parsed = JSON.parse(text);
} catch (e) {
    // Show the first 120 chars to help diagnose the issue
    const preview = text.slice(0, 120).replace(/[\r\n]/g, ' ');
    console.error(`\nInvalid JSON in: ${basename(filePath)}`);
    console.error(`Parse error  : ${e.message}`);
    console.error(`File preview : ${preview}\n`);
    process.exit(1);
}

// ── Normalise (sorted keys, compact) so hash is stable regardless of formatting
function sortKeys(_key, value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    }
    return value;
}
const normalised = JSON.stringify(parsed, sortKeys);

// ── SHA-256 ───────────────────────────────────────────────────────────────────
const hash = createHash('sha256').update(normalised, 'utf8').digest('hex');
const normBytes = Buffer.byteLength(normalised, 'utf8');
const rawBytes  = statSync(filePath).size;

// ── Output ────────────────────────────────────────────────────────────────────
const W = 70;
const line = '─'.repeat(W);
const row  = (label, value) => {
    const content = `  ${label.padEnd(10)}: ${value}`;
    return content.length > W ? content.slice(0, W - 1) + '…' : content;
};

console.log('');
console.log('┌' + line + '┐');
console.log(row('File',     basename(filePath)));
console.log(row('Hash',     hash));
console.log(row('Encoding', buf[0] === 0xFF ? 'UTF-16 LE' : buf[0] === 0xFE ? 'UTF-16 BE' : buf[0] === 0xEF ? 'UTF-8 BOM' : 'UTF-8'));
console.log(row('Bytes',    `${normBytes} normalised / ${rawBytes} raw`));
console.log('└' + line + '┘');
console.log('');
console.log('→ Paste into the "hash" field of your repos.json entry:');
console.log('');
console.log(`   "hash": "${hash}"`);
console.log('');
