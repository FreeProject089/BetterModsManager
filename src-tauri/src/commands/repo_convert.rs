//! « Convert this repo to 1.0 » — the app side of `repo_format`.
//!
//! `repo_format` decides what a manifest is and builds the converted document; this file
//! does what needs the app: it confirms the result loads in the real reader (`ServerRepo`),
//! keeps the old manifest as a backup, re-signs with the user's key, and writes. Shared by
//! the Server Repo page (Tauri commands below), the local API (`POST /api/repo/convert`),
//! and through it the CLI (`bmm repo-convert`) and the MCP tool (`bmm_repo_convert`).

use crate::commands::repo_format::{self, Change, ConvertCounts, FormatInfo, FormatStatus};
use crate::models::repo::ServerRepo;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertArgs {
    /// The repo folder, or the `repo.json` itself.
    pub path: String,
    /// Plan only: nothing is written.
    #[serde(default)]
    pub dry_run: bool,
    /// Re-hash every listed file from the folder. On by default: a conversion is the moment
    /// a manifest is checked against what it describes.
    #[serde(default = "yes")]
    pub rehash: bool,
    /// Sign with this BMM's key. On by default; off writes an unsigned manifest.
    #[serde(default = "yes")]
    pub sign: bool,
}
fn yes() -> bool { true }

/// What the page shows before and after.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertReport {
    pub manifest_path: String,
    pub from: FormatInfo,
    pub from_label: String,
    pub to: String,
    pub dry_run: bool,
    pub up_to_date: bool,
    pub written: bool,
    pub backup_path: Option<String>,
    pub was_signed: bool,
    /// `signed` · `unsigned` · `kept` (already current, untouched).
    pub signature: String,
    /// The original was signed by another key than this BMM's: re-signing changes the
    /// author id subscribers see, and a repo pinned in the official list must be re-pinned.
    pub signer_changes: bool,
    pub author_id: Option<String>,
    pub changes: Vec<Change>,
    pub counts: ConvertCounts,
    pub warnings: Vec<String>,
}

/// The format of a manifest on disk, for the page's badge.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatReport {
    pub manifest_path: String,
    pub info: FormatInfo,
    pub label: String,
    pub current: String,
    pub signed: bool,
}

pub(crate) fn manifest_path(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path.trim());
    if p.as_os_str().is_empty() {
        return Err("repo.convert.errNoPath".into());
    }
    let file = if p.is_dir() { p.join("repo.json") } else { p };
    if !file.is_file() {
        return Err("repo.convert.errNoManifest".into());
    }
    Ok(file)
}

fn read_value(file: &Path) -> Result<serde_json::Value, String> {
    let text = std::fs::read_to_string(file).map_err(|_| "repo.convert.errRead".to_string())?;
    // A BOM from a Windows editor is not a reason to call a manifest invalid.
    serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|_| "repo.convert.errNotJson".to_string())
}

pub fn inspect(path: &str) -> Result<FormatReport, String> {
    let file = manifest_path(path)?;
    let v = read_value(&file)?;
    let info = repo_format::detect(&v);
    Ok(FormatReport {
        manifest_path: file.to_string_lossy().to_string(),
        label: info.label(),
        signed: v.get("signature").is_some_and(|s| !s.is_null()),
        info,
        current: repo_format::CURRENT.to_string(),
    })
}

/// The conversion, with the signer injected — `security::sign_message` in the app, a fixed
/// key in tests. `own_author_id` is this BMM's public key, to say whether the signer changes.
pub fn convert_with(
    args: &ConvertArgs,
    own_author_id: Option<&str>,
    sign: impl Fn(&[u8]) -> Result<(String, String), String>,
) -> Result<ConvertReport, String> {
    let file = manifest_path(&args.path)?;
    let original = read_value(&file)?;
    let dir = file.parent().map(Path::to_path_buf);
    let plan = repo_format::convert(original, if args.rehash { dir.as_deref() } else { None })?;

    // The real reader must accept the result, or the conversion produced a file BMM cannot
    // open — the one outcome worse than not converting.
    let mut repo: ServerRepo = serde_json::from_value(plan.manifest.clone())
        .map_err(|e| format!("repo.convert.errResult:{e}"))?;

    let from_label = plan.from.label();
    let signer_changes = plan.was_signed
        && args.sign
        && match (plan.previous_author_id.as_deref(), own_author_id) {
            (Some(prev), Some(me)) => !prev.eq_ignore_ascii_case(me),
            _ => false,
        };
    let mut report = ConvertReport {
        manifest_path: file.to_string_lossy().to_string(),
        from: plan.from.clone(),
        from_label,
        to: plan.to.to_string(),
        dry_run: args.dry_run,
        up_to_date: plan.up_to_date,
        written: false,
        backup_path: None,
        was_signed: plan.was_signed,
        signature: if plan.up_to_date { "kept".into() } else if args.sign { "signed".into() } else { "unsigned".into() },
        signer_changes,
        author_id: None,
        changes: plan.changes,
        counts: plan.counts,
        warnings: plan.warnings,
    };
    if plan.up_to_date || args.dry_run {
        return Ok(report);
    }

    repo.format_version = Some(repo_format::CURRENT.to_string());
    repo.author_id = None;
    repo.signature = None;
    if args.sign {
        // Same bytes every writer signs and `verify_repo_signature` rebuilds: the compact
        // JSON of the struct with both fields None.
        let payload = serde_json::to_string(&repo).map_err(|e| e.to_string())?;
        let (author_id, signature) = sign(payload.as_bytes())?;
        repo.author_id = Some(author_id.clone());
        repo.signature = Some(signature);
        report.author_id = Some(author_id);
    }

    let now = chrono::Utc::now();
    let backup = file.with_file_name(repo_format::backup_name(&report.from.version, now));
    std::fs::copy(&file, &backup).map_err(|_| "repo.convert.errBackup".to_string())?;
    let out = serde_json::to_string_pretty(&repo).map_err(|e| e.to_string())?;
    // Written to a sibling first, then renamed over: a crash halfway leaves the old manifest,
    // never half of a new one.
    let tmp = file.with_extension("json.converting");
    std::fs::write(&tmp, out).map_err(|_| "repo.errWriteManifest".to_string())?;
    std::fs::rename(&tmp, &file).map_err(|_| "repo.errWriteManifest".to_string())?;

    report.backup_path = Some(backup.to_string_lossy().to_string());
    report.written = true;
    Ok(report)
}

pub fn convert(handle: &tauri::AppHandle, args: &ConvertArgs) -> Result<ConvertReport, String> {
    let own = crate::commands::security::get_creator_id(handle.clone()).ok();
    convert_with(args, own.as_deref(), |bytes| crate::commands::security::sign_message(handle, bytes))
}

/// The registry, for the page's « what changed between formats » table.
#[tauri::command]
pub fn repo_format_registry() -> serde_json::Value {
    serde_json::json!({ "current": repo_format::CURRENT, "formats": repo_format::REGISTRY })
}

#[tauri::command]
pub fn repo_format_inspect(path: String) -> Result<FormatReport, String> {
    inspect(&path)
}

/// Hashing a large repo is long: off the async runtime, like the export.
#[tauri::command]
pub async fn repo_format_convert(handle: tauri::AppHandle, args: ConvertArgs) -> Result<ConvertReport, String> {
    tauri::async_runtime::spawn_blocking(move || convert(&handle, &args))
        .await
        .map_err(|e| e.to_string())?
}

/// For `fetch_repo_info`: read a manifest body the strict struct refuses, if the only thing
/// wrong is its age. `None` = not a legacy manifest either; the caller falls back as before.
pub(crate) fn read_legacy(body: &str) -> Option<ServerRepo> {
    let mut v: serde_json::Value = serde_json::from_str(body.trim_start_matches('\u{feff}')).ok()?;
    let info = repo_format::detect(&v);
    if !matches!(info.status, FormatStatus::NeedsConversion | FormatStatus::Legacy) {
        return None;
    }
    // A SIGNED manifest is not upgraded: filling keys changes the bytes the signature covers,
    // so the upgraded copy would read as tampered. It stays a parse failure, as before.
    if v.get("signature").is_some_and(|s| !s.is_null()) {
        return None;
    }
    let mut ignored = Vec::new();
    repo_format::upgrade_keys(&mut v, &mut ignored);
    serde_json::from_value(v).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    const FIXTURES: [&str; 4] = [
        include_str!("../../tests/repo_format/v0.1-first-export.json"),
        include_str!("../../tests/repo_format/v0.2-signed.json"),
        include_str!("../../tests/repo_format/v0.3-modpacks.json"),
        include_str!("../../tests/repo_format/v0.4-hosting.json"),
    ];

    fn key() -> SigningKey { SigningKey::from_bytes(&[42u8; 32]) }
    fn signer(bytes: &[u8]) -> Result<(String, String), String> {
        let k = key();
        Ok((hex::encode(k.verifying_key().to_bytes()), hex::encode(k.sign(bytes).to_bytes())))
    }

    fn folder_with(manifest: &str) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("repo.json"), manifest).unwrap();
        dir
    }

    fn args(dir: &Path, dry_run: bool) -> ConvertArgs {
        ConvertArgs { path: dir.to_string_lossy().to_string(), dry_run, rehash: true, sign: true }
    }

    /// The round trip the feature exists for: every legacy shape, converted, re-signed,
    /// then read back by the SAME checks a subscriber's sync runs.
    #[test]
    fn every_legacy_shape_converts_then_verifies() {
        for src in FIXTURES {
            let dir = folder_with(src);
            let report = convert_with(&args(dir.path(), false), None, signer).unwrap();
            assert!(report.written, "{report:?}");
            assert_eq!(report.signature, "signed");

            let text = std::fs::read_to_string(dir.path().join("repo.json")).unwrap();
            let back: ServerRepo = serde_json::from_str(&text).expect("the converted file loads");
            assert_eq!(back.format_version.as_deref(), Some(repo_format::CURRENT));
            assert!(crate::commands::security::verify_repo_signature(back.clone()), "and its signature verifies");
            assert_eq!(
                crate::commands::repo::check_repo_signature(&back, None),
                Ok(crate::commands::repo::RepoSignatureState::Valid)
            );
            let again = inspect(&dir.path().to_string_lossy()).unwrap();
            assert_eq!(again.info.status, FormatStatus::Current, "{again:?}");

            // The old manifest is kept, byte for byte, under a name that says what it was.
            let backup = report.backup_path.unwrap();
            assert_eq!(std::fs::read_to_string(&backup).unwrap(), src);
            assert!(backup.contains(&format!("repo.json.v{}-", report.from.version)), "{backup}");
        }
    }

    #[test]
    fn a_dry_run_writes_nothing() {
        let dir = folder_with(FIXTURES[0]);
        let report = convert_with(&args(dir.path(), true), None, signer).unwrap();
        assert!(!report.written && report.backup_path.is_none());
        assert!(!report.changes.is_empty());
        assert_eq!(std::fs::read_to_string(dir.path().join("repo.json")).unwrap(), FIXTURES[0]);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1, "no backup, no temp file");
    }

    #[test]
    fn converting_twice_is_a_no_op_the_second_time() {
        let dir = folder_with(FIXTURES[2]);
        convert_with(&args(dir.path(), false), None, signer).unwrap();
        let first = std::fs::read_to_string(dir.path().join("repo.json")).unwrap();
        let second = convert_with(&args(dir.path(), false), None, signer).unwrap();
        assert!(second.up_to_date, "{:?}", second.changes);
        assert_eq!(second.signature, "kept");
        assert_eq!(std::fs::read_to_string(dir.path().join("repo.json")).unwrap(), first);
    }

    #[test]
    fn unsigned_on_request_and_the_signer_change_is_named() {
        let dir = folder_with(FIXTURES[1]);
        let mut a = args(dir.path(), true);
        let r = convert_with(&a, Some("00"), signer).unwrap();
        assert!(r.was_signed && r.signer_changes, "another key signed 0.2: the author id changes");
        a.dry_run = false;
        a.sign = false;
        let r = convert_with(&a, None, signer).unwrap();
        assert_eq!(r.signature, "unsigned");
        let back: ServerRepo = serde_json::from_str(&std::fs::read_to_string(dir.path().join("repo.json")).unwrap()).unwrap();
        assert!(back.signature.is_none() && back.author_id.is_none());
        assert_eq!(crate::commands::repo::check_repo_signature(&back, None), Ok(crate::commands::repo::RepoSignatureState::Unsigned));
    }

    #[test]
    fn a_legacy_body_is_read_through_the_upgrade_unless_it_is_signed() {
        assert!(serde_json::from_str::<ServerRepo>(FIXTURES[0]).is_err(), "the strict reader refuses 0.1");
        let r = read_legacy(FIXTURES[0]).expect("read through the upgrade");
        assert_eq!(r.profiles[0].mods[0].files[0].sha256_hash, "aa11");
        let mut signed: serde_json::Value = serde_json::from_str(FIXTURES[0]).unwrap();
        signed["signature"] = serde_json::json!("ab");
        assert!(read_legacy(&signed.to_string()).is_none());
    }

    /// Adding the field must not have changed the bytes an old manifest is verified over.
    #[test]
    fn a_legacy_manifest_serialises_without_the_format_key() {
        let r: ServerRepo = serde_json::from_str(FIXTURES[1]).unwrap();
        assert!(!serde_json::to_string(&r).unwrap().contains("format_version"));
    }

    #[test]
    fn a_missing_folder_or_manifest_is_named() {
        assert_eq!(inspect("").unwrap_err(), "repo.convert.errNoPath");
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(inspect(&dir.path().to_string_lossy()).unwrap_err(), "repo.convert.errNoManifest");
    }
}
