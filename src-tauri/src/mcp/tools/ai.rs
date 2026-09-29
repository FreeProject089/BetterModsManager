//! Optional AI tools for MCP clients and the CLI (`bmm_ai_status`, `bmm_ai_suggest_mod_metadata`,
//! `bmm_ai_apply_mod_metadata`; `ai-status`, `ai-suggest`, `ai-apply`).
//!
//! Same engine as the app (`commands/ai_core.rs`, mounted into this binary), same rules:
//! suggesting NEVER writes; applying writes only the fields named, through the same validation
//! as the in-app dialog, straight to data.json like the other write tools (`bmm_set_mod_enabled`).
//! A classifier or generative provider is only called when the user turned AI on in BMM and
//! picked one — with the master switch off this answers from the mod's own files, offline.

use serde_json::{json, Value};

use crate::commands::ai_core::{self, BcAuth, Ctx, Feature, HttpTransport, ModFacts};
use crate::mcp::state_bridge;

pub fn status() -> Value {
    ai_core::status(&state_bridge::get_bmm_data_dir())
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
        let settings = ai_core::load_settings(&dir);
        let killed = ai_core::kill_switch();
        let t = HttpTransport;
        let ctx = Ctx {
            settings: &settings,
            transport: &t,
            killed,
            local_key: ai_core::get_secret(&dir, "local_key"),
            external_key: ai_core::get_secret(&dir, "external_key"),
            bc: bc_auth(&dir),
        };
        let text = ai_core::provider_text(&facts, &ex);
        match ai_core::gate(&settings, Feature::ModSuggest, killed) {
            Ok(_) => {
                let (s, n) = ai_core::classify_mod(&ctx, &text, &vocab);
                sent = Some(text.clone());
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
