use crate::state::AppState;
use crate::fs_utils::{resolve_path, get_lang_dir};
use tauri::State;
use crate::error::AppError;
use tracing::{info, warn};

#[derive(serde::Deserialize)]
pub struct ExportOptions {
    pub profiles: bool,
    pub mods: bool,
    pub settings: bool,
    pub custom_tags: bool,
    pub disk_limits: bool,
}

#[tauri::command]
pub fn export_app_data(state: State<AppState>, dest_path: String, options: Option<ExportOptions>) -> Result<(), AppError> {
    let _ = state.save(); // Save current memory to disk first
    
    if let Some(opts) = options {
        let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        let mut export_data = crate::state::AppData::default();
        if opts.profiles { 
            export_data.profiles = data.profiles.clone(); 
            export_data.active_profile_id = data.active_profile_id.clone(); 
        }
        if opts.mods { export_data.mods = data.mods.clone(); }
        if opts.settings { export_data.settings = data.settings.clone(); }
        if opts.custom_tags { export_data.custom_tags = data.custom_tags.clone(); }
        if opts.disk_limits { export_data.disk_limits = data.disk_limits.clone(); }
        
        let json = serde_json::to_string_pretty(&export_data)?;
        std::fs::write(&dest_path, json)?;
    } else {
        std::fs::copy(&*state.data_path, dest_path)?;
    }
    Ok(())
}

#[tauri::command]
pub fn import_app_data(state: State<AppState>, src_path: String) -> Result<(), AppError> {
    std::fs::copy(src_path, &*state.data_path)?;
    // Reload state into memory
    let new_state = AppState::load((*state.data_path).clone());
    let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    let new_data = new_state.data.lock().map_err(|_| AppError::LockError("Failed to lock new AppState".to_string()))?;
    *data = crate::state::AppData {
        profiles: new_data.profiles.clone(),
        mods: new_data.mods.clone(),
        active_profile_id: new_data.active_profile_id.clone(),
        custom_tags: new_data.custom_tags.clone(),
        disk_limits: new_data.disk_limits.clone(),
        settings: new_data.settings.clone(),
        launch_packs: new_data.launch_packs.clone(),
    };
    Ok(())
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<crate::state::AppSettings, AppError> {
    let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    Ok(data.settings.clone())
}

#[tauri::command]
pub fn update_settings(state: State<AppState>, settings: crate::state::AppSettings) -> Result<(), AppError> {
    {
        let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        data.settings = settings;
    }
    state.save()?;
    Ok(())
}

#[tauri::command]
pub fn apply_fs_security_mode_command(app: tauri::AppHandle) {
    crate::apply_fs_security_mode(app);
}

#[tauri::command]
pub fn reset_app_data(state: State<AppState>) -> Result<(), AppError> {
    {
        let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        *data = crate::state::AppData::default();
    }
    let _ = state.save();
    Ok(())
}


#[tauri::command]
pub fn is_debug_mode(app_handle: tauri::AppHandle) -> bool {
    if let Some(path) = resolve_path(&app_handle, "app.cfg") {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let normalized = content.to_lowercase();
            let is_debug = normalized.contains("prod=false");
            info!("[DEBUG_SYSTEM] Resolution: {:?}, is_debug: {}", path, is_debug);
            return is_debug;
        }
    }
    
    warn!("[DEBUG_SYSTEM] app.cfg could not be resolved.");
    false
}
#[tauri::command]
pub fn is_fsdm_mode(app_handle: tauri::AppHandle) -> bool {
    if let Some(path) = resolve_path(&app_handle, "app.cfg") {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let normalized = content.to_lowercase();
            return normalized.contains("fsdm=true");
        }
    }
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
pub fn get_eula_text(app_handle: tauri::AppHandle, lang: String) -> Result<String, String> {
    // 1. Try exact match: EULA_{LANG}.md (e.g. EULA_FR.md, EULA_DE.md, EULA_ES.md)
    let specific = format!("EULA_{}.md", lang.to_uppercase());
    if let Some(path) = resolve_path(&app_handle, &specific) {
        if let Ok(text) = std::fs::read_to_string(&path) {
            return Ok(text);
        }
    }

    // 2. Fallback: default EULA.md (English)
    if let Some(path) = resolve_path(&app_handle, "EULA.md") {
        return std::fs::read_to_string(path).map_err(|e| e.to_string());
    }

    Err("EULA.md not found".to_string())
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

#[tauri::command]
pub fn is_auto_eula_enabled(app_handle: tauri::AppHandle) -> bool {
    if let Some(path) = resolve_path(&app_handle, "app.cfg") {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let normalized = content.to_lowercase();
            return normalized.contains("autoeula_on_first_start=true");
        }
    }
    false
}


#[derive(serde::Serialize)]
pub struct QuickLinksConfig {
    pub card1_disabled: bool,
    pub card2_disabled: bool,
}

#[tauri::command]
pub fn get_quicklinks_config(app_handle: tauri::AppHandle) -> QuickLinksConfig {
    let mut cfg = QuickLinksConfig { card1_disabled: false, card2_disabled: false };
    if let Some(path) = resolve_path(&app_handle, "app.cfg") {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let normalized = content.to_lowercase();
            cfg.card1_disabled = normalized.contains("quicklink1_disabled=true");
            cfg.card2_disabled = normalized.contains("quicklink2_disabled=true");
        }
    }
    cfg
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
                debug.push_str(&format!("  {:?}\n", entry.file_name()));
            }
        }
    }
    
    debug
}

#[tauri::command]
pub fn exit_app() {
    std::process::exit(0);
}
