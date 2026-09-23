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
//!   the plaintext v2/v3/v4 files and the plaintext registry values are removed. (Off
//!   Windows, see v5.1 below.)
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
//! # What v5.1 adds: the identity cannot be swapped, rolled back or silently lost
//!
//! v5.0 trusted whatever store decoded. Copy another machine's `creator_v5.key` in, restore
//! last month's backup of the data folder, or edit `created` in a non-DPAPI store, and BMM
//! took it. v5.1 (all in `creator_v5/keystore.rs`, each point with a test that failed on
//! v5.0 first):
//!
//! - **Identity pin.** On the first successful store the Creator ID is pinned twice, apart
//!   from the store: `creator_v5.pin` beside it and the `P5` registry value (the keyring off
//!   Windows). A store whose `cid` differs from a pin is REFUSED, not adopted; a foreign file
//!   next to an intact registry copy loses to the copy and is repaired from it.
//! - **Anti-rollback.** The pin also holds the highest chain length seen and a digest of that
//!   chain. A store with a shorter chain (an old backup) or a chain that does not extend the
//!   pinned one (a fork) is refused.
//! - **Integrity.** The root signs every non-secret field — `v`, `root_kind`, `created`,
//!   `rotated`, `cid`, `kid`, the chain — as `bmms5` (the `sig` field). Any edit is detected
//!   on every platform, DPAPI or not. A v5.0 store (unsigned) is signed and pinned on its first
//!   v5.1 load, with its Creator ID and keys unchanged; after that an unsigned store is refused.
//! - **Off Windows: the OS keyring.** macOS Keychain or Linux Secret Service (`keyring`
//!   crate) holds a random key; the store file is AES-256-GCM under it. With no keyring
//!   running, the store is a 0600 file and `creator_key_info.protection` says "file-0600"
//!   (else "dpapi", "keychain", "secret-service").
//! - **Memory.** Seeds live in `Zeroizing` buffers (the store's hex strings, every decoded
//!   seed, DPAPI's output — and the buffer DPAPI returned is wiped before it is freed);
//!   `Debug` on the store prints public keys, never seeds.
//! - **One writer.** An OS file lock (`creator_v5.lock`) is held around load-migrate, rotate
//!   and reset, and a rotation re-reads the store under it: two BMMs rotating at once extend
//!   one chain instead of forking it.
//! - **Durable writes.** Temp file, `sync_all`, rename (then an fsync of the folder on Unix);
//!   the legacy plaintext copies are deleted only after that write read back byte for byte.
//! - **The way out is explicit.** A refused store is an error starting `bmm.creator.refused|`;
//!   nothing is overwritten. The only recovery is `creator_identity_reset`, offered by the
//!   settings screen behind a confirmation: it RENAMES the old store and pin aside (never
//!   deletes them), builds a new store exactly as a first launch would (same Creator ID for a
//!   v4-derived root, a new one for a random root), pins it, and appends a line to
//!   `creator_v5.log`.
//!
//! And the I/O (plan L2, measured in `benchmarks/rust/benches/creator_key.rs`): identical
//! file and registry copies are unsealed once; bytes this process already opened or wrote are
//! not unsealed again (compared as bytes); a rotation's read-back compares bytes instead of
//! re-running DPAPI; fingerprints are cached per audience for the process; and the CIM
//! hardware query (1-5 s) runs on a background thread at startup, not in the first proof.
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
//! - **v5.1 protects against a copied, restored or edited store, not against code running as
//!   you.** Such code can read the registry and the data folder, call DPAPI or the keyring as
//!   you, delete both pins and write a store of its choosing. The pin is trust-on-first-use:
//!   before the first v5.1 load there is nothing to compare with. And the store signature is
//!   made with a key the store itself holds: it catches an edit, not someone who re-signs.
//! - DPAPI is tied to the Windows account's credentials: an administrator resetting the
//!   password (not the user changing it) makes the store unreadable. Once pinned, that is a
//!   refusal, and the reset is the way out — same Creator ID for a v4-derived root, but a new
//!   chain that a server which pinned the old one refuses until staff reset it.
//! - A keyring that disappears (a Linux session without Secret Service) leaves a `Wrapped`
//!   store that cannot be opened: refused, not replaced. Only the Windows paths have been run.
//!   The AES-GCM sealing is tested on Windows through `MemVault`, and the keyring calls were
//!   type-checked against the `keyring` crate there, but nothing has been built or run on
//!   macOS or Linux.
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
pub mod keystore;
pub use keystore::*;

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Manager};

// ─────────────────────────────────────────────────────────────────────────────
// Where the store lives on this machine
// ─────────────────────────────────────────────────────────────────────────────

/// Windows: the user registry, `HKCU\SOFTWARE\BetterModsManager\Identity`, one hex string per
/// value (`K5` the sealed store, `P5` the pin). The store itself is sealed with DPAPI.
#[cfg(target_os = "windows")]
struct RegistryVault;
#[cfg(target_os = "windows")]
impl Vault for RegistryVault {
    fn get(&self, name: &str) -> Option<Vec<u8>> {
        use winreg::enums::HKEY_CURRENT_USER;
        let k = winreg::RegKey::predef(HKEY_CURRENT_USER).open_subkey("SOFTWARE\\BetterModsManager\\Identity").ok()?;
        let h: String = k.get_value(name).ok()?;
        hex::decode(h).ok()
    }
    fn set(&self, name: &str, bytes: &[u8]) -> Result<(), String> {
        use winreg::enums::HKEY_CURRENT_USER;
        let (k, _) = winreg::RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey("SOFTWARE\\BetterModsManager\\Identity")
            .map_err(|e| e.to_string())?;
        k.set_value(name, &hex::encode(bytes)).map_err(|e| e.to_string())
    }
    fn delete(&self, name: &str) {
        use winreg::enums::{HKEY_CURRENT_USER, KEY_ALL_ACCESS};
        if let Ok(k) = winreg::RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags("SOFTWARE\\BetterModsManager\\Identity", KEY_ALL_ACCESS)
        {
            let _ = k.delete_value(name);
        }
    }
    fn seal(&self) -> Seal { Seal::Dpapi }
}

/// macOS / Linux: the OS keyring (Keychain, Secret Service). It holds the key the store file
/// is sealed under (`W5`), a copy of the sealed store and the pin. Untested here: this build
/// machine is Windows-only — see the module note.
#[cfg(not(target_os = "windows"))]
struct KeyringVault { label: &'static str }
#[cfg(not(target_os = "windows"))]
impl KeyringVault {
    const SERVICE: &'static str = "BetterModsManager.creator-key";
    fn entry(name: &str) -> Option<keyring::Entry> { keyring::Entry::new(Self::SERVICE, name).ok() }
    /// A keyring that is compiled in is not necessarily running (a headless Linux session has
    /// no Secret Service). Write through one handle, read back through ANOTHER, delete: only a
    /// round trip through the store counts. (keyring's in-memory mock — what it silently uses
    /// when no platform feature applies — keeps a secret per handle, so it fails this.)
    fn probe() -> Option<KeyringVault> {
        let label = if cfg!(target_os = "macos") { "keychain" } else { "secret-service" };
        Self::entry("probe")?.set_secret(b"bmm").ok()?;
        let ok = Self::entry("probe")?.get_secret().ok().as_deref() == Some(&b"bmm"[..]);
        if let Some(e) = Self::entry("probe") { let _ = e.delete_credential(); }
        ok.then_some(KeyringVault { label })
    }
}
#[cfg(not(target_os = "windows"))]
impl Vault for KeyringVault {
    fn get(&self, name: &str) -> Option<Vec<u8>> { Self::entry(name)?.get_secret().ok() }
    fn set(&self, name: &str, bytes: &[u8]) -> Result<(), String> {
        Self::entry(name).ok_or("keyring unavailable")?.set_secret(bytes).map_err(|e| e.to_string())
    }
    fn delete(&self, name: &str) { if let Some(e) = Self::entry(name) { let _ = e.delete_credential(); } }
    fn seal(&self) -> Seal { Seal::Wrapped(self.label) }
}

/// The vault for this process, chosen once. Without a keyring (non-Windows) it is `NoVault`
/// and the store is a 0600 file — `creator_key_info.protection` says "file-0600".
fn vault() -> &'static dyn Vault {
    static V: OnceLock<Box<dyn Vault>> = OnceLock::new();
    V.get_or_init(|| {
        #[cfg(target_os = "windows")]
        { Box::new(RegistryVault) }
        #[cfg(not(target_os = "windows"))]
        {
            match KeyringVault::probe() {
                Some(k) => Box::new(k) as Box<dyn Vault>,
                None => Box::new(NoVault),
            }
        }
    })
    .as_ref()
}

static STORE: Mutex<Option<KeyStoreV5>> = Mutex::new(None);

fn store_dir(handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = handle.path().app_data_dir().map_err(|_| "No app-data directory".to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// A fresh store for this machine: the root v4 would have used, so the Creator ID of an
/// upgrading install is unchanged — unless that root is one every fallback install shares, in
/// which case it was never an identity and a random root replaces it.
fn new_store(handle: &AppHandle) -> Result<KeyStoreV5, String> {
    let (seed, shared) = crate::commands::security::legacy_root_seed(handle);
    let seed = zeroize::Zeroizing::new(seed);
    if shared {
        KeyStoreV5::from_root(random_32(), ROOT_RANDOM, now_secs(), random_32())
    } else {
        KeyStoreV5::from_root(*seed, ROOT_V4_DERIVED, now_secs(), random_32())
    }
}

/// The whole identity, loading or creating it on first use. Cached for the process.
///
/// A refused store (another Creator ID, a rollback, a fork, an altered file) is an error that
/// starts with `REFUSED`; nothing is cached, nothing is overwritten, and the only way forward
/// is `creator_identity_reset`, which the settings screen offers behind a confirmation.
pub fn load_store(handle: &AppHandle) -> Result<KeyStoreV5, String> {
    let mut guard = STORE.lock().map_err(|_| "key store lock poisoned".to_string())?;
    if let Some(s) = guard.as_ref() { return Ok(s.clone()); }
    let dir = store_dir(handle)?;
    let (store, created) = load_at(&dir, vault(), || new_store(handle)).inspect_err(|e| {
        // Once per distinct reason: every caller retries, and the log is not a metronome.
        static LAST: Mutex<String> = Mutex::new(String::new());
        if let Ok(mut last) = LAST.lock() {
            if *last != *e { tracing::warn!("creator key: {}", e); *last = e.clone(); }
        }
    })?;
    // Only now, with a durable, read-back protected copy, remove the plaintext ones.
    if created { crate::commands::security::scrub_legacy_plaintext(handle); }
    *guard = Some(store.clone());
    Ok(store)
}

/// Raw hardware markers, read once per process (the CIM query costs one to several seconds).
fn hw_fields() -> &'static BTreeMap<&'static str, String> {
    static F: OnceLock<BTreeMap<&'static str, String>> = OnceLock::new();
    F.get_or_init(crate::commands::security::hwid_v4_fields)
}

/// Fingerprints already computed in this process, per audience (see `FpCache`).
static FP_CACHE: FpCache = FpCache::new();

/// Take the slow first steps off the critical path: the CIM hardware query (seconds, a
/// PowerShell process) and the first unseal of the store. Called once at startup on a
/// background thread; a proof or a Creator ID asked for meanwhile simply waits on the same
/// `OnceLock` / store lock instead of starting its own query. Errors are left for the caller
/// that actually needs the key — a refused store is reported there, with its way out.
pub fn warm_up(handle: AppHandle) {
    let _ = std::thread::Builder::new().name("creator-key-warmup".into()).spawn(move || {
        let _ = hw_fields();
        let _ = load_store(&handle);
    });
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
    let fp = FP_CACHE.get(hw_fields(), canvas.as_deref(), &aud);
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
    /// How the store is sealed at rest: "dpapi" (Windows), "keychain" (macOS),
    /// "secret-service" (Linux), or "file-0600" (no keyring: an owner-only file).
    pub protection: String,
    /// v5.1: the Creator ID is pinned (registry/keyring + file) and the store is signed.
    pub pinned: bool,
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
        protection: vault().seal().protection().to_string(),
        pinned: s.is_signed(),
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
/// Re-reads the store under the file lock, so it extends what is on disk, never a stale copy.
#[tauri::command]
pub fn rotate_creator_key(handle: AppHandle) -> Result<CreatorKeyInfo, String> {
    let mut guard = STORE.lock().map_err(|_| "key store lock poisoned".to_string())?;
    let s = rotate_at(&store_dir(&handle)?, vault(), random_32(), now_secs())?;
    *guard = Some(s.clone());
    info_of(&s)
}

/// What the settings screen must send to `creator_identity_reset`. Not a secret — a guard
/// against a stray call: the reset is never one click and never implicit.
pub const RESET_CONFIRM: &str = "RESET-CREATOR-IDENTITY";

/// The recovery path when the store is refused or lost. Sets the current store and pin aside
/// (renamed, not deleted), builds a new store exactly as a first launch would, pins it and
/// logs it in `creator_v5.log`. For an install whose root is v4-derived the Creator ID comes
/// back the same (the root is re-derived from this PC) with a new chain; for a random root it
/// is a NEW identity. Either way a server that pinned the old chain refuses the new one until
/// staff reset that pin — the screen says so before asking.
#[tauri::command]
pub fn creator_identity_reset(handle: AppHandle, confirm: String) -> Result<CreatorKeyInfo, String> {
    if confirm != RESET_CONFIRM { return Err("Reset not confirmed".into()); }
    let mut guard = STORE.lock().map_err(|_| "key store lock poisoned".to_string())?;
    let (s, old) = reset_at(&store_dir(&handle)?, vault(), || new_store(&handle), "user reset from settings")?;
    tracing::warn!(
        "creator key: identity reset by the user (old {}, new {})",
        old.as_deref().unwrap_or("none"), s.cid().unwrap_or_default()
    );
    crate::commands::security::scrub_legacy_plaintext(&handle);
    *guard = Some(s.clone());
    info_of(&s)
}
