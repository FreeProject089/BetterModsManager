#!/usr/bin/env node
// CI gate: BMM's own identity must match what the installer ships it as.
//
// BMM is packaged by BetterInstaller, whose examples/bmm/installer.toml declares an `[app].id`.
// That id decides three things: the per-user data directory the installer writes the first-run
// handoff into, the Windows uninstall entry, and how an existing install is recognised on upgrade.
//
// BetterInstaller's GUIDE.md warns about this in bold. It still went wrong: BMM's identifier moved
// from com.bettermm.app to com.bettermm.desktop and installer.toml kept the old one, so the
// installer wrote installer-handoff.json into %APPDATA%\com.bettermm.app while BMM read it from
// %APPDATA%\com.bettermm.desktop. Nothing errored — every choice made in the installer (language,
// terms accepted, telemetry consent, theme import) was simply discarded on any machine where BMM
// already had a data.json.
//
// A warning a human can read and still get wrong is a warning a machine should be checking.
//
// Usage: node scripts/check-installer-config.mjs
// Skips cleanly when BetterInstaller is not checked out beside this repo.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOML = join(ROOT, 'BetterInstaller/examples/bmm/installer.toml');

if (!existsSync(TOML)) {
  console.log('· BetterInstaller not present — skipping the installer-config check');
  process.exit(0);
}

const tauri = JSON.parse(readFileSync(join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const toml = readFileSync(TOML, 'utf8');

/** Read a key from the [app] table only — `id` also appears in every [[components]] entry. */
function appField(name) {
  const start = toml.search(/^\[app\]\s*$/m);
  if (start < 0) return null;
  const rest = toml.slice(start + 5);
  const end = rest.search(/^\[/m);
  const section = end < 0 ? rest : rest.slice(0, end);
  const m = new RegExp(`^\\s*${name}\\s*=\\s*"([^"]*)"`, 'm').exec(section);
  return m ? m[1] : null;
}

const checks = [
  {
    what: 'app identifier',
    ours: tauri.identifier,
    theirs: appField('id'),
    why: 'the installer writes the first-run handoff to %APPDATA%\\<id>; a mismatch silently discards every setup choice',
  },
  {
    what: 'version',
    ours: pkg.version,
    theirs: appField('version'),
    why: 'the installer stamps this into the package and compares it against the installed version on upgrade',
  },
];

let failed = 0;
for (const c of checks) {
  if (c.theirs == null) {
    console.error(`✗ installer.toml has no [app] ${c.what}`);
    failed++;
  } else if (c.ours !== c.theirs) {
    console.error(`✗ ${c.what} does not match`);
    console.error(`    BMM says            : ${c.ours}`);
    console.error(`    installer.toml says : ${c.theirs}`);
    console.error(`    ${c.why}`);
    failed++;
  }
}

// The main executable must actually be the one Tauri produces, or the shortcuts and the
// bmm:// handler point at a file that is not there.
const mainExe = /^\s*main_exe\s*=\s*"([^"]*)"/m.exec(toml)?.[1];
const expected = `${tauri.productName ?? ''}`.trim();
const cargoName = /^name\s*=\s*"([^"]*)"/m.exec(readFileSync(join(ROOT, 'src-tauri/Cargo.toml'), 'utf8'))?.[1];
if (mainExe && cargoName && mainExe !== `${cargoName}.exe`) {
  console.error(`✗ main_exe is "${mainExe}" but cargo builds "${cargoName}.exe"`);
  console.error('    shortcuts and the protocol handler would point at a file that does not exist');
  failed++;
}

if (failed) {
  console.error(`\n✗ ${failed} mismatch(es) between BMM and its installer config`);
  process.exit(1);
}
console.log(`✓ installer config OK (id ${tauri.identifier}, v${pkg.version}, main_exe ${mainExe})`);
