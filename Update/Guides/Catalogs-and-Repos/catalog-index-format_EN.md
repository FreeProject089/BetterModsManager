# Catalog index — one address for many catalogs

A **catalog** lists things to install. An **index** lists catalogs.

Without one, following a community means collecting a URL for their app catalog, another
for their plugins, another for their themes, and pasting each into a different screen. An
index is one address that brings in all of them, and keeps working when they publish a
new one.

BMM reads an index in **Settings → Catalogue index**. Paste the address, then either:

- **Look inside** — shows every catalog the index lists, with its type, name and how many
  items it holds, and marks the ones you already follow. It reads and displays; it adds
  nothing. Each row has its own **Add**, so you can take three catalogs out of thirty.
- **Add everything** — follows the whole index at once. It fetches for itself, so you do
  not have to look inside first.

Two folds under it answer the questions that come later:

- **Catalogs you follow** — every community catalog BMM fetches at startup, of all five
  types, whatever added it: an index, a deep link, or another settings panel. Each one is
  removable here. It is the only screen where all five meet.
- **History** — what was followed and unfollowed, when, and from which index. The source
  lists are plain arrays with no dates, so without this a catalog you do not remember
  adding has no record anywhere — and neither does one you removed and now want back.

---

## The document

```json
{
  "version": "1.0",
  "kind": "catalog-index",
  "name": "My community catalogs",
  "description": "Everything we publish for BMM.",
  "generatedAt": "2026-08-14T12:00:00.000Z",
  "catalogs": [
    {
      "type": "plugin",
      "app": "bmm",
      "name": "Our plugin catalog",
      "description": "Plugins we maintain.",
      "url": "https://example.com/plugins.json",
      "owner": "Someone",
      "items": 12,
      "updatedAt": "2026-08-13T09:20:00.000Z",
      "sha256": "9e2daaa8…"
    }
  ]
}
```

Only `catalogs` is required, and inside it only **`type`** and **`url`**. Everything else
improves what the reader can show you; nothing else changes what it does.

### Fields on an entry

| Field | Required | What it means |
|---|---|---|
| `type` | **yes** | `app`, `plugin`, `theme`, `preset` or `repo`. Anything else is dropped. |
| `url` | **yes** | The catalog itself. `http` or `https` only. |
| `app` | no | Which Better\* product it is for — `bmm`, `bsm`, `installer`. |
| `name` | no | Shown in the preview. |
| `description` | no | Shown in the preview. |
| `owner` | no | Who publishes it. |
| `items` | no | How many things are in it. |
| `updatedAt` | no | When it last changed. |
| `sha256` | no | A fingerprint of its contents, so a client can tell "unchanged" from "fetched again". |
| `official` | no | **Ignored.** See below. |

---

## Three things the reader will not do, and why

**It ignores `official`.** BMM decides trust from the URL a catalog was fetched from, not
from what the catalog says about itself. An index able to grant that badge would be a way
around the rule rather than part of it, so the field is dropped even when present.

**It drops a `type` it does not know, instead of guessing.** `plugins` looks like
`plugin`; guessing is how a preset catalog ends up in the themes list.

**It drops anything that is not `http`/`https`.** An index is a list of addresses handed
to a fetcher. A `file://` entry is refused rather than passed along in the hope it fails.

Everything dropped is counted and shown in the preview — you are told, not silently given
less than the file contained.

---

## `app`: how a client ignores what is not for it

An index may list catalogs for several Better\* products. BMM keeps an entry when:

- its `app` says `bmm`, **or**
- it has **no `app` at all**.

An entry saying `bsm` is dropped, with a reason.

The asymmetry is deliberate. Absent means "the publisher did not say", which is the state
of every catalog written before the field existed — dropping those would empty the index
for exactly the people who have used it longest. An explicit mismatch is a statement; a
missing value is not.

---

## Where each type goes

| `type` | Ends up in |
|---|---|
| `app` | App Catalog → Sources |
| `plugin` | Plugin catalogs |
| `theme` | Theme catalogs |
| `preset` | Scheduler → *From a catalog…* |
| `repo` | Browse Server-Repos |

A repo catalog is a `repos.json`-shaped document — see the Server-Repo guide. Entries it
brings in are tagged **community** by BMM, whatever the file claims.

---

## What BetterCommunity publishes

One generator, several addresses:

```
https://bettercommunity.ch/api/catalogs.json                     everything
https://bettercommunity.ch/api/catalogs.json?scope=official      only ours
https://bettercommunity.ch/api/catalogs.json?scope=community     only published by people
https://bettercommunity.ch/api/catalogs.json?app=bmm             only for BMM
https://bettercommunity.ch/api/catalogs.json?type=plugin         only plugin catalogs
```

`scope`, `app` and `type` combine.

Two honest notes about that feed:

- Entries for **BetterCommunity's own** catalogs carry `type`, `app`, `official`, `name`,
  `description`, `url` and `owner` — they do **not** carry `items`, `updatedAt` or
  `sha256`. Those appear on community entries only.
- A feed is offered only when something is actually published in it. An index entry that
  led to an empty document would teach people to stop trusting the index.

---

## Publishing your own

Serve the JSON at a stable `https` address. Nothing else is required — no account, no
registration. A hand-written index works exactly like a generated one; `kind` is enough on
its own to be recognised, but is not required.

If you paste an index into an ordinary "add a catalog source" box by mistake, BMM notices
and tells you to use Settings instead. It does not add it there: importing an index adds
several sources at once, which is a bigger action than the one you asked for.
