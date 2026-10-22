// The release steps. Each one: { id, title, desc, heavy, run(ctx) } where run resolves
// { ok, outputs: [paths/lines], notes: [lines] } and throws only on an unexpected error.
// ctx = { version, root, rel (Release/<version>), log (Logger), opts, ask(q, def), state }.

import { join, relative, basename } from 'node:path';
import { existsSync, copyFileSync, mkdirSync, readdirSync, rmSync, statSync, readFileSync } from 'node:fs';
import { ROOT, BI_DIR, BPKG, writeText, readText, readJson, sha256File, listFiles, fmtBytes, ensureDir, c } from './lib/util.mjs';
import { run, capture } from './lib/exec.mjs';
import { readVersions, writeVersions, isVersion, bumpVersion, compareVersions } from './lib/version.mjs';
import { headInfo, statusLines, detectPrevious, logRange, gitlinks, hasCommit, remoteUrl, git } from './lib/git.mjs';
import { renderCommitsMd } from './lib/commits.mjs';
import { formatSums, sumsFilter, SUMS_NAME, parseSums } from './lib/checksums.mjs';
import { updateReadme, readmeVersion } from './lib/readme.mjs';
import { renderGithubRelease, ghCommand, orderAssets, assetProblems, GENERATED_MARK } from './lib/notes.mjs';
import { idleReport, cpuLoad } from './lib/idle.mjs';
import { launch } from './lib/browser.mjs';
import { ensureFreshFrontend } from './lib/fresh.mjs';

const rel = (p) => relative(ROOT, p).split('\\').join('/');
const PUBLIC_ASSETS = ['BMM-Setup.exe', 'bmm.bpkg', 'update.json', 'update-manifest.json'];
const changelogPath = (v, lang) => join(ROOT, 'Update', `changelog_v${v}_${lang}.md`);

/** Previous version + the commit the changelog starts from (memoised in ctx.state). */
export function previousOf(ctx) {
  if (ctx.state.prev) return ctx.state.prev;
  let from = ctx.opts.from ?? null, how = null;
  if (!from) {
    // The curated changelog names its start (« Changelog v1.0.2 (since 60b5f6d, the 1.0.1 build) »).
    const cl = changelogPath(ctx.version, 'EN');
    const m = existsSync(cl) ? /\(since ([0-9a-f]{7,40})\b/.exec(readText(cl).split('\n')[0]) : null;
    if (m && git(['rev-parse', '--verify', `${m[1]}^{commit}`], ROOT)) { from = m[1]; how = `the curated changelog says « since ${m[1]} »`; }
  }
  const d = detectPrevious(ROOT, ctx.version, { from, previous: ctx.opts.previous ?? null });
  ctx.state.prev = { ...d, how: how ?? d.how };
  return ctx.state.prev;
}

/**
 * Busy = a build process / held cargo lock, and (cpu: true, for benchmarks) more than --max-cpu %
 * of the machine used by other programs over 5 s (a game, a video call, an indexer).
 */
function busyReport(ctx, cpu) {
  const r = idleReport();
  const why = [...r.procs.map((p) => `${p.name} #${p.pid}`), ...r.locks.map((l) => `lock ${rel(l)}`)];
  if (cpu && !why.length) {
    const load = cpuLoad(5);
    ctx.state.lastLoad = load;
    if (load.total > (ctx.opts.maxCpu ?? 10)) why.push(`CPU ${load.total} % used by ${load.top.slice(0, 3).map((t) => `${t.name} ${t.pct} %`).join(', ')}`);
  }
  return why;
}

async function idleGate(ctx, what, { cpu = false } = {}) {
  let why = busyReport(ctx, cpu);
  if (!why.length) return true;
  ctx.log.warn(`the machine is busy (${why.join(', ')})`);
  if (ctx.opts.noWait) return ctx.opts.force === true;
  const wait = ctx.opts.yes ? true : await ctx.ask(`Wait until it is idle before ${what}? [Y/n]`, 'y').then((a) => !/^n/i.test(a));
  if (!wait) return ctx.opts.force === true || await ctx.ask(`Run ${what} anyway? [y/N]`, 'n').then((a) => /^y/i.test(a));
  const end = Date.now() + (ctx.opts.waitMinutes ?? 120) * 60000;
  while (why.length && Date.now() < end) {
    console.log(c.dim(`    … waiting: ${why.join(', ')}`));
    await new Promise((res) => setTimeout(res, 30000));
    why = busyReport(ctx, cpu);
  }
  if (why.length) ctx.log.warn(`still busy after the wait: ${why.join(', ')}`);
  return !why.length || ctx.opts.force === true;
}

// ── 1. Preflight ─────────────────────────────────────────────────────────────────────────────
const preflight = {
  id: 'preflight', title: 'Preflight', desc: 'git state, previous version, toolchains, version gate (+ npm run ci / cargo test on request)',
  async run(ctx) {
    const notes = [], outputs = [];
    let ok = true;
    const h = headInfo(ROOT);
    ctx.log.info(`  branch ${h.branch}, HEAD ${h.short} (${h.date})`);
    const st = statusLines(ROOT);
    if (st.length) { ctx.log.warn(`working tree not clean: ${st.length} change(s)`); for (const l of st.slice(0, 15)) ctx.log.line('    ' + l); notes.push(`${st.length} uncommitted change(s): the build uses the working tree as it is`); }
    else ctx.log.ok('working tree clean');
    const p = previousOf(ctx);
    ctx.log.info(`  previous version: ${p.previous ?? 'none'}; history starts at ${p.fromRef ? p.fromRef.slice(0, 10) : '?'} (${p.how})`);
    const tools = [
      ['node', process.version], ['npm', capture('npm', ['--version'])], ['rustc', capture('rustc', ['-V'])], ['cargo', capture('cargo', ['-V'])],
      ['tauri cli', capture('npx', ['--no-install', 'tauri', '--version'], { cwd: ROOT })?.split(/\r?\n/).pop()], ['bpkg', existsSync(BPKG) ? capture(BPKG, ['--version']) : null],
      ['gh', capture('gh', ['--version'])?.split(/\r?\n/)[0]], ['python', capture('python', ['--version'])], ['hyperfine', capture('hyperfine', ['--version'])],
      ['ffmpeg', capture((await import('./bench/run.mjs')).findFfmpeg() ?? 'ffmpeg', ['-version'])?.split(/\r?\n/)[0]], ['gource', (await import('./media/gource.mjs')).findGource() ? 'installed' : null],
      ['chrome/edge', (await import('./lib/browser.mjs')).findChrome()],
    ];
    for (const [k, v] of tools) { ctx.log.line(`  ${k}: ${v ?? 'MISSING'}`); console.log(`  ${k.padEnd(12)} ${v ? c.dim(v) : c.yellow('missing')}`); }
    for (const k of ['node', 'npm', 'rustc', 'cargo']) if (!tools.find((t) => t[0] === k)[1]) { ok = false; ctx.log.fail(`${k} is missing`); }
    if (!tools.find((t) => t[0] === 'bpkg')[1]) notes.push('bpkg.exe not built yet: build-installer.ps1 builds it on the first run');
    const vs = readVersions(ROOT);
    for (const v of vs) ctx.log.line(`  ${v.label}: ${v.version ?? (v.missing ? 'missing' : '?')}${v.bom ? ' (BOM!)' : ''}`);
    const gate = await run(process.execPath, ['scripts/check-release-versions.mjs'], { cwd: ROOT, log: ctx.log });
    if (gate.code) { ok = false; ctx.log.fail('check-release-versions: the sources disagree'); }
    if (vs.some((v) => v.bom)) { ok = false; ctx.log.fail('a version file has a byte-order mark'); }
    const pkgV = vs[0].version;
    if (pkgV !== ctx.version) notes.push(`package.json says ${pkgV}, releasing ${ctx.version}: run the version step`);
    for (const lang of ['EN', 'FR']) if (!existsSync(changelogPath(ctx.version, lang))) { ctx.log.warn(`Update/changelog_v${ctx.version}_${lang}.md is missing (human-written)`); notes.push(`changelog ${lang} missing`); }
    const idle = idleReport();
    if (!idle.idle) { ctx.log.warn(`build processes running: ${idle.procs.map((x) => x.name).join(', ')}`); notes.push('machine busy: builds and benchmarks will wait'); }
    if (ctx.opts.gates || (!ctx.opts.yes && await ctx.ask('Run npm run ci (every gate, includes npm test)? [y/N]', 'n').then((a) => /^y/i.test(a)))) {
      const r = await run('npm', ['run', 'ci'], { cwd: ROOT, log: ctx.log });
      if (r.code) { ok = false; ctx.log.fail('npm run ci failed'); } else ctx.log.ok('npm run ci');
    } else if (ctx.opts.tests) {
      const r = await run('npm', ['test'], { cwd: ROOT, log: ctx.log });
      if (r.code) { ok = false; ctx.log.fail('npm test failed'); } else ctx.log.ok('npm test');
    }
    if (ctx.opts.cargoTest || (!ctx.opts.yes && await ctx.ask('Run cargo test in src-tauri (slow)? [y/N]', 'n').then((a) => /^y/i.test(a)))) {
      if (await idleGate(ctx, 'cargo test')) {
        const r = await run('cargo', ['test'], { cwd: join(ROOT, 'src-tauri'), log: ctx.log });
        if (r.code) { ok = false; ctx.log.fail('cargo test failed'); } else ctx.log.ok('cargo test');
      } else notes.push('cargo test skipped (machine busy)');
    }
    return { ok, outputs, notes };
  },
};

// ── 2. Version ───────────────────────────────────────────────────────────────────────────────
const version = {
  id: 'version', title: 'Version', desc: 'show every version source, bump them together (UTF-8, no BOM), run the gate',
  async run(ctx) {
    const vs = readVersions(ROOT);
    for (const v of vs) console.log(`  ${v.label.padEnd(40)} ${v.version ?? c.yellow(v.missing ? 'missing' : '?')}${v.bom ? c.red(' BOM') : ''}`);
    const cur = vs[0].version;
    let target = ctx.version;
    if (!ctx.opts.versionGiven && !ctx.opts.yes) {
      const a = await ctx.ask(`New version (x.y.z, or patch/minor/major/pre) [${target}]`, target);
      target = bumpVersion(cur, a.trim() || target);
      ctx.version = target;
    }
    if (!isVersion(target)) return { ok: false, notes: [`not a version: ${target}`] };
    if (vs.every((v) => v.missing || v.version === target) && !vs.some((v) => v.bom)) { ctx.log.ok(`every source already says ${target}`); return { ok: true, outputs: [], notes: ['nothing to change'] }; }
    if (cur && compareVersions(target, cur) < 0) ctx.log.warn(`${target} is lower than the current ${cur}`);
    if (!ctx.opts.yes && !/^y/i.test(await ctx.ask(`Write ${target} into ${vs.filter((v) => !v.missing).length} files? [y/N]`, 'n'))) return { ok: false, notes: ['cancelled'] };
    const res = writeVersions(ROOT, target);
    for (const r of res) ctx.log.info(`  ${r.changed ? c.green('updated') : c.dim('unchanged')} ${r.file}${r.hadBom ? ' (BOM removed)' : ''}`);
    const gate = await run(process.execPath, ['scripts/check-release-versions.mjs'], { cwd: ROOT, log: ctx.log });
    return { ok: gate.code === 0, outputs: res.filter((r) => r.changed).map((r) => r.file), notes: gate.code ? ['check-release-versions failed after the bump'] : [] };
  },
};

// ── 3. Changelog from commits ────────────────────────────────────────────────────────────────
const changelog = {
  id: 'changelog', title: 'Changelog from commits', desc: 'Release/<v>/COMMITS.md from git log (+ BMM Docs, BetterInstaller, BCW gitlinks)',
  async run(ctx) {
    const p = previousOf(ctx);
    if (!p.fromRef) return { ok: false, notes: [`no start commit (${p.how}); pass --from <ref>`] };
    const to = git(['rev-parse', 'HEAD'], ROOT);
    const main = { from: p.fromRef, to, fromLabel: p.how, commits: logRange(ROOT, `${p.fromRef}..HEAD`), repoUrl: remoteUrl(ROOT) };
    const before = gitlinks(ROOT, p.fromRef), now = gitlinks(ROOT, 'HEAD');
    const subs = [];
    for (const [path, sha] of Object.entries(now)) {
      const dir = join(ROOT, path), old = before[path];
      const s = { name: path, from: old ?? null, to: sha, commits: [], repoUrl: existsSync(dir) ? remoteUrl(dir) : null };
      if (!existsSync(join(dir, '.git'))) s.note = 'not checked out here: log unavailable';
      else if (!old) s.note = 'no pointer recorded at the previous version';
      else if (old === sha) s.note = 'pointer unchanged';
      else if (!hasCommit(dir, old) || !hasCommit(dir, sha)) s.note = 'a recorded commit is missing locally (fetch that repository)';
      else s.commits = logRange(dir, `${old}..${sha}`);
      subs.push(s);
    }
    const md = renderCommitsMd({ version: ctx.version, previous: p.previous, main, subs });
    const out = join(ctx.rel, 'COMMITS.md');
    writeText(out, md);
    ctx.log.ok(`${main.commits.length} commits (+ ${subs.map((s) => `${s.name} ${s.commits.length}`).join(', ')})`);
    const notes = [];
    for (const lang of ['EN', 'FR']) if (!existsSync(changelogPath(ctx.version, lang))) { ctx.log.warn(`Update/changelog_v${ctx.version}_${lang}.md is missing: it stays human-written`); notes.push(`curated changelog ${lang} missing`); }
    return { ok: true, outputs: [rel(out)], notes };
  },
};

// ── 4. Builds ────────────────────────────────────────────────────────────────────────────────
const build = {
  id: 'build', title: 'Builds', heavy: true, desc: 'BetterInstaller release.ps1 (setup, bpkg, signed manifests) + Tauri NSIS/MSI into extras/',
  async run(ctx) {
    const notes = [], outputs = [];
    if (!existsSync(join(BI_DIR, 'examples', 'bmm', 'release.ps1'))) return { ok: false, notes: ['BetterInstaller/examples/bmm/release.ps1 not found'] };
    if (!await idleGate(ctx, 'the build')) return { ok: false, notes: ['machine busy: build not started'] };
    const vs = readVersions(ROOT);
    if (vs[0].version !== ctx.version) return { ok: false, notes: [`package.json says ${vs[0].version}: run the version step first`] };
    // The credits video is bundled into the installer: it must come from the gource step, run before this one.
    const credits = join(ROOT, 'frontend', 'assets', 'videos', 'credits_bg.mp4');
    if (!ctx.state.creditsVideoAt && !ctx.opts.noCredits && existsSync(credits)) {
      const headTime = +git(['log', '-1', '--format=%ct'], ROOT) * 1000;
      if (statSync(credits).mtimeMs < headTime) { ctx.log.warn('credits_bg.mp4 is older than the latest commit: run the gource step BEFORE the build (steps gource,build), or pass --no-credits to ship it as it is'); notes.push('credits video not regenerated before this build'); }
    }
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'examples/bmm/release.ps1', '-Version', ctx.version, '-Notes', `Better Mods Manager ${ctx.version}`];
    if (ctx.opts.skipBmmBuild) args.push('-SkipBmmBuild');
    const r = await run('powershell', args, { cwd: BI_DIR, log: ctx.log });
    if (r.code) return { ok: false, notes: ['release.ps1 failed (see the log)'] };
    // Collect the public assets.
    const R = join(ROOT, 'Release');
    const assets = join(ROOT, 'dist', `release-assets-v${ctx.version}`);
    for (const f of ['BMM-Setup.exe', 'bmm.bpkg', 'update.json']) { copyFileSync(join(R, f), join(ctx.rel, f)); outputs.push(`Release/${ctx.version}/${f}`); }
    if (existsSync(assets)) for (const f of readdirSync(assets)) {
      if (/\.(exe|msi)$/i.test(f)) continue;
      copyFileSync(join(assets, f), join(ctx.rel, f)); outputs.push(`Release/${ctx.version}/${f}`);
    }
    const patch = readdirSync(join(R, 'releases')).find((f) => f.endsWith(`-to-${ctx.version}.patch`));
    if (patch) { copyFileSync(join(R, 'releases', patch), join(ctx.rel, patch)); outputs.push(`Release/${ctx.version}/${patch}`); notes.push(`delta ${patch} copied: publish it only if update.json names it`); }
    // Classic Tauri bundles (NSIS + MSI): extras only, never on the GitHub release.
    if (!ctx.opts.noBundles) {
      const conf = readJson(join(ROOT, 'src-tauri', 'tauri.conf.json'));
      const targets = conf.bundle?.targets;
      ctx.log.info(`  tauri.conf.json bundle.targets = ${JSON.stringify(targets)}, active = ${conf.bundle?.active}`);
      const b = await run('npx', ['tauri', 'build', '--bundles', 'nsis,msi'], { cwd: ROOT, log: ctx.log });
      if (b.code) { notes.push('Tauri NSIS/MSI bundling failed (BMM-Setup.exe is unaffected)'); ctx.log.warn('tauri build --bundles nsis,msi failed'); }
      else {
        const extras = ensureDir(join(ctx.rel, 'extras'));
        for (const kind of ['nsis', 'msi']) {
          const d = join(ROOT, 'src-tauri', 'target', 'release', 'bundle', kind);
          if (!existsSync(d)) continue;
          for (const f of readdirSync(d).filter((x) => x.includes(ctx.version) && /\.(exe|msi)$/i.test(x))) {
            const name = `BMM-${ctx.version}-classic-${kind}${f.endsWith('.msi') ? '.msi' : '-setup.exe'}`;
            copyFileSync(join(d, f), join(extras, name)); outputs.push(`Release/${ctx.version}/extras/${name}`);
          }
        }
        writeText(join(extras, 'README.txt'), `NOT FOR THE GITHUB RELEASE.\r\n\r\nClassic Tauri installers (NSIS, MSI) of BMM ${ctx.version}, for testing or a manual install only.\r\nBMM 0.9.11 runs the FIRST .msi/.exe of a release: the GitHub release must carry BMM-Setup.exe as its only installer.\r\nSee RELEASE.md, « Bridging older installs ».\r\n`);
      }
    }
    notes.push('only BMM-Setup.exe is published as the installer; extras/ stays off the GitHub release');
    return { ok: true, outputs, notes };
  },
};

// ── 5. Verification ──────────────────────────────────────────────────────────────────────────
const verify = {
  id: 'verify', title: 'Verification', desc: 'bpkg verify, verify-manifest --setup, update.json installer SHA-256, check-release-versions --artifacts, SHA256SUMS.txt',
  async run(ctx) {
    const notes = [], outputs = [];
    let ok = true;
    const f = (n) => join(ctx.rel, n);
    const key = join(BI_DIR, 'examples', 'bmm', 'keys', 'public.key');
    const have = (n) => existsSync(f(n));
    for (const n of PUBLIC_ASSETS) if (!have(n)) { ok = false; ctx.log.fail(`${n} missing in Release/${ctx.version}/`); }
    if (existsSync(BPKG) && have('bmm.bpkg')) {
      const info = await run(BPKG, ['info', f('bmm.bpkg')], { log: ctx.log, quiet: true });
      const v = /\bv(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)\b/.exec(info.out)?.[1];
      if (v !== ctx.version) { ok = false; ctx.log.fail(`bpkg info: package says ${v ?? '?'}`); } else ctx.log.ok(`bpkg info: v${v}`);
      const ver = await run(BPKG, existsSync(key) ? ['verify', '--key', key, f('bmm.bpkg')] : ['verify', f('bmm.bpkg')], { log: ctx.log, quiet: true });
      if (ver.code) { ok = false; ctx.log.fail('bpkg verify failed'); } else ctx.log.ok(`bpkg verify${existsSync(key) ? ' (signature)' : ''}: ${ver.out.trim().split(/\r?\n/).pop()}`);
      if (have('update.json') && existsSync(key)) {
        const vm = await run(BPKG, ['verify-manifest', '--key', key, '--app-id', 'com.bettermm.desktop', ...(have('BMM-Setup.exe') ? ['--setup', f('BMM-Setup.exe')] : []), f('update.json')], { log: ctx.log, quiet: true });
        if (vm.code) { ok = false; ctx.log.fail(`bpkg verify-manifest: ${vm.out.trim().split(/\r?\n/).pop()}`); } else ctx.log.ok('bpkg verify-manifest --setup');
      }
    } else notes.push('bpkg.exe or bmm.bpkg missing: package checks skipped');
    const expires = {};
    for (const n of ['update.json', 'update-manifest.json']) {
      if (!have(n)) continue;
      try {
        const d = readJson(f(n)); const body = JSON.parse(d.signed);
        expires[n] = body.expires;
        const left = (Date.parse(body.expires) - Date.now()) / 86400000;
        const line = `${n}: signed version ${body.version}, expires ${body.expires} (${left.toFixed(1)} days left)`;
        if (body.version !== ctx.version) { ok = false; ctx.log.fail(line); } else if (left < 6) { ctx.log.warn(line + ': re-sign at publish time'); notes.push(`${n} expires ${body.expires}`); } else ctx.log.ok(line);
        if (n === 'update.json' && have('BMM-Setup.exe')) {
          const inst = (body.installers ?? []).find((i) => i.path === 'BMM-Setup.exe');
          const sha = await sha256File(f('BMM-Setup.exe'));
          if (!inst) { ok = false; ctx.log.fail('update.json lists no BMM-Setup.exe installer'); }
          else if (inst.sha256 !== sha) { ok = false; ctx.log.fail('update.json: BMM-Setup.exe SHA-256 does not match the file'); }
          else ctx.log.ok('update.json installers[BMM-Setup.exe] matches the file');
        }
        if (n === 'update-manifest.json' && have('BMM-Setup.exe')) {
          const inst = body.installers ?? [];
          const sha = await sha256File(f('BMM-Setup.exe'));
          if (inst.length !== 1 || inst[0].sha256 !== sha) { ok = false; ctx.log.fail('update-manifest.json: installers must be exactly BMM-Setup.exe with its SHA-256'); }
          else ctx.log.ok('update-manifest.json installers = [BMM-Setup.exe], SHA-256 matches');
        }
      } catch (e) { ok = false; ctx.log.fail(`${n}: ${e.message}`); }
    }
    ctx.state.expires = expires;
    const pub = readdirSync(ctx.rel).filter((n) => statSync(join(ctx.rel, n)).isFile() && (PUBLIC_ASSETS.includes(n) || /^lang-.*\.json$|^links\.json$/.test(n)));
    for (const p of assetProblems(pub)) { ok = false; ctx.log.fail(p); }
    // check-release-versions --artifacts reads Release/ and dist/release-assets-v<V>/ (where the build left them).
    // It judges Release/ (root) + dist/, where the build leaves them: only meaningful when they
    // are the files of this folder (another build may have run since; the checks above already
    // cover Release/<v>/ itself).
    const rootSetup = join(ROOT, 'Release', 'BMM-Setup.exe');
    const sameBuild = have('BMM-Setup.exe') && existsSync(rootSetup) && await sha256File(rootSetup) === await sha256File(f('BMM-Setup.exe'));
    if (!sameBuild) { ctx.log.warn(`Release/BMM-Setup.exe is not the one in Release/${ctx.version}/ (another build ran since): check-release-versions --artifacts skipped`); notes.push('check-release-versions --artifacts skipped: Release/ root holds another build'); }
    else if (readVersions(ROOT)[0].version === ctx.version) {
      const g = await run(process.execPath, ['scripts/check-release-versions.mjs', '--artifacts', ...(existsSync(BPKG) ? ['--bpkg', BPKG] : [])], { cwd: ROOT, log: ctx.log });
      if (g.code) { ctx.log.warn('check-release-versions --artifacts failed (see the log): usually manifests signed more than a day ago, re-sign at publish'); notes.push('check-release-versions --artifacts: failed'); if (!ctx.opts.lenientArtifacts) ok = false; }
    } else notes.push('check-release-versions --artifacts skipped: package.json is not at this version');
    // SHA256SUMS.txt over everything in Release/<v>/ (logs excluded).
    const files = listFiles(ctx.rel).filter(sumsFilter);
    const entries = [];
    for (const p of files) entries.push({ path: p, sha256: await sha256File(join(ctx.rel, p)) });
    writeText(join(ctx.rel, SUMS_NAME), formatSums(entries));
    ctx.state.sums = entries;
    outputs.push(`Release/${ctx.version}/${SUMS_NAME} (${entries.length} files)`);
    return { ok, outputs, notes };
  },
};

// ── 6. Docs PDFs ─────────────────────────────────────────────────────────────────────────────
const docs = {
  id: 'docs', title: 'Docs PDFs', heavy: true, desc: 'BMM Docs EN + FR PDFs (mkdocs print page + headless Chrome, no GTK)',
  async run(ctx) {
    if (!await idleGate(ctx, 'the docs build')) return { ok: false, notes: ['machine busy'] };
    const { buildDocsPdfs } = await import('./docs/pdf.mjs');
    const out = await buildDocsPdfs(ctx.version, { log: ctx.log });
    for (const o of out) ctx.log.ok(`${basename(o.file)}: ${fmtBytes(o.size)}${o.pages ? `, ${o.pages} pages` : ''}`);
    return { ok: out.length === 2, outputs: out.map((o) => rel(o.file)), notes: out.length === 2 ? [] : ['a language is missing'] };
  },
};

// ── 7. Media ─────────────────────────────────────────────────────────────────────────────────
const media = {
  id: 'media', title: 'Media', desc: 'compiles the frontend first and fails on a stale build; screenshots of the current app composed like BMM (Tasky top-left), release cards in two variants (with Tasky, plain) × EN/FR, the semi-3D README hero (PNG 1x/2x + MP4/WebM/GIF loop) and the flat one; every layered PSD and SVG in media/source/, each PSD read back and checked; usage GIFs with --gifs',
  async run(ctx) {
    const notes = [], outputs = [];
    const mdir = ensureDir(join(ctx.rel, 'media'));
    const log = { info: (s) => ctx.log.info(s), warn: (s) => ctx.log.warn(s) };
    // The pictures must show the app as it is now: compile, prove the output is current, check the version.
    try {
      const fresh = await ensureFreshFrontend({ log: ctx.log, compile: !ctx.opts.noCompile, version: ctx.version });
      notes.push(...fresh.notes);
    } catch (e) { ctx.log.fail(e.message); return { ok: false, outputs, notes: [`not shooting an old app: ${e.message}`] }; }
    const gh = join(ROOT, '.github', 'screenshots');
    const sdir = join(mdir, 'screenshots');
    // 1. Screenshots first: the cards and the hero are made of them.
    let shots = [];
    if (ctx.opts.noScreenshots) notes.push('screenshots skipped (--no-screenshots): cards and hero use .github/screenshots');
    else {
      const { shoot } = await import('./screenshots/shoot.mjs');
      const r = await shoot({ version: ctx.version, outDir: sdir, tasky: ctx.opts.tasky ?? 'app', log });
      shots = r.shots;
      outputs.push(`Release/${ctx.version}/media/screenshots/ (${r.shots.length} scenes, layers/, source/)`);
      if (r.missing.length) notes.push(`${r.missing.length} mock commands had no demo data (listed in screenshots/layers/missing-mock-commands.txt)`);
    }
    const shotsDirs = [sdir, gh];
    const pngs = {};
    let browser = null;
    try { browser = await launch(); } catch (e) { ctx.log.warn(`no browser: ${e.message} (SVG only)`); }
    try {
      // 2. Cards: every format × with Tasky / plain × EN / FR.
      const { renderCards } = await import('./media/cards.mjs');
      const cr = await renderCards(ctx.version, { outDir: mdir, browser, shotsDirs, log });
      for (const c of cr.cards) if (c.png) pngs[c.file] = c.png;
      ctx.log.ok(`cards: ${cr.cards.length} (${cr.written.length} files)${cr.generic ? ' (GENERIC text)' : ''}`);
      if (cr.generic) notes.push(`cards use generic text: add tools/release/media/cards.${ctx.version}.json`);
      if (cr.missingShots.length) notes.push(`cards drawn without screenshots: ${cr.missingShots.join(', ')}`);
      for (const o of cr.overflow) notes.push(`card ${o.card}: ${o.what} too long`);
      for (const p of cr.wording) notes.push(`card text: ${p}`);
      outputs.push(`Release/${ctx.version}/media/*-tasky|-plain[.fr].png (${cr.cards.length}), source/svg + source/psd`);
      if (!browser) return { ok: true, outputs, notes: [...notes, 'no browser: SVG sources only'] };
      // 3. The semi-3D hero (hero.png, hero@2x.png, the loop) and the flat one (hero-flat.png).
      const { buildHero3d } = await import('./screenshots/hero3d.mjs');
      const { buildHero } = await import('./screenshots/hero.mjs');
      const svgDir = join(mdir, 'source', 'svg'), psdDir = join(mdir, 'source', 'psd');
      ensureDir(sdir);
      const h3 = await buildHero3d({ version: ctx.version, browser, shotsDirs, pngDir: sdir, svgDir, psdDir, loopDir: sdir, loop: !ctx.opts.noLoop, log });
      pngs.hero = h3.png;
      outputs.push(rel(h3.png), rel(h3.png2x), rel(h3.psd));
      if (h3.loop) outputs.push(`${rel(h3.loop.mp4)}, hero.webm, hero.gif (${h3.loop.frames} frames)`);
      else if (!ctx.opts.noLoop) notes.push('hero loop not rendered (no ffmpeg)');
      const flatDir = existsSync(join(sdir, 'library.png')) ? sdir : gh;
      const hf = await buildHero({ version: ctx.version, browser, shotsDir: flatDir, pngDir: sdir, fullSourceDir: svgDir, psdDir, name: 'hero-flat' });
      pngs['hero-flat'] = hf.png;
      outputs.push(rel(hf.png));
      // 4. README copies: the pictures, their layers, linked layered SVGs.
      const ghSrc = ensureDir(join(gh, 'source'));
      ensureDir(join(gh, 'layers'));
      const { screenshotSvg } = await import('./screenshots/shoot.mjs');
      for (const s of shots.filter((x) => x.readme)) {
        copyFileSync(s.png, join(gh, `${s.name}.png`));
        for (const l of ['screen', 'tasky']) if (existsSync(join(sdir, 'layers', `${s.name}.${l}.png`))) copyFileSync(join(sdir, 'layers', `${s.name}.${l}.png`), join(gh, 'layers', `${s.name}.${l}.png`));
        writeText(join(ghSrc, `${s.name}.svg`), screenshotSvg(s.name, s.w, s.h, ctx.version, { tasky: s.tasky }));
      }
      for (const f of ['hero.png', 'hero@2x.png', 'hero-flat.png']) copyFileSync(join(sdir, f), join(gh, f));
      await buildHero3d({ version: ctx.version, browser, shotsDirs: [gh], pngDir: join(mdir, '.gh-hero'), svgDir: join(mdir, '.gh-hero'), psdDir: join(mdir, '.gh-hero'), loop: false, linkedSourceDir: ghSrc, layersDir: join(gh, 'layers'), linkPrefix: '../layers/', log });
      rmSync(join(mdir, '.gh-hero'), { recursive: true, force: true });
      await buildHero({ version: ctx.version, browser, shotsDir: gh, pngDir: join(mdir, '.gh-flat'), linkedSourceDir: ghSrc, linkPrefix: '../', name: 'hero-flat' });
      rmSync(join(mdir, '.gh-flat'), { recursive: true, force: true });
      outputs.push(`.github/screenshots/ (${shots.filter((x) => x.readme).length} pictures, hero.png, hero@2x.png, hero-flat.png, layers/, source/*.svg)`);
      writeText(join(ghSrc, 'README.md'), `# Editable sources of the README pictures\n\nGenerated by \`tools/release\` (media step) for BMM ${ctx.version}.\n\n- \`hero.svg\`: the semi-3D banner, layered (background and grid, the three windows and Tasky as raster layers drawn in perspective, linked from \`../layers/hero.*.png\`, then the wordmark, tagline and version).\n- \`hero-flat.svg\`: the flat banner of earlier releases (\`../hero-flat.png\`), its screenshots linked from \`../\`.\n- \`<name>.svg\`: each screenshot as two layers, *screenshot* and *Tasky*, linked from \`../layers/\`.\n\nLayered **PSD** files of every picture (cards, heroes, screenshots), self-contained, with a README listing their layers, are in \`Release/<version>/media/source/psd/\` (not committed).\n`);
      if (existsSync(join(gh, 'library-light.png'))) notes.push('.github/screenshots/library-light.png is no longer shot (scene removed in 1.0.4): README_EN/README_FR still show it');
    } finally { await browser?.close(); }
    // 5. Every PSD in one place, read back and checked, with a README of their layers.
    const { collectScreenshots, writeSourcesReadme } = await import('./media/sources.mjs');
    for (const s of collectScreenshots({ mediaDir: mdir, shots, version: ctx.version })) pngs[s.name] = s.png;
    const v = writeSourcesReadme({ mediaDir: mdir, version: ctx.version, pngs });
    outputs.push(`Release/${ctx.version}/media/source/ (psd/ ${v.results.length}, svg/, README.md)`);
    if (v.bad.length) { for (const b of v.bad) ctx.log.fail(`${basename(b.file)}: ${b.problems.join('; ')}`); return { ok: false, outputs, notes: [...notes, `${v.bad.length} PSD(s) failed the read-back check`] }; }
    ctx.log.ok(`${v.results.length} PSDs read back: sizes, groups, sRGB profile, composite = PNG`);
    await gifsSubStep(ctx, mdir, outputs, notes);
    return { ok: true, outputs, notes };
  },
};

/** Media, opt-in (--gifs): the usage clips of screenshots/gif-scenes.mjs, GIF + MP4, into
 *  Release/<v>/media/gifs/, and the stories (screenshots/stories/) into media/stories/, for review. Never copied to .github/ here: that is done by hand once
 *  the owner has watched them. */
async function gifsSubStep(ctx, mdir, outputs, notes) {
  if (!ctx.opts.gifs) return;
  const { recordGifs } = await import('./screenshots/gifs.mjs');
  const gdir = join(mdir, 'gifs');
  try {
    const r = await recordGifs({ version: ctx.version, outDir: gdir, previews: true, log: { info: (s) => ctx.log.info(s), warn: (s) => ctx.log.warn(s) } });
    outputs.push(`Release/${ctx.version}/media/gifs/ (${r.clips.length} clips, GIF + MP4, previews/)`);
    for (const c of r.clips.filter((x) => x.overLimit)) notes.push(`${c.name}.gif is over the size limit`);
    for (const x of r.skipped) notes.push(`gif ${x.name} skipped: ${x.why}`);
  } catch (e) { notes.push(`gifs not recorded: ${e.message}`); }
  // The stories: BMM used end to end, one take each, cut into a GIF per step (stories.mjs).
  const { recordStories } = await import('./screenshots/stories.mjs');
  const sdir = join(mdir, 'stories');
  try {
    const r = await recordStories({ version: ctx.version, outDir: sdir, log: { info: (s) => ctx.log.info(s), warn: (s) => ctx.log.warn(s) } });
    outputs.push(`Release/${ctx.version}/media/stories/ (${r.results.length} stories: GIF, MP4, step GIFs, .bmmreplay)`);
    for (const c of r.results.filter((x) => x.overLimit)) notes.push(`${c.name}.gif is over the size limit`);
    for (const x of r.skipped) notes.push(`story ${x.name} skipped: ${x.why}`);
  } catch (e) { notes.push(`stories not recorded: ${e.message}`); }
}

// ── 8. README ────────────────────────────────────────────────────────────────────────────────
const readme = {
  id: 'readme', title: 'README update', desc: 'version badge, hero alt text, changelog links in README / README_EN / README_FR',
  async run(ctx) {
    const outputs = [], notes = [];
    const hasCl = existsSync(changelogPath(ctx.version, 'EN')) && existsSync(changelogPath(ctx.version, 'FR'));
    if (!hasCl) notes.push('curated changelog missing: changelog links left on the previous version');
    for (const f of ['README.md', 'README_EN.md', 'README_FR.md']) {
      const p = join(ROOT, f);
      if (!existsSync(p)) continue;
      const t = readText(p);
      const from = readmeVersion(t);
      const r = updateReadme(t, from, ctx.version, { changelog: hasCl });
      if (r.changes.length) { writeText(p, r.text); outputs.push(f); ctx.log.ok(`${f}: ${from} → ${ctx.version} (${r.changes.join(', ')})`); }
      else ctx.log.info(`  ${f}: already ${from}`);
    }
    if (!existsSync(join(ROOT, '.github', 'screenshots', 'hero.png'))) notes.push('.github/screenshots/hero.png missing: run the media step');
    return { ok: true, outputs, notes };
  },
};

// ── 9. Benchmarks ────────────────────────────────────────────────────────────────────────────
const bench = {
  id: 'bench', title: 'Benchmarks', heavy: true, desc: 'run the suite on an idle machine, compare with the previous version, BENCHMARK.md/_FR.md/.html + charts',
  async run(ctx) {
    if (!ctx.opts.benchSkipRun && !await idleGate(ctx, 'the benchmarks', { cpu: true })) return { ok: false, notes: ['machine busy: benchmarks need an idle machine'] };
    const { benchStep } = await import('./bench/run.mjs');
    const r = await benchStep(ctx.version, { skipRun: !!ctx.opts.benchSkipRun, only: ctx.opts.benchOnly ?? null, log: ctx.log });
    if (r.tally) ctx.log.ok(`vs ${r.previous ?? 'nothing'}: ${r.tally.better} better, ${r.tally.worse} worse, ${r.tally.same} same, ${r.tally.new} new`);
    return { ok: r.ok, outputs: [...(r.files ?? []).filter((f) => !f.startsWith('charts/') || f.endsWith('.gif')).map((f) => `Release/${ctx.version}/bench/${f}`), r.summaryPath ? rel(r.summaryPath) : null].filter(Boolean), notes: r.problems ?? [] };
  },
};

// ── 10. Gource ───────────────────────────────────────────────────────────────────────────────
const gource = {
  id: 'gource', title: 'Gource + credits video', heavy: true, desc: 'history video of BMM + sibling repos (file names, BMM logo, no captions: MP4, GIF, poster) and the credits background video, BEFORE the build so the installer ships it',
  async run(ctx) {
    if (!await idleGate(ctx, 'the Gource render')) return { ok: false, notes: ['machine busy'] };
    const { renderGource } = await import('./media/gource.mjs');
    const { findFfmpeg } = await import('./bench/run.mjs');
    const r = await renderGource({ version: ctx.version, seconds: ctx.opts.gourceSeconds ?? 75, credits: !ctx.opts.noCredits, ffmpeg: findFfmpeg(), log: ctx.log });
    const notes = [`${r.repos.join(', ')}: ${r.events} file events, ${r.authors} author(s), ${r.avatars.length} local avatar(s)`];
    if (r.credits?.text) { notes.push(r.credits.text); ctx.state.creditsVideoAt = Date.now(); }
    else if (ctx.opts.noCredits) notes.push('credits_bg.mp4 left alone (--no-credits): the build ships the one in the tree');
    ctx.log.ok(`gource-${ctx.version}.mp4 ${r.info?.width}×${r.info?.height}, ${r.info?.duration?.toFixed(1)} s, ${fmtBytes(r.info?.size)}`);
    return { ok: true, outputs: [r.mp4, r.gif, r.poster, r.credits?.path].filter(Boolean).map(rel), notes };
  },
};

// ── 11. Release notes / GitHub draft ─────────────────────────────────────────────────────────
const notesStep = {
  id: 'notes', title: 'Release notes', desc: 'github-release.md (maintainer header + curated changelog + checksums) and the gh command (printed only)',
  async run(ctx) {
    const notes = [], outputs = [];
    const names = orderAssets(readdirSync(ctx.rel).filter((n) => statSync(join(ctx.rel, n)).isFile() && (PUBLIC_ASSETS.includes(n) || /^lang-.*\.json$|^links\.json$/.test(n))));
    if (!names.length) return { ok: false, notes: [`no assets in Release/${ctx.version}/: run the build step`] };
    const assets = [];
    for (const n of names) assets.push({ name: n, sha256: await sha256File(join(ctx.rel, n)), size: statSync(join(ctx.rel, n)).size });
    const clp = changelogPath(ctx.version, 'EN');
    if (!existsSync(clp)) notes.push('curated changelog EN missing: the body says so');
    let expires = ctx.state.expires ?? {};
    for (const n of ['update.json', 'update-manifest.json']) if (!expires[n] && existsSync(join(ctx.rel, n))) { try { expires[n] = JSON.parse(readJson(join(ctx.rel, n)).signed).expires; } catch { /* unsigned */ } }
    const h = headInfo(ROOT);
    const md = renderGithubRelease({ version: ctx.version, previous: previousOf(ctx).previous, commit: h.commit, branch: h.branch, assets, changelog: existsSync(clp) ? readText(clp) : null, expires });
    let file = join(ctx.rel, 'github-release.md');
    if (existsSync(file) && !readText(file).startsWith(GENERATED_MARK)) {
      file = join(ctx.rel, 'github-release.generated.md');
      notes.push('github-release.md is hand-edited: the generated draft went to github-release.generated.md');
    }
    writeText(file, md);
    const body = join(ctx.rel, 'github-release.body.md');
    writeText(body, md.slice(md.indexOf('-->') + 3).replace(/^\s+/, ''));
    outputs.push(rel(file), rel(body));
    for (const p of assetProblems(names)) { ctx.log.fail(p); notes.push(p); }
    const cmd = ghCommand(ctx.version, names, `Release/${ctx.version}/github-release.body.md`);
    ctx.state.ghCommand = cmd;
    console.log(`\n  ${c.bold('Publish (manual, not run):')}\n  ${c.cyan(cmd)}\n`);
    ctx.log.line(`gh command (not run): ${cmd}`);
    return { ok: assetProblems(names).length === 0, outputs, notes };
  },
};

// gource sits BEFORE build: it regenerates frontend/assets/videos/credits_bg.mp4, which the
// build bundles into the installer. After build, the shipped credits video would be the old one.
export const STEPS = [preflight, version, changelog, gource, build, verify, docs, media, readme, bench, notesStep];
