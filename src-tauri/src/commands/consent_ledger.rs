//! Proof of consent: the "My consents" ledger (Settings → Privacy).
//!
//! WHY
//!   Accepting the Terms, the Privacy Policy or telemetry used to leave a bare `true` behind
//!   (localStorage, `analytics_consent`). That says THAT something was accepted, not WHAT, WHEN,
//!   WHERE or in which language — and it is exactly as easy to write by hand as to earn. A
//!   receipt answers the five questions and cannot be edited quietly.
//!
//! THE RECEIPT
//!   doc (tos / privacy / telemetry / crash_reports), version (the canonical fingerprint of the
//!   document, or the consent text's own version), the SHA-256 of the exact text shown (the
//!   language-specific file, normalised the way `settings::fingerprint_text` normalises it, so a
//!   CRLF checkout is not a different text), language, choice (accepted / declined / custom /
//!   withdrawn / reset) with the per-category answers, timestamp, source (installer, first_run,
//!   reconsent, settings, link, api, cli, mcp, import), app version and an ANONYMOUS install id.
//!
//! THE INSTALL ID
//!   A random UUID made the first time a receipt is written (`consent-install-id`). Not derived
//!   from hardware or from the Creator ID: the live-errors `install_id` IS (sha256 of the
//!   Creator ID), so it is deliberately not reused here — a consent record must not become a
//!   way to recognise a machine.
//!
//! STORAGE (next to data.json; append-only)
//!   `consent-ledger.jsonl`  one receipt per line, never rewritten.
//!   `consent-ledger.key`    32 random bytes (hex) — the local MAC key.
//!   `consent-ledger.head`   {seq, hash, mac} of the newest line: deleting the newest lines is
//!                           what a hash chain alone cannot see (the BCWEB audit-chain lesson).
//!   `consent-ledger.sync.json` how far the server copy goes.
//!
//!   Each line carries `hash` = SHA-256 of a canonical text (`canonical`) that includes the
//!   previous line's hash, and `mac` = HMAC-SHA256(key, hash). Editing a line breaks its hash;
//!   removing or inserting one breaks the next line's `prev_hash`; recomputing the hashes after
//!   an edit still fails the MAC unless the key is used too. The key sits on the same disk, so
//!   this is tamper-EVIDENT against everything short of someone who reads the key and rewrites
//!   the whole file — which is why the server copy exists (telemetry v2 `POST /consents`), where
//!   rows are append-only and the hash is recomputed on arrival. The hash is public by design:
//!   anyone holding an export can recompute it without the key.
//!
//! WHAT LEAVES THE MACHINE
//!   Nothing, unless telemetry consent is on (`analytics_consent == Some(true)`) or the user
//!   presses « Send to the server » in My consents. Then: the receipts (no IP, no Creator ID,
//!   no text, no path), keyed by the random install id. A decline is therefore kept locally only
//!   unless sending was allowed.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, State};

use crate::state::AppState;

pub const LEDGER_FILE: &str = "consent-ledger.jsonl";
pub const KEY_FILE: &str = "consent-ledger.key";
pub const HEAD_FILE: &str = "consent-ledger.head";
pub const SYNC_FILE: &str = "consent-ledger.sync.json";
pub const INSTALL_ID_FILE: &str = "consent-install-id";
pub const SCHEMA: u32 = 1;
pub const GENESIS: &str = "0000000000000000000000000000000000000000000000000000000000000000";

/// The documents a receipt can be about.
pub const DOCS: &[&str] = &["tos", "privacy", "telemetry", "crash_reports"];
/// Where the answer was given. `app` is accepted on input and resolved to `first_run` /
/// `reconsent` from the ledger itself.
pub const SOURCES: &[&str] = &["installer", "first_run", "reconsent", "settings", "link", "api", "cli", "mcp", "import"];
pub const CHOICES: &[&str] = &["accepted", "declined", "custom", "withdrawn", "reset"];

/// Version of the telemetry consent text (the categories and what each sends). Bump it when the
/// dialog's categories change: every install that said yes is then asked again.
pub const TELEMETRY_VERSION: &str = "2026-10-13";
/// Version of the "send errors live" text (live_issues.rs).
pub const CRASH_REPORTS_VERSION: &str = "2026-10-13";

static WRITE_LOCK: Mutex<()> = Mutex::new(());

// ── Receipt ─────────────────────────────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Receipt {
    pub schema: u32,
    pub seq: u64,
    pub id: String,
    pub install_id: String,
    pub doc: String,
    pub version: String,
    /// SHA-256 (64 hex) of the normalised text shown; empty when the asker could not say.
    pub text_sha256: String,
    pub lang: String,
    pub choice: String,
    #[serde(default)]
    pub categories: BTreeMap<String, bool>,
    pub source: String,
    pub app_version: String,
    /// RFC 3339, UTC.
    pub at: String,
    #[serde(default)]
    pub note: String,
    pub prev_hash: String,
    pub hash: String,
    /// HMAC-SHA256(local key, hash). Local only: never sent.
    #[serde(default)]
    pub mac: String,
}

/// What a caller asks to record. Everything else (seq, ids, hashes, time) is the ledger's.
#[derive(Debug, Clone, Default)]
pub struct Draft {
    pub doc: String,
    pub version: String,
    pub text_sha256: String,
    pub lang: String,
    pub choice: String,
    pub categories: BTreeMap<String, bool>,
    pub source: String,
    pub app_version: String,
    pub note: String,
}

/// Printable, single-line, bounded. The canonical text is newline-separated, so a field that
/// could carry a newline could forge another field's position.
fn clean(s: &str, max: usize) -> String {
    s.chars().filter(|c| !c.is_control()).take(max).collect::<String>().trim().to_string()
}
fn clean_key(s: &str) -> Option<String> {
    let k: String = s.trim().chars().take(24).collect();
    (!k.is_empty() && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')).then_some(k)
}

/// The exact text hashed. Shared, byte for byte, with the telemetry server (consents.rs), which
/// recomputes it on arrival — change one and the vector test on both sides fails.
pub fn canonical(r: &Receipt) -> String {
    let cats: Vec<String> = r.categories.iter().map(|(k, v)| format!("{k}={}", if *v { 1 } else { 0 })).collect();
    [
        "bmm-consent-v1".to_string(),
        r.seq.to_string(),
        r.id.clone(),
        r.install_id.clone(),
        r.doc.clone(),
        r.version.clone(),
        r.text_sha256.clone(),
        r.lang.clone(),
        r.choice.clone(),
        cats.join(";"),
        r.source.clone(),
        r.app_version.clone(),
        r.at.clone(),
        r.note.clone(),
        r.prev_hash.clone(),
    ]
    .join("\n")
}

pub fn sha256_hex(b: &[u8]) -> String {
    use sha2::Digest;
    hex::encode(sha2::Sha256::digest(b))
}

pub fn receipt_hash(r: &Receipt) -> String {
    sha256_hex(canonical(r).as_bytes())
}

/// HMAC-SHA256 (RFC 2104) on top of sha2, so the crate graph does not grow for twelve lines.
pub fn hmac_sha256(key: &[u8], msg: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut k = [0u8; 64];
    if key.len() > 64 {
        k[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let mut ipad = [0x36u8; 64];
    let mut opad = [0x5cu8; 64];
    for i in 0..64 {
        ipad[i] ^= k[i];
        opad[i] ^= k[i];
    }
    let mut inner = Sha256::new();
    inner.update(ipad);
    inner.update(msg);
    let inner = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(opad);
    outer.update(inner);
    outer.finalize().into()
}

/// The full SHA-256 of a document as `settings::fingerprint_text` sees it (CRLF → LF, trailing
/// spaces trimmed). Its first 16 hex characters ARE that fingerprint (tested below), so a
/// receipt's text hash and the "accepted THIS text" key the UI already keeps agree.
pub fn text_hash(text: &str) -> String {
    let normalized: String = text.replace("\r\n", "\n").lines().map(|l| l.trim_end()).collect::<Vec<_>>().join("\n");
    sha256_hex(normalized.trim().as_bytes())
}

// ── The ledger on disk ──────────────────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Head {
    pub seq: u64,
    pub hash: String,
    pub mac: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Break {
    pub seq: u64,
    pub line: usize,
    /// unparsable | seq_gap | chain_broken | content_altered | mac_invalid | truncated | head_invalid
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct VerifyReport {
    pub ok: bool,
    pub count: usize,
    /// The MAC could be checked (the key file exists).
    pub mac_checked: bool,
    pub first_break: Option<Break>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SyncState {
    #[serde(default)]
    pub sent_seq: u64,
    #[serde(default)]
    pub last_sent_at: String,
    #[serde(default)]
    pub last_error: String,
}

pub struct Ledger {
    pub dir: PathBuf,
}

impl Ledger {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Ledger { dir: dir.into() }
    }
    fn p(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }

    /// The anonymous install id, made on first use. Random; never derived from the machine.
    pub fn install_id(&self) -> String {
        let path = self.p(INSTALL_ID_FILE);
        if let Ok(s) = std::fs::read_to_string(&path) {
            let s = s.trim();
            if s.len() == 32 && s.chars().all(|c| c.is_ascii_hexdigit()) {
                return s.to_ascii_lowercase();
            }
        }
        let id = uuid::Uuid::new_v4().simple().to_string();
        let _ = std::fs::create_dir_all(&self.dir);
        let _ = std::fs::write(&path, &id);
        id
    }

    fn read_key(&self) -> Option<Vec<u8>> {
        let s = std::fs::read_to_string(self.p(KEY_FILE)).ok()?;
        let k = hex::decode(s.trim()).ok()?;
        (k.len() == 32).then_some(k)
    }

    fn key_or_create(&self) -> Vec<u8> {
        if let Some(k) = self.read_key() {
            return k;
        }
        let mut k = [0u8; 32];
        use rand::RngCore;
        rand::thread_rng().fill_bytes(&mut k);
        let _ = std::fs::create_dir_all(&self.dir);
        let _ = std::fs::write(self.p(KEY_FILE), hex::encode(k));
        k.to_vec()
    }

    /// Every line, parsed or not (a line that does not parse is reported by `verify`).
    pub fn lines(&self) -> Vec<Result<Receipt, String>> {
        let Ok(s) = std::fs::read_to_string(self.p(LEDGER_FILE)) else { return Vec::new() };
        s.lines().filter(|l| !l.trim().is_empty()).map(|l| serde_json::from_str::<Receipt>(l).map_err(|e| e.to_string())).collect()
    }

    pub fn receipts(&self) -> Vec<Receipt> {
        self.lines().into_iter().filter_map(Result::ok).collect()
    }

    fn read_head(&self) -> Option<Head> {
        std::fs::read_to_string(self.p(HEAD_FILE)).ok().and_then(|s| serde_json::from_str(&s).ok())
    }

    /// Append one receipt. The only write the ledger has.
    pub fn append(&self, d: Draft, at: chrono::DateTime<chrono::Utc>) -> Result<Receipt, String> {
        let _g = WRITE_LOCK.lock().map_err(|_| "ledger lock".to_string())?;
        validate_draft(&d)?;
        std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let key = self.key_or_create();
        let install_id = self.install_id();
        let existing = self.receipts();
        let (seq, prev) = existing.last().map(|r| (r.seq + 1, r.hash.clone())).unwrap_or((1, GENESIS.to_string()));
        let mut r = Receipt {
            schema: SCHEMA,
            seq,
            id: uuid::Uuid::new_v4().to_string(),
            install_id,
            doc: clean(&d.doc, 32),
            version: clean(&d.version, 64),
            text_sha256: clean(&d.text_sha256, 64).to_ascii_lowercase(),
            lang: clean(&d.lang, 16),
            choice: clean(&d.choice, 16),
            categories: d.categories.iter().filter_map(|(k, v)| clean_key(k).map(|k| (k, *v))).take(16).collect(),
            source: clean(&d.source, 16),
            app_version: clean(&d.app_version, 40),
            at: at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            note: clean(&d.note, 200),
            prev_hash: prev,
            hash: String::new(),
            mac: String::new(),
        };
        r.hash = receipt_hash(&r);
        r.mac = hex::encode(hmac_sha256(&key, r.hash.as_bytes()));
        let line = serde_json::to_string(&r).map_err(|e| e.to_string())?;
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(self.p(LEDGER_FILE)).map_err(|e| e.to_string())?;
        f.write_all(format!("{line}\n").as_bytes()).map_err(|e| e.to_string())?;
        let _ = f.sync_all();
        let head = Head { seq: r.seq, hash: r.hash.clone(), mac: hex::encode(hmac_sha256(&key, format!("head:{}:{}", r.seq, r.hash).as_bytes())) };
        if let Ok(s) = serde_json::to_string(&head) {
            let tmp = self.p("consent-ledger.head.part");
            if std::fs::write(&tmp, s).is_ok() {
                let _ = std::fs::rename(&tmp, self.p(HEAD_FILE));
            }
        }
        Ok(r)
    }

    /// Walk the chain: seq contiguous from 1, each prev_hash = previous hash, each hash recomputes,
    /// each MAC verifies, and the head file does not point past the end.
    pub fn verify(&self) -> VerifyReport {
        let key = self.read_key();
        let lines = self.lines();
        let mut rep = VerifyReport { ok: true, count: lines.len(), mac_checked: key.is_some(), first_break: None };
        let mut prev = GENESIS.to_string();
        let mut last_seq = 0u64;
        let mut fail = |rep: &mut VerifyReport, seq: u64, line: usize, reason: &str| {
            if rep.first_break.is_none() {
                rep.first_break = Some(Break { seq, line, reason: reason.into() });
            }
            rep.ok = false;
        };
        for (i, l) in lines.iter().enumerate() {
            let line = i + 1;
            let r = match l {
                Ok(r) => r,
                Err(_) => {
                    fail(&mut rep, last_seq + 1, line, "unparsable");
                    break;
                }
            };
            if r.seq != last_seq + 1 {
                fail(&mut rep, r.seq, line, "seq_gap");
                break;
            }
            if r.prev_hash != prev {
                fail(&mut rep, r.seq, line, "chain_broken");
                break;
            }
            if receipt_hash(r) != r.hash {
                fail(&mut rep, r.seq, line, "content_altered");
                break;
            }
            if let Some(k) = &key {
                if hex::encode(hmac_sha256(k, r.hash.as_bytes())) != r.mac {
                    fail(&mut rep, r.seq, line, "mac_invalid");
                    break;
                }
            }
            prev = r.hash.clone();
            last_seq = r.seq;
        }
        if rep.ok {
            match (self.read_head(), &key) {
                (Some(h), Some(k)) => {
                    let good = hex::encode(hmac_sha256(k, format!("head:{}:{}", h.seq, h.hash).as_bytes())) == h.mac;
                    if !good {
                        fail(&mut rep, h.seq, lines.len(), "head_invalid");
                    } else if h.seq > last_seq || (h.seq == last_seq && h.seq > 0 && h.hash != prev) {
                        fail(&mut rep, h.seq, lines.len(), "truncated");
                    }
                }
                (None, _) if last_seq > 0 && key.is_some() => fail(&mut rep, last_seq, lines.len(), "head_invalid"),
                _ => {}
            }
        }
        rep
    }

    pub fn sync_state(&self) -> SyncState {
        std::fs::read_to_string(self.p(SYNC_FILE)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }
    pub fn save_sync_state(&self, s: &SyncState) {
        if let Ok(t) = serde_json::to_string(s) {
            let _ = std::fs::write(self.p(SYNC_FILE), t);
        }
    }
    /// Receipts the server does not have yet.
    pub fn pending(&self) -> Vec<Receipt> {
        let sent = self.sync_state().sent_seq;
        self.receipts().into_iter().filter(|r| r.seq > sent).collect()
    }
}

pub fn validate_draft(d: &Draft) -> Result<(), String> {
    if !DOCS.contains(&d.doc.as_str()) {
        return Err(format!("unknown document: {}", d.doc));
    }
    if !CHOICES.contains(&d.choice.as_str()) {
        return Err(format!("unknown choice: {}", d.choice));
    }
    if !SOURCES.contains(&d.source.as_str()) {
        return Err(format!("unknown source: {}", d.source));
    }
    if !d.text_sha256.is_empty() && !(d.text_sha256.len() == 64 && d.text_sha256.chars().all(|c| c.is_ascii_hexdigit())) {
        return Err("text_sha256 must be 64 hex characters".into());
    }
    Ok(())
}

// ── Status: is there proof for what is in force now? ────────────────────────────────────────
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DocStatus {
    pub doc: String,
    /// The version in force now (None = the document could not be read, so it cannot be checked).
    pub current_version: Option<String>,
    pub latest: Option<Receipt>,
    /// The newest receipt for this document accepts the version in force.
    pub proof: bool,
    /// Something is in force (or required) that no receipt proves: ask again.
    pub needs_reconsent: bool,
}

fn accepts(choice: &str) -> bool {
    matches!(choice, "accepted" | "custom")
}

/// Pure. `in_force`: for telemetry / crash reports, whether the processing is currently ON (a
/// consent that is off needs no proof). Legal documents are always in force.
pub fn doc_status(receipts: &[Receipt], doc: &str, current_version: Option<&str>, in_force: bool) -> DocStatus {
    let latest = receipts.iter().filter(|r| r.doc == doc).max_by_key(|r| r.seq).cloned();
    let proof = match (&latest, current_version) {
        (Some(r), Some(v)) => accepts(&r.choice) && r.version == v,
        // The document cannot be read: nothing to compare with; an accepting receipt counts.
        (Some(r), None) => accepts(&r.choice),
        (None, _) => false,
    };
    // A legal document that cannot be read is not asked about: there is nothing to show
    // (the UI keeps its "cannot verify → do not nag" rule).
    let unreadable_legal = current_version.is_none() && matches!(doc, "tos" | "privacy");
    let needs_reconsent = in_force && !proof && !unreadable_legal;
    DocStatus { doc: doc.to_string(), current_version: current_version.map(str::to_string), latest, proof, needs_reconsent }
}

/// `app` → `first_run` when the document was never answered on this install, else `reconsent`.
pub fn resolve_source(receipts: &[Receipt], doc: &str, source: &str) -> String {
    if source != "app" {
        return source.to_string();
    }
    if receipts.iter().any(|r| r.doc == doc) { "reconsent".into() } else { "first_run".into() }
}

/// The installer's receipt for a legal document is PROOF only if the text it hashed is one BMM
/// ships (the canonical file or a translation): then it is stamped with the canonical version.
/// Otherwise it is kept, marked unverified, and the document is asked again.
pub fn installer_version_for(shown_hash: &str, known: &[(String, String)], canonical_version: Option<&str>) -> String {
    let h = shown_hash.to_ascii_lowercase();
    if !h.is_empty() && known.iter().any(|(_, k)| *k == h) {
        if let Some(v) = canonical_version {
            return v.to_string();
        }
    }
    format!("unverified:{}", h.chars().take(16).collect::<String>())
}

/// The body `POST /consents` takes. The MAC stays home: it proves nothing to anyone without the key.
pub fn sync_payload(api_key: &str, install_id: &str, receipts: &[Receipt]) -> Value {
    let rs: Vec<Value> = receipts
        .iter()
        .map(|r| {
            let mut v = serde_json::to_value(r).unwrap_or(Value::Null);
            if let Some(o) = v.as_object_mut() {
                o.remove("mac");
            }
            v
        })
        .collect();
    json!({ "api_key": api_key, "install_id": install_id, "receipts": rs })
}

/// The `/consents` ingest URL beside the telemetry endpoint (`…/batch/` → `…/consents`).
pub fn consents_url(endpoint: &str) -> Option<String> {
    let base = endpoint.trim().trim_end_matches('/').trim_end_matches("/batch").trim_end_matches("/capture").trim_end_matches('/');
    if base.is_empty() {
        return None;
    }
    let url = format!("{base}/consents");
    crate::commands::analytics::endpoint_allowed(&url).then_some(url)
}

// ── App glue ────────────────────────────────────────────────────────────────────────────────
pub fn ledger_for(state: &AppState) -> Ledger {
    Ledger::new(state.data_path.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from(".")))
}

fn legal_versions(app: &AppHandle) -> (Option<String>, Option<String>) {
    let v = crate::commands::settings::legal_fingerprint(app.clone());
    (v.get("tos").and_then(Value::as_str).map(str::to_string), v.get("privacy").and_then(Value::as_str).map(str::to_string))
}

/// The version in force for a document.
pub fn current_version(app: &AppHandle, doc: &str) -> Option<String> {
    match doc {
        "tos" => legal_versions(app).0,
        "privacy" => legal_versions(app).1,
        "telemetry" => Some(TELEMETRY_VERSION.into()),
        "crash_reports" => Some(CRASH_REPORTS_VERSION.into()),
        _ => None,
    }
}

/// The exact legal text BMM shows in `lang` (same resolution as the dialog), hashed.
fn shown_legal_hash(app: &AppHandle, doc: &str, lang: &str) -> Option<String> {
    let text = match doc {
        "tos" => crate::commands::settings::get_eula_text(app.clone(), lang.to_string()).ok()?,
        "privacy" => crate::commands::settings::get_privacy_text(app.clone(), lang.to_string()).ok()?,
        _ => return None,
    };
    Some(text_hash(&text))
}

/// Hashes of every shipped variant of a legal document (the canonical file + each translation).
fn known_legal_hashes(app: &AppHandle, doc: &str) -> Vec<(String, String)> {
    let base = match doc {
        "tos" => "TOS",
        "privacy" => "PRIVACY",
        _ => return Vec::new(),
    };
    let mut out = Vec::new();
    for lang in ["", "EN", "FR", "DE", "ES", "IT", "PT", "PT-BR", "RU", "PL", "ZH", "JA"] {
        let name = if lang.is_empty() { format!("{base}.md") } else { format!("{base}_{lang}.md") };
        if let Some(p) = crate::fs_utils::resolve_path(app, &name) {
            if let Ok(t) = std::fs::read_to_string(&p) {
                out.push((name, text_hash(&t)));
            }
        }
    }
    out
}

/// What the frontend (and Rust callers) send to record an answer.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordInput {
    pub doc: String,
    pub choice: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub lang: Option<String>,
    #[serde(default)]
    pub categories: Option<BTreeMap<String, bool>>,
    /// The consent text exactly as it was on screen (telemetry dialogs). Hashed, never stored.
    #[serde(default)]
    pub shown_text: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

/// Record an answer: fills version, text hash, language and app version, then appends.
pub fn record(state: &AppState, app: &AppHandle, input: RecordInput) -> Result<Receipt, String> {
    let ledger = ledger_for(state);
    let lang = input
        .lang
        .clone()
        .filter(|l| !l.trim().is_empty())
        .or_else(|| state.data.lock().ok().map(|d| d.settings.language.clone()))
        .unwrap_or_default();
    let doc = input.doc.trim().to_string();
    let text_sha256 = match doc.as_str() {
        "tos" | "privacy" => shown_legal_hash(app, &doc, &lang).unwrap_or_default(),
        _ => input.shown_text.as_deref().map(text_hash).unwrap_or_default(),
    };
    let source = resolve_source(&ledger.receipts(), &doc, input.source.as_deref().unwrap_or("settings"));
    let d = Draft {
        version: current_version(app, &doc).unwrap_or_default(),
        doc,
        text_sha256,
        lang: clean(&lang, 16),
        choice: input.choice.trim().to_string(),
        categories: input.categories.unwrap_or_default(),
        source,
        app_version: app.package_info().version.to_string(),
        note: input.note.unwrap_or_default(),
    };
    let r = ledger.append(d, chrono::Utc::now())?;
    crate::commands::crash::log_line(format!("[CONSENT] #{} {} {} via {}", r.seq, r.doc, r.choice, r.source));
    Ok(r)
}

/// Best effort from Rust callers: a failed receipt is logged, never fails the answer itself
/// (the setting is the user's decision; the receipt is our record of it).
pub fn record_quiet(state: &AppState, app: &AppHandle, input: RecordInput) {
    if let Err(e) = record(state, app, input) {
        crate::commands::crash::log_line(format!("[CONSENT] receipt not written: {e}"));
    }
}

/// One receipt BetterInstaller wrote into the handoff (`consents`). See installer_handoff.rs.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct InstallerConsent {
    #[serde(default)]
    pub doc: String,
    #[serde(default)]
    pub text_sha256: String,
    #[serde(default)]
    pub lang: String,
    #[serde(default)]
    pub file: String,
    #[serde(default)]
    pub choice: String,
    #[serde(default)]
    pub categories: BTreeMap<String, bool>,
    #[serde(default)]
    pub at: String,
}

/// Record what the installer says was answered. Legal texts are checked against what BMM ships
/// (see `installer_version_for`); the telemetry answer is stamped with the version this build
/// ships, since the installer that asked it came in the same package.
pub fn record_installer(state: &AppState, app: &AppHandle, items: &[InstallerConsent]) -> usize {
    let ledger = ledger_for(state);
    let mut n = 0;
    for c in items.iter().take(16) {
        let doc = c.doc.trim();
        if !DOCS.contains(&doc) || !CHOICES.contains(&c.choice.trim()) {
            continue;
        }
        let h = c.text_sha256.trim().to_ascii_lowercase();
        let h = if h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit()) { h } else { String::new() };
        let version = match doc {
            "tos" | "privacy" => installer_version_for(&h, &known_legal_hashes(app, doc), current_version(app, doc).as_deref()),
            _ => current_version(app, doc).unwrap_or_default(),
        };
        let mut note = format!("installer: {}", clean(&c.file, 60));
        if !c.at.trim().is_empty() {
            note.push_str(&format!(" at {}", clean(&c.at, 40)));
        }
        let d = Draft {
            doc: doc.to_string(),
            version,
            text_sha256: h,
            lang: clean(&c.lang, 16),
            choice: c.choice.trim().to_string(),
            categories: c.categories.clone(),
            source: "installer".into(),
            app_version: app.package_info().version.to_string(),
            note,
        };
        match ledger.append(d, chrono::Utc::now()) {
            Ok(_) => n += 1,
            Err(e) => crate::commands::crash::log_line(format!("[CONSENT] installer receipt refused: {e}")),
        }
    }
    n
}

/// After an import replaced the settings: a telemetry "yes" that this install has no receipt for
/// is not carried over. It is reset (asked again) and the reset is recorded. A "yes" that IS
/// proven here (restoring this install's own backup) is kept and recorded as re-confirmed.
/// Returns true when the consent was reset.
pub fn after_import(state: &AppState, app: &AppHandle) -> bool {
    let consent = state.data.lock().ok().and_then(|d| d.settings.analytics_consent);
    if consent != Some(true) {
        return false;
    }
    let ledger = ledger_for(state);
    let st = doc_status(&ledger.receipts(), "telemetry", Some(TELEMETRY_VERSION), true);
    if st.proof {
        record_quiet(state, app, RecordInput {
            doc: "telemetry".into(),
            choice: st.latest.as_ref().map(|r| r.choice.clone()).unwrap_or_else(|| "accepted".into()),
            source: Some("import".into()),
            categories: st.latest.as_ref().map(|r| r.categories.clone()),
            note: Some(format!("imported, consent re-confirmed by receipt #{}", st.latest.as_ref().map(|r| r.seq).unwrap_or(0))),
            ..Default::default()
        });
        return false;
    }
    if let Ok(mut d) = state.data.lock() {
        d.settings.analytics_consent = None;
    }
    let _ = state.save();
    crate::commands::live_issues::on_consent_changed(None, None);
    record_quiet(state, app, RecordInput {
        doc: "telemetry".into(),
        choice: "reset".into(),
        source: Some("import".into()),
        note: Some("imported data said yes, but this install holds no proof of it: asked again".into()),
        ..Default::default()
    });
    true
}

// ── Commands ────────────────────────────────────────────────────────────────────────────────
#[tauri::command]
pub fn consent_record(state: State<AppState>, app_handle: AppHandle, input: RecordInput) -> Result<Receipt, String> {
    let mut r = record(&state, &app_handle, input)?;
    r.mac.clear();
    Ok(r)
}

/// Per document: the version in force, the newest receipt, and whether it has to be asked again.
#[tauri::command]
pub fn consent_status(state: State<AppState>, app_handle: AppHandle) -> Value {
    let ledger = ledger_for(&state);
    let rs = ledger.receipts();
    let (consent, live) = state.data.lock().map(|d| (d.settings.analytics_consent, d.settings.live_errors)).unwrap_or((None, None));
    let mut docs = serde_json::Map::new();
    for doc in DOCS {
        let in_force = match *doc {
            "telemetry" => consent == Some(true),
            "crash_reports" => false, // its answer rides inside the telemetry receipt's categories
            _ => true,
        };
        let _ = live;
        let st = doc_status(&rs, doc, current_version(&app_handle, doc).as_deref(), in_force);
        docs.insert(doc.to_string(), serde_json::to_value(st).unwrap_or(Value::Null));
    }
    json!({ "install_id": ledger.install_id(), "docs": docs, "verify": ledger.verify(), "count": rs.len() })
}

/// The whole ledger for « My consents » (newest first), with the chain check and the sync state.
#[tauri::command]
pub fn consent_list(state: State<AppState>) -> Value {
    let ledger = ledger_for(&state);
    let mut rs = ledger.receipts();
    rs.reverse();
    for r in rs.iter_mut() {
        r.mac.clear();
    }
    json!({ "install_id": ledger.install_id(), "receipts": rs, "verify": ledger.verify(), "sync": ledger.sync_state() })
}

#[tauri::command]
pub fn consent_verify(state: State<AppState>) -> VerifyReport {
    ledger_for(&state).verify()
}

/// The evidence file the user saves: every receipt (MAC included — with the key it re-verifies
/// locally; without it the hash chain still does), the verification and the install id.
#[tauri::command]
pub fn consent_export(state: State<AppState>, app_handle: AppHandle) -> Result<String, String> {
    let ledger = ledger_for(&state);
    let doc = json!({
        "format": "bmm-consent-ledger",
        "version": SCHEMA,
        "exported_at": chrono::Utc::now().to_rfc3339(),
        "app_version": app_handle.package_info().version.to_string(),
        "install_id": ledger.install_id(),
        "canonical": "sha256 of: bmm-consent-v1, seq, id, install_id, doc, version, text_sha256, lang, choice, categories (k=1;k=0 sorted), source, app_version, at, note, prev_hash — joined by \\n",
        "verify": ledger.verify(),
        "receipts": ledger.receipts(),
    });
    serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())
}

/// Send the receipts the server does not have. Only when telemetry consent is on, or when the
/// user pressed « Send » (`force`). `endpoint`/`api_key` are the telemetry ones (links-config).
#[tauri::command]
pub async fn consent_sync(state: State<'_, AppState>, endpoint: Option<String>, api_key: Option<String>, force: Option<bool>) -> Result<Value, String> {
    let allowed = force == Some(true) || state.data.lock().map(|d| d.settings.analytics_consent == Some(true)).unwrap_or(false);
    let ledger = ledger_for(&state);
    let pending = ledger.pending();
    if !allowed {
        return Ok(json!({ "sent": 0, "pending": pending.len(), "skipped": "not_allowed" }));
    }
    if pending.is_empty() {
        return Ok(json!({ "sent": 0, "pending": 0 }));
    }
    let Some(url) = consents_url(endpoint.as_deref().unwrap_or("")) else {
        return Ok(json!({ "sent": 0, "pending": pending.len(), "skipped": "no_endpoint" }));
    };
    let batch: Vec<Receipt> = pending.iter().take(200).cloned().collect();
    let body = sync_payload(api_key.as_deref().unwrap_or(""), &ledger.install_id(), &batch);
    let res = crate::commands::live_issues::post(&url, &body).await;
    let mut st = ledger.sync_state();
    match res {
        Ok(()) => {
            st.sent_seq = batch.last().map(|r| r.seq).unwrap_or(st.sent_seq);
            st.last_sent_at = chrono::Utc::now().to_rfc3339();
            st.last_error.clear();
            ledger.save_sync_state(&st);
            Ok(json!({ "sent": batch.len(), "pending": pending.len() - batch.len() }))
        }
        Err(e) => {
            st.last_error = e.clone();
            ledger.save_sync_state(&st);
            Ok(json!({ "sent": 0, "pending": pending.len(), "error": e }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(doc: &str, choice: &str, source: &str, version: &str) -> Draft {
        Draft {
            doc: doc.into(),
            version: version.into(),
            text_sha256: text_hash("the text"),
            lang: "fr".into(),
            choice: choice.into(),
            categories: BTreeMap::new(),
            source: source.into(),
            app_version: "1.2.3".into(),
            note: String::new(),
        }
    }
    fn t0() -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::parse_from_rfc3339("2026-10-13T10:00:00Z").unwrap().with_timezone(&chrono::Utc)
    }
    fn rewrite(l: &Ledger, f: impl Fn(&mut Vec<String>)) {
        let p = l.dir.join(LEDGER_FILE);
        let mut lines: Vec<String> = std::fs::read_to_string(&p).unwrap().lines().map(str::to_string).collect();
        f(&mut lines);
        std::fs::write(&p, lines.join("\n") + "\n").unwrap();
    }

    #[test]
    fn hmac_matches_rfc4231_case_2() {
        assert_eq!(hex::encode(hmac_sha256(b"Jefe", b"what do ya want for nothing?")), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
    }

    #[test]
    fn text_hash_prefix_is_the_ui_fingerprint() {
        for t in ["# Terms\r\n\r\nYou agree.  \r\n", "anything", "a\nb\n\n"] {
            assert_eq!(&text_hash(t)[..16], crate::commands::settings::fingerprint_text(t));
        }
        assert_eq!(text_hash("x\r\ny"), text_hash("x\ny   "));
    }

    /// Same vector as the telemetry server (consents.rs canonical_matches_the_bmm_vector).
    #[test]
    fn canonical_vector() {
        let mut r = Receipt {
            schema: 1, seq: 1, id: "00000000-0000-4000-8000-000000000001".into(), install_id: "0123456789abcdef0123456789abcdef".into(),
            doc: "telemetry".into(), version: "2026-10-13".into(), text_sha256: String::new(), lang: "fr".into(), choice: "custom".into(),
            categories: [("usage".to_string(), true), ("errors".to_string(), false)].into_iter().collect(),
            source: "settings".into(), app_version: "1.2.3".into(), at: "2026-10-13T10:00:00.000Z".into(), note: String::new(),
            prev_hash: GENESIS.into(), hash: String::new(), mac: String::new(),
        };
        assert!(canonical(&r).contains("errors=0;usage=1"));
        r.hash = receipt_hash(&r);
        assert_eq!(r.hash, "75e27cdeae1df94ca82f6c1da29a3583e1aeeb67eff78a32a0a1727d52f8910f");
    }

    #[test]
    fn appends_a_chain_that_verifies() {
        let d = tempfile::tempdir().unwrap();
        let l = Ledger::new(d.path());
        let a = l.append(draft("tos", "accepted", "first_run", "abcd"), t0()).unwrap();
        let b = l.append(draft("privacy", "accepted", "first_run", "ef01"), t0()).unwrap();
        assert_eq!((a.seq, b.seq), (1, 2));
        assert_eq!(a.prev_hash, GENESIS);
        assert_eq!(b.prev_hash, a.hash);
        assert_eq!(a.install_id, b.install_id);
        assert_eq!(a.install_id.len(), 32);
        let v = l.verify();
        assert!(v.ok && v.mac_checked && v.count == 2, "{v:?}");
    }

    #[test]
    fn an_edited_line_is_caught() {
        let d = tempfile::tempdir().unwrap();
        let l = Ledger::new(d.path());
        l.append(draft("telemetry", "declined", "settings", TELEMETRY_VERSION), t0()).unwrap();
        l.append(draft("tos", "accepted", "first_run", "abcd"), t0()).unwrap();
        rewrite(&l, |ls| ls[0] = ls[0].replace("\"declined\"", "\"accepted\""));
        let v = l.verify();
        assert_eq!(v.first_break.unwrap().reason, "content_altered");
    }

    #[test]
    fn a_recomputed_hash_without_the_key_fails_the_mac() {
        let d = tempfile::tempdir().unwrap();
        let l = Ledger::new(d.path());
        l.append(draft("telemetry", "declined", "settings", TELEMETRY_VERSION), t0()).unwrap();
        let mut r = l.receipts().remove(0);
        r.choice = "accepted".into();
        r.hash = receipt_hash(&r);
        std::fs::write(d.path().join(LEDGER_FILE), serde_json::to_string(&r).unwrap() + "\n").unwrap();
        assert_eq!(l.verify().first_break.unwrap().reason, "mac_invalid");
    }

    #[test]
    fn a_removed_line_breaks_the_chain_and_a_cut_tail_is_seen() {
        let d = tempfile::tempdir().unwrap();
        let l = Ledger::new(d.path());
        for _ in 0..3 {
            l.append(draft("tos", "accepted", "first_run", "abcd"), t0()).unwrap();
        }
        let p = d.path().join(LEDGER_FILE);
        let full = std::fs::read_to_string(&p).unwrap();
        rewrite(&l, |ls| { ls.remove(1); });
        assert_eq!(l.verify().first_break.unwrap().reason, "seq_gap");
        std::fs::write(&p, &full).unwrap();
        assert!(l.verify().ok);
        rewrite(&l, |ls| { ls.pop(); });
        assert_eq!(l.verify().first_break.unwrap().reason, "truncated", "deleting the newest line is what a chain alone misses");
        std::fs::write(&p, &full).unwrap();
        rewrite(&l, |ls| { ls.push("not json".into()); });
        assert_eq!(l.verify().first_break.unwrap().reason, "unparsable");
    }

    #[test]
    fn the_install_id_is_random_and_stable() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let (la, lb) = (Ledger::new(a.path()), Ledger::new(b.path()));
        assert_eq!(la.install_id(), la.install_id());
        assert_ne!(la.install_id(), lb.install_id());
    }

    #[test]
    fn bad_drafts_are_refused() {
        let d = tempfile::tempdir().unwrap();
        let l = Ledger::new(d.path());
        assert!(l.append(draft("cookies", "accepted", "settings", "1"), t0()).is_err());
        assert!(l.append(draft("tos", "maybe", "settings", "1"), t0()).is_err());
        assert!(l.append(draft("tos", "accepted", "website", "1"), t0()).is_err());
        let mut x = draft("tos", "accepted", "settings", "1");
        x.text_sha256 = "zz".into();
        assert!(l.append(x, t0()).is_err());
        let mut nl = draft("tos", "accepted", "settings", "1\nseq");
        nl.note = "a\nb".into();
        let r = l.append(nl, t0()).unwrap();
        assert!(!r.version.contains('\n') && !r.note.contains('\n'), "a newline could shift the canonical fields");
    }

    /// Re-consent: a new version of the document, a decline, or no receipt at all → ask again.
    #[test]
    fn reconsent_follows_the_version_in_force() {
        let d = tempfile::tempdir().unwrap();
        let l = Ledger::new(d.path());
        assert!(doc_status(&[], "tos", Some("v1"), true).needs_reconsent, "no proof → ask");
        l.append(draft("tos", "accepted", "first_run", "v1"), t0()).unwrap();
        let rs = l.receipts();
        assert!(doc_status(&rs, "tos", Some("v1"), true).proof);
        let s = doc_status(&rs, "tos", Some("v2"), true);
        assert!(!s.proof && s.needs_reconsent, "the text changed → ask again");
        // Telemetry: nothing to prove while it is off; a "yes" without a receipt is asked again.
        assert!(!doc_status(&rs, "telemetry", Some(TELEMETRY_VERSION), false).needs_reconsent);
        assert!(doc_status(&rs, "telemetry", Some(TELEMETRY_VERSION), true).needs_reconsent);
        l.append(draft("telemetry", "custom", "settings", TELEMETRY_VERSION), t0()).unwrap();
        assert!(doc_status(&l.receipts(), "telemetry", Some(TELEMETRY_VERSION), true).proof);
        assert!(doc_status(&l.receipts(), "telemetry", Some("2099-01-01"), true).needs_reconsent);
        l.append(draft("telemetry", "withdrawn", "settings", TELEMETRY_VERSION), t0()).unwrap();
        assert!(!doc_status(&l.receipts(), "telemetry", Some(TELEMETRY_VERSION), true).proof, "the newest answer counts");
    }

    /// Every source a receipt can name is accepted; `app` resolves from the ledger.
    #[test]
    fn a_receipt_on_each_source() {
        let d = tempfile::tempdir().unwrap();
        let l = Ledger::new(d.path());
        for s in SOURCES {
            let r = l.append(draft("privacy", "accepted", s, "v1"), t0()).unwrap();
            assert_eq!(r.source, *s);
        }
        assert_eq!(l.receipts().len(), SOURCES.len());
        assert!(l.verify().ok);
        assert_eq!(resolve_source(&[], "tos", "app"), "first_run");
        assert_eq!(resolve_source(&l.receipts(), "privacy", "app"), "reconsent");
        assert_eq!(resolve_source(&l.receipts(), "privacy", "cli"), "cli");
    }

    #[test]
    fn installer_proof_only_for_a_text_bmm_ships() {
        let known = vec![("TOS.md".to_string(), text_hash("EN terms")), ("TOS_FR.md".to_string(), text_hash("FR terms"))];
        assert_eq!(installer_version_for(&text_hash("FR terms"), &known, Some("v1")), "v1");
        assert!(installer_version_for(&text_hash("other terms"), &known, Some("v1")).starts_with("unverified:"));
        assert!(installer_version_for("", &known, Some("v1")).starts_with("unverified:"));
    }

    #[test]
    fn export_and_sync_payload_keep_the_mac_home() {
        let d = tempfile::tempdir().unwrap();
        let l = Ledger::new(d.path());
        l.append(draft("tos", "accepted", "first_run", "v1"), t0()).unwrap();
        let p = sync_payload("pk", &l.install_id(), &l.pending());
        let r = &p["receipts"][0];
        assert!(r.get("mac").is_none());
        assert_eq!(r["hash"], l.receipts()[0].hash);
        assert_eq!(p["install_id"], l.install_id());
        l.save_sync_state(&SyncState { sent_seq: 1, ..Default::default() });
        assert!(l.pending().is_empty());
        l.append(draft("privacy", "accepted", "first_run", "v1"), t0()).unwrap();
        assert_eq!(l.pending().len(), 1);
    }

    #[test]
    fn the_consents_url_sits_beside_the_endpoint() {
        assert_eq!(consents_url("https://t.example.com/batch/").as_deref(), Some("https://t.example.com/consents"));
        assert_eq!(consents_url("").as_deref(), None);
        assert_eq!(consents_url("http://evil.example.com/batch"), None, "plain http only to loopback");
    }
}
