# BetterModsManager — Benchmark Suite

A reproducible, presentable performance suite covering BMM's real hot-paths across
three layers:

| Layer | Tool | What it measures | Location |
|-------|------|------------------|----------|
| **Rust, in-process** | [Criterion](https://github.com/bheisler/criterion.rs) | Steady-state throughput/latency of archive extraction, FS scan/copy/hash, repo-JSON (de)serialization | [`rust/`](rust/) |
| **Frontend, in-process** | custom micro-bench runner (zero deps) | mod-list filter/sort, i18n `t()` interpolation — shipped vs optimized | [`js/`](js/) |
| **End-to-end, whole process** | [hyperfine](https://github.com/sharkdp/hyperfine) | The wall time a user actually waits on (process start + one real op) | [`hyperfine/`](hyperfine/) |

Everything funnels into a single **presentation deck**: [`results/index.html`](results/index.html).

> **Just want to benchmark from inside the app?** See
> [`IN_APP_BENCHMARK.md`](IN_APP_BENCHMARK.md) — BMM has a built-in **Benchmark** tab
> that runs the real operations (activate / deactivate / cancel / scan / hash / copy /
> extract) on a safe sandbox (or your own mods) and shows explained results. No
> toolchain needed.

> **Isolation / safety:** the Rust crate here is *not* part of `src-tauri` and is
> never compiled by `tauri build`, so it cannot affect the shipped MSI. The
> archive benchmark runs the **real** `src-tauri/src/archive.rs` (included verbatim
> via `#[path]`, zero `crate::` deps → no drift). The FS-scan/copy and repo-JSON
> benches faithfully mirror the real algorithm/schema (those modules pull in
> `tauri` / the whole models graph, deliberately kept out of this lightweight crate).

---

## Quick start

```bash
# 1. Rust micro-benchmarks (Criterion) — writes HTML/SVG to rust/target/criterion/
cd benchmarks/rust
cargo bench

# 2. Frontend micro-benchmarks — writes js/results/js-results.json + js-report.html
cd ../js
npm run all          # = node bench.mjs && node report.mjs

# 3. End-to-end (needs hyperfine installed)
#    Windows:
powershell -ExecutionPolicy Bypass -File ../hyperfine/run.ps1
#    macOS / Linux:
bash ../hyperfine/run.sh

# 4. Build the combined presentation deck → results/index.html
cd ..
node scripts/make-report.mjs
```

Then open **`benchmarks/results/index.html`** in a browser to present.

### Installing the prerequisites
- **Rust toolchain** (already required to build BMM).
- **Node** ≥ 18 (already required for the frontend build).
- **hyperfine**: `winget install sharkdp.hyperfine` (Windows) or `cargo install hyperfine`.

---

## What each benchmark exercises

### Rust / Criterion (`rust/benches/`)
- **`archive_extraction`** — `archive::archive_entries` (list without extracting)
  and `archive::extract_to` (full decompression) for **zip / tar / tar.gz / 7z**.
  Throughput is reported against the *uncompressed* size so formats compare fairly.
  Includes an invariant assert: every format reports the same file count.
- **`fs_scan_copy`** — directory scan (**jwalk** shipped vs **walkdir** vs naïve
  std recursion) across small/medium/large mod trees; **BLAKE3** (the app's local
  content hash — a tree hash, parallel *within* a big file) vs **SHA-256** (kept as
  the repo/download wire format), both on the largest file; full-speed
  `std::fs::copy` vs the 1 MiB smart-IO chunked copy.
- **`repo_json`** — `serde_json` parse & serialize of `ServerRepo` swept by mod
  count, plus typed-struct vs untyped-`Value` parsing.
- **`catalog_normalize`** (1.0.2) — the **real** `src-tauri/src/commands/catalog_format.rs`
  (mounted verbatim, like `archive.rs`): `normalize_text` on a v1 apps catalogue, a v1 plugins
  catalogue and an already universal document, at 100 / 1 000 / 5 000 items. Asserts every item
  survives the conversion before timing.
- **`repo_hash`** (1.0.2) — the **real** `src-tauri/src/commands/repo_format.rs` hasher behind
  Server Repo « Validate » / « Convert » (sha256 + 4 MiB chunk table): `hash_in_order`
  (sequential), `hash_file` over rayon (what the app's governed hasher does, minus ticket and
  progress events) and the validate cache's hit path (a mirror: stamp + map lookup). Fixture:
  the medium tree plus four 6–9 MiB files.
- **`creator_key`** — the real creator key v5 store (`creator_v5/keystore.rs`).

### Frontend micro-bench (`js/`)
Mirrors verbatim from `frontend/src`:
- **mod-list** `getFilteredMods()` (`mods-list.ts`) — shipped (`.find` per tag +
  `localeCompare`) vs optimized (tag `Map` + `Intl.Collator`), swept 200→5000 mods.
- **i18n** `t()` (`core/i18n.ts`) — shipped (a fresh `RegExp` per param) vs an
  optimized single-pass substitution.

- **activity registry** (1.0.2) — the compiled `frontend/js/core/activity.js` itself: one task
  started, updated 10 times and finished (one listener, history persisted to an in-memory
  storage), and `overallProgress` over 20 running tasks.
- **catalogue normaliser JS** (1.0.2) — the compiled `frontend/js/core/catalog-format.js`:
  `normalizeCatalog` on a v1 apps catalogue of 100 and 1 000 items.

Each optimized variant is **asserted equal** to the shipped one before timing, so
the numbers compare apples to apples. These optimizations are now **applied in the
app** (`core/i18n.ts` single-pass `t()`, `mods-list.ts` tag `Map` + `Intl.Collator`);
the bench keeps the old implementation alongside as the baseline for comparison.

### hyperfine (`hyperfine/`)
Drives `bmm-bench-cli` (a thin binary in the Rust crate) so it measures the full
process cost — startup + one real `extract` / `entries` / `scan` — which is the
latency a user perceives.

---

## Results per version (release tool)

`tools/release` (step `bench`, or `node tools/release/bench/run.mjs --version X.Y.Z`) runs every
suite, then stores the version's numbers in `results/<version>/summary.json` (committed: point
estimate, 95 % interval, samples, throughput, machine, toolchain) with the raw files in
`results/<version>/raw/` (ignored), compares them with the newest earlier version and writes
`Release/<version>/bench/BENCHMARK.md` (+ `_FR.md`, `.html`, PNG charts, an animated GIF). See
[tools/release/README.md](../tools/release/README.md#benchmarks) for how verdicts are decided.

`results/1.0.0/summary.json` is the baseline captured from the results that were on disk before
the 1.0.2 run (June to September 2026, all while package.json said 1.0.0).

## Interpreting the deck
- **Lower bars are better** (mean time). Rust charts also show throughput (MiB/s).
- Blue = shipped/baseline, green = optimized, orange = Rust source, purple = E2E.
- For statistical detail (confidence intervals, distribution plots, regression vs
  previous run) open Criterion's own report:
  `rust/target/criterion/report/index.html`.

## Notes & gotchas
- `cargo bench` only runs the Criterion `[[bench]]` targets — the lib/CLI have
  `bench = false` so libtest doesn't choke on Criterion's flags.
- On Windows, the hyperfine scripts use `hyperfine -N` (no intermediate shell) so
  the space in "Better Project" and cross-shell quoting are handled correctly.
- Fixtures are seeded (deterministic) and built in a temp dir; nothing is committed.
