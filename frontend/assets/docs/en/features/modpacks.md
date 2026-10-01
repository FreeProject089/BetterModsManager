# Modpacks


A modpack is a **named bundle of mods you can toggle in one click**. Where a
[profile](doc-page:features/profiles) is "my setup for this game", a modpack is "this group of mods,
together" — and BMM's own screen calls the action *Quick Apply*: click to toggle a modpack
on or off.

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/modpacks.bmmreplay" data-page="features/modpacks" data-title="Building and applying a modpack"></div>


## Modpack or profile?

They solve different problems, and using the wrong one is the usual confusion:

| | Profile | Modpack |
|---|---|---|
| Answers | "Which mods are on for this game?" | "Which mods belong together?" |
| Scope | One game, one setup | A group, reusable |
| Switching | Changes your whole setup | Toggles just that group |

A modpack can also **mix mods from different profiles** — BMM's *multi-profile* option
exists exactly for the pack that doesn't belong to a single setup.

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
corrupted* — and offers **Repair**. Use it before debugging the game: a pack that can't fully
apply is a far more likely explanation than the game itself.

(This is also the safety net **Skip Integrity Check** turns off — another reason to leave it
on unless you have a specific reason not to.)
