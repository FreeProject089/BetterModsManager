#!/usr/bin/env node
/**
 * publish-bcweb-asset.mjs — replace a BCWEB platform-asset slot with a local file.
 *
 *   BCWEB_ASSETS_TOKEN=… node scripts/publish-bcweb-asset.mjs <file> --slot <key> [--version <v>] [--content-type <t>]
 *
 * Used by .github/workflows/resign-manifests.yml to push the re-signed manifests to the BCWEB
 * mirrors: `bmm-update-json` (BetterInstaller's update.json, a manifest_urls entry of
 * installer.toml) and `bmm-update-manifest` (BMM's update-manifest.json, advertised by
 * /api/updates/bmm/*), and by .github/workflows/laya-model.yml to mirror the offline Laya pack
 * to `bmm-laya-offline` (the second URL in laya-model.lock.json).
 *
 * THE KEY — a BCWEB "CI publish key": Admin → Downloads & assets → CI publish key. An ADMIN or
 * SUPERADMIN ticks the slots the key may replace, picks an expiry (90 days at most) and confirms
 * with a 2FA code; the key is shown once. Store it as the repository secret BCWEB_ASSETS_TOKEN.
 * It carries one scope (`assets:publish`) and opens two routes for its own slots only.
 *
 * THE CONTRACT (BCWEB apps/api/src/routes/platform-assets.mjs, lib/asset-publish.mjs):
 *   1. POST /ci/assets/<slot>/presign  { filename, contentType, size, sha256 }  → { url, storageKey }
 *   2. PUT  <url>  the bytes, streamed from disk with the exact Content-Type and Content-Length
 *      the presign was signed for (the model pack is 327 MB and is never read into memory)
 *   3. PUT  /ci/assets/<slot>  { filename, contentType, size, sha256, storageKey, version }
 *      BCWEB hashes what the store holds and switches the slot only if it matches `sha256`; a
 *      mismatch deletes the upload and keeps the old file (HTTP 422).
 *
 * The key is sent only as `Authorization: Bearer` to BCWEB_API, never printed, and never sent to
 * the storage URL. The presigned URL is not printed either (it is a short-lived credential).
 *
 * Env: BCWEB_ASSETS_TOKEN (required), BCWEB_API (default https://bettercommunity.ch/api; must be
 * https, except http://localhost / 127.0.0.1 for a local BCWEB). Node built-ins only.
 */
import { createReadStream, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { basename, extname } from 'node:path';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const file = argv[0];
const slot = opt('--slot');
const version = opt('--version');
const token = process.env.BCWEB_ASSETS_TOKEN || '';
const api = (process.env.BCWEB_API || 'https://bettercommunity.ch/api').replace(/\/+$/, '');

const TYPES = { '.json': 'application/json', '.zip': 'application/zip' };
const contentType = opt('--content-type') || TYPES[extname(file || '').toLowerCase()] || 'application/octet-stream';

/** An error body from BCWEB, trimmed, with anything key-shaped masked (belt and braces: the
 *  server never echoes the key). */
const clean = (s) => String(s || '').slice(0, 300).split(token || '\u0000').join('***').replace(/bck_[A-Za-z0-9_-]{8,}/g, 'bck_***');

async function call(method, path, body) {
    const r = await fetch(`${api}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${path} → HTTP ${r.status} ${clean(text)}`);
    return text ? JSON.parse(text) : {};
}

/** SHA-256 of the file, streamed. */
function sha256Of(path) {
    return new Promise((resolve, reject) => {
        const h = createHash('sha256');
        createReadStream(path).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
    });
}

function apiAllowed(u) {
    let url; try { url = new URL(u); } catch { return false; }
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

async function main() {
    if (!file || !slot || !/^[a-zA-Z0-9._-]{1,64}$/.test(slot)) {
        console.error('usage: publish-bcweb-asset.mjs <file> --slot <key> [--version <v>] [--content-type <t>]');
        return 2;
    }
    if (!token) { console.error('BCWEB_ASSETS_TOKEN is not set'); return 2; }
    if (!apiAllowed(api)) { console.error('BCWEB_API must be https (http only for localhost)'); return 2; }
    const size = statSync(file).size;
    if (!size) { console.error(`${file} is empty`); return 2; }
    const filename = basename(file);
    const sha256 = await sha256Of(file);

    const { url, storageKey } = await call('POST', `/ci/assets/${slot}/presign`, { filename, contentType, size, sha256 });
    // Streamed: `duplex: 'half'` is what lets fetch send a body it has not read yet. The
    // Content-Length is set explicitly because the presigned URL is signed over it.
    const put = await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': contentType, 'content-length': String(size) },
        body: Readable.toWeb(createReadStream(file)),
        duplex: 'half',
    });
    if (!put.ok) throw new Error(`storage PUT → HTTP ${put.status}`);
    const done = await call('PUT', `/ci/assets/${slot}`, { filename, contentType, size, sha256, storageKey, ...(version ? { version } : {}) });
    if (done.sha256 !== sha256) throw new Error(`BCWEB answered sha256 ${done.sha256}, expected ${sha256}`);
    console.log(`[publish-bcweb-asset] ${filename} → ${api}/assets/${slot} (${size} bytes, sha256 ${sha256})`);
    return 0;
}

main().then((c) => { process.exitCode = c; }, (e) => { console.error(`[publish-bcweb-asset] ${clean(e.message)}`); process.exitCode = 1; });
