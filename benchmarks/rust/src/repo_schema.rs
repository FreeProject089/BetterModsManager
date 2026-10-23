//! A faithful mirror of `src-tauri/src/models/repo.rs` (`ServerRepo` and friends),
//! kept self-contained so the JSON benchmark doesn't have to pull in the whole
//! app models graph. Field names/types match the real schema, so `serde_json`
//! does equivalent parsing/serialization work to the app's `repo.json` handling.

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
    pub upload_limit: Option<u32>,
    pub profiles: Vec<RepoProfile>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoProfile {
    pub id: String,
    pub name: String,
    pub game_name: String,
    pub mods: Vec<RepoMod>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
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
    pub download_links: Vec<DownloadLink>,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub changelog: Option<String>,
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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoChunk {
    pub size: u32,
    pub sha256_hash: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadLink {
    pub url: String,
    pub label: Option<String>,
}

/// Build a deterministic repo with `profiles` profiles, `mods_per` mods each,
/// and `files_per` files per mod — a realistic large `repo.json` for parsing.
pub fn sample_repo(profiles: usize, mods_per: usize, files_per: usize) -> ServerRepo {
    let mk_hash = |i: usize| format!("{:064x}", (i as u128).wrapping_mul(0x9E3779B97F4A7C15));
    let profiles = (0..profiles)
        .map(|p| RepoProfile {
            id: format!("profile-{p}"),
            name: format!("Profile {p}"),
            game_name: "DCS World".into(),
            icon: Some("plane".into()),
            color: Some("#3b82f6".into()),
            mods: (0..mods_per)
                .map(|m| RepoMod {
                    id: format!("mod-{p}-{m}"),
                    name: format!("Civil Aircraft Mod {m}"),
                    version: "1.2.3".into(),
                    author: Some("AuthorName".into()),
                    description: Some("A reasonably sized description string that mirrors real repo entries with a few sentences of prose.".into()),
                    tags: vec![
                        RepoTag { id: "t1".into(), name: "Aircraft".into(), color_bg: "#222".into(), color_text: "#fff".into() },
                        RepoTag { id: "t2".into(), name: "Civilian".into(), color_bg: "#333".into(), color_text: "#eee".into() },
                    ],
                    files: (0..files_per)
                        .map(|f| RepoFile {
                            relative_path: format!("Mods/aircraft/mod_{m}/textures/asset_{f:04}.dds"),
                            size: 1024 * (f as u64 + 1),
                            sha256_hash: mk_hash(p * 1_000_000 + m * 1000 + f),
                            chunks: None,
                        })
                        .collect(),
                    download_links: vec![DownloadLink { url: format!("https://example.com/mod-{p}-{m}.zip"), label: Some("Mirror 1".into()) }],
                    dependencies: vec![],
                    changelog: Some("- Fixed textures\n- Updated cockpit".into()),
                })
                .collect(),
        })
        .collect();

    ServerRepo {
        name: "My Repo".into(),
        description: Some("Shared mods".into()),
        author: Some("Me".into()),
        author_id: Some("uid-123".into()),
        signature: Some("sig".into()),
        version: "1.0.0".into(),
        game_name: "DCS World".into(),
        created_at: "2026-06-13T00:00:00Z".into(),
        seed: Some("seed".into()),
        upload_limit: Some(2048),
        profiles,
    }
}
