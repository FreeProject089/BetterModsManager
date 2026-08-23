# The catalogue index format


A **catalogue** lists things to install. An **index** lists catalogues.

Without one, following a community means finding a URL for their apps, another for their
plugins, another for their themes, and pasting each into a different screen. An index is a
single address that brings in all of them, and keeps working when they publish a new one.

Everything below is taken from `frontend/src/features/catalogs/catalog-index.ts` (the
reader) and `BCWEB/apps/api/src/routes/catalogs.mjs` (the generator). Where they disagree
with this page, they are right and this page is a bug.

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
      "url": "https://example.com/plugins.json",
      "owner": "Someone",
      "items": 12,
      "updatedAt": "2026-08-13T09:20:00.000Z",
      "sha256": "9e2daaa8…"
    }
  ]
}
```

Only `catalogs` is required, and inside each entry only `type` and `url`. Everything else
improves what the preview can show you; none of it changes what happens.

| Field | Required | Meaning |
|---|---|---|
| `type` | yes | `app`, `plugin`, `theme`, `preset` or `repo` |
| `url` | yes | the catalogue itself, `http`/`https` only |
| `app` | no | `bmm`, `bsm`, `installer` — which product it is for |
| `name` `description` `owner` | no | shown in the preview |
| `items` | no | how many things are in it |
| `updatedAt` | no | when it last changed |
| `sha256` | no | fingerprint of its contents |
| `official` | no | **ignored** — see below |

## What the reader refuses, and why

These three are not validation for its own sake. Each one exists because the alternative
does something worse than failing.

**`official` is dropped, always.** BMM decides trust from the address a catalogue was
fetched from — `apply_trust` in `src-tauri/src/commands/apps.rs` overwrites whatever an
app catalogue claims about itself. An index able to grant that badge would be a way around
that rule rather than a part of it, so the field is discarded even when present.

**An unknown `type` is dropped, never guessed.** `plugins` looks like `plugin`. Guessing is
how a preset catalogue ends up in the themes list.

**Anything that is not `http` or `https` is dropped.** An index is a list of addresses
handed to a fetcher. A `file://` entry is refused rather than passed along in the hope that
it fails later.

Everything dropped is counted and shown in the preview. You are told, not quietly given
less than the file contained.

## `app`, and why absent is not the same as wrong

An index may list catalogues for several Better\* products. BMM keeps an entry when its
`app` says `bmm`, **or when it has no `app` at all**. An entry saying `bsm` is dropped,
with a reason.

The asymmetry is deliberate. Absent means "the publisher did not say", which is the state
of every catalogue written before the field existed — dropping those would empty the index
for exactly the people who have used it longest. An explicit mismatch is a statement; a
missing value is not.

## Where each type goes

| `type` | Lands in |
|---|---|
| `app` | App Catalog → Sources |
| `plugin` | Plugin catalogues |
| `theme` | Theme catalogues |
| `preset` | Scheduler → *From a catalogue…* |
| `repo` | Browse Server-Repos |

A `repo` entry points at a `repos.json`-shaped document — see
[the repo format](doc-page:reference/repo-format). Entries it brings in are tagged **community** by BMM
whatever the file claims, for the same reason `official` is ignored.

!!! note "Two words that mean two things"

    A **preset** is a BMM automation here — a `.bmmpa` file. BSM uses the same word for an
    audio preset, and both publish as `kind=PRESET` on BetterCommunity; `app` is what tells
    them apart.

## Reading one

**Settings → Catalogue index.** Paste the address and press **Preview**: it reports what it
would add, how many you already follow, and how many entries it refused. Nothing is
imported until you press Import.

Several indexes can be followed at once. Each catalogue in your lists shows which index
brought it in, so you can stop following one without hunting for its entries.

Paste an index into an ordinary "add a source" box by mistake and BMM notices and points
you at Settings. It does not add it there: importing an index adds several sources at
once, which is a larger action than the one you asked for.

## A catalogue on an SSH server

A source URL can be `ssh://<target>/<path>` instead of `https://…`, for a catalogue of any
type — app, plugin, theme or preset. `<target>` is the name of an SSH target saved in **Server
Repo → Publish over SSH**; `<path>` is the file under that target's remote folder.

```
ssh://prod/catalogs/plugins.json
ssh:///catalogs/plugins.json      # three slashes = the target named "default"
```

The URL carries no host, user or key on purpose — those live in the saved target, so a
catalogue URL you paste, share or receive can never point BMM at a machine of its choosing.

Only BMM reads these: the URL means nothing to a browser, and nothing to BetterCommunity.
Which keys work, and how the public half reaches the server, is covered in
[Server Repo](doc-page:features/repo#which-ssh-keys-work).

## A catalogue behind a password

A catalogue hosted on BetterCommunity can carry a **download password**, set by its owner from
the dashboard. BMM asks for it the first time the catalogue answers `401`, remembers it for as
long as the app is running, and never writes it to disk — so it is asked once per session, not
once per fetch.

It is the same mechanism a password-protected Server Repo uses (`X-Repo-Password`, or
`?password=` for a browser), which is why nothing had to change in how you subscribe.

## Publishing one

Serve the JSON at a stable `https` address. No account, no registration — an index is
recognised by its shape. `kind: "catalog-index"` is enough on its own, but a document with
a `catalogs` array of `{type, url}` entries is recognised without it.

BetterCommunity publishes its own from one generator at several addresses; `scope`, `app`
and `type` combine:

```
https://bettercommunity.ch/api/catalogs.json
https://bettercommunity.ch/api/catalogs.json?scope=official
https://bettercommunity.ch/api/catalogs.json?scope=community
https://bettercommunity.ch/api/catalogs.json?app=bmm
https://bettercommunity.ch/api/catalogs.json?type=plugin
```

Two things worth knowing about that feed specifically: BetterCommunity's own entries carry
no `items`, `updatedAt` or `sha256` — those appear on community entries only — and a feed
is listed only when something is actually published in it, because an index entry leading
to an empty document teaches people to stop trusting the index.
