#!/usr/bin/env node
// CI gate: the « Laya hors ligne » model pack is pinned in three places, and they must agree.
//
//   laya-model.lock.json                            — the record (what was built, measured, where)
//   src-tauri/src/commands/ai_embedded.rs           — what BMM downloads and refuses to load unless it matches
//   BetterInstaller/examples/bmm/installer.toml     — what setup downloads (skipped if BetterInstaller is absent)
//
// A drift between them is silent in the worst way: setup installs a pack BMM then refuses as
// "corrupt", or Settings downloads one the installer would not. The Rust tests check the same
// thing (`pins_match_the_lock_file`, `installer_pins_match_the_lock_file`); this gate runs in
// `npm run ci`, where no Rust toolchain is needed.
//
// --online also downloads the pack from its first URL and checks size + SHA-256 — the release
// workflow runs it so a release never points setup at a file that is missing or has changed.
//
// Usage: node scripts/check-laya-pins.mjs [--online]

import { readFileSync, existsSync, createWriteStream, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(join(ROOT, 'laya-model.lock.json'), 'utf8'));
const rs = readFileSync(join(ROOT, 'src-tauri/src/commands/ai_embedded.rs'), 'utf8');
const errors = [];

const constStr = (name) => {
  const m = new RegExp(`pub const ${name}: &str = "([^"]*)";`).exec(rs);
  return m ? m[1] : null;
};
const constNum = (name) => {
  const m = new RegExp(`pub const ${name}: u64 = ([0-9_]+);`).exec(rs);
  return m ? Number(m[1].replace(/_/g, '')) : null;
};
const expect = (what, got, want) => { if (got !== want) errors.push(`${what}: ${JSON.stringify(got)} ≠ lock ${JSON.stringify(want)}`); };

expect('ai_embedded.rs MODEL_ID', constStr('MODEL_ID'), lock.model.id);
expect('ai_embedded.rs MODEL_REVISION', constStr('MODEL_REVISION'), lock.model.revision);
expect('ai_embedded.rs VARIANT', constStr('VARIANT'), lock.variant);
expect('ai_embedded.rs ORT_VERSION', constStr('ORT_VERSION'), lock.onnxruntime.version);
expect('ai_embedded.rs PACK_SHA256', constStr('PACK_SHA256'), lock.pack.sha256);
expect('ai_embedded.rs PACK_SIZE', constNum('PACK_SIZE'), lock.pack.size);
const urls = [...(/pub const PACK_URLS: &\[&str\] = &\[([\s\S]*?)\];/.exec(rs)?.[1] || '').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
expect('ai_embedded.rs PACK_URLS', JSON.stringify(urls), JSON.stringify(lock.pack.urls));
for (const u of lock.pack.urls) if (!u.startsWith('https://')) errors.push(`pack url is not https: ${u}`);
if (!/^[0-9a-f]{64}$/.test(lock.pack.sha256) || /^0+$/.test(lock.pack.sha256)) errors.push('lock pack.sha256 is not a real SHA-256');

// Every pinned file: name → sha256/size, as written in the PACK_FILES table.
const fileRows = [...rs.matchAll(/PinnedFile \{ name: ([A-Z_]+|"[^"]+"), sha256: "([0-9a-f]{64})", size: ([0-9_]+) \}/g)];
const consts = { MODEL_FILE: 'laya.onnx', TOKENIZER_FILE: 'tokenizer.json', CONFIG_FILE: 'rl_agent_config.json' };
const seen = new Set();
for (const [, rawName, sha, size] of fileRows) {
  const name = rawName.startsWith('"') ? rawName.slice(1, -1) : consts[rawName];
  seen.add(name);
  const want = lock.files[name];
  if (!want) { errors.push(`ai_embedded.rs pins ${name}, the lock file does not`); continue; }
  expect(`${name} sha256`, sha, want.sha256);
  expect(`${name} size`, Number(size.replace(/_/g, '')), want.size);
}
for (const name of Object.keys(lock.files)) if (!seen.has(name)) errors.push(`lock pins ${name}, ai_embedded.rs does not`);

if (!existsSync(join(ROOT, 'src-tauri/tests/laya_golden.json'))) errors.push('src-tauri/tests/laya_golden.json is missing (scripts/laya/make_golden.py)');

const TOML = join(ROOT, 'BetterInstaller/examples/bmm/installer.toml');
if (existsSync(TOML)) {
  const toml = readFileSync(TOML, 'utf8');
  const block = toml.split('[[prerequisite]]').find((b) => /id\s*=\s*"laya-offline"/.test(b));
  if (!block) errors.push('installer.toml has no laya-offline prerequisite');
  else {
    const f = (k) => new RegExp(`^\\s*${k}\\s*=\\s*"([^"]*)"`, 'm').exec(block)?.[1];
    expect('installer.toml download_url', f('download_url'), lock.pack.urls[0]);
    expect('installer.toml sha256', f('sha256'), lock.pack.sha256);
    expect('installer.toml install_to', f('install_to'), 'models/laya');
  }
  if (!/installs\s*=\s*"laya-offline"/.test(toml)) errors.push('installer.toml: no setup option installs laya-offline');
} else {
  console.log('· BetterInstaller not present — installer pin check skipped');
}

if (process.argv.includes('--online') && !errors.length) {
  const url = lock.pack.urls[0];
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) errors.push(`${url}: HTTP ${res.status} — the pack is not published at its pinned URL`);
  else {
    const h = createHash('sha256');
    let n = 0;
    const tmp = join(tmpdir(), `laya-pack-${process.pid}.zip`);
    const out = createWriteStream(tmp);
    for await (const chunk of res.body) { h.update(chunk); n += chunk.length; out.write(chunk); }
    await new Promise((r) => out.end(r));
    const got = h.digest('hex');
    expect('published pack size', n, lock.pack.size);
    expect('published pack sha256', got, lock.pack.sha256);
    if (!process.env.LAYA_PACK_OUT) rmSync(tmp, { force: true });
    else console.log(`· pack kept at ${tmp}`);
  }
}

if (errors.length) {
  console.error('✗ Laya model pins disagree:\n  - ' + errors.join('\n  - '));
  process.exit(1);
}
console.log(`✓ Laya model pins agree (${lock.pack.file}, ${(lock.pack.size / 1e6).toFixed(0)} MB, sha256 ${lock.pack.sha256.slice(0, 12)}…)`);
