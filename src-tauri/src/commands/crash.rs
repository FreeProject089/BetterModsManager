use std::fs;
use std::io::{Write, Read};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::collections::VecDeque;
use sysinfo::{System, Pid};
use backtrace::Backtrace;

// ─── CIRCULAR LOG BUFFER ──────────────────────────────────────────────────

const MAX_LOG_LINES: usize = 500;

lazy_static::lazy_static! {
    static ref LOG_BUFFER: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::with_capacity(MAX_LOG_LINES)));
}

/// Ajoute une ligne de log dans le buffer mémoire ET dans le fichier temps réel (flush immédiat).
pub fn log_line(line: impl Into<String>) {
    let s_line: String = line.into();
    let ts = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    let entry = format!("[{}] {}", ts, s_line);

    // 1. Buffer mémoire
    if let Ok(mut buf) = LOG_BUFFER.lock() {
        if buf.len() >= MAX_LOG_LINES {
            buf.pop_front();
        }
        buf.push_back(entry.clone());
    }

    // 2. Fichier temps réel (On l'ouvre, on écrit, on flush, on ferme pour être safe contre les crashes)
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(get_realtime_log_path()) {
        let _ = writeln!(file, "{}", entry);
        let _ = file.sync_all(); // Force l'écriture physique sur le disque
    }
}

// ─── DIRECTORIES & PATHS ─────────────────────────────────────────────────────

fn get_realtime_log_path() -> PathBuf {
    get_crash_dir(None).join("current_session.log")
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

// ─── INITIALISATION / RÉCUPÉRATION APRÈS CRASH ──────────────────────────────

pub fn init_session() {
    let log_path = get_realtime_log_path();
    let dir = log_path.parent().expect("Crashes dir not calculated");
    let _ = fs::create_dir_all(&dir);

    // Si un log existe déjà alors qu'on vient d'ouvrir l'app, c'est que l'app a été tuée sauvagement.
    if log_path.exists() {
        let mut old_content = String::new();
        if let Ok(mut file) = fs::File::open(&log_path) {
            let _ = file.read_to_string(&mut old_content);
        }
        
        if !old_content.trim().is_empty() {
            eprintln!("[CRASH_LOGGER] Recovering logs from previous session...");
            
            // On vérifie si les logs contiennent une trace de panic
            let was_panic = old_content.contains("[PANIC DETECTED]");
            
            // Génère un rapport automatique
            // On utilise le préfixe 'crash' seulement si on est sûr que c'était un vrai crash
            generate_report(was_panic, "Detected uncontrolled shutdown (dirty session)", None, Some(old_content));
        }
    }

    // On écrase/démarre un nouveau log "propre" pour cette session.
    if let Ok(mut file) = fs::File::create(&log_path) {
        let _ = writeln!(file, "--- NEW SESSION STARTED AT {} ---", chrono::Local::now().to_rfc3339());
        let _ = file.sync_all();
    }
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
) -> Option<PathBuf> {
    let dir = get_crash_dir(None);
    let _ = fs::create_dir_all(&dir);

    let prefix = if is_crash { "crash" } else { "session" };
    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let zip_path = dir.join(format!("{}_{}.zip", prefix, timestamp));

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

    // 6. dxdiag.txt (Windows Only, uniquement si crash pour booster la fermeture normale)
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
    
    // Nettoyage : Garde seulement les 10 derniers rapports pour éviter de saturer le disque
    if let Ok(entries) = fs::read_dir(&dir) {
        let mut files: Vec<_> = entries.flatten()
            .filter(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                name.starts_with("crash_") || name.starts_with("session_")
            })
            .collect();
        
        if files.len() > 10 {
            files.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
            for i in 0..(files.len() - 10) {
                let _ = fs::remove_file(files[i].path());
            }
        }
    }

    // Après avoir généré le zip (qui contient les logs), on vide le log temps réel.
    let _ = fs::remove_file(get_realtime_log_path());

    Some(zip_path)
}

// ─── PANIC HOOK ─────────────────────────────────────────────────────────────

pub fn setup_panic_hook() {
    use std::panic;
    panic::set_hook(Box::new(|info| {
        let reason = format!("{}", info);
        log_line(format!("[PANIC DETECTED] {}", reason));
        generate_report(true, &reason, None, None);
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
pub fn trigger_manual_crash_report() -> Result<String, String> {
    log_line("[DEBUG] Manual crash report triggered by user.");
    if let Some(path) = generate_report(true, "Manual Debug Trigger", None, None) {
        Ok(path.to_string_lossy().to_string())
    } else {
        Err("Failed to generate manual report".into())
    }
}

#[tauri::command]
pub fn get_crash_reports(app_handle: tauri::AppHandle) -> Vec<String> {
    let dir = get_crash_dir(Some(&app_handle));
    if !dir.exists() { return vec![]; }
    
    let mut files = fs::read_dir(&dir).ok().map(|entries| {
        entries.flatten()
            .filter(|e| e.file_name().to_string_lossy().starts_with("crash_"))
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

