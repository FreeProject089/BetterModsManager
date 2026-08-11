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
    // When true, the repo server requires the downloader to present a BetterCommunity
    // identity (x-creator-id / x-creator-key) for EVERY file — i.e. the user must be
    // signed in to BetterCommunity in BMM to download. Accepts camelCase in JSON.
    #[serde(default, alias = "requireLogin")]
    pub require_login: Option<bool>,
    // Where the MOD FILES live, when that is not "next to repo.json".
    //
    // By default a client resolves a file as `<dir containing repo.json>/mods/<id>/<path>`,
    // which assumes the export uploaded the mods alongside the manifest. Set this and the
    // manifest can be published anywhere while the files stay on hosting you already run —
    // the layout beneath it is still `mods/<id>/<path>`.
    //
    // Optional and absent from older manifests, so a repo generated before this existed
    // keeps resolving exactly as it did.
    #[serde(default, alias = "filesBaseUrl", skip_serializing_if = "Option::is_none")]
    pub files_base_url: Option<String>,
    // How a file's URL is built beneath the base, for hosting that already has its own
    // layout. `{id}` is the mod id, `{path}` the file's relative path; the default is
    // `mods/{id}/{path}`.
    //
    // Without this, adopting BMM meant moving your files to match BMM. A server already
    // serving `https://host/addons/<mod>/…` only needs `addons/{id}/{path}` here, and
    // nothing on it moves. Absent from older manifests, which keep the default.
    #[serde(default, alias = "filesLayout", skip_serializing_if = "Option::is_none")]
    pub files_layout: Option<String>,
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
    /// When a repo is generated with "zip mods", the mod's files are packed into a
    /// single archive (`mods/<dir>.zip`) and this points at it (its sha256 covers
    /// integrity). `files` is then empty. Absent/None = classic per-file layout.
    #[serde(default)]
    pub archive: Option<RepoFile>,
    pub download_links: Vec<crate::models::mod_entry::DownloadLink>,
    /// Mod-id dependencies, filtered at gen time to only those whose target mod
    /// is part of the exported profiles (cross-profile deps to non-exported
    /// profiles are dropped). Bare mod ids.
    #[serde(default)]
    pub dependencies: Vec<String>,
    /// Optional author-written changelog for this mod's current version, shown to
    /// users when an update is available. Plain text / markdown.
    #[serde(default)]
    pub changelog: Option<String>,
    /// Author-configured update sources, shared so a downloader inherits how this
    /// mod is updated (a site repo.json, a direct-download archive, fallbacks).
    /// Signatures are NOT shared — the receiver captures its own baseline.
    #[serde(default)]
    pub update_url: Option<String>,
    #[serde(default)]
    pub direct_url: Option<String>,
    #[serde(default)]
    pub update_sources: Vec<crate::models::mod_entry::UpdateSource>,
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
    /// Unix seconds, as reported by the filesystem when the hash was computed.
    ///
    /// Only used to decide whether a REMOTE file still matches the hash recorded here, so a
    /// refresh can skip re-downloading what has not changed. It is never used to validate a
    /// download — that is always the hash.
    ///
    /// Absent from every manifest written before this field existed, and absence means
    /// "unknown", which the refresh planner treats as "must re-hash". Never as "unchanged".
    #[serde(default, alias = "mtime", skip_serializing_if = "Option::is_none")]
    pub mtime: Option<i64>,
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
            files_base_url: None,
            files_layout: None,
            author: None,
            author_id: None,
            signature: None,
            version: "1.0.0".to_string(),
            game_name,
            created_at: chrono::Utc::now().to_rfc3339(),
            seed: None,
            upload_limit: None,
            require_login: None,
            profiles: Vec::new(),
            modpacks: None,
        }
    }
}
