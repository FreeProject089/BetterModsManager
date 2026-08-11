# Mapper


Some mods are packaged wrong. The files are fine; the folders around them aren't. The Mapper
fixes that without you unzipping anything by hand.

> Reorganize your mod structure to match the game directory.

![The Mod Mapper](assets/docs/media/screens/mapper.annotated.png)

| | | |
|---|---|---|
| **1** | **Source tree** | What the mod actually contains. |
| **2** | **Target** | Where those files must land for the game to see them. |
| **3** | **Diagnostic** | Shows the final location *before* you commit. |

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/mapper.bmmreplay" data-page="features/mapper" data-title="Remapping a badly-packaged mod"></div>


## When you need it

The symptom is always the same: **you install a mod, and the game acts like it isn't there.**
Nine times out of ten the archive has one folder too many — the author zipped the containing
folder instead of its contents — so the game looks for `Data/textures/` and finds
`MyMod-v3/Data/textures/`.

The Mapper is also useful the other way around: a mod that dumps its files at its root when
the game expects them under `Mods/aircraft/…`, or one that mixes two games' folders in a
single archive.

## What it actually changes

This is the thing to understand before you touch anything: **the Mapper edits the mod, not
the game.** When you remap an item, BMM moves that file or folder *inside the mod's own
folder* so the mod's layout mirrors where the game expects it. The game directory is only
ever *read* here — shown on the right so you have something to aim at. Nothing is written into
the game until you later [sync](doc-page:features/library) the profile, exactly as normal.

That's why the Mapper is safe to experiment in: the worst case is a mis-shaped mod, which you
can reshape again — never a game folder full of stray files.

One thing to know about collisions, since the Mapper won't stop to ask. Move a folder onto a
place where a folder of the same name already exists and the two are **merged**, the way
Windows Explorer merges them — what was already in there stays. Move a *file* onto a file of
the same name and it replaces it, which is what dropping it there asked for. So a mistaken drag
can cost you one file, never a whole tree.

## The two trees

The screen is split. On the left is the **mod's file tree** — every folder and file the mod
actually ships. On the right is the **game's directory tree**, the structure the game reads
from. Your job is to make the left look like the right.

Filters at the top let you narrow large trees so you can find the folder that's in the wrong
place without scrolling through hundreds of textures.

## Remapping

Pick an item in the mod tree and point it at the game folder it belongs in. BMM moves it there
*within the mod*, creating any missing parent folders along the way. A few supporting
operations round it out:

| Action | What it does |
|---|---|
| **Remap / move** | Relocate a file or folder to a different path inside the mod (the core fix). |
| **New folder** | Create a folder in the mod — useful to introduce the `Mods/…` level a badly-zipped mod is missing. |
| **Rename** | Rename a file or folder in place. |
| **Delete** | Remove an item from the mod (e.g. a stray readme or an installer's leftover folder). |
| **Open in Explorer** | Jump to the item on disk — on either the mod side or the game side — when you want to inspect it directly. |

After a remap, BMM re-scans the mod so the tree reflects the new layout immediately.

## Check before you commit

The Mapper's **Structure Diagnostic** exists for one reason:

> Check the final location of your files before applying changes.

Use it. It shows where each file will end up **before** you move anything, so you can confirm
`skin.dds` is going to land in `Mods/aircraft/F-16C/textures/` and not one level off. Guessing
at a path and applying is how you end up with a mod that still doesn't load — the Diagnostic is
there so you never have to guess.

!!! tip "Fix the package once, benefit everywhere"

    Because the Mapper reshapes the mod itself, the fix is permanent: every profile that uses
    this mod, and every future sync, gets the corrected structure. You remap once, not every
    time you activate it.
