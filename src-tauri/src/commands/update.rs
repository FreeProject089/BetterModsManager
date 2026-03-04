use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize)]
pub struct UpdateNote {
    pub filename: String,
    pub content: String,
}

#[tauri::command]
pub fn get_update_notes(app_handle: tauri::AppHandle, sub_dir: Option<String>) -> Result<Vec<UpdateNote>, String> {
    // Try to read from the Update directory relative to the executable
    let exe_dir = app_handle
        .path_resolver()
        .resource_dir()
        .unwrap_or_else(|| PathBuf::from("."));
    
    let mut update_dir = exe_dir.join("Update");
    
    // Also try the project root Update directory (dev mode)
    let dev_base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    
    let mut dev_update_dir = dev_base.join("Update");

    if let Some(s) = sub_dir {
        update_dir = update_dir.join(&s);
        dev_update_dir = dev_update_dir.join(&s);
    }
    
    let dir = if update_dir.exists() {
        update_dir
    } else if dev_update_dir.exists() {
        dev_update_dir
    } else {
        return Ok(Vec::new());
    };

    let mut notes = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("md") {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    notes.push(UpdateNote {
                        filename: path.file_name().unwrap_or_default().to_string_lossy().to_string(),
                        content,
                    });
                }
            }
        }
    }

    // Sort by filename (newest first, assuming naming convention)
    notes.sort_by(|a, b| b.filename.cmp(&a.filename));

    Ok(notes)
}

#[tauri::command]
pub fn get_old_updates_count(_app_handle: tauri::AppHandle) -> Result<usize, String> {
    let dev_base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    
    let old_dir = dev_base.join("Update").join("Old_Update");
    
    if !old_dir.exists() {
        return Ok(0);
    }

    let mut count = 0;
    if let Ok(entries) = std::fs::read_dir(old_dir) {
        for entry in entries.flatten() {
            if entry.path().is_file() && entry.path().extension().and_then(|s| s.to_str()) == Some("md") {
                count += 1;
            }
        }
    }
    Ok(count)
}
