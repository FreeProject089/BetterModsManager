// « Is the machine busy building? » — before a build or a benchmark. Windows only (elsewhere it
// reports idle). Two signals: build processes (cargo, rustc, tauri, a release.ps1 PowerShell)
// and the cargo target locks of this checkout (a lock file cargo holds open while it builds).

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { capture } from './exec.mjs';
import { ROOT } from './util.mjs';

const PS = `$ErrorActionPreference='SilentlyContinue';
$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(cargo|rustc|tauri|cargo-tauri|bpkg)\\.exe$' -or ($_.Name -match '^(powershell|pwsh)\\.exe$' -and $_.CommandLine -match 'release\\.ps1|build-installer\\.ps1') } | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; name=$_.Name; cmd=$_.CommandLine } };
@($p) | ConvertTo-Json -Compress`;

/** [{ pid, name, cmd }] of running build processes. */
export function buildProcesses() {
  if (process.platform !== 'win32') return [];
  const out = capture('powershell', ['-NoProfile', '-NonInteractive', '-Command', PS]);
  if (!out) return [];
  try { const j = JSON.parse(out); return (Array.isArray(j) ? j : [j]).filter((x) => x && x.pid); } catch { return []; }
}

/** Cargo lock files of this checkout that another process holds open. */
export function heldLocks(dirs = [join(ROOT, 'src-tauri', 'target'), join(ROOT, 'benchmarks', 'rust', 'target'), join(ROOT, 'BetterInstaller', 'target')]) {
  if (process.platform !== 'win32') return [];
  const files = dirs.flatMap((d) => ['debug', 'release'].map((p) => join(d, p, '.cargo-lock'))).filter(existsSync);
  if (!files.length) return [];
  const list = files.map((f) => `'${f.replace(/'/g, "''")}'`).join(',');
  const ps = `foreach($f in @(${list})){ try { $s=[IO.File]::Open($f,'Open','ReadWrite','None'); $s.Close() } catch { $f } }`;
  const out = capture('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  return (out || '').split(/\r?\n/).filter(Boolean);
}

/**
 * CPU use over a short window: { total (%), top: [{ name, pct }] } — the processes that used the
 * most CPU during the window. A game or a video call makes a benchmark run meaningless even with
 * no build running (the 1.0.2 benchmarks were first run next to a game: everything 20-500 % slower).
 */
export function cpuLoad(seconds = 5) {
  if (process.platform !== 'win32') return { total: 0, top: [] };
  // Process CPU-time deltas over the window (locale-independent: performance counter names are
  // translated on a French Windows). total = every process but the System Idle Process.
  const ps = `$a = @{}; Get-Process | ForEach-Object { if ($_.CPU) { $a[$_.Id] = $_.CPU } };
Start-Sleep -Seconds ${seconds};
$n = [Environment]::ProcessorCount; $all = @();
Get-Process | ForEach-Object { if ($_.CPU -and $a.ContainsKey($_.Id) -and $_.Id -ne $PID) { $d = ($_.CPU - $a[$_.Id]) / ${seconds} / $n * 100; if ($d -gt 0.05) { $all += [pscustomobject]@{ name = $_.ProcessName; pct = [math]::Round($d, 1) } } } };
[pscustomobject]@{ total = [math]::Round(($all | Measure-Object pct -Sum).Sum, 1); top = @($all | Sort-Object pct -Descending | Select-Object -First 6) } | ConvertTo-Json -Compress -Depth 3`;
  const out = capture('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  try { const j = JSON.parse(out); return { total: +j.total || 0, top: [].concat(j.top ?? []) }; } catch { return { total: 0, top: [] }; }
}

export function idleReport() {
  const procs = buildProcesses().filter((p) => p.pid !== process.pid);
  const locks = heldLocks();
  return { idle: procs.length === 0 && locks.length === 0, procs, locks };
}

/** Wait until idle (polling), up to maxMs. Resolves the last report. */
export async function waitIdle({ maxMs = 0, everyMs = 15000, onWait } = {}) {
  const start = Date.now();
  for (;;) {
    const r = idleReport();
    if (r.idle || Date.now() - start >= maxMs) return r;
    onWait?.(r);
    await new Promise((res) => setTimeout(res, everyMs));
  }
}
