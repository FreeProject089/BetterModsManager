# API & deeplink reference


BMM exposes two ways to drive it from outside: **deeplinks** (`bmm://…`, no token, fired at the
running window) and a **local HTTP API** (token, `127.0.0.1` only). Everything here comes from the
app's own registries, so it matches what *Plugins & API* shows in-app.

!!! tip "Which one?"

    A deeplink is a URL — anything that can open a link can trigger it (a `.bat`, a shortcut, a
    website, another app) and it needs no secret. The HTTP API is for reading data back and for
    payloads a URL cannot express. If a thing exists as both, prefer the deeplink.

---

## Transport

| | |
|---|---|
| Base URL | `http://127.0.0.1:51274` |
| Bind address | **`127.0.0.1` only** — never `0.0.0.0`, so nothing off-machine can reach it |
| Port | `51274` by default; override with `settings.api_port` (`0` falls back to the default). Needs a restart |
| Effective port | Read it at runtime from `GET /api/health` → `port` |
| Rate limiting | **None.** Do not expose this port |

!!! warning "If the port is already taken, the API does not start at all"

    It does **not** fall back to another port. BMM binds with a graceful-shutdown handler; if
    something already holds 51274 — typically a zombie instance after an in-app restart — the API
    is **disabled for that whole session** and a line goes to the crash log. The app keeps working
    normally, so a script failing to connect is the only symptom. Check `GET /api/health` first.

**CORS.** In a release build, origins are limited to `https://tauri.localhost`,
`tauri://localhost`, `http://tauri.localhost`, `https://bettercommunity.ch`, plus anything you add
in *Plugins & API → CORS* (a lone `*` entry opts into allow-any). A `tauri dev` build allows any
origin. The list is read **once when the API starts**. `curl` and deeplinks send no `Origin`, so
none of this affects them.

---

## Authenticating

```bash
curl -H "Authorization: Bearer <token>" http://127.0.0.1:51274/api/mods
```

`Authorization: Bearer …` is the only accepted form, and it is compared in **constant time**.
There are two kinds of token:

| | Where it comes from | Scope |
|---|---|---|
| **Admin token** | A UUID v4 minted on first run, stored in `data.json` as `settings.api_token`. Rotate it from *Plugins & API* | Everything. Bypasses all permission checks |
| **Plugin token** | Issued per plugin, stored as `settings.plugin_tokens` (`token → plugin_id`) | Only what that plugin has been granted |

The token is re-read on **every** request, so rotating takes effect immediately — no restart.

### Permissions

For a plugin token the caller's identity comes **from the token**, never from the
`X-BMM-Plugin-Id` header — a plugin cannot escalate by forging or omitting that header. Grant with
`PUT /api/apps/permissions/<plugin_id>`:

`app.read` · `app.write` · `catalog.read` · `catalog.write` · `data.read` · `data.write` ·
`hooks.read` · `hooks.write` · `keys.read` · `keys.write` · `modpacks.read` · `modpacks.write` ·
`mods.read` · `mods.write` · `plugins.read` · `plugins.write` · `profiles.read` · `profiles.write` ·
`repo.read` · `repo.write` · `schedules.read` · `schedules.write` · `system.write` · `telemetry.write`

That list lives in the code as `api::PLUGIN_SCOPES`, and a test asserts it matches the router
in both directions: a scope the router demands that nothing can grant is a route nothing can
reach, and a scope that gates no route is a checkbox promising protection it does not give.

!!! warning "`keys.write` is deliberately not part of `repo.write`"

    An identity key is what proves you are *you* to every protected source. "Can publish a
    repo" must not also mean "can mint the thing I sign with", so it is its own grant — and
    `keys.read`, seeing which identities exist, is separate again.

!!! note "Read and write are separate, and reads ARE gated"

    They were not. Fifty routes needed a token and no permission at all, and `require_token`
    accepts **any** plugin token — so `GET /api/data` (the full dump), `POST /api/data/import`,
    `POST /api/restart` and `DELETE /api/plugins/<id>` were reachable by a plugin with an empty
    permission list. They are gated now.

    On upgrade, each plugin keeps the read half of every domain it already had write on:
    trusted to change your mods means still able to list them. Nothing else is carried over,
    so a plugin that was leaning on a domain it was never granted now gets a `403` naming the
    scope — which is one click from granted, and a great deal better than a silent hole.

!!! danger "The permission table itself is admin-only"

    `GET`/`PUT /api/apps/permissions*` take the **admin token**, never a plugin token. A plugin
    that could `PUT` its own grants could grant itself everything, which would make this entire
    page decorative.

### Errors

| Status | Body |
|---|---|
| `401` | `{"error":"Unauthorized: invalid or missing token"}` |
| `403` | `{"error":"Forbidden: plugin '<id>' lacks permission '<perm>' — grant it with: PUT /api/apps/permissions/<id>"}` |
| `400` | bad JSON body |
| `404` / `405` / `500` | `{"error":"…"}` |

---

## Deeplinks

Fired at the running window — **no token**. From a script:

```bat
start "" "bmm://mod/enable?id=my-mod-folder"
```

```powershell
Start-Process "bmm://mod/enable?id=my-mod-folder"
```

`*` marks a required parameter. Each one shows a toast on receipt, and a global kill switch
(`bmm_deeplink_allow_global = blocked`) refuses all of them.

!!! warning "A link from outside asks before it changes anything"

    Any web page can fire a `bmm://` link, and the browser does not tell BMM which page. So a
    link arriving from outside (the OS, a theme's button, the deep-link tester) that would
    change state, download, write or run something opens **one in-app dialog first**: what
    will happen in plain words, the exact target (path, URL and its server on its own line,
    plugin or app name) and who asked. **Cancel is the default** (it has focus, Escape
    answers no), and nothing is applied, fetched, written or run before you confirm.

    Some things are refused outright, whatever you would answer:

    | Refused from a link | Why |
    |---|---|
    | `app/launch` with `exe=` | A link can only start an app BMM registered, by `id` — never a path it names. Scripts (`.ps1`, `.bat`, `.cmd`, …) are never started from a link, so `-ExecutionPolicy Bypass` never is either |
    | Downloads that are not `https` (`app/install`, `catalog/*/install`, `theme/import`, `catalog/follow`, `catalog/import`, `install`) | The file would be swappable on the way |
    | `app/install` / `catalog/app/install` without a `sha256`, or whose file does not match it; any script payload | An installer runs on your machine |
    | A network, UNC, relative or `..` path in `dir=` / `path=` | Just asking Windows whether `\\host\share` exists sends your credentials to that host. A local suggestion only opens the folder picker there: **you** choose the folder |
    | `key` / `passphrase` on `repo/connect`, `repo/sync`, `catalog/follow`, `catalog/import` | A link cannot bind or unlock a signing key; that happens in Settings → Identity & API |
    | `full=1` on `recorder/set` (and on `telemetry/*`) | Unmasked recording is switched on in Settings → Privacy or not at all |

    The app's own callers — a **scheduled task** you saved and the **local API** (which needs
    the token) — go through the same handler without the dialog, so an unattended task is not
    left waiting. The hard limits above still apply to them, except that a scheduled
    `data/export-auto` writes the full backup to the folder its task names, and a scheduled
    `replay/export` keeps its `path`.

    Left without a dialog on purpose, because they only open a screen or read: `plugin/compare`,
    `view/open`, `docs/open`, `theme/editor`, `repo/gen`, `repo/update`, `repo/host`,
    `repo/sync`, `mod/update`, `mod/check-updates`, `benchmark/open`, and `catalog/*/install`
    without a `url`. `telemetry/*`, `schedule/*`, `hook`, `catalog/*/add-source`,
    `catalog/delete`, `repo/fetch-ssh` and `install` keep their own dialog.

### Mods, profiles, modpacks

| Deeplink | Params | Does |
|---|---|---|
| `bmm://mod/enable` | `id`* | Enables a mod in the active profile |
| `bmm://mod/disable` | `id`* | Disables it |
| `bmm://profile/activate` | `id`* (profile UUID) | Switches the active profile |
| `bmm://modpack/enable` | `id`* | Enables every mod in a modpack — `id` accepts a **modpack or a profile** id |
| `bmm://modpack/disable` | `id`* | The inverse |
| `bmm://modpack/create` | `name`*, `profile` | Creates a modpack from a profile's active mods |
| `bmm://install` | `url`*, `name` | Downloads a mod and opens the install dialog (pick or create the target profile) |

### Plugins

| Deeplink | Params | Does |
|---|---|---|
| `bmm://plugin/activate` | `id`* | Applies the plugin's modlist (and disables the rest if `strict`) |
| `bmm://plugin/compare` | `id`* | Opens the modlist-vs-active comparison |
| `bmm://plugin/delete` | `id`* | Uninstalls it — registry, permissions and files. Asks first, naming the plugin |

### Server repo & updates

| Deeplink | Params | Does |
|---|---|---|
| `bmm://repo/connect` | `url`*, `name`, `password` | Asks first, and applies nothing — password included — before the answer. Registers a remote repo (the parent folder is enough). `password` is a protected repo's download password, sent as `X-Repo-Password` when the name is read from `repo.json` — without it a protected repo connected under a name that was just its URL. |
| `bmm://repo/sync` | `url`*, `profile`*, `game_dir`, `mods_dir`, `backup_dir`, `local_profile`, `password` | Opens sync pre-filled and starts the fetch. `password` is sent as `X-Repo-Password` |
| `bmm://repo/gen` | — | Opens the Generation section |
| `bmm://repo/update` | `dir` | Opens Update, pre-filled |
| `bmm://repo/host` | `dir`, `port` | Opens Hosting, pre-filled |
| `bmm://mod/check-updates` | — | Runs the update check |
| `bmm://mod/update` | `url` | Pre-fills the connection, or runs the check if omitted |

### Apps, themes, language

| Deeplink | Params | Does |
|---|---|---|
| `bmm://app/install` | `id`*, `url`*, `sha256`*, `title`, `type`, `path` | Asks, then downloads and installs an app. `https` only, `sha256` required and checked, `type` is `exe` · `msi` · `zip` (never a script). `path` only suggests where the folder picker opens |
| `bmm://app/launch` | `id`* | Asks, then launches the app BMM registered under that id. **`exe` is no longer accepted** — a link carrying it is refused — and a registered script is not started from a link |
| `bmm://theme/apply` | `id`* | Activates an installed theme |
| `bmm://theme/import` | `url`* | Downloads and installs a `.bmmtheme.json` |
| `bmm://theme/editor` | — | Opens the theme editor |
| `bmm://language/import` | `path` | Imports a translation `.json` (picker if omitted) |

### Automation, privacy, misc

| Deeplink | Params | Does |
|---|---|---|
| `bmm://schedule/run` | `id`*, `k` | Runs a scheduled task — the hook the Windows Scheduler uses. **Asks first**, unless `k` is this machine's OS-schedule key |
| `bmm://schedule/enable` | `id`*, `on` | Arms (`on=1`, the default) or disarms (`on=0`) a saved task. Asks first |
| `bmm://catalog/follow` | `type`*, `url`*, `password`, `key` | Follow a catalogue — one of the eight: `plugin`, `theme`, `preset`, `modpack`, `repo`, `tutorial`, `list`, `app`. **Not `index`** — an index is a catalogue of catalogues with no store of its own, and this route answers “no catalogue type called index”; `bmm://catalog/import` is the one that reads it. A `password` is remembered for this run only, never written to disk; `key` names WHICH identity key signs the request — an id or a name. Ids live in Settings → Identity & API, are shown next to each key, and survive a rename; a reference that is not on the ring is reported rather than skipped, because a request that quietly goes out unsigned comes back as “could not read it” with nothing pointing at the key |
| `bmm://catalog/unfollow` | `type`*, `url`* | Stop following it |
| `bmm://catalog/import` | `url`*, `type`, `password` | Reads the document at that address and follows it **without being told what kind it is**. Whoever has a link usually does not know which of the eight it is; the document does. `type` narrows an index to one kind |
| `bmm://catalog/entry` | `type`, `mode` (`add` · `update` · `delete`), `id`, `fields` (JSON) | Writes one entry of the catalogue **you author on this machine**. Invalid JSON in `fields` is refused rather than stored as the string it is |
| `bmm://catalog/delete` | `type` | Throws away the authored catalogue of that kind. **Asks first** — and does not touch what you FOLLOW |
| `bmm://repo/publish-ssh` | `dir`* | Asks, then opens the folder picker at `dir`; the folder **you** pick is uploaded to the SSH server already saved in the app. Carries no host and no key path: a link able to name those could point a publish at a server the user never chose |
| `bmm://repo/fetch-ssh` | `dir` | The same, for fetching |
| `bmm://hook` | `name`*, `data` | Rings a hook a task may be waiting on. `data` is parsed as JSON, or passed as text. Asks first |
| `bmm://launchpack/run` | `id`* | Runs a Launch Pack. Asks first, naming the pack and its programs |
| `bmm://benchmark/run` | `dataset`, `size`, `mb`, `mode`, `sources`, `profiles`, `folders` | Opens the benchmark pre-configured. **Auto-runs unless `mode=manual`** |
| `bmm://telemetry/consent` | `enabled`* | Global telemetry consent; declining also purges the local queue. From a link it only asks: BMM's consent screen opens and nothing changes unless you accept |
| `bmm://telemetry/set` | `replay`, `full`, `bench` | Sub-options, confirmed in-app before they apply. `full` means **unmasked**; `full=1` is refused from a link (Settings → Privacy only) |
| `bmm://recorder/set` | `on`, `full`, `rust`, `js` | Configures the local session recorder, after asking. `full=1` (unmasked) is dropped from every link |
| `bmm://replay/export` | `path` | Exports the session as `.bmmreplay`. From outside it asks and the save dialog always opens; `path` is honoured for a scheduled task or the local API only |
| `bmm://replay/import` | `path`, `url` | Imports and plays a `.bmmreplay` |
| `bmm://discord/rpc` | `enabled`* | Discord Rich Presence. Asks first — turning it on shows your profile name and Creator ID to anyone who sees your status |

!!! warning "Why three of these ask, and one of them sometimes does not"

    A `bmm://` link can be written by any page you click. Task ids are minted as
    `sched-<millisecond timestamp>`, so they are guessable in a way a random id is not
    — and running somebody's task is executing whatever they wrote in it, up to a
    script step. So `schedule/run`, `schedule/enable` and `hook` all ask, and the question
    names the task and says whether it is allowed to run programs.

    That would have left every OS-scheduled task waiting for a click at 3am, because the
    Windows Scheduled Task mirror launches this exact link. It carries `k=`, a key minted on
    your machine and kept in settings — never shown, never sent anywhere, and
    deliberately **not** the API token, since resetting that one is an ordinary thing to do and
    would quietly turn every registered task into a prompt.

| `bmm://data/export-auto` | `dir`*, `name`, `increment` | `data.json` backup. **From a link it asks, you pick the folder (the picker opens at `dir`), and tokens, keys and passwords are redacted from the copy**; the full unattended backup is written only for a scheduled task or `POST /api/data/export-auto`. `name` takes `{date}` `{time}` `{datetime}`; `increment` ∈ `paren` `underscore` `timestamp` `overwrite` |
| `bmm://settings/layout` | `code`* | Applies a shared card layout |
| `bmm://docs/open` | `article` | Opens Help & Other, optionally at an article id |
| `bmm://restart` | — | Restarts the app |

### Also works — previously undocumented

Handled by the router but missing from the in-app list. They are real and supported; several are
what the BetterCommunity website generates.

| Deeplink | Params | Does |
|---|---|---|
| `bmm://catalog/app/install` | `url`, `name`, `type`, `sha256` | Install from a catalog feed (no `url` → opens Apps). Same rules as `app/install`: asks, `https`, `sha256` required |
| `bmm://catalog/plugin/install` | `url`, `name`, `sha256` | Same, for a plugin: asks, `https` only, `sha256` checked when given. The plugin is installed **disabled, with no permissions** |
| `bmm://catalog/theme/install` | `url`, `name` | Same, for a theme (validated as JSON first) |
| `bmm://catalog/app/add-source` | `url`* | Subscribes to a community app catalog (asks first) |
| `bmm://catalog/plugin/add-source` | `url`* | Subscribes to a plugin catalog |
| `bmm://catalog/theme/add-source` | `url`* | Subscribes to a theme catalog |
| `bmm://language/import-inline` | `data`* (base64url), `code`, `gz` | A whole translation carried in the link; `gz=1` for gzipped |
| `bmm://theme/import-inline` | `data`* (base64 JSON) | Installs **and activates** a theme from the link |
| `bmm://settings/navbar` | `code`* | Applies a shared navbar layout |
| `bmm://benchmark/open` | as `benchmark/run` | Same handler, **inverted default** — only auto-runs when `mode=auto` |
| `bmm://import` · `bmm://download` | `url`*, `name` | Aliases of `bmm://install` |

**Undocumented aliases on documented schemes:** `telemetry/consent` and `telemetry/set` accept
`consent` for `enabled` and `replayFull` for `full`; `benchmark/run` also reads `folders`, and
splits lists on `;` **or** `|`.

### Which ones ask first

From outside, every link that changes something asks — see the box at the top of this section
for the full rule, what is refused outright and the routes deliberately left without a dialog.
`repo/connect` and `bmm://api` (any method, `GET` included) now ask through that same dialog.

---

## The `bmm://api` passthrough

Any endpoint without a dedicated deeplink is still reachable:

```
bmm://api?method=POST&path=/api/mods/enable&mod_id=my-mod
```

- `method` defaults to `GET`; `path` is **required and must start with `/api/`**.
- Every other parameter becomes the payload: a query string for `GET`/`DELETE`, a **JSON body**
  otherwise, with `"true"` / `"false"` / integers coerced to real types.
- The **admin token is attached automatically**, so a passthrough link runs with full rights.
- Any non-`GET` method **asks for confirmation** first.

!!! warning "Two hard limits"

    **It cannot express nested data.** Parameters are flat, so endpoints taking an array or object
    — `choices`, `mod_overrides`, `permissions`, `updateSources`, `addProfiles` — need a real HTTP
    client.

    **It never gives you the response body.** You get a success/status toast and nothing else, so
    it is useless for reading data back. Use the HTTP API for that.

---

## Endpoints

**Auth** — `—` = no token · `token` = any valid token · a permission name = that grant is required
(the admin token bypasses it). **DL** = has a dedicated deeplink; everything else goes through
`bmm://api`.

### The response envelope

Every endpoint that returns a **list** wraps it:

```json
{ "ok": true, "data": [ … ] }
```

So it is `body.data`, not `body.mods` / `body.profiles` / `body.modpacks`. This applies to
`/api/mods`, `/api/mods/active`, `/api/profiles`, `/api/plugins`, `/api/modpacks` and
`/api/repo/list`.

Two shapes sit outside that rule:

| Endpoint | Shape |
|---|---|
| `/api/mods/all` | `{ ok, profiles: […], total_mods }` — grouped, so the array is named |
| `/api/health`, `/api/status`, `/api/creator-id` | flat objects; no `data`, no wrapper |

!!! warning "Do not guess this from the field names"

    A client that reads `body.profiles` from `/api/profiles` gets `undefined` and then fails on
    the next line, usually with something unrelated-looking like *"x.filter is not a function"*.
    It is worth writing the unwrap once — and worth testing it against the **real** app rather
    than a stub, because a stub built from the same wrong guess will happily confirm it.

### Reading

| Method | Path | Auth | Returns |
|---|---|---|---|
| `GET` | `/api/health` | — | `{ok, service, port}` — the liveness probe, and how to learn the real port |
| `GET` | `/api/status` | — | Which BMM this is — `version`, `channel` (`Release` / `PTB` / `FTB`), `built` (the date the binary was made), `os`, `arch` — plus the active profile and the mod/profile/plugin counts. `1.0.0` is three different binaries, and a report that cannot tell them apart sends somebody chasing a fixed bug. |
| `GET` | `/api/check-update` | — | Latest GitHub release vs current: `has_update`, `release_url` |
| `GET` | `/api/mods` | `mods.read` | Visible mods of the active profile |
| `GET` | `/api/mods/active` | `mods.read` | Only the enabled ones |
| `GET` | `/api/mods/all` | `mods.read` | Every mod of **every** profile, grouped, plus `total_mods` |
| `GET` | `/api/profiles` | `profiles.read` | All profiles with their mod lists |
| `GET` | `/api/plugins` | `plugins.read` | Installed plugins (manifest + `enabled`) |
| `GET` | `/api/modpacks` | `modpacks.read` | All saved modpacks |
| `GET` | `/api/creator-id` | — | This install's creator id (used when exporting plugins) |
| `GET` | `/api/repo/info` | `repo.read` | Fetches a remote `repo.json`. Query `url`*, `password`. `401` if protected, `502` if the remote fails. **`extras` is part of it** — reading what a repo carries besides mods needs no separate endpoint |
| `GET` | `/api/repo/list` | `repo.read` | Registered remote repos |
| `GET` | `/api/language/template` | — | `lang-template.json`, a flat `{"key": "English"}` map |
| `GET` | `/api/data` | `data.read` | **Full `data.json` dump** — profiles, mods, modpacks, plugins, settings, tags |
| `GET` | `/api/apps` | `app.read` | Apps installed through the catalog |
| `GET` | `/api/apps/permissions` | admin token | `plugin_id → [permissions]` |
| `GET` | `/api/apps/permissions/:id` | admin token | One plugin's permissions |
| `GET` | `/api/catalog` | `catalog.read` | The local app catalog |

!!! danger "`GET /api/data` is the whole database"

    It returns everything, `settings` included — and `settings` holds `api_token` and
    `plugin_tokens`. Any token that can call it can read the admin token and mint itself full
    access. Treat granting it as equivalent to handing over admin rights.

### Mods & profiles

| Method | Path | Auth | Body | DL |
|---|---|---|---|---|
| `POST` | `/api/mods/enable` | `mods.write` | `mod_id`* | ✓ |
| `POST` | `/api/mods/disable` | `mods.write` | `mod_id`* | ✓ |
| `GET` | `/api/mods/order` | `mods.read` | — · the deployment order plus every contested file and who wins it | |
| `GET` | `/api/schedules` | `schedules.read` | — · a summary of every saved task: id, name, whether it is on, its trigger. **Not** its steps | |
| `POST` | `/api/schedules/enabled` | `schedules.write` | `id`*, `enabled`* · arm or disarm one task. Only `enabled` can be changed — a route that could write a whole task could install one with a script step in it | |
| `POST` | `/api/hook` | `hooks.write` | `name`*, `data` · ring a named doorbell a task may be waiting on with `wait.hook`, or be triggered by with `on event` | |
| `GET` | `/api/hook` | `hooks.read` | — · every name that has rung this session, with how many times — for the screen that asks “is my webhook actually arriving?” | |
| `GET` | `/api/hook/:name` | `hooks.read` | `?since=<ms>` · the rings themselves, with their payloads and timestamps — the same view a waiting task gets, so “it never fired” and “it fired the wrong body” stop looking alike. Reading does not consume: two tasks can wait on one doorbell | |
| `DELETE` | `/api/hook` | `hooks.write` | — · forget every ring. Answers how many were dropped | |
| `DELETE` | `/api/hook/:name` | `hooks.write` | — · forget one name | |
| `POST` | `/api/content-id` | token | `kind`*, `doc`* · the id that says what a document IS rather than what this machine calls it. Takes the document, so it discloses nothing this install holds — which is why it is token-level and not behind a per-kind read scope |
| `POST` | `/api/mods/order` | `mods.write` | `order[]`*, `profileId` · must be the same set of mods that are active; re-copies the files that change hands | |
| `PUT` | `/api/mods/:id` | `mods.write` | `name`, `version`, `author`, `description`, `tags[]`, `install_notes` | |
| `DELETE` | `/api/mods/:id` | `mods.write` | — · removes the entry, **keeps the files** | |
| `POST` | `/api/mod/config` | `mods.write` | `modId`*, `repoModId`, `updateUrl`, `directUrl`, `updateSources[]` · links a mod to the repos that can update it | |
| `POST` | `/api/profiles` | `profiles.write` | `name`*, `game_path`*, `mods_path`*, `backup_path`*, `game_name`, `color`, `icon` · **not** activated | |
| `POST` | `/api/profiles/activate` | `profiles.write` | `profile_id`* | ✓ |
| `PUT` | `/api/profiles/:id` | `profiles.write` | `name`, `color`, `icon`, `game_path`, `mods_path`, `backup_path` | |
| `DELETE` | `/api/profiles/:id` | `profiles.write` | — · refuses the active profile | |

### Modpacks & plugins

| Method | Path | Auth | Body | DL |
|---|---|---|---|---|
| `POST` | `/api/modpacks/create` | `modpacks.write` | `name`*, `mod_ids[]`, `source_profile_id`, `description`, `game_name`, `sr_link`, `multi_profile`, `skip_integrity_check`, `dependency_mode`, `mod_overrides[]` → `201` | ✓ |
| `POST` | `/api/modpacks/enable` | `modpacks.write` | `modpack_id`* (legacy `profile_id` also accepted) | ✓ |
| `POST` | `/api/modpacks/disable` | `modpacks.write` | idem | ✓ |
| `PUT` | `/api/modpacks/:id` | `modpacks.write` | any of the create fields | |
| `DELETE` | `/api/modpacks/:id` | `modpacks.write` | — · irreversible, local mods kept | |
| `POST` | `/api/plugins/compare` | `plugins.read` | `plugin_id`* → `missing_required`, `strict_extra` | ✓ |
| `POST` | `/api/plugins/apply` | `plugins.write` | `plugin_id`*, `force_strict` → `enabled`, `not_found` | ✓ |
| `DELETE` | `/api/plugins/:id` | `plugins.write` | — · registry + permissions + files | ✓ |

### Server repo

| Method | Path | Auth | Body | DL |
|---|---|---|---|---|
| `POST` | `/api/repo/connect` | `repo.write` | `url`*, `name` | ✓ |
| `DELETE` | `/api/repo` | `repo.write` | `url`* · files kept | |
| `POST` | `/api/repo/update-now` | `repo.write` | `repoDir`*, `authorName`, `ops` · **rewrites the repo** and re-signs its manifest, rather than opening the update modal. Every op is optional — a body naming none re-signs and changes nothing else, which is what you want after touching files under the folder by hand. Pending extras go in at the end → `202` | |
| `POST` | `/api/repo/host-now` | `repo.write` | `path`*, `port`*, `uploadLimit`, `downloadPassword`, `authorizedKeys[]` · **starts serving**. `/api/repo/host` only opens the screen while its sibling `/api/repo/host-stop` really stops the server — this is the working half. It also carries a download password and allowed public keys, which the old one could not express: hosting a PROTECTED repo was not reachable over the API at all → `202` | |
| `POST` | `/api/repo/gen-now` | `repo.write` | `outputDir`*, `authorName`*, `profileIds[]`*, `seed`, `zipOutput`, `zipMods`, `compression` (`deflate` default / `zstd` / `bzip2` / `stored`; anything else → `400`) · **writes the repo**, rather than opening the hosting screen. An empty `profileIds` is REFUSED, never read as “all of them”; a profile named and since deleted stops the call rather than being skipped. Pending extras go in at the end → `202` | |
| `POST` | `/api/repo/sync-now` | `repo.write` | `url`*, `repoProfile`*, `targetProfile`*, `gameDir`*, `modsDir`*, `backupDir`, `password`, `overwriteAll`, `deleteExtra` · **runs the sync**, rather than filling the form in and waiting for somebody to press Sync. Every required field is refused before anything starts, because each missing one is a way to sync into somewhere nobody chose. Creating a local profile is deliberately not offered — a caller able to mint one per call fills the list with them. The two destructive options default OFF → `202` | |
| `POST` | `/api/repo/sync` | `repo.write` | `url`*, `choices[]`*, `gameDir`, `modsDir`, `backupDir`, `password`, `overwriteAll`, `deleteExtra`, `downloadLimit` → `202 {job_id}`. **One at a time** (`409`). `creatorId` is **no longer accepted**: it is who BMM says it is to a repo — the value a whitelist and a ban list are keyed on — so a caller able to supply it could present somebody else's identity to a server that decides access by it. This installation's own id is sent | ✓ |
| `DELETE` | `/api/repo/sync/cancel` | `repo.write` | — · stops at the next mod boundary | |
| `POST` | `/api/repo/gen` | `repo.write` | `profileIds[]`*, `outputDir`*, `authorName`*, `seed`, `generateServer`, `port`, `uploadLimit`, `adminPassword`, `useCloudflare`, `useUpnp`, `autoStart`, `lang`, `serverVersion` (number), `serverType` (`std`/`lux`), `lightweight`, `zipOutput`, `zipMods`, `compression` (`deflate` default / `zstd` / `bzip2` / `stored`; anything else → `400`), `useDocker`, `dockerOs` → `202` | ✓ |
| `DELETE` | `/api/repo/gen/cancel` | `repo.write` | — | |
| `POST` | `/api/repo/update` | `repo.write` | `repoDir`*, `authorName`, `removeModIds[]`, `removeProfileIds[]`, `addProfiles[]`, `modChangelogs{}` → `202` | ✓ |
| `POST` | `/api/repo/host` | `repo.write` | `serveDir`*, `port`, `uploadLimit` → `202`, `409` if already serving | ✓ |
| `DELETE` | `/api/repo/host` | `repo.write` | — | |
| `POST` | `/api/repo/manifest` | `repo.write` | `dir`*, `authorName` · writes `repo.json` for a folder that is ALREADY hosted. Needs no profile and copies nothing — it reads the directory, writes one file, and returns the diff. Synchronous, so a publish script can act on the result | |
| `POST` | `/api/repo/publish-ssh` | `repo.write` | `dir`* · uploads over SSH **using the connection already saved in the app**. The host, the user and the key are deliberately NOT parameters: a caller able to name them could make BMM read a private key of its choosing and ship a repo to a machine of its choosing. Driven through the UI, so the upload is visible and cancellable → `202` | |
| `POST` | `/api/repo/fetch-ssh` | `repo.write` | `dir`* · the same rule, and it matters more in this direction: publishing writes to a server the owner chose, fetching writes to the owner's own disk. Only the destination is a parameter, and the backend refuses any remote path that would escape it → `202` | |
| `POST` | `/api/repo/extras` | `repo.write` | `url`*, `kind`*, `id`*, `password` · takes ONE thing a repo carries besides mods. `creatorId` is not accepted here either, for the same reason as `/api/repo/sync`. The entry is looked up in the manifest BMM fetches — a caller cannot describe its own `{kind, url, sha256}`, because that would be using BMM's installer to install arbitrary files and the hash check would be checking the caller's own number. A plugin or automation arrives **disabled**; a catalogue is followed; a mod list is saved and its path returned | |
| `GET` | `/api/repo/modpacks` | `repo.read` | `dir`* · which modpacks a repo FOLDER on this machine shares, with each one's share mode |
| `POST` | `/api/repo/modpacks` | `repo.write` | `dir`*, `shares[]`* · set the whole list and re-sign the manifest. Omitting `shares` is a read, not "share none" — those are different requests, and folding them together would make an empty POST un-publish everything |
| `GET` | `/api/plugins/assets` | `plugins.read` | Query `id`* · the files a plugin ships in `assets/`. Add `path` and it returns that file's TEXT instead of the list. Reads the folder, not the manifest. Text kinds only — an image is refused by kind rather than returned as noise, and nothing is executed |
| `GET` | `/api/catalogs` | `catalog.read` | — · what BMM follows, by type, plus `written_at`. A MIRROR the interface pushes: no `written_at` means the app has not run since this existed, which is not the same fact as following nothing |
| `POST` | `/api/catalogs` | `catalog.write` | `type`*, `url`*, `follow` (default true), `password`, `key` → `202`. `key` names WHICH identity key signs the request — an id or a name. Ids live in Settings → Identity & API, are shown next to each key, and survive a rename; a reference that is not on the ring is reported rather than skipped, because a request that quietly goes out unsigned comes back as “could not read it” with nothing pointing at the key. Driven through the app's own screens, so the reply means "the app was told", not "the list now says this" — and the source lands in the following list with an origin, removable like any other |
| `GET` | `/api/keys` | `keys.read` | — · names and paths only. There is no endpoint that reads a private key | |
| `POST` | `/api/keys` | `keys.write` | `name`*, `kind` (`ed25519` default · `ecdsa` · `rsa`) → `201 {path, public, ring}`. The response carries the **public** line and where the private half went — never the private half itself, because replies are logged by callers, proxied and read in browser tabs. A name already on the ring is refused rather than overwritten | |
| `POST` | `/api/mod/check-updates` | `mods.write` | — → `202` | ✓ |
| `POST` | `/api/mod/update` | `mods.write` | `repoUrl` → `202` | ✓ |

### Apps & catalog

| Method | Path | Auth | Body | DL |
|---|---|---|---|---|
| `POST` | `/api/apps/install` | `app.write` | `appId`*, `appTitle`*, `downloadUrl`*, `fileType`*, `installPath`, `version`, `category`, `thumb` → `202` | ✓ |
| `POST` | `/api/apps/launch` | `app.write` | `appId`*, `exePath`* | ✓ |
| `DELETE` | `/api/apps/:id` | `app.write` | — · deregisters, files kept | |
| `PUT` | `/api/apps/permissions/:id` | admin token | `permissions[]`* · **replaces** the list; `[]` revokes everything | |
| `POST` | `/api/catalog/publish` | `catalog.write` | `dir`*, `kind`, `name`, `base` → `202` · builds a catalogue FOLDER from what this BMM holds — tutorials, themes, plugins, modpacks, scheduled tasks, or an `index` of the catalogues you follow. Different job from `/api/catalog/new`, which files entries you assembled. Writing nothing is reported as a warning: a catalogue with no entries looks published and installs nothing | |
| `POST` | `/api/catalog/new` | `catalog.write` | `type` (`app` · `plugin` · `theme` · `preset` · `modpack` · `repo` · `tutorial` · `list` · `index`, default `app`), `name`, `description`, `partner_catalogs[]`, `community_imports[]`, `entries[]` (or `apps[]`, still accepted for `app`) → `201` | |
| `POST` | `/api/catalog/apps` | `catalog.write` | `id`*, `title`*, `download`* `{url, file_type}`, `description`, `category`, `price`, `tags` (≤3), `requirements`, `md_link` → `201` | |
| `PUT` | `/api/catalog/apps/:id` | `catalog.write` | `title`, `description`, `version`, `category`, `download` | |
| `DELETE` | `/api/catalog/apps/:id` | `catalog.write` | — | |
| `POST` | `/api/catalog/import` | `catalog.write` | `url`*, `type`, `password` → `202`. Reads the document and decides: an index follows every kind it lists (or just `type`), a single catalogue is matched against the eight shapes. One that fits none is refused rather than guessed at | ✓ |
| `POST` | `/api/catalog/entries` | `catalog.write` | `type` (`app` · `plugin` · `theme` · `preset` · `modpack` · `repo` · `tutorial` · `list` · `index`, default `app`), `entry`* → `201`. Written under the array name that kind's format uses. The entry must carry an `id` — update and delete both match on it, so one without would be added into a dead end | |
| `PUT` | `/api/catalog/entries/:id` | `catalog.write` | `type`, plus the fields to merge. `type` says which catalogue to open and is never written into the entry | |
| `DELETE` | `/api/catalog/entries/:id` | `catalog.write` | Query `type` · `404` when there is no such entry, rather than reporting a removal that did not happen | |
| `DELETE` | `/api/catalog` | `catalog.write` | Query `type` · throws away the whole authored catalogue for that kind. `404` when there never was one. Does NOT touch what you FOLLOW — that is `/api/catalogs` | |

### Import / export — these drive the UI

Each opens the matching in-app flow and returns `202`. They are **not** headless; the one exception
is `data/export-auto`.

| Method | Path | Auth | Body | DL |
|---|---|---|---|---|
| `POST` | `/api/data/export` · `/api/data/import` | token | — | |
| `POST` | `/api/data/export-auto` | `data.read` | `dir`*, `name`, `increment` · **unattended**, no dialog | ✓ |
| `POST` | `/api/modlists/export` · `/api/modlists/import` | token | — · `.mm`, metadata only, no mod files | |
| `POST` | `/api/modpacks/import` | `modpacks.write` | `path` | |
| `POST` | `/api/modpacks/export` | `modpacks.read` | `id`*, `destDir` · naming a `destDir` also needs `modpacks.write`: no dialog opens, so nobody is asked where the file lands | |
| `POST` | `/api/plugins/import` | `plugins.write` | — | |
| `POST` | `/api/plugins/export` | `plugins.read` | `id`*, `destDir` → `.bmmplug` · same rule: a caller-chosen `destDir` needs `plugins.write` | |
| `POST` | `/api/language/import` | `system.write` | `path` · the filename becomes the language code; `template.json` is refused | ✓ |
| `POST` | `/api/profiles/import/ovgme` | `profiles.write` | — · scans `%PROGRAMDATA%/OvGME` | |
| `POST` | `/api/profiles/import/omm` | `profiles.write` | — · OpenModManager `.omm`/`.omx` | |

### Automation & privacy

| Method | Path | Auth | Body | DL |
|---|---|---|---|---|
| `POST` | `/api/schedule/run` | `schedules.write` | `id`* | ✓ |
| `POST` | `/api/launchpack/run` | `app.write` | `id`* | ✓ |
| `POST` | `/api/benchmark` | `system.write` | `dataset`, `size`, `mode`, `sources[]`, `profiles[]` | ✓ |
| `POST` | `/api/telemetry/consent` | `telemetry.write` | `enabled`* | ✓ |
| `POST` | `/api/telemetry/settings` | `telemetry.write` | `replay`, `full`, `bench` | ✓ |
| `POST` | `/api/recorder` | `telemetry.write` | `on`, `full`, `rust`, `js` | ✓ |
| `POST` | `/api/replay/export` | `replay.read` | — | ✓ |
| `POST` | `/api/replay/import` | `replay.write` | `path`, `url` | ✓ |
| `POST` | `/api/discord/rpc` | `system.write` | `enabled`* | ✓ |
| `POST` | `/api/restart` | `system.write` | — · the API is briefly unavailable | ✓ |
| `POST` | `/api/view` | `system.write` | `id`* · show a screen. The id is the sidebar's own `data-view` value (`mapper`, `library`, …); an unknown one is a no-op that says so in the app console, exactly like the `bmm://view/open` deeplink | ✓ |

---

## Watching what calls in

Every `/api/` request emits a Tauri event carrying `{method, path, status}` — that is what produces
the in-app toasts and the API log on the *Plugins & API* page. UI-driven endpoints emit an
additional exec or rejected event. So you can watch external calls arrive without instrumenting
your own script.

---

## CORS, and who may read a failure

Successful responses go through the configured CORS policy: the Tauri webview's own origins,
`bettercommunity.ch`, and anything you add in **Settings → Identity & API**. Nothing else can read
one.

Failures used to be different. The rejection handler runs *after* the CORS filter in warp's chain,
so a recovered response carries no CORS headers of its own — and rather than leave the app unable to
read its own `401`s, it stamped `access-control-allow-origin: *` on every failure, in release too.

That is a token oracle. A page on any site can `fetch()` the local API: a wrong token gives a
READABLE `401`, and a right one gives a success the CORS filter refuses to expose, which the page
sees as a network error. Two outcomes, distinguishable, from a site the user merely visited.

Both paths now read one list. A rejection is stamped with the requesting origin when that origin is
allowed, with `Vary: Origin` beside it, and with nothing at all otherwise — so an unrecognised site
cannot read a `401` any more than it can read a `200`. A request with no `Origin` header (curl, the
CLI, a plugin script) gets no CORS header and never needed one.

---

## Fixed, and named so nobody goes looking

Six entries that used to be listed here are gone because the code changed: the permission gates
(every route that was listed now declares a scope, and the three `/api/apps/permissions*` routes
take the **admin** token, so a plugin token cannot reach them at all), the duplicated `serverVersion`
on `POST /api/repo/gen`, the wrong description of `POST /api/repo/host`, the missing `bmm://` badge
on `DELETE /api/plugins/:id`, `bmm://telemetry/settings`, which no longer appears anywhere, and the
CORS leak above.

Four of them are now held by a check rather than by a note — `check-endpoint-fields.mjs` compares
every quick-test field to the Rust body struct it claims to describe, `check-deeplink-panel.mjs`
compares the badge map to the routes and the actions, and `cors_origin_for` has four unit tests, one
of which is the lookalike host (`bettercommunity.ch.evil.example`) that a prefix match would let
through. A note goes stale in silence; a check does not.

---

## See also

- [MCP server reference](doc-page:reference/mcp) — the 69 tools an AI client can call, and which ones need BMM open
- [CLI reference](doc-page:reference/cli) — the same binary’s 62 subcommands, for a terminal or a `.bat`
- [Action reference](doc-page:reference/actions) — every scheduler and script-generator action
- [Plugins & API](doc-page:features/plugins) — the in-app browser, tokens and quick-test
- [Architecture](doc-page:how-it-works/architecture) — where this API sits in the app
