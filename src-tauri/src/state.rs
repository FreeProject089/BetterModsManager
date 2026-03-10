use crate::models::profile::Profile;
use crate::models::mod_entry::ModEntry;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct AppData {
    pub profiles: Vec<Profile>,
    pub mods: Vec<ModEntry>,
    pub active_profile_id: Option<String>,
    #[serde(default)]
    pub custom_tags: Vec<crate::models::tag::TagDef>,
    #[serde(default)]
    pub disk_limits: std::collections::HashMap<String, u64>,
}

pub struct AppState {
    pub data: Mutex<AppData>,
    pub data_path: PathBuf,
    pub install_cancelled: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub benchmark_running: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl AppState {
    pub fn load(data_path: PathBuf) -> Self {
        let data = if data_path.exists() {
            let content = std::fs::read_to_string(&data_path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            AppData::default()
        };
        Self {
            data: Mutex::new(data),
            data_path,
            install_cancelled: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            benchmark_running: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    pub fn save(&self) -> anyhow::Result<()> {
        let data = self.data.lock().unwrap();
        if let Some(parent) = self.data_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(&*data)?;
        std::fs::write(&self.data_path, json)?;
        Ok(())
    }
}
