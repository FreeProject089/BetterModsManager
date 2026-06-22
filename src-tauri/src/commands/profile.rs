use tauri_plugin_fs::FsExt;
use crate::models::profile::Profile;
use crate::state::AppState;
use crate::commands::crash::log_line;
use std::path::PathBuf;
use tauri::{State, Manager};
use serde::Deserialize;
use crate::error::AppError;
use tracing::{info, warn, error};

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
pub fn get_profiles(state: State<AppState>) -> Result<Vec<Profile>, AppError> {
    let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    Ok(data.profiles.clone())
}

#[tauri::command]
pub fn get_active_profile_id(state: State<AppState>) -> Result<Option<String>, AppError> {
    let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    Ok(data.active_profile_id.clone())
}

#[tauri::command]
pub fn set_active_profile(state: State<AppState>, profile_id: String) -> Result<(), AppError> {
    {
        let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        if let Some(p) = data.profiles.iter().find(|p| p.id == profile_id) {
            info!("Switched active profile to '{}' ({})", p.name, profile_id);
            log_line(format!("[PROFILE] Switched active profile to '{}' ({})", p.name, profile_id));
            data.active_profile_id = Some(profile_id);
        } else {
            warn!("Profile not found: {}", profile_id);
            return Err(AppError::NotFound("Profile not found".to_string()));
        }
    }
    state.save()?;
    Ok(())
}

#[tauri::command]
pub fn create_profile(
    app: tauri::AppHandle,
    state: State<AppState>,
    payload: ProfilePayload,
) -> Result<Profile, AppError> {
    // Validate paths
    let game_p = PathBuf::from(&payload.game_path);
    let mods_p = PathBuf::from(&payload.mods_path);
    let backup_p = PathBuf::from(&payload.backup_path);

    if !game_p.exists() {
        error!("Game path does not exist: {}", payload.game_path);
        return Err(AppError::NotFound(format!("Le dossier du jeu n'existe pas : {}", payload.game_path)));
    }
    if !mods_p.exists() {
        error!("Mods path does not exist: {}", payload.mods_path);
        return Err(AppError::NotFound(format!("Le dossier des mods n'existe pas : {}", payload.mods_path)));
    }

    let mut profile = Profile::new(
        payload.name,
        payload.game_name,
        game_p.clone(),
        mods_p.clone(),
        backup_p.clone(),
    );
    profile.color = payload.color;
    profile.icon = payload.icon;
    let result = profile.clone();
    {
        let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        if data.active_profile_id.is_none() {
            data.active_profile_id = Some(profile.id.clone());
        }
        data.profiles.push(profile);
    }
    state.save()?;
    info!("Created profile '{}' (game: {}, id: {})", result.name, result.game_name, result.id);
    log_line(format!("[PROFILE] Created profile '{}' (game: {}, id: {})", result.name, result.game_name, result.id));

    // Dynamic Scope Extension
    let mode = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?.settings.fs_security_mode.clone();
    if mode.as_deref() == Some("limited") {
        let _ = app.fs_scope().allow_directory(&game_p, true);
        let _ = app.fs_scope().allow_directory(&mods_p, true);
        let _ = app.fs_scope().allow_directory(&backup_p, true);
        let _ = app.asset_protocol_scope().allow_directory(&game_p, true);
        let _ = app.asset_protocol_scope().allow_directory(&mods_p, true);
        let _ = app.asset_protocol_scope().allow_directory(&backup_p, true);
    }

    Ok(result)
}

#[tauri::command]
pub fn update_profile(
    app: tauri::AppHandle,
    state: State<AppState>,
    profile_id: String,
    payload: ProfilePayload,
) -> Result<(), AppError> {
    log_line(format!("[PROFILE] Updated profile '{}' ({})", payload.name, profile_id));
    
    // Validate paths
    let game_p = PathBuf::from(&payload.game_path);
    let mods_p = PathBuf::from(&payload.mods_path);
    
    if !game_p.exists() {
        error!("Game path does not exist: {}", payload.game_path);
        return Err(AppError::NotFound(format!("Le dossier du jeu n'existe pas : {}", payload.game_path)));
    }
    if !mods_p.exists() {
        error!("Mods path does not exist: {}", payload.mods_path);
        return Err(AppError::NotFound(format!("Le dossier des mods n'existe pas : {}", payload.mods_path)));
    }

    let mods_path_changed = {
        let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        if let Some(p) = data.profiles.iter_mut().find(|x| x.id == profile_id) {
            let changed = p.mods_path != mods_p;
            p.name = payload.name;
            p.game_name = payload.game_name;
            p.game_path = game_p.clone();
            p.mods_path = mods_p.clone();
            p.backup_path = PathBuf::from(&payload.backup_path);
            p.color = payload.color;
            p.icon = payload.icon;
            changed
        } else {
            warn!("Profile not found for update: {}", profile_id);
            return Err(AppError::NotFound("Profile not found".to_string()));
        }
    };
    state.save()?;

    // If the mods folder changed, rescan it and detect mods missing a hash — they
    // get queued for the THROTTLED background hashing (no UI freeze).
    if mods_path_changed {
        crate::commands::mods::invalidate_cache(&state);
        crate::commands::mods::populate_sha_queue(state.clone());
        log_line(format!("[PROFILE] Mods folder changed for '{}' → cache invalidated, unhashed mods queued for background hashing", profile_id));
    }

    // Dynamic Scope Extension
    let mode = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?.settings.fs_security_mode.clone();
    if mode.as_deref() == Some("limited") {
        let _ = app.fs_scope().allow_directory(&game_p, true);
        let _ = app.fs_scope().allow_directory(&mods_p, true);
        let _ = app.fs_scope().allow_directory(&PathBuf::from(&payload.backup_path), true);
        let _ = app.asset_protocol_scope().allow_directory(&game_p, true);
        let _ = app.asset_protocol_scope().allow_directory(&mods_p, true);
        let _ = app.asset_protocol_scope().allow_directory(&PathBuf::from(&payload.backup_path), true);
    }

    Ok(())
}

#[tauri::command]
pub fn delete_profile(state: State<AppState>, profile_id: String) -> Result<(), AppError> {
    info!("Deleting profile {}", profile_id);
    log_line(format!("[PROFILE] Deleting profile ({})", profile_id));
    {
        let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        data.profiles.retain(|p| p.id != profile_id);
        if data.active_profile_id.as_deref() == Some(&profile_id) {
            data.active_profile_id = data.profiles.first().map(|p| p.id.clone());
        }
    }
    crate::commands::mods::invalidate_cache(&state);
    state.save()?;
    Ok(())
}
