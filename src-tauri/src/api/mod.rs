use std::sync::Arc;
use std::net::SocketAddr;
use tokio::sync::oneshot;
use warp::Filter;
use warp::http::StatusCode;
use serde::{Deserialize, Serialize};
use crate::state::AppData;

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
struct EnableDisableModpackBody {
    profile_id: String,
}

#[derive(Deserialize)]
struct ServerRepoConnectBody {
    url: String,
}

fn with_data(
    data: Arc<std::sync::Mutex<AppData>>,
) -> impl Filter<Extract = (Arc<std::sync::Mutex<AppData>>,), Error = std::convert::Infallible> + Clone {
    warp::any().map(move || data.clone())
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
    let tok_enable = token.clone();
    let enable_mod = warp::path!("api" / "mods" / "enable")
        .and(warp::post())
        .and(require_token(tok_enable))
        .and(warp::body::json::<EnableDisableBody>())
        .and(with_data(data_enable))
        .map(|body: EnableDisableBody, d: Arc<std::sync::Mutex<AppData>>| {
            let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
            let active_id = match data.active_profile_id.clone() {
                Some(id) => id,
                None => return warp::reply::with_status(
                    warp::reply::json(&ApiError { error: "No active profile".into() }),
                    StatusCode::BAD_REQUEST,
                ),
            };
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
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "mod_id": body.mod_id })),
                StatusCode::OK,
            )
        });

    // POST /api/mods/disable  (requires token)
    let data_disable = data.clone();
    let tok_disable = token.clone();
    let disable_mod = warp::path!("api" / "mods" / "disable")
        .and(warp::post())
        .and(require_token(tok_disable))
        .and(warp::body::json::<EnableDisableBody>())
        .and(with_data(data_disable))
        .map(|body: EnableDisableBody, d: Arc<std::sync::Mutex<AppData>>| {
            let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
            let active_id = match data.active_profile_id.clone() {
                Some(id) => id,
                None => return warp::reply::with_status(
                    warp::reply::json(&ApiError { error: "No active profile".into() }),
                    StatusCode::BAD_REQUEST,
                ),
            };
            if let Some(p) = data.profiles.iter_mut().find(|p| p.id == active_id) {
                p.active_mods.retain(|id| id != &body.mod_id);
            }
            if let Some(m) = data.mods.iter_mut().find(|m| m.id == body.mod_id) {
                m.enabled = false;
            }
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "mod_id": body.mod_id })),
                StatusCode::OK,
            )
        });

    // POST /api/profiles/activate  (requires token)
    let data_profile_act = data.clone();
    let tok_profile = token.clone();
    let activate_profile = warp::path!("api" / "profiles" / "activate")
        .and(warp::post())
        .and(require_token(tok_profile))
        .and(warp::body::json::<ActivateProfileBody>())
        .and(with_data(data_profile_act))
        .map(|body: ActivateProfileBody, d: Arc<std::sync::Mutex<AppData>>| {
            let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
            let exists = data.profiles.iter().any(|p| p.id == body.profile_id);
            if !exists {
                return warp::reply::with_status(
                    warp::reply::json(&ApiError { error: format!("Profile '{}' not found", body.profile_id) }),
                    StatusCode::NOT_FOUND,
                );
            }
            data.active_profile_id = Some(body.profile_id.clone());
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
    let tok_apply = token.clone();
    let apply_plugin = warp::path!("api" / "plugins" / "apply")
        .and(warp::post())
        .and(require_token(tok_apply))
        .and(warp::body::json::<ApplyPluginBody>())
        .and(with_data(data_apply))
        .map(|body: ApplyPluginBody, d: Arc<std::sync::Mutex<AppData>>| {
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

    // POST /api/modpacks/enable  (requires token) — enables all mods belonging to a profile/modpack
    let data_mp_enable = data.clone();
    let tok_mp_enable = token.clone();
    let enable_modpack = warp::path!("api" / "modpacks" / "enable")
        .and(warp::post())
        .and(require_token(tok_mp_enable))
        .and(warp::body::json::<EnableDisableModpackBody>())
        .and(with_data(data_mp_enable))
        .map(|body: EnableDisableModpackBody, d: Arc<std::sync::Mutex<AppData>>| {
            let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
            let profile = match data.profiles.iter().find(|p| p.id == body.profile_id) {
                Some(p) => p.clone(),
                None => return warp::reply::with_status(
                    warp::reply::json(&ApiError { error: format!("Profile '{}' not found", body.profile_id) }),
                    StatusCode::NOT_FOUND,
                ),
            };
            let mod_ids = profile.active_mods.clone();
            let count = mod_ids.len();
            for m in data.mods.iter_mut() {
                if mod_ids.contains(&m.id) {
                    m.enabled = true;
                }
            }
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "profile_id": body.profile_id, "enabled_count": count })),
                StatusCode::OK,
            )
        });

    // POST /api/modpacks/disable  (requires token) — disables all mods belonging to a profile/modpack
    let data_mp_disable = data.clone();
    let tok_mp_disable = token.clone();
    let disable_modpack = warp::path!("api" / "modpacks" / "disable")
        .and(warp::post())
        .and(require_token(tok_mp_disable))
        .and(warp::body::json::<EnableDisableModpackBody>())
        .and(with_data(data_mp_disable))
        .map(|body: EnableDisableModpackBody, d: Arc<std::sync::Mutex<AppData>>| {
            let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
            let profile = match data.profiles.iter().find(|p| p.id == body.profile_id) {
                Some(p) => p.clone(),
                None => return warp::reply::with_status(
                    warp::reply::json(&ApiError { error: format!("Profile '{}' not found", body.profile_id) }),
                    StatusCode::NOT_FOUND,
                ),
            };
            let mod_ids = profile.active_mods.clone();
            let count = mod_ids.len();
            for m in data.mods.iter_mut() {
                if mod_ids.contains(&m.id) {
                    m.enabled = false;
                }
            }
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "profile_id": body.profile_id, "disabled_count": count })),
                StatusCode::OK,
            )
        });

    // POST /api/server-repo/connect  (requires token) — validate + initiate connection to a Server Depot repo
    let tok_srv_repo = token.clone();
    let server_repo_connect = warp::path!("api" / "server-repo" / "connect")
        .and(warp::post())
        .and(require_token(tok_srv_repo))
        .and(warp::body::json::<ServerRepoConnectBody>())
        .and_then(|body: ServerRepoConnectBody| async move {
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

    // CORS headers — allow any origin (local-only, Bearer token required)
    let cors = warp::cors()
        .allow_any_origin()
        .allow_methods(vec!["GET", "POST", "OPTIONS"])
        .allow_headers(vec!["Content-Type", "Authorization"]);

    let routes = health
        .or(status)
        .or(get_mods)
        .or(get_active_mods)
        .or(get_profiles)
        .or(get_plugins)
        .or(get_creator_id_route)
        .or(enable_mod)
        .or(disable_mod)
        .or(activate_profile)
        .or(compare_plugin)
        .or(apply_plugin)
        .or(enable_modpack)
        .or(disable_modpack)
        .or(server_repo_connect)
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

async fn handle_rejection(err: warp::Rejection) -> Result<impl warp::Reply, std::convert::Infallible> {
    if err.find::<Unauthorized>().is_some() {
        return Ok(warp::reply::with_status(
            warp::reply::json(&ApiError { error: "Unauthorized: invalid or missing token".into() }),
            StatusCode::UNAUTHORIZED,
        ));
    }
    Ok(warp::reply::with_status(
        warp::reply::json(&ApiError { error: "Not found".into() }),
        StatusCode::NOT_FOUND,
    ))
}

