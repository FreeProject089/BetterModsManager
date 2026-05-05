use serde::Serialize;
use std::path::{Path, PathBuf};
use crate::state::AppState;
use tauri::State;
use std::fs;
use jwalk::WalkDir;
use std::collections::HashMap;

#[derive(Serialize, Clone, Debug)]
pub struct FileTreeNode {
    pub name: String,
    pub path: String, // Relative path
    pub is_dir: bool,
    pub children: Option<Vec<FileTreeNode>>,
}

#[tauri::command]
pub fn get_directory_tree(path: String) -> Result<Vec<FileTreeNode>, String> {
    let root = Path::new(&path);
    if !root.exists() || !root.is_dir() {
        return Err("Le dossier n'existe pas ou n'est pas un répertoire".to_string());
    }
    
    // 1. Multi-threaded walk to collect all items
    let mut entries: Vec<_> = WalkDir::new(root)
        .sort(true)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.depth > 0)
        .collect();

    // 2. Build map of all nodes
    let mut nodes_map: HashMap<PathBuf, FileTreeNode> = HashMap::new();
    let mut root_paths = Vec::new();

    for entry in &entries {
        let path = entry.path();
        let rel_path = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().to_string();
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        let is_dir = entry.file_type().is_dir();
        
        let node = FileTreeNode {
            name,
            path: rel_path,
            is_dir,
            children: if is_dir { Some(Vec::new()) } else { None },
        };
        
        nodes_map.insert(path.clone(), node);
        if entry.depth == 1 {
            root_paths.push(path);
        }
    }

    // 3. Assemble the tree from leaves up (or by parent lookup)
    // To ensure children are attached to parents, we must process from deepest to shallowest
    entries.sort_by(|a, b| b.depth.cmp(&a.depth));

    for entry in &entries {
        if entry.depth > 1 {
            let path = entry.path();
            if let Some(parent_path) = path.parent() {
                // Remove child from map and add it to parent's children
                if let Some(child_node) = nodes_map.remove(&path) {
                    if let Some(parent_node) = nodes_map.get_mut(parent_path) {
                        if let Some(children) = &mut parent_node.children {
                            children.push(child_node);
                        }
                    }
                }
            }
        }
    }

    // 4. Collect roots and sort
    let mut final_nodes = Vec::new();
    for path in root_paths {
        if let Some(mut node) = nodes_map.remove(&path) {
            if let Some(children) = &mut node.children {
                sort_tree_recursive(children);
            }
            final_nodes.push(node);
        }
    }
    
    sort_nodes(&mut final_nodes);
    Ok(final_nodes)
}

fn sort_tree_recursive(nodes: &mut Vec<FileTreeNode>) {
    sort_nodes(nodes);
    for node in nodes {
        if let Some(children) = &mut node.children {
            sort_tree_recursive(children);
        }
    }
}

fn sort_nodes(nodes: &mut [FileTreeNode]) {
    nodes.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            b.is_dir.cmp(&a.is_dir)
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });
}

#[tauri::command]
pub async fn restructure_mod_item(
    state: State<'_, AppState>,
    mod_id: String,
    item_rel_path: String,
    target_game_folder_rel: String,
) -> Result<(), String> {
    let mod_folder = {
        let data = state.data.lock().unwrap();
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?;
        m.mod_folder_path.clone()
    };
    
    let src_path = mod_folder.join(&item_rel_path);
    let item_name = src_path.file_name().ok_or("Nom d'élément invalide")?;
    
    // The target path in the game dir is target_game_folder_rel + item_name.
    // We mirror this in the mod folder.
    let dst_dir = if target_game_folder_rel.is_empty() || target_game_folder_rel == "." {
        mod_folder.clone()
    } else {
        mod_folder.join(&target_game_folder_rel)
    };
    
    let dst_path = dst_dir.join(item_name);
    
    if src_path == dst_path {
        return Ok(());
    }
    
    if !src_path.exists() {
        return Err(format!("Élément source introuvable: {}", item_rel_path));
    }
    
    // Create destination directory structure
    if !dst_dir.exists() {
        fs::create_dir_all(&dst_dir).map_err(|e| e.to_string())?;
    }
    
    // Handle overwrite
    if dst_path.exists() {
        if dst_path.is_dir() {
            fs::remove_dir_all(&dst_path).map_err(|e| e.to_string())?;
        } else {
            fs::remove_file(&dst_path).map_err(|e| e.to_string())?;
        }
    }
    
    fs::rename(&src_path, &dst_path).map_err(|e| e.to_string())?;
    
    // Cleanup old empty parent directories (up to mod_folder)
    let mut current = src_path.parent();
    while let Some(p) = current {
        if p == mod_folder || !p.starts_with(&mod_folder) { break; }
        if fs::read_dir(p).map(|mut d| d.next().is_none()).unwrap_or(false) {
            let _ = fs::remove_dir(p);
            current = p.parent();
        } else {
            break;
        }
    }
    
    // Invalidate mod cache so the UI reflects the change
    crate::commands::mods::invalidate_cache(&state);
    
    Ok(())
}

#[tauri::command]
pub async fn delete_mod_item(
    state: State<'_, AppState>,
    mod_id: String,
    item_rel_path: String,
) -> Result<(), String> {
    let mod_folder = {
        let data = state.data.lock().unwrap();
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?;
        m.mod_folder_path.clone()
    };
    
    let path = mod_folder.join(&item_rel_path);
    if !path.exists() {
        return Err("Fichier ou dossier introuvable".to_string());
    }
    
    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    
    crate::commands::mods::invalidate_cache(&state);
    Ok(())
}

#[tauri::command]
pub async fn create_mod_folder(
    state: State<'_, AppState>,
    mod_id: String,
    parent_rel_path: String,
    folder_name: String,
) -> Result<(), String> {
    let mod_folder = {
        let data = state.data.lock().unwrap();
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?;
        m.mod_folder_path.clone()
    };
    
    let target_dir = if parent_rel_path.is_empty() || parent_rel_path == "." {
        mod_folder.join(folder_name)
    } else {
        mod_folder.join(parent_rel_path).join(folder_name)
    };
    
    if target_dir.exists() {
        return Err("Ce dossier existe déjà".to_string());
    }
    
    fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    crate::commands::mods::invalidate_cache(&state);
    Ok(())
}

#[tauri::command]
pub async fn rename_mod_item(
    state: State<'_, AppState>,
    mod_id: String,
    item_rel_path: String,
    new_name: String,
) -> Result<(), String> {
    let mod_folder = {
        let data = state.data.lock().unwrap();
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?;
        m.mod_folder_path.clone()
    };
    
    let src_path = mod_folder.join(&item_rel_path);
    if !src_path.exists() {
        return Err("Élément introuvable".to_string());
    }
    
    let dst_path = src_path.parent().unwrap_or(&mod_folder).join(new_name);
    
    if dst_path.exists() {
        return Err("Un élément avec ce nom existe déjà".to_string());
    }
    
    fs::rename(&src_path, &dst_path).map_err(|e| e.to_string())?;
    crate::commands::mods::invalidate_cache(&state);
    Ok(())
}

#[tauri::command]
pub async fn open_item_in_explorer(
    state: State<'_, AppState>,
    mod_id: String,
    item_rel_path: String,
) -> Result<(), String> {
    let mod_folder = {
        let data = state.data.lock().unwrap();
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?;
        m.mod_folder_path.clone()
    };
    
    let path = mod_folder.join(&item_rel_path);
    if !path.exists() {
        return Err("Chemin introuvable".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        if path.is_dir() {
            Command::new("explorer").arg(&path).spawn().map_err(|e| e.to_string())?;
        } else {
            // Select the file in explorer
            Command::new("explorer").arg("/select,").arg(&path).spawn().map_err(|e| e.to_string())?;
        }
    }
    
    Ok(())
}
