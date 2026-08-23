//! Proving you hold a private key, to a server that only knows your public one.
//!
//! WHY THIS EXISTS
//!
//! A repo or catalog could already be restricted by IP, by account, or by creator id. The
//! creator id is the interesting failure: it arrives in `X-Creator-ID`, which the CLIENT
//! chooses, so an allow list keyed on it is passed by claiming an id that is on it. The
//! platform's answer for account-backed identities is a signed attestation (see
//! identity-attestation.mjs on the BCWEB side) — but that needs an account.
//!
//! This is the account-free half. The owner pastes a PUBLIC key; the subscriber proves it
//! holds the matching private one. No account, no registration, and nothing the client can
//! simply assert.
//!
//! WHICH KEY
//!
//! The one already configured for SSH. Same file, same field, and the same sentence the docs
//! already say about it: the public half goes on the server. Asking people to manage a second
//! keypair for this would be a second thing to lose.
//!
//! ed25519 ONLY, and that is a decision rather than a limitation. The signature has to be
//! verifiable by BOTH servers that enforce it — BMM's own repo server (Rust) and BetterCommunity
//! (Node). Node can rebuild an ed25519 public key from its OpenSSH form with a fixed 12-byte
//! SPKI prefix and verify a raw signature directly; RSA and ECDSA would each need their own
//! conversion, so supporting them would mean a server whose accepted key types depend on which
//! server it is. One algorithm, both servers, no capability difference — and ed25519 is what
//! the documentation already tells people to prefer.
//!
//! THE FORMAT
//!
//!   bmmk1.<base64url(payload JSON)>.<base64url(raw ed25519 signature)>
//!
//! Deliberately shaped like the platform's existing `bcw1.` attestation, including the part
//! that matters: THE SIGNATURE COVERS THE BASE64URL PAYLOAD SEGMENT AS TRANSMITTED, not the
//! JSON it decodes to. Signing the decoded form would make validity depend on both sides
//! serialising byte-for-byte identically, and a differing key order would look like a forgery.
//!
//! IT IS A BEARER TOKEN
//!
//! Whoever holds a live proof can replay it until it expires — the same exposure the
//! attestation documents for itself, and the same as a session cookie. The window is small
//! (see TTL_SECONDS) because signing is cheap enough to do per request, and the proof names
//! the AUDIENCE it was made for, so one captured against your own server cannot be presented
//! to somebody else's.

// NOT YET WIRED, and said out loud rather than left to be discovered.
//
// The mechanism is complete and tested; its two consumers are the next change — BMM's own
// repo server calls `verify_proof`, and the client attaches `HEADER` to its requests. The
// allow is scoped to this module and comes off with them.
//
// Landing it separately is deliberate: this is the part that has to be RIGHT, and it is much
// easier to review a signature scheme on its own than buried in a diff that also moves a
// dozen call sites.

use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};

/// How long a proof stays valid. Short on purpose: it is a bearer token, and making a new one
/// costs a signature, which is nothing. Long enough to survive a slow request and a clock a
/// little out of step, not long enough to be worth capturing.
pub const TTL_SECONDS: u64 = 120;

/// The header a client sends and a server reads.
pub const HEADER: &str = "X-BMM-Key-Proof";

const PREFIX: &str = "bmmk1";

#[derive(Debug, Serialize, Deserialize)]
struct Payload {
    /// The raw ed25519 public key, base64. What the owner pasted, minus the OpenSSH wrapper.
    pk: String,
    /// What this proof is FOR. A proof made for one repo must not open another.
    aud: String,
    /// Unix seconds. Absolute rather than a duration so a client with a wrong clock fails
    /// closed instead of minting something valid forever.
    exp: u64,
}

fn b64u() -> base64::engine::general_purpose::GeneralPurpose {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
}

/// The ed25519 seed inside an SSH private key.
///
/// Any other algorithm is refused HERE rather than at the far end, so the message names the
/// real problem — "this feature needs an ed25519 key" — instead of a signature that simply
/// fails to verify against a server that could never have checked it.
fn ed25519_seed(key: &russh::keys::PrivateKey) -> Result<[u8; 32], String> {
    match key.key_data() {
        russh::keys::ssh_key::private::KeypairData::Ed25519(pair) => Ok(pair.private.to_bytes()),
        _ => Err("repo.keyauth.errNotEd25519".to_string()),
    }
}

/// Build a proof for `audience` from an SSH private key file.
///
/// `passphrase` is used and dropped; nothing about the key is retained.
pub fn make_proof(key_path: &str, passphrase: Option<&str>, audience: &str) -> Result<String, String> {
    let text = std::fs::read_to_string(key_path)
        .map_err(|e| format!("repo.ssh.errKeyRead|{}|{}", key_path, e))?;
    let key = russh::keys::decode_secret_key(&text, passphrase)
        .map_err(|e| format!("repo.ssh.errKeyDecode|{}", e))?;
    let seed = ed25519_seed(&key)?;
    let sk = SigningKey::from_bytes(&seed);

    let exp = now_secs() + TTL_SECONDS;
    let payload = Payload {
        pk: base64::engine::general_purpose::STANDARD.encode(sk.verifying_key().to_bytes()),
        aud: audience.to_string(),
        exp,
    };
    let json = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let seg = b64u().encode(json);
    // Sign the SEGMENT, not the JSON — see the header note.
    let sig = sk.sign(seg.as_bytes());
    Ok(format!("{}.{}.{}", PREFIX, seg, b64u().encode(sig.to_bytes())))
}

/// Verify a proof against a set of authorised public keys.
///
/// `authorised` holds raw ed25519 public keys, base64 — the same form `Payload::pk` carries,
/// so a server stores what it compares. Returns the matching key on success, so a caller can
/// log WHICH key opened the door without re-deriving it.
pub fn verify_proof(
    proof: &str,
    authorised: &[String],
    audience: &str,
) -> Result<String, String> {
    let mut parts = proof.split('.');
    if parts.next() != Some(PREFIX) {
        return Err("repo.keyauth.errFormat".into());
    }
    let seg = parts.next().ok_or("repo.keyauth.errFormat")?;
    let sig_b64 = parts.next().ok_or("repo.keyauth.errFormat")?;
    if parts.next().is_some() {
        return Err("repo.keyauth.errFormat".into());
    }

    let payload: Payload = serde_json::from_slice(&b64u().decode(seg).map_err(|_| "repo.keyauth.errFormat")?)
        .map_err(|_| "repo.keyauth.errFormat")?;

    // Expiry BEFORE the signature: an expired proof is not worth the verification, and
    // checking it first means a flood of stale tokens costs a comparison rather than a
    // curve operation each.
    if payload.exp <= now_secs() {
        return Err("repo.keyauth.errExpired".into());
    }
    if payload.aud != audience {
        // A proof minted for another repo. Its signature is perfectly valid, which is exactly
        // why the audience has to be checked rather than assumed.
        return Err("repo.keyauth.errAudience".into());
    }
    // Is this key allowed AT ALL? Asked before verifying, for the same reason as expiry.
    if !authorised.iter().any(|k| k == &payload.pk) {
        return Err("repo.keyauth.errNotAuthorised".into());
    }

    let raw = base64::engine::general_purpose::STANDARD
        .decode(&payload.pk)
        .map_err(|_| "repo.keyauth.errFormat")?;
    let pk_bytes: [u8; 32] = raw.try_into().map_err(|_| "repo.keyauth.errFormat")?;
    let vk = ed25519_dalek::VerifyingKey::from_bytes(&pk_bytes)
        .map_err(|_| "repo.keyauth.errFormat")?;
    let sig_bytes: [u8; 64] = b64u()
        .decode(sig_b64)
        .map_err(|_| "repo.keyauth.errFormat")?
        .try_into()
        .map_err(|_| "repo.keyauth.errFormat")?;
    let sig = ed25519_dalek::Signature::from_bytes(&sig_bytes);
    ed25519_dalek::Verifier::verify(&vk, seg.as_bytes(), &sig)
        .map_err(|_| "repo.keyauth.errSignature".to_string())?;
    Ok(payload.pk)
}

/// The raw ed25519 public key inside an OpenSSH one-line public key, base64.
///
/// This is what an owner pastes (`ssh-ed25519 AAAA… you@machine`) turned into what a server
/// stores and compares. Doing the conversion once, here, means the owner is never asked to
/// paste a format nobody else uses.
pub fn pubkey_from_openssh(line: &str) -> Result<String, String> {
    let mut it = line.split_whitespace();
    let alg = it.next().unwrap_or("");
    if alg != "ssh-ed25519" {
        return Err("repo.keyauth.errNotEd25519".into());
    }
    let blob = base64::engine::general_purpose::STANDARD
        .decode(it.next().unwrap_or(""))
        .map_err(|_| "repo.keyauth.errFormat")?;
    // OpenSSH blob: [len]"ssh-ed25519" [len]<32-byte key>
    let mut o = 0usize;
    let mut read = |n: usize| -> Result<Vec<u8>, String> {
        if o + 4 > blob.len() {
            return Err("repo.keyauth.errFormat".into());
        }
        let len = u32::from_be_bytes(blob[o..o + 4].try_into().unwrap()) as usize;
        o += 4;
        if o + len > blob.len() || len > 1024 {
            return Err("repo.keyauth.errFormat".into());
        }
        let out = blob[o..o + len].to_vec();
        o += len;
        let _ = n;
        Ok(out)
    };
    let alg2 = read(0)?;
    if alg2 != b"ssh-ed25519" {
        return Err("repo.keyauth.errNotEd25519".into());
    }
    let raw = read(0)?;
    if raw.len() != 32 {
        return Err("repo.keyauth.errFormat".into());
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(raw))
}

// ── the client side ─────────────────────────────────────────────────────────

/// A cached proof, so a sync of a thousand files signs once rather than a thousand times.
///
/// Keyed by audience. Signing costs about 50µs, which is nothing once and real per file — and
/// the cache is what makes attaching a proof to EVERY outbound request affordable, which in
/// turn is what lets this work with no per-source setting at all.
static PROOF_CACHE: std::sync::Mutex<Option<Vec<(String, String, u64)>>> = std::sync::Mutex::new(None);

/// The audience for a URL: its origin, and nothing else.
///
/// Origin rather than the full path because a repo is many files and they would otherwise
/// need a proof each. Scoping to the server is enough: whether a given key may read a given
/// repo is decided by that repo's own authorised list, not by the proof.
pub fn audience_for(url: &str) -> Option<String> {
    let rest = url.split("://").nth(1)?;
    let scheme = url.split("://").next()?;
    let host = rest.split('/').next()?;
    // BOTH halves, not just the host. `://x` has an empty scheme and produced the audience
    // `://x`, which a server would never match — a proof that can only ever be rejected, for
    // a reason nothing would name. Found by testing the malformed cases rather than the
    // well-formed ones.
    if scheme.is_empty() || host.is_empty() { return None; }
    Some(format!("{}://{}", scheme, host))
}

/// The keyring, mirrored out of settings.
///
/// Statics rather than a lookup through AppState because the three request builders that need
/// them do not all have one: `fetch_repo_info` is a plain async fn with three internal callers,
/// one of them a test, and threading a handle through all of them to reach values that are not
/// even secrets would be three chances for one to forget.
///
/// Paths and names, never key material.
static KEYRING: std::sync::Mutex<Option<Keyring>> = std::sync::Mutex::new(None);

/// What signs, and for whom.
#[derive(Debug, Clone, Default)]
pub struct Keyring {
    /// name → path.
    pub keys: std::collections::HashMap<String, String>,
    /// The key that signs when no origin override applies.
    pub active: Option<String>,
    /// origin (`scheme://host`) → key name.
    pub by_origin: std::collections::HashMap<String, String>,
}

/// Mirror the settings into this module. Called at startup and on every change.
pub fn set_keyring(ring: Keyring) {
    if let Ok(mut g) = KEYRING.lock() {
        *g = Some(ring);
    }
    // A changed keyring invalidates every cached proof. They would still VERIFY — that is the
    // problem: a proof made with a key the owner has just removed would keep opening doors for
    // the rest of its two minutes.
    if let Ok(mut c) = PROOF_CACHE.lock() {
        *c = None;
    }
}

/// The path that should sign for this audience, if any.
///
/// An origin override wins over the active key. A name that no longer resolves to a key on the
/// ring returns None rather than silently falling back to the active one: the owner pointed
/// this origin at a specific identity, and quietly using a different one is worse than not
/// signing — the server would see the wrong person rather than nobody.
fn key_path_for(audience: &str) -> Option<String> {
    let g = KEYRING.lock().ok()?;
    let ring = g.as_ref()?;
    let name = ring.by_origin.get(audience).or(ring.active.as_ref())?;
    let path = ring.keys.get(name)?.trim().to_string();
    if path.is_empty() { None } else { Some(path) }
}

/// The proof header to attach to a request, if this BMM can make one.
///
/// Returns None — silently — when no key is configured or the key is not ed25519. A client
/// that cannot prove anything simply does not, and a server that does not ask never notices;
/// making this an error would break every ordinary unprotected repo.
pub fn header_for(url: &str) -> Option<(&'static str, String)> {
    let audience = audience_for(url)?;
    let key_path = key_path_for(&audience)?;

    let now = now_secs();
    if let Ok(mut guard) = PROOF_CACHE.lock() {
        let list = guard.get_or_insert_with(Vec::new);
        // Drop everything expired first, so the list cannot grow without bound on a client
        // that talks to many servers.
        list.retain(|(_, _, exp)| *exp > now);
        if let Some((_, proof, _)) = list.iter().find(|(a, _, _)| a == &audience) {
            return Some((HEADER, proof.clone()));
        }
        // Re-signed a little before expiry, so a proof never goes stale mid-request.
        let proof = make_proof(&key_path, None, &audience).ok()?;
        list.push((audience, proof.clone(), now + TTL_SECONDS.saturating_sub(15)));
        return Some((HEADER, proof));
    }
    None
}

/// Build the in-memory keyring from settings, migrating the single legacy value.
///
/// `key_auth_key_path` held one path before the ring existed. Folding it in as an entry named
/// "default" is what keeps an upgrade from silently un-configuring a key somebody set: the old
/// field is never written again, but it is still read, once, when the ring is empty.
pub fn keyring_from_settings(settings: &mut crate::state::AppSettings) -> Keyring {
    if settings.key_auth_keys.is_empty() {
        if let Some(p) = settings.key_auth_key_path.clone().filter(|p| !p.trim().is_empty()) {
            settings.key_auth_keys.push(crate::state::KeyAuthEntry {
                name: "default".to_string(),
                path: p,
            });
            if settings.key_auth_active.is_none() {
                settings.key_auth_active = Some("default".to_string());
            }
        }
    }
    // Did the owner have a choice recorded BEFORE we touched anything? The auto-pick below
    // must not fire when we are about to clear a stale one — a test caught exactly that:
    // "active = a key that was removed" plus one surviving key silently became "active = the
    // survivor", which is the app changing who you are on your behalf.
    let had_choice = settings.key_auth_active.is_some();

    // An active name that no longer exists is the same as none: the owner removed that key.
    let names: std::collections::HashSet<&str> =
        settings.key_auth_keys.iter().map(|e| e.name.as_str()).collect();
    if settings.key_auth_active.as_deref().map(|n| !names.contains(n)).unwrap_or(false) {
        settings.key_auth_active = None;
    }
    // With exactly one key and nothing EVER chosen, that key is the choice. Making somebody
    // pick from a list of one is a question with no information in it.
    if !had_choice && settings.key_auth_active.is_none() && settings.key_auth_keys.len() == 1 {
        settings.key_auth_active = Some(settings.key_auth_keys[0].name.clone());
    }
    Keyring {
        keys: settings.key_auth_keys.iter().map(|e| (e.name.clone(), e.path.clone())).collect(),
        active: settings.key_auth_active.clone(),
        by_origin: settings.key_auth_by_origin.clone(),
    }
}

/// Re-read settings into the module and save. Every command below ends here, so "what is on
/// disk" and "what signs" cannot drift apart.
fn commit(state: &tauri::State<'_, crate::state::AppState>) -> Result<(), String> {
    let ring = {
        let mut data = state.data.lock().map_err(|_| "state lock".to_string())?;
        keyring_from_settings(&mut data.settings)
    };
    state.save().map_err(|e| e.to_string())?;
    set_keyring(ring);
    Ok(())
}

/// What the screens show: the ring, what is active, and the per-origin choices.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyringView {
    pub keys: Vec<crate::state::KeyAuthEntry>,
    pub active: Option<String>,
    pub by_origin: std::collections::HashMap<String, String>,
}

#[tauri::command]
pub fn key_auth_list(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<KeyringView, String> {
    let data = state.data.lock().map_err(|_| "state lock".to_string())?;
    Ok(KeyringView {
        keys: data.settings.key_auth_keys.clone(),
        active: data.settings.key_auth_active.clone(),
        by_origin: data.settings.key_auth_by_origin.clone(),
    })
}

/// Add a key to the ring, or repoint an existing name at a new file.
///
/// Refused up front when the file is not a usable ed25519 key, so the mistake is reported
/// while the person is still looking at the picker rather than as a silent refusal from
/// somebody else's server a week later.
#[tauri::command]
pub fn key_auth_add(
    state: tauri::State<'_, crate::state::AppState>,
    name: String,
    path: String,
) -> Result<KeyringView, String> {
    let name = name.trim().to_string();
    let path = path.trim().to_string();
    if name.is_empty() {
        return Err("repo.keyauth.errNoName".into());
    }
    if path.is_empty() {
        return Err("repo.keyauth.errNoPath".into());
    }
    // Signing against a throwaway audience proves the file opens AND is ed25519.
    make_proof(&path, None, "probe://validate")?;
    {
        let mut data = state.data.lock().map_err(|_| "state lock".to_string())?;
        match data.settings.key_auth_keys.iter_mut().find(|e| e.name == name) {
            Some(e) => e.path = path,
            None => data.settings.key_auth_keys.push(crate::state::KeyAuthEntry { name: name.clone(), path }),
        }
        if data.settings.key_auth_active.is_none() {
            data.settings.key_auth_active = Some(name);
        }
    }
    commit(&state)?;
    key_auth_list(state)
}

/// Take a key off the ring.
///
/// Every origin pointed at it is cleared too. Leaving those behind would leave origins naming
/// a key that does not exist, which `key_path_for` reads as "sign nothing" — correct, and
/// impossible to understand from the screen.
#[tauri::command]
pub fn key_auth_remove(
    state: tauri::State<'_, crate::state::AppState>,
    name: String,
) -> Result<KeyringView, String> {
    {
        let mut data = state.data.lock().map_err(|_| "state lock".to_string())?;
        data.settings.key_auth_keys.retain(|e| e.name != name);
        data.settings.key_auth_by_origin.retain(|_, v| v != &name);
        if data.settings.key_auth_active.as_deref() == Some(name.as_str()) {
            data.settings.key_auth_active = None;
        }
    }
    commit(&state)?;
    key_auth_list(state)
}

/// Choose which key signs by default. `None` means "prove nothing unless an origin says so".
#[tauri::command]
pub fn key_auth_set_active(
    state: tauri::State<'_, crate::state::AppState>,
    name: Option<String>,
) -> Result<KeyringView, String> {
    {
        let mut data = state.data.lock().map_err(|_| "state lock".to_string())?;
        let name = name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
        if let Some(n) = name.as_deref() {
            if !data.settings.key_auth_keys.iter().any(|e| e.name == n) {
                return Err("repo.keyauth.errNoSuchKey".into());
            }
        }
        data.settings.key_auth_active = name;
    }
    commit(&state)?;
    key_auth_list(state)
}

/// Point one origin at one key, or clear it back to the active key.
///
/// `url` is any address on that server; the origin is derived here so a caller can pass the
/// catalogue address it already has rather than assembling `scheme://host` itself — which is
/// the kind of small duplication that ends up disagreeing with `audience_for`.
#[tauri::command]
pub fn key_auth_set_for_url(
    state: tauri::State<'_, crate::state::AppState>,
    url: String,
    name: Option<String>,
) -> Result<KeyringView, String> {
    let origin = audience_for(&url).ok_or_else(|| "repo.keyauth.errBadUrl".to_string())?;
    {
        let mut data = state.data.lock().map_err(|_| "state lock".to_string())?;
        let name = name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
        match name {
            Some(n) => {
                if !data.settings.key_auth_keys.iter().any(|e| e.name == n) {
                    return Err("repo.keyauth.errNoSuchKey".into());
                }
                data.settings.key_auth_by_origin.insert(origin, n);
            }
            None => { data.settings.key_auth_by_origin.remove(&origin); }
        }
    }
    commit(&state)?;
    key_auth_list(state)
}

/// The origin a URL's proof would be addressed to — so a screen can show WHICH server a
/// per-source choice applies to, in the same words the gate uses.
#[tauri::command]
pub fn key_auth_origin_of(url: String) -> Option<String> {
    audience_for(&url)
}

/// Point BMM at one key, keeping the pre-keyring call working.
///
/// It writes the entry named "default" and makes it active. Kept because it is a registered
/// command: the local API and the deeplinks can reach it, and breaking a published entry point
/// to tidy an internal model is a cost paid by somebody else's script.
#[tauri::command]
pub fn set_key_auth_key(
    state: tauri::State<'_, crate::state::AppState>,
    path: Option<String>,
) -> Result<(), String> {
    let path = path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
    match path {
        Some(p) => { key_auth_add(state, "default".to_string(), p)?; }
        None => { key_auth_remove(state, "default".to_string())?; }
    }
    Ok(())
}

/// Attach the key proof for `url` to a header map, when this BMM has a key to prove with.
///
/// The repo sync builds its own `HeaderMap`s inline in three places (manifest fetch, archive
/// download, chunked resume) rather than going through `net::catalog_get`. Adding the proof
/// at each site by hand would be the same rule written three more times, and a header that
/// exists on two of the three paths is worse than none: a sync would authenticate its
/// manifest and then 401 halfway through the files.
pub fn add_proof(headers: &mut reqwest::header::HeaderMap, url: &str) {
    if let Some((name, value)) = header_for(url) {
        if let Ok(hv) = reqwest::header::HeaderValue::from_str(&value) {
            headers.insert(name, hv);
        }
    }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Settings with nothing set, so each test says only what it is about.
    fn blank_settings() -> crate::state::AppSettings {
        let mut s = crate::state::AppSettings::default();
        s.key_auth_keys.clear();
        s.key_auth_active = None;
        s.key_auth_by_origin.clear();
        s.key_auth_key_path = None;
        s
    }

    #[test]
    fn the_pre_keyring_value_is_migrated_once() {
        let mut s = blank_settings();
        s.key_auth_key_path = Some("  /home/me/id_ed25519  ".to_string());
        let ring = keyring_from_settings(&mut s);
        assert_eq!(s.key_auth_keys.len(), 1, "the old single value becomes one entry");
        assert_eq!(s.key_auth_keys[0].name, "default");
        assert_eq!(s.key_auth_active.as_deref(), Some("default"), "and it is what signs");
        assert_eq!(ring.keys.get("default").map(String::as_str), Some("  /home/me/id_ed25519  "));

        // Run again: the ring is no longer empty, so the legacy field must be ignored rather
        // than re-added. Without this an upgrade would grow a duplicate on every launch.
        s.key_auth_keys[0].path = "/somewhere/else".to_string();
        keyring_from_settings(&mut s);
        assert_eq!(s.key_auth_keys.len(), 1, "not re-migrated");
        assert_eq!(s.key_auth_keys[0].path, "/somewhere/else", "and not overwritten");
    }

    #[test]
    fn an_empty_legacy_value_migrates_nothing() {
        let mut s = blank_settings();
        s.key_auth_key_path = Some("   ".to_string());
        keyring_from_settings(&mut s);
        assert!(s.key_auth_keys.is_empty(), "whitespace is not a key path");
        assert!(s.key_auth_active.is_none());
    }

    #[test]
    fn an_active_name_that_no_longer_exists_is_dropped() {
        let mut s = blank_settings();
        s.key_auth_keys.push(crate::state::KeyAuthEntry { name: "work".into(), path: "/w".into() });
        s.key_auth_active = Some("gone".to_string());
        keyring_from_settings(&mut s);
        // NOT silently repointed at "work": the owner chose a key that is no longer there, and
        // signing as somebody else is worse than not signing.
        assert_eq!(s.key_auth_active, None);
    }

    #[test]
    fn one_key_and_no_choice_means_that_key() {
        let mut s = blank_settings();
        s.key_auth_keys.push(crate::state::KeyAuthEntry { name: "only".into(), path: "/o".into() });
        keyring_from_settings(&mut s);
        assert_eq!(s.key_auth_active.as_deref(), Some("only"));
    }

    #[test]
    fn two_keys_and_no_choice_stays_no_choice() {
        let mut s = blank_settings();
        s.key_auth_keys.push(crate::state::KeyAuthEntry { name: "a".into(), path: "/a".into() });
        s.key_auth_keys.push(crate::state::KeyAuthEntry { name: "b".into(), path: "/b".into() });
        keyring_from_settings(&mut s);
        // Picking one for them would be picking an identity for them.
        assert_eq!(s.key_auth_active, None);
    }

    #[test]
    fn an_origin_override_wins_over_the_active_key() {
        set_keyring(Keyring {
            keys: [("work".to_string(), "/w".to_string()), ("home".to_string(), "/h".to_string())]
                .into_iter().collect(),
            active: Some("home".to_string()),
            by_origin: [("https://work.example".to_string(), "work".to_string())]
                .into_iter().collect(),
        });
        assert_eq!(key_path_for("https://work.example").as_deref(), Some("/w"));
        assert_eq!(key_path_for("https://other.example").as_deref(), Some("/h"));

        // An override naming a key that is gone signs NOTHING rather than falling back: the
        // owner said this server knows me as "work", and turning up as "home" is a different
        // person, not a graceful degradation.
        set_keyring(Keyring {
            keys: [("home".to_string(), "/h".to_string())].into_iter().collect(),
            active: Some("home".to_string()),
            by_origin: [("https://work.example".to_string(), "work".to_string())]
                .into_iter().collect(),
        });
        assert_eq!(key_path_for("https://work.example"), None);
        assert_eq!(key_path_for("https://other.example").as_deref(), Some("/h"));
        set_keyring(Keyring::default());
    }

    /// A keypair written to a temp file, the way a user's key would be.
    ///
    /// The seed is derived from `name` rather than random: a failing crypto test that cannot
    /// be reproduced is a test nobody can fix, and nothing here depends on the key being
    /// unpredictable.
    fn write_key(dir: &std::path::Path, name: &str) -> (String, String) {
        let mut seed = [0u8; 32];
        for (i, b) in name.bytes().enumerate() {
            seed[i % 32] ^= b.wrapping_add(i as u8).wrapping_add(1);
        }
        let sk = SigningKey::from_bytes(&seed);
        let ssh = russh::keys::PrivateKey::from(
            russh::keys::ssh_key::private::Ed25519Keypair {
                public: russh::keys::ssh_key::public::Ed25519PublicKey(sk.verifying_key().to_bytes()),
                private: russh::keys::ssh_key::private::Ed25519PrivateKey::from_bytes(&sk.to_bytes()),
            },
        );
        let path = dir.join(name);
        std::fs::write(&path, ssh.to_openssh(russh::keys::ssh_key::LineEnding::LF).unwrap().as_str()).unwrap();
        let pk = base64::engine::general_purpose::STANDARD.encode(sk.verifying_key().to_bytes());
        (path.to_string_lossy().to_string(), pk)
    }

    #[test]
    fn a_proof_verifies_against_its_own_key() {
        let d = tempfile::tempdir().unwrap();
        let (path, pk) = write_key(d.path(), "k");
        let proof = make_proof(&path, None, "repo:abc").unwrap();
        assert_eq!(verify_proof(&proof, &[pk], "repo:abc").unwrap_or_default().is_empty(), false);
    }

    #[test]
    fn a_proof_for_another_audience_is_refused() {
        let d = tempfile::tempdir().unwrap();
        let (path, pk) = write_key(d.path(), "k");
        // The signature is perfectly valid — which is the whole point of checking `aud`.
        let proof = make_proof(&path, None, "repo:mine").unwrap();
        assert_eq!(verify_proof(&proof, &[pk], "repo:yours"), Err("repo.keyauth.errAudience".into()));
    }

    #[test]
    fn an_unauthorised_key_is_refused() {
        let d = tempfile::tempdir().unwrap();
        let (path, _pk) = write_key(d.path(), "k");
        let (_p2, other) = write_key(d.path(), "k2");
        let proof = make_proof(&path, None, "repo:abc").unwrap();
        assert_eq!(verify_proof(&proof, &[other], "repo:abc"), Err("repo.keyauth.errNotAuthorised".into()));
    }

    #[test]
    fn a_tampered_payload_is_refused() {
        let d = tempfile::tempdir().unwrap();
        let (path, pk) = write_key(d.path(), "k");
        let proof = make_proof(&path, None, "repo:abc").unwrap();
        // Re-encode the payload with a LATER expiry and keep the original signature — the
        // attack the "sign the transmitted segment" rule exists to stop.
        let seg = proof.split('.').nth(1).unwrap();
        let mut p: Payload = serde_json::from_slice(&b64u().decode(seg).unwrap()).unwrap();
        p.exp += 86_400;
        let forged = format!(
            "{}.{}.{}",
            PREFIX,
            b64u().encode(serde_json::to_vec(&p).unwrap()),
            proof.split('.').nth(2).unwrap()
        );
        assert_eq!(verify_proof(&forged, &[pk], "repo:abc"), Err("repo.keyauth.errSignature".into()));
    }

    #[test]
    fn a_malformed_proof_is_refused_rather_than_panicking() {
        for bad in ["", "bmmk1", "bmmk1.x", "nope.a.b", "bmmk1.a.b.c", "bmmk1.!!!.???"] {
            assert!(verify_proof(bad, &["x".into()], "a").is_err(), "accepted: {bad}");
        }
    }

    #[test]
    fn an_openssh_public_key_converts_to_what_a_server_stores() {
        let d = tempfile::tempdir().unwrap();
        let (path, pk) = write_key(d.path(), "k");
        let text = std::fs::read_to_string(&path).unwrap();
        let key = russh::keys::decode_secret_key(&text, None).unwrap();
        let line = key.public_key().to_openssh().unwrap();
        assert_eq!(pubkey_from_openssh(&line).unwrap(), pk);
    }

    #[test]
    fn the_audience_is_the_origin_and_only_the_origin() {
        // A repo is many files; scoping the proof to the path would need one per file. Scoping
        // to the server is enough, because WHICH repo a key may read is decided by that repo's
        // own authorised list.
        assert_eq!(audience_for("http://192.168.1.9:8080/repo.json").as_deref(), Some("http://192.168.1.9:8080"));
        assert_eq!(audience_for("http://192.168.1.9:8080/mods/a/b.pak").as_deref(), Some("http://192.168.1.9:8080"));
        assert_eq!(audience_for("https://example.test/x/y?z=1").as_deref(), Some("https://example.test"));
        // A different PORT is a different audience: two servers on one host must not share a
        // proof.
        assert_ne!(audience_for("http://h:1/a"), audience_for("http://h:2/a"));
    }

    #[test]
    fn a_url_with_no_host_yields_no_audience() {
        for bad in ["", "notaurl", "http://", "://x"] {
            assert!(audience_for(bad).is_none(), "accepted: {bad}");
        }
    }

    #[test]
    fn a_non_ed25519_public_key_is_named_as_such() {
        // The message has to say WHICH problem it is: an RSA key is a perfectly good key that
        // this particular feature cannot use, not a corrupt one.
        let e = pubkey_from_openssh("ssh-rsa AAAAB3NzaC1yc2E= me@host").unwrap_err();
        assert_eq!(e, "repo.keyauth.errNotEd25519");
    }
}
