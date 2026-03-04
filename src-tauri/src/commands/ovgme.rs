use crate::models::profile::Profile;
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

fn parse_utf16_string(bytes: &[u8], offset: usize, max_len: usize) -> String {
    let mut utf16_chars = Vec::new();
    for i in 0..(max_len / 2) {
        let idx = offset + (i * 2);
        if idx + 1 >= bytes.len() {
            break;
        }
        let val = u16::from_le_bytes([bytes[idx], bytes[idx + 1]]);
        if val == 0 {
            break; // null terminator
        }
        utf16_chars.push(val);
    }
    String::from_utf16_lossy(&utf16_chars)
}

#[tauri::command]
pub async fn import_ovgme_profiles(state: State<'_, AppState>) -> Result<usize, String> {
    // OvGME uses CSIDL_COMMON_APPDATA which corresponds to C:\ProgramData on Windows
    let program_data = std::env::var("PROGRAMDATA").unwrap_or_else(|_| "C:\\ProgramData".to_string());
    let ovgme_path = PathBuf::from(&program_data).join("OvGME");

    if !ovgme_path.exists() || !ovgme_path.is_dir() {
        // Fallback or double-check local AppData just in case
        let appdata = std::env::var("APPDATA").map_err(|_| "Impossible de trouver C:\\ProgramData ou APPDATA")?;
        let fallback_path = PathBuf::from(&appdata).join("OvGME");
        if fallback_path.exists() && fallback_path.is_dir() {
            return parse_ovgme_path(&fallback_path, state).await;
        }
        return Err("Dossier OvGME introuvable dans C:\\ProgramData\\OvGME.".to_string());
    }

    parse_ovgme_path(&ovgme_path, state).await
}

async fn parse_ovgme_path(ovgme_path: &PathBuf, state: State<'_, AppState>) -> Result<usize, String> {
    let entries = std::fs::read_dir(ovgme_path).map_err(|e| format!("Erreur lecture OvGME: {}", e))?;
    let mut imported_count = 0;
    
    // Collect game data first without holding lock
    let mut configs = Vec::new();
    for entry in entries.flatten() {
        if !entry.file_type().map_or(false, |ft| ft.is_dir()) { continue; }
        let game_dat_path = entry.path().join("game.dat");
        if !game_dat_path.exists() || !game_dat_path.is_file() { continue; }

        if let Ok(bytes) = std::fs::read(&game_dat_path) {
            if bytes.len() >= 0x8A4 {
                let title = parse_utf16_string(&bytes, 0x002, 128);
                let root = parse_utf16_string(&bytes, 0x082, 520);
                let mods_dir = parse_utf16_string(&bytes, 0x494, 520);
                let back_dir = parse_utf16_string(&bytes, 0x69C, 520);
                if !title.is_empty() && !root.is_empty() && !mods_dir.is_empty() {
                    configs.push((title, root, mods_dir, back_dir));
                }
            }
        }
    }

    // Now process with minimal locking
    for (title, root, mods_dir, back_dir) in configs {
        let mods_path = PathBuf::from(&mods_dir);
        let game_path = PathBuf::from(&root);
        let backup_path = PathBuf::from(&back_dir);

        let mut data = state.data.lock().unwrap();
        
        // Find if profile already exists (match by same game path or name)
        let profile_id = if let Some(p) = data.profiles.iter().find(|p| p.name == title || p.game_path == game_path) {
            p.id.clone()
        } else {
            let new_profile = Profile::new(
                title.clone(),
                "Imported (OvGME)".to_string(),
                game_path,
                mods_path.clone(),
                backup_path
            );
            let id = new_profile.id.clone();
            data.profiles.push(new_profile);
            imported_count += 1;
            if data.active_profile_id.is_none() {
                data.active_profile_id = Some(id.clone());
            }
            id
        };
        
        // Drop lock to scan mods folder if it exists
        drop(data);

        // Scan mods folder for this profile even if it existed before (to sync new mods)
        if mods_path.exists() && mods_path.is_dir() {
            if let Ok(mod_entries) = std::fs::read_dir(&mods_path) {
                for mod_entry in mod_entries.flatten() {
                    let inner_path = mod_entry.path();
                    let is_dir = inner_path.is_dir();
                    let is_zip = inner_path.is_file() 
                        && inner_path.extension().and_then(|e| e.to_str()).unwrap_or("").eq_ignore_ascii_case("zip");
                    
                    if is_dir || is_zip {
                        let folder_name = inner_path.file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .to_string();

                        let mut mod_name = folder_name.clone();
                        if is_zip && mod_name.to_lowercase().ends_with(".zip") {
                            mod_name = mod_name[..mod_name.len() - 4].to_string();
                        }

                        // Re-lock to add the mod if not already there
                        let mut data = state.data.lock().unwrap();
                        let is_already_added = data.mods.iter().any(|m| {
                             // Compare canonicalized if possible to avoid UNC / \\?\ mismatch
                             let m_p = &m.mod_folder_path;
                             let i_p = &inner_path;
                             if m_p == i_p { return true; }
                             match (m_p.canonicalize(), i_p.canonicalize()) {
                                 (Ok(a), Ok(b)) => a == b,
                                 _ => false
                             }
                        });

                        if !is_already_added {
                            let mut new_mod = crate::models::mod_entry::ModEntry::new(mod_name.clone(), inner_path.clone());
                            new_mod.name = mod_name;
                            data.mods.push(new_mod);
                        }
                    }
                }
            }
        }
    }

    if imported_count > 0 {
        let _ = state.save();
    }
    Ok(imported_count)
}
