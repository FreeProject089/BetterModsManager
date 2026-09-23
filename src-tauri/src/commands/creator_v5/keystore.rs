//! The creator key v5 core: store, chain, fingerprint, proof, sealing and persistence.
//!
//! No `tauri`, no `crate::` — `benchmarks/rust` `#[path]`-includes this file verbatim, so the
//! numbers it reports are for the code that ships. The Tauri glue (paths, the registry, the
//! keyring, the commands) lives in `../creator_v5.rs`, whose header explains the design and
//! what v5.1 adds.
// Test doubles (MemVault, NoVault), the portable encode/decode wrappers and the keyring seal
// are used by the tests, the benchmark crate and the non-Windows build, not by the Windows app.
#![cfg_attr(not(test), allow(dead_code))]
use std::collections::BTreeMap;
use std::fmt;
use std::fs;
use std::io::Write as _;
use std::path::Path;
use std::sync::Mutex;

use base64::Engine;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

/// The sealed store beside data.json.
pub const V5_STORE_FILE: &str = "creator_v5.key";
/// Vault entry holding a copy of the same sealed bytes (the registry value on Windows).
pub const V5_REG_VALUE: &str = "K5";
/// The identity pin, as a file beside the store…
pub const V5_PIN_FILE: &str = "creator_v5.pin";
/// …and as a vault entry. Both are written with the first store and checked on every load.
pub const V5_PIN_VALUE: &str = "P5";
/// Vault entry holding the key that opens a `Wrapped` store (macOS Keychain / Secret Service).
pub const V5_WRAP_VALUE: &str = "W5";
/// Held (OS file lock) around load-migrate, rotate and reset, so two BMMs cannot fork a chain.
pub const V5_LOCK_FILE: &str = "creator_v5.lock";
/// Append-only record of the events that change what the store holds outside a rotation.
pub const V5_LOG_FILE: &str = "creator_v5.log";
/// Life of a proof. Same as v1: making another costs one signature.
pub const PROOF_TTL_SECONDS: u64 = 120;
/// Longest rotation chain a proof may carry. A verifier refuses more (see the BCWEB side).
pub const MAX_CHAIN: usize = 8;
/// Hash rounds per fingerprint component. The inputs of a group are mostly high-entropy
/// serials, but one (the 32-bit volume serial) is not, and the server knows its own salt.
const FP_ROUNDS: u32 = 20_000;
/// Fingerprint format version, inside the proof.
const FP_VERSION: u32 = 1;

const MAGIC_DPAPI: &[u8; 8] = b"BMMK5DP1";
const MAGIC_WRAPPED: &[u8; 8] = b"BMMK5KR1";
const MAGIC_PLAIN: &[u8; 8] = b"BMMK5PL1";
const DPAPI_ENTROPY: &[u8] = b"BMM-CREATOR-KEY-V5";

/// Prefix of every "this store is not yours / not the latest" error. The settings screen
/// matches it to offer the reset, instead of showing a raw message with no way out.
pub const REFUSED: &str = "bmm.creator.refused|";

fn refused(why: impl fmt::Display) -> String { format!("{}{}", REFUSED, why) }
fn short(id: &str) -> &str { &id[..id.len().min(16)] }

fn b64u() -> base64::engine::GeneralPurpose { base64::engine::general_purpose::URL_SAFE_NO_PAD }

pub fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn random_32() -> [u8; 32] {
    use rand::RngCore;
    let mut b = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut b);
    b
}

pub fn random_16() -> [u8; 16] {
    use rand::RngCore;
    let mut b = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut b);
    b
}

fn random_12() -> [u8; 12] {
    use rand::RngCore;
    let mut b = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut b);
    b
}

/// A seed, wiped when it goes out of scope.
pub type Seed = Zeroizing<[u8; 32]>;

fn seed_from_hex(h: &str) -> Result<Seed, String> {
    let v = Zeroizing::new(hex::decode(h).map_err(|_| "bad seed".to_string())?);
    if v.len() != 32 { return Err("bad seed length".into()); }
    let mut out = Zeroizing::new([0u8; 32]);
    out.copy_from_slice(&v);
    Ok(out)
}

fn seed_hex(seed: &[u8; 32]) -> Zeroizing<String> { Zeroizing::new(hex::encode(seed)) }

fn pk_hex(k: &SigningKey) -> String {
    let vk: VerifyingKey = k.into();
    hex::encode(vk.to_bytes())
}

// ─────────────────────────────────────────────────────────────────────────────
// The key store
// ─────────────────────────────────────────────────────────────────────────────

/// Where the root came from. Shown to the user and to staff, because it decides how much
/// the root can be trusted (see the module note).
pub const ROOT_V4_DERIVED: &str = "v4-derived";
pub const ROOT_RANDOM: &str = "random";

/// The seeds are `Zeroizing<String>`: wiped on drop, including every clone, and `Debug` never
/// prints them. (`SigningKey` wipes itself too: ed25519-dalek's `zeroize` feature is on.)
#[derive(Clone, Serialize, Deserialize, PartialEq)]
pub struct KeyStoreV5 {
    /// Always 5.
    pub v: u32,
    /// `v4-derived` or `random`.
    pub root_kind: String,
    /// Hex seed of the root key — the Creator ID's private half.
    pub root: Zeroizing<String>,
    /// Hex seed of the active key, which signs proofs.
    pub active: Zeroizing<String>,
    /// `bmmk5` rotation certificates from the root to the active key, oldest first.
    #[serde(default)]
    pub chain: Vec<String>,
    pub created: u64,
    #[serde(default)]
    pub rotated: u64,
    /// v5.1: the root's signature over every other field but the seeds (`bmms5`, see
    /// `signed_payload`). Empty only in a store written by v5.0, which is signed on first load.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub sig: String,
}

impl fmt::Debug for KeyStoreV5 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("KeyStoreV5")
            .field("v", &self.v)
            .field("root_kind", &self.root_kind)
            .field("cid", &self.cid().unwrap_or_default())
            .field("kid", &self.kid().unwrap_or_default())
            .field("seq", &self.seq())
            .field("created", &self.created)
            .field("rotated", &self.rotated)
            .field("signed", &self.is_signed())
            .finish_non_exhaustive()
    }
}

impl KeyStoreV5 {
    /// A store around an existing root. A v4-derived root is rotated at once, so the key that
    /// signs proofs is never one the hardware can reproduce; a random root signs its own.
    pub fn from_root(root_seed: [u8; 32], root_kind: &str, now: u64, first_active: [u8; 32]) -> Result<Self, String> {
        let root_seed = Zeroizing::new(root_seed);
        let first_active = Zeroizing::new(first_active);
        let mut s = KeyStoreV5 {
            v: 5,
            root_kind: root_kind.to_string(),
            root: seed_hex(&root_seed),
            active: seed_hex(&root_seed),
            chain: Vec::new(),
            created: now,
            rotated: 0,
            sig: String::new(),
        };
        if root_kind == ROOT_V4_DERIVED {
            s.rotate(*first_active, now)?;
        } else {
            s.sign()?;
        }
        Ok(s)
    }

    pub fn root_key(&self) -> Result<SigningKey, String> { let seed = seed_from_hex(&self.root)?; Ok(SigningKey::from_bytes(&seed)) }
    pub fn active_key(&self) -> Result<SigningKey, String> { let seed = seed_from_hex(&self.active)?; Ok(SigningKey::from_bytes(&seed)) }
    /// The Creator ID: the root's public key. Never changes for the life of the store.
    pub fn cid(&self) -> Result<String, String> { Ok(pk_hex(&self.root_key()?)) }
    /// The key id: the active key's public key.
    pub fn kid(&self) -> Result<String, String> { Ok(pk_hex(&self.active_key()?)) }
    pub fn seq(&self) -> usize { self.chain.len() }
    pub fn is_signed(&self) -> bool { !self.sig.is_empty() }

    /// Replace the active key; the CURRENT active key signs the certificate for the new one.
    pub fn rotate(&mut self, next_seed: [u8; 32], now: u64) -> Result<(), String> {
        let next_seed = Zeroizing::new(next_seed);
        if self.chain.len() >= MAX_CHAIN {
            return Err(format!("Rotation chain is full ({} links)", MAX_CHAIN));
        }
        let prev = self.active_key()?;
        let next = SigningKey::from_bytes(&next_seed);
        let cert = make_rotation_cert(&prev, &self.cid()?, &(&next).into(), self.chain.len() + 1, now);
        self.chain.push(cert);
        self.active = seed_hex(&next_seed);
        self.rotated = now;
        self.sign()
    }

    /// What the store signature covers: everything but the seeds, which it covers through
    /// `cid` and `kid` (their public halves). Hand-built, field order fixed; strings go
    /// through the JSON encoder so an edited `root_kind` cannot break out of its quotes.
    fn signed_payload(&self) -> Result<String, String> {
        let q = |s: &str| serde_json::to_string(s).unwrap_or_default();
        Ok(format!(
            r#"{{"t":"bmm-store","v":{},"cid":"{}","kid":"{}","root_kind":{},"created":{},"rotated":{},"chain":[{}]}}"#,
            self.v, self.cid()?, self.kid()?, q(&self.root_kind), self.created, self.rotated,
            self.chain.iter().map(|c| q(c)).collect::<Vec<_>>().join(",")
        ))
    }

    /// (Re)sign with the root. Every constructor and every rotation ends here.
    pub fn sign(&mut self) -> Result<(), String> {
        let msg = format!("bmms5.{}", self.signed_payload()?);
        self.sig = b64u().encode(self.root_key()?.sign(msg.as_bytes()).to_bytes());
        Ok(())
    }

    fn verify_sig(&self) -> Result<(), String> {
        let raw = b64u().decode(&self.sig).map_err(|_| "store signature malformed".to_string())?;
        let arr: [u8; 64] = raw.try_into().map_err(|_| "store signature malformed".to_string())?;
        vk_from_hex(&self.cid()?)?
            .verify(format!("bmms5.{}", self.signed_payload()?).as_bytes(), &Signature::from_bytes(&arr))
            .map_err(|_| "the store was altered: its signature does not match its contents".to_string())
    }

    /// The store is internally consistent: signed by its root (when signed at all — only a
    /// v5.0 store is not, and `load_at` refuses those once an identity is pinned), and the
    /// chain leads from `cid` to the active key.
    pub fn validate(&self) -> Result<(), String> {
        if self.v != 5 { return Err("not a v5 store".into()); }
        if self.is_signed() { self.verify_sig()?; }
        let end = verify_chain(&self.cid()?, &self.chain)?;
        if end != self.kid()? { return Err("chain does not end at the active key".into()); }
        Ok(())
    }
}

/// A digest of the first links of a chain: what a pin remembers of it.
pub fn chain_head(chain: &[String]) -> String {
    let mut h = Sha256::new();
    h.update(b"bmm-chain-head|");
    for c in chain { h.update(c.as_bytes()); h.update(b"\n"); }
    hex::encode(h.finalize())
}

/// `bmmk5.<b64u(payload)>.<b64u(sig)>`, payload
/// `{"t":"bmm-key-rotate","cid":…,"prev":…,"next":…,"seq":n,"iat":…}` signed by `prev` over
/// `"bmmk5." + payload segment`. Hand-built JSON: the field order is part of what is signed.
pub fn make_rotation_cert(prev: &SigningKey, cid: &str, next: &VerifyingKey, seq: usize, iat: u64) -> String {
    let payload = format!(
        r#"{{"t":"bmm-key-rotate","cid":"{}","prev":"{}","next":"{}","seq":{},"iat":{}}}"#,
        cid, pk_hex(prev), hex::encode(next.to_bytes()), seq, iat
    );
    let seg = b64u().encode(payload.as_bytes());
    let sig: Signature = prev.sign(format!("bmmk5.{}", seg).as_bytes());
    format!("bmmk5.{}.{}", seg, b64u().encode(sig.to_bytes()))
}

fn vk_from_hex(h: &str) -> Result<VerifyingKey, String> {
    let b = hex::decode(h).map_err(|_| "bad key hex".to_string())?;
    let a: [u8; 32] = b.try_into().map_err(|_| "bad key length".to_string())?;
    VerifyingKey::from_bytes(&a).map_err(|_| "bad key".to_string())
}

/// Walk a chain from `cid`. Returns the key it ends at (the `cid` itself for an empty chain).
/// The same rules as `apps/api/src/lib/creator-proof.mjs` — keep the two in step.
pub fn verify_chain(cid: &str, chain: &[String]) -> Result<String, String> {
    if chain.len() > MAX_CHAIN { return Err("chain too long".into()); }
    let mut cur = cid.to_lowercase();
    for (i, cert) in chain.iter().enumerate() {
        let parts: Vec<&str> = cert.split('.').collect();
        if parts.len() != 3 || parts[0] != "bmmk5" { return Err(format!("link {} malformed", i + 1)); }
        let payload: serde_json::Value = serde_json::from_slice(
            &b64u().decode(parts[1]).map_err(|_| format!("link {} bad encoding", i + 1))?,
        ).map_err(|_| format!("link {} bad json", i + 1))?;
        let get = |k: &str| payload.get(k).and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
        if payload.get("t").and_then(|v| v.as_str()) != Some("bmm-key-rotate") { return Err(format!("link {} wrong type", i + 1)); }
        if get("cid") != cid.to_lowercase() { return Err(format!("link {} names another id", i + 1)); }
        if get("prev") != cur { return Err(format!("link {} does not follow", i + 1)); }
        if payload.get("seq").and_then(|v| v.as_u64()) != Some((i + 1) as u64) { return Err(format!("link {} out of order", i + 1)); }
        let sig_b = b64u().decode(parts[2]).map_err(|_| format!("link {} bad signature", i + 1))?;
        let sig_a: [u8; 64] = sig_b.try_into().map_err(|_| format!("link {} bad signature", i + 1))?;
        vk_from_hex(&cur)?
            .verify(format!("bmmk5.{}", parts[1]).as_bytes(), &Signature::from_bytes(&sig_a))
            .map_err(|_| format!("link {} signature invalid", i + 1))?;
        let next = get("next");
        vk_from_hex(&next)?;
        cur = next;
    }
    Ok(cur)
}

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprint — salted, hashed, per component
// ─────────────────────────────────────────────────────────────────────────────

/// One hashed value per group; `None` when nothing in the group could be read.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct FingerprintV5 {
    pub board: Option<String>,
    pub os: Option<String>,
    pub disk: Option<String>,
    pub canvas: Option<String>,
}

/// Which raw markers make up each group, and whether each one DISTINGUISHES a machine.
///
/// The `bool` is the part that was missing, and it is the whole difference between a
/// fingerprint and a coincidence. Three of these markers name a MODEL, not a unit:
///
///   · `CpuId` is `Win32_Processor.ProcessorId` — the CPUID signature plus the feature
///     flags. Intel removed the per-unit serial in 2000; every processor of the same model
///     and stepping reports the same string, so a few million PCs share each value;
///   · `DiskModel` is the drive's marketing name;
///   · `ProductId` / `InstallDate` come from the Windows image: every machine imaged from
///     one corporate WIM shares them to the second.
///
/// A group is emitted only when at least one STRONG member survived. Without that rule a
/// board whose firmware reports placeholders (see `is_placeholder`) falls back to CpuId
/// alone, and two unrelated people with the same CPU get the SAME `board` hash — which the
/// admin analyser weights as the strongest possible evidence that they are one person.
/// A group that identifies nobody must be ABSENT, not a constant shared by thousands.
const GROUPS: &[(&str, &[(&str, bool)])] = &[
    ("board", &[("SystemUUID", true), ("BaseboardSerial", true), ("BiosSerial", true), ("CpuId", false)]),
    ("os", &[("MachineGuid", true), ("ProductId", false), ("InstallDate", false)]),
    ("disk", &[("DiskSn", true), ("VolumeSn", true), ("DiskModel", false)]),
];

/// Firmware values that are not serial numbers: the strings OEMs ship when the field was
/// never filled in, plus anything that is one character repeated.
///
/// These are common — "Default string" is the AMI factory value on a large share of
/// self-built and budget desktops, and `03000200-0400-0500-0006-000700080009` is the
/// board UUID those same boards report. Hashing them produces a perfectly stable hash of
/// a constant: identical on every such machine on earth. `hwid_v4_fields` only ever
/// dropped the all-F UUID, and it must not start dropping more — the v4 Creator ID is
/// derived from that exact map and every existing install's identity depends on its
/// bytes. So the filtering lives HERE, where it changes only the fingerprint.
pub fn is_placeholder(v: &str) -> bool {
    let u = v.trim().to_uppercase();
    if u.is_empty() { return true; }
    // One character repeated: "0000…", "XXXX…", "……", "--------".
    if u.len() >= 4 && u.bytes().all(|b| b == u.as_bytes()[0]) { return true; }
    // A UUID whose hex digits are all the same nibble (all-zero, all-F).
    let hex: String = u.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if u.len() == 36 && hex.len() == 32 && hex.bytes().all(|b| b == hex.as_bytes()[0]) { return true; }
    matches!(u.as_str(),
        "NONE" | "N/A" | "NA" | "NOT APPLICABLE" | "NOT SPECIFIED" | "NOT AVAILABLE" | "UNKNOWN"
        | "DEFAULT STRING" | "DEFAULT" | "TO BE FILLED BY O.E.M." | "TO BE FILLED BY OEM"
        | "FILLED BY O.E.M." | "FILLED BY OEM" | "OEM" | "O.E.M."
        | "SYSTEM SERIAL NUMBER" | "BASE BOARD SERIAL NUMBER" | "BASEBOARD SERIAL NUMBER"
        | "CHASSIS SERIAL NUMBER" | "SERIAL NUMBER" | "SERIAL" | "PRODUCT SERIAL NUMBER"
        | "0123456789" | "123456789" | "1234567890" | "INVALID" | "EMPTY" | "NULL"
        | "03000200-0400-0500-0006-000700080009")
}

fn fp_key(aud: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"BMM-FP-V5|salt|");
    h.update(aud.as_bytes());
    h.finalize().into()
}

fn fp_hash(key: &[u8; 32], name: &str, material: &str) -> String {
    let mut h = Sha256::new();
    h.update(key);
    h.update(b"|");
    h.update(name.as_bytes());
    h.update(b"|");
    h.update(material.as_bytes());
    let mut cur: [u8; 32] = h.finalize().into();
    for _ in 0..FP_ROUNDS {
        let mut hh = Sha256::new();
        hh.update(cur);
        hh.update(key);
        cur = hh.finalize().into();
    }
    hex::encode(&cur[..16])
}

/// Is this a 64-hex digest? The only canvas input Rust accepts — never pixels, never a data URL.
pub fn is_digest(s: &str) -> bool { s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()) }

/// Hash the raw markers into per-group components for one audience.
pub fn fingerprint_for(fields: &BTreeMap<&str, String>, canvas_digest: Option<&str>, aud: &str) -> FingerprintV5 {
    let key = fp_key(aud);
    let group = |name: &str, members: &[(&str, bool)]| -> Option<String> {
        let mut material = String::new();
        let mut strong = false;
        for (m, is_strong) in members {
            let raw = fields.get(m).map(|s| s.trim().to_uppercase()).unwrap_or_default();
            // A placeholder is treated exactly as a missing value: it goes into the material
            // as empty, so a machine that starts reporting a real serial changes its hash
            // once and then stays put, and it never counts towards `strong`.
            let v = if is_placeholder(&raw) { String::new() } else { raw };
            if !v.is_empty() && *is_strong { strong = true; }
            material.push_str(m);
            material.push('=');
            material.push_str(&v);
            material.push('|');
        }
        // No strong member: whatever is left names a CPU model or a Windows image, which is
        // shared by millions. Report nothing rather than a hash that means nothing.
        if strong { Some(fp_hash(&key, name, &material)) } else { None }
    };
    let mut fp = FingerprintV5::default();
    for (name, members) in GROUPS {
        let v = group(name, members);
        match *name { "board" => fp.board = v, "os" => fp.os = v, _ => fp.disk = v }
    }
    fp.canvas = canvas_digest
        .map(|c| c.trim().to_lowercase())
        .filter(|c| is_digest(c))
        .map(|c| fp_hash(&key, "canvas", &c));
    fp
}

/// Most audiences one process remembers fingerprints for. BMM talks to one or two servers;
/// the bound is for a page that cycles through audiences (`aud` is the caller's choice).
pub const FP_CACHE_MAX: usize = 32;

/// Fingerprints per (audience, canvas digest). A fingerprint is a pure function of the
/// hardware markers (fixed for the process), the canvas digest and the audience, and costs
/// 4 × 20 000 SHA-256 — milliseconds on every proof, for the same answer every time.
pub struct FpCache {
    map: Mutex<BTreeMap<(String, Option<String>), FingerprintV5>>,
    misses: std::sync::atomic::AtomicUsize,
}
impl FpCache {
    pub const fn new() -> Self {
        FpCache { map: Mutex::new(BTreeMap::new()), misses: std::sync::atomic::AtomicUsize::new(0) }
    }
    pub fn len(&self) -> usize { self.map.lock().map(|m| m.len()).unwrap_or(0) }
    pub fn is_empty(&self) -> bool { self.len() == 0 }
    pub fn misses(&self) -> usize { self.misses.load(std::sync::atomic::Ordering::Relaxed) }
    /// `fields` must be the same map for the life of the cache (the process's hardware).
    pub fn get(&self, fields: &BTreeMap<&str, String>, canvas: Option<&str>, aud: &str) -> FingerprintV5 {
        // Keyed by what `fingerprint_for` actually uses: a canvas value it would drop is None.
        let canvas = canvas.map(|c| c.trim().to_lowercase()).filter(|c| is_digest(c));
        let key = (aud.to_string(), canvas);
        if let Some(fp) = self.map.lock().ok().and_then(|m| m.get(&key).cloned()) { return fp; }
        // Computed outside the lock: a proof for another server does not wait on this one.
        self.misses.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let fp = fingerprint_for(fields, key.1.as_deref(), aud);
        if let Ok(mut m) = self.map.lock() {
            if m.len() >= FP_CACHE_MAX { m.clear(); }
            m.insert(key, fp.clone());
        }
        fp
    }
}
impl Default for FpCache { fn default() -> Self { Self::new() } }

fn fp_json(fp: &FingerprintV5) -> String {
    let mut s = format!(r#"{{"fv":{}"#, FP_VERSION);
    for (k, v) in [("board", &fp.board), ("os", &fp.os), ("disk", &fp.disk), ("canvas", &fp.canvas)] {
        if let Some(v) = v { s.push_str(&format!(r#","{}":"{}""#, k, v)); }
    }
    s.push('}');
    s
}

// ─────────────────────────────────────────────────────────────────────────────
// Proof
// ─────────────────────────────────────────────────────────────────────────────

/// An origin, not a URL — the same rule as v1's `creator_proof`.
pub fn validate_aud(aud: &str) -> Result<String, String> {
    let aud = aud.trim().trim_end_matches('/');
    let rest = aud
        .strip_prefix("https://")
        .or_else(|| aud.strip_prefix("http://"))
        .ok_or_else(|| "Audience must be an http(s) origin".to_string())?;
    if rest.is_empty() || rest.contains('/') || rest.contains('?') || rest.contains('#') || rest.contains('"') || rest.contains('\\') {
        return Err("Audience must be an origin, not a URL".to_string());
    }
    Ok(aud.to_string())
}

/// `bmmc5.<b64u(payload)>.<b64u(sig)>`, signed by the ACTIVE key over `"bmmc5." + payload`.
///
/// payload = `{"v":5,"cid":…,"kid":…,"aud":…,"iat":…,"exp":…,"nonce":…,"fp":{…},"chain":[…]}`
/// in exactly that order.
pub fn build_proof(store: &KeyStoreV5, aud: &str, now: u64, nonce: [u8; 16], fp: &FingerprintV5) -> Result<String, String> {
    let aud = validate_aud(aud)?;
    let active = store.active_key()?;
    let chain = store.chain.iter().map(|c| format!("\"{}\"", c)).collect::<Vec<_>>().join(",");
    let payload = format!(
        r#"{{"v":5,"cid":"{}","kid":"{}","aud":"{}","iat":{},"exp":{},"nonce":"{}","fp":{},"chain":[{}]}}"#,
        store.cid()?, pk_hex(&active), aud, now, now + PROOF_TTL_SECONDS, hex::encode(nonce), fp_json(fp), chain
    );
    let seg = b64u().encode(payload.as_bytes());
    let sig: Signature = active.sign(format!("bmmc5.{}", seg).as_bytes());
    Ok(format!("bmmc5.{}.{}", seg, b64u().encode(sig.to_bytes())))
}

// ─────────────────────────────────────────────────────────────────────────────
// Sealing — how the store's bytes are protected at rest
// ─────────────────────────────────────────────────────────────────────────────

/// How a store is sealed. `protection()` is what `creator_key_info` reports.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Seal {
    /// Windows DPAPI, user scope, app entropy. Undecryptable by another Windows account or PC.
    Dpapi,
    /// AES-256-GCM under a random key held by the OS keyring (`V5_WRAP_VALUE`); the label is
    /// the keyring's name ("keychain" on macOS, "secret-service" on Linux).
    Wrapped(&'static str),
    /// No OS protection: the store is plain JSON in a file only its owner may read (0600).
    Plain,
}

impl Seal {
    pub fn protection(&self) -> &'static str {
        match self { Seal::Dpapi => "dpapi", Seal::Wrapped(label) => label, Seal::Plain => "file-0600" }
    }
    /// What a store is sealed with when the vault does not say otherwise.
    pub fn platform_default() -> Seal { if cfg!(target_os = "windows") { Seal::Dpapi } else { Seal::Plain } }
    fn magic(&self) -> &'static [u8; 8] {
        match self { Seal::Dpapi => MAGIC_DPAPI, Seal::Wrapped(_) => MAGIC_WRAPPED, Seal::Plain => MAGIC_PLAIN }
    }
}

#[cfg(target_os = "windows")]
fn dpapi(data: &[u8], protect: bool) -> Result<Zeroizing<Vec<u8>>, String> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let entropy = CRYPT_INTEGER_BLOB { cbData: DPAPI_ENTROPY.len() as u32, pbData: DPAPI_ENTROPY.as_ptr() as *mut u8 };
    let mut out = CRYPT_INTEGER_BLOB::default();
    // SAFETY: every pointer handed over outlives the call; `out` is allocated by the API and
    // released with LocalFree once copied — and wiped first, since after an unprotect it
    // holds the seeds in clear.
    unsafe {
        let r = if protect {
            CryptProtectData(&input, windows::core::PCWSTR::null(), Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        } else {
            CryptUnprotectData(&input, None, Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        };
        r.map_err(|e| format!("DPAPI: {}", e))?;
        if out.pbData.is_null() { return Err("DPAPI returned nothing".into()); }
        let v = Zeroizing::new(std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec());
        std::ptr::write_bytes(out.pbData, 0, out.cbData as usize);
        let _ = LocalFree(HLOCAL(out.pbData as *mut core::ffi::c_void));
        Ok(v)
    }
}

/// Is the store protected by the OS on this platform (without asking a keyring)?
pub fn os_protected() -> bool { cfg!(target_os = "windows") }

/// The key a `Wrapped` store is sealed under. Created on first use, then read back from the
/// keyring: a keyring that says "stored" and then returns nothing must not get a store only
/// it could open.
fn wrap_key(vault: &dyn Vault, create: bool) -> Result<Zeroizing<[u8; 32]>, String> {
    let to_key = |b: Vec<u8>| -> Result<Zeroizing<[u8; 32]>, String> {
        let b = Zeroizing::new(b);
        if b.len() != 32 { return Err("the store key in the OS keyring is malformed".into()); }
        let mut k = Zeroizing::new([0u8; 32]);
        k.copy_from_slice(&b);
        Ok(k)
    };
    if let Some(b) = vault.get(V5_WRAP_VALUE) { return to_key(b); }
    if !create { return Err("the key that opens this store is not in the OS keyring".into()); }
    let fresh = Zeroizing::new(random_32());
    vault.set(V5_WRAP_VALUE, &fresh[..])?;
    match vault.get(V5_WRAP_VALUE).map(to_key) {
        Some(Ok(k)) if k[..] == fresh[..] => Ok(k),
        _ => Err("the OS keyring did not keep the store key".into()),
    }
}

pub fn encode_store_with(store: &KeyStoreV5, seal: &Seal, vault: &dyn Vault) -> Result<Vec<u8>, String> {
    let json = Zeroizing::new(serde_json::to_vec(store).map_err(|e| e.to_string())?);
    let mut out = seal.magic().to_vec();
    match seal {
        Seal::Dpapi => {
            #[cfg(target_os = "windows")]
            { out.extend_from_slice(&dpapi(&json, true)?); }
            #[cfg(not(target_os = "windows"))]
            { return Err("DPAPI exists only on Windows".into()); }
        }
        Seal::Wrapped(_) => {
            use aes_gcm::aead::{Aead, KeyInit, Payload};
            use aes_gcm::{Aes256Gcm, Nonce};
            let key = wrap_key(vault, true)?;
            let cipher = Aes256Gcm::new_from_slice(&key[..]).map_err(|e| e.to_string())?;
            let nonce = random_12();
            let ct = cipher
                .encrypt(&Nonce::from(nonce), Payload { msg: &json, aad: MAGIC_WRAPPED })
                .map_err(|_| "could not seal the store".to_string())?;
            out.extend_from_slice(&nonce);
            out.extend_from_slice(&ct);
        }
        Seal::Plain => out.extend_from_slice(&json),
    }
    Ok(out)
}

pub fn decode_store_with(bytes: &[u8], vault: &dyn Vault) -> Result<KeyStoreV5, String> {
    io_event(|| "unseal".to_string());
    if bytes.len() < 8 { return Err("store too short".into()); }
    let (magic, body) = bytes.split_at(8);
    let json: Zeroizing<Vec<u8>> = if magic == MAGIC_DPAPI {
        #[cfg(target_os = "windows")]
        { dpapi(body, false)? }
        #[cfg(not(target_os = "windows"))]
        { return Err("DPAPI store on a platform without DPAPI".into()); }
    } else if magic == MAGIC_WRAPPED {
        use aes_gcm::aead::{Aead, KeyInit, Payload};
        use aes_gcm::{Aes256Gcm, Nonce};
        if body.len() < 12 + 16 { return Err("store too short".into()); }
        let (nonce, ct) = body.split_at(12);
        let key = wrap_key(vault, false)?;
        let cipher = Aes256Gcm::new_from_slice(&key[..]).map_err(|e| e.to_string())?;
        let nonce = Nonce::try_from(nonce).map_err(|_| "store nonce malformed".to_string())?;
        Zeroizing::new(
            cipher
                .decrypt(&nonce, Payload { msg: ct, aad: MAGIC_WRAPPED })
                .map_err(|_| "the store does not open with the key in this keyring (altered, or from another account)".to_string())?,
        )
    } else if magic == MAGIC_PLAIN {
        Zeroizing::new(body.to_vec())
    } else {
        return Err("unknown store format".into());
    };
    let s: KeyStoreV5 = serde_json::from_slice(&json).map_err(|e| e.to_string())?;
    s.validate()?;
    Ok(s)
}

/// The platform's default seal, no vault. Kept for callers that only need a round trip.
pub fn encode_store(store: &KeyStoreV5) -> Result<Vec<u8>, String> {
    encode_store_with(store, &Seal::platform_default(), &NoVault)
}

pub fn decode_store(bytes: &[u8]) -> Result<KeyStoreV5, String> { decode_store_with(bytes, &NoVault) }

// ─────────────────────────────────────────────────────────────────────────────
// Persistence — a folder plus a second, OS-held slot
// ─────────────────────────────────────────────────────────────────────────────

/// The second place the store and its pin are kept, and what seals the store: the user
/// registry + DPAPI on Windows, the OS keyring elsewhere. Tests and benchmarks use `MemVault`,
/// so they never touch the real ones.
pub trait Vault: Send + Sync {
    fn get(&self, name: &str) -> Option<Vec<u8>>;
    fn set(&self, name: &str, bytes: &[u8]) -> Result<(), String>;
    fn delete(&self, name: &str);
    fn seal(&self) -> Seal { Seal::platform_default() }
}

/// No second slot.
pub struct NoVault;
impl Vault for NoVault {
    fn get(&self, _: &str) -> Option<Vec<u8>> { None }
    fn set(&self, _: &str, _: &[u8]) -> Result<(), String> { Ok(()) }
    fn delete(&self, _: &str) {}
}

/// An in-memory slot, for tests and benchmarks.
#[derive(Default)]
pub struct MemVault(pub Mutex<BTreeMap<String, Vec<u8>>>);
impl Vault for MemVault {
    fn get(&self, name: &str) -> Option<Vec<u8>> { self.0.lock().ok()?.get(name).cloned() }
    fn set(&self, name: &str, bytes: &[u8]) -> Result<(), String> {
        self.0.lock().map_err(|_| "vault lock poisoned".to_string())?.insert(name.to_string(), bytes.to_vec());
        Ok(())
    }
    fn delete(&self, name: &str) { if let Ok(mut m) = self.0.lock() { m.remove(name); } }
}

#[cfg(test)]
thread_local! { static IO_EVENTS: std::cell::RefCell<Vec<String>> = const { std::cell::RefCell::new(Vec::new()) }; }
#[cfg(test)]
fn take_io_events() -> Vec<String> { IO_EVENTS.with(|e| std::mem::take(&mut *e.borrow_mut())) }
/// The order of the durable steps, recorded for the atomic-write test; nothing in a build.
fn io_event(_e: impl FnOnce() -> String) {
    #[cfg(test)]
    IO_EVENTS.with(|v| v.borrow_mut().push(_e()));
}

/// Open for writing, owner-only on Unix (the key store is the whole identity).
fn open_private(path: &Path) -> std::io::Result<fs::File> {
    let mut o = fs::OpenOptions::new();
    o.write(true).create(true).truncate(true);
    #[cfg(unix)]
    { use std::os::unix::fs::OpenOptionsExt; o.mode(0o600); }
    let f = o.open(path)?;
    // `mode` applies only to a file this call created; a leftover temp file keeps its own.
    #[cfg(unix)]
    { use std::os::unix::fs::PermissionsExt; f.set_permissions(fs::Permissions::from_mode(0o600))?; }
    Ok(f)
}

/// Write `name` in `dir` so that a crash leaves the old content or the new one, never a
/// torn or empty file: temp file, flushed to the device, then renamed over the old one.
fn write_atomic(dir: &Path, name: &str, bytes: &[u8]) -> Result<(), String> {
    let path = dir.join(name);
    let tmp = dir.join(format!("{}.tmp", name));
    let err = |e: std::io::Error| format!("Could not write {}: {}", name, e);
    {
        let mut f = open_private(&tmp).map_err(err)?;
        f.write_all(bytes).map_err(err)?;
        f.sync_all().map_err(err)?;
        io_event(|| format!("sync:{}.tmp", name));
    }
    fs::rename(&tmp, &path).map_err(err)?;
    io_event(|| format!("rename:{}", name));
    // The rename itself must reach the disk too. On Unix that is an fsync of the folder;
    // std cannot open a folder on Windows, where NTFS journals the rename as metadata.
    #[cfg(unix)]
    { if let Ok(d) = fs::File::open(dir) { let _ = d.sync_all(); } }
    Ok(())
}

fn append_log(dir: &Path, line: &str) {
    let line: String = line.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(dir.join(V5_LOG_FILE)) {
        let _ = writeln!(f, "{} {}", now_secs(), line);
    }
}

/// An OS lock on `V5_LOCK_FILE`, released when dropped. Blocks until the other holder is
/// done — a rotation takes milliseconds.
struct DirLock(fs::File);
impl Drop for DirLock {
    fn drop(&mut self) { let _ = self.0.unlock(); }
}
fn lock_dir(dir: &Path) -> Result<DirLock, String> {
    let f = fs::OpenOptions::new()
        .read(true).write(true).create(true).truncate(false)
        .open(dir.join(V5_LOCK_FILE))
        .map_err(|e| format!("Could not open the key store lock: {}", e))?;
    f.lock().map_err(|e| format!("Could not lock the key store: {}", e))?;
    Ok(DirLock(f))
}

/// What this install already committed to: the Creator ID, how far its chain had got, and a
/// digest of that chain. A store must name the same id and EXTEND that chain to be loaded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pin {
    pub v: u32,
    pub cid: String,
    pub seq: usize,
    pub head: String,
}

impl Pin {
    pub fn of(s: &KeyStoreV5) -> Result<Pin, String> {
        Ok(Pin { v: 1, cid: s.cid()?, seq: s.seq(), head: chain_head(&s.chain) })
    }

    /// Does `s` continue what this pin saw? (`s` has already passed `validate`.)
    pub fn admits(&self, s: &KeyStoreV5) -> Result<(), String> {
        if !s.is_signed() { return Err("the store carries no signature".into()); }
        let cid = s.cid()?;
        if cid != self.cid {
            return Err(format!("the store belongs to Creator ID {}…, not to this install's {}…", short(&cid), short(&self.cid)));
        }
        if s.seq() < self.seq {
            return Err(format!("the store is older than the last one used here (link {} < {}): a rollback", s.seq(), self.seq));
        }
        if chain_head(&s.chain[..self.seq]) != self.head {
            return Err("the store's key chain forks from the one this install already used".into());
        }
        Ok(())
    }
}

/// The two pins as found. A pin present but unreadable counts as tampering unless the other
/// one is intact (then it is simply rewritten).
struct Pins { file: Option<Pin>, vault: Option<Pin> }
impl Pins {
    fn all(&self) -> impl Iterator<Item = &Pin> { self.file.iter().chain(self.vault.iter()) }
    fn any(&self) -> Option<&Pin> { self.file.as_ref().or(self.vault.as_ref()) }
}

fn read_pins(dir: &Path, vault: &dyn Vault) -> Result<Pins, String> {
    let parse = |b: Vec<u8>| serde_json::from_slice::<Pin>(&b).map_err(|_| ());
    let file = fs::read(dir.join(V5_PIN_FILE)).ok().map(parse);
    let from_vault = vault.get(V5_PIN_VALUE).map(parse);
    let bad = matches!(file, Some(Err(_))) || matches!(from_vault, Some(Err(_)));
    let pins = Pins { file: file.and_then(|r| r.ok()), vault: from_vault.and_then(|r| r.ok()) };
    if bad && pins.any().is_none() { return Err(refused("the identity pin is unreadable")); }
    if let (Some(a), Some(b)) = (&pins.file, &pins.vault) {
        if a.cid != b.cid { return Err(refused("the two identity pins name different Creator IDs")); }
    }
    Ok(pins)
}

fn write_pins(dir: &Path, vault: &dyn Vault, pin: &Pin) -> Result<(), String> {
    let json = serde_json::to_vec(pin).map_err(|e| e.to_string())?;
    write_atomic(dir, V5_PIN_FILE, &json)?;
    vault.set(V5_PIN_VALUE, &json)?;
    Ok(())
}

/// Seal, write durably, read back, copy to the vault, move the pins forward. The caller holds
/// the lock and has checked the store against the pins.
///
/// `verify_unseal`: open the sealed bytes once before writing them. Required where something
/// is deleted on the strength of this write (the legacy plaintext copies after a migration,
/// the old store's place after a reset); a rotation skips it — the read-back below proves
/// the disk holds exactly the bytes the sealing call returned.
fn persist_locked(dir: &Path, vault: &dyn Vault, store: &KeyStoreV5, verify_unseal: bool) -> Result<Vec<u8>, String> {
    let bytes = encode_store_with(store, &vault.seal(), vault)?;
    if verify_unseal && &decode_store_with(&bytes, vault)? != store {
        return Err("Key store does not open to what was sealed".into());
    }
    write_atomic(dir, V5_STORE_FILE, &bytes)?;
    // Only a store that reads back byte for byte counts as saved.
    if fs::read(dir.join(V5_STORE_FILE)).map_err(|e| e.to_string())? != bytes {
        return Err("Key store read-back mismatch".into());
    }
    // The vault copy is a convenience (it restores a deleted file); failing to write it does
    // not undo a durable file.
    let _ = vault.set(V5_REG_VALUE, &bytes);
    io_event(|| format!("vault:{}", V5_REG_VALUE));
    write_pins(dir, vault, &Pin::of(store)?)?;
    remember(dir, &bytes, store);
    Ok(bytes)
}

/// The sealed bytes this process last opened or wrote in each store folder, with what they
/// decode to. Unsealing is a pure function of the bytes (for one account / keyring), so bytes
/// equal to these need no second DPAPI call — the comparison is of BYTES, which is what
/// matters, not of anything derived from them. Pins are still checked on every load.
/// Two per folder: the file and its vault copy can differ (one of them being repaired).
static DECODED: Mutex<BTreeMap<std::path::PathBuf, Vec<(Vec<u8>, KeyStoreV5)>>> = Mutex::new(BTreeMap::new());

fn remember(dir: &Path, bytes: &[u8], s: &KeyStoreV5) {
    if let Ok(mut m) = DECODED.lock() {
        if m.len() >= 64 && !m.contains_key(dir) { m.clear(); }
        let known = m.entry(dir.to_path_buf()).or_default();
        known.retain(|(b, _)| b[..] != bytes[..]);
        known.insert(0, (bytes.to_vec(), s.clone()));
        known.truncate(2);
    }
}

fn decode_known(dir: &Path, bytes: &[u8], vault: &dyn Vault) -> Result<KeyStoreV5, String> {
    let known = DECODED.lock().ok().and_then(|m| {
        m.get(dir)?.iter().find(|(b, _)| b[..] == bytes[..]).map(|(_, s)| s.clone())
    });
    if let Some(s) = known { return Ok(s); }
    let s = decode_store_with(bytes, vault)?;
    remember(dir, bytes, &s);
    Ok(s)
}

/// Forget what this process decoded for `dir`: the next load unseals as a fresh process would.
pub fn forget_decoded(dir: &Path) {
    if let Ok(mut m) = DECODED.lock() { m.remove(dir); }
}

/// Write a store, refusing one the pins would refuse on the next load.
pub fn persist_at(dir: &Path, vault: &dyn Vault, store: &KeyStoreV5) -> Result<(), String> {
    let _lock = lock_dir(dir)?;
    let pins = read_pins(dir, vault)?;
    for p in pins.all() { p.admits(store).map_err(refused)?; }
    persist_locked(dir, vault, store, false).map(|_| ())
}

fn load_locked(
    dir: &Path,
    vault: &dyn Vault,
    create: impl FnOnce() -> Result<KeyStoreV5, String>,
) -> Result<(KeyStoreV5, bool), String> {
    let pins = read_pins(dir, vault)?;
    let file_bytes = fs::read(dir.join(V5_STORE_FILE)).ok();
    let vault_bytes = vault.get(V5_REG_VALUE);

    if file_bytes.is_none() && vault_bytes.is_none() {
        if let Some(p) = pins.any() {
            return Err(refused(format!(
                "the key store is missing, and this install is pinned to Creator ID {}…: restore it, or reset the identity",
                short(&p.cid)
            )));
        }
        // First launch, or the upgrade from v4.
        let s = create()?;
        persist_locked(dir, vault, &s, true)?;
        return Ok((s, true));
    }

    // The two copies are normally the same bytes: open them once.
    let file_dec = file_bytes.as_deref().map(|b| decode_known(dir, b, vault));
    let vault_dec = match (&file_bytes, &vault_bytes) {
        (Some(f), Some(v)) if f == v => file_dec.clone(),
        _ => vault_bytes.as_deref().map(|b| decode_known(dir, b, vault)),
    };

    // Every copy that decodes AND continues every pin is a candidate; the longest chain wins
    // (the file on a tie). A copy that fails says why, for the error if none is left.
    let mut reasons: Vec<String> = Vec::new();
    let mut undecodable = 0;
    let mut best: Option<(KeyStoreV5, &[u8])> = None;
    for (slot, dec, bytes) in [("file", file_dec, file_bytes.as_deref()), ("registry copy", vault_dec, vault_bytes.as_deref())] {
        let (Some(dec), Some(bytes)) = (dec, bytes) else { continue };
        match dec {
            Err(e) => { undecodable += 1; reasons.push(format!("{}: {}", slot, e)); }
            Ok(s) => match pins.all().try_for_each(|p| p.admits(&s)) {
                Err(e) => reasons.push(format!("{}: {}", slot, e)),
                Ok(()) => {
                    if best.as_ref().map_or(true, |(b, _)| s.seq() > b.seq()) { best = Some((s, bytes)); }
                }
            },
        }
    }

    if let Some((s, bytes)) = best {
        // A v5.0 store (unsigned — only reachable before anything was pinned) or one sealed
        // the old way: sign / re-seal it once, and pin it.
        if !s.is_signed() || !bytes.starts_with(vault.seal().magic()) {
            let mut s = s;
            if !s.is_signed() { s.sign()?; }
            persist_locked(dir, vault, &s, true)?;
            return Ok((s, false));
        }
        // Repair a copy that is missing, older or foreign with the exact bytes that won.
        if file_bytes.as_deref() != Some(bytes) { write_atomic(dir, V5_STORE_FILE, bytes)?; }
        if vault_bytes.as_deref() != Some(bytes) { let _ = vault.set(V5_REG_VALUE, bytes); }
        let pin = Pin::of(&s)?;
        if pins.file.as_ref() != Some(&pin) || pins.vault.as_ref() != Some(&pin) {
            write_pins(dir, vault, &pin)?;
        }
        return Ok((s, false));
    }

    // Nothing usable. Before anything was pinned, a store that cannot be opened at all
    // (another Windows account's DPAPI, a corrupted file) is set aside and a new one made —
    // the v5.0 behaviour, minus the silent overwrite. Once pinned, that is a reset's job.
    let present = file_bytes.is_some() as usize + vault_bytes.is_some() as usize;
    if pins.any().is_none() && undecodable == present {
        let aside = format!("creator_v5.unreadable-{}.key", now_secs());
        if let Some(b) = file_bytes.as_deref().or(vault_bytes.as_deref()) { let _ = write_atomic(dir, &aside, b); }
        let s = create()?;
        persist_locked(dir, vault, &s, true)?;
        append_log(dir, &format!("unreadable store set aside as {} new_cid={}", aside, s.cid()?));
        return Ok((s, true));
    }
    Err(refused(reasons.join("; ")))
}

/// Load the store (file, else its vault copy — each repairs the other), checked against the
/// identity pin; or, when there is no store and no pin, build one with `create` and persist it.
/// The flag says whether `create` ran — the caller removes the legacy plaintext copies only
/// then, and only after this returned Ok (i.e. after a durable, read-back write).
pub fn load_at(
    dir: &Path,
    vault: &dyn Vault,
    create: impl FnOnce() -> Result<KeyStoreV5, String>,
) -> Result<(KeyStoreV5, bool), String> {
    let _lock = lock_dir(dir)?;
    load_locked(dir, vault, create)
}

/// Rotate the active key. Re-reads the store under the lock, so a rotation made by another
/// BMM in the meantime is extended, never overwritten.
pub fn rotate_at(dir: &Path, vault: &dyn Vault, next_seed: [u8; 32], now: u64) -> Result<KeyStoreV5, String> {
    let next_seed = Zeroizing::new(next_seed);
    let _lock = lock_dir(dir)?;
    let (mut s, _) = load_locked(dir, vault, || Err(refused("there is no key store to rotate")))?;
    s.rotate(*next_seed, now)?;
    s.validate()?;
    persist_locked(dir, vault, &s, false)?;
    Ok(s)
}

/// The recovery path, and the only way this install's identity can change: set the current
/// store and pin aside (renamed, never deleted), make a new store with `create`, pin it, and
/// log it. Returns the new store and the Creator ID that was pinned before, if any.
pub fn reset_at(
    dir: &Path,
    vault: &dyn Vault,
    create: impl FnOnce() -> Result<KeyStoreV5, String>,
    reason: &str,
) -> Result<(KeyStoreV5, Option<String>), String> {
    let _lock = lock_dir(dir)?;
    let old = read_pins(dir, vault).ok().and_then(|p| p.any().map(|p| p.cid.clone()));
    let tag = format!("creator_v5.reset-{}", now_secs());
    let key = dir.join(V5_STORE_FILE);
    if key.exists() {
        fs::rename(&key, dir.join(format!("{}.key", tag))).map_err(|e| format!("Could not set the old store aside: {}", e))?;
    } else if let Some(b) = vault.get(V5_REG_VALUE) {
        write_atomic(dir, &format!("{}.key", tag), &b)?;
    }
    let pin = dir.join(V5_PIN_FILE);
    if pin.exists() {
        fs::rename(&pin, dir.join(format!("{}.pin", tag))).map_err(|e| format!("Could not set the old pin aside: {}", e))?;
    }
    // The wrap key (if any) stays: it is what opens the store just set aside.
    vault.delete(V5_REG_VALUE);
    vault.delete(V5_PIN_VALUE);
    let s = create()?;
    persist_locked(dir, vault, &s, true)?;
    append_log(dir, &format!(
        "reset reason={:?} old_cid={} new_cid={} set_aside={}",
        reason, old.as_deref().unwrap_or("none"), s.cid()?, tag
    ));
    Ok((s, old))
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    const AUD: &str = "https://bettercommunity.test";

    fn fields() -> BTreeMap<&'static str, String> {
        let mut m = BTreeMap::new();
        m.insert("MachineGuid", "3f2c9a1e-7b44-4c1d-9e0a-5d6f7a8b9c0d".to_string());
        m.insert("ProductId", "00330-80000-00000-AA123".to_string());
        m.insert("InstallDate", "1712345678".to_string());
        m.insert("SystemUUID", "4C4C4544-0042-3010-8057-B7C04F4E4E32".to_string());
        m.insert("BaseboardSerial", "BSN-SERIAL-7781".to_string());
        m.insert("BiosSerial", "BIOS-SERIAL-5521".to_string());
        m.insert("CpuId", "BFEBFBFF000906EA".to_string());
        m.insert("DiskSn", "S4EWNX0R123456".to_string());
        m.insert("VolumeSn", "A1B2C3D4".to_string());
        m.insert("DiskModel", "Samsung SSD 970 EVO".to_string());
        m
    }

    fn decode_payload(token: &str) -> serde_json::Value {
        let seg = token.split('.').nth(1).unwrap();
        serde_json::from_slice(&b64u().decode(seg).unwrap()).unwrap()
    }

    #[test]
    fn v4_root_keeps_the_creator_id_and_rotates_at_once() {
        let v4 = [7u8; 32];
        let s = KeyStoreV5::from_root(v4, ROOT_V4_DERIVED, 1000, [9u8; 32]).unwrap();
        assert_eq!(s.cid().unwrap(), pk_hex(&SigningKey::from_bytes(&v4)), "the Creator ID is the v4 public key");
        assert_ne!(s.kid().unwrap(), s.cid().unwrap(), "proofs are not signed by the derivable key");
        assert_eq!(s.seq(), 1);
        s.validate().unwrap();
    }

    #[test]
    fn random_root_signs_for_itself() {
        let s = KeyStoreV5::from_root([3u8; 32], ROOT_RANDOM, 1000, [4u8; 32]).unwrap();
        assert_eq!(s.kid().unwrap(), s.cid().unwrap());
        assert!(s.chain.is_empty());
        s.validate().unwrap();
    }

    #[test]
    fn rotation_keeps_identity_and_old_signs_new() {
        let mut s = KeyStoreV5::from_root([7u8; 32], ROOT_V4_DERIVED, 1000, [9u8; 32]).unwrap();
        let cid = s.cid().unwrap();
        let k1 = s.kid().unwrap();
        s.rotate([10u8; 32], 2000).unwrap();
        assert_eq!(s.cid().unwrap(), cid);
        assert_ne!(s.kid().unwrap(), k1);
        assert_eq!(verify_chain(&cid, &s.chain).unwrap(), s.kid().unwrap());
        // The second link was signed by the first active key, not the root.
        let p = decode_payload(&s.chain[1]);
        assert_eq!(p["prev"].as_str().unwrap(), k1);
        assert_eq!(p["seq"].as_u64().unwrap(), 2);
    }

    #[test]
    fn a_broken_or_reordered_chain_is_refused() {
        let mut s = KeyStoreV5::from_root([7u8; 32], ROOT_V4_DERIVED, 1000, [9u8; 32]).unwrap();
        s.rotate([10u8; 32], 2000).unwrap();
        let cid = s.cid().unwrap();
        let swapped = vec![s.chain[1].clone(), s.chain[0].clone()];
        assert!(verify_chain(&cid, &swapped).is_err());
        assert!(verify_chain(&cid, &s.chain[1..]).is_err(), "a chain must start at the id");
        // A link forged by an unrelated key.
        let stranger = SigningKey::from_bytes(&[42u8; 32]);
        let forged = make_rotation_cert(&stranger, &cid, &(&SigningKey::from_bytes(&[43u8; 32])).into(), 1, 3000);
        assert!(verify_chain(&cid, &[forged]).is_err());
        // A tampered signature.
        let mut bad = s.chain.clone();
        bad[0] = format!("{}x", &bad[0][..bad[0].len() - 1]);
        assert!(verify_chain(&cid, &bad).is_err());
    }

    #[test]
    fn store_round_trips_and_keeps_its_shape() {
        let mut s = KeyStoreV5::from_root([7u8; 32], ROOT_V4_DERIVED, 1000, [9u8; 32]).unwrap();
        s.rotate([10u8; 32], 2000).unwrap();
        let bytes = encode_store(&s).unwrap();
        let back = decode_store(&bytes).unwrap();
        assert_eq!(back, s);
        if os_protected() {
            assert_eq!(&bytes[..8], MAGIC_DPAPI);
            // The encrypted store must not carry the seed in any readable form.
            let hay = String::from_utf8_lossy(&bytes).to_string();
            assert!(!hay.contains(s.root.as_str()) && !hay.contains(s.active.as_str()), "seed readable in the store");
        }
        assert!(decode_store(b"garbage!garbage").is_err());
    }

    #[test]
    fn proof_verifies_and_carries_no_raw_input() {
        let mut s = KeyStoreV5::from_root([7u8; 32], ROOT_V4_DERIVED, 1000, [9u8; 32]).unwrap();
        s.rotate([10u8; 32], 2000).unwrap();
        let canvas = "ab".repeat(32);
        let fp = fingerprint_for(&fields(), Some(&canvas), AUD);
        let tok = build_proof(&s, AUD, 5000, [1u8; 16], &fp).unwrap();
        let parts: Vec<&str> = tok.split('.').collect();
        assert_eq!(parts[0], "bmmc5");

        // Signature by the active key over the domain-separated segment.
        let sig: [u8; 64] = b64u().decode(parts[2]).unwrap().try_into().unwrap();
        let kid = s.kid().unwrap();
        vk_from_hex(&kid).unwrap().verify(format!("bmmc5.{}", parts[1]).as_bytes(), &Signature::from_bytes(&sig)).unwrap();
        // …and NOT over the bare segment, so it cannot be relabelled as a v1 token.
        assert!(vk_from_hex(&kid).unwrap().verify(parts[1].as_bytes(), &Signature::from_bytes(&sig)).is_err());

        let p = decode_payload(&tok);
        assert_eq!(p["v"], 5);
        assert_eq!(p["cid"].as_str().unwrap(), s.cid().unwrap());
        assert_eq!(p["exp"].as_u64().unwrap(), 5000 + PROOF_TTL_SECONDS);
        assert_eq!(p["nonce"].as_str().unwrap().len(), 32);
        let chain: Vec<String> = p["chain"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect();
        assert_eq!(verify_chain(p["cid"].as_str().unwrap(), &chain).unwrap(), kid);

        // Nothing raw: not a serial, not the GUID, not the canvas digest, in any case.
        let decoded = serde_json::to_string(&p).unwrap().to_uppercase();
        let whole = tok.to_uppercase();
        for raw in fields().values().chain(std::iter::once(&canvas)) {
            let r = raw.to_uppercase();
            assert!(!decoded.contains(&r), "raw value {} in the proof", raw);
            assert!(!whole.contains(&r));
        }
        for k in ["board", "os", "disk", "canvas"] {
            assert_eq!(p["fp"][k].as_str().unwrap().len(), 32, "{} is a 128-bit hash", k);
        }
    }

    #[test]
    fn fingerprint_is_salted_per_audience_and_stable() {
        let a = fingerprint_for(&fields(), None, AUD);
        let b = fingerprint_for(&fields(), None, AUD);
        let other = fingerprint_for(&fields(), None, "https://someone-else.test");
        assert_eq!(a, b, "same machine, same server → same hashes");
        assert_ne!(a.board, other.board, "another server cannot correlate");
        // A disk swap changes one component and only that one.
        let mut f = fields();
        f.insert("DiskSn", "OTHER-DISK".into());
        let c = fingerprint_for(&f, None, AUD);
        assert_eq!(a.board, c.board);
        assert_eq!(a.os, c.os);
        assert_ne!(a.disk, c.disk);
    }

    /// Two unrelated PCs whose firmware never had its serials filled in must NOT look like
    /// one machine. Before placeholder filtering they did: `board` fell back to CpuId (a
    /// model number) plus "Default string" twice, and the AMI default UUID — a constant.
    /// The analyser weights a shared `board` above everything else, so the collision read
    /// as the strongest possible evidence that two people were one person.
    #[test]
    fn oem_placeholder_firmware_does_not_make_two_machines_look_like_one() {
        let mk = |guid: &str, vol: &str| {
            let mut m = BTreeMap::new();
            // Identical on both: the board never had its serials programmed, and they are
            // the same CPU model and the same drive model.
            m.insert("SystemUUID", "03000200-0400-0500-0006-000700080009".to_string());
            m.insert("BaseboardSerial", "Default string".to_string());
            m.insert("BiosSerial", "To Be Filled By O.E.M.".to_string());
            m.insert("CpuId", "178BFBFF00A50F00".to_string());
            m.insert("DiskModel", "Samsung SSD 980 1TB".to_string());
            // Genuinely per-machine:
            m.insert("MachineGuid", guid.to_string());
            m.insert("VolumeSn", vol.to_string());
            m
        };
        let a = fingerprint_for(&mk("11111111-1111-4111-8111-111111111111", "A1B2C3D4"), None, AUD);
        let b = fingerprint_for(&mk("22222222-2222-4222-8222-222222222222", "99887766"), None, AUD);
        assert!(a.board.is_none(), "a board with no real serial identifies nobody and must be absent");
        assert_eq!(a.board, b.board);
        assert_ne!(a.os, b.os, "the OS group still separates them");
        assert_ne!(a.disk, b.disk, "and so does the volume serial");

        // A CPU model on its own is never a machine, whatever else is missing.
        let mut cpu_only = BTreeMap::new();
        cpu_only.insert("CpuId", "178BFBFF00A50F00".to_string());
        assert_eq!(fingerprint_for(&cpu_only, None, AUD), FingerprintV5::default());
        // …and the same Windows image on two PCs is not one PC either.
        let mut imaged = BTreeMap::new();
        imaged.insert("ProductId", "00330-80000-00000-AA123".to_string());
        imaged.insert("InstallDate", "1712345678".to_string());
        assert!(fingerprint_for(&imaged, None, AUD).os.is_none());

        // A real serial still produces a board hash — the filter drops noise, not signal.
        let mut real = mk("11111111-1111-4111-8111-111111111111", "A1B2C3D4");
        real.insert("BaseboardSerial", "PSN20D4W0KL".to_string());
        assert!(fingerprint_for(&real, None, AUD).board.is_some());
    }

    #[test]
    fn placeholders_are_recognised_in_every_spelling() {
        for v in ["", "  ", "Default string", "DEFAULT STRING", "To be filled by O.E.M.",
                  "None", "n/a", "System Serial Number", "0123456789", "00000000",
                  "xxxxxxxxxx", "..........", "--------",
                  "00000000-0000-0000-0000-000000000000",
                  "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
                  "03000200-0400-0500-0006-000700080009"] {
            assert!(is_placeholder(v), "{:?} should be a placeholder", v);
        }
        for v in ["PSN20D4W0KL", "4C4C4544-0042-3010-8057-B7C04F4E4E32", "S4EWNX0R123456", "A1B2", "0A0B"] {
            assert!(!is_placeholder(v), "{:?} is a real value", v);
        }
    }

    #[test]
    fn only_a_digest_is_accepted_as_canvas() {
        let pixels = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA";
        assert!(fingerprint_for(&fields(), Some(pixels), AUD).canvas.is_none());
        assert!(fingerprint_for(&fields(), Some("abc"), AUD).canvas.is_none());
        let empty = fingerprint_for(&BTreeMap::new(), None, AUD);
        assert_eq!(empty, FingerprintV5::default(), "an unreadable group is omitted, not hashed empty");
    }

    #[test]
    fn audience_must_be_an_origin() {
        assert!(validate_aud("https://bettercommunity.ch/").is_ok());
        assert!(validate_aud("https://bettercommunity.ch/api").is_err());
        assert!(validate_aud("ftp://x").is_err());
        assert!(validate_aud("https://x\",\"cid\":\"y").is_err(), "no JSON injection through aud");
    }

    #[test]
    fn a_full_chain_refuses_another_rotation() {
        let mut s = KeyStoreV5::from_root([7u8; 32], ROOT_RANDOM, 1000, [9u8; 32]).unwrap();
        for i in 0..MAX_CHAIN { s.rotate([100 + i as u8; 32], 2000 + i as u64).unwrap(); }
        assert!(s.rotate([1u8; 32], 9999).is_err());
        s.validate().unwrap();
    }
}

/// The cross-language vector. `apps/api/test/fixtures/creator-v5-vector.json` in BCWEB holds
/// the same token and verifies it in Node; if either side changes a byte of the format, one of
/// the two tests goes red. Ed25519 signatures are deterministic, so the token is fixed.
#[cfg(test)]
mod vector {
    use super::*;
    #[test]
    fn the_shared_vector_is_unchanged() {
        let mut s = KeyStoreV5::from_root([7u8; 32], ROOT_V4_DERIVED, 1000, [9u8; 32]).unwrap();
        s.rotate([10u8; 32], 2000).unwrap();
        let mut m = BTreeMap::new();
        m.insert("MachineGuid", "3f2c9a1e-7b44-4c1d-9e0a-5d6f7a8b9c0d".to_string());
        m.insert("SystemUUID", "4C4C4544-0042-3010-8057-B7C04F4E4E32".to_string());
        m.insert("DiskSn", "S4EWNX0R123456".to_string());
        let fp = fingerprint_for(&m, Some(&"ab".repeat(32)), "https://bettercommunity.test");
        let t = build_proof(&s, "https://bettercommunity.test", 5000, [1u8; 16], &fp).unwrap();
        assert_eq!(s.cid().unwrap(), "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c");
        assert_eq!(s.kid().unwrap(), "43a72e714401762df66b68c26dfbdf2682aaec9f2474eca4613e424a0fbafd3c");
        let digest = hex::encode(Sha256::digest(t.as_bytes()));
        assert_eq!(digest, "4fc8a9410e8f18e6c5ec41cf0185d3db87f42732f3f4483ab11d3e0e752907ea", "the v5 wire format changed");
    }
}

/// v5.1 hardening (plan L1). Each test was written against the v5.0 behaviour first and seen
/// to fail there; the note on each says what v5.0 did.
#[cfg(test)]
mod hardening {
    use super::*;

    fn store_a() -> KeyStoreV5 { KeyStoreV5::from_root([7u8; 32], ROOT_V4_DERIVED, 1000, [9u8; 32]).unwrap() }
    /// Another machine's store: another root, so another Creator ID.
    fn store_b() -> KeyStoreV5 { KeyStoreV5::from_root([21u8; 32], ROOT_V4_DERIVED, 1000, [22u8; 32]).unwrap() }
    fn no_create() -> Result<KeyStoreV5, String> { Err("must not create".into()) }
    fn put_both(dir: &Path, vault: &MemVault, bytes: &[u8]) {
        fs::write(dir.join(V5_STORE_FILE), bytes).unwrap();
        vault.set(V5_REG_VALUE, bytes).unwrap();
    }
    fn file_store(dir: &Path) -> KeyStoreV5 { decode_store(&fs::read(dir.join(V5_STORE_FILE)).unwrap()).unwrap() }
    /// The store as JSON with one edit applied, sealed in the plain format — what someone with
    /// write access to the file (and no key) can produce on a platform without DPAPI.
    fn edited_plain(s: &KeyStoreV5, edit: impl FnOnce(&mut serde_json::Value)) -> Vec<u8> {
        let mut j = serde_json::to_value(s).unwrap();
        edit(&mut j);
        let mut out = MAGIC_PLAIN.to_vec();
        out.extend(serde_json::to_vec(&j).unwrap());
        out
    }

    // ── L1.1 identity pinning ────────────────────────────────────────────────
    // v5.0: `load_store` took whatever decoded, so a copied-in store became the identity.

    #[test]
    fn a_store_with_another_creator_id_is_refused_not_adopted() {
        let d = tempfile::tempdir().unwrap();
        let v = MemVault::default();
        let (a, created) = load_at(d.path(), &v, || Ok(store_a())).unwrap();
        assert!(created);
        assert!(d.path().join(V5_PIN_FILE).exists(), "the pin file is written with the first store");
        assert!(v.get(V5_PIN_VALUE).is_some(), "and so is the registry pin");

        // Another machine's store copied over BOTH copies.
        put_both(d.path(), &v, &encode_store(&store_b()).unwrap());
        let r = load_at(d.path(), &v, no_create);
        assert!(r.is_err(), "a foreign store was adopted: the Creator ID became {:?}", r.map(|(s, _)| s.cid()));

        // Putting ours back loads again: the refusal changed nothing on disk.
        put_both(d.path(), &v, &encode_store(&a).unwrap());
        assert_eq!(load_at(d.path(), &v, no_create).unwrap().0.cid().unwrap(), a.cid().unwrap());
    }

    #[test]
    fn a_foreign_file_is_replaced_from_the_pinned_registry_copy() {
        let d = tempfile::tempdir().unwrap();
        let v = MemVault::default();
        let (a, _) = load_at(d.path(), &v, || Ok(store_a())).unwrap();
        fs::write(d.path().join(V5_STORE_FILE), encode_store(&store_b()).unwrap()).unwrap();
        let (s, _) = load_at(d.path(), &v, no_create).unwrap();
        assert_eq!(s.cid().unwrap(), a.cid().unwrap(), "the pinned identity wins");
        assert_eq!(file_store(d.path()).cid().unwrap(), a.cid().unwrap(), "and the file is repaired");
    }

    #[test]
    fn a_pin_that_names_someone_else_blocks_everything() {
        let d = tempfile::tempdir().unwrap();
        let v = MemVault::default();
        load_at(d.path(), &v, || Ok(store_a())).unwrap();
        // Both pins rewritten to another id (the store itself untouched): refused, not re-pinned.
        let b = store_b();
        let pin = format!(r#"{{"v":1,"cid":"{}","seq":1,"head":"{}"}}"#, b.cid().unwrap(), chain_head(&b.chain));
        fs::write(d.path().join(V5_PIN_FILE), &pin).unwrap();
        v.set(V5_PIN_VALUE, pin.as_bytes()).unwrap();
        assert!(load_at(d.path(), &v, no_create).is_err());
    }

    // ── L1.2 anti-rollback ───────────────────────────────────────────────────
    // v5.0: an older backup of the store, restored, was loaded as-is.

    #[test]
    fn an_older_store_is_refused() {
        let d = tempfile::tempdir().unwrap();
        let v = MemVault::default();
        load_at(d.path(), &v, || Ok(store_a())).unwrap();
        let old = fs::read(d.path().join(V5_STORE_FILE)).unwrap();
        let s2 = rotate_at(d.path(), &v, [30u8; 32], 2000).unwrap();
        assert_eq!(s2.seq(), 2);

        // A backup from before the rotation, restored into both copies.
        put_both(d.path(), &v, &old);
        assert!(load_at(d.path(), &v, no_create).is_err(), "a rolled-back store was accepted");

        // Only the file rolled back: the newer registry copy wins and the file is repaired.
        fs::write(d.path().join(V5_STORE_FILE), &old).unwrap();
        v.set(V5_REG_VALUE, &encode_store(&s2).unwrap()).unwrap();
        let (s, _) = load_at(d.path(), &v, no_create).unwrap();
        assert_eq!(s.seq(), 2);
        assert_eq!(file_store(d.path()).seq(), 2);
    }

    #[test]
    fn a_forked_chain_is_refused_even_when_longer() {
        let d = tempfile::tempdir().unwrap();
        let v = MemVault::default();
        let (a, _) = load_at(d.path(), &v, || Ok(store_a())).unwrap();
        rotate_at(d.path(), &v, [30u8; 32], 2000).unwrap();
        // From the seq-1 state, two rotations to other keys: a valid chain for the same id,
        // longer than the pinned one, that does not extend it.
        let mut fork = a.clone();
        fork.rotate([40u8; 32], 3000).unwrap();
        fork.rotate([41u8; 32], 3001).unwrap();
        fork.validate().unwrap();
        put_both(d.path(), &v, &encode_store(&fork).unwrap());
        assert!(load_at(d.path(), &v, no_create).is_err(), "a fork was accepted");
    }

    // ── L1.3 integrity ───────────────────────────────────────────────────────
    // v5.0: `created`, `rotated`, `root_kind` were covered by nothing but DPAPI, and by
    // nothing at all in the plain format.

    #[test]
    fn tampering_with_a_non_secret_field_is_detected() {
        let s = store_a();
        decode_store(&edited_plain(&s, |_| {})).expect("the untouched store decodes");
        let edits: [(&str, fn(&mut serde_json::Value)); 4] = [
            ("created", |j| j["created"] = serde_json::json!(1)),
            ("rotated", |j| j["rotated"] = serde_json::json!(424242)),
            ("root_kind", |j| j["root_kind"] = serde_json::json!(ROOT_RANDOM)),
            ("chain dropped", |j| { j["chain"] = serde_json::json!([]); j["active"] = j["root"].clone(); }),
        ];
        for (name, edit) in edits {
            assert!(decode_store(&edited_plain(&s, edit)).is_err(), "an edited `{}` was not detected", name);
        }
    }

    #[test]
    fn stripping_the_signature_does_not_get_past_the_pin() {
        let d = tempfile::tempdir().unwrap();
        let v = MemVault::default();
        let (a, _) = load_at(d.path(), &v, || Ok(store_a())).unwrap();
        let unsigned = edited_plain(&a, |j| {
            if let Some(o) = j.as_object_mut() { o.remove("sig"); }
            j["created"] = serde_json::json!(1);
        });
        put_both(d.path(), &v, &unsigned);
        assert!(load_at(d.path(), &v, no_create).is_err());
    }

    // ── L1.4 protection off Windows ──────────────────────────────────────────
    // v5.0: no DPAPI → the seeds were written in clear.

    #[test]
    fn a_wrapped_store_needs_the_key_held_by_the_os_keyring() {
        let s = store_a();
        let v = MemVault::default();
        let bytes = encode_store_with(&s, &Seal::Wrapped("keychain"), &v).unwrap();
        assert_eq!(&bytes[..8], b"BMMK5KR1");
        let hay = String::from_utf8_lossy(&bytes).to_string();
        assert!(!hay.contains(s.root.as_str()) && !hay.contains(s.active.as_str()), "seed readable in a wrapped store");
        assert_eq!(decode_store_with(&bytes, &v).unwrap(), s);
        assert!(decode_store_with(&bytes, &MemVault::default()).is_err(), "another keyring opened it");
        let mut bad = bytes.clone();
        let n = bad.len();
        bad[n - 1] ^= 1;
        assert!(decode_store_with(&bad, &v).is_err(), "a flipped byte went unnoticed");
        assert_eq!(Seal::Dpapi.protection(), "dpapi");
        assert_eq!(Seal::Wrapped("secret-service").protection(), "secret-service");
        assert_eq!(Seal::Plain.protection(), "file-0600");
    }

    #[cfg(unix)]
    #[test]
    fn the_plain_fallback_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap();
        load_at(d.path(), &NoVault, || Ok(store_a())).unwrap();
        for f in [V5_STORE_FILE, V5_PIN_FILE] {
            let mode = fs::metadata(d.path().join(f)).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "{} is {:o}", f, mode);
        }
    }

    // ── L1.5 memory ──────────────────────────────────────────────────────────
    // v5.0: `#[derive(Debug)]` printed both seeds; they lived in plain `String`s.

    #[test]
    fn debug_output_never_shows_a_seed() {
        let s = store_a();
        let dbg = format!("{:?}", s);
        assert!(!dbg.contains(s.root.as_str()) && !dbg.contains(s.active.as_str()), "seed in {:?}", dbg);
        // And the seeds sit in buffers that are wiped on drop (a compile-time check).
        let _: (&Zeroizing<String>, &Zeroizing<String>) = (&s.root, &s.active);
    }

    // ── Upgrade from v5.0 ────────────────────────────────────────────────────

    /// A store written by v5.0 carries no signature and there is no pin yet. It must load with
    /// the SAME Creator ID and key, get signed and pinned, and from then on be held to the pin.
    #[test]
    fn a_v50_store_keeps_its_identity_and_is_signed_and_pinned_on_first_load() {
        let d = tempfile::tempdir().unwrap();
        let v = MemVault::default();
        let a = store_a();
        let mut j = serde_json::to_value(&a).unwrap();
        j.as_object_mut().unwrap().remove("sig");
        let v50: KeyStoreV5 = serde_json::from_value(j).unwrap();
        assert!(!v50.is_signed());
        put_both(d.path(), &v, &encode_store(&v50).unwrap());
        assert!(!d.path().join(V5_PIN_FILE).exists());

        let (s, created) = load_at(d.path(), &v, no_create).unwrap();
        assert!(!created);
        assert_eq!((s.cid().unwrap(), s.kid().unwrap(), s.seq()), (a.cid().unwrap(), a.kid().unwrap(), a.seq()));
        assert!(s.is_signed() && file_store(d.path()).is_signed(), "signed and written back");
        let pin: Pin = serde_json::from_slice(&fs::read(d.path().join(V5_PIN_FILE)).unwrap()).unwrap();
        assert_eq!(pin, Pin::of(&a).unwrap());
        // Once pinned, the unsigned copy is no longer acceptable.
        put_both(d.path(), &v, &encode_store(&v50).unwrap());
        assert!(load_at(d.path(), &v, no_create).is_err());
    }

    // ── L1.6 concurrency ─────────────────────────────────────────────────────
    // v5.0: two rotations from two BMMs both "succeeded"; the second overwrote the first, so
    // a key a server had already seen vanished from the chain — a fork.

    #[test]
    fn concurrent_rotations_are_serialised_not_forked() {
        let d = tempfile::tempdir().unwrap();
        let v = MemVault::default();
        load_at(d.path(), &v, || KeyStoreV5::from_root([5u8; 32], ROOT_RANDOM, 1000, [5u8; 32])).unwrap();
        let dir = d.path();
        let results: Vec<Result<KeyStoreV5, String>> = std::thread::scope(|sc| {
            let hs: Vec<_> = (0..MAX_CHAIN as u8)
                .map(|i| { let v = &v; sc.spawn(move || rotate_at(dir, v, [100 + i; 32], 2000 + i as u64)) })
                .collect();
            hs.into_iter().map(|h| h.join().unwrap()).collect()
        });
        for r in &results { assert!(r.is_ok(), "a rotation failed: {:?}", r.as_ref().err()); }
        let (s, _) = load_at(dir, &v, no_create).unwrap();
        assert_eq!(s.seq(), MAX_CHAIN, "every rotation must land on the chain, one after the other");
        // Every key a rotation reported is on the final chain.
        let chain_keys: Vec<String> = s.chain.iter().map(|c| {
            let seg = c.split('.').nth(1).unwrap();
            let p: serde_json::Value = serde_json::from_slice(&b64u().decode(seg).unwrap()).unwrap();
            p["next"].as_str().unwrap().to_string()
        }).collect();
        for r in results { assert!(chain_keys.contains(&r.unwrap().kid().unwrap())); }
    }

    // ── L1.7 atomic write ────────────────────────────────────────────────────
    // v5.0: `fs::write` then `rename`, no flush: a power cut could leave a renamed, empty file.

    #[test]
    fn the_new_store_is_flushed_before_it_replaces_the_old_one() {
        let d = tempfile::tempdir().unwrap();
        take_io_events();
        persist_at(d.path(), &MemVault::default(), &store_a()).unwrap();
        let ev = take_io_events();
        let pos = |e: &str| ev.iter().position(|x| x == e).unwrap_or_else(|| panic!("no `{}` in {:?}", e, ev));
        assert!(pos("sync:creator_v5.key.tmp") < pos("rename:creator_v5.key"));
        assert!(pos("rename:creator_v5.key") < pos("vault:K5"), "the registry copy follows the durable file");
    }

    // ── Recovery ─────────────────────────────────────────────────────────────

    #[test]
    fn reset_is_the_only_way_to_a_new_identity_and_it_is_logged() {
        let d = tempfile::tempdir().unwrap();
        let v = MemVault::default();
        let (a, _) = load_at(d.path(), &v, || Ok(store_a())).unwrap();
        let b = store_b();
        put_both(d.path(), &v, &encode_store(&b).unwrap());
        assert!(load_at(d.path(), &v, no_create).is_err());

        let (n, old) = reset_at(d.path(), &v, || Ok(store_b()), "test").unwrap();
        assert_eq!(n.cid().unwrap(), b.cid().unwrap());
        assert_eq!(old.as_deref(), Some(a.cid().unwrap().as_str()));
        assert_eq!(load_at(d.path(), &v, no_create).unwrap().0.cid().unwrap(), b.cid().unwrap());
        let log = fs::read_to_string(d.path().join(V5_LOG_FILE)).unwrap();
        assert!(log.contains("reset") && log.contains(&a.cid().unwrap()) && log.contains(&b.cid().unwrap()), "{}", log);
        let backups = fs::read_dir(d.path()).unwrap().filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("creator_v5.reset-")).count();
        assert!(backups >= 1, "the replaced store is kept, not deleted");
    }
}

/// L2: what the store costs to open, measured in unseals (each one a DPAPI call on Windows)
/// and fingerprint computations (4 × 20 000 SHA-256 each).
#[cfg(test)]
mod io_cost {
    use super::*;
    fn unseals(ev: &[String]) -> usize { ev.iter().filter(|e| e.as_str() == "unseal").count() }
    fn no_create() -> Result<KeyStoreV5, String> { Err("must not create".into()) }

    #[test]
    fn identical_copies_are_unsealed_once_and_known_bytes_not_at_all() {
        let d = tempfile::tempdir().unwrap();
        let v = MemVault::default();
        load_at(d.path(), &v, || KeyStoreV5::from_root([7u8; 32], ROOT_V4_DERIVED, 1000, [9u8; 32])).unwrap();
        forget_decoded(d.path()); // as a new process would start
        take_io_events();
        load_at(d.path(), &v, no_create).unwrap();
        assert_eq!(unseals(&take_io_events()), 1, "the file and its registry copy are the same bytes");
        load_at(d.path(), &v, no_create).unwrap();
        assert_eq!(unseals(&take_io_events()), 0, "bytes this process already opened");
        rotate_at(d.path(), &v, [30u8; 32], 2000).unwrap();
        assert_eq!(unseals(&take_io_events()), 0, "a rotation re-reads under the lock without reopening what it wrote");
        // Correctness is untouched: a copy that differs is still opened and still judged.
        let other = KeyStoreV5::from_root([21u8; 32], ROOT_V4_DERIVED, 1000, [22u8; 32]).unwrap();
        fs::write(d.path().join(V5_STORE_FILE), encode_store(&other).unwrap()).unwrap();
        let (s, _) = load_at(d.path(), &v, no_create).unwrap();
        assert_eq!(s.seq(), 2, "the foreign file lost to the pinned registry copy");
        assert_eq!(unseals(&take_io_events()), 1, "only the changed file was opened");
    }

    #[test]
    fn fingerprints_are_computed_once_per_audience_and_canvas() {
        let mut f = BTreeMap::new();
        f.insert("MachineGuid", "3f2c9a1e-7b44-4c1d-9e0a-5d6f7a8b9c0d".to_string());
        f.insert("DiskSn", "S4EWNX0R123456".to_string());
        let c = FpCache::new();
        let canvas = "ab".repeat(32);
        let a = c.get(&f, Some(&canvas), "https://a.test");
        assert_eq!(a, fingerprint_for(&f, Some(&canvas), "https://a.test"), "the cache returns what it would compute");
        for _ in 0..5 { assert_eq!(c.get(&f, Some(&canvas), "https://a.test"), a); }
        assert_eq!(c.misses(), 1);
        let b = c.get(&f, Some(&canvas), "https://b.test");
        assert_ne!(a.board.as_ref().or(a.os.as_ref()), b.board.as_ref().or(b.os.as_ref()), "never served across audiences");
        c.get(&f, None, "https://a.test");
        assert_eq!(c.misses(), 3, "a different canvas digest is a different entry");
        // (No hardware markers: nothing to hash, so the loop tests the bound, not SHA-256.)
        let none = BTreeMap::new();
        for i in 0..200 { c.get(&none, None, &format!("https://h{}.test", i)); }
        assert!(c.len() <= FP_CACHE_MAX, "a page cycling audiences cannot grow it without bound");
    }
}
