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

#[derive(serde::Serialize, Default, Clone)]
pub struct ProfileSyncSummary {
    pub name: String,
    pub mods_added: usize,
    pub mods_updated: usize,
    pub mods_removed: usize,
    pub files_downloaded: usize,
    pub bytes_downloaded: u64,
}

#[derive(serde::Serialize, Default)]
pub struct SyncSummary {
    pub profiles: Vec<ProfileSyncSummary>,
}

const CHUNK_SIZE: usize = 4 * 1024 * 1024; // 4MB

fn compute_file_hash_and_chunks(path: &Path, need_chunks: bool) -> Result<(String, Option<Vec<RepoChunk>>), String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut global_hasher = Sha256::new();
    let mut chunks = Vec::new();
    let mut buffer = vec![0u8; CHUNK_SIZE];
    
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
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
) -> Result<(), String> {
    if author_name.trim().is_empty() {
        return Err("repo.errAuthorRequired".to_string());
    }

    let output_path = PathBuf::from(&output_dir);
    if !output_path.exists() {
        fs::create_dir_all(&output_path).map_err(|_| "repo.errCreateOutputDir".to_string())?;
    } else if !output_path.is_dir() {
        return Err("repo.errOutputDirNotDir".to_string());
    }

    state.install_cancelled.store(false, std::sync::atomic::Ordering::SeqCst);
    let cancel_flag = state.install_cancelled.clone();

    let repo_mods_dir = output_path.join("mods");
    if !repo_mods_dir.exists() {
        fs::create_dir_all(&repo_mods_dir).map_err(|_| "repo.errCreateModDir".to_string())?;
    } else if !repo_mods_dir.is_dir() {
        return Err("repo.errOutputDirNotDir".to_string());
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

    // Loop over each profile
    for (p_idx, (profile, exported_mods)) in profiles_data.into_iter().enumerate() {
        if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("Synchronisation annulée".to_string());
        }
        let mut repo_profile = crate::models::repo::RepoProfile {
            id: profile.id.clone(),
            name: profile.name.clone(),
            game_name: profile.game_name.clone(),
            mods: Vec::new(),
        };

        let total_mods = exported_mods.len();
        for (idx, mod_entry) in exported_mods.iter().enumerate() {
            let _ = window.emit("bmm://repo-export-progress", RepoProgress {
                step: format!(r#"{{"key":"repo.stepPreparing","profile":"{}","mod":"{}","current":{},"total":{}}}"#, profile.name, mod_entry.name, idx + 1, total_mods),
                progress: ((p_idx as f32 / total_profiles as f32) + ((idx as f32 / total_mods as f32) * (1.0 / total_profiles as f32))) * 100.0,
                current_file: String::new(),
            });

            if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
                return Err("Synchronisation annulée".to_string());
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

            let mut repo_mod = RepoMod {
                id: mod_entry.id.clone(),
                name: mod_entry.name.clone(),
                version: mod_entry.version.clone(),
                author: mod_entry.author.clone(),
                description: mod_entry.description.clone(),
                tags: resolved_tags,
                files: Vec::new(),
                download_links: mod_entry.download_links.clone(),
            };

            let files = fs_utils::list_mod_files(&mod_entry.mod_folder_path).map_err(|e| e.to_string())?;
            let total_files = files.len();
            
            use rayon::prelude::*;
            use std::sync::atomic::{AtomicUsize, Ordering};
            use std::sync::Mutex;

            let f_idx_atomic = AtomicUsize::new(0);
            let repo_files: Result<Vec<RepoFile>, String> = files.par_iter().map(|rel_path| {
                let src_path = mod_entry.mod_folder_path.join(rel_path);
                let dst_path = target_mod_dir.join(rel_path);
                
                if let Some(parent) = dst_path.parent() {
                    if !parent.exists() {
                        fs::create_dir_all(parent).map_err(|_| "repo.errCreateSubfolder".to_string())?;
                    }
                }

                let f_idx = f_idx_atomic.fetch_add(1, Ordering::SeqCst);
                if f_idx % 5 == 0 && cancel_flag.load(Ordering::SeqCst) {
                    return Err("Synchronisation annulée".to_string());
                }

                // Copy file
                fs::copy(&src_path, &dst_path).map_err(|_| "repo.errCopyFile".to_string())?;

                // Compute Hash
                let size = fs::metadata(&dst_path).map(|m| m.len()).unwrap_or(0);
                let (sha256_hash, chunks) = compute_file_hash_and_chunks(&dst_path, size > CHUNK_SIZE as u64)?;

                if f_idx % 10 == 0 || f_idx == total_files - 1 {
                    let _ = window.emit("bmm://repo-export-progress", RepoProgress {
                        step: format!(r#"{{"key":"repo.stepExporting","profile":"{}","mod":"{}","current":{},"total":{}}}"#, profile.name, mod_entry.name, idx + 1, total_mods),
                        progress: ((p_idx as f32 / total_profiles as f32) + ((idx as f32 / total_mods as f32) * (1.0 / total_profiles as f32)) + ((f_idx as f32 / total_files as f32) * (1.0 / (total_mods * total_profiles) as f32))) * 100.0,
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
        progress: 99.0,
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

    // Auto-generate mini server by default if it's a new export? 
    // Actually better to have the dedicated button as requested.

    let _ = window.emit("bmm://repo-export-progress", RepoProgress {
        step: "repo.stepFinished".to_string(),
        progress: 100.0,
        current_file: String::new(),
    });

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
) -> Result<(), String> {
    // 1. Get custom cloudflared path or "AUTO"
    let state = handle.state::<crate::state::AppState>();
    let cf_path = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        data.settings.cloudflared_path.clone().unwrap_or_else(|| "AUTO".to_string())
    };

    // 2. Load and Prepare Template
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

    // 3. Write Single Executable Batch File
    let main_bat_path = output_path.join("BMM-Standalone-Server.bat");
    fs::write(&main_bat_path, hybrid_content).map_err(|_| "repo.errWriteScript".to_string())?;

    // 4. Copy Bans if exists
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

    // 6. Auto-start logic
    if auto_start {
        #[cfg(target_os = "windows")]
        {
            use winreg::enums::*;
            use winreg::RegKey;
            println!("[STARTUP] Enabling autostart for standalone server...");
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            match hkcu.open_subkey_with_flags("Software\\Microsoft\\Windows\\CurrentVersion\\Run", KEY_SET_VALUE) {
                Ok(run) => {
                    let mut path_str = if let Ok(abs_path) = fs::canonicalize(&main_bat_path) {
                        abs_path.to_string_lossy().to_string().replace("\\\\?\\", "").replace("/","\\")
                    } else {
                        main_bat_path.to_string_lossy().to_string()
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
}

#[tauri::command]
pub async fn generate_standalone_server(
    handle: tauri::AppHandle,
    payload: StandaloneServerConfig,
) -> Result<(), String> {
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
    generate_mini_server_files(&handle, output_path, port, auto_start, use_cloudflare, use_upnp, &lang, upload_limit, version, &pw)
}

#[tauri::command]
pub async fn fetch_repo_info(url: String, creator_id: Option<String>) -> Result<ServerRepo, String> {
    let mut target_url = url;
    if !target_url.ends_with("repo.json") {
        if target_url.ends_with('/') {
            target_url.push_str("repo.json");
        } else {
            target_url.push_str("/repo.json");
        }
    }

    let mut client_builder = reqwest::Client::builder();
    if let Some(ref cid) = creator_id {
        let mut headers = reqwest::header::HeaderMap::new();
        if let Ok(hv) = reqwest::header::HeaderValue::from_str(cid) {
            headers.insert("X-Creator-ID", hv);
        }
        client_builder = client_builder.default_headers(headers);
    }
    let client = client_builder.build().map_err(|e| e.to_string())?;
    let res = client.get(&target_url).send().await.map_err(|e| e.to_string())?;
    
    if !res.status().is_success() {
        if res.status() == 403 {
            return Err("repo.errForbidden".to_string());
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
    pub game_dir: String,
    pub mods_dir: String,
    pub backup_dir: String,
    pub choices: Vec<SyncChoice>,
    pub overwrite_all: bool,
    pub delete_extra: bool,
    pub download_limit: u32,
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
    
    let repo = fetch_repo_info(url.clone(), args.creator_id.clone()).await?;

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
            server_mod_subfolders.insert(mod_subfolder_name);
            
            let is_new_mod = !target_mod_dir.exists();
            if is_new_mod {
                prof_summary.mods_added += 1;
            } else {
                prof_summary.mods_updated += 1;
            }

            fs::create_dir_all(&target_mod_dir).map_err(|e| e.to_string())?;

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

                    let file_url = format!("{}mods/{}/{}", base_url, repo_mod.id, file.relative_path.replace("\\", "/"));
                    let mut client_builder = reqwest::Client::builder();
                    if let Some(ref cid) = args.creator_id {
                        let mut headers = reqwest::header::HeaderMap::new();
                        if let Ok(hv) = reqwest::header::HeaderValue::from_str(cid) {
                            headers.insert("X-Creator-ID", hv);
                        }
                        client_builder = client_builder.default_headers(headers);
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

        // Add or update this specific profile in AppState
        {
            let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
            
            if let Some(p) = data.profiles.iter_mut().find(|p| p.id == profile_id) {
                p.name = format!("{} - {}", repo.name, repo_profile.name);
                p.game_name = repo_profile.game_name.clone();
                p.origin_repo_profile_id = Some(repo_profile.id.clone());
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
                data.profiles.push(new_profile);
            }
            
            synced_profile_ids.push(profile_id.clone());
            overall_summary.profiles.push(prof_summary);
            
            for repo_mod in successfully_synced_mods {
                let safe_mod_name = repo_mod.name.replace(|c: char| !c.is_alphanumeric() && c != ' ' && c != '-' && c != '_', "_");
                let target_mod_dir = mods_path.join(format!("{}_{}", &repo_mod.id[..8], safe_mod_name));
                
                let mut new_mod = crate::models::mod_entry::ModEntry::new(
                    repo_mod.name.clone(),
                    target_mod_dir
                );
                new_mod.id = repo_mod.id.clone();
                new_mod.version = repo_mod.version.clone();
                new_mod.author = repo_mod.author.clone();
                new_mod.description = repo_mod.description.clone();
                new_mod.download_links = repo_mod.download_links.clone();
                
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
