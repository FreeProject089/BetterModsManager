use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub game_name: String,
    pub game_path: PathBuf,
    pub mods_path: PathBuf,
    pub backup_path: PathBuf,
    pub active_mods: Vec<String>, // mod IDs currently enabled
    pub color: Option<String>,
    pub icon: Option<String>,
    #[serde(default)]
    pub background_image: Option<String>,
    /// Filename (next to data.json) of a custom imported icon image, if any.
    #[serde(default)]
    pub icon_image: Option<String>,
    pub created_at: String,
    pub origin_repo_profile_id: Option<String>,
}

impl Profile {
    pub fn new(
        name: String,
        game_name: String,
        game_path: PathBuf,
        mods_path: PathBuf,
        backup_path: PathBuf,
    ) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            game_name,
            game_path,
            mods_path,
            backup_path,
            active_mods: Vec::new(),
            color: None,
            icon: None,
            background_image: None,
            icon_image: None,
            created_at: chrono::Local::now().to_rfc3339(),
            origin_repo_profile_id: None,
        }
    }
}
