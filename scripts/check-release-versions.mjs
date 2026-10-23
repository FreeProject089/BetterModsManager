#!/usr/bin/env node
// check-release-versions — one version, everywhere a release states it.
//
// WHY THIS EXISTS
//
// The release published as « 1.0.1 » announced itself as 1.0.0: package.json and
// tauri.conf.json said 1.0.1, but Cargo.toml and BetterInstaller's installer.toml still said
// 1.0.0, so the setup, bmm.bpkg and the signed update.json all carried 1.0.0. Installed 1.0.0
// copies were never offered it (1.0.0 is not newer than 1.0.0), and nothing failed loudly.
//
// Source mode (npm run ci):
//   package.json · package-lock.json (root + packages[""]) · src-tauri/tauri.conf.json ·
//   src-tauri/Cargo.toml [package] · src-tauri/Cargo.lock (better-mods-manager) ·
//   BetterInstaller/examples/bmm/installer.toml [app] (skipped when BetterInstaller is absent).
//
// --artifacts (the release, after npm run release:assets, before anything is published):
//   Release/update.json        signed body: app id, version, SHA-256 of Release/bmm.bpkg, and
//                              signed NOW (at least 6 of its 7 days left: an update.json signed
//                              at build time can expire before people see the release);
//   Release/bmm.bpkg           `bpkg info` reports the version (when bpkg.exe is found);
//   dist/release-assets-v<V>/update-manifest.json
//                              signed, version V, `installers` = exactly BMM-Setup.exe with the
//                              SHA-256 of Release/BMM-Setup.exe, signed now as well;
//   and ONE installer among the assets: BMM 0.9.11 runs the first .msi/.exe of a release.
//
// Usage: node scripts/check-release-versions.mjs [--artifacts] [--bpkg <bpkg.exe>]

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const artifacts = argv.includes('--artifacts');
const bpkgArg = (() => { const i = argv.indexOf('--bpkg'); return i >= 0 ? argv[i + 1] : null; })();

const problems = [];
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const pkg = JSON.parse(read('package.json'));
const V = pkg.version;
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(V ?? '')) {
  console.error(`✗ package.json version ${JSON.stringify(V)} is not x.y.z`);
  process.exit(1);
}

/** `key = "value"` inside the `[table]` section of a TOML text, or null. */
function tomlField(text, table, key) {
  const start = text.search(new RegExp(`^\\[${table.replace('.', '\\.')}\\]\\s*$`, 'm'));
  if (start < 0) return null;
  const rest = text.slice(start).replace(/^[^\n]*\n/, '');
  const end = rest.search(/^\[/m);
  const section = end < 0 ? rest : rest.slice(0, end);
  return new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm').exec(section)?.[1] ?? null;
}

const sources = [];
const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));
sources.push(['src-tauri/tauri.conf.json', tauri.version]);
sources.push(['src-tauri/Cargo.toml [package]', tomlField(read('src-tauri/Cargo.toml'), 'package', 'version')]);
if (existsSync(join(ROOT, 'package-lock.json'))) {
  const lock = JSON.parse(read('package-lock.json'));
  sources.push(['package-lock.json', lock.version]);
  sources.push(['package-lock.json packages[""]', lock.packages?.['']?.version]);
}
if (existsSync(join(ROOT, 'src-tauri/Cargo.lock'))) {
  const m = /\[\[package\]\]\r?\nname = "better-mods-manager"\r?\nversion = "([^"]+)"/.exec(read('src-tauri/Cargo.lock'));
  sources.push(['src-tauri/Cargo.lock', m?.[1] ?? null]);
}
const TOML = 'BetterInstaller/examples/bmm/installer.toml';
if (existsSync(join(ROOT, TOML))) sources.push([`${TOML} [app]`, tomlField(read(TOML), 'app', 'version')]);
else console.log('· BetterInstaller not present: installer.toml not compared');

for (const [where, v] of sources) {
  if (v == null) problems.push(`${where}: no version found`);
  else if (v !== V) problems.push(`${where} says ${v}, package.json says ${V}`);
}

if (artifacts) {
  const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
  const now = Date.now();
  const DAY = 86_400_000;
  const signedBody = (path, label) => {
    let doc;
    try { doc = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { problems.push(`${label}: unreadable (${e.message})`); return null; }
    if (typeof doc.signed !== 'string' || typeof doc.signature !== 'string') { problems.push(`${label}: not signed`); return null; }
    const body = JSON.parse(doc.signed);
    if (body.app_id !== tauri.identifier) problems.push(`${label}: app_id ${body.app_id}, BMM is ${tauri.identifier}`);
    if (body.version !== V) problems.push(`${label}: signed version ${body.version}, release is ${V}`);
    if (doc.version !== undefined && doc.version !== V) problems.push(`${label}: top-level version ${doc.version} (older clients read it), release is ${V}`);
    const left = Date.parse(body.expires) - now;
    if (!(left >= 6 * DAY)) problems.push(`${label}: expires ${body.expires}; sign it at publish time (at least 6 of its 7 days left)`);
    return body;
  };

  const REL = join(ROOT, 'Release');
  const setup = join(REL, 'BMM-Setup.exe');
  const bpkgFile = join(REL, 'bmm.bpkg');
  for (const f of [setup, bpkgFile, join(REL, 'update.json')]) if (!existsSync(f)) problems.push(`${f} is missing`);

  if (existsSync(join(REL, 'update.json'))) {
    const body = signedBody(join(REL, 'update.json'), 'Release/update.json');
    if (body && existsSync(bpkgFile) && body.sha256 !== sha(bpkgFile)) problems.push('Release/update.json: its sha256 is not the one of Release/bmm.bpkg (signed for another package)');
  }

  const bpkgExe = bpkgArg ?? ['BetterInstaller/target/release/bpkg.exe', 'betterinstaller-src/target/release/bpkg.exe'].map((p) => join(ROOT, p)).find(existsSync);
  if (bpkgExe && existsSync(bpkgFile)) {
    const info = execFileSync(bpkgExe, ['info', bpkgFile], { encoding: 'utf8' });
    const m = /\bv(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)\b/.exec(info);
    if (m?.[1] !== V) problems.push(`Release/bmm.bpkg: bpkg info says ${m?.[1] ?? 'no version'}, release is ${V}`);
  } else if (existsSync(bpkgFile)) {
    console.log('· bpkg.exe not found: bmm.bpkg version read from update.json only');
  }

  const dir = join(ROOT, 'dist', `release-assets-v${V}`);
  const mf = join(dir, 'update-manifest.json');
  if (!existsSync(mf)) problems.push(`${mf} is missing: npm run release:assets`);
  else {
    const body = signedBody(mf, 'update-manifest.json');
    if (body) {
      const inst = body.installers ?? [];
      if (inst.length !== 1 || inst[0].path !== 'BMM-Setup.exe') problems.push(`update-manifest.json: installers must be exactly [BMM-Setup.exe], got [${inst.map((i) => i.path).join(', ')}]`);
      else {
        const url = `https://github.com/FreeProject089/BetterModsManager/releases/download/v${V}/BMM-Setup.exe`;
        if (inst[0].download_url !== url) problems.push(`update-manifest.json: installer URL ${inst[0].download_url}, expected ${url}`);
        if (existsSync(setup) && inst[0].sha256 !== sha(setup)) problems.push('update-manifest.json: the installer SHA-256 is not the one of Release/BMM-Setup.exe');
      }
    }
    const extra = readdirSync(dir).filter((f) => /\.(exe|msi)$/i.test(f) && f !== 'BMM-Setup.exe');
    if (extra.length) problems.push(`dist/release-assets-v${V}/ holds other installers (${extra.join(', ')}): 0.9.11 would run one of them`);
  }
}

if (problems.length) {
  console.error(`✗ release versions disagree (package.json ${V}):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`✓ one version everywhere: ${V} (${sources.length + 1} sources${artifacts ? ', release artefacts signed and matching' : ''})`);
