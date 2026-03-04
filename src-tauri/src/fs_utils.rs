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
pub fn copy_file(src: &Path, dst: &Path) -> Result<()> {
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create dir: {:?}", parent))?;
    }
    std::fs::copy(src, dst)
        .with_context(|| format!("Failed to copy {:?} -> {:?}", src, dst))?;
    Ok(())
}

/// Backup a file from `game_path/rel` to `backup_root/rel`. Only backs up once.
pub fn backup_file(game_path: &Path, rel: &Path, backup_root: &Path) -> Result<()> {
    let src = game_path.join(rel);
    let dst = backup_root.join(rel);
    if src.exists() && !dst.exists() {
        copy_file(&src, &dst)
            .with_context(|| format!("Failed to backup file: {:?}", rel))?;
    }
    Ok(())
}

/// Restore a backed-up file from `backup_root/rel` to `game_path/rel`.
pub fn restore_file(game_path: &Path, rel: &Path, backup_root: &Path) -> Result<bool> {
    let src = backup_root.join(rel);
    let dst = game_path.join(rel);
    if src.exists() {
        println!("[BMM] Restoring backup: {:?} -> {:?}", src, dst);
        copy_file(&src, &dst)?;
        ensure_removed(&src)?;
        Ok(true)
    } else {
        // No backup existed, the mod created this file entirely — remove it
        if dst.exists() {
            println!("[BMM] Removing mod-only file: {:?}", dst);
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

/// Apply a mod: for each file in mod folder, backup original then copy mod file.
pub fn apply_mod(
    mod_folder: &Path,
    game_path: &Path,
    backup_root: &Path,
    mod_id: &str,
) -> Result<Vec<PathBuf>> {
    let files = list_mod_files(mod_folder)?;
    let mut applied = Vec::new();

    for rel in &files {
        let mod_backup_root = backup_root.join(mod_id);
        // Backup original if it exists
        backup_file(game_path, rel, &mod_backup_root)
            .with_context(|| format!("Backup failed for {:?}", rel))?;
        // Copy mod file
        let src = mod_folder.join(rel);
        let dst = game_path.join(rel);
        copy_file(&src, &dst)
            .with_context(|| format!("Apply failed for {:?}", rel))?;
        applied.push(rel.clone());
    }
    Ok(applied)
}

/// Unapply a mod: restore all backups based on the list of files that were actually installed.
pub fn unapply_mod(
    game_path: &Path,
    backup_root: &Path,
    mod_id: &str,
    installed_files: Vec<String>,
) -> Result<()> {
    let mod_backup_root = backup_root.join(mod_id);
    println!("[BMM] Unapplying mod: {}, files: {}", mod_id, installed_files.len());
    
    for rel_str in &installed_files {
        let rel = PathBuf::from(rel_str);
        restore_file(game_path, &rel, &mod_backup_root)
            .with_context(|| format!("Restore failed for {:?}", rel))?;
            
        // Attempt to clean up empty parent directories in the game folder
        let mut parent = game_path.join(&rel).parent().map(|p| p.to_path_buf());
        while let Some(p) = parent {
            if p == game_path || !p.starts_with(game_path) { break; }
            if p.exists() && std::fs::read_dir(&p).map(|mut d| d.next().is_none()).unwrap_or(false) {
                let _ = std::fs::remove_dir(&p);
                parent = p.parent().map(|p| p.to_path_buf());
            } else {
                break;
            }
        }
    }
    
    // Clean up group backup dir if it's empty or exists
    if mod_backup_root.exists() {
        let _ = std::fs::remove_dir_all(&mod_backup_root);
    }
    Ok(())
}
