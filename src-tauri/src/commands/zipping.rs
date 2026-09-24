//! The zip a repo export writes: the compression method and the one writer that applies
//! it. Tauri-free on purpose — the MCP server example compiles this file too, and the
//! export command in repo.rs re-exports both names so its callers did not move.
use std::path::Path;

/// How a zip an export writes is compressed.
///
/// One choice, carried by name (`compression`) through the export screen, the scheduler,
/// the API, the script generator, the CLI and the MCP tool, and parsed HERE, once. Every zip
/// is still a zip — the container does not change, only the method recorded per entry — so a
/// repo written with zstd is read by the same `ZipArchive` as one written with deflate, on
/// any BMM built with the crate features this one has (zstd, bzip2). Other unzippers vary:
/// deflate is the one they all read, which is why it stays the default.
///
///   stored   no compression — fastest, biggest; for mods that are already archives
///   deflate  the default; universal
///   bzip2    smaller than deflate, slower
///   zstd     about deflate's size or better, much faster to write and to read
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ZipMethod { Stored, Deflate, Bzip2, Zstd }

impl ZipMethod {
    /// The names a caller may pass, in the order the pickers list them.
    ///
    /// Read by the MCP server's tool schema (the `compression` enum of `bmm_generate_repo`)
    /// and by the tests; the app binary only ever *parses* names, so rustc reports this
    /// constant unused there. The MCP server is a cargo example that compiles this file
    /// through `#[path]`, not a module of the binary, hence the targeted allow.
    #[allow(dead_code)]
    pub const NAMES: [&'static str; 4] = ["deflate", "zstd", "bzip2", "stored"];

    /// `None` and the empty string mean the default; the rest is a small set of spellings
    /// (`deflated` is what the zip crate calls it, `bz2` what people type) and an error for
    /// anything else, worded with the value so a task's author sees what they wrote.
    pub fn parse(s: Option<&str>) -> Result<Self, String> {
        let v = s.map(|x| x.trim().to_ascii_lowercase()).unwrap_or_default();
        match v.as_str() {
            "" | "deflate" | "deflated" | "zip" | "default" => Ok(Self::Deflate),
            "stored" | "store" | "none" => Ok(Self::Stored),
            "bzip2" | "bz2" => Ok(Self::Bzip2),
            "zstd" | "zstandard" => Ok(Self::Zstd),
            other => Err(format!("repo.errCompression|{}", other)),
        }
    }

    pub fn name(self) -> &'static str {
        match self { Self::Stored => "stored", Self::Deflate => "deflate", Self::Bzip2 => "bzip2", Self::Zstd => "zstd" }
    }

    fn method(self) -> zip::CompressionMethod {
        match self {
            Self::Stored => zip::CompressionMethod::Stored,
            Self::Deflate => zip::CompressionMethod::Deflated,
            Self::Bzip2 => zip::CompressionMethod::Bzip2,
            Self::Zstd => zip::CompressionMethod::Zstd,
        }
    }
}

/// What a caller lends the writer so the resource governor can pause, cancel and count it
/// (OpKind::Compress). A trait and not the governor's ticket: this file is also compiled by the
/// MCP server example, which has no governor, so the app side implements it (repo.rs).
pub trait ZipGate {
    /// Before every entry. An error stops the zip with that error.
    fn checkpoint(&self) -> Result<(), String> { Ok(()) }
    /// After every file: bytes read from it (the uncompressed size).
    fn wrote(&self, _bytes: u64) {}
}

/// No gate: the writer as it was.
pub struct NoGate;
impl ZipGate for NoGate {}

pub fn zip_dir(src_dir: &Path, dst_file: &Path, cancel_flag: std::sync::Arc<std::sync::atomic::AtomicBool>, method: ZipMethod) -> Result<(), String> {
    zip_dir_gated(src_dir, dst_file, cancel_flag, method, &NoGate)
}

/// `zip_dir` with a gate between entries. The bytes written do not depend on the gate: same
/// walk, same options, same method; the gate only decides whether the next entry is written.
pub fn zip_dir_gated(src_dir: &Path, dst_file: &Path, cancel_flag: std::sync::Arc<std::sync::atomic::AtomicBool>, method: ZipMethod, gate: &dyn ZipGate) -> Result<(), String> {
    use zip::write::FileOptions;
    use std::io::{copy, BufWriter};
    use walkdir::WalkDir;
    use std::sync::atomic::Ordering;

    let file = std::fs::File::create(dst_file).map_err(|e| e.to_string())?;
    // Use BufWriter for better performance with large files
    let writer = BufWriter::with_capacity(128 * 1024, file);
    let mut zip = zip::ZipWriter::new(writer);

    // Enable ZIP64 for files > 4GB and overall archive > 4GB
    let options = FileOptions::default()
        .compression_method(method.method())
        .unix_permissions(0o755)
        .large_file(true); // <--- Enable ZIP64 support

    for entry in WalkDir::new(src_dir).into_iter().filter_map(|e| e.ok()) {
        if cancel_flag.load(Ordering::SeqCst) {
            return Err("repo.cancelled".to_string());
        }
        gate.checkpoint()?;
        let path = entry.path();
        let name = path.strip_prefix(src_dir).map_err(|e| e.to_string())?;

        if path.is_file() {
            zip.start_file(name.to_string_lossy().replace("\\", "/"), options).map_err(|e| e.to_string())?;
            let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
            let n = copy(&mut f, &mut zip).map_err(|e| e.to_string())?;
            gate.wrote(n);
        } else if !name.as_os_str().is_empty() {
            zip.add_directory(name.to_string_lossy().replace("\\", "/"), options).map_err(|e| e.to_string())?;
        }
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}
