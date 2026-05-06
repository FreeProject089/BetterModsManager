# BMM MCP Server — Tools Directory & Configuration

The **Better Mods Manager (BMM) MCP Server** is a professional administrative console that allows AI agents to interact directly with BMM's backend. This guide lists all available tools and provides a configuration example.

## 🛠 Available Tools

### 📂 Profiles Management
*   `bmm_list_profiles`: List all available BMM profiles with summary statistics.
*   `bmm_get_active_profile`: Get detailed information about the currently active profile.
*   `bmm_get_profile`: Get full details of a specific profile (requires `profile_id`).
*   `bmm_set_active_profile`: Switch the active profile (requires `profile_id`).

### 📦 Mods Management
*   `bmm_list_mods`: List mods in a profile (filters: `all`, `enabled`, `disabled`).
*   `bmm_get_mod`: Get technical details of a specific mod (requires `mod_id`).
*   `bmm_search_mods`: Search for mods by name, author, or description (requires `query`).
*   `bmm_set_mod_enabled`: Enable or disable a mod (requires `mod_id` and `enabled` boolean).
*   `bmm_sync`: Apply changes to the game folder (Physical Copy Engine).

### 🌐 Infrastructure & Repositories
*   `bmm_generate_repo`: Generate a complete mod repository with authentic Ed25519 cryptographic signature (requires `name`, `mod_ids`).
*   `bmm_start_repo_server`: Start an HTTP Warp server + automatic Cloudflare Tunnel with public URL retrieval (requires `path`, `port`).
*   `bmm_generate_lightweight_server`: Generate a standalone lightweight server `.bat` script with full configuration options (requires `repo_path`, `port`, `auto_start`, `use_cloudflare`, `use_upnp`, `upload_limit`, `server_version`, `admin_password`).

### 📚 Documentation & Languages
*   `bmm_get_documentation_list`: List all internal BMM documentation files (.md).
*   `bmm_read_documentation`: Read a specific documentation file (requires `file_name`).
*   `bmm_get_language_list`: List available interface languages (en, fr, etc.).
*   `bmm_read_language_file`: Read a translation file (JSON) to access UI text and FAQs (requires `lang_code`).

### 🔍 Diagnostics & Reports
*   `bmm_get_statistics`: Get global installation statistics.
*   `bmm_list_crash_reports`: List recent crash report archives.
*   `bmm_analyze_crash_report`: Extract metadata and stacktrace from a crash zip.
*   `bmm_read_crash_report`: Read the raw content of a crash report.
*   `bmm_generate_betahub_report`: Generate a full diagnostic report for BetaHub (requires `title`, `description`).
*   `bmm_export_config`: Export `data.json` for backup purposes (requires `target_path`).

### 🚀 Launch Packs
*   `bmm_list_launch_packs`: Lists all configured Launch Packs.
*   `bmm_create_launch_pack`: Creates a new pack (requires `name`, `executable_paths`, optional `icon_source_path`).
*   `bmm_run_launch_pack`: Launches apps in a pack (requires `id`).
*   `bmm_delete_launch_pack`: Deletes a pack (requires `id`).

---

## ⚙️ Configuration Example (mcp_config.json)

To use BMM with an AI agent (like Claude Desktop or Gemini), add the following to your configuration file:

```json
{
  "mcpServers": {
    "bmm": {
      "command": "C:/Path/To/BMM/binaries/bmm-mcp-server-x86_64-pc-windows-msvc.exe",
      "args": [],
      "env": {}
    }
  }
}
```

> [!TIP]
> Make sure to replace `C:/Path/To/BMM/` with the actual path where Better Mods Manager is installed on your system.

> [!NOTE]
> The MCP binary also supports a full CLI mode. See the [BMM_CLI_Guide_EN.md](./BMM_CLI_Guide_EN.md) guide for command-line usage.
