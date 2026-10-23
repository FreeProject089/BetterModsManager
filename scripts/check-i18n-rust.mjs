// Translation keys the RUST side sends to the screen must exist in both languages.
//
// A Tauri command reports failure as `Err("repo.errNoExistingRepo".to_string())`, and the
// frontend hands that string to t(). t() returns the KEY on a miss, so an untranslated one is
// not a fallback in English — it is the literal string `repo.errNoExistingRepo` rendered in a
// toast, in both languages.
//
// Nothing checked this. check-i18n-keys.mjs reads t() calls in TypeScript and cannot see a key
// that only ever exists as a Rust literal; check-i18n-attrs.mjs reads index.html. On the day
// this was written the two gaps together were hiding eighteen keys, six of them from the
// key-authorisation work shipped the day before.
//
// WHAT COUNTS AS A KEY, and why the shape rather than a list: a dotted literal whose last
// segment is camelCase — `repo.errWriteFile`, `repo.ssh.errRelPath`, `repo.keyauth.errFormat`.
// That deliberately excludes the dotted strings Rust is full of which are NOT keys: file names
// (`repo.json`, `docker-compose.yml`), hosts, MIME types and version numbers, none of which
// have a camelCase tail. Measured when written: 54 candidates, 0 false positives.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const en = JSON.parse(readFileSync(join(root, 'frontend/Lang/en.json'), 'utf8'));
const fr = JSON.parse(readFileSync(join(root, 'frontend/Lang/fr.json'), 'utf8'));

function rustFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...rustFiles(p));
    else if (name.endsWith('.rs')) out.push(p);
  }
  return out;
}

const KEY = /"([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)"/g;
const camelTail = (k) => /^[a-z][a-zA-Z0-9]*[A-Z]/.test(k.split('.').pop());

const found = new Map(); // key -> "file:line"
for (const file of rustFiles(join(root, 'src-tauri/src'))) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(KEY)) {
    const key = m[1];
    if (!camelTail(key) || found.has(key)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    found.set(key, `${file.slice(root.length + 1).replace(/\\/g, '/')}:${line}`);
  }
}

const missing = [];
for (const [key, where] of found) {
  const inEn = Object.prototype.hasOwnProperty.call(en, key);
  const inFr = Object.prototype.hasOwnProperty.call(fr, key);
  if (!inEn || !inFr) missing.push({ key, where, from: !inEn && !inFr ? 'en + fr' : (inEn ? 'fr' : 'en') });
}

if (missing.length) {
  console.error(`✗ ${missing.length} key(s) emitted by the Rust side do not resolve:`);
  for (const x of missing) console.error(`    ${x.key}  (${x.where}) — missing from ${x.from}`);
  console.error('');
  console.error('  t() returns the key itself on a miss, so this string reaches the user as');
  console.error('  written — in both languages. Add it to frontend/Lang/en.json and fr.json.');
  process.exit(1);
}

console.log(`✓ all ${found.size} Rust-emitted translation key(s) resolve in en + fr`);
