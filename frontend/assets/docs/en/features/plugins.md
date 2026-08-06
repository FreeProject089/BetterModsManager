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

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/plugins.bmmreplay" data-page="features/plugins" data-title="Granting and using a plugin (placeholder clip)"></div>

*Placeholder recording — a focused clip of this screen will replace it.*

## What you can grant a plugin

Every grant is a **write** capability — the power to *change* something. There's no "read"
permission to hand out for your mods or profiles, because reading isn't gated in the first
place (the API only listens on your own machine). A grant buys a plugin the ability to act,
not to look.

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
