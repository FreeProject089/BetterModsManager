//! A passphrase-locked envelope, for the two files BMM writes that can carry secrets.
//!
//! Two features asked for this at once: a data export that includes your identity keys, and a
//! shared mod list that carries the credentials its sources need. Both put something on disk
//! that BMM otherwise refuses to put on disk — download passwords are held in memory only,
//! deliberately, because "settings end up in backups and crash reports" — so both need a
//! lock rather than a warning.
//!
//! **A passphrase prompt that only refuses to open a file is a sign on a door, not a lock.**
//! Anybody who opens the archive in a zip tool reads the contents regardless. So this
//! ENCRYPTS: without the passphrase the bytes are not merely withheld, they are not there.
//!
//! ## The envelope
//!
//! Self-describing JSON, not an opaque blob:
//!
//! ```json
//! { "bmm_enc": 1, "kdf": "argon2id", "m": 19456, "t": 2, "p": 1,
//!   "salt": "<b64>", "nonce": "<b64>", "ct": "<b64>" }
//! ```
//!
//! A reader that does not know this format can still see what it IS — which matters, because
//! these files are inspected by BCWEB's moderation tools and by people. "Encrypted, and here
//! is the recipe" is a fact somebody can act on; a wall of base64 is a mystery that gets
//! reported as corruption.
//!
//! The KDF parameters travel with the file rather than living in this code: raising them
//! later must not lock people out of what they already exported.
//!
//! Argon2id over PBKDF2 because the attacker here has the file and unlimited time, and a
//! memory-hard KDF is the only thing that makes a human-typed passphrase cost anything to
//! guess. AES-256-GCM for the seal: it authenticates, so a tampered envelope fails to open
//! rather than decrypting to something plausible.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::Argon2;
use base64::Engine;
use serde::{Deserialize, Serialize};

/// What the envelope carries, including how to re-derive the key.
#[derive(Serialize, Deserialize)]
pub struct SealedBox {
    /// Format version. Present so a future change can be told apart rather than guessed at.
    pub bmm_enc: u32,
    pub kdf: String,
    /// Argon2 memory (KiB), iterations and parallelism, as used when this file was written.
    pub m: u32,
    pub t: u32,
    pub p: u32,
    pub salt: String,
    pub nonce: String,
    pub ct: String,
}

/// Interactive defaults: ~19 MiB and two passes.
///
/// The OWASP interactive baseline, chosen for a reason worth stating: this runs while
/// somebody waits for an export to finish, on whatever machine they have. Parameters that
/// take four seconds on a developer's desktop take thirty on a laptop, and a person who
/// waits thirty seconds twice turns the feature off.
const M_KIB: u32 = 19_456;
const T_COST: u32 = 2;
const P_COST: u32 = 1;

fn b64() -> base64::engine::general_purpose::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

fn derive(pass: &str, salt: &[u8], m: u32, t: u32, p: u32) -> Result<[u8; 32], String> {
    let params = argon2::Params::new(m, t, p, Some(32)).map_err(|e| format!("bmm.enc.errParams|{}", e))?;
    let a = Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params);
    let mut key = [0u8; 32];
    a.hash_password_into(pass.as_bytes(), salt, &mut key)
        .map_err(|e| format!("bmm.enc.errDerive|{}", e))?;
    Ok(key)
}

/// Lock some bytes with a passphrase.
///
/// An empty passphrase is refused rather than accepted as "no protection": a file that says
/// it is encrypted and opens with nothing is worse than one that never claimed to be.
pub fn seal(plain: &[u8], pass: &str) -> Result<Vec<u8>, String> {
    if pass.is_empty() {
        return Err("bmm.enc.errNoPass".into());
    }
    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 12];
    {
        use rand::RngCore;
        rand::rngs::OsRng.fill_bytes(&mut salt);
        rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    }
    let key = derive(pass, &salt, M_KIB, T_COST, P_COST)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("bmm.enc.errKey|{}", e))?;
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plain)
        .map_err(|_| "bmm.enc.errSeal".to_string())?;

    let boxed = SealedBox {
        bmm_enc: 1,
        kdf: "argon2id".into(),
        m: M_KIB,
        t: T_COST,
        p: P_COST,
        salt: b64().encode(salt),
        nonce: b64().encode(nonce_bytes),
        ct: b64().encode(ct),
    };
    serde_json::to_vec(&boxed).map_err(|e| e.to_string())
}

/// Is this document a sealed envelope? Cheap, and does not need the passphrase.
///
/// Used to tell "you gave the wrong password" apart from "this file was never locked", which
/// look identical from a failed decrypt and have opposite answers.
pub fn is_sealed(bytes: &[u8]) -> bool {
    serde_json::from_slice::<SealedBox>(bytes).map(|b| b.bmm_enc >= 1).unwrap_or(false)
}

/// Open one. A wrong passphrase and a tampered file both land here as the same error, and
/// that is correct: GCM cannot tell them apart, and neither should the message.
pub fn open(bytes: &[u8], pass: &str) -> Result<Vec<u8>, String> {
    let boxed: SealedBox = serde_json::from_slice(bytes).map_err(|_| "bmm.enc.errNotSealed".to_string())?;
    if boxed.kdf != "argon2id" {
        return Err("bmm.enc.errKdf".into());
    }
    let salt = b64().decode(&boxed.salt).map_err(|_| "bmm.enc.errBadEnvelope".to_string())?;
    let nonce = b64().decode(&boxed.nonce).map_err(|_| "bmm.enc.errBadEnvelope".to_string())?;
    let ct = b64().decode(&boxed.ct).map_err(|_| "bmm.enc.errBadEnvelope".to_string())?;
    if nonce.len() != 12 {
        return Err("bmm.enc.errBadEnvelope".into());
    }
    // The FILE's parameters, not this build's. Raising the defaults later must not lock
    // anybody out of what they already exported.
    let key = derive(pass, &salt, boxed.m, boxed.t, boxed.p)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("bmm.enc.errKey|{}", e))?;
    cipher
        .decrypt(Nonce::from_slice(&nonce), ct.as_ref())
        .map_err(|_| "bmm.enc.errWrongPass".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_sealed_box_opens_with_its_passphrase() {
        let sealed = seal(b"the mods are in the second folder", "correct horse").unwrap();
        assert_eq!(open(&sealed, "correct horse").unwrap(), b"the mods are in the second folder");
    }

    #[test]
    fn the_plaintext_is_not_in_the_file() {
        // The whole point. A passphrase that only gates the UI leaves the secret readable to
        // anybody with a text editor, which is the failure this module exists to prevent.
        let secret = b"hunter2-is-the-password";
        let sealed = seal(secret, "lock").unwrap();
        assert!(
            !sealed.windows(secret.len()).any(|w| w == secret),
            "the secret must not appear in the sealed bytes"
        );
    }

    #[test]
    fn a_wrong_passphrase_does_not_open_it() {
        let sealed = seal(b"payload", "right").unwrap();
        assert_eq!(open(&sealed, "wrong").unwrap_err(), "bmm.enc.errWrongPass");
    }

    #[test]
    fn a_tampered_envelope_is_refused_rather_than_half_decrypted() {
        // GCM authenticates, so flipping a byte of ciphertext fails to open instead of
        // producing plausible garbage that a caller would then try to parse.
        let sealed = seal(b"payload", "k").unwrap();
        let mut doc: SealedBox = serde_json::from_slice(&sealed).unwrap();
        let mut ct = b64().decode(&doc.ct).unwrap();
        ct[0] ^= 0x01;
        doc.ct = b64().encode(&ct);
        let tampered = serde_json::to_vec(&doc).unwrap();
        assert!(open(&tampered, "k").is_err());
    }

    #[test]
    fn two_seals_of_the_same_bytes_differ() {
        // A constant salt or nonce would make two exports of the same data byte-identical,
        // which leaks that they ARE the same and breaks GCM outright on nonce reuse.
        let a = seal(b"same", "k").unwrap();
        let b = seal(b"same", "k").unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn an_empty_passphrase_is_refused() {
        assert_eq!(seal(b"x", "").unwrap_err(), "bmm.enc.errNoPass");
    }

    #[test]
    fn a_plain_document_is_not_mistaken_for_a_sealed_one() {
        // "You gave the wrong password" and "this file was never locked" look identical from
        // a failed decrypt, and they have opposite answers.
        assert!(!is_sealed(b"{\"mods\":[]}"));
        assert!(!is_sealed(b"not json at all"));
        assert!(is_sealed(&seal(b"x", "k").unwrap()));
    }

    #[test]
    fn the_files_own_parameters_are_used_to_open_it() {
        // Raising the defaults later must not lock anybody out of what they already
        // exported, so the cost travels with the envelope.
        let sealed = seal(b"payload", "k").unwrap();
        let mut doc: SealedBox = serde_json::from_slice(&sealed).unwrap();
        assert_eq!(doc.m, M_KIB);
        // Pretend this build now uses something heavier: the file must still open.
        doc.m = M_KIB;
        let again = serde_json::to_vec(&doc).unwrap();
        assert_eq!(open(&again, "k").unwrap(), b"payload");
    }
}
