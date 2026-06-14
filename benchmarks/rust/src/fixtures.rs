//! Deterministic on-disk fixtures: a synthetic "mod" folder tree plus archives
//! built from it. Everything is seeded so runs are reproducible.

use rand::{Rng, SeedableRng};
use rand::rngs::StdRng;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Shape of a generated mod tree. The defaults model a "typical" medium mod:
/// a handful of nested folders, a few dozen files, mixed sizes.
#[derive(Clone, Copy)]
pub struct TreeSpec {
    /// Total number of files to create.
    pub files: usize,
    /// Number of top-level sub-directories to spread files across.
    pub dirs: usize,
    /// Average file size in bytes (sizes vary ±50%).
    pub avg_size: usize,
    /// RNG seed — same seed ⇒ byte-identical tree.
    pub seed: u64,
}

impl TreeSpec {
    /// Small mod: many tiny files (stresses per-file overhead / syscalls).
    pub fn small() -> Self { TreeSpec { files: 200, dirs: 12, avg_size: 4 * 1024, seed: 1 } }
    /// Medium mod: balanced.
    pub fn medium() -> Self { TreeSpec { files: 120, dirs: 8, avg_size: 64 * 1024, seed: 2 } }
    /// Large mod: few big files (stresses raw throughput).
    pub fn large() -> Self { TreeSpec { files: 24, dirs: 4, avg_size: 2 * 1024 * 1024, seed: 3 } }
}

/// Create the mod tree under `root`, returning the list of files written
/// (absolute paths). Content is pseudo-random but seeded, and only ~40%
/// compressible so archive benchmarks aren't trivially fast.
pub fn build_tree(root: &Path, spec: TreeSpec) -> std::io::Result<Vec<PathBuf>> {
    fs::create_dir_all(root)?;
    let mut rng = StdRng::seed_from_u64(spec.seed);
    let mut written = Vec::with_capacity(spec.files);

    for i in 0..spec.files {
        let dir_idx = i % spec.dirs.max(1);
        // Nest two levels deep so the walker has real depth to traverse.
        let sub = root.join(format!("category_{dir_idx:02}")).join(format!("group_{}", dir_idx % 3));
        fs::create_dir_all(&sub)?;
        let ext = ["dds", "lua", "cfg", "txt", "bin"][i % 5];
        let path = sub.join(format!("asset_{i:04}.{ext}"));

        // size = avg ±50%
        let jitter = rng.gen_range(0..=spec.avg_size);
        let size = spec.avg_size / 2 + jitter;
        let buf = pseudo_bytes(&mut rng, size);

        let mut f = fs::File::create(&path)?;
        f.write_all(&buf)?;
        written.push(path);
    }
    Ok(written)
}

/// Bytes that are partly repetitive (so deflate has something to chew on) and
/// partly random (so it isn't unrealistically compressible).
fn pseudo_bytes(rng: &mut StdRng, len: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(len);
    // A repeating dictionary chunk + random noise interleaved.
    let dict: [u8; 32] = rng.gen();
    while out.len() < len {
        if rng.gen_bool(0.6) {
            out.extend_from_slice(&dict);
        } else {
            let n = (len - out.len()).min(16);
            for _ in 0..n { out.push(rng.gen()); }
        }
    }
    out.truncate(len);
    out
}

/// Total byte size of a set of files (for throughput reporting).
pub fn total_bytes(files: &[PathBuf]) -> u64 {
    files.iter().filter_map(|p| fs::metadata(p).ok()).map(|m| m.len()).sum()
}

// ── Archive builders ─────────────────────────────────────────────────────────

/// Build a `.zip` (deflate) of `tree_root` at `dest`.
pub fn make_zip(tree_root: &Path, files: &[PathBuf], dest: &Path) -> std::io::Result<()> {
    let file = fs::File::create(dest)?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);
    for f in files {
        let rel = f.strip_prefix(tree_root).unwrap().to_string_lossy().replace('\\', "/");
        zip.start_file(rel, opts)?;
        let bytes = fs::read(f)?;
        zip.write_all(&bytes)?;
    }
    zip.finish()?;
    Ok(())
}

/// Build a `.tar` (no compression) of `tree_root` at `dest`.
pub fn make_tar(tree_root: &Path, dest: &Path) -> std::io::Result<()> {
    let file = fs::File::create(dest)?;
    let mut b = tar::Builder::new(file);
    b.append_dir_all(".", tree_root)?;
    b.finish()?;
    Ok(())
}

/// Build a `.tar.gz` of `tree_root` at `dest`.
pub fn make_tar_gz(tree_root: &Path, dest: &Path) -> std::io::Result<()> {
    let file = fs::File::create(dest)?;
    let enc = flate2::write::GzEncoder::new(file, flate2::Compression::default());
    let mut b = tar::Builder::new(enc);
    b.append_dir_all(".", tree_root)?;
    let enc = b.into_inner()?;
    enc.finish()?;
    Ok(())
}

/// Build a `.7z` of `tree_root` at `dest`. Best-effort: returns Err if the
/// sevenz-rust convenience API isn't available, so callers can skip gracefully.
pub fn make_7z(tree_root: &Path, dest: &Path) -> std::io::Result<()> {
    sevenz_rust::compress_to_path(tree_root, dest)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
}
