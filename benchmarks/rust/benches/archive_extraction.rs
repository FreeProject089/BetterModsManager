//! Archive hot-path benchmarks — exercises the REAL `archive.rs` from src-tauri.
//!
//! Two operations per format, mirroring how BMM uses them:
//!   - `archive_entries`  → list contents WITHOUT extracting (used for hashing /
//!     content-id / the file explorer); should be cheap.
//!   - `extract_to`       → full decompression to a temp dir (used on activation).
//!
//! Throughput is reported in bytes/s against the uncompressed tree size, so you
//! can compare formats fairly. Formats whose fixture can't be built on this
//! machine (e.g. 7z if the encoder API is unavailable) are skipped with a notice.

use std::path::{Path, PathBuf};
use std::time::Duration;

use bmm_benchmarks::{archive, fixtures};
use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use tempfile::TempDir;

struct Corpus {
    _tmp: TempDir,
    _tree: PathBuf,
    files: Vec<PathBuf>,
    uncompressed: u64,
    archives: Vec<(&'static str, PathBuf)>, // (label, path)
}

fn build_corpus() -> Corpus {
    let tmp = TempDir::new().expect("tempdir");
    let tree = tmp.path().join("mod_src");
    // "medium" mod: a realistic mix of dozens of files at ~64 KiB each.
    let files = fixtures::build_tree(&tree, fixtures::TreeSpec::medium()).expect("build tree");
    let uncompressed = fixtures::total_bytes(&files);

    let mut archives: Vec<(&'static str, PathBuf)> = Vec::new();

    let zip = tmp.path().join("mod.zip");
    if fixtures::make_zip(&tree, &files, &zip).is_ok() { archives.push(("zip", zip)); }

    let tar = tmp.path().join("mod.tar");
    if fixtures::make_tar(&tree, &tar).is_ok() { archives.push(("tar", tar)); }

    let targz = tmp.path().join("mod.tar.gz");
    if fixtures::make_tar_gz(&tree, &targz).is_ok() { archives.push(("tar.gz", targz)); }

    let sevenz = tmp.path().join("mod.7z");
    match fixtures::make_7z(&tree, &sevenz) {
        Ok(_) => archives.push(("7z", sevenz)),
        Err(e) => eprintln!("[archive_extraction] skipping 7z fixture: {e}"),
    }

    Corpus { _tmp: tmp, _tree: tree, files, uncompressed, archives }
}

fn bench_entries(c: &mut Criterion) {
    let corpus = build_corpus();
    let mut g = c.benchmark_group("archive_entries");
    g.throughput(Throughput::Bytes(corpus.uncompressed));
    for (label, path) in &corpus.archives {
        g.bench_with_input(BenchmarkId::from_parameter(label), path, |b, p| {
            b.iter(|| {
                let entries = archive::archive_entries(p).expect("entries");
                criterion::black_box(entries.len())
            });
        });
    }
    g.finish();
}

fn bench_extract(c: &mut Criterion) {
    let corpus = build_corpus();
    let mut g = c.benchmark_group("archive_extract_to");
    g.throughput(Throughput::Bytes(corpus.uncompressed));
    // Extraction is heavier; fewer samples keeps wall-time sane.
    g.sample_size(20).measurement_time(Duration::from_secs(12));
    for (label, path) in &corpus.archives {
        g.bench_with_input(BenchmarkId::from_parameter(label), path, |b, p| {
            b.iter_batched(
                || TempDir::new().expect("dest"),
                |dest| {
                    archive::extract_to(p, dest.path()).expect("extract");
                    criterion::black_box(())
                },
                criterion::BatchSize::PerIteration,
            );
        });
    }
    g.finish();
}

/// Sanity: the entry count must match the real file count regardless of format,
/// proving the benchmark is exercising equivalent work for each.
fn bench_consistency(c: &mut Criterion) {
    let corpus = build_corpus();
    let expected = corpus.files.len();
    for (label, path) in &corpus.archives {
        let got = archive::archive_entries(path).map(|e| e.len()).unwrap_or(0);
        assert_eq!(got, expected, "{label}: entry count mismatch (got {got}, want {expected})");
    }
    // A no-op bench so this shows up in the report as a validated invariant.
    c.bench_function("archive_entry_count_invariant", |b| {
        b.iter(|| criterion::black_box(expected));
    });
    let _ = Path::new("");
}

criterion_group!(benches, bench_entries, bench_extract, bench_consistency);
criterion_main!(benches);
