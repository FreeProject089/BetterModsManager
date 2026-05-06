use crate::mcp::state_bridge;
use anyhow::Result;
use std::process::Command;
use std::path::Path;

pub fn list_launch_packs() -> Result<Vec<state_bridge::LaunchPack>> {
    let data = state_bridge::read_app_data()?;
    Ok(data.launch_packs)
}

pub fn run_launch_pack(id: &str) -> Result<String> {
    let data = state_bridge::read_app_data()?;
    let pack = data.launch_packs.iter().find(|p| p.id == id || p.name == id)
        .ok_or_else(|| anyhow::anyhow!("Launch pack not found"))?;

    let app_data_dir = state_bridge::get_bmm_data_dir();
    let pack_dir = app_data_dir.join("LaunchPacks").join(&pack.id);
    let vbs_path = pack_dir.join("launcher.vbs");

    if !vbs_path.exists() {
        return Err(anyhow::anyhow!("VBS launcher missing at {:?}", vbs_path));
    }

    Command::new("wscript")
        .arg(&vbs_path)
        .spawn()
        .map_err(|e| anyhow::anyhow!("Failed to run pack: {}", e))?;

    Ok(format!("Launch pack '{}' started (invisible).", pack.name))
}

pub fn delete_launch_pack(id: &str) -> Result<String> {
    let mut data = state_bridge::read_app_data()?;
    let index = data.launch_packs.iter().position(|p| p.id == id || p.name == id)
        .ok_or_else(|| anyhow::anyhow!("Launch pack not found"))?;
    
    let pack = data.launch_packs.remove(index);
    let pack_id = pack.id.clone();
    
    state_bridge::write_app_data(&data)?;

    let app_data_dir = state_bridge::get_bmm_data_dir();
    let pack_dir = app_data_dir.join("LaunchPacks").join(&pack_id);
    if pack_dir.exists() {
        let _ = std::fs::remove_dir_all(pack_dir);
    }

    Ok(format!("Launch pack '{}' deleted.", pack.name))
}

pub fn create_launch_pack(
    name: String,
    exe_paths: Vec<String>,
    icon_source_path: Option<String>,
) -> Result<state_bridge::LaunchPack> {
    let id = uuid::Uuid::new_v4().to_string();
    let app_data_dir = state_bridge::get_bmm_data_dir();
    let pack_dir = app_data_dir.join("LaunchPacks").join(&id);
    
    std::fs::create_dir_all(&pack_dir)?;

    let mut icon_path = None;
    if let Some(src) = icon_source_path {
        let src_path = Path::new(&src);
        if src_path.exists() {
            let ico_filename = "icon.ico";
            let target_ico = pack_dir.join(ico_filename);
            
            let img = image::open(src_path)?;
            let resized = img.resize(256, 256, image::imageops::FilterType::Lanczos3);
            resized.save_with_format(&target_ico, image::ImageFormat::Ico)?;
            
            icon_path = Some(target_ico);
        }
    }

    // Create the .vbs launcher (Invisible)
    let vbs_path = pack_dir.join("launcher.vbs");
    let mut vbs_content = String::from("Set WshShell = CreateObject(\"WScript.Shell\")\n");
    for exe in &exe_paths {
        let path = Path::new(exe);
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        
        let cmd = match ext.as_str() {
            "ps1" => format!("powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{}\"", exe),
            _ => format!("cmd /c start \"\" \"{}\"", exe),
        };
        let escaped_cmd = cmd.replace("\"", "\"\"");
        vbs_content.push_str(&format!("WshShell.Run \"{}\", 0, False\n", escaped_cmd));
    }
    vbs_content.push_str("Set WshShell = Nothing\n");
    std::fs::write(&vbs_path, vbs_content)?;

    // Create the .lnk Shortcut via PowerShell
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

    let _ = Command::new("powershell")
        .args(&["-NoProfile", "-Command", &powershell_script])
        .output();

    let pack = state_bridge::LaunchPack {
        id,
        name,
        executable_paths: exe_paths.into_iter().map(std::path::PathBuf::from).collect(),
        icon_path,
        created_at: chrono::Local::now().to_rfc3339(),
    };

    let mut data = state_bridge::read_app_data()?;
    data.launch_packs.push(pack.clone());
    state_bridge::write_app_data(&data)?;

    Ok(pack)
}

pub fn open_launch_pack_folder(id: &str) -> Result<String> {
    let data = state_bridge::read_app_data()?;
    let pack = data.launch_packs.iter().find(|p| p.id == id || p.name == id)
        .ok_or_else(|| anyhow::anyhow!("Launch pack not found"))?;

    let app_data_dir = state_bridge::get_bmm_data_dir();
    let pack_dir = app_data_dir.join("LaunchPacks").join(&pack.id);

    if pack_dir.exists() {
        #[cfg(target_os = "windows")]
        {
            Command::new("explorer")
                .arg(pack_dir)
                .spawn()
                .map_err(|e| anyhow::anyhow!("Failed to open folder: {}", e))?;
        }
    }

    Ok(format!("Opened folder for pack '{}'.", pack.name))
}
