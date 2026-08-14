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

cmp('reaching actions', reaching(ts, TS), reaching(mjs, MJS));
cmp('actions carrying code', bodied(ts), bodied(mjs));

// RISK_KEYS drives the permission badges. Both readers emit these codes and the two UIs
// translate them, so a code added on one side renders as a bare identifier on the other.
const riskTs = new Set([...(read(TS).match(/RISK_KEYS\s*=\s*\[([\s\S]*?)\]/)?.[1] || '').matchAll(/'([^']+)'/g)].map((x) => x[1]));
const riskWeb = new Set([...(read(MJS).match(/RISK_KEYS\s*=\s*\[([\s\S]*?)\]/)?.[1] || '').matchAll(/'([^']+)'/g)].map((x) => x[1]));
if (riskTs.size && riskWeb.size) cmp('permission codes', riskTs, riskWeb);

if (!problems.length) {
  console.log('✓ .bmmpa inspectors agree (reaching actions, code-bearing actions, permission codes)');
  process.exit(0);
}
for (const p of problems) console.error(`✗ ${p}`);
console.error('\n  The two readers are deliberate duplicates and must be edited together.');
process.exit(1);
