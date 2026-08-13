# The repo format, and how the generator builds it


A **Server Repo** is a folder you can put behind any web server. It holds the mod files
plus one manifest, `repo.json`, that describes them precisely enough for another BMM to
know what it already has and what it must fetch.

This page documents the format itself — every field, what is required, and what each one
changes — so you can generate a repo without BMM, read one you were handed, or debug why
a sync is re-downloading things it should have skipped.

Everything below is taken from `src-tauri/src/models/repo.rs` and
`src-tauri/src/commands/repo.rs`. Where the two disagree with this page, they are right
and this page is a bug.

---

## 1. What the generator writes

Exporting a repo produces a directory containing:

| Path | What it is |
|---|---|
| `repo.json` | The manifest. The only file a consumer strictly needs. |
| `mods/` | The mod files, one directory per mod id. |
| `Info.json` | A human-readable summary (counts, total size). Not consumed by BMM. |
| `bans.json` | Ban list, used only by the bundled mini-server. |
| `BMM-Standalone-Server.bat` / `.sh` | Launchers for the bundled mini-server. |
| `Dockerfile`, `docker-compose.yml`, `package.json`, `public/` | The mini-server, if you asked for it. |

Only `repo.json` and `mods/` matter to a consumer. The rest is convenience for hosting the
repo yourself, and you can delete it if you serve the folder with your own nginx, Caddy or
BetterCommunity hosting.

---

## 2. `repo.json` — the top level

```json
{
  "name": "My Repo",
  "description": null,
  "author": "Someone",
  "author_id": null,
  "signature": null,
  "version": "1.0",
  "game_name": "DCS World",
  "created_at": "2026-08-13T04:51:49Z",
  "seed": null,
  "upload_limit": null,
  "profiles": [ … ],
  "modpacks": null
}
```

**Required** — the key must be present, though several accept `null`:

| Field | Type | Notes |
|---|---|---|
| `name` | string | Repo name. |
| `description` | string \| null | |
| `author` | string \| null | Display name. |
| `author_id` | string \| null | The author's BetterCommunity id, when they have one. |
| `signature` | string \| null | Optional integrity signature over the manifest. |
| `version` | string | Manifest version. BMM writes `"1.0"`. |
| `game_name` | string | Free text; groups profiles by game. |
| `created_at` | string | Timestamp, RFC 3339. |
| `seed` | string \| null | |
| `upload_limit` | number \| null | The author's suggested cap, in KB/s. |
| `profiles` | array | The content. See §3. |
| `modpacks` | array \| null | Shared modpacks. See §6. |

**Optional** — omit them entirely and BMM fills in the documented default:

| Field | Type | Default | What it does |
|---|---|---|---|
| `require_login` (`requireLogin`) | bool | `false` | Every file download must present a BetterCommunity identity. |
| `files_base_url` (`filesBaseUrl`) | string | the repo's own URL | Serve files from a different host than the manifest. |
| `files_layout` (`filesLayout`) | string | `mods/{id}/{path}` | Where a file sits, relative to the base. See §5. |

> A field marked required but typed `… | null` still needs its key. Omitting it is a parse
> error, and a parse error means the whole repo reads as empty — not as "partly broken".
> This is the single most common way a hand-written manifest fails.

---

## 3. Profiles

```json
{
  "id": "prof-1",
  "name": "Main",
  "game_name": "DCS World",
  "mods": [ … ],
  "icon": null,
  "color": null,
  "icon_image": null
}
```

`id`, `name`, `game_name` and `mods` are required. `icon`, `color` and `icon_image` are
optional and only affect how the profile looks once imported — they exist so the receiver
sees the profile the way its author arranged it.

---

## 4. Mods and files

```json
{
  "id": "cool-mod",
  "name": "Cool Mod",
  "version": "1.0",
  "author": null,
  "description": null,
  "tags": [],
  "files": [ … ],
  "download_links": []
}
```

Required: `id`, `name`, `version`, `author`, `description`, `tags`, `files`,
**`download_links`**.

> `download_links` is required and has **no default**. A mod without it fails the whole
> document. This is worth stating loudly because the failure is silent: the manifest is
> rejected, and the repo simply appears to contain nothing.

Optional: `archive`, `dependencies`, `changelog`, `update_url`, `direct_url`,
`update_sources`.

`archive` is for repos generated with "zip mods": the mod's files are packed into a single
archive and `files` is then empty. Absent means the classic per-file layout.

### A file entry

```json
{
  "relative_path": "Data/textures/a.dds",
  "size": 2048,
  "sha256_hash": "…",
  "chunks": null,
  "mtime": 1786593318
}
```

| Field | Required | Notes |
|---|---|---|
| `relative_path` | yes | Relative to the **mod**, not the repo. Forward slashes. |
| `size` | yes | Exact bytes. Never rounded — see below. |
| `sha256_hash` | yes | Of the whole file. May be `""` if genuinely unknown. |
| `chunks` | yes (may be `null`) | Per-chunk hashes for large files. See §4.1. |
| `mtime` | no | Unix seconds. Absence means "unknown". |

**Why sizes must be exact.** A refresh compares the size and date it sees against the
manifest to decide whether a file changed. A human-readable `"1.2K"` compared against an
exact byte count marks *every* file as changed, so the sync re-downloads everything — it
still works, it just quietly stops being worth anything.

**Why `mtime` matters.** It is what lets a refresh skip a file it already has. Without it
the planner reads "unknown" and re-hashes, every time. It is never used to validate a
download — that is always the hash. Absence is safe, just expensive.

### 4.1 Chunking

Files larger than **4 MiB** (`CHUNK_SIZE`) also carry a `chunks` array:

```json
"chunks": [ { "size": 4194304, "sha256_hash": "…" }, { "size": 1048576, "sha256_hash": "…" } ]
```

Both fields are required on each chunk. Smaller files carry `"chunks": null`. Chunks let a
consumer resume and verify a large download in pieces instead of restarting it.

---

## 5. Where the files actually live

By default a mod file is fetched from:

```
<repo base URL>/mods/<mod id>/<relative_path>
```

Two optional fields change that, and both exist for the same reason — hosting that already
serves your mods somewhere of its own choosing:

- **`files_base_url`** replaces the base. Use it when the manifest and the files are on
  different hosts. A trailing slash is normalised for you, because `host//mods/…` and
  `hostmods/…` do not fail loudly — they just 404 on every file.
- **`files_layout`** is a template over `{id}` and `{path}`. The default,
  `mods/{id}/{path}`, is exactly what every manifest written before this field existed
  means. A leading `/` is stripped: it would read as "root of the host" and silently drop
  any path already in the base URL.

Example — files served flat, on a CDN:

```json
"files_base_url": "https://cdn.example.com/repo/",
"files_layout": "{id}/{path}"
```

---

## 6. Shared modpacks

`modpacks` carries entries of the form:

```json
{ "modpack": { … }, "share_mode": "public", "custom_whitelist": null }
```

`share_mode` decides who sees the pack when the repo is served by BMM's own mini-server,
which filters `repo.json` per requester:

| `share_mode` | Who receives it |
|---|---|
| `public` | Everyone. |
| `whitelist_repo` | Anyone not banned, and — if the repo's whitelist is enabled — whitelisted. |
| `whitelist_custom` | Only Creator IDs listed in `custom_whitelist`. |

Anything else is treated as "nobody". Note this filtering is done by the mini-server: a
plain static host serves the manifest as written, so do not rely on `share_mode` as a
security boundary when you host the folder yourself.

---

## 7. Hosting it without BMM

The manifest is a static file, so any web server works. Two things make a plain file
server pleasant to sync against:

1. **Serve a directory index.** BMM can walk a listing instead of a manifest — it reads
   nginx's autoindex format, taking the size and date on each row to skip re-hashing what
   has not changed. The format is strict: one entry per line, one path segment per link,
   directories shown with `-` instead of a size, and dates as `dd-Mon-yyyy HH:MM` in UTC.
2. **Report exact sizes**, for the reason in §4.

BetterCommunity hosting does both, and additionally **generates the manifest for you** —
you upload files and publish, with no `repo.json` to write. An uploaded manifest still wins
where one exists, because it carries profile names, mod versions, tags and chunk tables
that cannot be recovered from a file listing.

---

## 8. Debugging a manifest

| Symptom | Usual cause |
|---|---|
| The repo appears completely empty | A parse error. Most often a required key omitted rather than set to `null` — `download_links` first, then `chunks`. |
| Every sync re-downloads everything | Sizes are rounded, or `mtime` is missing, or the hash is empty. |
| Individual files 404 | `files_base_url` / `files_layout` do not match where the files really are. Build one URL by hand from §5 and open it. |
| A modpack is missing for some users | `share_mode`, and only when served by the mini-server (§6). |
