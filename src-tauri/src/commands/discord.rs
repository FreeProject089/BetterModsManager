use crate::state::AppState;
use tauri::State;
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use crate::error::AppError;
use tracing::{info, warn, error};

const DISCORD_CLIENT_ID: &str = "1486151779195555920"; // Placeholder BMM Client ID

#[tauri::command]
pub fn set_discord_presence(
    state: State<AppState>,
    details: String,
    status: String,
) -> Result<(), AppError> {
    let mut client_lock = state.discord_client.lock().map_err(|_| AppError::LockError("Failed to lock discord client".to_string()))?;
    
    // Check if enabled in settings
    {
        let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        if !data.settings.discord_rpc_enabled {
            if let Some(client) = client_lock.as_mut() {
                let _ = client.close();
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
                info!("Connected to Discord RPC");
                *client_lock = Some(Box::new(client));
            } else {
                warn!("Failed to connect to Discord RPC");
                return Err(AppError::Internal("FAILED_TO_CONNECT".to_string()));
            }
        } else {
            error!("Failed to create Discord IPC Client");
            return Err(AppError::Internal("IPC_CLIENT_ERROR".to_string()));
        }
    }

    // Update presence
    if let Some(client) = client_lock.as_mut() {
        let version_text = format!("Better Mods Manager v{}", env!("CARGO_PKG_VERSION"));
        let payload = discord_rich_presence::activity::Activity::new()
            .details(&details)
            .state(&status)
            .assets(discord_rich_presence::activity::Assets::new()
                .large_image("bmm_logo")
                .large_text(&version_text));

        let _ = client.set_activity(payload);
    }

    Ok(())
}

#[tauri::command]
pub fn init_discord_rpc(state: State<AppState>) -> Result<(), AppError> {
    let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
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
