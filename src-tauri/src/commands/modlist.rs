use tauri::Emitter;
use crate::fs_utils;
use crate::models::modlist::{DownloadLink, ModFileEntry, ModList, ModListEntry};
use crate::state::AppState;
use tauri::State;
use crate::error::AppError;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::PathBuf;
use std::sync::atomic::Ordering;

/// Lightweight snapshot of a mod's fields — collected while holding the lock,
/// then used after releasing it so the heavy file I/O never blocks AppState.
struct ModSnapshot {
    folder: PathBuf,
    name: String,
    version: String,
    author: Option<String>,
    description: Option<String>,
    download_links: Vec<DownloadLink>,
    tags: Vec<String>,
}

#[tauri::command]
pub async fn export_modlist(
    state: tauri::State<'_, AppState>,
    window: tauri::Window,
    list_name: String,
    description: String,
    author: String,
    output_path: String,
    include_hashes: bool,
) -> Result<(), AppError> {
    // ── Phase 1: hold lock only long enough to read in-memory state ──────────
    let (game_name, game_path_hint, snapshots, tag_defs) = {
        let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;

        let active_profile = if let Some(ref id) = data.active_profile_id {
            data.profiles.iter().find(|p| &p.id == id)
        } else {
            None
        };

        let (game_name, game_path_hint, mods_path) = match active_profile {
            Some(p) => (p.game_name.clone(), p.game_path.to_string_lossy().to_string(), Some(p.mods_path.clone())),
            None => (String::new(), String::new(), None),
        };

        let snapshots: Vec<ModSnapshot> = data.mods.iter().enumerate().filter_map(|(_i, m)| {
            if let Some(ref mp) = mods_path {
                if !m.mod_folder_path.starts_with(mp) {
                    return None;
                }
            }
            Some(ModSnapshot {
                folder: m.mod_folder_path.clone(),
                name: m.name.clone(),
                version: m.version.clone(),
                author: m.author.clone(),
                description: m.description.clone(),
                download_links: m.download_links.iter().map(|dl| DownloadLink {
                    url: dl.url.clone(),
                    link_type: dl.link_type.clone(),
                    label: dl.label.clone(),
                }).collect(),
                tags: m.tags.clone(),
            })
        }).collect();

        // The definitions of every tag these mods refer to. Collected here, under the same
        // lock, because it is the only place that can see both.
        let used: std::collections::HashSet<String> =
            snapshots.iter().flat_map(|s| s.tags.iter().cloned()).collect();
        let tag_defs: Vec<crate::models::tag::TagDef> = data.custom_tags.iter()
            .filter(|t| used.contains(&t.id))
            .cloned()
            .collect();

        (game_name, game_path_hint, snapshots, tag_defs)
        // lock dropped here
    };

    // ── Phase 2: process each mod off the async thread, emit progress ─────────
    let total = snapshots.len();
    let mut modlist = ModList::new(list_name, game_name, game_path_hint);
    modlist.description = Some(description);
    modlist.author = Some(author);
    modlist.tag_defs = tag_defs;

    // Reset the cancel flag before starting
    state.export_cancelled.store(false, Ordering::SeqCst);

    for (i, snap) in snapshots.into_iter().enumerate() {
        // Check for cancellation before each mod
        if state.export_cancelled.load(Ordering::SeqCst) {
            state.export_cancelled.store(false, Ordering::SeqCst);
            let _ = window.emit("bmm://mm-export-progress", serde_json::json!({
                "current": i, "total": total, "cancelled": true,
            }));
            return Err(AppError::LockError("Export cancelled by user".to_string()));
        }

        let _ = window.emit("bmm://mm-export-progress", serde_json::json!({
            "current": i,
            "total": total,
            "mod_name": &snap.name,
        }));

        // spawn_blocking keeps the file walk off the async runtime thread
        let folder = snap.folder.clone();
        let cancel_flag = std::sync::Arc::clone(&state.export_cancelled);
        let file_tree = tokio::task::spawn_blocking(move || build_file_tree(&folder, include_hashes, &cancel_flag))
            .await
            .unwrap_or_default();

        modlist.mods.push(ModListEntry {
            name: snap.name,
            version: snap.version,
            author: snap.author,
            description: snap.description,
            download_links: snap.download_links,
            file_tree,
            install_notes: String::new(),
            tags: snap.tags,
        });
    }

    let _ = window.emit("bmm://mm-export-progress", serde_json::json!({
        "current": total,
        "total": total,
        "done": true,
    }));

    let json = serde_json::to_string_pretty(&modlist)?;
    tokio::task::spawn_blocking(move || std::fs::write(&output_path, json))
        .await
        .map_err(|e| AppError::LockError(e.to_string()))??;
    Ok(())
}

/// Cancel an in-progress export — sets the atomic flag checked each iteration.
#[tauri::command]
pub fn cancel_export_modlist(state: State<'_, AppState>) {
    state.export_cancelled.store(true, Ordering::SeqCst);
}

/// Walk a mod folder and record each file's relative path, size, and optional SHA-256.
/// Checks the cancellation flag after each file when hashing is enabled.
fn build_file_tree(
    folder: &PathBuf,
    include_hashes: bool,
    cancel_flag: &std::sync::atomic::AtomicBool,
) -> Vec<ModFileEntry> {
    let mut entries = Vec::new();
    // An archived mod is a .zip, and a .zip has to be read as what is INSIDE it or the
    // exported list describes a single file called "" with the size of the archive. Every
    // other reader in the app already goes through this; this one did not, which is why a
    // list exported from a collection of archives arrived describing nothing.
    let folder = &crate::archive::mod_read_root(folder);
    if let Ok(files) = fs_utils::list_mod_files(folder) {
        for rel in files {
            // Check cancellation before each file when SHA-256 is active
            if include_hashes && cancel_flag.load(Ordering::Relaxed) {
                break;
            }
            let full = folder.join(&rel);
            let size = std::fs::metadata(&full).map(|md| md.len()).unwrap_or(0);
            let sha256 = if include_hashes { hash_file_streaming(&full) } else { None };
            entries.push(ModFileEntry {
                relative_path: rel.to_string_lossy().to_string(),
                is_directory: false,
                size,
                sha256,
            });
        }
    }
    entries
}

/// SHA-256 of a file read in 64 KiB chunks — safe for large files.
fn hash_file_streaming(path: &PathBuf) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let mut reader = std::io::BufReader::with_capacity(65536, file);
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = reader.read(&mut buf).ok()?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    Some(hex::encode(hasher.finalize()))
}

#[tauri::command]
pub fn import_modlist(path: String) -> Result<ModList, AppError> {
    let content = std::fs::read_to_string(&path)?;
    serde_json::from_str(&content).map_err(|e| AppError::Json(e))
}

#[tauri::command]
pub fn add_download_link(
    state: State<AppState>,
    mod_id: String,
    url: String,
    link_type: String,
    label: String,
) -> Result<(), AppError> {
    {
        let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        if let Some(m) = data.mods.iter_mut().find(|m| m.id == mod_id) {
            m.download_links.push(crate::models::mod_entry::DownloadLink {
                url,
                link_type,
                label,
            });
        } else {
            return Err(AppError::NotFound("Mod not found".to_string()));
        }
    }
    state.save()?;
    Ok(())
}

#[tauri::command]
pub fn remove_download_link(
    state: State<AppState>,
    mod_id: String,
    link_index: usize,
) -> Result<(), AppError> {
    {
        let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        if let Some(m) = data.mods.iter_mut().find(|m| m.id == mod_id) {
            if link_index < m.download_links.len() {
                m.download_links.remove(link_index);
            }
        }
    }
    state.save()?;
    Ok(())
}

#[cfg(test)]
#[path = "modlist_tests.rs"]
mod modlist_tests;
