use serde::{Deserialize, Serialize};

/// Fallbacks for a manifest written before a field existed. See ServerRepo.
fn default_repo_name() -> String { "Repo".to_string() }
fn default_repo_version() -> String { "1.0".to_string() }
/// Now, not the epoch: a repo whose creation date is unknown was not created in 1970, and a
/// date that far out sorts and displays as an obvious bug in every list that shows it.
fn default_created_at() -> String { chrono::Utc::now().to_rfc3339() }

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServerRepo {
    // Defaults on the four required fields, so a manifest written by an older BMM still
    // loads. Without them serde refuses the whole document over one absent key and reports a
    // field name, which reads as a corrupt file rather than an old one — and the repo it
    // describes is perfectly fine.
    //
    // NOT empty strings: a default that round-trips as "" would quietly rename a repo to
    // nothing the next time it is written. Each falls back to something true.
    #[serde(default = "default_repo_name")]
    pub name: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub author_id: Option<String>,
    pub signature: Option<String>,
    #[serde(default = "default_repo_version")]
    pub version: String,
    #[serde(default)]
    pub game_name: String,
    #[serde(default = "default_created_at")]
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
    // Defaulted for the same reason as the fields above, and for one more: a repo with no
    // profiles yet is a real state — it is what an empty folder about to become a repo
    // looks like. Requiring the key made "nothing here yet" indistinguishable from a
    // corrupt manifest.
    #[serde(default)]
    pub profiles: Vec<RepoProfile>,
    pub modpacks: Option<Vec<RepoModpackShare>>,
    /// Everything a repo carries that is not a mod.
    ///
    /// A repo used to mean "profiles of mods, plus modpacks", so publishing the rest of a
    /// setup meant publishing it somewhere ELSE and telling people where — the plugin on one
    /// host, the theme in a message, the automation as an attachment, the catalogues as a
    /// list of links in a README. What arrived was a folder of mods and a reading exercise.
    ///
    /// One flat array rather than six fields, because every consumer — the client, the
    /// server, BCWEB's inspector, the API, the CLI and the MCP tools — then has ONE code
    /// path, and a kind added later reaches an old BMM as an item it can name and decline
    /// rather than as a parse error over the whole manifest.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extras: Vec<RepoExtra>,
    /// Credentials for the protected sources this repo's mods point at — SEALED.
    ///
    /// The same block a `.mm` carries, for the same reason and with the same rules: only this
    /// section is encrypted, so the manifest stays readable by BMM, by BetterCommunity's
    /// inspector and by a person deciding whether to trust it.
    ///
    /// Absent from every repo that carries none, which is almost all of them — and absent
    /// from every manifest written before this existed, which is why it is `default`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credentials: Option<serde_json::Value>,
}

/// One non-mod thing a repo carries.
///
/// Two shapes, one struct:
///
///  - **A file that travels with the repo** — a plugin, an automation, a theme, a mod list,
///    a bundle. `file` names it under `extras/<kind>/`, resolved exactly like a mod file is,
///    so the same base URL, the same layout override and the same hash check apply.
///  - **An address** — a catalogue to follow, or an app to fetch. `url` carries it and no
///    bytes are copied, because a catalogue is a thing that CHANGES: freezing a copy of one
///    into a repo would publish a snapshot that silently stops matching its source.
///
/// Exactly one of the two is set. An entry with neither is dropped by the reader rather
/// than shown as something that cannot be acted on.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoExtra {
    /// `plugin` · `task` · `theme` · `modlist` · `bundle` · `catalog` · `app`.
    ///
    /// A String, not an enum: an unknown kind must survive the parse. serde on an enum
    /// refuses the document, which would mean a repo published by a newer BMM failing to
    /// load AT ALL on an older one — over an item it merely could not install.
    pub kind: String,
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// The carried file, under `extras/<kind>/<relative_path>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<RepoFile>,
    /// The address, for `catalog` and `app`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// For a `catalog`: which subsystem it belongs to (`app`, `plugin`, `theme`, `list`…),
    /// matching the catalog-index vocabulary the client already routes on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog_type: Option<String>,
    /// A `modlist` whose contents are sealed. Stated in the manifest so the screen can say
    /// so BEFORE the download — finding out afterwards means a file you cannot open and no
    /// idea whether that is the point or a corruption.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub locked: bool,
    /// Built-in icon name, shared so the receiver sees what the publisher saw.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
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
            extras: Vec::new(),
            credentials: None,
        }
    }
}

#[cfg(test)]
mod bcweb_manifest_tests {
    use super::*;

    /// Captured VERBATIM from a running BCWEB instance: GET /hosting/<owner>/<repo>/repo.json
    /// on a hosted repo where the owner uploaded NO manifest at all. BCWEB synthesises it
    /// from the files it already holds — path, byte size and the sha256 computed at upload.
    ///
    /// The point of pinning it here is that the producer is JavaScript in another
    /// repository and the consumer is this struct. Nothing else makes them agree, and the
    /// failure would be quiet: serde would reject the document and the repo would simply
    /// look empty rather than raise anything a user could act on.
    const GENERATED: &str = include_str!("../../tests/bcweb_generated_manifest.json");

    #[test]
    fn a_bcweb_generated_manifest_deserializes() {
        let repo: ServerRepo =
            serde_json::from_str(GENERATED).expect("BCWEB's generated manifest must load");

        assert_eq!(repo.name, "Auto Manifest");
        assert_eq!(repo.game_name, "DCS World", "derived from the repo's first tag");
        assert_eq!(repo.profiles.len(), 1);

        let mods = &repo.profiles[0].mods;
        // One entry per top-level directory, plus one for files loose at the root — named
        // after the repo, so nothing is dropped on the floor.
        let names: Vec<&str> = mods.iter().map(|m| m.name.as_str()).collect();
        assert!(names.contains(&"cool-mod"), "{names:?}");
        assert!(names.contains(&"other-mod"), "{names:?}");
        assert!(names.contains(&"Auto Manifest"), "loose files need a home: {names:?}");

        // Paths are relative to their mod directory, not to the repo root.
        let cool = mods.iter().find(|m| m.name == "cool-mod").unwrap();
        let paths: Vec<&str> = cool.files.iter().map(|f| f.relative_path.as_str()).collect();
        assert!(paths.contains(&"Data/a.dds"), "{paths:?}");
        assert!(!paths.iter().any(|p| p.starts_with("cool-mod/")), "{paths:?}");

        // Sizes survive as exact byte counts — the whole reason a manifest beats guessing.
        let a = cool.files.iter().find(|f| f.relative_path == "Data/a.dds").unwrap();
        assert_eq!(a.size, 2048);
        assert_eq!(a.sha256_hash, "bb22");

        // A file uploaded before hashing existed carries an empty hash rather than a
        // wrong one. BMM then re-hashes that single file, which is the correct outcome.
        let other = mods.iter().find(|m| m.name == "other-mod").unwrap();
        assert_eq!(other.files[0].sha256_hash, "");
    }
}

#[cfg(test)]
mod manifest_tolerance_tests {
    use super::*;

    #[test]
    fn an_empty_document_becomes_a_usable_manifest() {
        // What read_local_repo relies on for a folder with no repo.json. If any field stops
        // being defaulted this fails here rather than as "no existing repo" in front of
        // somebody pointing at a perfectly good folder.
        let r: ServerRepo = serde_json::from_str("{}").expect("an empty object must deserialise");
        assert_eq!(r.version, "1.0");
        assert!(!r.created_at.is_empty(), "a date is invented rather than left blank");
        assert!(!r.created_at.starts_with("1970"), "and it is now, not the epoch");
    }

    #[test]
    fn a_manifest_from_an_older_bmm_still_loads() {
        // No createdAt, no gameName, no version — the shape before those fields existed. It
        // used to fail with a parse error naming a field, which reads as a corrupt file.
        let old = r#"{"name":"My repo","mods":[],"profiles":[]}"#;
        let r: ServerRepo = serde_json::from_str(old).expect("an old manifest must still load");
        assert_eq!(r.name, "My repo", "and it keeps what it DID say");
        assert_eq!(r.version, "1.0");
    }

    #[test]
    fn a_name_is_never_defaulted_to_nothing() {
        // A default that round-trips as "" would rename a repo to nothing the next time the
        // manifest is written — silently, on somebody else's subscribers.
        let r: ServerRepo = serde_json::from_str("{}").unwrap();
        assert!(!r.name.trim().is_empty());
    }
}
