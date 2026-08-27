use tauri::Emitter;
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

/// Whether the server actually BOUND, as opposed to which port it tried.
///
/// The port is stored before the bind is attempted, so `api_port()` answers "which port was
/// configured" and has always answered it even when nothing was listening — after a failed
/// bind (a zombie instance holding it) the frontend went on fetching that port and filling
/// the console with ERR_CONNECTION_REFUSED, one line per feature that asked.
///
/// The two questions are separate, so they get separate answers: script generators still want
/// the configured port whatever happened, and the UI wants to know whether calling it is
/// worth doing.
static API_RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub fn api_running() -> bool { API_RUNNING.load(Ordering::Relaxed) }
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

/// `POST /api/repo/extras` — take ONE thing a repo carries that is not a mod.
///
/// One at a time rather than a list, on purpose. Each kind lands somewhere different — a
/// plugin on disk, an automation in the scheduler, a catalogue in the source list — and a
/// batch endpoint would have to report five outcomes in one status code.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RepoExtraBody {
    /// The repo, the same URL `/api/repo/info` takes.
    url: String,
    /// Which entry, matched against what `/api/repo/info` returned under `extras`.
    kind: String,
    id: String,
    #[serde(default)]
    creator_id: Option<String>,
    #[serde(default)]
    password: Option<String>,
}

/// `POST /api/mods/order` — set the deployment order.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ModOrderBody {
    /// The full order. Must be the same set of mods that are active.
    order: Vec<String>,
    #[serde(default)]
    profile_id: Option<String>,
}

/// `POST /api/schedules/enabled` — arm or disarm one saved task.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScheduleEnabledBody {
    id: String,
    enabled: bool,
}

/// `POST /api/repo/modpacks` — which modpacks a repo FOLDER on this machine shares.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoModpacksBody {
    /// The repo folder, the one that holds repo.json.
    dir: String,
    /// The whole list. Absent reads instead of writing.
    shares: Option<Vec<crate::models::repo::RepoModpackShare>>,
}

/// `POST /api/content-id` — what a document IS, as a stable name.
#[derive(Deserialize)]
struct ContentIdBody {
    /// modpack · plugin · task · profile · theme · launchpack · repo · app · modlist
    kind: String,
    /// The document itself. Supplied by the caller, never looked up here — see the route.
    doc: serde_json::Value,
}

/// `POST /api/hook` — ring a named doorbell a scheduled task can be waiting on.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HookBody {
    name: String,
    /// Anything the caller wants the waiting task to receive. Free-form on purpose.
    #[serde(default)]
    data: Option<serde_json::Value>,
}

/// `POST /api/catalogs` — follow or stop following a catalogue.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CatalogFollowBody {
    /// `plugin` · `theme` · `preset` · `modpack` · `repo` · `tutorial` · `list` · `app`.
    #[serde(rename = "type")]
    kind: String,
    url: String,
    /// `false` to stop following it.
    #[serde(default = "yes")]
    follow: bool,
}
fn yes() -> bool { true }

/// `POST /api/keys` — make an identity keypair.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NewKeyBody {
    name: String,
    /// `ed25519` (default) · `ecdsa` · `rsa`.
    #[serde(default)]
    kind: Option<String>,
}

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
    /// Optional download password for a password-protected self-hosted repo.
    #[serde(default)]
    password: Option<String>,
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
    /// Only generate repo.json manifest without copying mod files. Pair it with
    /// `files_base_url` to publish a manifest for mods you already host.
    #[serde(default)]
    lightweight: bool,
    /// Where the mod files live, when that is not "next to repo.json". Written into the
    /// manifest as `files_base_url`; clients resolve `<this>/mods/<id>/<path>`. Leave unset
    /// and everything behaves as before.
    #[serde(default)]
    files_base_url: Option<String>,
    /// Compress output directory into a .zip archive after gen
    #[serde(default)]
    zip_output: bool,
    /// Pack each mod into a single mods/<id>.zip (instead of raw per-file copy).
    #[serde(default)]
    zip_mods: bool,
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
    /// Direct-download archive URL for updates. Empty clears it.
    #[serde(default)]
    direct_url: Option<String>,
}

/// POST /api/mod/update — request applying an update (UI-driven).
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ModUpdateApiBody {
    /// Origin repo URL to re-sync from. When omitted, just opens the update check.
    #[serde(default)]
    repo_url: Option<String>,
}

#[derive(serde::Deserialize)]
struct TelemetryConsentBody { #[serde(default)] enabled: bool }
#[derive(serde::Deserialize)]
struct TelemetrySettingsBody {
    #[serde(default)] replay: Option<bool>,
    #[serde(default)] full: Option<bool>,
    #[serde(default)] bench: Option<bool>,
}
#[derive(serde::Deserialize)]
struct RecorderBody {
    #[serde(default)] on: Option<bool>,
    #[serde(default)] full: Option<bool>,
    #[serde(default)] rust: Option<bool>,
    #[serde(default)] js: Option<bool>,
}
/// Optional body for POST /api/replay/export. `Default` matters: the filter falls back to
/// it when no body is sent, so an old caller that posts nothing keeps the save-dialog path.
#[derive(serde::Deserialize, Default)]
struct ReplayExportBody {
    #[serde(default)] path: Option<String>,
}
/// Body for POST /api/view — which screen to show.
#[derive(serde::Deserialize)]
struct ViewBody {
    id: String,
}
#[derive(serde::Deserialize)]
struct ReplayImportBody {
    #[serde(default)] path: Option<String>,
    #[serde(default)] url: Option<String>,
}
#[derive(serde::Deserialize)]
struct DiscordRpcBody { #[serde(default)] enabled: bool }
#[derive(serde::Deserialize)]
struct IdBody { #[serde(default)] id: String }
#[derive(serde::Deserialize)]
struct DataExportAutoBody {
    #[serde(default)] dir: String,
    #[serde(default)] name: Option<String>,
    #[serde(default)] increment: Option<String>,
}

#[derive(serde::Deserialize)]
struct BenchmarkApiBody {
    /// "sandbox" (default) or "real".
    #[serde(default)]
    dataset: Option<String>,
    /// S | M | L | XL | CUSTOM (default M).
    #[serde(default)]
    size: Option<String>,
    /// Dataset size in MB when size == CUSTOM.
    #[serde(default)]
    mb: Option<u64>,
    /// Mod folder paths to benchmark when dataset == "real" (absolute or relative
    /// to BMM's working dir).
    #[serde(default)]
    sources: Option<Vec<String>>,
    /// Profile ids/names — resolved to their mods folder and added to `sources`.
    #[serde(default)]
    profiles: Option<Vec<String>>,
    /// "manual" (default) — open the benchmark in the UI, the user starts it; or
    /// "auto" — run it now in the background and return the results in the response.
    #[serde(default)]
    mode: Option<String>,
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
    let _ = handle.emit("bmm://api-exec", serde_json::json!({ "action": action, "params": params }));
    warp::reply::with_status(
        warp::reply::json(&serde_json::json!({ "ok": true, "driven_by": "bmm-ui", "action": action })),
        StatusCode::ACCEPTED,
    )
}

fn save_data(data: &Arc<std::sync::Mutex<AppData>>, path: &PathBuf) {
    let d = data.lock().unwrap_or_else(|p| p.into_inner());
    // keep a rolling backup, then crash-safe atomic write (temp + fsync + rename)
    if path.exists() {
        let _ = std::fs::copy(path, path.with_extension("json.bak"));
    }
    let _ = crate::state::atomic_write_json(path, &*d);
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

/// Every permission a plugin can be granted.
///
/// The ONE list. The router demands these strings, the settings screen draws checkboxes from
/// them, and the test below asserts the two agree in both directions — a scope the router
/// demands but nobody can grant is a route nothing can reach, and a checkbox for a scope no
/// route demands is a promise of protection that protects nothing. Both had happened:
/// `mods.read` was enforced and ungrantable.
///
/// Read and write are separate everywhere, because knowing is not the same permission as
/// changing — and for keys it is the whole point: listing what identities exist is not
/// minting one that signs on the user's behalf.
pub const PLUGIN_SCOPES: [&str; 26] = [
    "app.read", "app.write",
    "catalog.read", "catalog.write",
    "data.read", "data.write",
    "hooks.read", "hooks.write",
    "keys.read", "keys.write",
    "modpacks.read", "modpacks.write",
    "mods.read", "mods.write",
    "plugins.read", "plugins.write",
    "profiles.read", "profiles.write",
    // A session recording is a video of the person's screen inside BMM — their paths,
    // their profile names, whatever a page happened to be showing. It had no scope of its
    // own: exporting one was gated by `telemetry.write`, so a plugin that wanted to hand
    // back a recording had to be granted the power to turn telemetry ON, and a plugin
    // granted that could quietly export the session without ever asking for it.
    "replay.read", "replay.write",
    "repo.read", "repo.write",
    "schedules.read", "schedules.write",
    "system.write",
    "telemetry.write",
];

#[cfg(test)]
mod scope_tests {
    use super::PLUGIN_SCOPES;

    /// Every string this file demands, extracted from this file.
    fn demanded() -> Vec<String> {
        let src = include_str!("mod.rs");
        let mut out = Vec::new();
        for (i, _) in src.match_indices("require_permission(") {
            // `require_permission(<expr>, "scope")` — take the quoted argument after it.
            let rest = &src[i..];
            let Some(q) = rest.find('"') else { continue };
            let Some(end) = rest[q + 1..].find('"') else { continue };
            let name = &rest[q + 1..q + 1 + end];
            // The doc comments above mention the function by name; only a real call has a
            // scope-shaped argument on the same line.
            if name.contains('.') && !out.contains(&name.to_string()) {
                out.push(name.to_string());
            }
        }
        out
    }

    #[test]
    fn every_scope_the_router_demands_can_be_granted() {
        for name in demanded() {
            assert!(
                PLUGIN_SCOPES.contains(&name.as_str()),
                "the router demands `{name}`, and nothing can grant it — that route is unreachable"
            );
        }
    }

    #[test]
    fn every_scope_that_can_be_granted_gates_something() {
        // A checkbox for a scope no route demands reads as protection and is decoration.
        let d = demanded();
        for name in PLUGIN_SCOPES {
            assert!(
                d.contains(&name.to_string()),
                "`{name}` can be granted and gates no route"
            );
        }
    }

    #[test]
    fn the_list_is_sorted_and_has_no_duplicates() {
        let mut sorted = PLUGIN_SCOPES.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), PLUGIN_SCOPES.len(), "a duplicate scope");
        assert_eq!(sorted, PLUGIN_SCOPES.to_vec(), "keep it sorted — it is read as a list");
    }
}

/// The admin token and nothing else.
///
/// `require_token` deliberately accepts a per-plugin token too, and `require_permission`
/// then decides what that plugin may do. That is right for every route EXCEPT the ones that
/// write the permission table: a plugin holding a token could `PUT /api/apps/permissions/
/// <itself>` and grant itself every scope, which makes the whole table decorative.
///
/// Nothing a plugin legitimately does needs to read or write another plugin's grants. This
/// is for the app's own screens, the CLI and MCP — all of which hold the admin token.
fn require_admin_token(
    data: Arc<std::sync::Mutex<AppData>>,
) -> impl Filter<Extract = (), Error = warp::Rejection> + Clone {
    warp::header::optional::<String>("authorization")
        .and_then(move |auth: Option<String>| {
            let provided = auth.unwrap_or_default();
            let ok = {
                let d = data.lock().unwrap_or_else(|p| p.into_inner());
                ct_eq(provided.strip_prefix("Bearer ").unwrap_or(""), &d.settings.api_token)
            };
            async move {
                if ok { Ok(()) } else { Err(warp::reject::custom(Unauthorized)) }
            }
        })
        .untuple_one()
}

#[derive(Debug)]
struct Unauthorized;
impl warp::reject::Reject for Unauthorized {}

/// Plugin permission gate rejection.
/// Identity is resolved by `require_permission` from the BEARER TOKEN, never from the
/// (spoofable) `X-BMM-Plugin-Id` header: the admin token grants full access, and a
/// per-plugin token maps to that plugin's `plugin_permissions`. A plugin therefore
/// cannot escalate by omitting or forging the header (CWE-862/863).
#[derive(Debug)]
struct PermissionDenied { required: &'static str, plugin_id: String }
impl warp::reject::Reject for PermissionDenied {}

// ── Local catalog helpers (module-level so they can be called from warp closures) ──
fn catalog_path(h: &tauri::AppHandle) -> std::path::PathBuf {
    h.path().app_data_dir().ok().unwrap_or_default().join("apps-catalog.json")
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
        .and(require_permission(token.clone(), "mods.read"))
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
        .and(require_permission(token.clone(), "mods.read"))
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
        .and(require_permission(token.clone(), "data.read"))
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
        .and(require_permission(token.clone(), "mods.read"))
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
        .and(require_permission(token.clone(), "profiles.read"))
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
        .and(require_permission(token.clone(), "plugins.read"))
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
                    let prev_sigs: std::collections::HashMap<String, Option<String>> = m.update_sources.iter()
                        .filter(|s| s.is_direct())
                        .map(|s| (s.repo_url.trim().to_string(), s.sig.clone()))
                        .collect();
                    m.update_sources = srcs.into_iter()
                        .filter(|s| !s.repo_url.trim().is_empty())
                        .map(|mut s| {
                            if s.is_direct() {
                                s.kind = "direct".to_string();
                                s.repo_url = s.repo_url.trim().to_string();
                                s.repo_mod_id = None;
                                s.sig = prev_sigs.get(&s.repo_url).cloned().flatten();
                            } else {
                                s.kind = "repo".to_string();
                                s.repo_url = crate::commands::repo::normalize_repo_url(&s.repo_url);
                                s.repo_mod_id = s.repo_mod_id.filter(|r| !r.trim().is_empty());
                                s.sig = None;
                            }
                            s
                        })
                        .collect();
                }
                if let Some(url) = body.direct_url {
                    let t = url.trim();
                    let new_url = if t.is_empty() { None } else { Some(t.to_string()) };
                    if new_url != m.direct_url { m.direct_sig = None; }
                    m.direct_url = new_url;
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
        .and(require_permission(token.clone(), "mods.write"))
        .and(with_app_handle(handle_mod_check))
        .map(|handle: tauri::AppHandle| {
            let _ = handle.emit("bmm://api-exec", serde_json::json!({
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
        .and(require_permission(token.clone(), "mods.write"))
        .and(warp::body::json::<ModUpdateApiBody>())
        .and(with_app_handle(handle_mod_update))
        .map(|body: ModUpdateApiBody, handle: tauri::AppHandle| {
            let _ = handle.emit("bmm://api-exec", serde_json::json!({
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

    // POST /api/telemetry/consent  (auth) — enable/disable "Share anonymous usage
    // data". Body: { enabled: bool }.
    let tok_tc = token.clone();
    let handle_tc = app_handle.clone();
    let telemetry_consent = warp::path!("api" / "telemetry" / "consent")
        .and(warp::post())
        .and(require_token(tok_tc))
        .and(require_permission(token.clone(), "telemetry.write"))
        .and(warp::body::json::<TelemetryConsentBody>())
        .and(with_app_handle(handle_tc))
        .map(|body: TelemetryConsentBody, handle: tauri::AppHandle| {
            let _ = handle.emit("bmm://api-exec", serde_json::json!({
                "action": "telemetry/consent", "params": { "enabled": body.enabled }
            }));
            warp::reply::with_status(warp::reply::json(&serde_json::json!({
                "ok": true, "driven_by": "bmm-ui", "action": "telemetry/consent", "enabled": body.enabled
            })), StatusCode::ACCEPTED)
        });

    // POST /api/telemetry/settings  (auth) — manage sub-options of Privacy & telemetry.
    // Body: { replay?: bool, full?: bool, bench?: bool } (omitted = unchanged).
    let tok_ts = token.clone();
    let handle_ts = app_handle.clone();
    let telemetry_settings = warp::path!("api" / "telemetry" / "settings")
        .and(warp::post())
        .and(require_token(tok_ts))
        .and(require_permission(token.clone(), "telemetry.write"))
        .and(warp::body::json::<TelemetrySettingsBody>())
        .and(with_app_handle(handle_ts))
        .map(|body: TelemetrySettingsBody, handle: tauri::AppHandle| {
            let _ = handle.emit("bmm://api-exec", serde_json::json!({
                "action": "telemetry/set",
                "params": { "replay": body.replay, "full": body.full, "bench": body.bench }
            }));
            warp::reply::with_status(warp::reply::json(&serde_json::json!({
                "ok": true, "driven_by": "bmm-ui", "action": "telemetry/set"
            })), StatusCode::ACCEPTED)
        });

    // POST /api/view  (auth) — show a screen. Body: { id: "mapper" | "library" | … }.
    // The id is the sidebar's own data-view value; an unknown one is a no-op that says so in
    // the app's console, exactly as the bmm://view/open deeplink behaves.
    let tok_view = token.clone();
    let handle_view = app_handle.clone();
    let view = warp::path!("api" / "view")
        .and(warp::post())
        .and(require_token(tok_view))
        .and(require_permission(token.clone(), "system.write"))
        .and(warp::body::json::<ViewBody>())
        .and(with_app_handle(handle_view))
        .map(|body: ViewBody, handle: tauri::AppHandle| {
            api_exec_reply(&handle, "view/open", serde_json::json!({ "id": body.id }))
        });

    // POST /api/recorder  (auth) — configure the local Session recorder.
    // Body: { on?: bool, full?: bool, rust?: bool, js?: bool }.
    let tok_rec = token.clone();
    let handle_rec = app_handle.clone();
    let recorder = warp::path!("api" / "recorder")
        .and(warp::post())
        .and(require_token(tok_rec))
        .and(require_permission(token.clone(), "telemetry.write"))
        .and(warp::body::json::<RecorderBody>())
        .and(with_app_handle(handle_rec))
        .map(|body: RecorderBody, handle: tauri::AppHandle| {
            let _ = handle.emit("bmm://api-exec", serde_json::json!({
                "action": "recorder/set",
                "params": { "on": body.on, "full": body.full, "rust": body.rust, "js": body.js }
            }));
            warp::reply::with_status(warp::reply::json(&serde_json::json!({
                "ok": true, "driven_by": "bmm-ui", "action": "recorder/set"
            })), StatusCode::ACCEPTED)
        });

    // POST /api/replay/export  (auth) — export the current local session recording.
    let tok_rex = token.clone();
    let handle_rex = app_handle.clone();
    // Body is OPTIONAL: `{}` keeps the old behaviour (the UI asks where to save),
    // `{ "path": "C:/…/tour.bmmreplay" }` writes straight there. A driver over this API has
    // nobody to answer a native save dialog, so without the path the call would appear to
    // succeed and then hang on a picker.
    let replay_export = warp::path!("api" / "replay" / "export")
        .and(warp::post())
        .and(require_token(tok_rex))
        // Reading the recording, not changing what is recorded.
        .and(require_permission(token.clone(), "replay.read"))
        .and(warp::body::json::<ReplayExportBody>().or(warp::any().map(ReplayExportBody::default)).unify())
        .and(with_app_handle(handle_rex))
        .map(|body: ReplayExportBody, handle: tauri::AppHandle| {
            let _ = handle.emit("bmm://api-exec", serde_json::json!({
                "action": "replay/export",
                "params": { "path": body.path }
            }));
            warp::reply::with_status(warp::reply::json(&serde_json::json!({
                "ok": true, "driven_by": "bmm-ui", "action": "replay/export"
            })), StatusCode::ACCEPTED)
        });

    // POST /api/replay/import  (auth) — import + play a .bmmreplay. Body:
    // { path?: string (absolute file path), url?: string (download link) }.
    let tok_rim = token.clone();
    let handle_rim = app_handle.clone();
    let replay_import = warp::path!("api" / "replay" / "import")
        .and(warp::post())
        .and(require_token(tok_rim))
        // Playing somebody else's recording inside the app changes what is on screen.
        .and(require_permission(token.clone(), "replay.write"))
        .and(warp::body::json::<ReplayImportBody>())
        .and(with_app_handle(handle_rim))
        .map(|body: ReplayImportBody, handle: tauri::AppHandle| {
            let _ = handle.emit("bmm://api-exec", serde_json::json!({
                "action": "replay/import", "params": { "path": body.path, "url": body.url }
            }));
            warp::reply::with_status(warp::reply::json(&serde_json::json!({
                "ok": true, "driven_by": "bmm-ui", "action": "replay/import"
            })), StatusCode::ACCEPTED)
        });

    // POST /api/launchpack/run  (auth) — run a saved launch pack. Body: { id }.
    let tok_lp = token.clone();
    let handle_lp = app_handle.clone();
    let launchpack_run = warp::path!("api" / "launchpack" / "run")
        .and(warp::post())
        .and(require_token(tok_lp))
        .and(require_permission(token.clone(), "app.write"))
        .and(warp::body::json::<IdBody>())
        .and(with_app_handle(handle_lp))
        .map(|body: IdBody, handle: tauri::AppHandle| {
            let _ = handle.emit("bmm://api-exec", serde_json::json!({
                "action": "launchpack/run", "params": { "id": body.id }
            }));
            warp::reply::with_status(warp::reply::json(&serde_json::json!({
                "ok": true, "driven_by": "bmm-ui", "action": "launchpack/run"
            })), StatusCode::ACCEPTED)
        });

    // POST /api/schedule/run  (auth) — trigger a saved scheduler task. Body: { id }.
    let tok_sr = token.clone();
    let handle_sr = app_handle.clone();
    let schedule_run = warp::path!("api" / "schedule" / "run")
        .and(warp::post())
        .and(require_token(tok_sr))
        .and(require_permission(token.clone(), "schedules.write"))
        .and(warp::body::json::<IdBody>())
        .and(with_app_handle(handle_sr))
        .map(|body: IdBody, handle: tauri::AppHandle| {
            let _ = handle.emit("bmm://api-exec", serde_json::json!({
                "action": "schedule/run", "params": { "id": body.id }
            }));
            warp::reply::with_status(warp::reply::json(&serde_json::json!({
                "ok": true, "driven_by": "bmm-ui", "action": "schedule/run"
            })), StatusCode::ACCEPTED)
        });

    // POST /api/discord/rpc  (auth) — enable/disable Discord Rich Presence.
    let tok_dr = token.clone();
    let handle_dr = app_handle.clone();
    let discord_rpc = warp::path!("api" / "discord" / "rpc")
        .and(warp::post())
        .and(require_token(tok_dr))
        .and(require_permission(token.clone(), "system.write"))
        .and(warp::body::json::<DiscordRpcBody>())
        .and(with_app_handle(handle_dr))
        .map(|body: DiscordRpcBody, handle: tauri::AppHandle| {
            let _ = handle.emit("bmm://api-exec", serde_json::json!({
                "action": "discord/rpc", "params": { "enabled": body.enabled }
            }));
            warp::reply::with_status(warp::reply::json(&serde_json::json!({
                "ok": true, "driven_by": "bmm-ui", "action": "discord/rpc", "enabled": body.enabled
            })), StatusCode::ACCEPTED)
        });

    // POST /api/data/export-auto  (auth) — unattended data backup. Body:
    // { dir: string, name?: string (template: {date}{time}{datetime}), increment?:
    //   "paren"|"underscore"|"timestamp"|"overwrite" }.
    let tok_dea = token.clone();
    let handle_dea = app_handle.clone();
    let data_export_auto = warp::path!("api" / "data" / "export-auto")
        .and(warp::post())
        .and(require_token(tok_dea))
        .and(require_permission(token.clone(), "data.read"))
        .and(warp::body::json::<DataExportAutoBody>())
        .and(with_app_handle(handle_dea))
        .map(|body: DataExportAutoBody, handle: tauri::AppHandle| {
            let _ = handle.emit("bmm://api-exec", serde_json::json!({
                "action": "data/export-auto",
                "params": { "dir": body.dir, "name": body.name, "increment": body.increment }
            }));
            warp::reply::with_status(warp::reply::json(&serde_json::json!({
                "ok": true, "driven_by": "bmm-ui", "action": "data/export-auto"
            })), StatusCode::ACCEPTED)
        });

    // POST /api/benchmark  (auth) — launch a benchmark. Body:
    //   { dataset?: "sandbox"|"real", size?: S|M|L|XL|CUSTOM, mb?: number,
    //     sources?: string[] (mod folders for "real"), mode?: "manual"|"auto" }.
    // manual → open the benchmark in the UI pre-filled, the user starts it (202).
    // auto   → run it now in the background and return the report in the response.
    let tok_bench = token.clone();
    let handle_bench = app_handle.clone();
    let benchmark = warp::path!("api" / "benchmark")
        .and(warp::post())
        .and(require_token(tok_bench))
        .and(require_permission(token.clone(), "system.write"))
        .and(warp::body::json::<BenchmarkApiBody>())
        .and(with_app_handle(handle_bench))
        .and_then(|body: BenchmarkApiBody, handle: tauri::AppHandle| async move {
            let dataset = if body.dataset.as_deref() == Some("real") { "real" } else { "sandbox" };
            let size = body.size.unwrap_or_else(|| "M".into()).to_uppercase();
            let scale = match size.as_str() {
                "S" => "small".to_string(),
                "L" => "large".to_string(),
                "XL" => "xlarge".to_string(),
                "CUSTOM" => format!("custom:{}", body.mb.unwrap_or(256).max(1)),
                _ => "medium".to_string(),
            };
            // Folders (absolute or relative) + profile ids/names resolved to their
            // mods folder. Any source ⇒ a "real" run.
            let mut sources: Vec<String> = body.sources.clone().unwrap_or_default();
            if let Some(profs) = &body.profiles {
                if !profs.is_empty() {
                    if let Ok(data) = handle.state::<crate::state::AppState>().data.lock() {
                        for pid in profs {
                            if let Some(p) = data.profiles.iter().find(|x| &x.id == pid || &x.name == pid) {
                                let mp = p.mods_path.to_string_lossy().to_string();
                                if !mp.is_empty() && !sources.contains(&mp) { sources.push(mp); }
                            }
                        }
                    }
                }
            }
            let dataset = if body.dataset.as_deref() == Some("real") || !sources.is_empty() { "real" } else { dataset };
            let is_auto = body.mode.as_deref() == Some("auto");

            if is_auto {
                // Run headless in the backend and return the results synchronously.
                let window = match handle.get_webview_window("main") {
                    Some(w) => w,
                    None => return Ok::<_, warp::Rejection>(warp::reply::with_status(
                        warp::reply::json(&serde_json::json!({ "ok": false, "error": "main window not available" })),
                        StatusCode::SERVICE_UNAVAILABLE,
                    )),
                };
                let real_sources = if dataset == "real" { Some(sources) } else { None };
                match crate::commands::benchmark::run_app_benchmark(window, dataset.to_string(), real_sources, Some(scale)).await {
                    Ok(report) => Ok(warp::reply::with_status(
                        warp::reply::json(&serde_json::json!({
                            "ok": true, "mode": "auto", "dataset": dataset, "size": size, "report": report
                        })),
                        StatusCode::OK,
                    )),
                    Err(e) => Ok(warp::reply::with_status(
                        warp::reply::json(&serde_json::json!({ "ok": false, "mode": "auto", "error": e })),
                        StatusCode::CONFLICT,
                    )),
                }
            } else {
                // Manual: open the benchmark UI pre-filled; the user clicks Run.
                let _ = handle.emit("bmm://api-exec", serde_json::json!({
                    "action": "benchmark/open",
                    "params": { "dataset": dataset, "size": size, "mb": body.mb, "sources": sources, "autoRun": false }
                }));
                Ok(warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({
                        "ok": true, "mode": "manual", "driven_by": "bmm-ui", "action": "benchmark/open", "dataset": dataset, "size": size
                    })),
                    StatusCode::ACCEPTED,
                ))
            }
        });

    // GET /api/check-update  (public, no token required)
    let check_update = warp::path!("api" / "check-update")
        .and(warp::get())
        .and_then(|| async move {
            let current = env!("CARGO_PKG_VERSION");
            let resp = crate::commands::net::client()
                .get("https://api.github.com/repos/FreeProject089/BetterModsManager/releases/latest")
                .header(reqwest::header::USER_AGENT, "BetterModManager")
                .timeout(std::time::Duration::from_secs(10))
                .send().await;
            let body: serde_json::Value = match resp {
                Ok(r) if r.status().is_success() => r.json().await.unwrap_or(serde_json::Value::Null),
                Ok(r) => return Ok::<_, warp::Rejection>(warp::reply::with_status(
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
    let handle_restart = app_handle.clone();
    let restart = warp::path!("api" / "restart")
        .and(warp::post())
        .and(require_token(tok_restart))
        .and(require_permission(token.clone(), "system.write"))
        .and(with_app_handle(handle_restart))
        .map(|handle: tauri::AppHandle| {
            // Use Tauri's own restart: it relaunches with the correct entry point
            // (the dev server URL under `tauri dev`, the bundled app in prod) and
            // then exits. The old approach respawned current_exe() + exit(0), which
            // under `tauri dev` launched a bare exe that couldn't reach the dev
            // server, so BMM just closed instead of restarting.
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(300));
                handle.restart();
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
        .and(require_permission(token.clone(), "modpacks.read"))
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
        .and(require_permission(token.clone(), "repo.read"))
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
            // Optional download password for a password-protected self-hosted repo — forwarded
            // as X-Repo-Password so a caller (quicktest / MCP / CLI) can read a protected repo.
            let mut req = crate::commands::net::client().get(&target)
                .header(reqwest::header::USER_AGENT, "BetterModManager")
                .timeout(std::time::Duration::from_secs(15));
            if let Some(pw) = query.get("password") { if !pw.is_empty() { req = req.header("X-Repo-Password", pw.clone()); } }
            match req.send().await {
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
                Ok(r) if r.status() == reqwest::StatusCode::UNAUTHORIZED => Ok(warp::reply::with_status(
                    warp::reply::json(&ApiError { error: "Repo password required (401)".into() }),
                    StatusCode::UNAUTHORIZED,
                )),
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
                None => match crate::commands::net::client().get(&target)
                    .header(reqwest::header::USER_AGENT, "BetterModManager")
                    .timeout(std::time::Duration::from_secs(8))
                    .send().await
                {
                    Ok(r) if r.status().is_success() => {
                        let j: serde_json::Value = r.json().await.unwrap_or_default();
                        j["name"].as_str().unwrap_or(&url).to_string()
                    },
                    _ => url.clone(),
                },
            };
            {
                let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
                if !data.settings.connected_server_repos.iter().any(|r| r.url == url) {
                    data.settings.connected_server_repos.push(crate::state::ConnectedServerRepo {
                        url: url.clone(),
                        name: repo_name.clone(),
                        auto_sync: false,
                        auto_sync_mode: None,
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
        .and(require_permission(token.clone(), "repo.read"))
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
        .and(require_permission(token.clone(), "repo.write"))
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
                    let _ = handle.emit("bmm://api-rejected", serde_json::json!({
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
            let _ = handle.emit("bmm://api-exec", serde_json::json!({
                "action": "repo/sync",
                "params": {
                    "url": body.url,
                    "gameDir": body.game_dir,
                    "modsDir": body.mods_dir,
                    "backupDir": body.backup_dir,
                    "overwriteAll": body.overwrite_all,
                    "deleteExtra": body.delete_extra,
                    "downloadLimit": body.download_limit,
                    "password": body.password,
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
        .and(require_permission(token.clone(), "repo.write"))
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

    // POST /api/repo/manifest  (auth) — generate repo.json for a folder of mods that is
    // already hosted. Unlike /api/repo/gen this needs no profile and copies nothing: it
    // reads the directory, writes one file, and leaves the directory untouched. Synchronous
    // (it only hashes) so a publish script can act on the diff it returns.
    let tok_repo_manifest = token.clone();
    let data_repo_manifest = data.clone();
    let handle_repo_manifest = app_handle.clone();
    let repo_manifest = warp::path!("api" / "repo" / "manifest")
        .and(warp::post())
        .and(require_token(tok_repo_manifest))
        .and(require_permission(token.clone(), "repo.write"))
        .and(warp::body::json::<crate::commands::repo::GenerateManifestArgs>())
        .and(with_data(data_repo_manifest))
        .and(with_app_handle(handle_repo_manifest))
        .then(|mut args: crate::commands::repo::GenerateManifestArgs,
               data: Arc<std::sync::Mutex<AppData>>,
               handle: tauri::AppHandle| async move {
            // Same modpack remap + signing as the UI path — a manifest generated over the
            // API must be indistinguishable from one generated by a click, or a publish
            // script silently produces unsigned repos.
            // Profiles resolve to folders here too, by the same rule — a publish script that
            // says "these profiles" must mean what the button means.
            if let Some(ids) = args.profile_ids.clone().filter(|v| !v.is_empty()) {
                let resolved = {
                    let d = data.lock().unwrap_or_else(|p| p.into_inner());
                    crate::commands::repo::sources_from_profiles(&d, &ids)
                };
                match resolved {
                    Ok(from_profiles) => {
                        let mut all = args.sources.take().unwrap_or_default();
                        all.extend(from_profiles);
                        args.sources = Some(all);
                    }
                    Err(e) => return warp::reply::with_status(
                        warp::reply::json(&serde_json::json!({ "ok": false, "error": e })),
                        StatusCode::BAD_REQUEST,
                    ),
                }
            }
            let (packs, folder_of) = {
                let d = data.lock().unwrap_or_else(|p| p.into_inner());
                let folder_of: std::collections::HashMap<String, String> = d.mods.iter()
                    .filter_map(|m| {
                        let name = m.mod_folder_path.file_name()?.to_string_lossy().to_string();
                        Some((m.id.clone(), name))
                    })
                    .collect();
                let wanted = args.modpack_ids.clone().unwrap_or_default();
                let packs: Vec<crate::models::modpack::LocalModpack> = d.modpacks.iter()
                    .filter(|mp| wanted.iter().any(|w| w == &mp.id))
                    .cloned()
                    .collect();
                (packs, folder_of)
            };
            let share_mode = args.modpack_share_mode.clone().unwrap_or_else(|| "public".to_string());
            let handle2 = handle.clone();
            let res = tauri::async_runtime::spawn_blocking(move || {
                crate::commands::repo::generate_repo_manifest_sync(
                    args, packs, folder_of, share_mode,
                    |bytes| crate::commands::security::sign_message(&handle2, bytes),
                    move |done, total, name| {
                        let _ = handle.emit("bmm://repo-manifest-progress", serde_json::json!({
                            "done": done, "total": total, "name": name,
                            "progress": if total == 0 { 0.0 } else { done as f64 * 100.0 / total as f64 },
                        }));
                    },
                )
            }).await;
            match res {
                Ok(Ok(report)) => warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({ "ok": true, "report": report })),
                    StatusCode::OK,
                ),
                Ok(Err(e)) => warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({ "ok": false, "error": e })),
                    StatusCode::BAD_REQUEST,
                ),
                Err(e) => warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({ "ok": false, "error": e.to_string() })),
                    StatusCode::INTERNAL_SERVER_ERROR,
                ),
            }
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
                    let _ = handle.emit("bmm://api-rejected", serde_json::json!({
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
            let _ = handle.emit("bmm://api-exec", serde_json::json!({
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
        .and(require_permission(token.clone(), "repo.write"))
        .and(warp::body::json::<RepoUpdateBody>())
        .and(with_app_handle(handle_repo_update))
        .map(|body: RepoUpdateBody, handle: tauri::AppHandle| {
            // Drive through the BMM interface (same UI-driven pattern as repo/gen)
            let _ = handle.emit("bmm://api-exec", serde_json::json!({
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
        .and(require_permission(token.clone(), "repo.write"))
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
                    let _ = handle.emit("bmm://api-rejected", serde_json::json!({
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
            let _ = handle.emit("bmm://api-exec", serde_json::json!({
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
        .and(require_permission(token.clone(), "repo.write"))
        .and(with_http_host_shutdown(http_host_stop))
        .and(with_app_handle(handle_repo_host_stop))
        .map(|_shutdown: HttpHostShutdown, handle: tauri::AppHandle| {
            // Stop the native repo server through the BMM interface (toggles the
            // Server Repo "Stop" button) — mirrors the human action.
            let _ = handle.emit("bmm://api-exec", serde_json::json!({ "action": "repo/host-stop" }));
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({ "ok": true, "driven_by": "bmm-ui", "message": "HTTP host stop requested through the BMM interface." })),
                StatusCode::OK,
            )
        });

    // POST /api/repo/publish-ssh  (auth) — publish an exported repo over SSH.
    //
    // Body: { "dir": "<exported folder>" }. The TARGET is not in the body and cannot be:
    // host, user, key path and remote folder come from what the owner saved in Server Repo.
    // An API caller that could name a host and a key path would be able to make BMM read a
    // private key of its choosing and ship a repo to a machine of its choosing — the call
    // says "publish what I already configured", and that is all it can say.
    //
    // Driven through the UI like repo/host, so an upload started this way is visible and
    // cancellable on the screen rather than happening invisibly in the background.
    let tok_repo_ssh = token.clone();
    let handle_repo_ssh = app_handle.clone();
    let repo_publish_ssh = warp::path!("api" / "repo" / "publish-ssh")
        .and(warp::post())
        .and(require_token(tok_repo_ssh))
        .and(require_permission(token.clone(), "repo.write"))
        .and(warp::body::json::<serde_json::Value>())
        .and(with_app_handle(handle_repo_ssh))
        .map(|body: serde_json::Value, handle: tauri::AppHandle| {
            let dir = body.get("dir").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if dir.trim().is_empty() {
                return warp::reply::with_status(
                    warp::reply::json(&ApiError { error: "dir is required".into() }),
                    StatusCode::BAD_REQUEST,
                );
            }
            let _ = handle.emit("bmm://api-exec", serde_json::json!({
                "action": "repo/publish-ssh",
                "params": { "dir": dir }
            }));
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({
                    "ok": true,
                    "driven_by": "bmm-ui",
                    "message": "SSH publish requested through the BMM interface."
                })),
                StatusCode::ACCEPTED,
            )
        });

    // POST /api/repo/fetch-ssh  (auth) — fetch a repo back down from the server.
    //
    // The mirror of publish-ssh, with the same rule about the target: it comes from what the
    // owner saved in Server Repo and cannot be named in the body.
    //
    // The rule matters MORE in this direction. Publishing writes to a server the owner chose;
    // fetching writes to the owner's own disk. A caller able to name a host could pull files
    // from a machine of its choosing into a folder of its choosing — so only the destination
    // is a parameter, and even that is confined by the backend, which refuses any remote path
    // that would escape it (see safe_join in repo_ssh.rs).
    let tok_repo_pull = token.clone();
    let handle_repo_pull = app_handle.clone();
    let repo_fetch_ssh = warp::path!("api" / "repo" / "fetch-ssh")
        .and(warp::post())
        .and(require_token(tok_repo_pull))
        .and(require_permission(token.clone(), "repo.write"))
        .and(warp::body::json::<serde_json::Value>())
        .and(with_app_handle(handle_repo_pull))
        .map(|body: serde_json::Value, handle: tauri::AppHandle| {
            let dir = body.get("dir").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if dir.trim().is_empty() {
                return warp::reply::with_status(
                    warp::reply::json(&ApiError { error: "dir is required".into() }),
                    StatusCode::BAD_REQUEST,
                );
            }
            let _ = handle.emit("bmm://api-exec", serde_json::json!({
                "action": "repo/fetch-ssh",
                "params": { "dir": dir }
            }));
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({
                    "ok": true,
                    "driven_by": "bmm-ui",
                    "message": "SSH fetch requested through the BMM interface."
                })),
                StatusCode::ACCEPTED,
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

    // DELETE /api/plugins/:id  (auth) — permanently uninstall a plugin (registry
    // entry + stored permissions + its files on disk). Mirrors uninstall_plugin.
    let data_plug_delete = data.clone();
    let path_plug_delete = data_path.clone();
    let tok_plug_delete  = token.clone();
    let delete_plugin = warp::path!("api" / "plugins" / String)
        .and(warp::delete())
        .and(require_token(tok_plug_delete))
        .and(require_permission(token.clone(), "plugins.write"))
        .and(with_data(data_plug_delete))
        .and(with_path(path_plug_delete))
        .map(|plugin_id: String, d: Arc<std::sync::Mutex<AppData>>, path: Arc<PathBuf>| {
            let install_dir = {
                let data = d.lock().unwrap_or_else(|p| p.into_inner());
                data.installed_plugins.iter().find(|p| p.manifest.id == plugin_id).map(|p| p.install_dir.clone())
            };
            let deleted = {
                let mut data = d.lock().unwrap_or_else(|p| p.into_inner());
                let before = data.installed_plugins.len();
                data.installed_plugins.retain(|p| p.manifest.id != plugin_id);
                data.plugin_permissions.remove(&plugin_id);
                data.installed_plugins.len() < before
            };
            if deleted {
                if let Some(dir) = install_dir {
                    let p = PathBuf::from(dir);
                    if p.exists() { std::fs::remove_dir_all(&p).ok(); }
                }
                save_data(&d, &path);
                warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({ "ok": true, "deleted_id": plugin_id })),
                    StatusCode::OK,
                )
            } else {
                warp::reply::with_status(
                    warp::reply::json(&ApiError { error: format!("Plugin '{}' not found", plugin_id) }),
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
        .and(require_permission(token.clone(), "data.read"))
        .map(|h: tauri::AppHandle| api_exec_reply(&h, "data/export", serde_json::json!({})));

    // POST /api/data/import — import an app-data backup
    let t2 = token.clone(); let h2 = app_handle.clone();
    let io_data_import = warp::path!("api" / "data" / "import").and(warp::post())
        .and(require_token(t2)).and(with_app_handle(h2))
        .and(require_permission(token.clone(), "data.write"))
        .map(|h: tauri::AppHandle| api_exec_reply(&h, "data/import", serde_json::json!({})));

    // POST /api/modlists/export — export a .mm mod list (the save dialog writes modlist.mm)
    let t3 = token.clone(); let h3 = app_handle.clone();
    let io_modlist_export = warp::path!("api" / "modlists" / "export").and(warp::post())
        .and(require_token(t3)).and(with_app_handle(h3))
        .and(require_permission(token.clone(), "mods.read"))
        .map(|h: tauri::AppHandle| api_exec_reply(&h, "modlist/export", serde_json::json!({})));

    // POST /api/modlists/import — import a .mm mod list
    let t4 = token.clone(); let h4 = app_handle.clone();
    let io_modlist_import = warp::path!("api" / "modlists" / "import").and(warp::post())
        .and(require_token(t4)).and(with_app_handle(h4))
        .and(require_permission(token.clone(), "mods.write"))
        .map(|h: tauri::AppHandle| api_exec_reply(&h, "modlist/import", serde_json::json!({})));

    // POST /api/modpacks/import — import a .bmp modpack.
    // Optional JSON body { "path": "C:/.../pack.bmp" } imports directly; else opens a dialog.
    let t5 = token.clone(); let h5 = app_handle.clone();
    let io_modpack_import = warp::path!("api" / "modpacks" / "import").and(warp::post())
        .and(require_token(t5)).and(with_app_handle(h5))
        .and(require_permission(token.clone(), "modpacks.write"))
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
        .and(require_permission(token.clone(), "modpacks.read"))
        .map(|b: IoIdBody, h: tauri::AppHandle| api_exec_reply(&h, "modpack/export", serde_json::json!({ "id": b.id, "destDir": b.dest_dir })));

    // POST /api/plugins/import — import a .bmmplug plugin
    let t7 = token.clone(); let h7 = app_handle.clone();
    let io_plugin_import = warp::path!("api" / "plugins" / "import").and(warp::post())
        .and(require_token(t7)).and(with_app_handle(h7))
        .and(require_permission(token.clone(), "plugins.write"))
        .map(|h: tauri::AppHandle| api_exec_reply(&h, "plugin/import", serde_json::json!({})));

    // POST /api/plugins/export — export a plugin to .bmmplug (body: { id })
    let t8 = token.clone(); let h8 = app_handle.clone();
    let io_plugin_export = warp::path!("api" / "plugins" / "export").and(warp::post())
        .and(require_token(t8)).and(warp::body::json::<IoIdBody>()).and(with_app_handle(h8))
        .and(require_permission(token.clone(), "plugins.read"))
        .map(|b: IoIdBody, h: tauri::AppHandle| api_exec_reply(&h, "plugin/export", serde_json::json!({ "id": b.id })));

    // POST /api/language/import — import a language .json file.
    // Optional JSON body { "path": "C:/.../fr.json" } imports that file directly;
    // an empty/absent body opens the native file picker.
    let t10 = token.clone(); let h10 = app_handle.clone();
    let io_lang_import = warp::path!("api" / "language" / "import").and(warp::post())
        .and(require_token(t10)).and(with_app_handle(h10))
        .and(require_permission(token.clone(), "system.write"))
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
        .and(require_permission(token.clone(), "profiles.write"))
        .map(|h: tauri::AppHandle| api_exec_reply(&h, "profile/import-ovgme", serde_json::json!({})));

    // POST /api/profiles/import/omm — import an OMM / OMX profile
    let t12 = token.clone(); let h12 = app_handle.clone();
    let io_prof_omm = warp::path!("api" / "profiles" / "import" / "omm").and(warp::post())
        .and(require_token(t12)).and(with_app_handle(h12))
        .and(require_permission(token.clone(), "profiles.write"))
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
            let _ = h.emit("bmm://api-exec", serde_json::json!({
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
        .and(require_admin_token(tok_perm_get))
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
        .and(require_admin_token(tok_perm_set))
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
        .and(require_admin_token(tok_perm_list))
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
    // User-configurable extra origins (Plugins & API → CORS). Read once at start
    // (changing it requires an API restart). A single "*" means "allow any origin".
    let user_cors_origins: Vec<String> = {
        let d = data.lock().unwrap_or_else(|p| p.into_inner());
        d.settings.api_cors_origins.iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    };
    let cors_allow_any = user_cors_origins.iter().any(|o| o == "*");

    let cors = {
        let b = warp::cors()
            .allow_methods(vec!["GET", "POST", "PUT", "DELETE", "OPTIONS"])
            .allow_headers(vec!["Content-Type", "Authorization"]);
        if cors_allow_any {
            // Explicit user opt-in: any website may call the API.
            b.allow_any_origin()
        } else {
            // Default Tauri WebView origins + any extra origins the user added.
            let mut origins: Vec<String> = vec![
                "https://tauri.localhost".into(),
                "tauri://localhost".into(),
                "http://tauri.localhost".into(),
                "https://bettercommunity.ch".into(),
            ];
            origins.extend(user_cors_origins.iter().filter(|o| *o != "*").cloned());
            #[cfg(debug_assertions)]
            { let _ = &origins; b.allow_any_origin() }
            #[cfg(not(debug_assertions))]
            { b.allow_origins(origins.iter().map(|s| s.as_str())) }
        }
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
    // ── Scheduled tasks ───────────────────────────────────────────────
    //
    // Running one was reachable (`POST /api/schedule/run`); SEEING them was not. "Which
    // tasks exist, and is the one I care about even switched on" had no answer from outside
    // the app — which is the first question when a nightly job did not happen.
    let tok_sch_list = token.clone();
    let handle_sch_list = app_handle.clone();
    let schedules_list = warp::path!("api" / "schedules")
        .and(warp::get())
        .and(require_token(tok_sch_list))
        .and(require_permission(token.clone(), "schedules.read"))
        .and(with_app_handle(handle_sch_list))
        .map(|handle: tauri::AppHandle| {
            match crate::commands::scheduler::get_schedules(handle) {
                Ok(v) => {
                    // A SUMMARY, not the tasks. A task carries its steps, and its steps can
                    // carry a script, a password typed into an action, a path off somebody's
                    // disk — none of which a caller asking "what is scheduled" needs, and all
                    // of which would then be in whatever logs that caller keeps.
                    let rows: Vec<serde_json::Value> = v
                        .as_array()
                        .cloned()
                        .unwrap_or_default()
                        .iter()
                        .map(|t| {
                            serde_json::json!({
                                "id": t.get("id").and_then(|x| x.as_str()).unwrap_or(""),
                                "name": t.get("name").and_then(|x| x.as_str()).unwrap_or(""),
                                "enabled": t.get("enabled").and_then(|x| x.as_bool()).unwrap_or(true),
                                "trigger": t.get("trigger").and_then(|x| x.get("type")).cloned()
                                    .unwrap_or(serde_json::Value::Null),
                                "lastRun": t.get("lastRun").cloned().unwrap_or(serde_json::Value::Null),
                                "steps": t.get("steps").and_then(|x| x.as_array()).map(|a| a.len()).unwrap_or(0),
                            })
                        })
                        .collect();
                    warp::reply::with_status(
                        warp::reply::json(&serde_json::json!({ "schedules": rows })), StatusCode::OK)
                }
                Err(e) => warp::reply::with_status(
                    warp::reply::json(&ApiError { error: e }), StatusCode::INTERNAL_SERVER_ERROR),
            }
        });

    // Arming and disarming, which is the other half of "a nightly job did not happen".
    //
    // Only `enabled` can be changed. A route that could write a whole task would be a route
    // that can install an automation with a script step in it, which is the scheduler's
    // permission model gone — that decision belongs to somebody reading the task on screen.
    let tok_sch_set = token.clone();
    let handle_sch_set = app_handle.clone();
    let schedules_set = warp::path!("api" / "schedules" / "enabled")
        .and(warp::post())
        .and(require_token(tok_sch_set))
        .and(require_permission(token.clone(), "schedules.write"))
        .and(warp::body::json::<ScheduleEnabledBody>())
        .and(with_app_handle(handle_sch_set))
        .map(|body: ScheduleEnabledBody, handle: tauri::AppHandle| {
            let mut doc = match crate::commands::scheduler::get_schedules(handle.clone()) {
                Ok(v) => v,
                Err(e) => return warp::reply::with_status(
                    warp::reply::json(&ApiError { error: e }), StatusCode::INTERNAL_SERVER_ERROR),
            };
            let mut found = false;
            if let Some(arr) = doc.as_array_mut() {
                for t in arr.iter_mut() {
                    if t.get("id").and_then(|x| x.as_str()) == Some(body.id.as_str()) {
                        if let Some(o) = t.as_object_mut() {
                            o.insert("enabled".into(), serde_json::Value::Bool(body.enabled));
                            found = true;
                        }
                    }
                }
            }
            if !found {
                return warp::reply::with_status(
                    warp::reply::json(&ApiError { error: "no task with that id".into() }),
                    StatusCode::NOT_FOUND);
            }
            match crate::commands::scheduler::save_schedules(handle.clone(), doc) {
                // The app is told to re-read, or the change sits on disk while the running
                // scheduler keeps using what it loaded at startup — a task that shows as
                // disabled and still fires.
                Ok(()) => {
                    let _ = handle.emit("bmm://schedules-changed", serde_json::json!({ "id": body.id }));
                    warp::reply::with_status(
                        warp::reply::json(&serde_json::json!({ "ok": true, "id": body.id, "enabled": body.enabled })),
                        StatusCode::OK)
                }
                Err(e) => warp::reply::with_status(
                    warp::reply::json(&ApiError { error: e }), StatusCode::INTERNAL_SERVER_ERROR),
            }
        });

    // ── Deployment order ────────────────────────────────
    //
    // Two active mods shipping the same file do not merge — one of them is what is on disk,
    // and it is the one deployed LAST. GET reads that order and every contested file; POST
    // changes it and re-copies the files that changed hands.
    //
    // Read is under `mods.read` and write under `mods.write`, the same split as everything
    // else here: knowing which mod wins is not the same permission as deciding it.
    let tok_ord_get = token.clone();
    let handle_ord_get = app_handle.clone();
    let mods_order_get = warp::path!("api" / "mods" / "order")
        .and(warp::get())
        .and(require_permission(tok_ord_get, "mods.read"))
        .and(with_app_handle(handle_ord_get))
        .map(|handle: tauri::AppHandle| {
            let state = handle.state::<crate::state::AppState>();
            match crate::commands::mod_order::mod_order_get(state, None) {
                Ok((mods, contested)) => warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({ "mods": mods, "contested": contested })),
                    StatusCode::OK),
                Err(e) => warp::reply::with_status(
                    warp::reply::json(&ApiError { error: e }), StatusCode::BAD_REQUEST),
            }
        });

    let tok_ord_set = token.clone();
    let handle_ord_set = app_handle.clone();
    let mods_order_set = warp::path!("api" / "mods" / "order")
        .and(warp::post())
        .and(require_permission(tok_ord_set, "mods.write"))
        .and(warp::body::json::<ModOrderBody>())
        .and(with_app_handle(handle_ord_set))
        .and_then(|body: ModOrderBody, handle: tauri::AppHandle| async move {
            let state = handle.state::<crate::state::AppState>();
            let out = crate::commands::mod_order::mod_order_set(state, body.profile_id, body.order).await;
            Ok::<_, std::convert::Infallible>(match out {
                Ok(moved) => warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({ "ok": true, "moved": moved })),
                    StatusCode::OK),
                // A non-permutation is the caller's mistake, not a server fault — and the
                // message says what is wrong with it rather than "bad request".
                Err(e) => warp::reply::with_status(
                    warp::reply::json(&ApiError { error: e }), StatusCode::BAD_REQUEST),
            })
        });

    // ── The doorbell ─────────────────────────────────────────────────
    //
    // A scheduled task could wait for a clock and for a file. This is the third thing:
    // something else finished, and it knows that it did.
    //
    // The token is required like everywhere else. That makes this a LOCAL doorbell — the
    // API listens on 127.0.0.1, so a service on the internet cannot reach it without a
    // tunnel the user sets up on purpose, and then they can carry the token. What it is
    // really for is the other things on this machine: a script, a game, another tool.
    // POST /api/content-id
    //
    // The id that says what a document IS rather than what this machine calls it: the same
    // pack assembled on two machines gets the same one. For the tools that BUILD these — a
    // script that generates a catalogue, a CI job that checks a repo still carries what it
    // said — so they can compare without reimplementing the hashing and drifting from it.
    //
    // It takes the DOCUMENT, and that is what makes it safe to leave at token level rather
    // than behind a per-kind read scope: the caller supplies what is hashed, so the answer
    // discloses nothing this machine holds. A by-id variant would be an oracle for "does
    // this install have X", and would need modpacks.read, plugins.read and the rest, one
    // route each. That is a different endpoint and it is deliberately not this one.
    // GET/POST /api/repo/modpacks
    //
    // A repo's shared modpacks are a manifest field with their own share rule, not an extra,
    // and until now they could only be set from the export form — which meant a script could
    // publish a repo but never say what it shared.
    //
    // The folder is LOCAL and the write re-signs the manifest, so this is `repo.write`, the
    // same grant that generates and publishes one. Reading is `repo.read`: knowing what a
    // repo on this disk offers is not the same as deciding it.
    let tok_mp_get = token.clone();
    let handle_mp_get = app_handle.clone();
    let repo_modpacks_get = warp::path!("api" / "repo" / "modpacks")
        .and(warp::get())
        .and(require_token(tok_mp_get))
        .and(require_permission(token.clone(), "repo.read"))
        .and(warp::query::<std::collections::HashMap<String, String>>())
        .and(with_app_handle(handle_mp_get))
        .map(|q: std::collections::HashMap<String, String>, _h: tauri::AppHandle| {
            let dir = q.get("dir").cloned().unwrap_or_default();
            match crate::commands::repo_extras::repo_modpacks_read(dir) {
                Ok(v) => warp::reply::with_status(warp::reply::json(&v), StatusCode::OK),
                Err(e) => warp::reply::with_status(
                    warp::reply::json(&ApiError { error: e }), StatusCode::BAD_REQUEST),
            }
        });

    let tok_mp_set = token.clone();
    let handle_mp_set = app_handle.clone();
    let repo_modpacks_set = warp::path!("api" / "repo" / "modpacks")
        .and(warp::post())
        .and(require_token(tok_mp_set))
        .and(require_permission(token.clone(), "repo.write"))
        .and(warp::body::json::<RepoModpacksBody>())
        .and(with_app_handle(handle_mp_set))
        .map(|body: RepoModpacksBody, handle: tauri::AppHandle| {
            // No `shares` is a read, not "share none". Those are different requests and
            // folding them together would make an empty POST silently un-publish everything.
            let Some(shares) = body.shares else {
                return warp::reply::with_status(
                    warp::reply::json(&ApiError { error: "repo.modpacks.errNoShares".into() }),
                    StatusCode::BAD_REQUEST);
            };
            match crate::commands::repo_extras::repo_modpacks_apply(handle, body.dir, shares, true) {
                Ok(n) => warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({ "ok": true, "modpacks": n })),
                    StatusCode::OK),
                Err(e) => warp::reply::with_status(
                    warp::reply::json(&ApiError { error: e }), StatusCode::BAD_REQUEST),
            }
        });

    let tok_cid = token.clone();
    let content_id = warp::path!("api" / "content-id")
        .and(warp::post())
        .and(require_token(tok_cid))
        .and(warp::body::json::<ContentIdBody>())
        .map(|body: ContentIdBody| {
            match crate::commands::content_ids::content_id_from(body.kind.clone(), body.doc) {
                Ok(id) => warp::reply::with_status(
                    warp::reply::json(&serde_json::json!({ "kind": body.kind, "content_id": id })),
                    StatusCode::OK),
                Err(e) => warp::reply::with_status(
                    warp::reply::json(&ApiError { error: e }), StatusCode::BAD_REQUEST),
            }
        });

    let tok_hook = token.clone();
    let hook_ring = warp::path!("api" / "hook")
        .and(warp::post())
        .and(require_token(tok_hook))
        .and(require_permission(token.clone(), "hooks.write"))
        .and(warp::body::json::<HookBody>())
        .map(|body: HookBody| {
            match crate::commands::hooks::hook_fire(body.name, body.data) {
                Ok(name) => warp::reply::with_status(
                    // The name it was FILED under, which is not always the name given — it
                    // is narrowed to something that can be a key. A caller that sent
                    // "build/done" needs to know it became "build_done", or it waits on a
                    // name nothing will ever ring.
                    warp::reply::json(&serde_json::json!({ "ok": true, "name": name })),
                    StatusCode::ACCEPTED),
                Err(e) => warp::reply::with_status(
                    warp::reply::json(&ApiError { error: e }), StatusCode::BAD_REQUEST),
            }
        });

    let tok_hook_list = token.clone();
    let hook_seen = warp::path!("api" / "hook")
        .and(warp::get())
        .and(require_token(tok_hook_list))
        .and(require_permission(token.clone(), "hooks.read"))
        .map(|| {
            // "Is my webhook actually arriving?" is the first question when a wait never
            // ends, and it had no answer at all before this.
            let seen: Vec<serde_json::Value> = crate::commands::hooks::hook_list()
                .into_iter()
                .map(|(name, count)| serde_json::json!({ "name": name, "count": count }))
                .collect();
            warp::reply::with_status(warp::reply::json(&serde_json::json!({ "hooks": seen })), StatusCode::OK)
        });

    // ── What a plugin ships ─────────────────────────────────────────
    //
    // Read only, and that is the whole decision. Copying one OUT is not exposed: a caller
    // that named both the source and the destination would be a file-copy primitive with
    // BMM's privileges, and anything able to call this endpoint can already read the bytes
    // and write them wherever it likes with its own hands.
    let tok_pa_list = token.clone();
    let handle_pa_list = app_handle.clone();
    let plugin_assets = warp::path!("api" / "plugins" / "assets")
        .and(warp::get())
        .and(require_token(tok_pa_list))
        .and(require_permission(token.clone(), "plugins.read"))
        .and(warp::query::<std::collections::HashMap<String, String>>())
        .and(with_app_handle(handle_pa_list))
        .map(|q: std::collections::HashMap<String, String>, handle: tauri::AppHandle| {
            let Some(id) = q.get("id").filter(|v| !v.is_empty()) else {
                return warp::reply::with_status(
                    warp::reply::json(&ApiError { error: "id query param required".into() }),
                    StatusCode::BAD_REQUEST);
            };
            let state = handle.state::<crate::state::AppState>();
            // With `path`, the FILE. Without it, the list. One route rather than two,
            // because the second differs from the first only in what it returns.
            match q.get("path").filter(|v| !v.is_empty()) {
                Some(p) => match crate::commands::plugin_assets::plugin_asset_read(
                    state, id.clone(), p.clone(),
                ) {
                    Ok(text) => warp::reply::with_status(
                        warp::reply::json(&serde_json::json!({ "path": p, "text": text })),
                        StatusCode::OK),
                    Err(e) => warp::reply::with_status(
                        warp::reply::json(&ApiError { error: e }), StatusCode::BAD_REQUEST),
                },
                None => match crate::commands::plugin_assets::plugin_assets_list(state, id.clone()) {
                    Ok(v) => warp::reply::with_status(
                        warp::reply::json(&serde_json::json!({ "id": id, "assets": v })),
                        StatusCode::OK),
                    Err(e) => warp::reply::with_status(
                        warp::reply::json(&ApiError { error: e }), StatusCode::NOT_FOUND),
                },
            }
        });

    // ── Catalogues ─────────────────────────────────────────────────────
    //
    // The source lists live in the webview's localStorage, which this side cannot read — so
    // the interface pushes a MIRROR after every change and this reads that. It says when it
    // was written, because "BMM has never run since you added that" and "BMM says you follow
    // nothing" are different facts and only one of them is a bug.
    let tok_cats_get = token.clone();
    let handle_cats_get = app_handle.clone();
    let catalogs_get = warp::path!("api" / "catalogs")
        .and(warp::get())
        .and(require_token(tok_cats_get))
        .and(require_permission(token.clone(), "catalog.read"))
        .and(with_app_handle(handle_cats_get))
        .map(|handle: tauri::AppHandle| {
            match crate::commands::catalog_sources::catalog_sources_get(handle) {
                Ok(v) => warp::reply::with_status(warp::reply::json(&v), StatusCode::OK),
                Err(e) => warp::reply::with_status(
                    warp::reply::json(&ApiError { error: e }), StatusCode::INTERNAL_SERVER_ERROR),
            }
        });

    // Writing goes through the INTERFACE, not through the mirror.
    //
    // A mirror that could be written from outside and then read back by the app would be a
    // second writer, and the two would disagree the first time both changed. This drives the
    // same deeplink a person's click drives, so the source lands in the following list with
    // an origin and can be removed by the button that removes the others.
    let tok_cats_set = token.clone();
    let handle_cats_set = app_handle.clone();
    let catalogs_set = warp::path!("api" / "catalogs")
        .and(warp::post())
        .and(require_token(tok_cats_set))
        .and(require_permission(token.clone(), "catalog.write"))
        .and(warp::body::json::<CatalogFollowBody>())
        .and(with_app_handle(handle_cats_set))
        .map(|body: CatalogFollowBody, handle: tauri::AppHandle| {
            let action = if body.follow { "catalog/follow" } else { "catalog/unfollow" };
            api_exec_reply(&handle, action, serde_json::json!({ "type": body.kind, "url": body.url }))
        });

    // ── Extras, and identity keys ──────────────────────────────────────
    //
    // Reading what a repo carries needs no new endpoint: `/api/repo/info` returns the
    // manifest, and `extras` is part of it. Only the two ACTS are new.
    let tok_extra_take = token.clone();
    let handle_extra_take = app_handle.clone();
    let repo_extra_take = warp::path!("api" / "repo" / "extras")
        .and(warp::post())
        .and(require_token(tok_extra_take))
        .and(require_permission(token.clone(), "repo.write"))
        .and(warp::body::json::<RepoExtraBody>())
        .and(with_app_handle(handle_extra_take))
        .and_then(|body: RepoExtraBody, handle: tauri::AppHandle| async move {
            // The manifest is fetched and the entry taken FROM IT, rather than the caller
            // describing the entry it wants installed. A caller that could hand over its own
            // {kind, url, sha256} would be using this endpoint to install arbitrary files
            // through BMM's own installer, which is not what "take what this repo carries"
            // means — and the hash check would be checking the attacker's own number.
            let repo = match crate::commands::repo::fetch_repo_info(
                body.url.clone(), body.creator_id.clone(), body.password.clone(),
            ).await {
                Ok(r) => r,
                Err(e) => return Ok::<_, warp::Rejection>(warp::reply::with_status(
                    warp::reply::json(&ApiError { error: e }), StatusCode::BAD_GATEWAY)),
            };
            let Some(entry) = repo.extras.iter()
                .find(|e| e.kind == body.kind && e.id == body.id)
                .cloned()
            else {
                return Ok(warp::reply::with_status(
                    warp::reply::json(&ApiError { error: "no such extra in that repo".into() }),
                    StatusCode::NOT_FOUND));
            };
            let state = handle.state::<crate::state::AppState>();
            match crate::commands::repo_extras::install_extra(
                &handle, &state, &body.url, entry,
                body.creator_id.as_deref(), body.password.as_deref(),
            ).await {
                Ok(v) => Ok(warp::reply::with_status(warp::reply::json(&v), StatusCode::OK)),
                Err(e) => Ok(warp::reply::with_status(
                    warp::reply::json(&ApiError { error: e }), StatusCode::BAD_REQUEST)),
            }
        });

    // Identity keys. Its OWN grant rather than repo.write: a key is what proves you are you
    // to every protected source, so minting one is not the same act as writing to a repo,
    // and a plugin granted one must not silently get the other.
    let tok_keys_list = token.clone();
    let handle_keys_list = app_handle.clone();
    let keys_list = warp::path!("api" / "keys")
        .and(warp::get())
        .and(require_token(tok_keys_list))
        .and(require_permission(token.clone(), "keys.read"))
        .and(with_app_handle(handle_keys_list))
        .map(|handle: tauri::AppHandle| {
            let state = handle.state::<crate::state::AppState>();
            // Names and PATHS. Never key material — there is no endpoint that reads a
            // private key, and this is the one somebody would reach for first.
            match crate::commands::repo_keyauth::key_auth_list(state) {
                Ok(v) => warp::reply::with_status(warp::reply::json(&v), StatusCode::OK),
                Err(e) => warp::reply::with_status(
                    warp::reply::json(&ApiError { error: e }), StatusCode::INTERNAL_SERVER_ERROR),
            }
        });

    let tok_keys_new = token.clone();
    let handle_keys_new = app_handle.clone();
    let keys_new = warp::path!("api" / "keys")
        .and(warp::post())
        .and(require_token(tok_keys_new))
        .and(require_permission(token.clone(), "keys.write"))
        .and(warp::body::json::<NewKeyBody>())
        .and(with_app_handle(handle_keys_new))
        .and_then(|body: NewKeyBody, handle: tauri::AppHandle| async move {
            let state = handle.state::<crate::state::AppState>();
            match crate::commands::repo_keyauth::key_auth_generate(
                handle.clone(), state, body.name, body.kind,
            ).await {
                // The response carries the PUBLIC line and the path the private half went
                // to. The private half itself is never in a response body, because this
                // API's replies are logged by callers, proxied, and read in a browser tab.
                Ok(v) => Ok::<_, warp::Rejection>(warp::reply::with_status(
                    warp::reply::json(&v), StatusCode::CREATED)),
                Err(e) => Ok(warp::reply::with_status(
                    warp::reply::json(&ApiError { error: e }), StatusCode::BAD_REQUEST)),
            }
        });

    let group_c = schedules_list
        .or(schedules_set)
        .or(mods_order_get)
        .or(mods_order_set)
        .or(hook_ring)
        .or(content_id)
        .or(repo_modpacks_get)
        .or(repo_modpacks_set)
        .or(hook_seen)
        .or(plugin_assets)
        .or(catalogs_get)
        .or(catalogs_set)
        .or(repo_extra_take)
        .or(keys_new)
        .or(keys_list)
        .or(repo_info)
        .or(repo_connect)
        .or(repo_list)
        .or(repo_sync_cancel)   // DELETE must come before POST for same path prefix
        .or(repo_sync)
        .or(repo_gen_cancel)
        .or(repo_manifest)
        .or(repo_gen)
        .or(repo_update)        // POST /api/repo/update
        .or(repo_host_stop)     // DELETE /api/repo/host
        .or(repo_publish_ssh)   // POST /api/repo/publish-ssh
        .or(repo_fetch_ssh)      // POST /api/repo/fetch-ssh
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
        .or(benchmark)           // POST /api/benchmark
        .boxed();

    let group_e = update_modpack
        .or(delete_modpack)
        .or(delete_plugin)
        .boxed();

    // Telemetry / recorder / replay control (Privacy & telemetry + Session recorder).
    let group_tel = telemetry_consent
        .or(telemetry_settings)
        .or(view)
        .or(recorder)
        .or(replay_export)
        .or(replay_import)
        .or(discord_rpc)
        .or(data_export_auto)
        .or(launchpack_run)
        .or(schedule_run)
        .boxed();

    let routes = group_a
        .or(group_b)
        .or(group_c)
        .or(group_d)
        .or(group_e)
        .or(group_tel)
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
            let _ = activity_handle.emit("bmm://api-action", serde_json::json!({
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
            API_RUNNING.store(true, Ordering::Relaxed);
            crate::commands::crash::log_line(format!("[PLUGIN-API] Server started on http://127.0.0.1:{}", port));
            server.await;
            API_RUNNING.store(false, Ordering::Relaxed);
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
        // Prefer the stable id when present (rename-proof), else match by name.
        let found_mod = req.id.as_ref()
            .and_then(|id| mods.iter().find(|m| &m.id == id))
            .or_else(|| mods.iter().find(|m| m.name.to_lowercase() == req.name.to_lowercase()));
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
        ($event:expr, $payload:expr) => {{ let _ = handle.emit($event, $payload); }};
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
                        unverified: false,
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
                        direct_url: None,
                        direct_sig: None,
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
            // Copy through a reader instead of `fs::read` — that pulled each ENTIRE file into
            // memory before handing it to the zip writer, so exporting a folder holding a
            // multi-GB mod spiked RSS by the size of its largest file.
            let mut f = std::io::BufReader::new(std::fs::File::open(path).map_err(|e| e.to_string())?);
            std::io::copy(&mut f, &mut writer).map_err(|e| e.to_string())?;
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
        ($event:expr, $payload:expr) => {{ let _ = handle.emit($event, $payload); }};
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
    // Trimmed and normalised here rather than at read time, so every client sees the same
    // string and an accidental trailing slash cannot produce `//mods/…`.
    repo.files_base_url = body.files_base_url.as_ref()
        .map(|u| u.trim().trim_end_matches('/').to_string())
        .filter(|u| !u.is_empty());

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
                archive: None,
                download_links: mod_entry.download_links.clone(),
                dependencies: dep_ids,
                changelog: None,
                update_url: mod_entry.update_url.clone(),
                direct_url: mod_entry.direct_url.clone(),
                update_sources: mod_entry.update_sources.iter()
                    .map(|s| crate::models::mod_entry::UpdateSource { sig: None, ..s.clone() }).collect(),
            };

            // Archived mods (.zip) read from their extracted cache view.
            let read_root = crate::archive::mod_read_root(&mod_entry.mod_folder_path);

            // "Zip mods": pack the whole mod into one mods/<id>.zip (full mode only).
            if body.zip_mods && !body.lightweight {
                let zip_path = repo_mods_dir.join(format!("{}.zip", mod_entry.id));
                let noflag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
                if crate::commands::repo::zip_directory(&read_root, &zip_path, noflag).is_ok() {
                    let size = std::fs::metadata(&zip_path).map(|m| m.len()).unwrap_or(0);
                    if let Ok(sha) = api_sha256_file(&zip_path) {
                        repo_mod.archive = Some(RepoFile {
                            relative_path: format!("mods/{}.zip", mod_entry.id),
                            size, sha256_hash: sha, chunks: None,
                            mtime: None,
                        });
                    }
                    let _ = std::fs::remove_dir_all(&target_mod_dir);
                }
                repo_profile.mods.push(repo_mod);
                continue;
            }

            if let Ok(files) = crate::fs_utils::list_mod_files(&read_root) {
                for rel_path in &files {
                    let src = read_root.join(rel_path);
                    let size_src = std::fs::metadata(&src).map(|m| m.len()).unwrap_or(0);

                    if body.lightweight {
                        // Lightweight: hash the source file in place, never copy it.
                        //
                        // Chunk hashes are computed here exactly as the full export does.
                        // Without them a client can only re-fetch a changed file whole, which
                        // is what made this mode unusable for publishing rather than merely
                        // cheaper — a manifest is only worth hosting if a small change costs
                        // a small download.
                        let need_chunks = size_src > crate::commands::repo::CHUNK_SIZE as u64;
                        if let Ok((sha, chunks)) =
                            crate::commands::repo::compute_file_hash_and_chunks(&src, need_chunks)
                        {
                            repo_mod.files.push(RepoFile {
                                relative_path: rel_path.to_string_lossy().to_string().replace('\\', "/"),
                                size: size_src, sha256_hash: sha, chunks,
                                mtime: None,
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
                    mtime: None,
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
            download_password: None, // local API export doesn't set a subscriber password
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

