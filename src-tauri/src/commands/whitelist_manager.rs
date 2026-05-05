use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use std::sync::Mutex;
use lazy_static::lazy_static;

#[derive(Debug)]
pub struct WhitelistError;
impl warp::reject::Reject for WhitelistError {}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct Whitelist {
    pub enabled: bool,
    pub ips: HashSet<String>,
    pub keys: HashSet<String>,
}

lazy_static! {
    static ref WHITELIST: Mutex<Whitelist> = Mutex::new(Whitelist::default());
}

pub fn get_whitelist_file_path(handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = handle.path_resolver().app_data_dir().ok_or("Impossible de trouver le dossier AppData")?;
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    }
    Ok(app_dir.join("whitelist.json"))
}

pub fn load_whitelist(handle: &AppHandle) -> Result<(), String> {
    let path = get_whitelist_file_path(handle)?;
    if path.exists() {
        let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let whitelist: Whitelist = serde_json::from_str(&content).unwrap_or_default();
        let mut lock = WHITELIST.lock().unwrap_or_else(|p| p.into_inner());
        *lock = whitelist;
    }
    Ok(())
}

pub fn save_whitelist(handle: &AppHandle) -> Result<(), String> {
    let path = get_whitelist_file_path(handle)?;
    let content = {
        let lock = WHITELIST.lock().unwrap_or_else(|p| p.into_inner());
        serde_json::to_string_pretty(&*lock).map_err(|e| e.to_string())?
    };
    fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn toggle_whitelist(handle: AppHandle, enabled: bool) -> Result<(), String> {
    {
        let mut lock = WHITELIST.lock().unwrap_or_else(|p| p.into_inner());
        lock.enabled = enabled;
    }
    save_whitelist(&handle)?;
    sync_whitelist_to_serve_path(&handle);
    Ok(())
}

#[tauri::command]
pub fn add_to_whitelist(handle: AppHandle, ip: Option<String>, key: Option<String>) -> Result<(), String> {
    {
        let mut lock = WHITELIST.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(ip_addr) = ip {
            if !ip_addr.trim().is_empty() {
                lock.ips.insert(ip_addr);
            }
        }
        if let Some(creator_key) = key {
            if !creator_key.trim().is_empty() {
                lock.keys.insert(creator_key);
            }
        }
    }
    save_whitelist(&handle)?;
    sync_whitelist_to_serve_path(&handle);
    Ok(())
}

#[tauri::command]
pub fn remove_from_whitelist(handle: AppHandle, ip: Option<String>, key: Option<String>) -> Result<(), String> {
    {
        let mut lock = WHITELIST.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(ip_addr) = ip {
            lock.ips.remove(&ip_addr);
        }
        if let Some(creator_key) = key {
            lock.keys.remove(&creator_key);
        }
    }
    save_whitelist(&handle)?;
    sync_whitelist_to_serve_path(&handle);
    Ok(())
}

#[tauri::command]
pub fn get_whitelist() -> Result<Whitelist, String> {
    let lock = WHITELIST.lock().unwrap_or_else(|p| p.into_inner());
    Ok(lock.clone())
}

#[tauri::command]
pub fn clear_whitelist(handle: AppHandle) -> Result<(), String> {
    {
        let mut lock = WHITELIST.lock().unwrap_or_else(|p| p.into_inner());
        lock.ips.clear();
        lock.keys.clear();
    }
    save_whitelist(&handle)?;
    sync_whitelist_to_serve_path(&handle);
    Ok(())
}

pub fn is_whitelist_enabled() -> bool {
    let lock = WHITELIST.lock().unwrap_or_else(|p| p.into_inner());
    lock.enabled
}

pub fn is_whitelisted(ip: &str, key: Option<&str>) -> bool {
    let lock = WHITELIST.lock().unwrap_or_else(|p| p.into_inner());
    if lock.ips.contains(ip) {
        return true;
    }
    if let Some(k) = key {
        if lock.keys.contains(k) {
            return true;
        }
    }
    false
}

fn sync_whitelist_to_serve_path(handle: &AppHandle) {
    if let Some(state) = handle.try_state::<crate::commands::repo_server::RepoServerState>() {
        if let Some(path_str) = state.serve_path.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
            let path = PathBuf::from(path_str).join("whitelist.json");
            let lock = WHITELIST.lock().unwrap_or_else(|p| p.into_inner());
            if let Ok(content) = serde_json::to_string_pretty(&*lock) {
                let _ = fs::write(path, content);
            }
        }
    }
}
