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
        .filter(|m| {
            let mod_p = &m.mod_folder_path;
            let prof_p = &active_profile.mods_path;
            
            // Simple string prefix check
            if mod_p.starts_with(prof_p) { return true; }
            
            // Handle UNC/canonicalization mismatches
            match (mod_p.canonicalize(), prof_p.canonicalize()) {
                (Ok(m_can), Ok(p_can)) => m_can.starts_with(p_can),
                _ => false
            }
        })
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
    tags: Option<Vec<String>>,
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
    if let Some(t) = tags {
        entry.tags = t;
    }
    
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
    let (mod_folder, game_path, backup_path, active_id, mod_name) = {
        let data = state.data.lock().unwrap();
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?.clone();
        if m.enabled { return Ok(()); }
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?.clone();
        let p = data.profiles.iter().find(|p| p.id == active_id).ok_or("Profil introuvable")?.clone();
        (m.mod_folder_path.clone(), p.game_path.clone(), p.backup_path.clone(), active_id, m.name)
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
        // Sync with active profile
        if let Some(active_id) = data.active_profile_id.clone() {
            if let Some(p) = data.profiles.iter_mut().find(|p| p.id == active_id) {
                if !p.active_mods.contains(&mod_id) {
                    p.active_mods.push(mod_id.clone());
                }
            }
        }
    }
    let _ = state.save();
    
    // Log history
    crate::commands::history::log_activity(&state, &active_id, &mod_id, &mod_name, "Enabled");
    Ok(())
}

#[tauri::command]
pub async fn disable_mod(state: State<'_, AppState>, mod_id: String) -> Result<(), String> {
    let (game_path, backup_path, active_id, mod_name, installed_files) = {
        let data = state.data.lock().unwrap();
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?.clone();
        if !m.enabled { return Ok(()); }
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?.clone();
        let p = data.profiles.iter().find(|p| p.id == active_id).ok_or("Profil introuvable")?.clone();
        
        let mut files = m.installed_files.clone();
        // Fallback or safety check: also scan the mod folder itself to ensure we catch everything
        if let Ok(scanned) = fs_utils::list_mod_files(&m.mod_folder_path) {
             for s in scanned {
                 let s_str = s.to_string_lossy().to_string();
                 if !files.contains(&s_str) {
                     files.push(s_str);
                 }
             }
        }
        (p.game_path.clone(), p.backup_path.clone(), active_id, m.name, files)
    };

    let mod_id_clone = mod_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        fs_utils::unapply_mod(&game_path, &backup_path, &mod_id_clone, installed_files)
    }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;

    {
        let mut data = state.data.lock().unwrap();
        if let Some(m) = data.mods.iter_mut().find(|m| m.id == mod_id) {
            m.enabled = false;
            m.status = ModStatus::Disabled;
            m.installed_files.clear();
        }
        // Sync with active profile
        if let Some(active_id) = data.active_profile_id.clone() {
            if let Some(p) = data.profiles.iter_mut().find(|p| p.id == active_id) {
                p.active_mods.retain(|id| id != &mod_id);
            }
        }
    }
    let _ = state.save();
    
    // Log history
    crate::commands::history::log_activity(&state, &active_id, &mod_id, &mod_name, "Disabled");
    Ok(())
}

#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
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
    tags: Vec<String>,
) -> Result<(), String> {
    {
        let mut data = state.data.lock().unwrap();
        if let Some(m) = data.mods.iter_mut().find(|m| m.id == mod_id) {
            m.name = name;
            m.author = author;
            m.description = description;
            m.version = version;
            m.tags = tags;
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
            let is_dir = path.is_dir();
            let is_zip = path.is_file() && path.extension().and_then(|s| s.to_str()).unwrap_or("").eq_ignore_ascii_case("zip");
            
            if !is_dir && !is_zip { continue; }

            // Check if already in BMM list (global check)
            let is_already_added = existing_paths.iter().any(|ep| {
                if ep == &path { return true; }
                match (ep.canonicalize(), path.canonicalize()) {
                    (Ok(a), Ok(b)) => a == b,
                    _ => false
                }
            });

            if is_already_added { continue; }

            let folder_name = path.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            let mut mod_name = folder_name.clone();
            if is_zip && mod_name.to_lowercase().ends_with(".zip") {
                mod_name = mod_name[..mod_name.len() - 4].to_string();
            }

            let mut entry = ModEntry::new(mod_name.clone(), path);
            entry.name = mod_name;
            discovered.push(entry);
        }
        Ok(discovered)
    }).await.map_err(|e| e.to_string())??;

    if !added.is_empty() {
        let mut data = state.data.lock().unwrap();
        data.mods.extend(added.clone());
        drop(data);
        let _ = state.save();
    }
    Ok(added)
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
                let m_p = &m.mod_folder_path;
                let t_p = &target_dir;
                let is_match = if m_p == t_p { true } else {
                    match (m_p.canonicalize(), t_p.canonicalize()) {
                        (Ok(a), Ok(b)) => a == b,
                        _ => false
                    }
                };
                if is_match {
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

#[tauri::command]
pub async fn verify_integrity(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let enabled_mods = {
        let data = state.data.lock().unwrap();
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?.clone();
        let p = data.profiles.iter().find(|p| p.id == active_id).ok_or("Profil introuvable")?.clone();
        
        let mut enabled = Vec::new();
        for m in &data.mods {
            let mod_p = &m.mod_folder_path;
            let prof_p = &p.mods_path;
            
            let is_in_profile = if mod_p.starts_with(prof_p) { true } else {
                match (mod_p.canonicalize(), prof_p.canonicalize()) {
                    (Ok(a), Ok(b)) => a.starts_with(b),
                    _ => false
                }
            };

            if m.enabled && is_in_profile {
                enabled.push((m.name.clone(), m.mod_folder_path.clone(), p.game_path.clone()));
            }
        }
        enabled
    };

    let altered = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<String>, String> {
        let mut altered = Vec::new();
        for (mod_name, mod_folder, game_path) in enabled_mods {
            let mod_dir = PathBuf::from(&mod_folder);
            let game_dir = PathBuf::from(&game_path);
            if let Ok(files) = crate::fs_utils::list_mod_files(&mod_dir) {
                for rel in files {
                    let src = mod_dir.join(&rel);
                    let dst = game_dir.join(&rel);
                    
                    let src_meta = std::fs::metadata(&src).ok();
                    let dst_meta = std::fs::metadata(&dst).ok();
                    
                    match (src_meta, dst_meta) {
                        (Some(s), Some(d)) => {
                            if s.len() != d.len() {
                                altered.push(format!("[{}] {}", mod_name, rel.display()));
                            }
                        },
                        _ => {
                            altered.push(format!("[{}] {} (Manquant/Missing)", mod_name, rel.display()));
                        }
                    }
                }
            }
        }
        Ok(altered)
    }).await.map_err(|e| e.to_string())??;

    Ok(altered)
}
