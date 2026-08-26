use serde::{Deserialize, Serialize};

/// The .MM file format — a shareable mod list
/// Contains download links, file structure, and placement instructions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModList {
    pub format_version: String,
    pub name: String,
    pub description: Option<String>,
    pub game_name: String,
    pub game_path_hint: String,
    pub author: Option<String>,
    pub created_at: String,
    pub mods: Vec<ModListEntry>,
    /// The tags the entries below refer to, defined.
    ///
    /// Every entry carries `tags` as a list of IDs, and an id means nothing on the machine
    /// that opens the file: the importer wrote the ids onto the new mods and the screen then
    /// looked each one up in ITS tags, found nothing, and drew no chip. So a shared list
    /// arrived with its tags silently gone. The definitions travel with them now.
    ///
    /// `#[serde(default)]` because every .mm written before this has no such field, and a
    /// list from last year must still open.
    #[serde(default)]
    pub tag_defs: Vec<crate::models::tag::TagDef>,
    /// Credentials for the protected sources this list points at — SEALED.
    ///
    /// Only this section is encrypted, never the whole list: a `.mm` is meant to be readable
    /// by BMM, by BetterCommunity's inspector and by a person deciding whether to trust it,
    /// and a list nobody can read is a list nobody can check. What is inside is the part that
    /// must not be readable.
    ///
    /// Absent on every list that carries no credentials, which is almost all of them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credentials: Option<serde_json::Value>,
    /// Modpacks whose mods are ALL in this list.
    ///
    /// A pack referring to a mod the list does not carry would install nine of its twelve
    /// mods and look like the pack is broken — the same rule the repo manifest applies, and
    /// for the same reason.
    #[serde(default)]
    pub modpacks: Vec<crate::models::modpack::LocalModpack>,
}

/// A download link for a mod with its type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadLink {
    pub url: String,
    pub link_type: String, // "github", "google_drive", "direct", "mega", "other"
    pub label: String,     // Human-readable label
}

/// A file entry describing the mod's arborescence (folder structure)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModFileEntry {
    /// Relative path from mod root (e.g. "Liveries/FA-18C/my_skin/desc.lua")
    pub relative_path: String,
    /// Whether this is a directory (true) or a file (false)
    pub is_directory: bool,
    /// File size in bytes (0 for dirs)
    pub size: u64,
    /// SHA-256 hex digest of the file contents (None for directories)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModListEntry {
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub description: Option<String>,
    /// Multiple download URLs (GitHub, Google Drive, direct, etc.)
    pub download_links: Vec<DownloadLink>,
    /// Full file tree of the mod showing what gets copied where
    /// Each path is relative to the mod root (= relative to game root)
    pub file_tree: Vec<ModFileEntry>,
    /// What this mod needs, BY NAME.
    ///
    /// The mod entry stores dependencies as BMM ids, and an id from somebody else's install
    /// resolves to nothing here — the importer would write a requirement pointing at a mod
    /// that does not exist, which reads as "this mod is broken". A name is what both sides
    /// can match on, and it is what the person sharing the list sees on screen.
    #[serde(default)]
    pub dependencies: Vec<String>,
    /// Where this mod updates itself from, when it does. Carried so a shared list keeps its
    /// repos: importing a list and then having to re-attach every update source by hand is
    /// how a list arrives half-alive.
    #[serde(default)]
    pub update_sources: Vec<crate::models::mod_entry::UpdateSource>,
    /// Instructions on placement and special setup
    pub install_notes: String,
    /// Custom tags
    #[serde(default)]
    pub tags: Vec<String>,
    /// The publisher's id for this mod. Informational: ids are local, and the importer makes
    /// its own. Carried so a list can be diffed against the install it came from.
    #[serde(default)]
    pub id: String,
    /// The publisher's content fingerprint — the one identifier that means the same thing on
    /// two machines. The importer derives its own from the files it wrote; this is what it
    /// can be compared AGAINST.
    #[serde(default)]
    pub content_id: Option<String>,
    /// Where the mod came from, and how it keeps itself current. Carried for the same reason
    /// update_sources is: a list that arrives with its provenance stripped is a list of mods
    /// that will never update again, and re-attaching every repo by hand is not a thing
    /// anybody does.
    #[serde(default)]
    pub source_repo: Option<String>,
    #[serde(default)]
    pub repo_mod_id: Option<String>,
    #[serde(default)]
    pub update_url: Option<String>,
}

impl ModList {
    pub fn new(name: String, game_name: String, game_path_hint: String) -> Self {
        Self {
            format_version: "1.0".to_string(),
            name,
            description: None,
            game_name,
            game_path_hint,
            author: None,
            created_at: chrono::Local::now().to_rfc3339(),
            mods: Vec::new(),
            tag_defs: Vec::new(),
            credentials: None,
            modpacks: Vec::new(),
        }
    }
}
