# .MM Lists

A `.MM` file is your **complete setup, written down** — and unlike a
[modpack](doc-page:features/modpacks), it carries the download links, so the person receiving it doesn't
need to own the mods first.

BMM's own definition:

> A JSON file containing your complete list of mods, download links, installation order and
> conflict rules.

That's the difference in one line. A modpack says *which mods*; a `.MM` list says *which
mods, where to get them, in what order, and what to do when they clash*.

![The .MM Lists screen](assets/docs/media/screens/modlist.annotated.png)

| | | |
|---|---|---|
| **1** | **Export** | Writes the `.MM` file. |
| **2** | **Import** | Reads one, then fetches and installs. |
| **3** | **Auto-profile** | Generates a dedicated profile for the imported list. |

<div class="bmm-replay"
     data-src="../assets/replays/modlist.bmmreplay"
     data-title="Exporting and importing a .MM list (placeholder clip)"></div>

*Placeholder recording — a focused clip of this screen will replace it.*

## Sharing

> Send your `.MM` file to other users to exactly reproduce your configuration.

*Exactly* is the operative word, and it's why the order and the conflict rules travel with
the list. Two people with the same mods and a different activation order do **not** have the
same game — see [conflicts](doc-page:features/library#conflicts).

### Include hashes?

An export option, and a real trade-off in BMM's own words:

> Verifiable by recipients — slower for large mods.

Include them when correctness matters (you're publishing a list, or debugging someone
else's). Skip them for a quick hand-off to a friend on a fast connection.

## Importing

BMM retrieves the archives and extracts them (*Installation in progress…*), then respects
the order the list carries. Tick **auto-profile** and it builds a dedicated
[profile](doc-page:features/profiles) for the list rather than mixing it into your current one — which is
almost always what you want when trying someone else's setup.

## What actually travels in a `.MM`

It's a single JSON file. Alongside the list metadata (name, game, author, date), each mod
carries everything needed to reproduce it:

| Per mod | What it's for |
|---|---|
| **Download links** | One or more URLs — tagged `github`, `google_drive`, `direct`, `mega`, or `other` — so the recipient can fetch the mod without owning it first. |
| **File tree** | The mod's file layout (paths and sizes), and optional per-file **hashes**. This is what powers verification and what BMM compares to find [conflicts](doc-page:features/library#conflicts). |
| **Install notes** | Any placement or special-setup instructions the author attached. |
| **Order** | The mod's place in the list. |

!!! note "\"Conflict rules\" = the order"

    A `.MM` doesn't carry a separate rulebook for clashes. What it carries is the **order**,
    and the order *is* the resolution: when two mods ship the same file, the one activated
    later wins (see [conflicts](doc-page:features/library#conflicts)). Reproducing someone's setup
    "exactly" means reproducing their order — which is exactly what importing a `.MM` does.
