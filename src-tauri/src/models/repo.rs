use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServerRepo {
    pub name: String,
    pub description: String,
    pub author: String,
    pub author_id: Option<String>,
    pub signature: Option<String>,
    pub version: String,
    pub game_name: String,
    pub created_at: String,
    pub profiles: Vec<RepoProfile>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoProfile {
    pub id: String,
    pub name: String,
    pub game_name: String,
    pub mods: Vec<RepoMod>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoMod {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
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
            description: String::new(),
            author: String::new(),
            author_id: None,
            signature: None,
            version: "1.0.0".to_string(),
            game_name,
            created_at: chrono::Utc::now().to_rfc3339(),
            profiles: Vec::new(),
        }
    }
}
