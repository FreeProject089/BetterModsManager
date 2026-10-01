//! Optional AI assistance — the Tauri commands (the app half of `ai_core`).
//!
//! Nothing here is on by default and nothing here writes a mod on its own:
//! * `ai_suggest_mod_metadata` RETURNS suggestions (files first, then the provider the user
//!   picked, if any), with the exact text that was sent;
//! * `ai_apply_mod_metadata` writes ONLY the fields the user ticked;
//! * `ai_report_precheck` masks personal data in a report before the user sends it;
//! * `ai_triage_report` gives a hint (category / severity / likely duplicate) — never a verdict.
//!
//! Every network call goes through `ai_core`'s gate; with the master switch off, none happens.
//! The embedded provider (« Laya intégré », `ai_embedded`) goes through the same gate and makes
//! no network call at all; installing its model is a separate, explicit click (`ai_embedded_*`).

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::State;

use crate::commands::ai_core::{self, AiSettings, BcAuth, Ctx, HttpTransport, ModFacts};
use crate::commands::{ai_embedded, ai_hybrid};
use crate::state::AppState;

fn data_dir(state: &AppState) -> PathBuf {
    state.data_path.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| PathBuf::from("."))
}

/// The two headers the frontend may pass for BetterCommunity (it computes the creator proof),
/// plus the account's API key, read here and never handed to the webview. The base is checked
/// BEFORE any header is attached: https bettercommunity.ch, or the https test base that
/// app.cfg names (read here, not taken from the page). Never loopback, never plain http, so a
/// page cannot aim the account's credential at a server of its choosing.
fn bc_auth(app: &tauri::AppHandle, dir: &std::path::Path, base: Option<String>, headers: Option<HashMap<String, String>>) -> Option<BcAuth> {
    let base = base.unwrap_or_else(|| "https://bettercommunity.ch".to_string());
    let cfg = crate::commands::settings::get_bc_config(app.clone());
    let test_base = cfg.test_mode.then_some(cfg.base_url);
    let checked = match ai_core::bc_base_allowed(&base, test_base.as_deref()) {
        Ok(u) => u,
        Err(_) => {
            crate::commands::crash::log_line("[AI] BetterCommunity base refused (not production, not an https test base)".to_string());
            return None;
        }
    };
    let mut out: Vec<(String, String)> = Vec::new();
    for (k, v) in headers.unwrap_or_default() {
        let allowed = k.eq_ignore_ascii_case("X-Creator-ID") || k.eq_ignore_ascii_case("X-Creator-Proof");
        let clean = !v.is_empty() && v.len() <= 4096 && v.chars().all(|c| c.is_ascii_graphic());
        if allowed && clean {
            out.push((k, v));
        }
    }
    if let Ok(key) = std::fs::read_to_string(dir.join(crate::commands::security::BC_API_KEY_FILE)) {
        let key = key.trim();
        if !key.is_empty() && key.chars().all(|c| c.is_ascii_graphic()) {
            out.push(("Authorization".into(), format!("Bearer {}", key)));
        }
    }
    Some(BcAuth { base: checked, headers: out })
}

/// The settings as they apply now: an installed embedded model is the default provider until
/// the user picks one (it sends nothing anywhere).
fn effective(dir: &std::path::Path) -> AiSettings {
    ai_core::effective_settings(ai_core::load_settings(dir), ai_embedded::installed())
}

fn status_view(dir: &std::path::Path) -> Value {
    let emb = ai_embedded::status();
    let installed = emb.installed;
    ai_core::status_with(dir, json!(emb), installed)
}

fn settings_view(dir: &std::path::Path) -> Value {
    json!({ "settings": effective(dir), "status": status_view(dir) })
}

/// Settings + status for the Settings card. Never contains a key.
#[tauri::command]
pub fn ai_get_settings(state: State<AppState>) -> Value {
    settings_view(&data_dir(&state))
}

/// Save the Settings card. A provider URL that fails the rules is refused with its reason
/// (a translation key), so nothing unsafe is ever stored as "configured".
#[tauri::command]
pub fn ai_save_settings(state: State<AppState>, settings: AiSettings) -> Result<Value, String> {
    let dir = data_dir(&state);
    let s = settings.normalized();
    if s.classifier == "local" {
        ai_core::validate_url(&s.local_url, ai_core::EndpointKind::LocalLaya, s.local_allow_remote)?;
    }
    if s.generative == "external" {
        ai_core::validate_url(&s.external_url, ai_core::EndpointKind::External, false)?;
    }
    if s.generative == "local" {
        // Loopback only: a « local » generator that is not on this PC would be a remote one
        // the user never chose to send anything to.
        ai_core::validate_url(&s.gen_local_url, ai_core::EndpointKind::LocalGen, false)?;
    }
    let before = ai_core::load_settings(&dir);
    // A key belongs to the server it was typed for: a new origin clears it (it is never carried
    // to a URL the page just saved). Same origin, the key stays.
    ai_core::rebind_secrets(&dir, &before, &s);
    let mut s = s;
    // The installer's choice is history, not something the page can rewrite.
    s.installer_choice = before.installer_choice;
    // Saved from the card = the user's own choice of classifier from now on.
    s.classifier_chosen = true;
    ai_core::save_settings(&dir, &s)?;
    crate::commands::crash::log_line(format!(
        "[AI] settings saved: enabled={} classifier={} generative={}",
        s.enabled, s.classifier, s.generative
    ));
    Ok(settings_view(&dir))
}

/// Store an API key ("local_key" | "external_key"). Empty clears it. Returns where it went:
/// "dpapi" / "keyring" (persisted, OS-protected), "memory" (this run only) or "" (cleared).
/// The key is bound to the origin its provider has in the SAVED settings (the card saves
/// first): it is only ever sent there, and only over https or loopback.
#[tauri::command]
pub fn ai_set_secret(state: State<AppState>, name: String, value: String) -> Result<String, String> {
    let dir = data_dir(&state);
    let saved = ai_core::load_settings(&dir);
    ai_core::set_bound_secret(&dir, &name, &value, &saved).map(str::to_string)
}

/// Check a URL against the provider rules without saving anything (for the field's hint).
#[tauri::command]
pub fn ai_check_url(url: String, kind: String, allow_remote: bool) -> Result<Value, String> {
    let k = match kind.as_str() {
        "local" => ai_core::EndpointKind::LocalLaya,
        "external" => ai_core::EndpointKind::External,
        "bettercommunity" => ai_core::EndpointKind::BetterCommunity,
        "gen_local" => ai_core::EndpointKind::LocalGen,
        _ => return Err("unknown_kind".into()),
    };
    ai_core::validate_url(&url, k, allow_remote).map(|c| json!(c))
}

/// Settings + the keys that may be SENT under them (each only to the origin it was saved for).
fn ctx_owned(dir: &std::path::Path, bc: Option<BcAuth>) -> (AiSettings, Option<String>, Option<String>, Option<BcAuth>) {
    let s = effective(dir);
    let lk = ai_core::bound_key(dir, "local_key", &s);
    let ek = ai_core::bound_key(dir, "external_key", &s);
    (s, lk, ek, bc)
}

#[tauri::command(async)]
pub async fn ai_test_connection(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    target: String,
    bc_base: Option<String>,
    bc_headers: Option<HashMap<String, String>>,
) -> Result<Value, String> {
    let dir = data_dir(&state);
    let bc = bc_auth(&app, &dir, bc_base, bc_headers);
    let (settings, lk, ek, bc) = ctx_owned(&dir, bc);
    tauri::async_runtime::spawn_blocking(move || {
        let t = HttpTransport;
        let ctx = Ctx { settings: &settings, transport: &t, local_model: Some(&ai_embedded::Embedded), killed: ai_core::kill_switch(), local_key: lk, external_key: ek, bc };
        ai_core::test_connection(&ctx, &target)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// What a mod says about itself now (for the extractor, and to skip suggestions that change
/// nothing).
fn mod_facts(m: &crate::models::mod_entry::ModEntry) -> ModFacts {
    ModFacts {
        name: m.name.clone(),
        version: m.version.clone(),
        author: m.author.clone().unwrap_or_default(),
        description: m.description.clone().unwrap_or_default(),
        tags: m.tags.clone(),
        links: m.download_links.iter().map(|l| l.url.clone()).collect(),
        path: m.mod_folder_path.clone(),
    }
}

/// 7z / rar mods: their file NAMES, through the app's archive layer (listed, never extracted).
/// A folder or a .zip is read by the extractor itself.
fn archive_names(path: &std::path::Path) -> Vec<String> {
    let is_zip = path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("zip")).unwrap_or(false);
    if !is_zip && crate::archive::is_archive(path) {
        crate::archive::archive_entries(path).map(|v| v.into_iter().map(|(n, _)| n).take(4000).collect()).unwrap_or_default()
    } else {
        Vec::new()
    }
}

fn outcome_json(mod_id: &str, o: &ai_hybrid::SuggestOutcome) -> Value {
    json!({
        "modId": mod_id,
        "suggestions": o.suggestions,
        "notes": o.notes,
        "sourcesRead": o.sources_read,
        "sources": o.sources,
        "sentText": o.sent_text,
        // Nothing left this PC (files only, the embedded engine, a loopback generator).
        "offline": o.offline,
    })
}

/// Suggestions for one mod: the files first (always, offline), then Laya (when on), then — with
/// `draft` and a « Rédaction » provider — a description draft checked by the rules and by Laya.
/// `use_providers: false` (or AI off) = files only. Writes nothing.
#[tauri::command(async)]
pub async fn ai_suggest_mod_metadata(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    mod_id: String,
    use_providers: Option<bool>,
    draft: Option<bool>,
    bc_base: Option<String>,
    bc_headers: Option<HashMap<String, String>>,
) -> Result<Value, String> {
    let dir = data_dir(&state);
    let (facts, vocab) = {
        let data = state.data.lock().map_err(|_| "state lock".to_string())?;
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or_else(|| "mod_not_found".to_string())?;
        let vocab: ai_core::Vocab = data.custom_tags.iter().map(|t| (t.id.clone(), t.name.clone())).collect();
        (mod_facts(m), vocab)
    };
    let bc = bc_auth(&app, &dir, bc_base, bc_headers);
    let (settings, lk, ek, bc) = ctx_owned(&dir, bc);
    let use_providers = use_providers.unwrap_or(true);
    let draft = draft.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        let extra = archive_names(&facts.path);
        let t = HttpTransport;
        let ctx = Ctx { settings: &settings, transport: &t, local_model: Some(&ai_embedded::Embedded), killed: ai_core::kill_switch(), local_key: lk, external_key: ek, bc };
        let o = ai_hybrid::suggest_mod(&ctx, &facts, &vocab, &extra, use_providers, draft);
        // Counts and short reasons only: never a name, a readme line or a draft.
        crate::commands::crash::log_line(format!(
            "[AI] suggest mod={} suggestions={} sent={} notes={:?}",
            mod_id, o.suggestions.len(), !o.offline, o.notes
        ));
        let mut v = outcome_json(&mod_id, &o);
        v["status"] = status_view(&dir);
        Ok(v)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn analyze_cancel() -> &'static std::sync::atomic::AtomicBool {
    static C: std::sync::OnceLock<std::sync::atomic::AtomicBool> = std::sync::OnceLock::new();
    C.get_or_init(|| std::sync::atomic::AtomicBool::new(false))
}

fn analyze_busy() -> &'static std::sync::atomic::AtomicBool {
    static B: std::sync::OnceLock<std::sync::atomic::AtomicBool> = std::sync::OnceLock::new();
    B.get_or_init(|| std::sync::atomic::AtomicBool::new(false))
}

/// At most this many mods per « Analyser la bibliothèque » run.
pub const ANALYZE_MAX: usize = 2000;

/// Mod Library → « Analyser la bibliothèque »: the same pipeline as one mod, for `mod_ids` (all
/// mods when absent), one after the other. Progress: `ai-analyze-progress` events ({ done,
/// total }). Returns, per mod that has something to suggest, what it would change — nothing is
/// written: the user reviews and applies per mod and per field (`ai_apply_mod_metadata`).
/// `draft` is off unless asked for; `use_providers: false` = files only.
#[tauri::command(async)]
pub async fn ai_analyze_library(
    window: tauri::Window,
    state: State<'_, AppState>,
    mod_ids: Option<Vec<String>>,
    use_providers: Option<bool>,
    draft: Option<bool>,
) -> Result<Value, String> {
    use std::sync::atomic::Ordering;
    use tauri::Emitter;
    let dir = data_dir(&state);
    let (list, vocab) = {
        let data = state.data.lock().map_err(|_| "state lock".to_string())?;
        let want: Option<std::collections::HashSet<&String>> = mod_ids.as_ref().map(|v| v.iter().collect());
        let list: Vec<(String, ModFacts)> = data
            .mods
            .iter()
            .filter(|m| want.as_ref().map(|w| w.contains(&m.id)).unwrap_or(true))
            .take(ANALYZE_MAX)
            .map(|m| (m.id.clone(), mod_facts(m)))
            .collect();
        let vocab: ai_core::Vocab = data.custom_tags.iter().map(|t| (t.id.clone(), t.name.clone())).collect();
        (list, vocab)
    };
    if analyze_busy().swap(true, Ordering::SeqCst) {
        return Err("busy".into());
    }
    analyze_cancel().store(false, Ordering::SeqCst);
    let (settings, lk, ek, _) = ctx_owned(&dir, None);
    let use_providers = use_providers.unwrap_or(true);
    let draft = draft.unwrap_or(false);
    let r = tauri::async_runtime::spawn_blocking(move || {
        let t = HttpTransport;
        let ctx = Ctx { settings: &settings, transport: &t, local_model: Some(&ai_embedded::Embedded), killed: ai_core::kill_switch(), local_key: lk, external_key: ek, bc: None };
        let total = list.len();
        let started = std::time::Instant::now();
        let mut items: Vec<Value> = Vec::new();
        let mut cancelled = false;
        let mut sent = false;
        // Background work under the resource governor: it waits while a game is played or a
        // deploy runs, and the dashboard can pause or cancel it between two mods.
        let ticket = crate::governor::runtime::global().begin(crate::governor::config::OpKind::Scan, "AI library analysis");
        for (i, (id, facts)) in list.iter().enumerate() {
            if analyze_cancel().load(Ordering::SeqCst) || ticket.checkpoint().is_err() {
                cancelled = true;
                break;
            }
            let extra = archive_names(&facts.path);
            let o = ai_hybrid::suggest_mod(&ctx, facts, &vocab, &extra, use_providers, draft);
            sent |= !o.offline;
            if !o.suggestions.is_empty() {
                let mut v = outcome_json(id, &o);
                // The batch view lists many mods: the sent text is summarised by `sent` below.
                v["sentText"] = Value::Null;
                v["name"] = json!(facts.name);
                items.push(v);
            }
            let _ = window.emit("ai-analyze-progress", json!({ "done": i + 1, "total": total }));
        }
        crate::commands::crash::log_line(format!(
            "[AI] analyze library: mods={} with_suggestions={} cancelled={} ms={}",
            total, items.len(), cancelled, started.elapsed().as_millis()
        ));
        json!({ "total": total, "items": items, "cancelled": cancelled, "offline": !sent, "ms": started.elapsed().as_millis() as u64 })
    })
    .await
    .map_err(|e| e.to_string());
    analyze_busy().store(false, Ordering::SeqCst);
    r
}

/// Stop « Analyser la bibliothèque » after the mod in progress (what was found stays shown).
#[tauri::command]
pub fn ai_analyze_cancel() {
    analyze_cancel().store(true, std::sync::atomic::Ordering::SeqCst);
}

/// Apply the fields the user ticked. `fields` = { name?, version?, author?, description?,
/// tags?: [tagId], links?: [{url,label?}] } — nothing else, and nothing not listed.
#[tauri::command]
pub fn ai_apply_mod_metadata(state: State<AppState>, mod_id: String, fields: Value) -> Result<Value, String> {
    let (name, changes, skipped, applied, updated) = {
        let mut data = state.data.lock().map_err(|_| "state lock".to_string())?;
        let tag_ids: Vec<String> = data.custom_tags.iter().map(|t| t.id.clone()).collect();
        let patch = ai_core::build_patch(&fields, &tag_ids)?;
        let m = data.mods.iter_mut().find(|m| m.id == mod_id).ok_or_else(|| "mod_not_found".to_string())?;
        let mut changes = Vec::new();
        let mut applied: Vec<&str> = Vec::new();
        if let Some(v) = patch.name {
            changes.push(json!({ "field": "name", "old": m.name, "new": v }));
            m.name = v;
            applied.push("name");
        }
        if let Some(v) = patch.version {
            changes.push(json!({ "field": "version", "old": m.version, "new": v }));
            m.version = v;
            applied.push("version");
        }
        if let Some(v) = patch.author {
            changes.push(json!({ "field": "author", "old": m.author.clone().unwrap_or_default(), "new": v }));
            m.author = Some(v);
            applied.push("author");
        }
        if let Some(v) = patch.description {
            changes.push(json!({ "field": "description", "old": m.description.clone().unwrap_or_default(), "new": v }));
            m.description = Some(v);
            applied.push("description");
        }
        let mut skipped = Vec::new();
        if !patch.add_tags.is_empty() {
            let (tags, sk) = ai_core::merge_tags(&m.tags, &patch.add_tags);
            if tags != m.tags {
                changes.push(json!({ "field": "tags", "old": m.tags, "new": tags }));
                m.tags = tags;
                applied.push("tags");
            }
            skipped = sk;
        }
        if !patch.add_links.is_empty() {
            let old = m.download_links.clone();
            for l in patch.add_links {
                let exists = m.download_links.iter().any(|d| d.url.trim_end_matches('/') == l.url.trim_end_matches('/'));
                if !exists {
                    m.download_links.push(crate::models::mod_entry::DownloadLink { url: l.url, link_type: l.link_type, label: l.label });
                }
            }
            if m.download_links != old {
                changes.push(json!({ "field": "links", "old": old, "new": m.download_links }));
                applied.push("links");
            }
        }
        let applied: Vec<String> = applied.into_iter().map(str::to_string).collect();
        (m.name.clone(), changes, skipped, applied, serde_json::to_value(&*m).unwrap_or(Value::Null))
    };
    let active = state.data.lock().ok().and_then(|d| d.active_profile_id.clone()).unwrap_or_default();
    if !changes.is_empty() {
        let details = json!(changes).to_string();
        crate::commands::history::log_activity(&state, &active, &mod_id, &name, "Modified", Some(details));
        let _ = state.save();
    }
    crate::commands::crash::log_line(format!("[AI] applied {:?} to mod {}", applied, mod_id));
    Ok(json!({ "modId": mod_id, "applied": applied, "skippedTags": skipped, "mod": updated }))
}

/// Before a report is sent: the text with secrets (every secret BMM holds, the same pass the
/// crash zips get) and personal data (user folder names, e-mails, IPs, the account and PC
/// names) masked, and what was found. No network — this runs whether AI is on or not.
#[tauri::command]
pub fn ai_report_precheck(state: State<AppState>, text: String) -> Value {
    let dir = data_dir(&state);
    let mut r = crate::commands::report_redact::Redactor::new();
    r.absorb_data_file(&state.data_path);
    r.absorb_secret_file(&dir.join(crate::commands::security::BC_API_KEY_FILE));
    let text: String = text.chars().take(20_000).collect();
    let before = text.matches("[REDACTED").count();
    let scrubbed = r.scrub_text(&text);
    let secret_hits = scrubbed.matches("[REDACTED").count().saturating_sub(before);
    let extra: Vec<String> = ai_core::SECRET_NAMES.iter().filter_map(|n| ai_core::get_secret(&dir, n)).collect();
    let (user, pc) = ai_core::os_identity();
    let (clean, mut findings) = ai_core::scrub_pii(&scrubbed, user.as_deref(), pc.as_deref(), &extra);
    if secret_hits > 0 {
        if let Some(f) = findings.iter_mut().find(|f| f.kind == "token") {
            f.count += secret_hits;
        } else {
            findings.push(ai_core::Finding { kind: "token".into(), count: secret_hits });
        }
    }
    json!({ "text": clean, "findings": findings, "changed": clean != text })
}

/// A classifier HINT for a report (category, severity, likely duplicate of one of `known`,
/// the user's recent report titles). Sends the already-masked text only.
#[tauri::command(async)]
pub async fn ai_triage_report(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    text: String,
    known: Option<Vec<String>>,
    bc_base: Option<String>,
    bc_headers: Option<HashMap<String, String>>,
) -> Result<Value, String> {
    let dir = data_dir(&state);
    let bc = bc_auth(&app, &dir, bc_base, bc_headers);
    let (settings, lk, ek, bc) = ctx_owned(&dir, bc);
    let known = known.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let killed = ai_core::kill_switch();
        // Masked again here, whatever the caller did: this text leaves the machine.
        let (user, pc) = ai_core::os_identity();
        let (clean, _) = ai_core::scrub_pii(&text, user.as_deref(), pc.as_deref(), &[]);
        let clean: String = clean.chars().take(ai_core::MAX_PROVIDER_TEXT).collect();
        let t = HttpTransport;
        let ctx = Ctx { settings: &settings, transport: &t, local_model: Some(&ai_embedded::Embedded), killed, local_key: lk, external_key: ek, bc };
        let tr = ai_core::triage_report(&ctx, &clean, &known)?;
        let offline = settings.classifier == "embedded";
        Ok(json!({ "triage": tr, "sentText": if offline { Value::Null } else { json!(clean) }, "offline": offline }))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ─────────────────────────────────────────────────────────────────────────────
// « Laya intégré » — the model pack
// ─────────────────────────────────────────────────────────────────────────────

fn embedded_cancel() -> &'static std::sync::atomic::AtomicBool {
    static C: std::sync::OnceLock<std::sync::atomic::AtomicBool> = std::sync::OnceLock::new();
    C.get_or_init(|| std::sync::atomic::AtomicBool::new(false))
}

fn embedded_busy() -> &'static std::sync::atomic::AtomicBool {
    static B: std::sync::OnceLock<std::sync::atomic::AtomicBool> = std::sync::OnceLock::new();
    B.get_or_init(|| std::sync::atomic::AtomicBool::new(false))
}

/// Installed / absent, where, how big, loaded or not. Reads the disk only (no hashing, no load).
#[tauri::command]
pub fn ai_embedded_status() -> Value {
    json!(ai_embedded::status())
}

/// Settings → « Installer le modèle »: download the pinned pack (resumable, SHA-256 checked),
/// unpack it into %LOCALAPPDATA%, and make the embedded engine the classifier. An explicit click,
/// and the only network request this feature ever makes: to the pinned URL, carrying nothing
/// about the user. Progress: `ai-embedded-progress` events ({ received, total }).
#[tauri::command(async)]
pub async fn ai_embedded_install(window: tauri::Window, state: State<'_, AppState>) -> Result<Value, String> {
    use std::sync::atomic::Ordering;
    use tauri::Emitter;
    if ai_core::kill_switch() {
        return Err("killed".into());
    }
    if embedded_busy().swap(true, Ordering::SeqCst) {
        return Err("busy".into());
    }
    embedded_cancel().store(false, Ordering::SeqCst);
    embedded_discard().store(false, Ordering::SeqCst);
    let dir = data_dir(&state);
    let r = tauri::async_runtime::spawn_blocking(move || {
        let w = window.clone();
        let progress = move |p: ai_embedded::Progress| {
            let _ = w.emit("ai-embedded-progress", p);
        };
        let out = ai_embedded::install_user_copy(&progress, embedded_cancel());
        if matches!(&out, Err(e) if e == "cancelled") && embedded_discard().swap(false, Ordering::SeqCst) {
            ai_embedded::discard_partial();
        }
        if out.is_ok() {
            let mut s = ai_core::load_settings(&dir);
            if !s.classifier_chosen || s.classifier == "off" {
                s.classifier = "embedded".into();
            }
            let _ = ai_core::save_settings(&dir, &s);
        }
        crate::commands::crash::log_line(format!("[AI] embedded model install: {}", match &out { Ok(_) => "ok".to_string(), Err(e) => e.clone() }));
        out
    })
    .await
    .map_err(|e| e.to_string());
    embedded_busy().store(false, Ordering::SeqCst);
    r?
}

fn embedded_discard() -> &'static std::sync::atomic::AtomicBool {
    static D: std::sync::OnceLock<std::sync::atomic::AtomicBool> = std::sync::OnceLock::new();
    D.get_or_init(|| std::sync::atomic::AtomicBool::new(false))
}

/// Stop a download in progress. `discard: false` (« Pause »): what was received stays on disk
/// and the next click resumes it. `discard: true` (« Cancel »): it is deleted as well.
#[tauri::command]
pub fn ai_embedded_cancel(discard: Option<bool>) {
    use std::sync::atomic::Ordering;
    let discard = discard.unwrap_or(false);
    embedded_discard().store(discard, Ordering::SeqCst);
    embedded_cancel().store(true, Ordering::SeqCst);
    // Nothing running: a cancel is just « forget the partial download ».
    if discard && !embedded_busy().load(Ordering::SeqCst) {
        ai_embedded::discard_partial();
    }
}

/// Settings → « Test Laya »: a fixed sample classified by the installed model, with timings.
/// Local only (no network, none of the user's data); refused under `--no-ai`.
#[tauri::command(async)]
pub async fn ai_embedded_test() -> Result<Value, String> {
    if ai_core::kill_switch() {
        return Err("killed".into());
    }
    if !ai_embedded::installed() {
        return Err("embedded:absent".into());
    }
    tauri::async_runtime::spawn_blocking(ai_embedded::self_test).await.map_err(|e| e.to_string())?
}

// ─────────────────────────────────────────────────────────────────────────────
// « Ask Laya » — offline questions about BMM and the user's own mods
// ─────────────────────────────────────────────────────────────────────────────

/// The library as Ask sees it: mods (tag NAMES, enabled in the active profile, their scanned
/// file lists) and profiles.
fn ask_library(state: &AppState) -> Result<crate::commands::ask_core::Library, String> {
    use crate::commands::ask_core::{Library, ModInfo, ProfileInfo};
    let data = state.data.lock().map_err(|_| "state lock".to_string())?;
    let active: std::collections::HashSet<&String> = data
        .active_profile_id
        .as_ref()
        .and_then(|id| data.profiles.iter().find(|p| &p.id == id))
        .map(|p| p.active_mods.iter().collect())
        .unwrap_or_default();
    let tag_name: HashMap<&String, &String> = data.custom_tags.iter().map(|t| (&t.id, &t.name)).collect();
    let mods = data
        .mods
        .iter()
        .map(|m| ModInfo {
            id: m.id.clone(),
            name: m.name.clone(),
            description: m.description.clone().unwrap_or_default(),
            tags: m.tags.iter().map(|t| tag_name.get(t).map(|n| n.to_string()).unwrap_or_else(|| t.clone())).collect(),
            enabled: active.contains(&m.id),
            files: m.cached_files.clone().filter(|f| !f.is_empty()).unwrap_or_else(|| m.installed_files.clone()),
        })
        .collect();
    let profiles = data.profiles.iter().map(|p| ProfileInfo { id: p.id.clone(), name: p.name.clone(), game: p.game_name.clone(), active_count: p.active_mods.len() }).collect();
    Ok(Library { mods, profiles })
}

/// Why Laya did not rank (the retrieval answer stands on its own): "" when it did.
fn ask_model(dir: &std::path::Path) -> (Option<&'static ai_embedded::Embedded>, &'static str) {
    static E: ai_embedded::Embedded = ai_embedded::Embedded;
    let s = effective(dir);
    match crate::commands::ask_core::usable_model(&s, ai_core::kill_switch(), &E) {
        Ok(_) => (Some(&E), ""),
        Err(why) => (None, why),
    }
}

/// « Ask Laya »: the question in, the documentation / settings / commands / mods / files that
/// answer it out. `request` = { question, lang, scope: "all"|"docs"|"mods", limit, extra: [the
/// app's Settings cards as index entries] }. Retrieval and Laya's ranking stay on this PC; with
/// AI off (or no model) the answer is the retrieval alone and `layaOff` says why.
/// No generator here: see `ai_ask_written`.
#[tauri::command(async)]
pub async fn ai_ask(state: State<'_, AppState>, request: crate::commands::ask_core::Request) -> Result<Value, String> {
    let dir = data_dir(&state);
    let lib = ask_library(&state)?;
    tauri::async_runtime::spawn_blocking(move || Ok(ask_with(&dir, &request, &lib, false)))
        .await
        .map_err(|e| e.to_string())?
}

/// « Rédiger une réponse » (a click, after `ai_ask`): the same retrieval, plus `written` — an
/// answer worded by the generator (« Rédaction ») from the retrieved sources only, citing them —
/// or, in `writtenOff`, why there is none (feature off, Laya abstained, the checks refused it…).
#[tauri::command(async)]
pub async fn ai_ask_written(state: State<'_, AppState>, request: crate::commands::ask_core::Request) -> Result<Value, String> {
    let dir = data_dir(&state);
    let lib = ask_library(&state)?;
    tauri::async_runtime::spawn_blocking(move || Ok(ask_with(&dir, &request, &lib, true)))
        .await
        .map_err(|e| e.to_string())?
}

/// THE « Ask Laya » entry point on the app side: `ai_ask`, the local API and scheduled tasks
/// answer through it. Blocking (retrieval, the embedded model, maybe one generator request).
pub fn ask_with(dir: &std::path::Path, request: &crate::commands::ask_core::Request, lib: &crate::commands::ask_core::Library, generate: bool) -> Value {
    let (model, why) = ask_model(dir);
    let (settings, lk, ek, _) = ctx_owned(dir, None);
    let t = HttpTransport;
    let ctx = Ctx { settings: &settings, transport: &t, local_model: Some(&ai_embedded::Embedded), killed: ai_core::kill_switch(), local_key: lk, external_key: ek, bc: None };
    let (a, written, written_off) = ai_hybrid::ask(&ctx, request, lib, model.map(|m| m as &dyn ai_core::LocalModel), generate);
    // Counts and short reasons only: never the question, a source or the answer.
    crate::commands::crash::log_line(format!(
        "[AI] ask intent={} hits={} files={} conflicts={} laya={} written={} ms={}",
        a.intent,
        a.hits.len(),
        a.files.len(),
        a.conflicts.len(),
        a.laya,
        if written.is_some() { "yes" } else { written_off.as_str() },
        a.ms
    ));
    json!({ "answer": a, "layaOff": why, "written": written, "writtenOff": written_off })
}

/// THE « classify this text » entry point on the app side (scheduled tasks, the local API):
/// which of `labels` ((id, meaning)) fits, best first, with Laya's « none » when nothing does.
/// The embedded engine or the user's own laya-serve only; master switch and `--no-ai` apply.
pub fn classify_with(dir: &std::path::Path, text: &str, labels: &[(String, String)]) -> Result<Vec<(String, f64)>, String> {
    let (settings, lk, ek, _) = ctx_owned(dir, None);
    let t = HttpTransport;
    let ctx = Ctx { settings: &settings, transport: &t, local_model: Some(&ai_embedded::Embedded), killed: ai_core::kill_switch(), local_key: lk, external_key: ek, bc: None };
    ai_hybrid::classify(&ctx, text, labels)
}

/// `ai_classify` for the webview and the MCP bridge: `labels` = [[id, meaning], …] (2 to 32).
#[tauri::command(async)]
pub async fn ai_classify(state: State<'_, AppState>, text: String, labels: Vec<(String, String)>) -> Result<Value, String> {
    let dir = data_dir(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let r = classify_with(&dir, &text, &labels)?;
        Ok(json!({ "labels": r.iter().map(|(id, p)| json!({ "id": id, "p": (p * 1000.0).round() / 1000.0 })).collect::<Vec<_>>() }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Settings → « Supprimer le modèle »: the downloaded copy only (the installed one belongs to
/// the uninstaller). If the classifier was the embedded engine it goes back to « off ».
#[tauri::command(async)]
pub async fn ai_embedded_remove(state: State<'_, AppState>) -> Result<Value, String> {
    let dir = data_dir(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let r = ai_embedded::remove_user_copy()?;
        if !ai_embedded::installed() {
            let mut s = ai_core::load_settings(&dir);
            if s.classifier == "embedded" {
                s.classifier = "off".into();
                s.classifier_chosen = true;
                let _ = ai_core::save_settings(&dir, &s);
            }
        }
        crate::commands::crash::log_line("[AI] embedded model removed".to_string());
        Ok(r)
    })
    .await
    .map_err(|e| e.to_string())?
}
