//! « API Laya locale » — the embedded Laya engine offered to other programs on THIS PC, as a
//! drop-in for `laya-serve` (`POST /v1/systemone`, same request and response shape).
//!
//! Mounted twice, like `ai_core`: by the app (`commands::ai_api_core`, served by `commands::ai_api`)
//! and by the CLI/MCP binary (config and status only). Only external crates and
//! `crate::commands::ai_core` are used here.
//!
//! ## What it exposes, and what it never does
//!
//! Classification and nothing else: a text and some questions in, laya-serve's answers out. It has
//! no route that reads a file, lists a mod or says anything about the library; the engine it calls
//! sees only the text the caller sent. Two BMM additions: `POST /v1/classify` (a text and labels,
//! or a saved « tâche perso », answered with the user's answer settings: threshold, margin,
//! « je ne sais pas ») and `GET|PUT /v1/laya/config` (« Réglages des réponses »: read always,
//! written ONLY when the user ticked « Les programmes peuvent modifier ces réglages » in
//! Settings, and a program can never tick it). Off by default, and a toggle in
//! Settings → AI (or `bmm ai-api start|stop`).
//!
//! ## The defences, in the order a request meets them
//!
//! 1. **Loopback bind only.** The address is 127.0.0.1 (or ::1); anything else in the config is
//!    refused before a socket is opened ([`check_bind`]).
//! 2. **Host check** (DNS rebinding): only `127.0.0.1:<port>`, `localhost:<port>` and
//!    `[::1]:<port>`; anything else, a missing Host included, is 421 before any route runs.
//! 3. **Origin check** (a web page in the user's browser): a request that carries an `Origin` is
//!    refused (403, no CORS header) unless that exact origin is listed. None is by default.
//! 4. **Bearer token**: 256 random bits minted when the API is enabled, shown once, stored only as
//!    a SHA-256 ([`hash_token`]); compared in constant time. Repeated failures lock the client out
//!    for a minute (429).
//! 5. **Rate limit** per client address, **size caps** (body, text, questions, options, lengths),
//!    **reserved model tokens neutralised** in every string ([`neutralize_specials`]).
//! 6. **Guard**: the AI master switch, `--no-ai`, game mode (the app's guard) — refused with 503.
//! 7. **Concurrency** 1 (or 2) with a short queue, a queue wait and a run timeout (503 / 504).
//!
//! Logs carry the method, the path, the status, the time, the number of questions and the LENGTH
//! of the text — never the text, the questions, the answers or the token.

use serde::de::{self, Deserializer, MapAccess, Visitor};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::path::Path;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use warp::http::StatusCode;
use warp::Filter;

use crate::commands::ai_core::LayaQuestion;

/// Beside data.json and ai-settings.json.
pub const CONFIG_FILE: &str = "ai-api.json";
/// Next to BMM's own plugin API (51274). laya-serve's 8000 is left to a real laya-serve.
pub const DEFAULT_PORT: u16 = 51275;
/// The whole request body.
pub const MAX_BODY: u64 = 64 * 1024;
/// The text classified (characters). The engine's own cap is the same; here it is refused, not cut.
pub const MAX_TEXT: usize = 20_000;
/// Questions per request (each is one row through the model: this bounds the work per call).
pub const MAX_API_QUESTIONS: usize = 16;
/// Options per choice / score question (the engine's cap).
pub const MAX_API_OPTIONS: usize = 64;
pub const MAX_INSTRUCTIONS: usize = 2000;
pub const MAX_LABEL: usize = 200;
pub const MAX_DESCRIPTION: usize = 400;
pub const MAX_ORIGINS: usize = 8;
/// Requests per minute and per client address.
pub const RATE_PER_MIN: usize = 60;
/// Failed authentications per minute and per client address before a lockout.
pub const BAD_AUTH_PER_MIN: usize = 10;
/// Requests waiting for the engine beyond the ones running. More → 503 busy.
pub const QUEUE_MAX: usize = 4;
pub const QUEUE_WAIT: Duration = Duration::from_secs(20);
pub const RUN_TIMEOUT: Duration = Duration::from_secs(30);

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct ApiConfig {
    /// The user's toggle. Off by default.
    pub enabled: bool,
    pub port: u16,
    /// Loopback only; anything else is refused at start ([`check_bind`]).
    pub bind: String,
    /// Exact browser origins allowed to call (`http://localhost:3000`). Empty = no web page.
    pub allowed_origins: Vec<String>,
    /// Requests run at once: 1 or 2.
    pub concurrency: u8,
    /// SHA-256 of the bearer token, hex. The token itself is never stored.
    pub token_sha256: String,
}

impl Default for ApiConfig {
    fn default() -> Self {
        ApiConfig { enabled: false, port: DEFAULT_PORT, bind: "127.0.0.1".into(), allowed_origins: Vec::new(), concurrency: 1, token_sha256: String::new() }
    }
}

impl ApiConfig {
    /// Clamp what can be clamped; drop what is not valid. `bind` is kept as written so a bad one
    /// is REFUSED at start rather than quietly replaced.
    pub fn normalized(mut self) -> Self {
        if self.port < 1024 {
            self.port = DEFAULT_PORT;
        }
        self.concurrency = self.concurrency.clamp(1, 2);
        let mut seen: Vec<String> = Vec::new();
        for o in &self.allowed_origins {
            if let Ok(c) = validate_origin(o) {
                if !seen.contains(&c) && seen.len() < MAX_ORIGINS {
                    seen.push(c);
                }
            }
        }
        self.allowed_origins = seen;
        let h = self.token_sha256.trim().to_ascii_lowercase();
        self.token_sha256 = if h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()) { h } else { String::new() };
        self.bind = self.bind.trim().chars().take(64).collect();
        if self.bind.is_empty() {
            self.bind = "127.0.0.1".into();
        }
        self
    }
}

/// Missing or malformed → the defaults (off). A broken file must not be able to turn it on.
pub fn load_config(dir: &Path) -> ApiConfig {
    std::fs::read_to_string(dir.join(CONFIG_FILE))
        .ok()
        .and_then(|t| serde_json::from_str::<ApiConfig>(&t).ok())
        .unwrap_or_default()
        .normalized()
}

pub fn save_config(dir: &Path, c: &ApiConfig) -> Result<ApiConfig, String> {
    let c = c.clone().normalized();
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(&c).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("{}.tmp", CONFIG_FILE));
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(CONFIG_FILE)).map_err(|e| e.to_string())?;
    Ok(c)
}

/// The address to listen on: loopback or nothing.
pub fn check_bind(bind: &str) -> Result<IpAddr, &'static str> {
    let b = bind.trim().trim_start_matches('[').trim_end_matches(']');
    let ip: IpAddr = if b.eq_ignore_ascii_case("localhost") { IpAddr::from([127, 0, 0, 1]) } else { b.parse().map_err(|_| "ai.api.bindInvalid")? };
    if ip.is_loopback() {
        Ok(ip)
    } else {
        Err("ai.api.notLoopback")
    }
}

/// A browser origin exactly as a browser sends it (`scheme://host[:port]`, no path). `null`, `*`
/// and anything with a path, a query or credentials are refused.
pub fn validate_origin(raw: &str) -> Result<String, &'static str> {
    let r = raw.trim();
    if r.is_empty() || r == "*" || r.eq_ignore_ascii_case("null") {
        return Err("ai.api.originInvalid");
    }
    let u = reqwest::Url::parse(r).map_err(|_| "ai.api.originInvalid")?;
    if !matches!(u.scheme(), "http" | "https") || u.host_str().is_none() {
        return Err("ai.api.originInvalid");
    }
    if !u.username().is_empty() || u.password().is_some() || u.query().is_some() || u.fragment().is_some() || (u.path() != "/" && !u.path().is_empty()) {
        return Err("ai.api.originInvalid");
    }
    Ok(u.origin().ascii_serialization())
}

/// Whether the `Host` header names this server (DNS-rebinding defence).
pub fn host_ok(host: Option<&str>, port: u16) -> bool {
    let Some(h) = host.map(|h| h.trim().to_ascii_lowercase()) else { return false };
    h == format!("127.0.0.1:{port}") || h == format!("localhost:{port}") || h == format!("[::1]:{port}")
}

// ─────────────────────────────────────────────────────────────────────────────
// Token
// ─────────────────────────────────────────────────────────────────────────────

/// 256 random bits (two v4 UUIDs = 244 random bits, plus a SHA-256 of both and the clock so the
/// fixed version nibbles do not show), as `laya_` + 64 hex characters.
pub fn new_token() -> String {
    let mut h = Sha256::new();
    h.update(uuid::Uuid::new_v4().as_bytes());
    h.update(uuid::Uuid::new_v4().as_bytes());
    h.update(format!("{:?}", std::time::SystemTime::now()).as_bytes());
    format!("laya_{}", hex_lower(&h.finalize()))
}

pub fn hash_token(token: &str) -> String {
    hex_lower(&Sha256::digest(token.trim().as_bytes()))
}

fn hex_lower(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// `Authorization: Bearer <token>` against the stored hash. No stored hash = nobody gets in.
pub fn token_ok(header: Option<&str>, stored_sha256: &str) -> bool {
    if stored_sha256.len() != 64 {
        return false;
    }
    let Some(h) = header.map(str::trim) else { return false };
    let Some((scheme, tok)) = h.split_once(' ') else { return false };
    if !scheme.eq_ignore_ascii_case("bearer") {
        return false;
    }
    let tok = tok.trim();
    if tok.is_empty() || tok.len() > 256 {
        return false;
    }
    ct_eq(hash_token(tok).as_bytes(), stored_sha256.as_bytes())
}

// ─────────────────────────────────────────────────────────────────────────────
// Input hygiene
// ─────────────────────────────────────────────────────────────────────────────

/// The model's reserved tokens, written as text. The tokenizer turns the literal `<eos>` in a
/// string into the real separator, so a text carrying one could reshape the row the model reads
/// (end the question early, fake an option marker). Each is broken with a space: `< eos>`.
const SPECIALS: &[&str] = &["<bos>", "<eos>", "<pad>", "<mask>", "<unk>", "<cls>", "<sep>", "<s>", "</s>", "<start_of_turn>", "<end_of_turn>"];

/// Neutralise reserved tokens (case-insensitive) in untrusted text. Also used by the scheduler's
/// AI steps (`commands::ai_ops`) on text read from files and variables.
pub fn neutralize_specials(s: &str) -> String {
    if !s.contains('<') {
        return s.to_string();
    }
    let lower = s.to_ascii_lowercase();
    let mut out = String::with_capacity(s.len() + 8);
    let mut i = 0;
    let bytes = s.as_bytes();
    while i < s.len() {
        if bytes[i] == b'<' {
            if let Some(sp) = SPECIALS.iter().find(|sp| lower[i..].starts_with(*sp)) {
                out.push_str("< ");
                out.push_str(&s[i + 1..i + sp.len()]);
                i += sp.len();
                continue;
            }
        }
        let ch = s[i..].chars().next().unwrap_or(' ');
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

// ─────────────────────────────────────────────────────────────────────────────
// Request parsing (laya-serve's shape, order preserved)
// ─────────────────────────────────────────────────────────────────────────────

/// A JSON object read in document order (serde_json's map sorts keys; the order of a score
/// question's levels is its meaning). Duplicate keys are refused.
pub struct Ordered<T>(pub Vec<(String, T)>);

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Ordered<T> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V<T>(std::marker::PhantomData<T>);
        impl<'de, T: Deserialize<'de>> Visitor<'de> for V<T> {
            type Value = Ordered<T>;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("an object")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut m: A) -> Result<Self::Value, A::Error> {
                let mut out: Vec<(String, T)> = Vec::new();
                while let Some((k, v)) = m.next_entry::<String, T>()? {
                    if out.iter().any(|(x, _)| *x == k) {
                        return Err(de::Error::custom("duplicate key"));
                    }
                    if out.len() >= 256 {
                        return Err(de::Error::custom("too many keys"));
                    }
                    out.push((k, v));
                }
                Ok(Ordered(out))
            }
        }
        d.deserialize_map(V(std::marker::PhantomData))
    }
}

#[derive(Deserialize)]
struct ReqIn {
    state: Value,
    questions: Ordered<QIn>,
}

#[derive(Deserialize)]
struct QIn {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    instructions: String,
    #[serde(default)]
    criteria: Option<CritIn>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum CritIn {
    Map(Ordered<String>),
    List(Vec<String>),
}

/// A refusal: the HTTP status and a stable code (the body is `{"detail": code, "error": code}`,
/// FastAPI's `detail` so a laya-serve client reads it).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ApiError(pub StatusCode, pub &'static str);

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
}

/// Parse and bound one `/v1/systemone` body. Returns the text and the questions, every string
/// already neutralised.
pub fn parse_request(body: &[u8]) -> Result<(String, Vec<LayaQuestion<'static>>), ApiError> {
    let req: ReqIn = serde_json::from_slice(body).map_err(|_| ApiError(StatusCode::BAD_REQUEST, "bad_json"))?;
    let text = match &req.state {
        Value::String(s) => s.clone(),
        Value::Object(o) if o.len() == 1 && o.get("body").map(|b| b.is_string()).unwrap_or(false) => o["body"].as_str().unwrap_or("").to_string(),
        _ => return Err(ApiError(StatusCode::UNPROCESSABLE_ENTITY, "unsupported_state")),
    };
    if text.chars().count() > MAX_TEXT {
        return Err(ApiError(StatusCode::PAYLOAD_TOO_LARGE, "text_too_long"));
    }
    let qs = req.questions.0;
    if qs.is_empty() {
        return Err(ApiError(StatusCode::UNPROCESSABLE_ENTITY, "no_questions"));
    }
    if qs.len() > MAX_API_QUESTIONS {
        return Err(ApiError(StatusCode::UNPROCESSABLE_ENTITY, "too_many_questions"));
    }
    let mut out: Vec<LayaQuestion<'static>> = Vec::with_capacity(qs.len());
    for (id, q) in qs {
        if !valid_id(&id) {
            return Err(ApiError(StatusCode::UNPROCESSABLE_ENTITY, "bad_question_id"));
        }
        let kind: &'static str = match q.kind.as_str() {
            "choice" => "choice",
            "noul" => "noul",
            "score" => "score",
            _ => return Err(ApiError(StatusCode::UNPROCESSABLE_ENTITY, "bad_question_type")),
        };
        if q.instructions.chars().count() > MAX_INSTRUCTIONS {
            return Err(ApiError(StatusCode::UNPROCESSABLE_ENTITY, "instructions_too_long"));
        }
        let crit: Vec<(String, String)> = match q.criteria {
            None => Vec::new(),
            Some(CritIn::List(l)) => l.into_iter().map(|k| (k, String::new())).collect(),
            Some(CritIn::Map(m)) => m.0,
        };
        if crit.len() > MAX_API_OPTIONS {
            return Err(ApiError(StatusCode::UNPROCESSABLE_ENTITY, "too_many_options"));
        }
        for (k, v) in &crit {
            if k.trim().is_empty() || k.chars().count() > MAX_LABEL || v.chars().count() > MAX_DESCRIPTION {
                return Err(ApiError(StatusCode::UNPROCESSABLE_ENTITY, "bad_option"));
            }
        }
        match kind {
            "noul" => {
                if crit.iter().any(|(k, _)| !k.eq_ignore_ascii_case("true") && !k.eq_ignore_ascii_case("false")) {
                    return Err(ApiError(StatusCode::UNPROCESSABLE_ENTITY, "bad_option"));
                }
            }
            _ => {
                if crit.len() < 2 {
                    return Err(ApiError(StatusCode::UNPROCESSABLE_ENTITY, "too_few_options"));
                }
                let mut seen: Vec<&str> = Vec::new();
                for (k, _) in &crit {
                    if seen.contains(&k.as_str()) {
                        return Err(ApiError(StatusCode::UNPROCESSABLE_ENTITY, "bad_option"));
                    }
                    seen.push(k);
                }
            }
        }
        let crit = crit.into_iter().map(|(k, v)| (neutralize_specials(&k), neutralize_specials(&v))).collect();
        out.push((id, kind, neutralize_specials(&q.instructions), crit));
    }
    Ok((neutralize_specials(&text), out))
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate windows
// ─────────────────────────────────────────────────────────────────────────────

/// A one-minute sliding window per client address.
#[derive(Default)]
pub struct Window {
    hits: Mutex<HashMap<IpAddr, Vec<Instant>>>,
}

impl Window {
    fn prune(v: &mut Vec<Instant>, now: Instant) {
        v.retain(|t| now.duration_since(*t) < Duration::from_secs(60));
    }
    /// Record one hit; false when the address already had `max` in the last minute.
    pub fn hit(&self, ip: IpAddr, max: usize) -> bool {
        let now = Instant::now();
        let mut m = self.hits.lock().unwrap_or_else(|p| p.into_inner());
        if m.len() > 1024 {
            m.retain(|_, v| {
                Self::prune(v, now);
                !v.is_empty()
            });
        }
        let v = m.entry(ip).or_default();
        Self::prune(v, now);
        if v.len() >= max {
            return false;
        }
        v.push(now);
        true
    }
    pub fn count(&self, ip: IpAddr) -> usize {
        let now = Instant::now();
        let mut m = self.hits.lock().unwrap_or_else(|p| p.into_inner());
        match m.get_mut(&ip) {
            Some(v) => {
                Self::prune(v, now);
                v.len()
            }
            None => 0,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// The server
// ─────────────────────────────────────────────────────────────────────────────

pub type PredictFn = Arc<dyn Fn(&str, &[LayaQuestion]) -> Result<Value, String> + Send + Sync>;
/// `Some(code)`: refuse every classification now (AI off, `--no-ai`, game mode, …).
pub type GuardFn = Arc<dyn Fn() -> Option<&'static str> + Send + Sync>;
pub type LogFn = Arc<dyn Fn(String) + Send + Sync>;

#[derive(Clone)]
pub struct Engine {
    pub predict: PredictFn,
    pub available: Arc<dyn Fn() -> bool + Send + Sync>,
    pub guard: GuardFn,
    pub log: LogFn,
    /// « Réglages des réponses de Laya »: read and write the stored config. `None` → the
    /// `/v1/classify` and `/v1/laya/config` routes answer 404.
    pub laya: Option<LayaHooks>,
}

#[derive(Clone)]
pub struct LayaHooks {
    pub load: Arc<dyn Fn() -> crate::commands::ai_tuning::LayaConfig + Send + Sync>,
    pub save: Arc<dyn Fn(&crate::commands::ai_tuning::LayaConfig) -> Result<(), String> + Send + Sync>,
}

/// `POST /v1/classify`: a text, and a saved task's id or labels (strings, or `{id, description,
/// examples}`), and an optional wording. Unknown fields refused.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ClassifyIn {
    text: String,
    #[serde(default)]
    task: Option<String>,
    #[serde(default)]
    labels: Vec<LabelIn>,
    #[serde(default)]
    template: Option<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum LabelIn {
    Id(String),
    Def(crate::commands::ai_tuning::LabelDef),
}

/// Parse and resolve one `/v1/classify` body against the stored config: the text (neutralised),
/// the labels, the wording and the answer settings (« Programmes », or the task's own).
pub fn parse_classify(body: &[u8], cfg: &crate::commands::ai_tuning::LayaConfig) -> Result<(String, Vec<crate::commands::ai_tuning::LabelDef>, String, crate::commands::ai_tuning::Tuning), ApiError> {
    use crate::commands::ai_tuning as tu;
    let req: ClassifyIn = serde_json::from_slice(body).map_err(|_| ApiError(StatusCode::BAD_REQUEST, "bad_json"))?;
    if req.text.chars().count() > MAX_TEXT {
        return Err(ApiError(StatusCode::PAYLOAD_TOO_LARGE, "text_too_long"));
    }
    if req.labels.len() > tu::MAX_LABELS {
        return Err(ApiError(StatusCode::UNPROCESSABLE_ENTITY, "too_many_options"));
    }
    let given: Vec<tu::LabelDef> = req
        .labels
        .into_iter()
        .map(|l| match l {
            LabelIn::Id(id) => tu::LabelDef { id, ..Default::default() },
            LabelIn::Def(d) => d,
        })
        .collect();
    let (labels, template, tune) = match req.task.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        Some(_) => {
            let (l, t, tune) = tu::task_spec(cfg, req.task.as_deref(), &[], tu::Area::Api).map_err(|e| ApiError(StatusCode::UNPROCESSABLE_ENTITY, if e.ends_with("taskOff") { "task_off" } else { "unknown_task" }))?;
            (l, t, tune)
        }
        None => {
            let labels = tu::clean_labels(&given);
            if labels.len() < 2 {
                return Err(ApiError(StatusCode::UNPROCESSABLE_ENTITY, "too_few_options"));
            }
            (labels, req.template.unwrap_or_default(), cfg.resolve(tu::Area::Api))
        }
    };
    Ok((neutralize_specials(&req.text), labels, template, tune))
}

/// Refusal lines written per minute at most. The log is flushed on every line, and a web page
/// can make the browser POST here in a loop: past this, refusals are only counted, and the
/// count is written once the next minute starts.
pub const LOG_REFUSED_PER_MIN: usize = 5;

#[derive(Default)]
struct LogGate(Mutex<(u64, usize, usize)>);

impl LogGate {
    /// The line to write for this refusal, if any (minute, written, suppressed).
    fn admit(&self, status: u16, code: &str) -> Option<String> {
        let minute = now_ms() / 60_000;
        let mut g = self.0.lock().unwrap_or_else(|p| p.into_inner());
        let mut prefix = String::new();
        if g.0 != minute {
            if g.2 > 0 {
                prefix = format!("[AI-API] {} more refusals not logged; ", g.2);
            }
            *g = (minute, 0, 0);
        }
        if g.1 >= LOG_REFUSED_PER_MIN {
            g.2 += 1;
            return None;
        }
        g.1 += 1;
        Some(format!("{}[AI-API] refused {} {}", prefix, status, code))
    }
}

/// Counters for the status line (no content).
#[derive(Default, Debug)]
pub struct Stats {
    pub served: AtomicU64,
    pub refused: AtomicU64,
    pub last_status: AtomicU64,
    pub last_at_ms: AtomicU64,
}

impl Stats {
    pub fn view(&self) -> Value {
        json!({
            "served": self.served.load(Ordering::Relaxed),
            "refused": self.refused.load(Ordering::Relaxed),
            "lastStatus": self.last_status.load(Ordering::Relaxed),
            "lastAtMs": self.last_at_ms.load(Ordering::Relaxed),
        })
    }
}

struct Shared {
    port: u16,
    origins: Vec<String>,
    token_sha256: String,
    engine: Engine,
    sem: Arc<tokio::sync::Semaphore>,
    waiting: AtomicUsize,
    rate: Window,
    bad: Window,
    stats: Arc<Stats>,
}

#[derive(Debug)]
struct Refused(StatusCode, &'static str);
impl warp::reject::Reject for Refused {}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn err_reply(status: StatusCode, code: &str) -> warp::reply::Response {
    let mut r = warp::reply::with_status(warp::reply::json(&json!({ "detail": code, "error": code })), status).into_response_();
    if status == StatusCode::TOO_MANY_REQUESTS || status == StatusCode::SERVICE_UNAVAILABLE {
        r.headers_mut().insert("retry-after", warp::http::HeaderValue::from_static("30"));
    }
    r
}

/// `warp::Reply::into_response` without importing the trait into every call site.
trait IntoResp {
    fn into_response_(self) -> warp::reply::Response;
}
impl<T: warp::Reply> IntoResp for T {
    fn into_response_(self) -> warp::reply::Response {
        warp::Reply::into_response(self)
    }
}

fn client_ip(addr: Option<SocketAddr>) -> IpAddr {
    addr.map(|a| a.ip()).unwrap_or(IpAddr::from([127, 0, 0, 1]))
}

/// Lockout, token, rate: every route but /health goes through this first.
fn admit(auth: Option<&str>, addr: Option<SocketAddr>, sh: &Shared) -> Result<(), warp::Rejection> {
    let ip = client_ip(addr);
    if sh.bad.count(ip) >= BAD_AUTH_PER_MIN {
        return Err(warp::reject::custom(Refused(StatusCode::TOO_MANY_REQUESTS, "locked_out")));
    }
    if !token_ok(auth, &sh.token_sha256) {
        sh.bad.hit(ip, usize::MAX);
        return Err(warp::reject::custom(Refused(StatusCode::UNAUTHORIZED, "unauthorized")));
    }
    if !sh.rate.hit(ip, RATE_PER_MIN) {
        return Err(warp::reject::custom(Refused(StatusCode::TOO_MANY_REQUESTS, "rate_limited")));
    }
    Ok(())
}

/// The guard (AI off, `--no-ai`, game mode) and the model: before any inference.
fn ready(sh: &Shared) -> Result<(), warp::Rejection> {
    if let Some(why) = (sh.engine.guard)() {
        return Err(warp::reject::custom(Refused(StatusCode::SERVICE_UNAVAILABLE, why)));
    }
    if !(sh.engine.available)() {
        return Err(warp::reject::custom(Refused(StatusCode::SERVICE_UNAVAILABLE, "model_absent")));
    }
    Ok(())
}

fn json_reply(v: &Value) -> warp::reply::Response {
    let mut r = warp::reply::json(v).into_response_();
    r.headers_mut().insert("cache-control", warp::http::HeaderValue::from_static("no-store"));
    r
}

/// `POST /v1/classify` (BMM's own): labels or a saved task, the user's answer settings.
async fn handle_classify(auth: Option<String>, addr: Option<SocketAddr>, body: bytes::Bytes, sh: Arc<Shared>) -> Result<warp::reply::Response, warp::Rejection> {
    admit(auth.as_deref(), addr, &sh)?;
    let hooks = sh.engine.laya.clone().ok_or_else(warp::reject::not_found)?;
    ready(&sh)?;
    let cfg = (hooks.load)();
    let (text, labels, template, tune) = parse_classify(&body, &cfg).map_err(|e| warp::reject::custom(Refused(e.0, e.1)))?;
    let n_chars = text.chars().count();
    let n_l = labels.len();
    let predict = sh.engine.predict.clone();
    let t0 = Instant::now();
    let v = queued(&sh, Box::new(move || {
        use crate::commands::ai_tuning as tu;
        let ask = |qs: &[LayaQuestion]| predict(&text, qs);
        let (probs, d) = tu::classify_labels(&ask, &crate::commands::ai_laya::choice_probs, &labels, &template, &tune)?;
        Ok(tu::decision_json(&probs, &d))
    }))
    .await?;
    sh.stats.served.fetch_add(1, Ordering::Relaxed);
    (sh.engine.log)(format!("[AI-API] POST /v1/classify 200 labels={} chars={} ms={}", n_l, n_chars, t0.elapsed().as_millis()));
    Ok(json_reply(&v))
}

/// `GET /v1/laya/config`: the answer settings as an export (no key, no text of the user's).
async fn handle_config_get(auth: Option<String>, addr: Option<SocketAddr>, sh: Arc<Shared>) -> Result<warp::reply::Response, warp::Rejection> {
    admit(auth.as_deref(), addr, &sh)?;
    let hooks = sh.engine.laya.clone().ok_or_else(warp::reject::not_found)?;
    Ok(json_reply(&(hooks.load)().export()))
}

/// `PUT /v1/laya/config`: only when the user allowed programs to change it in Settings (403
/// `config_locked` otherwise); the same strict checks as an import; never turns that
/// permission on.
async fn handle_config_put(auth: Option<String>, addr: Option<SocketAddr>, body: bytes::Bytes, sh: Arc<Shared>) -> Result<warp::reply::Response, warp::Rejection> {
    admit(auth.as_deref(), addr, &sh)?;
    let hooks = sh.engine.laya.clone().ok_or_else(warp::reject::not_found)?;
    let incoming: Value = serde_json::from_slice(&body).map_err(|_| warp::reject::custom(Refused(StatusCode::BAD_REQUEST, "bad_json")))?;
    let current = (hooks.load)();
    let next = crate::commands::ai_tuning::LayaConfig::program_change(&current, &incoming).map_err(|e| {
        warp::reject::custom(if e == "laya.cfg.locked" { Refused(StatusCode::FORBIDDEN, "config_locked") } else { Refused(StatusCode::UNPROCESSABLE_ENTITY, "bad_config") })
    })?;
    (hooks.save)(&next).map_err(|_| warp::reject::custom(Refused(StatusCode::INTERNAL_SERVER_ERROR, "save_failed")))?;
    (sh.engine.log)("[AI-API] PUT /v1/laya/config 200".to_string());
    Ok(json_reply(&next.export()))
}

type Job = Box<dyn FnOnce() -> Result<Value, String> + Send>;

/// The queue and the engine slot: at most QUEUE_MAX waiting (each for at most QUEUE_WAIT),
/// then one run under RUN_TIMEOUT. Engine messages never go out (they can name a path).
async fn queued(sh: &Shared, job: Job) -> Result<Value, warp::Rejection> {
    if sh.waiting.fetch_add(1, Ordering::SeqCst) >= QUEUE_MAX {
        sh.waiting.fetch_sub(1, Ordering::SeqCst);
        return Err(warp::reject::custom(Refused(StatusCode::SERVICE_UNAVAILABLE, "busy")));
    }
    let permit = tokio::time::timeout(QUEUE_WAIT, sh.sem.clone().acquire_owned()).await;
    sh.waiting.fetch_sub(1, Ordering::SeqCst);
    let permit = match permit {
        Ok(Ok(p)) => p,
        _ => return Err(warp::reject::custom(Refused(StatusCode::SERVICE_UNAVAILABLE, "busy"))),
    };
    // The permit goes INTO the job: a request that times out does not free the engine for the
    // next one while its run is still going.
    let job = tokio::task::spawn_blocking(move || {
        let _p = permit;
        job()
    });
    match tokio::time::timeout(RUN_TIMEOUT, job).await {
        Err(_) => Err(warp::reject::custom(Refused(StatusCode::GATEWAY_TIMEOUT, "timeout"))),
        Ok(Err(_)) => Err(warp::reject::custom(Refused(StatusCode::INTERNAL_SERVER_ERROR, "inference_failed"))),
        Ok(Ok(Ok(v))) => Ok(v),
        Ok(Ok(Err(e))) if e.contains("absent") => Err(warp::reject::custom(Refused(StatusCode::SERVICE_UNAVAILABLE, "model_absent"))),
        Ok(Ok(Err(_))) => Err(warp::reject::custom(Refused(StatusCode::INTERNAL_SERVER_ERROR, "inference_failed"))),
    }
}

async fn handle_predict(auth: Option<String>, addr: Option<SocketAddr>, body: bytes::Bytes, sh: Arc<Shared>) -> Result<warp::reply::Response, warp::Rejection> {
    admit(auth.as_deref(), addr, &sh)?;
    ready(&sh)?;
    let (text, qs) = parse_request(&body).map_err(|e| warp::reject::custom(Refused(e.0, e.1)))?;
    let n_q = qs.len();
    let n_chars = text.chars().count();
    let predict = sh.engine.predict.clone();
    let t0 = Instant::now();
    let v = queued(&sh, Box::new(move || predict(&text, &qs))).await?;
    sh.stats.served.fetch_add(1, Ordering::Relaxed);
    (sh.engine.log)(format!("[AI-API] POST /v1/systemone 200 questions={} chars={} ms={}", n_q, n_chars, t0.elapsed().as_millis()));
    Ok(json_reply(&v))
}

/// Every route, behind the Host and Origin checks, with errors as JSON and CORS stamped only for
/// a listed origin.
fn routes(sh: Arc<Shared>) -> impl Filter<Extract = (warp::reply::Response,), Error = warp::Rejection> + Clone {
    let with = {
        let sh = sh.clone();
        warp::any().map(move || sh.clone())
    };
    let pre = warp::header::optional::<String>("host")
        .and(warp::header::optional::<String>("origin"))
        .and(with.clone())
        .and_then(|host: Option<String>, origin: Option<String>, sh: Arc<Shared>| async move {
            if !host_ok(host.as_deref(), sh.port) {
                return Err(warp::reject::custom(Refused(StatusCode::MISDIRECTED_REQUEST, "misdirected_host")));
            }
            if let Some(o) = origin {
                if !sh.origins.iter().any(|a| *a == o) {
                    return Err(warp::reject::custom(Refused(StatusCode::FORBIDDEN, "origin_not_allowed")));
                }
            }
            Ok(())
        })
        .untuple_one();
    let health = warp::path!("health").and(warp::get()).and(with.clone()).map(|sh: Arc<Shared>| {
        warp::reply::json(&json!({
            "status": "ok",
            "engine": "laya-embedded",
            "ready": (sh.engine.available)() && (sh.engine.guard)().is_none(),
        }))
        .into_response_()
    });
    // Only on the two real paths: an OPTIONS matcher without a path turned every unknown GET
    // into a 405 (the method mismatch outranks the not-found), which names a route that is not there.
    let known = warp::path!("v1" / "systemone").or(warp::path!("health")).unify().or(warp::path!("v1" / "classify")).unify().or(warp::path!("v1" / "laya" / "config")).unify();
    let preflight = known.and(warp::options()).map(|| {
        let mut r = warp::reply::with_status(warp::reply(), StatusCode::NO_CONTENT).into_response_();
        let h = r.headers_mut();
        h.insert("access-control-allow-methods", warp::http::HeaderValue::from_static("POST, GET, PUT, OPTIONS"));
        h.insert("access-control-allow-headers", warp::http::HeaderValue::from_static("authorization, content-type"));
        h.insert("access-control-max-age", warp::http::HeaderValue::from_static("600"));
        r
    });
    let predict = warp::path!("v1" / "systemone")
        .and(warp::post())
        .and(warp::header::optional::<String>("authorization"))
        .and(warp::addr::remote())
        .and(warp::body::content_length_limit(MAX_BODY))
        .and(warp::body::bytes())
        .and(with.clone())
        .and_then(handle_predict);
    let classify = warp::path!("v1" / "classify")
        .and(warp::post())
        .and(warp::header::optional::<String>("authorization"))
        .and(warp::addr::remote())
        .and(warp::body::content_length_limit(MAX_BODY))
        .and(warp::body::bytes())
        .and(with.clone())
        .and_then(handle_classify);
    let config_get = warp::path!("v1" / "laya" / "config")
        .and(warp::get())
        .and(warp::header::optional::<String>("authorization"))
        .and(warp::addr::remote())
        .and(with.clone())
        .and_then(handle_config_get);
    let config_put = warp::path!("v1" / "laya" / "config")
        .and(warp::put())
        .and(warp::header::optional::<String>("authorization"))
        .and(warp::addr::remote())
        .and(warp::body::content_length_limit(MAX_BODY))
        .and(warp::body::bytes())
        .and(with.clone())
        .and_then(handle_config_put);
    let stats = sh.stats.clone();
    let log = sh.engine.log.clone();
    let gate = Arc::new(LogGate::default());
    let origins = Arc::new(sh.origins.clone());
    let inner = pre
        .and(health.or(preflight).unify().or(predict).unify().or(classify).unify().or(config_get).unify().or(config_put).unify())
        .recover(move |err: warp::Rejection| {
            let stats = stats.clone();
            let log = log.clone();
            let gate = gate.clone();
            async move {
                let (status, code) = if let Some(Refused(s, c)) = err.find::<Refused>() {
                    (*s, *c)
                } else if err.find::<warp::reject::PayloadTooLarge>().is_some() {
                    (StatusCode::PAYLOAD_TOO_LARGE, "body_too_large")
                } else if err.find::<warp::reject::LengthRequired>().is_some() {
                    (StatusCode::LENGTH_REQUIRED, "length_required")
                } else if err.find::<warp::reject::MethodNotAllowed>().is_some() {
                    (StatusCode::METHOD_NOT_ALLOWED, "method_not_allowed")
                } else if err.is_not_found() {
                    (StatusCode::NOT_FOUND, "not_found")
                } else {
                    (StatusCode::BAD_REQUEST, "bad_request")
                };
                stats.refused.fetch_add(1, Ordering::Relaxed);
                stats.last_status.store(status.as_u16() as u64, Ordering::Relaxed);
                stats.last_at_ms.store(now_ms(), Ordering::Relaxed);
                if let Some(line) = gate.admit(status.as_u16(), code) {
                    log(line);
                }
                Ok::<_, std::convert::Infallible>(err_reply(status, code))
            }
        })
        .unify();
    let stats_ok = sh.stats.clone();
    warp::header::optional::<String>("origin").and(inner).map(move |origin: Option<String>, mut res: warp::reply::Response| {
        if res.status().is_success() {
            stats_ok.last_status.store(res.status().as_u16() as u64, Ordering::Relaxed);
            stats_ok.last_at_ms.store(now_ms(), Ordering::Relaxed);
        }
        let h = res.headers_mut();
        h.insert("x-content-type-options", warp::http::HeaderValue::from_static("nosniff"));
        if let Some(o) = origin.filter(|o| origins.iter().any(|a| a == o)) {
            if let Ok(v) = warp::http::HeaderValue::from_str(&o) {
                h.insert("access-control-allow-origin", v);
                h.insert("vary", warp::http::HeaderValue::from_static("Origin"));
            }
        }
        res
    })
}

/// Open the listening socket: loopback only, on the configured port (0 = any, for the tests).
pub async fn bind(cfg: &ApiConfig) -> Result<tokio::net::TcpListener, String> {
    let ip = check_bind(&cfg.bind).map_err(str::to_string)?;
    tokio::net::TcpListener::bind(SocketAddr::new(ip, cfg.port)).await.map_err(|e| format!("ai.api.bindFailed|{}", e.kind()))
}

/// Serve until `shutdown` resolves. `port` is the one the Host check expects (the listener's).
pub async fn serve(listener: tokio::net::TcpListener, cfg: ApiConfig, engine: Engine, stats: Arc<Stats>, shutdown: tokio::sync::oneshot::Receiver<()>) {
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(cfg.port);
    let sh = Arc::new(Shared {
        port,
        origins: cfg.allowed_origins.clone(),
        token_sha256: cfg.token_sha256.clone(),
        engine,
        sem: Arc::new(tokio::sync::Semaphore::new(cfg.concurrency.clamp(1, 2) as usize)),
        waiting: AtomicUsize::new(0),
        rate: Window::default(),
        bad: Window::default(),
        stats,
    });
    warp::serve(routes(sh))
        .incoming(listener)
        .graceful(async {
            shutdown.await.ok();
        })
        .run()
        .await;
}

/// A GET /health probe, for `status` from the CLI and the app's test button.
pub fn probe_health(port: u16, timeout_ms: u64) -> Result<Value, String> {
    let c = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let r = c.get(format!("http://127.0.0.1:{}/health", port)).send().map_err(|_| "unreachable".to_string())?;
    if !r.status().is_success() {
        return Err(format!("http_{}", r.status().as_u16()));
    }
    r.json::<Value>().map_err(|_| "bad_json".to_string())
}

/// POST without a token: must be refused with 401. Proves the lock is on.
pub fn probe_locked(port: u16, timeout_ms: u64) -> Result<bool, String> {
    let c = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let r = c
        .post(format!("http://127.0.0.1:{}/v1/systemone", port))
        .header("content-type", "application/json")
        .body("{}")
        .send()
        .map_err(|_| "unreachable".to_string())?;
    Ok(r.status() == reqwest::StatusCode::UNAUTHORIZED)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn a_broken_or_missing_config_is_off() {
        let d = std::env::temp_dir().join(format!("bmm-ai-api-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        assert!(!load_config(&d).enabled);
        std::fs::write(d.join(CONFIG_FILE), "{ not json").unwrap();
        assert!(!load_config(&d).enabled, "garbage must not turn the API on");
        let c = ApiConfig { enabled: true, port: 80, concurrency: 9, token_sha256: "zz".into(), allowed_origins: vec!["*".into(), "null".into(), "http://localhost:3000/".into(), "http://localhost:3000".into(), "https://a.example/path".into()], ..Default::default() };
        let saved = save_config(&d, &c).unwrap();
        assert_eq!(saved.port, DEFAULT_PORT, "a privileged port is not kept");
        assert_eq!(saved.concurrency, 2);
        assert_eq!(saved.token_sha256, "", "a hash that is not one is dropped");
        assert_eq!(saved.allowed_origins, vec!["http://localhost:3000".to_string()], "wildcards, null and paths are not origins");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn only_loopback_is_ever_bound() {
        assert!(check_bind("127.0.0.1").is_ok());
        assert!(check_bind("::1").is_ok());
        assert!(check_bind("[::1]").is_ok());
        assert!(check_bind("localhost").is_ok());
        for bad in ["0.0.0.0", "::", "192.168.1.10", "10.0.0.2", "8.8.8.8", "example.com", "", "127.0.0.1:80"] {
            assert!(check_bind(bad).is_err(), "{bad} was accepted as a bind address");
        }
    }

    #[test]
    fn the_host_header_must_name_this_server() {
        assert!(host_ok(Some("127.0.0.1:51275"), 51275));
        assert!(host_ok(Some("LOCALHOST:51275"), 51275));
        assert!(host_ok(Some("[::1]:51275"), 51275));
        for bad in ["evil.example:51275", "127.0.0.1", "localhost", "127.0.0.1:1", "127.0.0.1:51275.evil.example", "0.0.0.0:51275", ""] {
            assert!(!host_ok(Some(bad), 51275), "{bad} admitted");
        }
        assert!(!host_ok(None, 51275));
    }

    #[test]
    fn tokens_are_long_random_and_only_their_hash_matches() {
        let a = new_token();
        let b = new_token();
        assert_ne!(a, b);
        assert!(a.starts_with("laya_") && a.len() == 5 + 64);
        let h = hash_token(&a);
        assert!(token_ok(Some(&format!("Bearer {}", a)), &h));
        assert!(token_ok(Some(&format!("bearer   {}", a)), &h));
        assert!(!token_ok(Some(&format!("Bearer {}", b)), &h));
        assert!(!token_ok(Some(&a), &h), "no scheme");
        assert!(!token_ok(Some("Basic abc"), &h));
        assert!(!token_ok(None, &h));
        assert!(!token_ok(Some(&format!("Bearer {}", a)), ""), "no stored hash lets nobody in");
    }

    #[test]
    fn reserved_model_tokens_are_broken_in_untrusted_text() {
        assert_eq!(neutralize_specials("a <eos> b <MASK> c"), "a < eos> b < MASK> c");
        assert_eq!(neutralize_specials("<s>x</s>"), "< s>x< /s>");
        assert_eq!(neutralize_specials("no tags <b>bold</b> é"), "no tags <b>bold</b> é");
        assert!(!neutralize_specials("<start_of_turn>system").contains("<start_of_turn>"));
    }

    #[test]
    fn a_laya_serve_body_parses_in_order() {
        let body = br#"{"state":{"body":"The game crashes at start"},"questions":{
            "sev":{"type":"score","instructions":"How bad?","criteria":{"z":"minor","a":"major","m":"fatal"}},
            "cat":{"type":"choice","instructions":"Which?","criteria":["crash","ui"]},
            "yes":{"type":"noul","instructions":"Is it a crash?"}}, "model":"multilingual"}"#;
        let (text, qs) = parse_request(body).unwrap();
        assert_eq!(text, "The game crashes at start");
        assert_eq!(qs.len(), 3);
        assert_eq!(qs[0].0, "sev");
        let levels: Vec<&str> = qs[0].3.iter().map(|(_, v)| v.as_str()).collect();
        assert_eq!(levels, vec!["minor", "major", "fatal"], "document order, not key order");
        assert_eq!(qs[1].3[0].0, "crash");
        assert_eq!(qs[2].1, "noul");
        // A bare string state is accepted too.
        assert!(parse_request(br#"{"state":"x","questions":{"q":{"type":"noul"}}}"#).is_ok());
    }

    #[test]
    fn what_the_engine_cannot_take_is_refused_not_cut() {
        let e = |b: &str| parse_request(b.as_bytes()).unwrap_err().1;
        assert_eq!(e("not json"), "bad_json");
        assert_eq!(e(r#"{"state":{"body":"x","path":"C:/"},"questions":{"q":{"type":"noul"}}}"#), "unsupported_state");
        assert_eq!(e(r#"{"state":{"body":"x"},"questions":{}}"#), "no_questions");
        assert_eq!(e(r#"{"state":{"body":"x"},"questions":{"../x":{"type":"noul"}}}"#), "bad_question_id");
        assert_eq!(e(r#"{"state":{"body":"x"},"questions":{"q":{"type":"write"}}}"#), "bad_question_type");
        assert_eq!(e(r#"{"state":{"body":"x"},"questions":{"q":{"type":"choice","criteria":["one"]}}}"#), "too_few_options");
        assert_eq!(e(r#"{"state":{"body":"x"},"questions":{"q":{"type":"choice","criteria":["a","a"]}}}"#), "bad_option");
        assert_eq!(e(r#"{"state":{"body":"x"},"questions":{"q":{"type":"noul","criteria":{"maybe":"?"}}}}"#), "bad_option");
        assert_eq!(e(r#"{"state":{"body":"x"},"questions":{"q":{"type":"noul"},"q":{"type":"noul"}}}"#), "bad_json", "duplicate ids");
        let long = "a".repeat(MAX_TEXT + 1);
        assert_eq!(e(&format!(r#"{{"state":{{"body":"{}"}},"questions":{{"q":{{"type":"noul"}}}}}}"#, long)), "text_too_long");
        let many: Vec<String> = (0..=MAX_API_QUESTIONS).map(|i| format!(r#""q{}":{{"type":"noul"}}"#, i)).collect();
        assert_eq!(e(&format!(r#"{{"state":"x","questions":{{{}}}}}"#, many.join(","))), "too_many_questions");
        // Reserved tokens in a question are neutralised.
        let (_, qs) = parse_request(br#"{"state":"x","questions":{"q":{"type":"choice","instructions":"<eos> pick","criteria":["a<mask>","b"]}}}"#).unwrap();
        assert!(!qs[0].2.contains("<eos>") && !qs[0].3[0].0.contains("<mask>"));
    }

    #[test]
    fn origins_are_exact() {
        assert_eq!(validate_origin("HTTP://LocalHost:3000").unwrap(), "http://localhost:3000");
        assert_eq!(validate_origin("https://app.example").unwrap(), "https://app.example");
        for bad in ["*", "null", "file:///c:/x", "http://u:p@a.example", "https://a.example/x", "chrome-extension://abc", ""] {
            assert!(validate_origin(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn the_window_counts_per_address() {
        let w = Window::default();
        let a = IpAddr::from([127, 0, 0, 1]);
        let b = IpAddr::from([127, 0, 0, 2]);
        for _ in 0..3 {
            assert!(w.hit(a, 3));
        }
        assert!(!w.hit(a, 3));
        assert!(w.hit(b, 3), "another client has its own budget");
        assert_eq!(w.count(a), 3);
    }

    // ── the server, end to end over a real socket ────────────────────────────

    fn fake_engine(calls: Arc<AtomicUsize>, guard: Option<&'static str>) -> Engine {
        Engine {
            predict: Arc::new(move |text: &str, qs: &[LayaQuestion]| {
                calls.fetch_add(1, Ordering::SeqCst);
                if text.contains("SLOW") {
                    std::thread::sleep(Duration::from_millis(400));
                }
                let mut answers = serde_json::Map::new();
                for (id, kind, _, crit) in qs {
                    answers.insert(id.clone(), json!({ "type": kind, "choice": crit.first().map(|c| c.0.clone()), "noul": 0.9 }));
                }
                Ok(json!({ "model": "laya-embedded", "answers": answers }))
            }),
            available: Arc::new(|| true),
            guard: Arc::new(move || guard),
            log: Arc::new(|_line: String| {}),
            laya: None,
        }
    }

    async fn start(cfg: ApiConfig, engine: Engine) -> (u16, tokio::sync::oneshot::Sender<()>) {
        let listener = bind(&ApiConfig { port: 0, ..cfg.clone() }).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = tokio::sync::oneshot::channel();
        tokio::spawn(serve(listener, cfg, engine, Arc::new(Stats::default()), rx));
        (port, tx)
    }

    /// One raw HTTP/1.1 exchange: the test decides every header, Host included.
    async fn raw(port: u16, req: String) -> (u16, String) {
        let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        s.write_all(req.as_bytes()).await.unwrap();
        let mut buf = Vec::new();
        let _ = tokio::time::timeout(Duration::from_secs(5), s.read_to_end(&mut buf)).await;
        let text = String::from_utf8_lossy(&buf).to_string();
        let status = text.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
        (status, text)
    }

    fn post(port: u16, host: &str, extra: &str, body: &str) -> String {
        format!("POST /v1/systemone HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{extra}\r\n{body}", body.len(), host = if host.is_empty() { format!("127.0.0.1:{port}") } else { host.to_string() })
    }

    const BODY: &str = r#"{"state":{"body":"The game crashes"},"questions":{"cat":{"type":"choice","instructions":"Which?","criteria":["crash","ui"]}}}"#;

    #[tokio::test]
    async fn the_server_answers_only_an_authenticated_local_caller() {
        let token = new_token();
        let calls = Arc::new(AtomicUsize::new(0));
        let cfg = ApiConfig { enabled: true, token_sha256: hash_token(&token), allowed_origins: vec!["http://localhost:3000".into()], ..Default::default() };
        let (port, stop) = start(cfg, fake_engine(calls.clone(), None)).await;
        let auth = format!("Authorization: Bearer {}\r\n", token);

        let (s, body) = raw(port, post(port, "", &auth, BODY)).await;
        assert_eq!(s, 200, "{body}");
        assert!(body.contains("\"answers\"") && body.contains("no-store"));

        // No token, a wrong token: 401, and the engine never ran.
        let before = calls.load(Ordering::SeqCst);
        assert_eq!(raw(port, post(port, "", "", BODY)).await.0, 401);
        assert_eq!(raw(port, post(port, "", "Authorization: Bearer laya_nope\r\n", BODY)).await.0, 401);
        assert_eq!(calls.load(Ordering::SeqCst), before);

        // DNS rebinding: the right socket, a foreign Host.
        assert_eq!(raw(port, post(port, &format!("evil.example:{port}"), &auth, BODY)).await.0, 421);
        // A web page nobody listed: refused before the token is even looked at, no CORS header.
        let (s, text) = raw(port, post(port, "", &format!("{auth}Origin: https://evil.example\r\n"), BODY)).await;
        assert_eq!(s, 403);
        assert!(!text.to_ascii_lowercase().contains("access-control-allow-origin"));
        // The listed one gets its CORS header.
        let (s, text) = raw(port, post(port, "", &format!("{auth}Origin: http://localhost:3000\r\n"), BODY)).await;
        assert_eq!(s, 200);
        assert!(text.to_ascii_lowercase().contains("access-control-allow-origin: http://localhost:3000"));

        // Size caps: a body over MAX_BODY never reaches the parser.
        let big = format!(r#"{{"state":"{}","questions":{{}}}}"#, "a".repeat(MAX_BODY as usize));
        assert_eq!(raw(port, post(port, "", &auth, &big)).await.0, 413);
        // Health needs no token but still the Host check.
        let (s, text) = raw(port, format!("GET /health HTTP/1.1\r\nHost: localhost:{port}\r\nConnection: close\r\n\r\n")).await;
        assert_eq!(s, 200);
        assert!(text.contains("\"ready\":true"));
        assert_eq!(raw(port, format!("GET /health HTTP/1.1\r\nHost: attacker:{port}\r\nConnection: close\r\n\r\n")).await.0, 421);
        // Nothing else is served.
        assert_eq!(raw(port, format!("GET /api/mods HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n")).await.0, 404);
        let _ = stop.send(());
    }

    fn req(port: u16, method: &str, path: &str, extra: &str, body: &str) -> String {
        format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{extra}\r\n{body}", body.len())
    }

    /// « Réglages des réponses »: /v1/classify answers with the user's settings and only with
    /// the labels given; /v1/laya/config is read freely (with the token) and written only when
    /// the user allowed programs to, and never turns that permission on.
    #[tokio::test]
    async fn classify_and_config_routes_follow_the_users_settings() {
        use crate::commands::ai_tuning::{LayaConfig, Preset, Tuning};
        let token = new_token();
        let calls = Arc::new(AtomicUsize::new(0));
        let stored = Arc::new(Mutex::new(LayaConfig::default()));
        let mut engine = fake_engine(calls.clone(), None);
        // A model that prefers « a » at 0.5 against « b » 0.3 and « none » 0.2, and names a label of its own.
        engine.predict = Arc::new(|_t: &str, qs: &[LayaQuestion]| {
            let mut answers = serde_json::Map::new();
            for (id, _, _, _) in qs {
                answers.insert(id.clone(), json!({ "type": "choice", "probabilities": { "a": 0.5, "b": 0.3, "none": 0.2, "rm -rf": 0.9 } }));
            }
            Ok(json!({ "answers": answers }))
        });
        let (s1, s2) = (stored.clone(), stored.clone());
        engine.laya = Some(LayaHooks {
            load: Arc::new(move || s1.lock().unwrap().clone()),
            save: Arc::new(move |c: &LayaConfig| {
                *s2.lock().unwrap() = c.clone();
                Ok(())
            }),
        });
        let cfg = ApiConfig { enabled: true, token_sha256: hash_token(&token), ..Default::default() };
        let (port, stop) = start(cfg, engine).await;
        let auth = format!("Authorization: Bearer {}\r\n", token);
        let body = r#"{"text":"some text","labels":["a",{"id":"b","description":"the b one","examples":["bee"]}]}"#;

        let (s, text) = raw(port, req(port, "POST", "/v1/classify", &auth, body)).await;
        assert_eq!(s, 200, "{text}");
        assert!(text.contains("\"label\":\"a\"") && !text.contains("rm -rf"), "{text}");
        // No token: 401.
        assert_eq!(raw(port, req(port, "POST", "/v1/classify", "", body)).await.0, 401);
        // Unknown fields and one label are refused.
        assert_eq!(raw(port, req(port, "POST", "/v1/classify", &auth, r#"{"text":"x","labels":["a","b"],"evil":1}"#)).await.0, 400);
        assert_eq!(raw(port, req(port, "POST", "/v1/classify", &auth, r#"{"text":"x","labels":["a"]}"#)).await.0, 422);
        assert_eq!(raw(port, req(port, "POST", "/v1/classify", &auth, r#"{"text":"x","task":"nope"}"#)).await.0, 422);

        // The user's « Programmes » threshold: 0.6 → Laya abstains.
        stored.lock().unwrap().features.api = Some(Tuning { preset: Preset::Custom, threshold: 0.6, ..Tuning::default() });
        let (_, text) = raw(port, req(port, "POST", "/v1/classify", &auth, body)).await;
        assert!(text.contains("\"label\":\"none\"") && text.contains("\"abstained\":true"), "{text}");

        // Read: allowed. Write: locked until the user allows it.
        let (s, text) = raw(port, req(port, "GET", "/v1/laya/config", &auth, "")).await;
        assert_eq!(s, 200);
        assert!(text.contains("bmm-laya-config"));
        let mut want = LayaConfig::default();
        want.allow_program_changes = true;
        want.global.threshold = 0.42;
        want.global.preset = Preset::Custom;
        let put = serde_json::to_string(&want).unwrap();
        let (s, text) = raw(port, req(port, "PUT", "/v1/laya/config", &auth, &put)).await;
        assert_eq!(s, 403, "{text}");
        assert!(text.contains("config_locked"));
        assert_eq!(stored.lock().unwrap().global.threshold, 0.0);
        stored.lock().unwrap().allow_program_changes = true;
        assert_eq!(raw(port, req(port, "PUT", "/v1/laya/config", &auth, &put)).await.0, 200);
        assert_eq!(stored.lock().unwrap().global.threshold, 0.42);
        // Bad values are refused, not clamped.
        let mut bad = serde_json::to_value(&want).unwrap();
        bad["global"]["margin"] = json!(3.0);
        assert_eq!(raw(port, req(port, "PUT", "/v1/laya/config", &auth, &bad.to_string())).await.0, 422);
        let _ = stop.send(());
    }

    /// Born red (review, Oct 1): every refusal wrote a log line, and the log is flushed to disk
    /// on each line. Any web page the user visits can POST no-cors to 127.0.0.1 in a loop: each
    /// is a 403, and each was a synced write. Refusals are now logged a few per minute.
    #[tokio::test]
    async fn a_flood_of_refusals_does_not_flood_the_log() {
        let lines = Arc::new(AtomicUsize::new(0));
        let mut engine = fake_engine(Arc::new(AtomicUsize::new(0)), None);
        let l2 = lines.clone();
        engine.log = Arc::new(move |_line: String| {
            l2.fetch_add(1, Ordering::SeqCst);
        });
        let cfg = ApiConfig { enabled: true, token_sha256: hash_token(&new_token()), ..Default::default() };
        let (port, stop) = start(cfg, engine).await;
        for _ in 0..60 {
            assert_eq!(raw(port, post(port, "", "Origin: https://evil.example\r\n", BODY)).await.0, 403);
        }
        assert!(lines.load(Ordering::SeqCst) <= LOG_REFUSED_PER_MIN, "{} log lines for 60 refusals", lines.load(Ordering::SeqCst));
        let _ = stop.send(());
    }

    #[tokio::test]
    async fn repeated_bad_tokens_lock_the_client_out() {
        let token = new_token();
        let cfg = ApiConfig { enabled: true, token_sha256: hash_token(&token), ..Default::default() };
        let (port, stop) = start(cfg, fake_engine(Arc::new(AtomicUsize::new(0)), None)).await;
        for _ in 0..BAD_AUTH_PER_MIN {
            assert_eq!(raw(port, post(port, "", "Authorization: Bearer laya_guess\r\n", BODY)).await.0, 401);
        }
        // Now even the right token waits out the minute.
        assert_eq!(raw(port, post(port, "", &format!("Authorization: Bearer {}\r\n", token), BODY)).await.0, 429);
        let _ = stop.send(());
    }

    #[tokio::test]
    async fn the_guard_refuses_when_ai_is_off_or_a_game_runs() {
        let token = new_token();
        let calls = Arc::new(AtomicUsize::new(0));
        let cfg = ApiConfig { enabled: true, token_sha256: hash_token(&token), ..Default::default() };
        let (port, stop) = start(cfg, fake_engine(calls.clone(), Some("game_mode"))).await;
        let (s, text) = raw(port, post(port, "", &format!("Authorization: Bearer {}\r\n", token), BODY)).await;
        assert_eq!(s, 503);
        assert!(text.contains("game_mode"));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        let _ = stop.send(());
    }

    #[tokio::test]
    async fn one_at_a_time_with_a_short_queue() {
        let token = new_token();
        let calls = Arc::new(AtomicUsize::new(0));
        let cfg = ApiConfig { enabled: true, token_sha256: hash_token(&token), concurrency: 1, ..Default::default() };
        let (port, stop) = start(cfg, fake_engine(calls.clone(), None)).await;
        let slow = r#"{"state":"SLOW","questions":{"q":{"type":"noul"}}}"#;
        let auth = format!("Authorization: Bearer {}\r\n", token);
        let mut jobs = Vec::new();
        for _ in 0..(QUEUE_MAX + 3) {
            let req = post(port, "", &auth, slow);
            jobs.push(tokio::spawn(async move { raw(port, req).await.0 }));
        }
        let mut codes = Vec::new();
        for j in jobs {
            codes.push(j.await.unwrap());
        }
        assert!(codes.iter().any(|c| *c == 503), "an overfull queue says busy: {codes:?}");
        assert!(codes.iter().filter(|c| **c == 200).count() >= 1);
        let _ = stop.send(());
    }
}
