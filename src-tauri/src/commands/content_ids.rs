//! A stable name for a thing, so two people can tell they have the same one.
//!
//! A mod already has this: `derive_content_id` fingerprints its folder, and the same files on
//! any machine give the same answer. Nothing else did. A modpack, a plugin and an automation
//! all carry a local `id` minted when they were created — `sched-<timestamp>`, a uuid — which
//! is a different string on every machine that has the same content.
//!
//! So "is this the pack I already have" was unanswerable. Importing the same modpack from a
//! repo and from a catalogue produced two entries with two ids and no way to notice, and
//! sharing one meant telling somebody a number that meant nothing on their side.
//!
//! Same rule as the mod one: **hash what the thing IS, never what it is called here.** A name
//! and a description are edited; the members are the pack.

use sha2::{Digest, Sha256};

/// The prefix every derived id carries, so it can never be mistaken for a local one.
///
/// A local modpack id is a uuid and a task id is `sched-<millis>`; a content id looks like
/// neither, which matters the first time somebody pastes one into the wrong field.
pub const PREFIX: &str = "bmmc1:";

/// Fold a set of already-stable parts into one id.
///
/// Sorted before hashing, because the order two lists happen to be in is not part of what they
/// are — a pack whose mods were added in a different order is the same pack, and a rule that
/// says otherwise makes the whole idea useless.
///
/// Empty parts are skipped rather than hashed as "": a member with no fingerprint contributes
/// nothing, which is honest, instead of contributing a constant that every incomplete pack
/// would share.
pub fn fold(kind: &str, parts: &[String]) -> String {
    let mut keep: Vec<&String> = parts.iter().filter(|p| !p.trim().is_empty()).collect();
    keep.sort();
    keep.dedup();
    let mut h = Sha256::new();
    h.update(kind.as_bytes());
    h.update([0u8]);
    for p in keep {
        h.update(p.trim().as_bytes());
        h.update([0u8]);
    }
    format!("{}{:x}", PREFIX, h.finalize())
}

/// A modpack's content id: what it contains, not what it is called.
///
/// Each member contributes its own sha256 when it has one and its mod id otherwise. A pack
/// assembled from the same mods on two machines lands on the same id even when the local
/// entries were created at different times under different uuids.
pub fn modpack_id(mods: &[(String, String)]) -> String {
    let parts: Vec<String> = mods
        .iter()
        .map(|(mod_id, sha)| if sha.trim().is_empty() { mod_id.clone() } else { sha.clone() })
        .collect();
    fold("modpack", &parts)
}

/// A plugin's content id: its declared id, and every file it ships WITH THAT FILE'S BYTES.
///
/// The declared id is included here and NOT for a modpack, and the difference is real: a
/// plugin author chooses `com.me.tools` and means it to be the identity, while a modpack's
/// name is a label somebody typed.
///
/// Each entry is `path` + the sha256 of what is at that path. That second half was missing:
/// this used to fold the file NAMES alone, so a plugin whose script was rewritten from top
/// to bottom kept the same content id, and two plugins with the same filenames and entirely
/// different code shared one. A content id that cannot tell those apart answers the only
/// question it exists for — "is this the same thing you have" — with a confident no.
///
/// A file the manifest declares but that is not on disk contributes its path and an empty
/// hash. That is honest: "declared, not present" is a real state and is different from both
/// "absent" and "present with content".
pub fn plugin_id(declared_id: &str, entries: &[(String, String)]) -> String {
    let mut parts = vec![declared_id.trim().to_string()];
    parts.extend(entries.iter().map(|(path, sha)| format!("{path}\u{1f}{sha}")));
    fold("plugin", &parts)
}

/// The sha256 of one file, or an empty string when it cannot be read.
///
/// Unreadable is not fatal here. A plugin folder can be mid-write, on a disconnected drive,
/// or missing a file the manifest names — and refusing to answer at all would make the
/// button fail where "this is what I can see" is a useful answer.
pub fn file_sha(path: &std::path::Path) -> String {
    use std::io::Read;
    let Ok(mut f) = std::fs::File::open(path) else { return String::new() };
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        match f.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => h.update(&buf[..n]),
            Err(_) => return String::new(),
        }
    }
    format!("{:x}", h.finalize())
}

/// Every file a plugin folder actually holds, relative to it, with its hash.
///
/// Walked rather than read from the manifest. The manifest lists what the AUTHOR declared;
/// what is on disk is what the plugin IS, and a file added beside the declared ones is part
/// of it whether or not anybody wrote it down.
pub fn plugin_entries(install_dir: &std::path::Path) -> Vec<(String, String)> {
    fn walk(base: &std::path::Path, dir: &std::path::Path, out: &mut Vec<(String, String)>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(base, &p, out);
            } else if let Ok(rel) = p.strip_prefix(base) {
                // Separator-normalised, so the same plugin folder read on Windows and on
                // Linux folds to the same id.
                out.push((rel.to_string_lossy().replace('\\', "/"), file_sha(&p)));
            }
        }
    }
    let mut out = Vec::new();
    walk(install_dir, install_dir, &mut out);
    out
}

/// An automation's content id: its steps, as JSON, with the local bookkeeping removed.
///
/// `id`, `lastRun`, `lastResult`, `history` and `enabled` all describe THIS machine. Two people
/// running the same automation must get the same id, and one of them having run it must not
/// change the answer.
pub fn task_id(task: &serde_json::Value) -> String {
    let mut copy = task.clone();
    if let Some(o) = copy.as_object_mut() {
        for k in ["id", "lastRun", "lastResult", "history", "enabled", "osSchedule", "createdAt"] {
            o.remove(k);
        }
    }
    // Serialised through a BTreeMap-backed value so key order cannot change the hash. serde_json
    // preserves insertion order by default, and two editors writing the same task in a different
    // field order would otherwise produce two ids.
    let canonical = canonical_json(&copy);
    fold("task", &[canonical])
}

/// JSON with every object's keys in sorted order, so equal documents hash equally.
fn canonical_json(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let inner: Vec<String> = keys
                .iter()
                .map(|k| format!("{}:{}", serde_json::to_string(k).unwrap_or_default(), canonical_json(&map[*k])))
                .collect();
            format!("{{{}}}", inner.join(","))
        }
        serde_json::Value::Array(items) => {
            // Arrays keep their order: a task's steps are a sequence, and sorting them would
            // make two different automations look identical.
            format!("[{}]", items.iter().map(canonical_json).collect::<Vec<_>>().join(","))
        }
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A scratch plugin folder.
    fn plug_dir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("bmm_cid_{}_{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("scripts")).unwrap();
        d
    }

    #[test]
    fn editing_a_script_changes_the_plugin() {
        // The bug this replaced: the id folded the file NAMES, so a script rewritten from
        // top to bottom kept the same content id and two plugins with matching filenames and
        // entirely different code shared one.
        let d = plug_dir("edit");
        std::fs::write(d.join("scripts/run.ps1"), "Write-Host 'one'").unwrap();
        let before = plugin_id("com.me.tools", &plugin_entries(&d));
        std::fs::write(d.join("scripts/run.ps1"), "Write-Host 'two'").unwrap();
        let after = plugin_id("com.me.tools", &plugin_entries(&d));
        assert_ne!(before, after, "the same name with different bytes is a different plugin");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_same_files_untouched_give_the_same_answer_twice() {
        // The other half of the promise, and the one somebody actually relies on: nothing
        // changed, so nothing changes.
        let d = plug_dir("same");
        std::fs::write(d.join("scripts/run.ps1"), "same bytes").unwrap();
        assert_eq!(plugin_id("x", &plugin_entries(&d)), plugin_id("x", &plugin_entries(&d)));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn renaming_a_file_is_a_change_too() {
        let d = plug_dir("rename");
        std::fs::write(d.join("scripts/a.ps1"), "body").unwrap();
        let before = plugin_id("x", &plugin_entries(&d));
        std::fs::rename(d.join("scripts/a.ps1"), d.join("scripts/b.ps1")).unwrap();
        assert_ne!(before, plugin_id("x", &plugin_entries(&d)));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_file_nobody_declared_still_counts() {
        // Walked, not read from the manifest. What the author wrote down is a claim; what is
        // in the folder is what the plugin ships.
        let d = plug_dir("undeclared");
        std::fs::write(d.join("scripts/run.ps1"), "body").unwrap();
        let before = plugin_id("x", &plugin_entries(&d));
        std::fs::write(d.join("scripts/extra.ps1"), "surprise").unwrap();
        assert_ne!(before, plugin_id("x", &plugin_entries(&d)));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_bundle_is_the_hash_of_its_file() {
        // One file, and the only honest thing to say about it is what is in it. Folding the
        // catalogue inside would keep the id when a packed payload changed — the same
        // mistake the plugin id was making.
        assert_ne!(bundle_id("aaa"), bundle_id("bbb"));
        assert_eq!(bundle_id("AAA"), bundle_id("aaa"), "a hash is not case-sensitive");
        assert!(bundle_id("aaa").starts_with(PREFIX));
    }

    #[test]
    fn the_same_members_in_a_different_order_are_the_same_pack() {
        let a = modpack_id(&[("m1".into(), "aaa".into()), ("m2".into(), "bbb".into())]);
        let b = modpack_id(&[("m2".into(), "bbb".into()), ("m1".into(), "aaa".into())]);
        assert_eq!(a, b, "the order mods were added in is not part of what the pack is");
    }

    #[test]
    fn a_different_member_is_a_different_pack() {
        let a = modpack_id(&[("m1".into(), "aaa".into())]);
        let b = modpack_id(&[("m1".into(), "ccc".into())]);
        assert_ne!(a, b);
    }

    #[test]
    fn a_member_with_no_fingerprint_falls_back_to_its_id() {
        // Better than hashing an empty string, which every incomplete pack would share.
        let a = modpack_id(&[("m1".into(), String::new())]);
        let b = modpack_id(&[("m1".into(), String::new())]);
        assert_eq!(a, b);
        assert_ne!(a, modpack_id(&[("m2".into(), String::new())]));
    }

    #[test]
    fn every_id_says_what_it_is() {
        // A local modpack id is a uuid and a task id is `sched-<millis>`. This looks like
        // neither, which is the point the first time one is pasted into the wrong field.
        assert!(modpack_id(&[("a".into(), "b".into())]).starts_with(PREFIX));
        assert!(plugin_id("x", &[]).starts_with(PREFIX));
        assert!(task_id(&json!({ "steps": [] })).starts_with(PREFIX));
    }

    #[test]
    fn two_kinds_never_collide() {
        // The kind is hashed in, so a plugin and a modpack built from the same string are
        // still two different things.
        assert_ne!(fold("plugin", &["x".into()]), fold("modpack", &["x".into()]));
    }

    #[test]
    fn local_bookkeeping_does_not_change_a_task() {
        let bare = json!({ "name": "T", "steps": [{ "kind": "action" }] });
        let lived_in = json!({
            "id": "sched-123", "name": "T", "enabled": true, "lastRun": 99,
            "lastResult": "ok", "history": [{ "at": 1 }], "osSchedule": true,
            "createdAt": 5, "steps": [{ "kind": "action" }],
        });
        assert_eq!(task_id(&bare), task_id(&lived_in), "running it must not rename it");
    }

    #[test]
    fn key_order_does_not_change_a_task() {
        let one: serde_json::Value = serde_json::from_str(r#"{"name":"T","steps":[]}"#).unwrap();
        let two: serde_json::Value = serde_json::from_str(r#"{"steps":[],"name":"T"}"#).unwrap();
        assert_eq!(task_id(&one), task_id(&two));
    }

    #[test]
    fn step_order_is_the_one_thing_that_must_not_be_sorted() {
        // The one place sorting would be wrong: steps are a sequence.
        let a = json!({ "steps": [{ "kind": "a" }, { "kind": "b" }] });
        let b = json!({ "steps": [{ "kind": "b" }, { "kind": "a" }] });
        assert_ne!(task_id(&a), task_id(&b));
    }
}

/// The content id of one thing BMM holds, by kind and local id.
///
/// One command rather than three, because the answer is the same shape and the caller is a
/// copy button that does not care which kind it is looking at.
#[tauri::command]
pub fn content_id_of(
    state: tauri::State<'_, crate::state::AppState>,
    app: tauri::AppHandle,
    kind: String,
    id: String,
) -> Result<String, String> {
    let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
    match kind.as_str() {
        "modpack" => {
            let pack = data
                .modpacks
                .iter()
                .find(|m| m.id == id)
                .ok_or_else(|| "cid.errNoModpack".to_string())?;
            let members: Vec<(String, String)> = pack
                .mods
                .iter()
                .map(|m| (m.mod_id.clone(), m.sha256.clone()))
                .collect();
            Ok(modpack_id(&members))
        }
        "plugin" => {
            let p = data
                .installed_plugins
                .iter()
                .find(|p| p.manifest.id == id)
                .ok_or_else(|| "cid.errNoPlugin".to_string())?;
            // What is ON DISK, not what the manifest lists. See plugin_entries.
            let dir = std::path::PathBuf::from(&p.install_dir);
            let entries = if dir.as_os_str().is_empty() || !dir.exists() {
                // No folder to read — a catalogue entry, or a plugin whose files are gone.
                // Fall back to the declared names so the button still answers, and it is
                // still a different answer from a plugin whose files ARE readable.
                let mut names: Vec<(String, String)> = Vec::new();
                for n in p.manifest.scripts.iter()
                    .chain(p.manifest.folders.iter())
                    .chain(p.manifest.automations.iter())
                {
                    names.push((n.clone(), String::new()));
                }
                for a in &p.manifest.assets {
                    names.push((a.path.clone(), String::new()));
                }
                names
            } else {
                plugin_entries(&dir)
            };
            Ok(plugin_id(&p.manifest.id, &entries))
        }
        "task" => {
            drop(data);
            // Tasks live in their own file, not in AppData's struct.
            let doc = crate::commands::scheduler::get_schedules(app)?;
            let found = doc
                .as_array()
                .and_then(|a| a.iter().find(|t| t.get("id").and_then(|x| x.as_str()) == Some(id.as_str())))
                .ok_or_else(|| "cid.errNoTask".to_string())?;
            Ok(task_id(found))
        }
        other => Err(format!("cid.errKind|{}", other)),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// The other kinds
//
// A content id answers "is this the same thing you have". So for each kind the question is
// the same one asked twice: what is the THING, and what is only where it happens to live.
//
// These take the document rather than an id and a store. Every one of these already exists
// as JSON somewhere the caller is holding — a theme file, a catalogue entry, a .mmlist — and
// a command that re-reads it from a store would need six stores and would still be hashing
// the same fields.
// ─────────────────────────────────────────────────────────────────────────────

/// A profile: which game, and what is switched on.
///
/// NOT the name, the colour, the icon or any of the three paths — those are this machine.
/// Two people running the same loadout for the same game get the same id, which is the only
/// useful thing to be able to compare across two installs.
pub fn profile_id(game: &str, active_mods: &[String]) -> String {
    let mut parts = vec![format!("game:{}", game.trim().to_lowercase())];
    parts.extend(active_mods.iter().cloned());
    fold("profile", &parts)
}

/// A launch pack: which programs, by FILE NAME.
///
/// Deliberately the basename and not the path. `D:\\Games\\DCS\\bin\\DCS.exe` and
/// `C:\\DCS\\bin\\DCS.exe` are the same launcher on two machines, and a content id that
/// disagreed about that would never match anywhere — which is the same as not having one.
pub fn launchpack_id(exe_paths: &[String]) -> String {
    let parts: Vec<String> = exe_paths
        .iter()
        .map(|p| {
            p.rsplit(|c| c == '/' || c == '\\')
                .next()
                .unwrap_or(p)
                .to_lowercase()
        })
        .collect();
    fold("launchpack", &parts)
}

/// A theme: the tokens, and nothing else.
///
/// A theme IS its colours. `name`, `author`, `description` and `version` are a label on the
/// jar — renaming a theme does not make it a different theme, and two people who both
/// downloaded "Nord" and one of whom renamed it should still see that they match.
pub fn theme_id(theme: &serde_json::Value) -> String {
    let mut copy = theme.clone();
    if let Some(o) = copy.as_object_mut() {
        for k in ["name", "author", "description", "version", "id", "createdAt", "updatedAt"] {
            o.remove(k);
        }
    }
    fold("theme", &[canonical_json(&copy)])
}

/// A catalogue app entry: the bytes people will download.
///
/// The checksum when the publisher gave one, the URL when they did not. That order matters:
/// two catalogues listing the same installer under different URLs ARE the same app, and the
/// sha256 is the only thing that can say so. Falling back to the URL is weaker and honest —
/// it is what the entry actually pins.
pub fn app_id(sha256: &str, url: &str) -> String {
    let key = if sha256.trim().is_empty() { url.trim().to_lowercase() } else { sha256.trim().to_lowercase() };
    fold("app", &[key])
}

/// A `.bmmbundle`: the sha256 of the archive.
///
/// A bundle is one file, and the only honest thing to say about it is what is in that file.
/// Reading the catalogue inside and folding its entries would give an id that stays the same
/// when a packed payload changes, which is the same mistake the plugin id was making.
pub fn bundle_id(sha256: &str) -> String {
    fold("bundle", &[sha256.trim().to_lowercase()])
}

/// A mod list (.mmlist): its members, the same rule as a modpack.
pub fn modlist_id(mods: &[(String, String)]) -> String {
    let parts: Vec<String> = mods
        .iter()
        .map(|(mod_id, sha)| if sha.trim().is_empty() { mod_id.clone() } else { sha.clone() })
        .collect();
    fold("modlist", &parts)
}

/// A server repo: what it publishes.
///
/// Its URL is where it is, not what it is — the same repo behind a new domain is the same
/// repo, and two mirrors of one repo are not two repos. So this is the manifest's mods, and
/// a repo that has published nothing yet folds to the empty set, which is correct: there is
/// nothing to be the same as.
pub fn repo_id(mods: &[(String, String)]) -> String {
    let parts: Vec<String> = mods
        .iter()
        .map(|(mod_id, sha)| if sha.trim().is_empty() { mod_id.clone() } else { sha.clone() })
        .collect();
    fold("repo", &parts)
}

/// The content id of a document the caller is already holding.
///
/// One command for every kind whose document travels: the caller has the theme file, the
/// catalogue entry, the .mmlist or the repo manifest in front of it, and hashing it here
/// keeps the ONE definition of each kind in Rust beside its tests.
#[tauri::command]
pub fn content_id_from(kind: String, doc: serde_json::Value) -> Result<String, String> {
    /// `mods`/`required_mods`/`entries` — the three names the same list travels under.
    fn members(doc: &serde_json::Value) -> Vec<(String, String)> {
        let arr = ["mods", "required_mods", "entries"]
            .iter()
            .find_map(|k| doc.get(*k).and_then(|v| v.as_array()))
            .or_else(|| doc.as_array());
        arr.map(|a| {
            a.iter()
                .map(|m| {
                    let id = m.get("id").and_then(|x| x.as_str())
                        .or_else(|| m.get("mod_id").and_then(|x| x.as_str()))
                        .or_else(|| m.get("name").and_then(|x| x.as_str()))
                        .unwrap_or("")
                        .to_string();
                    let sha = m.get("sha256").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    (id, sha)
                })
                .collect()
        })
        .unwrap_or_default()
    }

    let str_at = |k: &str| doc.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();

    match kind.as_str() {
        "theme" => Ok(theme_id(&doc)),
        "app" => {
            let d = doc.get("download").cloned().unwrap_or_else(|| doc.clone());
            let sha = d.get("sha256").and_then(|x| x.as_str()).unwrap_or("");
            let url = d.get("url").and_then(|x| x.as_str()).unwrap_or("");
            if sha.trim().is_empty() && url.trim().is_empty() {
                return Err("cid.errNoApp".to_string());
            }
            Ok(app_id(sha, url))
        }
        "modlist" => Ok(modlist_id(&members(&doc))),
        "bundle" => {
            // Either the hash, or a path to hash. A caller holding the file is the common
            // case and should not have to compute it first.
            let sha = doc.get("sha256").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
            let sha = if sha.is_empty() {
                match doc.get("path").and_then(|x| x.as_str()) {
                    Some(p) if !p.trim().is_empty() => file_sha(std::path::Path::new(p.trim())),
                    _ => String::new(),
                }
            } else {
                sha
            };
            if sha.is_empty() {
                return Err("cid.errNoBundle".to_string());
            }
            Ok(bundle_id(&sha))
        }
        "repo" => Ok(repo_id(&members(&doc))),
        "profile" => {
            let mods: Vec<String> = doc
                .get("active_mods")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default();
            Ok(profile_id(&str_at("game_name"), &mods))
        }
        "launchpack" => {
            let exes: Vec<String> = doc
                .get("executable_paths")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default();
            Ok(launchpack_id(&exes))
        }
        "modpack" => Ok(modpack_id(&members(&doc))),
        "task" => Ok(task_id(&doc)),
        other => Err(format!("cid.errKind|{}", other)),
    }
}

#[cfg(test)]
mod other_kind_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_profile_is_its_game_and_its_loadout_not_its_paths() {
        let a = content_id_from("profile".into(), json!({
            "name": "Mine", "game_name": "DCS", "color": "#f00",
            "game_path": "D:/DCS", "mods_path": "D:/mods", "active_mods": ["m1", "m2"],
        })).unwrap();
        let b = content_id_from("profile".into(), json!({
            "name": "Somebody else's", "game_name": "DCS", "color": "#0f0",
            "game_path": "C:/Games/DCS", "mods_path": "C:/m", "active_mods": ["m2", "m1"],
        })).unwrap();
        assert_eq!(a, b, "same game, same mods on, different machine");
    }

    #[test]
    fn a_different_game_is_a_different_profile_even_with_the_same_mods() {
        let a = profile_id("DCS", &["m1".into()]);
        let b = profile_id("ArmA 3", &["m1".into()]);
        assert_ne!(a, b);
    }

    #[test]
    fn a_launch_pack_ignores_where_the_programs_live() {
        let a = launchpack_id(&[r"D:\Games\DCS\bin\DCS.exe".into()]);
        let b = launchpack_id(&[r"C:\DCS\bin\dcs.EXE".into()]);
        assert_eq!(a, b, "the same launcher on two machines");
    }

    #[test]
    fn a_theme_is_its_colours_not_its_name() {
        let a = theme_id(&json!({ "name": "Nord", "author": "x", "tokens": { "--accent": "#88c" } }));
        let b = theme_id(&json!({ "name": "My Nord", "author": "y", "tokens": { "--accent": "#88c" } }));
        assert_eq!(a, b, "renaming a theme does not make it another theme");
        let c = theme_id(&json!({ "name": "Nord", "tokens": { "--accent": "#f00" } }));
        assert_ne!(a, c, "a different colour IS a different theme");
    }

    #[test]
    fn an_app_prefers_the_checksum_and_falls_back_to_the_url() {
        let with = content_id_from("app".into(), json!({ "download": { "url": "https://a/x.zip", "sha256": "abc" } })).unwrap();
        let same_file_elsewhere = content_id_from("app".into(), json!({ "download": { "url": "https://MIRROR/x.zip", "sha256": "abc" } })).unwrap();
        assert_eq!(with, same_file_elsewhere, "one installer behind two URLs is one app");
        let without = content_id_from("app".into(), json!({ "download": { "url": "https://a/x.zip" } })).unwrap();
        assert_ne!(with, without, "pinning a URL is not the same claim as pinning the bytes");
    }

    #[test]
    fn an_app_with_neither_says_so_rather_than_hashing_nothing() {
        assert!(content_id_from("app".into(), json!({ "download": {} })).is_err());
    }

    #[test]
    fn a_modlist_and_a_modpack_of_the_same_mods_are_not_the_same_id() {
        // The kind is folded in. They are two different documents that happen to list the
        // same things, and a shared id would make one look like the other.
        let doc = json!({ "mods": [{ "id": "m1", "sha256": "aa" }] });
        assert_ne!(
            content_id_from("modlist".into(), doc.clone()).unwrap(),
            content_id_from("modpack".into(), doc).unwrap()
        );
    }

    #[test]
    fn the_three_names_one_member_list_travels_under_all_work() {
        let by_mods = content_id_from("modlist".into(), json!({ "mods": [{ "id": "m1" }] })).unwrap();
        let by_required = content_id_from("modlist".into(), json!({ "required_mods": [{ "id": "m1" }] })).unwrap();
        let by_entries = content_id_from("modlist".into(), json!({ "entries": [{ "id": "m1" }] })).unwrap();
        let bare = content_id_from("modlist".into(), json!([{ "id": "m1" }])).unwrap();
        assert_eq!(by_mods, by_required);
        assert_eq!(by_mods, by_entries);
        assert_eq!(by_mods, bare);
    }

    #[test]
    fn every_kind_answers_or_names_itself_in_the_refusal() {
        for k in ["theme", "modlist", "repo", "profile", "launchpack", "modpack", "task"] {
            assert!(content_id_from(k.into(), json!({})).is_ok(), "{k} refused an empty document");
        }
        let e = content_id_from("teapot".into(), json!({})).unwrap_err();
        assert!(e.contains("teapot"), "the refusal must name what was asked for: {e}");
    }
}
