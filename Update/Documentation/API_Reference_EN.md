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
| `/api/status` | no | App version, active profile, counts | `{ ok, version, active_profile, mod_count, profile_count, plugin_count }` |
| `/api/check-update` | no | Compare running version to latest GitHub release | `{ ok, current, latest, has_update, release_url }` |
| `/api/mods` | no | All mods in the active profile | `{ ok, data:[{id,name,active,enabled,path}] }` |
| `/api/mods/active` | no | Only enabled mods of active profile | `{ ok, data:[…] }` |
| `/api/mods/all` | no | **Every mod across ALL profiles**, grouped by profile + total | `{ ok, total_mods, profiles:[{profile_id,profile_name,mod_count,mods:[…]}] }` |
| `/api/data` | yes | **Full BMM data export** (`data.json`) — profiles, mods, modpacks, plugins, settings… | JSON file (`bmm-data.json`) |
| `/api/modpacks` | no | All modpacks (name + mod count) | `{ ok, data:[{id,name,mod_count,active}] }` |
| `/api/profiles` | no | All profiles incl. their mod lists | `[{id,name,active_mods:[…]}]` |
| `/api/plugins` | no | Installed plugins | `[{id,name,version,…}]` |
| `/api/creator-id` | no | This user's creator ID (public key) | `{ ok, creator_id }` |
| `/api/repo/info?url=` | no | Metadata for a remote repo | repo manifest summary |
| `/api/repo/list` | no | Connected repos | `[{url,name,…}]` |
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
| `/api/repo/connect` | yes | `{ url, name? }` |
| `/api/repo/sync` | yes | `{ url, creator_id?, game_dir?, mods_dir?, backup_dir?, choices?, download_limit? }` (UI-driven) |
| `/api/repo/gen` | yes | `{ profileIds[], outputDir, authorName, … }` (UI-driven) |
| `/api/repo/update` | yes | `{ repoDir }` — opens the incremental-update modal pre-filled |
| `/api/repo/host` | yes | `{ serveDir, port?, uploadLimit? }` |

### App Catalog
| Path | Auth · Perm | Body |
|---|---|---|
| `/api/apps/install` | yes · `app.write` | `{ appId, appTitle, downloadUrl, fileType, installPath?, version?, category?, thumb? }` — `fileType` ∈ `exe·zip·msi·script` |
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
| `bmm://repo/connect?url=<url>` | `POST /api/repo/connect` |
| `bmm://repo/sync?url=<url>&profile=<repo_profile_id>` | `POST /api/repo/sync` |
| `bmm://repo/gen` | opens the Gen section (needs profile selection) |
| `bmm://repo/update?dir=<repoDir>` | opens the incremental-update modal |
| `bmm://repo/host?dir=<serveDir>&port=<port>` | opens the HTTP host section |
| `bmm://app/install?id=<id>&url=<url>&type=<exe\|zip\|msi\|script>&title=<title>&path=<dir>` | `install_app` |
| `bmm://app/launch?id=<id>&exe=<exePath>` | `launch_app` |
| `bmm://modpack/create?name=<name>&profile=<profile_id>` | `POST /api/modpacks/create` |
| `bmm://language/import?path=<file>` | `import_language` (omit `path` → file picker) |
| `bmm://restart` | restart BMM |
| `bmm://install?url=<mod_url>` (aliases: `import`, `download`) | one-click mod install |
| `bmm://api?method=<M>&path=<api_path>&<field>=<value>…` | **generic passthrough — hits ANY endpoint.** Extra params become the JSON body (POST/PUT) or query string (GET/DELETE). Ex: `bmm://api?method=POST&path=/api/mods/enable&mod_id=abc` |

> Deeplinks respect the global "Allow deep links" toggle in **Plugins & API → Permissions**.

---

## Permissions

Permissions only apply when a request carries `X-BMM-Plugin-Id`. Granted via `PUT /api/apps/permissions/:id`.

| Permission | Grants |
|---|---|
| `app.read` | read installed apps (`GET /api/apps`) |
| `app.write` | install / launch / uninstall apps |
| `catalog.read` | read the local catalog |
| `catalog.write` | create / edit / delete catalog entries |
| `mods.read` | read mods |
| `mods.write` | enable / disable / edit / delete mods |
| `profiles.read` | read profiles |
| `profiles.write` | create / edit / delete / activate profiles |
| `modpacks.read` | read modpacks |
| `modpacks.write` | create / enable / disable / edit / delete modpacks |
| `plugins.read` | compare a plugin's modlist |
| `plugins.write` | apply a plugin |
| `repo.read` | read repo info / list |
| `repo.write` | connect / sync / gen / host / disconnect repos |

> These scopes are enforced server-side in `src-tauri/src/api/mod.rs` via `require_permission(...)` and are exactly the checkboxes shown in **Plugins & API → Permissions** (grouped by domain). Granting one in the UI unlocks the matching endpoints for that plugin.

Without the header → admin (all allowed). With the header → only the granted permissions are allowed; everything else returns `403`.

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
