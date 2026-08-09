# Storage & disk I/O


> Speed limits per disk, space alerts, and how BMM copies files without freezing your PC.

Open it from **Settings → Storage → Open the Storage Manager**. It answers three questions: how
much room is left, how fast each disk is, and how hard BMM is allowed to push your drives.



## The two settings that matter most

:::tip[Smart I/O — smooth vs. fast]
**Smart I/O** (on by default) copies mod files through a bounded thread pool with tiny periodic
yields, so the interface stays responsive while a big activation runs. Turn it **off** and copies
saturate every CPU core for maximum speed — faster, but the app (and the rest of your machine) can
feel choppy until it's done.
:::

:::tip[Auto Performance Calibration]
On by default. BMM benchmarks the disks your profiles actually use and sets a sensible per-disk
speed limit for you, at boot and when things change. Leave it on unless you want to set limits by
hand.
:::

## Per-disk cards

Each disk on your system gets a card:

| Element | What it tells you |
|---|---|
| **Kind badge** | SSD / HDD / Unknown, plus **Cloud** or **Network** when detected (Drive, OneDrive, Dropbox, MEGA, iCloud, NAS). |
| **USED bar** | Used vs. total, coloured blue → amber (>70%) → red (>90%). |
| **PROFILES bar** | Total size of the profile mods living on this disk vs. free space — coloured by your alert thresholds. |
| **Profile pills** | Which [profiles](doc-page:features/profiles) use the disk, and how (game folder / mod folder / backup). |

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

=== "Benchmark a disk"

    **Benchmark this disk** writes and reads a 50 MB temp file and reports read/write MB/s plus a
    suggested limit (~70% of write speed). **Apply suggested** writes that value as the limit.

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

## Automate it

The [Scheduler](doc-page:features/scheduler) can *benchmark a disk*, *apply a disk speed limit*, *check free disk
space*, and toggle *Smart I/O* / *Auto-Calibration* as workflow actions — and branch on the measured
result (e.g. *if `disk.write_mbps` < 50, show a warning*).
