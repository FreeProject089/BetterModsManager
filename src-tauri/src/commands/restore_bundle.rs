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

/// The archive bytes, unsealing first if the file is a sealed envelope.
///
/// The three outcomes are told apart on purpose, because they have three different answers:
/// a plain archive opens with no passphrase; a sealed one with no passphrase given says so,
/// rather than failing as "not a readable .DATABMM"; and a sealed one with the wrong
/// passphrase says THAT. Collapsing them into one error is how somebody spends an evening
/// convinced their backup is corrupt.
fn open_bundle_bytes(path: &str, passphrase: Option<&str>) -> Result<Vec<u8>, AppError> {
    let raw = std::fs::read(path)?;
    if !crate::commands::secret_box::is_sealed(&raw) {
        return Ok(raw);
    }
    let Some(pass) = passphrase.filter(|p| !p.is_empty()) else {
        return Err(AppError::Internal("bmm.enc.errSealedNeedsPass".into()));
    };
    crate::commands::secret_box::open(&raw, pass).map_err(AppError::Internal)
}

/// Read the archive's shape without unpacking it.
#[tauri::command]
pub fn inspect_data_bundle(path: String, passphrase: Option<String>) -> Result<BundleInfo, AppError> {
    let bytes = open_bundle_bytes(&path, passphrase.as_deref())?;
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes))
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
    /// The passphrase, when the archive is a sealed envelope. Absent for a plain one.
    #[serde(default)]
    pub passphrase: Option<String>,
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

    let bytes = open_bundle_bytes(&args.path, args.passphrase.as_deref())?;
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes))
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
        // The three entries that are VALUES rather than files are read here; where everything
        // else goes is `dest_for`, which is pure and tested.
        match section.prefix {
            "app_data.json" => app_data_val = serde_json::from_slice(&buf).ok(),
            "extras.json" => result.extras = serde_json::from_slice(&buf).ok(),
            "navigation" if name == "navigation/navbar.json" => result.navbar = serde_json::from_slice(&buf).ok(),
            _ => {}
        }
        let dest = dest_for(section.prefix, &name, &dir, &crate::fs_utils::get_lang_dir(&app_handle));

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

/// Where one archive entry lands on disk, or `None` when it is not a file at all — the two
/// JSON blobs that become in-memory state, and the navbar layout only the frontend can write.
///
/// Split out of `restore_data_bundle` so it can be tested: the routing is the part that is
/// easy to get quietly wrong (three sections do not mirror their archive path) and the rest of
/// that function needs a running app to exercise.
fn dest_for(section: &str, name: &str, data_dir: &Path, lang_dir: &Path) -> Option<PathBuf> {
    match section {
        // Handled by the caller as values, not files.
        "app_data.json" | "extras.json" => None,
        "automations" => Some(data_dir.join("schedules.json")),
        // Lang lives outside the data dir, and flat: only the file name survives.
        "Lang" => Path::new(name).file_name().map(|f| lang_dir.join(f)),
        "navigation" => {
            if name == "navigation/navbar.json" { None }
            else if let Some(rest) = name.strip_prefix("navigation/pages-data/") {
                Some(data_dir.join("custom_pages_data").join(rest))
            } else if let Some(rest) = name.strip_prefix("navigation/pages/") {
                Some(data_dir.join("custom_pages").join(rest))
            } else { None }
        }
        _ => Some(data_dir.join(name)),
    }
}

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

    fn dirs() -> (PathBuf, PathBuf) {
        (PathBuf::from("/data"), PathBuf::from("/lang"))
    }

    #[test]
    fn the_three_sections_that_do_not_mirror_their_path_land_where_they_should() {
        let (d, l) = dirs();
        // automations is ONE file in the archive and one file on disk, under a different name.
        assert_eq!(dest_for("automations", "automations/schedules.json", &d, &l).unwrap(),
                   d.join("schedules.json"));
        // Lang is flat, outside the data dir.
        assert_eq!(dest_for("Lang", "Lang/en.json", &d, &l).unwrap(), l.join("en.json"));
        // navigation splits in two, and its layout is not a file at all.
        assert_eq!(dest_for("navigation", "navigation/pages/abc/index.html", &d, &l).unwrap(),
                   d.join("custom_pages").join("abc/index.html"));
        assert_eq!(dest_for("navigation", "navigation/pages-data/abc/grants.json", &d, &l).unwrap(),
                   d.join("custom_pages_data").join("abc/grants.json"));
        assert!(dest_for("navigation", "navigation/navbar.json", &d, &l).is_none());
    }

    /// THE ONE: what keeps these two apart is the TRAILING SLASH, not the order they are
    /// tested in. `navigation/pages-data/x` does not start with `navigation/pages/`, so the
    /// two prefixes are disjoint — but drop the slash to "tidy" the match and it does start
    /// with `navigation/pages`, and every page's grants land inside custom_pages under a
    /// folder called `-data`. The page then restores looking complete and silently without its
    /// permissions, which is the failure worth a test: it is invisible until the page runs.
    ///
    /// (Verified rather than assumed: `"navigation/pages-data/…".strip_prefix("navigation/
    /// pages/")` is None, and `strip_prefix("navigation/pages")` is `-data/…`.)
    #[test]
    fn pages_data_is_not_swallowed_by_pages() {
        let (d, l) = dirs();
        let got = dest_for("navigation", "navigation/pages-data/abc/grants.json", &d, &l).unwrap();
        assert!(got.starts_with(d.join("custom_pages_data")), "landed at {got:?}");
        assert!(!got.to_string_lossy().contains("-data/"), "landed inside custom_pages: {got:?}");
    }

    #[test]
    fn a_value_entry_is_never_written_as_a_file() {
        let (d, l) = dirs();
        assert!(dest_for("app_data.json", "app_data.json", &d, &l).is_none());
        assert!(dest_for("extras.json", "extras.json", &d, &l).is_none());
    }

    #[test]
    fn everything_else_keeps_its_path_under_the_data_dir() {
        let (d, l) = dirs();
        assert_eq!(dest_for("themes", "themes/dark.json", &d, &l).unwrap(), d.join("themes/dark.json"));
        assert_eq!(dest_for("Replays", "Replays/a.bmmreplay", &d, &l).unwrap(), d.join("Replays/a.bmmreplay"));
    }

    // ── inspect, against a real archive ──────────────────────────────────────
    //
    // inspect_data_bundle takes nothing but a path, so this is the half of the feature that
    // can be exercised end to end without a running app: build a .DATABMM, read it back.

    fn write_bundle(path: &Path, entries: &[(&str, &str)]) {
        use std::io::Write;
        let f = std::fs::File::create(path).unwrap();
        let mut z = zip::ZipWriter::new(f);
        let o = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, body) in entries {
            z.start_file(*name, o).unwrap();
            z.write_all(body.as_bytes()).unwrap();
        }
        z.finish().unwrap();
    }

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join("bmm_restore_tests");
        let _ = std::fs::create_dir_all(&d);
        d.join(name)
    }

    #[test]
    fn inspect_reports_each_section_and_flags_what_will_be_skipped() {
        let p = tmp("basic.DATABMM");
        write_bundle(&p, &[
            ("manifest.json", r#"{"format":"DATABMM","version":1,"app_version":"1.0.0","created":"2026-08-18T10:00:00Z"}"#),
            ("themes/dark.json", "{}"),
            ("themes/light.json", "{}"),
            ("Crashes/Reports/a.zip", "x"),
            ("app_data.json", "{}"),
        ]);
        let info = inspect_data_bundle(p.to_string_lossy().to_string(), None).unwrap();

        assert_eq!(info.app_version.as_deref(), Some("1.0.0"));
        // No signature block in this manifest — unsigned, and that is not an error.
        assert_eq!(info.signature, "unsigned");

        let themes = info.sections.iter().find(|s| s.section == "themes").unwrap();
        assert_eq!(themes.files, 2);
        assert!(themes.restorable);

        let crashes = info.sections.iter().find(|s| s.section == "Crashes").unwrap();
        assert!(!crashes.restorable, "crash reports must be listed as not restorable");

        // The manifest itself is not a section anybody restores.
        assert!(!info.sections.iter().any(|s| s.section == "manifest.json"));
    }

    /// An archive somebody edited must SAY so. This is the whole reason the manifest is
    /// signed: the sections it lists are the sections the screen offers to write.
    #[test]
    fn a_manifest_whose_signature_no_longer_matches_reads_as_tampered() {
        use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
        let mut doc = serde_json::json!({ "format": "DATABMM", "version": 1, "app_version": "1.0.0" });
        let sk = SigningKey::from_bytes(&[7u8; 32]);
        let vk: VerifyingKey = (&sk).into();
        let payload = crate::commands::doc_sign::payload(&doc, "databmm").unwrap();
        doc.as_object_mut().unwrap().insert(crate::commands::doc_sign::FIELD.into(), serde_json::json!({
            "format": "databmm",
            "author_id": hex::encode(vk.to_bytes()),
            "signature": hex::encode(sk.sign(&payload).to_bytes()),
            "signed_at": "2026-08-18T10:00:00+02:00",
        }));

        let good = tmp("signed.DATABMM");
        write_bundle(&good, &[("manifest.json", &serde_json::to_string(&doc).unwrap()), ("themes/a.json", "{}")]);
        assert_eq!(inspect_data_bundle(good.to_string_lossy().to_string(), None).unwrap().signature, "valid");

        // One field changed after signing — the archive now claims a version it was not
        // signed with.
        doc["app_version"] = serde_json::json!("9.9.9");
        let bad = tmp("edited.DATABMM");
        write_bundle(&bad, &[("manifest.json", &serde_json::to_string(&doc).unwrap()), ("themes/a.json", "{}")]);
        assert_eq!(inspect_data_bundle(bad.to_string_lossy().to_string(), None).unwrap().signature, "tampered");
    }

    #[test]
    fn a_file_that_is_not_a_zip_is_an_error_not_a_panic() {
        let p = tmp("notazip.DATABMM");
        std::fs::write(&p, b"this is not a zip").unwrap();
        assert!(inspect_data_bundle(p.to_string_lossy().to_string(), None).is_err());
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
