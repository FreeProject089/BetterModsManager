#!/usr/bin/env node
// An action that ASKS for a private key must DO something with it.
//
// `credsFields(params, { key: true })` draws a chooser listing the key ring. Naming a key
// there sets `params.keyName`, and the only thing that turns that into a signed request is
// `applyCredsFor(url, params)` in the runner — it binds the key to the host before the fetch.
//
// Without that call the chooser works perfectly: it lists the ring, it remembers the choice,
// it survives a save and a reload. The request goes out unsigned, the server answers 401, and
// the task reports that it could not read the catalogue. Nothing points at the key.
//
// That is exactly what `catalog.import` and `catalog.follow` did.
//
// The check joins three things that live far apart in one 10 000-line file: the action
// registry (type → needs), the form (needs → does it offer a key), and the runner
// (case type → does it bind one).
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'src', 'features', 'settings', 'scheduler.ts');
if (!existsSync(SRC)) { console.error(`✗ ${SRC} is missing — refusing to report success`); process.exit(2); }
const text = readFileSync(SRC, 'utf8');

// ── 1. type → needs, from the registry ──
const byNeeds = new Map();
for (const m of text.matchAll(/\{\s*v:\s*'([\w.]+)'[^}]*?needs:\s*'(\w+)'/g)) {
  if (!byNeeds.has(m[2])) byNeeds.set(m[2], []);
  byNeeds.get(m[2]).push(m[1]);
}
if (byNeeds.size < 20) {
  console.error(`✗ read ${byNeeds.size} needs from the registry — too few to be right, so this check cannot be trusted`);
  process.exit(2);
}

// ── 2. which forms offer a key ──
// The form for a `needs` starts at its branch and ends at the next one.
const branches = [...text.matchAll(/(?:else )?if \(needs === '(\w+)'\)/g)].map((m) => ({ needs: m[1], at: m.index }));
const offersKey = new Set();
for (let i = 0; i < branches.length; i++) {
  const body = text.slice(branches[i].at, branches[i + 1]?.at ?? text.length);
  if (/credsFields\([^)]*key:\s*true/.test(body)) offersKey.add(branches[i].needs);
}
if (!offersKey.size) {
  console.error('✗ no form offers a key at all — credsFields moved, and this check cannot be trusted');
  process.exit(2);
}

// ── 3. which runners bind one ──
const cases = [...text.matchAll(/case '([\w.]+)':/g)].map((m) => ({ type: m[1], at: m.index }));
const binds = new Set();
for (let i = 0; i < cases.length; i++) {
  const body = text.slice(cases[i].at, cases[i + 1]?.at ?? cases[i].at + 4000);
  if (/applyCredsFor\(/.test(body)) binds.add(cases[i].type);
}

const problems = [];
for (const needs of offersKey) {
  for (const type of byNeeds.get(needs) || []) {
    if (!binds.has(type)) {
      problems.push(`"${type}" offers a key chooser (needs: ${needs}) and its runner never calls applyCredsFor — the key is remembered and never used`);
    }
  }
}

// And the reverse, which is cheaper to be wrong about but still wrong: a runner that binds a
// key for an action whose form cannot name one is binding `params.keyName` that nothing sets.
const keyTypes = new Set([...offersKey].flatMap((n) => byNeeds.get(n) || []));
for (const type of binds) {
  if (!keyTypes.has(type)) {
    problems.push(`"${type}" binds a key in its runner and its form has no key chooser — nothing can set params.keyName`);
  }
}

if (problems.length) {
  console.error('✗ credentials:');
  for (const p of problems) console.error(`    ${p}`);
  console.error('\n  A key chooser with no applyCredsFor is a field that works, remembers your');
  console.error('  choice, and changes nothing about the request. The task just says it could');
  console.error('  not read the source.');
  process.exit(1);
}
console.log(`✓ credentials OK — ${keyTypes.size} action(s) offer a key and every one binds it`);
