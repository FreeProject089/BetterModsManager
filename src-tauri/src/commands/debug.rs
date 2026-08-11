use std::time::Instant;
use serde::Serialize;
use lazy_static::lazy_static;
use crate::error::AppError;

lazy_static! {
    static ref START_TIME: Instant = Instant::now();
}

#[derive(Serialize)]
pub struct DebugStats {
    pub pid: u32,
    pub uptime_secs: u64,
    pub memory_mb: u64,
}


#[tauri::command]
pub async fn get_debug_stats() -> Result<DebugStats, AppError> {
    use sysinfo::System;
    let mut sys = System::new();
    
    let pid = std::process::id();
    let sys_pid = sysinfo::Pid::from(pid as usize);

    sys.refresh_process(sys_pid);
    
    let memory_mb = sys.process(sys_pid)
        .map(|p| p.memory() / 1024 / 1024)
        .unwrap_or(0);

    Ok(DebugStats {
        pid,
        uptime_secs: START_TIME.elapsed().as_secs(),
        memory_mb,
    })
}

#[tauri::command]
pub async fn get_rust_logs(max_lines: Option<usize>) -> Result<Vec<String>, AppError> {
    let limit = max_lines.unwrap_or(200);
    let logs = crate::commands::crash::get_log_lines();
    let start = if logs.len() > limit { logs.len() - limit } else { 0 };
    Ok(logs[start..].to_vec())
}

/// One file that answers "what state was BMM in?" — the production diagnostic.
///
/// In a dev build you attach a debugger; in the shipped app the user has none of that,
/// and "améliore le débogueur pour la prod" means exactly this: everything a bug report
/// needs, gathered in one click into one JSON the user can attach — instead of being
/// asked to screenshot the devtools, find a log file by hand, and recall their version.
///
/// Deliberately NOT included: paths of the user's mods, profile names, repo URLs.
/// A diagnostic travels — to Discord, to an issue tracker — and must be safe to post
/// as-is. What it carries is the app's own state: build, uptime, memory, and the same
/// in-memory log lines the Rust tab already shows.
#[tauri::command]
pub async fn export_diagnostics(app: tauri::AppHandle) -> Result<String, AppError> {
    use tauri::Manager;
    let stats = get_debug_stats().await?;
    let logs = crate::commands::crash::get_log_lines();
    let doc = serde_json::json!({
        "app": "better-mods-manager",
        "version": app.package_info().version.to_string(),
        // Which binary this is — a "debug" here explains every perf number in the file.
        "profile": if cfg!(debug_assertions) { "debug" } else { "release" },
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "pid": stats.pid,
        "uptime_secs": stats.uptime_secs,
        "memory_mb": stats.memory_mb,
        "exported_at": chrono::Local::now().to_rfc3339(),
        "log_lines": logs,
    });

    let dir = app.path().app_data_dir().map_err(|e| AppError::from(e.to_string()))?.join("diagnostics");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::from(e.to_string()))?;
    let path = dir.join(format!("bmm-diag-{}.json", chrono::Local::now().format("%Y%m%d-%H%M%S")));
    std::fs::write(&path, serde_json::to_vec_pretty(&doc).map_err(|e| AppError::from(e.to_string()))?)
        .map_err(|e| AppError::from(e.to_string()))?;
    Ok(path.to_string_lossy().to_string())
}
