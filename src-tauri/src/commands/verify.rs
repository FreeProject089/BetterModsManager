//! File verification helpers for the scheduler & script generator: hash a file
//! (blake3 default, or sha256) and read lightweight metadata (size, modified time,
//! name, extension). Used by "verify / compare" conditions so a user can build
//! flows like "loop until <file> sha == <value>".

use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct FileMeta {
    pub exists: bool,
    pub size: u64,
    pub modified_ms: u64,
    pub name: String,
    pub ext: String,
    pub is_dir: bool,
}

/// Lightweight file metadata — never errors (missing file → `exists:false`).
#[tauri::command]
pub fn file_meta(path: String) -> FileMeta {
    let p = Path::new(&path);
    let name = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = p.extension().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    match std::fs::metadata(p) {
        Ok(m) => {
            let modified_ms = m.modified().ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64).unwrap_or(0);
            FileMeta { exists: true, size: m.len(), modified_ms, name, ext, is_dir: m.is_dir() }
        }
        Err(_) => FileMeta { exists: false, size: 0, modified_ms: 0, name, ext, is_dir: false },
    }
}

/// Hash a file. `algo` = "blake3" (default) or "sha256". Returns lowercase hex
/// (no prefix). Runs on a blocking thread so big files don't stall the UI.
#[tauri::command]
pub async fn hash_file(path: String, algo: Option<String>) -> Result<String, String> {
    let algo = algo.unwrap_or_else(|| "blake3".into()).to_lowercase();
    let p = std::path::PathBuf::from(&path);
    if !p.is_file() { return Err(format!("Not a file: {}", path)); }
    tokio::task::spawn_blocking(move || {
        if algo == "sha256" {
            use sha2::{Sha256, Digest};
            use std::io::Read;
            let f = std::fs::File::open(&p).map_err(|e| e.to_string())?;
            let mut reader = std::io::BufReader::with_capacity(65536, f);
            let mut hasher = Sha256::new();
            let mut buf = [0u8; 65536];
            loop {
                let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
                if n == 0 { break; }
                hasher.update(&buf[..n]);
            }
            Ok(hex::encode(hasher.finalize()))
        } else {
            // blake3 (default) — strip the "b3:" prefix compute_file_hash adds.
            crate::fs_utils::compute_file_hash(&p)
                .map(|h| h.trim_start_matches("b3:").to_string())
                .map_err(|e| e.to_string())
        }
    }).await.map_err(|e| e.to_string())?
}
