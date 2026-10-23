// BMM never asks a third party for the user's IP address or location.
//
// Telemetry used to fetch the public IP from api.ipify.org and put it, with the LAN address,
// in the system profile; the server then located it with ipwho.is. The owner removed that on
// 2026-10-06: BMM sends no IP address at all, and no code it ships (the app, the CLI/MCP, the
// mini-server scripts it generates) may contact an IP-echo or geolocation service. The repo
// server's public address now comes from the router over UPnP, or is not shown.
//
// Comments may say what was removed; code may not reach it. So the scan is on every shipped
// source file, comments included, for the hosts themselves: a host in a comment is cheap to
// reword, a host in code is the bug.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => p.slice(ROOT.length + 1).split('\\').join('/');

// IP-echo and IP-geolocation services. Any of them would send the user's address out.
const HOSTS = [
  'ipify.org', 'ipwho.is', 'ipinfo.io', 'ip-api.com', 'ipapi.co', 'ifconfig.me', 'icanhazip.com',
  'checkip.amazonaws.com', 'myexternalip.com', 'ipgeolocation.io', 'freegeoip', 'geoip-db.com',
];
const HOST_RE = new RegExp(HOSTS.map((h) => h.replace(/\./g, '\\.')).join('|'), 'i');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'target') continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

const SOURCE_EXT = /\.(rs|ts|js|mjs|cjs|json|html|template|toml|sh|bat|ps1|vbs)$/i;
const SHIPPED = [
  'src-tauri/src', 'src-tauri/capabilities', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml',
  'frontend/src', 'frontend/js', 'frontend/index.html', 'frontend/assets/links.json',
];

describe('no IP or location lookup', () => {
  test('no shipped source names an IP-echo or geolocation service', () => {
    const files = [];
    for (const s of SHIPPED) {
      const p = join(ROOT, s);
      if (!existsSync(p)) continue;
      if (statSync(p).isDirectory()) walk(p, files); else files.push(p);
    }
    assert.ok(files.length > 100, `only ${files.length} files scanned: the paths above moved`);
    const bad = [];
    for (const f of files.filter((p) => SOURCE_EXT.test(p))) {
      const s = readFileSync(f, 'utf8');
      const m = s.match(HOST_RE);
      if (m) bad.push(`${rel(f)}: ${m[0]}`);
    }
    assert.deepEqual(bad, []);
  });

  test('the telemetry system profile carries no IP address', () => {
    const src = readFileSync(join(ROOT, 'src-tauri/src/commands/analytics.rs'), 'utf8');
    const i = src.indexOf('pub async fn analytics_system_profile');
    assert.ok(i > 0, 'analytics_system_profile not found');
    const body = src.slice(i, src.indexOf('\n}\n', i));
    assert.doesNotMatch(body, /"(public|private)_ip"/, 'the profile still has an IP field');
    assert.doesNotMatch(body, /local_ip\(\)/, 'the profile still reads the LAN address');
  });

  test('the repo server takes its public address from the router only', () => {
    const src = readFileSync(join(ROOT, 'src-tauri/src/commands/repo_server.rs'), 'utf8');
    assert.doesNotMatch(src, /fn fetch_public_ip/, 'a separate public-IP lookup is back');
    assert.match(src, /get_external_ip\(\)/, 'UPnP is no longer the source of the public address');
  });
});
