//! Filesystem hot-path benchmarks (mirrors of `fs_utils`):
//!   - directory scan: jwalk (shipped) vs walkdir vs std recursion, across mod sizes
//!   - SHA-256 hashing: the 1 MiB buffered strategy used for integrity
//!   - file copy: full-speed std::fs::copy vs the 256 KiB smart-IO chunked copy

use std::path::PathBuf;
use std::time::Duration;

use bmm_benchmarks::{fixtures, fs_mirror};
use bmm_benchmarks::fixtures::TreeSpec;
use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use tempfile::TempDir;

struct Tree {
    _tmp: TempDir,
    root: PathBuf,
    files: Vec<PathBuf>,
    bytes: u64,
}

fn make_tree(spec: TreeSpec) -> Tree {
    let tmp = TempDir::new().expect("tmp");
    let root = tmp.path().join("mod");
    let files = fixtures::build_tree(&root, spec).expect("tree");
    let bytes = fixtures::total_bytes(&files);
    Tree { _tmp: tmp, root, files, bytes }
}

fn bench_scan(c: &mut Criterion) {
    let mut g = c.benchmark_group("dir_scan");
    for (name, spec) in [("small", TreeSpec::small()), ("medium", TreeSpec::medium()), ("large", TreeSpec::large())] {
        let tree = make_tree(spec);
        // Validate all three strategies see the same files before timing them.
        let n = fs_mirror::scan_jwalk(&tree.root).len();
        assert_eq!(n, fs_mirror::scan_walkdir(&tree.root).len());
        assert_eq!(n, fs_mirror::scan_std(&tree.root).len());
        g.throughput(Throughput::Elements(n as u64));

        g.bench_with_input(BenchmarkId::new("jwalk", name), &tree.root, |b, r| {
            b.iter(|| criterion::black_box(fs_mirror::scan_jwalk(r).len()));
        });
        g.bench_with_input(BenchmarkId::new("walkdir", name), &tree.root, |b, r| {
            b.iter(|| criterion::black_box(fs_mirror::scan_walkdir(r).len()));
        });
        g.bench_with_input(BenchmarkId::new("std_recursive", name), &tree.root, |b, r| {
            b.iter(|| criterion::black_box(fs_mirror::scan_std(r).len()));
        });
    }
    g.finish();
}

fn bench_sha256(c: &mut Criterion) {
    let mut g = c.benchmark_group("sha256");
    for (name, spec) in [("medium_64k_files", TreeSpec::medium()), ("large_2m_files", TreeSpec::large())] {
        let tree = make_tree(spec);
        // Hash the single largest file — representative of integrity hashing a big asset.
        let biggest = tree.files.iter()
            .max_by_key(|p| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0))
            .expect("a file")
            .clone();
        let sz = std::fs::metadata(&biggest).unwrap().len();
        g.throughput(Throughput::Bytes(sz));
        g.bench_with_input(BenchmarkId::from_parameter(name), &biggest, |b, p| {
            b.iter(|| criterion::black_box(fs_mirror::sha256_file(p).unwrap()));
        });
    }
    g.finish();
}

fn bench_copy(c: &mut Criterion) {
    let tree = make_tree(TreeSpec::large());
    let src = tree.files.iter()
        .max_by_key(|p| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0))
        .expect("a file")
        .clone();
    let sz = std::fs::metadata(&src).unwrap().len();
    let dst_dir = TempDir::new().expect("dst");

    let mut g = c.benchmark_group("file_copy");
    g.throughput(Throughput::Bytes(sz));
    g.sample_size(30).measurement_time(Duration::from_secs(8));

    g.bench_function("std_fs_copy", |b| {
        let dst = dst_dir.path().join("out_full.bin");
        b.iter(|| { fs_mirror::copy_full_speed(&src, &dst).unwrap(); });
    });
    g.bench_function("smart_io_256k", |b| {
        let dst = dst_dir.path().join("out_smart.bin");
        b.iter(|| { fs_mirror::copy_smart_io(&src, &dst).unwrap(); });
    });
    g.finish();
    let _ = tree.bytes;
}

criterion_group!(benches, bench_scan, bench_sha256, bench_copy);
criterion_main!(benches);
