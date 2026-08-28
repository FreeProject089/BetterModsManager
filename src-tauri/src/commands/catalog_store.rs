//! The catalogues this machine AUTHORS — not the ones it follows.
//!
//! Two different things share the word "catalogue" and it is worth separating them here,
//! because confusing them is how somebody deletes the wrong one:
//!
//!  - the catalogues you **follow** are addresses, owned by the interface, mirrored for
//!    scripts by `catalog_sources.rs`, and changed through `catalog/follow`;
//!  - the catalogues you **author** are documents on this disk, one per kind, and this is
//!    them.
//!
//! This started inside `api/mod.rs` as four private helpers written against `cat["apps"]`, so
//! the only way to touch an authored catalogue was an HTTP request to the local API with its
//! token. A scheduled task, the deeplink handler and the interface all had to go the long way
//! round or not at all — and the scheduler chose not at all: it could publish a catalogue and
//! follow one, and could neither change nor remove either.
//!
//! Here as commands instead, with `api/mod.rs` calling the same functions. One implementation
//! of "which file, which array, what happens when it is not there".

use serde_json::Value;

/// Which kinds can be authored, and the array each keeps its entries in.
///
/// The array names are the ones the FORMAT uses, and `check-catalog-kinds.mjs` holds them
/// against the interface's own CATALOG_SHAPES. Writing entries under the wrong name produces
/// a document that parses as an EMPTY catalogue of the right kind: valid JSON, nothing in it,
/// and nothing anywhere saying why.
pub const CATALOG_KINDS: &[(&str, &str)] = &[
    ("app", "apps"),
    ("plugin", "plugins"),
    ("theme", "themes"),
    ("preset", "presets"),
    ("modpack", "modpacks"),
    ("repo", "repos"),
    ("tutorial", "tutorials"),
    ("list", "lists"),
];

/// The entries array for a kind, or None if it is not a kind.
///
/// None rather than a default: a typo'd type that silently edited the app catalogue is the
/// worst outcome available here.
pub fn entries_key(kind: &str) -> Option<&'static str> {
    CATALOG_KINDS.iter().find(|(k, _)| *k == kind).map(|(_, v)| *v)
}

/// The kind a caller asked for, defaulting to `app`, or an error naming what is allowed.
pub fn kind_of(v: Option<&str>) -> Result<String, String> {
    let kind = v.unwrap_or("app");
    if entries_key(kind).is_some() {
        return Ok(kind.to_string());
    }
    Err(format!(
        "unknown catalogue type '{}'. One of: {}",
        kind,
        CATALOG_KINDS.iter().map(|(k, _)| *k).collect::<Vec<_>>().join(", ")
    ))
}

/// Where one kind's authored catalogue lives.
///
/// `app` keeps `apps-catalog.json`, which exists on every installation already; moving it
/// would lose what is in it.
pub fn path_for(app: &tauri::AppHandle, kind: &str) -> std::path::PathBuf {
    use tauri::Manager;
    let dir = app.path().app_data_dir().ok().unwrap_or_default();
    if kind == "app" { dir.join("apps-catalog.json") } else { dir.join(format!("{kind}-catalog.json")) }
}

pub fn empty_for(kind: &str) -> Value {
    let key = entries_key(kind).unwrap_or("apps");
    let mut v = serde_json::json!({
        "version": "1.0", "name": "Local Catalog", "description": "",
        "partner_catalogs": [], "community_imports": []
    });
    v[key] = serde_json::json!([]);
    v
}

pub fn read_kind(app: &tauri::AppHandle, kind: &str) -> Value {
    std::fs::read_to_string(path_for(app, kind))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| empty_for(kind))
}

pub fn write_kind(app: &tauri::AppHandle, kind: &str, cat: &Value) -> Result<(), String> {
    let p = path_for(app, kind);
    if let Some(parent) = p.parent() { let _ = std::fs::create_dir_all(parent); }
    serde_json::to_string_pretty(cat)
        .map_err(|e| e.to_string())
        .and_then(|s| std::fs::write(&p, s).map_err(|e| e.to_string()))
}

/// Add, change or remove ONE entry, matched on its id.
///
/// One function for the three because they differ in two lines and share every rule that
/// matters: which file, which array, and that an entry without an id can be written and then
/// never touched again.
///
/// `mode` is `add` · `update` · `remove`. Anything else is refused rather than treated as one
/// of them — a typo that silently added instead of removing is not recoverable from a log.
#[tauri::command]
pub fn catalog_entry(
    app: tauri::AppHandle,
    kind: Option<String>,
    mode: String,
    id: String,
    fields: Option<Value>,
) -> Result<Value, String> {
    let kind = kind_of(kind.as_deref())?;
    let key = entries_key(&kind).unwrap_or("apps");
    if id.trim().is_empty() {
        return Err("an entry id is required — update and remove match on it".into());
    }
    let mut cat = read_kind(&app, &kind);
    if cat[key].as_array().is_none() {
        cat[key] = serde_json::json!([]);
    }

    match mode.as_str() {
        "add" => {
            if cat[key].as_array().is_some_and(|a| {
                a.iter().any(|e| e.get("id").and_then(|v| v.as_str()) == Some(id.as_str()))
            }) {
                return Err(format!("'{id}' is already in the {kind} catalogue"));
            }
            let mut entry = fields.unwrap_or_else(|| serde_json::json!({}));
            if let Some(o) = entry.as_object_mut() {
                o.insert("id".into(), Value::String(id.clone()));
            }
            if let Some(arr) = cat[key].as_array_mut() { arr.push(entry); }
        }
        "update" => {
            let mut found = false;
            if let Some(arr) = cat[key].as_array_mut() {
                for e in arr.iter_mut() {
                    if e.get("id").and_then(|v| v.as_str()) == Some(id.as_str()) {
                        if let (Some(o), Some(upd)) = (e.as_object_mut(), fields.as_ref().and_then(|f| f.as_object())) {
                            // `type` said which catalogue to open. Writing it into the entry
                            // would put a field there the format has no place for.
                            for (k, v) in upd { if k != "type" { o.insert(k.clone(), v.clone()); } }
                        }
                        found = true;
                        break;
                    }
                }
            }
            if !found { return Err(format!("no '{id}' in the {kind} catalogue")); }
        }
        "remove" => {
            let before = cat[key].as_array().map(|a| a.len()).unwrap_or(0);
            if let Some(arr) = cat[key].as_array_mut() {
                arr.retain(|e| e.get("id").and_then(|v| v.as_str()) != Some(id.as_str()));
            }
            if cat[key].as_array().map(|a| a.len()).unwrap_or(0) == before {
                return Err(format!("no '{id}' in the {kind} catalogue"));
            }
        }
        other => return Err(format!("unknown mode '{other}'. One of: add, update, remove")),
    }

    write_kind(&app, &kind, &cat)?;
    Ok(serde_json::json!({
        "ok": true, "type": kind, "mode": mode, "id": id,
        "total": cat[key].as_array().map(|a| a.len()).unwrap_or(0),
    }))
}

/// Throw away the whole authored catalogue of one kind.
///
/// Errors when there is nothing there. "Deleted" and "there was never one" are different
/// answers, and a task branching on it deserves to know which.
#[tauri::command]
pub fn catalog_drop(app: tauri::AppHandle, kind: Option<String>) -> Result<Value, String> {
    let kind = kind_of(kind.as_deref())?;
    let p = path_for(&app, &kind);
    if !p.exists() { return Err(format!("no {kind} catalogue here")); }
    std::fs::remove_file(&p).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "ok": true, "type": kind }))
}

/// One kind's authored catalogue, as it stands.
#[tauri::command]
pub fn catalog_authored_get(app: tauri::AppHandle, kind: Option<String>) -> Result<Value, String> {
    let kind = kind_of(kind.as_deref())?;
    Ok(read_kind(&app, &kind))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_kind_has_an_entries_array_and_nothing_else_does() {
        for (kind, key) in CATALOG_KINDS {
            assert_eq!(entries_key(kind), Some(*key));
            // The empty document carries the array the format expects, so a caller that
            // reads before writing sees a catalogue of the right shape rather than one
            // missing its only list.
            assert!(empty_for(kind)[*key].is_array(), "{kind} has no {key} array");
        }
        assert_eq!(entries_key("nope"), None);
    }

    #[test]
    fn an_unknown_kind_is_named_not_defaulted() {
        // Falling back to `app` would edit the app catalogue on a typo, which is the one
        // outcome nobody could diagnose from the result.
        let e = kind_of(Some("plugins")).unwrap_err();
        assert!(e.contains("plugins"), "{e}");
        assert!(e.contains("plugin"), "the message should name what IS allowed: {e}");
        assert_eq!(kind_of(None).unwrap(), "app");
    }
}
