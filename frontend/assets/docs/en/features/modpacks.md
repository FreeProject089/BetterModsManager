# Modpacks

:::tip[Prefer it step by step?]
The task version of this page is [Share a modpack](doc-page:guide/share-a-modpack): short steps, what you should see, a picture and a Show me button.
:::


A modpack is a **named bundle of mods you can toggle in one click**. Where a
[profile](doc-page:features/profiles) is "my setup for this game", a modpack is "this group of mods,
together" — and BMM's own screen calls the action *Quick Apply*: click to toggle a modpack
on or off.




<!-- story:share-setup -->
![Share a setup with friends](assets/docs/media/gifs/share-setup.gif)

*Share a setup with friends. The profile becomes a modpack, the modpack is hosted as a Server Repo on the LAN, a friend follows it by its address and syncs.*

<!-- /story:share-setup -->

## Modpack or profile?

They solve different problems, and using the wrong one is the usual confusion:

| | Profile | Modpack |
|---|---|---|
| Answers | "Which mods are on for this game?" | "Which mods belong together?" |
| Scope | One game, one setup | A group, reusable |
| Switching | Changes your whole setup | Toggles just that group |

A modpack can also **mix mods from different profiles** — BMM's *multi-profile* option
exists exactly for the pack that doesn't belong to a single setup.

## The Modpacks screen

The bar at the top is how you find your way around a long list of packs:

- **Search** by name.
- **Show**: *All*, *Active* or *Inactive*.
- **Sort**: *Recently updated*, *Name*, *Most mods* or *Largest*.
- **Layout**: *Grid* or *List*.

When nothing matches, the page says so and offers **Reset filters**.

Each card has **one main action**, **Activate** (or **Deactivate** while the pack is on), and a
**…** menu (*More actions*) for the rest: edit the pack, **Export & share**, and delete. Deleting
asks first, says it cannot be undone, and leaves the pack's mods installed.

### Creating a pack

**New Modpack** opens a four-step dialog, with a step bar you can click:

1. **Basics** — a name, and optionally a target game and a description.
2. **Mods** — pick the mods. They come from the current profile; choose *all profiles* to mix mods
   from several (the multi-profile option). Search, or use the quick picks: *All* and *Enabled
   now*. A mod already in the pack, from another profile, or not installed on this PC is marked.
3. **Options** — dependency mode, integrity check, activation order and download sources (see
   below). The defaults suit most packs.
4. **Review** — the order and the sources, before BMM reads the mods' files to fingerprint them.
   **Stop** cancels while it reads.

A name and one mod are enough: **Create now** skips the remaining steps and keeps the defaults.
Editing a pack opens the same dialog with every step reachable.

### Import

**Import** adds a pack someone shared with you, from one of three places:

| From | What it takes |
|---|---|
| **A file** | A `.bmp` or `.json` on this PC |
| **A link** | A web address (`http://` or `https://`) that serves a `.bmp` |
| **A catalogue** | Browse the packs other people published in the catalogues you follow, and install one |

### Export & share

**Export & share** in the card's menu saves the pack as a `.bmp` file, and shows the **pack IDs**:
what you need for a link, an automation, or to ask someone whether they have the pack. The BMM on the
other PC finds the same mods by their hashes (see below).

## Options that matter when you build one

Two settings on the create/export dialog change how a pack behaves — both worth a deliberate
choice:

**Dependency Mode** — what happens to the dependencies of the mods you picked. The dialog
opens on **Manual**, so nothing is pulled in unless you say so:

| Mode | Includes |
|---|---|
| **All** | Every dependency of every mod in the pack, automatically. Safest for sharing. |
| **Manual** | You decide per mod. For when you know exactly what you want and don't want extras pulled in. |
| **None** | No auto-dependencies at all. The pack is *only* the mods you ticked. |

**Skip Integrity Check** — off by default, and best left there. When on, applying the pack
**skips file verification** (faster) but also means BMM won't catch or repair a broken mod.
Turn it on only for a pack you fully trust and apply often; leave it off when correctness
matters.

!!! tip "Sharing? Use Dependency Mode: All"

    A pack you send someone should carry its own dependencies, or it'll import with half its
    mods "not installed". `All` is the safe default for anything leaving your machine; save
    `Manual`/`None` for personal packs where you're managing dependencies yourself.

## The order inside a pack

A pack's list is an **order**: the arrows on each mod in the editor move it up or down. When the
pack is applied, its mods are enabled and then placed in the profile's activation order as one
block, in the pack's sequence: where two of the pack's mods share a file, the one lower in the pack
wins.

Where the block goes is the pack's **Activation order** field in the editor:

| Choice | Effect |
|---|---|
| **Default (setting)** | The **Bulk enable** setting of the order view (they win, unless you changed it). |
| **They win (placed last)** | The pack wins what it shares with mods the profile already had. |
| **Yours win (placed first)** | The mods you already had keep winning. |
| **Nothing moves** | Mods already active keep their place. |

The choice travels with the pack (`.bmp` export, `.mm` lists, repos). A scheduled task or a
`bmm://modpack/enable?order=` link can override it for one run. See
[Activation order](doc-page:how-it-works/load-order).

## Sharing one: the hash is the point

When you export, BMM doesn't ship the mods — it ships a **signature**:

> BMM creates a unique signature (hash) for each mod. When a friend imports your pack, BMM
> recognises the exact mods.

So the file stays small, and "the same mod" means byte-identical, not "same name, probably".
That's what makes an import either work exactly or tell you the truth:

> The following mods are not installed on this PC.

You get the list. Nothing silently half-applies.

## Repair

If a pack's mods go missing or get corrupted, the card says so — *Some mods are missing or
corrupted* — and offers **Repair & Apply**. Use it before debugging the game: a pack that can't fully
apply is a far more likely explanation than the game itself.

(This is also the safety net **Skip Integrity Check** turns off — another reason to leave it
on unless you have a specific reason not to.)
