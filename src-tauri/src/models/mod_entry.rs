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
        }
    }

    pub fn load_metadata(&mut self) -> bool {
        let path = &self.mod_folder_path;
        if !path.exists() { return false; }

        let is_zip = path.is_file() && path.extension().and_then(|s| s.to_str()).unwrap_or("").eq_ignore_ascii_case("zip");

        if is_zip {
            if let Ok(file) = std::fs::File::open(path) {
                if let Ok(mut archive) = zip::ZipArchive::new(file) {
                    let mut content = String::new();
                    let has_meta = if let Ok(mut f) = archive.by_name("_InfoBetterMod.Manager_") {
                        use std::io::Read;
                        f.read_to_string(&mut content).is_ok()
                    } else {
                        false
                    };
                    
                    if has_meta {
                        if let Ok(meta) = serde_json::from_str::<ModMetadata>(&content) {
                            self.apply_metadata(meta);
                            return true;
                        }
                    }
                }
            }
        } else if path.is_dir() {
            let p = path.join("_InfoBetterMod.Manager_");
            if p.exists() {
                if let Ok(content) = std::fs::read_to_string(p) {
                    if let Ok(meta) = serde_json::from_str::<ModMetadata>(&content) {
                        self.apply_metadata(meta);
                        return true;
                    }
                }
            }
        }
        false
    }

    fn apply_metadata(&mut self, meta: ModMetadata) {
        self.name = meta.name;
        self.version = meta.version;
        self.author = meta.author;
        self.description = meta.description;
        self.dependencies = meta.dependencies;
        self.download_links = meta.download_links;
        if let Some(tags) = meta.tags {
            self.tags = tags;
        }
    }
}
