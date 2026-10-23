#!/usr/bin/env bash
# BMM end-to-end benchmarks via hyperfine (POSIX parity of run.ps1).
# Prereqs: Rust toolchain + hyperfine (https://github.com/sharkdp/hyperfine).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # benchmarks/
rust_dir="$root/rust"
result_dir="$root/results/hyperfine"
fix_dir="${TMPDIR:-/tmp}/bmm_bench_fixtures"

# On Windows (Git-Bash / MSYS / Cygwin), `hyperfine -N` spawns native binaries
# DIRECTLY, with no POSIX→Windows path translation — so every path handed to
# hyperfine (and to the native CLI it runs) must already be in Windows form, and
# the binary needs its .exe suffix. `to_native` uses cygpath when present; on real
# Linux/macOS it's a no-op and EXE stays empty.
to_native() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
EXE=""; command -v cygpath >/dev/null 2>&1 && EXE=".exe"
result_dir="$(to_native "$result_dir")"
fix_dir="$(to_native "$fix_dir")"

command -v hyperfine >/dev/null 2>&1 || { echo "hyperfine not found. Install: cargo install hyperfine"; exit 1; }
mkdir -p "$result_dir"

echo "==> Building bmm-bench-cli (release)..."
( cd "$rust_dir" && cargo build --release --bin bmm-bench-cli )
# Note: cygpath -m auto-appends .exe when the target exists, so only add $EXE if
# it isn't already present (avoids a double .exe.exe).
cli="$(to_native "$rust_dir/target/release/bmm-bench-cli")"
case "$cli" in *.exe) ;; *) cli="$cli$EXE" ;; esac

echo "==> Generating fixtures in $fix_dir ..."
rm -rf "$fix_dir"
"$cli" gen-tree "$fix_dir/tree" medium
"$cli" gen-archives "$fix_dir/tree" "$fix_dir/arch"

arch="$fix_dir/arch"; out="$fix_dir/out"

# Collect formats that actually exist.
formats=()
for f in mod.zip mod.tar mod.tar.gz mod.7z; do [ -f "$arch/$f" ] && formats+=("$f"); done

# We use hyperfine -N (no intermediate shell) so hyperfine parses the command
# itself — consistent quoting across platforms, and paths with spaces work.
# Extraction is idempotent (extract_to overwrites), so no --prepare is needed.

# 1. Extraction per format
extract_args=()
for f in "${formats[@]}"; do extract_args+=(--command-name "extract $f" "\"$cli\" extract \"$arch/$f\" \"$out/$f\""); done
echo "==> hyperfine: archive extraction"
hyperfine -N --warmup 2 --min-runs 10 \
  --export-json "$result_dir/extract.json" --export-markdown "$result_dir/extract.md" \
  "${extract_args[@]}"

# 2. Entry listing per format
entry_args=()
for f in "${formats[@]}"; do entry_args+=(--command-name "entries $f" "\"$cli\" entries \"$arch/$f\""); done
echo "==> hyperfine: entry listing (no extract)"
hyperfine -N --warmup 3 --min-runs 20 \
  --export-json "$result_dir/entries.json" --export-markdown "$result_dir/entries.md" \
  "${entry_args[@]}"

# 3. Directory scan
"$cli" extract "$arch/${formats[0]}" "$fix_dir/scan_src" >/dev/null
echo "==> hyperfine: directory scan (jwalk)"
hyperfine -N --warmup 3 --min-runs 20 \
  --export-json "$result_dir/scan.json" --export-markdown "$result_dir/scan.md" \
  --command-name "scan jwalk" "\"$cli\" scan \"$fix_dir/scan_src\""

echo "Done. JSON + Markdown written to $result_dir"
