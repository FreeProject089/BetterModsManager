//! The signed incremental manifest (autoupdate.rs). Every rule has a test that was seen
//! failing with the rule removed (the flaw put back by text replacement, then restored).
//! Test keys only: the real private key never comes near a test.
use super::*;
use chrono::{DateTime, Duration, TimeZone, Utc};
use ed25519_dalek::{Signer, SigningKey};

const BI_CONTEXT: &[u8] = b"BetterInstaller update manifest v1\n";

fn test_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}
fn t0() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap()
}
fn rfc(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}
fn file(url: &str, path: &str) -> serde_json::Value {
    serde_json::json!({ "path": path, "sha256": "a".repeat(64), "download_url": url, "size": 10 })
}
fn good_files() -> serde_json::Value {
    serde_json::json!([file(
        "https://github.com/FreeProject089/BetterModsManager/releases/download/v1.2.0/lang-en.json",
        "_up_/frontend/Lang/en.json"
    )])
}
fn body(app: &str, version: &str, files: serde_json::Value, issued: DateTime<Utc>, expires: DateTime<Utc>) -> String {
    serde_json::json!({ "app_id": app, "version": version, "files": files,
                        "issued": rfc(issued), "expires": rfc(expires) })
    .to_string()
}
/// A whole document: `signed` = `signed_body`, signature by `sk` over `context` + body.
fn doc(sk: &SigningKey, context: &[u8], signed_body: &str) -> String {
    let mut msg = context.to_vec();
    msg.extend_from_slice(signed_body.as_bytes());
    let sig = hex::encode(sk.sign(&msg).to_bytes());
    let copy: serde_json::Value = serde_json::from_str(signed_body).unwrap();
    serde_json::json!({ "version": copy["version"], "files": copy["files"],
                        "signed": signed_body, "signature": sig })
    .to_string()
}
fn week(app: &str, version: &str, files: serde_json::Value) -> String {
    doc(&test_key(), MANIFEST_SIG_CONTEXT, &body(app, version, files, t0(), t0() + Duration::days(7)))
}
fn good_doc() -> String {
    week(MANIFEST_APP_ID, "1.2.0", good_files())
}
fn check(text: &str) -> Result<VerifiedManifest, String> {
    verify_manifest_text(text, &test_key().verifying_key(), "1.1.0", t0() + Duration::hours(1))
}

#[test]
fn a_valid_manifest_is_accepted() {
    let m = check(&good_doc()).expect("control: a valid manifest must verify");
    assert_eq!(m.version, "1.2.0");
    assert_eq!(m.files.len(), 1);
}

#[test]
fn the_node_signer_and_this_verifier_agree() {
    // Written by scripts/sign-update-manifest.mjs with the TEST seed 07 x 32 and
    // now = 2026-01-01T00:00:00Z. If either side changes the message layout, this stops verifying.
    let signed = r#"{"app_id":"com.bettermm.desktop","version":"1.2.0","files":[{"path":"_up_/frontend/Lang/en.json","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","download_url":"https://github.com/FreeProject089/BetterModsManager/releases/download/v1.2.0/lang-en.json","size":10}],"issued":"2026-01-01T00:00:00Z","expires":"2026-01-08T00:00:00Z"}"#;
    let sig = "dd87bbf7ba9712f9d0d83c5816e02dd7796080cf47e26b0c1618bd482a560debe933fba553f53bdf63276bf5bd6de0c7e5b85f5bb33a887610f2863fd8ad8a08";
    let text = serde_json::json!({ "signed": signed, "signature": sig }).to_string();
    assert_eq!(
        hex::encode(test_key().verifying_key().to_bytes()),
        "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c"
    );
    check(&text).expect("a manifest the Node signer wrote must verify here");
}

#[test]
fn an_unsigned_manifest_is_refused() {
    // The pre-signing format, exactly what gen-update-manifest.mjs writes.
    let legacy = serde_json::json!({ "version": "1.2.0", "files": good_files() }).to_string();
    let e = check(&legacy).unwrap_err();
    assert!(e.contains("not signed"), "{e}");
    // Signed body present, signature absent.
    let mut d: serde_json::Value = serde_json::from_str(&good_doc()).unwrap();
    d.as_object_mut().unwrap().remove("signature");
    let e = check(&d.to_string()).unwrap_err();
    assert!(e.contains("signature is missing"), "{e}");
}

#[test]
fn a_forged_manifest_is_refused() {
    // Signed by another key.
    let other = SigningKey::from_bytes(&[9u8; 32]);
    let forged = doc(&other, MANIFEST_SIG_CONTEXT, &body(MANIFEST_APP_ID, "1.2.0", good_files(), t0(), t0() + Duration::days(7)));
    assert!(check(&forged).unwrap_err().contains("does not match"));
    // Right key, body edited after signing (another file URL).
    let mut d: serde_json::Value = serde_json::from_str(&good_doc()).unwrap();
    let s = d["signed"].as_str().unwrap().replace("lang-en.json", "evil.json");
    d["signed"] = serde_json::Value::String(s);
    assert!(check(&d.to_string()).unwrap_err().contains("does not match"));
}

#[test]
fn a_signature_for_betterinstallers_context_does_not_verify_here() {
    // Same key, same body, signed the way a BetterInstaller update.json is.
    let cross = doc(&test_key(), BI_CONTEXT, &body(MANIFEST_APP_ID, "1.2.0", good_files(), t0(), t0() + Duration::days(7)));
    assert!(check(&cross).unwrap_err().contains("does not match"));
}

#[test]
fn an_expired_manifest_is_refused() {
    let text = good_doc();
    let key = test_key().verifying_key();
    let expires = t0() + Duration::days(7);
    assert!(verify_manifest_text(&text, &key, "1.1.0", expires - Duration::seconds(1)).is_ok(), "control");
    let e = verify_manifest_text(&text, &key, "1.1.0", expires).unwrap_err();
    assert!(e.contains("expired"), "now == expires must be refused: {e}");
    assert!(verify_manifest_text(&text, &key, "1.1.0", expires + Duration::days(30)).is_err());
}

#[test]
fn a_manifest_valid_for_more_than_seven_days_is_refused() {
    assert!(check(&good_doc()).is_ok(), "control: exactly 7 days is allowed");
    let over = doc(&test_key(), MANIFEST_SIG_CONTEXT,
                   &body(MANIFEST_APP_ID, "1.2.0", good_files(), t0(), t0() + Duration::days(7) + Duration::seconds(1)));
    assert!(check(&over).unwrap_err().contains("7 days"));
    let year = doc(&test_key(), MANIFEST_SIG_CONTEXT, &body(MANIFEST_APP_ID, "1.2.0", good_files(), t0(), t0() + Duration::days(365)));
    assert!(check(&year).unwrap_err().contains("7 days"));
    // expires <= issued.
    let backwards = doc(&test_key(), MANIFEST_SIG_CONTEXT, &body(MANIFEST_APP_ID, "1.2.0", good_files(), t0(), t0()));
    assert!(check(&backwards).unwrap_err().contains("7 days"));
}

#[test]
fn a_manifest_for_another_app_is_refused() {
    let bi = week("com.betterinstaller.app", "1.2.0", good_files());
    assert!(check(&bi).unwrap_err().contains("is for"));
}

#[test]
fn an_older_or_equal_version_is_refused() {
    let key = test_key().verifying_key();
    let now = t0() + Duration::hours(1);
    let text = good_doc(); // offers 1.2.0
    assert!(verify_manifest_text(&text, &key, "1.1.9", now).is_ok(), "control");
    assert!(verify_manifest_text(&text, &key, "1.2.0", now).unwrap_err().contains("only a newer"));
    assert!(verify_manifest_text(&text, &key, "1.2", now).unwrap_err().contains("only a newer"), "1.2 == 1.2.0");
    assert!(verify_manifest_text(&text, &key, "1.3.0", now).unwrap_err().contains("only a newer"));
}

#[test]
fn the_version_order_mirrors_bpkg_core() {
    assert!(is_newer("1.2.3-rc1", "1.2.2"), "the suffix is not part of the version");
    assert!(!is_newer("1.2.0-beta", "1.2.0"));
    assert!(is_newer("v1.3.0", "1.2.0"));
    assert!(!is_newer("1.3", "1.3.0"));
    assert!(is_newer("1.10.0", "1.9.9"));
    assert!(!is_newer("nightly", "0.0.1"), "no number is never newer");
    assert!(is_newer("0.0.1", "unknown"), "a current version with no number counts as 0");
    assert!(is_newer_version("1.2.3-rc1", "1.2.2"), "the release check uses the same order");
}

#[test]
fn only_https_and_plain_relative_paths_are_accepted() {
    let http = serde_json::json!([file("http://github.com/x/lang-en.json", "_up_/frontend/Lang/en.json")]);
    assert!(check(&week(MANIFEST_APP_ID, "1.2.0", http)).unwrap_err().contains("https"));
    for bad in ["../../evil.dll", "_up_/../../x", "C:\\Windows\\x.dll", "/etc/x", ""] {
        let f = serde_json::json!([file("https://github.com/x/y", bad)]);
        assert!(check(&week(MANIFEST_APP_ID, "1.2.0", f)).unwrap_err().contains("plain relative path"), "{bad:?}");
    }
    let upper = serde_json::json!([{ "path": "a.json", "sha256": "A".repeat(64), "download_url": "https://x.example/a", "size": 1 }]);
    assert!(check(&week(MANIFEST_APP_ID, "1.2.0", upper)).unwrap_err().contains("SHA-256"));
}

#[test]
fn a_js_supplied_parsed_manifest_is_not_trusted() {
    // What the UI used to pass: a parsed {version, files}. It no longer deserializes.
    let parsed = serde_json::json!({ "version": "9.9.9", "files": good_files() });
    assert!(serde_json::from_value::<ApplyRequest>(parsed).is_err());

    // The UI passes back what fetch_update_manifest returned, with its top-level fields edited.
    // Only `document` is read, and only its signed body.
    let evil = serde_json::json!([file("https://evil.example/payload.dll", "better-mods-manager.exe")]);
    let mut doc_v: serde_json::Value = serde_json::from_str(&good_doc()).unwrap();
    doc_v["files"] = evil.clone();
    doc_v["version"] = serde_json::json!("9.9.9");
    let req = serde_json::json!({ "version": "9.9.9", "files": evil, "document": doc_v.to_string() });
    let req: ApplyRequest = serde_json::from_value(req).unwrap();
    let m = check(&req.document).unwrap();
    assert_eq!(m.version, "1.2.0");
    assert_eq!(m.files[0].path, "_up_/frontend/Lang/en.json");
    assert!(m.files.iter().all(|f| !f.download_url.contains("evil")));

    // The command takes an ApplyRequest (never the display struct) and verifies what it
    // received before its first download or write.
    let src = include_str!("autoupdate.rs");
    let start = src.find("pub async fn apply_incremental_update(").expect("the command");
    let sig_end = start + src[start..].find(") -> Result<IncrementalResult").expect("its signature");
    let params = &src[start..sig_end];
    assert!(params.contains("manifest: ApplyRequest"), "{params}");
    assert!(!params.contains("UpdateManifest"), "{params}");
    let after = &src[sig_end..];
    let verify_at = after.find("verify_manifest_text(&manifest.document").expect("apply must verify the document");
    let first_get = after.find("client.get(").expect("the download");
    let first_write = after.find("std::fs::write").expect("the write");
    assert!(verify_at < first_get && verify_at < first_write, "verification must come first");
}

#[test]
fn the_built_in_key_is_the_publisher_key() {
    publisher_key().expect("the built-in key must parse");
    // Read at run time, not include_str!: BetterInstaller is a separate repository and is not
    // checked out by BMM's CI. The Node test compares this constant with the signer's, always;
    // and the release job's signer refuses a key whose public half is not this one.
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../BetterInstaller/examples/bmm/installer.toml");
    let Ok(toml) = std::fs::read_to_string(&path) else {
        eprintln!("installer.toml not present ({}) — comparison skipped", path.display());
        return;
    };
    let line = toml
        .lines()
        .find(|l| l.trim_start().starts_with("public_key"))
        .expect("public_key in installer.toml");
    assert!(line.contains(MANIFEST_PUBLIC_KEY_HEX), "{line}");
}
