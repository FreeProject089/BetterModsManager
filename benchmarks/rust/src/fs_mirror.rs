//! Faithful mirrors of the FS hot-paths in `src-tauri/src/fs_utils.rs`, plus
//! alternative implementations so the benchmark can quantify *why* the shipped
//! choice was made (e.g. jwalk vs walkdir vs std for directory scanning).
//!
//! The mirrored functions reproduce the exact algorithm/constants of the app:
//!   - [`scan_jwalk`]      ≡ `fs_utils::list_mod_files` (parallel jwalk)
//!   - [`sha256_file`]     ≡ `fs_utils::compute_file_sha256` (1 MiB buffered)
//!   - [`copy_full_speed`] ≡ `copy_file_force_smart(.., None, false)` (Path 3)
//!   - [`copy_smart_io`]   ≡ `copy_file_force_smart(.., None, true)`  (Path 2)

use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

// ── Directory scanning ───────────────────────────────────────────────────────

/// The shipped scan: jwalk (parallel), collecting relative file paths.
pub fn scan_jwalk(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for entry in jwalk::WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            let p = entry.path();
            let rel = p.strip_prefix(root).unwrap_or(&p).to_path_buf();
            files.push(rel);
        }
    }
    files
}

/// Same result via walkdir (single-threaded) — the baseline jwalk replaced.
pub fn scan_walkdir(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for entry in walkdir::WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            let p = entry.path();
            let rel = p.strip_prefix(root).unwrap_or(p).to_path_buf();
            files.push(rel);
        }
    }
    files
}

/// Same result via a hand-rolled recursive std::fs walk — the naive baseline.
pub fn scan_std(root: &Path) -> Vec<PathBuf> {
    fn rec(dir: &Path, root: &Path, out: &mut Vec<PathBuf>) {
        let Ok(rd) = fs::read_dir(dir) else { return };
        for e in rd.filter_map(|e| e.ok()) {
            let p = e.path();
            match e.file_type() {
                Ok(ft) if ft.is_dir() => rec(&p, root, out),
                Ok(ft) if ft.is_file() => {
                    out.push(p.strip_prefix(root).unwrap_or(&p).to_path_buf());
                }
                _ => {}
            }
        }
    }
    let mut out = Vec::new();
    rec(root, root, &mut out);
    out
}

// ── Hashing ──────────────────────────────────────────────────────────────────

/// SHA-256 of a file using the app's 1 MiB buffered-read strategy.
pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    use std::io::BufReader;
    let file = fs::File::open(path)?;
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

// ── Copying ──────────────────────────────────────────────────────────────────

/// Path 3 of `copy_file_force_smart`: full-speed `std::fs::copy`.
pub fn copy_full_speed(src: &Path, dst: &Path) -> std::io::Result<u64> {
    if let Some(parent) = dst.parent() { fs::create_dir_all(parent).ok(); }
    fs::copy(src, dst)
}

/// Path 2 of `copy_file_force_smart`: 256 KiB chunked copy. The benchmark variant
/// omits the 200 µs micro-yield every 8 chunks (that sleep exists purely to free
/// the WebView2 message pump and would only add noise to a throughput measurement).
pub fn copy_smart_io(src: &Path, dst: &Path) -> std::io::Result<()> {
    if let Some(parent) = dst.parent() { fs::create_dir_all(parent).ok(); }
    let mut src_file = fs::File::open(src)?;
    let mut dst_file = fs::File::create(dst)?;
    let mut buffer = vec![0u8; 256 * 1024];
    loop {
        let n = src_file.read(&mut buffer)?;
        if n == 0 { break; }
        dst_file.write_all(&buffer[..n])?;
    }
    Ok(())
}
