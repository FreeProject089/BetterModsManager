//! BMM resource collector — the "how much does BMM consume" companion to the Criterion
//! benches (which measure TIME only). It runs BMM's real hot operations (directory scan,
//! SHA-256 / BLAKE3 hashing, smart-IO copy, archive entry-listing + extraction, and
//! repo-JSON (de)serialization) under a tracking global allocator, and reports the
//! incremental PEAK HEAP and wall-time each one costs. Output is a printed table plus a
//! machine-readable `benchmarks/results/mem-report.json`, so it can run automatically.
//!
//! Run (release for meaningful numbers):
//!   cargo run -p bmm-benchmarks --bin bmm-bench-mem --release
//!
//! Isolation note (same as the rest of this crate): it exercises the REAL archive.rs and
//! faithful FS/JSON mirrors, and is never compiled into the shipped app.

use std::alloc::{GlobalAlloc, Layout, System};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};
use std::time::Instant;

use bmm_benchmarks::fixtures::TreeSpec;
use bmm_benchmarks::repo_schema::ServerRepo;
use bmm_benchmarks::{archive, fixtures, fs_mirror, repo_schema};

// ── Tracking allocator: process-global current + peak live bytes (captures worker-thread
// allocations too). Heap only — BLAKE3's mmap path deliberately shows near-zero heap,
// which is itself the useful signal. ──
struct Tracking;
static CUR: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);
static BASE: AtomicUsize = AtomicUsize::new(0);
unsafe impl GlobalAlloc for Tracking {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        let p = System.alloc(l);
        if !p.is_null() {
            let c = CUR.fetch_add(l.size(), Relaxed) + l.size();
            PEAK.fetch_max(c, Relaxed);
        }
        p
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        System.dealloc(p, l);
        CUR.fetch_sub(l.size(), Relaxed);
    }
}
#[global_allocator]
static ALLOC: Tracking = Tracking;

fn reset_peak() {
    let c = CUR.load(Relaxed);
    BASE.store(c, Relaxed);
    PEAK.store(c, Relaxed);
}
fn peak_kb() -> f64 {
    PEAK.load(Relaxed).saturating_sub(BASE.load(Relaxed)) as f64 / 1024.0
}

struct Row {
    op: &'static str,
    ms: f64,
    peak_kb: f64,
    bytes: u64,
}

fn main() {
    let tmp = std::env::temp_dir().join(format!("bmm-mem-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let root = tmp.join("mod");
    // A "large" tree (few big files) is the memory-relevant case for hashing/copy/extract.
    let files = fixtures::build_tree(&root, TreeSpec::large()).expect("build tree");
    let bytes = fixtures::total_bytes(&files);
    let zip = tmp.join("mod.zip");
    fixtures::make_zip(&root, &files, &zip).expect("zip");
    let zip_bytes = std::fs::metadata(&zip).map(|m| m.len()).unwrap_or(0);

    let mut rows: Vec<Row> = Vec::new();
    macro_rules! timed {
        ($name:expr, $bytes:expr, $body:block) => {{
            reset_peak();
            let t = Instant::now();
            let r = $body;
            rows.push(Row { op: $name, ms: t.elapsed().as_secs_f64() * 1000.0, peak_kb: peak_kb(), bytes: $bytes });
            r
        }};
    }

    timed!("scan_jwalk", bytes, { fs_mirror::scan_jwalk(&root).len() });
    timed!("sha256_all", bytes, {
        for f in &files { let _ = fs_mirror::sha256_file(f); }
    });
    timed!("blake3_all", bytes, {
        for f in &files { let _ = fs_mirror::blake3_file(f); }
    });
    // copy is a single-file op — measure it on the largest file (the memory-relevant case).
    let big = files.iter().max_by_key(|f| std::fs::metadata(f).map(|m| m.len()).unwrap_or(0)).cloned().expect("a file");
    let big_bytes = std::fs::metadata(&big).map(|m| m.len()).unwrap_or(0);
    let copy_dst = tmp.join("copy.bin");
    timed!("copy_smart_io", big_bytes, {
        fs_mirror::copy_smart_io(&big, &copy_dst).expect("copy");
    });
    timed!("zip_entries", zip_bytes, {
        archive::archive_entries(&zip).expect("entries").len()
    });
    let ex_dst = tmp.join("extract");
    timed!("zip_extract", zip_bytes, {
        archive::extract_to(&zip, &ex_dst).expect("extract");
    });
    // repo-JSON: a big server-repo manifest (profiles × mods × files).
    let repo = repo_schema::sample_repo(5, 100, 16);
    let json = serde_json::to_string(&repo).expect("serialize");
    let json_bytes = json.len() as u64;
    timed!("repo_serialize", json_bytes, {
        serde_json::to_string(&repo).expect("serialize").len()
    });
    timed!("repo_parse", json_bytes, {
        let _v: ServerRepo = serde_json::from_str(&json).expect("parse");
    });

    // ── report ──
    println!("\n  BMM resource collector — fixture {:.2} MiB across {} files, zip {:.2} MiB\n",
        bytes as f64 / 1048576.0, files.len(), zip_bytes as f64 / 1048576.0);
    println!("  {:<16} {:>10} {:>14} {:>14}", "operation", "time(ms)", "peak heap(KiB)", "bytes");
    println!("  {}", "-".repeat(58));
    for r in &rows {
        println!("  {:<16} {:>10.2} {:>14.1} {:>14}", r.op, r.ms, r.peak_kb, r.bytes);
    }

    let mut out = String::from("{\n  \"fixtureBytes\": ");
    out.push_str(&bytes.to_string());
    out.push_str(",\n  \"fileCount\": ");
    out.push_str(&files.len().to_string());
    out.push_str(",\n  \"operations\": [\n");
    for (i, r) in rows.iter().enumerate() {
        out.push_str(&format!(
            "    {{ \"op\": \"{}\", \"ms\": {:.3}, \"peakHeapKiB\": {:.1}, \"bytes\": {} }}{}\n",
            r.op, r.ms, r.peak_kb, r.bytes, if i + 1 < rows.len() { "," } else { "" }
        ));
    }
    out.push_str("  ]\n}\n");
    let report = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("results").join("mem-report.json");
    if let Some(dir) = report.parent() { let _ = std::fs::create_dir_all(dir); }
    let _ = std::fs::write(&report, out);
    println!("\n  report → {}\n", report.display());

    let _ = std::fs::remove_dir_all(&tmp);
}
