# Performance


Modding means moving a lot of bytes. BMM's job is to do that fast **and** keep your machine usable
while it happens — and when those two fight, **responsiveness wins**. Almost every number on this
page is a deliberate sacrifice of peak throughput to avoid a frozen window.

---

## The three copy paths

Every file copy takes exactly one of three routes, picked per call:

| Path | When | How |
|---|---|---|
| **Throttled** | a per-disk MB/s limit is set for that path | 128 KB chunks, sleeping to hit the target rate |
| **Smart I/O** | Smart I/O is on, no limit | 1 MiB chunks, a short yield on a **byte budget** |
| **Full speed** | Smart I/O off, no limit | plain `std::fs::copy` — the OS does it all |

The Smart I/O numbers were measured, not guessed. The code says so:

> *"1 MiB chunks (fewer read/write syscalls → closer to full-speed copy), and yield on a ~16 MiB
> byte budget rather than every chunk. The old 256 KB + per-chunk sleep cost ~37% vs full speed;
> budgeting the yield keeps the UI responsive while recovering most of that throughput."*

!!! warning "BMM never hard-links or symlinks"

    Some managers deploy by linking files instead of copying them. BMM does **not** — there is no
    `hard_link` or symlink anywhere in the deploy path. Every enabled file is a real copy in your
    game folder. That costs disk space, and it is what makes a BMM-managed game folder work with any
    tool that doesn't understand links, survive a mods folder living on another drive, and stay
    intact if BMM is uninstalled.

---

## Never saturate the machine

```mermaid
flowchart TB
    JOB["Deploy / copy job"] --> SYS{"target on the<br/>OS drive?"}
    SYS -- yes --> ONE["1 thread — forced,<br/>whatever the setting says"]
    SYS -- no --> TWO["2 threads max<br/>(Smart I/O on)"]
    ONE --> LIM{"a MB/s cap<br/>on this disk?"}
    TWO --> LIM
    LIM -- yes --> THR["throttled path<br/>128 KB + sleep"]
    LIM -- no --> SM["Smart I/O path<br/>1 MiB + budget yield"]
```

Parallelism is capped at **2 threads** — *"so file copies never saturate every CPU core (which is
what causes the 'Ne répond pas' UI freeze)"*. And if either the game folder or the backup folder
lives on the OS drive, it drops to **one thread regardless of your settings**:

> *"Returns true if `path` lives on the same drive as the OS (typically C:). Used to dial parallel
> IO down to a single thread so Windows itself stays responsive during big mod copies."*

There are **three separate thread pools**, each capped for its own reason:

| Pool | Size | Why |
|---|---|---|
| Global rayon | capped, 512 KB stacks | *"Prevent Rayon from hogging 100% CPU and lagging the OS"* — BMM's parallel work never recurses deep, saving ~7 MB of committed RSS per thread |
| Hashing | ≤ 4 (about half your cores) | BLAKE3 is fast enough to eat every core — see [Integrity & hashing](doc-page:integrity-hashing) |
| Smart I/O | 1–2 | the copy path above |

The allocator is swapped too: **mimalloc** instead of Windows' default HeapAlloc, for a *"30–60%
smaller process working set, plus much less fragmentation"* — BMM allocates and frees a great many
small strings (paths, hash entries) during normal use.

---

## Getting the heavy work out of the window

```mermaid
flowchart LR
    UI["Main window"] -- "spawn --mod-worker" --> W["Worker process<br/>BACKGROUND IO priority"]
    W --> OS[("Game / mods / backup")]
    UI -- "cancel = taskkill /T" --> W
    W -. "exit 0 / non-zero / 3 = cancelled" .-> UI
```

Big applies and unapplies do not run in the app at all. They run in a **separate process** — the
same executable re-invoked as `--mod-worker IN OUT`, which short-circuits *"without booting Tauri,
WebView2, or anything else"*. Three things follow:

- It self-demotes to Windows **BACKGROUND IO priority**, so *"the kernel keeps disk bandwidth
  available for the UI process"*.
- Cancelling is a `taskkill /T` of the worker PID — *"instant and reliable, no matter how stuck the
  IO is"* — instead of waiting for a blocking call to return.
- Cancelling a cancellable worker also spawns *"an inverse-op undo subprocess so any partial writes
  are reverted"*. A cancelled deploy does not leave half a mod in your game folder.

Inside the app, every copy loop polls a cancel flag *"so that the user's cancel click can interrupt
big mod copies almost instantly instead of waiting for the whole file to finish"*, and one global
lock means **one mod operation at a time** — no two applies racing on the same game folder.

---

## Locks are held for metadata, never for I/O

The rule stated all over the code: collect what you need under the lock, then let go before doing
anything slow.

> *"Release every lock BEFORE hashing so no other command blocks while we read file contents (this
> is what used to freeze the UI on big mods)."*

> *"We do NOT hash them here (that would run under 4 held locks and could freeze the UI on a big
> mod); we record them and hash AFTER the locks are released."*

The pattern has a name in the codebase — a snapshot struct: *"Lightweight snapshot of a mod's
fields — collected while holding the lock, then used after releasing it so the heavy file I/O never
blocks AppState."*

---

## What used to be slow — and what fixed it

Each of these is a real regression that was found and fixed, with the cause on record:

| Was slow | Cause | Fix |
|---|---|---|
| Every refresh / import | The UI called one conflict command **per mod** — *"hundreds of IPC round-trips + lock acquisitions on every refresh/import — the main source of UI lag"* | One batched call |
| Startup with archived mods | A big `.zip` was extracted **under the lock** | Archives are listed from their index instead; nothing is extracted |
| Scanning | Re-hashing ran synchronously | A throttled background queue hashes *"one mod at a time, on the capped hash pool, with a pause between each"* |
| Logging | `log_line` re-derived its path every call — *"the hottest path in the app"* | The path is cached |
| An unplugged drive | Listed zero files and re-queued pointless work | *"Keep whatever we already had and retry when the drive is back — don't churn state offline"* |
| `.zip` extraction | DEFLATE is CPU-bound and was *"the app's slowest hot-path operation when serial"* | Parallel across cores, one archive handle **per worker thread** (not per entry), so the central directory is parsed ~once per core |

!!! note "One optimisation was rejected, and the reason is in the code"

    > *"zlib-ng (the 2-3x SIMD backend) needs cmake to build libz-ng-sys, which can't target the
    > installed VS 2026 toolchain — so it is intentionally NOT used."*

    Worth knowing if you ever wonder why zip extraction isn't faster still.

---

## Nothing large passes through memory

The same discipline applies to bytes arriving from the network or leaving for an archive: they are
**streamed**, never buffered whole. That was not always true, and the failures were all the same
shape — peak memory equal to whatever the payload happened to be, with no cap and no size check:

| Path | Now |
|---|---|
| Adding a mod from a URL | Streams to a `.part`, sniffs the zip magic from the file, extracts through a reader. It used to buffer the whole mod **and keep that buffer alive** while extracting from a cursor over it |
| Repo sync, archived mod | Streams. The per-file path already did; the archive path — routinely the largest thing a sync moves — did not |
| App catalog install | Hashes incrementally while streaming, then renames after the SHA-256 gate |
| Modpack import | Streams to the temp zip it was always going to write anyway |
| Zip export | Copies each entry through a reader instead of reading whole files into memory |
| Session recording | Spooled to disk as it happens; the `.bmmreplay` is assembled by streaming (see [Privacy & telemetry](doc-page:../features/privacy-telemetry)) |

The rule to keep: if the destination is a file, write to the file. A buffer in between buys nothing
and turns a large input into an out-of-memory crash.

## The WebView2 diet

Before the webview even starts, features BMM doesn't use are switched off — *"Cuts ~50-150MB off the
WebView2 footprint: AudioServiceOutOfProcess… extensions / background pages… Translate / sync /
default apps… background-networking… renderer-process-limit=2"*. The DevTools window is closable for
the same reason: it is *"the ~480 MB msedgewebview2 'DevTools' process"*, so it only costs you while
it's open.

---

## Measure it on your own hardware

BMM ships a real benchmark suite rather than asking you to trust these numbers. It measures the
things BMM actually does — **scan** a folder, **hash** content (BLAKE3), **copy / deploy**, and
**extract** an archive — plus an explicit *"Integrity verification (BLAKE3)"* workload that
*"re-hashes every file and compares it against the stored baseline"*, which is the check that
detects a tampered or corrupt mod.

Results stay local. You can also drive a benchmark from the [scheduler](doc-page:../features/scheduler)
and branch on the result — measure a disk, and if it comes back under 50 MB/s, apply a cap or warn
yourself. See the [Action reference](doc-page:../reference/actions).

!!! info "See it in the app"
    Help & other → Developer → **Disk I/O limiter**, **Engine & threads**, **BLAKE3 hashing**,
    **Lightweight architecture**.
