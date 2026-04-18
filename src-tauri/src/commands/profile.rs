use crate::models::profile::Profile;
use crate::state::AppState;
use crate::commands::crash::log_line;
use std::path::PathBuf;
use tauri::State;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilePayload {
    pub name: String,
    pub game_name: String,
    pub game_path: String,
    pub mods_path: String,
    pub backup_path: String,
    pub color: Option<String>,
    pub icon: Option<String>,
}

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
        if let Some(p) = data.profiles.iter().find(|p| p.id == profile_id) {
            log_line(format!("[PROFILE] Switched active profile to '{}' ({})", p.name, profile_id));
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
    payload: ProfilePayload,
) -> Result<Profile, String> {
    // Validate paths
    let game_p = PathBuf::from(&payload.game_path);
    let mods_p = PathBuf::from(&payload.mods_path);
    let backup_p = PathBuf::from(&payload.backup_path);

    if !game_p.exists() {
        return Err(format!("Le dossier du jeu n'existe pas : {}", payload.game_path));
    }
    if !mods_p.exists() {
        return Err(format!("Le dossier des mods n'existe pas : {}", payload.mods_path));
    }

    let mut profile = Profile::new(
        payload.name,
        payload.game_name,
        game_p,
        mods_p,
        backup_p,
    );
    profile.color = payload.color;
    profile.icon = payload.icon;
    let result = profile.clone();
    {
        let mut data = state.data.lock().unwrap();
        if data.active_profile_id.is_none() {
            data.active_profile_id = Some(profile.id.clone());
        }
        data.profiles.push(profile);
    }
    state.save().map_err(|e| e.to_string())?;
    log_line(format!("[PROFILE] Created profile '{}' (game: {}, id: {})", result.name, result.game_name, result.id));
    Ok(result)
}

#[tauri::command]
pub fn update_profile(
    state: State<AppState>,
    profile_id: String,
    payload: ProfilePayload,
) -> Result<(), String> {
    log_line(format!("[PROFILE] Updated profile '{}' ({})", payload.name, profile_id));
    
    // Validate paths
    let game_p = PathBuf::from(&payload.game_path);
    let mods_p = PathBuf::from(&payload.mods_path);
    
    if !game_p.exists() {
        return Err(format!("Le dossier du jeu n'existe pas : {}", payload.game_path));
    }
    if !mods_p.exists() {
        return Err(format!("Le dossier des mods n'existe pas : {}", payload.mods_path));
    }

    {
        let mut data = state.data.lock().unwrap();
        if let Some(p) = data.profiles.iter_mut().find(|x| x.id == profile_id) {
            p.name = payload.name;
            p.game_name = payload.game_name;
            p.game_path = game_p;
            p.mods_path = mods_p;
            p.backup_path = PathBuf::from(&payload.backup_path);
            p.color = payload.color;
            p.icon = payload.icon;
        } else {
            return Err("Profile not found".to_string());
        }
    }
    state.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_profile(state: State<AppState>, profile_id: String) -> Result<(), String> {
    log_line(format!("[PROFILE] Deleting profile ({})", profile_id));
    {
        let mut data = state.data.lock().unwrap();
        data.profiles.retain(|p| p.id != profile_id);
        if data.active_profile_id.as_deref() == Some(&profile_id) {
            data.active_profile_id = data.profiles.first().map(|p| p.id.clone());
        }
    }
    crate::commands::mods::invalidate_cache(&state);
    state.save().map_err(|e| e.to_string())
}
