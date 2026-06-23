//! Consume the first-run handoff written by BetterInstaller.
//!
//! BetterInstaller (the new installer) can pre-configure BMM at install time and
//! drop a standard `installer-handoff.json` next to BMM's `data.json`. On first
//! launch BMM reads it ONCE, applies the choices, then renames it to
//! `installer-handoff.consumed.json` so it never re-applies.
//!
//! This is the app side of the app-agnostic handoff contract (see
//! `.Assets/.md/PLAN_BETTER_INSTALLER.md`, v3 Addendum §C). Version-agnostic: it
//! derives the directory from `AppState.data_path`, not from any Tauri path API.

use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;

use crate::state::AppState;

/// Shape of the file we read. We only care about `settings`; unknown keys are
/// ignored. Every value is validated/clamped — never trusted blindly.
#[derive(Debug, Deserialize)]
struct HandoffFile {
    #[serde(default)]
    source: String,
    #[serde(default)]
    settings: serde_json::Map<String, serde_json::Value>,
}

/// Returned to the frontend so it can satisfy the localStorage-gated first-run
/// modals (legal/privacy/language) that live on the JS side.
#[derive(Debug, Default, Serialize)]
pub struct HandoffResult {
    /// A handoff file was found and consumed.
    pub applied: bool,
    /// privacy_accepted && tos_accepted — lets the UI skip the EULA/privacy modals.
    pub legal_accepted: bool,
    /// A concrete language was applied — lets the UI skip the language picker.
    pub language_set: bool,
}

#[tauri::command]
pub fn consume_installer_handoff(state: State<AppState>) -> HandoffResult {
    let mut res = HandoffResult::default();

    let dir = match state.data_path.parent() {
        Some(d) => d.to_path_buf(),
        None => return res,
    };
    let file = dir.join("installer-handoff.json");
    if !file.exists() {
        return res; // the normal case (installed without BetterInstaller)
    }

    let raw = match std::fs::read_to_string(&file) {
        Ok(s) => s,
        Err(_) => return res,
    };
    let parsed: HandoffFile = match serde_json::from_str(&raw) {
        Ok(p) => p,
        Err(_) => {
            mark_consumed(&file); // corrupt → don't keep retrying
            return res;
        }
    };
    if !parsed.source.is_empty() && parsed.source != "betterinstaller" {
        mark_consumed(&file);
        return res;
    }

    if let Ok(mut data) = state.data.lock() {
        res = apply_settings(&parsed.settings, &mut data.settings);
    }
    let _ = state.save();

    crate::commands::crash::log_line(format!(
        "[HANDOFF] consumed installer-handoff.json (legal={}, lang_set={})",
        res.legal_accepted, res.language_set
    ));
    mark_consumed(&file);
    res
}

fn mark_consumed(file: &Path) {
    let consumed = file.with_file_name("installer-handoff.consumed.json");
    let _ = std::fs::rename(file, consumed);
}

/// Pure mapping from handoff `settings` to BMM's [`crate::state::AppSettings`].
/// Every value is validated; unknown keys are ignored.
fn apply_settings(
    s: &serde_json::Map<String, serde_json::Value>,
    settings: &mut crate::state::AppSettings,
) -> HandoffResult {
    let mut res = HandoffResult { applied: true, ..Default::default() };

    // Language: only a real, non-"auto" value overrides the default.
    if let Some(lang) = s.get("language").and_then(|v| v.as_str()) {
        let lang = lang.trim();
        if !lang.is_empty() && lang != "auto" {
            settings.language = lang.to_string();
            res.language_set = true;
        }
    }
    // Skip the interactive tutorial.
    if s.get("skip_tutorial").and_then(|v| v.as_bool()) == Some(true) {
        settings.onboarding_shown = true;
    }
    // Telemetry consent (explicit opt-in/out).
    if let Some(tel) = s.get("telemetry").and_then(|v| v.as_bool()) {
        settings.analytics_consent = Some(tel);
    }

    let privacy = s.get("privacy_accepted").and_then(|v| v.as_bool()).unwrap_or(false);
    let tos = s.get("tos_accepted").and_then(|v| v.as_bool()).unwrap_or(false);
    res.legal_accepted = privacy && tos;
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Mirrors exactly what BetterInstaller writes for the BMM installer.toml
    /// (flat keys after stripping the `settings.` prefix).
    const HANDOFF: &str = r#"{
        "schema": 1,
        "source": "betterinstaller",
        "app_version": "1.0.0",
        "components": ["core", "mcp-server"],
        "settings": {
            "language": "fr",
            "privacy_accepted": true,
            "tos_accepted": true,
            "skip_tutorial": true,
            "telemetry": false
        }
    }"#;

    #[test]
    fn applies_betterinstaller_handoff() {
        let file: HandoffFile = serde_json::from_str(HANDOFF).unwrap();
        let mut settings = crate::state::AppSettings::default();
        settings.onboarding_shown = false;

        let res = apply_settings(&file.settings, &mut settings);

        assert!(res.applied);
        assert!(res.legal_accepted); // privacy && tos
        assert!(res.language_set);
        assert_eq!(settings.language, "fr");
        assert!(settings.onboarding_shown); // tutorial skipped
        assert_eq!(settings.analytics_consent, Some(false));
    }

    #[test]
    fn auto_language_does_not_override() {
        let json = r#"{ "source":"betterinstaller", "settings": { "language":"auto" } }"#;
        let file: HandoffFile = serde_json::from_str(json).unwrap();
        let mut settings = crate::state::AppSettings::default();
        let before = settings.language.clone();
        let res = apply_settings(&file.settings, &mut settings);
        assert!(!res.language_set);
        assert_eq!(settings.language, before);
        assert!(!res.legal_accepted); // no legal keys → not accepted
    }
}
