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
