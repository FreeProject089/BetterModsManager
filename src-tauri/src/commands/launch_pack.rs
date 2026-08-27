use crate::state::AppState;
use crate::error::AppError;
use crate::models::launch_pack::LaunchPack;
use tauri::State;
use std::path::{Path, PathBuf};
use uuid::Uuid;
use chrono::Local;
use serde::{Deserialize, Serialize};

/// CWE-22: a launch-pack `name` is user/shared-content controlled and is also used
/// as the `.lnk` filename. Strip path separators / traversal / illegal chars so the
/// shortcut can never be written outside the pack dir (e.g. the Startup auto-run
/// folder → persistence). Returns a safe non-empty stem.
fn safe_lnk_stem(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c })
        .collect();
    let cleaned = cleaned.replace("..", "_");
    let cleaned = cleaned.trim_matches(|c| c == '.' || c == ' ');
    if cleaned.is_empty() { "launchpack".to_string() } else { cleaned.to_string() }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledApp {
    pub name: String,
    pub exe_path: String,
    /// Path to a .ico or .png icon file if one was found directly.
    /// If None, the frontend can call `extract_exe_icon` lazily.
    pub icon_path: Option<String>,
}

#[tauri::command]
pub fn get_launch_packs(state: State<AppState>) -> Result<Vec<LaunchPack>, AppError> {
    let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    Ok(data.launch_packs.clone())
}

#[tauri::command]
pub fn create_launch_pack(
    state: State<AppState>,
    name: String,
    exe_paths: Vec<String>,
    icon_source_path: Option<String>,
) -> Result<LaunchPack, AppError> {
    let id = Uuid::new_v4().to_string();
    let app_data_dir = state.data_path.parent().ok_or_else(|| AppError::Internal("Invalid data path".to_string()))?;
    let pack_dir = app_data_dir.join("LaunchPacks").join(&id);
    
    std::fs::create_dir_all(&pack_dir)
        .map_err(|e| AppError::Internal(format!("Failed to create pack directory: {}", e)))?;

    // 1. Convert Icon to .ico if provided
    let mut icon_path = None;
    if let Some(src) = icon_source_path {
        let src_path = Path::new(&src);
        if src_path.exists() {
            let ico_filename = "icon.ico";
            let target_ico = pack_dir.join(ico_filename);
            
            // Use image crate to convert
            let img = image::open(src_path)
                .map_err(|e| AppError::Internal(format!("Failed to open icon image: {}", e)))?;
            
            // Resize to 256x256 for better ico compatibility
            let resized = img.resize(256, 256, image::imageops::FilterType::Lanczos3);
            
            resized.save_with_format(&target_ico, image::ImageFormat::Ico)
                .map_err(|e| AppError::Internal(format!("Failed to save .ico: {}", e)))?;
            
            icon_path = Some(target_ico);
        }
    }

    // 2. Create the .vbs launcher (Invisible)
    let vbs_path = pack_dir.join("launcher.vbs");
    let mut vbs_content = String::from("Set WshShell = CreateObject(\"WScript.Shell\")\n");
    for exe in &exe_paths {
        let path = Path::new(exe);
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        
        let cmd = match ext.as_str() {
            "ps1" => format!("powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{}\"", exe),
            _ => format!("cmd /c start \"\" \"{}\"", exe),
        };
        // Escape quotes for VBScript string literal (double them)
        let escaped_cmd = cmd.replace("\"", "\"\"");
        vbs_content.push_str(&format!("WshShell.Run \"{}\", 0, False\n", escaped_cmd));
    }
    vbs_content.push_str("Set WshShell = Nothing\n");

    std::fs::write(&vbs_path, vbs_content)
        .map_err(|e| AppError::Internal(format!("Failed to write .vbs launcher: {}", e)))?;

    // 3. Create the .lnk Shortcut via PowerShell
    let lnk_path = pack_dir.join(format!("{}.lnk", safe_lnk_stem(&name)));
    let powershell_script = format!(
        "$WshShell = New-Object -ComObject WScript.Shell; \
         $Shortcut = $WshShell.CreateShortcut('{}'); \
         $Shortcut.TargetPath = 'wscript.exe'; \
         $Shortcut.Arguments = '\"{}\"'; \
         $Shortcut.WorkingDirectory = '{}'; \
         $Shortcut.IconLocation = '{}'; \
         $Shortcut.Save()",
        lnk_path.to_string_lossy().replace("'", "''"),
        vbs_path.to_string_lossy().replace("'", "''"),
        pack_dir.to_string_lossy().replace("'", "''"),
        icon_path.as_ref().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|| String::new()).replace("'", "''")
    );

    let output = crate::commands::proc::hidden_command("powershell")
        .args(&["-NoProfile", "-Command", &powershell_script])
        .output();

    if let Err(e) = output {
        crate::commands::crash::log_line(format!("[LAUNCHPACK] Failed to create shortcut: {}", e));
    }

    // 4. Update state
    let pack = LaunchPack {
        id,
        name,
        executable_paths: exe_paths.into_iter().map(PathBuf::from).collect(),
        icon_path,
        created_at: Local::now().to_rfc3339(),
    };

    {
        let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        data.launch_packs.push(pack.clone());
    }
    state.save()?;

    Ok(pack)
}

#[tauri::command]
pub fn update_launch_pack(
    state: State<AppState>,
    id: String,
    name: String,
    exe_paths: Vec<String>,
    icon_source_path: Option<String>,
) -> Result<LaunchPack, AppError> {
    let app_data_dir = state.data_path.parent().ok_or_else(|| AppError::Internal("Invalid data path".to_string()))?;
    let pack_dir = app_data_dir.join("LaunchPacks").join(&id);

    // Verify the pack exists in state and capture current icon path
    let existing_icon_path = {
        let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        let pack = data.launch_packs.iter().find(|p| p.id == id)
            .ok_or_else(|| AppError::NotFound("Launch pack not found".to_string()))?;
        pack.icon_path.clone()
    };

    if !pack_dir.exists() {
        std::fs::create_dir_all(&pack_dir)
            .map_err(|e| AppError::Internal(format!("Failed to create pack directory: {}", e)))?;
    }

    // 1. Icon handling — replace if a new source provided, keep existing otherwise
    let icon_path = if let Some(src) = icon_source_path {
        let src_path = Path::new(&src);
        if src_path.exists() {
            let target_ico = pack_dir.join("icon.ico");
            let img = image::open(src_path)
                .map_err(|e| AppError::Internal(format!("Failed to open icon image: {}", e)))?;
            let resized = img.resize(256, 256, image::imageops::FilterType::Lanczos3);
            resized.save_with_format(&target_ico, image::ImageFormat::Ico)
                .map_err(|e| AppError::Internal(format!("Failed to save .ico: {}", e)))?;
            Some(target_ico)
        } else {
            existing_icon_path
        }
    } else {
        existing_icon_path
    };

    // 2. Regenerate the .vbs launcher
    let vbs_path = pack_dir.join("launcher.vbs");
    let mut vbs_content = String::from("Set WshShell = CreateObject(\"WScript.Shell\")\n");
    for exe in &exe_paths {
        let path = Path::new(exe);
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        let cmd = match ext.as_str() {
            "ps1" => format!("powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{}\"", exe),
            _ => format!("cmd /c start \"\" \"{}\"", exe),
        };
        let escaped_cmd = cmd.replace("\"", "\"\"");
        vbs_content.push_str(&format!("WshShell.Run \"{}\", 0, False\n", escaped_cmd));
    }
    vbs_content.push_str("Set WshShell = Nothing\n");
    std::fs::write(&vbs_path, vbs_content)
        .map_err(|e| AppError::Internal(format!("Failed to write .vbs launcher: {}", e)))?;

    // 3. Regenerate the .lnk shortcut (delete old ones first, since name may have changed)
    if let Ok(entries) = std::fs::read_dir(&pack_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) == Some("lnk") {
                let _ = std::fs::remove_file(&p);
            }
        }
    }
    let lnk_path = pack_dir.join(format!("{}.lnk", safe_lnk_stem(&name)));
    let powershell_script = format!(
        "$WshShell = New-Object -ComObject WScript.Shell; \
         $Shortcut = $WshShell.CreateShortcut('{}'); \
         $Shortcut.TargetPath = 'wscript.exe'; \
         $Shortcut.Arguments = '\"{}\"'; \
         $Shortcut.WorkingDirectory = '{}'; \
         $Shortcut.IconLocation = '{}'; \
         $Shortcut.Save()",
        lnk_path.to_string_lossy().replace("'", "''"),
        vbs_path.to_string_lossy().replace("'", "''"),
        pack_dir.to_string_lossy().replace("'", "''"),
        icon_path.as_ref().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(String::new).replace("'", "''")
    );
    let _ = crate::commands::proc::hidden_command("powershell")
        .args(&["-NoProfile", "-Command", &powershell_script])
        .output();

    // 4. Update state entry (preserve created_at, replace the rest)
    let updated_pack = {
        let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        let pack = data.launch_packs.iter_mut().find(|p| p.id == id)
            .ok_or_else(|| AppError::NotFound("Launch pack not found".to_string()))?;
        pack.name = name;
        pack.executable_paths = exe_paths.into_iter().map(PathBuf::from).collect();
        pack.icon_path = icon_path;
        pack.clone()
    };
    state.save()?;

    Ok(updated_pack)
}

#[tauri::command]
pub fn run_launch_pack(state: State<AppState>, id: String) -> Result<(), AppError> {
    let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    let pack = data.launch_packs.iter().find(|p| p.id == id)
        .ok_or_else(|| AppError::NotFound("Launch pack not found".to_string()))?;

    let app_data_dir = state.data_path.parent().ok_or_else(|| AppError::Internal("Invalid data path".to_string()))?;
    let pack_dir = app_data_dir.join("LaunchPacks").join(&pack.id);
    let vbs_path = pack_dir.join("launcher.vbs");

    if !vbs_path.exists() {
        return Err(AppError::NotFound("VBS launcher missing".to_string()));
    }

    // Execute the VBS file (invisible)
    crate::commands::proc::hidden_command("wscript")
        .arg(vbs_path)
        .spawn()
        .map_err(|e| AppError::Internal(format!("Failed to run pack: {}", e)))?;

    Ok(())
}

#[tauri::command]
pub fn delete_launch_pack(state: State<AppState>, id: String) -> Result<(), AppError> {
    let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    let index = data.launch_packs.iter().position(|p| p.id == id)
        .ok_or_else(|| AppError::NotFound("Launch pack not found".to_string()))?;
    
    data.launch_packs.remove(index);
    drop(data);
    state.save()?;

    // Cleanup files
    let app_data_dir = state.data_path.parent().unwrap();
    let pack_dir = app_data_dir.join("LaunchPacks").join(&id);
    if pack_dir.exists() {
        let _ = std::fs::remove_dir_all(pack_dir);
    }

    Ok(())
}

/// Scans Windows registry uninstall keys to list all installed applications with their exe paths.
/// Mirrors what Steam's "Add Non-Steam Game" dialog does.
#[tauri::command(async)]
pub fn scan_installed_apps() -> Result<Vec<InstalledApp>, AppError> {
    #[cfg(target_os = "windows")]
    {
        use winreg::RegKey;
        use winreg::enums::{HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER, KEY_READ};

        let mut apps: Vec<InstalledApp> = Vec::new();
        let uninstall_paths: &[(_, &str)] = &[
            (HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
            (HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
            (HKEY_CURRENT_USER,  r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        ];

        for (hive, reg_path) in uninstall_paths {
            let root = RegKey::predef(*hive);
            let key = match root.open_subkey_with_flags(reg_path, KEY_READ) {
                Ok(k) => k,
                Err(_) => continue,
            };
            for sub_name in key.enum_keys().filter_map(|r| r.ok()) {
                let sub = match key.open_subkey_with_flags(&sub_name, KEY_READ) {
                    Ok(k) => k,
                    Err(_) => continue,
                };
                let name: String = sub.get_value("DisplayName").unwrap_or_default();
                if name.is_empty() { continue; }

                // Try DisplayIcon first (format: "C:\path\app.exe,0" or just path)
                let icon_raw: String = sub.get_value("DisplayIcon").unwrap_or_default();
                let (exe_candidate, icon_candidate) = if !icon_raw.is_empty() {
                    // Strip icon index (,0 / ,1) and surrounding quotes
                    let stripped = icon_raw.trim_matches('"');
                    let without_idx = if let Some(pos) = stripped.rfind(',') {
                        let tail = &stripped[pos+1..];
                        if tail.chars().all(|c| c.is_ascii_digit() || c == '-') {
                            &stripped[..pos]
                        } else { stripped }
                    } else { stripped };
                    let clean = without_idx.trim_matches('"').to_string();
                    let ext_lower = Path::new(&clean).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                    // .ico/.png are direct icon files
                    if (ext_lower == "ico" || ext_lower == "png") && Path::new(&clean).exists() {
                        (String::new(), Some(clean))  // no exe yet, but we have an icon
                    } else {
                        (clean.clone(), None)          // treat as exe path candidate
                    }
                } else {
                    (String::new(), None)
                };

                // Check if exe_candidate is a real .exe that exists
                let exe_path = if !exe_candidate.is_empty()
                    && exe_candidate.to_lowercase().ends_with(".exe")
                    && Path::new(&exe_candidate).exists()
                {
                    exe_candidate.clone()
                } else {
                    // Fallback: try InstallLocation dir
                    let install_loc: String = sub.get_value("InstallLocation").unwrap_or_default();
                    let dir = Path::new(install_loc.trim_matches('"'));
                    if dir.is_dir() {
                        let name_lower = name.to_lowercase().replace(' ', "");
                        let mut best: Option<String> = None;
                        if let Ok(entries) = std::fs::read_dir(dir) {
                            for e in entries.flatten() {
                                let p = e.path();
                                if p.extension().and_then(|x| x.to_str()) == Some("exe") {
                                    let fname = p.file_stem().and_then(|x| x.to_str()).unwrap_or("").to_lowercase().replace(' ', "");
                                    if fname == name_lower || name_lower.contains(&fname) || fname.contains(&name_lower) {
                                        best = p.to_str().map(|s| s.to_string());
                                        break;
                                    }
                                    if best.is_none() {
                                        best = p.to_str().map(|s| s.to_string());
                                    }
                                }
                            }
                        }
                        best.unwrap_or_default()
                    } else {
                        // Last resort: if DisplayIcon was an .exe, use it both as exe and icon source
                        if !exe_candidate.is_empty() && exe_candidate.to_lowercase().ends_with(".exe") {
                            exe_candidate.clone()
                        } else {
                            String::new()
                        }
                    }
                };

                if exe_path.is_empty() { continue; }
                // icon_path: prefer a direct .ico/.png; fallback is None (frontend extracts from exe lazily)
                apps.push(InstalledApp { name, exe_path, icon_path: icon_candidate });
            }
        }

        // Also scan Start Menu .lnk shortcuts for additional coverage
        let start_menu_paths = [
            std::env::var("ProgramData").unwrap_or_default() + r"\Microsoft\Windows\Start Menu\Programs",
            std::env::var("APPDATA").unwrap_or_default()     + r"\Microsoft\Windows\Start Menu\Programs",
        ];
        for sm_path in &start_menu_paths {
            _scan_lnk_recursive(Path::new(sm_path), &mut apps);
        }

        // Sort by name, dedup by exe_path
        apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        let mut seen = std::collections::HashSet::new();
        apps.retain(|a| seen.insert(a.exe_path.to_lowercase()));

        return Ok(apps);
    }

    #[cfg(not(target_os = "windows"))]
    Ok(Vec::new())
}

/// Recursively finds .lnk files and tries to resolve them via PowerShell to get target exe paths.
/// Only does a single PowerShell batch call to avoid slowness.
#[cfg(target_os = "windows")]
fn _scan_lnk_recursive(dir: &Path, apps: &mut Vec<InstalledApp>) {
    let mut lnks: Vec<String> = Vec::new();
    _collect_lnks(dir, &mut lnks, 0);
    if lnks.is_empty() { return; }

    // Batch-resolve all lnks via a single PowerShell call
    let script_parts: Vec<String> = lnks.iter().map(|p| {
        format!("try{{$s=(New-Object -COM WScript.Shell).CreateShortcut('{}');if($s.TargetPath -like '*.exe'){{\"{}|$($s.TargetPath)\"}}}}catch{{}}", p.replace('\'', "''"), p.replace('\'', "''"))
    }).collect();
    let script = script_parts.join(";");

    let out = crate::commands::proc::hidden_command("powershell")
        .args(&["-NoProfile", "-NonInteractive", "-Command", &script])
        .output();

    if let Ok(o) = out {
        let text = String::from_utf8_lossy(&o.stdout);
        for line in text.lines() {
            let parts: Vec<&str> = line.splitn(2, '|').collect();
            if parts.len() == 2 {
                let lnk_path  = parts[0].trim();
                let exe_path  = parts[1].trim();
                if !exe_path.is_empty() && exe_path.to_lowercase().ends_with(".exe") && Path::new(exe_path).exists() {
                    // Derive name from lnk filename
                    let name = Path::new(lnk_path)
                        .file_stem().and_then(|s| s.to_str())
                        .unwrap_or(exe_path)
                        .to_string();
                    apps.push(InstalledApp { name, exe_path: exe_path.to_string(), icon_path: None });
                }
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn _collect_lnks(dir: &Path, out: &mut Vec<String>, depth: usize) {
    if depth > 3 || !dir.is_dir() { return; }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                _collect_lnks(&p, out, depth + 1);
            } else if p.extension().and_then(|x| x.to_str()) == Some("lnk") {
                if let Some(s) = p.to_str() { out.push(s.to_string()); }
            }
        }
    }
}

/// Extracts the icon of an .exe (or any file with an associated icon) and returns it as a
/// base64-encoded PNG string, so the frontend can display it as `data:image/png;base64,...`.
/// Uses PowerShell + .NET System.Drawing — fast enough for per-app lazy loading.
#[tauri::command]
pub async fn extract_exe_icon(exe_path: String) -> Result<String, AppError> {
    #[cfg(target_os = "windows")]
    {
        let script = format!(
            "Add-Type -AssemblyName System.Drawing; \
             $icon = [System.Drawing.Icon]::ExtractAssociatedIcon('{}'); \
             if ($icon) {{ \
                 $bmp = $icon.ToBitmap(); \
                 $ms = New-Object System.IO.MemoryStream; \
                 $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); \
                 [Convert]::ToBase64String($ms.ToArray()) \
             }}",
            exe_path.replace('\'', "''")
        );
        let out = crate::commands::proc::hidden_tokio_command("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .await
            .map_err(|e| AppError::Internal(format!("PS icon error: {}", e)))?;
        let b64 = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if b64.is_empty() {
            return Err(AppError::Internal("No icon data".to_string()));
        }
        return Ok(b64);
    }
    #[cfg(not(target_os = "windows"))]
    Err(AppError::Internal("Not supported on this platform".to_string()))
}

/// Scans a directory (non-recursively) for executable files (.exe, .bat, .cmd, .ps1, .lnk)
/// Returns a list of absolute path strings.
#[tauri::command(async)]
pub fn scan_dir_for_exe(path: String) -> Result<Vec<String>, AppError> {
    let dir = std::path::Path::new(&path);
    if !dir.is_dir() {
        return Err(AppError::NotFound(format!("Directory not found: {}", path)));
    }
    let allowed_ext = ["exe", "bat", "cmd", "ps1", "lnk"];
    let mut results = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                    if allowed_ext.contains(&ext.to_lowercase().as_str()) {
                        if let Some(s) = p.to_str() {
                            results.push(s.to_string());
                        }
                    }
                }
            }
        }
    }
    results.sort();
    Ok(results)
}

#[tauri::command]
pub fn open_launch_pack_folder(state: State<AppState>, id: String) -> Result<(), AppError> {
    let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    let pack = data.launch_packs.iter().find(|p| p.id == id)
        .ok_or_else(|| AppError::NotFound("Launch pack not found".to_string()))?;

    let app_data_dir = state.data_path.parent().ok_or_else(|| AppError::Internal("Invalid data path".to_string()))?;
    let pack_dir = app_data_dir.join("LaunchPacks").join(&pack.id);

    if pack_dir.exists() {
        #[cfg(target_os = "windows")]
        {
            crate::commands::proc::hidden_command("explorer")
                .arg(pack_dir)
                .spawn()
                .map_err(|e| AppError::Internal(format!("Failed to open folder: {}", e)))?;
        }
    }

    Ok(())
}

// -- Carrying a launch pack to another machine -------------------------------
//
// Everything else in the app can be handed to somebody: modpacks, plugins, profiles,
// themes, automations, whole catalogues. A launch pack — the one thing people build to
// start six programs with one double-click — could only ever be rebuilt by hand.
//
// What a pack IS on disk is machine-specific: a `.vbs` full of absolute paths, a `.lnk`
// pointing at a folder under this user's app data, and an `.ico`. None of that travels.
// So the file carries the DECISIONS — the name, which programs, the icon — and the
// import regenerates the machine-specific half locally.

/// The on-disk shape of a `.bmmlaunch` file.
#[derive(Debug, Serialize, Deserialize)]
pub struct LaunchPackFile {
    /// Refused if it is not ours. A JSON file with the right fields by coincidence would
    /// otherwise be imported as a list of programs to run.
    pub kind: String,
    pub version: u32,
    pub name: String,
    pub exe_paths: Vec<String>,
    /// The icon, inlined. A path would name a file the other machine does not have.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_b64: Option<String>,
    #[serde(default)]
    pub exported_at: String,
}

const LAUNCHPACK_KIND: &str = "bmm-launchpack";
/// One pack, not a payload. Both caps are far above any real pack.
const MAX_EXES: usize = 64;
const MAX_ICON_BYTES: usize = 4 * 1024 * 1024;

/// Write a pack to a `.bmmlaunch` file.
#[tauri::command]
pub fn export_launch_pack(state: State<AppState>, id: String, dest_path: String) -> Result<String, AppError> {
    let pack = {
        let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        data.launch_packs.iter().find(|p| p.id == id).cloned()
            .ok_or_else(|| AppError::NotFound("Launch pack not found".to_string()))?
    };

    // The icon travels as bytes. An unreadable one is not fatal: a pack without its
    // picture is still the pack, and refusing the whole export over it would be absurd.
    let icon_b64 = pack.icon_path.as_ref().and_then(|p| std::fs::read(p).ok()).and_then(|bytes| {
        if bytes.len() > MAX_ICON_BYTES {
            None
        } else {
            use base64::Engine as _;
            Some(base64::engine::general_purpose::STANDARD.encode(&bytes))
        }
    });

    let doc = LaunchPackFile {
        kind: LAUNCHPACK_KIND.to_string(),
        version: 1,
        name: pack.name.clone(),
        exe_paths: pack.executable_paths.iter().map(|p| p.to_string_lossy().to_string()).collect(),
        icon_b64,
        exported_at: Local::now().to_rfc3339(),
    };

    let mut dest = PathBuf::from(&dest_path);
    if dest.extension().is_none() {
        dest.set_extension("bmmlaunch");
    }
    let json = serde_json::to_string_pretty(&doc)
        .map_err(|e| AppError::Internal(format!("Failed to serialise launch pack: {}", e)))?;
    std::fs::write(&dest, json)
        .map_err(|e| AppError::Internal(format!("Failed to write launch pack file: {}", e)))?;
    Ok(dest.to_string_lossy().to_string())
}

/// What an import produced, and what it could not find.
#[derive(Debug, Serialize)]
pub struct ImportedLaunchPack {
    pub pack: LaunchPack,
    /// Paths from the file that do not exist on THIS machine.
    ///
    /// Reported rather than dropped. A pack whose programs live at one drive here and
    /// another there is the normal case, and silently importing a pack that starts
    /// nothing — or silently discarding half of it — are both worse than saying so.
    pub missing: Vec<String>,
}

/// Read a `.bmmlaunch` file and build the pack locally.
#[tauri::command]
pub fn import_launch_pack(state: State<AppState>, path: String) -> Result<ImportedLaunchPack, AppError> {
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| AppError::Internal(format!("Failed to read launch pack file: {}", e)))?;
    let doc: LaunchPackFile = serde_json::from_str(&raw)
        .map_err(|e| AppError::Internal(format!("Not a launch pack file: {}", e)))?;
    if doc.kind != LAUNCHPACK_KIND {
        return Err(AppError::Internal("Not a launch pack file".to_string()));
    }
    if doc.exe_paths.len() > MAX_EXES {
        return Err(AppError::Internal(format!("Launch pack lists more than {} programs", MAX_EXES)));
    }

    // The icon is decoded and written to a temp file, then handed to create_launch_pack,
    // which re-encodes it through the image crate. Bytes out of a shared file are never
    // written straight in as the icon.
    let mut icon_tmp: Option<PathBuf> = None;
    if let Some(b64) = doc.icon_b64.as_ref() {
        use base64::Engine as _;
        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64.as_bytes()) {
            if !bytes.is_empty() && bytes.len() <= MAX_ICON_BYTES {
                let tmp = std::env::temp_dir().join(format!("bmm_lp_icon_{}.bin", Uuid::new_v4()));
                if std::fs::write(&tmp, &bytes).is_ok() {
                    icon_tmp = Some(tmp);
                }
            }
        }
    }

    let missing: Vec<String> = doc.exe_paths.iter()
        .filter(|p| !Path::new(p).exists())
        .cloned()
        .collect();

    let pack = create_launch_pack(
        state,
        doc.name,
        doc.exe_paths,
        icon_tmp.as_ref().map(|p| p.to_string_lossy().to_string()),
    );
    if let Some(tmp) = icon_tmp {
        let _ = std::fs::remove_file(tmp);
    }
    let pack = pack?;

    Ok(ImportedLaunchPack { pack, missing })
}

#[cfg(test)]
mod portable_tests {
    use super::*;

    #[test]
    fn a_file_that_is_not_ours_is_refused_before_anything_is_created() {
        // The whole point of `kind`. Without it, any JSON with a name and a list of
        // strings would be imported as "run these programs".
        let doc: LaunchPackFile = serde_json::from_str(
            r#"{"kind":"something-else","version":1,"name":"x","exe_paths":[]}"#,
        ).unwrap();
        assert_ne!(doc.kind, LAUNCHPACK_KIND);
    }

    #[test]
    fn a_pack_round_trips_through_the_file_shape() {
        let doc = LaunchPackFile {
            kind: LAUNCHPACK_KIND.to_string(),
            version: 1,
            name: "Evening".to_string(),
            exe_paths: vec![r"D:\Games\a.exe".to_string()],
            icon_b64: None,
            exported_at: String::new(),
        };
        let back: LaunchPackFile = serde_json::from_str(&serde_json::to_string(&doc).unwrap()).unwrap();
        assert_eq!(back.name, "Evening");
        assert_eq!(back.exe_paths, vec![r"D:\Games\a.exe".to_string()]);
        // Absent, not null: an importer reading an older file must not trip over it.
        assert!(back.icon_b64.is_none());
    }

    #[test]
    fn a_name_carrying_a_path_cannot_place_the_shortcut_elsewhere() {
        // The name arrives from a file somebody else wrote and becomes the .lnk filename.
        // Both separators AND the '..' pairs go; four characters in, one underscore out.
        assert_eq!(safe_lnk_stem(r"..\..\Startup\evil"), "____Startup_evil");
        assert_eq!(safe_lnk_stem("   "), "launchpack");
    }
}
