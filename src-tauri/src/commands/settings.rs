use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn export_app_data(state: State<AppState>, dest_path: String) -> Result<(), String> {
    let _ = state.save(); // Save current memory to disk first
    std::fs::copy(&state.data_path, dest_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn import_app_data(state: State<AppState>, src_path: String) -> Result<(), String> {
    std::fs::copy(src_path, &state.data_path).map_err(|e| e.to_string())?;
    // Reload state into memory
    let new_state = AppState::load(state.data_path.clone());
    let mut data = state.data.lock().unwrap();
    let new_data = new_state.data.lock().unwrap();
    *data = crate::state::AppData {
        profiles: new_data.profiles.clone(),
        mods: new_data.mods.clone(),
        active_profile_id: new_data.active_profile_id.clone(),
        custom_tags: new_data.custom_tags.clone(),
        disk_limits: new_data.disk_limits.clone(),
        settings: new_data.settings.clone(),
    };
    Ok(())
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> crate::state::AppSettings {
    let data = state.data.lock().unwrap();
    data.settings.clone()
}

#[tauri::command]
pub fn update_settings(state: State<AppState>, settings: crate::state::AppSettings) -> Result<(), String> {
    {
        let mut data = state.data.lock().unwrap();
        data.settings = settings;
    }
    state.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn reset_app_data(state: State<AppState>) -> Result<(), String> {
    {
        let mut data = state.data.lock().unwrap();
        *data = crate::state::AppData::default();
    }
    let _ = state.save();
    Ok(())
}

#[tauri::command]
pub fn is_debug_mode(app_handle: tauri::AppHandle) -> bool {
    let cfg_path = app_handle
        .path_resolver()
        .resolve_resource("../app.cfg")
        .or_else(|| {
            // Fallback pour le mode dev direct si resolve_resource échoue
            Some(std::path::PathBuf::from("app.cfg"))
        });

    if let Some(path) = cfg_path {
        println!("[DEBUG_SYSTEM] Final path resolved: {:?}", path);
        if let Ok(content) = std::fs::read_to_string(&path) {
            let normalized = content.to_lowercase();
            let is_debug = normalized.contains("prod=false");
            println!("[DEBUG_SYSTEM] Content read: '{}', is_debug: {}", normalized.trim(), is_debug);
            return is_debug;
        }
    }
    
    println!("[DEBUG_SYSTEM] app.cfg could not be resolved or read.");
    false
}
#[tauri::command]
pub fn get_license_text(app_handle: tauri::AppHandle) -> Result<String, String> {
    let mut path = app_handle
        .path_resolver()
        .resource_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    // If we're inside src-tauri (dev mode), go up to find LICENSE.md
    if path.ends_with("src-tauri") {
        path.pop();
    }
    
    let license_path = path.join("LICENSE.md");
    
    if !license_path.exists() {
        // Try manifest dir parent as last resort for dev
        let dev_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("LICENSE.md");
        if dev_path.exists() {
            return std::fs::read_to_string(dev_path).map_err(|e| e.to_string());
        }
        return Err("LICENSE.md not found".to_string());
    }

    std::fs::read_to_string(license_path).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn get_app_version(app_handle: tauri::AppHandle) -> String {
    app_handle.package_info().version.to_string()
}

#[tauri::command]
pub fn get_build_date() -> String {
    env!("BMM_BUILD_DATE").to_string()
}

#[tauri::command]
pub fn is_ptb_mode(app_handle: tauri::AppHandle) -> bool {
    let cfg_path = app_handle
        .path_resolver()
        .resolve_resource("../app.cfg")
        .or_else(|| {
            Some(std::path::PathBuf::from("app.cfg"))
        });

    if let Some(path) = cfg_path {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let normalized = content.to_lowercase();
            return normalized.contains("ptb=true");
        }
    }
    false
}

#[tauri::command]
pub fn is_update_disabled(app_handle: tauri::AppHandle) -> bool {
    let cfg_path = app_handle
        .path_resolver()
        .resolve_resource("../app.cfg")
        .or_else(|| {
            Some(std::path::PathBuf::from("app.cfg"))
        });

    if let Some(path) = cfg_path {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let normalized = content.to_lowercase();
            return normalized.contains("disableupdate=true");
        }
    }
    false
}

#[tauri::command]
pub fn get_ptb_notes(app_handle: tauri::AppHandle) -> Result<String, String> {
    get_update_note_content(app_handle, "v0.9.7_PTB.md".to_string())
}

#[tauri::command]
pub fn get_update_notes_list(app_handle: tauri::AppHandle) -> Result<Vec<String>, String> {
    let mut notes = Vec::new();
    let base = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    let update_dir = base.join("Update");
    let old_update_dir = update_dir.join("Old_Update");

    for dir in &[update_dir, old_update_dir] {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("md") {
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        notes.push(name.to_string());
                    }
                }
            }
        }
    }
    Ok(notes)
}

#[tauri::command]
pub fn get_update_note_content(app_handle: tauri::AppHandle, filename: String) -> Result<String, String> {
    let base = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    let update_dir = base.join("Update");
    let old_update_dir = update_dir.join("Old_Update");

    let paths = vec![
        update_dir.join(&filename),
        old_update_dir.join(&filename),
    ];

    for path in paths {
        if path.exists() {
            return std::fs::read_to_string(path).map_err(|e| e.to_string());
        }
    }

    // fallback for prod if needed? (resource_dir)
    let res_dir = app_handle.path_resolver().resource_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let final_res = res_dir.join("Update").join(&filename);
    if final_res.exists() {
         return std::fs::read_to_string(final_res).map_err(|e| e.to_string());
    }

    Err(format!("Note {} not found", filename))
}
#[tauri::command]
pub fn get_available_languages(app_handle: tauri::AppHandle) -> Vec<String> {
    let mut path = app_handle
        .path_resolver()
        .resource_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    // In dev mode, we might be inside src-tauri or a subdirectory of target
    // We try to find the project root by looking for "src-tauri" in the path components
    let mut lang_dir = path.clone();
    let mut found = false;

    // Climb up until we find a directory containing "frontend/Lang" or until we hit root
    for _ in 0..10 {
        let check = lang_dir.join("frontend").join("Lang");
        if check.exists() && check.is_dir() {
            lang_dir = check;
            found = true;
            break;
        }
        let check_prod = lang_dir.join("Lang");
        if check_prod.exists() && check_prod.is_dir() {
            lang_dir = check_prod;
            found = true;
            break;
        }
        if !lang_dir.pop() { break; }
    }

    if !found {
        // Fallback to original logic if climbing failed
        lang_dir = if path.ends_with("src-tauri") {
            path.pop();
            path.join("frontend").join("Lang")
        } else {
            path.join("Lang")
        };
    }

    let mut languages = Vec::new();
    if let Ok(entries) = std::fs::read_dir(lang_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Some(name) = p.file_stem().and_then(|n| n.to_str()) {
                    // Skip template if exists
                    if name != "template" {
                        languages.push(name.to_string());
                    }
                }
            }
        }
    }
    
    // Default fallback if empty
    if languages.is_empty() {
        languages.push("fr".to_string());
        languages.push("en".to_string());
    }
    
    languages
}
