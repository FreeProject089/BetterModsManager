# BMM Plugin Catalog — Structure & Publishing Guide

> This guide explains how to structure, host, and list community plugins in the **BetterModsManager_Plugins** catalog so they appear in BMM's **Catalog** tab.

---

## 1. Overview

The catalog is a JSON file hosted on GitHub at:

```
https://raw.githubusercontent.com/BetterDCS/BetterModsManager_Plugins/main/catalog.json
```

BMM fetches this file when the user opens the **Catalog** tab. Any plugin listed in `catalog.json` will be shown there with an **Install** button.

---

## 2. Repository Structure

```
BetterModsManager_Plugins/
├── catalog.json              ← The catalog index (required)
├── plugins/
│   ├── my-server-pack/
│   │   ├── plugin.json       ← Plugin manifest
│   │   ├── icon.png          ← Optional icon (40×40 px recommended)
│   │   └── my-server-pack.bmmplug   ← The packaged plugin file (ZIP)
│   └── another-plugin/
│       └── ...
└── README.md
```

---

## 3. catalog.json Format

```json
{
  "version": "1",
  "plugins": [
    {
      "id": "my-server-pack",
      "name": "My Server Modpack",
      "version": "1.2.0",
      "author": "YourGitHubName",
      "game": "DCS World",
      "description": "Required mods for My Server — updated for v2.9",
      "official": false,
      "tags": ["dcs", "multiplayer", "server"],
      "download_url": "https://github.com/BetterDCS/BetterModsManager_Plugins/raw/main/plugins/my-server-pack/my-server-pack.bmmplug",
      "icon_url": "https://raw.githubusercontent.com/BetterDCS/BetterModsManager_Plugins/main/plugins/my-server-pack/icon.png"
    }
  ]
}
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✅ | Unique identifier — lowercase, dashes only (e.g. `my-server`) |
| `name` | string | ✅ | Display name shown in BMM |
| `version` | string | ✅ | SemVer string (e.g. `1.0.0`) |
| `author` | string | ✅ | Author name or GitHub username |
| `game` | string | — | Target game (e.g. `DCS World`) |
| `description` | string | — | Short description (shown in the plugin card) |
| `official` | boolean | — | `true` = official BMM plugin (gold star badge). Leave `false` for community. |
| `tags` | string[] | — | Search tags (e.g. `["dcs", "nato", "multiplayer"]`) |
| `download_url` | string | ✅ | Direct URL to the `.bmmplug` file |
| `icon_url` | string | — | Direct URL to the plugin icon image |

---

## 4. The .bmmplug Format

A `.bmmplug` file is a **ZIP archive** renamed with the `.bmmplug` extension. It must contain:

```
my-plugin.bmmplug  (ZIP containing)
├── plugin.json     ← Required — the plugin manifest
└── icon.png        ← Optional — shown in plugin cards (40×40 recommended)
```

### plugin.json structure

```json
{
  "id": "my-server-pack",
  "name": "My Server Modpack",
  "version": "1.2.0",
  "author": "YourName",
  "game": "DCS World",
  "description": "Required mods for My Server",
  "official": false,
  "permissions": ["read_mods", "enable_mods"],
  "tags": ["dcs", "multiplayer"],
  "website": "https://myserver.example.com",
  "modlist": {
    "strict": false,
    "required_mods": [
      { "name": "ExactModFolderName", "optional": false },
      { "name": "OptionalMod",        "optional": true  }
    ]
  }
}
```

> **Important:** `required_mods[].name` must match the **exact folder name** of the mod (case-insensitive matching is supported). This is the folder name as it appears in BMM's mod library.

---

## 5. How Mods Are Matched

When a user clicks **Compare** or **Apply**, BMM checks each entry in `required_mods`:

1. It searches all installed mods for a name that **matches case-insensitively**
2. If `found = true` and `active = false` → mod is **inactive** (Apply will enable it)
3. If `found = false` and `optional = false` → mod is **missing** (blocking)
4. If `found = false` and `optional = true` → mod is **optionally missing** (non-blocking)
5. In **strict mode**: mods not in the list that are currently active are listed as **extra** (Apply will disable them)

---

## 6. Strict vs Non-Strict Mode

| Mode | Behavior |
|------|----------|
| `"strict": false` | Only enables required mods. Does **not** touch other active mods. |
| `"strict": true` | Enables required mods **and disables** all other active mods not in the list. |

Use strict mode for competitive servers where only specific mods are allowed.

---

## 7. Publishing Your Plugin

1. **Create** your plugin in BMM's **Create** tab and export it as `.bmmplug`
2. **Test** it: import the file back into BMM, compare and apply it
3. **Fork** the [BetterDCS/BetterModsManager_Plugins](https://github.com/BetterDCS/BetterModsManager_Plugins) repository
4. Add your `.bmmplug` file under `plugins/your-plugin-id/`
5. Update `catalog.json` to include your plugin entry
6. Open a **Pull Request** — it will be reviewed and merged by maintainers
7. Once merged, your plugin appears in BMM's Catalog tab for all users

---

## 8. Updating an Existing Plugin

- Bump the `version` field in both `plugin.json` and `catalog.json`
- Re-export the `.bmmplug` file and replace the old one in your PR
- BMM shows the new version in the Catalog — existing installs are **not** auto-updated (user must reinstall)

---

## 9. Permissions

Declare the permissions your plugin needs in `plugin.json`:

| Permission | What it allows |
|-----------|---------------|
| `read_mods` | Read the list of installed mods |
| `enable_mods` | Enable mods via deep link / API |
| `disable_mods` | Disable mods via deep link / API |
| `switch_profile` | Switch the active profile |
| `apply_modlist` | Apply the full plugin modlist |
| `compare_modlist` | Run a compare check |

BMM will prompt the user before granting permissions the first time.

---

*Guide version 1.0 — BetterModsManager Plugin System*
