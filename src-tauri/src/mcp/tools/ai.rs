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

use crate::commands::ai_core::{self, BcAuth, Ctx, Feature, HttpTransport, ModFacts};
use crate::commands::ai_embedded;
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

/// Suggestions for one mod. Returns them; writes nothing.
pub fn suggest(mod_id: &str, use_providers: bool, draft: bool) -> Result<Value, String> {
    let dir = state_bridge::get_bmm_data_dir();
    let data = state_bridge::read_app_data().map_err(|e| format!("Failed to read BMM data: {}", e))?;
    let m = find(&data, mod_id)?;
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
    let ex = ai_core::extract(&facts, &vocab, &[]);
    let mut all = ex.suggestions.clone();
    let mut notes: Vec<String> = Vec::new();
    let mut sent: Option<String> = None;
    if use_providers {
        let settings = ai_core::effective_settings(ai_core::load_settings(&dir), ai_embedded::installed());
        let killed = ai_core::kill_switch();
        let t = HttpTransport;
        let ctx = Ctx {
            settings: &settings,
            transport: &t,
            local_model: Some(&ai_embedded::Embedded),
            killed,
            local_key: ai_core::get_secret(&dir, "local_key"),
            external_key: ai_core::get_secret(&dir, "external_key"),
            bc: bc_auth(&dir),
        };
        let text = ai_core::provider_text(&facts, &ex);
        match ai_core::gate(&settings, Feature::ModSuggest, killed) {
            Ok(_) => {
                let (s, n) = ai_core::classify_mod(&ctx, &text, &vocab);
                // The embedded engine runs in this process: nothing was sent anywhere.
                if settings.classifier != "embedded" {
                    sent = Some(text.clone());
                }
                all.extend(s);
                notes.extend(n);
            }
            Err(why) => notes.push(format!("classifier:{}", why)),
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
    Ok(json!({
        "mod_id": m.id,
        "mod_name": m.name,
        "suggestions": ai_core::finalize(all, &facts),
        "notes": notes,
        "sources_read": ex.sources_read,
        "sent_text": sent,
        "applied": false,
        "how_to_apply": "Nothing was written. Call bmm_ai_apply_mod_metadata with the fields the user chose, e.g. { \"mod_id\": \"…\", \"fields\": { \"description\": \"…\", \"tags\": [\"<tag id>\"] } }. Suggestions with applicable=false (language, nsfw) are hints and cannot be applied.",
    }))
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

/// Ask a question; structured results only. `use_laya: false` = retrieval only.
pub fn ask(question: &str, lang: &str, scope: &str, limit: usize, use_laya: bool) -> Result<Value, String> {
    if question.trim().is_empty() {
        return Err("empty question".into());
    }
    let lib = ask_library()?;
    let dir = state_bridge::get_bmm_data_dir();
    let settings = ai_core::effective_settings(ai_core::load_settings(&dir), ai_embedded::installed());
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
    let a = ask_core::answer(&req, &lib, model);
    let mut v = json!(a);
    v["laya_off"] = json!(why);
    v["note"] = json!("Results are things that exist in BMM or in the user's library (quoted, never generated). A hit's action: {page, anchor} = a documentation page, {article} = a help article, {command} = a palette command, {mod} / {profile} = open it.");
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
