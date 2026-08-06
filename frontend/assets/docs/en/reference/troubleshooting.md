# Troubleshooting

Start here before reinstalling anything. Roughly ordered from "most likely" to "something is actually
wrong".

!!! tip "The one habit worth having"
    **Settings → Data → Export** before you change anything drastic. It writes one file, takes a
    second, and it is the difference between a bad afternoon and a lost setup.

---

## Mods and profiles

### The game acts like the mod isn't there

Almost always packaging, not BMM. The archive has one folder too many, so the game looks for `Data/`
and finds `MyMod-v3/Data/`. Open the [Mapper](doc-page:features/mapper), run the **Structure
Diagnostic**, and check the final path *before* applying.

### A mod I disabled is still active

Two profiles pointing at the same game folder. BMM warns about this when you set it up — it is *a major
source of human error*. Note that profiles sharing **both** the game and mods folders keep their active
lists in sync, but profiles sharing only the *game* folder do not: each deploys into the same place and
neither knows what the other left behind. Give each profile its own mods folder. See
[Profiles & activation](doc-page:how-it-works/profiles-activation).

### I switched profiles and nothing changed

That is correct behaviour. **Switching a profile moves no files** — it changes which list you are
editing. What is deployed stays deployed until you disable it. This is the single most common surprise
in BMM.

### Two mods fight — one overwrites the other

That's a [conflict](doc-page:features/library#conflicts), and it's expected: they ship the same file. BMM
shows exactly which files overlap. There is no per-file picker and no priority list — **the last mod
you enable wins**, so enable the one that should win last. See
[Conflicts](doc-page:how-it-works/conflicts).

### A mod shows a warning icon in the Library

Its last integrity check failed, and BMM remembers that across restarts. Re-run the check to see which
files are `missing`, `modified` or `added`. Note that the *first* check on a mod never fails — it
establishes the baseline — so a failure means something changed since then. See
[Integrity & hashing](doc-page:how-it-works/integrity-hashing).

### I cancelled an activation — is my game folder half-modded?

No. Cancelling kills the worker and then runs an inverse-op undo pass, so partial writes are reverted.
A **force-quit or power cut** is different: there is no journal, so a partial deploy can survive. It is
still safe — the `_original/` backups are written *before* anything is overwritten, so your game's own
files were never at risk. Re-enable the mod to finish the copy, or disable it to clean up completely.

---

## Drives and paths

### My mods vanished after unplugging a drive

They didn't. BMM detects an unreachable root and **keeps** the existing entries rather than pruning
them — *"don't churn state offline"*. Plug the drive back in and the next scan reconciles. Hashing is
skipped while it's away, so no integrity data is corrupted either.

### The drive letter changed and now everything is broken

This one BMM cannot fix for you. Profiles store **absolute paths**, so `E:\Mods` becoming `F:\Mods`
needs each affected path edited in the profile. Nothing is lost — the paths just point at a letter that
no longer exists.

### A mod with accented, Chinese, or `#`/`@`/`-` characters in its name

Supported. Paths are handled as OS strings end to end, not as byte strings, and names that become
filenames are sanitised at each boundary. If a *game* mishandles such a name, rename the mod folder —
BMM will re-identify it by content, so it keeps its identity.

---

## Performance

### My PC lags while mods are activating

**Settings → Storage.** Turn on **Smart I/O** and run **Auto-Calibration** once — it benchmarks your
drives and paces the copies. If it still stutters, set an explicit **MB/s cap** for that disk.

Worth knowing: if the game or backup folder is on your **OS drive**, BMM already forces copies down to
a single thread regardless of your settings, because Windows itself needs the headroom. Moving the mods
folder off `C:` is the biggest single win available.

### Activation is slower than a plain file copy

By design. Peak throughput is traded for a responsive window: capped thread pools, a yield budget on
the copy loop, and a worker running at background IO priority. See
[Performance](doc-page:how-it-works/performance), and run the built-in benchmark to see the real numbers
on your hardware.

### BMM uses a lot of memory after a while

Open the DevTools window and close it again — while open it is a *~480 MB* separate process.

The **session recorder** is no longer a suspect: it spools its events to disk as they happen, so a
session of any length costs the app about half a megabyte of memory. What it does use is **disk** —
a rolling 512 MB window under `Spool/`, plus whatever your saved-replay retention allows (Settings →
Privacy). The **DevTools Replay Studio** is the one that still buffers in memory, deliberately, and
it stops itself at 64 MB rather than growing.

---

## Updates, repos and the API

### BMM says a mod has no updates, but I know it does

If the mod's source is a **direct download**, BMM is being honest:

> A direct download has no version, so BMM cannot tell if it is newer.

There's nothing to compare. Link the mod to a [repo](doc-page:features/repo) that publishes versions, or
use the direct re-download.

### A repo sync says a file failed

The downloaded file's hash didn't match what the repo published, and BMM treats that as an error rather
than a warning. Retry — a resumed transfer only re-fetches the chunks that differ, so a retry is cheap.
If it fails repeatedly, the published hash and the hosted file genuinely disagree; that's the host's
problem to fix.

### A sync won't start — it says one is already running

Only one sync runs at a time (`409`). Cancel the running one; it stops at the next mod boundary rather
than mid-file.

### A script or plugin can't reach the local API

Check `GET http://127.0.0.1:51274/api/health` first. If nothing answers, the most likely cause is that
**the port was already taken when BMM started** — typically a zombie instance after an in-app restart.
BMM does **not** fall back to another port: the API is disabled for that whole session and a line goes
to the crash log. Restart BMM. See the [API reference](doc-page:reference/api).

### A plugin gets 403 on something it should be able to do

The error names the missing permission and the route that grants it. Note the reverse trap too: some
routes are **token-only**, so a plugin with zero permissions can call them — the reference lists which.

---

## A modpack won't apply fully

The card will say some mods are missing or corrupted, and offer **Repair**. Run it. A pack that can't
fully apply explains far more bugs than the game does. If a pack is *meant* to skip verification, that
is the per-pack *skip integrity check* option — not a global one.

---

## Something is badly wrong

In order:

1. **Settings → Data → Export.** Always first.
2. **Check the crash log.** Settings → Debug has the folder. A clean-exit marker means BMM knows the
   difference between a crash and a normal close, so the log tells you which it was.
3. **Look for a `.bak`.** `data.json` keeps a rolling backup and BMM recovers from it automatically if
   the main file is unreadable. A corrupted main file is preserved as `data.corrupt-<timestamp>.json`
   rather than deleted, so nothing is thrown away silently.
4. **Factory reset** — Settings → Debug. **No undo.** Export before you go near it.

!!! info "Still stuck?"
    The in-app **Help & other** hub has the same articles plus 44 diagrams, and
    [BetterCommunity](doc-page:features/community) is where to ask.
