use crate::fs_utils;
use crate::models::mod_entry::{ModEntry, ModStatus};
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub fn get_mods(state: State<AppState>) -> Result<Vec<ModEntry>, String> {
    let data = state.data.lock().unwrap();
    let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?;
    let active_profile = data.profiles.iter().find(|p| &p.id == active_id).ok_or("Profil introuvable")?;
    
    let filtered_mods: Vec<ModEntry> = data.mods.iter()
        .filter(|m| m.mod_folder_path.starts_with(&active_profile.mods_path))
        .cloned()
        .collect();
        
    Ok(filtered_mods)
}

#[tauri::command]
pub async fn add_mod(
    state: State<'_, AppState>,
    name: String,
    mod_folder_path: String,
    author: String,
    description: String,
    version: String,
) -> Result<ModEntry, String> {
    let mods_path = {
        let data = state.data.lock().unwrap();
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?.clone();
        let p = data.profiles.iter().find(|p| p.id == active_id).ok_or("Profil introuvable")?.clone();
        p.mods_path.clone()
    };

    let safe_name = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' || c == '.' { c } else { '_' })
        .collect::<String>();
        
    let target_dir = mods_path.join(&safe_name);
    let target_dir_clone = target_dir.clone();
    let src = PathBuf::from(&mod_folder_path);

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        if !src.exists() {
            return Err(format!("Fichier source introuvable: {}", src.display()));
        }

        let is_same_dir = match (src.canonicalize(), target_dir_clone.canonicalize()) {
            (Ok(s), Ok(t)) => s == t,
            _ => false,
        };

        if !is_same_dir {
            std::fs::create_dir_all(&target_dir_clone).map_err(|e| e.to_string())?;

            // Check if it's a zip
        if src.is_file() && src.extension().and_then(|e| e.to_str()).unwrap_or("").eq_ignore_ascii_case("zip") {
            let file = std::fs::File::open(&src).map_err(|e| e.to_string())?;
            let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Erreur Zip: {}", e))?;
            for i in 0..archive.len() {
                let mut f = archive.by_index(i).map_err(|e| e.to_string())?;
                let outpath = target_dir_clone.join(f.name());
                if f.name().ends_with('/') {
                    std::fs::create_dir_all(&outpath).ok();
                } else {
                    if let Some(parent) = outpath.parent() {
                        std::fs::create_dir_all(parent).ok();
                    }
                    let mut outfile = std::fs::File::create(&outpath).map_err(|e| e.to_string())?;
                    std::io::copy(&mut f, &mut outfile).map_err(|e| e.to_string())?;
                }
            }
        } else if src.is_dir() {
            let mut options = fs_extra::dir::CopyOptions::new();
            options.content_only = true;
            options.overwrite = true;
            fs_extra::dir::copy(&src, &target_dir_clone, &options).map_err(|e| e.to_string())?;
        } else {
            return Err("Le fichier sélectionné doit être un dossier ou un fichier .zip".to_string());
        }
        } // end of !is_same_dir block
        Ok(())
    }).await.map_err(|e| e.to_string())??;

    let mut entry = ModEntry::new(safe_name.clone(), target_dir);
    entry.name = name;
    entry.author = author;
    entry.description = description;
    entry.version = version;
    
    let result = entry.clone();
    {
        let mut data = state.data.lock().unwrap();
        data.mods.push(entry);
    }
    let _ = state.save();
    Ok(result)
}

#[tauri::command]
pub fn remove_mod(state: State<AppState>, mod_id: String) -> Result<(), String> {
    {
        let mut data = state.data.lock().unwrap();
        if let Some(m) = data.mods.iter().find(|m| m.id == mod_id) {
            if m.enabled {
                return Err("Désactivez le mod avant de le supprimer.".to_string());
            }
        }
        data.mods.retain(|m| m.id != mod_id);
    }
    let _ = state.save();
    Ok(())
}

#[tauri::command]
pub async fn enable_mod(state: State<'_, AppState>, mod_id: String) -> Result<(), String> {
    let (mod_folder, game_path, backup_path) = {
        let data = state.data.lock().unwrap();
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?.clone();
        if m.enabled { return Ok(()); }
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?.clone();
        let p = data.profiles.iter().find(|p| p.id == active_id).ok_or("Profil introuvable")?.clone();
        (m.mod_folder_path.clone(), p.game_path.clone(), p.backup_path.clone())
    };

    let mod_id_clone = mod_id.clone();
    let applied = tauri::async_runtime::spawn_blocking(move || {
        fs_utils::apply_mod(&mod_folder, &game_path, &backup_path, &mod_id_clone)
    }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;

    {
        let mut data = state.data.lock().unwrap();
        if let Some(m) = data.mods.iter_mut().find(|m| m.id == mod_id) {
            m.enabled = true;
            m.status = ModStatus::Enabled;
            m.installed_files = applied.iter().map(|p| p.to_string_lossy().to_string()).collect();
        }
    }
    let _ = state.save();
    Ok(())
}

#[tauri::command]
pub async fn disable_mod(state: State<'_, AppState>, mod_id: String) -> Result<(), String> {
    let (mod_folder, game_path, backup_path) = {
        let data = state.data.lock().unwrap();
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?.clone();
        if !m.enabled { return Ok(()); }
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?.clone();
        let p = data.profiles.iter().find(|p| p.id == active_id).ok_or("Profil introuvable")?.clone();
        (m.mod_folder_path.clone(), p.game_path.clone(), p.backup_path.clone())
    };

    let mod_id_clone = mod_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        fs_utils::unapply_mod(&mod_folder, &game_path, &backup_path, &mod_id_clone)
    }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;

    {
        let mut data = state.data.lock().unwrap();
        if let Some(m) = data.mods.iter_mut().find(|m| m.id == mod_id) {
            m.enabled = false;
            m.status = ModStatus::Disabled;
            m.installed_files.clear();
        }
    }
    let _ = state.save();
    Ok(())
}

#[tauri::command]
pub fn update_mod_meta(
    state: State<AppState>,
    mod_id: String,
    name: String,
    author: String,
    description: String,
    version: String,
) -> Result<(), String> {
    {
        let mut data = state.data.lock().unwrap();
        if let Some(m) = data.mods.iter_mut().find(|m| m.id == mod_id) {
            m.name = name;
            m.author = author;
            m.description = description;
            m.version = version;
        }
    }
    let _ = state.save();
    Ok(())
}

#[tauri::command]
pub async fn scan_mods_folder(state: State<'_, AppState>) -> Result<Vec<ModEntry>, String> {
    let mods_path = {
        let data = state.data.lock().unwrap();
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?.clone();
        let p = data.profiles.iter().find(|p| p.id == active_id).ok_or("Profil introuvable")?.clone();
        p.mods_path.clone()
    };

    let existing_paths: Vec<PathBuf> = {
        let data = state.data.lock().unwrap();
        data.mods.iter().map(|m| m.mod_folder_path.clone()).collect()
    };

    let added: Vec<ModEntry> = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<ModEntry>, String> {
        if !mods_path.exists() {
            return Err(format!("Dossier mods introuvable: {:?}", mods_path));
        }

        let mut discovered = Vec::new();
        let entries = std::fs::read_dir(&mods_path).map_err(|e| e.to_string())?;

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() { continue; }

            let folder_name = path.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            if existing_paths.contains(&path) {
                continue;
            }

            let mut entry = ModEntry::new(folder_name.clone(), path);
            entry.name = folder_name;
            entry.version = "1.0.0".to_string();
            discovered.push(entry);
        }
        Ok(discovered)
    }).await.map_err(|e| e.to_string())??;

    let result = added.clone();
    if !added.is_empty() {
        let mut data = state.data.lock().unwrap();
        data.mods.extend(added);
        let _ = state.save();
    }
    Ok(result)
}

#[tauri::command]
pub async fn download_mod(
    state: State<'_, AppState>,
    url: String,
    mod_name: String,
) -> Result<ModEntry, String> {
    let mods_path = {
        let data = state.data.lock().unwrap();
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?.clone();
        let p = data.profiles.iter().find(|p| p.id == active_id).ok_or("Profil introuvable")?.clone();
        p.mods_path.clone()
    };

    let safe_name = mod_name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' || c == '.' { c } else { '_' })
        .collect::<String>();
    
    let target_dir = mods_path.join(&safe_name);

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        std::fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;

        let response = reqwest::blocking::get(&url)
            .map_err(|e| format!("Download failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("HTTP error: {}", response.status()));
        }

        let bytes = response.bytes().map_err(|e| format!("Read failed: {}", e))?;
        let is_zip = bytes.len() >= 4 && bytes[0] == 0x50 && bytes[1] == 0x4B;

        if is_zip {
            let cursor = std::io::Cursor::new(&bytes);
            let mut archive = zip::ZipArchive::new(cursor)
                .map_err(|e| format!("Zip error: {}", e))?;

            for i in 0..archive.len() {
                let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
                let outpath = target_dir.join(file.name());
                if file.name().ends_with('/') {
                    std::fs::create_dir_all(&outpath).ok();
                } else {
                    if let Some(parent) = outpath.parent() {
                        std::fs::create_dir_all(parent).ok();
                    }
                    let mut outfile = std::fs::File::create(&outpath).map_err(|e| e.to_string())?;
                    std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
                }
            }
        } else {
            let filename = url.split('/').last().unwrap_or("mod_file");
            let filepath = target_dir.join(filename);
            std::fs::write(&filepath, &bytes).map_err(|e| e.to_string())?;
        }
        Ok(())
    }).await.map_err(|e| e.to_string())??;

    let target_dir_clone = mods_path.join(&safe_name);
    let mut entry = ModEntry::new(safe_name.clone(), target_dir_clone);
    entry.name = mod_name;
    let result = entry.clone();
    {
        let mut data = state.data.lock().unwrap();
        data.mods.push(entry);
    }
    let _ = state.save();
    Ok(result)
}

#[tauri::command]
pub async fn install_from_modlist(
    state: State<'_, AppState>,
    modlist_json: String,
) -> Result<Vec<String>, String> {
    let modlist: crate::models::modlist::ModList =
        serde_json::from_str(&modlist_json).map_err(|e| format!("Invalid modlist: {}", e))?;

    let mods_path = {
        let data = state.data.lock().unwrap();
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?.clone();
        let p = data.profiles.iter().find(|p| p.id == active_id).ok_or("Profil introuvable")?.clone();
        p.mods_path.clone()
    };

    let mut results = Vec::new();

    for entry in modlist.mods {
        let link = entry.download_links.iter().find(|dl| !dl.url.is_empty());
        let safe_name = entry.name
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' || c == '.' { c } else { '_' })
            .collect::<String>();
        let target_dir = mods_path.join(&safe_name);
        
        // Skip if already downloaded
        if target_dir.exists() {
            let mut data = state.data.lock().unwrap();
            let mut exists_in_db = false;
            for m in &data.mods {
                if m.mod_folder_path == target_dir {
                    exists_in_db = true;
                    break;
                }
            }
            if !exists_in_db {
                let mut new_mod = ModEntry::new(safe_name.clone(), target_dir.clone());
                new_mod.name = entry.name.clone();
                new_mod.version = entry.version.clone();
                new_mod.author = entry.author.clone();
                data.mods.push(new_mod);
            }
            results.push(format!("✅ {} — Déjà téléchargé", entry.name));
            continue;
        }

        if let Some(dl) = link {
            let url = dl.url.clone();
            
            // Perform download in blocking thread
            let res = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
                std::fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;

                let response = reqwest::blocking::get(&url)
                    .map_err(|e| format!("Download failed: {}", e))?;

                if !response.status().is_success() {
                    return Err(format!("HTTP {}", response.status()));
                }

                let bytes = response.bytes().map_err(|e| format!("Read failed: {}", e))?;
                let is_zip = bytes.len() >= 4 && bytes[0] == 0x50 && bytes[1] == 0x4B;

                if is_zip {
                    let cursor = std::io::Cursor::new(&bytes);
                    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("Zip: {}", e))?;
                    for i in 0..archive.len() {
                        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
                        let outpath = target_dir.join(file.name());
                        if file.name().ends_with('/') {
                            std::fs::create_dir_all(&outpath).ok();
                        } else {
                            if let Some(parent) = outpath.parent() {
                                std::fs::create_dir_all(parent).ok();
                            }
                            let mut outfile = std::fs::File::create(&outpath).map_err(|e| e.to_string())?;
                            std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
                        }
                    }
                } else {
                    let filename = url.split('/').last().unwrap_or("mod_file");
                    let filepath = target_dir.join(filename);
                    std::fs::write(&filepath, &bytes).map_err(|e| e.to_string())?;
                }
                Ok(())
            }).await.map_err(|e| e.to_string())?;

            match res {
                Ok(_) => {
                    let mut data = state.data.lock().unwrap();
                    let mut new_mod = ModEntry::new(safe_name.clone(), mods_path.join(&safe_name));
                    new_mod.name = entry.name.clone();
                    new_mod.version = entry.version.clone();
                    new_mod.author = entry.author.clone();
                    data.mods.push(new_mod);
                    results.push(format!("✅ {} — Téléchargé et extrait", entry.name));
                },
                Err(e) => {
                    results.push(format!("❌ {} — {}", entry.name, e));
                }
            }
        } else {
            results.push(format!("⚠ {} — Aucun lien de téléchargement", entry.name));
        }
    }

    let _ = state.save();
    Ok(results)
}
