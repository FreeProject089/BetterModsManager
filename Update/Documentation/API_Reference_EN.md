# Better Mod Manager — API & Deeplink Reference

> Local HTTP API base URL: `http://127.0.0.1:51274`
> Auth: most endpoints require the header `Authorization: Bearer <API_TOKEN>` (token is shown in **Plugins & API → API Token**).
> Plugin scoping: a request may include `X-BMM-Plugin-Id: <id>`. When present, the call is checked against that plugin's granted permissions (see **Permissions**). Without the header, the call has full (admin) access.

This document is the single source of truth for everything that can be driven programmatically. The goal: **anything you can do in BMM by hand can be done through the API / deeplinks without human interaction** (where a native file dialog is normally required, an optional `path` / `destDir` field lets you skip it).

---

## Conventions

- **UI-driven** endpoints return `202 Accepted` and drive the BMM interface (they emit a `bmm://api-exec` event the frontend reacts to). They behave exactly as if a human triggered them. When a file/folder is needed, pass an explicit `path`/`destDir` to run fully unattended; omit it to open the native picker.
- **Direct** endpoints run synchronously and return `200 OK` with a JSON result.
- All bodies are JSON. Field names are `snake_case` unless noted; camelCase aliases are accepted on app/catalog endpoints.

---

## GET endpoints

| Path | Auth | Description | Returns |
|---|---|---|---|
| `/api/health` | no | Liveness probe | `{ ok, service, port }` |
| `/api/status` | no | Which build, active profile, counts | `{ ok, version, channel, built, os, arch, active_profile, mod_count, profile_count, plugin_count }` — `channel` is `Release`, `PTB` or `FTB`; `built` is the date the binary was made |
| `/api/check-update` | no | Compare running version to latest GitHub release | `{ ok, has_update, current_version, latest_version, release_url }` |
| `/api/mods` | no | All mods in the active profile | `{ ok, data:[{id,name,active,enabled,path}] }` |
| `/api/mods/active` | no | Only enabled mods of active profile | `{ ok, data:[…] }` |
| `/api/mods/all` | no | **Every mod across ALL profiles**, grouped by profile + total | `{ ok, total_mods, profiles:[{profile_id,profile_name,mod_count,mods:[…]}] }` |
| `/api/data` | yes | **Full BMM data export** (`data.json`) — profiles, mods, modpacks, plugins, settings… | JSON file (`bmm-data.json`) |
| `/api/modpacks` | no | All modpacks (full objects) | `{ ok, data:[{id,name,description,mods:[…],multi_profile,dependency_mode,…}] }` (mod count = `mods.length`) |
| `/api/profiles` | no | All profiles (summary, no mod list) | `{ ok, data:[{id,name,game,active}] }` |
| `/api/plugins` | no | Installed plugins | `{ ok, data:[…] }` |
| `/api/creator-id` | no | This user's creator ID (public key) | `{ ok, creator_id }` |
| `/api/repo/info?url=` | no | Metadata for a remote repo. Optional `&password=` for a password-protected self-hosted repo (sent as `X-Repo-Password`; wrong/missing → 401) | repo manifest summary |
| `/api/repo/list` | no | Connected repos | `{ ok, data:[{url,name,…}] }` |
| `/api/apps` | yes · `app.read` | Installed App-Catalog apps + usage stats | `{ installed:{ id:{…} } }` |
| `/api/catalog` | yes · `catalog.read` | Local `apps-catalog.json` | catalog object |
| `/api/language/template` | no | Download `lang-template.json` (all i18n keys → English defaults) | JSON file (`Content-Disposition: attachment`) |
| `/api/apps/permissions` | yes | Map of `plugin_id → [permissions]` | object |
| `/api/apps/permissions/:id` | yes | One plugin's permissions | `{ plugin_id, permissions:[…] }` |

---

## POST endpoints

### Mods
| Path | Auth | Body | Notes |
|---|---|---|---|
| `/api/mods/enable` | yes | `{ mod_id }` | Enables a mod in the active profile (resolves deps). |
| `/api/mods/disable` | yes | `{ mod_id }` | Disables a mod. |
| `/api/mods/order` | yes | — (GET) | The deployment order, every contested file, and who wins it. |
| `/api/mods/order` | yes | `{ order[], profileId? }` | Reorders the active mods and re-copies the files that change hands. `order` must be a permutation of what is active; last in the list wins a shared file. |
| `/api/schedules` | yes | — (GET) | id, name, enabled and trigger for every saved task. **Not** its steps. |
| `/api/schedules/enabled` | yes | `{ id, enabled }` | Arms or disarms one task. Only `enabled` is writable — a route that could write a whole task could install one with a script step in it. |
| `/api/hook` | yes | `{ name, data? }` | Rings a named doorbell a task can wait on (`wait.hook`) or be triggered by (`on event`). `GET ?name=` reads what has rung without consuming it. |
| `/api/content-id` | yes | `{ kind, doc }` — the id that says what a document IS rather than what this machine calls it. `kind` is one of modpack, plugin, task, profile, theme, launchpack, repo, app, modlist. It takes the DOCUMENT, so the answer discloses nothing this install holds; a by-id variant would be an oracle for "does this machine have X" and would need each kind's read scope. |
| `/api/keys` | yes | `{ name, algorithm? }` | GET lists identity keys, POST mints one. The private half never leaves the machine. |
| `/api/catalogs` | yes | `{ type, url, follow }` | GET lists followed catalogues, POST follows or unfollows one. |
| `/api/plugins/assets` | yes | — (GET `?id=&path=`) | What a plugin ships, or one file's text. Copying a file OUT is deliberately not offered. |
| `/api/repo/extras` | yes | `{ url, kind, name }` | Installs one extra a repo carries. The entry is looked up in the fetched manifest, never described by the caller. |
| `/api/repo/modpacks` | yes | `GET ?dir=` — which modpacks a repo folder on this machine shares. `POST { dir, shares[] }` sets the whole list and re-signs the manifest; omitting `shares` reads instead of writing, because "tell me" and "share none" are different requests. |
| `/api/repo/publish-ssh` | yes | `{ dir? }` | **Uploads now**, to the SSH server already saved in the app, and answers when the transfer is done. Carries no host and no key path — a caller able to name those could make BMM read a private key of its choosing and ship a repo to a machine of its choosing. A saved target needing a typed passphrase is refused: there is nobody to type it. |
| `/api/repo/fetch-ssh` | yes | `{ dir? }` | The same, for fetching. |
| `/api/view` | yes | `{ id }` | Switches the open app to a screen, as clicking the sidebar does. |

### Profiles
| Path | Auth | Body |
|---|---|---|
| `/api/profiles` | yes | `{ name, game_path, mods_path, backup_path, game_name?, color?, icon? }` |
| `/api/profiles/activate` | yes | `{ profile_id }` |
| `/api/profiles/import/ovgme` | yes | *(UI-driven, scans %PROGRAMDATA%/OvGME)* |
| `/api/profiles/import/omm` | yes | *(UI-driven, file picker — `.omm/.omx`)* |

### Plugins
| Path | Auth | Body |
|---|---|---|
| `/api/plugins/apply` | yes | `{ plugin_id, force_strict? }` |
| `/api/plugins/compare` | yes | `{ plugin_id }` |
| `/api/plugins/import` | yes | UI-driven — file picker (`.bmmplug`) |
| `/api/plugins/export` | yes | `{ id }` — UI-driven save dialog |

### Modpacks
| Path | Auth | Body |
|---|---|---|
| `/api/modpacks/create` | yes | `{ name, mod_ids?, source_profile_id?, description?, game_name?, sr_link?, multi_profile?, skip_integrity_check?, dependency_mode?, mod_overrides? }` |
| `/api/modpacks/enable` | yes | `{ modpack_id }` |
| `/api/modpacks/disable` | yes | `{ modpack_id }` |
| `/api/modpacks/import` | yes | `{ path? }` — path imports directly, else file picker |
| `/api/modpacks/export` | yes | `{ id, destDir? }` — `destDir` exports straight into that folder (no dialog) |

### Server Repo
| Path | Auth | Body |
|---|---|---|
| `/api/repo/connect` | yes | `{ url, name?, password? }` |
| `/api/repo/update-now` | yes | `{ repoDir, authorName?, ops? }` — **rewrites the repo** and re-signs its manifest instead of opening the modal. `ops` = `{ removeModIds[], removeProfileIds[], addProfiles[], modChangelogs{} }`, all optional |
| `/api/repo/host-now` | yes | `{ path, port, uploadLimit?, downloadPassword?, authorizedKeys[]? }` — **starts serving**. Also the only way to host a protected repo over the API |
| `/api/repo/gen-now` | yes | `{ outputDir, authorName, profileIds[], seed?, zipOutput?, zipMods? }` — **writes the repo** instead of opening the screen. An empty profile list is refused, never “all of them” |
| `/api/repo/sync-now` | yes | `{ url, repoProfile, targetProfile, gameDir, modsDir, backupDir?, password?, overwriteAll?, deleteExtra? }` — **runs the sync** instead of opening the form. All five first fields required; no profile is created; the two destructive options default off |
| `/api/repo/sync` | yes | `{ url, game_dir?, mods_dir?, backup_dir?, choices?, download_limit?, password? }` (UI-driven; `password` = optional download password for a protected repo). **`creator_id` is not accepted** — it is this installation's identity to a repo, not a caller's choice |
| `/api/repo/gen` | yes | `{ profileIds[], outputDir, authorName, … }` (UI-driven) |
| `/api/repo/update` | yes | `{ repoDir }` — opens the incremental-update modal pre-filled |
| `/api/repo/host` | yes | `{ serveDir, port?, uploadLimit? }` |

### App Catalog
| Path | Auth · Perm | Body |
|---|---|---|
| `/api/apps/install` | yes · `app.write` | `{ appId, appTitle, downloadUrl, fileType, installPath, version?, category?, thumb? }` — `installPath` is required; `fileType` ∈ `exe·zip·msi·script` |
| `/api/apps/launch` | yes · `app.write` | `{ appId, exePath }` |
| `/api/catalog/new` | yes · `catalog.write` | `{ name?, description?, partner_catalogs?, community_imports?, apps? }` |
| `/api/catalog/apps` | yes · `catalog.write` | `{ id, title, description?, category?, price?, tags?, download:{url,file_type,size?}, requirements?, md_link?, images?, official?, partner? }` |

### Data / Language / Mod lists
| Path | Auth | Body |
|---|---|---|
| `/api/data/export` | yes | UI-driven save dialog (all BMM data → JSON) |
| `/api/data/import` | yes | UI-driven file picker |
| `/api/modlists/export` | yes | UI-driven (`.mmlist`) |
| `/api/modlists/import` | yes | UI-driven file picker |
| `/api/language/import` | yes | `{ path? }` — path imports directly, else file picker; filename → language code |
| `/api/restart` | yes | `{}` — graceful restart |

### Benchmark
| Path | Auth | Body |
|---|---|---|
| `/api/benchmark` | yes | `{ dataset?: "sandbox"\|"real", size?: "S"\|"M"\|"L"\|"XL"\|"CUSTOM", mb?, mode?: "manual"\|"auto", sources?: string[] (folders, absolute or relative to BMM's working dir), profiles?: string[] (ids/names → their mods folder) }`. **auto** runs headless and returns the report; **manual** opens the benchmark UI pre-filled. Any `sources`/`profiles` ⇒ a "real" run. |

### Telemetry & local recorder
| Path | Auth | Body |
|---|---|---|
| `/api/telemetry/consent` | yes | `{ enabled: bool }` — toggle "Share anonymous usage data" |
| `/api/telemetry/settings` | yes | `{ replay?, full?, bench? }` — manage telemetry sub-options (omitted = unchanged) |
| `/api/recorder` | yes | `{ on?, full?, rust?, js? }` — configure the local Session recorder |
| `/api/replay/export` | yes | `{}` — export the current local session as a `.bmmreplay` file |
| `/api/replay/import` | yes | `{ path? , url? }` — import + replay a `.bmmreplay` (file path or download URL) |

### Automation
| Path | Auth | Body |
|---|---|---|
| `/api/mod/check-updates` | yes | `{}` — check every linked mod against its repo |
| `/api/mod/update` | yes | `{ repoUrl? }` — pull updates for mods linked to that repo; omit `repoUrl` to cover every linked source |
| `/api/mod/config` | `mods.write` | `{ modId, repoModId?, updateUrl?, updateSources?, directUrl? }` — set where a mod checks for its own updates |
| `/api/repo/manifest` | `repo.write` | `{ modsDir, outputPath?, name?, author?, gameName?, filesBaseUrl?, filesLayout?, reuseExisting?, only? }` — write a `repo.json` for a folder that is already hosted. Copies nothing and needs no profile; synchronous, so a publish script can act on the diff it returns. `reuseExisting` defaults to **true**: re-running produces a new revision of the SAME repo, not a different one |
| `/api/discord/rpc` | yes | `{ enabled: bool }` — enable/disable Discord Rich Presence |
| `/api/data/export-auto` | yes | `{ dir, name? (template: `{date}` `{time}` `{datetime}`), increment?: "paren"\|"underscore"\|"timestamp"\|"overwrite" }` — unattended backup, returns the path written |
| `/api/launchpack/run` | yes | `{ id }` — run a saved launch pack |
| `/api/schedule/run` | yes | `{ id }` — trigger a saved Scheduling & automation task |

---

## PUT endpoints

| Path | Auth · Perm | Body |
|---|---|---|
| `/api/mods/:id` | yes | `{ name?, version?, author?, description? }` |
| `/api/profiles/:id` | yes | `{ name?, game_name?, color?, icon?, game_path?, mods_path?, backup_path? }` |
| `/api/modpacks/:id` | yes | `{ name?, description?, game_name?, sr_link?, mod_ids?, multi_profile?, skip_integrity_check?, dependency_mode?, mod_overrides? }` |
| `/api/catalog/apps/:id` | yes · `catalog.write` | Any catalog-app fields to patch (only sent fields change) |
| `/api/apps/permissions/:id` | yes | `{ permissions:[…] }` — replaces the plugin's full permission list |

---

## DELETE endpoints

| Path | Auth · Perm | Body |
|---|---|---|
| `/api/repo/sync/cancel` | yes | — cancels the running sync |
| `/api/repo/gen/cancel` | yes | — cancels the running gen |
| `/api/repo/host` | yes | — stops the HTTP host |
| `/api/repo` | yes | `{ url }` — disconnect a repo |
| `/api/mods/:id` | yes | remove a mod entry (files kept) |
| `/api/profiles/:id` | yes | delete a profile |
| `/api/modpacks/:id` | yes | delete a modpack |
| `/api/apps/:id` | yes · `app.write` | uninstall an app from the registry (files kept) |
| `/api/catalog/apps/:id` | yes · `catalog.write` | remove an app from the local catalog |

---

## Deeplinks (`bmm://`)

Deeplinks are clickable URLs (web pages, Discord, scripts) that drive BMM when it's running.

| Deeplink | Equivalent endpoint |
|---|---|
| `bmm://mod/enable?id=<mod_id>` | `POST /api/mods/enable` |
| `bmm://mod/disable?id=<mod_id>` | `POST /api/mods/disable` |
| `bmm://profile/activate?id=<profile_id>` | `POST /api/profiles/activate` |
| `bmm://plugin/activate?id=<plugin_id>` | `POST /api/plugins/apply` |
| `bmm://plugin/compare?id=<plugin_id>` | `POST /api/plugins/compare` |
| `bmm://modpack/enable?id=<id>` | `POST /api/modpacks/enable` |
| `bmm://modpack/disable?id=<id>` | `POST /api/modpacks/disable` |
| `bmm://repo/connect?url=<url>&password=<pw>` | `POST /api/repo/connect` |
| `bmm://repo/sync?url=<url>&profile=<repo_profile_id>[&password=<pw>]` | `POST /api/repo/sync` |
| `bmm://repo/gen` | opens the Gen section (needs profile selection) |
| `bmm://repo/update?dir=<repoDir>` | opens the incremental-update modal |
| `bmm://repo/host?dir=<serveDir>&port=<port>` | opens the HTTP host section |
| `bmm://app/install?id=<id>&url=<url>&type=<exe\|zip\|msi\|script>&title=<title>&path=<dir>` | `install_app` |
| `bmm://app/launch?id=<id>&exe=<exePath>` | `launch_app` |
| `bmm://modpack/create?name=<name>&profile=<profile_id>` | `POST /api/modpacks/create` |
| `bmm://language/import?path=<file>` | `import_language` (omit `path` → file picker) |
| `bmm://benchmark/run?dataset=<sandbox\|real>&size=<S\|M\|L\|XL\|CUSTOM>&mb=<mb>&mode=<manual\|auto>&profiles=<id1;id2>&sources=<path1;path2>` | `POST /api/benchmark` (sources may be relative; profiles → mods folders) |
| `bmm://mod/check-updates` | `POST /api/mod/check-updates` |
| `bmm://telemetry/consent?enabled=<1\|0>` | `POST /api/telemetry/consent` |
| `bmm://telemetry/set?replay=<1\|0>&full=<1\|0>&bench=<1\|0>` | `POST /api/telemetry/settings` |
| `bmm://recorder/set?on=<1\|0>&full=<1\|0>&rust=<1\|0>&js=<1\|0>` | `POST /api/recorder` |
| `bmm://replay/export` | `POST /api/replay/export` |
| `bmm://replay/import?path=<file>` · `?url=<downloadUrl>` | `POST /api/replay/import` |
| `bmm://discord/rpc?enabled=<1\|0>` | `POST /api/discord/rpc` |
| `bmm://data/export-auto?dir=<folder>&name=<template>&increment=<paren\|underscore\|timestamp\|overwrite>` | `POST /api/data/export-auto` |
| `bmm://launchpack/run?id=<launchpack_id>` | `POST /api/launchpack/run` |
| `bmm://schedule/run?id=<task_id>` | `POST /api/schedule/run` |
| `bmm://mod/update?url=<repo_url>` | opens Repo → mod-updates (with `url`, pre-fills connect; without, runs the update check) |
| `bmm://plugin/delete?id=<plugin_id>` | `DELETE /api/plugins/:id` (uninstall a plugin) |
| `bmm://catalog/<app\|plugin\|theme>/install?url=<download_url>&name=<label>&type=<exe\|zip\|msi\|script>` | one-click install a BetterCommunity catalog item (`type` applies to `app`; omit `url` to just open the matching view) |
| `bmm://catalog/<app\|plugin\|theme>/add-source?url=<catalog_url>` | subscribe to a community app/plugin/theme catalog (asks for confirmation) |
| `bmm://theme/apply?id=<theme_id>` | activate an installed theme |
| `bmm://theme/import?url=<theme_json_url>` | import + install a theme from a JSON URL |
| `bmm://theme/editor` | open the theme editor |
| `bmm://settings/layout?code=<code>` | apply a shared Settings card-layout code |
| `bmm://settings/navbar?code=<code>` | apply a shared navbar-layout code |
| `bmm://restart` | restart BMM |
| `bmm://install?url=<mod_url>` (aliases: `import`, `download`) | one-click mod install |
| `bmm://api?method=<M>&path=<api_path>&<field>=<value>…` | **generic passthrough — hits ANY endpoint.** Extra params become the JSON body (POST/PUT) or query string (GET/DELETE). Ex: `bmm://api?method=POST&path=/api/mods/enable&mod_id=abc` |

> Deeplinks respect the global "Allow deep links" toggle in **Plugins & API → Permissions**.

---

## Permissions

Which permissions apply is decided by the token the request carries. Granted via `PUT /api/apps/permissions/:id`, which takes the **admin** token.

| Permission | Grants |
|---|---|
| `app.read` | list installed apps and their permissions |
| `app.write` | install, launch and remove apps |
| `catalog.read` | read the local app catalogue |
| `catalog.write` | create, edit and delete catalogue entries |
| `data.read` | read EVERYTHING BMM holds (`GET /api/data`) and export it to a file |
| `data.write` | import data over what is there |
| `hooks.read` | see which hooks have fired |
| `hooks.write` | fire a hook an automation may be waiting on |
| `keys.read` | see which identity keys exist |
| `keys.write` | mint an identity key — the thing that proves you are you to every protected source |
| `modpacks.read` | list and export modpacks |
| `modpacks.write` | create, change, apply and delete modpacks |
| `mods.read` | list mods, and see which one wins a shared file |
| `mods.write` | enable, disable, update, delete and reorder mods |
| `plugins.read` | list plugins, compare a modlist, read the files a plugin ships |
| `plugins.write` | install, apply and DELETE plugins — including others |
| `profiles.read` | list profiles |
| `profiles.write` | create, edit, delete and activate profiles |
| `repo.read` | see which repos are connected and what they hold |
| `repo.write` | connect, sync, publish and host repos |
| `schedules.read` | list saved automations |
| `schedules.write` | run an automation, arm or disarm one |
| `system.write` | restart BMM, change the open screen, run a benchmark, import a language |
| `telemetry.write` | change what is recorded and what is sent |

> The list lives in the code as `api::PLUGIN_SCOPES`, and a test asserts it matches the router in both directions — a scope the router demands that nothing can grant is a route nothing can reach, and a scope that gates no route is a checkbox promising protection it does not give. They are exactly the checkboxes in **Plugins & API → Permissions**.

> **Reads are gated.** They were not: fifty routes needed a token and no permission at all, and a per-plugin token is a valid token — so `GET /api/data`, `POST /api/data/import`, `POST /api/restart` and `DELETE /api/plugins/<id>` were reachable by a plugin with an empty permission list. On upgrade each plugin keeps the read half of every domain it already had write on; nothing else is carried over, and a plugin leaning on a domain it was never granted now gets a `403` naming the scope.

> **The permission table itself takes the admin token**, never a plugin token: a plugin able to `PUT` its own grants could grant itself everything.

> Unknown permission strings are stored verbatim and gate nothing.

Admin token → everything. Plugin token → only what that plugin was granted; everything else returns `403`, naming the scope it wanted.

---

## Status codes

| Code | Meaning |
|---|---|
| `200` | OK (direct result) |
| `202` | Accepted (UI-driven action started) |
| `400` | Invalid/missing fields |
| `401` | Missing/invalid token |
| `403` | Plugin lacks the required permission |
| `404` | Resource not found |
| `500` | Internal error |

---

*Generated as part of the Plugins & API overhaul. Keep this in sync with `frontend/src/features/plugins/plugins.ts` (`getEndpointDefs`) and `frontend/src/core/deep_link_manager.ts`.*
