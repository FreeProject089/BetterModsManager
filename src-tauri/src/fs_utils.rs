use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use std::fs;

fn ensure_removed(path: &Path) -> Result<()> {
    if !path.exists() { return Ok(()); }
    if let Ok(meta) = fs::metadata(path) {
        let mut perms = meta.permissions();
        if perms.readonly() {
            perms.set_readonly(false);
            let _ = fs::set_permissions(path, perms);
        }
    }
    fs::remove_file(path).with_context(|| format!("Failed to remove file: {:?}", path))
}

/// Copy a single file from `src` to `dst`, creating parent dirs as needed.
/// If `dst` exists, we try to clear its readonly flag and overwrite it.
pub fn copy_file_force(src: &Path, dst: &Path) -> Result<()> {
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    if dst.exists() {
        let _ = ensure_removed(dst); // Clear permissions and delete if possible before overwrite
    }
    std::fs::copy(src, dst)
        .with_context(|| format!("Failed to copy {:?} -> {:?}", src, dst))?;
    Ok(())
}

/// Backup a file from `game_path/rel` to `backup_root/_original/rel`. 
/// Only if it's NOT provided by another active mod.
pub fn backup_original_file(
    game_path: &Path, 
    rel: &Path, 
    profile_backup_root: &Path,
    other_active_mods: &[(String, PathBuf)]
) -> Result<()> {
    let src = game_path.join(rel);
    let dst = profile_backup_root.join("_original").join(rel);
    
    // If it's already backed up, we're good
    if dst.exists() { return Ok(()); }
    if !src.exists() { return Ok(()); }

    // CRITICAL: Check if the current file in game dir is actually from another mod
    for (_, mod_folder) in other_active_mods {
        let mod_file = mod_folder.join(rel);
        if mod_file.exists() && mod_file.is_file() {
            // This is a mod file, NOT a game original. Don't backup.
            return Ok(());
        }
    }

    // It's a real game file! Secure it.
    copy_file_force(&src, &dst)
        .with_context(|| format!("Failed to backup original file: {:?}", rel))?;
    
    Ok(())
}

/// Restore a backed-up file from `profile_backup_root/_original/rel` to `game_path/rel`.
pub fn restore_original_file(game_path: &Path, rel: &Path, profile_backup_root: &Path) -> Result<bool> {
    let src = profile_backup_root.join("_original").join(rel);
    let dst = game_path.join(rel);
    if src.exists() {
        copy_file_force(&src, &dst)?;
        Ok(true)
    } else {
        if dst.exists() {
            ensure_removed(&dst)?;
        }
        Ok(false)
    }
}

/// Get all file paths (relative) inside a mod folder, recursively.
pub fn list_mod_files(mod_folder: &Path) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    for entry in WalkDir::new(mod_folder)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let rel = entry
            .path()
            .strip_prefix(mod_folder)
            .unwrap_or(entry.path())
            .to_path_buf();
        files.push(rel);
    }
    Ok(files)
}

/// Apply a mod: for each file, backup ORIGINAL if needed, then copy mod file.
pub fn apply_mod_stacked(
    mod_folder: &Path,
    game_path: &Path,
    profile_backup_root: &Path,
    other_active_mods: &[(String, PathBuf)],
) -> Result<Vec<PathBuf>> {
    let files = list_mod_files(mod_folder)?;
    let mut applied = Vec::new();

    for rel in &files {
        // Backup original if it's the first time BMM touches this file in this profile
        let _ = backup_original_file(game_path, rel, profile_backup_root, other_active_mods);
        
        // Copy mod file to game dir (force overwrite)
        let src = mod_folder.join(rel);
        let dst = game_path.join(rel);
        copy_file_force(&src, &dst)?;
        applied.push(rel.clone());
    }
    Ok(applied)
}

/// Unapply a mod: for each file, find if another active mod provides it.
/// If not, restore from _original.
pub fn unapply_mod_stacked(
    game_path: &Path,
    profile_backup_root: &Path,
    files_to_remove: Vec<String>,
    other_active_mods: &[(String, PathBuf)],
) -> Result<()> {
    let game_path_can = game_path.canonicalize().unwrap_or(game_path.to_path_buf());
    
    for rel_str in files_to_remove {
        let rel = PathBuf::from(&rel_str);
        let dst_path = game_path.join(&rel);
        
        let mut restored = false;
        // 1. Try to find another mod that provides this file
        for (_, mod_folder) in other_active_mods {
            let mod_src = mod_folder.join(&rel);
            if mod_src.exists() && mod_src.is_file() {
                let _ = copy_file_force(&mod_src, &dst_path);
                restored = true;
                break;
            }
        }

        // 2. If no other mod has it, restore original or DELETE
        if !restored {
            let original_src = profile_backup_root.join("_original").join(&rel);
            if original_src.exists() {
                let _ = copy_file_force(&original_src, &dst_path);
            } else {
                // File was added by mod and no original exists — DELETE IT
                let _ = ensure_removed(&dst_path);
            }
        }

        // 3. Clean up empty parent directories
        let mut parent = dst_path.parent().map(|p| p.to_path_buf());
        while let Some(p) = parent {
            let p_can = p.canonicalize().unwrap_or(p.clone());
            if p_can == game_path_can || !p_can.starts_with(&game_path_can) { break; }
            if p_can.exists() && std::fs::read_dir(&p_can).map(|mut d| d.next().is_none()).unwrap_or(false) {
                let _ = std::fs::remove_dir(&p_can);
                parent = p_can.parent().map(|p| p.to_path_buf());
            } else {
                break;
            }
        }
    }
    Ok(())
}
