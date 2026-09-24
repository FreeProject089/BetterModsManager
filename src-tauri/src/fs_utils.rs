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
    pub smart_io: bool,
    /// The parent's resources document (PLAN-BMM-RESOURCES-2026.md §2.2). The worker is a
    /// separate process with its own governor, which would otherwise start at the default
    /// document and know nothing of the disk rules: the per-disk MB/s limits (the old
    /// `game_path_limit` / `backup_path_limit`, now the disk's `*` rule) travel here.
    #[serde(default)]
    pub io: Option<crate::governor::config::ResourcesConfig>,
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

/// Raise the flag AND cancel every Deploy ticket in this process. The flag is checked between
/// files; the tickets are what the governed copy checks between CHUNKS, so a big file stops
/// mid-copy (and its partial destination is removed) as the old copy loops did when they
/// polled this flag themselves.
pub fn request_mod_op_cancel() {
    MOD_OP_CANCELLED.store(true, Ordering::Relaxed);
    let q = crate::governor::runtime::global().queue();
    for t in q.snapshot() {
        if t.kind == crate::governor::config::OpKind::Deploy { q.cancel(t.id); }
    }
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

    // The parent's rules and preset, so this process copies under the same policy (and the
    // same per-disk limits) as the one that asked.
    if let Some(cfg) = input.io.clone() {
        crate::governor::runtime::global().configure(cfg);
    }

    let result = match input.op.as_str() {
        "apply" => {
            let other: HashSet<PathBuf> = input.other_mods_files.into_iter().collect();
            apply_mod_stacked(
                &input.mod_folder,
                &input.game_path,
                &input.backup_path,
                &other,
                input.smart_io,
            )
        }
        "unapply" => unapply_mod_stacked(
            &input.game_path,
            &input.backup_path,
            input.files_to_remove,
            &input.other_active_mods,
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

// ── Governed copies (PLAN-BMM-RESOURCES-2026.md, phase G3a) ──────────────────────────────
//
// Every mod copy used to pick one of three private paths here: a 128 KiB loop that paced
// ITSELF when the disk had a MB/s limit (so two copy threads wrote at twice the limit), the
// Smart I/O loop (1 MiB chunks, 150 µs every 16 MiB), or a plain `fs::copy`. The first two
// are now the governor's copy (`runtime::global().copy`): under the default Balanced preset
// it resolves to exactly those two rhythms (config.rs, "Balanced is today"), but the limit is
// a token bucket per VOLUME shared by every copy to that disk, and the copy stops at its
// ticket's checkpoint when the user pauses or cancels it.

/// The literal every mod-op caller and the frontend already recognise as "the user
/// cancelled", not "it failed" (`msg.contains("CANCELLED")`, mods-actions.ts).
pub const CANCELLED: &str = "CANCELLED";

fn cancelled() -> anyhow::Error { anyhow!(CANCELLED) }

/// A ticket checkpoint as an anyhow error, for the loops between files.
pub fn checkpoint(ticket: &crate::governor::queue::Ticket) -> Result<()> {
    ticket.checkpoint().map_err(|_| cancelled())
}

/// Smart I/O OFF under the Balanced preset keeps today's full-speed path: the global rayon
/// pool and a plain `fs::copy` (CopyFileEx, which also carries timestamps and attributes).
/// Any other preset is the user asking the governor to decide, and it does.
fn legacy_full_speed(smart_io: bool) -> bool {
    !smart_io && crate::governor::runtime::global().config().preset == crate::governor::config::Preset::Balanced
}

/// Copy one mod file, overwriting (a read-only destination is cleared first, as before),
/// under `kind`'s policy for the destination disk. A cancelled copy leaves no partial file
/// and answers `CANCELLED`.
pub fn copy_file_governed(
    kind: crate::governor::config::OpKind,
    src: &Path,
    dst: &Path,
    ticket: Option<&crate::governor::queue::Ticket>,
    smart_io: bool,
) -> Result<()> {
    use crate::governor::io::CopyError;
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    // ensure_removed() already no-ops if dst doesn't exist, so skip the extra stat call.
    let _ = ensure_removed(dst); // Clear permissions and delete if possible before overwrite

    let gov = crate::governor::runtime::global();
    // Smart I/O off and no MB/s rule on that disk: today's full-speed copy.
    if legacy_full_speed(smart_io) && gov.policy_for(kind, dst).rate_mb_s.is_none() {
        if let Some(t) = ticket { checkpoint(t)?; }
        if is_mod_op_cancelled() { return Err(cancelled()); }
        let n = std::fs::copy(src, dst)
            .with_context(|| format!("Failed to copy {:?} -> {:?}", src, dst))?;
        if let Some(t) = ticket { t.add_bytes(n, n); }
        return Ok(());
    }
    match gov.copy(kind, src, dst, ticket) {
        Ok(_) => Ok(()),
        Err(CopyError::Cancelled) => Err(cancelled()),
        Err(CopyError::Io(e)) => Err(anyhow::Error::new(e).context(format!("Failed to copy {:?} -> {:?}", src, dst))),
    }
}

/// The governed copy with `fs::copy`'s other guarantees: the destination keeps the source's
/// modification time and permissions (read-only included). For the Install sites that used
/// `fs::copy` / `fs_extra`, where a mod's files landing with "now" as their date would be a
/// change nobody asked for. An existing destination is overwritten like `fs::copy` did (a
/// read-only one fails the same way).
pub fn copy_file_install(
    kind: crate::governor::config::OpKind,
    src: &Path,
    dst: &Path,
    ticket: Option<&crate::governor::queue::Ticket>,
) -> Result<u64> {
    use crate::governor::io::CopyError;
    let n = match crate::governor::runtime::global().copy(kind, src, dst, ticket) {
        Ok(n) => n,
        Err(CopyError::Cancelled) => return Err(cancelled()),
        Err(CopyError::Io(e)) => return Err(anyhow::Error::new(e).context(format!("Failed to copy {:?} -> {:?}", src, dst))),
    };
    if let Ok(meta) = std::fs::metadata(src) {
        if let Ok(mtime) = meta.modified() {
            if let Ok(f) = std::fs::OpenOptions::new().write(true).open(dst) {
                let _ = f.set_modified(mtime);
            }
        }
        let _ = std::fs::set_permissions(dst, meta.permissions());
    }
    Ok(n)
}

/// Copy the CONTENT of directory `src` into `dst` (what `fs_extra::dir::copy` with
/// `content_only` did): every sub-directory is created, empty ones included; symlinks are
/// followed; an unreadable entry fails the whole copy. One checkpoint per file.
pub fn copy_dir_governed(
    kind: crate::governor::config::OpKind,
    src: &Path,
    dst: &Path,
    ticket: &crate::governor::queue::Ticket,
) -> Result<u64> {
    if !src.is_dir() {
        return Err(anyhow!("Path {:?} is not a directory or you don't have access!", src));
    }
    std::fs::create_dir_all(dst).with_context(|| format!("Failed to create {:?}", dst))?;
    let mut total = 0u64;
    for entry in std::fs::read_dir(src).with_context(|| format!("Failed to read {:?}", src))? {
        let path = entry?.path();
        let target = dst.join(path.file_name().unwrap_or_default());
        // `metadata` follows a symlink, like fs_extra's `is_dir()` / `fs::copy` did.
        if std::fs::metadata(&path).with_context(|| format!("Failed to read {:?}", path))?.is_dir() {
            total += copy_dir_governed(kind, &path, &target, ticket)?;
        } else {
            checkpoint(ticket)?;
            total += copy_file_install(kind, &path, &target, Some(ticket))?;
        }
    }
    Ok(total)
}

/// Stream `reader` into `writer` under a ticket: a checkpoint per chunk (pause / cancel) and
/// the bytes counted for the dashboard. For downloads and archive entries, where there is no
/// source path for the governed file copy. No rate limit: the disk rules govern file copies,
/// and a download was never paced by them.
pub fn copy_reader_ticketed<R: Read + ?Sized, W: std::io::Write + ?Sized>(
    reader: &mut R,
    writer: &mut W,
    ticket: &crate::governor::queue::Ticket,
) -> std::io::Result<u64> {
    let mut buf = vec![0u8; 64 * 1024];
    let mut total = 0u64;
    loop {
        if ticket.checkpoint().is_err() {
            return Err(std::io::Error::new(std::io::ErrorKind::Other, CANCELLED));
        }
        let n = match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        writer.write_all(&buf[..n])?;
        total += n as u64;
        ticket.add_bytes(n as u64, n as u64);
    }
    Ok(total)
}

/// Take a governor ticket from async code: waiting for a slot blocks a thread, which must not
/// be one of the async runtime's workers.
pub async fn begin_ticket_async(kind: crate::governor::config::OpKind, subject: String) -> crate::governor::queue::Ticket {
    let q = crate::governor::runtime::global().queue().clone();
    match tauri::async_runtime::spawn_blocking(move || q.begin(kind, &subject)).await {
        Ok(t) => t,
        // The blocking task panicked (it cannot, short of a poisoned lock, which `begin`
        // recovers from): take the ticket here rather than run ungoverned.
        Err(_) => crate::governor::runtime::global().begin(kind, "ticket"),
    }
}

/// The ticket subject for a mod folder: its name, as the user knows it.
fn subject_of(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| p.to_string_lossy().to_string())
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

// ALL mod hashing runs on the governor's Hash pool (`pool(OpKind::Hash)`). It replaced a
// private `hash_pool()` of `(cores / 2).clamp(1, 4)` threads, which is exactly what the
// Balanced preset builds for Hash (config.rs `balanced_hash_threads`; the `cores - 1` ceiling
// never binds, since cores / 2 < cores - 1 from 2 cores up): BLAKE3 would otherwise saturate
// every core and freeze the UI while a profile is imported. Silent makes it one thread, Max
// `cores - 1`.

/// Tagged BLAKE3 digest (`b3:<hex>`) of one file.
pub fn compute_file_hash(path: &Path) -> Result<String> {
    let mut hasher = blake3::Hasher::new();
    // Sequential mmap (NOT update_mmap_rayon): per-file work stays on a single
    // pool thread so a big file can't grab every core. Parallelism comes from the
    // bounded pool processing several files at once.
    hasher.update_mmap(path)
        .with_context(|| format!("Failed to hash: {:?}", path))?;
    Ok(format!("b3:{}", hasher.finalize().to_hex()))
}

/// Bulk version: parallel ACROSS files on the governor's Hash pool, keeping the machine
/// responsive even while hashing a freshly imported profile. No ticket: for a caller that
/// measures raw hashing (the benchmark). Everything else uses `compute_file_hash_bulk_ticketed`.
pub fn compute_file_hash_bulk<K: Clone + Send + Sync>(items: &[(K, PathBuf)]) -> Vec<(K, String)> {
    match hash_bulk_in(crate::governor::runtime::global(), items, None) {
        Ok(v) => v,
        Err(_) => Vec::new(), // unreachable: without a ticket nothing can cancel it
    }
}

/// `compute_file_hash_bulk` under a Hash ticket: paused, cancelled, and stepping aside for a
/// deploy or install between files. A cancelled hash returns `CANCELLED` and nothing else,
/// so a caller never stores a half baseline as if it were the mod's.
pub fn compute_file_hash_bulk_ticketed<K: Clone + Send + Sync>(
    gov: &crate::governor::runtime::Governor,
    items: &[(K, PathBuf)],
    ticket: &crate::governor::queue::Ticket,
) -> Result<Vec<(K, String)>> {
    hash_bulk_in(gov, items, Some(ticket)).map_err(|_| cancelled())
}

/// The one hashing loop. Same pool, same per-file function and same result (files that fail
/// to hash are left out, the rest in input order) as the old `hash_pool()` loop; the ticket
/// only adds WHEN it runs.
///
/// The pool's threads never wait in a checkpoint. They are shared: a deploy that hashes, or a
/// second hash job, may need them, and pool threads all asleep "until the deploy ends" would
/// never run the deploy's hashing. So each file first asks the ticket, without blocking,
/// whether it must yield (`must_yield`); if so the pass stops taking files and returns, the
/// CALLING thread waits in `checkpoint()`, and the next pass hashes only what is left.
fn hash_bulk_in<K: Clone + Send + Sync>(
    gov: &crate::governor::runtime::Governor,
    items: &[(K, PathBuf)],
    ticket: Option<&crate::governor::queue::Ticket>,
) -> std::result::Result<Vec<(K, String)>, crate::governor::queue::Cancelled> {
    use crate::governor::config::OpKind;
    // done[i]: None = not hashed yet; Some(None) = tried and failed (left out, as before).
    let mut done: Vec<Option<Option<String>>> = vec![None; items.len()];
    let pool = gov.pool(OpKind::Hash);
    loop {
        if let Some(t) = ticket { t.checkpoint()?; }
        let todo: Vec<usize> = (0..items.len()).filter(|i| done[*i].is_none()).collect();
        if todo.is_empty() { break; }
        let stop = AtomicBool::new(false);
        let pass: Vec<(usize, Option<Option<String>>)> = pool.install(|| {
            todo.par_iter().map(|&i| {
                if let Some(t) = ticket {
                    if stop.load(Ordering::Relaxed) || t.must_yield() {
                        stop.store(true, Ordering::Relaxed);
                        return (i, None);
                    }
                }
                let p = &items[i].1;
                let h = compute_file_hash(p).ok();
                if let (Some(t), Some(_)) = (ticket, &h) {
                    t.add_bytes(std::fs::metadata(p).map(|m| m.len()).unwrap_or(0), 0);
                }
                (i, Some(h))
            }).collect()
        });
        for (i, r) in pass { if r.is_some() { done[i] = r; } }
    }
    Ok(items.iter().zip(done).filter_map(|((k, _), h)| h.flatten().map(|h| (k.clone(), h))).collect())
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
    smart_io: bool,
    ticket: Option<&crate::governor::queue::Ticket>,
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

    // It's a real game file! Secure it. Under the Backup policy of the BACKUP disk (where
    // the bytes are written), on the deploy's ticket: it is part of that operation.
    copy_file_governed(crate::governor::config::OpKind::Backup, &src, &dst, ticket, smart_io)
        .map_err(|e| if e.to_string() == CANCELLED { e } else { e.context(format!("Failed to backup original file: {:?}", rel)) })?;

    Ok(())
}

/// Run `body` over `items` with the deploy's parallelism.
///
/// This replaces `run_with_smart_pool_threads`, which BUILT A NEW rayon pool on every
/// activation and deactivation. Balanced reproduces it exactly:
///   · the game or the backup folder on the system drive → one at a time (the resolved
///     policy's `parallel` is 1 there), run on the calling thread, which is what a one-thread
///     pool did;
///   · otherwise the governor's Deploy pool (two threads under Balanced, as before);
///   · Smart I/O off under Balanced → the global rayon pool, as before.
fn run_deploy_parallel<T, F>(items: &[T], game_path: &Path, backup_root: &Path, smart_io: bool, body: F) -> Result<()>
where
    T: Sync,
    F: Fn(&T) -> Result<()> + Sync + Send,
{
    use crate::governor::config::OpKind;
    let gov = crate::governor::runtime::global();
    let parallel = gov.policy_for(OpKind::Deploy, game_path).parallel
        .min(gov.policy_for(OpKind::Backup, backup_root).parallel);
    if parallel <= 1 {
        return items.iter().try_for_each(|x| body(x));
    }
    if legacy_full_speed(smart_io) {
        return items.par_iter().try_for_each(|x| body(x));
    }
    gov.pool(OpKind::Deploy).install(|| items.par_iter().try_for_each(|x| body(x)))
}


/// How a jwalk directory walk fans out (G3b, the Scan kind).
///
/// Balanced and Custom: exactly as before, jwalk's default (the global rayon pool, 1 s busy
/// timeout). Silent: `Serial`, the walk on the calling thread. NOT the governor's one-thread
/// Scan pool: jwalk aborts a walk whose pool stays busy past its timeout, and on a one-thread
/// pool a second concurrent walk would come back cut short instead of slower. Max keeps the
/// default too: the global pool is already every core but one or two.
///
/// Not a ticket: this walk is a helper that deploys, hashes and scans all call while they
/// hold their OWN ticket; a Scan ticket inside it would nest one ticket in another and, with
/// two slots, two scans each waiting for a second slot would wait for ever.
pub(crate) fn scan_parallelism() -> jwalk::Parallelism {
    use crate::governor::config::Preset;
    match crate::governor::runtime::global().effective_preset() {
        Preset::Silent => jwalk::Parallelism::Serial,
        _ => jwalk::Parallelism::RayonDefaultPool { busy_timeout: std::time::Duration::from_secs(1) },
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
        .parallelism(scan_parallelism())
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
    smart_io: bool,
) -> Result<Vec<PathBuf>> {
    let ticket = crate::governor::runtime::global().begin(crate::governor::config::OpKind::Deploy, &subject_of(mod_folder));
    apply_mod_stacked_ticketed(mod_folder, game_path, profile_backup_root, other_mods_files, smart_io, &ticket)
}

/// `apply_mod_stacked` on a ticket the caller holds (the tests cancel it). A checkpoint
/// between files: a cancelled deploy stops there, and the copy in flight removes its partial
/// file, so what is left in the game folder is whole files only.
pub fn apply_mod_stacked_ticketed(
    mod_folder: &Path,
    game_path: &Path,
    profile_backup_root: &Path,
    other_mods_files: &HashSet<PathBuf>,
    smart_io: bool,
    ticket: &crate::governor::queue::Ticket,
) -> Result<Vec<PathBuf>> {
    let files = list_mod_files(mod_folder)?;

    run_deploy_parallel(&files, game_path, profile_backup_root, smart_io, |rel| {
        if is_mod_op_cancelled() { return Err(cancelled()); }
        checkpoint(ticket)?;
        // Backup original if it's the first time BMM touches this file in this profile
        let _ = backup_original_file(game_path, rel, profile_backup_root, other_mods_files, smart_io, Some(ticket));

        // Copy mod file to game dir (force overwrite)
        let src = mod_folder.join(rel);
        let dst = game_path.join(rel);
        copy_file_governed(crate::governor::config::OpKind::Deploy, &src, &dst, Some(ticket), smart_io)
    })?;

    Ok(files)
}

/// Strip a Windows verbatim prefix (\\?\ or \??\) and normalize separators.
///
/// The prefix strip is delegated rather than repeated: this file had its own four-character
/// version, which is wrong for \\?\UNC\server\share - it leaves `UNC\server\share`
/// instead of \\server\share. That copy was `#[allow(dead_code)]`, so the bug sat here
/// unused while the same mistake was live in two other files.
#[allow(dead_code)]
fn normalize_path(path: PathBuf) -> PathBuf {
    let path_str = path.to_string_lossy();
    let stripped = crate::commands::disk::strip_verbatim(path_str.as_ref());
    let s = if let Some(rest) = stripped.strip_prefix(r"\??\") { rest } else { stripped.as_str() };
    
    // Normalize slashes to backslashes for consistency on Windows
    PathBuf::from(s.replace('/', "\\"))
}

/// A relative path that came from somebody else — a repo manifest, a server's directory
/// listing — turned into one that can only name something UNDER the folder it is joined to.
///
/// `Path::join` is the trap this exists for: an absolute argument REPLACES the base
/// (`mods.join("C:/Users/x/…/Startup/a.bat")` is that path, not one under `mods`), and a
/// `..` segment walks out of it. A repo sync joined the manifest's `relative_path` straight
/// onto the mod folder, so whoever served the manifest chose where on this disk a file landed.
///
/// Refused: empty; rooted (`/x`, `\x`, `\\server\x`); anything holding a `:` (a drive, `C:x`
/// included, or an NTFS alternate data stream) or a NUL; a `..` segment, and any segment that
/// is only dots and spaces, because Windows trims trailing dots and spaces and `.. ` would
/// otherwise reach the filesystem as `..`. Empty and `.` segments are dropped. Both separators
/// are accepted: a manifest written on Windows carries backslashes.
///
/// Returns the path with this platform's separators, never empty.
pub fn safe_relative_path(rel: &str) -> Option<PathBuf> {
    if rel.contains('\0') || rel.contains(':') {
        return None;
    }
    let norm = rel.replace('\\', "/");
    if norm.starts_with('/') {
        return None;
    }
    let mut out = PathBuf::new();
    for seg in norm.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg.trim_end_matches(['.', ' ']).is_empty() {
            return None;
        }
        out.push(seg);
    }
    if out.as_os_str().is_empty() { None } else { Some(out) }
}

/// An id that is about to become ONE folder name — an app's, a launch pack's — or `None`.
///
/// `safe_relative_path` with the extra rule that it is a single component: `a/b` is a safe
/// path and not a folder name. The callers then `remove_dir_all` that folder on uninstall or
/// delete, so an id of `..` was a request to delete the folder ABOVE, and `C:\` the drive.
pub fn safe_folder_name(id: &str) -> Option<String> {
    let p = safe_relative_path(id)?;
    let mut it = p.components();
    match (it.next(), it.next()) {
        (Some(std::path::Component::Normal(one)), None) => Some(one.to_string_lossy().into_owned()),
        _ => None,
    }
}

#[cfg(test)]
mod safe_relative_path_tests {
    use super::{safe_folder_name, safe_relative_path};
    use std::path::PathBuf;

    #[test]
    fn a_folder_name_is_one_safe_component() {
        assert_eq!(safe_folder_name("com.example.app").as_deref(), Some("com.example.app"));
        assert_eq!(safe_folder_name("3f2a9c1e-77aa-4b00-9d1e-000000000000").as_deref(), Some("3f2a9c1e-77aa-4b00-9d1e-000000000000"));
        for bad in ["..", ".", "", "a/b", "a\\b", "C:\\", "C:", "/", "..\\..\\Startup", " . "] {
            assert_eq!(safe_folder_name(bad), None, "accepted {bad:?}");
        }
    }

    /// What every manifest BMM, BCWEB or a directory crawl writes must still pass, unchanged
    /// apart from the separator.
    #[test]
    fn ordinary_mod_paths_pass() {
        assert_eq!(safe_relative_path("Data/a.dds"), Some(PathBuf::from("Data").join("a.dds")));
        assert_eq!(safe_relative_path("Data\\sub\\b.lua"), Some(PathBuf::from("Data").join("sub").join("b.lua")));
        assert_eq!(safe_relative_path("readme.txt"), Some(PathBuf::from("readme.txt")));
        // A dot-file and a name with dots inside are names, not traversal.
        assert_eq!(safe_relative_path(".gitkeep"), Some(PathBuf::from(".gitkeep")));
        assert_eq!(safe_relative_path("v1..2/x"), Some(PathBuf::from("v1..2").join("x")));
        // Redundant separators and `.` segments are tidied rather than refused.
        assert_eq!(safe_relative_path("./a//b"), Some(PathBuf::from("a").join("b")));
    }

    /// Each of these, joined onto a mod folder, names a file outside it.
    #[test]
    fn anything_that_leaves_the_folder_is_refused() {
        for bad in [
            "", ".", "/", "../x", "a/../../x", "a\\..\\..\\x", "..",
            "/etc/passwd", "\\Windows\\x", "\\\\server\\share\\x",
            "C:\\Users\\x\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\a.bat",
            "C:/x", "C:x", "a.txt:stream", "a\0b",
            ".. /x", "a/.../b", "a/. /b",
        ] {
            assert_eq!(safe_relative_path(bad), None, "accepted {bad:?}");
        }
    }

    /// The property the callers rely on, checked on the joined path itself: whatever passes
    /// stays under the base.
    #[test]
    fn a_path_that_passes_stays_under_the_base() {
        let base = std::env::temp_dir().join("bmm_safe_rel_base");
        for ok in ["a", "a/b/c.txt", ".hidden/x", "x..y"] {
            let joined = base.join(safe_relative_path(ok).unwrap());
            assert!(joined.starts_with(&base), "{ok:?} escaped to {joined:?}");
            assert!(joined.components().all(|c| c != std::path::Component::ParentDir));
        }
    }
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
    smart_io: bool,
) -> Result<()> {
    let ticket = crate::governor::runtime::global().begin(crate::governor::config::OpKind::Deploy, &subject_of(game_path));
    unapply_mod_stacked_ticketed(game_path, profile_backup_root, files_to_remove, other_active_mods, smart_io, &ticket)
}

/// `unapply_mod_stacked` on a ticket the caller holds.
pub fn unapply_mod_stacked_ticketed(
    game_path: &Path,
    profile_backup_root: &Path,
    files_to_remove: Vec<String>,
    other_active_mods: &[(String, PathBuf)],
    smart_io: bool,
    ticket: &crate::governor::queue::Ticket,
) -> Result<()> {
    use crate::governor::config::OpKind;

    // Parallelize restoration/removal (the Deploy pool, or one at a time when the game or
    // backup folder lives on the OS drive; see run_deploy_parallel).
    let result: Result<()> = run_deploy_parallel(&files_to_remove, game_path, profile_backup_root, smart_io, |rel_str| {
            if is_mod_op_cancelled() { return Err(cancelled()); }
            checkpoint(ticket)?;
            let rel = PathBuf::from(rel_str);
            let dst_path = game_path.join(&rel);

            let mut restored = false;
            // 1. Fall back to the last-enabled mod that still provides this file, mirroring
            //    the last-wins deployment rule.
            for (_, mod_folder) in other_active_mods.iter().rev() {
                let mod_src = mod_folder.join(&rel);
                if mod_src.metadata().map(|m| m.is_file()).unwrap_or(false) {
                    copy_file_governed(OpKind::Deploy, &mod_src, &dst_path, Some(ticket), smart_io)?;
                    restored = true;
                    break;
                }
            }

            // 2. If no other mod has it, restore original or DELETE
            if !restored {
                let original_src = profile_backup_root.join("_original").join(&rel);
                if original_src.exists() {
                    copy_file_governed(OpKind::Deploy, &original_src, &dst_path, Some(ticket), smart_io)?;
                    // Space optimization: remove the backup file as it has been safely restored
                    let _ = ensure_removed(&original_src);
                } else {
                    // File was added by mod and no original exists — DELETE IT
                    let _ = ensure_removed(&dst_path);
                }
            }
            Ok::<(), anyhow::Error>(())
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
            false,
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
            &game, &backup, vec!["Data/tex.dds".to_string()], &[], false,
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
            &game, &backup, vec!["Data/new.pak".to_string()], &[], false,
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

/// Phase G3a: activation and deactivation on the governor (tickets, the Deploy pool, the
/// governed copy). What must NOT change under the default Balanced preset is the bytes.
#[cfg(test)]
mod governed_deploy_tests {
    use super::*;
    use crate::governor::config::{OpKind, Preset};
    use crate::governor::queue::Queue;
    use std::time::Duration;

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("bmm_g3a_{}_{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    /// remove_dir_all refuses read-only files on Windows; clear them first.
    fn rm(root: &Path) {
        for e in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
            if let Ok(m) = fs::metadata(e.path()) {
                let mut p = m.permissions();
                if p.readonly() { p.set_readonly(false); let _ = fs::set_permissions(e.path(), p); }
            }
        }
        let _ = fs::remove_dir_all(root);
    }

    fn bytes(len: usize, seed: u8) -> Vec<u8> {
        (0..len).map(|i| (i as u32).wrapping_mul(31).wrapping_add(seed as u32) as u8).collect()
    }

    fn put(root: &Path, rel: &str, data: &[u8]) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, data).unwrap();
    }

    /// A mod whose sizes straddle every boundary the copy has: empty, one byte, one chunk,
    /// the 128 KiB paced chunk, and past the 16 MiB Smart I/O yield.
    fn mod_tree(root: &Path) -> Vec<(&'static str, Vec<u8>)> {
        let files = vec![
            ("empty.txt", vec![]),
            ("Data/one.bin", bytes(1, 1)),
            ("Data/sub/chunk.bin", bytes((1 << 20) + 3, 2)),
            ("Data/paced.bin", bytes(128 * 1024 + 1, 3)),
            ("big.pak", bytes((17 << 20) + 7, 4)),
            ("readonly.cfg", bytes(100, 5)),
            ("shared.dds", bytes(10, 6)),
        ];
        for (rel, data) in &files { put(root, rel, data); }
        files
    }

    #[test]
    fn deploy_under_balanced_copies_the_same_bytes_as_before() {
        assert_eq!(crate::governor::runtime::global().config().preset, Preset::Balanced, "the default is Balanced");
        // Balanced resolves to today's Smart I/O rhythm for a deploy (config.rs pins the
        // numbers; this pins that the copy asks for them).
        let root = scratch("same");
        let p = crate::governor::runtime::global().policy_for(OpKind::Deploy, &root.join("x"));
        assert_eq!((p.buffer_kib, p.pause_every_mib, p.pause_us, p.rate_mb_s), (1024, Some(16), 150, None));

        let m = root.join("mod");
        let files = mod_tree(&m);
        for smart_io in [true, false] {
            let game = root.join(format!("game_{smart_io}"));
            let backup = root.join(format!("backup_{smart_io}"));
            // Originals the deploy must back up first, one of them read-only (the old copy
            // cleared that before overwriting; so must this one).
            put(&game, "Data/one.bin", b"vanilla-one");
            put(&game, "readonly.cfg", b"vanilla-cfg");
            let mut ro = fs::metadata(game.join("readonly.cfg")).unwrap().permissions();
            ro.set_readonly(true);
            fs::set_permissions(game.join("readonly.cfg"), ro).unwrap();
            // A file another active mod put there: never backed up as an "original".
            put(&game, "shared.dds", b"other-mod");
            let other: HashSet<PathBuf> = [PathBuf::from("shared.dds")].into_iter().collect();

            let mut applied = apply_mod_stacked(&m, &game, &backup, &other, smart_io).unwrap();
            applied.sort();
            let mut want: Vec<PathBuf> = files.iter().map(|(r, _)| PathBuf::from(r)).collect();
            want.sort();
            assert_eq!(applied, want, "smart_io={smart_io}: the list of applied files");
            for (rel, data) in &files {
                assert_eq!(&fs::read(game.join(rel)).unwrap(), data, "smart_io={smart_io}: {rel} byte for byte");
            }
            assert_eq!(fs::read(backup.join("_original/Data/one.bin")).unwrap(), b"vanilla-one");
            assert_eq!(fs::read(backup.join("_original/readonly.cfg")).unwrap(), b"vanilla-cfg");
            assert!(!backup.join("_original/shared.dds").exists(), "another mod's file is not an original");
            assert!(!backup.join("_original/big.pak").exists(), "no original, no backup");

            // And back: the originals return, the added files go, the backups are reclaimed.
            let rels: Vec<String> = files.iter().map(|(r, _)| r.to_string()).collect();
            unapply_mod_stacked(&game, &backup, rels, &[], smart_io).unwrap();
            assert_eq!(fs::read(game.join("Data/one.bin")).unwrap(), b"vanilla-one");
            assert_eq!(fs::read(game.join("readonly.cfg")).unwrap(), b"vanilla-cfg");
            assert!(!game.join("big.pak").exists() && !game.join("Data/sub/chunk.bin").exists());
            assert!(!backup.join("_original/Data/one.bin").exists());
        }
        // No ticket outlives its operation.
        assert!(!crate::governor::runtime::global().queue().snapshot().iter().any(|t| t.subject == "mod" && t.kind == OpKind::Deploy));
        rm(&root);
    }

    #[test]
    fn cancelling_a_deploy_ticket_stops_between_files_and_leaves_no_partial_file() {
        let root = scratch("cancel");
        let m = root.join("mod");
        let game = root.join("game");
        let backup = root.join("backup");
        for i in 0..24 { put(&m, &format!("f{i:02}.bin"), &bytes(300 * 1024, i as u8)); }
        put(&game, "f00.bin", b"vanilla");

        let q = Queue::default();
        let t = q.begin(OpKind::Deploy, "cancel me");
        let id = t.id();
        q.pause(id); // held at its first checkpoint...
        let (m2, g2, b2) = (m.clone(), game.clone(), backup.clone());
        let h = std::thread::spawn(move || {
            apply_mod_stacked_ticketed(&m2, &g2, &b2, &HashSet::new(), true, &t).map_err(|e| e.to_string())
        });
        std::thread::sleep(Duration::from_millis(150));
        assert!(!h.is_finished(), "a paused deploy waits at its checkpoint");
        q.cancel(id); // ...then cancelled
        assert_eq!(h.join().unwrap(), Err(CANCELLED.to_string()), "a cancel is reported as CANCELLED, not as a failure");

        // Nothing half-written: every file present is whole, and the original was not touched.
        assert_eq!(fs::read(game.join("f00.bin")).unwrap(), b"vanilla");
        let mut copied = 0;
        for i in 1..24 {
            let p = game.join(format!("f{i:02}.bin"));
            if p.exists() {
                assert_eq!(fs::read(&p).unwrap(), bytes(300 * 1024, i as u8), "no partial file");
                copied += 1;
            }
        }
        assert_eq!(copied, 0, "stopped at the checkpoint before the first file");
        assert!(!backup.join("_original/f00.bin").exists(), "not even the backup of the first file");
        rm(&root);
    }

    /// The Install copy must be what `fs_extra::dir::copy(content_only)` was: same tree, empty
    /// folders included, same bytes, same modification times, read-only kept.
    #[test]
    fn install_folder_copy_matches_fs_extra() {
        let root = scratch("install");
        let src = root.join("src");
        put(&src, "a.txt", b"alpha");
        put(&src, "Data/b.bin", &bytes(70_000, 9));
        fs::create_dir_all(src.join("Empty/Deeper")).unwrap();
        let mut ro = fs::metadata(src.join("a.txt")).unwrap().permissions();
        ro.set_readonly(true);
        fs::set_permissions(src.join("a.txt"), ro).unwrap();

        let old = root.join("old");
        fs::create_dir_all(&old).unwrap();
        let mut o = fs_extra::dir::CopyOptions::new();
        o.content_only = true;
        o.overwrite = true;
        fs_extra::dir::copy(&src, &old, &o).unwrap();

        let new = root.join("new");
        let t = Queue::default().begin(OpKind::Install, "install");
        copy_dir_governed(OpKind::Install, &src, &new, &t).unwrap();

        for rel in ["a.txt", "Data/b.bin"] {
            let (a, b) = (fs::metadata(old.join(rel)).unwrap(), fs::metadata(new.join(rel)).unwrap());
            assert_eq!(fs::read(old.join(rel)).unwrap(), fs::read(new.join(rel)).unwrap(), "{rel}");
            assert_eq!(a.modified().unwrap(), b.modified().unwrap(), "{rel}: date kept like fs::copy");
            assert_eq!(a.permissions().readonly(), b.permissions().readonly(), "{rel}: read-only kept");
        }
        assert!(new.join("Empty/Deeper").is_dir(), "empty folders are copied too");
        rm(&root);
    }
}

/// Phase G3b: hashing on the governor (Hash pool, Hash tickets). The digests under the
/// default Balanced preset must be exactly the ones the old private hash pool produced.
#[cfg(test)]
mod governed_hash_tests {
    use super::*;
    use crate::governor::config::{OpKind, ResourcesConfig};
    use crate::governor::game_mode::Manual;
    use crate::governor::runtime::Governor;
    use std::sync::mpsc;
    use std::time::Duration;

    const SOON: Duration = Duration::from_millis(150);
    const WAIT: Duration = Duration::from_secs(10);

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("bmm_g3b_hash_{}_{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    /// Edge sizes around the 1 MiB mark (BLAKE3 chunking and the old SHA buffers), an empty
    /// file, a multi-MiB one, and a path that does not exist (left out, as it always was).
    fn edge_files(dir: &Path) -> Vec<(String, PathBuf)> {
        const MIB: usize = 1 << 20;
        let mut items = Vec::new();
        for (name, len) in [("zero", 0), ("one", 1), ("mib_minus_1", MIB - 1), ("mib_plus_1", MIB + 1), ("multi", 5 * MIB + 12_345)] {
            let p = dir.join(name);
            let data: Vec<u8> = (0..len).map(|i| (i.wrapping_mul(31) ^ (i >> 7)) as u8).collect();
            fs::write(&p, &data).unwrap();
            items.push((name.to_string(), p));
        }
        items.push(("missing".to_string(), dir.join("not-there")));
        items
    }

    /// The loop as it was before G3b, verbatim: its own `(cores / 2).clamp(1, 4)` pool and a
    /// `filter_map` over the files.
    fn old_bulk(items: &[(String, PathBuf)]) -> Vec<(String, String)> {
        let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
        let pool = rayon::ThreadPoolBuilder::new().num_threads((cores / 2).clamp(1, 4)).build().unwrap();
        pool.install(|| items.par_iter().filter_map(|(k, p)| compute_file_hash(p).ok().map(|h| (k.clone(), h))).collect())
    }

    #[test]
    fn hash_under_balanced_equals_the_old_result() {
        let dir = scratch("eq");
        let items = edge_files(&dir);
        let old = old_bulk(&items);
        assert_eq!(old.len(), 5, "the missing file is left out");
        // And the old digests are real BLAKE3, not two implementations agreeing on nonsense.
        for (k, h) in &old {
            let bytes = fs::read(dir.join(k)).unwrap();
            assert_eq!(h, &format!("b3:{}", blake3::hash(&bytes).to_hex()), "{k}");
        }

        assert_eq!(compute_file_hash_bulk(&items), old, "the untracked bulk hash (global governor, Balanced)");

        let gov = Governor::for_tests(ResourcesConfig::default());
        let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
        assert_eq!(gov.pool(OpKind::Hash).current_num_threads(), (cores / 2).clamp(1, 4), "Balanced = the old pool size");
        let t = gov.begin(OpKind::Hash, "g3b test");
        assert_eq!(compute_file_hash_bulk_ticketed(&gov, &items, &t).unwrap(), old, "the ticketed hash, same digests, same order");
        let view = gov.queue().snapshot().into_iter().find(|v| v.subject == "g3b test").unwrap();
        assert_eq!(view.bytes_read, items.iter().filter_map(|(_, p)| fs::metadata(p).ok()).map(|m| m.len()).sum::<u64>(), "bytes counted for the dashboard");

        // Cancelled: nothing comes back, not half a baseline.
        gov.queue().cancel(t.id());
        assert!(compute_file_hash_bulk_ticketed(&gov, &items, &t).is_err());
        drop(t);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn background_hash_yields_to_a_deploy_ticket() {
        let dir = scratch("yield");
        let items = edge_files(&dir);
        let old = old_bulk(&items);
        let gov = Governor::for_tests(ResourcesConfig::default());
        let deploy = gov.begin(OpKind::Deploy, "enable a mod");
        let hash = gov.begin(OpKind::Hash, "background sha");
        std::thread::scope(|s| {
            let (tx, rx) = mpsc::channel();
            let (g, it, h) = (&gov, &items, &hash);
            s.spawn(move || { tx.send(compute_file_hash_bulk_ticketed(g, it, h).map_err(|e| e.to_string())).unwrap(); });
            assert!(rx.recv_timeout(SOON).is_err(), "hashing waits while a deploy writes the game folder");
            let v = gov.queue().snapshot().into_iter().find(|v| v.subject == "background sha").unwrap();
            assert_eq!(v.bytes_read, 0, "and has read nothing");
            drop(deploy);
            assert_eq!(rx.recv_timeout(WAIT).expect("it runs once the deploy is over").unwrap(), old);
        });
        drop(hash);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn game_mode_holds_background_hashing() {
        let dir = scratch("game");
        let items = edge_files(&dir);
        let old = old_bulk(&items);
        let gov = Governor::for_tests(ResourcesConfig::default());
        gov.set_game_manual(Manual::On);
        assert_eq!(gov.pool(OpKind::Hash).current_num_threads(), 1, "game mode = Silent: one hashing thread");
        let hash = gov.begin(OpKind::Hash, "background sha");
        std::thread::scope(|s| {
            let (tx, rx) = mpsc::channel();
            let (g, it, h) = (&gov, &items, &hash);
            s.spawn(move || { tx.send(compute_file_hash_bulk_ticketed(g, it, h).map_err(|e| e.to_string())).unwrap(); });
            assert!(rx.recv_timeout(SOON).is_err(), "background hashing is held while a game runs");
            gov.set_game_manual(crate::governor::game_mode::Manual::Off);
            assert_eq!(rx.recv_timeout(WAIT).expect("released when the game ends").unwrap(), old);
        });
        drop(hash);
        let _ = fs::remove_dir_all(&dir);
    }

    /// A pause that lands while a pass is running stops the pass between files (the pool's
    /// threads are not left waiting) and the rest is hashed after the resume: nothing is
    /// hashed twice or skipped.
    #[test]
    fn a_pause_mid_pass_resumes_where_it_stopped() {
        let dir = scratch("pause");
        let mut items = Vec::new();
        for i in 0..200 {
            let p = dir.join(format!("f{i}"));
            fs::write(&p, vec![i as u8; 40_000]).unwrap();
            items.push((i, p));
        }
        let expected: Vec<(i32, String)> = items.iter().map(|(k, p)| (*k, compute_file_hash(p).unwrap())).collect();
        let gov = Governor::for_tests(ResourcesConfig::default());
        let t = gov.begin(OpKind::Hash, "paused mid-way");
        let id = t.id();
        std::thread::scope(|s| {
            let (tx, rx) = mpsc::channel();
            let (g, it, h) = (&gov, &items, &t);
            s.spawn(move || { tx.send(compute_file_hash_bulk_ticketed(g, it, h).map_err(|e| e.to_string())).unwrap(); });
            gov.queue().pause(id);
            std::thread::sleep(Duration::from_millis(50));
            // While paused, the Hash pool is free for anyone else.
            let free = gov.pool(OpKind::Hash).install(|| 7);
            assert_eq!(free, 7);
            gov.queue().resume(id);
            assert_eq!(rx.recv_timeout(WAIT).unwrap().unwrap(), expected);
        });
        drop(t);
        let _ = fs::remove_dir_all(&dir);
    }
}
