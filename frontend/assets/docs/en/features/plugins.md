# Plugins & API


> Extend BMM with community plugins and automate actions.

If BMM doesn't do the thing you need, this is where the thing gets added — without waiting
for a release.

![The Plugins screen](assets/docs/media/screens/plugins.annotated.png)

| | | |
|---|---|---|
| **1** | **Installed** | Your plugins. |
| **2** | **Browse** | Community plugins. |
| **3** | **API** | The endpoints a plugin can call. |

!!! warning "Community plugins are not reviewed"

    BMM says it plainly on the banner: these plugins are created by the community and are
    **not officially reviewed**. Install from people you have some reason to trust, the same
    way you'd treat any other executable.

    They are, however, **bounded**: a plugin acts through the [API](doc-page:reference/api) with
    its own token, and only does what you've granted it. Review those grants in
    **Plugins → Permissions**.

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/plugins.bmmreplay" data-page="features/plugins" data-title="Granting a permission and using a plugin"></div>


## What you can grant a plugin

Ten grants, and most of them are **write** capabilities — the power to *change* something.

There is no `mods.read` or `profiles.read` to hand out, because those read endpoints are not
permission-gated at all: the API listens on `127.0.0.1` only, so a plugin that already has
your token can read your mods and profiles. Reads that *do* need a grant are the three below
— `app.read`, `catalog.read`, `plugins.read`.

| Grant | Lets the plugin |
|---|---|
| `mods.write` | Enable / disable / edit / delete mods |
| `profiles.write` | Create / activate / edit / delete profiles |
| `modpacks.write` | Create / enable / disable / edit / delete modpacks |
| `repo.write` | Connect / disconnect / sync / generate server repos |
| `plugins.read` · `plugins.write` | Compare a modlist · apply one |
| `app.read` · `app.write` | Read installed apps · install / launch / uninstall them |
| `catalog.read` · `catalog.write` | Read the local catalog · create / edit / delete entries |

Grant the narrowest set that does the job. A plugin asking for `repo.write` when all it does
is toggle mods is worth a second look.

!!! tip "The API isn't only for plugins"

    The same local API answers your own scripts, a `.bat` file, PowerShell, or a `bmm://`
    deeplink on a web page — anything on your PC. The **global** switches in
    **Plugins → Permissions** (and the sandbox mode in [Settings](doc-page:features/settings)) govern *all*
    of those callers at once, not just installed plugins.

## Strict mode

Some plugins apply a list of mods. *Strict* decides what happens to everything else:

> This plugin will disable all mods not in the list.

Non-strict adds; strict makes your setup **match** the list exactly. BMM asks before doing
it, and shows you which mods it's about to turn off — read that list rather than clicking
through it.

## Scheduling & automation

Reachable from here, and the reason the API exists:

> Schedule BMM actions (one-time or recurring) — activate a mod, modpack, profile…

A task can run **even when BMM is closed** (it registers with the OS scheduler). Rules are
evaluated top to bottom and *the first matching row wins* — so order your rules from most
specific to most general, exactly like a firewall.

## What a plugin is, on disk

A plugin is a folder with a manifest. Nothing is compiled, nothing is installed into BMM — you
can read one in a text editor, and so can the person you send it to.

| Field | What it does |
|---|---|
| `id`, `name`, `version`, `author` | Identity. `id` is what BMM deduplicates on |
| `description`, `website`, `tags`, `game` | What the catalogue shows |
| `permissions` | The capabilities it asks for. This is the whole of what it may do |
| `modlist` | The mods it wants present, with versions |
| `scripts` | External scripts it ships, as paths inside its own folder |
| `has_scripts` | Declares that it contains scripts, so activation can warn you first |
| `folders` | Folders bundled under `bundle/` |
| `apply_mode` | `modlist`, `script`, or `both` — what applying it actually does |

`apply_mode` is the field worth reading before you trust one. A `modlist` plugin only asks BMM
to enable a set of mods; a `script` plugin runs a program on your machine. Running scripts is
gated behind its own permission, and activating a plugin that declares them asks first — but
the manifest tells you which kind you have *before* you install it.

!!! note "There are no plugin-defined commands"
    A plugin cannot add its own entry to the command palette or invent a new action. Its whole
    surface is the list above: a set of mods, optional scripts, and the permissions it was
    granted. Anything else it does, it does through the API like any other client.

## The full reference

Everything a plugin — or a script, or an AI assistant, or `curl` — can call is listed in one
place, generated against the code:

- **[API & deeplink reference](doc-page:reference/api)** — every HTTP endpoint and every `bmm://`
  link, with the response shape, which ones need a token, and which ones ask before acting.
- **[Actions reference](doc-page:reference/actions)** — every action BMM can perform for you,
  including the ones the scheduler can run.

Both are worth skimming once even if you never write a plugin: they are the clearest inventory
of what BMM can be made to do.


## Files a plugin ships — `assets/`

A plugin could already carry two kinds of extra: **scripts**, declared so they can be run,
and **`bundle/`** folders, copied into the game. Everything else an author actually hands
people — a README, a config template, a sample `.mm`, a spreadsheet of codes, a small tool —
had nowhere to go. It went in a Discord message.

Put it in `assets/` inside the plugin:

```
my-plugin/
  plugin.json
  assets/
    README.md
    setup.ps1
    docs/codes.csv
```

The paperclip on the plugin's card opens it. A README opens by itself; other documents,
`.json`, `.csv` and scripts are shown as text; images are shown; anything else offers
**Save a copy…**.

!!! note "The folder is the truth, not the manifest"

    `plugin.json` gains an `assets` list, and it is **written from disk when the plugin is
    packed** — an author who adds a README and forgets to edit the manifest would otherwise
    publish a file list that is a lie.

    The installed copy still reads the folder. A plugin whose manifest names a file that is
    not there shows nothing rather than an entry that fails to open, and one carrying a file
    its manifest never mentioned still shows it — which is the case that matters, because a
    surprise file is the one somebody should see.

    The declaration exists for readers who have only the manifest: BetterCommunity's
    inspector, a moderation queue, a catalogue entry. Paste a `plugin.json` into **Inspect a
    BMM file** and it now lists what the plugin ships, and names any script among them.

!!! warning "Nothing in `assets/` runs on its own"

    A script asset is listed, marked as a script, and its **folder** opens — never the file,
    because opening a `.ps1` hands it to whatever the OS runs `.ps1` with, and that is not
    what "show me this" means.

    Running one is a scheduled task's decision, below.

### From an automation

The **Use a file a plugin ships** action (`plugin.asset`) has four modes.

| Mode | What it does |
|---|---|
| **Read it into a variable** | The whole file, as text, into `{text.<name>}`. |
| **Copy it somewhere** | Into a folder you pick. Never overwrites — a name already taken becomes `name (2).ext`. |
| **Open its folder** | The folder, not the file. |
| **Run it (script)** | Read, and handed to PowerShell / cmd / bash / Python. |

**Read** is the one worth reaching for. A plugin ships the list of squadron codes, or the
config template, or the server address — and the task reads it from the plugin instead of
that value being typed into the task, where it drifts the first time the plugin updates.

!!! danger "Run needs the task's own script permission"

    Not the plugin's, and not a setting about plugins: the **task's**. Whether *this
    automation* may run programs is a question you answered once, in writing, on the task —
    and that answer governs a shipped script exactly as it governs a typed one. Without it
    the step refuses out loud rather than skipping, because a silent skip would look like the
    plugin shipping a broken file.

    The engine comes from the extension unless you say otherwise. Nobody ships `setup.ps1`
    and means "run this with Python".


### From a script, the CLI or an assistant

```bash
bmm plugin-assets dcs-helper
bmm plugin-asset dcs-helper README.md
```

Both work with **BMM closed** — `data.json` says where the plugin is and the folder says what
is in it. That matters here: the reason to ask what a plugin ships is usually that you are
deciding whether to install it, which is not a moment when the app is open on that screen.

`GET /api/plugins/assets?id=…` does the same over HTTP (`plugins.read`), and `&path=…`
returns one file's text. The MCP tools are `bmm_plugin_assets` and `bmm_read_plugin_asset`.

!!! note "Copying one OUT is not exposed"

    A caller that named both the source and the destination would be a file-copy primitive
    with BMM's privileges. Anything able to call these can already read the bytes and write
    them wherever it likes with its own hands, so the endpoint would add reach without adding
    ability.
