//! The files a plugin ships alongside its code — the Tauri half.
//!
//! A plugin could already carry two kinds of extra: `scripts`, declared so they can be RUN,
//! and `bundle/` folders, copied into the game. Everything else a plugin author actually
//! hands people — a README, a config template, a sample `.mm`, an external tool, a
//! spreadsheet of aircraft codes — had nowhere to go. It went in a Discord message.
//!
//! `assets/` is that folder. It is not code and it is not installed anywhere: it sits in the
//! plugin, gets listed, read, copied out, or handed to an automation.
//!
//! The reading and the path guard live in `plugin_assets_core`, with no Tauri in them, so
//! the standalone CLI and the MCP server mount the same code rather than a second copy of
//! the guard. What is here is the part that needs BMM's state: where a plugin is installed.

pub use super::plugin_assets_core::{list_dir, read_text, resolve, PluginAsset};

fn install_dir_of(state: &crate::state::AppState, plugin_id: &str) -> Result<String, String> {
    let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
    data.installed_plugins
        .iter()
        .find(|p| p.manifest.id == plugin_id)
        .map(|p| p.install_dir.clone())
        .ok_or_else(|| format!("plugins.assets.errNoPlugin|{}", plugin_id))
}

/// Everything in a plugin's `assets/` folder, read from disk.
///
/// An absent folder is an empty list, not an error: most plugins ship none, and a screen
/// that has to tell the difference between "none" and "failed" for the common case is a
/// screen that shows an error to everybody.
#[tauri::command]
pub fn plugin_assets_list(
    state: tauri::State<'_, crate::state::AppState>,
    plugin_id: String,
) -> Result<Vec<PluginAsset>, String> {
    let dir = std::path::PathBuf::from(install_dir_of(&state, &plugin_id)?).join("assets");
    Ok(list_dir(&dir))
}

/// Read a text asset.
#[tauri::command]
pub fn plugin_asset_read(
    state: tauri::State<'_, crate::state::AppState>,
    plugin_id: String,
    path: String,
) -> Result<String, String> {
    read_text(&install_dir_of(&state, &plugin_id)?, &path)
}

/// The absolute path of one asset, for opening it or handing it to something else.
///
/// Goes through the same guard as reading. A caller that could get an arbitrary path back
/// from this would have a file-read primitive with BMM's privileges.
#[tauri::command]
pub fn plugin_asset_path(
    state: tauri::State<'_, crate::state::AppState>,
    plugin_id: String,
    path: String,
) -> Result<String, String> {
    let dir = install_dir_of(&state, &plugin_id)?;
    Ok(resolve(&dir, &path)?.to_string_lossy().to_string())
}

/// Copy one asset out to a folder the user picked.
#[tauri::command]
pub fn plugin_asset_export(
    state: tauri::State<'_, crate::state::AppState>,
    plugin_id: String,
    path: String,
    dest_dir: String,
) -> Result<String, String> {
    let dir = install_dir_of(&state, &plugin_id)?;
    let src = resolve(&dir, &path)?;
    let name = src
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "asset".to_string());
    let dest = std::path::PathBuf::from(&dest_dir);
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    // Never overwrite. The destination is a folder the user chose, full of their own files,
    // and a plugin gets to pick the name inside it.
    let mut target = dest.join(&name);
    let stem = std::path::Path::new(&name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "asset".into());
    let ext = std::path::Path::new(&name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let mut n = 2;
    while target.exists() {
        target = dest.join(format!("{} ({}){}", stem, n, ext));
        n += 1;
    }
    std::fs::copy(&src, &target).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exporting_never_overwrites_what_is_already_there() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("assets")).unwrap();
        std::fs::write(d.path().join("assets").join("README.md"), b"THEIRS").unwrap();
        let dest = tempfile::tempdir().unwrap();
        std::fs::write(dest.path().join("README.md"), b"MINE").unwrap();

        let src = resolve(&d.path().to_string_lossy(), "README.md").unwrap();
        // The naming half of plugin_asset_export, which is the part with a decision in it.
        let mut target = dest.path().join("README.md");
        let mut n = 2;
        while target.exists() {
            target = dest.path().join(format!("README ({}).md", n));
            n += 1;
        }
        std::fs::copy(&src, &target).unwrap();

        assert_eq!(std::fs::read(dest.path().join("README.md")).unwrap(), b"MINE");
        assert_eq!(std::fs::read(dest.path().join("README (2).md")).unwrap(), b"THEIRS");
    }
}

/// Put a file INTO a plugin's `assets/` folder.
///
/// The half that was missing. Reading, listing and copying out existed; getting a README in
/// there meant finding the install folder in Explorer, which is not a thing an author should
/// have to know about their own plugin.
///
/// `rel` is where it lands under `assets/`, and it goes through the same narrowing as
/// everything else: a name chosen by a file dialog can carry anything, and this one is
/// joined onto a path.
#[tauri::command]
pub fn plugin_asset_add(
    state: tauri::State<'_, crate::state::AppState>,
    plugin_id: String,
    src_path: String,
    rel: Option<String>,
) -> Result<String, String> {
    let install = install_dir_of(&state, &plugin_id)?;
    let src = std::path::PathBuf::from(&src_path);
    if !src.is_file() {
        return Err("plugins.assets.errNoSource".to_string());
    }

    // The subfolder, if the caller asked for one, and the file name. Split so a `rel` of
    // `docs/codes.csv` keeps its folder while both halves are still narrowed.
    let rel = rel
        .filter(|r| !r.trim().is_empty())
        .unwrap_or_else(|| src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "file".into()));
    let rel = rel.replace('\\', "/");
    let mut parts: Vec<String> = rel.split('/').filter(|p| !p.is_empty()).map(super::plugin_assets_core::safe_component).collect();
    if parts.is_empty() {
        parts.push("file".into());
    }
    let name = parts.pop().unwrap();

    let mut dir = std::path::PathBuf::from(&install).join("assets");
    for p in &parts {
        dir = dir.join(p);
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("plugins.assets.errWrite|{}", e))?;

    // Never silently replace. An author adding `README.md` twice means they changed it and
    // the second one wins — but an author adding a DIFFERENT file that happens to share a
    // name means they have just lost the first, and only they can tell which.
    let dest = dir.join(&name);
    if dest.exists() {
        return Err(format!("plugins.assets.errExists|{}", name));
    }
    std::fs::copy(&src, &dest).map_err(|e| format!("plugins.assets.errWrite|{}", e))?;

    let rel_out = parts
        .iter()
        .map(|s| s.as_str())
        .chain(std::iter::once(name.as_str()))
        .collect::<Vec<_>>()
        .join("/");
    Ok(rel_out)
}

/// Remove one asset from a plugin.
#[tauri::command]
pub fn plugin_asset_remove(
    state: tauri::State<'_, crate::state::AppState>,
    plugin_id: String,
    path: String,
) -> Result<(), String> {
    let dir = install_dir_of(&state, &plugin_id)?;
    // Through the same guard as reading. Without it, `..` here is a delete-anything primitive
    // — which is a worse version of the read one, because a wrong answer is not recoverable.
    let full = resolve(&dir, &path)?;
    std::fs::remove_file(&full).map_err(|e| format!("plugins.assets.errWrite|{}", e))
}

/// One thing wrong with a plugin, in the words of somebody about to publish it.
#[derive(serde::Serialize, Clone)]
pub struct PluginProblem {
    /// `error` blocks publishing; `warn` is worth reading first.
    pub level: String,
    /// A translation key, so the screen says it in the reader's language.
    pub key: String,
    /// What it is about — a file name, a field name. Substituted into the message.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
}

/// Check a plugin before it goes out.
///
/// Everything here is something that produces a plugin which INSTALLS and then does not
/// work, which is the failure mode with no error message: the manifest is valid JSON, the
/// archive unpacks, and the thing simply does nothing on somebody else's machine.
#[tauri::command]
pub fn plugin_check(
    state: tauri::State<'_, crate::state::AppState>,
    plugin_id: String,
) -> Result<Vec<PluginProblem>, String> {
    let (manifest, install) = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        let p = data
            .installed_plugins
            .iter()
            .find(|p| p.manifest.id == plugin_id)
            .ok_or_else(|| format!("plugins.assets.errNoPlugin|{}", plugin_id))?;
        (p.manifest.clone(), p.install_dir.clone())
    };
    let root = std::path::PathBuf::from(&install);
    let mut out = Vec::new();
    let mut push = |level: &str, key: &str, subject: Option<String>| {
        out.push(PluginProblem { level: level.into(), key: key.into(), subject });
    };

    if manifest.name.trim().is_empty() {
        push("error", "plugins.check.noName", None);
    }
    if manifest.description.trim().is_empty() {
        // Not fatal, and worth saying: a catalogue entry with no description is one nobody
        // installs, and the author is the only person who can write it.
        push("warn", "plugins.check.noDesc", None);
    }
    if manifest.author.trim().is_empty() {
        push("warn", "plugins.check.noAuthor", None);
    }

    // A declared script that is not there. The plugin installs, the apply step runs, and
    // nothing happens — the exact shape this check exists for.
    for rel in &manifest.scripts {
        if !root.join(rel).is_file() {
            push("error", "plugins.check.missingScript", Some(rel.clone()));
        }
    }
    if manifest.has_scripts && manifest.scripts.is_empty() {
        push("warn", "plugins.check.scriptsClaimed", None);
    }

    // A declared asset that is not there. The manifest is written from disk at pack time, so
    // this can only happen when it was edited by hand — which is exactly when it is wrong.
    for a in &manifest.assets {
        if !root.join("assets").join(&a.path).is_file() {
            push("error", "plugins.check.missingAsset", Some(a.path.clone()));
        }
    }

    // Files present that the manifest does not mention. Not an error — the installed copy
    // reads the folder — but it means the manifest is stale, and the manifest is all a
    // moderation queue has.
    let on_disk = super::plugin_assets_core::list_dir(&root.join("assets"));
    for f in &on_disk {
        if !manifest.assets.iter().any(|a| a.path == f.path) {
            push("warn", "plugins.check.undeclaredAsset", Some(f.path.clone()));
        }
    }

    if manifest.apply_mode != "modlist" && manifest.modlist.is_none() && manifest.scripts.is_empty() {
        // Applying it would do nothing at all.
        push("error", "plugins.check.appliesNothing", None);
    }
    if let Some(ml) = &manifest.modlist {
        if ml.strict && ml.required_mods.is_empty() {
            // Strict means "these and nothing else". With an empty list that reads as
            // "turn everything off", which nobody means.
            push("error", "plugins.check.strictEmpty", None);
        }
    }

    Ok(out)
}


/// One thing a plugin ships, whatever kind of thing it is.
///
/// Assets, scripts, bundled folders and automations were four separate lists on three
/// separate screens, which is why the whole area read as unfinished: nowhere answered "what
/// is actually IN this plugin". They differ in what you can DO with one, not in what they
/// are, so they are one list with a `group` and the answer is one screen.
#[derive(serde::Serialize, Clone)]
pub struct PluginItem {
    /// `asset` · `script` · `folder` · `automation`.
    pub group: String,
    /// Path relative to the plugin folder, forward slashes. The id for every action here.
    pub path: String,
    /// The last component, for showing.
    pub name: String,
    /// For an asset, `kind_of` says what it is; for the rest it repeats the group.
    pub kind: String,
    pub size: u64,
    pub readable: bool,
    /// Is it actually there? A manifest lists what its author says it ships.
    ///
    /// Reported rather than filtered out. A declared script that is missing is the single
    /// most useful thing this screen can say — it is exactly the plugin that installs and
    /// then does nothing — and dropping the row would hide it.
    pub present: bool,
    /// Files inside, for a folder. Zero for everything else.
    pub count: u64,
}

/// Everything a plugin ships.
#[tauri::command]
pub fn plugin_contents(
    state: tauri::State<'_, crate::state::AppState>,
    plugin_id: String,
) -> Result<Vec<PluginItem>, String> {
    let (manifest, dir) = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        let p = data
            .installed_plugins
            .iter()
            .find(|p| p.manifest.id == plugin_id)
            .ok_or_else(|| format!("plugins.assets.errNoPlugin|{}", plugin_id))?;
        (p.manifest.clone(), p.install_dir.clone())
    };
    let root = std::path::PathBuf::from(&dir);
    let mut out = Vec::new();
    let last = |rel: &str| rel.rsplit('/').next().unwrap_or(rel).to_string();

    // Assets come from the DISK, not the manifest — the folder is the truth there, and a
    // file the manifest never mentioned is the one somebody should see.
    for a in super::plugin_assets_core::list_dir(&root.join("assets")) {
        out.push(PluginItem {
            group: "asset".into(),
            path: format!("assets/{}", a.path),
            name: a.path.clone(),
            kind: a.kind,
            size: a.size,
            readable: a.readable,
            present: true,
            count: 0,
        });
    }

    // The other three come from the MANIFEST, and are checked against disk. That asymmetry is
    // deliberate: an undeclared asset still works, an undeclared script does not exist as far
    // as anything is concerned, so listing the folder there would invent capability.
    for rel in &manifest.scripts {
        let full = root.join(rel);
        out.push(PluginItem {
            group: "script".into(),
            path: rel.clone(),
            name: last(rel),
            kind: "script".into(),
            size: full.metadata().map(|m| m.len()).unwrap_or(0),
            readable: true,
            present: full.is_file(),
            count: 0,
        });
    }
    for rel in &manifest.folders {
        let full = root.join(rel);
        let (count, bytes) = dir_stats(&full);
        out.push(PluginItem {
            group: "folder".into(),
            path: rel.clone(),
            name: last(rel),
            kind: "folder".into(),
            size: bytes,
            readable: false,
            present: full.is_dir(),
            count,
        });
    }
    for rel in &manifest.automations {
        let full = root.join(rel);
        out.push(PluginItem {
            group: "automation".into(),
            path: rel.clone(),
            name: last(rel),
            kind: "automation".into(),
            size: full.metadata().map(|m| m.len()).unwrap_or(0),
            readable: true,
            present: full.is_file(),
            count: 0,
        });
    }
    Ok(out)
}

/// How many files a bundled folder holds, and how much they weigh.
///
/// Depth-capped like the asset walk. "3 files" is what tells somebody whether the folder they
/// are about to copy is a preset or a mod, and it is the one fact a name never gives.
fn dir_stats(dir: &std::path::Path) -> (u64, u64) {
    if !dir.is_dir() {
        return (0, 0);
    }
    let mut n = 0u64;
    let mut bytes = 0u64;
    for e in walkdir::WalkDir::new(dir).max_depth(8).into_iter().flatten() {
        if e.path().is_file() {
            n += 1;
            bytes += e.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    (n, bytes)
}

/// Read any text file INSIDE a plugin, for the contents screen.
///
/// `plugin_asset_read` is rooted at `assets/` on purpose and stays that way. This one is
/// rooted at the plugin folder, because the screen also shows scripts and automations — and
/// the alternative was a third reader per subfolder, which is three chances to write the
/// traversal guard slightly differently.
///
/// Same guard, same size cap, same lossy decode. It can reach `plugin.json`, which is the
/// plugin's own manifest and already on screen everywhere.
#[tauri::command]
pub fn plugin_file_read(
    state: tauri::State<'_, crate::state::AppState>,
    plugin_id: String,
    path: String,
) -> Result<String, String> {
    let dir = install_dir_of(&state, &plugin_id)?;
    let root = std::path::PathBuf::from(&dir);
    let root_c = root.canonicalize().map_err(|_| "plugins.assets.errNone".to_string())?;
    let full_c = root
        .join(&path)
        .canonicalize()
        .map_err(|_| "plugins.assets.errMissing".to_string())?;
    if !full_c.starts_with(&root_c) || !full_c.is_file() {
        return Err("plugins.assets.errOutside".to_string());
    }
    let len = full_c.metadata().map(|m| m.len()).unwrap_or(0);
    if len > super::plugin_assets_core::MAX_TEXT {
        return Err(format!("plugins.assets.errTooBig|{}", len / 1024));
    }
    Ok(String::from_utf8_lossy(&std::fs::read(&full_c).map_err(|e| e.to_string())?).to_string())
}

/// One file in a folder listing.
#[derive(serde::Serialize)]
pub struct TreeEntry {
    /// Relative to the root, always with `/` separators so the two platforms agree.
    pub path: String,
    pub size: u64,
    /// Directories are listed too: an empty `bundle/` folder is a fact about the plugin.
    pub is_dir: bool,
}

/// A cap. Not a guess: a plugin that ships a game's worth of files would otherwise build a
/// list nobody can read and a message nobody can send.
const TREE_MAX: usize = 5000;

/// Everything under a folder, depth-first, relative paths.
///
/// Cannot escape the root: entries are produced by walking it, never by joining a caller's
/// string onto it. Symlinks are listed but not followed — a link out of the folder would
/// otherwise let a listing walk the whole disk, and the depth cap would not save it.
pub fn walk_tree(root: &std::path::Path) -> Vec<TreeEntry> {
    fn go(base: &std::path::Path, dir: &std::path::Path, out: &mut Vec<TreeEntry>, depth: usize) {
        if depth > 24 || out.len() >= TREE_MAX {
            return;
        }
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        let mut items: Vec<_> = rd.flatten().collect();
        // Sorted, so two readings of the same folder produce the same list. read_dir order
        // is the filesystem's business and is not stable between machines.
        items.sort_by_key(|e| e.file_name());
        for e in items {
            if out.len() >= TREE_MAX {
                return;
            }
            let p = e.path();
            let Ok(rel) = p.strip_prefix(base) else { continue };
            let rel = rel.to_string_lossy().replace('\\', "/");
            let meta = match std::fs::symlink_metadata(&p) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.file_type().is_symlink() {
                // Listed as what it is, and not walked.
                out.push(TreeEntry { path: rel, size: 0, is_dir: false });
                continue;
            }
            if meta.is_dir() {
                out.push(TreeEntry { path: rel, size: 0, is_dir: true });
                go(base, &p, out, depth + 1);
            } else {
                out.push(TreeEntry { path: rel, size: meta.len(), is_dir: false });
            }
        }
    }
    let mut out = Vec::new();
    go(root, root, &mut out, 0);
    out
}

/// Everything a plugin holds, not just its `assets/` folder.
///
/// `plugin_assets_list` answers "what did the author put in assets/", which is a different
/// question from "what IS this plugin". The second one is what somebody asks before running
/// something they downloaded, and there was no way to ask it: the scripts, the bundled
/// folders and the automations were all invisible unless you opened the folder yourself.
#[tauri::command]
pub fn plugin_tree(
    state: tauri::State<'_, crate::state::AppState>,
    plugin_id: String,
) -> Result<Vec<TreeEntry>, String> {
    let dir = install_dir_of(&state, &plugin_id)?;
    let root = std::path::PathBuf::from(&dir);
    if dir.is_empty() || !root.exists() {
        return Err("plugins.assets.errNoFolder".to_string());
    }
    Ok(walk_tree(&root))
}

/// The same listing for a folder the user just picked, before it is bundled into a plugin.
///
/// The create screen let somebody import a folder and then showed them its NAME. What ends
/// up inside the plugin — and inside everybody else's copy of it — was invisible until
/// after it shipped.
#[tauri::command]
pub fn folder_tree(path: String) -> Result<Vec<TreeEntry>, String> {
    let root = std::path::PathBuf::from(&path);
    if !root.is_dir() {
        return Err("plugins.assets.errNoFolder".to_string());
    }
    Ok(walk_tree(&root))
}

#[cfg(test)]
mod tree_tests {
    use super::walk_tree;

    fn scratch(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("bmm_tree_{}_{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("scripts")).unwrap();
        d
    }

    #[test]
    fn it_finds_files_in_sub_folders_and_says_which_are_folders() {
        let d = scratch("nested");
        std::fs::write(d.join("readme.md"), "hi").unwrap();
        std::fs::write(d.join("scripts/run.ps1"), "body").unwrap();
        let out = walk_tree(&d);
        let paths: Vec<_> = out.iter().map(|e| e.path.clone()).collect();
        assert!(paths.contains(&"readme.md".to_string()));
        assert!(paths.contains(&"scripts".to_string()));
        assert!(paths.contains(&"scripts/run.ps1".to_string()));
        assert!(out.iter().find(|e| e.path == "scripts").unwrap().is_dir);
        assert!(!out.iter().find(|e| e.path == "readme.md").unwrap().is_dir);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_same_folder_lists_the_same_way_twice() {
        // read_dir order is the filesystem's business. A listing that reshuffles between two
        // reads is one nobody can compare against anything.
        let d = scratch("stable");
        for n in ["b.txt", "a.txt", "c.txt"] {
            std::fs::write(d.join(n), "x").unwrap();
        }
        let one: Vec<_> = walk_tree(&d).into_iter().map(|e| e.path).collect();
        let two: Vec<_> = walk_tree(&d).into_iter().map(|e| e.path).collect();
        assert_eq!(one, two);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_size_is_reported_for_files_and_not_invented_for_folders() {
        let d = scratch("sizes");
        std::fs::write(d.join("f.bin"), vec![0u8; 1234]).unwrap();
        let out = walk_tree(&d);
        assert_eq!(out.iter().find(|e| e.path == "f.bin").unwrap().size, 1234);
        assert_eq!(out.iter().find(|e| e.path == "scripts").unwrap().size, 0);
        let _ = std::fs::remove_dir_all(&d);
    }
}
