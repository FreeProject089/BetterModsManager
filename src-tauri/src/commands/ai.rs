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

use crate::commands::ai_core::{self, AiSettings, BcAuth, Ctx, Feature, HttpTransport, ModFacts};
use crate::commands::ai_embedded;
use crate::state::AppState;

fn data_dir(state: &AppState) -> PathBuf {
    state.data_path.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| PathBuf::from("."))
}

/// The two headers the frontend may pass for BetterCommunity (it computes the creator proof),
/// plus the account's API key, read here and never handed to the webview. The base is checked
/// against bettercommunity.ch (or loopback in the developer test mode) BEFORE any header is
/// attached, so a page cannot aim the account's credential at a server of its choosing.
fn bc_auth(dir: &std::path::Path, base: Option<String>, headers: Option<HashMap<String, String>>) -> Option<BcAuth> {
    let base = base.unwrap_or_else(|| "https://bettercommunity.ch".to_string());
    let checked = ai_core::validate_url(&base, ai_core::EndpointKind::BetterCommunity, false).ok()?;
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
    Some(BcAuth { base: checked.url, headers: out })
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
    let before = ai_core::load_settings(&dir);
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
#[tauri::command]
pub fn ai_set_secret(state: State<AppState>, name: String, value: String) -> Result<String, String> {
    ai_core::set_secret(&data_dir(&state), &name, &value).map(str::to_string)
}

/// Check a URL against the provider rules without saving anything (for the field's hint).
#[tauri::command]
pub fn ai_check_url(url: String, kind: String, allow_remote: bool) -> Result<Value, String> {
    let k = match kind.as_str() {
        "local" => ai_core::EndpointKind::LocalLaya,
        "external" => ai_core::EndpointKind::External,
        "bettercommunity" => ai_core::EndpointKind::BetterCommunity,
        _ => return Err("unknown_kind".into()),
    };
    ai_core::validate_url(&url, k, allow_remote).map(|c| json!(c))
}

fn ctx_owned(dir: &std::path::Path, bc: Option<BcAuth>) -> (AiSettings, Option<String>, Option<String>, Option<BcAuth>) {
    (
        effective(dir),
        ai_core::get_secret(dir, "local_key"),
        ai_core::get_secret(dir, "external_key"),
        bc,
    )
}

#[tauri::command(async)]
pub async fn ai_test_connection(
    state: State<'_, AppState>,
    target: String,
    bc_base: Option<String>,
    bc_headers: Option<HashMap<String, String>>,
) -> Result<Value, String> {
    let dir = data_dir(&state);
    let bc = bc_auth(&dir, bc_base, bc_headers);
    let (settings, lk, ek, bc) = ctx_owned(&dir, bc);
    tauri::async_runtime::spawn_blocking(move || {
        let t = HttpTransport;
        let ctx = Ctx { settings: &settings, transport: &t, local_model: Some(&ai_embedded::Embedded), killed: ai_core::kill_switch(), local_key: lk, external_key: ek, bc };
        ai_core::test_connection(&ctx, &target)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Suggestions for one mod. `use_providers: false` (or AI off) = files only, no network.
/// `draft` also asks the external API for a description draft, when one is configured.
#[tauri::command(async)]
pub async fn ai_suggest_mod_metadata(
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
        let facts = ModFacts {
            name: m.name.clone(),
            version: m.version.clone(),
            author: m.author.clone().unwrap_or_default(),
            description: m.description.clone().unwrap_or_default(),
            tags: m.tags.clone(),
            links: m.download_links.iter().map(|l| l.url.clone()).collect(),
            path: m.mod_folder_path.clone(),
        };
        let vocab: ai_core::Vocab = data.custom_tags.iter().map(|t| (t.id.clone(), t.name.clone())).collect();
        (facts, vocab)
    };
    let bc = bc_auth(&dir, bc_base, bc_headers);
    let (settings, lk, ek, bc) = ctx_owned(&dir, bc);
    let use_providers = use_providers.unwrap_or(true);
    let draft = draft.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        // 7z / rar mods: the extractor can read their file NAMES through the app's archive layer.
        let is_zip = facts.path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("zip")).unwrap_or(false);
        let extra: Vec<String> = if !is_zip && crate::archive::is_archive(&facts.path) {
            crate::archive::archive_entries(&facts.path).map(|v| v.into_iter().map(|(n, _)| n).collect()).unwrap_or_default()
        } else {
            Vec::new()
        };
        let ex = ai_core::extract(&facts, &vocab, &extra);
        let mut all = ex.suggestions.clone();
        let mut notes: Vec<String> = Vec::new();
        let mut sent: Option<String> = None;
        let killed = ai_core::kill_switch();
        if use_providers {
            let t = HttpTransport;
            let ctx = Ctx { settings: &settings, transport: &t, local_model: Some(&ai_embedded::Embedded), killed, local_key: lk, external_key: ek, bc };
            let text = ai_core::provider_text(&facts, &ex);
            if ai_core::gate(&settings, Feature::ModSuggest, killed).is_ok() {
                let (s, n) = ai_core::classify_mod(&ctx, &text, &vocab);
                // The embedded engine reads the text in this process: nothing was SENT.
                if settings.classifier != "embedded" {
                    sent = Some(text.clone());
                }
                all.extend(s);
                notes.extend(n);
            }
            if draft {
                match ai_core::draft_description(&ctx, &text) {
                    Ok(Some(d)) => {
                        sent = Some(text.clone());
                        all.push(d)
                    }
                    Ok(None) => notes.push("api:insufficient".into()),
                    Err(e) => notes.push(e),
                }
            }
        }
        let suggestions = ai_core::finalize(all, &facts);
        crate::commands::crash::log_line(format!(
            "[AI] suggest mod={} suggestions={} providers={} notes={:?}",
            mod_id, suggestions.len(), sent.is_some(), notes
        ));
        Ok(json!({
            "modId": mod_id,
            "suggestions": suggestions,
            "notes": notes,
            "sourcesRead": ex.sources_read,
            "sentText": sent,
            // The embedded engine sends nothing: say so rather than show "what was sent".
            "offline": settings.classifier == "embedded" && !draft,
            "status": status_view(&dir),
        }))
    })
    .await
    .map_err(|e| e.to_string())?
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
    state: State<'_, AppState>,
    text: String,
    known: Option<Vec<String>>,
    bc_base: Option<String>,
    bc_headers: Option<HashMap<String, String>>,
) -> Result<Value, String> {
    let dir = data_dir(&state);
    let bc = bc_auth(&dir, bc_base, bc_headers);
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
    let dir = data_dir(&state);
    let r = tauri::async_runtime::spawn_blocking(move || {
        let w = window.clone();
        let progress = move |p: ai_embedded::Progress| {
            let _ = w.emit("ai-embedded-progress", p);
        };
        let out = ai_embedded::install_user_copy(&progress, embedded_cancel());
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

/// Stop a download in progress; what was received stays on disk and the next click resumes it.
#[tauri::command]
pub fn ai_embedded_cancel() {
    embedded_cancel().store(true, std::sync::atomic::Ordering::SeqCst);
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
