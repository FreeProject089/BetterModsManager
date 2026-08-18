//! One signature block, for every document BMM writes.
//!
//! `repo.json` has been signed since it existed, because a repo is something strangers
//! download. But every other file BMM produces — a mod list, an automation, a navbar layout,
//! a backup manifest — travels exactly the same way: somebody posts it, somebody else opens
//! it, and until now the person opening it had no way to tell whether it was still what the
//! author wrote. A `.bmmpa` that runs scripts is the sharpest version of that.
//!
//! So the same ed25519 identity that signs a repo signs those too, in a block any JSON
//! document can carry:
//!
//! ```json
//! "bmm_signature": {
//!   "format": "mm",
//!   "author_id": "<hex public key>",
//!   "signature": "<hex>",
//!   "signed_at": "2026-08-18T10:00:00+02:00"
//! }
//! ```
//!
//! The rules that make it mean anything:
//!
//! * The signature covers the document **with the block removed**, serialised the same way
//!   both times. Sign it with the block present and nothing can ever verify it — that is
//!   the mistake `verify_repo_signature` documents in its own comment, and the reason this
//!   is one function instead of a pattern to reimplement per format.
//! * `format` is inside the signed payload. Otherwise a signed mod list could be renamed to
//!   an automation and still verify, and the signature would be vouching for the wrong
//!   thing.
//! * A missing block is **unsigned**, not invalid. Every file written before this exists,
//!   and third-party tools write these formats too.
//! * Verification never needs BMM's keyring: the public key travels in the document. It says
//!   "this file has not changed since that author wrote it", not "that author is trustworthy"
//!   — who to trust is the reader's business, and BCWEB's moderation tools answer it by
//!   showing the author id next to the verdict.

use serde_json::Value;
use tauri::AppHandle;

/// The key the block lives under. Chosen to be obviously ours and to sort away from a
/// format's own fields.
pub const FIELD: &str = "bmm_signature";

/// What a reader is told about a document.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "snake_case", tag = "state")]
pub enum Verdict {
    /// No signature block. Not a failure — just nothing vouched for.
    Unsigned,
    /// Signed, and the bytes still match.
    Valid { author_id: String, signed_at: Option<String>, format: Option<String> },
    /// Signed, and the bytes do NOT match — the document was changed after signing, or the
    /// block was copied from another file.
    Tampered { author_id: String },
    /// A block that is not a signature block at all (missing fields, malformed hex).
    Malformed { reason: String },
}

/// The payload that gets signed: the document without its signature block, canonically
/// serialised, with the format name bound in.
///
/// Serialised through `serde_json::to_vec` on a `Value`, whose object keys are sorted when
/// the `preserve_order` feature is off — which it is here. Two runs over the same content
/// therefore produce the same bytes, which is the only reason any of this verifies.
fn payload(doc: &Value, format: &str) -> Result<Vec<u8>, String> {
    let mut bare = doc.clone();
    if let Some(obj) = bare.as_object_mut() {
        obj.remove(FIELD);
    }
    let body = serde_json::to_vec(&bare).map_err(|e| e.to_string())?;
    // The format is prefixed rather than merged into the document, so signing does not
    // depend on the document having room for it.
    let mut out = Vec::with_capacity(body.len() + format.len() + 1);
    out.extend_from_slice(format.as_bytes());
    out.push(0x1e); // record separator — cannot occur in JSON text
    out.extend_from_slice(&body);
    Ok(out)
}

/// Add (or replace) the signature block on a JSON document.
///
/// Returns false when the document is not an object, or when the keyring is unavailable —
/// an unsigned document is still a usable document, and refusing to write one would turn a
/// key problem into "exporting is broken".
pub fn sign_doc(handle: &AppHandle, doc: &mut Value, format: &str) -> bool {
    let Some(obj) = doc.as_object_mut() else { return false };
    obj.remove(FIELD);
    let bytes = match payload(doc, format) {
        Ok(b) => b,
        Err(_) => return false,
    };
    let (author_id, signature) = match super::security::sign_message(handle, &bytes) {
        Ok(pair) => pair,
        Err(e) => {
            tracing::warn!("document written unsigned: {}", e);
            return false;
        }
    };
    if let Some(obj) = doc.as_object_mut() {
        obj.insert(FIELD.to_string(), serde_json::json!({
            "format": format,
            "author_id": author_id,
            "signature": signature,
            "signed_at": chrono::Local::now().to_rfc3339(),
        }));
    }
    true
}

/// Read the verdict on a document.
///
/// `expected_format` is what the READER thinks it is opening. A signature over a mod list
/// does not vouch for an automation, so a mismatch fails verification rather than being
/// reported as a curiosity.
pub fn verify_doc(doc: &Value, expected_format: &str) -> Verdict {
    let Some(block) = doc.get(FIELD) else { return Verdict::Unsigned };
    let (Some(author_id), Some(signature)) = (
        block.get("author_id").and_then(|v| v.as_str()),
        block.get("signature").and_then(|v| v.as_str()),
    ) else {
        return Verdict::Malformed { reason: "signature block has no author_id/signature".into() };
    };
    let format = block.get("format").and_then(|v| v.as_str()).unwrap_or(expected_format);
    if format != expected_format {
        return Verdict::Malformed {
            reason: format!("signed as '{format}', opened as '{expected_format}'"),
        };
    }
    let bytes = match payload(doc, format) {
        Ok(b) => b,
        Err(e) => return Verdict::Malformed { reason: e },
    };
    if super::security::verify_signature(author_id, signature, &bytes) {
        Verdict::Valid {
            author_id: author_id.to_string(),
            signed_at: block.get("signed_at").and_then(|v| v.as_str()).map(String::from),
            format: Some(format.to_string()),
        }
    } else {
        Verdict::Tampered { author_id: author_id.to_string() }
    }
}

/// Verify a document the UI already has as text. Used by the import screens, and by the
/// plugin/CLI surface so a publish script can check a file before shipping it.
#[tauri::command]
pub fn verify_bmm_document(json: String, format: String) -> Result<Verdict, String> {
    let doc: Value = serde_json::from_str(&json).map_err(|e| format!("not JSON: {e}"))?;
    Ok(verify_doc(&doc, &format))
}

/// Write a JSON document, signed.
///
/// The screens that produce these files build them in JavaScript and used to hand the text
/// to `write_text_file`. Signing there is impossible — the private key never leaves the Rust
/// side, and it should not — so they hand the document here instead and it is signed on the
/// way to disk. One writer, so a new format cannot forget to be signed by being written
/// somewhere else.
#[tauri::command]
pub fn write_signed_document(
    handle: AppHandle,
    path: String,
    json: String,
    format: String,
) -> Result<bool, String> {
    let mut doc: Value = serde_json::from_str(&json).map_err(|e| format!("not JSON: {e}"))?;
    let signed = sign_doc(&handle, &mut doc, &format);
    let text = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    // Confined the same way write_text_file is: the caller picked this path in a native save
    // dialog, and nothing here invents one.
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(signed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey, VerifyingKey};

    /// The real signer, with a fixed key. A stub returning a constant would let a change to
    /// WHAT gets signed pass unnoticed, which is the only interesting way this can break.
    fn sign_with(bytes: &[u8]) -> (String, String) {
        let sk = SigningKey::from_bytes(&[7u8; 32]);
        let vk: VerifyingKey = (&sk).into();
        (hex::encode(vk.to_bytes()), hex::encode(sk.sign(bytes).to_bytes()))
    }

    /// Same thing `sign_doc` does, without needing an AppHandle.
    fn signed(doc: &mut Value, format: &str) {
        if let Some(obj) = doc.as_object_mut() { obj.remove(FIELD); }
        let (author_id, signature) = sign_with(&payload(doc, format).unwrap());
        doc.as_object_mut().unwrap().insert(FIELD.into(), serde_json::json!({
            "format": format, "author_id": author_id, "signature": signature,
            "signed_at": "2026-08-18T10:00:00+02:00",
        }));
    }

    fn doc() -> Value {
        serde_json::json!({ "name": "Cold War", "mods": [{ "name": "A" }, { "name": "B" }] })
    }

    #[test]
    fn a_signed_document_verifies() {
        let mut d = doc();
        signed(&mut d, "mm");
        assert!(matches!(verify_doc(&d, "mm"), Verdict::Valid { .. }));
    }

    #[test]
    fn changing_one_character_breaks_it() {
        let mut d = doc();
        signed(&mut d, "mm");
        d["name"] = serde_json::json!("Cold war");
        assert!(matches!(verify_doc(&d, "mm"), Verdict::Tampered { .. }));
    }

    /// The failure that makes a signature scheme useless: signing the document WITH the
    /// block in it, so nothing can reproduce the payload afterwards.
    #[test]
    fn the_block_itself_is_not_part_of_what_is_signed() {
        let mut d = doc();
        signed(&mut d, "mm");
        // Touching a field of the block that is not the signature must not change the answer
        // to "are the contents intact" — it is not content.
        d[FIELD]["signed_at"] = serde_json::json!("1999-01-01T00:00:00+00:00");
        assert!(matches!(verify_doc(&d, "mm"), Verdict::Valid { .. }));
    }

    /// A signed mod list renamed to an automation must not verify as an automation. The
    /// signature would otherwise vouch for something its author never wrote.
    #[test]
    fn a_signature_does_not_travel_between_formats() {
        let mut d = doc();
        signed(&mut d, "mm");
        match verify_doc(&d, "bmmpa") {
            Verdict::Malformed { reason } => assert!(reason.contains("mm"), "{reason}"),
            other => panic!("a mod list verified as an automation: {other:?}"),
        }
    }

    #[test]
    fn a_block_lifted_from_another_file_is_tampered_not_valid() {
        let mut a = doc();
        signed(&mut a, "mm");
        let mut b = serde_json::json!({ "name": "Something else", "mods": [] });
        b.as_object_mut().unwrap().insert(FIELD.into(), a[FIELD].clone());
        assert!(matches!(verify_doc(&b, "mm"), Verdict::Tampered { .. }));
    }

    #[test]
    fn no_block_is_unsigned_rather_than_invalid() {
        // Every file written before any of this exists, and other tools write these formats.
        assert_eq!(verify_doc(&doc(), "mm"), Verdict::Unsigned);
    }

    #[test]
    fn a_broken_block_says_so_instead_of_passing() {
        let mut d = doc();
        d.as_object_mut().unwrap().insert(FIELD.into(), serde_json::json!({ "format": "mm" }));
        assert!(matches!(verify_doc(&d, "mm"), Verdict::Malformed { .. }));
    }

    /// Key order in the source text must not matter: a document that went through another
    /// tool's formatter still verifies, because the payload is built from parsed values.
    #[test]
    fn reformatting_the_json_does_not_break_the_signature() {
        let mut d = doc();
        signed(&mut d, "mm");
        let reordered: Value = serde_json::from_str(&serde_json::to_string_pretty(&d).unwrap()).unwrap();
        assert!(matches!(verify_doc(&reordered, "mm"), Verdict::Valid { .. }));
    }
}
