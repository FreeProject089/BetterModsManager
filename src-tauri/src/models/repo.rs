use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServerRepo {
    pub name: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub author_id: Option<String>,
    pub signature: Option<String>,
    pub version: String,
    pub game_name: String,
    pub created_at: String,
    pub seed: Option<String>,
    pub upload_limit: Option<u32>, // KB/s
    pub profiles: Vec<RepoProfile>,
    pub modpacks: Option<Vec<RepoModpackShare>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoModpackShare {
    pub modpack: crate::models::modpack::LocalModpack,
    /// "public", "whitelist_repo", "whitelist_custom"
    pub share_mode: String,
    pub custom_whitelist: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoProfile {
    pub id: String,
    pub name: String,
    pub game_name: String,
    pub mods: Vec<RepoMod>,
    /// Built-in icon name (shared so the receiver sees the same icon).
    #[serde(default)]
    pub icon: Option<String>,
    /// Accent color (shared).
    #[serde(default)]
    pub color: Option<String>,
    /// Custom imported icon, embedded as a data-URI (`data:image/png;base64,…`)
    /// so it travels with the repo and is restored on sync.
    #[serde(default)]
    pub icon_image: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoMod {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub description: Option<String>,
    pub tags: Vec<RepoTag>,
    pub files: Vec<RepoFile>,
    pub download_links: Vec<crate::models::mod_entry::DownloadLink>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoTag {
    pub id: String,
    pub name: String,
    pub color_bg: String,
    pub color_text: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoFile {
    pub relative_path: String,
    pub size: u64,
    pub sha256_hash: String,
    pub chunks: Option<Vec<RepoChunk>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoChunk {
    pub size: u32,
    pub sha256_hash: String,
}

impl ServerRepo {
    pub fn new(name: String, game_name: String) -> Self {
        Self {
            name,
            description: None,
            author: None,
            author_id: None,
            signature: None,
            version: "1.0.0".to_string(),
            game_name,
            created_at: chrono::Utc::now().to_rfc3339(),
            seed: None,
            upload_limit: None,
            profiles: Vec::new(),
            modpacks: None,
        }
    }
}
