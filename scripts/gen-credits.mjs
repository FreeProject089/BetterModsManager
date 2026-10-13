#!/usr/bin/env node
// gen-credits.mjs — the credits' technical stack, read from the manifests, never typed.
//
// Credits → Technical stack used to be ~60 rows typed into app.ts: names, versions, links. It
// drifted the usual way (a dozen crates added since were missing, the AI stack was absent, the
// versions were requirements rather than what ships). This writes
// frontend/assets/credits-stack.gen.json from what the repository itself says:
//
//   Rust app        src-tauri/Cargo.toml (direct dependencies, build-dependencies, target
//                   tables; not dev-dependencies) → resolved version from src-tauri/Cargo.lock
//                   → licence, description and repository from the crate's own Cargo.toml in
//                   the cargo registry
//   npm             package.json → package-lock.json (version + licence), description from
//                   node_modules/<name>/package.json
//   vendored        the licence banner at the top of each bundled file (frontend/assets/vendor,
//                   frontend/js/lib, frontend/assets/cropper); a bundle identical to an
//                   installed npm package takes that package's version and licence
//   AI              laya-model.lock.json (model id, licence, pinned revision; ONNX Runtime)
//   icons & fonts   frontend/assets/icons/iso/LICENSES.txt, the Google Fonts URL in index.html
//   BMM Docs        BMM Docs/requirements.in (pins)
//   BetterInstaller BetterInstaller/Cargo.toml [workspace.dependencies] → its Cargo.lock
//   BetterCommunity BCW/BCWEB/apps/{web,api,bot}/package.json → each package-lock.json
//
// A licence no manifest here states (fonts, the icon data, a bundle without a banner, the
// Python packages) comes from scripts/credits-licenses.json, where each one names the upstream
// file it was read from. A value that cannot be read on this machine (no cargo registry, no
// BCW checkout) is carried over from the previous output for the same name AND version, so the
// check is stable on a machine without them; a NEW dependency with no readable licence fails.
//
// Links and licence texts. Each entry also carries its source repository / homepage (the
// crate's `repository` / `homepage`, the npm package's `repository` / `homepage`) and the
// licence FILES shipped inside the package (LICENSE*, COPYING*, NOTICE* at its root, read from
// the cargo registry or node_modules). The texts go to frontend/assets/credits-licenses.gen.json,
// deduplicated by content hash (two hundred crates share a handful of Apache-2.0 texts); an
// entry points at them with `lic: [{ f: file name, id: hash }]`. Optional: a package whose
// files this machine cannot read keeps the previous output's texts for the same name+version,
// and one that never had any simply shows its SPDX id.
//
// Contributors. `contributors` lists who wrote the code, read from `git log` of BMM, BCW, BMM
// Docs and BetterInstaller (authors and Co-authored-by trailers). scripts/credits-authors.json
// folds the aliases of one person into one entry and names their GitHub; emails are matched
// there and never written out. A repository that is not checked out keeps the previous
// output's rows for it.
//
// Usage: node scripts/gen-credits.mjs          write the file
//        node scripts/gen-credits.mjs --check  exit 1 when the file is not what the manifests say

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'frontend/assets/credits-stack.gen.json';
const CHECK = process.argv.includes('--check');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const has = (p) => fs.existsSync(path.join(ROOT, p));
const json = (p) => JSON.parse(rd(p));

const prev = has(OUT) ? json(OUT) : { groups: [] };
const prevItem = new Map();
for (const g of prev.groups || []) for (const it of g.items || []) prevItem.set(`${g.id}|${it.name}|${it.version}`, it);
const declared = json('scripts/credits-licenses.json');
const contributorCards = new Set((has('frontend/assets/contributors.json') ? json('frontend/assets/contributors.json').contributors || [] : []).map((c) => c.id));
const problems = [];

// ── Small parsers ──────────────────────────────────────────────────────────────────────────
/** Direct dependencies of one Cargo.toml table family: name → requirement. */
function cargoDeps(text, tables) {
  const out = new Map();
  let on = false;
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.replace(/\s+#.*$/, '').trim();
    if (t.startsWith('[')) { on = tables.some((re) => re.test(t)); continue; }
    if (!on || !t || t.startsWith('#')) continue;
    const m = t.match(/^([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]+)"|\{.*?version\s*=\s*"([^"]+)")/);
    if (m && !out.has(m[1])) out.set(m[1], m[2] || m[3]);
  }
  return out;
}
const APP_TABLES = [/^\[dependencies\]$/, /^\[build-dependencies\]$/, /^\[target\..*\.dependencies\]$/];

/** Cargo.lock → name → [versions]. */
function lockVersions(text) {
  const out = new Map();
  for (const block of text.split(/\r?\n\[\[package\]\]\r?\n/)) {
    const n = block.match(/^name = "([^"]+)"/m), v = block.match(/^version = "([^"]+)"/m);
    if (n && v) { if (!out.has(n[1])) out.set(n[1], []); out.get(n[1]).push(v[1]); }
  }
  return out;
}

const parseV = (v) => { const [core, pre = ''] = v.split('-'); const n = core.split('.').map((x) => parseInt(x, 10) || 0); while (n.length < 3) n.push(0); return { n, pre }; };
function cmpV(a, b) {
  const x = parseV(a), y = parseV(b);
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] - y.n[i];
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1; if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}
/** Does `v` satisfy the caret (or `=`) requirement `req`? Enough of semver for Cargo.toml. */
function satisfies(v, req) {
  const exact = req.startsWith('=');
  const r = req.replace(/^[=^~]/, '');
  if (exact) return v === r;
  const a = parseV(r).n, b = parseV(v).n, parts = r.split('-')[0].split('.').length;
  if (cmpV(v, r) < 0) return false;
  if (a[0] > 0) return b[0] === a[0];
  if (parts === 1) return b[0] === 0;
  if (a[1] > 0) return b[0] === 0 && b[1] === a[1];
  return parts === 2 ? b[0] === 0 && b[1] === 0 : b[0] === 0 && b[1] === 0 && b[2] === a[2];
}
function resolveLock(lock, name, req) {
  const vs = (lock.get(name) || []).filter((v) => satisfies(v, req)).sort(cmpV);
  return vs.length ? vs[vs.length - 1] : null;
}

// ── Links and licence texts ────────────────────────────────────────────────────────────────
/** A manifest's repository / homepage as an https URL a person can open, or null. */
function normRepo(r) {
  let u = typeof r === 'string' ? r : r && typeof r === 'object' ? r.url : null;
  if (!u) return null;
  u = u.trim().replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/^ssh:\/\/git@([^/]+)\//, 'https://$1/').replace(/^git@([^:]+):/, 'https://$1/');
  const short = u.match(/^(github|gitlab|bitbucket):(.+)$/);
  if (short) u = `https://${short[1]}.${short[1] === 'bitbucket' ? 'org' : 'com'}/${short[2]}`;
  else if (/^[\w.-]+\/[\w.-]+$/.test(u)) u = `https://github.com/${u}`;
  u = u.replace(/^http:\/\//, 'https://').replace(/\.git$/, '').replace(/\/+$/, '').replace(/#readme$/, '');
  return /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null;
}

const LIC_OUT = 'frontend/assets/credits-licenses.gen.json';
const LIC_FILE = /^(licen[cs]e|copying|notice|unlicense)([-._ ].*)?$/i;
const LIC_MAX = 256 * 1024;
const licTexts = new Map(); // id → text (only the ones referenced end up in the output)
const prevLic = has(LIC_OUT) ? json(LIC_OUT) : { texts: {} };
const licId = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
/** The licence files at the root of an installed package: [{ f, id }], texts stored by hash. */
function licenceFiles(dir) {
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && LIC_FILE.test(d.name)).map((d) => d.name).sort(); } catch { return null; }
  const out = [];
  for (const f of names) {
    const p = path.join(dir, f);
    if (fs.statSync(p).size > LIC_MAX) continue;
    const text = fs.readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
    if (!text) continue;
    const id = licId(text);
    licTexts.set(id, text);
    out.push({ f, id });
  }
  return out.length ? out : null;
}
/** An installed npm package (under `base`/node_modules): description, links, licence files. */
function npmMeta(base, name, version) {
  const dir = path.join(ROOT, base, 'node_modules', name);
  const p = path.join(dir, 'package.json');
  if (!fs.existsSync(p)) return null;
  let j;
  try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  if (version && j.version !== version) return null;
  return { description: j.description || null, repository: normRepo(j.repository), homepage: normRepo(j.homepage), lic: licenceFiles(dir) };
}

/** The crate's own Cargo.toml from the cargo registry: licence, description, repository. */
const REG = [process.env.CARGO_HOME, path.join(os.homedir(), '.cargo')].filter(Boolean).map((h) => path.join(h, 'registry', 'src'));
function crateMeta(name, version) {
  for (const base of REG) {
    let idx = [];
    try { idx = fs.readdirSync(base); } catch { continue; }
    for (const i of idx) {
      const f = path.join(base, i, `${name}-${version}`, 'Cargo.toml');
      if (!fs.existsSync(f)) continue;
      const t = fs.readFileSync(f, 'utf8');
      const pkg = t.split(/^\[(?!package\])/m)[0];
      const field = (k) => { const m = pkg.match(new RegExp(`^${k}\\s*=\\s*(?:"""([\\s\\S]*?)"""|"((?:[^"\\\\]|\\\\.)*)")`, 'm')); return m ? (m[1] ?? m[2]).replace(/\s+/g, ' ').trim() : null; };
      return { license: field('license') || (field('license-file') ? 'see its licence file' : null), description: field('description'), repository: normRepo(field('repository')), homepage: normRepo(field('homepage')), lic: licenceFiles(path.dirname(f)) };
    }
  }
  return null;
}

function npmLock(lockPath) {
  if (!has(lockPath)) return null;
  const l = json(lockPath);
  return (name) => l.packages?.[`node_modules/${name}`] || l.dependencies?.[name] || null;
}

// ── Keys: the i18n description and the "why BMM uses it" note are keyed by these ──────────
const KEY_ALIAS = {
  serde_json: 'serde-json', lazy_static: 'lazy-static', fs_extra: 'fs-extra',
  '@tanstack/query-core': 'tanstack-query', '@tauri-apps/api': 'tauri-api', '@tauri-apps/cli': 'tauri-cli',
  '@prisma/client': 'prisma',
};
const keyOf = (name) => KEY_ALIAS[name] || (/^tauri-plugin-/.test(name) ? 'tauri-plugins' : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));

// ── One item ───────────────────────────────────────────────────────────────────────────────
function item(group, o) {
  const it = { name: o.name, version: o.version || null, license: o.license || null, url: o.url || null, key: o.key || keyOf(o.name), source: o.source };
  if (o.req && o.req !== o.version) it.req = o.req;
  if (o.desc) it.desc = o.desc;
  if (o.from) it.licenseFrom = o.from;
  const repo = o.repo || null, home = o.home && o.home !== repo && o.home !== it.url ? o.home : null;
  if (repo && repo !== it.url) it.repo = repo;
  if (home) it.home = home;
  if (o.lic?.length) it.lic = o.lic;
  const old = prevItem.get(`${group}|${it.name}|${it.version}`);
  // Carried over when this machine cannot read it, never invented.
  if (!it.license && old?.license) { it.license = old.license; if (old.licenseFrom) it.licenseFrom = old.licenseFrom; }
  if (!it.desc && old?.desc) it.desc = old.desc;
  if (!o.metaRead && old) {
    if (!it.repo && old.repo) it.repo = old.repo;
    if (!it.home && old.home) it.home = old.home;
    if (!it.lic && old.lic?.every((l) => prevLic.texts?.[l.id])) { it.lic = old.lic; for (const l of old.lic) licTexts.set(l.id, prevLic.texts[l.id]); }
  }
  // No manifest link: a licence read from a GitHub file names its repository.
  if (!it.repo) {
    const gh = (it.licenseFrom || '').match(/^(https:\/\/github\.com\/[^/]+\/[^/]+)\/blob\//);
    if (gh && gh[1] !== it.url) it.repo = gh[1];
  }
  if (!it.license) problems.push(`${group}: no licence could be read for ${it.name} ${it.version || ''}`);
  if (!it.version && o.versionOptional !== true) problems.push(`${group}: no version could be read for ${it.name}`);
  return it;
}
const decl = (name) => declared[name] || null;
/** The link/licence-file fields of item() from a crateMeta / npmMeta result. */
const links = (m) => (m ? { repo: m.repository, home: m.homepage, lic: m.lic, metaRead: true } : {});

// ── Rust: the app ──────────────────────────────────────────────────────────────────────────
const SHELL = new Set(['tauri', 'tauri-build', 'embed-resource', 'windows', 'windows-sys', 'winreg', 'open', 'mimalloc', 'keyring']);
const AI = new Set(['ort', 'tokenizers']);
const appToml = rd('src-tauri/Cargo.toml');
const appLock = lockVersions(rd('src-tauri/Cargo.lock'));
const shell = [], core = [], ai = [];
for (const [name, req] of [...cargoDeps(appToml, APP_TABLES)].sort((a, b) => a[0].localeCompare(b[0]))) {
  const version = resolveLock(appLock, name, req);
  if (!version) { problems.push(`Cargo.lock has no version of ${name} matching ${req}`); continue; }
  const meta = crateMeta(name, version);
  const group = SHELL.has(name) || name.startsWith('tauri-plugin-') ? 'shell' : AI.has(name) ? 'ai' : 'core';
  const it = item(group, { name, version, req, license: meta?.license, desc: meta?.description, url: `https://crates.io/crates/${name}`, source: 'src-tauri/Cargo.lock', ...links(meta) });
  (group === 'shell' ? shell : group === 'ai' ? ai : core).push(it);
}

// ── npm: BMM's own package.json ────────────────────────────────────────────────────────────
const pkg = json('package.json');
const lock = npmLock('package-lock.json');
const tooling = [];
for (const [name, req] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).sort((a, b) => a[0].localeCompare(b[0]))) {
  const e = lock?.(name);
  const meta = npmMeta('', name, e?.version);
  const it = item(name === '@tauri-apps/api' ? 'shell' : 'tooling', { name, version: e?.version, req, license: e?.license, desc: meta?.description, url: `https://www.npmjs.com/package/${name}`, source: 'package-lock.json', ...links(meta) });
  (name === '@tauri-apps/api' ? shell : tooling).push(it);
}

// ── Vendored bundles: what the window actually loads ───────────────────────────────────────
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
const VENDORED = [
  { name: 'DOMPurify', file: 'frontend/js/lib/purify.min.js', version: /DOMPurify (\d+\.\d+\.\d+)/, license: /Released under the (Apache license 2\.0 and Mozilla Public License 2\.0)/, map: () => 'Apache-2.0 OR MPL-2.0', pkg: 'dompurify', url: 'https://github.com/cure53/DOMPurify', key: 'dompurify' },
  { name: 'marked', file: 'frontend/js/lib/marked.min.js', version: /marked v(\d+\.\d+\.\d+)/, license: /\((MIT) Licensed\)/, pkg: 'marked', url: 'https://marked.js.org/', repo: 'https://github.com/markedjs/marked' },
  { name: 'Prism', file: 'frontend/assets/vendor/prism.min.js', version: /Prism (\d+\.\d+\.\d+)/, npm: 'prismjs', url: 'https://prismjs.com/' },
  { name: 'KaTeX', file: 'frontend/assets/vendor/katex/katex.min.js', version: /version:"(\d+\.\d+\.\d+)"/, npm: 'katex', url: 'https://katex.org/' },
  { name: 'Mermaid', file: 'frontend/assets/vendor/mermaid.min.js', version: /const \w+="(\d+\.\d+\.\d+)",\w+=Object\.freeze\(/, decl: 'mermaid', pkg: 'mermaid', url: 'https://mermaid.js.org/' },
  { name: 'rrweb', file: 'frontend/assets/vendor/rrweb.min.js', same: 'node_modules/rrweb/dist/rrweb.umd.min.cjs', npm: 'rrweb', url: 'https://www.rrweb.io/', key: 'rrweb' },
  { name: 'GSAP', file: 'frontend/assets/vendor/gsap.min.js', version: /GSAP (\d+\.\d+\.\d+)/, license: /Subject to the terms at (https:\/\/gsap\.com\/standard-license)/, map: () => 'GSAP Standard License', pkg: 'gsap', url: 'https://gsap.com/', repo: 'https://github.com/greensock/GSAP' },
  { name: 'svg-pan-zoom', file: 'frontend/assets/vendor/svg-pan-zoom.min.js', version: /svg-pan-zoom v(\d+\.\d+\.\d+)/, decl: 'svg-pan-zoom', pkg: 'svg-pan-zoom', url: 'https://github.com/bumbu/svg-pan-zoom' },
  { name: 'Cropper.js', file: 'frontend/assets/cropper/cropper.min.js', version: /Cropper\.js v(\d+\.\d+\.\d+)/, license: /Released under the (MIT) license/, pkg: 'cropperjs', url: 'https://fengyuanchen.github.io/cropperjs/', key: 'cropperjs', repo: 'https://github.com/fengyuanchen/cropperjs' },
];
// Lockfiles that may hold the same package at the same version (BMM's, then the site's).
const siteWebLock = npmLock('BCW/BCWEB/apps/web/package-lock.json');
const ui = [];
for (const v of VENDORED) {
  if (!has(v.file)) { problems.push(`vendored file missing: ${v.file}`); continue; }
  const head = rd(v.file).slice(0, v.file.includes('mermaid') || v.file.includes('katex') ? undefined : 4000);
  let version = v.version ? (head.match(v.version) || [])[1] : null;
  let license = v.license ? (head.match(v.license) || [])[1] : null;
  if (license && v.map) license = v.map(license);
  let from = license ? `${v.file} (licence banner)` : null;
  let source = v.file;
  if (v.same && has(v.same) && sha(v.same) === sha(v.file)) {
    const e = lock?.(v.npm);
    version = e?.version || version; license = license || e?.license; source = `${v.file} = ${v.same}`; from = from || 'package-lock.json';
  }
  if (!license && v.npm && version) {
    for (const l of [lock, siteWebLock]) { const e = l?.(v.npm); if (e?.version === version && e.license) { license = e.license; from = 'a package-lock.json with the same version'; break; } }
  }
  if (!license && v.decl && decl(v.decl)) { license = decl(v.decl).license; from = decl(v.decl).from; }
  // Links and licence files from the same package installed at the same version, if any.
  let meta = null;
  for (const base of ['', 'BCW/BCWEB/apps/web']) { if (meta || !version) break; meta = npmMeta(base, v.npm || v.pkg, version); }
  const l = links(meta);
  ui.push(item('ui', { name: v.name, version, license, from, url: v.url, key: v.key, source, ...l, repo: l.repo || v.repo }));
}

// ── AI: the Laya model pack ────────────────────────────────────────────────────────────────
const laya = json('laya-model.lock.json');
ai.unshift(
  item('ai', { name: laya.model.id, key: 'laya-model', version: laya.model.revision.slice(0, 12), license: laya.model.license, from: 'laya-model.lock.json', url: `https://huggingface.co/${laya.model.id}/tree/${laya.model.revision}`, source: 'laya-model.lock.json', repo: `https://huggingface.co/${laya.model.id}`, desc: `Laya classifier, revision ${laya.model.revision}, shipped as ${laya.variant} ONNX in ${laya.pack.file}.` }),
  item('ai', { name: 'ONNX Runtime', key: 'onnxruntime', version: laya.onnxruntime.version, license: laya.onnxruntime.license, from: 'laya-model.lock.json', url: laya.onnxruntime.url, source: 'laya-model.lock.json', repo: 'https://github.com/microsoft/onnxruntime', home: 'https://onnxruntime.ai/', desc: 'The official Microsoft runtime inside the model pack, loaded by absolute path after its SHA-256 is checked.' }),
);

// ── Icons & fonts ──────────────────────────────────────────────────────────────────────────
const art = [];
const fontUrl = (rd('frontend/index.html').match(/https:\/\/fonts\.googleapis\.com\/css2\?[^"']+/) || [])[0] || '';
for (const fam of [...fontUrl.matchAll(/family=([^:&]+)/g)].map((m) => decodeURIComponent(m[1].replace(/\+/g, ' ')))) {
  const d = decl(fam);
  art.push(item('art', { name: fam, version: null, versionOptional: true, license: d?.license, from: d?.from, url: d?.url, source: 'frontend/index.html (Google Fonts)' }));
}
for (const name of ['lucide', 'simple-icons']) {
  const d = decl(name);
  const count = Object.keys(json(`frontend/assets/icons/${name}.json`)).length;
  art.push(item('art', { name, version: null, versionOptional: true, license: d?.license, from: d?.from, url: d?.url, source: `frontend/assets/icons/${name}.json (${count} icons)` }));
}
if (has('frontend/assets/icons/iso/LICENSES.txt')) {
  const t = rd('frontend/assets/icons/iso/LICENSES.txt');
  for (const m of t.matchAll(/^(.+?)\s+\(prefix "[^"]+"\)\s*\r?\n-+\r?\nSource:\s+(\S+).*\r?\nCommit:\s+([0-9a-f]+)\r?\nLicence:\s+(.+)\r?\nFiles:\s+(\d+)/gm)) {
    art.push(item('art', { name: m[1].trim(), version: m[3].slice(0, 12), license: m[4].trim(), from: 'frontend/assets/icons/iso/LICENSES.txt', url: m[2], source: `frontend/assets/icons/iso/LICENSES.txt (${m[5]} files)` }));
  }
}

// ── BMM Docs ───────────────────────────────────────────────────────────────────────────────
const docs = [];
for (const line of rd('BMM Docs/requirements.in').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_.-]+)==([^\s#]+)/);
  if (!m) continue;
  const d = decl(m[1]);
  docs.push(item('docs', { name: m[1], version: m[2], license: d?.license, from: d?.from, url: `https://pypi.org/project/${m[1]}/`, source: 'BMM Docs/requirements.in' }));
}

// ── BetterInstaller ────────────────────────────────────────────────────────────────────────
const installer = [];
if (has('BetterInstaller/Cargo.toml') && has('BetterInstaller/Cargo.lock')) {
  const il = lockVersions(rd('BetterInstaller/Cargo.lock'));
  for (const [name, req] of [...cargoDeps(rd('BetterInstaller/Cargo.toml'), [/^\[workspace\.dependencies\]$/])].sort((a, b) => a[0].localeCompare(b[0]))) {
    const version = resolveLock(il, name, req);
    const meta = version ? crateMeta(name, version) : null;
    installer.push(item('installer', { name, version, req, license: meta?.license, desc: meta?.description, url: `https://crates.io/crates/${name}`, source: 'BetterInstaller/Cargo.lock', ...links(meta) }));
  }
} else for (const g of prev.groups || []) if (g.id === 'installer') installer.push(...g.items);

// ── BetterCommunity (the site the credits link to) ─────────────────────────────────────────
const site = [];
const APPS = ['web', 'api', 'bot'];
if (APPS.every((a) => has(`BCW/BCWEB/apps/${a}/package.json`))) {
  const seen = new Set();
  for (const a of APPS) {
    const p = json(`BCW/BCWEB/apps/${a}/package.json`);
    const l = npmLock(`BCW/BCWEB/apps/${a}/package-lock.json`);
    for (const [name, req] of Object.entries(p.dependencies || {}).sort((x, y) => x[0].localeCompare(y[0]))) {
      const e = l?.(name);
      const id = `${name}@${e?.version}`;
      if (seen.has(id)) { site.find((s) => s.name === name && s.version === e?.version)?.apps.push(a); continue; }
      seen.add(id);
      const meta = npmMeta(`BCW/BCWEB/apps/${a}`, name, e?.version);
      const it = item('site', { name, version: e?.version, req, license: e?.license, desc: meta?.description, url: `https://www.npmjs.com/package/${name}`, source: `BCW/BCWEB/apps/${a}/package-lock.json`, ...links(meta) });
      it.apps = [a];
      site.push(it);
    }
  }
  site.sort((x, y) => x.name.localeCompare(y.name));
} else for (const g of prev.groups || []) if (g.id === 'site') site.push(...g.items);

// ── Code contributors (git history) ────────────────────────────────────────────────────────
const authorsCfg = json('scripts/credits-authors.json');
const ignored = (authorsCfg.ignore || []).map((r) => new RegExp(r, 'i'));
const personOf = new Map();
for (const p of authorsCfg.people || []) for (const a of [p.name, ...(p.aliases || [])]) personOf.set(a.toLowerCase(), p);
/** name → { name, github, contributor, repos:Set, since } */
const people = new Map();
const addAuthor = (name, email, repo, year) => {
  name = (name || '').trim();
  if (!name || ignored.some((r) => r.test(name) || (email && r.test(email)))) return;
  const p = personOf.get(name.toLowerCase());
  const key = p ? p.name : name;
  if (!people.has(key)) people.set(key, { name: key, github: p?.github || null, contributor: p?.contributor || null, repos: new Set(), since: year });
  const e = people.get(key);
  e.repos.add(repo);
  if (year && (!e.since || year < e.since)) e.since = year;
};
const prevPeople = prev.contributors?.people || [];
for (const r of authorsCfg.repos) {
  let log = null;
  try {
    const top = execFileSync('git', ['-C', path.join(ROOT, r.dir), 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    // Only the repository itself: a folder that is not checked out would answer for BMM.
    if (path.resolve(top).toLowerCase() === path.resolve(ROOT, r.dir).toLowerCase()) {
      log = execFileSync('git', ['-C', path.join(ROOT, r.dir), 'log', '--date=format:%Y', '--format=%aN%x1f%aE%x1f%ad%x1f%(trailers:key=Co-authored-by,valueonly,separator=%x1d)%x1e'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    }
  } catch { log = null; }
  if (log == null) {
    // Not checked out here: keep what the previous output said about this repository.
    for (const p of prevPeople) if (p.repos?.includes(r.id)) addAuthor(p.name, null, r.id, p.since);
    continue;
  }
  for (const rec of log.split('\x1e')) {
    const [name, email, year, trailers] = rec.replace(/^\s+/, '').split('\x1f');
    if (!name) continue;
    addAuthor(name, email, r.id, year);
    for (const t of (trailers || '').split('\x1d')) {
      const m = t.trim().match(/^(.*?)\s*<([^>]*)>$/);
      if (m) addAuthor(m[1], m[2], r.id, year);
    }
  }
}
const repoOrder = authorsCfg.repos.map((r) => r.id);
const contributors = {
  repos: authorsCfg.repos.map((r) => ({ id: r.id, label: r.label, url: r.url || null })),
  people: [...people.values()]
    .map((p) => ({ name: p.name, github: p.github, contributor: p.contributor, repos: repoOrder.filter((id) => p.repos.has(id)), since: p.since || null }))
    .sort((a, b) => b.repos.length - a.repos.length || String(a.since).localeCompare(String(b.since)) || a.name.localeCompare(b.name)),
};

const out = {
  _generated: 'by scripts/gen-credits.mjs from the manifests; do not edit (node scripts/gen-credits.mjs)',
  contributors,
  groups: [
    { id: 'shell', items: shell },
    { id: 'ui', items: ui },
    { id: 'core', items: core },
    { id: 'ai', items: ai },
    { id: 'art', items: art },
    { id: 'docs', items: docs },
    { id: 'installer', items: installer },
    { id: 'site', items: site },
    { id: 'tooling', items: tooling },
  ],
};
const text = JSON.stringify(out, null, 1) + '\n';
// The licence texts the entries point at, one per line (a diff shows which text changed).
const usedLic = new Set();
for (const g of out.groups) for (const it of g.items) for (const l of it.lic || []) usedLic.add(l.id);
const licText = '{\n"_generated": "by scripts/gen-credits.mjs: the licence files shipped inside each package of the credits stack, keyed by content hash; do not edit",\n"texts": {\n'
  + [...usedLic].sort().map((id) => `${JSON.stringify(id)}: ${JSON.stringify(licTexts.get(id))}`).join(',\n') + '\n}\n}\n';

// Every entry must be openable (its page, its repository or its homepage, all https), every
// licence file it points at must be in the texts file, and no email may reach the output.
for (const g of out.groups) for (const it of g.items) {
  if (![it.url, it.repo, it.home].some((u) => typeof u === 'string' && /^https:\/\//.test(u))) problems.push(`${g.id}: ${it.name} has no https link (page, repository or homepage)`);
  for (const l of it.lic || []) if (typeof licTexts.get(l.id) !== 'string') problems.push(`${g.id}: ${it.name} points at licence text ${l.id} (${l.f}) that was not read`);
}
if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(JSON.stringify(contributors))) problems.push('contributors: an email address would be written out (check scripts/credits-authors.json)');
for (const p of contributors.people) if (p.contributor && !contributorCards.has(p.contributor)) problems.push(`contributors: ${p.name} names card "${p.contributor}" that frontend/assets/contributors.json does not have`);

if (problems.length) {
  console.error(`✗ gen-credits: ${problems.length} problem(s)`);
  for (const p of problems) console.error('  · ' + p);
  process.exit(1);
}
const total = out.groups.reduce((n, g) => n + g.items.length, 0);
if (CHECK) {
  for (const [file, want] of [[OUT, text], [LIC_OUT, licText]]) {
    const cur = has(file) ? rd(file).replace(/\r\n/g, '\n') : '';
    if (cur !== want) {
      console.error(`✗ ${file} is not what the manifests and the git history say (a dependency was added, removed or bumped, a licence file changed, or a new contributor). Run: node scripts/gen-credits.mjs`);
      process.exit(1);
    }
  }
  console.log(`✓ credits stack up to date (${total} entries in ${out.groups.length} groups, ${usedLic.size} licence texts, ${contributors.people.length} code contributor(s))`);
} else {
  fs.writeFileSync(path.join(ROOT, OUT), text);
  fs.writeFileSync(path.join(ROOT, LIC_OUT), licText);
  console.log(`✓ wrote ${OUT} (${total} entries in ${out.groups.length} groups, ${contributors.people.length} code contributor(s)) and ${LIC_OUT} (${usedLic.size} licence texts, ${Math.round(Buffer.byteLength(licText) / 1024)} KB)`);
}
