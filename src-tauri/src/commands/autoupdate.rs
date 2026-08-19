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
}

/// A single file entry in the incremental update manifest.
#[derive(Serialize, Deserialize, Clone)]
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

/// The incremental update manifest — published as a release asset named `update-manifest.json`.
#[derive(Serialize, Deserialize, Clone)]
pub struct UpdateManifest {
    pub version: String,
    pub files: Vec<ManifestFile>,
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

    Ok(UpdateInfo {
        has_update,
        current_version,
        latest_version: tag_name,
        release_url,
        release_notes,
        download_url,
        manifest_url,
        is_prerelease,
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

/// Compares two semver-like version strings (e.g., "1.0.9" > "1.0.8").
/// Returns true if `latest` is strictly newer than `current`.
fn is_newer_version(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> {
        v.split('.')
            .filter_map(|s| s.parse::<u32>().ok())
            .collect()
    };

    let latest_parts = parse(latest);
    let current_parts = parse(current);

    for i in 0..std::cmp::max(latest_parts.len(), current_parts.len()) {
        let l = latest_parts.get(i).copied().unwrap_or(0);
        let c = current_parts.get(i).copied().unwrap_or(0);
        if l > c {
            return true;
        }
        if l < c {
            return false;
        }
    }
    false
}

#[tauri::command]
pub async fn download_and_install_update(url: String, filename: String) -> Result<(), String> {
    log_line(format!("[UPDATE] Downloading update installer from: {}", url));
    
    // Choose temp directory
    let temp_dir = std::env::temp_dir();
    let file_path = temp_dir.join(&filename);

    let client = reqwest::Client::new();
    let response = client.get(&url).send().await.map_err(|e| format!("Download error: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }

    let bytes = response.bytes().await.map_err(|e| format!("Error reading response bytes: {}", e))?;
    
    log_line(format!("[UPDATE] Saving installer to: {:?}", file_path));
    let mut file = File::create(&file_path).map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(&bytes).map_err(|e| format!("Failed to write to file: {}", e))?;

    log_line("[UPDATE] Launching installer and exiting...");

    // Execute installer depending on the OS
    #[cfg(target_os = "windows")]
    {
        crate::commands::proc::hidden_command("cmd")
            .args(["/C", "start", "", &file_path.to_string_lossy()])
            .spawn()
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

/// Fetches and parses the incremental update manifest from the given URL.
#[tauri::command]
pub async fn fetch_update_manifest(url: String) -> Result<UpdateManifest, String> {
    log_line(format!("[UPDATE] Fetching incremental manifest from: {}", url));
    let response = crate::commands::net::client().get(&url)
        .header(reqwest::header::USER_AGENT, "BetterModManager")
        .send().await.map_err(|e| format!("Network error: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Manifest fetch failed: {}", response.status()));
    }

    let manifest: UpdateManifest = response.json().await.map_err(|e| format!("JSON parse error: {}", e))?;
    log_line(format!("[UPDATE] Manifest loaded: {} files listed", manifest.files.len()));
    Ok(manifest)
}

/// Applies an incremental update: downloads only changed files and replaces them in-place.
/// Emits `update-progress` events to the window during the process.
#[tauri::command]
pub async fn apply_incremental_update(
    app_handle: tauri::AppHandle,
    window: tauri::Window,
    manifest: UpdateManifest,
) -> Result<IncrementalResult, String> {
    use sha2::{Sha256, Digest};

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
