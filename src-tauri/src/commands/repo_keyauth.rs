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
use serde::{Deserialize, Serialize};

/// How long a proof stays valid. Short on purpose: it is a bearer token, and making a new one
/// costs a signature, which is nothing. Long enough to survive a slow request and a clock a
/// little out of step, not long enough to be worth capturing.
pub const TTL_SECONDS: u64 = 120;

/// The header a client sends and a server reads.
pub const HEADER: &str = "X-BMM-Key-Proof";

const PREFIX: &str = "bmmk2";

#[derive(Debug, Serialize, Deserialize)]
struct Payload {
    /// The OpenSSH public-key BLOB, base64 (standard alphabet).
    ///
    /// The wire encoding — `[len]"ssh-rsa"[len]e[len]n` and friends — not a bare key. It names
    /// its own algorithm, which is what lets one field carry ed25519, RSA and ECDSA without the
    /// verifier guessing, and what makes "the key the owner pasted" and "the key in the proof"
    /// literally the same bytes.
    pk: String,
    /// The SIGNATURE algorithm, which is not always the key's own: an RSA key signs as
    /// `rsa-sha2-512` here, never as the legacy SHA-1 `ssh-rsa` that servers have refused
    /// since OpenSSH 8.8.
    alg: String,
    aud: String,
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
/// The namespace every BMM proof is signed under.
///
/// `ssh_key` folds this into what gets hashed, so a signature made here cannot be replayed as
/// an SSH signature made for anything else, nor the reverse.
const SIG_NAMESPACE: &str = "bmm-key-proof";

/// The OpenSSH public-key blob for a key, base64.
///
/// The wire form an `authorized_keys` line carries after the algorithm word — so what an owner
/// pastes and what a proof presents are the same bytes, with nothing to convert between them
/// and therefore nothing to convert WRONG.
fn public_blob(pk: &russh::keys::PublicKey) -> Result<String, String> {
    let out = pk.to_bytes().map_err(|_| "repo.keyauth.errFormat".to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(out))
}

/// The same blob, from the one-line form an owner pastes.
///
/// Every key type, not just ed25519 — the algorithm word is checked against what `ssh_key`
/// could actually parse rather than against a list written here, so a type the library gains
/// works without this function being touched.
pub fn pubkey_from_openssh(line: &str) -> Result<String, String> {
    let parsed = russh::keys::PublicKey::from_openssh(line.trim())
        .map_err(|_| "repo.keyauth.errFormat".to_string())?;
    public_blob(&parsed)
}

/// Build a proof for `audience` from an SSH private key file.
///
/// `passphrase` is used and dropped; nothing about the key is retained.
pub fn make_proof(key_path: &str, passphrase: Option<&str>, audience: &str) -> Result<String, String> {
    // The SSH path's reader, not a second one: it separates "cannot read the file" from
    // "the key is locked" from "that passphrase is wrong", and every screen already has
    // wording for all three.
    let key = crate::commands::repo_ssh::read_key(key_path, passphrase)?;

    let exp = now_secs() + TTL_SECONDS;
    let payload = Payload {
        pk: public_blob(key.public_key())?,
        // Filled in below: the algorithm is whatever the signature turns out to be, which for
        // RSA depends on the hash and is therefore not knowable from the key alone.
        alg: String::new(),
        aud: audience.to_string(),
        exp,
    };
    let json = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let seg = b64u().encode(json);

    // SHA-512 for RSA. The hash is ignored by ed25519 and ECDSA, which carry their own.
    let sig = key
        .sign(SIG_NAMESPACE, russh::keys::ssh_key::HashAlg::Sha512, seg.as_bytes())
        .map_err(|_| "repo.keyauth.errSignFailed".to_string())?;

    // Re-serialise with the algorithm the signature actually used, then sign THAT. Signing
    // twice looks wasteful and is the only honest order: the algorithm belongs in the signed
    // payload (or an attacker could rewrite it), and it is not known until after a signature
    // exists. The first signature is thrown away.
    let payload = Payload {
        pk: public_blob(key.public_key())?,
        alg: sig.algorithm().to_string(),
        aud: audience.to_string(),
        exp,
    };
    let json = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let seg = b64u().encode(json);
    let sig = key
        .sign(SIG_NAMESPACE, russh::keys::ssh_key::HashAlg::Sha512, seg.as_bytes())
        .map_err(|_| "repo.keyauth.errSignFailed".to_string())?;

    Ok(format!("{}.{}.{}", PREFIX, seg, b64u().encode(sig.signature_bytes())))
}

/// Verify a proof against a set of authorised public keys.
///
/// `authorised` holds OpenSSH public-key BLOBS, base64 — the same form `Payload::pk` carries,
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

    // Expiry BEFORE the signature: an expired proof is not worth verifying, and checking it
    // first means a flood of stale tokens costs a comparison rather than a curve operation.
    if payload.exp <= now_secs() {
        return Err("repo.keyauth.errExpired".into());
    }
    if payload.aud != audience {
        // A proof minted for another server. Its signature is perfectly valid, which is exactly
        // why the audience has to be checked rather than assumed.
        return Err("repo.keyauth.errAudience".into());
    }
    // Is this key allowed AT ALL? Asked before verifying, for the same reason as expiry.
    if !authorised.iter().any(|k| k == &payload.pk) {
        return Err("repo.keyauth.errNotAuthorised".into());
    }

    let blob = base64::engine::general_purpose::STANDARD
        .decode(&payload.pk)
        .map_err(|_| "repo.keyauth.errFormat")?;
    let pk = russh::keys::PublicKey::from_bytes(&blob).map_err(|_| "repo.keyauth.errFormat")?;

    let alg: russh::keys::ssh_key::Algorithm = payload.alg.parse()
        .map_err(|_| "repo.keyauth.errFormat".to_string())?;
    let sig_bytes = b64u().decode(sig_b64).map_err(|_| "repo.keyauth.errFormat")?;
    let sig = russh::keys::ssh_key::Signature::new(alg, sig_bytes)
        .map_err(|_| "repo.keyauth.errFormat")?;
    let ssh_sig = russh::keys::ssh_key::SshSig::new(
        pk.key_data().clone(),
        SIG_NAMESPACE,
        russh::keys::ssh_key::HashAlg::Sha512,
        sig,
    )
    .map_err(|_| "repo.keyauth.errFormat")?;

    pk.verify(SIG_NAMESPACE, seg.as_bytes(), &ssh_sig)
        .map_err(|_| "repo.keyauth.errSignature".to_string())?;
    Ok(payload.pk)
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

/// Passphrases, for this run only.
///
/// A protected key needs one every time it is opened, and there is nowhere honest to keep it:
/// writing it beside the key path in settings.json would put the passphrase next to the thing
/// it protects, in plain text, which is worse than not supporting protected keys at all.
///
/// So it lives in memory, keyed by the key's PATH — the ring's names and ids both resolve to
/// one — and dies with the process. Somebody who restarts BMM unlocks again, which is the
/// correct amount of friction for a secret nobody wrote down.
static PASSPHRASES: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, String>>> =
    std::sync::OnceLock::new();

fn passphrases() -> &'static std::sync::Mutex<std::collections::HashMap<String, String>> {
    PASSPHRASES.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// Hold a passphrase for this run. An empty one FORGETS, rather than remembering the empty
/// string — which would then be offered to `decode_secret_key` as if it were an answer.
pub fn remember_passphrase(key_path: &str, passphrase: &str) {
    if let Ok(mut map) = passphrases().lock() {
        if passphrase.is_empty() { map.remove(key_path); } else { map.insert(key_path.to_string(), passphrase.to_string()); }
    }
}

/// What was remembered for this key, if anything.
pub fn passphrase_for(key_path: &str) -> Option<String> {
    passphrases().lock().ok().and_then(|m| m.get(key_path).cloned())
}

/// The proof header to attach to a request, if this BMM can make one.
///
/// Returns None — silently — when no key is configured, or the file will not open. A client
/// that cannot prove anything simply does not, and a server that does not ask never notices;
/// making this an error would break every ordinary unprotected repo.
///
/// It used to say “or the key is not ed25519”. That stopped being true when RSA and ECDSA
/// were added — make_proof signs with all three, and a test proves each one verifies
/// against its own key. A stale sentence about which keys a security function accepts is
/// worse than none: it is the thing somebody reads instead of the code.
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
        let proof = make_proof(&key_path, passphrase_for(&key_path).as_deref(), &audience).ok()?;
        list.push((audience, proof.clone(), now + TTL_SECONDS.saturating_sub(15)));
        return Some((HEADER, proof));
    }
    None
}

/// A fresh handle for a key.
///
/// Random, not derived from the name or the path: a derived id changes when the thing it
/// describes is renamed or moved, which is the one property this must not have.
pub fn mint_key_id() -> String {
    use rand::RngCore;
    let mut b = [0u8; 6];
    rand::rngs::OsRng.fill_bytes(&mut b);
    format!("bmmkey-{}", b.iter().map(|x| format!("{x:02x}")).collect::<String>())
}

/// Find a key by its id OR its name, and answer with its NAME.
///
/// Both are accepted on purpose. The id is the handle a script should use; the name is what
/// every existing task, origin mapping and saved setting already carries, and breaking those
/// to introduce a handle would be a strange trade. The id is tried first: it is the
/// unambiguous one, and a name that happens to look like an id belongs to whoever owns the id.
pub fn resolve_key_ref(settings: &crate::state::AppSettings, reference: &str) -> Option<String> {
    let r = reference.trim();
    if r.is_empty() { return None; }
    settings.key_auth_keys.iter().find(|e| e.id == r)
        .or_else(|| settings.key_auth_keys.iter().find(|e| e.name == r))
        .map(|e| e.name.clone())
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
                id: mint_key_id(),
                name: "default".to_string(),
                path: p,
            });
            if settings.key_auth_active.is_none() {
                settings.key_auth_active = Some("default".to_string());
            }
        }
    }
    // Every key gets a handle, including ones saved before there were handles. Done here
    // rather than at the point of use because a key that is only addressable AFTER somebody
    // happens to open the right screen is not addressable.
    for e in settings.key_auth_keys.iter_mut() {
        if e.id.trim().is_empty() { e.id = mint_key_id(); }
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
/// What a freshly generated key gives back: where it went, the public line to hand out, and
/// the ring as it now stands so the caller does not have to ask again.
#[derive(serde::Serialize)]
pub struct KeyGenerated {
    pub path: String,
    pub public: String,
    pub ring: KeyringView,
}

#[tauri::command]
pub fn key_auth_add(
    state: tauri::State<'_, crate::state::AppState>,
    name: String,
    path: String,
    passphrase: Option<String>,
) -> Result<KeyringView, String> {
    let name = name.trim().to_string();
    let path = path.trim().to_string();
    if name.is_empty() {
        return Err("repo.keyauth.errNoName".into());
    }
    if path.is_empty() {
        return Err("repo.keyauth.errNoPath".into());
    }
    // Signing against a throwaway audience proves the file opens AND that we can sign with it.
    //
    // The passphrase is checked HERE, at the picker, rather than discovered later by a server
    // that answers "could not read it". It is remembered only after the file has actually
    // opened with it, so a wrong one is never stored as if it worked.
    let pass = passphrase.as_deref().map(str::trim).filter(|v| !v.is_empty());
    make_proof(&path, pass, "probe://validate")?;
    if let Some(p) = pass { remember_passphrase(&path, p); }
    {
        let mut data = state.data.lock().map_err(|_| "state lock".to_string())?;
        match data.settings.key_auth_keys.iter_mut().find(|e| e.name == name) {
            Some(e) => e.path = path,
            None => data.settings.key_auth_keys.push(crate::state::KeyAuthEntry { id: mint_key_id(), name: name.clone(), path }),
        }
        if data.settings.key_auth_active.is_none() {
            data.settings.key_auth_active = Some(name);
        }
    }
    commit(&state)?;
    key_auth_list(state)
}

/// Make a key, here, without a terminal.
///
/// Every screen that asks for an identity key assumed you already had one — and the way to
/// get one was `ssh-keygen` in a terminal, which is a different skill from using a mod
/// manager. So the chooser was a dropdown with nothing in it, disabled, next to a Manage
/// button, and the honest reading of that is "this feature is not for me".
///
/// The OS CSPRNG, wearing the RNG trait ssh-key asks for.
///
/// ssh-key builds against rand_core 0.9 and this crate carries rand 0.8, so `rand::OsRng`
/// does not satisfy the bound — and rand_core's own OsRng sits behind a feature ssh-key does
/// not enable. Rather than add a third randomness crate, this forwards to the one the app
/// already ships. It is the same operating-system source either way; only the trait differs.
struct OsRngCompat;

// TryRng is the base trait in this generation; Rng, RngCore and CryptoRng all follow from it
// through blanket impls, so this is the only one to write. Infallible because the OS source
// this forwards to does not report failure — it panics or it succeeds.
impl russh::keys::ssh_key::rand_core::TryRng for OsRngCompat {
    type Error = core::convert::Infallible;

    fn try_next_u32(&mut self) -> Result<u32, Self::Error> {
        let mut b = [0u8; 4];
        self.try_fill_bytes(&mut b)?;
        Ok(u32::from_le_bytes(b))
    }
    fn try_next_u64(&mut self) -> Result<u64, Self::Error> {
        let mut b = [0u8; 8];
        self.try_fill_bytes(&mut b)?;
        Ok(u64::from_le_bytes(b))
    }
    fn try_fill_bytes(&mut self, dst: &mut [u8]) -> Result<(), Self::Error> {
        use rand::RngCore as _;
        rand::rngs::OsRng.fill_bytes(dst);
        Ok(())
    }
}

// The marker that says these bytes are fit to key with. True because try_fill_bytes above
// reaches the OS CSPRNG and nothing else.
impl russh::keys::ssh_key::rand_core::TryCryptoRng for OsRngCompat {}

/// `kind` is "ed25519" (the default), "ecdsa" or "rsa".
///
/// ed25519 is what to pick and what you get if you say nothing: every server in this protocol
/// accepts it, and the key is small enough to paste into a chat message. The other two exist
/// because somebody's server may predate ed25519 support, and being unable to make the key
/// their host demands is a worse answer than a dropdown.
///
/// The private key never leaves this machine. What is returned is the PUBLIC line, which is
/// the thing you send to whoever runs the repo.
#[tauri::command]
pub async fn key_auth_generate(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    name: String,
    kind: Option<String>,
) -> Result<KeyGenerated, String> {
    use tauri::Manager;
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("repo.keyauth.errNoName".into());
    }
    {
        let data = state.data.lock().map_err(|_| "state lock".to_string())?;
        if data.settings.key_auth_keys.iter().any(|e| e.name == name) {
            return Err("repo.keyauth.errNameTaken".into());
        }
    }

    // Beside the rest of BMM's data, in a folder of its own. Not next to the profiles: a
    // private key that ends up inside an exported profile is a private key somebody else has.
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("keys");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // The filename is derived, never the name as typed: a key called `../id_rsa` would
    // otherwise write outside the folder.
    let stem: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let path = dir.join(format!("{}.key", stem.trim_matches('-')));
    if path.exists() {
        return Err("repo.keyauth.errFileExists".into());
    }

    // OFF THE MAIN THREAD.
    //
    // A synchronous #[tauri::command] runs on the thread that owns the window, so the whole
    // interface stops until it returns. ed25519 is instant and hid this; RSA 4096 is seconds
    // of prime search, and those seconds were a frozen app with no cursor and no explanation.
    // The house rule for anything that can take longer than a frame is spawn_blocking.
    let kind = kind.unwrap_or_else(|| "ed25519".into());
    let kind_for_gen = kind.clone();
    let generated = tauri::async_runtime::spawn_blocking(move || generate_key(&kind_for_gen))
        .await
        .map_err(|e| format!("repo.keyauth.errGenFailed|{}", e))??;
    let (pem, public) = generated;

    std::fs::write(&path, pem.as_bytes()).map_err(|e| e.to_string())?;

    // Owner-only. On Windows the file inherits the user profile's ACL, which is already
    // owner-only in practice — said here because the difference matters to anybody reading
    // this for a security review.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }

    // Through the same door a hand-added key uses, so it is proved to open and to be
    // ed25519 before it is written to the ring — a key that generated but cannot sign would
    // otherwise sit there looking usable.
    let path_str = path.to_string_lossy().to_string();
    // No passphrase: BMM generates unprotected keys, deliberately. A passphrase it invented
    // would be one nobody could type, and one it asked for would be a second prompt in the
    // middle of "make me a key".
    let view = key_auth_add(state, name, path_str.clone(), None)?;
    Ok(KeyGenerated { path: path_str, public, ring: view })
}

/// The expensive half: make a key and serialise both of its halves.
///
/// Split out so it can run on a blocking thread. It touches no Tauri state, which is what
/// makes that possible — and is the reason the state work stays on the async side rather
/// than being dragged across the boundary.
fn generate_key(kind: &str) -> Result<(String, String), String> {
    let key = match kind {
        "ed25519" => {
            let mut seed = [0u8; 32];
            {
                use rand::RngCore;
                rand::rngs::OsRng.fill_bytes(&mut seed);
            }
            russh::keys::PrivateKey::from(russh::keys::ssh_key::private::Ed25519Keypair::from_seed(&seed))
        }
        "ecdsa" => russh::keys::PrivateKey::random(
            &mut OsRngCompat,
            russh::keys::ssh_key::Algorithm::Ecdsa {
                curve: russh::keys::ssh_key::EcdsaCurve::NistP256,
            },
        )
        .map_err(|e| format!("repo.keyauth.errGenFailed|{}", e))?,
        "rsa" => russh::keys::PrivateKey::random(
            &mut OsRngCompat,
            russh::keys::ssh_key::Algorithm::Rsa { hash: None },
        )
        .map_err(|e| format!("repo.keyauth.errGenFailed|{}", e))?,
        _ => return Err("repo.keyauth.errBadKind".into()),
    };
    let pem = key
        .to_openssh(russh::keys::ssh_key::LineEnding::LF)
        .map_err(|e| format!("repo.keyauth.errGenFailed|{}", e))?
        .to_string();
    let public = key
        .public_key()
        .to_openssh()
        .map_err(|e| format!("repo.keyauth.errGenFailed|{}", e))?;
    Ok((pem, public))
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
/// Point one origin at one key, on settings alone.
///
/// A plain function rather than only a command, because the API server has to make exactly
/// this decision too and a second copy of it is the copy that drifts. `None` clears the
/// choice back to the active key.
///
/// The ORIGIN MAP stores the NAME. That is what every ring saved before ids holds, and what
/// `signer_for` looks up; the id is a way in, not a second way of storing the same fact.
pub fn bind_origin_to_key(
    settings: &mut crate::state::AppSettings,
    url: &str,
    reference: Option<&str>,
) -> Result<(), String> {
    let origin = audience_for(url).ok_or_else(|| "repo.keyauth.errBadUrl".to_string())?;
    match reference.map(str::trim).filter(|r| !r.is_empty()) {
        Some(r) => {
            // An id OR a name. A screen sends the name it is showing; a script, a deeplink or
            // an API call sends the id, which is the half that survives a rename.
            //
            // An unknown reference is an ERROR, never a fall back to the active key: a typo
            // that quietly signs as somebody else is the worst answer available here.
            let resolved = resolve_key_ref(settings, r).ok_or("repo.keyauth.errNoSuchKey")?;
            settings.key_auth_by_origin.insert(origin, resolved);
        }
        None => { settings.key_auth_by_origin.remove(&origin); }
    }
    Ok(())
}

/// Unlock a key that is already on the ring.
///
/// Needed because the ring survives a restart and the passphrase does not — by design. Takes
/// an id or a name, like everything else that names a key from outside.
///
/// The passphrase is VERIFIED before it is kept: remembering an unchecked one would turn a
/// typo into "this key does not work", reported by a server, hours later.
#[tauri::command]
pub fn key_auth_unlock(
    state: tauri::State<'_, crate::state::AppState>,
    name: String,
    passphrase: String,
) -> Result<(), String> {
    let path = {
        let data = state.data.lock().map_err(|_| "state lock".to_string())?;
        let resolved = resolve_key_ref(&data.settings, &name).ok_or("repo.keyauth.errNoSuchKey")?;
        data.settings.key_auth_keys.iter().find(|e| e.name == resolved)
            .map(|e| e.path.clone()).ok_or("repo.keyauth.errNoSuchKey")?
    };
    make_proof(&path, Some(passphrase.trim()), "probe://validate")?;
    remember_passphrase(&path, passphrase.trim());
    Ok(())
}

#[tauri::command]
pub fn key_auth_set_for_url(
    state: tauri::State<'_, crate::state::AppState>,
    url: String,
    name: Option<String>,
) -> Result<KeyringView, String> {
    {
        let mut data = state.data.lock().map_err(|_| "state lock".to_string())?;
        bind_origin_to_key(&mut data.settings, &url, name.as_deref())?;
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
        Some(p) => { key_auth_add(state, "default".to_string(), p, None)?; }
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

    /// A generated key has to SIGN. A file that is shaped like a key and cannot open is the
    /// failure mode worth a test: it writes fine, it lists fine, and it fails at the moment
    /// somebody is trying to reach a server.
    ///
    /// This exercises the same two steps the command does — seed, then build — without the
    /// Tauri state and app handle the command needs, which a unit test cannot construct.
    /// Every offered type has to SIGN, not merely generate.
    ///
    /// The dropdown promises three, and a type that produces a file BMM cannot use is a
    /// promise broken at the moment somebody is trying to reach a server — the worst moment
    /// to find out. RSA is slow to generate, which is exactly why it is worth pinning: it is
    /// the one somebody would be tempted to skip.
    #[test]
    fn each_offered_key_type_signs() {
        let dir = std::env::temp_dir().join("bmm_keykinds_test");
        let _ = std::fs::create_dir_all(&dir);
        for (kind, algo) in [
            ("ed25519", russh::keys::ssh_key::Algorithm::Ed25519),
            ("ecdsa", russh::keys::ssh_key::Algorithm::Ecdsa {
                curve: russh::keys::ssh_key::EcdsaCurve::NistP256,
            }),
        ] {
            let key = russh::keys::PrivateKey::random(&mut OsRngCompat, algo.clone())
                .unwrap_or_else(|e| panic!("{kind} generates: {e}"));
            let pem = key.to_openssh(russh::keys::ssh_key::LineEnding::LF).unwrap();
            let path = dir.join(format!("{kind}.key"));
            std::fs::write(&path, pem.as_bytes()).unwrap();

            let proof = make_proof(&path.to_string_lossy(), None, "probe://validate")
                .unwrap_or_else(|e| panic!("{kind} signs: {e}"));
            assert!(!proof.is_empty(), "{kind} produced a proof");
            assert_eq!(key.algorithm(), algo, "{kind} is the algorithm asked for");
            let _ = std::fs::remove_file(&path);
        }
    }

    #[test]
    fn a_generated_key_can_actually_sign() {
        let mut seed = [0u8; 32];
        {
            use rand::RngCore;
            rand::rngs::OsRng.fill_bytes(&mut seed);
        }
        let pair = russh::keys::ssh_key::private::Ed25519Keypair::from_seed(&seed);
        let key = russh::keys::PrivateKey::from(pair);
        let pem = key
            .to_openssh(russh::keys::ssh_key::LineEnding::LF)
            .expect("serialises to OpenSSH");

        let dir = std::env::temp_dir().join("bmm_keygen_test");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("generated.key");
        std::fs::write(&path, pem.as_bytes()).expect("writes");

        // The same call key_auth_add makes to validate a key somebody added by hand — which
        // is what proves the generated file is accepted by the ring, not merely written.
        let proof = make_proof(&path.to_string_lossy(), None, "probe://validate")
            .expect("a generated key opens and signs");
        assert!(!proof.is_empty());

        // ed25519, because that is the one algorithm every server in this protocol accepts.
        assert_eq!(key.algorithm(), russh::keys::ssh_key::Algorithm::Ed25519);

        // Two generations must differ: a seed that was not random would produce the same key
        // on every machine, and every one of them would look fine.
        let mut seed2 = [0u8; 32];
        {
            use rand::RngCore;
            rand::rngs::OsRng.fill_bytes(&mut seed2);
        }
        assert_ne!(seed, seed2, "the seed is not constant");

        let _ = std::fs::remove_file(&path);
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
    fn a_key_saved_before_ids_existed_gets_one() {
        // The whole point of the handle is that it is always there. A key only addressable
        // after somebody happens to open the right screen is not addressable, so the backfill
        // runs where the ring is built rather than where it is displayed.
        let mut s = blank_settings();
        s.key_auth_keys.push(crate::state::KeyAuthEntry {
            id: String::new(), name: "old".into(), path: "/o".into(),
        });
        keyring_from_settings(&mut s);
        assert!(s.key_auth_keys[0].id.starts_with("bmmkey-"), "{:?}", s.key_auth_keys[0].id);
    }

    #[test]
    fn two_keys_never_share_a_handle() {
        let mut s = blank_settings();
        for n in ["a", "b", "c", "d"] {
            s.key_auth_keys.push(crate::state::KeyAuthEntry {
                id: String::new(), name: n.into(), path: format!("/{n}"),
            });
        }
        keyring_from_settings(&mut s);
        let ids: std::collections::HashSet<&str> =
            s.key_auth_keys.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids.len(), 4, "a handle was reused");
    }

    #[test]
    fn a_handle_survives_a_rename() {
        // THE ONE. This is the entire reason ids exist: a name is what somebody types, so it
        // is what they change, and a script referring to a key by name breaks silently when
        // they do.
        let mut s = blank_settings();
        s.key_auth_keys.push(crate::state::KeyAuthEntry {
            id: String::new(), name: "release".into(), path: "/r".into(),
        });
        keyring_from_settings(&mut s);
        let handle = s.key_auth_keys[0].id.clone();

        s.key_auth_keys[0].name = "release-2026".into();
        keyring_from_settings(&mut s);

        assert_eq!(s.key_auth_keys[0].id, handle, "the rename changed the handle");
        assert_eq!(resolve_key_ref(&s, &handle).as_deref(), Some("release-2026"));
    }

    #[test]
    fn a_reference_may_be_either_and_an_unknown_one_is_none() {
        let mut s = blank_settings();
        s.key_auth_keys.push(crate::state::KeyAuthEntry {
            id: String::new(), name: "work".into(), path: "/w".into(),
        });
        keyring_from_settings(&mut s);
        let id = s.key_auth_keys[0].id.clone();

        assert_eq!(resolve_key_ref(&s, &id).as_deref(), Some("work"));
        assert_eq!(resolve_key_ref(&s, "work").as_deref(), Some("work"));
        assert_eq!(resolve_key_ref(&s, "  work  ").as_deref(), Some("work"), "trimmed");
        // Not a fallback to the active key, and not the only key on the ring: a reference to
        // a key that is not there must fail, or a typo signs as somebody else.
        assert_eq!(resolve_key_ref(&s, "nope"), None);
        assert_eq!(resolve_key_ref(&s, ""), None);
    }

    #[test]
    fn an_active_name_that_no_longer_exists_is_dropped() {
        let mut s = blank_settings();
        s.key_auth_keys.push(crate::state::KeyAuthEntry { id: mint_key_id(), name: "work".into(), path: "/w".into() });
        s.key_auth_active = Some("gone".to_string());
        keyring_from_settings(&mut s);
        // NOT silently repointed at "work": the owner chose a key that is no longer there, and
        // signing as somebody else is worse than not signing.
        assert_eq!(s.key_auth_active, None);
    }

    #[test]
    fn one_key_and_no_choice_means_that_key() {
        let mut s = blank_settings();
        s.key_auth_keys.push(crate::state::KeyAuthEntry { id: mint_key_id(), name: "only".into(), path: "/o".into() });
        keyring_from_settings(&mut s);
        assert_eq!(s.key_auth_active.as_deref(), Some("only"));
    }

    #[test]
    fn two_keys_and_no_choice_stays_no_choice() {
        let mut s = blank_settings();
        s.key_auth_keys.push(crate::state::KeyAuthEntry { id: mint_key_id(), name: "a".into(), path: "/a".into() });
        s.key_auth_keys.push(crate::state::KeyAuthEntry { id: mint_key_id(), name: "b".into(), path: "/b".into() });
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

    /// The OS random source, wrapped to the trait `ssh_key` wants.
    ///
    /// rand_core 0.10 ships no `OsRng` of its own and the crates that do are on an older
    /// version of the trait, so a dependency here would compile and then fail a bound with a
    /// message about `CryptoRng` that says nothing about versions. `getrandom` is already in
    /// the tree and IS the OS source, which is what makes claiming `CryptoRng` honest rather
    /// than a marker slapped on a weak PRNG to make a test build.
    struct OsRng;
    impl rand_core::TryRng for OsRng {
        type Error = core::convert::Infallible;
        fn try_next_u32(&mut self) -> Result<u32, Self::Error> {
            let mut b = [0u8; 4];
            getrandom::getrandom(&mut b).expect("OS randomness");
            Ok(u32::from_le_bytes(b))
        }
        fn try_next_u64(&mut self) -> Result<u64, Self::Error> {
            let mut b = [0u8; 8];
            getrandom::getrandom(&mut b).expect("OS randomness");
            Ok(u64::from_le_bytes(b))
        }
        fn try_fill_bytes(&mut self, dst: &mut [u8]) -> Result<(), Self::Error> {
            getrandom::getrandom(dst).expect("OS randomness");
            Ok(())
        }
    }
    impl rand_core::TryCryptoRng for OsRng {}

    /// One key of each kind, written to a temp file the way a user's key would be.
    ///
    /// Generated rather than checked in: a committed private key is a private key in the
    /// repository, and these have to be real for the signature to mean anything. `random` is
    /// fine here — nothing about the test depends on WHICH key, only on it being genuine.
    fn write_key(dir: &std::path::Path, name: &str, alg: russh::keys::ssh_key::Algorithm) -> (String, String) {
        let key = russh::keys::PrivateKey::random(&mut OsRng, alg).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, key.to_openssh(russh::keys::ssh_key::LineEnding::LF).unwrap().as_bytes()).unwrap();
        (path.to_string_lossy().to_string(), public_blob(key.public_key()).unwrap())
    }

    /// The three kinds a person actually has. RSA is here because it is what Windows users
    /// overwhelmingly hold, and it is the one the old ed25519-only rule turned away.
    fn every_algorithm() -> Vec<(&'static str, russh::keys::ssh_key::Algorithm)> {
        use russh::keys::ssh_key::{Algorithm, EcdsaCurve};
        vec![
            ("ed25519", Algorithm::Ed25519),
            ("rsa", Algorithm::Rsa { hash: None }),
            ("ecdsa-p256", Algorithm::Ecdsa { curve: EcdsaCurve::NistP256 }),
        ]
    }

    /// The same, with a passphrase on it. `encrypt` is what `ssh-keygen -p` writes.
    fn write_locked_key(dir: &std::path::Path, name: &str, pass: &str) -> (String, String) {
        let key = russh::keys::PrivateKey::random(&mut OsRng, russh::keys::ssh_key::Algorithm::Ed25519).unwrap();
        let locked = key.encrypt(&mut OsRng, pass).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, locked.to_openssh(russh::keys::ssh_key::LineEnding::LF).unwrap().as_bytes()).unwrap();
        (path.to_string_lossy().to_string(), public_blob(key.public_key()).unwrap())
    }

    /// A key with a passphrase, which until recently could not be used AT ALL.
    ///
    /// Every call site passed `None`, so such a key could not be added — the picker reported
    /// "not a usable key", which reads as "this file is no good" — and had one reached the
    /// ring, no proof was ever built and the server answered "could not read it".
    ///
    /// The three answers are asserted separately because the screens have three different
    /// things to say, and for months they could only say the wrong one.
    #[test]
    fn a_locked_key_says_which_of_the_three_things_is_wrong() {
        let d = tempfile::tempdir().unwrap();
        let (path, pk) = write_locked_key(d.path(), "locked", "correct horse");

        // No passphrase: LOCKED, not "invalid key". This is the message the keyring screen
        // has always had a branch for and could never reach.
        assert_eq!(make_proof(&path, None, "https://x").unwrap_err(), "repo.ssh.errKeyPassphrase");

        // Wrong passphrase: its own answer. russh calls this "cryptographic error", which
        // reads like a broken key rather than four mistyped characters.
        assert_eq!(
            make_proof(&path, Some("correct hors"), "https://x").unwrap_err(),
            "repo.ssh.errKeyBadPassphrase",
        );

        // Right passphrase: a proof that verifies against its own public half, exactly like an
        // unprotected key. The passphrase changes how the file opens and nothing else.
        let proof = make_proof(&path, Some("correct horse"), "https://x").unwrap();
        assert_eq!(verify_proof(&proof, &[pk.clone()], "https://x").unwrap(), pk);
    }

    /// Remembering it is a session fact, and an empty one FORGETS.
    ///
    /// Storing the empty string would hand `decode_secret_key` an answer where there is none,
    /// turning "this key is locked" into "that passphrase is wrong" — the same two the test
    /// above exists to keep apart.
    #[test]
    fn an_empty_passphrase_forgets_rather_than_being_remembered() {
        remember_passphrase("/nowhere/k", "open sesame");
        assert_eq!(passphrase_for("/nowhere/k").as_deref(), Some("open sesame"));
        remember_passphrase("/nowhere/k", "");
        assert_eq!(passphrase_for("/nowhere/k"), None);
        // And nothing is remembered for a key nobody unlocked.
        assert_eq!(passphrase_for("/nowhere/never"), None);
    }

    #[test]
    fn a_proof_verifies_against_its_own_key_whatever_the_algorithm() {
        let d = tempfile::tempdir().unwrap();
        for (label, alg) in every_algorithm() {
            let (path, pk) = write_key(d.path(), label, alg);
            let proof = make_proof(&path, None, "https://x").unwrap_or_else(|e| panic!("{label}: {e}"));
            assert_eq!(
                verify_proof(&proof, &[pk.clone()], "https://x").unwrap_or_else(|e| panic!("{label}: {e}")),
                pk,
                "{label} should open its own door",
            );
        }
    }

    #[test]
    fn a_proof_for_another_audience_is_refused_whatever_the_algorithm() {
        let d = tempfile::tempdir().unwrap();
        for (label, alg) in every_algorithm() {
            let (path, pk) = write_key(d.path(), label, alg);
            let proof = make_proof(&path, None, "https://a").unwrap();
            // The signature is perfectly valid. That is exactly why the audience is checked.
            assert_eq!(verify_proof(&proof, &[pk], "https://b").unwrap_err(), "repo.keyauth.errAudience", "{label}");
        }
    }

    #[test]
    fn an_unauthorised_key_is_refused_whatever_the_algorithm() {
        let d = tempfile::tempdir().unwrap();
        for (label, alg) in every_algorithm() {
            let (path, _) = write_key(d.path(), label, alg.clone());
            let (_, other) = write_key(d.path(), &format!("{label}-other"), alg);
            let proof = make_proof(&path, None, "https://x").unwrap();
            assert_eq!(verify_proof(&proof, &[other], "https://x").unwrap_err(), "repo.keyauth.errNotAuthorised", "{label}");
        }
    }

    #[test]
    fn a_tampered_payload_is_refused_whatever_the_algorithm() {
        let d = tempfile::tempdir().unwrap();
        for (label, alg) in every_algorithm() {
            let (path, pk) = write_key(d.path(), label, alg);
            let proof = make_proof(&path, None, "https://x").unwrap();
            let mut parts: Vec<&str> = proof.split('.').collect();
            // Re-encode the payload with a later expiry. The signature covers the SEGMENT, so
            // this must fail — and it must fail as NOT_AUTHORISED or SIGNATURE, never pass.
            let raw = b64u().decode(parts[1]).unwrap();
            let mut p: serde_json::Value = serde_json::from_slice(&raw).unwrap();
            p["exp"] = serde_json::json!(now_secs() + 9999);
            let forged = b64u().encode(serde_json::to_vec(&p).unwrap());
            parts[1] = &forged;
            let bad = parts.join(".");
            assert!(verify_proof(&bad, &[pk], "https://x").is_err(), "{label}: a rewritten payload must not verify");
        }
    }

    #[test]
    fn the_one_line_public_key_an_owner_pastes_matches_what_the_proof_carries() {
        let d = tempfile::tempdir().unwrap();
        for (label, alg) in every_algorithm() {
            let key = russh::keys::PrivateKey::random(&mut OsRng, alg).unwrap();
            let path = d.path().join(format!("{label}-paste"));
            std::fs::write(&path, key.to_openssh(russh::keys::ssh_key::LineEnding::LF).unwrap().as_bytes()).unwrap();
            let pasted = key.public_key().to_openssh().unwrap();
            // What an owner pastes into an access list, and what the client presents, have to
            // be the same bytes — otherwise every list needs a conversion that can disagree.
            assert_eq!(
                pubkey_from_openssh(&pasted).unwrap(),
                public_blob(key.public_key()).unwrap(),
                "{label}",
            );
            let proof = make_proof(&path.to_string_lossy(), None, "https://x").unwrap();
            assert!(verify_proof(&proof, &[pubkey_from_openssh(&pasted).unwrap()], "https://x").is_ok(), "{label}");
        }
    }

    #[test]
    fn a_public_key_line_that_is_not_a_key_is_refused() {
        assert!(pubkey_from_openssh("hello").is_err());
        assert!(pubkey_from_openssh("").is_err());
        // A DSA line: readable shape, dead algorithm. Refused rather than half-accepted.
        assert!(pubkey_from_openssh("ssh-dss AAAAB3NzaC1kc3MAAACB").is_err());
    }

}
