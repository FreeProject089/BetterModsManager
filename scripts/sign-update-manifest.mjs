#!/usr/bin/env node
/**
 * sign-update-manifest.mjs — sign, re-sign and verify BMM's incremental `update-manifest.json`.
 *
 * BMM (src-tauri/src/commands/autoupdate.rs, verify_manifest_text) refuses a manifest that is
 * not signed by the publisher key, is for another app, has expired, claims more than 7 days of
 * validity, or does not offer a newer version. This is the publisher half.
 *
 * Format (the same scheme as BetterInstaller's signed update.json, with its own context):
 *
 *   {
 *     "version": "1.2.0", "files": [ … ],     ← copy for BMM builds that predate signing
 *     "signed":    "<JSON string: {app_id, version, files, issued, expires}>",
 *     "signature": "<128 hex: Ed25519 over CONTEXT + the exact bytes of `signed`>"
 *   }
 *
 * Usage:
 *   node scripts/sign-update-manifest.mjs sign   <update-manifest.json> --key <private.key>
 *                                                 [--valid-days 1..7] [--out <file>]
 *                                                 [--require-signed]   (renew only; the weekly job)
 *   node scripts/sign-update-manifest.mjs verify <update-manifest.json> [--pubkey <hex>]
 *
 * `sign` on an UNSIGNED manifest (what gen-update-manifest.mjs writes) signs its top-level
 * `version` + `files`. On an already SIGNED manifest it re-signs: the existing signature must
 * verify with the key's own public half (so it never launders a manifest somebody else wrote —
 * its expiry does not matter, a late weekly job must still renew it), the content is taken from
 * the signed body unchanged, and only `issued` / `expires` are new. That is the weekly job
 * (.github/workflows/resign-manifests.yml).
 *
 * `private.key` is BetterInstaller's format: the 32-byte Ed25519 seed as hex text — the same
 * file that signs the .bpkg and update.json. Node built-ins only, so the weekly job needs no
 * `npm ci`.
 */

import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const MANIFEST_SIG_CONTEXT = 'BetterModsManager incremental manifest v1\n';
export const MANIFEST_APP_ID = 'com.bettermm.desktop';
/** Same value as MANIFEST_PUBLIC_KEY_HEX in autoupdate.rs and [security].public_key in
 *  BetterInstaller/examples/bmm/installer.toml (tests/sign-update-manifest.test.mjs checks). */
export const MANIFEST_PUBLIC_KEY_HEX = '8e0647c277dd67158d34dd1c10d0a2d97191716dc4f92aebde6d349d1c0f168b';
export const MANIFEST_MAX_VALIDITY_DAYS = 7;

const DAY_MS = 86_400_000;
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const isHex = (s, len) => typeof s === 'string' && s.length === len && /^[0-9a-fA-F]+$/.test(s);

/** A private KeyObject from BetterInstaller's `private.key` text (32-byte seed, hex). */
export function privateKeyFromSeedHex(text) {
    const hex = String(text).trim();
    if (!isHex(hex, 64)) throw new Error('private.key must be 32 bytes of hex (64 characters)');
    return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(hex, 'hex')]), format: 'der', type: 'pkcs8' });
}

/** A public KeyObject from 32 bytes of hex. */
export function publicKeyFromHex(hex) {
    if (!isHex(String(hex).trim(), 64)) throw new Error('a public key is 32 bytes of hex (64 characters)');
    return createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(String(hex).trim(), 'hex')]), format: 'der', type: 'spki' });
}

/** The raw 32-byte public key of a KeyObject, as hex. */
export function publicHex(keyObject) {
    const der = createPublicKey(keyObject).export({ format: 'der', type: 'spki' });
    return Buffer.from(der.subarray(der.length - 32)).toString('hex');
}

const message = (signed) => Buffer.concat([Buffer.from(MANIFEST_SIG_CONTEXT, 'utf8'), Buffer.from(signed, 'utf8')]);

/** RFC 3339, UTC, whole seconds — the shape bpkg writes. */
const rfc3339 = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function checkFiles(files) {
    if (!Array.isArray(files)) throw new Error('`files` must be an array');
    for (const f of files) {
        if (!f || typeof f.path !== 'string' || !f.path) throw new Error('a file has no path');
        let u;
        try { u = new URL(f.download_url); } catch { throw new Error(`${f.path}: download_url is not a URL`); }
        if (u.protocol !== 'https:') throw new Error(`${f.path}: download_url is not https`);
        if (f.path.split(/[\\/]/).some((seg) => seg === '..' || seg === '...') || /^([\\/]|[A-Za-z]:)/.test(f.path)) {
            throw new Error(`${f.path}: not a plain relative path`);
        }
        if (!/^[0-9a-f]{64}$/.test(f.sha256 || '')) throw new Error(`${f.path}: sha256 must be 64 lowercase hex`);
        if (!Number.isSafeInteger(f.size) || f.size < 0) throw new Error(`${f.path}: size must be a byte count`);
    }
}

/**
 * Check a manifest document (text). Returns the signed body. Throws on any rule BMM enforces,
 * except the version rule (that needs the running version; BMM applies it).
 * `ignoreExpiry` is for re-signing only.
 */
export function verifyManifest(text, { publicKey = MANIFEST_PUBLIC_KEY_HEX, now = Date.now(), ignoreExpiry = false } = {}) {
    const doc = JSON.parse(text);
    if (typeof doc.signed !== 'string') throw new Error('not signed (no `signed` string)');
    if (!isHex(doc.signature, 128)) throw new Error('signature missing or malformed');
    const key = typeof publicKey === 'string' ? publicKeyFromHex(publicKey) : publicKey;
    if (!edVerify(null, message(doc.signed), key, Buffer.from(doc.signature, 'hex'))) {
        throw new Error('signature does not match the publisher key');
    }
    const body = JSON.parse(doc.signed);
    if (body.app_id !== MANIFEST_APP_ID) throw new Error(`for ${JSON.stringify(body.app_id)}, not ${MANIFEST_APP_ID}`);
    if (typeof body.version !== 'string' || !body.version) throw new Error('no version');
    checkFiles(body.files);
    const issued = Date.parse(body.issued);
    const expires = Date.parse(body.expires);
    if (!Number.isFinite(issued) || !Number.isFinite(expires)) throw new Error('issued/expires missing or not RFC 3339');
    if (expires <= issued || expires - issued > MANIFEST_MAX_VALIDITY_DAYS * DAY_MS) {
        throw new Error(`valid from ${body.issued} to ${body.expires}; the limit is ${MANIFEST_MAX_VALIDITY_DAYS} days`);
    }
    if (!ignoreExpiry && now >= expires) throw new Error(`expired on ${body.expires}`);
    return body;
}

/**
 * Sign (or re-sign) a manifest document. Returns the new document text.
 * @param {string} text          the manifest, signed or not
 * @param {string} seedHex       private.key contents
 * @param {{validDays?: number, now?: number}} opts
 */
export function signManifest(text, seedHex, { validDays = MANIFEST_MAX_VALIDITY_DAYS, now = Date.now(), requireSigned = false } = {}) {
    if (!Number.isInteger(validDays) || validDays < 1 || validDays > MANIFEST_MAX_VALIDITY_DAYS) {
        throw new Error(`a manifest is valid for 1 to ${MANIFEST_MAX_VALIDITY_DAYS} days, not ${validDays}`);
    }
    const sk = privateKeyFromSeedHex(seedHex);
    const doc = JSON.parse(text);
    // The weekly job renews; it never signs a manifest for the first time. Whatever it
    // downloads from a release is data, and an unsigned one there was not written by the
    // release job (which signs before uploading).
    if (requireSigned && doc.signed === undefined) {
        throw new Error('not signed: --require-signed renews an existing signature only');
    }
    let version, files;
    if (doc.signed !== undefined) {
        // Re-sign: only a manifest THIS key signed, content unchanged.
        const body = verifyManifest(text, { publicKey: createPublicKey(sk), ignoreExpiry: true });
        ({ version, files } = body);
    } else {
        ({ version, files } = doc);
        if (typeof version !== 'string' || !version) throw new Error('the manifest has no version');
        checkFiles(files);
    }
    const body = {
        app_id: MANIFEST_APP_ID,
        version,
        files,
        issued: rfc3339(now),
        expires: rfc3339(now + validDays * DAY_MS),
    };
    const signed = JSON.stringify(body);
    const signature = edSign(null, message(signed), sk).toString('hex');
    return JSON.stringify({ version, files, signed, signature }, null, 2) + '\n';
}

function arg(argv, name) {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
}

function main(argv) {
    const [cmd, file] = argv;
    if (!['sign', 'verify'].includes(cmd) || !file) {
        console.error('usage: sign-update-manifest.mjs sign <file> --key <private.key> [--valid-days N] [--out <file>] [--require-signed]\n' +
                      '       sign-update-manifest.mjs verify <file> [--pubkey <hex>]');
        return 2;
    }
    const text = readFileSync(file, 'utf8');
    if (cmd === 'sign') {
        const keyPath = arg(argv, '--key');
        if (!keyPath) { console.error('--key <private.key> is required'); return 2; }
        const validDays = arg(argv, '--valid-days') !== undefined ? Number(arg(argv, '--valid-days')) : MANIFEST_MAX_VALIDITY_DAYS;
        const out = signManifest(text, readFileSync(keyPath, 'utf8'), { validDays, requireSigned: argv.includes('--require-signed') });
        // Never publish something the pinned key would refuse (a wrong private.key, say).
        const body = verifyManifest(out, { publicKey: arg(argv, '--pubkey') || MANIFEST_PUBLIC_KEY_HEX });
        const dest = arg(argv, '--out') || file;
        writeFileSync(dest, out, 'utf8');
        console.log(`[sign-update-manifest] ${dest}: v${body.version}, ${body.files.length} file(s), valid until ${body.expires}`);
        return 0;
    }
    const body = verifyManifest(text, { publicKey: arg(argv, '--pubkey') || MANIFEST_PUBLIC_KEY_HEX });
    console.log(`[sign-update-manifest] ${file}: OK — v${body.version}, ${body.files.length} file(s), valid until ${body.expires}`);
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (e) {
        console.error(`[sign-update-manifest] refused: ${e.message}`);
        process.exitCode = 1;
    }
}
