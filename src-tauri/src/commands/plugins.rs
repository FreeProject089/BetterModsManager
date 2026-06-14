use tauri::State;
use std::path::PathBuf;
use crate::state::AppState;
use crate::models::plugin::{
    InstalledPlugin, PluginManifest, CatalogResponse, ModCompareResult
};
use crate::commands::crash::log_line;

const CATALOG_URL: &str = "https://raw.githubusercontent.com/BetterDCS/BetterModsManager_Plugins/main/catalog.json";

/// Recursively copy a directory tree from `src` to `dst`.
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let target = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else {
            std::fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

// ── Catalog ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn fetch_plugin_catalog(catalog_url: Option<String>) -> Result<CatalogResponse, String> {
    let url = catalog_url.as_deref().unwrap_or(CATALOG_URL);
    let client = reqwest::Client::builder()
        .user_agent("BetterModsManager/1.0")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Client build error: {}", e))?;

    let resp = client.get(url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if resp.status().as_u16() == 404 {
        // Catalog not published yet — return empty gracefully
        return Ok(CatalogResponse { version: String::new(), plugins: vec![] });
    }
    if !resp.status().is_success() {
        return Err(format!("Catalog fetch failed (HTTP {})", resp.status()));
    }

    let catalog: CatalogResponse = resp.json().await
        .map_err(|e| format!("Parse error: {}", e))?;

    log_line(format!("[PLUGINS] Fetched catalog: {} plugins", catalog.plugins.len()));
    Ok(catalog)
}

// ── Install / Uninstall ────────────────────────────────────────────────────

#[tauri::command]
pub async fn install_plugin(
    state: State<'_, AppState>,
    handle: tauri::AppHandle,
    download_url: String,
) -> Result<InstalledPlugin, String> {
    log_line(format!("[PLUGINS] Installing from: {}", download_url));

    let client = reqwest::Client::builder()
        .user_agent("BetterModsManager/1.0")
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let bytes = client.get(&download_url)
        .send().await.map_err(|e| format!("Download error: {}", e))?
        .bytes().await.map_err(|e| format!("Read error: {}", e))?;

    let app_dir = handle.path_resolver().app_data_dir()
        .ok_or("Cannot resolve app data dir")?;
    let plugins_dir = app_dir.join("plugins");
    std::fs::create_dir_all(&plugins_dir).map_err(|e| e.to_string())?;

    let manifest = extract_plugin_zip(&bytes, &plugins_dir)?;

    let installed = InstalledPlugin {
        install_dir: plugins_dir.join(&manifest.id).to_string_lossy().to_string(),
        icon_path: {
            let icon = plugins_dir.join(&manifest.id).join("icon.png");
            if icon.exists() { Some(icon.to_string_lossy().to_string()) } else { None }
        },
        installed_at: chrono::Utc::now().to_rfc3339(),
        enabled: true,
        manifest: manifest.clone(),
    };

    {
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        data.installed_plugins.retain(|p| p.manifest.id != manifest.id);
        data.installed_plugins.push(installed.clone());
    }
    let _ = state.save();
    log_line(format!("[PLUGINS] Installed plugin '{}'", manifest.id));
    Ok(installed)
}

#[tauri::command]
pub async fn install_plugin_from_file(
    state: State<'_, AppState>,
    handle: tauri::AppHandle,
    file_path: String,
) -> Result<InstalledPlugin, String> {
    log_line(format!("[PLUGINS] Installing from file: {}", file_path));

    let bytes = std::fs::read(&file_path).map_err(|e| format!("Read error: {}", e))?;

    let app_dir = handle.path_resolver().app_data_dir()
        .ok_or("Cannot resolve app data dir")?;
    let plugins_dir = app_dir.join("plugins");
    std::fs::create_dir_all(&plugins_dir).map_err(|e| e.to_string())?;

    let manifest = extract_plugin_zip(&bytes, &plugins_dir)?;

    let installed = InstalledPlugin {
        install_dir: plugins_dir.join(&manifest.id).to_string_lossy().to_string(),
        icon_path: {
            let icon = plugins_dir.join(&manifest.id).join("icon.png");
            if icon.exists() { Some(icon.to_string_lossy().to_string()) } else { None }
        },
        installed_at: chrono::Utc::now().to_rfc3339(),
        enabled: true,
        manifest: manifest.clone(),
    };

    {
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        data.installed_plugins.retain(|p| p.manifest.id != manifest.id);
        data.installed_plugins.push(installed.clone());
    }
    let _ = state.save();
    Ok(installed)
}

fn extract_plugin_zip(bytes: &[u8], plugins_dir: &PathBuf) -> Result<PluginManifest, String> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("ZIP error: {}", e))?;

    // Collect file names first for a useful error message
    let file_names: Vec<String> = (0..archive.len())
        .filter_map(|i| archive.by_index(i).ok().map(|f| f.name().to_string()))
        .collect();

    let manifest_str = (0..archive.len())
        .find_map(|i| {
            let mut file = archive.by_index(i).ok()?;
            if file.name().to_lowercase().ends_with("plugin.json") {
                let mut s = String::new();
                std::io::Read::read_to_string(&mut file, &mut s).ok()?;
                Some(s)
            } else { None }
        })
        .ok_or_else(|| {
            if file_names.is_empty() {
                "plugin.json not found in archive (archive appears empty)".to_string()
            } else {
                format!("plugin.json not found in archive. Files found: {}", file_names.join(", "))
            }
        })?;

    let manifest: PluginManifest = serde_json::from_str(&manifest_str)
        .map_err(|e| format!("plugin.json parse error: {}", e))?;

    if manifest.id.is_empty() || manifest.name.is_empty() {
        return Err("plugin.json: 'id' and 'name' are required".to_string());
    }

    let plugin_dir = plugins_dir.join(&manifest.id);
    std::fs::create_dir_all(&plugin_dir).map_err(|e| e.to_string())?;

    // Re-open archive to extract files
    let cursor2 = std::io::Cursor::new(bytes);
    let mut archive2 = zip::ZipArchive::new(cursor2).map_err(|e| format!("ZIP error: {}", e))?;

    for i in 0..archive2.len() {
        let mut file = archive2.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();
        if name.ends_with('/') { continue; }

        // CWE-22 Zip Slip: resolve a CONTAINED relative path (None ⇒ the entry uses
        // `..`/absolute to escape → skip). The old `name[after first '/']` slice kept
        // any `..` in the remainder, so a crafted .bmmplug could write outside the dir.
        let safe = match file.enclosed_name() { Some(p) => p.to_path_buf(), None => continue };
        // Strip the top-level folder (plugins are zipped inside a root dir), keep the rest.
        let mut stripped = std::path::PathBuf::new();
        for c in safe.components().skip(1) { stripped.push(c.as_os_str()); }
        let rel = if stripped.as_os_str().is_empty() { safe.clone() } else { stripped };
        if rel.as_os_str().is_empty() { continue; }

        let dest = plugin_dir.join(&rel);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
        std::io::copy(&mut file, &mut out).map_err(|e| e.to_string())?;
    }

    Ok(manifest)
}

#[tauri::command]
pub fn uninstall_plugin(state: State<'_, AppState>, plugin_id: String) -> Result<(), String> {
    let install_dir = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        data.installed_plugins.iter()
            .find(|p| p.manifest.id == plugin_id)
            .map(|p| p.install_dir.clone())
    };

    {
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        data.installed_plugins.retain(|p| p.manifest.id != plugin_id);
        data.plugin_permissions.remove(&plugin_id);
    }

    if let Some(dir) = install_dir {
        let path = PathBuf::from(dir);
        if path.exists() {
            std::fs::remove_dir_all(&path).ok();
        }
    }

    let _ = state.save();
    log_line(format!("[PLUGINS] Uninstalled plugin '{}'", plugin_id));
    Ok(())
}

#[tauri::command]
pub fn toggle_plugin(state: State<'_, AppState>, plugin_id: String, enabled: bool) -> Result<(), String> {
    let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(p) = data.installed_plugins.iter_mut().find(|p| p.manifest.id == plugin_id) {
        p.enabled = enabled;
    } else {
        return Err(format!("Plugin '{}' not found", plugin_id));
    }
    drop(data);
    let _ = state.save();
    Ok(())
}

#[tauri::command]
pub fn get_installed_plugins(state: State<'_, AppState>) -> Result<Vec<InstalledPlugin>, String> {
    let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
    Ok(data.installed_plugins.clone())
}

// ── Mod Comparison ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn compare_plugin_mods(
    state: State<'_, AppState>,
    plugin_id: String,
) -> Result<ModCompareResult, String> {
    let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
    let plugin = data.installed_plugins.iter()
        .find(|p| p.manifest.id == plugin_id)
        .ok_or_else(|| format!("Plugin '{}' not found", plugin_id))?
        .clone();

    let active_id = data.active_profile_id.clone().unwrap_or_default();
    let active_mods: Vec<String> = data.profiles.iter()
        .find(|p| p.id == active_id)
        .map(|p| p.active_mods.clone())
        .unwrap_or_default();

    Ok(crate::api::compute_compare(&plugin, &data.mods, &active_mods))
}

#[tauri::command]
pub async fn apply_plugin_modlist(
    state: State<'_, AppState>,
    plugin_id: String,
    force_strict: bool,
) -> Result<serde_json::Value, String> {
    let (plugin, active_id) = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        let plugin = data.installed_plugins.iter()
            .find(|p| p.manifest.id == plugin_id)
            .ok_or_else(|| format!("Plugin '{}' not found", plugin_id))?
            .clone();
        let active_id = data.active_profile_id.clone()
            .ok_or("No active profile")?;
        (plugin, active_id)
    };

    let modlist = plugin.manifest.modlist
        .as_ref()
        .ok_or("Plugin has no modlist")?
        .clone();

    let strict = modlist.strict || force_strict;
    let mut enabled_ids: Vec<String> = Vec::new();
    let mut not_found: Vec<String> = Vec::new();

    {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        for req in &modlist.required_mods {
            if let Some(m) = data.mods.iter().find(|m| m.name.to_lowercase() == req.name.to_lowercase()) {
                enabled_ids.push(m.id.clone());
            } else if !req.optional {
                not_found.push(req.name.clone());
            }
        }
    }

    {
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(p) = data.profiles.iter_mut().find(|p| p.id == active_id) {
            if strict {
                p.active_mods = enabled_ids.clone();
            } else {
                for id in &enabled_ids {
                    if !p.active_mods.contains(id) {
                        p.active_mods.push(id.clone());
                    }
                }
            }
        }
        for m in data.mods.iter_mut() {
            if strict {
                m.enabled = enabled_ids.contains(&m.id);
            } else if enabled_ids.contains(&m.id) {
                m.enabled = true;
            }
        }
    }

    let _ = state.save();
    log_line(format!("[PLUGINS] Applied modlist for '{}'", plugin_id));
    Ok(serde_json::json!({
        "enabled": enabled_ids.len(),
        "not_found": not_found,
        "strict": strict,
    }))
}

// ── Permissions ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn set_plugin_permissions(
    state: State<'_, AppState>,
    plugin_id: String,
    permissions: Vec<String>,
) -> Result<(), String> {
    let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
    data.plugin_permissions.insert(plugin_id, permissions);
    drop(data);
    let _ = state.save();
    Ok(())
}

#[tauri::command]
pub fn get_plugin_permissions(
    state: State<'_, AppState>,
    plugin_id: String,
) -> Result<Vec<String>, String> {
    let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
    Ok(data.plugin_permissions.get(&plugin_id).cloned().unwrap_or_default())
}

// ── API Token ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_api_token(state: State<'_, AppState>) -> Result<String, String> {
    let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
    Ok(data.settings.api_token.clone())
}

/// The port the API actually bound THIS session. The frontend must use this
/// (not settings.api_port) so changing the setting doesn't break calls before
/// the restart that rebinds the server.
#[tauri::command]
pub fn get_effective_api_port() -> u16 {
    crate::api::api_port()
}

/// Stop the running Plugin API server and re-spawn it on the CURRENT
/// `settings.api_port`, so changing the port takes effect immediately without a
/// full app restart. Returns the port it actually bound (read it back to refresh
/// the UI / docs). All state access happens before any `.await`.
#[tauri::command]
pub async fn restart_api_server(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<u16, String> {
    // Signal the current server to stop (graceful shutdown), snapshot what the
    // server needs, and register the new shutdown channel — all before awaiting.
    if let Some(tx) = state.api_shutdown_tx.lock().unwrap_or_else(|p| p.into_inner()).take() {
        let _ = tx.send(());
    }
    let data_arc = state.data.clone();
    let data_path = state.data_path.clone();
    let creator_id = std::sync::Arc::new(
        crate::commands::security::get_creator_id(app.clone()).unwrap_or_default()
    );
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    *state.api_shutdown_tx.lock().unwrap_or_else(|p| p.into_inner()) = Some(tx);

    // Let the OS release the old port before rebinding.
    tokio::time::sleep(std::time::Duration::from_millis(350)).await;

    let api_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        crate::api::start_api_server(data_arc, data_path, creator_id, rx, api_handle).await;
    });

    // Give it a moment to bind, then report the effective port.
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    Ok(crate::api::api_port())
}

#[tauri::command]
pub fn reset_api_token(state: State<'_, AppState>) -> Result<String, String> {
    let new_token = uuid::Uuid::new_v4().to_string();
    {
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        data.settings.api_token = new_token.clone();
    }
    let _ = state.save();
    log_line("[PLUGINS] API token reset".to_string());
    Ok(new_token)
}

// ── Per-plugin API tokens (CWE-862/863) ────────────────────────────────────
// A plugin should call the API with its OWN token (not the shared admin token),
// so the server resolves its identity from the token and limits it to its
// declared permissions. The admin `api_token` keeps full access.

/// Issue (or replace) the per-plugin API token bound to `plugin_id`. Returns it.
#[tauri::command]
pub fn create_plugin_token(state: State<'_, AppState>, plugin_id: String) -> Result<String, String> {
    if plugin_id.trim().is_empty() { return Err("plugin_id required".to_string()); }
    let token = uuid::Uuid::new_v4().to_string();
    {
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        // One token per plugin: drop any previous token for this plugin first.
        data.settings.plugin_tokens.retain(|_, pid| pid != &plugin_id);
        data.settings.plugin_tokens.insert(token.clone(), plugin_id.clone());
    }
    let _ = state.save();
    log_line(format!("[PLUGINS] Issued API token for plugin '{}'", plugin_id));
    Ok(token)
}

/// Revoke a plugin's API token (by plugin_id). Returns true if one was removed.
#[tauri::command]
pub fn revoke_plugin_token(state: State<'_, AppState>, plugin_id: String) -> Result<bool, String> {
    let removed = {
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        let before = data.settings.plugin_tokens.len();
        data.settings.plugin_tokens.retain(|_, pid| pid != &plugin_id);
        before != data.settings.plugin_tokens.len()
    };
    if removed {
        let _ = state.save();
        log_line(format!("[PLUGINS] Revoked API token for plugin '{}'", plugin_id));
    }
    Ok(removed)
}

/// List the plugin_ids that currently have an API token (token values are NEVER
/// returned).
#[tauri::command]
pub fn list_plugin_tokens(state: State<'_, AppState>) -> Vec<String> {
    let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
    data.settings.plugin_tokens.values().cloned().collect()
}

// ── Script Generation ──────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct ScriptAction {
    pub action_type: String,
    pub target_id: String,
    #[serde(default)]
    pub extra: serde_json::Value,
}

#[derive(serde::Deserialize)]
pub struct GenerateScriptRequest {
    pub format: String, // "bat" | "ps1" | "vbs"
    pub actions: Vec<ScriptAction>,
    #[serde(default)]
    pub use_deeplink: bool,
    pub token: Option<String>,
    #[serde(default)]
    pub launch_bmm: bool,
    #[serde(default)]
    pub exe_path: String,
}

#[tauri::command]
pub fn generate_script(req: GenerateScriptRequest) -> Result<String, String> {
    match req.format.as_str() {
        "bat" => Ok(gen_bat(&req)),
        "ps1" => Ok(gen_ps1(&req)),
        "vbs" => Ok(gen_vbs(&req)),
        _ => Err(format!("Unknown format: {}", req.format)),
    }
}

fn extra_str<'a>(v: &'a serde_json::Value, k: &str) -> &'a str {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("")
}
fn extra_u64(v: &serde_json::Value, k: &str) -> u64 {
    v.get(k).and_then(|x| x.as_u64()).unwrap_or(0)
}
fn extra_bool(v: &serde_json::Value, k: &str) -> bool {
    v.get(k).and_then(|x| x.as_bool()).unwrap_or(false)
}

fn gen_bat(req: &GenerateScriptRequest) -> String {
    let token = req.token.as_deref().unwrap_or("YOUR_TOKEN_HERE");
    let mut lines = vec![
        "@echo off".to_string(),
        ":: Generated by BetterModsManager".to_string(),
        ":: https://github.com/FreeProject089/BetterModsManager".to_string(),
        String::new(),
    ];

    if req.launch_bmm && !req.exe_path.is_empty() {
        lines.push(format!("set \"BMM_EXE={}\"", req.exe_path));
        lines.push("echo Starting BetterModsManager...".to_string());
        lines.push("start \"\" \"%BMM_EXE%\"".to_string());
        lines.push("timeout /t 3 /nobreak >nul".to_string());
        lines.push(String::new());
    }

    if !req.use_deeplink || actions_need_api(req) {
        lines.push(format!("set \"BMM_TOKEN={}\"", token));
        lines.push(String::new());
    }

    for action in &req.actions {
        lines.extend(bat_action(action, req.use_deeplink));
    }

    lines.push(String::new());
    lines.push("echo Done.".to_string());
    lines.join("\r\n")
}

fn bat_action(action: &ScriptAction, use_deeplink: bool) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    match action.action_type.as_str() {
        "wait" => {
            let ms = extra_u64(&action.extra, "duration_ms");
            let secs = ((ms + 999) / 1000).max(1);
            out.push(format!("timeout /t {} /nobreak >nul", secs));
        }
        "close_process" => {
            let name = extra_str(&action.extra, "process_name");
            if !name.is_empty() {
                out.push(format!("taskkill /F /IM \"{}\" >nul 2>&1", name));
            }
        }
        "open_url" => {
            let url = extra_str(&action.extra, "url");
            if !url.is_empty() {
                out.push(format!("start \"\" \"{}\"", url));
            }
        }
        "show_message" => {
            let msg = extra_str(&action.extra, "message");
            if !msg.is_empty() {
                out.push(format!("echo {}", msg));
                out.push("pause".to_string());
            }
        }
        "launch_game" => {
            let exe = extra_str(&action.extra, "exe_path");
            if !exe.is_empty() {
                out.push(format!("start \"\" \"{}\"", exe));
                out.push("timeout /t 1 /nobreak >nul".to_string());
            }
        }
        "log" => {
            let msg = extra_str(&action.extra, "message");
            out.push(format!("echo {}", if msg.is_empty() { "." } else { &msg }));
        }
        "comment" => {
            let text = extra_str(&action.extra, "text");
            out.push(format!(":: {}", text));
        }
        "set_variable" => {
            let expr = extra_str(&action.extra, "expr");
            if !expr.is_empty() {
                out.push(format!("set {}", expr));
            }
        }
        "if_file_exists" => {
            let path = extra_str(&action.extra, "path");
            if !path.is_empty() {
                out.push(format!("if exist \"{}\" (", path));
            }
        }
        "if_file_not_exists" => {
            let path = extra_str(&action.extra, "path");
            if !path.is_empty() {
                out.push(format!("if not exist \"{}\" (", path));
            }
        }
        "if_var_eq" => {
            let cond = extra_str(&action.extra, "cond");
            let parts: Vec<&str> = cond.splitn(2, '=').collect();
            if parts.len() == 2 {
                out.push(format!("if \"%{}%\"==\"{}\" (", parts[0].trim(), parts[1].trim()));
            }
        }
        "if_var_neq" => {
            let cond = extra_str(&action.extra, "cond");
            let parts: Vec<&str> = cond.splitn(2, '=').collect();
            if parts.len() == 2 {
                out.push(format!("if not \"%{}%\"==\"{}\" (", parts[0].trim(), parts[1].trim()));
            }
        }
        "if_api_ok" => {
            // Optionally run a linked API call first, then branch on its result.
            let linked = extra_str(&action.extra, "api_action");
            if !linked.is_empty() {
                out.extend(bat_action(&ScriptAction { action_type: linked.to_string(), target_id: String::new(), extra: serde_json::Value::Null }, false));
            }
            // curl uses -f below, so a failed HTTP call sets ERRORLEVEL != 0.
            out.push("if %ERRORLEVEL% EQU 0 (".to_string());
        }
        "if_api_err" => {
            let linked = extra_str(&action.extra, "api_action");
            if !linked.is_empty() {
                out.extend(bat_action(&ScriptAction { action_type: linked.to_string(), target_id: String::new(), extra: serde_json::Value::Null }, false));
            }
            out.push("if %ERRORLEVEL% NEQ 0 (".to_string());
        }
        "pause_key" => {
            out.push("pause".to_string());
        }
        "stop_script" => {
            out.push("exit /b 0".to_string());
        }
        "else_block" => {
            out.push(") else (".to_string());
        }
        "end_block" => {
            out.push(")".to_string());
        }
        "raw_code" => {
            let code = extra_str(&action.extra, "code");
            if !code.is_empty() { out.push(code.to_string()); }
        }
        _ if use_deeplink && action_to_deeplink(action).starts_with("bmm://") && !action_to_deeplink(action).contains("unknown") => {
            out.push(format!("start \"\" \"{}\"", action_to_deeplink(action)));
            out.push("timeout /t 1 /nobreak >nul".to_string());
        }
        _ => {
            if let Some((method, path, body)) = action_to_api_call(action) {
                // -f makes curl exit non-zero on HTTP >= 400 so `if_api_ok` /
                // `if_api_err` can branch on %ERRORLEVEL%.
                let base = format!(
                    "curl -s -f -X {} \"http://127.0.0.1:{port}{}\" -H \"Authorization: Bearer %BMM_TOKEN%\"",
                    method, path, port = crate::api::api_port()
                );
                if body.is_empty() {
                    out.push(base);
                } else {
                    out.push(format!(
                        "{} -H \"Content-Type: application/json\" -d \"{}\"",
                        base, body.replace('"', "\\\"")
                    ));
                }
            } else {
                out.push(format!(":: [WARN] Unknown action: {}", action.action_type));
            }
        }
    }
    out
}

fn gen_ps1(req: &GenerateScriptRequest) -> String {
    let token = req.token.as_deref().unwrap_or("YOUR_TOKEN_HERE");
    let mut lines = vec![
        "# Generated by BetterModsManager".to_string(),
        "# https://github.com/FreeProject089/BetterModsManager".to_string(),
        String::new(),
    ];

    if req.launch_bmm && !req.exe_path.is_empty() {
        lines.push(format!("$bmmExe = \"{}\"", req.exe_path));
        lines.push("Write-Host \"Starting BetterModsManager...\"".to_string());
        lines.push("Start-Process $bmmExe".to_string());
        lines.push("Start-Sleep -Seconds 3".to_string());
        lines.push(String::new());
    }

    if !req.use_deeplink || actions_need_api(req) {
        lines.push(format!("$bmmToken = \"{}\"", token));
        lines.push("$bmmHeaders = @{ Authorization = \"Bearer $bmmToken\"; \"Content-Type\" = \"application/json\" }".to_string());
        lines.push("$bmmOk = $true  # set after each API call for if_api_ok / if_api_err".to_string());
        lines.push(String::new());
    }

    for action in &req.actions {
        lines.extend(ps1_action(action, req.use_deeplink));
    }

    lines.push(String::new());
    lines.push("Write-Host \"Done.\"".to_string());
    lines.join("\n")
}

fn ps1_action(action: &ScriptAction, use_deeplink: bool) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    match action.action_type.as_str() {
        "wait" => {
            let ms = extra_u64(&action.extra, "duration_ms").max(100);
            out.push(format!("Start-Sleep -Milliseconds {}", ms));
        }
        "close_process" => {
            let name = extra_str(&action.extra, "process_name").trim_end_matches(".exe").to_string();
            if !name.is_empty() {
                out.push(format!("Stop-Process -Name \"{}\" -Force -ErrorAction SilentlyContinue", name));
            }
        }
        "open_url" => {
            let url = extra_str(&action.extra, "url");
            if !url.is_empty() {
                out.push(format!("Start-Process \"{}\"", url));
            }
        }
        "show_message" => {
            let msg = extra_str(&action.extra, "message");
            if !msg.is_empty() {
                out.push(format!("Write-Host \"{}\"", msg));
                out.push("$null = Read-Host 'Press Enter to continue'".to_string());
            }
        }
        "launch_game" => {
            let exe = extra_str(&action.extra, "exe_path");
            if !exe.is_empty() {
                out.push(format!("Start-Process \"{}\"", exe));
                out.push("Start-Sleep -Seconds 1".to_string());
            }
        }
        "log" => {
            let msg = extra_str(&action.extra, "message");
            out.push(format!("Write-Host \"{}\"", msg.replace('"', "''")));
        }
        "comment" => {
            let text = extra_str(&action.extra, "text");
            out.push(format!("# {}", text));
        }
        "set_variable" => {
            let expr = extra_str(&action.extra, "expr");
            if !expr.is_empty() {
                let parts: Vec<&str> = expr.splitn(2, '=').collect();
                if parts.len() == 2 {
                    out.push(format!("${} = \"{}\"", parts[0].trim(), parts[1].trim()));
                }
            }
        }
        "if_file_exists" => {
            let path = extra_str(&action.extra, "path");
            if !path.is_empty() {
                out.push(format!("if (Test-Path \"{}\") {{", path));
            }
        }
        "if_file_not_exists" => {
            let path = extra_str(&action.extra, "path");
            if !path.is_empty() {
                out.push(format!("if (-not (Test-Path \"{}\")) {{", path));
            }
        }
        "if_var_eq" => {
            let cond = extra_str(&action.extra, "cond");
            let parts: Vec<&str> = cond.splitn(2, '=').collect();
            if parts.len() == 2 {
                out.push(format!("if (${} -eq \"{}\") {{", parts[0].trim(), parts[1].trim()));
            }
        }
        "if_var_neq" => {
            let cond = extra_str(&action.extra, "cond");
            let parts: Vec<&str> = cond.splitn(2, '=').collect();
            if parts.len() == 2 {
                out.push(format!("if (${} -ne \"{}\") {{", parts[0].trim(), parts[1].trim()));
            }
        }
        "if_api_ok" => {
            let linked = extra_str(&action.extra, "api_action");
            if !linked.is_empty() {
                out.extend(ps1_action(&ScriptAction { action_type: linked.to_string(), target_id: String::new(), extra: serde_json::Value::Null }, false));
            }
            out.push("if ($bmmOk) {".to_string());
        }
        "if_api_err" => {
            let linked = extra_str(&action.extra, "api_action");
            if !linked.is_empty() {
                out.extend(ps1_action(&ScriptAction { action_type: linked.to_string(), target_id: String::new(), extra: serde_json::Value::Null }, false));
            }
            out.push("if (-not $bmmOk) {".to_string());
        }
        "pause_key" => {
            out.push("$null = Read-Host 'Press Enter to continue'".to_string());
        }
        "stop_script" => {
            out.push("exit 0".to_string());
        }
        "else_block" => {
            out.push("} else {".to_string());
        }
        "end_block" => {
            out.push("}".to_string());
        }
        "raw_code" => {
            let code = extra_str(&action.extra, "code");
            if !code.is_empty() { out.push(code.to_string()); }
        }
        _ if use_deeplink && action_to_deeplink(action).starts_with("bmm://") && !action_to_deeplink(action).contains("unknown") => {
            out.push(format!("Start-Process \"{}\"", action_to_deeplink(action)));
            out.push("Start-Sleep -Seconds 1".to_string());
        }
        _ => {
            if let Some((method, path, body)) = action_to_api_call(action) {
                // -ErrorAction SilentlyContinue + `$bmmOk = $?` so a failed call
                // doesn't halt the script and `if_api_ok`/`if_api_err` can branch.
                if body.is_empty() {
                    out.push(format!(
                        "Invoke-RestMethod -Method {} -Uri \"http://127.0.0.1:{port}{}\" -Headers $bmmHeaders -ErrorAction SilentlyContinue; $bmmOk = $?",
                        method, path, port = crate::api::api_port()
                    ));
                } else {
                    // Escape single-quotes inside body for PS1 single-quoted string
                    let body_esc = body.replace('\'', "''");
                    out.push(format!(
                        "Invoke-RestMethod -Method {} -Uri \"http://127.0.0.1:{port}{}\" -Headers $bmmHeaders -Body '{}' -ErrorAction SilentlyContinue; $bmmOk = $?",
                        method, path, body_esc, port = crate::api::api_port()
                    ));
                }
            } else {
                out.push(format!("# [WARN] Unknown action: {}", action.action_type));
            }
        }
    }
    out
}

fn gen_vbs(req: &GenerateScriptRequest) -> String {
    let token = req.token.as_deref().unwrap_or("YOUR_TOKEN_HERE");
    let need_api = actions_need_api(req);
    let mut lines = vec![
        "' Generated by BetterModsManager".to_string(),
        "' https://github.com/FreeProject089/BetterModsManager".to_string(),
        String::new(),
        "Set shell = CreateObject(\"WScript.Shell\")".to_string(),
        String::new(),
    ];

    if req.launch_bmm && !req.exe_path.is_empty() {
        lines.push(format!("Dim bmmExe : bmmExe = \"{}\"", req.exe_path.replace('"', "\"\"")));
        lines.push("shell.Run Chr(34) & bmmExe & Chr(34)".to_string());
        lines.push("WScript.Sleep 3000".to_string());
        lines.push(String::new());
    }

    if need_api {
        lines.push(format!("Dim bmmToken : bmmToken = \"{}\"", token.replace('"', "\"\"")));
        lines.push("Dim bmmLastStatus : bmmLastStatus = 0  ' set after each API call for if_api_ok / if_api_err".to_string());
        lines.push("Sub BmmApi(method, path, body)".to_string());
        lines.push("    Dim http : Set http = CreateObject(\"MSXML2.XMLHTTP\")".to_string());
        lines.push(format!("    http.open method, \"http://127.0.0.1:{}\" & path, False", crate::api::api_port()));
        lines.push("    http.setRequestHeader \"Authorization\", \"Bearer \" & bmmToken".to_string());
        lines.push("    On Error Resume Next".to_string());
        lines.push("    If Len(body) > 0 Then".to_string());
        lines.push("        http.setRequestHeader \"Content-Type\", \"application/json\"".to_string());
        lines.push("        http.send body".to_string());
        lines.push("    Else".to_string());
        lines.push("        http.send".to_string());
        lines.push("    End If".to_string());
        lines.push("    If Err.Number <> 0 Then bmmLastStatus = 0 Else bmmLastStatus = http.status".to_string());
        lines.push("    On Error Goto 0".to_string());
        lines.push("End Sub".to_string());
        lines.push(String::new());
    }

    for action in &req.actions {
        lines.extend(vbs_action(action, req.use_deeplink));
    }

    lines.push(String::new());
    lines.push("MsgBox \"Done.\"".to_string());
    lines.join("\n")
}

fn vbs_action(action: &ScriptAction, use_deeplink: bool) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    match action.action_type.as_str() {
        "wait" => {
            let ms = extra_u64(&action.extra, "duration_ms").max(100);
            out.push(format!("WScript.Sleep {}", ms));
        }
        "close_process" => {
            let name = extra_str(&action.extra, "process_name");
            if !name.is_empty() {
                out.push(format!("shell.Run \"taskkill /F /IM {}\", 0, True", name));
            }
        }
        "open_url" => {
            let url = extra_str(&action.extra, "url");
            if !url.is_empty() {
                out.push(format!("shell.Run \"{}\"", url));
            }
        }
        "show_message" => {
            let msg = extra_str(&action.extra, "message");
            if !msg.is_empty() {
                out.push(format!("MsgBox \"{}\"", msg));
            }
        }
        "launch_game" => {
            let exe = extra_str(&action.extra, "exe_path");
            if !exe.is_empty() {
                out.push(format!("shell.Run Chr(34) & \"{}\" & Chr(34)", exe));
                out.push("WScript.Sleep 1000".to_string());
            }
        }
        "log" => {
            let msg = extra_str(&action.extra, "message");
            out.push(format!("WScript.Echo \"{}\"", msg.replace('"', "\" & Chr(34) & \"")));
        }
        "comment" => {
            let text = extra_str(&action.extra, "text");
            out.push(format!("' {}", text));
        }
        "set_variable" => {
            let expr = extra_str(&action.extra, "expr");
            if !expr.is_empty() {
                let parts: Vec<&str> = expr.splitn(2, '=').collect();
                if parts.len() == 2 {
                    out.push(format!("Dim {} : {} = \"{}\"", parts[0].trim(), parts[0].trim(), parts[1].trim()));
                }
            }
        }
        "if_file_exists" => {
            let path = extra_str(&action.extra, "path");
            if !path.is_empty() {
                out.push("Dim fso : Set fso = CreateObject(\"Scripting.FileSystemObject\")".to_string());
                out.push(format!("If fso.FileExists(\"{}\") Then", path));
            }
        }
        "if_file_not_exists" => {
            let path = extra_str(&action.extra, "path");
            if !path.is_empty() {
                out.push("Dim fso : Set fso = CreateObject(\"Scripting.FileSystemObject\")".to_string());
                out.push(format!("If Not fso.FileExists(\"{}\") Then", path));
            }
        }
        "if_var_eq" => {
            let cond = extra_str(&action.extra, "cond");
            let parts: Vec<&str> = cond.splitn(2, '=').collect();
            if parts.len() == 2 {
                out.push(format!("If {} = \"{}\" Then", parts[0].trim(), parts[1].trim()));
            }
        }
        "if_var_neq" => {
            let cond = extra_str(&action.extra, "cond");
            let parts: Vec<&str> = cond.splitn(2, '=').collect();
            if parts.len() == 2 {
                out.push(format!("If {} <> \"{}\" Then", parts[0].trim(), parts[1].trim()));
            }
        }
        "if_api_ok" => {
            let linked = extra_str(&action.extra, "api_action");
            if !linked.is_empty() {
                out.extend(vbs_action(&ScriptAction { action_type: linked.to_string(), target_id: String::new(), extra: serde_json::Value::Null }, false));
            }
            out.push("If bmmLastStatus >= 200 And bmmLastStatus < 400 Then".to_string());
        }
        "if_api_err" => {
            let linked = extra_str(&action.extra, "api_action");
            if !linked.is_empty() {
                out.extend(vbs_action(&ScriptAction { action_type: linked.to_string(), target_id: String::new(), extra: serde_json::Value::Null }, false));
            }
            out.push("If bmmLastStatus >= 400 Or bmmLastStatus = 0 Then".to_string());
        }
        "pause_key" => {
            out.push("MsgBox \"Press OK to continue...\"".to_string());
        }
        "stop_script" => {
            out.push("WScript.Quit 0".to_string());
        }
        "else_block" => {
            out.push("Else".to_string());
        }
        "end_block" => {
            out.push("End If".to_string());
        }
        "raw_code" => {
            let code = extra_str(&action.extra, "code");
            if !code.is_empty() { out.push(code.to_string()); }
        }
        _ => {
            let dl = action_to_deeplink(action);
            if use_deeplink && dl.starts_with("bmm://") && !dl.contains("unknown") {
                out.push(format!("shell.Run \"{}\"", dl));
                out.push("WScript.Sleep 1000".to_string());
            } else if let Some((method, path, body)) = action_to_api_call(action) {
                let body_esc = body.replace('"', "\"\"");
                out.push(format!("BmmApi \"{}\", \"{}\", \"{}\"", method, path, body_esc));
                out.push("WScript.Sleep 500".to_string());
            } else {
                out.push(format!("' [WARN] Unknown action: {}", action.action_type));
            }
        }
    }
    out
}

/// True when generating with the given mode requires the API token to be
/// defined — i.e. at least one action falls through to an HTTP call. In
/// deeplink mode this happens for API-only actions (repo/modpack) that have
/// no deeplink equivalent.
fn actions_need_api(req: &GenerateScriptRequest) -> bool {
    req.actions.iter().any(|a| {
        let has_api = action_to_api_call(a).is_some();
        if req.use_deeplink {
            let dl = action_to_deeplink(a);
            has_api && (!dl.starts_with("bmm://") || dl.contains("unknown"))
        } else {
            has_api
        }
    })
}

fn action_to_deeplink(action: &ScriptAction) -> String {
    match action.action_type.as_str() {
        "enable_mod"       => format!("bmm://mod/enable?id={}", action.target_id),
        "disable_mod"      => format!("bmm://mod/disable?id={}", action.target_id),
        "activate_profile" => format!("bmm://profile/activate?id={}", action.target_id),
        "apply_plugin"     => format!("bmm://plugin/activate?id={}", action.target_id),
        "compare_plugin"   => format!("bmm://plugin/compare?id={}", action.target_id),
        "enable_modpack"   => format!("bmm://modpack/enable?id={}", action.target_id),
        "disable_modpack"  => format!("bmm://modpack/disable?id={}", action.target_id),
        _                  => format!("bmm://unknown?id={}", action.target_id),
    }
}

/// Returns (method, path, body) for any action that maps to an HTTP call.
/// Method is one of "POST" | "PUT" | "DELETE". Bodies are built with
/// `serde_json` so paths/names with spaces, quotes, or backslashes are
/// escaped correctly.
fn action_to_api_call(action: &ScriptAction) -> Option<(String, String, String)> {
    let id = &action.target_id;
    let ex = &action.extra;

    let opt_str = |k: &str, default: &str| -> String {
        let v = extra_str(ex, k);
        if v.is_empty() { default.to_string() } else { v.to_string() }
    };
    let port_or = |default: u64| -> u64 {
        let p = extra_u64(ex, "port");
        if p == 0 { default } else { p }
    };
    // Build a JSON object body, dropping empty-string values so PUT/update
    // calls don't blank out fields. Mirrors _prune() in the TS generator.
    let prune = |pairs: &[(&str, &str)]| -> String {
        let mut m = serde_json::Map::new();
        for (k, v) in pairs {
            if !v.is_empty() {
                m.insert((*k).to_string(), serde_json::Value::String((*v).to_string()));
            }
        }
        serde_json::Value::Object(m).to_string()
    };

    match action.action_type.as_str() {
        "enable_mod"        => Some(("POST".into(),   "/api/mods/enable".into(),       serde_json::json!({ "mod_id": id }).to_string())),
        "disable_mod"       => Some(("POST".into(),   "/api/mods/disable".into(),      serde_json::json!({ "mod_id": id }).to_string())),
        "activate_profile"  => Some(("POST".into(),   "/api/profiles/activate".into(), serde_json::json!({ "profile_id": id }).to_string())),
        "apply_plugin"      => Some(("POST".into(),   "/api/plugins/apply".into(),     serde_json::json!({ "plugin_id": id, "force_strict": false }).to_string())),
        "compare_plugin"    => Some(("POST".into(),   "/api/plugins/compare".into(),   serde_json::json!({ "plugin_id": id }).to_string())),
        "enable_modpack"    => Some(("POST".into(),   "/api/modpacks/enable".into(),   serde_json::json!({ "profile_id": id }).to_string())),
        "disable_modpack"   => Some(("POST".into(),   "/api/modpacks/disable".into(),  serde_json::json!({ "profile_id": id }).to_string())),
        "update_modpack"    => {
            let modpack_id = opt_str("modpack_id", "MODPACK_ID");
            let body = serde_json::json!({
                "name": extra_str(ex, "name"),
                "dependency_mode": opt_str("dependency_mode", "none"),
            });
            Some(("PUT".into(), format!("/api/modpacks/{}", modpack_id), body.to_string()))
        }
        "sync_repo" => {
            let body = serde_json::json!({
                "url":           opt_str("url", "REPO_URL"),
                "modsDir":       extra_str(ex, "mods_dir"),
                "backupDir":     extra_str(ex, "backup_dir"),
                "gameDir":       extra_str(ex, "game_dir"),
                "choices":       [],
                "overwriteAll":  extra_bool(ex, "overwrite_all"),
                "deleteExtra":   extra_bool(ex, "delete_extra"),
                "downloadLimit": extra_u64(ex, "download_limit"),
            });
            Some(("POST".into(), "/api/repo/sync".into(), body.to_string()))
        }
        "gen_repo" => {
            let profile_id = extra_str(ex, "profile_id");
            let profile_ids: Vec<&str> = if profile_id.is_empty() { vec![] } else { vec![profile_id] };
            let body = serde_json::json!({
                "profileIds":     profile_ids,
                "outputDir":      extra_str(ex, "output_dir"),
                "authorName":     opt_str("author", "Author"),
                "lightweight":    extra_bool(ex, "lightweight"),
                "zipOutput":      extra_bool(ex, "zip"),
                "generateServer": extra_bool(ex, "generate_server"),
                "autoStart":      extra_bool(ex, "auto_start"),
                "port":           port_or(8080),
                "adminPassword":  extra_str(ex, "admin_pass"),
                "uploadLimit":    extra_u64(ex, "upload_limit"),
            });
            Some(("POST".into(), "/api/repo/gen".into(), body.to_string()))
        }
        "http_host" => {
            let body = serde_json::json!({
                "serveDir":    extra_str(ex, "serve_dir"),
                "port":        port_or(8080),
                "uploadLimit": extra_u64(ex, "upload_limit"),
            });
            Some(("POST".into(), "/api/repo/host".into(), body.to_string()))
        }
        "cancel_sync"    => Some(("DELETE".into(), "/api/repo/sync/cancel".into(), String::new())),
        "cancel_gen"     => Some(("DELETE".into(), "/api/repo/gen/cancel".into(),  String::new())),
        "stop_http_host" => Some(("DELETE".into(), "/api/repo/host".into(),        String::new())),

        // ── Read-only (GET, unauthenticated) ──────────────────────────────
        "get_status"       => Some(("GET".into(), "/api/status".into(),       String::new())),
        "list_mods"        => Some(("GET".into(), "/api/mods".into(),         String::new())),
        "list_active_mods" => Some(("GET".into(), "/api/mods/active".into(),  String::new())),
        "list_profiles"    => Some(("GET".into(), "/api/profiles".into(),     String::new())),
        "list_plugins"     => Some(("GET".into(), "/api/plugins".into(),      String::new())),
        "list_modpacks"    => Some(("GET".into(), "/api/modpacks".into(),     String::new())),
        "check_update"     => Some(("GET".into(), "/api/check-update".into(), String::new())),
        "get_creator_id"   => Some(("GET".into(), "/api/creator-id".into(),   String::new())),
        "api_health"       => Some(("GET".into(), "/api/health".into(),       String::new())),
        "repo_list"        => Some(("GET".into(), "/api/repo/list".into(),    String::new())),
        "repo_info"        => {
            use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
            let url = opt_str("url", "REPO_URL");
            let enc = utf8_percent_encode(&url, NON_ALPHANUMERIC).to_string();
            Some(("GET".into(), format!("/api/repo/info?url={}", enc), String::new()))
        }

        // ── Mods / profiles / modpacks (writes — snake_case bodies) ───────
        "delete_mod"     => Some(("DELETE".into(), format!("/api/mods/{}", if id.is_empty() { "MOD_ID" } else { id.as_str() }), String::new())),
        "update_mod"     => {
            let path = format!("/api/mods/{}", if id.is_empty() { "MOD_ID" } else { id.as_str() });
            let body = prune(&[
                ("name", extra_str(ex, "name")),
                ("version", extra_str(ex, "version")),
                ("author", extra_str(ex, "author")),
                ("description", extra_str(ex, "description")),
            ]);
            Some(("PUT".into(), path, body))
        }
        "create_profile" => {
            let body = serde_json::json!({
                "name":        extra_str(ex, "name"),
                "game_name":   extra_str(ex, "game_name"),
                "game_path":   extra_str(ex, "game_path"),
                "mods_path":   extra_str(ex, "mods_path"),
                "backup_path": extra_str(ex, "backup_path"),
            });
            Some(("POST".into(), "/api/profiles".into(), body.to_string()))
        }
        "update_profile" => {
            let path = format!("/api/profiles/{}", if id.is_empty() { "PROFILE_ID" } else { id.as_str() });
            let body = prune(&[
                ("name", extra_str(ex, "name")),
                ("game_name", extra_str(ex, "game_name")),
                ("color", extra_str(ex, "color")),
                ("icon", extra_str(ex, "icon")),
                ("game_path", extra_str(ex, "game_path")),
                ("mods_path", extra_str(ex, "mods_path")),
                ("backup_path", extra_str(ex, "backup_path")),
            ]);
            Some(("PUT".into(), path, body))
        }
        "delete_profile" => Some(("DELETE".into(), format!("/api/profiles/{}", if id.is_empty() { "PROFILE_ID" } else { id.as_str() }), String::new())),
        "restart"        => Some(("POST".into(), "/api/restart".into(), serde_json::json!({}).to_string())),
        "create_modpack" => {
            let body = prune(&[
                ("name", extra_str(ex, "name")),
                ("description", extra_str(ex, "description")),
                ("game_name", extra_str(ex, "game_name")),
                ("sr_link", extra_str(ex, "sr_link")),
                ("dependency_mode", &opt_str("dependency_mode", "none")),
            ]);
            Some(("POST".into(), "/api/modpacks/create".into(), body))
        }
        "delete_modpack" => Some(("DELETE".into(), format!("/api/modpacks/{}", opt_str("modpack_id", "MODPACK_ID")), String::new())),
        "repo_connect"   => Some(("POST".into(),   "/api/repo/connect".into(), serde_json::json!({ "url": opt_str("url", "REPO_URL") }).to_string())),
        "repo_remove"    => Some(("DELETE".into(), "/api/repo".into(),          serde_json::json!({ "url": opt_str("url", "REPO_URL") }).to_string())),
        _ => None,
    }
}

// ── Export plugin ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn export_plugin(
    state: State<'_, AppState>,
    plugin_id: String,
    dest_path: String,
) -> Result<(), String> {
    let plugin = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        data.installed_plugins.iter()
            .find(|p| p.manifest.id == plugin_id)
            .ok_or_else(|| format!("Plugin '{}' not found", plugin_id))?
            .clone()
    };

    let plugin_dir = PathBuf::from(&plugin.install_dir);
    let dest = PathBuf::from(&dest_path);

    let file = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mut has_manifest = false;
    if plugin_dir.exists() {
        for entry in walkdir::WalkDir::new(&plugin_dir) {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_file() {
                let rel = path.strip_prefix(&plugin_dir).map_err(|e| e.to_string())?;
                let rel_str = rel.to_string_lossy();
                if rel_str == "plugin.json" { has_manifest = true; }
                let zip_path = format!("{}/{}", plugin_id, rel_str);
                zip.start_file(zip_path, options).map_err(|e| e.to_string())?;
                let data = std::fs::read(path).map_err(|e| e.to_string())?;
                std::io::Write::write_all(&mut zip, &data).map_err(|e| e.to_string())?;
            }
        }
    }
    // Always ensure plugin.json is present (fallback from in-memory manifest)
    if !has_manifest {
        let manifest_json = serde_json::to_string_pretty(&plugin.manifest)
            .map_err(|e| e.to_string())?;
        zip.start_file(format!("{}/plugin.json", plugin_id), options).map_err(|e| e.to_string())?;
        std::io::Write::write_all(&mut zip, manifest_json.as_bytes()).map_err(|e| e.to_string())?;
    }

    zip.finish().map_err(|e| e.to_string())?;
    log_line(format!("[PLUGINS] Exported plugin '{}' to {:?}", plugin_id, dest));
    Ok(())
}

// ── Write text file helper (for saving generated scripts) ─────────────────

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    // CWE-73 hardening: this command is reachable from the WebView, so an XSS
    // could try to drop a file into an auto-run location. Reject path traversal
    // and the Windows auto-start folder. Legit callers (plugin-script export,
    // benchmark report export) pass an absolute path the user picked via the
    // native save dialog, which is unaffected.
    let norm = path.replace('/', "\\").to_lowercase();
    if norm.contains("..") {
        return Err("Refused: path traversal in target".to_string());
    }
    if norm.contains(r"\microsoft\windows\start menu\programs\startup") {
        return Err("Refused: auto-start location".to_string());
    }
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Write multiple files as a ZIP (for Script Generator "Save as ZIP") ───────

#[derive(serde::Deserialize)]
pub struct ZipFileEntry {
    pub name: String,
    pub content: String,
}

#[tauri::command]
pub fn write_zip_files(dest_path: String, files: Vec<ZipFileEntry>) -> Result<(), String> {
    let file = std::fs::File::create(&dest_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for entry in &files {
        zip.start_file(&entry.name, options).map_err(|e| e.to_string())?;
        std::io::Write::write_all(&mut zip, entry.content.as_bytes()).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    log_line(format!("[PLUGINS] Wrote ZIP with {} files to {}", files.len(), dest_path));
    Ok(())
}

// ── Exe path helper (used by script generator to embed launch command) ────

#[tauri::command]
pub fn get_app_exe_path() -> Result<String, String> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

// ── Create local plugin (from Create tab, no zip needed) ──────────────────

#[tauri::command]
pub fn create_local_plugin(
    state: State<'_, AppState>,
    handle: tauri::AppHandle,
    manifest: PluginManifest,
    icon_src_path: Option<String>,
    icon_svg: Option<String>,
    script_src_paths: Option<Vec<String>>,
    folder_src_paths: Option<Vec<String>>,
) -> Result<InstalledPlugin, String> {
    let mut manifest = manifest;
    if manifest.id.is_empty() || manifest.name.is_empty() {
        return Err("Plugin id and name are required".to_string());
    }

    let app_dir = handle.path_resolver().app_data_dir()
        .ok_or_else(|| "Cannot resolve app data dir".to_string())?;
    let plugin_dir = app_dir.join("plugins").join(&manifest.id);
    std::fs::create_dir_all(&plugin_dir).map_err(|e| e.to_string())?;

    // ── Import folders: copy each chosen directory into the plugin's bundle/.
    if let Some(dirs) = folder_src_paths {
        let bundle_dir = plugin_dir.join("bundle");
        let mut names: Vec<String> = Vec::new();
        for src in dirs.iter().filter(|s| !s.trim().is_empty()) {
            let src_path = std::path::Path::new(src);
            if let Some(fname) = src_path.file_name().and_then(|f| f.to_str()) {
                let dest = bundle_dir.join(fname);
                if copy_dir_recursive(src_path, &dest).is_ok() {
                    names.push(format!("bundle/{}", fname));
                }
            }
        }
        if !names.is_empty() { manifest.folders = names; }
    }

    // ── Import script files: copy each into the plugin folder and record its
    //    filename in manifest.scripts. Presence of scripts flips has_scripts on.
    if let Some(srcs) = script_src_paths {
        let scripts_dir = plugin_dir.join("scripts");
        let mut names: Vec<String> = Vec::new();
        for src in srcs.iter().filter(|s| !s.trim().is_empty()) {
            let src_path = std::path::Path::new(src);
            if let Some(fname) = src_path.file_name().and_then(|f| f.to_str()) {
                let _ = std::fs::create_dir_all(&scripts_dir);
                let dest = scripts_dir.join(fname);
                if std::fs::copy(src_path, &dest).is_ok() {
                    names.push(format!("scripts/{}", fname));
                }
            }
        }
        if !names.is_empty() {
            manifest.scripts = names;
            manifest.has_scripts = true;
        }
    }
    if !manifest.scripts.is_empty() { manifest.has_scripts = true; }

    // Determine icon path: prefer file copy, fall back to SVG, then existing
    let icon_path = if let Some(ref src) = icon_src_path {
        // User picked a file → copy as icon.png
        let dest = plugin_dir.join("icon.png");
        let _ = std::fs::copy(src, &dest);
        if dest.exists() { Some(dest.to_string_lossy().to_string()) } else { None }
    } else if let Some(ref svg) = icon_svg {
        // User picked a builtin SVG → save as icon.svg
        let dest = plugin_dir.join("icon.svg");
        let _ = std::fs::write(&dest, svg.as_bytes());
        if dest.exists() { Some(dest.to_string_lossy().to_string()) } else { None }
    } else {
        // Preserve existing icon (png or svg)
        let png = plugin_dir.join("icon.png");
        let svg_f = plugin_dir.join("icon.svg");
        if png.exists() { Some(png.to_string_lossy().to_string()) }
        else if svg_f.exists() { Some(svg_f.to_string_lossy().to_string()) }
        else { None }
    };

    let installed = InstalledPlugin {
        install_dir: plugin_dir.to_string_lossy().to_string(),
        icon_path,
        installed_at: chrono::Utc::now().to_rfc3339(),
        enabled: true,
        manifest: manifest.clone(),
    };

    // Write plugin.json to disk — required so export_plugin can zip it correctly
    let manifest_json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    std::fs::write(plugin_dir.join("plugin.json"), manifest_json).map_err(|e| e.to_string())?;

    {
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        data.installed_plugins.retain(|p| p.manifest.id != manifest.id);
        data.installed_plugins.push(installed.clone());
    }
    let _ = state.save();
    log_line(format!("[PLUGINS] Created local plugin '{}'", manifest.id));
    Ok(installed)
}

// ── Open plugin folder in Explorer ────────────────────────────────────────

#[tauri::command]
pub fn open_plugin_folder(state: State<'_, AppState>, plugin_id: String) -> Result<(), String> {
    let install_dir = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        data.installed_plugins.iter()
            .find(|p| p.manifest.id == plugin_id)
            .map(|p| p.install_dir.clone())
    };
    let dir = install_dir.ok_or_else(|| format!("Plugin '{}' not found", plugin_id))?;
    crate::commands::mods::open_folder(dir)
}

// ── Run plugin scripts (UNSAFE — gated by permission + confirmation in UI) ──

/// Launch the external scripts bundled with a plugin. This executes arbitrary
/// code, so the frontend must only call it after the user granted the "unsafe
/// plugins" permission AND confirmed. Returns the list of scripts launched.
/// Extensions that are actually executable as plugin scripts.
fn is_runnable_script(ext: &str) -> bool {
    matches!(ext, "bat" | "cmd" | "ps1" | "vbs")
}

#[tauri::command]
pub fn run_plugin_scripts(
    state: State<'_, AppState>,
    plugin_id: String,
    script: Option<String>,
) -> Result<Vec<String>, String> {
    let (install_dir, scripts) = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        let p = data.installed_plugins.iter()
            .find(|p| p.manifest.id == plugin_id)
            .ok_or_else(|| format!("Plugin '{}' not found", plugin_id))?;
        (p.install_dir.clone(), p.manifest.scripts.clone())
    };
    if scripts.is_empty() {
        return Err("This plugin has no scripts.".to_string());
    }
    let base = PathBuf::from(&install_dir);

    // Determine which scripts to run: the chosen one (if given & valid) or all
    // runnable ones. Only .bat/.cmd/.ps1/.vbs are ever executed.
    let to_run: Vec<String> = match script {
        Some(sel) => {
            if !scripts.iter().any(|s| s == &sel) {
                return Err(format!("Script '{}' is not part of this plugin.", sel));
            }
            vec![sel]
        }
        None => scripts.clone(),
    };

    let mut launched: Vec<String> = Vec::new();
    for rel in &to_run {
        let path = base.join(rel);
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        if !is_runnable_script(&ext) {
            log_line(format!("[PLUGINS] Skipped non-runnable script (only .bat/.ps1/.vbs run): {}", rel));
            continue;
        }
        if !path.exists() {
            log_line(format!("[PLUGINS] Script missing, skipped: {}", rel));
            continue;
        }
        let p_str = path.to_string_lossy().to_string();

        #[cfg(target_os = "windows")]
        let spawn = match ext.as_str() {
            "ps1" => std::process::Command::new("powershell")
                .args(["-ExecutionPolicy", "Bypass", "-File", &p_str]).spawn(),
            "vbs" => std::process::Command::new("wscript").arg(&p_str).spawn(),
            _      => std::process::Command::new("cmd").args(["/C", "start", "", &p_str]).spawn(),
        };
        #[cfg(not(target_os = "windows"))]
        let spawn = std::process::Command::new("sh").arg(&p_str).spawn();

        match spawn {
            Ok(_) => { launched.push(rel.clone()); log_line(format!("[PLUGINS] Ran script '{}' for plugin '{}'", rel, plugin_id)); }
            Err(e) => { log_line(format!("[PLUGINS] Failed to run script '{}': {}", rel, e)); }
        }
    }
    Ok(launched)
}

// ── Compute SHA-256 of all files in plugin directory ─────────────────────

#[tauri::command]
pub fn compute_plugin_checksum(state: State<'_, AppState>, plugin_id: String) -> Result<String, String> {
    let install_dir = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        data.installed_plugins.iter()
            .find(|p| p.manifest.id == plugin_id)
            .map(|p| p.install_dir.clone())
    };
    let dir = install_dir.ok_or_else(|| format!("Plugin '{}' not found", plugin_id))?;
    let dir_path = std::path::PathBuf::from(&dir);

    // Collect all files sorted for deterministic hash
    let mut files: Vec<std::path::PathBuf> = Vec::new();
    fn collect_files(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
        if let Ok(entries) = std::fs::read_dir(dir) {
            let mut sorted: Vec<_> = entries.filter_map(|e| e.ok()).collect();
            sorted.sort_by_key(|e| e.path());
            for entry in sorted {
                let path = entry.path();
                if path.is_dir() { collect_files(&path, out); }
                else { out.push(path); }
            }
        }
    }
    collect_files(&dir_path, &mut files);

    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    for file_path in &files {
        let data = std::fs::read(file_path).map_err(|e| e.to_string())?;
        hasher.update(&data);
    }
    let result = hasher.finalize();
    Ok(format!("{:x}", result))
}
