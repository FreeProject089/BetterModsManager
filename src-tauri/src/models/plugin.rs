use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct PluginModRequirement {
    pub name: String,
    #[serde(default)]
    pub optional: bool,
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct PluginModList {
    #[serde(default)]
    pub strict: bool,
    #[serde(default)]
    pub required_mods: Vec<PluginModRequirement>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub game: String,
    #[serde(default)]
    pub official: bool,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub modlist: Option<PluginModList>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub website: String,
    /// Relative paths (within the plugin folder) of external scripts this plugin
    /// ships. Running them is gated behind the "unsafe plugins" permission.
    #[serde(default)]
    pub scripts: Vec<String>,
    /// Marks this plugin as containing external scripts (set via the "contains
    /// scripts" checkbox). When true, activating it prompts to run the scripts.
    #[serde(default)]
    pub has_scripts: bool,
    /// Relative paths of folders bundled inside the plugin (under "bundle/").
    #[serde(default)]
    pub folders: Vec<String>,
    /// What happens when the plugin is applied: "modlist" (default), "script",
    /// or "both".
    #[serde(default = "default_apply_mode")]
    pub apply_mode: String,
}

fn default_apply_mode() -> String { "modlist".to_string() }

fn default_version() -> String { "1.0.0".to_string() }

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InstalledPlugin {
    pub manifest: PluginManifest,
    pub installed_at: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub icon_path: Option<String>,
    #[serde(default)]
    pub install_dir: String,
}

fn default_true() -> bool { true }

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CatalogEntry {
    pub id: String,
    pub name: String,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub game: String,
    #[serde(default)]
    pub official: bool,
    pub download_url: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub icon_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CatalogResponse {
    #[serde(default = "default_version")]
    pub version: String,
    pub plugins: Vec<CatalogEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModCompareEntry {
    pub name: String,
    pub optional: bool,
    pub found: bool,
    pub active: bool,
    pub mod_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModCompareResult {
    pub plugin_id: String,
    pub plugin_name: String,
    pub strict: bool,
    pub required: Vec<ModCompareEntry>,
    pub strict_extra: Vec<String>,
    pub all_required_active: bool,
    pub missing_required: usize,
}
