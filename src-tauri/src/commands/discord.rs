use crate::state::AppState;
use tauri::State;
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use crate::error::AppError;
use tracing::{info, warn, error};

const DISCORD_CLIENT_ID: &str = "1486151779195555920"; // Placeholder BMM Client ID

// Where to fetch links.json remotely (kept in sync with frontend links-config.ts).
const REMOTE_LINKS_URL: &str =
    "https://raw.githubusercontent.com/FreeProject089/BetterModsManager/refs/heads/Tdev/frontend/assets/links.json";

/// Resolved Discord RPC button config, read from links.json.
struct RpcLinks {
    label:  String,  // first button (site) label/url — or its alt, per `use_alt`
    link:   String,
    label2: String,  // second button (e.g. GitHub)
    link2:  String,
}

impl Default for RpcLinks {
    fn default() -> Self {
        RpcLinks {
            label:  "BetterCommunity".into(),
            link:   "https://bettercommunity.ch/".into(),
            label2: "GitHub".into(),
            link2:  "https://github.com/FreeProject089/BetterModsManager".into(),
        }
    }
}

fn rpc_links_from_json(v: &serde_json::Value) -> RpcLinks {
    let d = RpcLinks::default();
    let use_alt = v.get("rpc_use_alt").and_then(|x| x.as_bool()).unwrap_or(false);
    let s = |k: &str, fb: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or(fb).to_string();
    if use_alt {
        RpcLinks {
            label:  s("rpc_label_alt", &d.label),
            link:   s("rpc_link_alt",  &d.link),
            label2: s("rpc_label2",    &d.label2),
            link2:  s("rpc_link2",     &d.link2),
        }
    } else {
        RpcLinks {
            label:  s("rpc_label", &d.label),
            link:   s("rpc_link",  &d.link),
            label2: s("rpc_label2", &d.label2),
            link2:  s("rpc_link2",  &d.link2),
        }
    }
}

/// Load RPC links: remote GitHub links.json first, then the bundled resource
/// copy as backup, then hardcoded defaults. Network call is capped at ~2.5s so
/// it never noticeably stalls presence updates.
fn load_rpc_links(handle: &tauri::AppHandle) -> RpcLinks {
    // 1. Remote (so links can change without an app update)
    if let Ok(client) = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(2500)).build()
    {
        if let Ok(resp) = client.get(REMOTE_LINKS_URL).send() {
            if let Ok(text) = resp.text() {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    return rpc_links_from_json(&json);
                }
            }
        }
    }
    // 2. Bundled resource copy (offline backup)
    if let Some(p) = handle.path_resolver().resolve_resource("../frontend/assets/links.json")
        .or_else(|| handle.path_resolver().resolve_resource("frontend/assets/links.json"))
    {
        if let Ok(text) = std::fs::read_to_string(&p) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                return rpc_links_from_json(&json);
            }
        }
    }
    // 3. Hardcoded
    RpcLinks::default()
}

#[tauri::command]
pub fn set_discord_presence(
    state: State<AppState>,
    handle: tauri::AppHandle,
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

    // Resolve this user's Creator ID (ed25519 public key). Discord activity
    // buttons can only OPEN a URL — they can't copy to the clipboard — so the
    // "Copy Creator ID" button links to the BMM web page with the id in the
    // query string (the page can surface/copy it). Discord caps activities at
    // 2 buttons, so when a creator id exists we swap "Website" for it.
    let creator_id = crate::commands::security::get_creator_id(handle.clone()).unwrap_or_default();
    let links = load_rpc_links(&handle);

    // Update presence
    if let Some(client) = client_lock.as_mut() {
        let version_text = if creator_id.is_empty() {
            format!("Better Mods Manager v{}", env!("CARGO_PKG_VERSION"))
        } else {
            format!("BMM v{} • Creator ID: {}", env!("CARGO_PKG_VERSION"), creator_id)
        };
        let creator_url = format!(
            "https://freeproject089.github.io/BMM_Web/?creator={}",
            creator_id
        );

        // Button 2 is the configured site link (BetterCommunity by default).
        let mut buttons = vec![
            discord_rich_presence::activity::Button::new(&links.label2, &links.link2),
        ];
        // Button 1: Copy Creator ID when available, otherwise the configured site link.
        if creator_id.is_empty() {
            buttons.insert(0, discord_rich_presence::activity::Button::new(&links.label, &links.link));
        } else {
            buttons.insert(0, discord_rich_presence::activity::Button::new("Copy Creator ID", &creator_url));
        }

        let payload = discord_rich_presence::activity::Activity::new()
            .details(&details)
            .state(&status)
            .assets(discord_rich_presence::activity::Assets::new()
                .large_image("bmm_logo")
                .large_text(&version_text))
            .buttons(buttons);

        let _ = client.set_activity(payload);
    }

    Ok(())
}

#[tauri::command]
pub fn init_discord_rpc(state: State<AppState>, handle: tauri::AppHandle) -> Result<(), AppError> {
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
    set_discord_presence(state, handle, format!("Profil: {}", profile_name), format!("{} mods activés", active_mods_count))
}
