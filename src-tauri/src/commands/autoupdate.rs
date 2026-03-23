use serde::Serialize;
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
}

/// Checks GitHub releases API for a newer version.
/// Compares version strings using semver-like logic.
#[tauri::command]
pub async fn check_for_update(app_handle: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let current_version = app_handle.package_info().version.to_string();
    log_line(format!("[UPDATE] Checking for updates (current: v{})", current_version));

    // GitHub API endpoint for latest release
    let url = "https://api.github.com/repos/FreeProject089/BetterModsManager/releases/latest";

    let client = reqwest::Client::builder()
        .user_agent("BetterModManager")
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        if status.as_u16() == 404 {
            return Err("NO_RELEASE".to_string());
        }
        return Err(format!(
            "GitHub API returned status {}",
            status
        ));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("JSON parse error: {}", e))?;

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

    // Try to find the .msi or .exe installer in the release assets
    let download_url = body["assets"]
        .as_array()
        .and_then(|assets| {
            // Prefer .msi, then .exe
            assets
                .iter()
                .find(|a| {
                    a["name"]
                        .as_str()
                        .map(|n| n.ends_with(".msi"))
                        .unwrap_or(false)
                })
                .or_else(|| {
                    assets.iter().find(|a| {
                        a["name"]
                            .as_str()
                            .map(|n| n.ends_with(".exe") || n.ends_with(".zip"))
                            .unwrap_or(false)
                    })
                })
                .and_then(|a| a["browser_download_url"].as_str().map(|s| s.to_string()))
        })
        .unwrap_or_else(|| release_url.clone());

    let has_update = is_newer_version(&tag_name, &current_version);

    Ok(UpdateInfo {
        has_update,
        current_version,
        latest_version: tag_name,
        release_url,
        release_notes,
        download_url,
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
            .args(["/C", "start", "", file_path.to_str().unwrap()])
            .spawn()
            .map_err(|e| format!("Failed to start installer: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(file_path.to_str().unwrap())
            .spawn()
            .map_err(|e| format!("Failed to start installer: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(file_path.to_str().unwrap())
            .spawn()
            .map_err(|e| format!("Failed to start installer: {}", e))?;
    }

    // Exit BMM
    std::process::exit(0);
}
