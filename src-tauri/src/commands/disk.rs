use crate::state::AppState;
use serde::Serialize;
use sysinfo::Disks;
use tauri::State;
use std::collections::HashMap;

#[derive(Serialize)]
pub struct DiskLimitInfo {
    pub name: String,
    pub mount_point: String,
    pub is_removable: bool,
    pub kind: String, // "SSD", "HDD", "Unknown"
    pub current_limit_mb_s: Option<u64>,
}

#[tauri::command]
pub fn get_system_disks(state: State<AppState>) -> Vec<DiskLimitInfo> {
    let mut disks_list = Disks::new_with_refreshed_list();
    let data = state.data.lock().unwrap();
    
    let mut infos = Vec::new();
    for disk in disks_list.iter() {
        let mount_point = disk.mount_point().to_string_lossy().to_string();
        let name = disk.name().to_string_lossy().to_string();
        
        let limit = data.disk_limits.get(&mount_point).cloned();
        
        let kind = match disk.kind() {
            sysinfo::DiskKind::HDD => "HDD",
            sysinfo::DiskKind::SSD => "SSD",
            _ => "Unknown",
        }.to_string();

        infos.push(DiskLimitInfo {
            name: if name.is_empty() { mount_point.clone() } else { name },
            mount_point,
            is_removable: disk.is_removable(),
            kind,
            current_limit_mb_s: limit,
        });
    }
    
    infos
}

pub fn get_limit_for_path(state: &AppState, path: &std::path::Path) -> Option<u64> {
    let disks_list = Disks::new_with_refreshed_list();
    let data = state.data.lock().unwrap();
    
    let path_can = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let path_str = path_can.to_string_lossy().to_lowercase();
    
    let mut best_match: Option<(String, usize)> = None;
    
    for disk in disks_list.iter() {
        let mp = disk.mount_point().to_string_lossy().to_lowercase();
        // Allow match like C:\ matching C:\Jeux\...
        if path_str.starts_with(&mp) {
            let len = mp.len();
            if best_match.as_ref().map_or(true, |(_, l)| len > *l) {
                best_match = Some((disk.mount_point().to_string_lossy().to_string(), len));
            }
        }
    }
    
    if let Some((mp, _)) = best_match {
        data.disk_limits.get(&mp).cloned()
    } else {
        None
    }
}

#[tauri::command]
pub fn set_disk_limit(state: State<AppState>, mount_point: String, limit_mb_s: Option<u64>) -> Result<(), String> {
    {
        let mut data = state.data.lock().unwrap();
        if let Some(limit) = limit_mb_s {
            data.disk_limits.insert(mount_point, limit);
        } else {
            data.disk_limits.remove(&mount_point);
        }
    }
    let _ = state.save();
    Ok(())
}
