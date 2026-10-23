//! 1.0.2: the hasher behind Server Repo « Validate » and « Convert »
//! (`src-tauri/src/commands/repo_format.rs`, mounted verbatim): sha256 of every file plus a
//! sha256 per 4 MiB chunk for files larger than one chunk.
//!
//!   - sequential   `repo_format::hash_in_order`, the plain hasher (CLI / MCP server / tests)
//!   - parallel     `repo_format::hash_file` over a rayon pool: what the app's governed hasher
//!                  (`repo_validate::governed_hasher`) does on the Hash pool, minus the ticket
//!                  checkpoints and progress events (they need the app runtime)
//!   - cache_hit    the validate cache's hit path (`repo_validate::hash_cached`): a metadata
//!                  stamp (size + mtime) and a map lookup per file, no read. Mirror: the cache is
//!                  a private static in the app; this replays its logic on a local map.
//!
//! Fixture: the medium mod tree (120 files, ~64 KiB) plus 4 files of 6–9 MiB (chunk tables).

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, UNIX_EPOCH};

use bmm_benchmarks::fixtures::{self, TreeSpec};
use bmm_benchmarks::repo_format::{hash_file, hash_in_order, Hashed};
use criterion::{criterion_group, criterion_main, Criterion, Throughput};
use rayon::prelude::*;
use tempfile::TempDir;

fn stamp(p: &PathBuf) -> Option<(u64, u128)> {
    let m = std::fs::metadata(p).ok()?;
    Some((m.len(), m.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_nanos()))
}

fn bench(c: &mut Criterion) {
    let tmp = TempDir::new().expect("tmp");
    let mut files = fixtures::build_tree(&tmp.path().join("small_files"), TreeSpec::medium()).expect("tree");
    files.extend(fixtures::build_tree(&tmp.path().join("big_files"), TreeSpec { files: 4, dirs: 1, avg_size: 7 * 1024 * 1024, seed: 11 }).expect("big"));
    let bytes = fixtures::total_bytes(&files);

    // Guard: parallel and sequential agree, and the big files carry a chunk table.
    let seq: Vec<Hashed> = hash_in_order(&files).unwrap().into_iter().map(|r| r.unwrap()).collect();
    let par: Vec<Hashed> = files.par_iter().map(|p| hash_file(p).unwrap()).collect();
    assert_eq!(seq.iter().map(|h| &h.1).collect::<Vec<_>>(), par.iter().map(|h| &h.1).collect::<Vec<_>>());
    assert!(seq.iter().any(|h| h.2.is_some()), "no file larger than one chunk");

    let cache: HashMap<PathBuf, (u64, u128, Hashed)> = files.iter().zip(seq.iter())
        .map(|(p, h)| { let (s, m) = stamp(p).unwrap(); (p.clone(), (s, m, h.clone())) }).collect();

    let mut g = c.benchmark_group("repo_hash");
    g.sample_size(20);
    g.measurement_time(Duration::from_secs(10));
    g.throughput(Throughput::Bytes(bytes));
    g.bench_function("sequential", |b| b.iter(|| criterion::black_box(hash_in_order(&files).unwrap().len())));
    g.bench_function("parallel", |b| b.iter(|| criterion::black_box(files.par_iter().map(|p| hash_file(p).map(|h| h.0)).filter(Result::is_ok).count())));
    // No byte is read on a hit: count files, not bytes.
    g.throughput(Throughput::Elements(files.len() as u64));
    g.bench_function("cache_hit", |b| b.iter(|| {
        criterion::black_box(files.iter().filter(|p| {
            let st = stamp(p);
            st.and_then(|(s, m)| cache.get(*p).filter(|e| e.0 == s && e.1 == m)).is_some()
        }).count())
    }));
    g.finish();
}

criterion_group!(benches, bench);
criterion_main!(benches);
