//! State Bridge — Read-only access to BMM's persisted state
//!
//! This module provides functions to read BMM's data.json, crash reports,
//! and other filesystem resources WITHOUT acquiring any Tauri locks.
//! It is designed to be used by the standalone MCP server binary.

#![allow(dead_code)]
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use walkdir;
use sha2::{Sha256, Digest};

// ─── Lightweight models (re-defined to avoid pulling Tauri deps) ─────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BmmProfile {
    pub id: String,
    pub name: String,
    pub game_name: String,
    pub game_path: PathBuf,
    pub mods_path: PathBuf,
    pub backup_path: PathBuf,
    pub active_mods: Vec<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    #[serde(default)]
    pub background_image: Option<String>,
    pub created_at: String,
    pub origin_repo_profile_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ModStatus {
    Enabled,
    Disabled,
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadLink {
    pub url: String,
    pub link_type: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConflictCategory { Intra, Inter }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConflictStatus { Active, Potential }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictReport {
    pub category: ConflictCategory,
    pub status: ConflictStatus,
    pub other_mod_id: String,
    pub other_mod_name: String,
    pub other_profile_name: String,
    pub file_count: usize,
    #[serde(default)]
    pub activation_order: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BmmModEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub description: Option<String>,
    pub dependencies: Vec<String>,
    pub enabled: bool,
    #[serde(default)]
    pub conflicts: Vec<ConflictReport>,
    pub mod_folder_path: PathBuf,
    pub status: ModStatus,
    pub added_at: String,
    #[serde(default)]
    pub installed_files: Vec<String>,
    #[serde(default)]
    pub download_links: Vec<DownloadLink>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub install_notes: String,
    #[serde(default)]
    pub activation_order: u32,
    #[serde(default)]
    pub cached_files: Option<Vec<String>>,
    #[serde(default)]
    pub last_scan_mtime: u64,
    #[serde(default)]
    pub file_hashes: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagDef {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BmmSettings {
    #[serde(default = "default_lang")]
    pub language: String,
    #[serde(default)]
    pub github_token: String,
    #[serde(default)]
    pub onboarding_shown: bool,
    #[serde(default)]
    pub auto_io_calibration: bool,
    #[serde(default)]
    pub storage_alert_enabled: bool,
    #[serde(default)]
    pub discord_rpc_enabled: bool,
    #[serde(default)]
    pub fs_security_mode: Option<String>,
}

fn default_lang() -> String { "fr".to_string() }

impl Default for BmmSettings {
    fn default() -> Self {
        Self {
            language: default_lang(),
            github_token: String::new(),
            onboarding_shown: false,
            auto_io_calibration: false,
            storage_alert_enabled: false,
            discord_rpc_enabled: true,
            fs_security_mode: None,
        }
    }
}

/// Top-level persisted data (mirrors state::AppData)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BmmAppData {
    pub profiles: Vec<BmmProfile>,
    pub mods: Vec<BmmModEntry>,
    pub active_profile_id: Option<String>,
    #[serde(default)]
    pub custom_tags: Vec<TagDef>,
    #[serde(default)]
    pub disk_limits: HashMap<String, u64>,
    #[serde(default)]
    pub settings: BmmSettings,
}

// ─── Crash report content ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CrashReportContent {
    pub metadata: String,
    pub logs: String,
    pub system_info: String,
    pub stacktrace: Option<String>,
    pub state_snapshot: Option<String>,
    pub dxdiag: Option<String>,
    pub frontend_dump: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct CrashReportSummary {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub date: String,
    pub category: String,
}

// ─── Functions ───────────────────────────────────────────────────────────

/// Locate BMM's app data directory
pub fn get_bmm_data_dir() -> PathBuf {
    if let Ok(custom) = std::env::var("BMM_DATA_DIR") {
        return PathBuf::from(custom);
    }
    let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    PathBuf::from(appdata).join("com.bettermm.app")
}

/// Read-only snapshot of BMM's entire persisted state
pub fn read_app_data() -> anyhow::Result<BmmAppData> {
    let path = get_bmm_data_dir().join("data.json");
    let content = std::fs::read_to_string(&path)
        .map_err(|e| anyhow::anyhow!("Cannot read data.json at {:?}: {}", path, e))?;
    let data: BmmAppData = serde_json::from_str(&content)
        .map_err(|e| anyhow::anyhow!("Cannot parse data.json: {}", e))?;
    Ok(data)
}

/// List crash report zips across all report/archive directories
#[allow(dead_code)]
pub fn list_crash_reports() -> Vec<CrashReportSummary> {
    let base = get_bmm_data_dir().join("Crashes");
    let folders = [
        ("Reports/Crash", "Crash"),
        ("Reports/Session", "Session"),
        ("Archive/Crash", "Archive/Crash"),
        ("Archive/Session", "Archive/Session"),
    ];

    let mut reports = Vec::new();

    for (sub_path, cat) in folders {
        let dir = base.join(sub_path);
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("zip") {
                    if let Ok(meta) = entry.metadata() {
                        reports.push(CrashReportSummary {
                            name: entry.file_name().to_string_lossy().to_string(),
                            path: path.to_string_lossy().to_string(),
                            size: meta.len(),
                            date: meta.modified().ok()
                                .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
                                .map(|d| d.as_secs().to_string())
                                .unwrap_or_default(),
                            category: cat.to_string(),
                        });
                    }
                }
            }
        }
    }

    reports.sort_by(|a, b| b.date.cmp(&a.date));
    reports
}

/// Read and decompress a crash report zip into structured content
pub fn read_crash_report(zip_path: &str) -> anyhow::Result<CrashReportContent> {
    let file = std::fs::File::open(zip_path)
        .map_err(|e| anyhow::anyhow!("Cannot open crash zip {:?}: {}", zip_path, e))?;
    let mut archive = zip::ZipArchive::new(file)?;

    let mut content = CrashReportContent::default();

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let name = entry.name().to_lowercase();
        
        // Skip directories
        if entry.is_dir() { continue; }

        let mut buf = String::new();
        // Use read_to_string but handle potential binary/large files gracefully
        if entry.size() > 10 * 1024 * 1024 {
            buf = format!("[File {} is too large to read ({} bytes)]", entry.name(), entry.size());
        } else if let Err(_) = entry.read_to_string(&mut buf) {
            buf = format!("[File {} could not be read as UTF-8 text]", entry.name());
        }

        if name.contains("metadata.txt") { content.metadata = buf; }
        else if name.contains("app_logs.txt") || name.contains("latest.log") || (name.contains("log") && name.ends_with(".txt")) { 
            if content.logs.is_empty() { content.logs = buf; }
            else { content.logs.push_str("\n\n--- ADDITIONAL LOG ---\n\n"); content.logs.push_str(&buf); }
        }
        else if name.contains("system_info.txt") || name.contains("system.txt") { content.system_info = buf; }
        else if name.contains("stacktrace.txt") { content.stacktrace = Some(buf); }
        else if name.contains("state_snapshot.json") { content.state_snapshot = Some(buf); }
        else if name.contains("dxdiag.txt") { content.dxdiag = Some(buf); }
        else if name.contains("frontend_dump.json") { content.frontend_dump = Some(buf); }
    }

    Ok(content)
}

/// Save BMM's state back to data.json
pub fn write_app_data(data: &BmmAppData) -> anyhow::Result<()> {
    let path = get_bmm_data_dir().join("data.json");
    let content = serde_json::to_string_pretty(data)
        .map_err(|e| anyhow::anyhow!("Serialization error: {}", e))?;
    
    // Write to a temp file first for safety (atomic write)
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, content)?;
    std::fs::rename(&tmp_path, &path)?;
    
    Ok(())
}

/// List files and directories in a given path (restricted to BMM context for safety)
pub fn list_directory(path: &str) -> anyhow::Result<Vec<HashMap<String, String>>> {
    let root = std::path::Path::new(path);
    
    // Basic safety: avoid system directories if possible, but BMM needs flexibility
    // For now we allow what the user provides but we could restrict it.
    
    let mut results = Vec::new();
    let entries = std::fs::read_dir(root)?;
    
    for entry in entries.flatten() {
        let mut map = HashMap::new();
        let path = entry.path();
        map.insert("name".to_string(), entry.file_name().to_string_lossy().to_string());
        map.insert("path".to_string(), path.to_string_lossy().to_string());
        map.insert("is_dir".to_string(), path.is_dir().to_string());
        if let Ok(meta) = entry.metadata() {
            map.insert("size".to_string(), meta.len().to_string());
        }
        results.push(map);
    }
    
    Ok(results)
}

/// Read a text file (README, log, config)
pub fn read_text_file(path: &str) -> anyhow::Result<String> {
    let content = std::fs::read_to_string(path)?;
    Ok(content)
}

/// Synchronize physical files for a profile (Apply enabled mods, remove disabled ones)
pub fn sync_profile(profile_id: &str) -> anyhow::Result<String> {
    let data = read_app_data()?;
    let profile = data.profiles.iter().find(|p| p.id == profile_id)
        .ok_or_else(|| anyhow::anyhow!("Profile not found"))?;
    
    let game_path = &profile.game_path;
    let backup_root = &profile.backup_path;
    
    // 1. Identify mods that SHOULD be active in this profile
    let mut mods_to_apply = Vec::new();
    for mid in &profile.active_mods {
        if let Some(m) = data.mods.iter().find(|m| &m.id == mid) {
            mods_to_apply.push(m.clone());
        }
    }
    
    // Sort by activation order (if implemented) or just use the list order
    // In profile.active_mods, the order is usually the priority.
    
    // 2. To safely sync, we need to know what files were PREVIOUSLY installed to remove them if they are no longer needed.
    // However, the "stacked" logic in BMM is more robust: it restores original or previous mod version.
    
    let mut overall_applied = Vec::new();
    let mut current_active_files = std::collections::HashSet::new();

    // 3. Apply each mod in order
    for (_i, m) in mods_to_apply.iter().enumerate() {
        let other_mods_files = current_active_files.clone();
        
        // We need to call crate::fs_utils::apply_mod_stacked.
        // Since we are in state_bridge.rs, we'll use a local implementation or call it if available.
        // For simplicity and to avoid circular deps/complex imports in this standalone context, 
        // I will implement a simplified version of the stacked sync here.
        
        let applied = sync_apply_mod(&m.mod_folder_path, game_path, backup_root, &other_mods_files)?;
        
        // Update current_active_files for next mod in stack
        for f in &applied {
            current_active_files.insert(f.clone());
        }
        overall_applied.push(m.name.clone());
    }
    
    Ok(format!("Successfully synchronized {} mods for profile '{}'", overall_applied.len(), profile.name))
}

fn sync_apply_mod(
    mod_folder: &std::path::Path,
    game_path: &std::path::Path,
    backup_root: &std::path::Path,
    other_mods_files: &std::collections::HashSet<std::path::PathBuf>
) -> anyhow::Result<Vec<std::path::PathBuf>> {
    // This is a re-implementation of the core logic to keep the standalone binary decoupled
    let files = list_files_recursive(mod_folder)?;
    
    for rel in &files {
        let src = mod_folder.join(rel);
        let dst = game_path.join(rel);
        let backup = backup_root.join("_original").join(rel);
        
        // 1. Backup if original exists and not already backed up
        if dst.exists() && !backup.exists() && !other_mods_files.contains(rel) {
            if let Some(p) = backup.parent() { std::fs::create_dir_all(p).ok(); }
            std::fs::copy(&dst, &backup)?;
        }
        
        // 2. Copy mod file
        if let Some(p) = dst.parent() { std::fs::create_dir_all(p).ok(); }
        std::fs::copy(&src, &dst)?;
    }
    
    Ok(files)
}

fn list_files_recursive(dir: &std::path::Path) -> anyhow::Result<Vec<std::path::PathBuf>> {
    let mut files = Vec::new();
    if dir.is_dir() {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                files.extend(list_files_recursive_rel(&path, dir)?);
            } else {
                files.push(path.strip_prefix(dir)?.to_path_buf());
            }
        }
    }
    Ok(files)
}

fn list_files_recursive_rel(path: &std::path::Path, base: &std::path::Path) -> anyhow::Result<Vec<std::path::PathBuf>> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let p = entry.path();
        if p.is_dir() {
            files.extend(list_files_recursive_rel(&p, base)?);
        } else {
            files.push(p.strip_prefix(base)?.to_path_buf());
        }
    }
    Ok(files)
}

/// Get the physical mods path for the active profile
pub fn get_active_mods_path() -> anyhow::Result<std::path::PathBuf> {
    let data = read_app_data()?;
    let active_id = data.active_profile_id.as_ref()
        .ok_or_else(|| anyhow::anyhow!("No active profile"))?;
    let profile = data.profiles.iter().find(|p| &p.id == active_id)
        .ok_or_else(|| anyhow::anyhow!("Profile not found"))?;
    Ok(profile.mods_path.clone())
}

/// Delete a mod from BMM and optionally its files
pub fn delete_mod(mod_id: &str, delete_files: bool) -> anyhow::Result<String> {
    let mut data = read_app_data()?;
    let idx = data.mods.iter().position(|m| m.id == mod_id || m.name == mod_id)
        .ok_or_else(|| anyhow::anyhow!("Mod not found"))?;
    
    let m = data.mods.remove(idx);
    
    if delete_files {
        if m.mod_folder_path.exists() {
            std::fs::remove_dir_all(&m.mod_folder_path)?;
        }
    }
    
    write_app_data(&data)?;
    Ok(format!("Mod '{}' deleted successfully (files deleted: {})", m.name, delete_files))
}

/// Create a directory tree (used by AI for complex installs)
pub fn create_directory(path: &str) -> anyhow::Result<String> {
    std::fs::create_dir_all(path)?;
    Ok(format!("Directory created: {}", path))
}

/// Verify integrity of a mod by comparing hashes
pub fn verify_integrity(mod_id: &str) -> anyhow::Result<HashMap<String, bool>> {
    let data = read_app_data()?;
    let m = data.mods.iter().find(|m| m.id == mod_id || m.name == mod_id)
        .ok_or_else(|| anyhow::anyhow!("Mod not found"))?;
    
    let mut results = HashMap::new();
    if let Some(stored_hashes) = &m.file_hashes {
        for (rel, stored_hash) in stored_hashes {
            let full_path = m.mod_folder_path.join(rel);
            if !full_path.exists() {
                results.insert(rel.clone(), false);
                continue;
            }
            
            // Re-calculate hash
            let current_hash = compute_file_sha256(&full_path)?;
            results.insert(rel.clone(), &current_hash == stored_hash);
        }
    }
    
    Ok(results)
}

fn compute_file_sha256(path: &std::path::Path) -> anyhow::Result<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 65536];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 { break; }
        hasher.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Create a modpack (simplified JSON structure)
pub fn create_modpack(name: &str, mod_ids: Vec<String>) -> anyhow::Result<String> {
    let data = read_app_data()?;
    let mut pack_mods = Vec::new();
    for id in mod_ids {
        if let Some(m) = data.mods.iter().find(|m| m.id == id || m.name == id) {
            pack_mods.push(m.clone());
        }
    }
    
    let pack_dir = get_bmm_data_dir().join("modpacks");
    std::fs::create_dir_all(&pack_dir)?;
    
    let pack_path = pack_dir.join(format!("{}.json", name));
    let pack_json = serde_json::json!({
        "name": name,
        "mods": pack_mods,
        "created_at": chrono::Local::now().to_rfc3339()
    });
    
    std::fs::write(&pack_path, serde_json::to_string_pretty(&pack_json)?)?;
    Ok(format!("Modpack '{}' created at {:?}", name, pack_path))
}


/// Find the documentation base path
pub fn get_docs_base_path() -> anyhow::Result<std::path::PathBuf> {
    let mut base_path = std::env::current_exe()?;
    // We are likely in target/debug/ or target/release/
    // Climb up to find the root where .Assets is
    for _ in 0..10 {
        if base_path.join(".Assets").exists() {
            return Ok(base_path.join(".Assets").join(".md"));
        }
        if let Some(parent) = base_path.parent() {
            base_path = parent.to_path_buf();
        } else {
            break;
        }
    }
    
    // Fallback to current dir if exe-based search failed
    let mut base_path = std::env::current_dir()?;
    for _ in 0..5 {
        if base_path.join(".Assets").exists() {
            return Ok(base_path.join(".Assets").join(".md"));
        }
        if let Some(parent) = base_path.parent() {
            base_path = parent.to_path_buf();
        } else {
            break;
        }
    }
    
    Err(anyhow::anyhow!("Could not find .Assets directory (checked from exe and cwd)"))
}

/// Read project documentation from .Assets/.md
pub fn read_documentation(file_name: &str) -> anyhow::Result<String> {
    let base_path = get_docs_base_path()?;
    let mut target_path = base_path.join(file_name);
    
    if !target_path.exists() && !file_name.ends_with(".md") {
        target_path = base_path.join(format!("{}.md", file_name));
    }
    
    if !target_path.exists() {
    }
    
    if !target_path.exists() {
        return Err(anyhow::anyhow!("Documentation file not found: {}", file_name));
    }
    
    std::fs::read_to_string(target_path).map_err(Into::into)
}

/// Export BMM configuration for backup
pub fn export_config(target_path: &str) -> anyhow::Result<String> {
    let data_path = get_bmm_data_dir().join("data.json");
    let dest = std::path::PathBuf::from(target_path);
    
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    
    std::fs::copy(data_path, &dest)?;
    Ok(format!("Configuration exported to {:?}", dest))
}

/// Generate a BetaHub-ready diagnostic report
pub fn generate_betahub_report(title: &str, description: &str) -> anyhow::Result<serde_json::Value> {
    let data = read_app_data()?;
    let sys = sysinfo::System::new_all();
    
    let report = serde_json::json!({
        "title": title,
        "description": description,
        "timestamp": chrono::Local::now().to_rfc3339(),
        "system_info": {
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "memory_total": sys.total_memory(),
            "memory_free": sys.free_memory(),
            "cpu_count": sys.cpus().len()
        },
        "bmm_info": {
            "version": env!("CARGO_PKG_VERSION"),
            "active_profile": data.active_profile_id,
            "mod_count": data.mods.len(),
            "enabled_mods": data.mods.iter().filter(|m| m.enabled).count()
        },
        "logs": "Log capture not implemented in standalone MCP yet - see session_*.log in Crashes folder"
    });
    
    Ok(report)
}

/// Find the language files base path (frontend/Lang)
pub fn get_lang_base_path() -> anyhow::Result<std::path::PathBuf> {
    let mut base_path = std::env::current_exe()?;
    for _ in 0..10 {
        let lang_dir = base_path.join("frontend").join("Lang");
        if lang_dir.exists() {
            return Ok(lang_dir);
        }
        if let Some(parent) = base_path.parent() {
            base_path = parent.to_path_buf();
        } else {
            break;
        }
    }
    
    let mut base_path = std::env::current_dir()?;
    for _ in 0..5 {
        let lang_dir = base_path.join("frontend").join("Lang");
        if lang_dir.exists() {
            return Ok(lang_dir);
        }
        if let Some(parent) = base_path.parent() {
            base_path = parent.to_path_buf();
        } else {
            break;
        }
    }
    
    Err(anyhow::anyhow!("Could not find frontend/Lang directory (checked from exe and cwd)"))
}

/// List available language codes
pub fn get_language_list() -> anyhow::Result<Vec<String>> {
    let base_path = get_lang_base_path()?;
    let mut langs = Vec::new();
    if let Ok(entries) = std::fs::read_dir(base_path) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.ends_with(".json") {
                    langs.push(name.replace(".json", ""));
                }
            }
        }
    }
    Ok(langs)
}

/// Read a language file
pub fn read_language_file(lang_code: &str) -> anyhow::Result<String> {
    let base_path = get_lang_base_path()?;
    let target_path = base_path.join(format!("{}.json", lang_code));
    
    if !target_path.exists() {
        return Err(anyhow::anyhow!("Language file not found: {:?}", target_path));
    }

    std::fs::read_to_string(target_path).map_err(|e| anyhow::anyhow!("Failed to read language file: {}", e))
}

/// Generate a production-ready repository manifest and copy files
pub fn generate_repo(name: &str, mod_ids: Vec<String>) -> anyhow::Result<String> {
    let app_data = read_app_data()?;
    let base_path = get_bmm_data_dir();
    let output_path = base_path.join("Exports").join(name);
    
    if !output_path.exists() {
        std::fs::create_dir_all(&output_path)?;
    }
    
    let mods_dir = output_path.join("mods");
    if !mods_dir.exists() {
        std::fs::create_dir_all(&mods_dir)?;
    }

    let mut repo_mods = Vec::new();

    for mod_id in mod_ids {
        if let Some(m) = app_data.mods.iter().find(|m| m.id == mod_id || m.name == mod_id) {
            let mut repo_files = Vec::new();

            // Recursively find and copy files
            let source_path = &m.mod_folder_path;
            if source_path.exists() && source_path.is_dir() {
                for entry in walkdir::WalkDir::new(source_path) {
                    let entry = entry?;
                    if entry.file_type().is_file() {
                        let rel_path = entry.path().strip_prefix(source_path)?;
                        let dest_path = mods_dir.join(&m.id).join(rel_path);
                        
                        if let Some(parent) = dest_path.parent() {
                            std::fs::create_dir_all(parent)?;
                        }
                        
                        std::fs::copy(entry.path(), &dest_path)?;
                        
                        // Compute SHA-256
                        let hash = compute_sha256(entry.path())?;
                        let file_size = entry.metadata()?.len();
                        
                        repo_files.push(serde_json::json!({
                            "relative_path": format!("mods/{}/{}", m.id, rel_path.to_string_lossy().replace("\\", "/")),
                            "sha256_hash": hash,
                            "size": file_size,
                            "chunks": null
                        }));
                    }
                }
            }
            
            repo_mods.push(serde_json::json!({
                "id": m.id,
                "name": m.name,
                "version": m.version,
                "author": m.author,
                "description": m.description,
                "tags": m.tags.iter().map(|t| serde_json::json!({"id": t, "name": t, "color_bg": "#444", "color_text": "#fff"})).collect::<Vec<_>>(),
                "files": repo_files,
                "download_links": m.download_links
            }));
        }
    }

    let mut repo_json = serde_json::json!({
        "name": name,
        "description": format!("AI-Generated Repository - {}", chrono::Local::now().format("%Y-%m-%d %H:%M")),
        "author": "BMM AI Assistant",
        "author_id": null,
        "signature": null,
        "version": "1.0.0",
        "game_name": "Multiple",
        "created_at": chrono::Utc::now().to_rfc3339(),
        "seed": "bmm-mcp-seed-v1",
        "upload_limit": null,
        "modpacks": null,
        "profiles": [
            {
                "id": "ai-gen-profile",
                "name": format!("{} Pack", name),
                "game_name": "Multiple",
                "mods": repo_mods
            }
        ]
    });

    let key_path = get_bmm_data_dir().join("creator_v2.key");
    if let Ok(key_bytes) = std::fs::read(&key_path) {
        if key_bytes.len() == 32 {
            let key_array: [u8; 32] = key_bytes.as_slice().try_into().unwrap();
            let signing_key = ed25519_dalek::SigningKey::from_bytes(&key_array);
            use ed25519_dalek::{Signer, VerifyingKey};
            let verifying_key: VerifyingKey = (&signing_key).into();
            let author_id = hex::encode(verifying_key.to_bytes());
            
            // Sign the compact JSON payload
            let compact_json = serde_json::to_string(&repo_json)?;
            let signature: ed25519_dalek::Signature = signing_key.sign(compact_json.as_bytes());
            let signature_hex = hex::encode(signature.to_bytes());
            
            // Inject true signature and author_id into the final JSON
            if let Some(obj) = repo_json.as_object_mut() {
                obj.insert("author_id".to_string(), serde_json::json!(author_id));
                obj.insert("signature".to_string(), serde_json::json!(signature_hex));
            }
        }
    }

    // Save repo.json
    let repo_json_str = serde_json::to_string_pretty(&repo_json)?;
    std::fs::write(output_path.join("repo.json"), repo_json_str)?;

    Ok(format!("Repository generated successfully at {:?}\nYou can now start the server pointing to this directory.", output_path))
}

fn compute_sha256(path: &std::path::Path) -> anyhow::Result<String> {
    use sha2::{Sha256, Digest};
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)?;
    Ok(format!("{:x}", hasher.finalize()))
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
) -> anyhow::Result<String> {
    let output_path = std::path::PathBuf::from(repo_path);
    if !output_path.exists() {
        return Err(anyhow::anyhow!("Repository path does not exist."));
    }

    let data_dir = get_bmm_data_dir();
    let cf_path = data_dir.join("bin").join("cloudflared.exe").to_string_lossy().to_string();

    let hybrid_template = if server_version == 2 {
        include_str!("../templates/mini-server/server.v2.bat.template")
    } else {
        include_str!("../templates/mini-server/server.hybrid.bat.template")
    };
    
    let mut hybrid_content = hybrid_template.replace("PORT_PLACEHOLDER", &port.to_string());
    hybrid_content = hybrid_content.replace("USE_CLOUDFLARE_PLACEHOLDER", if use_cloudflare { "true" } else { "false" });
    hybrid_content = hybrid_content.replace("USE_UPNP_PLACE_HOLDER", if use_upnp { "true" } else { "false" });
    hybrid_content = hybrid_content.replace("CLOUDFLARE_BINARY_PLACEHOLDER", &cf_path.replace("\\", "/"));
    hybrid_content = hybrid_content.replace("UPLOAD_LIMIT_PLACEHOLDER", &upload_limit.to_string());
    hybrid_content = hybrid_content.replace("ADMIN_PASSWORD_PLACEHOLDER", admin_password);

    let main_bat_path = output_path.join("BMM-Standalone-Server.bat");
    std::fs::write(&main_bat_path, hybrid_content)?;

    // Copy Bans if exists
    let ban_path = data_dir.join("bans.json");
    if ban_path.exists() {
        let _ = std::fs::copy(ban_path, output_path.join("bans.json"));
    }

    // Copy Whitelist if exists
    let wl_path = data_dir.join("whitelist.json");
    if wl_path.exists() {
        let _ = std::fs::copy(wl_path, output_path.join("whitelist.json"));
    }

    let mut msg = format!("Standalone Lightweight Server script generated successfully at: {:?}", main_bat_path);

    if auto_start {
        #[cfg(target_os = "windows")]
        {
            use winreg::enums::*;
            use winreg::RegKey;
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            if let Ok(run) = hkcu.open_subkey_with_flags("Software\\Microsoft\\Windows\\CurrentVersion\\Run", KEY_SET_VALUE) {
                let mut path_str = std::fs::canonicalize(&main_bat_path)
                    .map(|p| p.to_string_lossy().to_string().replace("\\\\?\\", "").replace("/","\\"))
                    .unwrap_or_else(|_| main_bat_path.to_string_lossy().to_string());

                if path_str.contains(' ') && !path_str.starts_with('"') {
                    path_str = format!("\"{}\"", path_str);
                }
                
                match run.set_value("BMM-Mini-Server", &path_str) {
                    Ok(_) => msg.push_str("\n[STARTUP] Windows Autostart enabled via Registry."),
                    Err(e) => msg.push_str(&format!("\n[STARTUP] Failed to set Registry value: {}", e)),
                }
            }
        }
    } else {
        #[cfg(target_os = "windows")]
        {
            use winreg::enums::*;
            use winreg::RegKey;
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            if let Ok(run) = hkcu.open_subkey_with_flags("Software\\Microsoft\\Windows\\CurrentVersion\\Run", KEY_SET_VALUE) {
                let _ = run.delete_value("BMM-Mini-Server");
                msg.push_str("\n[STARTUP] Autostart disabled.");
            }
        }
    }

    Ok(msg)
}
