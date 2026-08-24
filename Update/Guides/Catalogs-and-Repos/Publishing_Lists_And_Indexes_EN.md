# Publishing a repo list or a catalogue index

Most things you publish are **collections of items**: a plugin catalogue holds plugins, a
theme catalogue holds themes. Two things are not, and they are the subject of this guide:

- a **Server-Repo list** — a file naming repositories, which BMM's *Browse Server
  Repositories* reads;
- a **catalogue index** — a catalogue of catalogues, one address that brings in several at
  once.

Neither has items to upload. Each is a single JSON document listing addresses somebody else
serves, which is why hosting one is free.

---

## Building the file in BMM

You do not write these by hand.

**A repo list** — *Server Repo → Browse Server Repositories → build a catalogue*. Fetch the
repos you already follow, tick the ones you want, and save. BMM writes:

```json
{
  "name": "My repo catalogue",
  "generatedAt": "2026-08-24T10:00:00.000Z",
  "repos": [
    {
      "name": "Community DCS repo",
      "url": "https://repo.example.com",
      "description": "Liveries and sound mods.",
      "region": "eu",
      "category": "community"
    }
  ]
}
```

**A catalogue index** — *Settings → Catalogue index → build an index*. Pick from the
catalogues you already follow, of every type. BMM writes:

```json
{
  "version": "1.0",
  "name": "My index",
  "description": "Everything I publish.",
  "catalogs": [
    { "type": "plugin",   "url": "https://example.com/plugins.json",   "name": "My plugins" },
    { "type": "theme",    "url": "https://example.com/themes.json",    "name": "My themes" },
    { "type": "tutorial", "url": "https://example.com/tutorials.json", "name": "My tutorials" },
    { "type": "repo",     "url": "https://example.com/repos.json",     "name": "My repos" }
  ]
}
```

`type` may be `app`, `plugin`, `theme`, `preset`, `modpack`, `repo` or `tutorial`. Anything
else is dropped by the reader rather than guessed at.

---

## Hosting it on BetterCommunity

**Submit content → Host my own catalog**, then under *Catalog type* choose from the
**Lists & indexes** group:

| Type | The file it expects |
|---|---|
| **Server-Repo list** | a document with a `repos` array |
| **Catalogue index** | a document with a `catalogs` array |

The form checks for the **right** array for the type you picked and says which one is missing
if it is not there — a repo list uploaded as an index is caught at upload, not by a reader
weeks later.

Hosting mode is **raw** and there is no other option: there are no per-entry payloads, so
there is nothing for a storage pool to hold. That also means these cost nothing.

Everything else behaves as any catalogue does — visibility, a download password, authorised
keys, a private share link. The address you get is stable and is what you hand out.

---

## Hosting it anywhere else

These are plain JSON files served over HTTP(S). GitHub Pages, a static host, your own server —
anything that returns the file with a sane content type works. BMM only needs the URL.

If you serve them from a **generated BMM server**, they are subject to that server's
`access.json` like any other file — see *Closing a server you generated*.

---

## What a reader does with them

**A repo list** appears in *Browse Server Repositories* alongside the official one. Entries it
brings in are tagged **community** by BMM whatever the file claims — a list cannot promote its
own entries.

**An index** is pasted into *Settings → Catalogue index*. The reader can **Look inside** — see
every catalogue with its type and item count, and add them one at a time — or **Add
everything**. Catalogues arriving through an index are recorded with the index they came
from, so *History* can answer "where did this come from" and bring back one you removed.

An index entry claiming `official: true` is **ignored**. Trust comes from the source URL BMM
was configured with, and an index that could grant it would be a way around that rather than
an extension of it.

---

## Keeping it current

Both files are snapshots. Rebuild and re-upload when what you publish changes — there is no
sync back from BMM.

Two fields are worth filling in on index entries even though they are optional:

- `updatedAt` — when the catalogue it points at last changed;
- `items` — how many things are in it.

Readers see both in *Look inside*, and an index whose entries carry neither is a list of URLs
somebody has to click to evaluate.

---

## See also

- **Catalog index — one address for many catalogs** — the format in full, and how BMM reads it
- **Closing a server you generated** — access control on a server you host yourself
- **Writing an interactive tutorial** — publishing a tutorial catalogue, which an index can list
