//! Creator key v5 I/O — the REAL `src-tauri/src/commands/creator_v5/keystore.rs`, included
//! verbatim through `bmm_benchmarks::creator_keystore`.
//!
//! Isolation: every store lives in a fresh temp dir and the "registry" copy is a `MemVault`,
//! so a run never touches this user's real key store or `HKCU\...\Identity`. DPAPI is the
//! real one (it keeps no state: protect/unprotect only).
//!
//! What is measured, and why these three:
//! - `creator_cold_load`: file read + unseal (DPAPI) + validate (+ lock and pin check since
//!   v5.1), i.e. what the first `get_creator_id` of a process pays. `forget_decoded` before
//!   each iteration makes it a real cold load; `warm_reload` is the same call once the
//!   process has opened those bytes;
//! - `creator_proof_build`: the per-audience fingerprint (4 × 20 000 SHA-256) + one signature,
//!   i.e. what every `creator_proof_v5` paid before v5.1; `cached_fingerprint_and_sign` is
//!   what it pays since (the `FpCache` the command uses);
//! - `creator_rotation`: rotate + persist (seal, write, flush, rename, second slot, pin) +
//!   read-back, and the full `rotate_at` path the command runs.

use bmm_benchmarks::creator_keystore as ks;
use criterion::{criterion_group, criterion_main, BatchSize, Criterion};
use std::collections::BTreeMap;

const AUD: &str = "https://bettercommunity.test";

fn fields() -> BTreeMap<&'static str, String> {
    let mut m = BTreeMap::new();
    m.insert("MachineGuid", "3f2c9a1e-7b44-4c1d-9e0a-5d6f7a8b9c0d".to_string());
    m.insert("ProductId", "00330-80000-00000-AA123".to_string());
    m.insert("InstallDate", "1712345678".to_string());
    m.insert("SystemUUID", "4C4C4544-0042-3010-8057-B7C04F4E4E32".to_string());
    m.insert("BaseboardSerial", "BSN-SERIAL-7781".to_string());
    m.insert("BiosSerial", "BIOS-SERIAL-5521".to_string());
    m.insert("CpuId", "BFEBFBFF000906EA".to_string());
    m.insert("DiskSn", "S4EWNX0R123456".to_string());
    m.insert("VolumeSn", "A1B2C3D4".to_string());
    m.insert("DiskModel", "Samsung SSD 970 EVO".to_string());
    m
}

/// A store as an upgraded install has it: v4-derived root, two links.
fn sample_store() -> ks::KeyStoreV5 {
    let mut s = ks::KeyStoreV5::from_root([7u8; 32], ks::ROOT_V4_DERIVED, 1000, [9u8; 32]).unwrap();
    s.rotate([10u8; 32], 2000).unwrap();
    s
}

fn bench_cold_load(c: &mut Criterion) {
    let dir = tempfile::tempdir().unwrap();
    let vault = ks::MemVault::default();
    let (store, _) = ks::load_at(dir.path(), &vault, || Ok(sample_store())).unwrap();
    let mut g = c.benchmark_group("creator_cold_load");
    g.bench_function("read_unseal_validate", |b| {
        b.iter(|| {
            ks::forget_decoded(dir.path());
            let (s, created) = ks::load_at(dir.path(), &vault, || Err("must not create".into())).unwrap();
            assert!(!created);
            criterion::black_box(s.seq())
        })
    });
    g.bench_function("warm_reload", |b| {
        b.iter(|| criterion::black_box(ks::load_at(dir.path(), &vault, || Err("must not create".into())).unwrap().0.seq()))
    });
    g.finish();
    assert_eq!(store.seq(), 2);
}

fn bench_proof(c: &mut Criterion) {
    let store = sample_store();
    let f = fields();
    let canvas = "ab".repeat(32);
    let mut g = c.benchmark_group("creator_proof_build");
    g.bench_function("fingerprint_and_sign", |b| {
        b.iter(|| {
            let fp = ks::fingerprint_for(&f, Some(&canvas), AUD);
            criterion::black_box(ks::build_proof(&store, AUD, 5000, [1u8; 16], &fp).unwrap().len())
        })
    });
    let cache = ks::FpCache::new();
    g.bench_function("cached_fingerprint_and_sign", |b| {
        b.iter(|| {
            let fp = cache.get(&f, Some(&canvas), AUD);
            criterion::black_box(ks::build_proof(&store, AUD, 5000, [1u8; 16], &fp).unwrap().len())
        })
    });
    let fp = ks::fingerprint_for(&f, Some(&canvas), AUD);
    g.bench_function("sign_only", |b| {
        b.iter(|| criterion::black_box(ks::build_proof(&store, AUD, 5000, [1u8; 16], &fp).unwrap().len()))
    });
    g.finish();
}

fn bench_rotation(c: &mut Criterion) {
    let dir = tempfile::tempdir().unwrap();
    let vault = ks::MemVault::default();
    let base = sample_store();
    ks::persist_at(dir.path(), &vault, &base).unwrap();
    let mut g = c.benchmark_group("creator_rotation");
    g.sample_size(30);
    g.bench_function("rotate_persist_readback", |b| {
        b.iter_batched(
            || base.clone(),
            |mut s| {
                s.rotate([11u8; 32], 3000).unwrap();
                ks::persist_at(dir.path(), &vault, &s).unwrap();
                criterion::black_box(s.seq())
            },
            BatchSize::SmallInput,
        )
    });
    // v5.1: what `rotate_creator_key` actually runs — lock, re-read (unseal + pin check),
    // rotate, persist, pin. A fresh folder per iteration (setup, not timed).
    g.bench_function("rotate_at_command_path", |b| {
        b.iter_batched(
            || {
                let d = tempfile::tempdir().unwrap();
                let v = ks::MemVault::default();
                ks::persist_at(d.path(), &v, &base).unwrap();
                (d, v)
            },
            |(d, v)| criterion::black_box(ks::rotate_at(d.path(), &v, [11u8; 32], 3000).unwrap().seq()),
            BatchSize::PerIteration,
        )
    });
    g.finish();
}

criterion_group!(benches, bench_cold_load, bench_proof, bench_rotation);
criterion_main!(benches);
