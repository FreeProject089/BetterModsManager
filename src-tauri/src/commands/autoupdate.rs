use tauri::Manager;
use tauri::Emitter;
use serde::{Serialize, Deserialize};
use crate::commands::crash::log_line;

use std::fs::File;
use std::io::Write;

#[derive(Serialize, Clone)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_url: String,
    pub release_notes: String,
    pub download_url: String,
    /// URL of the incremental update manifest (if present in release assets)
    pub manifest_url: Option<String>,
    /// True when the selected release is a GitHub pre-release.
    pub is_prerelease: bool,
    /// True when the MAJOR version increases (e.g. 0.9.11 -> 1.0.0). Such a jump can change the
    /// bundle id, the data layout and the installer itself, so an in-place incremental patch is
    /// unsafe — the UI must offer only the full installer (run by hand), never "Quick Update".
    pub major_bump: bool,
}

/// A single file entry in the incremental update manifest.
///
/// `Deserialize` is only ever reached through [`SignedBody`], i.e. after the signature over
/// the body that contains it has been checked. No command takes a `ManifestFile` (or a list of
/// them) as an argument.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ManifestFile {
    /// Relative path within the BMM install directory (e.g. "frontend/js/docs/interactive-docs.js")
    pub path: String,
    /// Expected SHA-256 hex digest of the file after update
    pub sha256: String,
    /// Direct download URL for this file
    pub download_url: String,
    /// File size in bytes (informational)
    pub size: u64,
}

/// What `fetch_update_manifest` hands the UI: the verified content, plus the raw document it
/// was read from.
///
/// Deliberately NOT `Deserialize`. It used to be, and `apply_incremental_update` took one as its
/// argument: the UI fetched the manifest, then passed the parsed object back, and Rust wrote
/// whatever `files` that object listed. Anything able to call `invoke` could therefore name the
/// files to write and the hashes to expect. Now the UI passes the object back unchanged and Rust
/// reads ONLY `document` from it ([`ApplyRequest`]), verifying it again from scratch; `version`
/// and `files` here are for display.
#[derive(Serialize, Clone)]
pub struct UpdateManifest {
    pub version: String,
    pub files: Vec<ManifestFile>,
    /// The `update-manifest.json` exactly as downloaded.
    pub document: String,
}

// ── The signed incremental manifest ─────────────────────────────────────────────────────────
//
// Same scheme as BetterInstaller's signed `update.json` (bpkg-core/src/update.rs), with its
// own context string so a signature made for one can never be accepted by the other:
//
//   {
//     "version": "1.2.0", "files": [ … ],            ← copy for BMM builds that predate signing
//     "signed": "{\"app_id\":\"com.bettermm.desktop\",\"version\":\"1.2.0\",\"files\":[…],
//                 \"installers\":[…],\"issued\":\"…Z\",\"expires\":\"…Z\"}",
//     "signature": "<128 hex>"                         ← Ed25519 over CONTEXT ‖ bytes of `signed`
//   }
//
// `signed` is a JSON document carried as a STRING, so the signature covers its exact bytes and
// nothing has to be re-serialised identically on both sides. Only the signed body is read; the
// top-level copy is never trusted. Publisher side: scripts/sign-update-manifest.mjs.

/// Prefix of the signed message. BetterInstaller's is `BetterInstaller update manifest v1\n`.
pub const MANIFEST_SIG_CONTEXT: &[u8] = b"BetterModsManager incremental manifest v1\n";

/// The app a manifest must name — BMM's bundle identifier (tauri.conf.json `identifier`).
pub const MANIFEST_APP_ID: &str = "com.bettermm.desktop";

/// The publisher key, `[security].public_key` of BetterInstaller/examples/bmm/installer.toml.
/// Compiled in on purpose: a key read from a file in the install directory would be replaced by
/// whoever can write there, which is exactly who this check is meant to stop. A test compares it
/// with installer.toml and with the Node signer (tests/sign-update-manifest.test.mjs).
pub const MANIFEST_PUBLIC_KEY_HEX: &str =
    "8e0647c277dd67158d34dd1c10d0a2d97191716dc4f92aebde6d349d1c0f168b";

/// Longest `expires - issued` accepted. The publisher re-signs weekly
/// (.github/workflows/resign-manifests.yml); a host that stops receiving fresh copies — a
/// freeze, or a stalled job — stops being believed after this long.
pub const MANIFEST_MAX_VALIDITY_DAYS: i64 = 7;

/// The signed body. Every field is required (a body missing one is not a manifest), except
/// `installers`, which manifests signed before the full-installer check do not carry.
#[derive(Deserialize)]
struct SignedBody {
    app_id: String,
    version: String,
    files: Vec<ManifestFile>,
    /// The full installers of this release (`path` = the installer's file name), for the
    /// fallback `download_and_install_update`: it runs an installer only when it is listed here
    /// and its bytes have this SHA-256.
    #[serde(default)]
    installers: Vec<ManifestFile>,
    issued: String,
    expires: String,
}

/// What survived verification.
#[derive(Debug, Clone, PartialEq)]
pub struct VerifiedManifest {
    pub version: String,
    pub files: Vec<ManifestFile>,
    pub installers: Vec<ManifestFile>,
}

/// The argument of `apply_incremental_update`. The UI passes back the object
/// `fetch_update_manifest` returned; only its raw `document` is read (unknown fields such as a
/// top-level `files` are ignored by serde), and it is verified again before anything is written.
/// A pre-parsed `{version, files}` has no `document` and does not deserialize.
#[derive(Deserialize)]
pub struct ApplyRequest {
    document: String,
}

fn publisher_key() -> Result<ed25519_dalek::VerifyingKey, String> {
    let bytes = hex::decode(MANIFEST_PUBLIC_KEY_HEX).map_err(|_| "bad built-in key".to_string())?;
    let arr: [u8; 32] = bytes.try_into().map_err(|_| "bad built-in key".to_string())?;
    ed25519_dalek::VerifyingKey::from_bytes(&arr).map_err(|_| "bad built-in key".to_string())
}

/// The first dotted number run in `text` (`v1.2.3-rc1` → [1, 2, 3]), `None` when there is no
/// number at all. A mirror of `bpkg_core::version::extract_version` — BMM does not depend on
/// the BetterInstaller crate, but the two must order versions the same way.
fn extract_version(text: &str) -> Option<Vec<u64>> {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'.') {
                // A trailing dot ends the run rather than joining what follows.
                if bytes[i] == b'.' && (i + 1 >= bytes.len() || !bytes[i + 1].is_ascii_digit()) {
                    break;
                }
                i += 1;
            }
            let parts: Vec<u64> = text[start..i].split('.').filter_map(|x| x.parse().ok()).collect();
            if !parts.is_empty() {
                return Some(parts);
            }
        }
        i += 1;
    }
    None
}

/// Component-wise comparison, a missing component counting as 0 (`1.3` = `1.3.0`).
fn cmp_version(a: &[u64], b: &[u64]) -> std::cmp::Ordering {
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x.cmp(&y);
        }
    }
    std::cmp::Ordering::Equal
}

/// Is `a` strictly newer than `b`? `bpkg_core::version::is_newer`'s rule: `a` with no number is
/// never newer; `b` with no number counts as 0.
pub(crate) fn is_newer(a: &str, b: &str) -> bool {
    let Some(va) = extract_version(a) else { return false };
    let vb = extract_version(b).unwrap_or_default();
    cmp_version(&va, &vb) == std::cmp::Ordering::Greater
}

/// A manifest path is relative and made of plain names only: no `..`, no root, no drive.
fn safe_relative_path(p: &str) -> bool {
    use std::path::Component;
    if p.is_empty() || p.split(|c| c == '/' || c == '\\').any(|seg| seg == ".." || seg == "...") {
        return false;
    }
    std::path::Path::new(p).components().all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
}

fn is_https(url: &str) -> bool {
    reqwest::Url::parse(url).map(|u| u.scheme() == "https" && u.host_str().is_some()).unwrap_or(false)
}

/// Read an `update-manifest.json`, refusing it unless every rule holds:
/// signed by `key` over [`MANIFEST_SIG_CONTEXT`] ‖ `signed`; for [`MANIFEST_APP_ID`];
/// `issued < expires`, `expires - issued <= 7 days`, `now < expires`; a version strictly newer
/// than `current_version`; every file with an https URL, a SHA-256 and a safe relative path.
/// Only the signed body is read.
pub(crate) fn verify_manifest_text(
    text: &str,
    key: &ed25519_dalek::VerifyingKey,
    current_version: &str,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<VerifiedManifest, String> {
    let refuse = |why: String| Err(format!("Update manifest refused: {why}"));
    let doc: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("Update manifest refused: not JSON ({e})"))?;
    let Some(signed) = doc.get("signed").and_then(|s| s.as_str()) else {
        return refuse("it is not signed".into());
    };
    let sig: [u8; 64] = match doc
        .get("signature")
        .and_then(|s| s.as_str())
        .filter(|s| s.len() == 128)
        .and_then(|s| hex::decode(s).ok())
        .and_then(|b| <[u8; 64]>::try_from(b).ok())
    {
        Some(s) => s,
        None => return refuse("the signature is missing or malformed".into()),
    };
    let mut msg = MANIFEST_SIG_CONTEXT.to_vec();
    msg.extend_from_slice(signed.as_bytes());
    if key.verify_strict(&msg, &ed25519_dalek::Signature::from_bytes(&sig)).is_err() {
        return refuse("its signature does not match the publisher key".into());
    }

    let body: SignedBody = serde_json::from_str(signed)
        .map_err(|e| format!("Update manifest refused: the signed part is incomplete ({e})"))?;
    if body.app_id != MANIFEST_APP_ID {
        return refuse(format!("it is for {:?}, not {:?}", body.app_id, MANIFEST_APP_ID));
    }
    let time = |field: &str, v: &str| {
        chrono::DateTime::parse_from_rfc3339(v)
            .map(|t| t.with_timezone(&chrono::Utc))
            .map_err(|_| format!("Update manifest refused: `{field}` is not an RFC 3339 time"))
    };
    let issued = time("issued", &body.issued)?;
    let expires = time("expires", &body.expires)?;
    if expires <= issued || expires - issued > chrono::Duration::days(MANIFEST_MAX_VALIDITY_DAYS) {
        return refuse(format!(
            "it claims to be valid from {issued} to {expires}; the limit is {MANIFEST_MAX_VALIDITY_DAYS} days"
        ));
    }
    if now >= expires {
        return refuse(format!(
            "it expired on {expires} (the publisher re-signs it every week; an expired copy means \
             the host is not serving a current one, or this PC's clock is wrong)"
        ));
    }
    if !is_newer(&body.version, current_version) {
        return refuse(format!(
            "it offers {} and this is {current_version}; only a newer version is applied",
            body.version
        ));
    }
    for f in &body.files {
        if !is_https(&f.download_url) {
            return refuse(format!("{} is not downloaded over https", f.path));
        }
        if !safe_relative_path(&f.path) {
            return refuse(format!("{:?} is not a plain relative path", f.path));
        }
        // Lowercase only: the apply loop compares against `format!("{:x}")`.
        if !is_lower_sha256(&f.sha256) {
            return refuse(format!("{} has no lowercase SHA-256", f.path));
        }
    }
    for f in &body.installers {
        if !is_https(&f.download_url) {
            return refuse(format!("the installer {} is not downloaded over https", f.path));
        }
        if installer_file_name(&f.path).is_none() {
            return refuse(format!("{:?} is not an installer file name (one .exe or .msi name)", f.path));
        }
        if !is_lower_sha256(&f.sha256) {
            return refuse(format!("the installer {} has no lowercase SHA-256", f.path));
        }
    }
    Ok(VerifiedManifest { version: body.version, files: body.files, installers: body.installers })
}

fn is_lower_sha256(h: &str) -> bool {
    h.len() == 64 && h.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// An installer entry's `path` as the file name it is saved under: ONE plain name ending in
/// `.exe` or `.msi`, or `None`. Never the name the UI derived from the URL: that is where a
/// `..\` or a drive used to reach `temp_dir().join(..)`.
pub(crate) fn installer_file_name(path: &str) -> Option<String> {
    let name = crate::fs_utils::safe_folder_name(path)?;
    let lower = name.to_ascii_lowercase();
    (lower.ends_with(".exe") || lower.ends_with(".msi")).then_some(name)
}

/// The installer the signed manifest vouches for at `url`, or why there is none.
///
/// The fallback used to download whatever `url` the UI passed (the release's first `.msi` or
/// `.exe` asset, taken from an unsigned API answer) and run it: no signature, no hash. Whoever
/// could answer for the release feed, or sit on a plain-HTTP hop of it, chose the program BMM
/// launched. Now the URL must be one the publisher signed, with its hash.
pub(crate) fn installer_for<'a>(manifest: &'a VerifiedManifest, url: &str) -> Result<&'a ManifestFile, String> {
    if manifest.installers.is_empty() {
        return Err(format!(
            "Update refused: the signed manifest of v{} lists no installer, so this download cannot be \
             checked. BMM stays on its current version; download the installer from the release page.",
            manifest.version
        ));
    }
    manifest.installers.iter().find(|f| f.download_url == url.trim()).ok_or_else(|| {
        format!(
            "Update refused: {url} is not an installer the signed manifest of v{} vouches for. \
             BMM stays on its current version.",
            manifest.version
        )
    })
}

/// The downloaded installer is the one the manifest names, byte for byte.
pub(crate) fn check_installer_bytes(entry: &ManifestFile, bytes: &[u8]) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    let actual = format!("{:x}", Sha256::digest(bytes));
    if actual != entry.sha256 {
        return Err(format!(
            "Update refused: the downloaded installer {} does not match the signed manifest \
             (expected SHA-256 {}, got {}). It was not run; BMM stays on its current version.",
            entry.path, entry.sha256, actual
        ));
    }
    Ok(())
}

/// Progress event emitted per file during incremental update.
#[derive(Clone, Serialize)]
pub struct IncrementalProgress {
    pub file: String,
    pub index: usize,
    pub total: usize,
    pub status: String, // "downloading" | "verifying" | "applied" | "error"
}

/// Result returned after applying an incremental update.
#[derive(Serialize)]
pub struct IncrementalResult {
    pub applied: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

const DEFAULT_UPDATE_API: &str = "https://api.github.com/repos/FreeProject089/BetterModsManager/releases";

/// The URL to ask for a release list or for the latest one.
///
/// Two feeds are supported and their paths are NOT the same shape, which is the whole reason
/// this function exists rather than a `format!` at each call site:
///
///   GitHub   base = .../repos/OWNER/REPO/releases
///            list = base                      latest = base + "/latest"
///   BCWEB    base = .../api/updates/bmm
///            list = base + "/releases"        latest = base + "/latest"
///
/// `latest` happens to be base + "/latest" on both. The LIST is where a naive swap of one
/// base for the other produces a 404 — and a 404 is read as NO_RELEASE, so the failure would
/// have looked like "you are up to date" rather than like an error.
fn release_url(api_base: &str, include_pre: bool) -> String {
    let base = api_base.trim_end_matches('/');
    if !include_pre {
        return format!("{}/latest", base);
    }
    if base.ends_with("/releases") {
        format!("{}?per_page=20", base)
    } else {
        format!("{}/releases", base)
    }
}

/// Whether a failure against one source is worth trying the next one for.
///
/// A 404 is NOT: it means that feed genuinely has no release, and the fallback almost
/// certainly has none either. Everything else is — and 403/429 is the case this whole
/// mechanism exists for, because GitHub allows 60 unauthenticated API calls per hour PER IP.
/// Behind a shared address (a company, a campus, a CGNAT provider) that budget is spent by
/// other people, and BMM would report a network error for the rest of the hour.
fn worth_retrying(err: &str) -> bool {
    err == "NETWORK_ERROR" || err == "RATE_LIMITED"
}

/// Fetch the release object from ONE source. Errors are the small vocabulary the caller
/// switches on: NETWORK_ERROR, RATE_LIMITED, NO_RELEASE, or a message.
async fn fetch_release(client: &reqwest::Client, api_base: &str, include_pre: bool) -> Result<serde_json::Value, String> {
    let url = release_url(api_base, include_pre);
    let response = client.get(&url).send().await.map_err(|e| {
        log_line(format!("[UPDATE] Network error from {} (skipped): {}", api_base, e));
        "NETWORK_ERROR".to_string()
    })?;
    let status = response.status();
    if !status.is_success() {
        if status.as_u16() == 404 { return Err("NO_RELEASE".to_string()); }
        if status.as_u16() == 403 || status.as_u16() == 429 {
            log_line(format!("[UPDATE] {} rate-limited ({})", api_base, status));
            return Err("RATE_LIMITED".to_string());
        }
        if status.as_u16() >= 500 {
            log_line(format!("[UPDATE] {} returned {} — skipped", api_base, status));
            return Err("NETWORK_ERROR".to_string());
        }
        return Err(format!("Update API returned status {}", status));
    }
    let parsed: serde_json::Value = response.json().await.map_err(|e| format!("JSON parse error: {}", e))?;
    if !include_pre {
        return Ok(parsed);
    }
    // The list form: newest first, and a draft is not something anybody can download.
    let releases = parsed.as_array().cloned().unwrap_or_default();
    match releases.into_iter().find(|r| !r["draft"].as_bool().unwrap_or(false)) {
        Some(r) => Ok(r),
        None => Err("NO_RELEASE".to_string()),
    }
}


/// Checks GitHub releases API for a newer version.
/// Compares version strings using semver-like logic.
#[tauri::command]
pub async fn check_for_update(app_handle: tauri::AppHandle, include_prerelease: Option<bool>, api_base_url: Option<String>, fallback_api_url: Option<String>) -> Result<UpdateInfo, String> {
    let current_version = app_handle.package_info().version.to_string();
    let include_pre = include_prerelease.unwrap_or(false);
    let api_base = api_base_url.as_deref().unwrap_or(DEFAULT_UPDATE_API);
    log_line(format!("[UPDATE] Checking for updates (current: v{}, prerelease: {})", current_version, include_pre));

    let client = reqwest::Client::builder()
        .user_agent("BetterModManager")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    // Primary, then fallback. The release object is the same shape either way — BCWEB
    // deliberately serves the GitHub /releases and /releases/latest shapes so nothing
    // downstream has to know which one answered.
    //
    // Choosing the object: prerelease ON → list, newest first, first non-draft (which may be
    // a pre-release). Prerelease OFF → the "latest" endpoint, which excludes pre-releases.
    let body: serde_json::Value = match fetch_release(&client, api_base, include_pre).await {
        Ok(v) => v,
        Err(e) => {
            let fb = fallback_api_url.as_deref().map(str::trim).filter(|u| !u.is_empty());
            match (worth_retrying(&e), fb) {
                (true, Some(url)) => {
                    log_line(format!("[UPDATE] Primary failed ({}) — trying fallback {}", e, url));
                    // A fallback that also fails reports ITS OWN error, not the primary's: the
                    // last thing tried is the one whose message describes the current state.
                    fetch_release(&client, url, include_pre).await?
                }
                _ => return Err(e),
            }
        }
    };

    let is_prerelease = body["prerelease"].as_bool().unwrap_or(false);

    let tag_name = body["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v')
        .trim_start_matches('V')
        .to_string();

    let release_url = body["html_url"]
        .as_str()
        .unwrap_or("")
        .to_string();

    let release_notes = body["body"]
        .as_str()
        .unwrap_or("")
        .to_string();

    let assets = body["assets"].as_array().cloned().unwrap_or_default();

    // Try to find the .msi or .exe installer in the release assets
    let download_url = assets
        .iter()
        .find(|a| a["name"].as_str().map(|n| n.ends_with(".msi")).unwrap_or(false))
        .or_else(|| assets.iter().find(|a| {
            a["name"].as_str().map(|n| n.ends_with(".exe") || n.ends_with(".zip")).unwrap_or(false)
        }))
        .and_then(|a| a["browser_download_url"].as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| release_url.clone());

    // Look for incremental update manifest (update-manifest.json)
    let manifest_url = assets
        .iter()
        .find(|a| a["name"].as_str().map(|n| n == "update-manifest.json").unwrap_or(false))
        .and_then(|a| a["browser_download_url"].as_str().map(|s| s.to_string()));

    let has_update = is_newer_version(&tag_name, &current_version);
    // The major component of each version (the digits before the first '.'), 0 if unparseable.
    let major = |v: &str| v.trim_start_matches('v').split('.').next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
    let major_bump = major(&tag_name) > major(&current_version);

    Ok(UpdateInfo {
        has_update,
        current_version,
        latest_version: tag_name,
        release_url,
        release_notes,
        download_url,
        manifest_url,
        is_prerelease,
        major_bump,
    })
}

/// Locate the BetterInstaller maintenance binary left next to BMM at install time
/// (`<install>/uninstall.exe` — it handles repair / update / uninstall). `None` when
/// BMM wasn't installed by BetterInstaller (dev/portable run).
#[cfg(windows)]
fn installer_maintenance_exe(app_handle: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    // Install root = parent of the resource dir (where frontend/, Lang/ … live), with a
    // fallback to the running exe's folder.
    let root = app_handle
        .path()
        .resource_dir()
        .ok()
        .and_then(|mut p| {
            p.pop();
            Some(p)
        })
        .or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|e| e.parent().map(|p| p.to_path_buf()))
        })?;
    let exe = root.join("uninstall.exe");
    exe.exists().then_some(exe)
}
#[cfg(not(windows))]
fn installer_maintenance_exe(_app_handle: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    None
}

/// Check for updates *through BetterInstaller* — runs `<install>/uninstall.exe
/// --check-update` and returns its JSON report (`update_available`, `current_version`,
/// `latest_version`, `notes`, `url`, …). Returns `Ok(None)` when BMM wasn't installed by
/// BetterInstaller, so the caller can fall back to the direct GitHub check.
#[tauri::command]
pub fn check_update_via_installer(
    app_handle: tauri::AppHandle,
) -> Result<Option<serde_json::Value>, String> {
    let exe = match installer_maintenance_exe(&app_handle) {
        Some(e) => e,
        None => return Ok(None),
    };
    let out = crate::commands::proc::hidden_command(&exe)
        .arg("--check-update")
        .output()
        .map_err(|e| format!("Failed to run updater: {e}"))?;
    let json: serde_json::Value =
        serde_json::from_slice(&out.stdout).map_err(|e| format!("Bad updater output: {e}"))?;
    log_line(format!("[UPDATE] BetterInstaller check: {json}"));
    Ok(Some(json))
}

/// Apply an update *through BetterInstaller*: spawn `<install>/uninstall.exe --update`
/// (downloads + verifies the signed `.bpkg`, delta when offered, rollback on failure)
/// then exit BMM so its files can be replaced. Errs when not installed by BetterInstaller
/// (the caller falls back to the direct download).
#[tauri::command]
pub fn update_via_installer(app_handle: tauri::AppHandle) -> Result<(), String> {
    let exe = installer_maintenance_exe(&app_handle)
        .ok_or_else(|| "not installed via BetterInstaller".to_string())?;
    log_line(format!("[UPDATE] Launching BetterInstaller updater: {exe:?}"));
    crate::commands::proc::hidden_command(&exe)
        .arg("--update")
        .spawn()
        .map_err(|e| format!("Failed to launch updater: {e}"))?;
    // Give the updater a moment to start, then quit so the install dir unlocks.
    std::thread::sleep(std::time::Duration::from_millis(300));
    std::process::exit(0);
}

/// Returns true if `latest` is strictly newer than `current`.
///
/// The same ordering as the signed manifest's version rule ([`is_newer`]). It used to drop
/// any component that was not a bare number (`1.2.3-rc1` read as `1.2`), so the release check
/// and the manifest check could disagree about the same two strings: the Quick Update button
/// would appear for a release whose manifest is then refused as "not newer", or the reverse.
fn is_newer_version(latest: &str, current: &str) -> bool {
    is_newer(latest, current)
}

/// Largest installer accepted, whatever the manifest says (BMM's is well under 100 MB).
const INSTALLER_MAX_BYTES: u64 = 1024 * 1024 * 1024;

/// The full-installer fallback, for a copy BetterInstaller did not install.
///
/// Runs an installer only when the SIGNED incremental manifest (`manifest_url`, the release's
/// `update-manifest.json`, verified exactly as for a Quick Update: publisher key, app, expiry,
/// newer version) lists `url` among its `installers`, and the downloaded bytes have the SHA-256
/// it gives. Anything else is refused before the file is written, and BMM stays where it is.
/// `filename` is accepted for older callers and ignored: the name comes from the manifest.
#[tauri::command]
pub async fn download_and_install_update(
    app_handle: tauri::AppHandle,
    url: String,
    manifest_url: Option<String>,
    filename: Option<String>,
) -> Result<(), String> {
    let _ = filename;
    log_line(format!("[UPDATE] Full installer requested: {}", url));
    let Some(manifest_url) = manifest_url.as_deref().map(str::trim).filter(|u| !u.is_empty()) else {
        let e = "Update refused: this release publishes no signed update manifest, so its installer \
                 cannot be checked. BMM stays on its current version; download the installer from \
                 the release page.".to_string();
        log_line(format!("[UPDATE] {}", e));
        return Err(e);
    };
    if !is_https(&url) {
        return Err("Update refused: the installer URL is not https. BMM stays on its current version.".to_string());
    }
    let document = fetch_manifest_document(manifest_url).await?;
    let current = app_handle.package_info().version.to_string();
    let manifest = verify_manifest_text(&document, &publisher_key()?, &current, chrono::Utc::now())
        .inspect_err(|e| log_line(format!("[UPDATE] {}", e)))?;
    let entry = installer_for(&manifest, &url).inspect_err(|e| log_line(format!("[UPDATE] {}", e)))?;
    let file_name = installer_file_name(&entry.path).ok_or_else(|| "Update refused: bad installer name".to_string())?;

    log_line(format!("[UPDATE] Downloading v{} installer from: {}", manifest.version, entry.download_url));
    let response = crate::commands::net::client().get(&entry.download_url)
        .header(reqwest::header::USER_AGENT, "BetterModManager")
        .send().await.map_err(|e| format!("Download error: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }
    let mut cap = crate::fs_utils::DownloadCap::with_limit(INSTALLER_MAX_BYTES);
    cap.check_announced(response.content_length())?;
    let bytes = response.bytes().await.map_err(|e| format!("Error reading response bytes: {}", e))?;
    cap.add(bytes.len() as u64)?;
    check_installer_bytes(entry, &bytes).inspect_err(|e| log_line(format!("[UPDATE] {}", e)))?;

    // A folder of our own, new for this download: a fixed name in %TEMP% is one another
    // program can plant or swap between the check and the launch.
    let dir = std::env::temp_dir().join(format!("bmm_update_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create folder: {}", e))?;
    let file_path = dir.join(&file_name);
    log_line(format!("[UPDATE] Installer verified (SHA-256 {}), saving to: {:?}", entry.sha256, file_path));
    let mut file = File::create(&file_path).map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(&bytes).map_err(|e| format!("Failed to write to file: {}", e))?;
    drop(file);

    log_line("[UPDATE] Launching installer and exiting...");

    // Execute installer depending on the OS
    #[cfg(target_os = "windows")]
    {
        // The installer's filename comes from the signed manifest (installer_file_name: one
        // plain .exe/.msi name). open::that never puts it on a command line anyway.
        open::that(file_path.as_os_str())
            .map_err(|e| format!("Failed to start installer: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        crate::commands::proc::hidden_command("open")
            .arg(&file_path.to_string_lossy())
            .spawn()
            .map_err(|e| format!("Failed to start installer: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        crate::commands::proc::hidden_command("xdg-open")
            .arg(&file_path.to_string_lossy())
            .spawn()
            .map_err(|e| format!("Failed to start installer: {}", e))?;
    }

    // Exit BMM
    std::process::exit(0);
}

/// Largest manifest accepted. It lists a handful of files; anything near this is not one.
const MANIFEST_MAX_BYTES: usize = 1024 * 1024;

/// The raw `update-manifest.json` at `url` (https only, size-capped, UTF-8). Not verified:
/// every caller hands it to `verify_manifest_text` next.
async fn fetch_manifest_document(url: &str) -> Result<String, String> {
    if !is_https(url) {
        return Err("Update manifest refused: its URL is not https".to_string());
    }
    let response = crate::commands::net::client().get(url)
        .header(reqwest::header::USER_AGENT, "BetterModManager")
        .timeout(std::time::Duration::from_secs(30))
        .send().await.map_err(|e| format!("Network error: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Manifest fetch failed: {}", response.status()));
    }
    let bytes = response.bytes().await.map_err(|e| format!("Network error: {}", e))?;
    if bytes.len() > MANIFEST_MAX_BYTES {
        return Err("Update manifest refused: too large".to_string());
    }
    String::from_utf8(bytes.to_vec()).map_err(|_| "Update manifest refused: not UTF-8".to_string())
}

/// Fetches the incremental update manifest from the given URL and verifies it
/// ([`verify_manifest_text`]). Returns the verified content for display, plus the raw document
/// that `apply_incremental_update` verifies again.
#[tauri::command]
pub async fn fetch_update_manifest(app_handle: tauri::AppHandle, url: String) -> Result<UpdateManifest, String> {
    log_line(format!("[UPDATE] Fetching incremental manifest from: {}", url));
    let document = fetch_manifest_document(&url).await?;
    let current = app_handle.package_info().version.to_string();
    let verified = verify_manifest_text(&document, &publisher_key()?, &current, chrono::Utc::now())
        .inspect_err(|e| log_line(format!("[UPDATE] {}", e)))?;
    log_line(format!("[UPDATE] Manifest verified: v{}, {} files listed", verified.version, verified.files.len()));
    Ok(UpdateManifest { version: verified.version, files: verified.files, document })
}

/// Applies an incremental update: downloads only changed files and replaces them in-place.
/// Emits `update-progress` events to the window during the process.
///
/// `manifest` is whatever the UI got from `fetch_update_manifest`; only its raw `document` is
/// read, and it is verified again here — signature, app, expiry, version — before any file is
/// downloaded or written. Nothing the UI parsed or edited is trusted.
#[tauri::command]
pub async fn apply_incremental_update(
    app_handle: tauri::AppHandle,
    window: tauri::Window,
    manifest: ApplyRequest,
) -> Result<IncrementalResult, String> {
    use sha2::{Sha256, Digest};

    let current = app_handle.package_info().version.to_string();
    let manifest = verify_manifest_text(&manifest.document, &publisher_key()?, &current, chrono::Utc::now())
        .inspect_err(|e| log_line(format!("[UPDATE] {}", e)))?;

    // Resolve the BMM install root: parent of the resource dir (where frontend/, Lang/, etc. live)
    let install_root = app_handle
        .path()
        .resource_dir().ok()
        .and_then(|mut p| { p.pop(); Some(p) })
        .ok_or_else(|| "Cannot resolve install directory".to_string())?;

    log_line(format!("[UPDATE] Install root: {:?}", install_root));
    log_line(format!("[UPDATE] Starting incremental update: {} files", manifest.files.len()));

    let client = reqwest::Client::builder()
        .user_agent("BetterModManager")
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let temp_dir = std::env::temp_dir().join("bmm_incremental_update");
    std::fs::create_dir_all(&temp_dir).ok();

    let total = manifest.files.len();
    let mut applied = 0usize;
    let mut skipped = 0usize;
    let mut errors: Vec<String> = Vec::new();

    for (index, file_entry) in manifest.files.iter().enumerate() {
        let _ = window.emit("update-progress", IncrementalProgress {
            file: file_entry.path.clone(),
            index,
            total,
            status: "downloading".to_string(),
        });

        // CWE-494/22 (defense-in-depth): the manifest is fetched from GitHub over
        // HTTPS, but treat its contents as data, not trust. Reject any per-file URL
        // that isn't HTTPS (no plain-HTTP swap) and any path that tries to escape the
        // install root via traversal segments before joining/writing.
        if !file_entry.download_url.to_ascii_lowercase().starts_with("https://") {
            let err = format!("Refused (non-HTTPS update URL) for {}", file_entry.path);
            log_line(format!("[UPDATE] {}", err));
            errors.push(err);
            continue;
        }
        if file_entry.path.split(|c| c == '/' || c == '\\').any(|seg| seg == ".." || seg == "...") {
            let err = format!("Refused (path traversal in manifest) for {}", file_entry.path);
            log_line(format!("[UPDATE] {}", err));
            errors.push(err);
            continue;
        }
        let dest_path = install_root.join(&file_entry.path);
        if !dest_path.starts_with(&install_root) {
            let err = format!("Refused (escapes install root) for {}", file_entry.path);
            log_line(format!("[UPDATE] {}", err));
            errors.push(err);
            continue;
        }

        // Check if local file already matches the expected hash (skip if unchanged)
        if dest_path.exists() {
            if let Ok(existing_bytes) = std::fs::read(&dest_path) {
                let mut hasher = Sha256::new();
                hasher.update(&existing_bytes);
                let existing_hash = format!("{:x}", hasher.finalize());
                if existing_hash == file_entry.sha256 {
                    log_line(format!("[UPDATE] Skipping (unchanged): {}", file_entry.path));
                    skipped += 1;
                    let _ = window.emit("update-progress", IncrementalProgress {
                        file: file_entry.path.clone(),
                        index,
                        total,
                        status: "skipped".to_string(),
                    });
                    continue;
                }
            }
        }

        // Download the file
        let download_result = client.get(&file_entry.download_url).send().await;
        let response = match download_result {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                let err = format!("Download failed for {}: HTTP {}", file_entry.path, r.status());
                log_line(format!("[UPDATE] {}", err));
                errors.push(err);
                continue;
            }
            Err(e) => {
                let err = format!("Download error for {}: {}", file_entry.path, e);
                log_line(format!("[UPDATE] {}", err));
                errors.push(err);
                continue;
            }
        };

        let bytes = match response.bytes().await {
            Ok(b) => b,
            Err(e) => {
                let err = format!("Read error for {}: {}", file_entry.path, e);
                errors.push(err);
                continue;
            }
        };

        // Verify SHA256
        let _ = window.emit("update-progress", IncrementalProgress {
            file: file_entry.path.clone(),
            index,
            total,
            status: "verifying".to_string(),
        });

        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let actual_hash = format!("{:x}", hasher.finalize());

        if actual_hash != file_entry.sha256 {
            let err = format!("Hash mismatch for {} — expected {}, got {}", file_entry.path, file_entry.sha256, actual_hash);
            log_line(format!("[UPDATE] {}", err));
            errors.push(err);
            continue;
        }

        // Write to temp first, then move atomically
        let temp_file = temp_dir.join(format!("{}.tmp", index));
        if let Err(e) = std::fs::write(&temp_file, &bytes) {
            errors.push(format!("Write temp error for {}: {}", file_entry.path, e));
            continue;
        }

        // Ensure destination directory exists
        if let Some(parent) = dest_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }

        if let Err(e) = std::fs::rename(&temp_file, &dest_path) {
            // rename may fail across drives — fall back to copy+delete
            if let Err(e2) = std::fs::copy(&temp_file, &dest_path) {
                errors.push(format!("Apply error for {}: {} / {}", file_entry.path, e, e2));
                continue;
            }
            std::fs::remove_file(&temp_file).ok();
        }

        log_line(format!("[UPDATE] Applied: {}", file_entry.path));
        applied += 1;
        let _ = window.emit("update-progress", IncrementalProgress {
            file: file_entry.path.clone(),
            index,
            total,
            status: "applied".to_string(),
        });
    }

    // Clean up temp dir
    std::fs::remove_dir_all(&temp_dir).ok();

    log_line(format!("[UPDATE] Incremental update complete — applied: {}, skipped: {}, errors: {}", applied, skipped, errors.len()));

    Ok(IncrementalResult { applied, skipped, errors })
}

#[cfg(test)]
#[path = "autoupdate_manifest_tests.rs"]
mod manifest_tests;
