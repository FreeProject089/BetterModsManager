# BMMScript — every action, condition and value

!!! info ""

    79 actions · 30 conditions · 15 values · 8 loop sources

> Generated from BMM's own registry, so it cannot describe a version of the app that does not exist. If an action is in the block editor, it is in this list.

Nothing here is a separate BMMScript feature. `do <name>(…)` writes whatever the block editor calls the action, and the parameter names are the ones the runner reads — which is why this page is extracted from the code rather than written beside it.

## Actions

Written `do <name>(param: value, …)`. An action with no parameters takes empty brackets: `do mods.scan()`.

### Mods & profiles

| Action | What it does | Parameters |
|---|---|---|
| `profile.activate` | Switch the active profile | `id` |
| `mod.enable` | Activate one mod | `id` |
| `mod.disable` | Deactivate one mod | `id` |
| `modpack.enable` | Enable all mods in a modpack | `id` |
| `modpack.disable` | Disable all mods in a modpack | `id` |
| `modpack.create` | Create a modpack from a profile | `name` · `profile` |
| `mod.add` | Download & install a mod from a URL | `url` · `name` |
| `modlist.export` | Save the current mods as a .mmlist | — |
| `modlist.import` | Load mods from a .mmlist file | — |
| `mods.enableAll` | Activate every mod | — |
| `mods.disableAll` | Deactivate every mod | — |
| `mods.scan` | Rescan the mods folder | — |
| `plugin.apply` | Apply a plugin's modlist | `id` |
| `plugin.compare` | Compare a plugin to active mods | `id` |
| `plugin.delete` | Uninstall a plugin | `id` |
| `mods.checkUpdates` | Check linked mods for updates | — |
| `mods.autoImportOmm` | Imports mods found in the OvGME/OMM folders BMM knows about. | — |
| `mods.clearHistory` | Empties the mod history list. The mods themselves are untouched. | `id` |
| `mods.exportModpack` | Writes the active profile out as a shareable modpack. | `id` · `dir` |
| `modlist.apply` | Installs anything the list names that is not here, then turns exactly those on. | `path` · `url` · `install` · `exact` · `passphrase` |
| `plugin.asset` | Read one into a variable, copy it somewhere, open its folder, or run it. | `pluginId` · `path` · `mode` · `target` · `dir` · `engine` · `workingDir` |

### Repo & sharing

| Action | What it does | Parameters |
|---|---|---|
| `repo.connect` | Add a remote repo | `url` · `name` |
| `repo.sync` | Download & integrate a remote profile | `url` · `profile` |
| `repo.gen` | Open repo generation | — |
| `repo.update` | Update an exported repo | `dir` |
| `repo.host` | Serve a repo over HTTP | `dir` · `port` |
| `repo.publishSsh` | Uploads the exported folder to the SSH target saved in Server Repo | `dir` |
| `repo.fetchSsh` | Fetches the repo from the saved SSH target into a local folder | `dir` |
| `repo.syncNow` | Syncs a server repo into a local profile, unattended. | `url` · `gameDir` · `modsDir` · `password` · `repoProfile` · `backupDir` · `targetProfile` · `overwriteAll` · `deleteExtra` · `downloadLimit` · `keepZipped` |

### Apps & launch

| Action | What it does | Parameters |
|---|---|---|
| `app.launch` | Launch an installed catalog app | `id` · `exePath` |
| `app.stop` | Terminates a running program, by name or by process id. Needs the “Stop programs” permission. | `name` · `pid` |
| `file.open` | Open or run any file / .exe | `path` |
| `folder.open` | Open a folder in the explorer | `path` |
| `app.install` | Install an app from a URL | `id` · `url` · `title` |
| `launchpack.run` | Run a saved launch pack | `id` |
| `dcs.hook` | Installs the small Lua hook that tells BMM which DCS server you joined. | `mode` · `dir` |

### Appearance

| Action | What it does | Parameters |
|---|---|---|
| `theme.set` | Switch the active theme | `id` |

### Benchmarks & storage

| Action | What it does | Parameters |
|---|---|---|
| `benchmark.run` | Run a storage benchmark | `dataset` · `size` · `customMb` · `sources` |
| `storage.diskBenchmark` | Benchmark a disk's read/write | `mountPoint` |
| `storage.applyLimit` | Cap a disk's I/O speed | `mountPoint` · `limitMbS` |
| `storage.calibration` | Toggle auto performance calibration | `enabled` |
| `storage.smartIo` | Toggle Smart I/O | `enabled` |
| `storage.flag` | Toggle any advanced setting | `key` · `enabled` |
| `perf.diskSpace` | Reads free space and records it, so a condition can act on it. | `mountPoint` |

### Privacy & recorder

| Action | What it does | Parameters |
|---|---|---|
| `telemetry.consent` | Enable/disable telemetry consent | `enabled` |
| `telemetry.set` | Tune telemetry options | `replay` · `full` · `bench` |
| `recorder.set` | Configure the session recorder | `on` · `full` · `rust` · `js` |
| `replay.export` | Export the current session | — |
| `replay.import` | Import & play a replay | `path` · `url` |

### Logic & math

| Action | What it does | Parameters |
|---|---|---|
| `var.set` | Store a value for conditions/loops | `name` · `value` · `scope` |
| `math.set` | Compute an expression into a variable | `target` · `expr` |
| `var.ternary` | Set a variable from a condition (a if true, else b) | `condition` · `target` · `ifTrue` · `ifFalse` |
| `rule.table` | Map a variable to a result via a decision table | `source` · `target` · `rows` |
| `task.stop` | Stop the whole task now (use inside an IF as a guard) | `reason` |
| `code.run` | Run a BMMScript snippet as part of this task — same variables, same permissions. | `code` |
| `list.set` | Replaces the whole list. Accepts a JSON array or a plain a, b, c line. Read it back with {list.<name>.length}, or walk it with FOR EACH. | `name` · `value` · `sep` |
| `list.push` | Adds one item to the end. Unlike “set it”, running twice appends twice. | `name` · `value` |
| `list.clear` | Empties the list without deleting its name, so a later push starts from nothing. | `name` |
| `map.set` | Stores one value under one key. A list answers “which ones”; a map answers “what goes with what”. | `name` · `key` · `value` |
| `map.get` | Reads one key into a variable you name. A missing key stores an empty value — check {map.hit} to tell “not there” from “there and blank”. | `name` · `key` · `into` |
| `map.clear` | Empties the map without deleting its name. | `name` |
| `var.clear` | Removes one shared variable, or all of them. A run’s own values disappear with it anyway. | `name` |
| `text.extract` | Runs a pattern over a file's last KB, or over a variable, and keeps what it matched. | `target` · `path` · `tailKb` · `source` · `regex` · `group` |

### System & flow

| Action | What it does | Parameters |
|---|---|---|
| `notify` | Show a toast notification | `message` |
| `discord.rpc` | Toggle Discord Rich Presence | `enabled` |
| `data.exportAuto` | Unattended data backup | `dir` · `name` · `increment` |
| `app.checkUpdate` | Asks whether a BMM update exists. Sets update.available; downloads nothing. | `enabled` |
| `system.clearApiLog` | Empties the API request log. | — |
| `system.clearResourceRecords` | Empties the recorded CPU/memory samples. | — |
| `task.run` | Trigger another scheduled task | `id` |
| `task.spawn` | Starts the other task and carries straight on. Use it when the rest of this task does not depend on the result — otherwise use “Run another task”, which waits. | `id` |
| `restart` | Restart BMM | — |
| `open.url` | Open a URL or link | `url` |
| `custom.command` | Run a program with arguments | `args` · `program` · `workingDir` |
| `custom.script` | Runs PowerShell, CMD, Bash or Python you write. Needs “Run scripts”. | `engine` · `code` · `workingDir` |
| `folder.create` | Creates a folder inside BMM’s own data folder. It cannot reach outside it. | `path` |
| `catalog.create` | Write a catalog.json into a folder, plus the files it points at. Tutorials and plugins are linked; themes are embedded. | `dir` · `kind` · `name` · `base` |
| `deeplink` | Trigger any bmm:// deep link | `url` |
| `http.request` | Sends a request to any address and captures the reply. Needs “Run external programs”. | `url` · `headers` · `method` · `body` · `timeoutMs` · `jsonPath` · `allowAnyStatus` |

## Conditions

Written where a condition goes — after `if`, `case`, `waitfor`, `repeat while` and `repeat until`. `and` / `or` combine them, `not` inverts one, and brackets group.

| Condition | What it tests |
|---|---|
| `always` | Always |
| `all` | All of (AND) |
| `any` | Any of (OR) |
| `value` | Value compare (if X > Y …) |
| `textIs` | A text variable is… |
| `fileContains` | A file contains… |
| `enumIs` | variable is an enum member |
| `profileActive` | Profile is active |
| `modEnabled` | Mod is enabled |
| `modDisabled` | Mod is disabled |
| `modpackActive` | Modpack is active |
| `modpackInactive` | Modpack is inactive |
| `allModsActive` | All active-profile mods are on |
| `appRunning` | App is running |
| `appNotRunning` | App is NOT running |
| `fileExists` | File/folder exists |
| `pathIsDir` | File or folder |
| `fileHash` | File hash equals |
| `filesMatch` | Every file still matches its checksum |
| `fileSize` | File size |
| `fileType` | File type (extension) |
| `fileName` | File name contains |
| `fileNewer` | File modified recently |
| `online` | Internet is available |
| `catalogOk` | A catalog answers |
| `repoOk` | A repository answers |
| `timeReached` | Clock time reached |
| `dayOfWeek` | Day of week |
| `timeRange` | Time is within |
| `commandSucceeds` | Command succeeds |

`all` and `any` are the grouping conditions; in script you normally write `and` and `or` instead and get the same thing. `value` is the comparison row, which is what `count >= 3` compiles to.

## Values you can read

Written by an action into the task, and readable afterwards in a comparison or an expression — `if disk.free_gb < 5`, `set total = benchmark.mbps * 2`.

`disk.read_mbps` · `disk.write_mbps` · `disk.suggested_limit` · `disk.free_gb` · `disk.free_percent` · `disk.total_gb` · `benchmark.mbps` · `benchmark.total_ms` · `update.available` · `lasttask.ok` · `lasttask.spawned` · `list.length` · `http.status` · `map.size` · `map.hit`

A value nothing has written yet reads as zero. `lasttask.ok` is 1 or 0, and only means anything after a `run`.

## What a loop can walk

Written `for item in <source>`. Inside the loop, `{item.id}` and `{item.name}` are replaced in every text value.

`enabledMods` · `disabledMods` · `mods` · `profiles` · `modpacks` · `themes` · `list` · `mapKeys`

`list` and `mapKeys` need a name: `for x in list "queue"`.

## Statements

The grammar itself, which — unlike everything above — is fixed. The full explanation of each is on the [main BMMScript page](doc-page:features/bmmscript).

| | |
|---|---|
| `do <action>(k: v)` | Run one action |
| `if <cond> { } else { }` | Branch |
| `for x in <source> { }` | Loop over a list |
| `repeat N times { }` | Loop a fixed number of times |
| `repeat while|until <cond> { }` | Loop until something changes |
| `wait 30s` | Pause |
| `waitfor <cond> timeout 2h poll 10s` | Wait for something to become true |
| `try { } catch { }` | Carry on when a step fails |
| `switch { case <cond> { } default { } }` | The first case that holds, and only that one |
| `parallel { branch { } branch { } }` | Run branches at the same time |
| `parallel settle { … }` | Let every branch finish, then report failures |
| `set x = <expr>` | A number, through the expression evaluator |
| `set s = "text"` | A text variable |
| `set n: number = 0` | Typed, checked as you write it |
| `shared set k = "v"` | A variable every task can read |
| `clear x` | Remove a variable |
| `call "block name"` | Run a shared block here |
| `run "Task" · spawn "Task"` | Another task, waiting or not |
| `script python { … }` | Real code, taken exactly as written |
| `break · continue · stop` | Leave the loop, skip an item, end the task |

## Why this page is generated

BMMScript holds no list of action names: it compiles to the blocks, so an action added to BMM is writable in script the same day. That makes a hand-written reference the one part of the language that can go stale — it would keep promising the old count while the app grew. This page is extracted from the same arrays the block editor renders from, and CI fails if it is out of date.
