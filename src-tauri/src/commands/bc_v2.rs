//! BetterCommunity v2: the Rust half of the switchable BC client.
//!
//! WHAT IS HERE
//!   * The session's mode (`bc_v2_activate`, BMM 1.0.4): app.cfg (`BCApiVersion`, `BCv2Base`)
//!     wins over links.json (`bc_api`, `bc_v2_base`), which wins over v1. v2 is used only after
//!     `GET <root>/v2/health` answered in this session; otherwise the session stays on v1 and the
//!     reason is logged. `effective_v2_root` is what every Rust caller asks.
//!   * The consent-ledger adapter: BMM's local receipts (consent_ledger.rs) mapped to the v2
//!     consent ledger's `POST /v2/consents` (contract: BetterCommunity-v2
//!     packages/contracts/src/consents.ts, ADR 0011), for an ANONYMOUS subject derived from the
//!     install id, and the command that sends them.
//!   * BMM's own legal texts on v2 (ADR 0018 §4): `bmm-terms` / `bmm-privacy` read from
//!     `GET /v2/consents/documents`, the Terms and Privacy receipts sent as `kind: legal` when v2
//!     publishes the version this build ships, and the re-acceptance answers when v2 publishes
//!     another one (`bc_v2_legal_status`, `bc_v2_legal_answer`).
//!
//! WHAT LEAVES THE MACHINE, AND WHEN
//!   Exactly the rule of `consent_sync` (the telemetry server copy): nothing unless telemetry
//!   consent is on (`analytics_consent == Some(true)`) or the user pressed « Send to the server »
//!   in My consents (`force`). On top of that, nothing unless this session runs on v2.
//!   Per receipt: the scope (`app.telemetry` / `app.crash_reports`) or the legal text's slug and
//!   revision, the per-category booleans, the language (fr/en), the source and the app version.
//!   No IP, no Creator ID, no text, no path, no local hash or MAC (the v2 contract is a strict
//!   object: it would refuse them). A re-acceptance answer is sent when the person gives it: it
//!   is an answer to BetterCommunity's text, given in BetterCommunity's prompt.
//!
//! WHAT WAITS
//!   A Terms / Privacy receipt whose text v2 does not publish in that version is kept back
//!   (`deferred`) and replayed at every run until it does; one for an older shipped text than
//!   this build's is skipped (v2 takes only the current revision).
//!
//! IDEMPOTENCE
//!   The v2 server keeps its own chain per subject and takes no client hash, so the guarantee
//!   is client-side: a cursor (`sent_seq` + the hash of that receipt) in
//!   `consent-ledger.bcv2.json`, advanced only after the server answered for that receipt. A
//!   network failure stops the run where it is and the next run starts from the same receipt.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, State};

use crate::commands::consent_ledger::{ledger_for, sha256_hex, Receipt};
use crate::state::AppState;

pub const V2_SYNC_FILE: &str = "consent-ledger.bcv2.json";
/// Production BetterCommunity, the root used when nothing else is configured.
pub const PROD_ROOT: &str = "https://bettercommunity.ch";
/// Receipts sent per run: a first sync after an import is bounded, the rest follows next time.
pub const BATCH: usize = 50;
const SUBJECT_SALT: &str = "bmm-consent-bcv2:";
const CROCKFORD: &[u8; 32] = b"0123456789abcdefghjkmnpqrstvwxyz";

/// A base BMM may send to: https anywhere, plain http only to this machine (a local v2).
pub fn base_allowed(base: &str) -> Option<String> {
    let b = base.trim().trim_end_matches('/');
    let u = reqwest::Url::parse(b).ok()?;
    let host = u.host_str()?.to_ascii_lowercase();
    let local = host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host == "::1" || host.ends_with(".localhost");
    if u.scheme() == "https" || (u.scheme() == "http" && local) {
        if u.query().is_some() || u.fragment().is_some() || !u.username().is_empty() {
            return None;
        }
        return Some(b.to_string());
    }
    None
}

/// The v2 root for this build, or None when app.cfg does not select v2 (the default).
/// `BCv2Base` wins; else the test base when `BCTestMode=true`; else production.
pub fn resolve_v2_root(api_version: &str, v2_base: &str, test_mode: bool, test_base: &str) -> Option<String> {
    if crate::commands::settings::bc_api_version_of(api_version) != "v2" {
        return None;
    }
    let pick = if !v2_base.trim().is_empty() {
        v2_base
    } else if test_mode && !test_base.trim().is_empty() {
        test_base
    } else {
        PROD_ROOT
    };
    base_allowed(pick)
}

/// The anonymous v2 subject of this install: `anon_` + 26 Crockford base32 characters
/// (contract `AnonSubject`). Derived from the random install id through a salted hash, so it is
/// stable for the install and is NOT the id the telemetry server sees: the two records cannot
/// be joined by equality.
pub fn anon_subject(install_id: &str) -> String {
    let h = sha256_hex(format!("{SUBJECT_SALT}{}", install_id.trim().to_ascii_lowercase()).as_bytes());
    let v = u128::from_str_radix(&h[..32], 16).unwrap_or(0);
    let mut out = String::from("anon_");
    for i in 0..26u32 {
        let shift = 5 * (25 - i);
        out.push(CROCKFORD[((v >> shift) & 31) as usize] as char);
    }
    out
}

/// A category key as v2 accepts it (`^[a-z][a-z0-9_]{0,39}$`).
fn v2_category(k: &str) -> Option<String> {
    let k: String = k.trim().to_ascii_lowercase().replace('-', "_").chars().take(40).collect();
    let mut cs = k.chars();
    let first = cs.next()?;
    (first.is_ascii_lowercase() && k.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')).then_some(k)
}

/// What becomes of one receipt in v2.
#[derive(Debug, Clone, PartialEq)]
pub enum V2Mapped {
    /// The body of `POST /v2/consents`.
    Send(Value),
    /// A Terms / Privacy answer: kept back until v2 publishes BMM's texts (see the module note).
    Deferred,
    /// Nothing to say in v2 (`reset`, an unknown doc): skipped for good.
    Skip,
}

/// One BMM receipt → the v2 consent ledger body (contract `recordConsent`, strict object).
pub fn receipt_to_v2(r: &Receipt, subject: &str) -> V2Mapped {
    let document = match r.doc.as_str() {
        "telemetry" => "app.telemetry",
        "crash_reports" => "app.crash_reports",
        "tos" | "privacy" => return V2Mapped::Deferred,
        _ => return V2Mapped::Skip,
    };
    let fill = |on: bool| -> serde_json::Map<String, Value> {
        let mut m: serde_json::Map<String, Value> =
            r.categories.keys().filter_map(|k| v2_category(k)).map(|k| (k, Value::Bool(on))).collect();
        if m.is_empty() {
            m.insert("all".into(), Value::Bool(on));
        }
        m
    };
    let categories = match r.choice.as_str() {
        "accepted" => fill(true),
        "declined" | "withdrawn" => fill(false),
        "custom" => {
            let m: serde_json::Map<String, Value> =
                r.categories.iter().filter_map(|(k, v)| v2_category(k).map(|k| (k, Value::Bool(*v)))).collect();
            if m.is_empty() {
                return V2Mapped::Skip;
            }
            m
        }
        _ => return V2Mapped::Skip, // `reset`: a local bookkeeping event, not an answer
    };
    let categories: serde_json::Map<String, Value> = categories.into_iter().take(20).collect();
    let language = if r.lang.trim().to_ascii_lowercase().starts_with("fr") { "fr" } else { "en" };
    let mut body = json!({
        "subject": subject,
        "kind": "categories",
        "document": document,
        "language": language,
        "choice": "categories",
        "categories": categories,
        "source": "app",
    });
    let ver: String = r.app_version.trim().chars().take(40).collect();
    if !ver.is_empty() {
        body["app_version"] = Value::String(ver);
    }
    V2Mapped::Send(body)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct V2SyncState {
    #[serde(default)]
    pub sent_seq: u64,
    #[serde(default)]
    pub sent_hash: String,
    #[serde(default)]
    pub sent: u64,
    #[serde(default)]
    pub rejected: u64,
    /// Seqs of Terms / Privacy receipts held back until v2 can take them.
    #[serde(default)]
    pub deferred: Vec<u64>,
    #[serde(default)]
    pub last_sent_at: String,
    #[serde(default)]
    pub last_error: String,
}

fn state_path(dir: &std::path::Path) -> PathBuf {
    dir.join(V2_SYNC_FILE)
}
pub fn read_state(dir: &std::path::Path) -> V2SyncState {
    std::fs::read_to_string(state_path(dir)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}
fn write_state(dir: &std::path::Path, st: &V2SyncState) {
    if let Ok(s) = serde_json::to_string_pretty(st) {
        let _ = std::fs::write(state_path(dir), s);
    }
}

/// The receipts after the cursor, oldest first, at most `BATCH`. A cursor whose hash no longer
/// matches the receipt at that seq (a ledger replaced by an import) starts over from the top:
/// sending a receipt twice is the lesser harm next to never sending one.
pub fn pending_after(receipts: &[Receipt], st: &V2SyncState) -> Vec<Receipt> {
    let cursor_ok = st.sent_seq == 0
        || receipts.iter().any(|r| r.seq == st.sent_seq && (st.sent_hash.is_empty() || r.hash == st.sent_hash));
    let from = if cursor_ok { st.sent_seq } else { 0 };
    let mut v: Vec<Receipt> = receipts.iter().filter(|r| r.seq > from).cloned().collect();
    v.sort_by_key(|r| r.seq);
    v.truncate(BATCH);
    v
}

/// What the server's answer means for the cursor.
#[derive(Debug, PartialEq)]
pub enum Outcome {
    Accepted,
    /// A refusal that will not change on retry (400/403/404/409/422): counted and passed.
    Rejected,
    /// Try again later from this receipt (network, 401 bad key, 408, 429, 5xx).
    Retry,
}
pub fn outcome_of(status: u16) -> Outcome {
    match status {
        200..=299 => Outcome::Accepted,
        401 | 408 | 429 => Outcome::Retry,
        400..=499 => Outcome::Rejected,
        _ => Outcome::Retry,
    }
}

/// A publishable v2 app key, the only credential this ever attaches (it ships in links.json).
pub fn app_key_ok(k: &str) -> bool {
    let k = k.trim();
    k.starts_with("bc_pk_") && (26..=200).contains(&k.len()) && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Send this install's consent receipts to the BetterCommunity v2 consent ledger.
///
/// No-op unless this session runs on v2 (the switch, then a passing health check:
/// `bc_v2_activate`) AND sending is allowed (telemetry consent on, or `force` from « Send to the
/// server »). `app_key` is the PUBLIC v2 app key (links.json `bc_v2_app_key`), optional: the
/// session's key is used when the caller gives none; without any the receipts are recorded for
/// the anonymous subject all the same.
///
/// Terms and Privacy receipts go as `kind: legal` once v2 publishes `bmm-terms` /
/// `bmm-privacy` in the very version this build ships (`legal_receipt_to_v2`); until then they
/// wait in `deferred` and are replayed first on every run.
#[tauri::command]
pub async fn consent_sync_bc_v2(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    app_key: Option<String>,
    force: Option<bool>,
) -> Result<Value, String> {
    let Some(root) = effective_v2_root() else {
        return Ok(json!({ "sent": 0, "skipped": "not_v2" }));
    };
    let allowed = force == Some(true) || state.data.lock().map(|d| d.settings.analytics_consent == Some(true)).unwrap_or(false);
    if !allowed {
        return Ok(json!({ "sent": 0, "skipped": "not_allowed" }));
    }
    let ledger = ledger_for(&state);
    let mut st = read_state(&ledger.dir);
    let all = ledger.receipts();
    let pending = pending_after(&all, &st);
    // Deferred legal receipts first (oldest first), then what is new since the cursor.
    let deferred: Vec<Receipt> = all.iter().filter(|r| st.deferred.contains(&r.seq)).cloned().collect();
    if pending.is_empty() && deferred.is_empty() {
        return Ok(json!({ "sent": 0, "pending": 0 }));
    }
    let subject = anon_subject(&ledger.install_id());
    let key = app_key.filter(|k| app_key_ok(k)).unwrap_or_else(|| runtime().app_key);
    // The published texts, read once, only when a legal receipt is on the list.
    let needs_docs = deferred.iter().chain(pending.iter()).any(|r| LEGAL_DOCS.iter().any(|(d, _)| *d == r.doc));
    let docs: Vec<V2Doc> = if needs_docs { fetch_documents(&root).await.unwrap_or_default() } else { Vec::new() };
    let shipped = if needs_docs { shipped_legal(&app_handle) } else { Vec::new() };
    let (mut sent, mut rejected) = (0u64, 0u64);
    let mut stop = false;

    // 1. The deferred legal receipts: sent when v2 now publishes their text, else kept.
    for r in &deferred {
        let mapped = legal_receipt_to_v2(r, &subject, &docs, &shipped);
        match mapped {
            V2Mapped::Deferred => continue,
            V2Mapped::Skip => st.deferred.retain(|s| *s != r.seq),
            V2Mapped::Send(body) => match post_consent(&root, &body, &key).await {
                Err(e) => {
                    st.last_error = e;
                    stop = true;
                    break;
                }
                Ok((status, _)) => match outcome_of(status) {
                    Outcome::Accepted => {
                        sent += 1;
                        st.deferred.retain(|s| *s != r.seq);
                    }
                    Outcome::Rejected => {
                        rejected += 1;
                        st.last_error = format!("http_{status} (receipt #{})", r.seq);
                        st.deferred.retain(|s| *s != r.seq);
                    }
                    Outcome::Retry => {
                        st.last_error = format!("http_{status}");
                        stop = true;
                        break;
                    }
                },
            },
        }
    }

    // 2. What is new since the cursor.
    if !stop {
        for r in &pending {
            let mapped = if LEGAL_DOCS.iter().any(|(d, _)| *d == r.doc) {
                legal_receipt_to_v2(r, &subject, &docs, &shipped)
            } else {
                receipt_to_v2(r, &subject)
            };
            match mapped {
                V2Mapped::Skip => {}
                V2Mapped::Deferred => {
                    if !st.deferred.contains(&r.seq) && st.deferred.len() < 500 {
                        st.deferred.push(r.seq);
                    }
                }
                V2Mapped::Send(body) => {
                    let status = match post_consent(&root, &body, &key).await {
                        Ok((s, _)) => s,
                        Err(e) => {
                            st.last_error = e;
                            break;
                        }
                    };
                    match outcome_of(status) {
                        Outcome::Accepted => sent += 1,
                        Outcome::Rejected => {
                            rejected += 1;
                            st.last_error = format!("http_{status} (receipt #{})", r.seq);
                        }
                        Outcome::Retry => {
                            st.last_error = format!("http_{status}");
                            break;
                        }
                    }
                }
            }
            st.sent_seq = r.seq;
            st.sent_hash = r.hash.clone();
        }
    }
    st.sent += sent;
    st.rejected += rejected;
    if sent > 0 {
        st.last_sent_at = chrono::Utc::now().to_rfc3339();
        if rejected == 0 {
            st.last_error.clear();
        }
    }
    write_state(&ledger.dir, &st);

    // 3. Re-acceptance answers that could not be sent when they were given.
    let mut legal = read_legal(&ledger.dir);
    if !legal.pending.is_empty() {
        let queued = std::mem::take(&mut legal.pending);
        write_legal(&ledger.dir, &legal);
        for q in queued {
            let doc = q["document"].as_str().unwrap_or("").to_string();
            let choice = q["choice"].as_str().unwrap_or("").to_string();
            let lang = q["lang"].as_str().map(str::to_string);
            let _ = bc_v2_legal_answer(state.clone(), app_handle.clone(), doc, choice, lang).await;
        }
    }
    Ok(json!({ "sent": sent, "rejected": rejected, "deferred": st.deferred.len(), "error": if st.last_error.is_empty() { Value::Null } else { Value::String(st.last_error.clone()) } }))
}

// ─────────────────────────────────────────────────────────────────────────────
// The switch at run time (BMM 1.0.4)
// ─────────────────────────────────────────────────────────────────────────────
//
// Precedence: app.cfg (`BCApiVersion` / `BCv2Base`) > links.json (`bc_api` / `bc_v2_base`) >
// v1. links.json is fetched at start (platform asset), so the day v2 goes live the owner flips
// `bc_api: "v2"` there and installed 1.0.4 copies follow without a new release. An explicit
// `BCApiVersion=v1` in app.cfg pins an install to v1 whatever links.json says.
//
// Safe by construction: v2 is used only after `GET <root>/v2/health` answered `ok` or
// `degraded` in this session. Any other answer, a refused base or no answer at all keeps the
// session on v1 and the reason is logged. Until `bc_v2_activate` ran, the runtime is v1.

/// What the switch asks for, before the health check.
#[derive(Debug, Clone, PartialEq)]
pub struct Switch {
    pub version: &'static str,
    pub base: String,
    /// `app.cfg`, `links.json` or `default`.
    pub source: &'static str,
}

/// app.cfg > links.json > v1, per key. `cfg_set`: app.cfg has a `BCApiVersion` line.
pub fn pick_switch(cfg_set: bool, cfg_version: &str, cfg_base: &str, links_version: &str, links_base: &str) -> Switch {
    let (version, source) = if cfg_set {
        (crate::commands::settings::bc_api_version_of(cfg_version), "app.cfg")
    } else if !links_version.trim().is_empty() {
        (crate::commands::settings::bc_api_version_of(links_version), "links.json")
    } else {
        ("v1", "default")
    };
    let base = if !cfg_base.trim().is_empty() { cfg_base.trim() } else { links_base.trim() };
    Switch { version, base: base.to_string(), source }
}

/// The session's BetterCommunity mode, as decided by `bc_v2_activate`. Public values only: the
/// app key is the publishable `bc_pk_` key links.json ships, the client id is public too.
#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct BcRuntime {
    /// `bc_v2_activate` ran in this session.
    pub activated: bool,
    /// The mode in force: `v1` or `v2`.
    pub version: String,
    /// What the switch asked for (`v2` with `fell_back` = the health check failed).
    pub requested: String,
    pub source: String,
    /// The v2 root in force (empty in v1).
    pub v2_root: String,
    pub fell_back: bool,
    pub reason: String,
    pub client_id: String,
    pub app_key: String,
    pub app_id: String,
}

fn runtime_cell() -> &'static std::sync::RwLock<BcRuntime> {
    static C: std::sync::OnceLock<std::sync::RwLock<BcRuntime>> = std::sync::OnceLock::new();
    C.get_or_init(|| std::sync::RwLock::new(BcRuntime { version: "v1".into(), requested: "v1".into(), source: "default".into(), ..Default::default() }))
}

/// The session's mode (v1 until activated).
pub fn runtime() -> BcRuntime {
    runtime_cell().read().map(|r| r.clone()).unwrap_or_default()
}

fn set_runtime(rt: BcRuntime) {
    if let Ok(mut w) = runtime_cell().write() {
        *w = rt;
    }
}

/// The v2 root when this session runs on v2 (health checked), else None. Every Rust caller that
/// talks to v2 goes through this, so a failed health check reaches all of them at once.
pub fn effective_v2_root() -> Option<String> {
    let r = runtime();
    (r.version == "v2" && !r.v2_root.is_empty()).then_some(r.v2_root)
}

/// An OAuth client id as the v2 contract takes it (`client_id` up to 64 characters).
pub fn client_id_ok(s: &str) -> bool {
    let s = s.trim();
    (1..=64).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

/// A v2 app id (`pid('app')`: `app_` and 26 Crockford base32 characters).
pub fn app_id_ok(s: &str) -> bool {
    let s = s.trim();
    s.len() == 30 && s.starts_with("app_") && s[4..].bytes().all(|c| CROCKFORD.contains(&c))
}

/// The health answer that lets a session use v2: 200 with `status` ok or degraded.
pub fn health_ok(status: u16, body: &Value) -> bool {
    status == 200 && matches!(body.get("status").and_then(Value::as_str), Some("ok") | Some("degraded"))
}

/// A client for v2 calls that carry or obtain a credential: no redirects (a 3xx never moves an
/// Authorization header or a token form to another host), a bounded timeout.
pub fn v2_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .user_agent(concat!("BetterModsManager/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

async fn health_check(root: &str) -> Result<(), String> {
    let resp = v2_client(6)?.get(format!("{root}/v2/health")).send().await.map_err(|e| format!("unreachable: {e}"))?;
    let status = resp.status().as_u16();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if health_ok(status, &body) {
        Ok(())
    } else {
        Err(format!("health http_{status}"))
    }
}

/// Decide this session's mode: apply the precedence, then check v2's health. Called by the
/// webview once links.json is loaded (`core/bc-v2.ts`). Never fails: a v2 that cannot be used
/// leaves the session on v1, logged, and the answer says why.
#[tauri::command]
pub async fn bc_v2_activate(
    app_handle: AppHandle,
    links_api: Option<String>,
    links_base: Option<String>,
    client_id: Option<String>,
    app_key: Option<String>,
    app_id: Option<String>,
) -> Result<BcRuntime, String> {
    let cfg = crate::commands::settings::get_bc_config(app_handle);
    let sw = pick_switch(cfg.api_version_set, &cfg.api_version, &cfg.v2_base, links_api.as_deref().unwrap_or(""), links_base.as_deref().unwrap_or(""));
    let mut rt = BcRuntime {
        activated: true,
        version: "v1".into(),
        requested: sw.version.into(),
        source: sw.source.into(),
        client_id: client_id.filter(|c| client_id_ok(c)).map(|c| c.trim().to_string()).unwrap_or_default(),
        app_key: app_key.filter(|k| app_key_ok(k)).map(|k| k.trim().to_string()).unwrap_or_default(),
        app_id: app_id.filter(|a| app_id_ok(a)).map(|a| a.trim().to_string()).unwrap_or_default(),
        ..Default::default()
    };
    if sw.version == "v2" {
        match resolve_v2_root("v2", &sw.base, cfg.test_mode, &cfg.base_url) {
            None => {
                rt.fell_back = true;
                rt.reason = "base_refused".into();
            }
            Some(root) => match health_check(&root).await {
                Ok(()) => {
                    rt.version = "v2".into();
                    rt.v2_root = root;
                }
                Err(e) => {
                    rt.fell_back = true;
                    rt.reason = e;
                }
            },
        }
        if rt.fell_back {
            crate::commands::crash::log_line(format!(
                "[BC] v2 requested by {} but not usable ({}): this session stays on v1",
                rt.source, rt.reason
            ));
        }
    }
    crate::commands::crash::log_line(format!(
        "[BC] mode {} (asked {} by {}){}",
        rt.version,
        rt.requested,
        rt.source,
        if rt.v2_root.is_empty() { String::new() } else { format!(", v2 root {}", rt.v2_root) }
    ));
    set_runtime(rt.clone());
    Ok(rt)
}

/// The session's mode, for the Settings card and the docs (no secret in it).
#[tauri::command]
pub fn bc_v2_runtime() -> BcRuntime {
    runtime()
}

// ─────────────────────────────────────────────────────────────────────────────
// Legal texts on v2 (ADR 0018 §4): BMM's Terms and Privacy Policy as `bmm-terms` / `bmm-privacy`
// ─────────────────────────────────────────────────────────────────────────────

/// BMM's local document and its v2 legal entry slug.
pub const LEGAL_DOCS: &[(&str, &str)] = &[("tos", "bmm-terms"), ("privacy", "bmm-privacy")];

/// One text as `GET /v2/consents/documents` lists it (contract `ConsentText`).
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct V2Doc {
    pub document: String,
    #[serde(default)]
    pub entry: String,
    pub version: String,
    pub revision: String,
    pub language: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub sha256: String,
    #[serde(default)]
    pub url: String,
}

/// A version label compared without its punctuation: « 2026-10-13 », « 2026.10.13 » and
/// « 2026.10.13. » are the same version.
pub fn norm_version(v: &str) -> String {
    v.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_ascii_lowercase()
}

/// The « Version N » a legal text states in its first lines (`**Version 2026-10-13**`, or the
/// v2 convention « Version 2026.10.13. » on the first line).
pub fn version_label(text: &str) -> Option<String> {
    for line in text.lines().take(12) {
        let l = line.trim().trim_start_matches(['*', '_', '#', ' ']);
        let Some(rest) = l.strip_prefix("Version ").or_else(|| l.strip_prefix("version ")) else { continue };
        let v: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-')).collect();
        let v = v.trim_end_matches(['.', '-']).to_string();
        if v.chars().any(|c| c.is_ascii_digit()) {
            return Some(v);
        }
    }
    None
}

/// The text of `slug` to answer with: the person's language, else English, else the first.
pub fn pick_doc<'a>(docs: &'a [V2Doc], slug: &str, lang: &str) -> Option<&'a V2Doc> {
    let l = if lang.trim().to_ascii_lowercase().starts_with("fr") { "fr" } else { "en" };
    let of = || docs.iter().filter(move |d| d.document == slug);
    of().find(|d| d.language == l).or_else(|| of().find(|d| d.language == "en")).or_else(|| of().next())
}

/// Where one BMM text stands against what v2 publishes.
/// `unpublished`: v2 has no such text (nothing to do). `current`: v2 publishes the version this
/// build ships, so the start-up window's answer covers it. `accepted`: the person already
/// answered yes to the published version through v2. `pending`: v2 publishes another version
/// than the one shipped and nobody accepted it here: ask again.
pub fn legal_state(shipped: Option<&str>, published: Option<&str>, accepted_v2: &[String]) -> &'static str {
    let Some(p) = published.map(norm_version).filter(|p| !p.is_empty()) else { return "unpublished" };
    if shipped.map(norm_version).as_deref() == Some(p.as_str()) {
        return "current";
    }
    if accepted_v2.iter().any(|a| norm_version(a) == p) {
        return "accepted";
    }
    "pending"
}

async fn fetch_documents(root: &str) -> Result<Vec<V2Doc>, String> {
    let slugs: Vec<&str> = LEGAL_DOCS.iter().map(|(_, s)| *s).collect();
    let url = format!("{root}/v2/consents/documents?documents={}", slugs.join(","));
    let resp = v2_client(10)?.get(url).send().await.map_err(|e| format!("network: {e}"))?;
    let status = resp.status().as_u16();
    if status != 200 {
        return Err(format!("http_{status}"));
    }
    let v: Value = resp.json().await.map_err(|_| "bad_json".to_string())?;
    Ok(serde_json::from_value(v.get("documents").cloned().unwrap_or(Value::Array(vec![]))).unwrap_or_default())
}

/// The « Version N » of the text this build ships (`TOS.md`, `PRIVACY.md`).
fn shipped_label(app: &AppHandle, doc: &str) -> Option<String> {
    let text = match doc {
        "tos" => crate::commands::settings::get_eula_text(app.clone(), "en".into()).ok()?,
        "privacy" => crate::commands::settings::get_privacy_text(app.clone(), "en".into()).ok()?,
        _ => return None,
    };
    version_label(&text)
}

/// Per local document: (doc, version hash in force, « Version N » of the shipped text).
fn shipped_legal(app: &AppHandle) -> Vec<(String, String, Option<String>)> {
    LEGAL_DOCS
        .iter()
        .map(|(doc, _)| {
            let hash = crate::commands::consent_ledger::current_version(app, doc).unwrap_or_default();
            (doc.to_string(), hash, shipped_label(app, doc))
        })
        .collect()
}

/// One local Terms / Privacy receipt as the v2 legal receipt, when v2 publishes the very version
/// the receipt answered. `shipped`: (doc, version hash in force, « Version N » of that text).
/// A receipt for an older shipped text is skipped (v2 refuses any revision but the current one),
/// a receipt whose text v2 does not publish (yet) stays deferred.
pub fn legal_receipt_to_v2(r: &Receipt, subject: &str, docs: &[V2Doc], shipped: &[(String, String, Option<String>)]) -> V2Mapped {
    let Some((_, slug)) = LEGAL_DOCS.iter().find(|(d, _)| *d == r.doc) else { return V2Mapped::Skip };
    let choice = match r.choice.as_str() {
        "accepted" => "accepted",
        "declined" | "withdrawn" => "refused",
        _ => return V2Mapped::Skip,
    };
    let Some(d) = pick_doc(docs, slug, &r.lang) else { return V2Mapped::Deferred };
    let Some((_, hash_now, label)) = shipped.iter().find(|(doc, _, _)| *doc == r.doc) else { return V2Mapped::Deferred };
    if hash_now.is_empty() || r.version != *hash_now {
        return V2Mapped::Skip; // an older text than this build ships: v2 cannot take it
    }
    if label.as_deref().map(norm_version) != Some(norm_version(&d.version)) {
        return V2Mapped::Deferred; // v2 publishes another version than the one answered
    }
    let mut body = json!({
        "subject": subject,
        "kind": "legal",
        "document": slug,
        "revision": d.revision,
        "language": d.language,
        "choice": choice,
        "source": if r.source == "reconsent" { "reaccept" } else { "app" },
    });
    let ver: String = r.app_version.trim().chars().take(40).collect();
    if !ver.is_empty() {
        body["app_version"] = Value::String(ver);
    }
    V2Mapped::Send(body)
}

/// The legal answers given through v2 (the re-acceptance prompt), kept on this PC: the server's
/// receipt as it answered it (its chain hash included), append-only and capped.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct V2LegalAnswers {
    #[serde(default)]
    pub answers: Vec<Value>,
    /// Answers given while v2 could not be reached, sent at the next run.
    #[serde(default)]
    pub pending: Vec<Value>,
}
pub const V2_LEGAL_FILE: &str = "consent-ledger.bcv2-legal.json";

fn read_legal(dir: &std::path::Path) -> V2LegalAnswers {
    std::fs::read_to_string(dir.join(V2_LEGAL_FILE)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}
fn write_legal(dir: &std::path::Path, l: &V2LegalAnswers) {
    if let Ok(s) = serde_json::to_string_pretty(l) {
        let _ = std::fs::write(dir.join(V2_LEGAL_FILE), s);
    }
}

/// The versions of `slug` accepted through v2 on this install.
fn accepted_versions(l: &V2LegalAnswers, slug: &str) -> Vec<String> {
    l.answers
        .iter()
        .filter(|a| a["document"] == slug && a["choice"] == "accepted")
        .filter_map(|a| a["version"].as_str().map(str::to_string))
        .collect()
}

/// Where BMM's Terms and Privacy Policy stand on v2 (v2 mode only; v1: `{ "skipped": "not_v2" }`).
/// For the re-acceptance prompt (`core/bc-v2-legal.ts`).
#[tauri::command]
pub async fn bc_v2_legal_status(state: State<'_, AppState>, app_handle: AppHandle, lang: Option<String>) -> Result<Value, String> {
    let Some(root) = effective_v2_root() else { return Ok(json!({ "skipped": "not_v2" })) };
    let docs = fetch_documents(&root).await?;
    let ledger = ledger_for(&state);
    let answers = read_legal(&ledger.dir);
    let lang = lang.unwrap_or_default();
    let mut out = Vec::new();
    for (doc, slug) in LEGAL_DOCS {
        let shipped = shipped_label(&app_handle, doc);
        let d = pick_doc(&docs, slug, &lang).cloned();
        let st = legal_state(shipped.as_deref(), d.as_ref().map(|d| d.version.as_str()), &accepted_versions(&answers, slug));
        out.push(json!({ "doc": doc, "document": slug, "state": st, "shipped": shipped, "text": d }));
    }
    Ok(json!({ "documents": out }))
}

/// The answer to a re-acceptance prompt: `POST /v2/consents` (`kind: legal`, `source: reaccept`)
/// for the revision v2 publishes now, recorded for this install's anonymous subject. The server's
/// receipt is kept here (`consent-ledger.bcv2-legal.json`); offline, the answer waits there and
/// goes at the next call. `409 consent.text_outdated` (the text changed meanwhile): `outdated`,
/// the prompt asks again with the new text.
#[tauri::command]
pub async fn bc_v2_legal_answer(state: State<'_, AppState>, app_handle: AppHandle, document: String, choice: String, lang: Option<String>) -> Result<Value, String> {
    let Some(root) = effective_v2_root() else { return Ok(json!({ "skipped": "not_v2" })) };
    if !LEGAL_DOCS.iter().any(|(_, s)| *s == document) {
        return Err("unknown document".into());
    }
    let choice = match choice.as_str() {
        "accepted" => "accepted",
        "refused" | "declined" => "refused",
        _ => return Err("unknown choice".into()),
    };
    let docs = fetch_documents(&root).await?;
    let Some(d) = pick_doc(&docs, &document, lang.as_deref().unwrap_or("")).cloned() else { return Ok(json!({ "state": "unpublished" })) };
    let ledger = ledger_for(&state);
    let subject = anon_subject(&ledger.install_id());
    let body = json!({
        "subject": subject,
        "kind": "legal",
        "document": document,
        "revision": d.revision,
        "language": d.language,
        "choice": choice,
        "source": "reaccept",
        "app_version": app_handle.package_info().version.to_string(),
    });
    let mut l = read_legal(&ledger.dir);
    let r = post_consent(&root, &body, &runtime().app_key).await;
    let out = match r {
        Ok((201, receipt)) | Ok((200, receipt)) => {
            let mut kept = json!({ "document": document, "version": d.version, "revision": d.revision, "language": d.language, "choice": choice, "at": chrono::Utc::now().to_rfc3339() });
            if let Some(h) = receipt.get("hash") {
                kept["server_hash"] = h.clone();
            }
            if let Some(s) = receipt.get("seq") {
                kept["server_seq"] = s.clone();
            }
            l.answers.push(kept);
            json!({ "state": "recorded" })
        }
        Ok((409, _)) => json!({ "state": "outdated" }),
        Ok((s, _)) => json!({ "state": "refused", "status": s }),
        Err(e) => {
            if l.pending.len() < 20 {
                l.pending.push(json!({ "document": document, "choice": choice, "lang": lang, "at": chrono::Utc::now().to_rfc3339() }));
            }
            json!({ "state": "queued", "error": e })
        }
    };
    if l.answers.len() > 200 {
        let cut = l.answers.len() - 200;
        l.answers.drain(0..cut);
    }
    write_legal(&ledger.dir, &l);
    Ok(out)
}

/// The v2 answers kept on this PC, for « My consents ».
#[tauri::command]
pub fn bc_v2_legal_answers(state: State<'_, AppState>) -> Value {
    let l = read_legal(&ledger_for(&state).dir);
    json!({ "answers": l.answers, "pending": l.pending.len() })
}

/// POST one receipt; (status, body) on an answer, Err on no answer.
async fn post_consent(root: &str, body: &Value, app_key: &str) -> Result<(u16, Value), String> {
    let mut req = v2_client(10)?.post(format!("{root}/v2/consents")).json(body);
    if app_key_ok(app_key) {
        req = req.header(reqwest::header::AUTHORIZATION, format!("Bearer {}", app_key.trim()));
    }
    let resp = req.send().await.map_err(|e| format!("network: {e}"))?;
    let status = resp.status().as_u16();
    Ok((status, resp.json().await.unwrap_or(Value::Null)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn receipt(seq: u64, doc: &str, choice: &str, cats: &[(&str, bool)]) -> Receipt {
        Receipt {
            schema: 1,
            seq,
            id: format!("id-{seq}"),
            install_id: "0123456789abcdef0123456789abcdef".into(),
            doc: doc.into(),
            version: "2026-10-13".into(),
            lang: "fr-FR".into(),
            choice: choice.into(),
            categories: cats.iter().map(|(k, v)| (k.to_string(), *v)).collect::<BTreeMap<_, _>>(),
            source: "settings".into(),
            app_version: "1.2.3".into(),
            at: "2026-10-13T10:00:00.000Z".into(),
            hash: format!("h{seq}"),
            ..Default::default()
        }
    }

    #[test]
    fn v1_is_the_default_and_v2_needs_the_line() {
        assert_eq!(resolve_v2_root("", "", false, ""), None);
        assert_eq!(resolve_v2_root("v1", "https://v2.example", false, ""), None);
        assert_eq!(resolve_v2_root("nonsense", "https://v2.example", false, ""), None);
        assert_eq!(resolve_v2_root("v2", "", false, "").as_deref(), Some(PROD_ROOT));
        assert_eq!(resolve_v2_root("V2", "https://v2.example/", false, "").as_deref(), Some("https://v2.example"));
        assert_eq!(resolve_v2_root("2", "", true, "http://localhost:5176").as_deref(), Some("http://localhost:5176"));
    }

    #[test]
    fn plaintext_to_a_remote_host_is_refused() {
        assert_eq!(resolve_v2_root("v2", "http://v2.example", false, ""), None);
        assert_eq!(base_allowed("http://127.0.0.1:8080").as_deref(), Some("http://127.0.0.1:8080"));
        assert_eq!(base_allowed("http://bc.localhost").as_deref(), Some("http://bc.localhost"));
        assert_eq!(base_allowed("https://v2.example/?x=1"), None);
        assert_eq!(base_allowed("https://user@v2.example"), None);
        assert_eq!(base_allowed("ftp://v2.example"), None);
    }

    #[test]
    fn the_subject_matches_the_contract_and_is_not_the_install_id() {
        let s = anon_subject("0123456789abcdef0123456789abcdef");
        assert!(s.starts_with("anon_") && s.len() == 31, "{s}");
        assert!(s[5..].chars().all(|c| "0123456789abcdefghjkmnpqrstvwxyz".contains(c)), "{s}");
        assert_eq!(s, anon_subject("0123456789ABCDEF0123456789ABCDEF"), "stable for the install");
        assert_ne!(s, anon_subject("0123456789abcdef0123456789abcdee"));
        assert!(!s.contains("0123456789abcdef"));
    }

    #[test]
    fn telemetry_answers_become_category_receipts() {
        let sub = anon_subject("x");
        let V2Mapped::Send(b) = receipt_to_v2(&receipt(1, "telemetry", "custom", &[("usage", true), ("Errors", false), ("bad key!", true)]), &sub) else { panic!() };
        assert_eq!(b["kind"], "categories");
        assert_eq!(b["choice"], "categories");
        assert_eq!(b["document"], "app.telemetry");
        assert_eq!(b["language"], "fr");
        assert_eq!(b["source"], "app");
        assert_eq!(b["app_version"], "1.2.3");
        assert_eq!(b["categories"], json!({ "usage": true, "errors": false }));
        // strict object on the server: nothing it does not know
        let keys: Vec<&String> = b.as_object().unwrap().keys().collect();
        for k in keys {
            assert!(["subject", "kind", "document", "language", "choice", "categories", "source", "app_version"].contains(&k.as_str()), "{k}");
        }
    }

    #[test]
    fn accept_and_decline_fill_every_category() {
        let V2Mapped::Send(a) = receipt_to_v2(&receipt(1, "telemetry", "accepted", &[]), "anon_x") else { panic!() };
        assert_eq!(a["categories"], json!({ "all": true }));
        let V2Mapped::Send(d) = receipt_to_v2(&receipt(2, "crash_reports", "withdrawn", &[("errors", true)]), "anon_x") else { panic!() };
        assert_eq!(d["document"], "app.crash_reports");
        assert_eq!(d["categories"], json!({ "errors": false }));
    }

    #[test]
    fn legal_answers_wait_and_resets_are_not_sent() {
        assert_eq!(receipt_to_v2(&receipt(1, "tos", "accepted", &[]), "anon_x"), V2Mapped::Deferred);
        assert_eq!(receipt_to_v2(&receipt(2, "privacy", "declined", &[]), "anon_x"), V2Mapped::Deferred);
        assert_eq!(receipt_to_v2(&receipt(3, "telemetry", "reset", &[]), "anon_x"), V2Mapped::Skip);
        assert_eq!(receipt_to_v2(&receipt(4, "telemetry", "custom", &[]), "anon_x"), V2Mapped::Skip);
    }

    #[test]
    fn the_cursor_resumes_and_restarts_on_a_foreign_ledger() {
        let rs: Vec<Receipt> = (1..=4).map(|i| receipt(i, "telemetry", "accepted", &[])).collect();
        let st = V2SyncState { sent_seq: 2, sent_hash: "h2".into(), ..Default::default() };
        assert_eq!(pending_after(&rs, &st).iter().map(|r| r.seq).collect::<Vec<_>>(), vec![3, 4]);
        let moved = V2SyncState { sent_seq: 2, sent_hash: "other".into(), ..Default::default() };
        assert_eq!(pending_after(&rs, &moved).len(), 4);
        let many: Vec<Receipt> = (1..=120).map(|i| receipt(i, "telemetry", "accepted", &[])).collect();
        assert_eq!(pending_after(&many, &V2SyncState::default()).len(), BATCH);
    }

    #[test]
    fn retry_only_what_can_change() {
        assert_eq!(outcome_of(201), Outcome::Accepted);
        assert_eq!(outcome_of(409), Outcome::Rejected);
        assert_eq!(outcome_of(422), Outcome::Rejected);
        assert_eq!(outcome_of(429), Outcome::Retry);
        assert_eq!(outcome_of(401), Outcome::Retry);
        assert_eq!(outcome_of(503), Outcome::Retry);
    }

    #[test]
    fn only_a_publishable_key_is_attached() {
        assert!(app_key_ok("bc_pk_0123456789abcdefghijklmn"));
        assert!(!app_key_ok("bc_sk_0123456789abcdefghijklmn"));
        assert!(!app_key_ok("bc_pk_short"));
        assert!(!app_key_ok("bc_pk_0123456789abcdefghij\r\nX: y"));
    }
    // ── 1.0.4: the remote switch, the health gate, the legal texts ──────────────────────────

    #[test]
    fn app_cfg_wins_over_links_json_which_wins_over_v1() {
        // nothing anywhere: v1
        assert_eq!(pick_switch(false, "v1", "", "", "").version, "v1");
        assert_eq!(pick_switch(false, "v1", "", "", "").source, "default");
        // links.json alone selects v2, and its base is used
        let s = pick_switch(false, "v1", "", "v2", "https://v2.example");
        assert_eq!((s.version, s.source, s.base.as_str()), ("v2", "links.json", "https://v2.example"));
        // an explicit app.cfg line pins the install, either way
        assert_eq!(pick_switch(true, "v1", "", "v2", "https://v2.example").version, "v1");
        assert_eq!(pick_switch(true, "v2", "", "v1", "").version, "v2");
        assert_eq!(pick_switch(true, "v2", "", "", "").source, "app.cfg");
        // the base: app.cfg first, links.json next
        assert_eq!(pick_switch(false, "", "https://cfg.example", "v2", "https://links.example").base, "https://cfg.example");
        // anything but v2 / 2 in links.json is v1
        assert_eq!(pick_switch(false, "", "", "yes", "").version, "v1");
    }

    #[test]
    fn only_a_healthy_v2_is_used() {
        assert!(health_ok(200, &json!({ "status": "ok", "checks": {} })));
        assert!(health_ok(200, &json!({ "status": "degraded" })));
        assert!(!health_ok(503, &json!({ "status": "degraded" })));
        assert!(!health_ok(200, &json!({ "status": "down" })));
        assert!(!health_ok(200, &Value::Null), "an HTML page answering 200 is not v2");
    }

    #[test]
    fn the_runtime_is_v1_until_activated() {
        let r = runtime();
        assert_eq!(r.version, "v1");
        assert_eq!(effective_v2_root(), None);
    }

    #[test]
    fn public_ids_are_checked_before_use() {
        assert!(client_id_ok("bmm-desktop"));
        assert!(!client_id_ok("a b"));
        assert!(!client_id_ok(&"x".repeat(65)));
        assert!(app_id_ok("app_0123456789abcdefghjkmnpqrs"));
        assert!(!app_id_ok("app_0123456789abcdefghjkmnpqri"), "i is not Crockford");
        assert!(!app_id_ok("usr_0123456789abcdefghjkmnpqrs"));
    }

    #[test]
    fn version_labels_read_both_conventions() {
        assert_eq!(version_label("# Terms

**Version 2026-10-13** (BMM 1.0.2)").as_deref(), Some("2026-10-13"));
        assert_eq!(version_label("Version 2026.10.13.
Body").as_deref(), Some("2026.10.13"));
        assert_eq!(version_label("No version here"), None);
        assert_eq!(norm_version("2026-10-13"), norm_version("2026.10.13."));
    }

    fn doc(slug: &str, lang: &str, version: &str) -> V2Doc {
        V2Doc { document: slug.into(), version: version.into(), revision: format!("{:0>8}", lang.len()), language: lang.into(), ..Default::default() }
    }

    #[test]
    fn the_legal_state_decides_whether_to_ask_again() {
        assert_eq!(legal_state(Some("2026-10-13"), None, &[]), "unpublished");
        assert_eq!(legal_state(Some("2026-10-13"), Some("2026.10.13"), &[]), "current");
        assert_eq!(legal_state(Some("2026-10-13"), Some("2026.11.01"), &[]), "pending");
        assert_eq!(legal_state(Some("2026-10-13"), Some("2026.11.01"), &["2026-11-01".into()]), "accepted");
        assert_eq!(legal_state(None, Some("2026.11.01"), &[]), "pending");
    }

    #[test]
    fn the_answer_language_falls_back_to_english() {
        let docs = vec![doc("bmm-terms", "en", "1"), doc("bmm-terms", "fr", "1"), doc("bmm-privacy", "en", "1")];
        assert_eq!(pick_doc(&docs, "bmm-terms", "fr-FR").unwrap().language, "fr");
        assert_eq!(pick_doc(&docs, "bmm-privacy", "fr").unwrap().language, "en");
        assert!(pick_doc(&docs, "terms", "en").is_none());
    }

    #[test]
    fn legal_receipts_go_only_for_the_published_version() {
        let mut r = receipt(1, "tos", "accepted", &[]);
        r.version = "hash-now".into();
        let shipped = vec![("tos".to_string(), "hash-now".to_string(), Some("2026-10-13".to_string()))];
        let docs = vec![doc("bmm-terms", "fr", "2026.10.13")];
        let V2Mapped::Send(b) = legal_receipt_to_v2(&r, "anon_x", &docs, &shipped) else { panic!() };
        assert_eq!(b["kind"], "legal");
        assert_eq!(b["document"], "bmm-terms");
        assert_eq!(b["choice"], "accepted");
        assert_eq!(b["language"], "fr");
        assert_eq!(b["revision"], docs[0].revision);
        assert_eq!(b["source"], "app");
        for k in b.as_object().unwrap().keys() {
            assert!(["subject", "kind", "document", "revision", "language", "choice", "source", "app_version"].contains(&k.as_str()), "{k}");
        }
        // not published yet: wait
        assert_eq!(legal_receipt_to_v2(&r, "anon_x", &[], &shipped), V2Mapped::Deferred);
        // v2 publishes another version: wait
        assert_eq!(legal_receipt_to_v2(&r, "anon_x", &[doc("bmm-terms", "en", "2027.01.01")], &shipped), V2Mapped::Deferred);
        // an older shipped text: never
        let mut old = r.clone();
        old.version = "hash-before".into();
        assert_eq!(legal_receipt_to_v2(&old, "anon_x", &docs, &shipped), V2Mapped::Skip);
        // a refusal is a refusal, a reset is nothing
        let mut no = r.clone();
        no.choice = "declined".into();
        let V2Mapped::Send(b) = legal_receipt_to_v2(&no, "anon_x", &docs, &shipped) else { panic!() };
        assert_eq!(b["choice"], "refused");
        let mut reset = r.clone();
        reset.choice = "reset".into();
        assert_eq!(legal_receipt_to_v2(&reset, "anon_x", &docs, &shipped), V2Mapped::Skip);
        // a re-asked answer is a reaccept
        let mut re = r;
        re.source = "reconsent".into();
        let V2Mapped::Send(b) = legal_receipt_to_v2(&re, "anon_x", &docs, &shipped) else { panic!() };
        assert_eq!(b["source"], "reaccept");
    }
}
