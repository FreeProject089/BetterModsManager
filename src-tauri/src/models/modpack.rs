use serde::{Deserialize, Serialize};

/// A single mod reference inside a Modpack
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModpackModRef {
    /// The mod's BMM id (from ModEntry.id)
    pub mod_id: String,
    pub mod_name: String,
    pub mod_version: String,
    /// Profile where this mod lives (needed for multi-profile packs)
    pub profile_id: Option<String>,
    pub profile_name: Option<String>,
    /// SHA-256 of the mod's first/main file — used for cross-PC identification
    pub sha256: String,
    /// Exact path of each file within the mod folder, plus its SHA
    pub file_manifest: Vec<ModpackFileRef>,
    /// Whether dependencies of this mod are included
    pub include_dependencies: bool,
    /// Direct download link (optional)
    pub download_link: Option<String>,
    /// Fallback: "direct" URL or "sr" (ServerRepo URL)
    pub fallback_link: Option<String>,
    pub fallback_type: Option<String>, // "direct" | "sr"
}

/// One file entry within a mod's manifest
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModpackFileRef {
    /// Relative path inside the mod folder
    pub relative_path: String,
    pub sha256: String,
    pub size: u64,
}

/// Dependency mode for the whole modpack
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DependencyMode {
    /// All mods with declared dependencies auto-include those dependencies
    All,
    /// No dependencies are auto-included
    None,
    /// Per-mod setting via `include_dependencies` on each ModpackModRef
    Manual,
}

/// A full Modpack stored locally in AppData
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LocalModpack {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub multi_profile: bool,
    pub dependency_mode: DependencyMode,
    #[serde(default)]
    pub skip_integrity_check: bool,
    pub mods: Vec<ModpackModRef>,
    /// Optional link to a ServerRepo that can supply missing mods
    pub sr_link: Option<String>,
    /// Game name this pack targets
    pub game_name: Option<String>,
}
