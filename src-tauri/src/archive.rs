// ── Archived-mod support ──────────────────────────────────────────────────────
// A mod may be stored as an ARCHIVE file (e.g. `MyMod.zip`) directly inside the
// profile's mods_path, instead of an unpacked folder. The archive is NEVER
// unpacked into the mods folder — it stays compressed. It is only extracted (to a
// cache dir) when needed: on activation (the extracted view is then copied into
// the game), and for read-only features (hashing, content-id, integrity, the
// file explorer). Because the extracted view contains exactly the same relative
// paths + sizes as the unpacked equivalent, every BMM feature (SHA / content-id /
// integrity report / conflicts) yields IDENTICAL results for an archived mod and
// its unpacked twin.
//
// Supported: .zip, .tar, .tar.gz / .tgz, .7z, .rar.

use std::io::Read;
use std::path::{Path, PathBuf};

/// Extensions recognised as mod archives (reference; matching is done in `kind_of`,
/// which also handles the two-part `.tar.gz`).
#[allow(dead_code)]
pub const ARCHIVE_EXTS: &[&str] = &["zip", "tar", "gz", "tgz", "7z", "rar"];

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Zip,
    Tar,
    TarGz,
    SevenZ,
    Rar,
}

fn kind_of(path: &Path) -> Option<Kind> {
    let name = path.file_name()?.to_str()?.to_lowercase();
    if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        Some(Kind::TarGz)
    } else if name.ends_with(".tar") {
        Some(Kind::Tar)
    } else if name.ends_with(".zip") {
        Some(Kind::Zip)
    } else if name.ends_with(".7z") {
        Some(Kind::SevenZ)
    } else if name.ends_with(".rar") {
        Some(Kind::Rar)
    } else {
        None
    }
}

/// True if `path` is an archive file we know how to read.
pub fn is_archive(path: &Path) -> bool {
    path.is_file() && kind_of(path).is_some()
}

fn io_err<E: std::fmt::Display>(e: E) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string())
}

/// Lists every FILE entry as `(relative_path /forward-slashes/, uncompressed_size)`.
/// Matches the `(rel, size)` pairs produced by walking the unpacked folder, so the
/// content fingerprint (content_id) is identical to the unzipped twin.
pub fn archive_entries(path: &Path) -> std::io::Result<Vec<(String, u64)>> {
    match kind_of(path) {
        Some(Kind::Zip) => {
            let file = std::fs::File::open(path)?;
            let mut zip = zip::ZipArchive::new(file).map_err(io_err)?;
            let mut out = Vec::new();
            for i in 0..zip.len() {
                let f = zip.by_index(i).map_err(io_err)?;
                if f.is_dir() {
                    continue;
                }
                let name = f
                    .enclosed_name()
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_else(|| f.name().replace('\\', "/"));
                out.push((name, f.size()));
            }
            Ok(out)
        }
        Some(Kind::Tar) | Some(Kind::TarGz) => tar_entries(path, kind_of(path) == Some(Kind::TarGz)),
        Some(Kind::SevenZ) => sevenz_entries(path),
        Some(Kind::Rar) => rar_entries(path),
        None => Err(io_err("not an archive")),
    }
}

fn tar_entries(path: &Path, gz: bool) -> std::io::Result<Vec<(String, u64)>> {
    let file = std::fs::File::open(path)?;
    let reader: Box<dyn Read> = if gz {
        Box::new(flate2::read::GzDecoder::new(file))
    } else {
        Box::new(file)
    };
    let mut ar = tar::Archive::new(reader);
    let mut out = Vec::new();
    for entry in ar.entries()? {
        let entry = entry?;
        if entry.header().entry_type().is_dir() {
            continue;
        }
        let p = entry.path()?.to_string_lossy().replace('\\', "/");
        let size = entry.header().size().unwrap_or(0);
        out.push((p, size));
    }
    Ok(out)
}

/// Lists a .7z WITHOUT extracting (reads the header/index only).
fn sevenz_entries(path: &Path) -> std::io::Result<Vec<(String, u64)>> {
    let mut file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    let archive = sevenz_rust::Archive::read(&mut file, len, &[]).map_err(io_err)?;
    let mut out = Vec::new();
    for e in &archive.files {
        if !e.is_directory() {
            out.push((e.name().replace('\\', "/"), e.size()));
        }
    }
    Ok(out)
}

/// Lists a .rar WITHOUT extracting (reads the headers only).
fn rar_entries(path: &Path) -> std::io::Result<Vec<(String, u64)>> {
    let mut out = Vec::new();
    let list = unrar::Archive::new(path).open_for_listing().map_err(io_err)?;
    for entry in list {
        let e = entry.map_err(io_err)?;
        if e.is_file() {
            out.push((e.filename.to_string_lossy().replace('\\', "/"), e.unpacked_size as u64));
        }
    }
    Ok(out)
}

/// Extracts the whole archive into `dest` (created if missing).
pub fn extract_to(path: &Path, dest: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dest)?;
    match kind_of(path) {
        Some(Kind::Zip) => {
            let file = std::fs::File::open(path)?;
            let mut zip = zip::ZipArchive::new(file).map_err(io_err)?;
            zip.extract(dest).map_err(io_err)?;
        }
        Some(Kind::Tar) => {
            let file = std::fs::File::open(path)?;
            tar::Archive::new(file).unpack(dest)?;
        }
        Some(Kind::TarGz) => {
            let file = std::fs::File::open(path)?;
            tar::Archive::new(flate2::read::GzDecoder::new(file)).unpack(dest)?;
        }
        Some(Kind::SevenZ) => {
            sevenz_rust::decompress_file(path, dest).map_err(io_err)?;
        }
        Some(Kind::Rar) => {
            let mut archive = unrar::Archive::new(path).open_for_processing().map_err(io_err)?;
            while let Some(header) = archive.read_header().map_err(io_err)? {
                archive = if header.entry().is_file() {
                    header.extract_with_base(dest).map_err(io_err)?
                } else {
                    header.skip().map_err(io_err)?
                };
            }
        }
        None => return Err(io_err("not an archive")),
    }
    Ok(())
}

/// Returns the cache directory where this archive is (or will be) extracted.
/// Keyed by the archive's name + size + mtime, so changing the archive busts it.
fn cache_dir_for(archive: &Path) -> std::io::Result<PathBuf> {
    let meta = std::fs::metadata(archive)?;
    let size = meta.len();
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let stem = archive.file_stem().and_then(|s| s.to_str()).unwrap_or("mod");
    let safe: String = stem
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let key = format!("{}_{}_{}", safe, size, mtime);
    Ok(std::env::temp_dir().join("bmm_mod_cache").join(key))
}

/// Extracts the archive to its cache dir (only if not already extracted & fresh)
/// and returns that directory. Cheap on repeat calls thanks to the marker file.
pub fn materialize(archive: &Path) -> std::io::Result<PathBuf> {
    let dir = cache_dir_for(archive)?;
    let marker = dir.join(".bmm_extracted");
    if marker.exists() {
        return Ok(dir);
    }
    if dir.exists() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    extract_to(archive, &dir)?;
    let _ = std::fs::write(&marker, b"ok");
    Ok(dir)
}

/// Returns the directory to READ a mod's files from:
///   - a plain mod folder → the folder itself
///   - an archive mod     → its extracted cache dir
/// Falls back to the original path if extraction fails (callers stay robust).
pub fn mod_read_root(mod_folder: &Path) -> PathBuf {
    if is_archive(mod_folder) {
        materialize(mod_folder).unwrap_or_else(|_| mod_folder.to_path_buf())
    } else {
        mod_folder.to_path_buf()
    }
}
