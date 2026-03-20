use std::path::{Path};
use base64::Engine;
use serde::Serialize;
use std::fs;
use std::time::{Instant};
use lazy_static::lazy_static;

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
pub async fn get_project_files() -> Result<Vec<FileEntry>, String> {
    let root = std::env::current_dir().map_err(|e| e.to_string())?;
    
    // In dev mode, the CWD might be src-tauri. We need the project root.
    let mut frontend_path = root.join("frontend");
    if !frontend_path.exists() {
        if let Some(parent) = root.parent() {
            let parent_frontend = parent.join("frontend");
            if parent_frontend.exists() {
                frontend_path = parent_frontend;
            }
        }
    }
    
    if !frontend_path.exists() {
        return Err(format!("Frontend directory not found. Searched in: {:?}", frontend_path));
    }

    let mut tree = Vec::new();
    read_dir_recursive(&frontend_path, &frontend_path, &mut tree)?;
    
    Ok(tree)
}

fn read_dir_recursive(path: &Path, base: &Path, results: &mut Vec<FileEntry>) -> Result<(), String> {
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;

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
pub async fn read_project_file(path: String) -> Result<String, String> {
    let root = std::env::current_dir().map_err(|e| e.to_string())?;
    
    let mut frontend_path = root.join("frontend");
    if !frontend_path.exists() {
        if let Some(parent) = root.parent() {
            let parent_frontend = parent.join("frontend");
            if parent_frontend.exists() {
                frontend_path = parent_frontend;
            }
        }
    }

    let full_path = frontend_path.join(path);
    if !full_path.starts_with(&frontend_path) {
        return Err("Access denied".to_string());
    }

    if !full_path.exists() || !full_path.is_file() {
        return Err(format!("File not found: {:?}", full_path));
    }

    // Determine if it's an image
    let ext = full_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let is_image = matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" | "ico");

    if is_image {
        let bytes = fs::read(&full_path).map_err(|e| e.to_string())?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
        let mime = match ext.as_str() {
            "svg" => "image/svg+xml",
            "jpg" | "jpeg" => "image/jpeg",
            "png" => "image/png",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "ico" => "image/x-icon",
            _ => "image/png",
        };
        Ok(format!("data:{};base64,{}", mime, b64))
    } else {
        fs::read_to_string(full_path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn get_debug_stats() -> Result<DebugStats, String> {
    use sysinfo::{System};
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
