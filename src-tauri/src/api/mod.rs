use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::net::SocketAddr;
use std::path::PathBuf;
use tokio::sync::oneshot;
use warp::Filter;
use warp::http::StatusCode;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Manager;
use crate::state::AppData;
use crate::models::profile::Profile;

pub const API_PORT: u16 = 51274;   // default — actual port is configurable in settings

/// The port the API actually bound this session (settings `api_port`, default 51274).
/// Script generators and commands read this so everything follows the setting.
static EFFECTIVE_API_PORT: std::sync::atomic::AtomicU16 = std::sync::atomic::AtomicU16::new(51274);
pub fn api_port() -> u16 { EFFECTIVE_API_PORT.load(Ordering::Relaxed) }
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

/// Per-mod override for modpack creation (download links, dependencies, etc.)
#[derive(Deserialize, Default, Clone)]
struct ModpackModOverride {
    mod_id: String,
    #[serde(default)]
    include_dependencies: bool,
    #[serde(default)]
    download_link: Option<String>,
    #[serde(default)]
    fallback_link: Option<String>,
    #[serde(default)]
    fallback_type: Option<String>,
}

#[derive(Deserialize)]
struct CreateModpackRealBody {
    name: String,
    #[serde(default)]
    description: Option<String>,
    /// Direct list of mod UUIDs to include — takes precedence over source_profile_id
    #[serde(default)]
    mod_ids: Option<Vec<String>>,
    #[serde(default)]
    source_profile_id: Option<String>,
    #[serde(default)]
    game_name: Option<String>,
    /// Optional Server Repo URL to link with this modpack
    #[serde(default)]
    sr_link: Option<String>,
    /// Support mods from multiple profiles in one modpack
    #[serde(default)]
    multi_profile: bool,
    /// Skip file integrity check when applying this modpack
    #[serde(default)]
    skip_integrity_check: bool,
    /// Dependency mode: "none" | "all" | "manual"
    #[serde(default)]
    dependency_mode: Option<String>,
    /// Per-mod download links and dependency settings
    #[serde(default)]
    mod_overrides: Option<Vec<ModpackModOverride>>,
}

/// Update an existing modpack
#[derive(Deserialize)]
struct UpdateModpackBody {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    multi_profile: Option<bool>,
    #[serde(default)]
    skip_integrity_check: Option<bool>,
    /// "none" | "all" | "manual"
    #[serde(default)]
    dependency_mode: Option<String>,
    #[serde(default)]
    sr_link: Option<String>,
    #[serde(default)]
    game_name: Option<String>,
    /// Replace the full mod list with these mod IDs (optional)
    #[serde(default)]
    mod_ids: Option<Vec<String>>,
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

// ── Repo API body types ──────────────────────────────────────────────────────

#[derive(Deserialize)]
struct RepoConnectBody {
    url: String,
    #[serde(default)]
    name: Option<String>,
}

#[derive(Deserialize)]
struct RepoRemoveBody {
    url: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ApiSyncChoice {
    repo_profile_id: String,
    #[serde(default)]
    target_local_profile_id: Option<String>,
    #[serde(default)]
    selected_mod_ids: Option<Vec<String>>,
}

fn default_dl_limit() -> u32 { 0 }

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RepoSyncBody {
    url: String,
    #[serde(default)]
    creator_id: Option<String>,
    #[serde(default)]
    game_dir: String,
    #[serde(default)]
    mods_dir: String,
    #[serde(default)]
    backup_dir: String,
    choices: Vec<ApiSyncChoice>,
    #[serde(default)]
    overwrite_all: bool,
    #[serde(default)]
    delete_extra: bool,
    #[serde(default = "default_dl_limit")]
    download_limit: u32,
}

/// POST /api/repo/gen — generate repo structure (formerly "host")
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RepoGenBody {
    profile_ids: Vec<String>,
    output_dir: String,
    author_name: String,
    #[serde(default)]
    seed: Option<String>,
    #[serde(default)]
    generate_server: bool,
    #[serde(default)]
    port: Option<u16>,
    #[serde(default)]
    upload_limit: Option<u32>,
    #[serde(default)]
    admin_password: Option<String>,
    #[serde(default)]
    use_cloudflare: bool,
    #[serde(default)]
    use_upnp: bool,
    #[serde(default)]
    auto_start: bool,
    #[serde(default)]
    enable_docker: Option<bool>,
    #[serde(default)]
    docker_host_type: Option<String>,
    #[serde(default)]
    lang: Option<String>,
    #[serde(default)]
    server_version: Option<u8>,
    #[serde(default)]
    server_type: Option<String>,
    /// Only generate repo.json manifest without copying mod files
    #[serde(default)]
    lightweight: bool,
    /// Compress output directory into a .zip archive after gen
    #[serde(default)]
    zip_output: bool,
}

/// POST /api/repo/update — incrementally update an existing repo
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RepoUpdateBody {
    repo_dir: String,
    #[serde(default)]
    author_name: Option<String>,
    #[serde(default)]
    remove_mod_ids: Vec<String>,
    #[serde(default)]
    remove_profile_ids: Vec<String>,
    /// [{ "profileId": "...", "modIds": ["...", ...] | null }]
    #[serde(default)]
    add_profiles: Vec<serde_json::Value>,
    /// { "<modId>": "changelog text" } — per-mod author changelog.
    #[serde(default)]
    mod_changelogs: serde_json::Value,
}

/// POST /api/mod/config — configure a mod's update linkage.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ModConfigBody {
    mod_id: String,
    /// Stable id of this mod inside its repo manifest. Empty clears it.
    #[serde(default)]
    repo_mod_id: Option<String>,
    /// Primary update URL (site mods). Empty clears it.
    #[serde(default)]
    update_url: Option<String>,
    /// Additional update sources: [{ "repoUrl": "...", "repoModId": "..." }].
    #[serde(default)]
    update_sources: Option<Vec<crate::models::mod_entry::UpdateSource>>,
}

/// POST /api/mod/update — request applying an update (UI-driven).
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ModUpdateApiBody {
    /// Origin repo URL to re-sync from. When omitted, just opens the update check.
    #[serde(default)]
    repo_url: Option<String>,
}

/// POST /api/repo/host — start a static HTTP file server serving a generated repo
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RepoHttpHostBody {
    /// Directory to serve (should contain repo.json and mods/)
    serve_dir: String,
    /// Port to listen on (default: 8080)
    #[serde(default)]
    port: Option<u16>,
    /// Upload limit in KB/s (informational, 0 = unlimited)
    #[serde(default)]
    #[allow(dead_code)]
    upload_limit: Option<u32>,
}

/// Shared shutdown handle for the HTTP repo host server
type HttpHostShutdown = Arc<std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>>;

fn with_data(
    data: Arc<std::sync::Mutex<AppData>>,
) -> impl Filter<Extract = (Arc<std::sync::Mutex<AppData>>,), Error = std::convert::Infallible> + Clone {
    warp::any().map(move || data.clone())
}

fn with_atomic(
    flag: Arc<AtomicBool>,
) -> impl Filter<Extract = (Arc<AtomicBool>,), Error = std::convert::Infallible> + Clone {
    warp::any().map(move || flag.clone())
}

fn with_http_host_shutdown(
    val: HttpHostShutdown,
) -> impl Filter<Extract = (HttpHostShutdown,), Error = std::convert::Infallible> + Clone {
    warp::any().map(move || val.clone())
}

fn with_path(
    path: Arc<PathBuf>,
) -> impl Filter<Extract = (Arc<PathBuf>,), Error = std::convert::Infallible> + Clone {
    warp::any().map(move || path.clone())
}

fn with_app_handle(
    handle: tauri::AppHandle,
) -> impl Filter<Extract = (tauri::AppHandle,), Error = std::convert::Infallible> + Clone {
    warp::any().map(move || handle.clone())
}

/// Optional `{ "id": "..." }` body for import/export endpoints that target a
/// specific entity (modpack id, plugin id). Empty is allowed.
#[derive(Deserialize, Clone, Default)]
struct IoIdBody {
    #[serde(default)]
    id: String,
    #[serde(default, rename = "destDir", alias = "dest_dir")]
    dest_dir: Option<String>,
}

/// Emit a `bmm://api-exec` event so the frontend performs the action through
/// the BMM interface (native importer/exporter + file dialog), then reply 202.
/// Used by all import/export endpoints so they behave "like a human in BMM".
fn api_exec_reply(handle: &tauri::AppHandle, action: &str, params: serde_json::Value) -> warp::reply::WithStatus<warp::reply::Json> {
    let _ = handle.emit_all("bmm://api-exec", serde_json::json!({ "action": action, "params": params }));
    warp::reply::with_status(
        warp::reply::json(&serde_json::json!({ "ok": true, "driven_by": "bmm-ui", "action": action })),
        StatusCode::ACCEPTED,
    )
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

/// Constant-time byte comparison (CWE-208): avoids the early-exit timing leak of
/// `==`. Comparing lengths first is acceptable here — the token length is fixed.
fn ct_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() { return false; }
    let mut diff = 0u8;
    for i in 0..a.len() { diff |= a[i] ^ b[i]; }
    diff == 0
}

fn require_token(
    data: Arc<std::sync::Mutex<AppData>>,
) -> impl Filter<Extract = (), Error = warp::Rejection> + Clone {
    warp::header::optional::<String>("authorization")
        .and_then(move |auth: Option<String>| {
            // Read the LIVE token from settings on every request so that
            // regenerating the token (reset_api_token) takes effect immediately.
            // Accept the admin token (full access) OR any issued per-plugin token
            // (CWE-862/863); the caller's identity/permissions are resolved later
            // in require_permission from the SAME token, not a spoofable header.
            let provided = auth.unwrap_or_default();
            let ok = {
                let d = data.lock().unwrap_or_else(|p| p.into_inner());
                let token = provided.strip_prefix("Bearer ").unwrap_or("");
                ct_eq(token, &d.settings.api_token)
                    || (!token.is_empty() && d.settings.plugin_tokens.contains_key(token))
            };
            async move {
                if ok {
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

/// Plugin permission gate.
/// If the request includes `X-BMM-Plugin-Id: <id>`, the plugin's permissions
/// are looked up in `plugin_permissions`. Without the header, admin access is
/// assumed (direct API calls, curl, etc.).
#[derive(Debug)]
struct PermissionDenied { required: &'static str, plugin_id: String }
impl warp::reject::Reject for PermissionDenied {}

// ── Local catalog helpers (module-level so they can be called from warp closures) ──
fn catalog_path(h: &tauri::AppHandle) -> std::path::PathBuf {
    h.path_resolver().app_data_dir().unwrap_or_default().join("apps-catalog.json")
}

fn catalog_read(h: &tauri::AppHandle) -> serde_json::Value {
    let p = catalog_path(h);
    if let Ok(s) = std::fs::read_to_string(&p) {
        serde_json::from_str(&s).unwrap_or_else(|_| catalog_empty())
    } else {
        catalog_empty()
    }
}

fn catalog_empty() -> serde_json::Value {
    serde_json::json!({"version":"1.0","name":"Local Catalog","description":"","partner_catalogs":[],"community_imports":[],"apps":[]})
}

fn catalog_write(h: &tauri::AppHandle, cat: &serde_json::Value) -> Result<(), String> {
    let p = catalog_path(h);
    if let Some(parent) = p.parent() { let _ = std::fs::create_dir_all(parent); }
    serde_json::to_string_pretty(cat).map_err(|e| e.to_string())
        .and_then(|s| std::fs::write(&p, s).map_err(|e| e.to_string()))
}

fn require_permission(
    data: Arc<std::sync::Mutex<AppData>>,
    permission: &'static str,
) -> impl Filter<Extract = (), Error = warp::Rejection> + Clone {
    // CWE-862/863: resolve the caller's identity from the BEARER TOKEN, never from
    // the spoofable `X-BMM-Plugin-Id` header. (require_token already gated this
    // route, so the token here is the admin token or a known per-plugin token.)
    warp::header::optional::<String>("authorization")
        .and_then(move |auth: Option<String>| {
            let d = data.clone();
            async move {
                let provided = auth.unwrap_or_default();
                let token = provided.strip_prefix("Bearer ").unwrap_or("");
                let data = d.lock().unwrap_or_else(|p| p.into_inner());
                // Admin token → full access (curl / CLI / MCP / in-app tester).
                if ct_eq(token, &data.settings.api_token) {
                    return Ok(());
                }
                // Per-plugin token → identity (and thus permissions) resolved from
                // the token map; the plugin cannot escalate by omitting/forging the
                // old header.
                if let Some(pid) = data.settings.plugin_tokens.get(token) {
                    let perms = data.plugin_permissions.get(pid).cloned().unwrap_or_default();
                    if perms.contains(&permission.to_string()) {
                        return Ok(());
                    }
                    return Err(warp::reject::custom(PermissionDenied {
                        required: permission,
                        plugin_id: pid.clone(),
                    }));
                }
                Err(warp::reject::custom(Unauthorized))
            }
        })
        .untuple_one()
}

pub async fn start_api_server(
    data: Arc<std::sync::Mutex<AppData>>,
    data_path: Arc<PathBuf>,
    creator_id: Arc<String>,
    shutdown_rx: oneshot::Receiver<()>,
    app_handle: tauri::AppHandle,
) {
    // Token filters now read the LIVE token from `data` per-request (see
    // require_token), so this is just a clonable handle to the shared state.
    let token = data.clone();

    // ── Concurrency guards ─────────────────────────────────────────────────────
    // Max 1 sync at a time; set true while running, false when done
    let sync_running  = Arc::new(AtomicBool::new(false));
    // Set true to request cancellation of the current sync task
    let sync_cancel   = Arc::new(AtomicBool::new(false));
    // Max 1 gen (export) at a time
    let gen_running   = Arc::new(AtomicBool::new(false));
    // Set true to request cancellation of the current gen task
    let gen_cancel    = Arc::new(AtomicBool::new(false));
    // Holds the shutdown sender for the HTTP repo host server (None = not running)
    let http_host_shutdown: HttpHostShutdown = Arc::new(std::sync::Mutex::new(None));

    // GET /api/health
    let health = warp::path!("api" / "health")
        .and(warp::get())
        .map(|| warp::reply::json(&serde_json::json!({ "ok": true, "service": "BMM Plugin API", "port": api_port() })));

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

    // GET /api/mods/all — every mod across ALL profiles, grouped by profile.
    let data_mods_all = data.clone();
    let get_mods_all = warp::path!("api" / "mods" / "all")
        .and(warp::get())
        .and(with_data(data_mods_all))
        .map(|d: Arc<std::sync::Mutex<AppData>>| {
            let data = d.lock().unwrap_or_else(|p| p.into_inner());
            let mut profiles_out: Vec<serde_json::Value> = Vec::new();
            let mut total = 0usize;
            for profile in &data.profiles {
                let mods: Vec<serde_json::Value> = data.mods.iter()
                    .filter(|m| m.mod_folder_path.starts_with(&profile.mods_path)
                        || matches!((m.mod_folder_path.canonicalize(), profile.mods_path.canonicalize()),
                            (Ok(a), Ok(b)) if a.starts_with(&b)))
                    .map(|m| serde_json::json!({ "id": m.id, "name": m.name, "version": m.version, "enabled": m.enabled }))
                    .collect();
                total += mods.len();
                profiles_out.push(serde_json::json!({
                    "profile_id": profile.id, "profile_name": profile.name,
                    "mod_count": mods.len(), "mods": mods,
                }));
            }
            warp::reply::json(&serde_json::json!({ "ok": true, "total_mods": total, "profiles": profiles_out }))
        });

    // GET /api/data — full BMM data export (the entire data.json). Auth required.
    let data_dump = data.clone(); let tok_dump = token.clone();
    let get_data_dump = warp::path!("api" / "data")
        .and(warp::get())
        .and(require_token(tok_dump))
        .and(with_data(data_dump))
        .map(|d: Arc<std::sync::Mutex<AppData>>| {
            let data = d.lock().unwrap_or_else(|p| p.into_inner());
            warp::reply::with_header(
                warp::reply::json(&*data),
                "Content-Disposition", "attachment; filename=\"bmm-data.json\"",
            )
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
        .and(require_permission(token.clone(), "mods.write"))
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
        .and(require_permission(token.clone(), "mods.write"))
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
        .and(require_permission(token.clone(), "profiles.write"))
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
        .and(require_permission(token.clone(), "plugins.read"))
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
        .and(require_permission(token.clone(), "plugins.write"))
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
        .and(require_permission(token.clone(), "modpacks.write"))
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
        .and(require_permission(token.clone(), "modpacks.write"))
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

    // DELETE /api/mods/:id  (requires token)
    let data_del_mod = data.clone();
    let path_del_mod = data_path.clone();
    let tok_del_mod = token.clone();
    let delete_mod = warp::path!("api" / "mods" / String)
        .and(warp::delete())
        .and(require_token(tok_del_mod))
        .and(require_permission(token.clone(), "mods.write"))
        .and(with_data(data_del_mod))
        .and(with_path(path_del_mod))
        .map(|mod_id: String, d: Arc<std::sync::Mutex<AppData>>, path: Arc<PathBuf>| {
            let mod_folder_path: Option<PathBuf>;
            {
                let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
                let found = data.mods.iter().find(|m| m.id == mod_id).map(|m| m.mod_folder_path.clone());
                if found.is_none() {
                    return warp::reply::with_status(
                        warp::reply::json(&ApiError { error: format!("Mod '{}' not found", mod_id) }),
                        StatusCode::NOT_FOUND,
                    );
                }
                mod_folder_path = found;
                data.mods.retain(|m| m.id != mod_id);
                // Remove from all profiles' active_mods
                for profile in data.profiles.iter_mut() {
                    profile.active_mods.retain(|id| id != &mod_id);
                }
            }
            save_data(&d, &path);
            // Delete actual mod folder from disk
            let mut deleted_folder = false;
            if let Some(folder) = &mod_folder_path {
                if folder.exists() {
                    deleted_folder = std::fs::remove_dir_all(folder).is_ok();
                }
            }
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({
                    "ok": true,
                    "mod_id": mod_id,
                    "folder_deleted": deleted_folder,
                    "folder_path": mod_folder_path.as_ref().map(|p| p.to_string_lossy().to_string()),
                })),
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
        .and(require_permission(token.clone(), "profiles.write"))
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
        .and(require_permission(token.clone(), "profiles.write"))
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
                icon_image: None,
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
        .and(require_permission(token.clone(), "profiles.write"))
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
        .and(require_permission(token.clone(), "mods.write"))
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

    // POST /api/mod/config  (auth) — configure a mod's update linkage.
    let tok_mod_cfg = token.clone();
    let data_mod_cfg = data.clone();
    let path_mod_cfg = data_path.clone();
    let mod_config = warp::path!("api" / "mod" / "config")
        .and(warp::post())
        .and(require_token(tok_mod_cfg))
        .and(require_permission(token.clone(), "mods.write"))
        .and(warp::body::json::<ModConfigBody>())
        .and(with_data(data_mod_cfg))
        .and(with_path(path_mod_cfg))
        .map(|body: ModConfigBody, d: Arc<std::sync::Mutex<AppData>>, path: Arc<PathBuf>| {
            {
                let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
                let m = match data.mods.iter_mut().find(|m| m.id == body.mod_id) {
                    Some(m) => m,
                    None => return warp::reply::with_status(
                        warp::reply::json(&ApiError { error: format!("Mod '{}' not found", body.mod_id) }),
                        StatusCode::NOT_FOUND,
                    ),
                };
                if let Some(rid) = body.repo_mod_id {
                    let t = rid.trim();
                    m.repo_mod_id = if t.is_empty() { None } else { Some(t.to_string()) };
                }
                if let Some(url) = body.update_url {
                    let t = url.trim();
                    m.update_url = if t.is_empty() { None } else { Some(crate::commands::repo::normalize_repo_url(t)) };
                }
                if let Some(srcs) = body.update_sources {
                    m.update_sources = srcs.into_iter()
                        .filter(|s| !s.repo_url.trim().is_empty())
                        .map(|mut s| {
                            s.repo_url = crate::commands::repo::normalize_repo_url(&s.repo_url);
                            s.repo_mod_id = s.repo_mod_id.filter(|r| !r.trim().is_empty());
                            s
                        })
                        .collect();
                }
            }
            save_data(&d, &path);
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "mod_id": body.mod_id })),
                StatusCode::OK,
            )
        });

    // POST /api/mod/check-updates  (auth) — run an update check (UI-driven).
    let tok_mod_check = token.clone();
    let handle_mod_check = app_handle.clone();
    let mod_check_updates = warp::path!("api" / "mod" / "check-updates")
        .and(warp::post())
        .and(require_token(tok_mod_check))
        .and(with_app_handle(handle_mod_check))
        .map(|handle: tauri::AppHandle| {
            let _ = handle.emit_all("bmm://api-exec", serde_json::json!({
                "action": "mod/check-updates", "params": {}
            }));
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({
                    "ok": true, "driven_by": "bmm-ui", "action": "mod/check-updates"
                })),
                StatusCode::ACCEPTED,
            )
        });

    // POST /api/mod/update  (auth) — apply an update (UI-driven, delta re-sync).
    let tok_mod_update = token.clone();
    let handle_mod_update = app_handle.clone();
    let mod_update = warp::path!("api" / "mod" / "update")
        .and(warp::post())
        .and(require_token(tok_mod_update))
        .and(warp::body::json::<ModUpdateApiBody>())
        .and(with_app_handle(handle_mod_update))
        .map(|body: ModUpdateApiBody, handle: tauri::AppHandle| {
            let _ = handle.emit_all("bmm://api-exec", serde_json::json!({
                "action": "mod/update",
                "params": { "repoUrl": body.repo_url }
            }));
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({
                    "ok": true, "driven_by": "bmm-ui", "action": "mod/update"
                })),
                StatusCode::ACCEPTED,
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
        .and(require_permission(token.clone(), "modpacks.write"))
        .and(warp::body::json::<CreateModpackRealBody>())
        .and(with_data(data_mp_create))
        .and(with_path(path_mp_create))
        .map(|body: CreateModpackRealBody, d: Arc<std::sync::Mutex<AppData>>, path: Arc<PathBuf>| {
            let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
            // Resolve source profile (used for mod list and metadata inheritance)
            let source = body.source_profile_id.as_ref()
                .and_then(|id| data.profiles.iter().find(|p| &p.id == id).cloned())
                .or_else(|| data.active_profile_id.as_ref()
                    .and_then(|id| data.profiles.iter().find(|p| &p.id == id).cloned()));

            // Build mod refs: use explicit mod_ids if provided, otherwise fall back to source profile
            let mods_refs: Vec<crate::models::modpack::ModpackModRef> = if let Some(ref explicit_ids) = body.mod_ids {
                // Explicit mod_ids take precedence
                let src_profile_id   = source.as_ref().map(|s| s.id.clone());
                let src_profile_name = source.as_ref().map(|s| s.name.clone());
                explicit_ids.iter().filter_map(|mid| {
                    data.mods.iter().find(|m| &m.id == mid).map(|m| {
                        crate::models::modpack::ModpackModRef {
                            mod_id: m.id.clone(),
                            mod_name: m.name.clone(),
                            mod_version: m.version.clone(),
                            profile_id: src_profile_id.clone(),
                            profile_name: src_profile_name.clone(),
                            sha256: m.content_id.clone().unwrap_or_default(),
                            file_manifest: vec![],
                            include_dependencies: false,
                            download_link: None,
                            fallback_link: None,
                            fallback_type: None,
                        }
                    })
                }).collect()
            } else {
                // Fall back to source profile's active_mods
                source.as_ref()
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
                    .unwrap_or_default()
            };

            // Parse dependency mode
            let dep_mode = match body.dependency_mode.as_deref() {
                Some("all")    => crate::models::modpack::DependencyMode::All,
                Some("manual") => crate::models::modpack::DependencyMode::Manual,
                _              => crate::models::modpack::DependencyMode::None,
            };

            // Apply per-mod overrides (download links, include_dependencies)
            let mods_refs: Vec<crate::models::modpack::ModpackModRef> = if let Some(ref overrides) = body.mod_overrides {
                mods_refs.into_iter().map(|mut mr| {
                    if let Some(ov) = overrides.iter().find(|o| o.mod_id == mr.mod_id) {
                        mr.include_dependencies = ov.include_dependencies;
                        if ov.download_link.is_some() { mr.download_link = ov.download_link.clone(); }
                        if ov.fallback_link.is_some()  { mr.fallback_link  = ov.fallback_link.clone(); }
                        if ov.fallback_type.is_some()  { mr.fallback_type  = ov.fallback_type.clone(); }
                    }
                    mr
                }).collect()
            } else { mods_refs };

            let now = chrono::Local::now().to_rfc3339();
            let new_id = uuid::Uuid::new_v4().to_string();
            let mod_count = mods_refs.len();
            let modpack = crate::models::modpack::LocalModpack {
                id: new_id.clone(),
                name: body.name,
                description: body.description,
                created_at: now.clone(),
                updated_at: now,
                multi_profile: body.multi_profile,
                dependency_mode: dep_mode,
                skip_integrity_check: body.skip_integrity_check,
                mods: mods_refs,
                sr_link: body.sr_link,
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

    // ── Repo API routes ──────────────────────────────────────────────────────

    // GET /api/repo/info?url=<url>  (no auth)
    let repo_info = warp::path!("api" / "repo" / "info")
        .and(warp::get())
        .and(warp::query::<std::collections::HashMap<String, String>>())
        .and_then(|query: std::collections::HashMap<String, String>| async move {
            let url = match query.get("url") {
                Some(u) if !u.is_empty() => u.clone(),
                _ => return Ok::<_, warp::Rejection>(warp::reply::with_status(
                    warp::reply::json(&ApiError { error: "url query param required".into() }),
                    StatusCode::BAD_REQUEST,
                )),
            };
            let target = if url.ends_with("repo.json") { url.clone() }
                         else { format!("{}/repo.json", url.trim_end_matches('/')) };
            let client = match reqwest::Client::builder()
                .user_agent("BetterModManager")
                .timeout(std::time::Duration::from_secs(15))
                .build() {
                Ok(c) => c,
                Err(e) => return Ok(warp::reply::with_status(
                    warp::reply::json(&ApiError { error: format!("HTTP client error: {}", e) }),
                    StatusCode::INTERNAL_SERVER_ERROR,
                )),
            };
            match client.get(&target).send().await {
                Ok(r) if r.status().is_success() => {
                    match r.json::<serde_json::Value>().await {
                        Ok(repo) => Ok(warp::reply::with_status(
                            warp::reply::json(&serde_json::json!({ "ok": true, "data": repo })),
                            StatusCode::OK,
                        )),
                        Err(e) => Ok(warp::reply::with_status(
                            warp::reply::json(&ApiError { error: format!("Invalid repo.json: {}", e) }),
                            StatusCode::BAD_GATEWAY,
                        )),
                    }
                },
                Ok(r) if r.status() == reqwest::StatusCode::FORBIDDEN => Ok(warp::reply::with_status(
                    warp::reply::json(&ApiError { error: "Access denied (403)".into() }),
                    StatusCode::FORBIDDEN,
                )),
                Ok(r) => Ok(warp::reply::with_status(
                    warp::reply::json(&ApiError { error: format!("Remote returned {}", r.status()) }),
                    StatusCode::BAD_GATEWAY,
                )),
                Err(e) => Ok(warp::reply::with_status(
                    warp::reply::json(&ApiError { error: format!("Network error: {}", e) }),
                    StatusCode::BAD_GATEWAY,
                )),
            }
        });

    // POST /api/repo/connect  (auth)
    let data_repo_connect = data.clone();
    let path_repo_connect = data_path.clone();
    let tok_repo_connect = token.clone();
    let repo_connect = warp::path!("api" / "repo" / "connect")
        .and(warp::post())
        .and(require_token(tok_repo_connect))
        .and(require_permission(token.clone(), "repo.write"))
        .and(warp::body::json::<RepoConnectBody>())
        .and(with_data(data_repo_connect))
        .and(with_path(path_repo_connect))
        .and_then(|body: RepoConnectBody, d: Arc<std::sync::Mutex<AppData>>, path: Arc<PathBuf>| async move {
            let url = body.url.trim().to_string();
            if url.is_empty() {
                return Ok::<_, warp::Rejection>(warp::reply::with_status(
                    warp::reply::json(&ApiError { error: "url required".into() }),
                    StatusCode::BAD_REQUEST,
                ));
            }
            let target = if url.ends_with("repo.json") { url.clone() }
                         else { format!("{}/repo.json", url.trim_end_matches('/')) };
            let repo_name = match body.name.filter(|n| !n.trim().is_empty()) {
                Some(n) => n,
                None => match reqwest::Client::builder()
                    .user_agent("BetterModManager")
                    .timeout(std::time::Duration::from_secs(8))
                    .build()
                {
                    Ok(client) => match client.get(&target).send().await {
                        Ok(r) if r.status().is_success() => {
                            let j: serde_json::Value = r.json().await.unwrap_or_default();
                            j["name"].as_str().unwrap_or(&url).to_string()
                        },
                        _ => url.clone(),
                    },
                    Err(_) => url.clone(),
                },
            };
            {
                let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
                if !data.settings.connected_server_repos.iter().any(|r| r.url == url) {
                    data.settings.connected_server_repos.push(crate::state::ConnectedServerRepo {
                        url: url.clone(),
                        name: repo_name.clone(),
                    });
                }
            }
            save_data(&d, &path);
            Ok(warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "url": url, "name": repo_name })),
                StatusCode::OK,
            ))
        });

    // GET /api/repo/list  (no auth)
    let data_repo_list = data.clone();
    let repo_list = warp::path!("api" / "repo" / "list")
        .and(warp::get())
        .and(with_data(data_repo_list))
        .map(|d: Arc<std::sync::Mutex<AppData>>| {
            let data = d.lock().unwrap_or_else(|p| p.into_inner());
            warp::reply::json(&serde_json::json!({
                "ok": true,
                "data": data.settings.connected_server_repos,
            }))
        });

    // DELETE /api/repo  (auth, body: {url})
    let data_repo_remove = data.clone();
    let path_repo_remove = data_path.clone();
    let tok_repo_remove = token.clone();
    let repo_remove = warp::path!("api" / "repo")
        .and(warp::delete())
        .and(require_token(tok_repo_remove))
        .and(require_permission(token.clone(), "repo.write"))
        .and(warp::body::json::<RepoRemoveBody>())
        .and(with_data(data_repo_remove))
        .and(with_path(path_repo_remove))
        .map(|body: RepoRemoveBody, d: Arc<std::sync::Mutex<AppData>>, path: Arc<PathBuf>| {
            let (removed, url) = {
                let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
                let before = data.settings.connected_server_repos.len();
                data.settings.connected_server_repos.retain(|r| r.url != body.url);
                let removed = data.settings.connected_server_repos.len() < before;
                (removed, body.url.clone())
            };
            if !removed {
                return warp::reply::with_status(
                    warp::reply::json(&ApiError { error: format!("Repo '{}' not found in connected list", url) }),
                    StatusCode::NOT_FOUND,
                );
            }
            save_data(&d, &path);
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "url": url })),
                StatusCode::OK,
            )
        });

    // DELETE /api/repo/sync/cancel  (auth) — MUST be registered before POST /api/repo/sync
    let tok_sync_cancel    = token.clone();
    let sync_cancel_cancel = sync_cancel.clone();
    let sync_running_cancel = sync_running.clone();
    let repo_sync_cancel = warp::path!("api" / "repo" / "sync" / "cancel")
        .and(warp::delete())
        .and(require_token(tok_sync_cancel))
        .and(with_atomic(sync_cancel_cancel))
        .and(with_atomic(sync_running_cancel))
        .map(|cancel: Arc<AtomicBool>, running: Arc<AtomicBool>| {
            if !running.load(Ordering::SeqCst) {
                return warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({ "ok": false, "message": "No sync is currently running" })),
                    StatusCode::OK,
                );
            }
            cancel.store(true, Ordering::SeqCst);
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "message": "Cancel signal sent — sync will stop at next checkpoint" })),
                StatusCode::OK,
            )
        });

    // POST /api/repo/sync  (auth, max 1 concurrent) — background download task
    let data_repo_sync    = data.clone();
    let path_repo_sync    = data_path.clone();
    let tok_repo_sync     = token.clone();
    let handle_repo_sync  = app_handle.clone();
    let sync_running_sync = sync_running.clone();
    let sync_cancel_sync  = sync_cancel.clone();
    let repo_sync = warp::path!("api" / "repo" / "sync")
        .and(warp::post())
        .and(require_token(tok_repo_sync))
        .and(require_permission(token.clone(), "repo.write"))
        .and(warp::body::json::<RepoSyncBody>())
        .and(with_data(data_repo_sync))
        .and(with_path(path_repo_sync))
        .and(with_app_handle(handle_repo_sync))
        .and(with_atomic(sync_running_sync))
        .and(with_atomic(sync_cancel_sync))
        .map(|body: RepoSyncBody, _d: Arc<std::sync::Mutex<AppData>>, _path: Arc<PathBuf>, handle: tauri::AppHandle, _running: Arc<AtomicBool>, _cancel: Arc<AtomicBool>| {
            // Reject if a sync is already in progress.
            {
                let st = handle.state::<crate::commands::repo_server::RepoServerState>();
                if st.sync_busy.load(std::sync::atomic::Ordering::SeqCst) {
                    let reason = "A repo sync is already in progress.";
                    let _ = handle.emit_all("bmm://api-rejected", serde_json::json!({
                        "action": "repo/sync", "reason": reason, "code": 409
                    }));
                    return warp::reply::with_status(
                        warp::reply::json(&ApiError { error: reason.into() }),
                        StatusCode::CONFLICT,
                    );
                }
            }
            // Drive the sync through the BMM interface — exactly as if a human
            // filled the Server Repo sync form and clicked "Sync" — instead of
            // running it headless in the background.
            let choices: Vec<serde_json::Value> = body.choices.iter().map(|c| serde_json::json!({
                "repoProfileId": c.repo_profile_id,
                "targetLocalProfileId": c.target_local_profile_id,
            })).collect();
            let _ = handle.emit_all("bmm://api-exec", serde_json::json!({
                "action": "repo/sync",
                "params": {
                    "url": body.url,
                    "gameDir": body.game_dir,
                    "modsDir": body.mods_dir,
                    "backupDir": body.backup_dir,
                    "overwriteAll": body.overwrite_all,
                    "deleteExtra": body.delete_extra,
                    "downloadLimit": body.download_limit,
                    "choices": choices,
                }
            }));
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({
                    "ok": true,
                    "driven_by": "bmm-ui",
                    "message": "Sync requested through the BMM interface.",
                })),
                StatusCode::ACCEPTED,
            )
        });

    // DELETE /api/repo/gen/cancel  (auth)
    let tok_gen_cancel     = token.clone();
    let gen_cancel_cancel  = gen_cancel.clone();
    let gen_running_cancel = gen_running.clone();
    let repo_gen_cancel = warp::path!("api" / "repo" / "gen" / "cancel")
        .and(warp::delete())
        .and(require_token(tok_gen_cancel))
        .and(with_atomic(gen_cancel_cancel))
        .and(with_atomic(gen_running_cancel))
        .map(|cancel: Arc<AtomicBool>, running: Arc<AtomicBool>| {
            if !running.load(Ordering::SeqCst) {
                return warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({ "ok": false, "message": "No gen/export is currently running" })),
                    StatusCode::OK,
                );
            }
            cancel.store(true, Ordering::SeqCst);
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "message": "Cancel signal sent — gen will stop at next checkpoint" })),
                StatusCode::OK,
            )
        });

    // POST /api/repo/gen  (auth, max 1 concurrent) — generate repo structure (formerly "host")
    let data_repo_gen   = data.clone();
    let tok_repo_gen    = token.clone();
    let handle_repo_gen = app_handle.clone();
    let gen_running_gen = gen_running.clone();
    let gen_cancel_gen  = gen_cancel.clone();
    let repo_gen = warp::path!("api" / "repo" / "gen")
        .and(warp::post())
        .and(require_token(tok_repo_gen))
        .and(require_permission(token.clone(), "repo.write"))
        .and(warp::body::json::<RepoGenBody>())
        .and(with_data(data_repo_gen))
        .and(with_app_handle(handle_repo_gen))
        .and(with_atomic(gen_running_gen))
        .and(with_atomic(gen_cancel_gen))
        .map(|body: RepoGenBody, _d: Arc<std::sync::Mutex<AppData>>, handle: tauri::AppHandle, _running: Arc<AtomicBool>, _cancel: Arc<AtomicBool>| {
            // Reject if a generation/export is already in progress.
            {
                let st = handle.state::<crate::commands::repo_server::RepoServerState>();
                if st.gen_busy.load(std::sync::atomic::Ordering::SeqCst) {
                    let reason = "A repo generation is already in progress.";
                    let _ = handle.emit_all("bmm://api-rejected", serde_json::json!({
                        "action": "repo/gen", "reason": reason, "code": 409
                    }));
                    return warp::reply::with_status(
                        warp::reply::json(&ApiError { error: reason.into() }),
                        StatusCode::CONFLICT,
                    );
                }
            }
            // Drive the export/gen through the BMM interface (Server Repo page),
            // as if a human filled the export form — instead of running headless.
            let _ = handle.emit_all("bmm://api-exec", serde_json::json!({
                "action": "repo/gen",
                "params": {
                    "profileIds": body.profile_ids,
                    "outputDir": body.output_dir,
                    "authorName": body.author_name,
                    "seed": body.seed,
                    "port": body.port,
                    "uploadLimit": body.upload_limit,
                    "adminPassword": body.admin_password,
                    "useCloudflare": body.use_cloudflare,
                    "useUpnp": body.use_upnp,
                    "autoStart": body.auto_start,
                    "generateServer": body.generate_server,
                    "zipOutput": body.zip_output,
                }
            }));
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({
                    "ok": true,
                    "driven_by": "bmm-ui",
                    "message": "Repo export requested through the BMM interface.",
                })),
                StatusCode::ACCEPTED,
            )
        });

    // POST /api/repo/update  (auth) — incrementally update an existing repo
    let tok_repo_update    = token.clone();
    let handle_repo_update = app_handle.clone();
    let repo_update = warp::path!("api" / "repo" / "update")
        .and(warp::post())
        .and(require_token(tok_repo_update))
        .and(warp::body::json::<RepoUpdateBody>())
        .and(with_app_handle(handle_repo_update))
        .map(|body: RepoUpdateBody, handle: tauri::AppHandle| {
            // Drive through the BMM interface (same UI-driven pattern as repo/gen)
            let _ = handle.emit_all("bmm://api-exec", serde_json::json!({
                "action": "repo/update",
                "params": {
                    "repoDir": body.repo_dir,
                    "authorName": body.author_name,
                    "removeModIds": body.remove_mod_ids,
                    "removeProfileIds": body.remove_profile_ids,
                    "addProfiles": body.add_profiles,
                    "modChangelogs": body.mod_changelogs,
                }
            }));
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({
                    "ok": true,
                    "driven_by": "bmm-ui",
                    "message": "Repo update requested through the BMM interface.",
                })),
                StatusCode::ACCEPTED,
            )
        });

    // POST /api/repo/host  (auth) — start HTTP static file server for a generated repo
    let tok_repo_host_start = token.clone();
    let http_host_start     = http_host_shutdown.clone();
    let handle_repo_host    = app_handle.clone();
    let repo_host_start = warp::path!("api" / "repo" / "host")
        .and(warp::post())
        .and(require_token(tok_repo_host_start))
        .and(warp::body::json::<RepoHttpHostBody>())
        .and(with_http_host_shutdown(http_host_start))
        .and(with_app_handle(handle_repo_host))
        .map(|body: RepoHttpHostBody, _shutdown: HttpHostShutdown, handle: tauri::AppHandle| {
            // Reject if the native repo server is already running.
            {
                let st = handle.state::<crate::commands::repo_server::RepoServerState>();
                let running = st.shutdown_tx.lock().map(|g| g.is_some()).unwrap_or(false);
                if running {
                    let reason = "A repo server is already running. Stop it first.";
                    let _ = handle.emit_all("bmm://api-rejected", serde_json::json!({
                        "action": "repo/host", "reason": reason, "code": 409
                    }));
                    return warp::reply::with_status(
                        warp::reply::json(&ApiError { error: reason.into() }),
                        StatusCode::CONFLICT,
                    );
                }
            }
            // Start the HTTP host through the BMM interface (the native Server
            // Repo server), exactly as if a human filled the form and clicked
            // "Start" — NOT a detached background server. This makes the running
            // server visible & controllable from the Server Repo page.
            let _ = handle.emit_all("bmm://api-exec", serde_json::json!({
                "action": "repo/host",
                "params": {
                    "serveDir": body.serve_dir,
                    "port": body.port.unwrap_or(8080),
                    "uploadLimit": body.upload_limit.unwrap_or(0),
                }
            }));
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({
                    "ok": true,
                    "driven_by": "bmm-ui",
                    "message": "HTTP host start requested through the BMM interface.",
                })),
                StatusCode::ACCEPTED,
            )
        });

    // DELETE /api/repo/host  (auth) — stop the HTTP server via the BMM interface
    let tok_repo_host_stop = token.clone();
    let http_host_stop     = http_host_shutdown.clone();
    let handle_repo_host_stop = app_handle.clone();
    let repo_host_stop = warp::path!("api" / "repo" / "host")
        .and(warp::delete())
        .and(require_token(tok_repo_host_stop))
        .and(with_http_host_shutdown(http_host_stop))
        .and(with_app_handle(handle_repo_host_stop))
        .map(|_shutdown: HttpHostShutdown, handle: tauri::AppHandle| {
            // Stop the native repo server through the BMM interface (toggles the
            // Server Repo "Stop" button) — mirrors the human action.
            let _ = handle.emit_all("bmm://api-exec", serde_json::json!({ "action": "repo/host-stop" }));
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "driven_by": "bmm-ui", "message": "HTTP host stop requested through the BMM interface." })),
                StatusCode::OK,
            )
        });

    // PUT /api/modpacks/:id  (auth) — update an existing modpack
    let data_mp_update  = data.clone();
    let path_mp_update  = data_path.clone();
    let tok_mp_update   = token.clone();
    let update_modpack = warp::path!("api" / "modpacks" / String)
        .and(warp::put())
        .and(require_token(tok_mp_update))
        .and(require_permission(token.clone(), "modpacks.write"))
        .and(warp::body::json::<UpdateModpackBody>())
        .and(with_data(data_mp_update))
        .and(with_path(path_mp_update))
        .map(|modpack_id: String, body: UpdateModpackBody, d: Arc<std::sync::Mutex<AppData>>, path: Arc<PathBuf>| {
            let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
            // Build mod refs first (immutable borrow) before taking mutable borrow on modpacks
            let new_mod_refs: Option<Vec<crate::models::modpack::ModpackModRef>> = body.mod_ids.as_ref().map(|ids| {
                ids.iter().map(|id| {
                    let m = data.mods.iter().find(|m| &m.id == id);
                    crate::models::modpack::ModpackModRef {
                        mod_id: id.clone(),
                        mod_name: m.map(|m| m.name.clone()).unwrap_or_default(),
                        mod_version: m.map(|m| m.version.clone()).unwrap_or_default(),
                        profile_id: None,
                        profile_name: None,
                        sha256: String::new(),
                        file_manifest: Vec::new(),
                        include_dependencies: false,
                        download_link: None,
                        fallback_link: None,
                        fallback_type: None,
                    }
                }).collect()
            });
            let mp = match data.modpacks.iter_mut().find(|m| m.id == modpack_id) {
                Some(m) => m,
                None => return warp::reply::with_status(
                    warp::reply::json(&ApiError { error: format!("Modpack '{}' not found", modpack_id) }),
                    StatusCode::NOT_FOUND,
                ),
            };
            if let Some(n) = body.name              { mp.name = n; }
            if let Some(d) = body.description       { mp.description = Some(d); }
            if let Some(g) = body.game_name         { mp.game_name = Some(g); }
            if let Some(s) = body.sr_link           { mp.sr_link = Some(s); }
            if let Some(m) = body.multi_profile     { mp.multi_profile = m; }
            if let Some(s) = body.skip_integrity_check { mp.skip_integrity_check = s; }
            if let Some(dm) = body.dependency_mode {
                mp.dependency_mode = match dm.as_str() {
                    "all"    => crate::models::modpack::DependencyMode::All,
                    "manual" => crate::models::modpack::DependencyMode::Manual,
                    _        => crate::models::modpack::DependencyMode::None,
                };
            }
            if let Some(refs) = new_mod_refs { mp.mods = refs; }
            mp.updated_at = chrono::Local::now().to_rfc3339();
            let mp_id = mp.id.clone();
            drop(data);
            save_data(&d, &path);
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "modpack_id": mp_id })),
                StatusCode::OK,
            )
        });

    // DELETE /api/modpacks/:id  (auth) — permanently delete a modpack
    let data_mp_delete  = data.clone();
    let path_mp_delete  = data_path.clone();
    let tok_mp_delete   = token.clone();
    let delete_modpack = warp::path!("api" / "modpacks" / String)
        .and(warp::delete())
        .and(require_token(tok_mp_delete))
        .and(require_permission(token.clone(), "modpacks.write"))
        .and(with_data(data_mp_delete))
        .and(with_path(path_mp_delete))
        .map(|modpack_id: String, d: Arc<std::sync::Mutex<AppData>>, path: Arc<PathBuf>| {
            let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
            let before = data.modpacks.len();
            data.modpacks.retain(|m| m.id != modpack_id);
            let deleted = data.modpacks.len() < before;
            drop(data);
            if deleted {
                save_data(&d, &path);
                warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({ "ok": true, "deleted_id": modpack_id })),
                    StatusCode::OK,
                )
            } else {
                warp::reply::with_status(
                    warp::reply::json(&ApiError { error: format!("Modpack '{}' not found", modpack_id) }),
                    StatusCode::NOT_FOUND,
                )
            }
        });

    // ── Import / Export endpoints (UI-driven) ─────────────────────────────────
    // Each emits `bmm://api-exec` so the frontend performs the action through the
    // BMM interface (native importer/exporter + file dialog) — exactly as a human
    // would. Token required. They return 202 (the user completes any file picker).

    // POST /api/data/export — export app data (profiles/settings/etc.)
    let t1 = token.clone(); let h1 = app_handle.clone();
    let io_data_export = warp::path!("api" / "data" / "export").and(warp::post())
        .and(require_token(t1)).and(with_app_handle(h1))
        .map(|h: tauri::AppHandle| api_exec_reply(&h, "data/export", serde_json::json!({})));

    // POST /api/data/import — import an app-data backup
    let t2 = token.clone(); let h2 = app_handle.clone();
    let io_data_import = warp::path!("api" / "data" / "import").and(warp::post())
        .and(require_token(t2)).and(with_app_handle(h2))
        .map(|h: tauri::AppHandle| api_exec_reply(&h, "data/import", serde_json::json!({})));

    // POST /api/modlists/export — export a .mmlist mod list
    let t3 = token.clone(); let h3 = app_handle.clone();
    let io_modlist_export = warp::path!("api" / "modlists" / "export").and(warp::post())
        .and(require_token(t3)).and(with_app_handle(h3))
        .map(|h: tauri::AppHandle| api_exec_reply(&h, "modlist/export", serde_json::json!({})));

    // POST /api/modlists/import — import a .mmlist mod list
    let t4 = token.clone(); let h4 = app_handle.clone();
    let io_modlist_import = warp::path!("api" / "modlists" / "import").and(warp::post())
        .and(require_token(t4)).and(with_app_handle(h4))
        .map(|h: tauri::AppHandle| api_exec_reply(&h, "modlist/import", serde_json::json!({})));

    // POST /api/modpacks/import — import a .bmp modpack.
    // Optional JSON body { "path": "C:/.../pack.bmp" } imports directly; else opens a dialog.
    let t5 = token.clone(); let h5 = app_handle.clone();
    let io_modpack_import = warp::path!("api" / "modpacks" / "import").and(warp::post())
        .and(require_token(t5)).and(with_app_handle(h5))
        .and(warp::body::bytes())
        .map(|h: tauri::AppHandle, body: bytes::Bytes| {
            let path = serde_json::from_slice::<serde_json::Value>(&body).ok()
                .and_then(|v| v.get("path").and_then(|p| p.as_str().map(String::from)));
            api_exec_reply(&h, "modpack/import", serde_json::json!({ "path": path }))
        });

    // POST /api/modpacks/export — export a modpack to .bmp (body: { id })
    let t6 = token.clone(); let h6 = app_handle.clone();
    let io_modpack_export = warp::path!("api" / "modpacks" / "export").and(warp::post())
        .and(require_token(t6)).and(warp::body::json::<IoIdBody>()).and(with_app_handle(h6))
        .map(|b: IoIdBody, h: tauri::AppHandle| api_exec_reply(&h, "modpack/export", serde_json::json!({ "id": b.id, "destDir": b.dest_dir })));

    // POST /api/plugins/import — import a .bmmplug plugin
    let t7 = token.clone(); let h7 = app_handle.clone();
    let io_plugin_import = warp::path!("api" / "plugins" / "import").and(warp::post())
        .and(require_token(t7)).and(with_app_handle(h7))
        .map(|h: tauri::AppHandle| api_exec_reply(&h, "plugin/import", serde_json::json!({})));

    // POST /api/plugins/export — export a plugin to .bmmplug (body: { id })
    let t8 = token.clone(); let h8 = app_handle.clone();
    let io_plugin_export = warp::path!("api" / "plugins" / "export").and(warp::post())
        .and(require_token(t8)).and(warp::body::json::<IoIdBody>()).and(with_app_handle(h8))
        .map(|b: IoIdBody, h: tauri::AppHandle| api_exec_reply(&h, "plugin/export", serde_json::json!({ "id": b.id })));

    // POST /api/language/import — import a language .json file.
    // Optional JSON body { "path": "C:/.../fr.json" } imports that file directly;
    // an empty/absent body opens the native file picker.
    let t10 = token.clone(); let h10 = app_handle.clone();
    let io_lang_import = warp::path!("api" / "language" / "import").and(warp::post())
        .and(require_token(t10)).and(with_app_handle(h10))
        .and(warp::body::bytes())
        .map(|h: tauri::AppHandle, body: bytes::Bytes| {
            let path = serde_json::from_slice::<serde_json::Value>(&body).ok()
                .and_then(|v| v.get("path").and_then(|p| p.as_str().map(String::from)));
            api_exec_reply(&h, "language/import", serde_json::json!({ "path": path }))
        });

    // POST /api/profiles/import/ovgme — import OvGME profiles
    let t11 = token.clone(); let h11 = app_handle.clone();
    let io_prof_ovgme = warp::path!("api" / "profiles" / "import" / "ovgme").and(warp::post())
        .and(require_token(t11)).and(with_app_handle(h11))
        .map(|h: tauri::AppHandle| api_exec_reply(&h, "profile/import-ovgme", serde_json::json!({})));

    // POST /api/profiles/import/omm — import an OMM / OMX profile
    let t12 = token.clone(); let h12 = app_handle.clone();
    let io_prof_omm = warp::path!("api" / "profiles" / "import" / "omm").and(warp::post())
        .and(require_token(t12)).and(with_app_handle(h12))
        .map(|h: tauri::AppHandle| api_exec_reply(&h, "profile/import-omm", serde_json::json!({})));

    let group_io = io_data_export
        .or(io_data_import)
        .or(io_modlist_export)
        .or(io_modlist_import)
        .or(io_modpack_import)
        .or(io_modpack_export)
        .or(io_plugin_import)
        .or(io_plugin_export)
        .or(io_lang_import)
        .or(io_prof_ovgme)
        .or(io_prof_omm)
        .boxed();

    // ── App Catalog routes ─────────────────────────────────────────────────────
    // These endpoints expose the app catalog / installed apps system via the API.
    // All mutating routes (install, launch, uninstall) are auth-gated and require
    // the "app.write" permission in the caller's plugin permissions.

    // GET /api/apps  (auth, perm: app.read) — list installed apps + usage stats
    let tok_apps_list = token.clone(); let perm_apps_list = data.clone(); let h_apps_list = app_handle.clone();
    let apps_list = warp::path!("api" / "apps")
        .and(warp::get())
        .and(require_token(tok_apps_list))
        .and(require_permission(perm_apps_list, "app.read"))
        .and(with_app_handle(h_apps_list))
        .map(|h: tauri::AppHandle| {
            match crate::commands::apps::get_apps_state(h) {
                Ok(s) => warp::reply::with_status(warp::reply::json(&s), StatusCode::OK),
                Err(e) => warp::reply::with_status(warp::reply::json(&ApiError { error: e }), StatusCode::INTERNAL_SERVER_ERROR),
            }
        });

    // POST /api/apps/install  (auth, app.write) — install an app
    #[derive(serde::Deserialize, Clone)]
    #[serde(rename_all = "camelCase")]
    struct AppInstallBody {
        app_id: String,
        app_title: String,
        download_url: String,
        file_type: String,
        install_path: String,
        #[serde(default)] version: Option<String>,
        #[serde(default)] category: Option<String>,
        #[serde(default)] thumb: Option<String>,
    }
    let tok_app_install = token.clone(); let perm_app_install = data.clone(); let h_app_install = app_handle.clone();
    let apps_install = warp::path!("api" / "apps" / "install")
        .and(warp::post())
        .and(require_token(tok_app_install))
        .and(require_permission(perm_app_install, "app.write"))
        .and(warp::body::json::<AppInstallBody>())
        .and(with_app_handle(h_app_install))
        .map(|body: AppInstallBody, h: tauri::AppHandle| {
            let _ = h.emit_all("bmm://api-exec", serde_json::json!({
                "action": "apps/install",
                "params": {
                    "appId":       body.app_id,
                    "appTitle":    body.app_title,
                    "downloadUrl": body.download_url,
                    "fileType":    body.file_type,
                    "installPath": body.install_path,
                    "version":     body.version,
                    "category":    body.category,
                    "thumb":       body.thumb,
                }
            }));
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({"ok":true,"driven_by":"bmm-ui","message":"App install requested"})),
                StatusCode::ACCEPTED,
            )
        });

    // POST /api/apps/launch  (auth, app.write)
    #[derive(serde::Deserialize, Clone)]
    #[serde(rename_all = "camelCase")]
    struct AppLaunchBody { app_id: String, exe_path: String }
    let tok_app_launch = token.clone(); let perm_app_launch = data.clone(); let h_app_launch = app_handle.clone();
    let apps_launch = warp::path!("api" / "apps" / "launch")
        .and(warp::post())
        .and(require_token(tok_app_launch))
        .and(require_permission(perm_app_launch, "app.write"))
        .and(warp::body::json::<AppLaunchBody>())
        .and(with_app_handle(h_app_launch))
        .map(|body: AppLaunchBody, h: tauri::AppHandle| {
            match crate::commands::apps::launch_app(h, body.app_id, body.exe_path) {
                Ok(_)  => warp::reply::with_status(warp::reply::json(&serde_json::json!({"ok":true})), StatusCode::OK),
                Err(e) => warp::reply::with_status(warp::reply::json(&ApiError { error: e }), StatusCode::INTERNAL_SERVER_ERROR),
            }
        });

    // DELETE /api/apps/:id  (auth, app.write) — uninstall app (keep files)
    let tok_app_del = token.clone(); let perm_app_del = data.clone(); let h_app_del = app_handle.clone();
    let apps_delete = warp::path!("api" / "apps" / String)
        .and(warp::delete())
        .and(require_token(tok_app_del))
        .and(require_permission(perm_app_del, "app.write"))
        .and(with_app_handle(h_app_del))
        .map(|app_id: String, h: tauri::AppHandle| {
            match crate::commands::apps::uninstall_app(h, app_id, Some(false), Some(false)) {
                Ok(_)  => warp::reply::with_status(warp::reply::json(&serde_json::json!({"ok":true})), StatusCode::OK),
                Err(e) => warp::reply::with_status(warp::reply::json(&ApiError { error: e }), StatusCode::INTERNAL_SERVER_ERROR),
            }
        });

    // GET /api/apps/permissions/:plugin_id — get plugin API permissions
    let tok_perm_get = token.clone(); let d_perm_get = data.clone();
    let apps_perm_get = warp::path!("api" / "apps" / "permissions" / String)
        .and(warp::get())
        .and(require_token(tok_perm_get))
        .and(with_data(d_perm_get))
        .map(|plugin_id: String, d: Arc<std::sync::Mutex<AppData>>| {
            let data = d.lock().unwrap_or_else(|p| p.into_inner());
            let perms = data.plugin_permissions.get(&plugin_id).cloned().unwrap_or_default();
            warp::reply::with_status(warp::reply::json(&serde_json::json!({"plugin_id":plugin_id,"permissions":perms})), StatusCode::OK)
        });

    // PUT /api/apps/permissions/:plugin_id — set plugin API permissions
    #[derive(serde::Deserialize)]
    struct SetPermsBody { permissions: Vec<String> }
    let tok_perm_set = token.clone(); let d_perm_set = data.clone(); let dp_perm_set = data_path.clone();
    let apps_perm_set = warp::path!("api" / "apps" / "permissions" / String)
        .and(warp::put())
        .and(require_token(tok_perm_set))
        .and(warp::body::json::<SetPermsBody>())
        .and(with_data(d_perm_set))
        .and(with_path(dp_perm_set))
        .map(|plugin_id: String, body: SetPermsBody, d: Arc<std::sync::Mutex<AppData>>, dp: Arc<PathBuf>| {
            let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
            data.plugin_permissions.insert(plugin_id.clone(), body.permissions.clone());
            drop(data);
            save_data(&d, &dp);
            warp::reply::with_status(warp::reply::json(&serde_json::json!({"ok":true,"plugin_id":plugin_id,"permissions":body.permissions})), StatusCode::OK)
        });

    // GET /api/apps/permissions  — list all plugin permissions
    let tok_perm_list = token.clone(); let d_perm_list = data.clone();
    let apps_perm_list = warp::path!("api" / "apps" / "permissions")
        .and(warp::get())
        .and(require_token(tok_perm_list))
        .and(with_data(d_perm_list))
        .map(|d: Arc<std::sync::Mutex<AppData>>| {
            let data = d.lock().unwrap_or_else(|p| p.into_inner());
            warp::reply::with_status(warp::reply::json(&data.plugin_permissions), StatusCode::OK)
        });

    // ── Local Catalog CRUD ────────────────────────────────────────────────────
    // Manages a local `apps-catalog.json` in BMM data dir (catalog_read/write helpers above).

    // GET /api/language/template  (no auth) — download the translation template JSON
    // Useful for plugin/community developers: download → translate → POST /api/language/import
    let h_lang_tmpl = app_handle.clone();
    let lang_template = warp::path!("api" / "language" / "template")
        .and(warp::get())
        .and(with_app_handle(h_lang_tmpl))
        .map(|h: tauri::AppHandle| {
            let lang_dir = crate::fs_utils::get_lang_dir(&h);
            let tmpl_path = lang_dir.join("template.json");
            match std::fs::read_to_string(&tmpl_path) {
                Ok(content) => {
                    warp::reply::with_status(
                        warp::reply::with_header(
                            warp::reply::json(&serde_json::from_str::<serde_json::Value>(&content)
                                .unwrap_or_else(|_| serde_json::json!({}))),
                            "Content-Disposition", "attachment; filename=\"lang-template.json\""
                        ),
                        StatusCode::OK,
                    )
                }
                Err(_) => warp::reply::with_status(
                    warp::reply::with_header(
                        warp::reply::json(&ApiError { error: "Language template not found. Is BMM installed correctly?".into() }),
                        "Content-Disposition", ""
                    ),
                    StatusCode::NOT_FOUND,
                ),
            }
        });

    // GET /api/catalog  (auth, perm: catalog.read)
    let (tok_cat_get, perm_cat_get, h_cat_get) = (token.clone(), data.clone(), app_handle.clone());
    let cat_get = warp::path!("api" / "catalog")
        .and(warp::get()).and(require_token(tok_cat_get)).and(require_permission(perm_cat_get, "catalog.read"))
        .and(with_app_handle(h_cat_get))
        .map(|h: tauri::AppHandle| {
            warp::reply::with_status(warp::reply::json(&catalog_read(&h)), StatusCode::OK)
        });

    // POST /api/catalog/new  (auth, perm: catalog.write) — create/reset whole catalog
    #[derive(serde::Deserialize, Clone)]
    struct CatalogCreateBody {
        #[serde(default)] name: Option<String>,
        #[serde(default)] description: Option<String>,
        #[serde(default)] partner_catalogs: Vec<String>,
        #[serde(default)] community_imports: Vec<String>,
        #[serde(default)] apps: Vec<serde_json::Value>,
    }
    let (tok_cat_new, perm_cat_new, h_cat_new) = (token.clone(), data.clone(), app_handle.clone());
    let cat_new = warp::path!("api" / "catalog" / "new")
        .and(warp::post()).and(require_token(tok_cat_new)).and(require_permission(perm_cat_new, "catalog.write"))
        .and(warp::body::json::<CatalogCreateBody>())
        .and(with_app_handle(h_cat_new))
        .map(|body: CatalogCreateBody, h: tauri::AppHandle| {
            let cat = serde_json::json!({
                "version": "1.0",
                "name": body.name.unwrap_or_else(|| "My Catalog".into()),
                "description": body.description.unwrap_or_default(),
                "partner_catalogs": body.partner_catalogs,
                "community_imports": body.community_imports,
                "apps": body.apps,
            });
            match catalog_write(&h, &cat) {
                Ok(_) => warp::reply::with_status(warp::reply::json(&serde_json::json!({"ok":true,"catalog":cat})), StatusCode::CREATED),
                Err(e) => warp::reply::with_status(warp::reply::json(&ApiError { error: e }), StatusCode::INTERNAL_SERVER_ERROR),
            }
        });

    // POST /api/catalog/apps  (auth, perm: catalog.write) — add single app entry
    #[derive(serde::Deserialize, Clone)] struct CatalogAppBody { #[serde(flatten)] app: serde_json::Value }
    let (tok_cat_add, perm_cat_add, h_cat_add) = (token.clone(), data.clone(), app_handle.clone());
    let cat_add_app = warp::path!("api" / "catalog" / "apps")
        .and(warp::post()).and(require_token(tok_cat_add)).and(require_permission(perm_cat_add, "catalog.write"))
        .and(warp::body::json::<CatalogAppBody>())
        .and(with_app_handle(h_cat_add))
        .map(|body: CatalogAppBody, h: tauri::AppHandle| {
            let mut cat = catalog_read(&h);
            match cat["apps"].as_array_mut() {
                Some(arr) => arr.push(body.app),
                None => { cat["apps"] = serde_json::json!([body.app]); }
            }
            match catalog_write(&h, &cat) {
                Ok(_) => warp::reply::with_status(warp::reply::json(&serde_json::json!({"ok":true,"total":cat["apps"].as_array().map(|a|a.len()).unwrap_or(0)})), StatusCode::CREATED),
                Err(e) => warp::reply::with_status(warp::reply::json(&ApiError { error: e }), StatusCode::INTERNAL_SERVER_ERROR),
            }
        });

    // PUT /api/catalog/apps/:id  (auth, perm: catalog.write) — update app entry fields
    let (tok_cat_upd, perm_cat_upd, h_cat_upd) = (token.clone(), data.clone(), app_handle.clone());
    let cat_upd_app = warp::path!("api" / "catalog" / "apps" / String)
        .and(warp::put()).and(require_token(tok_cat_upd)).and(require_permission(perm_cat_upd, "catalog.write"))
        .and(warp::body::json::<serde_json::Value>())
        .and(with_app_handle(h_cat_upd))
        .map(|app_id: String, fields: serde_json::Value, h: tauri::AppHandle| {
            let mut cat = catalog_read(&h);
            let mut found = false;
            if let Some(arr) = cat["apps"].as_array_mut() {
                for entry in arr.iter_mut() {
                    if entry.get("id").and_then(|v| v.as_str()) == Some(&app_id) {
                        if let (Some(obj), Some(upd)) = (entry.as_object_mut(), fields.as_object()) {
                            for (k, v) in upd { obj.insert(k.clone(), v.clone()); }
                        }
                        found = true; break;
                    }
                }
            }
            if !found { return warp::reply::with_status(warp::reply::json(&ApiError { error: format!("App '{}' not found in catalog", app_id) }), StatusCode::NOT_FOUND); }
            match catalog_write(&h, &cat) {
                Ok(_) => warp::reply::with_status(warp::reply::json(&serde_json::json!({"ok":true})), StatusCode::OK),
                Err(e) => warp::reply::with_status(warp::reply::json(&ApiError { error: e }), StatusCode::INTERNAL_SERVER_ERROR),
            }
        });

    // DELETE /api/catalog/apps/:id  (auth, perm: catalog.write)
    let (tok_cat_del, perm_cat_del, h_cat_del) = (token.clone(), data.clone(), app_handle.clone());
    let cat_del_app = warp::path!("api" / "catalog" / "apps" / String)
        .and(warp::delete()).and(require_token(tok_cat_del)).and(require_permission(perm_cat_del, "catalog.write"))
        .and(with_app_handle(h_cat_del))
        .map(|app_id: String, h: tauri::AppHandle| {
            let mut cat = catalog_read(&h);
            let before = cat["apps"].as_array().map(|a| a.len()).unwrap_or(0);
            if let Some(arr) = cat["apps"].as_array_mut() {
                arr.retain(|e| e.get("id").and_then(|v| v.as_str()) != Some(&app_id));
            }
            if cat["apps"].as_array().map(|a| a.len()).unwrap_or(0) == before {
                return warp::reply::with_status(warp::reply::json(&ApiError { error: format!("App '{}' not found", app_id) }), StatusCode::NOT_FOUND);
            }
            match catalog_write(&h, &cat) {
                Ok(_) => warp::reply::with_status(warp::reply::json(&serde_json::json!({"ok":true,"removed":app_id})), StatusCode::OK),
                Err(e) => warp::reply::with_status(warp::reply::json(&ApiError { error: e }), StatusCode::INTERNAL_SERVER_ERROR),
            }
        });

    // Order matters: specific sub-paths BEFORE the base GET /api/catalog
    let group_catalog = lang_template  // GET  /api/language/template (no auth needed)
        .or(cat_new)                   // POST /api/catalog/new
        .or(cat_add_app)               // POST /api/catalog/apps
        .or(cat_upd_app)               // PUT  /api/catalog/apps/:id
        .or(cat_del_app)               // DELETE /api/catalog/apps/:id
        .or(cat_get)                   // GET  /api/catalog
        .boxed();

    let group_apps = apps_perm_list    // /api/apps/permissions (GET, no id)
        .or(apps_perm_get)             // /api/apps/permissions/:id (GET)
        .or(apps_perm_set)             // /api/apps/permissions/:id (PUT)
        .or(apps_install)              // /api/apps/install (POST)
        .or(apps_launch)               // /api/apps/launch (POST)
        .or(apps_delete)               // /api/apps/:id (DELETE) — must be AFTER specific paths
        .or(apps_list)                 // /api/apps (GET)
        .boxed();

    // CORS (CWE-942) — in RELEASE, restrict to the Tauri WebView origins so an
    // arbitrary website open in the user's browser can't READ the unauthenticated
    // GET endpoints (mod/profile enumeration); the in-app tester (origin
    // tauri.localhost) keeps working, and curl/deep-link clients send no Origin.
    // In DEBUG (`tauri dev`) the WebView origin is the dev server, so we stay
    // permissive to avoid breaking the in-app tester during development.
    let cors = {
        let b = warp::cors()
            .allow_methods(vec!["GET", "POST", "PUT", "DELETE", "OPTIONS"])
            .allow_headers(vec!["Content-Type", "Authorization"]);
        #[cfg(debug_assertions)]
        { b.allow_any_origin() }
        #[cfg(not(debug_assertions))]
        { b.allow_origins(vec!["https://tauri.localhost", "tauri://localhost", "http://tauri.localhost"]) }
    };

    // Split into boxed groups to avoid E0275 type-recursion overflow with deep Or<Or<...>> chains
    let group_a = health
        .or(status)
        .or(check_update)
        .or(get_mods_all)
        .or(get_mods)
        .or(get_active_mods)
        .or(get_data_dump)
        .or(get_profiles)
        .or(get_plugins)
        .or(get_creator_id_route)
        .boxed();

    let group_b = enable_mod
        .or(disable_mod)
        .or(activate_profile)
        .or(create_profile_route)
        .or(compare_plugin)
        .or(apply_plugin)
        .or(enable_modpack)
        .or(disable_modpack)
        .or(create_modpack)
        .or(restart)
        .or(get_modpacks)
        .boxed();

    // group_c: repo routes (cancel routes BEFORE the main route they override)
    let group_c = repo_info
        .or(repo_connect)
        .or(repo_list)
        .or(repo_sync_cancel)   // DELETE must come before POST for same path prefix
        .or(repo_sync)
        .or(repo_gen_cancel)
        .or(repo_gen)
        .or(repo_update)        // POST /api/repo/update
        .or(repo_host_stop)     // DELETE /api/repo/host
        .or(repo_host_start)    // POST /api/repo/host
        .or(repo_remove)
        .boxed();

    let group_d = update_profile
        .or(delete_profile)
        .or(update_mod)
        .or(delete_mod)
        .or(mod_config)          // POST /api/mod/config
        .or(mod_check_updates)   // POST /api/mod/check-updates
        .or(mod_update)          // POST /api/mod/update
        .boxed();

    let group_e = update_modpack
        .or(delete_modpack)
        .boxed();

    let routes = group_a
        .or(group_b)
        .or(group_c)
        .or(group_d)
        .or(group_e)
        .or(group_io)
        .or(group_catalog)
        .or(group_apps)
        .with(cors)
        .recover(handle_rejection);

    // Per-request activity notifier: emit one `bmm://api-action` event for every
    // API call so the frontend can show a toast + keep a log — mirroring the
    // quick-test behavior for actions triggered by external scripts / curl /
    // other apps. Runs after `.recover`, so the final status code is reported.
    let activity_handle = app_handle.clone();
    let routes = routes.with(warp::log::custom(move |info| {
        let method = info.method().as_str().to_string();
        let path = info.path().to_string();
        let status = info.status().as_u16();
        if method != "OPTIONS" && path.starts_with("/api/") {
            let _ = activity_handle.emit_all("bmm://api-action", serde_json::json!({
                "method": method,
                "path": path,
                "status": status,
            }));
        }
    }));

    // Configurable port (settings.api_port, default 51274).
    let port = {
        let d = data.lock().unwrap();
        let p = d.settings.api_port;
        if p == 0 { API_PORT } else { p }
    };
    EFFECTIVE_API_PORT.store(port, Ordering::Relaxed);
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();

    // try_bind: binding can fail (port held by a previous/zombie BMM instance,
    // e.g. right after an in-app restart). bind_with_graceful_shutdown PANICS in
    // that case and takes the whole app down — degrade gracefully instead.
    match warp::serve(routes).try_bind_with_graceful_shutdown(addr, async {
        shutdown_rx.await.ok();
    }) {
        Ok((_, server)) => {
            crate::commands::crash::log_line(format!("[PLUGIN-API] Server started on http://127.0.0.1:{}", port));
            server.await;
            crate::commands::crash::log_line("[PLUGIN-API] Server stopped.".to_string());
        }
        Err(e) => {
            crate::commands::crash::log_line(format!(
                "[PLUGIN-API] Could not bind port {} ({}). Plugin API disabled for this session — is another BMM instance running?",
                port, e
            ));
        }
    }
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

// ─────────────────────────────────────────────────────────────────────────────
// Repo API — background async workers
// ─────────────────────────────────────────────────────────────────────────────

fn api_sha256_file(path: &std::path::Path) -> Result<String, String> {
    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(&data);
    Ok(format!("{:x}", hasher.finalize()))
}

#[allow(dead_code)] // Retained for reference; sync is now driven through the BMM UI.
async fn do_api_repo_sync(
    body: RepoSyncBody,
    data: Arc<std::sync::Mutex<AppData>>,
    data_path: Arc<PathBuf>,
    handle: tauri::AppHandle,
    job_id: String,
    cancel: Arc<AtomicBool>,
) {
    use futures::StreamExt;

    macro_rules! emit {
        ($event:expr, $payload:expr) => {{ let _ = handle.emit_all($event, $payload); }};
    }
    macro_rules! bail {
        ($msg:expr) => {{
            emit!("bmm://repo-sync-error", serde_json::json!({ "job_id": &job_id, "error": $msg }));
            return;
        }};
    }

    emit!("bmm://repo-sync-progress", serde_json::json!({
        "job_id": &job_id, "step": "Connecting…", "progress": 0.0, "current_file": &body.url
    }));

    let mut cb = reqwest::Client::builder()
        .user_agent("BetterModManager")
        .timeout(std::time::Duration::from_secs(60));
    if let Some(ref cid) = body.creator_id {
        let mut headers = reqwest::header::HeaderMap::new();
        if let Ok(hv) = reqwest::header::HeaderValue::from_str(cid) {
            headers.insert("X-Creator-ID", hv);
        }
        cb = cb.default_headers(headers);
    }
    let client = match cb.build() {
        Ok(c) => c,
        Err(e) => bail!(format!("HTTP client: {}", e)),
    };

    let url = body.url.clone();
    let target_url = if url.ends_with("repo.json") { url.clone() }
                     else { format!("{}/repo.json", url.trim_end_matches('/')) };
    let base_url = if url.ends_with("repo.json") {
        url.trim_end_matches("repo.json").to_string()
    } else if url.ends_with('/') { url.clone() } else { format!("{}/", url) };

    let repo: crate::models::repo::ServerRepo = match client.get(&target_url).send().await {
        Ok(r) if r.status().is_success() => match r.json().await {
            Ok(j) => j,
            Err(e) => bail!(format!("Invalid repo.json: {}", e)),
        },
        Ok(r) if r.status() == reqwest::StatusCode::FORBIDDEN => bail!("Access denied (403)"),
        Ok(r) => bail!(format!("Remote HTTP {}", r.status())),
        Err(e) => bail!(format!("Network error: {}", e)),
    };

    let total_choices = body.choices.len().max(1);
    let mut profiles_created = 0usize;

    for (c_idx, choice) in body.choices.iter().enumerate() {
        let repo_profile = match repo.profiles.iter().find(|p| p.id == choice.repo_profile_id) {
            Some(p) => p.clone(),
            None => {
                emit!("bmm://repo-sync-warning", serde_json::json!({
                    "job_id": &job_id,
                    "message": format!("Profile '{}' not found in repo", choice.repo_profile_id),
                }));
                continue;
            }
        };

        let existing_profile = if let Some(ref lid) = choice.target_local_profile_id {
            let d = data.lock().unwrap_or_else(|p| p.into_inner());
            d.profiles.iter().find(|p| &p.id == lid).cloned()
        } else { None };

        let is_new_profile = choice.target_local_profile_id.is_none();
        let profile_id = choice.target_local_profile_id.clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        let target_game_path = if !body.game_dir.is_empty() {
            std::path::PathBuf::from(&body.game_dir)
        } else if let Some(ref p) = existing_profile {
            p.game_path.clone()
        } else {
            bail!("game_dir is required when creating a new profile");
        };

        let target_backup_path = if !body.backup_dir.is_empty() {
            std::path::PathBuf::from(&body.backup_dir)
        } else if let Some(ref p) = existing_profile {
            p.backup_path.clone()
        } else {
            bail!("backup_dir is required when creating a new profile");
        };

        let mods_path = if let Some(ref p) = existing_profile {
            p.mods_path.clone()
        } else if !body.mods_dir.is_empty() {
            let safe = repo_profile.name.replace(|c: char| !c.is_alphanumeric() && c != ' ', "_");
            std::path::PathBuf::from(&body.mods_dir).join(&safe)
        } else {
            bail!("mods_dir is required when creating a new profile");
        };

        if let Err(e) = std::fs::create_dir_all(&mods_path) {
            bail!(format!("Cannot create mods dir: {}", e));
        }

        let total_mods = repo_profile.mods.len().max(1);
        let mut active_mod_ids: Vec<String> = Vec::new();

        let mut consecutive_errors: u32 = 0;
        const MAX_CONSECUTIVE_ERRORS: u32 = 3;

        for (m_idx, repo_mod) in repo_profile.mods.iter().enumerate() {
            // Check cancellation at each mod boundary
            if cancel.load(Ordering::SeqCst) {
                emit!("bmm://repo-sync-error", serde_json::json!({
                    "job_id": &job_id, "error": "Sync cancelled by user", "cancelled": true,
                }));
                return;
            }

            if let Some(ref sel) = choice.selected_mod_ids {
                if !sel.contains(&repo_mod.id) { continue; }
            }

            let safe_name = repo_mod.name.replace(
                |c: char| !c.is_alphanumeric() && c != ' ' && c != '-' && c != '_', "_");
            let id_prefix = &repo_mod.id[..repo_mod.id.len().min(8)];
            let mod_subfolder = format!("{}_{}", id_prefix, safe_name);
            let target_mod_dir = mods_path.join(&mod_subfolder);

            emit!("bmm://repo-sync-progress", serde_json::json!({
                "job_id": &job_id,
                "step": format!("Downloading {} ({}/{})", repo_mod.name, m_idx + 1, total_mods),
                "progress": ((c_idx as f32 + m_idx as f32 / total_mods as f32) / total_choices as f32) * 100.0,
                "current_file": &repo_mod.name,
            }));

            if let Err(e) = std::fs::create_dir_all(&target_mod_dir) {
                emit!("bmm://repo-sync-warning", serde_json::json!({
                    "job_id": &job_id, "message": format!("Cannot create mod dir: {}", e),
                }));
                continue;
            }

            for file in &repo_mod.files {
                let local_path = target_mod_dir.join(&file.relative_path);
                let needs_download = if local_path.exists() && !body.overwrite_all {
                    match api_sha256_file(&local_path) {
                        Ok(h) => h != file.sha256_hash,
                        Err(_) => true,
                    }
                } else { true };

                if needs_download {
                    if let Some(parent) = local_path.parent() { std::fs::create_dir_all(parent).ok(); }
                    let file_url = format!("{}mods/{}/{}", base_url, repo_mod.id,
                        file.relative_path.replace('\\', "/"));
                    match client.get(&file_url).send().await {
                        Ok(resp) if resp.status().is_success() => {
                            consecutive_errors = 0;
                            let mut stream = resp.bytes_stream();
                            match tokio::fs::File::create(&local_path).await {
                                Ok(mut fout) => {
                                    use tokio::io::AsyncWriteExt;
                                    while let Some(item) = stream.next().await {
                                        if let Ok(chunk) = item {
                                            fout.write_all(&chunk).await.ok();
                                            if body.download_limit > 0 {
                                                let ms = (chunk.len() as u64 * 1000)
                                                    / (body.download_limit as u64 * 1024).max(1);
                                                if ms > 0 {
                                                    tokio::time::sleep(tokio::time::Duration::from_millis(ms)).await;
                                                }
                                            }
                                        }
                                    }
                                },
                                Err(e) => emit!("bmm://repo-sync-warning", serde_json::json!({
                                    "job_id": &job_id,
                                    "message": format!("Cannot write {}: {}", file.relative_path, e),
                                })),
                            }
                        },
                        Ok(resp) if resp.status() == reqwest::StatusCode::FORBIDDEN => {
                            bail!("Access denied (403) — repo banned or creator_id invalid. Sync stopped.");
                        },
                        Ok(resp) if resp.status() == reqwest::StatusCode::UNAUTHORIZED => {
                            bail!("Unauthorized (401) — sync stopped.");
                        },
                        Ok(resp) if resp.status().as_u16() >= 500 => {
                            // Server-side error — likely server crashed
                            consecutive_errors += 1;
                            emit!("bmm://repo-sync-warning", serde_json::json!({
                                "job_id": &job_id,
                                "message": format!("Server error HTTP {} for {} ({}/{})",
                                    resp.status(), file.relative_path, consecutive_errors, MAX_CONSECUTIVE_ERRORS),
                            }));
                            if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                                bail!(format!("Too many server errors ({}×) — repo server may have crashed. Sync stopped.", consecutive_errors));
                            }
                        },
                        Ok(resp) => emit!("bmm://repo-sync-warning", serde_json::json!({
                            "job_id": &job_id,
                            "message": format!("HTTP {} for {}", resp.status(), file.relative_path),
                        })),
                        Err(e) => {
                            // Network / connection error
                            consecutive_errors += 1;
                            let is_fatal = e.is_connect() || e.is_timeout();
                            emit!("bmm://repo-sync-warning", serde_json::json!({
                                "job_id": &job_id,
                                "message": format!("Network error ({}/{}): {}: {}",
                                    consecutive_errors, MAX_CONSECUTIVE_ERRORS, file.relative_path, e),
                            }));
                            if is_fatal || consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                                bail!(format!("Connection lost ({}{}). Sync stopped.",
                                    if is_fatal { "fatal: " } else { "" }, e));
                            }
                        },
                    }
                }
            }

            if body.delete_extra {
                let valid: std::collections::HashSet<std::path::PathBuf> = repo_mod.files.iter()
                    .map(|f| target_mod_dir.join(&f.relative_path)).collect();
                if let Ok(entries) = std::fs::read_dir(&target_mod_dir) {
                    for entry in entries.flatten() {
                        if !valid.contains(&entry.path()) { std::fs::remove_file(entry.path()).ok(); }
                    }
                }
            }

            let mod_id = {
                let mut d = data.lock().unwrap_or_else(|p| p.into_inner());
                if let Some(existing) = d.mods.iter().find(|m| m.mod_folder_path == target_mod_dir) {
                    existing.id.clone()
                } else {
                    let new_id = uuid::Uuid::new_v4().to_string();
                    d.mods.push(crate::models::mod_entry::ModEntry {
                        id: new_id.clone(),
                        name: repo_mod.name.clone(),
                        version: repo_mod.version.clone(),
                        author: repo_mod.author.clone(),
                        description: repo_mod.description.clone(),
                        dependencies: Vec::new(),
                        enabled: true,
                        conflicts: Vec::new(),
                        mod_folder_path: target_mod_dir.clone(),
                        status: crate::models::mod_entry::ModStatus::Enabled,
                        added_at: chrono::Local::now().to_rfc3339(),
                        installed_files: Vec::new(),
                        download_links: repo_mod.download_links.clone(),
                        tags: Vec::new(),
                        install_notes: String::new(),
                        activation_order: 0,
                        cached_files: None,
                        last_scan_mtime: 0,
                        file_hashes: None,
                        file_hashes_timestamp: None,
                        file_hashes_invalid: None,
                        content_id: None,
                        source_repo: None,
                        repo_mod_id: None,
                        update_url: None,
                        update_sources: Vec::new(),
                    });
                    new_id
                }
            };
            active_mod_ids.push(mod_id);
        }

        {
            let mut d = data.lock().unwrap_or_else(|p| p.into_inner());
            if is_new_profile {
                d.profiles.push(crate::models::profile::Profile {
                    id: profile_id.clone(),
                    name: repo_profile.name.clone(),
                    game_name: repo.game_name.clone(),
                    game_path: target_game_path,
                    mods_path,
                    backup_path: target_backup_path,
                    active_mods: active_mod_ids,
                    color: repo_profile.color.clone(),
                    icon: repo_profile.icon.clone(),
                    background_image: None,
                    icon_image: None,
                    created_at: chrono::Local::now().to_rfc3339(),
                    origin_repo_profile_id: Some(repo_profile.id.clone()),
                });
                profiles_created += 1;
            } else if let Some(p) = d.profiles.iter_mut().find(|p| p.id == profile_id) {
                for id in active_mod_ids {
                    if !p.active_mods.contains(&id) { p.active_mods.push(id); }
                }
            }
        }
        save_data(&data, &data_path);
    }

    emit!("bmm://repo-sync-done", serde_json::json!({
        "job_id": &job_id,
        "profiles_created": profiles_created,
        "message": "Sync completed successfully",
    }));
}

/// Zip a directory recursively into a .zip file using the `zip` crate.
fn zip_directory(src_dir: &std::path::Path, dst_zip: &std::path::Path) -> Result<(), String> {
    use std::io::Write;
    let file = std::fs::File::create(dst_zip).map_err(|e| e.to_string())?;
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);
    for entry in walkdir::WalkDir::new(src_dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        let rel = path.strip_prefix(src_dir).map_err(|e| e.to_string())?;
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        if path.is_dir() {
            if !rel_str.is_empty() {
                writer.add_directory(format!("{}/", rel_str), options).map_err(|e| e.to_string())?;
            }
        } else {
            writer.start_file(&rel_str, options).map_err(|e| e.to_string())?;
            writer.write_all(&std::fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        }
    }
    writer.finish().map_err(|e| e.to_string())?;
    Ok(())
}

#[allow(dead_code)] // Retained for reference; gen is now driven through the BMM UI.
async fn do_api_repo_gen(
    body: RepoGenBody,
    data: Arc<std::sync::Mutex<AppData>>,
    handle: tauri::AppHandle,
    job_id: String,
    cancel: Arc<AtomicBool>,
) {
    use crate::models::repo::{RepoFile, RepoMod, RepoProfile, ServerRepo};

    macro_rules! emit {
        ($event:expr, $payload:expr) => {{ let _ = handle.emit_all($event, $payload); }};
    }
    macro_rules! bail {
        ($msg:expr) => {{
            emit!("bmm://repo-export-error", serde_json::json!({ "job_id": &job_id, "error": $msg }));
            return;
        }};
    }

    if body.author_name.trim().is_empty() { bail!("authorName is required"); }
    if body.profile_ids.is_empty()        { bail!("profileIds must not be empty"); }
    if body.output_dir.is_empty()         { bail!("outputDir is required"); }

    let output_path = std::path::PathBuf::from(&body.output_dir);
    if let Err(e) = std::fs::create_dir_all(&output_path) {
        bail!(format!("Cannot create outputDir: {}", e));
    }

    let (profiles_data, all_tags, game_name) = {
        let d = data.lock().unwrap_or_else(|p| p.into_inner());
        let first_profile = match d.profiles.iter().find(|p| body.profile_ids.contains(&p.id)) {
            Some(p) => p.clone(),
            None => { drop(d); bail!("None of the specified profileIds were found"); }
        };
        let game_name = first_profile.game_name.clone();
        let mut profiles_data = Vec::new();
        for pid in &body.profile_ids {
            if let Some(profile) = d.profiles.iter().find(|p| &p.id == pid) {
                let profile_mods: Vec<_> = d.mods.iter().filter(|m| {
                    m.mod_folder_path.starts_with(&profile.mods_path)
                    || m.mod_folder_path.canonicalize().ok()
                        .zip(profile.mods_path.canonicalize().ok())
                        .map(|(a, b)| a.starts_with(b))
                        .unwrap_or(false)
                }).cloned().collect();
                profiles_data.push((profile.clone(), profile_mods));
            }
        }
        (profiles_data, d.custom_tags.clone(), game_name)
    };

    let seed = body.seed.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let mut repo = ServerRepo::new(
        format!("{} Repo", profiles_data.first().map(|(p, _)| p.name.as_str()).unwrap_or("BMM")),
        game_name,
    );
    repo.author = Some(body.author_name.clone());
    repo.seed = Some(seed);

    // In lightweight mode we skip copying files so no mods/ dir needed
    let repo_mods_dir = output_path.join("mods");
    if !body.lightweight {
        if let Err(e) = std::fs::create_dir_all(&repo_mods_dir) {
            bail!(format!("Cannot create mods dir: {}", e));
        }
    }

    // Mods that are part of this export — used to keep only deps whose target is
    // also exported (cross-profile deps to non-exported profiles are dropped).
    let exported_mod_ids: std::collections::HashSet<String> = profiles_data.iter()
        .flat_map(|(_p, mods)| mods.iter().map(|m| m.id.clone()))
        .collect();

    let total = profiles_data.len();
    for (p_idx, (profile, mods)) in profiles_data.into_iter().enumerate() {
        // Check cancellation between profiles
        if cancel.load(Ordering::SeqCst) {
            emit!("bmm://repo-export-error", serde_json::json!({
                "job_id": &job_id, "error": "Gen cancelled by user", "cancelled": true,
            }));
            return;
        }

        let mut repo_profile = RepoProfile {
            id: profile.id.clone(),
            name: profile.name.clone(),
            game_name: profile.game_name.clone(),
            mods: Vec::new(),
            icon: profile.icon.clone(),
            color: profile.color.clone(),
            icon_image: None,
        };
        let total_mods = mods.len().max(1);
        for (m_idx, mod_entry) in mods.iter().enumerate() {
            // Check cancellation between mods
            if cancel.load(Ordering::SeqCst) {
                emit!("bmm://repo-export-error", serde_json::json!({
                    "job_id": &job_id, "error": "Gen cancelled by user", "cancelled": true,
                }));
                return;
            }

            let progress = ((p_idx as f32 + m_idx as f32 / total_mods as f32) / total as f32) * 90.0;
            let mode_label = if body.lightweight { "Indexing" } else { "Exporting" };
            emit!("bmm://repo-export-progress", serde_json::json!({
                "job_id": &job_id,
                "step": format!("{} {} ({}/{})", mode_label, mod_entry.name, m_idx + 1, total_mods),
                "progress": progress, "current_file": &mod_entry.name,
                "lightweight": body.lightweight,
            }));

            let target_mod_dir = repo_mods_dir.join(&mod_entry.id);
            if !body.lightweight {
                std::fs::create_dir_all(&target_mod_dir).ok();
            }

            let resolved_tags: Vec<crate::models::repo::RepoTag> = mod_entry.tags.iter()
                .filter_map(|tid| all_tags.iter().find(|t| &t.id == tid))
                .map(|t| crate::models::repo::RepoTag {
                    id: t.id.clone(), name: t.name.clone(),
                    color_bg: t.color.clone(), color_text: "#FFFFFF".to_string(),
                }).collect();

            let dep_ids: Vec<String> = {
                let mut v: Vec<String> = Vec::new();
                for d in &mod_entry.dependencies {
                    let mid = d.split_once("::").map(|(_, m)| m.to_string()).unwrap_or_else(|| d.clone());
                    if exported_mod_ids.contains(&mid) && !v.contains(&mid) { v.push(mid); }
                }
                v
            };

            let mut repo_mod = RepoMod {
                id: mod_entry.id.clone(),
                name: mod_entry.name.clone(),
                version: mod_entry.version.clone(),
                author: mod_entry.author.clone(),
                description: mod_entry.description.clone(),
                tags: resolved_tags,
                files: Vec::new(),
                download_links: mod_entry.download_links.clone(),
                dependencies: dep_ids,
                changelog: None,
            };

            // Archived mods (.zip) read from their extracted cache view.
            let read_root = crate::archive::mod_read_root(&mod_entry.mod_folder_path);
            if let Ok(files) = crate::fs_utils::list_mod_files(&read_root) {
                for rel_path in &files {
                    let src = read_root.join(rel_path);
                    let size_src = std::fs::metadata(&src).map(|m| m.len()).unwrap_or(0);

                    if body.lightweight {
                        // Lightweight: hash source file in place, don't copy
                        if let Ok(sha) = api_sha256_file(&src) {
                            repo_mod.files.push(RepoFile {
                                relative_path: rel_path.to_string_lossy().to_string().replace('\\', "/"),
                                size: size_src, sha256_hash: sha, chunks: None,
                            });
                        }
                    } else {
                        // Full export: copy to output dir
                        let dst = target_mod_dir.join(rel_path);
                        if let Some(parent) = dst.parent() { std::fs::create_dir_all(parent).ok(); }
                        if std::fs::copy(&src, &dst).is_err() { continue; }
                        let size_dst = std::fs::metadata(&dst).map(|m| m.len()).unwrap_or(0);
                        if let Ok(sha) = api_sha256_file(&dst) {
                            repo_mod.files.push(RepoFile {
                                relative_path: rel_path.to_string_lossy().to_string().replace('\\', "/"),
                                size: size_dst, sha256_hash: sha, chunks: None,
                            });
                        }
                    }
                }
            }
            repo_profile.mods.push(repo_mod);
        }
        repo.profiles.push(repo_profile);
    }

    emit!("bmm://repo-export-progress", serde_json::json!({
        "job_id": &job_id, "step": "Writing repo.json…", "progress": 92.0, "current_file": "repo.json",
    }));
    let repo_json_path = output_path.join("repo.json");
    match serde_json::to_string_pretty(&repo) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&repo_json_path, json) {
                bail!(format!("Cannot write repo.json: {}", e));
            }
        },
        Err(e) => bail!(format!("Serialization error: {}", e)),
    }

    if body.generate_server {
        emit!("bmm://repo-export-progress", serde_json::json!({
            "job_id": &job_id, "step": "Generating server scripts…", "progress": 93.0, "current_file": "",
        }));
        let is_server = body.server_type.as_deref() == Some("server");
        let cfg = crate::commands::repo::StandaloneServerConfig {
            repo_path: body.output_dir.clone(),
            port: body.port.unwrap_or(8080),
            auto_start: if is_server { false } else { body.auto_start },
            use_cloudflare: if is_server { false } else { body.use_cloudflare },
            use_upnp: if is_server { false } else { body.use_upnp },
            lang: body.lang.clone().unwrap_or_else(|| "en".to_string()),
            upload_limit: body.upload_limit.unwrap_or(0),
            server_version: body.server_version,
            admin_password: body.admin_password.clone(),
            enable_docker: body.enable_docker,
            docker_host_type: body.docker_host_type.clone(),
            server_type: body.server_type.clone(),
        };
        if let Err(e) = crate::commands::repo::generate_standalone_server(handle.clone(), cfg).await {
            emit!("bmm://repo-export-progress", serde_json::json!({
                "job_id": &job_id,
                "step": format!("Warning: server script generation: {}", e),
                "progress": 94.0, "current_file": "",
            }));
        }
    }

    // Optional: create zip archive
    if body.zip_output {
        emit!("bmm://repo-export-progress", serde_json::json!({
            "job_id": &job_id, "step": "Creating zip archive…", "progress": 95.0, "current_file": "",
        }));
        let zip_path = output_path.with_extension("zip");
        match zip_directory(&output_path, &zip_path) {
            Ok(_) => emit!("bmm://repo-export-progress", serde_json::json!({
                "job_id": &job_id,
                "step": format!("Zip ready: {}", zip_path.display()),
                "progress": 96.0, "current_file": zip_path.to_string_lossy(),
                "zip_path": zip_path.to_string_lossy(),
            })),
            Err(e) => emit!("bmm://repo-export-progress", serde_json::json!({
                "job_id": &job_id, "step": format!("Warning: zip failed: {}", e), "progress": 96.0, "current_file": "",
            })),
        }
    }

    let zip_path = if body.zip_output { Some(output_path.with_extension("zip").to_string_lossy().to_string()) } else { None };
    emit!("bmm://repo-export-done", serde_json::json!({
        "job_id": &job_id,
        "output_dir": &body.output_dir,
        "repo_json": repo_json_path.to_string_lossy(),
        "lightweight": body.lightweight,
        "zip_path": zip_path,
        "message": "Gen completed successfully",
    }));
}

async fn handle_rejection(err: warp::Rejection) -> Result<impl warp::Reply, std::convert::Infallible> {
    let (code, msg) = if err.find::<Unauthorized>().is_some() {
        (StatusCode::UNAUTHORIZED, "Unauthorized: invalid or missing token".to_string())
    } else if let Some(denied) = err.find::<PermissionDenied>() {
        (StatusCode::FORBIDDEN, format!(
            "Forbidden: plugin '{}' lacks permission '{}' — grant it with: PUT /api/apps/permissions/{}",
            denied.plugin_id, denied.required, denied.plugin_id
        ))
    } else if err.find::<warp::filters::body::BodyDeserializeError>().is_some() {
        (StatusCode::BAD_REQUEST, "Bad request: invalid or missing JSON body".to_string())
    } else if err.find::<warp::reject::MethodNotAllowed>().is_some() {
        (StatusCode::METHOD_NOT_ALLOWED, "Method not allowed".to_string())
    } else if err.is_not_found() {
        (StatusCode::NOT_FOUND, "Not found".to_string())
    } else {
        (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error".to_string())
    };

    let base = warp::reply::with_status(warp::reply::json(&ApiError { error: msg }), code);
    let r = warp::reply::with_header(base, "access-control-allow-origin", "*");
    let r = warp::reply::with_header(r, "access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
    let r = warp::reply::with_header(r, "access-control-allow-headers", "Content-Type, Authorization, X-BMM-Plugin-Id");
    Ok(r)
}

