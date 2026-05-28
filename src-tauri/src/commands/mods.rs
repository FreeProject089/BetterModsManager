use crate::fs_utils;
use crate::models::mod_entry::{ModEntry, ModStatus, ConflictReport, ConflictCategory, ConflictStatus, derive_content_id, update_content_id_from_hashes};
use crate::commands::crash::log_line;
use crate::state::AppState;
use std::path::PathBuf;
use tauri::{State, Window, Manager};
use std::sync::Mutex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::time::Instant;
use crate::error::AppError;

#[derive(Serialize, Clone)]
pub struct ShaStatusPayload {
    pub mod_id: String,
    pub status: String,
    pub is_manual: bool,
}

#[derive(Serialize, Clone)]
pub struct HashingStats {
    pub total_mods: usize,
    pub hashed_mods: usize,
    pub missing_mods: usize,
    pub invalid_mods: usize,
    pub valid_mods: usize,
    pub queue_size: usize,
    pub is_active: bool,
    pub current_mod_name: Option<String>,
}

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
    /// PID of the currently-running CANCELLABLE mod-IO worker subprocess.
    /// `cancel_mod_ops` kills this PID for near-instant cancellation.
    static ref MOD_OP_CHILD_PID: Mutex<Option<u32>> = Mutex::new(None);
}

/// Set to `true` the moment we taskkill the worker.  Independent of the
/// global cancel flag — survives the frontend's `clear_mod_op_cancel` race
/// so the parent always knows "this exit was my doing".  Reset to `false`
/// before each new cancellable worker spawn.
static MOD_OP_KILLED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

fn set_mod_op_child_pid(pid: Option<u32>) {
    *MOD_OP_CHILD_PID.lock().unwrap_or_else(|p| p.into_inner()) = pid;
}

/// Lightweight per-op resource probe.  Captures current process RSS and
/// CPU% via `sysinfo`.  Returns `(rss_bytes, cpu_pct)`; falls back to zeros
/// if the probe fails so logging never blocks an op.
fn probe_process_stats() -> (u64, f32) {
    use sysinfo::{System, Pid};
    let mut sys = System::new();
    let pid = Pid::from_u32(std::process::id());
    sys.refresh_process(pid);
    if let Some(p) = sys.process(pid) {
        (p.memory(), p.cpu_usage())
    } else {
        (0, 0.0)
    }
}

/// Spawn the BMM exe in `--mod-worker` mode, wait for it, return the output.
/// Runs synchronously — callers should put this inside `spawn_blocking`.
///
/// `cancellable`:
///   - `true`  → register the PID for `cancel_mod_ops` to kill, and if
///                killed, run an inverse-op undo subprocess so any partial
///                writes are reverted.
///   - `false` → registered nowhere, cannot be cancelled (used for the
///                inverse undo itself).
fn run_mod_io_worker_with_mode(
    input: crate::fs_utils::WorkerInput,
    cancellable: bool,
    op_label: &str,
) -> Result<crate::fs_utils::WorkerOutput, String> {
    use std::process::{Command, Stdio};
    use std::sync::atomic::Ordering;
    use std::time::Instant;

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;

    let tmpdir = std::env::temp_dir();
    let uid = uuid::Uuid::new_v4().simple().to_string();
    let in_path  = tmpdir.join(format!("bmm-mod-worker-in-{}.json",  uid));
    let out_path = tmpdir.join(format!("bmm-mod-worker-out-{}.json", uid));

    let input_json = serde_json::to_string(&input).map_err(|e| e.to_string())?;
    std::fs::write(&in_path, input_json).map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&exe);
    cmd.arg("--mod-worker")
        .arg(&in_path)
        .arg(&out_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
        const CREATE_NO_WINDOW:            u32 = 0x0800_0000;
        cmd.creation_flags(BELOW_NORMAL_PRIORITY_CLASS | CREATE_NO_WINDOW);
    }

    let (rss_before, _) = probe_process_stats();
    let started = Instant::now();

    // Reset killed flag for the new cancellable op.
    if cancellable {
        MOD_OP_KILLED.store(false, Ordering::SeqCst);
    }

    let mut child = cmd.spawn().map_err(|e| {
        let _ = std::fs::remove_file(&in_path);
        format!("Failed to spawn mod worker: {}", e)
    })?;
    let pid = child.id();
    if cancellable {
        set_mod_op_child_pid(Some(pid));
    }

    let status = child.wait();
    if cancellable {
        set_mod_op_child_pid(None);
    }
    let _ = std::fs::remove_file(&in_path);

    let status = match status {
        Ok(s) => s,
        Err(e) => {
            let _ = std::fs::remove_file(&out_path);
            return Err(format!("Worker wait failed: {}", e));
        }
    };

    // Per-op resource log — surfaces in the crash bundle / log file.
    let elapsed = started.elapsed();
    let (rss_after, cpu_pct) = probe_process_stats();
    let rss_delta_kb = (rss_after as i128 - rss_before as i128) / 1024;
    log_line(format!(
        "[RESOURCE] {} pid={} dur={}ms exit={:?} rss={}KB Δrss={:+}KB cpu={:.1}%",
        op_label, pid,
        elapsed.as_millis(),
        status.code(),
        rss_after / 1024,
        rss_delta_kb,
        cpu_pct,
    ));

    let we_killed_it = cancellable && MOD_OP_KILLED.load(Ordering::SeqCst);

    // ── Cancelled path ────────────────────────────────────────────────────
    // Code 3  → worker noticed cancel flag and exited cleanly.
    // killed  → parent ran taskkill on the PID.
    if status.code() == Some(3) || we_killed_it {
        let _ = std::fs::remove_file(&out_path);

        // Run the inverse op to undo any partial work.  Use a non-cancellable
        // worker (its child process has its own clean cancellation state, so
        // it will run to completion).  We deliberately keep the parent's
        // global cancel flag set so any outer loop (toggle_all_mods, etc.)
        // still sees the cancel and stops iterating.
        let undo_input = make_inverse_undo_input(&input);
        if let Some(u) = undo_input {
            log_line(format!("[MOD] running inverse undo after cancel ({})", input.op));
            let _ = run_mod_io_worker_with_mode(u, false, "MOD/undo");
        }

        return Err("CANCELLED".to_string());
    }

    if !status.success() {
        let mut err = format!("Worker exited with code {:?}", status.code());
        if let Ok(s) = std::fs::read_to_string(&out_path) {
            if let Ok(out) = serde_json::from_str::<crate::fs_utils::WorkerOutput>(&s) {
                if let Some(e) = out.error { err = e; }
            }
        }
        let _ = std::fs::remove_file(&out_path);
        return Err(err);
    }

    let out_str = std::fs::read_to_string(&out_path).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&out_path);
    let out: crate::fs_utils::WorkerOutput = serde_json::from_str(&out_str).map_err(|e| e.to_string())?;
    if let Some(e) = out.error {
        return Err(e);
    }
    Ok(out)
}

/// Public wrapper — every call from enable/disable goes through here.
fn run_mod_io_worker(input: crate::fs_utils::WorkerInput) -> Result<crate::fs_utils::WorkerOutput, String> {
    let label = match input.op.as_str() {
        "apply"   => "MOD/apply",
        "unapply" => "MOD/unapply",
        other     => { log_line(format!("[MOD] unknown op '{}'", other)); "MOD/?" }
    };
    run_mod_io_worker_with_mode(input, true, label)
}

/// Builds the inverse-op worker input used for "cancel = undo partial work".
///   apply  → unapply (delete files we just copied, restore originals)
///   unapply→ apply   (re-copy mod files we'd started restoring)
fn make_inverse_undo_input(input: &crate::fs_utils::WorkerInput) -> Option<crate::fs_utils::WorkerInput> {
    match input.op.as_str() {
        "apply" => {
            // What we MIGHT have written = full mod file list
            let files_to_remove: Vec<String> = crate::fs_utils::list_mod_files(&input.mod_folder)
                .unwrap_or_default()
                .into_iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            if files_to_remove.is_empty() { return None; }
            Some(crate::fs_utils::WorkerInput {
                op: "unapply".to_string(),
                mod_folder: input.mod_folder.clone(),
                game_path: input.game_path.clone(),
                backup_path: input.backup_path.clone(),
                other_mods_files: Vec::new(),
                files_to_remove,
                other_active_mods: Vec::new(),
                game_path_limit: input.game_path_limit,
                backup_path_limit: input.backup_path_limit,
                smart_io: input.smart_io,
            })
        }
        "unapply" => {
            if input.mod_folder.as_os_str().is_empty() { return None; }
            Some(crate::fs_utils::WorkerInput {
                op: "apply".to_string(),
                mod_folder: input.mod_folder.clone(),
                game_path: input.game_path.clone(),
                backup_path: input.backup_path.clone(),
                other_mods_files: Vec::new(),
                files_to_remove: Vec::new(),
                other_active_mods: Vec::new(),
                game_path_limit: input.game_path_limit,
                backup_path_limit: input.backup_path_limit,
                smart_io: input.smart_io,
            })
        }
        _ => None,
    }
}

/// Frontend "cancel" entry-point.  Flips the global cancellation flag AND
/// kills the worker subprocess if one is running.  Returns instantly.
#[tauri::command]
pub fn cancel_mod_ops() {
    use std::sync::atomic::Ordering;
    log_line("[MOD] cancel_mod_ops requested");
    crate::fs_utils::request_mod_op_cancel();

    let pid_opt = { MOD_OP_CHILD_PID.lock().unwrap_or_else(|p| p.into_inner()).clone() };
    if let Some(pid) = pid_opt {
        // Mark as intentionally killed BEFORE issuing taskkill, so the
        // wait() in `run_mod_io_worker_with_mode` sees `killed=true`
        // regardless of how the frontend manipulates the global flag.
        MOD_OP_KILLED.store(true, Ordering::SeqCst);

        log_line(format!("[MOD] killing worker PID {}", pid));
        #[cfg(target_os = "windows")]
        {
            use std::process::Command;
            // /F = force, /T = kill the whole tree (rayon threads etc.)
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn();
        }
        #[cfg(not(target_os = "windows"))]
        {
            use std::process::Command;
            let _ = Command::new("kill")
                .args(["-9", &pid.to_string()])
                .spawn();
        }
    }
}

/// Called by the frontend once all revert work after a cancel is finished,
/// so the next user-initiated toggle can run normally.
#[tauri::command]
pub fn clear_mod_op_cancel() {
    crate::fs_utils::reset_mod_op_cancel();
}

/// "Cancel current op only" — kills the in-flight worker subprocess but
/// does NOT raise the global cancel flag.  Used by the cancel button's
/// default click so a running toggle-all batch can continue with the next
/// mod after the user skips just the current one.
#[tauri::command]
pub fn kill_current_mod_op() {
    use std::sync::atomic::Ordering;
    log_line("[MOD] kill_current_mod_op (skip current only)");
    let pid_opt = { MOD_OP_CHILD_PID.lock().unwrap_or_else(|p| p.into_inner()).clone() };
    if let Some(pid) = pid_opt {
        MOD_OP_KILLED.store(true, Ordering::SeqCst);
        #[cfg(target_os = "windows")]
        {
            use std::process::Command;
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn();
        }
        #[cfg(not(target_os = "windows"))]
        {
            use std::process::Command;
            let _ = Command::new("kill")
                .args(["-9", &pid.to_string()])
                .spawn();
        }
    }
}

#[tauri::command]
pub fn get_mods(state: State<AppState>) -> Result<Vec<EnrichedMod>, AppError> {
    // 1. Ensure cache is populated (Lazy but thread-safe)
    ensure_cache_populated(&state)?;

    let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    let active_id = match data.active_profile_id.as_ref() {
        Some(id) => id,
        None => return Ok(Vec::new()),
    };
    let active_profile = data.profiles.iter().find(|p| &p.id == active_id).ok_or_else(|| AppError::NotFound("Profil introuvable".to_string()))?;
    
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

            // RAM/IPC trim: the frontend list never reads these large arrays,
            // so don't ship them across IPC.  They stay intact in `data.mods`
            // (the source of truth) — we only blank them in the cloned wire
            // copy here.  Saves potentially hundreds of MB of JS heap on
            // large libraries (one map entry per file per mod).
            enriched.mod_entry.cached_files = None;
            enriched.mod_entry.installed_files = Vec::new();
            enriched.mod_entry.file_hashes = match &m.file_hashes {
                Some(h) if !h.is_empty() => {
                    let mut sentinel = std::collections::HashMap::with_capacity(1);
                    sentinel.insert("__present__".to_string(), format!("{}", h.len()));
                    Some(sentinel)
                }
                _ => None,
            };

            // Set 'enabled' based on active profile
            enriched.mod_entry.enabled = active_profile.active_mods.contains(&m.id);
            
            // Set per-profile activation order
            if enriched.mod_entry.enabled {
                enriched.mod_entry.activation_order = (active_profile.active_mods.iter().position(|id| id == &m.id).unwrap_or(0) as u32) + 1;
            } else {
                enriched.mod_entry.activation_order = 0;
            }

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

fn ensure_cache_populated(state: &State<AppState>) -> Result<(), AppError> {
    // 1. First check if update is needed (read-only check under data lock to ensure ordering)
    // Actually, we must enforce Data -> LastUpdate -> Cache -> Index
    let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    let mut last_update = state.last_cache_update.lock().map_err(|_| AppError::LockError("Failed to lock last_update".to_string()))?;
    
    if last_update.is_some() { return Ok(()); }

    log_line("[CACHE] Populating mod file cache for the first time...");
    let mut needs_save = false;

    {
        let mut cache = state.mod_files_cache.lock().map_err(|_| AppError::LockError("Failed to lock mod_files_cache".to_string()))?;
        let mut index = state.conflict_index.lock().map_err(|_| AppError::LockError("Failed to lock conflict_index".to_string()))?;

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
                        update_content_id_from_hashes(m);
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
    let cache = state.mod_files_cache.lock().unwrap_or_else(|p| p.into_inner());
    let index = state.conflict_index.lock().unwrap_or_else(|p| p.into_inner());

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

                let order = (profile.active_mods.iter().position(|id| id == &other_id).unwrap_or(0) as u32) + 1;

                reports.push(ConflictReport {
                    category: if is_same_profile { ConflictCategory::Intra } else { ConflictCategory::Inter },
                    status,
                    other_mod_id: other_id.clone(),
                    other_mod_name: other_mod.name.clone(),
                    other_profile_name: profile.name.clone(),
                    file_count: count,
                    activation_order: order,
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
pub fn get_all_mods(state: State<AppState>) -> Result<Vec<ModEntry>, AppError> {
    let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    // RAM trim: strip the big arrays/maps from the wire copy.  Each mod's
    // file_hashes map can contain thousands of entries; multiplied by
    // hundreds of mods, this was responsible for hundreds of MB sitting
    // in the JS heap permanently as `S.allMods`.  Frontend code that
    // actually needs the hashes (modpack creator) now uses the dedicated
    // `get_mod_hashes` command to fetch on demand.
    let mut out: Vec<ModEntry> = Vec::with_capacity(data.mods.len());
    for m in &data.mods {
        let mut slim = m.clone();
        // Keep a marker so frontend's "missing hashes" check still works:
        //   None  → missing
        //   Some(map with a single sentinel entry) → present
        slim.file_hashes = match &m.file_hashes {
            Some(h) if !h.is_empty() => {
                let mut sentinel = std::collections::HashMap::with_capacity(1);
                sentinel.insert("__present__".to_string(), format!("{}", h.len()));
                Some(sentinel)
            }
            _ => None,
        };
        slim.cached_files = None;
        slim.installed_files = Vec::new();
        out.push(slim);
    }
    Ok(out)
}

/// Returns the actual file_hashes map for a single mod.  Used by features
/// that need real hash values (modpack creator hash matching, integrity
/// verification, etc) without the cost of shipping every mod's hashes.
#[tauri::command]
pub fn get_mod_hashes(state: State<AppState>, mod_id: String) -> Result<Option<std::collections::HashMap<String, String>>, AppError> {
    let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    Ok(data.mods.iter().find(|m| m.id == mod_id).and_then(|m| m.file_hashes.clone()))
}

/// Batch-resolve a list of SHA-256 strings to local mod IDs.  Lookup runs
/// entirely in Rust — frontend doesn't need the full hash maps to do this.
/// Returns a map: sha → Some(mod_id) | None.
#[tauri::command]
pub fn find_local_mods_by_hashes(
    state: State<AppState>,
    hashes: Vec<String>,
) -> Result<std::collections::HashMap<String, Option<String>>, AppError> {
    let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
    // Build a sha → mod_id index once (cheap, ~O(total_files))
    let mut sha_index: std::collections::HashMap<&str, &str> = std::collections::HashMap::new();
    for m in &data.mods {
        if let Some(h) = &m.file_hashes {
            for (_, sha) in h.iter() {
                sha_index.entry(sha.as_str()).or_insert(m.id.as_str());
            }
        }
    }
    let mut out: std::collections::HashMap<String, Option<String>> = std::collections::HashMap::with_capacity(hashes.len());
    for sha in hashes {
        let found = sha_index.get(sha.as_str()).map(|s| s.to_string());
        out.insert(sha, found);
    }
    Ok(out)
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
) -> Result<ModEntry, AppError> {
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
        let data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        let active_id = data.active_profile_id.as_ref().ok_or_else(|| AppError::NotFound("Aucun profil actif".to_string()))?.clone();
        let p = data.profiles.iter().find(|p| p.id == active_id).ok_or_else(|| AppError::NotFound("Profil introuvable".to_string()))?.clone();
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
                let archive = zip::ZipArchive::new(file).map_err(|e| format!("Zip error: {}", e))?;
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
    entry.content_id = derive_content_id(&entry.mod_folder_path);
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
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        data.mods.push(entry);
    }
    let _ = state.save();
    invalidate_cache(&state);
    Ok(result)
}

#[tauri::command]
pub async fn remove_mod(state: State<'_, AppState>, mod_id: String, delete_files: bool) -> Result<(), AppError> {
    log_line(format!("[MOD] Removing mod '{}' (delete_files: {})", mod_id, delete_files));
    let (mod_path, mods_dependent_on_this, active_id, mod_name) = {
        let mut data = state.data.lock().map_err(|_| AppError::LockError("Failed to lock AppState".to_string()))?;
        let idx = data.mods.iter().position(|m| m.id == mod_id).ok_or_else(|| AppError::NotFound("Mod introuvable".to_string()))?;
        
        // Clone needed data before mutable borrow
        let mod_enabled = data.mods[idx].enabled;
        let mod_folder_path = data.mods[idx].mod_folder_path.clone();
        
        if mod_enabled {
            return Err(AppError::Internal("Désactivez le mod avant de le supprimer.".to_string()));
        }
        
        let active_id = data.active_profile_id.clone().unwrap_or_default();
        let mod_name = data.mods[idx].name.clone();
        
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
        (mod_folder_path, dependent_mods, active_id, mod_name)
    };

    crate::commands::history::log_activity(&state, &active_id, &mod_id, &mod_name, "Deleted", None);

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
    
    // Position is always found at this point in the resolution algorithm;
    // if somehow missing, skip removal gracefully.
    if let Some(pos) = unresolved.iter().position(|x| x == target_id) {
        unresolved.remove(pos);
    }
    Ok(())
}

#[tauri::command]
pub async fn enable_mod(window: Window, state: State<'_, AppState>, mod_id: String, bypass_sha: Option<bool>) -> Result<Option<String>, String> {
    // NOTE: do NOT clear the cancel flag here — multiple parallel enable_mod
    // calls would clobber an in-flight cancel.  The frontend explicitly
    // resets via `clear_mod_op_cancel` once it's done reverting.
    if crate::fs_utils::is_mod_op_cancelled() {
        log_line(format!("[MOD] enable_mod '{}' skipped — cancel flag set", mod_id));
        return Ok(None);
    }
    log_line(format!("[MOD] Enabling mod '{}' (recursive if needed)", mod_id));
    
    // 1. Resolve full dependency chain and check for missing dependencies
    let (mod_ids_to_enable, profile_data, warning_settings, missing_deps, needs_save, smart_io) = {
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
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
        let require_sha = data.settings.require_valid_sha;
        let smart_io = data.settings.smart_io_enabled;
        let bypass = bypass_sha.unwrap_or(false);

        if require_sha && !bypass {
            for mid in &to_enable {
                if let Some(m) = data.mods.iter().find(|m| &m.id == mid) {
                    if m.file_hashes.is_none() || m.file_hashes.as_ref().map_or(true, |h| h.is_empty()) {
                        return Err(format!("MISSING_SHA|{}|{}", m.id, m.name));
                    }
                }
            }
        }

        (to_enable, p, (warning_pct, critical_pct, alert_enabled), missing, needs_save, smart_io)
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
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        let cache = state.mod_files_cache.lock().unwrap_or_else(|p| p.into_inner());
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
        if crate::fs_utils::is_mod_op_cancelled() {
            log_line(format!("[MOD] Enable loop cancelled before mod '{}'", mid));
            break;
        }
        let (mod_folder, game_path, backup_path, mod_name) = {
            let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
            let m = match data.mods.iter().find(|m| m.id == mid) {
                Some(m) => m.clone(),
                None => continue, // mod removed mid-iteration, skip
            };
            
            let p = match data.profiles.iter().find(|p| p.id == profile_data.id) {
                Some(p) => p,
                None => return Err("Profil actif introuvable".to_string()),
            };

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
        let result: Result<Vec<PathBuf>, String> = tauri::async_runtime::spawn_blocking(move || {
            let _lock = MOD_OP_LOCK.lock().unwrap_or_else(|p| p.into_inner());
            // Re-check cancellation AFTER acquiring the serial lock — if a
            // cancel landed while we were queued, do not start a new worker.
            if crate::fs_utils::is_mod_op_cancelled() {
                return Err("CANCELLED".to_string());
            }
            let worker_in = crate::fs_utils::WorkerInput {
                op: "apply".to_string(),
                mod_folder,
                game_path,
                backup_path,
                other_mods_files: active_files_set_clone.into_iter().collect(),
                files_to_remove: Vec::new(),
                other_active_mods: Vec::new(),
                game_path_limit,
                backup_path_limit,
                smart_io,
            };
            run_mod_io_worker(worker_in).map(|out| out.applied)
        }).await.map_err(|e| e.to_string())?;

        let _ = window.emit("benchmark-event", BenchEventPayload {
            text: format!("Activated: {}", mod_name), disk_name: "".to_string(), total_mb: 0.0, limit_mb_s: None, finished: true,
        });

        // Cancellation surfaces as an "anyhow" with the literal "CANCELLED" message.
        // Treat it as a graceful early exit, not an error to bubble to the UI.
        let applied = match result {
            Ok(v) => v,
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("CANCELLED") || crate::fs_utils::is_mod_op_cancelled() {
                    log_line(format!("[MOD] Enable cancelled mid-copy for '{}'", mod_name));
                    break;
                }
                return Err(msg);
            }
        };

        {
            let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
            if let Some(m) = data.mods.iter_mut().find(|m| m.id == mid) {
                m.enabled = true;
                m.status = ModStatus::Enabled;
                m.installed_files = applied.iter().map(|p| p.to_string_lossy().to_string()).collect();
            }
            for p in data.profiles.iter_mut() {
                if p.game_path == profile_data.game_path && p.mods_path == profile_data.mods_path {
                    if !p.active_mods.contains(&mid) { p.active_mods.push(mid.clone()); }
                }
            }
        }

        // Update active_files_set for NEXT dependency in the chain
        if let Some(files) = state.mod_files_cache.lock().unwrap_or_else(|p| p.into_inner()).get(&mid) {
            for f in files { active_files_set.insert(f.clone()); }
        }

        log_line(format!("[MOD] Mod '{}' enabled", mod_name));
    }

    let _ = state.save();
    invalidate_cache(&state);
    
    // Log history for the primary mod
    if let Some(m) = { let data = state.data.lock().unwrap_or_else(|p| p.into_inner()); data.mods.iter().find(|m| m.id == mod_id).cloned() } {
        crate::commands::history::log_activity(&state, &profile_data.id, &mod_id, &m.name, "Enabled (with dependencies)", None);
    }

    Ok(overall_warning)
}

#[tauri::command]
pub async fn disable_mod(window: Window, state: State<'_, AppState>, mod_id: String) -> Result<(), String> {
    if crate::fs_utils::is_mod_op_cancelled() {
        log_line(format!("[MOD] disable_mod '{}' skipped — cancel flag set", mod_id));
        return Ok(());
    }
    log_line(format!("[MOD] Disabling mod '{}'", mod_id));
    let (mod_folder, game_path, backup_path, active_id, mod_name, files_to_remove, other_active_mods) = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?.clone();
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?.clone();
        let p = data.profiles.iter().find(|p| p.id == active_id).ok_or("Profil introuvable")?.clone();
        if !p.active_mods.contains(&mod_id) { return Ok(()); }

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

        (m.mod_folder_path.clone(), p.game_path.clone(), p.backup_path.clone(), active_id, m.name, unique_files.into_iter().collect::<Vec<String>>(), others)
    };

    let game_path_limit = crate::commands::disk::get_limit_for_path(&state, &game_path);
    let smart_io = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        data.settings.smart_io_enabled
    };

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

    let result: Result<(), String> = tauri::async_runtime::spawn_blocking(move || {
        let _lock = MOD_OP_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        if crate::fs_utils::is_mod_op_cancelled() {
            return Err("CANCELLED".to_string());
        }
        let worker_in = crate::fs_utils::WorkerInput {
            op: "unapply".to_string(),
            // Pass mod_folder so a cancel-undo can re-apply the mod files.
            mod_folder,
            game_path,
            backup_path,
            other_mods_files: Vec::new(),
            files_to_remove,
            other_active_mods,
            game_path_limit,
            backup_path_limit: None,
            smart_io,
        };
        run_mod_io_worker(worker_in).map(|_| ())
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

    if let Err(msg) = &result {
        if msg.contains("CANCELLED") || crate::fs_utils::is_mod_op_cancelled() {
            log_line(format!("[MOD] Disable cancelled mid-copy for '{}'", mod_name));
            return Ok(());
        }
    }
    result?;

    {
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        
        if let Some(m) = data.mods.iter_mut().find(|m| m.id == mod_id) {
            m.enabled = false;
            m.status = ModStatus::Disabled;
            m.installed_files.clear();
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
    crate::commands::history::log_activity(&state, &active_id, &mod_id, &mod_name, "Disabled", None);
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
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
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
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
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
    let (mod_path, changes_str) = {
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(m) = data.mods.iter_mut().find(|m| m.id == mod_id) {
            let mut changes = Vec::new();
            if m.name != name { changes.push(serde_json::json!({"field": "name", "old": m.name, "new": name})); }
            if m.author.as_deref().unwrap_or("") != author { changes.push(serde_json::json!({"field": "author", "old": m.author.as_deref().unwrap_or(""), "new": author})); }
            if m.description.as_deref().unwrap_or("") != description { changes.push(serde_json::json!({"field": "description", "old": m.description.as_deref().unwrap_or(""), "new": description})); }
            if m.version != version { changes.push(serde_json::json!({"field": "version", "old": m.version, "new": version})); }
            if m.tags != tags { changes.push(serde_json::json!({"field": "tags", "old": m.tags, "new": tags})); }
            if m.download_links != download_links { changes.push(serde_json::json!({"field": "links", "old": m.download_links, "new": download_links})); }
            if m.dependencies != dependencies { changes.push(serde_json::json!({"field": "dependencies", "old": m.dependencies, "new": dependencies})); }

            m.name = name.clone();
            m.author = Some(author);
            m.description = Some(description);
            m.version = version;
            m.tags = tags;
            m.download_links = download_links;
            m.dependencies = dependencies;
            
            let changes_str = if changes.is_empty() { None } else { serde_json::to_string(&changes).ok() };
            (Some((m.clone(), m.mod_folder_path.clone())), changes_str)
        } else {
            (None, None)
        }
    };

    let active_id = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        data.active_profile_id.clone().unwrap_or_default()
    };
    if let Some(details) = changes_str {
        crate::commands::history::log_activity(&state, &active_id, &mod_id, &name, "Modified", Some(details));
    } else {
        crate::commands::history::log_activity(&state, &active_id, &mod_id, &name, "Modified", None);
    }

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
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?.clone();
        let p = data.profiles.iter().find(|p| p.id == active_id).ok_or("Profil introuvable")?.clone();
        (p.mods_path.clone(), active_id)
    };

    // 1. Prune missing mods from the state for this profile
    let removed_count = {
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
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
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
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
            entry.content_id = derive_content_id(&path);

            discovered.push(entry);
        }
        Ok(discovered)
    }).await.map_err(|e| e.to_string())??;

    let added_count = added.len();
    if added_count > 0 {
        log_line(format!("[MOD] Scan discovered {} new mod(s)", added_count));
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
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
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
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

    let mut entry = ModEntry::new(final_name, target_dir);
    entry.content_id = derive_content_id(&entry.mod_folder_path);
    let result = entry.clone();
    {
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
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
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
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
            let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
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
            let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
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
                let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
                let mut new_mod = ModEntry::new(safe_name.clone(), target_dir.clone());
                new_mod.content_id = derive_content_id(&target_dir);
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
                    let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
                    let mut new_mod = ModEntry::new(safe_name.clone(), target_dir.clone());
                    new_mod.content_id = derive_content_id(&target_dir);
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
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
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
    let (mods_to_check, game_path) = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        let active_id = data.active_profile_id.as_ref().ok_or("Aucun profil actif")?;
        let p = data.profiles.iter().find(|p| &p.id == active_id).ok_or("Profil introuvable")?.clone();
        
        let mut check_list = Vec::new();
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
                check_list.push(m.clone());
            }
        }
        (check_list, p.game_path.clone())
    };

    let result = tauri::async_runtime::spawn_blocking(move || -> Result<(Vec<String>, Vec<String>), String> {
        let mut altered = Vec::new();
        let mut invalid_mod_ids = Vec::new();
        
        for m in mods_to_check {
            let mod_dir = &m.mod_folder_path;
            let game_dir = std::path::PathBuf::from(&game_path);
            let mut mod_has_issues = false;
            
            if let Some(hashes) = &m.file_hashes {
                // SHA256 Deep Scan for this mod
                for (rel_str, old_hash) in hashes {
                    let rel = std::path::PathBuf::from(rel_str);
                    let src = mod_dir.join(&rel);
                    let dst = game_dir.join(&rel);
                    
                    if !src.exists() {
                        altered.push(format!("[{}] {} (Manquant dans biblio)", m.name, rel.display()));
                        mod_has_issues = true;
                    } else if !dst.exists() {
                        altered.push(format!("[{}] {} (Manquant dans jeu)", m.name, rel.display()));
                        mod_has_issues = true;
                    } else {
                        if let Ok(new_hash) = crate::fs_utils::compute_file_sha256(&dst) {
                            if new_hash != *old_hash {
                                altered.push(format!("[{}] {} (Modifié/Corrompu)", m.name, rel.display()));
                                mod_has_issues = true;
                            }
                        } else {
                             mod_has_issues = true;
                        }
                    }
                }
                
                // Check for unexpected files in mod dir
                if let Ok(current_files) = crate::fs_utils::list_mod_files(mod_dir) {
                    for f in current_files {
                        let rel_str = f.to_string_lossy().to_string();
                        if !hashes.contains_key(&rel_str) {
                             altered.push(format!("[{}] {} (Fichier inattendu)", m.name, rel_str));
                             mod_has_issues = true;
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
                                    mod_has_issues = true;
                                }
                            },
                            _ => {
                                altered.push(format!("[{}] {} (Manquant)", m.name, rel.display()));
                                mod_has_issues = true;
                            }
                        }
                    }
                }
            }
            
            if mod_has_issues {
                invalid_mod_ids.push(m.id.clone());
            }
        }
        Ok((altered, invalid_mod_ids))
    }).await.map_err(|e| e.to_string())??;

    let (altered_list, invalid_ids) = result;

    // Update state with invalid flags
    {
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        for m in &mut data.mods {
            if invalid_ids.contains(&m.id) {
                m.file_hashes_invalid = Some(true);
            } else {
                // If we checked it and it had no issues, clear the flag
                // (Only for mods that were actually checked, i.e. enabled and in profile)
                // Wait, for simplicity, we only set it to true here. 
                // Setting to false is done by background worker after successful hashing.
            }
        }
    }

    log_line(format!("[INTEGRITY] Profile check complete: {} issue(s) found", altered_list.len()));
    Ok(altered_list)
}
#[tauri::command]
pub async fn toggle_all_mods(window: Window, state: State<'_, AppState>, enable: bool, bypass_sha: Option<bool>) -> Result<(), String> {
    crate::fs_utils::reset_mod_op_cancel();
    log_line(format!("[MOD] Toggle all mods: {}", if enable { "ENABLE" } else { "DISABLE" }));
    let mod_ids = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
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
        if crate::fs_utils::is_mod_op_cancelled() {
            log_line("[MOD] toggle_all_mods aborted by cancel flag");
            break;
        }
        // We have to re-prime per iteration because enable_mod/disable_mod
        // reset the cancel flag on entry.  Check before the call.
        if enable {
            let _ = enable_mod(window.clone(), state.clone(), id, bypass_sha).await;
        } else {
            let _ = disable_mod(window.clone(), state.clone(), id).await;
        }
        if crate::fs_utils::is_mod_op_cancelled() { break; }
    }
    Ok(())
}

#[tauri::command]
pub async fn disable_mods_for_profiles(_window: Window, state: State<'_, AppState>, profile_ids: Vec<String>) -> Result<(), String> {
    log_line(format!("[MOD] Bulk disabling mods for {} profile(s)", profile_ids.len()));
    
    // 1. Group mods by (game_path, backup_path) to minimize physical IO
    let mut tasks: HashMap<(PathBuf, PathBuf), HashSet<String>> = HashMap::new();

    {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        for p_id in &profile_ids {
            if let Some(p) = data.profiles.iter().find(|prof| &prof.id == p_id) {
                if p.active_mods.is_empty() { continue; }
                let key = (p.game_path.clone(), p.backup_path.clone());
                let entry = tasks.entry(key).or_default();
                for mid in &p.active_mods {
                    entry.insert(mid.clone());
                }
            }
        }
    }

    if tasks.is_empty() { 
        return Ok(()); 
    }

    let smart_io = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        data.settings.smart_io_enabled
    };

    for ((game_path, backup_path), mod_ids) in tasks {
        let game_path_limit = crate::commands::disk::get_limit_for_path(&state, &game_path);

        for mod_id in mod_ids {
            let (files_to_remove, other_active_mods) = {
                let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
                let m = match data.mods.iter().find(|m| m.id == mod_id) {
                    Some(m) => m.clone(),
                    None => continue,
                };
                
                let mut others = Vec::new();
                let mut seen_others = HashSet::new();
                
                for p in &data.profiles {
                    if p.game_path == game_path {
                        for mid in &p.active_mods {
                            if mid != &mod_id && !seen_others.contains(mid) {
                                if let Some(om) = data.mods.iter().find(|o| &o.id == mid) {
                                    others.push((om.id.clone(), om.mod_folder_path.clone()));
                                    seen_others.insert(mid.clone());
                                }
                            }
                        }
                    }
                }

                let mut unique_files = m.installed_files.clone();
                if let Ok(scanned) = fs_utils::list_mod_files(&m.mod_folder_path) {
                    for s in scanned { unique_files.push(s.to_string_lossy().to_string()); }
                }
                unique_files.sort();
                unique_files.dedup();
                
                (unique_files, others)
            };

            let gp = game_path.clone();
            let bp = backup_path.clone();
            
            let _ = tauri::async_runtime::spawn_blocking(move || {
                let _lock = MOD_OP_LOCK.lock().unwrap_or_else(|p| p.into_inner());
                fs_utils::unapply_mod_stacked(&gp, &bp, files_to_remove, &other_active_mods, game_path_limit, smart_io)
            }).await.map_err(|e| e.to_string())?;
        }
    }

    {
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        for p_id in &profile_ids {
            if let Some(p) = data.profiles.iter_mut().find(|prof| &prof.id == p_id) {
                p.active_mods.clear();
            }
        }
        
        let all_active_mod_ids: HashSet<String> = data.profiles.iter()
            .flat_map(|p| p.active_mods.iter().cloned())
            .collect();

        for m in data.mods.iter_mut() {
            if !all_active_mod_ids.contains(&m.id) {
                m.enabled = false;
                m.status = ModStatus::Disabled;
                m.installed_files.clear();
            }
        }
    }

    let _ = state.save();
    invalidate_cache(&state);
    Ok(())
}

#[tauri::command]
pub async fn check_conflicts(state: State<'_, AppState>, mod_id: String) -> Result<Vec<String>, String> {
    let (mod_folder, active_mods_data) = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
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
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        let m = data.mods.iter().find(|m| m.id == mod_id).ok_or("Mod introuvable")?;
        m.mod_folder_path.clone()
    };
    
    let files = fs_utils::list_mod_files(&mod_folder).map_err(|e| e.to_string())?;
    Ok(files.into_iter().map(|p| p.to_string_lossy().to_string()).collect())
}



#[tauri::command]
pub fn get_mod_conflicts(state: State<AppState>, mod_id: String) -> Result<Vec<ConflictReport>, String> {
    ensure_cache_populated(&state)?;
    
    let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
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
    let mut last_update = state.last_cache_update.lock().unwrap_or_else(|p| p.into_inner());
    *last_update = None; // Force re-population on next call
}

/// Aggressively trim in-memory caches to reclaim RAM during idle periods.
/// Frontend can call this when nav-switching away from heavy views.
#[tauri::command]
pub fn flush_mem_caches(state: State<AppState>) {
    log_line("[MEM] Flushing in-memory caches");
    {
        let mut cache = state.mod_files_cache.lock().unwrap_or_else(|p| p.into_inner());
        cache.clear();
        cache.shrink_to_fit();
    }
    {
        let mut index = state.conflict_index.lock().unwrap_or_else(|p| p.into_inner());
        index.clear();
        index.shrink_to_fit();
    }
    {
        let mut last_update = state.last_cache_update.lock().unwrap_or_else(|p| p.into_inner());
        *last_update = None;
    }
}

#[tauri::command]
pub fn get_conflict_file_tree(state: State<AppState>, mod_id: String, other_mod_id: String) -> Result<Vec<String>, String> {
    let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
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
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
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
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
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
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
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
            let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
            if let Some(m) = data.mods.iter_mut().find(|m| m.id == mod_id) {
                m.file_hashes = Some(new_hashes.clone());
                update_content_id_from_hashes(m);
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

    // Persist invalid status to ModEntry so UI can show the warning icon
    {
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(m) = data.mods.iter_mut().find(|m| m.id == mod_id) {
            m.file_hashes_invalid = Some(!is_valid);
        }
    }
    let _ = state.save();

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
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
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
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(m) = data.mods.iter_mut().find(|m| m.id == mod_id) {
            m.file_hashes = Some(new_hashes);
            update_content_id_from_hashes(m);
        }
    }

    let _ = state.save();
    Ok(())
}

#[tauri::command]
pub fn delete_mod_hashes(app_handle: tauri::AppHandle, state: State<AppState>, mod_id: String) -> Result<(), String> {
    {
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(m) = data.mods.iter_mut().find(|m| m.id == mod_id) {
            m.file_hashes = None;
            m.file_hashes_timestamp = None;
            m.file_hashes_invalid = None;
        }
    }
    let _ = state.save();
    
    // Emit event for UI update
    let _ = app_handle.emit_all("sha-status-changed", ShaStatusPayload {
        mod_id: mod_id,
        status: "missing".to_string(),
        is_manual: true,
    });
    
    Ok(())
}

#[tauri::command]
pub fn get_hashing_stats(state: State<AppState>, profile_id: Option<String>) -> Result<HashingStats, String> {
    let (total_mods, hashed_mods, missing_mods, invalid_mods, valid_mods, current_mod_name) = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        
        let target_mods = match profile_id {
            Some(pid) => {
                if let Some(profile) = data.profiles.iter().find(|p| p.id == pid) {
                    data.mods.iter().filter(|m| m.mod_folder_path.starts_with(&profile.mods_path)).collect::<Vec<_>>()
                } else {
                    data.mods.iter().collect::<Vec<_>>()
                }
            },
            None => data.mods.iter().collect::<Vec<_>>()
        };

        let total = target_mods.len();
        let mut hashed = 0;
        let mut missing = 0;
        let mut invalid = 0;
        let mut valid = 0;
        
        for m in target_mods {
            let is_missing = m.file_hashes.is_none() || m.file_hashes.as_ref().map_or(true, |h| h.is_empty());
            let is_invalid = m.file_hashes_invalid.unwrap_or(false);
            
            if is_missing {
                missing += 1;
            } else if is_invalid {
                invalid += 1;
                hashed += 1; // It has hashes, just invalid ones
            } else {
                valid += 1;
                hashed += 1; // Valid hashes
            }
        }
        
        let current_name = {
            let current_id_lock = state.current_sha_mod_id.lock().unwrap();
            if let Some(id) = &*current_id_lock {
                data.mods.iter().find(|m| &m.id == id).map(|m| m.name.clone())
            } else {
                None
            }
        };
        (total, hashed, missing, invalid, valid, current_name)
    };
    
    let queue_size = state.sha_queue.lock().unwrap_or_else(|p| p.into_inner()).len() + 
                     state.sha_queue_priority.lock().unwrap_or_else(|p| p.into_inner()).len();
    
    let is_active = state.sha_calculation_active.load(std::sync::atomic::Ordering::SeqCst);
    
    Ok(HashingStats {
        total_mods,
        hashed_mods,
        missing_mods,
        invalid_mods,
        valid_mods,
        queue_size,
        is_active,
        current_mod_name,
    })
}

#[tauri::command]
pub fn recalculate_all_hashes(state: State<'_, AppState>, profile_id: Option<String>, only_missing: bool) -> Result<(), String> {
    let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
    let mut queue = state.sha_queue.lock().unwrap_or_else(|p| p.into_inner());
    
    let mod_ids: Vec<String> = if let Some(pid) = profile_id {
        let profile = data.profiles.iter().find(|p| p.id == pid).ok_or("Profil introuvable")?;
        data.mods.iter()
            .filter(|m| m.mod_folder_path.starts_with(&profile.mods_path))
            .filter(|m| !only_missing || m.file_hashes.is_none() || m.file_hashes.as_ref().map_or(true, |h| h.is_empty()))
            .map(|m| m.id.clone())
            .collect()
    } else {
        data.mods.iter()
            .filter(|m| !only_missing || m.file_hashes.is_none() || m.file_hashes.as_ref().map_or(true, |h| h.is_empty()))
            .map(|m| m.id.clone())
            .collect()
    };
    
    for id in mod_ids {
        if !queue.contains(&id) {
            queue.push_back(id);
        }
    }
    
    Ok(())
}

pub fn populate_sha_queue(state: tauri::State<'_, AppState>) {
    let data_shared = state.data.clone();
    let sha_queue = state.sha_queue.clone();
    
    std::thread::spawn(move || {
        let (unhashed_mods, enabled) = {
            let data = data_shared.lock().unwrap_or_else(|p| p.into_inner());
            if !data.settings.enable_lazy_sha_calculation {
                return;
            }
            let mods = data.mods.iter()
                .filter(|m| {
                    let missing = m.file_hashes.is_none() || m.file_hashes.as_ref().map_or(true, |h| h.is_empty());
                    let invalid = m.file_hashes_invalid.unwrap_or(false);
                    missing && !invalid
                })
                .map(|m| m.id.clone())
                .collect::<Vec<String>>();
            (mods, data.settings.enable_lazy_sha_calculation)
        };

        if !enabled { return; }

        let unhashed_mods_to_add = {
            let queue = sha_queue.lock().unwrap_or_else(|p| p.into_inner());
            let existing_ids: std::collections::HashSet<String> = queue.iter().cloned().collect();
            unhashed_mods.into_iter()
                .filter(|id| !existing_ids.contains(id))
                .collect::<Vec<String>>()
        };

        if !unhashed_mods_to_add.is_empty() {
            let mut queue = sha_queue.lock().unwrap_or_else(|p| p.into_inner());
            let count = unhashed_mods_to_add.len();
            for id in unhashed_mods_to_add {
                queue.push_back(id);
            }
            crate::commands::crash::log_line(format!("[SHA-CALC] Background population done: added {} mods", count));
        }
    });
}

pub fn start_sha_calculation_background(app_handle: tauri::AppHandle) {
    let (sha_queue, sha_queue_priority, sha_calculation_active, current_sha_mod_id, data_shared, data_path) = {
        let state = app_handle.state::<AppState>();
        (
            state.sha_queue.clone(),
            state.sha_queue_priority.clone(),
            state.sha_calculation_active.clone(),
            state.current_sha_mod_id.clone(),
            state.data.clone(),
            state.data_path.clone(),
        )
    };
    
    std::thread::Builder::new()
        .name("bmm-sha-bg".into())
        .stack_size(512 * 1024)
        .spawn(move || {
        // Drop this thread's CPU + IO priority so SHA hashing never competes
        // with the UI thread for disk bandwidth or scheduler time.  Read-only
        // IO so we don't need a separate process — just lower priority.
        #[cfg(target_os = "windows")]
        unsafe {
            extern "system" {
                fn GetCurrentThread() -> *mut std::ffi::c_void;
                fn SetThreadPriority(h: *mut std::ffi::c_void, n: i32) -> i32;
            }
            // THREAD_MODE_BACKGROUND_BEGIN = 0x00010000
            // Drops both CPU and IO priority class for the calling thread.
            let _ = SetThreadPriority(GetCurrentThread(), 0x0001_0000);
        }
        log_line("[SHA-CALC] Background SHA calculation thread started (background priority)");

        // Initial delay to let the app settle at startup
        std::thread::sleep(std::time::Duration::from_secs(5));
        
        let mut processed_since_save = 0;
        
        loop {
            // Check if already running (redundant but safe)
            if sha_calculation_active.load(std::sync::atomic::Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(500));
                continue;
            }

            // Check if lazy calculation is disabled
            let (lazy_enabled, priority_empty) = {
                let data = data_shared.lock().unwrap_or_else(|p| p.into_inner());
                let priority_queue = sha_queue_priority.lock().unwrap_or_else(|p| p.into_inner());
                (data.settings.enable_lazy_sha_calculation, priority_queue.is_empty())
            };

            if !lazy_enabled && priority_empty {
                // If we have unsaved changes, save them before sleeping
                if processed_since_save > 0 {
                    let data_to_save = {
                        let data_lock = data_shared.lock().unwrap_or_else(|e| e.into_inner());
                        (*data_lock).clone()
                    };
                    if let Ok(json) = serde_json::to_string_pretty(&data_to_save) {
                        let _ = std::fs::write(&*data_path, json);
                        log_line("[SHA-CALC] Lazy disabled, saved final changes outside lock");
                    }
                    processed_since_save = 0;
                }
                std::thread::sleep(std::time::Duration::from_millis(1000));
                continue;
            }
            
            // Get next mod from priority queue or normal queue
            let id_opt = {
                let mut priority_queue = match sha_queue_priority.lock() {
                    Ok(g) => g,
                    Err(p) => p.into_inner(),
                };
                if let Some(id) = priority_queue.pop_front() {
                    Some((id, true))
                } else {
                    let mut normal_queue = match sha_queue.lock() {
                        Ok(g) => g,
                        Err(p) => p.into_inner(),
                    };
                    normal_queue.pop_front().map(|id| (id, false))
                }
            };
            
            if let Some((id, is_manual)) = id_opt {
                // Set current mod ID for stats (only for background worker)
                if !is_manual {
                    if let Ok(mut current_id_lock) = current_sha_mod_id.lock() {
                        *current_id_lock = Some(id.clone());
                    }
                }
                
                sha_calculation_active.store(true, std::sync::atomic::Ordering::SeqCst);
                
                process_single_mod_hashing(&id, is_manual, &app_handle, &data_shared, &data_path);
                
                if !is_manual {
                    processed_since_save += 1;
                    if processed_since_save >= 10 {
                         let data_to_save = {
                            let data_lock = data_shared.lock().unwrap_or_else(|e| e.into_inner());
                            (*data_lock).clone()
                        };
                        if let Ok(json) = serde_json::to_string_pretty(&data_to_save) {
                            let _ = std::fs::write(&*data_path, json);
                        }
                        processed_since_save = 0;
                    }
                }

                sha_calculation_active.store(false, std::sync::atomic::Ordering::SeqCst);
                
                if !is_manual {
                    if let Ok(mut current_id_lock) = current_sha_mod_id.lock() {
                        *current_id_lock = None;
                    }
                }
                
                // Throttle: wait between mods to avoid CPU/disk saturation
                std::thread::sleep(std::time::Duration::from_millis(500));
            } else {
                // No mods in queue, save if we have pending changes
                if processed_since_save > 0 {
                    let data_to_save = {
                        let data_lock = data_shared.lock().unwrap_or_else(|e| e.into_inner());
                        (*data_lock).clone()
                    };
                    if let Ok(json) = serde_json::to_string_pretty(&data_to_save) {
                        let _ = std::fs::write(&*data_path, json);
                        log_line(format!("[SHA-CALC] Queue empty, saved pending {} mods outside lock", processed_since_save));
                    }
                    processed_since_save = 0;
                }
                // No mods in queue, sleep longer
                std::thread::sleep(std::time::Duration::from_millis(1000));
            }
        }
    }).expect("Failed to spawn SHA background thread");
}

pub fn add_mod_to_priority_sha_queue(state: tauri::State<'_, AppState>, mod_id: String) {
    // Only add if lazy calculation is enabled OR if it's a manual action (this function is usually called on auto-activation)
    {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        if !data.settings.enable_lazy_sha_calculation {
            return;
        }
    }

    let mut priority_queue = state.sha_queue_priority.lock().unwrap_or_else(|p| p.into_inner());
    
    // Check if mod already needs hashing
    let needs_hash = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        data.mods.iter().find(|m| m.id == mod_id)
            .map_or(false, |m| {
                let missing = m.file_hashes.is_none() || m.file_hashes.as_ref().map_or(true, |h| h.is_empty());
                let invalid = m.file_hashes_invalid.unwrap_or(false);
                missing && !invalid
            })
    };
    
    if needs_hash {
        // Remove from normal queue if present
        {
            let mut normal_queue = state.sha_queue.lock().unwrap_or_else(|p| p.into_inner());
            normal_queue.retain(|id| id != &mod_id);
        }
        
        // Add to priority queue
        priority_queue.push_back(mod_id.clone());
        log_line(format!("[SHA-CALC] Added mod {} to priority SHA queue", mod_id));
    }
}

fn process_single_mod_hashing(
    id: &str,
    is_manual: bool,
    app_handle: &tauri::AppHandle,
    data_shared: &std::sync::Arc<std::sync::Mutex<crate::state::AppData>>,
    data_path: &std::path::PathBuf,
) {
    let _ = app_handle.emit_all("sha-status-changed", ShaStatusPayload {
        mod_id: id.to_string(),
        status: "calculating".to_string(),
        is_manual,
    });
    
    log_line(format!("[SHA-CALC] Calculating hashes for mod: {} (manual: {})", id, is_manual));
    
    // Get mod path from managed state
    let mod_path_opt = {
        let data_lock = data_shared.lock().unwrap_or_else(|e| e.into_inner());
        data_lock.mods.iter().find(|m| m.id == id).map(|m| m.mod_folder_path.clone())
    };
    
    if let Some(mod_path) = mod_path_opt {
        if let Ok(current_files) = fs_utils::list_mod_files(&mod_path) {
            let mut tracker = crate::commands::resource_tracker::OpTracker::start("SHA/compute")
                .with_subject(id);
            let mut new_hashes = std::collections::HashMap::new();
            let mut calculated = 0;
            let mut bytes_total: u64 = 0;

            for f in current_files {
                let full_path = mod_path.join(&f);
                if let Ok(meta) = std::fs::metadata(&full_path) {
                    bytes_total += meta.len();
                }
                if let Ok(hash) = fs_utils::compute_file_sha256(&full_path) {
                    new_hashes.insert(f.to_string_lossy().to_string(), hash);
                    calculated += 1;
                }

                // Yield occasionally if mod is huge
                if calculated % 50 == 0 {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
            }
            tracker.set("files", calculated as u64);
            tracker.set("bytes_read", bytes_total);
            tracker.finish();

            let timestamp = chrono::Local::now().to_rfc3339();
            
            // Update managed state
            let data_to_save = {
                let mut data_lock = data_shared.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(m) = data_lock.mods.iter_mut().find(|m| m.id == id) {
                    m.file_hashes = Some(new_hashes);
                    m.file_hashes_timestamp = Some(timestamp);
                    m.file_hashes_invalid = Some(false);
                    update_content_id_from_hashes(m);
                }
                
                if is_manual {
                    Some((*data_lock).clone())
                } else {
                    None
                }
            };
            
            // Perform the slow serialization and I/O outside the lock!
            if let Some(data) = data_to_save {
                if let Ok(json) = serde_json::to_string_pretty(&data) {
                    let _ = std::fs::write(data_path, json);
                    log_line(format!("[SHA-CALC] Saved manual hash for mod {}", id));
                }
            }
            
            log_line(format!("[SHA-CALC] Completed mod {} ({} files)", id, calculated));
        } else {
            log_line(format!("[SHA-CALC] Failed to list mod files for mod: {}", id));
        }
    }
    
    let _ = app_handle.emit_all("sha-status-changed", ShaStatusPayload {
        mod_id: id.to_string(),
        status: "done".to_string(),
        is_manual,
    });
}

#[tauri::command]
pub fn recalculate_mod_sha(app_handle: tauri::AppHandle, state: tauri::State<'_, AppState>, mod_id: String) -> Result<(), String> {
    // 1. Remove from all queues first
    {
        let mut priority_queue = state.sha_queue_priority.lock().unwrap_or_else(|p| p.into_inner());
        priority_queue.retain(|id| id != &mod_id);
    }
    {
        let mut normal_queue = state.sha_queue.lock().unwrap_or_else(|p| p.into_inner());
        normal_queue.retain(|id| id != &mod_id);
    }
    
    // 2. Check if mod is ALREADY being hashed by background worker
    {
        let current_id_lock = state.current_sha_mod_id.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(current_id) = &*current_id_lock {
            if current_id == &mod_id {
                log_line(format!("[SHA-CALC] Mod {} is already being hashed by background worker, ignoring manual request", mod_id));
                return Ok(());
            }
        }
    }

    // 3. Spawn a direct thread for parallel manual calculation
    let data_shared = state.data.clone();
    let data_path = state.data_path.clone();
    
    crate::commands::crash::log_line(format!("[SHA-CALC] Manually triggered PARALLEL hash calculation for mod {}", mod_id));

    std::thread::spawn(move || {
        process_single_mod_hashing(&mod_id, true, &app_handle, &data_shared, &data_path);
    });
    
    Ok(())
}

#[tauri::command]
pub fn trigger_sha_background_population(state: tauri::State<'_, AppState>) {
    populate_sha_queue(state);
}

/// Background worker that lazily fills `content_id` for mods that still have `None`.
/// Processes one mod at a time with a 200ms pause between each to stay non-intrusive.
pub fn start_content_id_background(app_handle: tauri::AppHandle) {
    let data_shared = app_handle.state::<AppState>().data.clone();
    let data_path   = app_handle.state::<AppState>().data_path.clone();

    std::thread::Builder::new()
        .name("bmm-content-id-bg".into())
        .stack_size(512 * 1024)
        .spawn(move || {
        #[cfg(target_os = "windows")]
        unsafe {
            extern "system" {
                fn GetCurrentThread() -> *mut std::ffi::c_void;
                fn SetThreadPriority(h: *mut std::ffi::c_void, n: i32) -> i32;
            }
            let _ = SetThreadPriority(GetCurrentThread(), 0x0001_0000); // THREAD_MODE_BACKGROUND_BEGIN
        }
        log_line("[CONTENT-ID] Background fill thread started (background priority)");
        // Let the app fully settle before starting
        std::thread::sleep(std::time::Duration::from_secs(8));

        loop {
            // Find one mod that needs a content_id (lock held briefly, read-only)
            let target = {
                let data = data_shared.lock().unwrap_or_else(|p| p.into_inner());
                data.mods.iter()
                    .find(|m| m.content_id.is_none() && m.mod_folder_path.exists())
                    .map(|m| (m.id.clone(), m.mod_folder_path.clone()))
            };

            match target {
                None => {
                    // Nothing left to fill — check again in 60s in case new mods were added
                    std::thread::sleep(std::time::Duration::from_secs(60));
                }
                Some((id, folder_path)) => {
                    // Compute outside the lock (file walk, no content reads)
                    let cid = crate::models::mod_entry::derive_content_id(&folder_path);

                    // Write back, lock held only for the map update
                    {
                        let mut data = data_shared.lock().unwrap_or_else(|p| p.into_inner());
                        if let Some(m) = data.mods.iter_mut().find(|m| m.id == id) {
                            m.content_id = cid;
                        }
                    }

                    // Save outside the lock
                    {
                        let data = data_shared.lock().unwrap_or_else(|p| p.into_inner());
                        if let Ok(json) = serde_json::to_string_pretty(&*data) {
                            let _ = std::fs::write(&*data_path, json);
                        }
                    }

                    log_line(format!("[CONTENT-ID] Filled content_id for mod {}", id));
                    // Lazy: 200ms between each mod
                    std::thread::sleep(std::time::Duration::from_millis(200));
                }
            }
        }
    }).expect("Failed to spawn content-id background thread");
}
