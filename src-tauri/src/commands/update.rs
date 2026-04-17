use serde::Serialize;
use std::path::PathBuf;
use std::collections::HashMap;

#[derive(Serialize)]
pub struct UpdateNote {
    pub filename: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct UpdateFolder {
    pub name: String,
    pub path: String,
    pub is_folder: bool,
    pub children: Vec<UpdateFolder>,
}

#[tauri::command]
pub fn get_update_notes(app_handle: tauri::AppHandle, sub_dir: Option<String>, lang: Option<String>) -> Result<Vec<UpdateNote>, String> {
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
                // Filter by language if specified
                if let Some(ref lang_code) = lang {
                    let lang_suffix = format!("_{}.md", lang_code.to_uppercase());
                    let filename = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                    
                    // Only include files that match the language suffix
                    if !filename.ends_with(&lang_suffix) {
                        continue;
                    }
                }
                
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

#[tauri::command]
pub fn get_update_folder_structure(app_handle: tauri::AppHandle, lang: Option<String>) -> Result<Vec<UpdateFolder>, String> {
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
    
    let dev_update_dir = dev_base.join("Update");
    
    let base_dir = if update_dir.exists() {
        update_dir
    } else if dev_update_dir.exists() {
        dev_update_dir
    } else {
        return Ok(Vec::new());
    };

    fn build_folder_structure(dir: &PathBuf, base_path: &PathBuf, lang: &Option<String>) -> Result<Vec<UpdateFolder>, String> {
        let mut folders = Vec::new();
        
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                let relative_path = path.strip_prefix(base_path)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|_| name.clone());
                
                if path.is_dir() {
                    // Recursively build folder structure
                    let children = build_folder_structure(&path, base_path, lang)?;
                    folders.push(UpdateFolder {
                        name: name.clone(),
                        path: relative_path,
                        is_folder: true,
                        children,
                    });
                } else if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("md") {
                    // Filter by language if specified
                    if let Some(ref lang_code) = lang {
                        let lang_suffix = format!("_{}.md", lang_code.to_uppercase());
                        if !name.ends_with(&lang_suffix) {
                            continue;
                        }
                    }
                    
                    folders.push(UpdateFolder {
                        name,
                        path: relative_path,
                        is_folder: false,
                        children: Vec::new(),
                    });
                }
            }
        }
        
        // Sort: folders first, then files, both alphabetically
        folders.sort_by(|a, b| {
            if a.is_folder && !b.is_folder {
                std::cmp::Ordering::Less
            } else if !a.is_folder && b.is_folder {
                std::cmp::Ordering::Greater
            } else {
                a.name.cmp(&b.name)
            }
        });
        
        Ok(folders)
    }
    
    build_folder_structure(&base_dir, &base_dir, &lang)
}
