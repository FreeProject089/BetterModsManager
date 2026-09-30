//! Live error reporting ("Send errors live", Settings → Privacy).
//!
//! What goes wrong on the user's machine reaches the BMM team within seconds instead of waiting
//! for a bug report: JS errors and unhandled rejections, Rust panics, failed commands, failed
//! deploys / installs / backups / scheduler tasks. Sent to the telemetry service's `/issues`.
//!
//! THE RULES
//!   * Two switches. Telemetry consent (`analytics_consent == Some(true)`) AND `live_errors ==
//!     Some(true)`. The second one's first value is decided once: ON for someone who had
//!     already accepted telemetry, OFF for everyone else (`migrate_setting`). Turning telemetry
//!     off stops this and wipes the local queue.
//!   * Redacted before it leaves: every secret BMM stores (data file + BetterCommunity key,
//!     `report_redact::Redactor`, the crash-zip pass), then personal data (user-folder names,
//!     e-mails, IPs, account and PC names: `ai_core::scrub_pii`, the report pre-check pass).
//!   * Grouped here, not there: one line per FINGERPRINT (sha256 of the component, the
//!     normalised message and the top 3 frames) with a count. The same error again within
//!     DEDUPE_WINDOW_MS is a count++ that rides with the next slow flush; a NEW fingerprint is
//!     flushed within FLUSH_DELAY_MS. At most MAX_NEW_PER_HOUR new groups per hour; the queue
//!     is capped (MAX_QUEUE) and kept on disk, so an offline machine sends it later.
//!   * An install is `install_id` = sha256("bmm-issues:v1:" + creator id)[..24]. The dashboard
//!     cannot join it to anything else; a GDPR request (by creator id) still reaches it.
//!   * Never the arguments of a command, never file contents, never the text a user typed.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager, State};

use crate::commands::report_redact::Redactor;
use crate::state::AppState;

pub const INSTALL_SALT: &str = "bmm-issues:v1:";
pub const DEDUPE_WINDOW_MS: i64 = 10 * 60_000;
pub const MAX_QUEUE: usize = 200;
pub const MAX_BATCH: usize = 50;
pub const MAX_NEW_PER_HOUR: usize = 60;
pub const MAX_MESSAGE: usize = 600;
pub const MAX_FRAMES: usize = 6;
pub const FLUSH_DELAY_MS: i64 = 3_000;
pub const SLOW_FLUSH_MS: i64 = 60_000;
const MAX_BACKOFF_MS: i64 = 10 * 60_000;
const QUEUE_FILE: &str = "live_issues_queue.json";

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

// ── The two switches ────────────────────────────────────────────────────────────────────────
/// The first value of `live_errors`, decided once: on for someone who had already said yes to
/// telemetry, off for anyone else. An explicit choice is never touched.
pub fn migrate_setting(consent: Option<bool>, live: Option<bool>) -> Option<bool> {
    live.or(Some(consent == Some(true)))
}
/// Is anything sent? Both switches, explicitly on.
pub fn effective(consent: Option<bool>, live: Option<bool>) -> bool {
    consent == Some(true) && live == Some(true)
}

pub fn install_id_for(creator_id: &str) -> String {
    use sha2::Digest;
    let h = sha2::Sha256::digest(format!("{INSTALL_SALT}{creator_id}").as_bytes());
    hex::encode(h)[..24].to_string()
}

// ── Normalising and fingerprinting ──────────────────────────────────────────────────────────
/// The message as the fingerprint sees it: numbers, hex runs and quoted values folded, so
/// "file 12 of 40" and "file 13 of 40" are one issue, and so are two users' different paths.
pub fn normalize_message(msg: &str) -> String {
    let mut out = String::with_capacity(msg.len());
    let mut chars = msg.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\'' | '"' | '`' => {
                // a quoted value → '?', up to the matching quote on the same line
                let mut buf = String::new();
                let mut closed = false;
                while let Some(&n) = chars.peek() {
                    if n == '\n' { break; }
                    chars.next();
                    if n == c { closed = true; break; }
                    buf.push(n);
                }
                if closed && buf.len() <= 200 { out.push(c); out.push('?'); out.push(c); } else { out.push(c); out.push_str(&buf); }
            }
            d if d.is_ascii_digit() => {
                while chars.peek().map(|n| n.is_ascii_hexdigit() || *n == '.' || *n == '_').unwrap_or(false) { chars.next(); }
                out.push('N');
            }
            _ => out.push(c),
        }
    }
    // long hex-looking words (ids, hashes) → #
    let folded: Vec<String> = out.split_whitespace().map(|w| {
        let core: String = w.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
        if core.len() >= 12 && core.chars().filter(|c| c.is_ascii_digit() || *c == 'N').count() * 3 >= core.len() { "#".into() } else { w.to_string() }
    }).collect();
    folded.join(" ").chars().take(300).collect()
}

/// Stack text → short frames `function@file` (no line / column: they move with every build).
/// Understands V8 (`at fn (url:1:2)`), Firefox/Safari (`fn@url:1:2`) and Rust panic locations
/// (`panicked at src/x.rs:12:5`).
pub fn parse_frames(stack: &str) -> Vec<String> {
    let short_file = |url: &str| -> String {
        let u = url.trim().trim_start_matches('(').trim_end_matches(')');
        // strip :line:col
        let mut u = u.to_string();
        for _ in 0..2 {
            if let Some(i) = u.rfind(':') {
                if u[i + 1..].chars().all(|c| c.is_ascii_digit()) && i + 1 < u.len() { u.truncate(i); }
            }
        }
        let u = u.split(['?', '#']).next().unwrap_or("").replace('\\', "/");
        for marker in ["/js/", "/src/", "/frontend/"] {
            if let Some(i) = u.rfind(marker) { return u[i + marker.len()..].to_string(); }
        }
        u.rsplit('/').take(2).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("/")
    };
    let mut out = Vec::new();
    for line in stack.lines() {
        let l = line.trim();
        if l.is_empty() { continue; }
        let frame = if let Some(rest) = l.strip_prefix("at ") {
            match rest.rfind(" (") {
                Some(i) => format!("{}@{}", &rest[..i], short_file(&rest[i + 1..])),
                None => format!("?@{}", short_file(rest)),
            }
        } else if let Some(i) = l.find("panicked at ") {
            let loc = l[i + 12..].trim_end_matches(':');
            format!("panic@{}", short_file(loc.split_whitespace().next().unwrap_or(loc)))
        } else if let Some(i) = l.find('@') {
            if l.contains("://") || l.contains(".js") || l.contains(".rs") {
                format!("{}@{}", &l[..i], short_file(&l[i + 1..]))
            } else { continue }
        } else { continue };
        let frame: String = frame.chars().take(160).collect();
        out.push(frame);
        if out.len() >= MAX_FRAMES { break; }
    }
    out
}

pub fn fingerprint(component: &str, normalized: &str, frames: &[String]) -> String {
    use sha2::Digest;
    let top: Vec<&str> = frames.iter().take(3).map(String::as_str).collect();
    let h = sha2::Sha256::digest(format!("{component}\n{normalized}\n{}", top.join("\n")).as_bytes());
    hex::encode(h)[..16].to_string()
}

// ── Redaction ────────────────────────────────────────────────────────────────────────────────
/// The two existing passes, in the order the report screens use them: stored secrets and
/// credential shapes first, then personal data.
pub fn redact(r: &Redactor, text: &str, user: Option<&str>, pc: Option<&str>, extra: &[String]) -> String {
    let s = r.scrub_text(text);
    let (clean, _) = crate::commands::ai_core::scrub_pii(&s, user, pc, extra);
    clean
}

// ── The queue ────────────────────────────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Issue {
    pub fingerprint: String,
    pub level: String,
    pub component: String,
    pub message: String,
    pub frames: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    pub count: u64,
    pub first_seen: i64,
    pub last_seen: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crash_report: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Urgency { Now, Later, Dropped }

fn level_rank(l: &str) -> u8 {
    match l { "fatal" => 3, "error" => 2, _ => 1 }
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Queue {
    pub pending: Vec<Issue>,
    /// fingerprint → when it was last sent (the dedupe window).
    pub sent_at: HashMap<String, i64>,
    pub hour_start: i64,
    pub new_in_hour: usize,
    pub dropped: u64,
    pub sent_total: u64,
    /// When the oldest not-yet-sent NEW group arrived (the fast flush clock).
    #[serde(default)]
    pub urgent_since: Option<i64>,
}

impl Queue {
    /// Add one (already redacted) occurrence.
    pub fn record(&mut self, it: Issue, now: i64) -> Urgency {
        self.sent_at.retain(|_, t| now - *t < DEDUPE_WINDOW_MS);
        if let Some(p) = self.pending.iter_mut().find(|p| p.fingerprint == it.fingerprint) {
            p.count += it.count.max(1);
            p.last_seen = p.last_seen.max(it.last_seen);
            if level_rank(&it.level) > level_rank(&p.level) { p.level = it.level; }
            if p.crash_report.is_none() { p.crash_report = it.crash_report; }
            return Urgency::Later;
        }
        let repeat = self.sent_at.contains_key(&it.fingerprint);
        if !repeat {
            if now - self.hour_start >= 3_600_000 { self.hour_start = now; self.new_in_hour = 0; }
            if self.new_in_hour >= MAX_NEW_PER_HOUR { self.dropped += 1; return Urgency::Dropped; }
            self.new_in_hour += 1;
        }
        self.pending.push(it);
        if self.pending.len() > MAX_QUEUE {
            // Drop the least useful line: lowest level, then oldest.
            if let Some((i, _)) = self.pending.iter().enumerate()
                .min_by_key(|(_, p)| (level_rank(&p.level), p.last_seen)) {
                self.pending.remove(i);
                self.dropped += 1;
            }
        }
        if repeat { Urgency::Later } else {
            if self.urgent_since.is_none() { self.urgent_since = Some(now); }
            Urgency::Now
        }
    }
    pub fn due(&self, now: i64, last_flush: i64) -> bool {
        if self.pending.is_empty() { return false; }
        matches!(self.urgent_since, Some(t) if now - t >= FLUSH_DELAY_MS) || now - last_flush >= SLOW_FLUSH_MS
    }
    /// Take up to `max` lines to send (fatal first, then newest).
    pub fn take_batch(&mut self, max: usize) -> Vec<Issue> {
        self.pending.sort_by(|a, b| level_rank(&b.level).cmp(&level_rank(&a.level)).then(b.last_seen.cmp(&a.last_seen)));
        let n = self.pending.len().min(max);
        let batch: Vec<Issue> = self.pending.drain(..n).collect();
        if self.pending.is_empty() { self.urgent_since = None; }
        batch
    }
    pub fn sent(&mut self, batch: &[Issue], now: i64) {
        for b in batch { self.sent_at.insert(b.fingerprint.clone(), now); self.sent_total += b.count; }
    }
    /// A send failed: the lines go back (merged with anything that arrived meanwhile).
    pub fn restore(&mut self, batch: Vec<Issue>, now: i64) {
        for b in batch {
            let was_urgent = self.urgent_since.is_some();
            let u = self.record(b, now);
            if u == Urgency::Now && !was_urgent { self.urgent_since = Some(now); }
        }
    }
}

// ── Runtime ──────────────────────────────────────────────────────────────────────────────────
#[derive(Default)]
struct Cfg {
    endpoint: String,
    api_key: String,
    install_id: String,
    app_version: String,
    os: String,
    session_id: Option<String>,
    queue_path: Option<PathBuf>,
    user: Option<String>,
    pc: Option<String>,
    extra_secrets: Vec<String>,
    last_flush: i64,
    next_attempt: i64,
    backoff_ms: i64,
    last_error: String,
    last_sent_at: i64,
}

struct Runtime {
    cfg: Mutex<Cfg>,
    queue: Mutex<Queue>,
    redactor: Mutex<Redactor>,
    dirty: AtomicBool,
    started: AtomicBool,
}

static ENABLED: AtomicBool = AtomicBool::new(false);
static RT: OnceLock<Runtime> = OnceLock::new();
fn rt() -> &'static Runtime {
    RT.get_or_init(|| Runtime {
        cfg: Mutex::new(Cfg::default()),
        queue: Mutex::new(Queue::default()),
        redactor: Mutex::new(Redactor::new()),
        dirty: AtomicBool::new(false),
        started: AtomicBool::new(false),
    })
}

pub fn is_enabled() -> bool { ENABLED.load(Ordering::Relaxed) }

/// The ingest URL beside the telemetry endpoint (`…/batch/` → `…/issues`).
pub fn issues_url(endpoint: &str) -> Option<String> {
    let base = endpoint.trim().trim_end_matches('/').trim_end_matches("/batch").trim_end_matches("/capture").trim_end_matches('/');
    if base.is_empty() { return None; }
    let url = format!("{base}/issues");
    if crate::commands::analytics::endpoint_allowed(&url) { Some(url) } else { None }
}

pub struct Raw<'a> {
    pub level: &'a str,
    pub component: &'a str,
    pub message: &'a str,
    pub stack: Option<&'a str>,
    pub code: Option<&'a str>,
    pub crash_report: Option<String>,
}

/// Raw report → the line that may leave the machine. Pure given the redactor.
pub fn prepare(raw: &Raw, r: &Redactor, user: Option<&str>, pc: Option<&str>, extra: &[String], session: Option<String>, now: i64) -> Issue {
    let level = if ["fatal", "error", "warning"].contains(&raw.level) { raw.level } else { "error" };
    let component: String = raw.component.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | ':' | '.')).take(40).collect::<String>().to_ascii_lowercase();
    let component = if component.is_empty() { "unknown".to_string() } else { component };
    let message = redact(r, raw.message, user, pc, extra);
    let stack = raw.stack.map(|s| redact(r, s, user, pc, extra)).unwrap_or_default();
    let mut frames = parse_frames(&stack);
    if frames.is_empty() && component == "panic" { frames = parse_frames(&message); }
    let code = raw.code.map(|c| redact(r, c, user, pc, extra)).map(|c| c.chars().take(80).collect::<String>()).filter(|c| !c.is_empty());
    let fp = fingerprint(&component, &normalize_message(&format!("{}{}", code.as_deref().map(|c| format!("{c}: ")).unwrap_or_default(), message)), &frames);
    Issue {
        fingerprint: fp, level: level.to_string(), component,
        message: message.chars().take(MAX_MESSAGE).collect(), frames, code, count: 1,
        first_seen: now, last_seen: now, crash_report: raw.crash_report.clone(), session_id: session,
    }
}

/// Record one occurrence (no-op when off). Safe from any thread; never blocks for long.
pub fn record(raw: Raw) -> Urgency {
    if !is_enabled() { return Urgency::Dropped; }
    let rt = rt();
    let (user, pc, extra, session) = match rt.cfg.lock() {
        Ok(c) => (c.user.clone(), c.pc.clone(), c.extra_secrets.clone(), c.session_id.clone()),
        Err(_) => return Urgency::Dropped,
    };
    let issue = {
        let Ok(r) = rt.redactor.lock() else { return Urgency::Dropped };
        prepare(&raw, &r, user.as_deref(), pc.as_deref(), &extra, session, now_ms())
    };
    let u = match rt.queue.lock() { Ok(mut q) => q.record(issue, now_ms()), Err(_) => Urgency::Dropped };
    if u != Urgency::Dropped { rt.dirty.store(true, Ordering::Relaxed); }
    u
}

/// A Rust-side failure (scheduler task, background job). Message only; never arguments.
pub fn record_rust(component: &str, level: &str, message: &str, code: Option<&str>) {
    let _ = record(Raw { level, component, message, stack: None, code, crash_report: None });
}

/// From the panic hook: try_lock only (the panic may have happened while a lock was held) and
/// write the queue to disk NOW — the process is probably about to end; the next launch sends it.
pub fn record_panic(reason: &str, crash_report: Option<String>) {
    if !is_enabled() { return; }
    let Some(rt) = RT.get() else { return };
    let (Ok(cfg), Ok(r), Ok(mut q)) = (rt.cfg.try_lock(), rt.redactor.try_lock(), rt.queue.try_lock()) else { return };
    let issue = prepare(&Raw { level: "fatal", component: "panic", message: reason, stack: None, code: None, crash_report },
        &r, cfg.user.as_deref(), cfg.pc.as_deref(), &cfg.extra_secrets, cfg.session_id.clone(), now_ms());
    q.record(issue, now_ms());
    if let Some(p) = &cfg.queue_path { persist_to(p, &q); }
}

fn persist_to(path: &std::path::Path, q: &Queue) {
    if let Ok(s) = serde_json::to_string(q) {
        let tmp = path.with_extension("json.part");
        if std::fs::write(&tmp, s).is_ok() { let _ = std::fs::rename(&tmp, path); }
    }
}
fn load_from(path: &std::path::Path) -> Queue {
    std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str::<Queue>(&s).ok())
        .map(|mut q| { q.pending.truncate(MAX_QUEUE); q }).unwrap_or_default()
}

/// Stop and forget everything queued (the user turned it off, or telemetry off).
pub fn disable_and_wipe() {
    ENABLED.store(false, Ordering::Relaxed);
    let rt = rt();
    if let Ok(mut q) = rt.queue.lock() { *q = Queue::default(); }
    if let Some(p) = rt.cfg.lock().ok().and_then(|c| c.queue_path.clone()) { let _ = std::fs::remove_file(p); }
}

/// Called by set_analytics_consent: consent off wipes; consent on applies the live switch.
pub fn on_consent_changed(consent: Option<bool>, live: Option<bool>) {
    if effective(consent, live) { ENABLED.store(true, Ordering::Relaxed); start_loop(); } else { disable_and_wipe(); }
}

/// The body sent to `/issues`.
pub fn payload(api_key: &str, install_id: &str, app_version: &str, os: &str, batch: &[Issue]) -> Value {
    json!({ "api_key": api_key, "install_id": install_id, "app_version": app_version, "os": os, "issues": batch })
}

/// POST one batch (gzip). Ok on 2xx; Err(reason) otherwise. `413`/`400` are final (Err("drop")).
pub async fn post(url: &str, body: &Value) -> Result<(), String> {
    use std::io::Write;
    let raw = serde_json::to_vec(body).map_err(|e| e.to_string())?;
    let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    enc.write_all(&raw).map_err(|e| e.to_string())?;
    let gz = enc.finish().map_err(|e| e.to_string())?;
    let resp = crate::commands::net::client().post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(reqwest::header::CONTENT_ENCODING, "gzip")
        .header(reqwest::header::USER_AGENT, "BetterModsManager")
        .timeout(std::time::Duration::from_secs(15))
        .body(gz)
        .send().await.map_err(|_| "network".to_string())?;
    let s = resp.status();
    if s.is_success() { Ok(()) }
    else if s == reqwest::StatusCode::PAYLOAD_TOO_LARGE || s == reqwest::StatusCode::BAD_REQUEST { Err("drop".into()) }
    else { Err(format!("http_{}", s.as_u16())) }
}

async fn flush_once() {
    let rt = rt();
    let now = now_ms();
    let (url, key, iid, ver, os) = {
        let Ok(c) = rt.cfg.lock() else { return };
        if now < c.next_attempt { return; }
        let due = rt.queue.lock().map(|q| q.due(now, c.last_flush)).unwrap_or(false);
        if !due { return; }
        let Some(url) = issues_url(&c.endpoint) else { return };
        (url, c.api_key.clone(), c.install_id.clone(), c.app_version.clone(), c.os.clone())
    };
    let batch = match rt.queue.lock() { Ok(mut q) => q.take_batch(MAX_BATCH), Err(_) => return };
    if batch.is_empty() { return; }
    let res = post(&url, &payload(&key, &iid, &ver, &os, &batch)).await;
    let now = now_ms();
    if let (Ok(mut c), Ok(mut q)) = (rt.cfg.lock(), rt.queue.lock()) {
        c.last_flush = now;
        match res {
            Ok(()) => { q.sent(&batch, now); c.backoff_ms = 0; c.next_attempt = 0; c.last_error.clear(); c.last_sent_at = now; }
            Err(e) if e == "drop" => { q.dropped += batch.len() as u64; c.last_error = e; }
            Err(e) => {
                q.restore(batch, now);
                c.backoff_ms = if c.backoff_ms == 0 { 30_000 } else { (c.backoff_ms * 2).min(MAX_BACKOFF_MS) };
                c.next_attempt = now + c.backoff_ms;
                c.last_error = e;
            }
        }
    }
    rt.dirty.store(true, Ordering::Relaxed);
}

fn start_loop() {
    let rt = rt();
    if rt.started.swap(true, Ordering::SeqCst) { return; }
    tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(1));
        loop {
            tick.tick().await;
            if !is_enabled() { continue; }
            flush_once().await;
            if rt.dirty.swap(false, Ordering::Relaxed) {
                let path = rt.cfg.lock().ok().and_then(|c| c.queue_path.clone());
                if let (Some(p), Ok(q)) = (path, rt.queue.lock()) { persist_to(&p, &q); }
            }
        }
    });
}

fn status_doc() -> Value {
    let rt = rt();
    let (pending, dropped, sent) = rt.queue.lock().map(|q| (q.pending.iter().map(|p| p.count).sum::<u64>(), q.dropped, q.sent_total)).unwrap_or((0, 0, 0));
    let (err, last) = rt.cfg.lock().map(|c| (c.last_error.clone(), c.last_sent_at)).unwrap_or_default();
    json!({ "enabled": is_enabled(), "pending": pending, "dropped": dropped, "sent": sent, "last_error": err, "last_sent_at": last })
}

// ── Commands ─────────────────────────────────────────────────────────────────────────────────
/// Boot: decide the switch's first value, learn the secrets to redact, load the offline queue,
/// start the flush loop. `endpoint`/`api_key` are the telemetry ones (links-config).
#[tauri::command]
pub fn live_issues_init(state: State<AppState>, app_handle: AppHandle, endpoint: Option<String>, api_key: Option<String>, session_id: Option<String>) -> Value {
    let (consent, live) = {
        let Ok(mut d) = state.data.lock() else { return status_doc() };
        let before = d.settings.live_errors;
        d.settings.live_errors = migrate_setting(d.settings.analytics_consent, before);
        let changed = before != d.settings.live_errors;
        let v = (d.settings.analytics_consent, d.settings.live_errors);
        drop(d);
        if changed { let _ = state.save(); }
        v
    };
    let dir = state.data_path.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| PathBuf::from("."));
    let mut r = Redactor::new();
    r.absorb_data_file(&state.data_path);
    r.absorb_secret_file(&dir.join(crate::commands::security::BC_API_KEY_FILE));
    let extra: Vec<String> = crate::commands::ai_core::SECRET_NAMES.iter().filter_map(|n| crate::commands::ai_core::get_secret(&dir, n)).collect();
    let (user, pc) = crate::commands::ai_core::os_identity();
    let creator = crate::commands::security::get_creator_id(app_handle.clone()).unwrap_or_default();
    let queue_path = app_handle.path().app_data_dir().ok().map(|d| d.join(QUEUE_FILE));
    let rt = rt();
    if let Ok(mut red) = rt.redactor.lock() { *red = r; }
    if let Ok(mut c) = rt.cfg.lock() {
        c.endpoint = endpoint.unwrap_or_default();
        c.api_key = api_key.unwrap_or_default();
        c.install_id = if creator.is_empty() { install_id_for(&uuid::Uuid::new_v4().to_string()) } else { install_id_for(&creator) };
        c.app_version = app_handle.package_info().version.to_string();
        c.os = format!("{} {}", std::env::consts::OS, std::env::consts::ARCH);
        c.session_id = session_id.filter(|s| s.len() <= 64 && s.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_'));
        c.user = user;
        c.pc = pc;
        c.extra_secrets = extra;
        c.queue_path = queue_path.clone();
    }
    if effective(consent, live) {
        if let (Some(p), Ok(mut q)) = (queue_path.as_ref(), rt.queue.lock()) {
            let loaded = load_from(p);
            let now = now_ms();
            for it in loaded.pending { q.record(it, now); }
            q.dropped += loaded.dropped;
            q.sent_total = q.sent_total.max(loaded.sent_total);
        }
        ENABLED.store(true, Ordering::Relaxed);
        start_loop();
    } else {
        disable_and_wipe();
    }
    status_doc()
}

#[tauri::command]
pub fn live_issues_set_enabled(state: State<AppState>, enabled: bool) -> Result<Value, String> {
    let consent = {
        let mut d = state.data.lock().map_err(|_| "lock".to_string())?;
        d.settings.live_errors = Some(enabled);
        d.settings.analytics_consent
    };
    let _ = state.save();
    if effective(consent, Some(enabled)) {
        ENABLED.store(true, Ordering::Relaxed);
        start_loop();
    } else {
        disable_and_wipe();
    }
    crate::commands::crash::log_line(format!("[LIVE ISSUES] set to {}", enabled));
    Ok(status_doc())
}

/// The setting as stored (for the toggle), plus the runtime state.
#[tauri::command]
pub fn live_issues_status(state: State<AppState>) -> Value {
    let setting = state.data.lock().ok().and_then(|d| d.settings.live_errors);
    let mut v = status_doc();
    v["setting"] = json!(setting);
    v
}

/// One occurrence from the webview. Returns nothing and never fails: a reporter that throws
/// would report itself.
#[tauri::command]
pub fn live_issue_report(level: String, component: String, message: String, stack: Option<String>, code: Option<String>) {
    let message: String = message.chars().take(4000).collect();
    let stack: Option<String> = stack.map(|s| s.chars().take(8000).collect());
    let code: Option<String> = code.map(|c| c.chars().take(200).collect());
    let _ = record(Raw { level: &level, component: &component, message: &message, stack: stack.as_deref(), code: code.as_deref(), crash_report: None });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw<'a>(component: &'a str, message: &'a str, stack: Option<&'a str>) -> Raw<'a> {
        Raw { level: "error", component, message, stack, code: None, crash_report: None }
    }

    #[test]
    fn install_id_vector() {
        // Same vector as the telemetry server (issues.rs install_id_matches_the_bmm_vector).
        assert_eq!(install_id_for("abc"), "d5ccccff742ced2da04e03ea");
    }

    #[test]
    fn switch_defaults_follow_the_prior_consent_once() {
        assert_eq!(migrate_setting(Some(true), None), Some(true), "already consented → on");
        assert_eq!(migrate_setting(None, None), Some(false), "never asked → off");
        assert_eq!(migrate_setting(Some(false), None), Some(false));
        assert_eq!(migrate_setting(Some(true), Some(false)), Some(false), "an explicit choice is kept");
        assert!(effective(Some(true), Some(true)));
        assert!(!effective(Some(false), Some(true)), "no telemetry consent → nothing, whatever the switch");
        assert!(!effective(None, Some(true)));
        assert!(!effective(Some(true), Some(false)));
        assert!(!effective(Some(true), None));
    }

    #[test]
    fn redaction_removes_secrets_paths_emails_ips_and_the_bcweb_key() {
        let mut r = Redactor::new();
        r.absorb_json_text(r#"{"settings":{"github_token":"ghp_abcdefghijklmnopqrstuvwxyz0123456789","api_token":"8f14e45f-ceea-467a-9575-1a2b3c4d5e6f"}}"#);
        let dir = std::env::temp_dir().join(format!("bmm-live-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let key = dir.join("bcweb-api-key");
        std::fs::write(&key, "bcw_live_SECRETKEY_1234567890").unwrap();
        r.absorb_secret_file(&key);
        let i = prepare(&Raw {
            level: "error", component: "ipc",
            message: "deploy failed for C:\\Users\\alice\\Games\\mod.zip, mail bob@example.com, host 192.168.1.44, token ghp_abcdefghijklmnopqrstuvwxyz0123456789 key bcw_live_SECRETKEY_1234567890 api 8f14e45f-ceea-467a-9575-1a2b3c4d5e6f https://x.test/r?password=hunter22",
            stack: Some("Error\n    at deploy (file:///C:/Users/alice/AppData/x/js/features/mods/mods.js:10:5)"),
            code: Some("deploy_profile"), crash_report: None,
        }, &r, Some("alice"), Some("ALICE-PC"), &[], None, 1);
        let all = format!("{} {:?}", i.message, i.frames);
        for bad in ["alice", "bob@example.com", "192.168.1.44", "ghp_abcdef", "bcw_live_SECRETKEY", "8f14e45f-ceea", "hunter22"] {
            assert!(!all.contains(bad), "{bad} survived: {all}");
        }
        assert_eq!(i.frames, vec!["deploy@features/mods/mods.js".to_string()]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fingerprint_is_stable_across_users_numbers_and_line_numbers() {
        let r = Redactor::new();
        let a = prepare(&raw("js", "Failed to read file 12 of 40: 'C:\\Users\\alice\\a.json'", Some("at load (http://x/js/core/a.js:10:3)")), &r, Some("alice"), None, &[], None, 1);
        let b = prepare(&raw("js", "Failed to read file 13 of 40: 'C:\\Users\\bob\\b.json'", Some("at load (http://x/js/core/a.js:99:1)")), &r, Some("bob"), None, &[], None, 2);
        assert_eq!(a.fingerprint, b.fingerprint);
        let c = prepare(&raw("ipc", "Failed to read file 12 of 40", None), &r, None, None, &[], None, 1);
        assert_ne!(a.fingerprint, c.fingerprint, "the component is part of the fingerprint");
        assert_eq!(parse_frames("thread 'main' panicked at src/commands/mods.rs:12:5:\nboom"), vec!["panic@commands/mods.rs".to_string()]);
        assert_eq!(parse_frames("load@http://x/js/core/a.js:1:2"), vec!["load@core/a.js".to_string()]);
    }

    fn issue(fp: &str, level: &str, t: i64) -> Issue {
        Issue { fingerprint: fp.into(), level: level.into(), component: "js".into(), message: "m".into(), frames: vec![], code: None, count: 1, first_seen: t, last_seen: t, crash_report: None, session_id: None }
    }

    #[test]
    fn dedupe_counts_repeats_and_flushes_new_ones_fast() {
        let mut q = Queue::default();
        assert_eq!(q.record(issue("a", "error", 0), 0), Urgency::Now);
        assert_eq!(q.record(issue("a", "fatal", 10), 10), Urgency::Later);
        assert_eq!(q.pending.len(), 1);
        assert_eq!(q.pending[0].count, 2);
        assert_eq!(q.pending[0].level, "fatal", "the worst level wins");
        assert!(!q.due(FLUSH_DELAY_MS - 1, 0));
        assert!(q.due(FLUSH_DELAY_MS, 0), "a new fingerprint goes out within a few seconds");
        let b = q.take_batch(MAX_BATCH);
        q.sent(&b, 5_000);
        // Same error again inside the window: queued, but NOT urgent.
        assert_eq!(q.record(issue("a", "error", 6_000), 6_000), Urgency::Later);
        assert!(!q.due(6_000 + FLUSH_DELAY_MS, 5_000));
        assert!(q.due(5_000 + SLOW_FLUSH_MS, 5_000), "repeats ride with the slow flush");
        // After the window it is a fresh occurrence again.
        let mut q2 = Queue::default();
        q2.sent(&[issue("z", "error", 0)], 0);
        assert_eq!(q2.record(issue("z", "error", DEDUPE_WINDOW_MS + 1), DEDUPE_WINDOW_MS + 1), Urgency::Now);
    }

    #[test]
    fn rate_limit_and_cap_bound_the_queue() {
        let mut q = Queue::default();
        for i in 0..(MAX_NEW_PER_HOUR + 5) { q.record(issue(&format!("f{i}"), "warning", 1), 1); }
        assert_eq!(q.pending.len(), MAX_NEW_PER_HOUR);
        assert_eq!(q.dropped, 5);
        // next hour: room again, and the cap drops the least useful line
        let mut q = Queue::default();
        for h in 0..5 {
            for i in 0..MAX_NEW_PER_HOUR { q.record(issue(&format!("h{h}-{i}"), if i == 0 { "fatal" } else { "warning" }, h * 3_600_000), h as i64 * 3_600_000); }
        }
        assert_eq!(q.pending.len(), MAX_QUEUE);
        assert_eq!(q.pending.iter().filter(|p| p.level == "fatal").count(), 5, "fatal lines are the last to go");
        let b = q.take_batch(MAX_BATCH);
        assert_eq!(b.len(), MAX_BATCH);
        assert_eq!(b[0].level, "fatal", "fatal first");
    }

    #[test]
    fn failed_send_restores_the_batch() {
        let mut q = Queue::default();
        q.record(issue("a", "error", 0), 0);
        q.record(issue("a", "error", 1), 1);
        let b = q.take_batch(10);
        assert!(q.pending.is_empty());
        q.record(issue("a", "error", 2), 2);
        q.restore(b, 3);
        assert_eq!(q.pending.len(), 1);
        assert_eq!(q.pending[0].count, 3, "nothing counted twice, nothing lost");
    }

    #[test]
    fn issues_url_is_derived_and_refuses_plaintext_remote() {
        assert_eq!(issues_url("https://t.example/batch/").as_deref(), Some("https://t.example/issues"));
        assert_eq!(issues_url("http://localhost:8900/batch").as_deref(), Some("http://localhost:8900/issues"));
        assert_eq!(issues_url("http://evil.example/batch"), None);
        assert_eq!(issues_url(""), None);
    }

    #[test]
    fn nothing_is_recorded_while_off() {
        ENABLED.store(false, Ordering::Relaxed);
        assert_eq!(record(raw("js", "boom", None)), Urgency::Dropped);
    }

    /// End to end against a fake telemetry server on loopback: the batch arrives gzipped, as
    /// JSON, with the counts and without the secrets.
    #[tokio::test]
    async fn posts_a_redacted_batch_to_a_fake_server() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            s.set_read_timeout(Some(std::time::Duration::from_secs(5))).ok();
            let mut buf = Vec::new();
            let mut tmp = [0u8; 4096];
            let (head_end, len) = loop {
                let n = s.read(&mut tmp).unwrap();
                buf.extend_from_slice(&tmp[..n]);
                if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&buf[..i]).to_ascii_lowercase();
                    let len = head.lines().find_map(|l| l.strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap())).unwrap_or(0);
                    break (i + 4, len);
                }
            };
            while buf.len() < head_end + len { let n = s.read(&mut tmp).unwrap(); if n == 0 { break; } buf.extend_from_slice(&tmp[..n]); }
            let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
            let body = buf[head_end..head_end + len].to_vec();
            s.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 12\r\nConnection: close\r\n\r\n{\"status\":1}").unwrap();
            (head, body)
        });
        let mut r = Redactor::new();
        r.absorb_json_text(r#"{"api_token":"tok-abcdef-123456"}"#);
        let mut q = Queue::default();
        for t in 0..3 {
            q.record(prepare(&raw("js", "boom with tok-abcdef-123456 at C:\\Users\\carol\\x", None), &r, Some("carol"), None, &[], None, t), t);
        }
        let batch = q.take_batch(MAX_BATCH);
        let url = issues_url(&format!("http://127.0.0.1:{port}/batch/")).unwrap();
        post(&url, &payload("pk", &install_id_for("creator"), "1.2.3", "windows x86_64", &batch)).await.expect("2xx");
        let (head, body) = server.join().unwrap();
        assert!(head.starts_with("POST /issues "), "{head}");
        assert!(head.to_ascii_lowercase().contains("content-encoding: gzip"));
        let mut json = String::new();
        flate2::read::GzDecoder::new(&body[..]).read_to_string(&mut json).unwrap();
        let v: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["issues"].as_array().unwrap().len(), 1, "three occurrences, one line");
        assert_eq!(v["issues"][0]["count"], 3);
        assert_eq!(v["install_id"], install_id_for("creator"));
        assert!(!json.contains("tok-abcdef-123456") && !json.contains("carol"), "{json}");
    }
}
