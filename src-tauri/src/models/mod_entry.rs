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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub enabled: bool,
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
}

/// A download link for a mod
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadLink {
    pub url: String,
    pub link_type: String,
    pub label: String,
}

impl ModEntry {
    pub fn new(name: String, mod_folder_path: PathBuf) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            version: "1.0.0".to_string(),
            author: String::new(),
            description: String::new(),
            enabled: false,
            mod_folder_path,
            status: ModStatus::Disabled,
            added_at: chrono::Local::now().to_rfc3339(),
            installed_files: Vec::new(),
            download_links: Vec::new(),
            tags: Vec::new(),
            install_notes: String::new(),
        }
    }
}
