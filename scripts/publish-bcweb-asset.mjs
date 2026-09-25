#!/usr/bin/env node
/**
 * publish-bcweb-asset.mjs — replace a BCWEB platform-asset slot with a local file.
 *
 *   BCWEB_ASSETS_TOKEN=… node scripts/publish-bcweb-asset.mjs <file> --slot <key> [--version <v>]
 *
 * Used by .github/workflows/resign-manifests.yml to push the re-signed manifests to the BCWEB
 * mirrors: `bmm-update-json` (BetterInstaller's update.json, a manifest_urls entry of
 * installer.toml) and `bmm-update-manifest` (BMM's update-manifest.json, advertised by
 * /api/updates/bmm/*). Same three calls as Admin → Downloads & assets: presign, PUT to storage,
 * confirm (apps/api/src/routes/platform-assets.mjs).
 *
 * PREREQUISITE — not met today: those routes authenticate a browser session cookie plus TOTP
 * (requireCap('manage_assets')), not a bearer key. This script sends
 * `Authorization: Bearer $BCWEB_ASSETS_TOKEN`, which BCWEB will accept only once it grants a
 * scoped key for them. Until then the secret stays unset and the workflow skips this step.
 *
 * Env: BCWEB_ASSETS_TOKEN (required), BCWEB_API (default https://bettercommunity.ch/api).
 * Node built-ins only.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const file = argv[0];
const slot = opt('--slot');
const version = opt('--version');
const token = process.env.BCWEB_ASSETS_TOKEN || '';
const api = (process.env.BCWEB_API || 'https://bettercommunity.ch/api').replace(/\/+$/, '');

async function call(method, path, body) {
    const r = await fetch(`${api}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${path} → HTTP ${r.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
}

async function main() {
    if (!file || !slot || !/^[a-zA-Z0-9._-]{1,64}$/.test(slot)) {
        console.error('usage: publish-bcweb-asset.mjs <file> --slot <key> [--version <v>]');
        return 2;
    }
    if (!token) { console.error('BCWEB_ASSETS_TOKEN is not set'); return 2; }
    if (!api.startsWith('https://')) { console.error('BCWEB_API must be https'); return 2; }
    const bytes = readFileSync(file);
    const filename = basename(file);
    const contentType = 'application/json';
    const { url, storageKey } = await call('POST', '/admin/assets/presign', { key: slot, filename, contentType, size: bytes.length });
    const put = await fetch(url, { method: 'PUT', headers: { 'content-type': contentType }, body: bytes });
    if (!put.ok) throw new Error(`storage PUT → HTTP ${put.status}`);
    await call('PUT', `/admin/assets/file/${slot}`, { filename, contentType, size: bytes.length, storageKey, ...(version ? { version } : {}) });
    console.log(`[publish-bcweb-asset] ${filename} → ${api}/assets/${slot} (${bytes.length} bytes)`);
    return 0;
}

main().then((c) => { process.exitCode = c; }, (e) => { console.error(`[publish-bcweb-asset] ${e.message}`); process.exitCode = 1; });
