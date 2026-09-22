//! Creator key v5.
//!
//! # What v4 was, and what was wrong with it
//!
//! v4's Creator ID is an ed25519 public key whose PRIVATE seed is derived from this PC's
//! identifiers (MachineGuid, ProductId, InstallDate, board/BIOS/CPU/disk serials, C: volume
//! serial) through iterated SHA-256, then cached in plain hex in `HKCU\...\Identity` and in a
//! plain `creator_v4.key` file. Three consequences:
//!
//! 1. **The private key is a function of values other programs can read.** Any local process,
//!    and anyone who learns those serials, can re-derive it. The 200 000 SHA-256 rounds slow a
//!    guess; they do nothing against someone who has the inputs.
//! 2. **It sat in clear twice** (file + registry), readable by anything running as the user and
//!    copied by every backup of the data folder.
//! 3. **Where the inputs are missing, every machine gets the same key.** `get_hwid_v4()` returns
//!    a CONSTANT on non-Windows builds and when every probe fails, so all such installs derived
//!    one shared private key — anyone could sign as all of them.
//!
//! v4 also had no rotation, and its proof (`bmmc1`) is a 120-second bearer token with no nonce:
//! captured once, it replays until it expires.
//!
//! # What v5 is
//!
//! The property worth keeping is unchanged: **a stable pseudonymous identifier backed by a key
//! pair whose holder can prove possession.** Everything else is layered around it.
//!
//! - **The Creator ID (`cid`) does not change.** It is still the 64-hex ed25519 public key of
//!   the ROOT key, and for every existing and returning install the root is the v4 key, so the
//!   id every repo owner, whitelist, ban list, free-tier claim and account link already holds
//!   keeps naming the same person. That is the compatibility argument in one line: v5 rotates
//!   the KEY, never the NAME. (Only the shared-fallback installs of point 3 get a fresh random
//!   root, because their old "identity" was never theirs alone.)
//! - **A separate ACTIVE key signs proofs.** It is random (OS CSPRNG), never derived from
//!   hardware. On upgrade the root signs a rotation certificate naming the first active key;
//!   every later rotation is signed by the previous active key ("old signs new"). A verifier
//!   walks the chain from `cid` to the key that signed the proof, so an id keeps its identity
//!   across any number of rotations without a server-side registry.
//! - **Key material is protected by the OS.** The store (root seed, active seed, chain) is
//!   encrypted with Windows DPAPI (user scope, with app-specific entropy) in
//!   `creator_v5.key`, with a DPAPI-encrypted copy in the registry. After a verified write
//!   the plaintext v2/v3/v4 files and the plaintext registry values are removed. On other
//!   platforms there is no DPAPI; the store is written unencrypted and `creator_key_info`
//!   says so rather than pretending.
//! - **Proof of possession with replay protection** (`bmmc5`): the active key signs
//!   `{v, cid, kid, aud, iat, exp, nonce, fp, chain}`. `aud` binds it to one origin, `exp`
//!   caps it at two minutes, and the random 128-bit `nonce` lets the server refuse a second
//!   use inside that window. The signature is over `"bmmc5." + payload` — domain-separated, so
//!   a v5 proof cannot be relabelled as a v1 token to dodge the nonce check.
//! - **The hardware fingerprint is a SEPARATE component**, never part of the key. It is a set
//!   of salted, iterated hashes, one per group (board, OS install, disk, canvas). The salt is
//!   derived from the proof's audience, so the values a BetterCommunity server sees cannot be
//!   correlated with what any other server sees. No serial, GUID or pixel leaves the machine:
//!   the tests below check the serialized proof for every raw input.
//!
//! # What v5 does NOT fix, stated plainly
//!
//! - For an upgraded install the root is still the v4 key, and the v4 key is still derivable
//!   from hardware. v5 contains that: proofs are signed by the random active key, and a server
//!   that has seen a v5 chain for an id pins it and refuses bare v4 proofs and forked chains
//!   for that id from then on. Repo signatures (`sign_message`) keep using the root so that
//!   every existing BMM can still verify them against the author's Creator ID; they inherit the
//!   v4 weakness until the ecosystem can verify chains.
//! - Losing the store (wiping app data AND the registry) loses the active key. The id
//!   survives (the root is re-derived from hardware), but a server that pinned the old chain
//!   refuses the new one until the account owner or staff resets the pin. That is the price of
//!   refusing forks, and it is the right direction to fail.
//! - Every fingerprint component is asserted by the client. It is a signal for spotting a
//!   re-generated id, not a proof of anything.
//!
//! # The canvas component: what it adds and what it costs
//!
//! BMM runs in a webview, so it can render a fixed 2D-canvas and WebGL scene and hash the
//! pixels (`frontend/src/core/canvas-fingerprint.ts`). The result depends on GPU, driver, font
//! rasteriser and OS, which makes it a second, hardware-independent stability signal: a user
//! who wipes the key store AND spoofs serials still renders the same canvas. That is what it
//! adds.
//!
//! What it costs: canvas fingerprinting is a recognised TRACKING technique. Under the Swiss
//! nLPD and the GDPR the hash is personal data (it singles out a device), so it needs a stated
//! purpose and legal basis, and the privacy policy says both (anti-abuse, legitimate interest;
//! see PRIVACY.md). It is also unstable across GPU driver updates, so the server scores it as
//! one component among four and never acts on it alone. Rust accepts only a 64-hex digest from
//! the webview — never pixels — and re-hashes it with the audience salt before it leaves.
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use base64::Engine;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

/// The DPAPI-protected store beside data.json.
pub const V5_STORE_FILE: &str = "creator_v5.key";
/// Registry value holding a (DPAPI-protected) copy of the same bytes.
const V5_REG_VALUE: &str = "K5";
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
const MAGIC_PLAIN: &[u8; 8] = b"BMMK5PL1";
const DPAPI_ENTROPY: &[u8] = b"BMM-CREATOR-KEY-V5";

fn b64u() -> base64::engine::GeneralPurpose { base64::engine::general_purpose::URL_SAFE_NO_PAD }

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn random_32() -> [u8; 32] {
    use rand::RngCore;
    let mut b = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut b);
    b
}

fn random_16() -> [u8; 16] {
    use rand::RngCore;
    let mut b = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut b);
    b
}

fn seed_from_hex(h: &str) -> Result<[u8; 32], String> {
    let v = hex::decode(h).map_err(|_| "bad seed".to_string())?;
    v.try_into().map_err(|_| "bad seed length".to_string())
}

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct KeyStoreV5 {
    /// Always 5.
    pub v: u32,
    /// `v4-derived` or `random`.
    pub root_kind: String,
    /// Hex seed of the root key — the Creator ID's private half.
    pub root: String,
    /// Hex seed of the active key, which signs proofs.
    pub active: String,
    /// `bmmk5` rotation certificates from the root to the active key, oldest first.
    #[serde(default)]
    pub chain: Vec<String>,
    pub created: u64,
    #[serde(default)]
    pub rotated: u64,
}

impl KeyStoreV5 {
    /// A store around an existing root. A v4-derived root is rotated at once, so the key that
    /// signs proofs is never one the hardware can reproduce; a random root signs its own.
    pub fn from_root(root_seed: [u8; 32], root_kind: &str, now: u64, first_active: [u8; 32]) -> Result<Self, String> {
        let mut s = KeyStoreV5 {
            v: 5,
            root_kind: root_kind.to_string(),
            root: hex::encode(root_seed),
            active: hex::encode(root_seed),
            chain: Vec::new(),
            created: now,
            rotated: 0,
        };
        if root_kind == ROOT_V4_DERIVED {
            s.rotate(first_active, now)?;
        }
        Ok(s)
    }

    pub fn root_key(&self) -> Result<SigningKey, String> { Ok(SigningKey::from_bytes(&seed_from_hex(&self.root)?)) }
    pub fn active_key(&self) -> Result<SigningKey, String> { Ok(SigningKey::from_bytes(&seed_from_hex(&self.active)?)) }
    /// The Creator ID: the root's public key. Never changes for the life of the store.
    pub fn cid(&self) -> Result<String, String> { Ok(pk_hex(&self.root_key()?)) }
    /// The key id: the active key's public key.
    pub fn kid(&self) -> Result<String, String> { Ok(pk_hex(&self.active_key()?)) }
    pub fn seq(&self) -> usize { self.chain.len() }

    /// Replace the active key; the CURRENT active key signs the certificate for the new one.
    pub fn rotate(&mut self, next_seed: [u8; 32], now: u64) -> Result<(), String> {
        if self.chain.len() >= MAX_CHAIN {
            return Err(format!("Rotation chain is full ({} links)", MAX_CHAIN));
        }
        let prev = self.active_key()?;
        let next = SigningKey::from_bytes(&next_seed);
        let cert = make_rotation_cert(&prev, &self.cid()?, &(&next).into(), self.chain.len() + 1, now);
        self.chain.push(cert);
        self.active = hex::encode(next_seed);
        self.rotated = now;
        Ok(())
    }

    /// The store is internally consistent: the chain leads from `cid` to the active key.
    pub fn validate(&self) -> Result<(), String> {
        if self.v != 5 { return Err("not a v5 store".into()); }
        let end = verify_chain(&self.cid()?, &self.chain)?;
        if end != self.kid()? { return Err("chain does not end at the active key".into()); }
        Ok(())
    }
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

/// Which raw markers make up each group. A CPU swap changes `board`, a new disk changes
/// `disk`, a Windows reinstall changes `os`, a driver update may change `canvas` — the
/// server's stability score reads exactly that.
const GROUPS: &[(&str, &[&str])] = &[
    ("board", &["SystemUUID", "BaseboardSerial", "BiosSerial", "CpuId"]),
    ("os", &["MachineGuid", "ProductId", "InstallDate"]),
    ("disk", &["DiskSn", "VolumeSn", "DiskModel"]),
];

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
    let group = |name: &str, members: &[&str]| -> Option<String> {
        let mut material = String::new();
        let mut any = false;
        for m in members {
            let v = fields.get(m).map(|s| s.trim().to_uppercase()).unwrap_or_default();
            if !v.is_empty() { any = true; }
            material.push_str(m);
            material.push('=');
            material.push_str(&v);
            material.push('|');
        }
        if any { Some(fp_hash(&key, name, &material)) } else { None }
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
// Store encoding — DPAPI on Windows
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn dpapi(data: &[u8], protect: bool) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let entropy = CRYPT_INTEGER_BLOB { cbData: DPAPI_ENTROPY.len() as u32, pbData: DPAPI_ENTROPY.as_ptr() as *mut u8 };
    let mut out = CRYPT_INTEGER_BLOB::default();
    // SAFETY: every pointer handed over outlives the call; `out` is allocated by the API and
    // released with LocalFree once copied.
    unsafe {
        let r = if protect {
            CryptProtectData(&input, windows::core::PCWSTR::null(), Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        } else {
            CryptUnprotectData(&input, None, Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        };
        r.map_err(|e| format!("DPAPI: {}", e))?;
        if out.pbData.is_null() { return Err("DPAPI returned nothing".into()); }
        let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(HLOCAL(out.pbData as *mut core::ffi::c_void));
        Ok(v)
    }
}

/// Is the store protected by the OS on this platform?
pub fn os_protected() -> bool { cfg!(target_os = "windows") }

pub fn encode_store(store: &KeyStoreV5) -> Result<Vec<u8>, String> {
    let json = serde_json::to_vec(store).map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    {
        let mut out = MAGIC_DPAPI.to_vec();
        out.extend(dpapi(&json, true)?);
        Ok(out)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut out = MAGIC_PLAIN.to_vec();
        out.extend(json);
        Ok(out)
    }
}

pub fn decode_store(bytes: &[u8]) -> Result<KeyStoreV5, String> {
    if bytes.len() < 8 { return Err("store too short".into()); }
    let (magic, body) = bytes.split_at(8);
    let json = if magic == MAGIC_DPAPI {
        #[cfg(target_os = "windows")]
        { dpapi(body, false)? }
        #[cfg(not(target_os = "windows"))]
        { return Err("DPAPI store on a platform without DPAPI".into()); }
    } else if magic == MAGIC_PLAIN {
        body.to_vec()
    } else {
        return Err("unknown store format".into());
    };
    let s: KeyStoreV5 = serde_json::from_slice(&json).map_err(|e| e.to_string())?;
    s.validate()?;
    Ok(s)
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading, migrating, persisting
// ─────────────────────────────────────────────────────────────────────────────

static STORE: Mutex<Option<KeyStoreV5>> = Mutex::new(None);

fn store_path(handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = handle.path().app_data_dir().map_err(|_| "No app-data directory".to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(V5_STORE_FILE))
}

#[cfg(target_os = "windows")]
fn reg_read() -> Option<Vec<u8>> {
    use winreg::enums::HKEY_CURRENT_USER;
    let k = winreg::RegKey::predef(HKEY_CURRENT_USER).open_subkey("SOFTWARE\\BetterModsManager\\Identity").ok()?;
    let h: String = k.get_value(V5_REG_VALUE).ok()?;
    hex::decode(h).ok()
}
#[cfg(not(target_os = "windows"))]
fn reg_read() -> Option<Vec<u8>> { None }

#[cfg(target_os = "windows")]
fn reg_write(bytes: &[u8]) {
    use winreg::enums::HKEY_CURRENT_USER;
    if let Ok((k, _)) = winreg::RegKey::predef(HKEY_CURRENT_USER).create_subkey("SOFTWARE\\BetterModsManager\\Identity") {
        let _ = k.set_value(V5_REG_VALUE, &hex::encode(bytes));
    }
}
#[cfg(not(target_os = "windows"))]
fn reg_write(_bytes: &[u8]) {}

/// Write the store to both places and read it back. Only a store that decodes to the same
/// thing counts as saved — the plaintext copies are deleted on the strength of this.
fn persist(handle: &AppHandle, store: &KeyStoreV5) -> Result<(), String> {
    let bytes = encode_store(store)?;
    let path = store_path(handle)?;
    let tmp = path.with_extension("key.tmp");
    fs::write(&tmp, &bytes).map_err(|e| format!("Could not write the key store: {}", e))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Could not write the key store: {}", e))?;
    reg_write(&bytes);
    let back = decode_store(&fs::read(&path).map_err(|e| e.to_string())?)?;
    if &back != store { return Err("Key store read-back mismatch".into()); }
    Ok(())
}

/// The whole identity, loading or creating it on first use. Cached for the process.
pub fn load_store(handle: &AppHandle) -> Result<KeyStoreV5, String> {
    let mut guard = STORE.lock().map_err(|_| "key store lock poisoned".to_string())?;
    if let Some(s) = guard.as_ref() { return Ok(s.clone()); }

    let path = store_path(handle)?;
    // 1. The v5 file. 2. Its registry copy (restores the file).
    let from_file = fs::read(&path).ok().and_then(|b| decode_store(&b).ok());
    let loaded = match from_file {
        Some(s) => { if reg_read().is_none() { if let Ok(b) = encode_store(&s) { reg_write(&b); } } Some(s) }
        None => reg_read().and_then(|b| decode_store(&b).ok()).map(|s| { let _ = persist(handle, &s); s }),
    };
    let store = match loaded {
        Some(s) => s,
        None => {
            // 3. Upgrade from v4 (or a first launch): the same root v4 would have used, so
            //    the Creator ID is unchanged — unless that root is one every fallback install
            //    shares, in which case it was never an identity and a random root replaces it.
            let (seed, shared) = crate::commands::security::legacy_root_seed(handle);
            let s = if shared {
                KeyStoreV5::from_root(random_32(), ROOT_RANDOM, now_secs(), random_32())?
            } else {
                KeyStoreV5::from_root(seed, ROOT_V4_DERIVED, now_secs(), random_32())?
            };
            persist(handle, &s)?;
            // Only now, with a verified protected copy, remove the plaintext ones.
            crate::commands::security::scrub_legacy_plaintext(handle);
            s
        }
    };
    *guard = Some(store.clone());
    Ok(store)
}

fn replace_store(handle: &AppHandle, next: KeyStoreV5) -> Result<(), String> {
    persist(handle, &next)?;
    if let Ok(mut g) = STORE.lock() { *g = Some(next); }
    Ok(())
}

/// Raw hardware markers, read once per process (the CIM query costs about a second).
fn hw_fields() -> BTreeMap<&'static str, String> {
    static F: std::sync::OnceLock<BTreeMap<&'static str, String>> = std::sync::OnceLock::new();
    F.get_or_init(crate::commands::security::hwid_v4_fields).clone()
}

// ─────────────────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────────────────

/// A v5 proof of possession for one audience. `canvas` is the webview's render digest
/// (64 hex); anything else is ignored rather than sent.
#[tauri::command]
pub fn creator_proof_v5(handle: AppHandle, aud: String, canvas: Option<String>) -> Result<String, String> {
    let aud = validate_aud(&aud)?;
    let store = load_store(&handle)?;
    let fp = fingerprint_for(&hw_fields(), canvas.as_deref(), &aud);
    build_proof(&store, &aud, now_secs(), random_16(), &fp)
}

#[derive(Serialize)]
pub struct CreatorKeyInfo {
    pub version: u32,
    pub cid: String,
    pub kid: String,
    pub seq: usize,
    #[serde(rename = "rootKind")]
    pub root_kind: String,
    /// "dpapi" or "none".
    pub protection: String,
    pub created: u64,
    pub rotated: u64,
}

fn info_of(s: &KeyStoreV5) -> Result<CreatorKeyInfo, String> {
    Ok(CreatorKeyInfo {
        version: 5,
        cid: s.cid()?,
        kid: s.kid()?,
        seq: s.seq(),
        root_kind: s.root_kind.clone(),
        protection: if os_protected() { "dpapi".into() } else { "none".into() },
        created: s.created,
        rotated: s.rotated,
    })
}

/// What this install's key is — public parts only.
#[tauri::command]
pub fn creator_key_info(handle: AppHandle) -> Result<CreatorKeyInfo, String> {
    info_of(&load_store(&handle)?)
}

/// Replace the active key. The Creator ID does not change; servers follow the chain.
#[tauri::command]
pub fn rotate_creator_key(handle: AppHandle) -> Result<CreatorKeyInfo, String> {
    let mut s = load_store(&handle)?;
    s.rotate(random_32(), now_secs())?;
    s.validate()?;
    replace_store(&handle, s.clone())?;
    info_of(&s)
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
            assert!(!hay.contains(&s.root) && !hay.contains(&s.active), "seed readable in the store");
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
