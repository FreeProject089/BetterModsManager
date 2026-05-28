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
