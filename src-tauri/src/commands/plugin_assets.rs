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

pub use super::plugin_assets_core::{list_dir, read_text, resolve, resolve_in, PluginAsset};

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
    copy_out(&resolve(&dir, &path)?, &dest_dir)
}

/// Copy ONE file out of a plugin — any file it ships, not only one under `assets/`.
///
/// `plugin_asset_export` is rooted at `assets/`, which is right for the assets screen and
/// wrong for the contents screen: that one lists the manifest, the scripts and the bundle
/// folders too, and offered to save none of them. Somebody looking at a script and wanting
/// to read it properly, or keep a copy of the manifest, had to find the install folder in
/// Explorer — which is the thing this screen exists to make unnecessary.
///
/// `path` is relative to the plugin folder and is guarded exactly as an asset path is, by
/// the same function with a different root. Files only: a folder is not something
/// `fs::copy` can do, and silently copying nothing would be worse than saying so.
#[tauri::command]
pub fn plugin_file_export(
    state: tauri::State<'_, crate::state::AppState>,
    plugin_id: String,
    path: String,
    dest_dir: String,
) -> Result<String, String> {
    let dir = install_dir_of(&state, &plugin_id)?;
    let src = resolve_in(&dir, &path)?;
    copy_out(&src, &dest_dir)
}

/// Copy `src` into `dest_dir` without ever overwriting what is already there.
///
/// Shared by both exporters, because "never overwrite" is the decision in them and a rule
/// written twice is a rule that is right once. The destination is a folder the user chose,
/// full of their own files, and a plugin gets to pick the name inside it.
fn copy_out(src: &std::path::Path, dest_dir: &str) -> Result<String, String> {
    let name = src
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let dest = std::path::PathBuf::from(dest_dir);
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    let stem = std::path::Path::new(&name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());
    let ext = std::path::Path::new(&name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let mut target = dest.join(&name);
    let mut n = 2;
    while target.exists() {
        target = dest.join(format!("{} ({}){}", stem, n, ext));
        n += 1;
    }
    std::fs::copy(src, &target).map_err(|e| e.to_string())?;
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

    /// The whole point of the second root: a script is not under `assets/`, and the contents
    /// screen lists it. With only the assets-rooted resolver it could be shown and not saved.
    #[test]
    fn a_file_outside_assets_resolves_from_the_plugin_root() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("scripts")).unwrap();
        std::fs::write(d.path().join("scripts").join("go.ps1"), b"echo hi").unwrap();
        let dir = d.path().to_string_lossy().to_string();

        assert!(resolve_in(&dir, "scripts/go.ps1").is_ok());
        // And the assets-rooted one still cannot reach it, which is what keeps the two
        // callers honest about which one they mean.
        assert!(resolve(&dir, "scripts/go.ps1").is_err());
    }

    /// Widening the root must not widen the guard. `..` is the case that matters: `path`
    /// reaches this from a screen, an automation or an HTTP caller, and a resolver that let
    /// it out would be a file-read primitive with BMM's privileges.
    #[test]
    fn the_wider_root_still_refuses_to_leave_the_plugin() {
        let outer = tempfile::tempdir().unwrap();
        let plugin = outer.path().join("plugin");
        std::fs::create_dir_all(&plugin).unwrap();
        std::fs::write(outer.path().join("secret.txt"), b"not yours").unwrap();
        let dir = plugin.to_string_lossy().to_string();

        assert_eq!(resolve_in(&dir, "../secret.txt").unwrap_err(), "plugins.assets.errOutside");
        // A sibling whose name merely STARTS with the root's is the case a string compare
        // gets wrong; `starts_with` on canonical paths matches whole components.
        let evil = outer.path().join("plugin-evil");
        std::fs::create_dir_all(&evil).unwrap();
        std::fs::write(evil.join("x.txt"), b"nope").unwrap();
        assert!(resolve_in(&dir, "../plugin-evil/x.txt").is_err());
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

/// One file, looked at rather than merely named.
///
/// `kind` is the only field a caller should branch on. The rest is whichever half of the
/// answer that kind has: `text` for something readable, `entries` for an archive, and neither
/// for a binary — where the size and the verdict ARE the answer, and a screenful of
/// replacement characters would not be.
#[derive(serde::Serialize)]
pub struct FilePreview {
    /// `text` · `archive` · `binary`
    pub kind: String,
    pub text: Option<String>,
    pub entries: Option<Vec<TreeEntry>>,
    pub size: u64,
    /// True when what came back is only the beginning. Said out loud, because a file that
    /// stops mid-line looks corrupted rather than cut.
    pub truncated: bool,
}

/// Text is read up to here. A log can be hundreds of megabytes and nobody reads the end of
/// one in a modal.
const PREVIEW_MAX: u64 = 256 * 1024;
/// And an archive lists up to here, for the same reason `walk_tree` has a cap.
const PREVIEW_ENTRIES: usize = 2000;

/// Resolve `rel` under `root`, refusing anything that leaves it.
///
/// Its own function rather than `resolve`, which is rooted at `<plugin>/assets` — the tree
/// this serves covers the whole plugin folder, `plugin.json` included, and a folder the
/// person picked in a dialog has no assets subfolder at all.
///
/// Canonicalised on both sides before comparing: a `..` that stays inside after
/// normalisation is fine, and one that does not is refused. Comparing the strings before
/// resolving them is the version of this check that does not work.
fn confine(root: &str, rel: &str) -> Result<std::path::PathBuf, String> {
    let root_c = std::path::PathBuf::from(root)
        .canonicalize()
        .map_err(|_| "plugins.assets.errNoFolder".to_string())?;
    let full_c = root_c
        .join(rel)
        .canonicalize()
        .map_err(|_| "plugins.assets.errMissing".to_string())?;
    if !full_c.starts_with(&root_c) {
        return Err("plugins.assets.errOutside".to_string());
    }
    Ok(full_c)
}

/// Look inside one file of a tree that was already listed.
///
/// The two "what is in this" screens could name a file and never open one, which makes the
/// listing a table of contents for a book nobody can read — and the question people actually
/// have about a plugin they downloaded is what is IN the script, not that there is one.
///
/// Deliberately three answers and not a download: a preview that saved the file to disk to
/// show it would be an install with extra steps.
#[tauri::command]
pub fn preview_under(root: String, rel: String) -> Result<FilePreview, String> {
    let full = confine(&root, &rel)?;
    if full.is_dir() {
        return Err("plugins.assets.errMissing".to_string());
    }
    let size = full.metadata().map(|m| m.len()).unwrap_or(0);

    // An archive first: a .zip is not text, and sniffing it for NUL bytes would say
    // "binary" — true, and the least useful of the three answers we can give.
    if crate::archive::is_archive(&full) {
        let mut entries: Vec<TreeEntry> = crate::archive::archive_entries(&full)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|(path, size)| TreeEntry { path, size, is_dir: false })
            .collect();
        let truncated = entries.len() > PREVIEW_ENTRIES;
        entries.truncate(PREVIEW_ENTRIES);
        return Ok(FilePreview { kind: "archive".into(), text: None, entries: Some(entries), size, truncated });
    }

    // Sniffed, not decided by extension. A `.cfg`, a `.lua` and a file with no extension at
    // all are the ordinary contents of a mod folder, and an extension allowlist answers
    // "this is not text" about all three.
    let want = std::cmp::min(size, PREVIEW_MAX) as usize;
    let bytes = read_head(&full, want).map_err(|e| e.to_string())?;
    if bytes.contains(&0) {
        return Ok(FilePreview { kind: "binary".into(), text: None, entries: None, size, truncated: false });
    }
    match String::from_utf8(bytes) {
        Ok(text) => Ok(FilePreview {
            kind: "text".into(),
            text: Some(text),
            entries: None,
            size,
            truncated: size > PREVIEW_MAX,
        }),
        // Valid bytes that are not UTF-8 — a Windows-1252 readme, say. Reported as binary
        // rather than mangled: half-right text is harder to disbelieve than none.
        Err(_) => Ok(FilePreview { kind: "binary".into(), text: None, entries: None, size, truncated: false }),
    }
}

/// The first `n` bytes, without reading the rest into memory first.
fn read_head(path: &std::path::Path, n: usize) -> std::io::Result<Vec<u8>> {
    use std::io::Read;
    let mut f = std::fs::File::open(path)?;
    let mut buf = vec![0u8; n];
    let mut got = 0;
    while got < n {
        match f.read(&mut buf[got..])? {
            0 => break,
            k => got += k,
        }
    }
    buf.truncate(got);
    Ok(buf)
}

#[cfg(test)]
mod preview_tests {
    use super::{confine, preview_under};

    fn scratch(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("bmm_prev_{}_{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// The one that matters. Everything else here is a convenience; this is the difference
    /// between a preview and a way to read any file on the disk.
    #[test]
    fn it_cannot_be_walked_out_of() {
        let root = scratch("escape");
        let inside = root.join("in");
        std::fs::create_dir_all(&inside).unwrap();
        std::fs::write(inside.join("ok.txt"), b"fine").unwrap();
        // A real file OUTSIDE the root, next to it rather than deep in the system: if the
        // guard is wrong, this is what comes back.
        let outside = root.parent().unwrap().join("bmm_prev_secret.txt");
        std::fs::write(&outside, b"not yours").unwrap();

        assert!(confine(root.to_str().unwrap(), "in/ok.txt").is_ok());
        for probe in [
            "../bmm_prev_secret.txt",
            "in/../../bmm_prev_secret.txt",
            "in/./../../bmm_prev_secret.txt",
        ] {
            assert!(
                confine(root.to_str().unwrap(), probe).is_err(),
                "escaped with {probe}",
            );
        }
        // And a `..` that stays inside is NOT refused — over-refusing is the same bug
        // pointing the other way, and it would break any tree with a relative path in it.
        assert!(confine(root.to_str().unwrap(), "in/../in/ok.txt").is_ok());

        let _ = std::fs::remove_file(&outside);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn text_comes_back_as_text_and_a_nul_makes_it_binary() {
        let root = scratch("kinds");
        std::fs::write(root.join("a.lua"), b"-- no extension allowlist saw this coming\n").unwrap();
        // No extension at all, which is ordinary inside a mod folder.
        std::fs::write(root.join("README"), b"plain").unwrap();
        std::fs::write(root.join("b.dat"), [0x00u8, 0x01, 0x02]).unwrap();

        let r = preview_under(root.to_string_lossy().into(), "a.lua".into()).unwrap();
        assert_eq!(r.kind, "text");
        assert!(r.text.unwrap().contains("allowlist"));

        assert_eq!(preview_under(root.to_string_lossy().into(), "README".into()).unwrap().kind, "text");

        let b = preview_under(root.to_string_lossy().into(), "b.dat".into()).unwrap();
        assert_eq!(b.kind, "binary");
        assert!(b.text.is_none(), "binary must not carry mangled text");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_directory_is_refused_rather_than_previewed_as_empty() {
        let root = scratch("dir");
        std::fs::create_dir_all(root.join("sub")).unwrap();
        assert!(preview_under(root.to_string_lossy().into(), "sub".into()).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_missing_file_says_missing_instead_of_returning_nothing() {
        let root = scratch("missing");
        assert!(preview_under(root.to_string_lossy().into(), "nope.txt".into()).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
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
