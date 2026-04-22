use crate::models::modpack::LocalModpack;
use crate::state::AppState;
use std::path::PathBuf;
use tauri::{AppHandle, State};

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Returns the path to the modpacks directory in AppData
fn get_modpacks_dir(handle: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = handle
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Cannot resolve AppData directory".to_string())?;
    let dir = app_dir.join("modpacks");
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create modpacks dir: {}", e))?;
    }
    Ok(dir)
}

fn modpack_path(handle: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(get_modpacks_dir(handle)?.join(format!("{}.json", id)))
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Save (create or update) a modpack to AppData/modpacks/<id>.json
#[tauri::command]
pub async fn save_modpack(
    handle: AppHandle,
    mut modpack: LocalModpack,
) -> Result<LocalModpack, String> {
    // Ensure IDs and timestamps
    if modpack.id.is_empty() {
        modpack.id = uuid::Uuid::new_v4().to_string();
    }
    let now = chrono::Utc::now().to_rfc3339();
    if modpack.created_at.is_empty() {
        modpack.created_at = now.clone();
    }
    modpack.updated_at = now;

    let path = modpack_path(&handle, &modpack.id)?;
    let json = serde_json::to_string_pretty(&modpack)
        .map_err(|e| format!("Serialization error: {}", e))?;
    std::fs::write(&path, json).map_err(|e| format!("Write error: {}", e))?;

    Ok(modpack)
}

/// Load all modpacks from AppData/modpacks/
#[tauri::command]
pub async fn load_modpacks(handle: AppHandle) -> Result<Vec<LocalModpack>, String> {
    let dir = get_modpacks_dir(&handle)?;
    let mut packs = Vec::new();

    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            match std::fs::read_to_string(&path) {
                Ok(content) => {
                    match serde_json::from_str::<LocalModpack>(&content) {
                        Ok(pack) => packs.push(pack),
                        Err(e) => {
                            crate::commands::crash::log_line(format!(
                                "[Modpack] Failed to parse {:?}: {}", path, e
                            ));
                        }
                    }
                }
                Err(e) => {
                    crate::commands::crash::log_line(format!(
                        "[Modpack] Failed to read {:?}: {}", path, e
                    ));
                }
            }
        }
    }

    // Sort by updated_at descending
    packs.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(packs)
}

/// Get a single modpack by ID
#[tauri::command]
pub async fn get_modpack_by_id(
    handle: AppHandle,
    id: String,
) -> Result<Option<LocalModpack>, String> {
    let path = modpack_path(&handle, &id)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let pack = serde_json::from_str::<LocalModpack>(&content).map_err(|e| e.to_string())?;
    Ok(Some(pack))
}

/// Delete a modpack by ID
#[tauri::command]
pub async fn delete_modpack(handle: AppHandle, id: String) -> Result<(), String> {
    let path = modpack_path(&handle, &id)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Delete error: {}", e))?;
    }
    Ok(())
}

/// Build a ModpackModRef from a locally installed mod.
/// Reads all files in the mod folder, computes SHA-256, and returns a ready-to-use ref.
#[tauri::command]
pub async fn build_modpack_mod_ref(
    _handle: AppHandle,
    state: State<'_, AppState>,
    mod_id: String,
    profile_id: Option<String>,
    include_dependencies: bool,
    download_link: Option<String>,
    fallback_link: Option<String>,
    fallback_type: Option<String>,
) -> Result<crate::models::modpack::ModpackModRef, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let (mod_entry, profile_name) = {
        let data = state.data.lock().unwrap();

        let m = data.mods.iter()
            .find(|m| m.id == mod_id)
            .ok_or_else(|| format!("Mod '{}' not found", mod_id))?
            .clone();

        let pname = if let Some(ref pid) = profile_id {
            data.profiles.iter()
                .find(|p| &p.id == pid)
                .map(|p| p.name.clone())
        } else {
            None
        };
        (m, pname)
    };

    let mod_folder = &mod_entry.mod_folder_path;
    let files = crate::fs_utils::list_mod_files(mod_folder).map_err(|e| e.to_string())?;

    let mut file_manifest = Vec::new();
    let mut first_sha = String::new();

    for rel in &files {
        let full = mod_folder.join(rel);
        let size = std::fs::metadata(&full).map(|m| m.len()).unwrap_or(0);
        let mut f = std::fs::File::open(&full).map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let n = f.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 { break; }
            hasher.update(&buf[..n]);
        }
        let sha = format!("{:x}", hasher.finalize());
        if first_sha.is_empty() { first_sha = sha.clone(); }
        file_manifest.push(crate::models::modpack::ModpackFileRef {
            relative_path: rel.to_string_lossy().replace('\\', "/"),
            sha256: sha,
            size,
        });
    }

    Ok(crate::models::modpack::ModpackModRef {
        mod_id: mod_entry.id.clone(),
        mod_name: mod_entry.name.clone(),
        mod_version: mod_entry.version.clone(),
        profile_id,
        profile_name,
        sha256: first_sha,
        file_manifest,
        include_dependencies,
        download_link,
        fallback_link,
        fallback_type,
    })
}

/// Exports a modpack to a user-selected path (.bmp)
#[tauri::command]
pub async fn export_modpack(
    handle: AppHandle,
    id: String,
) -> Result<(), String> {
    use tauri::api::dialog::blocking::FileDialogBuilder;
    let pack = get_modpack_by_id(handle.clone(), id).await?.ok_or("Modpack not found")?;
    
    let default_name = format!("{}.bmp", pack.name.replace(" ", "_"));
    
    if let Some(path) = FileDialogBuilder::new()
        .add_filter("Better ModPack", &["bmp"])
        .set_file_name(&default_name)
        .save_file()
    {
        let json = serde_json::to_string_pretty(&pack).map_err(|e| e.to_string())?;
        std::fs::write(path, json).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Imports a modpack from a user-selected path (.bmp)
#[tauri::command]
pub async fn import_modpack(
    handle: AppHandle,
) -> Result<LocalModpack, String> {
    use tauri::api::dialog::blocking::FileDialogBuilder;
    
    if let Some(path) = FileDialogBuilder::new()
        .add_filter("Better ModPack", &["bmp", "json"])
        .pick_file()
    {
        let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let mut pack = serde_json::from_str::<LocalModpack>(&content).map_err(|e| e.to_string())?;
        
        // Generate new UUID to avoid collisions
        pack.id = uuid::Uuid::new_v4().to_string();
        
        return save_modpack(handle, pack).await;
    }
    Err("repo.errCancel".to_string())
}
