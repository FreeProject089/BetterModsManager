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
    /// Resolved to NAMES while the lock is held — an id means nothing on the machine that
    /// opens the file.
    dependencies: Vec<String>,
    update_sources: Vec<crate::models::mod_entry::UpdateSource>,
    /// Carried through so the list keeps what the mod knows about itself: who it is, and
    /// where it updates from.
    id: String,
    content_id: Option<String>,
    source_repo: Option<String>,
    repo_mod_id: Option<String>,
    update_url: Option<String>,
    install_notes: String,
}

#[tauri::command]
pub async fn export_modlist(
    state: tauri::State<'_, AppState>,
    window: tauri::Window,
    handle: tauri::AppHandle,
    list_name: String,
    description: String,
    author: String,
    output_path: String,
    include_hashes: bool,
) -> Result<(), AppError> {
    // ── Phase 1: hold lock only long enough to read in-memory state ──────────
    let (game_name, game_path_hint, snapshots, tag_defs, packs) = {
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
                dependencies: m.dependencies.iter()
                    .filter_map(|dep| {
                        // A cross-profile reference is "profile::mod"; only the mod half can
                        // be resolved, and only within what this export can see.
                        let id = dep.rsplit("::").next().unwrap_or(dep);
                        data.mods.iter().find(|o| o.id == id).map(|o| o.name.clone())
                    })
                    .collect(),
                update_sources: m.update_sources.clone(),
                id: m.id.clone(),
                content_id: m.content_id.clone(),
                source_repo: m.source_repo.clone(),
                repo_mod_id: m.repo_mod_id.clone(),
                update_url: m.update_url.clone(),
                install_notes: m.install_notes.clone(),
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

        // Modpacks whose mods are ALL in this list. A pack that half-installs is worse than
        // a pack that is missing — the same rule the repo manifest applies.
        let exported: std::collections::HashSet<String> =
            snapshots.iter().map(|s| s.name.clone()).collect();
        let name_of: std::collections::HashMap<String, String> = data.mods.iter()
            .map(|m| (m.id.clone(), m.name.clone()))
            .collect();
        let packs: Vec<crate::models::modpack::LocalModpack> = data.modpacks.iter()
            .filter(|p| p.mods.iter().all(|r| name_of.get(&r.mod_id).is_some_and(|n| exported.contains(n))))
            .cloned()
            .collect();

        (game_name, game_path_hint, snapshots, tag_defs, packs)
        // lock dropped here
    };

    // ── Phase 2: process each mod off the async thread, emit progress ─────────
    let total = snapshots.len();
    let mut modlist = ModList::new(list_name, game_name, game_path_hint);
    modlist.description = Some(description);
    modlist.author = Some(author);
    modlist.tag_defs = tag_defs;
    modlist.modpacks = packs;

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
            // The mod's own notes. This was String::new() — written by the exporter, read by
            // the importer, and empty in between, so placement instructions somebody wrote
            // for their own install never reached the person they sent the list to.
            install_notes: snap.install_notes,
            tags: snap.tags,
            dependencies: snap.dependencies,
            update_sources: snap.update_sources,
            id: snap.id,
            content_id: snap.content_id,
            source_repo: snap.source_repo,
            repo_mod_id: snap.repo_mod_id,
            update_url: snap.update_url,
        });
    }

    let _ = window.emit("bmm://mm-export-progress", serde_json::json!({
        "current": total,
        "total": total,
        "done": true,
    }));

    // Signed on the way out, like repo.json has always been. A mod list is posted and
    // opened by strangers exactly the way a repo is, and the person opening it had no way to
    // tell whether it was still what the author wrote.
    let mut doc = serde_json::to_value(&modlist)?;
    crate::commands::doc_sign::sign_doc(&handle, &mut doc, "mm");
    let json = serde_json::to_string_pretty(&doc)?;

    // Written as a ZIP. The list has grown past "a JSON document": it carries tag
    // definitions, whole modpacks and update sources, and the next thing it needs to carry
    // is a file rather than a field — an icon, a readme, a preset. A container has somewhere
    // to put those; a document has to base64 them into itself.
    //
    // The extension does not change. `.mm` is what people have, what the docs say, and what
    // BCWEB's inspector recognises — and read_modlist_file opens both shapes, so nothing
    // anybody already exported stops working.
    let entries = vec![(MODLIST_ENTRY.to_string(), json.into_bytes())];
    let manifest = crate::commands::doc_sign::archive_manifest(&handle, "mm", &entries);
    let sig = serde_json::to_vec_pretty(&manifest)?;

    tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        use std::io::Write;
        let file = std::fs::File::create(&output_path)?;
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::FileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in entries.iter()
            .chain(std::iter::once(&(crate::commands::doc_sign::ARCHIVE_ENTRY.to_string(), sig)))
        {
            zip.start_file(name.clone(), opts)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
            zip.write_all(data)?;
        }
        zip.finish().map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
        Ok(())
    })
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
    read_modlist_file(std::path::Path::new(&path))
}

/// The name the document has inside a `.mm` archive.
pub const MODLIST_ENTRY: &str = "modlist.json";

/// Read a `.mm`, in either shape.
///
/// A `.mm` is a ZIP now — it carries the list plus the tag definitions, the modpacks and the
/// update sources, and there is more to come. The old shape is a bare JSON document, and
/// every list anybody has ever exported is one, so BOTH open here. The BYTES decide: a ZIP
/// starts with `PK`, which is not something a JSON document can start with.
///
/// Deliberately not a version field. A file written last year has no idea a version field
/// was going to exist, and asking "is this a zip" is a question the file answers about
/// itself.
pub fn read_modlist_file(path: &std::path::Path) -> Result<ModList, AppError> {
    let bytes = std::fs::read(path)?;
    if bytes.starts_with(b"PK") {
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(&bytes))
            .map_err(|e| AppError::LockError(format!("not a readable .mm archive: {e}")))?;
        let mut file = zip.by_name(MODLIST_ENTRY)
            .map_err(|_| AppError::LockError(format!("this .mm has no {MODLIST_ENTRY}")))?;
        let mut text = String::new();
        std::io::Read::read_to_string(&mut file, &mut text)?;
        return serde_json::from_str(&text).map_err(AppError::Json);
    }
    let text = String::from_utf8_lossy(&bytes).to_string();
    serde_json::from_str(&text).map_err(AppError::Json)
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
