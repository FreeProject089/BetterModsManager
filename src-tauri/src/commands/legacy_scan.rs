//! "You already use OvGME / Open Mod Manager" — found before you are asked to set anything up.
//!
//! BMM can already import both (`commands::ovgme`, `commands::omm`). Both imports are buttons
//! sitting inside Profiles, which is a screen you only reach after you have created a profile
//! by hand — so the person who most needs them is the one who cannot have found them yet. The
//! first thing a JSGME/OvGME user says about a new mod manager is that redoing their setup is
//! not worth it, and the answer to that was already written and unreachable.
//!
//! So this is the LOOK, split out from the import: it answers "is there anything to import"
//! without touching a thing, cheaply enough to run on first launch.
//!
//! Cheap matters. This runs before the window is useful, so it does no recursive walking: it
//! reads two known configuration files and stats what they point at. A machine with neither
//! costs two failed `exists()` calls.

use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LegacyFind {
    /// How many importable configurations were seen. 0 means "nothing to offer".
    pub count: usize,
    /// Their names, for the offer to say WHAT it found rather than how many. A person
    /// recognises "DCS World" instantly and "2 configurations" not at all.
    pub names: Vec<String>,
    /// Where they were found, so the offer can be checked rather than trusted.
    pub source: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LegacyScan {
    pub ovgme: LegacyFind,
    pub omm: LegacyFind,
    /// Whether anything at all was found — serialised rather than left for the caller to
    /// derive. "is there something to offer" is one rule, and a copy of it in the frontend
    /// is a copy that drifts the day a third manager is added here.
    pub any: bool,
}

impl LegacyScan {
    fn with_any(ovgme: LegacyFind, omm: LegacyFind) -> Self {
        let any = ovgme.count > 0 || omm.count > 0;
        Self { ovgme, omm, any }
    }
}

/// OvGME keeps one folder per configuration under `%PROGRAMDATA%\OvGME`, each holding a
/// `game.dat`. The title sits at a fixed offset as UTF-16 — the same read the importer does,
/// which is why the name shown here is the name that will be imported.
fn scan_ovgme() -> LegacyFind {
    let mut found = LegacyFind::default();
    let roots = [
        std::env::var("PROGRAMDATA").ok().map(|p| PathBuf::from(p).join("OvGME")),
        std::env::var("APPDATA").ok().map(|p| PathBuf::from(p).join("OvGME")),
    ];
    for root in roots.into_iter().flatten() {
        if !root.is_dir() {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&root) else { continue };
        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let dat = entry.path().join("game.dat");
            let Ok(bytes) = std::fs::read(&dat) else { continue };
            if bytes.len() < 0x8A4 {
                continue;
            }
            let title = crate::commands::ovgme::read_utf16_field(&bytes, 0x002, 128);
            let root_dir = crate::commands::ovgme::read_utf16_field(&bytes, 0x082, 520);
            // A configuration whose game folder is gone is not importable, and offering it
            // would produce a profile that fails on its first action.
            if title.is_empty() || root_dir.is_empty() || !PathBuf::from(&root_dir).exists() {
                continue;
            }
            found.names.push(title);
        }
        if !found.names.is_empty() {
            found.source = root.to_string_lossy().to_string();
            break;
        }
    }
    found.count = found.names.len();
    found
}

/// Open Mod Manager keeps `%APPDATA%\Open Mod Manager\config.xml`, whose `<recent_list>` holds
/// a `<path>` per Mod Hub it knows about. Each hub is an XML file whose folder contains one
/// subfolder per channel — and a channel is what becomes a profile.
///
/// Counting the hubs rather than the channels: reading every channel definition to get an
/// exact number would turn a two-file read into a directory walk, and the offer does not need
/// the number to be exact — it needs to be right about whether there is anything at all.
fn scan_omm() -> LegacyFind {
    let mut found = LegacyFind::default();
    let Ok(appdata) = std::env::var("APPDATA") else { return found };
    let config = PathBuf::from(&appdata).join("Open Mod Manager").join("config.xml");
    let Ok(text) = std::fs::read_to_string(&config) else { return found };

    for cap in text.split("<path>").skip(1) {
        let Some(end) = cap.find("</path>") else { continue };
        let hub = PathBuf::from(cap[..end].trim());
        if !hub.is_file() {
            continue;
        }
        // The hub's own title, so the offer names what it found. Falling back to the file
        // name rather than skipping: a hub that exists is importable whether or not we could
        // read its title.
        let name = std::fs::read_to_string(&hub)
            .ok()
            .and_then(|body| {
                let start = body.find("<title>")? + "<title>".len();
                let end = body[start..].find("</title>")?;
                Some(body[start..start + end].trim().to_string())
            })
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| hub.file_stem().unwrap_or_default().to_string_lossy().to_string());
        found.names.push(name);
    }
    if !found.names.is_empty() {
        found.source = config.to_string_lossy().to_string();
    }
    found.count = found.names.len();
    found
}

/// What could be imported, without importing anything.
#[tauri::command]
pub fn scan_legacy_managers() -> LegacyScan {
    LegacyScan::with_any(scan_ovgme(), scan_omm())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The scan must be safe to run on a machine that has neither — it is on the boot path.
    #[test]
    fn nothing_installed_is_an_empty_answer_not_an_error() {
        let scan = LegacyScan::with_any(LegacyFind::default(), LegacyFind::default());
        assert!(!scan.any);
        assert_eq!(scan.ovgme.count, 0);
        assert!(scan.omm.names.is_empty());
    }

    /// THE ONE: `any` is what decides whether a person is interrupted on first launch.
    /// Either side alone must be enough, and neither must be enough on its own to be ignored.
    #[test]
    fn either_manager_alone_is_worth_offering() {
        let one = || LegacyFind { count: 1, names: vec!["DCS World".into()], source: "somewhere".into() };
        assert!(LegacyScan::with_any(one(), LegacyFind::default()).any);
        assert!(LegacyScan::with_any(LegacyFind::default(), one()).any);
    }

    /// A real config.xml holds more than the recent list, and a hub path that no longer
    /// exists must not be counted — the offer would name something that cannot be imported.
    #[test]
    fn a_hub_path_that_is_gone_is_not_offered() {
        let text = "<config><recent_list><path>Z:\\gone\\hub.omc</path></recent_list></config>";
        let mut names = vec![];
        for cap in text.split("<path>").skip(1) {
            let Some(end) = cap.find("</path>") else { continue };
            if PathBuf::from(cap[..end].trim()).is_file() {
                names.push(cap[..end].to_string());
            }
        }
        assert!(names.is_empty());
    }
}
