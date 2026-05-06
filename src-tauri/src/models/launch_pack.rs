use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct LaunchPack {
    pub id: String,
    pub name: String,
    pub executable_paths: Vec<PathBuf>,
    pub icon_path: Option<PathBuf>,
    pub created_at: String,
}
