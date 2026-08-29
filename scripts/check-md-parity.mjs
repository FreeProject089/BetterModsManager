#!/usr/bin/env node
// The same markdown, rendered by two engines.
//
// A post is written once, on BCWEB, and read in two places: the website, and the Community
// tab / release notes inside BMM. The website parses it with remark-directive; BMM
// down-converts the same directives to constructs `marked` understands. Two implementations
// of one vocabulary, in two repositories, in two languages.
//
// Nothing compared them, and they had drifted by twelve directives. `:::tabs` — the block
// whose entire purpose is "pick the one that is yours" — rendered three stacked panels with
// no strip in BMM. `:::callout` written as `:::check` or `:::error` lost its box entirely:
// not a wrong colour, no frame at all, because those two aliases existed only on the site.
// Every one of these failed the same way: silently, and only for the app.
//
// So the site's vocabulary is written down here and BMM is held to it. The list is not
// guessed — when BCW is checked out beside this repo it is re-derived from the site's
// renderer and compared, so this file cannot quietly age either.
import { readFileSync, existsSync } from 'node:fs';

const BMM = 'frontend/src/ui/rich-markdown.ts';
// The website's renderer, when it is checked out. It is a gitlink with no .gitmodules, so on
// a fresh CI clone it is simply absent — and the run says so out loud rather than reporting
// a comparison it did not make.
const SITE = 'BCW/BCWEB/apps/web/src/markdown/index.jsx';

/**
 * Every directive the website answers to, as of the last time this was refreshed.
 *
 * Refresh by running this check with BCW checked out: a site directive that is not on this
 * list is reported, with the line to paste.
 */
const SITE_DIRECTIVES = [
  'at', 'badge', 'bmmreplay', 'btn', 'button', 'callout', 'card', 'cards', 'caution', 'center',
  'check', 'col', 'collapse', 'column', 'columns', 'custom', 'danger', 'details', 'error',
  'file', 'hint', 'hours', 'icon', 'important', 'info', 'kbd', 'left', 'link', 'note', 'phase',
  'progress', 'ref', 'replay', 'right', 'roadmap', 'row', 'schedule', 'stage', 'step', 'steps',
  'success', 'tab', 'tabs', 'tag', 'time', 'tip', 'toc', 'warning',
];

// Directives BMM deliberately does not implement, each with the reason. An entry here is a
// decision; an absence is a defect. Empty is the goal — and it is currently empty.
const EXCEPT = {};

if (!existsSync(BMM)) { console.error(`✗ ${BMM} is missing — refusing to report success`); process.exit(2); }
const src = readFileSync(BMM, 'utf8');

/** Every name BMM's expander answers to: block branches, callout aliases, inline leaves. */
function bmmDirectives() {
  const names = new Set();
  for (const m of src.matchAll(/name === '([a-z0-9-]+)'/g)) names.add(m[1]);
  const callouts = src.match(/^const CALLOUT_ALERT: Record<string, string> = \{([\s\S]*?)^\};/m);
  if (callouts) for (const m of callouts[1].matchAll(/([a-z0-9-]+):/g)) names.add(m[1]);
  // Inline leaves are regex literals: `/:kbd\[`, `/:(?:badge|tag)\[`, `/:(?:time|at)\[`.
  for (const m of src.matchAll(/\/:(?:\(\?:)?([a-z0-9|-]+)\)?\\\[/g)) for (const n of m[1].split('|')) names.add(n);
  if (/::toc\b/.test(src)) names.add('toc');
  return names;
}

const mine = bmmDirectives();
// Without this, a refactor of the branch style would empty the left-hand side and every
// comparison below would pass by comparing nothing.
if (mine.size < 25) {
  console.error(`✗ only found ${mine.size} directive(s) in ${BMM} — the extractor is stale, so this check cannot be trusted`);
  process.exit(2);
}

const problems = [];

// ── is the written-down list still the site's? ──
if (existsSync(SITE)) {
  const site = readFileSync(SITE, 'utf8');
  const found = new Set();
  for (const m of site.matchAll(/name === '([a-z0-9-]+)'/g)) found.add(m[1]);
  const cal = site.match(/^const CALLOUTS = \{([\s\S]*?)^\};/m);
  if (cal) for (const m of cal[1].matchAll(/([a-z0-9-]+):/g)) found.add(m[1]);
  if (found.size < 30) {
    console.error(`✗ read ${found.size} directive(s) from the site renderer — the extractor is stale`);
    process.exit(2);
  }
  const added = [...found].filter((n) => !SITE_DIRECTIVES.includes(n)).sort();
  const gone = SITE_DIRECTIVES.filter((n) => !found.has(n)).sort();
  if (added.length) problems.push(`the site gained ${added.map((n) => `"${n}"`).join(', ')} — add to SITE_DIRECTIVES in this file, then implement or except`);
  if (gone.length) problems.push(`the site no longer has ${gone.map((n) => `"${n}"`).join(', ')} — remove from SITE_DIRECTIVES`);
} else {
  // Said out loud. A check that quietly skipped its own source of truth would report "OK"
  // for a list nobody had compared to anything in a year.
  console.log(`  · ${SITE} not checked out — comparing against the list written in this file, not against the site`);
}

// ── does BMM render all of it? ──
for (const n of SITE_DIRECTIVES) {
  if (mine.has(n) || EXCEPT[n]) continue;
  problems.push(`the site renders ":::${n}" and BMM does not — implement it, or add it to EXCEPT with the reason`);
}
// An exception that is no longer needed is a comment claiming something untrue.
for (const [n, why] of Object.entries(EXCEPT)) {
  if (mine.has(n)) problems.push(`"${n}" is listed as deliberately unimplemented ("${why}") and BMM implements it — drop the exception`);
}

if (problems.length) {
  console.error('✗ markdown parity:');
  for (const p of problems) console.error(`    ${p}`);
  console.error('\n  One post, two renderers. A directive only one of them knows renders as raw text or');
  console.error('  loses its frame in the app, and only there — which is the half nobody is looking at.');
  process.exit(1);
}
const covered = SITE_DIRECTIVES.filter((n) => mine.has(n)).length;
console.log(`✓ markdown parity OK — ${covered}/${SITE_DIRECTIVES.length} site directive(s) rendered by BMM, ${Object.keys(EXCEPT).length} excepted with a reason`);
