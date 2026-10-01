//! Optional AI tools for MCP clients and the CLI (`bmm_ai_status`, `bmm_ai_suggest_mod_metadata`,
//! `bmm_ai_apply_mod_metadata`; `ai-status`, `ai-suggest`, `ai-apply`).
//!
//! Same engine as the app (`commands/ai_core.rs` and, for « Laya intégré », the in-process model
//! runner `commands/ai_embedded.rs`, both mounted into this binary), same rules:
//! suggesting NEVER writes; applying writes only the fields named, through the same validation
//! as the in-app dialog, straight to data.json like the other write tools (`bmm_set_mod_enabled`).
//! A classifier or generative provider is only called when the user turned AI on in BMM and
//! picked one — with the master switch off this answers from the mod's own files, offline.

use serde_json::{json, Value};

use crate::commands::ai_core::{self, AiSettings, BcAuth, Ctx, HttpTransport, ModFacts};
use crate::commands::{ai_embedded, ai_hybrid};
use crate::mcp::state_bridge;

pub fn status() -> Value {
    let emb = ai_embedded::status();
    let installed = emb.installed;
    ai_core::status_with(&state_bridge::get_bmm_data_dir(), json!(emb), installed)
}

/// BetterCommunity from the CLI: only the account API key BMM stored (there is no creator
/// proof outside the app). The base is the production site.
fn bc_auth(dir: &std::path::Path) -> Option<BcAuth> {
    let key = std::fs::read_to_string(dir.join("bcweb-api-key")).ok()?;
    let key = key.trim().to_string();
    if key.is_empty() || !key.chars().all(|c| c.is_ascii_graphic()) {
        return None;
    }
    Some(BcAuth { base: "https://bettercommunity.ch".into(), headers: vec![("Authorization".into(), format!("Bearer {}", key))] })
}

fn find<'a>(data: &'a state_bridge::BmmAppData, mod_id: &str) -> Result<&'a state_bridge::BmmModEntry, String> {
    data.mods
        .iter()
        .find(|m| m.id == mod_id)
        .or_else(|| data.mods.iter().find(|m| m.name.eq_ignore_ascii_case(mod_id)))
        .ok_or_else(|| format!("Mod '{}' not found", mod_id))
}

fn facts_of(m: &state_bridge::BmmModEntry) -> ModFacts {
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

fn settings_now(dir: &std::path::Path) -> AiSettings {
    ai_core::effective_settings(ai_core::load_settings(dir), ai_embedded::installed())
}

/// The context every AI call of the CLI/MCP goes through (the same gate as the app).
fn with_ctx<R>(dir: &std::path::Path, bc: Option<BcAuth>, f: impl FnOnce(&Ctx) -> R) -> R {
    let settings = settings_now(dir);
    let t = HttpTransport;
    let ctx = Ctx {
        settings: &settings,
        transport: &t,
        local_model: Some(&ai_embedded::Embedded),
        killed: ai_core::kill_switch(),
        local_key: ai_core::bound_key(dir, "local_key", &settings),
        external_key: ai_core::bound_key(dir, "external_key", &settings),
        bc,
    };
    f(&ctx)
}

const HOW_TO_APPLY: &str = "Nothing was written. Call bmm_ai_apply_mod_metadata with the fields the user chose, e.g. { \"mod_id\": \"…\", \"fields\": { \"description\": \"…\", \"tags\": [\"<tag id>\"] } }. Suggestions with applicable=false (language, nsfw) are hints and cannot be applied. A suggestion with note \"draft\" was written by a model: show it to the user as a draft.";

/// Suggestions for one mod (the hybrid pipeline: files → Laya → optional draft). Writes nothing.
/// 7z / rar mods: the CLI has no archive lister, so only their manifest-less facts are used.
pub fn suggest(mod_id: &str, use_providers: bool, draft: bool) -> Result<Value, String> {
    let dir = state_bridge::get_bmm_data_dir();
    let data = state_bridge::read_app_data().map_err(|e| format!("Failed to read BMM data: {}", e))?;
    let m = find(&data, mod_id)?;
    let facts = facts_of(m);
    let vocab: ai_core::Vocab = data.custom_tags.iter().map(|t| (t.id.clone(), t.name.clone())).collect();
    let o = with_ctx(&dir, if use_providers { bc_auth(&dir) } else { None }, |ctx| ai_hybrid::suggest_mod(ctx, &facts, &vocab, &[], use_providers, draft));
    Ok(json!({
        "mod_id": m.id,
        "mod_name": m.name,
        "suggestions": o.suggestions,
        "notes": o.notes,
        "sources_read": o.sources_read,
        "sources": o.sources,
        "sent_text": o.sent_text,
        "offline": o.offline,
        "applied": false,
        "how_to_apply": HOW_TO_APPLY,
    }))
}

/// « Analyser la bibliothèque »: suggestions for many mods (all when `mod_ids` is empty), at
/// most `limit`. Files only unless `use_providers`; never a draft. Writes nothing.
pub fn analyze(mod_ids: &[String], use_providers: bool, limit: usize) -> Result<Value, String> {
    let dir = state_bridge::get_bmm_data_dir();
    let data = state_bridge::read_app_data().map_err(|e| format!("Failed to read BMM data: {}", e))?;
    let vocab: ai_core::Vocab = data.custom_tags.iter().map(|t| (t.id.clone(), t.name.clone())).collect();
    let list: Vec<&state_bridge::BmmModEntry> = data.mods.iter().filter(|m| mod_ids.is_empty() || mod_ids.iter().any(|w| w == &m.id || w.eq_ignore_ascii_case(&m.name))).take(limit.clamp(1, 2000)).collect();
    let started = std::time::Instant::now();
    let (items, sent) = with_ctx(&dir, None, |ctx| {
        let mut items: Vec<Value> = Vec::new();
        let mut sent = false;
        for m in &list {
            let o = ai_hybrid::suggest_mod(ctx, &facts_of(m), &vocab, &[], use_providers, false);
            sent |= !o.offline;
            if !o.suggestions.is_empty() {
                items.push(json!({ "mod_id": m.id, "mod_name": m.name, "suggestions": o.suggestions, "notes": o.notes, "sources_read": o.sources_read }));
            }
        }
        (items, sent)
    });
    Ok(json!({
        "total": list.len(),
        "with_suggestions": items.len(),
        "items": items,
        "offline": !sent,
        "ms": started.elapsed().as_millis() as u64,
        "applied": false,
        "how_to_apply": HOW_TO_APPLY,
    }))
}

/// Classify a text among labels ((id, meaning), 2 to 32) with the embedded engine or the
/// user's own laya-serve. Returns the labels best first, with « none ».
pub fn classify(text: &str, labels: &[(String, String)]) -> Result<Value, String> {
    let dir = state_bridge::get_bmm_data_dir();
    let r = with_ctx(&dir, None, |ctx| ai_hybrid::classify(ctx, text, labels))?;
    Ok(json!({ "labels": r.iter().map(|(id, p)| json!({ "id": id, "p": (p * 1000.0).round() / 1000.0 })).collect::<Vec<_>>(), "note": "\"none\" = Laya found that none of the labels fits." }))
}

/// Apply an explicit field list to one mod (data.json). Validation is `ai_core::build_patch`.
pub fn apply(mod_id: &str, fields: &Value) -> Result<Value, String> {
    let mut data = state_bridge::read_app_data().map_err(|e| format!("Failed to read BMM data: {}", e))?;
    let tag_ids: Vec<String> = data.custom_tags.iter().map(|t| t.id.clone()).collect();
    let patch = ai_core::build_patch(fields, &tag_ids)?;
    let id = find(&data, mod_id)?.id.clone();
    let m = data.mods.iter_mut().find(|m| m.id == id).ok_or("mod vanished")?;
    let mut applied: Vec<&str> = Vec::new();
    if let Some(v) = patch.name {
        m.name = v;
        applied.push("name");
    }
    if let Some(v) = patch.version {
        m.version = v;
        applied.push("version");
    }
    if let Some(v) = patch.author {
        m.author = Some(v);
        applied.push("author");
    }
    if let Some(v) = patch.description {
        m.description = Some(v);
        applied.push("description");
    }
    let mut skipped = Vec::new();
    if !patch.add_tags.is_empty() {
        let (tags, sk) = ai_core::merge_tags(&m.tags, &patch.add_tags);
        if tags != m.tags {
            m.tags = tags;
            applied.push("tags");
        }
        skipped = sk;
    }
    let mut added = 0;
    for l in patch.add_links {
        if !m.download_links.iter().any(|d| d.url.trim_end_matches('/') == l.url.trim_end_matches('/')) {
            m.download_links.push(state_bridge::DownloadLink { url: l.url, link_type: l.link_type, label: l.label, extra: Default::default() });
            added += 1;
        }
    }
    if added > 0 {
        applied.push("links");
    }
    let name = m.name.clone();
    if !applied.is_empty() {
        state_bridge::write_app_data(&data).map_err(|e| format!("Failed to save changes: {}", e))?;
    }
    Ok(json!({
        "mod_id": id,
        "mod_name": name,
        "applied": applied,
        "skipped_tags": skipped,
        "note": if skipped.is_empty() { "" } else { "a mod holds at most 3 tags; the extra ones were not added" },
        "restart_hint": "If BMM is open, it keeps its own copy of the library: reopen the mod or restart BMM to see the change.",
    }))
}

// ─────────────────────────────────────────────────────────────────────────────
// « Ask Laya » and the model pack (`bmm_ai_ask`, `bmm_ai_pack_install`, `bmm_ai_pack_remove`,
// `bmm_ai_test`; `ai-ask`, `ai-install`, `ai-remove`, `ai-test`)
// ─────────────────────────────────────────────────────────────────────────────

use crate::commands::ask_core;

/// The library as Ask sees it, from data.json (same shape the app builds from its state).
fn ask_library() -> Result<ask_core::Library, String> {
    let data = state_bridge::read_app_data().map_err(|e| format!("Failed to read BMM data: {}", e))?;
    let active: std::collections::HashSet<String> = data
        .active_profile_id
        .as_ref()
        .and_then(|id| data.profiles.iter().find(|p| &p.id == id))
        .map(|p| p.active_mods.iter().cloned().collect())
        .unwrap_or_default();
    let tag_name: std::collections::HashMap<String, String> = data.custom_tags.iter().map(|t| (t.id.clone(), t.name.clone())).collect();
    let mods = data
        .mods
        .iter()
        .map(|m| ask_core::ModInfo {
            id: m.id.clone(),
            name: m.name.clone(),
            description: m.description.clone().unwrap_or_default(),
            tags: m.tags.iter().map(|t| tag_name.get(t).cloned().unwrap_or_else(|| t.clone())).collect(),
            enabled: active.contains(&m.id),
            files: m.cached_files.clone().filter(|f| !f.is_empty()).unwrap_or_else(|| m.installed_files.clone()),
        })
        .collect();
    let profiles = data.profiles.iter().map(|p| ask_core::ProfileInfo { id: p.id.clone(), name: p.name.clone(), game: p.game_name.clone(), active_count: p.active_mods.len() }).collect();
    Ok(ask_core::Library { mods, profiles })
}

/// Ask a question; structured results. `use_laya: false` = retrieval only. `write: true` adds
/// `written` (an answer worded by the user's generator from the retrieved sources, citing them),
/// when « Rédaction » and « Réponse rédigée » are on — else `written_off` says why.
pub fn ask(question: &str, lang: &str, scope: &str, limit: usize, use_laya: bool, write: bool) -> Result<Value, String> {
    if question.trim().is_empty() {
        return Err("empty question".into());
    }
    let lib = ask_library()?;
    let dir = state_bridge::get_bmm_data_dir();
    let settings = settings_now(&dir);
    let engine = ai_embedded::Embedded;
    let (model, why) = if use_laya {
        match ask_core::usable_model(&settings, ai_core::kill_switch(), &engine) {
            Ok(m) => (Some(m), ""),
            Err(w) => (None, w),
        }
    } else {
        (None, "not_requested")
    };
    let req = ask_core::Request { question: question.to_string(), lang: lang.to_string(), scope: scope.to_string(), limit, extra: Vec::new() };
    let (a, written, written_off) = with_ctx(&dir, None, |ctx| ai_hybrid::ask(ctx, &req, &lib, model, write));
    let mut v = json!(a);
    v["laya_off"] = json!(why);
    v["written"] = json!(written);
    v["written_off"] = json!(written_off);
    v["note"] = json!("Results are things that exist in BMM or in the user's library (quoted, never generated), except `written`: a model's wording of the numbered sources, a suggestion to show as such. A hit's action: {page, anchor} = a documentation page, {article} = a help article, {command} = a palette command, {mod} / {profile} = open it.");
    Ok(v)
}

/// Download, verify and install the pack; `progress` gets every tick (the CLI prints it).
pub fn pack_install(progress: &dyn Fn(&ai_embedded::Progress)) -> Result<Value, String> {
    if ai_core::kill_switch() {
        return Err("AI is off for this run (--no-ai / BMM_NO_AI)".into());
    }
    let cancel = std::sync::atomic::AtomicBool::new(false);
    let r = ai_embedded::install_user_copy(&|p| progress(&p), &cancel)?;
    let dir = state_bridge::get_bmm_data_dir();
    let mut s = ai_core::load_settings(&dir);
    if !s.classifier_chosen || s.classifier == "off" {
        s.classifier = "embedded".into();
        let _ = ai_core::save_settings(&dir, &s);
    }
    Ok(json!({ "result": r, "status": ai_embedded::status(), "note": "Installed. The AI features still need the master switch (Settings → AI) — installing turns nothing on by itself." }))
}

/// Remove the downloaded pack (never the installer's copy).
pub fn pack_remove() -> Result<Value, String> {
    let r = ai_embedded::remove_user_copy()?;
    if !ai_embedded::installed() {
        let dir = state_bridge::get_bmm_data_dir();
        let mut s = ai_core::load_settings(&dir);
        if s.classifier == "embedded" {
            s.classifier = "off".into();
            s.classifier_chosen = true;
            let _ = ai_core::save_settings(&dir, &s);
        }
    }
    Ok(json!({ "result": r, "status": ai_embedded::status() }))
}

/// Classify the fixed sample with the installed model, with timings.
pub fn self_test() -> Result<Value, String> {
    if ai_core::kill_switch() {
        return Err("AI is off for this run (--no-ai / BMM_NO_AI)".into());
    }
    if !ai_embedded::installed() {
        return Err("The embedded model is not installed: bmm ai-install (or Settings → AI → Install).".into());
    }
    ai_embedded::self_test()
}
