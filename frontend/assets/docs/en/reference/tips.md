# Tips, controls & shortcuts

The features have their own pages. This one is about the *interactions* — the clicks, keys and
small conveniences that aren't obvious until someone points at them. Skim it once; it pays for
itself.

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/bmm-demo.bmmreplay" data-page="reference/tips" data-title="A recorded BMM session"></div>

*Click **Play** above to watch a real BMM session, reconstructed in your browser — not a
video, the actual interface replayed.*

## Keyboard shortcuts

BMM ships with five shortcuts out of the box, all `Ctrl` + a key. They jump to the right
screen and open the right thing in one press:

| Shortcut | Does |
|---|---|
| `Ctrl + N` | New profile. |
| `Ctrl + M` | Add a mod. |
| `Ctrl + E` | Export a `.MM` list. |
| `Ctrl + I` | Import a `.MM` list. |
| `Ctrl + K` | Open the command palette. |

Those are only the defaults. **Every** action BMM knows — around thirty, the same list the
palette searches — can be given a shortcut in **Settings → Keyboard Shortcuts**, not just
these five. See [Command palette & shortcuts](doc-page:features/command-palette).

## Mouse in the Library

The [Library](doc-page:features/library) is where you'll spend most of your time, and it rewards
knowing a few gestures:

| Do this | To… |
|---|---|
| **Single-click** a card | Select it and open its **detail panel** (below). |
| **Double-click** a card | Toggle the mod on / off instantly — the fastest way to activate. |
| **Right-click** a card *while it's activating* | Open a small menu to **cancel** the in-progress operation. |
| **Drag & drop** a `.zip` or a folder onto the window | Add it to the Library — no dialog, BMM works out the game. |
| Card buttons | Toggle, edit, open the mod's folder, or remove it — clicking these never triggers select/toggle. |

## The mod detail panel

Select a mod and the panel on the side fills with everything BMM knows about it. Far more than
a name:

| Section | What it tells you |
|---|---|
| **Identity / Content ID** | The mod's stable, cross-machine id, with a **copy** button. A status badge says how sure BMM is: `DECLARED` (a `bmm.json` pins it — most reliable), `PRECISE` (a content hash), `APPROXIMATE` (path + size only, may drift), or `NOT COMPUTED`. A mod meant for sharing wants `DECLARED` — ship a `bmm.json` with it. |
| **Conflicts** | Every other mod that ships a file this one also ships, tagged **Intra** (same profile) or **Extra** (another profile), and **Active** or not, with the overlapping file count. Click through to the global conflict view. |
| **Dependencies** | Mods this one relies on — editable, with suggestions as you type. |
| **Integrity check** | Verify the mod's files on disk against their stored SHA-256 hashes; BMM reports any file that's changed or missing. |
| **Browse archive** | Look inside a zipped mod without extracting it by hand. |
| **Tags** | Your own labels for filtering the Library (there's a small per-mod limit). |

None of this is homework. On day one you enable mods and move on — the panel is there for the
day a mod misbehaves and you want to know *why*.

## Selecting many mods at once

Single-click selects one mod at a time in the Library. When you genuinely need a batch — say,
building a [modpack](doc-page:features/modpacks) — use the **selection modal**: it lists your mods
with checkboxes and a **select-all**, so you tick a set and confirm in one go. Importing a
[`.MM` list](doc-page:features/modlist) works the same way: you can install the whole list or tick
just the parts you want with **Install selection**.

## The theme editor's pick tool

In the [Theme Editor](doc-page:features/themes), you don't have to hunt for the right CSS
variable. Click the **eyedropper**, then click **any element in BMM** — the editor jumps
straight to that element so you can restyle exactly what you pointed at. It's the fastest way
to answer "how do I change *that* button".

## Small habits that save you

!!! tip "Export before anything risky"

    **Settings → Data → Export** writes your whole setup to one file in a click. Do it before a
    big import, before trying someone's modpack, and always before the factory reset. It's the
    cheapest insurance in the app — and there's a [Data & Backup](doc-page:features/settings)
    tutorial that walks it.

!!! tip "Let imports build their own profile"

    When you import a `.MM` list or a repo, tick **auto-profile**. BMM builds a dedicated
    [profile](doc-page:features/profiles) for it instead of mixing it into your current setup —
    which is almost always what you want when trying someone else's configuration.

!!! tip "One game folder per profile"

    Two profiles pointing at the same game folder is the single biggest source of "a mod I
    disabled is still active". Give each profile its own folder and the whole class of problem
    disappears.
