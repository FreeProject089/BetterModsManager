// The publisher half of the signed incremental manifest (scripts/sign-update-manifest.mjs),
// and the two workflows that run it.
//
// BMM refuses an update-manifest.json that is not signed, is for another app, has expired or
// claims more than 7 days (src-tauri/src/commands/autoupdate.rs, verify_manifest_text). If the
// signer drifted from that verifier, every release would publish a manifest no installed BMM
// accepts — and nothing would say so, because a refused manifest only hides a button. So the
// constants are compared with the Rust ones, and the Rust test module verifies a document this
// signer wrote (the fixture below). TEST keys only.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'sign-update-manifest.mjs');
const M = await import(pathToFileURL(SCRIPT).href);

const SEED = '07'.repeat(32);                 // test key; its public half:
const PUB = 'ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c';
const T0 = Date.parse('2026-01-01T00:00:00Z');
const HOUR = 3_600_000, DAY = 24 * HOUR;
// Key order matters for the fixture test: it is the order gen-update-manifest.mjs writes.
const FILES = [{
    path: '_up_/frontend/Lang/en.json', sha256: 'a'.repeat(64),
    download_url: 'https://github.com/FreeProject089/BetterModsManager/releases/download/v1.2.0/lang-en.json',
    size: 10,
}];
const unsigned = (files = FILES, version = '1.2.0') => JSON.stringify({ version, files });
const signedAt = (now = T0, opts = {}) => M.signManifest(unsigned(), SEED, { now, ...opts });

describe('sign-update-manifest', () => {
    test('the test key is what the Rust tests use', () => {
        assert.equal(M.publicHex(M.privateKeyFromSeedHex(SEED)), PUB);
    });

    test('a signed manifest verifies, and carries the top-level copy for older BMM', () => {
        const doc = JSON.parse(signedAt());
        assert.equal(doc.version, '1.2.0');
        assert.deepEqual(doc.files, FILES);
        assert.match(doc.signature, /^[0-9a-f]{128}$/);
        const body = M.verifyManifest(signedAt(), { publicKey: PUB, now: T0 + HOUR });
        assert.equal(body.app_id, 'com.bettermm.desktop');
        assert.equal(body.issued, '2026-01-01T00:00:00Z');
        assert.equal(body.expires, '2026-01-08T00:00:00Z');
    });

    test('the fixture the Rust verifier checks is exactly what this signer writes', () => {
        // Ed25519 is deterministic: same seed + same message = same signature. The Rust test
        // `the_node_signer_and_this_verifier_agree` holds this signature.
        const doc = JSON.parse(M.signManifest(JSON.stringify({ version: '1.2.0', files: FILES }), SEED, { now: T0 }));
        const rust = readFileSync(join(ROOT, 'src-tauri/src/commands/autoupdate_manifest_tests.rs'), 'utf8');
        assert.ok(rust.includes(doc.signature), 'the signature in the Rust fixture');
        assert.ok(rust.includes(doc.signed), 'the signed body in the Rust fixture');
    });

    test('verify refuses what BMM refuses', () => {
        const ok = signedAt();
        const at = { publicKey: PUB, now: T0 + HOUR };
        assert.throws(() => M.verifyManifest(unsigned(), at), /not signed/);
        const other = M.signManifest(unsigned(), '09'.repeat(32), { now: T0 });
        assert.throws(() => M.verifyManifest(other, at), /does not match/);
        const tampered = JSON.parse(ok);
        tampered.signed = tampered.signed.replace('lang-en.json', 'evil.json');
        assert.throws(() => M.verifyManifest(JSON.stringify(tampered), at), /does not match/);
        assert.throws(() => M.verifyManifest(ok, { publicKey: PUB, now: T0 + 7 * DAY }), /expired/);
        assert.doesNotThrow(() => M.verifyManifest(ok, { publicKey: PUB, now: T0 + 7 * DAY - 1000 }));
    });

    test('it refuses to sign what BMM would refuse', () => {
        assert.throws(() => M.signManifest(unsigned(), SEED, { validDays: 8 }), /1 to 7 days/);
        assert.throws(() => M.signManifest(unsigned(), SEED, { validDays: 0 }), /1 to 7 days/);
        const http = [{ ...FILES[0], download_url: 'http://github.com/x' }];
        assert.throws(() => M.signManifest(unsigned(http), SEED), /not https/);
        const up = [{ ...FILES[0], path: '_up_/../../evil.dll' }];
        assert.throws(() => M.signManifest(unsigned(up), SEED), /relative path/);
        const abs = [{ ...FILES[0], path: 'C:\\Windows\\evil.dll' }];
        assert.throws(() => M.signManifest(unsigned(abs), SEED), /relative path/);
        const upper = [{ ...FILES[0], sha256: 'A'.repeat(64) }];
        assert.throws(() => M.signManifest(unsigned(upper), SEED), /lowercase hex/);
        assert.throws(() => M.signManifest('not json', SEED));
        assert.throws(() => M.signManifest(unsigned(), 'abcd'), /32 bytes/);
    });

    test('re-signing renews the dates and keeps the signed content, even when expired', () => {
        const old = signedAt(T0);
        const later = T0 + 30 * DAY;                              // long expired
        const renewed = M.signManifest(old, SEED, { now: later });
        const a = JSON.parse(JSON.parse(old).signed), b = M.verifyManifest(renewed, { publicKey: PUB, now: later + HOUR });
        assert.equal(b.version, a.version);
        assert.deepEqual(b.files, a.files);
        assert.equal(Date.parse(b.issued), later);
    });

    test('re-signing reads the signed body, never the top-level copy', () => {
        const doc = JSON.parse(signedAt());
        doc.version = '9.9.9';
        doc.files = [{ ...FILES[0], download_url: 'https://evil.example/x' }];
        const body = M.verifyManifest(M.signManifest(JSON.stringify(doc), SEED, { now: T0 }), { publicKey: PUB, now: T0 + HOUR });
        assert.equal(body.version, '1.2.0');
        assert.deepEqual(body.files, FILES);
    });

    test('re-signing refuses a manifest another key signed (no laundering)', () => {
        const foreign = M.signManifest(unsigned(), '09'.repeat(32), { now: T0 });
        assert.throws(() => M.signManifest(foreign, SEED, { now: T0 }), /does not match/);
    });

    test('the weekly job (--require-signed) never signs an unsigned manifest for the first time', () => {
        assert.throws(() => M.signManifest(unsigned(), SEED, { now: T0, requireSigned: true }), /not signed/);
        assert.doesNotThrow(() => M.signManifest(signedAt(), SEED, { now: T0 + DAY, requireSigned: true }));
    });

    test('the CLI refuses to write a manifest the pinned key would not accept', () => {
        const dir = mkdtempSync(join(tmpdir(), 'mf-sign-'));
        const file = join(dir, 'update-manifest.json');
        const key = join(dir, 'private.key');
        writeFileSync(file, unsigned());
        writeFileSync(key, SEED);                             // a TEST key, not the publisher's
        const run = spawnSync(process.execPath, [SCRIPT, 'sign', file, '--key', key], { encoding: 'utf8' });
        assert.equal(run.status, 1, run.stdout + run.stderr);
        assert.match(run.stderr, /does not match/);
        assert.equal(readFileSync(file, 'utf8'), unsigned(), 'the file is left untouched');
        const ok = spawnSync(process.execPath, [SCRIPT, 'sign', file, '--key', key, '--pubkey', PUB], { encoding: 'utf8' });
        assert.equal(ok.status, 0, ok.stdout + ok.stderr);
        const v = spawnSync(process.execPath, [SCRIPT, 'verify', file, '--pubkey', PUB], { encoding: 'utf8' });
        assert.equal(v.status, 0, v.stdout + v.stderr);
        const pinned = spawnSync(process.execPath, [SCRIPT, 'verify', file], { encoding: 'utf8' });
        assert.equal(pinned.status, 1, 'the pinned key did not sign it');
    });

    // The full-installer fallback (autoupdate.rs, download_and_install_update) runs only an
    // installer the SIGNED body lists with its SHA-256.
    const INSTALLERS = [{
        path: 'BetterModsManager_1.2.0_x64-setup.exe', sha256: 'b'.repeat(64),
        download_url: 'https://github.com/FreeProject089/BetterModsManager/releases/download/v1.2.0/BetterModsManager_1.2.0_x64-setup.exe',
        size: 20,
    }];
    const withInstallers = (installers = INSTALLERS) => JSON.stringify({ version: '1.2.0', files: FILES, installers });

    test('installers are signed into the body and survive a re-sign', () => {
        const signed = M.signManifest(withInstallers(), SEED, { now: T0 });
        const body = M.verifyManifest(signed, { publicKey: PUB, now: T0 + HOUR });
        assert.deepEqual(body.installers, INSTALLERS);
        const renewed = M.verifyManifest(M.signManifest(signed, SEED, { now: T0 + 30 * DAY }), { publicKey: PUB, now: T0 + 30 * DAY + HOUR });
        assert.deepEqual(renewed.installers, INSTALLERS);
    });

    test('no installers signs to the same bytes as before (the Rust fixture holds)', () => {
        const a = JSON.parse(M.signManifest(unsigned(), SEED, { now: T0 }));
        const b = JSON.parse(M.signManifest(withInstallers([]), SEED, { now: T0 }));
        assert.equal(b.signed, a.signed);
        assert.ok(!('installers' in JSON.parse(a.signed)));
    });

    test('an installer entry must be one https .exe/.msi name with a lowercase SHA-256', () => {
        for (const path of ['..\\setup.exe', 'sub/setup.exe', 'C:\\setup.exe', 'setup.bat', '..']) {
            assert.throws(() => M.signManifest(withInstallers([{ ...INSTALLERS[0], path }]), SEED), /installer path|relative path/, path);
        }
        assert.throws(() => M.signManifest(withInstallers([{ ...INSTALLERS[0], download_url: 'http://x.example/setup.exe' }]), SEED), /not https/);
        assert.throws(() => M.signManifest(withInstallers([{ ...INSTALLERS[0], sha256: 'B'.repeat(64) }]), SEED), /lowercase hex/);
    });

    test('the constants match the Rust verifier, the app id and the publisher key', () => {
        const rs = readFileSync(join(ROOT, 'src-tauri/src/commands/autoupdate.rs'), 'utf8');
        assert.ok(rs.includes(`"${M.MANIFEST_PUBLIC_KEY_HEX}"`), 'MANIFEST_PUBLIC_KEY_HEX');
        assert.ok(rs.includes(`b"${M.MANIFEST_SIG_CONTEXT.replace('\n', '\\n')}"`), 'MANIFEST_SIG_CONTEXT');
        assert.ok(rs.includes(`MANIFEST_APP_ID: &str = "${M.MANIFEST_APP_ID}"`), 'MANIFEST_APP_ID');
        assert.ok(rs.includes(`MANIFEST_MAX_VALIDITY_DAYS: i64 = ${M.MANIFEST_MAX_VALIDITY_DAYS};`));
        const conf = JSON.parse(readFileSync(join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8'));
        assert.equal(conf.identifier, M.MANIFEST_APP_ID);
        // BetterInstaller is a separate repository, absent from BMM's CI checkout.
        const toml = join(ROOT, 'BetterInstaller/examples/bmm/installer.toml');
        if (existsSync(toml)) {
            assert.match(readFileSync(toml, 'utf8'), new RegExp(`public_key\\s*=\\s*"${M.MANIFEST_PUBLIC_KEY_HEX}"`));
        }
    });
});

describe('the workflows that sign and re-sign it', () => {
    const wf = (n) => readFileSync(join(ROOT, '.github/workflows', n), 'utf8');

    test('every action is pinned by a full commit SHA with its tag in a comment', () => {
        for (const name of ['release.yml', 'resign-manifests.yml']) {
            const uses = [...wf(name).matchAll(/^\s*-?\s*uses:\s*(\S+)(.*)$/gm)];
            assert.ok(uses.length > 0, name);
            for (const [, ref, rest] of uses) {
                assert.match(ref, /^[\w.-]+\/[\w.\/-]+@[0-9a-f]{40}$/, `${name}: ${ref}`);
                assert.match(rest, /#\s*v?\d/, `${name}: ${ref} has no tag comment`);
            }
        }
    });

    test('the release signs update-manifest.json and uploads it with the files it names', () => {
        const y = wf('release.yml');
        assert.match(y, /sign-update-manifest\.mjs sign/);
        assert.match(y, /sign-update-manifest\.mjs verify/);
        assert.match(y, /gh release upload/);
    });

    test('the weekly job re-signs both manifests, verifies, and uploads with --clobber', () => {
        const y = wf('resign-manifests.yml');
        assert.match(y, /schedule:\s*\n\s*-\s*cron:/);
        assert.match(y, /workflow_dispatch:/);
        assert.match(y, /^permissions:\s*\{\}\s*$/m, 'nothing by default');
        assert.match(y, /contents:\s*write/);
        assert.match(y, /resign-manifest/);
        assert.match(y, /verify-manifest/);
        assert.match(y, /sign-update-manifest\.mjs sign [^\n]*--require-signed/);
        assert.match(y, /sign-update-manifest\.mjs verify/);
        assert.match(y, /--clobber/);
        // The key reaches the script through env, never through ${{ }} in script text.
        for (const line of y.split('\n').filter((l) => l.includes('secrets.'))) {
            assert.match(line, /^\s*[A-Z_]+:\s*\$\{\{\s*secrets\.\w+\s*(!=\s*''\s*)?\}\}\s*$/, line);
        }
    });
});
