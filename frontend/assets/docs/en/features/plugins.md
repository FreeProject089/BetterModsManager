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

<div class="bmm-replay"
     data-src="../assets/replays/plugins.bmmreplay"
     data-title="Granting and using a plugin (placeholder clip)"></div>

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

<!-- TODO(content): the API reference, the endpoint list and custom commands need their own
     pages — this is 960+ strings' worth of surface. -->
