use serde::Serialize;
use std::path::{Path, PathBuf};
use crate::state::AppState;
use tauri::State;
use std::fs;
use jwalk::WalkDir;
use std::collections::HashMap;
use crate::error::AppError;
use tracing::{info, error};

#[derive(Serialize, Clone, Debug)]
pub struct FileTreeNode {
    pub name: String,
    pub path: String, // Relative path
    pub is_dir: bool,
    pub children: Option<Vec<FileTreeNode>>,
}


/// Where to READ a mod's files from. An archived mod is a `.zip`, and its contents live in
/// the shared extraction cache; a plain mod is its own folder.
fn read_root(mod_folder: &Path) -> PathBuf {
    crate::archive::mod_read_root(mod_folder)
}

/// Where to WRITE a mod's files, or a refusal.
///
/// The mapper's write operations — restructure, rename, delete, create — move real files
/// around inside the mod. For an archived mod that cannot mean the extraction cache: the
/// cache is derived and rebuilt from the `.zip`, so anything written there is silently lost
/// the next time it is regenerated. Doing it properly means rewriting the archive, which is a
/// different feature.
///
/// So this refuses, and says why and what to do. Before, the join produced a path INSIDE a
/// zip file, which either failed with an unrelated message or did nothing at all.
fn write_root(mod_folder: &Path) -> Result<PathBuf, AppError> {
    if crate::archive::is_archive(mod_folder) {
        return Err(AppError::Internal(
            "Ce mod est archivé (.zip) : le mapper peut l'explorer mais pas le modifier. \
             Extrayez-le d'abord (Bibliothèque → le mod → Extraire) pour réorganiser ses fichiers."
                .to_string(),
        ));
    }
    Ok(mod_folder.to_path_buf())
}

#[tauri::command]
pub async fn get_directory_tree(path: String) -> Result<Vec<FileTreeNode>, AppError> {
    let path_clone = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // An ARCHIVED mod is a .zip, not a folder, and the mapper was handed the .zip path
        // directly — so it logged "not a dir" and the whole screen came up empty. BMM already
        // solves this everywhere else: mod_read_root() extracts an archive into the shared
        // cache and hands back that directory, returning a plain folder untouched. It falls
        // back to the original path when extraction fails, so the check below still reports a
        // genuinely missing or corrupt one rather than swallowing it.
        let root_owned = read_root(Path::new(&path_clone));
        let root = root_owned.as_path();
        if !root.exists() || !root.is_dir() {
            error!("Directory not found or not a dir: {}", path_clone);
            return Err(AppError::NotFound("Le dossier n'existe pas ou n'est pas un répertoire".to_string()));
        }
        
        // 1. Multi-threaded walk to collect all items
        let mut entries: Vec<_> = WalkDir::new(root)
            .sort(true)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.depth > 0)
            .collect();

        // 2. Build map of all nodes
        let mut nodes_map: HashMap<PathBuf, FileTreeNode> = HashMap::with_capacity(entries.len());
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

        // 3. Assemble the tree from leaves up
        entries.sort_by(|a, b| b.depth.cmp(&a.depth));

        for entry in &entries {
            if entry.depth > 1 {
                let path = entry.path();
                if let Some(parent_path) = path.parent() {
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
    }).await.map_err(|e| AppError::Internal(e.to_string()))?
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

/// Move `src` to `dst`, merging when both are directories.
///
/// The naive version of this was `remove_dir_all(&dst)` followed by a rename, which turned a
/// name collision into silent recursive deletion: dropping `Data/` onto a mod that already had
/// a `Data/` destroyed everything already in it, with no backup — mod folders have none, the
/// `_original/` backup only covers the game directory. The docs promise the worst case here is
/// "a mis-shaped mod, which you can reshape again", and that was not true.
///
/// This mirrors Explorer's drag semantics instead: directories merge, and only the individual
/// files you actually landed on are replaced.
fn move_into(src: &Path, dst: &Path) -> Result<(), AppError> {
    if !(src.is_dir() && dst.is_dir()) {
        // File onto file (or onto a directory, and vice versa) — replacing the single target is
        // what the drag asked for. `rename` won't overwrite a directory, so clear it first.
        if dst.exists() {
            if dst.is_dir() {
                fs::remove_dir_all(dst).map_err(|e| e.to_string())?;
            } else {
                fs::remove_file(dst).map_err(|e| e.to_string())?;
            }
        }
        fs::rename(src, dst).map_err(|e| e.to_string())?;
        return Ok(());
    }

    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        move_into(&entry.path(), &dst.join(entry.file_name()))?;
    }
    // Everything moved out; the husk goes. Anything left means a child failed, so keep it.
    let _ = fs::remove_dir(src);
    Ok(())
}

#[tauri::command]
pub async fn restructure_mod_item(
    state: State<'_, AppState>,
    mod_id: String,
    item_rel_path: String,
    target_game_folder_rel: String,
) -> Result<(), AppError> {
    info!("Restructuring mod item {} -> {}", item_rel_path, target_game_folder_rel);
    let mod_folder = {
        let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or_else(|| AppError::NotFound("Mod introuvable".to_string()))?;
        m.mod_folder_path.clone()
    };
    let mod_folder = write_root(&mod_folder)?;
    
    let src_path = mod_folder.join(&item_rel_path);
    let item_name = src_path.file_name().ok_or_else(|| AppError::Internal("Nom d'élément invalide".to_string()))?;
    
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
        return Err(AppError::NotFound(format!("Élément source introuvable: {}", item_rel_path)));
    }
    
    // Create destination directory structure
    if !dst_dir.exists() {
        fs::create_dir_all(&dst_dir).map_err(|e| e.to_string())?;
    }
    
    move_into(&src_path, &dst_path)?;
    
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
) -> Result<(), AppError> {
    info!("Deleting mod item {}", item_rel_path);
    let mod_folder = {
        let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or_else(|| AppError::NotFound("Mod introuvable".to_string()))?;
        m.mod_folder_path.clone()
    };
    let mod_folder = write_root(&mod_folder)?;
    
    let path = mod_folder.join(&item_rel_path);
    if !path.exists() {
        return Err(AppError::NotFound("Fichier ou dossier introuvable".to_string()));
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
) -> Result<(), AppError> {
    info!("Creating mod folder {} in {}", folder_name, parent_rel_path);
    let mod_folder = {
        let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or_else(|| AppError::NotFound("Mod introuvable".to_string()))?;
        m.mod_folder_path.clone()
    };
    let mod_folder = write_root(&mod_folder)?;
    
    let target_dir = if parent_rel_path.is_empty() || parent_rel_path == "." {
        mod_folder.join(folder_name)
    } else {
        mod_folder.join(parent_rel_path).join(folder_name)
    };
    
    if target_dir.exists() {
        return Err(AppError::Internal("Ce dossier existe déjà".to_string()));
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
) -> Result<(), AppError> {
    info!("Renaming mod item {} to {}", item_rel_path, new_name);
    let mod_folder = {
        let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or_else(|| AppError::NotFound("Mod introuvable".to_string()))?;
        m.mod_folder_path.clone()
    };
    let mod_folder = write_root(&mod_folder)?;
    
    let src_path = mod_folder.join(&item_rel_path);
    if !src_path.exists() {
        return Err(AppError::NotFound("Élément introuvable".to_string()));
    }
    
    let dst_path = src_path.parent().unwrap_or(&mod_folder).join(new_name);
    
    if dst_path.exists() {
        return Err(AppError::Internal("Un élément avec ce nom existe déjà".to_string()));
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
) -> Result<(), AppError> {
    info!("Opening item in explorer: {}", item_rel_path);
    let mod_folder = {
        let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or_else(|| AppError::NotFound("Mod introuvable".to_string()))?;
        m.mod_folder_path.clone()
    };
    let mod_folder = read_root(&mod_folder);
    
    let path = mod_folder.join(&item_rel_path);
    if !path.exists() {
        return Err(AppError::NotFound("Chemin introuvable".to_string()));
    }

    #[cfg(target_os = "windows")]
    {
        if path.is_dir() {
            crate::commands::proc::hidden_command("explorer").arg(&path).spawn().map_err(|e| e.to_string())?;
        } else {
            // Select the file in explorer
            crate::commands::proc::hidden_command("explorer").arg("/select,").arg(&path).spawn().map_err(|e| e.to_string())?;
        }
    }
    
    Ok(())
}
#[tauri::command]
pub async fn open_game_item_in_explorer(
    state: State<'_, AppState>,
    item_rel_path: String,
) -> Result<(), AppError> {
    info!("Opening game item in explorer: {}", item_rel_path);
    let game_path = {
        let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        let active_id = data.active_profile_id.as_ref().ok_or_else(|| AppError::NotFound("Aucun profil actif".to_string()))?;
        let p = data.profiles.iter().find(|p| &p.id == active_id).ok_or_else(|| AppError::NotFound("Profil introuvable".to_string()))?;
        p.game_path.clone()
    };
    
    let path = if item_rel_path == "." || item_rel_path.is_empty() {
        game_path
    } else {
        game_path.join(&item_rel_path)
    };

    if !path.exists() {
        return Err(AppError::NotFound("Chemin introuvable dans le dossier de destination".to_string()));
    }

    #[cfg(target_os = "windows")]
    {
        if path.is_dir() {
            crate::commands::proc::hidden_command("explorer").arg(&path).spawn().map_err(|e| e.to_string())?;
        } else {
            crate::commands::proc::hidden_command("explorer").arg("/select,").arg(&path).spawn().map_err(|e| e.to_string())?;
        }
    }
    
    Ok(())
}

#[cfg(test)]
mod move_into_tests {
    use super::move_into;
    use std::fs;

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("bmm_mapper_{}", name));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn merging_a_directory_keeps_what_was_already_there() {
        let root = tmp("merge");
        let src = root.join("src/Data");
        let dst = root.join("dst/Data");
        fs::create_dir_all(src.join("textures")).unwrap();
        fs::create_dir_all(dst.join("sounds")).unwrap();
        fs::write(src.join("textures/new.dds"), b"new").unwrap();
        fs::write(dst.join("sounds/keep.wav"), b"keep").unwrap();

        move_into(&src, &dst).unwrap();

        // The regression this guards: `keep.wav` used to be deleted by remove_dir_all.
        assert_eq!(fs::read(dst.join("sounds/keep.wav")).unwrap(), b"keep");
        assert_eq!(fs::read(dst.join("textures/new.dds")).unwrap(), b"new");
        assert!(!src.exists(), "the emptied source folder should be gone");
    }

    #[test]
    fn a_file_landing_on_a_file_still_replaces_it() {
        let root = tmp("file");
        let src = root.join("a.txt");
        let dst = root.join("b.txt");
        fs::write(&src, b"new").unwrap();
        fs::write(&dst, b"old").unwrap();

        move_into(&src, &dst).unwrap();

        assert_eq!(fs::read(&dst).unwrap(), b"new");
        assert!(!src.exists());
    }
}
