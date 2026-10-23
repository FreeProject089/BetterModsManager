// check-stack-versions.mjs — the Technical stack modal must not lie about versions.
//
// Credits → Technical stack lists what BMM ships, with a version beside each. That panel is
// what somebody reads when deciding whether a CVE applies to them: "BMM says it uses reqwest
// 0.11" is a claim, and a claim nobody checks eventually becomes false.
//
// The list used to be typed into frontend/src/ui/app.ts and this gate compared it with
// src-tauri/Cargo.toml. It is generated now (scripts/gen-credits.mjs →
// frontend/assets/credits-stack.gen.json, with its own --check for freshness), so this gate
// keeps the two promises that matter on their own, independently of the generator:
//
//   · every direct dependency of src-tauri/Cargo.toml is listed, and nothing is listed that
//     Cargo.toml no longer has (a removed crate left on screen is a credit for code BMM does
//     not ship);
//   · each listed version is the one the requirement resolves to: same major (same minor
//     under 1.0), never below it;
//   · nobody typed versions back into app.ts.

import fs from 'node:fs';

const APP = 'frontend/src/ui/app.ts';
const CARGO = 'src-tauri/Cargo.toml';
const GEN = 'frontend/assets/credits-stack.gen.json';

const app = fs.readFileSync(APP, 'utf8');
const cargo = fs.readFileSync(CARGO, 'utf8');
const gen = JSON.parse(fs.readFileSync(GEN, 'utf8'));

const problems = [];
if (/\{\s*name:\s*"[^"]+",\s*v:\s*"[^"]+",\s*key:/.test(app)) problems.push(`${APP} has typed stack rows again: the list comes from ${GEN} (node scripts/gen-credits.mjs)`);

// Direct dependencies, build and target tables included, dev-dependencies not.
const deps = new Map();
let inDeps = false;
for (const line of cargo.split(/\r?\n/)) {
  const t = line.trim();
  if (t.startsWith('[')) { inDeps = /^\[(dependencies|build-dependencies|target\..*\.dependencies)\]/.test(t); continue; }
  if (!inDeps || !t || t.startsWith('#')) continue;
  const m = t.match(/^([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/);
  if (m && !deps.has(m[1])) deps.set(m[1], m[2] || m[3]);
}
if (deps.size < 20) { console.error(`✗ only ${deps.size} dependencies parsed out of ${CARGO}, refusing to compare against that`); process.exit(2); }

const rust = new Map();
for (const g of gen.groups) if (['shell', 'core', 'ai'].includes(g.id)) for (const it of g.items) if (it.url?.startsWith('https://crates.io/')) rust.set(it.name, it.version);
if (rust.size < 20) { console.error(`✗ only ${rust.size} crates in ${GEN}, that is too few to be right`); process.exit(2); }

const nums = (v) => v.replace(/^[=^~]/, '').split('-')[0].split('.').map((x) => parseInt(x, 10) || 0);
for (const [name, req] of deps) {
  const v = rust.get(name);
  if (v === undefined) { problems.push(`${name} is in Cargo.toml but not in the stack modal`); continue; }
  const r = nums(req), x = nums(v);
  const sameLine = r[0] > 0 ? x[0] === r[0] : x[0] === 0 && x[1] === r[1];
  const notBelow = x[0] > r[0] || (x[0] === r[0] && (x[1] > (r[1] || 0) || (x[1] === (r[1] || 0) && x[2] >= (r[2] || 0))));
  if (!sameLine || !notBelow) problems.push(`${name}: the modal says ${v}, Cargo.toml asks for ${req}`);
}
for (const name of rust.keys()) if (!deps.has(name)) problems.push(`${name} is listed in the modal but not in Cargo.toml`);

if (!problems.length) {
  console.log(`✓ Technical stack versions match Cargo.toml (${deps.size} crates checked)`);
  process.exit(0);
}
for (const p of problems) console.error(`✗ ${p}`);
console.error('\n  This panel is what somebody reads to decide whether a CVE applies to them.');
console.error('  Regenerate it: node scripts/gen-credits.mjs');
process.exit(1);
