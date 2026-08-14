// check-stack-versions.mjs — the Technical Architecture modal must not lie about versions.
//
// Credits → Technical Architecture lists ~50 crates with a version beside each. Those
// numbers are typed into frontend/src/ui/app.ts; the truth is src-tauri/Cargo.toml. Nothing
// connects the two, so the moment a dependency is bumped the app starts telling people it
// ships a version it does not.
//
// That is a small lie with an outsized reach: this panel is what somebody reads when
// deciding whether a CVE applies to them. "BMM says it uses reqwest 0.11" is a claim, and a
// claim nobody checks is one that eventually becomes false.
//
// Zero drift when this was written, which is exactly when to add the check — a gate written
// after the drift has to be argued for, and one written before is free.
//
// Prefix comparison, not equality: the modal shows "1.0" for "1.0.5" on purpose, because a
// patch number is noise in a credits list. 0.6 against 0.7 is not noise, and that is caught.

import fs from 'node:fs';

const APP = 'frontend/src/ui/app.ts';
const CARGO = 'src-tauri/Cargo.toml';

const app = fs.readFileSync(APP, 'utf8');
const cargo = fs.readFileSync(CARGO, 'utf8');

const listed = [...app.matchAll(/\{ name: "[^"]+", v: "([^"]+)", key: "[^"]+", url: crate\("([^"]+)"\) \}/g)]
  .map((m) => ({ v: m[1], crate: m[2] }));

if (listed.length < 20) {
  console.error(`✗ only ${listed.length} crates parsed out of the stack modal — that is too few to be right`);
  process.exit(2);
}

// Dependency tables only. A version under [package] or [profile] is not a dependency.
const deps = new Map();
let inDeps = false;
for (const line of cargo.split(/\r?\n/)) {
  const t = line.trim();
  if (t.startsWith('[')) { inDeps = /^\[(dependencies|target\..*dependencies|build-dependencies)\]/.test(t); continue; }
  if (!inDeps || !t || t.startsWith('#')) continue;
  const m = t.match(/^([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/);
  if (m) deps.set(m[1], m[2] || m[3]);
}
if (deps.size < 20) {
  console.error(`✗ only ${deps.size} dependencies parsed out of ${CARGO} — refusing to compare against that`);
  process.exit(2);
}

const problems = [];
for (const { v, crate } of listed) {
  const real = deps.get(crate);
  // A crate in the modal that Cargo no longer has is a dependency that was removed and left
  // on screen — the app crediting something it does not ship.
  if (real === undefined) { problems.push(`${crate} is listed in the modal but not in Cargo.toml`); continue; }
  if (!real.startsWith(v) && !v.startsWith(real)) {
    problems.push(`${crate}: the modal says ${v}, Cargo.toml says ${real}`);
  }
}

if (!problems.length) {
  console.log(`✓ Technical Architecture versions match Cargo.toml (${listed.length} crates checked)`);
  process.exit(0);
}
for (const p of problems) console.error(`✗ ${p}`);
console.error('\n  This panel is what somebody reads to decide whether a CVE applies to them.');
console.error(`  Update the list in ${APP}.`);
process.exit(1);
