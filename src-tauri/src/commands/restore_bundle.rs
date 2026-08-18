//! Reading a `.DATABMM` back in.
//!
//! Export has been able to write one for a while and nothing could read it, so the archive was
//! a backup you restored by opening it in a zip tool and putting files back by hand. The docs
//! said so plainly, which was honest and not a substitute for the button.
//!
//! Two commands, and the split is the whole safety story:
//!
//!   · `inspect_data_bundle`  — says what is in it and whether it is still what BMM wrote.
//!                              Writes nothing. This is what you look at before deciding.
//!   · `restore_data_bundle`  — puts back ONLY the sections you ticked.
//!
//! Restoring is not importing. `app_data` is not merged into what you have, it REPLACES it —
//! every profile, every mod record, every setting — because a merge would have to invent
//! answers for two profiles with the same name and different folders, and inventing them
//! quietly is how somebody loses a loadout. So the destructive section is one you tick on
//! purpose, and the current `data.json` is copied aside first, named after the moment it was
//! taken, before anything is written.
//!
//! Two sections are deliberately NOT restorable at all: crash reports and diagnostics. They
//! are records of what happened to a particular installation on a particular machine. Putting
//! somebody else's — or last year's — into this one produces a diagnostics folder that lies
//! about the app it sits in, which is worse than an empty one.

use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{Manager, State};

use crate::error::AppError;
use crate::state::AppState;

/// What a section restores into. Kept next to the writer rather than derived from the entry
/// name at restore time, so adding a section to the export forces a decision here instead of
/// silently landing wherever its prefix happens to point.
struct Section {
    /// The prefix inside the archive.
    prefix: &'static str,
    /// Whether a restore may write it at all.
    restorable: bool,
}

const SECTIONS: &[Section] = &[
    Section { prefix: "app_data.json", restorable: true },
    Section { prefix: "extras.json", restorable: true },
    Section { prefix: "themes", restorable: true },
    Section { prefix: "theme-presets", restorable: true },
    Section { prefix: "Lang", restorable: true },
    Section { prefix: "LaunchPacks", restorable: true },
    Section { prefix: "automations", restorable: true },
    Section { prefix: "apps", restorable: true },
    Section { prefix: "Replays", restorable: true },
    Section { prefix: "navigation", restorable: true },
    // See the module note: a record of another installation's failures is not a thing to
    // install. Listed so the inspector can SHOW they are in the archive and say they will be
    // skipped, which is more useful than pretending they are not there.
    Section { prefix: "Crashes", restorable: false },
    Section { prefix: "diagnostics", restorable: false },
];

fn section_for(name: &str) -> Option<&'static Section> {
    SECTIONS.iter().find(|s| name == s.prefix || name.starts_with(&format!("{}/", s.prefix)))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleSection {
    pub section: String,
    pub files: usize,
    pub bytes: u64,
    pub restorable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleInfo {
    pub path: String,
    /// From the archive's own manifest, when it has one.
    pub app_version: Option<String>,
    pub created: Option<String>,
    /// The signature verdict over `manifest.json`. Unsigned is not a failure — every archive
    /// written before signing existed is unsigned — but a TAMPERED one is worth stopping for.
    pub signature: String,
    pub author_id: Option<String>,
    pub sections: Vec<BundleSection>,
}

fn data_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."))
}

/// Read the archive's shape without unpacking it.
#[tauri::command]
pub fn inspect_data_bundle(path: String) -> Result<BundleInfo, AppError> {
    let file = std::fs::File::open(&path)?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|e| AppError::Internal(format!("Not a readable .DATABMM: {e}")))?;

    let mut counts: std::collections::BTreeMap<String, (usize, u64)> = Default::default();
    let mut manifest: Option<serde_json::Value> = None;

    for i in 0..zip.len() {
        let mut e = zip.by_index(i).map_err(|e| AppError::Internal(e.to_string()))?;
        if e.is_dir() {
            continue;
        }
        // enclosed_name() is the zip-slip guard: an entry that would escape the extraction
        // root has no safe name and is skipped here as well as at restore time, so it cannot
        // be listed as something the user is about to restore either.
        let Some(name) = e.enclosed_name().map(|p| p.to_string_lossy().replace('\\', "/")) else { continue };
        if name == "manifest.json" {
            let mut s = String::new();
            let _ = e.read_to_string(&mut s);
            manifest = serde_json::from_str(&s).ok();
            continue;
        }
        let key = section_for(&name).map(|s| s.prefix.to_string()).unwrap_or_else(|| "other".into());
        let slot = counts.entry(key).or_insert((0, 0));
        slot.0 += 1;
        slot.1 += e.size();
    }

    let (signature, author_id) = match manifest.as_ref() {
        Some(m) => match crate::commands::doc_sign::verify_doc(m, "databmm") {
            crate::commands::doc_sign::Verdict::Valid { author_id, .. } => ("valid".to_string(), Some(author_id)),
            crate::commands::doc_sign::Verdict::Tampered { author_id } => ("tampered".to_string(), Some(author_id)),
            crate::commands::doc_sign::Verdict::Malformed { .. } => ("malformed".to_string(), None),
            crate::commands::doc_sign::Verdict::Unsigned => ("unsigned".to_string(), None),
        },
        None => ("unsigned".to_string(), None),
    };

    Ok(BundleInfo {
        path: path.clone(),
        app_version: manifest.as_ref().and_then(|m| m.get("app_version")).and_then(|v| v.as_str()).map(String::from),
        created: manifest.as_ref().and_then(|m| m.get("created")).and_then(|v| v.as_str()).map(String::from),
        signature,
        author_id,
        sections: counts.into_iter().map(|(section, (files, bytes))| {
            let restorable = SECTIONS.iter().find(|s| s.prefix == section).map(|s| s.restorable).unwrap_or(false);
            BundleSection { section, files, bytes, restorable }
        }).collect(),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreArgs {
    pub path: String,
    /// Section prefixes to put back. Anything not listed is left alone — a restore that took
    /// more than was asked for would be indistinguishable from a mistake.
    pub sections: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub restored: Vec<String>,
    pub files: usize,
    pub skipped: Vec<String>,
    /// Where the previous data.json was put, when app_data was among the sections. Returned so
    /// the message can name it: "your old data is at X" is the sentence that makes a
    /// destructive action survivable.
    pub backup_of_previous: Option<String>,
    /// The frontend's own localStorage blob, handed back for the caller to apply — the same
    /// contract `import_app_data` already has, because Rust cannot write localStorage.
    pub extras: Option<serde_json::Value>,
    /// The navbar layout, likewise localStorage.
    pub navbar: Option<serde_json::Value>,
}

/// Put back the sections that were asked for.
#[tauri::command]
pub fn restore_data_bundle(
    state: State<AppState>,
    app_handle: tauri::AppHandle,
    args: RestoreArgs,
) -> Result<RestoreResult, AppError> {
    let dir = data_dir(&app_handle);
    let wanted: std::collections::HashSet<&str> = args.sections.iter().map(|s| s.as_str()).collect();

    let file = std::fs::File::open(&args.path)?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|e| AppError::Internal(format!("Not a readable .DATABMM: {e}")))?;

    let mut result = RestoreResult {
        restored: vec![], files: 0, skipped: vec![],
        backup_of_previous: None, extras: None, navbar: None,
    };

    // The safety copy, taken BEFORE anything is written and only when the destructive section
    // was actually asked for. Named with the timestamp rather than ".bak": there is already a
    // data.json.bak that the app rewrites on every save, and a restore that overwrote the
    // rolling backup would destroy the very thing somebody would reach for.
    if wanted.contains("app_data.json") {
        let live = dir.join("data.json");
        if live.exists() {
            let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
            let dest = dir.join(format!("data.before-restore-{stamp}.json"));
            std::fs::copy(&live, &dest)?;
            result.backup_of_previous = Some(dest.to_string_lossy().to_string());
        }
    }

    let mut app_data_val: Option<serde_json::Value> = None;

    for i in 0..zip.len() {
        let mut e = zip.by_index(i).map_err(|e| AppError::Internal(e.to_string()))?;
        if e.is_dir() {
            continue;
        }
        let Some(safe) = e.enclosed_name().map(|p| p.to_path_buf()) else {
            result.skipped.push("an entry with an unsafe path".into());
            continue;
        };
        let name = safe.to_string_lossy().replace('\\', "/");
        if name == "manifest.json" {
            continue;
        }
        let Some(section) = section_for(&name) else { continue };
        if !wanted.contains(section.prefix) {
            continue;
        }
        if !section.restorable {
            if !result.skipped.iter().any(|s| s == section.prefix) {
                result.skipped.push(section.prefix.to_string());
            }
            continue;
        }

        let mut buf = Vec::new();
        e.read_to_end(&mut buf)?;

        // Where each section lands. Written out rather than "strip the prefix and join",
        // because three of them do NOT mirror their archive path: Lang lives outside the data
        // dir, and navigation splits into two folders plus a value the frontend has to apply.
        let dest: Option<PathBuf> = match section.prefix {
            "app_data.json" => { app_data_val = serde_json::from_slice(&buf).ok(); None }
            "extras.json" => { result.extras = serde_json::from_slice(&buf).ok(); None }
            "automations" => Some(dir.join("schedules.json")),
            "Lang" => Some(crate::fs_utils::get_lang_dir(&app_handle).join(safe.file_name().unwrap_or_default())),
            "navigation" => {
                if name == "navigation/navbar.json" {
                    result.navbar = serde_json::from_slice(&buf).ok();
                    None
                } else if let Some(rest) = name.strip_prefix("navigation/pages-data/") {
                    Some(dir.join("custom_pages_data").join(rest))
                } else if let Some(rest) = name.strip_prefix("navigation/pages/") {
                    Some(dir.join("custom_pages").join(rest))
                } else { None }
            }
            _ => Some(dir.join(&safe)),
        };

        if let Some(dest) = dest {
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(&dest, &buf)?;
        }
        result.files += 1;
        if !result.restored.iter().any(|s| s == section.prefix) {
            result.restored.push(section.prefix.to_string());
        }
    }

    // The in-memory state goes last, after every file is on disk: a save triggered by
    // replacing AppData would otherwise race the files still being written.
    if let Some(val) = app_data_val {
        if let Ok(new_data) = serde_json::from_value::<crate::state::AppData>(val) {
            let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".into()))?;
            *data = new_data;
            drop(data);
            state.save()?;
        } else {
            return Err(AppError::Internal(
                "The archive's app_data could not be read as this version's data — nothing was replaced.".into(),
            ));
        }
    }

    crate::commands::crash::log_line(format!(
        "[RESTORE] {} file(s) from {} — sections: {}",
        result.files, args.path, result.restored.join(", ")
    ));
    Ok(result)
}

/// Only used to keep `Path` in scope for the signature above on every platform.
#[allow(dead_code)]
fn _unused(_p: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_section_is_matched_by_prefix_not_by_substring() {
        // "Lang" must not swallow "LaunchPacks", and a file directly at a section's name is
        // that section (app_data.json), while a deeper path needs the separator.
        assert_eq!(section_for("Lang/en.json").unwrap().prefix, "Lang");
        assert_eq!(section_for("LaunchPacks/x.zip").unwrap().prefix, "LaunchPacks");
        assert_eq!(section_for("app_data.json").unwrap().prefix, "app_data.json");
        assert!(section_for("Language/other.json").is_none());
    }

    /// THE ONE: crash reports and diagnostics describe an installation, not a configuration.
    /// If either becomes restorable by accident, a support folder starts lying about the app
    /// it sits in.
    #[test]
    fn crash_reports_and_diagnostics_are_never_restorable() {
        assert!(!section_for("Crashes/Reports/x.zip").unwrap().restorable);
        assert!(!section_for("diagnostics/report.txt").unwrap().restorable);
        assert!(section_for("themes/dark.json").unwrap().restorable);
    }

    #[test]
    fn every_section_the_exporter_writes_is_known_here() {
        // The export's own section names. A section added there and not here would land in
        // "other" and silently never restore.
        for s in ["app_data.json", "themes", "theme-presets", "Lang", "LaunchPacks",
                  "automations", "apps", "Replays", "navigation", "Crashes", "diagnostics"] {
            assert!(SECTIONS.iter().any(|x| x.prefix == s), "{s} is not listed in SECTIONS");
        }
    }
}
