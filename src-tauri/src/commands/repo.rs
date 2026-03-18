use crate::fs_utils;
use crate::models::repo::{RepoChunk, RepoFile, RepoMod, ServerRepo};
use crate::state::AppState;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use tauri::{State, Window};
use crate::models::repo::RepoTag;

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
    author_name: Option<String>,
) -> Result<(), String> {
    let output_path = PathBuf::from(&output_dir);
    if !output_path.exists() {
        fs::create_dir_all(&output_path).map_err(|e| e.to_string())?;
    }

    let repo_mods_dir = output_path.join("mods");
    if !repo_mods_dir.exists() {
        fs::create_dir_all(&repo_mods_dir).map_err(|e| e.to_string())?;
    }

    let (mut repo, profiles_data, all_tags) = {
        let data = state.data.lock().unwrap();
        
        let first_profile = data.profiles.iter().find(|p| profile_ids.contains(&p.id))
            .ok_or("Aucun profil valide sélectionné")?;

        let mut repo = ServerRepo::new(
            format!("{} Repo", first_profile.name),
            first_profile.game_name.clone(),
        );
        
        if let Some(name) = author_name {
            if !name.trim().is_empty() {
                repo.author = name;
            }
        }

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
        let mut repo_profile = crate::models::repo::RepoProfile {
            id: profile.id.clone(),
            name: profile.name.clone(),
            game_name: profile.game_name.clone(),
            mods: Vec::new(),
        };

        let total_mods = exported_mods.len();
        for (idx, mod_entry) in exported_mods.iter().enumerate() {
            let _ = window.emit("bmm://repo-export-progress", RepoProgress {
                step: format!("[{}] Préparation: {} ({}/{})", profile.name, mod_entry.name, idx + 1, total_mods),
                progress: ((p_idx as f32 / total_profiles as f32) + ((idx as f32 / total_mods as f32) * (1.0 / total_profiles as f32))) * 100.0,
                current_file: String::new(),
            });

            let target_mod_dir = repo_mods_dir.join(&mod_entry.id);
            fs::create_dir_all(&target_mod_dir).map_err(|e| e.to_string())?;

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
            
            for (f_idx, rel_path) in files.iter().enumerate() {
                let src_path = mod_entry.mod_folder_path.join(rel_path);
                let dst_path = target_mod_dir.join(rel_path);
                
                if let Some(parent) = dst_path.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }

                // Copy file
                fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;

                // Compute Hash
                let size = fs::metadata(&dst_path).map(|m| m.len()).unwrap_or(0);
                let (sha256_hash, chunks) = compute_file_hash_and_chunks(&dst_path, size > CHUNK_SIZE as u64)?;

                repo_mod.files.push(RepoFile {
                    relative_path: rel_path.to_string_lossy().to_string().replace("\\", "/"),
                    size,
                    sha256_hash,
                    chunks,
                });

                if f_idx % 10 == 0 || f_idx == total_files - 1 {
                    let _ = window.emit("bmm://repo-export-progress", RepoProgress {
                        step: format!("[{}] Export: {} ({}/{})", profile.name, mod_entry.name, idx + 1, total_mods),
                        progress: ((p_idx as f32 / total_profiles as f32) + ((idx as f32 / total_mods as f32) * (1.0 / total_profiles as f32)) + ((f_idx as f32 / total_files as f32) * (1.0 / (total_mods * total_profiles) as f32))) * 100.0,
                        current_file: rel_path.to_string_lossy().to_string(),
                    });
                }
            }
            repo_profile.mods.push(repo_mod);
        }
        repo.profiles.push(repo_profile);
    }

    let _ = window.emit("bmm://repo-export-progress", RepoProgress {
        step: "Finalisation du manifest...".to_string(),
        progress: 99.0,
        current_file: "repo.json".to_string(),
    });

    // Sign the repo (using compact JSON for the signature payload to be stable)
    let json_to_sign = serde_json::to_string(&repo).map_err(|e| e.to_string())?;
    let (author_id, signature) = super::security::sign_message(&handle, json_to_sign.as_bytes())?;
    
    repo.author_id = Some(author_id);
    repo.signature = Some(signature);

    let final_json = serde_json::to_string_pretty(&repo).map_err(|e| e.to_string())?;
    fs::write(output_path.join("repo.json"), final_json).map_err(|e| e.to_string())?;

    let _ = window.emit("bmm://repo-export-progress", RepoProgress {
        step: "Terminé".to_string(),
        progress: 100.0,
        current_file: String::new(),
    });

    Ok(())
}

#[tauri::command]
pub async fn fetch_repo_info(url: String) -> Result<ServerRepo, String> {
    let client = reqwest::Client::new();
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    
    if !res.status().is_success() {
        return Err(format!("HTTP Error: {}", res.status()));
    }

    let repo: ServerRepo = res.json().await.map_err(|e| format!("Invalid repo.json: {}", e))?;
    Ok(repo)
}

#[derive(serde::Deserialize, Clone)]
pub struct SyncChoice {
    pub repo_profile_id: String,
    pub target_local_profile_id: Option<String>, // None = Create New
}

#[derive(serde::Deserialize)]
pub struct SyncArgs {
    pub url: String,
    pub game_dir: String,
    pub mods_dir: String,
    pub backup_dir: String,
    pub choices: Vec<SyncChoice>,
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
        step: "Connexion au dépôt...".to_string(),
        progress: 0.0,
        current_file: url.clone(),
    });
    
    let repo = fetch_repo_info(url.clone()).await?;

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
            .ok_or(format!("Profil source {} non trouvé dans le dépôt", choice.repo_profile_id))?.clone();

        // Check if we already have a profile from this repo
        let existing_profile = if let Some(target_id) = &choice.target_local_profile_id {
            let data = state.data.lock().unwrap();
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
            return Err("Dossier jeu requis pour un nouveau profil".to_string());
        };

        let target_backup_path = if !backup_dir.is_empty() {
            PathBuf::from(&backup_dir)
        } else if let Some(p) = &existing_profile {
            p.backup_path.clone()
        } else {
            return Err("Dossier backup requis pour un nouveau profil".to_string());
        };

        let mods_path = if let Some(p) = &existing_profile {
            p.mods_path.clone()
        } else {
            let base_mods_path = PathBuf::from(&mods_dir);
            if mods_dir.is_empty() {
                return Err("Dossier mods requis pour un nouveau profil".to_string());
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

                if local_path.exists() {
                    let local_size = fs::metadata(&local_path).map(|m| m.len()).unwrap_or(0);
                    if local_size == file.size {
                        let _ = window.emit("bmm://repo-sync-progress", RepoProgress {
                            step: format!("[{}] Vérification: {} ({}/{})", repo_profile.name, repo_mod.name, idx + 1, total_mods),
                            progress: ((c_idx as f32 / total_tasks as f32) + ((idx as f32 / total_mods as f32) * (1.0 / total_tasks as f32)) + ((f_idx as f32 / total_files as f32) * (1.0 / (total_mods as f32 * total_files as f32 * total_tasks as f32)))) * 100.0,
                            current_file: file.relative_path.clone(),
                        });
                        
                        if let Ok((local_hash, _)) = compute_file_hash_and_chunks(&local_path, false) {
                            if local_hash == file.sha256_hash {
                                println!("[Sync] File {} is up to date (hash matches)", file.relative_path);
                                needs_download = false;
                            } else {
                                println!("[Sync] Hash mismatch for {}, checking chunks...", file.relative_path);
                            }
                        }
                    } else {
                        println!("[Sync] File size mismatch for {} (expected {}, got {}), checking chunks...", file.relative_path, file.size, local_size);
                    }
                }

                if needs_download {
                    let _ = window.emit("bmm://repo-sync-progress", RepoProgress {
                        step: format!("[{}] Téléchargement: {} ({}/{})", repo_profile.name, repo_mod.name, idx + 1, total_mods),
                        progress: ((c_idx as f32 / total_tasks as f32) + ((idx as f32 / total_mods as f32) * (1.0 / total_tasks as f32)) + ((f_idx as f32 / total_files as f32) * (1.0 / (total_mods as f32 * total_files as f32 * total_tasks as f32)))) * 100.0,
                        current_file: file.relative_path.clone(),
                    });

                    if let Some(parent) = local_path.parent() {
                        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }

                    let file_url = format!("{}mods/{}/{}", base_url, repo_mod.id, file.relative_path.replace("\\", "/"));
                    let client = reqwest::Client::new();

                    // Differential Sync Logic
                    let mut partial_success = false;
                    if local_path.exists() && file.chunks.is_some() {
                        if let Ok(local_chunks) = compute_local_chunk_hashes(&local_path) {
                            let remote_chunks = file.chunks.as_ref().unwrap();
                            
                            let mut file_to_patch = fs::OpenOptions::new().read(true).write(true).create(true).open(&local_path).map_err(|e| e.to_string())?;
                            
                            let mut current_offset: u64 = 0;

                            for (chunk_idx, r_chunk) in remote_chunks.iter().enumerate() {
                                let matches = local_chunks.get(chunk_idx).map(|lh| lh == &r_chunk.sha256_hash).unwrap_or(false);
                                
                                if !matches {
                                    println!("[Sync] Patching chunk {}/{} for {}", chunk_idx + 1, remote_chunks.len(), file.relative_path);
                                    let _ = window.emit("bmm://repo-sync-progress", RepoProgress {
                                        step: format!("[{}] Récupération part: {} (Bloc {}/{})", repo_profile.name, repo_mod.name, chunk_idx + 1, remote_chunks.len()),
                                        progress: ((c_idx as f32 / total_tasks as f32) + ((idx as f32 / total_mods as f32) * (1.0 / total_tasks as f32)) + ((f_idx as f32 / total_files as f32) * (1.0 / (total_mods as f32 * total_files as f32 * total_tasks as f32))) + ((chunk_idx as f32 / remote_chunks.len() as f32) * (1.0 / (total_mods as f32 * total_files as f32 * total_tasks as f32)))) * 100.0,
                                        current_file: file.relative_path.clone(),
                                    });

                                    let range_header = format!("bytes={}-{}", current_offset, current_offset + r_chunk.size as u64 - 1);
                                    let res = client.get(&file_url).header("Range", range_header).send().await.map_err(|e| format!("Erreur Range ({}): {}", file.relative_path, e))?;
                                    
                                    if res.status() == 206 || res.status() == 200 {
                                        let bytes = res.bytes().await.map_err(|e| format!("Lecture chunk échouée: {}", e))?;
                                        file_to_patch.seek(SeekFrom::Start(current_offset)).map_err(|e| e.to_string())?;
                                        file_to_patch.write_all(&bytes).map_err(|e| e.to_string())?;
                                    } else {
                                        return Err(format!("Le serveur ne supporte pas les Range requests ou erreur HTTP {}", res.status()));
                                    }
                                }
                                current_offset += r_chunk.size as u64;
                            }
                            
                            file_to_patch.set_len(file.size).map_err(|e| e.to_string())?;
                            println!("[Sync] Successfully patched {} using chunks", file.relative_path);
                            partial_success = true;
                        } else {
                            println!("[Sync] No matching chunks found for {}, falling back to full download", file.relative_path);
                        }
                    }

                    if !partial_success {
                        let res = client.get(&file_url).send().await.map_err(|e| format!("Erreur réseau ({}): {}", file.relative_path, e))?;
                        if !res.status().is_success() {
                            return Err(format!("Erreur HTTP {} pour le fichier: {}", res.status(), file.relative_path));
                        }
                        let bytes = res.bytes().await.map_err(|e| format!("Lecture échouée: {}", e))?;
                        fs::write(&local_path, &bytes).map_err(|e| format!("Ecriture échouée: {}", e))?;
                    }
                    prof_summary.files_downloaded += 1;
                    prof_summary.bytes_downloaded += file.size;
                }

                let (downloaded_hash, _) = compute_file_hash_and_chunks(&local_path, false)?;
                if downloaded_hash != file.sha256_hash {
                    return Err(format!("Erreur d'intégrité après téléchargement: {}", file.relative_path));
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

        // Cleanup: remove mods no longer in the server profile
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

        // Add or update this specific profile in AppState
        {
            let mut data = state.data.lock().unwrap();
            
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
        let mut data = state.data.lock().unwrap();
        if let Some(first_id) = synced_profile_ids.first() {
            data.active_profile_id = Some(first_id.clone());
        }
    }
    
    let _ = state.save();

    let _ = window.emit("bmm://repo-sync-progress", RepoProgress {
        step: "Synchronisation terminée avec succès".to_string(),
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
