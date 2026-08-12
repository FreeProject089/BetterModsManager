# MCP server reference

BMM ships an **MCP server**: the same capabilities the app has, exposed as Model Context
Protocol tools so an AI assistant can drive BMM directly — list your mods, switch profiles,
check integrity, run a scheduled task.

It is a separate executable that sits next to `BetterModsManager.exe` in the install folder
(`bmm-mcp-server.exe`, declared as an `externalBin` in the app's Tauri config). It speaks
**JSON-RPC over stdio**, which is what every MCP client expects, so there is no port to open
and nothing listening on the network.

!!! info "Not the same thing as the local API"

    The [local HTTP API](doc-page:reference/api) is for **plugins** and scripts: a REST surface on
    `127.0.0.1`, with tokens and per-permission scopes. The MCP server is for **AI clients**:
    stdio, no token, and it reads BMM's data files directly. They overlap on purpose — the
    last tool on this page, `bmm_api_call`, is the MCP server calling the local API for you.

---

## Connecting

Point your MCP client at the executable. The shape is the same everywhere; only the config
file differs.

```json
{
  "mcpServers": {
    "bmm": {
      "command": "C:\Program Files\BetterModsManager\bmm-mcp-server.exe"
    }
  }
}
```

No arguments and no environment variables. The server finds BMM's data on its own.

---

## Offline tools and live tools

This is the distinction that decides whether a call works, and it is worth understanding
before reading the tables.

Most tools read BMM's `data.json` straight from disk, so they answer **whether or not BMM is
running** — you can ask what mods a profile has with the app closed. The tools marked **app**
act on the running application instead: they go through the local API, and they fail with a
connection error if the BMM window is not open.

| | Reads | Works with BMM closed |
|---|---|---|
| Plain tools | `data.json`, crash reports, language files, bundled docs | yes |
| Tools marked **app** | the running app, over `127.0.0.1` | no |

---

## The tools

51 of them. `*` marks a required parameter; a slash-separated list is the set of accepted
values.

### Finding things

| Tool | Parameters | Needs | What it does |
|---|---|---|---|
| `bmm_search` | `query`\*, `limit` |  | Search EVERYTHING BMM knows about in one call: installed mods, profiles, and the bundled documentation pages |
| `bmm_search_mods` | `query`\* |  | Search mods |

### Profiles

| Tool | Parameters | Needs | What it does |
|---|---|---|---|
| `bmm_list_profiles` | — |  | List all BMM profiles |
| `bmm_get_active_profile` | — |  | Get the currently active profile |
| `bmm_get_profile` | `profile_id`\* |  | Get details of a specific profile |
| `bmm_set_active_profile` | `profile_id`\* | app | Activate a specific profile |

### Mods

| Tool | Parameters | Needs | What it does |
|---|---|---|---|
| `bmm_list_mods` | `profile_id`, `filter` (all/enabled/disabled) |  | List mods with optional filters |
| `bmm_get_mod` | `mod_id`\* |  | Get details of a specific mod |
| `bmm_set_mod_enabled` | `mod_id`\*, `enabled`\* | app | Enable or disable a mod |
| `bmm_delete_mod` | `mod_id`\*, `delete_files` | app | Delete a mod from BMM |
| `bmm_verify_mod_integrity` | `mod_id`\* |  | Verify a mod's on-disk files against its stored SHA-256 hashes |
| `bmm_list_tags` | — |  | List the user's custom mod tags |
| `bmm_sync` | — | app | Synchronize files for the active profile (apply mods) |

### Modpacks & launch packs

| Tool | Parameters | Needs | What it does |
|---|---|---|---|
| `bmm_list_modpacks` | — |  | List the user's modpacks (name, mods, share settings) |
| `bmm_create_modpack` | `name`\*, `mod_ids`\* |  | Create a modpack from a list of mod ids |
| `bmm_list_launch_packs` | — |  | List all configured Launch Packs |
| `bmm_create_launch_pack` | `name`\*, `executable_paths`\*, `icon_source_path` |  | Create a new Launch Pack (group of apps to launch) |
| `bmm_run_launch_pack` | `id`\* | app | Launch all apps in a Launch Pack |
| `bmm_delete_launch_pack` | `id`\* |  | Delete a Launch Pack |
| `bmm_open_launch_pack_folder` | `id`\* |  | Open the folder containing the Launch Pack files |

### Server repos

| Tool | Parameters | Needs | What it does |
|---|---|---|---|
| `bmm_list_connected_repos` | — |  | List the Server-Repos this BMM is connected to (name, url, sync state) |
| `bmm_generate_repo` | `name`\*, `mod_ids`\* |  | Generate a repository from a list of mods |
| `bmm_start_repo_server` | `path`\*, `port`\* | app | Start the repository server |
| `bmm_generate_lightweight_server` | `repo_path`\*, `port`\*, `auto_start`\*, `use_cloudflare`\*, `use_upnp`\*, `upload_limit`\*, `server_version`\*, `admin_password`\*, `enable_docker`, `docker_host_type`, `server_type` |  | Generate a standalone lightweight server script (.bat) for a given repo |

### Plugins & apps

| Tool | Parameters | Needs | What it does |
|---|---|---|---|
| `bmm_list_plugins` | — |  | List installed BMM plugins (id, name, version, permissions, target game) |
| `bmm_get_plugin` | `plugin_id`\* |  | Get one installed plugin's full record (manifest, permissions, state) by id |
| `bmm_list_apps` | — |  | List the App Catalog state: installed companion apps, favourites, and community catalog sources |
| `bmm_get_api_info` | `reveal` |  | Get the local Plugin API connection info (base URL, port, and token) |

### Themes

| Tool | Parameters | Needs | What it does |
|---|---|---|---|
| `bmm_list_themes` | — |  | List installed UI themes and which one is active |
| `bmm_apply_theme` | `theme_id`\* | app | Set the active BMM theme by id (e.g. bmm-discord, bmm-void, or an installed custom theme) |
| `bmm_get_theme` | `theme_id`\* |  | Read an INSTALLED custom theme's full definition (vars, element overrides) |

### Scheduling & benchmarks

| Tool | Parameters | Needs | What it does |
|---|---|---|---|
| `bmm_list_schedules` | — |  | List the saved Scheduling & automation tasks (works offline) |
| `bmm_create_schedule` | `task` | ✓ | Create or update an automation (same shape the in-app builder saves; if/repeat/doWhile/forEach/switch blocks). Created DISABLED unless enabled:true |
| `bmm_delete_schedule` | `id` | ✓ | Delete an automation |
| `bmm_create_plugin_scaffold` | `manifest` | ✓ | Writes a plugin DRAFT (plugin.json + README) into plugin-drafts/ — authoring only, installation stays the app's normal flow |
| `bmm_run_schedule` | `id`\* | app | Trigger a saved scheduler task by id in the running BMM app |
| `bmm_run_benchmark` | `dataset` (sandbox/real), `size` (S/M/L/XL/CUSTOM), `mb`, `sources`, `profiles`, `mode` (manual/auto) | app | Launch a BMM benchmark in the running app |

### Privacy, recorder & sessions

| Tool | Parameters | Needs | What it does |
|---|---|---|---|
| `bmm_telemetry_consent` | `enabled`\* | app | Enable/disable the anonymous-usage telemetry consent in the running BMM app (GDPR opt-in) |
| `bmm_telemetry_settings` | `replay`, `full`, `bench` | app | Set Privacy & telemetry sub-options in the running BMM app |
| `bmm_recorder_set` | `on`, `full`, `rust`, `js` | app | Configure the local Session recorder in the running BMM app |
| `bmm_list_sessions` | — |  | List recorded session reports (the Session recorder's output zips) |

### Diagnostics

| Tool | Parameters | Needs | What it does |
|---|---|---|---|
| `bmm_list_crash_reports` | `limit` |  | List crash reports |
| `bmm_read_crash_report` | `report_path`\* |  | Read raw content of a crash report |
| `bmm_analyze_crash_report` | `report_path`\* |  | Analyze a crash report |
| `bmm_generate_betahub_report` | `title`\*, `description`\* |  | Generate a report for BetaHub |
| `bmm_get_statistics` | — |  | Get global statistics |

### Documentation & language

| Tool | Parameters | Needs | What it does |
|---|---|---|---|
| `bmm_get_documentation_list` | — |  | List internal .md documentation |
| `bmm_read_documentation` | `file_name`\* |  | Read an internal documentation file |
| `bmm_get_language_list` | — |  | List available UI languages |
| `bmm_read_language_file` | `lang_code`\* |  | Read a language file (UI text/FAQs) |
| `bmm_get_language_template` | — | app | Download the translation template JSON from the running BMM app (translate it, then import with bmm_import_language) |
| `bmm_import_language` | `path`\* | app | Import a translated language .json file into the running BMM app |

### Data & escape hatch

| Tool | Parameters | Needs | What it does |
|---|---|---|---|
| `bmm_export_config` | `target_path`\* |  | Export BMM data.json |
| `bmm_api_call` | `method`\* (GET/POST), `path`\*, `body` | app | Call the RUNNING BMM app's local API (requires the BMM app to be open) |

---

## `bmm_api_call`, the escape hatch

Every other tool is a named capability with a schema. `bmm_api_call` is the raw door: it
performs a `GET` or `POST` against the running app's local API, so anything the API can do is
reachable even where no dedicated tool exists yet.

```json
{ "method": "POST", "path": "/api/mods/enable", "body": { "mod_id": "abc123" } }
```

It is deliberately narrow: only `GET` and `POST`, and only to `127.0.0.1/api/*`. It cannot be
pointed at another host.

!!! warning "Two calls deserve a second thought"

    `bmm_delete_mod` with `delete_files=true` removes the mod's folder from disk, and that is
    not undoable. Without the flag it only drops the entry and leaves the files alone.

    `bmm_get_api_info` with `reveal=true` returns the **full local API token** rather than a
    masked preview. That token is admin-level — see the warning on
    [`GET /api/data`](doc-page:reference/api). Anything that can read it can grant itself everything.

---

## Keeping this page honest

The tables above are generated from the `Tool::new(...)` declarations in
`src-tauri/src/mcp/server.rs` — the same ones the server registers at startup — rather than
written by hand, because 51 tools with their parameters is exactly the list that rots the
first time someone adds one.

One cross-check is worth repeating after any change: every tool the server **declares** must
also be **dispatched**, or a client sees a tool that errors when called. At the time of
writing both sets are 51 and identical.

---

## See also

- [Local API &amp; deeplinks](doc-page:reference/api) — the REST surface, its tokens and permissions
- [Action reference](doc-page:reference/actions) — what plugins and the scheduler can trigger
- [Extending BMM](doc-page:how-it-works/extending) — where the MCP server sits in the design
