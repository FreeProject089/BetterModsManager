use crate::models::profile::Profile;
use crate::models::mod_entry::ModEntry;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ConnectedServerRepo {
    pub url:  String,
    #[serde(default)]
    pub name: String,
    /// Check this repo automatically when BMM starts.
    ///
    /// Off by default and per repo, never global: syncing writes into a game folder, so
    /// "check everything on launch" is not a setting anyone should acquire by upgrading.
    #[serde(default)]
    pub auto_sync: bool,
    /// Which of the two sync modes to use — "missing" (default) installs what is absent,
    /// "all" also overwrites files that differ locally.
    ///
    /// Stored per repo because the answer differs per repo: a curated server you follow
    /// wants "all", a repo you cherry-pick from does not, and a single global mode would
    /// quietly overwrite local edits on the second kind.
    #[serde(default)]
    pub auto_sync_mode: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    #[serde(default = "default_lang")]
    pub language: String,
    #[serde(default)]
    pub github_token: String,
    #[serde(default)]
    pub shortcuts: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub onboarding_shown: bool,
    #[serde(default)]
    pub last_seen_crash: Option<String>,
    #[serde(default = "default_true")]
    pub auto_io_calibration: bool,
    /// Smart I/O: when true (default), mod file copies use a bounded
    /// thread pool + tiny periodic yields so the UI stays fluid.
    /// When false, copies saturate every CPU core for max speed.
    #[serde(default = "default_true")]
    pub smart_io_enabled: bool,
    #[serde(default)]
    pub storage_alert_enabled: bool,
    #[serde(default = "default_storage_warning")]
    pub storage_warning_space_pct: u32,
    #[serde(default = "default_storage_critical")]
    pub storage_critical_space_pct: u32,
    #[serde(default = "default_filter")]
    pub current_filter: String,
    #[serde(default = "default_sort")]
    pub current_sort_by: String,
    #[serde(default = "default_true")]
    pub last_session_clean: bool,
    #[serde(default)]
    pub auto_fill_metadata: bool,
    #[serde(default)]
    pub cloudflared_path: Option<String>,
    /// SSH host fingerprints already trusted, keyed "host:port".
    ///
    /// Option, not a bare map, so an existing data.json without the field still parses —
    /// and so "never connected to anything" is distinguishable from "trusted nothing".
    /// Fingerprints only: no key material, no passphrase, ever.
    #[serde(default)]
    pub ssh_known_hosts: Option<HashMap<String, String>>,
    /// PATH to the ed25519 private key used to prove identity to a repo or catalogue that
    /// requires one (see commands/repo_keyauth.rs).
    ///
    /// A path, not a key — the same rule as everywhere else here, and the reason it can live
    /// in settings at all. The proof is signed at the moment of use and the bytes are dropped.
    ///
    /// It lives on the Rust side rather than in the frontend's store because every outbound
    /// request that might need it is built here: the catalogue fetcher, the repo-info fetcher
    /// and the per-file sync client. Threading it through three call chains from the frontend
    /// would be three chances for one of them to forget.
    #[serde(default)]
    pub key_auth_key_path: Option<String>,
    #[serde(default)]
    pub discord_rpc_enabled: bool,
    #[serde(default)]
    pub fs_security_mode: Option<String>, // Some("full") | Some("limited") | None
    #[serde(default)]
    pub require_valid_sha: bool,
    #[serde(default = "default_true")]
    pub show_sha_loading_animation: bool,
    #[serde(default = "default_true")]
    pub enable_lazy_sha_calculation: bool,
    #[serde(default = "default_history_retention")]
    pub history_retention_days: u32,
    #[serde(default = "default_api_token")]
    pub api_token: String,
    /// Local Plugin API port (default 51274). Changing it requires a restart;
    /// the whole frontend + generated scripts read it dynamically.
    #[serde(default = "default_api_port")]
    pub api_port: u16,
    #[serde(default = "default_true")]
    pub sound_effects_enabled: bool,
    #[serde(default = "default_sound_volume")]
    pub sound_volume: u32, // 0–100
    #[serde(default)]
    pub connected_server_repos: Vec<ConnectedServerRepo>,
    /// Per-plugin API tokens: token string → plugin_id. CWE-862/863: the API
    /// resolves a caller's identity (and thus permissions) from THIS map by token,
    /// not from the spoofable `X-BMM-Plugin-Id` header. The main `api_token` stays
    /// the admin token (full access). Empty by default ⇒ behaviour unchanged.
    #[serde(default)]
    pub plugin_tokens: std::collections::HashMap<String, String>,
    /// CWE-942: extra CORS origins the user explicitly allows so they can call
    /// the local API from other web services (e.g. a dashboard). Empty ⇒ only the
    /// Tauri WebView origins are allowed (the secure default). A single `"*"`
    /// entry means "allow any origin" (opt-in, the user accepted the risk).
    /// Changing this requires an API restart.
    #[serde(default)]
    pub api_cors_origins: Vec<String>,
    /// Telemetry consent (GDPR opt-in). `None` = never asked yet (show the prompt),
    /// `Some(true)` = opted in, `Some(false)` = declined. Nothing is collected
    /// unless this is explicitly `Some(true)`.
    #[serde(default)]
    pub analytics_consent: Option<bool>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            language: default_lang(),
            github_token: String::new(),
            shortcuts: std::collections::HashMap::new(),
            onboarding_shown: false,
            last_seen_crash: None,
            auto_io_calibration: true,
            smart_io_enabled: true,
            storage_alert_enabled: false,
            storage_warning_space_pct: default_storage_warning(),
            storage_critical_space_pct: default_storage_critical(),
            current_filter: default_filter(),
            current_sort_by: default_sort(),
            last_session_clean: true,
            auto_fill_metadata: false,
            cloudflared_path: None,
            ssh_known_hosts: None,
            key_auth_key_path: None,
            discord_rpc_enabled: false,
            fs_security_mode: None,
            require_valid_sha: false,
            show_sha_loading_animation: true,
            enable_lazy_sha_calculation: true,
            history_retention_days: default_history_retention(),
            api_token: default_api_token(),
            api_port: default_api_port(),
            sound_effects_enabled: true,
            sound_volume: default_sound_volume(),
            connected_server_repos: Vec::new(),
            plugin_tokens: std::collections::HashMap::new(),
            api_cors_origins: Vec::new(),
            analytics_consent: None,
        }
    }
}

fn default_true() -> bool { true }
fn default_api_token() -> String { uuid::Uuid::new_v4().to_string() }
fn default_api_port() -> u16 { 51274 }
fn default_sound_volume() -> u32 { 70 }

fn default_filter() -> String { "all".to_string() }
fn default_sort() -> String { "name_asc".to_string() }

fn default_lang() -> String { "fr".to_string() }
fn default_storage_warning() -> u32 { 40 }
fn default_storage_critical() -> u32 { 30 }
fn default_history_retention() -> u32 { 30 }

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct AppData {
    pub profiles: Vec<Profile>,
    pub mods: Vec<ModEntry>,
    pub active_profile_id: Option<String>,
    #[serde(default)]
    pub custom_tags: Vec<crate::models::tag::TagDef>,
    #[serde(default)]
    pub disk_limits: std::collections::HashMap<String, u64>,
    #[serde(default)]
    pub settings: AppSettings,
    #[serde(default)]
    pub launch_packs: Vec<crate::models::launch_pack::LaunchPack>,
    #[serde(default)]
    pub installed_plugins: Vec<crate::models::plugin::InstalledPlugin>,
    #[serde(default)]
    pub plugin_permissions: std::collections::HashMap<String, Vec<String>>,
    #[serde(default)]
    pub modpacks: Vec<crate::models::modpack::LocalModpack>,
}

pub struct AppState {
    pub data: std::sync::Arc<Mutex<AppData>>,
    pub data_path: std::sync::Arc<PathBuf>,
    pub install_cancelled: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub sync_paused: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub benchmark_running: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub advanced_benchmark: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub previous_session_clean: std::sync::Arc<std::sync::atomic::AtomicBool>,
    
    // Cache for O(1) conflict detection (In-Memory only, not saved to JSON)
    pub mod_files_cache: Mutex<HashMap<String, HashSet<PathBuf>>>,
    pub conflict_index: Mutex<HashMap<PathBuf, Vec<String>>>,
    pub last_cache_update: Mutex<Option<Instant>>,
    // Discord RPC
    pub discord_client: Mutex<Option<Box<dyn discord_rich_presence::DiscordIpc + Send + Sync>>>,
    // SHA calculation queue (priority queue for background hashing)
    pub sha_queue: std::sync::Arc<Mutex<std::collections::VecDeque<String>>>,
    pub sha_queue_priority: std::sync::Arc<Mutex<std::collections::VecDeque<String>>>,
    pub sha_calculation_active: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub current_sha_mod_id: std::sync::Arc<Mutex<Option<String>>>,
    pub export_cancelled: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub api_shutdown_tx: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

/// Parse an AppData file, returning None on any read/parse error.
fn parse_appdata(path: &std::path::Path) -> Option<AppData> {
    let f = std::fs::File::open(path).ok()?;
    serde_json::from_reader(std::io::BufReader::new(f)).ok()
}

/// Load data.json, recovering from the rolling `.bak` if the main file is
/// corrupt or missing — and NEVER silently resetting when a good backup exists.
/// A corrupt main file is preserved as `data.corrupt-<ts>.json` for forensics.
fn load_with_recovery(path: &std::path::Path) -> AppData {
    let bak = path.with_extension("json.bak");
    let log = |m: String| crate::commands::crash::log_line(m);

    if path.exists() {
        if let Some(d) = parse_appdata(path) {
            return d;
        }
        log("[STATE] data.json is unreadable/corrupt — attempting recovery from backup.".into());
        // keep the bad file for manual inspection
        let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = std::fs::copy(path, path.with_file_name(format!("data.corrupt-{}.json", ts)));
        if bak.exists() {
            if let Some(d) = parse_appdata(&bak) {
                log("[STATE] Recovered data.json from backup (data.json.bak).".into());
                let _ = std::fs::copy(&bak, path); // restore so later saves don't clobber the good backup
                return d;
            }
        }
        log("[STATE] No valid backup found — starting fresh (corrupt file preserved).".into());
        return AppData::default();
    }

    // main file missing entirely → try the backup before defaulting
    if bak.exists() {
        if let Some(d) = parse_appdata(&bak) {
            log("[STATE] data.json missing — recovered from data.json.bak.".into());
            let _ = std::fs::copy(&bak, path);
            return d;
        }
    }
    AppData::default()
}

/// Crash-safe write: write to a temp file, fsync, then atomically rename over
/// the target. An interrupted write can never leave a half-written file.
pub fn atomic_write_bytes(path: impl AsRef<std::path::Path>, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let path = path.as_ref();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.flush()?;
        f.sync_all()?; // ensure bytes hit disk before the rename
    }
    std::fs::rename(&tmp, path)
}

/// Crash-safe write of a serializable value (streams to temp, fsync, rename).
pub fn atomic_write_json<T: serde::Serialize>(path: impl AsRef<std::path::Path>, value: &T) -> std::io::Result<()> {
    use std::io::Write;
    let path = path.as_ref();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    {
        let file = std::fs::File::create(&tmp)?;
        let mut writer = std::io::BufWriter::new(file);
        serde_json::to_writer_pretty(&mut writer, value).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        writer.flush()?;
        writer.get_ref().sync_all()?;
    }
    std::fs::rename(&tmp, path)
}

impl AppState {
    pub fn load(data_path: PathBuf) -> Self {
        let data = load_with_recovery(&data_path);
        Self {
            data: std::sync::Arc::new(Mutex::new(data)),
            data_path: std::sync::Arc::new(data_path),
            install_cancelled: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            sync_paused: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            benchmark_running: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            advanced_benchmark: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            previous_session_clean: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true)),
            mod_files_cache: Mutex::new(HashMap::new()),
            conflict_index: Mutex::new(HashMap::new()),
            last_cache_update: Mutex::new(None),
            discord_client: Mutex::new(None),
            sha_queue: std::sync::Arc::new(Mutex::new(std::collections::VecDeque::new())),
            sha_queue_priority: std::sync::Arc::new(Mutex::new(std::collections::VecDeque::new())),
            sha_calculation_active: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            current_sha_mod_id: std::sync::Arc::new(Mutex::new(None)),
            export_cancelled: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            api_shutdown_tx: Mutex::new(None),
        }
    }

    pub fn save(&self) -> anyhow::Result<()> {
        let data = self.data.lock().unwrap();
        let path = &*self.data_path;
        // Roll the current good file to .bak BEFORE replacing it. Because the
        // write below is atomic (temp + rename), the live data.json is always a
        // complete file, so the backup is always a complete prior version.
        if path.exists() {
            let _ = std::fs::copy(path, path.with_extension("json.bak"));
        }
        atomic_write_json(path, &*data)?;
        Ok(())
    }
}
