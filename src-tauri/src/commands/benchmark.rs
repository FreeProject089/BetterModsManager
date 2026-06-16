use sysinfo::System;
use tauri::{Window, State};
use std::sync::atomic::Ordering;
use crate::state::AppState;
use serde::{Serialize, Deserialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BenchmarkPoint {
    pub timestamp: u64,
    pub cpu_usage: f32,
    pub ram_usage: u64, // MB
    pub disk_read: u64, // KB/s
    pub disk_write: u64, // KB/s
    pub current_mod: Option<String>,
    // Advanced Metrics
    pub network_latency: Option<u64>, // ms
    pub thread_count: Option<u32>,
    pub ram_virtual: Option<u64>, // MB
    pub ram_swap: Option<u64>, // MB
    pub async_tasks: Option<u32>,
    pub global_cpu: Option<f32>,
    pub process_uptime: Option<u64>,
}

#[tauri::command]
pub fn is_benchmark_enabled(_app_handle: tauri::AppHandle) -> bool {
    true
}

#[tauri::command]
pub fn set_advanced_benchmark_mode(state: State<'_, AppState>, enabled: bool) {
    state.advanced_benchmark.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
pub async fn start_benchmark(window: Window, state: State<'_, AppState>) -> Result<(), String> {
    if state.benchmark_running.load(Ordering::SeqCst) {
        return Ok(());
    }

    state.benchmark_running.store(true, Ordering::SeqCst);
    let running = state.benchmark_running.clone();
    let is_advanced = state.advanced_benchmark.clone();

    tauri::async_runtime::spawn(async move {
        let mut sys = System::new_all();
        let pid = sysinfo::get_current_pid().ok();
        let core_count = sys.cpus().len() as f32;
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(500))
            .build()
            .ok();

        while running.load(Ordering::SeqCst) {
            let advanced = is_advanced.load(Ordering::SeqCst);
            
            if advanced {
                sys.refresh_all();
            } else {
                sys.refresh_processes();
                sys.refresh_cpu();
            }
            
            let mut cpu = 0.0;
            let mut ram = 0;
            let mut disk_r = 0;
            let mut disk_w = 0;
            let threads = None;
            let mut v_ram = None;
            let mut swap = None;
            let mut global_cpu = None;
            let mut uptime = None;

            if let Some(p_id) = pid {
                if let Some(process) = sys.process(p_id) {
                    // Process CPU usage is usually normalized 0-100% across all cores in sysinfo
                    cpu = process.cpu_usage() / if core_count > 0.0 { core_count } else { 1.0 };
                    ram = process.memory() / 1024 / 1024; // MB
                    disk_r = process.disk_usage().read_bytes / 1024; // KB
                    disk_w = process.disk_usage().written_bytes / 1024; // KB
                    
                    if advanced {
                        // On windows/linux thread_count is usually available
                        // Depending on sysinfo version, it might be thread_count()
                        // If not available, we omit it
                        v_ram = Some(process.virtual_memory() / 1024 / 1024);
                        uptime = Some(process.run_time());
                    }
                }
            }

            if advanced {
                swap = Some(sys.used_swap() / 1024 / 1024);
                // Global CPU usage
                global_cpu = Some(sys.global_cpu_info().cpu_usage());
            }

            // Network Latency Check (Advanced only)
            let mut latency = None;
            if advanced {
                if let Some(ref c) = client {
                    let start = std::time::Instant::now();
                    if let Ok(_) = c.head("https://www.google.com").send().await {
                        latency = Some(start.elapsed().as_millis() as u64);
                    }
                }
            }

            let point = BenchmarkPoint {
                timestamp: SystemTime::now().duration_since(UNIX_EPOCH).expect("Time went backwards").as_secs(),
                cpu_usage: cpu,
                ram_usage: ram,
                disk_read: disk_r,
                disk_write: disk_w,
                current_mod: None,
                network_latency: latency,
                thread_count: threads, // Note: sysinfo 0.29+ has thread_count()
                ram_virtual: v_ram,
                ram_swap: swap,
                async_tasks: None,
                global_cpu,
                process_uptime: uptime,
            };

            let _ = window.emit("benchmark-point", point);
            
            let poll_rate = if advanced { 500 } else { 1000 };
            tokio::time::sleep(std::time::Duration::from_millis(poll_rate)).await;
        }
    });

    Ok(())
}

#[tauri::command]
pub fn stop_benchmark(state: State<AppState>) {
    state.benchmark_running.store(false, Ordering::SeqCst);
}

#[tauri::command]
pub fn read_file_text(path: String) -> Result<String, String> {
    // CWE-73 hardening: this command is reachable from the WebView. Reject path
    // traversal and restrict to text formats — the only caller imports a benchmark
    // session `.csv`. This limits arbitrary-file read (defense in depth; a full
    // fix would pass a dialog-chosen handle rather than a free path).
    if path.contains("..") {
        return Err("Refused: path traversal".to_string());
    }
    const OK_EXT: &[&str] = &["csv", "json", "txt", "md", "log", "ini", "cfg", "xml", "yml", "yaml", "html"];
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !OK_EXT.contains(&ext.as_str()) {
        return Err("Refused: unsupported file type".to_string());
    }
    // Defense in depth: refuse obvious credential/secret-store locations even when
    // they carry an allowed extension (e.g. a browser `Login Data`/`.json` token store).
    let norm = path.replace('/', "\\").to_lowercase();
    const BLOCKED_READ_DIRS: &[&str] = &[
        r"\.ssh\", r"\.aws\", r"\.gnupg\", r"\.config\gh\",
        r"\appdata\local\google\chrome\user data", r"\appdata\roaming\mozilla",
        r"\microsoft\credentials", r"\windows\system32",
    ];
    if BLOCKED_READ_DIRS.iter().any(|d| norm.contains(d)) {
        return Err("Refused: protected location".to_string());
    }
    // Bound the read so a free-path read can't slurp a huge file into the WebView.
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > 25 * 1024 * 1024 {
            return Err("Refused: file too large (max 25 MB)".to_string());
        }
    }
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

// ─────────────────────────────────────────────────────────────────────────────
// In-app operation benchmark
// ─────────────────────────────────────────────────────────────────────────────
// Runs BMM's REAL hot-path operations (scan, hash, copy, archive extract, mod
// activation/deactivation, cancel) against a controlled workspace and reports
// timings + throughput. Two modes:
//   - "sandbox": a synthetic mod tree generated in a temp dir (safe, reproducible)
//   - "real":    uses the active profile's mod folder as the DATASET (passed from
//                the frontend as `real_source`). All operations still run inside a
//                temp workspace — the user's game folder is NEVER modified.

use std::path::{Path, PathBuf};
use std::collections::HashSet;
use std::time::Instant;

#[derive(Serialize, Clone)]
pub struct BenchOpResult {
    pub id: String,
    pub label: String,
    pub category: String,      // "scan" | "hash" | "io" | "archive" | "activation"
    pub explanation: String,
    pub ms: f64,               // median across samples
    pub min_ms: f64,
    pub max_ms: f64,
    pub samples: Vec<f64>,     // every per-rep timing (ms), for the distribution view
    pub bytes: u64,
    pub items: u64,
    pub throughput_mb_s: Option<f64>, // from the median
    pub note: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct BenchEnv {
    pub mode: String,
    pub os: String,
    pub cores: usize,
    pub dataset_bytes: u64,
    pub dataset_files: u64,
    pub smart_io: bool,
    pub reps: usize,
    /// Drive/root the workspace ran on (e.g. "E:\\") — for "My mods" this is the
    /// profile's / folder's real disk, so I/O numbers reflect that drive.
    pub disk: String,
}

/// (median, min, max) of a sample set in ms.
fn med_min_max(mut v: Vec<f64>) -> (f64, f64, f64) {
    if v.is_empty() { return (0.0, 0.0, 0.0); }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = v.len();
    let med = if n % 2 == 1 { v[n / 2] } else { (v[n / 2 - 1] + v[n / 2]) / 2.0 };
    (med, v[0], v[n - 1])
}

#[derive(Serialize, Clone)]
pub struct BenchReport {
    pub env: BenchEnv,
    pub results: Vec<BenchOpResult>,
    pub total_ms: f64,
}

/// Deterministic synthetic file tree (LCG-filled). Returns (total_bytes, file_count).
fn gen_tree(root: &Path, files: usize, dirs: usize, avg: usize, seed: u64) -> std::io::Result<(u64, u64)> {
    std::fs::create_dir_all(root)?;
    let mut s: u64 = seed | 1;
    let mut next = move || { s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407); (s >> 33) as u32 };
    let mut total = 0u64;
    for i in 0..files {
        let d = i % dirs.max(1);
        let sub = root.join(format!("cat_{:02}", d)).join(format!("grp_{}", d % 3));
        std::fs::create_dir_all(&sub)?;
        let ext = ["dds", "lua", "cfg", "txt", "bin"][i % 5];
        let path = sub.join(format!("asset_{:04}.{}", i, ext));
        let size = avg / 2 + (next() as usize % avg.max(1));
        let mut buf = vec![0u8; size];
        // ~60% repeated dictionary + 40% noise → realistic compressibility.
        let dict = next();
        for (j, b) in buf.iter_mut().enumerate() {
            *b = if (next() & 0x3) != 0 { (dict.wrapping_add(j as u32) & 0xFF) as u8 } else { (next() & 0xFF) as u8 };
        }
        std::fs::write(&path, &buf)?;
        total += size as u64;
    }
    Ok((total, files as u64))
}

/// Copy a real folder into `dst` but cap total size/file-count so a huge profile
/// can't make the benchmark run forever. Returns (bytes, files) actually copied.
fn copy_capped(src: &Path, dst: &Path, max_bytes: u64, max_files: usize) -> std::io::Result<(u64, u64)> {
    std::fs::create_dir_all(dst)?;
    let mut bytes = 0u64;
    let mut count = 0u64;
    for entry in jwalk::WalkDir::new(src).into_iter().filter_map(|e| e.ok()) {
        if count as usize >= max_files || bytes >= max_bytes { break; }
        if !entry.file_type().is_file() { continue; }
        let p = entry.path();
        let rel = match p.strip_prefix(src) { Ok(r) => r, Err(_) => continue };
        let out = dst.join(rel);
        if let Some(parent) = out.parent() { std::fs::create_dir_all(parent).ok(); }
        if std::fs::copy(&p, &out).is_ok() {
            bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
            count += 1;
        }
    }
    Ok((bytes, count))
}

fn tput(bytes: u64, ms: f64) -> Option<f64> {
    if ms <= 0.0 { return None; }
    Some((bytes as f64 / 1_000_000.0) / (ms / 1000.0))
}

/// Run the full in-app operation benchmark. Emits `app-benchmark-progress`
/// ({ step, total, label }) as it goes, and returns the structured report.
#[tauri::command]
pub async fn run_app_benchmark(
    window: Window,
    mode: String,
    real_sources: Option<Vec<String>>,
    scale: Option<String>,
) -> Result<BenchReport, String> {
    // Refuse to start a second run while one is still in flight (e.g. a just-
    // cancelled run that hasn't finished aborting). Without this, two runs would
    // share the same temp workspace and the new run would clear the cancel flag
    // out from under the old one. The frontend turns this into a "try again" hint.
    if BENCH_RUNNING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return Err("A benchmark is already running".to_string());
    }
    struct RunningGuard;
    impl Drop for RunningGuard {
        fn drop(&mut self) { BENCH_RUNNING.store(false, std::sync::atomic::Ordering::SeqCst); }
    }
    let _guard = RunningGuard; // clears BENCH_RUNNING on any exit (ok / err / panic)

    let res = tauri::async_runtime::spawn_blocking(move || run_app_benchmark_blocking(window, mode, real_sources, scale))
        .await
        .map_err(|e| format!("benchmark task failed: {e}"))?;
    res
}

/// Set when the user cancels a running benchmark; checked at each step boundary
/// AND between reps of the long steps so cancellation is responsive.
static BENCH_CANCEL: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// True while a run is in flight, to reject overlapping runs.
static BENCH_RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Request cancellation of an in-progress benchmark. The run aborts at the next
/// step/rep boundary and returns a "cancelled" error to the caller.
#[tauri::command]
pub fn cancel_app_benchmark() {
    BENCH_CANCEL.store(true, std::sync::atomic::Ordering::SeqCst);
}

fn run_app_benchmark_blocking(
    window: Window,
    mode: String,
    real_sources: Option<Vec<String>>,
    scale: Option<String>,
) -> Result<BenchReport, String> {
    use crate::{archive, fs_utils};
    // Start from a clean cancel state for this run.
    BENCH_CANCEL.store(false, std::sync::atomic::Ordering::SeqCst);
    let e2s = |e: std::io::Error| e.to_string();

    // Scale presets (file count / dirs / avg file size) for the synthetic dataset.
    // Approx total = files × avg: small ≈ 6 MB, medium ≈ 48 MB, large ≈ 160 MB,
    // xlarge ≈ 400 MB. (Each op is sampled fewer times at bigger sizes — see `reps`.)
    // A "custom:<MB>[:<files>]" scale targets an explicit total dataset size, and
    // optionally an explicit file count (for stress-testing many-file scans). When
    // the count is omitted it's derived from ~256 KB average files. Both are
    // clamped to sane ceilings (8 GB / 200k files).
    let custom: Option<(usize, Option<usize>)> = scale.as_deref()
        .and_then(|s| s.strip_prefix("custom:"))
        .map(|rest| {
            let mut p = rest.split(':');
            let mb = p.next().and_then(|n| n.trim().parse::<usize>().ok()).unwrap_or(250).clamp(1, 8192);
            let files = p.next().and_then(|n| n.trim().parse::<usize>().ok()).map(|f| f.clamp(1, 200_000));
            (mb, files)
        });
    let custom_mb: Option<usize> = custom.map(|(mb, _)| mb);
    let (files, dirs, avg) = if let Some((mb, files_opt)) = custom {
        let total = mb * 1024 * 1024;
        // Use the requested file count, else derive from ~256 KB average files.
        let files = files_opt.unwrap_or_else(|| (total / (256 * 1024)).max(8));
        let avg = (total / files).max(1);               // total stays ≈ mb MB
        // ≈√files directories → a deeper, wider tree like a real large library.
        let dirs = ((files as f64).sqrt().round() as usize).clamp(1, 1024);
        (files, dirs, avg)
    } else {
        match scale.as_deref().unwrap_or("medium") {
            "small"  => (180usize, 10usize, 32 * 1024usize),
            "large"  => (500, 16, 320 * 1024),
            "xlarge" => (800, 20, 512 * 1024),
            _ => (300, 12, 160 * 1024),
        }
    };

    let is_real = mode == "real";

    // For "My mods", run the benchmark on the SAME DRIVE as the source — the
    // profile's mods folder, or the imported folder — so disk throughput reflects
    // where those mods actually live, not the system temp drive. (Activation,
    // copy, extract… all happen next to the real data.) Sandbox uses the system
    // temp dir; we also fall back to it if the source drive isn't writable.
    let mut root = std::env::temp_dir().join(format!("bmm_app_bench_{}", std::process::id()));
    if is_real {
        if let Some(first) = real_sources.as_ref().and_then(|s| s.iter().find(|p| !p.is_empty() && Path::new(p).exists())) {
            let src_path = Path::new(first);
            let anchor = src_path.parent().unwrap_or(src_path);
            root = anchor.join(format!(".bmm_bench_{}", std::process::id()));
        }
    }
    let _ = std::fs::remove_dir_all(&root);
    if std::fs::create_dir_all(&root).is_err() {
        // Source drive not writable → fall back to the system temp dir.
        root = std::env::temp_dir().join(format!("bmm_app_bench_{}", std::process::id()));
        std::fs::create_dir_all(&root).map_err(e2s)?;
    }
    let mod_dir = root.join("mod_src");
    let game_dir = root.join("game");
    let backup_dir = root.join("backup");
    let copy_dst = root.join("copy_dst");
    let extract_dst = root.join("extract_dst");
    let cancel_mod = root.join("cancel_mod");
    let cancel_game = root.join("cancel_game");
    let cancel_backup = root.join("cancel_backup");

    let (dataset_bytes, dataset_files): (u64, u64);

    // Build the primary dataset.
    if is_real {
        let srcs = real_sources.unwrap_or_default();
        if srcs.is_empty() {
            return Err("Real mode needs at least one profile or folder".into());
        }
        // Aggregate every selected source into its own sub-dir of the workspace
        // (namespaced by index so identical relative paths don't collide).
        // Global cap of 200 MB / 6000 files so a huge selection can't hang the bench.
        let cap_b = 200 * 1024 * 1024u64;
        let cap_n = 6000usize;
        let mut tot_b = 0u64;
        let mut tot_n = 0u64;
        for (i, src) in srcs.iter().enumerate() {
            if src.is_empty() || !Path::new(src).exists() { continue; }
            if tot_b >= cap_b || tot_n as usize >= cap_n { break; }
            let (b, n) = copy_capped(Path::new(src), &mod_dir.join(format!("src{i}")), cap_b - tot_b, cap_n - tot_n as usize).map_err(e2s)?;
            tot_b += b; tot_n += n;
        }
        if tot_n == 0 { return Err("No files found in the selected profile(s) / folder(s)".into()); }
        dataset_bytes = tot_b; dataset_files = tot_n;
    } else {
        let (b, n) = gen_tree(&mod_dir, files, dirs, avg, 0xBADC0FFE).map_err(e2s)?;
        dataset_bytes = b; dataset_files = n;
    }

    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
    let smart_io = true;
    // Each operation is sampled several times so we get a real distribution
    // (median + min/max), like Criterion — not a single noisy value. Fewer reps
    // for the bigger dataset to keep total wall time reasonable.
    let reps: usize = if let Some(mb) = custom_mb {
        // Derive reps from the requested size so big customs stay reasonable.
        if mb <= 20 { 7 } else if mb <= 120 { 5 } else if mb <= 320 { 3 } else { 2 }
    } else {
        match scale.as_deref().unwrap_or("medium") { "small" => 7, "large" => 3, "xlarge" => 2, _ => 5 }
    };
    let total_steps = 10u32;
    let emit = |step: u32, label: &str| -> Result<(), String> {
        if BENCH_CANCEL.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("Benchmark cancelled".to_string());
        }
        let _ = window.emit("app-benchmark-progress", serde_json::json!({ "step": step, "total": total_steps, "label": label }));
        Ok(())
    };
    let ms_of = |t: Instant| t.elapsed().as_secs_f64() * 1000.0;

    // Builds a result from a sample set (no capture of `results`, so it can't
    // conflict with moving `results` into the report later).
    let make = |id: &str, label: &str, category: &str, explanation: &str, samples: Vec<f64>, bytes: u64, items: u64, has_tput: bool, note: Option<String>| -> BenchOpResult {
        let (med, mn, mx) = med_min_max(samples.clone());
        BenchOpResult {
            id: id.into(), label: label.into(), category: category.into(), explanation: explanation.into(),
            ms: med, min_ms: mn, max_ms: mx, samples,
            bytes, items,
            throughput_mb_s: if has_tput { tput(bytes, med) } else { None },
            note,
        }
    };

    let mut results: Vec<BenchOpResult> = Vec::new();
    let bench_start = Instant::now();

    // 1. SCAN — recursive directory walk (jwalk), as on every mod read.
    emit(1, "Scanning mod files")?;
    let mut s = Vec::new();
    let mut scanned = Vec::new();
    for _ in 0..reps { let t = Instant::now(); scanned = fs_utils::list_mod_files(&mod_dir).map_err(|e| e.to_string())?; s.push(ms_of(t)); }
    let nfiles = scanned.len();
    results.push(make("scan", "Scan mod files", "scan",
        "Recursively walks the mod folder to enumerate every file (jwalk). Done whenever BMM reads a mod — hashing, conflicts, the file explorer.",
        s, dataset_bytes, nfiles as u64, false, Some(format!("{} files", nfiles))));

    // 2. HASH — BLAKE3 content hash of every file (the local change-detection /
    //    file_hashes workload). BLAKE3 is a tree hash, so it parallelises both
    //    across files AND within a single large file (mmap + rayon).
    emit(2, "Hashing files (BLAKE3)")?;
    let hash_items: Vec<((), std::path::PathBuf)> = scanned.iter().map(|rel| ((), mod_dir.join(rel))).collect();
    let mut s = Vec::new();
    let mut hashed = 0u64;
    for _ in 0..reps {
        let t = Instant::now();
        hashed = fs_utils::compute_file_hash_bulk(&hash_items).len() as u64;
        s.push(ms_of(t));
    }
    results.push(make("hash", "Content hash (BLAKE3)", "hash",
        "Computes a BLAKE3 hash of every file — across all cores AND within each large file (mmap tree hash). This is the local file_hashes / change-detection workload. (Repo delta-sync and download verification keep SHA-256 as their wire format.)",
        s, dataset_bytes, hashed, true, None));

    // 3. COPY full-speed — std::fs::copy of the whole mod.
    emit(3, "Copying (full speed)")?;
    let mut s = Vec::new();
    for _ in 0..reps {
        let _ = std::fs::remove_dir_all(&copy_dst);
        let t = Instant::now();
        for rel in &scanned { let _ = fs_utils::copy_file_force_smart(&mod_dir.join(rel), &copy_dst.join(rel), None, false); }
        s.push(ms_of(t));
    }
    results.push(make("copy_full", "Copy — full speed", "io",
        "Copies every file at maximum speed (std::fs::copy). This is the raw disk throughput BMM gets when Smart I/O is off.",
        s, dataset_bytes, nfiles as u64, true, None));

    // 4. COPY smart-IO — 256 KiB chunked copy with periodic yields.
    emit(4, "Copying (Smart I/O)")?;
    let mut s = Vec::new();
    for _ in 0..reps {
        let _ = std::fs::remove_dir_all(&copy_dst);
        let t = Instant::now();
        for rel in &scanned { let _ = fs_utils::copy_file_force_smart(&mod_dir.join(rel), &copy_dst.join(rel), None, true); }
        s.push(ms_of(t));
    }
    results.push(make("copy_smart", "Copy — Smart I/O", "io",
        "Copies every file in 256 KiB chunks with periodic micro-yields so the UI stays responsive during big activations. Slightly slower than full-speed by design.",
        s, dataset_bytes, nfiles as u64, true, None));

    // 5. ARCHIVE extract — build a .zip of the mod once, then extract it each rep.
    emit(5, "Extracting archive (.zip)")?;
    let zip_path = root.join("mod.zip");
    build_zip(&mod_dir, &scanned, &zip_path).map_err(e2s)?;
    let mut s = Vec::new();
    for _ in 0..reps {
        if BENCH_CANCEL.load(std::sync::atomic::Ordering::SeqCst) { return Err("Benchmark cancelled".to_string()); }
        let _ = std::fs::remove_dir_all(&extract_dst);
        let t = Instant::now();
        archive::extract_to(&zip_path, &extract_dst).map_err(|e| e.to_string())?;
        s.push(ms_of(t));
    }
    results.push(make("archive_extract", "Extract archived mod (.zip)", "archive",
        "Decompresses a zipped mod to the cache dir — what happens the first time an archived (.zip/.7z/.rar) mod is read or activated. Throughput is vs the uncompressed size.",
        s, dataset_bytes, nfiles as u64, true, None));

    // 6. ACTIVATE — real apply_mod_stacked, sampled with an unapply reset between reps.
    emit(6, "Activating mod")?;
    let _ = std::fs::remove_dir_all(&game_dir);
    let _ = std::fs::remove_dir_all(&backup_dir);
    std::fs::create_dir_all(&game_dir).ok();
    let mut s = Vec::new();
    let mut applied_n = 0u64;
    for _ in 0..reps {
        fs_utils::reset_mod_op_cancel();
        let t = Instant::now();
        let applied = fs_utils::apply_mod_stacked(&mod_dir, &game_dir, &backup_dir, &HashSet::new(), None, None, smart_io).map_err(|e| e.to_string())?;
        s.push(ms_of(t));
        applied_n = applied.len() as u64;
        // Reset for the next rep (untimed).
        let rm: Vec<String> = applied.iter().map(|p| p.to_string_lossy().to_string()).collect();
        let _ = fs_utils::unapply_mod_stacked(&game_dir, &backup_dir, rm, &[], None, smart_io);
    }
    results.push(make("activate", "Activate mod (unpacked)", "activation",
        "Enabling an already-unpacked mod: backs up any original game files, then copies the mod's files into the game folder (stacked, parallel). This is what 'enable' does for a folder mod.",
        s, dataset_bytes, applied_n, true, None));

    // 7. ACTIVATE (archived) — cold-enable a zipped mod: extract the .zip, then
    //    apply it. Includes the one-time extraction, so it's the real first-time
    //    cost of enabling an archived mod (vs the unpacked Activate above).
    emit(7, "Activating archived mod (.zip)")?;
    let _ = std::fs::remove_dir_all(&game_dir);
    let _ = std::fs::remove_dir_all(&backup_dir);
    std::fs::create_dir_all(&game_dir).ok();
    let mut s = Vec::new();
    let mut applied_zip_n = 0u64;
    for _ in 0..reps {
        if BENCH_CANCEL.load(std::sync::atomic::Ordering::SeqCst) { return Err("Benchmark cancelled".to_string()); }
        fs_utils::reset_mod_op_cancel();
        let _ = std::fs::remove_dir_all(&extract_dst);
        let t = Instant::now();
        archive::extract_to(&zip_path, &extract_dst).map_err(|e| e.to_string())?;
        let applied = fs_utils::apply_mod_stacked(&extract_dst, &game_dir, &backup_dir, &HashSet::new(), None, None, smart_io).map_err(|e| e.to_string())?;
        s.push(ms_of(t));
        applied_zip_n = applied.len() as u64;
        let rm: Vec<String> = applied.iter().map(|p| p.to_string_lossy().to_string()).collect();
        let _ = fs_utils::unapply_mod_stacked(&game_dir, &backup_dir, rm, &[], None, smart_io);
    }
    results.push(make("activate_zip", "Activate archived mod (.zip)", "activation",
        "Cold-enabling a zipped mod: decompress the .zip to cache, then apply its files. Includes the one-time extraction — the real cost the first time you enable an archived (.zip/.7z/.rar) mod. The gap vs the unpacked Activate is the decompression overhead.",
        s, dataset_bytes, applied_zip_n, true, None));

    // 8. DEACTIVATE — real unapply_mod_stacked; apply (untimed) then time the unapply.
    emit(8, "Deactivating mod")?;
    let mut s = Vec::new();
    for _ in 0..reps {
        fs_utils::reset_mod_op_cancel();
        let applied = fs_utils::apply_mod_stacked(&mod_dir, &game_dir, &backup_dir, &HashSet::new(), None, None, smart_io).map_err(|e| e.to_string())?;
        let rm: Vec<String> = applied.iter().map(|p| p.to_string_lossy().to_string()).collect();
        let t = Instant::now();
        fs_utils::unapply_mod_stacked(&game_dir, &backup_dir, rm, &[], None, smart_io).map_err(|e| e.to_string())?;
        s.push(ms_of(t));
    }
    results.push(make("deactivate", "Deactivate mod", "activation",
        "The real deactivation path: for each file, restores the backed-up original (or removes a mod-added file) and cleans empty dirs. This is exactly what 'disable' does.",
        s, dataset_bytes, applied_n, true, None));

    // 9. CANCEL — start a large activation, request cancel, measure abort latency (sampled).
    emit(9, "Testing cancel responsiveness")?;
    let _ = gen_tree(&cancel_mod, 8, 2, 6 * 1024 * 1024, 0x1234); // ~48 MB, few big files
    let cancel_reps = reps.min(3).max(1);
    let mut s = Vec::new();
    for _ in 0..cancel_reps {
        let _ = std::fs::remove_dir_all(&cancel_game);
        std::fs::create_dir_all(&cancel_game).ok();
        fs_utils::reset_mod_op_cancel();
        let cm = cancel_mod.clone(); let cg = cancel_game.clone(); let cb = cancel_backup.clone();
        let handle = std::thread::spawn(move || {
            let _ = fs_utils::apply_mod_stacked(&cm, &cg, &cb, &HashSet::new(), None, None, true);
        });
        std::thread::sleep(std::time::Duration::from_millis(40)); // let it get going
        let cancel_t = Instant::now();
        fs_utils::request_mod_op_cancel();
        let _ = handle.join();
        s.push(ms_of(cancel_t));
        fs_utils::reset_mod_op_cancel();
    }
    results.push(make("cancel", "Cancel an operation", "activation",
        "Starts a large (~48 MB) activation, then measures how quickly it stops after Cancel is requested. Lower = snappier cancellation; BMM checks the cancel flag between files.",
        s, 0, 1, false, Some("time from cancel → fully stopped".into())));

    // 10. VERIFY — re-hash every file and compare it to a precomputed digest. This
    //    is the integrity-verification workload (confirm a download, detect a
    //    tampered/corrupt mod), distinct from raw hashing because it also compares.
    emit(10, "Verifying (BLAKE3 compare)")?;
    let verify_items: Vec<(usize, std::path::PathBuf)> = scanned.iter().enumerate()
        .map(|(i, rel)| (i, mod_dir.join(rel))).collect();
    // Precompute the expected digest per file (indexed), once, in parallel.
    let mut expected: Vec<Option<String>> = vec![None; scanned.len()];
    for (i, h) in fs_utils::compute_file_hash_bulk(&verify_items) { expected[i] = Some(h); }
    let mut s = Vec::new();
    let mut verified = 0u64;
    let mut mismatches = 0u64;
    for _ in 0..reps {
        let t = Instant::now();
        let mut ok = 0u64;
        let mut bad = 0u64;
        // Re-hash everything in parallel, then compare each result to its baseline.
        for (i, got) in fs_utils::compute_file_hash_bulk(&verify_items) {
            match &expected[i] {
                Some(e) if e == &got => ok += 1,
                Some(_) => bad += 1,
                None => {}
            }
        }
        verified = ok; mismatches = bad; s.push(ms_of(t));
    }
    let vnote = if mismatches == 0 {
        format!("{} files verified — all match", verified)
    } else {
        format!("{} mismatch(es) detected!", mismatches)
    };
    results.push(make("verify", "Integrity verification (BLAKE3)", "hash",
        "Re-hashes every file (BLAKE3) and compares it against the stored baseline — the integrity check BMM runs to detect a tampered or corrupt mod.",
        s, dataset_bytes, verified, true, Some(vnote)));

    let total_ms = bench_start.elapsed().as_secs_f64() * 1000.0;

    // Drive/root the workspace lived on (reported so the user sees which disk).
    let disk = root.ancestors().last().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();

    // Clean up the whole workspace.
    let _ = std::fs::remove_dir_all(&root);

    Ok(BenchReport {
        env: BenchEnv {
            mode: if is_real { "real".into() } else { "sandbox".into() },
            os: std::env::consts::OS.into(),
            cores,
            dataset_bytes, dataset_files, smart_io, reps, disk,
        },
        results,
        total_ms,
    })
}

/// Build a deflate .zip of the given files (relative to `root`) for the archive test.
fn build_zip(root: &Path, files: &[PathBuf], dest: &Path) -> std::io::Result<()> {
    use std::io::Write;
    let f = std::fs::File::create(dest)?;
    let mut zw = zip::ZipWriter::new(f);
    let opts = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for rel in files {
        let name = rel.to_string_lossy().replace('\\', "/");
        zw.start_file(name, opts).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
        let bytes = std::fs::read(root.join(rel))?;
        zw.write_all(&bytes)?;
    }
    zw.finish().map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn export_benchmark_csv(data_json: String, dest_path: String) -> Result<(), String> {
    let points: Vec<BenchmarkPoint> = serde_json::from_str(&data_json)
        .map_err(|e| format!("Invalid data: {}", e))?;

    let mut csv = String::from("Timestamp,CPU (%),RAM (MB),Disk Read (KB/s),Disk Write (KB/s),Net Latency (ms),Virtual Mem (MB),Swap (MB),Global CPU (%),Uptime (s)\n");
    for p in points {
        csv.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{}\n",
            p.timestamp, 
            p.cpu_usage, 
            p.ram_usage, 
            p.disk_read, 
            p.disk_write,
            p.network_latency.unwrap_or(0),
            p.ram_virtual.unwrap_or(0),
            p.ram_swap.unwrap_or(0),
            p.global_cpu.unwrap_or(0.0),
            p.process_uptime.unwrap_or(0)
        ));
    }

    std::fs::write(dest_path, csv).map_err(|e| e.to_string())?;
    Ok(())
}
