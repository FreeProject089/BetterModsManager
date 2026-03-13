use crate::models::profile::Profile;
use crate::models::mod_entry::ModEntry;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AppSettings {
    #[serde(default = "default_lang")]
    pub language: String,
    #[serde(default)]
    pub github_token: String,
    #[serde(default)]
    pub shortcuts: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub onboarding_shown: bool,
    #[serde(default)]
    pub last_seen_crash: Option<String>,
    #[serde(default)]
    pub auto_io_calibration: bool,
    #[serde(default)]
    pub storage_alert_enabled: bool,
    #[serde(default = "default_storage_warning")]
    pub storage_warning_space_pct: u32,
    #[serde(default = "default_storage_critical")]
    pub storage_critical_space_pct: u32,
    #[serde(default = "default_filter")]
    pub current_filter: String,
    #[serde(default = "default_sort")]
    pub current_sort_by: String,
    #[serde(default = "default_true")]
    pub last_session_clean: bool,
}

fn default_true() -> bool { true }

fn default_filter() -> String { "all".to_string() }
fn default_sort() -> String { "name_asc".to_string() }

fn default_lang() -> String { "fr".to_string() }
fn default_storage_warning() -> u32 { 40 }
fn default_storage_critical() -> u32 { 30 }

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct AppData {
    pub profiles: Vec<Profile>,
    pub mods: Vec<ModEntry>,
    pub active_profile_id: Option<String>,
    #[serde(default)]
    pub custom_tags: Vec<crate::models::tag::TagDef>,
    #[serde(default)]
    pub disk_limits: std::collections::HashMap<String, u64>,
    #[serde(default)]
    pub settings: AppSettings,
}

pub struct AppState {
    pub data: Mutex<AppData>,
    pub data_path: PathBuf,
    pub install_cancelled: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub sync_paused: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub benchmark_running: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub previous_session_clean: std::sync::Arc<std::sync::atomic::AtomicBool>,
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
            sync_paused: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            benchmark_running: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            previous_session_clean: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true)),
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
