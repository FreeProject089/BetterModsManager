//! Reading a plugin's `assets/` folder, with no Tauri in it.
//!
//! Split from `plugin_assets.rs` so the standalone CLI and the MCP server can mount the SAME
//! code. They are built as a cargo example that does not link Tauri, so without this split
//! they would need a second implementation of the path guard and of what counts as a script
//! — and two path guards is one path guard, plus a bug waiting for whichever copy somebody
//! forgets.
//!
//! Everything here is pure: it takes a folder and a name and touches the filesystem. What
//! lives on the other side is the part that needs BMM's state to answer "where is this
//! plugin installed".

use serde::{Deserialize, Serialize};

/// One shipped file.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginAsset {
    /// Path relative to `assets/`, always with forward slashes.
    pub path: String,
    /// `doc` · `script` · `image` · `data` · `archive` · `other`.
    ///
    /// From the extension, and it decides what gets offered. `script` is the one that
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
/// separate "a document I can show you" from "a program" from "everything else", because
/// those three get offered different buttons.
pub fn kind_of(name: &str) -> &'static str {
    let ext = std::path::Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "md" | "markdown" | "txt" | "rst" | "adoc" => "doc",
        "ps1" | "bat" | "cmd" | "sh" | "py" | "js" | "mjs" | "rb" | "pl" | "lua" | "vbs" => "script",
        // `.bmp` is a bitmap AND BMM's own modpack extension. It reads as an image, which is
        // the safer half of the ambiguity: a bitmap previews, and a modpack shown as an image
        // simply fails to render. The compiler found the duplicate — the archive arm below had
        // a second `bmp` that nothing could ever reach.
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "ico" => "image",
        "json" | "csv" | "tsv" | "yaml" | "yml" | "ini" | "toml" | "cfg" | "conf" | "xml" => "data",
        "zip" | "7z" | "rar" | "gz" | "tar" | "bmmpa" | "bmmtheme" | "mm" => "archive",
        _ => "other",
    }
}

/// One path component, narrowed so it cannot be a path.
///
/// For the ADD side: a name from a file dialog can carry anything, and it is joined onto a
/// path. Narrowed to the same set a file name gets, and a component that is nothing but
/// traversal becomes a plain name rather than an empty one that joins to the folder itself.
pub fn safe_component(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || "._-".contains(c) { c } else { '_' })
        .collect();
    let trimmed = cleaned.trim_matches(|c| c == '.' || c == '_').to_string();
    if trimmed.is_empty() { "file".to_string() } else { trimmed }
}

/// Can this be shown as text, or read into a variable?
pub fn readable(kind: &str) -> bool {
    matches!(kind, "doc" | "data" | "script")
}

/// The most a text asset may be, read into memory.
///
/// A README is kilobytes. This is not a limit anybody legitimate meets — it is there so a
/// 900 MB file named `notes.txt` cannot be read into the interface by clicking on it.
pub const MAX_TEXT: u64 = 2 * 1024 * 1024;

/// Everything under a plugin's `assets/` folder.
///
/// **The disk is the truth, not the manifest.** A manifest declares what its author says is
/// there; this walks the folder. A plugin whose manifest lists a README that is not present
/// shows nothing rather than an entry that fails to open, and one carrying a file its
/// manifest never mentioned still shows it — which is the case that matters, because a
/// surprise file is the one somebody should see.
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

/// Resolve one asset path, and refuse anything that leaves the folder.
///
/// `install_dir` comes from BMM's own state; `rel` comes from a manifest, a screen, an
/// automation or an HTTP caller, so it is untrusted. Canonicalised and checked to be INSIDE
/// the assets folder, which is what `..` and an absolute path both fail. `starts_with` on
/// canonical paths is a component-prefix match, so `assets-evil/` cannot pass as `assets/`.
pub fn resolve(install_dir: &str, rel: &str) -> Result<std::path::PathBuf, String> {
    resolve_under(&std::path::PathBuf::from(install_dir).join("assets"), rel)
}

/// The same guard, rooted at the whole plugin folder rather than at `assets/`.
///
/// The contents screen lists everything a plugin ships — the manifest, the scripts, the
/// bundle folders — and could copy out only the files under `assets/`, because the only
/// resolver was rooted there. So a screen whose whole purpose is "what is IN this plugin"
/// answered "you may have this one" for a minority of what it showed.
///
/// Deliberately the SAME function underneath, with the root as a parameter. A second
/// canonicalise-and-compare written next to the first is the one that ends up missing the
/// `starts_with` check, and it is the check that stops `..` walking out of the folder.
pub fn resolve_in(install_dir: &str, rel: &str) -> Result<std::path::PathBuf, String> {
    resolve_under(std::path::Path::new(install_dir), rel)
}

fn resolve_under(root: &std::path::Path, rel: &str) -> Result<std::path::PathBuf, String> {
    let root = root.to_path_buf();
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

/// Read one text asset, through the guard and the size cap.
pub fn read_text(install_dir: &str, rel: &str) -> Result<String, String> {
    let full = resolve(install_dir, rel)?;
    if !readable(kind_of(rel)) {
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
    fn a_component_cannot_become_a_path() {
        // This one is joined onto a directory on the ADD side, so it is the guard that
        // decides whether a file dialog can write outside the plugin.
        assert_eq!(safe_component("README.md"), "README.md");
        assert_eq!(safe_component(".."), "file");
        assert_eq!(safe_component("."), "file");
        assert_eq!(safe_component(""), "file");
        assert_eq!(safe_component("a/b"), "a_b");
        assert_eq!(safe_component("a\\b"), "a_b");
        assert_eq!(safe_component("C:file"), "C_file");
        // And the same narrowing a shipped file name gets, so a component added here cannot
        // be renamed by a host that serves it later.
        assert_eq!(safe_component("café notes.txt"), "caf__notes.txt");
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
    fn only_text_kinds_can_be_read() {
        let d = plugin_with_assets();
        let dir = d.path().to_string_lossy().to_string();
        assert_eq!(read_text(&dir, "README.md").unwrap(), "# Hello\n");
        assert_eq!(read_text(&dir, "docs/codes.csv").unwrap(), "a,b\n1,2\n");
        // A script IS readable — showing what is about to run is the point.
        assert!(read_text(&dir, "setup.ps1").is_ok());
        assert_eq!(read_text(&dir, "logo.png").unwrap_err(), "plugins.assets.errNotText");
    }

    #[test]
    fn a_bad_byte_does_not_cost_the_whole_file() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("assets")).unwrap();
        std::fs::write(d.path().join("assets").join("cfg.ini"), b"a=1\n\xff\xfe\nb=2").unwrap();
        let out = read_text(&d.path().to_string_lossy(), "cfg.ini").unwrap();
        assert!(out.contains("a=1") && out.contains("b=2"));
    }
}
