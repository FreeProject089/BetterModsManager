#!/usr/bin/env node
// Every class the scheduler's markup writes is a class some stylesheet defines.
//
// `.sched-hint` was written nine times in scheduler.ts and defined nowhere. Each one rendered
// as a bare <p>: body size, default paragraph margins, and more visual weight than the fields
// it was explaining — which is why three of the trigger editors were mostly explanation by
// area, and why it read as unfinished rather than as broken.
//
// Nothing could see it. A class with no rule is not an error anywhere: the element renders,
// the page works, and the only symptom is that it looks wrong to somebody who knows what it
// was supposed to look like.
//
// check-css-targets.mjs already walks the other direction (every id SELECTOR resolves to an
// element). This is the missing one: every class ATTRIBUTE resolves to a rule.
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'frontend/src/features/settings/scheduler.ts';
const CSS_DIR = 'frontend/css';
for (const p of [SRC, CSS_DIR]) {
  if (!fs.existsSync(p)) { console.error(`✗ ${p} is missing — refusing to report success`); process.exit(2); }
}

const src = fs.readFileSync(SRC, 'utf8');
const css = fs.readdirSync(CSS_DIR).filter((f) => f.endsWith('.css'))
  .map((f) => fs.readFileSync(path.join(CSS_DIR, f), 'utf8')).join('\n');

// A class in this file has one of two jobs: it is a HOOK the code queries, or it is a style.
// Most of the 300-odd are hooks — `.sched-p-url` exists so a handler can find one input — and
// they have no rule on purpose. Reporting those would mean 297 findings and a check nobody
// keeps.
//
// The bug is the third case: a class that is neither. Never queried, never styled, so it does
// nothing at all — which is what `.sched-hint` was, nine times over.
const inMarkup = new Set();
for (const m of src.matchAll(/class="([^"$]*)"/g)) {
  for (const c of m[1].split(/\s+/)) if (/^sched-[\w-]+$/.test(c)) inMarkup.add(c);
}
// Anything the code looks up by class. Deliberately broad: this file wraps querySelector in
// local helpers (`g('.sched-g-out')`), so keying on `querySelector(` alone reported a hook as
// dead. A class written as a SELECTOR anywhere — `.sched-x` inside any quoted string — is a
// hook, whatever function receives it.
const queried = new Set();
for (const m of src.matchAll(/['"`][^'"`\n]*\.(sched-[\w-]+)/g)) queried.add(m[1]);
for (const m of src.matchAll(/classList\.(?:add|remove|toggle|contains)\(\s*'(sched-[\w-]+)'/g)) queried.add(m[1]);
const used = new Set([...inMarkup].filter((c) => !queried.has(c)));

if (used.size < 20) {
  console.error(`✗ read ${used.size} scheduler class(es) — too few to be right, so this check cannot be trusted`);
  process.exit(2);
}

// Comments stripped first. This check's own explanation names `.sched-hint` in prose, and
// scanning the raw text made that comment satisfy the rule it was explaining — the plant
// passed against a stylesheet with the rule renamed out of existence.
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
const defined = new Set([...cssCode.matchAll(/\.(sched-[\w-]+)/g)].map((m) => m[1]));
const missing = [...used].filter((c) => !defined.has(c)).sort();

if (missing.length) {
  console.error(`✗ ${missing.length} scheduler class(es) that no stylesheet defines:`);
  for (const c of missing) console.error(`    .${c}`);
  console.error('\n  A class with no rule renders as an unstyled element. Nothing errors, and the');
  console.error('  only symptom is that it looks wrong to whoever knows what it should look like.');
  process.exit(1);
}
console.log(`✓ scheduler classes OK — all ${used.size} resolve to a rule`);
