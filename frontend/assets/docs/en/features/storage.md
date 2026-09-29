# Storage & disk I/O


> Speed limits per disk, space alerts, and how BMM copies files without freezing your PC.

Open it from **Settings → Storage → Open Storage Manager**. It answers three questions: how
much room is left, how fast each disk is, and how hard BMM is allowed to push your drives.
It is organised in [tabs](#tabs).



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

<a id="tabs"></a>
## The tabs
The Storage Manager is split into five tabs. The line at the top, above the tabs, always says which
preset is in force and whether a game is running. Every tab opens with one sentence saying what it
is for and a **Learn more** link to the matching part of this documentation; every control has a
tooltip. The first time you open it, a short card explains the window; **Got it** hides it for good.

| Tab | What it is for |
|---|---|
| **Disks & space** | How full each disk is, which [profiles](doc-page:features/profiles) live on it, the low-space alerts, **Auto Performance Calibration**, and a **speed cap** per disk with its benchmark ([below](#per-disk-cards)) |
| **Work intensity** | How much of your PC BMM may use for heavy work: the three presets, each with what it means for you, and **Smart I/O** |
| **Game mode** | Whether BMM steps aside while you play, and the games it watches for |
| **Live activity** | Four live curves and everything BMM is doing, with **Pause**, **Resume** and **Cancel** |
| **Rules per disk** | Optional fine rules for one disk and one kind of work, with a legend of every column |

The tab you used last opens next time.

### Work intensity: the presets

The tab is the [resource governor](doc-page:how-it-works/resources): the one place that decides how many
heavy operations run at once, on how many threads, and how fast they may write.

| Preset | What it means for you |
|---|---|
| **Quiet** | BMM stays out of your way while you play or work. Deploys and installs take longer |
| **Balanced** (the default, recommended) | The usual BMM: quick, and your PC stays usable. Exactly how BMM always worked |
| **Everything for BMM** | Everything finishes as fast as your disks allow. Your PC may feel slow meanwhile |

**In force** says the preset applied right now: game mode or a scheduled task can switch to another
one for a while, and your choice comes back by itself afterwards. The exact numbers behind each
preset are in [Presets](doc-page:how-it-works/resources#presets).

### Game mode

**Detect it** (the default), **Force on**, **Force off**. The tab says, in words, what is
happening: which game turned game mode on (*A game is running: SkyrimSE.exe*), where BMM found it
(*in the game folder of your profile "Skyrim SE"*, *in your list of games*, *in exclusive full
screen*), for how long, what is held right now, and, once the game has closed, how long before BMM
goes back to normal.

- **Pause everything until I quit the game** holds every operation, deploys included, and lets
  them go by themselves when game mode ends (or when you press **Resume all**).
- **While you play**: tick what waits until you stop playing: file checks (hashing), maintenance
  and disk benchmarks (both ticked by default), downloads, folder scans, unpacking and packing
  archives, image processing. Enabling mods, installs and backups are slowed, never held.
- **Back to normal after**: the cooldown after the game closes, 5 to 600 seconds (30 by default).
- **Tell me when game mode turns on or off**: a notice each time it changes by itself (on by
  default).
- **Also count any full-screen window**: catches borderless games that are in no list, but a
  full-screen video counts too, so it is off by default.
- **Games BMM watches for**: every profile's game folder is watched by itself, each with a switch
  to ignore it (a whole drive is never watched); below, the programs you added, each with a
  remove button, added by name, with **Browse…** (the game's `.exe`) or with **Pick a running
  program…** (start the game, then pick it in the list).

The details and what one look costs are in
[How detection works](doc-page:how-it-works/resources#how-detection-works).

### Live activity

Four curves (BMM's CPU, the whole PC's CPU, BMM's reads and writes in MB/s) and every operation
running, paused or waiting, with **Pause**, **Resume** and **Cancel**, plus **Pause all** and
**Resume all**. The values are measured once a second, and only while it is worth it: the Storage
Manager is open, one of the **Work intensity**, **Game mode** or **Live activity** tabs is shown,
and BMM's window is not hidden. Otherwise BMM does not measure itself at all.

### Rules per disk

Rules for one disk and one kind of work (MB/s, how many at once, buffer, priority). A legend above
the table says what each column does. An empty cell inherits, and its grey text says the value in
force and where it comes from; a greyed-out cell does not apply to its operation.

!!! warning "Read what each column acts on"

    MB/s acts on BMM's own copies, on extraction, on the zips BMM writes and on repository and
    modpack downloads; the buffer and a *low* priority act on BMM's own copies and on zip
    extraction. A cell that acts on nothing for its operation is greyed out: the whole **Scan**
    and **Hash** rows, for instance. A mod downloaded from a link is not paced yet. Details in
    [the governor page](doc-page:how-it-works/resources#what-each-column-acts-on).

!!! note "Graphics moved"

    Which graphics card draws BMM's window is an app-wide setting: **Settings → Graphics &
    display** ([details](doc-page:features/settings#graphics)).

<a id="per-disk-cards"></a>
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
