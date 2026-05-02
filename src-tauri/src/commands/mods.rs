use crate::fs_utils;
use crate::models::mod_entry::{ModEntry, ModStatus, ConflictReport, ConflictCategory, ConflictStatus};
use crate::commands::crash::log_line;
use crate::state::AppState;
use std::path::PathBuf;
use tauri::{State, Window};
use std::sync::Mutex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::time::Instant;

#[derive(Serialize, Clone)]
struct BenchEventPayload {
    text: String,
    disk_name: String,
    total_mb: f64,
    limit_mb_s: Option<u64>,
    finished: bool,
}

#[derive(Serialize, Clone)]
pub struct EnrichedMod {
    #[serde(flatten)]
    pub mod_entry: ModEntry,
    pub shared_activations: Vec<SharedActivation>,
}

#[derive(Serialize, Clone)]
pub struct SharedActivation {
    pub profile_name: String,
    pub game_path: String,
    pub active: bool,
}

lazy_static::lazy_static! {
    static ref MOD_OP_LOCK: Mutex<()> = Mutex::new(());
}

#[tauri::command]
pub fn get_mods(state: State<AppState>) -> Result<Vec<EnrichedMod>, String> {
    // 1. Ensure cache is populated (Lazy but thread-safe)
    ensure_cache_populated(&state)?;

    let data = state.data.lock().unwrap();
    let active_id = match data.active_profile_id.as_ref() {
        Some(id) => id,
        None => return Ok(Vec::new()),
    };
    let active_profile = data.profiles.iter().find(|p| &p.id == active_id).ok_or("Profil introuvable")?;
    
    // Canonicalize once outside the loop with safe fallback and logging
    let active_mods_path = match active_profile.mods_path.canonicalize() {
        Ok(path) => path,
        Err(e) => {
            log_line(format!("[MODS] Failed to canonicalize active mods path {:?}: {}. Using original.", active_profile.mods_path, e));
            active_profile.mods_path.clone()
        }
    };
    
    let mut results = Vec::new();
    
    for m in &data.mods {
        let mod_p = &m.mod_folder_path;
        
        let belongs_to_active = if mod_p.starts_with(&active_mods_path) { true } else {
            match mod_p.canonicalize() {
                Ok(m_can) => m_can.starts_with(&active_mods_path),
                _ => false
            }
        };

        if belongs_to_active {
            let mut enriched = EnrichedMod {
                mod_entry: m.clone(),
                shared_activations: Vec::new(),
            };
            
            // Set 'enabled' based on active profile
            enriched.mod_entry.enabled = active_profile.active_mods.contains(&m.id);
            
            // Recalculate conflicts using MEMORY CACHE (O(1))
            enriched.mod_entry.conflicts = calculate_conflicts_from_cache(m, &data, active_id, &state);

            // Find shared activations...
            for p in &data.profiles {
                if p.mods_path == active_profile.mods_path {
                    enriched.shared_activations.push(SharedActivation {
                        profile_name: p.name.clone(),
                        game_path: p.game_path.to_string_lossy().to_string(),
                        active: p.active_mods.contains(&m.id),
                    });
                }
            }
            
            results.push(enriched);
        }
    }
    
    Ok(results)
}

fn ensure_cache_populated(state: &State<AppState>) -> Result<(), String> {
    // 1. First check if update is needed (read-only check under data lock to ensure ordering)
    // Actually, we must enforce Data -> LastUpdate -> Cache -> Index
    let mut data = state.data.lock().unwrap();
    let mut last_update = state.last_cache_update.lock().unwrap();
    
    if last_update.is_some() { return Ok(()); }

    log_line("[CACHE] Populating mod file cache for the first time...");
    let mut needs_save = false;

    {
        let mut cache = state.mod_files_cache.lock().unwrap();
        let mut index = state.conflict_index.lock().unwrap();

        // Clear existing cache and index to avoid stale data from deleted mods
        cache.clear();
        index.clear();

        for m in data.mods.iter_mut() {
            // Fragile mtime invalidation check (Issue 14 fallback: log metadata failures)
            let current_mtime = m.mod_folder_path.metadata()
                .map(|meta| meta.modified().ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0))
                .unwrap_or_else(|e| {
                    log_line(format!("[CACHE] Warning: Failed to read metadata for {:?}: {}. Resetting mtime.", m.mod_folder_path, e));
                    0
                });

            let files = match &m.cached_files {
                Some(cached) if m.last_scan_mtime == current_mtime && current_mtime != 0 => cached.clone(),
                _ => if let Ok(f_paths) = crate::fs_utils::list_mod_files(&m.mod_folder_path) {
                    let f_strings: Vec<String> = f_paths.into_iter().map(|p| p.to_string_lossy().to_string()).collect();
                    m.cached_files = Some(f_strings.clone());
                    
                    if m.file_hashes.is_some() {
                        let mut new_hashes = std::collections::HashMap::new();
                        for rel in &f_strings {
                            let full_path = m.mod_folder_path.join(rel);
                            if let Ok(h) = crate::fs_utils::compute_file_sha256(&full_path) {
                                new_hashes.insert(rel.clone(), h);
                            }
                        }
                        m.file_hashes = Some(new_hashes);
                    }
                    
                    m.last_scan_mtime = current_mtime;
                    needs_save = true;
                    f_strings
                } else {
                    Vec::new()
                }
            };

            let set: HashSet<PathBuf> = files.into_iter().map(PathBuf::from).collect();
            for f in &set {
                index.entry(f.clone()).or_default().push(m.id.clone());
            }
            cache.insert(m.id.clone(), set);
        }
    }
    
    *last_update = Some(Instant::now());
    
    if needs_save {
        // Drop other locks before saving to be safe, although save() only takes data lock
        drop(last_update);
        drop(data); 
        let _ = state.save();
    }
    
    Ok(())
}

fn calculate_conflicts_from_cache(
    target_mod: &ModEntry, 
    data: &crate::state::AppData, 
    current_profile_id: &String,
    state: &State<AppState>
) -> Vec<ConflictReport> {
    let mut reports = Vec::new();
    let current_profile = match data.profiles.iter().find(|p| &p.id == current_profile_id) {
        Some(p) => p,
        None => return reports,
    };

    let target_is_active = current_profile.active_mods.contains(&target_mod.id);
    let cache = state.mod_files_cache.lock().unwrap();
    let index = state.conflict_index.lock().unwrap();

    let target_files = match cache.get(&target_mod.id) {
        Some(f) => f,
        None => return reports,
    };

    // Use the conflict index to find overlapping mods instantly
    let mut overlaps: HashMap<String, usize> = HashMap::new();
    for f in target_files {
        if let Some(mod_ids) = index.get(f) {
            for mid in mod_ids {
                if mid == &target_mod.id { continue; }
                *overlaps.entry(mid.clone()).or_insert(0) += 1;
            }
        }
    }

    for (other_id, count) in overlaps {
        if let Some(other_mod) = data.mods.iter().find(|m| m.id == other_id) {
            // Determine if it's Inter or Intra
            for profile in &data.profiles {
                let is_same_profile = &profile.id == current_profile_id;
                let shares_root = profile.game_path == current_profile.game_path;

                if !is_same_profile && !shares_root { continue; }

                // Check if the other mod actually belongs to THIS profile's mods_path
                // This prevents reporting conflicts for profiles that can't even "see" the mod.
                let mod_belongs_to_profile = other_mod.mod_folder_path.starts_with(&profile.mods_path);
                if !mod_belongs_to_profile { continue; }
                
                let is_active_in_prof = profile.active_mods.contains(&other_id);
                let status = if target_is_active && is_active_in_prof { ConflictStatus::Active } else { ConflictStatus::Potential };

                reports.push(ConflictReport {
                    category: if is_same_profile { ConflictCategory::Intra } else { ConflictCategory::Inter },
                    status,
                    other_mod_id: other_id.clone(),
                    other_mod_name: other_mod.name.clone(),
                    other_profile_name: profile.name.clone(),
                    file_count: count,
                    activation_order: other_mod.activation_order,
                });
            }
        }
    }

    reports
}

fn get_unique_mod_info(mods_path: &std::path::Path, original_name: &str) -> (String, std::path::PathBuf) {
    let mut display_name = original_name.to_string();
    let safe_base = original_name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' || c == '.' { c } else { '_' })
        .collect::<String>();
        
    let mut target_dir = mods_path.join(&safe_base);
    let mut counter = 1;

    while target_dir.exists() {
        display_name = format!("{} ({})", original_name, counter);
        let new_safe_item = format!("{}_{}", safe_base, counter);
        target_dir = mods_path.join(&new_safe_item);
        counter += 1;
    }
    
    (display_name, target_dir)
}

#[tauri::command]
pub fn get_all_mods(state: State<AppState>) -> Result<Vec<ModEntry>, String> {
    let data = state.data.lock().unwrap();
    Ok(data.mods.clone())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddModPayload {
    pub name: String,
    pub mod_folder_path: String,
    pub author: String,
    pub description: String,
    pub version: String,
    pub tags: Vec<String>,
    pub download_links: Option<Vec<crate::models::mod_entry::DownloadLink>>,
    pub dependencies: Vec<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateModPayload {
    pub name: String,
    pub author: String,
    pub description: String,
    pub version: String,
    pub tags: Vec<String>,
    pub download_links: Vec<crate::models::mod_entry::DownloadLink>,
    pub dependencies: Vec<String>,
}

#[tauri::command]
pub async fn add_mod(
    state: State<'_, AppState>,
    payload: AddModPayload,
) -> Result<ModEntry, String> {
    let AddModPayload {
        name,
        mod_folder_path,
        author,
        description,
        version,
        tags,
        download_links,
        dependencies,
    } = payload;
    
    log_line(format!("[MOD] Adding mod '{}' from '{}'", name, mod_folder_path));
    let mods_path = {
        let data = state.data.lock().unwrap();
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?.clone();
        let p = data.profiles.iter().find(|p| p.id == active_id).ok_or("Profil introuvable")?.clone();
        p.mods_path.clone()
    };

    let (final_name, target_dir) = get_unique_mod_info(&mods_path, &name);
    let target_dir_clone = target_dir.clone();
    let src = PathBuf::from(&mod_folder_path);

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        if !src.exists() {
            return Err(format!("Fichier source introuvable: {}", src.display()));
        }

        let is_same_dir = match (src.canonicalize(), target_dir_clone.canonicalize()) {
            (Ok(s), Ok(t)) => s == t,
            _ => false,
        };

        if !is_same_dir {
            std::fs::create_dir_all(&target_dir_clone).map_err(|e| e.to_string())?;

            if src.is_file() && src.extension().and_then(|e| e.to_str()).map(|s| s.eq_ignore_ascii_case("zip")).unwrap_or(false) {
                let file = std::fs::File::open(&src).map_err(|e| e.to_string())?;
                let archive = zip::ZipArchive::new(file).map_err(|e| format!("Erreur Zip: {}", e))?;
                let len = archive.len();
                let num_threads = rayon::current_num_threads().max(1);
                let chunk_size = (len + num_threads - 1) / num_threads;
                let chunks: Vec<Vec<usize>> = (0..len).collect::<Vec<_>>().chunks(chunk_size).map(|c| c.to_vec()).collect();

                use rayon::prelude::*;
                chunks.into_par_iter().try_for_each(|chunk| -> Result<(), String> {
                    let file = std::fs::File::open(&src).map_err(|e| e.to_string())?;
                    let mut local_archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
                    
                    for i in chunk {
                        let mut f = local_archive.by_index(i).map_err(|e| e.to_string())?;
                        let outpath = target_dir_clone.join(f.name());
                        if f.name().ends_with('/') {
                            std::fs::create_dir_all(&outpath).ok();
                        } else {
                            if let Some(parent) = outpath.parent() {
                                std::fs::create_dir_all(parent).ok();
                            }
                            let mut outfile = std::fs::File::create(&outpath).map_err(|e| e.to_string())?;
                            std::io::copy(&mut f, &mut outfile).map_err(|e| e.to_string())?;
                        }
                    }
                    Ok(())
                })?;
            } else if src.is_dir() {
                let mut options = fs_extra::dir::CopyOptions::new();
                options.content_only = true;
                options.overwrite = true;
                fs_extra::dir::copy(&src, &target_dir_clone, &options).map_err(|e| e.to_string())?;
            } else {
                return Err("Le fichier sélectionné doit être un dossier ou un fichier .zip".to_string());
            }
        }
        Ok(())
    }).await.map_err(|e| e.to_string())??;

    let mut entry = ModEntry::new(final_name, target_dir);
    entry.author = Some(author);
    entry.description = Some(description);
    entry.version = version;
    entry.tags = tags;
    if let Some(l) = download_links {
        entry.download_links = l;
    }
    entry.dependencies = dependencies;
    
    let result = entry.clone();
    {
        let mut data = state.data.lock().unwrap();
        data.mods.push(entry);
    }
    let _ = state.save();
    invalidate_cache(&state);
    Ok(result)
}

#[tauri::command]
pub async fn remove_mod(state: State<'_, AppState>, mod_id: String, delete_files: bool) -> Result<(), String> {
    log_line(format!("[MOD] Removing mod '{}' (delete_files: {})", mod_id, delete_files));
    let (mod_path, mods_dependent_on_this) = {
        let mut data = state.data.lock().unwrap();
        let idx = data.mods.iter().position(|m| m.id == mod_id).ok_or("Mod introuvable")?;
        
        // Clone needed data before mutable borrow
        let mod_enabled = data.mods[idx].enabled;
        let mod_folder_path = data.mods[idx].mod_folder_path.clone();
        
        if mod_enabled {
            return Err("Désactivez le mod avant de le supprimer.".to_string());
        }
        
        // Find all mods that have this mod as a dependency
        let mut dependent_mods = Vec::new();
        for other_mod in &data.mods {
            if other_mod.dependencies.contains(&mod_id) {
                dependent_mods.push(other_mod.name.clone());
            }
        }
        
        // Remove this mod from all other mods' dependencies
        let mut removed_from = Vec::new();
        for other_mod in data.mods.iter_mut() {
            if other_mod.dependencies.contains(&mod_id) {
                other_mod.dependencies.retain(|dep_id| dep_id != &mod_id);
                removed_from.push(other_mod.name.clone());
            }
        }
        
        if !removed_from.is_empty() {
            log_line(format!("[MOD] Removed '{}' from dependencies of: {:?}", mod_id, removed_from));
        }
        
        data.mods.remove(idx);
        (mod_folder_path, dependent_mods)
    };

    if delete_files {
        tauri::async_runtime::spawn_blocking(move || {
            if mod_path.exists() && mod_path.is_dir() {
                std::fs::remove_dir_all(mod_path).map_err(|e| e.to_string())?;
            }
            Ok::<(), String>(())
        }).await.map_err(|e| e.to_string())??;
    }

    let _ = state.save();
    invalidate_cache(&state);
    
    if !mods_dependent_on_this.is_empty() {
        return Ok(()); // Silently remove from dependencies
    }
    
    Ok(())
}


fn resolve_dependencies(
    target_id: &String,
    all_mods: &[ModEntry],
    resolved: &mut Vec<String>,
    unresolved: &mut Vec<String>,
    missing: &mut Vec<String>,
) -> Result<(), String> {
    if resolved.contains(target_id) {
        return Ok(());
    }
    
    unresolved.push(target_id.clone());
    resolved.push(target_id.clone());
    
    let target_mod = all_mods.iter().find(|m| &m.id == target_id)
        .ok_or_else(|| format!("Mod introuvable: {}", target_id))?;
    
    for dep_id in &target_mod.dependencies {
        if unresolved.contains(dep_id) {
            return Err(format!("Dépendance circulaire détectée: {} -> {}", target_id, dep_id));
        }
        // Check if dependency exists
        if !all_mods.iter().any(|m| &m.id == dep_id) {
            missing.push(dep_id.clone());
        } else {
            resolve_dependencies(dep_id, all_mods, resolved, unresolved, missing)?;
        }
    }
    
    let pos = unresolved.iter().position(|x| x == target_id).unwrap();
    unresolved.remove(pos);
    Ok(())
}

#[tauri::command]
pub async fn enable_mod(window: Window, state: State<'_, AppState>, mod_id: String) -> Result<Option<String>, String> {
    log_line(format!("[MOD] Enabling mod '{}' (recursive if needed)", mod_id));
    
    // 1. Resolve full dependency chain and check for missing dependencies
    let (mod_ids_to_enable, profile_data, warning_settings, missing_deps, needs_save) = {
        let mut data = state.data.lock().unwrap();
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?.clone();
        let p = data.profiles.iter().find(|p| p.id == active_id).ok_or("Profil introuvable")?.clone();
        
        let mut resolved = Vec::new();
        let mut unresolved = Vec::new();
        let mut missing = Vec::new();
        resolve_dependencies(&mod_id, &data.mods, &mut resolved, &mut unresolved, &mut missing)?;
        
        // If there are missing dependencies, remove them from the mod's dependency list
        let needs_save = if !missing.is_empty() {
            log_line(format!("[MOD] Found {} missing dependencies for mod '{}': {:?}", missing.len(), mod_id, missing));
            if let Some(mod_entry) = data.mods.iter_mut().find(|m| m.id == mod_id) {
                let original_deps = mod_entry.dependencies.clone();
                mod_entry.dependencies.retain(|dep_id| !missing.contains(dep_id));
                log_line(format!("[MOD] Removed missing dependencies from mod '{}': {:?}", mod_id, original_deps.iter().filter(|d| missing.contains(d)).collect::<Vec<_>>()));
            }
            true
        } else {
            false
        };
        
        // Only enable those not already enabled in this profile
        let to_enable: Vec<String> = resolved.into_iter()
            .filter(|id| !p.active_mods.contains(id))
            .collect();
            
        if to_enable.is_empty() { return Ok(None); }

        let warning_pct = data.settings.storage_warning_space_pct;
        let critical_pct = data.settings.storage_critical_space_pct;
        let alert_enabled = data.settings.storage_alert_enabled;

        (to_enable, p, (warning_pct, critical_pct, alert_enabled), missing, needs_save)
    };

    // Save if dependencies were modified
    if needs_save {
        let _ = state.save();
    }

    // Log warning about missing dependencies (no event to avoid potential crashes)
    if !missing_deps.is_empty() {
        log_line(format!("[MOD] Missing dependencies removed from mod '{}': {:?}", mod_id, missing_deps));
    }

    // Add mod to priority SHA queue if it has no hashes
    add_mod_to_priority_sha_queue(state.clone(), mod_id.clone());

    ensure_cache_populated(&state)?;
    let mut active_files_set = HashSet::<PathBuf>::new();
    {
        let data = state.data.lock().unwrap();
        let cache = state.mod_files_cache.lock().unwrap();
        if let Some(p) = data.profiles.iter().find(|p| p.id == profile_data.id) {
            for mid in &p.active_mods {
                if let Some(files) = cache.get(mid) {
                    for f in files { active_files_set.insert(f.clone()); }
                }
            }
        }
    }

    let mut overall_warning: Option<String> = None;
    let disks = sysinfo::Disks::new_with_refreshed_list();

    for mid in mod_ids_to_enable {
        let (mod_folder, game_path, backup_path, mod_name) = {
            let data = state.data.lock().unwrap();
            let m = data.mods.iter().find(|m| m.id == mid).unwrap().clone();
            
            let p = data.profiles.iter().find(|p| p.id == profile_data.id).unwrap();

            // --- Block if already active in another profile on same root ---
            for op in &data.profiles {
                if op.id == profile_data.id { continue; }
                if op.game_path == p.game_path && op.active_mods.contains(&mid) {
                    return Err(format!("Le mod '{}' est déjà actif dans le profil '{}'.", m.name, op.name));
                }
            }

            (m.mod_folder_path.clone(), p.game_path.clone(), p.backup_path.clone(), m.name)
        };

        // --- Space check ---
        let mut total_bytes = 0;
        if let Ok(files) = crate::fs_utils::list_mod_files(&mod_folder) {
            for rel in files {
                if let Ok(meta) = std::fs::metadata(mod_folder.join(rel)) {
                    total_bytes += meta.len();
                }
            }
        }

        let game_path_limit = crate::commands::disk::get_limit_for_path(&state, &game_path);
        let backup_path_limit = crate::commands::disk::get_limit_for_path(&state, &backup_path);

        // Perform space check (re-using logic but simplified for brevity in loop)
        let mut check_space = |path: &std::path::Path, label: &str| -> Result<(), String> {
            let mut path_str = path.canonicalize().unwrap_or(path.to_path_buf()).to_string_lossy().to_lowercase();
            if path_str.starts_with(r"\\?\") { path_str = path_str[4..].to_string(); }
            let mut best = None;
            for disk in disks.iter() {
                let mut mp = disk.mount_point().to_string_lossy().to_lowercase();
                if mp.starts_with(r"\\?\") { mp = mp[4..].to_string(); }
                if path_str.starts_with(&mp) {
                    let len = mp.len();
                    let best_ref: &Option<(u64,u64,String)> = &best;
                    if best_ref.as_ref().map_or(true, |(_, _, prev_mp)| len > prev_mp.len()) {
                        best = Some((disk.available_space(), disk.total_space(), mp));
                    }
                }
            }
            if let Some((available, total, _)) = best {
                if available < total_bytes + (500 * 1024 * 1024) {
                    return Err(format!("Espace insuffisant pour '{}' sur {}. {} MB requis.", mod_name, label, total_bytes / (1024 * 1024)));
                }
                if warning_settings.2 && total > 0 {
                    let simulated = available.saturating_sub(total_bytes);
                    let free_pct = (simulated as f64 / total as f64 * 100.0) as u32;
                    if free_pct <= warning_settings.1 { return Err(format!("CRITICAL_SPACE|{}|{}|{}", label, free_pct, warning_settings.1)); }
                    else if free_pct <= warning_settings.0 { overall_warning = Some(format!("WARNING_SPACE|{}|{}|{}", label, free_pct, warning_settings.0)); }
                }
            }
            Ok(())
        };

        check_space(&game_path, "Game")?;
        check_space(&backup_path, "Backup")?;

        let disk_name = game_path.to_string_lossy().chars().take(3).collect::<String>().to_uppercase();
        let _ = window.emit("benchmark-event", BenchEventPayload {
            text: format!("Activating: {}", mod_name),
            disk_name,
            total_mb: total_bytes as f64 / 1_048_576.0,
            limit_mb_s: game_path_limit,
            finished: false,
        });

        let active_files_set_clone = active_files_set.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            let _lock = MOD_OP_LOCK.lock().unwrap();
            fs_utils::apply_mod_stacked(&mod_folder, &game_path, &backup_path, &active_files_set_clone, game_path_limit, backup_path_limit)
        }).await.map_err(|e| e.to_string())?;

        let _ = window.emit("benchmark-event", BenchEventPayload {
            text: format!("Activated: {}", mod_name), disk_name: "".to_string(), total_mb: 0.0, limit_mb_s: None, finished: true,
        });

        let applied = result.map_err(|e| e.to_string())?;

        {
            let mut data = state.data.lock().unwrap();
            let next_order = data.mods.iter().map(|m| m.activation_order).max().unwrap_or(0) + 1;
            if let Some(m) = data.mods.iter_mut().find(|m| m.id == mid) {
                m.enabled = true;
                m.status = ModStatus::Enabled;
                m.installed_files = applied.iter().map(|p| p.to_string_lossy().to_string()).collect();
                m.activation_order = next_order;
            }
            for p in data.profiles.iter_mut() {
                if p.game_path == profile_data.game_path && p.mods_path == profile_data.mods_path {
                    if !p.active_mods.contains(&mid) { p.active_mods.push(mid.clone()); }
                }
            }
        }

        // Update active_files_set for NEXT dependency in the chain
        if let Some(files) = state.mod_files_cache.lock().unwrap().get(&mid) {
            for f in files { active_files_set.insert(f.clone()); }
        }

        log_line(format!("[MOD] Mod '{}' enabled", mod_name));
    }

    let _ = state.save();
    invalidate_cache(&state);
    
    // Log history for the primary mod
    if let Some(m) = { let data = state.data.lock().unwrap(); data.mods.iter().find(|m| m.id == mod_id).cloned() } {
        crate::commands::history::log_activity(&state, &profile_data.id, &mod_id, &m.name, "Enabled (with dependencies)");
    }

    Ok(overall_warning)
}

#[tauri::command]
pub async fn disable_mod(window: Window, state: State<'_, AppState>, mod_id: String) -> Result<(), String> {
    log_line(format!("[MOD] Disabling mod '{}'", mod_id));
    let (game_path, backup_path, active_id, mod_name, files_to_remove, other_active_mods) = {
        let data = state.data.lock().unwrap();
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?.clone();
        if !m.enabled { return Ok(()); }
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?.clone();
        let p = data.profiles.iter().find(|p| p.id == active_id).ok_or("Profil introuvable")?.clone();
        
        let mut others = Vec::new();
        for mid in p.active_mods.iter().rev() {
            if mid == &mod_id { continue; }
            if let Some(other_m) = data.mods.iter().find(|om| &om.id == mid) {
                others.push((other_m.id.clone(), other_m.mod_folder_path.clone()));
            }
        }
        
        // Hybrid cleanup: Tracked files + Current physical files
        let mut unique_files = std::collections::HashSet::new();
        for f in m.installed_files { unique_files.insert(f); }
        if let Ok(scanned) = fs_utils::list_mod_files(&m.mod_folder_path) {
            for s in scanned { unique_files.insert(s.to_string_lossy().to_string()); }
        }
        
        (p.game_path.clone(), p.backup_path.clone(), active_id, m.name, unique_files.into_iter().collect::<Vec<String>>(), others)
    };

    let game_path_limit = crate::commands::disk::get_limit_for_path(&state, &game_path);

    let mut total_bytes = 0;
    for p in &files_to_remove {
        if let Ok(meta) = std::fs::metadata(game_path.join(p)) {
            total_bytes += meta.len();
        }
    }
    let total_mb = total_bytes as f64 / 1_048_576.0;
    let disk_name = game_path.to_string_lossy().chars().take(3).collect::<String>().to_uppercase();

    let _ = window.emit("benchmark-event", BenchEventPayload {
        text: format!("Disabling mod: {}", mod_name),
        disk_name,
        total_mb,
        limit_mb_s: game_path_limit,
        finished: false,
    });
    
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _lock = MOD_OP_LOCK.lock().unwrap();
        fs_utils::unapply_mod_stacked(&game_path, &backup_path, files_to_remove, &other_active_mods, game_path_limit)
    }).await.map_err(|e| e.to_string())?;

    let _ = window.emit("benchmark-event", BenchEventPayload {
        text: match &result {
            Ok(_) => format!("Mod disabled: {}", mod_name),
            Err(_) => format!("Error disabling: {}", mod_name),
        },
        disk_name: "".to_string(),
        total_mb: 0.0,
        limit_mb_s: None,
        finished: true,
    });

    result.map_err(|e| e.to_string())?;

    {
        let mut data = state.data.lock().unwrap();
        
        let removed_order = if let Some(m) = data.mods.iter_mut().find(|m| m.id == mod_id) {
            let order = m.activation_order;
            m.enabled = false;
            m.status = ModStatus::Disabled;
            m.installed_files.clear();
            m.activation_order = 0;
            order
        } else { 0 };

        // Re-order remaining mods to keep sequence tight
        if removed_order > 0 {
            for m in data.mods.iter_mut() {
                if m.activation_order > removed_order {
                    m.activation_order -= 1;
                }
            }
        }
        
        // Sync with all profiles sharing the same root and mod folder
        let active_profile_id = data.active_profile_id.clone().ok_or("Aucun profil actif")?;
        let active_profile = data.profiles.iter().find(|p| p.id == active_profile_id).cloned().ok_or("Profil introuvable")?;

        for p in data.profiles.iter_mut() {
            let same_root = p.game_path == active_profile.game_path;
            let same_mods = p.mods_path == active_profile.mods_path;
            
            if same_root && same_mods {
                p.active_mods.retain(|id| id != &mod_id);
            }
        }
    }
    let _ = state.save();
    
    // Log history
    log_line(format!("[MOD] Mod '{}' disabled successfully", mod_name));
    crate::commands::history::log_activity(&state, &active_id, &mod_id, &mod_name, "Disabled");
    Ok(())
}

#[tauri::command]
pub fn path_join(base: std::path::PathBuf, relative: String) -> Result<String, String> {
    Ok(base.join(relative).to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("cmd")
            .args(["/c", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}


#[tauri::command]
pub async fn open_mod_folder_at(state: State<'_, AppState>, mod_id: String, relative_path: String) -> Result<(), String> {
    let mod_dir = {
        let data = state.data.lock().unwrap();
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?;
        m.mod_folder_path.clone()
    };
    
    let target = mod_dir.join(relative_path);
    if !target.exists() {
        return Err("Le chemin n'existe pas ou plus.".to_string());
    }
    
    if target.is_dir() {
        open_folder(target.to_string_lossy().to_string())
    } else {
        // If it's a file, "open location" should open the PARENT folder
        if let Some(parent) = target.parent() {
            open_folder(parent.to_string_lossy().to_string())
        } else {
            open_folder(mod_dir.to_string_lossy().to_string())
        }
    }
}

#[tauri::command]
pub async fn open_mod_file_at(state: State<'_, AppState>, mod_id: String, relative_path: String) -> Result<(), String> {
    let mod_dir = {
        let data = state.data.lock().unwrap();
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?;
        m.mod_folder_path.clone()
    };
    
    let target = mod_dir.join(relative_path);
    if !target.exists() || target.is_dir() {
        return Err("Le fichier n'existe pas ou est un dossier.".to_string());
    }
    
    open_file(target.to_string_lossy().to_string())
}


#[tauri::command]
pub fn update_mod_meta(
    state: State<AppState>,
    mod_id: String,
    payload: UpdateModPayload,
) -> Result<(), String> {
    let UpdateModPayload {
        name,
        author,
        description,
        version,
        tags,
        download_links,
        dependencies,
    } = payload;
    
    log_line(format!("[MOD] Updating metadata for '{}' ({})", name, mod_id));
    let mod_path = {
        let mut data = state.data.lock().unwrap();
        if let Some(m) = data.mods.iter_mut().find(|m| m.id == mod_id) {
            m.name = name;
            m.author = Some(author);
            m.description = Some(description);
            m.version = version;
            m.tags = tags;
            m.download_links = download_links;
            m.dependencies = dependencies;
            Some((m.clone(), m.mod_folder_path.clone()))
        } else {
            None
        }
    };

    if let Some((_entry, _path)) = mod_path {
        // Removed as per user request
    }

    let _ = state.save();
    Ok(())
}

#[allow(dead_code)]
fn save_mod_metadata_file(_mod_folder_path: &std::path::Path, _entry: &crate::models::mod_entry::ModEntry) -> Result<(), String> {
    // Removed as per user request
    Ok(())
}

#[allow(dead_code)]
#[tauri::command]
pub fn check_mod_metadata(_folder_path: String) -> Result<Option<crate::models::mod_entry::ModMetadata>, String> {
    // Removed as per user request
    Ok(None)
}

#[derive(serde::Serialize)]
pub struct ScanResult {
    pub added: usize,
    pub removed: usize,
}

#[tauri::command]
pub async fn scan_mods_folder(state: State<'_, AppState>) -> Result<ScanResult, String> {
    log_line("[MOD] Scanning mods folder for new mods...");
    let (mods_path, profile_id) = {
        let data = state.data.lock().unwrap();
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?.clone();
        let p = data.profiles.iter().find(|p| p.id == active_id).ok_or("Profil introuvable")?.clone();
        (p.mods_path.clone(), active_id)
    };

    // 1. Prune missing mods from the state for this profile
    let removed_count = {
        let mut data = state.data.lock().unwrap();
        let mut to_remove_ids = Vec::new();
        
        // Collect all valid mods_paths from all profiles to detect orphaned mods
        let valid_mods_paths: HashSet<PathBuf> = data.profiles.iter()
            .map(|p| p.mods_path.canonicalize().unwrap_or(p.mods_path.clone()))
            .collect();

        data.mods.retain(|m| {
            let mod_p = &m.mod_folder_path;
            
            // 1. Prune if folder is gone from disk
            if !mod_p.exists() {
                log_line(format!("[MOD-SCAN] Pruning missing mod globally: {:?} (ID: {})", mod_p, m.id));
                to_remove_ids.push(m.id.clone());
                return false;
            }

            // 2. Prune if mod doesn't belong to any existing profile's mods_path (Orphan)
            let mod_p_can = mod_p.canonicalize().unwrap_or(mod_p.clone());
            let belongs_to_any_profile = valid_mods_paths.iter().any(|p_path| mod_p_can.starts_with(p_path));
            
            if !belongs_to_any_profile {
                log_line(format!("[MOD-SCAN] Pruning orphan mod (no profile owns this path): {:?} (ID: {})", mod_p, m.id));
                to_remove_ids.push(m.id.clone());
                return false;
            }

            true
        });

        let count = to_remove_ids.len();
        // Also remove from the profile's active_mods list
        if !to_remove_ids.is_empty() {
            if let Some(p) = data.profiles.iter_mut().find(|p| p.id == profile_id) {
                p.active_mods.retain(|id| !to_remove_ids.contains(id));
            }
        }
        count
    };

    if removed_count > 0 {
        let _ = state.save();
        invalidate_cache(&state);
    }

    let existing_paths: Vec<PathBuf> = {
        let data = state.data.lock().unwrap();
        data.mods.iter().map(|m| m.mod_folder_path.clone()).collect()
    };

    let added: Vec<ModEntry> = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<ModEntry>, String> {
        if !mods_path.exists() {
            log_line(format!("[MOD-SCAN] Mods folder does not exist: {:?}. Skipping scan.", mods_path));
            return Ok(Vec::new());
        }

        let mut discovered = Vec::new();
        let entries = std::fs::read_dir(&mods_path).map_err(|e| {
            log_line(format!("[MOD-SCAN] Failed to read mods folder {:?}: {}", mods_path, e));
            e.to_string()
        })?;

        for entry in entries.flatten() {
            let path = entry.path();
            log_line(format!("[MOD-SCAN] Checking: {:?}", path));
            let is_dir = path.is_dir();
            let is_zip = path.is_file() && path.extension().and_then(|s| s.to_str()).unwrap_or("").eq_ignore_ascii_case("zip");
            
            if !is_dir && !is_zip { continue; }

            // Check if already in BMM list (global check)
            let is_already_added = existing_paths.iter().any(|ep| {
                let ep_s = ep.to_string_lossy().to_lowercase();
                let path_s = path.to_string_lossy().to_lowercase();
                ep_s == path_s
            });

            if is_already_added { continue; }

            let folder_name = path.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            let mut mod_name = folder_name.clone();
            if is_zip && mod_name.to_lowercase().ends_with(".zip") {
                mod_name = mod_name[..mod_name.len() - 4].to_string();
            }

            let mut entry = ModEntry::new(mod_name.clone(), path.clone());
            let _has_meta = entry.load_metadata();
            
            // If no metadata file and it's a folder, create one with default info
            // REMOVED: let _ = save_mod_metadata_file(&path, &entry);

            discovered.push(entry);
        }
        Ok(discovered)
    }).await.map_err(|e| e.to_string())??;

    let added_count = added.len();
    if added_count > 0 {
        log_line(format!("[MOD] Scan discovered {} new mod(s)", added_count));
        let mut data = state.data.lock().unwrap();
        data.mods.extend(added);
        drop(data);
        let _ = state.save();
        invalidate_cache(&state);
    } else if removed_count > 0 {
        log_line(format!("[MOD] Scan pruned {} missing mod(s)", removed_count));
        let _ = state.save();
        invalidate_cache(&state);
    } else {
        log_line("[MOD] Scan complete, no changes found");
    }
    
    Ok(ScanResult { added: added_count, removed: removed_count })
}

#[tauri::command]
pub async fn download_mod(
    state: State<'_, AppState>,
    url: String,
    mod_name: String,
    profile_id: Option<String>,
) -> Result<ModEntry, String> {
    log_line(format!("[MOD] Downloading mod '{}' from '{}'", mod_name, url));
    let mods_path = {
        let data = state.data.lock().unwrap();
        let target_id = profile_id.or_else(|| data.active_profile_id.clone()).ok_or("Aucun profil actif")?;
        let p = data.profiles.iter().find(|p| p.id == target_id).ok_or("Profil introuvable")?.clone();
        p.mods_path.clone()
    };

    let (final_name, target_dir) = get_unique_mod_info(&mods_path, &mod_name);
    let target_dir_for_thread = target_dir.clone();

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        std::fs::create_dir_all(&target_dir_for_thread).map_err(|e| e.to_string())?;

        let response = reqwest::blocking::get(&url)
            .map_err(|e| format!("Download failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("HTTP error: {}", response.status()));
        }

        let bytes = response.bytes().map_err(|e| format!("Read failed: {}", e))?;
        let is_zip = bytes.len() >= 4 && bytes[0] == 0x50 && bytes[1] == 0x4B;

        if is_zip {
            let cursor = std::io::Cursor::new(&bytes);
            let mut archive = zip::ZipArchive::new(cursor)
                .map_err(|e| format!("Zip error: {}", e))?;

            for i in 0..archive.len() {
                let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
                let outpath = target_dir_for_thread.join(file.name());
                if file.name().ends_with('/') {
                    std::fs::create_dir_all(&outpath).ok();
                } else {
                    if let Some(parent) = outpath.parent() {
                        std::fs::create_dir_all(parent).ok();
                    }
                    let mut outfile = std::fs::File::create(&outpath).map_err(|e| e.to_string())?;
                    std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
                }
            }
        } else {
            let filename = url.split('/').last().unwrap_or("mod_file");
            let filepath = target_dir_for_thread.join(filename);
            std::fs::write(&filepath, &bytes).map_err(|e| e.to_string())?;
        }
        Ok(())
    }).await.map_err(|e| e.to_string())??;

    let entry = ModEntry::new(final_name, target_dir);
    let result = entry.clone();
    {
        let mut data = state.data.lock().unwrap();
        data.mods.push(entry);
    }
    let _ = state.save();
    invalidate_cache(&state);
    Ok(result)
}

#[derive(serde::Serialize, Clone)]
struct DownloadProgress {
    mod_index: usize,
    total_mods: usize,
    mod_name: String,
    progress: f32, // 0.0 to 100.0
    status: String,
}

#[tauri::command]
pub fn cancel_install_from_modlist(state: State<AppState>) {
    state.install_cancelled.store(true, std::sync::atomic::Ordering::SeqCst);
}

#[tauri::command]
pub async fn install_from_modlist(
    window: tauri::Window,
    state: State<'_, AppState>,
    modlist_json: String,
    create_profile: bool,
    github_token: Option<String>,
) -> Result<Vec<String>, String> {
    state.install_cancelled.store(false, std::sync::atomic::Ordering::SeqCst);
    let modlist: crate::models::modlist::ModList =
        serde_json::from_str(&modlist_json).map_err(|e| format!("Invalid modlist: {}", e))?;

    let mut newly_created_profile_id: Option<String> = None;
    let mut newly_added_mod_ids: Vec<String> = Vec::new();
    let mut newly_added_mod_folders: Vec<PathBuf> = Vec::new();

    let (mods_path, _profile_id_for_mods) = {
        let mut data = state.data.lock().unwrap();
        if create_profile {
            let new_id = uuid::Uuid::new_v4().to_string();
            let game_path = PathBuf::from(&modlist.game_path_hint);
            let m_path = game_path.join("BetterMods");
            let backup_path = game_path.join("BetterModsBackup");
            
            let mut new_p = crate::models::profile::Profile::new(
                modlist.name.clone(),
                modlist.game_name.clone(),
                game_path,
                m_path.clone(),
                backup_path
            );
            new_p.id = new_id.clone();
            data.profiles.push(new_p);
            data.active_profile_id = Some(new_id.clone());
            newly_created_profile_id = Some(new_id.clone());
            (m_path, new_id)
        } else {
            let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?.clone();
            // If the user overrode the path, it is in modlist.game_path_hint
            // If it's empty, use the active profile path
            let path = if !modlist.game_path_hint.is_empty() {
                PathBuf::from(&modlist.game_path_hint)
            } else {
                let p = data.profiles.iter().find(|p| p.id == active_id).ok_or("Profil introuvable")?.clone();
                p.mods_path.clone()
            };
            (path, active_id)
        }
    };

    let mut results = Vec::new();
    let total_mods = modlist.mods.len();

    for (idx, entry) in modlist.mods.iter().enumerate() {
        if state.install_cancelled.load(std::sync::atomic::Ordering::SeqCst) {
            results.push("❌ Installation annulée par l'utilisateur".to_string());
            break;
        }
        
        // Progress: Starting
        let _ = window.emit("bmm://mod-download-progress", crate::commands::mods::DownloadProgress {
            mod_index: idx,
            total_mods,
            mod_name: entry.name.clone(),
            progress: 0.0,
            status: "Démarrage...".to_string(),
        });

        let safe_name = entry.name
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' || c == '.' { c } else { '_' })
            .collect::<String>();
        let target_dir = mods_path.join(&safe_name);

        // Check if already present
        if target_dir.exists() {
            let mut data = state.data.lock().unwrap();
            let exists = data.mods.iter().any(|m| m.mod_folder_path == target_dir);
            if !exists {
                let mut new_mod = ModEntry::new(safe_name.clone(), target_dir.clone());
                new_mod.name = entry.name.clone();
                new_mod.version = entry.version.clone();
                new_mod.author = entry.author.clone();
                new_mod.description = entry.description.clone();
                new_mod.tags = entry.tags.clone();
                new_mod.install_notes = entry.install_notes.clone();
                let mid = new_mod.id.clone();
                let _mod_folder = new_mod.mod_folder_path.clone();
                data.mods.push(new_mod.clone());
                newly_added_mod_ids.push(mid);
                // let _ = save_mod_metadata_file(&mod_folder, &new_mod);
            } else {
                // If it already exists in the global list, we still want to track it for the profile
                if let Some(m) = data.mods.iter().find(|m| m.mod_folder_path == target_dir) {
                    newly_added_mod_ids.push(m.id.clone());
                }
            }
            results.push(format!("✅ {} — Déjà présent", entry.name));
            continue;
        }

        // --- NEW: Track this folder for cleanup immediately as we're about to create it ---
        newly_added_mod_folders.push(target_dir.clone());

        // Try local copy first
        let source_path = {
            let data = state.data.lock().unwrap();
            data.mods.iter()
                .find(|m| m.name == entry.name && m.mod_folder_path.exists())
                .map(|m| m.mod_folder_path.clone())
        };

        let mut success = false;
        if let Some(src) = source_path {
            let t_dir = target_dir.clone();
            let w = window.clone();
            let n = entry.name.clone();
            let res = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
                let _ = w.emit("bmm://mod-download-progress", crate::commands::mods::DownloadProgress {
                    mod_index: idx,
                    total_mods,
                    mod_name: n,
                    progress: 50.0,
                    status: "Copie locale...".to_string(),
                });
                std::fs::create_dir_all(&t_dir).map_err(|e| e.to_string())?;
                let mut options = fs_extra::dir::CopyOptions::new();
                options.content_only = true;
                fs_extra::dir::copy(&src, &t_dir, &options).map_err(|e| e.to_string())?;
                Ok(())
            }).await.map_err(|e| e.to_string())?;

            if res.is_ok() {
                let mut data = state.data.lock().unwrap();
                let mut new_mod = ModEntry::new(safe_name.clone(), target_dir.clone());
                new_mod.name = entry.name.clone();
                new_mod.version = entry.version.clone();
                new_mod.author = entry.author.clone();
                new_mod.tags = entry.tags.clone();
                new_mod.install_notes = entry.install_notes.clone();
                let mid = new_mod.id.clone();
                data.mods.push(new_mod);
                
                newly_added_mod_ids.push(mid);
                results.push(format!("✅ {} — Copié localement", entry.name));
                success = true;
            }
        }

        // If not copied, try download
        if !success {
            if let Some(dl) = entry.download_links.iter().find(|l| !l.url.is_empty()) {
                let url = dl.url.clone();
                let t_dir = target_dir.clone();
                let w = window.clone();
                let n = entry.name.clone();
                let cancel_flag = state.install_cancelled.clone();
                let pat_clone = github_token.clone();

                let res = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
                    let github_token = pat_clone;
                    // Build a client with optional GitHub auth header
                    let client = reqwest::blocking::Client::new();
                    let is_github = url.contains("github.com") || url.contains("raw.githubusercontent.com");
                    let mut req = client.get(&url);
                    if is_github {
                        if let Some(ref tok) = github_token {
                            if !tok.is_empty() {
                                req = req.header("Authorization", format!("Bearer {}", tok));
                            }
                        }
                        req = req.header("X-GitHub-Api-Version", "2022-11-28");
                    }
                    let mut response = req.send().map_err(|e| e.to_string())?;
                    let total = response.content_length().unwrap_or(0);
                    let mut bytes = Vec::new();
                    let mut buffer = [0; 8192];
                    let mut downloaded: u64 = 0;
                    
                    std::fs::create_dir_all(&t_dir).map_err(|e| e.to_string())?;
                    
                    use std::io::Read;
                    while let Ok(c) = response.read(&mut buffer) {
                        if c == 0 { break; }
                        // Check for cancellation during download
                        if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
                            return Err("Cancelled".to_string());
                        }

                        bytes.extend_from_slice(&buffer[..c]);
                        downloaded += c as u64;
                        if total > 0 {
                            let p = (downloaded as f32 / total as f32) * 80.0;
                            let _ = w.emit("bmm://mod-download-progress", crate::commands::mods::DownloadProgress {
                                mod_index: idx,
                                total_mods,
                                mod_name: n.clone(),
                                progress: p,
                                status: format!("Téléchargement... {:.0}%", (downloaded as f32 / total as f32) * 100.0),
                            });
                        }
                    }

                    if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
                        return Err("Cancelled".to_string());
                    }

                    let _ = w.emit("bmm://mod-download-progress", crate::commands::mods::DownloadProgress {
                        mod_index: idx,
                        total_mods,
                        mod_name: n,
                        progress: 90.0,
                        status: "Extraction...".to_string(),
                    });

                    let is_zip = bytes.len() > 4 && &bytes[0..2] == b"PK";
                    if is_zip {
                        let cursor = std::io::Cursor::new(bytes);
                        let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;
                        for i in 0..archive.len() {
                            if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
                                return Err("Cancelled".to_string());
                            }
                            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
                            let outpath = t_dir.join(file.name());
                            if file.name().ends_with('/') {
                                std::fs::create_dir_all(&outpath).ok();
                            } else {
                                if let Some(p) = outpath.parent() { std::fs::create_dir_all(p).ok(); }
                                let mut outfile = std::fs::File::create(&outpath).map_err(|e| e.to_string())?;
                                std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
                            }
                        }
                    } else {
                        let fname = url.split('/').last().unwrap_or("mod.file");
                        std::fs::write(t_dir.join(fname), bytes).map_err(|e| e.to_string())?;
                    }
                    Ok(())
                }).await.map_err(|e| e.to_string())?;

                if let Ok(_) = res {
                    let mut data = state.data.lock().unwrap();
                    let mut new_mod = ModEntry::new(safe_name.clone(), target_dir.clone());
                    new_mod.name = entry.name.clone();
                    new_mod.version = entry.version.clone();
                    new_mod.author = entry.author.clone();
                    new_mod.description = entry.description.clone();
                    new_mod.tags = entry.tags.clone();
                    new_mod.install_notes = entry.install_notes.clone();
                    new_mod.download_links = entry.download_links.iter().map(|l| crate::models::mod_entry::DownloadLink {
                        url: l.url.clone(),
                        link_type: l.link_type.clone(),
                        label: l.label.clone(),
                    }).collect();
                    let mid = new_mod.id.clone();
                    let _mod_folder = new_mod.mod_folder_path.clone();
                    data.mods.push(new_mod.clone());
                    
                    newly_added_mod_ids.push(mid);
                    // let _ = save_mod_metadata_file(&mod_folder, &new_mod);
                    results.push(format!("✅ {} — Téléchargé", entry.name));
                    
                    let _ = window.emit("bmm://mod-download-progress", crate::commands::mods::DownloadProgress {
                        mod_index: idx,
                        total_mods,
                        mod_name: entry.name.clone(),
                        progress: 100.0,
                        status: "Terminé".to_string(),
                    });
                } else if let Err(e) = res {
                    if e == "Cancelled" {
                        // Folder will be cleaned up by the main loop break
                    } else {
                        results.push(format!("❌ {} — {}", entry.name, e));
                    }
                }
            } else {
                results.push(format!("⚠ {} — Aucun lien de téléchargement", entry.name));
            }
        }
    }

    // --- CLEANUP IF CANCELLED ---
    if state.install_cancelled.load(std::sync::atomic::Ordering::SeqCst) {
        let mut data = state.data.lock().unwrap();
        data.mods.retain(|m| !newly_added_mod_ids.contains(&m.id));
        if let Some(pid) = newly_created_profile_id {
            if let Some(idx) = data.profiles.iter().position(|p| p.id == pid) {
                data.profiles.remove(idx);
                if data.active_profile_id == Some(pid) {
                    data.active_profile_id = None;
                }
            }
        }
        drop(data);
        let _ = state.save();
        
        for folder in newly_added_mod_folders {
            if folder.exists() {
                let _ = std::fs::remove_dir_all(folder);
            }
        }
        return Err("Installation annulée.".to_string());
    }



    let _ = state.save();
    Ok(results)
}

#[tauri::command]
pub async fn verify_integrity(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let enabled_info = {
        let data = state.data.lock().unwrap();
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?;
        let p = data.profiles.iter().find(|p| &p.id == active_id).ok_or("Profil introuvable")?.clone();
        
        let mut enabled = Vec::new();
        for m in &data.mods {
            let mod_p = &m.mod_folder_path;
            let prof_p = &p.mods_path;
            
            let is_in_profile = if mod_p.starts_with(prof_p) { true } else {
                match (mod_p.canonicalize(), prof_p.canonicalize()) {
                    (Ok(a), Ok(b)) => a.starts_with(b),
                    _ => false
                }
            };

            if m.enabled && is_in_profile {
                enabled.push(m.clone());
            }
        }
        (enabled, p.game_path.clone())
    };

    let (mods, game_path) = enabled_info;

    let altered = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<String>, String> {
        let mut altered = Vec::new();
        for m in mods {
            let mod_dir = &m.mod_folder_path;
            let game_dir = std::path::PathBuf::from(&game_path);
            
            if let Some(hashes) = &m.file_hashes {
                // SHA256 Deep Scan for this mod
                
                // 1. Check for missing or corrupted
                for (rel_str, old_hash) in hashes {
                    let rel = std::path::PathBuf::from(rel_str);
                    let src = mod_dir.join(&rel);
                    let dst = game_dir.join(&rel);
                    
                    if !src.exists() {
                        altered.push(format!("[{}] {} (Manquant dans biblio)", m.name, rel.display()));
                    } else if !dst.exists() {
                        altered.push(format!("[{}] {} (Manquant dans jeu)", m.name, rel.display()));
                    } else {
                        // Check game file hash
                        if let Ok(new_hash) = crate::fs_utils::compute_file_sha256(&dst) {
                            if new_hash != *old_hash {
                                altered.push(format!("[{}] {} (Modifié/Corrompu)", m.name, rel.display()));
                            }
                        }
                    }
                }
                
                // 2. Check for unexpected files in mod dir
                if let Ok(current_files) = crate::fs_utils::list_mod_files(mod_dir) {
                    for f in current_files {
                        let rel_str = f.to_string_lossy().to_string();
                        if !hashes.contains_key(&rel_str) {
                             altered.push(format!("[{}] {} (Fichier inattendu)", m.name, rel_str));
                        }
                    }
                }
            } else {
                // Compatibility Scan (Size + Existence)
                if let Ok(files) = crate::fs_utils::list_mod_files(mod_dir) {
                    for rel in files {
                        let src = mod_dir.join(&rel);
                        let dst = game_dir.join(&rel);
                        
                        let src_meta = std::fs::metadata(&src).ok();
                        let dst_meta = std::fs::metadata(&dst).ok();
                        
                        match (src_meta, dst_meta) {
                            (Some(s), Some(d)) => {
                                if s.len() != d.len() {
                                    altered.push(format!("[{}] {}", m.name, rel.display()));
                                }
                            },
                            _ => {
                                altered.push(format!("[{}] {} (Manquant)", m.name, rel.display()));
                            }
                        }
                    }
                }
            }
        }
        Ok(altered)
    }).await.map_err(|e| e.to_string())??;

    log_line(format!("[INTEGRITY] Profile check complete: {} issue(s) found", altered.len()));
    Ok(altered)
}
#[tauri::command]
pub async fn toggle_all_mods(window: Window, state: State<'_, AppState>, enable: bool) -> Result<(), String> {
    log_line(format!("[MOD] Toggle all mods: {}", if enable { "ENABLE" } else { "DISABLE" }));
    let mod_ids = {
        let data = state.data.lock().unwrap();
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?;
        let active_profile = data.profiles.iter().find(|p| &p.id == active_id).ok_or("Profil introuvable")?;
        
        data.mods.iter()
            .filter(|m| {
                let mod_p = &m.mod_folder_path;
                let prof_p = &active_profile.mods_path;
                if mod_p.starts_with(prof_p) { return true; }
                match (mod_p.canonicalize(), prof_p.canonicalize()) {
                    (Ok(m_can), Ok(p_can)) => m_can.starts_with(p_can),
                    _ => false
                }
            })
            .map(|m| m.id.clone())
            .collect::<Vec<String>>()
    };

    for id in mod_ids {
        if enable {
            let _ = enable_mod(window.clone(), state.clone(), id).await;
        } else {
            let _ = disable_mod(window.clone(), state.clone(), id).await;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn check_conflicts(state: State<'_, AppState>, mod_id: String) -> Result<Vec<String>, String> {
    let (mod_folder, active_mods_data) = {
        let data = state.data.lock().unwrap();
        let target_mod = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?;
        
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?;
        let p = data.profiles.iter().find(|p| &p.id == active_id).ok_or("Profil introuvable")?;
        
        let mut others = Vec::new();
        for mid in &p.active_mods {
            if mid == &mod_id { continue; }
            if let Some(m) = data.mods.iter().find(|m| &m.id == mid) {
                others.push(m.clone());
            }
        }
        (target_mod.mod_folder_path.clone(), others)
    };

    let target_files = fs_utils::list_mod_files(&mod_folder).map_err(|e| e.to_string())?;
    let mut conflicts = std::collections::HashSet::new();

    for other in active_mods_data {
        let other_files = fs_utils::list_mod_files(&other.mod_folder_path).map_err(|e| e.to_string())?;
        for f in &target_files {
            if other_files.contains(f) {
                conflicts.insert(other.name.clone());
            }
        }
    }

    Ok(conflicts.into_iter().collect())
}

#[tauri::command]
pub async fn list_mod_files_recursive(state: State<'_, AppState>, mod_id: String) -> Result<Vec<String>, String> {
    let mod_folder = {
        let data = state.data.lock().unwrap();
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?;
        m.mod_folder_path.clone()
    };
    
    let files = fs_utils::list_mod_files(&mod_folder).map_err(|e| e.to_string())?;
    Ok(files.into_iter().map(|p| p.to_string_lossy().to_string()).collect())
}



#[tauri::command]
pub fn get_mod_conflicts(state: State<AppState>, mod_id: String) -> Result<Vec<ConflictReport>, String> {
    ensure_cache_populated(&state)?;
    
    let data = state.data.lock().unwrap();
    let target_mod = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?;
    
    // 1. Try active profile first
    if let Some(active_id) = &data.active_profile_id {
        if let Some(active_profile) = data.profiles.iter().find(|p| &p.id == active_id) {
            let mod_p_can = target_mod.mod_folder_path.canonicalize().unwrap_or(target_mod.mod_folder_path.clone());
            let prof_p_can = active_profile.mods_path.canonicalize().unwrap_or(active_profile.mods_path.clone());
            
            if mod_p_can.starts_with(&prof_p_can) {
                return Ok(calculate_conflicts_from_cache(target_mod, &data, active_id, &state));
            }
        }
    }

    // 2. If not in active (or no active), find ANY profile that owns this mod
    let mod_p_can = target_mod.mod_folder_path.canonicalize().unwrap_or(target_mod.mod_folder_path.clone());
    for p in &data.profiles {
        let prof_p_can = p.mods_path.canonicalize().unwrap_or(p.mods_path.clone());
        if mod_p_can.starts_with(&prof_p_can) {
            return Ok(calculate_conflicts_from_cache(target_mod, &data, &p.id, &state));
        }
    }

    // 3. Last fallback: just use the active one for root reference even if it doesn't own the mod (dangerous but helps in some cases)
    if let Some(active_id) = &data.active_profile_id {
        return Ok(calculate_conflicts_from_cache(target_mod, &data, active_id, &state));
    }

    Ok(Vec::new())
}

pub fn invalidate_cache(state: &State<AppState>) {
    let mut last_update = state.last_cache_update.lock().unwrap();
    *last_update = None; // Force re-population on next call
}

#[tauri::command]
pub fn get_conflict_file_tree(state: State<AppState>, mod_id: String, other_mod_id: String) -> Result<Vec<String>, String> {
    let data = state.data.lock().unwrap();
    let m1 = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod 1 introuvable")?;
    let m2 = data.mods.iter().find(|m| m.id == other_mod_id).ok_or("Mod 2 introuvable")?;

    let files1 = crate::fs_utils::list_mod_files(&m1.mod_folder_path).map_err(|e| e.to_string())?;
    let files2: std::collections::HashSet<PathBuf> = crate::fs_utils::list_mod_files(&m2.mod_folder_path)
        .map_err(|e| e.to_string())?
        .into_iter()
        .collect();

    let mut overlap = Vec::new();
    for f in files1 {
        if files2.contains(&f) {
            overlap.push(f.to_string_lossy().to_string());
        }
    }
    Ok(overlap)
}

#[tauri::command]
pub async fn open_mod_active_folder(state: State<'_, AppState>, mod_id: String) -> Result<(), String> {
    let (game_path, installed_files) = {
        let data = state.data.lock().unwrap();
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?;
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?.clone();
        let p = data.profiles.iter().find(|p| p.id == active_id).ok_or("Profil introuvable")?.clone();
        (p.game_path.clone(), m.installed_files.clone())
    };

    if installed_files.is_empty() {
        return open_folder(game_path.to_string_lossy().to_string());
    }

    // Calculate common parent directory of all installed files
    let common_prefix = get_common_path(&installed_files);
    
    // Ensure we join safely (relative prefix)
    let rel_prefix = if common_prefix.is_absolute() {
        common_prefix.strip_prefix("/").unwrap_or(&common_prefix).to_path_buf()
    } else {
        common_prefix
    };

    let target_dir = game_path.join(rel_prefix);
    
    if target_dir.exists() && target_dir.is_dir() {
        open_folder(target_dir.to_string_lossy().to_string())
    } else {
        open_folder(game_path.to_string_lossy().to_string())
    }
}

#[tauri::command]
pub async fn open_mod_backup_folder(state: State<'_, AppState>, _mod_id: String) -> Result<(), String> {
    let backup_path = {
        let data = state.data.lock().unwrap();
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?.clone();
        let p = data.profiles.iter().find(|p| p.id == active_id).ok_or("Profil introuvable")?.clone();
        p.backup_path.clone()
    };

    if backup_path.exists() {
        open_folder(backup_path.to_string_lossy().to_string())
    } else {
        Err("Dossier backup introuvable".to_string())
    }
}

fn get_common_path(paths: &[String]) -> PathBuf {
    if paths.is_empty() { return PathBuf::new(); }
    
    // Split the first path into components, filtering out empty ones (like leading slashes)
    let mut common: Vec<&str> = paths[0]
        .split(|c| c == '/' || c == '\\')
        .filter(|s| !s.is_empty())
        .collect();
        
    // Remove the filename (last component)
    if !common.is_empty() { common.pop(); }

    for path in paths.iter().skip(1) {
        let parts: Vec<&str> = path.split(|c| c == '/' || c == '\\').filter(|s| !s.is_empty()).collect();
        let mut new_common = Vec::new();
        for (i, part) in parts.iter().enumerate() {
            if i < common.len() && part == &common[i] {
                new_common.push(*part);
            } else {
                break;
            }
        }
        common = new_common;
    }
    
    let mut res = PathBuf::new();
    for part in common {
        res.push(part);
    }
    res
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityReport {
    pub mod_id: String,
    pub missing: Vec<String>,
    pub modified: Vec<String>,
    pub added: Vec<String>,
    pub total: usize,
    pub is_valid: bool,
}

#[tauri::command]
pub async fn get_mod_integrity(state: State<'_, AppState>, mod_id: String) -> Result<IntegrityReport, String> {
    let (mod_path, cached_hashes, needs_baseline) = {
        let data = state.data.lock().unwrap();
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?;
        (m.mod_folder_path.clone(), m.file_hashes.clone(), m.file_hashes.is_none())
    };

    if needs_baseline {
        // Auto-initialize baseline hashes if missing
        let current_files = fs_utils::list_mod_files(&mod_path).map_err(|e| e.to_string())?;
        let mut new_hashes = std::collections::HashMap::new();
        for f in &current_files {
            let full_path = mod_path.join(f);
            if let Ok(h) = fs_utils::compute_file_sha256(&full_path) {
                new_hashes.insert(f.to_string_lossy().to_string(), h);
            }
        }
        
        {
            let mut data = state.data.lock().unwrap();
            if let Some(m) = data.mods.iter_mut().find(|m| m.id == mod_id) {
                m.file_hashes = Some(new_hashes.clone());
            }
        }
        let _ = state.save();
        
        return Ok(IntegrityReport {
            mod_id,
            missing: Vec::new(),
            modified: Vec::new(),
            added: Vec::new(),
            total: current_files.len(),
            is_valid: true,
        });
    }

    let current_files = fs_utils::list_mod_files(&mod_path).map_err(|e| e.to_string())?;
    let mut missing = Vec::new();
    let mut modified = Vec::new();
    let mut added = Vec::new();
    
    let hashes = cached_hashes.unwrap_or_default();
    
    // Check for missing or modified
    for (rel_path, old_hash) in &hashes {
        let full_path = mod_path.join(rel_path);
        if !full_path.exists() {
            missing.push(rel_path.clone());
        } else {
            if let Ok(new_hash) = fs_utils::compute_file_sha256(&full_path) {
                if new_hash != *old_hash {
                    modified.push(rel_path.clone());
                }
            }
        }
    }

    // Check for added
    for f in &current_files {
        let rel_str = f.to_string_lossy().to_string();
        if !hashes.contains_key(&rel_str) {
            added.push(rel_str);
        }
    }

    let is_valid = missing.is_empty() && modified.is_empty() && added.is_empty();

    Ok(IntegrityReport {
        mod_id,
        missing,
        modified,
        added,
        total: current_files.len(),
        is_valid,
    })
}

#[tauri::command]
pub async fn update_mod_hashes(state: State<'_, AppState>, mod_id: String) -> Result<(), String> {
    let mod_path = {
        let data = state.data.lock().unwrap();
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?;
        m.mod_folder_path.clone()
    };

    let current_files = fs_utils::list_mod_files(&mod_path).map_err(|e| e.to_string())?;
    let mut new_hashes = std::collections::HashMap::new();

    for f in current_files {
        let full_path = mod_path.join(&f);
        if let Ok(hash) = fs_utils::compute_file_sha256(&full_path) {
            new_hashes.insert(f.to_string_lossy().to_string(), hash);
        }
    }

    {
        let mut data = state.data.lock().unwrap();
        if let Some(m) = data.mods.iter_mut().find(|m| m.id == mod_id) {
            m.file_hashes = Some(new_hashes);
        }
    }
    
    let _ = state.save();
    Ok(())
}

pub fn start_sha_calculation_background(state: tauri::State<'_, AppState>) {
    let sha_queue = state.sha_queue.clone();
    let sha_queue_priority = state.sha_queue_priority.clone();
    let sha_calculation_active = state.sha_calculation_active.clone();
    let data_path = state.data_path.clone();
    
    std::thread::spawn(move || {
        log_line("[SHA-CALC] Background SHA calculation thread started");
        
        loop {
            // Check if already running
            if sha_calculation_active.load(std::sync::atomic::Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(500));
                continue;
            }
            
            // Get next mod from priority queue or normal queue
            let mod_id = {
                let mut priority_queue = sha_queue_priority.lock().unwrap();
                if let Some(id) = priority_queue.pop_front() {
                    Some(id)
                } else {
                    drop(priority_queue);
                    let mut normal_queue = sha_queue.lock().unwrap();
                    normal_queue.pop_front()
                }
            };
            
            match mod_id {
                Some(id) => {
                    sha_calculation_active.store(true, std::sync::atomic::Ordering::SeqCst);
                    
                    log_line(format!("[SHA-CALC] Calculating hashes for mod: {}", id));
                    
                    // Load data to get mod path
                    let mod_path_opt = {
                        let data = crate::state::AppState::load(data_path.clone());
                        let data_lock = data.data.lock().unwrap();
                        data_lock.mods.iter().find(|m| m.id == id).map(|m| m.mod_folder_path.clone())
                    };
                    
                    if mod_path_opt.is_none() {
                        log_line(format!("[SHA-CALC] Mod {} not found, skipping", id));
                    }
                    
                    if let Some(mod_path) = mod_path_opt {
                        if let Ok(current_files) = fs_utils::list_mod_files(&mod_path) {
                            let mut new_hashes = std::collections::HashMap::new();
                            let mut calculated = 0;
                            
                            for f in current_files {
                                let full_path = mod_path.join(&f);
                                if let Ok(hash) = fs_utils::compute_file_sha256(&full_path) {
                                    new_hashes.insert(f.to_string_lossy().to_string(), hash);
                                    calculated += 1;
                                }
                            }
                            
                            // Reload data, update hashes, and save
                            {
                                let data = crate::state::AppState::load(data_path.clone());
                                let mut data_lock = data.data.lock().unwrap();
                                if let Some(m) = data_lock.mods.iter_mut().find(|m| m.id == id) {
                                    m.file_hashes = Some(new_hashes);
                                }
                                let _ = data.save();
                            }
                            
                            log_line(format!("[SHA-CALC] Completed mod {} ({} files)", id, calculated));
                        }
                    }
                    
                    sha_calculation_active.store(false, std::sync::atomic::Ordering::SeqCst);
                    
                    // Throttle: wait between mods to avoid CPU/disk saturation
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                None => {
                    // No mods in queue, sleep longer
                    std::thread::sleep(std::time::Duration::from_millis(1000));
                }
            }
        }
    });
}

pub fn populate_sha_queue(state: tauri::State<'_, AppState>) {
    let data = state.data.lock().unwrap();
    let mut queue = state.sha_queue.lock().unwrap();
    
    for mod_entry in &data.mods {
        if mod_entry.file_hashes.is_none() || mod_entry.file_hashes.as_ref().map_or(true, |h| h.is_empty()) {
            queue.push_back(mod_entry.id.clone());
        }
    }
    
    log_line(format!("[SHA-CALC] Added {} mods to SHA calculation queue", queue.len()));
}

pub fn add_mod_to_priority_sha_queue(state: tauri::State<'_, AppState>, mod_id: String) {
    let mut priority_queue = state.sha_queue_priority.lock().unwrap();
    
    // Check if mod already needs hashing
    let needs_hash = {
        let data = state.data.lock().unwrap();
        data.mods.iter().find(|m| m.id == mod_id)
            .map_or(false, |m| m.file_hashes.is_none() || m.file_hashes.as_ref().map_or(true, |h| h.is_empty()))
    };
    
    if needs_hash {
        // Remove from normal queue if present
        {
            let mut normal_queue = state.sha_queue.lock().unwrap();
            normal_queue.retain(|id| id != &mod_id);
        }
        
        // Add to priority queue
        priority_queue.push_back(mod_id.clone());
        log_line(format!("[SHA-CALC] Added mod {} to priority SHA queue", mod_id));
    }
}
