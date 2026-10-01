//! « API Laya locale » in the app: when it runs, the Tauri commands behind its Settings card,
//! and the engine it serves (the embedded Laya). The server itself, its defences and its tests
//! are in `ai_api_core` (shared with the CLI, which only edits the config and probes).
//!
//! ## Who decides that it runs
//!
//! One loop, [`spawn_watcher`], every few seconds and after every change made here: the server
//! runs when `ai-api.json` says enabled AND a token exists AND the AI master switch is on AND
//! `--no-ai` is not set — and it is stopped as soon as one of those stops being true. So the
//! CLI (`bmm ai-api start|stop`), which can only write the file, and the AI switch in Settings,
//! which lives in another card, both take effect without calling into this module. Game mode
//! does not stop it: requests are refused with 503 `game_mode` while a game runs (the guard),
//! which a client can wait out, and the port stays the same.

use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::State;

use crate::commands::ai_api_core::{self as core, ApiConfig, Engine, Stats};
use crate::commands::ai_core::{self, LocalModel};
use crate::commands::ai_embedded;
use crate::state::AppState;

struct Running {
    cfg: ApiConfig,
    port: u16,
    stop: tokio::sync::oneshot::Sender<()>,
}

fn running() -> &'static Mutex<Option<Running>> {
    static R: OnceLock<Mutex<Option<Running>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(None))
}

fn last_error() -> &'static Mutex<Option<String>> {
    static E: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    E.get_or_init(|| Mutex::new(None))
}

fn stats() -> Arc<Stats> {
    static S: OnceLock<Arc<Stats>> = OnceLock::new();
    S.get_or_init(|| Arc::new(Stats::default())).clone()
}

/// Reconciles run one at a time (the watcher and a click can meet).
fn reconcile_lock() -> &'static tokio::sync::Mutex<()> {
    static L: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    L.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn dir_of(state: &AppState) -> PathBuf {
    state.data_path.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| PathBuf::from("."))
}

/// Why the server should not run now (`None` = it should).
pub fn not_running_because(cfg: &ApiConfig, ai_on: bool, killed: bool) -> Option<&'static str> {
    if !cfg.enabled {
        Some("off")
    } else if killed {
        Some("killed")
    } else if !ai_on {
        Some("ai_off")
    } else if cfg.token_sha256.len() != 64 {
        Some("no_token")
    } else {
        None
    }
}

fn engine(dir: PathBuf) -> Engine {
    Engine {
        predict: Arc::new(|text: &str, qs: &[ai_core::LayaQuestion]| ai_embedded::Embedded.predict(text, qs)),
        available: Arc::new(|| ai_embedded::Embedded.available()),
        guard: Arc::new(move || crate::commands::ai_ops::guard(&dir)),
        log: Arc::new(|line: String| crate::commands::crash::log_line(line)),
    }
}

/// Bring the server in line with the config and the switches: start, stop or restart.
pub async fn reconcile(dir: &Path) {
    let _g = reconcile_lock().lock().await;
    let cfg = core::load_config(dir);
    let why = not_running_because(&cfg, ai_core::load_settings(dir).enabled, ai_core::kill_switch());
    let same = running().lock().ok().and_then(|r| r.as_ref().map(|r| r.cfg == cfg)).unwrap_or(false);
    if why.is_none() && same {
        return;
    }
    // Anything else stops the one running (a changed port, origin list or token restarts it).
    let prev = running().lock().ok().and_then(|mut r| r.take());
    if let Some(r) = prev {
        let _ = r.stop.send(());
        crate::commands::crash::log_line(format!("[AI-API] stopped port={}", r.port));
        // Let the listener close before the same port is bound again.
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
    if why.is_some() {
        return;
    }
    match core::bind(&cfg).await {
        Ok(listener) => {
            let port = listener.local_addr().map(|a| a.port()).unwrap_or(cfg.port);
            let (tx, rx) = tokio::sync::oneshot::channel();
            tauri::async_runtime::spawn(core::serve(listener, cfg.clone(), engine(dir.to_path_buf()), stats(), rx));
            if let Ok(mut r) = running().lock() {
                *r = Some(Running { cfg, port, stop: tx });
            }
            if let Ok(mut e) = last_error().lock() {
                *e = None;
            }
            crate::commands::crash::log_line(format!("[AI-API] listening 127.0.0.1:{}", port));
        }
        Err(e) => {
            crate::commands::crash::log_line(format!("[AI-API] not started: {}", e));
            if let Ok(mut le) = last_error().lock() {
                *le = Some(e);
            }
        }
    }
}

/// The loop that keeps it in line. Started once, at launch.
pub fn spawn_watcher(dir: PathBuf) {
    static STARTED: OnceLock<()> = OnceLock::new();
    if STARTED.set(()).is_err() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        loop {
            reconcile(&dir).await;
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
    });
}

pub fn status_view(dir: &Path) -> Value {
    let cfg = core::load_config(dir);
    let (is_running, port) = running().lock().ok().and_then(|r| r.as_ref().map(|r| (true, r.port))).unwrap_or((false, cfg.port));
    let why = not_running_because(&cfg, ai_core::load_settings(dir).enabled, ai_core::kill_switch());
    json!({
        "enabled": cfg.enabled,
        "running": is_running,
        "port": port,
        "url": format!("http://127.0.0.1:{}", port),
        "allowedOrigins": cfg.allowed_origins,
        "concurrency": cfg.concurrency,
        "hasToken": cfg.token_sha256.len() == 64,
        "why": why,
        "error": last_error().lock().ok().and_then(|e| e.clone()),
        "held": crate::commands::ai_ops::guard(dir),
        "modelInstalled": ai_embedded::installed(),
        "stats": stats().view(),
    })
}

#[tauri::command]
pub fn ai_api_status(state: State<AppState>) -> Value {
    status_view(&dir_of(&state))
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiChange {
    pub enabled: Option<bool>,
    pub port: Option<u16>,
    pub allowed_origins: Option<Vec<String>>,
    pub concurrency: Option<u8>,
}

/// Apply a change to the config. Turning it on with no token mints one: the only time the
/// token is returned, apart from [`ai_api_rotate_token`].
pub fn apply_change(dir: &Path, ch: &ApiChange) -> Result<(ApiConfig, Option<String>), String> {
    let mut cfg = core::load_config(dir);
    if let Some(p) = ch.port {
        if p < 1024 {
            return Err("ai.api.portInvalid".into());
        }
        cfg.port = p;
    }
    if let Some(list) = &ch.allowed_origins {
        let mut out = Vec::new();
        for o in list.iter().filter(|o| !o.trim().is_empty()) {
            out.push(core::validate_origin(o).map_err(str::to_string)?);
        }
        if out.len() > core::MAX_ORIGINS {
            return Err("ai.api.originsMany".into());
        }
        cfg.allowed_origins = out;
    }
    if let Some(c) = ch.concurrency {
        cfg.concurrency = c;
    }
    let mut minted = None;
    if let Some(on) = ch.enabled {
        cfg.enabled = on;
        if on && cfg.token_sha256.len() != 64 {
            let t = core::new_token();
            cfg.token_sha256 = core::hash_token(&t);
            minted = Some(t);
        }
    }
    Ok((core::save_config(dir, &cfg)?, minted))
}

#[tauri::command(async)]
pub async fn ai_api_configure(state: State<'_, AppState>, change: ApiChange) -> Result<Value, String> {
    let dir = dir_of(&state);
    let (_, minted) = apply_change(&dir, &change)?;
    reconcile(&dir).await;
    crate::commands::crash::log_line(format!("[AI-API] config changed enabled={:?}", change.enabled));
    Ok(json!({ "token": minted, "status": status_view(&dir) }))
}

/// A new token; the old one stops working at once (the server restarts on the new hash).
#[tauri::command(async)]
pub async fn ai_api_rotate_token(state: State<'_, AppState>) -> Result<Value, String> {
    let dir = dir_of(&state);
    let mut cfg = core::load_config(&dir);
    let t = core::new_token();
    cfg.token_sha256 = core::hash_token(&t);
    core::save_config(&dir, &cfg)?;
    reconcile(&dir).await;
    crate::commands::crash::log_line("[AI-API] token rotated".to_string());
    Ok(json!({ "token": t, "status": status_view(&dir) }))
}

/// The card's « Tester »: /health answers, and a POST without the token is refused.
#[tauri::command(async)]
pub async fn ai_api_test(state: State<'_, AppState>) -> Result<Value, String> {
    let dir = dir_of(&state);
    let st = status_view(&dir);
    if st["running"] != Value::Bool(true) {
        return Ok(json!({ "ok": false, "why": st["why"].clone() }));
    }
    let port = st["port"].as_u64().unwrap_or(0) as u16;
    tauri::async_runtime::spawn_blocking(move || {
        let health = core::probe_health(port, 3000);
        let locked = core::probe_locked(port, 3000);
        Ok(json!({
            "ok": health.is_ok() && locked == Ok(true),
            "health": health.as_ref().ok(),
            "ready": health.as_ref().ok().and_then(|h| h.get("ready")).cloned(),
            "locked": locked.unwrap_or(false),
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_runs_only_when_every_switch_says_so() {
        let on = ApiConfig { enabled: true, token_sha256: "a".repeat(64), ..Default::default() };
        assert_eq!(not_running_because(&on, true, false), None);
        assert_eq!(not_running_because(&ApiConfig::default(), true, false), Some("off"), "off by default");
        assert_eq!(not_running_because(&on, false, false), Some("ai_off"), "the AI master switch stops it");
        assert_eq!(not_running_because(&on, true, true), Some("killed"), "--no-ai stops it");
        let no_tok = ApiConfig { token_sha256: String::new(), ..on };
        assert_eq!(not_running_because(&no_tok, true, false), Some("no_token"));
    }

    #[test]
    fn enabling_mints_a_token_once_and_bad_values_are_refused() {
        let d = std::env::temp_dir().join(format!("bmm-ai-api-app-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        let (cfg, t) = apply_change(&d, &ApiChange { enabled: Some(true), ..Default::default() }).unwrap();
        let t = t.expect("a token the first time");
        assert_eq!(cfg.token_sha256, core::hash_token(&t));
        let raw = std::fs::read_to_string(d.join(core::CONFIG_FILE)).unwrap();
        assert!(!raw.contains(&t), "the token itself is never written");
        let (_, again) = apply_change(&d, &ApiChange { enabled: Some(true), ..Default::default() }).unwrap();
        assert!(again.is_none(), "an existing token is not shown again");
        assert!(apply_change(&d, &ApiChange { port: Some(80), ..Default::default() }).is_err());
        assert!(apply_change(&d, &ApiChange { allowed_origins: Some(vec!["*".into()]), ..Default::default() }).is_err());
        let (cfg, _) = apply_change(&d, &ApiChange { allowed_origins: Some(vec!["http://localhost:5173".into(), " ".into()]), ..Default::default() }).unwrap();
        assert_eq!(cfg.allowed_origins, vec!["http://localhost:5173".to_string()]);
        let _ = std::fs::remove_dir_all(&d);
    }
}
