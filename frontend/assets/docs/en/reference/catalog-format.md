# The universal catalogue format

BMM reads catalogues of eight kinds — apps, plugins, themes, presets (automations), modpacks,
repos, tutorials and mod lists — and over time each kind grew its own document. They all still
work. This page describes the **one** format that can carry any of them, and how every older
shape maps onto it.

Everything below is taken from `src-tauri/src/commands/catalog_format.rs` (the reader of record)
and `frontend/src/core/catalog-format.ts` (its fallback). Both are tested against the same
fixtures in `src-tauri/tests/catalog_format/`. Where they disagree with this page, they are
right and this page is a bug.

---

## 1. The document

```json
{
  "format": "bmm-catalog",
  "format_version": 1,
  "id": "hello-catalogue",
  "name": "Hello catalogue",
  "name_i18n": { "fr": "Catalogue bonjour" },
  "description": "One of each",
  "description_i18n": { "fr": "Un de chaque" },
  "publisher": "Hello Group",
  "homepage": "https://example.org",
  "app": "bmm",
  "updated_at": "2026-10-13T00:00:00Z",
  "items": [
    {
      "kind": "plugin",
      "id": "hello",
      "name": "Hello",
      "name_i18n": { "fr": "Bonjour" },
      "version": "1.0.0",
      "author": "Me",
      "description": "Says hello",
      "tags": ["demo"],
      "game": "DCS World",
      "download": {
        "url": "https://example.org/p/hello.bmmplug",
        "sha256": "6666666666666666666666666666666666666666666666666666666666666666",
        "size": 1234
      }
    }
  ],
  "catalogs": [
    { "kind": "preset", "url": "https://example.org/presets.json", "name": "Presets" }
  ]
}
```

`format` and `format_version` are what make the document say what it is. The key is
`format_version`, not `version`, on purpose: every older catalogue already uses `version` for
the **publisher's** version of the document (`"1.0"`), which is the confusion `repo.json` had
before its own format 1.0 (see [the repo format](doc-page:reference/repo-format)). A converted v1 document keeps
that value as `catalog_version`.

### Top level

| Field | Required | Meaning |
|---|---|---|
| `format` | yes | Always `"bmm-catalog"`. |
| `format_version` | yes | An integer. BMM reads `1`. A higher number is refused (`format.too_new`). |
| `name` | recommended | The catalogue's name. |
| `name_i18n`, `description_i18n` | no | Translations: a map of language tag to text (`{ "fr": "…" }`). |
| `id`, `description`, `publisher`, `homepage`, `app`, `updated_at` | no | Metadata. `app` says which Better* product it is for (`bmm`). |
| `items` | yes, unless `catalogs` is given | The things to install. |
| `catalogs` | no | Links to other catalogues (this makes the document an index too). |
| `partner_catalogs`, `community_imports` | no | Kept from v1 app catalogues; the app catalogue reads them. |

### An item

| Field | Required | Meaning |
|---|---|---|
| `kind` | yes | `app` · `plugin` · `theme` · `preset` · `modpack` · `repo` · `tutorial` · `list`. |
| `id` | yes | Stable identifier. `kind` + `id` (case-insensitive) is unique in a catalogue; a duplicate is a warning and the first one wins. |
| `name`, `name_i18n` | recommended | Display name and its translations. |
| `summary`, `description`, `description_i18n` | no | A one-line summary; a longer description (B.MD). |
| `version`, `author`, `tags`, `game`, `icon`, `homepage`, `source_url`, `license`, `compatibility` | no | Metadata. |
| `download` | yes for every kind except an inline theme and a packed modpack | `{ url, sha256, size, file_type }`. For `repo`, `url` is the repo address. |
| `versions` | no | Older versions with their files (`{ version, published_at, changelog, files: [{ name, size, sha256, url }] }`), as BetterCommunity v2 publishes them. |
| `extra` | no | Kind-specific fields kept verbatim: an app's `category`, `price`, `requirements`, `images`; a theme's inline `vars`; a modpack's `mods` count or `.cbmp` `file`; a preset's `tasks` count. |

`download.url` is an `https://` (or `http://`) address, or a name relative to the catalogue's
own address (`themes/aurora.bmmtheme`) so a folder can move hosts without being rewritten.
Any other scheme (`javascript:`, `file:`, `data:`) is an error. `download.sha256` is 64
lower-case hex digits; `sha256:ABC…` is accepted and normalised. A plugin without one is not
installed by BMM 1.1 and later.

---

## 2. Every shape BMM reads, and what it becomes

BMM detects the shape of a document, never its address. Each variant is converted to the
universal document above; the existing reader of each kind then gets **its own v1 view** of
it, so a universal catalogue appears in the plugin browser, the theme gallery and every other
screen without those screens changing.

| Variant | How it is recognised | Becomes |
|---|---|---|
| Universal | `format: "bmm-catalog"` | Itself (hashes lower-cased). |
| v1 apps | `apps: [...]` | `kind: app`; `title` → `name`, `download.*` kept, `images.thumb` → `icon`, the rest → `extra`. |
| v1 plugins | `plugins: [...]` | `kind: plugin`; `download_url` + `sha256` → `download`, `icon_url` → `icon`. |
| v1 themes | `themes: [...]`, or a bare array whose entries carry `vars` | `kind: theme`; `download_url` or `url` → `download.url`; inline `vars` → `extra`. |
| v1 presets | `presets: [...]` | `kind: preset`; `tasks` → `extra.tasks`. |
| v1 modpacks | `modpacks: [...]` (also inside a `.cbmp`) | `kind: modpack`; `file` (packed) and `mods` → `extra`. |
| v1 repos | `repos: [...]`, or a bare array of `{name,url}` | `kind: repo`; `url` → `download.url` and, without an `id`, the id. |
| v1 tutorials | `tutorials: [...]` | `kind: tutorial`. |
| v1 mod lists | `lists: [...]` | `kind: list`; `downloadUrl` is accepted. |
| BCWEB pooled items | `items: [{ kind, …, meta }]` | The kind of each entry; `meta.download_url` lifted. |
| BCWEB v1 `catalog.json` | the v1 shapes above | As above. |
| Catalogue index | `catalogs: [{ type, url }]`, `kind: "catalog-index"` | `catalogs: [{ kind, url, … }]`, no items. See [the catalogue index](doc-page:reference/catalog-index). |
| BC v2 compat `catalog.json` | the v1 shapes above | As above (v2's compat layer emits them). |
| BC v2 feed | `kind: "catalog"` + `catalog` + `items` | Template → kind (`mods`→`app`, `plugins`→`plugin`, `themes`→`theme`, `presets`→`preset`, `resources`→`modpack`, `tutorials`→`tutorial`, `links`→`list`). The item id is the **slug**, as v2's compat feed uses, so one item read through both doors is one item; v2's own id is `extra.external_id`. The latest version's first file is `download`; every version is in `versions`. |
| BC v2 feed index | `kind: "index"` + `catalogs[].feed_url` | `catalogs: [{ kind, url: feed_url, … }]`. |
| DSSE envelope | `payloadType` + `payload` + `signatures` | Verified, then its payload is read as any of the above. |

A document carrying the same entry under two arrays (tutorials do, `tutorials` and `items`)
yields it once.

---

## 3. Signatures

A catalogue may be signed. The envelope is **DSSE v1**, exactly as BetterCommunity v2 signs its
feeds (`/v2/feeds/catalogs/{c}`, ADR 0010 §2):

```json
{
  "payloadType": "application/vnd.bettercommunity.catalog-feed+json; version=1",
  "payload": "<base64 of the exact JSON bytes>",
  "signatures": [ { "keyid": "feed_…", "sig": "<base64 of a 64-byte Ed25519 signature>" } ]
}
```

- The signature is Ed25519 over **PAE**: `"DSSEv1" SP LEN(type) SP type SP LEN(body) SP body`,
  lengths in bytes, in ASCII decimal. It covers the bytes served, so nothing is re-serialised
  before checking.
- Two payload types are accepted: v2's feed type above, and
  `application/vnd.bettermodsmanager.catalog+json; version=1` for a signed universal catalogue.
- 1 to 4 signatures. A `keyid` is a hint, never trusted: every signature is tried against every
  candidate key.
- Keys are raw 32-byte Ed25519 public keys, base64 — the form `/v2/feeds/keys` publishes.

The test suite signs its fixtures with Node's `crypto` (what v2 uses) and verifies them with the
Rust reader, so the two agree on the bytes, not only on the idea.

### What BMM reports

| Status | When | What BMM does |
|---|---|---|
| `unsigned` | Not an envelope. | Reads it — most catalogues are unsigned. |
| `verified` | A signature verifies against a trusted key. | Reads it. |
| `unknown_key` | Signed, by no key BMM trusts (or no key is trusted at all). | Reads it **as unverified**, with a warning. It is no worse than an unsigned copy. |
| `invalid` | Malformed envelope, unknown payload type, a signature that names one of our keys and does not verify, or a source whose key is pinned and the document is not signed by it. | **Refuses it.** Nothing from it is shown or installed, and the last good copy stays. |

### Trusted and pinned keys

Keys are kept in `catalog-keys.json` in the app data folder (command `catalog_keys`). A key
with an `issuer` is **pinned**: every catalogue that issuer covers must be signed by it, and an
unsigned copy is refused like a forged one — that is how a downgrade is caught. An issuer is an
origin (`https://bettercommunity.ch`, covering the whole server) or an origin with a path scope
(`https://bettercommunity.ch/v2/feeds/`, covering only the addresses under that path — a whole
path segment, so `/v2/feedsX` is not covered).

`catalog_keys` with `op: "fetch"` and `issuer` set to a BetterCommunity v2 root reads
`{root}/v2/feeds/keys` once and pins what it publishes to `{root}/v2/feeds/`. Scoped, not the
whole origin: the same server also serves the unsigned v1-compatible `catalog.json`, which must
stay readable.

Nothing is trusted by default: v2 makes its feed key on first use, so there is no key to ship.

### BetterCommunity v2 mode

With `BCApiVersion=v2` in `app.cfg` (see [app.cfg](doc-page:reference/app-cfg)), BMM reads the v2 signed feeds:

- **Settings → Catalogue index** offers the signed index of public catalogues
  (`{root}/v2/feeds/catalog`) when its address field is empty. Each entry it lists is a signed
  feed `{root}/v2/feeds/catalogs/{slug}`, followed like any other catalogue.
- The first time a signed feed of that root is read, BMM fetches and pins its keys (trust on
  first use). From then on a feed from `{root}/v2/feeds/` that is unsigned, tampered with or
  signed by another key is **refused**; the catalogue screens keep their last good copy.
- A server that publishes no key leaves its feeds readable as `unknown_key`, flagged.

Without the switch (every install by default) nothing of this runs: no key is fetched, no
address changes.

---

## 4. Validator and converter

| Command | Does |
|---|---|
| `catalog_validate { text \| path, kind?, sourceUrl? }` | Which variant, the signature status, item counts per kind, and every issue with a JSON path (`$.items[2].download.url`), a severity (`error` · `warning` · `info`) and a stable code (`url.scheme`, `download.bad_sha256`, `item.duplicate`, …). |
| `catalog_normalize { text, kind?, sourceUrl?, keys? }` | Any variant → the universal document, with the same report. |
| `catalog_convert { path, out?, dryRun?, kind? }` | Writes the universal document (default `<name>.universal.json` beside the input; an existing output is kept as `.bak`). A signed input is converted from its verified payload and written unsigned; a refused one is never written. |
| `catalog_verify_signature { text, keys?, sourceUrl? }` | The signature check alone. |
| `catalog_keys { op: list \| add \| remove \| fetch, issuer?, keyid?, publicKey?, label? }` | The trusted keys. |

The **Tools** hub's validator, mode « Catalogue », calls `catalog_validate` with the pasted text
or the chosen file and lists every error and warning with its path; the summary names the
variant and, for a signed document, the signature status.

---

## 5. The catalogue index and its cache

Catalogues are fetched through an HTTP cache that survives a restart (`catalog_fetch`):

- the `ETag` and `Last-Modified` of the last good answer are sent back, and a `304` reuses the
  stored copy;
- a server that is down, or answers 5xx, serves the last good copy, marked `stale`, with the
  error beside it — one failing source never empties a list nor blocks the others;
- `403`, `404` and `410` forget the copy: the server said it is gone;
- `catalog_cache_status` lists every source: last success, last error, consecutive failures,
  size and SHA-256.

On top of it, the catalogue index merges every followed catalogue: entries with the same kind
and id, or the same file (download SHA-256) under two ids, are **one** entry listing every
source. Search folds case and accents (« eclair » finds « Éclair »), matches word prefixes,
requires every word, and ranks the name above the id, tags, author and description. A refresh
only fetches sources older than their TTL.
