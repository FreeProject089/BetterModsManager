# CLI reference

The executable that serves BMM's [MCP tools](doc-page:reference/mcp) is also a **command-line tool**. Same
binary, same install folder — `bmm-mcp-server.exe`, next to `BetterModsManager.exe` — and
running it with a subcommand instead of `serve` gives you 66 commands from a terminal, a
`.bat`, a cron job or a CI step.

```bash
bmm-mcp-server profiles
bmm-mcp-server enable my-mod-id
bmm-mcp-server call GET /api/status
```

!!! tip "Three ways in, one core"

    The [local HTTP API](doc-page:reference/api) is for plugins and scripts, [MCP](doc-page:reference/mcp) is for AI clients,
    and this is for a person at a prompt. They reach the same core. Pick whichever is closest
    to what is already running: a `.bat` wants the CLI, a plugin wants the API, an assistant
    wants MCP.

---

## With BMM open, and without

Some commands read BMM's data files straight off disk and work with the app **closed** —
`profiles`, `mods`, `schedules`, `schedule-runs`, `hardware`, `actions`, `bmms-compile`. Others ask the running app to do
something, and need it **open**: anything that changes state, opens a screen, or is marked
_(running app)_ below. A command that needs the app and cannot find it says so and exits
non-zero, rather than reporting that nothing happened.

`api` prints the local API's URL, port and token, which is how a script authenticates for
everything the CLI does not wrap:

```bash
bmm-mcp-server api --reveal
```

---

## The commands

66 of them. `*` marks a required argument; a value in brackets is the default. Positional
arguments are written `<like-this>`, flags `--like-this`.

### Getting your bearings

| Command | Arguments | What it does |
|---|---|---|
| `serve` | — | Start the MCP server (JSON-RPC over stdio). This is what an MCP client runs; it is also the default when you give no subcommand at all |
| `info` | — | Where BMM keeps its data, which version is installed, whether the app is running |

### Profiles

| Command | Arguments | What it does |
|---|---|---|
| `profiles` | — | List all profiles |
| `active-profile` | — | Show details of the active profile |
| `set-profile` | `<profile-id>`\* | Set the active profile |

### Mods

| Command | Arguments | What it does |
|---|---|---|
| `mods` | `--profile`, `--filter` (`all`) | List mods, optionally for one profile. `--filter` is `all`, `enabled` or `disabled` |
| `mod` | `<mod-id>`\* | Show one mod in full |
| `search` | `<query>`\* | Search mods by name and description |
| `enable` | `<mod-id>`\* | Enable a mod in the active profile |
| `disable` | `<mod-id>`\* | Disable a mod |
| `sync` | — | Apply the active profile: deploy what is enabled, remove what is not |

### Server repos

| Command | Arguments | What it does |
|---|---|---|
| `generate-repo` | `--name`\*, `--mod-ids`, `--zip-mods` (`false`), `--compression` (`deflate` / `zstd` / `bzip2` / `stored`) | Generate a mod repository, signed with this installation's identity. `--zip-mods` packs each mod into one `mods/<id>.zip`; `--compression` picks how those zips are compressed |
| `start-server` | `--path`\*, `--port` (`8080`) | Start the repository HTTP server, with a Cloudflare tunnel if one is configured |
| `generate-lightweight` | `--repo-path`\*, `--port` (`8000`), `--auto-start` (`false`), `--cloudflare` (`false`), `--upnp` (`false`), `--upload-limit` (`0`), `--server-version` (`2`), `--password` (`admin`) | Write a standalone `.bat` that serves a repo folder, for a machine that will not have BMM on it |

### Diagnostics

| Command | Arguments | What it does |
|---|---|---|
| `stats` | — | Global statistics: mods, profiles, disk |
| `crashes` | `--limit` (`10`) | List recent crash reports |
| `crash` | `<report-path>`\* | Read and analyse one crash report |
| `export-config` | `<target-path>`\* | Write BMM's `data.json` to a file |

### Launch packs

| Command | Arguments | What it does |
|---|---|---|
| `launchpacks` | — | List all launch packs |
| `run-pack` | `<id>`\* | Run one launch pack |
| `delete-pack` | `<id>`\* | Delete one launch pack |
| `open-pack` | `<id>`\* | Open a launch pack's folder |

### Plugins, apps and the rest of the library

| Command | Arguments | What it does |
|---|---|---|
| `api` | `--reveal` (`false`) | The local Plugin API's URL, port and token. The token is hidden unless you pass `--reveal`, so the bare command is safe to run in front of somebody |
| `plugins` | — | Installed plugins: id, name, version, permissions |
| `plugin` | `<plugin-id>`\* | One plugin's full record — manifest, permissions, state |
| `plugin-assets` | `<plugin-id>`\* | The files a plugin ships in its `assets/` folder |
| `plugin-asset` | `<plugin-id>`\*, `<path>`\* | Print one of those files. Text only, and nothing is executed |
| `apps` | — | App Catalog state: installed apps, favourites, community sources |
| `modpacks` | — | List modpacks |
| `create-modpack` | `<name>`\*, `<mod-ids>` | Create a modpack from mod ids or names |
| `tags` | — | The custom mod tags you have made |
| `repos` | — | The Server-Repos this BMM is connected to |
| `themes` | — | Installed UI themes, and which one is active |
| `verify-mod` | `<mod-id>`\* | Check a mod's files on disk against its stored SHA-256 hashes |
| `delete-mod` | `<mod-id>`\*, `--files` (`false`) | Remove a mod from BMM. `--files` also deletes its folder |

### What a repo carries besides mods

| Command | Arguments | What it does |
|---|---|---|
| `catalogs` | — | The catalogues this BMM follows, by type |
| `follow` | `--type`\*, `<url>`\*, `--off` (`false`) | Follow a catalogue; `--off` stops following it |
| `repo-extras` | `<url>`\*, `--password` | What a repo carries besides mods — plugins, automations, themes, mod lists, catalogues to follow. Reads the manifest and downloads nothing |
| `repo-take` | `<url>`\*, `<kind>`\*, `<id>`\*, `--password` | Take ONE of them, named by kind and id from `repo-extras`. A plugin or an automation arrives **disabled**; a catalogue is followed rather than downloaded; a mod list is saved and its path printed |

### Identity keys

| Command | Arguments | What it does |
|---|---|---|
| `keys` | — | The identity keys BMM can prove with — names and paths only |
| `new-key` | `<name>`\*, `--kind` | Make a keypair. Prints the PUBLIC line and where the private half was written; the private half itself is never printed |

### The escape hatch

| Command | Arguments | What it does |
|---|---|---|
| `call` | `<method>`\*, `<path>`\*, `<body>` | Call the running app's [local API](doc-page:reference/api) directly — `call GET /api/status`. Everything the CLI does not wrap is reachable this way |

### Privacy, recorder and sessions

| Command | Arguments | What it does |
|---|---|---|
| `recorder` | `--on`, `--full`, `--rust`, `--js` | Configure the local Session recorder _(running app)_ |
| `sessions` | — | List recorded session reports |
| `telemetry-consent` | `<enabled>`\* | Set the anonymous-usage telemetry consent _(running app)_ |
| `telemetry-settings` | `--replay`, `--full`, `--bench` | Set the Privacy &amp; telemetry sub-options _(running app)_. An omitted flag is left unchanged |

### Scheduling and automation

| Command | Arguments | What it does |
|---|---|---|
| `schedules` | — | The saved tasks: id, name, whether each is armed |
| `schedule-set` | `<id>`\*, `--off` (`false`) | Arm or disarm one task |
| `signal` | `<name>`\*, `<data>` | Ring a doorbell a task may be waiting on (`wait.hook`) |
| `run-schedule` | `<id>`\* | Run a saved task now _(running app)_ |
| `schedule-runs` | `<id>`\* | A task's run log, newest first: each run's duration, step count and, when it failed, the first error. Works with BMM closed |
| `create-schedule` | `--file`, `--json` | Create or update a task from a JSON file (`-` for stdin) or inline JSON. The shape is what the in-app builder saves, and a new task is created **disabled** unless the JSON says `enabled: true` — so it can be read before it ever fires |
| `delete-schedule` | `<id>`\* | Delete a task |

### Resources

| Command | Arguments | What it does |
|---|---|---|
| `resources` | — | The resource governor as JSON: stored preset, the one in force, game mode, the queue _(running app)_ |
| `resources-preset` | `<name>`\*, `--scope` (`persistent`), `--ttl` | Pick a **named** preset: `silent`, `balanced`, `max` or `custom`. `--scope task` ends by itself after `--ttl` seconds (7200 at most) _(running app)_ |
| `hardware` | — | CPU features, GPUs and each disk's bus, as JSON. Works with BMM closed |

### Authoring: plugins and BMMScript

| Command | Arguments | What it does |
|---|---|---|
| `create-plugin` | `--file`, `--json`, `--scripts` | Scaffold a plugin draft — `plugin.json`, README, bundled scripts — under `<app-data>/plugin-drafts/<id>/`. Authoring only: zip the draft and install it through BMM's normal flow, and scripts still only run behind the unsafe-plugins permission |
| `actions` | — | Every action type a task step may use, from the same registry the in-app builder shows. A step is `{kind:'action', action:{type:<one of these>, params:{…}}}` |
| `bmms-reference` | — | The whole [BMMScript](doc-page:features/bmmscript-reference) vocabulary as JSON: actions and their parameters, conditions, value sources, loop sources, keywords, permissions, script engines |
| `bmms-compile` | `--file`, `--source` | Compile BMMScript into the task JSON `create-schedule` takes |
| `bmms-decompile` | `--file`, `--json` | Print a saved task back as BMMScript — the way to edit one as text rather than as a tree |

The pair is the point:

```bash
bmm-mcp-server bmms-compile --file nightly.bmms | bmm-mcp-server create-schedule --file -
```

`bmms-compile` exits non-zero and prints **nothing** on stdout when the source does not
compile, so that pipe cannot save a half-parsed task. Writing the JSON by hand means
assembling a nested tree and finding out it was wrong when the task runs; this names the line
and the column instead. Neither command needs the app open.

### Benchmarks

| Command | Arguments | What it does |
|---|---|---|
| `benchmark` | `--dataset` (`sandbox`), `--size` (`M`), `--mb`, `--source`, `--profile`, `--auto` (`false`) | Launch a benchmark _(running app)_. `--dataset sandbox` generates its own data; `real` uses `--source` folders and `--profile` ids. Without `--auto` it opens the benchmark screen pre-filled instead of running headless |

### Language and themes

| Command | Arguments | What it does |
|---|---|---|
| `lang-template` | `--out` | Download the translation template JSON — every key with its English default _(running app)_ |
| `import-language` | `<path>`\* | Install a translated `.json` _(running app)_ |
| `theme-apply` | `<theme-id>`\* | Set the active theme; it applies when BMM next reloads themes |
| `theme-info` | `<theme-id>`\* | An installed custom theme's full definition |

---

## Keeping this page honest

This table is checked against the `Commands` enum in
`src-tauri/src/extra_tools/mcp_server.rs` — the same declarations clap builds the command tree
from — by `scripts/check-cli-reference.mjs`, which runs in CI. Every command must appear here,
every argument must be named, and the count above must be the real one.

That is the same arrangement the [MCP reference](doc-page:reference/mcp) has, and for the same reason: a list
of sixty-six things maintained by hand goes wrong the first time somebody adds a
sixty-seventh, and nothing about a wrong reference page fails to compile.

---

## See also

- [MCP server reference](doc-page:reference/mcp) — the same binary's other half, and the 69 tools it exposes
- [Local API &amp; deeplinks](doc-page:reference/api) — what `call` is calling
- [BMMScript reference](doc-page:features/bmmscript-reference) — the language `bmms-compile` reads
- [Action reference](doc-page:reference/actions) — what `actions` lists
