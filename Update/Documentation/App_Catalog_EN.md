# App Catalog

The **App Catalog** page lets you discover, install, launch and update companion apps and tools directly from BMM.

## Sources

The catalog aggregates several source types:

| Source | Description |
|---|---|
| **Official** | Maintained by the BMM team |
| **Partner** | Trusted third-party catalogs |
| **Community** | Any catalog URL you add yourself |

A source is a plain **JSON file** (see *app-catalog format* in the developer docs) listing apps with name, description, icon, download URL, version and optional checksums. You can add or remove community sources from the catalog settings.

> ⚠️ Only add sources you trust — installing an app runs its installer/executable on your machine.

## A catalogue can carry its apps

A source is usually a JSON file at an address. It can also be a **`.bmmbundle`** — a zip with
`catalog.json` at its root and the payloads beside it. **Sources → Follow a .bmmbundle…**
follows one from disk: one file to be sent, nothing to host, and nothing that has to still be
online next year.

The two mix inside one document, per entry: a catalogue can carry the three small tools and
link the 90 MB one somebody already hosts.

A payload that travelled inside a bundle goes through the **same checksum gate** as one
fetched over the network. It is not more trusted; it is just closer. An entry in a bundle may
only name a neighbouring file — absolute paths, drive letters, UNC paths, `..` segments and
every scheme that is not http(s) are refused.

## What the checksum is of

It is the sha256 of **the bytes at the download URL** — the installer if the entry points at
one, the zip if it points at a zip. It is *not* the hash of the app once installed: nothing
has been installed at the moment BMM checks it. The payload is hashed while it streams into a
`.part` file, and a mismatch means it is never renamed and never run.

The browse card says which entries publish one. A missing checksum is common and proves
nothing by itself, so it is a quiet outline rather than an alarm — but between two entries
offering the same app it is the difference worth seeing before you click.

## http is allowed, and shown

Plenty of small catalogues are served from a machine with no certificate, and refusing them
only means the entry never reaches anybody's list. So `http://` works — and wears an amber
`http` marker in **Sources**, on the card, and on the entry while you write it.

Over plain http whoever is on the path serves what they like, **including a different
installer and a checksum that matches it**. That is why the two markers are read together: a
green "checksum" beside an http address is the most misleading row on the screen, and it says
so.

## Publishing one

In **Create**, an entry takes an address *or* a file. Hand over a file and BMM fills in the
type from its extension and the size and checksum from its bytes. **Publish as one file
(.bmmbundle)** copies every handed-over file beside the document and zips it.

The absolute path of the file you picked never reaches the published document.

## Installing & launching

- Click **Install** on a card: BMM downloads the app, verifies it when a checksum is provided, and tracks the installed version.
- Installed apps show a **Launch** action directly on their card.
- When the source publishes a newer version, the card offers an **Update**.
- Uninstalling removes the tracked files.

## Executable detection

For apps installed outside BMM, the catalog can **detect existing executables** so a card switches to "installed" instead of proposing a duplicate download.

## Troubleshooting

- *"App catalog sources failed"* in the logs means one of your configured source URLs is unreachable (typo, offline server, placeholder URL). Remove or fix the source in the catalog settings.
- Downloads honour BMM's disk I/O limits and can be cancelled like any other transfer.
