use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use std::sync::Mutex;
use lazy_static::lazy_static;

#[derive(Debug)]
pub struct BanError;
impl warp::reject::Reject for BanError {}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct BanList {
    pub banned_ips: HashSet<String>,
    pub banned_keys: HashSet<String>,
}

lazy_static! {
    static ref BAN_LIST: Mutex<BanList> = Mutex::new(BanList::default());
}

pub fn get_ban_file_path(handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = handle.path_resolver().app_data_dir().ok_or("Impossible de trouver le dossier AppData")?;
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    }
    Ok(app_dir.join("bans.json"))
}

pub fn load_bans(handle: &AppHandle) -> Result<(), String> {
    let path = get_ban_file_path(handle)?;
    if path.exists() {
        let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let bans: BanList = serde_json::from_str(&content).unwrap_or_default();
        let mut lock = BAN_LIST.lock().unwrap_or_else(|p| p.into_inner());
        *lock = bans;
    }
    Ok(())
}

pub fn save_bans(handle: &AppHandle) -> Result<(), String> {
    let path = get_ban_file_path(handle)?;
    let lock = BAN_LIST.lock().unwrap_or_else(|p| p.into_inner());
    let content = serde_json::to_string_pretty(&*lock).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn ban_user(handle: tauri::AppHandle, ip: Option<String>, key: Option<String>) -> Result<(), String> {
    {
        let mut lock = BAN_LIST.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(ip_addr) = ip {
            if !ip_addr.trim().is_empty() {
                lock.banned_ips.insert(ip_addr);
            }
        }
        if let Some(creator_key) = key {
            if !creator_key.trim().is_empty() {
                lock.banned_keys.insert(creator_key);
            }
        }
    }
    
    // 1. Save to AppData
    save_bans(&handle)?;
    
    // 2. Also save to current serve path if active (for standalone server sync)
    use tauri::Manager;
    if let Some(state) = handle.try_state::<crate::commands::repo_server::RepoServerState>() {
        if let Some(path_str) = state.serve_path.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
            let path = PathBuf::from(path_str).join("bans.json");
            let lock = BAN_LIST.lock().unwrap_or_else(|p| p.into_inner());
            if let Ok(content) = serde_json::to_string_pretty(&*lock) {
                let _ = fs::write(path, content);
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn unban_user(handle: tauri::AppHandle, ip: Option<String>, key: Option<String>) -> Result<(), String> {
    {
        let mut lock = BAN_LIST.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(ip_addr) = ip {
            lock.banned_ips.remove(&ip_addr);
        }
        if let Some(creator_key) = key {
            lock.banned_keys.remove(&creator_key);
        }
    }

    // 1. Save to AppData
    save_bans(&handle)?;
    
    // 2. Also save to current serve path
    use tauri::Manager;
    if let Some(state) = handle.try_state::<crate::commands::repo_server::RepoServerState>() {
        if let Some(path_str) = state.serve_path.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
            let path = PathBuf::from(path_str).join("bans.json");
            let lock = BAN_LIST.lock().unwrap_or_else(|p| p.into_inner());
            if let Ok(content) = serde_json::to_string_pretty(&*lock) {
                let _ = fs::write(path, content);
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn get_ban_list() -> Result<BanList, String> {
    let lock = BAN_LIST.lock().unwrap_or_else(|p| p.into_inner());
    Ok(lock.clone())
}

pub fn is_banned(ip: &str, key: Option<&str>) -> bool {
    let lock = BAN_LIST.lock().unwrap_or_else(|p| p.into_inner());
    if lock.banned_ips.contains(ip) {
        return true;
    }
    if let Some(k) = key {
        if lock.banned_keys.contains(k) {
            return true;
        }
    }
    false
}

#[tauri::command]
pub fn unban_all(handle: tauri::AppHandle) -> Result<(), String> {
    {
        let mut lock = BAN_LIST.lock().unwrap_or_else(|p| p.into_inner());
        lock.banned_ips.clear();
        lock.banned_keys.clear();
    }
    save_bans(&handle)?;
    
    // Sync with server if active
    if let Some(state) = handle.try_state::<crate::commands::repo_server::RepoServerState>() {
        if let Some(path_str) = state.serve_path.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
            let path = PathBuf::from(path_str).join("bans.json");
            let lock = BAN_LIST.lock().unwrap_or_else(|p| p.into_inner());
            if let Ok(content) = serde_json::to_string_pretty(&*lock) {
                let _ = fs::write(path, content);
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn unban_bulk(handle: tauri::AppHandle, ips: Vec<String>, keys: Vec<String>) -> Result<(), String> {
    {
        let mut lock = BAN_LIST.lock().unwrap_or_else(|p| p.into_inner());
        for ip in ips {
            lock.banned_ips.remove(&ip);
        }
        for key in keys {
            lock.banned_keys.remove(&key);
        }
    }
    save_bans(&handle)?;
    
    if let Some(state) = handle.try_state::<crate::commands::repo_server::RepoServerState>() {
        if let Some(path_str) = state.serve_path.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
            let path = PathBuf::from(path_str).join("bans.json");
            let lock = BAN_LIST.lock().unwrap_or_else(|p| p.into_inner());
            if let Ok(content) = serde_json::to_string_pretty(&*lock) {
                let _ = fs::write(path, content);
            }
        }
    }
    Ok(())
}
