# BMM CLI — Complete Guide

The `bmm-mcp-server` binary includes a full **CLI (Command Line Interface)** that lets you manage Better Mods Manager directly from a terminal, without opening the GUI.

## 🚀 Quick Start

```bash
# Show general help
bmm-mcp-server --help

# Show version
bmm-mcp-server --version

# BMM environment information
bmm-mcp-server info
```

---

## 📂 Profile Management

```bash
# List all profiles
bmm-mcp-server profiles

# Show active profile
bmm-mcp-server active-profile

# Switch active profile
bmm-mcp-server set-profile <PROFILE_ID>
```

### Example output (`profiles`)
```
┌───┬───────────┬───────────────────────┬──────┬─────────────────────────────────┐
│   ┆ ID        ┆ Name                  ┆ Game ┆ Mods Path                       │
╞═══╪═══════════╪═══════════════════════╪══════╪═════════════════════════════════╡
│ ► ┆ 3d616b84… ┆ Dcs_Root_Folder       ┆ DCS  ┆ E:\Mods\Dcs_Mods\Root_Mods      │
│   ┆ 4e33387d… ┆ Dcs_SavedGames_Folder ┆ DCS  ┆ E:\Mods\Dcs_Mods\SavedGame_Mods │
└───┴───────────┴───────────────────────┴──────┴─────────────────────────────────┘
```

---

## 📦 Mod Management

```bash
# List all mods
bmm-mcp-server mods

# List only enabled mods
bmm-mcp-server mods --filter enabled

# List disabled mods from a specific profile
bmm-mcp-server mods --profile <PROFILE_ID> --filter disabled

# Mod details
bmm-mcp-server mod <MOD_ID>

# Search for a mod
bmm-mcp-server search "ECHO"

# Enable a mod
bmm-mcp-server enable <MOD_ID>

# Disable a mod
bmm-mcp-server disable <MOD_ID>

# Sync (apply changes to game folder)
bmm-mcp-server sync

# Verify a mod's files against its stored SHA-256 hashes
bmm-mcp-server verify-mod <MOD_ID>

# Delete a mod (add --files to also remove its folder on disk — irreversible)
bmm-mcp-server delete-mod <MOD_ID>
bmm-mcp-server delete-mod <MOD_ID> --files

# List your custom mod tags
bmm-mcp-server tags
```

---

## 🎁 Modpacks

```bash
# List modpacks
bmm-mcp-server modpacks

# Create a modpack from mod ids/names (name first, then one or more mods)
bmm-mcp-server create-modpack "My Pack" <MOD_ID> <MOD_ID> …
```

---

## 🌐 Infrastructure & Repositories

### Generate a mod repository (with cryptographic signature)

```bash
bmm-mcp-server generate-repo --name "My_Repo" --mod-ids id1,id2,id3
```

The repository is automatically signed with your Ed25519 key (`creator_v2.key`), ensuring a "Verified" status in the BMM client.

### Start the HTTP server + Cloudflare Tunnel

```bash
bmm-mcp-server start-server --path "C:\Path\To\Repo" --port 8080
```

### Generate a standalone server (Standalone Lightweight)

```bash
bmm-mcp-server generate-lightweight \
  --repo-path "C:\Path\To\Repo" \
  --port 8000 \
  --cloudflare \
  --upnp \
  --server-version 2 \
  --password "myPassword"
```

| Option | Description | Default |
|---|---|---|
| `-d, --repo-path` | Path to the repository directory | **Required** |
| `-p, --port` | Server port | `8000` |
| `--auto-start` | Start with Windows (registry) | `false` |
| `--cloudflare` | Enable Cloudflare Tunnel | `false` |
| `--upnp` | Enable UPnP port forwarding | `false` |
| `--upload-limit` | Upload speed limit in KB/s (0 = unlimited) | `0` |
| `-v, --server-version` | Server version (1 = hybrid, 2 = Lux v2) | `2` |
| `--password` | Admin password | `admin` |

```bash
# List the Server-Repos this BMM is connected to
bmm-mcp-server repos
```

---

## 🔍 Diagnostics & Reports

```bash
# Global statistics (JSON)
bmm-mcp-server stats

# List crash reports (10 by default)
bmm-mcp-server crashes

# Limit to 5 reports
bmm-mcp-server crashes --limit 5

# Analyze a specific crash report
bmm-mcp-server crash "C:\...\crash_2026-05-06.zip"

# Export BMM configuration
bmm-mcp-server export-config "C:\backup\data.json"

# Launch a benchmark. Default opens the UI pre-filled; --auto runs now and prints results.
bmm-mcp-server benchmark --dataset sandbox --size M
bmm-mcp-server benchmark --dataset real --profile <PROFILE_ID> --auto
bmm-mcp-server benchmark --size CUSTOM --mb 500 --auto

# List recorded session reports
bmm-mcp-server sessions
```

---

## 🚀 Launch Packs (Multi-Apps)

```bash
# List configured packs
bmm-mcp-server launchpacks

# Run a pack (by ID or name)
bmm-mcp-server run-pack "My Pack"

# Delete a pack
bmm-mcp-server delete-pack <PACK_ID>

# Open a pack's folder
bmm-mcp-server open-pack <PACK_ID>
```

---

## 🔌 Plugins, API & App Catalog

```bash
# List installed plugins (id, name, version, permissions)
bmm-mcp-server plugins

# Show one plugin's full record (manifest, permissions, state)
bmm-mcp-server plugin <PLUGIN_ID>

# Show the local Plugin API URL, port & token (token masked)
bmm-mcp-server api

# Show the full API token (for scripts / plugins)
bmm-mcp-server api --reveal

# Show the App Catalog state (installed apps, favourites, community sources)
bmm-mcp-server apps
```

> [!NOTE]
> `plugins`, `apps` and the masked `api` read BMM's on-disk data, so they work even when BMM is closed. The API itself only responds while BMM is **running** (default port `51274`, configurable in Settings → Identity & API).

---

## 🎨 Themes

```bash
# List installed UI themes (and the active one)
bmm-mcp-server themes

# Show an installed custom theme's full definition
bmm-mcp-server theme-info <THEME_ID>

# Set the active theme (applies when BMM reloads themes)
bmm-mcp-server theme-apply bmm-discord
```

---

## ⏰ Scheduling & Automation

```bash
# List saved Scheduling & automation tasks (works offline)
bmm-mcp-server schedules

# Trigger a saved task by id (running app)
bmm-mcp-server run-schedule <TASK_ID>
```

---

## 🔒 Privacy & Telemetry

These drive the **running** app. Boolean flags are omitted to leave a setting unchanged.

```bash
# Configure the local Session recorder (all flags optional)
bmm-mcp-server recorder --on true --full false --rust true --js true

# Set anonymous-usage telemetry consent (positional bool)
bmm-mcp-server telemetry-consent true

# Set telemetry sub-options (omitted = unchanged)
bmm-mcp-server telemetry-settings --replay true --full false --bench true
```

---

## 🌍 Translation

```bash
# Download the translation template JSON (stdout, or --out <file>)
bmm-mcp-server lang-template --out template.json

# Import a translated .json into the running app
bmm-mcp-server import-language "C:\path\to\my-lang.json"
```

---

## 🔗 Live API bridge

```bash
# Call the running app's local API directly (GET/POST to /api/*)
bmm-mcp-server call GET /api/status
bmm-mcp-server call POST /api/mods/enable '{"mod_id":"abc"}'
```

---

## 🔄 MCP Mode (for AI agents)

MCP mode is enabled by default (no arguments) or explicitly:

```bash
# Start MCP server (JSON-RPC over stdin/stdout)
bmm-mcp-server
bmm-mcp-server serve
```

This mode is designed for AI clients like Claude Desktop, Cursor, or Gemini. See [MCP_Tools_List_EN.md](./MCP_Tools_List_EN.md) for the full MCP tool listing.

---

> [!TIP]
> Add BMM's `binaries/` folder to your `PATH` environment variable to use `bmm-mcp-server` from any terminal.
