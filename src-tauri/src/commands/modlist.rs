use crate::fs_utils;
use crate::models::mod_entry::ModEntry;
use crate::models::modlist::{DownloadLink, ModFileEntry, ModList, ModListEntry};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn export_modlist(
    state: State<AppState>,
    list_name: String,
    description: String,
    author: String,
    output_path: String,
) -> Result<(), String> {
    let data = state.data.lock().unwrap();

    let active_profile = if let Some(ref id) = data.active_profile_id {
        data.profiles.iter().find(|p| &p.id == id)
    } else {
        None
    };

    let (game_name, game_path_hint, mods_path) = match active_profile {
        Some(p) => (p.game_name.clone(), p.game_path.to_string_lossy().to_string(), Some(p.mods_path.clone())),
        None => (String::new(), String::new(), None)
    };

    let mut modlist = ModList::new(list_name, game_name, game_path_hint);
    modlist.description = Some(description);
    modlist.author = Some(author);

    for (i, m) in data.mods.iter().enumerate() {
        // Filter: Only mods from the active profile's path
        if let Some(ref mp) = mods_path {
            if !m.mod_folder_path.starts_with(mp) {
                continue;
            }
        }

        // Build the file tree for this mod
        let file_tree = build_file_tree(m);

        // Convert download links from ModEntry
        let download_links: Vec<DownloadLink> = m.download_links.iter().map(|dl| {
            DownloadLink {
                url: dl.url.clone(),
                link_type: dl.link_type.clone(),
                label: dl.label.clone(),
            }
        }).collect();

        modlist.mods.push(ModListEntry {
            name: m.name.clone(),
            version: m.version.clone(),
            author: m.author.clone(),
            description: m.description.clone(),
            download_links,
            sort_priority: if m.enabled { (i as u32) * 10 } else { 9999 },
            file_tree,
            install_notes: String::new(),
            tags: m.tags.clone(),
        });
    }

    let json = serde_json::to_string_pretty(&modlist).map_err(|e| e.to_string())?;
    std::fs::write(&output_path, json).map_err(|e| e.to_string())?;
    Ok(())
}

/// Build the file tree arborescence for a mod by walking its folder
fn build_file_tree(m: &ModEntry) -> Vec<ModFileEntry> {
    let mut entries = Vec::new();
    if let Ok(files) = fs_utils::list_mod_files(&m.mod_folder_path) {
        for rel in files {
            let full = m.mod_folder_path.join(&rel);
            let size = std::fs::metadata(&full).map(|md| md.len()).unwrap_or(0);
            entries.push(ModFileEntry {
                relative_path: rel.to_string_lossy().to_string(),
                is_directory: false,
                size,
            });
        }
    }
    entries
}

#[tauri::command]
pub fn import_modlist(path: String) -> Result<ModList, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| format!("Invalid .MM file: {}", e))
}

#[tauri::command]
pub fn add_download_link(
    state: State<AppState>,
    mod_id: String,
    url: String,
    link_type: String,
    label: String,
) -> Result<(), String> {
    {
        let mut data = state.data.lock().unwrap();
        if let Some(m) = data.mods.iter_mut().find(|m| m.id == mod_id) {
            m.download_links.push(crate::models::mod_entry::DownloadLink {
                url,
                link_type,
                label,
            });
        } else {
            return Err("Mod not found".to_string());
        }
    }
    state.save().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_download_link(
    state: State<AppState>,
    mod_id: String,
    link_index: usize,
) -> Result<(), String> {
    {
        let mut data = state.data.lock().unwrap();
        if let Some(m) = data.mods.iter_mut().find(|m| m.id == mod_id) {
            if link_index < m.download_links.len() {
                m.download_links.remove(link_index);
            }
        }
    }
    state.save().map_err(|e| e.to_string())
}
