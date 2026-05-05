use sysinfo::System;
use tauri::{Window, State};
use std::sync::atomic::Ordering;
use crate::state::AppState;
use serde::{Serialize, Deserialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BenchmarkPoint {
    pub timestamp: u64,
    pub cpu_usage: f32,
    pub ram_usage: u64, // MB
    pub disk_read: u64, // KB/s
    pub disk_write: u64, // KB/s
    pub current_mod: Option<String>,
}

#[tauri::command]
pub fn is_benchmark_enabled(_app_handle: tauri::AppHandle) -> bool {
    // Force true as per user request to ensure it's always visible in builds
    true
}

#[tauri::command]
pub async fn start_benchmark(window: Window, state: State<'_, AppState>) -> Result<(), String> {
    if state.benchmark_running.load(Ordering::SeqCst) {
        return Ok(());
    }

    state.benchmark_running.store(true, Ordering::SeqCst);
    let running = state.benchmark_running.clone();

    tauri::async_runtime::spawn(async move {
        let mut sys = System::new_all();
        let pid = sysinfo::get_current_pid().ok();
        let core_count = sys.cpus().len() as f32;

        while running.load(Ordering::SeqCst) {
            sys.refresh_all();
            
            let mut cpu = 0.0;
            let mut ram = 0;
            let mut disk_r = 0;
            let mut disk_w = 0;

            if let Some(p_id) = pid {
                if let Some(process) = sys.process(p_id) {
                    cpu = process.cpu_usage() / if core_count > 0.0 { core_count } else { 1.0 };
                    ram = process.memory() / 1024 / 1024; // Convert to MB
                    disk_r = process.disk_usage().read_bytes / 1024; // KB
                    disk_w = process.disk_usage().written_bytes / 1024; // KB
                }
            }

            let point = BenchmarkPoint {
                timestamp: SystemTime::now().duration_since(UNIX_EPOCH).expect("Time went backwards").as_secs(),
                cpu_usage: cpu,
                ram_usage: ram,
                disk_read: disk_r,
                disk_write: disk_w,
                current_mod: None, // Will be updated via events if needed
            };

            let _ = window.emit("benchmark-point", point);
            
            // Wait 1 second before next poll
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    });

    Ok(())
}

#[tauri::command]
pub fn stop_benchmark(state: State<AppState>) {
    state.benchmark_running.store(false, Ordering::SeqCst);
}

#[tauri::command]
pub fn export_benchmark_csv(data_json: String, dest_path: String) -> Result<(), String> {
    let points: Vec<BenchmarkPoint> = serde_json::from_str(&data_json)
        .map_err(|e| format!("Invalid data: {}", e))?;

    let mut csv = String::from("Timestamp,CPU (%),RAM (MB),Disk Read (KB/s),Disk Write (KB/s)\n");
    for p in points {
        csv.push_str(&format!(
            "{},{},{},{},{}\n",
            p.timestamp, p.cpu_usage, p.ram_usage, p.disk_read, p.disk_write
        ));
    }

    std::fs::write(dest_path, csv).map_err(|e| e.to_string())?;
    Ok(())
}
