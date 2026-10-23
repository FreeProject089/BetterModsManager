// Shared helpers for the release tool: paths, UTF-8 (no BOM) file IO, hashing, formatting.
//
// Every text file this tool writes goes through writeText(): UTF-8, no byte-order mark. The
// version files (package.json, tauri.conf.json, Cargo.toml, installer.toml) are read the same
// way, so an accent in them never round-trips through Windows-1252 (the PowerShell 5.1 trap).

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = resolve(TOOL_DIR, '..', '..');
export const BI_DIR = join(ROOT, 'BetterInstaller');
export const DOCS_DIR = join(ROOT, 'BMM Docs');
export const BPKG = join(BI_DIR, 'target', 'release', 'bpkg.exe');
export const releaseDir = (v) => join(ROOT, 'Release', v);

const BOM = '﻿';

/** Read a text file as UTF-8. Returns { text, bom } so a caller can refuse or keep a BOM. */
export function readTextRaw(path) {
  const t = readFileSync(path, 'utf8');
  return t.startsWith(BOM) ? { text: t.slice(1), bom: true } : { text: t, bom: false };
}
export const readText = (path) => readTextRaw(path).text;

/** Write UTF-8 without a BOM, creating the parent directory. */
export function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text.startsWith(BOM) ? text.slice(1) : text, { encoding: 'utf8' });
}

export function writeJson(path, value) { writeText(path, JSON.stringify(value, null, 2) + '\n'); }
export function readJson(path) { return JSON.parse(readText(path)); }
export function ensureDir(p) { mkdirSync(p, { recursive: true }); return p; }
export const exists = (p) => existsSync(p);

export function sha256Buffer(buf) { return createHash('sha256').update(buf).digest('hex'); }

/** SHA-256 of a file, streamed (BMM-Setup.exe is ~80 MB). */
export function sha256File(path) {
  return new Promise((res, rej) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (d) => h.update(d)).on('error', rej).on('end', () => res(h.digest('hex')));
  });
}

/** Every file under dir (recursive), as paths relative to dir with forward slashes. */
export function listFiles(dir, { exclude = () => false } = {}) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      const rel = relative(dir, p).split(sep).join('/');
      if (exclude(rel, e)) continue;
      if (e.isDirectory()) walk(p); else if (e.isFile()) out.push(rel);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

export function fileSize(p) { try { return statSync(p).size; } catch { return null; } }

export function fmtBytes(n) {
  if (n == null) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function fmtDuration(ms) {
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

export const stamp = () => new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, '');

// Console colours (Windows Terminal and conhost with VT both understand these). NO_COLOR wins.
const useColor = !process.env.NO_COLOR && process.stdout.isTTY;
const wrap = (c) => (s) => (useColor ? `\x1b[${c}m${s}\x1b[0m` : String(s));
export const c = { bold: wrap('1'), dim: wrap('2'), red: wrap('31'), green: wrap('32'), yellow: wrap('33'), blue: wrap('34'), cyan: wrap('36'), magenta: wrap('35') };
