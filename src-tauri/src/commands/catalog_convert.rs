//! The universal catalogue format (`catalog_format.rs`) as commands, and the keys signed
//! catalogues verify against.
//!
//! Same split as `repo_format` / `repo_convert`: the format module is pure and knows nothing of
//! the app; this one reads files, holds the trusted keys and is what the interface, the
//! existing loaders and a script call.
//!
//! Trusted keys live in `catalog-keys.json` in the app data folder. A key with an `issuer` is
//! PINNED to that origin, or to a path scope under it (`https://host/v2/feeds/`): a catalogue
//! from there must be signed by it (an unsigned or differently-signed one is refused), which is
//! how a downgrade to an unsigned copy is caught. A key without one is trusted for any source
//! and pinned to none. Nothing is trusted by default — v2 makes its feed key on first use, so
//! there is no key to ship — and `fetch` pins whatever `{root}/v2/feeds/keys` publishes to
//! `{root}/v2/feeds/`: trust on first use, taken once, then held to. In `BCApiVersion=v2` mode
//! the interface does that for the configured BetterCommunity v2 root the first time it reads
//! one of its signed feeds (`core/catalog-read.ts` `ensureFeedKeys`); v1 mode never does.

use crate::commands::catalog_format::{self as cf, Normalized, NormalizeOptions, SignatureReport, TrustedKey, Variant};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

const MAX_FILE: u64 = 32 * 1024 * 1024;

// ── trusted keys ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct KeyStore {
    #[serde(default)]
    keys: Vec<StoredKey>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredKey {
    #[serde(flatten)]
    key: TrustedKey,
    #[serde(default)]
    added_at: String,
}

fn keys_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    app.path().app_data_dir().ok().map(|d| d.join("catalog-keys.json"))
}

fn read_store(app: &tauri::AppHandle) -> KeyStore {
    keys_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn write_store(app: &tauri::AppHandle, s: &KeyStore) -> Result<(), String> {
    let p = keys_path(app).ok_or("no app data folder")?;
    if let Some(d) = p.parent() { let _ = std::fs::create_dir_all(d); }
    std::fs::write(&p, serde_json::to_string_pretty(s).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// Every key a signature may verify against: the stored ones.
pub fn trusted_keys(app: &tauri::AppHandle) -> Vec<TrustedKey> {
    read_store(app).keys.into_iter().map(|k| k.key).collect()
}

fn check_key(public_key: &str) -> Result<(), String> {
    let raw = cf::b64_decode(public_key).ok_or("public_key is not base64")?;
    let arr = <[u8; 32]>::try_from(raw.as_slice()).map_err(|_| "public_key must be a raw 32-byte Ed25519 key, base64".to_string())?;
    ed25519_dalek::VerifyingKey::from_bytes(&arr).map_err(|_| "not an Ed25519 public key".to_string())?;
    Ok(())
}

/// Manage the trusted keys. `op`: `list` · `add` · `remove` · `fetch`.
///
/// `fetch` reads `{issuer}/v2/feeds/keys` (BetterCommunity v2's published keys, retired ones
/// included so an older feed still verifies) and pins every key to `{issuer}/v2/feeds/`.
/// An `issuer` given to `add` may carry such a path scope too; without one it pins the origin.
#[tauri::command]
pub async fn catalog_keys(
    app: tauri::AppHandle,
    op: String,
    issuer: Option<String>,
    keyid: Option<String>,
    public_key: Option<String>,
    label: Option<String>,
) -> Result<Value, String> {
    let mut store = read_store(&app);
    let now = chrono::Utc::now().to_rfc3339();
    let issuer = match issuer.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(i) => Some(cf::issuer_of(i).ok_or("issuer must be an http(s) address")?),
        None => None,
    };
    match op.as_str() {
        "list" => {}
        "add" => {
            let pk = public_key.ok_or("public_key is required")?;
            check_key(&pk)?;
            let kid = keyid.unwrap_or_default();
            store.keys.retain(|k| !(k.key.public_key == pk && k.key.issuer == issuer));
            store.keys.push(StoredKey { key: TrustedKey { keyid: kid, public_key: pk, issuer, label }, added_at: now });
            write_store(&app, &store)?;
        }
        "remove" => {
            let before = store.keys.len();
            store.keys.retain(|k| {
                let kid_hit = keyid.as_deref().map(|x| x == k.key.keyid).unwrap_or(true);
                let pk_hit = public_key.as_deref().map(|x| x == k.key.public_key).unwrap_or(true);
                let iss_hit = issuer.as_ref().map(|x| Some(x) == k.key.issuer.as_ref()).unwrap_or(true);
                !(kid_hit && pk_hit && iss_hit)
            });
            if store.keys.len() == before { return Err("no such key".into()); }
            write_store(&app, &store)?;
        }
        "fetch" => {
            // `issuer` is the server's v2 ROOT (BCv2Base). The keys are pinned to its feed
            // scope, `{root}/v2/feeds/`, not to the whole origin: the same server's unsigned
            // v1-compatible catalog.json must stay readable (see catalog_format::issuer_of).
            let root = issuer.clone().ok_or("issuer is required")?;
            let root = root.trim_end_matches('/').to_string();
            let url = format!("{root}/v2/feeds/keys");
            let origin = format!("{root}/v2/feeds/");
            let resp = crate::commands::net::client().get(&url)
                .header(reqwest::header::USER_AGENT, "BetterModsManager/1.0")
                .timeout(std::time::Duration::from_secs(10))
                .send().await.map_err(|e| e.to_string())?;
            if !resp.status().is_success() { return Err(format!("HTTP {}", resp.status().as_u16())); }
            let doc: Value = resp.json().await.map_err(|e| e.to_string())?;
            let mut added = 0usize;
            for k in doc.get("keys").and_then(Value::as_array).into_iter().flatten().take(16) {
                let (Some(kid), Some(pk)) = (k.get("keyid").and_then(Value::as_str), k.get("public_key").and_then(Value::as_str)) else { continue };
                if k.get("alg").and_then(Value::as_str).unwrap_or("ed25519") != "ed25519" || check_key(pk).is_err() { continue; }
                store.keys.retain(|x| !(x.key.public_key == pk && x.key.issuer.as_deref() == Some(origin.as_str())));
                store.keys.push(StoredKey {
                    key: TrustedKey { keyid: kid.into(), public_key: pk.into(), issuer: Some(origin.clone()), label: label.clone() },
                    added_at: now.clone(),
                });
                added += 1;
            }
            if added == 0 { return Err("that server publishes no Ed25519 feed key".into()); }
            write_store(&app, &store)?;
        }
        other => return Err(format!("unknown op '{other}'. One of: list, add, remove, fetch")),
    }
    Ok(json!({ "keys": store.keys }))
}

// ── what the loaders call ────────────────────────────────────────────────────

/// For a loader of `kind`: the v1 document to parse instead of `text`, `None` to parse `text`
/// as before, `Err` when the document must not be read (an invalid signature). See
/// `catalog_format::legacy_view`.
pub fn legacy_for(app: &tauri::AppHandle, text: &str, kind: &str, source_url: Option<&str>) -> Result<Option<Value>, String> {
    let opts = NormalizeOptions { kind: Some(kind.into()), source_url: source_url.map(String::from), keys: trusted_keys(app) };
    let r = cf::legacy_view(text, kind, &opts);
    if let Err(e) = &r {
        crate::commands::crash::log_line(format!("[CATALOG] {kind} catalogue refused ({}): {e}", source_url.unwrap_or("?")));
    }
    r
}

/// Same, for a document already parsed.
pub fn legacy_value(app: &tauri::AppHandle, v: Value, kind: &str, source_url: Option<&str>) -> Result<Value, String> {
    Ok(legacy_for(app, &v.to_string(), kind, source_url)?.unwrap_or(v))
}

fn opts(app: &tauri::AppHandle, kind: Option<String>, source_url: Option<String>, keys: Option<Vec<TrustedKey>>) -> NormalizeOptions {
    let mut all = trusted_keys(app);
    all.extend(keys.unwrap_or_default());
    NormalizeOptions { kind, source_url, keys: all }
}

async fn read_input(text: Option<String>, path: Option<String>) -> Result<String, String> {
    if let Some(t) = text { return Ok(t); }
    let p = path.ok_or("give text or path")?;
    let meta = tokio::fs::metadata(&p).await.map_err(|e| e.to_string())?;
    if meta.len() > MAX_FILE { return Err(format!("{p}: larger than {} MiB", MAX_FILE / 1024 / 1024)); }
    tokio::fs::read_to_string(&p).await.map_err(|e| e.to_string())
}

// ── commands ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateReport {
    /// No error and not refused.
    pub ok: bool,
    pub refused: bool,
    pub variant: Variant,
    pub variant_label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inner_variant: Option<Variant>,
    pub signature: SignatureReport,
    pub errors: usize,
    pub warnings: usize,
    pub items: usize,
    /// Items per kind.
    pub kinds: BTreeMap<String, usize>,
    pub links: usize,
    pub issues: Vec<cf::Issue>,
}

pub fn report(n: &Normalized) -> ValidateReport {
    let items = n.catalog.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut kinds = BTreeMap::new();
    for it in &items {
        *kinds.entry(it.get("kind").and_then(Value::as_str).unwrap_or("?").to_string()).or_insert(0) += 1;
    }
    let errors = n.issues.iter().filter(|i| i.severity == cf::Severity::Error).count();
    ValidateReport {
        ok: errors == 0 && !n.refused,
        refused: n.refused,
        variant: n.variant,
        variant_label: n.variant_label.clone(),
        inner_variant: n.inner_variant,
        signature: n.signature.clone(),
        errors,
        warnings: n.issues.iter().filter(|i| i.severity == cf::Severity::Warning).count(),
        items: items.len(),
        kinds,
        links: n.catalog.get("catalogs").and_then(Value::as_array).map(Vec::len).unwrap_or(0),
        issues: n.issues.clone(),
    }
}

/// Validate a catalogue of any variant: what it is, whether its signature holds, and every
/// problem with a JSON path. Give `text` or `path`.
#[tauri::command]
pub async fn catalog_validate(
    app: tauri::AppHandle,
    text: Option<String>,
    path: Option<String>,
    kind: Option<String>,
    source_url: Option<String>,
) -> Result<ValidateReport, String> {
    let body = read_input(text, path).await?;
    Ok(report(&cf::normalize_text(&body, &opts(&app, kind, source_url, None))))
}

/// Any variant → the universal document, with the signature status and the issues. The
/// interface's `core/catalog-format.ts` calls this and falls back to its own reader.
#[tauri::command]
pub async fn catalog_normalize(
    app: tauri::AppHandle,
    text: String,
    kind: Option<String>,
    source_url: Option<String>,
    keys: Option<Vec<TrustedKey>>,
) -> Result<Normalized, String> {
    Ok(cf::normalize_text(&text, &opts(&app, kind, source_url, keys)))
}

/// Check a DSSE envelope's signature, nothing else.
#[tauri::command]
pub async fn catalog_verify_signature(
    app: tauri::AppHandle,
    text: String,
    keys: Option<Vec<TrustedKey>>,
    source_url: Option<String>,
) -> Result<SignatureReport, String> {
    let v: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|e| format!("not JSON: {e}"))?;
    if cf::detect(&v) != Variant::Dsse {
        return Ok(SignatureReport::unsigned());
    }
    let o = opts(&app, None, source_url, keys);
    Ok(cf::verify_envelope(&v, &o.keys, o.source_url.as_deref()).0)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertArgs {
    /// The catalogue file to convert.
    pub path: String,
    /// Where to write. Default: `<name>.universal.json` beside the input.
    pub out: Option<String>,
    #[serde(default)]
    pub dry_run: bool,
    pub kind: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertReport {
    pub input: String,
    pub output: String,
    pub written: bool,
    /// A copy of the file it replaced, when it wrote over one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backup: Option<String>,
    pub report: ValidateReport,
    /// The universal document (also what was written).
    pub catalog: Value,
}

pub fn default_out(input: &str) -> String {
    let p = std::path::Path::new(input);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("catalog");
    let name = format!("{stem}.universal.json");
    p.parent().map(|d| d.join(&name)).unwrap_or_else(|| std::path::PathBuf::from(&name)).to_string_lossy().into_owned()
}

/// Convert a catalogue file of any variant to the universal format. A signed input is
/// converted from its VERIFIED payload and written unsigned (re-signing needs the publisher's
/// key); a refused one (invalid signature, unreadable, too new) is never written.
#[tauri::command]
pub async fn catalog_convert(app: tauri::AppHandle, args: ConvertArgs) -> Result<ConvertReport, String> {
    let body = read_input(None, Some(args.path.clone())).await?;
    let n = cf::normalize_text(&body, &opts(&app, args.kind.clone(), None, None));
    let rep = report(&n);
    if n.refused {
        let why = n.issues.iter().find(|i| i.severity == cf::Severity::Error).map(|i| i.message.clone()).unwrap_or_default();
        return Err(format!("not converted: {why}"));
    }
    let output = args.out.clone().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| default_out(&args.path));
    let mut backup = None;
    let mut written = false;
    if !args.dry_run {
        let text = serde_json::to_string_pretty(&n.catalog).map_err(|e| e.to_string())? + "\n";
        if tokio::fs::metadata(&output).await.is_ok() {
            // Written over: keep what was there. Read+write rather than a copy call, one small file.
            let b = format!("{output}.bak");
            let old = tokio::fs::read(&output).await.map_err(|e| e.to_string())?;
            tokio::fs::write(&b, old).await.map_err(|e| e.to_string())?;
            backup = Some(b);
        }
        tokio::fs::write(&output, text).await.map_err(|e| e.to_string())?;
        written = true;
    }
    Ok(ConvertReport { input: args.path, output, written, backup, report: rep, catalog: n.catalog })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_kinds_agree_with_the_authored_store() {
        // The format's kinds and the authoring store's kinds are one list written twice
        // (the format module stays crate-free). Pinned here.
        let store: Vec<(&str, &str)> = crate::commands::catalog_store::CATALOG_KINDS.iter().copied().filter(|(k, _)| *k != "index").collect();
        assert_eq!(store, cf::KINDS.to_vec());
    }

    #[test]
    fn catalog_index_types_agree_with_the_interface() {
        // INDEX_TYPES in catalog-index.ts is what the interface routes; every one is a kind here.
        let ts = include_str!("../../../frontend/src/features/catalogs/catalog-index.ts");
        let line = ts.lines().find(|l| l.contains("export const INDEX_TYPES")).expect("INDEX_TYPES");
        for (k, _) in cf::KINDS {
            assert!(line.contains(&format!("'{k}'")), "{k} is a catalogue kind the index reader does not route");
        }
    }

    #[test]
    fn catalog_the_published_test_key_is_the_test_seed() {
        // tests/catalog_format/test-key.json was written by Node's crypto (what v2 signs with)
        // from the same seed the Rust tests use: if the two derived different keys, the
        // signed fixtures would only prove Rust agrees with itself.
        let doc: Value = serde_json::from_str(include_str!("../../tests/catalog_format/test-key.json")).unwrap();
        let pk = doc["keys"][0]["public_key"].as_str().unwrap();
        let mine = ed25519_dalek::SigningKey::from_bytes(&[7u8; 32]).verifying_key();
        assert_eq!(pk, cf::b64_encode(mine.as_bytes()));
        check_key(pk).unwrap();
        assert!(check_key("AAAA").is_err());
    }

    #[test]
    fn catalog_default_output_sits_beside_the_input() {
        let o = default_out("C:/x/feeds/plugins.json");
        assert!(o.replace('\\', "/").ends_with("feeds/plugins.universal.json"), "{o}");
    }

    #[test]
    fn catalog_report_counts_kinds() {
        let n = cf::normalize_text(include_str!("../../tests/catalog_format/universal.json"), &NormalizeOptions::default());
        let r = report(&n);
        assert!(r.ok, "{:?}", r.issues);
        assert_eq!(r.items, 4);
        assert_eq!(r.links, 1);
        assert_eq!(r.kinds.get("plugin"), Some(&1));
    }
}
