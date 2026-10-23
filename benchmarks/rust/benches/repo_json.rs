//! repo.json (de)serialization benchmarks — mirrors `models::repo::ServerRepo`.
//! Sweeps repo size so you can see how parse/serialize scale with mod count.

use bmm_benchmarks::repo_schema::{self, ServerRepo};
use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};

/// (label, profiles, mods_per_profile, files_per_mod)
const SIZES: &[(&str, usize, usize, usize)] = &[
    ("small_5mods", 1, 5, 8),
    ("medium_50mods", 2, 25, 12),
    ("large_500mods", 5, 100, 16),
];

fn bench_parse(c: &mut Criterion) {
    let mut g = c.benchmark_group("repo_json_parse");
    for &(label, p, m, f) in SIZES {
        let repo = repo_schema::sample_repo(p, m, f);
        let json = serde_json::to_string(&repo).expect("serialize");
        g.throughput(Throughput::Bytes(json.len() as u64));
        g.bench_with_input(BenchmarkId::from_parameter(label), &json, |b, s| {
            b.iter(|| {
                let parsed: ServerRepo = serde_json::from_str(s).expect("parse");
                criterion::black_box(parsed.profiles.len())
            });
        });
    }
    g.finish();
}

fn bench_serialize(c: &mut Criterion) {
    let mut g = c.benchmark_group("repo_json_serialize");
    for &(label, p, m, f) in SIZES {
        let repo = repo_schema::sample_repo(p, m, f);
        let bytes = serde_json::to_string(&repo).unwrap().len() as u64;
        g.throughput(Throughput::Bytes(bytes));
        g.bench_with_input(BenchmarkId::from_parameter(label), &repo, |b, r| {
            b.iter(|| criterion::black_box(serde_json::to_string(r).unwrap().len()));
        });
    }
    g.finish();
}

/// Parse straight into the typed model vs into an untyped `Value` — shows the
/// cost of serde's typed deserialization for the largest payload.
fn bench_typed_vs_value(c: &mut Criterion) {
    let repo = repo_schema::sample_repo(5, 100, 16);
    let json = serde_json::to_string(&repo).unwrap();
    let mut g = c.benchmark_group("repo_json_typed_vs_value");
    g.throughput(Throughput::Bytes(json.len() as u64));
    g.bench_function("typed_ServerRepo", |b| {
        b.iter(|| {
            let v: ServerRepo = serde_json::from_str(&json).unwrap();
            criterion::black_box(v.profiles.len())
        });
    });
    g.bench_function("untyped_Value", |b| {
        b.iter(|| {
            let v: serde_json::Value = serde_json::from_str(&json).unwrap();
            criterion::black_box(v["profiles"].as_array().map(|a| a.len()).unwrap_or(0))
        });
    });
    g.finish();
}

criterion_group!(benches, bench_parse, bench_serialize, bench_typed_vs_value);
criterion_main!(benches);
