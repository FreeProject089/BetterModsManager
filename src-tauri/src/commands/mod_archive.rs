//! Turning an archived mod into a folder, and back.
//!
//! BMM can READ five archive formats (zip, tar, tar.gz, 7z, rar) but can only WRITE zip.
//! That asymmetry is the reason `rearchive_mod` always produces a `.zip` and says so in its
//! return value rather than pretending the original container was preserved.
//!
//! Until now there was no way to unpack a mod in place at all. The mapper refused to touch
//! an archived mod and told the user to "extract it first from the Library" — an action that
//! did not exist anywhere in the app. These two commands are what that sentence needed.
//!
//! Both are deliberately conservative about deleting things. The replacement is built beside
//! the original under a temporary name, and the original is only removed once the
//! replacement is complete and in place. A failure half-way leaves the mod exactly as it
//! was, plus a temporary directory that the next run cleans up.

use crate::error::AppError;
use crate::state::AppState;
use tracing::info;
use std::path::{Path, PathBuf};
use tauri::State;

/// Look up a mod's on-disk path without holding the lock across any I/O.
fn mod_path(state: &State<'_, AppState>, mod_id: &str) -> Result<(PathBuf, String), AppError> {
    let data = state
        .data
        .lock()
        .map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    let m = data
        .mods
        .iter()
        .find(|m| m.id == mod_id)
        .ok_or_else(|| AppError::NotFound("Mod introuvable".to_string()))?;
    Ok((m.mod_folder_path.clone(), m.name.clone()))
}

/// Point a mod at its new location and persist.
fn set_mod_path(state: &State<'_, AppState>, mod_id: &str, path: &Path) -> Result<(), AppError> {
    {
        let mut data = state
            .data
            .lock()
            .map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        let m = data
            .mods
            .iter_mut()
            .find(|m| m.id == mod_id)
            .ok_or_else(|| AppError::NotFound("Mod introuvable".to_string()))?;
        m.mod_folder_path = path.to_path_buf();
    }
    let _ = state.save();
    crate::commands::mods::invalidate_cache(state);
    Ok(())
}

/// A free name beside `sibling`, starting from `stem` (+ `ext`), never overwriting.
fn free_name(parent: &Path, stem: &str, ext: Option<&str>) -> PathBuf {
    let build = |n: u32| -> PathBuf {
        let base = if n == 0 { stem.to_string() } else { format!("{} ({})", stem, n) };
        match ext {
            Some(e) => parent.join(format!("{}.{}", base, e)),
            None => parent.join(base),
        }
    };
    let mut n = 0;
    loop {
        let p = build(n);
        if !p.exists() {
            return p;
        }
        n += 1;
        // Not a real bound so much as a refusal to spin forever on a pathological directory.
        if n > 9_999 {
            return build(n);
        }
    }
}

/// The parent directory a mod lives in, refusing anything without one.
///
/// This is the confinement check: every path these commands create or delete is built by
/// joining onto this parent. A mod whose path is a filesystem root has no parent, and a
/// command that would then operate on the root is refused rather than clamped to something
/// plausible.
fn parent_of(p: &Path) -> Result<PathBuf, AppError> {
    p.parent()
        .filter(|par| !par.as_os_str().is_empty())
        .map(|par| par.to_path_buf())
        .ok_or_else(|| {
            AppError::Internal(format!(
                "Le dossier de ce mod n'a pas de parent ({}) — opération refusée.",
                p.display()
            ))
        })
}

/// True when this mod is stored as an archive file rather than a folder.
#[tauri::command]
pub async fn is_mod_archived(state: State<'_, AppState>, mod_id: String) -> Result<bool, AppError> {
    let (path, _) = mod_path(&state, &mod_id)?;
    Ok(crate::archive::is_archive(&path))
}

/// Unpack an archived mod into a real folder, permanently.
///
/// `Mod.zip` becomes the folder `Mod/` beside it and the `.zip` is deleted. The mod record
/// is repointed at the folder, so from here on it behaves like any other unpacked mod —
/// including for the mapper, which can then move its files around.
///
/// Returns the new folder path. Calling it on a mod that is already a folder is a no-op that
/// returns the existing path, so the caller does not have to check first.
#[tauri::command]
pub async fn unarchive_mod(state: State<'_, AppState>, mod_id: String) -> Result<String, AppError> {
    let (archive, name) = mod_path(&state, &mod_id)?;
    if !crate::archive::is_archive(&archive) {
        return Ok(archive.to_string_lossy().to_string());
    }
    let parent = parent_of(&archive)?;
    let stem = archive
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| name.clone());

    let dest = free_name(&parent, &stem, None);
    // Extract to a temporary sibling first. If this fails or the app dies mid-way, the
    // archive is still there and still the mod — nothing has been lost.
    let staging = free_name(&parent, &format!(".bmm_unpack_{}", stem), None);

    let a = archive.clone();
    let s = staging.clone();
    let d = dest.clone();
    tauri::async_runtime::spawn_blocking(move || -> std::io::Result<()> {
        crate::archive::extract_to(&a, &s)?;
        std::fs::rename(&s, &d)?;
        std::fs::remove_file(&a)?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
    .map_err(|e| {
        let _ = std::fs::remove_dir_all(&staging);
        AppError::Internal(format!("Extraction impossible : {}", e))
    })?;

    set_mod_path(&state, &mod_id, &dest)?;
    info!("Unarchived mod '{}' -> {}", name, dest.display());
    Ok(dest.to_string_lossy().to_string())
}

/// Pack an unpacked mod back into a single `.zip`, permanently.
///
/// The folder is zipped beside itself and then removed, and the mod record is repointed at
/// the archive. Returns the new archive path.
///
/// ALWAYS a `.zip`, whatever the mod arrived as. BMM reads 7z and rar but cannot write them,
/// so a mod that was originally `Mod.rar` comes back as `Mod.zip`. Callers show that to the
/// user rather than letting them discover it in the folder afterwards.
///
/// A mod that is already an archive is a no-op that returns its existing path.
#[tauri::command]
pub async fn rearchive_mod(state: State<'_, AppState>, mod_id: String) -> Result<String, AppError> {
    let (folder, name) = mod_path(&state, &mod_id)?;
    if crate::archive::is_archive(&folder) {
        return Ok(folder.to_string_lossy().to_string());
    }
    if !folder.is_dir() {
        return Err(AppError::NotFound(format!(
            "Dossier du mod introuvable : {}",
            folder.display()
        )));
    }
    let parent = parent_of(&folder)?;
    let stem = folder
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| name.clone());

    let dest = free_name(&parent, &stem, Some("zip"));
    let staging = free_name(&parent, &format!(".bmm_pack_{}", stem), Some("zip.part"));

    let f = folder.clone();
    let s = staging.clone();
    let d = dest.clone();
    tauri::async_runtime::spawn_blocking(move || -> std::io::Result<()> {
        zip_dir(&f, &s)?;
        std::fs::rename(&s, &d)?;
        std::fs::remove_dir_all(&f)?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
    .map_err(|e| {
        let _ = std::fs::remove_file(&staging);
        AppError::Internal(format!("Compression impossible : {}", e))
    })?;

    set_mod_path(&state, &mod_id, &dest)?;
    info!("Re-archived mod '{}' -> {}", name, dest.display());
    Ok(dest.to_string_lossy().to_string())
}

/// Zip `dir` into `out`, entries relative to `dir` with forward slashes.
///
/// Forward slashes are not cosmetic: `archive_entries()` reads entries back as
/// `/forward-slashed/` relative paths so an archived mod fingerprints identically to its
/// unpacked twin. A backslash here would break that equivalence on Windows only.
fn zip_dir(dir: &Path, out: &Path) -> std::io::Result<()> {
    use std::io::Write;
    let file = std::fs::File::create(out)?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let zerr = |e: zip::result::ZipError| std::io::Error::new(std::io::ErrorKind::Other, e.to_string());

    let mut stack = vec![dir.to_path_buf()];
    while let Some(cur) = stack.pop() {
        for entry in std::fs::read_dir(&cur)? {
            let entry = entry?;
            let path = entry.path();
            let rel = path
                .strip_prefix(dir)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?
                .to_string_lossy()
                .replace('\\', "/");
            if path.is_dir() {
                zip.add_directory(format!("{}/", rel), opts).map_err(zerr)?;
                stack.push(path);
            } else {
                zip.start_file(rel, opts).map_err(zerr)?;
                let mut src = std::fs::File::open(&path)?;
                std::io::copy(&mut src, &mut zip)?;
                zip.flush()?;
            }
        }
    }
    zip.finish().map_err(zerr)?;
    Ok(())
}
