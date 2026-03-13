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

pub fn copy_file_force_limited(src: &Path, dst: &Path, limit_mb_s: Option<u64>) -> Result<()> {
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    if dst.exists() {
        let _ = ensure_removed(dst); // Clear permissions and delete if possible before overwrite
    }
    
    if let Some(limit) = limit_mb_s {
        if limit > 0 {
            use std::io::{Read, Write};
            let mut src_file = std::fs::File::open(src).with_context(|| format!("Failed to open src: {:?}", src))?;
            let mut dst_file = std::fs::File::create(dst).with_context(|| format!("Failed to create dst: {:?}", dst))?;
            
            let chunk_size: usize = 128 * 1024; // 128 KB buffer for smoother limiting
            let mut buffer = vec![0u8; chunk_size];
            
            loop {
                let start = std::time::Instant::now();
                let bytes_read = src_file.read(&mut buffer)?;
                if bytes_read == 0 {
                    break;
                }
                dst_file.write_all(&buffer[..bytes_read])?;
                
                let elapsed = start.elapsed();
                let fraction = bytes_read as f64 / 1_048_576.0;
                let required_duration = std::time::Duration::from_secs_f64(fraction / limit as f64);
                
                if elapsed < required_duration {
                    std::thread::sleep(required_duration - elapsed);
                }
            }
            return Ok(());
        }
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
    other_active_mods: &[(String, PathBuf)],
    backup_path_limit: Option<u64>
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
    copy_file_force_limited(&src, &dst, backup_path_limit)
        .with_context(|| format!("Failed to backup original file: {:?}", rel))?;
    
    Ok(())
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
    game_path_limit: Option<u64>,
    backup_path_limit: Option<u64>,
) -> Result<Vec<PathBuf>> {
    let files = list_mod_files(mod_folder)?;
    let mut applied = Vec::new();

    for rel in &files {
        // Backup original if it's the first time BMM touches this file in this profile
        let _ = backup_original_file(game_path, rel, profile_backup_root, other_active_mods, backup_path_limit);
        
        // Copy mod file to game dir (force overwrite)
        let src = mod_folder.join(rel);
        let dst = game_path.join(rel);
        copy_file_force_limited(&src, &dst, game_path_limit)?;
        applied.push(rel.clone());
    }
    Ok(applied)
}

/// Strip Windows UNC prefix (\\?\) or (\??\) if present, and normalize to common format
fn normalize_path(path: PathBuf) -> PathBuf {
    let path_str = path.to_string_lossy();
    let mut s = path_str.as_ref();
    if s.starts_with(r"\\?\") {
        s = &s[4..];
    } else if s.starts_with(r"\??\") {
        s = &s[4..];
    }
    
    // Normalize slashes to backslashes for consistency on Windows
    PathBuf::from(s.replace('/', "\\"))
}

/// Unapply a mod: for each file, find if another active mod provides it.
/// If not, restore from _original.
pub fn unapply_mod_stacked(
    game_path: &Path,
    profile_backup_root: &Path,
    files_to_remove: Vec<String>,
    other_active_mods: &[(String, PathBuf)],
    game_path_limit: Option<u64>,
) -> Result<()> {
    // Canonicalize to follow symlinks/junctions, then normalize to strip UNC prefixes
    let game_path_norm = normalize_path(game_path.canonicalize().unwrap_or_else(|_| game_path.to_path_buf()));
    
    for rel_str in files_to_remove {
        let rel = PathBuf::from(&rel_str);
        let dst_path = game_path.join(&rel);
        
        let mut restored = false;
        // 1. Try to find another mod that provides this file
        for (_, mod_folder) in other_active_mods {
            let mod_src = mod_folder.join(&rel);
            if mod_src.exists() && mod_src.is_file() {
                copy_file_force_limited(&mod_src, &dst_path, game_path_limit)?;
                restored = true;
                break;
            }
        }

        // 2. If no other mod has it, restore original or DELETE
        if !restored {
            let original_src = profile_backup_root.join("_original").join(&rel);
            if original_src.exists() {
                copy_file_force_limited(&original_src, &dst_path, game_path_limit)?;
            } else {
                // File was added by mod and no original exists — DELETE IT
                let _ = ensure_removed(&dst_path); 
            }
        }

        // 3. Clean up empty parent directories
        let mut current_p = dst_path.parent().map(|p| p.to_path_buf());
        while let Some(p) = current_p {
            let p_norm = normalize_path(p.canonicalize().unwrap_or_else(|_| p.clone()));
            
            // Safety: Don't go above or out of game_path
            if p_norm == game_path_norm || !p_norm.starts_with(&game_path_norm) { break; }
            
            if p_norm.exists() {
                match fs::read_dir(&p_norm) {
                    Ok(mut entries) => {
                        if entries.next().is_none() {
                            let _ = fs::remove_dir(&p_norm);
                            current_p = p_norm.parent().map(|parent| parent.to_path_buf());
                        } else {
                            // Directory is not empty
                            break;
                        }
                    }
                    Err(_) => break, // Permission denied or other error
                }
            } else {
                // Already deleted?
                current_p = p_norm.parent().map(|parent| parent.to_path_buf());
            }
        }
    }
    Ok(())
}

/// Recursively removes empty directories within the given path
pub fn remove_empty_dirs(dir: &Path) -> Result<()> {
    if !dir.is_dir() { return Ok(()); }
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            let _ = remove_empty_dirs(&path);
        }
    }
    if std::fs::read_dir(dir)?.next().is_none() {
        let _ = std::fs::remove_dir(dir);
    }
    Ok(())
}
