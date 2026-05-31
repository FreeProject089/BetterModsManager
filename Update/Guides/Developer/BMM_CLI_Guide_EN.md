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
