use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct ModFile {
    /// Relative path inside the mod folder (source)
    pub source: PathBuf,
    /// Relative path from game root (destination)
    pub target: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ModStatus {
    Enabled,
    Disabled,
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConflictCategory {
    Intra, // Within the same profile
    Inter, // With another profile on the same root
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConflictStatus {
    Active,    // Red: Conflict is currently active on disk
    Potential, // Yellow: File overlap exists but the other mod is disabled
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictReport {
    pub category: ConflictCategory,
    pub status: ConflictStatus,
    pub other_mod_id: String,
    pub other_mod_name: String,
    pub other_profile_name: String,
    pub file_count: usize,
    #[serde(default)]
    pub activation_order: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub description: Option<String>,
    pub dependencies: Vec<String>,
    pub enabled: bool,
    #[serde(default)]
    pub conflicts: Vec<ConflictReport>,
    /// Absolute path to the mod's root folder (stored in mods_path from profile)
    pub mod_folder_path: PathBuf,
    pub status: ModStatus,
    pub added_at: String,
    /// List of relative paths that were installed to game dir (tracked for clean removal)
    #[serde(default)]
    pub installed_files: Vec<String>,
    /// Download links for this mod (for .MM export/sharing)
    #[serde(default)]
    pub download_links: Vec<DownloadLink>,
    /// Custom tags associated with this mod
    #[serde(default)]
    pub tags: Vec<String>,
    /// Instructions on placement and special setup (inherited from .MM)
    #[serde(default)]
    pub install_notes: String,
    /// Activation order (0 = first, higher = more recent)
    #[serde(default)]
    pub activation_order: u32,
    /// Cached list of relative paths for conflict detection
    #[serde(default)]
    pub cached_files: Option<Vec<String>>,
    /// Last modification time of the mod folder during the last scan
    #[serde(default)]
    pub last_scan_mtime: u64,
    /// Optional map of file relative paths to their SHA256 hashes for integrity verification
    #[serde(default)]
    pub file_hashes: Option<std::collections::HashMap<String, String>>,
    /// Timestamp of when the hashes were last calculated
    #[serde(default)]
    pub file_hashes_timestamp: Option<String>,
    /// Whether the last deep integrity check failed
    #[serde(default)]
    pub file_hashes_invalid: Option<bool>,
    /// Stable cross-machine identifier derived from bmm.json or folder content fingerprint.
    /// None until first scan after this field was introduced.
    #[serde(default)]
    pub content_id: Option<String>,
    // ── Update system ────────────────────────────────────────────────────
    /// Repository this mod was synced from (normalised repo URL). None for
    /// mods added manually / from a site.
    #[serde(default)]
    pub source_repo: Option<String>,
    /// Stable id of this mod inside its `source_repo` manifest (survives across
    /// version bumps, unlike content_id). Used to detect repo updates.
    #[serde(default)]
    pub repo_mod_id: Option<String>,
    /// Optional per-mod "own repo" URL for mods added outside a repo (e.g. a
    /// site download that publishes its own repo.json). Checked independently.
    #[serde(default)]
    pub update_url: Option<String>,
    /// User-configured additional update sources. A mod can be linked to one or
    /// more repos that act as updaters; each entry may carry the mod's id inside
    /// that repo (falls back to `repo_mod_id` when empty). These are checked in
    /// addition to `source_repo` / `update_url`.
    #[serde(default)]
    pub update_sources: Vec<UpdateSource>,
    /// Optional direct-download archive URL used to update this mod (e.g. a
    /// GitHub release asset or a site's "latest" zip). Updates are detected by
    /// comparing the remote validator against `direct_sig`, and applied by
    /// re-downloading + overwriting the mod folder.
    #[serde(default)]
    pub direct_url: Option<String>,
    /// Last seen validator (ETag, Last-Modified or Content-Length) for
    /// `direct_url`. A differing value on a later check means a new build is
    /// available. None until a baseline is captured.
    #[serde(default)]
    pub direct_sig: Option<String>,
}

/// One configurable place to look for updates to a mod. These act as fallbacks,
/// tried after the mod's primary source. A source is either a repo (`kind =
/// "repo"`, default) or a direct-download archive (`kind = "direct"`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UpdateSource {
    /// The source URL: a repo.json for `repo`, an archive URL for `direct`.
    #[serde(alias = "repoUrl")]
    pub repo_url: String,
    /// (repo only) This mod's id inside that repo's manifest. `None`/empty → fall
    /// back to the mod's main `repo_mod_id`.
    #[serde(default, alias = "repoModId")]
    pub repo_mod_id: Option<String>,
    /// Source kind: `"repo"` (default) or `"direct"`.
    #[serde(default = "default_source_kind")]
    pub kind: String,
    /// (direct only) Last seen validator (ETag/Last-Modified/size) for this
    /// archive URL; a change means a new build. None until a baseline is captured.
    #[serde(default)]
    pub sig: Option<String>,
}

fn default_source_kind() -> String { "repo".to_string() }

impl UpdateSource {
    pub fn is_direct(&self) -> bool { self.kind.eq_ignore_ascii_case("direct") }
}

/// A download link for a mod
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DownloadLink {
    pub url: String,
    pub link_type: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModMetadata {
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub description: Option<String>,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub download_links: Vec<DownloadLink>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

impl From<&ModEntry> for ModMetadata {
    fn from(m: &ModEntry) -> Self {
        Self {
            name: m.name.clone(),
            version: m.version.clone(),
            author: m.author.clone(),
            description: m.description.clone(),
            dependencies: m.dependencies.clone(),
            download_links: m.download_links.clone(),
            tags: Some(m.tags.clone()),
        }
    }
}

impl ModEntry {
    pub fn new(name: String, mod_folder_path: PathBuf) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            version: "0.0.1".to_string(),
            author: None,
            description: None,
            dependencies: Vec::new(),
            enabled: false,
            conflicts: Vec::new(),
            mod_folder_path,
            status: ModStatus::Disabled,
            added_at: chrono::Local::now().to_rfc3339(),
            installed_files: Vec::new(),
            download_links: Vec::new(),
            tags: Vec::new(),
            install_notes: String::new(),
            activation_order: 0,
            cached_files: None,
            last_scan_mtime: 0,
            file_hashes: None,
            file_hashes_timestamp: None,
            file_hashes_invalid: None,
            content_id: None,
            source_repo: None,
            repo_mod_id: None,
            update_url: None,
            update_sources: Vec::new(),
            direct_url: None,
            direct_sig: None,
        }
    }

    pub fn load_metadata(&mut self) -> bool {
        // Disabled: No longer reading _InfoBetterMod.Manager_ files as per user request
        false
    }
}

/// Derives a stable cross-machine identifier for a mod folder.
///
/// Priority:
///   1. `bmm.json` in the folder root with a non-empty `id` field (mod-author provided)
///   2. SHA-256 fingerprint of sorted (relative_path, file_size) pairs — fast, no content reads
///
/// The result is deterministic: same files on any machine → same content_id.
pub fn derive_content_id(folder_path: &Path) -> Option<String> {
    use sha2::{Digest, Sha256};

    // 1. Check for bmm.json
    let bmm_json_path = folder_path.join("bmm.json");
    if bmm_json_path.exists() {
        if let Ok(raw) = std::fs::read_to_string(&bmm_json_path) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(id) = val.get("id").and_then(|v| v.as_str()) {
                    let trimmed = id.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
    }

    // 2. Fingerprint: collect (relative_path_str, size) pairs, sort, hash.
    //    For an ARCHIVE mod we read the entries straight from the archive — the
    //    (rel, size) pairs are identical to the unpacked folder, so a zipped mod
    //    and its unzipped twin get the SAME content_id.
    let mut entries: Vec<(String, u64)> = if crate::archive::is_archive(folder_path) {
        crate::archive::archive_entries(folder_path).unwrap_or_default()
    } else {
        let mut e: Vec<(String, u64)> = Vec::new();
        collect_file_entries(folder_path, folder_path, &mut e);
        e
    };

    if entries.is_empty() {
        return None;
    }

    entries.sort_unstable_by(|a, b| a.0.cmp(&b.0));

    let mut hasher = Sha256::new();
    for (rel_path, size) in &entries {
        hasher.update(rel_path.as_bytes());
        hasher.update(b"\x00");
        hasher.update(size.to_le_bytes());
    }
    let hash = hasher.finalize();
    Some(format!("{:x}", hash)[..32].to_string())
}

fn collect_file_entries(root: &Path, current: &Path, out: &mut Vec<(String, u64)>) {
    let Ok(dir) = std::fs::read_dir(current) else { return };
    for entry in dir.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_file_entries(root, &path, out);
        } else if path.is_file() {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            let rel = path.strip_prefix(root).unwrap_or(&path);
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            out.push((rel_str, size));
        }
    }
}

/// Updates `content_id` from already-computed `file_hashes` (true content hash).
/// Skips if bmm.json declares an explicit id. Safe to call every time hashes are refreshed.
pub fn update_content_id_from_hashes(entry: &mut ModEntry) {
    // bmm.json declared id is never overridden
    let bmm_json = entry.mod_folder_path.join("bmm.json");
    if bmm_json.exists() {
        if let Ok(raw) = std::fs::read_to_string(&bmm_json) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) {
                if val.get("id").and_then(|v| v.as_str()).map(|s| !s.trim().is_empty()).unwrap_or(false) {
                    return;
                }
            }
        }
    }

    if let Some(hashes) = &entry.file_hashes {
        if !hashes.is_empty() {
            entry.content_id = Some(content_id_from_file_hashes(hashes));
        }
    }
}

fn content_id_from_file_hashes(hashes: &std::collections::HashMap<String, String>) -> String {
    use sha2::{Digest, Sha256};
    let mut sorted: Vec<(&String, &String)> = hashes.iter().collect();
    sorted.sort_unstable_by_key(|(k, _)| *k);
    let mut hasher = Sha256::new();
    for (path, hash) in sorted {
        hasher.update(path.as_bytes());
        hasher.update(b"\x00");
        hasher.update(hash.as_bytes());
        hasher.update(b"\x00");
    }
    format!("{:x}", hasher.finalize())[..32].to_string()
}
