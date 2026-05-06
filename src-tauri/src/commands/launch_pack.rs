use crate::state::AppState;
use crate::error::AppError;
use crate::models::launch_pack::LaunchPack;
use tauri::State;
use std::path::{Path, PathBuf};
use std::process::Command;
use uuid::Uuid;
use chrono::Local;

#[tauri::command]
pub fn get_launch_packs(state: State<AppState>) -> Result<Vec<LaunchPack>, AppError> {
    let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    Ok(data.launch_packs.clone())
}

#[tauri::command]
pub fn create_launch_pack(
    state: State<AppState>,
    name: String,
    exe_paths: Vec<String>,
    icon_source_path: Option<String>,
) -> Result<LaunchPack, AppError> {
    let id = Uuid::new_v4().to_string();
    let app_data_dir = state.data_path.parent().ok_or_else(|| AppError::Internal("Invalid data path".to_string()))?;
    let pack_dir = app_data_dir.join("LaunchPacks").join(&id);
    
    std::fs::create_dir_all(&pack_dir)
        .map_err(|e| AppError::Internal(format!("Failed to create pack directory: {}", e)))?;

    // 1. Convert Icon to .ico if provided
    let mut icon_path = None;
    if let Some(src) = icon_source_path {
        let src_path = Path::new(&src);
        if src_path.exists() {
            let ico_filename = "icon.ico";
            let target_ico = pack_dir.join(ico_filename);
            
            // Use image crate to convert
            let img = image::open(src_path)
                .map_err(|e| AppError::Internal(format!("Failed to open icon image: {}", e)))?;
            
            // Resize to 256x256 for better ico compatibility
            let resized = img.resize(256, 256, image::imageops::FilterType::Lanczos3);
            
            resized.save_with_format(&target_ico, image::ImageFormat::Ico)
                .map_err(|e| AppError::Internal(format!("Failed to save .ico: {}", e)))?;
            
            icon_path = Some(target_ico);
        }
    }

    // 2. Create the .vbs launcher (Invisible)
    let vbs_path = pack_dir.join("launcher.vbs");
    let mut vbs_content = String::from("Set WshShell = CreateObject(\"WScript.Shell\")\n");
    for exe in &exe_paths {
        let path = Path::new(exe);
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        
        let cmd = match ext.as_str() {
            "ps1" => format!("powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{}\"", exe),
            _ => format!("cmd /c start \"\" \"{}\"", exe),
        };
        // Escape quotes for VBScript string literal (double them)
        let escaped_cmd = cmd.replace("\"", "\"\"");
        vbs_content.push_str(&format!("WshShell.Run \"{}\", 0, False\n", escaped_cmd));
    }
    vbs_content.push_str("Set WshShell = Nothing\n");

    std::fs::write(&vbs_path, vbs_content)
        .map_err(|e| AppError::Internal(format!("Failed to write .vbs launcher: {}", e)))?;

    // 3. Create the .lnk Shortcut via PowerShell
    let lnk_path = pack_dir.join(format!("{}.lnk", name));
    let powershell_script = format!(
        "$WshShell = New-Object -ComObject WScript.Shell; \
         $Shortcut = $WshShell.CreateShortcut('{}'); \
         $Shortcut.TargetPath = 'wscript.exe'; \
         $Shortcut.Arguments = '\"{}\"'; \
         $Shortcut.WorkingDirectory = '{}'; \
         $Shortcut.IconLocation = '{}'; \
         $Shortcut.Save()",
        lnk_path.to_string_lossy().replace("'", "''"),
        vbs_path.to_string_lossy().replace("'", "''"),
        pack_dir.to_string_lossy().replace("'", "''"),
        icon_path.as_ref().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|| String::new()).replace("'", "''")
    );

    let output = Command::new("powershell")
        .args(&["-NoProfile", "-Command", &powershell_script])
        .output();

    if let Err(e) = output {
        crate::commands::crash::log_line(format!("[LAUNCHPACK] Failed to create shortcut: {}", e));
    }

    // 4. Update state
    let pack = LaunchPack {
        id,
        name,
        executable_paths: exe_paths.into_iter().map(PathBuf::from).collect(),
        icon_path,
        created_at: Local::now().to_rfc3339(),
    };

    {
        let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        data.launch_packs.push(pack.clone());
    }
    state.save()?;

    Ok(pack)
}

#[tauri::command]
pub fn run_launch_pack(state: State<AppState>, id: String) -> Result<(), AppError> {
    let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    let pack = data.launch_packs.iter().find(|p| p.id == id)
        .ok_or_else(|| AppError::NotFound("Launch pack not found".to_string()))?;

    let app_data_dir = state.data_path.parent().ok_or_else(|| AppError::Internal("Invalid data path".to_string()))?;
    let pack_dir = app_data_dir.join("LaunchPacks").join(&pack.id);
    let vbs_path = pack_dir.join("launcher.vbs");

    if !vbs_path.exists() {
        return Err(AppError::NotFound("VBS launcher missing".to_string()));
    }

    // Execute the VBS file (invisible)
    Command::new("wscript")
        .arg(vbs_path)
        .spawn()
        .map_err(|e| AppError::Internal(format!("Failed to run pack: {}", e)))?;

    Ok(())
}

#[tauri::command]
pub fn delete_launch_pack(state: State<AppState>, id: String) -> Result<(), AppError> {
    let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    let index = data.launch_packs.iter().position(|p| p.id == id)
        .ok_or_else(|| AppError::NotFound("Launch pack not found".to_string()))?;
    
    data.launch_packs.remove(index);
    drop(data);
    state.save()?;

    // Cleanup files
    let app_data_dir = state.data_path.parent().unwrap();
    let pack_dir = app_data_dir.join("LaunchPacks").join(&id);
    if pack_dir.exists() {
        let _ = std::fs::remove_dir_all(pack_dir);
    }

    Ok(())
}

#[tauri::command]
pub fn open_launch_pack_folder(state: State<AppState>, id: String) -> Result<(), AppError> {
    let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    let pack = data.launch_packs.iter().find(|p| p.id == id)
        .ok_or_else(|| AppError::NotFound("Launch pack not found".to_string()))?;

    let app_data_dir = state.data_path.parent().ok_or_else(|| AppError::Internal("Invalid data path".to_string()))?;
    let pack_dir = app_data_dir.join("LaunchPacks").join(&pack.id);

    if pack_dir.exists() {
        #[cfg(target_os = "windows")]
        {
            Command::new("explorer")
                .arg(pack_dir)
                .spawn()
                .map_err(|e| AppError::Internal(format!("Failed to open folder: {}", e)))?;
        }
    }

    Ok(())
}
