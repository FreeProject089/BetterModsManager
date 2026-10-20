// The media step shoots the app as it is NOW: frontend/ served as it stands (the same files
// Tauri bundles into the build, so no build is needed for media). The UI is TypeScript in
// frontend/src compiled to frontend/js, and a stale compiled file would put an old screen in
// a release picture. So the media step (1) compiles, (2) refuses to go on when any compiled
// file is missing or older than its source, (3) refuses to caption a picture with a version
// the sources do not say, and (4) shows what scripts/check-compiled-fresh.mjs thinks (that
// gate compares the compiled files with HEAD: on a dirty tree it is information, not failure).

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from './util.mjs';
import { run } from './exec.mjs';
import { readVersions } from './version.mjs';

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Sources of src/ whose compiled file in out/ is missing or older. Pure apart from reading mtimes. */
export function staleOutputs(srcDir = join(ROOT, 'frontend', 'src'), outDir = join(ROOT, 'frontend', 'js')) {
  const stale = [];
  for (const f of walk(srcDir)) {
    const out = join(outDir, relative(srcDir, f).replace(/\.ts$/, '.js'));
    if (!existsSync(out)) { stale.push({ src: f, out, why: 'not compiled' }); continue; }
    // 2 s of slack: some file systems round mtimes.
    if (statSync(out).mtimeMs + 2000 < statSync(f).mtimeMs) stale.push({ src: f, out, why: 'older than its source' });
  }
  return stale;
}

/** The version every source agrees on, or throws saying which ones disagree with `version`. */
export function assertSourceVersion(version, root = ROOT) {
  const bad = readVersions(root).filter((v) => !v.missing && v.version !== version).map((v) => `${v.label} says ${v.version ?? '?'}`);
  if (bad.length) throw new Error(`the pictures would say ${version} but the sources do not: ${bad.join('; ')} (run the version step first)`);
}

/**
 * Compile the frontend and prove the result is current. Throws a sentence on any failure.
 * Returns { notes: [...] }.
 * opts: { log, compile = true, version }
 */
export async function ensureFreshFrontend({ log, compile = true, version = null } = {}) {
  const notes = [];
  if (version) assertSourceVersion(version);
  if (compile) {
    const r = await run('npx', ['tsc', '--project', 'frontend'], { cwd: ROOT, log });
    if (r.code) throw new Error('npx tsc --project frontend failed: the pictures would show an old build (see the log)');
    log?.ok?.('frontend compiled (npx tsc --project frontend)');
  } else log?.warn?.('compile skipped (--no-compile): relying on the compiled files on disk');
  const stale = staleOutputs();
  if (stale.length) throw new Error(`${stale.length} compiled file(s) are stale against their source (${stale.slice(0, 3).map((s) => `${relative(ROOT, s.out).split('\\').join('/')}: ${s.why}`).join('; ')}${stale.length > 3 ? '; …' : ''})`);
  const g = await run(process.execPath, ['scripts/check-compiled-fresh.mjs'], { cwd: ROOT, log, quiet: true });
  if (g.code) {
    const first = g.out.split(/\r?\n/).filter((l) => /^\s+frontend\/js/.test(l)).length;
    notes.push(`check-compiled-fresh: ${first} compiled file(s) differ from HEAD (expected on a dirty tree; commit them with the source)`);
  } else log?.ok?.('check-compiled-fresh: compiled files match HEAD');
  return { notes };
}
