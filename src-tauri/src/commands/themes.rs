// ── BMM Theme commands ────────────────────────────────────────────────────────
// Install / list / delete / export / import .bmmtheme files.
// A .bmmtheme is a ZIP archive containing theme.json + optional assets/fonts.

use std::path::PathBuf;

fn themes_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    app_handle.path_resolver()
        .app_data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("themes")
}

/// Returns the bundled built-in themes as a JSON array string. They live as
/// individual `.json` files in the bundled resource folder `builtin-themes/`
/// (sorted by filename, e.g. `01-bmm-default.bmmtheme.json`). Add/remove a file
/// to change the set of built-in presets — they are NOT hardcoded.
#[tauri::command]
pub fn list_builtin_themes(app_handle: tauri::AppHandle) -> Result<String, String> {
    // Resolve the bundled resource dir (handles the `_up_` prefix Tauri uses for
    // resources copied from outside src-tauri).
    let dir = app_handle.path_resolver().resolve_resource("builtin-themes")
        .or_else(|| app_handle.path_resolver().resolve_resource("_up_/frontend/assets/builtin-themes"))
        .or_else(|| app_handle.path_resolver().resolve_resource("../frontend/assets/builtin-themes"));
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

    let mut out: Vec<serde_json::Value> = Vec::new();
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
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) { out.push(v); }
    }
    serde_json::to_string(&out).map_err(|e| e.to_string())
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
    let data_dir = app_handle.path_resolver()
        .app_data_dir().ok_or("no data dir")?;
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
                let out_path = dest.join(&name);
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
            use tauri::api::dialog::blocking::FileDialogBuilder;
            FileDialogBuilder::new()
                .set_title("Export Theme")
                .add_filter("BMM Theme", &["bmmtheme"])
                .set_file_name(&format!("{}.bmmtheme", theme_id))
                .save_file()
                .ok_or("No path selected")?
        }
    };

    let file = std::fs::File::create(&save_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    use std::io::Write;

    if theme_dir.exists() {
        // Installed theme → bundle its full folder (theme.json + assets + fonts).
        for entry in jwalk::WalkDir::new(&theme_dir).into_iter().flatten() {
            let p = entry.path();
            if p.is_file() {
                let rel = p.strip_prefix(&theme_dir).unwrap_or(&p);
                let rel_str = rel.to_string_lossy().replace('\\', "/");
                zip.start_file(rel_str, opts).map_err(|e| e.to_string())?;
                let data = std::fs::read(&p).map_err(|e| e.to_string())?;
                zip.write_all(&data).map_err(|e| e.to_string())?;
            }
        }
    } else if let Some(json) = theme_json {
        // Not installed (built-in preset or unsaved draft) → write the supplied
        // JSON straight into the .bmmtheme. Built-ins have no separate assets.
        zip.start_file("theme.json", opts).map_err(|e| e.to_string())?;
        zip.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    } else {
        return Err(format!("Theme '{}' not found", theme_id));
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// Fetches remote theme catalog JSON arrays and returns a merged deduplicated list.
#[tauri::command]
pub async fn fetch_theme_catalogs(
    official_url: String,
    community_urls: Vec<String>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    let urls: Vec<String> = std::iter::once(official_url).chain(community_urls).collect();
    let mut all: Vec<serde_json::Value> = Vec::new();

    for url in urls {
        if let Ok(resp) = client.get(&url).send().await {
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
