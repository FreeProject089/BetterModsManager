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
*   `bmm_delete_mod`: Delete a mod from BMM (requires `mod_id`; set `delete_files: true` to also remove its folder from disk — irreversible).
*   `bmm_verify_mod_integrity`: Verify a mod's on-disk files against its stored SHA-256 hashes; returns per-file ok/corrupted (requires `mod_id`).
*   `bmm_list_tags`: List the user's custom mod tags.

### 🎁 Modpacks
*   `bmm_list_modpacks`: List the user's modpacks (name, mods, share settings).
*   `bmm_create_modpack`: Create a modpack from a list of mod ids (requires `name`; optional `mod_ids`).

### 🌐 Infrastructure & Repositories
*   `bmm_generate_repo`: Generate a complete mod repository with authentic Ed25519 cryptographic signature (requires `name`, `mod_ids`).
*   `bmm_start_repo_server`: Start an HTTP Warp server + automatic Cloudflare Tunnel with public URL retrieval (requires `path`, `port`).
*   `bmm_generate_lightweight_server`: Generate a standalone lightweight server `.bat` script with full configuration options (requires `repo_path`, `port`, `auto_start`, `use_cloudflare`, `use_upnp`, `upload_limit`, `server_version`, `admin_password`).
*   `bmm_list_connected_repos`: List the Server-Repos this BMM is connected to (name, url, sync state).

### 📚 Documentation & Languages
*   `bmm_get_documentation_list`: List all internal BMM documentation files (.md).
*   `bmm_read_documentation`: Read a specific documentation file (requires `file_name`).
*   `bmm_get_language_list`: List available interface languages (en, fr, etc.).
*   `bmm_read_language_file`: Read a translation file (JSON) to access UI text and FAQs (requires `lang_code`).
*   `bmm_get_language_template`: Download the translation template JSON from the running app (translate it, then import with `bmm_import_language`).
*   `bmm_import_language`: Import a translated language `.json` file into the running app (requires `path`).

### 🔍 Diagnostics & Reports
*   `bmm_get_statistics`: Get global installation statistics.
*   `bmm_list_crash_reports`: List recent crash report archives.
*   `bmm_analyze_crash_report`: Extract metadata and stacktrace from a crash zip.
*   `bmm_read_crash_report`: Read the raw content of a crash report.
*   `bmm_generate_betahub_report`: Generate a full diagnostic report for BetaHub (requires `title`, `description`).
*   `bmm_export_config`: Export `data.json` for backup purposes (requires `target_path`).
*   `bmm_run_benchmark`: Launch a benchmark in the running app. `dataset`: `sandbox` (generated) or `real` (your mods); `size`: `S|M|L|XL|CUSTOM` (`mb` required for CUSTOM); `sources`/`profiles` add real mod folders; `mode`: `manual` (opens pre-filled UI) or `auto` (runs now, returns results).
*   `bmm_list_sessions`: List recorded session reports (the Session recorder's output zips).

### 🚀 Launch Packs
*   `bmm_list_launch_packs`: Lists all configured Launch Packs.
*   `bmm_create_launch_pack`: Creates a new pack (requires `name`, `executable_paths`, optional `icon_source_path`).
*   `bmm_run_launch_pack`: Launches apps in a pack (requires `id`).
*   `bmm_delete_launch_pack`: Deletes a pack (requires `id`).
*   `bmm_open_launch_pack_folder`: Open the folder containing a pack's files (requires `id`).

### 🔌 Plugins & API
*   `bmm_list_plugins`: List installed BMM plugins (id, name, version, permissions, target game).
*   `bmm_get_api_info`: Get the local Plugin API connection info — base URL, port and token. Pass `reveal: true` to return the full token instead of a masked preview.
*   `bmm_get_plugin`: Get one installed plugin's full record — manifest, permissions, state (requires `plugin_id`).
*   `bmm_api_call`: Call the RUNNING app's local API (requires the BMM app to be open). Covers every live feature not exposed as its own tool (requires `method`, `path`; optional `body`). Only GET/POST to `127.0.0.1/api/*`.

### 🛍 App Catalog
*   `bmm_list_apps`: List the App Catalog state — installed companion apps, favourites, and your community catalog sources.

### 🎨 Themes
*   `bmm_list_themes`: List installed UI themes and which one is active.
*   `bmm_get_theme`: Read an installed custom theme's full definition — vars, element overrides (requires `theme_id`).
*   `bmm_apply_theme`: Set the active theme by id, e.g. `bmm-discord`, `bmm-void`, or an installed custom theme (requires `theme_id`; applies when BMM reloads themes).

### ⏰ Scheduling & Automation
*   `bmm_list_schedules`: List the saved Scheduling & automation tasks (works offline).
*   `bmm_run_schedule`: Trigger a saved scheduler task by id in the running app (requires `id`).

### 🔒 Privacy & Telemetry
*   `bmm_recorder_set`: Configure the local Session recorder in the running app. All fields optional: `on` (master switch), `full` (full-session capture), `rust` (Rust traces), `js` (frontend traces).
*   `bmm_telemetry_consent`: Enable/disable the anonymous-usage telemetry consent in the running app (requires `enabled` boolean).
*   `bmm_telemetry_settings`: Set telemetry sub-options in the running app; omitted fields stay unchanged: `replay`, `full`, `bench` (booleans).

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
