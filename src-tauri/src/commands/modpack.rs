use tauri::Manager;
use tauri::Emitter;
use crate::models::modpack::LocalModpack;
use crate::state::AppState;
use std::path::PathBuf;
use tauri::{AppHandle, State};
use crate::error::AppError;

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Returns the path to the modpacks directory in AppData
fn get_modpacks_dir(handle: &AppHandle) -> Result<PathBuf, AppError> {
    let app_dir = handle
        .path()
        .app_data_dir().ok()
        .ok_or_else(|| AppError::Internal("Cannot resolve AppData directory".to_string()))?;
    let dir = app_dir.join("modpacks");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)?;
    }
    Ok(dir)
}

fn modpack_path(handle: &AppHandle, id: &str) -> Result<PathBuf, AppError> {
    Ok(get_modpacks_dir(handle)?.join(format!("{}.json", id)))
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Save (create or update) a modpack to AppData/modpacks/<id>.json
#[tauri::command]
pub async fn save_modpack(
    handle: AppHandle,
    mut modpack: LocalModpack,
) -> Result<LocalModpack, AppError> {
    // Ensure IDs and timestamps
    if modpack.id.is_empty() {
        modpack.id = uuid::Uuid::new_v4().to_string();
    }
    let now = chrono::Utc::now().to_rfc3339();
    if modpack.created_at.is_empty() {
        modpack.created_at = now.clone();
    }
    modpack.updated_at = now;

    let path = modpack_path(&handle, &modpack.id)?;
    let json = serde_json::to_string_pretty(&modpack)?;
    std::fs::write(&path, json)?;

    Ok(modpack)
}

/// Load all modpacks from AppData/modpacks/
#[tauri::command]
pub async fn load_modpacks(handle: AppHandle) -> Result<Vec<LocalModpack>, AppError> {
    let dir = get_modpacks_dir(&handle)?;
    let mut packs = Vec::new();

    let entries = std::fs::read_dir(&dir)?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            match std::fs::read_to_string(&path) {
                Ok(content) => {
                    match serde_json::from_str::<LocalModpack>(&content) {
                        Ok(pack) => packs.push(pack),
                        Err(e) => {
                            crate::commands::crash::log_line(format!(
                                "[Modpack] Failed to parse {:?}: {}", path, e
                            ));
                        }
                    }
                }
                Err(e) => {
                    crate::commands::crash::log_line(format!(
                        "[Modpack] Failed to read {:?}: {}", path, e
                    ));
                }
            }
        }
    }

    // Sort by updated_at descending
    packs.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(packs)
}

/// Get a single modpack by ID
#[tauri::command]
pub async fn get_modpack_by_id(
    handle: AppHandle,
    id: String,
) -> Result<Option<LocalModpack>, AppError> {
    let path = modpack_path(&handle, &id)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path)?;
    let pack = serde_json::from_str::<LocalModpack>(&content)?;
    Ok(Some(pack))
}

/// Delete a modpack by ID
#[tauri::command]
pub async fn delete_modpack(handle: AppHandle, id: String) -> Result<(), AppError> {
    let path = modpack_path(&handle, &id)?;
    if path.exists() {
        std::fs::remove_file(&path)?;
    }
    Ok(())
}

/// Build a ModpackModRef from a locally installed mod.
/// Reads all files in the mod folder, computes SHA-256, and returns a ready-to-use ref.
#[tauri::command]
pub async fn build_modpack_mod_ref(
    _handle: AppHandle,
    state: State<'_, AppState>,
    mod_id: String,
    profile_id: Option<String>,
    include_dependencies: bool,
    download_link: Option<String>,
    fallback_link: Option<String>,
    fallback_type: Option<String>,
) -> Result<crate::models::modpack::ModpackModRef, AppError> {
    let (mod_entry, profile_name) = {
        let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;

        let m = data.mods.iter()
            .find(|m| m.id == mod_id)
            .ok_or_else(|| AppError::NotFound(format!("Mod '{}' not found", mod_id)))?
            .clone();

        let pname = if let Some(ref pid) = profile_id {
            data.profiles.iter()
                .find(|p| &p.id == pid)
                .map(|p| p.name.clone())
        } else {
            None
        };
        (m, pname)
    };

    // An archived mod is a .zip ON DISK, so its files have to be read from the extracted view.
    //
    // `list_mod_files` already knows this — for an archive it returns the entry names from
    // inside it. What followed did not: it joined those entry names onto the .zip PATH, giving
    // `…/thing.zip/textures/a.dds`, which exists nowhere. `metadata` failed (size 0) and
    // `compute_file_hash` failed outright, so `?` returned Err and the ref was never built.
    //
    // The consequence, several steps later and looking nothing like this: a modpack containing
    // a zipped mod would not enable it. `sha256` was empty or missing, `_findLocalByMref` skips
    // an empty hash, the mod counted as "missing" and was quietly left off.
    //
    // Every other reader in this codebase resolves the path through `mod_read_root` first —
    // update_mod_hashes, the background hasher, enable_mod. This one was the exception.
    let mod_folder = &mod_entry.mod_folder_path;
    let read_root = crate::archive::mod_read_root(mod_folder);
    let files = crate::fs_utils::list_mod_files(&read_root).map_err(|e| e.to_string())?;

    let mut file_manifest = Vec::new();
    let mut first_sha = String::new();

    for rel in &files {
        let full = read_root.join(rel);
        let size = std::fs::metadata(&full).map(|m| m.len()).unwrap_or(0);
        // Tagged BLAKE3 (`b3:…`), parallel within large files. Stored in the
        // `sha256` field (kept for serde back-compat); readers detect the tag.
        let sha = crate::fs_utils::compute_file_hash(&full).map_err(|e| e.to_string())?;
        if first_sha.is_empty() { first_sha = sha.clone(); }
        file_manifest.push(crate::models::modpack::ModpackFileRef {
            relative_path: rel.to_string_lossy().replace('\\', "/"),
            sha256: sha,
            size,
        });
    }

    Ok(crate::models::modpack::ModpackModRef {
        mod_id: mod_entry.id.clone(),
        mod_name: mod_entry.name.clone(),
        mod_version: mod_entry.version.clone(),
        profile_id,
        profile_name,
        sha256: first_sha,
        file_manifest,
        include_dependencies,
        download_link,
        fallback_link,
        fallback_type,
    })
}

/// Exports a modpack to `.bmp`. Optional `dest_dir` writes straight into that
/// folder (no dialog); otherwise a save dialog opens.
#[tauri::command]
pub async fn export_modpack(
    handle: AppHandle,
    id: String,
    dest_dir: Option<String>,
) -> Result<(), String> {
    use tauri_plugin_dialog::DialogExt;
    let pack = get_modpack_by_id(handle.clone(), id).await?.ok_or("Modpack not found")?;

    let default_name = format!("{}.bmp", pack.name.replace(" ", "_"));
    // Signed like every other document BMM writes: a modpack is a list of mods somebody
    // else installs from, which is exactly the shape of file worth vouching for.
    let mut doc = serde_json::to_value(&pack).map_err(|e| e.to_string())?;
    crate::commands::doc_sign::sign_doc(&handle, &mut doc, "bmp");
    let json = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;

    let target = match dest_dir.filter(|d| !d.trim().is_empty()) {
        Some(d) => {
            let dir = std::path::PathBuf::from(&d);
            if !dir.is_dir() { return Err(format!("Not a folder: {}", d)); }
            Some(dir.join(&default_name))
        }
        None => handle.dialog().file()
            .add_filter("Better ModPack", &["bmp"])
            .set_file_name(&default_name)
            .blocking_save_file()
            .and_then(|fp| fp.into_path().ok()),
    };

    if let Some(path) = target {
        std::fs::write(path, json).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Install a modpack straight from a catalogue.
///
/// Downloads the `.bmp` and hands it to `import_modpack`, so a pack that arrives from a
/// catalogue and one you picked off your disk go through exactly the same importer — the
/// validation, the id handling and the events all stay in one place. This adds a transport,
/// not a second way to install.
///
/// `catalog_get` carries the download password and the key proof, so a modpack catalogue can
/// be protected exactly like every other kind. Getting that for free is the whole reason this
/// does not fetch with its own client.
#[tauri::command]
pub async fn install_modpack_from_url(
    handle: AppHandle,
    state: State<'_, AppState>,
    download_url: String,
) -> Result<LocalModpack, AppError> {
    let bytes = crate::commands::net::catalog_get(&handle, &download_url)
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("modpack.errDownload|{}", e)))?
        .bytes()
        .await
        .map_err(|e| AppError::Internal(format!("modpack.errDownload|{}", e)))?;

    // A temp file rather than an in-memory path into the importer: the importer's contract is
    // "a file on disk", and widening it to "bytes OR a file" would mean two code paths through
    // the part that actually validates a pack.
    let dir = std::env::temp_dir().join("bmm-modpack-dl");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Internal(e.to_string()))?;
    // The name comes from a counter, never from the URL: a download_url ending in
    // `../../evil.bmp` would otherwise choose where this lands (CWE-22).
    let file = dir.join(format!("pack-{}.bmp", std::process::id()));
    std::fs::write(&file, &bytes).map_err(|e| AppError::Internal(e.to_string()))?;

    let _ = &state; // the importer reaches state through the handle; kept for symmetry with the
                    // other install commands and so a future check has it without a signature change
    let result = import_modpack(handle, Some(file.to_string_lossy().to_string())).await;
    // Removed whether the import worked or not: a failed download leaves a half-written pack
    // in temp, and the next attempt would find it.
    let _ = std::fs::remove_file(&file);
    result
}

/// Imports a modpack from a user-selected path (.bmp).
/// Optional `path` arg imports that file directly (API callers); otherwise a dialog opens.
#[tauri::command]
pub async fn import_modpack(
    handle: AppHandle,
    path: Option<String>,
) -> Result<LocalModpack, AppError> {
    use tauri_plugin_dialog::DialogExt;

    let chosen = match path.filter(|p| !p.trim().is_empty()) {
        Some(p) => {
            let pb = std::path::PathBuf::from(&p);
            if !pb.exists() { return Err(AppError::NotFound(format!("File not found: {}", p))); }
            Some(pb)
        }
        None => handle.dialog().file()
            .add_filter("Better ModPack", &["bmp", "json"])
            .blocking_pick_file()
            .and_then(|fp| fp.into_path().ok()),
    };

    if let Some(path) = chosen
    {
        let content = std::fs::read_to_string(path)?;
        let mut pack = serde_json::from_str::<LocalModpack>(&content)?;
        
        // Generate new UUID to avoid collisions
        pack.id = uuid::Uuid::new_v4().to_string();
        
        return save_modpack(handle, pack).await;
    }
    Err(AppError::Internal("repo.errCancel".to_string()))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModpackIntegrityReport {
    pub total_mods: usize,
    pub missing_mods: Vec<crate::models::modpack::ModpackModRef>,
    pub corrupted_mods: Vec<crate::models::modpack::ModpackModRef>,
    pub valid_mods: Vec<crate::models::modpack::ModpackModRef>,
}

#[tauri::command]
pub async fn check_modpack_integrity(
    state: State<'_, AppState>,
    modpack: LocalModpack,
) -> Result<ModpackIntegrityReport, AppError> {
    let mut missing_mods = Vec::new();
    let mut corrupted_mods = Vec::new();
    let mut valid_mods = Vec::new();

    let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;

    for mref in &modpack.mods {
        let mut found_mod = data.mods.iter().find(|m| m.id == mref.mod_id);

        if found_mod.is_none() && !mref.sha256.is_empty() {
            found_mod = data.mods.iter().find(|m| {
                if let Some(hashes) = &m.file_hashes {
                    hashes.values().any(|h| h == &mref.sha256)
                } else {
                    false
                }
            });
        }

        if let Some(local_mod) = found_mod {
            let mut is_corrupted = false;

            // An archived mod is a .zip ON DISK — its files live INSIDE the archive, not at
            // `mod_folder_path/<relative>`. Joining onto the folder path gave `…/thing.zip/tex/a.dds`,
            // which exists nowhere, so every archived mod in a pack was flagged corrupt (issues1.0
            // "Modpacks contenant des archives"). `mod_read_root` returns the extracted view for an
            // archive (and the folder unchanged for a regular mod), the same resolution every other
            // reader here already uses.
            let read_root = crate::archive::mod_read_root(&local_mod.mod_folder_path);

            for file_ref in &mref.file_manifest {
                let local_file_path = read_root.join(&file_ref.relative_path);
                if !local_file_path.exists() {
                    is_corrupted = true;
                    break;
                }
                
                if let Ok(meta) = std::fs::metadata(&local_file_path) {
                    if meta.len() != file_ref.size {
                        is_corrupted = true;
                        break;
                    }
                } else {
                    is_corrupted = true;
                    break;
                }
                
                // Algorithm-aware: new packs carry BLAKE3 (`b3:`), old packs SHA-256.
                if !crate::fs_utils::file_matches_hash(&local_file_path, &file_ref.sha256) {
                    is_corrupted = true;
                    break;
                }
            }
            
            if is_corrupted {
                corrupted_mods.push(mref.clone());
            } else {
                valid_mods.push(mref.clone());
            }
        } else {
            missing_mods.push(mref.clone());
        }
    }

    Ok(ModpackIntegrityReport {
        total_mods: modpack.mods.len(),
        missing_mods,
        corrupted_mods,
        valid_mods,
    })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairArgs {
    pub mod_ref: crate::models::modpack::ModpackModRef,
    pub sr_link: Option<String>,
    pub target_profile_id: String,
    pub creator_id: Option<String>,
}

fn find_file_by_hash_in_dir(dir: &std::path::Path, expected_hash: &str) -> Option<std::path::PathBuf> {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                // Algorithm-aware: expected_hash may be BLAKE3 (`b3:`) or SHA-256.
                if crate::fs_utils::file_matches_hash(&path, expected_hash) {
                    return Some(path);
                }
            } else if path.is_dir() {
                if let Some(found) = find_file_by_hash_in_dir(&path, expected_hash) {
                    return Some(found);
                }
            }
        }
    }
    None
}

#[tauri::command]
pub async fn repair_modpack_mod(
    window: tauri::Window,
    state: State<'_, AppState>,
    args: RepairArgs,
) -> Result<crate::models::mod_entry::ModEntry, AppError> {
    use std::io::Write;
    
    let mod_ref = args.mod_ref;
    let fallback_type = mod_ref.fallback_type.clone().unwrap_or_else(|| "direct".to_string());
    
    // 1. Déterminer ou créer le dossier cible
    let (target_dir, existing_mod) = {
        let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        let profile = data.profiles.iter().find(|p| p.id == args.target_profile_id)
            .ok_or_else(|| AppError::NotFound("Profil introuvable".to_string()))?;
            
        let mut found_mod = data.mods.iter().find(|m| m.id == mod_ref.mod_id).cloned();
        if found_mod.is_none() && !mod_ref.sha256.is_empty() {
            found_mod = data.mods.iter().find(|m| {
                if let Some(hashes) = &m.file_hashes {
                    hashes.values().any(|h| h == &mod_ref.sha256)
                } else {
                    false
                }
            }).cloned();
        }
        
        let target_dir = if let Some(m) = &found_mod {
            m.mod_folder_path.clone()
        } else {
            let safe_mod_name = mod_ref.mod_name.replace(|c: char| !c.is_alphanumeric() && c != ' ' && c != '-' && c != '_', "_");
            let subfolder = format!("{}_{}", &mod_ref.mod_id.chars().take(8).collect::<String>(), safe_mod_name);
            profile.mods_path.join(subfolder)
        };
        
        if !target_dir.exists() {
            std::fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
        }
        
        (target_dir, found_mod)
    };

    // 2. Téléchargement et Réparation
    let mut client_builder = reqwest::Client::builder();
    if let Some(ref cid) = args.creator_id {
        let mut headers = reqwest::header::HeaderMap::new();
        if let Ok(hv) = reqwest::header::HeaderValue::from_str(cid) {
            headers.insert("X-Creator-ID", hv);
        }
        client_builder = client_builder.default_headers(headers);
    }
    let client = client_builder.build().map_err(|e| e.to_string())?;

    if fallback_type == "sr" {
        // ServerRepo Logique
        let base_url = if let Some(url) = mod_ref.fallback_link.clone().or(args.sr_link) {
            if url.ends_with("repo.json") { url.trim_end_matches("repo.json").to_string() }
            else if url.ends_with('/') { url }
            else { format!("{}/", url) }
        } else {
            return Err(AppError::Internal("Aucun lien ServerRepo fourni".to_string()));
        };

        for (_idx, file_ref) in mod_ref.file_manifest.iter().enumerate() {
            let local_path = target_dir.join(&file_ref.relative_path);
            let mut needs_download = true;

            if local_path.exists() && crate::fs_utils::file_matches_hash(&local_path, &file_ref.sha256) {
                needs_download = false;
            }

            if needs_download {
                // Tentative de récupération locale (fichier déplacé par mégarde)
                let mut recovered = false;
                if let Some(found_path) = find_file_by_hash_in_dir(&target_dir, &file_ref.sha256) {
                    if let Some(parent) = local_path.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    if std::fs::rename(&found_path, &local_path).is_ok() || std::fs::copy(&found_path, &local_path).is_ok() {
                        recovered = true;
                    }
                }

                if !recovered {
                    if let Some(parent) = local_path.parent() {
                        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    
                    let file_url = format!("{}mods/{}/{}", base_url, mod_ref.mod_id, file_ref.relative_path.replace("\\", "/"));
                    let mut resp = client.get(&file_url).send().await.map_err(|e| e.to_string())?;
                    
                    if !resp.status().is_success() {
                        if resp.status() == 403 {
                            return Err(AppError::Internal("Accès refusé par le serveur".to_string()));
                        }
                        return Err(AppError::NotFound(format!("Fichier non trouvé sur le serveur: {}", file_ref.relative_path)));
                    }
                    
                    let total_size = resp.content_length().unwrap_or(file_ref.size);
                    let mut downloaded: u64 = 0;
                    let mut file_out = std::fs::File::create(&local_path).map_err(|e| e.to_string())?;
                    
                    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
                        file_out.write_all(&chunk).map_err(|e| e.to_string())?;
                        downloaded += chunk.len() as u64;
                        
                        let progress = if total_size > 0 {
                            (downloaded as f32 / total_size as f32) * 100.0
                        } else {
                            0.0
                        };
                        
                        let _ = window.emit("bmm://repair-progress", serde_json::json!({
                            "modName": mod_ref.mod_name,
                            "file": file_ref.relative_path,
                            "progress": progress
                        }));
                    }
                }
            }
        }
    } else {
        // Direct Download Logique
        // 1. Tentative de récupération locale AVANT de télécharger (fichiers déplacés par mégarde)
        let mut all_recovered = true;
        
        if !mod_ref.file_manifest.is_empty() {
            // Si on a un manifest de fichiers, on peut vérifier chaque fichier individuellement
            for file_ref in &mod_ref.file_manifest {
                let local_path = target_dir.join(&file_ref.relative_path);
                let mut needs_fix = true;
                
                if local_path.exists() && crate::fs_utils::file_matches_hash(&local_path, &file_ref.sha256) {
                    needs_fix = false;
                }

                if needs_fix {
                    if let Some(found) = find_file_by_hash_in_dir(&target_dir, &file_ref.sha256) {
                        if let Some(parent) = local_path.parent() {
                            let _ = std::fs::create_dir_all(parent);
                        }
                        let _ = std::fs::rename(&found, &local_path)
                            .or_else(|_| std::fs::copy(&found, &local_path).map(|_| ()));
                    } else {
                        all_recovered = false; // Au moins un fichier vraiment absent
                    }
                }
            }
        } else {
            // Pas de manifest : on ne peut pas récupérer localement
            all_recovered = false;
        }
        
        // 2. Si la récupération locale ne suffit pas, on télécharge
        if !all_recovered {
            let url = mod_ref.download_link.clone().or(mod_ref.fallback_link.clone())
                .ok_or_else(|| AppError::Internal("Aucun lien de téléchargement direct fourni".to_string()))?;
                
            let _ = window.emit("bmm://repair-progress", serde_json::json!({
                "modName": mod_ref.mod_name,
                "file": "Téléchargement de l'archive...",
                "progress": 50.0
            }));

            let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
            if !res.status().is_success() {
                return Err(AppError::Internal(format!("Error during download: {}", res.status())));
            }
            
            // Stream straight to the temp file. This used to buffer the whole modpack in memory
            // with res.bytes() and then write that buffer out — the file was always the
            // destination, so the RAM copy bought nothing and cost the size of the download.
            // (The other download in this file already streams with .chunk().)
            let temp_dir = std::env::temp_dir();
            let temp_zip = temp_dir.join(format!("{}.zip", uuid::Uuid::new_v4()));
            {
                let mut res = res;
                let mut out = std::fs::File::create(&temp_zip).map_err(|e| e.to_string())?;
                while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
                    std::io::Write::write_all(&mut out, &chunk).map_err(|e| e.to_string())?;
                }
                std::io::Write::flush(&mut out).map_err(|e| e.to_string())?;
            }
            
            let file = std::fs::File::open(&temp_zip).map_err(|e| e.to_string())?;
            let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
            
            for i in 0..archive.len() {
                let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
                // CWE-22 Zip Slip: never join the raw entry name — use enclosed_name()
                // (None ⇒ the entry would escape target_dir via `..`/absolute → skip).
                let safe = match file.enclosed_name() { Some(p) => p.to_path_buf(), None => continue };
                let outpath = target_dir.join(&safe);

                if file.name().ends_with('/') {
                    std::fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
                } else {
                    if let Some(p) = outpath.parent() {
                        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
                    }
                    let mut outfile = std::fs::File::create(&outpath).map_err(|e| e.to_string())?;
                    std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
                }
            }
            let _ = std::fs::remove_file(temp_zip);
        }
    }

    // 3. Mettre à jour l'entrée du mod dans la librairie
    let final_entry = {
        let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        
        // Si le mod existait sous un autre ID (trouvé par SHA256), on va l'écraser et FORCER le nouvel ID
        if let Some(existing) = &existing_mod {
            if let Some(m) = data.mods.iter_mut().find(|m| m.id == existing.id) {
                m.id = mod_ref.mod_id.clone(); // Force modpack ID
                m.name = mod_ref.mod_name.clone();
                m.version = mod_ref.mod_version.clone();
            }
        } else {
            // Créer le nouveau mod
            let mut new_mod = crate::models::mod_entry::ModEntry::new(mod_ref.mod_name.clone(), target_dir);
            new_mod.id = mod_ref.mod_id.clone();
            new_mod.version = mod_ref.mod_version.clone();
            data.mods.push(new_mod);
        }
        
        data.mods.iter().find(|m| m.id == mod_ref.mod_id)
            .ok_or_else(|| AppError::Internal("Mod introuvable après insertion".to_string()))?.clone()
    };
    
    let _ = state.save();
    crate::commands::mods::invalidate_cache(&state);

    Ok(final_entry)
}
