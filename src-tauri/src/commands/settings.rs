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

fn resolve_path(app_handle: &tauri::AppHandle, path: &str) -> Option<std::path::PathBuf> {
    // 1. Production: Try multiple patterns via Tauri resolve_resource
    let candidates = [
        path.to_string(), // As requested (e.g. "Lang/en.json")
        format!("_up_/{}", path), // Bundled relative parent (e.g. "_up_/app.cfg")
        format!("_up_/frontend/{}", path), // Bundled relative sibling (e.g. "_up_/frontend/Lang/en.json")
        path.split('/').last().unwrap_or(path).to_string(), // Flattened (e.g. "en.json")
        format!("frontend/{}", path), // Deep (e.g. "frontend/Lang/en.json")
    ];

    for candidate in &candidates {
        if let Some(p) = app_handle.path_resolver().resolve_resource(candidate) {
            if p.exists() {
                return Some(p);
            }
        }
    }

    // 2. Development: Try climbing up from resource_dir
    if let Some(mut p) = app_handle.path_resolver().resource_dir() {
        for _ in 0..5 {
            let check = p.join(path);
            if check.exists() {
                return Some(check);
            }
            // Also check frontend/path if we are at root
            let check_frontend = p.join("frontend").join(path);
            if check_frontend.exists() {
                return Some(check_frontend);
            }
            if !p.pop() { break; }
        }
    }
    
    // 3. Last resort: Direct path from current working directory
    let direct = std::path::PathBuf::from(path);
    if direct.exists() {
        return Some(direct);
    }

    None
}

#[tauri::command]
pub fn is_debug_mode(app_handle: tauri::AppHandle) -> bool {
    if let Some(path) = resolve_path(&app_handle, "app.cfg") {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let normalized = content.to_lowercase();
            let is_debug = normalized.contains("prod=false");
            println!("[DEBUG_SYSTEM] Resolution: {:?}, is_debug: {}", path, is_debug);
            return is_debug;
        }
    }
    
    println!("[DEBUG_SYSTEM] app.cfg could not be resolved.");
    false
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
pub fn get_license_text(app_handle: tauri::AppHandle) -> Result<String, String> {
    if let Some(path) = resolve_path(&app_handle, "LICENSE.md") {
        return std::fs::read_to_string(path).map_err(|e| e.to_string());
    }
    
    Err("LICENSE.md not found".to_string())
}

#[tauri::command]
pub fn is_ptb_mode(app_handle: tauri::AppHandle) -> bool {
    if let Some(path) = resolve_path(&app_handle, "app.cfg") {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let normalized = content.to_lowercase();
            return normalized.contains("ptb=true");
        }
    }
    false
}

#[tauri::command]
pub fn is_update_disabled(app_handle: tauri::AppHandle) -> bool {
    if let Some(path) = resolve_path(&app_handle, "app.cfg") {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let normalized = content.to_lowercase();
            return normalized.contains("disableupdate=true");
        }
    }
    false
}

fn get_lang_dir(app_handle: &tauri::AppHandle) -> std::path::PathBuf {
    // Use our robust helper to find en.json and take its parent
    if let Some(path) = resolve_path(app_handle, "Lang/en.json") {
        if let Some(parent) = path.parent() {
            return parent.to_path_buf();
        }
    }
    
    // Manual fallbacks if even resolve_path failed or for weird dev environments
    let path = app_handle
        .path_resolver()
        .resource_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    let mut current = path.clone();
    for _ in 0..5 {
        let check_prod = current.join("Lang");
        if check_prod.exists() && check_prod.is_dir() { return check_prod; }
        
        let check_dev = current.join("frontend").join("Lang");
        if check_dev.exists() && check_dev.is_dir() { return check_dev; }
        
        if !current.pop() { break; }
    }

    // Absolute fallback
    path.join("Lang")
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

#[tauri::command]
pub fn get_resource_debug_info(app_handle: tauri::AppHandle) -> String {
    let mut debug = String::new();
    debug.push_str(&format!("Resource Dir: {:?}\n", app_handle.path_resolver().resource_dir()));
    
    let checks = [
        "app.cfg", 
        "_up_/app.cfg",
        "LICENSE.md", 
        "_up_/LICENSE.md",
        "Lang", 
        "_up_/frontend/Lang",
        "Lang/en.json", 
        "_up_/frontend/Lang/en.json"
    ];
    for check in &checks {
        let res = app_handle.path_resolver().resolve_resource(check);
        debug.push_str(&format!("Resolve '{}': {:?} (Exists: {})\n", check, res, res.as_ref().map(|p| p.exists()).unwrap_or(false)));
    }

    if let Some(res_dir) = app_handle.path_resolver().resource_dir() {
        if let Ok(entries) = std::fs::read_dir(&res_dir) {
            debug.push_str("\nResource Dir Listing:\n");
            for entry in entries.flatten() {
                debug.push_str(&format!(" - {:?}\n", entry.path()));
            }
        }
    }

    debug
}
