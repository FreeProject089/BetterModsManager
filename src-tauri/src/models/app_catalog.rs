use serde::{Serialize, Deserialize};
use std::collections::HashMap;

fn default_true() -> bool { true }

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct AppImages {
    pub thumb: Option<String>,
    pub extra: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppDownload {
    pub url: String,
    pub file_type: String, // "zip" | "exe" | "msi" | "script"
    pub size: Option<u64>,
    /// Optional sha256 checksum (CWE-494). Verified before install when present.
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppEntry {
    pub id: String,
    pub title: String,
    pub description: String,
    pub md_link: Option<String>,
    pub category: String,  // "game" | "utility" | "other"
    pub price: String,     // "free" | "freemium" | "paid"
    pub tags: Vec<String>,
    pub version: Option<String>,
    pub requirements: Option<String>,
    pub images: Option<AppImages>,
    pub download: AppDownload,
    pub official: Option<bool>,
    pub partner: Option<bool>,
    /// Which catalog URL this entry came from (injected at merge time)
    pub source_label: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct AppCatalog {
    pub version: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub apps: Vec<AppEntry>,
    /// Only honoured from the official catalog.
    /// URLs listed here receive the "Partner" badge — entries from any other
    /// source that claim partner=true are silently stripped.
    pub partner_catalogs: Option<Vec<String>>,
    /// Community catalog URLs to auto-load (no trust badge granted).
    pub community_imports: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MergedCatalog {
    pub apps: Vec<AppEntry>,
    pub sources_loaded: Vec<String>,
    pub sources_failed: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InstalledAppInfo {
    pub id: String,
    pub title: String,
    pub install_path: String,
    pub exe_path: Option<String>,
    pub installed_at: String,
    pub version: Option<String>,
    pub usage_seconds: u64,
    pub category: Option<String>,
    pub thumb: Option<String>,
    /// true = BMM created the install_path folder → safe to delete on uninstall
    /// false = external installer; BMM only manages the exe reference
    #[serde(default = "default_true")]
    pub is_managed: bool,
    /// For setup-installed apps: command to run the app's real uninstaller
    /// (from the Windows registry UninstallString or a unins*.exe in the folder)
    #[serde(default)]
    pub uninstaller: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct AppsState {
    pub installed: HashMap<String, InstalledAppInfo>,
    pub favorites: Vec<String>,
    pub history: Vec<AppHistoryEntry>,
    pub community_sources: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppHistoryEntry {
    pub action: String,    // "install" | "launch" | "uninstall"
    pub app_id: String,
    pub app_title: String,
    pub timestamp: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InstallResult {
    pub app_id: String,
    pub install_path: String,
    pub executables: Vec<ExeInfo>,
    /// true when a setup/msi installer was run (BMM waited for it and auto-detected the exe)
    pub installer_launched: bool,
    /// true when BMM successfully auto-detected the installed executable
    pub auto_detected: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ExeInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
}
