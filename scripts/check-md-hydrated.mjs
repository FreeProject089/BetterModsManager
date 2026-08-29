#!/usr/bin/env node
// md-lite renders a schedule card with a BLANK heading, on purpose. Somebody has to fill it.
//
// The renderer cannot speak the reader's language and cannot attach behaviour — it is a string
// function. So two of its blocks arrive deliberately incomplete: the schedule card carries an
// empty title and an empty note, and the tab strip is inert markup. `hydrateMdLite` finishes
// both, and every surface that paints md-lite output has to call it.
//
// One did not. A PLUGIN's documentation goes through the same renderer from
// `features/plugins/plugin-assets.ts`, was never hydrated, and drew a card with no heading at
// all — and inside the app's own docs, `paint()` writes a hand-written article body and was a
// third site nothing covered. Neither failed loudly: a blank heading looks like an author who
// did not write one.
//
// The rule is mechanical and has exactly two terms, which is why it is worth a check where the
// scheduler's three-list join was not: a file that renders must also hydrate.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'frontend/src';
if (!existsSync(ROOT)) { console.error(`✗ ${ROOT} is missing — refusing to report success`); process.exit(2); }

/** Every .ts under frontend/src. */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const RENDERER = 'frontend/src/docs/md-lite.ts';
const HYDRATOR = 'frontend/src/docs/md-hydrate.ts';

const renders = [];
for (const f of walk(ROOT)) {
  const norm = f.replace(/\\/g, '/');
  if (norm === RENDERER || norm === HYDRATOR) continue;
  // COMMENTS STRIPPED. Commenting the call out leaves its name on the line, and the first
  // version of this check went green against exactly that — the third time in one day a gate
  // here matched the prose explaining a call instead of the call.
  const src = readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  // A call, not the import line: importing it and never calling it renders nothing.
  const calls = [...src.matchAll(/\brenderDocMarkdown\s*\(/g)].length;
  if (calls) renders.push({ file: norm, calls, hydrates: /\bhydrateMdLite\s*\(/.test(src) });
}

if (!renders.length) {
  // The premise is that somebody renders. If nobody does, this check is measuring nothing.
  console.error('✗ nothing calls renderDocMarkdown — the extractor is stale, so this cannot be trusted');
  process.exit(2);
}

const problems = renders.filter((r) => !r.hydrates)
  .map((r) => `${r.file} renders md-lite (${r.calls} call(s)) and never calls hydrateMdLite`);

if (problems.length) {
  console.error('✗ md-lite surfaces:');
  for (const p of problems) console.error(`    ${p}`);
  console.error('\n  The schedule card ships with a blank heading for the caller to fill, and a blank');
  console.error('  heading reads as an author who did not write one — not as a missing step.');
  process.exit(1);
}
const total = renders.reduce((n, r) => n + r.calls, 0);
console.log(`✓ md-lite surfaces OK — ${renders.length} file(s), ${total} render site(s), each hydrated`);
