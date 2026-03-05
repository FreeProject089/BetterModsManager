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
    };
    Ok(())
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
