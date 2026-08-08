# Library


The **Library** is where every mod you own lives — installed or not, from any source. If you
only ever learn one screen in BMM, make it this one: everything else (profiles, modpacks,
lists) is a different way of arranging what the Library holds.

![The Library screen](assets/docs/media/screens/library.annotated.png)

| | | |
|---|---|---|
| **1** | **Search** | Filters as you type, across names, authors and tags. |
| **2** | **Filters** | Narrow by game, category, or install state. |
| **3** | **Install** | Adds the selected mod to the profile you're currently on. |

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/library.bmmreplay" data-page="features/library" data-title="Adding a mod and enabling it"></div>


## Adding your first mod

=== "From a file"

    With the Library screen open, drag a `.zip` (or `.rar`, `.7z`, `.tar`…) or a mod folder
    onto the window. The **Add Mod** dialog opens pre-filled — the path set, the name taken
    from the file name — so all that's left is to confirm. The mod is added to the **active
    profile's** mods folder.

=== "From a repo"

    See [Server Repo](doc-page:features/repo). A repo is a shared source: connect it, **sync**, and the
    synced mods land in a profile (a dedicated one, or one you pick) and appear here
    alongside your local ones.

!!! tip "Archived mods stay archived"

    A `.zip` is kept zipped. BMM extracts it to a temporary cache only when something
    actually needs the files, so a big library doesn't cost you disk space you're not using.

## Conflicts

Two mods that ship the **same file** are in conflict. This isn't a bug in either of them —
it's what happens when two people edit the same thing — and BMM's job is to make sure you
find out *before* you commit, not after the game breaks.

When you enable a mod that overlaps another, BMM stops and says:

> Activating this mod will overwrite files from the following mods.

You then get the detail, not just a warning: **Conflicting Files** lists the exact paths that
exist in both mods, because *these files exist in both mods and create a direct conflict*.

### The rule

**The last mod activated wins.** Its version of the shared file overwrites the other's. That
is why the **Activation Order** matters and why BMM lets you set it: the order *is* the
resolution. Two people with the same mods in a different order do not have the same game.

### Global Conflict View

Rather than discovering conflicts one at a time, the global view shows every overlap in the
current profile at once. Worth a look after a big import — a `.MM` list or a modpack can
bring in a dozen mods that have never met.

### Linked mods

Separate from conflicts, and easy to confuse with them:

> The following mods are linked to this one and could be disabled.

That's a dependency, not an overlap. BMM asks rather than cascading silently — if you disable
a mod that others build on, you get to choose whether they go too.

## What "installed" means here

A mod in the Library is *available*; a mod is *installed* only relative to a
[profile](doc-page:features/profiles). That distinction is the thing newcomers trip on: uninstalling from a
profile doesn't delete the mod, it just stops that profile from using it. The mod stays in
the Library, ready for another profile.

## Controls worth knowing

The Library rewards a few gestures:

- **Single-click** a card to select it and open its **detail panel** — version, author, its
  cross-machine identity, conflicts, dependencies, an integrity check, and tags.
- **Double-click** a card to toggle it on or off instantly.
- **Right-click** a card *while it's activating* to cancel the operation.
- **Drag & drop** a `.zip` or folder onto the window to add it.

There's no multi-select in the list itself — you pick one mod at a time. When you need a
batch (building a [modpack](doc-page:features/modpacks), or importing a [`.MM` list](doc-page:features/modlist)), the
selection modal gives you checkboxes and a select-all. Full detail in
[Tips & controls](doc-page:reference/tips).
