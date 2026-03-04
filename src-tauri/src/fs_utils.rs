use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

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
        copy_file(&src, &dst)?;
        std::fs::remove_file(&src)?;
        Ok(true)
    } else {
        // No backup existed, the mod created this file entirely — remove it
        if dst.exists() {
            std::fs::remove_file(&dst)?;
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

/// Unapply a mod: restore all backups.
pub fn unapply_mod(
    mod_folder: &Path,
    game_path: &Path,
    backup_root: &Path,
    mod_id: &str,
) -> Result<()> {
    let mod_backup_root = backup_root.join(mod_id);
    let files = list_mod_files(mod_folder)?;
    for rel in &files {
        restore_file(game_path, rel, &mod_backup_root)
            .with_context(|| format!("Restore failed for {:?}", rel))?;
    }
    // Clean up empty backup dir
    let _ = std::fs::remove_dir_all(&mod_backup_root);
    Ok(())
}
