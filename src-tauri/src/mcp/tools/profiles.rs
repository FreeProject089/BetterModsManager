//! MCP Tools — Profile management (read-only)

#![allow(dead_code)]
use crate::mcp::state_bridge;
use serde::Serialize;

/// Compact profile summary for listings
#[derive(Debug, Serialize)]
pub struct ProfileSummary {
    pub id: String,
    pub name: String,
    pub game_name: String,
    pub game_path: String,
    pub mods_path: String,
    pub active_mod_count: usize,
    pub created_at: String,
    pub is_active: bool,
}

/// Full profile details with paths and mod list
#[derive(Debug, Serialize)]
pub struct ProfileDetails {
    pub id: String,
    pub name: String,
    pub game_name: String,
    pub game_path: String,
    pub mods_path: String,
    pub backup_path: String,
    pub active_mods: Vec<String>,
    pub active_mod_count: usize,
    pub total_mods_in_profile: usize,
    pub color: Option<String>,
    pub created_at: String,
    pub is_active: bool,
}

/// List all profiles with summary stats
pub fn list_profiles() -> Result<Vec<ProfileSummary>, String> {
    let data = state_bridge::read_app_data()
        .map_err(|e| format!("Failed to read BMM data: {}", e))?;

    let active_id = data.active_profile_id.as_deref();

    let profiles: Vec<ProfileSummary> = data.profiles.iter().map(|p| {
        let mod_count = data.mods.iter()
            .filter(|m| m.mod_folder_path.starts_with(&p.mods_path) && m.enabled)
            .count();

        ProfileSummary {
            id: p.id.clone(),
            name: p.name.clone(),
            game_name: p.game_name.clone(),
            game_path: p.game_path.to_string_lossy().to_string(),
            mods_path: p.mods_path.to_string_lossy().to_string(),
            active_mod_count: mod_count,
            created_at: p.created_at.clone(),
            is_active: active_id == Some(p.id.as_str()),
        }
    }).collect();

    Ok(profiles)
}

/// Get detailed information about a specific profile
pub fn get_profile_details(profile_id: &str) -> Result<ProfileDetails, String> {
    let data = state_bridge::read_app_data()
        .map_err(|e| format!("Failed to read BMM data: {}", e))?;

    let active_id = data.active_profile_id.as_deref();

    let profile = data.profiles.iter()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| format!("Profile '{}' not found", profile_id))?;

    let profile_mods: Vec<&state_bridge::BmmModEntry> = data.mods.iter()
        .filter(|m| m.mod_folder_path.starts_with(&profile.mods_path))
        .collect();

    let active_count = profile_mods.iter().filter(|m| m.enabled).count();

    Ok(ProfileDetails {
        id: profile.id.clone(),
        name: profile.name.clone(),
        game_name: profile.game_name.clone(),
        game_path: profile.game_path.to_string_lossy().to_string(),
        mods_path: profile.mods_path.to_string_lossy().to_string(),
        backup_path: profile.backup_path.to_string_lossy().to_string(),
        active_mods: profile.active_mods.clone(),
        active_mod_count: active_count,
        total_mods_in_profile: profile_mods.len(),
        color: profile.color.clone(),
        created_at: profile.created_at.clone(),
        is_active: active_id == Some(profile.id.as_str()),
    })
}

/// Get the currently active profile (if any)
pub fn get_active_profile() -> Result<Option<ProfileSummary>, String> {
    let data = state_bridge::read_app_data()
        .map_err(|e| format!("Failed to read BMM data: {}", e))?;

    let active_id = match &data.active_profile_id {
        Some(id) => id.clone(),
        None => return Ok(None),
    };

    let profile = data.profiles.iter()
        .find(|p| p.id == active_id);

    match profile {
        Some(p) => {
            let mod_count = data.mods.iter()
                .filter(|m| m.mod_folder_path.starts_with(&p.mods_path) && m.enabled)
                .count();

            Ok(Some(ProfileSummary {
                id: p.id.clone(),
                name: p.name.clone(),
                game_name: p.game_name.clone(),
                game_path: p.game_path.to_string_lossy().to_string(),
                mods_path: p.mods_path.to_string_lossy().to_string(),
                active_mod_count: mod_count,
                created_at: p.created_at.clone(),
                is_active: true,
            }))
        }
        None => Ok(None),
    }
}

/// Set the active profile ID
pub fn set_active_profile(profile_id: &str) -> Result<String, String> {
    let mut data = state_bridge::read_app_data()
        .map_err(|e| format!("Failed to read BMM data: {}", e))?;

    // Verify profile exists
    if !data.profiles.iter().any(|p| p.id == profile_id) {
        return Err(format!("Profile '{}' not found", profile_id));
    }

    data.active_profile_id = Some(profile_id.to_string());
    
    state_bridge::write_app_data(&data)
        .map_err(|e| format!("Failed to save changes: {}", e))?;

    Ok(format!("Active profile set to '{}'", profile_id))
}
