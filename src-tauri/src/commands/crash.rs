use tauri::Manager;
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
            // sync_data (fdatasync) forces the appended bytes to disk for crash-safety
            // WITHOUT the extra metadata flush of sync_all — cheaper on a per-line path.
            let _ = file.sync_data();
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

/// The current session's realtime log path. Cached: the crash dir + PID are constant
/// for the process, so this used to re-read the APPDATA env var and allocate a fresh
/// PathBuf on *every* `log_line()` call (the hottest path in the app).
fn get_realtime_log_path() -> &'static Path {
    static PATH: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    PATH.get_or_init(|| get_crash_dir(None).join(format!("session_{}.log", std::process::id())))
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
        handle.path()
            .app_data_dir().ok()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Crashes")
    } else {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
        PathBuf::from(appdata).join("com.bettermm.desktop").join("Crashes")
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
    if let Ok(mut file) = fs::File::create(log_path) {
        let _ = writeln!(file, "--- NEW SESSION STARTED AT {} (PID: {}) ---", chrono::Local::now().to_rfc3339(), my_pid);
        let _ = file.sync_all();
    }

    // 3. Reports written by older versions carried secrets in clear; clean them once, off
    //    the startup path.
    std::thread::spawn(redact_existing_reports);
}

// function removed as consolidate into generate_report

/// Helper to generate a report from already loaded log content (used for orphans)
fn generate_report_from_content(is_crash: bool, reason: &str, app_state: Option<String>, log_content: String) -> Option<PathBuf> {
    generate_report_internal(is_crash, reason, app_state, Some(log_content), None, None)
}

// ─── COLLECTE DES DONNÉES DIAGNOSTICS ────────────────────────────────────────

// `full` = crash reports, where the extra detail is worth the cost. A CLEAN exit uses the
// LIGHT path: `new_all()`+`refresh_all()` enumerates every process, disk, network and component
// on the machine — hundreds of ms to seconds on Windows — and made closing the app feel slow.
// The light path refreshes only global memory + THIS process (and takes the CPU count from the
// std lib), which is all the report actually shows, and returns in microseconds.
fn get_system_snapshot_impl(full: bool) -> String {
    let pid = Pid::from(std::process::id() as usize);
    let mut s = System::new();
    if full {
        s.refresh_all();
    } else {
        s.refresh_memory();
        s.refresh_process(pid);
    }

    let mut info = String::new();
    info.push_str("=== SYSTEM DIAGNOSTICS ===\n");
    info.push_str(&format!("OS Name:         {}\n", System::name().unwrap_or_default()));
    info.push_str(&format!("OS Version:      {}\n", System::os_version().unwrap_or_default()));
    info.push_str(&format!("Kernel Version:  {}\n", System::kernel_version().unwrap_or_default()));
    info.push_str(&format!("Total Memory:    {} MB\n", s.total_memory() / 1024 / 1024));
    info.push_str(&format!("Free Memory:     {} MB\n", s.free_memory() / 1024 / 1024));
    let cpu_count = if full { s.cpus().len() } else { std::thread::available_parallelism().map(|n| n.get()).unwrap_or(0) };
    info.push_str(&format!("CPU Count:       {}\n", cpu_count));

    info.push_str("\n=== PROCESS INFO ===\n");
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
    generate_report_internal(is_crash, reason, app_state, override_log, Some(get_realtime_log_path().to_path_buf()), frontend_dump)
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

    let logs = if let Some(content) = override_log {
        content
    } else {
        LOG_BUFFER.lock().map(|buf| {
            buf.iter().cloned().collect::<Vec<String>>().join("\n")
        }).unwrap_or_default()
    };

    let parts = ReportParts {
        is_crash,
        reason: reason.to_string(),
        backtrace: if is_crash { Some(format!("{:?}", Backtrace::new())) } else { None },
        // Full enumeration only for crashes; clean exits use the light path.
        system_info: get_system_snapshot_impl(is_crash),
        logs,
        app_state,
        frontend_dump,
        replay: if is_crash { read_crash_replay() } else { None },
    };

    // Every secret the live data file holds, whether or not a snapshot is attached: the
    // panic hook and the frontend dump carry no snapshot, but a token can still sit in a log
    // line, an IPC argument or a recorded input.
    let redactor = redactor_for_report(&parts, &data_file_path());

    let file = fs::File::create(&zip_path).ok()?;
    if write_report_zip(file, &parts, &redactor).is_err() {
        let _ = fs::remove_file(&zip_path);
        return None;
    }

    // Archivage et nettoyage
    archive_old_reports(&report_dir, &get_archive_dir(is_crash));

    // Après avoir généré le zip (qui contient les logs), on vide le log temps réel spécifié.
    if let Some(path) = log_to_delete {
        let _ = fs::remove_file(path);
    }

    Some(zip_path)
}

/// `<app data>/data.json` — the file whose secrets must never reach a report.
fn data_file_path() -> PathBuf {
    get_crash_dir(None)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
        .join("data.json")
}

/// The session recording just before the crash. BMM records the current session in memory
/// and flushes a single rolling buffer to <app_data>/last_crash_session.bmmreplay (NOT a saved
/// replay — that only happens if the user enables the Session recorder). Crash-only: reading
/// and compressing a multi-MB replay on every CLEAN close was a large, pointless part of the
/// shutdown time.
fn read_crash_replay() -> Option<Vec<u8>> {
    let app_data = get_crash_dir(None).parent().map(|p| p.to_path_buf())?;
    let buffer = app_data.join("last_crash_session.bmmreplay");
    let chosen = if buffer.exists() {
        Some(buffer)
    } else {
        // Back-compat: fall back to the freshest saved replay if no buffer yet.
        fs::read_dir(app_data.join("Replays")).ok().and_then(|entries| {
            let mut files: Vec<PathBuf> = entries
                .filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("bmmreplay"))
                .collect();
            files.sort_by_key(|p| {
                fs::metadata(p).and_then(|m| m.modified()).unwrap_or(std::time::SystemTime::UNIX_EPOCH)
            });
            files.pop()
        })
    };
    chosen.and_then(|p| fs::read(p).ok())
}

/// Everything a report holds, gathered before a byte is written.
///
/// There is deliberately no DxDiag here. It used to be generated into every crash zip, so a
/// crash zip attached to a report carried the full hardware inventory even with the
/// "Include DxDiag" box unticked. The report screens attach a fresh DxDiag themselves when,
/// and only when, that box is ticked (`get_dxdiag_report`).
struct ReportParts {
    is_crash: bool,
    reason: String,
    backtrace: Option<String>,
    system_info: String,
    logs: String,
    app_state: Option<String>,
    frontend_dump: Option<String>,
    replay: Option<Vec<u8>>,
}

fn redactor_for_report(parts: &ReportParts, data_file: &Path) -> crate::commands::report_redact::Redactor {
    let mut r = crate::commands::report_redact::Redactor::new();
    r.absorb_data_file(data_file);
    if let Some(s) = &parts.app_state { r.absorb_json_text(s); }
    if let Some(s) = &parts.frontend_dump { r.absorb_json_text(s); }
    r
}

/// Write a report archive. Split from the file handling so what goes INTO a report — and
/// that no secret does — is testable against an in-memory buffer.
fn write_report_zip<W: Write + std::io::Seek>(
    w: W,
    parts: &ReportParts,
    redactor: &crate::commands::report_redact::Redactor,
) -> zip::result::ZipResult<W> {
    let mut zip = zip::ZipWriter::new(w);
    let opts = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // 0. The note that says this report was redacted — and marks it as done for the
    //    one-time pass over reports from older versions.
    zip.start_file(crate::commands::report_redact::REDACTION_ENTRY, opts)?;
    zip.write_all(crate::commands::report_redact::redaction_note().as_bytes())?;

    // 1. metadata.txt (a panic message can quote anything, a URL with a password included)
    let mut meta = format!("BMM VERSION: {}\n", env!("CARGO_PKG_VERSION"));
    meta.push_str(&format!("TIMESTAMP:   {}\n", chrono::Local::now().to_rfc3339()));
    meta.push_str(&format!("REASON:      {}\n", parts.reason));
    zip.start_file("metadata.txt", opts)?;
    zip.write_all(redactor.scrub_text(&meta).as_bytes())?;

    // 2. stacktrace.txt (crash only)
    if let Some(bt) = &parts.backtrace {
        zip.start_file("stacktrace.txt", opts)?;
        zip.write_all(redactor.scrub_text(bt).as_bytes())?;
    }

    // 3. system_info.txt
    zip.start_file("system_info.txt", opts)?;
    zip.write_all(redactor.scrub_text(&parts.system_info).as_bytes())?;

    // 4. app_logs.txt
    zip.start_file("app_logs.txt", opts)?;
    zip.write_all(redactor.scrub_text(&parts.logs).as_bytes())?;

    // 5. state_snapshot.json — the data file, secret fields replaced by markers.
    if let Some(state) = &parts.app_state {
        zip.start_file("state_snapshot.json", opts)?;
        zip.write_all(redactor.redact_json_text(state).as_bytes())?;
    }

    // 5b. frontend_dump.json — carries IPC arguments, so tokens typed into Settings too.
    if let Some(dump) = &parts.frontend_dump {
        zip.start_file("frontend_dump.json", opts)?;
        zip.write_all(redactor.redact_json_text(dump).as_bytes())?;
    }

    // 6. session_replay.bmmreplay (crash only). A recorded input can hold a pasted token.
    if parts.is_crash {
        if let Some(replay) = &parts.replay {
            zip.start_file("session_replay.bmmreplay", opts)?;
            zip.write_all(&redactor.scrub_bytes(replay))?;
        }
    }

    zip.finish()
}

/// Rewrite one report written by an older BMM: every entry through the redactor, DxDiag
/// dropped. Returns None when the archive is already redacted (it carries the note) or
/// cannot be read.
fn rewrite_report_zip_bytes(
    bytes: &[u8],
    redactor: &crate::commands::report_redact::Redactor,
) -> Option<Vec<u8>> {
    use crate::commands::report_redact::{redaction_note, REDACTION_ENTRY};
    let mut src = zip::ZipArchive::new(std::io::Cursor::new(bytes)).ok()?;
    if src.by_name(REDACTION_ENTRY).is_ok() {
        return None; // already clean
    }
    let mut out = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let opts = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    out.start_file(REDACTION_ENTRY, opts).ok()?;
    out.write_all(redaction_note().as_bytes()).ok()?;
    for i in 0..src.len() {
        let mut f = src.by_index(i).ok()?;
        let name = f.name().to_string();
        if name.to_ascii_lowercase().contains("dxdiag") {
            continue;
        }
        let mut buf = Vec::new();
        use std::io::Read;
        f.read_to_end(&mut buf).ok()?;
        let clean = if name.to_ascii_lowercase().ends_with(".json") {
            match std::str::from_utf8(&buf) {
                Ok(s) => redactor.redact_json_text(s).into_bytes(),
                Err(_) => redactor.scrub_bytes(&buf),
            }
        } else {
            redactor.scrub_bytes(&buf)
        };
        out.start_file(name, opts).ok()?;
        out.write_all(&clean).ok()?;
    }
    Some(out.finish().ok()?.into_inner())
}

/// One-time pass over every report an older BMM left on disk (Reports/ and Archive/): each
/// zip without the redaction note is rewritten through the redactor, DxDiag dropped. Those
/// zips are the ones people attach or export, and they carried the data file in clear.
/// Idempotent — a rewritten zip carries the note and is skipped next time.
pub fn redact_existing_reports() {
    let mut r = crate::commands::report_redact::Redactor::new();
    r.absorb_data_file(&data_file_path());
    let base = get_crash_dir(None);
    for sub in ["Reports/Crash", "Reports/Session", "Archive/Crash", "Archive/Session"] {
        let Ok(entries) = fs::read_dir(base.join(sub)) else { continue };
        for e in entries.flatten() {
            let path = e.path();
            if path.extension().and_then(|s| s.to_str()) != Some("zip") {
                continue;
            }
            let Ok(bytes) = fs::read(&path) else { continue };
            let Some(clean) = rewrite_report_zip_bytes(&bytes, &r) else { continue };
            // Temp + rename: an interrupted rewrite must never leave a half zip behind.
            let tmp = path.with_extension("zip.redacting");
            if fs::write(&tmp, &clean).is_ok() {
                let mtime = fs::metadata(&path).and_then(|m| m.modified()).ok();
                if fs::rename(&tmp, &path).is_ok() {
                    // Keep the date: the report lists and the archive rotation sort by it.
                    if let (Some(t), Ok(f)) = (mtime, fs::OpenOptions::new().write(true).open(&path)) {
                        let _ = f.set_modified(t);
                    }
                    log_line(format!("[CRASH_LOGGER] Redacted secrets in older report {:?}", path.file_name().unwrap_or_default()));
                } else {
                    let _ = fs::remove_file(&tmp);
                }
            }
        }
    }
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
        crate::commands::proc::hidden_command("explorer").arg(dir.to_string_lossy().as_ref()).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        crate::commands::proc::hidden_command("xdg-open").arg(dir.to_string_lossy().as_ref()).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_crash_zip(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() { return Err("Zip path error".into()); }
    
    #[cfg(target_os = "windows")]
    {
        crate::commands::proc::hidden_command("explorer")
            .args(["/select,", p.to_string_lossy().as_ref()])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Some(parent) = p.parent() {
            crate::commands::proc::hidden_command("xdg-open").arg(parent.to_string_lossy().as_ref()).spawn().map_err(|e| e.to_string())?;
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
    // <appdata>/com.bettermm.desktop/api-activity.log  (sibling of the Crashes dir)
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
    if limit == 0 { return Vec::new(); }
    let path = get_api_log_path();
    let Ok(mut f) = fs::File::open(&path) else { return Vec::new() };
    let len = match f.metadata() { Ok(m) => m.len(), Err(_) => return Vec::new() };
    // Read only the TAIL, not the whole (up to ~1.5 MB) file: the Plugins & API panel
    // polls this for the last ~N lines. Budget ~1 KB per JSON entry with a 64 KB floor,
    // capped at the file length. If we didn't start at byte 0 the first line may be
    // partial, so it's dropped.
    use std::io::{Read, Seek, SeekFrom};
    let want = ((limit as u64).saturating_mul(1024).max(64 * 1024)).min(len);
    let start = len - want;
    if start > 0 && f.seek(SeekFrom::Start(start)).is_err() { return Vec::new(); }
    let mut buf = Vec::with_capacity(want as usize);
    if (&mut f).take(want).read_to_end(&mut buf).is_err() { return Vec::new(); }
    let text = String::from_utf8_lossy(&buf);
    let mut lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    if start > 0 && !lines.is_empty() { lines.remove(0); } // drop the partial first line
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
        let _ = crate::commands::proc::hidden_command("dxdiag")
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

/// Guard: only allow operating on .zip files inside BMM's own Crashes tree.
fn is_managed_crash_zip(path: &str) -> bool {
    let p = std::path::Path::new(path);
    if p.extension().and_then(|s| s.to_str()) != Some("zip") {
        return false;
    }
    let base = get_crash_dir(None);
    match (fs::canonicalize(p), fs::canonicalize(&base)) {
        (Ok(fp), Ok(bp)) => fp.starts_with(&bp),
        _ => false,
    }
}

/// Delete a crash/session report .zip (must live inside the Crashes tree).
#[tauri::command]
pub fn delete_crash_report(path: String) -> Result<(), String> {
    if !is_managed_crash_zip(&path) {
        return Err("Not a managed crash report".into());
    }
    fs::remove_file(&path).map_err(|e| e.to_string())
}

/// Copy a file to a user-chosen destination (used by the crash manager's Export).
#[tauri::command]
pub fn copy_file(src: String, dest: String) -> Result<(), String> {
    fs::copy(&src, &dest).map(|_| ()).map_err(|e| e.to_string())
}

/// Read a report .zip for in-app analysis: metadata, app logs (tail), the file
/// list, and whether a session recording is attached. No need to import anything.
#[tauri::command]
pub fn read_crash_report(path: String) -> Result<serde_json::Value, String> {
    if !is_managed_crash_zip(&path) {
        return Err("Not a managed crash report".into());
    }
    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut files: Vec<String> = Vec::new();
    let mut metadata = String::new();
    let mut system_info = String::new();
    let mut logs = String::new();
    let mut has_session = false;
    for i in 0..zip.len() {
        let mut f = match zip.by_index(i) {
            Ok(f) => f,
            Err(_) => continue,
        };
        let name = f.name().to_string();
        files.push(name.clone());
        if name == "session_replay.bmmreplay" {
            has_session = true;
            continue;
        }
        use std::io::Read;
        match name.as_str() {
            "metadata.txt" => {
                let mut s = String::new();
                let _ = (&mut f).take(16 * 1024).read_to_string(&mut s);
                metadata = s;
            }
            "system_info.txt" => {
                let mut s = String::new();
                let _ = (&mut f).take(32 * 1024).read_to_string(&mut s);
                system_info = s;
            }
            "app_logs.txt" => {
                // Keep the tail (most recent ~64 KB) — that's where a crash shows.
                let mut s = String::new();
                let _ = f.read_to_string(&mut s);
                logs = if s.len() > 64 * 1024 {
                    s[s.len() - 64 * 1024..].to_string()
                } else {
                    s
                };
            }
            _ => {}
        }
    }
    Ok(serde_json::json!({
        "metadata": metadata,
        "systemInfo": system_info,
        "logs": logs,
        "files": files,
        "hasSession": has_session,
    }))
}

/// Allow-list of extensions we will surface as readable TEXT from a report zip.
/// Anything else (binaries, the .bmmreplay recording, …) is refused by the reader.
fn is_readable_text_ext(name: &str) -> bool {
    matches!(
        std::path::Path::new(&name.to_ascii_lowercase())
            .extension()
            .and_then(|s| s.to_str()),
        Some("txt" | "md" | "log" | "json" | "cfg" | "toml" | "csv" | "yaml" | "yml" | "ini")
    )
}

/// Hard cap on how much of a single report file we read into memory (2 MB).
const CRASH_FILE_MAX_BYTES: u64 = 2 * 1024 * 1024;

/// Read ONE text file out of a managed report .zip so the user can inspect any of
/// its contents in-app (not just the 3 summarised files).
///
/// Security:
/// - the archive itself must live inside BMM's own Crashes tree
///   (`is_managed_crash_zip` canonicalises + checks the prefix → CWE-22 on the
///   zip path is covered);
/// - the entry is matched by its EXACT stored name via `by_name` and read straight
///   from the archive — nothing is written to disk, so there is no Zip-Slip / path
///   traversal on the entry either;
/// - only allow-listed text extensions are served, and reads are capped at 2 MB and
///   lossy-decoded (a split multibyte boundary or non-UTF-8 bytes can't error out).
/// The frontend renders the returned string as TEXT (escaped), never as HTML.
#[tauri::command]
pub fn read_crash_report_file(path: String, entry: String) -> Result<serde_json::Value, String> {
    if !is_managed_crash_zip(&path) {
        return Err("Not a managed crash report".into());
    }
    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    read_zip_text_entry(&mut zip, &entry)
}

/// Read one allow-listed text entry from an open report archive. Split out of the
/// command so the security-relevant core — extension allow-list, EXACT-name match
/// (never a path-normalised one → no Zip-Slip), size cap and lossy decode — is
/// unit-testable without the filesystem path guard. Nothing is written to disk.
fn read_zip_text_entry<R: std::io::Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    entry: &str,
) -> Result<serde_json::Value, String> {
    if !is_readable_text_ext(entry) {
        return Err("This file type can't be opened as text".into());
    }
    let mut f = zip
        .by_name(entry)
        .map_err(|_| "File not found in report".to_string())?;
    let declared = f.size();
    use std::io::Read;
    let mut bytes: Vec<u8> = Vec::new();
    (&mut f)
        .take(CRASH_FILE_MAX_BYTES)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "name": entry,
        "content": String::from_utf8_lossy(&bytes).to_string(),
        "size": declared,
        "truncated": declared > CRASH_FILE_MAX_BYTES,
    }))
}

/// Extract the attached session recording (session_replay.bmmreplay) from a report
/// zip and return its JSON so the in-app player can replay it directly.
#[tauri::command]
pub fn read_crash_session(path: String) -> Result<String, String> {
    if !is_managed_crash_zip(&path) {
        return Err("Not a managed crash report".into());
    }
    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut f = zip
        .by_name("session_replay.bmmreplay")
        .map_err(|_| "No session recording in this report".to_string())?;
    use std::io::Read;
    let mut s = String::new();
    f.read_to_string(&mut s).map_err(|e| e.to_string())?;
    Ok(s)
}

// ─── TESTS: D1 sandboxed report-file reader ──────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Build an in-memory report zip from (name, bytes) pairs.
    fn make_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut w = zip::ZipWriter::new(&mut buf);
            for (name, data) in entries {
                let opts = zip::write::FileOptions::default()
                    .compression_method(zip::CompressionMethod::Stored);
                w.start_file(*name, opts).unwrap();
                w.write_all(data).unwrap();
            }
            w.finish().unwrap();
        }
        buf.into_inner()
    }

    fn open(bytes: Vec<u8>) -> zip::ZipArchive<std::io::Cursor<Vec<u8>>> {
        zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap()
    }

    #[test]
    fn ext_allowlist_accepts_text_and_rejects_the_rest() {
        for ok in ["a.txt", "a.md", "a.log", "a.json", "a.cfg", "a.toml", "a.csv",
                   "a.yaml", "a.yml", "a.ini", "A.TXT", "deep/dir/x.LOG"] {
            assert!(is_readable_text_ext(ok), "{ok} should be readable");
        }
        for bad in ["a.exe", "a.dll", "a.png", "a.zip", "a.bmmreplay",
                    "session_replay.bmmreplay", "noext", "a.sh", "a.bat"] {
            assert!(!is_readable_text_ext(bad), "{bad} must be rejected");
        }
    }

    #[test]
    fn reads_a_text_entry() {
        let mut z = open(make_zip(&[("notes.txt", b"hello crash log")]));
        let v = read_zip_text_entry(&mut z, "notes.txt").unwrap();
        assert_eq!(v["content"].as_str().unwrap(), "hello crash log");
        assert_eq!(v["truncated"].as_bool().unwrap(), false);
        assert_eq!(v["size"].as_u64().unwrap(), 15);
    }

    #[test]
    fn rejects_binary_extension_even_if_present() {
        let mut z = open(make_zip(&[("evil.exe", b"MZ\x90\x00")]));
        assert!(read_zip_text_entry(&mut z, "evil.exe").is_err());
    }

    #[test]
    fn rejects_the_binary_replay_via_ext_gate() {
        let mut z = open(make_zip(&[("session_replay.bmmreplay", b"{}")]));
        assert!(read_zip_text_entry(&mut z, "session_replay.bmmreplay").is_err());
    }

    #[test]
    fn missing_or_traversal_named_entry_is_not_found() {
        // The archive holds only notes.txt. A traversal-style name that isn't the
        // EXACT stored entry returns "not found" (by_name is exact; nothing is written
        // to disk, so there is no path-traversal / Zip-Slip surface to begin with).
        let mut z = open(make_zip(&[("notes.txt", b"ok")]));
        assert!(read_zip_text_entry(&mut z, "../../etc/passwd").is_err());
        assert!(read_zip_text_entry(&mut z, "../secret.txt").is_err());
        assert!(read_zip_text_entry(&mut z, "missing.log").is_err());
    }

    #[test]
    fn caps_oversized_entry_at_2mb() {
        let big = vec![b'a'; (CRASH_FILE_MAX_BYTES as usize) + 500_000];
        let mut z = open(make_zip(&[("huge.log", &big)]));
        let v = read_zip_text_entry(&mut z, "huge.log").unwrap();
        assert_eq!(v["truncated"].as_bool().unwrap(), true);
        assert_eq!(v["size"].as_u64().unwrap(), big.len() as u64);
        // Only the first 2 MB is materialised into the returned string.
        assert_eq!(v["content"].as_str().unwrap().len(), CRASH_FILE_MAX_BYTES as usize);
    }

    #[test]
    fn lossy_decodes_non_utf8_without_panicking() {
        let mut z = open(make_zip(&[("bad.txt", &[0xff, 0xfe, b'h', b'i'])]));
        let v = read_zip_text_entry(&mut z, "bad.txt").unwrap();
        assert!(v["content"].as_str().unwrap().contains("hi"));
    }

    // ─── No secret leaves in a report ────────────────────────────────────────
    //
    // A report zip is made to be attached to a bug report. These build one from a data file
    // seeded with fake secrets — written by the real AppData serializer, so a field that is
    // renamed or moved is still what gets tested — and look for every secret in every byte.

    const FAKE_GITHUB: &str = "ghp_FAKEfakeFAKEfakeFAKEfakeFAKEfake1234";
    const FAKE_API: &str = "11111111-2222-4333-8444-555555555555";
    const FAKE_SCHED: &str = "99999999-8888-4777-8666-555555555555";
    const FAKE_PLUGIN_TOKEN: &str = "plg-tok-7f3a9c2e1b5d4f6a";
    const FAKE_REPO_PW: &str = "repo-pw-Zq8xLm2v";
    const FAKE_USERINFO_PW: &str = "userinfo-Kp4Nw9x";
    const ALL_FAKES: &[&str] = &[FAKE_GITHUB, FAKE_API, FAKE_SCHED, FAKE_PLUGIN_TOKEN, FAKE_REPO_PW, FAKE_USERINFO_PW];

    fn seeded_data_file(dir: &Path) -> (PathBuf, String) {
        let mut d = crate::state::AppData::default();
        d.settings.github_token = FAKE_GITHUB.into();
        d.settings.api_token = FAKE_API.into();
        d.settings.os_schedule_key = FAKE_SCHED.into();
        d.settings.plugin_tokens.insert(FAKE_PLUGIN_TOKEN.into(), "com.example.plugin".into());
        d.settings.connected_server_repos.push(crate::state::ConnectedServerRepo {
            url: format!("https://repo.example/r.json?password={FAKE_REPO_PW}"),
            name: "protected".into(),
            ..Default::default()
        });
        d.settings.connected_server_repos.push(crate::state::ConnectedServerRepo {
            url: format!("https://alice:{FAKE_USERINFO_PW}@repo.example/other.json"),
            name: "userinfo".into(),
            ..Default::default()
        });
        let text = serde_json::to_string_pretty(&d).unwrap();
        let path = dir.join("data.json");
        fs::write(&path, &text).unwrap();
        (path, text)
    }

    fn secret_laden_parts(app_state: Option<String>) -> ReportParts {
        ReportParts {
            is_crash: true,
            reason: "test".into(),
            backtrace: Some("bt".into()),
            system_info: "sys".into(),
            logs: format!(
                "[UI] saved github token {FAKE_GITHUB}\n\
                 [API] request with Authorization: Bearer {FAKE_API}\n\
                 [API] plain {FAKE_API} and {FAKE_SCHED}\n\
                 [API] plugin call from {FAKE_PLUGIN_TOKEN}\n\
                 [REPO] GET https://repo.example/r.json?password={FAKE_REPO_PW}\n"
            ),
            app_state,
            frontend_dump: Some(serde_json::json!({
                "reason": "CRASH",
                "ipcCalls": [{ "cmd": "save_settings", "args": { "githubToken": FAKE_GITHUB, "apiToken": FAKE_API } }],
                "appState": { "osScheduleKey": FAKE_SCHED, "note": format!("typed {FAKE_PLUGIN_TOKEN}") },
            }).to_string()),
            replay: Some(format!(
                r#"{{"events":[{{"type":3,"data":{{"source":5,"text":"{FAKE_API}"}}}},{{"type":3,"data":{{"text":"{FAKE_GITHUB} {FAKE_SCHED}"}}}}]}}"#
            ).into_bytes()),
        }
    }

    /// Every entry of an archive, decompressed.
    fn entries(bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
        use std::io::Read;
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        (0..z.len()).map(|i| {
            let mut f = z.by_index(i).unwrap();
            let mut b = Vec::new();
            f.read_to_end(&mut b).unwrap();
            (f.name().to_string(), b)
        }).collect()
    }

    fn assert_no_secret(archive: &[u8]) {
        let contains = |hay: &[u8], needle: &str| hay.windows(needle.len()).any(|w| w == needle.as_bytes());
        for s in ALL_FAKES {
            assert!(!contains(archive, s), "secret {s} found in the raw archive bytes");
            for (name, body) in entries(archive) {
                assert!(!contains(&body, s), "secret {s} found in entry {name}:\n{}", String::from_utf8_lossy(&body));
            }
        }
        // A marker, never a partial value.
        for (name, body) in entries(archive) {
            let text = String::from_utf8_lossy(&body);
            assert!(!text.contains("ghp_FAKE"), "a github-token prefix survived in {name}");
        }
    }

    #[test]
    fn clean_exit_style_report_carries_no_secret() {
        let dir = tempfile::tempdir().unwrap();
        let (data_path, text) = seeded_data_file(dir.path());
        let parts = secret_laden_parts(Some(text));
        let r = redactor_for_report(&parts, &data_path);
        let bytes = write_report_zip(std::io::Cursor::new(Vec::new()), &parts, &r).unwrap().into_inner();
        assert_no_secret(&bytes);

        let all = entries(&bytes);
        let state = all.iter().find(|(n, _)| n == "state_snapshot.json").expect("snapshot kept");
        let state = String::from_utf8_lossy(&state.1);
        assert!(state.contains(&crate::commands::report_redact::marker(FAKE_API.len())),
            "the snapshot says a value was redacted and how long it was:\n{state}");
        assert!(all.iter().any(|(n, _)| n == crate::commands::report_redact::REDACTION_ENTRY));
    }

    #[test]
    fn panic_style_report_without_snapshot_still_scrubs_by_the_data_file() {
        // The panic hook passes no snapshot and no dump: only the data file on disk knows
        // that the bare UUID in a log line is the API token.
        let dir = tempfile::tempdir().unwrap();
        let (data_path, _) = seeded_data_file(dir.path());
        let mut parts = secret_laden_parts(None);
        parts.frontend_dump = None;
        let r = redactor_for_report(&parts, &data_path);
        let bytes = write_report_zip(std::io::Cursor::new(Vec::new()), &parts, &r).unwrap().into_inner();
        assert_no_secret(&bytes);
    }

    #[test]
    fn crash_report_never_embeds_dxdiag() {
        let dir = tempfile::tempdir().unwrap();
        let (data_path, text) = seeded_data_file(dir.path());
        let parts = secret_laden_parts(Some(text));
        let r = redactor_for_report(&parts, &data_path);
        let bytes = write_report_zip(std::io::Cursor::new(Vec::new()), &parts, &r).unwrap().into_inner();
        assert!(entries(&bytes).iter().all(|(n, _)| !n.to_ascii_lowercase().contains("dxdiag")));
    }

    #[test]
    fn a_report_from_an_older_bmm_is_rewritten_clean() {
        // What an older BMM wrote: the snapshot in clear, and a DxDiag nobody asked for.
        let dir = tempfile::tempdir().unwrap();
        let (data_path, text) = seeded_data_file(dir.path());
        let legacy = make_zip(&[
            ("metadata.txt", b"BMM VERSION: old\n"),
            ("app_logs.txt", format!("token {FAKE_GITHUB} api {FAKE_API}").as_bytes()),
            ("state_snapshot.json", text.as_bytes()),
            ("dxdiag.txt", b"Machine name: DESKTOP-SECRET"),
            ("session_replay.bmmreplay", format!(r#"{{"t":"{FAKE_PLUGIN_TOKEN}"}}"#).as_bytes()),
        ]);
        let mut r = crate::commands::report_redact::Redactor::new();
        r.absorb_data_file(&data_path);
        let rewritten = rewrite_report_zip_bytes(&legacy, &r).expect("rewritten");
        assert_no_secret(&rewritten);
        let names: Vec<String> = entries(&rewritten).into_iter().map(|(n, _)| n).collect();
        assert!(!names.iter().any(|n| n == "dxdiag.txt"), "{names:?}");
        assert!(names.iter().any(|n| n == crate::commands::report_redact::REDACTION_ENTRY));
        // Idempotent: a clean report is left alone.
        assert!(rewrite_report_zip_bytes(&rewritten, &r).is_none());
    }

    #[test]
    fn managed_zip_guard_rejects_non_zip_and_nonexistent() {
        assert!(!is_managed_crash_zip("C:/whatever/report.txt")); // wrong extension → early false
        assert!(!is_managed_crash_zip("Z:/nope/does-not-exist.zip")); // canonicalize fails → false
    }
}
