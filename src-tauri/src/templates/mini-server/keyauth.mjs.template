// Verifying that a client holds the private half of a public key its owner pasted.
//
// The account-free counterpart to identity-attestation.mjs. That one answers "which account is
// this?", and needs an account; this one answers "does this client hold the key you
// authorised?", and needs nothing but the key.
//
// It exists because the other allow lists can be claimed rather than proved. `keys` in an
// access list holds CREATOR IDS, which arrive in `X-Creator-ID` — a header the client chooses.
// A public key cannot be presented that way: the holder has to sign something.
//
// Format, produced by src-tauri/src/commands/repo_keyauth.rs — keep the two in step:
//
//   bmmk2.<base64url(JSON payload)>.<base64url(signature)>
//
//   payload = { pk, alg, aud, exp }
//     pk   the OpenSSH public-key BLOB, base64 — the wire form, which NAMES ITS OWN ALGORITHM
//     alg  the SIGNATURE algorithm (an RSA key signs as rsa-sha2-512, never as legacy ssh-rsa)
//
// The signature covers the base64url payload SEGMENT AS TRANSMITTED, not the JSON it decodes
// to — signing the decoded form would make validity depend on both sides serialising a map
// byte-for-byte identically, and a differing key order would look like a forgery.
//
// v2 accepts ed25519, RSA and ECDSA. v1 was ed25519-only, which was a defensible trade at the
// time — a key type that works on one of the two enforcing servers and not the other is worse
// than one that works on neither — and the right answer to it turned out to be implementing
// both sides rather than narrowing what people may use. Windows users overwhelmingly hold an
// RSA .ppk, and telling them to regenerate their identity says their key is wrong when it is
// ours that was narrow.

import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';

const PREFIX = 'bmmk2';

// ── SSH wire format ─────────────────────────────────────────────────────────
//
// A sequence of length-prefixed byte strings. Everything below is that one rule.

function reader(buf) {
  let o = 0;
  return () => {
    if (o + 4 > buf.length) return null;
    const n = buf.readUInt32BE(o); o += 4;
    if (n > 1 << 20 || o + n > buf.length) return null;
    const b = buf.subarray(o, o + n); o += n;
    return b;
  };
}

// ── minimal DER ─────────────────────────────────────────────────────────────
//
// Node builds a key from SPKI DER and nothing else, so the SSH form has to be re-wrapped.
// Written here rather than pulled in: it is forty lines, and a dependency that parses
// attacker-supplied bytes is a bigger surface than the code it saves.

const derLen = (n) => {
  if (n < 0x80) return Buffer.from([n]);
  const b = [];
  for (let v = n; v > 0; v >>= 8) b.unshift(v & 0xff);
  return Buffer.from([0x80 | b.length, ...b]);
};
const der = (tag, body) => Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
const derSeq = (...parts) => der(0x30, Buffer.concat(parts));
const derInt = (bytes) => {
  // Strip leading zeros, then add ONE back if the top bit is set: DER integers are signed,
  // and an SSH mpint that already carries that byte would otherwise be re-signed as negative.
  let b = bytes;
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i += 1;
  b = b.subarray(i);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return der(0x02, b);
};
const derOid = (hex) => der(0x06, Buffer.from(hex, 'hex'));
const derBitString = (body) => der(0x03, Buffer.concat([Buffer.from([0]), body]));

const OID_RSA = '2a864886f70d010101';           // 1.2.840.113549.1.1.1
const OID_EC = '2a8648ce3d0201';                // 1.2.840.10045.2.1
const CURVES = {
  'nistp256': { oid: '2a8648ce3d030107', hash: 'sha256', field: 32 },
  'nistp384': { oid: '2b81040022', hash: 'sha384', field: 48 },
  'nistp521': { oid: '2b81040023', hash: 'sha512', field: 66 },
};

/**
 * The base64 OpenSSH public-key BLOB from a one-line public key.
 *
 * That second field of `ssh-ed25519 AAAA… you@machine` IS the blob, so this validates rather
 * than converts: an owner stores what a proof presents, with nothing in between that could
 * disagree. Returns null for anything unreadable, or for a key type nothing here can verify —
 * a different answer from "malformed", which the caller distinguishes.
 */
export function pubkeyFromOpenssh(line) {
  const parts = String(line || '').trim().split(/\s+/);
  if (parts.length < 2) return null;
  let blob;
  try { blob = Buffer.from(parts[1], 'base64'); } catch { return null; }
  const read = reader(blob);
  const alg = read();
  if (!alg || alg.toString() !== parts[0]) return null; // the word and the blob must agree
  if (!keyFromBlob(blob)) return null;
  // Re-encoded rather than echoed, so whitespace or padding in what was pasted cannot make
  // two spellings of one key compare unequal.
  return blob.toString('base64');
}

/** A Node public key from an OpenSSH blob, or null when it is not one we can verify. */
function keyFromBlob(blob) {
  const read = reader(blob);
  const algBuf = read();
  if (!algBuf) return null;
  const alg = algBuf.toString();

  try {
    if (alg === 'ssh-ed25519') {
      const raw = read();
      if (!raw || raw.length !== 32) return null;
      // SubjectPublicKeyInfo header for Ed25519 (RFC 8410): fixed bytes, then the 32-byte key.
      const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
      return createPublicKey({ key: spki, format: 'der', type: 'spki' });
    }

    if (alg === 'ssh-rsa') {
      const e = read();
      const n = read();
      if (!e || !n) return null;
      const spki = derSeq(
        derSeq(derOid(OID_RSA), Buffer.from([0x05, 0x00])),
        derBitString(derSeq(derInt(n), derInt(e))),
      );
      return createPublicKey({ key: spki, format: 'der', type: 'spki' });
    }

    if (alg.startsWith('ecdsa-sha2-')) {
      const curveName = read();
      const point = read();
      if (!curveName || !point) return null;
      const curve = CURVES[curveName.toString()];
      // The algorithm word repeats the curve. They must agree, or a proof could claim P-521's
      // hash while carrying a P-256 point.
      if (!curve || alg !== `ecdsa-sha2-${curveName.toString()}`) return null;
      if (point[0] !== 0x04) return null; // uncompressed point; nothing else is used here
      const spki = derSeq(
        derSeq(derOid(OID_EC), derOid(curve.oid)),
        derBitString(point),
      );
      return createPublicKey({ key: spki, format: 'der', type: 'spki' });
    }
  } catch {
    return null;
  }
  return null; // ssh-dss and anything else: not verified here, so not accepted anywhere
}

/** What the algorithm word implies about hashing and signature shape. */
function algSpec(alg) {
  if (alg === 'ssh-ed25519') return { kind: 'ed25519' };
  if (alg === 'rsa-sha2-256') return { kind: 'rsa', hash: 'sha256' };
  if (alg === 'rsa-sha2-512') return { kind: 'rsa', hash: 'sha512' };
  // Legacy SHA-1 `ssh-rsa` is deliberately absent: OpenSSH has refused it by default since
  // 8.8, and accepting it here would make this the weakest door in the building.
  if (alg.startsWith('ecdsa-sha2-')) {
    const curve = CURVES[alg.slice('ecdsa-sha2-'.length)];
    return curve ? { kind: 'ecdsa', hash: curve.hash, field: curve.field } : null;
  }
  return null;
}

/**
 * An SSH ECDSA signature — `[len]r[len]s` — as the fixed-width `r || s` Node wants with
 * `dsaEncoding: 'ieee-p1363'`.
 *
 * SSH mpints carry a leading zero on any value whose top bit is set, and drop leading zeros
 * otherwise, so neither half is reliably the field width. Getting this wrong works on most
 * signatures and fails on roughly one in two hundred, which is the worst kind of wrong.
 */
function ecdsaSshToP1363(sig, field) {
  const read = reader(sig);
  const r = read();
  const s = read();
  if (!r || !s) return null;
  const pad = (v) => {
    let i = 0;
    while (i < v.length - 1 && v[i] === 0) i += 1;
    const t = v.subarray(i);
    if (t.length > field) return null;
    return Buffer.concat([Buffer.alloc(field - t.length), t]);
  };
  const pr = pad(r); const ps = pad(s);
  if (!pr || !ps) return null;
  return Buffer.concat([pr, ps]);
}


/** A length-prefixed SSH string. */
function sshString(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(b.length);
  return Buffer.concat([len, b]);
}

/**
 * What an SSH signature actually covers.
 *
 * ssh-key signs the SSHSIG pre-image, not the message: `"SSHSIG" || namespace || reserved ||
 * hash_algorithm || H(message)` (PROTOCOL.sshsig). Verifying the bare message here failed all
 * three algorithms identically — which is what a wrong pre-image looks like, and why it was
 * worth cross-checking against real proofs instead of reasoning about it.
 *
 * The namespace is part of what is hashed, so a signature made for BMM cannot be replayed as
 * an SSH signature made for anything else, nor the reverse.
 */
function sshsigPreimage(namespace, hashAlg, message) {
  const h = createHash(hashAlg).update(message).digest();
  return Buffer.concat([
    Buffer.from('SSHSIG', 'utf8'),   // raw, NOT length-prefixed
    sshString(namespace),
    sshString(''),                   // reserved
    sshString(hashAlg),
    sshString(h),
  ]);
}

/** The namespace BMM signs under — must match SIG_NAMESPACE in repo_keyauth.rs. */
const SIG_NAMESPACE = 'bmm-key-proof';
/** The hash BMM passes to ssh-key. Part of the pre-image, so it cannot be inferred. */
const SIG_HASH = 'sha512';

/**
 * Verify a proof.
 *
 * `authorised` is a list of OpenSSH public-key LINES as the owner pasted them — converted
 * here, so callers store what people typed and never a second representation that could drift.
 *
 * Returns `{ ok: true, pk }` or `{ ok: false, reason }`. A reason rather than a bare false so
 * a log can say which of six failures happened; it is deliberately NOT returned to the client,
 * where it would tell a prober whether a key is authorised.
 */
export function verifyProof(proof, authorised, audience) {
  const parts = String(proof || '').split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, reason: 'format' };

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch { return { ok: false, reason: 'format' }; }
  if (!payload || typeof payload.pk !== 'string' || typeof payload.alg !== 'string'
      || typeof payload.aud !== 'string' || typeof payload.exp !== 'number') {
    return { ok: false, reason: 'format' };
  }

  // Expiry and audience before the signature: a flood of stale or misdirected proofs then
  // costs a comparison rather than a public-key operation each.
  if (payload.exp * 1000 <= Date.now()) return { ok: false, reason: 'expired' };
  if (payload.aud !== audience) return { ok: false, reason: 'audience' };

  const allowed = (authorised || []).map(pubkeyFromOpenssh).filter(Boolean);
  if (!allowed.includes(payload.pk)) return { ok: false, reason: 'not_authorised' };

  let blob;
  try { blob = Buffer.from(payload.pk, 'base64'); } catch { return { ok: false, reason: 'format' }; }
  const key = keyFromBlob(blob);
  const spec = algSpec(payload.alg);
  if (!key || !spec) return { ok: false, reason: 'format' };

  // The signature algorithm has to match the KEY, or an RSA signature could be presented
  // against an ed25519 key it was never made with.
  const keyAlg = reader(blob)()?.toString();
  const matches = (spec.kind === 'ed25519' && keyAlg === 'ssh-ed25519')
    || (spec.kind === 'rsa' && keyAlg === 'ssh-rsa')
    || (spec.kind === 'ecdsa' && keyAlg === payload.alg);
  if (!matches) return { ok: false, reason: 'format' };

  let sig;
  try { sig = Buffer.from(parts[2], 'base64url'); } catch { return { ok: false, reason: 'format' }; }

  // The SEGMENT, exactly as transmitted — see the header note — wrapped in the SSHSIG
  // pre-image, which is what an SSH signature actually covers.
  const msg = sshsigPreimage(SIG_NAMESPACE, SIG_HASH, Buffer.from(parts[1], 'utf8'));
  let ok = false;
  try {
    if (spec.kind === 'ed25519') {
      ok = sig.length === 64 && cryptoVerify(null, msg, key, sig);
    } else if (spec.kind === 'rsa') {
      ok = cryptoVerify(spec.hash, msg, key, sig);
    } else {
      const p1363 = ecdsaSshToP1363(sig, spec.field);
      ok = !!p1363 && cryptoVerify(spec.hash, msg, { key, dsaEncoding: 'ieee-p1363' }, p1363);
    }
  } catch {
    ok = false;
  }
  return ok ? { ok: true, pk: payload.pk } : { ok: false, reason: 'signature' };
}

/**
 * What a proof presented to THIS platform must be addressed to.
 *
 * The client signs the origin it dialled, so this is our own public origin — taken from
 * SITE_URL, the same value every other outward-facing URL is built from. Deriving it from the
 * request's Host header instead would be worthless: an attacker replaying a proof captured
 * elsewhere would simply send the Host that matches it.
 */
export function keyAudience() {
  const raw = process.env.SITE_URL || '';
  try {
    return new URL(raw).origin;
  } catch {
    // No SITE_URL is a misconfiguration, and returning something guessable would quietly
    // accept proofs meant for anywhere. An audience nothing can match fails closed.
    return ' invalid-site-url';
  }
}

/** The header a BMM client sends. */
export const KEY_PROOF_HEADER = 'x-bmm-key-proof';

/**
 * Does this request satisfy an access list's public-key requirement?
 *
 * `true` when the list has no public keys — an empty requirement is not a requirement, the
 * same meaning a blank password has everywhere else here.
 */
export function keyAuthOk(list, req, audience) {
  const authorised = (list?.pubkeys || []).filter((k) => typeof k === 'string' && k.trim());
  if (!authorised.length) return { ok: true, pk: null };
  const proof = req?.headers?.[KEY_PROOF_HEADER];
  if (typeof proof !== 'string' || !proof) return { ok: false, reason: 'missing' };
  return verifyProof(proof, authorised, audience);
}
