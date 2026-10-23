//! 1.0.2: the universal catalogue normaliser (`src-tauri/src/commands/catalog_format.rs`,
//! mounted verbatim). Every catalogue BMM reads — app, plugin, theme, … — is detected,
//! converted to the universal `bmm-catalog` document and validated by `normalize_text`
//! before a list is shown, so its cost is paid on every catalogue refresh.
//!
//!   - v1_apps/N     a v1 `apps` catalogue (nested `download`, `sha256:` prefixed upper-case
//!                   hashes that the normaliser cleans) → universal, N = 100 / 1000 / 5000
//!   - v1_plugins/N  a v1 `plugins` catalogue (flat `download_url`)
//!   - universal/N   an already universal document (detection + validation only: the path a
//!                   catalogue published in the new format takes)

use bmm_benchmarks::catalog_format::{normalize_text, NormalizeOptions};
use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use serde_json::{json, Value};
use std::time::Duration;

fn hash(i: usize) -> String {
    // 64 hex digits, deterministic, upper-case with the prefix the normaliser strips.
    let mut s = String::with_capacity(64);
    let mut x = (i as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ 0xD1B5_4A32_D192_ED03;
    while s.len() < 64 {
        x ^= x << 13; x ^= x >> 7; x ^= x << 17;
        s.push_str(&format!("{:016X}", x));
    }
    format!("sha256:{}", &s[..64])
}

fn v1_apps(n: usize) -> String {
    let apps: Vec<Value> = (0..n).map(|i| json!({
        "id": format!("app-{i}"), "title": format!("Demo App {i}"),
        "description": "Batch-converts and compresses texture folders so large packs load faster.",
        "category": "utility", "price": "free", "tags": ["textures", "performance"], "version": "2.3.0",
        "requirements": "Windows 10/11", "images": { "thumb": format!("https://example.org/img/{i}.png") },
        "download": { "url": format!("https://example.org/downloads/app-{i}.zip"), "file_type": "zip", "size": 12_400_000 + i, "sha256": hash(i) },
        "official": true
    })).collect();
    json!({ "name": "Benchmark apps", "version": "1.0", "apps": apps }).to_string()
}

fn v1_plugins(n: usize) -> String {
    let plugins: Vec<Value> = (0..n).map(|i| json!({
        "id": format!("plugin-{i}"), "name": format!("Plugin {i}"), "author": "Bench",
        "description": "Adds a scheduler action.", "version": "1.4.0", "game": "demo",
        "download_url": format!("https://example.org/plugins/plugin-{i}.zip"), "sha256": hash(i), "size": 40_960 + i,
        "icon_url": format!("https://example.org/icons/{i}.png"), "tags": ["automation"]
    })).collect();
    json!({ "name": "Benchmark plugins", "version": "1.0", "plugins": plugins }).to_string()
}

fn opts(kind: &str) -> NormalizeOptions {
    NormalizeOptions { kind: Some(kind.to_string()), ..Default::default() }
}

fn bench(c: &mut Criterion) {
    let mut g = c.benchmark_group("catalog_normalize");
    g.measurement_time(Duration::from_secs(6));
    for n in [100usize, 1000, 5000] {
        let apps = v1_apps(n);
        let plugins = v1_plugins(n);
        let o_app = opts("app");
        let o_plugin = opts("plugin");
        // Guard: the conversion keeps every item, and the result is the universal format.
        let first = normalize_text(&apps, &o_app);
        assert!(!first.refused, "v1 apps refused: {:?}", first.issues.first());
        assert_eq!(first.catalog["items"].as_array().map(|a| a.len()), Some(n));
        let universal = first.catalog.to_string();
        assert_eq!(normalize_text(&universal, &o_app).catalog["items"].as_array().map(|a| a.len()), Some(n));
        assert_eq!(normalize_text(&plugins, &o_plugin).catalog["items"].as_array().map(|a| a.len()), Some(n));

        g.throughput(Throughput::Elements(n as u64));
        g.bench_with_input(BenchmarkId::new("v1_apps", n), &apps, |b, t| b.iter(|| criterion::black_box(normalize_text(t, &o_app))));
        g.bench_with_input(BenchmarkId::new("v1_plugins", n), &plugins, |b, t| b.iter(|| criterion::black_box(normalize_text(t, &o_plugin))));
        g.bench_with_input(BenchmarkId::new("universal", n), &universal, |b, t| b.iter(|| criterion::black_box(normalize_text(t, &o_app))));
    }
    g.finish();
}

criterion_group!(benches, bench);
criterion_main!(benches);
