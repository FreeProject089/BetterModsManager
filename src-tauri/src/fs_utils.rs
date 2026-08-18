use tauri::Manager;
use anyhow::{Context, Result, anyhow};
use std::path::{Path, PathBuf};
use jwalk::WalkDir;
use std::fs;
use rayon::prelude::*;
use std::collections::HashSet;
use std::io::Read;
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use serde::{Serialize, Deserialize};

// ─────────────────────────────────────────────────────────────────────────────
// Multi-process worker IPC
// ─────────────────────────────────────────────────────────────────────────────
// To keep the BMM UI responsive when applying / unapplying big mods on the
// OS drive, the heavy file IO is delegated to a separate worker process
// (re-execs the same exe with `--mod-worker IN OUT`).  The worker runs with
// Windows BACKGROUND IO priority, so the kernel keeps disk bandwidth
// available for the UI process.  Cancelling is a `taskkill /T` of the
// worker PID — instant and reliable, no matter how stuck the IO is.
#[derive(Serialize, Deserialize, Debug)]
pub struct WorkerInput {
    pub op: String, // "apply" | "unapply"
    pub mod_folder: PathBuf,
    pub game_path: PathBuf,
    pub backup_path: PathBuf,
    pub other_mods_files: Vec<PathBuf>,
    pub files_to_remove: Vec<String>,
    pub other_active_mods: Vec<(String, PathBuf)>,
    pub game_path_limit: Option<u64>,
    pub backup_path_limit: Option<u64>,
    pub smart_io: bool,
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct WorkerOutput {
    pub applied: Vec<PathBuf>,
    pub error: Option<String>,
}

/// Global cancellation flag for active mod-apply / mod-unapply IO operations.
/// Polled inside the chunked copy loops and parallel iterators so that the
/// user's cancel click can interrupt big mod copies almost instantly instead
/// of waiting for the whole file to finish.
pub static MOD_OP_CANCELLED: AtomicBool = AtomicBool::new(false);

#[inline]
pub fn is_mod_op_cancelled() -> bool {
    MOD_OP_CANCELLED.load(Ordering::Relaxed)
}

#[inline]
pub fn reset_mod_op_cancel() {
    MOD_OP_CANCELLED.store(false, Ordering::Relaxed);
}

#[inline]
pub fn request_mod_op_cancel() {
    MOD_OP_CANCELLED.store(true, Ordering::Relaxed);
}

/// Entry point used by the worker subprocess.  Reads its input JSON,
/// performs the apply/unapply, writes the output JSON, returns an exit code
/// (0 = ok, non-zero = error or cancelled).
pub fn run_mod_worker(input_path: &str, output_path: &str) -> i32 {
    // Drop our priority class so the OS gives the BMM UI process headroom.
    #[cfg(target_os = "windows")]
    unsafe {
        extern "system" {
            fn GetCurrentProcess() -> *mut std::ffi::c_void;
            fn SetPriorityClass(h: *mut std::ffi::c_void, class: u32) -> i32;
        }
        // PROCESS_MODE_BACKGROUND_BEGIN — also lowers IO + paging priority.
        let _ = SetPriorityClass(GetCurrentProcess(), 0x0010_0000);
    }

    let input_str = match std::fs::read_to_string(input_path) {
        Ok(s) => s,
        Err(e) => { eprintln!("worker: read input failed: {}", e); return 2; }
    };
    let input: WorkerInput = match serde_json::from_str(&input_str) {
        Ok(v) => v,
        Err(e) => { eprintln!("worker: parse input failed: {}", e); return 2; }
    };

    let result = match input.op.as_str() {
        "apply" => {
            let other: HashSet<PathBuf> = input.other_mods_files.into_iter().collect();
            apply_mod_stacked(
                &input.mod_folder,
                &input.game_path,
                &input.backup_path,
                &other,
                input.game_path_limit,
                input.backup_path_limit,
                input.smart_io,
            )
        }
        "unapply" => unapply_mod_stacked(
            &input.game_path,
            &input.backup_path,
            input.files_to_remove,
            &input.other_active_mods,
            input.game_path_limit,
            input.smart_io,
        )
        .map(|_| Vec::<PathBuf>::new()),
        _ => {
            eprintln!("worker: unknown op '{}'", input.op);
            return 2;
        }
    };

    let (output, code) = match result {
        Ok(applied) => (WorkerOutput { applied, error: None }, 0),
        Err(e) => {
            let msg = e.to_string();
            let code = if msg.contains("CANCELLED") { 3 } else { 1 };
            (WorkerOutput { applied: vec![], error: Some(msg) }, code)
        }
    };
    if let Ok(json) = serde_json::to_string(&output) {
        let _ = std::fs::write(output_path, json);
    }
    code
}

/// Returns true if `path` lives on the same drive as the OS (typically C:).
/// Used to dial parallel IO down to a single thread so Windows itself stays
/// responsive during big mod copies.
pub fn is_on_system_drive(path: &Path) -> bool {
    #[cfg(target_os = "windows")]
    {
        if let Ok(sys) = std::env::var("SystemDrive") {
            let p = path.to_string_lossy().to_lowercase();
            let s = sys.to_lowercase();
            // "c:" prefix match (drive letter + colon)
            if !s.is_empty() && p.starts_with(&s) {
                return true;
            }
        }
    }
    let _ = path;
    false
}

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

/// Smart I/O variant.  When `smart_io` is true, inserts a tiny yield every
/// few chunks so the OS scheduler can service the UI thread (prevents the
/// "Ne répond pas" freeze on big mods).
pub fn copy_file_force_smart(src: &Path, dst: &Path, limit_mb_s: Option<u64>, smart_io: bool) -> Result<()> {
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    // ensure_removed() already no-ops if dst doesn't exist, so skip the extra stat call.
    let _ = ensure_removed(dst); // Clear permissions and delete if possible before overwrite

    // ── Path 1: explicit MB/s throttle (already paces itself, just honor it) ──
    if let Some(limit) = limit_mb_s {
        if limit > 0 {
            use std::io::{Read, Write};
            let mut src_file = std::fs::File::open(src).with_context(|| format!("Failed to open src: {:?}", src))?;
            let mut dst_file = std::fs::File::create(dst).with_context(|| format!("Failed to create dst: {:?}", dst))?;

            let chunk_size: usize = 128 * 1024; // 128 KB buffer for smoother limiting
            let mut buffer = vec![0u8; chunk_size];

            loop {
                if is_mod_op_cancelled() {
                    drop(dst_file);
                    let _ = std::fs::remove_file(dst);
                    return Err(anyhow!("CANCELLED"));
                }
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

    // ── Path 2: Smart I/O — chunked copy with periodic micro-yields ──────────
    // This keeps disk/CPU at very high throughput while leaving small gaps
    // for the WebView2 message pump and other OS scheduling.
    if smart_io {
        use std::io::{Read, Write};
        let mut src_file = std::fs::File::open(src).with_context(|| format!("Failed to open src: {:?}", src))?;
        let mut dst_file = std::fs::File::create(dst).with_context(|| format!("Failed to create dst: {:?}", dst))?;

        // 1 MiB chunks (fewer read/write syscalls → closer to full-speed copy),
        // and yield on a ~16 MiB *byte budget* rather than every chunk. The old
        // 256 KB + per-chunk sleep cost ~37% vs full speed; budgeting the yield
        // keeps the UI responsive while recovering most of that throughput.
        let chunk_size: usize = 1 << 20; // 1 MiB
        let mut buffer = vec![0u8; chunk_size];
        let mut bytes_since_yield: u64 = 0;
        const YIELD_EVERY: u64 = 16 << 20; // 16 MiB

        loop {
            if is_mod_op_cancelled() {
                drop(dst_file);
                let _ = std::fs::remove_file(dst);
                return Err(anyhow!("CANCELLED"));
            }
            let bytes_read = src_file.read(&mut buffer)?;
            if bytes_read == 0 { break; }
            dst_file.write_all(&buffer[..bytes_read])?;

            bytes_since_yield += bytes_read as u64;
            if bytes_since_yield >= YIELD_EVERY {
                std::thread::sleep(std::time::Duration::from_micros(150));
                bytes_since_yield = 0;
            }
        }
        return Ok(());
    }

    // ── Path 3: full-speed std::fs::copy (Smart I/O off, no MB/s limit) ──────
    if is_mod_op_cancelled() { return Err(anyhow!("CANCELLED")); }
    std::fs::copy(src, dst)
        .with_context(|| format!("Failed to copy {:?} -> {:?}", src, dst))?;
    Ok(())
}

pub fn compute_file_sha256(path: &Path) -> Result<String> {
    // 1 MB buffered reads — far fewer read syscalls than 64 KB on large mod files
    // (e.g. ~1k vs ~16k for a 1 GB file), which speeds up integrity hashing.
    use std::io::BufReader;
    let file = std::fs::File::open(path)?;
    let mut reader = BufReader::with_capacity(1 << 20, file);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let n = reader.read(&mut buffer)?;
        if n == 0 { break; }
        hasher.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

// ── Local content hashing (BLAKE3, versioned format) ──────────────────────────
// `file_hashes` and modpack hash-match values use BLAKE3, tagged `b3:` so the
// algorithm is self-describing. BLAKE3 is a *tree* hash, so one very large file is
// hashed across all cores (mmap + rayon) — the fix for mods dominated by a single
// big file, where file-level parallelism can't help. Untagged digests are treated
// as legacy SHA-256 so old baselines/modpacks still verify (dual-read).

/// Compute a tagged BLAKE3 digest (`b3:<hex>`) for a file, parallel within the file.
/// A SIZE-CAPPED thread pool used for ALL mod hashing. BLAKE3 is so fast it will
/// otherwise saturate every core (rayon defaults to all CPUs) and freeze the UI
/// while importing/scanning many mods. We cap it to ~half the cores (max 4) so
/// hashing always leaves headroom for the UI thread.
pub(crate) fn hash_pool() -> &'static rayon::ThreadPool {
    use std::sync::OnceLock;
    static POOL: OnceLock<rayon::ThreadPool> = OnceLock::new();
    POOL.get_or_init(|| {
        let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
        let threads = (cores / 2).clamp(1, 4);
        rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .thread_name(|i| format!("bmm-hash-{}", i))
            .build()
            .unwrap_or_else(|_| rayon::ThreadPoolBuilder::new().num_threads(1).build().expect("hash pool"))
    })
}

pub fn compute_file_hash(path: &Path) -> Result<String> {
    let mut hasher = blake3::Hasher::new();
    // Sequential mmap (NOT update_mmap_rayon): per-file work stays on a single
    // pool thread so a big file can't grab every core. Parallelism comes from the
    // bounded pool processing several files at once.
    hasher.update_mmap(path)
        .with_context(|| format!("Failed to hash: {:?}", path))?;
    Ok(format!("b3:{}", hasher.finalize().to_hex()))
}

/// Bulk version: parallel ACROSS files on the bounded hash pool (capped cores),
/// keeping the machine responsive even while hashing a freshly imported profile.
pub fn compute_file_hash_bulk<K: Clone + Send + Sync>(items: &[(K, PathBuf)]) -> Vec<(K, String)> {
    use rayon::prelude::*;
    hash_pool().install(|| {
        items
            .par_iter()
            .filter_map(|(k, p)| compute_file_hash(p).ok().map(|h| (k.clone(), h)))
            .collect()
    })
}

/// True if `path` matches a previously stored digest, using whatever algorithm the
/// stored digest declares: `b3:`-tagged → BLAKE3, otherwise legacy SHA-256.
pub fn file_matches_hash(path: &Path, stored: &str) -> bool {
    if let Some(hex) = stored.strip_prefix("b3:") {
        compute_file_hash(path)
            .map(|h| h.strip_prefix("b3:").map(|x| x == hex).unwrap_or(false))
            .unwrap_or(false)
    } else {
        compute_file_sha256(path).map(|h| h == stored).unwrap_or(false)
    }
}

/// Backup a file from `game_path/rel` to `backup_root/_original/rel`.
/// Only if it's NOT provided by another active mod.
pub fn backup_original_file(
    game_path: &Path,
    rel: &Path,
    profile_backup_root: &Path,
    other_mods_files: &HashSet<PathBuf>,
    backup_path_limit: Option<u64>,
    smart_io: bool,
) -> Result<()> {
    let src = game_path.join(rel);
    let dst = profile_backup_root.join("_original").join(rel);

    // If it's already backed up, we're good
    if dst.exists() { return Ok(()); }
    if !src.exists() { return Ok(()); }

    // CRITICAL: Check if the current file in game dir is actually from another mod
    if other_mods_files.contains(rel) {
        // This is a mod file, NOT a game original. Don't backup.
        return Ok(());
    }

    // It's a real game file! Secure it.
    copy_file_force_smart(&src, &dst, backup_path_limit, smart_io)
        .with_context(|| format!("Failed to backup original file: {:?}", rel))?;

    Ok(())
}

/// Run a closure with rayon's parallelism capped.  When Smart I/O is on we
/// cap to 2 threads so file copies never saturate every CPU core (which is
/// what causes the "Ne répond pas" UI freeze).  When off, default rayon
/// pool (= all cores) is used.
#[allow(dead_code)]
fn run_with_smart_pool<F, R>(smart_io: bool, f: F) -> R
where
    F: FnOnce() -> R + Send,
    R: Send,
{
    run_with_smart_pool_threads(smart_io, 2, f)
}

/// Variant that lets the caller pick the worker count.  When `smart_io` is
/// off we still go full-speed.  When on, we use the explicit `threads`
/// count — callers pass 1 when copying to the OS drive so Windows itself
/// stays responsive.
fn run_with_smart_pool_threads<F, R>(smart_io: bool, threads: usize, f: F) -> R
where
    F: FnOnce() -> R + Send,
    R: Send,
{
    if !smart_io {
        return f();
    }
    let n = threads.max(1);
    match rayon::ThreadPoolBuilder::new().num_threads(n).build() {
        Ok(pool) => pool.install(f),
        Err(_)   => f(),
    }
}


/// Get all file paths (relative) inside a mod, recursively.
///
/// A mod is a FOLDER or an ARCHIVE, and this answers for both. It used to answer only for
/// folders: handed a `.zip`, WalkDir yields the zip itself, `strip_prefix` reduces it to an
/// empty path, and the caller receives a list of one nothing.
///
/// That was not a cosmetic difference. `disable_mod` builds what to delete from
/// `installed_files` UNION this list, so "Disable all" left an archived mod's files sitting
/// in the game folder while marking the mod off — the thing that gets reported as "disable
/// all does not disable archived mods". Conflict detection compares two of these lists, so
/// an archived mod also silently conflicted with nothing, ever.
///
/// The entries are read from the archive's index — nothing is extracted here. Callers that
/// need real bytes go through `archive::mod_read_root` and get a directory; callers that need
/// the file list get the same answer for both shapes, which is the point.
pub fn list_mod_files(mod_folder: &Path) -> Result<Vec<PathBuf>> {
    if crate::archive::is_archive(mod_folder) {
        return Ok(crate::archive::archive_entries(mod_folder)?
            .into_iter()
            .map(|(rel, _)| PathBuf::from(rel))
            .collect());
    }
    let mut files = Vec::new();
    for entry in WalkDir::new(mod_folder)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let rel = path
            .strip_prefix(mod_folder)
            .unwrap_or(&path)
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
    other_mods_files: &HashSet<PathBuf>,
    game_path_limit: Option<u64>,
    backup_path_limit: Option<u64>,
    smart_io: bool,
) -> Result<Vec<PathBuf>> {
    let files = list_mod_files(mod_folder)?;

    // If the game dir (or backup dir) sits on the OS drive, force serial IO
    // so Windows + the BMM window itself never freeze.
    let on_sys = is_on_system_drive(game_path) || is_on_system_drive(profile_backup_root);
    let threads = if on_sys { 1 } else { 2 };

    let result: Result<()> = run_with_smart_pool_threads(smart_io || on_sys, threads, || {
        files.par_iter().try_for_each(|rel| {
            if is_mod_op_cancelled() { return Err(anyhow!("CANCELLED")); }
            // Backup original if it's the first time BMM touches this file in this profile
            let _ = backup_original_file(game_path, rel, profile_backup_root, &other_mods_files, backup_path_limit, smart_io);

            // Copy mod file to game dir (force overwrite)
            let src = mod_folder.join(rel);
            let dst = game_path.join(rel);
            copy_file_force_smart(&src, &dst, game_path_limit, smart_io)
        })
    });
    result?;

    Ok(files)
}

/// Strip Windows UNC prefix (\\?\) or (\??\) if present, and normalize to common format
#[allow(dead_code)]
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
///
/// `other_active_mods` must be in **activation order**, the same order deployment walks.
/// Deployment is last-wins — a later mod overwrites an earlier one on any shared path — so
/// the file actually visible in the game comes from the LAST mod in this list that has it,
/// and that is the one to fall back to.
///
/// This used to scan forward and take the first match, which restored the oldest mod's copy:
/// a version that had been overwritten and that the player had never seen. Stack three mods
/// on one file, disable the top one, and the game silently dropped two layers instead of one.
/// The loop below claimed "starting from most recent" while doing the opposite.
pub fn unapply_mod_stacked(
    game_path: &Path,
    profile_backup_root: &Path,
    files_to_remove: Vec<String>,
    other_active_mods: &[(String, PathBuf)],
    game_path_limit: Option<u64>,
    smart_io: bool,
) -> Result<()> {

    // Parallelize restoration/removal (bounded pool when Smart I/O is on,
    // or single-threaded when the target lives on the OS drive).
    let on_sys = is_on_system_drive(game_path) || is_on_system_drive(profile_backup_root);
    let threads = if on_sys { 1 } else { 2 };
    let result: Result<()> = run_with_smart_pool_threads(smart_io || on_sys, threads, || {
        files_to_remove.par_iter().try_for_each(|rel_str| {
            if is_mod_op_cancelled() { return Err(anyhow!("CANCELLED")); }
            let rel = PathBuf::from(rel_str);
            let dst_path = game_path.join(&rel);

            let mut restored = false;
            // 1. Fall back to the last-enabled mod that still provides this file, mirroring
            //    the last-wins deployment rule.
            for (_, mod_folder) in other_active_mods.iter().rev() {
                let mod_src = mod_folder.join(&rel);
                if mod_src.metadata().map(|m| m.is_file()).unwrap_or(false) {
                    copy_file_force_smart(&mod_src, &dst_path, game_path_limit, smart_io)?;
                    restored = true;
                    break;
                }
            }

            // 2. If no other mod has it, restore original or DELETE
            if !restored {
                let original_src = profile_backup_root.join("_original").join(&rel);
                if original_src.exists() {
                    copy_file_force_smart(&original_src, &dst_path, game_path_limit, smart_io)?;
                    // Space optimization: remove the backup file as it has been safely restored
                    let _ = ensure_removed(&original_src);
                } else {
                    // File was added by mod and no original exists — DELETE IT
                    let _ = ensure_removed(&dst_path);
                }
            }
            Ok::<(), anyhow::Error>(())
        })
    });
    result?;

    // Cleanup of now-empty directories. Collect the UNIQUE relative ancestor dirs
    // of every removed file once (instead of re-walking + canonicalizing per file),
    // then try to remove them deepest-first. `fs::remove_dir` only removes EMPTY
    // dirs (errors → no-op on non-empty), so this can never delete data, and the
    // paths are relative to game_path so they can never escape it.
    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();
    for rel_str in &files_to_remove {
        let mut cur = PathBuf::from(rel_str);
        while let Some(parent) = cur.parent().map(|p| p.to_path_buf()) {
            if parent.as_os_str().is_empty() { break; }
            if seen.insert(parent.clone()) { dirs.push(parent.clone()); }
            cur = parent;
        }
    }
    // Deepest first → children are emptied before their parents are reconsidered.
    dirs.sort_by(|a, b| b.components().count().cmp(&a.components().count()));
    for d in dirs {
        let _ = fs::remove_dir(game_path.join(&d));
    }

    // Sequential cleanup of empty backup directories
    let original_dir = profile_backup_root.join("_original");
    if original_dir.exists() {
        let _ = remove_empty_dirs(&original_dir);
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

pub fn resolve_path(app_handle: &tauri::AppHandle, path: &str) -> Option<std::path::PathBuf> {
    // 1. Production: Try multiple patterns via Tauri resolve_resource
    let candidates = [
        path.to_string(), // As requested (e.g. "Lang/en.json")
        format!("_up_/{}", path), // Bundled relative parent (e.g. "_up_/app.cfg")
        format!("_up_/frontend/{}", path), // Bundled relative sibling (e.g. "_up_/frontend/Lang/en.json")
        path.split('/').next_back().unwrap_or(path).to_string(), // Flattened (e.g. "en.json")
        format!("frontend/{}", path), // Deep (e.g. "frontend/Lang/en.json")
    ];

    for candidate in &candidates {
        if let Some(p) = app_handle.path().resolve(candidate, tauri::path::BaseDirectory::Resource).ok() {
            if p.exists() {
                return Some(p);
            }
        }
    }

    // 2. Development: Try climbing up from resource_dir
    if let Some(mut p) = app_handle.path().resource_dir().ok() {
        for _ in 0..5 {
            let check = p.join(path);
            if check.exists() {
                return Some(check);
            }
            // Also check frontend/path if we are at root
            let check_frontend = p.join("frontend").join(path);
            if check_frontend.exists() {
                return Some(check_frontend);
            }
            if !p.pop() { break; }
        }
    }
    
    // 3. Last resort: Direct path from current working directory
    let direct = std::path::PathBuf::from(path);
    if direct.exists() {
        return Some(direct);
    }

    None
}

pub fn get_lang_dir(app_handle: &tauri::AppHandle) -> std::path::PathBuf {
    if let Some(path) = resolve_path(app_handle, "Lang/en.json") {
        if let Some(parent) = path.parent() {
            return parent.to_path_buf();
        }
    }
    
    let path = app_handle
        .path()
        .resource_dir().ok()
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    let mut current = path.clone();
    for _ in 0..5 {
        let check_prod = current.join("Lang");
        if check_prod.exists() && check_prod.is_dir() { return check_prod; }
        
        let check_dev = current.join("frontend").join("Lang");
        if check_dev.exists() && check_dev.is_dir() { return check_dev; }
        
        if !current.pop() { break; }
    }

    path.join("Lang")
}

#[cfg(test)]
mod unapply_stacked_tests {
    use super::unapply_mod_stacked;
    use std::fs;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("bmm_unapply_{}", name));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    /// Three mods enabled in order, all shipping `Data/tex.dds`. Deployment is last-wins, so
    /// the game holds C's copy. Disabling C must reveal B — the layer directly underneath —
    /// not A, which nobody has seen since B was enabled.
    #[test]
    fn disabling_the_top_mod_reveals_the_one_directly_underneath() {
        let root = scratch("layers");
        let game = root.join("game");
        let backup = root.join("backup");
        fs::create_dir_all(game.join("Data")).unwrap();
        fs::create_dir_all(backup.join("_original/Data")).unwrap();
        fs::write(backup.join("_original/Data/tex.dds"), b"vanilla").unwrap();

        let mut actives = Vec::new();
        for (id, body) in [("a", b"AAA"), ("b", b"BBB")] {
            let dir = root.join(id);
            fs::create_dir_all(dir.join("Data")).unwrap();
            fs::write(dir.join("Data/tex.dds"), body).unwrap();
            actives.push((id.to_string(), dir));
        }
        // C is the one being disabled; its copy is what the game currently holds.
        fs::write(game.join("Data/tex.dds"), b"CCC").unwrap();

        unapply_mod_stacked(
            &game, &backup,
            vec!["Data/tex.dds".to_string()],
            &actives,          // activation order: a, then b
            None, false,
        ).unwrap();

        assert_eq!(
            fs::read(game.join("Data/tex.dds")).unwrap(), b"BBB",
            "must fall back to the LAST still-enabled mod, not the first",
        );
    }

    #[test]
    fn with_no_other_mod_the_vanilla_file_comes_back_and_the_backup_is_freed() {
        let root = scratch("vanilla");
        let game = root.join("game");
        let backup = root.join("backup");
        fs::create_dir_all(game.join("Data")).unwrap();
        fs::create_dir_all(backup.join("_original/Data")).unwrap();
        fs::write(backup.join("_original/Data/tex.dds"), b"vanilla").unwrap();
        fs::write(game.join("Data/tex.dds"), b"modded").unwrap();

        unapply_mod_stacked(
            &game, &backup, vec!["Data/tex.dds".to_string()], &[], None, false,
        ).unwrap();

        assert_eq!(fs::read(game.join("Data/tex.dds")).unwrap(), b"vanilla");
        assert!(!backup.join("_original/Data/tex.dds").exists(), "backup should be reclaimed");
    }

    #[test]
    fn a_file_the_game_never_had_is_deleted() {
        let root = scratch("added");
        let game = root.join("game");
        let backup = root.join("backup");
        fs::create_dir_all(game.join("Data")).unwrap();
        fs::create_dir_all(backup.join("_original")).unwrap();
        fs::write(game.join("Data/new.pak"), b"added").unwrap();

        unapply_mod_stacked(
            &game, &backup, vec!["Data/new.pak".to_string()], &[], None, false,
        ).unwrap();

        assert!(!game.join("Data/new.pak").exists());
    }
}

#[cfg(test)]
mod list_mod_files_tests {
    use super::list_mod_files;
    use std::fs;
    use std::io::Write;

    /// A zip holding two files, one of them nested.
    fn zip_at(path: &std::path::Path) {
        let f = fs::File::create(path).unwrap();
        let mut z = zip::ZipWriter::new(f);
        let o = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Stored);
        z.start_file("readme.txt", o).unwrap();
        z.write_all(b"hi").unwrap();
        z.start_file("Data/thing.pak", o).unwrap();
        z.write_all(b"bytes").unwrap();
        z.finish().unwrap();
    }

    /// THE ONE. An archived mod used to answer this question with a list of one empty path,
    /// which is why "Disable all" left its files in the game folder: what gets deleted is
    /// `installed_files` UNION this, and this contributed nothing.
    #[test]
    fn an_archived_mod_lists_the_files_inside_it() {
        let dir = std::env::temp_dir().join("bmm_lmf_archive");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let zip = dir.join("CoolMod.zip");
        zip_at(&zip);

        let mut got: Vec<String> = list_mod_files(&zip).unwrap()
            .into_iter().map(|p: std::path::PathBuf| p.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect::<Vec<_>>().join("/")).collect();
        got.sort();
        assert_eq!(got, vec!["Data/thing.pak".to_string(), "readme.txt".to_string()]);
        assert!(!got.iter().any(|s| s.is_empty()), "an empty relative path is the old bug");
    }

    #[test]
    fn a_folder_mod_still_lists_the_same_way() {
        let dir = std::env::temp_dir().join("bmm_lmf_folder/CoolMod");
        let _ = fs::remove_dir_all(std::env::temp_dir().join("bmm_lmf_folder"));
        fs::create_dir_all(dir.join("Data")).unwrap();
        fs::write(dir.join("readme.txt"), b"hi").unwrap();
        fs::write(dir.join("Data/thing.pak"), b"bytes").unwrap();

        let mut got: Vec<String> = list_mod_files(&dir).unwrap()
            .into_iter().map(|p: std::path::PathBuf| p.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect::<Vec<_>>().join("/")).collect();
        got.sort();
        assert_eq!(got, vec!["Data/thing.pak".to_string(), "readme.txt".to_string()]);
    }

    /// The two shapes of the same mod must be indistinguishable here, or conflict detection
    /// between a zipped mod and its unzipped twin finds nothing.
    #[test]
    fn the_zipped_and_unzipped_twin_agree() {
        let root = std::env::temp_dir().join("bmm_lmf_twin");
        let _ = fs::remove_dir_all(&root);
        let folder = root.join("CoolMod");
        fs::create_dir_all(folder.join("Data")).unwrap();
        fs::write(folder.join("readme.txt"), b"hi").unwrap();
        fs::write(folder.join("Data/thing.pak"), b"bytes").unwrap();
        let zip = root.join("CoolMod.zip");
        zip_at(&zip);

        let norm = |v: Vec<std::path::PathBuf>| {
            let mut s: Vec<String> = v.into_iter().map(|p: std::path::PathBuf| p.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect::<Vec<_>>().join("/")).collect();
            s.sort();
            s
        };
        assert_eq!(norm(list_mod_files(&folder).unwrap()), norm(list_mod_files(&zip).unwrap()));
    }
}
