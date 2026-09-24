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
use crate::governor::config::OpKind;
use crate::governor::queue::Ticket;
use crate::state::AppState;
use tracing::info;
use std::path::{Path, PathBuf};
use tauri::State;

// ── The governor's side of archive.rs's extraction hook ──────────────────────────
// archive.rs is compiled verbatim by the benchmarks crate and cannot name the governor, so it
// takes an `ExtractControl` and the app registers this one at startup: one Extract ticket per
// extraction (waits for a slot, answers pause / cancel between entries, counts bytes) and the
// governor's Extract pool for the parallel pass. Under Balanced that pool is the size of the
// global rayon pool the pass ran on before (governor::config::balanced_global_threads).

/// An extraction governed by `ticket`.
pub(crate) struct TicketExtract {
    pub(crate) ticket: Ticket,
}

impl crate::archive::ExtractControl for TicketExtract {
    fn checkpoint(&self) -> std::io::Result<()> {
        self.ticket.checkpoint().map_err(|_| crate::archive::cancelled_error())
    }
    fn add_bytes(&self, read: u64, written: u64) {
        self.ticket.add_bytes(read, written);
    }
    fn run_parallel(&self, f: &(dyn Fn() -> std::io::Result<()> + Sync)) -> std::io::Result<()> {
        crate::governor::runtime::global().pool(OpKind::Extract).install(|| f())
    }
}

/// What the dashboard calls an extraction: the archive's file name.
fn extract_subject(archive: &Path) -> String {
    archive.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| archive.display().to_string())
}

/// Route every `archive::extract_to` (and so every `materialize`) through the governor.
pub fn install_extract_governor() {
    crate::archive::set_extract_governor(|archive| {
        let ticket = crate::governor::runtime::global().begin(OpKind::Extract, &extract_subject(archive));
        Box::new(TicketExtract { ticket })
    });
}

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
        // One Compress ticket for the packing; the rename and the removal after it are cheap.
        let ticket = crate::governor::runtime::global().begin(OpKind::Compress, &extract_subject(&f));
        zip_dir(&f, &s, Some(&ticket))?;
        drop(ticket);
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
///
/// Governed by `ticket` when there is one: its checkpoint before every entry (a cancel stops
/// the packing between files, and the caller removes the partial `.zip.part`), its byte count
/// after every file. Same entries, same order, same method with or without it.
fn zip_dir(dir: &Path, out: &Path, ticket: Option<&Ticket>) -> std::io::Result<()> {
    use std::io::Write;
    let gate = || -> std::io::Result<()> {
        match ticket {
            Some(t) => t.checkpoint().map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "compress.cancelled")),
            None => Ok(()),
        }
    };
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
            gate()?;
            if path.is_dir() {
                zip.add_directory(format!("{}/", rel), opts).map_err(zerr)?;
                stack.push(path);
            } else {
                zip.start_file(rel, opts).map_err(zerr)?;
                let mut src = std::fs::File::open(&path)?;
                let n = std::io::copy(&mut src, &mut zip)?;
                zip.flush()?;
                if let Some(t) = ticket { t.add_bytes(n, 0); }
            }
        }
    }
    zip.finish().map_err(zerr)?;
    Ok(())
}

#[cfg(test)]
mod governed_extract_tests {
    use super::TicketExtract;
    use crate::archive::{extract_to_with, is_cancelled, ExtractControl, Ungoverned};
    use crate::governor::config::{pool_threads, OpKind, Preset};
    use crate::governor::queue::Queue;
    use std::collections::BTreeMap;
    use std::path::Path;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A mod folder: nested dirs, an empty file, a big pseudo-random blob and `n` small files.
    fn write_tree(root: &Path, n: usize) {
        let mut blob = Vec::with_capacity(1536 * 1024);
        let mut x: u32 = 0x2545_F491;
        for _ in 0..(1536 * 1024) {
            x ^= x << 13; x ^= x >> 17; x ^= x << 5;
            blob.push((x & 0xFF) as u8);
        }
        std::fs::create_dir_all(root.join("Data/textures")).unwrap();
        std::fs::create_dir_all(root.join("many")).unwrap();
        std::fs::write(root.join("Data/textures/big.dds"), &blob).unwrap();
        std::fs::write(root.join("empty.bin"), b"").unwrap();
        std::fs::write(root.join("readme.txt"), b"hello\n").unwrap();
        for i in 0..n {
            std::fs::write(root.join("many").join(format!("{i:03}.txt")), format!("file {i}\n").repeat(40)).unwrap();
        }
    }

    fn read_tree(root: &Path) -> BTreeMap<String, Vec<u8>> {
        let mut out = BTreeMap::new();
        for e in walkdir::WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
            if e.path().is_file() {
                let rel = e.path().strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
                out.insert(rel, std::fs::read(e.path()).unwrap());
            }
        }
        out
    }

    fn zip_of(src: &Path, dst: &Path) {
        let noflag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        crate::commands::zipping::zip_dir(src, dst, noflag, crate::commands::zipping::ZipMethod::Deflate).unwrap();
    }

    fn tar_gz_of(src: &Path, dst: &Path) {
        let f = std::fs::File::create(dst).unwrap();
        let gz = flate2::write::GzEncoder::new(f, flate2::Compression::default());
        let mut b = tar::Builder::new(gz);
        b.append_dir_all(".", src).unwrap();
        b.into_inner().unwrap().finish().unwrap();
    }

    fn sevenz_of(src: &Path, dst: &Path) {
        let mut w = sevenz_rust::SevenZWriter::create(dst).unwrap();
        w.push_source_path(src, |_| true).unwrap();
        w.finish().unwrap();
    }

    /// Balanced reproduces today: the files an extraction under an Extract ticket writes are
    /// the files the ungoverned extraction writes, byte for byte, for zip (the parallel pass on
    /// the Extract pool), tar.gz (the checked reader) and 7z (the per-entry gate); and the
    /// parallel pass runs on a pool the size of the global pool it ran on before.
    #[test]
    fn extract_under_balanced_yields_identical_files() {
        let td = tempfile::tempdir().unwrap();
        let src = td.path().join("mod");
        write_tree(&src, 40);
        let want = read_tree(&src);
        let archives: [(std::path::PathBuf, fn(&Path, &Path)); 3] = [
            (td.path().join("m.zip"), zip_of),
            (td.path().join("m.tar.gz"), tar_gz_of),
            (td.path().join("m.7z"), sevenz_of),
        ];
        let gov = crate::governor::runtime::global();
        for (i, (archive, make)) in archives.iter().enumerate() {
            make(&src, archive);
            let plain = td.path().join(format!("plain-{i}"));
            extract_to_with(archive, &plain, &Ungoverned).unwrap();
            let governed = td.path().join(format!("governed-{i}"));
            let control = TicketExtract { ticket: gov.begin(OpKind::Extract, "test: balanced extract") };
            extract_to_with(archive, &governed, &control).unwrap();
            let (a, b) = (read_tree(&plain), read_tree(&governed));
            assert_eq!(a, b, "{}: governed and ungoverned extraction differ", archive.display());
            assert_eq!(b, want, "{}: extraction differs from the source", archive.display());
        }

        // The pool: Balanced's Extract pool is the size of main.rs's global pool.
        let control = TicketExtract { ticket: gov.begin(OpKind::Extract, "test: pool probe") };
        let seen = std::sync::Mutex::new((0usize, String::new()));
        control.run_parallel(&|| {
            let name = std::thread::current().name().unwrap_or("").to_string();
            *seen.lock().unwrap() = (rayon::current_num_threads(), name);
            Ok(())
        }).unwrap();
        let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
        let (threads, name) = seen.into_inner().unwrap();
        if gov.effective_preset() == Preset::Balanced {
            assert_eq!(threads, pool_threads(Preset::Balanced, OpKind::Extract, cores));
        }
        assert!(name.starts_with("bmm-extract"), "the parallel pass must run on the Extract pool, ran on {name:?}");
    }

    /// Cancels its ticket at the `after`-th checkpoint, and counts what was written.
    struct CancelAfter {
        inner: TicketExtract,
        queue: Queue,
        after: usize,
        seen: AtomicUsize,
        entries_written: AtomicUsize,
    }

    impl ExtractControl for CancelAfter {
        fn checkpoint(&self) -> std::io::Result<()> {
            if self.seen.fetch_add(1, Ordering::SeqCst) + 1 == self.after {
                self.queue.cancel(self.inner.ticket.id());
            }
            self.inner.checkpoint()
        }
        fn add_bytes(&self, read: u64, written: u64) {
            self.entries_written.fetch_add(1, Ordering::SeqCst);
            self.inner.add_bytes(read, written);
        }
        fn run_parallel(&self, f: &(dyn Fn() -> std::io::Result<()> + Sync)) -> std::io::Result<()> {
            self.inner.run_parallel(f)
        }
    }

    fn cancel_after(after: usize) -> CancelAfter {
        let queue = Queue::default();
        let ticket = queue.begin(OpKind::Extract, "test: cancel");
        CancelAfter { inner: TicketExtract { ticket }, queue, after, seen: AtomicUsize::new(0), entries_written: AtomicUsize::new(0) }
    }

    /// A cancel from the dashboard stops the extraction at the next entry boundary (not at
    /// the end of the archive) and what the extraction wrote does not stay behind: a
    /// destination it created is removed whole; in a folder that already existed, the files
    /// it wrote are removed and what was there before is left alone.
    #[test]
    fn cancelling_an_extract_ticket_stops_between_entries_and_cleans_up() {
        let td = tempfile::tempdir().unwrap();
        let src = td.path().join("mod");
        write_tree(&src, 200);
        let total_files = read_tree(&src).len();
        let zip = td.path().join("m.zip");
        zip_of(&src, &zip);
        let threads = crate::governor::runtime::global().pool(OpKind::Extract).current_num_threads();

        // 1. A destination this extraction creates: gone after the cancel.
        let dest = td.path().join("fresh");
        let c = cancel_after(10);
        let err = extract_to_with(&zip, &dest, &c).expect_err("a cancelled extraction must fail");
        assert!(is_cancelled(&err), "the error says cancelled, got {err}");
        assert!(!dest.exists(), "the destination this extraction created must be removed");
        let written = c.entries_written.load(Ordering::SeqCst);
        assert!(written < total_files, "it stopped between entries ({written} of {total_files} written)");
        assert!(written <= 10 + threads, "at most the entries already in flight finish ({written} written, {threads} threads)");

        // 2. An existing folder: its own content stays, nothing extracted stays.
        let dest = td.path().join("existing");
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::write(dest.join("keep.me"), b"mine").unwrap();
        let c = cancel_after(25);
        let err = extract_to_with(&zip, &dest, &c).expect_err("cancelled");
        assert!(is_cancelled(&err));
        let left = read_tree(&dest);
        assert_eq!(left.keys().cloned().collect::<Vec<_>>(), vec!["keep.me".to_string()], "only what was there before remains");

        // 3. tar.gz (the checked reader) stops too and removes a destination it created.
        let tgz = td.path().join("m.tar.gz");
        tar_gz_of(&src, &tgz);
        let dest = td.path().join("fresh-tgz");
        // The 2nd checkpoint is the reader's first (after 1 MiB of archive): mid-stream.
        let c = cancel_after(2);
        let err = extract_to_with(&tgz, &dest, &c).expect_err("cancelled");
        assert_eq!(c.seen.load(Ordering::SeqCst), 2, "stopped at the reader's checkpoint");
        assert!(is_cancelled(&err));
        assert!(!dest.exists());
    }
}
