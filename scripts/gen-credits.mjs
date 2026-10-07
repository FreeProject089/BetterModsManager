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
// Usage: node scripts/gen-credits.mjs          write the file
//        node scripts/gen-credits.mjs --check  exit 1 when the file is not what the manifests say

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

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
      return { license: field('license') || (field('license-file') ? 'see its licence file' : null), description: field('description'), repository: field('repository') };
    }
  }
  return null;
}

function npmLock(lockPath) {
  if (!has(lockPath)) return null;
  const l = json(lockPath);
  return (name) => l.packages?.[`node_modules/${name}`] || l.dependencies?.[name] || null;
}
function npmDesc(dir, name) {
  const p = path.join(dir, 'node_modules', name, 'package.json');
  if (!has(p)) return null;
  try { return JSON.parse(rd(p)).description || null; } catch { return null; }
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
  const old = prevItem.get(`${group}|${it.name}|${it.version}`);
  // Carried over when this machine cannot read it, never invented.
  if (!it.license && old?.license) { it.license = old.license; if (old.licenseFrom) it.licenseFrom = old.licenseFrom; }
  if (!it.desc && old?.desc) it.desc = old.desc;
  if (!it.license) problems.push(`${group}: no licence could be read for ${it.name} ${it.version || ''}`);
  if (!it.version && o.versionOptional !== true) problems.push(`${group}: no version could be read for ${it.name}`);
  return it;
}
const decl = (name) => declared[name] || null;

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
  const it = item(group, { name, version, req, license: meta?.license, desc: meta?.description, url: `https://crates.io/crates/${name}`, source: 'src-tauri/Cargo.lock' });
  (group === 'shell' ? shell : group === 'ai' ? ai : core).push(it);
}

// ── npm: BMM's own package.json ────────────────────────────────────────────────────────────
const pkg = json('package.json');
const lock = npmLock('package-lock.json');
const tooling = [];
for (const [name, req] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).sort((a, b) => a[0].localeCompare(b[0]))) {
  const e = lock?.(name);
  const it = item(name === '@tauri-apps/api' ? 'shell' : 'tooling', { name, version: e?.version, req, license: e?.license, desc: npmDesc('', name), url: `https://www.npmjs.com/package/${name}`, source: 'package-lock.json' });
  (name === '@tauri-apps/api' ? shell : tooling).push(it);
}

// ── Vendored bundles: what the window actually loads ───────────────────────────────────────
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
const VENDORED = [
  { name: 'DOMPurify', file: 'frontend/js/lib/purify.min.js', version: /DOMPurify (\d+\.\d+\.\d+)/, license: /Released under the (Apache license 2\.0 and Mozilla Public License 2\.0)/, map: () => 'Apache-2.0 OR MPL-2.0', url: 'https://github.com/cure53/DOMPurify', key: 'dompurify' },
  { name: 'marked', file: 'frontend/js/lib/marked.min.js', version: /marked v(\d+\.\d+\.\d+)/, license: /\((MIT) Licensed\)/, url: 'https://marked.js.org/' },
  { name: 'Prism', file: 'frontend/assets/vendor/prism.min.js', version: /Prism (\d+\.\d+\.\d+)/, npm: 'prismjs', url: 'https://prismjs.com/' },
  { name: 'KaTeX', file: 'frontend/assets/vendor/katex/katex.min.js', version: /version:"(\d+\.\d+\.\d+)"/, npm: 'katex', url: 'https://katex.org/' },
  { name: 'Mermaid', file: 'frontend/assets/vendor/mermaid.min.js', version: /const \w+="(\d+\.\d+\.\d+)",\w+=Object\.freeze\(/, decl: 'mermaid', url: 'https://mermaid.js.org/' },
  { name: 'rrweb', file: 'frontend/assets/vendor/rrweb.min.js', same: 'node_modules/rrweb/dist/rrweb.umd.min.cjs', npm: 'rrweb', url: 'https://www.rrweb.io/', key: 'rrweb' },
  { name: 'GSAP', file: 'frontend/assets/vendor/gsap.min.js', version: /GSAP (\d+\.\d+\.\d+)/, license: /Subject to the terms at (https:\/\/gsap\.com\/standard-license)/, map: () => 'GSAP Standard License', url: 'https://gsap.com/' },
  { name: 'svg-pan-zoom', file: 'frontend/assets/vendor/svg-pan-zoom.min.js', version: /svg-pan-zoom v(\d+\.\d+\.\d+)/, decl: 'svg-pan-zoom', url: 'https://github.com/bumbu/svg-pan-zoom' },
  { name: 'Cropper.js', file: 'frontend/assets/cropper/cropper.min.js', version: /Cropper\.js v(\d+\.\d+\.\d+)/, license: /Released under the (MIT) license/, url: 'https://fengyuanchen.github.io/cropperjs/', key: 'cropperjs' },
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
  ui.push(item('ui', { name: v.name, version, license, from, url: v.url, key: v.key, source }));
}

// ── AI: the Laya model pack ────────────────────────────────────────────────────────────────
const laya = json('laya-model.lock.json');
ai.unshift(
  item('ai', { name: laya.model.id, key: 'laya-model', version: laya.model.revision.slice(0, 12), license: laya.model.license, from: 'laya-model.lock.json', url: `https://huggingface.co/${laya.model.id}/tree/${laya.model.revision}`, source: 'laya-model.lock.json', desc: `Laya classifier, revision ${laya.model.revision}, shipped as ${laya.variant} ONNX in ${laya.pack.file}.` }),
  item('ai', { name: 'ONNX Runtime', key: 'onnxruntime', version: laya.onnxruntime.version, license: laya.onnxruntime.license, from: 'laya-model.lock.json', url: laya.onnxruntime.url, source: 'laya-model.lock.json', desc: 'The official Microsoft runtime inside the model pack, loaded by absolute path after its SHA-256 is checked.' }),
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
    installer.push(item('installer', { name, version, req, license: meta?.license, desc: meta?.description, url: `https://crates.io/crates/${name}`, source: 'BetterInstaller/Cargo.lock' }));
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
      const it = item('site', { name, version: e?.version, req, license: e?.license, desc: npmDesc(`BCW/BCWEB/apps/${a}`, name), url: `https://www.npmjs.com/package/${name}`, source: `BCW/BCWEB/apps/${a}/package-lock.json` });
      it.apps = [a];
      site.push(it);
    }
  }
  site.sort((x, y) => x.name.localeCompare(y.name));
} else for (const g of prev.groups || []) if (g.id === 'site') site.push(...g.items);

const out = {
  _generated: 'by scripts/gen-credits.mjs from the manifests; do not edit (node scripts/gen-credits.mjs)',
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

if (problems.length) {
  console.error(`✗ gen-credits: ${problems.length} problem(s)`);
  for (const p of problems) console.error('  · ' + p);
  process.exit(1);
}
const total = out.groups.reduce((n, g) => n + g.items.length, 0);
if (CHECK) {
  const cur = has(OUT) ? rd(OUT).replace(/\r\n/g, '\n') : '';
  if (cur !== text) {
    console.error(`✗ ${OUT} is not what the manifests say (a dependency was added, removed or bumped). Run: node scripts/gen-credits.mjs`);
    process.exit(1);
  }
  console.log(`✓ credits stack up to date (${total} entries in ${out.groups.length} groups)`);
} else {
  fs.writeFileSync(path.join(ROOT, OUT), text);
  console.log(`✓ wrote ${OUT} (${total} entries in ${out.groups.length} groups)`);
}
