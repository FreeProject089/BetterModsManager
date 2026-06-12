# Mod Update API — Developer Guide

This guide documents the **mod update system** from a developer/integrator point of
view: the HTTP API endpoints, the deep links, the data model, and how detection
works. For the mod-author side (making a mod updatable, writing changelogs), see
the **Modding** guide *"Making your mod updatable"*.

---

## 1. Concepts in 30 seconds

- Every installed mod can be **linked** to one or more repositories that act as
  update sources.
- A link is a pair: **`repo_url`** (where to look) + **`repo_mod_id`** (the mod's
  *stable* id inside that repo — survives version bumps, unlike `content_id`).
- BMM compares the installed version to the repo's current version. If they
  differ → an update is available.
- Applying an update re-uses the normal **delta-sync** (only changed files are
  downloaded).

A mod gets linked automatically when synced from a repo, or manually via the API /
the in-app *Configure updates* dialog.

---

## 2. HTTP API

Base URL: `http://127.0.0.1:<port>` (the local BMM API server). Endpoints that
mutate or trigger UI require the bearer token (`Authorization: Bearer <token>`).

### 2.1 `POST /api/mod/config` — configure update sources *(auth, mods.write)*

Links a mod to its update repo(s).

```json
{
  "modId": "local-mod-id",
  "repoModId": "stable-id-in-repo",          // optional, "" clears it
  "updateUrl": "https://site.com/repo.json",  // optional primary URL (site mods)
  "updateSources": [                           // optional, additional repos
    { "repoUrl": "https://host/repo.json", "repoModId": "abc" },
    { "repoUrl": "https://mirror/repo.json" }  // repoModId falls back to repoModId above
  ]
}
```

Response `200`: `{ "ok": true, "mod_id": "…" }`. URLs are normalised (trailing
`/repo.json` and slashes stripped, lower-cased).

### 2.2 `POST /api/mod/check-updates` — run a check *(auth)*

Triggers a real update check. Every linked mod (sync origin + configured
`updateSources` + the **global update repos** from Settings) is compared against
its repo's current version. Driven through the BMM UI, which opens the results
modal. Unreachable repos are reported as errors (not silently skipped).

Response `202`: `{ "ok": true, "driven_by": "bmm-ui", "action": "mod/check-updates" }`.

### 2.3 `POST /api/mod/update` — apply an update *(auth)*

```json
{ "repoUrl": "https://host/repo.json" }   // optional
```

Jumps to the sync flow pre-filled with `repoUrl`, where the delta-sync downloads
only the changed files. Omit `repoUrl` to just open the update check.

Response `202`: `{ "ok": true, "driven_by": "bmm-ui", "action": "mod/update" }`.

### 2.4 Related: `POST /api/repo/update`

Authoring side — bump versions and write per-mod changelogs into a repo you host.
Accepts a `modChangelogs` object (`{ "<modId>": "what changed" }`). See that
endpoint's entry in **Documentation → Plugins & API**.

---

## 3. Deep links

The same actions are available as `bmm://` deep links (no token needed; the user
confirms in-app):

| Deep link | Action |
|-----------|--------|
| `bmm://mod/check-updates` | Run an update check |
| `bmm://mod/update?url=<repo_url>` | Apply update from a repo (omit `url` to just check) |
| `bmm://repo/update?dir=<repoDir>` | Open the authoring "Update repo" modal |

---

## 4. Data model

`ModEntry` (per installed mod) carries:

| Field | Meaning |
|-------|---------|
| `source_repo` | Repo URL the mod was synced from (set automatically). |
| `repo_mod_id` | The mod's stable id inside that repo. |
| `update_url` | Optional primary "own repo" URL (site mods). |
| `update_sources` | `[{ repo_url, repo_mod_id? }]` — extra user-configured repos. |

`RepoMod` (per mod inside a repo manifest) carries `id` (the stable id pointed at
by `repo_mod_id`), `version`, and an optional author `changelog`.

---

## 5. Detection algorithm (`check_mod_updates`)

1. For each installed mod, gather candidate `(repo_url, repo_mod_id)` pairs from
   `source_repo`, `update_url`, every `update_sources` entry, and each global
   repo (matched by the mod's `repo_mod_id`). Duplicates are removed.
2. Fetch each **unique** repo manifest once. Failures are collected as errors.
3. Build `repo_mod_id → (version, changelog)` from every profile in the manifest.
4. Emit an update wherever `repo_version != installed_version`.

The command returns `{ updates: [...], errors: [...], checked: <n> }`. `checked`
is how many mods were trackable — `0` means nothing is linked yet (the UI shows a
*"no mods are linked to a repo"* hint instead of *"up to date"*).

---

## 6. Settings

- **Mod update check interval** (minutes, `0` = manual only) — drives an automatic
  background check.
- **Global update repositories** — one URL per line; every installed mod is also
  checked against these (matched by `repo_mod_id`).

Both live in Settings and are stored client-side (localStorage:
`bmm_update_check_min`, `bmm_update_repos`).

---

*See also: Modding → "Making your mod updatable", and the in-app
Documentation → Plugins & API tab for the full endpoint reference.*
