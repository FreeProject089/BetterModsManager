//! What is this file, and is it any good?
//!
//! An automation that fetches something and then acts on it has one question first: is what
//! came back the thing I asked for. Without an answer it acts anyway — imports a theme as a
//! mod list, follows a 404 page as a catalogue, hands a truncated download to the installer —
//! and the failure surfaces three steps later as something unrelated.
//!
//! Two halves, deliberately separate:
//!
//!   · **What it is** is decided by SHAPE, never by what the document says about itself. A
//!     file claiming `format: "mm"` proves nothing; a signed one that lies about its own type
//!     is the case this exists for.
//!   · **Whether it is any good** is per format, and reports what is wrong rather than a
//!     verdict. "Not valid" sends somebody looking; "the mods array is empty" ends it.
//!
//! Deliberately shallow on purpose, in the same way BCWEB's inspector is: whether every entry
//! inside a catalogue resolves is decided by the thing that installs it, on the machine that
//! will run it. A second opinion written here would be wrong the day somebody adds a field.

use serde::Serialize;
use serde_json::Value;

/// What a document turned out to be, and what is wrong with it.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct FormatReport {
    /// `bmmpa` · `bmmnav` · `bmmlaunch` · `bmmreplay` · `bmmplug` · `mm-locked` · `repo` ·
    /// `mm` · `bmp` · `cbmp` · `bmmcat` · `theme` · `databmm`, or empty when nothing
    /// recognised it.
    pub format: String,
    /// Nothing wrong that this can see.
    pub ok: bool,
    /// i18n keys, worst first. Empty when `ok`.
    pub problems: Vec<String>,
    /// A count worth showing: mods, tasks, entries. Zero when the format has no obvious one.
    pub count: u64,
}

fn is_obj(v: &Value) -> bool {
    v.is_object()
}

fn arr<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key).and_then(|x| x.as_array()).map(|a| &a[..]).unwrap_or(&[])
}

/// What this document IS, by its shape.
///
/// The order is load-bearing and matches BCWEB's inspector, which reads the same files from the
/// other side. `bmmcat` is last because `modpacks` is also one of its arrays, and a `.cbmp` has
/// a reader that knows more about it than the general one does.
pub fn detect(doc: &Value) -> &'static str {
    if let Some(list) = doc.as_array() {
        if list.iter().any(|x| is_obj(x) && x.get("steps").map(|s| s.is_array()).unwrap_or(false)) {
            return "bmmpa";
        }
        // A bare rrweb export: no wrapper, just the events.
        if list.len() >= 2
            && list.iter().take(5).all(|e| {
                is_obj(e) && e.get("type").map(|t| t.is_number()).unwrap_or(false)
                    && e.get("timestamp").map(|t| t.is_number()).unwrap_or(false)
            })
        {
            return "bmmreplay";
        }
        return "";
    }
    if !is_obj(doc) {
        return "";
    }
    if doc.get("magic").and_then(|m| m.as_str()) == Some("BMMPA")
        || arr(doc, "tasks").iter().any(|x| x.get("steps").map(|s| s.is_array()).unwrap_or(false))
    {
        return "bmmpa";
    }
    if doc.get("format").and_then(|f| f.as_str()) == Some("bmmnav") {
        return "bmmnav";
    }
    // A launch pack. `kind` is a marker the writer puts there on purpose, in the same way
    // `magic: "BMMPA"` is — but the shape alone is enough, and is what decides for a file
    // written by an older version or trimmed by hand.
    if doc.get("kind").and_then(|k| k.as_str()) == Some("bmm-launchpack")
        || (doc.get("exe_paths").map(|x| x.is_array()).unwrap_or(false)
            && doc.get("name").map(|x| x.is_string()).unwrap_or(false))
    {
        return "bmmlaunch";
    }
    if doc.get("events").map(|e| e.is_array()).unwrap_or(false)
        && (doc.get("console").is_some() || doc.get("rustLog").is_some())
    {
        return "bmmreplay";
    }
    // A plugin manifest. Identified by a field only a plugin has — not by `id` + `name`, which
    // a theme.json also carries, and reading a theme as a plugin would report permissions and
    // scripts for a document that has neither.
    if doc.get("id").map(|x| x.is_string()).unwrap_or(false)
        && doc.get("name").map(|x| x.is_string()).unwrap_or(false)
        && (doc.get("apply_mode").map(|x| x.is_string()).unwrap_or(false)
            || doc.get("permissions").map(|x| x.is_array()).unwrap_or(false)
            || doc.get("modlist").map(is_obj).unwrap_or(false)
            || doc.get("assets").map(|x| x.is_array()).unwrap_or(false)
            || doc.get("scripts").map(|x| x.is_array()).unwrap_or(false))
    {
        return "bmmplug";
    }
    if doc.get("bmm_locked") == Some(&Value::Bool(true)) && doc.get("sealed").map(is_obj).unwrap_or(false) {
        return "mm-locked";
    }
    // A theme: id + name + a token map, and none of the plugin fields above.
    if doc.get("tokens").map(is_obj).unwrap_or(false) && doc.get("name").map(|x| x.is_string()).unwrap_or(false) {
        return "theme";
    }
    // A whole-app backup.
    if doc.get("bmm_backup").map(is_obj).unwrap_or(false) || doc.get("sections").map(is_obj).unwrap_or(false) {
        return "databmm";
    }
    // A Server-Repo manifest: profiles carrying mods.
    if arr(doc, "profiles").iter().any(|p| is_obj(p) && p.get("mods").map(|m| m.is_array()).unwrap_or(false)) {
        return "repo";
    }
    if doc.get("format_version").map(|x| x.is_string()).unwrap_or(false)
        && doc.get("mods").map(|x| x.is_array()).unwrap_or(false)
    {
        return "mm";
    }
    // A modpack DOCUMENT: entries carrying per-file manifests. Told apart from a mod LIST by
    // shape, not by a claim.
    if arr(doc, "mods").iter().any(|m| {
        is_obj(m) && m.get("mod_id").map(|x| x.is_string()).unwrap_or(false)
            && m.get("file_manifest").map(|x| x.is_array()).unwrap_or(false)
    }) {
        return "bmp";
    }
    if arr(doc, "modpacks").iter().any(|m| is_obj(m) && m.get("file").map(|x| x.is_string()).unwrap_or(false)) {
        return "cbmp";
    }
    for key in ["plugins", "themes", "apps", "presets", "tutorials", "automations", "modpacks", "lists"] {
        if arr(doc, key).iter().any(is_obj) {
            return "bmmcat";
        }
    }
    ""
}

/// What is wrong with it, given what it is.
///
/// Every entry is an i18n key. Reported as a LIST rather than as a verdict: "not valid" sends
/// somebody looking through a file they cannot read, and "the mods array is empty" ends it.
pub fn check(doc: &Value) -> FormatReport {
    let format = detect(doc);
    let mut problems: Vec<String> = Vec::new();
    let mut count: u64 = 0;

    match format {
        "" => problems.push("valid.errUnknown".into()),
        "bmmpa" => {
            let tasks: Vec<&Value> = if let Some(a) = doc.as_array() {
                a.iter().collect()
            } else {
                arr(doc, "tasks").iter().collect()
            };
            count = tasks.len() as u64;
            if tasks.is_empty() {
                problems.push("valid.errNoTasks".into());
            }
            for tk in &tasks {
                if tk.get("name").and_then(|n| n.as_str()).unwrap_or("").trim().is_empty() {
                    problems.push("valid.warnUnnamedTask".into());
                    break;
                }
            }
            // A task calling a block the file does not carry imports intact and dies on that
            // step. The one check here that is about more than shape, because the answer is
            // inside the same document.
            let includes = doc.get("includes").and_then(|x| x.as_object());
            let mut missing = false;
            for tk in &tasks {
                for st in arr(tk, "steps") {
                    if st.get("kind").and_then(|k| k.as_str()) == Some("call") {
                        let name = st.get("block").and_then(|b| b.as_str()).unwrap_or("");
                        if !name.is_empty() && !includes.map(|m| m.contains_key(name)).unwrap_or(false) {
                            missing = true;
                        }
                    }
                }
            }
            if missing {
                problems.push("valid.errMissingBlock".into());
            }
        }
        // A launch pack is a list of programs somebody else chose to start on your machine.
        // The only useful thing to say about one is WHICH, and what will be run through a
        // shell rather than started directly.
        "bmmlaunch" => {
            let exes = arr(doc, "exe_paths");
            count = exes.len() as u64;
            if doc.get("name").and_then(|n| n.as_str()).unwrap_or("").trim().is_empty() {
                problems.push("valid.errNoName".into());
            }
            if exes.is_empty() {
                problems.push("valid.errNoExes".into());
            }
            let paths: Vec<String> = exes.iter()
                .filter_map(|x| x.as_str())
                .map(|x| x.trim().to_lowercase())
                .collect();
            // Run through `powershell -ExecutionPolicy Bypass`, which is the pack's own
            // launcher doing what it has always done. Worth reading before importing one
            // somebody sent you; a `.exe` at least announces itself as a program.
            if paths.iter().any(|p| p.ends_with(".ps1") || p.ends_with(".bat")
                || p.ends_with(".cmd") || p.ends_with(".vbs"))
            {
                problems.push("valid.warnLaunchScript".into());
            }
            // Relative here means "resolved against whatever the working directory happens
            // to be when it fires", which is not a thing a shared file can promise.
            if paths.iter().any(|p| {
                !p.is_empty() && !p.starts_with("\\\\")
                    && !p.get(1..3).map(|c| c == ":\\" || c == ":/").unwrap_or(false)
                    && !p.starts_with('/')
            }) {
                problems.push("valid.warnLaunchRelative".into());
            }
        }
        "mm" => {
            count = arr(doc, "mods").len() as u64;
            if count == 0 {
                problems.push("valid.errNoMods".into());
            }
        }
        "repo" => {
            let profiles = arr(doc, "profiles");
            count = profiles.len() as u64;
            if profiles.is_empty() {
                problems.push("valid.errNoProfiles".into());
            }
            if profiles.iter().all(|p| arr(p, "mods").is_empty()) {
                problems.push("valid.warnNoModsAnywhere".into());
            }
        }
        "bmmplug" => {
            if doc.get("name").and_then(|n| n.as_str()).unwrap_or("").trim().is_empty() {
                problems.push("valid.errNoName".into());
            }
            count = arr(doc, "scripts").len() as u64 + arr(doc, "assets").len() as u64;
        }
        "bmp" => {
            count = arr(doc, "mods").len() as u64;
            if count == 0 {
                problems.push("valid.errNoMods".into());
            }
        }
        "cbmp" => {
            count = arr(doc, "modpacks").len() as u64;
            if count == 0 {
                problems.push("valid.errEmptyCatalog".into());
            }
        }
        "bmmcat" => {
            for key in ["plugins", "themes", "apps", "presets", "tutorials", "automations", "modpacks", "lists"] {
                count += arr(doc, key).len() as u64;
            }
            if count == 0 {
                problems.push("valid.errEmptyCatalog".into());
            }
        }
        "bmmreplay" => {
            count = if doc.is_array() { doc.as_array().map(|a| a.len()).unwrap_or(0) as u64 } else { arr(doc, "events").len() as u64 };
            if count < 2 {
                problems.push("valid.errShortReplay".into());
            }
        }
        _ => {}
    }

    FormatReport { format: format.to_string(), ok: problems.is_empty(), problems, count }
}

/// Read a file and say what it is. Text, so an automation can hand it a downloaded body.
pub fn check_text(text: &str) -> FormatReport {
    match serde_json::from_str::<Value>(text) {
        Ok(v) => check(&v),
        // Distinguished from "unknown format" on purpose: one means the file is not JSON at
        // all — usually an HTML error page a fetch returned with a 200 — and the other means
        // it is a JSON document nothing here recognises. They send you to different places.
        Err(_) => FormatReport {
            format: String::new(),
            ok: false,
            problems: vec!["valid.errNotJson".into()],
            count: 0,
        },
    }
}

#[cfg(test)]
mod launch_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_pack_says_how_many_programs_and_names_the_ones_run_through_a_shell() {
        let r = check(&json!({
            "kind": "bmm-launchpack", "version": 1, "name": "Evening",
            "exe_paths": [r"D:\Games\a.exe", r"D:\tools\setup.ps1"]
        }));
        assert_eq!(r.format, "bmmlaunch");
        assert_eq!(r.count, 2);
        // A .ps1 in a pack is run with -ExecutionPolicy Bypass. Saying so is the whole
        // reason somebody inspects a file another person wrote.
        assert!(r.problems.contains(&"valid.warnLaunchScript".to_string()));
        assert!(!r.problems.contains(&"valid.warnLaunchRelative".to_string()));
    }

    #[test]
    fn a_relative_path_is_flagged_because_it_promises_nothing() {
        let r = check(&json!({
            "kind": "bmm-launchpack", "version": 1, "name": "x", "exe_paths": ["game.exe"]
        }));
        assert!(r.problems.contains(&"valid.warnLaunchRelative".to_string()));
    }

    #[test]
    fn a_unc_path_and_a_drive_letter_are_both_absolute() {
        let r = check(&json!({
            "kind": "bmm-launchpack", "version": 1, "name": "x",
            "exe_paths": [r"\\nas\share\a.exe", r"C:\a.exe", "/usr/bin/a"]
        }));
        assert!(!r.problems.contains(&"valid.warnLaunchRelative".to_string()));
    }

    #[test]
    fn an_empty_pack_is_reported_rather_than_called_fine() {
        let r = check(&json!({ "kind": "bmm-launchpack", "version": 1, "name": "", "exe_paths": [] }));
        assert!(!r.ok);
        assert!(r.problems.contains(&"valid.errNoExes".to_string()));
        assert!(r.problems.contains(&"valid.errNoName".to_string()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The ten names BCWEB's inspector reports, plus BMM's own two.
    ///
    /// Both sides read the same files and must agree about what they are, or a plugin that BMM
    /// accepts comes back as "not a recognised BMM format" in moderation. This test is the
    /// pinning: apps/api/src/lib/bmm-formats.mjs is the other implementation, and changing the
    /// order in one without the other is the drift it exists to catch.
    #[test]
    fn the_shape_decides_and_the_order_matters() {
        assert_eq!(detect(&json!({ "magic": "BMMPA", "tasks": [] })), "bmmpa");
        assert_eq!(detect(&json!([{ "name": "t", "steps": [] }])), "bmmpa");
        assert_eq!(detect(&json!({ "format": "bmmnav" })), "bmmnav");
        assert_eq!(
            detect(&json!({ "kind": "bmm-launchpack", "name": "Evening", "exe_paths": [] })),
            "bmmlaunch"
        );
        assert_eq!(detect(&json!({ "events": [], "console": [] })), "bmmreplay");
        assert_eq!(detect(&json!({ "id": "p", "name": "P", "apply_mode": "modlist" })), "bmmplug");
        assert_eq!(detect(&json!({ "bmm_locked": true, "sealed": {} })), "mm-locked");
        assert_eq!(detect(&json!({ "profiles": [{ "mods": [] }] })), "repo");
        assert_eq!(detect(&json!({ "format_version": "1", "mods": [] })), "mm");
        assert_eq!(
            detect(&json!({ "mods": [{ "mod_id": "a", "file_manifest": [] }] })),
            "bmp"
        );
        assert_eq!(detect(&json!({ "modpacks": [{ "file": "packs/a.bmp" }] })), "cbmp");
        assert_eq!(detect(&json!({ "plugins": [{ "id": "a" }] })), "bmmcat");
    }

    #[test]
    fn a_theme_is_not_a_plugin() {
        // Both carry id + name. Reading a theme as a plugin would report permissions and
        // scripts for a document that has neither — which is a moderation screen describing
        // something that does not exist.
        assert_eq!(detect(&json!({ "id": "t", "name": "Dark", "tokens": { "bg": "#000" } })), "theme");
        assert_eq!(detect(&json!({ "id": "t", "name": "Dark" })), "", "id + name alone says nothing");
    }

    #[test]
    fn a_cbmp_wins_over_the_general_catalogue() {
        // `modpacks` is one of a catalogue's arrays too, and the .cbmp reader knows more.
        let doc = json!({ "modpacks": [{ "file": "packs/a.bmp", "name": "A" }] });
        assert_eq!(detect(&doc), "cbmp");
    }

    #[test]
    fn html_is_not_an_unknown_format() {
        // The case this separation exists for: a fetch that returned a login page with a 200.
        // "Not JSON" and "JSON I do not recognise" send you to different places.
        let r = check_text("<!doctype html><title>Sign in</title>");
        assert_eq!(r.problems, vec!["valid.errNotJson"]);
        assert_eq!(r.format, "");
    }

    #[test]
    fn an_empty_list_is_reported_as_empty_rather_than_invalid() {
        let r = check(&json!({ "format_version": "1", "mods": [] }));
        assert_eq!(r.format, "mm");
        assert!(!r.ok);
        assert_eq!(r.problems, vec!["valid.errNoMods"]);
    }

    #[test]
    fn a_task_calling_a_block_the_file_does_not_carry_is_caught() {
        // It imports perfectly and dies on that step. The one check here that reads more than
        // shape, because the answer is inside the same document.
        let bad = json!({
            "magic": "BMMPA",
            "tasks": [{ "name": "T", "steps": [{ "kind": "call", "block": "helper" }] }],
        });
        assert!(check(&bad).problems.contains(&"valid.errMissingBlock".to_string()));

        let good = json!({
            "magic": "BMMPA",
            "includes": { "helper": [] },
            "tasks": [{ "name": "T", "steps": [{ "kind": "call", "block": "helper" }] }],
        });
        assert!(check(&good).ok, "{:?}", check(&good).problems);
    }

    #[test]
    fn a_healthy_document_reports_a_count_and_no_problems() {
        let r = check(&json!({ "format_version": "1", "mods": [{ "name": "a" }, { "name": "b" }] }));
        assert!(r.ok);
        assert_eq!(r.count, 2);
        assert!(r.problems.is_empty());
    }
}

/// Validate a file on disk, or a piece of text.
///
/// Both, because an automation has both cases: a file it downloaded, and a body it captured
/// from an HTTP step. Giving them separate commands would mean the second one gets written
/// later, or not at all.
#[tauri::command]
pub async fn bmm_validate(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    path: Option<String>,
    text: Option<String>,
) -> Result<FormatReport, String> {
    if let Some(t) = text.filter(|t| !t.trim().is_empty()) {
        return Ok(check_text(&t));
    }
    let p = path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty())
        .ok_or_else(|| "valid.errNoInput".to_string())?;
    // Place names work here like everywhere else: `plugin:my-tools/plugin.json`.
    let resolved = if crate::commands::bmm_paths_core::parse_spec(&p).is_some() {
        crate::commands::bmm_paths_core::resolve_with(&crate::commands::bmm_paths::roots_now(&app, &state), &p)?
    } else {
        p
    };
    let body = tauri::async_runtime::spawn_blocking(move || std::fs::read_to_string(&resolved))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "valid.errUnreadable".to_string())?;
    Ok(check_text(&body))
}
