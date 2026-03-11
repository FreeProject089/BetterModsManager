use crate::fs_utils;
use crate::models::repo::{RepoFile, RepoMod, ServerRepo};
use crate::state::AppState;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{State, Window};
use crate::models::repo::RepoTag;

#[derive(serde::Serialize, Clone)]
pub struct RepoProgress {
    pub step: String,
    pub progress: f32, // 0.0 to 100.0
    pub current_file: String,
}

fn compute_sha256(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0; 65536]; // 64KB buffer
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[tauri::command]
pub async fn export_server_repo(
    window: Window,
    state: State<'_, AppState>,
    profile_ids: Vec<String>,
    output_dir: String,
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

        let repo = ServerRepo::new(
            format!("{} Repo", first_profile.name),
            first_profile.game_name.clone(),
        );

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
                let sha256_hash = compute_sha256(&dst_path)?;

                repo_mod.files.push(RepoFile {
                    relative_path: rel_path.to_string_lossy().to_string().replace("\\", "/"),
                    size,
                    sha256_hash,
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

    let json = serde_json::to_string_pretty(&repo).map_err(|e| e.to_string())?;
    fs::write(output_path.join("repo.json"), json).map_err(|e| e.to_string())?;

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

#[tauri::command]
pub async fn sync_server_repo(
    window: Window,
    state: State<'_, AppState>,
    url: String,
    game_dir: String,
    mods_dir: String,
    backup_dir: String,
) -> Result<(), String> {
    state.install_cancelled.store(false, std::sync::atomic::Ordering::SeqCst);
    let cancel_flag = state.install_cancelled.clone();

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

    let game_path = PathBuf::from(&game_dir);
    let backup_path = PathBuf::from(&backup_dir);
    let base_mods_path = PathBuf::from(&mods_dir);
    fs::create_dir_all(&base_mods_path).map_err(|e| e.to_string())?;

    let total_profiles = repo.profiles.len();
    let mut newly_created_profiles = Vec::new();

    for (p_idx, repo_profile) in repo.profiles.into_iter().enumerate() {
        if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("Synchronisation annulée".to_string());
        }

        let new_profile_id = uuid::Uuid::new_v4().to_string();
        let safe_profile_name = repo_profile.name.replace(|c: char| !c.is_alphanumeric() && c != ' ', "_");
        let mods_path = base_mods_path.join(format!("{}", safe_profile_name));
        fs::create_dir_all(&mods_path).map_err(|e| e.to_string())?;

        let total_mods = repo_profile.mods.len();
        let mut successfully_synced_mods = Vec::new();

        for (idx, repo_mod) in repo_profile.mods.into_iter().enumerate() {
            if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
                return Err("Synchronisation annulée".to_string());
            }

            let target_mod_dir = mods_path.join(&repo_mod.id);
            fs::create_dir_all(&target_mod_dir).map_err(|e| e.to_string())?;

            let total_files = repo_mod.files.len();
            let mut local_valid_files = std::collections::HashSet::new();

            for (f_idx, file) in repo_mod.files.iter().enumerate() {
                if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
                    return Err("Synchronisation annulée".to_string());
                }

                let local_path = target_mod_dir.join(&file.relative_path);
                let mut needs_download = true;

                if local_path.exists() {
                    let local_size = fs::metadata(&local_path).map(|m| m.len()).unwrap_or(0);
                    if local_size == file.size {
                        let _ = window.emit("bmm://repo-sync-progress", RepoProgress {
                            step: format!("[{}] Vérification: {} ({}/{})", repo_profile.name, repo_mod.name, idx + 1, total_mods),
                            progress: ((p_idx as f32 / total_profiles as f32) + ((idx as f32 / total_mods as f32) * (1.0 / total_profiles as f32)) + ((f_idx as f32 / total_files as f32) * (1.0 / (total_mods * total_profiles) as f32))) * 100.0,
                            current_file: file.relative_path.clone(),
                        });
                        
                        if let Ok(local_hash) = compute_sha256(&local_path) {
                            if local_hash == file.sha256_hash {
                                needs_download = false;
                            }
                        }
                    }
                }

                if needs_download {
                    let _ = window.emit("bmm://repo-sync-progress", RepoProgress {
                        step: format!("[{}] Téléchargement: {} ({}/{})", repo_profile.name, repo_mod.name, idx + 1, total_mods),
                        progress: ((p_idx as f32 / total_profiles as f32) + ((idx as f32 / total_mods as f32) * (1.0 / total_profiles as f32)) + ((f_idx as f32 / total_files as f32) * (1.0 / (total_mods * total_profiles) as f32))) * 100.0,
                        current_file: file.relative_path.clone(),
                    });

                    if let Some(parent) = local_path.parent() {
                        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }

                    // Notice mods are still downloaded from flat /mods/mod_id path on server
                    let file_url = format!("{}mods/{}/{}", base_url, repo_mod.id, file.relative_path.replace("\\", "/"));
                    
                    let client = reqwest::Client::new();
                    let res = client.get(&file_url).send().await.map_err(|e| format!("Erreur réseau ({}): {}", file.relative_path, e))?;
                    
                    if !res.status().is_success() {
                        return Err(format!("Erreur HTTP {} pour le fichier: {}", res.status(), file.relative_path));
                    }

                    let bytes = res.bytes().await.map_err(|e| format!("Lecture échouée: {}", e))?;
                    fs::write(&local_path, &bytes).map_err(|e| format!("Ecriture échouée: {}", e))?;

                    let downloaded_hash = compute_sha256(&local_path)?;
                    if downloaded_hash != file.sha256_hash {
                        return Err(format!("Erreur d'intégrité après téléchargement: {}", file.relative_path));
                    }
                }

                local_valid_files.insert(file.relative_path.replace("\\", "/"));
            }

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
        }

        // Add this specific profile to AppState
        {
            let mut data = state.data.lock().unwrap();
            let mut new_profile = crate::models::profile::Profile::new(
                format!("{} - {}", repo.name, repo_profile.name),
                repo_profile.game_name.clone(),
                game_path.clone(),
                mods_path.clone(),
                backup_path.clone(),
            );
            new_profile.id = new_profile_id.clone();
            
            for repo_mod in successfully_synced_mods {
                let mut new_mod = crate::models::mod_entry::ModEntry::new(
                    repo_mod.name.clone(),
                    mods_path.join(&repo_mod.id)
                );
                new_mod.id = repo_mod.id.clone();
                new_mod.version = repo_mod.version.clone();
                new_mod.author = repo_mod.author.clone();
                new_mod.description = repo_mod.description.clone();
                
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
                data.mods.push(new_mod);
                // Mods are installed but NOT active by default
            }
            
            data.profiles.push(new_profile);
            newly_created_profiles.push(new_profile_id.clone());
        }
    }

    // Assign active profile to the first downloaded one
    {
        let mut data = state.data.lock().unwrap();
        if let Some(first_id) = newly_created_profiles.first() {
            data.active_profile_id = Some(first_id.clone());
        }
    }
    
    let _ = state.save();

    let _ = window.emit("bmm://repo-sync-progress", RepoProgress {
        step: "Synchronisation terminée avec succès".to_string(),
        progress: 100.0,
        current_file: String::new(),
    });

    Ok(())
}
