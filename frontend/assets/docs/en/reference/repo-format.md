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
| `.env` (+ a `.env` line in `.gitignore`, `.dockerignore`) | The mini-server's admin password, read by `docker-compose.yml` (`env_file`). Never served, never committed. |

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
| `version` | string | The **repo's** version — the author's own number. Not the format: that is `format_version`. |
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
| `format_version` (`formatVersion`) | string | none (legacy) | The **format** the manifest is written in. BMM writes `"1.0"`, signed with the rest. See §9. |

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
| BMM says « format 2.0 (newer than this BMM) » and refuses the repo | The manifest declares a format major this BMM does not read. Update BMM; nothing is wrong with the repo. |
| The repo shows « legacy 0.x » | Written by a BMM from before format versions. It still syncs; §9 says how to convert it. |

---

## 9. Format versions, and converting an old manifest

Until format 1.0 a manifest said nothing about its own shape — `version` is the repo's
version, not the format's. A manifest now declares it at the top level:

```json
{ "name": "My Repo", "…": "…", "format_version": "1.0" }
```

Every writer in BMM (export, update, manifest-only, extras, modpacks, refresh from server)
stamps it **before** signing, so the signature covers it.

### 9.1 The registry

| Format | Name | BMM wrote it from | What it added |
|---|---|---|---|
| `0.1` | first export | 2026-03 | name, description, author, version, game, profiles; mods with tags and files (path, size, sha256) |
| `0.2` | signed | 2026-03 | `author_id` + `signature` (ed25519), `seed`, `upload_limit`; mod `download_links`; file chunks |
| `0.3` | modpacks | 2026-04 | `modpacks`, `require_login`; zipped mods (`archive`), dependencies, changelog, update sources; profile icon and colour |
| `0.4` | hosting | 2026-08 | `files_base_url`, `files_layout`, file `mtime`, `extras`, sealed credentials |
| `1.0` | versioned | 2026-10 | `format_version`; every required key written; the signature covers the format |

The `0.x` numbers are given after the fact: those manifests never carried them. BMM
recognises them by **shape** — the newest marker present wins (a `files_layout` makes it
0.4 even if nothing else from 0.4 is there).

### 9.2 What BMM does with each

| What the manifest says | Label on the Server Repo page | What happens |
|---|---|---|
| `format_version: "1.0"` | **format 1.0** | Read as-is. |
| nothing, shape 0.2 to 0.4 | **legacy 0.x — convert** | Read as-is. Converting is recommended, not required. |
| nothing, shape 0.1 (no `download_links`) | **legacy 0.1 — convert** | Today's reader refuses this shape whole — it used to show as an empty repo. BMM now reads it through an in-memory upgrade, **unless it is signed**: filling keys changes the signed bytes, so a signed 0.1 stays unreadable until its owner converts it. |
| `format_version: "1.x"`, x above 0 | format 1.x | Read; fields this BMM does not know are ignored. Never converted "down". |
| `format_version: "2.0"` or higher | format 2.0 (newer than this BMM) | **Refused**, with that reason. Update BMM. |
| `format_version` that is not a number | — | Refused as invalid. |

A manifest that claims `1.0` but lacks a required key is treated like a legacy one: read
through the upgrade, offered for conversion.

### 9.3 Converting

The converter is one piece of code reached four ways — the **Convert…** button next to the
format badge on the Server Repo page, `POST /api/repo/convert`, `bmm repo-convert`, and the
MCP tool `bmm_repo_convert`. It always:

1. **Plans first** (dry run): every key it would add, every value it would normalise
   (`""` → `null` for description and author, camelCase spellings → snake_case, bare-string
   tags → tag objects), every hash it would fill or correct, every file it cannot find.
2. **Re-hashes** every listed file from the folder, with the exporter's own rule (whole-file
   sha256, plus a chunk table above 4 MiB), following `files_layout` and zipped-mod archives.
   Paths that would leave the folder are never read. Files hosted elsewhere
   (`files_base_url`) are left as they are. A missing file keeps its entry and is reported.
3. Checks the result **loads in BMM's real reader** before writing anything.
4. **Backs up** the old manifest beside it as `repo.json.v<old>-<yyyymmdd-hhmmss>.bak`
   (never served: the servers only serve `repo.json` and `info.json` at the root).
5. Stamps `format_version`, **re-signs** with this BMM's key, and writes through a temporary
   file renamed over the old one, so a crash leaves the old manifest, never half a new one.

Re-signing with your key means a repo first signed by **someone else** changes author id —
the plan says so before you confirm. Subscribers that pinned the old id see the change.
Converting an up-to-date manifest is a no-op: nothing is written and the signature is kept.

```text
bmm repo-convert "D:/Repos/MyRepo" --dry-run   # the plan; works with BMM closed
bmm repo-convert "D:/Repos/MyRepo"             # convert + re-sign (BMM running)
bmm repo-convert "D:/Repos/MyRepo" --no-sign   # convert without the app, UNSIGNED
```

The mini-servers (`server.js`, the multi-repo hub) report the format of what they serve in
their startup log and in `/monitoring.json` (`repoFormat`), and keep `format_version` when the
admin dashboard rewrites the manifest.
