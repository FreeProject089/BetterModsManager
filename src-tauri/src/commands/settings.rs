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

fn get_lang_dir(app_handle: &tauri::AppHandle) -> std::path::PathBuf {
    let mut path = app_handle
        .path_resolver()
        .resource_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."));

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
        if path.ends_with("src-tauri") {
            let mut p = path.clone();
            p.pop();
            p.join("frontend").join("Lang")
        } else {
            path.join("Lang")
        }
    } else {
        lang_dir
    }
}

#[tauri::command]
pub fn get_available_languages(app_handle: tauri::AppHandle) -> Vec<String> {
    let lang_dir = get_lang_dir(&app_handle);
    let mut languages = Vec::new();
    
    if let Ok(entries) = std::fs::read_dir(lang_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Some(name) = p.file_stem().and_then(|n| n.to_str()) {
                    if name != "template" {
                        languages.push(name.to_string());
                    }
                }
            }
        }
    }
    
    if languages.is_empty() {
        languages.push("fr".to_string());
        languages.push("en".to_string());
    }
    
    languages
}

#[tauri::command]
pub fn get_language_content(app_handle: tauri::AppHandle, lang: String) -> Result<String, String> {
    let lang_dir = get_lang_dir(&app_handle);
    let file_path = lang_dir.join(format!("{}.json", lang));
    
    if !file_path.exists() {
        return Err(format!("Language file not found: {}.json", lang));
    }
    
    std::fs::read_to_string(file_path).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn import_language(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri::api::dialog::blocking::FileDialogBuilder;
    use std::fs;

    let file_path = FileDialogBuilder::new()
        .add_filter("Language JSON", &["json"])
        .set_title("Select Language File")
        .pick_file();

    if let Some(src_path) = file_path {
        let file_name = src_path
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or("Invalid filename")?;

        if file_name == "template.json" {
            return Err("Cannot import template.json directly. Please rename it.".to_string());
        }

        // Get Lang directory path using helper
        let lang_dir = get_lang_dir(&app_handle);

        if !lang_dir.exists() {
            fs::create_dir_all(&lang_dir).map_err(|e| e.to_string())?;
        }

        let dest_path = lang_dir.join(file_name);
        fs::copy(&src_path, &dest_path).map_err(|e| e.to_string())?;

        Ok(file_name.replace(".json", ""))
    } else {
        Err("Canceled".to_string())
    }
}
