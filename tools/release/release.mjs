#!/usr/bin/env node
// BMM release tool. Entry point: tools/release/release.bat (or `node tools/release/release.mjs`).
//
//   release.bat                                   interactive menu
//   release.bat --all --version 1.0.3 --yes       every step, no questions
//   release.bat --version 1.0.2 --steps preflight,changelog,verify,media --yes
//
// See tools/release/README.md for every option. Nothing here commits, tags, pushes or publishes:
// the last step prints the `gh release create` command for a human to run.

import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import { STEPS } from './steps.mjs';
import { ROOT, releaseDir, ensureDir, writeText, readJson, fmtDuration, listFiles, sha256File, stamp, c } from './lib/util.mjs';
import { Logger } from './lib/exec.mjs';
import { isVersion, bumpVersion } from './lib/version.mjs';
import { formatSums, sumsFilter, SUMS_NAME } from './lib/checksums.mjs';

const HELP = `BMM release tool

  release.bat [options]

  --version X.Y.Z      version to release (default: package.json, or asked)
  --all                every step
  --steps a,b,c        only these steps (ids below, or numbers)
  --yes                no questions: defaults everywhere, stop at the first failure
  --continue           keep going after a failed step
  --from <ref>         start of the commit history (default: detected)
  --previous X.Y.Z     previous version (default: detected)
  --gates              preflight runs npm run ci (all gates + npm test)
  --tests              preflight runs npm test only
  --cargo-test         preflight runs cargo test in src-tauri
  --skip-bmm-build     build: pass -SkipBmmBuild to release.ps1 (reuse the built exe)
  --no-bundles         build: no Tauri NSIS/MSI extras
  --lenient-artifacts  verify: a failed check-release-versions --artifacts is a warning
  --no-compile         media: do not run tsc first (the compiled files must still be newer than the sources)
  --no-screenshots     media: cards only
  --tasky app|br|off   media: Tasky in screenshots (default app: top-left over the window's corner, as in BMM)
  --no-tasky           media: screenshots without Tasky
  --gifs               media: also record the usage GIFs/MP4s (gif-scenes.mjs) into media/gifs/ and the
                       story clips (stories/*.mjs: GIF, step GIFs, MP4, .bmmreplay) into media/stories/
  --bench-skip-run     bench: rebuild the report from results on disk
  --bench-only rust,js,hyperfine,mem
  --gource-seconds N   gource: target length (default 75)
  --no-credits         gource: leave frontend/assets/videos/credits_bg.mp4 alone (gource runs BEFORE build so the installer ships the new one)
  --no-wait            do not wait for an idle machine (skip heavy steps when busy, unless --force)
  --force              run heavy steps even when the machine is busy
  --max-cpu N          bench: other programs may use at most N % CPU (default 10; a game is « busy »)
  --wait-minutes N     how long to wait for an idle machine (default 120)
  -h, --help

Steps:
${STEPS.map((s, i) => `  ${String(i + 1).padStart(2)}. ${s.id.padEnd(10)} ${s.desc}`).join('\n')}
  ${String(STEPS.length + 1).padStart(2)}. summary    RELEASE-SUMMARY.md (always runs last)
`;

function parseArgs(argv) {
  const o = { steps: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    switch (a) {
      case '-h': case '--help': o.help = true; break;
      case '--version': o.version = next(); o.versionGiven = true; break;
      case '--all': o.all = true; break;
      case '--steps': o.steps = next().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--yes': case '-y': o.yes = true; break;
      case '--continue': o.continueOnFail = true; break;
      case '--from': o.from = next(); break;
      case '--previous': o.previous = next(); break;
      case '--gates': o.gates = true; break;
      case '--tests': o.tests = true; break;
      case '--cargo-test': o.cargoTest = true; break;
      case '--skip-bmm-build': o.skipBmmBuild = true; break;
      case '--no-bundles': o.noBundles = true; break;
      case '--lenient-artifacts': o.lenientArtifacts = true; break;
      case '--no-screenshots': o.noScreenshots = true; break;
      case '--tasky': o.tasky = next(); break;
      case '--no-tasky': o.tasky = 'off'; break;
      case '--gifs': o.gifs = true; break;
      case '--bench-skip-run': o.benchSkipRun = true; break;
      case '--bench-only': o.benchOnly = next().split(','); break;
      case '--no-compile': o.noCompile = true; break;
      case '--gource-seconds': o.gourceSeconds = +next(); break;
      case '--no-credits': o.noCredits = true; break;
      case '--no-wait': o.noWait = true; break;
      case '--force': o.force = true; break;
      case '--max-cpu': o.maxCpu = +next(); break;
      case '--wait-minutes': o.waitMinutes = +next(); break;
      default: throw new Error(`unknown option ${a} (see --help)`);
    }
  }
  return o;
}

/** The steps asked for, in the order of STEPS (never the order typed: gource must precede build). */
function resolveSteps(list) {
  const picked = list.map((s) => {
    const byNum = /^\d+$/.test(s) ? STEPS[+s - 1] : null;
    const st = byNum ?? STEPS.find((x) => x.id === s.toLowerCase());
    if (!st) throw new Error(`unknown step « ${s} » (${STEPS.map((x) => x.id).join(', ')})`);
    return st;
  });
  return STEPS.filter((s) => picked.includes(s));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return 0; }
  const interactive = !opts.yes && process.stdin.isTTY;
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const ask = async (q, def = '') => {
    if (!rl) return def;
    const a = (await rl.question(`  ${c.bold('?')} ${q} `)).trim();
    return a || def;
  };

  const pkgVersion = readJson(join(ROOT, 'package.json')).version;
  console.log(`\n${c.bold('BMM release tool')}  ${c.dim(ROOT)}\n  package.json says ${c.cyan(pkgVersion)}\n`);
  if (opts.version && !isVersion(opts.version)) throw new Error(`--version ${opts.version} is not x.y.z`);
  let version = opts.version ?? pkgVersion;
  if (!opts.versionGiven && interactive) {
    const a = await ask(`Version to release (x.y.z, or patch/minor/major/pre) [${version}]`, version);
    version = bumpVersion(pkgVersion, a);
    opts.versionGiven = true;
  }

  let steps;
  if (opts.all) steps = STEPS;
  else if (opts.steps) steps = resolveSteps(opts.steps);
  else if (interactive) {
    console.log(`\n  Steps for ${c.cyan(version)}:`);
    STEPS.forEach((s, i) => console.log(`   ${c.bold(String(i + 1).padStart(2))}  ${s.title.padEnd(24)} ${c.dim(s.desc)}${s.heavy ? c.yellow('  [heavy]') : ''}`));
    console.log(`   ${c.dim(' a  all     q  quit       (the summary always runs last)')}`);
    const a = await ask('Steps to run (e.g. 1,3,5-7 or a)', 'a');
    if (/^q/i.test(a)) { rl?.close(); return 0; }
    if (/^a/i.test(a)) steps = STEPS;
    else steps = resolveSteps(a.split(',').flatMap((x) => { const m = /^(\d+)-(\d+)$/.exec(x.trim()); return m ? Array.from({ length: +m[2] - +m[1] + 1 }, (_, k) => String(+m[1] + k)) : [x.trim()]; }));
  } else { console.log(HELP); return 2; }

  const rel = ensureDir(releaseDir(version));
  const logDir = ensureDir(join(rel, 'logs'));
  const runId = stamp();
  const ctx = { version, root: ROOT, rel, opts, ask, state: {}, log: null };
  const results = [];
  for (const [i, st] of steps.entries()) {
    const n = STEPS.indexOf(st) + 1;
    const log = new Logger(join(logDir, `${runId}_${String(n).padStart(2, '0')}-${st.id}.log`));
    ctx.log = log;
    console.log(`\n${c.bold(`[${i + 1}/${steps.length}] ${st.title}`)} ${c.dim(`(${st.id}, log: Release/${version}/logs/${runId}_${String(n).padStart(2, '0')}-${st.id}.log)`)}`);
    log.line(`# ${st.title} — BMM ${version} — ${new Date().toISOString()}`);
    const t0 = Date.now();
    let res;
    try { res = await st.run(ctx); } catch (e) { res = { ok: false, outputs: [], notes: [`error: ${e.message}`] }; log.line(e.stack ?? String(e)); }
    // A step may change the version (the version step asks for it).
    if (ctx.version !== version) { version = ctx.version; ctx.rel = ensureDir(releaseDir(version)); }
    const ms = Date.now() - t0;
    results.push({ id: st.id, title: st.title, ok: !!res.ok, ms, outputs: res.outputs ?? [], notes: res.notes ?? [], log: log.file });
    for (const nte of res.notes ?? []) console.log(c.dim(`    note: ${nte}`));
    console.log(res.ok ? c.green(`  OK   ${st.title} (${fmtDuration(ms)})`) : c.red(`  FAIL ${st.title} (${fmtDuration(ms)})`));
    log.line(`\n${res.ok ? 'OK' : 'FAIL'} in ${fmtDuration(ms)}`);
    if (!res.ok && i < steps.length - 1) {
      const go = opts.continueOnFail || (interactive && /^y/i.test(await ask('This step failed. Continue with the next steps? [y/N]', 'n')));
      if (!go) { results.push(...steps.slice(i + 1).map((s) => ({ id: s.id, title: s.title, ok: null, ms: 0, outputs: [], notes: ['not run (stopped after a failure)'] }))); break; }
    }
  }
  rl?.close();
  await summary(ctx, results);
  return results.some((r) => r.ok === false) ? 1 : 0;
}

/** Step 12: the table on screen, SHA256SUMS.txt refreshed, RELEASE-SUMMARY.md. */
async function summary(ctx, results) {
  const { version, rel } = ctx;
  const files = listFiles(rel).filter(sumsFilter);
  if (files.length) {
    const entries = [];
    for (const p of files) entries.push({ path: p, sha256: await sha256File(join(rel, p)) });
    writeText(join(rel, SUMS_NAME), formatSums(entries));
  }
  const status = (r) => (r.ok === true ? 'OK' : r.ok === false ? 'FAIL' : 'skipped');
  console.log(`\n${c.bold(`Summary — BMM ${version}`)}`);
  console.log(`  ${'step'.padEnd(24)} ${'result'.padEnd(8)} ${'time'.padStart(10)}  outputs`);
  for (const r of results) {
    const s = status(r);
    const col = s === 'OK' ? c.green : s === 'FAIL' ? c.red : c.dim;
    console.log(`  ${r.title.padEnd(24)} ${col(s.padEnd(8))} ${fmtDuration(r.ms).padStart(10)}  ${r.outputs.slice(0, 3).join(', ')}${r.outputs.length > 3 ? ` (+${r.outputs.length - 3})` : ''}`);
  }
  const md = [`# BMM ${version}: release summary`, '', `Run ${new Date().toISOString()} by \`tools/release\`. Logs: \`Release/${version}/logs/\`.`, '',
    '| Step | Result | Time | Outputs | Notes |', '|---|---|---:|---|---|',
    ...results.map((r) => `| ${r.title} | ${status(r)} | ${fmtDuration(r.ms)} | ${r.outputs.map((o) => `\`${o}\``).join('<br>') || '-'} | ${r.notes.join('<br>') || '-'} |`), '',
    '## Reminders', '',
    '- The GitHub release carries **BMM-Setup.exe as its only installer** (plus bmm.bpkg, update.json, update-manifest.json and the language / links files). BMM 0.9.11 runs the first .msi/.exe of a release: `extras/` (NSIS / MSI) is never uploaded.',
    '- update.json and update-manifest.json expire 7 days after signing: publish within that window or re-sign first.',
    '- Publishing stays manual. Run the command below yourself, after reading `github-release.md`.', ''];
  if (ctx.state.ghCommand) md.push('```bash', ctx.state.ghCommand, '```', '');
  md.push(`Checksums of everything in this folder: \`${SUMS_NAME}\`.`, '');
  writeText(join(rel, 'RELEASE-SUMMARY.md'), md.join('\n'));
  console.log(`\n  ${c.dim(`Release/${version}/RELEASE-SUMMARY.md, Release/${version}/${SUMS_NAME}`)}`);
  console.log(c.dim('  Reminder: only BMM-Setup.exe is published as the installer (0.9.11 runs the first .msi/.exe of a release); extras/ stays off GitHub.\n'));
}

main().then((code) => process.exit(code), (e) => { console.error(c.red(`\n${e.message}`)); process.exit(2); });
