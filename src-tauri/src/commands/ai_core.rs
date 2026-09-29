//! Optional AI assistance ("IA optionnelle / Laya") — the half that needs nothing from the app.
//!
//! Mounted twice: by the app (`commands::ai_core`) and by the CLI/MCP binary
//! (`extra_tools/mcp_server.rs` mounts this file at the same path), so it may only use external
//! crates — no `crate::` item. Everything that touches `AppState` lives in `commands::ai`.
//!
//! ## What this is, and what it is not
//!
//! BMM does NOT bundle a model. Laya (`convaiinnovations/laya-multilingual`) is a multilingual
//! CLASSIFIER: it picks one option from a list (`choice`), gives a calibrated P(true) for a
//! yes/no question (`noul`) or an ordinal score. It does not write text. So:
//!
//! * a **description** comes from the mod's own files (manifest, readme, entry.lua …), or — only
//!   if the user configured one — from an OpenAI-compatible **external API** they chose;
//! * **tags** are picked from the user's EXISTING tag vocabulary, never invented;
//! * language and "adult content" are shown as hints, never written anywhere.
//!
//! ## The one rule
//!
//! Every function here that could reach the network starts with [`gate`]. The master switch
//! is OFF by default (privacy defaults: opt-in), a kill switch (`--no-ai`, `BMM_NO_AI=1`) beats
//! the file, and a provider that is not configured is not called. The tests below prove it with
//! a transport that counts calls: with the switch off, the count stays at zero.
//!
//! Nothing is ever written to a mod from here: suggestions are returned, and applying them is a
//! separate call that takes an explicit field list (see [`build_patch`]).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use regex::Regex;

/// The settings file, beside data.json.
pub const SETTINGS_FILE: &str = "ai-settings.json";
/// DPAPI-sealed secrets (Windows). On macOS/Linux the OS keyring holds them instead.
pub const SECRETS_FILE: &str = "ai-secrets.json";
/// Laya's default local server (`laya-serve`, LAYA_PORT=8000).
pub const DEFAULT_LOCAL_URL: &str = "http://127.0.0.1:8000";
/// The text sent to any provider is capped here (the BCWEB contract accepts ≤ 4000 chars).
pub const MAX_PROVIDER_TEXT: usize = 4000;
/// At most this many tags are asked about in one classifier pass (each is one question).
pub const MAX_TAGS_ASKED: usize = 16;
/// The mod editor allows three tags per mod; applying never goes beyond it.
pub const MAX_TAGS_PER_MOD: usize = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

/// Everything the user chose. Defaults are OFF: nothing is sent anywhere until the user turns
/// the master switch on AND picks a provider (AND, for BetterCommunity, accepts what is sent).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct AiSettings {
    /// Master switch. Off = no network call from any AI feature, anywhere.
    pub enabled: bool,
    /// Classifier provider: "off" | "bettercommunity" | "local".
    pub classifier: String,
    /// Generative provider (description drafts only): "off" | "external".
    pub generative: String,
    /// Per-feature toggles — only meaningful while `enabled`.
    pub mod_suggest: bool,
    pub report_triage: bool,
    pub description_drafts: bool,
    /// The user's own `laya-serve`. Loopback only unless `local_allow_remote`.
    pub local_url: String,
    pub local_allow_remote: bool,
    /// OpenAI-compatible base URL (e.g. https://api.openai.com/v1) and model name.
    pub external_url: String,
    pub external_model: String,
    /// The user accepted the disclosure of what is sent to BetterCommunity.
    pub bc_consent: bool,
    /// Per-request timeout, clamped to 1–60 s.
    pub timeout_ms: u64,
    /// The installer set the master switch (informational; the switch itself is `enabled`).
    pub installer_choice: Option<bool>,
}

impl Default for AiSettings {
    fn default() -> Self {
        AiSettings {
            enabled: false,
            classifier: "off".into(),
            generative: "off".into(),
            mod_suggest: true,
            report_triage: true,
            description_drafts: true,
            local_url: DEFAULT_LOCAL_URL.into(),
            local_allow_remote: false,
            external_url: String::new(),
            external_model: String::new(),
            bc_consent: false,
            timeout_ms: 20_000,
            installer_choice: None,
        }
    }
}

impl AiSettings {
    /// Unknown words become "off"; numbers are clamped; strings are trimmed and bounded.
    pub fn normalized(mut self) -> Self {
        if !matches!(self.classifier.as_str(), "off" | "bettercommunity" | "local") {
            self.classifier = "off".into();
        }
        if !matches!(self.generative.as_str(), "off" | "external") {
            self.generative = "off".into();
        }
        self.timeout_ms = self.timeout_ms.clamp(1_000, 60_000);
        self.local_url = bounded(self.local_url.trim(), 300);
        if self.local_url.is_empty() {
            self.local_url = DEFAULT_LOCAL_URL.into();
        }
        self.external_url = bounded(self.external_url.trim(), 300);
        self.external_model = bounded(self.external_model.trim(), 120);
        self
    }
}

fn bounded(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// Read the settings. Missing or malformed → the defaults (everything off), never an error:
/// a broken file must not be able to turn anything ON.
pub fn load_settings(dir: &Path) -> AiSettings {
    std::fs::read_to_string(dir.join(SETTINGS_FILE))
        .ok()
        .and_then(|t| serde_json::from_str::<AiSettings>(&t).ok())
        .unwrap_or_default()
        .normalized()
}

pub fn save_settings(dir: &Path, s: &AiSettings) -> Result<AiSettings, String> {
    let s = s.clone().normalized();
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(&s).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("{}.tmp", SETTINGS_FILE));
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(SETTINGS_FILE)).map_err(|e| e.to_string())?;
    Ok(s)
}

/// The installer's "Fonctionnalités IA optionnelles (Laya)" box. Ticked turns the master
/// switch on (providers stay "off", so still nothing is sent until one is chosen); unticked
/// turns it off. Either way the choice is remembered for the Settings screen to show.
pub fn apply_installer_choice(dir: &Path, on: bool) -> Result<AiSettings, String> {
    let mut s = load_settings(dir);
    s.enabled = on;
    s.installer_choice = Some(on);
    save_settings(dir, &s)
}

/// `--no-ai` on the command line or `BMM_NO_AI=1` in the environment: AI is off for this run,
/// whatever the file says. For a locked-down machine or a support session.
pub fn kill_switch() -> bool {
    let env = std::env::var("BMM_NO_AI")
        .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false);
    env || std::env::args().any(|a| a == "--no-ai")
}

// ─────────────────────────────────────────────────────────────────────────────
// The gate
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Feature {
    ModSuggest,
    ReportTriage,
    DescriptionDraft,
    TestConnection,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    BetterCommunity,
    Local,
    External,
}

/// Why nothing was sent. Short, stable words the UI translates.
pub type Blocked = &'static str;

/// May `feature` reach the network, and through which provider? This is the ONLY way a
/// provider gets chosen, so a disabled switch cannot be forgotten on one code path.
pub fn gate(s: &AiSettings, feature: Feature, killed: bool) -> Result<Provider, Blocked> {
    if killed {
        return Err("killed");
    }
    if !s.enabled {
        return Err("ai_off");
    }
    let feature_on = match feature {
        Feature::ModSuggest => s.mod_suggest,
        Feature::ReportTriage => s.report_triage,
        Feature::DescriptionDraft => s.description_drafts,
        Feature::TestConnection => true,
    };
    if !feature_on {
        return Err("feature_off");
    }
    if feature == Feature::DescriptionDraft {
        return if s.generative == "external" { Ok(Provider::External) } else { Err("no_provider") };
    }
    match s.classifier.as_str() {
        "local" => Ok(Provider::Local),
        "bettercommunity" if s.bc_consent => Ok(Provider::BetterCommunity),
        "bettercommunity" => Err("no_consent"),
        _ => Err("no_provider"),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint validation (SSRF-ish rules)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndpointKind {
    LocalLaya,
    External,
    BetterCommunity,
}

#[derive(Debug, Clone, Serialize)]
pub struct CheckedUrl {
    pub url: String,
    /// Set when the URL is accepted but deserves a warning ("remote").
    pub warning: Option<&'static str>,
}

fn host_is_loopback(host: &str) -> bool {
    let h = host.trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    if h == "localhost" || h.ends_with(".localhost") {
        return true;
    }
    match h.parse::<std::net::IpAddr>() {
        Ok(ip) => ip.is_loopback(),
        Err(_) => false,
    }
}

/// A literal IP that is private, link-local, unspecified or otherwise not the public internet.
fn host_is_private_ip(host: &str) -> bool {
    let h = host.trim_start_matches('[').trim_end_matches(']');
    match h.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(v4)) => {
            v4.is_private() || v4.is_link_local() || v4.is_unspecified() || v4.is_broadcast()
                || v4.is_loopback() || v4.octets()[0] == 100 && (64..128).contains(&v4.octets()[1])
        }
        Ok(std::net::IpAddr::V6(v6)) => {
            let seg0 = v6.segments()[0];
            v6.is_loopback() || v6.is_unspecified() || (seg0 & 0xfe00) == 0xfc00 || (seg0 & 0xffc0) == 0xfe80
        }
        Err(_) => false,
    }
}

/// Validate a provider URL before anything is sent to it.
///
/// * http(s) only; no `user:pass@`; a host is required.
/// * Local Laya: loopback by default. A remote host needs `allow_remote` and comes back with a
///   warning (the text leaves this PC).
/// * External API: https, except on loopback (a local OpenAI-compatible server). A literal
///   private / link-local IP is refused — the key would be sent there.
/// * BetterCommunity: https to bettercommunity.ch (or a subdomain), or loopback for the
///   developer test mode. Anything else is refused: the account's credential goes with it.
pub fn validate_url(raw: &str, kind: EndpointKind, allow_remote: bool) -> Result<CheckedUrl, String> {
    let raw = raw.trim();
    let url = reqwest::Url::parse(raw).map_err(|_| "ai.url.invalid".to_string())?;
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return Err("ai.url.scheme".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("ai.url.userinfo".into());
    }
    let host = url.host_str().ok_or_else(|| "ai.url.invalid".to_string())?.to_string();
    let loopback = host_is_loopback(&host);
    let mut clean = url.clone();
    clean.set_fragment(None);
    let out = |warning| Ok(CheckedUrl { url: clean.to_string().trim_end_matches('/').to_string(), warning });
    match kind {
        EndpointKind::LocalLaya => {
            if loopback {
                out(None)
            } else if allow_remote {
                out(Some("remote"))
            } else {
                Err("ai.url.notLoopback".into())
            }
        }
        EndpointKind::External => {
            if loopback {
                return out(None);
            }
            if scheme != "https" {
                return Err("ai.url.httpsRequired".into());
            }
            if host_is_private_ip(&host) {
                return Err("ai.url.privateHost".into());
            }
            out(None)
        }
        EndpointKind::BetterCommunity => {
            let h = host.to_ascii_lowercase();
            if loopback {
                return out(None);
            }
            if scheme == "https" && (h == "bettercommunity.ch" || h.ends_with(".bettercommunity.ch")) {
                out(None)
            } else {
                Err("ai.url.notBetterCommunity".into())
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Transport
// ─────────────────────────────────────────────────────────────────────────────

/// The only door to the network. A trait so the tests can prove nobody knocked.
pub trait Transport {
    fn post_json(&self, url: &str, headers: &[(String, String)], body: &Value, timeout_ms: u64) -> Result<Value, String>;
    fn get_json(&self, url: &str, headers: &[(String, String)], timeout_ms: u64) -> Result<Value, String>;
}

/// The real one: blocking reqwest, no redirects (a provider cannot bounce the request — and
/// its Authorization header — somewhere else), responses capped at 1 MiB.
pub struct HttpTransport;

const MAX_RESPONSE: u64 = 1024 * 1024;

impl HttpTransport {
    fn client(timeout_ms: u64) -> Result<reqwest::blocking::Client, String> {
        reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_millis(timeout_ms))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(concat!("BetterModsManager/", env!("CARGO_PKG_VERSION"), " (ai)"))
            .build()
            .map_err(|e| e.to_string())
    }
    fn read(resp: reqwest::blocking::Response) -> Result<Value, String> {
        let status = resp.status();
        let mut buf = String::new();
        resp.take(MAX_RESPONSE).read_to_string(&mut buf).map_err(|e| e.to_string())?;
        let parsed: Option<Value> = serde_json::from_str(&buf).ok();
        if !status.is_success() {
            // A JSON body with `ok:false` is an answer, not a transport failure (BCWEB says why).
            if let Some(v) = parsed.as_ref().filter(|v| v.get("ok").is_some()) {
                return Ok(v.clone());
            }
            return Err(format!("http_{}", status.as_u16()));
        }
        parsed.ok_or_else(|| "bad_json".to_string())
    }
}

impl Transport for HttpTransport {
    fn post_json(&self, url: &str, headers: &[(String, String)], body: &Value, timeout_ms: u64) -> Result<Value, String> {
        let mut rq = Self::client(timeout_ms)?.post(url).json(body);
        for (k, v) in headers {
            rq = rq.header(k.as_str(), v.as_str());
        }
        let resp = rq.send().map_err(|e| if e.is_timeout() { "timeout".to_string() } else { "unreachable".to_string() })?;
        Self::read(resp)
    }
    fn get_json(&self, url: &str, headers: &[(String, String)], timeout_ms: u64) -> Result<Value, String> {
        let mut rq = Self::client(timeout_ms)?.get(url);
        for (k, v) in headers {
            rq = rq.header(k.as_str(), v.as_str());
        }
        let resp = rq.send().map_err(|e| if e.is_timeout() { "timeout".to_string() } else { "unreachable".to_string() })?;
        Self::read(resp)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Secrets (API keys)
// ─────────────────────────────────────────────────────────────────────────────
//
// Windows: DPAPI (user scope, BMM's own entropy) into ai-secrets.json — undecryptable by another
// account or PC. macOS/Linux: the OS keyring. When neither works the key is kept in memory for
// this run only and NOT persisted; the UI says so. Keys are never handed back to the webview.

pub const SECRET_NAMES: &[&str] = &["local_key", "external_key"];

fn memory_secrets() -> &'static Mutex<HashMap<String, String>> {
    static M: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    M.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(target_os = "windows")]
fn dpapi(data: &[u8], protect: bool) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    const ENTROPY: &[u8] = b"BetterModsManager/ai-secrets/v1";
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let entropy = CRYPT_INTEGER_BLOB { cbData: ENTROPY.len() as u32, pbData: ENTROPY.as_ptr() as *mut u8 };
    let mut out = CRYPT_INTEGER_BLOB::default();
    // SAFETY: every pointer outlives the call; `out` is allocated by the API, copied, wiped and
    // released with LocalFree.
    unsafe {
        let r = if protect {
            CryptProtectData(&input, windows::core::PCWSTR::null(), Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        } else {
            CryptUnprotectData(&input, None, Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        };
        r.map_err(|e| format!("DPAPI: {}", e))?;
        if out.pbData.is_null() {
            return Err("DPAPI returned nothing".into());
        }
        let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        std::ptr::write_bytes(out.pbData, 0, out.cbData as usize);
        let _ = LocalFree(HLOCAL(out.pbData as *mut core::ffi::c_void));
        Ok(v)
    }
}

#[cfg(target_os = "windows")]
fn sealed_map(dir: &Path) -> HashMap<String, String> {
    std::fs::read_to_string(dir.join(SECRETS_FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// Where a stored key lives: "dpapi", "keychain"/"keyring", "memory" (this run only) or "" (none).
pub fn secret_storage(dir: &Path, name: &str) -> &'static str {
    if memory_secrets().lock().map(|m| m.contains_key(name)).unwrap_or(false) {
        return "memory";
    }
    #[cfg(target_os = "windows")]
    {
        if sealed_map(dir).contains_key(name) {
            return "dpapi";
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = dir;
        if keyring::Entry::new("BetterModsManager.ai", name).ok().and_then(|e| e.get_password().ok()).is_some() {
            return "keyring";
        }
    }
    ""
}

pub fn get_secret(dir: &Path, name: &str) -> Option<String> {
    if let Some(v) = memory_secrets().lock().ok().and_then(|m| m.get(name).cloned()) {
        return Some(v);
    }
    #[cfg(target_os = "windows")]
    {
        let hexed = sealed_map(dir).get(name)?.clone();
        let blob = hex_decode(&hexed)?;
        let plain = dpapi(&blob, false).ok()?;
        String::from_utf8(plain).ok().filter(|s| !s.is_empty())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = dir;
        keyring::Entry::new("BetterModsManager.ai", name).ok()?.get_password().ok().filter(|s| !s.is_empty())
    }
}

/// Store (or, with an empty value, clear) a key. Returns where it went.
pub fn set_secret(dir: &Path, name: &str, value: &str) -> Result<&'static str, String> {
    if !SECRET_NAMES.contains(&name) {
        return Err("ai.secret.unknown".into());
    }
    let value = value.trim();
    if value.len() > 4096 || value.chars().any(|c| c.is_control()) {
        return Err("ai.secret.invalid".into());
    }
    if let Ok(mut m) = memory_secrets().lock() {
        m.remove(name);
    }
    #[cfg(target_os = "windows")]
    {
        let mut map = sealed_map(dir);
        if value.is_empty() {
            map.remove(name);
        } else {
            match dpapi(value.as_bytes(), true) {
                Ok(blob) => {
                    map.insert(name.to_string(), hex_encode(&blob));
                }
                Err(_) => {
                    if let Ok(mut m) = memory_secrets().lock() {
                        m.insert(name.to_string(), value.to_string());
                    }
                    return Ok("memory");
                }
            }
        }
        let _ = std::fs::create_dir_all(dir);
        std::fs::write(dir.join(SECRETS_FILE), serde_json::to_string_pretty(&map).unwrap_or_default())
            .map_err(|e| e.to_string())?;
        Ok(if value.is_empty() { "" } else { "dpapi" })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = dir;
        let entry = keyring::Entry::new("BetterModsManager.ai", name).map_err(|e| e.to_string());
        if value.is_empty() {
            if let Ok(e) = entry {
                let _ = e.delete_credential();
            }
            return Ok("");
        }
        match entry.and_then(|e| e.set_password(value).map_err(|e| e.to_string())) {
            Ok(()) => Ok("keyring"),
            Err(_) => {
                if let Ok(mut m) = memory_secrets().lock() {
                    m.insert(name.to_string(), value.to_string());
                }
                Ok("memory")
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn hex_encode(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

#[cfg(target_os = "windows")]
fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok()).collect()
}

// ─────────────────────────────────────────────────────────────────────────────
// PII scrubbing — for anything that leaves the machine
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Finding {
    /// "user_path" | "email" | "ip" | "token" | "username" | "machine"
    pub kind: String,
    pub count: usize,
}

struct Pii {
    win_user: Regex,
    unix_user: Regex,
    email: Regex,
    ipv4: Regex,
    bearer: Regex,
    github: Regex,
    openai: Regex,
    kv_secret: Regex,
}

fn pii() -> &'static Pii {
    static P: OnceLock<Pii> = OnceLock::new();
    P.get_or_init(|| Pii {
        // C:\Users\<name>\  and  C:/Users/<name>/  (also "Documents and Settings")
        win_user: Regex::new(r#"(?i)\b([a-z]:[\\/]+(?:users|documents and settings)[\\/]+)([^\\/\s"'<>|:*?]+)"#).expect("win_user"),
        // /home/<name>/  and  /Users/<name>/
        unix_user: Regex::new(r#"(/(?:home|Users)/)([^/\s"'<>]+)"#).expect("unix_user"),
        email: Regex::new(r#"(?i)\b[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}\b"#).expect("email"),
        // An IPv4 address that is not part of a longer dotted number (a 5-part version).
        ipv4: Regex::new(r#"(^|[^\d.v])((?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3})($|[^\d.])"#).expect("ipv4"),
        bearer: Regex::new(r#"(?i)\bbearer\s+[A-Za-z0-9._~+/=\-]{8,}"#).expect("bearer"),
        github: Regex::new(r#"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b"#).expect("github"),
        openai: Regex::new(r#"\bsk-[A-Za-z0-9_\-]{16,}\b"#).expect("openai"),
        kv_secret: Regex::new(r#"(?i)\b((?:api[_-]?key|token|secret|password|passwd|pwd)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s&,;]+)"#).expect("kv"),
    })
}

/// Replace personal data with neutral markers, and report what was found (kinds and counts
/// only — never the values). `username`/`machine` are the OS account and computer names,
/// matched whole-word; `extra_literals` are known secrets (the app passes the ones it holds).
pub fn scrub_pii(text: &str, username: Option<&str>, machine: Option<&str>, extra_literals: &[String]) -> (String, Vec<Finding>) {
    let p = pii();
    let mut found: Vec<Finding> = Vec::new();
    let mut note = |kind: &str, n: usize| {
        if n == 0 {
            return;
        }
        if let Some(f) = found.iter_mut().find(|f| f.kind == kind) {
            f.count += n;
        } else {
            found.push(Finding { kind: kind.to_string(), count: n });
        }
    };
    let mut s = text.to_string();

    let mut lit_n = 0;
    for lit in extra_literals.iter().filter(|l| l.chars().count() >= 6) {
        let n = s.matches(lit.as_str()).count();
        if n > 0 {
            lit_n += n;
            s = s.replace(lit.as_str(), "<secret>");
        }
    }
    note("token", lit_n);

    for re in [&p.bearer, &p.github, &p.openai] {
        let n = re.find_iter(&s).count();
        note("token", n);
        s = re.replace_all(&s, "<secret>").into_owned();
    }
    let n = p.kv_secret.find_iter(&s).count();
    note("token", n);
    s = p.kv_secret.replace_all(&s, "${1}<secret>").into_owned();

    let n = p.win_user.find_iter(&s).count() + p.unix_user.find_iter(&s).count();
    note("user_path", n);
    s = p.win_user.replace_all(&s, "${1}<user>").into_owned();
    s = p.unix_user.replace_all(&s, "${1}<user>").into_owned();

    let n = p.email.find_iter(&s).count();
    note("email", n);
    s = p.email.replace_all(&s, "<email>").into_owned();

    let mut ip_n = 0;
    s = p
        .ipv4
        .replace_all(&s, |c: &regex::Captures| {
            let ip = &c[2];
            if ip.starts_with("127.") || ip == "0.0.0.0" {
                return c[0].to_string();
            }
            ip_n += 1;
            format!("{}<ip>{}", &c[1], &c[3])
        })
        .into_owned();
    note("ip", ip_n);

    for (kind, lit, marker) in [("username", username, "<user>"), ("machine", machine, "<pc>")] {
        let Some(lit) = lit.map(str::trim).filter(|l| l.chars().count() >= 3) else { continue };
        if let Ok(re) = Regex::new(&format!(r"(?i)\b{}\b", regex::escape(lit))) {
            let n = re.find_iter(&s).count();
            note(kind, n);
            s = re.replace_all(&s, marker).into_owned();
        }
    }
    (s, found)
}

/// The OS account and computer names, for [`scrub_pii`].
pub fn os_identity() -> (Option<String>, Option<String>) {
    let user = std::env::var("USERNAME").or_else(|_| std::env::var("USER")).ok();
    let pc = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).ok();
    (user, pc)
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic extraction
// ─────────────────────────────────────────────────────────────────────────────

/// One proposed value for one field. `applicable: false` = a hint only (language, adult
/// content): BMM has no such field on a mod, so it is shown and never written.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Suggestion {
    /// "name" | "version" | "author" | "description" | "tags" | "links" | "language" | "nsfw"
    pub field: String,
    /// String for scalar fields; a tag id for "tags"; {url,label,link_type} for "links".
    pub value: Value,
    /// "file" | "folder" | "laya" | "bettercommunity" | "api"
    pub source: String,
    /// Where exactly: "README.md", "entry.lua", "folder name", the provider…
    pub origin: String,
    /// 0..1. For a file, how reliable that kind of file is; for a model, its own probability.
    pub confidence: f32,
    pub applicable: bool,
    /// Extra words for the UI ("draft", the tag's name…).
    #[serde(default)]
    pub note: String,
}

/// What the mod currently says — to skip suggestions that change nothing.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModFacts {
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub tags: Vec<String>,
    pub links: Vec<String>,
    /// The mod's folder or archive on disk.
    pub path: PathBuf,
}

/// The user's tag vocabulary: (id, name).
pub type Vocab = Vec<(String, String)>;

/// Everything the extractor read, kept for the classifier/generative passes.
#[derive(Debug, Clone, Default, Serialize)]
pub struct Extracted {
    pub suggestions: Vec<Suggestion>,
    /// Plain-text excerpts (readme paragraph, manifest description) that describe the mod.
    pub excerpts: Vec<String>,
    /// Relative file names seen (capped).
    pub files: Vec<String>,
    /// Which metadata files were found.
    pub sources_read: Vec<String>,
}

const MAX_FILE_BYTES: u64 = 256 * 1024;
const MAX_WALK: usize = 4000;

/// Files worth reading, by lowercase base name.
fn wanted(base: &str) -> bool {
    matches!(
        base,
        "mod.json" | "modinfo.json" | "manifest.json" | "info.json" | "bmm-mod.json" | "metadata.json"
            | "descriptor.mod" | "about.xml" | "modinfo.xml" | "entry.lua" | "version.txt"
    ) || base.starts_with("readme") || base.starts_with("lisezmoi") || base == "read me.txt"
}

/// Read the metadata-bearing files of a mod folder, or of a .zip mod (7z/rar: names only,
/// passed in `extra_names` by the caller that can list them).
pub fn gather(root: &Path, extra_names: &[String]) -> (Vec<(String, String)>, Vec<String>) {
    let mut texts: Vec<(String, String)> = Vec::new();
    let mut names: Vec<String> = extra_names.iter().take(MAX_WALK).cloned().collect();
    if root.is_dir() {
        let mut stack = vec![(root.to_path_buf(), 0usize)];
        let mut seen = 0usize;
        while let Some((dir, depth)) = stack.pop() {
            let Ok(rd) = std::fs::read_dir(&dir) else { continue };
            for e in rd.flatten() {
                seen += 1;
                if seen > MAX_WALK {
                    break;
                }
                let p = e.path();
                let rel = p.strip_prefix(root).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
                let Ok(ft) = e.file_type() else { continue };
                if ft.is_symlink() {
                    continue;
                }
                if ft.is_dir() {
                    if depth < 2 {
                        stack.push((p, depth + 1));
                    }
                    continue;
                }
                names.push(rel.clone());
                let base = rel.rsplit('/').next().unwrap_or("").to_ascii_lowercase();
                if depth <= 2 && wanted(&base) {
                    if let Ok(meta) = e.metadata() {
                        if meta.len() <= MAX_FILE_BYTES {
                            if let Ok(bytes) = std::fs::read(&p) {
                                texts.push((rel, String::from_utf8_lossy(&bytes).into_owned()));
                            }
                        }
                    }
                }
            }
        }
    } else if root.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("zip")).unwrap_or(false) {
        if let Ok(f) = std::fs::File::open(root) {
            if let Ok(mut z) = zip::ZipArchive::new(f) {
                for i in 0..z.len().min(MAX_WALK) {
                    let Ok(mut entry) = z.by_index(i) else { continue };
                    if entry.is_dir() {
                        continue;
                    }
                    let rel = entry.name().replace('\\', "/");
                    if rel.contains("..") {
                        continue;
                    }
                    names.push(rel.clone());
                    let depth = rel.matches('/').count();
                    let base = rel.rsplit('/').next().unwrap_or("").to_ascii_lowercase();
                    if depth <= 2 && wanted(&base) && entry.size() <= MAX_FILE_BYTES {
                        let mut buf = Vec::new();
                        if (&mut entry).take(MAX_FILE_BYTES).read_to_end(&mut buf).is_ok() {
                            texts.push((rel, String::from_utf8_lossy(&buf).into_owned()));
                        }
                    }
                }
            }
        }
    }
    // Shallow files first: a manifest at the root beats one inside a sub-folder.
    texts.sort_by_key(|(rel, _)| (rel.matches('/').count(), rel.to_ascii_lowercase()));
    names.sort();
    names.dedup();
    (texts, names)
}

struct Rx {
    kv_quoted: Regex,
    desc_tags: Regex,
    quoted: Regex,
    xml_tag: Regex,
    xml_value: Regex,
    lua_field: Regex,
    url: Regex,
    md_link: Regex,
    md_noise: Regex,
    author_line: Regex,
    version_line: Regex,
    version_in_name: Regex,
    author_prefix: Regex,
}

fn rx() -> &'static Rx {
    static R: OnceLock<Rx> = OnceLock::new();
    R.get_or_init(|| Rx {
        kv_quoted: Regex::new(r#"(?m)^\s*([A-Za-z_]+)\s*=\s*"([^"]*)""#).expect("kv"),
        desc_tags: Regex::new(r#"(?s)\btags\s*=\s*\{([^}]*)\}"#).expect("desc_tags"),
        quoted: Regex::new(r#""([^"]+)""#).expect("quoted"),
        xml_tag: Regex::new(r#"(?is)<(name|author|description|url|modversion|packageid)>\s*(.*?)\s*</"#).expect("xml_tag"),
        xml_value: Regex::new(r#"(?i)<(name|displayname|author|version|description|website)\s+value\s*=\s*"([^"]*)""#).expect("xml_value"),
        lua_field: Regex::new(r#"(?m)\b(displayName|developerName|version|info|shortName)\s*=\s*_?\(?\s*"([^"]+)""#).expect("lua_field"),
        url: Regex::new(r#"https?://[^\s<>()\[\]"'`]+"#).expect("url"),
        md_link: Regex::new(r#"!?\[([^\]]*)\]\([^)]*\)"#).expect("md_link"),
        md_noise: Regex::new(r#"(\*\*|__|`|~~|<[^>]+>)"#).expect("md_noise"),
        author_line: Regex::new(r#"(?im)^\s*[*\-]?\s*(?:author|authors|auteur|auteurs|autor|made by|created by|cr[ée]{1,2} par|developer|d[ée]veloppeur)\s*[:：\-]\s*(.{2,60})$"#).expect("author_line"),
        version_line: Regex::new(r#"(?im)^\s*[*\-]?\s*(?:version|ver\.?)\s*[:：\-]?\s*v?(\d+(?:\.\d+){1,3}[A-Za-z0-9.\-]*)\s*$"#).expect("version_line"),
        version_in_name: Regex::new(r#"(?i)(?:^|[\s_\-(\[])v?(\d+(?:\.\d+){1,3}[a-z]?)(?:[\s_\-)\]]|$)"#).expect("version_in_name"),
        author_prefix: Regex::new(r#"^\[([^\]]{2,40})\]\s*"#).expect("author_prefix"),
    })
}

fn clean_text(s: &str) -> String {
    let r = rx();
    let s = r.md_link.replace_all(s, "$1");
    let s = r.md_noise.replace_all(&s, "");
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The first real paragraph of a readme: skips headings, badges, images, rules and HTML.
pub fn first_paragraph(readme: &str) -> Option<String> {
    let mut para: Vec<&str> = Vec::new();
    for line in readme.lines() {
        let t = line.trim();
        let noise = t.starts_with('#') || t.starts_with("![") || t.starts_with("[![") || t.starts_with('<')
            || t.starts_with("---") || t.starts_with("===") || t.starts_with("```") || t.starts_with('|')
            || t.starts_with('>') && t.len() < 3;
        if t.is_empty() {
            if !para.is_empty() {
                let joined = clean_text(&para.join(" "));
                if joined.chars().count() >= 25 {
                    return Some(joined.chars().take(600).collect());
                }
                para.clear();
            }
            continue;
        }
        if noise {
            if !para.is_empty() {
                let joined = clean_text(&para.join(" "));
                if joined.chars().count() >= 25 {
                    return Some(joined.chars().take(600).collect());
                }
                para.clear();
            }
            continue;
        }
        para.push(t);
    }
    let joined = clean_text(&para.join(" "));
    (joined.chars().count() >= 25).then(|| joined.chars().take(600).collect())
}

fn link_type(url: &str) -> &'static str {
    if url.contains("github.com/") {
        "github"
    } else {
        "other"
    }
}

fn useful_link(url: &str) -> bool {
    let l = url.to_ascii_lowercase();
    let is_image = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp"].iter().any(|x| l.ends_with(x));
    // A host with no dot is a placeholder or a markdown artefact, not a place to send anyone.
    let host_ok = l.split("//").nth(1).and_then(|r| r.split('/').next()).map(|h| h.contains('.')).unwrap_or(false);
    host_ok && !is_image && !l.contains("shields.io") && !l.contains("badge") && l.len() <= 300
}

fn norm(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'à' | 'á' | 'â' | 'ä' | 'ã' | 'å' => 'a',
            'ç' => 'c',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ñ' => 'n',
            'ò' | 'ó' | 'ô' | 'ö' | 'õ' => 'o',
            'ù' | 'ú' | 'û' | 'ü' => 'u',
            c => c,
        })
        .collect::<String>()
        .to_lowercase()
}

/// Rough language guess from stop-words (and scripts). Good enough for a hint, which is all
/// it is: BMM has no language field on a mod.
pub fn detect_language(text: &str) -> Option<(&'static str, f32)> {
    let cyr = text.chars().filter(|c| ('\u{0400}'..='\u{04FF}').contains(c)).count();
    let cjk = text.chars().filter(|c| ('\u{4E00}'..='\u{9FFF}').contains(c)).count();
    let kana = text.chars().filter(|c| ('\u{3040}'..='\u{30FF}').contains(c)).count();
    let letters = text.chars().filter(|c| c.is_alphabetic()).count().max(1);
    if kana * 10 > letters {
        return Some(("ja", 0.8));
    }
    if cjk * 5 > letters {
        return Some(("zh", 0.7));
    }
    if cyr * 3 > letters {
        return Some(("ru", 0.7));
    }
    const SW: &[(&str, &[&str])] = &[
        ("en", &["the", "and", "is", "this", "with", "for", "you", "of", "to", "it"]),
        ("fr", &["le", "la", "les", "et", "est", "une", "des", "pour", "avec", "ce", "du", "vous"]),
        ("de", &["der", "die", "und", "ist", "das", "mit", "für", "nicht", "ein", "eine", "sie"]),
        ("es", &["el", "los", "las", "y", "es", "una", "para", "con", "por", "que", "del"]),
        ("it", &["il", "gli", "e", "è", "una", "per", "con", "che", "della", "non", "sono"]),
        ("pt", &["o", "os", "as", "e", "é", "uma", "para", "com", "que", "não", "do"]),
    ];
    let words: Vec<String> = text
        .split(|c: char| !c.is_alphabetic())
        .filter(|w| !w.is_empty())
        .map(|w| w.to_lowercase())
        .collect();
    if words.len() < 6 {
        return None;
    }
    let mut best: Option<(&'static str, usize)> = None;
    let mut total = 0usize;
    for (code, list) in SW {
        let n = words.iter().filter(|w| list.contains(&w.as_str())).count();
        total += n;
        if best.map(|(_, b)| n > b).unwrap_or(true) {
            best = Some((code, n));
        }
    }
    let (code, n) = best?;
    if n < 2 || total == 0 {
        return None;
    }
    Some((code, (n as f32 / total as f32).clamp(0.3, 0.9)))
}

fn push(out: &mut Vec<Suggestion>, field: &str, value: Value, source: &str, origin: &str, confidence: f32) {
    out.push(Suggestion {
        field: field.into(),
        value,
        source: source.into(),
        origin: origin.into(),
        confidence,
        applicable: true,
        note: String::new(),
    });
}

/// Pull name / version / author / description / links / raw tags out of the files.
/// Pure: `texts` are (relative path, content) pairs, as [`gather`] returns them.
pub fn extract_from_texts(texts: &[(String, String)], folder_name: &str) -> (Vec<Suggestion>, Vec<String>, Vec<String>, Vec<String>) {
    let r = rx();
    let mut out: Vec<Suggestion> = Vec::new();
    let mut excerpts: Vec<String> = Vec::new();
    let mut raw_tags: Vec<String> = Vec::new();
    let mut read: Vec<String> = Vec::new();

    for (rel, content) in texts {
        let base = rel.rsplit('/').next().unwrap_or("").to_ascii_lowercase();
        let origin = rel.as_str();
        if base.ends_with(".json") {
            let Ok(v) = serde_json::from_str::<Value>(content.trim_start_matches('\u{feff}')) else { continue };
            read.push(rel.clone());
            let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::trim).filter(|x| !x.is_empty()).map(str::to_string);
            if let Some(n) = s("name").or_else(|| s("title")).or_else(|| s("displayName")) {
                push(&mut out, "name", json!(n), "file", origin, 0.9);
            }
            if let Some(n) = s("version") {
                push(&mut out, "version", json!(n), "file", origin, 0.9);
            }
            let author = s("author").or_else(|| {
                let a = v.get("authors").or_else(|| v.get("author"))?;
                let list: Vec<String> = a
                    .as_array()?
                    .iter()
                    .filter_map(|x| x.as_str().map(str::to_string).or_else(|| x.get("name").and_then(|n| n.as_str()).map(str::to_string)))
                    .collect();
                (!list.is_empty()).then(|| list.join(", "))
            }).or_else(|| v.get("author").and_then(|a| a.get("name")).and_then(|n| n.as_str()).map(str::to_string));
            if let Some(a) = author {
                push(&mut out, "author", json!(a), "file", origin, 0.9);
            }
            if let Some(d) = s("description").or_else(|| s("summary")) {
                let d = clean_text(&d);
                excerpts.push(d.clone());
                push(&mut out, "description", json!(d), "file", origin, 0.85);
            }
            for k in ["tags", "keywords", "categories"] {
                if let Some(a) = v.get(k).and_then(|x| x.as_array()) {
                    raw_tags.extend(a.iter().filter_map(|x| x.as_str().map(str::to_string)));
                }
            }
            for k in ["url", "homepage", "website", "repository", "source"] {
                let u = v.get(k).and_then(|x| x.as_str().map(str::to_string).or_else(|| x.get("url").and_then(|u| u.as_str()).map(str::to_string)));
                if let Some(u) = u.filter(|u| u.starts_with("http://") || u.starts_with("https://")) {
                    push(&mut out, "links", json!({ "url": u, "label": k, "link_type": link_type(&u) }), "file", origin, 0.85);
                }
            }
        } else if base == "descriptor.mod" {
            read.push(rel.clone());
            for c in r.kv_quoted.captures_iter(content) {
                let (k, val) = (c[1].to_ascii_lowercase(), c[2].trim().to_string());
                if val.is_empty() {
                    continue;
                }
                match k.as_str() {
                    "name" => push(&mut out, "name", json!(val), "file", origin, 0.9),
                    "version" => push(&mut out, "version", json!(val), "file", origin, 0.9),
                    "remote_file_id" if val.chars().all(|c| c.is_ascii_digit()) => {
                        let u = format!("https://steamcommunity.com/sharedfiles/filedetails/?id={}", val);
                        push(&mut out, "links", json!({ "url": u, "label": "Steam Workshop", "link_type": "other" }), "file", origin, 0.9)
                    }
                    _ => {}
                }
            }
            if let Some(c) = r.desc_tags.captures(content) {
                raw_tags.extend(r.quoted.captures_iter(&c[1]).map(|q| q[1].to_string()));
            }
        } else if base.ends_with(".xml") {
            read.push(rel.clone());
            for c in r.xml_tag.captures_iter(content) {
                let val = clean_text(&c[2]);
                if val.is_empty() {
                    continue;
                }
                match c[1].to_ascii_lowercase().as_str() {
                    "name" => push(&mut out, "name", json!(val), "file", origin, 0.85),
                    "author" => push(&mut out, "author", json!(val), "file", origin, 0.85),
                    "modversion" => push(&mut out, "version", json!(val), "file", origin, 0.85),
                    "description" => {
                        let d: String = val.chars().take(1500).collect();
                        excerpts.push(d.clone());
                        push(&mut out, "description", json!(d), "file", origin, 0.8)
                    }
                    "url" if val.starts_with("http") => push(&mut out, "links", json!({ "url": val, "label": "Website", "link_type": link_type(&val) }), "file", origin, 0.8),
                    _ => {}
                }
            }
            for c in r.xml_value.captures_iter(content) {
                let val = c[2].trim().to_string();
                if val.is_empty() {
                    continue;
                }
                match c[1].to_ascii_lowercase().as_str() {
                    "name" | "displayname" => push(&mut out, "name", json!(val), "file", origin, 0.85),
                    "author" => push(&mut out, "author", json!(val), "file", origin, 0.85),
                    "version" => push(&mut out, "version", json!(val), "file", origin, 0.85),
                    "description" => {
                        excerpts.push(val.clone());
                        push(&mut out, "description", json!(val), "file", origin, 0.8)
                    }
                    "website" if val.starts_with("http") => push(&mut out, "links", json!({ "url": val, "label": "Website", "link_type": link_type(&val) }), "file", origin, 0.8),
                    _ => {}
                }
            }
        } else if base == "entry.lua" {
            read.push(rel.clone());
            for c in r.lua_field.captures_iter(content) {
                let val = c[2].trim().to_string();
                match &c[1] {
                    "displayName" => push(&mut out, "name", json!(val), "file", origin, 0.9),
                    "developerName" => push(&mut out, "author", json!(val), "file", origin, 0.9),
                    "version" => push(&mut out, "version", json!(val), "file", origin, 0.9),
                    "info" => {
                        excerpts.push(val.clone());
                        push(&mut out, "description", json!(val), "file", origin, 0.75)
                    }
                    _ => {}
                }
            }
        } else if base == "version.txt" {
            read.push(rel.clone());
            if let Some(line) = content.lines().map(str::trim).find(|l| !l.is_empty()) {
                if line.chars().count() <= 30 && line.chars().any(|c| c.is_ascii_digit()) {
                    push(&mut out, "version", json!(line.trim_start_matches(['v', 'V'])), "file", origin, 0.8);
                }
            }
        } else {
            // readme / lisezmoi
            read.push(rel.clone());
            if let Some(p) = first_paragraph(content) {
                excerpts.push(p.clone());
                push(&mut out, "description", json!(p), "file", origin, 0.6);
            }
            if let Some(c) = r.author_line.captures(content) {
                push(&mut out, "author", json!(clean_text(&c[1])), "file", origin, 0.7);
            }
            if let Some(c) = r.version_line.captures(content) {
                push(&mut out, "version", json!(c[1].to_string()), "file", origin, 0.7);
            }
            let mut n = 0;
            for m in r.url.find_iter(content) {
                let u = m.as_str().trim_end_matches(['.', ',', ';', ':', '!', '?']).to_string();
                if !useful_link(&u) {
                    continue;
                }
                push(&mut out, "links", json!({ "url": u, "label": "", "link_type": link_type(&u) }), "file", origin, 0.5);
                n += 1;
                if n >= 5 {
                    break;
                }
            }
        }
    }

    // The folder (or archive) name: the weakest source, but often the only one.
    if !folder_name.trim().is_empty() {
        let stem = folder_name.trim();
        let stem = stem.strip_suffix(".zip").or_else(|| stem.strip_suffix(".7z")).or_else(|| stem.strip_suffix(".rar")).unwrap_or(stem);
        let mut rest = stem.to_string();
        if let Some(c) = r.author_prefix.captures(stem) {
            push(&mut out, "author", json!(c[1].trim()), "folder", "folder name", 0.4);
            rest = stem[c.get(0).map(|m| m.end()).unwrap_or(0)..].to_string();
        }
        if let Some(c) = r.version_in_name.captures(&rest) {
            push(&mut out, "version", json!(c[1].to_string()), "folder", "folder name", 0.45);
            let at = c.get(0).map(|m| m.start()).unwrap_or(rest.len());
            rest = rest[..at].to_string();
        }
        let pretty = rest.replace(['_', '.'], " ").split_whitespace().collect::<Vec<_>>().join(" ");
        if pretty.chars().count() >= 3 && pretty != stem {
            push(&mut out, "name", json!(pretty), "folder", "folder name", 0.35);
        }
    }
    (out, excerpts, raw_tags, read)
}

/// Tag ids whose name appears (whole word) in the text, or equals a tag the manifest declares.
pub fn match_vocab(vocab: &Vocab, text: &str, raw_tags: &[String]) -> Vec<Suggestion> {
    let hay = format!(" {} ", norm(text).split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" "));
    let declared: Vec<String> = raw_tags.iter().map(|t| norm(t.trim())).collect();
    let mut out = Vec::new();
    for (id, name) in vocab {
        let n = norm(name.trim());
        if n.chars().count() < 3 {
            continue;
        }
        let words = n.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ");
        let (conf, origin) = if declared.contains(&n) {
            (0.85, "manifest tags")
        } else if !words.is_empty() && hay.contains(&format!(" {} ", words)) {
            (0.5, "text match")
        } else {
            continue;
        };
        out.push(Suggestion {
            field: "tags".into(),
            value: json!(id),
            source: "file".into(),
            origin: origin.into(),
            confidence: conf,
            applicable: true,
            note: name.clone(),
        });
    }
    out
}

fn same(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

/// Drop what changes nothing, keep the best source per scalar field, one row per tag/link.
pub fn finalize(mut list: Vec<Suggestion>, facts: &ModFacts) -> Vec<Suggestion> {
    list.retain(|s| match s.field.as_str() {
        "name" => s.value.as_str().map(|v| !v.trim().is_empty() && !same(v, &facts.name)).unwrap_or(false),
        "version" => s.value.as_str().map(|v| !v.trim().is_empty() && !same(v.trim_start_matches(['v', 'V']), facts.version.trim_start_matches(['v', 'V']))).unwrap_or(false),
        "author" => s.value.as_str().map(|v| !v.trim().is_empty() && !same(v, &facts.author)).unwrap_or(false),
        "description" => s.value.as_str().map(|v| v.trim().chars().count() >= 10 && !same(v, &facts.description)).unwrap_or(false),
        "tags" => s.value.as_str().map(|id| !facts.tags.iter().any(|t| t == id)).unwrap_or(false),
        "links" => s.value.get("url").and_then(|u| u.as_str()).map(|u| !facts.links.iter().any(|l| l.trim_end_matches('/') == u.trim_end_matches('/'))).unwrap_or(false),
        _ => true,
    });
    // Best first, then dedupe on (field, value): the first of each is kept.
    list.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));
    let mut seen: Vec<(String, String)> = Vec::new();
    let mut out: Vec<Suggestion> = Vec::new();
    let mut scalar_count: HashMap<String, usize> = HashMap::new();
    for s in list {
        let key_val = match s.field.as_str() {
            "links" => s.value.get("url").and_then(|u| u.as_str()).unwrap_or("").trim_end_matches('/').to_ascii_lowercase(),
            _ => s.value.as_str().map(|v| v.trim().to_ascii_lowercase()).unwrap_or_else(|| s.value.to_string()),
        };
        let key = (s.field.clone(), key_val);
        if seen.contains(&key) {
            continue;
        }
        // Scalar fields: at most two alternatives (the best, and one runner-up to choose from).
        if matches!(s.field.as_str(), "name" | "version" | "author" | "description" | "language" | "nsfw") {
            let n = scalar_count.entry(s.field.clone()).or_insert(0);
            if *n >= 2 {
                continue;
            }
            *n += 1;
        }
        seen.push(key);
        out.push(s);
    }
    let order = |f: &str| ["name", "version", "author", "description", "tags", "links", "language", "nsfw"].iter().position(|x| *x == f).unwrap_or(99);
    out.sort_by(|a, b| order(&a.field).cmp(&order(&b.field)).then(b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal)));
    out
}

/// The whole deterministic pass for one mod. No network, ever.
pub fn extract(facts: &ModFacts, vocab: &Vocab, extra_names: &[String]) -> Extracted {
    let (texts, names) = gather(&facts.path, extra_names);
    let folder = facts.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let (mut sugg, excerpts, raw_tags, read) = extract_from_texts(&texts, &folder);
    let text_for_tags = format!("{} {} {}", facts.name, facts.description, excerpts.join(" "));
    sugg.extend(match_vocab(vocab, &text_for_tags, &raw_tags));
    let lang_text = if excerpts.is_empty() { facts.description.clone() } else { excerpts.join(" ") };
    if let Some((code, conf)) = detect_language(&lang_text) {
        sugg.push(Suggestion {
            field: "language".into(),
            value: json!(code),
            source: "file".into(),
            origin: "text".into(),
            confidence: conf,
            applicable: false,
            note: String::new(),
        });
    }
    Extracted {
        suggestions: finalize(sugg, facts),
        excerpts,
        files: names.into_iter().take(200).collect(),
        sources_read: read,
    }
}

/// The text a provider is given about a mod: name, author, the excerpts, some file names —
/// scrubbed of personal data and capped. Returned so the UI can show EXACTLY what is sent.
pub fn provider_text(facts: &ModFacts, ex: &Extracted) -> String {
    let mut s = String::new();
    if !facts.name.is_empty() {
        s.push_str(&format!("Name: {}\n", facts.name));
    }
    if !facts.author.is_empty() {
        s.push_str(&format!("Author: {}\n", facts.author));
    }
    if !facts.description.trim().is_empty() {
        s.push_str(&format!("Description: {}\n", facts.description.trim()));
    }
    for e in ex.excerpts.iter().take(3) {
        s.push_str(&format!("Excerpt: {}\n", e));
    }
    if !ex.files.is_empty() {
        let files: Vec<&str> = ex.files.iter().take(40).map(String::as_str).collect();
        s.push_str(&format!("Files: {}\n", files.join(", ")));
    }
    let (user, pc) = os_identity();
    let (clean, _) = scrub_pii(&s, user.as_deref(), pc.as_deref(), &[]);
    clean.chars().take(MAX_PROVIDER_TEXT).collect()
}

// ─────────────────────────────────────────────────────────────────────────────
// Providers
// ─────────────────────────────────────────────────────────────────────────────

/// How BMM proves who it is to BetterCommunity: the base URL (validated) and the headers
/// (a Bearer API key read in Rust and/or the creator-proof headers the frontend computed).
#[derive(Debug, Clone, Default)]
pub struct BcAuth {
    pub base: String,
    pub headers: Vec<(String, String)>,
}

pub struct Ctx<'a> {
    pub settings: &'a AiSettings,
    pub transport: &'a dyn Transport,
    pub killed: bool,
    pub local_key: Option<String>,
    pub external_key: Option<String>,
    pub bc: Option<BcAuth>,
}

/// A readable one-word reason out of a provider failure (for the UI and the MCP result).
fn short_reason(e: &str) -> String {
    e.chars().take(80).collect()
}

fn laya_url(ctx: &Ctx) -> Result<String, String> {
    let u = validate_url(&ctx.settings.local_url, EndpointKind::LocalLaya, ctx.settings.local_allow_remote)?;
    Ok(if u.url.ends_with("/v1/systemone") { u.url } else { format!("{}/v1/systemone", u.url) })
}

fn laya_headers(ctx: &Ctx) -> Vec<(String, String)> {
    ctx.local_key.as_ref().filter(|k| !k.is_empty()).map(|k| vec![("Authorization".to_string(), format!("Bearer {}", k))]).unwrap_or_default()
}

/// Build Laya's request body. `questions` are (id, type, instructions, criteria).
pub fn laya_body(text: &str, questions: &[(String, &str, String, Vec<(String, String)>)]) -> Value {
    let mut q = serde_json::Map::new();
    for (id, kind, instr, criteria) in questions {
        let mut o = serde_json::Map::new();
        o.insert("type".into(), json!(kind));
        o.insert("instructions".into(), json!(instr));
        if !criteria.is_empty() {
            let c: serde_json::Map<String, Value> = criteria.iter().map(|(k, v)| (k.clone(), json!(v))).collect();
            o.insert("criteria".into(), Value::Object(c));
        }
        q.insert(id.clone(), Value::Object(o));
    }
    json!({ "state": { "body": text }, "questions": Value::Object(q) })
}

/// Read one answer out of Laya's response, whatever shape the version answers in:
/// a bare label, a bare probability, or an object carrying either (+ probabilities).
pub fn laya_answer(resp: &Value, id: &str) -> (Option<String>, Option<f64>, Option<f64>) {
    let a = resp.get("answers").and_then(|a| a.get(id)).cloned().unwrap_or(Value::Null);
    let conf = resp
        .get("answer_confidence")
        .and_then(|c| c.get(id))
        .and_then(|c| c.as_f64().or_else(|| c.get("confidence").and_then(|x| x.as_f64())))
        .or_else(|| resp.get("confidence").and_then(|c| c.get(id)).and_then(|c| c.as_f64()));
    match a {
        Value::String(s) => (Some(s), None, conf),
        Value::Number(n) => (None, n.as_f64(), conf),
        Value::Bool(b) => (None, Some(if b { 1.0 } else { 0.0 }), conf),
        Value::Object(o) => {
            let choice = ["choice", "answer", "label", "value"].iter().find_map(|k| o.get(*k).and_then(|v| v.as_str()).map(str::to_string));
            let p = ["p", "prob", "probability", "p_true", "value", "score"].iter().find_map(|k| o.get(*k).and_then(|v| v.as_f64()));
            let c2 = o.get("confidence").and_then(|v| v.as_f64()).or(conf);
            (choice, p, c2)
        }
        _ => (None, None, conf),
    }
}

const LANGS: &[(&str, &str)] = &[
    ("en", "English"), ("fr", "French"), ("de", "German"), ("es", "Spanish"), ("it", "Italian"),
    ("pt", "Portuguese"), ("ru", "Russian"), ("pl", "Polish"), ("zh", "Chinese"), ("ja", "Japanese"),
];

fn bc_suggest(ctx: &Ctx, task: &str, text: &str, options: &[String]) -> Result<Value, String> {
    let bc = ctx.bc.as_ref().ok_or_else(|| "not_signed_in".to_string())?;
    let base = validate_url(&bc.base, EndpointKind::BetterCommunity, false)?;
    let url = format!("{}/api/ai/bmm/suggest", base.url.trim_end_matches("/api"));
    let body = json!({ "task": task, "text": text.chars().take(MAX_PROVIDER_TEXT).collect::<String>(), "options": options });
    let v = ctx.transport.post_json(&url, &bc.headers, &body, ctx.settings.timeout_ms)?;
    if v.get("ok").and_then(|o| o.as_bool()) == Some(true) {
        Ok(v.get("result").cloned().unwrap_or(Value::Null))
    } else {
        Err(v.get("reason").and_then(|r| r.as_str()).unwrap_or("unavailable").to_string())
    }
}

/// Classifier pass for one mod: tags from the user's vocabulary, language, adult content.
/// Returns suggestions and human-readable notes (a provider error is a note, not a failure:
/// the deterministic suggestions stand on their own).
pub fn classify_mod(ctx: &Ctx, text: &str, vocab: &Vocab) -> (Vec<Suggestion>, Vec<String>) {
    let provider = match gate(ctx.settings, Feature::ModSuggest, ctx.killed) {
        Ok(p) => p,
        Err(why) => return (Vec::new(), vec![format!("classifier:{}", why)]),
    };
    let asked: Vec<&(String, String)> = vocab.iter().filter(|(_, n)| !n.trim().is_empty()).take(MAX_TAGS_ASKED).collect();
    let mut out = Vec::new();
    let mut notes = Vec::new();
    match provider {
        Provider::Local => {
            let url = match laya_url(ctx) {
                Ok(u) => u,
                Err(e) => return (out, vec![format!("laya:{}", e)]),
            };
            let mut qs: Vec<(String, &str, String, Vec<(String, String)>)> = Vec::new();
            for (i, (_, name)) in asked.iter().enumerate() {
                qs.push((format!("tag_{}", i), "noul", format!("Is this game mod about \"{}\"? Answer yes only if the text clearly says so.", name), Vec::new()));
            }
            qs.push(("language".into(), "choice", "In which language is this text written?".into(), LANGS.iter().map(|(c, n)| (c.to_string(), n.to_string())).collect()));
            qs.push(("nsfw".into(), "noul", "Does this game mod contain sexual or adult-only content?".into(), Vec::new()));
            match ctx.transport.post_json(&url, &laya_headers(ctx), &laya_body(text, &qs), ctx.settings.timeout_ms) {
                Ok(resp) => {
                    let mut ranked: Vec<(f64, &String, &String)> = Vec::new();
                    for (i, (id, name)) in asked.iter().enumerate() {
                        if let (_, Some(p), _) = laya_answer(&resp, &format!("tag_{}", i)) {
                            if p >= 0.5 {
                                ranked.push((p, id, name));
                            }
                        }
                    }
                    ranked.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
                    for (p, id, name) in ranked.into_iter().take(MAX_TAGS_PER_MOD) {
                        out.push(Suggestion { field: "tags".into(), value: json!(id), source: "laya".into(), origin: "laya (local)".into(), confidence: p as f32, applicable: true, note: name.clone() });
                    }
                    if let (Some(code), _, c) = laya_answer(&resp, "language") {
                        if LANGS.iter().any(|(k, _)| *k == code) {
                            out.push(Suggestion { field: "language".into(), value: json!(code), source: "laya".into(), origin: "laya (local)".into(), confidence: c.unwrap_or(0.6) as f32, applicable: false, note: String::new() });
                        }
                    }
                    if let (_, Some(p), _) = laya_answer(&resp, "nsfw") {
                        out.push(Suggestion { field: "nsfw".into(), value: json!(p >= 0.5), source: "laya".into(), origin: "laya (local)".into(), confidence: p.max(1.0 - p) as f32, applicable: false, note: format!("{:.2}", p) });
                    }
                }
                Err(e) => notes.push(format!("laya:{}", short_reason(&e))),
            }
        }
        Provider::BetterCommunity => {
            let names: Vec<String> = asked.iter().map(|(_, n)| n.clone()).collect();
            if !names.is_empty() {
                match bc_suggest(ctx, "tags", text, &names) {
                    Ok(r) => {
                        let mut ranked: Vec<(f64, String)> = r
                            .get("probs")
                            .and_then(|p| p.as_object())
                            .map(|m| m.iter().filter_map(|(k, v)| v.as_f64().map(|p| (p, k.clone()))).collect())
                            .unwrap_or_default();
                        if ranked.is_empty() {
                            if let Some(c) = r.get("choice").and_then(|c| c.as_str()) {
                                ranked.push((r.get("p").and_then(|p| p.as_f64()).unwrap_or(0.6), c.to_string()));
                            }
                        }
                        ranked.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
                        for (p, name) in ranked.into_iter().filter(|(p, _)| *p >= 0.3).take(MAX_TAGS_PER_MOD) {
                            if let Some((id, _)) = asked.iter().find(|(_, n)| *n == name) {
                                out.push(Suggestion { field: "tags".into(), value: json!(id), source: "bettercommunity".into(), origin: "BetterCommunity (Laya)".into(), confidence: p as f32, applicable: true, note: name });
                            }
                        }
                    }
                    Err(e) => notes.push(format!("bettercommunity:{}", short_reason(&e))),
                }
            }
            let codes: Vec<String> = LANGS.iter().map(|(c, _)| c.to_string()).collect();
            match bc_suggest(ctx, "language", text, &codes) {
                Ok(r) => {
                    if let Some(c) = r.get("choice").and_then(|c| c.as_str()).filter(|c| codes.iter().any(|k| k == c)) {
                        out.push(Suggestion { field: "language".into(), value: json!(c), source: "bettercommunity".into(), origin: "BetterCommunity (Laya)".into(), confidence: r.get("p").and_then(|p| p.as_f64()).unwrap_or(0.6) as f32, applicable: false, note: String::new() });
                    }
                }
                Err(e) => notes.push(format!("bettercommunity:{}", short_reason(&e))),
            }
            match bc_suggest(ctx, "nsfw", text, &[]) {
                Ok(r) => {
                    if let Some(p) = r.get("p").and_then(|p| p.as_f64()) {
                        out.push(Suggestion { field: "nsfw".into(), value: json!(p >= 0.5), source: "bettercommunity".into(), origin: "BetterCommunity (Laya)".into(), confidence: p.max(1.0 - p) as f32, applicable: false, note: format!("{:.2}", p) });
                    }
                }
                Err(e) => notes.push(format!("bettercommunity:{}", short_reason(&e))),
            }
        }
        Provider::External => {}
    }
    notes.dedup();
    (out, notes)
}

fn external_url(ctx: &Ctx, path: &str) -> Result<String, String> {
    let u = validate_url(&ctx.settings.external_url, EndpointKind::External, false)?;
    let base = u.url.trim_end_matches("/chat/completions").trim_end_matches('/').to_string();
    Ok(format!("{}{}", base, path))
}

fn external_headers(ctx: &Ctx) -> Vec<(String, String)> {
    ctx.external_key.as_ref().filter(|k| !k.is_empty()).map(|k| vec![("Authorization".to_string(), format!("Bearer {}", k))]).unwrap_or_default()
}

/// A description DRAFT from the user's external OpenAI-compatible API. `Ok(None)` when the
/// model said the facts were not enough.
pub fn draft_description(ctx: &Ctx, text: &str) -> Result<Option<Suggestion>, String> {
    gate(ctx.settings, Feature::DescriptionDraft, ctx.killed).map_err(|w| format!("generative:{}", w))?;
    if ctx.settings.external_model.trim().is_empty() {
        return Err("generative:no_model".into());
    }
    let url = external_url(ctx, "/chat/completions")?;
    let body = json!({
        "model": ctx.settings.external_model,
        "temperature": 0.3,
        "max_tokens": 350,
        "messages": [
            { "role": "system", "content": "You write short, factual descriptions of game mods for a mod manager. Use only the facts given. Two to four sentences, no marketing, no invented features, in the same language as the facts. If the facts are not enough, answer exactly: INSUFFICIENT" },
            { "role": "user", "content": text }
        ]
    });
    let v = ctx.transport.post_json(&url, &external_headers(ctx), &body, ctx.settings.timeout_ms).map_err(|e| format!("api:{}", short_reason(&e)))?;
    let content = v
        .pointer("/choices/0/message/content")
        .and_then(|c| c.as_str())
        .map(str::trim)
        .unwrap_or("")
        .to_string();
    if content.is_empty() || content.contains("INSUFFICIENT") {
        return Ok(None);
    }
    Ok(Some(Suggestion {
        field: "description".into(),
        value: json!(content.chars().take(2000).collect::<String>()),
        source: "api".into(),
        origin: ctx.settings.external_model.clone(),
        confidence: 0.5,
        applicable: true,
        note: "draft".into(),
    }))
}

/// Report categories and severities the triage picks from.
pub const REPORT_CATEGORIES: &[&str] = &["crash", "bug", "performance", "install", "mod_conflict", "ui", "other"];
pub const REPORT_SEVERITIES: &[&str] = &["low", "medium", "high", "critical"];

#[derive(Debug, Clone, Serialize, Default)]
pub struct Triage {
    pub category: Option<String>,
    pub category_p: Option<f64>,
    pub severity: Option<String>,
    pub severity_p: Option<f64>,
    /// The known report this one most likely duplicates (index into `known`), with P.
    pub duplicate_of: Option<usize>,
    pub duplicate_p: Option<f64>,
    pub provider: String,
}

/// A HINT for a report the user is about to send: category, severity, likely duplicate among
/// their recent reports. The user still decides what is sent; this never changes the report.
pub fn triage_report(ctx: &Ctx, text: &str, known: &[String]) -> Result<Triage, String> {
    let provider = gate(ctx.settings, Feature::ReportTriage, ctx.killed).map_err(|w| format!("classifier:{}", w))?;
    let known: Vec<&String> = known.iter().take(8).collect();
    let mut t = Triage::default();
    match provider {
        Provider::Local => {
            t.provider = "laya".into();
            let url = laya_url(ctx)?;
            let mut qs: Vec<(String, &str, String, Vec<(String, String)>)> = vec![
                ("category".into(), "choice", "What kind of problem does this report describe?".into(), REPORT_CATEGORIES.iter().map(|c| (c.to_string(), c.replace('_', " "))).collect()),
                ("severity".into(), "choice", "How severe is the problem for the user?".into(), REPORT_SEVERITIES.iter().map(|c| (c.to_string(), c.to_string())).collect()),
            ];
            if !known.is_empty() {
                let mut crit: Vec<(String, String)> = known.iter().enumerate().map(|(i, k)| (format!("r{}", i), k.chars().take(200).collect())).collect();
                crit.push(("none".into(), "None of these: a new problem".into()));
                qs.push(("duplicate".into(), "choice", "Which earlier report describes the same problem?".into(), crit));
            }
            let resp = ctx.transport.post_json(&url, &laya_headers(ctx), &laya_body(text, &qs), ctx.settings.timeout_ms).map_err(|e| format!("laya:{}", short_reason(&e)))?;
            if let (Some(c), _, p) = laya_answer(&resp, "category") {
                if REPORT_CATEGORIES.contains(&c.as_str()) {
                    t.category = Some(c);
                    t.category_p = p;
                }
            }
            if let (Some(c), _, p) = laya_answer(&resp, "severity") {
                if REPORT_SEVERITIES.contains(&c.as_str()) {
                    t.severity = Some(c);
                    t.severity_p = p;
                }
            }
            if let (Some(c), _, p) = laya_answer(&resp, "duplicate") {
                if let Some(i) = c.strip_prefix('r').and_then(|n| n.parse::<usize>().ok()).filter(|i| *i < known.len()) {
                    t.duplicate_of = Some(i);
                    t.duplicate_p = p;
                }
            }
        }
        Provider::BetterCommunity => {
            t.provider = "bettercommunity".into();
            let opts: Vec<String> = REPORT_CATEGORIES.iter().map(|c| c.to_string()).collect();
            let r = bc_suggest(ctx, "crash_triage", text, &opts).map_err(|e| format!("bettercommunity:{}", short_reason(&e)))?;
            if let Some(c) = r.get("choice").and_then(|c| c.as_str()).filter(|c| REPORT_CATEGORIES.contains(c)) {
                t.category = Some(c.to_string());
                t.category_p = r.get("p").and_then(|p| p.as_f64()).or_else(|| r.get("probs").and_then(|m| m.get(c)).and_then(|p| p.as_f64()));
            }
        }
        Provider::External => {}
    }
    Ok(t)
}

/// "Test connection" from Settings. Still behind the master switch: with AI off, not even a
/// test leaves the machine.
pub fn test_connection(ctx: &Ctx, target: &str) -> Result<Value, String> {
    gate(ctx.settings, Feature::TestConnection, ctx.killed).or_else(|w| if w == "no_provider" || w == "no_consent" { Ok(Provider::Local) } else { Err(w) }).map_err(|w| w.to_string())?;
    let started = std::time::Instant::now();
    match target {
        "local" => {
            let url = laya_url(ctx)?;
            let body = laya_body("BetterModsManager connection test.", &[("ping".into(), "noul", "Is this text a test?".into(), Vec::new())]);
            let resp = ctx.transport.post_json(&url, &laya_headers(ctx), &body, ctx.settings.timeout_ms)?;
            if resp.get("answers").is_none() {
                return Err("bad_response".into());
            }
        }
        "bettercommunity" => {
            if !ctx.settings.bc_consent {
                return Err("no_consent".into());
            }
            bc_suggest(ctx, "language", "BetterModsManager connection test.", &["en".into(), "fr".into()])?;
        }
        "external" => {
            let url = external_url(ctx, "/models")?;
            ctx.transport.get_json(&url, &external_headers(ctx), ctx.settings.timeout_ms)?;
        }
        _ => return Err("unknown_target".into()),
    }
    Ok(json!({ "ok": true, "target": target, "latencyMs": started.elapsed().as_millis() as u64 }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Applying — explicit fields only
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, PartialEq)]
pub struct LinkIn {
    pub url: String,
    pub label: String,
    pub link_type: String,
}

/// What the user ticked. `None` = leave that field alone.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Patch {
    pub name: Option<String>,
    pub version: Option<String>,
    pub author: Option<String>,
    pub description: Option<String>,
    pub add_tags: Vec<String>,
    pub add_links: Vec<LinkIn>,
}

/// Validate the `fields` object of an apply call against the same limits as the mod editor
/// (name 100, version 30, author 50, description 2000; tags must be existing tag ids; links
/// http(s) only, at most 5). Unknown keys are refused rather than ignored — a caller that
/// thinks it is setting `language` must learn it is not.
pub fn build_patch(fields: &Value, known_tag_ids: &[String]) -> Result<Patch, String> {
    let obj = fields.as_object().ok_or("fields must be an object")?;
    if obj.is_empty() {
        return Err("fields is empty: nothing to apply".into());
    }
    let mut p = Patch::default();
    for (k, v) in obj {
        let text = |max: usize, min: usize| -> Result<String, String> {
            let s = v.as_str().ok_or_else(|| format!("{} must be a string", k))?.trim().to_string();
            if s.chars().count() < min {
                return Err(format!("{} is empty", k));
            }
            if s.chars().any(|c| c.is_control() && c != '\n' && c != '\t' && c != '\r') {
                return Err(format!("{} contains control characters", k));
            }
            Ok(s.chars().take(max).collect())
        };
        match k.as_str() {
            "name" => p.name = Some(text(100, 1)?),
            "version" => p.version = Some(text(30, 1)?),
            "author" => p.author = Some(text(50, 1)?),
            "description" => p.description = Some(text(2000, 1)?),
            "tags" => {
                let arr = v.as_array().ok_or("tags must be an array of tag ids")?;
                for t in arr {
                    let id = t.as_str().ok_or("tags must be an array of tag ids")?;
                    if !known_tag_ids.iter().any(|k| k == id) {
                        return Err(format!("unknown tag id: {}", id));
                    }
                    if !p.add_tags.iter().any(|x| x == id) {
                        p.add_tags.push(id.to_string());
                    }
                }
            }
            "links" => {
                let arr = v.as_array().ok_or("links must be an array of { url, label? }")?;
                if arr.len() > 5 {
                    return Err("at most 5 links at once".into());
                }
                for l in arr {
                    let url = l.get("url").and_then(|u| u.as_str()).or_else(|| l.as_str()).ok_or("each link needs a url")?.trim().to_string();
                    let parsed = reqwest::Url::parse(&url).map_err(|_| format!("not a URL: {}", url))?;
                    if !matches!(parsed.scheme(), "http" | "https") || url.len() > 500 {
                        return Err(format!("only http(s) links: {}", url));
                    }
                    let label: String = l.get("label").and_then(|x| x.as_str()).unwrap_or("").trim().chars().take(40).collect();
                    let lt = l.get("link_type").and_then(|x| x.as_str()).unwrap_or(link_type(&url));
                    let lt = if matches!(lt, "github" | "direct" | "other") { lt } else { "other" };
                    p.add_links.push(LinkIn { url, label, link_type: lt.to_string() });
                }
            }
            other => return Err(format!("{} cannot be applied (applicable: name, version, author, description, tags, links)", other)),
        }
    }
    Ok(p)
}

/// Tags after adding, within the per-mod limit. Returns (new list, ids that did not fit).
pub fn merge_tags(existing: &[String], add: &[String]) -> (Vec<String>, Vec<String>) {
    let mut out = existing.to_vec();
    let mut skipped = Vec::new();
    for id in add {
        if out.contains(id) {
            continue;
        }
        if out.len() >= MAX_TAGS_PER_MOD {
            skipped.push(id.clone());
        } else {
            out.push(id.clone());
        }
    }
    (out, skipped)
}

/// A status snapshot (Settings, `bmm_ai_status`, `bmm ai-status`). Never contains a key.
pub fn status(dir: &Path) -> Value {
    let s = load_settings(dir);
    let killed = kill_switch();
    let can = |f| gate(&s, f, killed).map(|p| format!("{:?}", p).to_lowercase()).unwrap_or_else(|w| format!("blocked:{}", w));
    json!({
        "enabled": s.enabled && !killed,
        "masterSwitch": s.enabled,
        "killSwitch": killed,
        "classifier": s.classifier,
        "generative": s.generative,
        "features": { "modSuggest": s.mod_suggest, "reportTriage": s.report_triage, "descriptionDrafts": s.description_drafts },
        "localUrl": s.local_url,
        "localAllowRemote": s.local_allow_remote,
        "externalUrl": s.external_url,
        "externalModel": s.external_model,
        "bcConsent": s.bc_consent,
        "installerChoice": s.installer_choice,
        "keys": { "local": secret_storage(dir, "local_key"), "external": secret_storage(dir, "external_key") },
        "network": { "modSuggest": can(Feature::ModSuggest), "reportTriage": can(Feature::ReportTriage), "descriptionDrafts": can(Feature::DescriptionDraft) },
        "bundledModel": false,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    /// Counts every request and answers with a canned body.
    struct Counting {
        calls: Cell<usize>,
        answer: Value,
        last_url: std::cell::RefCell<String>,
        last_body: std::cell::RefCell<Value>,
    }
    impl Counting {
        fn new(answer: Value) -> Self {
            Counting { calls: Cell::new(0), answer, last_url: Default::default(), last_body: Default::default() }
        }
    }
    impl Transport for Counting {
        fn post_json(&self, url: &str, _h: &[(String, String)], body: &Value, _t: u64) -> Result<Value, String> {
            self.calls.set(self.calls.get() + 1);
            *self.last_url.borrow_mut() = url.to_string();
            *self.last_body.borrow_mut() = body.clone();
            Ok(self.answer.clone())
        }
        fn get_json(&self, url: &str, _h: &[(String, String)], _t: u64) -> Result<Value, String> {
            self.calls.set(self.calls.get() + 1);
            *self.last_url.borrow_mut() = url.to_string();
            Ok(self.answer.clone())
        }
    }
    struct Failing(&'static str);
    impl Transport for Failing {
        fn post_json(&self, _: &str, _: &[(String, String)], _: &Value, _: u64) -> Result<Value, String> { Err(self.0.to_string()) }
        fn get_json(&self, _: &str, _: &[(String, String)], _: u64) -> Result<Value, String> { Err(self.0.to_string()) }
    }

    fn vocab() -> Vocab {
        vec![("t-weap".into(), "Weapons".into()), ("t-map".into(), "Maps".into()), ("t-snd".into(), "Sound".into())]
    }

    fn all_on() -> AiSettings {
        AiSettings { enabled: true, classifier: "local".into(), generative: "external".into(), external_url: "https://api.example.com/v1".into(), external_model: "m".into(), bc_consent: true, ..Default::default() }
    }

    fn ctx<'a>(s: &'a AiSettings, t: &'a dyn Transport) -> Ctx<'a> {
        Ctx { settings: s, transport: t, killed: false, local_key: None, external_key: Some("k".into()), bc: Some(BcAuth { base: "https://bettercommunity.ch".into(), headers: vec![] }) }
    }

    #[test]
    fn defaults_are_off() {
        let s = AiSettings::default();
        assert!(!s.enabled);
        assert_eq!(s.classifier, "off");
        assert_eq!(s.generative, "off");
        assert!(!s.bc_consent);
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load_settings(dir.path()), AiSettings::default().normalized());
        std::fs::write(dir.path().join(SETTINGS_FILE), "{ not json").unwrap();
        assert!(!load_settings(dir.path()).enabled, "a broken file cannot turn anything on");
    }

    /// THE test: master switch off → not one request, from any feature.
    #[test]
    fn master_switch_off_means_no_network_anywhere() {
        let mut s = all_on();
        s.enabled = false;
        let t = Counting::new(json!({ "answers": {}, "ok": true, "result": {} }));
        let c = ctx(&s, &t);
        let (sugg, notes) = classify_mod(&c, "a mod about weapons", &vocab());
        assert!(sugg.is_empty());
        assert_eq!(notes, vec!["classifier:ai_off".to_string()]);
        assert!(draft_description(&c, "facts").is_err());
        assert!(triage_report(&c, "it crashed", &["old".into()]).is_err());
        for target in ["local", "bettercommunity", "external"] {
            assert!(test_connection(&c, target).is_err(), "{target}");
        }
        for p in ["local", "bettercommunity"] {
            let mut s2 = s.clone();
            s2.classifier = p.into();
            let c2 = ctx(&s2, &t);
            let _ = classify_mod(&c2, "x", &vocab());
            let _ = triage_report(&c2, "x", &[]);
        }
        assert_eq!(t.calls.get(), 0, "the master switch let a request through");
    }

    #[test]
    fn kill_switch_beats_the_file() {
        let s = all_on();
        let t = Counting::new(json!({ "answers": {} }));
        let mut c = ctx(&s, &t);
        c.killed = true;
        let _ = classify_mod(&c, "x", &vocab());
        let _ = draft_description(&c, "x");
        let _ = triage_report(&c, "x", &[]);
        let _ = test_connection(&c, "local");
        assert_eq!(t.calls.get(), 0);
    }

    #[test]
    fn per_feature_toggles_and_consent() {
        let mut s = all_on();
        s.mod_suggest = false;
        assert_eq!(gate(&s, Feature::ModSuggest, false), Err("feature_off"));
        s.mod_suggest = true;
        s.classifier = "bettercommunity".into();
        s.bc_consent = false;
        assert_eq!(gate(&s, Feature::ModSuggest, false), Err("no_consent"));
        s.classifier = "off".into();
        assert_eq!(gate(&s, Feature::ReportTriage, false), Err("no_provider"));
        s.generative = "off".into();
        assert_eq!(gate(&s, Feature::DescriptionDraft, false), Err("no_provider"));
        let t = Counting::new(json!({}));
        let (_, notes) = classify_mod(&ctx(&s, &t), "x", &vocab());
        assert_eq!(notes, vec!["classifier:no_provider".to_string()]);
        assert_eq!(t.calls.get(), 0);
    }

    #[test]
    fn url_rules() {
        use EndpointKind::*;
        assert!(validate_url("http://127.0.0.1:8000", LocalLaya, false).is_ok());
        assert!(validate_url("http://localhost:8000/", LocalLaya, false).is_ok());
        assert!(validate_url("http://[::1]:8000", LocalLaya, false).is_ok());
        assert_eq!(validate_url("http://192.168.1.4:8000", LocalLaya, false).unwrap_err(), "ai.url.notLoopback");
        assert_eq!(validate_url("http://192.168.1.4:8000", LocalLaya, true).unwrap().warning, Some("remote"));
        assert_eq!(validate_url("file:///etc/passwd", LocalLaya, true).unwrap_err(), "ai.url.scheme");
        assert_eq!(validate_url("ftp://127.0.0.1", External, false).unwrap_err(), "ai.url.scheme");
        assert_eq!(validate_url("http://user:pw@127.0.0.1:8000", LocalLaya, false).unwrap_err(), "ai.url.userinfo");
        assert_eq!(validate_url("http://api.example.com/v1", External, false).unwrap_err(), "ai.url.httpsRequired");
        assert!(validate_url("https://api.example.com/v1", External, false).is_ok());
        assert!(validate_url("http://127.0.0.1:11434/v1", External, false).is_ok());
        for bad in ["https://10.0.0.5/v1", "https://169.254.169.254/latest", "https://[fd00::1]/v1", "https://0.0.0.0/v1", "https://100.64.0.1/"] {
            assert_eq!(validate_url(bad, External, false).unwrap_err(), "ai.url.privateHost", "{bad}");
        }
        assert!(validate_url("https://bettercommunity.ch", BetterCommunity, false).is_ok());
        assert!(validate_url("https://api.bettercommunity.ch", BetterCommunity, false).is_ok());
        assert!(validate_url("http://localhost:3000", BetterCommunity, false).is_ok());
        for bad in ["http://bettercommunity.ch", "https://bettercommunity.ch.evil.com", "https://evilbettercommunity.ch", "https://example.com"] {
            assert_eq!(validate_url(bad, BetterCommunity, false).unwrap_err(), "ai.url.notBetterCommunity", "{bad}");
        }
        assert_eq!(validate_url("not a url", External, false).unwrap_err(), "ai.url.invalid");
    }

    #[test]
    fn remote_laya_is_refused_without_the_opt_in() {
        let mut s = all_on();
        s.local_url = "http://192.168.1.10:8000".into();
        let t = Counting::new(json!({ "answers": {} }));
        let (_, notes) = classify_mod(&ctx(&s, &t), "x", &vocab());
        assert_eq!(t.calls.get(), 0);
        assert!(notes[0].contains("ai.url.notLoopback"), "{notes:?}");
    }

    fn write(dir: &Path, rel: &str, body: &str) {
        let p = dir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }

    fn field<'a>(v: &'a [Suggestion], f: &str) -> Vec<&'a Suggestion> {
        v.iter().filter(|s| s.field == f).collect()
    }

    #[test]
    fn extracts_a_json_manifest_and_readme() {
        let root = tempfile::tempdir().unwrap();
        let m = root.path().join("Cool_Mod_v1.2");
        write(&m, "mod.json", r#"{"name":"Cool Mod","version":"1.2.0","authors":["Alice","Bob"],"description":"Adds **new** weapons to the game.","tags":["Weapons"],"homepage":"https://github.com/alice/coolmod"}"#);
        write(&m, "README.md", "# Cool Mod\n\n[![badge](https://img.shields.io/x.svg)](https://x)\n\nThis mod adds twelve new weapons and rebalances the sound of every rifle in the game.\n\nAuthor: Alice\n\nSee https://www.nexusmods.com/game/mods/1 for more.\n");
        let facts = ModFacts { name: "Cool_Mod_v1.2".into(), version: "1.0".into(), path: m.clone(), ..Default::default() };
        let ex = extract(&facts, &vocab(), &[]);
        let s = &ex.suggestions;
        assert_eq!(field(s, "name")[0].value, json!("Cool Mod"));
        assert_eq!(field(s, "name")[0].source, "file");
        assert_eq!(field(s, "version")[0].value, json!("1.2.0"));
        assert_eq!(field(s, "author")[0].value, json!("Alice, Bob"));
        assert!(field(s, "description").iter().any(|d| d.value == json!("Adds new weapons to the game.")));
        assert!(field(s, "description").iter().any(|d| d.value.as_str().unwrap().starts_with("This mod adds twelve")));
        let tags: Vec<&Value> = field(s, "tags").iter().map(|t| &t.value).collect();
        assert!(tags.contains(&&json!("t-weap")), "manifest tag matched to the vocabulary");
        assert!(tags.contains(&&json!("t-snd")), "text match on 'sound'");
        assert!(!tags.contains(&&json!("t-map")));
        let links: Vec<&str> = field(s, "links").iter().map(|l| l.value["url"].as_str().unwrap()).collect();
        assert!(links.contains(&"https://github.com/alice/coolmod"));
        assert!(links.contains(&"https://www.nexusmods.com/game/mods/1"));
        assert!(!links.iter().any(|l| l.contains("shields.io")), "badges are not links");
        assert!(field(s, "language").iter().all(|l| !l.applicable));
        assert!(ex.sources_read.iter().any(|r| r == "mod.json"));
    }

    #[test]
    fn extracts_dcs_entry_lua_descriptor_xml_and_version_txt() {
        let root = tempfile::tempdir().unwrap();
        let a = root.path().join("A");
        write(&a, "entry.lua", "declare_plugin(\"A-4E\", {\n displayName = _(\"A-4E Skyhawk\"),\n developerName = _(\"Community A-4E\"),\n version = \"2.2.0\",\n info = _(\"The A-4E Skyhawk community module for DCS World.\"),\n})");
        let ex = extract(&ModFacts { path: a, ..Default::default() }, &vec![], &[]);
        assert_eq!(field(&ex.suggestions, "name")[0].value, json!("A-4E Skyhawk"));
        assert_eq!(field(&ex.suggestions, "author")[0].value, json!("Community A-4E"));
        assert_eq!(field(&ex.suggestions, "version")[0].value, json!("2.2.0"));

        let b = root.path().join("B");
        write(&b, "descriptor.mod", "name=\"Better Maps\"\nversion=\"3.1\"\ntags={\n\t\"Maps\"\n\t\"Gameplay\"\n}\nremote_file_id=\"123456\"\n");
        let ex = extract(&ModFacts { path: b, ..Default::default() }, &vocab(), &[]);
        assert_eq!(field(&ex.suggestions, "name")[0].value, json!("Better Maps"));
        assert!(field(&ex.suggestions, "tags").iter().any(|t| t.value == json!("t-map")));
        assert!(field(&ex.suggestions, "links")[0].value["url"].as_str().unwrap().contains("id=123456"));

        let c = root.path().join("C");
        write(&c, "About/About.xml", "<ModMetaData><name>Rim Tweaks</name><author>Zed</author><description>Small quality of life tweaks for colonists.</description><url>https://example.org/rim</url></ModMetaData>");
        write(&c, "VERSION.txt", "v0.9.1\n");
        let ex = extract(&ModFacts { path: c, ..Default::default() }, &vec![], &[]);
        assert_eq!(field(&ex.suggestions, "name")[0].value, json!("Rim Tweaks"));
        assert_eq!(field(&ex.suggestions, "author")[0].value, json!("Zed"));
        assert!(field(&ex.suggestions, "version").iter().any(|v| v.value == json!("0.9.1")));

        let d = root.path().join("D");
        write(&d, "ModInfo.xml", "<xml><ModInfo><Name value=\"Zombie Pack\"/><Author value=\"Kay\"/><Version value=\"1.4\"/></ModInfo></xml>");
        let ex = extract(&ModFacts { path: d, ..Default::default() }, &vec![], &[]);
        assert_eq!(field(&ex.suggestions, "author")[0].value, json!("Kay"));
    }

    #[test]
    fn folder_name_is_the_weakest_source_and_nothing_unchanged_is_suggested() {
        let root = tempfile::tempdir().unwrap();
        let m = root.path().join("[Bob] Night_Sky_Textures_v2.1");
        std::fs::create_dir_all(&m).unwrap();
        let ex = extract(&ModFacts { path: m.clone(), ..Default::default() }, &vec![], &[]);
        let a = field(&ex.suggestions, "author");
        assert_eq!(a[0].value, json!("Bob"));
        assert!(a[0].confidence < 0.5);
        assert_eq!(field(&ex.suggestions, "version")[0].value, json!("2.1"));
        assert_eq!(field(&ex.suggestions, "name")[0].value, json!("Night Sky Textures"));
        // Same values already on the mod → nothing to suggest.
        let facts = ModFacts { path: m, author: "bob".into(), version: "v2.1".into(), name: "Night Sky Textures".into(), ..Default::default() };
        let ex = extract(&facts, &vec![], &[]);
        assert!(field(&ex.suggestions, "author").is_empty());
        assert!(field(&ex.suggestions, "version").is_empty());
        assert!(field(&ex.suggestions, "name").is_empty());
    }

    #[test]
    fn reads_a_zip_mod() {
        let root = tempfile::tempdir().unwrap();
        let zp = root.path().join("ZipMod.zip");
        {
            let f = std::fs::File::create(&zp).unwrap();
            let mut z = zip::ZipWriter::new(f);
            let o = zip::write::FileOptions::default();
            z.start_file("ZipMod/mod.json", o).unwrap();
            std::io::Write::write_all(&mut z, br#"{"name":"Zipped","version":"0.3"}"#).unwrap();
            z.finish().unwrap();
        }
        let ex = extract(&ModFacts { path: zp, ..Default::default() }, &vec![], &[]);
        assert_eq!(field(&ex.suggestions, "name")[0].value, json!("Zipped"));
        assert!(ex.files.iter().any(|f| f == "ZipMod/mod.json"));
    }

    #[test]
    fn laya_classifier_ranks_existing_tags_only() {
        let s = all_on();
        let t = Counting::new(json!({
            "answers": { "tag_0": 0.91, "tag_1": 0.2, "tag_2": { "p": 0.66 }, "language": "fr", "nsfw": 0.05 },
            "answer_confidence": { "language": 0.8 }
        }));
        let (sugg, notes) = classify_mod(&ctx(&s, &t), "Ce mod ajoute des armes", &vocab());
        assert!(notes.is_empty(), "{notes:?}");
        assert_eq!(t.calls.get(), 1, "one request for the whole pass");
        assert!(t.last_url.borrow().ends_with("/v1/systemone"));
        let body = t.last_body.borrow();
        assert_eq!(body["questions"]["tag_0"]["type"], "noul");
        assert_eq!(body["questions"]["language"]["type"], "choice");
        let tags: Vec<&Value> = sugg.iter().filter(|s| s.field == "tags").map(|s| &s.value).collect();
        assert_eq!(tags, vec![&json!("t-weap"), &json!("t-snd")]);
        assert!(sugg.iter().any(|s| s.field == "language" && s.value == json!("fr") && !s.applicable));
        assert!(sugg.iter().any(|s| s.field == "nsfw" && s.value == json!(false)));
    }

    #[test]
    fn bettercommunity_errors_are_notes_not_failures() {
        let mut s = all_on();
        s.classifier = "bettercommunity".into();
        let t = Counting::new(json!({ "ok": false, "reason": "rate_limited" }));
        let (sugg, notes) = classify_mod(&ctx(&s, &t), "x", &vocab());
        assert!(sugg.is_empty());
        assert!(notes.iter().all(|n| n == "bettercommunity:rate_limited"), "{notes:?}");
        assert!(t.last_url.borrow().ends_with("/api/ai/bmm/suggest"));
        // A good answer.
        let t = Counting::new(json!({ "ok": true, "provider": "laya", "result": { "choice": "Maps", "probs": { "Maps": 0.7, "Weapons": 0.2 }, "p": 0.7 } }));
        let (sugg, _) = classify_mod(&ctx(&s, &t), "x", &vocab());
        assert!(sugg.iter().any(|s| s.field == "tags" && s.value == json!("t-map") && s.source == "bettercommunity"));
        // Unreachable.
        let f = Failing("unreachable");
        let (sugg, notes) = classify_mod(&ctx(&s, &f), "x", &vocab());
        assert!(sugg.is_empty());
        assert!(notes.contains(&"bettercommunity:unreachable".to_string()));
        // Not signed in: nothing sent.
        let t = Counting::new(json!({}));
        let mut c = ctx(&s, &t);
        c.bc = None;
        let (_, notes) = classify_mod(&c, "x", &vocab());
        assert!(notes.contains(&"bettercommunity:not_signed_in".to_string()));
        assert_eq!(t.calls.get(), 0);
    }

    #[test]
    fn external_draft_and_its_refusals() {
        let s = all_on();
        let t = Counting::new(json!({ "choices": [ { "message": { "content": "  A tidy weapons pack.  " } } ] }));
        let d = draft_description(&ctx(&s, &t), "facts").unwrap().unwrap();
        assert_eq!(d.value, json!("A tidy weapons pack."));
        assert_eq!(d.source, "api");
        assert_eq!(*t.last_url.borrow(), "https://api.example.com/v1/chat/completions");
        let t = Counting::new(json!({ "choices": [ { "message": { "content": "INSUFFICIENT" } } ] }));
        assert!(draft_description(&ctx(&s, &t), "x").unwrap().is_none());
        let mut s2 = s.clone();
        s2.external_url = "http://api.example.com/v1".into();
        let t = Counting::new(json!({}));
        assert!(draft_description(&ctx(&s2, &t), "x").unwrap_err().contains("httpsRequired"));
        assert_eq!(t.calls.get(), 0);
    }

    #[test]
    fn triage_is_a_hint_with_a_duplicate_pick() {
        let s = all_on();
        let t = Counting::new(json!({ "answers": { "category": "crash", "severity": { "choice": "high", "confidence": 0.7 }, "duplicate": "r1" } }));
        let tr = triage_report(&ctx(&s, &t), "BMM crashes on start", &["UI glitch".into(), "Crash at startup".into()]).unwrap();
        assert_eq!(tr.category.as_deref(), Some("crash"));
        assert_eq!(tr.severity.as_deref(), Some("high"));
        assert_eq!(tr.duplicate_of, Some(1));
        // An invented category is ignored.
        let t = Counting::new(json!({ "answers": { "category": "alien", "duplicate": "r9" } }));
        let tr = triage_report(&ctx(&s, &t), "x", &["a".into()]).unwrap();
        assert_eq!(tr.category, None);
        assert_eq!(tr.duplicate_of, None);
    }

    #[test]
    fn pii_scrubbing() {
        let text = "Crash in C:\\Users\\JeanDupont\\AppData\\Roaming\\x and /home/jean/.cache, mail me jean@example.com, \
                    server 82.12.34.56 but version 1.2.3.4.5 stays, Authorization: Bearer abcdefghijklmnop, token=s3cr3tvalue, \
                    ghp_abcdefghijklmnopqrstuvwxyz0123 on PC JEAN-PC by JeanDupont";
        let (s, found) = scrub_pii(text, Some("JeanDupont"), Some("JEAN-PC"), &[]);
        assert!(!s.contains("JeanDupont"), "{s}");
        assert!(!s.contains("/home/jean/"), "{s}");
        assert!(!s.contains("jean@example.com"));
        assert!(!s.contains("82.12.34.56"));
        assert!(s.contains("1.2.3.4.5"), "a version is not an address: {s}");
        assert!(!s.contains("abcdefghijklmnop"));
        assert!(!s.contains("s3cr3tvalue"));
        assert!(!s.contains("ghp_"));
        assert!(!s.contains("JEAN-PC"));
        let kinds: Vec<&str> = found.iter().map(|f| f.kind.as_str()).collect();
        for k in ["user_path", "email", "ip", "token", "machine"] {
            assert!(kinds.contains(&k), "{k} in {kinds:?}");
        }
        let (s, found) = scrub_pii("nothing to see, 127.0.0.1 is fine", None, None, &[]);
        assert_eq!(s, "nothing to see, 127.0.0.1 is fine");
        assert!(found.is_empty());
    }

    #[test]
    fn provider_text_is_scrubbed_and_capped() {
        let facts = ModFacts { name: "X".into(), description: "see C:\\Users\\Alice\\mods ".repeat(400), ..Default::default() };
        let t = provider_text(&facts, &Extracted::default());
        assert!(t.chars().count() <= MAX_PROVIDER_TEXT);
        assert!(!t.contains("Alice"));
    }

    #[test]
    fn apply_is_explicit_and_validated() {
        let ids = vec!["t-weap".to_string(), "t-map".to_string()];
        let p = build_patch(&json!({ "name": " New ", "tags": ["t-map"], "links": [{ "url": "https://x.org/a", "label": "Home" }] }), &ids).unwrap();
        assert_eq!(p.name.as_deref(), Some("New"));
        assert_eq!(p.version, None, "a field not listed is not touched");
        assert_eq!(p.add_tags, vec!["t-map"]);
        assert_eq!(p.add_links[0].url, "https://x.org/a");
        assert!(build_patch(&json!({}), &ids).is_err());
        assert!(build_patch(&json!({ "tags": ["invented"] }), &ids).unwrap_err().contains("unknown tag"));
        assert!(build_patch(&json!({ "links": [{ "url": "javascript:alert(1)" }] }), &ids).is_err());
        assert!(build_patch(&json!({ "links": [{ "url": "file:///C:/x" }] }), &ids).is_err());
        assert!(build_patch(&json!({ "language": "fr" }), &ids).unwrap_err().contains("cannot be applied"));
        assert!(build_patch(&json!({ "name": "" }), &ids).is_err());
        let long = "x".repeat(5000);
        assert_eq!(build_patch(&json!({ "description": long }), &ids).unwrap().description.unwrap().chars().count(), 2000);
        let (tags, skipped) = merge_tags(&["a".into(), "b".into()], &["c".into(), "d".into(), "a".into()]);
        assert_eq!(tags, vec!["a", "b", "c"]);
        assert_eq!(skipped, vec!["d"]);
    }

    #[test]
    fn installer_choice_and_status() {
        let dir = tempfile::tempdir().unwrap();
        let s = apply_installer_choice(dir.path(), true).unwrap();
        assert!(s.enabled);
        assert_eq!(s.classifier, "off", "the installer box never picks a provider");
        let st = status(dir.path());
        assert_eq!(st["masterSwitch"], json!(true));
        assert_eq!(st["network"]["modSuggest"], json!("blocked:no_provider"));
        let s = apply_installer_choice(dir.path(), false).unwrap();
        assert!(!s.enabled);
        assert_eq!(s.installer_choice, Some(false));
        assert!(!status(dir.path()).to_string().contains("secret"));
    }

    #[test]
    fn unknown_provider_words_become_off() {
        let s = AiSettings { classifier: "gpt".into(), generative: "local".into(), timeout_ms: 5, ..Default::default() }.normalized();
        assert_eq!(s.classifier, "off");
        assert_eq!(s.generative, "off");
        assert_eq!(s.timeout_ms, 1000);
    }

    #[test]
    fn language_hint() {
        assert_eq!(detect_language("Ce mod ajoute des armes et des sons pour le jeu avec une carte").map(|x| x.0), Some("fr"));
        assert_eq!(detect_language("This mod adds weapons and sounds to the game with a new map").map(|x| x.0), Some("en"));
        assert_eq!(detect_language("hi"), None);
    }
}
