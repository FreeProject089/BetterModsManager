use tauri::Manager;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use crate::models::app_catalog::*;
use crate::commands::crash::log_line;

/// CWE-22: reduce a catalog-supplied filename to a safe bare basename — strips any
/// directory components / traversal, drops NTFS alternate-data-stream suffixes
/// (`:`), and replaces anything that isn't filename-safe. Never returns empty.
fn sanitize_download_name(name: &str, fallback_ext: &str) -> String {
    let base = std::path::Path::new(name)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let base = base.split(':').next().unwrap_or("").trim(); // drop ADS + trim
    let cleaned: String = base
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ' | '(' | ')') { c } else { '_' })
        .collect();
    let cleaned = cleaned.trim_matches(|c| c == '.' || c == ' ');
    if cleaned.is_empty() { format!("download.{}", fallback_ext) } else { cleaned.to_string() }
}

// ── State persistence ─────────────────────────────────────────────────────────

fn state_path(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .app_data_dir().ok()
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

async fn fetch_raw_catalog(app: &tauri::AppHandle, url: &str) -> Option<AppCatalog> {
    let bust = format!("{}?t={}", url,
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs());
    // catalog_get adds the site identity header for first-party URLs so private community
    // app catalogs gate by the caller's linked account; third-party sources get none.
    let resp = crate::commands::net::catalog_get(app, &bust)
        .timeout(std::time::Duration::from_secs(15)).send().await.ok()?;
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
    app: tauri::AppHandle,
    catalog_url: String,
    extra_community_urls: Vec<String>,
) -> Result<MergedCatalog, String> {
    let mut all_apps: Vec<AppEntry> = Vec::new();
    let mut sources_loaded: Vec<String> = Vec::new();
    let mut sources_failed: Vec<String> = Vec::new();
    let mut visited: std::collections::HashSet<String> = std::collections::HashSet::new();

    // ── Tier 0: Official catalog ──────────────────────────────────────────────
    visited.insert(catalog_url.clone());
    log_line(format!("[APPS] Fetching official catalog: {}", catalog_url));

    let mut partner_urls: Vec<String> = Vec::new();
    let mut community_urls: Vec<String> = extra_community_urls;

    match fetch_raw_catalog(&app, &catalog_url).await {
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
        match fetch_raw_catalog(&app, url).await {
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
        match fetch_raw_catalog(&app, &url).await {
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
    // Collect with depth so we can prefer executables sitting in the mod root
    // over ones buried in sub-folders (tools/, redist/, etc.).
    let mut found: Vec<(usize, ExeInfo)> = walkdir::WalkDir::new(dir)
        .max_depth(4)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let depth = e.depth(); // 1 = directly in `dir`
            let p = e.path().to_path_buf();
            let ext = p.extension()?.to_str()?.to_lowercase();
            // Runnable launchers: native executables AND common script launchers.
            if !matches!(ext.as_str(), "exe" | "msi" | "bat" | "cmd" | "vbs" | "ps1") { return None; }
            let size = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            Some((depth, ExeInfo {
                name: p.file_name().unwrap_or_default().to_string_lossy().to_string(),
                path: p.to_string_lossy().to_string(),
                size,
            }))
        })
        .collect();

    // Sort priority:
    //   1. shallower depth first (root-level exes win over buried ones)
    //   2. real .exe over scripts
    //   3. larger size (main app heuristic)
    found.sort_by(|(da, a), (db, b)| {
        let rank = |n: &str| -> u8 { if n.to_lowercase().ends_with(".exe") { 0 } else { 1 } };
        da.cmp(db)
            .then(rank(&a.name).cmp(&rank(&b.name)))
            .then(b.size.cmp(&a.size))
    });
    found.into_iter().map(|(_, e)| e).collect()
}

/// True if a filename looks like an installer rather than the app itself.
fn looks_like_installer(name: &str) -> bool {
    let n = name.to_lowercase();
    n.ends_with(".msi")
        || n.contains("setup")
        || n.contains("install")   // installer.bat, install.exe, install.vbs, etc.
        || n.starts_with("vc_redist")
        || n.contains("redist")
}

/// Among a set of executables, pick the best "main app" exe:
/// highest name-match score, then shallowest (root-level) path, then largest.
fn pick_main_exe(exes: &[ExeInfo], app_id: &str, app_title: &str) -> Option<ExeInfo> {
    // Path "depth" = number of separators; fewer = closer to the mod root.
    let depth = |p: &str| -> isize { p.matches('/').count() as isize + p.matches('\\').count() as isize };
    exes.iter()
        .filter(|e| !looks_like_installer(&e.name))
        .cloned()
        .max_by(|a, b| {
            // 1. shallowest path wins (root strictly preferred over sub-folders)
            //    invert: lower depth = "greater" for max_by
            // 2. better name match (app_id/title)
            // 3. larger size
            let sa = match_score(&a.name, app_id, app_title);
            let sb = match_score(&b.name, app_id, app_title);
            depth(&b.path).cmp(&depth(&a.path))
                .then(sa.cmp(&sb))
                .then(a.size.cmp(&b.size))
        })
        .or_else(|| exes.first().cloned()) // fallback: shallowest from detect (already sorted)
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
        crate::commands::proc::hidden_command("msiexec").arg("/i").arg(installer_path).spawn()
    } else {
        crate::commands::proc::hidden_command(installer_path).spawn()
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
    sha256: Option<String>,
    allow_insecure: Option<bool>,
    allow_bad_checksum: Option<bool>,
) -> Result<InstallResult, String> {
    log_line(format!("[APPS] Installing {} from {}", app_id, download_url));

    // CWE-494: code is fetched then executed/extracted on this machine, so the
    // transport should be authenticated. HTTPS is always allowed. Plain HTTP is
    // allowed only when the user explicitly accepted the warning shown by the UI
    // (`allow_insecure`) — an HTTP source can be MITM-swapped for a malicious
    // binary. Any other scheme (file://, ftp://, …) is always rejected.
    {
        let scheme = download_url.split("://").next().unwrap_or("").to_ascii_lowercase();
        match scheme.as_str() {
            "https" => {}
            "http" => {
                if !allow_insecure.unwrap_or(false) {
                    // Recognisable marker the frontend turns into a confirm dialog.
                    return Err("INSECURE_HTTP".to_string());
                }
                log_line(format!("[APPS] WARNING: installing {} over plain HTTP (user accepted)", app_id));
            }
            _ => {
                return Err(format!(
                    "Refused: unsupported download scheme '{}://…' (only http/https).",
                    scheme
                ));
            }
        }
    }

    // Prepare target directory
    let target_dir = std::path::PathBuf::from(&install_path).join(&app_id);
    std::fs::create_dir_all(&target_dir).map_err(|e| format!("mkdir failed: {}", e))?;

    // Download
    let resp = crate::commands::net::client().get(&download_url)
        .header(reqwest::header::USER_AGENT, "BetterModsManager/1.0")
        .timeout(std::time::Duration::from_secs(300))
        .send().await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download returned HTTP {}", resp.status()));
    }

    let bytes = resp.bytes().await.map_err(|e| format!("Read failed: {}", e))?;

    // CWE-494: verify integrity of the downloaded payload before it is ever
    // written/executed. If the catalog declares a sha256 and it does NOT match,
    // we warn the user (marker the UI turns into a confirm modal) and only
    // proceed if they explicitly accepted (`allow_bad_checksum`) — it's a strong
    // reminder, not a hard ban. If the catalog omits a checksum we only warn in
    // the log.
    {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let actual = hex::encode(hasher.finalize());
        match sha256.as_ref().map(|s| s.trim().trim_start_matches("sha256:").to_ascii_lowercase()) {
            Some(expected) if !expected.is_empty() => {
                if expected != actual {
                    if !allow_bad_checksum.unwrap_or(false) {
                        // Marker parsed by the frontend: SHA_MISMATCH:<expected>:<actual>
                        return Err(format!("SHA_MISMATCH:{}:{}", expected, actual));
                    }
                    log_line(format!(
                        "[APPS] WARNING: sha256 MISMATCH for {} (expected {}, got {}) — user chose to install anyway",
                        app_id, expected, actual
                    ));
                } else {
                    log_line(format!("[APPS] sha256 verified OK for {}", app_id));
                }
            }
            _ => {
                // No checksum declared: warn the user (overridable) instead of
                // silently installing unverified code.
                if !allow_bad_checksum.unwrap_or(false) {
                    // Marker parsed by the frontend: NO_CHECKSUM:<actual sha256>
                    return Err(format!("NO_CHECKSUM:{}", actual));
                }
                log_line(format!(
                    "[APPS] WARNING: no sha256 in catalog for {} — integrity not verified, user chose to install anyway (sha256 of payload: {})",
                    app_id, actual
                ));
            }
        }
    }

    let ext = file_type.to_lowercase();

    // Detect installer type from extension or filename.
    // Scripts are never treated as installers, even if named "install.ps1".
    let url_filename = download_url.split('/').next_back().unwrap_or("").to_lowercase();
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

    // CWE-22: the filename comes from the (possibly untrusted) catalog URL, so a
    // segment like `..\..\Startup\x.exe` could escape storage_dir. Sanitise to a
    // bare, safe basename and verify the resolved path stays inside storage_dir.
    let raw_name = if url_filename.is_empty() { format!("download.{}", ext) } else { url_filename.clone() };
    let file_name = sanitize_download_name(&raw_name, &ext);
    let file_path = storage_dir.join(&file_name);
    if file_path.parent() != Some(storage_dir.as_path()) {
        return Err("Refused: unsafe download path".to_string());
    }
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
            let mut c = crate::commands::proc::hidden_command("powershell");
            c.args(["-ExecutionPolicy", "Bypass", "-File", &exe_path]);
            c
        }
        Some("bat") | Some("cmd") => {
            let mut c = crate::commands::proc::hidden_command("cmd");
            c.args(["/C", &exe_path]);
            c
        }
        Some("py") => { let mut c = crate::commands::proc::hidden_command("python"); c.arg(&exe_path); c }
        Some("vbs") => { let mut c = crate::commands::proc::hidden_command("wscript"); c.arg(&exe_path); c }
        Some("sh")  => { let mut c = crate::commands::proc::hidden_command("bash"); c.arg(&exe_path); c }
        _ => crate::commands::proc::hidden_command(&exe_path), // exe / msi / portable
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

/// Lists every runnable executable/script found in an installed app's folder,
/// sorted root-first. Used by the manual launcher picker (esp. for zip apps).
#[tauri::command]
pub fn list_app_executables(app_handle: AppHandle, app_id: String) -> Result<Vec<ExeInfo>, String> {
    let state = load_state(&app_handle);
    let info = state.installed.get(&app_id).ok_or("App not installed")?;
    let dir = info.install_path.clone();
    if dir.is_empty() { return Ok(vec![]); }
    Ok(detect_executables_in(std::path::Path::new(&dir)))
}

/// Sets the main launcher executable for an installed app (manual override).
#[tauri::command]
pub fn set_app_main_exe(app_handle: AppHandle, app_id: String, exe_path: String) -> Result<(), String> {
    let mut state = load_state(&app_handle);
    let info = state.installed.get_mut(&app_id).ok_or("App not installed")?;
    info.exe_path = Some(exe_path);
    save_state(&app_handle, &state).map_err(|e| e.to_string())?;
    Ok(())
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

        crate::commands::proc::hidden_command(&program)
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
    let path = app_handle.path()
        .app_data_dir().ok()
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
    crate::commands::proc::hidden_command("explorer").arg(&install_path).spawn()
        .map_err(|e| format!("Explorer failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn clear_app_history(app_handle: AppHandle) -> Result<(), String> {
    let mut state = load_state(&app_handle);
    state.history.clear();
    save_state(&app_handle, &state)
}
