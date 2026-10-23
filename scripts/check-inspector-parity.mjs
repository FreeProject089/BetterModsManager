// check-inspector-parity.mjs — BMM's .bmmpa reader and BCWEB's must agree on what is risky.
//
// The same file is inspected in two places by two implementations: BMM's
// frontend/src/features/settings/bmmpa-inspect.ts, and BCWEB's moderation copy at
// apps/api/src/lib/bmmpa.mjs. They are deliberate duplicates — the moderation queue cannot
// import from a Tauri frontend — which means they drift, and drift here is not cosmetic.
// A moderator approving an automation is relying on the server's reader having noticed
// what the desktop's reader notices. If BMM learns that `custom.command` carries runnable
// code and BCWEB does not, the queue quietly stops showing moderators the payload.
//
// So: extract the two lists that decide what gets flagged, and diff them. Extracting them
// from the source rather than restating them here is the whole point — a list typed into
// this file would be a third copy to keep in agreement.
//
// BCW is an unregistered gitlink. A checkout without it is normal, and this reports that
// it skipped rather than passing silently: "OK" for a comparison that never ran is exactly
// the lie the gate exists to prevent.

import fs from 'node:fs';

const TS = 'frontend/src/features/settings/bmmpa-inspect.ts';
const MJS = 'BCW/BCWEB/apps/api/src/lib/bmmpa.mjs';

if (!fs.existsSync(MJS)) {
  console.log(`⊘ inspector parity SKIPPED — ${MJS} not present (BCW is an unregistered gitlink)`);
  process.exit(0);
}
if (!fs.existsSync(TS)) { console.error(`✗ ${TS} is missing — refusing to report success`); process.exit(2); }

const read = (f) => fs.readFileSync(f, 'utf8');

// The REACHING_ACTIONS set: every action type that touches the world outside BMM.
function reaching(src, file) {
  const m = src.match(/REACHING_ACTIONS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  if (!m) { console.error(`✗ could not find REACHING_ACTIONS in ${file} — the gate cannot compare what it cannot read`); process.exit(2); }
  return new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
}

// Which action types each reader pulls a runnable body out of. Found by looking for the
// equality tests that guard a push into `scripts`, so renaming an action without updating
// both readers shows up here.
function bodied(src) {
  return new Set([...src.matchAll(/type === '([^']+)'/g)].map((x) => x[1]));
}

const ts = read(TS), mjs = read(MJS);
const problems = [];

const cmp = (label, a, b) => {
  const onlyBmm = [...a].filter((x) => !b.has(x));
  const onlyWeb = [...b].filter((x) => !a.has(x));
  if (onlyBmm.length) problems.push(`${label}: only BMM flags ${onlyBmm.join(', ')} — moderators would not see it`);
  if (onlyWeb.length) problems.push(`${label}: only BCWEB flags ${onlyWeb.join(', ')} — BMM's own inspector is the quieter one`);
};

// Which action types each reader treats as naming ANOTHER thing by id. Added after the
// gate passed a change it should have caught: the two readers gained a detailed view at
// different times, and nothing here compared it. A reader that does not know `task.run`
// points at a task shows a moderator a step with an opaque id where the other shows the
// name of the automation it calls.
function refs(src, file) {
  const m = src.match(/REF_ACTIONS[^=]*=\s*\{([\s\S]*?)\}/);
  if (!m) { console.error(`✗ could not find REF_ACTIONS in ${file} — the gate cannot compare what it cannot read`); process.exit(2); }
  return new Set([...m[1].matchAll(/'([^']+)':/g)].map((x) => x[1]));
}

cmp('reaching actions', reaching(ts, TS), reaching(mjs, MJS));
cmp('actions carrying code', bodied(ts), bodied(mjs));
cmp('id references', refs(ts, TS), refs(mjs, MJS));

// Which reference kinds each reader can RESOLVE against what the file carries.
//
// Separate from the map above, and it had to be: BCWEB knew `plugin.apply` names a plugin
// and still had no way to resolve one, because the two live in different places. So a
// moderator saw the id and never the name, and every existing check was green — the readers
// agreed about the QUESTION and disagreed about the ANSWER.
function resolvable(src, file) {
  const m = src.match(new RegExp('const included[^=]*=\\s*\\{([\\s\\S]*?)\\n\\s*};'));
  if (!m) { console.error(`✗ could not find the resolution set in ${file} — the gate cannot compare what it cannot read`); process.exit(2); }
  return new Set([...m[1].matchAll(/^\s*([a-z]+):/gm)].map((x) => x[1]));
}
cmp('resolvable references', resolvable(ts, TS), resolvable(mjs, MJS));



// The THIRD copy, and the one that decides what a file actually contains.
//
// The two readers above agreed with each other and were both wrong: the scheduler had
// learned that `plugin.apply` names a plugin and was collecting the manifest into
// `includes.plugins`, while neither inspector knew such a reference existed. The file
// carried the plugin; both reviewers showed an opaque id and no way to resolve it.
//
// Comparing readers to each other cannot catch that. This compares them to the WRITER.
const SCHED = 'frontend/src/features/settings/scheduler.ts';
if (fs.existsSync(SCHED)) {
  const schedRefs = refs(read(SCHED), SCHED);
  const inspRefs = refs(ts, TS);
  const onlyWriter = [...schedRefs].filter((x) => !inspRefs.has(x));
  const onlyReader = [...inspRefs].filter((x) => !schedRefs.has(x));
  if (onlyWriter.length) {
    problems.push(`id references: the scheduler collects ${onlyWriter.join(', ')} but neither inspector resolves it — the file carries the thing and every reviewer sees a bare id`);
  }
  if (onlyReader.length) {
    problems.push(`id references: the inspectors expect ${onlyReader.join(', ')} but the scheduler never collects it — the reference can only ever read as unresolved`);
  }
} else {
  console.error(`✗ ${SCHED} is missing — refusing to report success on a comparison that did not run`);
  process.exit(2);
}

// And the KEYS. A reader that resolves `block` against `includes.blocks` is useless if the
// writer never fills that key in, and the reverse is a payload nobody reads. `block` is not
// in REF_ACTIONS at all — it comes from a `call` STEP, not an action — so the comparison
// above cannot see it, and this is the only thing that can.
if (fs.existsSync(SCHED)) {
  const schedSrc = read(SCHED);
  const written = new Set([...schedSrc.matchAll(/includes\.([a-z]+)\s*=/g)].map((m) => m[1]));
  const readKeys = new Set([...ts.matchAll(/includes\?\.([a-z]+)/g)].map((m) => m[1]));
  if (!written.size || !readKeys.size) {
    console.error('✗ could not read the includes keys from one side — refusing to report success');
    process.exit(2);
  }
  for (const k of written) {
    if (!readKeys.has(k)) problems.push(`includes: the scheduler writes \`includes.${k}\` and no inspector reads it — the payload travels and nobody sees it`);
  }
  for (const k of readKeys) {
    if (!written.has(k)) problems.push(`includes: the inspectors read \`includes.${k}\` and the scheduler never writes it — it can only ever read as unresolved`);
  }
}
// RISK_KEYS drives the permission badges. Both readers emit these codes and the two UIs
// translate them, so a code added on one side renders as a bare identifier on the other.
const riskTs = new Set([...(read(TS).match(/RISK_KEYS\s*=\s*\[([\s\S]*?)\]/)?.[1] || '').matchAll(/'([^']+)'/g)].map((x) => x[1]));
const riskWeb = new Set([...(read(MJS).match(/RISK_KEYS\s*=\s*\[([\s\S]*?)\]/)?.[1] || '').matchAll(/'([^']+)'/g)].map((x) => x[1]));
if (riskTs.size && riskWeb.size) cmp('permission codes', riskTs, riskWeb);

if (!problems.length) {
  console.log('✓ .bmmpa readers agree with each other AND with the scheduler that writes the file');
  process.exit(0);
}
for (const p of problems) console.error(`✗ ${p}`);
console.error('\n  The two readers are deliberate duplicates and must be edited together.');
process.exit(1);
