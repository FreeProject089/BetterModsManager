//! The files a plugin ships alongside its code.
//!
//! A plugin could already carry two kinds of extra: `scripts`, which are declared so they
//! can be RUN, and `bundle/` folders, which are copied into the game. Everything else a
//! plugin author actually hands people — a README, a config template, a sample `.mm`, an
//! external tool, a spreadsheet of aircraft codes — had nowhere to go. It went in a Discord
//! message.
//!
//! `assets/` is that folder. It is not code and it is not installed anywhere: it sits in the
//! plugin, gets listed, read, copied out, or handed to an automation.
//!
//! **The disk is the truth, not the manifest.** A manifest declares what its author says is
//! there; this walks the folder. A plugin whose manifest lists a README that is not present
//! shows nothing rather than an entry that fails to open, and one carrying a file its
//! manifest never mentioned still shows it — which is the case that matters, because a
//! surprise file is the one somebody should see.

use serde::{Deserialize, Serialize};

/// One shipped file.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginAsset {
    /// Path relative to `assets/`, always with forward slashes.
    pub path: String,
    /// `doc` · `script` · `image` · `data` · `archive` · `other`.
    ///
    /// From the extension, and it decides what the screen offers. `script` is the one that
    /// changes behaviour rather than presentation: it is the only kind an automation may be
    /// asked to RUN, and the only one shown with a warning.
    pub kind: String,
    pub size: u64,
    /// True when this is text BMM will render or read into a variable.
    pub readable: bool,
}

/// What an extension means here.
///
/// Deliberately blunt. The point is not to classify every file type in the world, it is to
/// separate "this is a document I can show you" from "this is a program" from "everything
/// else", because those three get offered different buttons.
pub fn kind_of(name: &str) -> &'static str {
    let ext = std::path::Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "md" | "markdown" | "txt" | "rst" | "adoc" => "doc",
        "ps1" | "bat" | "cmd" | "sh" | "py" | "js" | "mjs" | "rb" | "pl" | "lua" | "vbs" => "script",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "ico" => "image",
        "json" | "csv" | "tsv" | "yaml" | "yml" | "ini" | "toml" | "cfg" | "conf" | "xml" => "data",
        "zip" | "7z" | "rar" | "gz" | "tar" | "bmmpa" | "bmmtheme" | "mm" | "bmp" => "archive",
        _ => "other",
    }
}

/// Can BMM show this as text, or read it into a variable?
fn readable(kind: &str) -> bool {
    matches!(kind, "doc" | "data" | "script")
}

/// The most a text asset may be, read into memory.
///
/// A README is kilobytes. This is not a limit anybody legitimate meets — it is there so a
/// 900 MB file named `notes.txt` cannot be read into the interface by clicking on it.
const MAX_TEXT: u64 = 2 * 1024 * 1024;

/// Where a plugin's assets live, and the guard that keeps them there.
///
/// `install_dir` comes from BMM's own state; `rel` comes from a manifest, a screen or an
/// automation, so it is untrusted. Canonicalised and checked to be INSIDE the assets folder,
/// which is what `..` and an absolute path both fail. `starts_with` on canonical paths is a
/// component-prefix match, so `assets-evil/` cannot pass as `assets/`.
fn resolve(install_dir: &str, rel: &str) -> Result<std::path::PathBuf, String> {
    let root = std::path::PathBuf::from(install_dir).join("assets");
    let root_c = root.canonicalize().map_err(|_| "plugins.assets.errNone".to_string())?;
    let full = root.join(rel);
    let full_c = full.canonicalize().map_err(|_| "plugins.assets.errMissing".to_string())?;
    if !full_c.starts_with(&root_c) {
        return Err("plugins.assets.errOutside".to_string());
    }
    if !full_c.is_file() {
        return Err("plugins.assets.errMissing".to_string());
    }
    Ok(full_c)
}

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

/// The same, for a folder rather than an installed plugin — used by the export path so a
/// manifest's declaration is written from what is actually there.
pub fn list_dir(dir: &std::path::Path) -> Vec<PluginAsset> {
    let mut out = Vec::new();
    if !dir.is_dir() {
        return out;
    }
    for entry in walkdir::WalkDir::new(dir).max_depth(8).into_iter().flatten() {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let Ok(rel) = p.strip_prefix(dir) else { continue };
        let rel_s = rel.to_string_lossy().replace('\\', "/");
        let kind = kind_of(&rel_s);
        out.push(PluginAsset {
            path: rel_s,
            kind: kind.to_string(),
            size: p.metadata().map(|m| m.len()).unwrap_or(0),
            readable: readable(kind),
        });
    }
    // Sorted, so the same plugin lists the same way twice. read_dir order is the
    // filesystem's, which is not stable and reads as the list shuffling itself.
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

/// Read a text asset.
#[tauri::command]
pub fn plugin_asset_read(
    state: tauri::State<'_, crate::state::AppState>,
    plugin_id: String,
    path: String,
) -> Result<String, String> {
    let dir = install_dir_of(&state, &plugin_id)?;
    let full = resolve(&dir, &path)?;
    if !readable(kind_of(&path)) {
        // By KIND, not by trying and failing. "This is an image" is a better answer than a
        // screenful of replacement characters.
        return Err("plugins.assets.errNotText".to_string());
    }
    let len = full.metadata().map(|m| m.len()).unwrap_or(0);
    if len > MAX_TEXT {
        return Err(format!("plugins.assets.errTooBig|{}", len / 1024));
    }
    // Lossy: a config file written by another tool may not be valid UTF-8, and one bad byte
    // must not cost the whole file.
    Ok(String::from_utf8_lossy(&std::fs::read(&full).map_err(|e| e.to_string())?).to_string())
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

    fn plugin_with_assets() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        let a = d.path().join("assets");
        std::fs::create_dir_all(a.join("docs")).unwrap();
        std::fs::write(a.join("README.md"), b"# Hello\n").unwrap();
        std::fs::write(a.join("setup.ps1"), b"Write-Host hi").unwrap();
        std::fs::write(a.join("docs").join("codes.csv"), b"a,b\n1,2\n").unwrap();
        std::fs::write(a.join("logo.png"), b"\x89PNG").unwrap();
        d
    }

    #[test]
    fn extensions_decide_what_a_file_is_offered_as() {
        assert_eq!(kind_of("README.md"), "doc");
        assert_eq!(kind_of("setup.ps1"), "script");
        assert_eq!(kind_of("nested/dir/tool.py"), "script");
        assert_eq!(kind_of("logo.png"), "image");
        assert_eq!(kind_of("codes.csv"), "data");
        assert_eq!(kind_of("pack.zip"), "archive");
        assert_eq!(kind_of("mystery"), "other");
        // The one that matters: an executable is not "other" by accident.
        assert_eq!(kind_of("run.BAT"), "script", "the check is case-insensitive");
    }

    #[test]
    fn the_folder_is_walked_not_the_manifest() {
        let d = plugin_with_assets();
        let got = list_dir(&d.path().join("assets"));
        let paths: Vec<&str> = got.iter().map(|a| a.path.as_str()).collect();
        // Sorted, forward slashes, nested included.
        assert_eq!(paths, vec!["README.md", "docs/codes.csv", "logo.png", "setup.ps1"]);
        assert_eq!(got[0].kind, "doc");
        assert!(got[0].readable);
        assert_eq!(got[2].kind, "image");
        assert!(!got[2].readable, "an image is not read into the interface as text");
        assert!(got[0].size > 0);
    }

    #[test]
    fn a_plugin_with_no_assets_folder_lists_nothing_rather_than_failing() {
        // The common case. A screen that has to tell "none" from "failed" for most plugins
        // is a screen that shows an error to everybody.
        let d = tempfile::tempdir().unwrap();
        assert!(list_dir(&d.path().join("assets")).is_empty());
    }

    #[test]
    fn a_path_cannot_climb_out_of_the_assets_folder() {
        let d = plugin_with_assets();
        // Something to escape TO, so the test fails for the right reason if the guard goes.
        std::fs::write(d.path().join("plugin.json"), b"{}").unwrap();
        let dir = d.path().to_string_lossy().to_string();

        assert!(resolve(&dir, "README.md").is_ok());
        for evil in ["../plugin.json", "..\\plugin.json", "docs/../../plugin.json"] {
            let e = resolve(&dir, evil).unwrap_err();
            assert!(
                e == "plugins.assets.errOutside" || e == "plugins.assets.errMissing",
                "{} was resolved: {}",
                evil,
                e
            );
        }
    }

    #[test]
    fn a_sibling_folder_with_a_matching_prefix_is_not_inside() {
        // `assets-evil` starts with the same characters as `assets`. A prefix test on
        // strings passes it; a component-wise one on canonical paths does not.
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("assets")).unwrap();
        std::fs::create_dir_all(d.path().join("assets-evil")).unwrap();
        std::fs::write(d.path().join("assets-evil").join("x.md"), b"nope").unwrap();
        let dir = d.path().to_string_lossy().to_string();
        assert!(resolve(&dir, "../assets-evil/x.md").is_err());
    }

    #[test]
    fn exporting_never_overwrites_what_is_already_there() {
        let d = plugin_with_assets();
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
        assert!(dest.path().join("README (2).md").exists());
    }
}
