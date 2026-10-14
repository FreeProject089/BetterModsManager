// Versions: parsing, comparing, bumping (pure), and reading / writing every file that states
// BMM's version (IO, UTF-8 without BOM, only the version bytes change).
//
// The list of files is the one scripts/check-release-versions.mjs gates on; that script runs
// right after a bump and is the judge. BetterInstaller's release.ps1 rewrites the same three
// files it owns (installer.toml, Cargo.toml, tauri.conf.json) with the same regexes, and leaves
// a file already at the version untouched, so running it after this bump is a no-op on them.

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { readTextRaw, writeText } from './util.mjs';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** "1.2.3" / "v1.2.3-beta.1" → { major, minor, patch, pre } or null. */
export function parseVersion(s) {
  const m = SEMVER.exec(String(s ?? '').trim().replace(/^[vV]/, ''));
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null };
}

export const formatVersion = (v) => `${v.major}.${v.minor}.${v.patch}${v.pre ? `-${v.pre}` : ''}`;
export const isVersion = (s) => parseVersion(s) !== null;

/** Semver order: a release is newer than its pre-releases; numeric pre-release parts compare as numbers. */
export function compareVersions(a, b) {
  const x = typeof a === 'string' ? parseVersion(a) : a;
  const y = typeof b === 'string' ? parseVersion(b) : b;
  if (!x || !y) throw new Error(`not a version: ${!x ? a : b}`);
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  const pa = x.pre.split('.'), pb = y.pre.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    const na = /^\d+$/.test(pa[i]), nb = /^\d+$/.test(pb[i]);
    if (na && nb && +pa[i] !== +pb[i]) return +pa[i] < +pb[i] ? -1 : 1;
    if (na !== nb) return na ? -1 : 1;
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Next version. kind: patch | minor | major | pre (1.0.3-beta.1 → 1.0.3-beta.2; 1.0.2 → 1.0.3-beta.1)
 * | release (1.0.3-beta.2 → 1.0.3). Anything that parses as a version is returned as is.
 */
export function bumpVersion(current, kind = 'patch', preId = 'beta') {
  if (isVersion(kind)) return formatVersion(parseVersion(kind));
  const v = parseVersion(current);
  if (!v) throw new Error(`not a version: ${current}`);
  switch (kind) {
    case 'major': return `${v.major + 1}.0.0`;
    case 'minor': return `${v.major}.${v.minor + 1}.0`;
    case 'patch': return v.pre ? `${v.major}.${v.minor}.${v.patch}` : `${v.major}.${v.minor}.${v.patch + 1}`;
    case 'release': return `${v.major}.${v.minor}.${v.patch}`;
    case 'pre': {
      if (v.pre) {
        const m = /^(.*?)(\d+)$/.exec(v.pre);
        return `${v.major}.${v.minor}.${v.patch}-${m ? m[1] + (+m[2] + 1) : v.pre + '.1'}`;
      }
      return `${v.major}.${v.minor}.${v.patch + 1}-${preId}.1`;
    }
    default: throw new Error(`unknown bump kind: ${kind}`);
  }
}

/** The highest version in `list` that is lower than `version` (null when none). */
export function previousVersion(list, version) {
  return list.filter((v) => isVersion(v) && compareVersions(v, version) < 0)
    .sort(compareVersions).pop() ?? null;
}

// ── per-file readers / rewriters (pure, on text) ─────────────────────────────────────────────

/** The `[table]` section of a TOML text: [start, end) offsets of its body, or null. */
function tomlSection(text, table) {
  const head = new RegExp(`^\\[${table.replace(/\./g, '\\.')}\\][ \\t]*\\r?$`, 'm').exec(text);
  if (!head) return null;
  const start = head.index + head[0].length;
  const next = /^\[/m.exec(text.slice(start));
  return [start, next ? start + next.index : text.length];
}

function tomlVersion(text, table) {
  const s = tomlSection(text, table);
  if (!s) return null;
  return /^[ \t]*version[ \t]*=[ \t]*"([^"]*)"/m.exec(text.slice(s[0], s[1]))?.[1] ?? null;
}

function setTomlVersion(text, table, v) {
  const s = tomlSection(text, table);
  if (!s) throw new Error(`no [${table}] section`);
  const body = text.slice(s[0], s[1]);
  const re = /^([ \t]*version[ \t]*=[ \t]*")[^"]*(")/m;
  if (!re.test(body)) throw new Error(`no version in [${table}]`);
  return text.slice(0, s[0]) + body.replace(re, `$1${v}$2`) + text.slice(s[1]);
}

/** The first `"version": "…"` of a JSON text: the top-level one in package.json / tauri.conf.json. */
const JSON_TOP = /("version"\s*:\s*")([^"]*)(")/;
/** package-lock.json's packages[""] block. */
const LOCK_ROOT = /("packages"\s*:\s*\{\s*""\s*:\s*\{[^{}]*?"version"\s*:\s*")([^"]*)(")/;
const CARGO_LOCK = /(\[\[package\]\]\r?\nname = "better-mods-manager"\r?\nversion = ")([^"]*)(")/;

export const VERSION_FILES = [
  { label: 'package.json', file: 'package.json',
    read: (t) => JSON_TOP.exec(t)?.[2] ?? null, write: (t, v) => t.replace(JSON_TOP, `$1${v}$3`) },
  { label: 'package-lock.json', file: 'package-lock.json', optional: true,
    read: (t) => { const a = JSON_TOP.exec(t)?.[2], b = LOCK_ROOT.exec(t)?.[2]; return a === b ? a ?? null : `${a} / packages[""] ${b}`; },
    write: (t, v) => t.replace(JSON_TOP, `$1${v}$3`).replace(LOCK_ROOT, `$1${v}$3`) },
  { label: 'src-tauri/tauri.conf.json', file: 'src-tauri/tauri.conf.json',
    read: (t) => JSON_TOP.exec(t)?.[2] ?? null, write: (t, v) => t.replace(JSON_TOP, `$1${v}$3`) },
  { label: 'src-tauri/Cargo.toml [package]', file: 'src-tauri/Cargo.toml',
    read: (t) => tomlVersion(t, 'package'), write: (t, v) => setTomlVersion(t, 'package', v) },
  { label: 'src-tauri/Cargo.lock', file: 'src-tauri/Cargo.lock', optional: true,
    read: (t) => CARGO_LOCK.exec(t)?.[2] ?? null, write: (t, v) => t.replace(CARGO_LOCK, `$1${v}$3`) },
  { label: 'BetterInstaller installer.toml [app]', file: 'BetterInstaller/examples/bmm/installer.toml', optional: true,
    read: (t) => tomlVersion(t, 'app'), write: (t, v) => setTomlVersion(t, 'app', v) },
];

const nonAscii = (t) => (t.match(/[^\x00-\x7F]/g) || []).length;

/** Every version source as { label, file, version, bom, missing }. */
export function readVersions(root) {
  return VERSION_FILES.map((f) => {
    const p = join(root, f.file);
    if (!existsSync(p)) return { label: f.label, file: f.file, version: null, missing: true, optional: !!f.optional };
    const { text, bom } = readTextRaw(p);
    return { label: f.label, file: f.file, version: f.read(text), bom, missing: false, optional: !!f.optional };
  });
}

/**
 * Rewrite the version in every source. Only files whose text changes are written. Refuses
 * (throws, nothing written) when a rewrite would change anything but the version: the count
 * of non-ASCII characters must be unchanged (no mojibake) and no BOM is ever written.
 */
export function writeVersions(root, version, { dryRun = false } = {}) {
  if (!isVersion(version)) throw new Error(`not a version: ${version}`);
  const plan = [];
  for (const f of VERSION_FILES) {
    const p = join(root, f.file);
    if (!existsSync(p)) { if (!f.optional) throw new Error(`${f.file} is missing`); continue; }
    const { text, bom } = readTextRaw(p);
    const next = f.write(text, version);
    if (f.read(next) !== version) throw new Error(`${f.file}: the version could not be rewritten`);
    if (nonAscii(next) !== nonAscii(text)) throw new Error(`${f.file}: rewrite would change non-ASCII text`);
    if (next.split('\n').length !== text.split('\n').length) throw new Error(`${f.file}: rewrite changed the line count`);
    plan.push({ file: f.file, path: p, changed: next !== text || bom, text: next, hadBom: bom });
  }
  if (!dryRun) for (const x of plan) if (x.changed) writeText(x.path, x.text);
  return plan.map(({ file, changed, hadBom }) => ({ file, changed, hadBom }));
}
