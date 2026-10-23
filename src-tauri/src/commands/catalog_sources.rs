//! Which catalogues this BMM follows, where something other than the interface can read it.
//!
//! The lists live in `localStorage`, which is the right place for them: they are the user's
//! own preferences, written and read entirely by the screens that show them. It is also a
//! place the Rust side cannot see, and that had a consequence nobody had written down —
//! **the entire catalogue subsystem was unreachable from a script, the CLI, an assistant or
//! a deeplink.** You could add a source by clicking, and by no other means.
//!
//! So this is a MIRROR, and it is called one. The interface is still the writer; it pushes
//! the whole map here whenever a list changes, and this file is what the API, the CLI and
//! the MCP tools read.
//!
//! Two things follow from it being a mirror, and both are deliberate:
//!
//!  - **It can be stale, and it says when it was written.** A reader that reports a
//!    timestamp lets somebody tell "BMM has never run since this was added" from "BMM says
//!    you follow nothing". Those are different facts and only one is a bug.
//!  - **Nothing reads it back into the interface.** A mirror that could be written from
//!    outside and then loaded by the app would be a second writer, and the two would
//!    disagree the first time both changed. Following a catalogue from outside goes through
//!    the interface, the same way every other write does.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// What the interface last said it follows.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct CatalogSources {
    /// Catalogue type (`plugin`, `theme`, `list`, …) → the addresses followed.
    #[serde(default)]
    pub sources: BTreeMap<String, Vec<String>>,
    /// When the interface last pushed this, RFC 3339. Absent means it never has.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub written_at: Option<String>,
}

fn path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("catalog-sources.json"))
}

/// Push the whole map. Called by the interface after any change to a source list.
///
/// The WHOLE map, not a delta. A delta would need this side to know how each list is
/// ordered and de-duplicated, which is a second copy of rules that live in one place now.
#[tauri::command]
pub fn catalog_sources_set(
    app: tauri::AppHandle,
    sources: BTreeMap<String, Vec<String>>,
) -> Result<(), String> {
    // Only http(s) survives, here as well as in the parser that produced them. This file is
    // read by the CLI and by an assistant and the addresses in it get fetched; a `file://`
    // that arrived through a bug upstream must not be handed on by the one component whose
    // whole job is handing them on.
    let cleaned: BTreeMap<String, Vec<String>> = sources
        .into_iter()
        .map(|(k, v)| {
            let urls = v
                .into_iter()
                .filter(|u| u.starts_with("http://") || u.starts_with("https://") || u.starts_with("bundle:"))
                .collect();
            (k, urls)
        })
        .collect();
    let doc = CatalogSources {
        sources: cleaned,
        written_at: Some(chrono::Utc::now().to_rfc3339()),
    };
    std::fs::write(
        path(&app)?,
        serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

/// Read the mirror. An absent file is an empty map with no timestamp, not an error — it is
/// the ordinary state of a BMM that has not been opened since this existed.
#[tauri::command]
pub fn catalog_sources_get(app: tauri::AppHandle) -> Result<CatalogSources, String> {
    let p = path(&app)?;
    let Ok(text) = std::fs::read_to_string(&p) else {
        return Ok(CatalogSources::default());
    };
    Ok(serde_json::from_str(&text).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_addresses_that_can_be_fetched_survive() {
        // The reader downstream is a CLI or an assistant, and what it does with these is
        // fetch them. `javascript:` and `file://` are the reason this filters rather than
        // trusting what it was handed.
        let mut m = BTreeMap::new();
        m.insert(
            "theme".to_string(),
            vec![
                "https://ok.example/catalog.json".to_string(),
                "file:///etc/passwd".to_string(),
                "javascript:alert(1)".to_string(),
                "bundle:C:/somewhere/pack.bmmbundle".to_string(),
            ],
        );
        let cleaned: BTreeMap<String, Vec<String>> = m
            .into_iter()
            .map(|(k, v)| {
                (
                    k,
                    v.into_iter()
                        .filter(|u| {
                            u.starts_with("http://") || u.starts_with("https://") || u.starts_with("bundle:")
                        })
                        .collect::<Vec<_>>(),
                )
            })
            .collect();
        assert_eq!(
            cleaned.get("theme").unwrap(),
            &vec![
                "https://ok.example/catalog.json".to_string(),
                // A bundle is a local file the user picked themselves, and the screens
                // already read it as `bundle:<path>`. It is kept because dropping it would
                // make the mirror disagree with what the app shows.
                "bundle:C:/somewhere/pack.bmmbundle".to_string(),
            ]
        );
    }

    #[test]
    fn a_missing_mirror_is_empty_rather_than_broken() {
        let doc = CatalogSources::default();
        assert!(doc.sources.is_empty());
        // No timestamp is the signal a reader needs: "the app has never pushed" and "the
        // app pushed an empty list" are different facts, and only one of them is a bug.
        assert!(doc.written_at.is_none());
    }

    #[test]
    fn the_document_round_trips() {
        let mut sources = BTreeMap::new();
        sources.insert("plugin".to_string(), vec!["https://a.example/c.json".to_string()]);
        let doc = CatalogSources { sources, written_at: Some("2026-08-26T00:00:00Z".into()) };
        let back: CatalogSources = serde_json::from_str(&serde_json::to_string(&doc).unwrap()).unwrap();
        assert_eq!(back.sources.get("plugin").unwrap().len(), 1);
        assert_eq!(back.written_at.as_deref(), Some("2026-08-26T00:00:00Z"));
    }

    #[test]
    fn an_unreadable_mirror_reads_as_empty_not_as_a_crash() {
        // The file is written by the app and could be half-written after a crash. A parse
        // failure here must not take out `bmm catalogs` or the API route that reads it.
        let doc: CatalogSources = serde_json::from_str("{ not json").unwrap_or_default();
        assert!(doc.sources.is_empty());
    }
}
