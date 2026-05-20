# Mod Identity Guide (bmm.json)

Better Mod Manager (BMM) can assign a **stable, cross-machine identity** to your mod. This allows BMM to recognize the same mod across different installations, Server Repos, and users — no matter what the folder is named.

This is entirely **optional**. BMM works fine without it.

---

## Why does it matter?

Without a declared identity, BMM computes an ID from your mod's file names and sizes. This works in most cases, but breaks if:

- Someone renames the mod folder
- A file is added or removed (e.g. a personal config)
- The mod is downloaded from a Server Repo and re-scanned

A `bmm.json` file pins the identity permanently.

---

## How to add it

Create a file named `bmm.json` at the **root of your mod folder**:

```
YourModFolder/
  bmm.json        ← here
  ... your mod files
```

Minimal content (one field is enough):

```json
{
  "id": "com.yourname.yourmod"
}
```

---

## Full schema

```json
{
  "id": "com.yourname.yourmod",
  "name": "Your Mod Display Name",
  "version": "1.2.0",
  "author": "YourName",
  "description": "A short description of what this mod does."
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | **Yes** (to be useful) | Globally unique. Lowercase, no spaces. |
| `name` | No | Overrides the folder name in BMM |
| `version` | No | Displayed in BMM |
| `author` | No | Displayed in BMM |
| `description` | No | Displayed in BMM |

---

## ID naming convention

Use **reverse-DNS style**: `com.authorname.modname`

```
com.alice.bettergrass
com.teamrocket.hardcore-overhaul
io.github.bob.mymod
```

Rules:
- Lowercase only
- No spaces (hyphens and dots are fine)
- Must be globally unique — include your name or username

---

## What BMM does without bmm.json

BMM computes an ID automatically from the list of files and their sizes in your mod folder. This ID is:

- **Stable** as long as the file list doesn't change
- **Different** across machines if the folder is renamed or files are added/removed
- **Not human-readable** (it's a hex hash)

For simple mods that never change, this automatic ID is sufficient.  
For mods distributed via **Server Repos** or intended to work with **BMM Plugins**, `bmm.json` is strongly recommended.

---

## Status in BMM

BMM shows the identity status in the mod detail panel:

| Status | Meaning |
|---|---|
| `DECLARED` | `bmm.json` found — most reliable |
| `PRECISE` | Content hash computed — reliable |
| `APPROXIMATE` | Path+size only — may drift if files change |
| `NOT COMPUTED` | Click ↻ in the detail panel to compute |
