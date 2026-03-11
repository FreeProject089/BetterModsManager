use crate::state::AppState;
use serde::Serialize;
use sysinfo::Disks;
use tauri::State;

#[derive(Serialize, Clone)]
pub struct DiskProfileUsage {
    pub profile_name: String,
    pub usage_type: String, // "game_directory" | "mod_folder" | "backup"
}

#[derive(Serialize)]
pub struct DiskLimitInfo {
    pub name: String,
    pub mount_point: String,
    pub is_removable: bool,
    pub kind: String,              // "SSD", "HDD", "Unknown"
    pub current_limit_mb_s: Option<u64>,
    pub total_space_bytes: u64,
    pub available_space_bytes: u64,
    pub file_system: String,
    pub is_cloud: bool,
    pub cloud_provider: Option<String>,
    pub profiles_using: Vec<DiskProfileUsage>,
}

#[derive(Serialize)]
pub struct BenchmarkResult {
    pub read_mb_s: f64,
    pub write_mb_s: f64,
    pub suggested_limit: u64,
}

/// Check if a path looks like a cloud sync folder
fn detect_cloud_provider(mount_point: &str, name: &str) -> Option<String> {
    let lower_mp = mount_point.to_lowercase();
    let lower_name = name.to_lowercase();

    // Google Drive (File Stream / mounted as drive letter)
    if lower_name.contains("google") || lower_name.contains("gdrive") {
        return Some("Google Drive".to_string());
    }
    // OneDrive
    if lower_name.contains("onedrive") {
        return Some("OneDrive".to_string());
    }
    // Dropbox
    if lower_name.contains("dropbox") {
        return Some("Dropbox".to_string());
    }
    // MEGA
    if lower_name.contains("mega") {
        return Some("MEGA".to_string());
    }
    // iCloud
    if lower_name.contains("icloud") {
        return Some("iCloud".to_string());
    }
    // Network / NAS (UNC paths or network-type filesystems)
    if lower_mp.starts_with("\\\\") || lower_mp.starts_with("//") {
        return Some("Network / NAS".to_string());
    }

    None
}

#[tauri::command]
pub fn get_system_disks(state: State<AppState>) -> Vec<DiskLimitInfo> {
    let disks_list = Disks::new_with_refreshed_list();
    let data = state.data.lock().unwrap();

    let profiles = &data.profiles;

    let mut infos = Vec::new();
    for disk in disks_list.iter() {
        let mount_point = disk.mount_point().to_string_lossy().to_string();
        let name = disk.name().to_string_lossy().to_string();
        let display_name = if name.is_empty() { mount_point.clone() } else { name.clone() };

        let limit = data.disk_limits.get(&mount_point).cloned();

        let kind = match disk.kind() {
            sysinfo::DiskKind::HDD => "HDD",
            sysinfo::DiskKind::SSD => "SSD",
            _ => "Unknown",
        }.to_string();

        let cloud_provider = detect_cloud_provider(&mount_point, &display_name);
        let is_cloud = cloud_provider.is_some();

        // Override kind label for cloud/network drives
        let final_kind = if is_cloud {
            if cloud_provider.as_deref() == Some("Network / NAS") {
                "Network".to_string()
            } else {
                "Cloud".to_string()
            }
        } else {
            kind
        };

        // Map profiles to this disk
        let mut mp_lower = mount_point.to_lowercase();
        if mp_lower.starts_with(r"\\?\") { mp_lower = mp_lower[4..].to_string(); }
        let mut profile_usages = Vec::new();
        for profile in profiles.iter() {
            let mut game_path = profile.game_path.to_string_lossy().to_lowercase();
            if game_path.starts_with(r"\\?\") { game_path = game_path[4..].to_string(); }
            
            let mut mods_path = profile.mods_path.to_string_lossy().to_lowercase();
            if mods_path.starts_with(r"\\?\") { mods_path = mods_path[4..].to_string(); }
            
            let mut backup_path = profile.backup_path.to_string_lossy().to_lowercase();
            if backup_path.starts_with(r"\\?\") { backup_path = backup_path[4..].to_string(); }

            if game_path.starts_with(&mp_lower) {
                profile_usages.push(DiskProfileUsage {
                    profile_name: profile.name.clone(),
                    usage_type: "game_directory".to_string(),
                });
            }
            if mods_path.starts_with(&mp_lower) {
                profile_usages.push(DiskProfileUsage {
                    profile_name: profile.name.clone(),
                    usage_type: "mod_folder".to_string(),
                });
            }
            if backup_path.starts_with(&mp_lower) {
                profile_usages.push(DiskProfileUsage {
                    profile_name: profile.name.clone(),
                    usage_type: "backup".to_string(),
                });
            }
        }

        let fs_name = disk.file_system().to_string_lossy().to_string();

        infos.push(DiskLimitInfo {
            name: display_name,
            mount_point,
            is_removable: disk.is_removable(),
            kind: final_kind,
            current_limit_mb_s: limit,
            total_space_bytes: disk.total_space(),
            available_space_bytes: disk.available_space(),
            file_system: if fs_name.is_empty() { "Unknown".to_string() } else { fs_name },
            is_cloud,
            cloud_provider,
            profiles_using: profile_usages,
        });
    }

    infos
}

pub fn get_limit_for_path(state: &AppState, path: &std::path::Path) -> Option<u64> {
    let disks_list = Disks::new_with_refreshed_list();
    let data = state.data.lock().unwrap();

    let path_can = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let mut path_str = path_can.to_string_lossy().to_lowercase();
    if path_str.starts_with(r"\\?\") {
        path_str = path_str[4..].to_string();
    }

    let mut best_match: Option<(String, usize)> = None;

    for disk in disks_list.iter() {
        let mut mp = disk.mount_point().to_string_lossy().to_lowercase();
        if mp.starts_with(r"\\?\") {
            mp = mp[4..].to_string();
        }

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

#[tauri::command]
pub fn benchmark_disk(mount_point: String) -> Result<BenchmarkResult, String> {
    use std::io::{Write, Read};
    use std::time::Instant;

    let test_dir = std::path::PathBuf::from(&mount_point);
    if !test_dir.exists() {
        return Err(format!("Mount point {} does not exist.", mount_point));
    }

    let test_filename = format!(".bmm_bench_{}.tmp", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_micros());
    
    let candidates = vec![
        test_dir.clone(), // Root of the drive
        std::env::temp_dir(), // System temp dir (will be checked if it's on this drive)
        test_dir.join("My Drive"), // Common for Google Drive
        test_dir.join("Mon Drive"), // Google Drive French
    ];

    let mut found_file = None;
    let mp_lower = mount_point.to_lowercase().replace("/", "\\");
    let mp_root = mp_lower.split('\\').next().unwrap_or("");
    
    for dir in candidates {
        if !dir.exists() { continue; }
        let dir_str = dir.to_string_lossy().to_string().to_lowercase().replace("/", "\\");
        let dir_root = dir_str.split('\\').next().unwrap_or("");
        
        if dir_root == mp_root {
            let candidate_file = dir.join(&test_filename);
            if let Ok(file) = std::fs::File::create(&candidate_file) {
                drop(file);
                found_file = Some(candidate_file);
                break;
            }
        }
    }

    let test_file = match found_file {
        Some(path) => path,
        None => return Err(format!("Access Denied: Impossible de créer le fichier de test sur ce disque.")),
    };

    let chunk_size: usize = 1024 * 1024; // 1 MB chunks
    let total_size: usize = 50 * 1024 * 1024; // 50 MB total
    let data_chunk = vec![0xABu8; chunk_size];
    let iterations = total_size / chunk_size;

    // ── Write benchmark ──
    let write_start = Instant::now();
    {
        let mut file = std::fs::File::create(&test_file)
            .map_err(|e| format!("Failed to create test file: {}", e))?;
        for _ in 0..iterations {
            file.write_all(&data_chunk)
                .map_err(|e| format!("Write error: {}", e))?;
        }
        file.sync_all()
            .map_err(|e| format!("Sync error: {}", e))?;
    }
    let write_elapsed = write_start.elapsed().as_secs_f64();
    let write_mb_s = if write_elapsed > 0.0 {
        (total_size as f64 / (1024.0 * 1024.0)) / write_elapsed
    } else {
        0.0
    };

    // ── Read benchmark ──
    let read_start = Instant::now();
    {
        let mut file = std::fs::File::open(&test_file)
            .map_err(|e| format!("Failed to open test file: {}", e))?;
        let mut buf = vec![0u8; chunk_size];
        for _ in 0..iterations {
            file.read_exact(&mut buf)
                .map_err(|e| format!("Read error: {}", e))?;
        }
    }
    let read_elapsed = read_start.elapsed().as_secs_f64();
    let read_mb_s = if read_elapsed > 0.0 {
        (total_size as f64 / (1024.0 * 1024.0)) / read_elapsed
    } else {
        0.0
    };

    // Cleanup
    let _ = std::fs::remove_file(&test_file);

    // Suggest ~70% of write speed, rounded to nearest 10
    let suggested = ((write_mb_s * 0.7) / 10.0).round() as u64 * 10;
    let suggested_limit = if suggested < 10 { 10 } else { suggested };

    Ok(BenchmarkResult {
        read_mb_s: (read_mb_s * 10.0).round() / 10.0,
        write_mb_s: (write_mb_s * 10.0).round() / 10.0,
        suggested_limit,
    })
}

#[derive(Serialize)]
pub struct DiskSpaceInfo {
    pub available_bytes: u64,
    pub total_bytes: u64,
    pub mount_point: String,
    pub free_percent: f64,
}

#[tauri::command]
pub fn check_disk_space(path: String) -> Result<DiskSpaceInfo, String> {
    let disks = Disks::new_with_refreshed_list();
    let target = std::path::Path::new(&path);
    let mut path_str = target.canonicalize().unwrap_or(target.to_path_buf())
        .to_string_lossy().to_lowercase();
    if path_str.starts_with(r"\\?\") { path_str = path_str[4..].to_string(); }

    let mut best: Option<(u64, u64, String, usize)> = None;
    for disk in disks.iter() {
        let mut mp = disk.mount_point().to_string_lossy().to_lowercase();
        if mp.starts_with(r"\\?\") { mp = mp[4..].to_string(); }
        if path_str.starts_with(&mp) {
            let len = mp.len();
            if best.as_ref().map_or(true, |(_, _, _, l)| len > *l) {
                best = Some((disk.available_space(), disk.total_space(), disk.mount_point().to_string_lossy().to_string(), len));
            }
        }
    }

    if let Some((available, total, mount_point, _)) = best {
        let free_percent = if total > 0 { (available as f64 / total as f64) * 100.0 } else { 0.0 };
        Ok(DiskSpaceInfo { available_bytes: available, total_bytes: total, mount_point, free_percent })
    } else {
        Err(format!("Impossible de trouver le disque pour: {}", path))
    }
}
