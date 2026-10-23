//! « API Laya locale » from the CLI and MCP: `bmm ai-api start|stop|status|rotate`,
//! `bmm_ai_api_status|start|stop`.
//!
//! This binary never serves the API: it edits `ai-api.json` (the same file, through the same
//! `ai_api_core`, as the app) and probes `/health`. The running app's watcher starts or stops
//! the server within a few seconds of the change — only while AI is on in BMM.
//!
//! The token is a credential. The CLI (the user, at a terminal) is shown a new one once. An MCP
//! client is NEVER handed one: `bmm_ai_api_start` turns the API on, and if no token exists yet it
//! says so and the user makes one in Settings or with `bmm ai-api rotate`. An agent that a
//! crafted document talked into "start the API" gains no way to call it.

use serde_json::{json, Value};

use crate::commands::ai_api_core::{self as core, ApiConfig};
use crate::commands::ai_core;
use crate::mcp::state_bridge;

fn dir() -> std::path::PathBuf {
    state_bridge::get_bmm_data_dir()
}

pub fn status() -> Value {
    let d = dir();
    let cfg = core::load_config(&d);
    let ai_on = ai_core::load_settings(&d).enabled;
    let health = if cfg.enabled { core::probe_health(cfg.port, 1500).ok() } else { None };
    json!({
        "enabled": cfg.enabled,
        "port": cfg.port,
        "url": format!("http://127.0.0.1:{}", cfg.port),
        "hasToken": cfg.token_sha256.len() == 64,
        "aiEnabled": ai_on,
        "listening": health.is_some(),
        "ready": health.as_ref().and_then(|h| h.get("ready")).cloned().unwrap_or(Value::Bool(false)),
        "allowedOrigins": cfg.allowed_origins,
        "concurrency": cfg.concurrency,
        "note": note(&cfg, ai_on, health.is_some()),
    })
}

fn note(cfg: &ApiConfig, ai_on: bool, listening: bool) -> &'static str {
    if !cfg.enabled {
        "off"
    } else if !ai_on {
        "waiting: AI is off in BMM"
    } else if cfg.token_sha256.len() != 64 {
        "waiting: no token (Settings, or `bmm ai-api rotate`)"
    } else if !listening {
        "enabled; the BMM app starts it when it runs"
    } else {
        "listening"
    }
}

/// Turn it on. `mint`: make a token if there is none (the CLI), returned once.
pub fn start(port: Option<u16>, mint: bool) -> Result<(Value, Option<String>), String> {
    let d = dir();
    let mut cfg = core::load_config(&d);
    if let Some(p) = port {
        if p < 1024 {
            return Err("port: 1024 to 65535".into());
        }
        cfg.port = p;
    }
    cfg.enabled = true;
    let mut token = None;
    if mint && cfg.token_sha256.len() != 64 {
        let t = core::new_token();
        cfg.token_sha256 = core::hash_token(&t);
        token = Some(t);
    }
    core::save_config(&d, &cfg)?;
    Ok((status(), token))
}

pub fn stop() -> Result<Value, String> {
    let d = dir();
    let mut cfg = core::load_config(&d);
    cfg.enabled = false;
    core::save_config(&d, &cfg)?;
    Ok(status())
}

/// A new token (CLI only). The old one stops working when the app picks the change up.
pub fn rotate() -> Result<String, String> {
    let d = dir();
    let mut cfg = core::load_config(&d);
    let t = core::new_token();
    cfg.token_sha256 = core::hash_token(&t);
    core::save_config(&d, &cfg)?;
    Ok(t)
}
