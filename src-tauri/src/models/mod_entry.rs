use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct ModFile {
    /// Relative path inside the mod folder (source)
    pub source: PathBuf,
    /// Relative path from game root (destination)
    pub target: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ModStatus {
    Enabled,
    Disabled,
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConflictCategory {
    Intra, // Within the same profile
    Inter, // With another profile on the same root
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConflictStatus {
    Active,    // Red: Conflict is currently active on disk
    Potential, // Yellow: File overlap exists but the other mod is disabled
}

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
pub struct ModEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub description: Option<String>,
    pub dependencies: Vec<String>,
    pub enabled: bool,
    #[serde(default)]
    pub conflicts: Vec<ConflictReport>,
    /// Absolute path to the mod's root folder (stored in mods_path from profile)
    pub mod_folder_path: PathBuf,
    pub status: ModStatus,
    pub added_at: String,
    /// List of relative paths that were installed to game dir (tracked for clean removal)
    #[serde(default)]
    pub installed_files: Vec<String>,
    /// Download links for this mod (for .MM export/sharing)
    #[serde(default)]
    pub download_links: Vec<DownloadLink>,
    /// Custom tags associated with this mod
    #[serde(default)]
    pub tags: Vec<String>,
    /// Instructions on placement and special setup (inherited from .MM)
    #[serde(default)]
    pub install_notes: String,
    /// Activation order (0 = first, higher = more recent)
    #[serde(default)]
    pub activation_order: u32,
    /// Cached list of relative paths for conflict detection
    #[serde(default)]
    pub cached_files: Option<Vec<String>>,
    /// Last modification time of the mod folder during the last scan
    #[serde(default)]
    pub last_scan_mtime: u64,
    /// Optional map of file relative paths to their SHA256 hashes for integrity verification
    #[serde(default)]
    pub file_hashes: Option<std::collections::HashMap<String, String>>,
    /// Timestamp of when the hashes were last calculated
    #[serde(default)]
    pub file_hashes_timestamp: Option<String>,
    /// Whether the last deep integrity check failed
    #[serde(default)]
    pub file_hashes_invalid: Option<bool>,
}

/// A download link for a mod
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadLink {
    pub url: String,
    pub link_type: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModMetadata {
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub description: Option<String>,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub download_links: Vec<DownloadLink>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

impl From<&ModEntry> for ModMetadata {
    fn from(m: &ModEntry) -> Self {
        Self {
            name: m.name.clone(),
            version: m.version.clone(),
            author: m.author.clone(),
            description: m.description.clone(),
            dependencies: m.dependencies.clone(),
            download_links: m.download_links.clone(),
            tags: Some(m.tags.clone()),
        }
    }
}

impl ModEntry {
    pub fn new(name: String, mod_folder_path: PathBuf) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            version: "0.0.1".to_string(),
            author: None,
            description: None,
            dependencies: Vec::new(),
            enabled: false,
            conflicts: Vec::new(),
            mod_folder_path,
            status: ModStatus::Disabled,
            added_at: chrono::Local::now().to_rfc3339(),
            installed_files: Vec::new(),
            download_links: Vec::new(),
            tags: Vec::new(),
            install_notes: String::new(),
            activation_order: 0,
            cached_files: None,
            last_scan_mtime: 0,
            file_hashes: None,
            file_hashes_timestamp: None,
            file_hashes_invalid: None,
        }
    }

    pub fn load_metadata(&mut self) -> bool {
        // Disabled: No longer reading _InfoBetterMod.Manager_ files as per user request
        false
    }
}
