use std::path::{Path, PathBuf};
use std::fs;
use std::time::Instant;
use serde::Serialize;
use base64::Engine;
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

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String, // Relative
    pub full_path: String, // Absolute
    pub is_dir: bool,
    pub children: Option<Vec<FileEntry>>,
}

#[tauri::command]
pub async fn get_project_files(app_handle: tauri::AppHandle) -> Result<Vec<FileEntry>, AppError> {
    let mut current = app_handle.path_resolver().resource_dir().ok_or_else(|| AppError::Internal("Impossible de trouver le dossier de ressources".to_string()))?;
    
    // Normalize UNC prefix (\\?\) which can break .exists() in some environments
    let mut s = current.to_string_lossy().to_string();
    if s.starts_with(r"\\?\") {
        s = s[4..].to_string();
    }
    current = PathBuf::from(s);

    let mut frontend_path = None;
    for _ in 0..4 {
        let check = current.join("frontend");
        if check.exists() && check.is_dir() {
            frontend_path = Some(check);
            break;
        }
        if !current.pop() { break; }
    }
    
    let frontend_path = frontend_path.ok_or_else(|| {
        AppError::Internal(format!("Frontend directory not found. Root searched: {:?}", current))
    })?;

    let mut tree = Vec::new();
    read_dir_recursive(&frontend_path, &frontend_path, &mut tree)?;
    
    Ok(tree)
}

fn read_dir_recursive(path: &Path, base: &Path, results: &mut Vec<FileEntry>) -> Result<(), AppError> {
    let entries = fs::read_dir(path)?;

    for entry in entries.flatten() {
        let p = entry.path();
        let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
        
        // Skip hidden files and common ignore folders
        if name.starts_with('.') || name == "node_modules" || name == "dist" {
            continue;
        }

        let is_dir = p.is_dir();
        let rel_path = p.strip_prefix(base).unwrap_or(&p).to_string_lossy().to_string();

        let mut entry_item = FileEntry {
            name,
            path: rel_path,
            full_path: p.to_string_lossy().to_string(),
            is_dir,
            children: None,
        };

        if is_dir {
            let mut children = Vec::new();
            read_dir_recursive(&p, base, &mut children)?;
            // Sort: directories first, then alphabetical
            children.sort_by(|a, b| {
                if a.is_dir != b.is_dir {
                    b.is_dir.cmp(&a.is_dir)
                } else {
                    a.name.cmp(&b.name)
                }
            });
            entry_item.children = Some(children);
        }

        results.push(entry_item);
    }

    // Sort the top level too
    results.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            b.is_dir.cmp(&a.is_dir)
        } else {
            a.name.cmp(&b.name)
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn read_project_file(app_handle: tauri::AppHandle, path: String) -> Result<String, AppError> {
    let mut current = app_handle.path_resolver().resource_dir().ok_or_else(|| AppError::Internal("Impossible de trouver le dossier de ressources".to_string()))?;
    
    let mut s = current.to_string_lossy().to_string();
    if s.starts_with(r"\\?\") {
        s = s[4..].to_string();
    }
    current = PathBuf::from(s);

    let mut frontend_path = None;
    for _ in 0..4 {
        let check = current.join("frontend");
        if check.exists() && check.is_dir() {
            frontend_path = Some(check);
            break;
        }
        if !current.pop() { break; }
    }

    let frontend_path = frontend_path.ok_or_else(|| AppError::Internal("Project root (frontend) not found".to_string()))?;

    let full_path = frontend_path.join(path);
    if !full_path.starts_with(&frontend_path) {
        return Err(AppError::Internal("Access denied".to_string()));
    }

    if !full_path.exists() || !full_path.is_file() {
        return Err(AppError::NotFound(format!("File not found: {:?}", full_path)));
    }

    // Determine if it's an image or video
    let ext = full_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let is_image = matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" | "ico");
    let is_video = matches!(ext.as_str(), "mp4" | "webm" | "ogg");

    if is_image || is_video {
        let bytes = fs::read(&full_path)?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
        let prefix = if is_image { "image" } else { "video" };
        let mime = match ext.as_str() {
            "svg" => "svg+xml",
            "jpg" | "jpeg" => "jpeg",
            "png" => "png",
            "gif" => "gif",
            "webp" => "webp",
            "ico" => "x-icon",
            "mp4" => "mp4",
            "webm" => "webm",
            "ogg" => "ogg",
            _ => if is_image { "png" } else { "mp4" },
        };
        Ok(format!("data:{}/{};base64,{}", prefix, mime, b64))
    } else {
        Ok(fs::read_to_string(full_path)?)
    }
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
