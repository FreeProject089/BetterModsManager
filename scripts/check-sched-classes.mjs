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

// ── and the case the exemption above lets through ──
//
// A class can be a hook AND a container. `.sched-tr-cond` was queried — so it counted as a
// hook and needed no rule — and it was the box `conditionEditor()` is appended into. That
// editor emits a NOT checkbox, a dropdown, a params span and a Try button as siblings and
// lays out none of them; the six other mount points are `.sched-cond`, which is
// `display:flex; gap:6px`. The trigger's was styled by nothing, so they touched.
//
// Anything a component is APPENDED into is a container, whatever else it is.
const mounts = new Set();
for (const m of src.matchAll(/querySelector\(\s*'\.(sched-[\w-]+)'\s*\)\s*\??\.appendChild\(/g)) {
  mounts.add(m[1]);
}
if (!mounts.size) {
  console.error('✗ no `.sched-*` mount points found — the appendChild pattern moved, so this half cannot be trusted');
  process.exit(2);
}
// A mount point styled through ANY of the classes on its element counts as styled: the fix
// here was `class="sched-cond sched-tr-cond"`, where the first carries the layout and the
// second stays as the hook it always was.
const coMounted = new Set();
for (const m of src.matchAll(/class="([^"$]*)"/g)) {
  const classes = m[1].split(/\s+/).filter((c) => /^sched-[\w-]+$/.test(c));
  if (classes.some((c) => mounts.has(c)) && classes.some((c) => defined.has(c))) {
    for (const c of classes) if (mounts.has(c)) coMounted.add(c);
  }
}
const bareMounts = [...mounts].filter((c) => !defined.has(c) && !coMounted.has(c)).sort();

if (missing.length || bareMounts.length) {
  if (missing.length) {
    console.error(`✗ ${missing.length} scheduler class(es) that no stylesheet defines:`);
    for (const c of missing) console.error(`    .${c}`);
    console.error('\n  A class with no rule renders as an unstyled element. Nothing errors, and the');
    console.error('  only symptom is that it looks wrong to whoever knows what it should look like.');
  }
  if (bareMounts.length) {
    console.error(`✗ ${bareMounts.length} mount point(s) with no layout of their own:`);
    for (const c of bareMounts) console.error(`    .${c} — a component is appended into it and nothing lays its children out`);
    console.error('\n  Being queried is not enough. A box something is appended into is a container,');
    console.error('  and an unstyled container puts the component\'s children in inline flow.');
  }
  process.exit(1);
}
console.log(`✓ scheduler classes OK — ${used.size} resolve to a rule, ${mounts.size} mount point(s) laid out`);
