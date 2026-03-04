use crate::models::profile::Profile;
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub fn get_profiles(state: State<AppState>) -> Vec<Profile> {
    state.data.lock().unwrap().profiles.clone()
}

#[tauri::command]
pub fn get_active_profile_id(state: State<AppState>) -> Option<String> {
    state.data.lock().unwrap().active_profile_id.clone()
}

#[tauri::command]
pub fn set_active_profile(state: State<AppState>, profile_id: String) -> Result<(), String> {
    {
        let mut data = state.data.lock().unwrap();
        if data.profiles.iter().any(|p| p.id == profile_id) {
            data.active_profile_id = Some(profile_id);
        } else {
            return Err("Profile not found".to_string());
        }
    }
    state.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_profile(
    state: State<AppState>,
    name: String,
    game_name: String,
    game_path: String,
    mods_path: String,
    backup_path: String,
    color: Option<String>,
    icon: Option<String>,
) -> Result<Profile, String> {
    let mut profile = Profile::new(
        name,
        game_name,
        PathBuf::from(&game_path),
        PathBuf::from(&mods_path),
        PathBuf::from(&backup_path),
    );
    profile.color = color;
    profile.icon = icon;
    let result = profile.clone();
    {
        let mut data = state.data.lock().unwrap();
        if data.active_profile_id.is_none() {
            data.active_profile_id = Some(profile.id.clone());
        }
        data.profiles.push(profile);
    }
    state.save().map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
pub fn update_profile(
    state: State<AppState>,
    profile_id: String,
    name: String,
    game_name: String,
    game_path: String,
    mods_path: String,
    backup_path: String,
    color: Option<String>,
    icon: Option<String>,
) -> Result<(), String> {
    {
        let mut data = state.data.lock().unwrap();
        if let Some(p) = data.profiles.iter_mut().find(|p| p.id == profile_id) {
            p.name = name;
            p.game_name = game_name;
            p.game_path = PathBuf::from(&game_path);
            p.mods_path = PathBuf::from(&mods_path);
            p.backup_path = PathBuf::from(&backup_path);
            p.color = color;
            p.icon = icon;
        } else {
            return Err("Profile not found".to_string());
        }
    }
    state.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_profile(state: State<AppState>, profile_id: String) -> Result<(), String> {
    {
        let mut data = state.data.lock().unwrap();
        data.profiles.retain(|p| p.id != profile_id);
        data.mods.retain(|m| !profile_id.contains(&m.id)); // safety
        if data.active_profile_id.as_deref() == Some(&profile_id) {
            data.active_profile_id = data.profiles.first().map(|p| p.id.clone());
        }
    }
    state.save().map_err(|e| e.to_string())
}
