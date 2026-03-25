use crate::state::AppState;
use tauri::State;
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};

const DISCORD_CLIENT_ID: &str = "1486151779195555920"; // Placeholder BMM Client ID

#[tauri::command]
pub fn set_discord_presence(
    state: State<AppState>,
    details: String,
    status: String,
) -> Result<(), String> {
    let mut client_lock = state.discord_client.lock().unwrap();
    
    // Check if enabled in settings
    {
        let data = state.data.lock().unwrap();
        if !data.settings.discord_rpc_enabled {
            if client_lock.is_some() {
                let _ = client_lock.as_mut().unwrap().close();
                *client_lock = None;
            }
            return Ok(());
        }
    }

    // Initialize if not connected
    if client_lock.is_none() {
        let client_res = DiscordIpcClient::new(DISCORD_CLIENT_ID);
        if let Ok(mut client) = client_res {
            if client.connect().is_ok() {
                *client_lock = Some(Box::new(client));
            } else {
                return Err("FAILED_TO_CONNECT".to_string());
            }
        } else {
            return Err("IPC_CLIENT_ERROR".to_string());
        }
    }

    // Update presence
    if let Some(client) = client_lock.as_mut() {
        let payload = discord_rich_presence::activity::Activity::new()
            .details(&details)
            .state(&status)
            .assets(discord_rich_presence::activity::Assets::new()
                .large_image("bmm_logo")
                .large_text("Better Mods Manager"));

        let _ = client.set_activity(payload);
    }

    Ok(())
}

#[tauri::command]
pub fn init_discord_rpc(state: State<AppState>) -> Result<(), String> {
    let data = state.data.lock().unwrap();
    if !data.settings.discord_rpc_enabled {
        return Ok(());
    }

    // Trigger an initial update if a profile is active
    let profile_name = if let Some(active_id) = &data.active_profile_id {
        data.profiles.iter()
            .find(|p| &p.id == active_id)
            .map(|p| p.name.clone())
            .unwrap_or_else(|| "Aucun profil".to_string())
    } else {
        "En attente...".to_string()
    };

    let active_mods_count = if let Some(active_id) = &data.active_profile_id {
        data.profiles.iter()
            .find(|p| &p.id == active_id)
            .map(|p| p.active_mods.len())
            .unwrap_or(0)
    } else {
        0
    };

    drop(data);
    set_discord_presence(state, format!("Profil: {}", profile_name), format!("{} mods activés", active_mods_count))
}
