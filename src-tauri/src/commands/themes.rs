// ── BMM Theme commands ────────────────────────────────────────────────────────
// Install / list / delete / export / import .bmmtheme files.
// A .bmmtheme is a ZIP archive containing theme.json + optional assets/fonts.

use tauri::Manager;
use std::path::PathBuf;

fn themes_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    app_handle.path()
        .app_data_dir().ok()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("themes")
}

/// Returns the bundled built-in themes as a JSON array string. They live as
/// individual `.json` files in the bundled resource folder `builtin-themes/`
/// (sorted by filename, e.g. `01-bmm-default.bmmtheme.json`). Add/remove a file
/// to change the set of built-in presets — they are NOT hardcoded.
#[tauri::command]
pub fn list_builtin_themes(app_handle: tauri::AppHandle) -> Result<String, String> {
    list_builtin_themes_impl(&app_handle, false)
}

/// Like `list_builtin_themes` but includes hidden ("uninstalled") presets too,
/// each tagged with `"_hidden": true`. Used by the catalogue to offer reinstall.
#[tauri::command]
pub fn list_builtin_themes_all(app_handle: tauri::AppHandle) -> Result<String, String> {
    list_builtin_themes_impl(&app_handle, true)
}

fn list_builtin_themes_impl(app_handle: &tauri::AppHandle, include_hidden: bool) -> Result<String, String> {
    let hidden = get_hidden_builtins(app_handle.clone());
    // Resolve the bundled resource dir (handles the `_up_` prefix Tauri uses for
    // resources copied from outside src-tauri).
    let dir = app_handle.path().resolve("builtin-themes", tauri::path::BaseDirectory::Resource).ok()
        .or_else(|| app_handle.path().resolve("_up_/frontend/assets/builtin-themes", tauri::path::BaseDirectory::Resource).ok())
        .or_else(|| app_handle.path().resolve("../frontend/assets/builtin-themes", tauri::path::BaseDirectory::Resource).ok());
    let Some(dir) = dir else { return Ok("[]".into()); };

    // Accept both plain .json theme files and .bmmtheme ZIP archives.
    let mut files: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let p = e.path();
            match p.extension().and_then(|s| s.to_str()) {
                Some("json") | Some("bmmtheme") => files.push(p),
                _ => {}
            }
        }
    }
    files.sort(); // deterministic order (filename prefixed with NN-)

    // Drop-in presets: any valid theme .json in `<app data>/theme-presets/` joins the list.
    //
    // The bundled folder ships inside the installer, so adding a preset there means editing
    // the app — and on Windows it usually is not writable anyway. This gives a folder that
    // is, so a community pack is "unzip here", and the theme editor offers it like any other
    // starting point.
    //
    // Appended AFTER the bundled ones and sorted separately, so a drop-in cannot reorder the
    // built-ins someone is used to seeing first.
    let user_dir = app_handle.path().app_data_dir().ok().map(|d| d.join("theme-presets"));
    if let Some(ud) = &user_dir {
        let _ = std::fs::create_dir_all(ud); // so the folder exists to drop files into
        let mut extra: Vec<PathBuf> = Vec::new();
        if let Ok(entries) = std::fs::read_dir(ud) {
            for e in entries.flatten() {
                let p = e.path();
                match p.extension().and_then(|s| s.to_str()) {
                    Some("json") | Some("bmmtheme") => extra.push(p),
                    _ => {}
                }
            }
        }
        extra.sort();
        files.extend(extra);
    }

    let mut out: Vec<serde_json::Value> = Vec::new();
    let mut seen_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    for p in files {
        let is_zip = p.extension().and_then(|s| s.to_str()) == Some("bmmtheme");
        let raw = if is_zip {
            // .bmmtheme = ZIP containing theme.json — extract it.
            match std::fs::File::open(&p).ok()
                .and_then(|f| zip::ZipArchive::new(f).ok())
                .and_then(|mut a| a.by_name("theme.json").ok()
                    .map(|mut e| { use std::io::Read; let mut s = String::new(); let _ = e.read_to_string(&mut s); s }))
            {
                Some(s) => s,
                None => continue,
            }
        } else {
            match std::fs::read_to_string(&p) { Ok(s) => s, Err(_) => continue }
        };
        if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&raw) {
            let id = v["id"].as_str().unwrap_or("").to_string();
            // First file wins. Bundled presets are scanned first, so a drop-in reusing a
            // built-in id is ignored rather than shown twice — two entries with the same id
            // would also make "hide this preset" ambiguous, since the hidden set is keyed
            // on id.
            if !id.is_empty() && !seen_ids.insert(id.clone()) {
                continue;
            }
            let is_hidden = hidden.contains(&id);
            if is_hidden && !include_hidden { continue; } // filtered out of normal listings
            if include_hidden {
                if let Some(obj) = v.as_object_mut() {
                    obj.insert("_hidden".into(), serde_json::Value::Bool(is_hidden));
                    obj.insert("_builtin".into(), serde_json::Value::Bool(true));
                }
            }
            out.push(v);
        }
    }
    serde_json::to_string(&out).map_err(|e| e.to_string())
}

// ── Built-in "uninstall" (hide) support ───────────────────────────────────────
// Built-in presets live in bundled resources and can't be truly deleted, but the
// user can hide ("uninstall") them so they vanish from every theme selector, and
// restore ("reinstall") them later. The hidden set is a small JSON id list.

fn hidden_builtins_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("hidden_builtins.json"))
}

/// Where drop-in theme presets go. Created if missing, so the answer is always a folder
/// that exists and can be opened.
///
/// This exists because "put your themes in the presets folder" is useless advice without a
/// path: app_data_dir is a different place on every OS, and it moved once already when the
/// bundle id changed. Handing the UI the real path removes the guessing.
#[tauri::command]
pub fn theme_presets_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    let d = app_handle.path().app_data_dir().map_err(|e| e.to_string())?.join("theme-presets");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_hidden_builtins(app_handle: tauri::AppHandle) -> Vec<String> {
    hidden_builtins_path(&app_handle)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Hides (`hidden=true`) or restores (`false`) a built-in theme by id.
#[tauri::command]
pub fn set_builtin_hidden(app_handle: tauri::AppHandle, theme_id: String, hidden: bool) -> Result<(), String> {
    let mut list = get_hidden_builtins(app_handle.clone());
    if hidden { if !list.contains(&theme_id) { list.push(theme_id); } }
    else { list.retain(|x| x != &theme_id); }
    let path = hidden_builtins_path(&app_handle).ok_or("no data dir")?;
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).ok(); }
    std::fs::write(path, serde_json::to_string(&list).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

/// Returns the stored JSON for all installed themes as a JSON array string.
#[tauri::command]
pub fn list_installed_themes(app_handle: tauri::AppHandle) -> Result<String, String> {
    let dir = themes_dir(&app_handle);
    if !dir.exists() { return Ok("[]".into()); }
    let mut out: Vec<serde_json::Value> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                let manifest = p.join("theme.json");
                if let Ok(raw) = std::fs::read_to_string(&manifest) {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                        out.push(v);
                    }
                }
            }
        }
    }
    serde_json::to_string(&out).map_err(|e| e.to_string())
}

/// Returns the active theme id stored in a small sidecar file.
#[tauri::command]
pub fn get_active_theme(app_handle: tauri::AppHandle) -> Option<String> {
    let f = themes_dir(&app_handle).parent()?.join("active_theme.txt");
    std::fs::read_to_string(f).ok()
}

/// Persists the active theme id.
#[tauri::command]
pub fn set_active_theme(app_handle: tauri::AppHandle, theme_id: String) -> Result<(), String> {
    let data_dir = app_handle.path()
        .app_data_dir().ok().ok_or("no data dir")?;
    std::fs::write(data_dir.join("active_theme.txt"), &theme_id).map_err(|e| e.to_string())
}

/// Installs a theme from its JSON string (theme.json content).
/// Creates `themes/<id>/theme.json` on disk.
#[tauri::command]
pub fn install_theme(app_handle: tauri::AppHandle, theme_json: String) -> Result<(), String> {
    let v: serde_json::Value = serde_json::from_str(&theme_json).map_err(|e| e.to_string())?;
    let id = v["id"].as_str().ok_or("missing id")?.to_string();
    if id.is_empty() || id.contains("..") || id.contains('/') {
        return Err("Invalid theme id".into());
    }
    let dir = themes_dir(&app_handle).join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("theme.json"), &theme_json).map_err(|e| e.to_string())
}

/// Removes an installed theme folder.
#[tauri::command]
pub fn delete_theme(app_handle: tauri::AppHandle, theme_id: String) -> Result<(), String> {
    if theme_id.contains("..") || theme_id.contains('/') {
        return Err("Invalid theme id".into());
    }
    let dir = themes_dir(&app_handle).join(&theme_id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Imports a .bmmtheme (zip) or raw theme.json file. Returns the theme.json content.
#[tauri::command]
pub fn import_theme(app_handle: tauri::AppHandle, path: String) -> Result<String, String> {
    let src = std::path::PathBuf::from(&path);
    if !src.exists() { return Err(format!("File not found: {}", path)); }

    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

    let theme_json = if ext == "json" {
        std::fs::read_to_string(&src).map_err(|e| e.to_string())?
    } else {
        // Treat as .bmmtheme (zip). Extract theme.json from it.
        let file = std::fs::File::open(&src).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| format!("Not a valid .bmmtheme: {}", e))?;

        // Find and read theme.json
        let theme_raw = {
            let mut f = archive.by_name("theme.json").map_err(|_| "theme.json not found in archive")?;
            let mut s = String::new();
            use std::io::Read;
            f.read_to_string(&mut s).map_err(|e| e.to_string())?;
            s
        };

        // Also extract assets/fonts if present into the themes dir
        let parsed: serde_json::Value = serde_json::from_str(&theme_raw).map_err(|e| e.to_string())?;
        let id = parsed["id"].as_str().unwrap_or("imported").to_string();
        let dest = themes_dir(&app_handle).join(&id);
        std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

        let file2 = std::fs::File::open(&src).map_err(|e| e.to_string())?;
        let mut arc2 = zip::ZipArchive::new(file2).map_err(|e| e.to_string())?;
        for i in 0..arc2.len() {
            let mut entry = arc2.by_index(i).map_err(|e| e.to_string())?;
            let name = entry.name().to_string();
            if name == "theme.json" || name.starts_with("assets/") || name.starts_with("fonts/") {
                // CWE-22 Zip Slip: enclosed_name() rejects entries that escape the
                // archive root (e.g. "assets/../../evil"); skip those.
                let safe = match entry.enclosed_name() { Some(p) => p.to_path_buf(), None => continue };
                let out_path = dest.join(&safe);
                if let Some(parent) = out_path.parent() { std::fs::create_dir_all(parent).ok(); }
                if !entry.is_dir() {
                    let mut out = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
                    std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
                }
            }
        }
        theme_raw
    };

    // Auto-install
    let v: serde_json::Value = serde_json::from_str(&theme_json).map_err(|e| e.to_string())?;
    let id = v["id"].as_str().ok_or("missing id")?.to_string();
    let dir = themes_dir(&app_handle).join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("theme.json"), &theme_json).map_err(|e| e.to_string())?;

    Ok(theme_json)
}

/// Exports a theme as a .bmmtheme zip (with theme.json + assets + fonts).
/// Opens a save dialog if dest_path is None.
#[tauri::command]
pub async fn export_theme(
    app_handle: tauri::AppHandle,
    theme_id: String,
    dest_path: Option<String>,
    theme_json: Option<String>,
) -> Result<(), String> {
    let theme_dir = themes_dir(&app_handle).join(&theme_id);

    let save_path = match dest_path {
        Some(p) => std::path::PathBuf::from(p),
        None => {
            use tauri_plugin_dialog::DialogExt;
            app_handle.dialog().file()
                .set_title("Export Theme")
                .add_filter("BMM Theme", &["bmmtheme"])
                .set_file_name(format!("{}.bmmtheme", theme_id))
                .blocking_save_file()
                .and_then(|fp| fp.into_path().ok())
                .ok_or("No path selected")?
        }
    };

    // Collected FIRST, then written. The signature covers every entry, so the list has to
    // exist before the archive does — and building it from the same Vec the writer uses is
    // what makes "what was signed" and "what was written" the same thing by construction.
    let mut entries: Vec<(String, Vec<u8>)> = Vec::new();
    if theme_dir.exists() {
        // Installed theme -> bundle its full folder (theme.json + assets + fonts).
        for entry in jwalk::WalkDir::new(&theme_dir).into_iter().flatten() {
            let p = entry.path();
            if p.is_file() {
                let rel = p.strip_prefix(&theme_dir).unwrap_or(&p);
                let rel_str = rel.to_string_lossy().replace(char::from(92), "/");
                let data = std::fs::read(&p).map_err(|e| e.to_string())?;
                entries.push((rel_str, data));
            }
        }
    } else if let Some(json) = theme_json {
        // Not installed (built-in preset or unsaved draft) -> the supplied JSON is the theme.
        entries.push(("theme.json".to_string(), json.into_bytes()));
    } else {
        return Err(format!("Theme '{}' not found", theme_id));
    }

    let manifest = crate::commands::doc_sign::archive_manifest(&app_handle, "bmmtheme", &entries);
    entries.push((
        crate::commands::doc_sign::ARCHIVE_ENTRY.to_string(),
        serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    ));

    let file = std::fs::File::create(&save_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    use std::io::Write;
    for (name, data) in &entries {
        zip.start_file(name.clone(), opts).map_err(|e| e.to_string())?;
        zip.write_all(data).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// Fetches remote theme catalog JSON arrays and returns a merged deduplicated list.
#[tauri::command]
pub async fn fetch_theme_catalogs(
    app: tauri::AppHandle,
    official_url: String,
    community_urls: Vec<String>,
) -> Result<String, String> {
    let urls: Vec<String> = std::iter::once(official_url).chain(community_urls).collect();
    let mut all: Vec<serde_json::Value> = Vec::new();

    for url in urls {
        // Identity header on first-party URLs → private theme catalogs resolve here (the
        // front-end's own fetch of the same URL just gets an empty 403 and is ignored).
        if let Ok(resp) = crate::commands::net::catalog_get(&app, &url).timeout(std::time::Duration::from_secs(8)).send().await {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                let list = if json.is_array() {
                    json.as_array().cloned().unwrap_or_default()
                } else {
                    json.get("themes").and_then(|v| v.as_array()).cloned().unwrap_or_default()
                };
                all.extend(list);
            }
        }
    }

    // Deduplicate by id
    let mut seen = std::collections::HashSet::new();
    let deduped: Vec<_> = all.into_iter()
        .filter(|v| v["id"].as_str().map(|id| seen.insert(id.to_string())).unwrap_or(false))
        .collect();

    serde_json::to_string(&deduped).map_err(|e| e.to_string())
}
