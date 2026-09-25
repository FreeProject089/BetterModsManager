#!/usr/bin/env node
// Dependency audit gate, used by CI.
//
//   node .github/scripts/dep-audit.mjs npm   <dir>   # npm audit --omit=dev, fails at high/critical
//   node .github/scripts/dep-audit.mjs cargo <dir>   # cargo audit, fails on any vulnerability
//
// <dir> is relative to the repository root. The only way past a reported advisory is an entry in
// .github/audit-ignore.json that names the advisory, the tool, the folder it was judged in, and a
// reason. An entry is scoped to its folders on purpose: judging an advisory unreachable in one app
// says nothing about another app that happens to pull the same package.
//
// Why a script and not the bare commands: `npm audit` has no ignore mechanism at all, and
// `cargo audit --ignore` on a command line keeps no reason next to the ID. The thresholds are the
// commands' own: npm at `--audit-level=high` (high and critical fail; moderate and low are
// printed), cargo at its default (vulnerabilities fail; unmaintained / unsound / yanked warnings
// are printed and do not).
//
// Anything the tool cannot answer (no lockfile, no network, output that is not JSON) FAILS. An
// audit that could not run is not an audit that found nothing.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const [tool, dirArg] = process.argv.slice(2);
if (!['npm', 'cargo'].includes(tool) || !dirArg) {
  console.error('usage: dep-audit.mjs <npm|cargo> <dir relative to repo root>');
  process.exit(2);
}
const dir = resolve(root, dirArg);
const rel = relative(root, dir).split('\\').join('/') || '.';

const ignoreFile = resolve(here, '..', 'audit-ignore.json');
const list = JSON.parse(readFileSync(ignoreFile, 'utf8'));
const entries = (list.ignore || []).filter(e => e.tool === tool && (e.paths || []).includes(rel));
for (const e of entries) {
  if (!e.id || !e.reason || !String(e.reason).trim()) {
    console.error(`::error::audit-ignore.json: entry ${JSON.stringify(e)} has no id or no reason`);
    process.exit(2);
  }
}

// The command lines are constants (no user input), passed as ONE string so the same call works
// where npm is npm.cmd (Windows needs a shell for that) without Node's args-with-shell warning.
function run(cmd, args) {
  const r = spawnSync([cmd, ...args].join(' '), {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    shell: true,
  });
  if (r.error) {
    console.error(`::error::could not run ${cmd}: ${r.error.message}`);
    process.exit(1);
  }
  return r;
}

function parse(r, what) {
  try {
    return JSON.parse(r.stdout);
  } catch {
    console.error(r.stdout?.slice(0, 4000));
    console.error(r.stderr?.slice(0, 4000));
    console.error(`::error::${what} in ${rel} did not produce JSON (exit ${r.status}); the audit did not run`);
    process.exit(1);
  }
}

// Each finding: { id, aliases[], pkg, version, severity, title, url }
let findings = [];
let notes = [];

if (tool === 'npm') {
  const r = run('npm', ['audit', '--omit=dev', '--json']);
  const j = parse(r, 'npm audit');
  if (j.error) {
    console.error(`::error::npm audit in ${rel} failed: ${j.error.code || ''} ${j.error.summary || JSON.stringify(j.error)}`);
    process.exit(1);
  }
  const seen = new Map();
  for (const v of Object.values(j.vulnerabilities || {})) {
    for (const a of v.via || []) {
      if (typeof a !== 'object' || !a.url) continue; // a string = "vulnerable because of <dep>", counted at the dep
      const id = (a.url.match(/GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i) || [String(a.source)])[0];
      if (seen.has(id)) continue;
      seen.set(id, true);
      const f = { id, aliases: [], pkg: a.name, version: a.range, severity: a.severity, title: a.title, url: a.url };
      if (a.severity === 'high' || a.severity === 'critical') findings.push(f);
      else notes.push(`${a.severity} ${a.name} ${id} ${a.title} (below --audit-level=high, not failing)`);
    }
  }
} else {
  const r = run('cargo', ['audit', '--json']);
  const j = parse(r, 'cargo audit');
  for (const v of j.vulnerabilities?.list || []) {
    const a = v.advisory;
    findings.push({
      id: a.id, aliases: a.aliases || [], pkg: v.package.name, version: v.package.version,
      severity: a.cvss ? 'cvss ' + a.cvss : 'vulnerability', title: a.title, url: a.url || `https://rustsec.org/advisories/${a.id}`,
    });
  }
  for (const [kind, arr] of Object.entries(j.warnings || {})) {
    for (const w of arr) notes.push(`${kind} ${w.package.name} ${w.package.version} ${w.advisory?.id || ''} (warning, not failing)`);
  }
}

const matches = (e, f) => e.id === f.id || f.aliases.includes(e.id);
const failing = [];
const ignored = [];
for (const f of findings) {
  const e = entries.find(x => matches(x, f));
  if (e) ignored.push([f, e]);
  else failing.push(f);
}

console.log(`${tool} audit — ${rel}`);
for (const n of notes) console.log(`  note    ${n}`);
for (const [f, e] of ignored) console.log(`  ignored ${f.id} ${f.pkg} ${f.version} — ${e.reason}`);
for (const e of entries) {
  if (!findings.some(f => matches(e, f))) {
    console.log(`::warning::audit-ignore.json: ${e.id} (${tool}, ${rel}) is no longer reported — remove the entry`);
  }
}
for (const f of failing) {
  console.log(`::error::${f.id} ${f.pkg} ${f.version} [${f.severity}] ${f.title} — ${f.url}`);
}
if (failing.length) {
  console.log(`${failing.length} advisory(ies) fail the gate in ${rel}. Fix the dependency, or — only if it is judged`);
  console.log('unreachable, with the reason written down — add it to .github/audit-ignore.json for this folder.');
  process.exit(1);
}
console.log(`OK: no ${tool === 'npm' ? 'high/critical advisory' : 'vulnerability'} left unexplained in ${rel}`);
