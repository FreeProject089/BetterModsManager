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
    // Advanced Metrics
    pub network_latency: Option<u64>, // ms
    pub thread_count: Option<u32>,
    pub ram_virtual: Option<u64>, // MB
    pub ram_swap: Option<u64>, // MB
    pub async_tasks: Option<u32>,
    pub global_cpu: Option<f32>,
    pub process_uptime: Option<u64>,
}

#[tauri::command]
pub fn is_benchmark_enabled(_app_handle: tauri::AppHandle) -> bool {
    true
}

#[tauri::command]
pub fn set_advanced_benchmark_mode(state: State<'_, AppState>, enabled: bool) {
    state.advanced_benchmark.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
pub async fn start_benchmark(window: Window, state: State<'_, AppState>) -> Result<(), String> {
    if state.benchmark_running.load(Ordering::SeqCst) {
        return Ok(());
    }

    state.benchmark_running.store(true, Ordering::SeqCst);
    let running = state.benchmark_running.clone();
    let is_advanced = state.advanced_benchmark.clone();

    tauri::async_runtime::spawn(async move {
        let mut sys = System::new_all();
        let pid = sysinfo::get_current_pid().ok();
        let core_count = sys.cpus().len() as f32;
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(500))
            .build()
            .ok();

        while running.load(Ordering::SeqCst) {
            let advanced = is_advanced.load(Ordering::SeqCst);
            
            if advanced {
                sys.refresh_all();
            } else {
                sys.refresh_processes();
                sys.refresh_cpu();
            }
            
            let mut cpu = 0.0;
            let mut ram = 0;
            let mut disk_r = 0;
            let mut disk_w = 0;
            let threads = None;
            let mut v_ram = None;
            let mut swap = None;
            let mut global_cpu = None;
            let mut uptime = None;

            if let Some(p_id) = pid {
                if let Some(process) = sys.process(p_id) {
                    // Process CPU usage is usually normalized 0-100% across all cores in sysinfo
                    cpu = process.cpu_usage() / if core_count > 0.0 { core_count } else { 1.0 };
                    ram = process.memory() / 1024 / 1024; // MB
                    disk_r = process.disk_usage().read_bytes / 1024; // KB
                    disk_w = process.disk_usage().written_bytes / 1024; // KB
                    
                    if advanced {
                        // On windows/linux thread_count is usually available
                        // Depending on sysinfo version, it might be thread_count()
                        // If not available, we omit it
                        v_ram = Some(process.virtual_memory() / 1024 / 1024);
                        uptime = Some(process.run_time());
                    }
                }
            }

            if advanced {
                swap = Some(sys.used_swap() / 1024 / 1024);
                // Global CPU usage
                global_cpu = Some(sys.global_cpu_info().cpu_usage());
            }

            // Network Latency Check (Advanced only)
            let mut latency = None;
            if advanced {
                if let Some(ref c) = client {
                    let start = std::time::Instant::now();
                    if let Ok(_) = c.head("https://www.google.com").send().await {
                        latency = Some(start.elapsed().as_millis() as u64);
                    }
                }
            }

            let point = BenchmarkPoint {
                timestamp: SystemTime::now().duration_since(UNIX_EPOCH).expect("Time went backwards").as_secs(),
                cpu_usage: cpu,
                ram_usage: ram,
                disk_read: disk_r,
                disk_write: disk_w,
                current_mod: None,
                network_latency: latency,
                thread_count: threads, // Note: sysinfo 0.29+ has thread_count()
                ram_virtual: v_ram,
                ram_swap: swap,
                async_tasks: None,
                global_cpu,
                process_uptime: uptime,
            };

            let _ = window.emit("benchmark-point", point);
            
            let poll_rate = if advanced { 500 } else { 1000 };
            tokio::time::sleep(std::time::Duration::from_millis(poll_rate)).await;
        }
    });

    Ok(())
}

#[tauri::command]
pub fn stop_benchmark(state: State<AppState>) {
    state.benchmark_running.store(false, Ordering::SeqCst);
}

#[tauri::command]
pub fn read_file_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_benchmark_csv(data_json: String, dest_path: String) -> Result<(), String> {
    let points: Vec<BenchmarkPoint> = serde_json::from_str(&data_json)
        .map_err(|e| format!("Invalid data: {}", e))?;

    let mut csv = String::from("Timestamp,CPU (%),RAM (MB),Disk Read (KB/s),Disk Write (KB/s),Net Latency (ms),Virtual Mem (MB),Swap (MB),Global CPU (%),Uptime (s)\n");
    for p in points {
        csv.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{}\n",
            p.timestamp, 
            p.cpu_usage, 
            p.ram_usage, 
            p.disk_read, 
            p.disk_write,
            p.network_latency.unwrap_or(0),
            p.ram_virtual.unwrap_or(0),
            p.ram_swap.unwrap_or(0),
            p.global_cpu.unwrap_or(0.0),
            p.process_uptime.unwrap_or(0)
        ));
    }

    std::fs::write(dest_path, csv).map_err(|e| e.to_string())?;
    Ok(())
}
