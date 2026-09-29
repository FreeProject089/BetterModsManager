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
use tauri::{Manager, State};

use crate::state::AppState;

/// Copy every `*.json` from `src` into `dst` (created if needed). Returns the count.
/// Skips traversal-y names. Used to seed bundled languages/themes on first run.
fn copy_json_dir(src: &Path, dst: &Path) -> u32 {
    if !src.is_dir() {
        return 0;
    }
    let _ = std::fs::create_dir_all(dst);
    let mut n = 0;
    if let Ok(entries) = std::fs::read_dir(src) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
                if name.contains("..") {
                    continue;
                }
                if std::fs::copy(&p, dst.join(name)).is_ok() {
                    n += 1;
                }
            }
        }
    }
    n
}

/// Shape of the file we read. We only care about `settings`; unknown keys are
/// ignored. Every value is validated/clamped — never trusted blindly.
#[derive(Debug, Deserialize)]
struct HandoffFile {
    #[serde(default)]
    source: String,
    /// Where BetterInstaller installed the app (holds any bundled preset file).
    #[serde(default)]
    install_dir: String,
    #[serde(default)]
    settings: serde_json::Map<String, serde_json::Value>,
}

/// Name of the optional preset bundled into the install dir (a normal BMM
/// `_bmm_backup` export — themes, translations, catalogue, plugins, settings).
const PRESET_FILE: &str = "bmm-preset.json";

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
    /// Path to a bundled BMM preset the installer asked us to import (themes,
    /// translations, catalogue, plugins). The frontend imports it via
    /// `import_app_data`. `None` when there's nothing to pre-import.
    pub import_preset_path: Option<String>,
    /// How many bundled language packs were copied into the Lang dir.
    pub languages_imported: u32,
    /// How many bundled themes were copied into the themes dir.
    pub themes_imported: u32,
    /// Local session recorder preference the installer chose. `Some(false)` means the
    /// user unchecked it → the frontend mirrors it to the `bmm_replay_enabled`
    /// localStorage flag (that setting lives on the JS side, not in AppSettings).
    /// `None`/`Some(true)` → leave BMM's default (on).
    pub session_recorder: Option<bool>,
    /// The installer's telemetry checkbox was TICKED. Not consent — the frontend uses it
    /// to pre-select the answer in BMM's own consent dialog, which still has to be
    /// accepted before anything is collected. An unticked box records a refusal in
    /// `analytics_consent` instead and never sets this.
    pub telemetry_preselect: Option<bool>,
    /// Weekly benchmark + extra hardware report (serials, machine UUID, MACs). Like the
    /// session recorder it lives in localStorage (`bmm_telemetry_bench`), so it is
    /// surfaced for the frontend to mirror. `None` = not asked → BMM's default (off).
    pub telemetry_bench: Option<bool>,
    /// Tasky and the in-app tip callouts. All four live in localStorage on the JS side,
    /// exactly like `session_recorder`, so they are surfaced rather than applied here.
    /// `None` means the installer said nothing and BMM's own default (all on) stands —
    /// which is why these are Option<bool> and not bool: "not mentioned" and "explicitly
    /// off" are different instructions, and collapsing them would silently turn features
    /// off for anyone who installed before these options existed.
    pub tasky_visible: Option<bool>,
    pub tasky_tooltip: Option<bool>,
    pub tasky_animated: Option<bool>,
    pub tips_visible: Option<bool>,
    /// Theme id the installer's swatch page picked. Like the session recorder this has
    /// no AppSettings field — the active theme lives in localStorage on the JS side — so
    /// it is surfaced here and the frontend writes `bmm_active_theme` before
    /// `restoreThemeAtBoot()` reads it.
    pub active_theme: Option<String>,
    /// Content-Security-Policy preset the installer offered, as a PRESET ID — never a
    /// policy string. The extra policy lives in localStorage (csp-boot.js reads it while
    /// the document parses, the only store readable that early), so like the theme it is
    /// surfaced rather than applied here.
    ///
    /// An id, because an installer field that could carry a raw policy would be a way to
    /// hand the app a CSP nobody reviewed. The frontend matches it against the presets it
    /// already ships and ignores anything else, so the worst a tampered handoff can do is
    /// name a preset that does not exist.
    pub csp_preset: Option<String>,
    /// The installer's « Laya hors ligne (IA locale, aucune donnée envoyée) » box (key kept as
    /// `ai_features` so older installers still map). Unlike the JS-side preferences above it is
    /// APPLIED here (ai-settings.json, read by Rust): ticked = master switch on with the embedded,
    /// offline engine as the provider; unticked = off. Surfaced only so the frontend can mention
    /// it. `None` = not asked → AI stays at its default (off).
    pub ai_features: Option<bool>,
}

#[tauri::command]
pub fn consume_installer_handoff(
    state: State<AppState>,
    app_handle: tauri::AppHandle,
) -> HandoffResult {
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

    // Optional AI (off unless the box was ticked). Ticked turns the master switch on with no
    // provider chosen, so still nothing is sent until the user picks one in Settings.
    if let Some(on) = res.ai_features {
        let _ = crate::commands::ai_core::apply_installer_choice(&dir, on);
    }

    // Pre-import. The installer drops bundled content under <install>/presets/.
    let want = |k: &str| {
        parsed
            .settings
            .get(k)
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
    };
    // C9-F: `install_dir` names where BMM was installed, and the files under it are copied into
    // BMM's data and offered for import. It is only ever BMM's own install folder; any other
    // folder (a download folder, a share) is ignored whatever the file says.
    let own_install_dir = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf));
    if !parsed.install_dir.is_empty() && !is_own_install_dir(&parsed.install_dir, own_install_dir.as_deref()) {
        crate::commands::crash::log_line(format!(
            "[HANDOFF] install_dir ignored: it is not BMM's install folder ({})", parsed.install_dir
        ));
    } else if !parsed.install_dir.is_empty() {
        let presets = Path::new(&parsed.install_dir).join("presets");
        // Extra language packs → BMM's Lang dir (so they're available immediately).
        if want("import_extra_languages") {
            let dst = crate::fs_utils::get_lang_dir(&app_handle);
            res.languages_imported = copy_json_dir(&presets.join("Lang"), &dst);
        }
        // Starter themes → BMM's per-user themes dir.
        if want("import_starter_themes") {
            if let Ok(data) = app_handle.path().app_data_dir() {
                res.themes_imported = copy_json_dir(&presets.join("themes"), &data.join("themes"));
            }
        }
        // A full BMM export preset (themes/translations/catalogue/plugins/settings)
        // is imported by the frontend through the existing `import_app_data`.
        if (want("import_starter_themes") || want("import_extra_languages"))
            && Path::new(&parsed.install_dir).join(PRESET_FILE).exists()
        {
            res.import_preset_path = Some(
                Path::new(&parsed.install_dir)
                    .join(PRESET_FILE)
                    .to_string_lossy()
                    .to_string(),
            );
        }
    }

    crate::commands::crash::log_line(format!(
        "[HANDOFF] consumed installer-handoff.json (legal={}, lang_set={}, langs={}, themes={}, preset={})",
        res.legal_accepted,
        res.language_set,
        res.languages_imported,
        res.themes_imported,
        res.import_preset_path.is_some()
    ));
    mark_consumed(&file);
    res
}

/// Whether the handoff's `install_dir` is BMM's own install folder (both sides canonicalised,
/// so a different spelling of the same folder still matches and `..` cannot).
fn is_own_install_dir(given: &str, own: Option<&Path>) -> bool {
    let Some(own) = own else { return false };
    match (std::fs::canonicalize(given.trim()), std::fs::canonicalize(own)) {
        (Ok(g), Ok(o)) => g == o,
        _ => false,
    }
}

/// A language code as BMM's Lang files are named (`en`, `fr`, `pt-BR`, `zh_Hans`): it becomes a
/// file name under the Lang folder, so the shape is checked like every other handoff value.
fn valid_language(lang: &str) -> bool {
    let mut parts = lang.split(['-', '_']);
    let first = parts.next().unwrap_or("");
    lang.len() <= 16
        && (2..=3).contains(&first.len())
        && first.chars().all(|c| c.is_ascii_alphabetic())
        && parts.all(|p| (2..=8).contains(&p.len()) && p.chars().all(|c| c.is_ascii_alphanumeric()))
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
        if !lang.is_empty() && lang != "auto" && valid_language(lang) {
            settings.language = lang.to_string();
            res.language_set = true;
        }
    }
    // Skip the interactive tutorial.
    if s.get("skip_tutorial").and_then(|v| v.as_bool()) == Some(true) {
        settings.onboarding_shown = true;
    }
    // Telemetry. A ticked installer box is NOT consent: it used to write
    // analytics_consent = Some(true), which started collection on first launch and made
    // BMM's own consent dialog — the only screen that lists what is collected — never
    // appear. It is now surfaced as a pre-selection the dialog starts from.
    //
    // A REFUSAL is still recorded, because it needs no further screen: nothing is
    // collected and no dialog has to ask again. (The consent dialog is what turns
    // `None` into a decision; `Some(false)` means the user already said no.)
    match s.get("telemetry").and_then(|v| v.as_bool()) {
        Some(true) => res.telemetry_preselect = Some(true),
        Some(false) => settings.analytics_consent = Some(false),
        None => {}
    }
    // Weekly benchmark + extra hardware report (serials, machine UUID, MAC addresses).
    // A JS-side setting (localStorage bmm_telemetry_bench), so it is surfaced, not applied.
    // It only ever matters once telemetry consent has actually been given.
    res.telemetry_bench = s.get("telemetry_bench").and_then(|v| v.as_bool());
    // Optional preferences the installer can pre-set (each a plain bool the user picked on
    // the Configuration page; absent key → BMM's own default is left untouched). Keys are
    // the flat form of the installer.toml `maps_to` (the `settings.` prefix is stripped).
    if let Some(v) = s.get("discord_rpc").and_then(|v| v.as_bool()) {
        settings.discord_rpc_enabled = v;
    }
    if let Some(v) = s.get("smart_io").and_then(|v| v.as_bool()) {
        settings.smart_io_enabled = v;
    }
    if let Some(v) = s.get("sound_effects").and_then(|v| v.as_bool()) {
        settings.sound_effects_enabled = v;
    }
    // System Access Control → BMM's fs_security_mode (only "full" / "limited" are valid).
    if let Some(mode) = s.get("fs_security_mode").and_then(|v| v.as_str()) {
        let mode = mode.trim();
        if mode == "full" || mode == "limited" {
            settings.fs_security_mode = Some(mode.to_string());
        }
    }
    // Local session recorder — no AppSettings field (it's a JS/localStorage flag), so we
    // just surface the choice; the frontend mirrors it to `bmm_replay_enabled`.
    res.session_recorder = s.get("session_recorder").and_then(|v| v.as_bool());

    // Tasky + in-app tips: JS/localStorage settings, surfaced for the frontend to mirror.
    res.tasky_visible = s.get("tasky_visible").and_then(|v| v.as_bool());
    res.tasky_tooltip = s.get("tasky_tooltip").and_then(|v| v.as_bool());
    res.tasky_animated = s.get("tasky_animated").and_then(|v| v.as_bool());
    res.tips_visible = s.get("tips_visible").and_then(|v| v.as_bool());

    // Active theme — same story: a JS/localStorage setting, surfaced for the frontend.
    // The installer has always WRITTEN this key (installer.toml maps the swatch page to
    // settings.active_theme); nothing here read it, so every install silently landed on
    // the default theme whatever the user picked.
    //
    // The id is validated rather than trusted: it becomes part of the
    // `bmm_theme_cache_<id>` localStorage key and is matched against built-in ids, so
    // restrict it to the shape real theme ids have. An unknown-but-well-formed id is
    // still safe — restoreThemeAtBoot falls back to resetTheme().
    res.active_theme = s
        .get("active_theme")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|id| {
            !id.is_empty()
                && id.len() <= 64
                && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        })
        .map(str::to_string);

    // CSP preset — a short lowercase id, checked for shape here and matched against the
    // real preset list on the JS side. "custom" is a deliberate no-op: it means "leave the
    // field alone, I will write one myself in Settings".
    res.csp_preset = s
        .get("csp_preset")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|id| {
            !id.is_empty()
                && id.len() <= 32
                && id.chars().all(|c| c.is_ascii_lowercase() || c == '-')
        })
        .map(str::to_string);

    // Optional AI features: a plain bool, applied by the caller to ai-settings.json.
    res.ai_features = s.get("ai_features").and_then(|v| v.as_bool());

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
            "telemetry": false,
            "telemetry_bench": false,
            "discord_rpc": true,
            "smart_io": false,
            "sound_effects": false
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
        // Unticked box = a refusal, recorded; nothing to ask again.
        assert_eq!(settings.analytics_consent, Some(false));
        assert_eq!(res.telemetry_preselect, None);
        assert_eq!(res.telemetry_bench, Some(false));
        // Optional preferences applied (each overrides BMM's default when present).
        assert!(settings.discord_rpc_enabled); // default false → set true
        assert!(!settings.smart_io_enabled); // default true → set false
        assert!(!settings.sound_effects_enabled); // default true → set false
    }

    #[test]
    fn omitted_preferences_leave_defaults_untouched() {
        // A handoff that doesn't mention the optional prefs must NOT change them.
        let json = r#"{ "source":"betterinstaller", "settings": { "language":"en" } }"#;
        let file: HandoffFile = serde_json::from_str(json).unwrap();
        let defaults = crate::state::AppSettings::default();
        let mut settings = crate::state::AppSettings::default();
        apply_settings(&file.settings, &mut settings);
        assert_eq!(settings.discord_rpc_enabled, defaults.discord_rpc_enabled);
        assert_eq!(settings.smart_io_enabled, defaults.smart_io_enabled);
        assert_eq!(settings.sound_effects_enabled, defaults.sound_effects_enabled);
    }

    /// A TICKED telemetry box must not enable collection: it only pre-selects the answer
    /// in BMM's consent dialog, which still has to be accepted.
    #[test]
    fn ticked_telemetry_box_is_a_preselection_not_consent() {
        let json = r#"{ "source":"betterinstaller", "settings": { "telemetry": true, "telemetry_bench": true } }"#;
        let file: HandoffFile = serde_json::from_str(json).unwrap();
        let mut settings = crate::state::AppSettings::default();
        let res = apply_settings(&file.settings, &mut settings);
        assert_eq!(settings.analytics_consent, None); // still undecided → the dialog runs
        assert_eq!(res.telemetry_preselect, Some(true));
        assert_eq!(res.telemetry_bench, Some(true));
    }

    /// Defaults for an install that never mentioned these: everything that sends data off
    /// the machine stays off, and telemetry stays undecided.
    #[test]
    fn unmentioned_privacy_options_stay_off() {
        let json = r#"{ "source":"betterinstaller", "settings": { "language":"en" } }"#;
        let file: HandoffFile = serde_json::from_str(json).unwrap();
        let mut settings = crate::state::AppSettings::default();
        let res = apply_settings(&file.settings, &mut settings);
        assert_eq!(settings.analytics_consent, None);
        assert!(!settings.discord_rpc_enabled);
        assert_eq!(res.telemetry_preselect, None);
        assert_eq!(res.telemetry_bench, None);
    }

    #[test]
    fn a_language_is_a_language_code_or_nothing() {
        for ok in ["en", "fr", "pt-BR", "zh_Hans", "deu"] {
            assert!(valid_language(ok), "{ok}");
        }
        for bad in ["../../x", "en/../../evil", "e", "english-language-long", "fr\\x", "en.json", "", "12"] {
            assert!(!valid_language(bad), "{bad}");
        }
        let json = r#"{ "source":"betterinstaller", "settings": { "language":"../../../evil" } }"#;
        let parsed: HandoffFile = serde_json::from_str(json).unwrap();
        let mut settings = crate::state::AppSettings::default();
        let before = settings.language.clone();
        let res = apply_settings(&parsed.settings, &mut settings);
        assert!(!res.language_set);
        assert_eq!(settings.language, before, "an invalid language is not applied");
    }

    /// C9-F: presets are read only from BMM's own install folder.
    #[test]
    fn install_dir_must_be_bmms_own() {
        let own = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        assert!(is_own_install_dir(&own.path().to_string_lossy(), Some(own.path())));
        let dotted = own.path().join("sub").join("..");
        std::fs::create_dir_all(own.path().join("sub")).unwrap();
        assert!(is_own_install_dir(&dotted.to_string_lossy(), Some(own.path())), "same folder, other spelling");
        assert!(!is_own_install_dir(&other.path().to_string_lossy(), Some(own.path())));
        assert!(!is_own_install_dir(r"\\attacker\share", Some(own.path())));
        assert!(!is_own_install_dir(&own.path().to_string_lossy(), None));
    }

    /// The installer's AI box: absent = not asked (AI stays off); present = surfaced for the
    /// caller, which writes ai-settings.json.
    #[test]
    fn ai_features_box_is_surfaced_and_absent_means_off() {
        let mut settings = crate::state::AppSettings::default();
        let file: HandoffFile = serde_json::from_str(HANDOFF).unwrap();
        assert_eq!(apply_settings(&file.settings, &mut settings).ai_features, None);
        for v in [true, false] {
            let json = format!(r#"{{ "source":"betterinstaller", "settings": {{ "ai_features": {} }} }}"#, v);
            let file: HandoffFile = serde_json::from_str(&json).unwrap();
            assert_eq!(apply_settings(&file.settings, &mut settings).ai_features, Some(v));
        }
        let dir = tempfile::tempdir().unwrap();
        assert!(!crate::commands::ai_core::load_settings(dir.path()).enabled);
        crate::commands::ai_core::apply_installer_choice(dir.path(), true).unwrap();
        let s = crate::commands::ai_core::load_settings(dir.path());
        // The box is « Laya hors ligne »: on, with the in-process engine and nothing that sends.
        assert!(s.enabled && s.classifier == "embedded" && s.generative == "off");
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
