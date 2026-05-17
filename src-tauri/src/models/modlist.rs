use serde::{Deserialize, Serialize};

/// The .MM file format — a shareable mod list
/// Contains download links, file structure, and placement instructions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModList {
    pub format_version: String,
    pub name: String,
    pub description: Option<String>,
    pub game_name: String,
    pub game_path_hint: String,
    pub author: Option<String>,
    pub created_at: String,
    pub mods: Vec<ModListEntry>,
}

/// A download link for a mod with its type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadLink {
    pub url: String,
    pub link_type: String, // "github", "google_drive", "direct", "mega", "other"
    pub label: String,     // Human-readable label
}

/// A file entry describing the mod's arborescence (folder structure)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModFileEntry {
    /// Relative path from mod root (e.g. "Liveries/FA-18C/my_skin/desc.lua")
    pub relative_path: String,
    /// Whether this is a directory (true) or a file (false)
    pub is_directory: bool,
    /// File size in bytes (0 for dirs)
    pub size: u64,
    /// SHA-256 hex digest of the file contents (None for directories)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModListEntry {
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub description: Option<String>,
    /// Multiple download URLs (GitHub, Google Drive, direct, etc.)
    pub download_links: Vec<DownloadLink>,
    /// Sort/load priority — lower number = applied first
    pub sort_priority: u32,
    /// Full file tree of the mod showing what gets copied where
    /// Each path is relative to the mod root (= relative to game root)
    pub file_tree: Vec<ModFileEntry>,
    /// Instructions on placement and special setup
    pub install_notes: String,
    /// Custom tags
    #[serde(default)]
    pub tags: Vec<String>,
}

impl ModList {
    pub fn new(name: String, game_name: String, game_path_hint: String) -> Self {
        Self {
            format_version: "1.0".to_string(),
            name,
            description: None,
            game_name,
            game_path_hint,
            author: None,
            created_at: chrono::Local::now().to_rfc3339(),
            mods: Vec::new(),
        }
    }
}
