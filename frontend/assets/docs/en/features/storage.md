# Storage & disk I/O


> Speed limits per disk, space alerts, and how BMM copies files without freezing your PC.

Open it from **Settings → Storage → Open Storage Manager**. It answers three questions: how
much room is left, how fast each disk is, and how hard BMM is allowed to push your drives.



## The two settings that matter most

:::tip[Smart I/O — smooth vs. fast]
**Smart I/O** (on by default) copies mod files through a bounded thread pool with tiny periodic
yields, so the interface stays responsive while a big activation runs. Turn it **off** and copies
saturate every CPU core for maximum speed — faster, but the app (and the rest of your machine) can
feel choppy until it's done.
:::

:::tip[Auto Performance Calibration]
On by default. BMM benchmarks the disks your profiles actually use and sets a per-disk speed
limit for you, at about 70% of the measured write speed. It does this once per disk, and then again
only when that disk's last measurement is more than 30 days old, a couple of seconds after startup.
It no longer measures every disk at every start. Leave it on unless you want to set limits by hand.
:::

## How hard BMM works

The card at the top of the Storage Manager is the
[resource governor](doc-page:how-it-works/resources): the one place that decides how many heavy
operations run at once, on how many threads, and how fast they may write.

| Part of the card | What it does |
|---|---|
| **Quiet · Balanced · Everything for BMM** | The preset. **Balanced** is the default and is exactly how BMM always worked. **Quiet** does one thing at a time, gently, for while you play. **Everything for BMM** goes as fast as the disks allow |
| **In force** | The preset actually applied right now, which game mode or a scheduled task can change for a while |
| **BMM CPU · PC CPU · Read · Write** | Live curves, once a second, only while the card is on screen |
| **Game mode** | **Detect it**, **Force on**, **Force off**. While it is on, BMM works as if on Quiet, and background hashing and maintenance wait until it ends. Automatic detection is not connected yet in this version: use **Force on** ([why](doc-page:how-it-works/resources#game-mode)) |
| **What BMM is doing** | Every operation running, paused or waiting, with **Pause**, **Resume** and **Cancel**, plus **Pause all** and **Resume all** |
| **Advanced: per disk and operation** | Rules for one disk and one kind of work (MB/s, how many at once, buffer, priority). An empty cell inherits, and its grey text says the value in force and where it comes from |

!!! warning "Read what each advanced column acts on"

    MB/s and the buffer act on the copies BMM makes itself (deploying, backing up originals,
    installing a mod folder, image copies). For extraction, compression, scans, hashing and
    downloads they are stored but slow nothing, and the **Priority** column is not passed to
    Windows yet. Details in [the governor page](doc-page:how-it-works/resources#what-each-column-acts-on).

## Per-disk cards

Each disk on your system gets a card:

| Element | What it tells you |
|---|---|
| **Kind badge** | SSD / HDD / Unknown, plus **Cloud** or **Network** when detected (Drive, OneDrive, Dropbox, MEGA, iCloud, NAS). |
| **USED bar** | Used vs. total, coloured blue → amber (>70%) → red (>90%). |
| **PROFILES bar** | Total size of the profile mods living on this disk vs. free space — coloured by your alert thresholds. |
| **Profile pills** | Which [profiles](doc-page:features/profiles) use the disk, and how (destination folder / mod folder / backup). |

!!! note "Cloud/Network badges are heuristic"

    Detection matches the drive's **name or its mount path** against known provider strings
    ("OneDrive", "google"…), so an oddly-named drive can be mislabelled — and one that merely
    lives under a synced folder can be labelled correctly without being a cloud drive itself.
    It's a hint, not a guarantee.

## What you can do

=== "Cap a disk's speed"

    Type a limit in **MB/s** on the disk's card. `0` means **Unlimited** (not "blocked"). Useful to
    stop a slow HDD or a cloud drive from lagging the whole machine during a big copy. Saved after a
    short pause.

    The limit is shared: every copy writing to that disk draws from the same budget, so two
    copies at once stay under it together instead of getting it each. It is the same number as the
    advanced rule *this disk, all operations*: change one and the other follows.

=== "Benchmark a disk"

    **Benchmark this disk** writes and reads a 50 MB temp file and reports read/write MB/s plus a
    suggested limit (~70% of write speed). **Apply suggested** writes that value as the limit.

    The read is made without the operating system's cache, so it measures the disk and not the
    memory holding the file just written. The benchmark runs as background maintenance: it waits
    while mods are being enabled or installed, and while game mode is on.

=== "Reset everything"

    **Reset limits** clears every per-disk limit back to Unlimited.

!!! warning "Benchmark needs write access"

    The 50 MB probe is written to the drive and deleted. On a read-only or permission-locked drive
    it returns *Access Denied* — that's expected, not a bug.

## Low-space alerts

Turn on **Low-space alert** to have the PROFILES bars warn you before a disk fills up. Two
thresholds (percent of free space):

- **Warning %** — the bar turns amber (default 40%).
- **Critical %** — the bar turns red (default 30%).

BMM keeps *warning > critical* automatically. These also feed activation-time space checks.

## Archived mods & the temp cache

A mod stored as an archive (`.zip`, `.7z`, `.rar`, `.tar[.gz]`) **stays compressed** in your mods
folder — that's the space win. BMM extracts it to a temporary cache only when the files are
actually needed, and every feature (hashing, integrity, conflicts, the mapper) treats it exactly
like an unpacked mod. See [the Library](doc-page:features/library) for the archived-mod workflow.

!!! note "Where the cache lives"

    Extracted copies go to your system temp dir (`%TEMP%/bmm_mod_cache/…`), keyed by the archive's
    size + modified-time — so replacing the archive re-extracts automatically. The OS clears temp on
    its own schedule; BMM re-extracts on demand. There is **no in-app "clear cache" button** by
    design — nothing there is precious.

## A note on hashing vs. I/O

The speed limits and Smart I/O govern *copying*. Integrity **hashing** (SHA / BLAKE3) is a separate
system with its own settings (lazy hashing, the loading animation). Big activations often skip
re-hashing on purpose — see [Integrity & hashing](doc-page:how-it-works/integrity-hashing).

The governor still has a say over hashing: it runs on its own thread pool, sized by the preset,
counts as background work, and so steps aside while mods are being enabled or installed and waits
out game mode.

## Automate it

The [Scheduler](doc-page:features/scheduler) can *benchmark a disk*, *apply a disk speed limit*, *check free disk
space*, and toggle *Smart I/O* / *Auto-Calibration* as workflow actions — and branch on the measured
result (e.g. *if `disk.write_mbps` < 50, show a warning*). It can also pick a preset for the length
of a task, switch game mode and pause the queue: see
[How hard BMM works](doc-page:features/scheduler#how-hard-bmm-works).
