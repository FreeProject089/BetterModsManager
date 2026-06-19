use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::collections::VecDeque;
use sysinfo::{System, Pid};
use backtrace::Backtrace;

// ─── CIRCULAR LOG BUFFER ──────────────────────────────────────────────────

const MAX_LOG_LINES: usize = 500;

lazy_static::lazy_static! {
    static ref LOG_BUFFER: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::with_capacity(MAX_LOG_LINES)));
    static ref PREVIOUS_SESSION_CRASHED: Arc<std::sync::atomic::AtomicBool> = Arc::new(std::sync::atomic::AtomicBool::new(false));
    static ref SHUTTING_DOWN: Arc<std::sync::atomic::AtomicBool> = Arc::new(std::sync::atomic::AtomicBool::new(false));
}

/// Adds a log line to the memory buffer AND to the real-time file (immediate flush).
pub fn log_line(line: impl Into<String>) {
    let s_line: String = line.into();
    let ts = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    let entry = format!("[{}] {}", ts, s_line);

    // 1. Buffer mémoire
    // Use try_lock to avoid blocking the caller if the buffer is currently being accessed
    if let Ok(mut buf) = LOG_BUFFER.try_lock() {
        if buf.len() >= MAX_LOG_LINES {
            buf.pop_front();
        }
        buf.push_back(entry.clone());
    } else {
        // Fallback: we still have the real-time file below, so we don't lose the log entirely
        // but we skip the memory buffer to avoid blocking
    }

    // 2. Real-time file (Open, write, flush, close to be safe against crashes)
    // Do NOT recreate the file if shutting down (to avoid dirty session false positives)
    if !SHUTTING_DOWN.load(std::sync::atomic::Ordering::SeqCst) {
        if let Ok(mut file) = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(get_realtime_log_path()) {
            let _ = writeln!(file, "{}", entry);
            let _ = file.sync_all(); // Force physical write to disk
        }
    }
}

pub fn set_shutting_down() {
    SHUTTING_DOWN.store(true, std::sync::atomic::Ordering::SeqCst);
}

pub fn get_log_lines() -> Vec<String> {
    if let Ok(buf) = LOG_BUFFER.lock() {
        buf.iter().cloned().collect()
    } else {
        Vec::new()
    }
}

pub fn is_shutting_down() -> bool {
    SHUTTING_DOWN.load(std::sync::atomic::Ordering::SeqCst)
}

// ─── DIRECTORIES & PATHS ─────────────────────────────────────────────────────

fn get_realtime_log_path() -> PathBuf {
    get_crash_dir(None).join(format!("session_{}.log", std::process::id()))
}

/// Read the tail of the current session's realtime Rust log — used by the local
/// replay watcher to bundle backend logs alongside the rrweb recording.
#[tauri::command]
pub fn read_session_log_tail(max_bytes: Option<usize>) -> String {
    let cap = max_bytes.unwrap_or(256 * 1024);
    match std::fs::read(get_realtime_log_path()) {
        Ok(bytes) => {
            let start = bytes.len().saturating_sub(cap);
            String::from_utf8_lossy(&bytes[start..]).to_string()
        }
        Err(_) => String::new(),
    }
}

pub fn get_crash_dir(app_handle: Option<&tauri::AppHandle>) -> PathBuf {
    if let Some(handle) = app_handle {
        handle.path_resolver()
            .app_data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Crashes")
    } else {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
        PathBuf::from(appdata).join("com.bettermm.app").join("Crashes")
    }
}

fn get_report_dir(is_crash: bool) -> PathBuf {
    let base = get_crash_dir(None);
    if is_crash { base.join("Reports").join("Crash") } else { base.join("Reports").join("Session") }
}

fn get_archive_dir(is_crash: bool) -> PathBuf {
    let base = get_crash_dir(None);
    if is_crash { base.join("Archive").join("Crash") } else { base.join("Archive").join("Session") }
}

fn archive_old_reports(dir: &Path, archive_dir: &Path) {
    if let Ok(entries) = fs::read_dir(dir) {
        let mut files: Vec<_> = entries.flatten()
            .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("zip"))
            .collect();
        
        // Keep only the 5 most recent active reports, the rest go to the archive
        if files.len() > 5 {
            files.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
            let _ = fs::create_dir_all(archive_dir);
            for i in 0..(files.len() - 5) {
                let old_path = files[i].path();
                if let Some(name) = old_path.file_name() {
                    let new_path = archive_dir.join(name);
                    if let Err(e) = fs::rename(&old_path, &new_path) {
                        eprintln!("[ARCHIVE] Failed to rename {:?} to {:?}: {}", old_path, new_path, e);
                    }
                }
            }
        }
    }
    
    // Nettoyage de l'archive : Max 20 fichiers par catégorie
    if let Ok(entries) = fs::read_dir(archive_dir) {
        let mut archive_files: Vec<_> = entries.flatten().collect();
        if archive_files.len() > 20 {
            archive_files.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
            for i in 0..(archive_files.len() - 20) {
                if let Err(e) = fs::remove_file(archive_files[i].path()) {
                    eprintln!("[ARCHIVE] Failed to remove old archive file {:?}: {}", archive_files[i].path(), e);
                }
            }
        }
    }
}

// ─── INITIALISATION / RÉCUPÉRATION APRÈS CRASH ──────────────────────────────

pub fn init_session() {
    let dir = get_crash_dir(None);
    let _ = fs::create_dir_all(&dir);

    let my_pid = std::process::id();
    let mut system = System::new_all();
    system.refresh_processes();

    // 1. Migration/Nettoyage : Déplace les vieux zips/logs de la racine vers l'Archive
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                    if (name.starts_with("crash_") || name.starts_with("session_")) && name.ends_with(".zip") {
                        let target_dir = get_archive_dir(name.starts_with("crash_"));
                        let _ = fs::create_dir_all(&target_dir);
                        let _ = fs::rename(&path, target_dir.join(name));
                    } else if name.starts_with("session_") && name.ends_with(".log") {
                         // Check orphelins (comme avant)
                         let pid_str = name.replace("session_", "").replace(".log", "");
                         if let Ok(old_pid_val) = pid_str.parse::<usize>() {
                             let old_pid = Pid::from(old_pid_val);
                             if old_pid != Pid::from(my_pid as usize) && system.process(old_pid).is_none() {
                                 if let Ok(content) = fs::read_to_string(&path) {
                                     if !content.trim().is_empty() {
                                         let was_shutdown = content.contains("[SHUTDOWN]");
                                         if !was_shutdown {
                                             eprintln!("[CRASH_LOGGER] Found dirty orphaned log: {}", name);
                                             PREVIOUS_SESSION_CRASHED.store(true, std::sync::atomic::Ordering::SeqCst);
                                             generate_report_from_content(true, "Detected uncontrolled shutdown (dirty legacy session)", None, content);
                                         }
                                     }
                                 }
                                 let _ = fs::remove_file(&path);
                             }
                         }
                    } else if name == "current_session.log" {
                        let _ = fs::remove_file(&path);
                    }
                }
            }
        }
    }

    // 2. Start our own log for this session
    let log_path = get_realtime_log_path();
    if let Ok(mut file) = fs::File::create(&log_path) {
        let _ = writeln!(file, "--- NEW SESSION STARTED AT {} (PID: {}) ---", chrono::Local::now().to_rfc3339(), my_pid);
        let _ = file.sync_all();
    }
}

// function removed as consolidate into generate_report

/// Helper to generate a report from already loaded log content (used for orphans)
fn generate_report_from_content(is_crash: bool, reason: &str, app_state: Option<String>, log_content: String) -> Option<PathBuf> {
    generate_report_internal(is_crash, reason, app_state, Some(log_content), None, None)
}

// ─── COLLECTE DES DONNÉES DIAGNOSTICS ────────────────────────────────────────

fn get_system_snapshot() -> String {
    let mut s = System::new_all();
    s.refresh_all();

    let mut info = String::new();
    info.push_str("=== SYSTEM DIAGNOSTICS ===\n");
    info.push_str(&format!("OS Name:         {}\n", System::name().unwrap_or_default()));
    info.push_str(&format!("OS Version:      {}\n", System::os_version().unwrap_or_default()));
    info.push_str(&format!("Kernel Version:  {}\n", System::kernel_version().unwrap_or_default()));
    info.push_str(&format!("Total Memory:    {} MB\n", s.total_memory() / 1024 / 1024));
    info.push_str(&format!("Free Memory:     {} MB\n", s.free_memory() / 1024 / 1024));
    info.push_str(&format!("CPU Count:       {}\n", s.cpus().len()));
    
    info.push_str("\n=== PROCESS INFO ===\n");
    let pid = Pid::from(std::process::id() as usize);
    if let Some(process) = s.process(pid) {
        info.push_str(&format!("Memory Usage:    {} KB\n", process.memory()));
        info.push_str(&format!("CPU Usage:       {}%\n", process.cpu_usage()));
        info.push_str(&format!("Process Runtime: {}s\n", process.run_time()));
    }
    info
}

// ─── GÉNÉRATION DU RAPPORT (ZIP) ────────────────────────────────────────────

pub fn generate_report(
    is_crash: bool,
    reason: &str,
    app_state: Option<String>,
    override_log: Option<String>,
    frontend_dump: Option<String>,
) -> Option<PathBuf> {
    generate_report_internal(is_crash, reason, app_state, override_log, Some(get_realtime_log_path()), frontend_dump)
}

fn generate_report_internal(
    is_crash: bool,
    reason: &str,
    app_state: Option<String>,
    override_log: Option<String>,
    log_to_delete: Option<PathBuf>,
    frontend_dump: Option<String>,
) -> Option<PathBuf> {
    let report_dir = get_report_dir(is_crash);
    let _ = fs::create_dir_all(&report_dir);

    let prefix = if is_crash { "crash" } else { "session" };
    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let zip_path = report_dir.join(format!("{}_{}.zip", prefix, timestamp));

    let file = fs::File::create(&zip_path).ok()?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // 1. metadata.txt
    let mut meta = format!("BMM VERSION: {}\n", env!("CARGO_PKG_VERSION"));
    meta.push_str(&format!("TIMESTAMP:   {}\n", chrono::Local::now().to_rfc3339()));
    meta.push_str(&format!("REASON:      {}\n", reason));
    let _ = zip.start_file("metadata.txt", opts);
    let _ = zip.write_all(meta.as_bytes());

    // 2. stacktrace.txt (si crash)
    if is_crash {
        let bt = Backtrace::new();
        let _ = zip.start_file("stacktrace.txt", opts);
        let _ = zip.write_all(format!("{:?}", bt).as_bytes());
    }

    // 3. system_info.txt
    let _ = zip.start_file("system_info.txt", opts);
    let _ = zip.write_all(get_system_snapshot().as_bytes());

    // 4. app_logs.txt
    let logs_text = if let Some(content) = override_log {
        content
    } else {
        LOG_BUFFER.lock().map(|buf| {
            buf.iter().cloned().collect::<Vec<String>>().join("\n")
        }).unwrap_or_default()
    };
    let _ = zip.start_file("app_logs.txt", opts);
    let _ = zip.write_all(logs_text.as_bytes());

    // 5. state_snapshot.json
    if let Some(state) = app_state {
        let _ = zip.start_file("state_snapshot.json", opts);
        let _ = zip.write_all(state.as_bytes());
    }

    // 5b. frontend_dump.json
    if let Some(dump) = frontend_dump {
        let _ = zip.start_file("frontend_dump.json", opts);
        let _ = zip.write_all(dump.as_bytes());
    }

    // 6. dxdiag.txt (Windows Only, only if crash to speed up normal closure)
    #[cfg(target_os = "windows")]
    if is_crash {
        let tmp_file = std::env::temp_dir().join("bmm_dxdiag_tmp.txt");
        let _ = std::process::Command::new("dxdiag")
            .args(["/t", &tmp_file.to_string_lossy().to_string()])
            .spawn();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !tmp_file.exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        if let Ok(content) = fs::read(&tmp_file) {
            let _ = zip.start_file("dxdiag.txt", opts);
            let _ = zip.write_all(&content);
            let _ = fs::remove_file(&tmp_file);
        }
    }

    let _ = zip.finish();
    
    // Archivage et nettoyage
    archive_old_reports(&report_dir, &get_archive_dir(is_crash));

    // Après avoir généré le zip (qui contient les logs), on vide le log temps réel spécifié.
    if let Some(path) = log_to_delete {
        let _ = fs::remove_file(path);
    }

    Some(zip_path)
}

// ─── PANIC HOOK ─────────────────────────────────────────────────────────────

pub fn setup_panic_hook() {
    use std::panic;
    panic::set_hook(Box::new(|info| {
        let reason = format!("{}", info);
        log_line(format!("[PANIC DETECTED] {}", reason));
        generate_report(true, &reason, None, None, None);
    }));
}

// ─── TAURI COMMANDS ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn open_crash_folder(app_handle: tauri::AppHandle) -> Result<(), String> {
    let dir = get_crash_dir(Some(&app_handle));
    fs::create_dir_all(&dir).ok();
    
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer").arg(dir.to_string_lossy().as_ref()).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("xdg-open").arg(dir.to_string_lossy().as_ref()).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_crash_zip(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() { return Err("Zip path error".into()); }
    
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", p.to_string_lossy().as_ref()])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Some(parent) = p.parent() {
            std::process::Command::new("xdg-open").arg(parent.to_string_lossy().as_ref()).spawn().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn trigger_manual_crash_report(frontend_dump: Option<String>) -> Result<String, String> {
    log_line("[DEBUG] Manual crash report triggered by user.");
    if let Some(path) = generate_report(true, "Manual Debug Trigger / Frontend Crash", None, None, frontend_dump) {
        Ok(path.to_string_lossy().to_string())
    } else {
        Err("Failed to generate manual report".into())
    }
}

#[tauri::command]
pub fn get_crash_reports(_app_handle: tauri::AppHandle) -> Vec<String> {
    let dir = get_report_dir(true); // Seulement le dossier Crash/
    if !dir.exists() { return vec![]; }
    
    let mut files = fs::read_dir(&dir).ok().map(|entries| {
        entries.flatten()
            .filter(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                name.starts_with("crash_") && name.ends_with(".zip")
            })
            .map(|e| e.path().to_string_lossy().to_string())
            .collect::<Vec<String>>()
    }).unwrap_or_default();
    
    files.sort_by(|a, b| b.cmp(a));
    files
}

#[tauri::command]
pub fn log_frontend_line(line: String) {
    log_line(format!("[UI] {}", line));
}

// ─── API ACTIVITY LOG (disk-backed, used by the Plugins & API panel) ─────────
// Each line is one JSON entry. Stored on disk so it never grows in RAM and
// survives restarts; the frontend keeps only a tiny in-memory window.

fn get_api_log_path() -> PathBuf {
    // <appdata>/com.bettermm.app/api-activity.log  (sibling of the Crashes dir)
    get_crash_dir(None)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
        .join("api-activity.log")
}

const API_LOG_MAX_LINES: usize = 5000;

/// Append one JSON entry (single line) to the API activity log on disk.
#[tauri::command]
pub fn append_api_log(line: String) -> Result<(), String> {
    let path = get_api_log_path();
    if let Some(parent) = path.parent() { let _ = fs::create_dir_all(parent); }
    {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| e.to_string())?;
        // Keep it strictly one line per entry
        let _ = writeln!(file, "{}", line.replace('\n', " ").replace('\r', " "));
    }
    // Trim occasionally so the file stays bounded (cheap metadata check).
    if let Ok(meta) = fs::metadata(&path) {
        if meta.len() > 1_500_000 {
            if let Ok(content) = fs::read_to_string(&path) {
                let lines: Vec<&str> = content.lines().collect();
                if lines.len() > API_LOG_MAX_LINES {
                    let keep = &lines[lines.len() - API_LOG_MAX_LINES..];
                    let _ = fs::write(&path, format!("{}\n", keep.join("\n")));
                }
            }
        }
    }
    Ok(())
}

/// Return the last `limit` API activity log entries (JSON strings, oldest→newest).
#[tauri::command]
pub fn read_api_log(limit: usize) -> Vec<String> {
    let path = get_api_log_path();
    let content = match fs::read_to_string(&path) { Ok(c) => c, Err(_) => return Vec::new() };
    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    let n = limit.min(lines.len());
    if n == 0 { return Vec::new(); }
    lines[lines.len() - n..].iter().map(|s| s.to_string()).collect()
}

/// Clear the API activity log file.
#[tauri::command]
pub fn clear_api_log() -> Result<(), String> {
    let path = get_api_log_path();
    if path.exists() { fs::write(&path, "").map_err(|e| e.to_string())?; }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct StartupStatus {
    pub backend_crashed: bool,
    pub previously_clean: bool,
}

#[tauri::command]
pub fn get_startup_status(state: tauri::State<crate::state::AppState>) -> StartupStatus {
    StartupStatus {
        backend_crashed: PREVIOUS_SESSION_CRASHED.load(std::sync::atomic::Ordering::SeqCst),
        previously_clean: state.previous_session_clean.load(std::sync::atomic::Ordering::SeqCst),
    }
}

#[tauri::command]
pub fn finalize_and_close_app(window: tauri::Window, state: tauri::State<crate::state::AppState>) {
    log_line("[SHUTDOWN] finalize_and_close_app called from UI.");
    
    if is_shutting_down() {
        return;
    }
    set_shutting_down();

    // Capture de l'état
    let state_snapshot = {
        let mut data = state.data.lock().ok();
        if let Some(ref mut d) = data {
            d.settings.last_session_clean = true;
        }
        data.and_then(|d| serde_json::to_string_pretty(&*d).ok())
    };
    let _ = state.save();

    // On fait le zip en bloquant un tout petit peu si nécessaire, ou on spawn
    std::thread::spawn(move || {
        log_line("[SHUTDOWN] Thread: Generating session report (via command)...");
        let _ = generate_report(
            false, 
            "Clean Exit (UI Close Button)", 
            state_snapshot,
            None,
            None
        );
        log_line("[SHUTDOWN] Thread: Done. Closing window.");
        let _ = window.close();
    });
}
#[tauri::command]
pub async fn get_dxdiag_report() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let tmp_file = std::env::temp_dir().join(format!("bmm_dxdiag_req_{}.txt", std::process::id()));
        let _ = std::process::Command::new("dxdiag")
            .args(["/t", &tmp_file.to_string_lossy().to_string()])
            .spawn()
            .map_err(|e| format!("Failed to spawn dxdiag: {}", e))?;

        // Wait up to 45 seconds for the file to be generated
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(45);
        while !tmp_file.exists() && std::time::Instant::now() < deadline {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }

        if tmp_file.exists() {
            // DxDiag on Windows outputs UTF-16 LE with BOM — read raw bytes and decode
            let raw = fs::read(&tmp_file).map_err(|e| format!("Failed to read dxdiag file: {}", e))?;
            let _ = fs::remove_file(&tmp_file);

            // Check for UTF-16 LE BOM (FF FE)
            let content = if raw.len() >= 2 && raw[0] == 0xFF && raw[1] == 0xFE {
                // UTF-16 LE: skip BOM and decode pairs
                let u16_data: Vec<u16> = raw[2..]
                    .chunks_exact(2)
                    .map(|b| u16::from_le_bytes([b[0], b[1]]))
                    .collect();
                String::from_utf16(&u16_data).unwrap_or_else(|_| String::from_utf8_lossy(&raw).to_string())
            } else {
                // Already UTF-8 or ASCII
                String::from_utf8_lossy(&raw).to_string()
            };

            Ok(content)
        } else {
            Err("DxDiag timeout or generation failed".into())
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("DxDiag is only available on Windows".into())
    }
}

#[derive(serde::Serialize)]
pub struct CrashReportEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub date: String,
    pub category: String, // "Crash", "Session", "Archive/Crash", "Archive/Session"
}

#[tauri::command]
pub async fn list_crash_reports() -> Result<Vec<CrashReportEntry>, String> {
    let mut reports = Vec::new();
    let base_dir = get_crash_dir(None);
    
    let folders = [
        ("Reports/Crash", "Crash"),
        ("Reports/Session", "Session"),
        ("Archive/Crash", "Archive/Crash"),
        ("Archive/Session", "Archive/Session"),
    ];

    for (sub_path, cat) in folders {
        let dir = base_dir.join(sub_path);
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("zip") {
                    if let Ok(meta) = entry.metadata() {
                        reports.push(CrashReportEntry {
                            name: entry.file_name().to_string_lossy().to_string(),
                            path: path.to_string_lossy().to_string(),
                            size: meta.len(),
                            date: meta.modified().ok()
                                .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
                                .map(|d| d.as_secs().to_string())
                                .unwrap_or_default(),
                            category: cat.to_string(),
                        });
                    }
                }
            }
        }
    }

    // Sort by date descending
    reports.sort_by(|a, b| b.date.cmp(&a.date));
    
    Ok(reports)
}
