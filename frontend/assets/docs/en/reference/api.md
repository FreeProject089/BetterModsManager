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

`app.read` · `app.write` · `catalog.read` · `catalog.write` · `keys.write` · `modpacks.write` ·
`mods.write` · `plugins.read` · `plugins.write` · `profiles.write` · `repo.write`

!!! warning "`keys.write` is deliberately not part of `repo.write`"

    An identity key is what proves you are *you* to every protected source. "Can publish a
    repo" must not also mean "can mint the thing I sign with", so it is its own grant.

!!! note "Read endpoints are not permission-gated"

    There is no `mods.read` / `profiles.read`. Routes below marked *no token* are open to anything
    that can reach the port; routes marked *token* accept **any** valid token, including a plugin
    token with no permissions at all.

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

!!! warning "Three of them stop and ask — which matters most if you are scripting"

    The action deeplinks below (`mod/enable`, `profile/activate`, …) act immediately. Three do
    not, and open a confirmation dialog first:

    | Deeplink | Why |
    |---|---|
    | `bmm://api` with any method other than `GET` | It is a generic passthrough to the local API. In the code's own words: *"any website or app can trigger a `bmm://` link, so a bare click must not be able to silently mutate app state via a generic API passthrough."* |
    | `bmm://repo/connect` | Adding a source is a trust decision |
    | `bmm://language/import` | It writes a file into `Lang/` |

    Read it both ways. It is the reason a web page cannot quietly reconfigure BMM — and it is
    also why an **unattended** script must not route a write through `bmm://api`: it will sit
    on a dialog nobody is there to answer. For automation, use the direct action deeplinks
    above, or the HTTP API with a token, which does not prompt.

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
| `bmm://plugin/delete` | `id`* | Uninstalls it — registry, permissions and files |

### Server repo & updates

| Deeplink | Params | Does |
|---|---|---|
| `bmm://repo/connect` | `url`*, `name` | Registers a remote repo (the parent folder is enough) |
| `bmm://repo/sync` | `url`*, `profile`*, `game_dir`, `mods_dir`, `backup_dir`, `local_profile`, `password` | Opens sync pre-filled and starts the fetch. `password` is sent as `X-Repo-Password` |
| `bmm://repo/gen` | — | Opens the Generation section |
| `bmm://repo/update` | `dir` | Opens Update, pre-filled |
| `bmm://repo/host` | `dir`, `port` | Opens Hosting, pre-filled |
| `bmm://mod/check-updates` | — | Runs the update check |
| `bmm://mod/update` | `url` | Pre-fills the connection, or runs the check if omitted |

### Apps, themes, language

| Deeplink | Params | Does |
|---|---|---|
| `bmm://app/install` | `id`*, `url`*, `title`, `type`, `path` | Downloads and installs an app |
| `bmm://app/launch` | `id`*, `exe`* | Launches an installed app |
| `bmm://theme/apply` | `id`* | Activates an installed theme |
| `bmm://theme/import` | `url`* | Downloads and installs a `.bmmtheme.json` |
| `bmm://theme/editor` | — | Opens the theme editor |
| `bmm://language/import` | `path` | Imports a translation `.json` (picker if omitted) |

### Automation, privacy, misc

| Deeplink | Params | Does |
|---|---|---|
| `bmm://schedule/run` | `id`*, `k` | Runs a scheduled task — the hook the Windows Scheduler uses. **Asks first**, unless `k` is this machine's OS-schedule key |
| `bmm://schedule/enable` | `id`*, `on` | Arms (`on=1`, the default) or disarms (`on=0`) a saved task. Asks first |
| `bmm://catalog/follow` | `type`*, `url`* | Follow a catalogue — `plugin`, `theme`, `preset`, `modpack`, `repo`, `tutorial`, `list`, `app` |
| `bmm://catalog/unfollow` | `type`*, `url`* | Stop following it |
| `bmm://repo/publish-ssh` | `dir` | Opens the repo screen ready to publish over SSH. Carries no host and no key path — a link able to name those could point a publish at a server the user never chose |
| `bmm://repo/fetch-ssh` | `dir` | The same, for fetching |
| `bmm://hook` | `name`*, `data` | Rings a hook a task may be waiting on. `data` is parsed as JSON, or passed as text. Asks first |
| `bmm://launchpack/run` | `id`* | Runs a Launch Pack |
| `bmm://benchmark/run` | `dataset`, `size`, `mb`, `mode`, `sources`, `profiles`, `folders` | Opens the benchmark pre-configured. **Auto-runs unless `mode=manual`** |
| `bmm://telemetry/consent` | `enabled`* | Global telemetry consent; declining also purges the local queue |
| `bmm://telemetry/set` | `replay`, `full`, `bench` | Sub-options. `full` means **unmasked** |
| `bmm://recorder/set` | `on`, `full`, `rust`, `js` | Configures the local session recorder |
| `bmm://replay/export` | — | Exports the session as `.bmmreplay` |
| `bmm://replay/import` | `path`, `url` | Imports and plays a `.bmmreplay` |
| `bmm://discord/rpc` | `enabled`* | Discord Rich Presence |

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

| `bmm://data/export-auto` | `dir`*, `name`, `increment` | Unattended `data.json` backup. `name` takes `{date}` `{time}` `{datetime}`; `increment` ∈ `paren` `underscore` `timestamp` `overwrite` |
| `bmm://settings/layout` | `code`* | Applies a shared card layout |
| `bmm://docs/open` | `article` | Opens Help & Other, optionally at an article id |
| `bmm://restart` | — | Restarts the app |

### Also works — previously undocumented

Handled by the router but missing from the in-app list. They are real and supported; several are
what the BetterCommunity website generates.

| Deeplink | Params | Does |
|---|---|---|
| `bmm://catalog/app/install` | `url`, `name`, `type` | One-click install from a catalog feed (no `url` → opens Apps) |
| `bmm://catalog/plugin/install` | `url`, `name` | Same, for a plugin |
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

Safe to hand to a user, because they confirm before acting: `repo/connect`, `language/import` with
a bare `path`, every `catalog/*/add-source`, `bmm://api` for any non-GET method, and the
`install` / `import` / `download` flow. URL parameters on `repo/connect`, `repo/sync` and
`catalog/*/add-source` are rejected unless they are `http(s)`.

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
| `GET` | `/api/status` | — | App version, active profile, mod/profile/plugin counts |
| `GET` | `/api/check-update` | — | Latest GitHub release vs current: `has_update`, `release_url` |
| `GET` | `/api/mods` | — | Visible mods of the active profile |
| `GET` | `/api/mods/active` | — | Only the enabled ones |
| `GET` | `/api/mods/all` | — | Every mod of **every** profile, grouped, plus `total_mods` |
| `GET` | `/api/profiles` | — | All profiles with their mod lists |
| `GET` | `/api/plugins` | — | Installed plugins (manifest + `enabled`) |
| `GET` | `/api/modpacks` | — | All saved modpacks |
| `GET` | `/api/creator-id` | — | This install's creator id (used when exporting plugins) |
| `GET` | `/api/repo/info` | — | Fetches a remote `repo.json`. Query `url`*, `password`. `401` if protected, `502` if the remote fails. **`extras` is part of it** — reading what a repo carries besides mods needs no separate endpoint |
| `GET` | `/api/repo/list` | — | Registered remote repos |
| `GET` | `/api/language/template` | — | `lang-template.json`, a flat `{"key": "English"}` map |
| `GET` | `/api/data` | token | **Full `data.json` dump** — profiles, mods, modpacks, plugins, settings, tags |
| `GET` | `/api/apps` | `app.read` | Apps installed through the catalog |
| `GET` | `/api/apps/permissions` | token | `plugin_id → [permissions]` |
| `GET` | `/api/apps/permissions/:id` | token | One plugin's permissions |
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
| `GET` | `/api/schedules` | token | — · a summary of every saved task: id, name, whether it is on, its trigger. **Not** its steps | |
| `POST` | `/api/schedules/enabled` | token | `id`*, `enabled`* · arm or disarm one task. Only `enabled` can be changed — a route that could write a whole task could install one with a script step in it | |
| `POST` | `/api/hook` | token | `name`*, `data` · ring a named doorbell a task may be waiting on with `wait.hook`, or be triggered by with `on event` | |
| `GET` | `/api/hook` | token | `name` · what has rung, without consuming it — for the screen that asks “is my webhook actually arriving?” | |
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
| `DELETE` | `/api/plugins/:id` | token | — · registry + permissions + files | ✓ |

### Server repo

| Method | Path | Auth | Body | DL |
|---|---|---|---|---|
| `POST` | `/api/repo/connect` | `repo.write` | `url`*, `name` | ✓ |
| `DELETE` | `/api/repo` | `repo.write` | `url`* · files kept | |
| `POST` | `/api/repo/sync` | `repo.write` | `url`*, `choices[]`*, `gameDir`, `modsDir`, `backupDir`, `creatorId`, `password`, `overwriteAll`, `deleteExtra`, `downloadLimit` → `202 {job_id}`. **One at a time** (`409`) | ✓ |
| `DELETE` | `/api/repo/sync/cancel` | token | — · stops at the next mod boundary | |
| `POST` | `/api/repo/gen` | `repo.write` | `profileIds[]`*, `outputDir`*, `authorName`*, `seed`, `generateServer`, `port`, `uploadLimit`, `adminPassword`, `useCloudflare`, `useUpnp`, `autoStart`, `lang`, `serverVersion` (number), `serverType` (`std`/`lux`), `lightweight`, `zipOutput`, `useDocker`, `dockerOs` → `202` | ✓ |
| `DELETE` | `/api/repo/gen/cancel` | token | — | |
| `POST` | `/api/repo/update` | token | `repoDir`*, `authorName`, `removeModIds[]`, `removeProfileIds[]`, `addProfiles[]`, `modChangelogs{}` → `202` | ✓ |
| `POST` | `/api/repo/host` | token | `serveDir`*, `port`, `uploadLimit` → `202`, `409` if already serving | ✓ |
| `DELETE` | `/api/repo/host` | token | — | |
| `POST` | `/api/repo/manifest` | `repo.write` | `dir`*, `authorName` · writes `repo.json` for a folder that is ALREADY hosted. Needs no profile and copies nothing — it reads the directory, writes one file, and returns the diff. Synchronous, so a publish script can act on the result | |
| `POST` | `/api/repo/publish-ssh` | token | `dir`* · uploads over SSH **using the connection already saved in the app**. The host, the user and the key are deliberately NOT parameters: a caller able to name them could make BMM read a private key of its choosing and ship a repo to a machine of its choosing. Driven through the UI, so the upload is visible and cancellable → `202` | |
| `POST` | `/api/repo/fetch-ssh` | token | `dir`* · the same rule, and it matters more in this direction: publishing writes to a server the owner chose, fetching writes to the owner's own disk. Only the destination is a parameter, and the backend refuses any remote path that would escape it → `202` | |
| `POST` | `/api/repo/extras` | `repo.write` | `url`*, `kind`*, `id`*, `creatorId`, `password` · takes ONE thing a repo carries besides mods. The entry is looked up in the manifest BMM fetches — a caller cannot describe its own `{kind, url, sha256}`, because that would be using BMM's installer to install arbitrary files and the hash check would be checking the caller's own number. A plugin or automation arrives **disabled**; a catalogue is followed; a mod list is saved and its path returned | |
| `GET` | `/api/plugins/assets` | `plugins.read` | Query `id`* · the files a plugin ships in `assets/`. Add `path` and it returns that file's TEXT instead of the list. Reads the folder, not the manifest. Text kinds only — an image is refused by kind rather than returned as noise, and nothing is executed |
| `GET` | `/api/catalogs` | token | — · what BMM follows, by type, plus `written_at`. A MIRROR the interface pushes: no `written_at` means the app has not run since this existed, which is not the same fact as following nothing |
| `POST` | `/api/catalogs` | `catalog.write` | `type`*, `url`*, `follow` (default true) → `202`. Driven through the app's own screens, so the reply means "the app was told", not "the list now says this" — and the source lands in the following list with an origin, removable like any other |
| `GET` | `/api/keys` | `keys.write` | — · names and paths only. There is no endpoint that reads a private key | |
| `POST` | `/api/keys` | `keys.write` | `name`*, `kind` (`ed25519` default · `ecdsa` · `rsa`) → `201 {path, public, ring}`. The response carries the **public** line and where the private half went — never the private half itself, because replies are logged by callers, proxied and read in browser tabs. A name already on the ring is refused rather than overwritten | |
| `POST` | `/api/mod/check-updates` | token | — → `202` | ✓ |
| `POST` | `/api/mod/update` | token | `repoUrl` → `202` | ✓ |

### Apps & catalog

| Method | Path | Auth | Body | DL |
|---|---|---|---|---|
| `POST` | `/api/apps/install` | `app.write` | `appId`*, `appTitle`*, `downloadUrl`*, `fileType`*, `installPath`, `version`, `category`, `thumb` → `202` | ✓ |
| `POST` | `/api/apps/launch` | `app.write` | `appId`*, `exePath`* | ✓ |
| `DELETE` | `/api/apps/:id` | `app.write` | — · deregisters, files kept | |
| `PUT` | `/api/apps/permissions/:id` | token | `permissions[]`* · **replaces** the list; `[]` revokes everything | |
| `POST` | `/api/catalog/new` | `catalog.write` | `name`, `description`, `partner_catalogs[]`, `community_imports[]`, `apps[]` → `201` | |
| `POST` | `/api/catalog/apps` | `catalog.write` | `id`*, `title`*, `download`* `{url, file_type}`, `description`, `category`, `price`, `tags` (≤3), `requirements`, `md_link` → `201` | |
| `PUT` | `/api/catalog/apps/:id` | `catalog.write` | `title`, `description`, `version`, `category`, `download` | |
| `DELETE` | `/api/catalog/apps/:id` | `catalog.write` | — | |

### Import / export — these drive the UI

Each opens the matching in-app flow and returns `202`. They are **not** headless; the one exception
is `data/export-auto`.

| Method | Path | Auth | Body | DL |
|---|---|---|---|---|
| `POST` | `/api/data/export` · `/api/data/import` | token | — | |
| `POST` | `/api/data/export-auto` | token | `dir`*, `name`, `increment` · **unattended**, no dialog | ✓ |
| `POST` | `/api/modlists/export` · `/api/modlists/import` | token | — · `.mm`, metadata only, no mod files | |
| `POST` | `/api/modpacks/import` | token | `path` | |
| `POST` | `/api/modpacks/export` | token | `id`*, `destDir` | |
| `POST` | `/api/plugins/import` | token | — | |
| `POST` | `/api/plugins/export` | token | `id`* → `.bmmplug` | |
| `POST` | `/api/language/import` | token | `path` · the filename becomes the language code; `template.json` is refused | ✓ |
| `POST` | `/api/profiles/import/ovgme` | token | — · scans `%PROGRAMDATA%/OvGME` | |
| `POST` | `/api/profiles/import/omm` | token | — · OpenModManager `.omm`/`.omx` | |

### Automation & privacy

| Method | Path | Auth | Body | DL |
|---|---|---|---|---|
| `POST` | `/api/schedule/run` | token | `id`* | ✓ |
| `POST` | `/api/launchpack/run` | token | `id`* | ✓ |
| `POST` | `/api/benchmark` | token | `dataset`, `size`, `mode`, `sources[]`, `profiles[]` | ✓ |
| `POST` | `/api/telemetry/consent` | token | `enabled`* | ✓ |
| `POST` | `/api/telemetry/settings` | token | `replay`, `full`, `bench` | ✓ |
| `POST` | `/api/recorder` | token | `on`, `full`, `rust`, `js` | ✓ |
| `POST` | `/api/replay/export` | token | — | ✓ |
| `POST` | `/api/replay/import` | token | `path`, `url` | ✓ |
| `POST` | `/api/discord/rpc` | token | `enabled`* | ✓ |
| `POST` | `/api/restart` | token | — · the API is briefly unavailable | ✓ |
| `POST` | `/api/view` | token | `id`* · show a screen. The id is the sidebar's own `data-view` value (`mapper`, `library`, …); an unknown one is a no-op that says so in the app console, exactly like the `bmm://view/open` deeplink | ✓ |

---

## Watching what calls in

Every `/api/` request emits a Tauri event carrying `{method, path, status}` — that is what produces
the in-app toasts and the API log on the *Plugins & API* page. UI-driven endpoints emit an
additional exec or rejected event. So you can watch external calls arrive without instrumenting
your own script.

---

## Known inconsistencies

Recorded because the in-app registry and the server do not agree on every detail:

- **Permission gates are narrower than they look.** `mod/check-updates`, `mod/update`,
  `repo/update`, `repo/host` (both methods), both cancel routes, `DELETE /api/plugins/:id` and every
  `/api/apps/permissions*` route are **token-only** — a plugin token with zero permissions passes
  them.
- **`POST /api/repo/gen`**: the in-app list shows `serverVersion` twice with conflicting types. The
  server has `serverVersion` (number) **and** `serverType` (`"std"` / `"lux"`) — the string goes in
  `serverType`, a name the in-app list never mentions. `lightweight` is also accepted.
- **`POST /api/repo/host`** is described as starting a static file server; it actually drives the
  native Server Repo UI and returns `202`, not `200`.
- **`DELETE /api/plugins/:id`** has a working deeplink (`bmm://plugin/delete`) but is absent from the
  endpoint→deeplink map, so the in-app `bmm://` badge does not render for it.
- **`bmm://telemetry/settings`** appears in one description but is **not routed** — only
  `bmm://telemetry/set` works.
- Error responses re-add `access-control-allow-origin: *` unconditionally, even in release.

---

## See also

- [MCP server reference](doc-page:reference/mcp) — the 51 tools an AI client can call, and which ones need BMM open
- [Action reference](doc-page:reference/actions) — every scheduler and script-generator action
- [Plugins & API](doc-page:features/plugins) — the in-app browser, tokens and quick-test
- [Architecture](doc-page:how-it-works/architecture) — where this API sits in the app
