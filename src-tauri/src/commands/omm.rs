use crate::models::profile::Profile;
use crate::state::AppState;
use std::path::{Path, PathBuf};
use tauri::State;
use regex::Regex;

#[tauri::command]
pub async fn auto_import_omm(state: State<'_, AppState>) -> Result<usize, String> {
    let appdata = std::env::var("APPDATA").map_err(|_| "Impossible de trouver APPDATA".to_string())?;
    let config_path = PathBuf::from(&appdata).join("Open Mod Manager").join("config.xml");
    
    if !config_path.exists() {
        return Err("Configuration Open Mod Manager introuvable.".to_string());
    }

    let content = std::fs::read_to_string(&config_path).map_err(|e| format!("Erreur lecture config: {}", e))?;
    let re_path = Regex::new(r#"(?is)<path>(.*?)</path>"#).unwrap();
    
    let mut imported = 0;
    let paths: Vec<String> = re_path.captures_iter(&content)
        .map(|cap| cap[1].trim().to_string())
        .collect();

    for path in paths {
        if let Ok(count) = import_omm_profile(state.clone(), path).await {
            imported += count;
        }
    }

    if imported > 0 {
        state.save().map_err(|e| e.to_string())?;
    }

    Ok(imported)
}

#[tauri::command]
pub async fn import_omm_profile(state: State<'_, AppState>, path: String) -> Result<usize, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err("Le fichier sélectionné est introuvable.".to_string());
    }

    let raw_bytes = std::fs::read(&p).map_err(|e| format!("Erreur lecture: {}", e))?;
    let content = String::from_utf8_lossy(&raw_bytes).to_string();

    if content.contains("<Open_Mod_Manager_Hub>") {
        let mut imported = 0;
        let hub_dir = p.parent().unwrap_or(&p);

        // Technique 1: Check for explicit <channel file="..."> links
        let re_chan = Regex::new(r#"(?i)<channel[^>]*file="([^"]+)""#).unwrap();
        for cap in re_chan.captures_iter(&content) {
            let rel_path = &cap[1];
            let abs_path = hub_dir.join(rel_path);
            if abs_path.exists() {
                if let Ok(c) = import_single_channel(&state, &abs_path).await {
                    imported += c;
                }
            }
        }

        // Technique 2: Scan subdirectories for ANY .omx/.omc files (like OMM does)
        if let Ok(entries) = std::fs::read_dir(hub_dir) {
            for entry in entries.flatten() {
                if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                    let sub_dir = entry.path();
                    if let Ok(sub_entries) = std::fs::read_dir(&sub_dir) {
                        for sub_entry in sub_entries.flatten() {
                            let fpath = sub_entry.path();
                            if fpath.is_file() {
                                let ext = fpath.extension().and_then(|e| e.to_str()).unwrap_or("");
                                if ext.eq_ignore_ascii_case("omx") || ext.eq_ignore_ascii_case("omc") {
                                    if let Ok(c) = import_single_channel(&state, &fpath).await {
                                        imported += c;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        if imported == 0 {
            return Err("Aucun canal valide n'a pu être importé depuis le Hub ou ses sous-dossiers.".to_string());
        }
        Ok(imported)
    } else {
        import_single_channel(&state, &p).await
    }
}

async fn import_single_channel(state: &State<'_, AppState>, p: &PathBuf) -> Result<usize, String> {
    let raw_bytes = std::fs::read(p).map_err(|e| format!("Erreur lecture: {}", e))?;
    let content = String::from_utf8_lossy(&raw_bytes).to_string();

    // Check magic or root tag to ensure it's a channel
    if !content.contains("<Open_Mod_Manager_Channel>") {
        return Ok(0);
    }

    let re_title = Regex::new(r#"(?is)<title[^>]*>(.*?)</title>"#).unwrap();
    let re_install = Regex::new(r#"(?is)<install[^>]*>(.*?)</install>"#).unwrap();
    let re_backup = Regex::new(r#"(?is)<backup[^>]*>(.*?)</backup>"#).unwrap();
    let re_library = Regex::new(r#"(?is)<library[^>]*>(.*?)</library>"#).unwrap();

    let title = re_title.captures(&content)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string())
        .unwrap_or_else(|| p.file_stem().unwrap_or_default().to_string_lossy().to_string());

    let install_path_str = re_install.captures(&content)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string())
        .ok_or("Balise <install> introuvable")?;

    let library_path_str = re_library.captures(&content)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string());

    let backup_path_str = re_backup.captures(&content)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string());

    let game_path = PathBuf::from(&install_path_str);
    let channel_dir = p.parent().ok_or("Parent directory not found")?;

    // OMM maps <install> to Game Target
    // OMM maps <library> to where the Mods (zip/folders) are
    // OMM maps <backup> to where original files are stored
    
    // In BMM:
    // game_path = Game Target
    // mods_path = Where our mods are (OMM Library)
    // backup_path = Where BMM stores its backups (OMM Backup or subfolder)

    let mods_path = if let Some(l) = library_path_str {
        PathBuf::from(l)
    } else {
        // OMM Default: Library/ subfolder in the channel home
        channel_dir.join("Library")
    };

    let bmm_backup_path = if let Some(b) = backup_path_str {
        PathBuf::from(b)
    } else {
        channel_dir.join("Backup")
    };

    let mut data = state.data.lock().unwrap();

    // Skip if already imported
    if data.profiles.iter().any(|pr| pr.name == title && pr.game_path == game_path) {
        return Ok(0);
    }

    let new_profile = Profile::new(
        title.clone(),
        "Imported (OMM)".to_string(),
        game_path,
        mods_path.clone(),
        bmm_backup_path
    );
    
    let id = new_profile.id.clone();
    data.profiles.push(new_profile);
    if data.active_profile_id.is_none() { data.active_profile_id = Some(id.clone()); }
    drop(data);

    // Scan mods in mods_path ONLY if it exists
    if mods_path.exists() && mods_path.is_dir() {
        if let Ok(mod_entries) = std::fs::read_dir(&mods_path) {
            for mod_entry in mod_entries.flatten() {
                let inner_path = mod_entry.path();
                let is_dir = inner_path.is_dir();
                let is_zip = inner_path.is_file() 
                    && inner_path.extension().and_then(|e| e.to_str()).unwrap_or("").eq_ignore_ascii_case("zip");
                
                // Skip technical folders and the OMM files themselves
                let fname = inner_path.file_name().and_then(|f| f.to_str()).unwrap_or("");
                let ext = inner_path.extension().and_then(|e| e.to_str()).unwrap_or("");
                
                if fname.eq_ignore_ascii_case("Backup") 
                    || fname.eq_ignore_ascii_case("Library")
                    || fname.eq_ignore_ascii_case("BMM_Backup")
                    || ext.eq_ignore_ascii_case("omx")
                    || ext.eq_ignore_ascii_case("omc")
                {
                    continue;
                }

                if is_dir || is_zip {
                    let folder_name = inner_path.file_name().unwrap_or_default().to_string_lossy().to_string();
                    let mut mod_name = folder_name.clone();
                    if is_zip && mod_name.to_lowercase().ends_with(".zip") {
                        mod_name = mod_name[..mod_name.len() - 4].to_string();
                    }

                    let mut data = state.data.lock().unwrap();
                    let is_already_added = data.mods.iter().any(|m| m.mod_folder_path == inner_path || m.mod_folder_path.canonicalize().ok() == inner_path.canonicalize().ok());

                    if !is_already_added {
                        data.mods.push(crate::models::mod_entry::ModEntry::new(mod_name, inner_path));
                    }
                }
            }
        }
    }

    let _ = state.save();
    Ok(1)
}
