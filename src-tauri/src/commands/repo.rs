use tauri::Emitter;
use crate::fs_utils;
use crate::models::repo::{RepoChunk, RepoFile, RepoMod, ServerRepo};
use crate::state::AppState;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Window, State, Manager};
use crate::commands::ban_manager;
use crate::commands::whitelist_manager;
use crate::models::repo::RepoTag;
use futures::StreamExt;
use tokio::time::{sleep, Duration};

#[derive(serde::Serialize, Clone)]
pub struct RepoProgress {
    pub step: String,
    pub progress: f32, // 0.0 to 100.0
    pub current_file: String,
}

#[derive(serde::Serialize, serde::Deserialize, Default, Clone)]
pub struct ProfileSyncSummary {
    pub name: String,
    pub mods_added: usize,
    pub mods_updated: usize,
    pub mods_removed: usize,
    pub files_downloaded: usize,
    pub bytes_downloaded: u64,
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
pub struct SyncSummary {
    pub profiles: Vec<ProfileSyncSummary>,
}

#[derive(serde::Deserialize)]
pub struct MiniServerExportOptions {
    pub port: u16,
    pub upload_limit: u32,
    pub admin_password: String,
    /// Optional password a SUBSCRIBER must supply to download from this repo (empty = open).
    /// Distinct from admin_password, which only protects the host's own admin panel.
    #[serde(default)]
    pub download_password: String,
    pub server_version: u8,
    pub use_cloudflare: bool,
    pub use_upnp: bool,
    pub enable_docker: Option<bool>,
    pub docker_host_type: Option<String>,
    pub server_type: Option<String>,
}

pub(crate) const CHUNK_SIZE: usize = 4 * 1024 * 1024; // 4MB
use std::time::Instant;
use std::sync::Mutex as StdMutex;
lazy_static::lazy_static! {
    static ref LAST_EMIT: StdMutex<Option<Instant>> = StdMutex::new(None);
}

fn format_bytes(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB"];
    let mut size = bytes as f64;
    let mut unit_index = 0;
    
    while size >= 1024.0 && unit_index < UNITS.len() - 1 {
        size /= 1024.0;
        unit_index += 1;
    }
    
    if unit_index == 0 {
        format!("{} {}", bytes, UNITS[unit_index])
    } else {
        format!("{:.2} {}", size, UNITS[unit_index])
    }
}

/// Where a client fetches one mod file from.
///
/// `files_base_url` lets a manifest published in one place point at mods hosted in another —
/// the case where someone already serves their files and does not want to upload them a
/// second time just to have a repo. When it is absent, which is every manifest generated
/// before the field existed, the files sit next to `repo.json` and this resolves exactly as
/// it always did.
///
/// Both bases are normalised here rather than at their call sites: `base_url` already ends
/// with a slash, a hand-typed `files_base_url` may or may not, and getting that wrong yields
/// `host//mods/…` or `hostmods/…` — neither of which fails loudly, they just 404 per file.
///
/// `files_layout` covers the rest of the same problem: hosting that already serves the mods
/// under a directory of its own choosing. It is a template over `{id}` and `{path}`, and the
/// default — `mods/{id}/{path}` — is what every manifest written before it existed means.
pub(crate) fn mod_file_url(
    base_url: &str,
    files_base_url: Option<&str>,
    files_layout: Option<&str>,
    mod_id: &str,
    relative_path: &str,
) -> String {
    let base = files_base_url
        .map(str::trim)
        .filter(|b| !b.is_empty())
        .map(|b| format!("{}/", b.trim_end_matches('/')))
        .unwrap_or_else(|| base_url.to_string());
    let path = relative_path.replace('\\', "/");
    let layout = files_layout
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .unwrap_or("mods/{id}/{path}");
    // A leading slash in the template would read as "root of the host" once joined, silently
    // dropping any path already in the base URL.
    let tail = layout
        .trim_start_matches('/')
        .replace("{id}", mod_id)
        .replace("{path}", &path);
    format!("{}{}", base, tail)
}

pub(crate) fn compute_file_hash_and_chunks(path: &Path, need_chunks: bool) -> Result<(String, Option<Vec<RepoChunk>>), String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut reader = std::io::BufReader::with_capacity(128 * 1024, file);
    let mut global_hasher = Sha256::new();
    let mut chunks = Vec::new();
    let mut buffer = vec![0u8; CHUNK_SIZE];
    
    loop {
        let n = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        
        let chunk_data = &buffer[..n];
        global_hasher.update(chunk_data);
        
        if need_chunks {
            let mut chunk_hasher = Sha256::new();
            chunk_hasher.update(chunk_data);
            chunks.push(RepoChunk {
                size: n as u32,
                sha256_hash: format!("{:x}", chunk_hasher.finalize()),
            });
        }
    }
    
    Ok((
        format!("{:x}", global_hasher.finalize()),
        if need_chunks && !chunks.is_empty() { Some(chunks) } else { None }
    ))
}

fn compute_local_chunk_hashes(path: &Path) -> Result<Vec<String>, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut chunk_hashes = Vec::new();
    let mut buffer = vec![0u8; CHUNK_SIZE];
    
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        
        let mut hasher = Sha256::new();
        hasher.update(&buffer[..n]);
        chunk_hashes.push(format!("{:x}", hasher.finalize()));
    }
    
    Ok(chunk_hashes)
}

#[tauri::command]
pub async fn export_server_repo(
    window: Window,
    handle: tauri::AppHandle,
    state: State<'_, AppState>,
    profile_ids: Vec<String>,
    output_dir: String,
    author_name: String,
    seed: Option<String>,
    modpacks_share_config: Option<Vec<crate::models::repo::RepoModpackShare>>,
    zip_output: bool,
    zip_mods: bool,
    server_options: Option<MiniServerExportOptions>,
) -> Result<(), String> {
    if author_name.trim().is_empty() {
        return Err("repo.errAuthorRequired".to_string());
    }

    let mut _tracker = crate::commands::resource_tracker::OpTracker::start("REPO/export")
        .with_subject(format!("{} profile(s) → {}", profile_ids.len(), output_dir));

    let mut _temp_dir: Option<tempfile::TempDir> = None;
    let output_path = if zip_output {
        let td = tempfile::tempdir().map_err(|e| format!("Failed to create temp dir: {}", e))?;
        let path = td.path().to_path_buf();
        _temp_dir = Some(td);
        path
    } else {
        let p = PathBuf::from(&output_dir);
        if !p.exists() {
            fs::create_dir_all(&p).map_err(|_| "repo.errCreateOutputDir".to_string())?;
        } else if !p.is_dir() {
            return Err("repo.errOutputDirNotDir".to_string());
        }
        p
    };

    state.install_cancelled.store(false, std::sync::atomic::Ordering::SeqCst);
    let cancel_flag = state.install_cancelled.clone();

    let repo_mods_dir = output_path.join("mods");
    if !repo_mods_dir.exists() {
        fs::create_dir_all(&repo_mods_dir).map_err(|_| "repo.errCreateModDir".to_string())?;
    }

    // Determine the seed to use
    let mut final_seed = seed;
    
    // If no seed provided by user, try to recover existing one or generate new
    if final_seed.is_none() {
        let manifest_path = output_path.join("repo.json");
        if manifest_path.exists() {
            if let Ok(content) = fs::read_to_string(&manifest_path) {
                if let Ok(existing_repo) = serde_json::from_str::<ServerRepo>(&content) {
                    final_seed = existing_repo.seed;
                }
            }
        }
    }

    let (mut repo, profiles_data, all_tags) = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        
        let first_profile = data.profiles.iter().find(|p| profile_ids.contains(&p.id))
            .ok_or("repo.errNoProfile")?;

        let mut repo = ServerRepo::new(
            format!("{} Repo", first_profile.name),
            first_profile.game_name.clone(),
        );

        repo.seed = Some(final_seed.unwrap_or_else(|| {
            use rand::{thread_rng, Rng};
            use rand::distributions::Alphanumeric;
            thread_rng()
                .sample_iter(&Alphanumeric)
                .take(32)
                .map(char::from)
                .collect()
        }));
        
        if !author_name.trim().is_empty() {
            repo.author = Some(author_name.clone());
        }

        repo.modpacks = modpacks_share_config;

        let mut profiles_data = Vec::new();
        for pid in &profile_ids {
            if let Some(profile) = data.profiles.iter().find(|p| &p.id == pid) {
                let mut exported_mods = Vec::new();
                for m in &data.mods {
                    if m.mod_folder_path.starts_with(&profile.mods_path) {
                        exported_mods.push(m.clone());
                    } else {
                        match (m.mod_folder_path.canonicalize(), profile.mods_path.canonicalize()) {
                            (Ok(a), Ok(b)) => if a.starts_with(&b) { exported_mods.push(m.clone()); },
                            _ => {}
                        }
                    }
                }
                profiles_data.push((profile.clone(), exported_mods));
            }
        }
        (repo, profiles_data, data.custom_tags.clone())
    };

    let total_profiles = profiles_data.len();

    // Every mod id that is part of THIS export (across all exported profiles).
    // Used to keep only the dependencies whose target mod is also exported —
    // cross-profile deps pointing at a NON-exported profile are dropped.
    let exported_mod_ids: std::collections::HashSet<String> = profiles_data.iter()
        .flat_map(|(_p, mods)| mods.iter().map(|m| m.id.clone()))
        .collect();

    // Loop over each profile
    for (p_idx, (profile, exported_mods)) in profiles_data.into_iter().enumerate() {
        if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("repo.cancelled".to_string());
        }
        // Embed the custom icon (if any) as a data-URI so it ships with the repo.
        let icon_image_data: Option<String> = profile.icon_image.as_ref().and_then(|fname| {
            let data_dir = state.data_path.parent().unwrap_or(std::path::Path::new("."));
            let icon_path = data_dir.join(fname);
            std::fs::read(&icon_path).ok().map(|bytes| {
                use base64::{Engine as _, engine::general_purpose};
                let ext = icon_path.extension().and_then(|e| e.to_str()).unwrap_or("png").to_lowercase();
                let mime = match ext.as_str() {
                    "png" => "image/png", "jpg" | "jpeg" => "image/jpeg",
                    "webp" => "image/webp", "gif" => "image/gif", "svg" => "image/svg+xml",
                    _ => "application/octet-stream",
                };
                format!("data:{};base64,{}", mime, general_purpose::STANDARD.encode(&bytes))
            })
        });
        let mut repo_profile = crate::models::repo::RepoProfile {
            id: profile.id.clone(),
            name: profile.name.clone(),
            game_name: profile.game_name.clone(),
            mods: Vec::new(),
            icon: profile.icon.clone(),
            color: profile.color.clone(),
            icon_image: icon_image_data,
        };

        let total_mods = exported_mods.len();
        for (idx, mod_entry) in exported_mods.iter().enumerate() {
            let _ = window.emit("bmm://repo-export-progress", RepoProgress {
                step: format!(r#"{{"key":"repo.stepPreparing","profile":"{}","mod":"{}","current":{},"total":{}}}"#, profile.name, mod_entry.name, idx + 1, total_mods),
                progress: (((p_idx as f32 / total_profiles as f32) + ((idx as f32 / total_mods as f32) * (1.0 / total_profiles as f32))) * 85.0),
                current_file: String::new(),
            });

            if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
                return Err("repo.cancelled".to_string());
            }

            let target_mod_dir = repo_mods_dir.join(&mod_entry.id);
            if !target_mod_dir.exists() {
                fs::create_dir_all(&target_mod_dir).map_err(|_| "repo.errCreateModDir".to_string())?;
            }

            // Resolve Tags
            let mut resolved_tags = Vec::new();
            for tag_id in &mod_entry.tags {
                if let Some(tag_data) = all_tags.iter().find(|t| &t.id == tag_id) {
                    resolved_tags.push(RepoTag {
                        id: tag_data.id.clone(),
                        name: tag_data.name.clone(),
                        color_bg: tag_data.color.clone(),
                        color_text: "#FFFFFF".to_string(),
                    });
                }
            }

            // Keep only deps whose target mod is part of this export. A dep may be
            // a bare "mod-id" or a cross-profile "profile_id::mod-id" — we resolve
            // to the bare mod id and drop it if that mod isn't being exported.
            let mut dep_ids: Vec<String> = Vec::new();
            for d in &mod_entry.dependencies {
                let mid = d.split_once("::").map(|(_, m)| m.to_string()).unwrap_or_else(|| d.clone());
                if exported_mod_ids.contains(&mid) && !dep_ids.contains(&mid) {
                    dep_ids.push(mid);
                }
            }

            let mut repo_mod = RepoMod {
                id: mod_entry.id.clone(),
                name: mod_entry.name.clone(),
                version: mod_entry.version.clone(),
                author: mod_entry.author.clone(),
                description: mod_entry.description.clone(),
                tags: resolved_tags,
                files: Vec::new(),
                archive: None,
                download_links: mod_entry.download_links.clone(),
                dependencies: dep_ids,
                changelog: None,
                update_url: mod_entry.update_url.clone(),
                direct_url: mod_entry.direct_url.clone(),
                update_sources: mod_entry.update_sources.iter()
                    .map(|s| crate::models::mod_entry::UpdateSource { sig: None, ..s.clone() }).collect(),
            };

            // Archived mods (.zip) are read from their extracted cache view so the
            // repo packs the actual files (fixes "server repo with .zip bugs").
            let read_root = crate::archive::mod_read_root(&mod_entry.mod_folder_path);

            // ── "Zip mods" mode: pack the whole mod into a single mods/<id>.zip ──
            if zip_mods {
                let zip_path = repo_mods_dir.join(format!("{}.zip", mod_entry.id));
                zip_directory(&read_root, &zip_path, cancel_flag.clone())
                    .map_err(|e| format!("repo.errZipMod:{}", e))?;
                let size = fs::metadata(&zip_path).map(|m| m.len()).unwrap_or(0);
                let (sha256_hash, _) = compute_file_hash_and_chunks(&zip_path, false)?;
                repo_mod.archive = Some(RepoFile {
                    relative_path: format!("mods/{}.zip", mod_entry.id),
                    size,
                    sha256_hash,
                    chunks: None,
                });
                // The per-file folder isn't used in this mode.
                let _ = fs::remove_dir_all(&target_mod_dir);
                let _ = window.emit("bmm://repo-export-progress", RepoProgress {
                    step: format!(r#"{{"key":"repo.stepExporting","profile":"{}","mod":"{}","current":{},"total":{}}}"#, profile.name, mod_entry.name, idx + 1, total_mods),
                    progress: (((p_idx as f32 / total_profiles as f32) + ((idx as f32 / total_mods as f32) * (1.0 / total_profiles as f32))) * 85.0),
                    current_file: format!("{}.zip", mod_entry.id),
                });
                repo_profile.mods.push(repo_mod);
                continue;
            }

            let files = fs_utils::list_mod_files(&read_root).map_err(|e| e.to_string())?;
            let total_files = files.len();

            use rayon::prelude::*;
            use std::sync::atomic::{AtomicUsize, Ordering};

            let f_idx_atomic = AtomicUsize::new(0);
            let repo_files: Result<Vec<RepoFile>, String> = files.par_iter().map(|rel_path| {
                let src_path = read_root.join(rel_path);
                let dst_path = target_mod_dir.join(rel_path);
                
                if let Some(parent) = dst_path.parent() {
                    if !parent.exists() {
                        fs::create_dir_all(parent).map_err(|_| "repo.errCreateSubfolder".to_string())?;
                    }
                }

                let f_idx = f_idx_atomic.fetch_add(1, Ordering::SeqCst);
                if f_idx % 5 == 0 && cancel_flag.load(Ordering::SeqCst) {
                    return Err("repo.cancelled".to_string());
                }

                // Copy file
                fs::copy(&src_path, &dst_path).map_err(|_| "repo.errCopyFile".to_string())?;

                // Compute Hash
                let size = fs::metadata(&dst_path).map(|m| m.len()).unwrap_or(0);
                let (sha256_hash, chunks) = compute_file_hash_and_chunks(&dst_path, size > CHUNK_SIZE as u64)?;

                // Time-based throttling for progress (max every 100ms)
                let should_emit = {
                    let mut last = LAST_EMIT.lock().unwrap();
                    match *last {
                        Some(instant) if instant.elapsed().as_millis() < 100 => false,
                        _ => {
                            *last = Some(Instant::now());
                            true
                        }
                    }
                };

                if should_emit || f_idx == total_files - 1 {
                    let _ = window.emit("bmm://repo-export-progress", RepoProgress {
                        step: format!(r#"{{"key":"repo.stepExporting","profile":"{}","mod":"{}","current":{},"total":{}}}"#, profile.name, mod_entry.name, idx + 1, total_mods),
                        progress: (((p_idx as f32 / total_profiles as f32) + ((idx as f32 / total_mods as f32) * (1.0 / total_profiles as f32)) + ((f_idx as f32 / total_files as f32) * (1.0 / (total_mods * total_profiles) as f32))) * 85.0),
                        current_file: rel_path.to_string_lossy().to_string(),
                    });
                }

                Ok(RepoFile {
                    relative_path: rel_path.to_string_lossy().to_string().replace("\\", "/"),
                    size,
                    sha256_hash,
                    chunks,
                })
            }).collect();

            let repo_files = repo_files?;
            repo_mod.files = repo_files;
            repo_profile.mods.push(repo_mod);
        }
        repo.profiles.push(repo_profile);
    }

    let _ = window.emit("bmm://repo-export-progress", RepoProgress {
        step: "repo.stepFinalizing".to_string(),
        progress: 87.0,
        current_file: "repo.json".to_string(),
    });

    // Sign the repo (using compact JSON for the signature payload to be stable)
    let json_to_sign = serde_json::to_string(&repo).map_err(|e| e.to_string())?;
    let (author_id, signature) = super::security::sign_message(&handle, json_to_sign.as_bytes())?;
    
    repo.author_id = Some(author_id);
    repo.signature = Some(signature);

    let final_json = serde_json::to_string_pretty(&repo).map_err(|e| e.to_string())?;
    let manifest_path = output_path.join("repo.json");
    fs::write(&manifest_path, final_json).map_err(|_| "repo.errWriteManifest".to_string())?;

    // Generate Info.json with repository statistics
    let mut total_mods_count = 0;
    let mut total_size_bytes: u64 = 0;
    let mut total_files_count = 0;
    
    for profile in &repo.profiles {
        total_mods_count += profile.mods.len();
        for mod_entry in &profile.mods {
            total_files_count += mod_entry.files.len();
            for file in &mod_entry.files {
                total_size_bytes += file.size;
            }
        }
    }

    #[derive(serde::Serialize)]
    struct RepoInfo {
        name: String,
        author: Option<String>,
        game_name: String,
        profiles_count: usize,
        mods_count: usize,
        files_count: usize,
        total_size_bytes: u64,
        total_size_formatted: String,
        version: String,
        created_at: String,
        seed: Option<String>,
        author_id: Option<String>,
        modpacks_count: usize,
    }

    let info = RepoInfo {
        name: repo.name.clone(),
        author: repo.author.clone(),
        game_name: repo.game_name.clone(),
        profiles_count: repo.profiles.len(),
        mods_count: total_mods_count,
        files_count: total_files_count,
        total_size_bytes,
        total_size_formatted: format_bytes(total_size_bytes),
        version: "1.0".to_string(),
        created_at: chrono::Local::now().to_rfc3339(),
        seed: repo.seed.clone(),
        author_id: repo.author_id.clone(),
        modpacks_count: repo.modpacks.as_ref().map_or(0, |m| m.len()),
    };

    let info_json = serde_json::to_string_pretty(&info).map_err(|e| e.to_string())?;
    let info_path = output_path.join("Info.json");
    fs::write(&info_path, info_json).map_err(|_| "repo.errWriteInfo".to_string())?;

    // Auto-generate mini server by default if it's a new export? 
    // Actually better to have the dedicated button as requested.

    // 12. Copy Bans/Whitelist if they exist
    if let Ok(wl_path) = whitelist_manager::get_whitelist_file_path(&handle) {
        if wl_path.exists() {
            let _ = fs::copy(wl_path, output_path.join("whitelist.json"));
        }
    }
    if let Ok(ban_path) = ban_manager::get_ban_file_path(&handle) {
        if ban_path.exists() {
            let _ = fs::copy(ban_path, output_path.join("bans.json"));
        }
    }

    // 13. Generate Mini Server if requested
    if let Some(opt) = server_options {
        println!("[REPO] Generating integrated mini-server...");
        let enable_docker = opt.enable_docker.unwrap_or(false);
        let docker_host_type = opt.docker_host_type.unwrap_or_else(|| "linux".to_string());
        let server_type = opt.server_type.unwrap_or_else(|| "user".to_string());
        generate_mini_server_files(
            &handle,
            &output_path,
            opt.port,
            false, // no auto-start for exported zip usually
            opt.use_cloudflare,
            opt.use_upnp,
            "en",
            opt.upload_limit,
            opt.server_version,
            &opt.admin_password,
            &opt.download_password,
            enable_docker,
            &docker_host_type,
            &server_type,
        )?;
    }

    // 14. Zip output if requested
    if zip_output {
        let _ = window.emit("bmm://repo-export-progress", RepoProgress {
            step: "repo.zipping".to_string(),
            progress: 90.0,
            current_file: "".to_string(),
        });
        
        let zip_file_name = format!("BMM-Standalone-Server-{}.zip", chrono::Local::now().format("%Y%m%d-%H%M"));
        // Final destination is output_dir (user's selected folder)
        let final_dest = PathBuf::from(&output_dir);
        if !final_dest.exists() {
            let _ = fs::create_dir_all(&final_dest);
        }
        let zip_path = final_dest.join(&zip_file_name);
        
        let cancel_flag_zip = cancel_flag.clone();
        match zip_directory(&output_path, &zip_path, cancel_flag_zip) {
            Ok(_) => {
                println!("[REPO] Zip created at: {:?}", zip_path);
            },
            Err(e) => {
                // Cleanup partial zip if cancelled
                if zip_path.exists() {
                    let _ = fs::remove_file(&zip_path);
                }
                return Err(format!("Failed to create zip: {}", e));
            }
        }

        // Note: _temp_dir will be dropped here, automatically deleting the unzipped version
    }

    let _ = window.emit("bmm://repo-export-progress", RepoProgress {
        step: "repo.exportDone".to_string(),
        progress: 100.0,
        current_file: String::new(),
    });

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Incremental Server Repo Update
//   Modifies an existing repo (repo.json + mods/ folder) without regenerating
//   everything: add/remove whole profiles, add/update specific mods, remove mods.
// ─────────────────────────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct ProfileAddSpec {
    /// Local profile id to add or merge into the repo.
    /// Accepts both snake_case ("profile_id") from the BMM UI and
    /// camelCase ("profileId") from external API callers.
    #[serde(alias = "profileId")]
    pub profile_id: String,
    /// Specific local mod ids to include. `None`/empty = all mods in that profile.
    #[serde(alias = "modIds", default)]
    pub mod_ids: Option<Vec<String>>,
}

#[derive(serde::Deserialize)]
pub struct RepoUpdateOps {
    /// Mod ids to remove from the repo (across every profile).
    #[serde(default)]
    pub remove_mod_ids: Vec<String>,
    /// Whole profile ids to remove from the repo.
    #[serde(default)]
    pub remove_profile_ids: Vec<String>,
    /// Profiles (and optionally a subset of their mods) to add or update.
    #[serde(default)]
    pub add_profiles: Vec<ProfileAddSpec>,
    /// Optional per-mod author changelog text, keyed by local mod id. Written to
    /// the resulting `RepoMod.changelog` so users see "what changed" when an
    /// update is detected. Accepts camelCase ("modChangelogs") from API callers.
    #[serde(alias = "modChangelogs", default)]
    pub mod_changelogs: std::collections::HashMap<String, String>,
}

#[tauri::command]
pub async fn update_server_repo(
    window: Window,
    handle: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_dir: String,
    author_name: Option<String>,
    ops: RepoUpdateOps,
) -> Result<RepoUpdateResult, String> {
    let output_path = PathBuf::from(&repo_dir);
    let manifest_path = output_path.join("repo.json");
    if !manifest_path.exists() {
        return Err("repo.errNoExistingRepo".to_string());
    }

    state.install_cancelled.store(false, std::sync::atomic::Ordering::SeqCst);
    let cancel_flag = state.install_cancelled.clone();

    let repo_mods_dir = output_path.join("mods");
    fs::create_dir_all(&repo_mods_dir).map_err(|_| "repo.errCreateModDir".to_string())?;

    // 1. Load existing repo
    let mut repo: ServerRepo = {
        let content = fs::read_to_string(&manifest_path).map_err(|_| "repo.errReadManifest".to_string())?;
        serde_json::from_str(&content).map_err(|e| format!("repo.json parse error: {}", e))?
    };

    let mut result = RepoUpdateResult::default();

    // 2. Removals — whole profiles
    if !ops.remove_profile_ids.is_empty() {
        let before = repo.profiles.len();
        repo.profiles.retain(|p| !ops.remove_profile_ids.contains(&p.id));
        result.profiles_removed = before - repo.profiles.len();
    }

    // 3. Removals — individual mods (across all profiles)
    if !ops.remove_mod_ids.is_empty() {
        for prof in repo.profiles.iter_mut() {
            let before = prof.mods.len();
            prof.mods.retain(|m| !ops.remove_mod_ids.contains(&m.id));
            result.mods_removed += before - prof.mods.len();
        }
    }

    // 4. Additions — pull local profile/mod data from state (fast, under lock)
    #[derive(Clone)]
    struct PendingMod { profile_id: String, profile: crate::models::profile::Profile, mod_entry: crate::models::mod_entry::ModEntry }
    let data_dir = state.data_path.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| std::path::PathBuf::from("."));
    let (pending, all_tags, resolved_author): (Vec<PendingMod>, Vec<crate::models::tag::TagDef>, Option<String>) = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        let mut pending = Vec::new();
        for spec in &ops.add_profiles {
            if let Some(profile) = data.profiles.iter().find(|p| p.id == spec.profile_id) {
                for m in &data.mods {
                    let in_profile = m.mod_folder_path.starts_with(&profile.mods_path)
                        || matches!((m.mod_folder_path.canonicalize(), profile.mods_path.canonicalize()),
                            (Ok(a), Ok(b)) if a.starts_with(&b));
                    if !in_profile { continue; }
                    if let Some(ids) = &spec.mod_ids {
                        if !ids.is_empty() && !ids.contains(&m.id) { continue; }
                    }
                    pending.push(PendingMod { profile_id: spec.profile_id.clone(), profile: profile.clone(), mod_entry: m.clone() });
                }
            }
        }
        let author = author_name.filter(|a| !a.trim().is_empty()).or_else(|| repo.author.clone());
        (pending, data.custom_tags.clone(), author)
    };
    repo.author = resolved_author;

    // 5. Heavy work (copy + hash + sign + write) on a blocking thread so the
    //    async runtime — and the whole UI — stays responsive. Cancellable per-file.
    let win = window.clone();
    let handle2 = handle.clone();
    let mod_changelogs = ops.mod_changelogs.clone();
    let join = tokio::task::spawn_blocking(move || -> Result<RepoUpdateResult, String> {
        let total = pending.len().max(1);
        for (idx, pm) in pending.into_iter().enumerate() {
            if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) { return Err("repo.cancelled".to_string()); }

            let _ = win.emit("bmm://repo-export-progress", RepoProgress {
                step: format!(r#"{{"key":"repo.stepUpdating","mod":"{}","current":{},"total":{}}}"#, pm.mod_entry.name, idx + 1, total),
                progress: (idx as f32 / total as f32) * 90.0,
                current_file: String::new(),
            });

            let prof_idx = match repo.profiles.iter().position(|p| p.id == pm.profile_id) {
                Some(i) => i,
                None => {
                    let icon_image_data: Option<String> = pm.profile.icon_image.as_ref().and_then(|fname| {
                        let icon_path = data_dir.join(fname);
                        std::fs::read(&icon_path).ok().map(|bytes| {
                            use base64::{Engine as _, engine::general_purpose};
                            let ext = icon_path.extension().and_then(|e| e.to_str()).unwrap_or("png").to_lowercase();
                            let mime = match ext.as_str() {
                                "png" => "image/png", "jpg" | "jpeg" => "image/jpeg",
                                "webp" => "image/webp", "gif" => "image/gif", "svg" => "image/svg+xml",
                                _ => "application/octet-stream",
                            };
                            format!("data:{};base64,{}", mime, general_purpose::STANDARD.encode(&bytes))
                        })
                    });
                    repo.profiles.push(crate::models::repo::RepoProfile {
                        id: pm.profile.id.clone(), name: pm.profile.name.clone(),
                        game_name: pm.profile.game_name.clone(), mods: Vec::new(),
                        icon: pm.profile.icon.clone(), color: pm.profile.color.clone(),
                        icon_image: icon_image_data,
                    });
                    result.profiles_added += 1;
                    repo.profiles.len() - 1
                }
            };

            let mut resolved_tags = Vec::new();
            for tag_id in &pm.mod_entry.tags {
                if let Some(tag_data) = all_tags.iter().find(|t| &t.id == tag_id) {
                    resolved_tags.push(RepoTag {
                        id: tag_data.id.clone(), name: tag_data.name.clone(),
                        color_bg: tag_data.color.clone(), color_text: "#FFFFFF".to_string(),
                    });
                }
            }

            let target_mod_dir = repo_mods_dir.join(&pm.mod_entry.id);
            if target_mod_dir.exists() { let _ = fs::remove_dir_all(&target_mod_dir); }
            fs::create_dir_all(&target_mod_dir).map_err(|_| "repo.errCreateModDir".to_string())?;

            // Archived mods (.zip) read from their extracted cache view.
            let read_root = crate::archive::mod_read_root(&pm.mod_entry.mod_folder_path);
            let files = fs_utils::list_mod_files(&read_root).map_err(|e| e.to_string())?;
            let mut repo_files = Vec::new();
            for rel_path in &files {
                if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) { return Err("repo.cancelled".to_string()); }
                let src_path = read_root.join(rel_path);
                let dst_path = target_mod_dir.join(rel_path);
                if let Some(parent) = dst_path.parent() {
                    fs::create_dir_all(parent).map_err(|_| "repo.errCreateSubfolder".to_string())?;
                }
                fs::copy(&src_path, &dst_path).map_err(|_| "repo.errCopyFile".to_string())?;
                let size = fs::metadata(&dst_path).map(|m| m.len()).unwrap_or(0);
                let (sha256_hash, chunks) = compute_file_hash_and_chunks(&dst_path, size > CHUNK_SIZE as u64)?;
                repo_files.push(RepoFile {
                    relative_path: rel_path.to_string_lossy().to_string().replace("\\", "/"),
                    size, sha256_hash, chunks,
                });
            }

            let repo_mod = RepoMod {
                id: pm.mod_entry.id.clone(), name: pm.mod_entry.name.clone(),
                version: pm.mod_entry.version.clone(), author: pm.mod_entry.author.clone(),
                description: pm.mod_entry.description.clone(), tags: resolved_tags,
                files: repo_files, archive: None, download_links: pm.mod_entry.download_links.clone(),
                // bare mod ids; pruned to mods present in the repo after the loop
                dependencies: pm.mod_entry.dependencies.iter()
                    .map(|d| d.split_once("::").map(|(_, m)| m.to_string()).unwrap_or_else(|| d.clone()))
                    .collect(),
                changelog: mod_changelogs.get(&pm.mod_entry.id)
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty()),
                update_url: pm.mod_entry.update_url.clone(),
                direct_url: pm.mod_entry.direct_url.clone(),
                update_sources: pm.mod_entry.update_sources.iter()
                    .map(|s| crate::models::mod_entry::UpdateSource { sig: None, ..s.clone() }).collect(),
            };

            let prof = &mut repo.profiles[prof_idx];
            if let Some(existing) = prof.mods.iter_mut().find(|m| m.id == repo_mod.id) {
                *existing = repo_mod; result.mods_updated += 1;
            } else {
                prof.mods.push(repo_mod); result.mods_added += 1;
            }
        }

        // GC orphaned mod folders
        let referenced: std::collections::HashSet<String> = repo.profiles.iter()
            .flat_map(|p| p.mods.iter().map(|m| m.id.clone())).collect();
        // Drop dependencies pointing at mods that are not part of this repo
        // (cross-profile deps to non-exported profiles).
        for p in repo.profiles.iter_mut() {
            for m in p.mods.iter_mut() {
                m.dependencies.retain(|d| referenced.contains(d));
            }
        }
        if let Ok(entries) = fs::read_dir(&repo_mods_dir) {
            for e in entries.flatten() {
                if e.path().is_dir() {
                    let name = e.file_name().to_string_lossy().to_string();
                    if !referenced.contains(&name) { let _ = fs::remove_dir_all(e.path()); }
                }
            }
        }

        // Re-sign + write
        let _ = win.emit("bmm://repo-export-progress", RepoProgress {
            step: "repo.stepFinalizing".to_string(), progress: 92.0, current_file: "repo.json".to_string(),
        });
        repo.author_id = None; repo.signature = None;
        let json_to_sign = serde_json::to_string(&repo).map_err(|e| e.to_string())?;
        let (author_id, signature) = super::security::sign_message(&handle2, json_to_sign.as_bytes())?;
        repo.author_id = Some(author_id); repo.signature = Some(signature);
        let final_json = serde_json::to_string_pretty(&repo).map_err(|e| e.to_string())?;
        fs::write(&manifest_path, final_json).map_err(|_| "repo.errWriteManifest".to_string())?;

        // Info.json
        let mut tm = 0; let mut tb: u64 = 0; let mut tf = 0;
        for p in &repo.profiles { tm += p.mods.len(); for m in &p.mods { tf += m.files.len(); for f in &m.files { tb += f.size; } } }
        let info = serde_json::json!({
            "name": repo.name, "author": repo.author, "game_name": repo.game_name,
            "profiles_count": repo.profiles.len(), "mods_count": tm, "files_count": tf,
            "total_size_bytes": tb, "total_size_formatted": format_bytes(tb), "version": "1.0",
            "created_at": chrono::Local::now().to_rfc3339(), "seed": repo.seed,
            "author_id": repo.author_id, "modpacks_count": repo.modpacks.as_ref().map_or(0, |m| m.len()),
        });
        let _ = fs::write(output_path.join("Info.json"), serde_json::to_string_pretty(&info).unwrap_or_default());

        result.total_profiles = repo.profiles.len();
        result.total_mods = tm;
        Ok(result)
    });

    let result = join.await.map_err(|e| format!("update task failed: {}", e))??;

    let _ = window.emit("bmm://repo-export-progress", RepoProgress {
        step: "repo.exportDone".to_string(), progress: 100.0, current_file: String::new(),
    });

    Ok(result)
}

#[derive(serde::Serialize, Default, Clone)]
pub struct RepoUpdateResult {
    pub profiles_added: usize,
    pub profiles_removed: usize,
    pub mods_added: usize,
    pub mods_updated: usize,
    pub mods_removed: usize,
    pub total_profiles: usize,
    pub total_mods: usize,
}

#[derive(serde::Serialize)]
pub struct HubRepoSummary {
    pub folder: String,
    pub name: String,
    pub game_name: String,
    pub profiles: usize,
    pub mods: usize,
    pub size: u64,
}

/// Scan a directory and return every immediate sub-folder that contains a
/// repo.json (used by the hub dashboard preview in BMM).
#[tauri::command]
pub fn scan_repo_hub(hub_dir: String) -> Result<Vec<HubRepoSummary>, String> {
    let root = PathBuf::from(&hub_dir);
    if !root.is_dir() { return Err("repo.errOutputDirNotDir".to_string()); }
    let mut out = Vec::new();

    // First, check if the root itself has a repo.json (hub root repo)
    if let Ok(content) = fs::read_to_string(root.join("repo.json")) {
        if let Ok(repo) = serde_json::from_str::<ServerRepo>(&content) {
            let mut mods = 0usize; let mut size = 0u64;
            for p in &repo.profiles {
                mods += p.mods.len();
                for m in &p.mods { for f in &m.files { size += f.size; } }
            }
            out.push(HubRepoSummary {
                folder: ".".to_string(),  // indicates root repo
                name: repo.name,
                game_name: repo.game_name,
                profiles: repo.profiles.len(),
                mods, size,
            });
        }
    }

    // Then scan subdirectories
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())?.flatten() {
        if !entry.path().is_dir() { continue; }
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "public" || name == "node_modules" { continue; }
        let manifest = entry.path().join("repo.json");
        if !manifest.exists() { continue; }
        if let Ok(content) = fs::read_to_string(&manifest) {
            if let Ok(repo) = serde_json::from_str::<ServerRepo>(&content) {
                let mut mods = 0usize; let mut size = 0u64;
                for p in &repo.profiles {
                    mods += p.mods.len();
                    for m in &p.mods { for f in &m.files { size += f.size; } }
                }
                out.push(HubRepoSummary {
                    folder: name,
                    name: repo.name,
                    game_name: repo.game_name,
                    profiles: repo.profiles.len(),
                    mods, size,
                });
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Generate a multi-repo hub into `hub_dir`.
/// `serve = true`  → a Node/Express server that hosts all repos + dashboards.
/// `serve = false` → a static directory (index.html + hub-repos.json) you can
///                   drop on any web host; you fill each repo's external URL.
#[tauri::command]
pub fn generate_repo_hub(
    hub_dir: String,
    port: u16,
    upload_limit: u32,
    serve: Option<bool>,
    admin_password: Option<String>,
) -> Result<(), String> {
    let root = PathBuf::from(&hub_dir);
    fs::create_dir_all(&root).map_err(|_| "repo.errCreateOutputDir".to_string())?;
    let serve = serve.unwrap_or(true);

    if serve {
        // ── Node/Express serving hub ──
        let pw = admin_password.clone().unwrap_or_default();
        // Embed the BMM logo as a base64 data-URI so the dashboard is fully
        // self-contained even when served by the standalone Node process.
        static BMM_LOGO_PNG: &[u8] = include_bytes!("../../../frontend/assets/BMm.png");
        use base64::{Engine as _, engine::general_purpose};
        let logo_b64 = format!("data:image/png;base64,{}", general_purpose::STANDARD.encode(BMM_LOGO_PNG));

        let server_js = include_str!("../templates/mini-server/hub-server.js.template")
            .replace("{{PORT}}", &port.to_string())
            .replace("{{UPLOAD_LIMIT}}", &upload_limit.to_string())
            .replace("{{ADMIN_PASSWORD}}", &pw);
        let dashboard = include_str!("../templates/mini-server/hub-dashboard.html.template")
            .replace("{{LOGO_B64}}", &logo_b64);
        let repo_page = include_str!("../templates/mini-server/hub-repo.html.template");
        let package   = include_str!("../templates/mini-server/hub-package.json.template");

        let public_dir = root.join("public");
        fs::create_dir_all(&public_dir).map_err(|_| "repo.errCreateOutputDir".to_string())?;

        fs::write(root.join("hub-server.js"), server_js).map_err(|_| "repo.errWriteServerJs".to_string())?;
        fs::write(public_dir.join("hub-dashboard.html"), dashboard).map_err(|_| "repo.errWriteDashboardHtml".to_string())?;
        fs::write(public_dir.join("hub-repo.html"), repo_page).map_err(|_| "repo.errWriteDashboardHtml".to_string())?;
        fs::write(root.join("package.json"), package).map_err(|_| "repo.errWritePackageJson".to_string())?;

        let bat = "@echo off\r\ntitle BMM Repo Hub\r\ncd /d \"%~dp0\"\r\nwhere node >nul 2>nul || (echo Node.js is required: https://nodejs.org && pause && exit /b)\r\nif not exist node_modules (echo Installing dependencies... && npm install)\r\nnode hub-server.js\r\npause\r\n";
        fs::write(root.join("Start-Hub.bat"), bat).map_err(|_| "repo.errWriteScript".to_string())?;
        let sh = "#!/usr/bin/env bash\ncd \"$(dirname \"$0\")\"\ncommand -v node >/dev/null 2>&1 || { echo 'Node.js is required: https://nodejs.org'; exit 1; }\n[ -d node_modules ] || { echo 'Installing dependencies...'; npm install; }\nnode hub-server.js\n";
        fs::write(root.join("start-hub.sh"), sh).map_err(|_| "repo.errWriteScript".to_string())?;
    } else {
        // ── Static directory (no Node) ──
        static BMM_LOGO_PNG_S: &[u8] = include_bytes!("../../../frontend/assets/BMm.png");
        use base64::{Engine as _, engine::general_purpose};
        let logo_b64_s = format!("data:image/png;base64,{}", general_purpose::STANDARD.encode(BMM_LOGO_PNG_S));
        let index = include_str!("../templates/mini-server/hub-static.html.template")
            .replace("{{LOGO_B64}}", &logo_b64_s);
        fs::write(root.join("index.html"), index).map_err(|_| "repo.errWriteDashboardHtml".to_string())?;

        // Build hub-repos.json by scanning sub-folders (url left empty to fill)
        let summaries = scan_repo_hub(hub_dir.clone()).unwrap_or_default();
        let repos_json: Vec<serde_json::Value> = summaries.iter().map(|s| serde_json::json!({
            "folder": s.folder, "name": s.name, "game_name": s.game_name,
            "profiles": s.profiles, "mods": s.mods, "size": s.size,
            "url": "",            // ← fill with where this repo is actually hosted
            "description": "",
        })).collect();
        let cfg = serde_json::json!({ "repos": repos_json });
        fs::write(root.join("hub-repos.json"), serde_json::to_string_pretty(&cfg).unwrap_or_default())
            .map_err(|_| "repo.errWriteManifest".to_string())?;
    }

    Ok(())
}

#[derive(serde::Serialize)]
pub struct ProfileModItem { pub id: String, pub name: String, pub version: String }

/// Lightweight list of a profile's mods (id/name/version) — for the update UI's
/// per-mod selection, for ANY profile (not just the active one).
#[tauri::command]
pub fn get_profile_mod_list(state: State<AppState>, profile_id: String) -> Result<Vec<ProfileModItem>, String> {
    let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
    let profile = data.profiles.iter().find(|p| p.id == profile_id)
        .ok_or("repo.errNoProfile")?;
    let mut out = Vec::new();
    for m in &data.mods {
        let belongs = m.mod_folder_path.starts_with(&profile.mods_path)
            || matches!((m.mod_folder_path.canonicalize(), profile.mods_path.canonicalize()),
                (Ok(a), Ok(b)) if a.starts_with(&b));
        if belongs {
            out.push(ProfileModItem { id: m.id.clone(), name: m.name.clone(), version: m.version.clone() });
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Normalise a repo URL the same way `sync_server_repo` does, so origins recorded
/// at sync time match what the update checker / config commands look up.
pub fn normalize_repo_url(url: &str) -> String {
    let mut u = url.trim().to_string();
    if let Some(s) = u.strip_suffix("/repo.json") { u = s.to_string(); }
    while u.ends_with('/') { u.pop(); }
    u.to_lowercase()
}

/// One available mod update found by `check_mod_updates`.
#[derive(serde::Serialize)]
pub struct ModUpdateInfo {
    pub mod_id: String,          // local ModEntry id
    pub name: String,
    pub current_version: String,
    pub new_version: String,
    pub repo_url: String,        // normalised source repo (or direct download URL)
    pub repo_mod_id: String,
    pub changelog: Option<String>,
    /// True when this update comes from a direct-download URL (no repo manifest).
    /// The UI applies it via `apply_direct_update` instead of the repo-sync flow,
    /// and shows a tentative "maybe an update" label since the remote version is
    /// unknown — only that the file content changed.
    #[serde(default)]
    pub direct: bool,
    /// (direct only) Human-readable summary of what we actually know about the
    /// change — e.g. a size delta or which validator moved — shown in the UI.
    #[serde(default)]
    pub detail: Option<String>,
}

/// A configured direct-download source with its current remote state. Always
/// returned (changed or not) so the UI can always offer a manual re-download —
/// a direct download has no version, so there's nothing to be "up to date" about.
#[derive(serde::Serialize)]
pub struct DirectSourceInfo {
    pub mod_id: String,
    pub name: String,
    pub url: String,
    /// Human summary of the current remote (e.g. "Remote: 12.3 MB").
    pub detail: String,
    /// True when the remote differs from the baseline captured when configured.
    pub changed: bool,
}

/// A repo that could not be reached during an update check.
#[derive(serde::Serialize)]
pub struct RepoCheckError {
    pub repo_url: String,
    pub error: String,
}

/// Full result of an update check: available updates + the repos that failed.
#[derive(serde::Serialize, Default)]
pub struct ModUpdateCheckResult {
    pub updates: Vec<ModUpdateInfo>,
    pub errors: Vec<RepoCheckError>,
    /// How many installed mods were actually update-trackable (linked to a repo
    /// with a repo_mod_id). 0 means nothing is configured for updates yet — the
    /// UI uses this to avoid a misleading "everything is up to date".
    pub checked: usize,
    /// Mod ids for which a direct-download baseline was captured for the FIRST time
    /// this run (nothing to compare against yet). The UI says "now tracking" rather
    /// than "up to date" so the user understands a future change will be detected.
    #[serde(default)]
    pub baselined: Vec<String>,
    /// Every configured direct-download source with its current remote state, so
    /// the UI can always offer a manual re-download (and highlight changes).
    #[serde(default)]
    pub direct_sources: Vec<DirectSourceInfo>,
}

/// Check every installed mod that is update-trackable against the repo(s) it is
/// linked to. A mod is linked through any of:
///   * `source_repo` + `repo_mod_id` (recorded automatically on sync),
///   * `update_url` (+ `repo_mod_id`),
///   * each user-configured `update_sources` entry, and
///   * any caller-supplied `global_repos` (matched by the mod's `repo_mod_id`).
///
/// Each unique repo is fetched once. Repos that fail to respond are reported in
/// `errors` (not silently dropped) so the UI can surface the problem.
#[tauri::command]
pub async fn check_mod_updates(
    state: State<'_, AppState>,
    handle: tauri::AppHandle,
    global_repos: Option<Vec<String>>,
) -> Result<ModUpdateCheckResult, String> {
    // 1. Build, per mod, the list of (normalised repo_url, repo_mod_id) to check.
    struct Candidate { mod_id: String, name: String, cur_ver: String, repo_url: String, rid: String }
    struct DirectCand { mod_id: String, name: String, cur_ver: String, url: String, sig: Option<String>, primary: bool }
    let mut candidates: Vec<Candidate> = Vec::new();
    let mut directs: Vec<DirectCand> = Vec::new();
    let globals: Vec<String> = global_repos.unwrap_or_default()
        .into_iter().map(|r| normalize_repo_url(&r)).filter(|r| !r.is_empty()).collect();
    {
        let data = state.data.lock().map_err(|_| "Lock failed".to_string())?;
        for m in &data.mods {
            // Primary direct-download source (checked before fallbacks).
            if let Some(u) = m.direct_url.as_ref().filter(|u| !u.trim().is_empty()) {
                directs.push(DirectCand {
                    mod_id: m.id.clone(), name: m.name.clone(), cur_ver: m.version.clone(),
                    url: u.trim().to_string(), sig: m.direct_sig.clone(), primary: true,
                });
            }
            let main_rid = m.repo_mod_id.as_ref().filter(|r| !r.trim().is_empty()).cloned();
            // de-dupe (repo_url, rid) pairs for this mod
            let mut seen: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();
            let mut push = |repo: &str, rid: Option<String>, list: &mut Vec<Candidate>| {
                let repo_n = normalize_repo_url(repo);
                if repo_n.is_empty() { return; }
                let rid = match rid.filter(|r| !r.trim().is_empty()) { Some(r) => r, None => return };
                if seen.insert((repo_n.clone(), rid.clone())) {
                    list.push(Candidate {
                        mod_id: m.id.clone(), name: m.name.clone(), cur_ver: m.version.clone(),
                        repo_url: repo_n, rid,
                    });
                }
            };
            if let Some(r) = &m.source_repo { push(r, main_rid.clone(), &mut candidates); }
            if let Some(r) = &m.update_url  { push(r, main_rid.clone(), &mut candidates); }
            for src in &m.update_sources {
                if src.is_direct() {
                    // Direct-download fallback.
                    if !src.repo_url.trim().is_empty() {
                        directs.push(DirectCand {
                            mod_id: m.id.clone(), name: m.name.clone(), cur_ver: m.version.clone(),
                            url: src.repo_url.trim().to_string(), sig: src.sig.clone(), primary: false,
                        });
                    }
                } else {
                    let rid = src.repo_mod_id.clone().or_else(|| main_rid.clone());
                    push(&src.repo_url, rid, &mut candidates);
                }
            }
            for g in &globals { push(g, main_rid.clone(), &mut candidates); }
        }
    }
    let checked = candidates.iter().map(|c| c.mod_id.clone())
        .chain(directs.iter().map(|d| d.mod_id.clone()))
        .collect::<std::collections::HashSet<_>>().len();
    if candidates.is_empty() && directs.is_empty() {
        return Ok(ModUpdateCheckResult::default());
    }

    let creator_id = crate::commands::security::get_creator_id(handle).ok();

    // 2. Fetch each unique repo once; cache manifest mod maps + record failures.
    let mut result = ModUpdateCheckResult { checked, ..Default::default() };
    let mut repo_cache: std::collections::HashMap<String, Option<std::collections::HashMap<String, (String, Option<String>)>>> = std::collections::HashMap::new();
    let mut flagged: std::collections::HashSet<String> = std::collections::HashSet::new();

    for c in candidates {
        // already found an update for this mod from another source → skip
        if flagged.contains(&c.mod_id) { continue; }

        if !repo_cache.contains_key(&c.repo_url) {
            match fetch_repo_info(c.repo_url.clone(), creator_id.clone(), None).await {
                Ok(manifest) => {
                    let mut map = std::collections::HashMap::new();
                    for p in &manifest.profiles {
                        for rm in &p.mods {
                            map.entry(rm.id.clone()).or_insert((rm.version.clone(), rm.changelog.clone()));
                        }
                    }
                    repo_cache.insert(c.repo_url.clone(), Some(map));
                }
                Err(e) => {
                    result.errors.push(RepoCheckError { repo_url: c.repo_url.clone(), error: e });
                    repo_cache.insert(c.repo_url.clone(), None);
                }
            }
        }

        if let Some(Some(map)) = repo_cache.get(&c.repo_url) {
            if let Some((new_ver, changelog)) = map.get(&c.rid) {
                if new_ver != &c.cur_ver {
                    flagged.insert(c.mod_id.clone());
                    result.updates.push(ModUpdateInfo {
                        mod_id: c.mod_id,
                        name: c.name,
                        current_version: c.cur_ver,
                        new_version: new_ver.clone(),
                        repo_url: c.repo_url,
                        repo_mod_id: c.rid,
                        changelog: changelog.clone(),
                        direct: false,
                        detail: None,
                    });
                }
            }
        }
    }

    // 3. Direct-download sources. A direct download has no version, so we ALWAYS
    //    surface the source (for a manual re-download) and additionally flag it as
    //    an "update" when its remote content changed since the baseline.
    for d in directs {
        match fetch_url_validator(&d.url).await {
            Ok(sig) => {
                let changed = matches!(&d.sig, Some(prev) if *prev != sig);
                result.direct_sources.push(DirectSourceInfo {
                    mod_id: d.mod_id.clone(),
                    name: d.name.clone(),
                    url: d.url.clone(),
                    detail: sig_human_size(&sig)
                        .map(|s| format!("Remote: {s}"))
                        .unwrap_or_else(|| "Remote file reachable".to_string()),
                    changed,
                });
                match &d.sig {
                    // No baseline yet (shouldn't normally happen — baselines are
                    // captured when the source is configured) → record one now.
                    None => {
                        if let Ok(mut data) = state.data.lock() {
                            if let Some(m) = data.mods.iter_mut().find(|m| m.id == d.mod_id) {
                                if d.primary {
                                    if m.direct_sig.is_none() { m.direct_sig = Some(sig); }
                                } else if let Some(src) = m.update_sources.iter_mut()
                                    .find(|s| s.is_direct() && s.repo_url.trim() == d.url) {
                                    if src.sig.is_none() { src.sig = Some(sig); }
                                }
                            }
                        }
                        let _ = state.save();
                        if !result.baselined.contains(&d.mod_id) { result.baselined.push(d.mod_id.clone()); }
                    }
                    Some(prev) if *prev != sig => {
                        if !flagged.contains(&d.mod_id) {
                            flagged.insert(d.mod_id.clone());
                            result.updates.push(ModUpdateInfo {
                                mod_id: d.mod_id,
                                name: d.name,
                                current_version: d.cur_ver,
                                new_version: String::new(),
                                repo_url: d.url,
                                repo_mod_id: String::new(),
                                changelog: None,
                                direct: true,
                                detail: Some(describe_sig_change(prev, &sig)),
                            });
                        }
                    }
                    _ => {}
                }
            }
            Err(e) => result.errors.push(RepoCheckError { repo_url: d.url, error: e }),
        }
    }
    Ok(result)
}

/// Fetch a robust change-detection signature for a direct-download URL.
///
/// Rather than trusting a single header, it combines *every* validator the host
/// exposes — ETag, Last-Modified and total size — so a change in any of them is
/// caught. When the host exposes none (common on file lockers / dumb static
/// hosts), it falls back to hashing the first 64 KB of the file plus its length,
/// giving a real content fingerprint without downloading the whole archive.
/// Redirects are followed so "latest" links that 302 to a versioned asset work.
/// Human-readable summary of how a direct-download validator changed (size delta
/// when known, else which validator moved) — shown so the user sees the data BMM
/// actually has, since a direct download exposes no version number.
fn describe_sig_change(old: &str, new: &str) -> String {
    let size_of = |s: &str| -> Option<u64> {
        for p in s.split('|') {
            if let Some(v) = p.strip_prefix("len:").or_else(|| p.strip_prefix("total:")) {
                if let Ok(n) = v.trim().parse::<u64>() { return Some(n); }
            }
        }
        None
    };
    let human = |b: u64| -> String {
        let f = b as f64;
        if f >= 1_048_576.0 { format!("{:.1} MB", f / 1_048_576.0) }
        else if f >= 1024.0 { format!("{:.0} KB", f / 1024.0) }
        else { format!("{} B", b) }
    };
    if let (Some(a), Some(b)) = (size_of(old), size_of(new)) {
        if a != b { return format!("Size: {} → {}", human(a), human(b)); }
    }
    let has = |s: &str, k: &str| s.split('|').any(|p| p.starts_with(k));
    if has(old, "etag:") || has(new, "etag:") { "Remote file changed (ETag)".to_string() }
    else if has(old, "lm:") || has(new, "lm:") { "Remote file changed (last-modified date)".to_string() }
    else { "Remote file content changed".to_string() }
}

/// Extract a human-readable size from a validator signature, if it carries one.
fn sig_human_size(sig: &str) -> Option<String> {
    for p in sig.split('|') {
        if let Some(v) = p.strip_prefix("len:").or_else(|| p.strip_prefix("total:")) {
            if let Ok(b) = v.trim().parse::<u64>() {
                let f = b as f64;
                return Some(if f >= 1_048_576.0 { format!("{:.1} MB", f / 1_048_576.0) }
                    else if f >= 1024.0 { format!("{:.0} KB", f / 1024.0) }
                    else { format!("{} B", b) });
            }
        }
    }
    None
}

async fn fetch_url_validator(url: &str) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(std::time::Duration::from_secs(25))
        .build().map_err(|e| e.to_string())?;

    let mut parts: Vec<String> = Vec::new();
    let mut have_strong = false;

    // 1. Cheap HEAD for header validators.
    if let Ok(resp) = client.head(url).send().await {
        if resp.status().is_success() {
            let h = resp.headers();
            let get = |n: reqwest::header::HeaderName| h.get(n).and_then(|v| v.to_str().ok()).map(|s| s.to_string());
            if let Some(e) = get(reqwest::header::ETAG) { parts.push(format!("etag:{e}")); have_strong = true; }
            if let Some(lm) = get(reqwest::header::LAST_MODIFIED) { parts.push(format!("lm:{lm}")); have_strong = true; }
            if let Some(cl) = get(reqwest::header::CONTENT_LENGTH) { parts.push(format!("len:{cl}")); }
        }
    }

    // 2. Strong validator already → done (no need to pull any bytes).
    if have_strong {
        parts.sort();
        return Ok(parts.join("|"));
    }

    // 3. No strong validator: fingerprint the first 64 KB via a ranged GET, and
    //    capture the total size from Content-Range / Content-Length.
    let resp = client.get(url)
        .header(reqwest::header::RANGE, "bytes=0-65535")
        .send().await.map_err(|e| e.to_string())?;
    let code = resp.status().as_u16();
    if !resp.status().is_success() && code != 206 {
        return Err(format!("HTTP {}", resp.status()));
    }
    {
        let h = resp.headers();
        let total = h.get(reqwest::header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(|cr| cr.rsplit('/').next().map(|s| s.to_string()))
            .filter(|t| t != "*")
            .or_else(|| h.get(reqwest::header::CONTENT_LENGTH)
                .and_then(|v| v.to_str().ok()).map(|s| s.to_string()));
        if let Some(t) = total { parts.push(format!("total:{t}")); }
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if !bytes.is_empty() {
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let digest = hasher.finalize();
        parts.push(format!("p{}:{}", bytes.len(), hex::encode(&digest[..8])));
    }

    if parts.is_empty() {
        return Err("Remote exposes no validator and served no content".to_string());
    }
    parts.sort();
    Ok(parts.join("|"))
}

/// Detect a single shared top-level folder in an archive, so its files can be
/// extracted directly into the mod folder (mirrors the repo/.bmmplug convention).
/// Returns None when entries live at the archive root or under multiple roots.
fn archive_single_root<R: std::io::Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
) -> Option<std::path::PathBuf> {
    let mut root: Option<String> = None;
    let mut has_subpath = false;
    for i in 0..archive.len() {
        let file = archive.by_index(i).ok()?;
        let name = match file.enclosed_name() { Some(p) => p.to_path_buf(), None => continue };
        let mut comps = name.components();
        let first = comps.next()?.as_os_str().to_string_lossy().to_string();
        if comps.next().is_some() { has_subpath = true; }
        match &root {
            None => root = Some(first),
            Some(r) if *r != first => return None,
            _ => {}
        }
    }
    if has_subpath { root.map(std::path::PathBuf::from) } else { None }
}

/// Apply a direct-download update: re-download the configured archive and
/// overwrite the mod's folder in place (Zip Slip safe), then record the new
/// remote validator so the update clears.
#[tauri::command]
pub async fn apply_direct_update(
    state: State<'_, AppState>,
    mod_id: String,
    url: Option<String>,
) -> Result<(), String> {
    let (url, folder) = {
        let data = state.data.lock().map_err(|_| "Lock failed".to_string())?;
        let m = data.mods.iter().find(|m| m.id == mod_id)
            .ok_or_else(|| "Mod not found".to_string())?;
        // Use the caller-supplied URL when it matches a configured direct source
        // (primary or a fallback); otherwise fall back to the primary direct URL.
        let wanted = url.map(|u| u.trim().to_string()).filter(|u| !u.is_empty());
        let known = |u: &str| {
            m.direct_url.as_deref().map(|p| p.trim() == u).unwrap_or(false)
                || m.update_sources.iter().any(|s| s.is_direct() && s.repo_url.trim() == u)
        };
        let url = match wanted {
            Some(u) if known(&u) => u,
            _ => m.direct_url.clone()
                .map(|u| u.trim().to_string())
                .filter(|u| !u.is_empty())
                .ok_or_else(|| "No direct download URL configured".to_string())?,
        };
        (url, m.mod_folder_path.clone())
    };

    let folder_c = folder.clone();
    let url_c = url.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let response = reqwest::blocking::get(&url_c)
            .map_err(|e| format!("Download failed: {}", e))?;
        if !response.status().is_success() {
            return Err(format!("HTTP error: {}", response.status()));
        }
        let bytes = response.bytes().map_err(|e| format!("Read failed: {}", e))?;
        std::fs::create_dir_all(&folder_c).map_err(|e| e.to_string())?;

        let is_zip = bytes.len() >= 4 && bytes[0] == 0x50 && bytes[1] == 0x4B;
        if is_zip {
            let cursor = std::io::Cursor::new(&bytes);
            let mut archive = zip::ZipArchive::new(cursor)
                .map_err(|e| format!("Zip error: {}", e))?;
            let strip = archive_single_root(&mut archive);
            for i in 0..archive.len() {
                let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
                // CWE-22 Zip Slip: enclosed_name() returns None for escaping paths.
                let safe = match file.enclosed_name() { Some(p) => p.to_path_buf(), None => continue };
                let rel = match &strip {
                    Some(pfx) => safe.strip_prefix(pfx).map(|p| p.to_path_buf()).unwrap_or(safe),
                    None => safe,
                };
                if rel.as_os_str().is_empty() { continue; }
                let outpath = folder_c.join(&rel);
                if file.name().ends_with('/') {
                    std::fs::create_dir_all(&outpath).ok();
                } else {
                    if let Some(parent) = outpath.parent() { std::fs::create_dir_all(parent).ok(); }
                    let mut outfile = std::fs::File::create(&outpath).map_err(|e| e.to_string())?;
                    std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
                }
            }
        } else {
            // Non-archive payload: save it as a single file under the mod folder.
            let raw = url_c.split(|c| c == '?' || c == '#').next().unwrap_or(&url_c);
            let name = raw.rsplit(|c| c == '/' || c == '\\').next()
                .filter(|s| !s.is_empty()).unwrap_or("mod_file");
            std::fs::write(folder_c.join(name), &bytes).map_err(|e| e.to_string())?;
        }
        Ok(())
    }).await.map_err(|e| e.to_string())??;

    // Record the new validator as the baseline for whichever source we used, and
    // refresh the fingerprint.
    let new_sig = fetch_url_validator(&url).await.ok();
    {
        let mut data = state.data.lock().map_err(|_| "Lock failed".to_string())?;
        if let Some(m) = data.mods.iter_mut().find(|m| m.id == mod_id) {
            if m.direct_url.as_deref().map(|p| p.trim() == url).unwrap_or(false) {
                m.direct_sig = new_sig.clone();
            }
            for s in m.update_sources.iter_mut().filter(|s| s.is_direct() && s.repo_url.trim() == url) {
                s.sig = new_sig.clone();
            }
            m.content_id = crate::models::mod_entry::derive_content_id(&m.mod_folder_path);
            m.cached_files = None;
            m.last_scan_mtime = 0;
        }
    }
    let _ = state.save();
    Ok(())
}

/// Configure a mod's update linkage: its stable `repo_mod_id` and the list of
/// repos that can update it. Empty strings clear the corresponding field.
#[tauri::command]
pub async fn set_mod_update_config(
    state: State<'_, AppState>,
    mod_id: String,
    repo_mod_id: Option<String>,
    update_url: Option<String>,
    update_sources: Option<Vec<crate::models::mod_entry::UpdateSource>>,
    direct_url: Option<String>,
) -> Result<(), String> {
    {
        let mut data = state.data.lock().map_err(|_| "Lock failed".to_string())?;
        let m = data.mods.iter_mut().find(|m| m.id == mod_id)
            .ok_or_else(|| "Mod not found".to_string())?;
        if let Some(rid) = repo_mod_id {
            let t = rid.trim();
            m.repo_mod_id = if t.is_empty() { None } else { Some(t.to_string()) };
        }
        if let Some(url) = update_url {
            let t = url.trim();
            m.update_url = if t.is_empty() { None } else { Some(normalize_repo_url(t)) };
        }
        if let Some(url) = direct_url {
            let t = url.trim();
            let new_url = if t.is_empty() { None } else { Some(t.to_string()) };
            // Changing the URL invalidates the stored signature so the next check
            // re-captures a baseline instead of falsely flagging an update.
            if new_url != m.direct_url { m.direct_sig = None; }
            m.direct_url = new_url;
        }
        if let Some(srcs) = update_sources {
            // Preserve already-captured direct-download baselines by URL so a
            // re-save doesn't reset change-detection.
            let prev_sigs: std::collections::HashMap<String, Option<String>> = m.update_sources.iter()
                .filter(|s| s.is_direct())
                .map(|s| (s.repo_url.trim().to_string(), s.sig.clone()))
                .collect();
            m.update_sources = srcs.into_iter()
                .filter(|s| !s.repo_url.trim().is_empty())
                .map(|mut s| {
                    if s.is_direct() {
                        s.kind = "direct".to_string();
                        s.repo_url = s.repo_url.trim().to_string();
                        s.repo_mod_id = None;
                        s.sig = prev_sigs.get(&s.repo_url).cloned().flatten();
                    } else {
                        s.kind = "repo".to_string();
                        s.repo_url = normalize_repo_url(&s.repo_url);
                        s.repo_mod_id = s.repo_mod_id.filter(|r| !r.trim().is_empty());
                        s.sig = None;
                    }
                    s
                })
                .collect();
        }
    }
    let _ = state.save();

    // Capture baselines for any direct-download sources that don't have one yet, so
    // the FIRST "check for updates" is already meaningful (no "tracking started").
    let pending: Vec<String> = {
        let data = state.data.lock().map_err(|_| "Lock failed".to_string())?;
        let mut urls = Vec::new();
        if let Some(m) = data.mods.iter().find(|m| m.id == mod_id) {
            if m.direct_sig.is_none() {
                if let Some(u) = m.direct_url.as_ref().filter(|u| !u.trim().is_empty()) {
                    urls.push(u.trim().to_string());
                }
            }
            for s in &m.update_sources {
                if s.is_direct() && s.sig.is_none() && !s.repo_url.trim().is_empty() {
                    urls.push(s.repo_url.trim().to_string());
                }
            }
        }
        urls
    };
    let mut captured = false;
    for url in pending {
        if let Ok(sig) = fetch_url_validator(&url).await {
            let mut data = state.data.lock().map_err(|_| "Lock failed".to_string())?;
            if let Some(m) = data.mods.iter_mut().find(|m| m.id == mod_id) {
                if m.direct_url.as_deref().map(|p| p.trim() == url).unwrap_or(false) && m.direct_sig.is_none() {
                    m.direct_sig = Some(sig.clone());
                }
                for s in m.update_sources.iter_mut()
                    .filter(|s| s.is_direct() && s.repo_url.trim() == url && s.sig.is_none()) {
                    s.sig = Some(sig.clone());
                }
            }
            captured = true;
        }
    }
    if captured { let _ = state.save(); }
    Ok(())
}

/// Read an existing repo.json and return its current profiles + mods so the UI
/// can show what's inside before updating.
#[tauri::command]
pub fn read_local_repo(repo_dir: String) -> Result<ServerRepo, String> {
    let manifest_path = PathBuf::from(&repo_dir).join("repo.json");
    if !manifest_path.exists() {
        return Err("repo.errNoExistingRepo".to_string());
    }
    let content = fs::read_to_string(&manifest_path).map_err(|_| "repo.errReadManifest".to_string())?;
    serde_json::from_str(&content).map_err(|e| format!("repo.json parse error: {}", e))
}

pub(crate) fn zip_directory(src_dir: &Path, dst_file: &Path, cancel_flag: std::sync::Arc<std::sync::atomic::AtomicBool>) -> Result<(), String> {
    use zip::write::FileOptions;
    use std::io::{copy, BufWriter};
    use walkdir::WalkDir;
    use std::sync::atomic::Ordering;

    let file = fs::File::create(dst_file).map_err(|e| e.to_string())?;
    // Use BufWriter for better performance with large files
    let writer = BufWriter::with_capacity(128 * 1024, file);
    let mut zip = zip::ZipWriter::new(writer);
    
    // Enable ZIP64 for files > 4GB and overall archive > 4GB
    let options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o755)
        .large_file(true); // <--- Enable ZIP64 support

    for entry in WalkDir::new(src_dir).into_iter().filter_map(|e| e.ok()) {
        if cancel_flag.load(Ordering::SeqCst) {
            return Err("repo.cancelled".to_string());
        }
        let path = entry.path();
        let name = path.strip_prefix(src_dir).map_err(|e| e.to_string())?;

        if path.is_file() {
            zip.start_file(name.to_string_lossy().replace("\\", "/"), options).map_err(|e| e.to_string())?;
            let mut f = fs::File::open(path).map_err(|e| e.to_string())?;
            copy(&mut f, &mut zip).map_err(|e| e.to_string())?;
        } else if !name.as_os_str().is_empty() {
            zip.add_directory(name.to_string_lossy().replace("\\", "/"), options).map_err(|e| e.to_string())?;
        }
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn cancel_repo_export(state: State<'_, AppState>) -> Result<(), String> {
    state.install_cancelled.store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}
fn generate_mini_server_files(
    handle: &AppHandle,
    output_path: &Path,
    port: u16,
    auto_start: bool,
    use_cloudflare: bool,
    use_upnp: bool,
    _lang: &str,
    upload_limit: u32,
    server_version: u8,
    admin_password: &str,
    download_password: &str,
    enable_docker: bool,
    docker_host_type: &str,
    server_type: &str,
) -> Result<(), String> {
    // 1. Get custom cloudflared path or "AUTO"
    let state = handle.state::<crate::state::AppState>();
    let cf_path = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        data.settings.cloudflared_path.clone().unwrap_or_else(|| "AUTO".to_string())
    };

    // Declare upfront so auto-start block can access it regardless of server_type
    let main_bat_path: Option<std::path::PathBuf>;

    if server_type == "server" {
        // GENERATE SERVER (EXPRESS/NODE) FILES
        let package_template = include_str!("../templates/mini-server/package.json.template");
        let server_js_template = include_str!("../templates/mini-server/server.express.js.template");
        let dashboard_template = include_str!("../templates/mini-server/dashboard.html.template");
        let bat_template = include_str!("../templates/mini-server/start.server.bat.template");
        let sh_template = include_str!("../templates/mini-server/start.server.sh.template");

        let mut server_js_content = server_js_template.replace("{{PORT}}", &port.to_string());
        server_js_content = server_js_content.replace("{{UPLOAD_LIMIT}}", &upload_limit.to_string());
        server_js_content = server_js_content.replace("{{ADMIN_PASSWORD}}", admin_password);
        server_js_content = server_js_content.replace("{{DOWNLOAD_PASSWORD}}", download_password);

        let public_dir = output_path.join("public");
        if !public_dir.exists() {
            fs::create_dir_all(&public_dir).map_err(|_| "repo.errCreatePublicDir".to_string())?;
        }

        fs::write(output_path.join("package.json"), package_template).map_err(|_| "repo.errWritePackageJson".to_string())?;
        fs::write(output_path.join("server.js"), server_js_content).map_err(|_| "repo.errWriteServerJs".to_string())?;
        fs::write(public_dir.join("dashboard.html"), dashboard_template).map_err(|_| "repo.errWriteDashboardHtml".to_string())?;
        
        let bat_path = output_path.join("BMM-Standalone-Server.bat");
        fs::write(&bat_path, bat_template).map_err(|_| "repo.errWriteScript".to_string())?;
        let main_sh_path = output_path.join("BMM-Standalone-Server.sh");
        fs::write(&main_sh_path, sh_template).map_err(|_| "repo.errWriteScript".to_string())?;
        main_bat_path = Some(bat_path);
    } else {
        // GENERATE USER (POLYGLOT) FILES
        let hybrid_template = if server_version == 2 {
            include_str!("../templates/mini-server/server.v2.bat.template")
        } else {
            include_str!("../templates/mini-server/server.hybrid.bat.template")
        };
        
        let mut hybrid_content = hybrid_template.replace("PORT_PLACEHOLDER", &port.to_string());
        hybrid_content = hybrid_content.replace("USE_CLOUDFLARE_PLACEHOLDER", if use_cloudflare { "true" } else { "false" });
        hybrid_content = hybrid_content.replace("USE_UPNP_PLACE_HOLDER", if use_upnp { "true" } else { "false" });
        hybrid_content = hybrid_content.replace("CLOUDFLARE_BINARY_PLACEHOLDER", &cf_path.replace("\\", "/"));
        hybrid_content = hybrid_content.replace("UPLOAD_LIMIT_PLACEHOLDER", &upload_limit.to_string());
        hybrid_content = hybrid_content.replace("ADMIN_PASSWORD_PLACEHOLDER", admin_password);

        // 3. Write Windows Batch File
        let bat_path = output_path.join("BMM-Standalone-Server.bat");
        fs::write(&bat_path, &hybrid_content).map_err(|_| "repo.errWriteScript".to_string())?;
        main_bat_path = Some(bat_path);

        // 4. Write Linux Shell File
        let linux_template = if server_version == 2 {
            include_str!("../templates/mini-server/server.v2.sh.template")
        } else {
            include_str!("../templates/mini-server/server.hybrid.sh.template")
        };
        
        let mut linux_content = linux_template.replace("PORT_PLACEHOLDER", &port.to_string());
        linux_content = linux_content.replace("USE_CLOUDFLARE_PLACEHOLDER", if use_cloudflare { "true" } else { "false" });
        linux_content = linux_content.replace("USE_UPNP_PLACE_HOLDER", if use_upnp { "true" } else { "false" });
        linux_content = linux_content.replace("CLOUDFLARE_BINARY_PLACEHOLDER", &cf_path.replace("\\", "/"));
        linux_content = linux_content.replace("UPLOAD_LIMIT_PLACEHOLDER", &upload_limit.to_string());
        linux_content = linux_content.replace("ADMIN_PASSWORD_PLACEHOLDER", admin_password);

        let main_sh_path = output_path.join("BMM-Standalone-Server.sh");
        fs::write(&main_sh_path, linux_content).map_err(|_| "repo.errWriteScript".to_string())?;
    }

    // 5. Copy Bans if exists
    if let Ok(ban_path) = ban_manager::get_ban_file_path(handle) {
        if ban_path.exists() {
            let _ = fs::copy(ban_path, output_path.join("bans.json"));
        }
    }

    // 5. Copy Whitelist if exists
    if let Ok(wl_path) = whitelist_manager::get_whitelist_file_path(handle) {
        if wl_path.exists() {
            let _ = fs::copy(wl_path, output_path.join("whitelist.json"));
        }
    }

    // 6. Generate Docker files if enabled
    if enable_docker {
        let (dockerfile_content, compose_template) = if server_type == "server" {
            // Express/Node server — uses its own Dockerfiles that call `node server.js`
            let df = if docker_host_type == "windows" {
                include_str!("../templates/docker/Dockerfile.server.windows.template")
            } else {
                include_str!("../templates/docker/Dockerfile.server.linux.template")
            };
            (df, include_str!("../templates/docker/docker-compose.server.yml.template"))
        } else {
            // Polyglot / user mode — existing Dockerfiles that run the .sh/.bat script
            let df = if docker_host_type == "windows" {
                include_str!("../templates/docker/Dockerfile.windows.template")
            } else {
                include_str!("../templates/docker/Dockerfile.linux.template")
            };
            (df, include_str!("../templates/docker/docker-compose.yml.template"))
        };

        let dockerfile_path = output_path.join("Dockerfile");
        let mut dockerfile_content = dockerfile_content.replace("PORT_PLACEHOLDER", &port.to_string());
        dockerfile_content = dockerfile_content.replace("ADMIN_PASSWORD_PLACEHOLDER", admin_password);
        fs::write(&dockerfile_path, dockerfile_content).map_err(|_| "repo.errWriteDockerfile".to_string())?;

        // Generate docker-compose.yml
        let mut compose_content = compose_template.replace("PORT_PLACEHOLDER", &port.to_string());
        compose_content = compose_content.replace("ADMIN_PASSWORD_PLACEHOLDER", admin_password);
        let compose_path = output_path.join("docker-compose.yml");
        fs::write(&compose_path, compose_content).map_err(|_| "repo.errWriteCompose".to_string())?;

        println!("[DOCKER] Docker files generated at: {:?}, {:?}", dockerfile_path, compose_path);
    }

    // 7. Auto-start logic
    if auto_start {
        #[cfg(target_os = "windows")]
        {
            use winreg::enums::*;
            use winreg::RegKey;
            if let Some(bat) = &main_bat_path {
                println!("[STARTUP] Enabling autostart for standalone server...");
                let hkcu = RegKey::predef(HKEY_CURRENT_USER);
                match hkcu.open_subkey_with_flags("Software\\Microsoft\\Windows\\CurrentVersion\\Run", KEY_SET_VALUE) {
                    Ok(run) => {
                        let mut path_str = if let Ok(abs_path) = fs::canonicalize(bat) {
                            abs_path.to_string_lossy().to_string().replace("\\\\?\\", "").replace("/","\\")
                        } else {
                            bat.to_string_lossy().to_string()
                        };

                        if path_str.contains(' ') && !path_str.starts_with('"') {
                            path_str = format!("\"{}\"", path_str);
                        }

                        match run.set_value("BMM-Mini-Server", &path_str) {
                            Ok(_) => println!("[STARTUP] Registry key set successfully."),
                            Err(e) => println!("[STARTUP] Failed to set registry value: {}", e),
                        }
                    },
                    Err(e) => println!("[STARTUP] Failed to open registry key: {}", e),
                }
            }
        }
    } else {
        #[cfg(target_os = "windows")]
        {
            use winreg::enums::*;
            use winreg::RegKey;
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            if let Ok(run) = hkcu.open_subkey_with_flags("Software\\Microsoft\\Windows\\CurrentVersion\\Run", KEY_SET_VALUE) {
                let _ = run.delete_value("BMM-Mini-Server");
                println!("[STARTUP] Autostart disabled (registry key removed).");
            }
        }
    }

    Ok(())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StandaloneServerConfig {
    pub repo_path: String,
    pub port: u16,
    pub auto_start: bool,
    pub use_cloudflare: bool,
    pub use_upnp: bool,
    pub lang: String,
    pub upload_limit: u32,
    pub server_version: Option<u8>,
    pub admin_password: Option<String>,
    pub download_password: Option<String>,
    pub enable_docker: Option<bool>,
    pub docker_host_type: Option<String>,
    pub server_type: Option<String>,
}

#[tauri::command]
pub async fn generate_standalone_server(
    handle: tauri::AppHandle,
    payload: StandaloneServerConfig,
) -> Result<(), String> {
    let _tracker = crate::commands::resource_tracker::OpTracker::start("REPO/standalone-gen")
        .with_subject(payload.repo_path.clone());
    let StandaloneServerConfig {
        repo_path,
        port,
        auto_start,
        use_cloudflare,
        use_upnp,
        lang,
        upload_limit,
        server_version,
        admin_password,
        download_password,
        enable_docker,
        docker_host_type,
        server_type,
    } = payload;
    let mut repo_json = PathBuf::from(&repo_path);
    
    // If user selected a directory, try to find repo.json inside it
    if repo_json.is_dir() {
        repo_json.push("repo.json");
    }

    if !repo_json.exists() {
        return Err("repo.miniServerErrNoRepo".to_string());
    }

    let output_path = repo_json.parent().ok_or_else(|| "repo.miniServerErrNoDir".to_string())?;

    let version = server_version.unwrap_or(1);
    let pw = admin_password.unwrap_or_else(|| "admin".to_string());
    let enable_docker = enable_docker.unwrap_or(false);
    let docker_host_type = docker_host_type.unwrap_or_else(|| "linux".to_string());
    let stype = server_type.unwrap_or_else(|| "user".to_string());
    generate_mini_server_files(&handle, output_path, port, auto_start, use_cloudflare, use_upnp, &lang, upload_limit, version, &pw, &download_password.unwrap_or_default(), enable_docker, &docker_host_type, &stype)
}

#[tauri::command]
pub async fn fetch_repo_info(url: String, creator_id: Option<String>, password: Option<String>) -> Result<ServerRepo, String> {
    let mut target_url = url.trim().to_string();
    if !target_url.starts_with("http://") && !target_url.starts_with("https://") {
        target_url = format!("http://{}", target_url);
    }

    if !target_url.ends_with("repo.json") {
        if target_url.ends_with('/') {
            target_url.push_str("repo.json");
        } else {
            target_url.push_str("/repo.json");
        }
    }

    let mut client_builder = reqwest::Client::builder();
    let mut headers = reqwest::header::HeaderMap::new();
    if let Some(ref cid) = creator_id {
        if let Ok(hv) = reqwest::header::HeaderValue::from_str(cid) {
            headers.insert("X-Creator-ID", hv);
        }
    }
    if let Some(ref pw) = password {
        if !pw.is_empty() {
            if let Ok(hv) = reqwest::header::HeaderValue::from_str(pw) { headers.insert("X-Repo-Password", hv); }
        }
    }
    if !headers.is_empty() {
        client_builder = client_builder.default_headers(headers);
    }
    let client = client_builder.build().map_err(|e| e.to_string())?;
    let res = client.get(&target_url).send().await.map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        // 401 = this repo requires a download password (or the one given is wrong).
        if res.status() == 401 {
            return Err("repo.errPasswordRequired".to_string());
        }
        if res.status() == 403 {
            // The sandbox gate (IP/key/account bans + whitelist, incl. the site-wide
            // policy) sends a structured body distinguishing WHY access was denied,
            // so BMM can tell the user what to do instead of a generic "forbidden".
            #[derive(serde::Deserialize, Default)]
            struct GateError { error: Option<String>, #[serde(rename = "accountLinked")] account_linked: Option<bool> }
            let body: GateError = res.json().await.unwrap_or_default();
            return Err(match body.error.as_deref() {
                Some("banned") => "repo.errBanned".to_string(),
                Some("not_whitelisted") if body.account_linked == Some(true) => "repo.errNotWhitelisted".to_string(),
                Some("not_whitelisted") => "repo.errNotWhitelistedLink".to_string(),
                _ => "repo.errForbidden".to_string(),
            });
        }
        return Err("repo.errInvalidRepo".to_string());
    }

    let repo: ServerRepo = res.json().await.map_err(|_| "repo.errInvalidRepo".to_string())?;
    Ok(repo)
}

#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncChoice {
    pub repo_profile_id: String,
    pub target_local_profile_id: Option<String>, // None = Create New
    /// If Some, only download these specific mod IDs. If None, download all mods.
    pub selected_mod_ids: Option<Vec<String>>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncArgs {
    pub url: String,
    pub creator_id: Option<String>,
    /// Optional download password for a password-protected repo (sent as X-Repo-Password).
    #[serde(default)]
    pub password: Option<String>,
    pub game_dir: String,
    pub mods_dir: String,
    pub backup_dir: String,
    pub choices: Vec<SyncChoice>,
    pub overwrite_all: bool,
    pub delete_extra: bool,
    pub download_limit: u32,
    /// For mods stored as a single `.zip` (repo generated with "zip mods"): true =
    /// extract the archive into a normal mod folder; false = keep it as a `.zip`
    /// (an archived mod, read on demand). Ignored for classic per-file repos.
    #[serde(default = "default_true")]
    pub unzip_archives: bool,
}
fn default_true() -> bool {
    true
}

#[tauri::command]
pub async fn sync_server_repo(
    window: Window,
    state: State<'_, AppState>,
    args: SyncArgs,
) -> Result<SyncSummary, String> {
    let url = args.url;
    let game_dir = args.game_dir;
    let mods_dir = args.mods_dir;
    let backup_dir = args.backup_dir;
    let choices = args.choices;

    // Read once: this is sent with every file request, and a per-file disk read for an
    // unchanging value would be thousands of them on a large sync.
    let attestation: Option<String> = {
        use tauri::Manager;
        crate::commands::identity::my_attestation(window.app_handle())
    };

    // Normalised repo URL (strip /repo.json + trailing slashes, lowercase) recorded
    // on each synced mod as its `source_repo`, so the update checker can match it
    // back to this repo later. Mirrors the frontend's normRepoUrl().
    let src_repo: String = {
        let mut u = url.trim().to_string();
        if let Some(s) = u.strip_suffix("/repo.json") { u = s.to_string(); }
        while u.ends_with('/') { u.pop(); }
        u.to_lowercase()
    };

    state.install_cancelled.store(false, std::sync::atomic::Ordering::SeqCst);
    state.sync_paused.store(false, std::sync::atomic::Ordering::SeqCst);
    let cancel_flag = state.install_cancelled.clone();
    let pause_flag = state.sync_paused.clone();

    let check_pause = || {
        while pause_flag.load(std::sync::atomic::Ordering::SeqCst) {
            if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        false
    };

    // 1. Fetch remote repo info
    let _ = window.emit("bmm://repo-sync-progress", RepoProgress {
        step: "repo.stepConnecting".to_string(),
        progress: 0.0,
        current_file: url.clone(),
    });
    
    let repo = fetch_repo_info(url.clone(), args.creator_id.clone(), args.password.clone()).await?;

    // Determine the base URL for downloading files
    let base_url = if url.ends_with("repo.json") {
        url.trim_end_matches("repo.json").to_string()
    } else if url.ends_with('/') {
        url.clone()
    } else {
        format!("{}/", url)
    };

    // Only create base mods dir if it's actually provided
    if !mods_dir.is_empty() {
        fs::create_dir_all(PathBuf::from(&mods_dir)).map_err(|e| e.to_string())?;
    }

    let total_tasks = choices.len();
    let mut overall_summary = SyncSummary::default();
    let mut synced_profile_ids = Vec::new();
    let mut folders_to_rollback: Vec<PathBuf> = Vec::new();

    for (c_idx, choice) in choices.into_iter().enumerate() {
        if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) || check_pause() {
            for path in &folders_to_rollback {
                if path.exists() { let _ = fs::remove_dir_all(path); }
            }
            return Err("Synchronisation annulée".to_string());
        }

        let repo_profile = repo.profiles.iter().find(|p| p.id == choice.repo_profile_id)
            .ok_or("repo.errProfileNotFound")?.clone();

        // Check if we already have a profile from this repo
        let existing_profile = if let Some(target_id) = &choice.target_local_profile_id {
            let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
            data.profiles.iter().find(|p| &p.id == target_id).cloned()
        } else {
            None
        };

        let is_new_profile = choice.target_local_profile_id.is_none();
        let profile_id = choice.target_local_profile_id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        
        let target_game_path = if !game_dir.is_empty() {
            PathBuf::from(&game_dir)
        } else if let Some(p) = &existing_profile {
            p.game_path.clone()
        } else {
            return Err("repo.errGameDirRequired".to_string());
        };

        let target_backup_path = if !backup_dir.is_empty() {
            PathBuf::from(&backup_dir)
        } else if let Some(p) = &existing_profile {
            p.backup_path.clone()
        } else {
            return Err("repo.errBackupDirRequired".to_string());
        };

        let mods_path = if let Some(p) = &existing_profile {
            p.mods_path.clone()
        } else {
            let base_mods_path = PathBuf::from(&mods_dir);
            if mods_dir.is_empty() {
                return Err("repo.errModsDirRequired".to_string());
            }
            let safe_profile_name = repo_profile.name.replace(|c: char| !c.is_alphanumeric() && c != ' ', "_");
            let mut path = base_mods_path.join(format!("{}", safe_profile_name));
            // Avoid collision if creating new
            if path.exists() && is_new_profile {
                path = base_mods_path.join(format!("{}_{}", safe_profile_name, &profile_id[..4]));
            }
            if is_new_profile {
                folders_to_rollback.push(path.clone());
            }
            path
        };
        
        fs::create_dir_all(&mods_path).map_err(|e| e.to_string())?;

        let mut prof_summary = ProfileSyncSummary {
            name: repo_profile.name.clone(),
            ..Default::default()
        };

        let total_mods = repo_profile.mods.len();
        let mut successfully_synced_mods = Vec::new();
        let mut server_mod_subfolders = std::collections::HashSet::new();

        for (idx, repo_mod) in repo_profile.mods.into_iter().enumerate() {
            if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) || check_pause() {
                for path in &folders_to_rollback {
                    if path.exists() { let _ = fs::remove_dir_all(path); }
                }
                return Err("Synchronisation annulée".to_string());
            }

            // Selective download: skip mods not in the user's selection
            if let Some(ref selected_ids) = choice.selected_mod_ids {
                if !selected_ids.contains(&repo_mod.id) {
                    println!("[Sync] Skipping mod {} (not selected by user)", repo_mod.name);
                    continue;
                }
            }

            let safe_mod_name = repo_mod.name.replace(|c: char| !c.is_alphanumeric() && c != ' ' && c != '-' && c != '_', "_");
            // Add ID prefix to original folder name to avoid collisions if multiple mods sanitize to same name
            let mod_subfolder_name = format!("{}_{}", &repo_mod.id[..8], safe_mod_name);
            let target_mod_dir = mods_path.join(&mod_subfolder_name);
            server_mod_subfolders.insert(mod_subfolder_name.clone());
            
            let is_new_mod = !target_mod_dir.exists();
            if is_new_mod {
                prof_summary.mods_added += 1;
            } else {
                prof_summary.mods_updated += 1;
            }

            fs::create_dir_all(&target_mod_dir).map_err(|e| e.to_string())?;

            // ── Zipped mod: download mods/<id>.zip, then extract or keep as the user chose ──
            if let Some(ref arch) = repo_mod.archive {
                let zip_url = format!("{}{}", base_url, arch.relative_path.replace("\\", "/"));
                let mut cb = reqwest::Client::builder();
                {
                    let mut headers = reqwest::header::HeaderMap::new();
                    if let Some(ref cid) = args.creator_id {
                        if let Ok(hv) = reqwest::header::HeaderValue::from_str(cid) { headers.insert("X-Creator-ID", hv); }
                        // Proves which BetterCommunity account is behind that id, for repos
                        // whose owner gates on accounts rather than on the raw header.
                        if let Some(tok) = attestation.as_deref() {
                            if let Ok(hv) = reqwest::header::HeaderValue::from_str(tok) {
                                headers.insert("X-Creator-Identity", hv);
                            }
                        }
                    }
                    if let Some(ref pw) = args.password { if !pw.is_empty() {
                        if let Ok(hv) = reqwest::header::HeaderValue::from_str(pw) { headers.insert("X-Repo-Password", hv); }
                    } }
                    if !headers.is_empty() { cb = cb.default_headers(headers); }
                }
                let client = cb.build().map_err(|e| e.to_string())?;
                let _ = window.emit("bmm://repo-sync-progress", RepoProgress {
                    step: format!(r#"{{"key":"repo.stepDownloading","profile":"{}","mod":"{}","current":{},"total":{}}}"#, repo_profile.name, repo_mod.name, idx + 1, total_mods),
                    progress: (c_idx as f32 / total_tasks as f32) * 100.0,
                    current_file: arch.relative_path.clone(),
                });
                let res = client.get(&zip_url).send().await
                    .map_err(|e| format!("Network error ({}): {}", arch.relative_path, e))?;
                if !res.status().is_success() {
                    return Err(format!("HTTP {} for {}", res.status(), arch.relative_path));
                }
                // Stream the archive to disk. `res.bytes()` held the ENTIRE archive in memory
                // before writing it out, and an archived mod is routinely the largest single
                // thing a sync transfers — so a big repo could exhaust memory here even though
                // the per-file path below already streams.
                let staged_zip = target_mod_dir.join(".bmm_dl.zip");
                {
                    let mut res = res;
                    let mut out = fs::File::create(&staged_zip).map_err(|e| e.to_string())?;
                    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
                        std::io::Write::write_all(&mut out, &chunk).map_err(|e| e.to_string())?;
                    }
                    std::io::Write::flush(&mut out).map_err(|e| e.to_string())?;
                }

                if args.unzip_archives {
                    crate::archive::extract_to(&staged_zip, &target_mod_dir).map_err(|e| e.to_string())?;
                    let _ = fs::remove_file(&staged_zip);
                } else {
                    // Keep it zipped: store the archive itself (an archived mod) and drop the
                    // empty staging folder. Move the staged file out FIRST — the staging dir is
                    // about to be deleted with it inside.
                    let archive_dest = mods_path.join(format!("{}.zip", mod_subfolder_name));
                    fs::rename(&staged_zip, &archive_dest).map_err(|e| e.to_string())?;
                    let _ = fs::remove_dir_all(&target_mod_dir);
                }
                prof_summary.files_downloaded += 1;
                successfully_synced_mods.push(repo_mod);
                continue;
            }

            let total_files = repo_mod.files.len();
            let mut local_valid_files = std::collections::HashSet::new();

            for (f_idx, file) in repo_mod.files.iter().enumerate() {
                if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) || check_pause() {
                    for path in &folders_to_rollback {
                        if path.exists() { let _ = fs::remove_dir_all(path); }
                    }
                    return Err("Synchronisation annulée".to_string());
                }

                let local_path = target_mod_dir.join(&file.relative_path);
                let mut needs_download = true;

                if local_path.exists() && !args.overwrite_all {
                    if let Ok((local_hash, _)) = compute_file_hash_and_chunks(&local_path, false) {
                        if local_hash == file.sha256_hash {
                            println!("[Sync] File {} is up to date (hash matches), skipping", file.relative_path);
                            needs_download = false;
                        } else {
                            println!("[Sync] Hash mismatch for {}, checking chunks/re-downloading...", file.relative_path);
                        }
                    }
                }

                if needs_download {
                    let _ = window.emit("bmm://repo-sync-progress", RepoProgress {
                        step: format!(r#"{{"key":"repo.stepDownloading","profile":"{}","mod":"{}","current":{},"total":{}}}"#, repo_profile.name, repo_mod.name, idx + 1, total_mods),
                        progress: ((c_idx as f32 / total_tasks as f32) + ((idx as f32 / total_mods as f32) * (1.0 / total_tasks as f32)) + ((f_idx as f32 / total_files as f32) * (1.0 / (total_mods as f32 * total_files as f32 * total_tasks as f32)))) * 100.0,
                        current_file: file.relative_path.clone(),
                    });

                    if let Some(parent) = local_path.parent() {
                        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }

                    let file_url = mod_file_url(
                        &base_url,
                        repo.files_base_url.as_deref(),
                        repo.files_layout.as_deref(),
                        &repo_mod.id,
                        &file.relative_path,
                    );
                    let mut client_builder = reqwest::Client::builder();
                    {
                        let mut headers = reqwest::header::HeaderMap::new();
                        if let Some(ref cid) = args.creator_id {
                            if let Ok(hv) = reqwest::header::HeaderValue::from_str(cid) { headers.insert("X-Creator-ID", hv); }
                        // Proves which BetterCommunity account is behind that id, for repos
                        // whose owner gates on accounts rather than on the raw header.
                        if let Some(tok) = attestation.as_deref() {
                            if let Ok(hv) = reqwest::header::HeaderValue::from_str(tok) {
                                headers.insert("X-Creator-Identity", hv);
                            }
                        }
                        }
                        if let Some(ref pw) = args.password { if !pw.is_empty() {
                            if let Ok(hv) = reqwest::header::HeaderValue::from_str(pw) { headers.insert("X-Repo-Password", hv); }
                        } }
                        if !headers.is_empty() { client_builder = client_builder.default_headers(headers); }
                    }
                    let client = client_builder.build().map_err(|e| e.to_string())?;

                    // Differential Sync Logic
                    let mut partial_success = false;
                    if local_path.exists() {
                        if let Some(remote_chunks) = file.chunks.as_ref() {
                            if let Ok(local_chunks) = compute_local_chunk_hashes(&local_path) {
                                let mut file_to_patch = fs::OpenOptions::new().read(true).write(true).open(&local_path).map_err(|e| e.to_string())?;
                            
                            let mut current_offset: u64 = 0;

                            for (chunk_idx, r_chunk) in remote_chunks.iter().enumerate() {
                                let matches = local_chunks.get(chunk_idx).map(|lh| lh == &r_chunk.sha256_hash).unwrap_or(false);
                                
                                if !matches {
                                    println!("[Sync] Patching chunk {}/{} for {}", chunk_idx + 1, remote_chunks.len(), file.relative_path);
                                    let _ = window.emit("bmm://repo-sync-progress", RepoProgress {
                                        step: format!(r#"{{"key":"repo.stepFetchingPart","profile":"{}","mod":"{}","current":{},"total":{}}}"#, repo_profile.name, repo_mod.name, chunk_idx + 1, remote_chunks.len()),
                                        progress: ((c_idx as f32 / total_tasks as f32) + ((idx as f32 / total_mods as f32) * (1.0 / total_tasks as f32)) + ((f_idx as f32 / total_files as f32) * (1.0 / (total_mods as f32 * total_files as f32 * total_tasks as f32))) + ((chunk_idx as f32 / remote_chunks.len() as f32) * (1.0 / (total_mods as f32 * total_files as f32 * total_tasks as f32)))) * 100.0,
                                        current_file: file.relative_path.clone(),
                                    });

                                    let range_header = format!("bytes={}-{}", current_offset, current_offset + r_chunk.size as u64 - 1);
                                    let res = client.get(&file_url).header("Range", range_header).send().await.map_err(|e| format!("Erreur Range ({}): {}", file.relative_path, e))?;
                                    
                                    if res.status() == 206 || res.status() == 200 {
                                        let mut stream = res.bytes_stream();
                                        file_to_patch.seek(SeekFrom::Start(current_offset)).map_err(|e| e.to_string())?;

                                        while let Some(item) = stream.next().await {
                                            let chunk: bytes::Bytes = item.map_err(|e| format!("Stream error: {}", e))?;
                                            file_to_patch.write_all(&chunk).map_err(|e| e.to_string())?;
                                            
                                            // Throttling
                                            if args.download_limit > 0 {
                                                let sleep_ms = (chunk.len() as u64 * 1000) / (args.download_limit as u64 * 1024);
                                                if sleep_ms > 0 {
                                                    sleep(Duration::from_millis(sleep_ms)).await;
                                                }
                                            }
                                        }
                                    } else if res.status() == 403 {
                                        return Err("repo.errForbidden".to_string());
                                    } else {
                                        return Err(format!("The server does not support les Range requests ou erreur HTTP {}", res.status()));
                                    }
                                }
                                current_offset += r_chunk.size as u64;
                            }
                            
                            file_to_patch.set_len(file.size).map_err(|_| "repo.errWriteFile".to_string())?;
                            println!("[Sync] Successfully patched {} using chunks", file.relative_path);
                            partial_success = true;
                        } else {
                            println!("[Sync] No matching chunks found for {}, falling back to full download", file.relative_path);
                        }
                    }
                }

                if !partial_success {
                        let res = client.get(&file_url).send().await.map_err(|e| format!("Network error ({}): {}", file.relative_path, e))?;
                        if !res.status().is_success() {
                            if res.status() == 403 {
                                return Err("repo.errForbidden".to_string());
                            }
                            return Err(format!("HTTP error {} pour le fichier: {}", res.status(), file.relative_path));
                        }
                        
                        let mut stream = res.bytes_stream();
                        let mut file_out = fs::File::create(&local_path).map_err(|e| format!("Création échouée: {}", e))?;
                        
                        while let Some(item) = stream.next().await {
                            let chunk: bytes::Bytes = item.map_err(|e| format!("Stream error: {}", e))?;
                            file_out.write_all(&chunk).map_err(|e| e.to_string())?;
                            
                            // Throttling
                            if args.download_limit > 0 {
                                let sleep_ms = (chunk.len() as u64 * 1000) / (args.download_limit as u64 * 1024);
                                if sleep_ms > 0 {
                                    sleep(Duration::from_millis(sleep_ms)).await;
                                }
                            }
                        }
                    }
                    prof_summary.files_downloaded += 1;
                    prof_summary.bytes_downloaded += file.size;
                }

                let (downloaded_hash, _) = compute_file_hash_and_chunks(&local_path, false)?;
                if downloaded_hash != file.sha256_hash {
                    return Err("repo.errIntegrity".to_string());
                }

                local_valid_files.insert(file.relative_path.replace("\\", "/"));
            } // End of for (f_idx, file)
            if let Ok(all_local) = crate::fs_utils::list_mod_files(&target_mod_dir) {
                for rel in all_local {
                    let rel_str = rel.to_string_lossy().to_string().replace("\\", "/");
                    if !local_valid_files.contains(&rel_str) {
                        let to_delete = target_mod_dir.join(&rel);
                        let _ = fs::remove_file(to_delete);
                    }
                }
            }
            
            let _ = crate::fs_utils::remove_empty_dirs(&target_mod_dir);
            successfully_synced_mods.push(repo_mod);
        } // End of for (idx, repo_mod)

        // Cleanup: remove mods no longer in the server profile (if requested)
        if args.delete_extra {
            if let Ok(entries) = fs::read_dir(&mods_path) {
                for entry in entries.flatten() {
                    if let Ok(file_type) = entry.file_type() {
                        if file_type.is_dir() {
                            let name = entry.file_name().to_string_lossy().to_string();
                            // Only delete if it follows BMM repo pattern "ID_Name" 
                            // and is NOT in current list
                            if name.len() > 9 && name.chars().nth(8) == Some('_') && !server_mod_subfolders.contains(&name) {
                                let _ = fs::remove_dir_all(entry.path());
                                prof_summary.mods_removed += 1;
                            }
                        }
                    }
                }
            }
        }

        // Materialize a shared custom icon (data-URI) into a local file so it's
        // restored alongside the profile.
        let restored_icon_image: Option<String> = repo_profile.icon_image.as_ref().and_then(|data_uri| {
            use base64::{Engine as _, engine::general_purpose};
            let comma = data_uri.find(',')?;
            let meta = &data_uri[..comma];
            let bytes = general_purpose::STANDARD.decode(data_uri[comma + 1..].as_bytes()).ok()?;
            let ext = if meta.contains("image/png") { "png" }
                else if meta.contains("image/jpeg") { "jpg" }
                else if meta.contains("image/webp") { "webp" }
                else if meta.contains("image/gif") { "gif" }
                else if meta.contains("svg") { "svg" }
                else { "png" };
            let fname = format!("icon_{}.{}", profile_id, ext);
            let data_dir = state.data_path.parent().unwrap_or(std::path::Path::new("."));
            std::fs::write(data_dir.join(&fname), &bytes).ok()?;
            Some(fname)
        });

        // Add or update this specific profile in AppState
        {
            let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());

            if let Some(p) = data.profiles.iter_mut().find(|p| p.id == profile_id) {
                p.name = format!("{} - {}", repo.name, repo_profile.name);
                p.game_name = repo_profile.game_name.clone();
                p.origin_repo_profile_id = Some(repo_profile.id.clone());
                if repo_profile.icon.is_some() { p.icon = repo_profile.icon.clone(); }
                if repo_profile.color.is_some() { p.color = repo_profile.color.clone(); }
                if restored_icon_image.is_some() { p.icon_image = restored_icon_image.clone(); }
            } else {
                let mut new_profile = crate::models::profile::Profile::new(
                    format!("{} - {}", repo.name, repo_profile.name),
                    repo_profile.game_name.clone(),
                    target_game_path,
                    mods_path.clone(),
                    target_backup_path,
                );
                new_profile.id = profile_id.clone();
                new_profile.origin_repo_profile_id = Some(repo_profile.id.clone());
                new_profile.icon = repo_profile.icon.clone();
                new_profile.color = repo_profile.color.clone();
                new_profile.icon_image = restored_icon_image.clone();
                data.profiles.push(new_profile);
            }
            
            synced_profile_ids.push(profile_id.clone());
            overall_summary.profiles.push(prof_summary);
            
            for repo_mod in successfully_synced_mods {
                let safe_mod_name = repo_mod.name.replace(|c: char| !c.is_alphanumeric() && c != ' ' && c != '-' && c != '_', "_");
                let folder_name = format!("{}_{}", &repo_mod.id[..8], safe_mod_name);
                // A zipped mod kept as-is lives at "<folder>.zip" (an archived mod);
                // extracted (or classic) mods live in the "<folder>" directory.
                let kept_zipped = repo_mod.archive.is_some() && !args.unzip_archives;
                let target_mod_dir = if kept_zipped {
                    mods_path.join(format!("{}.zip", folder_name))
                } else {
                    mods_path.join(&folder_name)
                };

                let mut new_mod = crate::models::mod_entry::ModEntry::new(
                    repo_mod.name.clone(),
                    target_mod_dir
                );
                new_mod.id = repo_mod.id.clone();
                new_mod.version = repo_mod.version.clone();
                new_mod.author = repo_mod.author.clone();
                new_mod.description = repo_mod.description.clone();
                new_mod.download_links = repo_mod.download_links.clone();
                // Carry over the (already cross-profile-filtered) dependencies.
                new_mod.dependencies = repo_mod.dependencies.clone();
                // Update-system origin tracking: remember which repo + stable mod id
                // this came from, so check_mod_updates can detect newer versions.
                new_mod.source_repo = Some(src_repo.clone());
                new_mod.repo_mod_id = Some(repo_mod.id.clone());
                // Inherit the author's configured update sources (a site repo, a
                // direct-download archive, fallbacks). Signatures are not shared —
                // the receiver captures its own baseline on the first check.
                new_mod.update_url = repo_mod.update_url.clone();
                new_mod.direct_url = repo_mod.direct_url.clone();
                new_mod.update_sources = repo_mod.update_sources.iter()
                    .map(|s| crate::models::mod_entry::UpdateSource { sig: None, ..s.clone() }).collect();

                let mut tag_ids = Vec::new();
                for repo_tag in repo_mod.tags {
                    if !data.custom_tags.iter().any(|t| t.id == repo_tag.id) {
                        data.custom_tags.push(crate::models::tag::TagDef {
                            id: repo_tag.id.clone(),
                            name: repo_tag.name.clone(),
                            color: repo_tag.color_bg.clone(),
                            icon: "fas fa-tag".to_string(),
                        });
                    }
                    tag_ids.push(repo_tag.id);
                }
                new_mod.tags = tag_ids;
                if !data.mods.iter().any(|m| m.mod_folder_path == new_mod.mod_folder_path) {
                    data.mods.push(new_mod);
                } else if let Some(existing) = data.mods.iter_mut().find(|m| m.mod_folder_path == new_mod.mod_folder_path) {
                    existing.name = new_mod.name;
                    existing.version = new_mod.version;
                    existing.author = new_mod.author;
                    existing.description = new_mod.description;
                    existing.tags = new_mod.tags;
                    existing.download_links = new_mod.download_links;
                    existing.dependencies = new_mod.dependencies;
                    existing.source_repo = new_mod.source_repo;
                    existing.repo_mod_id = new_mod.repo_mod_id;
                    // Only fill update sources when the local mod has none — never
                    // clobber a user's own customised sources on re-sync.
                    if existing.update_url.is_none() { existing.update_url = new_mod.update_url; }
                    if existing.direct_url.is_none() {
                        existing.direct_url = new_mod.direct_url;
                        if existing.direct_url.is_some() { existing.direct_sig = None; }
                    }
                    if existing.update_sources.is_empty() { existing.update_sources = new_mod.update_sources; }
                }
            }
        }
    } // End of for (c_idx, choice)

    // Assign active profile to the first synced one
    {
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(first_id) = synced_profile_ids.first() {
            data.active_profile_id = Some(first_id.clone());
        }
    }
    
    let _ = state.save();

    let _ = window.emit("bmm://repo-sync-progress", RepoProgress {
        step: "repo.stepFinished".to_string(),
        progress: 100.0,
        current_file: String::new(),
    });

    Ok(overall_summary)
}

#[tauri::command]
pub fn cancel_repo_sync(state: State<'_, AppState>) {
    state.install_cancelled.store(true, std::sync::atomic::Ordering::SeqCst);
}

#[tauri::command]
pub fn pause_repo_sync(state: State<'_, AppState>) {
    state.sync_paused.store(true, std::sync::atomic::Ordering::SeqCst);
}

#[tauri::command]
pub fn resume_repo_sync(state: State<'_, AppState>) {
    state.sync_paused.store(false, std::sync::atomic::Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_compute_local_chunk_hashes() {
        let mut file = NamedTempFile::new().unwrap();
        // Create a file with slightly more than one chunk (4MB + 1KB)
        let large_data = vec![0u8; CHUNK_SIZE + 1024];
        file.write_all(&large_data).unwrap();
        
        let path = file.path();
        let hashes = compute_local_chunk_hashes(path).unwrap();
        
        assert_eq!(hashes.len(), 2);
        assert!(!hashes[0].is_empty());
        assert!(!hashes[1].is_empty());
        assert_ne!(hashes[0], hashes[1]);
    }

    #[test]
    fn test_compute_file_hash_and_chunks() {
        let mut file = NamedTempFile::new().unwrap();
        let data = b"small file content";
        file.write_all(data).unwrap();
        
        let path = file.path();
        let (hash, chunks) = compute_file_hash_and_chunks(path, false).unwrap();
        
        assert!(!hash.is_empty());
        assert!(chunks.is_none());

        // Test with chunks
        let mut large_file = NamedTempFile::new().unwrap();
        let large_data = vec![0u8; CHUNK_SIZE + 1024];
        large_file.write_all(&large_data).unwrap();
        let (large_hash, chunks) = compute_file_hash_and_chunks(large_file.path(), true).unwrap();
        
        assert!(!large_hash.is_empty());
        assert!(chunks.is_some());
        assert_eq!(chunks.unwrap().len(), 2);
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateManifestArgs {
    /// Directory whose subdirectories are the mods.
    pub mods_dir: String,
    /// Where to write the manifest. Defaults to `repo.json` beside `mods_dir` rather than
    /// inside it, so a later scan never picks the manifest up as one of the mod files.
    pub output_path: Option<String>,
    pub name: Option<String>,
    pub author: Option<String>,
    pub game_name: Option<String>,
    /// Absolute URL of the directory the layout below is relative to.
    pub files_base_url: Option<String>,
    /// `{id}` / `{path}` template; default `mods/{id}/{path}`.
    pub files_layout: Option<String>,
    /// Keep the previous manifest's identity, so re-generating is a new revision of the same
    /// repo rather than a different one. On by default — see the command docs.
    #[serde(default = "default_true")]
    pub reuse_existing: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateManifestReport {
    pub output_path: String,
    pub mods: usize,
    pub files: usize,
    pub total_bytes: u64,
    /// Mod ids present now that the previous manifest did not have.
    pub added: Vec<String>,
    /// Mod ids the previous manifest had that are no longer on disk, now dropped. Reported
    /// because a mistyped path is otherwise indistinguishable from a deliberate removal —
    /// both write a perfectly valid manifest, one of them describing an empty server.
    pub removed: Vec<String>,
    /// Mod ids whose file content changed.
    pub changed: Vec<String>,
}

/// Generate a `repo.json` for a directory of mods that is already hosted somewhere.
///
/// The other two paths both assume BMM is the origin: `export_server_repo` copies every mod
/// into an output folder, and the `/api/repo/gen` lightweight mode still needs the mods
/// imported into a BMM profile first. Neither helps someone who already runs a mod server and
/// only wants a manifest describing it. This reads a folder and writes one file — nothing is
/// copied, nothing is imported, and the directory it describes is never modified.
///
/// One subdirectory of `mods_dir` is one mod, and its **folder name is the mod id**, so the
/// URLs in the manifest line up with the folder exactly as it already sits on the server.
///
/// Re-running it over the same folder is also how a repo is updated: the previous manifest's
/// seed, id and creation date are carried forward so clients see a new revision of the repo
/// they already track rather than an unrelated one, and the report says which mods were
/// added, changed or dropped.
#[tauri::command]
pub async fn generate_repo_manifest(
    args: GenerateManifestArgs,
) -> Result<GenerateManifestReport, String> {
    tauri::async_runtime::spawn_blocking(move || generate_repo_manifest_sync(args))
        .await
        .map_err(|e| e.to_string())?
}

pub(crate) fn generate_repo_manifest_sync(
    args: GenerateManifestArgs,
) -> Result<GenerateManifestReport, String> {
    use crate::models::repo::RepoProfile;
    use std::collections::HashMap;
    use walkdir::WalkDir;

    let mods_dir = PathBuf::from(&args.mods_dir);
    if !mods_dir.is_dir() {
        return Err(format!("Not a directory: {}", mods_dir.display()));
    }

    let output_path = match args.output_path.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(p) => PathBuf::from(p),
        None => mods_dir.parent().unwrap_or(&mods_dir).join("repo.json"),
    };

    // Read the previous manifest before overwriting it — both to carry identity forward and
    // to be able to report what actually changed.
    let previous: Option<ServerRepo> = if args.reuse_existing {
        fs::read_to_string(&output_path).ok().and_then(|s| serde_json::from_str(&s).ok())
    } else {
        None
    };
    let previous_mods: HashMap<String, String> = previous.as_ref().map(|r| {
        r.profiles.iter().flat_map(|p| p.mods.iter())
            .map(|m| (m.id.clone(), mod_content_hash(m)))
            .collect()
    }).unwrap_or_default();

    let mut entries: Vec<_> = fs::read_dir(&mods_dir).map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .collect();
    entries.sort_by_key(|e| e.file_name());

    let mut repo_mods = Vec::new();
    let mut total_files = 0usize;
    let mut total_bytes = 0u64;

    for entry in entries {
        let dir = entry.path();
        let id = entry.file_name().to_string_lossy().to_string();

        let mut files = Vec::new();
        for f in WalkDir::new(&dir).into_iter().filter_map(|e| e.ok()) {
            let p = f.path();
            if !p.is_file() { continue; }
            let rel = match p.strip_prefix(&dir) {
                Ok(r) => r.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };
            let size = f.metadata().map(|m| m.len()).unwrap_or(0);
            // Chunk hashes only earn their size on files big enough to resume or patch.
            let (hash, chunks) = compute_file_hash_and_chunks(&p, size as usize > CHUNK_SIZE)?;
            total_bytes += size;
            files.push(RepoFile { relative_path: rel, size, sha256_hash: hash, chunks });
        }
        if files.is_empty() { continue; }
        files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
        total_files += files.len();

        repo_mods.push(RepoMod {
            id: id.clone(),
            name: id,
            version: "1.0.0".to_string(),
            author: args.author.clone(),
            description: None,
            tags: Vec::new(),
            files,
            archive: None,
            download_links: Vec::new(),
            dependencies: Vec::new(),
            changelog: None,
            update_url: None,
            direct_url: None,
            update_sources: Vec::new(),
        });
    }

    if repo_mods.is_empty() {
        return Err(format!(
            "No mods found in {} — expected one subdirectory per mod",
            mods_dir.display()
        ));
    }

    let now: HashMap<String, String> = repo_mods.iter()
        .map(|m| (m.id.clone(), mod_content_hash(m)))
        .collect();
    let mut added: Vec<String> =
        now.keys().filter(|k| !previous_mods.contains_key(*k)).cloned().collect();
    let mut removed: Vec<String> =
        previous_mods.keys().filter(|k| !now.contains_key(*k)).cloned().collect();
    let mut changed: Vec<String> = now.iter()
        .filter(|(k, v)| previous_mods.get(*k).map(|p| p != *v).unwrap_or(false))
        .map(|(k, _)| k.clone())
        .collect();
    added.sort();
    removed.sort();
    changed.sort();

    let game_name = args.game_name.clone()
        .or_else(|| previous.as_ref().map(|r| r.game_name.clone()))
        .unwrap_or_default();
    let name = args.name.clone()
        .or_else(|| previous.as_ref().map(|r| r.name.clone()))
        .unwrap_or_else(|| "BMM Repo".to_string());

    let mut repo = ServerRepo::new(name, game_name);
    if let Some(prev) = &previous {
        // Same repo, new revision: keep the identity clients already track.
        repo.seed = prev.seed.clone();
        repo.created_at = prev.created_at.clone();
        repo.description = prev.description.clone();
        repo.author_id = prev.author_id.clone();
        repo.require_login = prev.require_login;
        repo.upload_limit = prev.upload_limit;
    }
    if repo.seed.is_none() {
        repo.seed = Some(uuid::Uuid::new_v4().to_string());
    }
    repo.author = args.author.clone()
        .or_else(|| previous.as_ref().and_then(|r| r.author.clone()));
    repo.files_base_url = args.files_base_url.as_ref()
        .map(|u| u.trim().trim_end_matches('/').to_string())
        .filter(|u| !u.is_empty())
        .or_else(|| previous.as_ref().and_then(|r| r.files_base_url.clone()));
    repo.files_layout = args.files_layout.as_ref()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .or_else(|| previous.as_ref().and_then(|r| r.files_layout.clone()));

    let profile_id = previous.as_ref()
        .and_then(|r| r.profiles.first().map(|p| p.id.clone()))
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    repo.profiles = vec![RepoProfile {
        id: profile_id,
        name: repo.name.clone(),
        game_name: repo.game_name.clone(),
        mods: repo_mods,
        icon: None,
        color: None,
        icon_image: None,
    }];

    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&repo).map_err(|e| e.to_string())?;
    fs::write(&output_path, json).map_err(|e| e.to_string())?;

    Ok(GenerateManifestReport {
        output_path: output_path.to_string_lossy().to_string(),
        mods: repo.profiles[0].mods.len(),
        files: total_files,
        total_bytes,
        added,
        removed,
        changed,
    })
}

/// Content identity of a mod: every file path and hash, order-independent.
/// Only used to report what changed between two generations.
fn mod_content_hash(m: &crate::models::repo::RepoMod) -> String {
    let mut parts: Vec<String> = m.files.iter()
        .map(|f| format!("{}:{}", f.relative_path, f.sha256_hash))
        .collect();
    parts.sort();
    let mut h = Sha256::new();
    for p in parts {
        h.update(p.as_bytes());
        h.update(b"\n");
    }
    format!("{:x}", h.finalize())
}

#[cfg(test)]
mod url_tests {
    use super::mod_file_url;

    // The base coming from the repo URL already ends with a slash; a hand-typed
    // files_base_url may or may not. Both wrong outcomes 404 per file rather than failing
    // loudly, so they are asserted rather than assumed.
    #[test]
    fn a_manifest_can_point_at_files_hosted_somewhere_else() {
        // The base names the directory that CONTAINS `mods/`, not `mods/` itself.
        for base in [
            "https://cdn.example/bmm",
            "https://cdn.example/bmm/",
            "  https://cdn.example/bmm///  ",
        ] {
            assert_eq!(
                mod_file_url("https://repo.example/", Some(base), None, "cool-mod", "tex/a.dds"),
                "https://cdn.example/bmm/mods/cool-mod/tex/a.dds",
                "base {base:?} did not normalise",
            );
        }
    }

    #[test]
    fn without_the_field_nothing_changes() {
        // Every manifest generated before files_base_url existed has None here, and must
        // resolve against the directory holding repo.json exactly as it always did.
        for empty in [None, Some(""), Some("   ")] {
            assert_eq!(
                mod_file_url("https://repo.example/r/", empty, None, "cool-mod", "tex/a.dds"),
                "https://repo.example/r/mods/cool-mod/tex/a.dds",
                "empty base {empty:?} should fall back",
            );
        }
    }

    #[test]
    fn windows_separators_become_url_separators() {
        assert_eq!(
            mod_file_url("https://r.example/", None, None, "m", r"tex\sub\a.dds"),
            "https://r.example/mods/m/tex/sub/a.dds"
        );
    }

    #[test]
    fn a_layout_template_adapts_to_hosting_that_already_has_its_own_shape() {
        // The point of the field: the server does not move, the manifest describes it.
        assert_eq!(
            mod_file_url("https://h/", None, Some("addons/{id}/{path}"), "m", "a/b.dds"),
            "https://h/addons/m/a/b.dds"
        );
        // Mods served straight off the root, with no directory at all above them.
        assert_eq!(
            mod_file_url("https://h/", None, Some("{id}/{path}"), "m", "a/b.dds"),
            "https://h/m/a/b.dds"
        );
        // A leading slash would otherwise discard the path already in the base URL.
        assert_eq!(
            mod_file_url("https://h/sub/", None, Some("/{id}/{path}"), "m", "b.dds"),
            "https://h/sub/m/b.dds"
        );
        // Empty or absent means the historical layout, for every manifest already published.
        for none in [None, Some(""), Some("  ")] {
            assert_eq!(
                mod_file_url("https://h/", None, none, "m", "b.dds"),
                "https://h/mods/m/b.dds",
                "layout {none:?} should fall back",
            );
        }
    }
}

#[cfg(test)]
mod manifest_tests {
    use super::{generate_repo_manifest_sync, GenerateManifestArgs};
    use crate::models::repo::ServerRepo;
    use std::fs;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("bmm_manifest_{}", name));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("mods/cool-mod/textures")).unwrap();
        fs::create_dir_all(d.join("mods/other-mod")).unwrap();
        fs::write(d.join("mods/cool-mod/textures/a.dds"), b"aaa").unwrap();
        fs::write(d.join("mods/cool-mod/readme.txt"), b"hi").unwrap();
        fs::write(d.join("mods/other-mod/b.pak"), b"bbb").unwrap();
        d
    }

    fn args(root: &PathBuf) -> GenerateManifestArgs {
        GenerateManifestArgs {
            mods_dir: root.join("mods").to_string_lossy().to_string(),
            output_path: None,
            name: Some("Test Repo".into()),
            author: Some("me".into()),
            game_name: Some("Game".into()),
            files_base_url: Some("https://host/files/".into()),
            files_layout: None,
            reuse_existing: true,
        }
    }

    fn read(root: &PathBuf) -> ServerRepo {
        serde_json::from_str(&fs::read_to_string(root.join("repo.json")).unwrap()).unwrap()
    }

    #[test]
    fn it_writes_a_manifest_without_touching_the_mods() {
        let root = scratch("plain");
        let before: Vec<_> = walkdir::WalkDir::new(root.join("mods")).into_iter()
            .filter_map(|e| e.ok()).map(|e| e.path().to_path_buf()).collect();

        let report = generate_repo_manifest_sync(args(&root)).unwrap();

        assert_eq!(report.mods, 2);
        assert_eq!(report.files, 3);
        assert_eq!(report.total_bytes, 8);
        // The manifest lands NEXT TO the mods dir, never inside it — otherwise the next run
        // would index repo.json as one of the mod's own files.
        assert_eq!(report.output_path, root.join("repo.json").to_string_lossy());

        let after: Vec<_> = walkdir::WalkDir::new(root.join("mods")).into_iter()
            .filter_map(|e| e.ok()).map(|e| e.path().to_path_buf()).collect();
        assert_eq!(before, after, "generation must not add, move or copy anything");

        let repo = read(&root);
        assert_eq!(repo.files_base_url.as_deref(), Some("https://host/files"));
        let ids: Vec<_> = repo.profiles[0].mods.iter().map(|m| m.id.as_str()).collect();
        // Folder name IS the id — that is what makes the URLs line up with the live server.
        assert_eq!(ids, vec!["cool-mod", "other-mod"]);
    }

    #[test]
    fn the_generated_urls_point_at_the_files_as_they_already_sit() {
        let root = scratch("urls");
        let mut a = args(&root);
        a.files_layout = Some("addons/{id}/{path}".into());
        generate_repo_manifest_sync(a).unwrap();

        let repo = read(&root);
        let m = repo.profiles[0].mods.iter().find(|m| m.id == "cool-mod").unwrap();
        let f = m.files.iter().find(|f| f.relative_path == "textures/a.dds").unwrap();
        assert_eq!(
            super::mod_file_url(
                "https://ignored/",
                repo.files_base_url.as_deref(),
                repo.files_layout.as_deref(),
                &m.id,
                &f.relative_path,
            ),
            "https://host/files/addons/cool-mod/textures/a.dds",
        );
    }

    #[test]
    fn regenerating_is_an_update_of_the_same_repo_and_reports_the_diff() {
        let root = scratch("update");
        generate_repo_manifest_sync(args(&root)).unwrap();
        let first = read(&root);

        // One mod edited, one added, one deleted from disk.
        fs::write(root.join("mods/cool-mod/readme.txt"), b"changed").unwrap();
        fs::create_dir_all(root.join("mods/new-mod")).unwrap();
        fs::write(root.join("mods/new-mod/c.pak"), b"c").unwrap();
        fs::remove_dir_all(root.join("mods/other-mod")).unwrap();

        let report = generate_repo_manifest_sync(args(&root)).unwrap();
        assert_eq!(report.added, vec!["new-mod"]);
        assert_eq!(report.changed, vec!["cool-mod"]);
        // Silence here would let a mistyped path look exactly like a deliberate removal.
        assert_eq!(report.removed, vec!["other-mod"]);

        let second = read(&root);
        // Clients track a repo by its seed: a new one would read as an unrelated repo and
        // strand everyone already subscribed.
        assert_eq!(first.seed, second.seed);
        assert_eq!(first.created_at, second.created_at);
        assert_eq!(first.profiles[0].id, second.profiles[0].id);
    }

    #[test]
    fn an_empty_or_wrong_folder_is_an_error_rather_than_an_empty_repo() {
        let root = scratch("empty");
        let empty = root.join("nothing");
        fs::create_dir_all(&empty).unwrap();
        let mut a = args(&root);
        a.mods_dir = empty.to_string_lossy().to_string();
        assert!(generate_repo_manifest_sync(a).is_err());

        let mut a = args(&root);
        a.mods_dir = root.join("does-not-exist").to_string_lossy().to_string();
        assert!(generate_repo_manifest_sync(a).is_err());
    }
}
