# BMM Tools

**BMM Tools** gathers the checks a mod library grows into, in one window. Every tool but one
only **reads**: nothing is deleted, moved or rewritten. The exception is the **Cache cleaner**,
which empties only what you tick, after a confirmation. When a tool finds something, it shows
where it is (with **Open the folder**) and you decide what to do.

## Opening it

- :kbd[Ctrl+K] → **BMM Tools…**, or straight to one tool (*Find duplicate mods and files*,
  *Compare two profiles*, *Find missing and orphaned mods*…).
- The navigation bar, once you add it: in the [navbar editor](doc-page:features/plugins), a *Modal* item set to **BMM Tools**.
- BMM DevTools, in its **Tools** section.

## The tools

The list has a search box and groups (**Library**, **Profiles**, **Disk space**, **BMM**,
**Files and authors**), with one line under each tool.

| Tool | What it tells you |
|---|---|
| **Duplicate finder** | Mods registered more than once, and identical files carried by several mods, with the space they waste. Files are compared by size, then by BLAKE3 content hash. You can ignore files under a size. |
| **Conflict summary** | Every pair of mods that write the same files, for one profile or all of them. Active conflicts come first; each pair lists its files. See [Conflicts](doc-page:how-it-works/conflicts). |
| **Deployed files check** | For each active mod: files gone from the game folder, links that point nowhere, files missing from the mod in the library, and leftover broken links next to them. |
| **Missing and orphans** | Profiles naming mods that no longer exist, mods whose folder is gone, folders no mod is registered on, profile folders that vanished. Each finding says how to fix it. |
| **Names and versions** | Mod names and versions to tidy (extra spaces, a version inside the name, an empty or odd version), with a suggestion each. Nothing is renamed. |
| **Profile diff** | Two profiles side by side: mods in only one, a different version, enabled in one and not the other, a different activation order. |
| **Duplicate profiles** | Profiles with the same (or nearly the same) active mods, or sharing a game or mods folder. |
| **Disk usage** | What each profile's mods and backups weigh, per mod, and what BMM's own data folder holds. |
| **Large files** | The biggest files in a profile's mods and backups folders, with their mod. |
| **Cache cleaner** | Measures the catalogue cache, extracted mod archives, update leftovers and archived reports, then empties only the ones you tick, after a confirmation that shows the size. It refuses to touch extracted archives while a mod is being activated. |
| **Log viewer** | This session's log and the saved session and crash reports, filtered by level and by words. |
| **Hash checker** | The BLAKE3 or SHA-256 hash of a file, compared with one you paste from a download page or a catalogue. |
| **Manifest and catalogue validator** | What a BMM file is (mod list, modpack, catalogue, repo, theme…) and what is wrong with it, from a file or pasted text. The formats are described in [Catalogue format](doc-page:reference/catalog-format), [Catalogue index](doc-page:reference/catalog-index) and [Repo format](doc-page:reference/repo-format). |
| **Catalogue diff** | Two versions of a catalogue or `repo.json`: entries added, removed and changed, with the fields that changed. |

The results area always says where it is: **not run yet**, **running** (with progress and
**Cancel**), **failed** (with the reason and **Retry**), or **done** (a summary and the results).
A cancelled tool marks its results as partial. The long scans (duplicates, disk usage, large
files, deployed files, the cache measure) also appear in the [activity centre](doc-page:features/activity) and
can be stopped from there.

## Keeping the results

Every tool's result can be **copied as JSON**, or saved as a **JSON** or **CSV** file
(`bmm-<tool>-<date>.json`), to attach to a bug report or open in a spreadsheet.

## Replay Studio and Animation Studio

Two more tools live in **BMM DevTools** (**Settings → Debug & Troubleshooting → Open Debug Menu**,
or :kbd[Ctrl+Alt+D], on a build where the debug menu is on: see [`app.cfg`](doc-page:reference/app-cfg)).
Each studio opens as its own floating panel and stays open after DevTools closes. They are how
the session replays in these docs are made.

**Replay Studio** records the app to a `.bmmreplay` file (or a video), with a movable capture
frame and pause. After a take, the **timeline** lets you:

- select a range and **cut** it, anywhere in the take, or **trim** the start and the end;
- add **markers**;
- **undo** and **redo** every edit, with a live **preview**;
- drop cursor moves for a smaller file, and hide elements from the recording.

Keyboard on the timeline: arrows move, :kbd[I] and :kbd[O] mark a range, :kbd[X] cuts,
:kbd[M] adds a marker, `[` and `]` trim, :kbd[Space] plays. An edit that would not play
back is refused and can be undone. **Export .bmmreplay** saves the take to the Replays folder;
the studio can also copy the embed for a docs page or a blog post.

**Animation Studio** adds animations to BMM's own elements, for a recording or for fun. An
animation can be a **sequence of steps**, each with its own target, preset, ease, duration and
delay, starting *after* or *with* the previous one. Steps are previewed live and reordered with
**Move up** / **Move down**. **Copy all as JSON** exports your animations; **Import** reads them
back from pasted JSON or a file (1 MB at most). An animation marked *Auto-run on appear* plays
when its target shows up, except when reduced motion is on.

:::note[What a recording holds]
A replay records what was on screen. Read [Privacy](doc-page:features/privacy-telemetry) before you share one.
:::
