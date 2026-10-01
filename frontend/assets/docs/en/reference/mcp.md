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

91 of them. `*` marks a required parameter; a slash-separated list is the set of accepted
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
| `bmm_get_mod_order` | — | app | The activation order: each active mod in deployment order (the last wins a shared file), whom it overrides and who overrides it, and every contested file with its winner |
| `bmm_set_mod_order` | `order`\*, `profile_id`, `reapply` | app | Set the activation order. `order` must be the same set of mods that are active; the files that change hands are re-copied (`reapply`: every contested file) |
| `bmm_export_mod_order` | `profile_id` | app | The order as a portable document for another PC: `doc` (mods named by fingerprint, repo id and name), `code` (`BMMORDER1.`), `link` (`bmm://order`), `text` (numbered names) |
| `bmm_import_mod_order` | `text`\*, `profile_id`, `dry_run` | app | Import a shared order (code, link, JSON or names). The active mods it names take its order in the slots they hold; nothing is enabled or disabled. Answers the plan and how many files moved |
| `bmm_arrange_mod_order` | `ids`\*, `mode`, `profile_id` | app | Place a block of active mods: `top` (they win), `bottom` (the rest wins), `keep`. No mode = the setting |
| `bmm_order_bulk_mode` | `mode` | app | Read, or set, where a bulk enable (modpack, Enable all, list, task, script) puts its mods by default |

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
| `bmm_generate_repo` | `name`\*, `mod_ids`\*, `zip_mods`, `compression` |  | Generate a repository from a list of mods. `zip_mods` packs each mod into one `mods/<id>.zip`; `compression` is `deflate` (default) / `zstd` / `bzip2` / `stored` |
| `bmm_start_repo_server` | `path`\*, `port`\* | app | Start the repository server |
| `bmm_plugin_assets` | `plugin_id`\* |  | The files a plugin ships in `assets/` — `{ path, kind, size, readable }`. Reads the FOLDER, so a file the manifest never mentioned still appears. Works with BMM closed |
| `bmm_read_plugin_asset` | `plugin_id`\*, `path`\* |  | Read one as text. Text kinds only; nothing is executed — reading a shipped script shows you what it would do. Works with BMM closed |
| `bmm_list_catalogs` | — | app | The catalogues this BMM follows, by type, plus `written_at` — absent means the app has not pushed its list yet, which is not the same as following nothing |
| `bmm_follow_catalog` | `type`\*, `url`\*, `follow` | app | Follow one, or stop. Goes through the app's own screens, so it appears in the following list with an origin |
| `bmm_repo_extras` | `url`\*, `password` | app | List what a repo carries besides mods — plugins, automations, themes, mod lists, catalogues to follow. Reads the manifest; downloads nothing. `locked: true` on a list means its contents are encrypted |
| `bmm_repo_extra_take` | `url`\*, `kind`\*, `id`\*, `password` | app | Install ONE of them. A plugin or automation arrives **disabled** and a plugin with no permissions — taking one is not a decision to run it. A catalogue is followed, not downloaded; a mod list is saved and its path returned, because opening one asks questions that belong to a person |
| `bmm_list_keys` | — | app | The identity keys BMM can prove with: `{name, path}` plus which is active. **Names and paths only** — no tool reads a private key |
| `bmm_create_key` | `name`\*, `kind` | app | Make an identity keypair. Returns the **public** line — the one you hand to whoever runs a protected source — and where the private half was written. The private half is never returned. `ed25519` unless a server says otherwise |
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
| `bmm_bmms_reference` | — |  | The whole BMMScript vocabulary as JSON: every action with its parameter names, the conditions, value sources, loop sources, keywords, permissions and script engines |
| `bmm_compile_bmms` | `source`\* |  | Compile BMMScript into the object `bmm_create_schedule` takes — returns `{ ok, task, errors:[{line,col,message}] }` |
| `bmm_decompile_bmms` | `task`\* |  | Print a saved task back as BMMScript, so it can be edited as text and recompiled |
| `bmm_create_plugin_scaffold` | `manifest` | ✓ | Writes a plugin DRAFT (plugin.json + README) into plugin-drafts/ — authoring only, installation stays the app's normal flow |
| `bmm_list_actions` | — |  | Every action type a step may use (`{ type, label, needs, group }`) — the same registry the in-app builder shows, generated from the app's source at build time |
| `bmm_set_schedule_enabled` | `id`\*, `enabled`\* | app | Arm or disarm one saved task. Only `enabled` — nothing here can rewrite a task's steps |
| `bmm_signal` | `name`\*, `data` | app | Ring a named doorbell a task may be waiting on (`wait.hook`), e.g. to say a build has finished |
| `bmm_signals_seen` | `name`, `since` | app | Read what a doorbell was rung with — the payloads and their times, the same view a waiting task gets. Omit `name` for every name with a count. Use it after `bmm_signal`: a name is narrowed to something that can be a key, so `build/done` is filed as `build_done` |
| `bmm_run_schedule` | `id`\* | app | Trigger a saved scheduler task by id in the running BMM app |
| `bmm_schedule_runs` | `id`\* |  | A task's run log, newest first: the last 50 runs, each step with its duration, status and error (secrets removed before a run is written). Answers "why did it fail" where `bmm_list_schedules` only says that it did. Works offline |
| `bmm_run_benchmark` | `dataset` (sandbox/real), `size` (S/M/L/XL/CUSTOM), `mb`, `sources`, `profiles`, `mode` (manual/auto) | app | Launch a BMM benchmark in the running app |

#### Writing an automation, rather than assembling one

`bmm_create_schedule` takes the shape the app **saves**: a nested tree of steps, conditions
and loops. That is the right shape to store and a poor one to write. A five-step task with a
loop in it means building that tree by hand, and a mistake in it is not reported — the task
saves, and then does the wrong thing at 03:00.

[BMMScript](doc-page:features/bmmscript-reference) is the same task as text, and its compiler
names the line and column that is wrong. So there is a loop that ends with something known to
be valid:

1. `bmm_bmms_reference` — what the words are. Generated from the same table the in-app
   builder renders, so it cannot offer an action the runner does not have.
2. `bmm_compile_bmms` — write the source, read the diagnostics, fix, repeat.
3. `bmm_create_schedule` — save the `task` the compiler returned.

To **edit** an existing task, run it the other way: `bmm_list_schedules` →
`bmm_decompile_bmms` → change the text → compile → save under the same id.

All three work with BMM closed: the compiler and the vocabulary are both inside the server.

The same executable exposes them on the command line, for a shell rather than an agent:
`bmm-mcp-server bmms-reference`, `bmms-compile --file t.bmms`, `bmms-decompile --file t.json`.
`bmms-compile` writes diagnostics to stderr and **nothing** to stdout when the source does not
compile, so `bmms-compile --file t.bmms | bmm-mcp-server create-schedule --file -` cannot save
a half-parsed task.

### Resources

| Tool | Parameters | Needs | What it does |
|---|---|---|---|
| `bmm_resources_status` | — | app | The resource governor: stored preset, the one in force (game mode or a task may differ), the task-scoped preset and its time left, game mode, and the queue of heavy operations |
| `bmm_resources_set_preset` | `name`\* (silent/balanced/max/custom), `scope` (persistent/task), `ttl_secs` | app | Pick a **named** preset. It never overrides game mode; the user sees a notification. A per-disk I/O rule is not reachable from here — it is set in Settings, or with the admin token on `POST /api/resources/io-rule` |
| `bmm_hardware_info` | — |  | CPU cores and instruction sets, GPUs (listed only — BMM runs no compute on them), each disk's bus and whether it spins. The first call can take 3 seconds while the GPU driver answers. Works offline |

### Privacy, recorder & sessions

| Tool | Parameters | Needs | What it does |
|---|---|---|---|
| `bmm_telemetry_consent` | `enabled`\* | app | Enable/disable the anonymous-usage telemetry consent in the running BMM app (GDPR opt-in) |
| `bmm_telemetry_settings` | `replay`, `full`, `bench` | app | Set Privacy & telemetry sub-options in the running BMM app |
| `bmm_recorder_set` | `on`, `full`, `rust`, `js` | app | Configure the local Session recorder in the running BMM app |
| `bmm_list_sessions` | — |  | List recorded session reports (the Session recorder's output zips) |

### Optional AI (Laya)

Off unless the user turned AI on in BMM (Settings → AI). Suggesting never writes; applying
writes only the fields named. See [Optional AI](doc-page:features/ai).

| Tool | Parameters | Needs | What it does |
|---|---|---|---|
| `bmm_ai_status` | — |  | Whether the master switch is on, the chosen provider, which features may reach the network and why not, where keys are stored (never the keys). Works offline |
| `bmm_ai_suggest_mod_metadata` | `mod_id`\*, `use_providers`, `draft` |  | Name, version, author, description, tags and links read from the mod's own files; then, only if AI is on with a provider, tags ranked from the user's EXISTING tags by Laya, language and adult-content hints, and an optional description draft from the user's generator (a local OpenAI-compatible server or their remote API), checked by rules and by Laya and marked `draft`. Each suggestion carries its source and confidence. **Writes nothing** |
| `bmm_ai_apply_mod_metadata` | `mod_id`\*, `fields`\* |  | Writes the fields the user chose (name, version, author, description, existing tag ids up to 3 per mod, http(s) links) to data.json; any other key is refused |
| `bmm_ai_ask` | `question`\*, `lang` en/fr, `scope` all/docs/mods, `limit`, `use_laya`, `write` |  | « Ask Laya », offline: answers a question about BMM or the user's mods from what EXISTS — the bundled documentation, help articles, palette commands, the user's mods, profiles and their scanned file lists. Returns `intent` (docs, setting, files, conflicts, mods, command), `hits` (kind, title, a snippet quoted from the source, score, action), `files` (which mod provides a file) and `conflicts` (pairs of mods providing the same files). Never generated text, except `write: true`: then `written` is an answer worded by the user's generator (« Writing », local or remote) from the numbered sources only, with `[n]` citations in `cites`, or `written_off` says why there is none (Laya abstained, no real citation, a link, file or command the sources do not contain). Laya routes and ranks only when AI is on and the model is installed (`laya`, `laya_off` say which). Works with BMM closed |
| `bmm_ai_analyze_library` | `mod_ids`, `use_providers`, `limit` |  | « Analyse the library »: the same suggestions as `bmm_ai_suggest_mod_metadata` for many mods at once (all, or the ids given; at most `limit`, default 200). Files only unless `use_providers`; never a generated draft. Returns only the mods with something to suggest. **Writes nothing** |
| `bmm_ai_classify` | `text`\*, `labels`\* ([{id, meaning}], 2 to 32) |  | Which of the labels fits a text, best first with a probability, plus `none` when Laya finds that none fits. The embedded model or the user's own laya-serve only, never a remote server; needs the AI master switch. The text is data, never instructions |
| `bmm_ai_pack_install` | — |  | Downloads, verifies (pinned SHA-256, mirrors in order) and installs the built-in Laya model pack (about 327 MB download) into the user's local app data, after a free-space check; resumes a partial download. Refused under `--no-ai`. Ask the user first |
| `bmm_ai_pack_remove` | — |  | Removes the downloaded model pack (never the installer's copy); the classifier goes back to off if it was the built-in one |
| `bmm_ai_test` | — |  | Classifies a fixed sample with the installed model and returns the answers, `ok` and the timings. None of the user's data, no network |
| `bmm_ai_api_status` | — |  | The local Laya API: enabled, port, whether a token exists (never the token), whether AI is on, whether it answers on 127.0.0.1 now |
| `bmm_ai_api_start` | `port` |  | Turns the local Laya API on; the running app starts it within seconds, only while AI is on. **Never returns a token**: the user makes one in Settings or with `bmm ai-api rotate`. Ask the user first |
| `bmm_ai_api_stop` | — |  | Turns the local Laya API off; the running app stops it within seconds |

### Diagnostics

| Tool | Parameters | Needs | What it does |
|---|---|---|---|
| `bmm_list_crash_reports` | `limit` |  | List crash reports |
| `bmm_read_crash_report` | `report_path`\* |  | Read raw content of a crash report |
| `bmm_analyze_crash_report` | `report_path`\* |  | Analyze a crash report |
| `bmm_generate_diagnostic_report` | `title`\*, `description`\* |  | Build a diagnostic report (system, version, profile, mod counts) for a bug report; sends nothing |
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
written by hand, because 91 tools with their parameters is exactly the list that rots the
first time someone adds one.

One cross-check is worth repeating after any change: every tool the server **declares** must
also be **dispatched**, or a client sees a tool that errors when called. At the time of
writing both sets are 91 and identical, and `scripts/check-mcp-tools.mjs` fails the
build if they ever stop being.

---

## See also

- [CLI reference](doc-page:reference/cli) — the same executable’s other half: 77 CLI subcommands for a terminal or a `.bat`
- [Local API &amp; deeplinks](doc-page:reference/api) — the REST surface, its tokens and permissions
- [Action reference](doc-page:reference/actions) — what plugins and the scheduler can trigger
- [Extending BMM](doc-page:how-it-works/extending) — where the MCP server sits in the design
