use std::sync::Arc;
use std::net::SocketAddr;
use std::path::PathBuf;
use tokio::sync::oneshot;
use warp::Filter;
use warp::http::StatusCode;
use serde::{Deserialize, Serialize};
use crate::state::AppData;
use crate::models::profile::Profile;

pub const API_PORT: u16 = 51274;
#[derive(Serialize)]
struct ApiError {
    error: String,
}

#[derive(Deserialize)]
struct EnableDisableBody {
    mod_id: String,
}

#[derive(Deserialize)]
struct ActivateProfileBody {
    profile_id: String,
}

#[derive(Deserialize)]
struct ComparePluginBody {
    plugin_id: String,
}

#[derive(Deserialize)]
struct ApplyPluginBody {
    plugin_id: String,
    #[serde(default)]
    force_strict: bool,
}

#[derive(Deserialize)]
struct ServerRepoConnectBody {
    url: String,
}

#[derive(Deserialize)]
struct CreateProfileBody {
    name: String,
    game_name: String,
    game_path: String,
    mods_path: String,
    backup_path: String,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    icon: Option<String>,
}

#[derive(Deserialize)]
struct UpdateProfileBody {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    game_name: Option<String>,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    game_path: Option<String>,
    #[serde(default)]
    mods_path: Option<String>,
    #[serde(default)]
    backup_path: Option<String>,
}

#[derive(Deserialize)]
struct UpdateModBody {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    tags: Option<Vec<String>>,
    #[serde(default)]
    install_notes: Option<String>,
}

#[derive(Deserialize)]
struct CreateModpackRealBody {
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    source_profile_id: Option<String>,
    #[serde(default)]
    game_name: Option<String>,
}

#[derive(Deserialize)]
struct EnableDisableModpackRealBody {
    /// New: real modpack ID from LocalModpack.id
    #[serde(default)]
    modpack_id: Option<String>,
    /// Legacy: profile_id fallback for backwards compatibility
    #[serde(default)]
    profile_id: Option<String>,
}

#[derive(Deserialize)]
struct HostServerRepoBody {
    /// Absolute path to the folder containing mod files
    mods_path: String,
    /// Port to listen on (default: 8765)
    #[serde(default)]
    port: Option<u16>,
    /// Optional repo name shown to clients
    #[serde(default)]
    name: Option<String>,
    /// Special host authorization secret (in addition to Bearer token)
    host_secret: String,
}

#[derive(Deserialize)]
struct ServerRepoSyncBody {
    url: String,
    #[serde(default)]
    profile_id: Option<String>,
    /// "all" | "active" | "selected"
    #[serde(default)]
    sync_mode: Option<String>,
    #[serde(default)]
    mod_ids: Option<Vec<String>>,
    #[serde(default)]
    mods_dir: Option<String>,
    /// Upload/download speed cap in KB/s (0 = unlimited)
    #[serde(default)]
    download_limit: Option<u32>,
    #[serde(default)]
    clean_extras: Option<bool>,
}

fn with_data(
    data: Arc<std::sync::Mutex<AppData>>,
) -> impl Filter<Extract = (Arc<std::sync::Mutex<AppData>>,), Error = std::convert::Infallible> + Clone {
    warp::any().map(move || data.clone())
}

fn with_path(
    path: Arc<PathBuf>,
) -> impl Filter<Extract = (Arc<PathBuf>,), Error = std::convert::Infallible> + Clone {
    warp::any().map(move || path.clone())
}

fn save_data(data: &Arc<std::sync::Mutex<AppData>>, path: &PathBuf) {
    let d = data.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(&*d) {
        let _ = std::fs::write(path, json);
    }
}

fn require_token(
    token: Arc<String>,
) -> impl Filter<Extract = (), Error = warp::Rejection> + Clone {
    warp::header::optional::<String>("authorization")
        .and_then(move |auth: Option<String>| {
            let expected = format!("Bearer {}", token);
            let provided = auth.unwrap_or_default();
            async move {
                if provided == expected {
                    Ok(())
                } else {
                    Err(warp::reject::custom(Unauthorized))
                }
            }
        })
        .untuple_one()
}

#[derive(Debug)]
struct Unauthorized;
impl warp::reject::Reject for Unauthorized {}

pub async fn start_api_server(
    data: Arc<std::sync::Mutex<AppData>>,
    data_path: Arc<PathBuf>,
    creator_id: Arc<String>,
    shutdown_rx: oneshot::Receiver<()>,
) {
    let token = {
        let d = data.lock().unwrap_or_else(|p| p.into_inner());
        Arc::new(d.settings.api_token.clone())
    };

    // GET /api/health
    let health = warp::path!("api" / "health")
        .and(warp::get())
        .map(|| warp::reply::json(&serde_json::json!({ "ok": true, "service": "BMM Plugin API", "port": API_PORT })));

    // GET /api/status
    let data_status = data.clone();
    let status = warp::path!("api" / "status")
        .and(warp::get())
        .and(with_data(data_status))
        .map(|d: Arc<std::sync::Mutex<AppData>>| {
            let data = d.lock().unwrap_or_else(|p| p.into_inner());
            let active_profile = data.active_profile_id.as_ref()
                .and_then(|id| data.profiles.iter().find(|p| &p.id == id))
                .map(|p| serde_json::json!({ "id": p.id, "name": p.name, "game": p.game_name }));
            warp::reply::json(&serde_json::json!({
                "ok": true,
                "version": env!("CARGO_PKG_VERSION"),
                "active_profile": active_profile,
                "mod_count": data.mods.len(),
                "profile_count": data.profiles.len(),
                "plugin_count": data.installed_plugins.len(),
            }))
        });

    // GET /api/mods
    let data_mods = data.clone();
    let get_mods = warp::path!("api" / "mods")
        .and(warp::get())
        .and(with_data(data_mods))
        .map(|d: Arc<std::sync::Mutex<AppData>>| {
            let data = d.lock().unwrap_or_else(|p| p.into_inner());
            let active_id = data.active_profile_id.clone().unwrap_or_default();
            let active_mods: Vec<String> = data.profiles.iter()
                .find(|p| p.id == active_id)
                .map(|p| p.active_mods.clone())
                .unwrap_or_default();
            let mods: Vec<serde_json::Value> = data.mods.iter().map(|m| {
                serde_json::json!({
                    "id": m.id,
                    "name": m.name,
                    "active": active_mods.contains(&m.id),
                    "enabled": m.enabled,
                    "path": m.mod_folder_path.to_string_lossy(),
                })
            }).collect();
            warp::reply::json(&serde_json::json!({ "ok": true, "data": mods }))
        });

    // GET /api/mods/active
    let data_active = data.clone();
    let get_active_mods = warp::path!("api" / "mods" / "active")
        .and(warp::get())
        .and(with_data(data_active))
        .map(|d: Arc<std::sync::Mutex<AppData>>| {
            let data = d.lock().unwrap_or_else(|p| p.into_inner());
            let active_id = data.active_profile_id.clone().unwrap_or_default();
            let active_mods: Vec<String> = data.profiles.iter()
                .find(|p| p.id == active_id)
                .map(|p| p.active_mods.clone())
                .unwrap_or_default();
            let mods: Vec<serde_json::Value> = data.mods.iter()
                .filter(|m| active_mods.contains(&m.id))
                .map(|m| serde_json::json!({ "id": m.id, "name": m.name }))
                .collect();
            warp::reply::json(&serde_json::json!({ "ok": true, "data": mods }))
        });

    // GET /api/profiles
    let data_profiles = data.clone();
    let get_profiles = warp::path!("api" / "profiles")
        .and(warp::get())
        .and(with_data(data_profiles))
        .map(|d: Arc<std::sync::Mutex<AppData>>| {
            let data = d.lock().unwrap_or_else(|p| p.into_inner());
            let profiles: Vec<serde_json::Value> = data.profiles.iter().map(|p| {
                serde_json::json!({
                    "id": p.id,
                    "name": p.name,
                    "game": p.game_name,
                    "active": data.active_profile_id.as_ref() == Some(&p.id),
                })
            }).collect();
            warp::reply::json(&serde_json::json!({ "ok": true, "data": profiles }))
        });

    // GET /api/plugins
    let data_plugins = data.clone();
    let get_plugins = warp::path!("api" / "plugins")
        .and(warp::get())
        .and(with_data(data_plugins))
        .map(|d: Arc<std::sync::Mutex<AppData>>| {
            let data = d.lock().unwrap_or_else(|p| p.into_inner());
            warp::reply::json(&serde_json::json!({ "ok": true, "data": data.installed_plugins }))
        });

    // POST /api/mods/enable  (requires token)
    let data_enable = data.clone();
    let path_enable = data_path.clone();
    let tok_enable = token.clone();
    let enable_mod = warp::path!("api" / "mods" / "enable")
        .and(warp::post())
        .and(require_token(tok_enable))
        .and(warp::body::json::<EnableDisableBody>())
        .and(with_data(data_enable))
        .and(with_path(path_enable))
        .map(|body: EnableDisableBody, d: Arc<std::sync::Mutex<AppData>>, path: Arc<PathBuf>| {
            let active_id = {
                let data = d.lock().unwrap_or_else(|p| p.into_inner());
                match data.active_profile_id.clone() {
                    Some(id) => id,
                    None => return warp::reply::with_status(
                        warp::reply::json(&ApiError { error: "No active profile".into() }),
                        StatusCode::BAD_REQUEST,
                    ),
                }
            };
            {
                let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
                let mod_exists = data.mods.iter().any(|m| m.id == body.mod_id);
                if !mod_exists {
                    return warp::reply::with_status(
                        warp::reply::json(&ApiError { error: format!("Mod '{}' not found", body.mod_id) }),
                        StatusCode::NOT_FOUND,
                    );
                }
                if let Some(p) = data.profiles.iter_mut().find(|p| p.id == active_id) {
                    if !p.active_mods.contains(&body.mod_id) {
                        p.active_mods.push(body.mod_id.clone());
                    }
                }
                if let Some(m) = data.mods.iter_mut().find(|m| m.id == body.mod_id) {
                    m.enabled = true;
                }
            }
            save_data(&d, &path);
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "mod_id": body.mod_id })),
                StatusCode::OK,
            )
        });

    // POST /api/mods/disable  (requires token)
    let data_disable = data.clone();
    let path_disable = data_path.clone();
    let tok_disable = token.clone();
    let disable_mod = warp::path!("api" / "mods" / "disable")
        .and(warp::post())
        .and(require_token(tok_disable))
        .and(warp::body::json::<EnableDisableBody>())
        .and(with_data(data_disable))
        .and(with_path(path_disable))
        .map(|body: EnableDisableBody, d: Arc<std::sync::Mutex<AppData>>, path: Arc<PathBuf>| {
            let active_id = {
                let data = d.lock().unwrap_or_else(|p| p.into_inner());
                match data.active_profile_id.clone() {
                    Some(id) => id,
                    None => return warp::reply::with_status(
                        warp::reply::json(&ApiError { error: "No active profile".into() }),
                        StatusCode::BAD_REQUEST,
                    ),
                }
            };
            {
                let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
                if let Some(p) = data.profiles.iter_mut().find(|p| p.id == active_id) {
                    p.active_mods.retain(|id| id != &body.mod_id);
                }
                if let Some(m) = data.mods.iter_mut().find(|m| m.id == body.mod_id) {
                    m.enabled = false;
                }
            }
            save_data(&d, &path);
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "mod_id": body.mod_id })),
                StatusCode::OK,
            )
        });

    // POST /api/profiles/activate  (requires token)
    let data_profile_act = data.clone();
    let path_profile_act = data_path.clone();
    let tok_profile = token.clone();
    let activate_profile = warp::path!("api" / "profiles" / "activate")
        .and(warp::post())
        .and(require_token(tok_profile))
        .and(warp::body::json::<ActivateProfileBody>())
        .and(with_data(data_profile_act))
        .and(with_path(path_profile_act))
        .map(|body: ActivateProfileBody, d: Arc<std::sync::Mutex<AppData>>, path: Arc<PathBuf>| {
            {
                let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
                let exists = data.profiles.iter().any(|p| p.id == body.profile_id);
                if !exists {
                    return warp::reply::with_status(
                        warp::reply::json(&ApiError { error: format!("Profile '{}' not found", body.profile_id) }),
                        StatusCode::NOT_FOUND,
                    );
                }
                data.active_profile_id = Some(body.profile_id.clone());
            }
            save_data(&d, &path);
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "profile_id": body.profile_id })),
                StatusCode::OK,
            )
        });

    // POST /api/plugins/compare  (requires token)
    let data_compare = data.clone();
    let tok_compare = token.clone();
    let compare_plugin = warp::path!("api" / "plugins" / "compare")
        .and(warp::post())
        .and(require_token(tok_compare))
        .and(warp::body::json::<ComparePluginBody>())
        .and(with_data(data_compare))
        .map(|body: ComparePluginBody, d: Arc<std::sync::Mutex<AppData>>| {
            let data = d.lock().unwrap_or_else(|p| p.into_inner());
            let plugin = match data.installed_plugins.iter().find(|p| p.manifest.id == body.plugin_id) {
                Some(p) => p.clone(),
                None => return warp::reply::with_status(
                    warp::reply::json(&ApiError { error: format!("Plugin '{}' not found", body.plugin_id) }),
                    StatusCode::NOT_FOUND,
                ),
            };
            let active_id = data.active_profile_id.clone().unwrap_or_default();
            let active_mods: Vec<String> = data.profiles.iter()
                .find(|p| p.id == active_id)
                .map(|p| p.active_mods.clone())
                .unwrap_or_default();
            let result = compute_compare(&plugin, &data.mods, &active_mods);
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "data": result })),
                StatusCode::OK,
            )
        });

    // POST /api/plugins/apply  (requires token)
    let data_apply = data.clone();
    let path_apply = data_path.clone();
    let tok_apply = token.clone();
    let apply_plugin = warp::path!("api" / "plugins" / "apply")
        .and(warp::post())
        .and(require_token(tok_apply))
        .and(warp::body::json::<ApplyPluginBody>())
        .and(with_data(data_apply))
        .and(with_path(path_apply))
        .map(|body: ApplyPluginBody, d: Arc<std::sync::Mutex<AppData>>, path: Arc<PathBuf>| {
            let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
            let plugin = match data.installed_plugins.iter().find(|p| p.manifest.id == body.plugin_id).cloned() {
                Some(p) => p,
                None => return warp::reply::with_status(
                    warp::reply::json(&ApiError { error: format!("Plugin '{}' not found", body.plugin_id) }),
                    StatusCode::NOT_FOUND,
                ),
            };
            let active_id = match data.active_profile_id.clone() {
                Some(id) => id,
                None => return warp::reply::with_status(
                    warp::reply::json(&ApiError { error: "No active profile".into() }),
                    StatusCode::BAD_REQUEST,
                ),
            };
            let modlist = match &plugin.manifest.modlist {
                Some(ml) => ml.clone(),
                None => return warp::reply::with_status(
                    warp::reply::json(&ApiError { error: "Plugin has no modlist".into() }),
                    StatusCode::BAD_REQUEST,
                ),
            };

            let strict = modlist.strict || body.force_strict;
            let mut enabled_ids: Vec<String> = Vec::new();
            let mut not_found: Vec<String> = Vec::new();

            for req in &modlist.required_mods {
                if let Some(m) = data.mods.iter().find(|m| m.name.to_lowercase() == req.name.to_lowercase()) {
                    enabled_ids.push(m.id.clone());
                } else if !req.optional {
                    not_found.push(req.name.clone());
                }
            }

            if let Some(p) = data.profiles.iter_mut().find(|p| p.id == active_id) {
                if strict {
                    p.active_mods = enabled_ids.clone();
                } else {
                    for id in &enabled_ids {
                        if !p.active_mods.contains(id) {
                            p.active_mods.push(id.clone());
                        }
                    }
                }
            }
            for m in data.mods.iter_mut() {
                m.enabled = enabled_ids.contains(&m.id);
            }
            drop(data);
            save_data(&d, &path);

            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({
                    "ok": true,
                    "enabled": enabled_ids.len(),
                    "not_found": not_found,
                    "strict": strict,
                })),
                StatusCode::OK,
            )
        });

    // GET /api/creator-id — returns this user's BMM creator ID (public key hex)
    let cid_val = creator_id.clone();
    let get_creator_id_route = warp::path!("api" / "creator-id")
        .and(warp::get())
        .map(move || {
            warp::reply::json(&serde_json::json!({
                "ok": true,
                "creator_id": cid_val.as_str(),
            }))
        });

    // POST /api/modpacks/enable  (requires token) — enables all mods belonging to a modpack or profile
    let data_mp_enable = data.clone();
    let path_mp_enable = data_path.clone();
    let tok_mp_enable = token.clone();
    let enable_modpack = warp::path!("api" / "modpacks" / "enable")
        .and(warp::post())
        .and(require_token(tok_mp_enable))
        .and(warp::body::json::<EnableDisableModpackRealBody>())
        .and(with_data(data_mp_enable))
        .and(with_path(path_mp_enable))
        .map(|body: EnableDisableModpackRealBody, d: Arc<std::sync::Mutex<AppData>>, path: Arc<PathBuf>| {
            let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
            let mod_ids: Vec<String> = if let Some(ref mp_id) = body.modpack_id {
                match data.modpacks.iter().find(|mp| &mp.id == mp_id) {
                    Some(mp) => mp.mods.iter().map(|mr| mr.mod_id.clone()).collect(),
                    None => return warp::reply::with_status(
                        warp::reply::json(&ApiError { error: format!("Modpack '{}' not found", mp_id) }),
                        StatusCode::NOT_FOUND,
                    ),
                }
            } else if let Some(ref prof_id) = body.profile_id {
                match data.profiles.iter().find(|p| &p.id == prof_id) {
                    Some(p) => p.active_mods.clone(),
                    None => return warp::reply::with_status(
                        warp::reply::json(&ApiError { error: format!("Profile '{}' not found", prof_id) }),
                        StatusCode::NOT_FOUND,
                    ),
                }
            } else {
                return warp::reply::with_status(
                    warp::reply::json(&ApiError { error: "modpack_id or profile_id required".into() }),
                    StatusCode::BAD_REQUEST,
                );
            };
            let count = mod_ids.len();
            let active_id = data.active_profile_id.clone().unwrap_or_default();
            if let Some(p) = data.profiles.iter_mut().find(|p| p.id == active_id) {
                for id in &mod_ids {
                    if !p.active_mods.contains(id) {
                        p.active_mods.push(id.clone());
                    }
                }
            }
            for m in data.mods.iter_mut() {
                if mod_ids.contains(&m.id) {
                    m.enabled = true;
                }
            }
            let modpack_id = body.modpack_id.clone().unwrap_or_default();
            drop(data);
            save_data(&d, &path);
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "modpack_id": modpack_id, "enabled_count": count })),
                StatusCode::OK,
            )
        });

    // POST /api/modpacks/disable  (requires token) — disables all mods belonging to a modpack or profile
    let data_mp_disable = data.clone();
    let path_mp_disable = data_path.clone();
    let tok_mp_disable = token.clone();
    let disable_modpack = warp::path!("api" / "modpacks" / "disable")
        .and(warp::post())
        .and(require_token(tok_mp_disable))
        .and(warp::body::json::<EnableDisableModpackRealBody>())
        .and(with_data(data_mp_disable))
        .and(with_path(path_mp_disable))
        .map(|body: EnableDisableModpackRealBody, d: Arc<std::sync::Mutex<AppData>>, path: Arc<PathBuf>| {
            let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
            let mod_ids: Vec<String> = if let Some(ref mp_id) = body.modpack_id {
                match data.modpacks.iter().find(|mp| &mp.id == mp_id) {
                    Some(mp) => mp.mods.iter().map(|mr| mr.mod_id.clone()).collect(),
                    None => return warp::reply::with_status(
                        warp::reply::json(&ApiError { error: format!("Modpack '{}' not found", mp_id) }),
                        StatusCode::NOT_FOUND,
                    ),
                }
            } else if let Some(ref prof_id) = body.profile_id {
                match data.profiles.iter().find(|p| &p.id == prof_id) {
                    Some(p) => p.active_mods.clone(),
                    None => return warp::reply::with_status(
                        warp::reply::json(&ApiError { error: format!("Profile '{}' not found", prof_id) }),
                        StatusCode::NOT_FOUND,
                    ),
                }
            } else {
                return warp::reply::with_status(
                    warp::reply::json(&ApiError { error: "modpack_id or profile_id required".into() }),
                    StatusCode::BAD_REQUEST,
                );
            };
            let count = mod_ids.len();
            let active_id = data.active_profile_id.clone().unwrap_or_default();
            if let Some(p) = data.profiles.iter_mut().find(|p| p.id == active_id) {
                p.active_mods.retain(|id| !mod_ids.contains(id));
            }
            for m in data.mods.iter_mut() {
                if mod_ids.contains(&m.id) {
                    m.enabled = false;
                }
            }
            let modpack_id = body.modpack_id.clone().unwrap_or_default();
            drop(data);
            save_data(&d, &path);
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "modpack_id": modpack_id, "disabled_count": count })),
                StatusCode::OK,
            )
        });

    // POST /api/server-repo/connect  (requires token) — validate + initiate connection to a Server Depot repo
    let tok_srv_repo = token.clone();
    let data_srv_repo = data.clone();
    let path_srv_repo = data_path.clone();
    let server_repo_connect = warp::path!("api" / "server-repo" / "connect")
        .and(warp::post())
        .and(require_token(tok_srv_repo))
        .and(warp::body::json::<ServerRepoConnectBody>())
        .and(with_data(data_srv_repo))
        .and(with_path(path_srv_repo))
        .and_then(|body: ServerRepoConnectBody, d: Arc<std::sync::Mutex<AppData>>, path: Arc<PathBuf>| async move {
            if body.url.is_empty() {
                return Ok::<_, warp::Rejection>(warp::reply::with_status(
                    warp::reply::json(&ApiError { error: "url field is required".into() }),
                    StatusCode::BAD_REQUEST,
                ));
            }

            // Normalise URL: ensure it points at a repo.json
            let mut target = body.url.trim().to_string();
            if !target.starts_with("http://") && !target.starts_with("https://") {
                target = format!("https://{}", target);
            }
            let probe_url = if target.to_lowercase().ends_with("repo.json") {
                target.clone()
            } else if target.ends_with('/') {
                format!("{}repo.json", target)
            } else {
                format!("{}/repo.json", target)
            };

            // Try to fetch the repo.json to validate the URL is reachable
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(8))
                .user_agent("BetterModsManager/1.0")
                .build()
                .map_err(|_| warp::reject::reject())?;

            let fetch_result = client.get(&probe_url).send().await;

            match fetch_result {
                Err(e) => {
                    Ok(warp::reply::with_status(
                        warp::reply::json(&ApiError { error: format!("Cannot reach server: {}", e) }),
                        StatusCode::BAD_GATEWAY,
                    ))
                }
                Ok(resp) if !resp.status().is_success() => {
                    Ok(warp::reply::with_status(
                        warp::reply::json(&ApiError { error: format!("Server returned HTTP {}", resp.status()) }),
                        StatusCode::BAD_GATEWAY,
                    ))
                }
                Ok(resp) => {
                    let repo_json: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
                    let version   = repo_json.get("version").and_then(|v| v.as_str()).unwrap_or("?").to_string();
                    let mod_count = repo_json.get("mods").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
                    let description = repo_json.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let game      = repo_json.get("game").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let author    = repo_json.get("author").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let repo_name = repo_json.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();

                    // Persist repo URL so GET /api/server-repo/list can return it
                    {
                        let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
                        let already = data.settings.connected_server_repos.iter().any(|r| r.url == probe_url);
                        if !already {
                            data.settings.connected_server_repos.push(crate::state::ConnectedServerRepo {
                                url:  probe_url.clone(),
                                name: repo_name.clone(),
                            });
                        }
                    }
                    save_data(&d, &path);

                    Ok(warp::reply::with_status(
                        warp::reply::json(&serde_json::json!({
                            "ok": true,
                            "url": probe_url,
                            "version": version,
                            "mod_count": mod_count,
                            "description": description,
                            "game": game,
                            "author": author,
                            "message": "Connected to Server Depot successfully."
                        })),
                        StatusCode::OK,
                    ))
                }
            }
        });

    // DELETE /api/mods/:id  (requires token)
    let data_del_mod = data.clone();
    let path_del_mod = data_path.clone();
    let tok_del_mod = token.clone();
    let delete_mod = warp::path!("api" / "mods" / String)
        .and(warp::delete())
        .and(require_token(tok_del_mod))
        .and(with_data(data_del_mod))
        .and(with_path(path_del_mod))
        .map(|mod_id: String, d: Arc<std::sync::Mutex<AppData>>, path: Arc<PathBuf>| {
            {
                let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
                let before = data.mods.len();
                data.mods.retain(|m| m.id != mod_id);
                if data.mods.len() == before {
                    return warp::reply::with_status(
                        warp::reply::json(&ApiError { error: format!("Mod '{}' not found", mod_id) }),
                        StatusCode::NOT_FOUND,
                    );
                }
                for profile in data.profiles.iter_mut() {
                    profile.active_mods.retain(|id| id != &mod_id);
                }
            }
            save_data(&d, &path);
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "mod_id": mod_id })),
                StatusCode::OK,
            )
        });

    // DELETE /api/profiles/:id  (requires token)
    let data_del_profile = data.clone();
    let path_del_profile = data_path.clone();
    let tok_del_profile = token.clone();
    let delete_profile = warp::path!("api" / "profiles" / String)
        .and(warp::delete())
        .and(require_token(tok_del_profile))
        .and(with_data(data_del_profile))
        .and(with_path(path_del_profile))
        .map(|profile_id: String, d: Arc<std::sync::Mutex<AppData>>, path: Arc<PathBuf>| {
            {
                let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
                let before = data.profiles.len();
                data.profiles.retain(|p| p.id != profile_id);
                if data.profiles.len() == before {
                    return warp::reply::with_status(
                        warp::reply::json(&ApiError { error: format!("Profile '{}' not found", profile_id) }),
                        StatusCode::NOT_FOUND,
                    );
                }
                if data.active_profile_id.as_deref() == Some(profile_id.as_str()) {
                    data.active_profile_id = data.profiles.first().map(|p| p.id.clone());
                }
            }
            save_data(&d, &path);
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "profile_id": profile_id })),
                StatusCode::OK,
            )
        });

    // POST /api/profiles  (create — requires token)
    let data_create_profile = data.clone();
    let path_create_profile = data_path.clone();
    let tok_create_profile = token.clone();
    let create_profile_route = warp::path!("api" / "profiles")
        .and(warp::post())
        .and(require_token(tok_create_profile))
        .and(warp::body::json::<CreateProfileBody>())
        .and(with_data(data_create_profile))
        .and(with_path(path_create_profile))
        .map(|body: CreateProfileBody, d: Arc<std::sync::Mutex<AppData>>, path: Arc<PathBuf>| {
            let profile = Profile {
                id: uuid::Uuid::new_v4().to_string(),
                name: body.name,
                game_name: body.game_name,
                game_path: PathBuf::from(&body.game_path),
                mods_path: PathBuf::from(&body.mods_path),
                backup_path: PathBuf::from(&body.backup_path),
                active_mods: Vec::new(),
                color: body.color,
                icon: body.icon,
                background_image: None,
                created_at: chrono::Local::now().to_rfc3339(),
                origin_repo_profile_id: None,
            };
            let profile_id = profile.id.clone();
            {
                let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
                data.profiles.push(profile);
            }
            save_data(&d, &path);
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "profile_id": profile_id })),
                StatusCode::CREATED,
            )
        });

    // PUT /api/profiles/:id  (update — requires token)
    let data_upd_profile = data.clone();
    let path_upd_profile = data_path.clone();
    let tok_upd_profile = token.clone();
    let update_profile = warp::path!("api" / "profiles" / String)
        .and(warp::put())
        .and(require_token(tok_upd_profile))
        .and(warp::body::json::<UpdateProfileBody>())
        .and(with_data(data_upd_profile))
        .and(with_path(path_upd_profile))
        .map(|profile_id: String, body: UpdateProfileBody, d: Arc<std::sync::Mutex<AppData>>, path: Arc<PathBuf>| {
            {
                let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
                let p = match data.profiles.iter_mut().find(|p| p.id == profile_id) {
                    Some(p) => p,
                    None => return warp::reply::with_status(
                        warp::reply::json(&ApiError { error: format!("Profile '{}' not found", profile_id) }),
                        StatusCode::NOT_FOUND,
                    ),
                };
                if let Some(v) = body.name { p.name = v; }
                if let Some(v) = body.game_name { p.game_name = v; }
                if let Some(v) = body.color { p.color = Some(v); }
                if let Some(v) = body.icon { p.icon = Some(v); }
                if let Some(v) = body.game_path { p.game_path = PathBuf::from(v); }
                if let Some(v) = body.mods_path { p.mods_path = PathBuf::from(v); }
                if let Some(v) = body.backup_path { p.backup_path = PathBuf::from(v); }
            }
            save_data(&d, &path);
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "profile_id": profile_id })),
                StatusCode::OK,
            )
        });

    // PUT /api/mods/:id  (update details — requires token)
    let data_upd_mod = data.clone();
    let path_upd_mod = data_path.clone();
    let tok_upd_mod = token.clone();
    let update_mod = warp::path!("api" / "mods" / String)
        .and(warp::put())
        .and(require_token(tok_upd_mod))
        .and(warp::body::json::<UpdateModBody>())
        .and(with_data(data_upd_mod))
        .and(with_path(path_upd_mod))
        .map(|mod_id: String, body: UpdateModBody, d: Arc<std::sync::Mutex<AppData>>, path: Arc<PathBuf>| {
            {
                let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
                let m = match data.mods.iter_mut().find(|m| m.id == mod_id) {
                    Some(m) => m,
                    None => return warp::reply::with_status(
                        warp::reply::json(&ApiError { error: format!("Mod '{}' not found", mod_id) }),
                        StatusCode::NOT_FOUND,
                    ),
                };
                if let Some(v) = body.name { m.name = v; }
                if let Some(v) = body.version { m.version = v; }
                if let Some(v) = body.author { m.author = Some(v); }
                if let Some(v) = body.description { m.description = Some(v); }
                if let Some(v) = body.tags { m.tags = v; }
                if let Some(v) = body.install_notes { m.install_notes = v; }
            }
            save_data(&d, &path);
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "mod_id": mod_id })),
                StatusCode::OK,
            )
        });

    // GET /api/check-update  (public, no token required)
    let check_update = warp::path!("api" / "check-update")
        .and(warp::get())
        .and_then(|| async move {
            let current = env!("CARGO_PKG_VERSION");
            let client = match reqwest::Client::builder()
                .user_agent("BetterModManager")
                .timeout(std::time::Duration::from_secs(10))
                .build()
            {
                Ok(c) => c,
                Err(e) => return Ok::<_, warp::Rejection>(warp::reply::with_status(
                    warp::reply::json(&ApiError { error: format!("HTTP client error: {}", e) }),
                    StatusCode::INTERNAL_SERVER_ERROR,
                )),
            };
            let resp = client
                .get("https://api.github.com/repos/FreeProject089/BetterModsManager/releases/latest")
                .send().await;
            let body: serde_json::Value = match resp {
                Ok(r) if r.status().is_success() => r.json().await.unwrap_or(serde_json::Value::Null),
                Ok(r) => return Ok(warp::reply::with_status(
                    warp::reply::json(&ApiError { error: format!("GitHub returned {}", r.status()) }),
                    StatusCode::BAD_GATEWAY,
                )),
                Err(e) => return Ok(warp::reply::with_status(
                    warp::reply::json(&ApiError { error: format!("Network error: {}", e) }),
                    StatusCode::BAD_GATEWAY,
                )),
            };
            let latest = body["tag_name"].as_str().unwrap_or("").trim_start_matches('v').to_string();
            let has_update = semver_is_newer(&latest, current);
            Ok(warp::reply::with_status(
                warp::reply::json(&serde_json::json!({
                    "ok": true,
                    "has_update": has_update,
                    "current_version": current,
                    "latest_version": latest,
                    "release_url": body["html_url"].as_str().unwrap_or(""),
                    "release_notes": body["body"].as_str().unwrap_or(""),
                })),
                StatusCode::OK,
            ))
        });

    // POST /api/restart  (requires token)
    let tok_restart = token.clone();
    let restart = warp::path!("api" / "restart")
        .and(warp::post())
        .and(require_token(tok_restart))
        .map(|| {
            let exe = std::env::current_exe().ok();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(300));
                if let Some(exe_path) = exe {
                    let _ = std::process::Command::new(exe_path).spawn();
                }
                std::process::exit(0);
            });
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "message": "Restarting BMM..." })),
                StatusCode::OK,
            )
        });

    // POST /api/server-repo/sync  (requires token)
    // Full configurable Server Repo sync: fetch repo.json, download mods, optionally clean extras.
    // sync_mode: "all" (default) | "active" (profile's active mods) | "selected" (mod_ids list)
    let tok_sr_sync = token.clone();
    let data_sr_sync = data.clone();
    let path_sr_sync = data_path.clone();
    let server_repo_sync = warp::path!("api" / "server-repo" / "sync")
        .and(warp::post())
        .and(require_token(tok_sr_sync))
        .and(warp::body::json::<ServerRepoSyncBody>())
        .and(with_data(data_sr_sync))
        .and(with_path(path_sr_sync))
        .and_then(|body: ServerRepoSyncBody, d: Arc<std::sync::Mutex<AppData>>, _path: Arc<PathBuf>| async move {
            if body.url.is_empty() {
                return Ok::<_, warp::Rejection>(warp::reply::with_status(
                    warp::reply::json(&ApiError { error: "url is required".into() }),
                    StatusCode::BAD_REQUEST,
                ));
            }

            let mut raw = body.url.trim().to_string();
            if !raw.starts_with("http://") && !raw.starts_with("https://") {
                raw = format!("https://{}", raw);
            }
            let repo_url = if raw.to_lowercase().ends_with("repo.json") { raw.clone() }
                else if raw.ends_with('/') { format!("{}repo.json", raw) }
                else { format!("{}/repo.json", raw) };
            let base_url = repo_url[..repo_url.len() - "repo.json".len()].to_string();

            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .user_agent("BetterModsManager/1.0")
                .build()
                .map_err(|_| warp::reject::reject())?;

            let repo_data: serde_json::Value = match client.get(&repo_url).send().await {
                Ok(r) if r.status().is_success() => r.json().await.unwrap_or(serde_json::Value::Null),
                Ok(r) => return Ok(warp::reply::with_status(
                    warp::reply::json(&ApiError { error: format!("Server returned {}", r.status()) }),
                    StatusCode::BAD_GATEWAY,
                )),
                Err(e) => return Ok(warp::reply::with_status(
                    warp::reply::json(&ApiError { error: format!("Cannot reach server: {}", e) }),
                    StatusCode::BAD_GATEWAY,
                )),
            };

            let repo_mods = repo_data["mods"].as_array().cloned().unwrap_or_default();

            // Resolve mods_dir: explicit param → active/specified profile → error
            let mods_dir = {
                if let Some(ref dir) = body.mods_dir {
                    PathBuf::from(dir)
                } else {
                    let data = d.lock().unwrap_or_else(|p| p.into_inner());
                    let pid = body.profile_id.as_ref().cloned()
                        .or_else(|| data.active_profile_id.clone());
                    match pid.and_then(|id| data.profiles.iter().find(|p| p.id == id).map(|p| p.mods_path.clone())) {
                        Some(p) => p,
                        None => return Ok(warp::reply::with_status(
                            warp::reply::json(&ApiError { error: "mods_dir required (no active profile)".into() }),
                            StatusCode::BAD_REQUEST,
                        )),
                    }
                }
            };

            // Collect active mod names (for "active" sync mode)
            let active_mod_names: Vec<String> = {
                let data = d.lock().unwrap_or_else(|p| p.into_inner());
                let pid = body.profile_id.as_ref().cloned()
                    .or_else(|| data.active_profile_id.clone());
                pid.and_then(|id| data.profiles.iter().find(|p| p.id == id).cloned())
                    .map(|prof| prof.active_mods.iter()
                        .filter_map(|mid| data.mods.iter().find(|m| &m.id == mid)
                            .map(|m| m.name.to_lowercase()))
                        .collect())
                    .unwrap_or_default()
            };

            let sync_mode = body.sync_mode.clone().unwrap_or_else(|| "all".to_string());
            let selected_ids = body.mod_ids.clone().unwrap_or_default();

            let mods_to_dl: Vec<(String, String)> = repo_mods.iter().filter_map(|m| {
                let name = m["name"].as_str().unwrap_or("").to_string();
                let file = m["file"].as_str().unwrap_or("").trim_start_matches('/').to_string();
                if file.is_empty() { return None; }
                let include = match sync_mode.as_str() {
                    "selected" => selected_ids.iter().any(|sel| {
                        m["id"].as_str().map(|id| id == sel).unwrap_or(false)
                            || name.to_lowercase() == sel.to_lowercase()
                    }),
                    "active" => active_mod_names.contains(&name.to_lowercase()),
                    _ => true,
                };
                if include { Some((name, file)) } else { None }
            }).collect();

            let mods_count = mods_to_dl.len();
            let clean_extras = body.clean_extras.unwrap_or(false);
            let dl_limit_kbps = body.download_limit.unwrap_or(0);
            let repo_files: Vec<String> = repo_mods.iter()
                .filter_map(|m| m["file"].as_str().map(|f| f.trim_start_matches('/').to_string()))
                .collect();

            tokio::spawn(async move {
                let dl_client = match reqwest::Client::builder()
                    .user_agent("BetterModsManager/1.0")
                    .build() { Ok(c) => c, Err(_) => return };

                let _ = std::fs::create_dir_all(&mods_dir);

                for (mod_name, mod_file) in &mods_to_dl {
                    let url = format!("{}mods/{}", base_url, mod_file);
                    let dest = mods_dir.join(mod_file);
                    if dest.exists() { continue; }
                    if let Some(parent) = dest.parent() { let _ = std::fs::create_dir_all(parent); }

                    let bytes = match dl_client.get(&url).send().await {
                        Ok(r) if r.status().is_success() => match r.bytes().await {
                            Ok(b) => b,
                            Err(e) => {
                                crate::commands::crash::log_line(format!("[PLUGIN-API] Sync read error {}: {}", mod_name, e));
                                continue;
                            }
                        },
                        Ok(r) => {
                            crate::commands::crash::log_line(format!("[PLUGIN-API] Sync HTTP {} for {}", r.status(), mod_name));
                            continue;
                        }
                        Err(e) => {
                            crate::commands::crash::log_line(format!("[PLUGIN-API] Sync download error {}: {}", mod_name, e));
                            continue;
                        }
                    };

                    if dl_limit_kbps > 0 {
                        let chunk_size = (dl_limit_kbps as usize) * 1024;
                        let mut written = 0usize;
                        let mut first = true;
                        while written < bytes.len() {
                            let end = (written + chunk_size).min(bytes.len());
                            let _ = if first {
                                std::fs::write(&dest, &bytes[written..end])
                            } else {
                                use std::io::Write;
                                std::fs::OpenOptions::new().append(true).open(&dest)
                                    .and_then(|mut f| f.write_all(&bytes[written..end]).map(|_| ()))
                            };
                            first = false;
                            written = end;
                            if written < bytes.len() {
                                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                            }
                        }
                    } else {
                        let _ = std::fs::write(&dest, &bytes);
                    }
                    crate::commands::crash::log_line(format!("[PLUGIN-API] Sync downloaded: {}", mod_name));
                }

                if clean_extras {
                    if let Ok(entries) = std::fs::read_dir(&mods_dir) {
                        for entry in entries.flatten() {
                            let fname = entry.file_name().to_string_lossy().to_string();
                            if !repo_files.contains(&fname) {
                                let p = entry.path();
                                let _ = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
                            }
                        }
                    }
                }
            });

            Ok(warp::reply::with_status(
                warp::reply::json(&serde_json::json!({
                    "ok": true,
                    "started": true,
                    "url": repo_url,
                    "mods_queued": mods_count,
                    "sync_mode": sync_mode,
                })),
                StatusCode::OK,
            ))
        });

    // GET /api/modpacks — list all LocalModpacks
    let data_mp_list = data.clone();
    let get_modpacks = warp::path!("api" / "modpacks")
        .and(warp::get())
        .and(with_data(data_mp_list))
        .map(|d: Arc<std::sync::Mutex<AppData>>| {
            let data = d.lock().unwrap_or_else(|p| p.into_inner());
            warp::reply::json(&serde_json::json!({ "ok": true, "data": data.modpacks }))
        });

    // POST /api/modpacks/create — create a new LocalModpack snapshot (requires token)
    let data_mp_create = data.clone();
    let path_mp_create = data_path.clone();
    let tok_mp_create = token.clone();
    let create_modpack = warp::path!("api" / "modpacks" / "create")
        .and(warp::post())
        .and(require_token(tok_mp_create))
        .and(warp::body::json::<CreateModpackRealBody>())
        .and(with_data(data_mp_create))
        .and(with_path(path_mp_create))
        .map(|body: CreateModpackRealBody, d: Arc<std::sync::Mutex<AppData>>, path: Arc<PathBuf>| {
            let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
            // Resolve source profile
            let source = body.source_profile_id.as_ref()
                .and_then(|id| data.profiles.iter().find(|p| &p.id == id).cloned())
                .or_else(|| data.active_profile_id.as_ref()
                    .and_then(|id| data.profiles.iter().find(|p| &p.id == id).cloned()));

            // Build mod refs from source profile's active_mods
            let mods_refs: Vec<crate::models::modpack::ModpackModRef> = source.as_ref()
                .map(|profile| {
                    profile.active_mods.iter().filter_map(|mid| {
                        data.mods.iter().find(|m| &m.id == mid).map(|m| {
                            crate::models::modpack::ModpackModRef {
                                mod_id: m.id.clone(),
                                mod_name: m.name.clone(),
                                mod_version: m.version.clone(),
                                profile_id: Some(profile.id.clone()),
                                profile_name: Some(profile.name.clone()),
                                sha256: m.content_id.clone().unwrap_or_default(),
                                file_manifest: vec![],
                                include_dependencies: false,
                                download_link: None,
                                fallback_link: None,
                                fallback_type: None,
                            }
                        })
                    }).collect()
                })
                .unwrap_or_default();

            let now = chrono::Local::now().to_rfc3339();
            let new_id = uuid::Uuid::new_v4().to_string();
            let mod_count = mods_refs.len();
            let modpack = crate::models::modpack::LocalModpack {
                id: new_id.clone(),
                name: body.name,
                description: body.description,
                created_at: now.clone(),
                updated_at: now,
                multi_profile: false,
                dependency_mode: crate::models::modpack::DependencyMode::None,
                skip_integrity_check: false,
                mods: mods_refs,
                sr_link: None,
                game_name: body.game_name
                    .or_else(|| source.as_ref().map(|s| s.game_name.clone())),
            };
            data.modpacks.push(modpack);
            drop(data);
            save_data(&d, &path);
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({
                    "ok": true,
                    "modpack_id": new_id,
                    "mod_count": mod_count,
                })),
                StatusCode::CREATED,
            )
        });

    // GET /api/server-repo/list — list saved server repo URLs
    let data_sr_list = data.clone();
    let get_server_repos = warp::path!("api" / "server-repo" / "list")
        .and(warp::get())
        .and(with_data(data_sr_list))
        .map(|d: Arc<std::sync::Mutex<AppData>>| {
            let data = d.lock().unwrap_or_else(|p| p.into_inner());
            let repos: Vec<serde_json::Value> = data.settings.connected_server_repos.iter()
                .map(|r| serde_json::json!({ "url": r.url, "name": r.name }))
                .collect();
            warp::reply::json(&serde_json::json!({ "ok": true, "data": repos }))
        });

    // POST /api/server-repo/host — start a local mini server repo (requires token + host_secret)
    let tok_sr_host = token.clone();
    let server_repo_host = warp::path!("api" / "server-repo" / "host")
        .and(warp::post())
        .and(require_token(tok_sr_host))
        .and(warp::body::json::<HostServerRepoBody>())
        .and_then(|body: HostServerRepoBody| async move {
            // Special host_secret check — must not be empty
            if body.host_secret.trim().is_empty() {
                return Ok::<_, warp::Rejection>(warp::reply::with_status(
                    warp::reply::json(&ApiError { error: "host_secret is required to host a server repo".into() }),
                    StatusCode::FORBIDDEN,
                ));
            }
            let mods_path = std::path::Path::new(&body.mods_path);
            if !mods_path.exists() || !mods_path.is_dir() {
                return Ok(warp::reply::with_status(
                    warp::reply::json(&ApiError { error: format!("mods_path '{}' does not exist or is not a directory", body.mods_path) }),
                    StatusCode::BAD_REQUEST,
                ));
            }
            let port = body.port.unwrap_or(8765);
            let name = body.name.clone().unwrap_or_else(|| "BMM Server Repo".to_string());

            // Build repo.json from files in mods_path
            let mut mod_entries: Vec<serde_json::Value> = Vec::new();
            if let Ok(entries) = std::fs::read_dir(mods_path) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_file() {
                        let fname = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
                        let size = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                        let stem = p.file_stem().and_then(|n| n.to_str()).unwrap_or("").to_string();
                        mod_entries.push(serde_json::json!({
                            "id":   uuid::Uuid::new_v4().to_string(),
                            "name": stem,
                            "file": fname,
                            "size": size,
                        }));
                    }
                }
            }

            let repo_json = serde_json::json!({
                "version":     "1.0",
                "name":        name,
                "description": "Hosted via BMM API",
                "mods":        mod_entries,
            });

            // Write repo.json next to the mods
            let repo_json_path = mods_path.join("repo.json");
            if let Ok(s) = serde_json::to_string_pretty(&repo_json) {
                let _ = std::fs::write(&repo_json_path, s);
            }

            crate::commands::crash::log_line(format!(
                "[PLUGIN-API] Server repo host requested on port {} for path {:?}", port, mods_path
            ));

            Ok(warp::reply::with_status(
                warp::reply::json(&serde_json::json!({
                    "ok":          true,
                    "port":        port,
                    "mods_path":   body.mods_path,
                    "mod_count":   repo_json["mods"].as_array().map(|a| a.len()).unwrap_or(0),
                    "repo_json":   repo_json_path.to_string_lossy(),
                    "message":     format!("repo.json written. Serve the folder at http://127.0.0.1:{}/", port),
                })),
                StatusCode::OK,
            ))
        });

    // CORS headers — allow any origin (local-only, Bearer token required)
    let cors = warp::cors()
        .allow_any_origin()
        .allow_methods(vec!["GET", "POST", "PUT", "DELETE", "OPTIONS"])
        .allow_headers(vec!["Content-Type", "Authorization"]);

    let routes = health
        .or(status)
        .or(check_update)
        .or(get_mods)
        .or(get_active_mods)
        .or(get_profiles)
        .or(get_plugins)
        .or(get_creator_id_route)
        // POST routes (specific paths before wildcard :id routes)
        .or(enable_mod)
        .or(disable_mod)
        .or(activate_profile)
        .or(create_profile_route)
        .or(compare_plugin)
        .or(apply_plugin)
        .or(enable_modpack)
        .or(disable_modpack)
        .or(create_modpack)
        .or(restart)
        // server-repo (specific paths before generic sync)
        .or(server_repo_connect)
        .or(server_repo_sync)
        .or(get_server_repos)
        .or(server_repo_host)
        // modpacks list (GET, after POST create — avoids ambiguity)
        .or(get_modpacks)
        // PUT / DELETE with :id wildcards — must come after literal-path routes
        .or(update_profile)
        .or(delete_profile)
        .or(update_mod)
        .or(delete_mod)
        .with(cors)
        .recover(handle_rejection);

    let addr: SocketAddr = ([127, 0, 0, 1], API_PORT).into();

    let (_, server) = warp::serve(routes)
        .bind_with_graceful_shutdown(addr, async {
            shutdown_rx.await.ok();
        });

    crate::commands::crash::log_line(format!("[PLUGIN-API] Server started on http://127.0.0.1:{}", API_PORT));
    server.await;
    crate::commands::crash::log_line("[PLUGIN-API] Server stopped.".to_string());
}

pub fn compute_compare(
    plugin: &crate::models::plugin::InstalledPlugin,
    mods: &[crate::models::mod_entry::ModEntry],
    active_mods: &[String],
) -> crate::models::plugin::ModCompareResult {
    let modlist = match &plugin.manifest.modlist {
        Some(ml) => ml,
        None => return crate::models::plugin::ModCompareResult {
            plugin_id: plugin.manifest.id.clone(),
            plugin_name: plugin.manifest.name.clone(),
            strict: false,
            required: vec![],
            strict_extra: vec![],
            all_required_active: true,
            missing_required: 0,
        },
    };

    let mut required_entries = Vec::new();
    let mut required_ids: Vec<String> = Vec::new();
    let mut missing_required = 0;

    for req in &modlist.required_mods {
        let found_mod = mods.iter().find(|m| m.name.to_lowercase() == req.name.to_lowercase());
        let found = found_mod.is_some();
        let mod_id = found_mod.map(|m| m.id.clone());
        let active = mod_id.as_ref().map(|id| active_mods.contains(id)).unwrap_or(false);

        if let Some(ref id) = mod_id {
            required_ids.push(id.clone());
        }

        if !req.optional && (!found || !active) {
            missing_required += 1;
        }

        required_entries.push(crate::models::plugin::ModCompareEntry {
            name: req.name.clone(),
            optional: req.optional,
            found,
            active,
            mod_id,
        });
    }

    let strict_extra: Vec<String> = if modlist.strict {
        active_mods.iter()
            .filter(|id| !required_ids.contains(id))
            .filter_map(|id| mods.iter().find(|m| &m.id == id).map(|m| m.name.clone()))
            .collect()
    } else {
        vec![]
    };

    crate::models::plugin::ModCompareResult {
        plugin_id: plugin.manifest.id.clone(),
        plugin_name: plugin.manifest.name.clone(),
        strict: modlist.strict,
        required: required_entries,
        strict_extra,
        all_required_active: missing_required == 0,
        missing_required,
    }
}

fn semver_is_newer(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> {
        v.split('.').filter_map(|s| s.parse::<u32>().ok()).collect()
    };
    let l = parse(latest);
    let c = parse(current);
    for i in 0..l.len().max(c.len()) {
        let lv = l.get(i).copied().unwrap_or(0);
        let cv = c.get(i).copied().unwrap_or(0);
        if lv > cv { return true; }
        if lv < cv { return false; }
    }
    false
}

async fn handle_rejection(err: warp::Rejection) -> Result<impl warp::Reply, std::convert::Infallible> {
    if err.find::<Unauthorized>().is_some() {
        return Ok(warp::reply::with_status(
            warp::reply::json(&ApiError { error: "Unauthorized: invalid or missing token".into() }),
            StatusCode::UNAUTHORIZED,
        ));
    }
    if err.find::<warp::filters::body::BodyDeserializeError>().is_some() {
        return Ok(warp::reply::with_status(
            warp::reply::json(&ApiError { error: "Bad request: invalid or missing JSON body".into() }),
            StatusCode::BAD_REQUEST,
        ));
    }
    if err.is_not_found() {
        return Ok(warp::reply::with_status(
            warp::reply::json(&ApiError { error: "Not found".into() }),
            StatusCode::NOT_FOUND,
        ));
    }
    Ok(warp::reply::with_status(
        warp::reply::json(&ApiError { error: "Internal server error".into() }),
        StatusCode::INTERNAL_SERVER_ERROR,
    ))
}

