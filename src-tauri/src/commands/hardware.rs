//! `get_hardware_info`: what hw_detect.rs sees, for the Storage & performance screen and, later,
//! the governor's dashboard. Off the main thread: the first call enumerates GPUs (up to its
//! 3-second budget) and asks each disk driver for its bus type.

use crate::hw_detect::{detect, HardwareInfo};

#[tauri::command]
pub async fn get_hardware_info() -> Result<HardwareInfo, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let disks = sysinfo::Disks::new_with_refreshed_list();
        let mounts: Vec<String> = disks.iter().map(|d| d.mount_point().to_string_lossy().to_string()).collect();
        detect(&mounts)
    })
    .await
    .map_err(|e| e.to_string())
}
