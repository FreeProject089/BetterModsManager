//! BetterCommunity v2 readiness: the Rust half of the switchable BC client.
//!
//! WHAT IS HERE
//!   * `resolve_v2_root`: where BetterCommunity v2 lives, from app.cfg (`BCApiVersion`,
//!     `BCv2Base`, falling back to the v1 root), and only when `BCApiVersion=v2`. With the
//!     line absent — every install today — nothing in this file talks to anything.
//!   * The consent-ledger adapter: BMM's local receipts (consent_ledger.rs) mapped to the v2
//!     consent ledger's `POST /v2/consents` (contract: BetterCommunity-v2
//!     packages/contracts/src/consents.ts, ADR 0011), for an ANONYMOUS subject derived from the
//!     install id, and the command that sends them.
//!
//! WHAT LEAVES THE MACHINE, AND WHEN
//!   Exactly the rule of `consent_sync` (the telemetry server copy): nothing unless telemetry
//!   consent is on (`analytics_consent == Some(true)`) or the user pressed « Send to the server »
//!   in My consents (`force`). On top of that, nothing unless app.cfg says `BCApiVersion=v2`.
//!   Per receipt: the scope (`app.telemetry` / `app.crash_reports`), the per-category booleans,
//!   the language (fr/en), `source: app` and the app version. No IP, no Creator ID, no text, no
//!   path, no local hash or MAC (the v2 contract is a strict object: it would refuse them).
//!
//! WHAT IS NOT SENT YET
//!   Receipts for the Terms and the Privacy Policy. v2 records a `legal` answer only for a text
//!   it publishes itself (`document` = an entry slug, `revision` = the revision shown; anything
//!   else is `409 consent.text_outdated`). BMM's EULA and privacy notice are not v2 entries, so
//!   those receipts are kept back (`deferred`) and replayed once v2 publishes them and BMM shows
//!   their revision. Listed in BC-v2-readiness.md under "what BC v2 still needs".
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
/// No-op unless app.cfg selects v2 AND sending is allowed (telemetry consent on, or `force` from
/// « Send to the server »). `app_key` is the PUBLIC v2 app key from links.json (`bc_v2_app_key`),
/// optional: without one the receipts are recorded for the anonymous subject all the same.
#[tauri::command]
pub async fn consent_sync_bc_v2(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    app_key: Option<String>,
    force: Option<bool>,
) -> Result<Value, String> {
    let cfg = crate::commands::settings::get_bc_config(app_handle);
    let Some(root) = resolve_v2_root(&cfg.api_version, &cfg.v2_base, cfg.test_mode, &cfg.base_url) else {
        return Ok(json!({ "sent": 0, "skipped": "not_v2" }));
    };
    let allowed = force == Some(true) || state.data.lock().map(|d| d.settings.analytics_consent == Some(true)).unwrap_or(false);
    if !allowed {
        return Ok(json!({ "sent": 0, "skipped": "not_allowed" }));
    }
    let ledger = ledger_for(&state);
    let mut st = read_state(&ledger.dir);
    let pending = pending_after(&ledger.receipts(), &st);
    if pending.is_empty() {
        return Ok(json!({ "sent": 0, "pending": 0 }));
    }
    let subject = anon_subject(&ledger.install_id());
    let url = format!("{root}/v2/consents");
    let key = app_key.filter(|k| app_key_ok(k));
    let (mut sent, mut rejected) = (0u64, 0u64);
    for r in &pending {
        match receipt_to_v2(r, &subject) {
            V2Mapped::Skip => {}
            V2Mapped::Deferred => {
                if !st.deferred.contains(&r.seq) && st.deferred.len() < 500 {
                    st.deferred.push(r.seq);
                }
            }
            V2Mapped::Send(body) => {
                let mut req = crate::commands::net::client()
                    .post(&url)
                    .header(reqwest::header::USER_AGENT, "BetterModsManager")
                    .timeout(std::time::Duration::from_secs(10))
                    .json(&body);
                if let Some(k) = key.as_deref() {
                    req = req.header(reqwest::header::AUTHORIZATION, format!("Bearer {}", k.trim()));
                }
                let status = match req.send().await {
                    Ok(resp) => resp.status().as_u16(),
                    Err(e) => {
                        st.last_error = format!("network: {e}");
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
    st.sent += sent;
    st.rejected += rejected;
    if sent > 0 {
        st.last_sent_at = chrono::Utc::now().to_rfc3339();
        if rejected == 0 {
            st.last_error.clear();
        }
    }
    write_state(&ledger.dir, &st);
    Ok(json!({ "sent": sent, "rejected": rejected, "deferred": st.deferred.len(), "error": if st.last_error.is_empty() { Value::Null } else { Value::String(st.last_error.clone()) } }))
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
}
