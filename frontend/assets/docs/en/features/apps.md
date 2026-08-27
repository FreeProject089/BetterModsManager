# App Catalog


> Browse & install apps in one click.

The tools *around* modding — the ones you'd otherwise hunt down on five different sites. The
App Catalog lists companion apps and utilities, installs them for you, keeps track of the
version you have, and launches them — without you managing downloads by hand.

![The App Catalog](assets/docs/media/screens/apps.annotated.png)

| | | |
|---|---|---|
| **1** | **Catalog** | What's available. |
| **2** | **Install** | One click. |
| **3** | **Sources** | Where the catalog comes from. |

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/apps.bmmreplay" data-page="features/apps" data-title="Installing an app from the catalog"></div>


## Reading a card

Each app shows the essentials at a glance: a thumbnail, its **category** (game, utility, or
other), a **price** tag (free, freemium, or paid), a short description, its version, and up to
three tags. Trust badges sit alongside the name:

| Badge | Meaning |
|---|---|
| **Official** | The entry comes from BMM's own catalog. |
| **Partner** | The entry comes from a catalog the official one vouches for. |
| *(none)* | A community or self-added source — fine to use, just not vouched for. |

These badges are assigned by BMM based on **where the catalog came from**, never by what the
JSON claims — a community catalog can't badge itself "Official".

## Installing

Click **Install** and BMM downloads the app, **verifies it against the publisher's checksum
when one is provided** (a mismatch is flagged and the install is blocked by default, so a
tampered or corrupted download doesn't run), and records the installed version so it can offer
updates later.

What "install" means depends on the download's type:

| Type | What BMM does |
|---|---|
| `zip` | Extracts it. If the archive *is* the app → portable, BMM picks the main executable. If it only contains an installer (`setup.exe`, `*install*`, `.msi`) → BMM runs that installer and auto-detects the result via the Windows registry. |
| `exe` | If the filename looks like an installer (`setup`, `install`) → runs it, then auto-detects the installed app through the registry. Otherwise treated as a portable executable. |
| `msi` | Runs it via `msiexec`, then auto-detects through the registry. |
| `script` | Saves it and sets it as the launch target. Launching runs it with the right interpreter: `.ps1`→PowerShell, `.bat`/`.cmd`→cmd, `.py`→python, `.vbs`→wscript, `.sh`→bash. |

For any installer path, BMM snapshots your install folders and the registry *before* running
it and diffs afterwards — that's how it finds the real executable and the matching uninstaller
with zero clicks from you beyond the app's own wizard.

!!! warning "Installing runs code"

    An app entry points at an executable or installer that runs on your machine. Only install
    from sources you trust — the **Official** and **Partner** badges exist precisely so you can
    tell at a glance which entries are vouched for.

!!! question "The checksum is of the download, not of the installed app"

    It is the sha256 of **the bytes at the download URL** — the installer if the entry points
    at one, the zip if it points at a zip. Nothing has been installed yet at the moment the
    check happens, which is the whole point: BMM hashes the payload while it streams to a
    `.part` file and refuses to rename or run it on a mismatch.

    So a catalogue's checksum changes whenever the publisher re-uploads the file, and it says
    nothing about what ends up in `Program Files` afterwards.

    The browse card says which entries have one. A missing checksum is common and proves
    nothing by itself, so it is a quiet outline rather than an alarm — but between two entries
    offering the same app, it is the difference worth seeing before you click rather than in a
    warning after.

## Launching

Installed apps show a **Launch** action on their card. Most apps launch straight away. When an
app ships more than one runnable file, BMM asks rather than guessing:

> This app contains several executables. Pick the one to launch, or keep BMM's auto-detection.

Pick explicitly when an app ships a launcher *and* the real binary — auto-detection is right
most of the time, not all of it.

## Updating & uninstalling

When a source publishes a newer version than the one you have, the card offers an **Update**.

Uninstalling depends on how the app got there:

- **BMM-managed** installs (BMM created the folder) are removed cleanly — the folder goes.
- **Externally-installed** apps (a setup wizard put them somewhere of its own) are removed via
  the app's own uninstaller when BMM found one; otherwise BMM just drops its reference and
  leaves the files, so it never deletes something it didn't create.

## Executable detection

For apps you installed **outside** BMM, the catalog can detect the existing executable and
switch the card to "installed" instead of proposing a duplicate download — so a tool you
already have doesn't show up asking to be fetched again.

## Favorites & history

Two tabs that are easy to miss because nothing points at them.

**Favorites** is the star on any card — it collects the apps you keep coming back to, drawn
from the catalogue, so the list survives uninstalling and reinstalling.

**History** is every install, update and removal this machine has done, newest first. Useful
for the question "what did I change just before this broke", which is otherwise unanswerable.

## Adding a source

> Add raw JSON URLs of community catalogs.

A catalog is just a JSON file someone hosts. Open **Sources**, paste a catalog URL, and its
apps merge into the list; remove any that fail to load. The official catalog can also
**auto-import** community catalogs, so you often don't need to add anything by hand. Chains of
imported catalogs are followed up to a total of **30 sources**, so a big community web of
catalogs stays bounded.

## Making your own

When you add an app, **Fetch from the URL** reads the file people will actually download and
fills in the size and the checksum. *From a local file…* does the same for the installer you
have in front of you and have not uploaded yet — it is the same bytes, so it is the same hash.

Both were free-text fields before, which left two honest outcomes: empty (no integrity check
at all) or mistyped (every install refused).

**http is allowed, and shown.** Plenty of small catalogues are served from a box without a
certificate, and refusing them only means the entry never reaches anybody's list. What is
not acceptable is that being invisible: over plain http whoever is on the path serves what
they like — including a different installer *and* a checksum that matches it. So an `http`
address wears an amber `http` marker wherever it appears: in **Sources**, on the browse card,
and on the entry while you are writing it. The probe says the same thing about a checksum it
just read over http.

Only `http` and `https` are read at all. `file://` and the rest are refused rather than
marked — they are not a weaker way of doing this, they are a different thing.

An entry only needs an `id`, a `title` and a download URL. Everything else has a default now —
`tags` without one used to make serde refuse the entry, which made `fetch_app_catalogs` refuse
the whole **catalogue**, which the browser only mentioned if *every* source had failed.

> Build a `catalog.json` you can host on GitHub and share with others.

If you maintain a set of tools for a game or a community, this is how you hand them over as one
list instead of ten links. A catalog is a plain JSON file: catalog-level metadata plus an
`apps` array, where each app carries an id, title, category, price, tags, and a `download`
block (URL, file type, optional size and SHA-256). Host the raw file anywhere public and share
its URL, or host it on BetterCommunity as a public or invite-only catalog.

See the developer reference *app-catalog format* for the full schema and the `file_type`
behaviour table.
