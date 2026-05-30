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

/// Checks GitHub releases API for a newer version.
/// Compares version strings using semver-like logic.
#[tauri::command]
pub async fn check_for_update(app_handle: tauri::AppHandle, include_prerelease: Option<bool>, api_base_url: Option<String>) -> Result<UpdateInfo, String> {
    let current_version = app_handle.package_info().version.to_string();
    let include_pre = include_prerelease.unwrap_or(false);
    let api_base = api_base_url.as_deref().unwrap_or(DEFAULT_UPDATE_API);
    log_line(format!("[UPDATE] Checking for updates (current: v{}, prerelease: {})", current_version, include_pre));

    let client = reqwest::Client::builder()
        .user_agent("BetterModManager")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    // Choose the release object to inspect:
    //  - prerelease ON  → list releases (newest first) and take the first
    //    non-draft one, which may be a pre-release.
    //  - prerelease OFF → use /releases/latest (GitHub excludes pre-releases).
    let body: serde_json::Value = if include_pre {
        let url = format!("{}?per_page=20", api_base);
        let response = client.get(&url).send().await.map_err(|e| {
            log_line(format!("[UPDATE] Network error (skipped): {}", e));
            "NETWORK_ERROR".to_string()
        })?;
        let status = response.status();
        if !status.is_success() {
            if status.as_u16() == 404 { return Err("NO_RELEASE".to_string()); }
            if status.as_u16() >= 500 { return Err("NETWORK_ERROR".to_string()); }
            return Err(format!("GitHub API returned status {}", status));
        }
        let arr: serde_json::Value = response.json().await.map_err(|e| format!("JSON parse error: {}", e))?;
        let releases = arr.as_array().cloned().unwrap_or_default();
        match releases.into_iter().find(|r| !r["draft"].as_bool().unwrap_or(false)) {
            Some(r) => r,
            None => return Err("NO_RELEASE".to_string()),
        }
    } else {
        let url = format!("{}/latest", api_base);
        let response = client.get(&url).send().await.map_err(|e| {
            log_line(format!("[UPDATE] Network error (skipped): {}", e));
            "NETWORK_ERROR".to_string()
        })?;
        let status = response.status();
        if !status.is_success() {
            if status.as_u16() == 404 { return Err("NO_RELEASE".to_string()); }
            if status.as_u16() >= 500 {
                log_line(format!("[UPDATE] GitHub returned {} — skipped", status));
                return Err("NETWORK_ERROR".to_string());
            }
            return Err(format!("GitHub API returned status {}", status));
        }
        response.json().await.map_err(|e| format!("JSON parse error: {}", e))?
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
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &file_path.to_string_lossy()])
            .spawn()
            .map_err(|e| format!("Failed to start installer: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&file_path.to_string_lossy())
            .spawn()
            .map_err(|e| format!("Failed to start installer: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
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
    let client = reqwest::Client::builder()
        .user_agent("BetterModManager")
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let response = client.get(&url).send().await.map_err(|e| format!("Network error: {}", e))?;
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
        .path_resolver()
        .resource_dir()
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

        let dest_path = install_root.join(&file_entry.path);

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
