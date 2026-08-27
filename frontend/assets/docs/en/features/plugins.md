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

Twenty-six grants, in twelve domains, and each domain splits **read** from **write** —
knowing is not the same permission as changing.

| Domain | Read | Write |
|---|---|---|
| Mods | list mods, see which one wins a shared file | enable, disable, update, delete, reorder |
| Profiles | list profiles | create, edit, delete, activate |
| Modpacks | list and export | create, change, apply, delete |
| Plugins | list plugins, compare a modlist, read shipped files | install, apply, **delete** — including others |
| Server repo | see what is connected and what it holds | connect, sync, publish, host |
| Identity keys | see which keys exist | **mint one** |
| Apps | list installed apps and their permissions | install, launch, remove |
| App catalogue | read the local catalogue | add, change, remove entries |
| Your data | read **everything** BMM holds, and export it | import over what you have |
| Automations | list saved tasks | run one, arm or disarm one |
| Hooks | see what has fired | fire one a task may be waiting on |
| The app itself | — | restart BMM, change the open screen, benchmark, import a language |
| Session recordings | list them, and export one — a recording shows the screen, paths and names included | start and stop recording, import one and play it, delete one |
| Privacy | — | change what is recorded and what is sent |

Grant the narrowest set that does the job. A plugin asking for `repo.write` when all it does
is toggle mods is worth a second look, and one asking for `data.read` is asking to read
everything at once.

!!! warning "Reads used to be ungated, and now are not"

    Fifty routes needed a token and no permission at all — and a per-plugin token is a valid
    token, so a plugin with an **empty** permission list could read the full data dump,
    import data over it, restart BMM, delete other plugins and run any saved automation.

    On upgrade each plugin keeps the read half of every domain it already had write on:
    trusted to change your mods means still able to list them. Nothing else is carried, so a
    plugin leaning on a domain it was never granted now fails with a `403` naming the scope
    — which is one click from granted, in **Plugins & API → Permissions**.

!!! danger "The permission list itself is not something a plugin can touch"

    `PUT /api/apps/permissions/<id>` writes the grants, and it takes the **admin** token. A
    plugin that could set its own permissions could grant itself all twenty-six, which would
    make this page a description of nothing.

!!! tip "The API isn't only for plugins"

    The same local API answers your own scripts, a `.bat` file, PowerShell, or a `bmm://`
    deeplink on a web page — anything on your PC. The **global** switches in
    **Plugins → Permissions** (and the sandbox mode in [Settings](doc-page:features/settings)) govern *all*
    of those callers at once, not just installed plugins.

## Declaring what your plugin needs

The **Create** tab has a *What it needs* section. Ticking a scope there does not grant it —
it **asks**. Whoever installs the plugin sees the request pre-ticked on the permission screen
and decides.

Ask for the least that works. A plugin that requests everything is a plugin whose list nobody
reads.

The same tab now writes three fields it used to leave empty no matter what you typed:
**author**, **website** and **tags** — the plugin card renders tags, so it was drawing a row
that nothing could fill. And the **id** is checked as you type: it becomes a folder on disk,
a segment of a `bmm://` link and a key in a catalogue, so a space in it fails three different
ways and used to do so silently.

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

## Automations a plugin ships — `automations/`

A plugin can carry `.bmmpa` files. **Import an automation…** in the plugin editor puts one in,
and the fourth apply mode — **Set up its automations** — makes installing the plugin set them
up.

```
my-plugin/
  plugin.json
  automations/
    nightly-tidy.bmmpa
```

This exists because of what people were shipping instead: a `.bat`, and a message telling you
where the folder is. A script is opaque — BMM cannot say what it does, cannot show it, and
cannot take anything away from it, so the only honest thing to do with one is warn you about it.

An automation is the opposite. It has steps, permissions and a trigger, all of which can be
shown before anything happens, and all of which can be **taken away**.

!!! danger "What a shipped automation cannot do"

    Every one arrives through the same gate as any other `.bmmpa`: **disabled**, and stripped
    of the four capabilities that reach outside BMM — running programs, running scripts, firing
    deeplinks, stopping processes.

    Those are granted by the person who will live with them, never by the plugin's author. A
    plugin is a file from a stranger like any other.

    That is exactly what makes **Set up its automations** able to offer running them straight
    away: a task that cannot start a program has a worst case of changing something inside BMM
    that you just asked for by applying the plugin. Without the stripping, the same button would
    be arbitrary code execution on install with a friendly label — so the confirmation says out
    loud what the tasks cannot do rather than asking you to take it on faith. They stay switched
    off afterwards either way.

Applying a plugin for its **mod list** imports its automations too, and never starts them:
somebody who applied a mod list asked for a mod list.

!!! note "Checked when it goes IN, not when it comes out"

    A file is validated by its shape as you add it to the plugin — the extension proves
    nothing, and renaming a `.txt` by accident is the ordinary case. Refused there, the author
    fixes it; refused at apply time, somebody else just learns the plugin does not work.

    The check is deliberately shallow. Whether each task is valid is decided on the machine
    that will run it, against that BMM's own registry — a second opinion written into the
    packer would be wrong the day somebody adds an action.

## The card, and the two questions people ask

A plugin card offered eleven icon buttons in one row. Each did something different and they
all looked the same, so there was no way to tell which of them only *looked* and which
*changed* something — and neither of the questions somebody actually has before trusting a
plugin could be answered from it at all.

Two verbs stay in the open: **Compare** and **Apply**. Then three buttons that only ask:

| | |
|---|---|
| **Permissions** | The twenty-six grants, for THIS plugin, on its card. They lived on a settings screen listing every plugin at once. Ticking here **grants** — nothing is asked again afterwards. |
| **Contents** | Everything the plugin holds: scripts, bundled folders, automations, assets, the lot. |
| **Analyse** | What it would change if you applied it. |

Everything that *changes* something moves behind a **⋮** menu that names it in words:
auto-update, files, open folder, edit, duplicate, export, and **uninstall last, behind a
separator, in red**. Removing a plugin is not a peer of duplicating one. The menu closes on
++esc++, on a click outside, and on choosing anything — a menu that only closes by pressing
its own button again is one people leave open.

!!! note "Contents is not the assets viewer"

    **Add a file…** below shows `assets/`, which answers "what did the author put in assets".
    **Contents** walks the whole plugin folder, which answers "what IS this" — and the second
    is the question somebody asks before running something they downloaded. Symbolic links are
    listed but never followed, the listing is sorted so two readings agree, and it stops at
    5000 entries or 24 levels deep.

## Seeing a folder before you bundle it

Creating a plugin lets you import a directory. It used to show you its **name** and nothing
else — how many files, how big, whether `node_modules` or a build output or a `.env` came
along was invisible until the plugin was built, published, and downloaded by other people.

Each picked folder now carries its own **count and size**, and an eye button opens the same
listing the Contents modal uses. The facts are fetched per row after the list draws, so a
folder on a slow drive does not hold up the one beside it.

## Putting a file in, and checking the plugin

Reading, listing and copying **out** of a plugin all existed. Getting a README **in** meant
finding the install folder in Explorer, which is not something an author should have to know
about their own plugin. The assets screen now has both halves, and a check.

### Add a file… / Remove

**Add a file…** copies what you pick into `assets/`. A path with a folder in it keeps the
folder (`docs/codes.csv` lands in `assets/docs/`).

!!! note "It never silently replaces"

    Adding `README.md` twice means you changed it and the second one wins. Adding a
    *different* file that happens to share a name means you have just lost the first — and
    only you can tell which of the two it was. So it refuses, and names the file.

    Rename yours, or remove the one that is there first.

**Remove** deletes the selected file from the plugin. It is not recoverable from here, which
is why it asks first and names what it is about to delete.

### Check this plugin

Everything this reports produces a plugin that **installs and then does not work** — the
failure with no error message: the manifest is valid JSON, the archive unpacks, and the thing
simply does nothing on somebody else's machine.

| Reported | Why |
|---|---|
| A declared script that is not in the folder | It installs, applying it runs nothing, and nothing says why. |
| **Contains scripts** ticked with none listed | Applying it prompts about scripts it does not have. |
| A manifest listing an asset that is not there | That list is written from disk at pack time, so this means the manifest was edited by hand. |
| Applying it would do nothing | No mod list and no scripts. |
| A **strict** mod list that is empty | Strict means "these and nothing else". Empty, that reads as *turn everything off*. |
| No name | It shows as its id everywhere. |
| No description, no author | A catalogue entry with no description is one nobody installs, and you are the only person who can write it. |
| A file present that the manifest does not mention | Not an error — the installed copy reads the folder — but a moderation queue has only the manifest to go on. |

The first list is what stops it working elsewhere; the second is worth reading before you
publish. **"No problems found" is said out loud too** — a check that only speaks when it is
unhappy is one you never trust when it is quiet.
