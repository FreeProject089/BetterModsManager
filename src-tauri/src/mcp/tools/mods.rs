//! MCP Tools — Mod management (read-only)

#![allow(dead_code)]
use crate::mcp::state_bridge;
use serde::Serialize;

/// Compact mod summary for listings
#[derive(Debug, Serialize)]
pub struct ModSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub enabled: bool,
    pub status: String,
    pub tags: Vec<String>,
    pub conflict_count: usize,
    pub has_active_conflicts: bool,
    pub folder_path: String,
    pub added_at: String,
}

/// Full mod details
#[derive(Debug, Serialize)]
pub struct ModDetails {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub description: Option<String>,
    pub enabled: bool,
    pub status: String,
    pub tags: Vec<String>,
    pub dependencies: Vec<String>,
    pub download_links: Vec<LinkInfo>,
    pub conflicts: Vec<ConflictInfo>,
    pub installed_files: Vec<String>,
    pub installed_file_count: usize,
    pub folder_path: String,
    pub activation_order: u32,
    pub added_at: String,
    pub install_notes: String,
}

#[derive(Debug, Serialize)]
pub struct LinkInfo {
    pub url: String,
    pub link_type: String,
    pub label: String,
}

#[derive(Debug, Serialize)]
pub struct ConflictInfo {
    pub category: String,
    pub status: String,
    pub other_mod_id: String,
    pub other_mod_name: String,
    pub other_profile_name: String,
    pub file_count: usize,
}

fn status_to_string(s: &state_bridge::ModStatus) -> String {
    match s {
        state_bridge::ModStatus::Enabled => "enabled".to_string(),
        state_bridge::ModStatus::Disabled => "disabled".to_string(),
        state_bridge::ModStatus::Error(e) => format!("error: {}", e),
    }
}

/// List mods, optionally filtered by profile and/or status
pub fn list_mods(profile_id: Option<&str>, filter: Option<&str>) -> Result<Vec<ModSummary>, String> {
    let data = state_bridge::read_app_data()
        .map_err(|e| format!("Failed to read BMM data: {}", e))?;

    // Find profile's mods_path if filtering by profile
    let profile_mods_path = if let Some(pid) = profile_id {
        let profile = data.profiles.iter()
            .find(|p| p.id == pid || p.name.eq_ignore_ascii_case(pid))
            .ok_or_else(|| format!("Profile '{}' not found", pid))?;
        Some(profile.mods_path.clone())
    } else {
        None
    };

    let mods: Vec<ModSummary> = data.mods.iter()
        .filter(|m| {
            // Filter by profile
            if let Some(ref mods_path) = profile_mods_path {
                if !m.mod_folder_path.starts_with(mods_path) {
                    return false;
                }
            }
            // Filter by status
            match filter {
                Some("enabled") => m.enabled,
                Some("disabled") => !m.enabled,
                _ => true,
            }
        })
        .map(|m| {
            let active_conflicts = m.conflicts.iter()
                .filter(|c| c.status == state_bridge::ConflictStatus::Active)
                .count();

            ModSummary {
                id: m.id.clone(),
                name: m.name.clone(),
                version: m.version.clone(),
                author: m.author.clone(),
                enabled: m.enabled,
                status: status_to_string(&m.status),
                tags: m.tags.clone(),
                conflict_count: m.conflicts.len(),
                has_active_conflicts: active_conflicts > 0,
                folder_path: m.mod_folder_path.to_string_lossy().to_string(),
                added_at: m.added_at.clone(),
            }
        })
        .collect();

    Ok(mods)
}

/// Get detailed information about a specific mod
pub fn get_mod_details(mod_id: &str) -> Result<ModDetails, String> {
    let data = state_bridge::read_app_data()
        .map_err(|e| format!("Failed to read BMM data: {}", e))?;

    let m = data.mods.iter()
        .find(|m| m.id == mod_id || m.name.eq_ignore_ascii_case(mod_id))
        .ok_or_else(|| format!("Mod '{}' not found", mod_id))?;

    Ok(ModDetails {
        id: m.id.clone(),
        name: m.name.clone(),
        version: m.version.clone(),
        author: m.author.clone(),
        description: m.description.clone(),
        enabled: m.enabled,
        status: status_to_string(&m.status),
        tags: m.tags.clone(),
        dependencies: m.dependencies.clone(),
        download_links: m.download_links.iter().map(|l| LinkInfo {
            url: l.url.clone(),
            link_type: l.link_type.clone(),
            label: l.label.clone(),
        }).collect(),
        conflicts: m.conflicts.iter().map(|c| ConflictInfo {
            category: format!("{:?}", c.category),
            status: format!("{:?}", c.status),
            other_mod_id: c.other_mod_id.clone(),
            other_mod_name: c.other_mod_name.clone(),
            other_profile_name: c.other_profile_name.clone(),
            file_count: c.file_count,
        }).collect(),
        installed_files: m.installed_files.clone(),
        installed_file_count: m.installed_files.len(),
        folder_path: m.mod_folder_path.to_string_lossy().to_string(),
        activation_order: m.activation_order,
        added_at: m.added_at.clone(),
        install_notes: m.install_notes.clone(),
    })
}

/// Search mods by name, tag, or author
pub fn search_mods(query: &str) -> Result<Vec<ModSummary>, String> {
    let data = state_bridge::read_app_data()
        .map_err(|e| format!("Failed to read BMM data: {}", e))?;

    let query_lower = query.to_lowercase();

    let mods: Vec<ModSummary> = data.mods.iter()
        .filter(|m| {
            m.name.to_lowercase().contains(&query_lower)
                || m.author.as_deref().unwrap_or("").to_lowercase().contains(&query_lower)
                || m.tags.iter().any(|t| t.to_lowercase().contains(&query_lower))
                || m.description.as_deref().unwrap_or("").to_lowercase().contains(&query_lower)
        })
        .map(|m| {
            let active_conflicts = m.conflicts.iter()
                .filter(|c| c.status == state_bridge::ConflictStatus::Active)
                .count();

            ModSummary {
                id: m.id.clone(),
                name: m.name.clone(),
                version: m.version.clone(),
                author: m.author.clone(),
                enabled: m.enabled,
                status: status_to_string(&m.status),
                tags: m.tags.clone(),
                conflict_count: m.conflicts.len(),
                has_active_conflicts: active_conflicts > 0,
                folder_path: m.mod_folder_path.to_string_lossy().to_string(),
                added_at: m.added_at.clone(),
            }
        })
        .collect();

    Ok(mods)
}

/// Enable or disable a mod
pub fn set_mod_enabled(mod_id: &str, enabled: bool) -> Result<String, String> {
    let mut data = state_bridge::read_app_data()
        .map_err(|e| format!("Failed to read BMM data: {}", e))?;

    let mod_entry = data.mods.iter_mut()
        .find(|m| m.id == mod_id || m.name.eq_ignore_ascii_case(mod_id))
        .ok_or_else(|| format!("Mod '{}' not found", mod_id))?;

    mod_entry.enabled = enabled;
    mod_entry.status = if enabled { state_bridge::ModStatus::Enabled } else { state_bridge::ModStatus::Disabled };

    // Also update active profile's mod list if necessary
    if let Some(active_id) = &data.active_profile_id {
        if let Some(profile) = data.profiles.iter_mut().find(|p| &p.id == active_id) {
            if enabled {
                if !profile.active_mods.contains(&mod_entry.id) {
                    profile.active_mods.push(mod_entry.id.clone());
                }
            } else {
                profile.active_mods.retain(|id| id != &mod_entry.id);
            }
        }
    }

    state_bridge::write_app_data(&data)
        .map_err(|e| format!("Failed to save changes: {}", e))?;

    Ok(format!("Mod '{}' is now {}", mod_id, if enabled { "enabled" } else { "disabled" }))
}

/// Update specific fields of a mod configuration
pub fn update_mod_config(mod_id: &str, updates: serde_json::Value) -> Result<String, String> {
    let mut data = state_bridge::read_app_data()
        .map_err(|e| format!("Failed to read BMM data: {}", e))?;

    let mod_entry = data.mods.iter_mut()
        .find(|m| m.id == mod_id || m.name.eq_ignore_ascii_case(mod_id))
        .ok_or_else(|| format!("Mod '{}' not found", mod_id))?;

    if let Some(desc) = updates.get("description").and_then(|v| v.as_str()) {
        mod_entry.description = Some(desc.to_string());
    }
    if let Some(path) = updates.get("mod_folder_path").and_then(|v| v.as_str()) {
        mod_entry.mod_folder_path = std::path::PathBuf::from(path);
    }
    if let Some(notes) = updates.get("install_notes").and_then(|v| v.as_str()) {
        mod_entry.install_notes = notes.to_string();
    }
    if let Some(files) = updates.get("installed_files").and_then(|v| v.as_array()) {
        mod_entry.installed_files = files.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect();
    }

    state_bridge::write_app_data(&data)
        .map_err(|e| format!("Failed to save changes: {}", e))?;

    Ok(format!("Configuration updated for mod '{}'", mod_id))
}

/// List files in a directory for the AI to explore mod contents
pub fn list_files(path: &str) -> Result<Vec<std::collections::HashMap<String, String>>, String> {
    state_bridge::list_directory(path).map_err(|e| e.to_string())
}

/// Read a text file (README, config)
pub fn read_file(path: &str) -> Result<String, String> {
    state_bridge::read_text_file(path).map_err(|e| e.to_string())
}
/// Sync the active profile's physical files
pub fn sync_active_profile() -> Result<String, String> {
    let data = state_bridge::read_app_data()
        .map_err(|e| format!("Failed to read BMM data: {}", e))?;
    
    let active_id = data.active_profile_id.ok_or("No active profile set")?;
    
    state_bridge::sync_profile(&active_id)
        .map_err(|e| format!("Sync failed: {}", e))
}
/// Delete a mod
pub fn delete_mod(mod_id: &str, delete_files: bool) -> Result<String, String> {
    state_bridge::delete_mod(mod_id, delete_files).map_err(|e| e.to_string())
}

/// Create a directory (for complex installs)
pub fn create_directory(path: &str) -> Result<String, String> {
    state_bridge::create_directory(path).map_err(|e| e.to_string())
}

/// Verify integrity of a mod
pub fn verify_integrity(mod_id: &str) -> Result<std::collections::HashMap<String, bool>, String> {
    state_bridge::verify_integrity(mod_id).map_err(|e| e.to_string())
}

/// Create a modpack
pub fn create_modpack(name: &str, mod_ids: Vec<String>) -> Result<String, String> {
    state_bridge::create_modpack(name, mod_ids).map_err(|e| e.to_string())
}

/// Add a new mod entry manually (used by AI after downloading/unzipping)
pub fn add_mod_entry(name: &str, folder_path: &str, version: &str) -> Result<String, String> {
    let mut data = state_bridge::read_app_data().map_err(|e| e.to_string())?;
    
    let entry = state_bridge::BmmModEntry {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.to_string(),
        version: version.to_string(),
        author: Some("AI Installed".to_string()),
        description: Some("Mod installed and configured via AI Assistant".to_string()),
        dependencies: Vec::new(),
        enabled: false,
        conflicts: Vec::new(),
        mod_folder_path: std::path::PathBuf::from(folder_path),
        status: state_bridge::ModStatus::Disabled,
        added_at: chrono::Local::now().to_rfc3339(),
        installed_files: Vec::new(),
        download_links: Vec::new(),
        tags: vec!["AI".to_string()],
        install_notes: String::new(),
        activation_order: 0,
        cached_files: None,
        last_scan_mtime: 0,
        file_hashes: None,
    };
    
    data.mods.push(entry);
    state_bridge::write_app_data(&data).map_err(|e| e.to_string())?;
    
    Ok(format!("Mod '{}' registered in BMM", name))
}

/// Clone a repository into the active mods folder
pub fn clone_repository(url: &str, folder_name: Option<&str>) -> Result<String, String> {
    let mods_path = state_bridge::get_active_mods_path().map_err(|e| e.to_string())?;
    
    // Determine folder name from URL if not provided
    let name = folder_name.map(|s| s.to_string()).unwrap_or_else(|| {
        url.split('/').last().unwrap_or("cloned_mod").trim_end_matches(".git").to_string()
    });
    
    let target_dir = mods_path.join(&name);
    
    let output = std::process::Command::new("git")
        .arg("clone")
        .arg(url)
        .arg(&target_dir)
        .output()
        .map_err(|e| format!("Failed to execute git clone: {}", e))?;
    
    if !output.status.success() {
        return Err(format!("Git clone failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    
    Ok(format!("Successfully cloned {} to {:?}", url, target_dir))
}


/// Read documentation file
pub fn read_documentation(name: &str) -> Result<String, String> {
    state_bridge::read_documentation(name).map_err(|e| e.to_string())
}

/// List available documentation files
pub fn get_documentation_list() -> Result<Vec<String>, String> {
    let base_path = match state_bridge::get_docs_base_path() {
        Ok(p) => p,
        Err(e) => return Err(e.to_string()),
    };
    let mut docs = Vec::new();
    if let Ok(entries) = std::fs::read_dir(base_path) {
        for entry in entries.flatten() {
            if entry.path().is_file() && entry.path().extension().and_then(|s| s.to_str()) == Some("md") {
                docs.push(entry.file_name().to_string_lossy().to_string());
            }
        }
    }
    Ok(docs)
}

/// Export configuration
pub fn export_config(path: &str) -> Result<String, String> {
    state_bridge::export_config(path).map_err(|e| e.to_string())
}

/// Generate diagnostic report
pub fn generate_betahub_report(title: &str, description: &str) -> Result<serde_json::Value, String> {
    state_bridge::generate_betahub_report(title, description).map_err(|e| e.to_string())
}

/// List available languages
pub fn generate_repo(name: &str, mod_ids: Vec<String>) -> Result<String, String> {
    state_bridge::generate_repo(name, mod_ids).map_err(|e| e.to_string())
}

pub fn start_repo_server(path: &str, port: u16) -> Result<String, String> {
    use warp::Filter;
    use std::net::SocketAddr;
    use local_ip_address::local_ip;
    use tokio::process::Command;
    use std::process::Stdio;
    use tokio::io::{BufReader, AsyncBufReadExt};

    let serve_dir = std::path::PathBuf::from(path);
    if !serve_dir.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    let manifest_path = serve_dir.join("repo.json");
    if !manifest_path.exists() {
        return Err("repo.json not found in the specified path. Generate it first.".to_string());
    }

    let addr: SocketAddr = ([0, 0, 0, 0], port).into();
    
    // Check if port is available
    if let Err(e) = std::net::TcpListener::bind(addr) {
        return Err(format!("Port {} is already in use: {}", port, e));
    }

    let routes = warp::fs::dir(serve_dir.clone())
        .with(warp::cors().allow_any_origin().allow_methods(vec!["GET"]));

    // Spawn the server in a background task
    tokio::spawn(async move {
        warp::serve(routes).run(addr).await;
    });

    let my_ip = local_ip().map(|ip| ip.to_string()).unwrap_or_else(|_| "127.0.0.1".to_string());
    let lan_url = format!("http://{}:{}/repo.json", my_ip, port);
    
    // --- Cloudflare Tunnel Logic ---
    let mut tunnel_msg = "\n[Tunnel] Initializing Cloudflare Tunnel...".to_string();
    
    // We try to find cloudflared.exe in the AppData/bin folder
    let data_dir = state_bridge::get_bmm_data_dir();
    let cf_path = data_dir.join("bin").join("cloudflared.exe");

    if cf_path.exists() {
        let target_url = format!("http://127.0.0.1:{}", port);
        
        // Spawn cloudflared
        let mut child = Command::new(cf_path)
            .args(["tunnel", "--no-autoupdate", "--protocol", "http2", "--url", &target_url])
            .stderr(Stdio::piped())
            .stdout(Stdio::null())
            .spawn()
            .map_err(|e| format!("Tunnel launch error: {}", e))?;

        if let Some(stderr) = child.stderr.take() {
            let mut reader = BufReader::new(stderr).lines();
            let (tx, rx) = std::sync::mpsc::channel();
            
            // We need to capture the URL from stderr in a separate task
            tokio::spawn(async move {
                let re = regex::Regex::new(r"https://[a-zA-Z0-9.-]+\.trycloudflare\.com").unwrap();
                let mut found = false;
                while let Ok(Some(line)) = reader.next_line().await {
                    if !found {
                        if let Some(mat) = re.find(&line) {
                            let _ = tx.send(mat.as_str().to_string());
                            found = true;
                        }
                    }
                }
            });
            
            if let Ok(url) = rx.recv_timeout(std::time::Duration::from_secs(15)) {
                tunnel_msg = format!("\n[Tunnel] Cloudflare Tunnel connected!\nPublic Link: {}/repo.json", url);
            } else {
                tunnel_msg = "\n[Tunnel] Cloudflare Tunnel started, but timed out waiting for the public URL.".to_string();
            }
        }
    } else {
        tunnel_msg = "\n[Tunnel] cloudflared.exe not found in AppData/bin. Please install it via BMM UI first to enable public tunneling.".to_string();
    }

    Ok(format!("Repository server started successfully at:\n{}\n\nLocal Link: {}\n{}", serve_dir.display(), lan_url, tunnel_msg))
}

/// List available languages
pub fn get_language_list() -> Result<Vec<String>, String> {
    state_bridge::get_language_list().map_err(|e| e.to_string())
}

/// Read a language file
pub fn read_language_file(lang_code: &str) -> Result<String, String> {
    state_bridge::read_language_file(lang_code).map_err(|e| e.to_string())
}

pub fn generate_lightweight_server(
    repo_path: &str,
    port: u16,
    auto_start: bool,
    use_cloudflare: bool,
    use_upnp: bool,
    upload_limit: u32,
    server_version: u8,
    admin_password: &str,
    enable_docker: bool,
    docker_host_type: &str,
) -> Result<String, String> {
    state_bridge::generate_lightweight_server(
        repo_path, port, auto_start, use_cloudflare, use_upnp, upload_limit, server_version, admin_password, enable_docker, docker_host_type
    ).map_err(|e| e.to_string())
}
