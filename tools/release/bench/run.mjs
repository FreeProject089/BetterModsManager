// Release step « bench »: run the suite, store this version's results, compare with the
// previous version, write the report into Release/<version>/bench/.
//
//   node tools/release/bench/run.mjs --version 1.0.4 [--skip-run] [--only rust,js,hyperfine,mem]
//
// --skip-run reuses whatever raw results are on disk (re-generates the report only).

import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { BENCH, RESULTS, collectAll, snapshotRaw, machineInfo, span } from './collect.mjs';
import { writeReport } from './report.mjs';
import { run, capture } from '../lib/exec.mjs';
import { ROOT, writeJson, releaseDir } from '../lib/util.mjs';
import { compareVersions, isVersion } from '../lib/version.mjs';
import { git } from '../lib/git.mjs';
import { launch } from '../lib/browser.mjs';
import { cpuLoad } from '../lib/idle.mjs';

export const FFMPEG_CANDIDATES = [process.env.FFMPEG, 'C:/ffmpeg/bin/ffmpeg.exe', 'C:/Program Files/ffmpeg/bin/ffmpeg.exe'];
export function findFfmpeg() {
  const p = FFMPEG_CANDIDATES.find((x) => x && existsSync(x));
  if (p) return p;
  return capture('where', ['ffmpeg'])?.split(/\r?\n/)[0] || null;
}

/** The newest summary of a version lower than `version` (results/<v>/summary.json), or from git history. */
export function findPrevious(version) {
  // A summary marked `valid: false` (run on a busy machine) is never a baseline.
  const usable = (d) => { try { return JSON.parse(readFileSync(join(RESULTS, d, 'summary.json'), 'utf8')).valid !== false; } catch { return false; } };
  const local = existsSync(RESULTS) ? readdirSync(RESULTS).filter((d) => isVersion(d) && compareVersions(d, version) < 0 && existsSync(join(RESULTS, d, 'summary.json')) && usable(d)) : [];
  local.sort(compareVersions);
  if (local.length) return { summary: JSON.parse(readFileSync(join(RESULTS, local.at(-1), 'summary.json'), 'utf8')), from: `benchmarks/results/${local.at(-1)}/summary.json` };
  // Not on disk: a committed summary in history (e.g. a fresh clone where results/ was cleaned).
  const listed = git(['log', '--all', '--format=', '--name-only', '--', 'benchmarks/results/*/summary.json'], ROOT) || '';
  const cands = [...new Set(listed.split(/\r?\n/).filter(Boolean))].map((p) => ({ p, v: p.split('/')[2] })).filter((x) => isVersion(x.v) && compareVersions(x.v, version) < 0).sort((a, b) => compareVersions(a.v, b.v));
  if (cands.length) {
    const t = git(['show', `HEAD:${cands.at(-1).p}`], ROOT);
    if (t) return { summary: JSON.parse(t), from: `git HEAD:${cands.at(-1).p}` };
  }
  return { summary: null, from: null };
}

export const CAVEATS = {
  en: [
    'Benchmarks ran on one desktop machine with other programs closed; a laptop on battery, another disk or another antivirus gives different absolute numbers. Compare the deltas, not the absolute values, with your own machine.',
    'The previous version\'s numbers were measured on the same workstation but at an earlier date, possibly with an older Rust/Node toolchain and different Windows updates: part of a small delta can come from the toolchain or the OS, not from BMM.',
    'Disk-bound benchmarks (extraction, copy, hashing, end-to-end) depend on the file cache: fixtures are warm (read once before timing), which is the case for a mod you just downloaded, not for a cold boot.',
    'The memory collector runs each operation once; its times have no interval and only changes beyond ±15 % are called better or worse.',
    'Some suites keep an OLD implementation next to the current one (« shipped » in the interface suites is the pre-optimisation code kept as a baseline); the current app runs the « optimized » rows.',
    'Benchmarks new in this version have no previous value: they start the history the next release compares against.',
  ],
  fr: [
    'Les mesures ont tourné sur un seul PC de bureau, autres programmes fermés ; un portable sur batterie, un autre disque ou un autre antivirus donnent d\'autres valeurs absolues. Comparez les écarts, pas les valeurs absolues, avec votre machine.',
    'Les chiffres de la version précédente viennent de la même machine mais d\'une date antérieure, peut-être avec d\'anciens outils Rust/Node et d\'autres mises à jour Windows : une partie d\'un petit écart peut venir des outils ou du système, pas de BMM.',
    'Les mesures liées au disque (extraction, copie, hachage, bout en bout) dépendent du cache fichiers : les jeux de test sont « chauds » (lus une fois avant la mesure), comme un mod qu\'on vient de télécharger, pas comme après un démarrage à froid.',
    'Le collecteur mémoire exécute chaque opération une seule fois ; ses temps n\'ont pas d\'intervalle et seuls les écarts au-delà de ±15 % sont jugés.',
    'Certaines séries gardent une ANCIENNE implémentation à côté de l\'actuelle (« shipped » dans les séries de l\'interface est le code d\'avant optimisation, gardé comme référence) ; l\'application actuelle exécute les lignes « optimized ».',
    'Les mesures nouvelles dans cette version n\'ont pas de valeur précédente : elles ouvrent l\'historique que la prochaine version comparera.',
  ],
};

/** Run the suites (each optional), returning [{ name, code }]. */
export async function runSuites(only, log) {
  const want = (k) => !only || only.includes(k);
  const res = [];
  const rustDir = join(BENCH, 'rust');
  if (want('rust')) res.push({ name: 'cargo bench (Criterion)', code: (await run('cargo', ['bench'], { cwd: rustDir, log })).code });
  if (want('mem')) res.push({ name: 'memory collector', code: (await run('cargo', ['run', '--release', '--bin', 'bmm-bench-mem'], { cwd: rustDir, log })).code });
  if (want('js')) res.push({ name: 'JS micro-benchmarks', code: (await run(process.execPath, ['bench.mjs'], { cwd: join(BENCH, 'js'), log })).code });
  if (want('hyperfine')) {
    if (!capture('hyperfine', ['--version'])) { log?.warn('hyperfine not installed: end-to-end suite skipped'); res.push({ name: 'hyperfine', code: 'skipped' }); }
    else res.push({ name: 'hyperfine (end to end)', code: (await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(BENCH, 'hyperfine', 'run.ps1')], { cwd: BENCH, log })).code });
  }
  return res;
}

/** The whole step. Returns { ok, outDir, files, tally, previous, problems }. */
export async function benchStep(version, { skipRun = false, only = null, log = null, invalid = null, maxCpu = 10 } = {}) {
  const problems = [];
  let suites = [];
  let load = null;
  if (!skipRun) {
    // Other programs' CPU use around the run goes into the summary: a busy machine is visible.
    load = { before: cpuLoad(5) };
    suites = await runSuites(only, log);
    load.after = cpuLoad(5);
    for (const s of suites) if (s.code !== 0 && s.code !== 'skipped') problems.push(`${s.name} exited ${s.code}`);
  }
  const metrics = collectAll();
  if (!metrics.length) return { ok: false, problems: ['no benchmark results on disk'], files: [] };
  const dir = join(RESULTS, version);
  snapshotRaw(dir);
  const head = git(['rev-parse', 'HEAD'], ROOT);
  const summary = { schema: 1, version, capturedAt: span(metrics), commit: head, machine: { ...machineInfo(), otherCpuBefore: load ? `${load.before.total} %${load.before.top[0] ? ` (top: ${load.before.top[0].name})` : ''}` : null, otherCpuAfter: load ? `${load.after.total} %` : null }, suites, caveats: CAVEATS,
    metrics: metrics.map(({ rawDir, ...m }) => m) };
  // Validity: a run next to a busy machine (other programs above maxCpu % before or after) is
  // kept for the record but marked invalid, so it is never the baseline of the next release.
  let previousMark = null;
  try { const old = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')); if (old.valid === false) previousMark = old.invalidReason; } catch { /* first run */ }
  const peak = load ? Math.max(load.before.total, load.after.total) : 0;
  const busy = load && peak > maxCpu ? `other programs used ${peak} % CPU around the run (${load.before.top.slice(0, 2).map((x) => x.name).join(', ')})` : null;
  const reason = invalid ?? busy ?? (skipRun ? previousMark : null);
  if (reason) { summary.valid = false; summary.invalidReason = reason; log?.warn?.(`results marked INVALID: ${reason}`); }
  writeJson(join(dir, 'summary.json'), summary);
  const prev = findPrevious(version);
  log?.info(prev.summary ? `previous results: ${prev.summary.version} (${prev.from})` : 'no previous results found');
  let browser = null;
  try { browser = await launch(); } catch (e) { log?.warn(`charts as SVG only: ${e.message}`); }
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) log?.warn('ffmpeg not found: no animated GIF (set FFMPEG or install it)');
  const outDir = join(releaseDir(version), 'bench');
  try {
    const r = await writeReport(outDir, prev.summary, summary, { browser, ffmpeg, log });
    return { ok: problems.length === 0, outDir, files: r.files, tally: r.tally, previous: prev.summary?.version ?? null, problems, summaryPath: join(dir, 'summary.json') };
  } finally { await browser?.close(); }
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('run.mjs')) {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const v = get('--version') ?? JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const r = await benchStep(v, { skipRun: a.includes('--skip-run'), only: get('--only')?.split(','), invalid: get('--invalid'), log: { info: console.log, warn: (s) => console.log('! ' + s), line() {}, write() {} } });
  console.log(r);
  process.exit(r.ok ? 0 : 1);
}
