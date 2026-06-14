# BMM end-to-end benchmarks via hyperfine (Windows / PowerShell).
#
# Measures whole-process wall time (startup + one real operation) for archive
# extraction, no-extract entry listing, and directory scanning — the latency a
# user actually waits on. Results export to ../results/hyperfine/*.json + *.md.
#
# Prereqs: Rust toolchain, and hyperfine (https://github.com/sharkdp/hyperfine):
#   winget install sharkdp.hyperfine   (or: cargo install hyperfine)

$ErrorActionPreference = 'Stop'
$root      = Split-Path -Parent $PSScriptRoot          # benchmarks/
$rustDir   = Join-Path $root 'rust'
$resultDir = Join-Path $root 'results\hyperfine'
$fixDir    = Join-Path $env:TEMP 'bmm_bench_fixtures'

if (-not (Get-Command hyperfine -ErrorAction SilentlyContinue)) {
  Write-Error "hyperfine not found. Install with: winget install sharkdp.hyperfine"
}

New-Item -ItemType Directory -Force -Path $resultDir | Out-Null

Write-Host "==> Building bmm-bench-cli (release)..." -ForegroundColor Cyan
Push-Location $rustDir
cargo build --release --bin bmm-bench-cli
Pop-Location
$cli = Join-Path $rustDir 'target\release\bmm-bench-cli.exe'

Write-Host "==> Generating fixtures in $fixDir ..." -ForegroundColor Cyan
Remove-Item -Recurse -Force $fixDir -ErrorAction SilentlyContinue
& $cli gen-tree   (Join-Path $fixDir 'tree') medium
& $cli gen-archives (Join-Path $fixDir 'tree') (Join-Path $fixDir 'arch')

$arch = Join-Path $fixDir 'arch'
$out  = Join-Path $fixDir 'out'

# ── 1. Extraction, per format (the heavy path, run on activation) ────────────
$formats = @('mod.zip','mod.tar','mod.tar.gz','mod.7z') | Where-Object { Test-Path (Join-Path $arch $_) }
# NOTE: we use hyperfine -N (no intermediate shell) so hyperfine parses the
# command itself. This avoids cmd.exe / bash quoting differences and correctly
# handles the space in "Better Project". Every path token is double-quoted.
# Extraction is idempotent (extract_to overwrites), so no --prepare clean is
# needed. q() wraps a value in the double quotes hyperfine -N expects.
function q($s) { return "`"$s`"" }

$extractRuns = foreach ($f in $formats) {
  $label = [IO.Path]::GetFileName($f)
  "--command-name", "extract $label", "$(q $cli) extract $(q (Join-Path $arch $f)) $(q (Join-Path $out $label))"
}
Write-Host "==> hyperfine: archive extraction" -ForegroundColor Cyan
hyperfine -N --warmup 2 --min-runs 10 `
  --export-json (Join-Path $resultDir 'extract.json') `
  --export-markdown (Join-Path $resultDir 'extract.md') `
  @extractRuns

# ── 2. Entry listing (no extract) per format ─────────────────────────────────
$entryRuns = foreach ($f in $formats) {
  $label = [IO.Path]::GetFileName($f)
  "--command-name", "entries $label", "$(q $cli) entries $(q (Join-Path $arch $f))"
}
Write-Host "==> hyperfine: entry listing (no extract)" -ForegroundColor Cyan
hyperfine -N --warmup 3 --min-runs 20 `
  --export-json (Join-Path $resultDir 'entries.json') `
  --export-markdown (Join-Path $resultDir 'entries.md') `
  @entryRuns

# ── 3. Directory scan ────────────────────────────────────────────────────────
$scanSrc = Join-Path $fixDir 'scan_src'
& $cli extract (Join-Path $arch $formats[0]) $scanSrc | Out-Null
Write-Host "==> hyperfine: directory scan (jwalk)" -ForegroundColor Cyan
hyperfine -N --warmup 3 --min-runs 20 `
  --export-json (Join-Path $resultDir 'scan.json') `
  --export-markdown (Join-Path $resultDir 'scan.md') `
  --command-name "scan jwalk" "$(q $cli) scan $(q $scanSrc)"

Write-Host "`nDone. JSON + Markdown written to $resultDir" -ForegroundColor Green
