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

/// The payload that gets signed: the document without its signature block, written in a
/// canonical form, with the format name bound in.
///
/// Canonical here means "a form another language can reproduce", because the verifier that
/// matters most is not in Rust — BCWEB's moderation tools read these files in Node, and a
/// scheme that only Rust can reproduce is a scheme where every document reads as tampered.
///
/// `serde_json::to_vec` is NOT that form. It prints a float that happens to be whole as
/// `1.0`; JavaScript, having parsed the same document, prints `1`. Neither is wrong and the
/// difference is invisible until every signature fails. So numbers are written here in the
/// shortest form that round-trips, which is what both languages produce for the values these
/// documents carry — counts, sizes, percentages, timestamps.
///
/// The boundary, stated rather than discovered: a float beyond ~1e21 or below ~1e-7 formats
/// differently in the two languages (JavaScript switches to exponent notation sooner). No
/// BMM format carries one. If one ever does, this is where it will be noticed — as a loud
/// "tampered", not as a silent pass.
fn canonical(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                out.push_str(&i.to_string());
            } else if let Some(u) = n.as_u64() {
                out.push_str(&u.to_string());
            } else if let Some(f) = n.as_f64() {
                // A whole float is written as an integer, because that is what a language
                // which never had an integer type will produce for the same value.
                if f.fract() == 0.0 && f.abs() < 9e15 {
                    out.push_str(&(f as i64).to_string());
                } else {
                    out.push_str(&f.to_string());
                }
            } else {
                out.push_str("null");
            }
        }
        // Strings go through serde: the escaping rules it applies (quote, backslash, control
        // characters, and nothing else) are the ones JSON.stringify applies.
        Value::String(s) => out.push_str(&serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())),
        Value::Array(items) => {
            out.push('[');
            for (i, v) in items.iter().enumerate() {
                if i > 0 { out.push(','); }
                canonical(v, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            // Keys SORTED, so a document that has been through another tool's formatter —
            // reordered, reindented — still verifies. serde_json's Map is already ordered
            // this way with `preserve_order` off; sorting explicitly means this does not
            // depend on a Cargo feature staying switched off.
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push('{');
            for (i, k) in keys.iter().enumerate() {
                if i > 0 { out.push(','); }
                out.push_str(&serde_json::to_string(k).unwrap_or_else(|_| "\"\"".into()));
                out.push(':');
                canonical(&map[*k], out);
            }
            out.push('}');
        }
    }
}

pub(crate) fn payload(doc: &Value, format: &str) -> Result<Vec<u8>, String> {
    let mut bare = doc.clone();
    if let Some(obj) = bare.as_object_mut() {
        obj.remove(FIELD);
    }
    let mut body = String::new();
    canonical(&bare, &mut body);
    // The format is prefixed rather than merged into the document, so signing does not
    // depend on the document having room for it.
    let mut out = Vec::with_capacity(body.len() + format.len() + 1);
    out.extend_from_slice(format.as_bytes());
    out.push(0x1e); // record separator — cannot occur in JSON text
    out.extend_from_slice(body.as_bytes());
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

/// Print a signed sample document, for the Node-side verifier's test to consume.
///
/// The two implementations of the canonical form live in different languages and different
/// repositories, and nothing else would notice them drifting apart until every document a
/// moderator opened read as tampered. This is run by `apps/api/test/bmm-signature.test.mjs`
/// through `cargo test -- --nocapture`, and the sample it prints is checked in.
#[cfg(test)]
mod cross_language {
    use super::*;

    #[test]
    fn print_a_signed_sample() {
        let mut doc = serde_json::json!({
            "format_version": "1.0",
            "name": "Cross-language sample",
            "count": 3,
            "ratio": 0.5,
            // A whole float: the exact value that made serde and JavaScript disagree.
            "whole": 2.0,
            "nested": { "b": [1, 2, { "z": true, "a": null }], "a": "quote \" tab 	 newline 
" },
            "mods": []
        });
        // The fixed key from the tests above, so the sample is reproducible.
        use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
        let sk = SigningKey::from_bytes(&[7u8; 32]);
        let vk: VerifyingKey = (&sk).into();
        let bytes = payload(&doc, "mm").unwrap();
        doc.as_object_mut().unwrap().insert(FIELD.into(), serde_json::json!({
            "format": "mm",
            "author_id": hex::encode(vk.to_bytes()),
            "signature": hex::encode(sk.sign(&bytes).to_bytes()),
            "signed_at": "2026-08-18T10:00:00+02:00",
        }));
        println!("SIGNED_SAMPLE {}", serde_json::to_string(&doc).unwrap());
    }
}

// ── Archives ──────────────────────────────────────────────────────────────────
//
// A `.bmmplug` and a `.bmmtheme` are ZIPs, so there is no document to put a block inside.
// Signing only the manifest they carry would be worse than not signing them at all: it would
// say "this plugin is intact" while every script beside the manifest could be swapped.
//
// So the archive gains one more entry, `bmm_signature.json`, which is an ordinary signed
// document (same block, same rules) whose CONTENT is a list of every other entry and its
// SHA-256:
//
//   { "format": "bmmplug", "entries": [ { "name": "plugin.json", "sha256": "…" }, … ],
//     "bmm_signature": { … } }
//
// Verifying is then two questions, and both must pass: does the block verify over the list,
// and does every file in the archive hash to what the list says. Adding a file is caught
// because it is not in the list; changing one because its hash moved; removing one because
// the list still names it.

/// The name of the entry that carries an archive's signature.
pub const ARCHIVE_ENTRY: &str = "bmm_signature.json";

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

/// The list of entries and their hashes, as a document. Sorted by name, so two archives with
/// the same content produce the same list however the writer happened to walk the folder.
fn entry_list(format: &str, entries: &[(String, Vec<u8>)]) -> Value {
    let mut rows: Vec<(&String, String)> = entries.iter()
        .filter(|(n, _)| n != ARCHIVE_ENTRY)
        .map(|(n, d)| (n, sha256_hex(d)))
        .collect();
    rows.sort_by(|a, b| a.0.cmp(b.0));
    serde_json::json!({
        "format": format,
        "entries": rows.iter()
            .map(|(n, h)| serde_json::json!({ "name": n, "sha256": h }))
            .collect::<Vec<_>>(),
    })
}

/// Build the signed manifest for an archive, from its entries as (name, bytes).
pub fn archive_manifest(handle: &AppHandle, format: &str, entries: &[(String, Vec<u8>)]) -> Value {
    let mut doc = entry_list(format, entries);
    sign_doc(handle, &mut doc, format);
    doc
}

/// The verdict on an archive: the signature over the list, AND the files against the list.
///
/// `entries` are the archive's contents as (name, bytes), including `bmm_signature.json`.
// Unused in the desktop binary today: an archive arriving here has already been verified by
// the installer path, and the reviewer-facing check runs in BCWEB's browser inspector. Kept
// because it is the Rust half of a two-language contract — the JS implementation must keep
// producing the same verdicts, and these tests are what proves it still does.
#[allow(dead_code)]
pub fn verify_archive(entries: &[(String, Vec<u8>)], expected_format: &str) -> Verdict {
    let Some((_, raw)) = entries.iter().find(|(n, _)| n == ARCHIVE_ENTRY) else {
        return Verdict::Unsigned;
    };
    let doc: Value = match serde_json::from_slice(raw) {
        Ok(v) => v,
        Err(e) => return Verdict::Malformed { reason: format!("{ARCHIVE_ENTRY} is not JSON: {e}") },
    };
    // The block first: if the list itself was edited, nothing it claims about the files means
    // anything.
    match verify_doc(&doc, expected_format) {
        Verdict::Valid { author_id, signed_at, format } => {
            let listed: std::collections::HashMap<String, String> = doc.get("entries")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|e| Some((
                    e.get("name")?.as_str()?.to_string(),
                    e.get("sha256")?.as_str()?.to_string(),
                ))).collect())
                .unwrap_or_default();

            for (name, data) in entries.iter().filter(|(n, _)| n != ARCHIVE_ENTRY) {
                match listed.get(name) {
                    // A file that is not in the list was added after signing.
                    None => return Verdict::Tampered { author_id },
                    Some(h) if *h != sha256_hex(data) => return Verdict::Tampered { author_id },
                    _ => {}
                }
            }
            // A file the list names and the archive no longer has was removed after signing.
            let present: std::collections::HashSet<&String> = entries.iter().map(|(n, _)| n).collect();
            if listed.keys().any(|n| !present.contains(n)) {
                return Verdict::Tampered { author_id };
            }
            Verdict::Valid { author_id, signed_at, format }
        }
        other => other,
    }
}

#[cfg(test)]
mod archive_tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey, VerifyingKey};

    /// The same list `archive_manifest` builds, signed with a fixed key instead of the
    /// keyring — so the test exercises the real payload and the real verifier.
    fn signed_manifest(format: &str, entries: &[(String, Vec<u8>)]) -> Vec<u8> {
        let mut doc = entry_list(format, entries);
        let sk = SigningKey::from_bytes(&[9u8; 32]);
        let vk: VerifyingKey = (&sk).into();
        let bytes = payload(&doc, format).unwrap();
        doc.as_object_mut().unwrap().insert(FIELD.into(), serde_json::json!({
            "format": format,
            "author_id": hex::encode(vk.to_bytes()),
            "signature": hex::encode(sk.sign(&bytes).to_bytes()),
            "signed_at": "2026-08-18T10:00:00+02:00",
        }));
        serde_json::to_vec(&doc).unwrap()
    }

    fn archive() -> Vec<(String, Vec<u8>)> {
        let mut e = vec![
            ("plugin.json".to_string(), b"{\"name\":\"Thing\"}".to_vec()),
            ("scripts/run.js".to_string(), b"console.log(1)".to_vec()),
        ];
        let sig = signed_manifest("bmmplug", &e);
        e.push((ARCHIVE_ENTRY.to_string(), sig));
        e
    }

    #[test]
    fn a_signed_archive_verifies() {
        assert!(matches!(verify_archive(&archive(), "bmmplug"), Verdict::Valid { .. }));
    }

    /// THE ONE that signing only the manifest would miss: the manifest is untouched and a
    /// script beside it was swapped.
    #[test]
    fn changing_a_file_the_manifest_does_not_mention_is_still_caught() {
        let mut a = archive();
        a[1].1 = b"console.log(evil)".to_vec();
        assert!(matches!(verify_archive(&a, "bmmplug"), Verdict::Tampered { .. }));
    }

    #[test]
    fn adding_a_file_is_caught() {
        let mut a = archive();
        a.insert(1, ("extra.js".to_string(), b"anything".to_vec()));
        assert!(matches!(verify_archive(&a, "bmmplug"), Verdict::Tampered { .. }));
    }

    #[test]
    fn removing_a_file_is_caught() {
        let mut a = archive();
        a.remove(1);
        assert!(matches!(verify_archive(&a, "bmmplug"), Verdict::Tampered { .. }));
    }

    #[test]
    fn the_list_itself_cannot_be_edited() {
        // Rewriting a hash in the list to match a swapped file breaks the block over it.
        let mut a = archive();
        let mut doc: Value = serde_json::from_slice(&a[2].1).unwrap();
        doc["entries"][0]["sha256"] = serde_json::json!("0".repeat(64));
        a[2].1 = serde_json::to_vec(&doc).unwrap();
        assert!(matches!(verify_archive(&a, "bmmplug"), Verdict::Tampered { .. }));
    }

    #[test]
    fn an_archive_with_no_signature_entry_is_unsigned() {
        let e = vec![("plugin.json".to_string(), b"{}".to_vec())];
        assert_eq!(verify_archive(&e, "bmmplug"), Verdict::Unsigned);
    }

    #[test]
    fn a_theme_signature_does_not_vouch_for_a_plugin() {
        let mut e = vec![("theme.json".to_string(), b"{}".to_vec())];
        let sig = signed_manifest("bmmtheme", &e);
        e.push((ARCHIVE_ENTRY.to_string(), sig));
        assert!(matches!(verify_archive(&e, "bmmplug"), Verdict::Malformed { .. }));
    }

    #[test]
    fn the_order_entries_were_written_in_does_not_matter() {
        let mut a = archive();
        a.swap(0, 1);
        assert!(matches!(verify_archive(&a, "bmmplug"), Verdict::Valid { .. }));
    }
}

/// Print a signed ARCHIVE sample, for the Node verifier's test.
///
/// Same reason as the document one above: the two implementations live in different
/// languages and repositories, and nothing else would notice them drifting apart until every
/// plugin a moderator opened read as tampered.
#[cfg(test)]
mod cross_language_archive {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey, VerifyingKey};

    #[test]
    fn print_a_signed_archive_sample() {
        let entries: Vec<(String, Vec<u8>)> = vec![
            ("plugin.json".to_string(), br#"{"id":"demo","name":"Demo"}"#.to_vec()),
            ("scripts/run.js".to_string(), b"export const go = () => 1;\n".to_vec()),
            // A binary entry, because a plugin ships icons and a hash must not care.
            ("icon.png".to_string(), vec![0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]),
        ];
        let mut doc = entry_list("bmmplug", &entries);
        let sk = SigningKey::from_bytes(&[9u8; 32]);
        let vk: VerifyingKey = (&sk).into();
        let bytes = payload(&doc, "bmmplug").unwrap();
        doc.as_object_mut().unwrap().insert(FIELD.into(), serde_json::json!({
            "format": "bmmplug",
            "author_id": hex::encode(vk.to_bytes()),
            "signature": hex::encode(sk.sign(&bytes).to_bytes()),
            "signed_at": "2026-08-18T10:00:00+02:00",
        }));
        println!("ARCHIVE_SAMPLE {}", serde_json::to_string(&doc).unwrap());
    }
}
