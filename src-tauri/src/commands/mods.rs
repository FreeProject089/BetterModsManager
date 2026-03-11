use crate::fs_utils;
use crate::models::mod_entry::{ModEntry, ModStatus};
use crate::commands::crash::log_line;
use crate::state::AppState;
use std::path::PathBuf;
use tauri::{State, Window};
use std::sync::Mutex;
use serde::Serialize;

#[derive(Serialize, Clone)]
struct BenchEventPayload {
    text: String,
    disk_name: String,
    total_mb: f64,
    limit_mb_s: Option<u64>,
    finished: bool,
}

lazy_static::lazy_static! {
    static ref MOD_OP_LOCK: Mutex<()> = Mutex::new(());
}

#[tauri::command]
pub fn get_mods(state: State<AppState>) -> Result<Vec<ModEntry>, String> {
    let data = state.data.lock().unwrap();
    let active_id = match data.active_profile_id.as_ref() {
        Some(id) => id,
        None => return Ok(Vec::new()),
    };
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
pub fn get_all_mods(state: State<AppState>) -> Result<Vec<ModEntry>, String> {
    let data = state.data.lock().unwrap();
    Ok(data.mods.clone())
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
    log_line(format!("[MOD] Adding mod '{}' from '{}'", name, mod_folder_path));
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
pub async fn remove_mod(state: State<'_, AppState>, mod_id: String, delete_files: bool) -> Result<(), String> {
    log_line(format!("[MOD] Removing mod '{}' (delete_files: {})", mod_id, delete_files));
    let mod_path = {
        let mut data = state.data.lock().unwrap();
        let idx = data.mods.iter().position(|m| m.id == mod_id).ok_or("Mod introuvable")?;
        let m = &data.mods[idx];
        if m.enabled {
            return Err("Désactivez le mod avant de le supprimer.".to_string());
        }
        let p = m.mod_folder_path.clone();
        data.mods.remove(idx);
        p
    };

    if delete_files {
        tauri::async_runtime::spawn_blocking(move || {
            if mod_path.exists() && mod_path.is_dir() {
                std::fs::remove_dir_all(mod_path).map_err(|e| e.to_string())?;
            }
            Ok::<(), String>(())
        }).await.map_err(|e| e.to_string())??;
    }

    let _ = state.save();
    Ok(())
}

#[tauri::command]
pub async fn enable_mod(window: Window, state: State<'_, AppState>, mod_id: String) -> Result<Option<String>, String> {
    log_line(format!("[MOD] Enabling mod '{}'", mod_id));
    let (mod_folder, game_path, backup_path, active_id, mod_name, other_active_mods, warning_pct, critical_pct, alert_enabled) = {
        let data = state.data.lock().unwrap();
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?.clone();
        if m.enabled { return Ok(None); }
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?.clone();
        let p = data.profiles.iter().find(|p| p.id == active_id).ok_or("Profil introuvable")?.clone();
        
        let mut others = Vec::new();
        for mid in &p.active_mods {
            if let Some(other_m) = data.mods.iter().find(|om| &om.id == mid) {
                others.push((other_m.id.clone(), other_m.mod_folder_path.clone()));
            }
        }
        
        let warning_pct = data.settings.storage_warning_space_pct;
        let critical_pct = data.settings.storage_critical_space_pct;
        let alert_enabled = data.settings.storage_alert_enabled;

        (m.mod_folder_path.clone(), p.game_path.clone(), p.backup_path.clone(), active_id, m.name, others, warning_pct, critical_pct, alert_enabled)
    };

    let game_path_limit = crate::commands::disk::get_limit_for_path(&state, &game_path);
    let backup_path_limit = crate::commands::disk::get_limit_for_path(&state, &backup_path);

    let mut total_bytes = 0;
    if let Ok(files) = crate::fs_utils::list_mod_files(&mod_folder) {
        for rel in files {
            if let Ok(meta) = std::fs::metadata(mod_folder.join(rel)) {
                total_bytes += meta.len();
            }
        }
    }

    // ── Disk space check ──
    let safety_margin: u64 = 500 * 1024 * 1024; // 500 MB minimal safety
    let mut warning_msg: Option<String> = None;

    let mut check_space = |path: &std::path::Path, label: &str| -> Result<(), String> {
        let disks = sysinfo::Disks::new_with_refreshed_list();
        let mut path_str = path.canonicalize().unwrap_or(path.to_path_buf())
            .to_string_lossy().to_lowercase();
        if path_str.starts_with(r"\\?\") { path_str = path_str[4..].to_string(); }

        let mut best: Option<(u64, u64, String)> = None;
        for disk in disks.iter() {
            let mut mp = disk.mount_point().to_string_lossy().to_lowercase();
            if mp.starts_with(r"\\?\") { mp = mp[4..].to_string(); }
            if path_str.starts_with(&mp) {
                let len = mp.len();
                if best.as_ref().map_or(true, |(_, _, prev_mp)| len > prev_mp.len()) {
                    best = Some((disk.available_space(), disk.total_space(), mp));
                }
            }
        }

        if let Some((available, total, _)) = best {
            // First check the absolute hard limit
            if available < total_bytes + safety_margin {
                return Err(format!(
                    "Espace insuffisant sur le disque {} ! {} MB nécessaires.",
                    label, (total_bytes + safety_margin) / (1024 * 1024)
                ));
            }

            // Then check the % thresholds (only if alerts are enabled)
            if alert_enabled && total > 0 {
                // Simulate space after mod activation
                let simulated_available = available.saturating_sub(total_bytes);
                let free_pct = (simulated_available as f64 / total as f64 * 100.0) as u32;

                if free_pct <= critical_pct {
                    return Err(format!(
                        "CRITICAL_SPACE|{}|{}|{}",
                        label, free_pct, critical_pct
                    ));
                } else if free_pct <= warning_pct {
                    warning_msg = Some(format!(
                        "WARNING_SPACE|{}|{}|{}",
                        label, free_pct, warning_pct
                    ));
                }
            }
        }
        Ok(())
    };

    check_space(&game_path, "Game")?;
    check_space(&backup_path, "Backup")?;

    let total_mb = total_bytes as f64 / 1_048_576.0;
    let disk_name = game_path.to_string_lossy().chars().take(3).collect::<String>().to_uppercase();

    let _ = window.emit("benchmark-event", BenchEventPayload {
        text: format!("Activating mod: {}", mod_name),
        disk_name,
        total_mb,
        limit_mb_s: game_path_limit,
        finished: false,
    });
    
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _lock = MOD_OP_LOCK.lock().unwrap();
        fs_utils::apply_mod_stacked(&mod_folder, &game_path, &backup_path, &other_active_mods, game_path_limit, backup_path_limit)
    }).await.map_err(|e| e.to_string())?;

    let _ = window.emit("benchmark-event", BenchEventPayload {
        text: match &result {
            Ok(_) => format!("Mod activated: {}", mod_name),
            Err(_) => format!("Error activating: {}", mod_name),
        },
        disk_name: "".to_string(),
        total_mb: 0.0,
        limit_mb_s: None,
        finished: true,
    });

    let applied = result.map_err(|e| e.to_string())?;

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
    log_line(format!("[MOD] Mod '{}' enabled successfully ({} files installed)", mod_name, applied.len()));
    crate::commands::history::log_activity(&state, &active_id, &mod_id, &mod_name, "Enabled");
    Ok(warning_msg)
}

#[tauri::command]
pub async fn disable_mod(window: Window, state: State<'_, AppState>, mod_id: String) -> Result<(), String> {
    log_line(format!("[MOD] Disabling mod '{}'", mod_id));
    let (game_path, backup_path, active_id, mod_name, files_to_remove, other_active_mods) = {
        let data = state.data.lock().unwrap();
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?.clone();
        if !m.enabled { return Ok(()); }
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?.clone();
        let p = data.profiles.iter().find(|p| p.id == active_id).ok_or("Profil introuvable")?.clone();
        
        let mut others = Vec::new();
        for mid in p.active_mods.iter().rev() {
            if mid == &mod_id { continue; }
            if let Some(other_m) = data.mods.iter().find(|om| &om.id == mid) {
                others.push((other_m.id.clone(), other_m.mod_folder_path.clone()));
            }
        }
        
        // Hybrid cleanup: Tracked files + Current physical files
        let mut unique_files = std::collections::HashSet::new();
        for f in m.installed_files { unique_files.insert(f); }
        if let Ok(scanned) = fs_utils::list_mod_files(&m.mod_folder_path) {
            for s in scanned { unique_files.insert(s.to_string_lossy().to_string()); }
        }
        
        (p.game_path.clone(), p.backup_path.clone(), active_id, m.name, unique_files.into_iter().collect::<Vec<String>>(), others)
    };

    let game_path_limit = crate::commands::disk::get_limit_for_path(&state, &game_path);

    let mut total_bytes = 0;
    for p in &files_to_remove {
        if let Ok(meta) = std::fs::metadata(game_path.join(p)) {
            total_bytes += meta.len();
        }
    }
    let total_mb = total_bytes as f64 / 1_048_576.0;
    let disk_name = game_path.to_string_lossy().chars().take(3).collect::<String>().to_uppercase();

    let _ = window.emit("benchmark-event", BenchEventPayload {
        text: format!("Disabling mod: {}", mod_name),
        disk_name,
        total_mb,
        limit_mb_s: game_path_limit,
        finished: false,
    });
    
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _lock = MOD_OP_LOCK.lock().unwrap();
        fs_utils::unapply_mod_stacked(&game_path, &backup_path, files_to_remove, &other_active_mods, game_path_limit)
    }).await.map_err(|e| e.to_string())?;

    let _ = window.emit("benchmark-event", BenchEventPayload {
        text: match &result {
            Ok(_) => format!("Mod disabled: {}", mod_name),
            Err(_) => format!("Error disabling: {}", mod_name),
        },
        disk_name: "".to_string(),
        total_mb: 0.0,
        limit_mb_s: None,
        finished: true,
    });

    result.map_err(|e| e.to_string())?;

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
    log_line(format!("[MOD] Mod '{}' disabled successfully", mod_name));
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
pub fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("cmd")
            .args(["/c", "start", "", &path])
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
pub async fn open_mod_folder_at(state: State<'_, AppState>, mod_id: String, relative_path: String) -> Result<(), String> {
    let mod_dir = {
        let data = state.data.lock().unwrap();
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?;
        m.mod_folder_path.clone()
    };
    
    let target = mod_dir.join(relative_path);
    if !target.exists() {
        return Err("Le chemin n'existe pas ou plus.".to_string());
    }
    
    if target.is_dir() {
        open_folder(target.to_string_lossy().to_string())
    } else {
        // If it's a file, "open location" should open the PARENT folder
        if let Some(parent) = target.parent() {
            open_folder(parent.to_string_lossy().to_string())
        } else {
            open_folder(mod_dir.to_string_lossy().to_string())
        }
    }
}

#[tauri::command]
pub async fn open_mod_file_at(state: State<'_, AppState>, mod_id: String, relative_path: String) -> Result<(), String> {
    let mod_dir = {
        let data = state.data.lock().unwrap();
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?;
        m.mod_folder_path.clone()
    };
    
    let target = mod_dir.join(relative_path);
    if !target.exists() || target.is_dir() {
        return Err("Le fichier n'existe pas ou est un dossier.".to_string());
    }
    
    open_file(target.to_string_lossy().to_string())
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
    log_line(format!("[MOD] Updating metadata for '{}' ({})", name, mod_id));
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
    log_line("[MOD] Scanning mods folder for new mods...");
    let (mods_path, profile_id) = {
        let data = state.data.lock().unwrap();
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?.clone();
        let p = data.profiles.iter().find(|p| p.id == active_id).ok_or("Profil introuvable")?.clone();
        (p.mods_path.clone(), active_id)
    };

    // 1. Prune missing mods from the state for this profile
    {
        let mut data = state.data.lock().unwrap();
        let mut to_remove_ids = Vec::new();
        
        data.mods.retain(|m| {
            let mod_p = &m.mod_folder_path;
            
            // Check if this mod belongs to the current profile's mods folder
            let belongs_to_profile = if mod_p.starts_with(&mods_path) { true } else {
                match (mod_p.canonicalize(), mods_path.canonicalize()) {
                    (Ok(a), Ok(b)) => a.starts_with(b),
                    _ => false
                }
            };
            
            if belongs_to_profile && !mod_p.exists() {
                to_remove_ids.push(m.id.clone());
                false // Remove from global mods list
            } else {
                true
            }
        });

        // Also remove from the profile's active_mods list
        if !to_remove_ids.is_empty() {
            if let Some(p) = data.profiles.iter_mut().find(|p| p.id == profile_id) {
                p.active_mods.retain(|id| !to_remove_ids.contains(id));
            }
        }
    }

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
        log_line(format!("[MOD] Scan discovered {} new mod(s)", added.len()));
        let mut data = state.data.lock().unwrap();
        data.mods.extend(added.clone());
        drop(data);
        let _ = state.save();
    } else {
        log_line("[MOD] Scan complete, no new mods found");
    }
    Ok(added)
}

#[tauri::command]
pub async fn download_mod(
    state: State<'_, AppState>,
    url: String,
    mod_name: String,
) -> Result<ModEntry, String> {
    log_line(format!("[MOD] Downloading mod '{}' from '{}'", mod_name, url));
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

#[derive(serde::Serialize, Clone)]
struct DownloadProgress {
    mod_index: usize,
    total_mods: usize,
    mod_name: String,
    progress: f32, // 0.0 to 100.0
    status: String,
}

#[tauri::command]
pub fn cancel_install_from_modlist(state: State<AppState>) {
    state.install_cancelled.store(true, std::sync::atomic::Ordering::SeqCst);
}

#[tauri::command]
pub async fn install_from_modlist(
    window: tauri::Window,
    state: State<'_, AppState>,
    modlist_json: String,
    create_profile: bool,
    github_token: Option<String>,
) -> Result<Vec<String>, String> {
    state.install_cancelled.store(false, std::sync::atomic::Ordering::SeqCst);
    let modlist: crate::models::modlist::ModList =
        serde_json::from_str(&modlist_json).map_err(|e| format!("Invalid modlist: {}", e))?;

    let mut newly_created_profile_id: Option<String> = None;
    let mut newly_added_mod_ids: Vec<String> = Vec::new();
    let mut newly_added_mod_folders: Vec<PathBuf> = Vec::new();

    let mods_path = {
        let mut data = state.data.lock().unwrap();
        if create_profile {
            let new_id = uuid::Uuid::new_v4().to_string();
            let game_path = PathBuf::from(&modlist.game_path_hint);
            let m_path = game_path.join("BetterMods");
            let backup_path = game_path.join("BetterModsBackup");
            
            let mut new_p = crate::models::profile::Profile::new(
                modlist.name.clone(),
                modlist.game_name.clone(),
                game_path,
                m_path.clone(),
                backup_path
            );
            new_p.id = new_id.clone();
            data.profiles.push(new_p);
            data.active_profile_id = Some(new_id.clone());
            newly_created_profile_id = Some(new_id);
            m_path
        } else {
            let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?.clone();
            let p = data.profiles.iter().find(|p| p.id == active_id).ok_or("Profil introuvable")?.clone();
            p.mods_path.clone()
        }
    };

    let mut results = Vec::new();
    let total_mods = modlist.mods.len();

    for (idx, entry) in modlist.mods.iter().enumerate() {
        if state.install_cancelled.load(std::sync::atomic::Ordering::SeqCst) {
            results.push("❌ Installation annulée par l'utilisateur".to_string());
            break;
        }
        
        // Progress: Starting
        let _ = window.emit("bmm://mod-download-progress", crate::commands::mods::DownloadProgress {
            mod_index: idx,
            total_mods,
            mod_name: entry.name.clone(),
            progress: 0.0,
            status: "Démarrage...".to_string(),
        });

        let safe_name = entry.name
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' || c == '.' { c } else { '_' })
            .collect::<String>();
        let target_dir = mods_path.join(&safe_name);

        // Check if already present
        if target_dir.exists() {
            let mut data = state.data.lock().unwrap();
            let exists = data.mods.iter().any(|m| m.mod_folder_path == target_dir);
            if !exists {
                let mut new_mod = ModEntry::new(safe_name.clone(), target_dir.clone());
                new_mod.name = entry.name.clone();
                new_mod.version = entry.version.clone();
                new_mod.author = entry.author.clone();
                new_mod.tags = entry.tags.clone();
                data.mods.push(new_mod);
            }
            results.push(format!("✅ {} — Déjà présent", entry.name));
            continue;
        }

        // --- NEW: Track this folder for cleanup immediately as we're about to create it ---
        newly_added_mod_folders.push(target_dir.clone());

        // Try local copy first
        let source_path = {
            let data = state.data.lock().unwrap();
            data.mods.iter()
                .find(|m| m.name == entry.name && m.mod_folder_path.exists())
                .map(|m| m.mod_folder_path.clone())
        };

        let mut success = false;
        if let Some(src) = source_path {
            let t_dir = target_dir.clone();
            let w = window.clone();
            let n = entry.name.clone();
            let res = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
                let _ = w.emit("bmm://mod-download-progress", crate::commands::mods::DownloadProgress {
                    mod_index: idx,
                    total_mods,
                    mod_name: n,
                    progress: 50.0,
                    status: "Copie locale...".to_string(),
                });
                std::fs::create_dir_all(&t_dir).map_err(|e| e.to_string())?;
                let mut options = fs_extra::dir::CopyOptions::new();
                options.content_only = true;
                fs_extra::dir::copy(&src, &t_dir, &options).map_err(|e| e.to_string())?;
                Ok(())
            }).await.map_err(|e| e.to_string())?;

            if res.is_ok() {
                let mut data = state.data.lock().unwrap();
                let mut new_mod = ModEntry::new(safe_name.clone(), target_dir.clone());
                new_mod.name = entry.name.clone();
                new_mod.version = entry.version.clone();
                new_mod.author = entry.author.clone();
                new_mod.tags = entry.tags.clone();
                let mid = new_mod.id.clone();
                data.mods.push(new_mod);
                
                newly_added_mod_ids.push(mid);
                results.push(format!("✅ {} — Copié localement", entry.name));
                success = true;
            }
        }

        // If not copied, try download
        if !success {
            if let Some(dl) = entry.download_links.iter().find(|l| !l.url.is_empty()) {
                let url = dl.url.clone();
                let t_dir = target_dir.clone();
                let w = window.clone();
                let n = entry.name.clone();
                let cancel_flag = state.install_cancelled.clone();
                let pat_clone = github_token.clone();

                let res = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
                    let github_token = pat_clone;
                    // Build a client with optional GitHub auth header
                    let client = reqwest::blocking::Client::new();
                    let is_github = url.contains("github.com") || url.contains("raw.githubusercontent.com");
                    let mut req = client.get(&url);
                    if is_github {
                        if let Some(ref tok) = github_token {
                            if !tok.is_empty() {
                                req = req.header("Authorization", format!("Bearer {}", tok));
                            }
                        }
                        req = req.header("X-GitHub-Api-Version", "2022-11-28");
                    }
                    let mut response = req.send().map_err(|e| e.to_string())?;
                    let total = response.content_length().unwrap_or(0);
                    let mut bytes = Vec::new();
                    let mut buffer = [0; 8192];
                    let mut downloaded: u64 = 0;
                    
                    std::fs::create_dir_all(&t_dir).map_err(|e| e.to_string())?;
                    
                    use std::io::Read;
                    while let Ok(c) = response.read(&mut buffer) {
                        if c == 0 { break; }
                        // Check for cancellation during download
                        if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
                            return Err("Cancelled".to_string());
                        }

                        bytes.extend_from_slice(&buffer[..c]);
                        downloaded += c as u64;
                        if total > 0 {
                            let p = (downloaded as f32 / total as f32) * 80.0;
                            let _ = w.emit("bmm://mod-download-progress", crate::commands::mods::DownloadProgress {
                                mod_index: idx,
                                total_mods,
                                mod_name: n.clone(),
                                progress: p,
                                status: format!("Téléchargement... {:.0}%", (downloaded as f32 / total as f32) * 100.0),
                            });
                        }
                    }

                    if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
                        return Err("Cancelled".to_string());
                    }

                    let _ = w.emit("bmm://mod-download-progress", crate::commands::mods::DownloadProgress {
                        mod_index: idx,
                        total_mods,
                        mod_name: n,
                        progress: 90.0,
                        status: "Extraction...".to_string(),
                    });

                    let is_zip = bytes.len() > 4 && &bytes[0..2] == b"PK";
                    if is_zip {
                        let cursor = std::io::Cursor::new(bytes);
                        let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;
                        for i in 0..archive.len() {
                            if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
                                return Err("Cancelled".to_string());
                            }
                            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
                            let outpath = t_dir.join(file.name());
                            if file.name().ends_with('/') {
                                std::fs::create_dir_all(&outpath).ok();
                            } else {
                                if let Some(p) = outpath.parent() { std::fs::create_dir_all(p).ok(); }
                                let mut outfile = std::fs::File::create(&outpath).map_err(|e| e.to_string())?;
                                std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
                            }
                        }
                    } else {
                        let fname = url.split('/').last().unwrap_or("mod.file");
                        std::fs::write(t_dir.join(fname), bytes).map_err(|e| e.to_string())?;
                    }
                    Ok(())
                }).await.map_err(|e| e.to_string())?;

                if let Ok(_) = res {
                    let mut data = state.data.lock().unwrap();
                    let mut new_mod = ModEntry::new(safe_name.clone(), target_dir.clone());
                    new_mod.name = entry.name.clone();
                    new_mod.version = entry.version.clone();
                    new_mod.author = entry.author.clone();
                    new_mod.tags = entry.tags.clone();
                    let mid = new_mod.id.clone();
                    data.mods.push(new_mod);
                    
                    newly_added_mod_ids.push(mid);
                    results.push(format!("✅ {} — Téléchargé", entry.name));
                    
                    let _ = window.emit("bmm://mod-download-progress", crate::commands::mods::DownloadProgress {
                        mod_index: idx,
                        total_mods,
                        mod_name: entry.name.clone(),
                        progress: 100.0,
                        status: "Terminé".to_string(),
                    });
                } else if let Err(e) = res {
                    if e == "Cancelled" {
                        // Folder will be cleaned up by the main loop break
                    } else {
                        results.push(format!("❌ {} — {}", entry.name, e));
                    }
                }
            } else {
                results.push(format!("⚠ {} — Aucun lien de téléchargement", entry.name));
            }
        }
    }

    // --- CLEANUP IF CANCELLED ---
    if state.install_cancelled.load(std::sync::atomic::Ordering::SeqCst) {
        let mut data = state.data.lock().unwrap();
        data.mods.retain(|m| !newly_added_mod_ids.contains(&m.id));
        if let Some(pid) = newly_created_profile_id {
            if let Some(idx) = data.profiles.iter().position(|p| p.id == pid) {
                data.profiles.remove(idx);
                if data.active_profile_id == Some(pid) {
                    data.active_profile_id = None;
                }
            }
        }
        drop(data);
        let _ = state.save();
        
        for folder in newly_added_mod_folders {
            if folder.exists() {
                let _ = std::fs::remove_dir_all(folder);
            }
        }
        return Err("Installation annulée.".to_string());
    }

    let _ = state.save();
    Ok(results)
}

#[tauri::command]
pub async fn verify_integrity(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    log_line("[INTEGRITY] Running integrity check on active mods...");
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

    log_line(format!("[INTEGRITY] Check complete: {} issue(s) found", altered.len()));
    Ok(altered)
}
#[tauri::command]
pub async fn toggle_all_mods(window: Window, state: State<'_, AppState>, enable: bool) -> Result<(), String> {
    log_line(format!("[MOD] Toggle all mods: {}", if enable { "ENABLE" } else { "DISABLE" }));
    let mod_ids = {
        let data = state.data.lock().unwrap();
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?;
        let active_profile = data.profiles.iter().find(|p| &p.id == active_id).ok_or("Profil introuvable")?;
        
        data.mods.iter()
            .filter(|m| {
                let mod_p = &m.mod_folder_path;
                let prof_p = &active_profile.mods_path;
                if mod_p.starts_with(prof_p) { return true; }
                match (mod_p.canonicalize(), prof_p.canonicalize()) {
                    (Ok(m_can), Ok(p_can)) => m_can.starts_with(p_can),
                    _ => false
                }
            })
            .map(|m| m.id.clone())
            .collect::<Vec<String>>()
    };

    for id in mod_ids {
        if enable {
            let _ = enable_mod(window.clone(), state.clone(), id).await;
        } else {
            let _ = disable_mod(window.clone(), state.clone(), id).await;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn check_conflicts(state: State<'_, AppState>, mod_id: String) -> Result<Vec<String>, String> {
    let (mod_folder, active_mods_data) = {
        let data = state.data.lock().unwrap();
        let target_mod = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?;
        
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?;
        let p = data.profiles.iter().find(|p| &p.id == active_id).ok_or("Profil introuvable")?;
        
        let mut others = Vec::new();
        for mid in &p.active_mods {
            if mid == &mod_id { continue; }
            if let Some(m) = data.mods.iter().find(|m| &m.id == mid) {
                others.push(m.clone());
            }
        }
        (target_mod.mod_folder_path.clone(), others)
    };

    let target_files = fs_utils::list_mod_files(&mod_folder).map_err(|e| e.to_string())?;
    let mut conflicts = std::collections::HashSet::new();

    for other in active_mods_data {
        let other_files = fs_utils::list_mod_files(&other.mod_folder_path).map_err(|e| e.to_string())?;
        for f in &target_files {
            if other_files.contains(f) {
                conflicts.insert(other.name.clone());
            }
        }
    }

    Ok(conflicts.into_iter().collect())
}

#[tauri::command]
pub async fn list_mod_files_recursive(state: State<'_, AppState>, mod_id: String) -> Result<Vec<String>, String> {
    let mod_folder = {
        let data = state.data.lock().unwrap();
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?;
        m.mod_folder_path.clone()
    };
    
    let files = fs_utils::list_mod_files(&mod_folder).map_err(|e| e.to_string())?;
    Ok(files.into_iter().map(|p| p.to_string_lossy().to_string()).collect())
}
