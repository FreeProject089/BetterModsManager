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

pub use super::plugin_assets_core::{kind_of, list_dir, read_text, resolve, PluginAsset};

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
