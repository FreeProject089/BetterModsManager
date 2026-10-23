// The access gate a generated BMM server runs, tested end to end against a real proof.
//
// WHY A REAL PROOF AND NOT A STUB
//
// The gate's job is to say yes to a client holding an authorised key and no to everything
// else. A stubbed verifier would test the parts I wrote and skip the part that actually
// decides — and the verifier is the file where a mistake is invisible, because "refuses
// everything" and "accepts everything" both look like working software until someone tries
// the other case.
//
// The proof here is BUILT INDEPENDENTLY with node:crypto rather than by calling the verifier
// backwards, so this is a genuine round trip: an implementation of the producer, checked
// against the real consumer. The producer of record is Rust
// (src-tauri/src/commands/repo_keyauth.rs); this mirrors its wire format, and if the two ever
// disagree, this test is the thing that says so.
//
// Run: node scripts/test-access-gate.mjs

import { createRequire } from 'node:module';
import { generateKeyPairSync, sign as cryptoSign, createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const templates = path.join(here, '..', 'src-tauri', 'src', 'templates', 'mini-server');

// The generated server's own layout: access-gate.js next to keyauth.mjs, with access.json in
// whichever directory is being gated. Built from the TEMPLATES, so this tests what ships.
const dir = mkdtempSync(path.join(tmpdir(), 'bmm-gate-'));
copyFileSync(path.join(templates, 'access-gate.js.template'), path.join(dir, 'access-gate.js'));
copyFileSync(path.join(templates, 'keyauth.mjs.template'), path.join(dir, 'keyauth.mjs'));

const require_ = createRequire(path.join(dir, 'x.js'));
const { checkAccess, isRestricted } = require_(path.join(dir, 'access-gate.js'));

const AUD = 'http://repo.example.com:3000';
/** Must match SIG_NAMESPACE / SIG_HASH in keyauth.mjs and repo_keyauth.rs. */
const SIG_NAMESPACE = 'bmm-key-proof';
const SIG_HASH = 'sha512';
const repo = path.join(dir, 'repo-a');
mkdirSync(repo);
// keyauth.mjs is resolved relative to access-gate.js, not to the gated folder.
copyFileSync(path.join(templates, 'keyauth.mjs.template'), path.join(repo, 'keyauth.mjs'));

// ── an ed25519 identity, and a proof made with it ───────────────────────────
const sshString = (b) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(b.length);
  return Buffer.concat([len, b]);
};

function makeIdentity() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  // The raw 32 bytes live at the tail of the SPKI DER for ed25519 (RFC 8410).
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const blob = Buffer.concat([sshString(Buffer.from('ssh-ed25519')), sshString(raw)]);
  return { privateKey, blob, line: `ssh-ed25519 ${blob.toString('base64')} test@bmm` };
}

function makeProof(id, { aud = AUD, exp = Math.floor(Date.now() / 1000) + 120, pk = null } = {}) {
  const payload = Buffer.from(JSON.stringify({
    pk: pk ?? id.blob.toString('base64'), alg: 'ssh-ed25519', aud, exp,
  })).toString('base64url');
  // Two things, both easy to get wrong and both silent when you do.
  //
  // The signed message is the base64url payload SEGMENT AS TRANSMITTED, not the JSON it
  // decodes to: signing the decoded form would make validity depend on both sides serialising
  // a map byte-for-byte identically, and a differing key order would look like a forgery.
  //
  // And an SSH signature does NOT cover that message directly — it covers the SSHSIG
  // PRE-IMAGE built from it. Signing the bare segment produces a proof that is valid-looking and refused by
  // everything, which is how this cost a whole debugging session the first time. The
  // namespace and hash are part of the pre-image, so a BMM proof cannot be replayed as an SSH
  // signature made for anything else.
  const h = createHash(SIG_HASH).update(Buffer.from(payload, 'utf8')).digest();
  const preimage = Buffer.concat([
    Buffer.from('SSHSIG', 'utf8'),        // raw, NOT length-prefixed
    sshString(Buffer.from(SIG_NAMESPACE)),
    sshString(Buffer.alloc(0)),           // reserved
    sshString(Buffer.from(SIG_HASH)),
    sshString(h),
  ]);
  const sig = cryptoSign(null, preimage, id.privateKey).toString('base64url');
  return `bmmk2.${payload}.${sig}`;
}

const reqWith = (headers = {}, query = {}) => ({ headers, query });

// ── the cases ───────────────────────────────────────────────────────────────
let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${e.message}`);
  }
};
const eq = (got, want, what) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) throw new Error(`${what}: got ${g}, wanted ${w}`);
};

const write = (obj) => writeFileSync(path.join(repo, 'access.json'), JSON.stringify(obj));
const alice = makeIdentity();
const mallory = makeIdentity();

console.log('access gate');

await check('no access.json at all is open, not denied', async () => {
  rmSync(path.join(repo, 'access.json'), { force: true });
  eq((await checkAccess(repo, reqWith())).ok, true, 'verdict');
  eq(isRestricted(repo), false, 'isRestricted');
});

await check('an empty access.json is open too', async () => {
  write({});
  eq((await checkAccess(repo, reqWith())).ok, true, 'verdict');
});

await check('a password is required once set, and 401 not 403', async () => {
  write({ password: 's3cret' });
  eq(isRestricted(repo), true, 'isRestricted');
  const bad = await checkAccess(repo, reqWith());
  eq(bad.ok, false, 'missing password'); eq(bad.status, 401, 'status');
  eq((await checkAccess(repo, reqWith({ 'x-repo-password': 'wrong' }))).ok, false, 'wrong password');
  eq((await checkAccess(repo, reqWith({ 'x-repo-password': 's3cret' }))).ok, true, 'right password');
  eq((await checkAccess(repo, reqWith({}, { password: 's3cret' }))).ok, true, 'via query');
});

await check('an authorised key opens it, and only that key', async () => {
  write({ pubkeys: [alice.line], audience: AUD });
  const good = await checkAccess(repo, reqWith({ 'x-bmm-key-proof': makeProof(alice) }));
  eq(good.ok, true, 'alice');
  const bad = await checkAccess(repo, reqWith({ 'x-bmm-key-proof': makeProof(mallory) }));
  eq(bad.ok, false, 'mallory'); eq(bad.status, 401, 'status');
  eq((await checkAccess(repo, reqWith())).ok, false, 'no proof at all');
});

await check('a proof addressed elsewhere is refused', async () => {
  write({ pubkeys: [alice.line], audience: AUD });
  const r = await checkAccess(repo, reqWith({
    'x-bmm-key-proof': makeProof(alice, { aud: 'http://someone-else.example:3000' }),
  }));
  eq(r.ok, false, 'replayed from another origin');
});

await check('an expired proof is refused', async () => {
  write({ pubkeys: [alice.line], audience: AUD });
  const r = await checkAccess(repo, reqWith({
    'x-bmm-key-proof': makeProof(alice, { exp: Math.floor(Date.now() / 1000) - 5 }),
  }));
  eq(r.ok, false, 'expired');
});

await check('mallory cannot sign for alice by claiming her key', async () => {
  // The payload names ALICE's key; the signature is mallory's. This is the case that decides
  // whether the check is real, and it is worth its own test rather than being assumed.
  write({ pubkeys: [alice.line], audience: AUD });
  const forged = makeProof(mallory, { pk: alice.blob.toString('base64') });
  eq((await checkAccess(repo, reqWith({ 'x-bmm-key-proof': forged }))).ok, false, 'forged');
});

await check('password AND key are both required when both are set', async () => {
  write({ password: 's3cret', pubkeys: [alice.line], audience: AUD });
  const proof = makeProof(alice);
  eq((await checkAccess(repo, reqWith({ 'x-bmm-key-proof': proof }))).ok, false, 'key alone');
  eq((await checkAccess(repo, reqWith({ 'x-repo-password': 's3cret' }))).ok, false, 'password alone');
  eq((await checkAccess(repo, reqWith({ 'x-repo-password': 's3cret', 'x-bmm-key-proof': proof }))).ok,
     true, 'both');
});

await check('keys listed but no audience anywhere fails CLOSED', async () => {
  // A misconfiguration must not serve a repo its owner meant to close.
  write({ pubkeys: [alice.line] });
  const r = await checkAccess(repo, reqWith({ 'x-bmm-key-proof': makeProof(alice) }), '');
  eq(r.ok, false, 'no audience'); eq(r.status, 500, 'status');
});

await check('the server-wide audience is used when access.json omits one', async () => {
  write({ pubkeys: [alice.line] });
  eq((await checkAccess(repo, reqWith({ 'x-bmm-key-proof': makeProof(alice) }), AUD)).ok, true, 'fallback');
});

rmSync(dir, { recursive: true, force: true });
if (failures) {
  console.error(`\n${failures} access-gate check(s) failed`);
  process.exit(1);
}
console.log('\n✓ access gate: every case passed, against a real ed25519 proof');
