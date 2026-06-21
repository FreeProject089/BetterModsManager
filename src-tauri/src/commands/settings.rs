use crate::state::AppState;
use crate::fs_utils::{resolve_path, get_lang_dir};
use tauri::State;
use crate::error::AppError;
use tracing::{info, warn};

#[derive(serde::Deserialize)]
pub struct ExportOptions {
    pub profiles: bool,
    pub mods: bool,
    pub settings: bool,
    pub custom_tags: bool,
    pub disk_limits: bool,
    // Extended sections (all optional → default false for old callers)
    #[serde(default)] pub plugins: bool,
    #[serde(default)] pub modpacks: bool,
    #[serde(default)] pub launch_packs: bool,
    #[serde(default)] pub themes: bool,
    #[serde(default)] pub translations: bool,
    #[serde(default)] pub apps: bool,
}

/// Factory reset — wipe BMM back to a fresh install. The current data.json is
/// preserved as `data.before-reset-<ts>.json` (and the rolling .bak), so this is
/// recoverable. The caller should prompt the user to restart afterwards.
#[tauri::command]
pub fn factory_reset(state: State<AppState>, app: tauri::AppHandle) -> Result<(), String> {
    let dir = app.path_resolver().app_data_dir().unwrap_or_default();
    let data_path = dir.join("data.json");
    if data_path.exists() {
        let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = std::fs::copy(&data_path, dir.join(format!("data.before-reset-{}.json", ts)));
    }
    // Reset the live state to factory defaults and persist atomically.
    {
        let mut d = state.data.lock().map_err(|e| e.to_string())?;
        *d = crate::state::AppData::default();
    }
    state.save().map_err(|e| e.to_string())?;
    // Best-effort removal of sidecar config files (harmless if absent).
    for f in ["bans.json", "whitelist.json", "analytics_sent.json", "analytics_queue.json", "active_theme.txt", "discord_rpc.json"] {
        let _ = std::fs::remove_file(dir.join(f));
    }
    crate::commands::crash::log_line("[RESET] Factory reset performed — previous data backed up (data.before-reset-*.json).".to_string());
    Ok(())
}

// ── Helpers for the file-based data dirs ──────────────────────────────────────
fn data_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path_resolver().app_data_dir().unwrap_or_default()
}
/// Read every *.json in a dir into a { filename: parsed-json } map.
fn read_json_dir(dir: &std::path::Path) -> serde_json::Map<String, serde_json::Value> {
    let mut out = serde_json::Map::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) == Some("json") {
                if let (Some(name), Ok(txt)) = (p.file_name().and_then(|s| s.to_str()), std::fs::read_to_string(&p)) {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
                        out.insert(name.to_string(), v);
                    }
                }
            }
        }
    }
    out
}
fn write_json_dir(dir: &std::path::Path, files: &serde_json::Map<String, serde_json::Value>) {
    let _ = std::fs::create_dir_all(dir);
    for (name, val) in files {
        // Guard against path traversal in the embedded filename.
        if name.contains('/') || name.contains('\\') || name.contains("..") { continue; }
        if let Ok(txt) = serde_json::to_string_pretty(val) {
            let _ = std::fs::write(dir.join(name), txt);
        }
    }
}

#[tauri::command]
pub fn export_app_data(state: State<AppState>, app_handle: tauri::AppHandle, dest_path: String, options: Option<ExportOptions>, extras: Option<serde_json::Value>) -> Result<(), AppError> {
    let _ = state.save(); // Save current memory to disk first

    let Some(opts) = options else {
        // No options → raw copy of data.json (legacy behaviour)
        std::fs::copy(&*state.data_path, dest_path)?;
        return Ok(());
    };

    let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    let mut export_data = crate::state::AppData::default();
    if opts.profiles { export_data.profiles = data.profiles.clone(); export_data.active_profile_id = data.active_profile_id.clone(); }
    if opts.mods { export_data.mods = data.mods.clone(); }
    if opts.settings { export_data.settings = data.settings.clone(); }
    if opts.custom_tags { export_data.custom_tags = data.custom_tags.clone(); }
    if opts.disk_limits { export_data.disk_limits = data.disk_limits.clone(); }
    if opts.plugins { export_data.installed_plugins = data.installed_plugins.clone(); export_data.plugin_permissions = data.plugin_permissions.clone(); }
    if opts.modpacks { export_data.modpacks = data.modpacks.clone(); }
    if opts.launch_packs { export_data.launch_packs = data.launch_packs.clone(); }
    drop(data);

    // Versioned wrapper so we can carry file-based data + frontend extras alongside AppData.
    let mut root = serde_json::Map::new();
    root.insert("_bmm_backup".into(), serde_json::json!(2));
    root.insert("app_data".into(), serde_json::to_value(&export_data)?);

    let dir = data_dir(&app_handle);
    if opts.themes {
        let themes = read_json_dir(&dir.join("themes"));
        if !themes.is_empty() { root.insert("themes".into(), serde_json::Value::Object(themes)); }
    }
    if opts.translations {
        let langs = read_json_dir(&get_lang_dir(&app_handle));
        if !langs.is_empty() { root.insert("translations".into(), serde_json::Value::Object(langs)); }
    }
    if opts.apps {
        let mut apps = serde_json::Map::new();
        if let Ok(t) = std::fs::read_to_string(dir.join("apps_state.json")) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) { apps.insert("apps_state.json".into(), v); }
        }
        if let Ok(t) = std::fs::read_to_string(dir.join("apps-catalog.json")) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) { apps.insert("apps-catalog.json".into(), v); }
        }
        if !apps.is_empty() { root.insert("apps".into(), serde_json::Value::Object(apps)); }
    }
    // Frontend-only data (e.g. server-repo favourites from localStorage)
    if let Some(ex) = extras { if !ex.is_null() { root.insert("extras".into(), ex); } }

    std::fs::write(&dest_path, serde_json::to_string_pretty(&serde_json::Value::Object(root))?)?;
    Ok(())
}

/// Automated data export — picks the destination path itself from a target folder,
/// a filename template ({date} {time} {datetime}) and an increment policy if the
/// file already exists. Used by the scheduler / API so a backup can run unattended
/// (no save dialog). Returns the path it wrote to.
#[tauri::command]
pub fn export_app_data_auto(
    state: State<AppState>, app_handle: tauri::AppHandle,
    dir: String, name: Option<String>, increment: Option<String>,
) -> Result<String, String> {
    let folder = std::path::Path::new(&dir);
    if !folder.is_dir() {
        return Err(format!("Not a folder: {}", dir));
    }
    let now = chrono::Local::now();
    let tmpl = name.unwrap_or_default();
    let tmpl = if tmpl.trim().is_empty() { "bmm-backup-{date}".to_string() } else { tmpl };
    let raw = tmpl
        .replace("{datetime}", &now.format("%Y-%m-%d_%H%M%S").to_string())
        .replace("{date}", &now.format("%Y-%m-%d").to_string())
        .replace("{time}", &now.format("%H%M%S").to_string());
    // Strip a trailing .json and any illegal filename characters.
    let base: String = raw.trim_end_matches(".json")
        .chars().map(|c| if "<>:\"/\\|?*".contains(c) { '_' } else { c }).collect();
    let base = base.trim().to_string();

    let policy = increment.unwrap_or_else(|| "paren".into());
    let mut candidate = folder.join(format!("{base}.json"));
    if candidate.exists() {
        match policy.as_str() {
            "overwrite" => {}
            "timestamp" => { candidate = folder.join(format!("{base}_{}.json", now.timestamp())); }
            "underscore" => {
                let mut i = 1;
                while folder.join(format!("{base}_{i}.json")).exists() && i < 9999 { i += 1; }
                candidate = folder.join(format!("{base}_{i}.json"));
            }
            _ => { // "paren" (default): name (1).json, name (2).json …
                let mut i = 1;
                while folder.join(format!("{base} ({i}).json")).exists() && i < 9999 { i += 1; }
                candidate = folder.join(format!("{base} ({i}).json"));
            }
        }
    }
    let dest = candidate.to_string_lossy().to_string();
    export_app_data(state, app_handle, dest.clone(), None, None).map_err(|e| e.to_string())?;
    Ok(dest)
}

/// Import a backup. Returns the `extras` object (frontend localStorage data) so the
/// caller can restore it before reloading. Supports both the v2 wrapper format and
/// the legacy flat AppData file.
#[tauri::command]
pub fn import_app_data(state: State<AppState>, app_handle: tauri::AppHandle, src_path: String) -> Result<Option<serde_json::Value>, AppError> {
    let raw = std::fs::read_to_string(&src_path)?;
    let parsed: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| AppError::Internal(format!("Invalid backup file: {}", e)))?;

    // v2 wrapper vs legacy flat AppData
    let (app_data_val, extras) = if parsed.get("_bmm_backup").is_some() {
        let dir = data_dir(&app_handle);
        if let Some(serde_json::Value::Object(themes)) = parsed.get("themes") {
            write_json_dir(&dir.join("themes"), themes);
        }
        if let Some(serde_json::Value::Object(langs)) = parsed.get("translations") {
            write_json_dir(&get_lang_dir(&app_handle), langs);
        }
        if let Some(serde_json::Value::Object(apps)) = parsed.get("apps") {
            for (name, val) in apps {
                if name == "apps_state.json" || name == "apps-catalog.json" {
                    if let Ok(txt) = serde_json::to_string_pretty(val) { let _ = std::fs::write(dir.join(name), txt); }
                }
            }
        }
        (parsed.get("app_data").cloned().unwrap_or(serde_json::Value::Null), parsed.get("extras").cloned())
    } else {
        (parsed, None)
    };

    if let Ok(new_data) = serde_json::from_value::<crate::state::AppData>(app_data_val) {
        let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        *data = new_data;
        drop(data);
        state.save()?;
    }
    Ok(extras)
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<crate::state::AppSettings, AppError> {
    let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    Ok(data.settings.clone())
}

#[tauri::command]
pub fn update_settings(state: State<AppState>, settings: crate::state::AppSettings) -> Result<(), AppError> {
    {
        let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        data.settings = settings;
    }
    state.save()?;
    Ok(())
}

#[tauri::command]
pub fn apply_fs_security_mode_command(app: tauri::AppHandle) {
    crate::apply_fs_security_mode(app);
}

#[tauri::command]
pub fn reset_app_data(state: State<AppState>) -> Result<(), AppError> {
    {
        let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        *data = crate::state::AppData::default();
    }
    let _ = state.save();
    Ok(())
}


/// True only for a debug build (`tauri dev` / `cargo run`), false for release
/// (`tauri build`). Used to allow the WebView2 right-click "Inspect" + F12 in dev
/// while blocking them in production — independent of the app.cfg `prod` flag.
#[tauri::command]
pub fn is_dev_build() -> bool {
    cfg!(debug_assertions)
}

#[tauri::command]
pub fn is_debug_mode(app_handle: tauri::AppHandle) -> bool {
    if let Some(path) = resolve_path(&app_handle, "app.cfg") {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let normalized = content.to_lowercase();
            let is_debug = normalized.contains("prod=false");
            info!("[DEBUG_SYSTEM] Resolution: {:?}, is_debug: {}", path, is_debug);
            return is_debug;
        }
    }
    
    warn!("[DEBUG_SYSTEM] app.cfg could not be resolved.");
    false
}
#[tauri::command]
pub fn is_fsdm_mode(app_handle: tauri::AppHandle) -> bool {
    if let Some(path) = resolve_path(&app_handle, "app.cfg") {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let normalized = content.to_lowercase();
            return normalized.contains("fsdm=true");
        }
    }
    false
}

#[tauri::command]
pub fn get_app_version(app_handle: tauri::AppHandle) -> String {
    app_handle.package_info().version.to_string()
}

#[tauri::command]
pub fn get_build_date() -> String {
    env!("BMM_BUILD_DATE").to_string()
}

#[tauri::command]
pub fn get_license_text(app_handle: tauri::AppHandle) -> Result<String, String> {
    if let Some(path) = resolve_path(&app_handle, "LICENSE.md") {
        return std::fs::read_to_string(path).map_err(|e| e.to_string());
    }
    
    Err("LICENSE.md not found".to_string())
}

#[tauri::command]
pub fn get_eula_text(app_handle: tauri::AppHandle, lang: String) -> Result<String, String> {
    // Terms of Service (formerly EULA). Try TOS_{LANG}.md, then default TOS.md.
    // Legacy EULA*.md names are kept as a fallback for older installs.
    let candidates = [
        format!("TOS_{}.md", lang.to_uppercase()),
        "TOS.md".to_string(),
        format!("EULA_{}.md", lang.to_uppercase()),
        "EULA.md".to_string(),
    ];
    for name in &candidates {
        if let Some(path) = resolve_path(&app_handle, name) {
            if let Ok(text) = std::fs::read_to_string(&path) {
                return Ok(text);
            }
        }
    }
    Err("TOS.md not found".to_string())
}

#[tauri::command]
pub fn get_privacy_text(app_handle: tauri::AppHandle, lang: String) -> Result<String, String> {
    // Try PRIVACY_{LANG}.md, then default PRIVACY.md
    let specific = format!("PRIVACY_{}.md", lang.to_uppercase());
    if let Some(path) = resolve_path(&app_handle, &specific) {
        if let Ok(text) = std::fs::read_to_string(&path) {
            return Ok(text);
        }
    }
    if let Some(path) = resolve_path(&app_handle, "PRIVACY.md") {
        return std::fs::read_to_string(path).map_err(|e| e.to_string());
    }
    Err("PRIVACY.md not found".to_string())
}


#[tauri::command]
pub fn is_ptb_mode(app_handle: tauri::AppHandle) -> bool {
    if let Some(path) = resolve_path(&app_handle, "app.cfg") {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let normalized = content.to_lowercase();
            return normalized.contains("ptb=true");
        }
    }
    false
}

#[tauri::command]
pub fn is_update_disabled(app_handle: tauri::AppHandle) -> bool {
    if let Some(path) = resolve_path(&app_handle, "app.cfg") {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let normalized = content.to_lowercase();
            return normalized.contains("disableupdate=true");
        }
    }
    false
}

#[tauri::command]
pub fn is_auto_eula_enabled(app_handle: tauri::AppHandle) -> bool {
    if let Some(path) = resolve_path(&app_handle, "app.cfg") {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let normalized = content.to_lowercase();
            return normalized.contains("autoeula_on_first_start=true");
        }
    }
    false
}


#[derive(serde::Serialize)]
pub struct QuickLinksConfig {
    pub card1_disabled: bool,
    pub card2_disabled: bool,
}

#[tauri::command]
pub fn get_quicklinks_config(app_handle: tauri::AppHandle) -> QuickLinksConfig {
    let mut cfg = QuickLinksConfig { card1_disabled: false, card2_disabled: false };
    if let Some(path) = resolve_path(&app_handle, "app.cfg") {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let normalized = content.to_lowercase();
            cfg.card1_disabled = normalized.contains("quicklink1_disabled=true");
            cfg.card2_disabled = normalized.contains("quicklink2_disabled=true");
        }
    }
    cfg
}

#[tauri::command]
pub fn get_available_languages(app_handle: tauri::AppHandle) -> Vec<String> {
    let lang_dir = get_lang_dir(&app_handle);
    let mut languages = Vec::new();
    
    if let Ok(entries) = std::fs::read_dir(lang_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Some(name) = p.file_stem().and_then(|n| n.to_str()) {
                    if name != "template" {
                        languages.push(name.to_string());
                    }
                }
            }
        }
    }
    
    if languages.is_empty() {
        languages.push("fr".to_string());
        languages.push("en".to_string());
    }
    
    languages
}

#[tauri::command]
pub fn get_language_content(app_handle: tauri::AppHandle, lang: String) -> Result<String, String> {
    let lang_dir = get_lang_dir(&app_handle);
    let file_path = lang_dir.join(format!("{}.json", lang));

    if !file_path.exists() {
        return Err(format!("Language file not found: {}.json", lang));
    }

    std::fs::read_to_string(file_path).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct I18nUsage {
    pub file: String,
    pub line: u32,
    pub snippet: String,
}

/// Searches the shipped frontend source (compiled JS + index.html) for occurrences
/// of an i18n key, so the Translation Sandbox can show WHERE a key is used.
#[tauri::command]
pub fn find_i18n_usages(app_handle: tauri::AppHandle, key: String) -> Result<Vec<I18nUsage>, String> {
    if key.trim().is_empty() { return Ok(vec![]); }
    // frontend dir = parent of Lang/
    let lang_dir = get_lang_dir(&app_handle);
    let frontend_dir = lang_dir.parent().map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    let mut results: Vec<I18nUsage> = Vec::new();
    let key_q1 = format!("'{}'", key);          // t('key')
    let key_q2 = format!("\"{}\"", key);        // t("key") / data-i18n="key"
    let key_bare = key.clone();

    // Walk frontend dir, scan .js and .html files (skip Lang/, node_modules, maps)
    for entry in jwalk::WalkDir::new(&frontend_dir).into_iter().flatten() {
        let path = entry.path();
        if !path.is_file() { continue; }
        let p_str = path.to_string_lossy().replace('\\', "/");
        // Skip the compiled /js/ mirror (duplicates every src/*.ts hit), Lang/,
        // node_modules, assets and source maps — so "Used in" is fast and shows
        // each usage once (the real .ts source), not twice.
        if p_str.contains("/Lang/") || p_str.contains("/node_modules/")
            || p_str.contains("/js/") || p_str.contains("/assets/")
            || p_str.ends_with(".map") { continue; }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        // Source-first: .ts + .html. Only fall back to .js when no src/ exists
        // (e.g. a production build that bundled js but not ts).
        let has_src = frontend_dir.join("src").is_dir();
        if has_src { if ext != "ts" && ext != "html" { continue; } }
        else if ext != "js" && ext != "html" { continue; }
        // Prefer .ts source over compiled .js when both exist? Keep both but de-dup later by content.
        let content = match std::fs::read_to_string(&path) { Ok(c) => c, Err(_) => continue };
        if !content.contains(&key_q1) && !content.contains(&key_q2) { continue; }
        let rel = path.strip_prefix(&frontend_dir).unwrap_or(&path).to_string_lossy().replace('\\', "/");
        for (i, line) in content.lines().enumerate() {
            if line.contains(&key_q1) || line.contains(&key_q2) {
                // require the key appears as a near-standalone token to avoid prefix collisions
                let trimmed = line.trim();
                let snippet = if trimmed.len() > 160 { format!("{}…", &trimmed[..160]) } else { trimmed.to_string() };
                results.push(I18nUsage { file: rel.clone(), line: (i as u32) + 1, snippet });
                if results.len() >= 200 { return Ok(results); }
            }
        }
    }
    let _ = key_bare;
    Ok(results)
}

#[derive(serde::Serialize)]
pub struct HardcodedString {
    pub file: String,
    pub line: u32,
    pub text: String,
    pub snippet: String,
    pub kind: String, // "html" | "toast" | "js"
}

/// Heuristically scans the shipped frontend source for human-readable text that
/// is NOT going through i18n (no data-i18n / no t(...)). Lets the sandbox surface
/// hardcoded strings with their exact file + line so a key can be added easily.
#[tauri::command]
pub fn find_hardcoded_strings(app_handle: tauri::AppHandle, filter: Option<String>) -> Result<Vec<HardcodedString>, String> {
    let lang_dir = get_lang_dir(&app_handle);
    let frontend_dir = lang_dir.parent().map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let needle = filter.unwrap_or_default().to_lowercase();

    // True if a string looks like human-facing copy (has letters + a space or is a real word),
    // not a css value, path, identifier, svg data, etc.
    fn looks_human(s: &str) -> bool {
        let s = s.trim();
        if s.len() < 2 || s.len() > 200 { return false; }
        // must contain at least 2 letters
        let letters = s.chars().filter(|c| c.is_alphabetic()).count();
        if letters < 2 { return false; }
        // reject obvious non-copy
        let low = s.to_lowercase();
        if s.starts_with('#') || s.starts_with('.') || s.starts_with('/') || s.starts_with('@') { return false; }
        if low.contains("px") && s.chars().any(|c| c.is_ascii_digit()) && !s.contains(' ') { return false; }
        if s.contains("://") || s.contains("data-i18n") { return false; }
        if low.starts_with("var(") || low.starts_with("rgba") || low.starts_with("0x") { return false; }
        // mostly symbols / svg path like "M12 3l4 4"
        let symbolic = s.chars().filter(|c| !c.is_alphanumeric() && !c.is_whitespace()).count();
        if symbolic * 2 > s.len() { return false; }
        // single camelCase/snake token w/o spaces → likely an identifier
        if !s.contains(' ') && (s.contains('_') || s.contains('-')) && !s.ends_with(['.', '!', '?']) { return false; }
        true
    }

    let mut out: Vec<HardcodedString> = Vec::new();
    for entry in jwalk::WalkDir::new(&frontend_dir).into_iter().flatten() {
        let path = entry.path();
        if !path.is_file() { continue; }
        let p_str = path.to_string_lossy().replace('\\', "/");
        if p_str.contains("/Lang/") || p_str.contains("/node_modules/") || p_str.ends_with(".map") { continue; }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        // Scan index.html + scripts. Prefer .ts source (dev); fall back to .js so this
        // ALSO works in production where only compiled .js ships. To avoid duplicates in
        // dev, skip a .js when a sibling .ts exists.
        if ext != "html" && ext != "ts" && ext != "js" { continue; }
        if ext == "js" && path.with_extension("ts").exists() { continue; }
        let is_html = ext == "html";
        let content = match std::fs::read_to_string(&path) { Ok(c) => c, Err(_) => continue };
        let rel = path.strip_prefix(&frontend_dir).unwrap_or(&path).to_string_lossy().replace('\\', "/");

        for (i, raw_line) in content.lines().enumerate() {
            let line = raw_line.trim();
            if line.is_empty() || line.starts_with("//") || line.starts_with('*') { continue; }
            let line_no = (i as u32) + 1;
            let trimmed_snip = if line.chars().count() > 160 {
                format!("{}…", line.chars().take(160).collect::<String>())
            } else { line.to_string() };

            if is_html {
                // Text between > and < on this line, when no data-i18n present on the line.
                if line.contains("data-i18n") { continue; }
                if line.contains("<svg") || line.contains("<path") || line.contains("<script") || line.contains("<style") { continue; }
                let bytes = line.as_bytes();
                let mut idx = 0;
                while let Some(gt) = line[idx..].find('>') {
                    let start = idx + gt + 1;
                    if start >= bytes.len() { break; }
                    if let Some(lt) = line[start..].find('<') {
                        let text = &line[start..start + lt];
                        if looks_human(text) && (needle.is_empty() || text.to_lowercase().contains(&needle)) {
                            out.push(HardcodedString {
                                file: rel.clone(), line: line_no,
                                text: text.trim().to_string(), snippet: trimmed_snip.clone(),
                                kind: "html".into(),
                            });
                        }
                        idx = start + lt + 1;
                    } else { break; }
                }
            } else {
                // .ts / .js — two passes:
                //  (a) HTML text inside innerHTML/template literals: >Some Text<
                //  (b) string literals passed to toast(...) / textContent / placeholder
                let uses_i18n = line.contains("t('") || line.contains("t(\"") || line.contains("${t(")
                    || line.contains("data-i18n");

                // (a) tag text like `<span>Real Text</span>` inside backtick HTML templates.
                if !uses_i18n && !line.contains("<svg") && !line.contains("<path")
                    && line.contains('>') && line.contains('<') {
                    let bytes = line.as_bytes();
                    let mut idx = 0;
                    while let Some(gt) = line[idx..].find('>') {
                        let start = idx + gt + 1;
                        if start >= bytes.len() { break; }
                        if let Some(lt) = line[start..].find('<') {
                            let text = &line[start..start + lt];
                            // skip template interpolations like `>${foo}<`
                            if !text.contains("${") && looks_human(text)
                                && (needle.is_empty() || text.to_lowercase().contains(&needle)) {
                                out.push(HardcodedString {
                                    file: rel.clone(), line: line_no,
                                    text: text.trim().to_string(), snippet: trimmed_snip.clone(),
                                    kind: "ts".into(),
                                });
                            }
                            idx = start + lt + 1;
                        } else { break; }
                    }
                }

                // (b) literals inside toast(...) / textContent / placeholder, not via t(...)
                let is_toast = line.contains("toast(");
                let is_text = line.contains(".textContent") || line.contains(".placeholder")
                    || line.contains(".title =") || line.contains(".innerText");
                if (is_toast || is_text) && !uses_i18n {
                    for quote in ['\'', '"'] {
                        let mut search = line;
                        while let Some(a) = search.find(quote) {
                            let rest = &search[a + 1..];
                            if let Some(b) = rest.find(quote) {
                                let lit = &rest[..b];
                                if looks_human(lit) && (needle.is_empty() || lit.to_lowercase().contains(&needle)) {
                                    out.push(HardcodedString {
                                        file: rel.clone(), line: line_no,
                                        text: lit.trim().to_string(), snippet: trimmed_snip.clone(),
                                        kind: if is_toast { "toast".into() } else { "js".into() },
                                    });
                                }
                                search = &rest[b + 1..];
                            } else { break; }
                        }
                    }
                }
            }
            if out.len() >= 800 { return Ok(out); }
        }
    }
    Ok(out)
}

/// Scans the frontend source once and classifies i18n keys by how they are used:
/// "toast" (shown via toast(t('key'))) or "tooltip" (shown via showTaskyHelp('key')).
/// Returns key -> list of kinds. Lets the sandbox filter Toast / Tooltip keys.
#[tauri::command]
pub fn get_i18n_key_kinds(app_handle: tauri::AppHandle) -> Result<std::collections::HashMap<String, Vec<String>>, String> {
    let lang_dir = get_lang_dir(&app_handle);
    let frontend_dir = lang_dir.parent().map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    // Extract every t('key') / t("key") referenced in a string.
    fn t_keys(s: &str) -> Vec<String> {
        let mut keys = Vec::new();
        let bytes = s.as_bytes();
        let mut i = 0;
        while i + 1 < bytes.len() {
            if bytes[i] == b't' && bytes[i + 1] == b'(' {
                // char before 't' must not be an identifier char (so we match t( not foot()
                let ok_prefix = i == 0 || !(bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'_' || bytes[i - 1] == b'.');
                if ok_prefix {
                    let rest = &s[i + 2..];
                    if let Some(q) = rest.find(['\'', '"']) {
                        let quote = rest.as_bytes()[q] as char;
                        let after = &rest[q + 1..];
                        if let Some(e) = after.find(quote) {
                            keys.push(after[..e].to_string());
                        }
                    }
                }
            }
            i += 1;
        }
        keys
    }
    // First quoted literal right after a marker like showTaskyHelp(
    fn first_literal_after(line: &str, marker: &str) -> Option<String> {
        let idx = line.find(marker)? + marker.len();
        let rest = &line[idx..];
        let q = rest.find(['\'', '"'])?;
        let quote = rest.as_bytes()[q] as char;
        let after = &rest[q + 1..];
        let e = after.find(quote)?;
        Some(after[..e].to_string())
    }

    let mut map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    let mut add = |key: String, kind: &str| {
        if key.is_empty() || key.starts_with('_') { return; }
        let e = map.entry(key).or_default();
        if !e.iter().any(|k| k == kind) { e.push(kind.to_string()); }
    };

    for entry in jwalk::WalkDir::new(&frontend_dir).into_iter().flatten() {
        let path = entry.path();
        if !path.is_file() { continue; }
        let p_str = path.to_string_lossy().replace('\\', "/");
        if p_str.contains("/Lang/") || p_str.contains("/node_modules/") || p_str.ends_with(".map") { continue; }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext != "js" && ext != "ts" && ext != "html" { continue; }
        let content = match std::fs::read_to_string(&path) { Ok(c) => c, Err(_) => continue };
        for line in content.lines() {
            if line.contains("toast(") {
                for k in t_keys(line) { add(k, "toast"); }
            }
            if line.contains("showTaskyHelp(") {
                if let Some(k) = first_literal_after(line, "showTaskyHelp(") {
                    // must look like a key (has a dot, no spaces) — literal tooltips are skipped
                    if k.contains('.') && !k.contains(' ') { add(k, "tooltip"); }
                }
            }
        }
    }
    Ok(map)
}

/// Creates a new language file Lang/{code}.json on disk, seeded either from an
/// existing language's content (copy_from) or empty. Returns the new file's JSON.
#[tauri::command]
pub fn create_language_file(app_handle: tauri::AppHandle, code: String, copy_from: Option<String>) -> Result<String, String> {
    let code = code.trim().to_lowercase();
    if code.is_empty() || code == "template" {
        return Err("Invalid language code".into());
    }
    if !code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("Language code may only contain letters, digits, - and _".into());
    }
    let lang_dir = get_lang_dir(&app_handle);
    if !lang_dir.exists() { std::fs::create_dir_all(&lang_dir).map_err(|e| e.to_string())?; }
    let file_path = lang_dir.join(format!("{}.json", code));
    if file_path.exists() {
        return Err(format!("Language '{}' already exists", code));
    }

    // Seed: copy the source language's keys (values kept so the new lang starts usable)
    let seed_json = match copy_from.filter(|s| !s.trim().is_empty()) {
        Some(src) => {
            let src_path = lang_dir.join(format!("{}.json", src.trim().to_lowercase()));
            std::fs::read_to_string(&src_path).unwrap_or_else(|_| "{}".to_string())
        }
        None => "{}".to_string(),
    };
    std::fs::write(&file_path, &seed_json).map_err(|e| e.to_string())?;
    Ok(seed_json)
}

/// Deletes a (non built-in) language file Lang/{code}.json. The official bundled
/// languages and the template can never be removed.
#[tauri::command]
pub fn delete_language_file(app_handle: tauri::AppHandle, code: String) -> Result<(), String> {
    let code = code.trim().to_lowercase();
    const PROTECTED: [&str; 3] = ["en", "fr", "template"];
    if PROTECTED.contains(&code.as_str()) {
        return Err(format!("'{}' is a built-in language and cannot be removed", code));
    }
    if code.is_empty() || code.contains('/') || code.contains('\\') || code.contains("..") {
        return Err("Invalid language code".into());
    }
    let lang_dir = get_lang_dir(&app_handle);
    let file_path = lang_dir.join(format!("{}.json", code));
    if !file_path.exists() {
        return Err(format!("Language '{}' not found", code));
    }
    std::fs::remove_file(&file_path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Returns the list of available language codes + the raw JSON content of each,
/// so the sandbox can diff all languages at once.
#[tauri::command]
pub fn get_all_languages_content(app_handle: tauri::AppHandle) -> Result<std::collections::HashMap<String, String>, String> {
    let lang_dir = get_lang_dir(&app_handle);
    let mut out = std::collections::HashMap::new();
    if let Ok(entries) = std::fs::read_dir(&lang_dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) == Some("json") {
                if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                    if stem == "template" { continue; }
                    if let Ok(content) = std::fs::read_to_string(&p) {
                        out.insert(stem.to_string(), content);
                    }
                }
            }
        }
    }
    Ok(out)
}
#[tauri::command]
pub fn import_language(app_handle: tauri::AppHandle, path: Option<String>) -> Result<String, String> {
    use tauri::api::dialog::blocking::FileDialogBuilder;
    use std::fs;

    // If a path is supplied (API caller), use it directly; otherwise open a dialog.
    let file_path = match path.filter(|p| !p.trim().is_empty()) {
        Some(p) => {
            let pb = std::path::PathBuf::from(&p);
            if !pb.exists() { return Err(format!("File not found: {}", p)); }
            Some(pb)
        }
        None => FileDialogBuilder::new()
            .add_filter("Language JSON", &["json"])
            .set_title("Select Language File")
            .pick_file(),
    };

    if let Some(src_path) = file_path {
        let file_name = src_path
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or("Invalid filename")?;

        if file_name == "template.json" {
            return Err("Cannot import template.json directly. Please rename it.".to_string());
        }

        // Get Lang directory path using helper
        let lang_dir = get_lang_dir(&app_handle);

        if !lang_dir.exists() {
            fs::create_dir_all(&lang_dir).map_err(|e| e.to_string())?;
        }

        let dest_path = lang_dir.join(file_name);
        fs::copy(&src_path, &dest_path).map_err(|e| e.to_string())?;

        Ok(file_name.replace(".json", ""))
    } else {
        Err("Canceled".to_string())
    }
}

/// Install a language straight from JSON content (used by the `bmm://language/import-inline`
/// share link, so a translation can be shared as a single link like themes are).
#[tauri::command]
pub fn import_language_data(app_handle: tauri::AppHandle, code: String, content: String) -> Result<String, String> {
    use std::fs;
    // Sanitise the lang code → safe filename (no path traversal).
    let code = code.trim().to_lowercase();
    let safe: String = code.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
    if safe.is_empty() { return Err("Invalid language code".to_string()); }
    if safe == "template" { return Err("Cannot overwrite template.json".to_string()); }
    // Validate it's real JSON before writing.
    serde_json::from_str::<serde_json::Value>(&content).map_err(|e| format!("Invalid JSON: {}", e))?;

    let lang_dir = get_lang_dir(&app_handle);
    if !lang_dir.exists() { fs::create_dir_all(&lang_dir).map_err(|e| e.to_string())?; }
    let dest = lang_dir.join(format!("{}.json", safe));
    fs::write(&dest, content).map_err(|e| e.to_string())?;
    Ok(safe)
}

#[tauri::command]
pub fn get_resource_debug_info(app_handle: tauri::AppHandle) -> String {
    let mut debug = String::new();
    debug.push_str(&format!("Resource Dir: {:?}\n", app_handle.path_resolver().resource_dir()));
    
    let checks = [
        "app.cfg", 
        "_up_/app.cfg",
        "LICENSE.md", 
        "_up_/LICENSE.md",
        "Lang", 
        "_up_/frontend/Lang",
        "Lang/en.json", 
        "_up_/frontend/Lang/en.json"
    ];
    for check in &checks {
        let res = app_handle.path_resolver().resolve_resource(check);
        debug.push_str(&format!("Resolve '{}': {:?} (Exists: {})\n", check, res, res.as_ref().map(|p| p.exists()).unwrap_or(false)));
    }

    if let Some(res_dir) = app_handle.path_resolver().resource_dir() {
        if let Ok(entries) = std::fs::read_dir(&res_dir) {
            debug.push_str("\nResource Dir Listing:\n");
            for entry in entries.flatten() {
                debug.push_str(&format!("  {:?}\n", entry.file_name()));
            }
        }
    }
    
    debug
}

#[tauri::command]
pub fn exit_app() {
    std::process::exit(0);
}

/// Resolve the absolute path to the bundled tutorial assets folder.
/// Uses the same resolve_path mechanism as language files — works in dev and prod.
#[tauri::command]
pub fn get_tutorial_assets_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    if let Some(path) = crate::fs_utils::resolve_path(&app_handle, "assets/tutorial-assets") {
        Ok(path.to_string_lossy().to_string())
    } else {
        Err("Tutorial assets folder not found".to_string())
    }
}

/// Copy the tutorial assets folder into a user-chosen destination directory.
/// Copies `<source>/tutorial-assets` → `<dest>/tutorial-assets`.
/// Returns the final destination path.
#[tauri::command]
pub fn export_tutorial_assets(source: String, destination: String) -> Result<String, String> {
    let src = std::path::PathBuf::from(&source);
    let dest = std::path::PathBuf::from(&destination);

    if !src.exists() {
        return Err(format!("Source folder not found: {}", source));
    }
    if !dest.exists() {
        return Err(format!("Destination folder not found: {}", destination));
    }

    let folder_name = src.file_name()
        .ok_or_else(|| "Invalid source path".to_string())?
        .to_string_lossy()
        .to_string();

    let final_dest = dest.join(&folder_name);

    // If destination already exists, remove it first to get a clean copy
    if final_dest.exists() {
        std::fs::remove_dir_all(&final_dest)
            .map_err(|e| format!("Failed to remove existing folder: {}", e))?;
    }

    let options = fs_extra::dir::CopyOptions {
        overwrite: true,
        copy_inside: false,
        ..Default::default()
    };

    fs_extra::dir::copy(&src, &dest, &options)
        .map_err(|e| format!("Copy failed: {}", e))?;

    Ok(final_dest.to_string_lossy().to_string())
}
