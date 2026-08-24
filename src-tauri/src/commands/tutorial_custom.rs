//! Custom interactive tutorials — authored in BMM, shared as `.bmmtut` files.
//!
//! WHY A DOCUMENT AND NOT A CODE PATH
//!
//! The official tutorials are TypeScript objects whose every string is an i18n key. That is
//! the right shape for content that ships with the app and the wrong shape for content a
//! person makes: a user cannot add keys to Lang/*.json, and a tutorial that only works on the
//! machine that wrote it is not shareable. So a custom tutorial is a JSON document carrying
//! LITERAL text (per-language, French optional), and the frontend materialises runtime keys
//! from it — the engine keeps calling t() and never learns the difference.
//!
//! WHAT THIS FILE TRUSTS
//!
//! Nothing. An imported document is somebody else's file: the id becomes a filename (checked
//! for path traversal), the shape is validated before anything is written, and the step texts
//! are sanitised ON THE FRONTEND at render-build time — the engine interpolates step text as
//! HTML (official steps use <b> on purpose), so a shared file is an XSS vector unless the
//! tags are whitelisted. Signing follows modpacks: sign_doc("bmmtut") on export, and the
//! signature travels so BCWEB's inspector and other BMMs can say who wrote it.

use serde_json::Value;
use tauri::Manager;

use crate::error::AppError;

type AppResult<T> = Result<T, AppError>;

fn dir(handle: &tauri::AppHandle) -> AppResult<std::path::PathBuf> {
    let d = handle
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(e.to_string()))?
        .join("custom-tutorials");
    std::fs::create_dir_all(&d).map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(d)
}

/// A usable id: becomes `<id>.json` on disk, so nothing that walks. Same contract as every
/// other name-that-becomes-a-path in this codebase (CWE-22).
fn checked_id(doc: &Value) -> AppResult<String> {
    let id = doc.get("id").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    if id.is_empty() || id.len() > 64 {
        return Err(AppError::Internal("tutorial id is required (max 64 chars)".into()));
    }
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(AppError::Internal("tutorial id may only carry a-z, 0-9, - and _".into()));
    }
    Ok(id)
}

/// The shape check, before anything touches the disk.
///
/// Deliberately structural rather than exhaustive: the frontend re-validates and SANITISES
/// when it builds the runtime definition, so this only refuses documents that could not be a
/// tutorial at all — accepting one of those would store a file the hub then chokes on every
/// launch, which is a worse failure than refusing the import with a reason.
fn check_shape(doc: &Value) -> AppResult<()> {
    if doc.get("format").and_then(|v| v.as_str()) != Some("bmmtut") {
        return Err(AppError::Internal("not a .bmmtut document (format field missing)".into()));
    }
    let parts = doc.get("parts").and_then(|v| v.as_array())
        .ok_or_else(|| AppError::Internal("tutorial has no parts[]".into()))?;
    if parts.is_empty() || parts.len() > 40 {
        return Err(AppError::Internal("a tutorial needs 1..40 parts".into()));
    }
    for p in parts {
        let steps = p.get("steps").and_then(|v| v.as_array())
            .ok_or_else(|| AppError::Internal("a part has no steps[]".into()))?;
        if steps.is_empty() || steps.len() > 60 {
            return Err(AppError::Internal("a part needs 1..60 steps".into()));
        }
    }
    Ok(())
}

/// Every stored custom tutorial, whole documents. The hub builds definitions from these.
#[tauri::command]
pub fn tutorial_custom_list(handle: tauri::AppHandle) -> AppResult<Vec<Value>> {
    let mut out = Vec::new();
    let d = dir(&handle)?;
    let Ok(entries) = std::fs::read_dir(&d) else { return Ok(out) };
    for e in entries.flatten() {
        let path = e.path();
        if path.extension().and_then(|x| x.to_str()) != Some("json") { continue; }
        // One unreadable file must not hide the rest — skip it, and say so in the log.
        match std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()) {
            Some(doc) => out.push(doc),
            None => tracing::warn!("custom tutorial unreadable, skipped: {}", path.display()),
        }
    }
    // Stable order: by id, so the hub does not reshuffle between launches.
    out.sort_by(|a, b| {
        let ka = a.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let kb = b.get("id").and_then(|v| v.as_str()).unwrap_or("");
        ka.cmp(kb)
    });
    Ok(out)
}

/// Create or replace one (the creator's Save). Signed at save time so the exported file and
/// the stored one are the same bytes — an export is a copy, not a transformation.
#[tauri::command]
pub fn tutorial_custom_save(handle: tauri::AppHandle, mut doc: Value) -> AppResult<Value> {
    check_shape(&doc)?;
    let id = checked_id(&doc)?;
    crate::commands::doc_sign::sign_doc(&handle, &mut doc, "bmmtut");
    let path = dir(&handle)?.join(format!("{id}.json"));
    std::fs::write(&path, serde_json::to_string_pretty(&doc).map_err(|e| AppError::Internal(e.to_string()))?)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(doc)
}

#[tauri::command]
pub fn tutorial_custom_delete(handle: tauri::AppHandle, id: String) -> AppResult<()> {
    let id_doc = serde_json::json!({ "id": id });
    let id = checked_id(&id_doc)?;
    let path = dir(&handle)?.join(format!("{id}.json"));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| AppError::Internal(e.to_string()))?;
    }
    Ok(())
}

/// Import a `.bmmtut` from disk (file picker) or from fetched bytes (a catalogue install).
///
/// Returns the stored document plus `signature`: "valid" | "invalid" | "unsigned". The
/// verdict is informational — an unsigned tutorial is importable, the same stance every BMM
/// document takes — but "invalid" means the file was EDITED after signing, and the caller
/// shows that in red rather than quietly accepting a tampered file as its author's work.
#[tauri::command]
pub fn tutorial_custom_import(handle: tauri::AppHandle, text: String) -> AppResult<Value> {
    let doc: Value = serde_json::from_str(&text)
        .map_err(|_| AppError::Internal("not a JSON document".into()))?;
    check_shape(&doc)?;
    let id = checked_id(&doc)?;
    let verdict = match crate::commands::doc_sign::verify_doc(&doc, "bmmtut") {
        crate::commands::doc_sign::Verdict::Valid { .. } => "valid",
        crate::commands::doc_sign::Verdict::Unsigned => "unsigned",
        // Tampered and Malformed collapse to one word for the caller: both mean "do not
        // present this as its author's work", and the distinction lives in the log.
        _ => "invalid",
    };
    let path = dir(&handle)?.join(format!("{id}.json"));
    std::fs::write(&path, serde_json::to_string_pretty(&doc).map_err(|e| AppError::Internal(e.to_string()))?)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(serde_json::json!({ "doc": doc, "signature": verdict }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_walking_id_is_refused() {
        for bad in ["../x", "a/b", "a\\b", "", "x".repeat(65).as_str()] {
            let doc = serde_json::json!({ "id": bad });
            assert!(checked_id(&doc).is_err(), "{bad:?} must be refused");
        }
    }

    #[test]
    fn shape_is_checked_before_storage() {
        assert!(check_shape(&serde_json::json!({})).is_err());
        assert!(check_shape(&serde_json::json!({ "format": "bmmtut" })).is_err());
        assert!(check_shape(&serde_json::json!({ "format": "bmmtut", "parts": [] })).is_err());
        assert!(check_shape(&serde_json::json!({
            "format": "bmmtut",
            "parts": [{ "steps": [{ "id": "s1" }] }]
        })).is_ok());
    }
}
