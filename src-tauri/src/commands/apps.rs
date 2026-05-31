use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use crate::models::app_catalog::*;
use crate::commands::crash::log_line;

// ── State persistence ─────────────────────────────────────────────────────────

fn state_path(app: &AppHandle) -> std::path::PathBuf {
    app.path_resolver()
        .app_data_dir()
        .unwrap_or_default()
        .join("apps_state.json")
}

fn load_state(app: &AppHandle) -> AppsState {
    let path = state_path(app);
    if !path.exists() { return AppsState::default(); }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_state(app: &AppHandle, state: &AppsState) -> Result<(), String> {
    let path = state_path(app);
    let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

fn is_leap(year: u64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn now_iso() -> String {
    let total_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let h = (total_secs % 86400) / 3600;
    let m = (total_secs % 3600) / 60;
    let s =  total_secs % 60;

    let mut year: u64 = 1970;
    let mut days = total_secs / 86400;
    loop {
        let y = if is_leap(year) { 366 } else { 365 };
        if days < y { break; }
        days -= y;
        year += 1;
    }
    let month_lens: [u64; 12] = [31, if is_leap(year) { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut month: u64 = 1;
    for &ml in &month_lens {
        if days < ml { break; }
        days -= ml;
        month += 1;
    }
    format!("{}-{:02}-{:02} {:02}:{:02}:{:02} UTC", year, month, days + 1, h, m, s)
}

fn push_history(state: &mut AppsState, action: &str, app_id: &str, title: &str) {
    state.history.push(AppHistoryEntry {
        action: action.to_string(),
        app_id: app_id.to_string(),
        app_title: title.to_string(),
        timestamp: now_iso(),
    });
    // Keep last 200 entries
    if state.history.len() > 200 {
        state.history = state.history.split_off(state.history.len() - 200);
    }
}

// ── Catalog fetching ──────────────────────────────────────────────────────────
//
// Trust chain (badges are assigned by SOURCE, never by what the JSON claims):
//
//   Tier 0 — Official (links.json → apps_catalog URL)
//     → official = true, partner = false
//     → its partner_catalogs list defines Tier 1
//     → its community_imports are treated as Tier 2
//
//   Tier 1 — Partner (URL listed in official catalog.partner_catalogs)
//     → official = false, partner = true
//     → their community_imports are treated as Tier 2
//
//   Tier 2 — Community (community_imports + user-added sources)
//     → official = false, partner = false (stripped regardless of JSON content)

async fn fetch_raw_catalog(client: &reqwest::Client, url: &str) -> Option<AppCatalog> {
    let bust = format!("{}?t={}", url,
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs());
    let resp = client.get(&bust).send().await.ok()?;
    if !resp.status().is_success() { return None; }
    resp.json::<AppCatalog>().await.ok()
}

fn apply_trust(apps: &mut Vec<AppEntry>, is_official: bool, is_partner: bool, source_url: &str) {
    for app in apps.iter_mut() {
        // Override whatever the JSON says — trust comes from the source URL only
        app.official     = Some(is_official);
        app.partner      = Some(is_partner && !is_official);
        app.source_label = Some(source_url.to_string());
        // Cap tags at 3 to prevent abuse
        app.tags.truncate(3);
    }
}

#[tauri::command]
pub async fn fetch_app_catalogs(
    catalog_url: String,
    extra_community_urls: Vec<String>,
) -> Result<MergedCatalog, String> {
    let client = reqwest::Client::builder()
        .user_agent("BetterModsManager/1.0")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let mut all_apps: Vec<AppEntry> = Vec::new();
    let mut sources_loaded: Vec<String> = Vec::new();
    let mut sources_failed: Vec<String> = Vec::new();
    let mut visited: std::collections::HashSet<String> = std::collections::HashSet::new();

    // ── Tier 0: Official catalog ──────────────────────────────────────────────
    visited.insert(catalog_url.clone());
    log_line(format!("[APPS] Fetching official catalog: {}", catalog_url));

    let mut partner_urls: Vec<String> = Vec::new();
    let mut community_urls: Vec<String> = extra_community_urls;

    match fetch_raw_catalog(&client, &catalog_url).await {
        Some(mut cat) => {
            apply_trust(&mut cat.apps, true, false, &catalog_url);
            sources_loaded.push(catalog_url.clone());

            // Official catalog is the ONLY source of partner trust
            if let Some(partners) = cat.partner_catalogs {
                partner_urls = partners;
            }
            // Community imports from official are Tier 2
            if let Some(imports) = cat.community_imports {
                community_urls.extend(imports);
            }

            all_apps.extend(cat.apps);
        }
        None => {
            log_line(format!("[APPS] Failed to fetch official catalog: {}", catalog_url));
            sources_failed.push(catalog_url.clone());
        }
    }

    // ── Tier 1: Partner catalogs (defined by official catalog only) ───────────
    for url in &partner_urls {
        if !visited.insert(url.clone()) { continue; }
        log_line(format!("[APPS] Fetching partner catalog: {}", url));
        match fetch_raw_catalog(&client, url).await {
            Some(mut cat) => {
                apply_trust(&mut cat.apps, false, true, url);
                sources_loaded.push(url.clone());
                // Partner catalogs may have community_imports too (Tier 2)
                if let Some(imports) = cat.community_imports {
                    community_urls.extend(imports);
                }
                all_apps.extend(cat.apps);
            }
            None => {
                log_line(format!("[APPS] Failed to fetch partner catalog: {}", url));
                sources_failed.push(url.clone());
            }
        }
    }

    // ── Tier 2: Community / user-added sources (no badge) ────────────────────
    let mut i = 0;
    while i < community_urls.len() && sources_loaded.len() < 30 {
        let url = community_urls[i].clone();
        i += 1;
        if !visited.insert(url.clone()) { continue; }
        log_line(format!("[APPS] Fetching community catalog: {}", url));
        match fetch_raw_catalog(&client, &url).await {
            Some(mut cat) => {
                apply_trust(&mut cat.apps, false, false, &url);
                sources_loaded.push(url.clone());
                // Community catalogs can chain (still Tier 2, no badge escalation)
                if let Some(imports) = cat.community_imports {
                    community_urls.extend(imports);
                }
                all_apps.extend(cat.apps);
            }
            None => {
                log_line(format!("[APPS] Failed to fetch community catalog: {}", url));
                sources_failed.push(url.clone());
            }
        }
    }

    // Deduplicate by id (higher-tier wins — official first, then partner, then community)
    let mut seen_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    all_apps.retain(|a| seen_ids.insert(a.id.clone()));

    log_line(format!("[APPS] Merged: {} apps | {} sources OK | {} failed",
        all_apps.len(), sources_loaded.len(), sources_failed.len()));

    Ok(MergedCatalog { apps: all_apps, sources_loaded, sources_failed })
}

// ── Installation ──────────────────────────────────────────────────────────────

/// Common locations where Windows installers drop programs.
fn common_install_roots() -> Vec<std::path::PathBuf> {
    let mut roots = Vec::new();
    for var in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Ok(p) = std::env::var(var) {
            roots.push(std::path::PathBuf::from(p));
        }
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        roots.push(std::path::PathBuf::from(&local).join("Programs"));
    }
    roots
}

/// Snapshot the set of top-level folder names under each root.
fn snapshot_dirs(roots: &[std::path::PathBuf]) -> std::collections::HashSet<std::path::PathBuf> {
    let mut set = std::collections::HashSet::new();
    for root in roots {
        if let Ok(entries) = std::fs::read_dir(root) {
            for e in entries.flatten() {
                if e.path().is_dir() {
                    set.insert(e.path());
                }
            }
        }
    }
    set
}

/// Score how well an exe filename matches the app (higher = better).
fn match_score(exe_name: &str, app_id: &str, app_title: &str) -> i32 {
    let exe = exe_name.to_lowercase();
    let exe_stem = exe.trim_end_matches(".exe").replace([' ', '-', '_', '.'], "");
    let id = app_id.to_lowercase().replace([' ', '-', '_', '.'], "");
    let title = app_title.to_lowercase().replace([' ', '-', '_', '.'], "");

    let mut score = 0;
    if exe_stem == id || exe_stem == title { score += 100; }
    if exe_stem.contains(&id) || id.contains(&exe_stem) { score += 50; }
    if exe_stem.contains(&title) || title.contains(&exe_stem) { score += 50; }
    // Penalise uninstallers / helpers
    for bad in ["unins", "uninstall", "setup", "update", "crash", "report", "vc_redist", "redist"] {
        if exe.contains(bad) { score -= 200; }
    }
    score
}

/// After an installer runs, find the exe it created by diffing folder snapshots.
/// Returns the best-matching newly-created executable, if any.
fn auto_detect_installed_exe(
    before: &std::collections::HashSet<std::path::PathBuf>,
    app_id: &str,
    app_title: &str,
) -> Option<ExeInfo> {
    let roots = common_install_roots();
    let after = snapshot_dirs(&roots);

    // New top-level folders created by the installer
    let new_dirs: Vec<&std::path::PathBuf> = after.difference(before).collect();

    let mut candidates: Vec<ExeInfo> = Vec::new();
    for dir in new_dirs {
        candidates.extend(detect_executables_in(dir));
    }

    if candidates.is_empty() { return None; }

    // Pick by match score, then by size (largest = main app)
    candidates.sort_by(|a, b| {
        let sa = match_score(&a.name, app_id, app_title);
        let sb = match_score(&b.name, app_id, app_title);
        sb.cmp(&sa).then(b.size.cmp(&a.size))
    });

    // Reject if best candidate is clearly an uninstaller/helper
    let best = candidates.into_iter().next()?;
    if match_score(&best.name, app_id, app_title) <= -100 { return None; }
    Some(best)
}

/// What we can learn about a setup-installed app from the Windows registry.
#[derive(Default, Clone)]
struct RegAppInfo {
    install_location: Option<String>,
    exe: Option<String>,            // main launch exe (from DisplayIcon)
    uninstall_string: Option<String>,
}

/// Strip the icon-index suffix (",0") and surrounding quotes from a DisplayIcon value.
fn clean_icon_path(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    if let Some(idx) = s.rfind(',') {
        // Only strip if what follows the comma is a number (icon index)
        if s[idx + 1..].trim().chars().all(|c| c.is_ascii_digit() || c == '-') {
            s.truncate(idx);
        }
    }
    s.trim().trim_matches('"').to_string()
}

/// Search the Windows registry uninstall keys for an entry matching the app,
/// returning its install location, main exe (DisplayIcon) and uninstall command.
#[cfg(target_os = "windows")]
fn find_registry_app(app_id: &str, app_title: &str) -> Option<RegAppInfo> {
    use winreg::enums::*;
    use winreg::RegKey;

    let norm = |s: &str| s.to_lowercase().replace([' ', '-', '_', '.'], "");
    let id = norm(app_id);
    let title = norm(app_title);

    let roots = [
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_CURRENT_USER,  r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ];

    for (hive, path) in roots {
        let base = match RegKey::predef(hive).open_subkey(path) {
            Ok(k) => k,
            Err(_) => continue,
        };
        for sub_name in base.enum_keys().flatten() {
            let sub = match base.open_subkey(&sub_name) {
                Ok(s) => s,
                Err(_) => continue,
            };
            let display: String = sub.get_value("DisplayName").unwrap_or_default();
            if display.is_empty() { continue; }
            let dn = norm(&display);
            let matches = dn == title || dn == id
                || dn.contains(&title) || title.contains(&dn)
                || dn.contains(&id);
            if !matches { continue; }

            let quiet: String = sub.get_value("QuietUninstallString").unwrap_or_default();
            let normal: String = sub.get_value("UninstallString").unwrap_or_default();
            let uninstall = if !quiet.is_empty() { quiet } else { normal };

            let install_loc: String = sub.get_value("InstallLocation").unwrap_or_default();
            let icon: String = sub.get_value("DisplayIcon").unwrap_or_default();

            // DisplayIcon is the most reliable pointer to the main exe
            let exe = {
                let p = clean_icon_path(&icon);
                if p.to_lowercase().ends_with(".exe") && std::path::Path::new(&p).exists() {
                    Some(p)
                } else { None }
            };

            return Some(RegAppInfo {
                install_location: if install_loc.is_empty() { None } else { Some(install_loc) },
                exe,
                uninstall_string: if uninstall.is_empty() { None } else { Some(uninstall) },
            });
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn find_registry_app(_app_id: &str, _app_title: &str) -> Option<RegAppInfo> { None }

/// Split a Windows command string into (program, args).
/// Handles `"C:\path with spaces\app.exe" /arg1 /arg2` and `msiexec.exe /X{GUID}`.
fn parse_command(cmd: &str) -> (String, Vec<String>) {
    let cmd = cmd.trim();
    if cmd.starts_with('"') {
        // Program is the text between the first pair of quotes
        if let Some(end) = cmd[1..].find('"') {
            let program = cmd[1..1 + end].to_string();
            let rest = cmd[2 + end..].trim();
            let args = if rest.is_empty() { vec![] }
                       else { rest.split_whitespace().map(|s| s.to_string()).collect() };
            return (program, args);
        }
    }
    // No quotes: first token is program, rest are args
    let mut parts = cmd.splitn(2, ' ');
    let program = parts.next().unwrap_or("").to_string();
    let args = parts.next()
        .map(|r| r.split_whitespace().map(|s| s.to_string()).collect())
        .unwrap_or_default();
    (program, args)
}

/// Fallback uninstaller scan: a unins*.exe inside the install folder.
fn scan_folder_uninstaller(install_dir: &std::path::Path) -> Option<String> {
    if let Ok(entries) = std::fs::read_dir(install_dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_lowercase();
            if (name.starts_with("unins") || name.contains("uninstall")) && name.ends_with(".exe") {
                return Some(format!("\"{}\"", e.path().to_string_lossy()));
            }
        }
    }
    None
}

fn detect_executables_in(dir: &std::path::Path) -> Vec<ExeInfo> {
    let mut exes: Vec<ExeInfo> = walkdir::WalkDir::new(dir)
        .max_depth(4)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let p = e.path().to_path_buf();
            let ext = p.extension()?.to_str()?.to_lowercase();
            if ext != "exe" && ext != "msi" { return None; }
            let size = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            Some(ExeInfo {
                name: p.file_name().unwrap_or_default().to_string_lossy().to_string(),
                path: p.to_string_lossy().to_string(),
                size,
            })
        })
        .collect();
    exes.sort_by(|a, b| b.size.cmp(&a.size)); // largest first = main exe heuristic
    exes
}

/// True if a filename looks like an installer rather than the app itself.
fn looks_like_installer(name: &str) -> bool {
    let n = name.to_lowercase();
    n.ends_with(".msi")
        || n.contains("setup")
        || n.contains("install")   // installer, install, etc.
        || n.starts_with("vc_redist")
        || n.contains("redist")
}

/// Among a set of executables, pick the best "main app" exe:
/// highest name-match score, skipping installers/uninstallers, then largest.
fn pick_main_exe(exes: &[ExeInfo], app_id: &str, app_title: &str) -> Option<ExeInfo> {
    exes.iter()
        .filter(|e| !looks_like_installer(&e.name))
        .cloned()
        .max_by(|a, b| {
            let sa = match_score(&a.name, app_id, app_title);
            let sb = match_score(&b.name, app_id, app_title);
            sa.cmp(&sb).then(a.size.cmp(&b.size))
        })
        .or_else(|| exes.first().cloned()) // fallback: anything
}

/// Run an installer (.exe or .msi), wait for it to finish, then detect what it
/// created via folder-diff + the Windows registry.
/// Returns (launch_exe, install_dir, uninstaller).
async fn run_installer_and_detect(
    installer_path: &std::path::Path,
    is_msi: bool,
    app_id: &str,
    app_title: &str,
) -> (Option<String>, Option<String>, Option<String>) {
    let before = snapshot_dirs(&common_install_roots());

    log_line(format!("[APPS] Running installer: {}", installer_path.display()));
    let child = if is_msi {
        std::process::Command::new("msiexec").arg("/i").arg(installer_path).spawn()
    } else {
        std::process::Command::new(installer_path).spawn()
    };
    let mut child = match child {
        Ok(c) => c,
        Err(e) => { log_line(format!("[APPS] Installer launch failed: {}", e)); return (None, None, None); }
    };

    let app_id_w = app_id.to_string();
    let app_title_w = app_title.to_string();
    let (folder_exe, reg) = tokio::task::spawn_blocking(move || {
        let _ = child.wait();
        std::thread::sleep(std::time::Duration::from_millis(1000)); // let FS + registry settle
        let folder_exe = auto_detect_installed_exe(&before, &app_id_w, &app_title_w);
        let reg = find_registry_app(&app_id_w, &app_title_w);
        (folder_exe, reg)
    }).await.unwrap_or((None, None));

    let install_dir = reg.as_ref().and_then(|r| r.install_location.clone())
        .or_else(|| folder_exe.as_ref().and_then(|e|
            std::path::Path::new(&e.path).parent().map(|p| p.to_string_lossy().to_string())));

    let exe = reg.as_ref().and_then(|r| r.exe.clone())
        .or_else(|| folder_exe.as_ref().map(|e| e.path.clone()))
        .or_else(|| install_dir.as_ref().and_then(|d|
            pick_main_exe(&detect_executables_in(std::path::Path::new(d)), app_id, app_title).map(|e| e.path)));

    let uninstaller = reg.as_ref().and_then(|r| r.uninstall_string.clone())
        .or_else(|| install_dir.as_ref().and_then(|d|
            scan_folder_uninstaller(std::path::Path::new(d))));

    (exe, install_dir, uninstaller)
}

#[tauri::command]
pub fn detect_app_executables(dir_path: String) -> Result<Vec<ExeInfo>, String> {
    let dir = std::path::Path::new(&dir_path);
    Ok(detect_executables_in(dir))
}

#[tauri::command]
pub async fn install_app(
    app_handle: AppHandle,
    app_id: String,
    app_title: String,
    download_url: String,
    file_type: String,   // "zip" | "exe" | "msi" | "script"
    install_path: String,
    version: Option<String>,
    category: Option<String>,
    thumb: Option<String>,
) -> Result<InstallResult, String> {
    log_line(format!("[APPS] Installing {} from {}", app_id, download_url));

    // Prepare target directory
    let target_dir = std::path::PathBuf::from(&install_path).join(&app_id);
    std::fs::create_dir_all(&target_dir).map_err(|e| format!("mkdir failed: {}", e))?;

    // Download
    let client = reqwest::Client::builder()
        .user_agent("BetterModsManager/1.0")
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(&download_url).send().await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download returned HTTP {}", resp.status()));
    }

    let bytes = resp.bytes().await.map_err(|e| format!("Read failed: {}", e))?;

    let ext = file_type.to_lowercase();

    // Detect installer type from extension or filename.
    // Scripts are never treated as installers, even if named "install.ps1".
    let url_filename = download_url.split('/').last().unwrap_or("").to_lowercase();
    let is_script = ext == "script"
        || url_filename.ends_with(".ps1") || url_filename.ends_with(".bat")
        || url_filename.ends_with(".cmd") || url_filename.ends_with(".sh")
        || url_filename.ends_with(".py")  || url_filename.ends_with(".vbs");
    let is_setup = !is_script && (ext == "msi"
        || url_filename.contains("setup")
        || url_filename.contains("install"));

    // Both setup and portable use target_dir so the user controls the location.
    // For setup/msi the installer itself decides where files end up —
    // we just download the setup file to target_dir and launch it from there.
    std::fs::create_dir_all(&target_dir).map_err(|e| format!("mkdir failed: {}", e))?;
    let storage_dir = target_dir.clone();
    let mut installer_launched = is_setup;

    let file_name = if url_filename.is_empty() { format!("download.{}", ext) } else { url_filename.clone() };
    let file_path = storage_dir.join(&file_name);
    std::fs::write(&file_path, &bytes).map_err(|e| format!("Write failed: {}", e))?;

    let executables;
    let mut detected_exe: Option<String> = None;
    let mut detected_install_dir: Option<String> = None;
    let mut detected_uninstaller: Option<String> = None;
    let is_managed;

    if installer_launched {
        // Direct setup/.msi download → run it and auto-detect the result
        let (exe, dir, uninst) =
            run_installer_and_detect(&file_path, ext == "msi", &app_id, &app_title).await;
        detected_exe = exe;
        detected_install_dir = dir;
        detected_uninstaller = uninst;
        let _ = std::fs::remove_dir_all(&target_dir); // remove the downloaded setup
        executables = vec![];
        is_managed = false;
    } else if ext == "zip" {
        // Extract, then decide: portable app, or an installer bundled inside the zip?
        let f = std::fs::File::open(&file_path).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(f).map_err(|e| format!("Zip open failed: {}", e))?;
        archive.extract(&target_dir).map_err(|e| format!("Zip extract failed: {}", e))?;
        let _ = std::fs::remove_file(&file_path);

        let found = detect_executables_in(&target_dir);
        let portable: Vec<ExeInfo> = found.iter().filter(|e| !looks_like_installer(&e.name)).cloned().collect();
        let installer = found.iter().find(|e| looks_like_installer(&e.name)).cloned();

        if portable.is_empty() && installer.is_some() {
            // Zip contained only an installer → run it like a setup
            let inst = installer.unwrap();
            let is_msi = inst.name.to_lowercase().ends_with(".msi");
            log_line(format!("[APPS] Zip contains an installer ({}), running it", inst.name));
            let (exe, dir, uninst) =
                run_installer_and_detect(std::path::Path::new(&inst.path), is_msi, &app_id, &app_title).await;
            detected_exe = exe;
            detected_install_dir = dir;
            detected_uninstaller = uninst;
            let _ = std::fs::remove_dir_all(&target_dir); // remove extracted installer
            installer_launched = true;
            executables = vec![];
            is_managed = false;
        } else {
            // Portable app inside the zip
            executables = portable.clone();
            is_managed = true;
        }
    } else if is_script {
        // Script (.ps1/.bat/.cmd/.sh/.py/.vbs) — keep it, launch via interpreter later
        log_line(format!("[APPS] Saved script: {}", file_path.display()));
        detected_exe = Some(file_path.to_string_lossy().to_string());
        executables = vec![];
        is_managed = true;
    } else {
        // Single portable exe download
        executables = detect_executables_in(&target_dir);
        is_managed = true;
    }

    let exe_path = if installer_launched || is_script {
        detected_exe.clone()
    } else {
        // Portable: prefer the best name-matching non-installer exe
        pick_main_exe(&executables, &app_id, &app_title).map(|e| e.path)
    };

    let install_path_final = if installer_launched {
        detected_install_dir.clone().unwrap_or_default()
    } else {
        target_dir.to_string_lossy().to_string()
    };

    // Persist installed state
    let mut state = load_state(&app_handle);
    state.installed.insert(app_id.clone(), InstalledAppInfo {
        id: app_id.clone(),
        title: app_title.clone(),
        install_path: install_path_final.clone(),
        exe_path,
        installed_at: now_iso(),
        version: version.clone(),
        usage_seconds: 0,
        category,
        thumb,
        is_managed,
        uninstaller: detected_uninstaller.clone(),
    });
    push_history(&mut state, "install", &app_id, &app_title);
    save_state(&app_handle, &state)?;

    log_line(format!("[APPS] Installed {} (managed={}, exe_detected={})",
        app_id, is_managed, detected_exe.is_some()));

    Ok(InstallResult {
        app_id: app_id.clone(),
        install_path: install_path_final,
        executables,
        installer_launched,
        auto_detected: detected_exe.is_some(),
    })
}

// ── Exe path management ───────────────────────────────────────────────────────

/// After a setup installer has run, save the exe the user pointed us to
/// and fill in the install_path from its directory.
#[tauri::command]
pub fn register_installed_exe(
    app_handle: AppHandle,
    app_id: String,
    exe_path: String,
) -> Result<(), String> {
    let mut state = load_state(&app_handle);
    let info = state.installed.get_mut(&app_id)
        .ok_or_else(|| format!("App '{}' not in state", app_id))?;
    let dir = std::path::Path::new(&exe_path)
        .parent()
        .unwrap_or(std::path::Path::new(""))
        .to_string_lossy()
        .to_string();
    info.exe_path = Some(exe_path);
    info.install_path = dir;
    info.is_managed = false; // user chose install location via setup wizard — not BMM-managed
    save_state(&app_handle, &state)
}

#[tauri::command]
pub fn set_app_exe_path(
    app_handle: AppHandle,
    app_id: String,
    exe_path: String,
) -> Result<(), String> {
    let mut state = load_state(&app_handle);
    if let Some(info) = state.installed.get_mut(&app_id) {
        info.exe_path = Some(exe_path);
        save_state(&app_handle, &state)
    } else {
        Err(format!("App '{}' not found in installed list", app_id))
    }
}

// ── Launch + usage tracking ───────────────────────────────────────────────────

#[tauri::command]
pub fn launch_app(
    app_handle: AppHandle,
    app_id: String,
    exe_path: String,
) -> Result<(), String> {
    log_line(format!("[APPS] Launching {} from {}", app_id, exe_path));

    let path = std::path::Path::new(&exe_path);
    if !path.exists() {
        return Err(format!("Executable not found: {}", exe_path));
    }

    let work_dir = path.parent().unwrap_or(path).to_path_buf();

    // Pick the right launcher: scripts need an interpreter, exes run directly.
    let script_ext = path.extension().and_then(|e| e.to_str()).map(|s| s.to_lowercase());
    let mut cmd = match script_ext.as_deref() {
        Some("ps1") => {
            let mut c = std::process::Command::new("powershell");
            c.args(["-ExecutionPolicy", "Bypass", "-File", &exe_path]);
            c
        }
        Some("bat") | Some("cmd") => {
            let mut c = std::process::Command::new("cmd");
            c.args(["/C", &exe_path]);
            c
        }
        Some("py") => { let mut c = std::process::Command::new("python"); c.arg(&exe_path); c }
        Some("vbs") => { let mut c = std::process::Command::new("wscript"); c.arg(&exe_path); c }
        Some("sh")  => { let mut c = std::process::Command::new("bash"); c.arg(&exe_path); c }
        _ => std::process::Command::new(&exe_path), // exe / msi / portable
    };

    let _child = cmd
        .current_dir(&work_dir)
        .spawn()
        .map_err(|e| format!("Launch failed: {}", e))?;

    // Record in history
    let mut state = load_state(&app_handle);
    let title = state.installed.get(&app_id).map(|i| i.title.clone()).unwrap_or_default();
    push_history(&mut state, "launch", &app_id, &title);
    let _ = save_state(&app_handle, &state);

    // Usage tracking by process-name polling (via shared helper).
    let exe_name = path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    let exe_full = exe_path.to_lowercase();
    spawn_usage_tracker(app_handle, app_id, exe_name, exe_full, false);

    Ok(())
}

/// Shared tracking loop — polls every `poll_secs` to check if the exe is
/// still running. Accumulates usage incrementally (survives BMM closing
/// before the app). `already_seen` = true when the app was already running
/// at the time we start tracking (lazy startup detection — skips the appear-grace).
fn spawn_usage_tracker(
    app_handle: AppHandle,
    app_id: String,
    exe_name: String,
    exe_full: String,
    already_seen: bool,
) {
    std::thread::spawn(move || {
        use sysinfo::{System, ProcessRefreshKind, UpdateKind};
        use std::time::Duration;

        let refresh_kind = ProcessRefreshKind::new().with_exe(UpdateKind::OnlyIfNotSet);
        let mut sys = System::new();
        let poll_secs = 10u64;
        let poll = Duration::from_secs(poll_secs);
        let appear_grace_secs = 40u64;
        let mut seen = already_seen;
        let mut waited = 0u64;
        let mut total = 0u64;

        log_line(format!("[APPS] Usage tracker started for '{}' (already_seen={})", app_id, already_seen));

        loop {
            std::thread::sleep(poll);
            waited += poll_secs;
            sys.refresh_processes_specifics(refresh_kind);

            let running = sys.processes().values().any(|p| {
                let pname = p.name().to_lowercase();
                pname == exe_name
                    || pname.trim_end_matches(".exe") == exe_name.trim_end_matches(".exe")
                    || p.exe().map(|e| e.to_string_lossy().to_lowercase() == exe_full).unwrap_or(false)
            });

            if running {
                seen = true;
                let mut s = load_state(&app_handle);
                match s.installed.get_mut(&app_id) {
                    Some(info) => { info.usage_seconds += poll_secs; total += poll_secs; }
                    None => break,
                }
                let _ = save_state(&app_handle, &s);
            } else if seen {
                break;
            } else if waited >= appear_grace_secs {
                log_line(format!("[APPS] '{}' process never appeared — usage not tracked", app_id));
                break;
            }
        }

        if seen {
            log_line(format!("[APPS] '{}' closed — tracked {}s this session", app_id, total));
        }
    });
}

/// Called once at BMM startup: for every installed app whose exe is already
/// running, start a usage tracker immediately (covers the case where the user
/// launched the app before/outside BMM).
#[tauri::command]
pub fn scan_and_track_running_apps(app_handle: AppHandle) {
    use sysinfo::{System, ProcessRefreshKind, UpdateKind};

    let state = load_state(&app_handle);
    if state.installed.is_empty() { return; }

    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessRefreshKind::new().with_exe(UpdateKind::OnlyIfNotSet));

    for (app_id, info) in &state.installed {
        let exe_path = match &info.exe_path {
            Some(p) => p.clone(),
            None => continue,
        };
        let path = std::path::Path::new(&exe_path);
        let exe_name = path.file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let exe_full = exe_path.to_lowercase();

        let running = sys.processes().values().any(|p| {
            let pname = p.name().to_lowercase();
            pname == exe_name
                || pname.trim_end_matches(".exe") == exe_name.trim_end_matches(".exe")
                || p.exe().map(|e| e.to_string_lossy().to_lowercase() == exe_full).unwrap_or(false)
        });

        if running {
            log_line(format!("[APPS] Lazy tracking started for already-running app '{}'", app_id));
            spawn_usage_tracker(app_handle.clone(), app_id.clone(), exe_name, exe_full, true);
        }
    }
}

// ── State queries ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_apps_state(app_handle: AppHandle) -> Result<AppsState, String> {
    Ok(load_state(&app_handle))
}

/// Returns true if a setup-installed app has a known uninstaller command.
#[tauri::command]
pub fn app_has_uninstaller(app_handle: AppHandle, app_id: String) -> Result<bool, String> {
    let state = load_state(&app_handle);
    Ok(state.installed.get(&app_id).and_then(|i| i.uninstaller.clone()).is_some())
}

#[tauri::command]
pub fn uninstall_app(
    app_handle: AppHandle,
    app_id: String,
    delete_files: Option<bool>,
    run_uninstaller: Option<bool>,
) -> Result<(), String> {
    let mut state = load_state(&app_handle);

    let info = state.installed.get(&app_id)
        .cloned()
        .ok_or_else(|| format!("App '{}' not installed", app_id))?;

    // 1. Run the app's own uninstaller (setup-installed apps)
    if run_uninstaller.unwrap_or(false) {
        // Use the stored uninstaller, or look it up live in the registry
        // (handles apps installed before BMM started recording it).
        let cmd = info.uninstaller.clone()
            .or_else(|| find_registry_app(&info.id, &info.title).and_then(|r| r.uninstall_string));

        let cmd = cmd.ok_or_else(||
            "No uninstaller found. Use Windows 'Add or remove programs' instead.".to_string())?;

        let (program, args) = parse_command(&cmd);
        log_line(format!("[APPS] Running uninstaller: program='{}' args={:?}", program, args));

        std::process::Command::new(&program)
            .args(&args)
            .spawn()
            .map_err(|e| format!("Could not start uninstaller '{}': {}", program, e))?;
    }
    // 2. Delete BMM-managed files (zip/portable apps)
    else if delete_files.unwrap_or(true) && info.is_managed && !info.install_path.is_empty() {
        let dir = std::path::Path::new(&info.install_path);
        if dir.exists() {
            std::fs::remove_dir_all(dir)
                .map_err(|e| format!("Could not delete '{}': {}", info.install_path, e))?;
        }
        log_line(format!("[APPS] Deleted files for {}", app_id));
    } else {
        log_line(format!("[APPS] Removed {} from BMM (files untouched)", app_id));
    }

    // Remove from state only after the action above succeeded
    state.installed.remove(&app_id);
    state.favorites.retain(|f| f != &app_id);
    push_history(&mut state, "uninstall", &app_id, &info.title);
    save_state(&app_handle, &state)?;

    log_line(format!("[APPS] Uninstalled {}", app_id));
    Ok(())
}

#[tauri::command]
pub fn toggle_app_favorite(app_handle: AppHandle, app_id: String) -> Result<Vec<String>, String> {
    let mut state = load_state(&app_handle);
    if state.favorites.contains(&app_id) {
        state.favorites.retain(|f| f != &app_id);
    } else {
        state.favorites.push(app_id);
    }
    save_state(&app_handle, &state)?;
    Ok(state.favorites)
}

#[tauri::command]
pub fn add_community_source(app_handle: AppHandle, url: String) -> Result<Vec<String>, String> {
    let mut state = load_state(&app_handle);
    if !state.community_sources.contains(&url) {
        state.community_sources.push(url);
        save_state(&app_handle, &state)?;
    }
    Ok(state.community_sources)
}

#[tauri::command]
pub fn remove_community_source(app_handle: AppHandle, url: String) -> Result<Vec<String>, String> {
    let mut state = load_state(&app_handle);
    state.community_sources.retain(|s| s != &url);
    save_state(&app_handle, &state)?;
    Ok(state.community_sources)
}

#[tauri::command]
pub fn get_default_apps_path(app_handle: AppHandle) -> Result<String, String> {
    let path = app_handle.path_resolver()
        .app_data_dir()
        .unwrap_or_default()
        .join("Apps");
    std::fs::create_dir_all(&path).ok();
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_app_folder(install_path: String) -> Result<(), String> {
    let path = std::path::Path::new(&install_path);
    if !path.exists() {
        return Err(format!("Folder not found: {}", install_path));
    }
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer").arg(&install_path).spawn()
        .map_err(|e| format!("Explorer failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn clear_app_history(app_handle: AppHandle) -> Result<(), String> {
    let mut state = load_state(&app_handle);
    state.history.clear();
    save_state(&app_handle, &state)
}
