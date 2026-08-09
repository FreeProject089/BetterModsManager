# Action reference


Every action BMM can perform for you, in one place. There are **two catalogues** — they overlap
in capability but are separate systems:

| | Where | What it drives |
|---|---|---|
| **Scheduled-task actions** | [Scheduler](doc-page:features/scheduler) — Settings → Scheduler | Steps inside a workflow that BMM runs on a trigger |
| **Script generator actions** | [Plugins & API](doc-page:features/plugins) — script generator | Blocks that emit a runnable script (`bmm://` deeplinks and/or HTTP calls) |

!!! tip "Which one do I want?"

    Use the **scheduler** when BMM should do it *by itself* on a schedule. Use the **script
    generator** when you want a script you can run from outside BMM (a batch file, another tool,
    a game launcher).

---

## Part 1 — Scheduled-task actions

Grouped exactly as the action dropdown groups them.

### Mods & profiles

| Action | What it does | You provide |
|---|---|---|
| Activate profile | Switches the active [profile](doc-page:features/profiles) | profile |
| Enable mod | Enables one mod | mod |
| Disable mod | Disables one mod | mod |
| Enable modpack | Enables every mod in a [modpack](doc-page:features/modpacks) | modpack |
| Disable modpack | Disables every mod in a modpack | modpack |
| Create modpack | Snapshots the profile's **currently active** mods into a new modpack — not an empty one | name, profile |
| Add a mod (from URL) | Downloads and installs a mod | URL, name |
| Export a mod list (.mmlist) | Writes a mod list | — |
| Import a mod list (.mmlist) | Reads a mod list back | — |
| Enable all mods | Enables everything in the profile | — |
| Disable all mods | Disables everything in the profile | — |
| Scan mods folder | Re-scans for new mods | — |
| Apply plugin | Applies a plugin's mod list | plugin id |
| Compare plugin | Compares against a plugin's list | plugin id |
| Delete plugin | Uninstalls a plugin | plugin id |
| Check mod updates | Checks mods for new versions | — |
| Auto-import Open Mod Manager mods | Imports mods from an OMM setup | — |
| Clear profile activity history | Wipes the profile's history | profile |
| Export modpack (.bmp) | Writes a modpack file | modpack, destination |

!!! warning "Enable actions skip the integrity check"

    *Enable mod*, *Enable modpack* and *Enable all mods* run with the SHA check bypassed —
    a scheduled run can't stop to ask you about a missing hash. Enable by hand if you want the
    prompt. See [Integrity & hashing](doc-page:how-it-works/integrity-hashing).

### Repo & sharing

| Action | What it does | You provide |
|---|---|---|
| Connect repo | Adds a remote [repo](doc-page:features/repo) | repo.json URL, name |
| Sync repo | Downloads and integrates a remote profile | repo URL, remote profile |
| Generate repo | Opens repo generation | — |
| Update repo | Updates a repo folder | repo folder |
| Host repo (HTTP) | **Serves a folder over HTTP** | folder, port |

### Apps & launch

| Action | What it does | You provide |
|---|---|---|
| Launch app | Starts a registered app | app (or exe path) |
| Open / launch a file or program | **Runs any file**, including `.exe` | path |
| Open a folder | Opens a folder in the explorer | path |
| Install app | Downloads and installs an app | app id, URL, title |
| Run launch pack | Runs a [Launch Pack](doc-page:features/launch-packs) | launch pack |

### Appearance

| Action | What it does | You provide |
|---|---|---|
| Set theme | Applies a [theme](doc-page:features/themes) | theme |

### Benchmarks & storage

| Action | What it does | Captures |
|---|---|---|
| Run benchmark | Runs the app benchmark (dataset, size S/M/L/XL or custom MB) | `benchmark.mbps`, `benchmark.total_ms` |
| Benchmark a disk | Measures a disk's read/write speed | `disk.read_mbps`, `disk.write_mbps`, `disk.suggested_limit` |
| Apply disk speed limit | Sets a per-disk MB/s cap — leave empty to use the suggested value from a preceding benchmark, `0` = unlimited | — |
| Performance Auto-Calibration | Turns auto-calibration on/off | — |
| Smart I/O | Turns [Smart I/O](doc-page:features/storage) on/off | — |
| Toggle a setting (advanced) | Flips **any** boolean setting by key | — |
| Check free disk space | Reads free space | `disk.free_gb`, `disk.total_gb`, `disk.free_percent` |

Those captured values are what the `value` condition compares against — that's how you build
"*benchmark the disk, and if it's slower than 50 MB/s, warn me*".

### Privacy & recorder

| Action | What it does |
|---|---|
| Telemetry consent | Turns [telemetry](doc-page:features/privacy-telemetry) on/off |
| Telemetry options | Replay / **Full (unmasked)** / benchmark reporting |
| Session recorder | Record on/off, **Full (unmasked)**, Rust log, JS log |
| Export replay | Exports the current recording |
| Import replay | Loads a `.bmmreplay` from a path or URL |

!!! danger "“Full” means unmasked"

    Normally replays mask mod names, profile names and paths as `••••`. The *Full* switches turn
    that masking **off**. Don't schedule it unless you know where the data goes.

### System & flow

| Action | What it does | Notes |
|---|---|---|
| Show notification | Toasts a message | |
| Discord Rich Presence | Turns Discord RPC on/off | |
| Export data (backup) | Writes a backup — filename template supports `{date}`, `{time}`, `{datetime}` | the *overwrite* collision mode **replaces** an existing backup |
| Set a value | Sets a variable for later conditions | |
| Check for BMM update | Checks for a new version | captures `update.available` |
| Clear API log | Empties the API log | |
| Clear resource monitor records | Empties the resource records | |
| Run another scheduled task | Runs another task and waits | sets `lasttask.ok` (1/0) — **a task calling itself recurses** |
| Restart BMM | Restarts the app | ends the running task |
| Open a URL / link | Opens a link in your browser | |
| Run custom command | **Runs an arbitrary program** | requires *Allow custom commands* on the task |
| Run `bmm://` deeplink | Fires any deeplink | can reach any deeplink action |

### Logic & maths

| Action | What it does |
|---|---|
| Compute into a variable | Arithmetic (`+ - * / % ^`, parentheses, variables, functions). A real parser — **no `eval`** |
| Ternary | `var = condition ? a : b` |
| Rule table | Walks rows, **first match wins**, writes the result into a variable |
| Stop the task (guard clause) | Ends the task **cleanly** — not an error |

### Conditions

Used by **IF**, **WAIT UNTIL** and **LOOP**. Every condition has a **NOT** box.

| Condition | True when |
|---|---|
| `always` | Always — no gate |
| `value` | A captured number compares (`>` `<` `>=` `<=` `==` `!=`) against your threshold |
| `profileActive` | A given profile is the active one |
| `modEnabled` / `modDisabled` | A given mod is on / off |
| `modpackActive` / `modpackInactive` | Every mod in a modpack is on / off |
| `allModsActive` | Everything in the active profile is on |
| `appRunning` / `appNotRunning` | A process (by exe name) is / isn't running |
| `fileExists` | A path exists |
| `fileHash` | A file's hash (blake3/sha256) matches |
| `fileSize` | A file's size compares |
| `fileType` | A file's extension matches |
| `fileName` | A file name contains a substring |
| `fileNewer` | A file was modified within N minutes |
| `online` | There's an internet connection |
| `timeReached` | The clock has passed a time |
| `dayOfWeek` | Today is one of the days you picked |
| `timeRange` | The clock is inside a range (**wraps over midnight**) |
| `commandSucceeds` | An external command exits `0` — note this **runs the program** just to evaluate the condition |

!!! note "Missing data is false, not an error"

    If a `value` condition names a variable that was never captured, it's simply false — it won't
    fire on missing data.

**Capturable variables:** `disk.read_mbps`, `disk.write_mbps`, `disk.suggested_limit`,
`benchmark.mbps`, `benchmark.total_ms`, `lasttask.ok` (in the dropdown), plus `disk.free_gb`,
`disk.total_gb`, `disk.free_percent`, `update.available` and any variable you set yourself.

---

## Part 2 — Script generator actions

The generator builds a script from blocks and emits it in your target language. Each block is
either a **deeplink** (`bmm://…`), an **HTTP call** to BMM's local API, or a **native** operation
(a wait, a loop, a print) that needs no API at all.

!!! note "Deeplink or HTTP?"

    In deeplink mode, actions that have a native `bmm://` URL emit one; everything else falls back
    to an HTTP call — and an HTTP call needs an API token. Anything without a dedicated deeplink
    can still be reached through the generic passthrough
    `bmm://api?method=<M>&path=<path>&<field>=<value>`.

### Mods

| Action | Emits |
|---|---|
| Enable mod | `bmm://mod/enable?id=` · `POST /api/mods/enable` |
| Disable mod | `bmm://mod/disable?id=` · `POST /api/mods/disable` |
| Switch profile | `bmm://profile/activate?id=` · `POST /api/profiles/activate` |
| Enable modpack | `bmm://modpack/enable?id=` · `POST /api/modpacks/enable` |
| Disable modpack | `bmm://modpack/disable?id=` · `POST /api/modpacks/disable` |
| Apply plugin | `bmm://plugin/activate?id=` · `POST /api/plugins/apply` |
| Compare plugin | `bmm://plugin/compare?id=` · `POST /api/plugins/compare` |
| Update modpack | `PUT /api/modpacks/{id}` |
| Delete mod | `DELETE /api/mods/{id}` |
| Update mod | `PUT /api/mods/{id}` — name, version, author, description |
| Create profile | `POST /api/profiles` — name, game, the three folders |
| Update profile | `PUT /api/profiles/{id}` |
| Delete profile | `DELETE /api/profiles/{id}` |
| Create modpack | `POST /api/modpacks/create` |
| Delete modpack | `DELETE /api/modpacks/{id}` |
| Run benchmark | `bmm://benchmark/run?…` · `POST /api/benchmark` |
| Check mod updates | `bmm://mod/check-updates` · `POST /api/mod/check-updates` |

### Repo

| Action | Emits |
|---|---|
| Sync repo | `POST /api/repo/sync` — URL, folders, speed cap, **download password**, overwrite, *delete extra* |
| Cancel sync | `DELETE /api/repo/sync/cancel` |
| Generate repo | `POST /api/repo/gen` — profile, output, author, port, admin password, zip, auto-start |
| Cancel gen | `DELETE /api/repo/gen/cancel` |
| Start HTTP host | `POST /api/repo/host` — folder, port, upload cap |
| Stop HTTP host | `DELETE /api/repo/host` |
| Update repo | `POST /api/repo/update` |
| Connect repo | `POST /api/repo/connect` |
| Remove repo | `DELETE /api/repo` |

!!! warning "“Delete extra” removes local files"

    On *Sync repo*, that switch makes the local copy match the remote exactly — anything extra on
    your side is deleted.

### Apps

| Action | Emits |
|---|---|
| Install app | `POST /api/apps/install` — id, title, URL, file type |
| Launch app | `POST /api/apps/launch` |
| List installed apps | `GET /api/apps` |
| Uninstall app | `DELETE /api/apps/{appId}` — deregisters, files stay on disk |

### Read (all `GET`, no token needed, print JSON)

`GET /api/status` · `/api/mods` · `/api/mods/active` · `/api/mods/all` · `/api/profiles` ·
`/api/plugins` · `/api/modpacks` · `/api/check-update` · `/api/creator-id` · `/api/health` ·
`/api/repo/list` · `/api/repo/info?url=&password=`

!!! warning "Repo info puts the password in the query string"

    *Repo info* passes the download password as a URL parameter. Don't paste the generated line
    into a shared log or a chat.

### System

| Action | Emits |
|---|---|
| Wait | native pause (seconds) |
| Kill process | native — **force-terminates** a process by name |
| Open URL | native shell open |
| Show message | native popup, waits for the user |
| Launch game | native — **runs an arbitrary executable** |
| Log line | native print |
| Restart BMM | `POST /api/restart` |
| Run launch pack | `bmm://launchpack/run?id=` · `POST /api/launchpack/run` |
| Discord Rich Presence | `bmm://discord/rpc?enabled=` · `POST /api/discord/rpc` |
| Export data (backup) | `bmm://data/export-auto?…` · `POST /api/data/export-auto` |
| Telemetry consent | `bmm://telemetry/consent?enabled=` · `POST /api/telemetry/consent` |
| Telemetry options | `bmm://telemetry/set?…` · `POST /api/telemetry/settings` |
| Session recorder | `bmm://recorder/set?…` · `POST /api/recorder` |
| Export replay | `bmm://replay/export` · `POST /api/replay/export` |
| Import replay | `bmm://replay/import?…` · `POST /api/replay/import` |

### Control flow

| Action | What it does |
|---|---|
| Run scheduled task | `bmm://schedule/run?id=` · `POST /api/schedule/run` — bridges to the scheduler |
| Comment | A comment line; runs nothing |
| Set variable | Assigns a variable |
| If file exists / is missing | Opens a conditional block |
| If variable == / != | Opens a conditional block |
| If API call OK / failed | **Runs the linked API call**, then branches on its result |
| Else | The other branch |
| End block | Closes an `if` / `else` |
| Pause (wait for key) | Waits for a keypress |
| Stop script | Exits immediately |
| Raw code | Inserts verbatim code into the generated script |
| Loop (repeat N times) / End loop | A counted loop |
| Verify file (hash → variable) | SHA-256 of a file into a variable |
| Wait until file exists | Polls until it appears, or times out |
| Math (compute → variable) | Arithmetic into a variable |
| Ternary | Conditional assignment |
| Guard clause (stop if…) | Exits when a condition holds |

!!! note "The two catalogues are separate on purpose"

    The scheduler has **real nested steps** (IF / LOOP / WAIT UNTIL blocks that contain other
    steps). The generator, producing flat text, uses **block markers** instead (`If…` / `Else` /
    `End block`). Some actions exist only on one side: the scheduler owns the storage actions,
    *Enable/Disable all*, *Scan*, *Set theme* and raw deeplinks; the generator owns the full
    CRUD and read endpoints, *Kill process*, *Raw code* and the textual control flow.

---

## See also

- [Scheduling & automation](doc-page:features/scheduler) — triggers, workflows, `.BMMPA` sharing
- [Plugins & API](doc-page:features/plugins) — the deeplink and endpoint reference, API tokens
- [API reference](doc-page:reference/api) — the HTTP endpoints in full
