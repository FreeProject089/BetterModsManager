# Tutorial Mods Pack

Three tiny plug-and-play mods for the BMM tutorial mini-games.

| Mod | Target game | What it does |
|---|---|---|
| `rainbow-snake` | Snake Tasky | Cycles the snake's color through every hue |
| `easy-flappy`   | Flappy Tasky | Lower gravity, wider gaps, purple bird |
| `dark-snake`    | Snake Tasky | Removes the grid, monochrome palette |

## Install

Drop the mod folder into the target game's `mods/` directory. That's it —
the game's loader scans `mods/` on launch, reads each folder's `mod.json`,
and injects the script. No index files to edit.

```
snake-game/
  game.html
  mods/
    rainbow-snake/   ← drop here
      mod.json
      rainbow.js
```

Reload `game.html` and the mod is live.

## Mod folder format

```
<mod-id>/
  mod.json          { "name", "target", "main", "version", "description" }
  <main>.js         the script referenced by mod.json's "main" field
```

If `mod.json` is missing or has no `main`, the loader defaults to `main.js`.

## Serving the game

The loader uses the HTTP directory listing of `mods/` to discover folders,
so the game needs a static server with autoindex enabled. Quick options:

```bash
python -m http.server         # works out of the box
npx serve .                   # works out of the box
```

Opening `game.html` directly via `file://` won't list directories — use a
server.
