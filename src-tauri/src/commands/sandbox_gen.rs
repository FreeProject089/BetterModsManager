//! A generated mod library, for benchmarking and for looking at screens with data in them.
//!
//! WHY IT IS NOT WIRED INTO YOUR REAL LIBRARY.
//!
//! BCWEB's generator writes into a dev database that exists to be thrown away. BMM's data is
//! the user's actual mods, profiles and paths — a generator that wrote there would be a tool
//! whose failure mode is "your library now contains four hundred things you did not install",
//! and no amount of marking makes that recoverable in the way a `deleteMany` is.
//!
//! So this builds a SELF-CONTAINED library under one clearly named root, which the benchmark
//! can point at and which `clear_sandbox_library` removes wholesale. Nothing here reads or
//! writes the real profile store.
//!
//! What it produces is relational, not just a pile of files: profiles that reference mods by
//! id, mods that exist on disk with plausible sizes and a long-tail distribution, and a
//! manifest tying them together. The existing benchmark sandbox lays down a file tree, which
//! measures I/O well and tells you nothing about how a screen behaves with 40 profiles.
//!
//! Deterministic: the same seed produces the same library, byte for byte. A benchmark that
//! compares two runs needs that, and so does "did my change alter this number".

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// One generated mod: what a scanner would find, plus where it is.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxMod {
    pub id: String,
    pub name: String,
    pub folder: String,
    pub bytes: u64,
    pub files: u64,
}

/// One generated profile, referencing mods by id — the relation that makes this more than
/// a directory of files.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxProfile {
    pub id: String,
    pub name: String,
    pub active_mods: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxLibrary {
    pub root: String,
    pub seed: u64,
    pub scale: String,
    pub profiles: Vec<SandboxProfile>,
    pub mods: Vec<SandboxMod>,
    pub total_bytes: u64,
    pub total_files: u64,
}

/// The one place a generated library may live. A fixed name under the system temp dir, so
/// `clear_sandbox_library` can remove it without being told where it is, and so a stale one
/// from a killed run is found rather than orphaned.
pub fn sandbox_root() -> PathBuf {
    std::env::temp_dir().join("bmm_sandbox_library")
}

/// profiles × mods-per-profile × files-per-mod × average file size.
///
/// Sizes are small on purpose. This exists to make screens and scans realistic, not to fill
/// a disk: the largest scale is a few hundred megabytes, and somebody who wants I/O pressure
/// wants the benchmark's own custom-MB mode instead.
fn dims(scale: &str) -> (usize, usize, usize, usize) {
    match scale {
        "small" => (3, 12, 6, 24 * 1024),
        "large" => (40, 60, 14, 96 * 1024),
        _ => (10, 30, 10, 48 * 1024),
    }
}

/// Deterministic PRNG. Same LCG the benchmark's tree uses, kept identical so a library and a
/// bench tree built from one seed stay related rather than merely both being "random".
fn lcg(seed: u64) -> impl FnMut() -> u32 {
    let mut s: u64 = seed | 1;
    move || {
        s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (s >> 33) as u32
    }
}

const NOUNS: [&str; 10] = [
    "cockpit", "livery", "terrain", "sound", "weapon", "hud", "campaign", "skin", "engine", "radio",
];
const ADJ: [&str; 8] = ["hi-res", "realistic", "lite", "extended", "classic", "modern", "compact", "pro"];

/// Build a library. Replaces any existing one — two half-built libraries in one place is a
/// state nothing can reason about, and re-running is not a mistake worth punishing.
pub fn build(scale: &str, seed: u64) -> Result<SandboxLibrary, String> {
    let root = sandbox_root();
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;

    let (n_profiles, mods_per, files_per, avg) = dims(scale);
    let mut next = lcg(seed);
    let mut mods: Vec<SandboxMod> = Vec::new();
    let mut total_bytes = 0u64;
    let mut total_files = 0u64;

    let mods_dir = root.join("mods");
    for i in 0..(n_profiles * mods_per) {
        let name = format!(
            "{} {} {}",
            ADJ[(next() as usize) % ADJ.len()],
            NOUNS[(next() as usize) % NOUNS.len()],
            i
        );
        let folder = format!("mod_{:04}", i);
        let dir = mods_dir.join(&folder);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

        // A long tail: a few large mods, most small. A uniform library makes every
        // sort-by-size and every progress bar behave in a way the real one never does.
        let heavy = (next() % 100) < 8;
        let files = if heavy { files_per * 4 } else { files_per };
        let mut bytes = 0u64;
        for f in 0..files {
            let size = if heavy { avg * 4 } else { avg / 2 + (next() as usize % avg.max(1)) };
            let mut buf = vec![0u8; size];
            // Filled from the PRNG rather than zeroed: a file of zeroes compresses to
            // nothing, and a benchmark over it measures the filesystem's cleverness rather
            // than the work BMM would actually do.
            for chunk in buf.chunks_mut(4) {
                let v = next().to_le_bytes();
                chunk.copy_from_slice(&v[..chunk.len()]);
            }
            std::fs::write(dir.join(format!("file_{:03}.bin", f)), &buf).map_err(|e| e.to_string())?;
            bytes += size as u64;
            total_files += 1;
        }
        total_bytes += bytes;
        mods.push(SandboxMod { id: folder.clone(), name, folder, bytes, files: files as u64 });
    }

    // Profiles reference mods that EXIST. A profile pointing at ids nothing provides is the
    // shape of a broken install, not of a library — and it would make every screen built on
    // the relation render an error state rather than the case being generated.
    let mut profiles = Vec::new();
    for p in 0..n_profiles {
        let slice = &mods[p * mods_per..(p + 1) * mods_per];
        // Roughly half enabled, chosen by the same PRNG so the choice is part of the seed.
        let active: Vec<String> = slice
            .iter()
            .filter(|_| next() % 2 == 0)
            .map(|m| m.id.clone())
            .collect();
        profiles.push(SandboxProfile {
            id: format!("sbx_profile_{:02}", p),
            name: format!("Sandbox profile {}", p + 1),
            active_mods: active,
        });
    }

    let lib = SandboxLibrary {
        root: root.to_string_lossy().to_string(),
        seed,
        scale: scale.to_string(),
        profiles,
        mods,
        total_bytes,
        total_files,
    };
    // The manifest is written last, so its presence means the library finished. A reader
    // finding mods but no manifest knows it is looking at a killed run.
    std::fs::write(
        root.join("library.json"),
        serde_json::to_string_pretty(&lib).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(lib)
}

#[tauri::command]
pub fn generate_sandbox_library(scale: Option<String>, seed: Option<u64>) -> Result<SandboxLibrary, String> {
    build(scale.as_deref().unwrap_or("medium"), seed.unwrap_or(1))
}

/// Remove it, and report what was there. Returns the byte count that went, because "done" is
/// not an answer to "did it actually delete anything".
#[tauri::command]
pub fn clear_sandbox_library() -> Result<u64, String> {
    let root = sandbox_root();
    if !root.exists() {
        return Ok(0);
    }
    let manifest = root.join("library.json");
    let bytes = std::fs::read_to_string(&manifest)
        .ok()
        .and_then(|s| serde_json::from_str::<SandboxLibrary>(&s).ok())
        .map(|l| l.total_bytes)
        .unwrap_or(0);
    std::fs::remove_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(bytes)
}

/// Where the library is, and whether one exists. Lets a UI say "there is one, from seed 7"
/// instead of offering to build a second.
#[tauri::command]
pub fn sandbox_library_info() -> Option<SandboxLibrary> {
    std::fs::read_to_string(sandbox_root().join("library.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    /// One library, one place — so these tests cannot run at the same time.
    ///
    /// sandbox_root() is a single fixed path by design: the tool builds ONE library and
    /// clear removes it without being told where it is. Cargo runs tests in parallel, so
    /// three of them deleted each other's fixtures and failed for reasons that had nothing
    /// to do with the code — proved by re-running with --test-threads=1, where all five
    /// passed. A lock is the fix; requiring a flag would mean a suite that is red by
    /// default and therefore ignored.
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// Take the lock, tolerating a previous test having panicked while holding it — a
    /// poisoned mutex would turn one failure into four.
    fn guard() -> std::sync::MutexGuard<'static, ()> {
        LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn clean() {
        let _ = std::fs::remove_dir_all(sandbox_root());
    }

    #[test]
    fn a_library_is_relational_and_its_profiles_point_at_mods_that_exist() {
        let _g = guard();
        clean();
        let lib = build("small", 42).expect("build");
        assert!(!lib.profiles.is_empty(), "profiles were generated");
        assert!(!lib.mods.is_empty(), "mods were generated");
        let ids: std::collections::HashSet<&str> = lib.mods.iter().map(|m| m.id.as_str()).collect();
        for p in &lib.profiles {
            for id in &p.active_mods {
                assert!(ids.contains(id.as_str()), "profile references a mod that exists: {id}");
            }
        }
        clean();
    }

    #[test]
    fn the_files_are_actually_on_disk_and_the_totals_match() {
        let _g = guard();
        // The counter must count what landed. BCWEB's generator announced 48 items with none
        // in the database an hour ago; the same class of lie is worth a test here.
        clean();
        let lib = build("small", 7).expect("build");
        let mut seen = 0u64;
        for m in &lib.mods {
            let dir = Path::new(&lib.root).join("mods").join(&m.folder);
            let n = std::fs::read_dir(&dir).expect("mod dir exists").count() as u64;
            assert_eq!(n, m.files, "the manifest's file count matches the disk for {}", m.id);
            seen += n;
        }
        assert_eq!(seen, lib.total_files, "the total matches the sum of the parts");
        clean();
    }

    #[test]
    fn the_same_seed_builds_the_same_library() {
        let _g = guard();
        clean();
        let a = build("small", 5).expect("a");
        let names_a: Vec<String> = a.mods.iter().map(|m| m.name.clone()).collect();
        let active_a: Vec<usize> = a.profiles.iter().map(|p| p.active_mods.len()).collect();
        let b = build("small", 5).expect("b");
        assert_eq!(names_a, b.mods.iter().map(|m| m.name.clone()).collect::<Vec<_>>());
        assert_eq!(active_a, b.profiles.iter().map(|p| p.active_mods.len()).collect::<Vec<_>>());
        let c = build("small", 6).expect("c");
        assert_ne!(names_a, c.mods.iter().map(|m| m.name.clone()).collect::<Vec<_>>(), "a different seed differs");
        clean();
    }

    #[test]
    fn clearing_removes_everything_and_reports_it() {
        let _g = guard();
        clean();
        let lib = build("small", 1).expect("build");
        assert!(Path::new(&lib.root).exists());
        let bytes = clear_sandbox_library().expect("clear");
        assert_eq!(bytes, lib.total_bytes, "it reports the size it removed");
        assert!(!Path::new(&lib.root).exists(), "nothing is left");
        // Clearing twice is not an error: a tool you cannot run twice is one you check
        // before running, which is a step nobody takes.
        assert_eq!(clear_sandbox_library().expect("second clear"), 0);
    }

    #[test]
    fn it_never_touches_anything_but_its_own_root() {
        // The property that makes this safe to ship. The root is a fixed name under the
        // system temp dir and every path is built from it.
        let root = sandbox_root();
        assert!(root.starts_with(std::env::temp_dir()), "confined to the temp dir");
        assert!(root.ends_with("bmm_sandbox_library"), "one known name");
    }
}
