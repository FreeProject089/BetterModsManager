//! BetterCommunity account identity, as presented to a self-hosted repo server.
//!
//! # Why this exists
//!
//! Ban and allow lists used to match on the raw `X-Creator-ID` header. That header is
//! whatever the caller typed: a banned user removes it or sends someone else's id, and an
//! allow list is passed by claiming an id that is on it. The lists looked like access
//! control and were closer to a suggestion.
//!
//! A Creator ID is an ed25519 **public key** (see `security::sign_message`), so the identity
//! behind it can be proven rather than asserted. BetterCommunity signs a short-lived
//! attestation naming the account and every id linked to it; the repo server verifies that
//! signature offline, with one public key it already holds.
//!
//! # Why offline verification
//!
//! The repo server never calls BetterCommunity to check a download. That keeps downloads
//! working when BetterCommunity is down, and — the reason it is built this way rather than as
//! a lookup endpoint — avoids an oracle that would answer "is creator id X linked to Discord
//! account Y?" for arbitrary X and Y. Linkage is disclosed only to the account it belongs to,
//! which then chooses to present it.
//!
//! # What an attestation does and does not prove
//!
//! Holding one proves the bearer obtained it from BetterCommunity while signed in as that
//! account. It is a bearer token: someone who steals it can replay it until it expires, the
//! same exposure as any session cookie, which is why it is short-lived and why `exp` is
//! enforced here rather than trusted from the issuer. It is not a proof of possession of the
//! Creator ID's private key — that would need a challenge round-trip, and is worth adding if
//! these lists ever guard something more valuable than mod downloads.

use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

/// Every identifier that belongs to one BetterCommunity account.
///
/// A list entry may name any of them — people know each other by whichever handle they share,
/// and requiring the repo owner to know which kind they were given would make the feature
/// useless in practice.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct AccountIdentity {
    /// The BetterCommunity account id (bcid).
    pub bcid: String,
    /// Creator IDs (ed25519 public keys) linked to the account.
    #[serde(default, rename = "creatorIds")]
    pub creator_ids: Vec<String>,
    /// Discord user ids linked to the account.
    #[serde(default, rename = "discordIds")]
    pub discord_ids: Vec<String>,
    /// Unix seconds. Enforced by the verifier, not trusted from the payload's author.
    #[serde(default)]
    pub exp: i64,
}

impl AccountIdentity {
    /// Every identifier this account can be recognised by, lowercased.
    ///
    /// Case matters here: a bcid pasted from a profile page and one typed into a ban list
    /// differ by case often enough that a case-sensitive match would read as "the ban did
    /// not work". Ids in this system are hex or numeric, so lowercasing cannot merge two
    /// distinct identities.
    pub fn identifiers(&self) -> Vec<String> {
        let mut out = Vec::with_capacity(1 + self.creator_ids.len() + self.discord_ids.len());
        for id in std::iter::once(&self.bcid)
            .chain(self.creator_ids.iter())
            .chain(self.discord_ids.iter())
        {
            let t = id.trim();
            if !t.is_empty() {
                out.push(t.to_lowercase());
            }
        }
        out
    }

    /// Does any identifier of this account appear in `entries`?
    pub fn matches_any(&self, entries: &std::collections::HashSet<String>) -> bool {
        if entries.is_empty() {
            return false;
        }
        let normalised: std::collections::HashSet<String> =
            entries.iter().map(|e| e.trim().to_lowercase()).collect();
        self.identifiers().iter().any(|id| normalised.contains(id))
    }
}

/// Why an attestation was rejected. Kept apart from "no attestation presented" so a caller
/// can tell an anonymous visitor from one presenting something forged or stale.
#[derive(Debug, Clone, PartialEq)]
pub enum IdentityError {
    Malformed,
    BadSignature,
    Expired,
    NoIssuerKey,
}

const PREFIX: &str = "bcw1";
const B64: base64::engine::general_purpose::GeneralPurpose = base64::engine::general_purpose::URL_SAFE_NO_PAD;

/// Verify a `bcw1.<payload>.<signature>` attestation and return the identity it names.
///
/// `issuer_pubkey_hex` is BetterCommunity's ed25519 public key. `now_unix` is passed in so
/// expiry is testable and so a single request cannot see the clock move mid-check.
///
/// The signature covers the base64 payload segment **exactly as transmitted**, not the JSON
/// it decodes to. Signing the decoded form would make validity depend on both sides
/// serialising identically — different key order or spacing, same object, failed signature.
pub fn verify_attestation(
    token: &str,
    issuer_pubkey_hex: &str,
    now_unix: i64,
) -> Result<AccountIdentity, IdentityError> {
    let issuer = issuer_pubkey_hex.trim();
    if issuer.is_empty() {
        return Err(IdentityError::NoIssuerKey);
    }

    let mut parts = token.trim().split('.');
    let (prefix, payload_b64, sig_b64) = match (parts.next(), parts.next(), parts.next(), parts.next()) {
        (Some(p), Some(a), Some(s), None) => (p, a, s),
        _ => return Err(IdentityError::Malformed),
    };
    if prefix != PREFIX {
        return Err(IdentityError::Malformed);
    }

    let pub_bytes = hex::decode(issuer).map_err(|_| IdentityError::NoIssuerKey)?;
    let pub_arr: [u8; 32] = pub_bytes.try_into().map_err(|_| IdentityError::NoIssuerKey)?;
    let vk = VerifyingKey::from_bytes(&pub_arr).map_err(|_| IdentityError::NoIssuerKey)?;

    let sig_bytes = B64.decode(sig_b64).map_err(|_| IdentityError::Malformed)?;
    let sig_arr: [u8; 64] = sig_bytes.try_into().map_err(|_| IdentityError::Malformed)?;

    vk.verify(payload_b64.as_bytes(), &Signature::from_bytes(&sig_arr))
        .map_err(|_| IdentityError::BadSignature)?;

    let json = B64.decode(payload_b64).map_err(|_| IdentityError::Malformed)?;
    let identity: AccountIdentity =
        serde_json::from_slice(&json).map_err(|_| IdentityError::Malformed)?;

    // Checked after the signature so an unsigned payload can never reach this branch, and
    // enforced regardless of what the issuer intended — an attestation without an expiry is
    // a permanent credential, so a missing/zero `exp` is refused rather than treated as
    // "never expires".
    if identity.exp <= 0 || identity.exp < now_unix {
        return Err(IdentityError::Expired);
    }

    Ok(identity)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn issuer() -> (SigningKey, String) {
        // Fixed bytes: a random key would make a failure unreproducible.
        let sk = SigningKey::from_bytes(&[7u8; 32]);
        let vk: VerifyingKey = (&sk).into();
        (sk, hex::encode(vk.to_bytes()))
    }

    fn mint(sk: &SigningKey, identity: &AccountIdentity) -> String {
        let payload = B64.encode(serde_json::to_vec(identity).unwrap());
        let sig = sk.sign(payload.as_bytes());
        format!("{}.{}.{}", PREFIX, payload, B64.encode(sig.to_bytes()))
    }

    fn sample(exp: i64) -> AccountIdentity {
        AccountIdentity {
            bcid: "BC-1234".into(),
            creator_ids: vec!["aabbcc".into()],
            discord_ids: vec!["987654321".into()],
            exp,
        }
    }

    #[test]
    fn a_genuine_attestation_yields_every_linked_id() {
        let (sk, pubkey) = issuer();
        let got = verify_attestation(&mint(&sk, &sample(2_000)), &pubkey, 1_000).unwrap();
        assert_eq!(got.bcid, "BC-1234");
        assert_eq!(got.identifiers(), vec!["bc-1234", "aabbcc", "987654321"]);
    }

    #[test]
    fn a_payload_edited_after_signing_is_refused() {
        // The whole point: without this, anyone appends their own bcid to someone's token.
        let (sk, pubkey) = issuer();
        let token = mint(&sk, &sample(2_000));
        let mut forged = sample(2_000);
        forged.bcid = "BC-ADMIN".into();
        let swapped = format!(
            "{}.{}.{}",
            PREFIX,
            B64.encode(serde_json::to_vec(&forged).unwrap()),
            token.split('.').nth(2).unwrap()
        );
        assert_eq!(verify_attestation(&swapped, &pubkey, 1_000), Err(IdentityError::BadSignature));
    }

    #[test]
    fn another_issuers_signature_is_refused() {
        let (_sk, pubkey) = issuer();
        let other = SigningKey::from_bytes(&[9u8; 32]);
        assert_eq!(
            verify_attestation(&mint(&other, &sample(2_000)), &pubkey, 1_000),
            Err(IdentityError::BadSignature),
        );
    }

    #[test]
    fn expiry_is_enforced_here_and_a_missing_one_is_not_forever() {
        let (sk, pubkey) = issuer();
        assert_eq!(
            verify_attestation(&mint(&sk, &sample(500)), &pubkey, 1_000),
            Err(IdentityError::Expired),
        );
        // A payload with no exp at all is a permanent credential if accepted.
        for absent in [0, -1] {
            assert_eq!(
                verify_attestation(&mint(&sk, &sample(absent)), &pubkey, 1_000),
                Err(IdentityError::Expired),
            );
        }
    }

    #[test]
    fn nothing_verifies_without_an_issuer_key_configured() {
        // Otherwise "identity checking is off" would silently mean "everything passes".
        let (sk, _) = issuer();
        let token = mint(&sk, &sample(2_000));
        for empty in ["", "   ", "not-hex"] {
            assert_eq!(verify_attestation(&token, empty, 1_000), Err(IdentityError::NoIssuerKey));
        }
    }

    #[test]
    fn junk_is_malformed_rather_than_a_panic() {
        let (_sk, pubkey) = issuer();
        for junk in ["", "bcw1", "bcw1.a", "bcw1.a.b.c", "bcw2.a.b", "bcw1.!!!.###"] {
            let got = verify_attestation(junk, &pubkey, 1_000);
            assert!(got.is_err(), "{junk:?} should not verify");
        }
    }

    /// Cross-language interop: this token was minted by BCWEB's Node issuer
    /// (`apps/api/src/lib/identity-attestation.mjs`) using `crypto.sign(null, …)` over the
    /// base64url payload, and this public key came from that key pair's JWK `x`.
    ///
    /// The two sides are separate codebases in separate languages, so nothing else in either
    /// suite would catch a base64 variant (padded vs not), a signature encoding difference,
    /// or a change to what exactly gets signed. Any of those ships as "every account entry
    /// is ignored", silently, on machines we do not run.
    #[test]
    fn a_token_minted_by_the_node_issuer_verifies_here() {
        const NODE_PUBKEY: &str =
            "0d8f66b24d1547c9a40d25d9847ea40305b6ac63a1b853b4d78c44126f4c9369";
        const NODE_TOKEN: &str = "bcw1.eyJiY2lkIjoiQkMtN0YzQSIsImNyZWF0b3JJZHMiOlsiZGVhZGJlZWYiXSwiZGlzY29yZElkcyI6WyIxMjM0NTY3ODkwMTIzNDU2NzgiXSwiaWF0IjoxMDAwLCJleHAiOjk5OTk5OTk5OTl9.-LKpPCj0Zgvct81s4eg6l9XaW1g5zr_IP2FR21LcgtOUJRetrY8k6LJrwY-29ixl6hqHCaHIu8yzhplYFiZbBg";

        let id = verify_attestation(NODE_TOKEN, NODE_PUBKEY, 1_700_000_000).unwrap();
        assert_eq!(id.bcid, "BC-7F3A");
        assert_eq!(id.creator_ids, vec!["deadbeef"]);
        assert_eq!(id.discord_ids, vec!["123456789012345678"]);

        // And a ban on the Discord id catches the same person arriving with any of them.
        let banned = std::collections::HashSet::from(["123456789012345678".to_string()]);
        assert!(id.matches_any(&banned));
    }

    #[test]
    fn a_list_entry_matches_any_linked_id_regardless_of_case() {
        let id = sample(2_000);
        for entry in ["BC-1234", "bc-1234", " AABBCC ", "987654321"] {
            let entries = std::collections::HashSet::from([entry.to_string()]);
            assert!(id.matches_any(&entries), "entry {entry:?} should match");
        }
        let unrelated = std::collections::HashSet::from(["someone-else".to_string()]);
        assert!(!id.matches_any(&unrelated));
        assert!(!id.matches_any(&std::collections::HashSet::new()));
    }
}

// ---------------------------------------------------------------------------
// Issuer key
// ---------------------------------------------------------------------------

/// BetterCommunity's ed25519 public key, hex, as trusted by this machine.
///
/// Read from `bcweb_identity_key.txt` in the app data dir. Kept out of the settings blob on
/// purpose: it is a trust anchor, and a stray settings import should not be able to swap the
/// key that decides who is banned. Absent means the feature is off — `verify_attestation`
/// then refuses everything rather than accepting anything.
pub fn issuer_public_key(handle: &tauri::AppHandle) -> String {
    use tauri::Manager;
    handle
        .path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("bcweb_identity_key.txt"))
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

/// Store the issuer key. Returns the normalised value so a caller can show what was kept.
#[tauri::command]
pub fn set_bcweb_identity_key(handle: tauri::AppHandle, key_hex: String) -> Result<String, String> {
    use tauri::Manager;
    let trimmed = key_hex.trim().to_lowercase();
    // Validated before it is stored: a typo here silently turns every attestation into a
    // rejection, which presents as "the allow list stopped working" with nothing to point at.
    if !trimmed.is_empty() {
        let bytes = hex::decode(&trimmed).map_err(|_| "Not hex".to_string())?;
        let arr: [u8; 32] = bytes.try_into().map_err(|_| "Expected a 32-byte ed25519 key".to_string())?;
        VerifyingKey::from_bytes(&arr).map_err(|_| "Not a valid ed25519 public key".to_string())?;
    }
    let dir = handle.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("bcweb_identity_key.txt"), &trimmed).map_err(|e| e.to_string())?;
    Ok(trimmed)
}

#[tauri::command]
pub fn get_bcweb_identity_key(handle: tauri::AppHandle) -> String {
    issuer_public_key(&handle)
}

/// The caller's own attestation, as stored on this machine, if any.
///
/// Sent as `X-Creator-Identity` on repo requests so a server whose owner keys their allow or
/// ban lists on accounts can recognise who is asking. Nothing here is secret to the user —
/// it describes them — but it is a bearer credential, so it travels in a header and is never
/// put in a URL or logged.
pub fn my_attestation(handle: &tauri::AppHandle) -> Option<String> {
    use tauri::Manager;
    let token = handle
        .path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("bcweb_attestation.txt"))
        .and_then(|p| std::fs::read_to_string(p).ok())?;
    let token = token.trim().to_string();
    if token.is_empty() { None } else { Some(token) }
}

/// Store (or clear, with an empty string) this machine's attestation.
#[tauri::command]
pub fn set_my_attestation(handle: tauri::AppHandle, token: String) -> Result<(), String> {
    use tauri::Manager;
    let dir = handle.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("bcweb_attestation.txt"), token.trim()).map_err(|e| e.to_string())
}
