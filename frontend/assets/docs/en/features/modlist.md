# .MM Lists

A `.MM` file is your **complete setup, written down** — and unlike a
[modpack](doc-page:features/modpacks), it carries the download links, so the person receiving it doesn't
need to own the mods first.

BMM's own definition:

> A file containing your complete list of mods, download links, installation order and
> configuration.

That's the difference in one line. A modpack says *which mods*; a `.MM` list says *which
mods, where to get them, and in what order*.

![The .MM Lists screen](assets/docs/media/screens/modlist.annotated.png)

| | | |
|---|---|---|
| **1** | **Export** | Writes the `.MM` file. |
| **2** | **Import** | Reads one, then fetches and installs. |
| **3** | **Auto-profile** | Generates a dedicated profile for the imported list. |

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/modlist.bmmreplay" data-page="features/modlist" data-title="Exporting and importing a .MM list"></div>


## Sharing

> Send your `.MM` file to other users to exactly reproduce your configuration.

*Exactly* is the operative word, and it's why the order travels with the list: the mods are
a JSON array, and a `.MM` reproduces that sequence on the other side. Two people with the
same mods in a different activation order do **not** have the same game — see
[conflicts](doc-page:features/library#conflicts).

!!! note "What a `.MM` does not carry"
    Conflict *rules* are not part of the format. A `.MM` records each mod's file tree and
    install notes, so the receiving BMM detects the same overlaps you had — but the
    decisions you made about them stay on your machine.

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

A `.MM` is a **ZIP** holding `modlist.json`, plus a signature. It used to be a bare JSON
document, and **both still open** — every list anybody has ever exported is the old shape,
and BMM decides from the file's own bytes rather than from a version field.

Alongside the list metadata (name, game, author, date), each mod carries everything needed
to reproduce it:

| Per mod | What it's for |
|---|---|
| **Download links** | One or more URLs — tagged `github`, `google_drive`, `direct`, `mega`, or `other` — so the recipient can fetch the mod without owning it first. |
| **File tree** | The mod's file layout (paths and sizes), and optional per-file **hashes**. This is what powers verification and what BMM compares to find [conflicts](doc-page:features/library#conflicts). |
| **Dependencies** | What the mod needs, **by name** — an internal id means nothing on somebody else's install, so names are what both sides can match on. |
| **Update sources** | Where the mod updates itself from, so a shared list keeps its repos instead of arriving with every source to re-attach by hand. |
| **Install notes** | Any placement or special-setup instructions the author attached. |
| **Order** | The mod's place in the list. |

And beside the mods, the list carries:

| Also in the file | What it's for |
|---|---|
| **Tag definitions** | The name, colour and icon of every tag the entries refer to. Without these the tags arrive as ids that resolve to nothing and simply vanish. |
| **Modpacks** | Any pack whose mods are **all** in the list. A pack that installs nine of its twelve mods is worse than one that is missing, so a partial pack is left out. |
| **A signature** | Written with your creator key. Anyone opening it — including [BetterCommunity's moderation tools](https://bettercommunity.ch) — can tell whether the file is still what you wrote. |

!!! note "\"Conflict rules\" = the order"

    A `.MM` doesn't carry a separate rulebook for clashes. What it carries is the **order**,
    and the order *is* the resolution: when two mods ship the same file, the one activated
    later wins (see [conflicts](doc-page:features/library#conflicts)). Reproducing someone's setup
    "exactly" means reproducing their order — which is exactly what importing a `.MM` does.
